package com.mizibu.retfast.ui.profile

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mizibu.retfast.R
import com.mizibu.retfast.graph
import com.mizibu.retfast.ui.common.Permissions
import com.mizibu.retfast.ui.common.PrimaryButton
import com.mizibu.retfast.ui.common.SecondaryButton
import com.mizibu.retfast.ui.common.StatusPill
import com.mizibu.retfast.ui.common.TextAction
import com.mizibu.retfast.ui.common.Tone
import com.mizibu.retfast.ui.common.WarningRow
import com.mizibu.retfast.ui.common.rememberPermState
import com.mizibu.retfast.ui.theme.Aero
import com.mizibu.retfast.ui.theme.AeroTokens
import com.mizibu.retfast.ui.theme.Lucide

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

    Column(
        Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(top = 4.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.permissions_sub), fontSize = 15.sp, lineHeight = 21.sp, color = c.textSecondary)
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(AeroTokens.Radius.lg.dp)).background((if (perm.ready) c.success else c.warning).copy(alpha = 0.12f)).padding(14.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(if (perm.ready) Lucide.CircleCheck else Lucide.TriangleAlert, null, tint = if (perm.ready) c.success else c.warning, modifier = Modifier.size(20.dp))
            Text(stringResource(if (perm.ready) R.string.perm_ready else R.string.perm_not_ready), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
        }
        if (!perm.gpsEnabled) {
            WarningRow(stringResource(R.string.gps_off), Tone.Warning, Lucide.MapPinOff)
            SecondaryButton(stringResource(R.string.open_location_settings), { Permissions.openLocationSettings(ctx) })
        }

        StepCard(1, Lucide.MapPin, stringResource(R.string.perm_fine_title), stringResource(R.string.perm_fine_body), perm.fine, stringResource(R.string.granted)) {
            if (perm.coarseOnly) WarningRow(stringResource(R.string.perm_coarse_only))
            PrimaryButton(stringResource(R.string.perm_allow), {
                fineLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
            })
            TextAction(stringResource(R.string.open_settings), { Permissions.openAppSettings(ctx) }, Modifier.fillMaxWidth())
        }
        StepCard(2, Lucide.Navigation, stringResource(R.string.perm_bg_title), stringResource(R.string.perm_bg_body), perm.background, stringResource(R.string.granted), enabled = perm.fine) {
            WarningRow(stringResource(R.string.perm_bg_honest), Tone.Info, Lucide.Info)
            if (Build.VERSION.SDK_INT >= 30) {
                // Android 11+: the system opens the app's location settings; the user must pick "Allow all the time".
                PrimaryButton(stringResource(R.string.perm_bg_open), { bgLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION) }, enabled = perm.fine)
                TextAction(stringResource(R.string.open_settings), { Permissions.openAppSettings(ctx) }, Modifier.fillMaxWidth())
            } else if (Build.VERSION.SDK_INT >= 29) {
                PrimaryButton(stringResource(R.string.perm_allow), { bgLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION) }, enabled = perm.fine)
            }
        }
        StepCard(3, Lucide.Bell, stringResource(R.string.perm_notif_title), stringResource(R.string.perm_notif_body), perm.notifications, stringResource(R.string.granted)) {
            if (Build.VERSION.SDK_INT >= 33) PrimaryButton(stringResource(R.string.perm_allow), { notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) })
            TextAction(stringResource(R.string.open_settings), { Permissions.openAppSettings(ctx) }, Modifier.fillMaxWidth())
        }
        StepCard(4, Lucide.Battery, stringResource(R.string.perm_battery_title), stringResource(R.string.perm_battery_body), perm.batteryExempt, stringResource(R.string.exempt)) {
            PrimaryButton(stringResource(R.string.perm_battery_ask), { Permissions.requestBatteryExemption(ctx) })
            Text(stringResource(R.string.perm_battery_oem), fontSize = 12.sp, lineHeight = 17.sp, color = c.textMuted)
        }
    }
}

@Composable
private fun StepCard(n: Int, icon: ImageVector, title: String, body: String, done: Boolean, doneText: String, enabled: Boolean = true, actions: @Composable () -> Unit) {
    val c = Aero.colors
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(AeroTokens.Radius.lg.dp)).background(c.surface).padding(16.dp).alpha(if (enabled || done) 1f else 0.55f),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(
                Modifier.size(36.dp).clip(CircleShape).background(if (done) c.success.copy(alpha = 0.15f) else c.primarySoft),
                contentAlignment = Alignment.Center,
            ) { Icon(if (done) Lucide.Check else icon, null, tint = if (done) c.success else c.primary, modifier = Modifier.size(18.dp)) }
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.perm_step, n), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.textMuted)
                Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
            }
            if (done) StatusPill(doneText, c.success, Lucide.CircleCheck)
        }
        Text(body, fontSize = 14.sp, lineHeight = 20.sp, color = c.textSecondary)
        if (!done && enabled) actions()
    }
}
