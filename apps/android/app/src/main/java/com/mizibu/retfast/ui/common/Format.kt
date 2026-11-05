package com.mizibu.retfast.ui.common

import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/** Presentation helpers. [imperial] switches ft / mph / ft·min⁻¹; stored data always stays metric. */
object Fmt {
    fun altitude(m: Double?, imperial: Boolean): String =
        if (m == null) "—" else if (imperial) "${(m * 3.28084).roundToInt()} ft" else "${m.roundToInt()} m"

    fun altitudeValue(m: Double?, imperial: Boolean): String =
        if (m == null) "—" else if (imperial) "${(m * 3.28084).roundToInt()}" else "${m.roundToInt()}"

    fun altitudeUnit(imperial: Boolean) = if (imperial) "ft" else "m"

    fun speedValue(ms: Double?, imperial: Boolean): String =
        if (ms == null) "—" else if (imperial) String.format(Locale.US, "%.0f", ms * 2.23694) else String.format(Locale.US, "%.0f", ms * 3.6)

    fun speedUnit(imperial: Boolean) = if (imperial) "mph" else "km/h"

    fun vario(ms: Double?, imperial: Boolean): String = when {
        ms == null -> "—"
        imperial -> String.format(Locale.US, "%+.0f", ms * 196.85)
        else -> String.format(Locale.US, "%+.1f", ms)
    }

    fun varioUnit(imperial: Boolean) = if (imperial) "ft/min" else "m/s"

    fun distance(m: Double?, imperial: Boolean): String = when {
        m == null -> "—"
        imperial -> if (m < 1609) "${(m * 3.28084).roundToInt()} ft" else String.format(Locale.US, "%.1f mi", m / 1609.344)
        m < 1000 -> "${m.roundToInt()} m"
        else -> String.format(Locale.US, "%.1f km", m / 1000)
    }

    fun duration(seconds: Long): String {
        val s = seconds.coerceAtLeast(0)
        return String.format(Locale.US, "%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60)
    }

    fun accuracy(m: Double?): String = if (m == null) "—" else "±${m.roundToInt()} m"

    fun ageSeconds(nowMs: Long, thenMs: Long?): Long? = thenMs?.let { ((nowMs - it) / 1000).coerceAtLeast(0) }

    fun coord(v: Double) = String.format(Locale.US, "%.5f", v)

    fun degrees(v: Double?) = if (v == null) "—" else "${v.roundToInt()}°"

    fun sign(v: Double) = if (abs(v) < 0.05) "0" else if (v > 0) "+" else "−"
}
