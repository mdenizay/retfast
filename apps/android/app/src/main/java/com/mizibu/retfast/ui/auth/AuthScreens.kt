package com.mizibu.retfast.ui.auth

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.mizibu.retfast.R
import com.mizibu.retfast.app.SessionManager
import com.mizibu.retfast.domain.PasswordPolicy
import com.mizibu.retfast.graph
import com.mizibu.retfast.net.ApiException
import com.mizibu.retfast.ui.common.Banner
import com.mizibu.retfast.ui.common.BannerKind
import com.mizibu.retfast.ui.common.PrimaryButton
import com.mizibu.retfast.ui.common.userMessage
import kotlinx.coroutines.launch

private enum class AuthPage { Login, Register, Forgot, Reset }

@Composable
fun AuthHost() {
    var page by rememberSaveable { mutableStateOf(AuthPage.Login) }
    var notice by rememberSaveable { mutableStateOf<String?>(null) }
    val session = LocalContext.current.graph.session
    when (page) {
        AuthPage.Login -> LoginScreen(session, notice, onRegister = { page = AuthPage.Register; notice = null }, onForgot = { page = AuthPage.Forgot })
        AuthPage.Register -> RegisterScreen(session, onBack = { page = AuthPage.Login })
        AuthPage.Forgot -> ForgotScreen(onBack = { page = AuthPage.Login }, onHaveCode = { page = AuthPage.Reset })
        AuthPage.Reset -> ResetScreen(onBack = { page = AuthPage.Login }, onDone = { notice = "reset"; page = AuthPage.Login })
    }
}

@Composable
private fun AuthFrame(title: String, subtitle: String? = null, content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Spacer(Modifier.height(24.dp))
        Text(stringResource(R.string.app_name), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
        Text(title, style = MaterialTheme.typography.headlineLarge)
        if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(4.dp))
        content()
    }
}

@Composable
fun Field(value: String, onChange: (String) -> Unit, label: String, modifier: Modifier = Modifier, password: Boolean = false, keyboard: KeyboardType = KeyboardType.Text, error: String? = null, singleLine: Boolean = true) {
    OutlinedTextField(
        value = value, onValueChange = onChange, label = { Text(label) }, singleLine = singleLine,
        modifier = modifier.fillMaxWidth(),
        visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboard),
        isError = error != null,
        supportingText = error?.let { { Text(it) } },
        shape = MaterialTheme.shapes.medium,
    )
}

@Composable
private fun LoginScreen(session: SessionManager, notice: String?, onRegister: () -> Unit, onForgot: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AuthFrame(stringResource(R.string.login_title), stringResource(R.string.login_sub)) {
        if (notice == "reset") Banner(stringResource(R.string.reset_done), BannerKind.Success)
        Field(email, { email = it }, stringResource(R.string.email), keyboard = KeyboardType.Email)
        Field(password, { password = it }, stringResource(R.string.password), password = true)
        error?.let { Banner(it, BannerKind.Error) }
        PrimaryButton(stringResource(R.string.login), onClick = {
            busy = true; error = null
            scope.launch {
                try { session.login(email, password) } catch (e: ApiException) { error = e.userMessage(ctx) }
                busy = false
            }
        }, enabled = email.isNotBlank() && password.isNotEmpty(), busy = busy)
        TextButton(onClick = onForgot, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.forgot_password)) }
        TextButton(onClick = onRegister, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.create_account)) }
    }
}

@Composable
private fun RegisterScreen(session: SessionManager, onBack: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val pwProblem = if (password.isEmpty()) null else PasswordPolicy.problem(password, email)?.let { stringResource(R.string.password_policy) }
    AuthFrame(stringResource(R.string.register_title), stringResource(R.string.register_sub)) {
        Field(name, { name = it }, stringResource(R.string.full_name))
        Field(email, { email = it }, stringResource(R.string.email), keyboard = KeyboardType.Email)
        Field(password, { password = it }, stringResource(R.string.password), password = true, error = pwProblem)
        error?.let { Banner(it, BannerKind.Error) }
        PrimaryButton(stringResource(R.string.create_account), onClick = {
            busy = true; error = null
            scope.launch {
                try { session.register(email, password, name) } catch (e: ApiException) { error = e.userMessage(ctx) }
                busy = false
            }
        }, enabled = name.isNotBlank() && email.isNotBlank() && PasswordPolicy.problem(password, email) == null, busy = busy)
        TextButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.back_to_login)) }
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
    AuthFrame(stringResource(R.string.forgot_title), stringResource(R.string.forgot_sub)) {
        Field(email, { email = it }, stringResource(R.string.email), keyboard = KeyboardType.Email)
        if (sent) Banner(stringResource(R.string.forgot_sent), BannerKind.Success)
        error?.let { Banner(it, BannerKind.Error) }
        PrimaryButton(stringResource(R.string.send_link), onClick = {
            busy = true; error = null
            scope.launch {
                try { ctx.graph.api.forgotPassword(email); sent = true } catch (e: ApiException) { error = e.userMessage(ctx) }
                busy = false
            }
        }, enabled = email.isNotBlank(), busy = busy)
        TextButton(onClick = onHaveCode, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.have_reset_code)) }
        TextButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.back_to_login)) }
    }
}

@Composable
private fun ResetScreen(onBack: () -> Unit, onDone: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var token by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AuthFrame(stringResource(R.string.reset_title), stringResource(R.string.reset_sub)) {
        Field(token, { token = it }, stringResource(R.string.reset_code))
        Field(password, { password = it }, stringResource(R.string.new_password), password = true,
            error = if (password.isNotEmpty() && password.length < 10) stringResource(R.string.password_policy) else null)
        error?.let { Banner(it, BannerKind.Error) }
        PrimaryButton(stringResource(R.string.reset_password), onClick = {
            busy = true; error = null
            scope.launch {
                try { ctx.graph.api.resetPassword(token, password); onDone() } catch (e: ApiException) { error = e.userMessage(ctx) }
                busy = false
            }
        }, enabled = token.isNotBlank() && password.length >= 10, busy = busy)
        TextButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.back_to_login)) }
    }
}

/** Forced (must_change_password) or voluntary password change. While forced, nothing else in the app is reachable. */
@Composable
fun ChangePasswordScreen(forced: Boolean, email: String, onClose: (() -> Unit)? = null) {
    val ctx: Context = LocalContext.current
    val scope = rememberCoroutineScope()
    val session = ctx.graph.session
    var current by rememberSaveable { mutableStateOf("") }
    var next by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val problem = if (next.isEmpty()) null else PasswordPolicy.problem(next, email)?.let { stringResource(R.string.password_policy) }
    AuthFrame(
        stringResource(if (forced) R.string.forced_pw_title else R.string.change_password),
        if (forced) stringResource(R.string.forced_pw_sub) else null,
    ) {
        Field(current, { current = it }, stringResource(R.string.current_password), password = true)
        Field(next, { next = it }, stringResource(R.string.new_password), password = true, error = problem)
        error?.let { Banner(it, BannerKind.Error) }
        PrimaryButton(stringResource(R.string.save), onClick = {
            busy = true; error = null
            scope.launch {
                try { session.changePassword(current, next); onClose?.invoke() } catch (e: ApiException) { error = e.userMessage(ctx) }
                busy = false
            }
        }, enabled = current.isNotEmpty() && PasswordPolicy.problem(next, email) == null, busy = busy)
        if (forced) {
            TextButton(onClick = { scope.launch { session.logout() } }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.logout)) }
        } else if (onClose != null) {
            TextButton(onClick = onClose, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.cancel)) }
        }
    }
}
