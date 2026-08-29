package com.mizibu.retfast.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mizibu.retfast.core.Profile
import com.mizibu.retfast.core.supa
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.postgrest.from
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

class AuthViewModel : ViewModel() {

    data class State(
        val loading: Boolean = true,
        val signedIn: Boolean = false,
        val userId: String? = null,
        val profile: Profile? = null,
        val error: String? = null,
        val busy: Boolean = false,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init {
        viewModelScope.launch {
            supa.auth.sessionStatus.collect { status ->
                when (status) {
                    is SessionStatus.Authenticated -> {
                        val uid = status.session.user?.id
                        _state.value = _state.value.copy(
                            loading = false,
                            signedIn = true,
                            userId = uid,
                        )
                        uid?.let { loadProfile(it) }
                    }
                    is SessionStatus.NotAuthenticated ->
                        _state.value = State(loading = false, signedIn = false)
                    else -> _state.value = _state.value.copy(loading = true)
                }
            }
        }
    }

    private suspend fun loadProfile(userId: String) {
        runCatching {
            supa.from("profiles").select { filter { eq("id", userId) } }.decodeSingle<Profile>()
        }.onSuccess { _state.value = _state.value.copy(profile = it) }
    }

    fun signIn(email: String, password: String) = viewModelScope.launch {
        _state.value = _state.value.copy(busy = true, error = null)
        runCatching { supa.auth.signInWith(Email) { this.email = email; this.password = password } }
            .onFailure { _state.value = _state.value.copy(error = it.message) }
        _state.value = _state.value.copy(busy = false)
    }

    fun signUp(email: String, password: String, displayName: String) = viewModelScope.launch {
        _state.value = _state.value.copy(busy = true, error = null)
        runCatching {
            supa.auth.signUpWith(Email) {
                this.email = email
                this.password = password
                data = buildJsonObject {
                    put("display_name", JsonPrimitive(displayName))
                    put("locale", JsonPrimitive("tr"))
                }
            }
        }.onFailure { _state.value = _state.value.copy(error = it.message) }
        _state.value = _state.value.copy(busy = false)
    }

    fun signOut() = viewModelScope.launch { runCatching { supa.auth.signOut() } }
}
