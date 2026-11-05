import Foundation
import os

/// What the UI shows about upload state. Never "synced" unless the server
/// acknowledged every stored sample.
public enum SyncStatus: Sendable, Equatable {
    case synced
    case syncing
    case pending
    case offline
    case authRequired
    case serverError(String)
}

public struct SyncSnapshot: Sendable, Equatable {
    public var status: SyncStatus
    public var pendingCount: Int
    public var lastServerAck: Date?
    public var lastAttemptAt: Date?
    public var nextRetryAt: Date?
    public var consecutiveFailures: Int
    public var lastError: String?

    public static let initial = SyncSnapshot(status: .pending, pendingCount: 0, lastServerAck: nil, lastAttemptAt: nil,
                                             nextRetryAt: nil, consecutiveFailures: 0, lastError: nil)
}

public enum SyncOutcome: Sendable, Equatable {
    /// Nothing left to upload.
    case idle
    /// Some work succeeded; there may be more.
    case progressed
    case offline
    case authRequired
    /// Retryable failure, optionally with a server-mandated delay (429 Retry-After).
    case failed(retryAfter: Double?)
}

/// Uploads stored samples in idempotent batches. Foreground `URLSession` only:
/// while iOS keeps the app running in the background for location updates the
/// loop keeps going, but nothing assumes networking survives suspension — any
/// unsent samples simply stay pending in SQLite until the next run.
public actor TelemetrySyncEngine {
    private let store: LocalTelemetryStore
    private let api: APIClient
    private let clock: any SyncClock
    private let backoff: Backoff
    private let device: DeviceInfo
    public let interval: Double
    public let maxBatchSize: Int

    public nonisolated let snapshots = Broadcaster<SyncSnapshot>(initial: .initial)
    private var snapshot = SyncSnapshot.initial
    private var loopTask: Task<Void, Never>?
    private var sleepTask: Task<Void, any Error>?
    private var networkAvailable = true
    private var authBlocked = false
    private var failures = 0

    private static let log = Logger(subsystem: "com.mizibu.retfast", category: "sync")

    public init(store: LocalTelemetryStore, api: APIClient, clock: any SyncClock = SystemClock(),
                backoff: Backoff = Backoff(), device: DeviceInfo, interval: Double = 5, maxBatchSize: Int = 500) {
        self.store = store
        self.api = api
        self.clock = clock
        self.backoff = backoff
        self.device = device
        self.interval = interval
        self.maxBatchSize = min(500, maxBatchSize)
    }

    // MARK: Control

    public func start() {
        guard loopTask == nil else { kick(); return }
        loopTask = Task { await self.runLoop(maxIterations: nil) }
    }

    public func stop() {
        loopTask?.cancel()
        loopTask = nil
        sleepTask?.cancel()
    }

    /// Wake the loop now (new samples, flight ended, app foregrounded).
    public func kick() {
        sleepTask?.cancel()
    }

    public func networkChanged(isConnected: Bool) {
        let wasOffline = !networkAvailable
        networkAvailable = isConnected
        if isConnected && wasOffline {
            failures = 0
            kick()
        } else if !isConnected {
            publish(status: .offline)
        }
    }

    /// Call after a successful sign-in / password change.
    public func authRestored() {
        authBlocked = false
        failures = 0
        kick()
    }

    public var currentSnapshot: SyncSnapshot { snapshot }

    /// The loop. `maxIterations` exists for deterministic tests.
    public func runLoop(maxIterations: Int?) async {
        var iterations = 0
        while !Task.isCancelled {
            if let maxIterations, iterations >= maxIterations { return }
            iterations += 1
            let outcome = await syncOnce()
            let delay: Double
            switch outcome {
            case .progressed:
                failures = 0
                continue
            case .idle:
                failures = 0
                delay = interval
            case .authRequired:
                // Wait for authRestored(); re-check occasionally.
                delay = 300
            case .offline, .failed(nil):
                delay = backoff.delay(attempt: failures)
                failures += 1
            case .failed(let retryAfter?):
                delay = max(retryAfter, 1)
                failures += 1
            }
            snapshot.nextRetryAt = clock.now().addingTimeInterval(delay)
            snapshot.consecutiveFailures = failures
            snapshots.send(snapshot)
            await sleep(delay)
        }
    }

    private func sleep(_ seconds: Double) async {
        let clock = self.clock
        let task = Task { try await clock.sleep(seconds: seconds) }
        sleepTask = task
        _ = await task.result
        sleepTask = nil
    }

    // MARK: One pass

    /// One unit of work: create unknown flights, then send at most one batch,
    /// then end completed flights whose samples are all acknowledged.
    public func syncOnce() async -> SyncOutcome {
        if authBlocked { publish(status: .authRequired); return .authRequired }
        if !networkAvailable { publish(status: .offline); return .offline }

        do {
            try await createPendingFlights()
            if let prepared = try store.nextBatch(maxSamples: maxBatchSize, now: clock.now()) {
                publish(status: .syncing)
                let outcome = await upload(prepared)
                if outcome != .progressed { return outcome }
                publishSettled()
                return .progressed
            }
            try await endCompletedFlights()
            publishSettled()
            return .idle
        } catch let error as APIError {
            return classify(error, context: "flight")
        } catch {
            Self.log.error("sync store error: \(String(describing: error), privacy: .public)")
            publish(status: .serverError("store"), error: String(describing: error))
            return .failed(retryAfter: nil)
        }
    }

    private func upload(_ prepared: PreparedBatch) async -> SyncOutcome {
        let request = TelemetryBatchRequest(
            batchId: prepared.batch.id.uuidString.lowercased(),
            flightId: prepared.batch.flightId.uuidString.lowercased(),
            samples: prepared.samples.map(TelemetrySampleDTO.init))
        snapshot.lastAttemptAt = clock.now()
        do {
            let response = try await api.uploadBatch(request)
            let acked = response.accepted + response.duplicate
            try store.recordBatchAttempt(prepared.batch.id, error: nil, at: clock.now())
            try store.applyBatchResult(batchId: prepared.batch.id, acknowledged: acked,
                                       rejected: response.rejected.map { ($0.seq, $0.reason) },
                                       ackTime: clock.now())
            if !response.rejected.isEmpty {
                Self.log.notice("batch \(request.batchId, privacy: .public): \(response.rejected.count) samples rejected")
            }
            return .progressed
        } catch let error as APIError {
            try? store.recordBatchAttempt(prepared.batch.id, error: error.code ?? "transport", at: clock.now())
            switch error {
            case .server(let status, let code, let message, _, _) where status == 400 || status == 422:
                // The whole batch is malformed: no retry will ever succeed.
                try? store.rejectBatch(batchId: prepared.batch.id, reason: "\(code): \(message ?? "")")
                return .progressed
            case .server(404, _, _, _, _):
                // Server does not know the flight (e.g. DB reset): re-create it, keep the batch.
                try? store.updateFlight(id: prepared.batch.flightId, { $0.serverCreated = false }, now: clock.now())
                return .failed(retryAfter: nil)
            default:
                return classify(error, context: "batch")
            }
        } catch {
            return .failed(retryAfter: nil)
        }
    }

    private func createPendingFlights() async throws {
        for flight in try store.flightsNeedingServerCreate() {
            let body = CreateFlightRequest(id: flight.id.uuidString.lowercased(),
                                           eventId: flight.eventId?.uuidString.lowercased(),
                                           startedAt: flight.startedAt,
                                           isSimulated: flight.isSimulated, device: device)
            do {
                _ = try await api.createFlight(body)
                try store.updateFlight(id: flight.id, { $0.serverCreated = true; $0.lastError = nil }, now: clock.now())
            } catch let error as APIError where error.status == 403 && !error.isPasswordChangeRequired || error.status == 409 || error.status == 422 || error.status == 400 {
                // Permanent for this flight (not a member / live tracking off / id clash).
                // Keep the samples, surface the error, and don't block other flights.
                let message = "\(error.code ?? "error")"
                try store.updateFlight(id: flight.id, { $0.lastError = message }, now: clock.now())
                publish(status: .serverError(message), error: message)
            }
        }
    }

    private func endCompletedFlights() async throws {
        for flight in try store.flightsNeedingServerEnd() {
            guard try store.pendingCount(flightId: flight.id) == 0, let endedAt = flight.endedAt else { continue }
            do {
                _ = try await api.endFlight(id: flight.id.uuidString.lowercased(), endedAt: endedAt)
                try store.updateFlight(id: flight.id, { $0.serverEnded = true; $0.lastError = nil }, now: clock.now())
            } catch let error as APIError where error.status == 404 {
                // The server no longer has this flight (deleted / DB reset): re-create it next pass.
                try store.updateFlight(id: flight.id, { $0.serverCreated = false }, now: clock.now())
            } catch let error as APIError where (error.status == 403 && !error.isPasswordChangeRequired) || error.status == 409 || error.status == 422 || error.status == 400 {
                // Permanent: retrying can never succeed. Stop retrying and surface it.
                let message = "\(error.code ?? "error")"
                try store.updateFlight(id: flight.id, { $0.serverEnded = true; $0.lastError = message }, now: clock.now())
                publish(status: .serverError(message), error: message)
            }
        }
    }

    private func classify(_ error: APIError, context: String) -> SyncOutcome {
        switch error {
        case .transport(_, true):
            publish(status: .offline, error: "offline")
            return .offline
        case .notAuthenticated:
            authBlocked = true
            publish(status: .authRequired, error: "not_authenticated")
            return .authRequired
        case .server(let status, let code, _, _, let retryAfter):
            if status == 401 || code == "password_change_required" {
                authBlocked = true
                publish(status: .authRequired, error: code)
                return .authRequired
            }
            publish(status: .serverError(code), error: "\(context): \(status) \(code)")
            return .failed(retryAfter: status == 429 ? (retryAfter ?? 30) : retryAfter)
        case .transport(let code, false):
            publish(status: .serverError("transport"), error: "\(context): transport \(code)")
            return .failed(retryAfter: nil)
        case .decoding(let message):
            publish(status: .serverError("decoding"), error: message)
            return .failed(retryAfter: nil)
        }
    }

    // MARK: Status

    private func publishSettled() {
        let pending = (try? store.pendingCount()) ?? 0
        publish(status: pending == 0 ? .synced : .pending, error: nil)
    }

    private func publish(status: SyncStatus, error: String? = nil) {
        snapshot.status = status
        snapshot.pendingCount = (try? store.pendingCount()) ?? snapshot.pendingCount
        snapshot.lastServerAck = (try? store.lastServerAck()) ?? snapshot.lastServerAck
        if status == .synced || status == .pending || status == .syncing {
            if error == nil && status != .syncing { snapshot.lastError = nil }
        } else if let error {
            snapshot.lastError = error
        }
        snapshot.consecutiveFailures = failures
        snapshots.send(snapshot)
    }
}
