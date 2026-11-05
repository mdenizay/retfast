package com.mizibu.retfast.ui.events

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.mizibu.retfast.app.SessionState
import com.mizibu.retfast.data.RetrievalEntity
import com.mizibu.retfast.domain.EventSheetMode
import com.mizibu.retfast.domain.Roles
import com.mizibu.retfast.graph
import com.mizibu.retfast.net.ApiException
import com.mizibu.retfast.net.ApiJson
import com.mizibu.retfast.net.Application as EventApplication
import com.mizibu.retfast.net.Event
import com.mizibu.retfast.net.LaunchSite
import com.mizibu.retfast.net.LiveRetriever
import com.mizibu.retfast.net.LivePilot
import com.mizibu.retfast.net.LiveSnapshot
import com.mizibu.retfast.net.Member
import com.mizibu.retfast.net.Position
import com.mizibu.retfast.net.Retrieval
import com.mizibu.retfast.net.RetrievalPickup
import com.mizibu.retfast.net.RetrievalStatus
import com.mizibu.retfast.net.acceptRetrieval
import com.mizibu.retfast.net.apply
import com.mizibu.retfast.net.applications
import com.mizibu.retfast.net.approve
import com.mizibu.retfast.net.code
import com.mizibu.retfast.net.delivered
import com.mizibu.retfast.net.event
import com.mizibu.retfast.net.launchSites
import com.mizibu.retfast.net.live
import com.mizibu.retfast.net.members
import com.mizibu.retfast.net.pickedUp
import com.mizibu.retfast.net.reject
import com.mizibu.retfast.net.releaseRetrieval
import com.mizibu.retfast.net.setDuty
import com.mizibu.retfast.net.status
import com.mizibu.retfast.net.withdraw
import com.mizibu.retfast.retrieval.RetrieverDuty
import com.mizibu.retfast.retrieval.isTerminal
import com.mizibu.retfast.ui.common.LocationHelper
import com.mizibu.retfast.ui.common.userMessage
import com.mizibu.retfast.util.Iso
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

enum class Notice { None, RetrievalTaken, RetrievalMissing, AppliedOk, ApplicationFailed, FlightElsewhere, Error }

data class EventUi(
    val event: Event? = null,
    val sites: List<LaunchSite> = emptyList(),
    val live: LiveSnapshot? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val notice: Notice = Notice.None,
    val noticeText: String? = null,
    val busy: Boolean = false,
    val applications: List<EventApplication> = emptyList(),
    val members: List<Member> = emptyList(),
    val myPos: Pair<Double, Double>? = null,
    val wsConnected: Boolean = false,
    /** Set when the pilot just ended a flight here: drives the summary sheet. */
    val endedFlightId: String? = null,
    val openRetrieveAfterEnd: Boolean = false,
) {
    val mode: EventSheetMode? get() = event?.let { EventSheetMode.forEvent(it) }
}

class EventViewModel(app: Application, private val eventId: String) : AndroidViewModel(app) {
    private val g = app.graph
    private val ctx get() = getApplication<Application>()
    private val _ui = MutableStateFlow(EventUi())
    val ui: StateFlow<EventUi> = _ui

    val myId: String get() = (g.session.state.value as? SessionState.SignedIn)?.me?.id.orEmpty()

    init { reload() }

    fun reload() {
        viewModelScope.launch {
            try {
                val ev = g.api.event(eventId)
                _ui.update { it.copy(event = ev, loading = false, error = null) }
                val sites = runCatching { g.api.launchSites(ev.id) }.getOrDefault(emptyList())
                _ui.update { it.copy(sites = sites) }
                refreshLive()
                if (ev.isOrganizer) refreshOrganizer()
            } catch (e: ApiException) {
                _ui.update { it.copy(loading = false, error = e.userMessage(ctx)) }
            }
        }
    }

    private fun canSeeLive(ev: Event) = ev.isOrganizer || ev.memberRole != null || ev.settings.publicLiveMap

    suspend fun refreshLive() {
        val ev = _ui.value.event ?: return
        if (!canSeeLive(ev)) return
        try {
            val snap = g.api.live(ev.id)
            _ui.update { it.copy(live = snap, error = null) }
            snap.retrievals.forEach { g.retrievals.apply(it) }
            syncDuty(snap)
        } catch (e: ApiException) {
            if (_ui.value.live == null) _ui.update { it.copy(error = e.userMessage(ctx)) }
        }
        refreshMyPos()
    }

    private suspend fun refreshMyPos() {
        LocationHelper.lastKnown(ctx)?.let { f -> _ui.update { it.copy(myPos = f.lat to f.lon) } }
    }

    /** Keep the "active pickups" count of the persisted duty in sync so sharing continues while holding pickups. */
    private suspend fun syncDuty(snap: LiveSnapshot) {
        val ev = _ui.value.event ?: return
        if (ev.memberRole != Roles.RETRIEVER) return
        val duty = g.engine.status.value.duty ?: return
        if (duty.eventId != ev.id) return
        val mine = snap.retrievals.count { it.retriever?.userId == myId && (it.status == RetrievalStatus.ACCEPTED || it.status == RetrievalStatus.PICKED_UP) }
        if (mine != duty.activePickups) g.engine.updateDuty(duty.copy(activePickups = mine))
    }

    suspend fun refreshOrganizer() {
        val ev = _ui.value.event ?: return
        if (!ev.isOrganizer) return
        runCatching { g.api.applications(ev.id, "pending") }.onSuccess { l -> _ui.update { it.copy(applications = l) } }
        runCatching { g.api.members(ev.id) }.onSuccess { l -> _ui.update { it.copy(members = l) } }
    }

    // ---- visible-only work: realtime + polling fallback

    suspend fun runWhileVisible() = coroutineScope {
        val ev = _ui.value.event
        val rt = g.realtime
        val channels = buildSet {
            if (ev != null && canSeeLive(ev)) {
                if (EventSheetMode.showsPilotLayer(ev) || ev.isOrganizer) add("event:${ev.id}")
                if (ev.isOrganizer || ev.memberRole != null) add("retrievals:${ev.id}")
            }
        }
        if (channels.isNotEmpty()) rt.subscribe(channels)
        launch { rt.messages.collect { handle(it) } }
        launch { rt.connected.collect { c -> _ui.update { it.copy(wsConnected = c) } } }
        try {
            while (true) {
                val retriever = _ui.value.event?.memberRole == Roles.RETRIEVER
                val wait = if (retriever) 20_000L else if (_ui.value.wsConnected) 30_000L else 10_000L
                delay(wait)
                refreshLive()
                if (_ui.value.event?.isOrganizer == true) refreshOrganizer()
            }
        } finally {
            rt.close()
        }
    }

    private fun handle(m: com.mizibu.retfast.net.RealtimeMessage) {
        val evId = _ui.value.event?.id ?: return
        if (m.channel != null && !m.channel.endsWith(evId)) return
        val data = m.raw["data"]
        try {
            when (m.type) {
                "subscribed" -> {
                    val snap = m.raw["snapshot"]
                    if (m.channel?.startsWith("event:") == true && snap is JsonObject) {
                        val s = ApiJson.decodeFromJsonElement(LiveSnapshot.serializer(), snap)
                        _ui.update { cur -> cur.copy(live = (cur.live ?: LiveSnapshot()).copy(pilots = s.pilots, retrievers = s.retrievers.ifEmpty { cur.live?.retrievers.orEmpty() })) }
                    } else if (m.channel?.startsWith("retrievals:") == true) {
                        val list = when {
                            snap is JsonArray -> ApiJson.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(Retrieval.serializer()), snap)
                            snap is JsonObject && snap["retrievals"] is JsonArray -> ApiJson.decodeFromJsonElement(LiveSnapshot.serializer(), snap).retrievals
                            else -> null
                        }
                        if (list != null) _ui.update { cur -> cur.copy(live = (cur.live ?: LiveSnapshot()).copy(retrievals = list)) }
                    }
                }
                "position" -> if (data is JsonObject) {
                    val flightId = data["flight_id"]?.jsonPrimitive?.contentOrNull ?: return
                    val pos = ApiJson.decodeFromJsonElement(Position.serializer(), data["position"] ?: return)
                    _ui.update { cur ->
                        val live = cur.live ?: LiveSnapshot()
                        val existing = live.pilots.firstOrNull { it.flightId == flightId }
                        val updated = if (existing != null) existing.copy(
                            position = pos, ageS = 0.0, freshness = "live", status = "recording",
                            trail = (existing.trail + listOf(listOf(pos.lon, pos.lat, pos.gpsAltM ?: 0.0, (Iso.parse(pos.t) ?: System.currentTimeMillis()).toDouble()))).takeLast(300),
                        ) else ApiJson.decodeFromJsonElement(LivePilot.serializer(), JsonObject(data + mapOf("age_s" to kotlinx.serialization.json.JsonPrimitive(0))))
                        cur.copy(live = live.copy(pilots = live.pilots.filter { it.flightId != flightId } + updated))
                    }
                }
                "flight" -> viewModelScope.launch { refreshLive() }
                "retrieval" -> if (data != null) {
                    val r = ApiJson.decodeFromJsonElement(Retrieval.serializer(), data)
                    upsertRetrieval(r)
                    viewModelScope.launch { g.retrievals.apply(r); syncDutyFromState() }
                }
                "retriever_position" -> if (data is JsonObject) {
                    val uid = data["user_id"]?.jsonPrimitive?.contentOrNull ?: return
                    val p = data["position"]?.jsonObject ?: return
                    val pos = Position(lat = p["lat"]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull() ?: return, lon = p["lon"]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull() ?: return)
                    _ui.update { cur ->
                        val live = cur.live ?: return@update cur
                        val has = live.retrievers.any { it.userId == uid }
                        val rs = if (has) live.retrievers.map { if (it.userId == uid) it.copy(position = pos, ageS = 0.0) else it }
                        else live.retrievers + LiveRetriever(uid, data["full_name"]?.jsonPrimitive?.contentOrNull.orEmpty(), true, pos, 0.0)
                        cur.copy(live = live.copy(retrievers = rs))
                    }
                }
                "pilot_position" -> if (data is JsonObject) {
                    val rid = data["retrieval_id"]?.jsonPrimitive?.contentOrNull ?: return
                    val pos = ApiJson.decodeFromJsonElement(Position.serializer(), data["position"] ?: return)
                    _ui.update { cur ->
                        val live = cur.live ?: return@update cur
                        cur.copy(live = live.copy(retrievals = live.retrievals.map { if (it.id == rid) it.copy(pilotPosition = pos) else it }))
                    }
                }
            }
        } catch (_: Exception) { /* a malformed push is ignored; polling is the source of truth */ }
    }

    private suspend fun syncDutyFromState() { _ui.value.live?.let { syncDuty(it) } }

    private fun upsertRetrieval(r: Retrieval) {
        _ui.update { cur ->
            val live = cur.live ?: LiveSnapshot()
            val others = live.retrievals.filter { it.id != r.id }
            cur.copy(live = live.copy(retrievals = if (RetrievalStatus.isOpen(r.status) || r.status == RetrievalStatus.DELIVERED) others + r else others))
        }
    }

    // ---- not a member

    fun applyToEvent(message: String) = launchBusy {
        val ev = _ui.value.event ?: return@launchBusy
        try {
            g.api.apply(ev.id, message)
            _ui.update { it.copy(notice = Notice.AppliedOk) }
            reload()
        } catch (e: ApiException) {
            _ui.update { it.copy(notice = Notice.Error, noticeText = e.userMessage(ctx)) }
        }
    }

    fun withdrawApplication(appId: String) = launchBusy {
        val ev = _ui.value.event ?: return@launchBusy
        try { g.api.withdraw(ev.id, appId); reload() } catch (e: ApiException) { _ui.update { it.copy(notice = Notice.Error, noticeText = e.userMessage(ctx)) } }
    }

    // ---- organizer

    fun approve(app: EventApplication, role: String) = launchBusy {
        val ev = _ui.value.event ?: return@launchBusy
        try { g.api.approve(ev.id, app.id, role); refreshOrganizer(); reloadEventOnly() } catch (e: ApiException) {
            _ui.update { it.copy(notice = Notice.Error, noticeText = e.userMessage(ctx)) }
        }
    }

    fun reject(app: EventApplication) = launchBusy {
        val ev = _ui.value.event ?: return@launchBusy
        try { g.api.reject(ev.id, app.id); refreshOrganizer(); reloadEventOnly() } catch (e: ApiException) {
            _ui.update { it.copy(notice = Notice.Error, noticeText = e.userMessage(ctx)) }
        }
    }

    private suspend fun reloadEventOnly() { runCatching { g.api.event(eventId) }.onSuccess { ev -> _ui.update { it.copy(event = ev) } } }

    // ---- pilot

    fun startFlight(onStarted: () -> Unit) {
        val ev = _ui.value.event ?: return
        viewModelScope.launch {
            val st = g.engine.status.value
            if (st.recording && st.eventId != ev.id) { _ui.update { it.copy(notice = Notice.FlightElsewhere) }; return@launch }
            g.engine.startFlight(ev.id, ev.name, ev.settings.landingPrompt)
            onStarted()
        }
    }

    fun endFlight(thenRetrieve: Boolean) {
        viewModelScope.launch {
            val id = g.engine.endFlight()
            _ui.update { it.copy(endedFlightId = id, openRetrieveAfterEnd = thenRetrieve) }
        }
    }

    fun clearEnded() { _ui.update { it.copy(endedFlightId = null, openRetrieveAfterEnd = false) } }

    /** Persist the request first, then deliver. Returns the retrieval id. */
    suspend fun requestRetrieval(pickup: RetrievalPickup, note: String, flightId: String?): String {
        val ev = _ui.value.event ?: error("no event")
        g.retrievals.active()?.takeIf { it.eventId == ev.id.lowercase() }?.let { return it.id }
        if (g.engine.status.value.recording) g.engine.endFlight()
        val r = g.retrievals.request(ev.id, ev.name, flightId, pickup, note)
        g.engine.refreshSharing()
        return r.id
    }

    // ---- retriever

    fun setDuty(on: Boolean) = launchBusy {
        val ev = _ui.value.event ?: return@launchBusy
        try {
            g.api.setDuty(ev.id, on)
            val pickups = _ui.value.live?.retrievals?.count { it.retriever?.userId == myId && (it.status == RetrievalStatus.ACCEPTED || it.status == RetrievalStatus.PICKED_UP) } ?: 0
            g.engine.updateDuty(RetrieverDuty(ev.id, ev.name, on, pickups))
        } catch (e: ApiException) {
            _ui.update { it.copy(notice = Notice.Error, noticeText = e.userMessage(ctx)) }
        }
    }

    fun accept(r: Retrieval) = retrieverAction { g.api.acceptRetrieval(r.id) }
    fun release(r: Retrieval) = retrieverAction { g.api.releaseRetrieval(r.id) }
    fun pickedUp(r: Retrieval) = retrieverAction { g.api.pickedUp(r.id) }
    fun delivered(r: Retrieval, note: String?) = retrieverAction { g.api.delivered(r.id, note?.takeIf { it.isNotBlank() }) }

    private fun retrieverAction(block: suspend () -> Retrieval) = launchBusy {
        try {
            val r = block()
            upsertRetrieval(r)
            refreshLive()
            // The duty row's active pickup count follows the new server state.
            val ev = _ui.value.event
            if (ev != null && ev.memberRole == Roles.RETRIEVER) {
                val duty = g.engine.status.value.duty ?: RetrieverDuty(ev.id, ev.name, false, 0)
                val mine = _ui.value.live?.retrievals?.count { it.retriever?.userId == myId && (it.status == RetrievalStatus.ACCEPTED || it.status == RetrievalStatus.PICKED_UP) } ?: 0
                if (duty.eventId == ev.id && (mine != duty.activePickups)) g.engine.updateDuty(duty.copy(activePickups = mine))
            }
        } catch (e: ApiException) {
            if (e.status == 409) _ui.update { it.copy(notice = Notice.RetrievalTaken) }
            else if (e.status == 404) _ui.update { it.copy(notice = Notice.RetrievalMissing) }
            else _ui.update { it.copy(notice = Notice.Error, noticeText = e.userMessage(ctx)) }
            refreshLive()
        }
    }

    fun clearNotice() { _ui.update { it.copy(notice = Notice.None, noticeText = null) } }

    private fun launchBusy(block: suspend () -> Unit) {
        viewModelScope.launch {
            _ui.update { it.copy(busy = true) }
            try { block() } finally { _ui.update { it.copy(busy = false) } }
        }
    }

    fun activeRetrievalFor(list: List<RetrievalEntity>): RetrievalEntity? =
        list.firstOrNull { !it.isTerminal && it.eventId == eventId.lowercase() } ?: list.firstOrNull { !it.isTerminal && it.eventId == _ui.value.event?.id?.lowercase() }

    class Factory(private val app: Application, private val id: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = EventViewModel(app, id) as T
    }
}
