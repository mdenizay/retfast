package com.mizibu.retfast.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

val LocalAero = staticCompositionLocalOf { AeroTokens.light }
val LocalDark = staticCompositionLocalOf { false }

/** Minimal card UI mirroring the iOS app: Material 3 structure restyled with the shared Retfast Aero tokens. */
private fun scheme(c: AeroColors, dark: Boolean): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = c.primary, onPrimary = c.onPrimary,
        primaryContainer = c.primarySoft, onPrimaryContainer = c.primary,
        secondary = c.secondary, onSecondary = c.onSecondary,
        secondaryContainer = c.primarySoft, onSecondaryContainer = c.primary,
        tertiary = c.retrieval, onTertiary = c.onPrimary,
        background = c.background, onBackground = c.textPrimary,
        surface = c.surface, onSurface = c.textPrimary,
        surfaceVariant = c.surfaceElevated, onSurfaceVariant = c.textSecondary,
        surfaceContainer = c.surface, surfaceContainerHigh = c.surface, surfaceContainerHighest = c.surfaceElevated,
        surfaceContainerLow = c.background, surfaceContainerLowest = c.background,
        outline = c.border, outlineVariant = c.border,
        error = c.error, onError = Color.White,
        errorContainer = c.surfaceElevated, onErrorContainer = c.error,
    )
}

private val sans = FontFamily.Default
val Mono = FontFamily.Monospace

private val typography = Typography(
    displayLarge = TextStyle(fontFamily = sans, fontWeight = FontWeight.SemiBold, fontSize = 56.sp, lineHeight = 60.sp),
    displayMedium = TextStyle(fontFamily = sans, fontWeight = FontWeight.SemiBold, fontSize = 40.sp, lineHeight = 44.sp),
    headlineLarge = TextStyle(fontFamily = sans, fontWeight = FontWeight.SemiBold, fontSize = 30.sp, lineHeight = 36.sp),
    headlineMedium = TextStyle(fontFamily = sans, fontWeight = FontWeight.SemiBold, fontSize = 24.sp, lineHeight = 30.sp),
    titleLarge = TextStyle(fontFamily = sans, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, lineHeight = 26.sp),
    titleMedium = TextStyle(fontFamily = sans, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 24.sp),
    titleSmall = TextStyle(fontFamily = sans, fontWeight = FontWeight.Medium, fontSize = 15.sp, lineHeight = 22.sp),
    bodyLarge = TextStyle(fontFamily = sans, fontSize = 16.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontFamily = sans, fontSize = 15.sp, lineHeight = 22.sp),
    bodySmall = TextStyle(fontFamily = sans, fontSize = 13.sp, lineHeight = 18.sp),
    labelLarge = TextStyle(fontFamily = sans, fontWeight = FontWeight.Medium, fontSize = 15.sp, lineHeight = 20.sp),
    labelMedium = TextStyle(fontFamily = sans, fontWeight = FontWeight.Medium, fontSize = 13.sp, lineHeight = 18.sp),
    labelSmall = TextStyle(fontFamily = sans, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp),
)

private val shapes = Shapes(
    extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(AeroTokens.Radius.sm.dp),
    small = androidx.compose.foundation.shape.RoundedCornerShape(AeroTokens.Radius.sm.dp),
    medium = androidx.compose.foundation.shape.RoundedCornerShape(AeroTokens.Radius.md.dp),
    large = androidx.compose.foundation.shape.RoundedCornerShape(AeroTokens.Radius.lg.dp),
    extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(AeroTokens.Radius.xl.dp),
)

@Composable
fun RetfastTheme(mode: String = "system", content: @Composable () -> Unit) {
    val dark = when (mode) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
    val c = if (dark) AeroTokens.dark else AeroTokens.light
    CompositionLocalProvider(LocalAero provides c, LocalDark provides dark) {
        MaterialTheme(colorScheme = scheme(c, dark), typography = typography, shapes = shapes, content = content)
    }
}

object Aero {
    val colors: AeroColors @Composable @ReadOnlyComposable get() = LocalAero.current
    val dark: Boolean @Composable @ReadOnlyComposable get() = LocalDark.current
}
