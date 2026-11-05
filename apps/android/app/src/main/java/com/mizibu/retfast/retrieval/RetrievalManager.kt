package com.mizibu.retfast.retrieval

import com.mizibu.retfast.data.AppDatabase
import com.mizibu.retfast.data.Outbox
import com.mizibu.retfast.data.RetrievalEntity
import com.mizibu.retfast.net.ApiClient
import com.mizibu.retfast.net.ApiException
import com.mizibu.retfast.net.ApiJson
import com.mizibu.retfast.net.CreateRetrievalRequest
import com.mizibu.retfast.net.Retrieval
import com.mizibu.retfast.net.RetrievalPickup
import com.mizibu.retfast.net.RetrievalStatus
import com.mizibu.retfast.net.cancelRetrieval
import com.mizibu.retfast.net.code
import com.mizibu.retfast.net.createRetrieval
import com.mizibu.retfast.net.isPasswordChangeRequired
import com.mizibu.retfast.net.retrieval
import com.mizibu.retfast.net.retrievals
import com.mizibu.retfast.net.status
import com.mizibu.retfast.util.Backoff
import com.mizibu.retfast.util.Clock
import com.mizibu.retfast.util.Iso
import com.mizibu.retfast.util.SystemClock
import com.mizibu.retfast.util.newId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Pilot-side retrieval requests with the same reliability rules as telemetry:
 *
 * 1. [request] writes the request to SQLite before any network use.
 * 2. A per-request loop sends `POST /events/{id}/retrievals` with the client id (idempotent) and retries
 *    with backoff until the server confirms it.
 * 3. Once sent it polls `GET /retrievals/{id}` (the realtime channel only speeds this up via [apply]).
 * 4. [cancel] ("Kendim döndüm") is local if nothing was ever sent, otherwise delivered and retried until confirmed.
 *
 * 409 on create means the pilot already has an open request in this event: the open one (from
 * `details.retrieval_id`, else the event's open list) is adopted and the local request is marked `merged`.
 */
class RetrievalManager(
    private val db: AppDatabase,
    private val api: ApiClient,
    private val scope: CoroutineScope,
    private val clock: Clock = SystemClock,
    private val backoff: Backoff = Backoff(base = 2.0, cap = 60.0),
    val pollIntervalS: Double = 15.0,
) {
    private val dao get() = db.retrievals()
    private val loops = HashMap<String, Job>()
    private val failures = HashMap<String, Int>()
    private val _updates = MutableSharedFlow<RetrievalEntity>(extraBufferCapacity = 16)
    val updates: SharedFlow<RetrievalEntity> = _updates

    /** Persist the request locally first, then start delivery. */
    suspend fun request(
        eventId: String,
        eventName: String?,
        flightId: String?,
        pickup: RetrievalPickup,
        note: String,
        id: String = newId(),
        startDelivery: Boolean = true,
    ): RetrievalEntity {
        val now = clock.now()
        val r = RetrievalEntity(
            id = id, eventId = eventId.lowercase(), eventName = eventName, flightId = flightId,
            pickupLat = pickup.lat, pickupLon = pickup.lon, pickupAlt = pickup.gpsAltM, pickupHAcc = pickup.hAccM,
            pickupT = Iso.parse(pickup.t) ?: now, note = note.trim(), createdAt = now, updatedAt = now,
        )
        dao.save(r)
        _updates.tryEmit(r)
        if (startDelivery) startLoop(r.id)
        return r
    }

    /** "Kendim döndüm". Local if never sent; otherwise told to the server. */
    suspend fun cancel(id: String, reason: String?, startDelivery: Boolean = true) {
        var r = dao.byId(id) ?: return
        if (r.isTerminal) return
        r = r.copy(cancelRequested = true, cancelReason = reason)
        if (r.outbox == Outbox.PENDING && r.attemptCount == 0) r = r.copy(cancelSynced = true)
        save(r)
        if (r.isTerminal) stopLoop(id) else if (startDelivery) startLoop(id)
    }

    /** On launch / from a worker: resume delivery and polling for everything not finished. */
    suspend fun resumeAll() {
        for (r in dao.recent(50)) if (!r.isTerminal) { _updates.tryEmit(r); startLoop(r.id) }
    }

    suspend fun active(): RetrievalEntity? = dao.recent(20).firstOrNull { !it.isTerminal }

    /** Server copy from the realtime channel or another screen. */
    suspend fun apply(server: Retrieval) {
        var r = dao.byId(server.id.lowercase()) ?: return
        if (r.outbox == Outbox.MERGED || r.outbox == Outbox.REFUSED) return
        r = merge(server, r.copy(outbox = Outbox.SENT))
        save(r)
        if (r.isTerminal) stopLoop(r.id)
    }

    fun kickAll() { loops.keys.toList().forEach { startLoop(it) } }

    private fun startLoop(id: String) {
        loops[id]?.cancel()
        loops[id] = scope.launch { run(id, null) }
    }

    private fun stopLoop(id: String) { loops.remove(id)?.cancel() }

    /** Delivery/poll loop. [maxSteps] for deterministic tests. */
    suspend fun run(id: String, maxSteps: Int?) {
        var steps = 0
        while (kotlin.coroutines.coroutineContext.isActive) {
            if (maxSteps != null && steps >= maxSteps) return
            steps++
            val delay = step(id) ?: return
            clock.sleep(delay)
        }
    }

    /**
     * One action for the request. Returns the delay before the next step, or null when nothing more is
     * needed. Every write after a network await re-reads the row ([mutate]), so a cancel issued meanwhile is never lost.
     */
    suspend fun step(id: String): Double? {
        val r = mutate(id) { if (!it.isTerminal && it.outbox == Outbox.PENDING) it.copy(attemptCount = it.attemptCount + 1, lastAttemptAt = clock.now()) else it }
            ?: return null
        if (r.isTerminal) return null
        try {
            if (r.outbox == Outbox.PENDING) {
                val body = CreateRetrievalRequest(
                    id = r.id, flightId = r.flightId,
                    pickup = RetrievalPickup(r.pickupLat, r.pickupLon, r.pickupAlt, r.pickupHAcc, Iso.format(r.pickupT)),
                    note = r.note.ifEmpty { null },
                )
                try {
                    val server = api.createRetrieval(r.eventId, body)
                    failures[id] = 0
                    val updated = mutate(id) { merge(server, it.copy(outbox = Outbox.SENT, lastError = null)) }
                    if (updated == null || updated.isTerminal) return null
                    return if (updated.cancelRequested && !updated.cancelSynced) 0.0 else pollIntervalS
                } catch (e: ApiException.Server) {
                    if (e.status == 409) return resolveConflict(id, e)
                    throw e
                }
            }

            if (r.cancelRequested && !r.cancelSynced) {
                var server: Retrieval? = null
                try {
                    server = api.cancelRetrieval(r.id, r.cancelReason)
                } catch (e: ApiException.Server) {
                    if (e.status != 409) throw e
                    // Already closed on the server (delivered, or cancelled by an organizer).
                    server = runCatching { api.retrieval(r.id) }.getOrNull()
                }
                val updated = mutate(id) {
                    var n = it.copy(cancelSynced = true, lastError = null)
                    if (server != null) n = merge(server, n)
                    else if (RetrievalStatus.isOpen(n.serverStatus) || n.serverStatus == null) n = n.copy(serverStatus = RetrievalStatus.CANCELLED)
                    n
                }
                return if (updated?.isTerminal != false) null else pollIntervalS
            }

            val server = api.retrieval(r.id)
            failures[id] = 0
            val updated = mutate(id) { merge(server, it).copy(lastError = null) }
            if (updated == null || updated.isTerminal) return null
            return if (updated.cancelRequested && !updated.cancelSynced) 0.0 else pollIntervalS
        } catch (e: ApiException) {
            val code = (e as? ApiException.Server)?.code ?: if ((e as? ApiException.Transport)?.offline == true) "offline" else "transport"
            val st = e.status
            val refuse = r.outbox == Outbox.PENDING && st in listOf(400, 403, 404, 422) && !e.isPasswordChangeRequired
            val updated = mutate(id) { it.copy(lastError = code, outbox = if (refuse && it.outbox == Outbox.PENDING) Outbox.REFUSED else it.outbox) }
            if (updated?.isTerminal != false) return null
            val attempt = failures[id] ?: 0
            failures[id] = attempt + 1
            val delay = backoff.delay(attempt)
            if (st == 429) return maxOf((e as ApiException.Server).retryAfter ?: 5.0, delay)
            if (updated.outbox == Outbox.SENT && !updated.cancelRequested) return maxOf(pollIntervalS, delay)
            return delay
        }
    }

    /** 409 on create: the pilot already has an open request in this event. Find it and adopt it. */
    private suspend fun resolveConflict(id: String, error: ApiException.Server): Double? {
        val r = dao.byId(id) ?: return null
        var open: Retrieval? = null
        val otherId = error.details["retrieval_id"] ?: error.details["open_retrieval_id"] ?: error.details["id"]
        if (otherId != null) open = runCatching { api.retrieval(otherId) }.getOrNull()
        if (open == null) {
            val mine = runCatching { api.retrievals(r.eventId, RetrievalStatus.OPEN) }.getOrDefault(emptyList())
            open = mine.firstOrNull { it.id.lowercase() == r.id } ?: mine.firstOrNull()
        }
        if (open == null) {
            mutate(id) { it.copy(lastError = "conflict") }
            val attempt = failures[id] ?: 0
            failures[id] = attempt + 1
            return backoff.delay(attempt)
        }
        if (open.id.lowercase() == r.id) {
            // Same request (the first response was lost): it is ours.
            val updated = mutate(id) { merge(open, it.copy(outbox = Outbox.SENT, lastError = null)) }
            return if (updated?.isTerminal != false) null else pollIntervalS
        }
        val merged = mutate(id) { it.copy(outbox = Outbox.MERGED, mergedInto = open.id.lowercase(), lastError = null) }
        val adoptedId = open.id.lowercase()
        if (dao.byId(adoptedId) != null) return null
        val now = clock.now()
        var adopted = RetrievalEntity(
            id = adoptedId, eventId = (open.eventId ?: r.eventId).lowercase(), eventName = r.eventName, flightId = open.flightId,
            pickupLat = open.pickup?.lat ?: r.pickupLat, pickupLon = open.pickup?.lon ?: r.pickupLon,
            pickupAlt = open.pickup?.gpsAltM ?: r.pickupAlt, pickupHAcc = open.pickup?.hAccM ?: r.pickupHAcc,
            pickupT = Iso.parse(open.pickup?.t) ?: r.pickupT, note = open.note,
            createdAt = Iso.parse(open.requestedAt) ?: now, outbox = Outbox.SENT, updatedAt = now,
        )
        adopted = merge(open, adopted)
        if (merged?.cancelRequested == true) adopted = adopted.copy(cancelRequested = true, cancelReason = merged.cancelReason)
        save(adopted)
        if (!adopted.isTerminal) startLoop(adoptedId)
        return null
    }

    private fun merge(server: Retrieval, r: RetrievalEntity): RetrievalEntity {
        var n = r.copy(serverStatus = server.status, serverJson = ApiJson.encodeToString(Retrieval.serializer(), server))
        if (server.status == RetrievalStatus.CANCELLED && n.cancelRequested) n = n.copy(cancelSynced = true)
        return n
    }

    private suspend fun mutate(id: String, change: (RetrievalEntity) -> RetrievalEntity): RetrievalEntity? {
        val r = dao.byId(id) ?: return null
        val n = change(r)
        save(n)
        return dao.byId(id)
    }

    private suspend fun save(r: RetrievalEntity) {
        val n = r.copy(updatedAt = clock.now())
        dao.save(n)
        _updates.tryEmit(n)
    }
}
