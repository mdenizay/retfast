package com.mizibu.retfast.ui.flight

import android.app.Application
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.BottomSheetScaffold
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.rememberBottomSheetScaffoldState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import com.mizibu.retfast.data.RetrievalEntity
import com.mizibu.retfast.graph
import com.mizibu.retfast.net.ApiJson
import com.mizibu.retfast.net.Retrieval
import com.mizibu.retfast.net.SimplePosition
import com.mizibu.retfast.retrieval.RetrievalStage
import com.mizibu.retfast.retrieval.SharingMode
import com.mizibu.retfast.retrieval.server
import com.mizibu.retfast.retrieval.stage
import com.mizibu.retfast.tracking.TrackingStatus
import com.mizibu.retfast.ui.common.Avatar
import com.mizibu.retfast.ui.common.ConfirmDialog
import com.mizibu.retfast.ui.common.EmptyState
import com.mizibu.retfast.ui.common.Fmt
import com.mizibu.retfast.ui.common.MapCircleButton
import com.mizibu.retfast.ui.common.PrimaryButton
import com.mizibu.retfast.ui.common.RoundIconButton
import com.mizibu.retfast.ui.common.SecondaryButton
import com.mizibu.retfast.ui.common.Tone
import com.mizibu.retfast.ui.common.WarningRow
import com.mizibu.retfast.ui.common.color
import com.mizibu.retfast.ui.events.dial
import com.mizibu.retfast.ui.map.MapContent
import com.mizibu.retfast.ui.map.MapLine
import com.mizibu.retfast.ui.map.MapPin
import com.mizibu.retfast.ui.map.PinKind
import com.mizibu.retfast.ui.map.RetfastMap
import com.mizibu.retfast.ui.map.rememberMapCamera
import com.mizibu.retfast.ui.theme.Aero
import com.mizibu.retfast.ui.theme.AeroTokens
import com.mizibu.retfast.ui.theme.Lucide
import com.mizibu.retfast.util.Geo
import com.mizibu.retfast.util.Iso
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val PEEK = 170.dp

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

/** Pilot's waiting screen: live map behind a sheet with the stage, the retriever and the four-step ladder. Logistics only. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RetrievalWaitingScreen(id: String, onClose: () -> Unit) {
    val ctx = LocalContext.current
    val g = ctx.graph
    val c = Aero.colors
    val vm: WaitingViewModel = viewModel(key = "wait-$id", factory = WaitingViewModel.Factory(ctx.applicationContext as Application, id))
    val r by g.db.retrievals().observe(id).collectAsStateWithLifecycle(null)
    val wsPos by vm.retrieverPos.collectAsStateWithLifecycle()
    val status by g.engine.status.collectAsStateWithLifecycle()
    val units by g.prefs.units.collectAsStateWithLifecycle()
    val imperial = units == "imperial"
    val owner = LocalLifecycleOwner.current
    var confirmCancel by remember { mutableStateOf(false) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val camera = rememberMapCamera()

    LaunchedEffect(owner) { owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { vm.runWhileVisible() } }
    LaunchedEffect(Unit) { while (true) { delay(1000); now = System.currentTimeMillis() } }

    val ent = r
    if (ent == null) {
        Box(Modifier.fillMaxSize().background(c.background).statusBarsPadding().padding(16.dp)) {
            MapCircleButton(Lucide.ChevronDown, stringResource(R.string.minimise), onClose)
            EmptyState(Lucide.Inbox, stringResource(R.string.not_found_local), modifier = Modifier.align(Alignment.Center))
        }
        return
    }
    val stage = ent.stage
    val server = ent.server
    val retriever = server?.retriever
    val retrieverPos = wsPos ?: server?.retrieverPosition
    val myPos = status.lastPos ?: server?.pilotPosition?.let { it.lat to it.lon } ?: (ent.pickupLat to ent.pickupLon)
    val showRetriever = retrieverPos != null && (stage == RetrievalStage.ACCEPTED || stage == RetrievalStage.PICKED_UP)

    val pickupLabel = stringResource(R.string.pickup_point)
    val pins = buildList {
        add(MapPin("pickup", PinKind.PICKUP, ent.pickupLat, ent.pickupLon, pickupLabel))
        add(MapPin("me", PinKind.ME, myPos.first, myPos.second))
        if (showRetriever) add(MapPin("retriever", PinKind.RETRIEVER, retrieverPos!!.lat, retrieverPos.lon, retriever?.fullName.orEmpty()))
    }
    val lines = if (showRetriever) listOf(MapLine("l", listOf(myPos, retrieverPos!!.lat to retrieverPos.lon), "retrieval")) else emptyList()
    val fit = pins.map { it.lat to it.lon }.distinct()

    Box(Modifier.fillMaxSize().background(c.background)) {
        BottomSheetScaffold(
            scaffoldState = rememberBottomSheetScaffoldState(),
            sheetPeekHeight = PEEK,
            sheetContainerColor = c.background,
            sheetContentColor = c.textPrimary,
            sheetShadowElevation = 12.dp,
            sheetShape = RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp),
            sheetDragHandle = {
                Box(Modifier.padding(top = 8.dp, bottom = 6.dp).size(36.dp, 5.dp).clip(CircleShape).background(c.textMuted.copy(alpha = 0.45f)))
            },
            containerColor = c.background,
            sheetContent = {
                Column(
                    Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 32.dp).navigationBarsPadding(),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    SheetHeader(ent, stage)
                    RetrieverCard(stage, retriever?.fullName, retriever?.phone, retrieverPos, myPos, now, imperial) { dial(ctx, it) }
                    DeliveryBanner(ent, stage)
                    Ladder(stage, server)
                    if (stage.sharesPilotPosition || status.sharing is SharingMode.PilotWaiting) SharingRow(status, now)
                    if (ent.note.isNotBlank()) {
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(AeroTokens.Radius.lg.dp)).background(c.surface).padding(14.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Lucide.MessageSquareText, null, tint = c.textSecondary, modifier = Modifier.size(18.dp))
                            Text(ent.note, fontSize = 15.sp, color = c.textSecondary)
                        }
                    }
                    when {
                        stage.isFinished -> PrimaryButton(stringResource(R.string.close), onClose, large = true)
                        stage != RetrievalStage.CANCELLING && stage != RetrievalStage.PICKED_UP ->
                            SecondaryButton(stringResource(R.string.wr_cancel_btn), { confirmCancel = true }, icon = Lucide.Undo2)
                    }
                    Text(stringResource(R.string.not_emergency_short), fontSize = 12.sp, lineHeight = 16.sp, color = c.textMuted)
                }
            },
        ) {
            Box(Modifier.fillMaxSize()) {
                RetfastMap(
                    MapContent(pins = pins, lines = lines, fit = fit, fitKey = "wait-${pins.size}", focus = myPos, focusZoom = 14.0),
                    Modifier.fillMaxSize(), camera = camera, bottomPadding = PEEK, topPadding = 64.dp,
                )
                Row(Modifier.statusBarsPadding().padding(horizontal = 14.dp, vertical = 8.dp).fillMaxWidth()) {
                    MapCircleButton(Lucide.ChevronDown, stringResource(R.string.minimise), onClose)
                    Spacer(Modifier.weight(1f))
                    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        MapCircleButton(Lucide.LocateFixed, stringResource(R.string.recenter), { camera.moveTo(myPos.first, myPos.second, 14.0) })
                        if (fit.size > 1) MapCircleButton(Lucide.Maximize, stringResource(R.string.fit_event), { camera.fit(fit) })
                    }
                }
            }
        }
    }

    if (confirmCancel) {
        ConfirmDialog(
            title = stringResource(R.string.wr_cancel_title),
            message = stringResource(R.string.wr_cancel_body),
            confirm = stringResource(R.string.wr_cancel_yes),
            onConfirm = { confirmCancel = false; vm.cancel() },
            onDismiss = { confirmCancel = false },
            dismiss = stringResource(R.string.keep_waiting),
            destructive = true,
        )
    }
}

private data class StageLook(val label: Int, val icon: ImageVector, val tone: Tone)

private fun look(s: RetrievalStage): StageLook = when (s) {
    RetrievalStage.SAVED_LOCALLY -> StageLook(R.string.wst_saved, Lucide.Smartphone, Tone.Warning)
    RetrievalStage.SENDING -> StageLook(R.string.wst_sending, Lucide.CloudUpload, Tone.Warning)
    RetrievalStage.REQUESTED -> StageLook(R.string.wst_requested, Lucide.Radio, Tone.Info)
    RetrievalStage.ACCEPTED -> StageLook(R.string.wst_accepted, Lucide.Car, Tone.Success)
    RetrievalStage.PICKED_UP -> StageLook(R.string.wst_picked, Lucide.Car, Tone.Success)
    RetrievalStage.DELIVERED -> StageLook(R.string.wst_delivered, Lucide.CircleCheck, Tone.Success)
    RetrievalStage.CANCELLING -> StageLook(R.string.wst_cancelling, Lucide.CloudUpload, Tone.Warning)
    RetrievalStage.CANCELLED -> StageLook(R.string.wst_cancelled, Lucide.CircleX, Tone.Neutral)
    RetrievalStage.REFUSED -> StageLook(R.string.wst_refused, Lucide.CircleAlert, Tone.Error)
    RetrievalStage.MERGED -> StageLook(R.string.wst_merged, Lucide.Info, Tone.Neutral)
}

@Composable
private fun SheetHeader(ent: RetrievalEntity, stage: RetrievalStage) {
    val c = Aero.colors
    val l = look(stage)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Icon(l.icon, null, tint = l.tone.color(), modifier = Modifier.size(20.dp))
        Text(stringResource(l.label), Modifier.padding(start = 8.dp).weight(1f), fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = l.tone.color())
        ent.eventName?.let { Text(it, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.textMuted, maxLines = 1) }
    }
}

@Composable
private fun RetrieverCard(
    stage: RetrievalStage, name: String?, phone: String?, pos: SimplePosition?, me: Pair<Double, Double>, now: Long, imperial: Boolean, onCall: (String) -> Unit,
) {
    val c = Aero.colors
    val assigned = name != null && (stage == RetrievalStage.ACCEPTED || stage == RetrievalStage.PICKED_UP || stage == RetrievalStage.DELIVERED)
    if (assigned) {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(AeroTokens.Radius.lg.dp)).background(c.surface).padding(12.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Avatar(name, 52.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(name ?: stringResource(R.string.role_retriever), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
                val sub = if (pos != null) {
                    val d = Fmt.distance(Geo.distance(me.first, me.second, pos.lat, pos.lon), imperial)
                    val age = Fmt.ageSeconds(now, Iso.parse(pos.t))
                    if (age != null) stringResource(R.string.wr_away_age, d, age.toString()) else stringResource(R.string.wr_away, d)
                } else stringResource(R.string.wst_accepted)
                Text(sub, fontSize = 14.sp, color = c.textSecondary, style = TextStyle(fontFeatureSettings = "tnum"))
            }
            if (!phone.isNullOrBlank()) RoundIconButton(Lucide.Phone, stringResource(R.string.call_retriever), { onCall(phone) }, tint = c.success)
        }
    } else if (stage == RetrievalStage.REQUESTED || stage == RetrievalStage.SENDING || stage == RetrievalStage.SAVED_LOCALLY) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(52.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(26.dp), color = c.primary, strokeWidth = 2.5.dp)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(stringResource(R.string.wst_requested), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
                Text(stringResource(R.string.wr_searching_body), fontSize = 14.sp, lineHeight = 19.sp, color = c.textSecondary)
            }
        }
    }
}

/** Honest about what only exists on this phone. */
@Composable
private fun DeliveryBanner(ent: RetrievalEntity, stage: RetrievalStage) {
    when (stage) {
        RetrievalStage.SAVED_LOCALLY -> WarningRow(stringResource(R.string.wait_saved_local), Tone.Warning, Lucide.Smartphone)
        RetrievalStage.SENDING -> WarningRow(stringResource(R.string.wait_sending, ent.attemptCount, ent.lastError ?: ""), Tone.Warning, Lucide.CloudUpload)
        RetrievalStage.CANCELLING -> WarningRow(stringResource(R.string.wait_cancelling), Tone.Warning, Lucide.CloudUpload)
        RetrievalStage.REFUSED -> WarningRow(stringResource(R.string.wait_refused, ent.lastError ?: "?"), Tone.Error, Lucide.CircleAlert)
        RetrievalStage.MERGED -> WarningRow(stringResource(R.string.wait_merged), Tone.Info, Lucide.Info)
        RetrievalStage.DELIVERED -> WarningRow(stringResource(R.string.wait_delivered), Tone.Success, Lucide.CircleCheck)
        else -> ent.lastError?.takeIf { ent.outbox == "sent" }?.let {
            Text(stringResource(R.string.wr_update_failed, it), fontSize = 12.sp, color = Aero.colors.warning)
        }
    }
}

/** Four steps; a step is ticked only when the server reported it. */
@Composable
private fun Ladder(stage: RetrievalStage, server: Retrieval?) {
    val c = Aero.colors
    val steps = listOf(
        stringResource(R.string.step_requested) to server?.requestedAt,
        stringResource(R.string.step_accepted) to server?.acceptedAt,
        stringResource(R.string.step_picked_up) to server?.pickedUpAt,
        stringResource(R.string.step_delivered) to server?.deliveredAt,
    )
    val done = stage.confirmedStep ?: -1
    val pulse by rememberInfiniteTransition(label = "step").animateFloat(0.35f, 1f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "a")
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(AeroTokens.Radius.lg.dp)).background(c.surface).padding(horizontal = 16.dp, vertical = 14.dp)) {
        steps.forEachIndexed { i, (label, time) ->
            val isDone = i <= done
            val current = i == done + 1 && !stage.isFinished
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(
                        Modifier.size(22.dp).clip(CircleShape)
                            .then(if (isDone) Modifier.background(c.success) else Modifier.border(2.dp, if (current) c.primary else c.border, CircleShape)),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (isDone) Icon(Lucide.Check, null, tint = Color.White, modifier = Modifier.size(13.dp))
                        else if (current) Box(Modifier.size(8.dp).alpha(pulse).clip(CircleShape).background(c.primary))
                    }
                    if (i < steps.lastIndex) Box(Modifier.width(2.dp).height(22.dp).background(if (i < done) c.success else c.border))
                }
                Column(Modifier.weight(1f).padding(top = 1.dp)) {
                    Text(
                        label, fontSize = 15.sp, fontWeight = if (isDone || current) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (isDone || current) c.textPrimary else c.textMuted,
                    )
                }
                if (isDone && time != null) Text(timeOf(time), fontSize = 13.sp, color = c.textMuted, style = TextStyle(fontFeatureSettings = "tnum"))
            }
        }
        if (stage == RetrievalStage.CANCELLED) {
            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Lucide.CircleX, null, tint = c.textSecondary, modifier = Modifier.size(16.dp))
                Text(stringResource(R.string.wait_cancelled), fontSize = 14.sp, color = c.textSecondary)
            }
        }
    }
}

@Composable
private fun SharingRow(status: TrackingStatus, now: Long) {
    val c = Aero.colors
    val sharing = status.sharing is SharingMode.PilotWaiting
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(AeroTokens.Radius.lg.dp)).background(c.surface).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.size(9.dp).clip(CircleShape).background(if (sharing) c.success else c.offline))
            Text(
                if (sharing) stringResource(R.string.sharing_on, Fmt.ageSeconds(now, status.lastShareAt)?.toString() ?: "—") else stringResource(R.string.sharing_off),
                fontSize = 14.sp, color = c.textSecondary,
            )
        }
        if (sharing && status.shareFailures > 0 && status.lastShareError != null) {
            Text(stringResource(R.string.share_failing, status.lastShareError ?: ""), fontSize = 12.sp, color = c.warning)
        }
    }
}

private fun timeOf(iso: String): String {
    val ms = Iso.parse(iso) ?: return iso
    return SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ms))
}
