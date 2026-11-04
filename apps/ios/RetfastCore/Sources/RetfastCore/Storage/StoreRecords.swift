import Foundation
import GRDB

/// Sync state of one stored sample.
public enum SampleSyncState: Int, Codable, Sendable, DatabaseValueConvertible {
    /// Not yet acknowledged by the server. Never deleted.
    case pending = 0
    /// Server acknowledged (accepted or duplicate) — durable in PostgreSQL.
    case synced = 1
    /// Server permanently rejected it. Kept locally, never retried.
    case rejected = 2
}

extension FlightSessionState: DatabaseValueConvertible {}

/// One accepted GPS sample, persisted before any network use.
public struct TelemetrySample: Codable, Sendable, Equatable, Identifiable, FetchableRecord, PersistableRecord {
    public static let databaseTableName = "sample"

    public var id: UUID
    public var flightId: UUID
    public var seq: Int
    /// GPS (Core Location) timestamp.
    public var t: Date
    /// Device clock when the fix was received.
    public var deviceT: Date
    public var lat: Double
    public var lon: Double
    /// Core Location `altitude` (raw; nil if vertical accuracy invalid).
    public var altitude: Double?
    public var ellipsoidalAltitude: Double?
    public var hAcc: Double
    public var vAcc: Double?
    public var speed: Double?
    public var course: Double?
    public var floor: Int?
    public var profile: String
    public var battery: Double?
    public var lowPower: Bool
    public var lowQuality: Bool
    public var isSimulatedBySoftware: Bool
    public var syncState: SampleSyncState
    public var rejectReason: String?
    /// Batch the sample is currently assigned to (immutable while assigned, so a
    /// retried batch_id always carries exactly the same samples).
    public var batchId: UUID?

    public init(id: UUID = UUID(), flightId: UUID, seq: Int, t: Date, deviceT: Date, lat: Double, lon: Double,
                altitude: Double?, ellipsoidalAltitude: Double? = nil, hAcc: Double, vAcc: Double?, speed: Double?,
                course: Double?, floor: Int? = nil, profile: String, battery: Double?, lowPower: Bool,
                lowQuality: Bool, isSimulatedBySoftware: Bool = false, syncState: SampleSyncState = .pending,
                rejectReason: String? = nil, batchId: UUID? = nil) {
        self.id = id; self.flightId = flightId; self.seq = seq; self.t = t; self.deviceT = deviceT
        self.lat = lat; self.lon = lon; self.altitude = altitude; self.ellipsoidalAltitude = ellipsoidalAltitude
        self.hAcc = hAcc; self.vAcc = vAcc; self.speed = speed; self.course = course; self.floor = floor
        self.profile = profile; self.battery = battery; self.lowPower = lowPower; self.lowQuality = lowQuality
        self.isSimulatedBySoftware = isSimulatedBySoftware; self.syncState = syncState
        self.rejectReason = rejectReason; self.batchId = batchId
    }
}

/// Fields a recorder supplies; the store assigns `id` and `seq`.
public struct NewSample: Sendable, Equatable {
    public var raw: RawLocation
    public var deviceT: Date
    public var profile: TrackingProfile
    public var conditions: DeviceConditions
    public var lowQuality: Bool

    public init(raw: RawLocation, deviceT: Date, profile: TrackingProfile, conditions: DeviceConditions, lowQuality: Bool) {
        self.raw = raw; self.deviceT = deviceT; self.profile = profile; self.conditions = conditions; self.lowQuality = lowQuality
    }
}

/// Local flight record. Exists before the server knows about the flight.
public struct LocalFlight: Codable, Sendable, Equatable, Identifiable, FetchableRecord, PersistableRecord {
    public static let databaseTableName = "flight"

    public var id: UUID
    public var eventId: UUID?
    public var eventName: String?
    public var visibility: String
    public var isSimulated: Bool
    public var startedAt: Date
    public var endedAt: Date?
    public var state: FlightSessionState
    public var serverCreated: Bool
    public var serverEnded: Bool
    /// Next sequence number to assign; persisted so seq stays monotonic across relaunches.
    public var nextSeq: Int
    public var lastSampleAt: Date?
    public var profile: String
    /// Number of times recording resumed after an OS/user interruption.
    public var interruptionCount: Int
    public var lastError: String?
    public var createdAt: Date
    public var updatedAt: Date

    public init(id: UUID = UUID(), eventId: UUID?, eventName: String?, visibility: String, isSimulated: Bool,
                startedAt: Date, state: FlightSessionState = .preparing, profile: TrackingProfile = .preFlight) {
        self.id = id; self.eventId = eventId; self.eventName = eventName; self.visibility = visibility
        self.isSimulated = isSimulated; self.startedAt = startedAt; self.endedAt = nil; self.state = state
        self.serverCreated = false; self.serverEnded = false; self.nextSeq = 0; self.lastSampleAt = nil
        self.profile = profile.rawValue; self.interruptionCount = 0; self.lastError = nil
        self.createdAt = startedAt; self.updatedAt = startedAt
    }
}

/// Outbound batch with retry metadata. `id` is the `batch_id` sent to the server
/// and is reused verbatim on every retry.
public struct OutboxBatch: Codable, Sendable, Equatable, FetchableRecord, PersistableRecord {
    public static let databaseTableName = "outbox_batch"
    public var id: UUID
    public var flightId: UUID
    public var createdAt: Date
    public var attemptCount: Int
    public var lastAttemptAt: Date?
    public var lastError: String?
}

public struct PreparedBatch: Sendable, Equatable {
    public var batch: OutboxBatch
    public var samples: [TelemetrySample]
}

/// Locally persisted SOS. See `EmergencyManager` for the state ladder.
public struct LocalIncident: Codable, Sendable, Equatable, Identifiable, FetchableRecord, PersistableRecord {
    public static let databaseTableName = "incident"

    public var id: UUID
    public var flightId: UUID?
    public var eventId: UUID?
    public var isTest: Bool
    public var lat: Double?
    public var lon: Double?
    public var altitude: Double?
    public var hAcc: Double?
    public var positionTime: Date?
    public var message: String
    public var createdAtDevice: Date
    public var deliveryState: SOSDeliveryState
    public var serverStatus: String?
    public var receivedAt: Date?
    public var acknowledgedAt: Date?
    public var acknowledgedByName: String?
    public var cancelRequested: Bool
    public var cancelSynced: Bool
    public var attemptCount: Int
    public var lastAttemptAt: Date?
    public var lastError: String?
    public var updatedAt: Date
}

/// A record of the database being found damaged and replaced.
public struct StoreRecoveryEvent: Codable, Sendable, Equatable {
    public var occurredAt: Date
    public var reason: String
    /// Where the damaged file was moved (kept for support/forensics).
    public var quarantinedPath: String
}
