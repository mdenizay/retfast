package com.mizibu.retfast

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.mizibu.retfast.data.AppDatabase
import com.mizibu.retfast.data.FlightEntity
import com.mizibu.retfast.data.SampleEntity
import com.mizibu.retfast.net.ApiClient
import com.mizibu.retfast.net.AuthResponse
import com.mizibu.retfast.net.InMemoryTokenStore
import com.mizibu.retfast.net.Me
import com.mizibu.retfast.util.Clock
import com.mizibu.retfast.util.Iso
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import java.util.concurrent.CopyOnWriteArrayList

class FakeClock(var t: Long = 1_700_000_000_000L) : Clock {
    val sleeps = CopyOnWriteArrayList<Double>()
    override fun now() = t
    override suspend fun sleep(seconds: Double) { sleeps += seconds; t += (seconds * 1000).toLong() }
}

fun memoryDb(): AppDatabase =
    Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), AppDatabase::class.java).allowMainThreadQueries().build()

fun authJson(access: String = "access-1", refresh: String = "refresh-2", mustChange: Boolean = false): String {
    val exp = Iso.format(System.currentTimeMillis() + 15 * 60_000)
    return """{"access_token":"$access","access_expires_at":"$exp","refresh_token":"$refresh","refresh_expires_at":"$exp",
      "user":{"id":"u1","email":"a@b.c","full_name":"Test","roles":[],"must_change_password":$mustChange}}"""
}

fun signedInClient(server: MockWebServer, tokens: InMemoryTokenStore = InMemoryTokenStore("refresh-1")): ApiClient {
    val api = ApiClient(server.url("/").toString(), OkHttpClient(), tokens)
    api.apply(
        AuthResponse(
            accessToken = "access-0", accessExpiresAt = Iso.format(System.currentTimeMillis() + 15 * 60_000),
            refreshToken = "refresh-1", user = Me(id = "u1"),
        ),
    )
    return api
}

/** Routes requests by "METHOD /path" and records them. */
class RouteDispatcher : Dispatcher() {
    val requests = CopyOnWriteArrayList<RecordedRequest>()
    private val routes = HashMap<String, (RecordedRequest, Int) -> MockResponse>()
    private val counts = HashMap<String, Int>()
    fun on(route: String, handler: (RecordedRequest, Int) -> MockResponse) { routes[route] = handler }
    fun on(route: String, response: MockResponse) { routes[route] = { _, _ -> response } }
    fun count(route: String) = requests.count { "${it.method} ${it.path?.substringBefore('?')}" == route }
    fun bodies(route: String) = requests.filter { "${it.method} ${it.path?.substringBefore('?')}" == route }.map { it.body.clone().readUtf8() }

    @Synchronized
    override fun dispatch(request: RecordedRequest): MockResponse {
        requests += request
        val key = "${request.method} ${request.path?.substringBefore('?')}"
        val n = (counts[key] ?: 0) + 1
        counts[key] = n
        val h = routes[key] ?: return MockResponse().setResponseCode(404).setBody("""{"error":{"code":"not_found","message":"x"}}""")
        return h(request, n)
    }
}

fun json(code: Int, body: String) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)
fun errorBody(code: Int, errCode: String, details: String = "null") = json(code, """{"error":{"code":"$errCode","message":"m","details":$details}}""")

suspend fun AppDatabase.seedFlight(id: String = "f1", n: Int = 0, state: String = "ended", serverCreated: Boolean = false, baseT: Long = 1_700_000_000_000L): List<SampleEntity> {
    flights().upsert(FlightEntity(id = id, eventId = "e1", eventName = "Ev", startedAt = baseT, endedAt = if (state == "ended") baseT + n * 1000L else null, state = state, serverCreated = serverCreated, createdAt = baseT, updatedAt = baseT))
    val list = (0 until n).map { sample(id, it, baseT + it * 1000L) }
    list.forEach { samples().insert(it) }
    return list
}

fun sample(flightId: String, seq: Int, t: Long) = SampleEntity(
    id = "s-$flightId-$seq", flightId = flightId, seq = seq, t = t, deviceT = t, lat = 37.0 + seq * 1e-5, lon = 29.0, altitude = 1500.0 + seq, hAcc = 5.0, vAcc = 4.0,
    speed = 8.0, course = 90.0, profile = "cruise", battery = 0.8, lowPower = false, lowQuality = false,
)
