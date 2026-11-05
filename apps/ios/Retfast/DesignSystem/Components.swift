import RetfastCore
import SwiftUI

// Retfast UI kit — Uber-style clarity: one obvious action per screen, big
// rounded surfaces, capsule buttons, map first with an ink panel below.
// State is always icon + text, never colour alone.

enum Tone {
    case neutral, active, success, warning, error, info

    var color: Color {
        switch self {
        case .neutral: AeroTokens.textSecondary
        case .active: AeroTokens.trackingActive
        case .success: AeroTokens.success
        case .warning: AeroTokens.warning
        case .error: AeroTokens.error
        case .info: AeroTokens.secondary
        }
    }
}

// MARK: Surfaces

struct AeroCard<Content: View>: View {
    var padding: CGFloat = AeroTokens.Space.s4
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: AeroTokens.Space.s3) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .background(AeroTokens.surface, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
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

// MARK: Pills and badges

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
            Image(icon: systemImage)
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(tone.color)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(tone.color.opacity(0.14), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

struct SimBadge: View {
    var body: some View {
        Text("SIM")
            .font(.caption2.weight(.heavy).monospaced())
            .padding(.horizontal, 6).padding(.vertical, 2)
            .foregroundStyle(AeroTokens.onSecondary)
            .background(AeroTokens.secondary, in: Capsule())
            .accessibilityLabel(Text("Simüle edilmiş veri"))
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

// MARK: Buttons

struct PrimaryButtonStyle: ButtonStyle {
    enum Kind { case primary, ink, secondary, destructive }
    var kind: Kind = .primary
    var large = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(large ? .title3.weight(.bold) : .headline)
            .frame(maxWidth: .infinity, minHeight: large ? AeroTokens.Control.heightLarge : AeroTokens.Control.height)
            .padding(.horizontal, AeroTokens.Space.s4)
            .foregroundStyle(foreground)
            .background(background, in: Capsule())
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.4)
            .contentShape(Capsule())
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }

    private var background: Color {
        switch kind {
        case .primary: AeroTokens.primary
        case .ink: AeroTokens.ink
        case .secondary: AeroTokens.textPrimary.opacity(0.08)
        case .destructive: AeroTokens.error
        }
    }

    private var foreground: Color {
        switch kind {
        case .primary: AeroTokens.onPrimary
        case .ink: AeroTokens.onInk
        case .secondary: AeroTokens.textPrimary
        case .destructive: AeroTokens.onEmergency
        }
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static var aeroPrimary: PrimaryButtonStyle { PrimaryButtonStyle() }
    static var aeroPrimaryLarge: PrimaryButtonStyle { PrimaryButtonStyle(large: true) }
    static var aeroInk: PrimaryButtonStyle { PrimaryButtonStyle(kind: .ink) }
    static var aeroSecondary: PrimaryButtonStyle { PrimaryButtonStyle(kind: .secondary) }
    static var aeroDestructive: PrimaryButtonStyle { PrimaryButtonStyle(kind: .destructive) }
}

/// Round floating button used on top of maps (back, locate, fit).
struct MapCircleButton: View {
    let systemImage: String
    let label: LocalizedStringKey
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(icon: systemImage)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(AeroTokens.textPrimary)
                .frame(width: 48, height: 48)
                .background(AeroTokens.surface, in: Circle())
                .shadow(color: .black.opacity(0.18), radius: 8, y: 3)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
    }
}

/// Small round icon button (call, message, navigate) — reference: person card.
struct RoundIconButton: View {
    let systemImage: String
    let label: LocalizedStringKey
    var tint: Color = AeroTokens.primary
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(icon: systemImage)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 46, height: 46)
                .background(tint.opacity(0.16), in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
    }
}

/// Capsule segmented control (reference: "Tracking Detail | Shipping Detail").
struct CapsuleSegment<Value: Hashable>: View {
    @Binding var selection: Value
    let options: [(Value, String)]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(options, id: \.0) { value, title in
                let on = value == selection
                Button {
                    withAnimation(.snappy(duration: 0.2)) { selection = value }
                } label: {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .foregroundStyle(on ? AeroTokens.onPrimary : AeroTokens.textSecondary)
                        .background(on ? AeroTokens.primary : .clear, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(4)
        .background(AeroTokens.textPrimary.opacity(0.07), in: Capsule())
    }
}

// MARK: Brand and people

/// The Retfast wings. Template image, tinted by `color`.
struct BrandMark: View {
    var size: CGFloat = 40
    var color: Color = AeroTokens.textPrimary
    var body: some View {
        Image("BrandMark")
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size * 0.76)
            .foregroundStyle(color)
            .accessibilityLabel(Text("Retfast"))
    }
}

/// Initials avatar (no profile photos in Retfast).
struct Avatar: View {
    let name: String?
    var size: CGFloat = 44
    var tint: Color = AeroTokens.secondary

    private var initials: String {
        let parts = (name ?? "?").split(separator: " ").prefix(2)
        let s = parts.compactMap { $0.first.map(String.init) }.joined()
        return s.isEmpty ? "?" : s.uppercased()
    }

    var body: some View {
        Text(initials)
            .font(.system(size: size * 0.38, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(tint.gradient, in: Circle())
            .accessibilityHidden(true)
    }
}

// MARK: Timeline

/// Vertical step list with dots and a dashed connector (reference: tracking timeline).
struct StepTimeline: View {
    struct Step: Identifiable {
        let id: Int
        let title: String
        var subtitle: String? = nil
        var time: Date? = nil
        var done: Bool
        var current: Bool = false
    }

    let steps: [Step]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(steps) { step in
                HStack(alignment: .top, spacing: AeroTokens.Space.s3) {
                    VStack(spacing: 0) {
                        dot(step)
                        if step.id != steps.last?.id {
                            Rectangle()
                                .fill(step.done ? AeroTokens.primary : AeroTokens.border)
                                .frame(width: 2)
                                .frame(minHeight: 26)
                        }
                    }
                    .frame(width: 22)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(step.title)
                                .font(.subheadline.weight(step.done || step.current ? .semibold : .regular))
                                .foregroundStyle(step.done || step.current ? AeroTokens.textPrimary : AeroTokens.textMuted)
                            Spacer()
                            if let t = step.time, step.done {
                                Text(Fmt.time(t)).font(.caption.monospacedDigit()).foregroundStyle(AeroTokens.textMuted)
                            }
                        }
                        if let s = step.subtitle {
                            Text(s).font(.caption).foregroundStyle(AeroTokens.textSecondary)
                        }
                    }
                    .padding(.bottom, AeroTokens.Space.s3)
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(Text(step.done ? "tamam" : (step.current ? "şu an" : "bekliyor")))
            }
        }
    }

    @ViewBuilder private func dot(_ step: Step) -> some View {
        ZStack {
            Circle().fill(step.done ? AeroTokens.primary : .clear)
            Circle().strokeBorder(step.done || step.current ? AeroTokens.primary : AeroTokens.border, lineWidth: 2)
            if step.done {
                Image(icon: "checkmark").font(.system(size: 10, weight: .heavy)).foregroundStyle(.white)
            } else if step.current {
                Circle().fill(AeroTokens.primary).frame(width: 8, height: 8)
            }
        }
        .frame(width: 22, height: 22)
    }
}

// MARK: Rows and text

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
                    .font(.system(prominent ? .largeTitle : .title2, design: .rounded).weight(highContrast ? .heavy : .bold))
                    .monospacedDigit()
                    .foregroundStyle(tone == .neutral ? AeroTokens.textPrimary : tone.color)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                if let unit {
                    Text(unit)
                        .font(.system(.callout, design: .rounded).weight(.medium))
                        .foregroundStyle(AeroTokens.textSecondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(AeroTokens.Space.s3)
        .background(AeroTokens.surfaceElevated, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.md, style: .continuous))
        .overlay {
            if highContrast {
                RoundedRectangle(cornerRadius: AeroTokens.Radius.md, style: .continuous).strokeBorder(AeroTokens.textPrimary, lineWidth: 2)
            }
        }
        .accessibilityElement(children: .combine)
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
        Label { Text(text).fixedSize(horizontal: false, vertical: true) } icon: { Image(icon: systemImage).foregroundStyle(tone.color) }
            .font(.subheadline)
            .foregroundStyle(AeroTokens.textPrimary)
    }
}

enum Haptics {
    @MainActor static func start() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    @MainActor static func stop() { UIImpactFeedbackGenerator(style: .heavy).impactOccurred() }
    @MainActor static func tick() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    @MainActor static func attention() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
    @MainActor static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
}
