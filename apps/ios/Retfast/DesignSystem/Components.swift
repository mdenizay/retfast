import RetfastCore
import SwiftUI

// Retfast Aero — technical minimalism. Colours/spacing come from the generated
// AeroTokens (packages/design-tokens). State is always icon + text, never colour alone.

enum Tone {
    case neutral, active, success, warning, error, emergency, info

    var color: Color {
        switch self {
        case .neutral: AeroTokens.textSecondary
        case .active: AeroTokens.trackingActive
        case .success: AeroTokens.success
        case .warning: AeroTokens.warning
        case .error: AeroTokens.error
        case .emergency: AeroTokens.emergencyText
        case .info: AeroTokens.secondary
        }
    }
}

struct AeroCard<Content: View>: View {
    var padding: CGFloat = AeroTokens.Space.s4
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: AeroTokens.Space.s3) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .background(AeroTokens.surface, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous).strokeBorder(AeroTokens.border, lineWidth: 1))
    }
}

struct StatusPill: View {
    let text: String
    let systemImage: String
    var tone: Tone = .neutral

    init(_ text: String, systemImage: String, tone: Tone = .neutral) {
        self.text = text; self.systemImage = systemImage; self.tone = tone
    }

    var body: some View {
        Label {
            Text(text).lineLimit(1)
        } icon: {
            Image(systemName: systemImage)
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(tone.color)
        .padding(.horizontal, AeroTokens.Space.s2)
        .padding(.vertical, AeroTokens.Space.s1)
        .background(tone.color.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.35), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, destructive, emergency }
    var kind: Kind = .primary
    var large = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(large ? .title3.weight(.semibold) : .headline)
            .frame(maxWidth: .infinity, minHeight: large ? AeroTokens.Control.heightLarge : AeroTokens.Control.height)
            .padding(.horizontal, AeroTokens.Space.s4)
            .foregroundStyle(foreground)
            .background(background.opacity(configuration.isPressed ? 0.8 : 1),
                        in: RoundedRectangle(cornerRadius: AeroTokens.Radius.md, style: .continuous))
            .overlay {
                if kind == .secondary {
                    RoundedRectangle(cornerRadius: AeroTokens.Radius.md, style: .continuous).strokeBorder(AeroTokens.border, lineWidth: 1)
                }
            }
            .opacity(isEnabled ? 1 : 0.45)
            .contentShape(Rectangle())
    }

    private var background: Color {
        switch kind {
        case .primary: AeroTokens.primary
        case .secondary: AeroTokens.surfaceElevated
        case .destructive: AeroTokens.error
        case .emergency: AeroTokens.emergency
        }
    }

    private var foreground: Color {
        switch kind {
        case .primary: AeroTokens.onPrimary
        case .secondary: AeroTokens.textPrimary
        case .destructive, .emergency: AeroTokens.onEmergency
        }
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static var aeroPrimary: PrimaryButtonStyle { PrimaryButtonStyle() }
    static var aeroPrimaryLarge: PrimaryButtonStyle { PrimaryButtonStyle(large: true) }
    static var aeroSecondary: PrimaryButtonStyle { PrimaryButtonStyle(kind: .secondary) }
    static var aeroDestructive: PrimaryButtonStyle { PrimaryButtonStyle(kind: .destructive) }
}

/// One flight-computer value. Digits in SF Mono so they don't jitter.
struct InstrumentTile: View {
    let label: String
    let value: String
    var unit: String? = nil
    var qualifier: String? = nil
    var tone: Tone = .neutral
    var prominent = false
    var highContrast = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Text(label)
                    .font(.caption.weight(.semibold))
                    .textCase(.uppercase)
                    .foregroundStyle(highContrast ? AeroTokens.textPrimary : AeroTokens.textSecondary)
                if let qualifier {
                    Text(qualifier)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(AeroTokens.textMuted)
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value)
                    .font(.system(prominent ? .largeTitle : .title, design: .monospaced).weight(highContrast ? .heavy : .semibold))
                    .monospacedDigit()
                    .foregroundStyle(tone == .neutral ? AeroTokens.textPrimary : tone.color)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                if let unit {
                    Text(unit)
                        .font(.system(.callout, design: .monospaced).weight(.medium))
                        .foregroundStyle(AeroTokens.textSecondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(AeroTokens.Space.s3)
        .background(AeroTokens.surface, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.md, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: AeroTokens.Radius.md, style: .continuous)
            .strokeBorder(highContrast ? AeroTokens.textPrimary : AeroTokens.border, lineWidth: highContrast ? 2 : 1))
        .accessibilityElement(children: .combine)
    }
}

struct SyncBadge: View {
    let snapshot: SyncSnapshot

    var body: some View {
        switch snapshot.status {
        case .synced:
            StatusPill(String(localized: "Senkronize"), systemImage: "checkmark.icloud", tone: .success)
        case .syncing:
            StatusPill(String(localized: "Gönderiliyor · \(snapshot.pendingCount)"), systemImage: "arrow.triangle.2.circlepath.icloud", tone: .info)
        case .pending:
            StatusPill(String(localized: "Bekleyen \(snapshot.pendingCount)"), systemImage: "icloud.and.arrow.up", tone: .warning)
        case .offline:
            StatusPill(String(localized: "Çevrimdışı · \(snapshot.pendingCount) bekliyor"), systemImage: "icloud.slash", tone: .warning)
        case .authRequired:
            StatusPill(String(localized: "Giriş gerekli"), systemImage: "person.crop.circle.badge.exclamationmark", tone: .error)
        case .serverError:
            StatusPill(String(localized: "Sunucu hatası · \(snapshot.pendingCount) bekliyor"), systemImage: "exclamationmark.icloud", tone: .error)
        }
    }
}

struct FreshnessBadge: View {
    /// "live" | "stale" | "lost" per contract, or computed from age.
    let freshness: String?
    var age: TimeInterval?

    static func freshness(age: TimeInterval) -> String {
        age < AeroTokens.Freshness.liveSeconds ? "live" : (age < AeroTokens.Freshness.lostSeconds ? "stale" : "lost")
    }

    var body: some View {
        let f = freshness ?? age.map(Self.freshness) ?? "lost"
        switch f {
        case "live": StatusPill(String(localized: "Canlı"), systemImage: "dot.radiowaves.left.and.right", tone: .active)
        case "stale": StatusPill(String(localized: "Gecikmeli") + (age.map { " · \(Fmt.age($0))" } ?? ""), systemImage: "clock.badge.exclamationmark", tone: .warning)
        default: StatusPill(String(localized: "Sinyal yok") + (age.map { " · \(Fmt.age($0))" } ?? ""), systemImage: "antenna.radiowaves.left.and.right.slash", tone: .error)
        }
    }
}

struct SimBadge: View {
    var body: some View {
        Text("SIM")
            .font(.caption2.weight(.heavy).monospaced())
            .padding(.horizontal, 6).padding(.vertical, 2)
            .foregroundStyle(AeroTokens.onSecondary)
            .background(AeroTokens.secondary, in: RoundedRectangle(cornerRadius: 4))
            .accessibilityLabel(Text("Simüle edilmiş veri"))
    }
}

struct TestBadge: View {
    var body: some View {
        Text("TEST")
            .font(.caption.weight(.heavy).monospaced())
            .padding(.horizontal, 6).padding(.vertical, 2)
            .foregroundStyle(.black)
            .background(AeroTokens.warning, in: RoundedRectangle(cornerRadius: 4))
            .accessibilityLabel(Text("Test çağrısı, gerçek acil durum değil"))
    }
}

struct SectionHeader: View {
    let title: String
    var body: some View {
        Text(title).font(.headline).foregroundStyle(AeroTokens.textPrimary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct KeyValueRow: View {
    let key: String
    let value: String
    var mono = false
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(key).foregroundStyle(AeroTokens.textSecondary)
            Spacer(minLength: AeroTokens.Space.s3)
            Text(value)
                .font(mono ? .body.monospaced() : .body)
                .monospacedDigit()
                .foregroundStyle(AeroTokens.textPrimary)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
        .accessibilityElement(children: .combine)
    }
}

struct WarningRow: View {
    let text: String
    var tone: Tone = .warning
    var systemImage = "exclamationmark.triangle.fill"
    var body: some View {
        Label { Text(text).fixedSize(horizontal: false, vertical: true) } icon: { Image(systemName: systemImage).foregroundStyle(tone.color) }
            .font(.subheadline)
            .foregroundStyle(AeroTokens.textPrimary)
    }
}

struct ScreenBackground: ViewModifier {
    func body(content: Content) -> some View {
        content.background(AeroTokens.background.ignoresSafeArea())
    }
}

extension View {
    func aeroBackground() -> some View { modifier(ScreenBackground()) }
}

enum Haptics {
    @MainActor static func start() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    @MainActor static func stop() { UIImpactFeedbackGenerator(style: .heavy).impactOccurred() }
    @MainActor static func tick() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    @MainActor static func sos() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
}
