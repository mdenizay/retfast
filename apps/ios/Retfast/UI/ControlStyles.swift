import SwiftUI

enum RetfastBrand {
    static let amber = Color(red: 0.953, green: 0.655, blue: 0.071)
    static let amberSoft = Color(red: 1.0, green: 0.784, blue: 0.341)
    static let graphite = Color(red: 0.051, green: 0.055, blue: 0.063)
    static let surface = Color(red: 0.106, green: 0.106, blue: 0.098)
    static let surfaceHigh = Color(red: 0.145, green: 0.141, blue: 0.122)
    static let ivory = Color(red: 1.0, green: 0.957, blue: 0.839)
}

struct RetfastMark: View {
    var size: CGFloat = 56

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                .fill(.black)
                .overlay(
                    RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                        .stroke(.white.opacity(0.16), lineWidth: 1)
                )
            Image(systemName: "location.north.fill")
                .font(.system(size: size * 0.42, weight: .black))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
        .shadow(color: .black.opacity(0.3), radius: 18, y: 8)
    }
}

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
        switch kind {
        case .primary, .warning: RetfastBrand.graphite
        case .secondary: RetfastBrand.ivory
        case .destructive, .success: .white
        }
    }

    private var background: Color {
        switch kind {
        case .primary: RetfastBrand.amber
        case .secondary: RetfastBrand.surfaceHigh
        case .destructive: .red
        case .warning: .orange
        case .success: .green
        }
    }

    private var strokeColor: Color {
        kind == .secondary ? RetfastBrand.amber.opacity(0.18) : .clear
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
            .foregroundStyle(RetfastBrand.ivory)
            .background(RetfastBrand.surface.opacity(0.92), in: Circle())
            .overlay(Circle().stroke(RetfastBrand.amber.opacity(0.2), lineWidth: 1))
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
