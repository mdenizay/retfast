package com.mizibu.retfast.ui.flights

import android.content.Intent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Canvas
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mizibu.retfast.R
import com.mizibu.retfast.data.SampleStatus
import com.mizibu.retfast.graph
import com.mizibu.retfast.net.ApiException
import com.mizibu.retfast.net.flightPositions
import com.mizibu.retfast.tracking.FlightValues
import com.mizibu.retfast.tracking.RawFix
import com.mizibu.retfast.tracking.TelemetryProcessor
import com.mizibu.retfast.tracking.TrackingProfile
import com.mizibu.retfast.ui.common.AeroCard
import com.mizibu.retfast.ui.common.ConfirmDialog
import com.mizibu.retfast.ui.common.EmptyState
import com.mizibu.retfast.ui.common.Fmt
import com.mizibu.retfast.ui.common.HeaderCircleButton
import com.mizibu.retfast.ui.common.KeyValueRow
import com.mizibu.retfast.ui.common.LoadingBox
import com.mizibu.retfast.ui.common.RowDivider
import com.mizibu.retfast.ui.common.SecondaryButton
import com.mizibu.retfast.ui.common.SimBadge
import com.mizibu.retfast.ui.common.TopBar
import com.mizibu.retfast.ui.common.WarningRow
import com.mizibu.retfast.ui.common.Tone
import com.mizibu.retfast.ui.map.MapContent
import com.mizibu.retfast.ui.map.MapLine
import com.mizibu.retfast.ui.map.MapPin
import com.mizibu.retfast.ui.map.PinKind
import com.mizibu.retfast.ui.map.RetfastMap
import com.mizibu.retfast.ui.theme.Aero
import com.mizibu.retfast.ui.theme.AeroTokens
import com.mizibu.retfast.ui.theme.Lucide
import com.mizibu.retfast.ui.theme.Mono
import com.mizibu.retfast.util.Iso
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.DateFormat
import java.util.Date

data class TrackPoint(val t: Long, val lat: Double, val lon: Double, val alt: Double?, val speed: Double?, val hAcc: Double)

private data class Detail(
    val title: String,
    val startedAt: Long,
    val points: List<TrackPoint>,
    val values: FlightValues,
    val lowQuality: Int,
    val synced: Int,
    val rejected: Int,
    val pending: Int,
    val local: Boolean,
    val simulated: Boolean,
    val sync: RowSync,
    val lastError: String?,
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

/** Flight detail, mirrors iOS FlightDetailView + FlightTrackSummary. */
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
    val personal = stringResource(R.string.personal_flight)
    val c = Aero.colors

    LaunchedEffect(id) {
        detail = null
        loadError = false
        val flight = g.db.flights().byId(id)
        try {
            detail = if (flight != null) {
                val s = g.db.samples().forFlight(id)
                val pts = s.map { TrackPoint(it.t, it.lat, it.lon, it.altitude, it.speed, it.hAcc) }
                val pending = s.count { it.status == SampleStatus.PENDING }
                withContext(Dispatchers.Default) {
                    Detail(
                        flight.eventName ?: personal, flight.startedAt, pts, replay(pts), s.count { it.lowQuality },
                        s.count { it.status == SampleStatus.SYNCED }, s.count { it.status == SampleStatus.REJECTED }, pending,
                        true, flight.isSimulated, rowSync(flight, pending), flight.lastError,
                    )
                }
            } else {
                val ps = g.api.flightPositions(id)
                val pts = ps.mapNotNull { p -> Iso.parse(p.t)?.let { TrackPoint(it, p.lat, p.lon, p.gpsAltM, p.speedMs, p.hAccM ?: 10.0) } }
                withContext(Dispatchers.Default) {
                    Detail(personal, pts.firstOrNull()?.t ?: 0L, pts, replay(pts), 0, pts.size, 0, 0, false, false, RowSync.REMOTE, null)
                }
            }
        } catch (e: ApiException) {
            loadError = true
        }
    }

    fun shareGpx(d: Detail) {
        scope.launch {
            val file = withContext(Dispatchers.IO) {
                File(ctx.cacheDir, "gpx").apply { mkdirs() }.let { dir -> File(dir, "retfast-${id.take(8)}.gpx").also { it.writeText(Gpx.build(d.title, d.points)) } }
            }
            val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", file)
            val send = Intent(Intent.ACTION_SEND).setType("application/gpx+xml").putExtra(Intent.EXTRA_STREAM, uri)
                .putExtra(Intent.EXTRA_SUBJECT, d.title).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            ctx.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    Column(Modifier.fillMaxSize().background(c.background).safeDrawingPadding()) {
        val d = detail
        TopBar(stringResource(R.string.fd_title), onBack) {
            if (d != null && d.points.isNotEmpty()) HeaderCircleButton(Lucide.Share, stringResource(R.string.share_gpx), { shareGpx(d) })
        }
        when {
            loadError -> Box(Modifier.padding(16.dp)) { WarningRow(stringResource(R.string.err_offline), Tone.Error, Lucide.CloudOff) }
            d == null -> LoadingBox(Modifier.fillMaxWidth().padding(top = 64.dp))
            else -> Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Header(d)
                if (d.points.size >= 2) {
                    RouteCard(id, d.points)
                    HeroMetrics(d, imperial)
                    Groups(d, imperial)
                    Text(stringResource(R.string.alt_footnote), Modifier.padding(horizontal = 4.dp), fontSize = 12.sp, color = c.textMuted, lineHeight = 16.sp)
                    Charts(d.points, imperial)
                } else {
                    AeroCard { EmptyState(Lucide.MapPinOff, stringResource(R.string.no_track_points)) }
                }
                if (d.local) DetailsCard(d)
                if (d.points.isNotEmpty()) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        SecondaryButton(stringResource(R.string.share_gpx), { shareGpx(d) }, Modifier.fillMaxWidth(), icon = Lucide.Share)
                        Text(stringResource(R.string.gpx_disclaimer), Modifier.padding(horizontal = 4.dp), fontSize = 12.sp, color = c.textMuted, lineHeight = 16.sp)
                    }
                }
                if (d.local) SecondaryButton(stringResource(R.string.delete_local), { confirmDelete = true }, Modifier.fillMaxWidth(), destructive = true, icon = Lucide.Trash2)
            }
        }
    }

    if (confirmDelete) {
        ConfirmDialog(
            title = stringResource(R.string.delete_local),
            message = stringResource(R.string.delete_local_confirm),
            confirm = stringResource(R.string.delete),
            onConfirm = {
                confirmDelete = false
                scope.launch { if (g.db.flights().deleteIfFullySynced(id) > 0) onBack() }
            },
            onDismiss = { confirmDelete = false },
            destructive = true,
        )
    }
}

@Composable
private fun Header(d: Detail) {
    val c = Aero.colors
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(d.title, Modifier.weight(1f, fill = false), fontSize = 26.sp, lineHeight = 30.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (d.simulated) SimBadge()
        }
        if (d.startedAt > 0) {
            Text(DateFormat.getDateTimeInstance(DateFormat.FULL, DateFormat.SHORT).format(Date(d.startedAt)), fontSize = 15.sp, color = c.textSecondary)
        }
        Box(Modifier.padding(top = 2.dp)) { SyncPill(d.sync, d.pending, d.lastError) }
    }
}

/** Route on the map with take-off / landing pins and a replay capsule that draws the track over time. */
@Composable
private fun RouteCard(id: String, points: List<TrackPoint>) {
    val c = Aero.colors
    val route = remember(points) { points.map { it.lat to it.lon }.thin(500) }
    val progress = remember { Animatable(1f) }
    val scope = rememberCoroutineScope()
    val playing = progress.isRunning
    val takeoff = stringResource(R.string.takeoff)
    val landing = stringResource(R.string.landing)
    val shown = if (progress.value >= 1f) route else route.take((route.size * progress.value).toInt().coerceIn(2, route.size))
    val head = shown.last()
    val content = MapContent(
        pins = buildList {
            add(MapPin("s", PinKind.MINE_START, route.first().first, route.first().second, takeoff))
            if (playing) add(MapPin("h", PinKind.ME, head.first, head.second))
            else add(MapPin("e", PinKind.PICKUP, route.last().first, route.last().second, landing))
        },
        lines = listOf(MapLine("route", shown, "route")),
        fit = route,
        fitKey = "detail-$id",
    )
    Box(Modifier.fillMaxWidth().height(280.dp).clip(RoundedCornerShape(AeroTokens.Radius.lg.dp)).background(c.surface)) {
        RetfastMap(content, Modifier.fillMaxSize())
        Row(
            Modifier.align(Alignment.BottomStart).padding(12.dp).clip(CircleShape).background(c.surface.copy(alpha = 0.94f))
                .clickable {
                    scope.launch {
                        if (playing) progress.snapTo(1f)
                        else { progress.snapTo(0f); progress.animateTo(1f, tween(10_000, easing = LinearEasing)) }
                    }
                }
                .padding(horizontal = 14.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(if (playing) Lucide.Square else Lucide.Play, null, Modifier.size(14.dp), tint = c.textPrimary)
            Text(stringResource(if (playing) R.string.stop else R.string.replay), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
        }
    }
}

@Composable
private fun HeroMetrics(d: Detail, imperial: Boolean) {
    val c = Aero.colors
    val dur = (d.points.last().t - d.points.first().t) / 1000
    val dist = Fmt.distance(d.values.distance, imperial).split(' ', limit = 2)
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(AeroTokens.Radius.lg.dp)).background(c.surface).padding(vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        HeroMetric(stringResource(R.string.duration), Fmt.duration(dur), null, Modifier.weight(1f))
        HeroDivider()
        HeroMetric(stringResource(R.string.distance), dist[0], dist.getOrNull(1), Modifier.weight(1f))
        HeroDivider()
        HeroMetric(stringResource(R.string.max_alt), Fmt.altitudeValue(d.values.maxAltitude, imperial), Fmt.altitudeUnit(imperial), Modifier.weight(1f))
    }
}

@Composable
private fun HeroDivider() = Box(Modifier.width(1.dp).height(40.dp).background(Aero.colors.border))

@Composable
private fun HeroMetric(label: String, value: String, unit: String?, modifier: Modifier) {
    val c = Aero.colors
    Column(modifier.padding(horizontal = 6.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            buildAnnotatedString {
                append(value)
                if (!unit.isNullOrEmpty() && value != "—") withStyle(SpanStyle(fontSize = 13.sp, fontWeight = FontWeight.Medium, color = c.textMuted)) { append(" $unit") }
            },
            fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary, maxLines = 1, style = TextStyle(fontFeatureSettings = "tnum"),
        )
        Text(label, fontSize = 12.sp, color = c.textMuted, maxLines = 1)
    }
}

private data class Stat(val key: String, val value: String, val unit: String?)

@Composable
private fun Groups(d: Detail, imperial: Boolean) {
    val v = d.values
    val altU = Fmt.altitudeUnit(imperial)
    val minAlt = d.points.mapNotNull { it.alt }.minOrNull()
    val (climb, sink) = remember(d.points) { varioExtremes(d.points) }
    val dist = Fmt.distance(v.distance, imperial).split(' ', limit = 2)
    val groups = listOf(
        stringResource(R.string.distance) to listOf(
            Stat(stringResource(R.string.total_distance), dist[0], dist.getOrNull(1)),
            Stat(stringResource(R.string.max_speed), Fmt.speedValue(v.maxGroundSpeed, imperial), Fmt.speedUnit(imperial)),
        ),
        stringResource(R.string.grp_altitude) to listOf(
            Stat(stringResource(R.string.max_alt), Fmt.altitudeValue(v.maxAltitude, imperial), altU),
            Stat(stringResource(R.string.min_alt), Fmt.altitudeValue(minAlt, imperial), altU),
            Stat(stringResource(R.string.ascent), Fmt.altitudeValue(v.totalAscent, imperial), altU),
            Stat(stringResource(R.string.descent), Fmt.altitudeValue(v.totalDescent, imperial), altU),
        ),
        stringResource(R.string.grp_climb) to listOfNotNull(
            climb?.let { Stat(stringResource(R.string.max_climb), Fmt.vario(it, imperial), Fmt.varioUnit(imperial)) },
            sink?.let { Stat(stringResource(R.string.max_sink), Fmt.vario(it, imperial), Fmt.varioUnit(imperial)) },
        ),
    ).filter { it.second.isNotEmpty() }
    val c = Aero.colors
    groups.forEach { (title, rows) ->
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, Modifier.padding(start = 4.dp), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.textSecondary)
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(AeroTokens.Radius.lg.dp)).background(c.surface)) {
                rows.forEachIndexed { i, r ->
                    if (i > 0) RowDivider(Modifier.padding(start = 16.dp))
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(r.key, Modifier.weight(1f), fontSize = 15.sp, color = c.textSecondary)
                        Text(
                            buildAnnotatedString {
                                append(r.value)
                                if (!r.unit.isNullOrEmpty() && r.value != "—") withStyle(SpanStyle(fontSize = 13.sp, fontWeight = FontWeight.Normal, color = c.textMuted)) { append(" ${r.unit}") }
                            },
                            fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary, style = TextStyle(fontFeatureSettings = "tnum"),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Charts(points: List<TrackPoint>, imperial: Boolean) {
    val c = Aero.colors
    val pts = remember(points) { points.thinPoints(400) }
    val t0 = pts.first().t
    val minutes = pts.map { (it.t - t0) / 60_000.0 }
    val altF = if (imperial) 3.28084 else 1.0
    val spdF = if (imperial) 2.23694 else 3.6
    val varF = if (imperial) 196.85 else 1.0
    val vario = remember(pts) { varioSeries(pts) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ChartCard(stringResource(R.string.grp_altitude), Fmt.altitudeUnit(imperial)) {
            AreaChart(minutes, pts.map { it.alt?.times(altF) }, AeroTokens.Brand.accent)
        }
        if (vario.count { it != null } >= 2) {
            ChartCard(stringResource(R.string.chart_vario), Fmt.varioUnit(imperial)) {
                BarChart(minutes, vario.map { it?.times(varF) }, c.success, c.error.copy(alpha = 0.7f))
            }
        }
        ChartCard(stringResource(R.string.chart_speed), Fmt.speedUnit(imperial)) {
            AreaChart(minutes, pts.map { it.speed?.times(spdF) }, c.secondary, fill = false)
        }
    }
}

@Composable
private fun ChartCard(title: String, unit: String, chart: @Composable () -> Unit) {
    val c = Aero.colors
    AeroCard {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(title, Modifier.weight(1f), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
            Text(stringResource(R.string.chart_minutes, unit), fontSize = 12.sp, color = c.textMuted)
        }
        chart()
    }
}

/** Line (optionally with a gradient area) over time in minutes; y-axis min/max labelled, gaps for missing values. */
@Composable
private fun AreaChart(xs: List<Double>, ys: List<Double?>, color: Color, fill: Boolean = true) {
    val c = Aero.colors
    val present = ys.filterNotNull()
    if (present.size < 2) { Text("—", color = c.textMuted, fontSize = 13.sp); return }
    val lo = present.min()
    val hi = present.max()
    val xMax = xs.last().takeIf { it > 0 } ?: 1.0
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Canvas(Modifier.weight(1f).height(140.dp)) {
            val span = (hi - lo).takeIf { it > 1e-6 } ?: 1.0
            fun x(i: Int) = (xs[i] / xMax * size.width).toFloat()
            fun y(v: Double) = (size.height - (v - lo) / span * size.height * 0.92).toFloat()
            gridLines(c.border)
            var line = Path()
            var area = Path()
            var startX = 0f
            var lastX = 0f
            var open = false
            fun flush() {
                if (!open) return
                if (fill) {
                    area.lineTo(lastX, size.height); area.lineTo(startX, size.height); area.close()
                    drawPath(area, Brush.verticalGradient(listOf(color.copy(alpha = 0.35f), color.copy(alpha = 0.02f))))
                }
                drawPath(line, color, style = Stroke(2.5.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
                line = Path(); area = Path(); open = false
            }
            ys.forEachIndexed { i, v ->
                if (v == null) { flush(); return@forEachIndexed }
                val px = x(i); val py = y(v)
                if (!open) { line.moveTo(px, py); area.moveTo(px, py); startX = px; open = true } else { line.lineTo(px, py); area.lineTo(px, py) }
                lastX = px
            }
            flush()
        }
        AxisLabels(hi, lo)
    }
}

/** Vario bars: climb above the zero line, sink below. */
@Composable
private fun BarChart(xs: List<Double>, ys: List<Double?>, up: Color, down: Color) {
    val c = Aero.colors
    val present = ys.filterNotNull()
    val hi = present.max().coerceAtLeast(0.1)
    val lo = present.min().coerceAtMost(-0.1)
    val xMax = xs.last().takeIf { it > 0 } ?: 1.0
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Canvas(Modifier.weight(1f).height(140.dp)) {
            val span = hi - lo
            val zero = (hi / span * size.height).toFloat()
            gridLines(c.border)
            drawLine(c.textMuted.copy(alpha = 0.5f), Offset(0f, zero), Offset(size.width, zero), 1.dp.toPx())
            val w = 2.dp.toPx()
            ys.forEachIndexed { i, v ->
                if (v == null) return@forEachIndexed
                val px = (xs[i] / xMax * size.width).toFloat()
                val h = (v / span * size.height).toFloat()
                if (v >= 0) drawRect(up, Offset(px - w / 2, zero - h), Size(w, h))
                else drawRect(down, Offset(px - w / 2, zero), Size(w, -h))
            }
        }
        AxisLabels(hi, lo)
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.gridLines(color: Color) {
    for (k in 0..2) {
        val y = size.height * k / 2f
        drawLine(color.copy(alpha = 0.6f), Offset(0f, y), Offset(size.width, y), 1f)
    }
}

@Composable
private fun AxisLabels(hi: Double, lo: Double) {
    val c = Aero.colors
    Column(Modifier.height(140.dp).widthIn(min = 28.dp), verticalArrangement = Arrangement.SpaceBetween, horizontalAlignment = Alignment.End) {
        Text(axis(hi), fontSize = 11.sp, color = c.textMuted, style = TextStyle(fontFeatureSettings = "tnum"))
        Text(axis(lo), fontSize = 11.sp, color = c.textMuted, style = TextStyle(fontFeatureSettings = "tnum"))
    }
}

private fun axis(v: Double) = if (kotlin.math.abs(v) < 10) String.format(java.util.Locale.US, "%.1f", v) else "${kotlin.math.round(v).toInt()}"

/** Collapsible GPS quality + sync counters; most pilots never need them (mirrors iOS). */
@Composable
private fun DetailsCard(d: Detail) {
    val c = Aero.colors
    var open by remember { mutableStateOf(false) }
    val rot by animateFloatAsState(if (open) 180f else 0f, label = "chev")
    val avg = d.points.takeIf { it.isNotEmpty() }?.map { it.hAcc }?.average()
    val gap = d.points.zipWithNext { a, b -> (b.t - a.t) / 1000 }.maxOrNull() ?: 0L
    val total = d.synced + d.pending + d.rejected
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(AeroTokens.Radius.lg.dp)).background(c.surface)) {
        Row(
            Modifier.fillMaxWidth().clickable { open = !open }.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(Modifier.size(34.dp).clip(CircleShape).background(c.surfaceElevated), contentAlignment = Alignment.Center) {
                Icon(Lucide.Info, null, Modifier.size(16.dp), tint = c.textSecondary)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(stringResource(R.string.rec_details), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
                Text(
                    stringResource(R.string.rec_details_sub, d.points.size, Fmt.accuracy(avg), d.synced, total),
                    fontSize = 13.sp, color = c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFeatureSettings = "tnum"),
                )
            }
            Icon(Lucide.ChevronDown, null, Modifier.size(16.dp).rotate(rot), tint = c.textMuted)
        }
        AnimatedVisibility(open, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
            Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                DetailCaption(stringResource(R.string.gps_quality))
                KeyValueRow(stringResource(R.string.avg_accuracy), Fmt.accuracy(avg))
                KeyValueRow(stringResource(R.string.low_quality_n), "${d.lowQuality}")
                KeyValueRow(stringResource(R.string.longest_gap), Fmt.duration(gap))
                d.points.firstOrNull()?.let { KeyValueRow(stringResource(R.string.start_point), "${Fmt.coord(it.lat)}, ${Fmt.coord(it.lon)}", mono = true) }
                d.points.lastOrNull()?.let { KeyValueRow(stringResource(R.string.end_point), "${Fmt.coord(it.lat)}, ${Fmt.coord(it.lon)}", mono = true) }
                Spacer(Modifier.height(8.dp))
                DetailCaption(stringResource(R.string.sync_section))
                KeyValueRow(stringResource(R.string.synced_n), "${d.synced}")
                KeyValueRow(stringResource(R.string.pending_n), "${d.pending}", valueColor = if (d.pending > 0) c.warning else c.textPrimary)
                KeyValueRow(stringResource(R.string.rejected_n), "${d.rejected}")
                if (d.pending > 0) Text(stringResource(R.string.pending_note), fontSize = 12.sp, color = c.textMuted, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
}

@Composable
private fun DetailCaption(text: String) = Text(text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Aero.colors.textMuted, modifier = Modifier.padding(bottom = 2.dp))

private fun replay(pts: List<TrackPoint>): FlightValues {
    val p = TelemetryProcessor()
    pts.forEach { p.process(RawFix(it.t, it.lat, it.lon, it.alt, it.hAcc, null, it.speed, null), TrackingProfile.ACTIVE_FLIGHT, it.t) }
    return p.values
}

/** GPS vario per point, averaged over a >= 5 s window so single-fix altitude noise doesn't dominate. */
private fun varioSeries(pts: List<TrackPoint>): List<Double?> {
    var j = 0
    return pts.mapIndexed { i, p ->
        while (j < i && p.t - pts[j].t > 5_000) j++
        val a = pts.getOrNull((j - 1).coerceAtLeast(0)) ?: return@mapIndexed null
        val dt = (p.t - a.t) / 1000.0
        if (dt < 3 || p.alt == null || a.alt == null) null else (p.alt - a.alt) / dt
    }
}

private fun varioExtremes(pts: List<TrackPoint>): Pair<Double?, Double?> {
    val v = varioSeries(pts).filterNotNull()
    return v.maxOrNull()?.takeIf { it > 0.1 } to v.minOrNull()?.takeIf { it < -0.1 }
}

private fun List<Pair<Double, Double>>.thin(max: Int): List<Pair<Double, Double>> {
    if (size <= max) return this
    val step = size.toDouble() / max
    return (0 until max).map { this[(it * step).toInt()] } + last()
}

private fun List<TrackPoint>.thinPoints(max: Int): List<TrackPoint> {
    if (size <= max) return this
    val step = size.toDouble() / max
    return (0 until max).map { this[(it * step).toInt()] } + last()
}
