package com.mizibu.retfast.ui.profile

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
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
import com.mizibu.retfast.ui.common.AeroCard
import com.mizibu.retfast.ui.common.Banner
import com.mizibu.retfast.ui.common.BannerKind
import com.mizibu.retfast.ui.common.PrimaryButton
import com.mizibu.retfast.ui.common.SecondaryButton
import com.mizibu.retfast.ui.common.SectionTitle
import com.mizibu.retfast.ui.common.userMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(onDiagnostics: () -> Unit, onPermissions: () -> Unit, onOnboarding: () -> Unit, onChangePassword: () -> Unit) {
    val ctx = LocalContext.current
    val g = ctx.graph
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
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<String, BannerKind>?>(null) }
    var showDelete by remember { mutableStateOf(false) }
    var showLogout by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { g.session.refreshMe() }
    LaunchedEffect(me?.preferences?.units) { me?.preferences?.units?.let { g.prefs.setUnits(it) } }

    val savedText = stringResource(R.string.saved)
    val deletionRequestedText = stringResource(R.string.deletion_requested)
    val deletionCancelledText = stringResource(R.string.deletion_cancelled)
    val logoutBlocked = status.recording || retrievals.any { !it.isTerminal }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.tab_profile), style = MaterialTheme.typography.headlineMedium)
        Text(me?.email.orEmpty(), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        message?.let { Banner(it.first, it.second) }

        AeroCard {
            Text(stringResource(R.string.pilot_details), style = MaterialTheme.typography.titleMedium)
            Field(name, { name = it }, stringResource(R.string.full_name))
            Field(phone, { phone = it }, stringResource(R.string.phone), keyboard = KeyboardType.Phone)
            Text(stringResource(R.string.phone_visibility), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Field(ecName, { ecName = it }, stringResource(R.string.emergency_contact_name))
            Field(ecPhone, { ecPhone = it }, stringResource(R.string.emergency_contact_phone), keyboard = KeyboardType.Phone)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.public_profile), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                Switch(publicProfile, { publicProfile = it })
            }
            PrimaryButton(stringResource(R.string.save), {
                busy = true; message = null
                scope.launch {
                    try {
                        if (name.trim() != me?.fullName) g.api.patchFullName(name.trim())
                        g.api.patchPilot(PilotProfile(phone = phone.trim(), emergencyContactName = ecName.trim(), emergencyContactPhone = ecPhone.trim()))
                        g.api.patchPreferences(publicProfile = publicProfile)
                        g.session.refreshMe()
                        message = savedText to BannerKind.Success
                    } catch (e: ApiException) { message = e.userMessage(ctx) to BannerKind.Error }
                    busy = false
                }
            }, busy = busy)
        }

        AeroCard {
            Text(stringResource(R.string.appearance), style = MaterialTheme.typography.titleMedium)
            SectionTitle(stringResource(R.string.units))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(units == "metric", { g.prefs.setUnits("metric"); scope.launch { runCatching { g.api.patchPreferences(units = "metric") } } }, label = { Text(stringResource(R.string.metric)) })
                FilterChip(units == "imperial", { g.prefs.setUnits("imperial"); scope.launch { runCatching { g.api.patchPreferences(units = "imperial") } } }, label = { Text(stringResource(R.string.imperial)) })
            }
            SectionTitle(stringResource(R.string.theme))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(theme == "system", { g.prefs.setTheme("system") }, label = { Text(stringResource(R.string.theme_system)) })
                FilterChip(theme == "light", { g.prefs.setTheme("light") }, label = { Text(stringResource(R.string.theme_light)) })
                FilterChip(theme == "dark", { g.prefs.setTheme("dark") }, label = { Text(stringResource(R.string.theme_dark)) })
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.flight_hc), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                Switch(highContrast, { g.prefs.setFlightHighContrast(it) })
            }
        }

        AeroCard {
            SecondaryButton(stringResource(R.string.permissions_title), onPermissions)
            SecondaryButton(stringResource(R.string.diagnostics), onDiagnostics)
            SecondaryButton(stringResource(R.string.change_password), onChangePassword)
            SecondaryButton(stringResource(R.string.onboarding_again), onOnboarding)
            SecondaryButton(stringResource(R.string.export_data), {
                scope.launch {
                    try {
                        val json = g.api.sendRaw("GET", "me/export", timeoutSeconds = 60)
                        val f = withContext(Dispatchers.IO) { File(ctx.cacheDir, "export").apply { mkdirs() }.let { File(it, "retfast-export.json").also { f -> f.writeText(json) } } }
                        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", f)
                        ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("application/json").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    } catch (e: ApiException) { message = e.userMessage(ctx) to BannerKind.Error }
                }
            })
            SecondaryButton(stringResource(R.string.delete_account), { showDelete = true }, destructive = true)
        }

        if (logoutBlocked) Banner(stringResource(R.string.logout_blocked), BannerKind.Info)
        SecondaryButton(stringResource(R.string.logout), { if (sync.pendingCount > 0) showLogout = true else scope.launch { g.session.logout() } }, enabled = !logoutBlocked)
        Text("Retfast ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }

    if (showLogout) {
        AlertDialog(
            onDismissRequest = { showLogout = false },
            title = { Text(stringResource(R.string.logout)) },
            text = { Text(stringResource(R.string.logout_pending, sync.pendingCount)) },
            confirmButton = { TextButton({ showLogout = false; scope.launch { g.session.logout() } }) { Text(stringResource(R.string.logout)) } },
            dismissButton = { TextButton({ showLogout = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
    if (showDelete) {
        var reason by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showDelete = false },
            title = { Text(stringResource(R.string.delete_account)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.delete_account_body))
                    OutlinedTextField(reason, { reason = it }, label = { Text(stringResource(R.string.reason_optional)) }, modifier = Modifier.fillMaxWidth())
                }
            },
            confirmButton = {
                TextButton({
                    showDelete = false
                    scope.launch {
                        message = try { g.api.requestDeletion(reason.ifBlank { null }); deletionRequestedText to BannerKind.Info }
                        catch (e: ApiException) { e.userMessage(ctx) to BannerKind.Error }
                    }
                }) { Text(stringResource(R.string.request_deletion)) }
            },
            dismissButton = {
                Row {
                    TextButton({ showDelete = false; scope.launch { message = try { g.api.cancelDeletion(); deletionCancelledText to BannerKind.Success } catch (e: ApiException) { e.userMessage(ctx) to BannerKind.Error } } }) { Text(stringResource(R.string.cancel_deletion)) }
                    TextButton({ showDelete = false }) { Text(stringResource(R.string.close)) }
                }
            },
        )
    }
}
