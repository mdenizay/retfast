import Foundation

/// Decides when to ask "İndin mi? Retrieve iste". Driven by the existing
/// `TrackingPolicy` landing profile (low ground speed + low vertical speed for
/// 30 s), only for event flights whose event has `landing_prompt` on.
///
/// - Fires once per landing episode of a *recording* flight (profile `.landing`).
/// - "Hâlâ uçuyorum" snoozes it: a new landing episode (profile left `.landing`
///   and came back) prompts again, but not within `snooze` seconds.
/// - Never ends the flight on its own.
public struct LandingPromptDetector: Sendable, Equatable {
    public var enabled: Bool
    public var snooze: TimeInterval
    private var inLanding = false
    private var promptedThisLanding = false
    private var snoozedUntil: Date?

    public init(enabled: Bool, snooze: TimeInterval = 120) {
        self.enabled = enabled
        self.snooze = snooze
    }

    /// Feed every profile/state observation. Returns true exactly when the
    /// prompt should be presented now.
    public mutating func observe(profile: TrackingProfile, state: FlightSessionState, now: Date) -> Bool {
        guard enabled, state == .recording else { return false }
        guard profile == .landing else {
            inLanding = false
            promptedThisLanding = false
            return false
        }
        if !inLanding {
            inLanding = true
            promptedThisLanding = false
        }
        guard !promptedThisLanding else { return false }
        if let snoozedUntil, now < snoozedUntil { return false }
        promptedThisLanding = true
        return true
    }

    /// The pilot answered "Hâlâ uçuyorum".
    public mutating func snooze(now: Date) {
        snoozedUntil = now.addingTimeInterval(snooze)
    }
}
