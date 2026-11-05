package com.mizibu.retfast

import com.mizibu.retfast.data.RetrievalEntity
import com.mizibu.retfast.domain.ApplicationState
import com.mizibu.retfast.domain.AuthGate
import com.mizibu.retfast.domain.EventSheetMode
import com.mizibu.retfast.domain.PasswordPolicy
import com.mizibu.retfast.net.ApplicationRef
import com.mizibu.retfast.net.Event
import com.mizibu.retfast.net.EventMe
import com.mizibu.retfast.net.EventSettings
import com.mizibu.retfast.net.Me
import com.mizibu.retfast.retrieval.RetrieverDuty
import com.mizibu.retfast.retrieval.SharingMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DomainTest {
    private fun event(role: String? = null, organizer: Boolean = false, app: ApplicationRef? = null, open: Boolean = true, publicMap: Boolean = false) =
        Event(id = "e1", me = EventMe(organizer, role, app), settings = EventSettings(applicationsOpen = open, publicLiveMap = publicMap))

    @Test fun roleMapsToSheet() {
        assertEquals(EventSheetMode.Pilot, EventSheetMode.forEvent(event("pilot")))
        assertEquals(EventSheetMode.Retriever, EventSheetMode.forEvent(event("retriever")))
        assertEquals(EventSheetMode.Observer, EventSheetMode.forEvent(event("observer")))
        assertEquals(EventSheetMode.OrganizerOnly, EventSheetMode.forEvent(event(organizer = true)))
        // an organizer who also flies gets the pilot sheet plus organizer tools
        assertEquals(EventSheetMode.Pilot, EventSheetMode.forEvent(event("pilot", organizer = true)))
        assertTrue(EventSheetMode.showsOrganizerTools(event("pilot", organizer = true)))
        assertFalse(EventSheetMode.showsOrganizerTools(event("pilot")))
    }

    @Test fun nonMemberStatesNeverOfferARoleChoice() {
        assertEquals(EventSheetMode.NotMember(ApplicationState.CanApply), EventSheetMode.forEvent(event()))
        assertEquals(EventSheetMode.NotMember(ApplicationState.Closed), EventSheetMode.forEvent(event(open = false)))
        assertEquals(EventSheetMode.NotMember(ApplicationState.Pending("a1")), EventSheetMode.forEvent(event(app = ApplicationRef("a1", "pending"))))
        assertEquals(EventSheetMode.NotMember(ApplicationState.Rejected("a1", true)), EventSheetMode.forEvent(event(app = ApplicationRef("a1", "rejected"))))
        assertEquals(EventSheetMode.NotMember(ApplicationState.Withdrawn("a1", false)), EventSheetMode.forEvent(event(app = ApplicationRef("a1", "withdrawn"), open = false)))
        // approved but role removed afterwards -> may apply again
        assertEquals(EventSheetMode.NotMember(ApplicationState.CanApply), EventSheetMode.forEvent(event(app = ApplicationRef("a1", "approved"))))
    }

    @Test fun pilotLayerVisibilityFollowsRole() {
        assertTrue(EventSheetMode.showsPilotLayer(event("observer")))
        assertTrue(EventSheetMode.showsPilotLayer(event(organizer = true)))
        assertFalse(EventSheetMode.showsPilotLayer(event("retriever")))
        assertFalse(EventSheetMode.showsPilotLayer(event()))
        assertTrue(EventSheetMode.showsPilotLayer(event(publicMap = true)))
    }

    @Test fun forcedPasswordGateLocksTheApp() {
        assertEquals(AuthGate.SignedOut, AuthGate.of(null))
        assertEquals(AuthGate.MustChangePassword, AuthGate.of(Me(id = "u", mustChangePassword = true)))
        assertEquals(AuthGate.Open, AuthGate.of(Me(id = "u", mustChangePassword = false)))
    }

    @Test fun passwordPolicyMirrorsServerBasics() {
        assertEquals("too_short", PasswordPolicy.problem("short", "a@b.c"))
        assertEquals("equals_email", PasswordPolicy.problem("USER@example.com", "user@example.com"))
        assertNull(PasswordPolicy.problem("a-long-enough-password", "a@b.c"))
    }

    @Test fun sharingModeFollowsRetrievalAndDuty() {
        val sent = RetrievalEntity(id = "r1", eventId = "e1", eventName = null, flightId = null, pickupLat = 1.0, pickupLon = 1.0, pickupAlt = null, pickupHAcc = null, pickupT = 0, note = "", createdAt = 0, outbox = "sent", serverStatus = "accepted", updatedAt = 0)
        assertEquals(SharingMode.PilotWaiting("r1", "e1"), SharingMode.decide(sent, null))
        // picked up: the pilot is in the car, stop sharing
        assertEquals(SharingMode.Off, SharingMode.decide(sent.copy(serverStatus = "picked_up"), null))
        // not yet confirmed by the server: do not share
        assertEquals(SharingMode.Off, SharingMode.decide(sent.copy(outbox = "pending", serverStatus = null), null))
        val duty = RetrieverDuty("e2", "Ev", onDuty = true)
        assertEquals(SharingMode.Retriever("e2"), SharingMode.decide(null, duty))
        // off duty but holding pickups still shares
        assertEquals(SharingMode.Retriever("e2"), SharingMode.decide(null, duty.copy(onDuty = false, activePickups = 1)))
        assertEquals(SharingMode.Off, SharingMode.decide(null, duty.copy(onDuty = false)))
        // a waiting pilot wins over duty in another event
        assertEquals(SharingMode.PilotWaiting("r1", "e1"), SharingMode.decide(sent, duty))
    }

    @Test fun sharingIsDueOnlyWithNewerFixAfterInterval() {
        assertFalse(SharingMode.isDue(100_000, null, null, null, 30.0))
        assertTrue(SharingMode.isDue(100_000, null, null, 99_000, 30.0))
        assertFalse(SharingMode.isDue(120_000, 100_000, 99_000, 119_000, 30.0))
        assertTrue(SharingMode.isDue(131_000, 100_000, 99_000, 130_000, 30.0))
        assertFalse(SharingMode.isDue(131_000, 100_000, 130_000, 130_000, 30.0))
    }
}
