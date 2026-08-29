package com.mizibu.retfast.pilot

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mizibu.retfast.core.EmergencyRef
import com.mizibu.retfast.core.NearbyRetriever
import com.mizibu.retfast.core.RetrievalAssignmentRow
import com.mizibu.retfast.core.RetrievalRequestRow
import com.mizibu.retfast.core.TaskRow
import com.mizibu.retfast.core.supa
import com.mizibu.retfast.tracking.SyncEngine
import com.mizibu.retfast.tracking.TrackingService
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/** Pilot flight lifecycle + retrieval, polling the small state tables every 5 s. */
class PilotViewModel(private val eventId: String) : ViewModel() {

    data class State(
        val task: TaskRow? = null,
        val request: RetrievalRequestRow? = null,
        val assignment: RetrievalAssignmentRow? = null,
        val nearby: List<NearbyRetriever> = emptyList(),
        val error: String? = null,
        val sosDelivered: Boolean? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    val tracking = TrackingService.state
    val pending = SyncEngine.pending
    val syncError = SyncEngine.lastError

    fun attach(context: Context, existing: TaskRow?) {
        if (existing != null) {
            _state.value = _state.value.copy(task = existing)
            if (existing.status == "active" || existing.status == "landed") {
                TrackingService.start(context, TrackingService.Mode.TASK, existing.id)
            }
        }
        startPolling()
        SyncEngine.refreshPending(context)
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

    suspend fun poll() {
        val taskId = _state.value.task?.id ?: return
        runCatching {
            val fresh = supa.from("tasks").select { filter { eq("id", taskId) } }
                .decodeSingleOrNull<TaskRow>()
            val requests = supa.from("retrieval_requests").select {
                filter { eq("task_id", taskId) }
                order("created_at", Order.DESCENDING)
                limit(1)
            }.decodeList<RetrievalRequestRow>()
            val assignments = supa.from("retrieval_assignments").select {
                filter {
                    eq("task_id", taskId)
                    isIn("status", listOf("assigned", "en_route", "picked_up", "delivered"))
                }
                limit(1)
            }.decodeList<RetrievalAssignmentRow>()
            Triple(fresh, requests.firstOrNull(), assignments.firstOrNull())
        }.onSuccess { (fresh, req, asg) ->
            _state.value = _state.value.copy(
                task = fresh ?: _state.value.task,
                request = req,
                assignment = asg,
            )
        }
    }

    fun startTask(context: Context) = viewModelScope.launch {
        runCatching {
            supa.postgrest.rpc(
                "start_task",
                buildJsonObject {
                    put("p_event", JsonPrimitive(eventId))
                    put("p_title", JsonPrimitive(""))
                },
            ).decodeAs<TaskRow>()
        }.onSuccess { task ->
            _state.value = _state.value.copy(task = task, error = null)
            TrackingService.start(context, TrackingService.Mode.TASK, task.id)
            startPolling()
        }.onFailure { _state.value = _state.value.copy(error = it.message) }
    }

    fun transition(context: Context, action: String, reason: String? = null) =
        viewModelScope.launch {
            val task = _state.value.task ?: return@launch
            runCatching {
                supa.postgrest.rpc(
                    "transition_task",
                    buildJsonObject {
                        put("p_task", JsonPrimitive(task.id))
                        put("p_action", JsonPrimitive(action))
                        put("p_reason", JsonPrimitive(reason))
                    },
                ).decodeAs<TaskRow>()
            }.onSuccess { updated ->
                _state.value = _state.value.copy(task = updated, error = null)
                SyncEngine.flushNow(context)
                if (updated.status == "completed" || updated.status == "cancelled") {
                    TrackingService.stop(context)
                }
            }.onFailure { _state.value = _state.value.copy(error = it.message) }
        }

    fun loadNearby() = viewModelScope.launch {
        val loc = TrackingService.state.value.lastLocation ?: return@launch
        runCatching {
            supa.postgrest.rpc(
                "nearby_retrievers",
                buildJsonObject {
                    put("p_event", JsonPrimitive(eventId))
                    put("p_lat", JsonPrimitive(loc.latitude))
                    put("p_lng", JsonPrimitive(loc.longitude))
                    put("p_limit", JsonPrimitive(10))
                },
            ).decodeList<NearbyRetriever>()
        }.onSuccess { _state.value = _state.value.copy(nearby = it) }
    }

    fun requestRetrieval(retrieverId: String) = viewModelScope.launch {
        val task = _state.value.task ?: return@launch
        runCatching {
            supa.postgrest.rpc(
                "request_retrieval",
                buildJsonObject {
                    put("p_task", JsonPrimitive(task.id))
                    put("p_retriever", JsonPrimitive(retrieverId))
                },
            ).decodeAs<RetrievalRequestRow>()
        }.onSuccess { _state.value = _state.value.copy(request = it, error = null) }
            .onFailure { _state.value = _state.value.copy(error = it.message) }
    }

    fun raiseSos(context: Context) = viewModelScope.launch {
        val loc = TrackingService.state.value.lastLocation
        _state.value = _state.value.copy(sosDelivered = null)
        runCatching {
            supa.postgrest.rpc(
                "raise_emergency",
                buildJsonObject {
                    put("p_event", JsonPrimitive(eventId))
                    put("p_task", JsonPrimitive(_state.value.task?.id))
                    put("p_lat", JsonPrimitive(loc?.latitude))
                    put("p_lng", JsonPrimitive(loc?.longitude))
                    put("p_message", JsonPrimitive(""))
                },
            ).decodeAs<EmergencyRef>()
        }.onSuccess {
            _state.value = _state.value.copy(sosDelivered = true)
            SyncEngine.flushNow(context)
        }.onFailure {
            _state.value = _state.value.copy(sosDelivered = false, error = it.message)
        }
    }
}
