package com.mizibu.retfast

import com.mizibu.retfast.data.AppDatabase
import com.mizibu.retfast.data.Outbox
import com.mizibu.retfast.net.Retrieval
import com.mizibu.retfast.net.RetrievalPickup
import com.mizibu.retfast.retrieval.RetrievalManager
import com.mizibu.retfast.retrieval.RetrievalStage
import com.mizibu.retfast.retrieval.isTerminal
import com.mizibu.retfast.retrieval.stage
import com.mizibu.retfast.util.Backoff
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RetrievalManagerTest {
    private lateinit var server: MockWebServer
    private lateinit var routes: RouteDispatcher
    private lateinit var db: AppDatabase
    private val clock = FakeClock()
    private val pickup = RetrievalPickup(37.07, 29.34, 1200.0, 8.0, "2026-11-04T10:00:00.000Z")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)

    @Before fun setUp() {
        server = MockWebServer()
        routes = RouteDispatcher().also { server.dispatcher = it }
        server.start()
        db = memoryDb()
    }

    @After fun tearDown() { db.close(); server.shutdown() }

    private fun manager() = RetrievalManager(db, signedInClient(server), scope, clock, Backoff(2.0, 60.0) { 0.0 }, pollIntervalS = 15.0)

    private fun retrievalJson(id: String, status: String, extra: String = "") =
        """{"id":"$id","event_id":"e1","status":"$status","pickup":{"lat":37.07,"lon":29.34},"note":"n","requested_at":"2026-11-04T10:00:01.000Z" $extra}"""

    @Test fun requestIsPersistedBeforeAnyNetworkUse() = runBlocking {
        val m = manager()
        val r = m.request("E1", "Etkinlik", "f1", pickup, "  Yol kenarındayım ", startDelivery = false)
        assertEquals(0, routes.requests.size)
        val stored = db.retrievals().byId(r.id)!!
        assertEquals(Outbox.PENDING, stored.outbox)
        assertEquals("Yol kenarındayım", stored.note)
        assertEquals("e1", stored.eventId)
        assertEquals(RetrievalStage.SAVED_LOCALLY, stored.stage)
        assertFalse(stored.isTerminal)
    }

    @Test fun retryUsesTheSameClientIdAndFinallySucceeds() = runBlocking {
        val m = manager()
        val r = m.request("e1", "Ev", null, pickup, "", startDelivery = false)
        routes.on("POST /api/v1/events/e1/retrievals") { _, n -> if (n < 3) errorBody(503, "unavailable") else json(201, retrievalJson(r.id, "requested")) }
        val d1 = m.step(r.id)
        assertNotNull(d1)
        assertEquals(RetrievalStage.SENDING, db.retrievals().byId(r.id)!!.stage)
        m.step(r.id)
        assertEquals(1.0, m.step(r.id)!! - 14.0, 1e-9) // poll interval 15 s after success
        val ids = routes.bodies("POST /api/v1/events/e1/retrievals").map { Regex("\"id\":\"([^\"]+)\"").find(it)!!.groupValues[1] }
        assertEquals(3, ids.size)
        assertEquals(setOf(r.id), ids.toSet())
        val s = db.retrievals().byId(r.id)!!
        assertEquals(Outbox.SENT, s.outbox)
        assertEquals(3, s.attemptCount)
    }

    @Test fun conflictAdoptsTheOpenRetrievalFromDetails() = runBlocking {
        val m = manager()
        val local = m.request("e1", "Ev", null, pickup, "yeni", startDelivery = false)
        val open = "0b2c0000-0000-4000-8000-000000000001"
        routes.on("POST /api/v1/events/e1/retrievals", errorBody(409, "conflict", """{"retrieval_id":"$open"}"""))
        routes.on("GET /api/v1/retrievals/$open", json(200, retrievalJson(open, "accepted", ""","retriever":{"user_id":"r1","full_name":"Kübra","phone":"+905551112233"}""")))
        assertNull(m.step(local.id))
        assertEquals(Outbox.MERGED, db.retrievals().byId(local.id)!!.outbox)
        assertEquals(open, db.retrievals().byId(local.id)!!.mergedInto)
        val adopted = db.retrievals().byId(open)!!
        assertEquals(Outbox.SENT, adopted.outbox)
        assertEquals(RetrievalStage.ACCEPTED, adopted.stage)
        assertEquals(open, m.active()!!.id)
    }

    @Test fun conflictWithoutDetailsFindsTheOpenOneInTheEventList() = runBlocking {
        val m = manager()
        val local = m.request("e1", "Ev", null, pickup, "", startDelivery = false)
        val open = "0b2c0000-0000-4000-8000-000000000002"
        routes.on("POST /api/v1/events/e1/retrievals", errorBody(409, "conflict"))
        routes.on("GET /api/v1/events/e1/retrievals", json(200, """{"items":[${retrievalJson(open, "requested")}]}"""))
        m.step(local.id)
        assertEquals(Outbox.MERGED, db.retrievals().byId(local.id)!!.outbox)
        assertNotNull(db.retrievals().byId(open))
    }

    @Test fun conflictOnOurOwnIdMeansTheFirstResponseWasLost() = runBlocking {
        val m = manager()
        val local = m.request("e1", "Ev", null, pickup, "", startDelivery = false)
        routes.on("POST /api/v1/events/e1/retrievals", errorBody(409, "conflict", """{"retrieval_id":"${local.id}"}"""))
        routes.on("GET /api/v1/retrievals/${local.id}", json(200, retrievalJson(local.id, "requested")))
        m.step(local.id)
        val s = db.retrievals().byId(local.id)!!
        assertEquals(Outbox.SENT, s.outbox)
        assertEquals(RetrievalStage.REQUESTED, s.stage)
    }

    @Test fun cancelBeforeAnySendIsLocalOnly() = runBlocking {
        val m = manager()
        val r = m.request("e1", "Ev", null, pickup, "", startDelivery = false)
        m.cancel(r.id, "kendim döndüm", startDelivery = false)
        val s = db.retrievals().byId(r.id)!!
        assertTrue(s.isTerminal)
        assertEquals(RetrievalStage.CANCELLED, s.stage)
        assertEquals(0, routes.requests.size)
    }

    @Test fun cancelAfterSendIsDeliveredToTheServer() = runBlocking {
        val m = manager()
        val r = m.request("e1", "Ev", null, pickup, "", startDelivery = false)
        routes.on("POST /api/v1/events/e1/retrievals", json(201, retrievalJson(r.id, "requested")))
        routes.on("POST /api/v1/retrievals/${r.id}/cancel", json(200, retrievalJson(r.id, "cancelled")))
        m.step(r.id)
        m.cancel(r.id, "kendim döndüm", startDelivery = false)
        assertEquals(RetrievalStage.CANCELLING, db.retrievals().byId(r.id)!!.stage)
        m.step(r.id)
        assertEquals(RetrievalStage.CANCELLED, db.retrievals().byId(r.id)!!.stage)
        assertTrue(db.retrievals().byId(r.id)!!.isTerminal)
        assertTrue(routes.bodies("POST /api/v1/retrievals/${r.id}/cancel").single().contains("kendim"))
    }

    @Test fun ladderTicksOnlyOnServerState() = runBlocking {
        val m = manager()
        val r = m.request("e1", "Ev", null, pickup, "", startDelivery = false)
        assertNull(db.retrievals().byId(r.id)!!.stage.confirmedStep)
        routes.on("POST /api/v1/events/e1/retrievals", json(201, retrievalJson(r.id, "requested")))
        m.step(r.id)
        assertEquals(0, db.retrievals().byId(r.id)!!.stage.confirmedStep)
        routes.on("GET /api/v1/retrievals/${r.id}", json(200, retrievalJson(r.id, "picked_up")))
        m.step(r.id)
        assertEquals(2, db.retrievals().byId(r.id)!!.stage.confirmedStep)
        routes.on("GET /api/v1/retrievals/${r.id}", json(200, retrievalJson(r.id, "delivered")))
        assertNull(m.step(r.id))
        assertEquals(RetrievalStage.DELIVERED, db.retrievals().byId(r.id)!!.stage)
        assertTrue(db.retrievals().byId(r.id)!!.isTerminal)
    }

    @Test fun permanentlyRefusedRequestIsMarkedRefused() = runBlocking {
        val m = manager()
        val r = m.request("e1", "Ev", null, pickup, "", startDelivery = false)
        routes.on("POST /api/v1/events/e1/retrievals", errorBody(403, "forbidden"))
        assertNull(m.step(r.id))
        val s = db.retrievals().byId(r.id)!!
        assertEquals(Outbox.REFUSED, s.outbox)
        assertEquals("forbidden", s.lastError)
        assertEquals(RetrievalStage.REFUSED, s.stage)
    }

    @Test fun realtimeCopyIsAppliedToAKnownRequestOnly() = runBlocking {
        val m = manager()
        val r = m.request("e1", "Ev", null, pickup, "", startDelivery = false)
        val server = com.mizibu.retfast.net.ApiJson.decodeFromString(Retrieval.serializer(), retrievalJson(r.id, "accepted", ""","retriever":{"user_id":"r1","full_name":"Kübra"}"""))
        m.apply(server)
        assertEquals(RetrievalStage.ACCEPTED, db.retrievals().byId(r.id)!!.stage)
        m.apply(server.copy(id = "unknown"))
        assertNull(db.retrievals().byId("unknown"))
    }
}
