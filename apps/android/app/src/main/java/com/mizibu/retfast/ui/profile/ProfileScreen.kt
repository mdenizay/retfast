package com.mizibu.retfast.ui.profile

import android.content.Intent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mizibu.retfast.BuildConfig
import com.mizibu.retfast.R
import com.mizibu.retfast.app.SessionState
import com.mizibu.retfast.graph
import com.mizibu.retfast.net.ApiException
import com.mizibu.retfast.net.PilotProfile
import com.mizibu.retfast.net.cancelDeletion
import com.mizibu.retfast.net.patchFullName
import com.mizibu.retfast.net.patchPilot
import com.mizibu.retfast.net.patchPreferences
import com.mizibu.retfast.net.requestDeletion
import com.mizibu.retfast.retrieval.isTerminal
import com.mizibu.retfast.ui.auth.Field
import com.mizibu.retfast.ui.common.AeroTextField
import com.mizibu.retfast.ui.common.Avatar
import com.mizibu.retfast.ui.common.CapsuleSegment
import com.mizibu.retfast.ui.common.ConfirmDialog
import com.mizibu.retfast.ui.common.IconBubble
import com.mizibu.retfast.ui.common.PrimaryButton
import com.mizibu.retfast.ui.common.RowDivider
import com.mizibu.retfast.ui.common.Tone
import com.mizibu.retfast.ui.common.WarningRow
import com.mizibu.retfast.ui.common.userMessage
import com.mizibu.retfast.ui.theme.Aero
import com.mizibu.retfast.ui.theme.AeroTokens
import com.mizibu.retfast.ui.theme.Lucide
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Profile as a grouped list (mirrors iOS ProfileView): hero, pilot, appearance, data, app, account. */
@Composable
fun ProfileScreen(onDiagnostics: () -> Unit, onPermissions: () -> Unit, onOnboarding: () -> Unit, onChangePassword: () -> Unit) {
    val ctx = LocalContext.current
    val g = ctx.graph
    val c = Aero.colors
    val scope = rememberCoroutineScope()
    val session by g.session.state.collectAsStateWithLifecycle()
    val me = (session as? SessionState.SignedIn)?.me
    val theme by g.prefs.theme.collectAsStateWithLifecycle()
    val units by g.prefs.units.collectAsStateWithLifecycle()
    val highContrast by g.prefs.flightHighContrast.collectAsStateWithLifecycle()
    val status by g.engine.status.collectAsStateWithLifecycle()
    val sync by g.sync.snapshot.collectAsStateWithLifecycle()
    val retrievals by g.db.retrievals().observeRecent().collectAsStateWithLifecycle(emptyList())

    var name by remember(me?.id) { mutableStateOf(me?.fullName.orEmpty()) }
    var phone by remember(me?.id) { mutableStateOf(me?.pilot?.phone.orEmpty()) }
    var ecName by remember(me?.id) { mutableStateOf(me?.pilot?.emergencyContactName.orEmpty()) }
    var ecPhone by remember(me?.id) { mutableStateOf(me?.pilot?.emergencyContactPhone.orEmpty()) }
    var publicProfile by remember(me?.id) { mutableStateOf(me?.preferences?.publicProfile == true) }
    var editing by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var exporting by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<String, Tone>?>(null) }
    var showDelete by remember { mutableStateOf(false) }
    var showLogout by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { g.session.refreshMe() }
    LaunchedEffect(me?.preferences?.units) { me?.preferences?.units?.let { g.prefs.setUnits(it) } }

    val savedText = stringResource(R.string.saved)
    val deletionRequestedText = stringResource(R.string.deletion_requested)
    val deletionCancelledText = stringResource(R.string.deletion_cancelled)
    val logoutBlocked = status.recording || retrievals.any { !it.isTerminal }

    fun savePilot() {
        busy = true; message = null
        scope.launch {
            try {
                if (name.trim() != me?.fullName) g.api.patchFullName(name.trim())
                g.api.patchPilot(PilotProfile(phone = phone.trim(), emergencyContactName = ecName.trim(), emergencyContactPhone = ecPhone.trim()))
                g.api.patchPreferences(publicProfile = publicProfile)
                g.session.refreshMe()
                message = savedText to Tone.Success
                editing = false
            } catch (e: ApiException) { message = e.userMessage(ctx) to Tone.Error }
            busy = false
        }
    }

    Column(
        Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(top = 12.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(stringResource(R.string.tab_profile), fontSize = 32.sp, fontWeight = FontWeight.Bold, color = c.textPrimary, modifier = Modifier.padding(bottom = 6.dp))

        // Hero
        if (me != null) {
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(AeroTokens.Radius.lg.dp)).background(c.surface).padding(18.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Avatar(me.fullName, 64.dp, c.primary)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(me.fullName, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
                    Text(me.email, fontSize = 13.sp, color = c.textSecondary, maxLines = 1)
                }
            }
        }
        message?.let { WarningRow(it.first, it.second, if (it.second == Tone.Success) Lucide.CircleCheck else Lucide.CircleAlert) }

        // Pilot
        GroupHeader(stringResource(R.string.sec_pilot))
        ListGroup {
            ListRow(Lucide.User, c.primary, stringResource(R.string.pilot_details), stringResource(R.string.pilot_details_sub), onClick = { editing = !editing }) {
                Icon(if (editing) Lucide.ChevronUp else Lucide.ChevronDown, null, tint = c.textMuted, modifier = Modifier.size(18.dp))
            }
            AnimatedVisibility(editing) {
                Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Field(name, { name = it }, stringResource(R.string.full_name))
                    Field(phone, { phone = it }, stringResource(R.string.phone), keyboard = KeyboardType.Phone)
                    Field(ecName, { ecName = it }, stringResource(R.string.emergency_contact_name))
                    Field(ecPhone, { ecPhone = it }, stringResource(R.string.emergency_contact_phone), keyboard = KeyboardType.Phone)
                    PrimaryButton(stringResource(R.string.save), ::savePilot, busy = busy)
                }
            }
            if (me != null && me.pilot?.phone.isNullOrBlank()) {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) { WarningRow(stringResource(R.string.no_phone_pilot)) }
            }
            RowDivider(Modifier.padding(start = 64.dp))
            ListRow(Lucide.Eye, c.retrieval, stringResource(R.string.public_profile), stringResource(if (publicProfile) R.string.state_on else R.string.state_off)) {
                Switch(publicProfile, {
                    publicProfile = it
                    scope.launch { runCatching { g.api.patchPreferences(publicProfile = it) } }
                }, colors = switchColors())
            }
        }
        GroupFooter(stringResource(R.string.phone_visibility))

        // Appearance
        GroupHeader(stringResource(R.string.appearance))
        ListGroup {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                RowLabel(Lucide.Gauge, c.secondary, stringResource(R.string.units))
                CapsuleSegment(
                    listOf("metric" to stringResource(R.string.metric), "imperial" to stringResource(R.string.imperial)), units,
                    { u -> g.prefs.setUnits(u); scope.launch { runCatching { g.api.patchPreferences(units = u) } } },
                )
            }
            RowDivider(Modifier.padding(start = 16.dp))
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                RowLabel(Lucide.SunMoon, c.primary, stringResource(R.string.theme))
                CapsuleSegment(
                    listOf("system" to stringResource(R.string.theme_system), "light" to stringResource(R.string.theme_light), "dark" to stringResource(R.string.theme_dark)),
                    theme, { g.prefs.setTheme(it) },
                )
            }
            RowDivider(Modifier.padding(start = 64.dp))
            ListRow(Lucide.Sun, c.warning, stringResource(R.string.flight_hc), null) {
                Switch(highContrast, { g.prefs.setFlightHighContrast(it) }, colors = switchColors())
            }
        }

        // Data
        GroupHeader(stringResource(R.string.sec_data))
        ListGroup {
            ListRow(Lucide.Download, c.retrieval, stringResource(R.string.export_data), null, onClick = {
                if (exporting) return@ListRow
                exporting = true
                scope.launch {
                    try {
                        val json = g.api.sendRaw("GET", "me/export", timeoutSeconds = 60)
                        val f = withContext(Dispatchers.IO) { File(ctx.cacheDir, "export").apply { mkdirs() }.let { File(it, "retfast-export.json").also { f -> f.writeText(json) } } }
                        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", f)
                        ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("application/json").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    } catch (e: ApiException) { message = e.userMessage(ctx) to Tone.Error }
                    exporting = false
                }
            }) { if (exporting) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = c.textMuted) else Chevron() }
        }

        // App
        GroupHeader(stringResource(R.string.sec_app))
        ListGroup {
            ListRow(Lucide.LockKeyhole, c.success, stringResource(R.string.permissions_title), null, onClick = onPermissions) { Chevron() }
            RowDivider(Modifier.padding(start = 64.dp))
            ListRow(Lucide.Stethoscope, c.success, stringResource(R.string.diagnostics), null, onClick = onDiagnostics) { Chevron() }
            RowDivider(Modifier.padding(start = 64.dp))
            ListRow(Lucide.KeyRound, c.warning, stringResource(R.string.change_password), null, onClick = onChangePassword) { Chevron() }
            RowDivider(Modifier.padding(start = 64.dp))
            ListRow(Lucide.Info, c.textSecondary, stringResource(R.string.onboarding_again), null, onClick = onOnboarding) { Chevron() }
        }

        // Account
        GroupHeader(stringResource(R.string.sec_account))
        ListGroup {
            ListRow(
                Lucide.LogOut, c.error, stringResource(R.string.logout), null, titleColor = c.error, enabled = !logoutBlocked,
                onClick = { if (sync.pendingCount > 0) showLogout = true else scope.launch { g.session.logout() } },
            )
            RowDivider(Modifier.padding(start = 64.dp))
            ListRow(Lucide.Trash2, c.error, stringResource(R.string.delete_account), null, titleColor = c.error, onClick = { showDelete = true })
        }
        if (logoutBlocked) GroupFooter(stringResource(R.string.logout_blocked))
        Text(
            "Retfast ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})", Modifier.fillMaxWidth().padding(top = 14.dp),
            fontSize = 12.sp, color = c.textMuted, textAlign = TextAlign.Center,
        )
    }

    if (showLogout) {
        ConfirmDialog(
            stringResource(R.string.logout), stringResource(R.string.logout_pending, sync.pendingCount), stringResource(R.string.logout),
            onConfirm = { showLogout = false; scope.launch { g.session.logout() } }, onDismiss = { showLogout = false }, destructive = true,
        )
    }
    if (showDelete) {
        var reason by remember { mutableStateOf("") }
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showDelete = false },
            containerColor = c.surface,
            shape = RoundedCornerShape(28.dp),
            title = { Text(stringResource(R.string.delete_account), fontWeight = FontWeight.SemiBold, color = c.textPrimary) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(stringResource(R.string.delete_account_body), fontSize = 15.sp, lineHeight = 21.sp, color = c.textSecondary)
                    AeroTextField(reason, { reason = it }, stringResource(R.string.reason_optional), background = c.background)
                    com.mizibu.retfast.ui.common.AeroButton(stringResource(R.string.request_deletion), {
                        showDelete = false
                        scope.launch {
                            message = try { g.api.requestDeletion(reason.ifBlank { null }); deletionRequestedText to Tone.Info }
                            catch (e: ApiException) { e.userMessage(ctx) to Tone.Error }
                        }
                    }, kind = com.mizibu.retfast.ui.common.BtnKind.Destructive)
                    com.mizibu.retfast.ui.common.TextAction(stringResource(R.string.cancel_deletion), {
                        showDelete = false
                        scope.launch { message = try { g.api.cancelDeletion(); deletionCancelledText to Tone.Success } catch (e: ApiException) { e.userMessage(ctx) to Tone.Error } }
                    }, Modifier.fillMaxWidth())
                    com.mizibu.retfast.ui.common.TextAction(stringResource(R.string.close), { showDelete = false }, Modifier.fillMaxWidth())
                }
            },
            confirmButton = {},
        )
    }
}

@Composable
internal fun switchColors() = SwitchDefaults.colors(checkedTrackColor = Aero.colors.primary, checkedThumbColor = Aero.colors.onPrimary)

@Composable
internal fun GroupHeader(text: String) {
    Text(text, Modifier.padding(start = 16.dp, top = 10.dp), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Aero.colors.textSecondary)
}

@Composable
internal fun GroupFooter(text: String) {
    Text(text, Modifier.padding(horizontal = 16.dp), fontSize = 12.sp, lineHeight = 17.sp, color = Aero.colors.textMuted)
}

@Composable
internal fun ListGroup(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(AeroTokens.Radius.lg.dp)).background(Aero.colors.surface)) { content() }
}

@Composable
private fun Chevron() = Icon(Lucide.ChevronRight, null, tint = Aero.colors.textMuted, modifier = Modifier.size(18.dp))

@Composable
private fun RowLabel(icon: ImageVector, tint: Color, title: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        IconBubble(icon, tint, size = 34.dp, iconSize = 17.dp)
        Text(title, fontSize = 16.sp, color = Aero.colors.textPrimary)
    }
}

@Composable
internal fun ListRow(
    icon: ImageVector, tint: Color, title: String, subtitle: String?,
    titleColor: Color = Aero.colors.textPrimary, enabled: Boolean = true, onClick: (() -> Unit)? = null,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    val c = Aero.colors
    Row(
        Modifier.fillMaxWidth().heightIn(min = 58.dp)
            .then(if (onClick != null && enabled) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        IconBubble(icon, if (enabled) tint else c.textMuted, size = 34.dp, iconSize = 17.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(title, fontSize = 16.sp, color = if (enabled) titleColor else c.textMuted)
            subtitle?.let { Text(it, fontSize = 13.sp, color = c.textSecondary) }
        }
        trailing()
    }
}
