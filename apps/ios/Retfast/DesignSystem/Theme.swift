import SwiftUI
import UIKit

// Retfast iOS brand theme (2026-11 redesign).
// Palette: Ink #1A1A1A · Retfast Red #E01A4F · Sky Blue #4C8DF1 · Fog #F2F2F2.
// Same API as the generated AeroTokens so every screen picks it up; the web
// keeps using packages/design-tokens.

private func rgb(_ hex: UInt32) -> UIColor {
    UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
}

private func dyn(light: UInt32, dark: UInt32) -> Color {
    Color(UIColor { $0.userInterfaceStyle == .dark ? rgb(dark) : rgb(light) })
}

public enum Brand {
    public static let ink = Color(rgb(0x1A1A1A))
    public static let red = Color(rgb(0xE01A4F))
    public static let blue = Color(rgb(0x4C8DF1))
    public static let fog = Color(rgb(0xF2F2F2))
}

public enum AeroTokens {
    public static let background = dyn(light: 0xF2F2F2, dark: 0x1A1A1A)
    public static let surface = dyn(light: 0xFFFFFF, dark: 0x242424)
    public static let surfaceElevated = dyn(light: 0xFFFFFF, dark: 0x2E2E2E)
    public static let border = dyn(light: 0xE3E3E3, dark: 0x383838)
    public static let textPrimary = dyn(light: 0x1A1A1A, dark: 0xF2F2F2)
    public static let textSecondary = dyn(light: 0x5A5A5A, dark: 0xB4B4B4)
    public static let textMuted = dyn(light: 0x767676, dark: 0x8E8E8E)

    /// Main call to action (start flight, request retrieve, accept).
    public static let primary = Color(rgb(0xE01A4F))
    public static let onPrimary = Color.white
    /// Strong neutral (Uber-style black button; inverts in dark mode).
    public static let ink = dyn(light: 0x1A1A1A, dark: 0xF2F2F2)
    public static let onInk = dyn(light: 0xFFFFFF, dark: 0x1A1A1A)
    public static let secondary = dyn(light: 0x2F6FD6, dark: 0x4C8DF1)
    public static let onSecondary = dyn(light: 0xFFFFFF, dark: 0x1A1A1A)

    public static let success = dyn(light: 0x1B8A52, dark: 0x3DD68C)
    public static let warning = dyn(light: 0x8F5500, dark: 0xF5B94A)
    public static let error = dyn(light: 0xC0182F, dark: 0xFF6B7A)
    public static let emergency = Color(rgb(0xC0182F))
    public static let onEmergency = Color.white
    public static let emergencyText = dyn(light: 0xC0182F, dark: 0xFF8A95)
    public static let trackingActive = Color(rgb(0xE01A4F))
    public static let trackingStale = dyn(light: 0x8F5500, dark: 0xF5B94A)
    public static let offline = dyn(light: 0x767676, dark: 0x8E8E8E)
    public static let focusRing = Color(rgb(0x4C8DF1))
    public static let retrieval = dyn(light: 0x2F6FD6, dark: 0x4C8DF1)

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
        public static let md: CGFloat = 14
        public static let lg: CGFloat = 20
        public static let xl: CGFloat = 28
    }
    public enum Control {
        public static let height: CGFloat = 52
        public static let heightLarge: CGFloat = 60
    }
    public enum Freshness {
        public static let liveSeconds: TimeInterval = 30
        public static let lostSeconds: TimeInterval = 300
    }
}
