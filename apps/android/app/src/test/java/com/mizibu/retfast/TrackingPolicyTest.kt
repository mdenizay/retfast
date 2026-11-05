package com.mizibu.retfast

import com.mizibu.retfast.tracking.LandingPromptDetector
import com.mizibu.retfast.tracking.PolicyInput
import com.mizibu.retfast.tracking.TrackingPolicy
import com.mizibu.retfast.tracking.TrackingProfile
import com.mizibu.retfast.tracking.settings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TrackingPolicyTest {
    private fun feed(p: TrackingPolicy, from: Long, seconds: Int, speed: Double?, vario: Double?, turn: Double? = 0.0) {
        for (s in 0..seconds) p.evaluate(PolicyInput(from + s * 1000L, speed, vario, turn))
    }

    @Test fun staysPreFlightWhileStanding() {
        val p = TrackingPolicy()
        feed(p, 0, 60, 0.5, 0.0)
        assertEquals(TrackingProfile.PRE_FLIGHT, p.profile)
        assertFalse(p.airborne)
    }

    @Test fun singleNoisyFixDoesNotFlipProfile() {
        val p = TrackingPolicy()
        p.evaluate(PolicyInput(0, 9.0, 0.0, 0.0))
        p.evaluate(PolicyInput(1000, 0.2, 0.0, 0.0))
        p.evaluate(PolicyInput(2000, 0.2, 0.0, 0.0))
        assertEquals(TrackingProfile.PRE_FLIGHT, p.profile)
    }

    @Test fun takeoffNeedsFiveSecondsOfSpeed() {
        val p = TrackingPolicy()
        feed(p, 0, 3, 6.0, 0.0)
        assertEquals(TrackingProfile.PRE_FLIGHT, p.profile)
        feed(p, 3000, 4, 6.0, 0.0)
        assertEquals(TrackingProfile.ACTIVE_FLIGHT, p.profile)
        assertTrue(p.airborne)
    }

    @Test fun thermalThenCruiseThenLanding() {
        val p = TrackingPolicy(TrackingProfile.ACTIVE_FLIGHT, airborne = true)
        feed(p, 0, 12, 8.0, 1.2, turn = 15.0)
        assertEquals(TrackingProfile.THERMAL, p.profile)
        feed(p, 20_000, 25, 11.0, 0.0, turn = 1.0)
        assertEquals(TrackingProfile.CRUISE, p.profile)
        feed(p, 60_000, 31, 0.8, 0.0, turn = 0.0)
        assertEquals(TrackingProfile.LANDING, p.profile)
    }

    @Test fun landingNeedsThirtySeconds() {
        val p = TrackingPolicy(TrackingProfile.CRUISE, airborne = true)
        feed(p, 0, 20, 0.5, 0.0)
        assertEquals(TrackingProfile.CRUISE, p.profile)
        feed(p, 20_000, 15, 0.5, 0.0)
        assertEquals(TrackingProfile.LANDING, p.profile)
    }

    @Test fun missingValuesNeverChangeProfile() {
        val p = TrackingPolicy(TrackingProfile.CRUISE, airborne = true)
        feed(p, 0, 120, null, null, null)
        assertEquals(TrackingProfile.CRUISE, p.profile)
    }

    @Test fun profilesCarryExpectedIntervals() {
        assertEquals(30.0, TrackingProfile.RETRIEVE_WAITING.settings.minSampleIntervalS, 0.0)
        assertEquals(15.0, TrackingProfile.RETRIEVER_DRIVING.settings.minSampleIntervalS, 0.0)
        assertEquals(1.0, TrackingProfile.THERMAL.settings.minSampleIntervalS, 0.0)
        assertEquals(3.0, TrackingProfile.CRUISE.settings.minSampleIntervalS, 0.0)
        assertFalse(TrackingProfile.RETRIEVE_WAITING.isFlightProfile)
        assertTrue(TrackingProfile.LANDING.isFlightProfile)
    }

    @Test fun sharingProfileAsInitialBecomesActiveFlight() {
        assertEquals(TrackingProfile.ACTIVE_FLIGHT, TrackingPolicy(TrackingProfile.RETRIEVE_WAITING).profile)
    }

    @Test fun landingPromptFiresOncePerEpisodeAndSnoozes() {
        val d = LandingPromptDetector(enabled = true, snoozeS = 120)
        assertFalse(d.observe(TrackingProfile.CRUISE, true, 0))
        assertTrue(d.observe(TrackingProfile.LANDING, true, 1000))
        assertFalse(d.observe(TrackingProfile.LANDING, true, 2000))
        d.snooze(2000)
        // leave landing and come back inside the snooze window: no prompt
        d.observe(TrackingProfile.ACTIVE_FLIGHT, true, 3000)
        assertFalse(d.observe(TrackingProfile.LANDING, true, 4000))
        // after the snooze window a new episode prompts again
        d.observe(TrackingProfile.ACTIVE_FLIGHT, true, 5000)
        assertTrue(d.observe(TrackingProfile.LANDING, true, 200_000))
    }

    @Test fun landingPromptDisabledOrNotRecordingNeverFires() {
        assertFalse(LandingPromptDetector(enabled = false).observe(TrackingProfile.LANDING, true, 0))
        assertFalse(LandingPromptDetector(enabled = true).observe(TrackingProfile.LANDING, false, 0))
    }
}
