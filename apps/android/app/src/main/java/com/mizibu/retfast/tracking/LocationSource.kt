package com.mizibu.retfast.tracking

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.LocationAvailability
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

/** A provider of GPS fixes. Callbacks arrive on the main looper. */
interface LocationSource {
    val name: String
    /** (Re)configures and starts updates; calling it again just changes the request. */
    fun start(settings: ProfileSettings, onFix: (RawFix) -> Unit, onAvailability: (Boolean) -> Unit, onError: (String) -> Unit)
    fun stop()
}

fun hasFineLocation(context: Context) =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

fun hasBackgroundLocation(context: Context) =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED

/**
 * Chosen engine: FusedLocationProviderClient (Play Services) with GPS_PROVIDER fallback.
 * Fused gives better first-fix time, indoor/outdoor handover and duty-cycles GPS for the
 * long-interval profiles; devices without Play Services (or with it unavailable) fall back to LocationManager.
 */
fun createLocationSource(context: Context): LocationSource {
    val ok = runCatching {
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
    }.getOrDefault(false)
    return if (ok) FusedSource(context.applicationContext) else PlatformSource(context.applicationContext)
}

internal fun Location.toRawFix(): RawFix {
    val mock = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) isMock else @Suppress("DEPRECATION") isFromMockProvider
    return RawFix(
        timeMs = time,
        lat = latitude,
        lon = longitude,
        altitude = if (hasAltitude()) altitude else null,
        hAcc = if (hasAccuracy()) accuracy.toDouble() else -1.0,
        vAcc = if (hasVerticalAccuracy()) verticalAccuracyMeters.toDouble() else null,
        speed = if (hasSpeed()) speed.toDouble() else null,
        course = if (hasBearing()) bearing.toDouble() else null,
        isMock = mock,
    )
}

private class FusedSource(private val context: Context) : LocationSource {
    override val name = "fused"
    private val client = LocationServices.getFusedLocationProviderClient(context)
    private var callback: LocationCallback? = null

    @SuppressLint("MissingPermission")
    override fun start(settings: ProfileSettings, onFix: (RawFix) -> Unit, onAvailability: (Boolean) -> Unit, onError: (String) -> Unit) {
        if (!hasFineLocation(context)) { onError("permission_missing"); return }
        stop()
        val request = LocationRequest.Builder(
            if (settings.highAccuracy) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY,
            settings.intervalMs,
        ).setMinUpdateIntervalMillis(settings.fastestIntervalMs)
            .setMinUpdateDistanceMeters(settings.minDistanceM)
            .setWaitForAccurateLocation(false)
            .build()
        val cb = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) { result.locations.forEach { onFix(it.toRawFix()) } }
            override fun onLocationAvailability(a: LocationAvailability) { onAvailability(a.isLocationAvailable) }
        }
        callback = cb
        try {
            client.requestLocationUpdates(request, cb, Looper.getMainLooper())
                .addOnFailureListener { onError(it.javaClass.simpleName) }
        } catch (e: SecurityException) {
            onError("permission_revoked")
        }
    }

    override fun stop() {
        callback?.let { client.removeLocationUpdates(it) }
        callback = null
    }
}

private class PlatformSource(private val context: Context) : LocationSource {
    override val name = "gps_provider"
    private val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private var listener: LocationListener? = null

    @SuppressLint("MissingPermission")
    override fun start(settings: ProfileSettings, onFix: (RawFix) -> Unit, onAvailability: (Boolean) -> Unit, onError: (String) -> Unit) {
        if (!hasFineLocation(context)) { onError("permission_missing"); return }
        stop()
        val l = object : LocationListener {
            override fun onLocationChanged(location: Location) { onFix(location.toRawFix()) }
            override fun onProviderEnabled(provider: String) { onAvailability(true) }
            override fun onProviderDisabled(provider: String) { onAvailability(false) }
            @Deprecated("Deprecated in Java") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        }
        listener = l
        try {
            if (!lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) onAvailability(false)
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, settings.intervalMs, settings.minDistanceM, l, Looper.getMainLooper())
        } catch (e: SecurityException) {
            onError("permission_revoked")
        } catch (e: IllegalArgumentException) {
            onError("no_gps_provider")
        }
    }

    override fun stop() {
        listener?.let { lm.removeUpdates(it) }
        listener = null
    }
}
