package com.mizibu.retfast.sync

import androidx.room.withTransaction
import com.mizibu.retfast.data.AppDatabase
import com.mizibu.retfast.data.KvEntity
import com.mizibu.retfast.data.SampleEntity
import com.mizibu.retfast.net.ApiClient
import com.mizibu.retfast.net.ApiException
import com.mizibu.retfast.net.BatchRequest
import com.mizibu.retfast.net.CreateFlightRequest
import com.mizibu.retfast.net.DeviceInfo
import com.mizibu.retfast.net.SampleDto
import com.mizibu.retfast.net.SampleMeta
import com.mizibu.retfast.net.code
import com.mizibu.retfast.net.createFlight
import com.mizibu.retfast.net.endFlight
import com.mizibu.retfast.net.isPasswordChangeRequired
import com.mizibu.retfast.net.status
import com.mizibu.retfast.net.uploadBatch
import com.mizibu.retfast.util.Backoff
import com.mizibu.retfast.util.Clock
import com.mizibu.retfast.util.Iso
import com.mizibu.retfast.util.SystemClock
import com.mizibu.retfast.util.newId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** What the UI shows about upload state. Never SYNCED unless the server acknowledged every stored sample. */
enum class SyncStatus { SYNCED, SYNCING, PENDING, OFFLINE, AUTH_REQUIRED, SERVER_ERROR }

data class SyncSnapshot(
    val status: SyncStatus = SyncStatus.PENDING,
    val pendingCount: Int = 0,
    val lastServerAckAt: Long? = null,
    val lastAttemptAt: Long? = null,
    val nextRetryAt: Long? = null,
    val consecutiveFailures: Int = 0,
    val lastError: String? = null,
)

sealed interface SyncOutcome {
    /** Nothing left to upload. */
    data object Idle : SyncOutcome
    /** Some work succeeded; there may be more. */
    data object Progressed : SyncOutcome
    data object Offline : SyncOutcome
    data object AuthRequired : SyncOutcome
    /** Retryable failure, optionally with a server-mandated delay (429 Retry-After). */
    data class Failed(val retryAfter: Double?) : SyncOutcome
}

/**
 * Uploads stored samples in idempotent batches (<= 500 samples, ~every 5 s while there is work).
 *
 * Rules (docs/architecture/telemetry.md):
 * - a batch keeps its batch_id until the server acknowledged it, so a retry after a lost response,
 *   a 401 refresh or a process restart re-sends the same batch_id with the same samples;
 * - only seqs in `accepted` or `duplicate` become synced; `rejected` become rejected and are kept, never retried;
 * - unsynced samples are never deleted.
 */
class SyncEngine(
    private val db: AppDatabase,
    private val api: ApiClient,
    private val clock: Clock = SystemClock,
    private val backoff: Backoff = Backoff(),
    private val device: DeviceInfo,
    val intervalS: Double = 5.0,
    maxBatchSize: Int = 500,
) {
    val maxBatchSize = minOf(500, maxBatchSize)
    private val _snapshot = MutableStateFlow(SyncSnapshot())
    val snapshot: StateFlow<SyncSnapshot> = _snapshot

    private var loopJob: Job? = null
    private var sleepJob: Job? = null
    @Volatile private var networkAvailable = true
    @Volatile private var authBlocked = false
    private var failures = 0

    /** Starts the in-process loop (used while recording or whenever the app is alive). Idempotent. */
    fun start(scope: CoroutineScope) {
        if (loopJob?.isActive == true) { kick(); return }
        loopJob = scope.launch { runLoop(null) }
    }

    fun stop() { loopJob?.cancel(); loopJob = null; sleepJob?.cancel() }

    /** Wake the loop now (new samples, flight ended, app foregrounded). */
    fun kick() { sleepJob?.cancel() }

    fun networkChanged(connected: Boolean) {
        val wasOffline = !networkAvailable
        networkAvailable = connected
        if (connected && wasOffline) { failures = 0; kick() } else if (!connected) publish(SyncStatus.OFFLINE)
    }

    /** After sign-in / password change. */
    fun authRestored() { authBlocked = false; failures = 0; kick() }

    /** The loop. [maxIterations] exists for deterministic tests. */
    suspend fun runLoop(maxIterations: Int?) {
        var iterations = 0
        while (currentCoroutineContext().isActive) {
            if (maxIterations != null && iterations >= maxIterations) return
            iterations++
            val delayS: Double = when (val outcome = syncOnce()) {
                SyncOutcome.Progressed -> { failures = 0; continue }
                SyncOutcome.Idle -> { failures = 0; intervalS }
                SyncOutcome.AuthRequired -> 300.0
                SyncOutcome.Offline, is SyncOutcome.Failed -> {
                    val ra = (outcome as? SyncOutcome.Failed)?.retryAfter
                    val d = if (ra != null) maxOf(ra, 1.0) else backoff.delay(failures)
                    failures++
                    d
                }
            }
            _snapshot.value = _snapshot.value.copy(nextRetryAt = clock.now() + (delayS * 1000).toLong(), consecutiveFailures = failures)
            sleep(delayS)
        }
    }

    private suspend fun sleep(seconds: Double) {
        val scope = CoroutineScope(currentCoroutineContext())
        val job = scope.launch { clock.sleep(seconds) }
        sleepJob = job
        job.join()
        sleepJob = null
    }

    /** One unit of work: create unknown flights, send at most one batch, then end finished flights. */
    suspend fun syncOnce(): SyncOutcome {
        if (authBlocked) { publish(SyncStatus.AUTH_REQUIRED); return SyncOutcome.AuthRequired }
        if (!networkAvailable) { publish(SyncStatus.OFFLINE); return SyncOutcome.Offline }
        return try {
            createPendingFlights()
            val prepared = nextBatch()
            if (prepared != null) {
                publish(SyncStatus.SYNCING)
                val outcome = upload(prepared.first, prepared.second)
                if (outcome != SyncOutcome.Progressed) return outcome
                publishSettled()
                return SyncOutcome.Progressed
            }
            endCompletedFlights()
            publishSettled()
            SyncOutcome.Idle
        } catch (e: ApiException) {
            classify(e, "flight")
        }
    }

    private suspend fun nextBatch(): Pair<String, List<SampleEntity>>? = db.withTransaction {
        val dao = db.samples()
        dao.openBatchId()?.let { open ->
            val list = dao.inBatch(open)
            if (list.isNotEmpty()) return@withTransaction open to list
        }
        val flightId = dao.nextFlightWithUnbatched() ?: return@withTransaction null
        if (db.flights().byId(flightId)?.serverCreated != true) return@withTransaction null
        val list = dao.unbatched(flightId, maxBatchSize)
        if (list.isEmpty()) return@withTransaction null
        val id = newId()
        dao.assignBatch(id, list.map { it.id })
        id to list
    }

    private suspend fun upload(batchId: String, samples: List<SampleEntity>): SyncOutcome {
        val flightId = samples.first().flightId
        val request = BatchRequest(batchId, flightId, samples.map(::toDto))
        _snapshot.value = _snapshot.value.copy(lastAttemptAt = clock.now())
        return try {
            val response = api.uploadBatch(request)
            val acked = response.accepted + response.duplicate
            db.withTransaction {
                val dao = db.samples()
                acked.chunked(400).forEach { dao.markSynced(flightId, batchId, it) }
                response.rejected.forEach { dao.markRejected(flightId, batchId, it.seq, it.reason.ifEmpty { "rejected" }) }
                // Anything the response did not classify goes back to the pool for a new batch.
                dao.releaseBatch(batchId)
            }
            val ackAt = clock.now()
            db.kv().put(KvEntity(KEY_LAST_ACK, ackAt.toString()))
            _snapshot.value = _snapshot.value.copy(lastServerAckAt = ackAt)
            SyncOutcome.Progressed
        } catch (e: ApiException) {
            db.samples().recordAttempt(batchId, clock.now())
            when {
                e is ApiException.Server && (e.status == 400 || e.status == 422) -> {
                    // The whole batch is malformed: no retry will ever succeed. Keep samples as rejected.
                    db.samples().rejectBatch(batchId, "${e.code}")
                    SyncOutcome.Progressed
                }
                e is ApiException.Server && e.status == 404 -> {
                    // Server does not know the flight (e.g. DB reset): re-create it, keep the batch.
                    db.flights().byId(flightId)?.let { db.flights().update(it.copy(serverCreated = false)) }
                    SyncOutcome.Failed(null)
                }
                else -> classify(e, "batch")
            }
        }
    }

    private suspend fun createPendingFlights() {
        for (f in db.flights().needingCreate()) {
            val body = CreateFlightRequest(f.id, f.eventId, Iso.format(f.startedAt), f.isSimulated, device)
            try {
                api.createFlight(body)
                db.flights().byId(f.id)?.let { db.flights().update(it.copy(serverCreated = true, lastError = null, updatedAt = clock.now())) }
            } catch (e: ApiException.Server) {
                val permanent = (e.status == 403 && !e.isPasswordChangeRequired) || e.status in listOf(400, 409, 422)
                if (!permanent) throw e
                // Not a member / live tracking off / id clash: keep the samples, surface the error, don't block others.
                db.flights().byId(f.id)?.let { db.flights().update(it.copy(createRefused = true, lastError = e.code, updatedAt = clock.now())) }
                publish(SyncStatus.SERVER_ERROR, e.code)
            }
        }
    }

    private suspend fun endCompletedFlights() {
        for (f in db.flights().needingEnd()) {
            val endedAt = f.endedAt ?: continue
            if (db.samples().pendingCount(f.id) != 0) continue
            try {
                api.endFlight(f.id, Iso.format(endedAt))
                db.flights().byId(f.id)?.let { db.flights().update(it.copy(serverEnded = true, lastError = null, updatedAt = clock.now())) }
            } catch (e: ApiException.Server) {
                when {
                    // The server no longer has this flight (deleted / DB reset): re-create it next pass.
                    e.status == 404 -> db.flights().byId(f.id)?.let { db.flights().update(it.copy(serverCreated = false, updatedAt = clock.now())) }
                    // Permanent: retrying can never succeed. Stop retrying and surface it.
                    (e.status == 403 && !e.isPasswordChangeRequired) || e.status in listOf(400, 409, 422) ->
                        db.flights().byId(f.id)?.let { db.flights().update(it.copy(serverEnded = true, lastError = e.code, updatedAt = clock.now())) }
                    else -> throw e
                }
            }
        }
    }

    private fun classify(e: ApiException, context: String): SyncOutcome = when {
        e is ApiException.Transport && e.offline -> { publish(SyncStatus.OFFLINE, "offline"); SyncOutcome.Offline }
        e is ApiException.NotAuthenticated -> { authBlocked = true; publish(SyncStatus.AUTH_REQUIRED, "not_authenticated"); SyncOutcome.AuthRequired }
        e is ApiException.Server -> {
            if (e.status == 401 || e.isPasswordChangeRequired) {
                authBlocked = true; publish(SyncStatus.AUTH_REQUIRED, e.code); SyncOutcome.AuthRequired
            } else {
                publish(SyncStatus.SERVER_ERROR, "$context: ${e.status} ${e.code}")
                SyncOutcome.Failed(if (e.status == 429) (e.retryAfter ?: 30.0) else e.retryAfter)
            }
        }
        e is ApiException.Decoding -> { publish(SyncStatus.SERVER_ERROR, e.message); SyncOutcome.Failed(null) }
        else -> { publish(SyncStatus.SERVER_ERROR, "$context: transport"); SyncOutcome.Failed(null) }
    }

    private suspend fun publishSettled() {
        val pending = db.samples().pendingCount()
        _snapshot.value = _snapshot.value.copy(pendingCount = pending)
        publish(if (pending == 0) SyncStatus.SYNCED else SyncStatus.PENDING, null)
    }

    private fun publish(status: SyncStatus, error: String? = null) {
        val cur = _snapshot.value
        _snapshot.value = cur.copy(
            status = status,
            lastError = if (status == SyncStatus.SYNCED || status == SyncStatus.PENDING || status == SyncStatus.SYNCING) {
                if (error == null && status != SyncStatus.SYNCING) null else cur.lastError
            } else error ?: cur.lastError,
            consecutiveFailures = failures,
        )
    }

    /** Refreshes counters shown in diagnostics (call from UI/service ticks). */
    suspend fun refreshCounters() {
        val pending = db.samples().pendingCount()
        val ack = _snapshot.value.lastServerAckAt ?: db.kv().get(KEY_LAST_ACK)?.toLongOrNull()
        _snapshot.value = _snapshot.value.copy(pendingCount = pending, lastServerAckAt = ack)
    }

    private fun toDto(s: SampleEntity) = SampleDto(
        id = s.id, seq = s.seq, t = Iso.format(s.t), deviceT = Iso.format(s.deviceT), lat = s.lat, lon = s.lon,
        gpsAltM = s.altitude, hAccM = s.hAcc, vAccM = s.vAcc, speedMs = s.speed, courseDeg = s.course,
        meta = SampleMeta(s.profile, s.battery, s.lowPower),
    )

    companion object { const val KEY_LAST_ACK = "sync.last_ack" }
}
