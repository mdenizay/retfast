import Foundation
import os

/// Pilot-side retrieval requests, with the same reliability rules as telemetry:
///
/// 1. `request` writes the request to SQLite synchronously, before any network.
/// 2. A per-request loop sends `POST /events/{id}/retrievals` with the client id
///    (idempotent) and retries with backoff until the server confirms it.
/// 3. Once sent, it polls `GET /retrievals/{id}` (the realtime channel only
///    speeds this up via `apply(_:)`; it is never relied on).
/// 4. `cancel` ("Kendim döndüm") is local if nothing was ever sent, otherwise
///    it is delivered to the server and retried until confirmed.
///
/// 409 on create means the pilot already has an open request in this event.
/// The open one is adopted (the local request is marked `merged`), so the
/// waiting screen shows what the server really has.
public actor RetrievalManager {
    private let store: LocalTelemetryStore
    private let api: APIClient
    private let clock: any SyncClock
    private let backoff: Backoff
    public let pollInterval: Double

    /// Latest state of every request touched in this run.
    public nonisolated let updates = Broadcaster<LocalRetrieval>()
    private var loops: [UUID: Task<Void, Never>] = [:]
    private var failures: [UUID: Int] = [:]

    private static let log = Logger(subsystem: "com.mizibu.retfast", category: "retrieval")

    public init(store: LocalTelemetryStore, api: APIClient, clock: any SyncClock = SystemClock(),
                backoff: Backoff = Backoff(base: 2, cap: 60), pollInterval: Double = 15) {
        self.store = store
        self.api = api
        self.clock = clock
        self.backoff = backoff
        self.pollInterval = pollInterval
    }

    // MARK: Commands

    /// Persist the request locally first (synchronously), then start delivery.
    @discardableResult
    public func request(eventId: String, eventName: String?, flightId: UUID?, pickup: SharedPosition,
                        note: String, id: UUID = UUID(), startDelivery: Bool = true) throws -> LocalRetrieval {
        let r = LocalRetrieval(id: id, eventId: eventId.lowercased(), eventName: eventName, flightId: flightId,
                               pickup: pickup, note: note.trimmingCharacters(in: .whitespacesAndNewlines),
                               createdAt: clock.now())
        try store.saveRetrieval(r)
        Self.log.notice("retrieval saved locally id=\(r.wireId, privacy: .public)")
        updates.send(r)
        if startDelivery { startLoop(r.id) }
        return r
    }

    /// "Kendim döndüm". Local if never sent; otherwise told to the server.
    public func cancel(id: UUID, reason: String?, startDelivery: Bool = true) throws {
        guard var r = try store.retrieval(id: id), !r.isTerminal else { return }
        r.cancelRequested = true
        r.cancelReason = reason
        if r.outbox == .pending && r.attemptCount == 0 {
            r.cancelSynced = true
        }
        save(&r)
        if r.isTerminal { stopLoop(id) } else if startDelivery { startLoop(id) }
    }

    /// On launch: resume delivery/polling for everything not finished.
    public func resumeAll() throws {
        for r in try store.retrievals(limit: 50) where !r.isTerminal {
            updates.send(r)
            startLoop(r.id)
        }
    }

    public func retrieval(id: UUID) -> LocalRetrieval? { try? store.retrieval(id: id) }

    /// The request the waiting screen should show: newest non-terminal one.
    public func activeRetrieval() -> LocalRetrieval? {
        ((try? store.retrievals(limit: 20)) ?? []).first { !$0.isTerminal }
    }

    /// Server copy from the realtime channel or another screen.
    public func apply(_ server: Retrieval) {
        guard let id = UUID(uuidString: server.id), var r = try? store.retrieval(id: id) else { return }
        guard r.outbox != .merged && r.outbox != .refused else { return }
        r.outbox = .sent
        Self.merge(server, into: &r)
        save(&r)
        if r.isTerminal { stopLoop(id) }
    }

    /// Wake a loop now (e.g. app came to the foreground).
    public func kickAll() {
        for (id, _) in loops { startLoop(id) }
    }

    // MARK: Loop

    private func startLoop(_ id: UUID) {
        loops[id]?.cancel()
        loops[id] = Task { await self.run(id, maxSteps: nil) }
    }

    private func stopLoop(_ id: UUID) {
        loops[id]?.cancel()
        loops[id] = nil
    }

    /// Delivery/poll loop. `maxSteps` for deterministic tests.
    public func run(_ id: UUID, maxSteps: Int?) async {
        var steps = 0
        while !Task.isCancelled {
            if let maxSteps, steps >= maxSteps { return }
            steps += 1
            guard let delay = await step(id) else { return }
            try? await clock.sleep(seconds: delay)
        }
    }

    /// One action for the request. Returns the delay before the next step, or
    /// nil when nothing more is needed. Every write after a network await
    /// re-reads the row (`mutate`), so a cancel issued meanwhile is never lost.
    public func step(_ id: UUID) async -> Double? {
        guard let r = mutate(id, { r in
            guard !r.isTerminal, r.outbox == .pending else { return }
            r.attemptCount += 1
            r.lastAttemptAt = clock.now()
        }), !r.isTerminal else { return nil }

        do {
            if r.outbox == .pending {
                let body = CreateRetrievalRequest(id: r.wireId, flightId: r.flightId?.uuidString.lowercased(),
                                                  pickup: r.pickup, note: r.note.isEmpty ? nil : r.note)
                do {
                    let server = try await api.createRetrieval(eventId: r.eventId, body)
                    failures[id] = 0
                    let updated = mutate(id) { r in
                        r.outbox = .sent
                        r.lastError = nil
                        Self.merge(server, into: &r)
                    }
                    Self.log.notice("retrieval delivered id=\(r.wireId, privacy: .public) status=\(server.status, privacy: .public)")
                    guard let updated, !updated.isTerminal else { return nil }
                    return (updated.cancelRequested && !updated.cancelSynced) ? 0 : pollInterval
                } catch let error as APIError where error.status == 409 {
                    return await resolveConflict(id, error: error)
                }
            }

            if r.cancelRequested && !r.cancelSynced {
                var server: Retrieval?
                do {
                    server = try await api.cancelRetrieval(r.wireId, reason: r.cancelReason)
                } catch let error as APIError where error.status == 409 {
                    // Already closed on the server (delivered, or cancelled by an organizer).
                    server = try? await api.retrieval(r.wireId)
                }
                let updated = mutate(id) { r in
                    r.cancelSynced = true
                    r.lastError = nil
                    if let server { Self.merge(server, into: &r) }
                    else if r.status?.isOpen ?? true { r.serverStatus = RetrievalStatus.cancelled.rawValue }
                }
                return (updated?.isTerminal ?? true) ? nil : pollInterval
            }

            let server = try await api.retrieval(r.wireId)
            failures[id] = 0
            let updated = mutate(id) { r in
                Self.merge(server, into: &r)
                r.lastError = nil
            }
            guard let updated, !updated.isTerminal else { return nil }
            return (updated.cancelRequested && !updated.cancelSynced) ? 0 : pollInterval
        } catch let error as APIError {
            let code = error.code ?? (error.isOffline ? "offline" : "transport")
            let refuse = r.outbox == .pending && [400, 403, 404, 422].contains(error.status ?? 0) && !error.isPasswordChangeRequired
            let updated = mutate(id) { r in
                r.lastError = code
                if refuse && r.outbox == .pending { r.outbox = .refused }
            }
            if updated?.isTerminal ?? true {
                Self.log.error("retrieval refused id=\(r.wireId, privacy: .public) status=\(error.status ?? 0)")
                return nil
            }
            let attempt = failures[id, default: 0]
            failures[id] = attempt + 1
            let delay = backoff.delay(attempt: attempt)
            if error.status == 429 { return max(error.retryAfter ?? 5, delay) }
            if updated?.outbox == .sent && !(updated?.cancelRequested ?? false) { return max(pollInterval, delay) }
            return delay
        } catch {
            mutate(id) { $0.lastError = "transport" }
            let attempt = failures[id, default: 0]
            failures[id] = attempt + 1
            return backoff.delay(attempt: attempt)
        }
    }

    /// 409 on create: the pilot already has an open request in this event.
    /// Find it (error details, else the event's open list) and adopt it.
    private func resolveConflict(_ id: UUID, error: APIError) async -> Double? {
        guard let r = try? store.retrieval(id: id) else { return nil }
        var open: Retrieval?
        if case .server(_, _, _, let details, _) = error, let details {
            if let json = details["retrieval"], let decoded = try? JSONCoding.makeDecoder().decode(Retrieval.self, from: Data(json.utf8)) {
                open = decoded
            } else if let otherId = details["retrieval_id"] ?? details["open_retrieval_id"] ?? details["id"] {
                open = try? await api.retrieval(otherId)
            }
        }
        if open == nil {
            let mine = (try? await api.retrievals(eventId: r.eventId, status: RetrievalStatus.openRaw)) ?? []
            open = mine.first { $0.id.lowercased() == r.wireId } ?? mine.first
        }
        guard let open else {
            mutate(id) { $0.lastError = "conflict" }
            let attempt = failures[id, default: 0]
            failures[id] = attempt + 1
            return backoff.delay(attempt: attempt)
        }
        if open.id.lowercased() == r.wireId {
            // Same request (the first response was lost): it is ours.
            let updated = mutate(id) { r in
                r.outbox = .sent
                r.lastError = nil
                Self.merge(open, into: &r)
            }
            return (updated?.isTerminal ?? true) ? nil : pollInterval
        }
        let merged = mutate(id) { r in
            r.outbox = .merged
            r.mergedInto = open.id.lowercased()
            r.lastError = nil
        }
        Self.log.notice("retrieval \(r.wireId, privacy: .public) merged into open \(open.id, privacy: .public)")
        guard let otherId = UUID(uuidString: open.id), (try? store.retrieval(id: otherId)) == nil else { return nil }
        var adopted = LocalRetrieval(id: otherId, eventId: (open.eventId ?? r.eventId).lowercased(), eventName: r.eventName,
                                     flightId: open.flightId.flatMap(UUID.init(uuidString:)),
                                     pickup: open.pickup ?? r.pickup, note: open.note ?? "",
                                     createdAt: open.requestedAt ?? clock.now())
        adopted.outbox = .sent
        Self.merge(open, into: &adopted)
        // Carry over a cancel the pilot already asked for.
        if merged?.cancelRequested == true { adopted.cancelRequested = true; adopted.cancelReason = merged?.cancelReason }
        save(&adopted)
        if !adopted.isTerminal { startLoop(otherId) }
        return nil
    }

    static func merge(_ server: Retrieval, into r: inout LocalRetrieval) {
        r.serverStatus = server.status
        if let data = try? JSONCoding.makeEncoder().encode(server) {
            r.serverJSON = String(decoding: data, as: UTF8.self)
        }
        if server.retrievalStatus == .cancelled && r.cancelRequested { r.cancelSynced = true }
    }

    @discardableResult
    private func mutate(_ id: UUID, _ change: (inout LocalRetrieval) -> Void) -> LocalRetrieval? {
        guard var r = try? store.retrieval(id: id) else { return nil }
        change(&r)
        save(&r)
        return r
    }

    private func save(_ r: inout LocalRetrieval) {
        r.updatedAt = clock.now()
        try? store.saveRetrieval(r)
        updates.send(r)
    }
}
