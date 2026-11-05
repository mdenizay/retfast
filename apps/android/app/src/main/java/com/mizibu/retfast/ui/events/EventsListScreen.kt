package com.mizibu.retfast.ui.events

import android.app.Application
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import com.mizibu.retfast.net.Event
import com.mizibu.retfast.net.events
import com.mizibu.retfast.ui.common.AeroCard
import com.mizibu.retfast.ui.common.Banner
import com.mizibu.retfast.ui.common.BannerKind
import com.mizibu.retfast.ui.common.SectionTitle
import com.mizibu.retfast.ui.common.StatusPill
import com.mizibu.retfast.ui.common.userMessage
import com.mizibu.retfast.ui.theme.Aero
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class EventsUi(val events: List<Event> = emptyList(), val loading: Boolean = true, val error: String? = null, val loaded: Boolean = false)

class EventsViewModel(app: Application) : AndroidViewModel(app) {
    private val g = app.graph
    private val _ui = MutableStateFlow(EventsUi())
    val ui: StateFlow<EventsUi> = _ui

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _ui.update { it.copy(loading = true) }
            try {
                val list = g.api.events()
                _ui.value = EventsUi(list, false, null, true)
            } catch (e: ApiException) {
                _ui.update { it.copy(loading = false, error = e.userMessage(getApplication())) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventsListScreen(onOpen: (String) -> Unit) {
    val vm: EventsViewModel = viewModel()
    val ui by vm.ui.collectAsStateWithLifecycle()
    var query by remember { mutableStateOf("") }
    val q = query.trim().lowercase()
    val filtered = ui.events.filter { q.isEmpty() || it.name.lowercase().contains(q) || it.locationName.lowercase().contains(q) }
    val mine = filtered.filter { it.memberRole != null || it.isOrganizer }
    val others = filtered - mine.toSet()
    val c = Aero.colors

    PullToRefreshBox(isRefreshing = ui.loading, onRefresh = { vm.refresh() }, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item { Text(stringResource(R.string.tab_events), style = MaterialTheme.typography.headlineMedium) }
            item { OutlinedTextField(query, { query = it }, label = { Text(stringResource(R.string.search)) }, singleLine = true, modifier = Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium) }
            ui.error?.let { item { Banner(it, BannerKind.Warning) } }
            if (mine.isNotEmpty()) {
                item { SectionTitle(stringResource(R.string.my_events)) }
                items(mine, key = { "m-" + it.id }) { e ->
                    EventCard(e, onOpen) {
                        e.memberRole?.let { StatusPill(roleLabel(it), c.secondary, Icons.Filled.CheckCircle) }
                        if (e.isOrganizer) {
                            StatusPill(stringResource(R.string.role_organizer), c.retrieval, Icons.Filled.CheckCircle)
                            val pending = e.counts.pendingApplications ?: 0
                            if (pending > 0) StatusPill(stringResource(R.string.pending_applications, pending), c.warning)
                        }
                    }
                }
            }
            if (others.isNotEmpty()) {
                item { SectionTitle(stringResource(R.string.discover)) }
                items(others, key = { "o-" + it.id }) { e ->
                    EventCard(e, onOpen) {
                        when (e.me?.application?.status) {
                            "pending" -> StatusPill(stringResource(R.string.app_pending), c.warning)
                            "rejected" -> StatusPill(stringResource(R.string.app_rejected_short), c.error)
                            else -> if (e.settings.applicationsOpen) StatusPill(stringResource(R.string.apps_open), c.success) else StatusPill(stringResource(R.string.apps_closed_short), c.offline)
                        }
                    }
                }
            }
            if (!ui.loading && ui.loaded && filtered.isEmpty()) item { Text(stringResource(R.string.no_events), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

@Composable
private fun EventCard(e: Event, onOpen: (String) -> Unit, badges: @Composable () -> Unit) {
    val c = Aero.colors
    AeroCard(Modifier.clickable { onOpen(e.id) }) {
        Text(e.name, style = MaterialTheme.typography.titleMedium)
        if (e.locationName.isNotBlank()) Text(e.locationName, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            StatusPill(statusLabel(e.status), if (e.status == "active") c.trackingActive else c.offline)
            if (e.isDemo) StatusPill("DEMO", c.warning)
            badges()
        }
    }
}

