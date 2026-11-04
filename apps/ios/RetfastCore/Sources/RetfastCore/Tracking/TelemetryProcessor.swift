import Foundation

/// Why a raw fix was refused. Rejected fixes are never stored.
public enum FixRejection: String, Sendable, Equatable {
    /// Core Location reports horizontalAccuracy < 0: the coordinate is invalid.
    case invalidAccuracy = "invalid_accuracy"
    case nonFiniteValue = "non_finite"
    /// (0,0) "Null Island" — a classic uninitialised-coordinate artefact.
    case zeroCoordinates = "zero_coordinates"
    case outOfRange = "out_of_range"
    /// Timestamp not newer than the last accepted fix (duplicate / out of order).
    case notNewer = "not_newer"
    /// A cached fix delivered at start-up that is much older than "now".
    case staleCachedFix = "stale_cached_fix"
}

/// Threshold above which a fix is kept but flagged low quality (and excluded
/// from distance/stat calculations, matching the server which skips h_acc > 50).
public let lowQualityHorizontalAccuracy: Double = 50

public enum FixDecision: Sendable, Equatable {
    case rejected(FixRejection)
    /// Valid and must be persisted.
    case store(lowQuality: Bool)
    /// Valid, used for presentation, but not stored because it arrived sooner
    /// than the active profile's minimum sample interval.
    case presentationOnly(lowQuality: Bool)
}

/// 1-D constant-velocity Kalman filter over GPS altitude. Produces a smoothed
/// altitude and an estimated vertical speed. GPS altitude is noisy (vAcc is
/// commonly 3–15 m), so this is an *estimate*, clearly labelled as such in UI.
public struct VerticalKalmanFilter: Sendable, Equatable {
    public private(set) var altitude: Double?
    public private(set) var verticalSpeed: Double = 0
    private var p00 = 100.0, p01 = 0.0, p10 = 0.0, p11 = 25.0
    private var lastTime: Date?
    /// Process noise: variance of vertical acceleration (m/s^2)^2.
    public var accelerationVariance: Double

    public init(accelerationVariance: Double = 0.6) {
        self.accelerationVariance = accelerationVariance
    }

    public mutating func reset() {
        self = VerticalKalmanFilter(accelerationVariance: accelerationVariance)
    }

    public mutating func update(altitude z: Double, verticalAccuracy: Double, at time: Date) {
        let r = pow(verticalAccuracy > 0 ? verticalAccuracy : 15, 2)
        guard let h = altitude, let t0 = lastTime else {
            altitude = z
            verticalSpeed = 0
            p00 = r; p01 = 0; p10 = 0; p11 = 25
            lastTime = time
            return
        }
        let dt = time.timeIntervalSince(t0)
        guard dt > 0 else { return }
        if dt > 60 {
            // Long gap (e.g. app suspended): restart rather than integrate garbage.
            lastTime = nil
            self.altitude = nil
            update(altitude: z, verticalAccuracy: verticalAccuracy, at: time)
            return
        }
        // Predict.
        let hp = h + verticalSpeed * dt
        let vp = verticalSpeed
        let q = accelerationVariance
        let dt2 = dt * dt, dt3 = dt2 * dt, dt4 = dt3 * dt
        let n00 = p00 + dt * (p10 + p01) + dt2 * p11 + q * dt4 / 4
        let n01 = p01 + dt * p11 + q * dt3 / 2
        let n10 = p10 + dt * p11 + q * dt3 / 2
        let n11 = p11 + q * dt2
        // Update.
        let s = n00 + r
        let k0 = n00 / s, k1 = n10 / s
        let y = z - hp
        altitude = hp + k0 * y
        verticalSpeed = vp + k1 * y
        p00 = (1 - k0) * n00
        p01 = (1 - k0) * n01
        p10 = n10 - k1 * n00
        p11 = n11 - k1 * n01
        lastTime = time
    }
}

/// Validates raw fixes, flags quality, computes presentation values and running
/// flight statistics. Pure value type: no Core Location, no I/O.
public struct TelemetryProcessor: Sendable {
    public private(set) var values = FlightComputerValues()
    private var lastAcceptedTime: Date?
    private var lastStoredTime: Date?
    private var lastGood: RawLocation?
    private var lastCourse: (deg: Double, t: Date)?
    private var kalman = VerticalKalmanFilter()
    private var ascentReference: Double?
    /// Altitude hysteresis for ascent/descent accumulation (filters GPS jitter).
    public var ascentThreshold: Double = 3
    /// Fixes older than this at arrival are treated as cached and dropped.
    public var maxFixAge: TimeInterval = 30

    public init() {}

    public static func validate(_ fix: RawLocation) -> FixRejection? {
        if fix.horizontalAccuracy < 0 { return .invalidAccuracy }
        if !fix.latitude.isFinite || !fix.longitude.isFinite || !fix.horizontalAccuracy.isFinite { return .nonFiniteValue }
        if fix.latitude == 0 && fix.longitude == 0 { return .zeroCoordinates }
        if abs(fix.latitude) > 90 || abs(fix.longitude) > 180 { return .outOfRange }
        return nil
    }

    /// Decide what to do with a fix, and update presentation values.
    /// - Parameters:
    ///   - receivedAt: device clock when the fix was delivered.
    public mutating func process(_ fix: RawLocation, profile: TrackingProfile, receivedAt: Date) -> FixDecision {
        if let reason = Self.validate(fix) {
            values.rejectedFixes += 1
            return .rejected(reason)
        }
        if let last = lastAcceptedTime, fix.timestamp <= last {
            values.rejectedFixes += 1
            return .rejected(.notNewer)
        }
        if receivedAt.timeIntervalSince(fix.timestamp) > maxFixAge {
            values.rejectedFixes += 1
            return .rejected(.staleCachedFix)
        }

        var lowQuality = fix.horizontalAccuracy > lowQualityHorizontalAccuracy
        if !lowQuality, let prev = lastGood {
            let dt = fix.timestamp.timeIntervalSince(prev.timestamp)
            let d = Geo.distance(prev.latitude, prev.longitude, fix.latitude, fix.longitude)
            // > 120 m/s between consecutive good fixes is not a paraglider.
            if dt > 0, dt < 120, d / dt > 120 { lowQuality = true }
        }
        lastAcceptedTime = fix.timestamp

        updatePresentation(fix, lowQuality: lowQuality)

        let interval = profile.settings.minSampleInterval
        if let lastStored = lastStoredTime, fix.timestamp.timeIntervalSince(lastStored) < interval - 0.05 {
            return .presentationOnly(lowQuality: lowQuality)
        }
        lastStoredTime = fix.timestamp
        values.acceptedSamples += 1
        return .store(lowQuality: lowQuality)
    }

    private mutating func updatePresentation(_ fix: RawLocation, lowQuality: Bool) {
        values.lastFixAt = fix.timestamp
        values.latitude = fix.latitude
        values.longitude = fix.longitude
        values.horizontalAccuracy = fix.horizontalAccuracy
        values.verticalAccuracy = fix.verticalAccuracy >= 0 ? fix.verticalAccuracy : nil
        values.lowQuality = lowQuality
        values.groundSpeed = fix.speed >= 0 ? fix.speed : nil
        values.heading = fix.course >= 0 ? fix.course : nil

        let altValid = fix.verticalAccuracy > 0 && fix.altitude.isFinite
        values.gpsAltitude = altValid ? fix.altitude : nil

        if fix.course >= 0, fix.speed > 2 {
            if let prev = lastCourse {
                let dt = fix.timestamp.timeIntervalSince(prev.t)
                if dt > 0, dt < 10 {
                    var delta = fix.course - prev.deg
                    if delta > 180 { delta -= 360 }
                    if delta < -180 { delta += 360 }
                    let rate = delta / dt
                    let old = values.turnRate ?? rate
                    values.turnRate = old + 0.3 * (rate - old)
                }
            }
            lastCourse = (fix.course, fix.timestamp)
        } else {
            lastCourse = nil
            values.turnRate = values.turnRate.map { $0 * 0.7 }
        }

        guard !lowQuality else { return }

        if altValid {
            kalman.update(altitude: fix.altitude, verticalAccuracy: fix.verticalAccuracy, at: fix.timestamp)
            values.smoothedAltitude = kalman.altitude
            values.verticalSpeed = kalman.verticalSpeed
            if let alt = kalman.altitude {
                values.maxAltitude = max(values.maxAltitude ?? alt, alt)
                if let ref = ascentReference {
                    let delta = alt - ref
                    if delta >= ascentThreshold { values.totalAscent += delta; ascentReference = alt }
                    else if delta <= -ascentThreshold { values.totalDescent += -delta; ascentReference = alt }
                } else {
                    ascentReference = alt
                }
            }
        }
        if let s = values.groundSpeed {
            values.maxGroundSpeed = max(values.maxGroundSpeed ?? s, s)
        }
        if let prev = lastGood {
            values.distance += Geo.distance(prev.latitude, prev.longitude, fix.latitude, fix.longitude)
        }
        lastGood = fix
    }

    /// Rebuild presentation state from stored samples (restoration after relaunch).
    public mutating func replay(_ samples: [TelemetrySample]) {
        for s in samples {
            let raw = RawLocation(timestamp: s.t, latitude: s.lat, longitude: s.lon,
                                  altitude: s.altitude ?? .nan, horizontalAccuracy: s.hAcc,
                                  verticalAccuracy: s.vAcc ?? -1, speed: s.speed ?? -1, course: s.course ?? -1)
            guard Self.validate(raw) == nil else { continue }
            if let last = lastAcceptedTime, raw.timestamp <= last { continue }
            lastAcceptedTime = raw.timestamp
            lastStoredTime = raw.timestamp
            values.acceptedSamples += 1
            updatePresentation(raw, lowQuality: s.lowQuality)
        }
    }
}

public enum Geo {
    /// Haversine distance in metres.
    public static func distance(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let r = 6_371_000.0
        let p1 = lat1 * .pi / 180, p2 = lat2 * .pi / 180
        let dp = (lat2 - lat1) * .pi / 180, dl = (lon2 - lon1) * .pi / 180
        let a = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
        return 2 * r * atan2(sqrt(a), sqrt(1 - a))
    }
}
