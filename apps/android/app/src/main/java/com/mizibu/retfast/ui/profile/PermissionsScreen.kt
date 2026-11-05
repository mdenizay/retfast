package com.mizibu.retfast.ui.profile

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.mizibu.retfast.R
import com.mizibu.retfast.graph
import com.mizibu.retfast.ui.common.AeroCard
import com.mizibu.retfast.ui.common.Banner
import com.mizibu.retfast.ui.common.BannerKind
import com.mizibu.retfast.ui.common.Permissions
import com.mizibu.retfast.ui.common.PrimaryButton
import com.mizibu.retfast.ui.common.SecondaryButton
import com.mizibu.retfast.ui.common.StatusPill
import com.mizibu.retfast.ui.common.rememberPermState
import com.mizibu.retfast.ui.theme.Aero

/**
 * Permission flow, in the order Android needs it:
 * 1. precise location, 2. background location ("Allow all the time", a separate request/screen on Android 10+),
 * 3. notifications (13+), 4. battery-optimisation exemption (explained, never forced).
 */
@Composable
fun PermissionsScreen() {
    val ctx = LocalContext.current
    val perm by rememberPermState()
    val prefs = ctx.graph.prefs
    val c = Aero.colors

    val fineLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }
    val bgLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { prefs.setBackgroundRationaleSeen() }
    val notifLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.permissions_title), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.permissions_sub), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)

        StepCard(
            n = 1, title = stringResource(R.string.perm_fine_title), body = stringResource(R.string.perm_fine_body), done = perm.fine,
            doneText = stringResource(R.string.granted),
        ) {
            if (perm.coarseOnly) Banner(stringResource(R.string.perm_coarse_only), BannerKind.Warning)
            PrimaryButton(stringResource(R.string.perm_allow), {
                fineLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
            })
            SecondaryButton(stringResource(R.string.open_settings), { Permissions.openAppSettings(ctx) })
        }

        StepCard(
            n = 2, title = stringResource(R.string.perm_bg_title), body = stringResource(R.string.perm_bg_body), done = perm.background,
            doneText = stringResource(R.string.granted), enabled = perm.fine,
        ) {
            Banner(stringResource(R.string.perm_bg_honest), BannerKind.Info)
            if (Build.VERSION.SDK_INT >= 30) {
                // Android 11+: the system opens the app's location settings; the user must pick "Allow all the time".
                PrimaryButton(stringResource(R.string.perm_bg_open), {
                    if (Build.VERSION.SDK_INT >= 29) bgLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                }, enabled = perm.fine)
                SecondaryButton(stringResource(R.string.open_settings), { Permissions.openAppSettings(ctx) })
            } else {
                PrimaryButton(stringResource(R.string.perm_allow), { bgLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION) }, enabled = perm.fine)
            }
        }

        StepCard(
            n = 3, title = stringResource(R.string.perm_notif_title), body = stringResource(R.string.perm_notif_body), done = perm.notifications,
            doneText = stringResource(R.string.granted),
        ) {
            if (Build.VERSION.SDK_INT >= 33) PrimaryButton(stringResource(R.string.perm_allow), { notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) })
            SecondaryButton(stringResource(R.string.open_settings), { Permissions.openAppSettings(ctx) })
        }

        StepCard(
            n = 4, title = stringResource(R.string.perm_battery_title), body = stringResource(R.string.perm_battery_body), done = perm.batteryExempt,
            doneText = stringResource(R.string.exempt),
        ) {
            PrimaryButton(stringResource(R.string.perm_battery_ask), { Permissions.requestBatteryExemption(ctx) })
            Text(stringResource(R.string.perm_battery_oem), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        if (!perm.gpsEnabled) {
            Banner(stringResource(R.string.gps_off), BannerKind.Warning)
            SecondaryButton(stringResource(R.string.open_location_settings), { Permissions.openLocationSettings(ctx) })
        }
        StatusPill(
            stringResource(if (perm.ready) R.string.perm_ready else R.string.perm_not_ready),
            if (perm.ready) c.success else c.warning,
            if (perm.ready) Icons.Filled.CheckCircle else Icons.Filled.Warning,
        )
    }
}

@Composable
private fun StepCard(n: Int, title: String, body: String, done: Boolean, doneText: String, enabled: Boolean = true, actions: @Composable () -> Unit) {
    val c = Aero.colors
    AeroCard {
        androidx.compose.foundation.layout.Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
            Text("$n. $title", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            if (done) StatusPill(doneText, c.success, Icons.Filled.CheckCircle)
        }
        Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (!done && enabled) actions()
    }
}

