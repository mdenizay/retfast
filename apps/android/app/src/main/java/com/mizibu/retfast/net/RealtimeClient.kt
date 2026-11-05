package com.mizibu.retfast.net

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlin.random.Random

data class RealtimeMessage(val type: String, val channel: String?, val raw: JsonObject)

/**
 * WebSocket client for `/api/v1/realtime` (auth first message, subscribe, ping/pong, reconnect with
 * exponential backoff 1 s -> 30 s + jitter, resubscribe). Only used while a screen is visible; the polling
 * fallback in the view models keeps working when the socket is down. `subscribed.snapshot` is the source of truth.
 */
class RealtimeClient(private val wsBase: String, private val api: ApiClient, private val scope: CoroutineScope) {
    private val http = OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).pingInterval(0, TimeUnit.SECONDS).build()
    private val _messages = MutableSharedFlow<RealtimeMessage>(extraBufferCapacity = 256)
    val messages: SharedFlow<RealtimeMessage> = _messages
    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected

    private var socket: WebSocket? = null
    private var job: Job? = null
    private val channels = LinkedHashSet<String>()
    private var generation = 0

    /** Subscribes to [wanted]; replaces any earlier set. Connects lazily. */
    @Synchronized
    fun subscribe(wanted: Set<String>) {
        channels.clear(); channels.addAll(wanted)
        if (job?.isActive != true) { job = scope.launch { loop() } } else socket?.let { s -> wanted.forEach { sendSubscribe(s, it) } }
    }

    @Synchronized
    fun close() {
        channels.clear()
        job?.cancel(); job = null
        socket?.close(1000, null); socket = null
        _connected.value = false
    }

    private suspend fun loop() {
        var attempt = 0
        while (true) {
            val gen = ++generation
            val closed = kotlinx.coroutines.CompletableDeferred<Int>()
            val token = try { api.currentAccessToken ?: api.refresh()?.accessToken } catch (e: Exception) { null }
            if (token == null) { delay(5_000); continue }
            val req = Request.Builder().url("${wsBase.trimEnd('/')}/api/v1/realtime").build()
            val ws = http.newWebSocket(req, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send(buildJsonObject { put("type", "auth"); put("access_token", token) }.toString())
                }
                override fun onMessage(webSocket: WebSocket, text: String) {
                    val obj: JsonObject = runCatching { ApiJson.parseToJsonElement(text).jsonObject }.getOrNull() ?: return
                    val type = obj["type"]?.jsonPrimitive?.contentOrNull ?: return
                    when (type) {
                        "ping" -> webSocket.send("""{"type":"pong"}""")
                        "auth_ok" -> { _connected.value = true; attempt = 0; synchronized(this@RealtimeClient) { channels.toList() }.forEach { sendSubscribe(webSocket, it) } }
                        else -> _messages.tryEmit(RealtimeMessage(type, obj["channel"]?.jsonPrimitive?.contentOrNull, obj))
                    }
                }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { closed.complete(code) }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { closed.complete(-1) }
            })
            socket = ws
            val code = closed.await()
            _connected.value = false
            if (gen != generation) return
            if (code == 4001) { api.currentAccessToken?.let { runCatching { api.refresh() } } }
            val wait = min(30.0, Math.pow(2.0, attempt.coerceAtMost(5).toDouble())) * (0.7 + 0.6 * Random.nextDouble())
            attempt++
            delay((wait * 1000).toLong())
            synchronized(this) { if (channels.isEmpty()) { job = null; return } }
        }
    }

    private fun sendSubscribe(ws: WebSocket, channel: String) {
        ws.send(buildJsonObject { put("type", "subscribe"); put("channel", channel) }.toString())
    }
}

