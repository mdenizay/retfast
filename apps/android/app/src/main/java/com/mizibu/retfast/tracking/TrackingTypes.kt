package com.mizibu.retfast.tracking

/** Location sampling profiles. `wire` is what goes into `meta.profile`. */
enum class TrackingProfile(val wire: String) {
    PRE_FLIGHT("pre_flight"),
    ACTIVE_FLIGHT("active_flight"),
    THERMAL("thermal"),
    CRUISE("cruise"),
    LANDING("landing"),

    /** Pilot landed and waits for a retrieve: walking pace, shared about every 30 s. */
    RETRIEVE_WAITING("retrieve_waiting"),

    /** Retriever on duty / driving to pilots: shared about every 15 s. */
    RETRIEVER_DRIVING("retriever_driving");

    val isFlightProfile: Boolean get() = this != RETRIEVE_WAITING && this != RETRIEVER_DRIVING

    companion object {
        fun fromWire(s: String?) = entries.firstOrNull { it.wire == s }
    }
}

/**
 * What a profile asks the location provider for. These are targets: Android decides the real
 * delivery rate (Doze, battery saver and OEM policies may reduce it).
 */
data class ProfileSettings(
    val highAccuracy: Boolean,
    val intervalMs: Long,
    val fastestIntervalMs: Long,
    val minDistanceM: Float,
    /** Minimum spacing between *stored/shared* samples. Faster fixes are used for presentation only. */
    val minSampleIntervalS: Double,
)

val TrackingProfile.settings: ProfileSettings
    get() = when (this) {
        // On the launch: a good fix, no need to store every second; no distance filter so a
        // standing pilot still gets fresh fixes.
        TrackingProfile.PRE_FLIGHT -> ProfileSettings(true, 2_000, 1_000, 0f, 5.0)
        TrackingProfile.ACTIVE_FLIGHT -> ProfileSettings(true, 1_000, 500, 0f, 1.0)
        // Tight circles: every fix matters for the climb trace.
        TrackingProfile.THERMAL -> ProfileSettings(true, 1_000, 500, 0f, 1.0)
        // Straight glides: one sample every 3 s is enough for route and live map.
        TrackingProfile.CRUISE -> ProfileSettings(true, 1_000, 500, 0f, 3.0)
        TrackingProfile.LANDING -> ProfileSettings(true, 1_000, 500, 0f, 2.0)
        // Landed pilot: fixes every ~15 s, shared at most every 30 s.
        TrackingProfile.RETRIEVE_WAITING -> ProfileSettings(true, 15_000, 5_000, 0f, 30.0)
        // Car on mountain roads: shared every ~15 s.
        TrackingProfile.RETRIEVER_DRIVING -> ProfileSettings(true, 10_000, 5_000, 0f, 15.0)
    }

/** A fix as delivered by the platform, decoupled from android.location.Location so it is JVM-testable. */
data class RawFix(
    val timeMs: Long,
    val lat: Double,
    val lon: Double,
    val altitude: Double? = null,
    /** Negative or NaN = invalid. */
    val hAcc: Double,
    val vAcc: Double? = null,
    val speed: Double? = null,
    val course: Double? = null,
    val isMock: Boolean = false,
)

enum class FlightPhase { IDLE, RECORDING, ENDED }

/** Values shown on the flight computer. Stored samples always keep the raw values. */
data class FlightValues(
    val gpsAltitude: Double? = null,
    val smoothedAltitude: Double? = null,
    /** Filtered GPS estimate (m/s, + = climb). NOT a barometric variometer. */
    val verticalSpeed: Double? = null,
    val groundSpeed: Double? = null,
    val heading: Double? = null,
    val turnRate: Double? = null,
    val hAcc: Double? = null,
    val vAcc: Double? = null,
    val lastFixAt: Long? = null,
    val lat: Double? = null,
    val lon: Double? = null,
    val lowQuality: Boolean = false,
    val distance: Double = 0.0,
    val maxAltitude: Double? = null,
    val maxGroundSpeed: Double? = null,
    val totalAscent: Double = 0.0,
    val totalDescent: Double = 0.0,
    val acceptedSamples: Int = 0,
    val rejectedFixes: Int = 0,
)
