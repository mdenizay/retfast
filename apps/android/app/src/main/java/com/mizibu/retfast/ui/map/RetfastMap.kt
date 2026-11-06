package com.mizibu.retfast.ui.map

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.mizibu.retfast.R
import com.mizibu.retfast.graph
import com.mizibu.retfast.ui.common.MapCircleButton
import com.mizibu.retfast.ui.theme.Aero
import com.mizibu.retfast.ui.theme.AeroColors
import com.mizibu.retfast.ui.theme.AeroTokens
import com.mizibu.retfast.ui.theme.Lucide
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.layers.RasterLayer
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.android.style.sources.RasterSource
import org.maplibre.android.style.sources.TileSet
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point
import kotlin.math.cos

const val STYLE_LIGHT = "https://tiles.openfreemap.org/styles/liberty"
const val STYLE_DARK = "https://tiles.openfreemap.org/styles/dark"

/** Base map choice, same set as web and iOS. Remembered in prefs. */
enum class Basemap(val key: String) { STANDARD("standard"), TOPO("topo"), SATELLITE("satellite");
    companion object { fun of(k: String) = entries.firstOrNull { it.key == k } ?: STANDARD }
}

/** Kinds of map markers (colour and label come from these). */
enum class PinKind { CENTER, SITE, SITE_UNVERIFIED, PILOT_LIVE, PILOT_STALE, PILOT_LOST, PICKUP, PICKUP_ACTIVE, RETRIEVER, ME, MINE_START }

/**
 * A marker. With [heading] set, pilots / retrievers / me are drawn as a rotated chevron (pilot:
 * primary, retriever: violet) instead of a dot. [accuracyM] draws a translucent accuracy disc.
 */
data class MapPin(val id: String, val kind: PinKind, val lat: Double, val lon: Double, val label: String = "", val heading: Double? = null, val accuracyM: Double? = null)

data class MapLine(val id: String, val points: List<Pair<Double, Double>>, val kind: String = "trail") // (lat, lon); kinds: trail, mine, route, retrieval (dashed)

data class MapContent(
    val pins: List<MapPin> = emptyList(),
    val lines: List<MapLine> = emptyList(),
    /** Camera target when the content changes the first time; null = keep. */
    val focus: Pair<Double, Double>? = null,
    val focusZoom: Double = 12.0,
    /** If set, fit the camera to these (lat, lon) points once per key change. */
    val fit: List<Pair<Double, Double>> = emptyList(),
    val fitKey: String = "",
)

/** Imperative camera moves from screen code (locate me, fit everything). */
class MapCamera {
    internal sealed interface Cmd
    internal data class To(val lat: Double, val lon: Double, val zoom: Double?) : Cmd
    internal data class Fit(val pts: List<Pair<Double, Double>>) : Cmd
    internal val cmds = MutableSharedFlow<Cmd>(extraBufferCapacity = 4, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    fun moveTo(lat: Double, lon: Double, zoom: Double? = null) { cmds.tryEmit(To(lat, lon, zoom)) }
    fun fit(points: List<Pair<Double, Double>>) { if (points.isNotEmpty()) cmds.tryEmit(Fit(points)) }
}

@Composable
fun rememberMapCamera() = remember { MapCamera() }

/**
 * MapLibre Native map. Content is pushed into two GeoJSON sources (pins, lines) so updating long
 * trails stays cheap. [bottomPadding] keeps camera targets clear of a bottom sheet.
 */
@Composable
fun RetfastMap(
    content: MapContent,
    modifier: Modifier = Modifier,
    onPinTap: (MapPin) -> Unit = {},
    recenterKey: Int = 0,
    camera: MapCamera? = null,
    bottomPadding: Dp = 0.dp,
    topPadding: Dp = 0.dp,
    interactive: Boolean = true,
) {
    val context = LocalContext.current
    val dark = Aero.dark
    val basemap by context.graph.prefs.basemap.collectAsState()
    val mapView = remember { MapLibre.getInstance(context.applicationContext); MapView(context) }
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    var styleReady by remember { mutableStateOf(false) }
    val latest = rememberUpdatedState(content)
    val tap = rememberUpdatedState(onPinTap)
    var fittedKey by remember { mutableStateOf<String?>(null) }
    val density = LocalDensity.current
    val padBottomPx = with(density) { bottomPadding.toPx() }.toDouble()
    val padTopPx = with(density) { topPadding.toPx() }.toDouble()
    val palette = if (dark) AeroTokens.dark else AeroTokens.light

    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, mapView) {
        val obs = LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_START -> mapView.onStart()
                Lifecycle.Event.ON_STOP -> mapView.onStop()
                else -> {}
            }
        }
        lifecycle.addObserver(obs)
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) mapView.onStart()
        onDispose {
            lifecycle.removeObserver(obs)
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) mapView.onStop()
            mapView.onDestroy()
        }
    }

    LaunchedEffect(mapView) {
        mapView.getMapAsync { m ->
            map = m
            m.uiSettings.isRotateGesturesEnabled = false
            m.uiSettings.isTiltGesturesEnabled = false
            m.uiSettings.isLogoEnabled = false
            m.uiSettings.isAttributionEnabled = true
            m.uiSettings.isCompassEnabled = false
            m.addOnMapClickListener { point ->
                val screen = m.projection.toScreenLocation(point)
                val feats = m.queryRenderedFeatures(screen, *PIN_LAYERS)
                val id = feats.firstOrNull()?.getStringProperty("pid")
                val pin = latest.value.pins.firstOrNull { it.id == id }
                if (pin != null) { tap.value(pin); true } else false
            }
        }
    }

    LaunchedEffect(map, interactive) {
        val m = map ?: return@LaunchedEffect
        m.uiSettings.setAllGesturesEnabled(interactive)
        if (interactive) { m.uiSettings.isRotateGesturesEnabled = false; m.uiSettings.isTiltGesturesEnabled = false }
    }

    LaunchedEffect(map, padBottomPx, padTopPx) {
        map?.moveCamera(CameraUpdateFactory.paddingTo(0.0, padTopPx, 0.0, padBottomPx))
    }

    LaunchedEffect(map, dark, basemap) {
        val m = map ?: return@LaunchedEffect
        styleReady = false
        val builder = when (Basemap.of(basemap)) {
            Basemap.STANDARD -> Style.Builder().fromUri(if (dark) STYLE_DARK else STYLE_LIGHT)
            Basemap.TOPO -> rasterStyle("rf-topo", listOf("a", "b", "c").map { "https://$it.tile.opentopomap.org/{z}/{x}/{y}.png" }, 17,
                "Map data © OpenStreetMap contributors, SRTM · Style © OpenTopoMap (CC-BY-SA)")
            Basemap.SATELLITE -> rasterStyle("rf-satellite", listOf("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"), 19,
                "Imagery © Esri, Maxar, Earthstar Geographics")
        }
        m.setStyle(builder) { style ->
            installLayers(style, palette, dark || Basemap.of(basemap) == Basemap.SATELLITE)
            styleReady = true
        }
    }

    LaunchedEffect(map, styleReady, content) {
        val m = map ?: return@LaunchedEffect
        if (!styleReady) return@LaunchedEffect
        m.getStyle { style ->
            style.getSourceAs<GeoJsonSource>("pins")?.setGeoJson(FeatureCollection.fromFeatures(content.pins.map { it.toFeature() }))
            style.getSourceAs<GeoJsonSource>("lines")?.setGeoJson(
                FeatureCollection.fromFeatures(content.lines.filter { it.points.size >= 2 }.map { l ->
                    Feature.fromGeometry(LineString.fromLngLats(l.points.map { Point.fromLngLat(it.second, it.first) })).also { it.addStringProperty("kind", l.kind) }
                }),
            )
        }
        val key = content.fitKey
        if (content.fit.size >= 2 && fittedKey != key) {
            fittedKey = key
            fitTo(m, content.fit, animate = false)
        } else if (content.focus != null && fittedKey != "focus:${content.focus}") {
            fittedKey = "focus:${content.focus}"
            m.moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder().target(LatLng(content.focus.first, content.focus.second)).zoom(content.focusZoom).build()))
        }
    }

    LaunchedEffect(map, camera) {
        val m = map ?: return@LaunchedEffect
        camera?.cmds?.collect { c ->
            when (c) {
                is MapCamera.To -> m.animateCamera(
                    if (c.zoom != null) CameraUpdateFactory.newLatLngZoom(LatLng(c.lat, c.lon), c.zoom) else CameraUpdateFactory.newLatLng(LatLng(c.lat, c.lon)), 450,
                )
                is MapCamera.Fit -> fitTo(m, c.pts, animate = true)
            }
        }
    }

    LaunchedEffect(recenterKey) {
        if (recenterKey == 0) return@LaunchedEffect
        val m = map ?: return@LaunchedEffect
        val target = latest.value.pins.firstOrNull { it.kind == PinKind.ME }?.let { it.lat to it.lon } ?: latest.value.focus ?: return@LaunchedEffect
        m.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(target.first, target.second), 13.0), 450)
    }

    AndroidView(factory = { mapView }, modifier = modifier.fillMaxSize())
}

private fun fitTo(m: MapLibreMap, pts: List<Pair<Double, Double>>, animate: Boolean) {
    if (pts.size == 1) {
        val p = pts[0]
        val u = CameraUpdateFactory.newLatLngZoom(LatLng(p.first, p.second), 14.0)
        if (animate) m.animateCamera(u, 450) else m.moveCamera(u)
        return
    }
    val b = LatLngBounds.Builder()
    pts.forEach { b.include(LatLng(it.first, it.second)) }
    runCatching {
        val bounds = b.build()
        // Degenerate bounds (all points equal) would zoom to max; treat as a single point.
        if (bounds.latitudeSpan < 1e-6 && bounds.longitudeSpan < 1e-6) return fitTo(m, pts.take(1), animate)
        val u = CameraUpdateFactory.newLatLngBounds(bounds, 110)
        if (animate) m.animateCamera(u, 450) else m.moveCamera(u)
    }
}

private fun MapPin.toFeature(): Feature = Feature.fromGeometry(Point.fromLngLat(lon, lat)).also {
    it.addStringProperty("pid", id)
    it.addStringProperty("kind", kind.name)
    it.addStringProperty("label", label)
    if (heading != null && kind in ARROW_KINDS) {
        it.addNumberProperty("heading", heading)
        it.addStringProperty("arrow", if (kind == PinKind.RETRIEVER) "arrow-retriever" else if (kind == PinKind.PILOT_LIVE || kind == PinKind.ME) "arrow-pilot" else "arrow-stale")
    }
    if (accuracyM != null && accuracyM > 0) {
        // Pixel radius at zoom 0 for 512 px tiles; the layer scales it by 2^zoom.
        it.addNumberProperty("acc0", accuracyM / (78271.517 * cos(Math.toRadians(lat))))
    }
}

private val ARROW_KINDS = setOf(PinKind.PILOT_LIVE, PinKind.PILOT_STALE, PinKind.PILOT_LOST, PinKind.RETRIEVER, PinKind.ME)
private val PIN_LAYERS = arrayOf("pins-circle", "pins-arrow")

private fun rasterStyle(id: String, tiles: List<String>, maxZ: Int, attr: String): Style.Builder {
    val ts = TileSet("2.2.0", *tiles.toTypedArray()).apply { this.maxZoom = maxZ.toFloat(); this.attribution = attr }
    return Style.Builder()
        .withSource(RasterSource(id, ts, 256))
        .withLayer(RasterLayer(id, id))
}

private fun hex(c: Color) = String.format("#%06X", c.toArgb() and 0xFFFFFF)
private fun col(c: Color) = Expression.color(c.toArgb())

/** Navigation chevron with a white rim, pointing up (north); MapLibre rotates it by heading. */
private fun arrowBitmap(fill: Color, rim: Int, px: Int): Bitmap {
    val bmp = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888)
    val cv = Canvas(bmp)
    val s = px.toFloat()
    val path = Path().apply {
        moveTo(s * 0.5f, s * 0.08f)
        lineTo(s * 0.86f, s * 0.88f)
        lineTo(s * 0.5f, s * 0.68f)
        lineTo(s * 0.14f, s * 0.88f)
        close()
    }
    cv.drawPath(path, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = rim; style = Paint.Style.STROKE; strokeWidth = s * 0.12f; strokeJoin = Paint.Join.ROUND })
    cv.drawPath(path, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = fill.toArgb(); style = Paint.Style.FILL })
    return bmp
}

private fun installLayers(style: Style, c: AeroColors, darkBase: Boolean) {
    val rim = if (darkBase) 0xFF101923.toInt() else 0xFFFFFFFF.toInt()
    style.addImage("arrow-pilot", arrowBitmap(c.primary, android.graphics.Color.WHITE, 72))
    style.addImage("arrow-retriever", arrowBitmap(c.retrieval, android.graphics.Color.WHITE, 72))
    style.addImage("arrow-stale", arrowBitmap(c.trackingStale, android.graphics.Color.WHITE, 72))

    style.addSource(GeoJsonSource("lines", FeatureCollection.fromFeatures(emptyList<Feature>())))
    style.addSource(GeoJsonSource("pins", FeatureCollection.fromFeatures(emptyList<Feature>())))

    val isRetrieval = Expression.eq(Expression.get("kind"), Expression.literal("retrieval"))
    style.addLayer(
        LineLayer("lines-layer", "lines").withProperties(
            PropertyFactory.lineColor(
                Expression.match(
                    Expression.get("kind"), col(c.secondary),
                    Expression.stop("mine", col(c.primary)),
                    Expression.stop("route", col(c.primary)),
                ),
            ),
            PropertyFactory.lineWidth(3.5f),
            PropertyFactory.lineOpacity(0.92f),
            PropertyFactory.lineCap("round"),
            PropertyFactory.lineJoin("round"),
        ).withFilter(Expression.not(isRetrieval)),
    )
    style.addLayer(
        LineLayer("lines-retrieval", "lines").withProperties(
            PropertyFactory.lineColor(col(c.retrieval)),
            PropertyFactory.lineWidth(3f),
            PropertyFactory.lineDasharray(arrayOf(1.5f, 1.5f)),
            PropertyFactory.lineJoin("round"),
        ).withFilter(isRetrieval),
    )

    // Accuracy disc (metres → pixels, exponential in zoom).
    style.addLayer(
        CircleLayer("pins-accuracy", "pins").withProperties(
            PropertyFactory.circleRadius(
                Expression.interpolate(
                    Expression.exponential(2f), Expression.zoom(),
                    Expression.stop(0, Expression.get("acc0")),
                    Expression.stop(22, Expression.product(Expression.get("acc0"), Expression.literal(4194304.0))),
                ),
            ),
            PropertyFactory.circleColor(col(c.primary)),
            PropertyFactory.circleOpacity(0.14f),
            PropertyFactory.circleStrokeColor(col(c.primary)),
            PropertyFactory.circleStrokeOpacity(0.35f),
            PropertyFactory.circleStrokeWidth(1f),
        ).withFilter(Expression.has("acc0")),
    )
    // Halo under "me".
    style.addLayer(
        CircleLayer("pins-halo", "pins").withProperties(
            PropertyFactory.circleRadius(17f),
            PropertyFactory.circleColor(col(c.primary)),
            PropertyFactory.circleOpacity(0.18f),
        ).withFilter(Expression.eq(Expression.get("kind"), Expression.literal("ME"))),
    )
    style.addLayer(
        CircleLayer("pins-circle", "pins").withProperties(
            PropertyFactory.circleRadius(
                Expression.match(
                    Expression.get("kind"), Expression.literal(8f),
                    Expression.stop("ME", Expression.literal(7.5f)),
                    Expression.stop("CENTER", Expression.literal(6f)),
                    Expression.stop("SITE", Expression.literal(6f)),
                    Expression.stop("SITE_UNVERIFIED", Expression.literal(6f)),
                    Expression.stop("PICKUP_ACTIVE", Expression.literal(10f)),
                ),
            ),
            PropertyFactory.circleColor(
                Expression.match(
                    Expression.get("kind"), col(c.secondary),
                    Expression.stop("PILOT_LIVE", col(c.primary)),
                    Expression.stop("PILOT_STALE", col(c.trackingStale)),
                    Expression.stop("PILOT_LOST", col(c.offline)),
                    Expression.stop("PICKUP", col(c.warning)),
                    Expression.stop("PICKUP_ACTIVE", col(c.warning)),
                    Expression.stop("RETRIEVER", col(c.retrieval)),
                    Expression.stop("ME", col(c.primary)),
                    Expression.stop("MINE_START", col(c.success)),
                    Expression.stop("CENTER", col(c.textPrimary)),
                    Expression.stop("SITE", col(c.success)),
                    Expression.stop("SITE_UNVERIFIED", col(c.warning)),
                ),
            ),
            PropertyFactory.circleStrokeColor(hex(Color(rim))),
            PropertyFactory.circleStrokeWidth(2.5f),
        ).withFilter(Expression.not(Expression.has("arrow"))),
    )
    style.addLayer(
        SymbolLayer("pins-arrow", "pins").withProperties(
            PropertyFactory.iconImage(Expression.get("arrow")),
            PropertyFactory.iconRotate(Expression.get("heading")),
            PropertyFactory.iconRotationAlignment("map"),
            PropertyFactory.iconSize(0.42f),
            PropertyFactory.iconAllowOverlap(true),
            PropertyFactory.iconIgnorePlacement(true),
        ).withFilter(Expression.has("arrow")),
    )
    style.addLayer(
        SymbolLayer("pins-label", "pins").withProperties(
            PropertyFactory.textField(Expression.get("label")),
            PropertyFactory.textFont(arrayOf("Noto Sans Regular")),
            PropertyFactory.textSize(12f),
            PropertyFactory.textOffset(arrayOf(0f, 1.5f)),
            PropertyFactory.textAnchor("top"),
            PropertyFactory.textColor(if (darkBase) "#F3F7F8" else "#101923"),
            PropertyFactory.textHaloColor(if (darkBase) "#101923" else "#FFFFFF"),
            PropertyFactory.textHaloWidth(1.5f),
            PropertyFactory.textOptional(true),
        ),
    )
}

/** Floating layers button + menu that switches the basemap (persisted). */
@Composable
fun BasemapButton(modifier: Modifier = Modifier) {
    val g = LocalContext.current.graph
    val current by g.prefs.basemap.collectAsState()
    var open by remember { mutableStateOf(false) }
    val c = Aero.colors
    androidx.compose.foundation.layout.Box(modifier) {
        MapCircleButton(Lucide.Layers, stringResource(R.string.map_layers), { open = true })
        DropdownMenu(open, { open = false }, shape = RoundedCornerShape(20.dp), containerColor = c.surface) {
            Column(Modifier.padding(horizontal = 8.dp).width(200.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                listOf(
                    Triple(Basemap.STANDARD, R.string.map_standard, Lucide.Map),
                    Triple(Basemap.TOPO, R.string.map_topo, Lucide.Mountain),
                    Triple(Basemap.SATELLITE, R.string.map_satellite, Lucide.Satellite),
                ).forEach { (b, label, icon) ->
                    val on = Basemap.of(current) == b
                    Row(
                        Modifier.clip(RoundedCornerShape(14.dp)).background(if (on) c.primary.copy(alpha = 0.14f) else Color.Transparent)
                            .clickable { g.prefs.setBasemap(b.key); open = false }.padding(horizontal = 12.dp, vertical = 11.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Icon(icon, null, tint = if (on) c.primary else c.textSecondary, modifier = Modifier.size(18.dp))
                        Text(stringResource(label), Modifier.weight(1f), color = c.textPrimary, fontSize = 15.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal)
                        if (on) Icon(Lucide.Check, null, tint = c.primary, modifier = Modifier.size(16.dp))
                    }
                }
            }
        }
    }
}
