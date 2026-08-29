package com.mizibu.retfast.events

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mizibu.retfast.core.EventRole
import com.mizibu.retfast.core.EventRow
import com.mizibu.retfast.core.Membership
import com.mizibu.retfast.core.TaskRow
import com.mizibu.retfast.core.supa
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

class EventsViewModel : ViewModel() {

    data class State(
        val events: List<EventRow> = emptyList(),
        val roles: Map<String, List<EventRole>> = emptyMap(),
        val tasks: List<TaskRow> = emptyList(),
        val error: String? = null,
        val loading: Boolean = false,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    fun load(userId: String) = viewModelScope.launch {
        _state.value = _state.value.copy(loading = true)
        runCatching {
            val events = supa.from("events")
                .select { order("starts_at", Order.DESCENDING) }
                .decodeList<EventRow>()
            val memberships = supa.from("event_members")
                .select(io.github.jan.supabase.postgrest.query.Columns.list("event_id", "role")) {
                    filter { eq("user_id", userId) }
                }
                .decodeList<Membership>()
            val roles = memberships
                .groupBy { it.eventId }
                .mapValues { entry -> entry.value.mapNotNull { EventRole.from(it.role) } }
            events to roles
        }.onSuccess { (events, roles) ->
            _state.value = _state.value.copy(events = events, roles = roles, loading = false, error = null)
        }.onFailure {
            _state.value = _state.value.copy(loading = false, error = it.message)
        }
    }

    fun loadTasks(eventId: String, userId: String) = viewModelScope.launch {
        runCatching {
            supa.from("tasks").select {
                filter {
                    eq("event_id", eventId)
                    eq("pilot_id", userId)
                }
                order("started_at", Order.DESCENDING)
            }.decodeList<TaskRow>()
        }.onSuccess { _state.value = _state.value.copy(tasks = it) }
    }

    fun requestParticipation(eventId: String, role: EventRole, code: String?) =
        viewModelScope.launch {
            runCatching {
                supa.postgrest.rpc(
                    "request_participation",
                    buildJsonObject {
                        put("p_event", JsonPrimitive(eventId))
                        put("p_role", JsonPrimitive(role.raw))
                        put("p_message", JsonPrimitive(""))
                        put("p_invite_code", if (code.isNullOrBlank()) JsonPrimitive(null as String?) else JsonPrimitive(code))
                    },
                )
            }.onFailure { _state.value = _state.value.copy(error = it.message) }
        }

    fun lookupCode(code: String, onFound: (EventRow) -> Unit) = viewModelScope.launch {
        runCatching {
            supa.postgrest.rpc(
                "join_event_by_code",
                buildJsonObject { put("p_code", JsonPrimitive(code)) },
            ).decodeList<EventRow>()
        }.onSuccess { it.firstOrNull()?.let(onFound) }
            .onFailure { _state.value = _state.value.copy(error = it.message) }
    }
}
