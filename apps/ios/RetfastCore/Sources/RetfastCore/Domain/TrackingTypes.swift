import Foundation

/// Lifecycle of a flight recording. Owned by `FlightSessionManager`, persisted in
/// SQLite, and completely independent of which screen is visible.
public enum FlightSessionState: String, Codable, Sendable, CaseIterable {
    case idle
    case preparing
    case recording
    case paused
    case ending
    case completed
    case error

    /// States in which a flight exists that must be restored after a relaunch.
    public var isActive: Bool {
        switch self {
        case .preparing, .recording, .paused, .ending: true
        case .idle, .completed, .error: false
        }
    }
}

/// Location sampling profiles. Raw values are what we send in `meta.profile`.
public enum TrackingProfile: String, Codable, Sendable, CaseIterable {
    case preFlight = "pre_flight"
    case activeFlight = "active_flight"
    case thermal
    case cruise
    case landing
    case emergency
}

/// What a profile asks Core Location for. These are *targets*: iOS decides the
/// real delivery rate (typically ~1 Hz with GPS), and may deliver less often
/// with poor sky view, in Low Power Mode or under thermal pressure.
public struct ProfileSettings: Sendable, Equatable {
    /// CLLocationAccuracy value (metres; negative constants are Apple's specials).
    public var desiredAccuracy: Double
    /// CLLocationDistance; -1 == kCLDistanceFilterNone.
    public var distanceFilter: Double
    /// Minimum spacing between *stored* samples. Fixes arriving faster are
    /// used for presentation but not persisted.
    public var minSampleInterval: TimeInterval

    public init(desiredAccuracy: Double, distanceFilter: Double, minSampleInterval: TimeInterval) {
        self.desiredAccuracy = desiredAccuracy
        self.distanceFilter = distanceFilter
        self.minSampleInterval = minSampleInterval
    }

    // Apple's constants, duplicated so the domain does not need CoreLocation.
    public static let accuracyBestForNavigation: Double = -2   // kCLLocationAccuracyBestForNavigation
    public static let accuracyBest: Double = -1                 // kCLLocationAccuracyBest
    public static let distanceFilterNone: Double = -1           // kCLDistanceFilterNone
}

extension TrackingProfile {
    public var settings: ProfileSettings {
        switch self {
        case .preFlight:
            // On the launch: good fix, but no need to store every second. No
            // distance filter: a pilot standing still must still get fresh fixes
            // (a filter would leave only the cached start-up fix, which is rejected).
            ProfileSettings(desiredAccuracy: ProfileSettings.accuracyBest, distanceFilter: ProfileSettings.distanceFilterNone, minSampleInterval: 5)
        case .activeFlight:
            ProfileSettings(desiredAccuracy: ProfileSettings.accuracyBestForNavigation, distanceFilter: ProfileSettings.distanceFilterNone, minSampleInterval: 1)
        case .thermal:
            // Tight circles: every fix matters for the climb trace.
            ProfileSettings(desiredAccuracy: ProfileSettings.accuracyBestForNavigation, distanceFilter: ProfileSettings.distanceFilterNone, minSampleInterval: 1)
        case .cruise:
            // Straight glides: 1 sample / 3 s is enough for the route and live map.
            ProfileSettings(desiredAccuracy: ProfileSettings.accuracyBestForNavigation, distanceFilter: 10, minSampleInterval: 3)
        case .landing:
            ProfileSettings(desiredAccuracy: ProfileSettings.accuracyBestForNavigation, distanceFilter: ProfileSettings.distanceFilterNone, minSampleInterval: 2)
        case .emergency:
            ProfileSettings(desiredAccuracy: ProfileSettings.accuracyBestForNavigation, distanceFilter: ProfileSettings.distanceFilterNone, minSampleInterval: 1)
        }
    }
}

/// A raw fix as delivered by Core Location, decoupled from `CLLocation` so the
/// processing pipeline is testable on any host.
public struct RawLocation: Sendable, Equatable {
    public var timestamp: Date
    public var latitude: Double
    public var longitude: Double
    public var altitude: Double
    public var ellipsoidalAltitude: Double?
    public var horizontalAccuracy: Double
    public var verticalAccuracy: Double
    public var speed: Double
    public var speedAccuracy: Double
    public var course: Double
    public var courseAccuracy: Double
    public var floor: Int?
    public var isSimulatedBySoftware: Bool

    public init(timestamp: Date, latitude: Double, longitude: Double, altitude: Double,
                ellipsoidalAltitude: Double? = nil, horizontalAccuracy: Double, verticalAccuracy: Double,
                speed: Double, speedAccuracy: Double = -1, course: Double, courseAccuracy: Double = -1,
                floor: Int? = nil, isSimulatedBySoftware: Bool = false) {
        self.timestamp = timestamp
        self.latitude = latitude
        self.longitude = longitude
        self.altitude = altitude
        self.ellipsoidalAltitude = ellipsoidalAltitude
        self.horizontalAccuracy = horizontalAccuracy
        self.verticalAccuracy = verticalAccuracy
        self.speed = speed
        self.speedAccuracy = speedAccuracy
        self.course = course
        self.courseAccuracy = courseAccuracy
        self.floor = floor
        self.isSimulatedBySoftware = isSimulatedBySoftware
    }
}

/// Device conditions captured with each sample.
public struct DeviceConditions: Sendable, Equatable {
    /// 0...1, nil when unknown (simulator reports -1).
    public var batteryLevel: Double?
    public var batteryState: BatteryState
    public var lowPowerMode: Bool

    public enum BatteryState: String, Sendable { case unknown, unplugged, charging, full }

    public init(batteryLevel: Double?, batteryState: BatteryState, lowPowerMode: Bool) {
        self.batteryLevel = batteryLevel
        self.batteryState = batteryState
        self.lowPowerMode = lowPowerMode
    }

    public static let unknown = DeviceConditions(batteryLevel: nil, batteryState: .unknown, lowPowerMode: false)
}

/// Values shown on the flight computer. These are presentation values derived
/// from filtering; the stored samples always keep the raw Core Location values.
public struct FlightComputerValues: Sendable, Equatable {
    public var gpsAltitude: Double?
    public var smoothedAltitude: Double?
    /// Filtered GPS estimate (m/s, positive = climb). Not a barometric variometer.
    public var verticalSpeed: Double?
    public var groundSpeed: Double?
    public var heading: Double?
    public var turnRate: Double?
    public var horizontalAccuracy: Double?
    public var verticalAccuracy: Double?
    public var lastFixAt: Date?
    public var latitude: Double?
    public var longitude: Double?
    public var lowQuality: Bool = false

    public var distance: Double = 0
    public var maxAltitude: Double?
    public var maxGroundSpeed: Double?
    public var totalAscent: Double = 0
    public var totalDescent: Double = 0
    public var acceptedSamples: Int = 0
    public var rejectedFixes: Int = 0

    public init() {}
}
