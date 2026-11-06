package com.mizibu.retfast.ui.profile

import android.content.Intent
import android.os.Build
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mizibu.retfast.BuildConfig
import com.mizibu.retfast.R
import com.mizibu.retfast.graph
import com.mizibu.retfast.retrieval.stage
import com.mizibu.retfast.ui.common.RowDivider
import com.mizibu.retfast.ui.theme.Aero
import com.mizibu.retfast.ui.theme.Lucide
import com.mizibu.retfast.ui.theme.Mono
import com.mizibu.retfast.ui.common.Fmt
import com.mizibu.retfast.ui.common.PrimaryButton
import com.mizibu.retfast.ui.common.rememberPermState
import kotlinx.coroutines.delay
import java.text.DateFormat
import java.util.Date

/** Everything needed to understand "why did tracking stop" on a real device. The shareable report contains no coordinates. */
@Composable
fun DiagnosticsScreen() {
    val ctx = LocalContext.current
    val g = ctx.graph
    val perm by rememberPermState()
    val st by g.engine.status.collectAsStateWithLifecycle()
    val sync by g.sync.snapshot.collectAsStateWithLifecycle()
    val online by g.online.collectAsStateWithLifecycle()
    val rtConnected by g.realtime.connected.collectAsStateWithLifecycle()
    val retrievals by g.db.retrievals().observeRecent().collectAsStateWithLifecycle(emptyList())
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var dbSize by remember { mutableLongStateOf(0L) }
    LaunchedEffect(Unit) {
        g.engine.refreshBattery()
        g.sync.refreshCounters()
        dbSize = ctx.getDatabasePath("retfast.db").length()
        while (true) { delay(1000); now = System.currentTimeMillis() }
    }
    fun ago(t: Long?) = t?.let { "${((now - it) / 1000).coerceAtLeast(0)} s" } ?: "—"
    fun time(t: Long?) = t?.let { DateFormat.getTimeInstance().format(Date(it)) } ?: "—"

    val rows = buildList<Pair<String, List<Pair<String, String>>>> {
        add(stringResource(R.string.diag_permissions) to listOf(
            "ACCESS_FINE_LOCATION" to perm.fine.toString(),
            "approximate only" to perm.coarseOnly.toString(),
            "ACCESS_BACKGROUND_LOCATION" to perm.background.toString(),
            "POST_NOTIFICATIONS" to perm.notifications.toString(),
            "battery optimisation exempt" to perm.batteryExempt.toString(),
            "location services on" to perm.gpsEnabled.toString(),
            "battery saver on" to perm.powerSave.toString(),
        ))
        add(stringResource(R.string.diag_tracking) to listOf(
            "phase" to st.phase.name,
            "profile" to (st.profile?.wire ?: "—"),
            "location source" to st.source,
            "location updates on" to st.locationOn.toString(),
            "provider available" to st.locationAvailable.toString(),
            "last fix" to ago(st.lastFixAt),
            "stored samples (session)" to st.storedSamples.toString(),
            "rejected fixes" to st.values.rejectedFixes.toString(),
            "service needed" to st.needsService.toString(),
            "error" to (st.error ?: "—"),
            "battery" to (st.battery?.let { "${(it * 100).toInt()}%" } ?: "—"),
        ))
        add(stringResource(R.string.diag_sync) to listOf(
            "status" to sync.status.name,
            "pending samples" to sync.pendingCount.toString(),
            "last server ack" to (sync.lastServerAckAt?.let { "${time(it)} (${ago(it)})" } ?: "—"),
            "last attempt" to ago(sync.lastAttemptAt),
            "next retry in" to (sync.nextRetryAt?.let { "${((it - now) / 1000).coerceAtLeast(0)} s" } ?: "—"),
            "consecutive failures" to sync.consecutiveFailures.toString(),
            "last error" to (sync.lastError ?: "—"),
            "network" to online.toString(),
            "realtime socket" to rtConnected.toString(),
        ))
        add(stringResource(R.string.diag_sharing) to listOf(
            "mode" to st.sharing::class.simpleName.orEmpty(),
            "retriever duty" to (st.duty?.let { "on=${it.onDuty} pickups=${it.activePickups}" } ?: "—"),
            "last send" to ago(st.lastShareAt),
            "sent / failed" to "${st.sharesSent} / ${st.shareFailures}",
            "last error" to (st.lastShareError ?: "—"),
        ))
        add(stringResource(R.string.diag_outbox) to retrievals.take(5).map { r ->
            "${r.id.take(8)} ${r.eventName.orEmpty().take(14)}" to "${r.stage.name} outbox=${r.outbox} attempts=${r.attemptCount} err=${r.lastError ?: "—"}"
        }.ifEmpty { listOf("—" to "—") })
        add(stringResource(R.string.diag_app) to listOf(
            "version" to "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
            "api" to BuildConfig.API_BASE_URL,
            "device" to "${Build.MANUFACTURER} ${Build.MODEL}",
            "android" to "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
            "db size" to "${dbSize / 1024} KB",
        ))
    }

    val c = Aero.colors
    Column(
        Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(top = 4.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(stringResource(R.string.diag_sub), fontSize = 14.sp, lineHeight = 20.sp, color = c.textSecondary)
        rows.forEach { (title, items) ->
            GroupHeader(title)
            ListGroup {
                items.forEachIndexed { i, (k, v) ->
                    if (i > 0) RowDivider(Modifier.padding(start = 16.dp))
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 11.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(k, fontSize = 14.sp, color = c.textSecondary, modifier = Modifier.weight(1f))
                        Text(v, fontSize = 13.sp, fontFamily = Mono, color = valueColor(v), modifier = Modifier.weight(1.2f), textAlign = TextAlign.End)
                    }
                }
            }
        }
        PrimaryButton(stringResource(R.string.share_report), {
            val text = rows.joinToString("\n\n") { (t, items) -> "## $t\n" + items.joinToString("\n") { "${it.first}: ${it.second}" } }
            ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }, Modifier.padding(top = 8.dp), icon = Lucide.Share)
    }
}

@Composable
private fun valueColor(v: String) = when (v) {
    "true" -> Aero.colors.success
    "false" -> Aero.colors.warning
    else -> Aero.colors.textPrimary
}
