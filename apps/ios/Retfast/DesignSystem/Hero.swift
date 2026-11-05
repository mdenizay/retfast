import SwiftUI

// Brand hero pieces used by the splash, onboarding and sign-in screens. These
// screens are always dark (like the launch screen) so the sky glow reads.

/// Dark sky with a blue glow, faint terrain contours and a climbing
/// thermal track that draws itself in a loop.
struct SkyBackdrop: View {
    var glowCenter: UnitPoint = UnitPoint(x: 0.5, y: 0.38)
    var animated = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Brand.ink
            RadialGradient(colors: [Brand.accent.opacity(0.14), .clear], center: glowCenter, startRadius: 0, endRadius: 360)
            canvas(phase: nil).opacity(0.6)
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }

    private func canvas(phase: TimeInterval?) -> some View {
        Canvas { ctx, size in
            // Terrain contours: irregular rings around a summit low on the right.
            let summit = CGPoint(x: size.width * 0.78, y: size.height * 0.92)
            for i in 1...9 {
                let r = CGFloat(i) * size.width * 0.12
                var p = Path()
                for k in 0...72 {
                    let a = Double(k) / 72 * 2 * .pi
                    let wobble = 1 + 0.07 * sin(a * 3 + Double(i)) + 0.04 * cos(a * 5 - Double(i) * 0.7)
                    let pt = CGPoint(x: summit.x + cos(a) * r * wobble * 1.25, y: summit.y + sin(a) * r * wobble * 0.7)
                    k == 0 ? p.move(to: pt) : p.addLine(to: pt)
                }
                ctx.stroke(p, with: .color(.white.opacity(0.055)), lineWidth: 1)
            }

        }
    }

    private static func track(in size: CGSize) -> [CGPoint] {
        (0...360).map { i in
            let t = Double(i) / 360
            let x = size.width * (0.08 + 0.55 * t) + sin(t * 26) * 26 * (0.4 + t)
            let y = size.height * (0.88 - 0.62 * t) + cos(t * 26) * 12 * (0.4 + t)
            return CGPoint(x: x, y: y)
        }
    }
}

/// Animated launch splash: glow blooms, the mark springs in, the wordmark rises.
struct SplashView: View {
    var onFinished: () -> Void
    @State private var bloom = false
    @State private var mark = false
    @State private var word = false

    var body: some View {
        ZStack {
            Brand.ink.ignoresSafeArea()
            RadialGradient(colors: [Brand.accent.opacity(0.22), .clear], center: .center, startRadius: 0, endRadius: bloom ? 320 : 40)
                .opacity(bloom ? 1 : 0)
                .ignoresSafeArea()
            VStack(spacing: AeroTokens.Space.s4) {
                BrandMark(size: 120, color: .white)
                    .scaleEffect(mark ? 1 : 0.72)
                    .opacity(mark ? 1 : 0)
                    .rotationEffect(.degrees(mark ? 0 : -8))
                Text("Retfast")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .opacity(word ? 1 : 0)
                    .offset(y: word ? 0 : 12)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Retfast"))
        .task {
            withAnimation(.easeOut(duration: 0.7)) { bloom = true }
            withAnimation(.spring(response: 0.55, dampingFraction: 0.62).delay(0.08)) { mark = true }
            withAnimation(.easeOut(duration: 0.4).delay(0.35)) { word = true }
            try? await Task.sleep(for: .milliseconds(1250))
            onFinished()
        }
    }
}

/// White capsule (Continue / Apple / Google) for dark brand screens.
struct WhiteCapsuleButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(Color(red: 0.07, green: 0.07, blue: 0.07))
            .frame(maxWidth: .infinity, minHeight: AeroTokens.Control.height)
            .background(.white, in: Capsule())
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.4)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
            .contentShape(Capsule())
    }
}

/// Dark translucent capsule ("Continue with email") for dark brand screens.
struct GlassCapsuleButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: AeroTokens.Control.height)
            .background(Color.white.opacity(configuration.isPressed ? 0.16 : 0.09), in: Capsule())
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(isEnabled ? 1 : 0.4)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
            .contentShape(Capsule())
    }
}

/// Google "G" drawn from four arcs (no bundled bitmap).
struct GoogleGlyph: View {
    var size: CGFloat = 18
    var body: some View {
        let colors: [Color] = [Color(red: 0.92, green: 0.26, blue: 0.21), Color(red: 0.98, green: 0.74, blue: 0.02),
                               Color(red: 0.20, green: 0.66, blue: 0.33), Color(red: 0.26, green: 0.52, blue: 0.96)]
        // Clockwise from 3 o'clock: blue, green, yellow, red; gap at upper right.
        let segments: [(Double, Double)] = [(210, 320), (150, 210), (45, 150), (0, 45)]
        ZStack {
            ForEach(0..<4, id: \.self) { i in
                Circle()
                    .trim(from: segments[i].0 / 360, to: segments[i].1 / 360)
                    .stroke(colors[i], style: StrokeStyle(lineWidth: size * 0.2, lineCap: .butt))
            }
            Rectangle().fill(colors[3])
                .frame(width: size * 0.48, height: size * 0.2)
                .offset(x: size * 0.22)
        }
        .frame(width: size * 0.8, height: size * 0.8)
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// Text field styled for the dark auth screens.
struct AuthField<Content: View>: View {
    let icon: String
    @ViewBuilder var content: Content
    var body: some View {
        HStack(spacing: AeroTokens.Space.s3) {
            Image(icon: icon).foregroundStyle(.white.opacity(0.5)).frame(width: 22)
            content.foregroundStyle(.white).tint(Brand.accent)
        }
        .font(.body)
        .padding(.horizontal, AeroTokens.Space.s4)
        .frame(height: AeroTokens.Control.height)
        .background(Color(red: 0.102, green: 0.102, blue: 0.11), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

/// Large illustration for onboarding pages: icon on a glowing gradient disc.
struct HeroIcon: View {
    let icon: String
    @State private var appear = false
    var body: some View {
        ZStack {
            Circle().fill(Brand.accent.opacity(0.16)).frame(width: 132, height: 132)
            Image(icon: icon)
                .font(.system(size: 50, weight: .semibold))
                .foregroundStyle(Brand.accent)
                .symbolEffect(.bounce, value: appear)
        }
        .scaleEffect(appear ? 1 : 0.85)
        .opacity(appear ? 1 : 0)
        .onAppear { withAnimation(.spring(response: 0.6, dampingFraction: 0.7)) { appear = true } }
        .onDisappear { appear = false }
        .accessibilityHidden(true)
    }
}
