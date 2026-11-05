package com.mizibu.retfast.ui.events

import android.app.Application
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material3.BottomSheetScaffold
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberBottomSheetScaffoldState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
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
import com.mizibu.retfast.ui.common.StatusPill
import com.mizibu.retfast.ui.flight.FlightSummarySheet
import com.mizibu.retfast.ui.flight.RetrieveRequestSheet
import com.mizibu.retfast.ui.map.MapContent
import com.mizibu.retfast.ui.map.MapLine
import com.mizibu.retfast.ui.map.MapPin
import com.mizibu.retfast.ui.map.PinKind
import com.mizibu.retfast.ui.map.RetfastMap
import com.mizibu.retfast.ui.theme.Aero
import kotlinx.coroutines.launch

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
    val vm: EventViewModel = viewModel(key = "event-$eventId", factory = EventViewModel.Factory(ctx.applicationContext as Application, eventId))
    val ui by vm.ui.collectAsStateWithLifecycle()
    val status by g.engine.status.collectAsStateWithLifecycle()
    val sync by g.sync.snapshot.collectAsStateWithLifecycle()
    val localRetrievals by g.db.retrievals().observeRecent().collectAsStateWithLifecycle(emptyList())
    val units by g.prefs.units.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val owner = LocalLifecycleOwner.current
    var showRetrieve by remember { mutableStateOf(initialRetrieve) }
    var recenter by remember { mutableIntStateOf(0) }
    var selected by remember { mutableStateOf<MapPin?>(null) }
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

    val content = remember(ui.event, ui.sites, ui.live, ui.myPos, status.values.lat, status.values.lon, myTrack, activeLocal, selected) {
        buildMapContent(ui, status, myTrack, activeLocal?.id)
    }

    BottomSheetScaffold(
        scaffoldState = rememberBottomSheetScaffoldState(),
        sheetPeekHeight = 200.dp,
        sheetContainerColor = MaterialTheme.colorScheme.surface,
        sheetShape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp),
        snackbarHost = { SnackbarHost(snackbar) },
        sheetContent = {
            Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                when {
                    ui.loading -> LoadingBox()
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
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(bottom = 0.dp)) {
            RetfastMap(content, Modifier.fillMaxSize(), onPinTap = { selected = it }, recenterKey = recenter)
            Row(Modifier.statusBarsPadding().padding(12.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                MapButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    MapButton(onClick = { recenter++ }) { Icon(Icons.Filled.MyLocation, stringResource(R.string.recenter)) }
                    val c = Aero.colors
                    if (event != null && (event.isOrganizer || event.memberRole != null)) {
                        StatusPill(
                            stringResource(if (ui.wsConnected) R.string.conn_live else R.string.conn_polling),
                            if (ui.wsConnected) c.trackingActive else c.trackingStale,
                        )
                    }
                }
            }
            event?.let {
                Surface(
                    Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 14.dp, start = 64.dp, end = 64.dp),
                    shape = RoundedCornerShape(50), color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
                ) {
                    Text(it.name, Modifier.padding(horizontal = 14.dp, vertical = 8.dp), style = MaterialTheme.typography.labelLarge, maxLines = 1)
                }
            }
            selected?.let { pin ->
                Surface(
                    Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 64.dp), shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surface, shadowElevation = 4.dp,
                ) { Text(pin.label.ifBlank { pin.kind.name }, Modifier.padding(12.dp), style = MaterialTheme.typography.bodyMedium) }
            }
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

@Composable
private fun MapButton(onClick: () -> Unit, content: @Composable () -> Unit) {
    Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f), shadowElevation = 3.dp, modifier = Modifier.size(44.dp)) {
        IconButton(onClick = onClick) { content() }
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
    if (event.status == "draft") Banner(stringResource(R.string.event_not_started), BannerKind.Info)
    when (mode) {
        is EventSheetMode.NotMember -> NotMemberSheet(event, mode.state, ui.busy, vm)
        EventSheetMode.Pilot -> PilotSheet(event, vm, status, sync, activeLocal, imperial, onOpenComputer, onOpenWaiting, onOpenPermissions, onRetrieve)
        EventSheetMode.Retriever -> RetrieverSheet(event, ui, vm, status, imperial, onOpenPermissions)
        EventSheetMode.Observer, EventSheetMode.OrganizerOnly -> OverviewSheet(event, ui, imperial)
    }
    if (EventSheetMode.showsOrganizerTools(event)) OrganizerTools(event, ui, vm)
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

