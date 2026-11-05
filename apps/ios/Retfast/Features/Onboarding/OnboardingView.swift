import SwiftUI

/// Dark brand onboarding: big illustration, short copy, page dots and a white
/// "Continue" capsule. The last page holds the emergency acknowledgement.
struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @State private var page = 0
    @State private var acknowledged = false

    private struct Page: Identifiable {
        let id: Int
        let icon: String
        let title: LocalizedStringKey
        let body: LocalizedStringKey
    }

    private let pages: [Page] = [
        Page(id: 0, icon: "brand", title: "Uç. İn. Alın.",
             body: "Yamaç paraşütü etkinlikleri için uçuş takibi ve retrieve. Uçuşun canlı haritada; indiğinde retriever'ı tek dokunuşla çağır."),
        Page(id: 1, icon: "person.3.fill", title: "Her etkinlikte bir rol",
             body: "Pilot, gözlemci veya retriever. Etkinliğe başvur, organizatör rolünü belirlesin. Ekran rolüne göre açılır."),
        Page(id: 2, icon: "location.north.line.fill", title: "Sen başlat, sen bitir",
             body: "Konum önce telefona kaydedilir, bağlantı gelince gönderilir. Kilit ekranında da çalışması için konum iznini \"Her Zaman\" ver."),
        Page(id: 3, icon: "exclamationmark.shield.fill", title: "Acil durum servisi değildir",
             body: "Retfast yetkililere veya 112'ye ulaşmaz. Tehlikede her zaman 112'yi ara."),
    ]

    private var isLast: Bool { page == pages.count - 1 }

    var body: some View {
        ZStack {
            SkyBackdrop(glowCenter: UnitPoint(x: 0.5, y: 0.3), animated: page == 0)
            VStack(spacing: 0) {
                HStack {
                    Spacer()
                    if !isLast {
                        Button("Geç") { withAnimation(.smooth) { page = pages.count - 1 } }
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.6))
                            .accessibilityIdentifier("onboarding.skip")
                    }
                }
                .frame(height: 44)
                .padding(.horizontal, AeroTokens.Space.s6)

                TabView(selection: $page) {
                    ForEach(pages) { p in
                        pageView(p).tag(p.id)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))

                VStack(spacing: AeroTokens.Space.s4) {
                    if isLast { ackRow.transition(.move(edge: .bottom).combined(with: .opacity)) }
                    dots
                    Group {
                        if isLast {
                            Button("Anladım, başla") { model.onboardingCompleted = true }
                                .disabled(!acknowledged)
                                .accessibilityIdentifier("onboarding.finish")
                        } else {
                            Button("Devam") { withAnimation(.smooth) { page += 1 } }
                                .accessibilityIdentifier("onboarding.next")
                        }
                    }
                    .buttonStyle(WhiteCapsuleButtonStyle())
                }
                .padding(.horizontal, AeroTokens.Space.s6)
                .padding(.bottom, AeroTokens.Space.s4)
                .animation(.smooth, value: isLast)
            }
        }
        .environment(\.colorScheme, .dark)
        .sensoryFeedback(.selection, trigger: page)
    }

    private func pageView(_ p: Page) -> some View {
        VStack(spacing: AeroTokens.Space.s6) {
            Spacer(minLength: 0)
            Group {
                if p.icon == "brand" {
                    BrandMark(size: 150, color: .white)
                        .shadow(color: Brand.accent.opacity(0.6), radius: 30)
                } else {
                    HeroIcon(icon: p.icon)
                }
            }
            .frame(height: 240)
            .accessibilityHidden(true)
            VStack(spacing: AeroTokens.Space.s3) {
                Text(p.title)
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                Text(p.body)
                    .font(.body)
                    .foregroundStyle(.white.opacity(0.68))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: 480)
            .padding(.horizontal, AeroTokens.Space.s6)
            Spacer(minLength: 0)
        }
    }

    private var dots: some View {
        HStack(spacing: 6) {
            ForEach(pages) { p in
                Capsule()
                    .fill(.white.opacity(p.id == page ? 1 : 0.28))
                    .frame(width: p.id == page ? 22 : 7, height: 7)
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: page)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Sayfa \(page + 1) / \(pages.count)"))
    }

    private var ackRow: some View {
        Toggle(isOn: $acknowledged) {
            Text("Retfast'in bir acil durum servisi olmadığını; acil durumda 112'yi aramam gerektiğini anladım.")
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.85))
        }
        .toggleStyle(.switch)
        .tint(Brand.accent)
        .padding(AeroTokens.Space.s4)
        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
        .accessibilityIdentifier("onboarding.ack")
    }
}
