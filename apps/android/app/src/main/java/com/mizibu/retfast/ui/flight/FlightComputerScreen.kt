package com.mizibu.retfast.ui.flight

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mizibu.retfast.R
import com.mizibu.retfast.graph
import com.mizibu.retfast.tracking.FlightPhase
import com.mizibu.retfast.ui.common.AeroCard
import com.mizibu.retfast.ui.common.Banner
import com.mizibu.retfast.ui.common.BannerKind
import com.mizibu.retfast.ui.common.Fmt
import com.mizibu.retfast.ui.common.InstrumentTile
import com.mizibu.retfast.ui.common.PrimaryButton
import com.mizibu.retfast.ui.common.SecondaryButton
import com.mizibu.retfast.ui.common.StatusPill
import com.mizibu.retfast.ui.common.SyncBadge
import com.mizibu.retfast.ui.map.MapContent
import com.mizibu.retfast.ui.map.MapLine
import com.mizibu.retfast.ui.map.MapPin
import com.mizibu.retfast.ui.map.PinKind
import com.mizibu.retfast.ui.map.RetfastMap
import com.mizibu.retfast.ui.theme.Aero
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
    var showMap by remember { mutableStateOf(false) }
    var showEnd by remember { mutableStateOf(false) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val v = status.values
    val c = Aero.colors

    val view = LocalView.current
    DisposableEffect(view) { view.keepScreenOn = true; onDispose { view.keepScreenOn = false } }
    LaunchedEffect(Unit) { while (true) { g.engine.refreshBattery(); repeat(30) { delay(1000); now = System.currentTimeMillis() } } }

    // Flight finished elsewhere (notification stop, landing prompt): leave the cockpit.
    LaunchedEffect(status.phase) { if (status.phase != FlightPhase.RECORDING) onClose() }

    val fixAge = Fmt.ageSeconds(now, status.lastFixAt)

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            TextButton(onClick = onClose) { Text(stringResource(R.string.minimise)) }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                StatusPill(stringResource(R.string.recording), c.trackingActive, Icons.Filled.CheckCircle)
                SyncBadge(sync)
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(Fmt.duration(((now - (status.startedAt ?: now)) / 1000)), style = MaterialTheme.typography.displayMedium.copy(fontFamily = com.mizibu.retfast.ui.theme.Mono))
            Text(
                status.battery?.let { "${(it * 100).toInt()}%" + if (status.lowPower) " · ${stringResource(R.string.battery_saver)}" else "" } ?: "",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (!status.locationAvailable) Banner(stringResource(R.string.gps_off), BannerKind.Error)
            status.error?.let { Banner(stringResource(R.string.engine_error, it), BannerKind.Error) }
            if (fixAge != null && fixAge > 10) Banner(stringResource(R.string.stale_fix, fixAge), BannerKind.Warning)
            if (v.lowQuality) Banner(stringResource(R.string.low_quality_gps), BannerKind.Warning)

            if (showMap) {
                val mine = v.lat?.let { it to v.lon!! }
                var track by remember { mutableStateOf<List<Pair<Double, Double>>>(emptyList()) }
                LaunchedEffect(status.storedSamples / 5) { status.flightId?.let { id -> track = g.db.samples().recentPoints(id, 500).map { it.lat to it.lon }.reversed() } }
                Box(Modifier.fillMaxWidth().padding(bottom = 4.dp).then(Modifier.height2(380))) {
                    RetfastMap(MapContent(
                        pins = listOfNotNull(mine?.let { MapPin("me", PinKind.ME, it.first, it.second) }),
                        lines = if (track.size >= 2) listOf(MapLine("mine", track, "mine")) else emptyList(),
                        focus = mine, focusZoom = 14.0,
                    ), recenterKey = 0)
                }
            } else {
                AeroCard {
                    InstrumentTile(stringResource(R.string.gps_alt), Fmt.altitudeValue(v.gpsAltitude, imperial), Fmt.altitudeUnit(imperial), big = true, hint = stringResource(R.string.gps_alt_hint))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        InstrumentTile(stringResource(R.string.ground_speed), Fmt.speedValue(v.groundSpeed, imperial), Fmt.speedUnit(imperial), Modifier.weight(1f))
                        InstrumentTile(
                            stringResource(R.string.vario_estimate), Fmt.vario(v.verticalSpeed, imperial), Fmt.varioUnit(imperial), Modifier.weight(1f),
                            valueColor = if ((v.verticalSpeed ?: 0.0) > 0.3) c.success else if ((v.verticalSpeed ?: 0.0) < -2.0) c.warning else androidx.compose.ui.graphics.Color.Unspecified,
                        )
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        InstrumentTile(stringResource(R.string.accuracy), Fmt.accuracy(v.hAcc).removePrefix("±"), "m", Modifier.weight(1f))
                        InstrumentTile(stringResource(R.string.heading), Fmt.degrees(v.heading).removeSuffix("°"), "°", Modifier.weight(1f))
                    }
                }
                AeroCard {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        InstrumentTile(stringResource(R.string.distance), Fmt.distance(v.distance, imperial), "")
                        InstrumentTile(stringResource(R.string.max_alt), Fmt.altitudeValue(v.maxAltitude, imperial), Fmt.altitudeUnit(imperial))
                        InstrumentTile(stringResource(R.string.ascent), Fmt.altitudeValue(v.totalAscent, imperial), Fmt.altitudeUnit(imperial))
                    }
                    Text(
                        stringResource(R.string.cockpit_footer, status.storedSamples, status.profile?.wire ?: "-", status.source),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        SecondaryButton(stringResource(if (showMap) R.string.show_instruments else R.string.show_map), { showMap = !showMap })
        PrimaryButton(stringResource(R.string.i_landed), { showEnd = true }, large = true)
        Box(Modifier.padding(bottom = 8.dp)) { SecondaryButton(stringResource(R.string.end_flight), { showEnd = true }, destructive = true) }
    }

    if (showEnd) {
        EndFlightDialog(
            title = stringResource(R.string.end_flight_q),
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

private fun Modifier.height2(dp: Int) = this.then(Modifier.padding(0.dp)).then(Modifier.height(dp.dp))
