package com.mizibu.retfast.util

import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random

/** Time source; tests substitute a fake. */
interface Clock {
    fun now(): Long
    suspend fun sleep(seconds: Double)
}

object SystemClock : Clock {
    override fun now(): Long = System.currentTimeMillis()
    override suspend fun sleep(seconds: Double) = kotlinx.coroutines.delay((seconds * 1000).toLong().coerceAtLeast(0))
}

/** Exponential backoff with full jitter on the upper half: delay = min(cap, base*2^attempt) * (0.5..1.0). */
class Backoff(
    private val base: Double = 2.0,
    private val cap: Double = 120.0,
    private val jitter: () -> Double = { Random.nextDouble() },
) {
    /** [attempt] is 0 for the first retry. */
    fun delay(attempt: Int): Double {
        val exp = min(cap, base * 2.0.pow(attempt.coerceIn(0, 30)))
        return exp * (0.5 + 0.5 * jitter().coerceIn(0.0, 1.0))
    }
}

object Geo {
    /** Haversine distance in metres. */
    fun distance(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 6_371_000.0
        val p1 = Math.toRadians(lat1)
        val p2 = Math.toRadians(lat2)
        val dp = Math.toRadians(lat2 - lat1)
        val dl = Math.toRadians(lon2 - lon1)
        val a = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
        return 2 * r * atan2(sqrt(a), sqrt(1 - a))
    }
}

object Iso {
    private val fmt: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)
    fun format(ms: Long): String = fmt.format(Instant.ofEpochMilli(ms))
    fun parse(s: String?): Long? = s?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
}

fun newId(): String = java.util.UUID.randomUUID().toString().lowercase()
