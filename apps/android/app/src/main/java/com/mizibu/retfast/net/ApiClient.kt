package com.mizibu.retfast.net

import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.serializer
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

sealed class ApiException(message: String) : Exception(message) {
    /** Contract error body (or a bare status). */
    class Server(
        val status: Int,
        val code: String,
        val serverMessage: String?,
        val details: Map<String, String>,
        val retryAfter: Double?,
    ) : ApiException("$status $code")

    /** Transport failure. [offline] means "no usable network" rather than "server broken". */
    class Transport(val offline: Boolean, cause: Throwable? = null) : ApiException("transport offline=$offline") {
        init { cause?.let { initCause(it) } }
    }

    /** No credentials, or the refresh token was refused: the user must sign in again. */
    class NotAuthenticated : ApiException("not_authenticated")
    class Decoding(msg: String) : ApiException("decoding: $msg")
}

val ApiException.status: Int? get() = (this as? ApiException.Server)?.status
val ApiException.code: String? get() = (this as? ApiException.Server)?.code
val ApiException.isPasswordChangeRequired: Boolean get() = code == "password_change_required"

enum class AuthEvent { SessionExpired, PasswordChangeRequired }

/**
 * OkHttp + kotlinx.serialization client for the Retfast v1 API.
 *
 * Token refresh is single-flight: refresh tokens rotate on every use and re-using a rotated
 * token revokes the whole session family, so concurrent 401s share one `/auth/refresh` call
 * (a generation counter under a mutex: whoever arrives second sees a newer generation and
 * simply retries with the already-rotated access token).
 */
class ApiClient(
    baseUrl: String,
    private val http: OkHttpClient,
    private val tokens: TokenStore,
    val json: kotlinx.serialization.json.Json = ApiJson,
    private val clientName: String = "ios",
    private val deviceName: String? = null,
) {
    private val apiBase: HttpUrl = baseUrl.trimEnd('/').plus("/api/v1/").toHttpUrl()
    private val refreshMutex = Mutex()
    @Volatile private var accessToken: String? = null
    @Volatile private var accessExpiresAtMs: Long? = null
    @Volatile private var generation = 0
    @Volatile var refreshCount = 0
        private set

    private val _authEvents = MutableSharedFlow<AuthEvent>(extraBufferCapacity = 8)
    val authEvents: SharedFlow<AuthEvent> = _authEvents

    val hasRefreshToken: Boolean get() = tokens.loadRefreshToken() != null
    val currentAccessToken: String? get() = accessToken

    fun clearSession() {
        accessToken = null
        accessExpiresAtMs = null
        tokens.saveRefreshToken(null)
    }

    // ---- core

    suspend fun <T> send(
        method: String,
        path: String,
        serializer: KSerializer<T>,
        query: Map<String, String> = emptyMap(),
        body: String? = null,
        authenticated: Boolean = true,
        timeoutSeconds: Long = 30,
    ): T {
        val raw = sendRaw(method, path, query, body, authenticated, timeoutSeconds)
        return try {
            json.decodeFromString(serializer, raw)
        } catch (e: Exception) {
            throw ApiException.Decoding(e.message ?: e.javaClass.simpleName)
        }
    }

    suspend inline fun <reified T> get(path: String, query: Map<String, String> = emptyMap(), authenticated: Boolean = true): T =
        send("GET", path, serializer<T>(), query, null, authenticated)

    suspend inline fun <reified R, reified T> post(path: String, body: R, authenticated: Boolean = true): T =
        send("POST", path, serializer<T>(), emptyMap(), encode(body), authenticated)

    suspend inline fun <reified T> postEmpty(path: String): T = send("POST", path, serializer<T>(), emptyMap(), "{}")

    suspend inline fun <reified R> encodeAndSendNoContent(method: String, path: String, body: R?, authenticated: Boolean = true) {
        sendRaw(method, path, emptyMap(), body?.let { encode(it) } ?: "{}", authenticated)
    }

    inline fun <reified R> encode(body: R): String = json.encodeToString(serializer<R>(), body)

    suspend fun sendRaw(
        method: String,
        path: String,
        query: Map<String, String> = emptyMap(),
        body: String? = null,
        authenticated: Boolean = true,
        timeoutSeconds: Long = 30,
    ): String {
        if (authenticated) {
            val exp = accessExpiresAtMs
            val needs = accessToken == null || (exp != null && exp - System.currentTimeMillis() < 30_000)
            if (needs) {
                if (tokens.loadRefreshToken() != null) refresh(generation)
                else if (accessToken == null) throw ApiException.NotAuthenticated()
            }
        }
        val gen = generation
        return try {
            perform(method, path, query, body, authenticated, timeoutSeconds)
        } catch (e: ApiException.Server) {
            if (authenticated && e.status == 401 && e.code == "token_expired") {
                // Refresh once (shared with concurrent callers) and retry the *same* request body.
                refresh(gen)
                perform(method, path, query, body, authenticated, timeoutSeconds)
            } else {
                throw e
            }
        }
    }

    private suspend fun perform(
        method: String,
        path: String,
        query: Map<String, String>,
        body: String?,
        authenticated: Boolean,
        timeoutSeconds: Long,
    ): String {
        val url = apiBase.newBuilder().apply {
            path.trimStart('/').split('/').filter { it.isNotEmpty() }.forEach { addPathSegment(it) }
            query.forEach { (k, v) -> addQueryParameter(k, v) }
        }.build()
        val rb = body?.toRequestBody(JSON_MEDIA) ?: if (method == "GET" || method == "DELETE") null else "".toRequestBody(null)
        val req = Request.Builder().url(url).method(method, rb)
            .header("Accept", "application/json")
            .apply { if (authenticated) accessToken?.let { header("Authorization", "Bearer $it") } }
            .build()
        val call = http.newBuilder().callTimeout(timeoutSeconds, TimeUnit.SECONDS).build().newCall(req)
        val response = try {
            call.await()
        } catch (e: IOException) {
            throw ApiException.Transport(offline = isOffline(e), cause = e)
        }
        response.use { r ->
            val text = r.body?.string().orEmpty()
            if (r.isSuccessful) return text
            val inner = runCatching { json.decodeFromString(ErrorBody.serializer(), text).error }.getOrNull()
            val details = inner?.details?.mapValues { (_, v) -> (v as? JsonPrimitive)?.content ?: v.toString() } ?: emptyMap()
            val err = ApiException.Server(
                status = r.code,
                code = inner?.code?.takeIf { it.isNotEmpty() } ?: defaultCode(r.code),
                serverMessage = inner?.message,
                details = details,
                retryAfter = r.header("Retry-After")?.toDoubleOrNull(),
            )
            if (err.isPasswordChangeRequired) _authEvents.tryEmit(AuthEvent.PasswordChangeRequired)
            throw err
        }
    }

    // ---- tokens

    /** Single-flight refresh keyed by the generation observed before the failing call. */
    suspend fun refresh(seenGeneration: Int = generation): AuthResponse? = refreshMutex.withLock {
        if (generation != seenGeneration) return@withLock null // someone refreshed while we waited
        val token = tokens.loadRefreshToken()
        if (token == null) {
            accessToken = null
            throw ApiException.NotAuthenticated()
        }
        refreshCount++
        try {
            val raw = perform("POST", "auth/refresh", emptyMap(), encode(RefreshRequest(token)), false, 30)
            val auth = json.decodeFromString(AuthResponse.serializer(), raw)
            apply(auth)
            auth
        } catch (e: ApiException.Server) {
            if (e.status == 401 || e.status == 403) {
                clearSession()
                _authEvents.tryEmit(AuthEvent.SessionExpired)
                throw ApiException.NotAuthenticated()
            }
            throw e
        } catch (e: kotlinx.serialization.SerializationException) {
            throw ApiException.Decoding(e.message ?: "")
        }
    }

    fun apply(auth: AuthResponse) {
        accessToken = auth.accessToken
        accessExpiresAtMs = com.mizibu.retfast.util.Iso.parse(auth.accessExpiresAt)
        auth.refreshToken?.let { tokens.saveRefreshToken(it) }
        generation++
    }

    // ---- auth endpoints

    suspend fun login(email: String, password: String): AuthResponse {
        val auth: AuthResponse = post("auth/login", LoginRequest(email.trim(), password, clientName, deviceName), authenticated = false)
        apply(auth); return auth
    }

    suspend fun register(email: String, password: String, fullName: String): AuthResponse {
        val auth: AuthResponse = post("auth/register", RegisterRequest(email.trim(), password, fullName.trim(), clientName, deviceName), authenticated = false)
        apply(auth); return auth
    }

    suspend fun changePassword(current: String, new: String): AuthResponse {
        val auth: AuthResponse = post("auth/password/change", ChangePasswordRequest(current, new))
        apply(auth); return auth
    }

    suspend fun logout() {
        val rt = tokens.loadRefreshToken()
        try {
            sendRaw("POST", "auth/logout", body = encode(LogoutRequest(rt)))
        } catch (_: ApiException) {
        } finally {
            clearSession()
        }
    }

    suspend fun forgotPassword(email: String) { sendRaw("POST", "auth/password/forgot", body = encode(ForgotRequest(email.trim())), authenticated = false) }
    suspend fun resetPassword(token: String, newPassword: String) { sendRaw("POST", "auth/password/reset", body = encode(ResetRequest(token.trim(), newPassword)), authenticated = false) }

    companion object {
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

        fun defaultCode(status: Int) = when (status) {
            401 -> "unauthorized"; 403 -> "forbidden"; 404 -> "not_found"; 409 -> "conflict"
            429 -> "rate_limited"; 503 -> "unavailable"; 400, 422 -> "validation_failed"; else -> "internal"
        }

        fun isOffline(e: IOException) = e is UnknownHostException || e is ConnectException || e is SocketTimeoutException ||
            e is java.io.InterruptedIOException || e is javax.net.ssl.SSLException

        fun buildHttp(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .pingInterval(0, TimeUnit.SECONDS)
            .build()
    }
}

private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont: CancellableContinuation<Response> ->
    cont.invokeOnCancellation { runCatching { cancel() } }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) { if (cont.isActive) cont.resumeWithException(e) }
        override fun onResponse(call: Call, response: Response) { cont.resume(response) }
    })
}
