import SwiftUI
import UIKit

// Retfast iOS theme (2026-11 "sunset" redesign).
// Dark: #111111 background · #1C1C1E surface · orange #FB923C · amber #FACC15.
// Light: #FAFAF9 background · white surface · orange #EA580C · amber #CA8A04.
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
    public static let ink = Color(rgb(0x111111))
    public static let orange = Color(rgb(0xFB923C))
    public static let deepOrange = Color(rgb(0xEA580C))
    public static let amber = Color(rgb(0xFACC15))
    /// Sunset gradient used for hero surfaces.
    public static let sunset = LinearGradient(colors: [Color(rgb(0xFB923C)), Color(rgb(0xF97316)), Color(rgb(0xE11D48))],
                                              startPoint: .topLeading, endPoint: .bottomTrailing)
}

public enum AeroTokens {
    public static let background = dyn(light: 0xFAFAF9, dark: 0x111111)
    public static let surface = dyn(light: 0xFFFFFF, dark: 0x1C1C1E)
    public static let surfaceElevated = dyn(light: 0xF4F4F2, dark: 0x262628)
    public static let border = dyn(light: 0xE7E5E4, dark: 0x2E2E30)
    public static let textPrimary = dyn(light: 0x1C1917, dark: 0xF5F5F4)
    public static let textSecondary = dyn(light: 0x57534E, dark: 0xA8A29E)
    public static let textMuted = dyn(light: 0x78716C, dark: 0x8A8580)

    /// Main call to action (start flight, request retrieve, accept).
    public static let primary = dyn(light: 0xEA580C, dark: 0xFB923C)
    public static let onPrimary = dyn(light: 0xFFFFFF, dark: 0x1C1917)
    /// Strong neutral button; inverts with the scheme.
    public static let ink = dyn(light: 0x1C1917, dark: 0xF5F5F4)
    public static let onInk = dyn(light: 0xFFFFFF, dark: 0x111111)
    public static let secondary = dyn(light: 0xCA8A04, dark: 0xFACC15)
    public static let onSecondary = dyn(light: 0xFFFFFF, dark: 0x1C1917)
    /// Soft tinted fill behind primary-coloured icons.
    public static let primarySoft = dyn(light: 0xFFEDD5, dark: 0x3A2414)

    public static let success = dyn(light: 0x15803D, dark: 0x4ADE80)
    public static let warning = dyn(light: 0xB45309, dark: 0xFBBF24)
    public static let error = dyn(light: 0xDC2626, dark: 0xF87171)
    public static let emergency = Color(rgb(0xEF4444))
    public static let onEmergency = Color.white
    public static let emergencyText = dyn(light: 0xDC2626, dark: 0xF87171)
    public static let trackingActive = dyn(light: 0xEA580C, dark: 0xFB923C)
    public static let trackingStale = dyn(light: 0xB45309, dark: 0xFBBF24)
    public static let offline = dyn(light: 0x78716C, dark: 0x8A8580)
    public static let focusRing = dyn(light: 0xEA580C, dark: 0xFB923C)
    /// Retrievers / retrieve requests (sky blue, distinct from pilots' orange).
    public static let retrieval = dyn(light: 0x0284C7, dark: 0x38BDF8)

    public enum Space {
        public static let s1: CGFloat = 4
        public static let s2: CGFloat = 8
        public static let s3: CGFloat = 12
        public static let s4: CGFloat = 16
        public static let s6: CGFloat = 24
        public static let s8: CGFloat = 32
    }
    public enum Radius {
        public static let sm: CGFloat = 10
        public static let md: CGFloat = 16
        public static let lg: CGFloat = 22
        public static let xl: CGFloat = 30
    }
    public enum Control {
        public static let height: CGFloat = 54
        public static let heightLarge: CGFloat = 62
    }
    public enum Freshness {
        public static let liveSeconds: TimeInterval = 30
        public static let lostSeconds: TimeInterval = 300
    }
}
