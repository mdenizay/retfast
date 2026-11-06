package com.mizibu.retfast.ui.flight

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mizibu.retfast.R
import com.mizibu.retfast.data.SampleStatus
import com.mizibu.retfast.graph
import com.mizibu.retfast.net.RetrievalPickup
import com.mizibu.retfast.tracking.RawFix
import com.mizibu.retfast.ui.common.AeroTextField
import com.mizibu.retfast.ui.common.FlowChips
import com.mizibu.retfast.ui.common.Fmt
import com.mizibu.retfast.ui.common.LocationHelper
import com.mizibu.retfast.ui.common.PrimaryButton
import com.mizibu.retfast.ui.common.RowDivider
import com.mizibu.retfast.ui.common.SecondaryButton
import com.mizibu.retfast.ui.common.SimBadge
import com.mizibu.retfast.ui.common.SyncBadge
import com.mizibu.retfast.ui.common.TextAction
import com.mizibu.retfast.ui.common.Tone
import com.mizibu.retfast.ui.common.WarningRow
import com.mizibu.retfast.ui.map.MapContent
import com.mizibu.retfast.ui.map.MapPin
import com.mizibu.retfast.ui.map.PinKind
import com.mizibu.retfast.ui.map.RetfastMap
import com.mizibu.retfast.ui.theme.Aero
import com.mizibu.retfast.ui.theme.AeroTokens
import com.mizibu.retfast.ui.theme.Lucide
import com.mizibu.retfast.util.Iso
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Three-way ending: end and ask for a retrieve / end without / keep flying. Never ends a flight on its own. */
@Composable
fun EndFlightDialog(title: String, onEndRetrieve: () -> Unit, onEndNoRetrieve: () -> Unit, onDismiss: () -> Unit, dismissLabel: String, message: String? = null) {
    val c = Aero.colors
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = c.surface,
        shape = RoundedCornerShape(28.dp),
        icon = {
            Box(Modifier.size(52.dp).clip(CircleShape).background(c.primarySoft), contentAlignment = Alignment.Center) {
                Icon(Lucide.PlaneLanding, null, tint = c.primary, modifier = Modifier.size(24.dp))
            }
        },
        title = { Text(title, fontSize = 21.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary, textAlign = TextAlign.Center) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                if (message != null) Text(message, fontSize = 15.sp, lineHeight = 21.sp, color = c.textSecondary, textAlign = TextAlign.Center)
                PrimaryButton(stringResource(R.string.end_and_retrieve), onEndRetrieve, icon = Lucide.Car)
                SecondaryButton(stringResource(R.string.end_no_retrieve), onEndNoRetrieve, icon = Lucide.Flag)
                TextAction(dismissLabel, onDismiss, Modifier.fillMaxWidth(), color = c.textSecondary)
            }
        },
        confirmButton = {},
    )
}

/** "İndin mi?" prompt: shown over any screen when the landing profile is reached. */
@Composable
fun LandingPromptHost(onEndedWithRetrieve: (eventId: String?) -> Unit) {
    val g = LocalContext.current.graph
    val status by g.engine.status.collectAsStateWithLifecycle()
    if (!status.landingPrompt || !status.recording) return
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    EndFlightDialog(
        title = stringResource(R.string.landing_title),
        message = stringResource(R.string.landing_text),
        onEndRetrieve = {
            scope.launch {
                val eventId = status.eventId
                g.engine.endFlight(); g.engine.answerLanding(false)
                onEndedWithRetrieve(eventId)
            }
        },
        onEndNoRetrieve = { scope.launch { g.engine.endFlight(); g.engine.answerLanding(false) } },
        onDismiss = { g.engine.answerLanding(snooze = true) },
        dismissLabel = stringResource(R.string.still_flying),
    )
}

/** "Flight complete": the result at a glance, an optional retrieve and one way back. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FlightSummarySheet(flightId: String, canRetrieve: Boolean, onRetrieve: () -> Unit, onClose: () -> Unit) {
    val g = LocalContext.current.graph
    val c = Aero.colors
    val flight by g.db.flights().observe(flightId).collectAsStateWithLifecycle(null)
    val counts by g.db.samples().observeCounts(flightId).collectAsStateWithLifecycle(emptyList())
    val sync by g.sync.snapshot.collectAsStateWithLifecycle()
    val units by g.prefs.units.collectAsStateWithLifecycle()
    val imperial = units == "imperial"
    var appeared by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { delay(100); appeared = true }
    val scale by animateFloatAsState(if (appeared) 1f else 0.6f, spring(dampingRatio = 0.55f, stiffness = Spring.StiffnessLow), label = "check")

    ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = c.background) {
        Column(
            Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(112.dp).scale(scale).graphicsLayer { alpha = if (appeared) 1f else 0f }, contentAlignment = Alignment.Center) {
                    Box(Modifier.size(112.dp).clip(CircleShape).background(c.success.copy(alpha = 0.14f)))
                    Box(Modifier.size(78.dp).clip(CircleShape).background(c.success.copy(alpha = 0.22f)))
                    Icon(Lucide.Check, null, tint = c.success, modifier = Modifier.size(36.dp))
                }
                Text(stringResource(R.string.fs_title), fontSize = 26.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(flight?.eventName ?: stringResource(R.string.personal_flight), fontSize = 15.sp, color = c.textSecondary)
                    if (flight?.isSimulated == true) SimBadge()
                }
                Text(stringResource(R.string.fs_saved), fontSize = 13.sp, color = c.textMuted)
            }
            val f = flight
            if (f != null) {
                val dur = ((f.endedAt ?: System.currentTimeMillis()) - f.startedAt) / 1000
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(AeroTokens.Radius.lg.dp)).background(c.surface).padding(vertical = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Metric(stringResource(R.string.duration), Fmt.duration(dur), Modifier.weight(1f))
                    Box(Modifier.width(1.dp).height(40.dp).background(c.border))
                    Metric(stringResource(R.string.distance), Fmt.distance(f.distanceM, imperial), Modifier.weight(1f))
                    Box(Modifier.width(1.dp).height(40.dp).background(c.border))
                    Metric(stringResource(R.string.max_alt), Fmt.altitude(f.maxAltM, imperial), Modifier.weight(1f))
                }
                val synced = counts.firstOrNull { it.status == SampleStatus.SYNCED }?.n ?: 0
                val pending = counts.firstOrNull { it.status == SampleStatus.PENDING }?.n ?: 0
                val rejected = counts.firstOrNull { it.status == SampleStatus.REJECTED }?.n ?: 0
                Group {
                    SumRow(stringResource(R.string.max_speed), "${Fmt.speedValue(f.maxSpeedMs, imperial)} ${Fmt.speedUnit(imperial)}")
                    RowDivider(Modifier.padding(start = 16.dp))
                    SumRow(stringResource(R.string.ascent), Fmt.altitude(f.ascentM, imperial))
                    RowDivider(Modifier.padding(start = 16.dp))
                    SumRow(stringResource(R.string.fs_points), "${synced + pending + rejected}")
                    if (rejected > 0) {
                        RowDivider(Modifier.padding(start = 16.dp))
                        SumRow(stringResource(R.string.fs_rejected, rejected), "")
                    }
                    RowDivider(Modifier.padding(start = 16.dp))
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.fs_sync), Modifier.weight(1f), fontSize = 15.sp, color = c.textSecondary)
                        SyncBadge(sync)
                    }
                }
                if (pending > 0) Text(stringResource(R.string.fs_pending_note), fontSize = 13.sp, lineHeight = 18.sp, color = c.textMuted)
                f.lastError?.let { WarningRow(stringResource(R.string.flight_server_refused, it)) }
            }
            if (canRetrieve) PrimaryButton(stringResource(R.string.request_retrieve), onRetrieve, large = true, icon = Lucide.Car)
            SecondaryButton(stringResource(if (canRetrieve) R.string.no_retrieve_close else R.string.fs_home), onClose)
        }
    }
}

@Composable
private fun Group(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(AeroTokens.Radius.lg.dp)).background(Aero.colors.surface)) { content() }
}

@Composable
private fun Metric(label: String, value: String, modifier: Modifier) {
    val c = Aero.colors
    Column(modifier.padding(horizontal = 6.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(value, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary, maxLines = 1, style = TextStyle(fontFeatureSettings = "tnum"))
        Text(label, fontSize = 12.sp, color = c.textMuted, maxLines = 1)
    }
}

@Composable
private fun SumRow(label: String, value: String) {
    val c = Aero.colors
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), fontSize = 15.sp, color = c.textSecondary)
        Text(value, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary, style = TextStyle(fontFeatureSettings = "tnum"))
    }
}

/** "Retrieve iste": pickup = current position; saved on the phone first, sent when connected. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RetrieveRequestSheet(eventName: String, onDismiss: () -> Unit, onSend: (RetrievalPickup, String) -> Unit) {
    val ctx = LocalContext.current
    val g = ctx.graph
    val c = Aero.colors
    var refreshKey by remember { mutableIntStateOf(0) }
    var fix by remember { mutableStateOf<RawFix?>(null) }
    var loading by remember { mutableStateOf(true) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var note by remember { mutableStateOf("") }
    val chips = listOf(stringResource(R.string.chip_roadside), stringResource(R.string.chip_wing_packed), stringResource(R.string.chip_walking))
    var selected by remember { mutableStateOf(setOf<Int>()) }

    LaunchedEffect(refreshKey) {
        loading = true
        // Prefer a very recent engine fix, otherwise ask the provider for a fresh one.
        val st = g.engine.status.value
        val e = st.lastPos
        val fresh = st.lastFixAt?.let { System.currentTimeMillis() - it < 15_000 } == true
        fix = if (e != null && fresh && refreshKey == 0) RawFix(st.lastFixAt!!, e.first, e.second, st.values.gpsAltitude, st.lastAccuracy ?: 20.0) else LocationHelper.current(ctx) ?: fix
        loading = false
    }
    LaunchedEffect(Unit) { while (true) { delay(1000); now = System.currentTimeMillis() } }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = c.background) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(48.dp).clip(CircleShape).background(c.retrieval.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) {
                    Icon(Lucide.Car, null, tint = c.retrieval, modifier = Modifier.size(22.dp))
                }
                Column {
                    Text(stringResource(R.string.request_retrieve), fontSize = 22.sp, fontWeight = FontWeight.Bold, color = c.textPrimary)
                    Text(eventName, fontSize = 14.sp, color = c.textSecondary)
                }
            }
            val f = fix
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(AeroTokens.Radius.lg.dp)).background(c.surface),
            ) {
                if (f != null) {
                    Box(Modifier.fillMaxWidth().height(170.dp)) {
                        RetfastMap(MapContent(pins = listOf(MapPin("me", PinKind.ME, f.lat, f.lon, "")), focus = f.lat to f.lon, focusZoom = 15.0), interactive = false)
                    }
                }
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(stringResource(R.string.pickup_point), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.textSecondary)
                    if (f == null) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Icon(if (loading) Lucide.LocateFixed else Lucide.LocateOff, null, tint = c.textSecondary, modifier = Modifier.size(16.dp))
                            Text(stringResource(if (loading) R.string.getting_fix else R.string.no_fix), fontSize = 15.sp, color = c.textSecondary)
                        }
                    } else {
                        Text("${Fmt.coord(f.lat)}, ${Fmt.coord(f.lon)}", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary, style = TextStyle(fontFeatureSettings = "tnum"))
                        Text(stringResource(R.string.fix_info, Fmt.accuracy(f.hAcc), ((now - f.timeMs) / 1000).coerceAtLeast(0)), fontSize = 13.sp, color = c.textSecondary)
                        if (f.hAcc > 50) WarningRow(stringResource(R.string.low_accuracy_warning))
                    }
                    TextAction(stringResource(R.string.refresh_position), { refreshKey++ }, color = c.primary)
                }
            }
            FlowChips(chips, selected) { i -> selected = if (i in selected) selected - i else selected + i }
            AeroTextField(note, { note = it }, stringResource(R.string.note_optional), singleLine = false, minLines = 2, maxLines = 3)
            Text(stringResource(R.string.saved_first_note), fontSize = 13.sp, lineHeight = 18.sp, color = c.textMuted)
            WarningRow(stringResource(R.string.not_emergency_short), Tone.Info, Lucide.Info)
            PrimaryButton(stringResource(R.string.send_request), onClick = {
                val ff = fix ?: return@PrimaryButton
                val full = (selected.sorted().map { chips[it] } + listOfNotNull(note.trim().ifEmpty { null })).joinToString(". ")
                onSend(RetrievalPickup(ff.lat, ff.lon, ff.altitude, ff.hAcc, Iso.format(ff.timeMs)), full)
            }, enabled = fix != null, large = true, icon = Lucide.Send)
        }
    }
}
