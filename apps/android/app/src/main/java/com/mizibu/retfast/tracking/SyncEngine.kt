package com.mizibu.retfast.tracking

import android.content.Context
import com.mizibu.retfast.core.appJson
import com.mizibu.retfast.core.supa
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.json.JSONArray

/**
 * Drains [PointBuffer] to the `ingest_location_points` RPC in idempotent
 * batches.
 *
 * Mirrors the iOS engine's hard-won rules: backoff is a *deadline*, never a
 * sleep held across the drain lock, and each wake-up does bounded work so a
 * large backlog cannot monopolise the foreground service.
 */
object SyncEngine {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mutex = Mutex()

    private val _pending = MutableStateFlow(0)
    val pending: StateFlow<Int> = _pending

    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError

    private var nextAttemptAtMs = 0L
    private var failures = 0
    private var lastFlushMs = 0L
    private const val CADENCE_MS = 15_000L

    fun flushNow(context: Context) {
        scope.launch { drain(context, force = true) }
    }

    /** Called for every fix; respects cadence + backoff. */
    fun flushIfDue(context: Context) {
        if (System.currentTimeMillis() - lastFlushMs < CADENCE_MS) return
        scope.launch { drain(context, force = false) }
    }

    fun refreshPending(context: Context) {
        scope.launch { _pending.value = PointBuffer.get(context).pendingCount() }
    }

    private suspend fun drain(context: Context, force: Boolean) {
        if (!mutex.tryLock()) return
        try {
            val now = System.currentTimeMillis()
            if (now < nextAttemptAtMs) {
                // A forced flush may skip a short backoff but must respect a
                // long one, so we never hammer a failing server.
                if (!force || nextAttemptAtMs - now > 30_000) return
            }
            // Uploading before the persisted session is restored would send an
            // unauthenticated request; ingest_location_points then rejects it
            // and we would burn backoff for a problem that resolves itself.
            if (supa.auth.currentSessionOrNull() == null) return

            lastFlushMs = now

            val buffer = PointBuffer.get(context)
            for (round in 0 until 5) {
                val batch = buffer.checkoutBatch(100)
                if (batch.isEmpty()) break
                val ids = batch.map { it.id }
                try {
                    val arr = JSONArray()
                    batch.forEach { arr.put(org.json.JSONObject(it.payload)) }
                    val points = appJson.parseToJsonElement(arr.toString()) as JsonArray
                    supa.postgrest.rpc(
                        "ingest_location_points",
                        buildJsonObject { put("p_points", points) },
                    )
                    buffer.confirm(ids)
                    failures = 0
                    nextAttemptAtMs = 0
                    _lastError.value = null
                } catch (e: Exception) {
                    buffer.rollback(ids)
                    failures += 1
                    // 2, 4, 8 … capped at 300 s — recorded, not slept.
                    val delay = minOf(Math.pow(2.0, failures.toDouble()), 300.0)
                    nextAttemptAtMs = System.currentTimeMillis() + (delay * 1000).toLong()
                    _lastError.value = e.message
                    break
                }
            }
            _pending.value = buffer.pendingCount()
        } finally {
            mutex.unlock()
        }
    }
}
