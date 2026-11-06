package com.mizibu.retfast.ui.common

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mizibu.retfast.R
import com.mizibu.retfast.sync.SyncSnapshot
import com.mizibu.retfast.sync.SyncStatus
import com.mizibu.retfast.ui.theme.Aero
import com.mizibu.retfast.ui.theme.AeroColors
import com.mizibu.retfast.ui.theme.AeroTokens
import com.mizibu.retfast.ui.theme.Lucide
import com.mizibu.retfast.ui.theme.Mono
import com.mizibu.retfast.util.Iso
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// Mirrors apps/ios/Retfast/DesignSystem/Components.swift: flat surface cards, capsule buttons,
// tinted pills. State is always icon + text, never colour alone.

/** Semantic colour roles (iOS `Tone`). */
enum class Tone { Neutral, Info, Active, Success, Warning, Error, Retrieval, Emergency;
    fun color(c: AeroColors): Color = when (this) {
        Neutral -> c.textSecondary
        Info -> c.primary
        Active -> c.trackingActive
        Success -> c.success
        Warning -> c.warning
        Error -> c.error
        Retrieval -> c.retrieval
        Emergency -> c.emergency
    }
}

@Composable
fun Tone.color(): Color = color(Aero.colors)

@Composable
fun AeroCard(modifier: Modifier = Modifier, padding: Dp = 18.dp, spacing: Dp = AeroTokens.Space.s3.dp, onClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(AeroTokens.Radius.lg.dp)
    Column(
        modifier.fillMaxWidth().clip(shape).background(Aero.colors.surface)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(padding),
        verticalArrangement = Arrangement.spacedBy(spacing),
        content = content,
    )
}

enum class BtnKind { Primary, Tinted, Ink, Secondary, Destructive, Emergency }

/** Capsule button (iOS PrimaryButtonStyle). Press scales to 0.98. */
@Composable
fun AeroButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: BtnKind = BtnKind.Primary,
    large: Boolean = false,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    busy: Boolean = false,
    fill: Boolean = true,
) {
    val c = Aero.colors
    val (bg, fg) = when (kind) {
        BtnKind.Primary -> c.primary to c.onPrimary
        BtnKind.Tinted -> c.primary.copy(alpha = 0.16f) to c.primary
        BtnKind.Ink -> c.ink to c.onInk
        BtnKind.Secondary -> c.surfaceElevated to c.textPrimary
        BtnKind.Destructive -> c.error to c.onEmergency
        BtnKind.Emergency -> c.emergency to c.onEmergency
    }
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.98f else 1f, label = "press")
    val on = enabled && !busy
    Row(
        modifier
            .then(if (fill) Modifier.fillMaxWidth() else Modifier)
            .defaultMinSize(minHeight = (if (large) AeroTokens.Control.heightLarge else AeroTokens.Control.height).dp)
            .scale(scale)
            .alpha(if (!enabled) 0.45f else if (pressed) 0.88f else 1f)
            .clip(CircleShape)
            .background(bg)
            .clickable(interactionSource = source, indication = null, enabled = on, role = Role.Button, onClick = onClick)
            .padding(horizontal = AeroTokens.Space.s4.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (busy) {
            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = fg)
        } else {
            if (icon != null) {
                Icon(icon, null, tint = fg, modifier = Modifier.size(if (large) 20.dp else 18.dp))
                Spacer(Modifier.width(8.dp))
            }
            Text(text, color = fg, fontWeight = FontWeight.SemiBold, fontSize = if (large) 17.sp else 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, large: Boolean = false, enabled: Boolean = true, busy: Boolean = false, icon: ImageVector? = null) =
    AeroButton(text, onClick, modifier, BtnKind.Primary, large, icon, enabled, busy)

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, destructive: Boolean = false, icon: ImageVector? = null) =
    AeroButton(text, onClick, modifier, if (destructive) BtnKind.Destructive else BtnKind.Secondary, false, icon, enabled)

/** Plain text action (e.g. "Retrieve istemiyorum"). */
@Composable
fun TextAction(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, color: Color = Aero.colors.textSecondary) {
    Box(modifier.fillMaxWidth().heightIn(min = 44.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onClick), contentAlignment = Alignment.Center) {
        Text(text, color = color, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
    }
}

/** Small tinted capsule action ("Tümü", "Yenile"). */
@Composable
fun PillButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, tint: Color = Aero.colors.primary, icon: ImageVector? = null) {
    Row(
        modifier.heightIn(min = 32.dp).clip(CircleShape).background(tint.copy(alpha = 0.16f)).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (icon != null) Icon(icon, null, tint = tint, modifier = Modifier.size(14.dp))
        Text(text, color = tint, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun StatusPill(text: String, color: Color, icon: ImageVector = Lucide.Info, modifier: Modifier = Modifier) {
    Row(
        modifier.clip(CircleShape).background(color.copy(alpha = 0.14f)).padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Icon(icon, null, tint = color, modifier = Modifier.size(13.dp))
        Text(text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = color, maxLines = 1)
    }
}

@Composable
fun StatusPill(text: String, tone: Tone, icon: ImageVector = Lucide.Info, modifier: Modifier = Modifier) = StatusPill(text, tone.color(), icon, modifier)

/** Icon + text line (iOS WarningRow). */
@Composable
fun WarningRow(text: String, tone: Tone = Tone.Warning, icon: ImageVector = Lucide.TriangleAlert, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(icon, null, tint = tone.color(), modifier = Modifier.padding(top = 2.dp).size(18.dp))
        Text(text, fontSize = 15.sp, lineHeight = 21.sp, color = Aero.colors.textPrimary)
    }
}

enum class BannerKind { Info, Warning, Error, Success }

/** WarningRow on a surface card. */
@Composable
fun Banner(text: String, kind: BannerKind = BannerKind.Info, modifier: Modifier = Modifier) {
    val (tone, icon) = when (kind) {
        BannerKind.Info -> Tone.Info to Lucide.Info
        BannerKind.Warning -> Tone.Warning to Lucide.TriangleAlert
        BannerKind.Error -> Tone.Error to Lucide.OctagonAlert
        BannerKind.Success -> Tone.Success to Lucide.CircleCheck
    }
    AeroCard(modifier, padding = 16.dp) { WarningRow(text, tone, icon) }
}

/** 48 dp floating circle on top of maps (back, locate, fit). */
@Composable
fun MapCircleButton(icon: ImageVector, label: String, onClick: () -> Unit, modifier: Modifier = Modifier, tint: Color = Aero.colors.textPrimary) {
    Box(
        modifier.size(48.dp).shadow(10.dp, CircleShape, ambientColor = Color.Black.copy(alpha = 0.22f), spotColor = Color.Black.copy(alpha = 0.22f))
            .clip(CircleShape).background(Aero.colors.surface).clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Icon(icon, null, tint = tint, modifier = Modifier.size(20.dp)) }
}

/** 44 dp tinted circle (call, navigate). */
@Composable
fun RoundIconButton(icon: ImageVector, label: String, onClick: () -> Unit, modifier: Modifier = Modifier, tint: Color = Aero.colors.primary, size: Dp = 44.dp) {
    Box(
        modifier.size(size).clip(CircleShape).background(tint.copy(alpha = 0.14f)).clickable(role = Role.Button, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Icon(icon, null, tint = tint, modifier = Modifier.size(19.dp)) }
}

/** 46 dp neutral header circle (refresh, settings). */
@Composable
fun HeaderCircleButton(icon: ImageVector, label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier.size(46.dp).clip(CircleShape).background(Aero.colors.surface).clickable(role = Role.Button, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Icon(icon, null, tint = Aero.colors.textPrimary, modifier = Modifier.size(20.dp)) }
}

/** Icon in a soft circle (list rows, sheet headers). */
@Composable
fun IconBubble(icon: ImageVector, tint: Color, size: Dp = 38.dp, iconSize: Dp = 18.dp, alpha: Float = 0.15f, solid: Boolean = false) {
    Box(Modifier.size(size).clip(CircleShape).background(if (solid) tint else tint.copy(alpha = alpha)), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = if (solid) Aero.colors.onEmergency else tint, modifier = Modifier.size(iconSize))
    }
}

/** Capsule segmented control. */
@Composable
fun <T> CapsuleSegment(options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit, modifier: Modifier = Modifier) {
    val c = Aero.colors
    Row(modifier.fillMaxWidth().clip(CircleShape).background(c.surface).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        options.forEach { (value, title) ->
            val on = value == selected
            val bg by animateColorAsState(if (on) c.primary else Color.Transparent, label = "seg")
            Box(
                Modifier.weight(1f).heightIn(min = 38.dp).clip(CircleShape).background(bg).clickable(role = Role.Tab) { onSelect(value) },
                contentAlignment = Alignment.Center,
            ) {
                Text(title, color = if (on) c.onPrimary else c.textSecondary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** Initials avatar (no profile photos in Retfast). */
@Composable
fun Avatar(name: String?, size: Dp = 44.dp, tint: Color = Aero.colors.secondary) {
    val c = Aero.colors
    val initials = (name ?: "?").trim().split(Regex("\\s+")).take(2).mapNotNull { it.firstOrNull()?.toString() }.joinToString("").uppercase().ifEmpty { "?" }
    val solid = tint == c.primary
    Box(Modifier.size(size).clip(CircleShape).background(if (solid) tint else tint.copy(alpha = 0.16f)), contentAlignment = Alignment.Center) {
        Text(initials, color = if (solid) c.onPrimary else tint, fontSize = (size.value * 0.36f).sp, fontWeight = FontWeight.SemiBold)
    }
}

/** Big number over a small label on an inner tile. */
@Composable
fun StatTile(value: String, label: String, modifier: Modifier = Modifier, icon: ImageVector? = null, tint: Color = Aero.colors.primary) {
    val c = Aero.colors
    Column(modifier.clip(RoundedCornerShape(20.dp)).background(c.surfaceElevated).padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (icon != null) Box(Modifier.padding(bottom = 4.dp)) { IconBubble(icon, tint, 30.dp, 14.dp, 0.16f) }
        Text(value, fontSize = 28.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary, maxLines = 1, style = TextStyle(fontFeatureSettings = "tnum"))
        Text(label, fontSize = 13.sp, color = c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** "Title  4 ……… [trailing]" heading. */
@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier, count: Int? = null, trailing: @Composable RowScope.() -> Unit = {}) {
    val c = Aero.colors
    Row(modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(text, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
        if (count != null) Text("$count", fontSize = 20.sp, fontWeight = FontWeight.Medium, color = c.textMuted)
        Spacer(Modifier.weight(1f))
        trailing()
    }
}

/** Small caption heading inside cards. */
@Composable
fun Caption(text: String, modifier: Modifier = Modifier, color: Color = Aero.colors.textSecondary) {
    Text(text, modifier, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = color)
}

@Composable
fun KeyValueRow(key: String, value: String, mono: Boolean = false, valueColor: Color = Aero.colors.textPrimary) {
    val c = Aero.colors
    Row(Modifier.fillMaxWidth().heightIn(min = 28.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(key, color = c.textSecondary, fontSize = 16.sp)
        Spacer(Modifier.weight(1f).widthIn12())
        Text(value, color = valueColor, fontSize = 16.sp, fontFamily = if (mono) Mono else null, style = TextStyle(fontFeatureSettings = "tnum"))
    }
}

private fun Modifier.widthIn12() = this.then(Modifier.defaultMinSize(minWidth = 12.dp))

/** Hairline between rows inside a card. */
@Composable
fun RowDivider(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(Aero.colors.border.copy(alpha = 0.6f)))
}

/** Icon on primarySoft + caption title + value (event info grid). */
@Composable
fun InfoTile(icon: ImageVector, title: String, value: String, modifier: Modifier = Modifier) {
    val c = Aero.colors
    Row(
        modifier.heightIn(min = 64.dp).clip(RoundedCornerShape(AeroTokens.Radius.md.dp)).background(c.surfaceElevated).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(c.primarySoft), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = c.primary, modifier = Modifier.size(17.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 12.sp, color = c.textSecondary, maxLines = 1)
            Text(value, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** Day + short month on a rounded square; accent when the event is live. */
@Composable
fun DateTile(iso: String?, active: Boolean = false, size: Dp = 52.dp) {
    val c = Aero.colors
    val ms = Iso.parse(iso)
    val day = ms?.let { SimpleDateFormat("d", Locale.getDefault()).format(Date(it)) } ?: "–"
    val month = ms?.let { SimpleDateFormat("MMM", Locale.getDefault()).format(Date(it)).uppercase(Locale.getDefault()).trimEnd('.') } ?: ""
    Column(
        Modifier.size(size).clip(RoundedCornerShape(size * 0.34f)).background(if (active) c.primary else c.surfaceElevated),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        Text(day, fontSize = (size.value * 0.38f).sp, fontWeight = FontWeight.SemiBold, color = if (active) c.onPrimary else c.textPrimary, lineHeight = (size.value * 0.42f).sp)
        Text(month, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = if (active) c.onPrimary.copy(alpha = 0.85f) else c.textMuted, lineHeight = 12.sp)
    }
}

/** Weeks × 7 days activity grid; `levels` are 0…4 per day, oldest first. */
@Composable
fun ActivityHeatmap(levels: List<Int>, modifier: Modifier = Modifier, columns: Int = 8, spacing: Dp = 5.dp) {
    val c = Aero.colors
    val alphas = listOf(0f, 0.35f, 0.55f, 0.78f, 1f)
    BoxWithConstraints(modifier.fillMaxWidth().aspectRatio(columns / 7f)) {
        val cell = (maxWidth - spacing * (columns - 1)) / columns
        Row(horizontalArrangement = Arrangement.spacedBy(spacing)) {
            repeat(columns) { col ->
                Column(verticalArrangement = Arrangement.spacedBy(spacing)) {
                    repeat(7) { r ->
                        val lv = levels.getOrElse(col * 7 + r) { 0 }.coerceIn(0, 4)
                        Box(Modifier.size(cell).clip(RoundedCornerShape(cell * 0.28f)).background(if (lv == 0) c.surfaceElevated else c.primary.copy(alpha = alphas[lv])))
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FlowChips(items: List<String>, selected: Set<Int>, onTap: (Int) -> Unit) {
    val c = Aero.colors
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items.forEachIndexed { i, label ->
            val on = i in selected
            Row(
                Modifier.clip(CircleShape).background(if (on) c.primary else c.surface).clickable(role = Role.Checkbox) { onTap(i) }.padding(horizontal = 14.dp, vertical = 9.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                if (on) Icon(Lucide.Check, null, tint = c.onPrimary, modifier = Modifier.size(14.dp))
                Text(label, color = if (on) c.onPrimary else c.textPrimary, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
}

/** Filled rounded text field on a surface (no outline). */
@Composable
fun AeroTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
    minLines: Int = 1,
    maxLines: Int = if (singleLine) 1 else 4,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    leading: ImageVector? = null,
    trailing: @Composable (() -> Unit)? = null,
    background: Color = Aero.colors.surface,
    isError: Boolean = false,
) {
    val c = Aero.colors
    TextField(
        value, onValueChange,
        modifier.fillMaxWidth(),
        placeholder = { Text(placeholder, color = c.textMuted) },
        singleLine = singleLine, minLines = minLines, maxLines = maxLines,
        keyboardOptions = keyboardOptions, visualTransformation = visualTransformation,
        leadingIcon = leading?.let { { Icon(it, null, tint = c.textMuted, modifier = Modifier.size(18.dp)) } },
        trailingIcon = trailing,
        isError = isError,
        shape = RoundedCornerShape(AeroTokens.Radius.md.dp),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = background, unfocusedContainerColor = background, disabledContainerColor = background, errorContainerColor = background,
            focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent, disabledIndicatorColor = Color.Transparent, errorIndicatorColor = Color.Transparent,
            cursorColor = c.primary, focusedTextColor = c.textPrimary, unfocusedTextColor = c.textPrimary,
        ),
    )
}

/** Centered empty state with an icon bubble. */
@Composable
fun EmptyState(icon: ImageVector, title: String, body: String? = null, modifier: Modifier = Modifier) {
    val c = Aero.colors
    Column(modifier.fillMaxWidth().padding(vertical = 28.dp, horizontal = 16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        IconBubble(icon, c.textSecondary, 52.dp, 22.dp, 0.12f)
        Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
        if (body != null) Text(body, fontSize = 14.sp, color = c.textSecondary, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

/** Two-button confirmation dialog in the app style. */
@Composable
fun ConfirmDialog(title: String, message: String?, confirm: String, onConfirm: () -> Unit, onDismiss: () -> Unit, dismiss: String = stringResource(R.string.cancel), destructive: Boolean = false) {
    val c = Aero.colors
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = c.surface,
        shape = RoundedCornerShape(AeroTokens.Radius.lg.dp),
        title = { Text(title, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, color = c.textPrimary) },
        text = message?.let { { Text(it, color = c.textSecondary, fontSize = 15.sp) } },
        confirmButton = { TextButton({ onConfirm() }) { Text(confirm, color = if (destructive) c.error else c.primary, fontWeight = FontWeight.SemiBold) } },
        dismissButton = { TextButton(onDismiss) { Text(dismiss, color = c.textSecondary) } },
    )
}

@Composable
fun SyncBadge(s: SyncSnapshot) {
    val (text, tone) = when (s.status) {
        SyncStatus.SYNCED -> stringResource(R.string.sync_synced) to Tone.Success
        SyncStatus.SYNCING -> stringResource(R.string.sync_syncing, s.pendingCount) to Tone.Info
        SyncStatus.PENDING -> stringResource(R.string.sync_pending, s.pendingCount) to Tone.Warning
        SyncStatus.OFFLINE -> stringResource(R.string.sync_offline, s.pendingCount) to Tone.Neutral
        SyncStatus.AUTH_REQUIRED -> stringResource(R.string.sync_auth) to Tone.Error
        SyncStatus.SERVER_ERROR -> stringResource(R.string.sync_error, s.pendingCount) to Tone.Error
    }
    val icon = when (s.status) {
        SyncStatus.SYNCED -> Lucide.CircleCheck
        SyncStatus.SYNCING -> Lucide.CloudUpload
        SyncStatus.OFFLINE -> Lucide.CloudOff
        SyncStatus.AUTH_REQUIRED, SyncStatus.SERVER_ERROR -> Lucide.CloudAlert
        else -> Lucide.Clock
    }
    StatusPill(text, tone, icon)
}

@Composable
fun FreshnessBadge(freshness: String) {
    val c = Aero.colors
    val (text, color, icon) = when (freshness) {
        "live" -> Triple(stringResource(R.string.fresh_live), c.trackingActive, Lucide.Radio)
        "stale" -> Triple(stringResource(R.string.fresh_stale), c.trackingStale, Lucide.Clock)
        else -> Triple(stringResource(R.string.fresh_lost), c.offline, Lucide.WifiOff)
    }
    StatusPill(text, color, icon)
}

@Composable
fun SimBadge() = StatusPill("SIM", Aero.colors.secondary, Lucide.FlaskConical)

/** Square "DEMO" marker for demo events. */
@Composable
fun DemoBadge() {
    val c = Aero.colors
    Text("DEMO", Modifier.clip(RoundedCornerShape(6.dp)).background(c.secondary.copy(alpha = 0.16f)).padding(horizontal = 6.dp, vertical = 2.dp), color = c.secondary, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp)
}

@Composable
fun LoadingBox(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Aero.colors.primary, strokeWidth = 2.5.dp, modifier = Modifier.size(28.dp)) }
}

@Composable
fun Spacer8() = Spacer(Modifier.height(8.dp))

val ScreenPadding = PaddingValues(horizontal = AeroTokens.Space.s4.dp)

/** Large screen title with optional subtitle (iOS large title). */
@Composable
fun ScreenTitle(title: String, subtitle: String? = null, eyebrow: String? = null, eyebrowColor: Color = Aero.colors.textSecondary) {
    val c = Aero.colors
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (eyebrow != null) Text(eyebrow, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = eyebrowColor)
        Text(title, fontSize = 32.sp, lineHeight = 38.sp, fontWeight = FontWeight.Bold, color = c.textPrimary)
        if (subtitle != null) Text(subtitle, fontSize = 15.sp, color = c.textSecondary)
    }
}

/** Top bar with a round back button and a centered title, for pushed screens. */
@Composable
fun TopBar(title: String, onBack: (() -> Unit)?, trailing: @Composable RowScope.() -> Unit = {}) {
    val c = Aero.colors
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (onBack != null) HeaderCircleButton(Lucide.ChevronLeft, stringResource(R.string.back), onBack) else Spacer(Modifier.size(46.dp))
        Text(title, Modifier.weight(1f).padding(horizontal = 8.dp), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        Row(Modifier.defaultMinSize(minWidth = 46.dp), horizontalArrangement = Arrangement.End, content = trailing)
    }
}

/** Flight instrument: label over a large tabular value + unit (iOS InstrumentTile). */
@Composable
fun InstrumentTile(label: String, value: String, unit: String, modifier: Modifier = Modifier, hint: String? = null, big: Boolean = false, valueColor: Color = Aero.colors.textPrimary) {
    val c = Aero.colors
    Column(modifier.clip(RoundedCornerShape(20.dp)).background(c.surfaceElevated).padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, fontSize = 13.sp, color = c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(value, fontSize = if (big) 44.sp else 28.sp, lineHeight = if (big) 48.sp else 32.sp, fontWeight = FontWeight.SemiBold, color = valueColor, maxLines = 1, style = TextStyle(fontFeatureSettings = "tnum"))
            if (unit.isNotEmpty()) Text(unit, Modifier.padding(bottom = if (big) 7.dp else 4.dp), fontSize = 14.sp, color = c.textSecondary, maxLines = 1)
        }
        if (hint != null) Text(hint, fontSize = 12.sp, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
