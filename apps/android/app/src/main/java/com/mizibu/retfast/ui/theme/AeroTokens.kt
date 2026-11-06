// Mirrors apps/ios/Retfast/DesignSystem/Theme.swift (zinc neutrals, sky accent). Keep the two in sync.
package com.mizibu.retfast.ui.theme

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

data class AeroColors(
    val background: Color,
    val surface: Color,
    val surfaceElevated: Color,
    val border: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val textMuted: Color,
    val primary: Color,
    val onPrimary: Color,
    val ink: Color,
    val onInk: Color,
    val secondary: Color,
    val onSecondary: Color,
    val primarySoft: Color,
    val success: Color,
    val warning: Color,
    val error: Color,
    val emergency: Color,
    val onEmergency: Color,
    val emergencyText: Color,
    val trackingActive: Color,
    val trackingStale: Color,
    val offline: Color,
    val focusRing: Color,
    val retrieval: Color,
)

object AeroTokens {
    val dark = AeroColors(
        background = Color(0xFF080809),
        surface = Color(0xFF1A1A1C),
        surfaceElevated = Color(0xFF28282C),
        border = Color(0xFF2C2C30),
        textPrimary = Color(0xFFFAFAFA),
        textSecondary = Color(0xFFA1A1AA),
        textMuted = Color(0xFF8E8E98),
        primary = Color(0xFF38BDF8),
        onPrimary = Color(0xFF082F49),
        ink = Color(0xFFF4F4F5),
        onInk = Color(0xFF18181B),
        secondary = Color(0xFF67E8F9),
        onSecondary = Color(0xFF083344),
        primarySoft = Color(0xFF0F2C3D),
        success = Color(0xFF4ADE80),
        warning = Color(0xFFFBBF24),
        error = Color(0xFFF87171),
        emergency = Color(0xFFEF4444),
        onEmergency = Color.White,
        emergencyText = Color(0xFFF87171),
        trackingActive = Color(0xFF38BDF8),
        trackingStale = Color(0xFFFBBF24),
        offline = Color(0xFF8E8E98),
        focusRing = Color(0xFF38BDF8),
        retrieval = Color(0xFFA78BFA),
    )

    val light = AeroColors(
        background = Color(0xFFF2F2F4),
        surface = Color(0xFFFFFFFF),
        surfaceElevated = Color(0xFFF0F0F2),
        border = Color(0xFFE4E4E7),
        textPrimary = Color(0xFF09090B),
        textSecondary = Color(0xFF52525B),
        textMuted = Color(0xFF71717A),
        primary = Color(0xFF0284C7),
        onPrimary = Color.White,
        ink = Color(0xFF18181B),
        onInk = Color(0xFFFAFAFA),
        secondary = Color(0xFF0E7490),
        onSecondary = Color.White,
        primarySoft = Color(0xFFE0F2FE),
        success = Color(0xFF15803D),
        warning = Color(0xFFB45309),
        error = Color(0xFFDC2626),
        emergency = Color(0xFFEF4444),
        onEmergency = Color.White,
        emergencyText = Color(0xFFDC2626),
        trackingActive = Color(0xFF0284C7),
        trackingStale = Color(0xFFB45309),
        offline = Color(0xFF71717A),
        focusRing = Color(0xFF0284C7),
        retrieval = Color(0xFF7C3AED),
    )

    /** Brand constants (theme independent). */
    object Brand {
        val ink = Color(0xFF080809)
        val accent = Color(0xFF38BDF8)
        val accentDeep = Color(0xFF0284C7)
        val accentLight = Color(0xFF67E8F9)
        val gradient = Brush.linearGradient(listOf(Color(0xFF22D3EE), Color(0xFF0EA5E9), Color(0xFF0369A1)))
    }

    object Space {
        const val s1 = 4
        const val s2 = 8
        const val s3 = 12
        const val s4 = 16
        const val s6 = 24
        const val s8 = 32
    }
    object Radius {
        const val sm = 10
        const val md = 16
        const val lg = 26
        const val xl = 30
    }
    object Control {
        const val height = 52
        const val heightLarge = 58
        const val minTouch = 44
    }
    object Freshness {
        const val liveSeconds = 30
        const val lostSeconds = 300
    }
}
