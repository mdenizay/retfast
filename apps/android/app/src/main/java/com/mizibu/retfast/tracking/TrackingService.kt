package com.mizibu.retfast.tracking

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.mizibu.retfast.MainActivity
import com.mizibu.retfast.R
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * Foreground service that owns location tracking.
 *
 * Android's equivalent of iOS's `UIBackgroundModes: location`: a
 * `foregroundServiceType="location"` service is the only way to keep receiving
 * fixes once the screen locks, and the persistent notification is what stops
 * the system reclaiming the process mid-flight.
 */
class TrackingService : Service() {

    enum class Mode { TASK, RETRIEVER }

    companion object {
        const val ACTION_START = "com.mizibu.retfast.START"
        const val ACTION_STOP = "com.mizibu.retfast.STOP"
        const val EXTRA_MODE = "mode"
        const val EXTRA_ID = "id"

        private const val CHANNEL_ID = "retfast.tracking"
        /** How long fused location may stay silent before the fallback kicks in. */
        private const val FUSED_GRACE_MS = 20_000L
        private const val NOTIFICATION_ID = 4201

        private val _state = MutableStateFlow(TrackingState())
        val state: StateFlow<TrackingState> = _state

        fun start(context: Context, mode: Mode, id: String) {
            val i = Intent(context, TrackingService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_MODE, mode.name)
                putExtra(EXTRA_ID, id)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(i)
            } else {
                context.startService(i)
            }
        }

        fun stop(context: Context) {
            context.startService(
                Intent(context, TrackingService::class.java).apply { action = ACTION_STOP },
            )
        }
    }

    /** What the HUD renders. */
    data class TrackingState(
        val tracking: Boolean = false,
        val lastLocation: Location? = null,
        val batteryPercent: Int = -1,
        val lastFixAtMs: Long = 0,
    )

    private lateinit var client: com.google.android.gms.location.FusedLocationProviderClient
    private var locationManager: LocationManager? = null
    private var mode: Mode? = null
    private var targetId: String? = null
    private var lastFixAtMs = 0L
    private val watchdog = android.os.Handler(android.os.Looper.getMainLooper())

    private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            ingest(result.locations)
        }
    }

    /**
     * Backstop source. Fused location needs Google Play services, which plenty
     * of Android devices ship without — for a safety app that must not mean
     * "no tracking at all", so we fall back to the platform provider.
     */
    private val rawListener = LocationListener { loc -> ingest(listOf(loc)) }

    private fun ingest(locations: List<Location>) {
        run {
            val id = targetId ?: return
            val battery = batteryPercent()
            for (loc in locations) {
                if (loc.accuracy < 0) continue
                val pointId = UUID.randomUUID().toString()
                val payload = JSONObject().apply {
                    put("id", pointId)
                    put("recorded_at", iso.format(Date(loc.time)))
                    put("lat", loc.latitude)
                    put("lng", loc.longitude)
                    put("altitude_m", loc.altitude)
                    put("h_accuracy_m", loc.accuracy.toDouble())
                    put("tracking_state", "background")
                    if (loc.hasSpeed()) put("speed_mps", loc.speed.toDouble())
                    if (loc.hasBearing()) put("heading_deg", loc.bearing.toDouble())
                    if (battery >= 0) put("battery_pct", battery)
                    when (mode) {
                        Mode.TASK -> put("task_id", id)
                        Mode.RETRIEVER -> put("retriever_session_id", id)
                        null -> return
                    }
                }
                PointBuffer.get(this@TrackingService).enqueue(pointId, payload)
                lastFixAtMs = System.currentTimeMillis()
                _state.value = _state.value.copy(
                    lastLocation = loc,
                    batteryPercent = battery,
                    lastFixAtMs = lastFixAtMs,
                )
            }
            // The location callback is the reliable trigger while backgrounded.
            SyncEngine.flushIfDue(this@TrackingService)
        }
    }

    override fun onCreate() {
        super.onCreate()
        client = LocationServices.getFusedLocationProviderClient(this)
        locationManager = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopTracking()
                return START_NOT_STICKY
            }
            ACTION_START -> {
                mode = intent.getStringExtra(EXTRA_MODE)?.let { Mode.valueOf(it) }
                targetId = intent.getStringExtra(EXTRA_ID)
                startForeground(NOTIFICATION_ID, buildNotification())
                requestUpdates()
                _state.value = _state.value.copy(tracking = true)
            }
        }
        // START_STICKY: if Android reclaims the process, restart the service so
        // a pilot mid-flight comes back automatically.
        return START_STICKY
    }

    private fun requestUpdates() {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val interval = if (mode == Mode.RETRIEVER) 10_000L else 5_000L
        val distance = if (mode == Mode.RETRIEVER) 50f else 10f
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, interval)
            .setMinUpdateDistanceMeters(distance)
            .setWaitForAccurateLocation(false)
            .build()
        client.requestLocationUpdates(request, callback, mainLooper)

        // If fused produces nothing (no/limited Play services), fall back to
        // the platform provider rather than tracking silently failing.
        lastFixAtMs = 0
        watchdog.postDelayed({ startRawUpdatesIfStarved(interval, distance) }, FUSED_GRACE_MS)
    }

    private var rawActive = false

    private fun startRawUpdatesIfStarved(interval: Long, distance: Float) {
        if (targetId == null || rawActive) return
        if (lastFixAtMs != 0L && System.currentTimeMillis() - lastFixAtMs < FUSED_GRACE_MS) return
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val lm = locationManager ?: return
        for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
            if (lm.isProviderEnabled(provider)) {
                runCatching {
                    lm.requestLocationUpdates(provider, interval, distance, rawListener, mainLooper)
                    rawActive = true
                }
            }
        }
    }

    private fun stopTracking() {
        watchdog.removeCallbacksAndMessages(null)
        client.removeLocationUpdates(callback)
        if (rawActive) {
            runCatching { locationManager?.removeUpdates(rawListener) }
            rawActive = false
        }
        SyncEngine.flushNow(this)
        _state.value = TrackingState()
        mode = null
        targetId = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        watchdog.removeCallbacksAndMessages(null)
        client.removeLocationUpdates(callback)
        if (rawActive) {
            runCatching { locationManager?.removeUpdates(rawListener) }
            rawActive = false
        }
        super.onDestroy()
    }

    private fun batteryPercent(): Int {
        val bm = getSystemService(Context.BATTERY_SERVICE) as? BatteryManager ?: return -1
        return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.tracking_channel),
            NotificationManager.IMPORTANCE_LOW,
        )
        (getSystemService(NotificationManager::class.java)).createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val pi = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.tracking_notification_title))
            .setContentText(getString(R.string.tracking_notification_body))
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
