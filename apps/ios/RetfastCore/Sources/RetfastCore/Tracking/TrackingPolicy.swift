import Foundation

/// Input to the policy, taken from processed (filtered) telemetry.
public struct PolicyInput: Sendable, Equatable {
    public var time: Date
    public var groundSpeed: Double?
    public var verticalSpeed: Double?
    public var turnRate: Double?

    public init(time: Date, groundSpeed: Double?, verticalSpeed: Double?, turnRate: Double?) {
        self.time = time
        self.groundSpeed = groundSpeed
        self.verticalSpeed = verticalSpeed
        self.turnRate = turnRate
    }
}

/// Chooses the sampling profile from processed telemetry, with dwell-time
/// hysteresis so a single noisy fix never flips the profile.
///
/// Heuristics (tunable, documented in docs/architecture/ios-tracking.md):
/// - pre-flight → active flight: ground speed ≥ 4 m/s or |vario| ≥ 1.5 m/s for 5 s
/// - thermal: climb ≥ 0.3 m/s and |turn rate| ≥ 8 °/s for 10 s
/// - cruise: ground speed ≥ 5 m/s and |turn rate| < 5 °/s for 20 s
/// - landing: ground speed < 2.5 m/s and |vario| < 0.4 m/s for 30 s
///   (drives the "İndin mi? Retrieve iste" prompt; never ends the flight by itself)
public struct TrackingPolicy: Sendable, Equatable {
    public struct Thresholds: Sendable, Equatable {
        public var takeoffSpeed = 4.0
        public var takeoffVario = 1.5
        public var takeoffDwell: TimeInterval = 5
        public var thermalClimb = 0.3
        public var thermalTurnRate = 8.0
        public var thermalDwell: TimeInterval = 10
        public var cruiseSpeed = 5.0
        public var cruiseMaxTurnRate = 5.0
        public var cruiseDwell: TimeInterval = 20
        public var landingMaxSpeed = 2.5
        public var landingMaxVario = 0.4
        public var landingDwell: TimeInterval = 30
        public var activeDwell: TimeInterval = 10
        public init() {}
    }

    public private(set) var profile: TrackingProfile
    public private(set) var airborne: Bool
    public var thresholds: Thresholds
    private var candidate: TrackingProfile?
    private var candidateSince: Date?

    public init(initial: TrackingProfile = .preFlight, airborne: Bool = false, thresholds: Thresholds = Thresholds()) {
        let initial = initial.isFlightProfile ? initial : .activeFlight
        self.profile = initial
        self.airborne = airborne || (initial != .preFlight)
        self.thresholds = thresholds
    }

    /// Returns the profile to use after this input (may be unchanged).
    @discardableResult
    public mutating func evaluate(_ input: PolicyInput) -> TrackingProfile {
        guard let target = classify(input) else { return profile }
        if target == profile {
            candidate = nil
            candidateSince = nil
            return profile
        }
        if candidate != target {
            candidate = target
            candidateSince = input.time
            return profile
        }
        if let since = candidateSince, input.time.timeIntervalSince(since) >= dwell(for: target) {
            profile = target
            if target != .preFlight { airborne = true }
            candidate = nil
            candidateSince = nil
        }
        return profile
    }

    private func classify(_ i: PolicyInput) -> TrackingProfile? {
        let t = thresholds
        let speed = i.groundSpeed
        let vario = i.verticalSpeed
        let turn = i.turnRate.map(abs)

        if !airborne {
            if let s = speed, s >= t.takeoffSpeed { return .activeFlight }
            if let v = vario, abs(v) >= t.takeoffVario { return .activeFlight }
            return speed == nil && vario == nil ? nil : .preFlight
        }
        if let v = vario, let r = turn, v >= t.thermalClimb, r >= t.thermalTurnRate { return .thermal }
        if let s = speed, s < t.landingMaxSpeed, let v = vario, abs(v) < t.landingMaxVario { return .landing }
        if let s = speed, s >= t.cruiseSpeed, (turn ?? 0) < t.cruiseMaxTurnRate { return .cruise }
        if speed == nil && vario == nil { return nil }
        return .activeFlight
    }

    private func dwell(for target: TrackingProfile) -> TimeInterval {
        switch target {
        case .activeFlight: airborne ? thresholds.activeDwell : thresholds.takeoffDwell
        case .thermal: thresholds.thermalDwell
        case .cruise: thresholds.cruiseDwell
        case .landing: thresholds.landingDwell
        case .preFlight, .retrieveWaiting, .retrieverDriving: thresholds.activeDwell
        }
    }
}
