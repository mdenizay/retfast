package com.mizibu.retfast.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
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
        typography = Typography(),
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
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            content()
        }
    }
}
