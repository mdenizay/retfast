import SwiftUI

/// Touch-target sizing for the operational screens.
///
/// These are flown with gloves on, in wind, often one-handed — Apple's 44pt
/// minimum is the floor here, not the target. Primary in-flight actions get
/// 60pt so they stay hittable when the pilot is not looking at the screen.
enum Hit {
    /// Apple HIG minimum. Used for secondary/list controls.
    static let min: CGFloat = 44
    /// Comfortable default for sheet and form actions.
    static let comfortable: CGFloat = 52
    /// In-flight primary actions (start / landed / finish / SOS).
    static let critical: CGFloat = 60
}

/// Large, high-contrast action button used across the pilot and retriever flows.
struct BigButtonStyle: ButtonStyle {
    enum Kind {
        case primary, secondary, destructive, warning, success
    }

    var kind: Kind = .primary
    var height: CGFloat = Hit.comfortable

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: height)
            .foregroundStyle(foreground)
            .background(background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(strokeColor, lineWidth: kind == .secondary ? 1.5 : 0)
            )
            .opacity(configuration.isPressed ? 0.75 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
            .contentShape(Rectangle())
    }

    private var foreground: Color {
        kind == .secondary ? .primary : .white
    }

    private var background: Color {
        switch kind {
        case .primary: .accentColor
        case .secondary: Color(.secondarySystemBackground)
        case .destructive: .red
        case .warning: .orange
        case .success: .green
        }
    }

    private var strokeColor: Color {
        kind == .secondary ? Color.secondary.opacity(0.35) : .clear
    }
}

extension ButtonStyle where Self == BigButtonStyle {
    static var bigPrimary: BigButtonStyle { BigButtonStyle(kind: .primary) }
    static var bigSecondary: BigButtonStyle { BigButtonStyle(kind: .secondary) }
    static var bigDestructive: BigButtonStyle { BigButtonStyle(kind: .destructive) }
    static var bigWarning: BigButtonStyle { BigButtonStyle(kind: .warning) }
    static var bigSuccess: BigButtonStyle { BigButtonStyle(kind: .success) }

    static func big(_ kind: BigButtonStyle.Kind, height: CGFloat = Hit.comfortable) -> BigButtonStyle {
        BigButtonStyle(kind: kind, height: height)
    }
}

/// Circular glass button for map overlays (dismiss, recentre…).
struct MapChipButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.title3.weight(.semibold))
            .frame(width: Hit.min + 4, height: Hit.min + 4)
            .background(.thinMaterial, in: Circle())
            .opacity(configuration.isPressed ? 0.7 : 1)
            .contentShape(Circle())
    }
}

extension ButtonStyle where Self == MapChipButtonStyle {
    static var mapChip: MapChipButtonStyle { MapChipButtonStyle() }
}

extension View {
    /// Guarantees a row/control is at least one comfortable tap target tall.
    func minTapTarget(_ height: CGFloat = Hit.min) -> some View {
        frame(minHeight: height).contentShape(Rectangle())
    }
}
