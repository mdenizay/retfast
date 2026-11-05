package com.mizibu.retfast.tracking

import kotlin.math.abs

data class PolicyInput(val timeMs: Long, val groundSpeed: Double?, val verticalSpeed: Double?, val turnRate: Double?)

/**
 * Chooses the sampling profile from processed telemetry, with dwell-time hysteresis so a single noisy
 * fix never flips the profile. Same heuristics as iOS (docs/architecture/ios-tracking.md):
 * - pre-flight -> active: ground speed >= 4 m/s or |vario| >= 1.5 m/s for 5 s
 * - thermal: climb >= 0.3 m/s and |turn rate| >= 8 deg/s for 10 s
 * - cruise: ground speed >= 5 m/s and |turn rate| < 5 deg/s for 20 s
 * - landing: ground speed < 2.5 m/s and |vario| < 0.4 m/s for 30 s (drives the landing prompt; never ends the flight)
 */
class TrackingPolicy(initial: TrackingProfile = TrackingProfile.PRE_FLIGHT, airborne: Boolean = false, val t: Thresholds = Thresholds()) {
    data class Thresholds(
        val takeoffSpeed: Double = 4.0, val takeoffVario: Double = 1.5, val takeoffDwellS: Double = 5.0,
        val thermalClimb: Double = 0.3, val thermalTurnRate: Double = 8.0, val thermalDwellS: Double = 10.0,
        val cruiseSpeed: Double = 5.0, val cruiseMaxTurnRate: Double = 5.0, val cruiseDwellS: Double = 20.0,
        val landingMaxSpeed: Double = 2.5, val landingMaxVario: Double = 0.4, val landingDwellS: Double = 30.0,
        val activeDwellS: Double = 10.0,
    )

    var profile: TrackingProfile = if (initial.isFlightProfile) initial else TrackingProfile.ACTIVE_FLIGHT
        private set
    var airborne: Boolean = airborne || profile != TrackingProfile.PRE_FLIGHT
        private set
    private var candidate: TrackingProfile? = null
    private var candidateSince: Long = 0

    fun evaluate(input: PolicyInput): TrackingProfile {
        val target = classify(input) ?: return profile
        if (target == profile) { candidate = null; return profile }
        if (candidate != target) { candidate = target; candidateSince = input.timeMs; return profile }
        if ((input.timeMs - candidateSince) / 1000.0 >= dwell(target)) {
            profile = target
            if (target != TrackingProfile.PRE_FLIGHT) airborne = true
            candidate = null
        }
        return profile
    }

    private fun classify(i: PolicyInput): TrackingProfile? {
        val speed = i.groundSpeed
        val vario = i.verticalSpeed
        val turn = i.turnRate?.let { abs(it) }
        if (!airborne) {
            if (speed != null && speed >= t.takeoffSpeed) return TrackingProfile.ACTIVE_FLIGHT
            if (vario != null && abs(vario) >= t.takeoffVario) return TrackingProfile.ACTIVE_FLIGHT
            return if (speed == null && vario == null) null else TrackingProfile.PRE_FLIGHT
        }
        if (vario != null && turn != null && vario >= t.thermalClimb && turn >= t.thermalTurnRate) return TrackingProfile.THERMAL
        if (speed != null && speed < t.landingMaxSpeed && vario != null && abs(vario) < t.landingMaxVario) return TrackingProfile.LANDING
        if (speed != null && speed >= t.cruiseSpeed && (turn ?: 0.0) < t.cruiseMaxTurnRate) return TrackingProfile.CRUISE
        if (speed == null && vario == null) return null
        return TrackingProfile.ACTIVE_FLIGHT
    }

    private fun dwell(target: TrackingProfile) = when (target) {
        TrackingProfile.ACTIVE_FLIGHT -> if (airborne) t.activeDwellS else t.takeoffDwellS
        TrackingProfile.THERMAL -> t.thermalDwellS
        TrackingProfile.CRUISE -> t.cruiseDwellS
        TrackingProfile.LANDING -> t.landingDwellS
        else -> t.activeDwellS
    }
}

/**
 * Decides when to ask "İndin mi? Retrieve iste": once per landing episode of a recording flight,
 * snoozable, never ends the flight on its own.
 */
class LandingPromptDetector(var enabled: Boolean, private val snoozeS: Long = 120) {
    private var inLanding = false
    private var prompted = false
    private var snoozedUntil: Long? = null

    /** Feed every profile observation. True exactly when the prompt should be presented now. */
    fun observe(profile: TrackingProfile, recording: Boolean, nowMs: Long): Boolean {
        if (!enabled || !recording) return false
        if (profile != TrackingProfile.LANDING) { inLanding = false; prompted = false; return false }
        if (!inLanding) { inLanding = true; prompted = false }
        if (prompted) return false
        snoozedUntil?.let { if (nowMs < it) return false }
        prompted = true
        return true
    }

    fun snooze(nowMs: Long) { snoozedUntil = nowMs + snoozeS * 1000 }
}
