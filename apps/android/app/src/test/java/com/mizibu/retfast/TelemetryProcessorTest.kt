package com.mizibu.retfast

import com.mizibu.retfast.tracking.FixDecision
import com.mizibu.retfast.tracking.FixRejection
import com.mizibu.retfast.tracking.RawFix
import com.mizibu.retfast.tracking.TelemetryProcessor
import com.mizibu.retfast.tracking.TrackingProfile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TelemetryProcessorTest {
    private val t0 = 1_700_000_000_000L
    private fun fix(t: Long, lat: Double = 37.07, lon: Double = 29.34, alt: Double? = 2000.0, hAcc: Double = 5.0, vAcc: Double? = 4.0, speed: Double? = 8.0, course: Double? = 90.0) =
        RawFix(t, lat, lon, alt, hAcc, vAcc, speed, course)

    @Test fun invalidFixesAreRejectedAndCounted() {
        val p = TelemetryProcessor()
        assertEquals(FixDecision.Rejected(FixRejection.INVALID_ACCURACY), p.process(fix(t0, hAcc = -1.0), TrackingProfile.ACTIVE_FLIGHT, t0))
        assertEquals(FixDecision.Rejected(FixRejection.ZERO_COORDINATES), p.process(fix(t0, lat = 0.0, lon = 0.0), TrackingProfile.ACTIVE_FLIGHT, t0))
        assertEquals(FixDecision.Rejected(FixRejection.OUT_OF_RANGE), p.process(fix(t0, lat = 95.0), TrackingProfile.ACTIVE_FLIGHT, t0))
        assertEquals(FixDecision.Rejected(FixRejection.NON_FINITE), p.process(fix(t0, lat = Double.NaN), TrackingProfile.ACTIVE_FLIGHT, t0))
        assertEquals(4, p.values.rejectedFixes)
        assertEquals(0, p.values.acceptedSamples)
        assertNull(p.values.lat)
    }

    @Test fun duplicateAndOutOfOrderFixesAreRejected() {
        val p = TelemetryProcessor()
        assertTrue(p.process(fix(t0), TrackingProfile.ACTIVE_FLIGHT, t0) is FixDecision.Store)
        assertEquals(FixDecision.Rejected(FixRejection.NOT_NEWER), p.process(fix(t0), TrackingProfile.ACTIVE_FLIGHT, t0))
        assertEquals(FixDecision.Rejected(FixRejection.NOT_NEWER), p.process(fix(t0 - 1000), TrackingProfile.ACTIVE_FLIGHT, t0))
    }

    @Test fun staleCachedStartupFixIsDropped() {
        val p = TelemetryProcessor()
        assertEquals(FixDecision.Rejected(FixRejection.STALE_CACHED_FIX), p.process(fix(t0), TrackingProfile.ACTIVE_FLIGHT, t0 + 120_000))
    }

    @Test fun minSampleIntervalMakesFastFixesPresentationOnly() {
        val p = TelemetryProcessor()
        assertTrue(p.process(fix(t0), TrackingProfile.CRUISE, t0) is FixDecision.Store)
        assertTrue(p.process(fix(t0 + 1000), TrackingProfile.CRUISE, t0 + 1000) is FixDecision.PresentationOnly)
        assertTrue(p.process(fix(t0 + 2000), TrackingProfile.CRUISE, t0 + 2000) is FixDecision.PresentationOnly)
        assertTrue(p.process(fix(t0 + 3000), TrackingProfile.CRUISE, t0 + 3000) is FixDecision.Store)
        assertEquals(2, p.values.acceptedSamples)
    }

    @Test fun poorAccuracyIsKeptButFlaggedAndExcludedFromDistance() {
        val p = TelemetryProcessor()
        p.process(fix(t0, lat = 37.0), TrackingProfile.ACTIVE_FLIGHT, t0)
        val d = p.process(fix(t0 + 1000, lat = 37.001, hAcc = 80.0), TrackingProfile.ACTIVE_FLIGHT, t0 + 1000)
        assertEquals(FixDecision.Store(lowQuality = true), d)
        assertEquals(0.0, p.values.distance, 0.0)
        p.process(fix(t0 + 2000, lat = 37.0001), TrackingProfile.ACTIVE_FLIGHT, t0 + 2000)
        assertTrue(p.values.distance in 8.0..14.0)
    }

    @Test fun impossibleJumpIsFlaggedLowQuality() {
        val p = TelemetryProcessor()
        p.process(fix(t0), TrackingProfile.ACTIVE_FLIGHT, t0)
        val d = p.process(fix(t0 + 1000, lat = 37.5), TrackingProfile.ACTIVE_FLIGHT, t0 + 1000)
        assertEquals(FixDecision.Store(lowQuality = true), d)
    }

    @Test fun verticalSpeedEstimateFollowsClimb() {
        val p = TelemetryProcessor()
        for (i in 0..40) p.process(fix(t0 + i * 1000L, alt = 1500.0 + i * 2.0, vAcc = 3.0), TrackingProfile.ACTIVE_FLIGHT, t0 + i * 1000L)
        val vs = p.values.verticalSpeed
        assertNotNull(vs)
        assertTrue("vario $vs", vs!! in 1.5..2.5)
        assertNotNull(p.values.maxAltitude)
    }

    @Test fun missingVerticalAccuracyStillGivesAltitude() {
        val p = TelemetryProcessor()
        p.process(fix(t0, alt = 1234.0, vAcc = null), TrackingProfile.ACTIVE_FLIGHT, t0)
        assertEquals(1234.0, p.values.gpsAltitude!!, 0.0)
    }

    @Test fun ascentAccumulatesOnlyAboveHysteresis() {
        val p = TelemetryProcessor()
        // +-1 m jitter must not count
        for (i in 0..20) p.process(fix(t0 + i * 1000L, alt = 1500.0 + (if (i % 2 == 0) 0.5 else -0.5)), TrackingProfile.ACTIVE_FLIGHT, t0 + i * 1000L)
        assertEquals(0.0, p.values.totalAscent, 0.01)
    }
}
