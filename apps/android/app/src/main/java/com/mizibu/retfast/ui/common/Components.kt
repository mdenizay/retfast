package com.mizibu.retfast.ui.common

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mizibu.retfast.R
import com.mizibu.retfast.sync.SyncSnapshot
import com.mizibu.retfast.sync.SyncStatus
import com.mizibu.retfast.ui.theme.Aero
import com.mizibu.retfast.ui.theme.AeroTokens
import com.mizibu.retfast.ui.theme.Mono

@Composable
fun AeroCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(AeroTokens.Radius.lg.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Column(Modifier.padding(AeroTokens.Space.s4.dp), verticalArrangement = Arrangement.spacedBy(AeroTokens.Space.s2.dp), content = content)
    }
}

@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, large: Boolean = false, enabled: Boolean = true, busy: Boolean = false) {
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        modifier = modifier.fillMaxWidth().defaultMinSize(minHeight = (if (large) AeroTokens.Control.heightLarge else AeroTokens.Control.height).dp),
        shape = RoundedCornerShape(AeroTokens.Radius.md.dp),
        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary),
    ) {
        if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
        else Text(text, style = if (large) MaterialTheme.typography.titleMedium else MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, destructive: Boolean = false) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.fillMaxWidth().defaultMinSize(minHeight = AeroTokens.Control.height.dp),
        shape = RoundedCornerShape(AeroTokens.Radius.md.dp),
        border = BorderStroke(1.dp, if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface),
    ) { Text(text, style = MaterialTheme.typography.labelLarge) }
}

/** State is always icon + text, never colour alone. */
@Composable
fun StatusPill(text: String, color: Color, icon: ImageVector = Icons.Filled.Info, modifier: Modifier = Modifier) {
    Row(
        modifier.background(color.copy(alpha = 0.14f), RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(icon, null, tint = color, modifier = Modifier.size(14.dp))
        Text(text, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurface)
    }
}

@Composable
fun InstrumentTile(label: String, value: String, unit: String, modifier: Modifier = Modifier, hint: String? = null, big: Boolean = false, valueColor: Color = Color.Unspecified) {
    Column(modifier.padding(vertical = 4.dp)) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                value,
                style = (if (big) MaterialTheme.typography.displayLarge else MaterialTheme.typography.headlineLarge).copy(fontFamily = Mono),
                color = if (valueColor == Color.Unspecified) MaterialTheme.colorScheme.onSurface else valueColor,
            )
            Text(unit, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = if (big) 10.dp else 4.dp))
        }
        if (hint != null) Text(hint, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

enum class BannerKind { Info, Warning, Error, Success }

@Composable
fun Banner(text: String, kind: BannerKind = BannerKind.Info, modifier: Modifier = Modifier) {
    val c = Aero.colors
    val (color, icon) = when (kind) {
        BannerKind.Info -> c.secondary to Icons.Filled.Info
        BannerKind.Warning -> c.warning to Icons.Filled.Warning
        BannerKind.Error -> c.error to Icons.Filled.Error
        BannerKind.Success -> c.success to Icons.Filled.CheckCircle
    }
    Row(
        modifier.fillMaxWidth().background(color.copy(alpha = 0.12f), RoundedCornerShape(AeroTokens.Radius.md.dp)).padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, null, tint = color, modifier = Modifier.size(20.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
    }
}

@Composable
fun SyncBadge(s: SyncSnapshot) {
    val c = Aero.colors
    val (text, color) = when (s.status) {
        SyncStatus.SYNCED -> stringResource(R.string.sync_synced) to c.success
        SyncStatus.SYNCING -> stringResource(R.string.sync_syncing, s.pendingCount) to c.secondary
        SyncStatus.PENDING -> stringResource(R.string.sync_pending, s.pendingCount) to c.warning
        SyncStatus.OFFLINE -> stringResource(R.string.sync_offline, s.pendingCount) to c.offline
        SyncStatus.AUTH_REQUIRED -> stringResource(R.string.sync_auth) to c.error
        SyncStatus.SERVER_ERROR -> stringResource(R.string.sync_error, s.pendingCount) to c.error
    }
    val icon = when (s.status) {
        SyncStatus.SYNCED -> Icons.Filled.CheckCircle
        SyncStatus.AUTH_REQUIRED, SyncStatus.SERVER_ERROR -> Icons.Filled.Error
        else -> Icons.Filled.Info
    }
    StatusPill(text, color, icon)
}

@Composable
fun FreshnessBadge(freshness: String) {
    val c = Aero.colors
    val (text, color) = when (freshness) {
        "live" -> stringResource(R.string.fresh_live) to c.trackingActive
        "stale" -> stringResource(R.string.fresh_stale) to c.trackingStale
        else -> stringResource(R.string.fresh_lost) to c.offline
    }
    StatusPill(text, color, if (freshness == "live") Icons.Filled.CheckCircle else Icons.Filled.Warning)
}

@Composable
fun SimBadge() = StatusPill("SIM", Aero.colors.secondary)

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.SemiBold, modifier = modifier.padding(top = 8.dp))
}

@Composable
fun LoadingBox(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
}

@Composable
fun Spacer8() = Spacer(Modifier.height(8.dp))

val ScreenPadding = PaddingValues(horizontal = AeroTokens.Space.s4.dp)
