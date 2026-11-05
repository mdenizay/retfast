package com.mizibu.retfast.ui.flight

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mizibu.retfast.R
import com.mizibu.retfast.data.SampleStatus
import com.mizibu.retfast.graph
import com.mizibu.retfast.net.RetrievalPickup
import com.mizibu.retfast.tracking.RawFix
import com.mizibu.retfast.ui.common.AeroCard
import com.mizibu.retfast.ui.common.Banner
import com.mizibu.retfast.ui.common.BannerKind
import com.mizibu.retfast.ui.common.Fmt
import com.mizibu.retfast.ui.common.LocationHelper
import com.mizibu.retfast.ui.common.PrimaryButton
import com.mizibu.retfast.ui.common.SecondaryButton
import com.mizibu.retfast.ui.map.MapContent
import com.mizibu.retfast.ui.map.MapPin
import com.mizibu.retfast.ui.map.PinKind
import com.mizibu.retfast.ui.map.RetfastMap
import com.mizibu.retfast.util.Iso
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Three-way ending: end and ask for a retrieve / end without / keep flying. Never ends a flight on its own. */
@Composable
fun EndFlightDialog(title: String, onEndRetrieve: () -> Unit, onEndNoRetrieve: () -> Unit, onDismiss: () -> Unit, dismissLabel: String, message: String? = null) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (message != null) Text(message, style = MaterialTheme.typography.bodyMedium)
                PrimaryButton(stringResource(R.string.end_and_retrieve), onEndRetrieve)
                SecondaryButton(stringResource(R.string.end_no_retrieve), onEndNoRetrieve)
                TextButton(onDismiss, Modifier.fillMaxWidth()) { Text(dismissLabel) }
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
            scope.launch2 {
                val eventId = status.eventId
                g.engine.endFlight(); g.engine.answerLanding(false)
                onEndedWithRetrieve(eventId)
            }
        },
        onEndNoRetrieve = { scope.launch2 { g.engine.endFlight(); g.engine.answerLanding(false) } },
        onDismiss = { g.engine.answerLanding(snooze = true) },
        dismissLabel = stringResource(R.string.still_flying),
    )
}

private fun kotlinx.coroutines.CoroutineScope.launch2(block: suspend () -> Unit) { launch { block() } }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FlightSummarySheet(flightId: String, canRetrieve: Boolean, onRetrieve: () -> Unit, onClose: () -> Unit) {
    val g = LocalContext.current.graph
    val flight by g.db.flights().observe(flightId).collectAsStateWithLifecycle(null)
    val counts by g.db.samples().observeCounts(flightId).collectAsStateWithLifecycle(emptyList())
    val units by g.prefs.units.collectAsStateWithLifecycle()
    val imperial = units == "imperial"
    ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.flight_summary), style = MaterialTheme.typography.titleLarge)
            flight?.let { f ->
                val dur = ((f.endedAt ?: System.currentTimeMillis()) - f.startedAt) / 1000
                AeroCard {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Stat(stringResource(R.string.duration), Fmt.duration(dur))
                        Stat(stringResource(R.string.distance), Fmt.distance(f.distanceM, imperial))
                        Stat(stringResource(R.string.max_alt), Fmt.altitude(f.maxAltM, imperial))
                    }
                    val synced = counts.firstOrNull { it.status == SampleStatus.SYNCED }?.n ?: 0
                    val pending = counts.firstOrNull { it.status == SampleStatus.PENDING }?.n ?: 0
                    val rejected = counts.firstOrNull { it.status == SampleStatus.REJECTED }?.n ?: 0
                    Text(stringResource(R.string.sample_counts, synced, pending, rejected), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    f.lastError?.let { Banner(stringResource(R.string.flight_server_refused, it), BannerKind.Warning) }
                }
            }
            if (canRetrieve) PrimaryButton(stringResource(R.string.request_retrieve), onRetrieve, large = true)
            SecondaryButton(stringResource(if (canRetrieve) R.string.no_retrieve_close else R.string.close), onClose)
        }
    }
}

@Composable
private fun Stat(label: String, value: String) {
    Column {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.titleMedium)
    }
}

/** "Retrieve iste": pickup = current position; saved on the phone first, sent when connected. */
@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun RetrieveRequestSheet(eventName: String, onDismiss: () -> Unit, onSend: (RetrievalPickup, String) -> Unit) {
    val ctx = LocalContext.current
    val g = ctx.graph
    var refreshKey by remember { mutableIntStateOf(0) }
    var fix by remember { mutableStateOf<RawFix?>(null) }
    var loading by remember { mutableStateOf(true) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var note by remember { mutableStateOf("") }
    val chips = listOf(stringResource(R.string.chip_roadside), stringResource(R.string.chip_wing_packed), stringResource(R.string.chip_walking))
    var selected by remember { mutableStateOf(setOf<String>()) }

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

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.request_retrieve), style = MaterialTheme.typography.titleLarge)
            Text(eventName, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val f = fix
            AeroCard {
                Text(stringResource(R.string.pickup_point), style = MaterialTheme.typography.titleSmall)
                if (f == null) {
                    Banner(stringResource(if (loading) R.string.getting_fix else R.string.no_fix), if (loading) BannerKind.Info else BannerKind.Warning)
                } else {
                    androidx.compose.foundation.layout.Box(Modifier.fillMaxWidth().padding(vertical = 4.dp).height(160.dp)) {
                        RetfastMap(MapContent(pins = listOf(MapPin("me", PinKind.ME, f.lat, f.lon, "")), focus = f.lat to f.lon, focusZoom = 15.0))
                    }
                    Text("${Fmt.coord(f.lat)}, ${Fmt.coord(f.lon)}", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        stringResource(R.string.fix_info, Fmt.accuracy(f.hAcc), ((now - f.timeMs) / 1000).coerceAtLeast(0)),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (f.hAcc > 50) Banner(stringResource(R.string.low_accuracy_warning), BannerKind.Warning)
                }
                SecondaryButton(stringResource(R.string.refresh_position), { refreshKey++ })
            }
            androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                chips.forEach { c ->
                    FilterChip(c in selected, {
                        selected = if (c in selected) selected - c else selected + c
                    }, label = { Text(c) })
                }
            }
            OutlinedTextField(note, { note = it }, label = { Text(stringResource(R.string.note_optional)) }, modifier = Modifier.fillMaxWidth(), maxLines = 3)
            Text(stringResource(R.string.saved_first_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Banner(stringResource(R.string.not_emergency_short), BannerKind.Info)
            PrimaryButton(stringResource(R.string.send_request), onClick = {
                val ff = fix ?: return@PrimaryButton
                val full = (selected.toList() + listOfNotNull(note.trim().ifEmpty { null })).joinToString(". ")
                onSend(RetrievalPickup(ff.lat, ff.lon, ff.altitude, ff.hAcc, Iso.format(ff.timeMs)), full)
            }, enabled = fix != null, large = true)
        }
    }
}


