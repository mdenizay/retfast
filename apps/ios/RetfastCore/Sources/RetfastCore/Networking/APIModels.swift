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
        /// Field → reason. Non-string values (objects, numbers) are kept as
        /// their JSON text so an unexpected shape never hides the error code.
        public var details: [String: String]?

        enum CodingKeys: String, CodingKey { case code, message, details }

        public init(code: String, message: String?, details: [String: String]?) {
            self.code = code; self.message = message; self.details = details
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            code = try c.decode(String.self, forKey: .code)
            message = try c.decodeIfPresent(String.self, forKey: .message)
            if let raw = try? c.decodeIfPresent(JSONValue.self, forKey: .details), case .object(let dict) = raw {
                details = dict.mapValues { $0.stringValue }
            } else {
                details = nil
            }
        }
    }
    public var error: Inner
}

/// Minimal JSON value used where the server may send arbitrary shapes.
public enum JSONValue: Codable, Sendable, Equatable {
    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null

    public init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .object(let o): try c.encode(o)
        case .array(let a): try c.encode(a)
        case .null: try c.encodeNil()
        }
    }

    /// Strings as-is; everything else as compact JSON text.
    public var stringValue: String {
        if case .string(let s) = self { return s }
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys]
        return (try? e.encode(self)).map { String(decoding: $0, as: UTF8.self) } ?? ""
    }
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
    /// Global roles only (`platform_admin`). Event roles live on `Event.me`.
    public var roles: [String]
    public var mustChangePassword: Bool
    public var createdAt: Date?
    public var pilot: PilotProfile?
    public var preferences: Preferences?

    public var isPlatformAdmin: Bool { roles.contains("platform_admin") }
}

public struct PilotProfile: Codable, Sendable, Equatable {
    public var publicId: String?
    public var displayName: String?
    public var bio: String?
    public var wing: String?
    public var licenseNo: String?
    public var nationality: String?
    /// Visible only to the user, event organizers, platform admins and a
    /// retriever while they hold an accepted retrieval for this pilot.
    public var phone: String?
    public var emergencyContactName: String?
    public var emergencyContactPhone: String?

    public init(publicId: String? = nil, displayName: String? = nil, bio: String? = nil, wing: String? = nil,
                licenseNo: String? = nil, nationality: String? = nil, phone: String? = nil,
                emergencyContactName: String? = nil, emergencyContactPhone: String? = nil) {
        self.publicId = publicId; self.displayName = displayName; self.bio = bio; self.wing = wing
        self.licenseNo = licenseNo; self.nationality = nationality; self.phone = phone
        self.emergencyContactName = emergencyContactName; self.emergencyContactPhone = emergencyContactPhone
    }
}

public struct Preferences: Codable, Sendable, Equatable {
    public var units: String?
    public var publicProfile: Bool?

    public init(units: String? = nil, publicProfile: Bool? = nil) {
        self.units = units; self.publicProfile = publicProfile
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
    public var applicationsOpen: Bool?
    public var liveTracking: Bool?
    public var publicLiveMap: Bool?
    public var pilotsSeeEachOther: Bool?
    public var landingPrompt: Bool?

    public init(applicationsOpen: Bool? = nil, liveTracking: Bool? = nil, publicLiveMap: Bool? = nil,
                pilotsSeeEachOther: Bool? = nil, landingPrompt: Bool? = nil) {
        self.applicationsOpen = applicationsOpen; self.liveTracking = liveTracking; self.publicLiveMap = publicLiveMap
        self.pilotsSeeEachOther = pilotsSeeEachOther; self.landingPrompt = landingPrompt
    }
}

public struct PersonRef: Codable, Sendable, Equatable, Hashable {
    public var id: String?
    public var userId: String?
    public var fullName: String?
    public var publicId: String?
    public var email: String?
    public var phone: String?

    public init(userId: String? = nil, fullName: String? = nil, publicId: String? = nil, phone: String? = nil) {
        self.userId = userId; self.fullName = fullName; self.publicId = publicId; self.phone = phone
    }

    public var displayName: String { fullName ?? publicId ?? "—" }
}

public struct EventCounts: Codable, Sendable, Equatable {
    public var pilots: Int?
    public var observers: Int?
    public var retrievers: Int?
    /// Only returned to organizers.
    public var pendingApplications: Int?
}

public struct ApplicationRef: Codable, Sendable, Equatable {
    public var id: String
    public var status: String

    public init(id: String, status: String) { self.id = id; self.status = status }
}

/// The caller's relationship to an event (`Event.me`).
public struct EventMembership: Codable, Sendable, Equatable {
    public var isOrganizer: Bool?
    public var role: String?
    public var application: ApplicationRef?

    public init(isOrganizer: Bool? = nil, role: String? = nil, application: ApplicationRef? = nil) {
        self.isOrganizer = isOrganizer; self.role = role; self.application = application
    }
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
    public var organizers: [PersonRef]?
    public var counts: EventCounts?
    public var me: EventMembership?
    public var createdAt: Date?
    public var updatedAt: Date?

    public init(id: String, name: String, status: String, settings: EventSettings? = nil, me: EventMembership? = nil,
                center: LatLon? = nil) {
        self.id = id; self.name = name; self.status = status; self.settings = settings; self.me = me; self.center = center
    }

    public static func == (a: Event, b: Event) -> Bool {
        a.id == b.id && a.updatedAt == b.updatedAt && a.me == b.me && a.status == b.status
            && a.settings == b.settings && a.counts == b.counts
    }
    public func hash(into h: inout Hasher) { h.combine(id) }

    public var memberRole: EventRole? { me?.role.flatMap(EventRole.init(rawValue:)) }
    public var isOrganizer: Bool { me?.isOrganizer ?? false }
    public var isMember: Bool { memberRole != nil || isOrganizer }
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

public struct Member: Codable, Sendable, Equatable, Identifiable {
    public var userId: String
    public var fullName: String?
    public var publicId: String?
    public var role: String?
    public var isOrganizer: Bool?
    public var status: String?
    public var joinedAt: Date?
    /// Organizers only.
    public var phone: String?
    public var id: String { userId }
}

public struct EventApplication: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var eventId: String?
    public var user: PersonRef?
    public var message: String?
    public var status: String
    public var grantedRole: String?
    public var decidedBy: PersonRef?
    public var decisionNote: String?
    public var createdAt: Date?
    public var decidedAt: Date?
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

public struct LiveRetriever: Codable, Sendable, Equatable, Identifiable {
    public var userId: String
    public var fullName: String?
    public var onDuty: Bool?
    public var position: SharedPosition?
    public var ageS: Double?
    public var activeRetrievals: Int?
    public var id: String { userId }

    public init(userId: String, fullName: String?, onDuty: Bool?, position: SharedPosition?, ageS: Double?, activeRetrievals: Int?) {
        self.userId = userId; self.fullName = fullName; self.onDuty = onDuty; self.position = position
        self.ageS = ageS; self.activeRetrievals = activeRetrievals
    }
}

public struct LiveSnapshot: Codable, Sendable, Equatable {
    public var eventId: String?
    public var serverTime: Date?
    public var cursor: String?
    public var pilots: [LivePilot]
    public var retrievals: [Retrieval]?
    public var retrievers: [LiveRetriever]?

    enum CodingKeys: String, CodingKey { case eventId, serverTime, cursor, pilots, retrievals, retrievers }

    public init(eventId: String? = nil, serverTime: Date? = nil, cursor: String? = nil, pilots: [LivePilot] = [],
                retrievals: [Retrieval]? = nil, retrievers: [LiveRetriever]? = nil) {
        self.eventId = eventId; self.serverTime = serverTime; self.cursor = cursor; self.pilots = pilots
        self.retrievals = retrievals; self.retrievers = retrievers
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        eventId = try c.decodeIfPresent(String.self, forKey: .eventId)
        serverTime = try c.decodeIfPresent(Date.self, forKey: .serverTime)
        cursor = try c.decodeIfPresent(String.self, forKey: .cursor)
        // Retrievers do not get the general live map: tolerate a missing list.
        pilots = try c.decodeIfPresent([LivePilot].self, forKey: .pilots) ?? []
        retrievals = try c.decodeIfPresent([Retrieval].self, forKey: .retrievals)
        retrievers = try c.decodeIfPresent([LiveRetriever].self, forKey: .retrievers)
    }
}

// MARK: Retrievals

/// A shared position (retriever position, pickup point). `t` is the GPS time.
public struct SharedPosition: Codable, Sendable, Equatable {
    public var lat: Double
    public var lon: Double
    public var gpsAltM: Double?
    public var hAccM: Double?
    public var t: Date?
    public var courseDeg: Double?
    public var speedMs: Double?

    public init(lat: Double, lon: Double, gpsAltM: Double? = nil, hAccM: Double? = nil, t: Date? = nil,
                courseDeg: Double? = nil, speedMs: Double? = nil) {
        self.lat = lat; self.lon = lon; self.gpsAltM = gpsAltM; self.hAccM = hAccM; self.t = t
        self.courseDeg = courseDeg; self.speedMs = speedMs
    }
}

public struct RetrievalUpdate: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var kind: String
    public var actor: PersonRef?
    public var body: String?
    public var createdAt: Date?
}

public struct Retrieval: Codable, Sendable, Equatable, Identifiable, Hashable {
    public var id: String
    public var eventId: String?
    public var flightId: String?
    /// `phone` only for organizers/admin and the accepting retriever.
    public var pilot: PersonRef?
    public var status: String
    public var pickup: SharedPosition?
    /// Latest position the pilot shared (they may walk to a road).
    public var pilotPosition: Position?
    public var note: String?
    /// `phone` visible to the pilot after acceptance.
    public var retriever: PersonRef?
    public var retrieverPosition: SharedPosition?
    public var requestedAt: Date?
    public var acceptedAt: Date?
    public var pickedUpAt: Date?
    public var deliveredAt: Date?
    public var cancelledAt: Date?
    public var cancelledBy: PersonRef?
    public var cancelReason: String?
    public var deliveryNote: String?
    public var isSimulated: Bool?
    public var updates: [RetrievalUpdate]?

    public init(id: String, eventId: String? = nil, status: String, pilot: PersonRef? = nil, pickup: SharedPosition? = nil,
                retriever: PersonRef? = nil, requestedAt: Date? = nil) {
        self.id = id; self.eventId = eventId; self.status = status; self.pilot = pilot; self.pickup = pickup
        self.retriever = retriever; self.requestedAt = requestedAt
    }

    public func hash(into h: inout Hasher) { h.combine(id) }

    public var retrievalStatus: RetrievalStatus? { RetrievalStatus(rawValue: status) }

    /// Best known pilot position: the latest shared one, else the pickup point.
    public var latestPilotPosition: SharedPosition? {
        if let p = pilotPosition {
            return SharedPosition(lat: p.lat, lon: p.lon, gpsAltM: p.gpsAltM, hAccM: p.hAccM, t: p.t)
        }
        return pickup
    }
}

public struct CreateRetrievalRequest: Codable, Sendable, Equatable {
    public var id: String
    public var flightId: String?
    public var pickup: SharedPosition
    public var note: String?
}

public struct RetrieverPositionEvent: Codable, Sendable, Equatable {
    public var userId: String
    public var fullName: String?
    public var position: SharedPosition
}

public struct PilotPositionEvent: Codable, Sendable, Equatable {
    public var retrievalId: String
    public var userId: String?
    public var position: Position
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
