package com.mizibu.retfast.ui.flight

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mizibu.retfast.R
import com.mizibu.retfast.graph
import com.mizibu.retfast.sync.SyncSnapshot
import com.mizibu.retfast.sync.SyncStatus
import com.mizibu.retfast.tracking.FlightPhase
import com.mizibu.retfast.ui.common.CapsuleSegment
import com.mizibu.retfast.ui.common.Fmt
import com.mizibu.retfast.ui.common.PrimaryButton
import com.mizibu.retfast.ui.common.Tone
import com.mizibu.retfast.ui.common.WarningRow
import com.mizibu.retfast.ui.map.MapContent
import com.mizibu.retfast.ui.map.MapLine
import com.mizibu.retfast.ui.map.MapPin
import com.mizibu.retfast.ui.map.PinKind
import com.mizibu.retfast.ui.map.RetfastMap
import com.mizibu.retfast.ui.theme.Aero
import com.mizibu.retfast.ui.theme.Lucide
import com.mizibu.retfast.ui.theme.RetfastTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Full-screen instruments. Minimising never stops recording (the engine/service own the session).
 * Altitude is the GPS altitude and the vertical speed an estimate; both are labelled as such.
 */
@Composable
fun FlightComputerScreen(onClose: () -> Unit, onEndedWithRetrieve: (eventId: String?) -> Unit) {
    val ctx = LocalContext.current
    val g = ctx.graph
    val highContrast by g.prefs.flightHighContrast.collectAsStateWithLifecycle()
    val themeMode by g.prefs.theme.collectAsStateWithLifecycle()
    RetfastTheme(if (highContrast) "dark" else themeMode) { ComputerBody(onClose, onEndedWithRetrieve) }
}

@Composable
private fun ComputerBody(onClose: () -> Unit, onEndedWithRetrieve: (String?) -> Unit) {
    val g = LocalContext.current.graph
    val status by g.engine.status.collectAsStateWithLifecycle()
    val sync by g.sync.snapshot.collectAsStateWithLifecycle()
    val units by g.prefs.units.collectAsStateWithLifecycle()
    val imperial = units == "imperial"
    val scope = rememberCoroutineScope()
    var tab by remember { mutableStateOf(0) }
    var showEnd by remember { mutableStateOf(false) }
    var showSos by remember { mutableStateOf(false) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val v = status.values
    val c = Aero.colors

    val view = LocalView.current
    DisposableEffect(view) { view.keepScreenOn = true; onDispose { view.keepScreenOn = false } }
    LaunchedEffect(Unit) { while (true) { g.engine.refreshBattery(); repeat(30) { delay(1000); now = System.currentTimeMillis() } } }

    // Flight finished elsewhere (notification stop, landing prompt): leave the cockpit.
    LaunchedEffect(status.phase) { if (status.phase != FlightPhase.RECORDING) onClose() }

    val fixAge = Fmt.ageSeconds(now, status.lastFixAt)
    val waitingGps = status.lastFixAt == null

    Column(Modifier.fillMaxSize().background(c.background).safeDrawingPadding().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // Header: minimise · state · sync dot
        Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                Modifier.size(42.dp).clip(CircleShape).background(c.surface).clickable(role = Role.Button, onClick = onClose),
                contentAlignment = Alignment.Center,
            ) { Icon(Lucide.ChevronDown, stringResource(R.string.minimise), tint = c.textPrimary, modifier = Modifier.size(22.dp)) }
            Column(Modifier.weight(1f)) {
                StateLine(waitingGps)
                Text(
                    status.battery?.let { "${(it * 100).toInt()}%" + if (status.lowPower) " · ${stringResource(R.string.battery_saver)}" else "" } ?: "",
                    fontSize = 12.sp, color = c.textMuted,
                )
            }
            SyncDot(sync)
        }

        Text(
            Fmt.duration(((now - (status.startedAt ?: now)) / 1000)),
            fontSize = 56.sp, fontWeight = FontWeight.Bold, color = c.textPrimary, style = TextStyle(fontFeatureSettings = "tnum"), lineHeight = 60.sp,
        )

        CapsuleSegment(listOf(0 to stringResource(R.string.show_instruments), 1 to stringResource(R.string.show_map)), tab, { tab = it })

        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (!status.locationAvailable) WarningRow(stringResource(R.string.gps_off), Tone.Error, Lucide.LocateOff)
            status.error?.let { WarningRow(stringResource(R.string.engine_error, it), Tone.Error, Lucide.OctagonAlert) }
            if (waitingGps) WarningRow(stringResource(R.string.fc_waiting_gps_body), Tone.Info, Lucide.Satellite)
            if (fixAge != null && fixAge > 15) WarningRow(stringResource(R.string.fc_last_fix, stringResource(R.string.age_s, fixAge.toInt())), Tone.Warning, Lucide.ClockAlert)
            if (v.lowQuality) WarningRow(stringResource(R.string.fc_low_quality, Fmt.accuracy(v.hAcc)), Tone.Warning, Lucide.Crosshair)

            if (tab == 1) {
                val mine = v.lat?.let { it to v.lon!! }
                var track by remember { mutableStateOf<List<Pair<Double, Double>>>(emptyList()) }
                LaunchedEffect(status.storedSamples / 5) { status.flightId?.let { id -> track = g.db.samples().recentPoints(id, 500).map { it.lat to it.lon }.reversed() } }
                Box(Modifier.fillMaxWidth().height(420.dp).clip(RoundedCornerShape(24.dp))) {
                    RetfastMap(
                        MapContent(
                            pins = listOfNotNull(mine?.let { MapPin("me", PinKind.ME, it.first, it.second) }),
                            lines = if (track.size >= 2) listOf(MapLine("mine", track, "mine")) else emptyList(),
                            focus = mine, focusZoom = 14.0,
                        ),
                    )
                }
            } else {
                val vs = v.verticalSpeed ?: 0.0
                val climbing = vs > 0.3
                val sinking = vs < -1.5
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    FlightValue(stringResource(R.string.fc_altitude), Fmt.altitudeValue(v.gpsAltitude, imperial), Fmt.altitudeUnit(imperial), Lucide.Mountain, Modifier.weight(1f))
                    FlightValue(
                        stringResource(R.string.fc_vertical), Fmt.vario(v.verticalSpeed, imperial), Fmt.varioUnit(imperial),
                        if (climbing) Lucide.ArrowUp else if (sinking) Lucide.ArrowDown else Lucide.Minus, Modifier.weight(1f),
                        tint = if (climbing) c.success else if (sinking) c.error else null,
                    )
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    FlightValue(stringResource(R.string.ground_speed), Fmt.speedValue(v.groundSpeed, imperial), Fmt.speedUnit(imperial), Lucide.Gauge, Modifier.weight(1f))
                    val d = Fmt.distance(v.distance, imperial).split(" ")
                    FlightValue(stringResource(R.string.distance), d.first(), d.getOrElse(1) { "" }, Lucide.Route, Modifier.weight(1f))
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    SmallValue(stringResource(R.string.max_alt), Fmt.altitude(v.maxAltitude, imperial), Modifier.weight(1f))
                    SmallValue(stringResource(R.string.ascent), Fmt.altitude(v.totalAscent, imperial), Modifier.weight(1f))
                    SmallValue(stringResource(R.string.heading), Fmt.degrees(v.heading), Modifier.weight(1f))
                }
                Text(stringResource(R.string.gps_alt_hint), fontSize = 12.sp, lineHeight = 16.sp, color = c.textMuted)
                Text(
                    stringResource(R.string.cockpit_footer, status.storedSamples, status.profile?.wire ?: "-", status.source),
                    fontSize = 11.sp, color = c.textMuted,
                )
            }
        }

        Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(
                Modifier.widthIn(min = 104.dp).heightIn(min = 58.dp).clip(CircleShape).background(c.error)
                    .clickable(role = Role.Button) { showSos = true }.padding(horizontal = 18.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
            ) {
                Icon(Lucide.Siren, null, tint = c.onEmergency, modifier = Modifier.size(20.dp))
                Text(stringResource(R.string.sos), color = c.onEmergency, fontWeight = FontWeight.ExtraBold, fontSize = 17.sp)
            }
            PrimaryButton(stringResource(R.string.end_flight), { showEnd = true }, Modifier.weight(1f), large = true, icon = Lucide.Flag)
        }
    }

    if (showSos) EmergencySheet { showSos = false }
    if (showEnd) {
        EndFlightDialog(
            title = stringResource(R.string.end_flight_q),
            message = stringResource(R.string.end_flight_body),
            onEndRetrieve = {
                showEnd = false
                scope.launch { val eventId = status.eventId; g.engine.endFlight(); onEndedWithRetrieve(eventId) }
            },
            onEndNoRetrieve = { showEnd = false; scope.launch { g.engine.endFlight(); onClose() } },
            onDismiss = { showEnd = false },
            dismissLabel = stringResource(R.string.keep_recording),
        )
    }
}

@Composable
private fun StateLine(waitingGps: Boolean) {
    val c = Aero.colors
    val color = if (waitingGps) c.warning else c.error
    val pulse by rememberInfiniteTransition(label = "rec").animateFloat(1f, 0.3f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "dot")
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(8.dp).alpha(if (waitingGps) 1f else pulse).clip(CircleShape).background(color))
        Text(stringResource(if (waitingGps) R.string.fc_waiting_gps else R.string.recording), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = color)
    }
}

/** Quiet sync indicator: only an icon, coloured when something is waiting. */
@Composable
private fun SyncDot(s: SyncSnapshot) {
    val c = Aero.colors
    val ok = s.status == SyncStatus.SYNCED || (s.status == SyncStatus.SYNCING && s.pendingCount < 30)
    Box(Modifier.size(42.dp).clip(CircleShape).background(c.surface), contentAlignment = Alignment.Center) {
        Icon(
            if (ok) Lucide.Cloud else Lucide.CloudOff,
            if (ok) stringResource(R.string.fc_sync_ok) else stringResource(R.string.fc_sync_pending, s.pendingCount),
            tint = if (ok) c.textMuted else c.warning, modifier = Modifier.size(19.dp),
        )
    }
}

@Composable
private fun FlightValue(label: String, value: String, unit: String, icon: ImageVector, modifier: Modifier, tint: Color? = null) {
    val c = Aero.colors
    Column(modifier.clip(RoundedCornerShape(22.dp)).background(c.surface).padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            Icon(icon, null, tint = tint ?: c.textSecondary, modifier = Modifier.size(14.dp))
            Text(label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = tint ?: c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(value, fontSize = 36.sp, fontWeight = FontWeight.Bold, color = tint ?: c.textPrimary, maxLines = 1, style = TextStyle(fontFeatureSettings = "tnum"))
            Text(unit, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.textSecondary, modifier = Modifier.padding(bottom = 6.dp))
        }
    }
}

@Composable
private fun SmallValue(label: String, value: String, modifier: Modifier) {
    val c = Aero.colors
    Column(modifier.clip(RoundedCornerShape(18.dp)).background(c.surface).padding(horizontal = 12.dp, vertical = 10.dp)) {
        Text(label, fontSize = 12.sp, color = c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(value, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary, maxLines = 1, style = TextStyle(fontFeatureSettings = "tnum"))
    }
}
