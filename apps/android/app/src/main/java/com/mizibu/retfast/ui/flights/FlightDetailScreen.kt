package com.mizibu.retfast.ui.flights

import android.content.Intent
import androidx.compose.foundation.Canvas
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mizibu.retfast.R
import com.mizibu.retfast.data.SampleStatus
import com.mizibu.retfast.graph
import com.mizibu.retfast.net.ApiException
import com.mizibu.retfast.net.flightPositions
import com.mizibu.retfast.tracking.RawFix
import com.mizibu.retfast.tracking.TelemetryProcessor
import com.mizibu.retfast.tracking.TrackingProfile
import com.mizibu.retfast.ui.common.AeroCard
import com.mizibu.retfast.ui.common.Banner
import com.mizibu.retfast.ui.common.BannerKind
import com.mizibu.retfast.ui.common.Fmt
import com.mizibu.retfast.ui.common.InstrumentTile
import com.mizibu.retfast.ui.common.LoadingBox
import com.mizibu.retfast.ui.common.PrimaryButton
import com.mizibu.retfast.ui.common.SecondaryButton
import com.mizibu.retfast.ui.map.MapContent
import com.mizibu.retfast.ui.map.MapLine
import com.mizibu.retfast.ui.map.MapPin
import com.mizibu.retfast.ui.map.PinKind
import com.mizibu.retfast.ui.map.RetfastMap
import com.mizibu.retfast.ui.theme.Aero
import com.mizibu.retfast.util.Iso
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

data class TrackPoint(val t: Long, val lat: Double, val lon: Double, val alt: Double?, val speed: Double?, val hAcc: Double)

private data class Detail(
    val title: String, val startedAt: Long, val points: List<TrackPoint>, val processed: com.mizibu.retfast.tracking.FlightValues,
    val lowQuality: Int, val rejected: Int, val pending: Int, val local: Boolean, val simulated: Boolean,
)

object Gpx {
    /** GPX 1.1. Not a certified flight log, and the file says so. */
    fun build(name: String, points: List<TrackPoint>): String = buildString {
        append("""<?xml version="1.0" encoding="UTF-8"?>""").append('\n')
        append("""<gpx version="1.1" creator="Retfast Android" xmlns="http://www.topografix.com/GPX/1/1">""").append('\n')
        append("  <metadata><name>").append(escape(name)).append("</name><desc>Retfast GPS track. Not a certified flight log.</desc></metadata>\n")
        append("  <trk><name>").append(escape(name)).append("</name><trkseg>\n")
        points.forEach { p ->
            append("    <trkpt lat=\"").append(p.lat).append("\" lon=\"").append(p.lon).append("\">")
            p.alt?.let { append("<ele>").append(String.format(java.util.Locale.US, "%.1f", it)).append("</ele>") }
            append("<time>").append(Iso.format(p.t)).append("</time></trkpt>\n")
        }
        append("  </trkseg></trk>\n</gpx>\n")
    }

    private fun escape(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
}

@Composable
fun FlightDetailScreen(id: String, onBack: () -> Unit) {
    val ctx = LocalContext.current
    val g = ctx.graph
    val scope = rememberCoroutineScope()
    val units by g.prefs.units.collectAsStateWithLifecycle()
    val imperial = units == "imperial"
    var detail by remember { mutableStateOf<Detail?>(null) }
    var loadError by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val privateName = stringResource(R.string.private_flight)

    LaunchedEffect(id) {
        detail = null
        val flight = g.db.flights().byId(id)
        try {
            if (flight != null) {
                val s = g.db.samples().forFlight(id)
                val pts = s.map { TrackPoint(it.t, it.lat, it.lon, it.altitude, it.speed, it.hAcc) }
                detail = Detail(
                    flight.eventName ?: privateName, flight.startedAt, pts, replay(pts), s.count { it.lowQuality }, s.count { it.status == SampleStatus.REJECTED },
                    s.count { it.status == SampleStatus.PENDING }, true, flight.isSimulated,
                )
            } else {
                val ps = g.api.flightPositions(id)
                val pts = ps.mapNotNull { p -> Iso.parse(p.t)?.let { TrackPoint(it, p.lat, p.lon, p.gpsAltM, p.speedMs, p.hAccM ?: 10.0) } }
                detail = Detail(privateName, pts.firstOrNull()?.t ?: 0L, pts, replay(pts), 0, 0, 0, false, false)
            }
        } catch (e: ApiException) { loadError = true }
    }

    Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TextButton(onBack) { Text(stringResource(R.string.back)) }
        val d = detail
        when {
            loadError -> Banner(stringResource(R.string.err_offline), BannerKind.Error)
            d == null -> LoadingBox()
            else -> {
                Text(d.title, style = MaterialTheme.typography.headlineMedium)
                if (d.points.size >= 2) {
                    Box(Modifier.fillMaxWidth().height(260.dp)) {
                        val route = d.points.map { it.lat to it.lon }
                        RetfastMap(MapContent(
                            pins = listOf(MapPin("s", PinKind.MINE_START, route.first().first, route.first().second, stringResource(R.string.takeoff)), MapPin("e", PinKind.PICKUP, route.last().first, route.last().second, stringResource(R.string.landing))),
                            lines = listOf(MapLine("route", route, "route")), fit = route.thin(300), fitKey = "detail-$id",
                        ))
                    }
                } else Banner(stringResource(R.string.no_track_points), BannerKind.Info)

                val v = d.processed
                AeroCard {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        val dur = if (d.points.size >= 2) (d.points.last().t - d.points.first().t) / 1000 else 0
                        InstrumentTile(stringResource(R.string.duration), Fmt.duration(dur), "")
                        InstrumentTile(stringResource(R.string.distance), Fmt.distance(v.distance, imperial), "")
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        InstrumentTile(stringResource(R.string.max_alt), Fmt.altitudeValue(v.maxAltitude, imperial), Fmt.altitudeUnit(imperial), hint = stringResource(R.string.gps_alt_hint))
                        InstrumentTile(stringResource(R.string.max_speed), Fmt.speedValue(v.maxGroundSpeed, imperial), Fmt.speedUnit(imperial))
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        InstrumentTile(stringResource(R.string.ascent), Fmt.altitudeValue(v.totalAscent, imperial), Fmt.altitudeUnit(imperial))
                        InstrumentTile(stringResource(R.string.descent), Fmt.altitudeValue(v.totalDescent, imperial), Fmt.altitudeUnit(imperial))
                    }
                }
                if (d.points.size >= 2) {
                    AeroCard {
                        Text(stringResource(R.string.chart_alt), style = MaterialTheme.typography.titleSmall)
                        LineChart(d.points.map { it.alt?.let { a -> if (imperial) a * 3.28084 else a } }, Aero.colors.primary, Fmt.altitudeUnit(imperial))
                        Text(stringResource(R.string.chart_speed), style = MaterialTheme.typography.titleSmall)
                        LineChart(d.points.map { it.speed?.let { s -> if (imperial) s * 2.23694 else s * 3.6 } }, Aero.colors.secondary, Fmt.speedUnit(imperial))
                    }
                }
                AeroCard {
                    Text(stringResource(R.string.gps_quality), style = MaterialTheme.typography.titleSmall)
                    Text(stringResource(R.string.quality_summary, d.points.size, d.lowQuality, d.rejected, d.pending), style = MaterialTheme.typography.bodyMedium)
                    if (d.pending > 0) Text(stringResource(R.string.pending_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                PrimaryButton(stringResource(R.string.share_gpx), onClick = {
                    scope.launch {
                        val file = withContext(Dispatchers.IO) {
                            File(ctx.cacheDir, "gpx").apply { mkdirs() }.let { dir -> File(dir, "retfast-${id.take(8)}.gpx").also { it.writeText(Gpx.build(d.title, d.points)) } }
                        }
                        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", file)
                        val send = Intent(Intent.ACTION_SEND).setType("application/gpx+xml").putExtra(Intent.EXTRA_STREAM, uri)
                            .putExtra(Intent.EXTRA_SUBJECT, d.title).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        ctx.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                }, enabled = d.points.isNotEmpty())
                Text(stringResource(R.string.gpx_disclaimer), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (d.local) SecondaryButton(stringResource(R.string.delete_local), { confirmDelete = true }, destructive = true)
            }
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text(stringResource(R.string.delete_local)) },
            text = { Text(stringResource(R.string.delete_local_confirm)) },
            confirmButton = {
                TextButton({
                    confirmDelete = false
                    scope.launch { if (g.db.flights().deleteIfFullySynced(id) > 0) onBack() else loadError = false }
                }) { Text(stringResource(R.string.delete)) }
            },
            dismissButton = { TextButton({ confirmDelete = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

private fun replay(pts: List<TrackPoint>): com.mizibu.retfast.tracking.FlightValues {
    val p = TelemetryProcessor()
    pts.forEach { p.process(RawFix(it.t, it.lat, it.lon, it.alt, it.hAcc, null, it.speed, null), TrackingProfile.ACTIVE_FLIGHT, it.t) }
    return p.values
}

private fun List<Pair<Double, Double>>.thin(max: Int): List<Pair<Double, Double>> {
    if (size <= max) return this
    val step = size.toDouble() / max
    return (0 until max).map { this[(it * step).toInt()] } + last()
}

/** Minimal Canvas line chart: min/max labelled, gaps for missing values. */
@Composable
fun LineChart(values: List<Double?>, color: androidx.compose.ui.graphics.Color, unit: String, modifier: Modifier = Modifier) {
    val present = values.filterNotNull()
    if (present.size < 2) { Text("—", style = MaterialTheme.typography.bodySmall); return }
    val lo = present.min()
    val hi = present.max()
    val axis = MaterialTheme.colorScheme.outline
    Column(modifier) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("max ${hi.toInt()} $unit", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("min ${lo.toInt()} $unit", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Canvas(Modifier.fillMaxWidth().height(110.dp)) {
            val span = (hi - lo).takeIf { it > 1e-6 } ?: 1.0
            val step = size.width / (values.size - 1).coerceAtLeast(1)
            // thin to at most ~600 drawn points
            val stride = (values.size / 600).coerceAtLeast(1)
            drawLine(axis, Offset(0f, size.height), Offset(size.width, size.height), strokeWidth = 1f)
            var path = Path()
            var open = false
            values.forEachIndexed { i, v ->
                if (i % stride != 0 && i != values.lastIndex) return@forEachIndexed
                if (v == null) { if (open) { drawPath(path, color, style = Stroke(3f, cap = StrokeCap.Round)); path = Path(); open = false }; return@forEachIndexed }
                val x = i * step
                val y = (size.height - ((v - lo) / span * size.height)).toFloat()
                if (!open) { path.moveTo(x, y); open = true } else path.lineTo(x, y)
            }
            if (open) drawPath(path, color, style = Stroke(3f, cap = StrokeCap.Round))
        }
    }
}
