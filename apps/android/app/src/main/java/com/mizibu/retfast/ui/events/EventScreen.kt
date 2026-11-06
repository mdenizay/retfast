package com.mizibu.retfast.ui.events

import android.app.Application
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberBottomSheetScaffoldState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.mizibu.retfast.R
import com.mizibu.retfast.domain.EventSheetMode
import com.mizibu.retfast.graph
import com.mizibu.retfast.net.Event
import com.mizibu.retfast.net.RetrievalStatus
import com.mizibu.retfast.retrieval.isTerminal
import com.mizibu.retfast.tracking.FlightPhase
import com.mizibu.retfast.tracking.TrackingStatus
import com.mizibu.retfast.ui.common.Banner
import com.mizibu.retfast.ui.common.BannerKind
import com.mizibu.retfast.ui.common.LoadingBox
import com.mizibu.retfast.ui.common.MapCircleButton
import com.mizibu.retfast.ui.common.PrimaryButton
import com.mizibu.retfast.ui.common.TopBar
import com.mizibu.retfast.ui.common.rememberPermState
import com.mizibu.retfast.ui.flight.FlightSummarySheet
import com.mizibu.retfast.ui.flight.RetrieveRequestSheet
import com.mizibu.retfast.ui.map.BasemapButton
import com.mizibu.retfast.ui.map.MapContent
import com.mizibu.retfast.ui.map.MapLine
import com.mizibu.retfast.ui.map.MapPin
import com.mizibu.retfast.ui.map.PinKind
import com.mizibu.retfast.ui.map.RetfastMap
import com.mizibu.retfast.ui.map.rememberMapCamera
import com.mizibu.retfast.ui.theme.Aero
import com.mizibu.retfast.ui.theme.Lucide
import kotlinx.coroutines.launch

private val PEEK = 196.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventScreen(
    eventId: String,
    onBack: () -> Unit,
    onOpenComputer: () -> Unit,
    onOpenWaiting: (String) -> Unit,
    onOpenPermissions: () -> Unit,
    initialRetrieve: Boolean = false,
) {
    val ctx = LocalContext.current
    val g = ctx.graph
    val c = Aero.colors
    val vm: EventViewModel = viewModel(key = "event-$eventId", factory = EventViewModel.Factory(ctx.applicationContext as Application, eventId))
    val ui by vm.ui.collectAsStateWithLifecycle()
    val status by g.engine.status.collectAsStateWithLifecycle()
    val sync by g.sync.snapshot.collectAsStateWithLifecycle()
    val localRetrievals by g.db.retrievals().observeRecent().collectAsStateWithLifecycle(emptyList())
    val units by g.prefs.units.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val owner = LocalLifecycleOwner.current
    val camera = rememberMapCamera()
    var showRetrieve by remember { mutableStateOf(initialRetrieve) }
    var selected by remember { mutableStateOf<MapPin?>(null) }
    var preflightDone by rememberSaveable { mutableStateOf(false) }
    val imperial = units == "imperial"

    LaunchedEffect(owner) { owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { vm.runWhileVisible() } }

    // When a flight ended with "retrieve please", open the request sheet; otherwise the summary.
    LaunchedEffect(ui.endedFlightId, ui.openRetrieveAfterEnd) { if (ui.endedFlightId != null && ui.openRetrieveAfterEnd) showRetrieve = true }

    val notice = ui.notice
    val noticeText = when (notice) {
        Notice.None -> null
        Notice.RetrievalTaken -> stringResource(R.string.notice_taken)
        Notice.RetrievalMissing -> stringResource(R.string.notice_missing)
        Notice.AppliedOk -> stringResource(R.string.notice_applied)
        Notice.ApplicationFailed, Notice.Error -> ui.noticeText ?: stringResource(R.string.err_unexpected)
        Notice.FlightElsewhere -> stringResource(R.string.notice_flight_elsewhere)
    }
    LaunchedEffect(notice, noticeText) {
        if (noticeText != null) { snackbar.showSnackbar(noticeText); vm.clearNotice() }
    }

    val event = ui.event
    val activeLocal = event?.let { e -> localRetrievals.firstOrNull { !it.isTerminal && it.eventId == e.id.lowercase() } }

    // My own track while recording: refreshed every few stored samples.
    var myTrack by remember { mutableStateOf<List<Pair<Double, Double>>>(emptyList()) }
    LaunchedEffect(status.flightId, status.storedSamples / 5, status.phase) {
        val fid = status.flightId
        myTrack = if (fid != null && status.phase == FlightPhase.RECORDING && status.eventId == event?.id?.lowercase())
            g.db.samples().recentPoints(fid, 400).map { it.lat to it.lon }.reversed() else emptyList()
    }

    val content = remember(ui.event, ui.sites, ui.live, ui.myPos, status.values.lat, status.values.lon, myTrack, activeLocal) {
        buildMapContent(ui, status, myTrack, activeLocal?.id)
    }
    val me = status.lastPos ?: ui.myPos

    val mode = event?.let { EventSheetMode.forEvent(it) }
    val showPreflight = mode == EventSheetMode.Pilot && !preflightDone && !status.recording && activeLocal == null &&
        event?.status == "active" && ui.endedFlightId == null && !showRetrieve

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
            snackbarHost = { SnackbarHost(snackbar) },
            sheetContent = {
                Column(
                    Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 32.dp).navigationBarsPadding(),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    when {
                        ui.loading && event == null -> LoadingBox()
                        event == null -> Banner(ui.error ?: stringResource(R.string.err_unexpected), BannerKind.Error)
                        else -> EventSheetBody(
                            event, ui, vm, status, sync, activeLocal, imperial,
                            onOpenComputer = onOpenComputer,
                            onOpenWaiting = onOpenWaiting,
                            onOpenPermissions = onOpenPermissions,
                            onRetrieve = { showRetrieve = true },
                        )
                    }
                }
            },
        ) {
            Box(Modifier.fillMaxSize()) {
                RetfastMap(content, Modifier.fillMaxSize(), onPinTap = { selected = it }, camera = camera, bottomPadding = PEEK, topPadding = 64.dp)
                Row(
                    Modifier.statusBarsPadding().padding(horizontal = 14.dp, vertical = 8.dp).fillMaxWidth(),
                    verticalAlignment = Alignment.Top,
                ) {
                    MapCircleButton(Lucide.ArrowLeft, stringResource(R.string.back), onBack)
                    Spacer(Modifier.weight(1f))
                    if (event != null && (event.isOrganizer || event.memberRole != null)) {
                        ConnectionPill(ui.wsConnected, Modifier.padding(top = 6.dp).shadow(4.dp, CircleShape))
                    }
                    Spacer(Modifier.weight(1f))
                    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        BasemapButton()
                        if (me != null) MapCircleButton(Lucide.LocateFixed, stringResource(R.string.recenter), { camera.moveTo(me.first, me.second, 14.0) })
                        if (content.fit.isNotEmpty()) MapCircleButton(Lucide.Maximize, stringResource(R.string.fit_event), { camera.fit(content.fit) })
                    }
                }
                selected?.let { pin ->
                    Row(
                        Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 70.dp).shadow(6.dp, RoundedCornerShape(14.dp))
                            .clip(RoundedCornerShape(14.dp)).background(c.surface).padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text(pin.label.ifBlank { pin.kind.name }, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.textPrimary)
                        androidx.compose.material3.Icon(
                            Lucide.X, stringResource(R.string.cancel), tint = c.textMuted,
                            modifier = Modifier.size(18.dp).clip(CircleShape).then(Modifier.background(c.surfaceElevated)).padding(3.dp)
                                .then(Modifier.clickableNoRipple { selected = null }),
                        )
                    }
                }
            }
        }

        AnimatedVisibility(showPreflight && event != null, enter = fadeIn(), exit = fadeOut()) {
            if (event != null) PreflightOverlay(event, imperial, sync.pendingCount, onBack, onOpenPermissions) { preflightDone = true }
        }
    }

    if (showRetrieve && event != null) {
        RetrieveRequestSheet(
            eventName = event.name,
            onDismiss = { showRetrieve = false; vm.clearEnded() },
            onSend = { pickup, note ->
                scope.launch {
                    val id = vm.requestRetrieval(pickup, note, ui.endedFlightId ?: status.flightId)
                    showRetrieve = false
                    vm.clearEnded()
                    onOpenWaiting(id)
                }
            },
        )
    } else if (ui.endedFlightId != null && !ui.openRetrieveAfterEnd && event != null) {
        FlightSummarySheet(
            flightId = ui.endedFlightId!!,
            canRetrieve = true,
            onRetrieve = { showRetrieve = true },
            onClose = { vm.clearEnded() },
        )
    }
}

private fun Modifier.clickableNoRipple(onClick: () -> Unit) = this.then(
    Modifier.clickable(onClick = onClick),
)

/** Full-screen pre-flight check for pilots: weather + phone readiness before the sheet. */
@Composable
private fun PreflightOverlay(event: Event, imperial: Boolean, pending: Int, onBack: () -> Unit, onOpenPermissions: () -> Unit, onContinue: () -> Unit) {
    val c = Aero.colors
    val g = LocalContext.current.graph
    val perm by rememberPermState()
    val online by g.online.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().background(c.background).statusBarsPadding().navigationBarsPadding()) {
        TopBar(stringResource(R.string.preflight_title), onBack = onBack)
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(event.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.primary)
            Text(stringResource(R.string.preflight_sub), fontSize = 15.sp, lineHeight = 21.sp, color = c.textSecondary)
            WeatherCard(event, imperial)
            ReadinessList(perm, online, pending, onOpenPermissions)
            Spacer(Modifier.height(8.dp))
        }
        PrimaryButton(stringResource(R.string.continue_btn), onContinue, Modifier.padding(16.dp).fillMaxWidth(), large = true, icon = Lucide.ArrowRight)
    }
}

@Composable
private fun EventSheetBody(
    event: Event,
    ui: EventUi,
    vm: EventViewModel,
    status: TrackingStatus,
    sync: com.mizibu.retfast.sync.SyncSnapshot,
    activeLocal: com.mizibu.retfast.data.RetrievalEntity?,
    imperial: Boolean,
    onOpenComputer: () -> Unit,
    onOpenWaiting: (String) -> Unit,
    onOpenPermissions: () -> Unit,
    onRetrieve: () -> Unit,
) {
    val mode = EventSheetMode.forEvent(event)
    EventHeader(event)
    ui.error?.let { Banner(it, BannerKind.Error) }
    when (mode) {
        is EventSheetMode.NotMember -> NotMemberSheet(event, mode.state, ui.busy, vm)
        EventSheetMode.Pilot -> PilotSheet(event, ui, vm, status, sync, activeLocal, imperial, onOpenComputer, onOpenWaiting, onOpenPermissions, onRetrieve)
        EventSheetMode.Retriever -> RetrieverSheet(event, ui, vm, status, imperial, onOpenPermissions)
        EventSheetMode.Observer, EventSheetMode.OrganizerOnly -> OverviewSheet(event, ui, imperial)
    }
    if (EventSheetMode.showsOrganizerTools(event)) OrganizerTools(event, ui, vm)
    if (mode != EventSheetMode.Pilot) WeatherCard(event, imperial)
    EventInfoCard(event, ui)
}

private fun buildMapContent(ui: EventUi, status: TrackingStatus, myTrack: List<Pair<Double, Double>>, activeRetrievalId: String?): MapContent {
    val ev = ui.event ?: return MapContent()
    val pins = ArrayList<MapPin>()
    val fit = ArrayList<Pair<Double, Double>>()
    ev.center?.let {
        pins += MapPin("center", PinKind.CENTER, it.lat, it.lon, ev.name + if (ev.centerIsApproximate) " (yaklaşık)" else "")
        fit += it.lat to it.lon
    }
    ui.sites.forEach { s ->
        val p = s.position ?: return@forEach // sites without coordinates are never placed
        pins += MapPin("site-${s.id}", if (s.isVerified) PinKind.SITE else PinKind.SITE_UNVERIFIED, p.lat, p.lon, s.name + if (!s.isVerified) " · doğrulanmamış" else "")
        fit += p.lat to p.lon
    }
    val lines = ArrayList<MapLine>()
    if (EventSheetMode.showsPilotLayer(ev)) {
        ui.live?.pilots?.forEach { lp ->
            val pos = lp.position ?: return@forEach
            val kind = when (lp.freshness) { "live" -> PinKind.PILOT_LIVE; "stale" -> PinKind.PILOT_STALE; else -> PinKind.PILOT_LOST }
            pins += MapPin("pilot-${lp.flightId}", kind, pos.lat, pos.lon, lp.pilot.fullName + if (lp.isSimulated) " · SIM" else "")
            if (lp.trail.size >= 2) lines += MapLine("trail-${lp.flightId}", lp.trail.filter { it.size >= 2 }.map { it[1] to it[0] })
        }
    }
    ui.live?.retrievals?.filter { RetrievalStatus.isOpen(it.status) }?.forEach { r ->
        val p = r.pilotPosition?.let { it.lat to it.lon } ?: r.pickup?.let { it.lat to it.lon } ?: return@forEach
        val active = r.status != RetrievalStatus.REQUESTED
        pins += MapPin("pickup-${r.id}", if (active) PinKind.PICKUP_ACTIVE else PinKind.PICKUP, p.first, p.second, r.pilot?.fullName.orEmpty() + if (r.isSimulated) " · SIM" else "")
        fit += p
    }
    ui.live?.retrievers?.forEach { rt ->
        val pos = rt.position ?: return@forEach
        pins += MapPin("retriever-${rt.userId}", PinKind.RETRIEVER, pos.lat, pos.lon, rt.fullName)
    }
    if (myTrack.size >= 2) lines += MapLine("mine", myTrack, "mine")
    val me = if (status.values.lat != null && status.recording) status.values.lat!! to status.values.lon!! else ui.myPos
    me?.let { pins += MapPin("me", PinKind.ME, it.first, it.second, "") }
    return MapContent(
        pins = pins, lines = lines, focus = ev.center?.let { it.lat to it.lon },
        fit = fit.distinct(), fitKey = "event-${ev.id}-${fit.size.coerceAtMost(3)}",
    )
}

