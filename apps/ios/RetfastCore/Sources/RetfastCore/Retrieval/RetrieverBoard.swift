import Foundation
import Observation
import os

/// Retriever-side state for one event: open requests and my pickups.
///
/// The list comes from `GET /events/{id}/retrievals` (polled) and is sped up
/// by the `retrievals:<event_id>` channel via `apply(_:)`. Every action waits
/// for the server; nothing is optimistic. Accept is "first one wins": a 409
/// means someone else was faster, which is shown as a normal outcome.
@MainActor
@Observable
public final class RetrieverBoard {
    public enum Notice: Equatable, Sendable {
        /// Another retriever accepted it first.
        case alreadyTaken(pilotName: String?)
        case failed(String)
    }

    public enum AcceptOutcome: Equatable, Sendable {
        case accepted
        case alreadyTaken
        case failed(String)
    }

    public let eventId: String
    public let eventName: String?
    public let myUserId: String
    public private(set) var retrievals: [Retrieval] = []
    public private(set) var onDuty: Bool
    public private(set) var lastRefresh: Date?
    public private(set) var refreshError: String?
    public private(set) var notice: Notice?
    public private(set) var busy: Set<String> = []

    /// Persisted duty + pickup count changed (drives position sharing).
    @ObservationIgnored public var onDutyStateChange: ((RetrieverDutyState) -> Void)?

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private var pollTask: Task<Void, Never>?
    @ObservationIgnored private static let log = Logger(subsystem: "com.mizibu.retfast", category: "retriever")

    public init(eventId: String, eventName: String?, myUserId: String, api: APIClient, onDuty: Bool = false) {
        self.eventId = eventId.lowercased()
        self.eventName = eventName
        self.myUserId = myUserId.lowercased()
        self.api = api
        self.onDuty = onDuty
    }

    // MARK: Derived

    /// Waiting pilots, oldest request first.
    public var openRequests: [Retrieval] {
        retrievals.filter { $0.retrievalStatus == .requested }
            .sorted { ($0.requestedAt ?? .distantFuture) < ($1.requestedAt ?? .distantFuture) }
    }

    /// Accepted / picked-up retrievals held by me.
    public var myPickups: [Retrieval] {
        retrievals.filter { r in
            (r.retrievalStatus == .accepted || r.retrievalStatus == .pickedUp) && isMine(r)
        }.sorted { ($0.acceptedAt ?? .distantPast) < ($1.acceptedAt ?? .distantPast) }
    }

    public func isMine(_ r: Retrieval) -> Bool { r.retriever?.userId?.lowercased() == myUserId }

    public var dutyState: RetrieverDutyState {
        RetrieverDutyState(eventId: eventId, eventName: eventName, onDuty: onDuty, activePickups: myPickups.count)
    }

    public func clearNotice() { notice = nil }

    // MARK: Loading

    public func refresh() async {
        do {
            let items = try await api.retrievals(eventId: eventId, status: RetrievalStatus.openRaw)
            retrievals = items
            lastRefresh = Date()
            refreshError = nil
            publishDuty()
        } catch {
            refreshError = (error as? APIError)?.code ?? "transport"
        }
    }

    /// Poll while the board exists (the socket is never the only source).
    public func startPolling(every seconds: Double = 20) {
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            }
        }
    }

    public func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    /// Realtime / snapshot update of one retrieval.
    public func apply(_ r: Retrieval) {
        let visible = r.retrievalStatus == .requested || ((r.retrievalStatus?.isOpen ?? false) && isMine(r))
        if let i = retrievals.firstIndex(where: { $0.id == r.id }) {
            if visible { retrievals[i] = r } else { retrievals.remove(at: i) }
        } else if visible {
            retrievals.append(r)
        }
        publishDuty()
    }

    public func apply(_ snapshot: [Retrieval]) {
        retrievals = snapshot.filter { $0.retrievalStatus == .requested || (($0.retrievalStatus?.isOpen ?? false) && isMine($0)) }
        publishDuty()
    }

    /// Live pilot position for a retrieval I hold.
    public func apply(_ event: PilotPositionEvent) {
        guard let i = retrievals.firstIndex(where: { $0.id.lowercased() == event.retrievalId.lowercased() }) else { return }
        retrievals[i].pilotPosition = event.position
    }

    // MARK: Actions

    public func setDuty(_ on: Bool) async throws {
        try await api.setRetrieverDuty(eventId: eventId, onDuty: on)
        onDuty = on
        publishDuty()
    }

    @discardableResult
    public func accept(_ id: String) async -> AcceptOutcome {
        guard !busy.contains(id) else { return .failed("busy") }
        busy.insert(id); defer { busy.remove(id) }
        let name = retrievals.first { $0.id == id }?.pilot?.fullName
        do {
            if let updated = try await api.acceptRetrieval(id) { apply(updated) } else { await refresh() }
            notice = nil
            if !myPickups.contains(where: { $0.id == id }) { await refresh() }
            return .accepted
        } catch let error as APIError where error.status == 409 {
            // First one wins: someone else took it. Not an error for the user.
            Self.log.notice("accept \(id, privacy: .public): already taken")
            retrievals.removeAll { $0.id == id }
            notice = .alreadyTaken(pilotName: name)
            await refresh()
            return .alreadyTaken
        } catch {
            let code = (error as? APIError)?.code ?? "transport"
            notice = .failed(code)
            return .failed(code)
        }
    }

    public func release(_ id: String) async -> Bool { await act(id) { try await $0.releaseRetrieval(id) } }
    public func markPickedUp(_ id: String) async -> Bool { await act(id) { try await $0.markPickedUp(id) } }
    public func markDelivered(_ id: String, note: String?) async -> Bool {
        await act(id) { try await $0.markDelivered(id, note: note) }
    }

    private func act(_ id: String, _ call: (APIClient) async throws -> Retrieval?) async -> Bool {
        guard !busy.contains(id) else { return false }
        busy.insert(id); defer { busy.remove(id) }
        do {
            if let updated = try await call(api) { apply(updated) } else { await refresh() }
            notice = nil
            return true
        } catch {
            let code = (error as? APIError)?.code ?? "transport"
            notice = .failed(code)
            await refresh()
            return false
        }
    }

    private func publishDuty() {
        onDutyStateChange?(dutyState)
    }
}
