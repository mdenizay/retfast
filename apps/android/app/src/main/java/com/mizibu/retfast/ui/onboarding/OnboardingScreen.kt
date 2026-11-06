package com.mizibu.retfast.ui.onboarding

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mizibu.retfast.R
import com.mizibu.retfast.ui.common.BrandMark
import com.mizibu.retfast.ui.common.HeroIcon
import com.mizibu.retfast.ui.common.SkyBackdrop
import com.mizibu.retfast.ui.common.WhiteCapsuleButton
import com.mizibu.retfast.ui.theme.AeroTokens.Brand
import com.mizibu.retfast.ui.theme.Lucide
import kotlinx.coroutines.launch

private data class Page(val icon: ImageVector?, val title: Int, val body: Int)

private val pages = listOf(
    Page(null, R.string.tagline, R.string.obn1_body),
    Page(Lucide.Users, R.string.obn2_title, R.string.obn2_body),
    Page(Lucide.Navigation, R.string.obn3_title, R.string.obn3_body),
    Page(Lucide.ShieldAlert, R.string.obn4_title, R.string.obn4_body),
)

/** Dark brand onboarding; the last page holds the "not an emergency service" acknowledgement (mirrors iOS). */
@Composable
fun OnboardingScreen(onDone: () -> Unit, onSkip: (() -> Unit)? = null) {
    val state = rememberPagerState { pages.size }
    val scope = rememberCoroutineScope()
    var ack by remember { mutableStateOf(false) }
    val last = state.currentPage == pages.lastIndex
    SkyBackdrop(glowY = 0.3f) {
        Column(Modifier.fillMaxSize().safeDrawingPadding()) {
            Row(Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                if (onSkip != null) TopLink(stringResource(R.string.close), onSkip)
                Spacer(Modifier.weight(1f))
                if (!last) TopLink(stringResource(R.string.skip)) { scope.launch { state.animateScrollToPage(pages.lastIndex) } }
            }
            HorizontalPager(state, Modifier.weight(1f)) { i -> PageView(pages[i], i) }
            Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                AnimatedVisibility(last, enter = slideInVertically { it } + fadeIn(), exit = slideOutVertically { it } + fadeOut()) {
                    Row(
                        Modifier.widthIn(max = 520.dp).fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Color(0xFF1A1A1C)).clickable { ack = !ack }.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text(stringResource(R.string.ob_ack), Modifier.weight(1f), color = Color.White.copy(alpha = 0.85f), fontSize = 13.sp, lineHeight = 18.sp)
                        Switch(ack, { ack = it }, colors = SwitchDefaults.colors(checkedTrackColor = Brand.accent, checkedThumbColor = Brand.ink))
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    repeat(pages.size) { i ->
                        val w by animateDpAsState(if (i == state.currentPage) 22.dp else 7.dp, spring(dampingRatio = 0.8f), label = "dot")
                        Box(Modifier.height(7.dp).size(w, 7.dp).clip(CircleShape).background(Color.White.copy(alpha = if (i == state.currentPage) 1f else 0.28f)))
                    }
                }
                WhiteCapsuleButton(
                    stringResource(if (last) R.string.ob_finish else R.string.continue_btn),
                    { if (last) onDone() else scope.launch { state.animateScrollToPage(state.currentPage + 1) } },
                    Modifier.widthIn(max = 520.dp),
                    enabled = !last || ack,
                )
            }
        }
    }
}

@Composable
private fun TopLink(text: String, onClick: () -> Unit) {
    Text(text, Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onClick).padding(8.dp), color = Color.White.copy(alpha = 0.6f), fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
}

@Composable
private fun PageView(p: Page, index: Int) {
    Column(Modifier.fillMaxSize().padding(horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Box(Modifier.height(240.dp), contentAlignment = Alignment.Center) {
            if (p.icon == null) {
                Box(Modifier.size(132.dp).clip(RoundedCornerShape(38.dp)).background(Brand.accent), contentAlignment = Alignment.Center) { BrandMark(64.dp, Brand.ink) }
            } else HeroIcon(p.icon, index)
        }
        Spacer(Modifier.height(24.dp))
        Text(stringResource(p.title), color = Color.White, fontSize = 32.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, lineHeight = 38.sp)
        Spacer(Modifier.height(12.dp))
        Text(stringResource(p.body), Modifier.widthIn(max = 480.dp), color = Color.White.copy(alpha = 0.68f), fontSize = 17.sp, textAlign = TextAlign.Center, lineHeight = 24.sp)
    }
}
