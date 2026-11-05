package com.mizibu.retfast.tracking

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.mizibu.retfast.graph
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

/**
 * Foreground service (type `location`) that keeps the process alive while a flight records, a waiting
 * pilot shares their position, or a retriever is on duty. It owns no state: [TrackingEngine] does.
 *
 * START_STICKY: if Android kills the process, it restarts the service with a null intent and the engine
 * restores the session from SQLite. Whether Android allows that restart to use location depends on
 * the background-location permission (docs/architecture/android.md).
 */
class TrackingService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var watcher: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Notifications.ensureChannels(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val engine = graph.engine
        // Must call startForeground quickly after startForegroundService().
        val initial = engine.status.value
        val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
        try {
            ServiceCompat.startForeground(this, Notifications.ID_FOREGROUND, Notifications.foreground(this, initial), type)
        } catch (e: Exception) {
            // e.g. ForegroundServiceStartNotAllowedException / missing location permission: stop cleanly, surface in diagnostics.
            scope.launch { engine.stopFromNotification() }
            stopSelf()
            return START_NOT_STICKY
        }
        val stop = intent?.action == ACTION_STOP
        scope.launch {
            // Restore first: after a process restart the status is still empty and must not be mistaken for "nothing to do".
            if (stop) engine.stopFromNotification() else engine.restore()
            if (watcher == null) {
                watcher = launch {
                    engine.status
                        .distinctUntilChanged { x, y ->
                            x.needsService == y.needsService && x.recording == y.recording && x.sharing == y.sharing &&
                                x.eventName == y.eventName && x.storedSamples / 20 == y.storedSamples / 20
                        }
                        .collect { st ->
                            if (!st.needsService) {
                                stopForeground(STOP_FOREGROUND_REMOVE)
                                stopSelf()
                            } else {
                                val nm = getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
                                nm.notify(Notifications.ID_FOREGROUND, Notifications.foreground(this@TrackingService, st))
                            }
                        }
                }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        const val ACTION_STOP = "com.mizibu.retfast.STOP"

        /** Must be called while the app is visible (or from a user-initiated context) on Android 12+. */
        fun start(context: Context): Boolean = try {
            ContextCompat.startForegroundService(context, Intent(context, TrackingService::class.java))
            true
        } catch (e: Exception) {
            false
        }
    }
}
