package com.mizibu.retfast.ui.auth

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mizibu.retfast.R
import com.mizibu.retfast.domain.PasswordPolicy
import com.mizibu.retfast.graph
import com.mizibu.retfast.net.ApiException
import com.mizibu.retfast.ui.common.AeroTextField
import com.mizibu.retfast.ui.common.AuthFieldBox
import com.mizibu.retfast.ui.common.BrandMark
import com.mizibu.retfast.ui.common.GlassCapsuleButton
import com.mizibu.retfast.ui.common.SkyBackdrop
import com.mizibu.retfast.ui.common.WhiteCapsuleButton
import com.mizibu.retfast.ui.common.userMessage
import com.mizibu.retfast.ui.theme.AeroTokens.Brand
import com.mizibu.retfast.ui.theme.Lucide
import kotlinx.coroutines.launch

// Signed-out flow, always dark (mirrors iOS AuthViews.swift).

private enum class AuthPage { Welcome, Login, Register, Forgot, Reset }

private val ErrorRed = Color(0xFFF87171)

@Composable
fun AuthHost() {
    var page by rememberSaveable { mutableStateOf(AuthPage.Welcome) }
    var notice by rememberSaveable { mutableStateOf<String?>(null) }
    BackHandler(page != AuthPage.Welcome) { page = if (page == AuthPage.Reset) AuthPage.Forgot else AuthPage.Welcome }
    AnimatedContent(
        page,
        transitionSpec = {
            val fwd = targetState.ordinal > initialState.ordinal
            (slideInHorizontally { if (fwd) it / 4 else -it / 4 } + fadeIn()) togetherWith (slideOutHorizontally { if (fwd) -it / 4 else it / 4 } + fadeOut())
        },
        label = "auth",
    ) { p ->
        when (p) {
            AuthPage.Welcome -> WelcomeScreen(notice, onEmail = { page = AuthPage.Login }, onRegister = { page = AuthPage.Register })
            AuthPage.Login -> LoginScreen(notice, onBack = { page = AuthPage.Welcome }, onRegister = { page = AuthPage.Register; notice = null }, onForgot = { page = AuthPage.Forgot })
            AuthPage.Register -> RegisterScreen(onBack = { page = AuthPage.Welcome })
            AuthPage.Forgot -> ForgotScreen(onBack = { page = AuthPage.Login }, onHaveCode = { page = AuthPage.Reset })
            AuthPage.Reset -> ResetScreen(onBack = { page = AuthPage.Forgot }, onDone = { notice = "reset"; page = AuthPage.Login })
        }
    }
}

@Composable
private fun WelcomeScreen(notice: String?, onEmail: () -> Unit, onRegister: () -> Unit) {
    val uri = LocalUriHandler.current
    var soon by remember { mutableStateOf<String?>(null) }
    val appear = remember { Animatable(0f) }
    LaunchedEffect(Unit) { appear.animateTo(1f, spring(dampingRatio = 0.8f, stiffness = Spring.StiffnessLow)) }
    SkyBackdrop(glowY = 0.32f) {
        Column(
            Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 24.dp).padding(bottom = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.weight(1f))
            Column(
                Modifier.graphicsLayer { val s = 0.92f + 0.08f * appear.value; scaleX = s; scaleY = s; alpha = appear.value },
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Box(Modifier.size(84.dp).clip(RoundedCornerShape(26.dp)).background(Brand.accent), contentAlignment = Alignment.Center) { BrandMark(44.dp, Brand.ink) }
                Text("Retfast", color = Color.White, fontSize = 36.sp, fontWeight = FontWeight.SemiBold)
                Text(stringResource(R.string.tagline), color = Color.White.copy(alpha = 0.65f), fontSize = 20.sp, fontWeight = FontWeight.Medium)
            }
            Spacer(Modifier.weight(1f))
            Column(
                Modifier.widthIn(max = 520.dp).graphicsLayer { translationY = (1 - appear.value) * 30.dp.toPx(); alpha = appear.value },
                verticalArrangement = Arrangement.spacedBy(12.dp), horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                if (notice == "reset") Text(stringResource(R.string.reset_done), color = Brand.accent, fontSize = 13.sp)
                WhiteCapsuleButton(stringResource(R.string.continue_google), { soon = "Google" }, leading = { GoogleG() })
                GlassCapsuleButton(stringResource(R.string.continue_email), onEmail, leading = { Icon(Lucide.Mail, null, tint = Color.White, modifier = Modifier.size(18.dp)) })
                Row(Modifier.padding(top = 20.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    FooterLink(stringResource(R.string.privacy)) { uri.openUri("https://retfast.com/privacy") }
                    Text("·", color = Color.White.copy(alpha = 0.3f))
                    FooterLink(stringResource(R.string.create_account), onRegister)
                }
            }
        }
    }
    soon?.let { name ->
        AlertDialog(
            onDismissRequest = { soon = null },
            confirmButton = { TextButton({ soon = null }) { Text(stringResource(R.string.ok)) } },
            title = { Text(stringResource(R.string.soon_title, name)) },
            text = { Text(stringResource(R.string.soon_body)) },
        )
    }
}

@Composable
private fun GoogleG() {
    Text("G", color = Color(0xFF4285F4), fontSize = 18.sp, fontWeight = FontWeight.Bold)
}

@Composable
private fun FooterLink(text: String, onClick: () -> Unit) {
    Text(text, Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onClick).padding(6.dp), color = Color.White.copy(alpha = 0.55f), fontSize = 13.sp, fontWeight = FontWeight.Medium)
}

/** Dark scaffold shared by the e-mail, register, reset and password screens. */
@Composable
private fun AuthScaffold(title: String, subtitle: String?, onBack: (() -> Unit)?, content: @Composable ColumnScope.() -> Unit) {
    Box(Modifier.fillMaxSize().background(Brand.ink)) {
        Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
            Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (onBack != null) Box(
                    Modifier.size(44.dp).clip(RoundedCornerShape(22.dp)).clickable(onClick = onBack),
                    contentAlignment = Alignment.Center,
                ) { Icon(Lucide.ChevronLeft, stringResource(R.string.back), tint = Color.White, modifier = Modifier.size(24.dp)) }
            }
            Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(top = 8.dp, bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(title, color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.SemiBold, lineHeight = 36.sp)
                    if (subtitle != null) Text(subtitle, color = Color.White.copy(alpha = 0.6f), fontSize = 16.sp, lineHeight = 22.sp)
                }
                content()
            }
        }
    }
}

@Composable
private fun DarkField(value: String, onChange: (String) -> Unit, placeholder: String, icon: ImageVector, password: Boolean = false, keyboard: KeyboardType = KeyboardType.Text) {
    AuthFieldBox(icon) {
        BasicTextField(
            value, onChange, Modifier.fillMaxWidth().padding(vertical = 16.dp).padding(end = 16.dp),
            singleLine = true,
            textStyle = TextStyle(color = Color.White, fontSize = 17.sp),
            cursorBrush = SolidColor(Brand.accent),
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboard),
            decorationBox = { inner ->
                Box(Modifier.padding(start = 8.dp)) {
                    if (value.isEmpty()) Text(placeholder, color = Color.White.copy(alpha = 0.4f), fontSize = 17.sp)
                    inner()
                }
            },
        )
    }
}

@Composable
private fun ErrorLine(text: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Lucide.CircleAlert, null, tint = ErrorRed, modifier = Modifier.size(18.dp))
        Text(text, color = ErrorRed, fontSize = 15.sp)
    }
}

@Composable
private fun SuccessLine(text: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Lucide.CircleCheck, null, tint = Brand.accent, modifier = Modifier.size(18.dp))
        Text(text, color = Brand.accent, fontSize = 15.sp)
    }
}

@Composable
private fun Rule(text: String, ok: Boolean) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 8.dp)) {
        Icon(if (ok) Lucide.CircleCheck else Lucide.Circle, null, tint = if (ok) Brand.accent else Color.White.copy(alpha = 0.4f), modifier = Modifier.size(15.dp))
        Text(text, color = Color.White.copy(alpha = if (ok) 0.8f else 0.5f), fontSize = 13.sp)
    }
}

@Composable
private fun LoginScreen(notice: String?, onBack: () -> Unit, onRegister: () -> Unit, onForgot: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AuthScaffold(stringResource(R.string.welcome_back), stringResource(R.string.login_sub2), onBack) {
        if (notice == "reset") SuccessLine(stringResource(R.string.reset_done))
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            DarkField(email, { email = it }, stringResource(R.string.email), Lucide.Mail, keyboard = KeyboardType.Email)
            DarkField(password, { password = it }, stringResource(R.string.password), Lucide.Lock, password = true)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { FooterLink(stringResource(R.string.forgot_password), onForgot) }
        }
        error?.let { ErrorLine(it) }
        WhiteCapsuleButton(stringResource(R.string.login), {
            busy = true; error = null
            scope.launch {
                try { ctx.graph.session.login(email.trim(), password); password = "" } catch (e: ApiException) { error = e.userMessage(ctx) }
                busy = false
            }
        }, enabled = email.isNotBlank() && password.isNotEmpty(), busy = busy)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.no_account), color = Color.White.copy(alpha = 0.55f), fontSize = 15.sp)
            Text(stringResource(R.string.create_account), Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onRegister).padding(6.dp), color = Brand.accent, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun RegisterScreen(onBack: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AuthScaffold(stringResource(R.string.register_title), stringResource(R.string.register_sub2), onBack) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            DarkField(name, { name = it }, stringResource(R.string.full_name), Lucide.User)
            DarkField(email, { email = it }, stringResource(R.string.email), Lucide.Mail, keyboard = KeyboardType.Email)
            DarkField(password, { password = it }, stringResource(R.string.password), Lucide.Lock, password = true)
            Rule(stringResource(R.string.rule_len), password.length >= 10)
            Rule(stringResource(R.string.rule_email), password.isNotEmpty() && !password.equals(email, ignoreCase = true))
        }
        error?.let { ErrorLine(it) }
        WhiteCapsuleButton(stringResource(R.string.create_account), {
            busy = true; error = null
            scope.launch {
                try { ctx.graph.session.register(email.trim(), password, name.trim()) } catch (e: ApiException) { error = e.userMessage(ctx) }
                busy = false
            }
        }, enabled = name.isNotBlank() && email.isNotBlank() && PasswordPolicy.problem(password, email) == null, busy = busy)
    }
}

@Composable
private fun ForgotScreen(onBack: () -> Unit, onHaveCode: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var email by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AuthScaffold(stringResource(R.string.forgot_title), stringResource(R.string.forgot_sub), onBack) {
        DarkField(email, { email = it }, stringResource(R.string.email), Lucide.Mail, keyboard = KeyboardType.Email)
        if (sent) SuccessLine(stringResource(R.string.forgot_sent))
        error?.let { ErrorLine(it) }
        WhiteCapsuleButton(stringResource(R.string.send_link), {
            busy = true; error = null
            scope.launch {
                try { ctx.graph.api.forgotPassword(email); sent = true } catch (e: ApiException) { error = e.userMessage(ctx) }
                busy = false
            }
        }, enabled = email.isNotBlank(), busy = busy)
        GlassCapsuleButton(stringResource(R.string.have_reset_code), onHaveCode)
        Text(stringResource(R.string.forgot_note), color = Color.White.copy(alpha = 0.45f), fontSize = 13.sp)
    }
}

@Composable
private fun ResetScreen(onBack: () -> Unit, onDone: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var token by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AuthScaffold(stringResource(R.string.reset_title), stringResource(R.string.reset_sub), onBack) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            DarkField(token, { token = it }, stringResource(R.string.reset_code), Lucide.KeyRound)
            DarkField(password, { password = it }, stringResource(R.string.new_password), Lucide.Lock, password = true)
            Rule(stringResource(R.string.rule_len), password.length >= 10)
        }
        error?.let { ErrorLine(it) }
        WhiteCapsuleButton(stringResource(R.string.reset_password), {
            busy = true; error = null
            scope.launch {
                try { ctx.graph.api.resetPassword(token, password); onDone() } catch (e: ApiException) { error = e.userMessage(ctx) }
                busy = false
            }
        }, enabled = token.isNotBlank() && password.length >= 10, busy = busy)
    }
}

/** Forced (must_change_password) or voluntary password change. While forced, nothing else in the app is reachable. */
@Composable
fun ChangePasswordScreen(forced: Boolean, email: String, onClose: (() -> Unit)? = null) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val session = ctx.graph.session
    var current by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    if (onClose != null) BackHandler { onClose() }
    AuthScaffold(
        stringResource(if (forced) R.string.forced_pw_title else R.string.change_password),
        if (forced) stringResource(R.string.forced_pw_sub) else null,
        if (forced) null else onClose,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            DarkField(current, { current = it }, stringResource(R.string.current_password), Lucide.Lock, password = true)
            DarkField(next, { next = it }, stringResource(R.string.new_password), Lucide.KeyRound, password = true)
            DarkField(confirm, { confirm = it }, stringResource(R.string.new_password_again), Lucide.KeyRound, password = true)
            Rule(stringResource(R.string.rule_len), next.length >= 10)
            Rule(stringResource(R.string.rule_email), next.isNotEmpty() && !next.equals(email, ignoreCase = true))
            Rule(stringResource(R.string.rule_diff), next.isNotEmpty() && next != current)
            Rule(stringResource(R.string.rule_match), next.isNotEmpty() && next == confirm)
        }
        error?.let { ErrorLine(it) }
        WhiteCapsuleButton(stringResource(R.string.change_pw_btn), {
            busy = true; error = null
            scope.launch {
                try { session.changePassword(current, next); onClose?.invoke() } catch (e: ApiException) { error = e.userMessage(ctx) }
                busy = false
            }
        }, enabled = current.isNotEmpty() && next != current && next == confirm && PasswordPolicy.problem(next, email) == null, busy = busy)
        if (forced) GlassCapsuleButton(stringResource(R.string.logout), { scope.launch { session.logout() } })
    }
}

/** Light-theme labelled field kept for in-app forms (profile). */
@Composable
fun Field(value: String, onChange: (String) -> Unit, label: String, modifier: Modifier = Modifier, password: Boolean = false, keyboard: KeyboardType = KeyboardType.Text, error: String? = null, singleLine: Boolean = true) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        AeroTextField(
            value, onChange, placeholder = label, singleLine = singleLine,
            keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboard),
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            isError = error != null,
        )
        if (error != null) Text(error, color = ErrorRed, fontSize = 12.sp, modifier = Modifier.padding(start = 12.dp))
    }
}
