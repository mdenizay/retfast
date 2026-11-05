package com.mizibu.retfast.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import com.mizibu.retfast.AppForeground
import com.mizibu.retfast.BuildConfig
import com.mizibu.retfast.data.AppDatabase
import com.mizibu.retfast.net.ApiClient
import com.mizibu.retfast.net.DeviceInfo
import com.mizibu.retfast.net.KeystoreTokenStore
import com.mizibu.retfast.net.RealtimeClient
import com.mizibu.retfast.retrieval.RetrievalManager
import com.mizibu.retfast.sync.SyncEngine
import com.mizibu.retfast.sync.SyncWorker
import com.mizibu.retfast.tracking.Notifications
import com.mizibu.retfast.tracking.TrackingEngine
import com.mizibu.retfast.tracking.TrackingService
import com.mizibu.retfast.util.SystemClock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/** Manual dependency graph (process lifetime). */
class AppGraph(private val context: Context) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val prefs = Prefs(context)
    val db: AppDatabase = AppDatabase.open(context)
    val tokens = KeystoreTokenStore(context)
    val api = ApiClient(
        baseUrl = BuildConfig.API_BASE_URL, http = ApiClient.buildHttp(), tokens = tokens,
        clientName = "ios", // the v1 API only knows "web" | "ios"; "ios" selects the body-token (non-cookie) flow
        deviceName = "${Build.MANUFACTURER} ${Build.MODEL}".take(60),
    )
    val device = DeviceInfo("android", BuildConfig.VERSION_NAME, Build.VERSION.RELEASE)
    val sync = SyncEngine(db, api, SystemClock, device = device)
    val retrievals = RetrievalManager(db, api, scope)
    val engine = TrackingEngine(
        context, db, api, retrievals, scope, SystemClock,
        onSamplesStored = { sync.kick() },
        onLandingPrompt = { if (!AppForeground.state.value) Notifications.landingPrompt(context) },
    )
    val session = SessionManager(api, scope, onSignedIn = { sync.authRestored(); scheduleSync(); scope.launch { retrievals.resumeAll(); engine.restore() } })
    val realtime = RealtimeClient(BuildConfig.WS_BASE_URL, api, scope)

    private val _online = MutableStateFlow(true)
    val online: StateFlow<Boolean> = _online

    fun scheduleSync() = SyncWorker.schedule(context)

    fun start() {
        Notifications.ensureChannels(context)
        monitorNetwork()
        scope.launch { session.restore() }
        // The engine is restored by MainActivity.onStart (visible) or TrackingService (foreground service), never from a bare background start.

        // Foreground service follows the engine's needs (starts only from a visible/user context on Android 12+).
        scope.launch {
            engine.status.map { it.needsService }.distinctUntilChanged().collect { needs ->
                if (needs) {
                    if (!TrackingService.start(context)) scope.launch { /* surfaced in diagnostics via engine status */ }
                }
            }
        }
        // In-process sync loop: while recording, while the app is visible, or while there is unsent data.
        scope.launch {
            combine(engine.status.map { it.recording }, AppForeground.state, sync.snapshot.map { it.pendingCount > 0 }) { rec, fg, pend -> rec || fg || pend }
                .distinctUntilChanged()
                .collect { run -> if (run) sync.start(scope) else sync.stop() }
        }
        // Keep the pending counter fresh and make sure a constrained retry exists whenever data is unsent.
        scope.launch {
            db.samples().observePendingCount().collect { n ->
                sync.refreshCounters()
                if (n > 0) scheduleSync()
            }
        }
        // Retry a failed cold start (offline) until the profile can be loaded.
        scope.launch {
            session.state.collect { st ->
                if (st is SessionState.SignedIn && st.offline) {
                    delay(15_000)
                    session.restore()
                }
            }
        }
    }

    private fun monitorNetwork() {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        fun now(): Boolean {
            val caps = cm.getNetworkCapabilities(cm.activeNetwork)
            return caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        }
        _online.value = now()
        sync.networkChanged(_online.value)
        cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { _online.value = true; sync.networkChanged(true); retrievals.kickAll() }
            override fun onLost(network: Network) { _online.value = false; sync.networkChanged(false) }
        })
    }
}
