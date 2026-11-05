package com.mizibu.retfast.ui.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.mizibu.retfast.R
import com.mizibu.retfast.ui.common.PrimaryButton
import kotlinx.coroutines.launch

private data class Page(val title: Int, val body: Int)

private val pages = listOf(
    Page(R.string.ob1_title, R.string.ob1_body),
    Page(R.string.ob2_title, R.string.ob2_body),
    Page(R.string.ob3_title, R.string.ob3_body),
    Page(R.string.ob4_title, R.string.ob4_body),
    Page(R.string.ob5_title, R.string.ob5_body),
    Page(R.string.ob6_title, R.string.ob6_body),
    Page(R.string.ob7_title, R.string.ob7_body),
)

/** Seven pages; the last one requires the "not an emergency service" acknowledgement. */
@Composable
fun OnboardingScreen(onDone: () -> Unit, onSkip: (() -> Unit)? = null) {
    val state = rememberPagerState { pages.size }
    val scope = rememberCoroutineScope()
    var ack by remember { mutableStateOf(false) }
    val last = state.currentPage == pages.lastIndex
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.End) {
            if (onSkip != null) TextButton(onClick = onSkip) { Text(stringResource(R.string.close)) }
        }
        HorizontalPager(state, Modifier.weight(1f)) { i ->
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("${i + 1} / ${pages.size}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                Text(stringResource(pages[i].title), style = MaterialTheme.typography.headlineMedium)
                Text(stringResource(pages[i].body), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (i == pages.lastIndex) {
                    Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(ack, { ack = it })
                        Text(stringResource(R.string.ob_ack), style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.Center) {
            repeat(pages.size) { i ->
                Box(
                    Modifier.padding(3.dp).size(if (i == state.currentPage) 18.dp else 8.dp, 8.dp)
                        .background(if (i == state.currentPage) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline, CircleShape),
                )
            }
        }
        Column(Modifier.padding(horizontal = 24.dp, vertical = 8.dp)) {
            PrimaryButton(
                stringResource(if (last) R.string.ob_start else R.string.next),
                onClick = { if (last) onDone() else scope.launch { state.animateScrollToPage(state.currentPage + 1) } },
                enabled = !last || ack,
                large = true,
            )
            Spacer(Modifier.height(8.dp))
        }
    }
}
