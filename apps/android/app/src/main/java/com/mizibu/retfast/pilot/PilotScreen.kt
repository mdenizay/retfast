package com.mizibu.retfast.pilot

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.mizibu.retfast.core.TaskRow
import com.mizibu.retfast.ui.BigButton
import com.mizibu.retfast.ui.Hit
import com.mizibu.retfast.ui.Readout
import com.mizibu.retfast.ui.RetfastAmber
import kotlin.math.roundToInt

/**
 * In-flight screen. The HUD carries every number the operation cares about —
 * altitude, ground speed, heading, GPS accuracy, battery and the upload queue —
 * and the actions are sized for gloves.
 */
@Composable
fun PilotScreen(
    vm: PilotViewModel,
    existingTask: TaskRow?,
    onExit: () -> Unit,
) {
    val context = LocalContext.current
    val state by vm.state.collectAsState()
    val tracking by vm.tracking.collectAsState()
    val pending by vm.pending.collectAsState()
    val syncError by vm.syncError.collectAsState()
    var showCancel by remember { mutableStateOf(false) }
    var cancelReason by remember { mutableStateOf("") }
    var sosArmed by remember { mutableStateOf(false) }
    var showPicker by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.attach(context, existingTask) }

    val open = state.task?.status == "active" || state.task?.status == "landed"

    Column(Modifier.fillMaxSize().padding(12.dp)) {
        // Status
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onExit) { Text("‹ Geri") }
            Spacer(Modifier.weight(1f))
            val (color, label) = when {
                !open -> Color.Gray to "Takip kapalı"
                !tracking.tracking -> Color.Red to "TAKİP DURDU"
                System.currentTimeMillis() - tracking.lastFixAtMs > 30_000 -> RetfastAmber to "GPS eski"
                else -> Color(0xFF16A34A) to "Canlı"
            }
            Box(Modifier.size(10.dp).clip(CircleShape).background(color))
            Spacer(Modifier.size(6.dp))
            Text(label, style = MaterialTheme.typography.labelLarge)
        }

        Spacer(Modifier.size(8.dp))

        // Telemetry
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                val loc = tracking.lastLocation
                Row(Modifier.fillMaxWidth()) {
                    Readout("YÜKSEKLİK", loc?.altitude?.roundToInt()?.toString() ?: "—", "m", modifier = Modifier.weight(1f))
                    Readout(
                        "HIZ",
                        loc?.takeIf { it.hasSpeed() }?.let { (it.speed * 3.6f).roundToInt().toString() } ?: "—",
                        "km/h",
                        modifier = Modifier.weight(1f),
                    )
                    Readout(
                        "YÖN",
                        loc?.takeIf { it.hasBearing() }?.let { "${it.bearing.roundToInt()}°" } ?: "—",
                        modifier = Modifier.weight(1f),
                    )
                }
                Row(Modifier.fillMaxWidth()) {
                    Readout(
                        "HASSASİYET",
                        loc?.let { "±${it.accuracy.roundToInt()}" } ?: "—",
                        "m",
                        tint = if ((loc?.accuracy ?: 0f) > 50f) Color(0xFFF59E0B) else null,
                        modifier = Modifier.weight(1f),
                    )
                    Readout(
                        "BATARYA",
                        tracking.batteryPercent.takeIf { it >= 0 }?.toString() ?: "—",
                        "%",
                        tint = if (tracking.batteryPercent in 0..20) Color.Red else null,
                        modifier = Modifier.weight(1f),
                    )
                    Readout(
                        "KUYRUK",
                        pending.toString(),
                        tint = if (pending > 200) Color(0xFFF59E0B) else null,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }

        state.error?.let {
            Spacer(Modifier.size(8.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        if (pending > 0 && syncError != null) {
            Spacer(Modifier.size(8.dp))
            Text(
                "Yükleme hatası ($pending nokta bekliyor): $syncError",
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        if (state.sosDelivered == false) {
            Spacer(Modifier.size(8.dp))
            Text("SOS henüz İLETİLEMEDİ — tekrar deneniyor", color = MaterialTheme.colorScheme.error)
        }
        state.assignment?.let {
            Spacer(Modifier.size(8.dp))
            Text("Toplayıcı: ${assignmentLabel(it.status)}", style = MaterialTheme.typography.titleSmall)
        }
        if (state.assignment == null && state.request?.status == "pending") {
            Spacer(Modifier.size(8.dp))
            Text("Toplayıcı bekleniyor…", style = MaterialTheme.typography.titleSmall)
        }

        Spacer(Modifier.weight(1f))

        // Controls
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (state.task == null) {
                BigButton(
                    "Uçuşu başlat",
                    Modifier.fillMaxWidth(),
                    height = Hit.critical,
                    onClick = { vm.startTask(context) },
                )
            } else if (open) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (state.task?.status == "active") {
                        BigButton(
                            "İndim",
                            Modifier.weight(1f),
                            height = Hit.critical,
                            container = RetfastAmber,
                            content = Color(0xFF0D0E10),
                            onClick = { vm.transition(context, "landed") },
                        )
                    } else {
                        BigButton(
                            "Toplayıcı iste",
                            Modifier.weight(1f),
                            height = Hit.critical,
                            container = Color(0xFF16A34A),
                            onClick = { showPicker = true; vm.loadNearby() },
                        )
                    }
                    BigButton(
                        "Bitir",
                        Modifier.weight(1f),
                        height = Hit.critical,
                        container = MaterialTheme.colorScheme.secondaryContainer,
                        content = MaterialTheme.colorScheme.onSecondaryContainer,
                        onClick = { vm.transition(context, "finish"); onExit() },
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    BigButton(
                        "İptal et",
                        Modifier.weight(1f),
                        container = MaterialTheme.colorScheme.secondaryContainer,
                        content = MaterialTheme.colorScheme.onSecondaryContainer,
                        onClick = { showCancel = true },
                    )
                    BigButton(
                        if (sosArmed) "SOS ONAYLA" else "SOS",
                        Modifier.weight(1f),
                        container = Color(0xFFDC2626),
                        onClick = {
                            if (sosArmed) {
                                sosArmed = false
                                vm.raiseSos(context)
                            } else {
                                sosArmed = true
                            }
                        },
                    )
                }
            }
        }
    }

    if (showCancel) {
        AlertDialog(
            onDismissRequest = { showCancel = false },
            title = { Text("Uçuş iptal edilsin mi?") },
            text = {
                OutlinedTextField(
                    value = cancelReason,
                    onValueChange = { cancelReason = it },
                    label = { Text("Sebep") },
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showCancel = false
                    vm.transition(context, "cancel", cancelReason)
                    onExit()
                }) { Text("İptal et") }
            },
            dismissButton = { TextButton(onClick = { showCancel = false }) { Text("Geri") } },
        )
    }

    if (showPicker) {
        AlertDialog(
            onDismissRequest = { showPicker = false },
            title = { Text("Yakındaki toplayıcılar") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (state.nearby.isEmpty()) Text("Yakında müsait toplayıcı yok.")
                    state.nearby.forEach { r ->
                        BigButton(
                            "${r.displayName} · ${(r.distanceM / 1000).roundToInt()} km · ${r.vehicleCapacity - r.occupiedSeats} boş",
                            Modifier.fillMaxWidth(),
                            container = MaterialTheme.colorScheme.secondaryContainer,
                            content = MaterialTheme.colorScheme.onSecondaryContainer,
                            onClick = {
                                vm.requestRetrieval(r.userId)
                                showPicker = false
                            },
                        )
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showPicker = false }) { Text("Kapat") } },
        )
    }
}

private fun assignmentLabel(status: String) = when (status) {
    "assigned" -> "atandı"
    "en_route" -> "yolda"
    "picked_up" -> "araca alındın"
    "delivered" -> "teslim edildi"
    "completed" -> "tamamlandı"
    else -> status
}
