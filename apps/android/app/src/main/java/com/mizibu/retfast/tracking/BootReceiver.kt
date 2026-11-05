package com.mizibu.retfast.tracking

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.mizibu.retfast.graph
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * After a reboot (or app update) only re-shows a notification asking the user to resume: Android 12+ does not
 * allow starting a location foreground service from a BOOT_COMPLETED broadcast, and tracking silently would
 * be both disallowed and surprising. Tapping the notification opens the app, which resumes the session.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val pending = goAsync()
        CoroutineScope(Dispatchers.Default).launch {
            try {
                val g = context.graph
                val flight = g.db.flights().active()
                val retrieval = g.retrievals.active()
                val duty = g.db.kv().get(TrackingEngine.KEY_DUTY)
                val dutyOn = duty?.contains("\"onDuty\":true") == true
                if (flight != null || retrieval != null || dutyOn) Notifications.resumeRequest(context)
                // Unsent data may still be waiting: schedule the constrained retry worker (allowed from a receiver).
                g.scheduleSync()
            } finally {
                pending.finish()
            }
        }
    }
}
