package com.mizibu.retfast

import com.mizibu.retfast.net.ApiException
import com.mizibu.retfast.net.InMemoryTokenStore
import com.mizibu.retfast.net.approve
import com.mizibu.retfast.net.code
import com.mizibu.retfast.net.event
import com.mizibu.retfast.net.status
import com.mizibu.retfast.ui.flights.Gpx
import com.mizibu.retfast.ui.flights.TrackPoint
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class ApiClientTest {
    private lateinit var server: MockWebServer
    private lateinit var routes: RouteDispatcher

    @Before fun setUp() { server = MockWebServer(); routes = RouteDispatcher().also { server.dispatcher = it }; server.start() }
    @After fun tearDown() { server.shutdown() }

    private val eventJson = """{"id":"e1","name":"Ev","settings":{"applications_open":true},"counts":{"pilots":1,"pending_applications":null},"me":{"is_organizer":false,"role":null,"application":null},"unknown_field":1}"""

    @Test fun decodesContractShapesAndIgnoresUnknownFields() = runBlocking {
        routes.on("GET /api/v1/events/e1", json(200, eventJson))
        val e = signedInClient(server).event("e1")
        assertEquals("Ev", e.name)
        assertNull(e.counts.pendingApplications)
        assertEquals(true, e.settings.applicationsOpen)
    }

    @Test fun parsesErrorBodyIncludingDetailsAndRetryAfter() = runBlocking {
        routes.on("GET /api/v1/events/e1", errorBody(409, "conflict", """{"retrieval_id":"abc","n":3}""").setHeader("Retry-After", "7"))
        try { signedInClient(server).event("e1"); fail() } catch (e: ApiException.Server) {
            assertEquals(409, e.status); assertEquals("conflict", e.code)
            assertEquals("abc", e.details["retrieval_id"]); assertEquals("3", e.details["n"]); assertEquals(7.0, e.retryAfter!!, 0.0)
        }
    }

    @Test fun concurrentExpiredCallsShareOneRefresh() = runBlocking {
        routes.on("POST /api/v1/auth/refresh") { _, _ -> Thread.sleep(150); json(200, authJson("fresh", "refresh-9")) }
        routes.on("GET /api/v1/events/e1") { req, _ ->
            if (req.getHeader("Authorization") == "Bearer fresh") json(200, eventJson) else errorBody(401, "token_expired")
        }
        val tokens = InMemoryTokenStore("refresh-1")
        val api = signedInClient(server, tokens)
        val results = (1..5).map { async(kotlinx.coroutines.Dispatchers.IO) { api.event("e1").id } }.awaitAll()
        assertEquals(List(5) { "e1" }, results)
        assertEquals(1, routes.count("POST /api/v1/auth/refresh")) // single flight: rotating tokens must not be re-used
        assertEquals("refresh-9", tokens.loadRefreshToken())
    }

    @Test fun refreshRejectedClearsSessionAndReportsNotAuthenticated() = runBlocking {
        routes.on("GET /api/v1/events/e1", errorBody(401, "token_expired"))
        routes.on("POST /api/v1/auth/refresh", errorBody(401, "unauthorized"))
        val tokens = InMemoryTokenStore("refresh-1")
        val api = signedInClient(server, tokens)
        try { api.event("e1"); fail() } catch (e: ApiException.NotAuthenticated) {}
        assertNull(tokens.loadRefreshToken())
    }

    @Test fun approvalRequiresAnExplicitValidRole() = runBlocking {
        routes.on("POST /api/v1/events/e1/applications/a1/approve", json(200, "{}"))
        val api = signedInClient(server)
        try { api.approve("e1", "a1", ""); fail() } catch (_: IllegalArgumentException) {}
        api.approve("e1", "a1", "retriever")
        assertTrue(routes.bodies("POST /api/v1/events/e1/applications/a1/approve").single().contains("\"role\":\"retriever\""))
    }

    @Test fun gpxIsLabelledAsNotCertified() {
        val gpx = Gpx.build("A & B", listOf(TrackPoint(1_700_000_000_000, 37.0, 29.0, 1500.0, 5.0, 4.0)))
        assertTrue(gpx.contains("Not a certified flight log"))
        assertTrue(gpx.contains("A &amp; B"))
        assertTrue(gpx.contains("<ele>1500.0</ele>"))
        assertFalse(gpx.contains("<ele></ele>"))
    }
}
