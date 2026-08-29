package com.mizibu.retfast.retriever

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.mizibu.retfast.ui.BigButton
import com.mizibu.retfast.ui.Hit
import com.mizibu.retfast.ui.RetfastAmber
import com.mizibu.retfast.ui.RetfastMuted
import com.mizibu.retfast.ui.RetfastSuccess
import com.mizibu.retfast.ui.ScreenTitle
import com.mizibu.retfast.ui.StatusPill
import kotlinx.coroutines.delay
import java.time.Instant

/** Retriever duty: availability toggle, the 60 s offer, and the job workflow. */
@Composable
fun RetrieverScreen(vm: RetrieverViewModel, onExit: () -> Unit) {
    val context = LocalContext.current
    val state by vm.state.collectAsState()
    val pending by vm.pending.collectAsState()
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }

    LaunchedEffect(Unit) { vm.attach(context) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1000)
        }
    }

    Column(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onExit) { Text("‹ Geri") }
            Spacer(Modifier.weight(1f))
            StatusPill(if (state.onDuty) "Görevde" else "Çevrimdışı", if (state.onDuty) RetfastSuccess else RetfastMuted)
        }

        ScreenTitle(
            kicker = "Toplayıcı görev merkezi",
            title = if (state.assignments.isEmpty()) "Yeni görev bekleniyor" else "${state.assignments.size} aktif görev",
            subtitle = "Pilot tekliflerini, araç kapasitesini ve görev adımlarını buradan yönet.",
            modifier = Modifier.padding(horizontal = 4.dp, vertical = 4.dp),
        )

        Card(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.extraLarge) {
            Row(
                Modifier.fillMaxWidth().padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("OPERASYON DURUMU", color = RetfastAmber, style = MaterialTheme.typography.labelSmall)
                    Text(if (state.onDuty) "Tekliflere açığım" else "Görev dışıyım", style = MaterialTheme.typography.titleMedium)
                    state.profile?.let {
                        Text(
                            "${it.occupiedSeats}/${it.vehicleCapacity} koltuk · ${it.vehicleDescription}",
                            style = MaterialTheme.typography.bodySmall,
                            color = RetfastMuted,
                        )
                    }
                }
                Switch(checked = state.onDuty, onCheckedChange = { vm.toggleDuty(context) })
            }
        }

        state.error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }

        // Incoming 60 s offer
        state.pendingRequest?.let { req ->
            val remaining = remainingSeconds(req.expiresAt, now)
            Card(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.extraLarge) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("YENİ TOPLAMA TEKLİFİ", color = RetfastAmber, style = MaterialTheme.typography.labelSmall)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            state.pilotNames[req.pilotId] ?: "Pilot",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Spacer(Modifier.weight(1f))
                        Text(
                            "${remaining}s",
                            style = MaterialTheme.typography.headlineSmall,
                            color = if (remaining <= 10) Color.Red else RetfastAmber,
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        BigButton(
                            "Kabul et",
                            Modifier.weight(1f),
                            height = Hit.critical,
                            container = Color(0xFF16A34A),
                            onClick = { vm.respond(req, true) },
                        )
                        BigButton(
                            "Reddet",
                            Modifier.weight(1f),
                            height = Hit.critical,
                            container = MaterialTheme.colorScheme.secondaryContainer,
                            content = MaterialTheme.colorScheme.onSecondaryContainer,
                            onClick = { vm.respond(req, false) },
                        )
                    }
                }
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Görev akışı", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.weight(1f))
            Text("Senkron $pending", color = RetfastMuted, style = MaterialTheme.typography.labelMedium)
        }
        if (state.assignments.isEmpty()) {
            Text("Aktif iş yok", style = MaterialTheme.typography.bodyMedium)
        }
        state.assignments.forEach { a ->
            Card(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.extraLarge) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("AKTİF GÖREV", color = RetfastAmber, style = MaterialTheme.typography.labelSmall)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            state.pilotNames[a.pilotId] ?: "Pilot",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Spacer(Modifier.weight(1f))
                        Text(statusLabel(a.status), style = MaterialTheme.typography.labelLarge)
                    }
                    state.pilotPins[a.taskId]?.let { (lat, lng) ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            BigButton(
                                "Haritada aç",
                                Modifier.weight(1f),
                                height = Hit.min,
                                container = MaterialTheme.colorScheme.secondaryContainer,
                                content = MaterialTheme.colorScheme.onSecondaryContainer,
                                onClick = { navigateTo(context, lat, lng) },
                            )
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        nextActions(a.status).forEach { action ->
                            BigButton(
                                actionLabel(action),
                                Modifier.weight(1f),
                                container = if (action == "cancel") {
                                    MaterialTheme.colorScheme.secondaryContainer
                                } else {
                                    MaterialTheme.colorScheme.primary
                                },
                                content = if (action == "cancel") {
                                    MaterialTheme.colorScheme.onSecondaryContainer
                                } else {
                                    MaterialTheme.colorScheme.onPrimary
                                },
                                onClick = { vm.advance(a, action) },
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun remainingSeconds(expiresAt: String, nowMs: Long): Long = runCatching {
    ((Instant.parse(expiresAt).toEpochMilli() - nowMs) / 1000).coerceAtLeast(0)
}.getOrDefault(0)

/** Hand the pilot's coordinates to whichever navigation app the driver has. */
private fun navigateTo(context: Context, lat: Double, lng: Double) {
    val uri = Uri.parse("geo:$lat,$lng?q=$lat,$lng(Pilot)")
    val intent = Intent(Intent.ACTION_VIEW, uri)
    if (intent.resolveActivity(context.packageManager) != null) {
        context.startActivity(intent)
    }
}

private fun nextActions(status: String) = when (status) {
    "assigned" -> listOf("en_route", "cancel")
    "en_route" -> listOf("picked_up", "cancel")
    "picked_up" -> listOf("delivered")
    "delivered" -> listOf("completed")
    else -> emptyList()
}

private fun actionLabel(a: String) = when (a) {
    "en_route" -> "Yola çıktım"
    "picked_up" -> "Pilotu aldım"
    "delivered" -> "Teslim ettim"
    "completed" -> "Tamamla"
    else -> "İptal"
}

private fun statusLabel(s: String) = when (s) {
    "assigned" -> "Atandı"
    "en_route" -> "Yolda"
    "picked_up" -> "Alındı"
    "delivered" -> "Teslim edildi"
    else -> s
}
