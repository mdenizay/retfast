package com.mizibu.retfast.retriever

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mizibu.retfast.core.NameRow
import com.mizibu.retfast.core.RetrievalAssignmentRow
import com.mizibu.retfast.core.RetrievalRequestRow
import com.mizibu.retfast.core.RetrieverProfileRow
import com.mizibu.retfast.core.RetrieverSession
import com.mizibu.retfast.core.supa
import com.mizibu.retfast.tracking.SyncEngine
import com.mizibu.retfast.tracking.TrackingService
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

class RetrieverViewModel(private val eventId: String) : ViewModel() {

    data class State(
        val onDuty: Boolean = false,
        val profile: RetrieverProfileRow? = null,
        val pendingRequest: RetrievalRequestRow? = null,
        val assignments: List<RetrievalAssignmentRow> = emptyList(),
        val pilotNames: Map<String, String> = emptyMap(),
        /** taskId → (lat, lng) of the pilot's latest fix. */
        val pilotPins: Map<String, Pair<Double, Double>> = emptyMap(),
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state
    val pending = SyncEngine.pending

    private var session: RetrieverSession? = null

    fun attach(context: Context) = viewModelScope.launch {
        // Resume an open duty session if the process was restarted.
        runCatching {
            supa.from("retriever_sessions").select(Columns.list("id", "event_id")) {
                filter {
                    eq("event_id", eventId)
                    filterNot("ended_at", io.github.jan.supabase.postgrest.query.filter.FilterOperator.IS, "null")
                }
            }.decodeList<RetrieverSession>()
        }.onSuccess { open ->
            open.firstOrNull()?.let {
                session = it
                _state.value = _state.value.copy(onDuty = true)
                TrackingService.start(context, TrackingService.Mode.RETRIEVER, it.id)
            }
        }
        SyncEngine.refreshPending(context)
        startPolling()
    }

    private var polling = false
    private fun startPolling() {
        if (polling) return
        polling = true
        viewModelScope.launch {
            while (isActive) {
                poll()
                delay(5000)
            }
        }
    }

    fun toggleDuty(context: Context) = viewModelScope.launch {
        runCatching {
            if (_state.value.onDuty) {
                supa.postgrest.rpc(
                    "end_retriever_duty",
                    buildJsonObject { put("p_event", JsonPrimitive(eventId)) },
                )
                TrackingService.stop(context)
                session = null
                _state.value = _state.value.copy(onDuty = false, error = null)
            } else {
                val s = supa.postgrest.rpc(
                    "start_retriever_duty",
                    buildJsonObject { put("p_event", JsonPrimitive(eventId)) },
                ).decodeAs<RetrieverSession>()
                session = s
                _state.value = _state.value.copy(onDuty = true, error = null)
                TrackingService.start(context, TrackingService.Mode.RETRIEVER, s.id)
            }
        }.onFailure { _state.value = _state.value.copy(error = it.message) }
    }

    fun respond(request: RetrievalRequestRow, accept: Boolean) = viewModelScope.launch {
        runCatching {
            supa.postgrest.rpc(
                "respond_retrieval",
                buildJsonObject {
                    put("p_request", JsonPrimitive(request.id))
                    put("p_accept", JsonPrimitive(accept))
                },
            )
        }.onSuccess {
            _state.value = _state.value.copy(pendingRequest = null)
            poll()
        }.onFailure { _state.value = _state.value.copy(error = it.message) }
    }

    fun advance(assignment: RetrievalAssignmentRow, action: String) = viewModelScope.launch {
        runCatching {
            supa.postgrest.rpc(
                "advance_assignment",
                buildJsonObject {
                    put("p_assignment", JsonPrimitive(assignment.id))
                    put("p_action", JsonPrimitive(action))
                },
            )
        }.onSuccess { poll() }
            .onFailure { _state.value = _state.value.copy(error = it.message) }
    }

    private suspend fun poll() {
        val userId = supa.auth.currentUserOrNull()?.id ?: return
        runCatching {
            val profile = supa.from("retriever_profiles").select(
                Columns.list("availability", "vehicle_capacity", "occupied_seats", "vehicle_description"),
            ) {
                filter {
                    eq("event_id", eventId)
                    eq("user_id", userId)
                }
            }.decodeSingleOrNull<RetrieverProfileRow>()

            val requests = supa.from("retrieval_requests").select {
                filter {
                    eq("event_id", eventId)
                    eq("retriever_id", userId)
                    eq("status", "pending")
                }
            }.decodeList<RetrievalRequestRow>()

            val assignments = supa.from("retrieval_assignments").select {
                filter {
                    eq("event_id", eventId)
                    eq("retriever_id", userId)
                    isIn("status", listOf("assigned", "en_route", "picked_up", "delivered"))
                }
            }.decodeList<RetrievalAssignmentRow>()

            val pilotIds = (assignments.map { it.pilotId } + requests.map { it.pilotId }).distinct()
            val names = if (pilotIds.isEmpty()) {
                emptyList()
            } else {
                supa.from("profiles").select(Columns.list("id", "display_name")) {
                    filter { isIn("id", pilotIds) }
                }.decodeList<NameRow>()
            }
            Quad(profile, requests.firstOrNull(), assignments, names)
        }.onSuccess { (profile, req, assignments, names) ->
            _state.value = _state.value.copy(
                profile = profile,
                pendingRequest = req,
                assignments = assignments,
                pilotNames = names.associate { it.id to it.displayName },
            )
        }
    }

    private data class Quad<A, B, C, D>(val a: A, val b: B, val c: C, val d: D)
}
