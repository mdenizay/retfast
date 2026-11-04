import Foundation
import GRDB
import os

/// Client-side SOS delivery ladder (api-contract.md, "Incidents"):
/// created_locally → pending_transmission → received_by_server → acknowledged.
/// The UI must never say help is coming before `acknowledged`.
public enum SOSDeliveryState: String, Codable, Sendable, CaseIterable, DatabaseValueConvertible {
    /// Saved on this phone only.
    case createdLocally = "created_locally"
    /// Being sent / retried. The server has not confirmed receipt.
    case pendingTransmission = "pending_transmission"
    /// HTTP 2xx from POST /incidents. Stored on the server, not yet seen by a person.
    case receivedByServer = "received_by_server"
    /// A responder acknowledged it (`acknowledged_at` set).
    case acknowledged
    /// Server reports it resolved.
    case resolved
    /// Cancelled by the pilot (server confirmed, or never left the phone).
    case cancelled
    /// The server permanently refused it (e.g. test SOS outside a test-enabled event).
    case refused

    /// Position on the ladder; state only ever moves forward.
    public var rank: Int {
        switch self {
        case .createdLocally: 0
        case .pendingTransmission: 1
        case .receivedByServer: 2
        case .acknowledged: 3
        case .resolved, .cancelled, .refused: 4
        }
    }

    public var isTerminal: Bool { rank == 4 }
}

public actor EmergencyManager {
    private let store: LocalTelemetryStore
    private let api: APIClient
    private let clock: any SyncClock
    private let backoff: Backoff
    public let pollInterval: Double

    /// Latest state of every incident touched in this run (for the SOS screen).
    public nonisolated let updates = Broadcaster<LocalIncident>()
    /// True while any non-test or test SOS is open — drives the emergency profile.
    public nonisolated let activeEmergency = Broadcaster<Bool>(initial: false)
    private var loops: [UUID: Task<Void, Never>] = [:]
    private var failures: [UUID: Int] = [:]

    private static let log = Logger(subsystem: "com.mizibu.retfast", category: "sos")

    public init(store: LocalTelemetryStore, api: APIClient, clock: any SyncClock = SystemClock(),
                backoff: Backoff = Backoff(base: 2, cap: 30), pollInterval: Double = 10) {
        self.store = store
        self.api = api
        self.clock = clock
        self.backoff = backoff
        self.pollInterval = pollInterval
    }

    /// Persist the SOS locally first (synchronously), then start delivery.
    @discardableResult
    public func trigger(position: IncidentPosition?, flightId: UUID?, eventId: UUID?, isTest: Bool,
                        message: String = "", startDelivery: Bool = true) throws -> LocalIncident {
        let now = clock.now()
        let incident = LocalIncident(
            id: UUID(), flightId: flightId, eventId: eventId, isTest: isTest,
            lat: position?.lat, lon: position?.lon, altitude: position?.gpsAltM, hAcc: position?.hAccM,
            positionTime: position?.t, message: message, createdAtDevice: now,
            deliveryState: .createdLocally, serverStatus: nil, receivedAt: nil, acknowledgedAt: nil,
            acknowledgedByName: nil, cancelRequested: false, cancelSynced: false, attemptCount: 0,
            lastAttemptAt: nil, lastError: nil, updatedAt: now)
        try store.saveIncident(incident)
        Self.log.notice("SOS created locally id=\(incident.id.uuidString, privacy: .public) test=\(isTest)")
        updates.send(incident)
        refreshActiveFlag()
        if startDelivery { startLoop(incident.id) }
        return incident
    }

    /// Pilot cancels. If the SOS never left the phone it is cancelled locally;
    /// otherwise the server is told (and the request is retried until it is).
    public func cancel(id: UUID, startDelivery: Bool = true) throws {
        guard var incident = try store.incident(id: id), !incident.isTerminal else { return }
        incident.cancelRequested = true
        if incident.attemptCount == 0 && incident.deliveryState.rank < SOSDeliveryState.receivedByServer.rank {
            incident.deliveryState = .cancelled
            incident.cancelSynced = true
        }
        incident.updatedAt = clock.now()
        try store.saveIncident(incident)
        updates.send(incident)
        refreshActiveFlag()
        if incident.isTerminal { loops[id]?.cancel(); loops[id] = nil } else if startDelivery { startLoop(id) }
    }

    /// On launch: resume delivery/polling for anything not finished.
    public func resumeAll() throws {
        for incident in try store.incidents(limit: 100) where !incident.isTerminal {
            updates.send(incident)
            startLoop(incident.id)
        }
        refreshActiveFlag()
    }

    public func incident(id: UUID) -> LocalIncident? { try? store.incident(id: id) }

    private func startLoop(_ id: UUID) {
        if let existing = loops[id] { existing.cancel() }
        loops[id] = Task { await self.run(id, maxSteps: nil) }
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

    /// Performs one action for the incident. Returns the delay before the next
    /// step, or nil when nothing more is needed.
    public func step(_ id: UUID) async -> Double? {
        guard var incident = try? store.incident(id: id) else { return nil }
        if incident.isTerminal { refreshActiveFlag(); return nil }
        let wireId = id.uuidString.lowercased()

        do {
            if incident.deliveryState.rank < SOSDeliveryState.receivedByServer.rank {
                if incident.deliveryState == .createdLocally {
                    incident.deliveryState = .pendingTransmission
                }
                incident.attemptCount += 1
                incident.lastAttemptAt = clock.now()
                save(&incident)
                let position = incident.lat.flatMap { lat in incident.lon.map { lon in
                    IncidentPosition(lat: lat, lon: lon, gpsAltM: incident.altitude, hAccM: incident.hAcc, t: incident.positionTime)
                } }
                let server = try await api.createIncident(CreateIncidentRequest(
                    id: wireId, isTest: incident.isTest, flightId: incident.flightId?.uuidString.lowercased(),
                    position: position, message: incident.message.isEmpty ? nil : incident.message,
                    createdAtDevice: incident.createdAtDevice))
                incident.lastError = nil
                apply(server, to: &incident, receivedFallback: clock.now())
                failures[id] = 0
                save(&incident)
                return incident.isTerminal ? nil : (incident.cancelRequested ? 0 : pollInterval)
            }

            if incident.cancelRequested && !incident.cancelSynced {
                try await api.cancelIncident(wireId, reason: nil)
                incident.cancelSynced = true
                incident.deliveryState = .cancelled
                incident.serverStatus = "cancelled"
                save(&incident)
                refreshActiveFlag()
                return nil
            }

            let server = try await api.incident(wireId)
            apply(server, to: &incident, receivedFallback: nil)
            incident.lastError = nil
            failures[id] = 0
            save(&incident)
            return incident.isTerminal ? nil : pollInterval
        } catch let error as APIError {
            incident.lastError = error.code ?? (error.isOffline ? "offline" : "transport")
            if let status = error.status, [400, 403, 409, 422].contains(status), !error.isPasswordChangeRequired,
               incident.deliveryState.rank < SOSDeliveryState.receivedByServer.rank {
                incident.deliveryState = .refused
                save(&incident)
                refreshActiveFlag()
                return nil
            }
            save(&incident)
            let attempt = failures[id, default: 0]
            failures[id] = attempt + 1
            if incident.deliveryState.rank >= SOSDeliveryState.receivedByServer.rank {
                return pollInterval
            }
            return error.status == 429 ? max(backoff.delay(attempt: attempt), 5) : backoff.delay(attempt: attempt)
        } catch {
            incident.lastError = String(describing: error)
            save(&incident)
            let attempt = failures[id, default: 0]
            failures[id] = attempt + 1
            return backoff.delay(attempt: attempt)
        }
    }

    private func apply(_ server: Incident, to incident: inout LocalIncident, receivedFallback: Date?) {
        incident.serverStatus = server.status
        if incident.receivedAt == nil { incident.receivedAt = server.receivedAt ?? receivedFallback }
        var target: SOSDeliveryState = .receivedByServer
        if server.acknowledgedAt != nil || ["acknowledged", "responding"].contains(server.status) {
            target = .acknowledged
            incident.acknowledgedAt = server.acknowledgedAt ?? incident.acknowledgedAt ?? clock.now()
            incident.acknowledgedByName = server.acknowledgedBy?.fullName ?? incident.acknowledgedByName
        }
        if server.status == "resolved" { target = .resolved }
        if server.status == "cancelled" { target = .cancelled; incident.cancelSynced = true }
        if target.rank >= incident.deliveryState.rank { incident.deliveryState = target }
    }

    private func save(_ incident: inout LocalIncident) {
        incident.updatedAt = clock.now()
        try? store.saveIncident(incident)
        updates.send(incident)
    }

    private func refreshActiveFlag() {
        let active = ((try? store.incidents(limit: 20)) ?? []).contains { !$0.isTerminal && !$0.cancelRequested }
        activeEmergency.send(active)
    }
}

extension LocalIncident {
    public var isTerminal: Bool { deliveryState.isTerminal }
}
