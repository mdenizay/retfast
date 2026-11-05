package com.mizibu.retfast.tracking

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.PowerManager
import com.mizibu.retfast.data.AppDatabase
import com.mizibu.retfast.data.FlightEntity
import com.mizibu.retfast.data.KvEntity
import com.mizibu.retfast.data.SampleEntity
import com.mizibu.retfast.data.ShareEntity
import com.mizibu.retfast.net.ApiClient
import com.mizibu.retfast.net.ApiException
import com.mizibu.retfast.net.ApiJson
import com.mizibu.retfast.net.SharePositionRequest
import com.mizibu.retfast.net.sendPilotPosition
import com.mizibu.retfast.net.sendRetrieverPosition
import com.mizibu.retfast.retrieval.RetrievalManager
import com.mizibu.retfast.retrieval.RetrieverDuty
import com.mizibu.retfast.retrieval.SharingMode
import com.mizibu.retfast.util.Clock
import com.mizibu.retfast.util.Iso
import com.mizibu.retfast.util.newId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class TrackingStatus(
    val phase: FlightPhase = FlightPhase.IDLE,
    val flightId: String? = null,
    val eventId: String? = null,
    val eventName: String? = null,
    val startedAt: Long? = null,
    val profile: TrackingProfile? = null,
    val values: FlightValues = FlightValues(),
    val sharing: SharingMode = SharingMode.Off,
    val duty: RetrieverDuty? = null,
    val locationOn: Boolean = false,
    val locationAvailable: Boolean = true,
    val lastFixAt: Long? = null,
    /** Latest valid position (lat, lon) from any use of the location source. */
    val lastPos: Pair<Double, Double>? = null,
    val lastAccuracy: Double? = null,
    val storedSamples: Int = 0,
    val lastShareAt: Long? = null,
    val sharesSent: Int = 0,
    val shareFailures: Int = 0,
    val lastShareError: String? = null,
    val error: String? = null,
    val landingPrompt: Boolean = false,
    val source: String = "-",
    val battery: Double? = null,
    val lowPower: Boolean = false,
) {
    val recording: Boolean get() = phase == FlightPhase.RECORDING
    /** The foreground service is needed while a flight records or a position is being shared. */
    val needsService: Boolean get() = recording || sharing != SharingMode.Off
}

/**
 * The tracking engine. Process-lifetime singleton; the foreground [TrackingService] only keeps the
 * process alive and visible, all state lives here and in SQLite.
 *
 * Pipeline: location callback -> unbounded channel -> single consumer: validate/filter
 * ([TelemetryProcessor]) -> **persist to SQLite** -> update profile ([TrackingPolicy]). Networking
 * (sync, position sharing) never sits between a fix and its persistence.
 */
class TrackingEngine(
    private val context: Context,
    private val db: AppDatabase,
    private val api: ApiClient,
    private val retrievals: RetrievalManager,
    private val scope: CoroutineScope,
    private val clock: Clock,
    private val sourceFactory: () -> LocationSource = { createLocationSource(context) },
    private val onSamplesStored: () -> Unit = {},
    private val onLandingPrompt: () -> Unit = {},
) {
    private val _status = MutableStateFlow(TrackingStatus())
    val status: StateFlow<TrackingStatus> = _status

    private val fixes = Channel<RawFix>(Channel.UNLIMITED)
    private var source: LocationSource? = null
    private var activeProfile: TrackingProfile? = null

    private var processor = TelemetryProcessor()
    private var policy = TrackingPolicy()
    private var landing = LandingPromptDetector(enabled = true)
    private var nextSeq = 0
    private var lastShareSentAt: Long? = null
    private var lastShareFixAt: Long? = null
    private var shareInFlight = false
    private var sharingSuppressed = false

    init {
        scope.launch { for (fix in fixes) consume(fix) }
        scope.launch { retrievals.updates.collect { refreshSharing() } }
    }

    // ---- commands

    suspend fun startFlight(eventId: String?, eventName: String?, landingPromptEnabled: Boolean, simulated: Boolean = false): String {
        _status.value.takeIf { it.recording }?.flightId?.let { return it }
        val now = clock.now()
        val f = FlightEntity(
            id = newId(), eventId = eventId?.lowercase(), eventName = eventName, startedAt = now,
            isSimulated = simulated, createdAt = now, updatedAt = now,
        )
        db.flights().upsert(f)
        processor = TelemetryProcessor()
        policy = TrackingPolicy()
        landing = LandingPromptDetector(landingPromptEnabled)
        nextSeq = 0
        sharingSuppressed = false
        _status.update {
            it.copy(
                phase = FlightPhase.RECORDING, flightId = f.id, eventId = f.eventId, eventName = eventName, startedAt = now,
                profile = TrackingProfile.PRE_FLIGHT, values = FlightValues(), storedSamples = 0, error = null, landingPrompt = false,
            )
        }
        ensureLocation()
        return f.id
    }

    /** Ends the recording (idempotent). Samples stay in SQLite; sync uploads them and then ends the flight on the server. */
    suspend fun endFlight(): String? {
        val st = _status.value
        val id = st.flightId ?: return null
        if (!st.recording) return id
        val v = processor.values
        db.flights().byId(id)?.let {
            db.flights().update(
                it.copy(
                    state = "ended", endedAt = clock.now(), updatedAt = clock.now(), distanceM = v.distance, maxAltM = v.maxAltitude,
                    maxSpeedMs = v.maxGroundSpeed, ascentM = v.totalAscent, descentM = v.totalDescent,
                ),
            )
        }
        _status.update { it.copy(phase = FlightPhase.IDLE, profile = null, landingPrompt = false) }
        ensureLocation()
        onSamplesStored()
        return id
    }

    fun answerLanding(snooze: Boolean) {
        if (snooze) landing.snooze(clock.now())
        _status.update { it.copy(landingPrompt = false) }
    }

    /** Called by the notification "stop" action: ends the flight and pauses position sharing until re-enabled in the app. */
    suspend fun stopFromNotification() {
        endFlight()
        sharingSuppressed = true
        refreshSharing()
    }

    suspend fun resumeSharing() { sharingSuppressed = false; refreshSharing() }

    suspend fun updateDuty(duty: RetrieverDuty?) {
        db.kv().put(KvEntity(KEY_DUTY, duty?.let { ApiJson.encodeToString(RetrieverDuty.serializer(), it) }))
        sharingSuppressed = false
        refreshSharing()
    }

    /** Re-reads persisted state: call at app start, from the service and when the app returns to the foreground. */
    suspend fun restore() {
        val st = _status.value
        if (!st.recording) {
            db.flights().active()?.let { f ->
                val samples = db.samples().forFlight(f.id)
                val replay = TelemetryProcessor()
                samples.takeLast(3000).forEach { s ->
                    replay.process(
                        RawFix(s.t, s.lat, s.lon, s.altitude, s.hAcc, s.vAcc, s.speed, s.course),
                        TrackingProfile.fromWire(s.profile) ?: TrackingProfile.ACTIVE_FLIGHT, s.t,
                    )
                }
                processor = replay
                val lastProfile = samples.lastOrNull()?.profile?.let { TrackingProfile.fromWire(it) }?.takeIf { it.isFlightProfile }
                policy = TrackingPolicy(lastProfile ?: TrackingProfile.PRE_FLIGHT, airborne = lastProfile != null && lastProfile != TrackingProfile.PRE_FLIGHT)
                landing = LandingPromptDetector(true)
                nextSeq = db.samples().nextSeq(f.id)
                _status.update {
                    it.copy(
                        phase = FlightPhase.RECORDING, flightId = f.id, eventId = f.eventId, eventName = f.eventName, startedAt = f.startedAt,
                        profile = policy.profile, values = replay.values, storedSamples = samples.size, error = null,
                    )
                }
            }
        }
        refreshSharing()
        ensureLocation()
    }

    // ---- sharing

    suspend fun refreshSharing() {
        val duty = db.kv().get(KEY_DUTY)?.let { runCatching { ApiJson.decodeFromString(RetrieverDuty.serializer(), it) }.getOrNull() }
        val mode = if (sharingSuppressed) SharingMode.Off else SharingMode.decide(retrievals.active(), duty)
        val changed = _status.value.sharing != mode
        _status.update { it.copy(sharing = mode, duty = duty) }
        if (changed) {
            lastShareSentAt = null; lastShareFixAt = null
        }
        ensureLocation()
    }

    // ---- location source management

    private fun desiredProfile(): TrackingProfile? {
        val st = _status.value
        if (st.recording) return policy.profile
        return when (st.sharing) {
            is SharingMode.PilotWaiting -> TrackingProfile.RETRIEVE_WAITING
            is SharingMode.Retriever -> TrackingProfile.RETRIEVER_DRIVING
            SharingMode.Off -> null
        }
    }

    private fun ensureLocation() {
        val want = desiredProfile()
        if (want == null) {
            source?.stop(); source = null; activeProfile = null
            _status.update { it.copy(locationOn = false, profile = if (it.recording) it.profile else null) }
            return
        }
        if (want == activeProfile && source != null) return
        val src = source ?: sourceFactory().also { source = it }
        activeProfile = want
        src.start(
            want.settings,
            onFix = { fixes.trySend(it) },
            onAvailability = { ok -> _status.update { it.copy(locationAvailable = ok) } },
            onError = { e -> _status.update { it.copy(error = e, locationOn = false) } },
        )
        _status.update { it.copy(locationOn = true, source = src.name, profile = if (it.recording) policy.profile else want) }
    }

    // ---- fix pipeline

    private suspend fun consume(fix: RawFix) {
        val now = clock.now()
        val st = _status.value
        if (st.recording) {
            consumeFlightFix(fix, now)
        } else if (st.sharing != SharingMode.Off) {
            maybeShare(fix, now)
        }
    }

    private suspend fun consumeFlightFix(fix: RawFix, now: Long) {
        val flightId = _status.value.flightId ?: return
        val profile = policy.profile
        val decision = processor.process(fix, profile, now)
        if (decision is FixDecision.Store) {
            val battery = deviceConditions()
            val sample = SampleEntity(
                id = newId(), flightId = flightId, seq = nextSeq, t = fix.timeMs, deviceT = now,
                lat = fix.lat, lon = fix.lon, altitude = fix.altitude, hAcc = fix.hAcc, vAcc = fix.vAcc, speed = fix.speed, course = fix.course,
                profile = profile.wire, battery = battery.first, lowPower = battery.second, lowQuality = decision.lowQuality,
            )
            if (db.samples().insert(sample) != -1L) {
                nextSeq++
                _status.update { it.copy(storedSamples = it.storedSamples + 1, error = null) }
                onSamplesStored()
            } else {
                _status.update { it.copy(error = "storage_failure") }
            }
        }
        val v = processor.values
        _status.update { it.copy(values = v, lastFixAt = fix.timeMs, lastPos = if (decision is FixDecision.Rejected) it.lastPos else fix.lat to fix.lon, lastAccuracy = fix.hAcc) }
        if (decision !is FixDecision.Rejected) {
            val before = policy.profile
            policy.evaluate(PolicyInput(fix.timeMs, v.groundSpeed, v.verticalSpeed, v.turnRate))
            if (policy.profile != before) { _status.update { it.copy(profile = policy.profile) }; ensureLocation() }
            if (landing.observe(policy.profile, true, now)) {
                _status.update { it.copy(landingPrompt = true) }
                onLandingPrompt()
            }
        }
    }

    private suspend fun maybeShare(fix: RawFix, now: Long) {
        if (TelemetryProcessor.validate(fix) != null) return
        _status.update { it.copy(lastFixAt = fix.timeMs, lastPos = fix.lat to fix.lon, lastAccuracy = fix.hAcc) }
        val mode = _status.value.sharing
        val interval = (activeProfile ?: return).settings.minSampleIntervalS
        if (!SharingMode.isDue(now, lastShareSentAt, lastShareFixAt, fix.timeMs, interval) || shareInFlight) return
        val (kind, target) = when (mode) {
            is SharingMode.PilotWaiting -> "pilot" to mode.retrievalId
            is SharingMode.Retriever -> "retriever" to mode.eventId
            SharingMode.Off -> return
        }
        // Persist the latest position first (replaces the previous undelivered one), then try the network.
        val row = ShareEntity(kind, target, fix.lat, fix.lon, fix.hAcc.coerceAtLeast(0.0), fix.timeMs, fix.altitude, fix.course, fix.speed)
        db.shares().put(row)
        lastShareSentAt = now
        lastShareFixAt = fix.timeMs
        shareInFlight = true
        scope.launch { try { deliver(row) } finally { shareInFlight = false } }
    }

    private suspend fun deliver(row: ShareEntity) {
        val body = SharePositionRequest(row.lat, row.lon, row.hAcc, Iso.format(row.t), row.altitude, row.course, row.speed)
        try {
            if (row.kind == "pilot") api.sendPilotPosition(row.targetId, body) else api.sendRetrieverPosition(row.targetId, body)
            db.shares().deleteDelivered(row.kind, row.targetId, row.t)
            _status.update { it.copy(lastShareAt = clock.now(), sharesSent = it.sharesSent + 1, lastShareError = null) }
        } catch (e: ApiException) {
            val code = (e as? ApiException.Server)?.code ?: "transport"
            db.shares().failed(row.kind, row.targetId, code)
            _status.update { it.copy(shareFailures = it.shareFailures + 1, lastShareError = code) }
        }
    }

    private fun deviceConditions(): Pair<Double?, Boolean> {
        val i = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = i?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = i?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val frac = if (level >= 0 && scale > 0) level.toDouble() / scale else null
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        return frac to pm.isPowerSaveMode
    }

    /** Battery readout for the UI. */
    fun refreshBattery() {
        val (b, lp) = deviceConditions()
        _status.update { it.copy(battery = b, lowPower = lp) }
    }

    companion object { const val KEY_DUTY = "retriever_duty" }
}
