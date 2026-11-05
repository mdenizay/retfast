package com.mizibu.retfast.ui

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Flight
import androidx.compose.material.icons.filled.Landscape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.mizibu.retfast.R
import com.mizibu.retfast.app.SessionState
import com.mizibu.retfast.domain.AuthGate
import com.mizibu.retfast.graph
import com.mizibu.retfast.retrieval.RetrievalStage
import com.mizibu.retfast.retrieval.SharingMode
import com.mizibu.retfast.retrieval.isTerminal
import com.mizibu.retfast.retrieval.server
import com.mizibu.retfast.retrieval.stage
import com.mizibu.retfast.ui.auth.AuthHost
import com.mizibu.retfast.ui.auth.ChangePasswordScreen
import com.mizibu.retfast.ui.events.EventScreen
import com.mizibu.retfast.ui.events.EventsListScreen
import com.mizibu.retfast.ui.flight.FlightComputerScreen
import com.mizibu.retfast.ui.flight.LandingPromptHost
import com.mizibu.retfast.ui.flight.RetrievalWaitingScreen
import com.mizibu.retfast.ui.flights.FlightDetailScreen
import com.mizibu.retfast.ui.flights.FlightsScreen
import com.mizibu.retfast.ui.common.Fmt
import com.mizibu.retfast.ui.onboarding.OnboardingScreen
import com.mizibu.retfast.ui.profile.DiagnosticsScreen
import com.mizibu.retfast.ui.profile.PermissionsScreen
import com.mizibu.retfast.ui.profile.ProfileScreen
import com.mizibu.retfast.ui.theme.Aero
import com.mizibu.retfast.ui.theme.RetfastTheme
import kotlinx.coroutines.delay

@Composable
fun RetfastRoot() {
    val g = LocalContext.current.graph
    val session by g.session.state.collectAsStateWithLifecycle()
    val onboarded by g.prefs.onboarded.collectAsStateWithLifecycle()
    val theme by g.prefs.theme.collectAsStateWithLifecycle()
    RetfastTheme(theme) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            when (val s = session) {
                SessionState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                else -> when {
                    !onboarded -> OnboardingScreen(onDone = { g.prefs.setOnboarded(true) })
                    s is SessionState.SignedOut -> AuthHost()
                    s is SessionState.SignedIn -> when (AuthGate.of(s.me)) {
                        // Forced password change: nothing else is reachable until it succeeds.
                        AuthGate.MustChangePassword -> ChangePasswordScreen(forced = true, email = s.me.email)
                        else -> if (s.offline && s.me.id.isEmpty()) OfflineStart() else MainHost(s.me.email)
                    }
                    else -> {}
                }
            }
        }
    }
}

@Composable
private fun OfflineStart() {
    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        CircularProgressIndicator()
        Text(stringResource(R.string.offline_start), Modifier.padding(top = 16.dp), style = MaterialTheme.typography.bodyMedium)
    }
}

private const val TAB_EVENTS = "events"
private const val TAB_FLIGHTS = "flights"
private const val TAB_PROFILE = "profile"

@Composable
private fun MainHost(email: String) {
    val g = LocalContext.current.graph
    val nav = rememberNavController()
    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route
    val tabRoutes = setOf(TAB_EVENTS, TAB_FLIGHTS, TAB_PROFILE)
    val isTab = route in tabRoutes

    Scaffold(
        contentWindowInsets = WindowInsets(0),
        bottomBar = {
            if (isTab) Column {
                ActivityBar(nav)
                NavigationBar {
                    NavigationBarItem(route == TAB_EVENTS, { nav.tab(TAB_EVENTS) }, { Icon(Icons.Filled.Landscape, null) }, label = { Text(stringResource(R.string.tab_events)) })
                    NavigationBarItem(route == TAB_FLIGHTS, { nav.tab(TAB_FLIGHTS) }, { Icon(Icons.Filled.Flight, null) }, label = { Text(stringResource(R.string.tab_flights)) })
                    NavigationBarItem(route == TAB_PROFILE, { nav.tab(TAB_PROFILE) }, { Icon(Icons.Filled.AccountCircle, null) }, label = { Text(stringResource(R.string.tab_profile)) })
                }
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = TAB_EVENTS, modifier = Modifier.padding(bottom = padding.calculateBottomPadding()).then(if (isTab) Modifier.statusBarsPadding() else Modifier)) {
            composable(TAB_EVENTS) { EventsListScreen(onOpen = { nav.navigate("event/$it") }) }
            composable(TAB_FLIGHTS) { FlightsScreen(onOpen = { nav.navigate("flight/$it") }) }
            composable(TAB_PROFILE) {
                ProfileScreen(
                    onDiagnostics = { nav.navigate("diagnostics") }, onPermissions = { nav.navigate("permissions") },
                    onOnboarding = { nav.navigate("onboarding") }, onChangePassword = { nav.navigate("password") },
                )
            }
            composable("event/{id}?retrieve={retrieve}", arguments = listOf(
                navArgument("id") { type = NavType.StringType },
                navArgument("retrieve") { type = NavType.BoolType; defaultValue = false },
            )) { e ->
                EventScreen(
                    eventId = e.arguments!!.getString("id")!!,
                    onBack = { nav.popBackStack() },
                    onOpenComputer = { nav.navigate("computer") },
                    onOpenWaiting = { nav.navigate("waiting/$it") },
                    onOpenPermissions = { nav.navigate("permissions") },
                    initialRetrieve = e.arguments!!.getBoolean("retrieve"),
                )
            }
            composable("flight/{id}") { e -> FlightDetailScreen(e.arguments!!.getString("id")!!, onBack = { nav.popBackStack() }) }
            composable("computer") {
                FlightComputerScreen(
                    onClose = { nav.popBackStack() },
                    onEndedWithRetrieve = { eventId ->
                        nav.popBackStack()
                        if (eventId != null) nav.navigate("event/$eventId?retrieve=true")
                    },
                )
            }
            composable("waiting/{id}") { e ->
                RetrievalWaitingScreen(e.arguments!!.getString("id")!!, onClose = { nav.popBackStack() })
            }
            composable("diagnostics") { DiagnosticsScreen() }
            composable("permissions") { Box(Modifier.safeDrawingPadding()) { PermissionsScreen() } }
            composable("onboarding") { OnboardingScreen(onDone = { nav.popBackStack() }, onSkip = { nav.popBackStack() }) }
            composable("password") { ChangePasswordScreen(forced = false, email = email, onClose = { nav.popBackStack() }) }
        }
    }

    // Landing prompt over any screen; and restore the waiting screen of an open retrieve on launch.
    LandingPromptHost(onEndedWithRetrieve = { eventId -> if (eventId != null) nav.navigate("event/$eventId?retrieve=true") })
    val localRetrievals by g.db.retrievals().observeRecent().collectAsStateWithLifecycle(emptyList())
    var restored by remember { androidx.compose.runtime.mutableStateOf(false) }
    LaunchedEffect(localRetrievals.firstOrNull()?.id) {
        if (!restored) {
            restored = true
            localRetrievals.firstOrNull { !it.isTerminal }?.let { nav.navigate("waiting/${it.id}") }
        }
    }
}

private fun NavHostController.tab(route: String) {
    navigate(route) {
        popUpTo(TAB_EVENTS) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

/** Persistent activity bar above the tab bar: recording / waiting for a retrieve / retriever duty. Tapping resumes it. */
@Composable
private fun ActivityBar(nav: NavHostController) {
    val g = LocalContext.current.graph
    val status by g.engine.status.collectAsStateWithLifecycle()
    val retrievals by g.db.retrievals().observeRecent().collectAsStateWithLifecycle(emptyList())
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(1000); now = System.currentTimeMillis() } }
    val active = retrievals.firstOrNull { !it.isTerminal && it.stage != RetrievalStage.REFUSED }
    val c = Aero.colors

    val (text, color, action) = when {
        status.recording -> Triple(
            stringResource(R.string.bar_recording, Fmt.duration((now - (status.startedAt ?: now)) / 1000)), c.trackingActive, { nav.navigate("computer") },
        )
        active != null -> Triple(
            when (active.stage) {
                RetrievalStage.ACCEPTED -> stringResource(R.string.bar_accepted, active.server?.retriever?.fullName.orEmpty())
                RetrievalStage.PICKED_UP -> stringResource(R.string.st_picked_up)
                RetrievalStage.SAVED_LOCALLY, RetrievalStage.SENDING -> stringResource(R.string.st_sending)
                else -> stringResource(R.string.bar_waiting)
            },
            c.retrieval, { nav.navigate("waiting/${active.id}") },
        )
        status.sharing is SharingMode.Retriever -> Triple(
            stringResource(R.string.bar_duty, status.duty?.activePickups ?: 0), c.secondary,
            { (status.sharing as SharingMode.Retriever).eventId.let { nav.navigate("event/$it") } },
        )
        else -> return
    }
    Row(
        Modifier.fillMaxWidth().background(color.copy(alpha = 0.18f)).clickable { action() }.padding(horizontal = 16.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
        Text(stringResource(R.string.bar_open), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
