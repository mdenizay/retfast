package com.mizibu.retfast

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Navigation
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.FlightTakeoff
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.mizibu.retfast.auth.AuthViewModel
import com.mizibu.retfast.core.EventRole
import com.mizibu.retfast.core.EventRow
import com.mizibu.retfast.events.EventsViewModel
import com.mizibu.retfast.pilot.PilotScreen
import com.mizibu.retfast.pilot.PilotViewModel
import com.mizibu.retfast.retriever.RetrieverScreen
import com.mizibu.retfast.retriever.RetrieverViewModel
import com.mizibu.retfast.ui.BigButton
import com.mizibu.retfast.ui.Hit
import com.mizibu.retfast.ui.RetfastAmber
import com.mizibu.retfast.ui.RetfastMuted
import com.mizibu.retfast.ui.RetfastSuccess
import com.mizibu.retfast.ui.RetfastTheme
import com.mizibu.retfast.ui.ScreenTitle
import com.mizibu.retfast.ui.SectionCard
import com.mizibu.retfast.ui.StatusPill

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            RetfastTheme {
                Surface(Modifier.fillMaxSize()) { RetfastApp() }
            }
        }
    }
}

@Composable
private fun RetfastApp() {
    val auth: AuthViewModel = viewModel()
    val state by auth.state.collectAsState()

    // Location + notification permissions are required before tracking can
    // start; ask up front so the pilot is not blocked at takeoff.
    val permissions = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { }
    LaunchedEffect(state.signedIn) {
        if (state.signedIn) {
            val perms = mutableListOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            )
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                perms.add(Manifest.permission.POST_NOTIFICATIONS)
            }
            permissions.launch(perms.toTypedArray())
        }
    }

    when {
        state.loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
        !state.signedIn -> LoginScreen(auth)
        else -> MainNav(auth)
    }
}

@Composable
private fun LoginScreen(auth: AuthViewModel) {
    val state by auth.state.collectAsState()
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var signUp by remember { mutableStateOf(false) }

    Column(
        Modifier.fillMaxSize().padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Surface(
            modifier = Modifier.size(64.dp),
            color = Color.Black,
            contentColor = Color.White,
            shape = RoundedCornerShape(20.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    imageVector = Icons.Default.Navigation,
                    contentDescription = null,
                    modifier = Modifier.size(32.dp),
                )
            }
        }
        Spacer(Modifier.size(16.dp))
        Text("LIVE FLIGHT OPERATIONS", color = RetfastAmber, style = MaterialTheme.typography.labelSmall)
        Text("RETFAST", fontWeight = FontWeight.Black, style = MaterialTheme.typography.headlineLarge)
        Spacer(Modifier.size(24.dp))
        if (signUp) {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Görünen ad") },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.size(8.dp))
        }
        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text("E-posta") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.size(8.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Şifre") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )
        state.error?.let {
            Spacer(Modifier.size(8.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.size(16.dp))
        BigButton(
            if (signUp) "Hesap oluştur" else "Giriş yap",
            Modifier.fillMaxWidth(),
            height = Hit.comfortable,
            enabled = !state.busy && email.isNotBlank() && password.length >= 8,
            onClick = {
                if (signUp) auth.signUp(email.trim(), password, name) else auth.signIn(email.trim(), password)
            },
        )
        TextButton(onClick = { signUp = !signUp }, modifier = Modifier.fillMaxWidth()) {
            Text(if (signUp) "Zaten hesabın var mı? Giriş yap" else "Hesabın yok mu? Oluştur")
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MainNav(auth: AuthViewModel) {
    val nav = rememberNavController()
    val authState by auth.state.collectAsState()
    val events: EventsViewModel = viewModel()
    val eventsState by events.state.collectAsState()

    LaunchedEffect(authState.userId) { authState.userId?.let { events.load(it) } }

    NavHost(nav, startDestination = "events") {
        composable("events") {
            Scaffold(
                topBar = {
                    TopAppBar(
                        title = {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Surface(color = Color.Black, contentColor = Color.White, shape = RoundedCornerShape(12.dp), modifier = Modifier.size(36.dp)) {
                                    Box(contentAlignment = Alignment.Center) { Icon(Icons.Default.Navigation, null, Modifier.size(18.dp)) }
                                }
                                Spacer(Modifier.size(10.dp))
                                Column {
                                    Text("FLIGHT OPERATIONS", color = RetfastAmber, style = MaterialTheme.typography.labelSmall)
                                    Text("RETFAST", fontWeight = FontWeight.Black, style = MaterialTheme.typography.titleMedium)
                                }
                            }
                        },
                        actions = { TextButton(onClick = { auth.signOut() }) { Text("Çıkış") } },
                        colors = TopAppBarDefaults.topAppBarColors(
                            containerColor = MaterialTheme.colorScheme.background,
                            titleContentColor = MaterialTheme.colorScheme.onBackground,
                        ),
                    )
                },
            ) { pad ->
                EventsList(
                    modifier = Modifier.padding(pad),
                    events = eventsState.events,
                    roles = eventsState.roles,
                    onOpen = { nav.navigate("event/${it.id}") },
                )
            }
        }
        composable("event/{id}") { entry ->
            val id = entry.arguments?.getString("id") ?: return@composable
            val event = eventsState.events.firstOrNull { it.id == id } ?: return@composable
            val roles = eventsState.roles[id].orEmpty()
            LaunchedEffect(id) { authState.userId?.let { events.loadTasks(id, it) } }
            EventDetail(
                event = event,
                roles = roles,
                openTask = eventsState.tasks.firstOrNull {
                    it.status == "active" || it.status == "landed"
                },
                onPilot = { nav.navigate("pilot/$id") },
                onRetriever = { nav.navigate("retriever/$id") },
                onBack = { nav.popBackStack() },
            )
        }
        composable("pilot/{id}") { entry ->
            val id = entry.arguments?.getString("id") ?: return@composable
            val vm = remember(id) { PilotViewModel(id) }
            PilotScreen(
                vm = vm,
                existingTask = eventsState.tasks.firstOrNull {
                    it.status == "active" || it.status == "landed"
                },
                onExit = { nav.popBackStack() },
            )
        }
        composable("retriever/{id}") { entry ->
            val id = entry.arguments?.getString("id") ?: return@composable
            val vm = remember(id) { RetrieverViewModel(id) }
            RetrieverScreen(vm = vm, onExit = { nav.popBackStack() })
        }
    }
}

@Composable
private fun EventsList(
    modifier: Modifier,
    events: List<EventRow>,
    roles: Map<String, List<EventRole>>,
    onOpen: (EventRow) -> Unit,
) {
    val mine = events.filter { roles[it.id].orEmpty().isNotEmpty() }
    LazyColumn(
        modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            ScreenTitle(
                kicker = "Görev merkezi",
                title = "Etkinliklerim",
                subtitle = "Uçuş, toplama ve canlı operasyon görevlerine tek ekrandan eriş.",
                modifier = Modifier.padding(top = 20.dp, bottom = 8.dp),
            )
        }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Card(Modifier.weight(1f), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.padding(14.dp)) {
                        Icon(Icons.Default.CalendarMonth, null, tint = RetfastAmber)
                        Spacer(Modifier.height(14.dp))
                        Text("${mine.size}", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                        Text("Aktif etkinlik", color = RetfastMuted, style = MaterialTheme.typography.bodySmall)
                    }
                }
                Card(Modifier.weight(1f), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.padding(14.dp)) {
                        Icon(Icons.Default.FlightTakeoff, null, tint = RetfastAmber)
                        Spacer(Modifier.height(14.dp))
                        Text("Hazır", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                        Text("Takip sistemi", color = RetfastMuted, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        if (mine.isEmpty()) {
            item { Text("Henüz etkinlik yok", style = MaterialTheme.typography.bodyMedium) }
        }
        items(mine) { e ->
            Card(
                onClick = { onOpen(e) },
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                shape = RoundedCornerShape(22.dp),
            ) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Surface(color = RetfastAmber.copy(alpha = .12f), contentColor = RetfastAmber, shape = RoundedCornerShape(14.dp), modifier = Modifier.size(42.dp)) {
                            Box(contentAlignment = Alignment.Center) { Icon(Icons.Default.Navigation, null, Modifier.size(20.dp)) }
                        }
                        Spacer(Modifier.size(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(e.name, style = MaterialTheme.typography.titleMedium)
                            Text(e.startsAt.take(10), color = RetfastMuted, style = MaterialTheme.typography.bodySmall)
                        }
                        Icon(Icons.Default.ArrowForward, null, tint = RetfastMuted)
                    }
                    if (e.description.isNotBlank()) Text(e.description, maxLines = 2, color = RetfastMuted, style = MaterialTheme.typography.bodySmall)
                    Text(
                        roles[e.id].orEmpty().joinToString(", ") { roleLabel(it) },
                        style = MaterialTheme.typography.labelMedium,
                        color = RetfastAmber,
                    )
                }
            }
        }
        item { Spacer(Modifier.height(24.dp)) }
    }
}

@Composable
private fun EventDetail(
    event: EventRow,
    roles: List<EventRole>,
    openTask: com.mizibu.retfast.core.TaskRow?,
    onPilot: () -> Unit,
    onRetriever: () -> Unit,
    onBack: () -> Unit,
) {
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("‹ Geri") }
            Spacer(Modifier.weight(1f))
            StatusPill("Sistem hazır", RetfastSuccess)
        }
        ScreenTitle("Görev alanı", event.name, event.description.takeIf { it.isNotBlank() })
        SectionCard("Rol ve görev") {
            Text(roles.joinToString(" · ") { roleLabel(it) }, color = RetfastMuted)
            Text("${event.startsAt.take(10)}  →  ${event.endsAt.take(10)}", style = MaterialTheme.typography.bodySmall, color = RetfastMuted)
        }
        Spacer(Modifier.weight(1f))
        if (roles.contains(EventRole.PILOT)) {
            BigButton(
                if (openTask == null) "Pilot görevini aç" else "Aktif uçuşa dön",
                Modifier.fillMaxWidth(),
                height = Hit.critical,
                onClick = onPilot,
            )
        }
        if (roles.contains(EventRole.RETRIEVER)) {
            BigButton(
                "Toplayıcı görev merkezini aç",
                Modifier.fillMaxWidth(),
                height = Hit.critical,
                container = MaterialTheme.colorScheme.secondaryContainer,
                content = MaterialTheme.colorScheme.onSecondaryContainer,
                onClick = onRetriever,
            )
        }
    }
}

private fun roleLabel(r: EventRole) = when (r) {
    EventRole.PILOT -> "Pilot"
    EventRole.RETRIEVER -> "Toplayıcı"
    EventRole.OBSERVER -> "Gözlemci"
    EventRole.EVENT_ADMIN -> "Etkinlik yöneticisi"
}
