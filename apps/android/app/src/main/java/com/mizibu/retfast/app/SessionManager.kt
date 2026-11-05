package com.mizibu.retfast.app

import com.mizibu.retfast.net.ApiClient
import com.mizibu.retfast.net.ApiException
import com.mizibu.retfast.net.AuthEvent
import com.mizibu.retfast.net.Me
import com.mizibu.retfast.net.me
import com.mizibu.retfast.net.status
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

sealed interface SessionState {
    data object Loading : SessionState
    data object SignedOut : SessionState
    /** Signed in; [offline] = the profile could not be refreshed (no network) but a refresh token exists. */
    data class SignedIn(val me: Me, val offline: Boolean = false) : SessionState
}

/** Owns who is signed in. Access tokens stay in memory inside [ApiClient]; the refresh token is in the Keystore store. */
class SessionManager(private val api: ApiClient, private val scope: CoroutineScope, private val onSignedIn: () -> Unit = {}) {
    private val _state = MutableStateFlow<SessionState>(SessionState.Loading)
    val state: StateFlow<SessionState> = _state

    init {
        scope.launch {
            api.authEvents.collect { e ->
                when (e) {
                    AuthEvent.SessionExpired -> _state.value = SessionState.SignedOut
                    AuthEvent.PasswordChangeRequired -> runCatching { api.me() }.onSuccess { _state.value = SessionState.SignedIn(it) }
                }
            }
        }
    }

    /** Cold start: use the stored refresh token. */
    suspend fun restore() {
        if (!api.hasRefreshToken) { _state.value = SessionState.SignedOut; return }
        try {
            val auth = api.refresh() ?: return
            _state.value = SessionState.SignedIn(auth.user)
            onSignedIn()
        } catch (e: ApiException.NotAuthenticated) {
            _state.value = SessionState.SignedOut
        } catch (e: ApiException.Server) {
            _state.value = if (e.status == 401 || e.status == 403) SessionState.SignedOut else SessionState.SignedOut
        } catch (e: ApiException) {
            // Offline at start: keep the user in the app with cached data; sync/outbox retry later.
            _state.value = SessionState.SignedIn(Me(id = "", fullName = ""), offline = true)
        }
    }

    suspend fun login(email: String, password: String) {
        val auth = api.login(email, password)
        _state.value = SessionState.SignedIn(auth.user); onSignedIn()
    }

    suspend fun register(email: String, password: String, fullName: String) {
        val auth = api.register(email, password, fullName)
        _state.value = SessionState.SignedIn(auth.user); onSignedIn()
    }

    suspend fun changePassword(current: String, new: String) {
        val auth = api.changePassword(current, new)
        _state.value = SessionState.SignedIn(auth.user); onSignedIn()
    }

    suspend fun refreshMe() {
        try { _state.value = SessionState.SignedIn(api.me()) } catch (_: ApiException) {}
    }

    fun updateMe(me: Me) { _state.value = SessionState.SignedIn(me) }

    suspend fun logout() {
        api.logout()
        _state.value = SessionState.SignedOut
    }
}
