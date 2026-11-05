package com.mizibu.retfast.tracking

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.mizibu.retfast.MainActivity
import com.mizibu.retfast.R
import com.mizibu.retfast.retrieval.SharingMode

object Notifications {
    const val CH_TRACKING = "tracking"
    const val CH_ALERTS = "alerts"
    const val ID_FOREGROUND = 1001
    const val ID_LANDING = 1002
    const val ID_RESUME = 1003

    fun ensureChannels(ctx: Context) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CH_TRACKING, ctx.getString(R.string.ch_tracking), NotificationManager.IMPORTANCE_LOW).apply {
                description = ctx.getString(R.string.ch_tracking_desc)
                setShowBadge(false)
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_ALERTS, ctx.getString(R.string.ch_alerts), NotificationManager.IMPORTANCE_HIGH).apply {
                description = ctx.getString(R.string.ch_alerts_desc)
            },
        )
    }

    private fun openApp(ctx: Context): PendingIntent = PendingIntent.getActivity(
        ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    /** The ongoing notification of the foreground service. */
    fun foreground(ctx: Context, st: TrackingStatus): Notification {
        val (title, text) = when {
            st.recording -> ctx.getString(R.string.notif_recording_title) to
                ctx.getString(R.string.notif_recording_text, st.storedSamples, st.eventName ?: ctx.getString(R.string.private_flight))
            st.sharing is SharingMode.PilotWaiting -> ctx.getString(R.string.notif_waiting_title) to ctx.getString(R.string.notif_waiting_text)
            st.sharing is SharingMode.Retriever -> ctx.getString(R.string.notif_duty_title) to ctx.getString(R.string.notif_duty_text)
            else -> ctx.getString(R.string.notif_recording_title) to ""
        }
        val stop = PendingIntent.getService(
            ctx, 1, Intent(ctx, TrackingService::class.java).setAction(TrackingService.ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(ctx, CH_TRACKING)
            .setSmallIcon(R.drawable.ic_stat_retfast)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(openApp(ctx))
            .addAction(0, ctx.getString(R.string.notif_stop), stop)
            .build()
    }

    private fun canNotify(ctx: Context) =
        android.os.Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun landingPrompt(ctx: Context) {
        if (!canNotify(ctx)) return
        val n = NotificationCompat.Builder(ctx, CH_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_retfast)
            .setContentTitle(ctx.getString(R.string.landing_title))
            .setContentText(ctx.getString(R.string.landing_notif_text))
            .setAutoCancel(true)
            .setContentIntent(openApp(ctx))
            .build()
        (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(ID_LANDING, n)
    }

    /** After a reboot / app update: Android may not let us start a location service from the background, so ask the user to open the app. */
    fun resumeRequest(ctx: Context) {
        if (!canNotify(ctx)) return
        ensureChannels(ctx)
        val n = NotificationCompat.Builder(ctx, CH_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_retfast)
            .setContentTitle(ctx.getString(R.string.resume_title))
            .setContentText(ctx.getString(R.string.resume_text))
            .setAutoCancel(true)
            .setContentIntent(openApp(ctx))
            .build()
        (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(ID_RESUME, n)
    }

    fun cancel(ctx: Context, id: Int) = (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(id)
}
