package com.mizibu.retfast.ui.events

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mizibu.retfast.R
import com.mizibu.retfast.data.RetrievalEntity
import com.mizibu.retfast.domain.ApplicationState
import com.mizibu.retfast.domain.Roles
import com.mizibu.retfast.graph
import com.mizibu.retfast.net.Application
import com.mizibu.retfast.net.Event
import com.mizibu.retfast.net.Retrieval
import com.mizibu.retfast.net.RetrievalStatus
import com.mizibu.retfast.net.Weather
import com.mizibu.retfast.net.weather
import com.mizibu.retfast.retrieval.RetrievalStage
import com.mizibu.retfast.retrieval.SharingMode
import com.mizibu.retfast.retrieval.server
import com.mizibu.retfast.retrieval.stage
import com.mizibu.retfast.sync.SyncSnapshot
import com.mizibu.retfast.tracking.TrackingStatus
import com.mizibu.retfast.ui.common.AeroCard
import com.mizibu.retfast.ui.common.AeroTextField
import com.mizibu.retfast.ui.common.Avatar
import com.mizibu.retfast.ui.common.CapsuleSegment
import com.mizibu.retfast.ui.common.Caption
import com.mizibu.retfast.ui.common.ConfirmDialog
import com.mizibu.retfast.ui.common.DemoBadge
import com.mizibu.retfast.ui.common.EmptyState
import com.mizibu.retfast.ui.common.Fmt
import com.mizibu.retfast.ui.common.FreshnessBadge
import com.mizibu.retfast.ui.common.IconBubble
import com.mizibu.retfast.ui.common.InfoTile
import com.mizibu.retfast.ui.common.InstrumentTile
import com.mizibu.retfast.ui.common.PermState
import com.mizibu.retfast.ui.common.Permissions
import com.mizibu.retfast.ui.common.PrimaryButton
import com.mizibu.retfast.ui.common.RoundIconButton
import com.mizibu.retfast.ui.common.RowDivider
import com.mizibu.retfast.ui.common.SecondaryButton
import com.mizibu.retfast.ui.common.SimBadge
import com.mizibu.retfast.ui.common.StatusPill
import com.mizibu.retfast.ui.common.SyncBadge
import com.mizibu.retfast.ui.common.TextAction
import com.mizibu.retfast.ui.common.Tone
import com.mizibu.retfast.ui.common.WarningRow
import com.mizibu.retfast.ui.common.color
import com.mizibu.retfast.ui.common.rememberPermState
import com.mizibu.retfast.ui.flight.EndFlightDialog
import com.mizibu.retfast.ui.theme.Aero
import com.mizibu.retfast.ui.theme.AeroTokens
import com.mizibu.retfast.ui.theme.Lucide
import com.mizibu.retfast.util.Geo
import com.mizibu.retfast.util.Iso
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.ZoneId
import java.util.Locale
import kotlin.math.roundToInt

// ---------------------------------------------------------------- shared helpers

fun dial(ctx: Context, phone: String) {
    if (phone.isBlank()) return
    ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${phone.filter { it.isDigit() || it == '+' }}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

/** Navigation to a position: Google Maps turn-by-turn if installed, else any geo: handler. */
fun navigateTo(ctx: Context, lat: Double, lon: Double, label: String) {
    val gm = Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=$lat,$lon&mode=d")).setPackage("com.google.android.apps.maps").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try { ctx.startActivity(gm) } catch (e: ActivityNotFoundException) {
        try {
            ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("geo:$lat,$lon?q=$lat,$lon(${Uri.encode(label)})")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: ActivityNotFoundException) {}
    }
}

@Composable
internal fun nowTicker(periodMs: Long = 1000): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(periodMs) { while (true) { delay(periodMs); now = System.currentTimeMillis() } }
    return now
}

/** "12 sn" / "4 dk" / "2 sa". */
@Composable
internal fun ageText(seconds: Long): String = when {
    seconds < 60 -> stringResource(R.string.age_s, seconds.toInt())
    seconds < 3600 -> stringResource(R.string.age_m, (seconds / 60).toInt())
    else -> stringResource(R.string.age_h, (seconds / 3600).toInt())
}

@Composable
fun statusLabel(s: String) = when (s) {
    "draft" -> stringResource(R.string.status_draft)
    "published" -> stringResource(R.string.status_upcoming)
    "active" -> stringResource(R.string.status_active)
    "completed" -> stringResource(R.string.status_completed)
    "archived" -> stringResource(R.string.status_archived)
    else -> s
}

@Composable
fun roleLabel(r: String) = when (r) {
    Roles.PILOT -> stringResource(R.string.role_pilot)
    Roles.OBSERVER -> stringResource(R.string.role_observer)
    Roles.RETRIEVER -> stringResource(R.string.role_retriever)
    else -> r
}

@Composable
private fun roleExplain(r: String) = when (r) {
    Roles.PILOT -> stringResource(R.string.role_pilot_x)
    Roles.OBSERVER -> stringResource(R.string.role_observer_x)
    Roles.RETRIEVER -> stringResource(R.string.role_retriever_x)
    else -> ""
}

@Composable
fun retrievalStatusLabel(s: String) = when (s) {
    RetrievalStatus.REQUESTED -> stringResource(R.string.st_requested)
    RetrievalStatus.ACCEPTED -> stringResource(R.string.st_accepted_short)
    RetrievalStatus.PICKED_UP -> stringResource(R.string.st_picked_up_short)
    RetrievalStatus.DELIVERED -> stringResource(R.string.st_delivered_short)
    else -> stringResource(R.string.st_cancelled)
}

private fun retrievalTone(s: String) = when (s) {
    RetrievalStatus.REQUESTED -> Tone.Warning
    RetrievalStatus.ACCEPTED, RetrievalStatus.PICKED_UP -> Tone.Retrieval
    RetrievalStatus.DELIVERED -> Tone.Success
    else -> Tone.Neutral
}

@Composable
fun EventStatusPill(status: String) {
    val (tone, icon) = when (status) {
        "active" -> Tone.Active to Lucide.Radio
        "published" -> Tone.Info to Lucide.Calendar
        "completed" -> Tone.Neutral to Lucide.CircleCheck
        "archived" -> Tone.Neutral to Lucide.Archive
        else -> Tone.Neutral to Lucide.Pencil
    }
    StatusPill(statusLabel(status), tone, icon)
}

/** Live link state on top of the map. */
@Composable
fun ConnectionPill(connected: Boolean, modifier: Modifier = Modifier) {
    val c = Aero.colors
    val color = if (connected) c.trackingActive else c.trackingStale
    Row(
        modifier.clip(CircleShape).background(c.surface).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(color))
        Text(
            stringResource(if (connected) R.string.conn_connected else R.string.conn_retrying),
            fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary, maxLines = 1,
        )
    }
}

/** Name, role · location and the status pill at the top of the sheet. */
@Composable
fun EventHeader(event: Event) {
    val c = Aero.colors
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(event.name, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = c.textPrimary, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (event.isDemo) DemoBadge()
            }
            val role = event.memberRole?.let { roleLabel(it) } ?: if (event.isOrganizer) stringResource(R.string.organizer_badge) else null
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (role != null) Text(role, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.primary)
                if (role != null && event.locationName.isNotBlank()) Text("·", fontSize = 14.sp, color = c.textMuted)
                if (event.locationName.isNotBlank()) Text(event.locationName, fontSize = 14.sp, color = c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (event.center != null && event.centerIsApproximate) Text(stringResource(R.string.center_approx), fontSize = 12.sp, color = c.textMuted)
        }
        EventStatusPill(event.status)
    }
}

/** Rounded list container with hairline separators. */
@Composable
private fun GroupList(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(AeroTokens.Radius.lg.dp)).background(Aero.colors.surface)) { content() }
}

// ---------------------------------------------------------------- event info + weather

@Composable
fun EventInfoCard(event: Event, ui: EventUi) {
    val c = Aero.colors
    val airborne = ui.live?.pilots?.size ?: 0
    val cars = ui.live?.retrievers?.count { it.onDuty } ?: event.counts.retrievers
    AeroCard {
        Caption(stringResource(R.string.info_event))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            InfoTile(Lucide.Calendar, stringResource(R.string.info_date), dateRange(event.startsAt, event.endsAt).ifBlank { "—" }, Modifier.weight(1f))
            InfoTile(Lucide.Plane, stringResource(R.string.info_airborne), stringResource(R.string.info_n_pilots, airborne), Modifier.weight(1f))
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            InfoTile(Lucide.MapPin, stringResource(R.string.info_location), event.locationName.ifBlank { "—" }, Modifier.weight(1f))
            InfoTile(Lucide.Car, stringResource(R.string.role_retriever), stringResource(R.string.info_n_cars, cars), Modifier.weight(1f))
        }
        if (event.description.isNotBlank()) Text(event.description, fontSize = 15.sp, lineHeight = 21.sp, color = c.textSecondary)
    }
}

private fun wxTone(f: String?) = when (f) {
    "good" -> Tone.Success
    "marginal" -> Tone.Warning
    "poor" -> Tone.Error
    else -> Tone.Neutral
}

@Composable
private fun wxVerdict(f: String?) = stringResource(
    when (f) { "good" -> R.string.wx_good; "marginal" -> R.string.wx_marginal; "poor" -> R.string.wx_poor; else -> R.string.wx_unknown },
)

@Composable
private fun wxReason(r: String) = when (r) {
    "strong_wind" -> stringResource(R.string.wx_strong_wind)
    "gusty" -> stringResource(R.string.wx_gusty)
    "wind_aloft" -> stringResource(R.string.wx_wind_aloft)
    "rain" -> stringResource(R.string.wx_rain)
    "overdevelopment" -> stringResource(R.string.wx_overdev)
    else -> r
}

private fun compass(deg: Double?): String {
    deg ?: return ""
    val tr = Locale.getDefault().language == "tr"
    val names = if (tr) listOf("K", "KD", "D", "GD", "G", "GB", "B", "KB") else listOf("N", "NE", "E", "SE", "S", "SW", "W", "NW")
    return " · " + names[(((deg % 360) + 360 + 22.5) / 45).toInt() % 8]
}

/** Advisory weather for the event centre. Renders nothing until (and unless) the forecast loads. */
@Composable
fun WeatherCard(event: Event, imperial: Boolean) {
    val g = LocalContext.current.graph
    val weather by produceState<Weather?>(null, event.id) {
        if (event.center != null) value = runCatching { g.api.weather(event.id) }.getOrNull()
    }
    weather?.let { WeatherContent(it, imperial) }
}

@Composable
private fun WeatherContent(w: Weather, imperial: Boolean) {
    val c = Aero.colors
    val ctx = LocalContext.current
    val now = w.hourly.firstOrNull()
    val tone = wxTone(w.flyability)
    val tc = tone.color()
    val wind = w.current.windMs ?: now?.windMs
    val dir = w.current.windDirDeg ?: now?.windDirDeg
    val hours = w.hourly.take(12)
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(AeroTokens.Radius.lg.dp)).background(c.surface).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(46.dp).clip(CircleShape).background(tc.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
                // Arrow points where the wind blows to.
                Icon(Lucide.ArrowUp, null, tint = tc.copy(alpha = if (dir == null) 0.3f else 1f), modifier = Modifier.size(20.dp).rotate(((dir ?: 0.0) + 180).toFloat()))
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(stringResource(R.string.weather_title), fontSize = 12.sp, color = c.textMuted)
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(Fmt.speedValue(wind, imperial), fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary, style = TextStyle(fontFeatureSettings = "tnum"))
                    Text(Fmt.speedUnit(imperial) + compass(dir), fontSize = 14.sp, color = c.textSecondary, modifier = Modifier.padding(bottom = 2.dp))
                }
                val parts = buildList {
                    add(stringResource(R.string.wx_gust, "${Fmt.speedValue(w.current.gustMs ?: now?.gustMs, imperial)} ${Fmt.speedUnit(imperial)}"))
                    now?.cloudBaseM?.let { add(stringResource(R.string.wx_base, Fmt.altitude(it, imperial))) }
                    (w.current.tempC ?: now?.tempC)?.let { add("${it.roundToInt()} °C") }
                }
                Text(parts.joinToString(" · "), fontSize = 13.sp, color = c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Row(
                Modifier.clip(CircleShape).background(tc.copy(alpha = 0.14f)).padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Box(Modifier.size(7.dp).clip(CircleShape).background(tc))
                Text(wxVerdict(w.flyability), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = tc)
            }
        }
        val reasons = w.flyReasons.orEmpty()
        if (reasons.isNotEmpty()) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Lucide.TriangleAlert, null, tint = tc, modifier = Modifier.size(14.dp))
                Text(reasons.map { wxReason(it) }.joinToString(" · "), fontSize = 13.sp, fontWeight = FontWeight.Medium, color = tc)
            }
        }
        if (hours.isNotEmpty()) {
            val scale = maxOf(8.0, hours.mapNotNull { it.windMs }.maxOrNull() ?: 0.0)
            val z = ZoneId.systemDefault()
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.Bottom) {
                hours.forEach { h ->
                    val ht = wxTone(h.flyability)
                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(Fmt.speedValue(h.windMs, imperial), fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = c.textSecondary, maxLines = 1)
                        val frac = ((h.windMs ?: 0.0).coerceAtMost(scale) / scale).toFloat()
                        Box(
                            Modifier.fillMaxWidth().height((30 * frac).coerceAtLeast(4f).dp).clip(RoundedCornerShape(3.dp))
                                .background(if (ht == Tone.Neutral) c.surfaceElevated else ht.color().copy(alpha = 0.8f)),
                        )
                        val hour = runCatching { Instant.parse(h.t).atZone(z).hour }.getOrNull()
                        Text(hour?.let { "%02d".format(it) } ?: "", fontSize = 10.sp, color = c.textMuted)
                    }
                }
            }
        }
        Text(
            stringResource(R.string.wx_disclaimer) + " · " + w.attribution,
            Modifier.clickable {
                runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://open-meteo.com/")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            },
            fontSize = 11.sp, color = c.textMuted,
        )
    }
}

// ---------------------------------------------------------------- readiness

private data class RdItem(val icon: ImageVector, val title: String, val detail: String?, val ok: Boolean, val required: Boolean, val action: (() -> Unit)?)

/** Pre-flight phone checks: summary, segmented progress and actionable rows (mirrors iOS ReadinessList). */
@Composable
fun ReadinessList(perm: PermState, online: Boolean, pending: Int, onOpenPermissions: () -> Unit) {
    val c = Aero.colors
    val ctx = LocalContext.current
    val items = listOfNotNull(
        RdItem(Lucide.MapPin, stringResource(R.string.rd_location), if (perm.coarseOnly) stringResource(R.string.rd_precise_needed) else null, perm.fine, true, onOpenPermissions),
        RdItem(Lucide.Satellite, stringResource(R.string.rd_gps), null, perm.gpsEnabled, true) { Permissions.openLocationSettings(ctx) },
        RdItem(Lucide.Navigation, stringResource(R.string.rd_background), stringResource(R.string.rd_background_hint), perm.background, false, onOpenPermissions),
        RdItem(Lucide.Bell, stringResource(R.string.rd_notifications), stringResource(R.string.rd_notifications_hint), perm.notifications, false, onOpenPermissions),
        RdItem(Lucide.Battery, stringResource(R.string.rd_battery_opt), stringResource(R.string.rd_battery_opt_hint), perm.batteryExempt, false) { Permissions.requestBatteryExemption(ctx) },
        RdItem(Lucide.BatteryLow, stringResource(R.string.rd_power), stringResource(R.string.rd_power_save), !perm.powerSave, false, null),
        RdItem(if (online) Lucide.Wifi else Lucide.WifiOff, stringResource(R.string.rd_network), stringResource(R.string.rd_offline_ok), online, false, null),
        if (pending > 0) RdItem(Lucide.CloudUpload, stringResource(R.string.rd_unsent, pending), stringResource(R.string.pending_note), false, false, null) else null,
    )
    val okCount = items.count { it.ok }
    val attention = items.size - okCount
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (attention == 0) stringResource(R.string.rd_all_ready) else stringResource(R.string.rd_attention, attention),
                Modifier.weight(1f), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary,
            )
            Text("$okCount/${items.size}", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.textSecondary, style = TextStyle(fontFeatureSettings = "tnum"))
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            items.forEach { i ->
                val col = when { i.ok -> c.success; i.required -> c.error; else -> c.warning }
                Box(Modifier.weight(1f).height(5.dp).clip(CircleShape).background(col))
            }
        }
        GroupList {
            items.forEachIndexed { idx, i ->
                if (idx > 0) RowDivider(Modifier.padding(start = 62.dp))
                ReadinessRow(i)
            }
        }
        Text(stringResource(R.string.rd_killer_note), fontSize = 12.sp, lineHeight = 16.sp, color = c.textMuted)
    }
}

@Composable
private fun ReadinessRow(i: RdItem) {
    val c = Aero.colors
    val tint = when { i.ok -> c.success; i.required -> c.error; else -> c.warning }
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        IconBubble(i.icon, if (i.ok) c.textSecondary else tint, 36.dp, 17.dp, 0.14f)
        Column(Modifier.weight(1f)) {
            Text(i.title, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.textPrimary)
            if (!i.ok && i.detail != null) Text(i.detail, fontSize = 13.sp, lineHeight = 17.sp, color = c.textSecondary)
        }
        if (!i.ok && i.action != null) {
            Text(
                stringResource(R.string.rd_fix),
                Modifier.clip(CircleShape).background(c.primary).clickable(role = Role.Button, onClick = i.action).padding(horizontal = 14.dp, vertical = 7.dp),
                fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.onPrimary,
            )
        } else {
            Icon(if (i.ok) Lucide.CircleCheck else Lucide.CircleAlert, null, tint = tint, modifier = Modifier.size(20.dp))
        }
    }
}

// ---------------------------------------------------------------- not a member

@Composable
fun NotMemberSheet(event: Event, state: ApplicationState, busy: Boolean, vm: EventViewModel) {
    val c = Aero.colors
    when (state) {
        ApplicationState.CanApply -> ApplyForm(busy, vm)
        ApplicationState.Closed -> AeroCard { WarningRow(stringResource(R.string.apps_closed), Tone.Info, Lucide.Lock) }
        is ApplicationState.Pending -> AeroCard {
            StatusPill(stringResource(R.string.app_reviewing), Tone.Warning, Lucide.Clock)
            Text(stringResource(R.string.app_pending_body2), fontSize = 14.sp, lineHeight = 19.sp, color = c.textSecondary)
            TextAction(stringResource(R.string.withdraw), { if (!busy) vm.withdrawApplication(state.id) }, color = c.error)
        }
        is ApplicationState.Rejected, is ApplicationState.Withdrawn -> {
            val rejected = state is ApplicationState.Rejected
            AeroCard {
                StatusPill(
                    stringResource(if (rejected) R.string.app_rejected_pill else R.string.app_withdrawn_pill),
                    Tone.Neutral, if (rejected) Lucide.CircleX else Lucide.Undo2,
                )
            }
            val canReapply = (state as? ApplicationState.Rejected)?.canReapply ?: (state as ApplicationState.Withdrawn).canReapply
            if (canReapply) ApplyForm(busy, vm)
        }
    }
}

@Composable
private fun ApplyForm(busy: Boolean, vm: EventViewModel) {
    val c = Aero.colors
    var message by rememberSaveable { mutableStateOf("") }
    AeroCard {
        Text(stringResource(R.string.apply_title), fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
        Text(stringResource(R.string.apply_explain), fontSize = 14.sp, lineHeight = 19.sp, color = c.textSecondary)
        AeroTextField(message, { message = it }, stringResource(R.string.apply_hint), singleLine = false, minLines = 2, maxLines = 4, background = c.surfaceElevated)
        PrimaryButton(stringResource(R.string.apply), { vm.applyToEvent(message) }, busy = busy, icon = Lucide.Send)
    }
}

// ---------------------------------------------------------------- pilot

@Composable
fun PilotSheet(
    event: Event,
    ui: EventUi,
    vm: EventViewModel,
    status: TrackingStatus,
    sync: SyncSnapshot,
    activeLocal: RetrievalEntity?,
    imperial: Boolean,
    onOpenComputer: () -> Unit,
    onOpenWaiting: (String) -> Unit,
    onOpenPermissions: () -> Unit,
    onRetrieve: () -> Unit,
) {
    val ctx = LocalContext.current
    val g = ctx.graph
    val c = Aero.colors
    val perm by rememberPermState()
    val online by g.online.collectAsStateWithLifecycle()
    var showNotice by remember { mutableStateOf(false) }
    var showEnd by remember { mutableStateOf(false) }
    val recordingHere = status.recording && status.eventId == event.id.lowercase()

    when {
        activeLocal != null -> {
            RetrievalCard(activeLocal)
            PrimaryButton(stringResource(R.string.follow_retrieve), { onOpenWaiting(activeLocal.id) }, large = true, icon = Lucide.Car)
        }
        recordingHere -> {
            FlightPanel(status, sync, perm, imperial)
            PrimaryButton(stringResource(R.string.flight_computer), onOpenComputer, large = true, icon = Lucide.Gauge)
            SecondaryButton(stringResource(R.string.end_flight), { showEnd = true }, icon = Lucide.Square)
        }
        status.recording -> AeroCard { WarningRow(stringResource(R.string.notice_flight_elsewhere)) }
        else -> {
            when (event.status) {
                "active" -> {}
                "published" -> WarningRow(stringResource(R.string.ev_not_started), Tone.Info, Lucide.Clock)
                else -> WarningRow(stringResource(R.string.ev_not_active))
            }
            if (!event.settings.liveTracking) WarningRow(stringResource(R.string.live_tracking_off), Tone.Warning, Lucide.MapPinOff)
            PositionRow(status.lastPos ?: ui.myPos, status.lastAccuracy)
            PrimaryButton(
                stringResource(R.string.start_flight),
                onClick = {
                    when {
                        !perm.canRecord -> onOpenPermissions()
                        !g.prefs.sharingNoticeAcked(event.id) -> showNotice = true
                        else -> vm.startFlight { onOpenComputer() }
                    }
                },
                large = true,
                enabled = event.settings.liveTracking,
                icon = Lucide.Play,
            )
            SecondaryButton(stringResource(R.string.retrieve_without_flight), onRetrieve, icon = Lucide.Hand)
            Spacer(Modifier.height(4.dp))
            ReadinessList(perm, online, sync.pendingCount, onOpenPermissions)
        }
    }

    if (showNotice) {
        ConfirmDialog(
            title = stringResource(R.string.sharing_notice_title),
            message = stringResource(R.string.sharing_notice_body),
            confirm = stringResource(R.string.understood_start),
            onConfirm = { g.prefs.ackSharingNotice(event.id); showNotice = false; vm.startFlight { onOpenComputer() } },
            onDismiss = { showNotice = false },
        )
    }
    if (showEnd) {
        EndFlightDialog(
            title = stringResource(R.string.end_flight_q),
            onEndRetrieve = { showEnd = false; vm.endFlight(true) },
            onEndNoRetrieve = { showEnd = false; vm.endFlight(false) },
            onDismiss = { showEnd = false },
            dismissLabel = stringResource(R.string.keep_recording),
        )
    }
}

@Composable
private fun PositionRow(pos: Pair<Double, Double>?, accuracy: Double?) {
    val c = Aero.colors
    GroupList {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            IconBubble(Lucide.LocateFixed, c.primary, 36.dp, 17.dp)
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.your_position), fontSize = 13.sp, color = c.textSecondary)
                Text(
                    pos?.let { "${Fmt.coord(it.first)}, ${Fmt.coord(it.second)}" } ?: stringResource(R.string.getting_fix),
                    fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.textPrimary, style = TextStyle(fontFeatureSettings = "tnum"),
                )
            }
            if (pos != null && accuracy != null) {
                val tone = when { accuracy <= 20 -> Tone.Success; accuracy <= 50 -> Tone.Warning; else -> Tone.Error }
                StatusPill(Fmt.accuracy(accuracy), tone, Lucide.Crosshair)
            }
        }
    }
}

@Composable
private fun FlightPanel(status: TrackingStatus, sync: SyncSnapshot, perm: PermState, imperial: Boolean) {
    val c = Aero.colors
    val now = nowTicker()
    AeroCard {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusPill(stringResource(R.string.recording), c.trackingActive, Lucide.CircleDot)
            Spacer(Modifier.weight(1f))
            SyncBadge(sync)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            InstrumentTile(stringResource(R.string.duration), Fmt.duration(((now - (status.startedAt ?: now)) / 1000)), "", Modifier.weight(1f))
            InstrumentTile(stringResource(R.string.gps_alt), Fmt.altitudeValue(status.values.gpsAltitude, imperial), Fmt.altitudeUnit(imperial), Modifier.weight(1f))
            InstrumentTile(stringResource(R.string.ground_speed), Fmt.speedValue(status.values.groundSpeed, imperial), Fmt.speedUnit(imperial), Modifier.weight(1f))
        }
        if (!perm.background) WarningRow(stringResource(R.string.bg_missing_warning))
    }
}

/** Pilot-side retrieve status: retriever avatar + stage. */
@Composable
fun RetrievalCard(r: RetrievalEntity) {
    val c = Aero.colors
    val (text, tone) = when (r.stage) {
        RetrievalStage.SAVED_LOCALLY -> stringResource(R.string.st_saved) to Tone.Warning
        RetrievalStage.SENDING -> stringResource(R.string.st_sending) to Tone.Warning
        RetrievalStage.REQUESTED -> stringResource(R.string.st_requested) to Tone.Retrieval
        RetrievalStage.ACCEPTED -> stringResource(R.string.st_accepted) to Tone.Retrieval
        RetrievalStage.PICKED_UP -> stringResource(R.string.st_picked_up) to Tone.Retrieval
        RetrievalStage.DELIVERED -> stringResource(R.string.st_delivered) to Tone.Success
        RetrievalStage.CANCELLING -> stringResource(R.string.st_cancelling) to Tone.Warning
        RetrievalStage.CANCELLED -> stringResource(R.string.st_cancelled) to Tone.Neutral
        RetrievalStage.REFUSED -> stringResource(R.string.st_refused) to Tone.Error
        RetrievalStage.MERGED -> stringResource(R.string.st_merged) to Tone.Neutral
    }
    val retriever = r.server?.retriever
    AeroCard {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (retriever != null && retriever.fullName.isNotBlank()) Avatar(retriever.fullName, 48.dp, c.retrieval)
            else IconBubble(Lucide.Car, c.retrieval, 48.dp, 22.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    retriever?.fullName?.takeIf { it.isNotBlank() } ?: stringResource(R.string.retrieve_active),
                    fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary,
                )
                StatusPill(text, tone, Lucide.Car)
            }
        }
    }
}

// ---------------------------------------------------------------- retriever

@Composable
fun RetrieverSheet(event: Event, ui: EventUi, vm: EventViewModel, status: TrackingStatus, imperial: Boolean, onOpenPermissions: () -> Unit) {
    val perm by rememberPermState()
    val duty = status.duty?.takeIf { it.eventId == event.id }
    val onDuty = duty?.onDuty == true
    val myId = vm.myId
    val all = ui.live?.retrievals.orEmpty()
    val mine = all.filter { it.retriever?.userId == myId && (it.status == RetrievalStatus.ACCEPTED || it.status == RetrievalStatus.PICKED_UP) }
    val open = all.filter { it.status == RetrievalStatus.REQUESTED }.sortedBy { Iso.parse(it.requestedAt) ?: 0L }
    val me = status.lastPos ?: ui.myPos
    var tab by rememberSaveable { mutableStateOf(if (mine.isNotEmpty()) 1 else 0) }
    var lastMine by remember { mutableStateOf(mine.size) }
    LaunchedEffect(mine.size) { if (mine.size > lastMine) tab = 1; lastMine = mine.size }

    DutyCard(onDuty, ui.busy, status, perm) { on -> if (on && !perm.canRecord) onOpenPermissions() else vm.setDuty(on) }
    CapsuleSegment(
        listOf(0 to stringResource(R.string.tab_requests, open.size), 1 to stringResource(R.string.tab_pickups, mine.size)),
        tab, { tab = it },
    )
    if (tab == 0) {
        if (open.isEmpty()) EmptyState(Lucide.Hand, stringResource(R.string.empty_requests_title), stringResource(R.string.empty_requests_body))
        open.forEach { r -> OpenRequestCard(r, me, imperial, ui.busy) { vm.accept(r) } }
    } else {
        if (mine.isEmpty()) EmptyState(Lucide.Car, stringResource(R.string.empty_pickups_title), stringResource(R.string.empty_pickups_body))
        mine.forEach { r -> PickupCard(r, me, imperial, ui.busy, vm) }
    }
}

@Composable
private fun DutyCard(onDuty: Boolean, busy: Boolean, status: TrackingStatus, perm: PermState, setDuty: (Boolean) -> Unit) {
    val c = Aero.colors
    val now = nowTicker(5000)
    Column(Modifier.animateContentSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (onDuty) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(44.dp).clip(RoundedCornerShape(AeroTokens.Radius.sm.dp)).background(c.retrieval.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) {
                    Icon(Lucide.Car, null, tint = c.retrieval, modifier = Modifier.size(22.dp))
                }
                Column {
                    Text(stringResource(R.string.duty_on_title), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
                    Text(stringResource(R.string.duty_on_body), fontSize = 13.sp, color = c.textSecondary)
                }
            }
        }
        if (onDuty) SecondaryButton(stringResource(R.string.duty_stop), { setDuty(false) }, enabled = !busy, icon = Lucide.Square)
        else PrimaryButton(stringResource(R.string.duty_start), { setDuty(true) }, large = true, busy = busy, icon = Lucide.Play)
        if (!onDuty) {
            Text(stringResource(R.string.duty_off_note), fontSize = 12.sp, lineHeight = 16.sp, color = c.textMuted)
        } else {
            if (status.sharing is SharingMode.Retriever) {
                val age = Fmt.ageSeconds(now, status.lastShareAt)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Lucide.LocateFixed, null, tint = c.trackingActive, modifier = Modifier.size(16.dp))
                    Text(
                        if (age != null) stringResource(R.string.sharing_since, ageText(age)) else stringResource(R.string.sharing_first),
                        fontSize = 14.sp, color = c.textPrimary,
                    )
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Lucide.LocateOff, null, tint = c.textSecondary, modifier = Modifier.size(16.dp))
                    Text(stringResource(R.string.duty_not_sharing), fontSize = 14.sp, color = c.textSecondary)
                }
            }
            if (status.shareFailures > 0 && status.lastShareError != null) Text(stringResource(R.string.share_failing, status.lastShareError ?: ""), fontSize = 12.sp, color = c.warning)
            if (!perm.background) WarningRow(stringResource(R.string.bg_missing_warning))
        }
    }
}

private fun pilotPos(r: Retrieval) = r.pilotPosition?.let { it.lat to it.lon } ?: r.pickup?.let { it.lat to it.lon }

private fun distanceText(me: Pair<Double, Double>?, r: Retrieval, imperial: Boolean): String? {
    val p = pilotPos(r) ?: return null
    me ?: return null
    return Fmt.distance(Geo.distance(me.first, me.second, p.first, p.second), imperial)
}

@Composable
private fun OpenRequestCard(r: Retrieval, me: Pair<Double, Double>?, imperial: Boolean, busy: Boolean, onAccept: () -> Unit) {
    val c = Aero.colors
    val now = nowTicker(30_000)
    AeroCard(padding = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Avatar(r.pilot?.fullName, 48.dp, c.primary)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(r.pilot?.fullName?.ifBlank { null } ?: stringResource(R.string.role_pilot), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
                    if (r.isSimulated) SimBadge()
                }
                val waited = Fmt.ageSeconds(now, Iso.parse(r.requestedAt))
                Text(
                    listOfNotNull(waited?.let { stringResource(R.string.waiting_for, ageText(it)) }, distanceText(me, r, imperial)).joinToString(" · "),
                    fontSize = 14.sp, color = c.textSecondary, style = TextStyle(fontFeatureSettings = "tnum"),
                )
            }
        }
        if (r.note.isNotBlank()) NoteLine(r.note)
        PrimaryButton(stringResource(R.string.accept), onAccept, busy = busy, icon = Lucide.Check)
    }
}

@Composable
private fun NoteLine(note: String) {
    val c = Aero.colors
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(Lucide.MessageSquareText, null, tint = c.textSecondary, modifier = Modifier.padding(top = 2.dp).size(16.dp))
        Text(note, fontSize = 14.sp, lineHeight = 19.sp, color = c.textSecondary)
    }
}

@Composable
private fun PickupCard(r: Retrieval, me: Pair<Double, Double>?, imperial: Boolean, busy: Boolean, vm: EventViewModel) {
    val c = Aero.colors
    val ctx = LocalContext.current
    val now = nowTicker(15_000)
    var confirmRelease by remember { mutableStateOf(false) }
    var showDeliver by remember { mutableStateOf(false) }
    val phone = r.pilot?.phone.orEmpty()
    val pos = pilotPos(r)
    val picked = r.status == RetrievalStatus.PICKED_UP
    AeroCard(padding = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Avatar(r.pilot?.fullName, 48.dp, c.primary)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(r.pilot?.fullName?.ifBlank { null } ?: stringResource(R.string.role_pilot), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    Icon(if (picked) Lucide.Armchair else Lucide.Car, null, tint = c.retrieval, modifier = Modifier.size(14.dp))
                    Text(stringResource(if (picked) R.string.st_picked_up_short else R.string.st_accepted_short), fontSize = 14.sp, color = c.retrieval)
                }
            }
            if (phone.isNotBlank()) RoundIconButton(Lucide.Phone, stringResource(R.string.call), { dial(ctx, phone) }, tint = c.success)
            if (pos != null) RoundIconButton(Lucide.Navigation, stringResource(R.string.navigate), { navigateTo(ctx, pos.first, pos.second, r.pilot?.fullName ?: "Pilot") }, tint = c.secondary)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            distanceText(me, r, imperial)?.let {
                Icon(Lucide.MapPin, null, tint = c.textPrimary, modifier = Modifier.size(15.dp))
                Text(it, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.textPrimary, style = TextStyle(fontFeatureSettings = "tnum"))
            }
            r.pilotPosition?.let { p ->
                Fmt.ageSeconds(now, Iso.parse(p.t) ?: Iso.parse(p.receivedAt))?.let { age ->
                    Text("· " + stringResource(R.string.pos_age_acc, ageText(age), Fmt.accuracy(p.hAccM)), fontSize = 12.sp, color = c.textSecondary)
                }
            }
        }
        if (r.note.isNotBlank()) NoteLine(r.note)
        if (phone.isBlank()) Text(stringResource(R.string.no_phone_pilot), fontSize = 12.sp, color = c.textSecondary)
        if (!picked) {
            PrimaryButton(stringResource(R.string.picked_up), { vm.pickedUp(r) }, busy = busy, icon = Lucide.Armchair)
            TextAction(stringResource(R.string.release_long), { confirmRelease = true }, Modifier.fillMaxWidth(), color = c.error)
        } else {
            PrimaryButton(stringResource(R.string.deliver), { showDeliver = true }, busy = busy, icon = Lucide.CircleCheck)
        }
    }
    if (confirmRelease) {
        ConfirmDialog(
            title = stringResource(R.string.release_q), message = stringResource(R.string.release_confirm), confirm = stringResource(R.string.release),
            onConfirm = { confirmRelease = false; vm.release(r) }, onDismiss = { confirmRelease = false }, destructive = true,
        )
    }
    if (showDeliver) {
        var note by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showDeliver = false },
            containerColor = c.surface,
            shape = RoundedCornerShape(AeroTokens.Radius.lg.dp),
            title = { Text(stringResource(R.string.deliver), fontWeight = FontWeight.SemiBold, fontSize = 20.sp, color = c.textPrimary) },
            text = { AeroTextField(note, { note = it }, stringResource(R.string.delivery_hint), singleLine = false, minLines = 2, background = c.surfaceElevated) },
            confirmButton = { TextButton({ showDeliver = false; vm.delivered(r, note) }) { Text(stringResource(R.string.delivered_mark), color = c.primary, fontWeight = FontWeight.SemiBold) } },
            dismissButton = { TextButton({ showDeliver = false }) { Text(stringResource(R.string.cancel), color = c.textSecondary) } },
        )
    }
}

// ---------------------------------------------------------------- observer / organizer overview

@Composable
fun OverviewSheet(event: Event, ui: EventUi, imperial: Boolean) {
    val c = Aero.colors
    val live = ui.live
    val pilots = live?.pilots.orEmpty()
    val open = live?.retrievals?.filter { RetrievalStatus.isOpen(it.status) }.orEmpty()
    val onDuty = live?.retrievers?.count { it.onDuty } ?: 0
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Counter(stringResource(R.string.obs_live), pilots.count { it.freshness == "live" }, Lucide.Radio, Tone.Active, Modifier.weight(1f))
        Counter(stringResource(R.string.obs_stale), pilots.count { it.freshness == "stale" }, Lucide.ClockAlert, Tone.Warning, Modifier.weight(1f))
        Counter(stringResource(R.string.obs_lost), pilots.count { it.freshness == "lost" }, Lucide.WifiOff, Tone.Error, Modifier.weight(1f))
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Counter(stringResource(R.string.obs_open), open.size, Lucide.Hand, Tone.Warning, Modifier.weight(1f))
        Counter(stringResource(R.string.obs_duty), onDuty, Lucide.Car, Tone.Info, Modifier.weight(1f))
    }
    if (pilots.isNotEmpty()) {
        AeroCard {
            Caption(stringResource(R.string.pilots_in_air))
            pilots.sortedBy { it.pilot.fullName }.forEachIndexed { i, p ->
                if (i > 0) RowDivider()
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text(p.pilot.fullName, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.textPrimary)
                        p.position?.let {
                            Text("${Fmt.altitude(it.gpsAltM, imperial)} · ${Fmt.speedValue(it.speedMs, imperial)} ${Fmt.speedUnit(imperial)}", fontSize = 12.sp, color = c.textSecondary)
                        }
                    }
                    if (p.isSimulated) SimBadge()
                    FreshnessBadge(p.freshness)
                }
            }
        }
    }
    if (open.isNotEmpty()) {
        AeroCard {
            Caption(stringResource(R.string.retrieves))
            open.forEachIndexed { i, r ->
                if (i > 0) RowDivider()
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text(r.pilot?.fullName.orEmpty(), fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.textPrimary)
                        Text(r.retriever?.fullName?.let { stringResource(R.string.retriever_is, it) } ?: stringResource(R.string.no_retriever_yet), fontSize = 12.sp, color = c.textSecondary)
                    }
                    StatusPill(retrievalStatusLabel(r.status), retrievalTone(r.status), Lucide.Car)
                }
            }
        }
    }
    if (pilots.isEmpty() && open.isEmpty()) EmptyState(Lucide.Plane, stringResource(R.string.no_live_pilots))
}

@Composable
private fun Counter(title: String, n: Int, icon: ImageVector, tone: Tone, modifier: Modifier) {
    val c = Aero.colors
    Column(modifier.clip(RoundedCornerShape(AeroTokens.Radius.md.dp)).background(c.surface).padding(10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(icon, null, tint = tone.color(), modifier = Modifier.size(16.dp))
            Text("$n", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = tone.color(), style = TextStyle(fontFeatureSettings = "tnum"))
        }
        Text(title, fontSize = 12.sp, color = c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

// ---------------------------------------------------------------- organizer tools

@Composable
fun OrganizerTools(event: Event, ui: EventUi, vm: EventViewModel) {
    val c = Aero.colors
    val ctx = LocalContext.current
    var tab by rememberSaveable { mutableStateOf(0) }
    val pending = ui.applications.size.takeIf { it > 0 } ?: event.counts.pendingApplications ?: 0
    AeroCard(spacing = 0.dp) {
        Caption(stringResource(R.string.org_title), Modifier.padding(bottom = 6.dp))
        OrgRow(Lucide.Inbox, stringResource(R.string.applications, ui.applications.size).substringBefore(" ("), tab == 1, {
            if (pending > 0) StatusPill(stringResource(R.string.org_waiting, pending), Tone.Warning, Lucide.Clock)
        }) { tab = if (tab == 1) 0 else 1 }
        if (tab == 1) {
            Column(Modifier.padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (ui.applications.isEmpty()) Text(stringResource(R.string.no_applications), fontSize = 14.sp, color = c.textSecondary)
                ui.applications.forEach { app -> ApplicationRow(app, ui.busy, vm) }
            }
        }
        RowDivider()
        OrgRow(Lucide.Users, stringResource(R.string.members), tab == 2, {}) { tab = if (tab == 2) 0 else 2 }
        if (tab == 2) {
            Column(Modifier.padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Roles.ALL.forEach { role ->
                    val list = ui.members.filter { it.role == role }
                    if (list.isNotEmpty()) {
                        Text("${roleLabel(role)} (${list.size})", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.textSecondary, modifier = Modifier.padding(top = 6.dp))
                        list.forEach { m ->
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Avatar(m.fullName, 32.dp)
                                Column(Modifier.weight(1f)) {
                                    Text(m.fullName, fontSize = 15.sp, color = c.textPrimary)
                                    if (m.isOrganizer) Text(stringResource(R.string.role_organizer), fontSize = 12.sp, color = c.textSecondary)
                                }
                                if (m.phone.isNotBlank()) RoundIconButton(Lucide.Phone, stringResource(R.string.call), { dial(ctx, m.phone) }, tint = c.success, size = 36.dp)
                            }
                        }
                    }
                }
                ui.members.filter { it.role == null && it.isOrganizer }.takeIf { it.isNotEmpty() }?.let { orgs ->
                    Text(stringResource(R.string.role_organizer), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.textSecondary, modifier = Modifier.padding(top = 6.dp))
                    orgs.forEach { Text(it.fullName, fontSize = 15.sp, color = c.textPrimary) }
                }
            }
        }
        Text(stringResource(R.string.org_web_note), fontSize = 12.sp, color = c.textSecondary, modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable
private fun OrgRow(icon: ImageVector, title: String, open: Boolean, trailing: @Composable () -> Unit, onClick: () -> Unit) {
    val c = Aero.colors
    Row(
        Modifier.fillMaxWidth().heightIn(min = 50.dp).clickable(role = Role.Button, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, null, tint = c.primary, modifier = Modifier.size(19.dp))
        Text(title, Modifier.weight(1f), fontSize = 16.sp, color = c.textPrimary)
        trailing()
        Icon(if (open) Lucide.ChevronUp else Lucide.ChevronDown, null, tint = c.textMuted, modifier = Modifier.size(18.dp))
    }
}

/** Approving requires an explicit role: nothing is preselected. */
@Composable
private fun ApplicationRow(app: Application, busy: Boolean, vm: EventViewModel) {
    val c = Aero.colors
    var role by remember(app.id) { mutableStateOf<String?>(null) }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(AeroTokens.Radius.md.dp)).background(c.surfaceElevated).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Avatar(app.user.fullName, 36.dp)
            Column(Modifier.weight(1f)) {
                Text(app.user.fullName.ifBlank { "—" }, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
                if (app.user.email.isNotBlank()) Text(app.user.email, fontSize = 12.sp, color = c.textSecondary)
            }
        }
        if (app.message.isNotBlank()) Text("“${app.message}”", fontSize = 14.sp, color = c.textSecondary)
        Text(stringResource(R.string.choose_role), fontSize = 12.sp, color = c.textMuted)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Roles.ALL.forEach { r ->
                val on = role == r
                Text(
                    roleLabel(r),
                    Modifier.weight(1f).clip(CircleShape).background(if (on) c.primary else c.surface).clickable(role = Role.RadioButton) { role = r }
                        .padding(vertical = 8.dp),
                    color = if (on) c.onPrimary else c.textPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center, maxLines = 1,
                )
            }
        }
        role?.let { Text(roleExplain(it), fontSize = 12.sp, color = c.textSecondary) }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PrimaryButton(stringResource(R.string.approve), { role?.let { vm.approve(app, it) } }, Modifier.weight(1f), enabled = role != null && !busy)
            SecondaryButton(stringResource(R.string.reject), { vm.reject(app) }, Modifier.weight(1f), enabled = !busy, destructive = true)
        }
    }
}
