package com.mizibu.retfast.ui.flight

import android.app.Application
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.mizibu.retfast.R
import com.mizibu.retfast.graph
import com.mizibu.retfast.net.ApiJson
import com.mizibu.retfast.net.Retrieval
import com.mizibu.retfast.net.SimplePosition
import com.mizibu.retfast.retrieval.RetrievalStage
import com.mizibu.retfast.retrieval.SharingMode
import com.mizibu.retfast.retrieval.server
import com.mizibu.retfast.retrieval.stage
import com.mizibu.retfast.ui.common.AeroCard
import com.mizibu.retfast.ui.common.Banner
import com.mizibu.retfast.ui.common.BannerKind
import com.mizibu.retfast.ui.common.Fmt
import com.mizibu.retfast.ui.common.PrimaryButton
import com.mizibu.retfast.ui.common.SecondaryButton
import com.mizibu.retfast.ui.events.dial
import com.mizibu.retfast.ui.map.MapContent
import com.mizibu.retfast.ui.map.MapLine
import com.mizibu.retfast.ui.map.MapPin
import com.mizibu.retfast.ui.map.PinKind
import com.mizibu.retfast.ui.map.RetfastMap
import com.mizibu.retfast.ui.theme.Aero
import com.mizibu.retfast.util.Geo
import com.mizibu.retfast.util.Iso
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class WaitingViewModel(app: Application, private val id: String) : AndroidViewModel(app) {
    private val g = app.graph
    private val _retrieverPos = MutableStateFlow<SimplePosition?>(null)
    val retrieverPos: StateFlow<SimplePosition?> = _retrieverPos

    /** Realtime only speeds things up: the manager's poll loop stays the fallback; the server copy is the truth. */
    suspend fun runWhileVisible() = coroutineScope {
        val r = g.db.retrievals().byId(id) ?: return@coroutineScope
        g.retrievals.kickAll()
        g.realtime.subscribe(setOf("retrievals:${r.eventId}"))
        try {
            g.realtime.messages.collect { m ->
                val data = m.raw["data"] ?: return@collect
                try {
                    if (m.type == "retrieval") {
                        val rv = ApiJson.decodeFromJsonElement(Retrieval.serializer(), data)
                        if (rv.id.lowercase() == id) g.retrievals.apply(rv)
                    } else if (m.type == "retriever_position") {
                        val p = data.jsonObject["position"]?.jsonObject ?: return@collect
                        val server = g.db.retrievals().byId(id)?.server
                        if (server?.retriever?.userId == data.jsonObject["user_id"]?.jsonPrimitive?.contentOrNull) {
                            _retrieverPos.value = SimplePosition(p["lat"]!!.jsonPrimitive.content.toDouble(), p["lon"]!!.jsonPrimitive.content.toDouble(), t = p["t"]?.jsonPrimitive?.contentOrNull)
                        }
                    }
                } catch (_: Exception) {}
            }
        } finally { g.realtime.close() }
    }

    fun cancel() = viewModelScope.launch { g.retrievals.cancel(id, "kendim döndüm"); g.engine.refreshSharing() }

    class Factory(private val app: Application, private val id: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = WaitingViewModel(app, id) as T
    }
}

@Composable
fun RetrievalWaitingScreen(id: String, onClose: () -> Unit) {
    val ctx = LocalContext.current
    val g = ctx.graph
    val vm: WaitingViewModel = viewModel(key = "wait-$id", factory = WaitingViewModel.Factory(ctx.applicationContext as Application, id))
    val r by g.db.retrievals().observe(id).collectAsStateWithLifecycle(null)
    val wsPos by vm.retrieverPos.collectAsStateWithLifecycle()
    val status by g.engine.status.collectAsStateWithLifecycle()
    val units by g.prefs.units.collectAsStateWithLifecycle()
    val imperial = units == "imperial"
    val owner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()
    var confirmCancel by remember { mutableStateOf(false) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val c = Aero.colors

    LaunchedEffect(owner) { owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { vm.runWhileVisible() } }
    LaunchedEffect(Unit) { while (true) { kotlinx.coroutines.delay(1000); now = System.currentTimeMillis() } }

    val ent = r
    if (ent == null) { Box(Modifier.safeDrawingPadding().padding(16.dp)) { Text(stringResource(R.string.not_found_local)) }; return }
    val stage = ent.stage
    val server = ent.server
    val retrieverPos = wsPos ?: server?.retrieverPosition
    val me = status.lastPos
    val myPos = me ?: server?.pilotPosition?.let { it.lat to it.lon } ?: (ent.pickupLat to ent.pickupLon)

    Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.retrieve_title), style = MaterialTheme.typography.headlineMedium)
        ent.eventName?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }

        // Delivery banner: honest about what only exists on this phone.
        when (stage) {
            RetrievalStage.SAVED_LOCALLY -> Banner(stringResource(R.string.wait_saved_local), BannerKind.Warning)
            RetrievalStage.SENDING -> Banner(stringResource(R.string.wait_sending, ent.attemptCount, ent.lastError ?: ""), BannerKind.Warning)
            RetrievalStage.CANCELLING -> Banner(stringResource(R.string.wait_cancelling), BannerKind.Warning)
            RetrievalStage.REFUSED -> Banner(stringResource(R.string.wait_refused, ent.lastError ?: ""), BannerKind.Error)
            RetrievalStage.MERGED -> Banner(stringResource(R.string.wait_merged), BannerKind.Info)
            RetrievalStage.CANCELLED -> Banner(stringResource(R.string.wait_cancelled), BannerKind.Info)
            RetrievalStage.DELIVERED -> Banner(stringResource(R.string.wait_delivered), BannerKind.Success)
            else -> {}
        }

        // The ladder ticks a step only when the server reported it.
        AeroCard {
            val steps = listOf(
                stringResource(R.string.step_requested) to server?.requestedAt,
                stringResource(R.string.step_accepted) to server?.acceptedAt,
                stringResource(R.string.step_picked_up) to server?.pickedUpAt,
                stringResource(R.string.step_delivered) to server?.deliveredAt,
            )
            val confirmed = stage.confirmedStep
            steps.forEachIndexed { i, (label, time) ->
                val done = confirmed != null && i <= confirmed
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Icon(if (done) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, null, tint = if (done) c.success else c.offline)
                    Column(Modifier.weight(1f)) {
                        Text(label, style = MaterialTheme.typography.bodyLarge)
                        if (done && time != null) Text(timeOf(time), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }

        val retriever = server?.retriever
        if (retriever != null && (stage == RetrievalStage.ACCEPTED || stage == RetrievalStage.PICKED_UP || stage == RetrievalStage.DELIVERED)) {
            AeroCard {
                Text(stringResource(R.string.your_retriever), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(retriever.fullName, style = MaterialTheme.typography.titleLarge)
                if (retrieverPos != null && stage != RetrievalStage.DELIVERED) {
                    val d = Geo.distance(myPos.first, myPos.second, retrieverPos.lat, retrieverPos.lon)
                    val age = Fmt.ageSeconds(now, Iso.parse(retrieverPos.t))
                    Text(stringResource(R.string.retriever_distance, Fmt.distance(d, imperial)), style = MaterialTheme.typography.bodyLarge)
                    if (age != null) Text(stringResource(R.string.position_age, age), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (!retriever.phone.isNullOrBlank()) PrimaryButton(stringResource(R.string.call_retriever) + " · " + retriever.phone, { dial(ctx, retriever.phone) })
            }
        }

        val pins = buildList {
            add(MapPin("pickup", PinKind.PICKUP, ent.pickupLat, ent.pickupLon, stringResource(R.string.pickup_point)))
            add(MapPin("me", PinKind.ME, myPos.first, myPos.second))
            retrieverPos?.let { if (stage == RetrievalStage.ACCEPTED || stage == RetrievalStage.PICKED_UP) add(MapPin("retriever", PinKind.RETRIEVER, it.lat, it.lon, retriever?.fullName.orEmpty())) }
        }
        val lines = if (pins.any { it.id == "retriever" }) listOf(MapLine("l", listOf(myPos, pins.first { it.id == "retriever" }.let { it.lat to it.lon }), "retrieval")) else emptyList()
        Box(Modifier.fillMaxWidth().height(260.dp)) {
            RetfastMap(MapContent(pins = pins, lines = lines, fit = pins.map { it.lat to it.lon }.distinct(), fitKey = "wait-${pins.size}", focus = myPos, focusZoom = 14.0))
        }

        AeroCard {
            val sharing = status.sharing is SharingMode.PilotWaiting
            Text(
                if (sharing) stringResource(R.string.sharing_on, Fmt.ageSeconds(now, status.lastShareAt)?.toString() ?: "—") else stringResource(R.string.sharing_off),
                style = MaterialTheme.typography.bodyMedium,
            )
            if (sharing && status.shareFailures > 0 && status.lastShareError != null) Text(stringResource(R.string.share_failing, status.lastShareError ?: ""), style = MaterialTheme.typography.bodySmall, color = c.warning)
        }
        Text(stringResource(R.string.logistics_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

        if (stage.isFinished) {
            PrimaryButton(stringResource(R.string.close), onClose, large = true)
        } else {
            SecondaryButton(stringResource(R.string.i_came_back), { confirmCancel = true }, destructive = true)
            SecondaryButton(stringResource(R.string.minimise), onClose)
        }
    }

    if (confirmCancel) {
        AlertDialog(
            onDismissRequest = { confirmCancel = false },
            title = { Text(stringResource(R.string.i_came_back)) },
            text = { Text(stringResource(R.string.cancel_confirm)) },
            confirmButton = { TextButton({ confirmCancel = false; vm.cancel() }) { Text(stringResource(R.string.cancel_request)) } },
            dismissButton = { TextButton({ confirmCancel = false }) { Text(stringResource(R.string.keep_waiting)) } },
        )
    }
}

private fun timeOf(iso: String): String {
    val ms = Iso.parse(iso) ?: return iso
    return SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date(ms))
}

