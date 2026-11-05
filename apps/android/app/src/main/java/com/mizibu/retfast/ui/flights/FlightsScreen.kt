package com.mizibu.retfast.ui.flights

import android.app.Application
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.mizibu.retfast.R
import com.mizibu.retfast.graph
import com.mizibu.retfast.net.ApiException
import com.mizibu.retfast.net.Flight
import com.mizibu.retfast.net.flights
import com.mizibu.retfast.ui.common.AeroCard
import com.mizibu.retfast.ui.common.Banner
import com.mizibu.retfast.ui.common.BannerKind
import com.mizibu.retfast.ui.common.Fmt
import com.mizibu.retfast.ui.common.StatusPill
import com.mizibu.retfast.ui.theme.Aero
import com.mizibu.retfast.util.Iso
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

data class FlightRow(
    val id: String,
    val title: String,
    val startedAt: Long,
    val durationS: Long,
    val distanceM: Double?,
    val maxAltM: Double?,
    val pending: Int,
    val local: Boolean,
    val recording: Boolean,
    val simulated: Boolean,
    val lastError: String?,
)

class FlightsViewModel(app: Application) : AndroidViewModel(app) {
    private val g = app.graph
    private val _server = MutableStateFlow<List<Flight>>(emptyList())
    val server: StateFlow<List<Flight>> = _server
    val refreshing = MutableStateFlow(false)
    val error = MutableStateFlow<String?>(null)

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            refreshing.value = true
            try { _server.value = g.api.flights(); error.value = null } catch (e: ApiException) { error.value = "offline" }
            refreshing.value = false
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
    val err by vm.error.collectAsStateWithLifecycle()
    val units by g.prefs.units.collectAsStateWithLifecycle()
    val imperial = units == "imperial"
    val privateName = stringResource(R.string.private_flight)

    val rows = remember(local, pending, server) {
        val pendingMap = pending.associate { it.flightId to it.n }
        val l = local.map {
            FlightRow(
                it.id, it.eventName ?: privateName, it.startedAt, (((it.endedAt ?: System.currentTimeMillis()) - it.startedAt) / 1000),
                it.distanceM.takeIf { d -> d > 0 }, it.maxAltM, pendingMap[it.id] ?: 0, true, it.state == "recording", it.isSimulated, it.lastError,
            )
        }
        val localIds = local.map { it.id }.toSet()
        val s = server.filter { it.id !in localIds }.map {
            FlightRow(
                it.id, privateName, Iso.parse(it.startedAt) ?: 0L, it.stats.durationS.toLong(), it.stats.distanceM.takeIf { d -> d > 0 }, it.stats.maxGpsAltM,
                0, false, it.status == "recording", it.isSimulated, null,
            )
        }
        (l + s).sortedByDescending { it.startedAt }
    }

    PullToRefreshBox(isRefreshing = refreshing, onRefresh = { vm.refresh() }, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item { Text(stringResource(R.string.tab_flights), style = MaterialTheme.typography.headlineMedium) }
            if (err != null) item { Banner(stringResource(R.string.flights_offline_note), BannerKind.Info) }
            if (rows.isEmpty()) item { Text(stringResource(R.string.no_flights), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(rows, key = { it.id }) { r ->
                AeroCard(Modifier.clickable { onOpen(r.id) }) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(r.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                        val c = Aero.colors
                        when {
                            r.recording -> StatusPill(stringResource(R.string.recording), c.trackingActive)
                            r.pending > 0 -> StatusPill(stringResource(R.string.sync_pending, r.pending), c.warning)
                            r.lastError != null -> StatusPill(stringResource(R.string.flight_refused_short), c.error)
                            r.local -> StatusPill(stringResource(R.string.sync_synced), c.success)
                            else -> {}
                        }
                    }
                    Text(DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(r.startedAt)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Text(Fmt.duration(r.durationS), style = MaterialTheme.typography.bodyMedium)
                        r.distanceM?.let { Text(Fmt.distance(it, imperial), style = MaterialTheme.typography.bodyMedium) }
                        r.maxAltM?.let { Text(Fmt.altitude(it, imperial), style = MaterialTheme.typography.bodyMedium) }
                        if (r.simulated) Text("SIM", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}
