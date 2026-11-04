import Foundation

// DTOs for docs/architecture/api-contract.md (v1). Field names are converted
// to/from snake_case by `JSONCoding`. Everything the contract marks nullable or
// that may be added later is optional so a newer server never breaks decoding.

public enum JSONCoding {
    public static func makeEncoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        e.dateEncodingStrategy = .custom { date, encoder in
            var c = encoder.singleValueContainer()
            try c.encode(formatDate(date))
        }
        return e
    }

    public static func makeDecoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        d.dateDecodingStrategy = .custom { decoder in
            let c = try decoder.singleValueContainer()
            let s = try c.decode(String.self)
            guard let date = parseDate(s) else {
                throw DecodingError.dataCorruptedError(in: c, debugDescription: "Invalid RFC 3339 date: \(s)")
            }
            return date
        }
        return d
    }

    /// RFC 3339 UTC with milliseconds, e.g. 2026-11-04T12:00:00.123Z.
    public static func formatDate(_ date: Date) -> String {
        date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true, timeZone: .gmt))
    }

    public static func parseDate(_ s: String) -> Date? {
        if let d = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(s) { return d }
        if let d = try? Date.ISO8601FormatStyle().parse(s) { return d }
        // Offsets other than Z, or more than 3 fractional digits.
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }
}

// MARK: Errors

public struct APIErrorBody: Codable, Sendable, Equatable {
    public struct Inner: Codable, Sendable, Equatable {
        public var code: String
        public var message: String?
        public var details: [String: String]?
    }
    public var error: Inner
}

// MARK: Auth & me

public struct AuthResponse: Codable, Sendable, Equatable {
    public var accessToken: String
    public var accessExpiresAt: Date?
    public var refreshToken: String?
    public var refreshExpiresAt: Date?
    public var user: Me
}

public struct Me: Codable, Sendable, Equatable {
    public var id: String
    public var email: String
    public var emailVerified: Bool?
    public var fullName: String
    public var roles: [String]
    public var mustChangePassword: Bool
    public var createdAt: Date?
    public var pilot: PilotProfile?
    public var preferences: Preferences?

    public var isRescueCapable: Bool {
        roles.contains("rescue_operator") || roles.contains("platform_admin")
    }
}

public struct PilotProfile: Codable, Sendable, Equatable {
    public var publicId: String?
    public var displayName: String?
    public var bio: String?
    public var wing: String?
    public var licenseNo: String?
    public var nationality: String?
    public var emergencyContactName: String?
    public var emergencyContactPhone: String?
    public var bloodType: String?

    public init(publicId: String? = nil, displayName: String? = nil, bio: String? = nil, wing: String? = nil,
                licenseNo: String? = nil, nationality: String? = nil, emergencyContactName: String? = nil,
                emergencyContactPhone: String? = nil, bloodType: String? = nil) {
        self.publicId = publicId; self.displayName = displayName; self.bio = bio; self.wing = wing
        self.licenseNo = licenseNo; self.nationality = nationality; self.emergencyContactName = emergencyContactName
        self.emergencyContactPhone = emergencyContactPhone; self.bloodType = bloodType
    }
}

public struct Preferences: Codable, Sendable, Equatable {
    public var units: String?
    public var defaultFlightVisibility: String?
    public var publicProfile: Bool?

    public init(units: String? = nil, defaultFlightVisibility: String? = nil, publicProfile: Bool? = nil) {
        self.units = units; self.defaultFlightVisibility = defaultFlightVisibility; self.publicProfile = publicProfile
    }
}

public struct DeletionRequestStatus: Codable, Sendable, Equatable {
    public var status: String
    public var requestedAt: Date?
}

// MARK: Events

public struct LatLon: Codable, Sendable, Equatable, Hashable {
    public var lat: Double
    public var lon: Double
    public init(lat: Double, lon: Double) { self.lat = lat; self.lon = lon }
}

public struct EventSettings: Codable, Sendable, Equatable {
    public var registrationOpen: Bool?
    public var liveTracking: Bool?
    public var flightRecording: Bool?
    public var observersAllowed: Bool?
    public var emergencyTesting: Bool?
    public var publicLiveMap: Bool?
}

public struct PersonRef: Codable, Sendable, Equatable, Hashable {
    public var id: String?
    public var userId: String?
    public var fullName: String?
    public var publicId: String?
}

public struct Event: Codable, Sendable, Equatable, Identifiable, Hashable {
    public var id: String
    public var slug: String?
    public var name: String
    public var description: String?
    public var kind: String?
    public var status: String
    public var isDemo: Bool?
    public var visibility: String?
    public var locationName: String?
    public var center: LatLon?
    public var centerIsApproximate: Bool?
    public var startsAt: Date?
    public var endsAt: Date?
    public var coverImageUrl: String?
    public var settings: EventSettings?
    public var organizer: PersonRef?
    public var participantCount: Int?
    public var myRole: String?
    public var createdAt: Date?
    public var updatedAt: Date?

    public static func == (a: Event, b: Event) -> Bool { a.id == b.id && a.updatedAt == b.updatedAt && a.myRole == b.myRole }
    public func hash(into h: inout Hasher) { h.combine(id) }
}

public struct LaunchSite: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var eventId: String?
    public var name: String
    public var position: LatLon?
    public var elevationM: Double?
    public var notes: String?
    public var isVerified: Bool?
}

public struct Participant: Codable, Sendable, Equatable, Identifiable {
    public var userId: String
    public var fullName: String?
    public var publicId: String?
    public var role: String
    public var status: String?
    public var joinedAt: Date?
    public var id: String { userId }
}

public struct ItemsResponse<T: Codable & Sendable>: Codable, Sendable {
    public var items: [T]
    public var nextCursor: String?
}

// MARK: Flights

public struct FlightStats: Codable, Sendable, Equatable {
    public var durationS: Double?
    public var distanceM: Double?
    public var maxGpsAltM: Double?
    public var minGpsAltM: Double?
    public var maxGroundSpeedMs: Double?
    public var totalAscentM: Double?
    public var totalDescentM: Double?
    public var sampleCount: Int?
    public var expectedSampleCount: Int?
    public var gapCount: Int?
}

public struct Position: Codable, Sendable, Equatable, Identifiable {
    public var id: String?
    public var seq: Int?
    public var t: Date
    public var receivedAt: Date?
    public var lat: Double
    public var lon: Double
    public var gpsAltM: Double?
    public var hAccM: Double?
    public var vAccM: Double?
    public var speedMs: Double?
    public var courseDeg: Double?
}

public struct DeviceInfo: Codable, Sendable, Equatable {
    public var platform: String
    public var appVersion: String?
    public var osVersion: String?
    public init(platform: String = "ios", appVersion: String?, osVersion: String?) {
        self.platform = platform; self.appVersion = appVersion; self.osVersion = osVersion
    }
}

public struct Flight: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var publicId: String?
    public var pilot: PersonRef?
    public var eventId: String?
    public var status: String
    public var visibility: String?
    public var isSimulated: Bool?
    public var startedAt: Date?
    public var endedAt: Date?
    public var lastPosition: Position?
    public var lastReceivedAt: Date?
    public var stats: FlightStats?
}

public struct CreateFlightRequest: Codable, Sendable, Equatable {
    public var id: String
    public var eventId: String?
    public var startedAt: Date
    public var visibility: String
    public var isSimulated: Bool
    public var device: DeviceInfo
}

public struct EndFlightRequest: Codable, Sendable, Equatable {
    public var endedAt: Date
}

// MARK: Telemetry

public struct SampleMeta: Codable, Sendable, Equatable {
    public var profile: String
    public var battery: Double?
    public var lowPower: Bool
    // Extra keys beyond the contract example; the server stores meta as given.
    public var lowQuality: Bool?
    public var floor: Int?
    public var ellipsoidalAltM: Double?
}

public struct TelemetrySampleDTO: Codable, Sendable, Equatable {
    public var id: String
    public var seq: Int
    public var t: Date
    public var deviceT: Date
    public var lat: Double
    public var lon: Double
    public var gpsAltM: Double?
    public var hAccM: Double
    public var vAccM: Double?
    public var speedMs: Double?
    public var courseDeg: Double?
    public var meta: SampleMeta

    public init(_ s: TelemetrySample) {
        id = s.id.uuidString.lowercased(); seq = s.seq; t = s.t; deviceT = s.deviceT
        lat = s.lat; lon = s.lon; gpsAltM = s.altitude; hAccM = s.hAcc; vAccM = s.vAcc
        speedMs = s.speed; courseDeg = s.course
        meta = SampleMeta(profile: s.profile, battery: s.battery, lowPower: s.lowPower,
                          lowQuality: s.lowQuality ? true : nil, floor: s.floor, ellipsoidalAltM: s.ellipsoidalAltitude)
    }
}

public struct TelemetryBatchRequest: Codable, Sendable, Equatable {
    public var batchId: String
    public var flightId: String
    public var samples: [TelemetrySampleDTO]
}

public struct TelemetryBatchResponse: Codable, Sendable, Equatable {
    public struct Rejected: Codable, Sendable, Equatable {
        public var seq: Int
        public var reason: String
    }
    public var batchId: String
    public var accepted: [Int]
    public var duplicate: [Int]
    public var rejected: [Rejected]
    public var maxAckedSeq: Int?
    public var serverTime: Date?
}

// MARK: Live

public struct LivePilot: Codable, Sendable, Equatable, Identifiable {
    public var flightId: String
    public var pilot: PersonRef?
    public var isSimulated: Bool?
    public var status: String?
    public var position: Position?
    public var ageS: Double?
    public var freshness: String?
    /// [[lon, lat, gps_alt_m|null, t_unix_ms], ...]
    public var trail: [[Double?]]?
    public var id: String { flightId }
}

public struct LiveSnapshot: Codable, Sendable, Equatable {
    public var eventId: String?
    public var serverTime: Date?
    public var cursor: String?
    public var pilots: [LivePilot]
}

// MARK: Incidents

public struct IncidentPosition: Codable, Sendable, Equatable {
    public var lat: Double
    public var lon: Double
    public var gpsAltM: Double?
    public var hAccM: Double?
    public var t: Date?
    public init(lat: Double, lon: Double, gpsAltM: Double?, hAccM: Double?, t: Date?) {
        self.lat = lat; self.lon = lon; self.gpsAltM = gpsAltM; self.hAccM = hAccM; self.t = t
    }
}

public struct IncidentPilot: Codable, Sendable, Equatable {
    public var userId: String?
    public var fullName: String?
    public var publicId: String?
    public var emergencyContactName: String?
    public var emergencyContactPhone: String?
    public var bloodType: String?
}

public struct IncidentUpdate: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var kind: String
    public var actor: PersonRef?
    public var body: String?
    public var status: String?
    public var createdAt: Date?
}

public struct AssignmentPosition: Codable, Sendable, Equatable {
    public var lat: Double
    public var lon: Double
    public var t: Date?
}

public struct Assignment: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var incidentId: String?
    public var responder: PersonRef?
    public var status: String
    public var assignedAt: Date?
    public var updatedAt: Date?
    public var lastPosition: AssignmentPosition?
}

public struct Incident: Codable, Sendable, Equatable, Identifiable, Hashable {
    public func hash(into h: inout Hasher) { h.combine(id) }
    public var id: String
    public var kind: String?
    public var isTest: Bool?
    public var status: String
    public var pilot: IncidentPilot?
    public var flightId: String?
    public var eventId: String?
    public var position: IncidentPosition?
    public var lastKnownPosition: Position?
    public var message: String?
    public var createdAtDevice: Date?
    public var receivedAt: Date?
    public var acknowledgedAt: Date?
    public var acknowledgedBy: PersonRef?
    public var resolvedAt: Date?
    public var assignments: [Assignment]?
    public var updates: [IncidentUpdate]?
}

public struct CreateIncidentRequest: Codable, Sendable, Equatable {
    public var id: String
    public var kind: String = "sos"
    public var isTest: Bool
    public var flightId: String?
    public var position: IncidentPosition?
    public var message: String?
    public var createdAtDevice: Date
}

public struct TeamMember: Codable, Sendable, Equatable, Identifiable {
    public var userId: String
    public var fullName: String?
    public var availability: String?
    public var lastPosition: AssignmentPosition?
    public var activeAssignment: Assignment?
    public var id: String { userId }
}

// MARK: Notifications

public struct AppNotification: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var kind: String
    public var title: String
    public var body: String?
    public var readAt: Date?
    public var createdAt: Date?
}
