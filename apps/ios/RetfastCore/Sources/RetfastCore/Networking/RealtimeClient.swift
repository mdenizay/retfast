import Foundation
import os

public struct LivePositionEvent: Codable, Sendable, Equatable {
    public var flightId: String
    public var pilot: PersonRef?
    public var isSimulated: Bool?
    public var position: Position
}

public enum RealtimeMessage: Sendable, Equatable {
    case authOK(userId: String?)
    case eventSnapshot(channel: String, snapshot: LiveSnapshot)
    case flightSnapshot(channel: String, flight: Flight)
    case subscribed(channel: String)
    case position(channel: String, LivePositionEvent)
    case flight(channel: String, Flight)
    /// `retrievals:<event_id>` subscribed: the snapshot is decoded leniently
    /// (it may be the live-snapshot shape or just a list of retrievals).
    case retrievalsSnapshot(channel: String, retrievals: [Retrieval])
    case retrieval(channel: String, Retrieval)
    case retrieverPosition(channel: String, RetrieverPositionEvent)
    case pilotPosition(channel: String, PilotPositionEvent)
    case error(code: String, channel: String?)
}

public enum RealtimeConnectionState: Sendable, Equatable {
    case disconnected
    case connecting
    case connected
    case reconnecting(attempt: Int, delay: Double)
}

/// WebSocket client for the event map and retrieval views. Foreground only: the
/// app disconnects when it leaves the foreground (this is not a background
/// channel and does not carry the pilot's own telemetry).
public actor RealtimeClient {
    private let url: URL
    private let session: URLSession
    private let tokenProvider: @Sendable () async -> String?
    private let enabled: Bool
    private let backoff = Backoff(base: 1, cap: 30)
    private var task: URLSessionWebSocketTask?
    private var receiveLoop: Task<Void, Never>?
    private var watchdog: Task<Void, Never>?
    private var channels: Set<String> = []
    private var cursors: [String: String] = [:]
    private var wantConnected = false
    private var attempt = 0
    private var lastMessageAt = Date()
    private let decoder = JSONCoding.makeDecoder()

    public nonisolated let messages = Broadcaster<RealtimeMessage>()
    public nonisolated let connection = Broadcaster<RealtimeConnectionState>(initial: .disconnected)
    private static let log = Logger(subsystem: "com.mizibu.retfast", category: "realtime")

    /// - Parameter baseURL: server root (http/https); converted to ws/wss.
    /// - Parameter enabled: false keeps the client inert (UI tests against a stub API).
    public init(baseURL: URL, session: URLSession = .shared, enabled: Bool = true,
                tokenProvider: @escaping @Sendable () async -> String?) {
        self.enabled = enabled
        var c = URLComponents(url: baseURL.appendingPathComponent("api/v1/realtime"), resolvingAgainstBaseURL: false)!
        c.scheme = c.scheme == "https" ? "wss" : "ws"
        self.url = c.url!
        self.session = session
        self.tokenProvider = tokenProvider
    }

    public func connect() {
        guard enabled else { return }
        wantConnected = true
        guard task == nil else { return }
        open()
    }

    public func disconnect() {
        wantConnected = false
        teardown()
        connection.send(.disconnected)
    }

    public func subscribe(_ channel: String) {
        channels.insert(channel)
        sendSubscribe(channel)
    }

    public func unsubscribe(_ channel: String) {
        channels.remove(channel)
        cursors[channel] = nil
        send(["type": "unsubscribe", "channel": channel])
    }

    private func open() {
        connection.send(attempt == 0 ? .connecting : .reconnecting(attempt: attempt, delay: 0))
        let task = session.webSocketTask(with: url)
        self.task = task
        task.resume()
        lastMessageAt = Date()
        receiveLoop = Task { await self.receive(task) }
        watchdog = Task { await self.watch(task) }
        Task {
            if let token = await tokenProvider() { self.send(["type": "auth", "access_token": token]) }
            for channel in self.channels { self.sendSubscribe(channel) }
        }
    }

    private func sendSubscribe(_ channel: String) {
        var msg = ["type": "subscribe", "channel": channel]
        if let since = cursors[channel] { msg["since"] = since }
        send(msg)
    }

    private func send(_ object: [String: String]) {
        guard let task, let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { _ in }
    }

    private func teardown() {
        receiveLoop?.cancel(); receiveLoop = nil
        watchdog?.cancel(); watchdog = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func receive(_ task: URLSessionWebSocketTask) async {
        while !Task.isCancelled {
            do {
                let message = try await task.receive()
                lastMessageAt = Date()
                if attempt != 0 || connection.latest != .connected { attempt = 0; connection.send(.connected) }
                switch message {
                case .string(let text): handle(Data(text.utf8))
                case .data(let data): handle(data)
                @unknown default: break
                }
            } catch {
                guard task === self.task else { return }
                Self.log.notice("realtime closed code=\(task.closeCode.rawValue)")
                scheduleReconnect()
                return
            }
        }
    }

    /// A connection silent for 60 s is dead (server pings every 25 s).
    private func watch(_ task: URLSessionWebSocketTask) async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            guard task === self.task, !Task.isCancelled else { return }
            if Date().timeIntervalSince(lastMessageAt) > 60 { scheduleReconnect(); return }
            send(["type": "ping"])
        }
    }

    private func scheduleReconnect() {
        teardown()
        guard wantConnected else { return }
        let delay = backoff.delay(attempt: attempt)
        attempt += 1
        connection.send(.reconnecting(attempt: attempt, delay: delay))
        Task {
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            self.reopenIfWanted()
        }
    }

    private func reopenIfWanted() {
        if wantConnected && task == nil { open() }
    }

    private struct Envelope: Decodable {
        var type: String
        var channel: String?
        var cursor: String?
        var code: String?
        var userId: String?
    }
    private struct DataEnvelope<T: Decodable>: Decodable { var data: T }
    private struct SnapshotEnvelope<T: Decodable>: Decodable { var snapshot: T }

    func handle(_ data: Data) {
        guard let env = try? decoder.decode(Envelope.self, from: data) else { return }
        if let channel = env.channel, let cursor = env.cursor { cursors[channel] = cursor }
        switch env.type {
        case "auth_ok":
            messages.send(.authOK(userId: env.userId))
        case "ping":
            send(["type": "pong"])
        case "subscribed":
            let channel = env.channel ?? ""
            if channel.hasPrefix("event:"), let s = try? decoder.decode(SnapshotEnvelope<LiveSnapshot>.self, from: data) {
                messages.send(.eventSnapshot(channel: channel, snapshot: s.snapshot))
            } else if channel.hasPrefix("flight:"), let s = try? decoder.decode(SnapshotEnvelope<Flight>.self, from: data) {
                messages.send(.flightSnapshot(channel: channel, flight: s.snapshot))
            } else if channel.hasPrefix("retrievals:") {
                if let s = try? decoder.decode(SnapshotEnvelope<LiveSnapshot>.self, from: data), let r = s.snapshot.retrievals {
                    messages.send(.retrievalsSnapshot(channel: channel, retrievals: r))
                } else if let s = try? decoder.decode(SnapshotEnvelope<ItemsResponse<Retrieval>>.self, from: data) {
                    messages.send(.retrievalsSnapshot(channel: channel, retrievals: s.snapshot.items))
                } else if let s = try? decoder.decode(SnapshotEnvelope<[Retrieval]>.self, from: data) {
                    messages.send(.retrievalsSnapshot(channel: channel, retrievals: s.snapshot))
                } else {
                    messages.send(.subscribed(channel: channel))
                }
            } else {
                messages.send(.subscribed(channel: channel))
            }
        case "position":
            if let d = try? decoder.decode(DataEnvelope<LivePositionEvent>.self, from: data) {
                messages.send(.position(channel: env.channel ?? "", d.data))
            }
        case "flight":
            if let d = try? decoder.decode(DataEnvelope<Flight>.self, from: data) {
                messages.send(.flight(channel: env.channel ?? "", d.data))
            }
        case "retrieval":
            if let d = try? decoder.decode(DataEnvelope<Retrieval>.self, from: data) {
                messages.send(.retrieval(channel: env.channel ?? "", d.data))
            }
        case "retriever_position":
            if let d = try? decoder.decode(DataEnvelope<RetrieverPositionEvent>.self, from: data) {
                messages.send(.retrieverPosition(channel: env.channel ?? "", d.data))
            }
        case "pilot_position":
            if let d = try? decoder.decode(DataEnvelope<PilotPositionEvent>.self, from: data) {
                messages.send(.pilotPosition(channel: env.channel ?? "", d.data))
            }
        case "error":
            messages.send(.error(code: env.code ?? "unknown", channel: env.channel))
        default:
            break
        }
    }
}
