import Foundation
import GRDB

/// Server-side retrieval status (api-contract.md "Retrievals").
///
///     requested ──accept──▶ accepted ──picked-up──▶ picked_up ──delivered──▶ delivered
///         ▲                    │
///         └──────release───────┘          any open ──cancel──▶ cancelled
public enum RetrievalStatus: String, Codable, Sendable, CaseIterable {
    case requested
    case accepted
    case pickedUp = "picked_up"
    case delivered
    case cancelled

    public var isOpen: Bool { self == .requested || self == .accepted || self == .pickedUp }
    public var isTerminal: Bool { !isOpen }

    /// The open statuses, as sent in `?status=`.
    public static let openRaw = ["requested", "accepted", "picked_up"]
}

/// Delivery state of the *request itself* from this phone to the server.
/// The request is written to SQLite first (like telemetry) and retried until
/// the server confirms it.
public enum RetrievalOutboxState: String, Codable, Sendable, DatabaseValueConvertible {
    /// Saved on this phone; the server has not confirmed it yet.
    case pending
    /// The server has it (201/200 on the idempotent client id).
    case sent
    /// Permanently refused (400/403/404/422), e.g. no longer a pilot of the event.
    case refused
    /// The server already had another open request of this pilot (409); this
    /// local request was folded into that one (`mergedInto`).
    case merged
}

/// Locally persisted retrieval request (pilot side). Holds the outbox state
/// and the last server copy, so the waiting screen is restored after a relaunch.
public struct LocalRetrieval: Codable, Sendable, Equatable, Identifiable, FetchableRecord, PersistableRecord {
    public static let databaseTableName = "retrieval"

    /// Client-generated id; the server's retrieval id (idempotent create).
    public var id: UUID
    public var eventId: String
    public var eventName: String?
    public var flightId: UUID?
    public var pickupLat: Double
    public var pickupLon: Double
    public var pickupAlt: Double?
    public var pickupHAcc: Double?
    public var pickupT: Date
    public var note: String
    public var createdAt: Date
    public var outbox: RetrievalOutboxState
    public var attemptCount: Int
    public var lastAttemptAt: Date?
    public var lastError: String?
    /// Last status the server reported (`RetrievalStatus` raw value).
    public var serverStatus: String?
    /// Last full server copy (JSON), for retriever name/phone/position.
    public var serverJSON: String?
    public var cancelRequested: Bool
    public var cancelReason: String?
    public var cancelSynced: Bool
    public var mergedInto: String?
    public var updatedAt: Date

    public init(id: UUID = UUID(), eventId: String, eventName: String?, flightId: UUID?, pickup: SharedPosition,
                note: String, createdAt: Date) {
        self.id = id; self.eventId = eventId; self.eventName = eventName; self.flightId = flightId
        pickupLat = pickup.lat; pickupLon = pickup.lon; pickupAlt = pickup.gpsAltM; pickupHAcc = pickup.hAccM
        pickupT = pickup.t ?? createdAt
        self.note = note; self.createdAt = createdAt
        outbox = .pending; attemptCount = 0; lastAttemptAt = nil; lastError = nil
        serverStatus = nil; serverJSON = nil
        cancelRequested = false; cancelReason = nil; cancelSynced = false; mergedInto = nil
        updatedAt = createdAt
    }

    public var wireId: String { id.uuidString.lowercased() }
    public var status: RetrievalStatus? { serverStatus.flatMap(RetrievalStatus.init(rawValue:)) }

    public var pickup: SharedPosition {
        SharedPosition(lat: pickupLat, lon: pickupLon, gpsAltM: pickupAlt, hAccM: pickupHAcc, t: pickupT)
    }

    /// Last server copy, decoded.
    public var server: Retrieval? {
        guard let serverJSON else { return nil }
        return try? JSONCoding.makeDecoder().decode(Retrieval.self, from: Data(serverJSON.utf8))
    }

    /// Nothing more will happen to this request.
    public var isTerminal: Bool {
        switch outbox {
        case .refused, .merged: return true
        case .pending: return cancelSynced
        case .sent: return (status?.isTerminal ?? false) && (!cancelRequested || cancelSynced)
        }
    }

    public var stage: RetrievalStage { RetrievalStage(self) }
}

/// What the pilot's waiting screen shows. Derived purely from `LocalRetrieval`
/// (tested); the UI never invents progress the server has not reported.
public enum RetrievalStage: Sendable, Equatable {
    /// On the phone only; no send attempt yet.
    case savedLocally
    /// Being sent / retried; not confirmed by the server.
    case sending
    /// Server has it; waiting for a retriever to accept.
    case requested
    case accepted
    case pickedUp
    case delivered
    /// Pilot cancelled; the server has not confirmed yet.
    case cancelling
    case cancelled
    /// The server refused the request (reason in `lastError`).
    case refused
    /// Folded into another open request of the same pilot.
    case merged

    public init(_ r: LocalRetrieval) {
        switch r.outbox {
        case .refused: self = .refused; return
        case .merged: self = .merged; return
        case .pending:
            if r.cancelSynced { self = .cancelled; return }
            if r.cancelRequested { self = .cancelling; return }
            self = r.attemptCount == 0 ? .savedLocally : .sending
            return
        case .sent:
            break
        }
        if r.cancelRequested && !r.cancelSynced && r.status?.isOpen != false { self = .cancelling; return }
        switch r.status {
        case .requested, nil: self = .requested
        case .accepted: self = .accepted
        case .pickedUp: self = .pickedUp
        case .delivered: self = .delivered
        case .cancelled: self = .cancelled
        }
    }

    /// Index on the 4-step ladder Requested → Accepted → Picked up → Delivered
    /// of the last step the server has confirmed; nil if none (not yet sent,
    /// cancelled or refused).
    public var confirmedStep: Int? {
        switch self {
        case .requested: 0
        case .accepted: 1
        case .pickedUp: 2
        case .delivered: 3
        default: nil
        }
    }

    /// The pilot keeps sharing their position while they wait (≈ every 30 s):
    /// until a retriever picked them up, or the request ended.
    public var sharesPilotPosition: Bool { self == .requested || self == .accepted }

    public var isFinished: Bool {
        switch self {
        case .delivered, .cancelled, .refused, .merged: true
        default: false
        }
    }
}

extension LocalTelemetryStore {
    public func saveRetrieval(_ r: LocalRetrieval) throws {
        try writer.write { db in try r.save(db) }
    }

    public func retrieval(id: UUID) throws -> LocalRetrieval? {
        try writer.read { db in try LocalRetrieval.fetchOne(db, key: id) }
    }

    public func retrievals(limit: Int = 50) throws -> [LocalRetrieval] {
        try writer.read { db in try LocalRetrieval.order(Column("createdAt").desc).limit(limit).fetchAll(db) }
    }
}
