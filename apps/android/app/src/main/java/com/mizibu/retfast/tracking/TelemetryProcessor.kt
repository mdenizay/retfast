package com.mizibu.retfast.tracking

import com.mizibu.retfast.util.Geo
import kotlin.math.abs
import kotlin.math.pow

/** Why a raw fix was refused. Rejected fixes are never stored. */
enum class FixRejection(val wire: String) {
    INVALID_ACCURACY("invalid_accuracy"),
    NON_FINITE("non_finite"),
    ZERO_COORDINATES("zero_coordinates"),
    OUT_OF_RANGE("out_of_range"),
    NOT_NEWER("not_newer"),
    STALE_CACHED_FIX("stale_cached_fix"),
}

sealed interface FixDecision {
    data class Rejected(val reason: FixRejection) : FixDecision
    /** Valid and must be persisted. */
    data class Store(val lowQuality: Boolean) : FixDecision
    /** Valid, used for presentation, but arrived sooner than the profile's minimum sample interval. */
    data class PresentationOnly(val lowQuality: Boolean) : FixDecision
}

/** Fixes with h_acc above this are kept but flagged (the server skips them in stats too). */
const val LOW_QUALITY_H_ACC = 50.0

/** 1-D constant-velocity Kalman filter over GPS altitude: smoothed altitude + vertical speed estimate. */
class VerticalKalmanFilter(private val accelerationVariance: Double = 0.6) {
    var altitude: Double? = null
        private set
    var verticalSpeed: Double = 0.0
        private set
    private var p00 = 100.0
    private var p01 = 0.0
    private var p10 = 0.0
    private var p11 = 25.0
    private var lastTimeMs: Long? = null

    fun update(z: Double, verticalAccuracy: Double, timeMs: Long) {
        val r = (if (verticalAccuracy > 0) verticalAccuracy else 15.0).pow(2)
        val h = altitude
        val t0 = lastTimeMs
        if (h == null || t0 == null) {
            altitude = z; verticalSpeed = 0.0
            p00 = r; p01 = 0.0; p10 = 0.0; p11 = 25.0
            lastTimeMs = timeMs
            return
        }
        val dt = (timeMs - t0) / 1000.0
        if (dt <= 0) return
        if (dt > 60) { // long gap: restart rather than integrate garbage
            lastTimeMs = null; altitude = null
            update(z, verticalAccuracy, timeMs)
            return
        }
        val hp = h + verticalSpeed * dt
        val vp = verticalSpeed
        val q = accelerationVariance
        val dt2 = dt * dt; val dt3 = dt2 * dt; val dt4 = dt3 * dt
        val n00 = p00 + dt * (p10 + p01) + dt2 * p11 + q * dt4 / 4
        val n01 = p01 + dt * p11 + q * dt3 / 2
        val n10 = p10 + dt * p11 + q * dt3 / 2
        val n11 = p11 + q * dt2
        val s = n00 + r
        val k0 = n00 / s
        val k1 = n10 / s
        val y = z - hp
        altitude = hp + k0 * y
        verticalSpeed = vp + k1 * y
        p00 = (1 - k0) * n00
        p01 = (1 - k0) * n01
        p10 = n10 - k1 * n00
        p11 = n11 - k1 * n01
        lastTimeMs = timeMs
    }
}

/**
 * Validates raw fixes, flags quality, computes presentation values and running flight statistics.
 * Pure Kotlin: no Android types, no I/O.
 */
class TelemetryProcessor {
    var values = FlightValues()
        private set
    private var lastAcceptedMs: Long? = null
    private var lastStoredMs: Long? = null
    private var lastGood: RawFix? = null
    private var lastCourse: Pair<Double, Long>? = null
    private val kalman = VerticalKalmanFilter()
    private var ascentReference: Double? = null

    /** Altitude hysteresis for ascent/descent accumulation (filters GPS jitter). */
    var ascentThreshold = 3.0
    /** Fixes older than this on arrival are cached start-up fixes and are dropped. */
    var maxFixAgeMs = 30_000L

    /** @param receivedAtMs device clock when the fix was delivered. */
    fun process(fix: RawFix, profile: TrackingProfile, receivedAtMs: Long): FixDecision {
        validate(fix)?.let { values = values.copy(rejectedFixes = values.rejectedFixes + 1); return FixDecision.Rejected(it) }
        lastAcceptedMs?.let { if (fix.timeMs <= it) { reject(); return FixDecision.Rejected(FixRejection.NOT_NEWER) } }
        if (receivedAtMs - fix.timeMs > maxFixAgeMs) { reject(); return FixDecision.Rejected(FixRejection.STALE_CACHED_FIX) }

        var lowQuality = fix.hAcc > LOW_QUALITY_H_ACC
        val prev = lastGood
        if (!lowQuality && prev != null) {
            val dt = (fix.timeMs - prev.timeMs) / 1000.0
            val d = Geo.distance(prev.lat, prev.lon, fix.lat, fix.lon)
            // > 120 m/s between consecutive good fixes is not a paraglider.
            if (dt > 0 && dt < 120 && d / dt > 120) lowQuality = true
        }
        lastAcceptedMs = fix.timeMs
        updatePresentation(fix, lowQuality)

        val intervalMs = (profile.settings.minSampleIntervalS * 1000).toLong()
        lastStoredMs?.let { if (fix.timeMs - it < intervalMs - 50) return FixDecision.PresentationOnly(lowQuality) }
        lastStoredMs = fix.timeMs
        values = values.copy(acceptedSamples = values.acceptedSamples + 1)
        return FixDecision.Store(lowQuality)
    }

    private fun reject() { values = values.copy(rejectedFixes = values.rejectedFixes + 1) }

    private fun updatePresentation(fix: RawFix, lowQuality: Boolean) {
        // Some providers omit vertical accuracy; then the altitude is still used with a conservative default.
        val altValid = fix.altitude != null && fix.altitude.isFinite() && (fix.vAcc == null || fix.vAcc > 0)
        var v = values.copy(
            lastFixAt = fix.timeMs, lat = fix.lat, lon = fix.lon, hAcc = fix.hAcc, vAcc = fix.vAcc?.takeIf { it >= 0 },
            lowQuality = lowQuality, groundSpeed = fix.speed?.takeIf { it >= 0 }, heading = fix.course?.takeIf { it >= 0 },
            gpsAltitude = if (altValid) fix.altitude else fix.altitude?.takeIf { it.isFinite() },
        )
        val speed = fix.speed
        val course = fix.course
        if (course != null && course >= 0 && speed != null && speed > 2) {
            lastCourse?.let { (prevDeg, prevT) ->
                val dt = (fix.timeMs - prevT) / 1000.0
                if (dt > 0 && dt < 10) {
                    var delta = course - prevDeg
                    if (delta > 180) delta -= 360
                    if (delta < -180) delta += 360
                    val rate = delta / dt
                    val old = v.turnRate ?: rate
                    v = v.copy(turnRate = old + 0.3 * (rate - old))
                }
            }
            lastCourse = course to fix.timeMs
        } else {
            lastCourse = null
            v = v.copy(turnRate = v.turnRate?.let { it * 0.7 })
        }
        if (lowQuality) { values = v; return }

        if (altValid) {
            kalman.update(fix.altitude!!, fix.vAcc ?: 15.0, fix.timeMs)
            v = v.copy(smoothedAltitude = kalman.altitude, verticalSpeed = kalman.verticalSpeed)
            kalman.altitude?.let { alt ->
                v = v.copy(maxAltitude = maxOf(v.maxAltitude ?: alt, alt))
                val ref = ascentReference
                if (ref == null) ascentReference = alt else {
                    val delta = alt - ref
                    if (delta >= ascentThreshold) { v = v.copy(totalAscent = v.totalAscent + delta); ascentReference = alt }
                    else if (delta <= -ascentThreshold) { v = v.copy(totalDescent = v.totalDescent - delta); ascentReference = alt }
                }
            }
        }
        v.groundSpeed?.let { s -> v = v.copy(maxGroundSpeed = maxOf(v.maxGroundSpeed ?: s, s)) }
        lastGood?.let { p -> v = v.copy(distance = v.distance + Geo.distance(p.lat, p.lon, fix.lat, fix.lon)) }
        lastGood = fix
        values = v
    }

    companion object {
        fun validate(fix: RawFix): FixRejection? {
            if (fix.hAcc < 0 || fix.hAcc.isNaN()) return FixRejection.INVALID_ACCURACY
            if (!fix.lat.isFinite() || !fix.lon.isFinite() || !fix.hAcc.isFinite()) return FixRejection.NON_FINITE
            if (fix.lat == 0.0 && fix.lon == 0.0) return FixRejection.ZERO_COORDINATES
            if (abs(fix.lat) > 90 || abs(fix.lon) > 180) return FixRejection.OUT_OF_RANGE
            return null
        }
    }
}
