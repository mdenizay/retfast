import SwiftUI
import UIKit

// Retfast iOS theme (2026-11 "soft" redesign, matches the web).
// Neutral zinc surfaces; sky blue is the single brand accent.
// Dark: #09090B background · #18181B surface · sky #38BDF8.
// Light: #FAFAFA background · white surface · sky #0284C7.
// Every colour is dynamic: nothing may force a colour scheme locally.

private func rgb(_ hex: UInt32) -> UIColor {
    UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
}

private func dyn(light: UInt32, dark: UInt32) -> Color {
    Color(UIColor { $0.userInterfaceStyle == .dark ? rgb(dark) : rgb(light) })
}

public enum Brand {
    /// Splash / launch background (always dark, matches LaunchBackground).
    public static let ink = Color(rgb(0x09090B))
    public static let accent = Color(rgb(0x38BDF8))
    public static let accentDeep = Color(rgb(0x0284C7))
    public static let accentLight = Color(rgb(0x67E8F9))
    /// Sky gradient (cyan → sky → deep sky) for hero surfaces and tracks.
    public static let gradient = LinearGradient(colors: [Color(rgb(0x22D3EE)), Color(rgb(0x0EA5E9)), Color(rgb(0x0369A1))],
                                                startPoint: .topLeading, endPoint: .bottomTrailing)
}

public enum AeroTokens {
    public static let background = dyn(light: 0xFAFAFA, dark: 0x09090B)
    public static let surface = dyn(light: 0xFFFFFF, dark: 0x18181B)
    public static let surfaceElevated = dyn(light: 0xF4F4F5, dark: 0x232327)
    public static let border = dyn(light: 0xE4E4E7, dark: 0x2A2A2E)
    public static let textPrimary = dyn(light: 0x09090B, dark: 0xFAFAFA)
    public static let textSecondary = dyn(light: 0x52525B, dark: 0xA1A1AA)
    public static let textMuted = dyn(light: 0x71717A, dark: 0x8E8E98)

    /// Main call to action (start flight, request retrieve, accept).
    public static let primary = dyn(light: 0x0284C7, dark: 0x38BDF8)
    public static let onPrimary = dyn(light: 0xFFFFFF, dark: 0x082F49)
    /// Strong neutral button; inverts with the scheme.
    public static let ink = dyn(light: 0x18181B, dark: 0xF4F4F5)
    public static let onInk = dyn(light: 0xFAFAFA, dark: 0x18181B)
    public static let secondary = dyn(light: 0x0E7490, dark: 0x67E8F9)
    public static let onSecondary = dyn(light: 0xFFFFFF, dark: 0x083344)
    /// Soft tinted fill behind primary-coloured icons.
    public static let primarySoft = dyn(light: 0xE0F2FE, dark: 0x0C2A3D)

    public static let success = dyn(light: 0x15803D, dark: 0x4ADE80)
    public static let warning = dyn(light: 0xB45309, dark: 0xFBBF24)
    public static let error = dyn(light: 0xDC2626, dark: 0xF87171)
    public static let emergency = Color(rgb(0xEF4444))
    public static let onEmergency = Color.white
    public static let emergencyText = dyn(light: 0xDC2626, dark: 0xF87171)
    public static let trackingActive = dyn(light: 0x0284C7, dark: 0x38BDF8)
    public static let trackingStale = dyn(light: 0xB45309, dark: 0xFBBF24)
    public static let offline = dyn(light: 0x71717A, dark: 0x8E8E98)
    public static let focusRing = dyn(light: 0x0284C7, dark: 0x38BDF8)
    /// Retrievers / retrieve requests (violet, distinct from pilots' sky blue).
    public static let retrieval = dyn(light: 0x7C3AED, dark: 0xA78BFA)
    /// Hairline shadow for soft cards (shadcn-like).
    public static let shadow = Color.black.opacity(0.05)

    public enum Space {
        public static let s1: CGFloat = 4
        public static let s2: CGFloat = 8
        public static let s3: CGFloat = 12
        public static let s4: CGFloat = 16
        public static let s6: CGFloat = 24
        public static let s8: CGFloat = 32
    }
    public enum Radius {
        public static let sm: CGFloat = 8
        public static let md: CGFloat = 12
        public static let lg: CGFloat = 16
        public static let xl: CGFloat = 22
    }
    public enum Control {
        public static let height: CGFloat = 50
        public static let heightLarge: CGFloat = 58
    }
    public enum Freshness {
        public static let liveSeconds: TimeInterval = 30
        public static let lostSeconds: TimeInterval = 300
    }
}
