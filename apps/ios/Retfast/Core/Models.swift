import Foundation

// Codable mirrors of the Supabase schema (supabase/migrations/0001_schema.sql).
// Dates arrive as ISO-8601 strings; the shared decoder below handles the
// fractional-seconds variants Postgres emits.

enum EventRole: String, Codable, CaseIterable, Identifiable {
    case pilot, retriever, observer
    case eventAdmin = "event_admin"
    var id: String { rawValue }
}

enum TaskStatus: String, Codable {
    case active, landed, completed, cancelled
}

enum RetrieverAvailability: String, Codable {
    case offline, available, busy
}

enum RetrievalRequestStatus: String, Codable {
    case pending, accepted, declined, expired, cancelled
}

enum AssignmentStatus: String, Codable {
    case assigned, enRoute = "en_route", pickedUp = "picked_up"
    case delivered, completed, cancelled
}

struct Profile: Codable, Identifiable, Hashable {
    let id: UUID
    var displayName: String
    var locale: String
    var isSystemAdmin: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
        case locale
        case isSystemAdmin = "is_system_admin"
    }
}

struct EventRow: Codable, Identifiable, Hashable {
    let id: UUID
    var name: String
    var description: String
    var startsAt: Date
    var endsAt: Date
    var visibility: String
    var isArchived: Bool

    enum CodingKeys: String, CodingKey {
        case id, name, description, visibility
        case startsAt = "starts_at"
        case endsAt = "ends_at"
        case isArchived = "is_archived"
    }
}

struct GeoZone: Codable, Identifiable, Hashable {
    let id: UUID
    var name: String
    var zoneType: String
    /// Raw GeoJSON geometry object, rendered via MKGeoJSONDecoder.
    var geometry: JSONValue

    enum CodingKeys: String, CodingKey {
        case id, name, geometry
        case zoneType = "zone_type"
    }
}

struct TaskRow: Codable, Identifiable, Hashable {
    let id: UUID
    let eventId: UUID
    let pilotId: UUID
    var title: String
    var status: TaskStatus
    var startedAt: Date
    var landedAt: Date?
    var finishedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, title, status
        case eventId = "event_id"
        case pilotId = "pilot_id"
        case startedAt = "started_at"
        case landedAt = "landed_at"
        case finishedAt = "finished_at"
    }
}

struct RetrieverSession: Codable, Identifiable {
    let id: UUID
    let eventId: UUID

    enum CodingKeys: String, CodingKey {
        case id
        case eventId = "event_id"
    }
}

struct RetrievalRequestRow: Codable, Identifiable, Hashable {
    let id: UUID
    let eventId: UUID
    let taskId: UUID
    let pilotId: UUID
    let retrieverId: UUID
    var status: RetrievalRequestStatus
    var expiresAt: Date

    enum CodingKeys: String, CodingKey {
        case id, status
        case eventId = "event_id"
        case taskId = "task_id"
        case pilotId = "pilot_id"
        case retrieverId = "retriever_id"
        case expiresAt = "expires_at"
    }
}

struct RetrievalAssignmentRow: Codable, Identifiable, Hashable {
    let id: UUID
    let eventId: UUID
    let taskId: UUID
    let pilotId: UUID
    let retrieverId: UUID
    var status: AssignmentStatus

    enum CodingKeys: String, CodingKey {
        case id, status
        case eventId = "event_id"
        case taskId = "task_id"
        case pilotId = "pilot_id"
        case retrieverId = "retriever_id"
    }
}

struct NearbyRetriever: Codable, Identifiable, Hashable {
    let userId: UUID
    let displayName: String
    let vehicleCapacity: Int
    let occupiedSeats: Int
    let vehicleDescription: String
    let distanceM: Double
    let lat: Double
    let lng: Double

    var id: UUID { userId }

    enum CodingKeys: String, CodingKey {
        case lat, lng
        case userId = "user_id"
        case displayName = "display_name"
        case vehicleCapacity = "vehicle_capacity"
        case occupiedSeats = "occupied_seats"
        case vehicleDescription = "vehicle_description"
        case distanceM = "distance_m"
    }
}

struct TrackPoint: Codable, Hashable {
    let recordedAt: Date
    let lat: Double
    let lng: Double
    let altitudeM: Double?
    let speedMps: Double?

    enum CodingKeys: String, CodingKey {
        case lat, lng
        case recordedAt = "recorded_at"
        case altitudeM = "altitude_m"
        case speedMps = "speed_mps"
    }
}

struct TaskTrack: Codable {
    let points: [TrackPoint]
    let stats: Stats

    struct Stats: Codable {
        let pointCount: Int
        let distanceM: Double
        let maxAltitudeM: Double?
        let maxSpeedMps: Double?

        enum CodingKeys: String, CodingKey {
            case pointCount = "point_count"
            case distanceM = "distance_m"
            case maxAltitudeM = "max_altitude_m"
            case maxSpeedMps = "max_speed_mps"
        }
    }
}

/// Minimal JSON value for passing GeoJSON through Codable untouched.
enum JSONValue: Codable, Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }

    var jsonData: Data {
        (try? JSONEncoder().encode(self)) ?? Data("null".utf8)
    }
}
