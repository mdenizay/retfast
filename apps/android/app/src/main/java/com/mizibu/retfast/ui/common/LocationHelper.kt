package com.mizibu.retfast.ui.common

import android.annotation.SuppressLint
import android.content.Context
import android.location.LocationManager
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.mizibu.retfast.tracking.RawFix
import com.mizibu.retfast.tracking.hasFineLocation
import com.mizibu.retfast.tracking.toRawFix
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/** One-shot position helpers for map "my location" and the pickup point of a retrieve request. */
object LocationHelper {
    @SuppressLint("MissingPermission")
    suspend fun current(context: Context, timeoutMs: Long = 12_000): RawFix? {
        if (!hasFineLocation(context)) return null
        val fused = runCatching {
            withTimeoutOrNull(timeoutMs) {
                suspendCancellableCoroutine<RawFix?> { cont ->
                    val req = CurrentLocationRequest.Builder().setPriority(Priority.PRIORITY_HIGH_ACCURACY).setDurationMillis(timeoutMs).setMaxUpdateAgeMillis(10_000).build()
                    LocationServices.getFusedLocationProviderClient(context).getCurrentLocation(req, null)
                        .addOnSuccessListener { l -> if (cont.isActive) cont.resume(l?.toRawFix()) }
                        .addOnFailureListener { if (cont.isActive) cont.resume(null) }
                }
            }
        }.getOrNull()
        return fused ?: lastKnown(context)
    }

    @SuppressLint("MissingPermission")
    fun lastKnown(context: Context): RawFix? {
        if (!hasFineLocation(context)) return null
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        return runCatching {
            listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER)
                .mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
                .maxByOrNull { it.time }?.toRawFix()
        }.getOrNull()
    }
}
