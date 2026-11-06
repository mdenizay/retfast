package com.mizibu.retfast.ui.flight

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mizibu.retfast.R
import com.mizibu.retfast.app.SessionState
import com.mizibu.retfast.graph
import com.mizibu.retfast.tracking.RawFix
import com.mizibu.retfast.ui.common.AeroButton
import com.mizibu.retfast.ui.common.BtnKind
import com.mizibu.retfast.ui.common.Fmt
import com.mizibu.retfast.ui.common.LocationHelper
import com.mizibu.retfast.ui.common.SecondaryButton
import com.mizibu.retfast.ui.common.Tone
import com.mizibu.retfast.ui.common.WarningRow
import com.mizibu.retfast.ui.theme.Aero
import com.mizibu.retfast.ui.theme.AeroTokens
import com.mizibu.retfast.ui.theme.Lucide
import com.mizibu.retfast.ui.theme.Mono
import java.util.Locale

/**
 * SOS: call 112, call or text the emergency contact with the coordinates, share the position,
 * and the coordinates in large type to read out. Retfast alerts nobody by itself; the sheet says so.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EmergencySheet(onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val g = ctx.graph
    val c = Aero.colors
    val session by g.session.state.collectAsStateWithLifecycle()
    val me = (session as? SessionState.SignedIn)?.me
    var fix by remember { mutableStateOf<RawFix?>(null) }
    var failed by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        val st = g.engine.status.value
        val recent = st.lastFixAt?.let { System.currentTimeMillis() - it < 60_000 } == true
        val p = st.lastPos
        fix = if (recent && p != null) RawFix(st.lastFixAt!!, p.first, p.second, st.values.gpsAltitude, st.lastAccuracy ?: 20.0)
        else LocationHelper.current(ctx)
        failed = fix == null
    }

    val contactName = me?.pilot?.emergencyContactName?.ifBlank { null }
    val contactPhone = me?.pilot?.emergencyContactPhone?.ifBlank { null }
    val f = fix
    val coords = f?.let { String.format(Locale.US, "%.6f, %.6f", it.lat, it.lon) }
    val shareText = f?.let {
        stringResource(R.string.sos_text, me?.fullName?.ifBlank { null } ?: "Retfast", coords!!, String.format(Locale.US, "%.6f,%.6f", it.lat, it.lon))
    }
    val imperial = g.prefs.units.collectAsStateWithLifecycle().value == "imperial"

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.background,
    ) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(56.dp).clip(CircleShape).background(c.error), contentAlignment = Alignment.Center) {
                    Icon(Lucide.Siren, null, tint = c.onEmergency, modifier = Modifier.size(26.dp))
                }
                Column {
                    Text(stringResource(R.string.sos_title), fontSize = 24.sp, fontWeight = FontWeight.Bold, color = c.textPrimary)
                    Text(stringResource(R.string.sos_sub), fontSize = 15.sp, color = c.textSecondary)
                }
            }
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(AeroTokens.Radius.lg.dp)).background(c.surface).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(stringResource(R.string.sos_position), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.textSecondary)
                if (f != null) {
                    Text(coords!!, fontSize = 26.sp, fontWeight = FontWeight.Bold, fontFamily = Mono, color = c.textPrimary, lineHeight = 32.sp)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        f.altitude?.let { Text(stringResource(R.string.sos_alt, Fmt.altitude(it, imperial)), fontSize = 14.sp, color = c.textSecondary) }
                        Text(Fmt.accuracy(f.hAcc), fontSize = 14.sp, color = c.textSecondary)
                        Spacer(Modifier.weight(1f))
                        Text(
                            stringResource(if (copied) R.string.copied else R.string.copy),
                            Modifier.clip(CircleShape).clickable {
                                (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("position", coords))
                                copied = true
                            }.padding(horizontal = 8.dp, vertical = 4.dp),
                            fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.primary,
                        )
                    }
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Lucide.LocateFixed, null, tint = c.textSecondary, modifier = Modifier.size(16.dp))
                        Text(stringResource(if (failed) R.string.sos_no_fix else R.string.sos_locating), fontSize = 15.sp, color = c.textSecondary)
                    }
                }
            }
            AeroButton(stringResource(R.string.sos_call112), { call(ctx, "112") }, Modifier.fillMaxWidth(), BtnKind.Emergency, large = true, icon = Lucide.Phone)
            if (contactPhone != null) {
                AeroButton(
                    stringResource(R.string.sos_call_contact, contactName ?: stringResource(R.string.sos_contact)),
                    { call(ctx, contactPhone) }, Modifier.fillMaxWidth(), BtnKind.Ink, icon = Lucide.Phone,
                )
                SecondaryButton(stringResource(R.string.sos_sms), { sms(ctx, contactPhone, shareText.orEmpty()) }, enabled = shareText != null, icon = Lucide.MessageSquareText)
            } else {
                WarningRow(stringResource(R.string.sos_no_contact), Tone.Info, Lucide.Info)
            }
            if (shareText != null) {
                SecondaryButton(stringResource(R.string.sos_share), {
                    ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, shareText), null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }, icon = Lucide.Share)
            }
            Text(stringResource(R.string.sos_note), fontSize = 13.sp, lineHeight = 18.sp, color = c.textSecondary)
        }
    }
}

private fun call(ctx: Context, number: String) {
    runCatching {
        ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + number.filter { it.isDigit() || it == '+' })).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

private fun sms(ctx: Context, number: String, body: String) {
    runCatching {
        ctx.startActivity(
            Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + number.filter { it.isDigit() || it == '+' })).putExtra("sms_body", body).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}
