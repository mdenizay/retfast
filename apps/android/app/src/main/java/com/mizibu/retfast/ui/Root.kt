package com.mizibu.retfast.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import com.mizibu.retfast.ui.common.Fmt
import com.mizibu.retfast.ui.common.SkyBackdrop
import com.mizibu.retfast.ui.common.SplashView
import com.mizibu.retfast.ui.common.TopBar
import com.mizibu.retfast.ui.events.EventScreen
import com.mizibu.retfast.ui.events.EventsListScreen
import com.mizibu.retfast.ui.flight.FlightComputerScreen
import com.mizibu.retfast.ui.flight.LandingPromptHost
import com.mizibu.retfast.ui.flight.RetrievalWaitingScreen
import com.mizibu.retfast.ui.flights.FlightDetailScreen
import com.mizibu.retfast.ui.flights.FlightsScreen
import com.mizibu.retfast.ui.onboarding.OnboardingScreen
import com.mizibu.retfast.ui.profile.DiagnosticsScreen
import com.mizibu.retfast.ui.profile.PermissionsScreen
import com.mizibu.retfast.ui.profile.ProfileScreen
import com.mizibu.retfast.ui.theme.Aero
import com.mizibu.retfast.ui.theme.AeroTokens.Brand
import com.mizibu.retfast.ui.theme.Lucide
import com.mizibu.retfast.ui.theme.RetfastTheme
import kotlinx.coroutines.delay

@Composable
fun RetfastRoot() {
    val g = LocalContext.current.graph
    val session by g.session.state.collectAsStateWithLifecycle()
    val onboarded by g.prefs.onboarded.collectAsStateWithLifecycle()
    val theme by g.prefs.theme.collectAsStateWithLifecycle()
    var splash by rememberSaveable { mutableStateOf(true) }
    RetfastTheme(theme) {
        Box(Modifier.fillMaxSize().background(Aero.colors.background)) {
            val phase = when (val s = session) {
                SessionState.Loading -> "loading"
                SessionState.SignedOut -> if (onboarded) "auth" else "onboarding"
                is SessionState.SignedIn -> when {
                    !onboarded -> "onboarding"
                    AuthGate.of(s.me) == AuthGate.MustChangePassword -> "password"
                    s.offline && s.me.id.isEmpty() -> "offline"
                    else -> "main"
                }
            }
            Crossfade(phase, label = "phase") { p ->
                when (p) {
                    "loading" -> Box(Modifier.fillMaxSize().background(Brand.ink))
                    "onboarding" -> OnboardingScreen(onDone = { g.prefs.setOnboarded(true) })
                    "auth" -> AuthHost()
                    // Forced password change: nothing else is reachable until it succeeds.
                    "password" -> (session as? SessionState.SignedIn)?.let { ChangePasswordScreen(forced = true, email = it.me.email) }
                    "offline" -> OfflineStart()
                    else -> MainHost((session as? SessionState.SignedIn)?.me?.email.orEmpty())
                }
            }
            AnimatedVisibility(splash, enter = fadeIn(), exit = fadeOut(tween(450)) + scaleOut(targetScale = 1.08f, animationSpec = tween(450))) {
                SplashView { splash = false }
            }
        }
    }
}

@Composable
private fun OfflineStart() {
    SkyBackdrop {
        Column(Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(color = Brand.accent, strokeWidth = 2.5.dp)
            Text(stringResource(R.string.offline_start), Modifier.padding(top = 16.dp), color = Color.White.copy(alpha = 0.75f), fontSize = 15.sp)
        }
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
    val isTab = route in setOf(TAB_EVENTS, TAB_FLIGHTS, TAB_PROFILE)

    Column(Modifier.fillMaxSize()) {
        NavHost(nav, startDestination = TAB_EVENTS, modifier = Modifier.weight(1f).then(if (isTab) Modifier.statusBarsPadding() else Modifier)) {
            composable(TAB_EVENTS) { EventsListScreen(onOpen = { nav.navigate("event/$it") }, onProfile = { nav.tab(TAB_PROFILE) }) }
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
            composable("waiting/{id}") { e -> RetrievalWaitingScreen(e.arguments!!.getString("id")!!, onClose = { nav.popBackStack() }) }
            composable("diagnostics") { Pushed(R.string.diagnostics, { nav.popBackStack() }) { DiagnosticsScreen() } }
            composable("permissions") { Pushed(R.string.permissions_title, { nav.popBackStack() }) { PermissionsScreen() } }
            composable("onboarding") { OnboardingScreen(onDone = { nav.popBackStack() }, onSkip = { nav.popBackStack() }) }
            composable("password") { ChangePasswordScreen(forced = false, email = email, onClose = { nav.popBackStack() }) }
        }
        if (isTab) {
            ActivityBar(nav)
            TabBar(route) { nav.tab(it) }
        }
    }

    // Landing prompt over any screen; and restore the waiting screen of an open retrieve on launch.
    LandingPromptHost(onEndedWithRetrieve = { eventId -> if (eventId != null) nav.navigate("event/$eventId?retrieve=true") })
    val localRetrievals by g.db.retrievals().observeRecent().collectAsStateWithLifecycle(emptyList())
    var restored by remember { mutableStateOf(false) }
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

@Composable
private fun TabBar(route: String?, onSelect: (String) -> Unit) {
    val c = Aero.colors
    Column(Modifier.fillMaxWidth().background(c.surface)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.border.copy(alpha = 0.5f)))
        Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 8.dp, vertical = 6.dp)) {
            listOf(
                Triple(TAB_EVENTS, R.string.tab_events, Lucide.Flag),
                Triple(TAB_FLIGHTS, R.string.tab_flights, Lucide.Route),
                Triple(TAB_PROFILE, R.string.tab_profile, Lucide.CircleUser),
            ).forEach { (r, label, icon) -> TabItem(stringResource(label), icon, route == r, Modifier.weight(1f)) { onSelect(r) } }
        }
    }
}

@Composable
private fun TabItem(label: String, icon: ImageVector, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val c = Aero.colors
    val tint = if (selected) c.primary else c.textMuted
    Column(
        modifier.heightIn(min = 52.dp).clip(CircleShape).clickable(role = Role.Tab, onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        Box(Modifier.clip(CircleShape).background(if (selected) c.primary.copy(alpha = 0.14f) else Color.Transparent).padding(horizontal = 18.dp, vertical = 4.dp)) {
            Icon(icon, null, tint = tint, modifier = Modifier.size(22.dp))
        }
        Text(label, color = tint, fontSize = 11.sp, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium, modifier = Modifier.padding(top = 2.dp))
    }
}

/** Capsules above the tab bar: recording, an open retrieve, retriever duty. Tapping resumes it. */
@Composable
private fun ActivityBar(nav: NavHostController) {
    val g = LocalContext.current.graph
    val status by g.engine.status.collectAsStateWithLifecycle()
    val retrievals by g.db.retrievals().observeRecent().collectAsStateWithLifecycle(emptyList())
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(1000); now = System.currentTimeMillis() } }
    val active = retrievals.firstOrNull { !it.isTerminal && it.stage != RetrievalStage.REFUSED }
    val c = Aero.colors

    Column(Modifier.fillMaxWidth().padding(vertical = if (status.recording || active != null || status.sharing is SharingMode.Retriever) 4.dp else 0.dp)) {
        if (status.recording) {
            val pulse by rememberInfiniteTransition(label = "pulse").animateFloat(1f, 0.35f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "a")
            Capsule(c.trackingActive, c.onPrimary, { nav.navigate("computer") }) {
                Icon(Lucide.CircleDot, null, Modifier.size(18.dp).alpha(pulse), tint = c.onPrimary)
                Text(stringResource(R.string.bar_rec), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.onPrimary)
                Text(Fmt.duration((now - (status.startedAt ?: now)) / 1000), fontSize = 15.sp, color = c.onPrimary, style = androidx.compose.ui.text.TextStyle(fontFeatureSettings = "tnum"))
                Spacer(Modifier.weight(1f))
                Text(stringResource(R.string.bar_back_to_flight), fontSize = 15.sp, color = c.onPrimary)
            }
        }
        if (active != null) {
            val (label, icon) = when (active.stage) {
                RetrievalStage.ACCEPTED -> stringResource(R.string.bar_accepted, active.server?.retriever?.fullName.orEmpty()) to Lucide.Car
                RetrievalStage.PICKED_UP -> stringResource(R.string.st_picked_up) to Lucide.CircleCheck
                RetrievalStage.SAVED_LOCALLY, RetrievalStage.SENDING -> stringResource(R.string.st_sending) to Lucide.CloudUpload
                else -> stringResource(R.string.bar_waiting) to Lucide.Hourglass
            }
            Capsule(c.secondary, c.onSecondary, { nav.navigate("waiting/${active.id}") }) {
                Icon(icon, null, Modifier.size(18.dp), tint = c.onSecondary)
                Text(label, Modifier.weight(1f), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.onSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("Retrieve", fontSize = 15.sp, color = c.onSecondary)
            }
        } else if (status.sharing is SharingMode.Retriever) {
            val ev = (status.sharing as SharingMode.Retriever).eventId
            Capsule(c.retrieval, Color.White, { nav.navigate("event/$ev") }) {
                Icon(Lucide.Car, null, Modifier.size(18.dp), tint = Color.White)
                Text(stringResource(R.string.bar_duty, status.duty?.activePickups ?: 0), Modifier.weight(1f), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun Capsule(bg: Color, fg: Color, onClick: () -> Unit, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Row(
        Modifier.padding(horizontal = 12.dp, vertical = 4.dp).fillMaxWidth().heightIn(min = 48.dp)
            .shadow(8.dp, CircleShape, ambientColor = Color.Black.copy(alpha = 0.18f), spotColor = Color.Black.copy(alpha = 0.18f))
            .clip(CircleShape).background(bg).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        content()
        Icon(Lucide.ChevronUp, null, Modifier.size(16.dp).width(16.dp), tint = fg)
    }
}

@Composable
private fun Pushed(title: Int, onBack: () -> Unit, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize().background(Aero.colors.background).statusBarsPadding()) {
        TopBar(stringResource(title), onBack)
        Box(Modifier.weight(1f)) { content() }
    }
}
