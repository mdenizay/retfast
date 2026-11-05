package com.mizibu.retfast.ui.common

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver

data class PermState(
    val fine: Boolean = false,
    val coarseOnly: Boolean = false,
    val background: Boolean = false,
    val notifications: Boolean = false,
    val batteryExempt: Boolean = false,
    val gpsEnabled: Boolean = true,
    val powerSave: Boolean = false,
) {
    /** Minimum to start recording. */
    val canRecord: Boolean get() = fine
    /** Reliable background recording. */
    val ready: Boolean get() = fine && background && notifications
}

object Permissions {
    fun read(ctx: Context): PermState {
        fun granted(p: String) = ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED
        val fine = granted(Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = granted(Manifest.permission.ACCESS_COARSE_LOCATION)
        val bg = Build.VERSION.SDK_INT < 29 || granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        val notif = if (Build.VERSION.SDK_INT >= 33) granted(Manifest.permission.POST_NOTIFICATIONS)
        else (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).areNotificationsEnabled()
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        return PermState(
            fine = fine, coarseOnly = coarse && !fine, background = fine && bg, notifications = notif,
            batteryExempt = pm.isIgnoringBatteryOptimizations(ctx.packageName),
            gpsEnabled = runCatching { androidx.core.location.LocationManagerCompat.isLocationEnabled(lm) }.getOrDefault(true),
            powerSave = pm.isPowerSaveMode,
        )
    }

    fun openAppSettings(ctx: Context) {
        ctx.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    fun openLocationSettings(ctx: Context) {
        ctx.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** Asks for the battery-optimisation exemption (a system dialog). Falls back to the list in settings. */
    fun requestBatteryExemption(ctx: Context) {
        val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { ctx.startActivity(direct) } catch (e: Exception) {
            runCatching { ctx.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }
    }
}

/** Re-read on every ON_RESUME so returning from system settings updates the screen. */
@Composable
fun rememberPermState(): State<PermState> {
    val ctx = LocalContext.current
    val state = remember { mutableStateOf(Permissions.read(ctx)) }
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) state.value = Permissions.read(ctx) }
        owner.lifecycle.addObserver(obs)
        onDispose { owner.lifecycle.removeObserver(obs) }
    }
    return state
}
