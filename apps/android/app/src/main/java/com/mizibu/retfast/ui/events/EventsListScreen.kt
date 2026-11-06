package com.mizibu.retfast.ui.events

import android.app.Application
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.mizibu.retfast.R
import com.mizibu.retfast.app.SessionState
import com.mizibu.retfast.graph
import com.mizibu.retfast.net.ApiException
import com.mizibu.retfast.net.Event
import com.mizibu.retfast.net.events
import com.mizibu.retfast.ui.common.userMessage
import com.mizibu.retfast.ui.common.AeroButton
import com.mizibu.retfast.ui.common.AeroCard
import com.mizibu.retfast.ui.common.Avatar
import com.mizibu.retfast.ui.common.BtnKind
import com.mizibu.retfast.ui.common.DateTile
import com.mizibu.retfast.ui.common.EmptyState
import com.mizibu.retfast.ui.common.HeaderCircleButton
import com.mizibu.retfast.ui.common.SectionTitle
import com.mizibu.retfast.ui.common.StatusPill
import com.mizibu.retfast.ui.common.Tone
import com.mizibu.retfast.ui.common.WarningRow
import com.mizibu.retfast.ui.theme.Aero
import com.mizibu.retfast.ui.theme.Lucide
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

data class EventsUi(val events: List<Event> = emptyList(), val loading: Boolean = true, val error: String? = null, val loaded: Boolean = false, val offline: Boolean = false)

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
                val offline = e is ApiException.Transport
                _ui.update { it.copy(loading = false, offline = offline, error = if (offline) null else e.userMessage(getApplication())) }
            }
        }
    }
}

/** Home: greeting header, live-event hero, my events, then events open for application (mirrors iOS EventsListView). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventsListScreen(onOpen: (String) -> Unit, onProfile: () -> Unit = {}) {
    val vm: EventsViewModel = viewModel()
    val ui by vm.ui.collectAsStateWithLifecycle()
    val g = LocalContext.current.graph
    val session by g.session.state.collectAsStateWithLifecycle()
    val me = (session as? SessionState.SignedIn)?.me
    val c = Aero.colors

    val mine = ui.events.filter { it.memberRole != null || it.isOrganizer }
    val others = ui.events - mine.toSet()
    val hero = mine.firstOrNull { it.status == "active" }
    val rest = mine.filter { it.id != hero?.id }
    val pending = mine.filter { it.isOrganizer }.sumOf { it.counts.pendingApplications ?: 0 }
    val today = LocalDate.now().format(DateTimeFormatter.ofPattern("d MMM", LocalConfiguration.current.locales[0]))

    PullToRefreshBox(isRefreshing = ui.loading && ui.loaded, onRefresh = { vm.refresh() }, modifier = Modifier.fillMaxSize().background(c.background)) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Row(Modifier.fillMaxWidth().padding(bottom = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.clip(CircleShape).clickable(onClick = onProfile)) { Avatar(me?.fullName, 46.dp, c.primary) }
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.home_today, today), fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
                        Text(stringResource(R.string.tab_events), fontSize = 13.sp, color = c.textMuted)
                    }
                    HeaderCircleButton(Lucide.RefreshCw, stringResource(R.string.refresh), { vm.refresh() })
                }
            }
            if (ui.offline) item { WarningRow(stringResource(R.string.home_offline), Tone.Warning, Lucide.WifiOff) }
            ui.error?.let { err ->
                item {
                    AeroCard {
                        WarningRow(err, Tone.Error, Lucide.CircleAlert)
                        AeroButton(stringResource(R.string.retry), { vm.refresh() }, kind = BtnKind.Secondary)
                    }
                }
            }
            if (!ui.loaded && ui.loading) item { Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) { androidx.compose.material3.CircularProgressIndicator(color = c.primary, strokeWidth = 2.5.dp) } }

            hero?.let { e -> item(key = "hero") { HeroCard(e) { onOpen(e.id) } } }
            if (pending > 0) item {
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.warning.copy(alpha = 0.12f)).padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Icon(Lucide.Inbox, null, tint = c.warning, modifier = Modifier.size(18.dp))
                    Text(stringResource(R.string.pending_notice, pending), fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.textPrimary)
                }
            }

            if (ui.loaded) {
                item { SectionTitle(stringResource(if (hero != null) R.string.other_my_events else R.string.my_events), count = rest.size.takeIf { it > 0 }) }
                if (rest.isEmpty() && hero == null) item {
                    AeroCard { EmptyState(Lucide.Flag, stringResource(R.string.empty_mine_title), stringResource(R.string.empty_mine_body)) }
                }
                items(rest, key = { "m-" + it.id }) { e -> EventCard(e) { onOpen(e.id) } }
                if (others.isNotEmpty()) {
                    item { SectionTitle(stringResource(R.string.discover), Modifier.padding(top = 8.dp), count = others.size) }
                    items(others, key = { "o-" + it.id }) { e -> EventCard(e) { onOpen(e.id) } }
                }
            }
        }
    }
}

@Composable
private fun HeroCard(e: Event, onOpen: () -> Unit) {
    val c = Aero.colors
    val pilot = e.memberRole == "pilot"
    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(c.surface)) {
        Canvas(Modifier.matchParentSize()) {
            drawRect(Brush.radialGradient(listOf(c.primary.copy(alpha = 0.16f), Color.Transparent), center = Offset(size.width * 0.92f, 0f), radius = size.width * 0.6f))
        }
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(c.primary))
                Text(stringResource(R.string.live_now), color = c.primary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                e.memberRole?.let { Text("· " + roleLabel(it), color = c.textMuted, fontSize = 13.sp) }
            }
            Text(e.name, fontSize = 24.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary, lineHeight = 28.sp)
            val sub = listOf(e.locationName, dateRange(e.startsAt, e.endsAt)).filter { it.isNotBlank() }.joinToString(" · ")
            if (sub.isNotEmpty()) Text(sub, fontSize = 13.sp, color = c.textMuted)
            Spacer(Modifier.size(2.dp))
            AeroButton(stringResource(if (pilot) R.string.prepare_flight else R.string.open_event), onOpen, kind = BtnKind.Primary, icon = Lucide.ArrowRight, fill = false)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EventCard(e: Event, onOpen: () -> Unit) {
    val c = Aero.colors
    val app = e.me?.application?.status
    val subtitle: Pair<String, Color> = when {
        app == "pending" -> stringResource(R.string.card_pending) to c.warning
        app == "rejected" -> stringResource(R.string.card_rejected) to c.error
        e.isOrganizer && (e.counts.pendingApplications ?: 0) > 0 -> stringResource(R.string.org_pending, e.counts.pendingApplications ?: 0) to c.warning
        e.memberRole == null && !e.isOrganizer && e.settings.applicationsOpen -> stringResource(R.string.card_open) to c.success
        else -> dateRange(e.startsAt, e.endsAt) to c.textMuted
    }
    AeroCard(padding = 16.dp, spacing = 10.dp, onClick = onOpen) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            DateTile(e.startsAt, active = e.status == "active")
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(e.name, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (e.locationName.isNotBlank()) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(Lucide.MapPin, null, tint = c.textMuted, modifier = Modifier.size(13.dp))
                    Text(e.locationName, fontSize = 13.sp, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (subtitle.first.isNotBlank()) Text(subtitle.first, fontSize = 13.sp, color = subtitle.second, fontWeight = FontWeight.Medium)
            }
            Box(Modifier.size(30.dp).clip(CircleShape).background(c.surfaceElevated), contentAlignment = Alignment.Center) {
                Icon(Lucide.ChevronRight, null, tint = c.textMuted, modifier = Modifier.size(16.dp))
            }
        }
        val chips = e.status == "active" || e.memberRole != null || e.isOrganizer || e.isDemo
        if (chips) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (e.status == "active") StatusPill(stringResource(R.string.chip_live), Tone.Active, Lucide.Radio)
            e.memberRole?.let { StatusPill(roleLabel(it), Tone.Neutral, Lucide.User) }
            if (e.isOrganizer) StatusPill(stringResource(R.string.role_organizer), Tone.Info, Lucide.Star)
            if (e.isDemo) StatusPill("DEMO", Tone.Warning, Lucide.Sparkles)
        }
    }
}

/** "6–8 Kas", "30 Kas – 2 Ara" or a single day. */
fun dateRange(startIso: String?, endIso: String?): String {
    val z = ZoneId.systemDefault()
    fun d(s: String?) = s?.let { runCatching { Instant.parse(it).atZone(z).toLocalDate() }.getOrNull() }
    val a = d(startIso) ?: return ""
    val b = d(endIso)
    val loc = Locale.getDefault()
    val dm = DateTimeFormatter.ofPattern("d MMM", loc)
    return when {
        b == null || b == a -> a.format(dm)
        a.month == b.month && a.year == b.year -> "${a.dayOfMonth}–${b.format(dm)}"
        else -> "${a.format(dm)} – ${b.format(dm)}"
    }
}
