package com.mizibu.retfast

import com.mizibu.retfast.data.AppDatabase
import com.mizibu.retfast.data.SampleStatus
import com.mizibu.retfast.net.ApiJson
import com.mizibu.retfast.net.BatchRequest
import com.mizibu.retfast.net.DeviceInfo
import com.mizibu.retfast.sync.SyncEngine
import com.mizibu.retfast.sync.SyncOutcome
import com.mizibu.retfast.sync.SyncStatus
import com.mizibu.retfast.util.Backoff
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SyncEngineTest {
    private lateinit var server: MockWebServer
    private lateinit var routes: RouteDispatcher
    private lateinit var db: AppDatabase
    private val clock = FakeClock()

    @Before fun setUp() {
        server = MockWebServer()
        routes = RouteDispatcher().also { server.dispatcher = it }
        server.start()
        db = memoryDb()
        routes.on("POST /api/v1/flights", json(201, """{"id":"f1"}"""))
        routes.on("POST /api/v1/flights/f1/end", json(200, """{"id":"f1"}"""))
    }

    @After fun tearDown() { db.close(); server.shutdown() }

    private fun engine(api: com.mizibu.retfast.net.ApiClient = signedInClient(server), backoff: Backoff = Backoff(2.0, 120.0) { 0.0 }) =
        SyncEngine(db, api, clock, backoff, DeviceInfo("android", "4.1.0", "14"))

    private fun ackAll(): (okhttp3.mockwebserver.RecordedRequest, Int) -> MockResponse = { req, _ ->
        val b = ApiJson.decodeFromString(BatchRequest.serializer(), req.body.clone().readUtf8())
        val seqs = b.samples.map { it.seq }
        json(200, """{"batch_id":"${b.batchId}","accepted":${seqs},"duplicate":[],"rejected":[],"max_acked_seq":${seqs.max()}}""")
    }

    @Test fun batchesAtMost500AndMarksSynced() = runBlocking {
        db.seedFlight("f1", 1200)
        routes.on("POST /api/v1/telemetry/batches", ackAll())
        val e = engine()
        var guard = 0
        while (e.syncOnce() == SyncOutcome.Progressed && guard++ < 10) {}
        val sizes = routes.bodies("POST /api/v1/telemetry/batches").map { ApiJson.decodeFromString(BatchRequest.serializer(), it).samples.size }
        assertEquals(listOf(500, 500, 200), sizes)
        assertEquals(0, db.samples().pendingCount())
        assertEquals(SyncStatus.SYNCED, e.snapshot.value.status)
        // the finished flight is ended on the server only after everything is acknowledged
        assertEquals(1, routes.count("POST /api/v1/flights/f1/end"))
    }

    @Test fun duplicateIsAckedAndRejectedIsKeptNotRetried() = runBlocking {
        db.seedFlight("f1", 5)
        routes.on("POST /api/v1/telemetry/batches") { req, _ ->
            val b = ApiJson.decodeFromString(BatchRequest.serializer(), req.body.clone().readUtf8())
            json(200, """{"batch_id":"${b.batchId}","accepted":[0,1],"duplicate":[2],"rejected":[{"seq":3,"reason":"invalid_coordinates"}],"max_acked_seq":2}""")
        }
        val e = engine()
        while (e.syncOnce() == SyncOutcome.Progressed) {}
        val all = db.samples().forFlight("f1").associateBy { it.seq }
        assertEquals(SampleStatus.SYNCED, all[0]!!.status)
        assertEquals(SampleStatus.SYNCED, all[2]!!.status) // duplicate counts as acknowledged
        assertEquals(SampleStatus.REJECTED, all[3]!!.status)
        assertEquals("invalid_coordinates", all[3]!!.rejectReason)
        assertEquals(5, all.size) // nothing deleted
        // seq 4 was not classified by the server: it must return to the pool and be re-sent, not marked synced
        assertEquals(SampleStatus.PENDING, all[4]!!.status)
        assertTrue(routes.count("POST /api/v1/telemetry/batches") >= 2)
    }

    @Test fun failedBatchIsResentWithTheSameBatchIdAndSamples() = runBlocking {
        db.seedFlight("f1", 10)
        routes.on("POST /api/v1/telemetry/batches") { req, n ->
            if (n == 1) errorBody(500, "internal") else ackAll()(req, n)
        }
        val e = engine()
        assertTrue(e.syncOnce() is SyncOutcome.Failed)
        assertEquals(10, db.samples().pendingCount())
        assertEquals(SyncOutcome.Progressed, e.syncOnce())
        val ids = routes.bodies("POST /api/v1/telemetry/batches").map { ApiJson.decodeFromString(BatchRequest.serializer(), it) }
        assertEquals(2, ids.size)
        assertEquals(ids[0].batchId, ids[1].batchId)
        assertEquals(ids[0].samples.map { it.id }, ids[1].samples.map { it.id })
        assertEquals(0, db.samples().pendingCount())
    }

    @Test fun tokenExpiredRefreshesOnceAndRetriesTheSameBatch() = runBlocking {
        db.seedFlight("f1", 4)
        routes.on("POST /api/v1/auth/refresh", json(200, authJson("access-9", "refresh-9")))
        routes.on("POST /api/v1/telemetry/batches") { req, n ->
            if (req.getHeader("Authorization") == "Bearer access-9") ackAll()(req, n) else errorBody(401, "token_expired")
        }
        val api = signedInClient(server)
        val e = engine(api)
        assertEquals(SyncOutcome.Progressed, e.syncOnce())
        assertEquals(1, routes.count("POST /api/v1/auth/refresh"))
        val b = routes.bodies("POST /api/v1/telemetry/batches").map { ApiJson.decodeFromString(BatchRequest.serializer(), it).batchId }
        assertEquals(2, b.size)
        assertEquals(b[0], b[1])
        assertEquals(0, db.samples().pendingCount())
    }

    @Test fun refusedRefreshStopsSyncWithAuthRequiredAndKeepsData() = runBlocking {
        db.seedFlight("f1", 3)
        routes.on("POST /api/v1/auth/refresh", errorBody(401, "unauthorized"))
        routes.on("POST /api/v1/telemetry/batches", errorBody(401, "token_expired"))
        val e = engine()
        assertEquals(SyncOutcome.AuthRequired, e.syncOnce())
        assertEquals(SyncStatus.AUTH_REQUIRED, e.snapshot.value.status)
        assertEquals(3, db.samples().pendingCount())
        // blocked until authRestored
        val before = routes.requests.size
        assertEquals(SyncOutcome.AuthRequired, e.syncOnce())
        assertEquals(before, routes.requests.size)
    }

    @Test fun backoffGrowsWithJitterAndHonoursRetryAfter() = runBlocking {
        db.seedFlight("f1", 3)
        routes.on("POST /api/v1/telemetry/batches") { _, n -> if (n == 4) errorBody(429, "rate_limited").setHeader("Retry-After", "42") else errorBody(503, "unavailable") }
        val e = engine(backoff = Backoff(2.0, 120.0) { 1.0 })
        e.runLoop(maxIterations = 4)
        assertEquals(listOf(2.0, 4.0, 8.0, 42.0), clock.sleeps.toList())
        assertEquals(3, db.samples().pendingCount())
        assertEquals(SyncStatus.SERVER_ERROR, e.snapshot.value.status)
    }

    @Test fun backoffIsCappedAndJittered() {
        val b = Backoff(2.0, 120.0) { 0.0 }
        assertEquals(1.0, b.delay(0), 1e-9)
        assertEquals(60.0, b.delay(10), 1e-9) // 120 cap, jitter 0 -> 50%
        val c = Backoff(2.0, 120.0) { 1.0 }
        assertEquals(120.0, c.delay(20), 1e-9)
        assertNotEquals(b.delay(3), c.delay(3), 0.0)
    }

    @Test fun malformedBatchIsRejectedLocallyButNeverDeleted() = runBlocking {
        db.seedFlight("f1", 3)
        routes.on("POST /api/v1/telemetry/batches", errorBody(422, "validation_failed"))
        val e = engine()
        assertEquals(SyncOutcome.Progressed, e.syncOnce())
        val s = db.samples().forFlight("f1")
        assertEquals(3, s.size)
        assertTrue(s.all { it.status == SampleStatus.REJECTED })
    }

    @Test fun refusedFlightCreationKeepsSamplesAndDoesNotBlockOthers() = runBlocking {
        db.seedFlight("f1", 3, baseT = 1_700_000_000_000L)
        db.seedFlight("f2", 2, baseT = 1_700_000_100_000L)
        routes.on("POST /api/v1/flights") { req, _ -> if (req.body.clone().readUtf8().contains("\"f1\"")) errorBody(403, "forbidden") else json(201, """{"id":"f2"}""") }
        routes.on("POST /api/v1/flights/f2/end", json(200, "{}"))
        routes.on("POST /api/v1/telemetry/batches", ackAll())
        val e = engine()
        var guard = 0
        while (e.syncOnce() == SyncOutcome.Progressed && guard++ < 10) {}
        assertEquals(3, db.samples().pendingCount("f1")) // kept, unsynced
        assertEquals(0, db.samples().pendingCount("f2"))
        assertEquals(true, db.flights().byId("f1")!!.createRefused)
        assertEquals("forbidden", db.flights().byId("f1")!!.lastError)
    }

    @Test fun offlineTransportKeepsEverything() = runBlocking {
        db.seedFlight("f1", 3)
        server.shutdown()
        val e = engine()
        val o = e.syncOnce()
        assertTrue(o == SyncOutcome.Offline || o is SyncOutcome.Failed)
        assertEquals(3, db.samples().pendingCount())
    }
}
