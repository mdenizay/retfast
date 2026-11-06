package com.mizibu.retfast.ui.flights

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.mizibu.retfast.R
import com.mizibu.retfast.graph
import com.mizibu.retfast.net.ApiException
import com.mizibu.retfast.net.Flight
import com.mizibu.retfast.net.flights
import com.mizibu.retfast.ui.common.ActivityHeatmap
import com.mizibu.retfast.ui.common.AeroCard
import com.mizibu.retfast.ui.common.EmptyState
import com.mizibu.retfast.ui.common.Fmt
import com.mizibu.retfast.ui.common.SectionTitle
import com.mizibu.retfast.ui.common.SimBadge
import com.mizibu.retfast.ui.common.StatTile
import com.mizibu.retfast.ui.common.StatusPill
import com.mizibu.retfast.ui.common.Tone
import com.mizibu.retfast.ui.common.WarningRow
import com.mizibu.retfast.ui.theme.Aero
import com.mizibu.retfast.ui.theme.Lucide
import com.mizibu.retfast.util.Iso
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle as JTextStyle
import java.time.temporal.ChronoUnit

/** Sync state of a row, mirrors iOS FlightSyncPill. */
enum class RowSync { RECORDING, REFUSED, PENDING_POINTS, NOT_CREATED, CLOSING, SYNCED, REMOTE }

data class FlightRow(
    val id: String,
    val title: String,
    val startedAt: Long,
    val durationS: Long,
    val distanceM: Double?,
    val pending: Int,
    val sync: RowSync,
    val simulated: Boolean,
    val lastError: String?,
)

class FlightsViewModel(app: Application) : AndroidViewModel(app) {
    private val g = app.graph
    private val _server = MutableStateFlow<List<Flight>>(emptyList())
    val server: StateFlow<List<Flight>> = _server
    val refreshing = MutableStateFlow(false)
    val error = MutableStateFlow<String?>(null)
    val loaded = MutableStateFlow(false)

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            refreshing.value = true
            try { _server.value = g.api.flights(); error.value = null } catch (e: ApiException) { error.value = "offline" }
            refreshing.value = false
            loaded.value = true
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FlightsScreen(onOpen: (String) -> Unit) {
    val g = LocalContext.current.graph
    val vm: FlightsViewModel = viewModel()
    val local by g.db.flights().observeAll().collectAsStateWithLifecycle(emptyList())
    val pending by g.db.samples().observePendingByFlight().collectAsStateWithLifecycle(emptyList())
    val server by vm.server.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    val loaded by vm.loaded.collectAsStateWithLifecycle()
    val err by vm.error.collectAsStateWithLifecycle()
    val units by g.prefs.units.collectAsStateWithLifecycle()
    val imperial = units == "imperial"
    val personal = stringResource(R.string.personal_flight)
    val eventFlight = stringResource(R.string.event_flight)
    val c = Aero.colors

    val rows = remember(local, pending, server) {
        val pendingMap = pending.associate { it.flightId to it.n }
        val l = local.map {
            val n = pendingMap[it.id] ?: 0
            val sync = rowSync(it, n)
            FlightRow(it.id, it.eventName ?: personal, it.startedAt, (((it.endedAt ?: System.currentTimeMillis()) - it.startedAt) / 1000),
                it.distanceM.takeIf { d -> d > 0 }, n, sync, it.isSimulated, it.lastError)
        }
        val localIds = local.map { it.id.lowercase() }.toSet()
        val s = server.filter { it.id.lowercase() !in localIds }.map {
            FlightRow(it.id, if (it.eventId == null) personal else eventFlight, Iso.parse(it.startedAt) ?: 0L, it.stats.durationS.toLong(),
                it.stats.distanceM.takeIf { d -> d > 0 }, 0, RowSync.REMOTE, it.isSimulated, null)
        }
        (l + s).sortedByDescending { it.startedAt }
    }
    val zone = ZoneId.systemDefault()
    val months = remember(rows) { rows.groupBy { Instant.ofEpochMilli(it.startedAt).atZone(zone).toLocalDate().withDayOfMonth(1) }.toList().sortedByDescending { it.first } }

    PullToRefreshBox(isRefreshing = refreshing && loaded, onRefresh = { vm.refresh() }, modifier = Modifier.fillMaxSize().background(c.background)) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { Text(stringResource(R.string.tab_flights), fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary, modifier = Modifier.padding(horizontal = 4.dp, vertical = 4.dp)) }
            if (rows.isEmpty()) {
                if (loaded) item { EmptyState(Lucide.Route, stringResource(R.string.no_flights_title), stringResource(R.string.no_flights_body), Modifier.padding(top = 64.dp)) }
            } else item { Summary(rows) }
            if (err != null) item { WarningRow(stringResource(R.string.flights_offline_note), Tone.Warning, Lucide.CloudOff) }
            months.forEach { (month, items) ->
                item(key = "m-$month") {
                    val label = month.month.getDisplayName(JTextStyle.FULL_STANDALONE, LocalConfiguration.current.locales[0]).replaceFirstChar { it.titlecase(LocalConfiguration.current.locales[0]) } + " " + month.year
                    SectionTitle(label, Modifier.padding(top = 12.dp, start = 4.dp, end = 4.dp), count = items.size)
                }
                items(items, key = { it.id }) { r -> FlightCard(r, imperial) { onOpen(r.id) } }
            }
        }
    }
}

@Composable
private fun Summary(rows: List<FlightRow>) {
    val c = Aero.colors
    val airtime = rows.sumOf { it.durationS }
    val year = LocalDate.now().year
    val zone = ZoneId.systemDefault()
    val thisYear = rows.count { Instant.ofEpochMilli(it.startedAt).atZone(zone).year == year }
    val longest = rows.maxOfOrNull { it.durationS } ?: 0
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        AeroCard {
            Text(stringResource(R.string.summary), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StatTile(hours(airtime), stringResource(R.string.total_air), Modifier.weight(1f), Lucide.Timer)
                StatTile("${rows.size}", stringResource(R.string.total_flights), Modifier.weight(1f), Lucide.Send)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StatTile("$thisYear", stringResource(R.string.this_year), Modifier.weight(1f), Lucide.Calendar)
                StatTile(hours(longest), stringResource(R.string.longest), Modifier.weight(1f), Lucide.Trophy)
            }
        }
        AeroCard {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(stringResource(R.string.flight_activity), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
                Text(stringResource(R.string.last_16_weeks), fontSize = 13.sp, color = c.textSecondary)
            }
            ActivityHeatmap(heatLevels(rows), columns = 16, spacing = 4.dp)
        }
    }
}

/** 112 days, oldest first; level from airtime that day. */
private fun heatLevels(rows: List<FlightRow>): List<Int> {
    val zone = ZoneId.systemDefault()
    val today = LocalDate.now()
    val perDay = LongArray(112)
    rows.forEach {
        val d = ChronoUnit.DAYS.between(Instant.ofEpochMilli(it.startedAt).atZone(zone).toLocalDate(), today)
        if (d in 0..111) perDay[(111 - d).toInt()] += it.durationS
    }
    return perDay.map { s -> when { s <= 0 -> 0; s < 1800 -> 1; s < 3600 -> 2; s < 7200 -> 3; else -> 4 } }
}

@Composable
private fun hours(s: Long): String {
    val m = (s / 60).toInt()
    return if (m < 60) stringResource(R.string.dur_min, m) else stringResource(R.string.dur_hm, m / 60, m % 60)
}

@Composable
private fun FlightCard(r: FlightRow, imperial: Boolean, onClick: () -> Unit) {
    val c = Aero.colors
    val start = Instant.ofEpochMilli(r.startedAt).atZone(ZoneId.systemDefault())
    val live = r.sync == RowSync.RECORDING
    AeroCard(padding = 16.dp, onClick = onClick) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(
                Modifier.size(52.dp).clip(RoundedCornerShape(18.dp)).background(if (live) c.primary else c.surfaceElevated),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
            ) {
                Text("${start.dayOfMonth}", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = if (live) c.onPrimary else c.textPrimary, style = TextStyle(fontFeatureSettings = "tnum"))
                Text(start.dayOfWeek.getDisplayName(JTextStyle.SHORT, LocalConfiguration.current.locales[0]).uppercase(LocalConfiguration.current.locales[0]), fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = if (live) c.onPrimary else c.textMuted)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(r.title, Modifier.weight(1f, fill = false), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (r.simulated) SimBadge()
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Meta(Lucide.Clock, start.format(DateTimeFormatter.ofPattern("HH:mm")))
                    Meta(Lucide.Timer, Fmt.duration(r.durationS))
                    r.distanceM?.let { Meta(Lucide.Route, Fmt.distance(it, imperial)) }
                }
                SyncPill(r)
            }
            Box(Modifier.size(30.dp).clip(CircleShape).background(c.surfaceElevated), contentAlignment = Alignment.Center) {
                Icon(Lucide.ChevronRight, null, tint = c.textMuted, modifier = Modifier.size(15.dp))
            }
        }
    }
}

@Composable
private fun Meta(icon: ImageVector, text: String) {
    val c = Aero.colors
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = c.textSecondary, modifier = Modifier.size(12.dp))
        Text(text, fontSize = 13.sp, color = c.textSecondary, maxLines = 1, style = TextStyle(fontFeatureSettings = "tnum"))
    }
}

@Composable
internal fun SyncPill(r: FlightRow) = SyncPill(r.sync, r.pending, r.lastError)

@Composable
internal fun SyncPill(sync: RowSync, pending: Int, lastError: String?) {
    when (sync) {
        RowSync.RECORDING -> StatusPill(stringResource(R.string.rec_running), Tone.Active, Lucide.CircleDot)
        RowSync.REFUSED -> StatusPill(stringResource(R.string.server_refused) + (lastError?.let { " ($it)" } ?: ""), Tone.Error, Lucide.CloudAlert)
        RowSync.PENDING_POINTS -> StatusPill(stringResource(R.string.points_to_send, pending), Tone.Warning, Lucide.CloudUpload)
        RowSync.NOT_CREATED -> StatusPill(stringResource(R.string.to_send), Tone.Warning, Lucide.CloudUpload)
        RowSync.CLOSING -> StatusPill(stringResource(R.string.closing_on_server), Tone.Warning, Lucide.CloudUpload)
        RowSync.SYNCED -> StatusPill(stringResource(R.string.sync_synced), Tone.Success, Lucide.Cloud)
        RowSync.REMOTE -> StatusPill(stringResource(R.string.on_server), Tone.Info, Lucide.Cloud)
    }
}

internal fun rowSync(f: com.mizibu.retfast.data.FlightEntity, pending: Int): RowSync = when {
    f.state == "recording" -> RowSync.RECORDING
    f.lastError != null && (!f.serverCreated || f.serverEnded) -> RowSync.REFUSED
    pending > 0 -> RowSync.PENDING_POINTS
    !f.serverCreated -> RowSync.NOT_CREATED
    !f.serverEnded -> RowSync.CLOSING
    else -> RowSync.SYNCED
}
