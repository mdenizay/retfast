package com.mizibu.retfast.ui.events

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
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
import com.mizibu.retfast.retrieval.RetrievalStage
import com.mizibu.retfast.retrieval.SharingMode
import com.mizibu.retfast.retrieval.stage
import com.mizibu.retfast.sync.SyncSnapshot
import com.mizibu.retfast.tracking.TrackingStatus
import com.mizibu.retfast.ui.common.AeroCard
import com.mizibu.retfast.ui.common.Banner
import com.mizibu.retfast.ui.common.BannerKind
import com.mizibu.retfast.ui.common.Fmt
import com.mizibu.retfast.ui.common.FreshnessBadge
import com.mizibu.retfast.ui.common.InstrumentTile
import com.mizibu.retfast.ui.common.PrimaryButton
import com.mizibu.retfast.ui.common.SecondaryButton
import com.mizibu.retfast.ui.common.SectionTitle
import com.mizibu.retfast.ui.common.SimBadge
import com.mizibu.retfast.ui.common.StatusPill
import com.mizibu.retfast.ui.common.SyncBadge
import com.mizibu.retfast.ui.common.rememberPermState
import com.mizibu.retfast.ui.flight.EndFlightDialog
import com.mizibu.retfast.ui.theme.Aero
import com.mizibu.retfast.util.Geo
import com.mizibu.retfast.util.Iso
import kotlinx.coroutines.delay

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
private fun nowTicker(periodMs: Long = 1000): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(periodMs); now = System.currentTimeMillis() } }
    return now
}

@Composable
fun EventHeader(event: Event) {
    val c = Aero.colors
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            StatusPill(statusLabel(event.status), if (event.status == "active") c.trackingActive else c.offline)
            event.memberRole?.let { StatusPill(roleLabel(it), c.secondary, Icons.Filled.CheckCircle) }
            if (event.isOrganizer) StatusPill(stringResource(R.string.role_organizer), c.retrieval, Icons.Filled.CheckCircle)
            if (event.isDemo) StatusPill("DEMO", c.warning)
        }
        Text(event.name, style = MaterialTheme.typography.titleLarge)
        if (event.locationName.isNotBlank()) Text(event.locationName, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (event.center != null && event.centerIsApproximate) Text(stringResource(R.string.center_approx), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun statusLabel(s: String) = when (s) {
    "draft" -> stringResource(R.string.status_draft)
    "published" -> stringResource(R.string.status_published)
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

// ---------------------------------------------------------------- not a member

@Composable
fun NotMemberSheet(event: Event, state: ApplicationState, busy: Boolean, vm: EventViewModel) {
    var message by remember { mutableStateOf("") }
    if (event.description.isNotBlank()) Text(event.description, style = MaterialTheme.typography.bodyMedium)
    val c = Aero.colors
    when (state) {
        is ApplicationState.Pending -> {
            StatusPill(stringResource(R.string.app_pending), c.warning, Icons.Filled.Info)
            Text(stringResource(R.string.app_pending_body), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            SecondaryButton(stringResource(R.string.withdraw), { vm.withdrawApplication(state.id) }, enabled = !busy)
        }
        ApplicationState.Closed -> Banner(stringResource(R.string.apps_closed), BannerKind.Info)
        else -> {
            val note = when (state) {
                is ApplicationState.Rejected -> stringResource(R.string.app_rejected)
                is ApplicationState.Withdrawn -> stringResource(R.string.app_withdrawn)
                else -> null
            }
            val canApply = when (state) {
                ApplicationState.CanApply -> true
                is ApplicationState.Rejected -> state.canReapply
                is ApplicationState.Withdrawn -> state.canReapply
                else -> false
            }
            note?.let { Banner(it, BannerKind.Warning) }
            if (canApply) {
                // No role choice here: the organizer picks the role when approving.
                Text(stringResource(R.string.apply_explain), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(message, { message = it }, label = { Text(stringResource(R.string.apply_message)) }, modifier = Modifier.fillMaxWidth(), minLines = 2, maxLines = 4)
                PrimaryButton(stringResource(R.string.apply), { vm.applyToEvent(message) }, busy = busy, large = true)
            } else if (note != null) Banner(stringResource(R.string.apps_closed), BannerKind.Info)
        }
    }
}

// ---------------------------------------------------------------- pilot

@Composable
fun PilotSheet(
    event: Event,
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
    val perm by rememberPermState()
    val online by g.online.collectAsStateWithLifecycle()
    var showNotice by remember { mutableStateOf(false) }
    var showEnd by remember { mutableStateOf(false) }
    val recordingHere = status.recording && status.eventId == event.id.lowercase()
    val now = nowTicker()

    when {
        activeLocal != null -> {
            RetrievalCard(activeLocal)
            PrimaryButton(stringResource(R.string.open_waiting), { onOpenWaiting(activeLocal.id) }, large = true)
        }
        recordingHere -> {
            AeroCard {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StatusPill(stringResource(R.string.recording), Aero.colors.trackingActive, Icons.Filled.CheckCircle)
                    SyncBadge(sync)
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    InstrumentTile(stringResource(R.string.duration), Fmt.duration(((now - (status.startedAt ?: now)) / 1000)), "")
                    InstrumentTile(stringResource(R.string.gps_alt), Fmt.altitudeValue(status.values.gpsAltitude, imperial), Fmt.altitudeUnit(imperial))
                    InstrumentTile(stringResource(R.string.ground_speed), Fmt.speedValue(status.values.groundSpeed, imperial), Fmt.speedUnit(imperial))
                }
                if (!perm.background) Banner(stringResource(R.string.bg_missing_warning), BannerKind.Warning)
            }
            PrimaryButton(stringResource(R.string.flight_computer), onOpenComputer, large = true)
            SecondaryButton(stringResource(R.string.end_flight), { showEnd = true })
        }
        status.recording -> Banner(stringResource(R.string.notice_flight_elsewhere), BannerKind.Warning)
        else -> {
            AeroCard {
                Text(stringResource(R.string.readiness), style = MaterialTheme.typography.titleMedium)
                ReadinessRow(stringResource(R.string.rd_location), perm.fine, if (perm.coarseOnly) stringResource(R.string.rd_precise_needed) else null)
                ReadinessRow(stringResource(R.string.rd_background), perm.background, stringResource(R.string.rd_background_hint), required = false)
                ReadinessRow(stringResource(R.string.rd_gps), perm.gpsEnabled)
                ReadinessRow(stringResource(R.string.rd_notifications), perm.notifications, stringResource(R.string.rd_notifications_hint), required = false)
                ReadinessRow(stringResource(R.string.rd_battery_opt), perm.batteryExempt, stringResource(R.string.rd_battery_opt_hint), required = false)
                ReadinessRow(stringResource(R.string.rd_network), online, if (!online) stringResource(R.string.rd_offline_ok) else null, required = false)
                ReadinessRow(
                    stringResource(R.string.rd_power), !perm.powerSave,
                    if (perm.powerSave) stringResource(R.string.rd_power_save) else null, required = false,
                )
                if (sync.pendingCount > 0) ReadinessRow(stringResource(R.string.rd_unsent, sync.pendingCount), false, null, required = false)
                Text(stringResource(R.string.rd_killer_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (!perm.ready) SecondaryButton(stringResource(R.string.set_permissions), onOpenPermissions)
            }
            if (!event.settings.liveTracking) Banner(stringResource(R.string.live_tracking_off), BannerKind.Warning)
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
            )
            SecondaryButton(stringResource(R.string.retrieve_without_flight), onRetrieve)
        }
    }

    if (showNotice) {
        AlertDialog(
            onDismissRequest = { showNotice = false },
            title = { Text(stringResource(R.string.sharing_notice_title)) },
            text = { Text(stringResource(R.string.sharing_notice_body)) },
            confirmButton = {
                TextButton({ g.prefs.ackSharingNotice(event.id); showNotice = false; vm.startFlight { onOpenComputer() } }) { Text(stringResource(R.string.understood_start)) }
            },
            dismissButton = { TextButton({ showNotice = false }) { Text(stringResource(R.string.cancel)) } },
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
private fun ReadinessRow(label: String, ok: Boolean, hint: String? = null, required: Boolean = true) {
    val c = Aero.colors
    Column {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            StatusPill(
                stringResource(if (ok) R.string.ok else if (required) R.string.needed else R.string.recommended),
                if (ok) c.success else if (required) c.error else c.warning,
                if (ok) Icons.Filled.CheckCircle else Icons.Filled.Warning,
            )
        }
        if (hint != null && !ok) Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun RetrievalCard(r: RetrievalEntity) {
    val c = Aero.colors
    val stage = r.stage
    AeroCard {
        val (text, color) = when (stage) {
            RetrievalStage.SAVED_LOCALLY -> stringResource(R.string.st_saved) to c.warning
            RetrievalStage.SENDING -> stringResource(R.string.st_sending) to c.warning
            RetrievalStage.REQUESTED -> stringResource(R.string.st_requested) to c.retrieval
            RetrievalStage.ACCEPTED -> stringResource(R.string.st_accepted) to c.retrieval
            RetrievalStage.PICKED_UP -> stringResource(R.string.st_picked_up) to c.retrieval
            RetrievalStage.DELIVERED -> stringResource(R.string.st_delivered) to c.success
            RetrievalStage.CANCELLING -> stringResource(R.string.st_cancelling) to c.warning
            RetrievalStage.CANCELLED -> stringResource(R.string.st_cancelled) to c.offline
            RetrievalStage.REFUSED -> stringResource(R.string.st_refused) to c.error
            RetrievalStage.MERGED -> stringResource(R.string.st_merged) to c.offline
        }
        Text(stringResource(R.string.retrieve_title), style = MaterialTheme.typography.titleMedium)
        StatusPill(text, color)
    }
}

// ---------------------------------------------------------------- retriever

@Composable
fun RetrieverSheet(event: Event, ui: EventUi, vm: EventViewModel, status: TrackingStatus, imperial: Boolean, onOpenPermissions: () -> Unit) {
    val ctx = LocalContext.current
    val perm by rememberPermState()
    val duty = status.duty?.takeIf { it.eventId == event.id }
    val onDuty = duty?.onDuty == true
    val now = nowTicker(5000)
    val myId = vm.myId
    val all = ui.live?.retrievals.orEmpty()
    val mine = all.filter { it.retriever?.userId == myId && (it.status == RetrievalStatus.ACCEPTED || it.status == RetrievalStatus.PICKED_UP) }
    val open = all.filter { it.status == RetrievalStatus.REQUESTED }.sortedBy { Iso.parse(it.requestedAt) ?: 0L }
    val me = ui.myPos ?: status.values.lat?.let { status.values.lon?.let { lo -> status.values.lat to lo } }
    var deliverTarget by remember { mutableStateOf<Retrieval?>(null) }
    var releaseTarget by remember { mutableStateOf<Retrieval?>(null) }

    AeroCard {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.on_duty), style = MaterialTheme.typography.titleMedium)
                Text(
                    if (status.sharing is SharingMode.Retriever) {
                        val age = Fmt.ageSeconds(now, status.lastShareAt)
                        stringResource(R.string.duty_sharing, age?.toString() ?: "—")
                    } else stringResource(R.string.duty_not_sharing),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(onDuty, { on -> if (on && !perm.canRecord) onOpenPermissions() else vm.setDuty(on) }, enabled = !ui.busy)
        }
        if (onDuty && !perm.background) Banner(stringResource(R.string.bg_missing_warning), BannerKind.Warning)
        if (status.shareFailures > 0 && status.lastShareError != null) Banner(stringResource(R.string.share_failing, status.lastShareError ?: ""), BannerKind.Warning)
    }

    SectionTitle(stringResource(R.string.my_pickups, mine.size))
    if (mine.isEmpty()) Text(stringResource(R.string.no_pickups), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    mine.forEach { r ->
        val pos = r.pilotPosition?.let { it.lat to it.lon } ?: r.pickup?.let { it.lat to it.lon }
        AeroCard {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(r.pilot?.fullName.orEmpty(), style = MaterialTheme.typography.titleMedium)
                if (r.isSimulated) SimBadge()
            }
            if (pos != null && me?.first != null) Text(
                stringResource(R.string.distance_to_pilot, Fmt.distance(Geo.distance(me.first!!, me.second, pos.first, pos.second), imperial)),
                style = MaterialTheme.typography.bodyMedium,
            )
            r.pilotPosition?.let { p ->
                val age = Fmt.ageSeconds(now, Iso.parse(p.t) ?: Iso.parse(p.receivedAt))
                Text(stringResource(R.string.pilot_pos_age, age?.toString() ?: "—", Fmt.accuracy(p.hAccM)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (r.note.isNotBlank()) Text("“${r.note}”", style = MaterialTheme.typography.bodyMedium)
            StatusPill(if (r.status == RetrievalStatus.PICKED_UP) stringResource(R.string.st_picked_up_short) else stringResource(R.string.st_accepted_short), Aero.colors.retrieval)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                val phone = r.pilot?.phone.orEmpty()
                SecondaryButton(stringResource(R.string.call), { dial(ctx, phone) }, Modifier.weight(1f), enabled = phone.isNotBlank())
                SecondaryButton(stringResource(R.string.navigate), { pos?.let { navigateTo(ctx, it.first, it.second, r.pilot?.fullName ?: "Pilot") } }, Modifier.weight(1f), enabled = pos != null)
            }
            if (r.status == RetrievalStatus.ACCEPTED) PrimaryButton(stringResource(R.string.picked_up), { vm.pickedUp(r) }, busy = ui.busy)
            if (r.status == RetrievalStatus.PICKED_UP) PrimaryButton(stringResource(R.string.deliver), { deliverTarget = r }, busy = ui.busy)
            SecondaryButton(stringResource(R.string.release), { releaseTarget = r }, destructive = true)
        }
    }

    SectionTitle(stringResource(R.string.open_requests, open.size))
    if (open.isEmpty()) Text(stringResource(R.string.no_open_requests), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    open.forEach { r ->
        val pos = r.pilotPosition?.let { it.lat to it.lon } ?: r.pickup?.let { it.lat to it.lon }
        val waited = Fmt.ageSeconds(now, Iso.parse(r.requestedAt))
        AeroCard {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(r.pilot?.fullName.orEmpty(), style = MaterialTheme.typography.titleMedium)
                if (r.isSimulated) SimBadge()
            }
            Text(
                listOfNotNull(
                    waited?.let { stringResource(R.string.waiting_for, Fmt.duration(it)) },
                    if (pos != null && me?.first != null) Fmt.distance(Geo.distance(me.first!!, me.second, pos.first, pos.second), imperial) else null,
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (r.note.isNotBlank()) Text("“${r.note}”", style = MaterialTheme.typography.bodyMedium)
            PrimaryButton(stringResource(R.string.accept), { vm.accept(r) }, busy = ui.busy)
        }
    }

    deliverTarget?.let { r ->
        var note by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { deliverTarget = null },
            title = { Text(stringResource(R.string.deliver)) },
            text = { OutlinedTextField(note, { note = it }, label = { Text(stringResource(R.string.delivery_note)) }, modifier = Modifier.fillMaxWidth()) },
            confirmButton = { TextButton({ vm.delivered(r, note); deliverTarget = null }) { Text(stringResource(R.string.deliver)) } },
            dismissButton = { TextButton({ deliverTarget = null }) { Text(stringResource(R.string.cancel)) } },
        )
    }
    releaseTarget?.let { r ->
        AlertDialog(
            onDismissRequest = { releaseTarget = null },
            title = { Text(stringResource(R.string.release)) },
            text = { Text(stringResource(R.string.release_confirm)) },
            confirmButton = { TextButton({ vm.release(r); releaseTarget = null }) { Text(stringResource(R.string.release)) } },
            dismissButton = { TextButton({ releaseTarget = null }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

// ---------------------------------------------------------------- observer / organizer overview

@Composable
fun OverviewSheet(event: Event, ui: EventUi, imperial: Boolean) {
    val live = ui.live
    val pilots = live?.pilots.orEmpty()
    val open = live?.retrievals?.filter { RetrievalStatus.isOpen(it.status) }.orEmpty()
    val onDuty = live?.retrievers?.count { it.onDuty } ?: 0
    AeroCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Counter(pilots.count { it.freshness == "live" }.toString(), stringResource(R.string.cnt_live))
            Counter(pilots.count { it.freshness == "stale" }.toString(), stringResource(R.string.cnt_stale))
            Counter(pilots.count { it.freshness == "lost" }.toString(), stringResource(R.string.cnt_lost))
            Counter(open.size.toString(), stringResource(R.string.cnt_retrieves))
            Counter(onDuty.toString(), stringResource(R.string.cnt_retrievers))
        }
    }
    SectionTitle(stringResource(R.string.pilots_in_air))
    if (pilots.isEmpty()) Text(stringResource(R.string.no_live_pilots), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    pilots.forEach { p ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(p.pilot.fullName, style = MaterialTheme.typography.bodyLarge)
                p.position?.let { Text("${Fmt.altitude(it.gpsAltM, imperial)} · ${Fmt.speedValue(it.speedMs, imperial)} ${Fmt.speedUnit(imperial)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            if (p.isSimulated) SimBadge()
            FreshnessBadge(p.freshness)
        }
    }
    SectionTitle(stringResource(R.string.retrieves))
    if (open.isEmpty()) Text(stringResource(R.string.no_open_requests), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    open.forEach { r ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(r.pilot?.fullName.orEmpty(), style = MaterialTheme.typography.bodyLarge)
                Text(r.retriever?.fullName?.let { stringResource(R.string.retriever_is, it) } ?: stringResource(R.string.no_retriever_yet), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            StatusPill(retrievalStatusLabel(r.status), Aero.colors.retrieval)
        }
    }
    Text(stringResource(R.string.web_for_details), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
fun retrievalStatusLabel(s: String) = when (s) {
    RetrievalStatus.REQUESTED -> stringResource(R.string.st_requested)
    RetrievalStatus.ACCEPTED -> stringResource(R.string.st_accepted_short)
    RetrievalStatus.PICKED_UP -> stringResource(R.string.st_picked_up_short)
    RetrievalStatus.DELIVERED -> stringResource(R.string.st_delivered_short)
    else -> stringResource(R.string.st_cancelled)
}

@Composable
private fun Counter(value: String, label: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = MaterialTheme.typography.headlineMedium)
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// ---------------------------------------------------------------- organizer tools

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OrganizerTools(event: Event, ui: EventUi, vm: EventViewModel) {
    val ctx = LocalContext.current
    var tab by remember { mutableStateOf(0) }
    AeroCard {
        Text(stringResource(R.string.organizer_tools), style = MaterialTheme.typography.titleMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(tab == 1, { tab = if (tab == 1) 0 else 1 }, label = { Text(stringResource(R.string.applications, ui.applications.size)) })
            FilterChip(tab == 2, { tab = if (tab == 2) 0 else 2 }, label = { Text(stringResource(R.string.members)) })
        }
        if (tab == 1) {
            if (ui.applications.isEmpty()) Text(stringResource(R.string.no_applications), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            ui.applications.forEach { app -> ApplicationRow(app, ui.busy, vm) }
        }
        if (tab == 2) {
            Roles.ALL.forEach { role ->
                val list = ui.members.filter { it.role == role }
                if (list.isNotEmpty()) {
                    SectionTitle("${roleLabel(role)} (${list.size})")
                    list.forEach { m ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Text(m.fullName, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                            if (m.phone.isNotBlank()) TextButton({ dial(ctx, m.phone) }) { Text(m.phone) }
                        }
                    }
                }
            }
            ui.members.filter { it.role == null && it.isOrganizer }.takeIf { it.isNotEmpty() }?.let { orgs ->
                SectionTitle(stringResource(R.string.role_organizer))
                orgs.forEach { Text(it.fullName, style = MaterialTheme.typography.bodyLarge) }
            }
            Text(stringResource(R.string.web_for_details), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** Approving requires an explicit role: nothing is preselected. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ApplicationRow(app: Application, busy: Boolean, vm: EventViewModel) {
    var role by remember(app.id) { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(app.user.fullName, style = MaterialTheme.typography.titleSmall)
        Text(app.user.email, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (app.message.isNotBlank()) Text("“${app.message}”", style = MaterialTheme.typography.bodyMedium)
        Text(stringResource(R.string.choose_role), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Roles.ALL.forEach { r -> FilterChip(role == r, { role = r }, label = { Text(roleLabel(r)) }) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            PrimaryButton(stringResource(R.string.approve), { role?.let { vm.approve(app, it) } }, Modifier.weight(1f), enabled = role != null && !busy)
            SecondaryButton(stringResource(R.string.reject), { vm.reject(app) }, Modifier.weight(1f), enabled = !busy, destructive = true)
        }
    }
}

