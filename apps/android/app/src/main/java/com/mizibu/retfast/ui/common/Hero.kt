package com.mizibu.retfast.ui.common

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mizibu.retfast.R
import com.mizibu.retfast.ui.theme.AeroTokens.Brand
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.cos
import kotlin.math.sin

// Brand pieces for splash, onboarding and sign-in (always dark), mirroring iOS DesignSystem/Hero.swift.

/** Dark sky with a soft accent glow and faint terrain contours. */
@Composable
fun SkyBackdrop(modifier: Modifier = Modifier, glowY: Float = 0.38f, content: @Composable BoxScope.() -> Unit = {}) {
    Box(modifier.fillMaxSize().background(Brand.ink)) {
        Canvas(Modifier.fillMaxSize()) {
            drawRect(Brush.radialGradient(listOf(Brand.accent.copy(alpha = 0.14f), Color.Transparent), center = Offset(size.width / 2, size.height * glowY), radius = 360.dp.toPx()))
            val summit = Offset(size.width * 0.78f, size.height * 0.92f)
            for (i in 1..9) {
                val r = i * size.width * 0.12f
                val p = Path()
                for (k in 0..72) {
                    val a = k / 72.0 * 2 * Math.PI
                    val wobble = 1 + 0.07 * sin(a * 3 + i) + 0.04 * cos(a * 5 - i * 0.7)
                    val x = (summit.x + cos(a) * r * wobble * 1.25).toFloat()
                    val y = (summit.y + sin(a) * r * wobble * 0.7).toFloat()
                    if (k == 0) p.moveTo(x, y) else p.lineTo(x, y)
                }
                drawPath(p, Color.White.copy(alpha = 0.033f), style = Stroke(1.dp.toPx()))
            }
        }
        content()
    }
}

/** Retfast wing mark (same asset as iOS BrandMark). */
@Composable
fun BrandMark(size: Dp = 40.dp, color: Color = Color.White) {
    Image(painterResource(R.drawable.brand_mark), "Retfast", Modifier.width(size).height(size * 0.76f), colorFilter = ColorFilter.tint(color))
}

/** Launch splash: glow blooms, the mark springs in, the wordmark rises. */
@Composable
fun SplashView(onFinished: () -> Unit) {
    val bloom = remember { Animatable(0f) }
    val mark = remember { Animatable(0f) }
    val word = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        launch { bloom.animateTo(1f, tween(700)) }
        launch { delay(80); mark.animateTo(1f, spring(dampingRatio = 0.62f, stiffness = Spring.StiffnessLow)) }
        launch { delay(350); word.animateTo(1f, tween(400)) }
        delay(1250)
        onFinished()
    }
    Box(Modifier.fillMaxSize().background(Brand.ink), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize().alpha(bloom.value)) {
            drawRect(Brush.radialGradient(listOf(Brand.accent.copy(alpha = 0.22f), Color.Transparent), center = center, radius = (40 + 280 * bloom.value).dp.toPx()))
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Box(Modifier.graphicsLayer { val s = 0.72f + 0.28f * mark.value; scaleX = s; scaleY = s; alpha = mark.value.coerceIn(0f, 1f); rotationZ = -8f * (1 - mark.value) }) {
                BrandMark(120.dp)
            }
            Text("Retfast", Modifier.graphicsLayer { alpha = word.value; translationY = (1 - word.value) * 12.dp.toPx() }, color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Bold)
        }
    }
}

/** White capsule (primary action) for dark brand screens. */
@Composable
fun WhiteCapsuleButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, busy: Boolean = false, leading: (@Composable () -> Unit)? = null) =
    BrandCapsule(text, onClick, modifier, enabled, busy, Color.White, Color(0xFF121212), leading)

/** Translucent capsule (secondary action) for dark brand screens. */
@Composable
fun GlassCapsuleButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, leading: (@Composable () -> Unit)? = null) =
    BrandCapsule(text, onClick, modifier, enabled, false, Color.White.copy(alpha = 0.09f), Color.White, leading)

@Composable
private fun BrandCapsule(text: String, onClick: () -> Unit, modifier: Modifier, enabled: Boolean, busy: Boolean, bg: Color, fg: Color, leading: (@Composable () -> Unit)?) {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    Row(
        modifier.fillMaxWidth().heightIn(min = 52.dp).scale(if (pressed) 0.97f else 1f).alpha(if (!enabled) 0.4f else if (pressed) 0.85f else 1f)
            .clip(CircleShape).background(bg).clickable(src, null, enabled = enabled && !busy, role = Role.Button, onClick = onClick).padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
    ) {
        if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = fg, strokeWidth = 2.dp)
        else {
            if (leading != null) { leading(); Spacer(Modifier.width(10.dp)) }
            Text(text, color = fg, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

/** Field container for the dark auth screens. */
@Composable
fun AuthFieldBox(icon: ImageVector, content: @Composable () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(18.dp)).background(Color(0xFF1A1A1C)).padding(start = 16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(icon, null, tint = Color.White.copy(alpha = 0.5f), modifier = Modifier.size(20.dp))
        Box(Modifier.weight(1f)) { content() }
    }
}

/** Large onboarding illustration: icon on a glowing disc. */
@Composable
fun HeroIcon(icon: ImageVector, key: Any? = null) {
    val appear = remember(key) { Animatable(0.85f) }
    LaunchedEffect(key) { appear.snapTo(0.85f); appear.animateTo(1f, spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessLow)) }
    Box(Modifier.size(132.dp).scale(appear.value).clip(CircleShape).background(Brand.accent.copy(alpha = 0.16f)), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = Brand.accent, modifier = Modifier.size(54.dp))
    }
}
