package com.mizibu.retfast.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

val RetfastAmber = Color(0xFFF3A712)
val RetfastAmberSoft = Color(0xFFFFC857)
val RetfastGraphite = Color(0xFF0D0E10)
val RetfastSurface = Color(0xFF1B1B19)
val RetfastSurfaceHigh = Color(0xFF25241F)
val RetfastIvory = Color(0xFFFFF4D6)
val RetfastMuted = Color(0xFFA8A292)
val RetfastSuccess = Color(0xFF43D39E)

private val RetfastColors = darkColorScheme(
    primary = RetfastAmber,
    onPrimary = RetfastGraphite,
    primaryContainer = Color(0xFF4C3608),
    onPrimaryContainer = RetfastIvory,
    secondary = RetfastAmberSoft,
    onSecondary = RetfastGraphite,
    secondaryContainer = RetfastSurfaceHigh,
    onSecondaryContainer = RetfastIvory,
    background = RetfastGraphite,
    onBackground = RetfastIvory,
    surface = RetfastSurface,
    onSurface = RetfastIvory,
    surfaceVariant = RetfastSurfaceHigh,
    onSurfaceVariant = Color(0xFFBEB7A5),
    outline = Color(0xFF565043),
    error = Color(0xFFFF6B5F),
)

private val RetfastShapes = Shapes(
    extraSmall = RoundedCornerShape(10.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(24.dp),
)

@Composable
fun RetfastTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = RetfastColors,
        typography = Typography(
            headlineLarge = Typography().headlineLarge.copy(fontWeight = FontWeight.Black, letterSpacing = (-1.2).sp),
            headlineMedium = Typography().headlineMedium.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.7).sp),
            titleLarge = Typography().titleLarge.copy(fontWeight = FontWeight.Bold),
            titleMedium = Typography().titleMedium.copy(fontWeight = FontWeight.SemiBold),
            labelSmall = Typography().labelSmall.copy(fontWeight = FontWeight.Bold, letterSpacing = 1.1.sp),
        ),
        shapes = RetfastShapes,
        content = content,
    )
}

/**
 * Touch-target tiers, matching the iOS app (ControlStyles.swift).
 *
 * These screens are used outdoors, with gloves, often one-handed — Material's
 * 48dp minimum is the floor, and in-flight primary actions get 60dp.
 */
object Hit {
    val min = 48.dp
    val comfortable = 52.dp
    val critical = 60.dp
}

@Composable
fun BigButton(
    text: String,
    modifier: Modifier = Modifier,
    height: androidx.compose.ui.unit.Dp = Hit.comfortable,
    container: Color = MaterialTheme.colorScheme.primary,
    content: Color = MaterialTheme.colorScheme.onPrimary,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.defaultMinSize(minHeight = height),
        colors = ButtonDefaults.buttonColors(containerColor = container, contentColor = content),
        shape = RoundedCornerShape(16.dp),
    ) {
        Text(text, style = MaterialTheme.typography.titleSmall)
    }
}

/** Labelled numeric readout used across the pilot HUD and roster rows. */
@Composable
fun Readout(
    label: String,
    value: String,
    unit: String? = null,
    tint: Color? = null,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                value,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp,
                color = tint ?: MaterialTheme.colorScheme.onSurface,
            )
            if (unit != null) {
                Text(
                    unit,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
fun SectionCard(title: String, content: @Composable () -> Unit) {
    Card(
        Modifier.fillMaxWidth().padding(vertical = 6.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(22.dp),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title.uppercase(), style = MaterialTheme.typography.labelSmall, color = RetfastAmber)
            content()
        }
    }
}

@Composable
fun StatusPill(text: String, color: Color, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .border(1.dp, color.copy(alpha = .22f), CircleShape)
            .background(color.copy(alpha = .10f), CircleShape)
            .padding(horizontal = 11.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Box(Modifier.background(color, CircleShape).defaultMinSize(minWidth = 7.dp, minHeight = 7.dp))
        Text(text, style = MaterialTheme.typography.labelMedium, color = color)
    }
}

@Composable
fun ScreenTitle(kicker: String, title: String, subtitle: String? = null, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(kicker.uppercase(), style = MaterialTheme.typography.labelSmall, color = RetfastAmber)
        Text(title, style = MaterialTheme.typography.headlineMedium)
        if (subtitle != null) {
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = RetfastMuted)
        }
    }
}
