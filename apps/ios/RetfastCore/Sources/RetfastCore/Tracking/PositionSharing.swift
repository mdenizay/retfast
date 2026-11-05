import Foundation
import Observation
import os

/// Retriever duty for one event, persisted so it survives a relaunch.
public struct RetrieverDutyState: Codable, Sendable, Equatable {
    public var eventId: String
    public var eventName: String?
    public var onDuty: Bool
    /// Accepted or picked-up retrievals held by this retriever.
    public var activePickups: Int

    public init(eventId: String, eventName: String?, onDuty: Bool, activePickups: Int) {
        self.eventId = eventId; self.eventName = eventName; self.onDuty = onDuty; self.activePickups = activePickups
    }

    public var needsSharing: Bool { onDuty || activePickups > 0 }

    static let key = "retrieverDuty"

    public static func load(_ store: LocalTelemetryStore) -> RetrieverDutyState? {
        guard let json = try? store.value(forKey: key) else { return nil }
        return try? JSONDecoder().decode(RetrieverDutyState.self, from: Data(json.utf8))
    }

    public static func save(_ state: RetrieverDutyState?, to store: LocalTelemetryStore) {
        let json = state.flatMap { try? JSONEncoder().encode($0) }.map { String(decoding: $0, as: UTF8.self) }
        try? store.setValue(json, forKey: key)
    }
}

/// What the phone shares, and how often. Pure, so start/stop per state is tested.
public enum SharingMode: Sendable, Equatable {
    case off
    /// Landed pilot waiting: `POST /retrievals/{id}/position` ≈ every 30 s.
    case pilotWaiting(retrievalId: String, eventId: String)
    /// Retriever on duty or holding pickups: `POST /events/{id}/retrievers/me/position` ≈ every 15 s.
    case retriever(eventId: String)

    public var profile: TrackingProfile? {
        switch self {
        case .off: nil
        case .pilotWaiting: .retrieveWaiting
        case .retriever: .retrieverDriving
        }
    }

    /// Minimum spacing between two sends.
    public var interval: TimeInterval { profile?.settings.minSampleInterval ?? 0 }

    /// Decide from the pilot's active request and the retriever duty. A user
    /// has one role per event; if both apply (two events), the waiting pilot
    /// wins because a stranded pilot's position matters most.
    public static func decide(activeRetrieval: LocalRetrieval?, duty: RetrieverDutyState?) -> SharingMode {
        if let r = activeRetrieval, r.outbox == .sent, r.stage.sharesPilotPosition {
            return .pilotWaiting(retrievalId: r.wireId, eventId: r.eventId)
        }
        if let duty, duty.needsSharing { return .retriever(eventId: duty.eventId) }
        return .off
    }

    /// Send when the interval elapsed and there is a fix newer than the last one sent.
    public static func isDue(now: Date, lastSentAt: Date?, lastSentFixAt: Date?, latestFixAt: Date?, interval: TimeInterval) -> Bool {
        guard let latestFixAt else { return false }
        if let lastSentFixAt, latestFixAt <= lastSentFixAt { return false }
        guard let lastSentAt else { return true }
        return now.timeIntervalSince(lastSentAt) >= interval
    }
}

/// Shares the phone's position while the pilot waits for a retrieve or while
/// a retriever is on duty. Uses the `.sharing` client of the `LocationArbiter`,
/// so the same background-capable engine (and restoration path) as flight
/// recording is used. Positions are not stored: only the latest one matters,
/// and the retrieval *request* itself has its own persisted outbox.
@MainActor
@Observable
public final class PositionSharingManager {
    public private(set) var mode: SharingMode = .off
    public private(set) var lastFix: RawLocation?
    public private(set) var lastSentAt: Date?
    public private(set) var lastSentFixAt: Date?
    public private(set) var sentCount = 0
    public private(set) var failureCount = 0
    public private(set) var lastError: String?
    public private(set) var authorization: LocationAuthorization

    public typealias Sender = @Sendable (SharingMode, SharedPosition) async throws -> Void

    @ObservationIgnored private let location: any LocationProviding
    @ObservationIgnored private let sender: Sender
    @ObservationIgnored private let now: @MainActor () -> Date
    @ObservationIgnored private var inFlight = false
    @ObservationIgnored private var ticker: Task<Void, Never>?
    @ObservationIgnored private let tickInterval: Double
    @ObservationIgnored private static let log = Logger(subsystem: "com.mizibu.retfast", category: "sharing")

    /// Called when the server says the thing we share for is gone (404/409/403).
    @ObservationIgnored public var onTargetGone: ((SharingMode) -> Void)?

    public init(location: any LocationProviding, sender: @escaping Sender, tickInterval: Double = 5,
                now: @escaping @MainActor () -> Date = { Date() }) {
        self.location = location
        self.sender = sender
        self.tickInterval = tickInterval
        self.now = now
        self.authorization = location.authorization
        location.onLocations = { [weak self] fixes in self?.handle(fixes) }
        location.onAuthorizationChange = { [weak self] auth in self?.authorization = auth }
    }

    public var isSharing: Bool { mode != .off }

    /// Switch mode; starts/stops location updates accordingly.
    public func update(mode new: SharingMode) {
        guard new != mode else { return }
        let old = mode
        mode = new
        Self.log.notice("sharing \(String(describing: old), privacy: .public) → \(String(describing: new), privacy: .public)")
        if let profile = new.profile {
            if old == .off {
                lastSentAt = nil
                lastSentFixAt = nil
                location.startRecording(profile: profile)
            } else {
                location.apply(profile: profile)
            }
            startTicker()
        } else {
            location.stopRecording()
            ticker?.cancel()
            ticker = nil
        }
        // A target change (other retrieval / event) must not wait an interval.
        if old != .off && new != .off { lastSentAt = nil }
    }

    /// Periodic check (also driven by new fixes).
    public func tick() { maybeSend() }

    private func startTicker() {
        guard ticker == nil else { return }
        let interval = tickInterval
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                self?.tick()
            }
        }
    }

    private func handle(_ fixes: [RawLocation]) {
        guard let fix = fixes.filter({ $0.horizontalAccuracy >= 0 && $0.latitude.isFinite && $0.longitude.isFinite }).last else { return }
        if let last = lastFix, fix.timestamp <= last.timestamp { return }
        lastFix = fix
        maybeSend()
    }

    private func maybeSend() {
        let mode = self.mode
        guard mode != .off, !inFlight, let fix = lastFix,
              SharingMode.isDue(now: now(), lastSentAt: lastSentAt, lastSentFixAt: lastSentFixAt,
                                latestFixAt: fix.timestamp, interval: mode.interval) else { return }
        inFlight = true
        let position = SharedPosition(lat: fix.latitude, lon: fix.longitude,
                                      gpsAltM: fix.verticalAccuracy > 0 ? fix.altitude : nil,
                                      hAccM: fix.horizontalAccuracy, t: fix.timestamp,
                                      courseDeg: fix.course >= 0 ? fix.course : nil,
                                      speedMs: fix.speed >= 0 ? fix.speed : nil)
        let sender = self.sender
        Task { [weak self] in
            do {
                try await sender(mode, position)
                self?.didSend(fixAt: fix.timestamp)
            } catch {
                self?.didFail(error, mode: mode)
            }
        }
    }

    private func didSend(fixAt: Date) {
        inFlight = false
        lastSentAt = now()
        lastSentFixAt = fixAt
        sentCount += 1
        lastError = nil
    }

    private func didFail(_ error: any Error, mode: SharingMode) {
        inFlight = false
        failureCount += 1
        // Retry at the next interval, not immediately.
        lastSentAt = now()
        if let api = error as? APIError {
            lastError = api.code ?? (api.isOffline ? "offline" : "transport")
            if let status = api.status, [403, 404, 409].contains(status) { onTargetGone?(mode) }
        } else {
            lastError = "transport"
        }
    }
}
