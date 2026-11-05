package com.mizibu.retfast.ui.map

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.mizibu.retfast.ui.theme.Aero
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
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point

const val STYLE_LIGHT = "https://tiles.openfreemap.org/styles/liberty"
const val STYLE_DARK = "https://tiles.openfreemap.org/styles/dark"

/** Kinds of map markers (colour and label come from these). */
enum class PinKind { CENTER, SITE, SITE_UNVERIFIED, PILOT_LIVE, PILOT_STALE, PILOT_LOST, PICKUP, PICKUP_ACTIVE, RETRIEVER, ME, MINE_START }

data class MapPin(val id: String, val kind: PinKind, val lat: Double, val lon: Double, val label: String = "")

data class MapLine(val id: String, val points: List<Pair<Double, Double>>, val kind: String = "trail") // (lat, lon)

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

/**
 * MapLibre Native map with the OpenFreeMap style. Content is pushed into a few GeoJSON sources
 * (pins by kind, lines), so updating thousands of trail points is cheap.
 */
@Composable
fun RetfastMap(
    content: MapContent,
    modifier: Modifier = Modifier,
    onPinTap: (MapPin) -> Unit = {},
    recenterKey: Int = 0,
) {
    val context = LocalContext.current
    val dark = Aero.dark
    val mapView = remember { MapLibre.getInstance(context.applicationContext); MapView(context) }
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    var styleReady by remember { mutableStateOf(false) }
    val latest = rememberUpdatedState(content)
    val tap = rememberUpdatedState(onPinTap)
    var fittedKey by remember { mutableStateOf<String?>(null) }

    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, mapView) {
        val obs = LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_START -> mapView.onStart()
                Lifecycle.Event.ON_RESUME -> {}
                Lifecycle.Event.ON_PAUSE -> {}
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
            m.uiSettings.isLogoEnabled = false
            m.uiSettings.isAttributionEnabled = true
            m.addOnMapClickListener { point ->
                val screen = m.projection.toScreenLocation(point)
                val feats = m.queryRenderedFeatures(screen, *PIN_LAYERS)
                val id = feats.firstOrNull()?.getStringProperty("pid")
                val pin = latest.value.pins.firstOrNull { it.id == id }
                if (pin != null) { tap.value(pin); true } else false
            }
        }
    }

    LaunchedEffect(map, dark) {
        val m = map ?: return@LaunchedEffect
        styleReady = false
        val colors = Palette(dark)
        m.setStyle(Style.Builder().fromUri(if (dark) STYLE_DARK else STYLE_LIGHT)) { style ->
            installLayers(style, colors, dark)
            styleReady = true
        }
    }

    LaunchedEffect(map, styleReady, content) {
        val m = map ?: return@LaunchedEffect
        if (!styleReady) return@LaunchedEffect
        m.getStyle { style ->
            (style.getSourceAs<GeoJsonSource>("pins"))?.setGeoJson(
                FeatureCollection.fromFeatures(content.pins.map { p ->
                    Feature.fromGeometry(Point.fromLngLat(p.lon, p.lat)).also {
                        it.addStringProperty("pid", p.id); it.addStringProperty("kind", p.kind.name); it.addStringProperty("label", p.label)
                    }
                }),
            )
            (style.getSourceAs<GeoJsonSource>("lines"))?.setGeoJson(
                FeatureCollection.fromFeatures(content.lines.filter { it.points.size >= 2 }.map { l ->
                    Feature.fromGeometry(LineString.fromLngLats(l.points.map { Point.fromLngLat(it.second, it.first) })).also {
                        it.addStringProperty("kind", l.kind)
                    }
                }),
            )
        }
        val key = content.fitKey
        if (content.fit.size >= 2 && fittedKey != key) {
            fittedKey = key
            val b = LatLngBounds.Builder()
            content.fit.forEach { b.include(LatLng(it.first, it.second)) }
            runCatching { m.moveCamera(CameraUpdateFactory.newLatLngBounds(b.build(), 120)) }
        } else if (content.focus != null && fittedKey != "focus:${content.focus}") {
            fittedKey = "focus:${content.focus}"
            m.moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder().target(LatLng(content.focus.first, content.focus.second)).zoom(content.focusZoom).build()))
        }
    }

    LaunchedEffect(recenterKey) {
        if (recenterKey == 0) return@LaunchedEffect
        val m = map ?: return@LaunchedEffect
        val target = latest.value.focus ?: latest.value.pins.firstOrNull { it.kind == PinKind.ME }?.let { it.lat to it.lon } ?: return@LaunchedEffect
        m.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(target.first, target.second), 13.0))
    }

    AndroidView(factory = { mapView }, modifier = modifier.fillMaxSize())
}

private val PIN_LAYERS = arrayOf("pins-circle")

private class Palette(dark: Boolean) {
    val c = if (dark) com.mizibu.retfast.ui.theme.AeroTokens.dark else com.mizibu.retfast.ui.theme.AeroTokens.light
    fun hex(color: androidx.compose.ui.graphics.Color): String {
        val a = color.toArgb()
        return String.format("#%06X", a and 0xFFFFFF)
    }
}

private fun installLayers(style: Style, p: Palette, dark: Boolean) {
    style.addSource(GeoJsonSource("lines", FeatureCollection.fromFeatures(emptyList<Feature>())))
    style.addSource(GeoJsonSource("pins", FeatureCollection.fromFeatures(emptyList<Feature>())))
    style.addLayer(
        LineLayer("lines-layer", "lines").withProperties(
            PropertyFactory.lineColor(
                Expression.match(
                    Expression.get("kind"),
                    Expression.color(android.graphics.Color.parseColor(p.hex(p.c.secondary))),
                    Expression.stop("mine", Expression.color(android.graphics.Color.parseColor(p.hex(p.c.primary)))),
                    Expression.stop("route", Expression.color(android.graphics.Color.parseColor(p.hex(p.c.primary)))),
                    Expression.stop("retrieval", Expression.color(android.graphics.Color.parseColor(p.hex(p.c.retrieval)))),
                ),
            ),
            PropertyFactory.lineWidth(3f),
            PropertyFactory.lineOpacity(0.9f),
            PropertyFactory.lineCap("round"),
            PropertyFactory.lineJoin("round"),
        ),
    )
    fun col(c: androidx.compose.ui.graphics.Color) = Expression.color(android.graphics.Color.parseColor(p.hex(c)))
    style.addLayer(
        CircleLayer("pins-circle", "pins").withProperties(
            PropertyFactory.circleRadius(
                Expression.match(
                    Expression.get("kind"), Expression.literal(8f),
                    Expression.stop("ME", Expression.literal(7f)),
                    Expression.stop("CENTER", Expression.literal(6f)),
                    Expression.stop("SITE", Expression.literal(6f)),
                    Expression.stop("SITE_UNVERIFIED", Expression.literal(6f)),
                    Expression.stop("PICKUP_ACTIVE", Expression.literal(10f)),
                ),
            ),
            PropertyFactory.circleColor(
                Expression.match(
                    Expression.get("kind"), col(p.c.secondary),
                    Expression.stop("PILOT_LIVE", col(p.c.trackingActive)),
                    Expression.stop("PILOT_STALE", col(p.c.trackingStale)),
                    Expression.stop("PILOT_LOST", col(p.c.offline)),
                    Expression.stop("PICKUP", col(p.c.retrieval)),
                    Expression.stop("PICKUP_ACTIVE", col(p.c.retrieval)),
                    Expression.stop("RETRIEVER", col(p.c.secondary)),
                    Expression.stop("ME", col(p.c.primary)),
                    Expression.stop("MINE_START", col(p.c.success)),
                    Expression.stop("CENTER", col(p.c.textPrimary)),
                    Expression.stop("SITE", col(p.c.success)),
                    Expression.stop("SITE_UNVERIFIED", col(p.c.warning)),
                ),
            ),
            PropertyFactory.circleStrokeColor(if (dark) "#101923" else "#FFFFFF"),
            PropertyFactory.circleStrokeWidth(2.5f),
        ),
    )
    style.addLayer(
        SymbolLayer("pins-label", "pins").withProperties(
            PropertyFactory.textField(Expression.get("label")),
            PropertyFactory.textFont(arrayOf("Noto Sans Regular")),
            PropertyFactory.textSize(12f),
            PropertyFactory.textOffset(arrayOf(0f, 1.4f)),
            PropertyFactory.textAnchor("top"),
            PropertyFactory.textColor(if (dark) "#F3F7F8" else "#101923"),
            PropertyFactory.textHaloColor(if (dark) "#101923" else "#FFFFFF"),
            PropertyFactory.textHaloWidth(1.5f),
            PropertyFactory.textOptional(true),
        ),
    )
}

