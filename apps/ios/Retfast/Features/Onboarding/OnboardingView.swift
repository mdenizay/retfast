import SwiftUI

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
             body: "Retfast yamaç paraşütü etkinlikleri için uçuş takibi ve retrieve uygulamasıdır. Uçuşun canlı haritada görünür; indiğinde seni alacak retriever'ı tek dokunuşla çağırırsın."),
        Page(id: 1, icon: "person.3.fill", title: "Her etkinlikte bir rol",
             body: "Pilot, gözlemci veya retriever. Etkinliğe başvurursun; organizatör onaylayıp rolünü belirler. Etkinlik ekranı rolüne göre açılır."),
        Page(id: 2, icon: "location.north.line.fill", title: "Takip ve retrieve",
             body: "Uçuşu sen başlatır, sen bitirirsin. Konum önce telefona kaydedilir, bağlantı gelince gönderilir. İndiğinde \"Retrieve iste\" ile yerini paylaşırsın; retriever kabul edince adını ve konumunu görürsün.\n\nKilit ekranında da çalışması için konum iznini \"Her Zaman\" ver. Uygulamayı kaydırıp kapatırsan iOS konumu durdurur. GPS metrelerce hatalı olabilir; irtifa GPS irtifası, dikey hız tahminidir."),
        Page(id: 3, icon: "exclamationmark.shield.fill", title: "Acil durum servisi değildir",
             body: "Retfast yetkililere veya 112'ye ulaşmaz. Yaralanma veya tehlike durumunda her zaman 112'yi ve normal acil durum kanallarını kullan."),
    ]

    var body: some View {
        VStack(spacing: AeroTokens.Space.s4) {
            TabView(selection: $page) {
                ForEach(pages) { p in
                    ScrollView {
                        VStack(alignment: .leading, spacing: AeroTokens.Space.s4) {
                            Group {
                                if p.icon == "brand" {
                                    BrandMark(size: 96, color: Brand.orange)
                                } else {
                                    Image(icon: p.icon)
                                        .font(.system(size: 40, weight: .semibold))
                                        .foregroundStyle(AeroTokens.primary)
                                        .frame(width: 88, height: 88)
                                        .background(AeroTokens.primary.opacity(0.12), in: Circle())
                                }
                            }
                            .padding(.top, AeroTokens.Space.s8)
                            .accessibilityHidden(true)
                            Text(p.title).font(.system(size: 34, weight: .bold)).foregroundStyle(AeroTokens.textPrimary)
                            Text(p.body).font(.title3).foregroundStyle(AeroTokens.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                            if p.id == pages.count - 1 {
                                Toggle(isOn: $acknowledged) {
                                    Text("Retfast'in bir acil durum servisi olmadığını; acil durumda 112'yi aramam gerektiğini anladım.")
                                        .font(.subheadline)
                                }
                                .toggleStyle(.switch)
                                .tint(AeroTokens.primary)
                                .padding(AeroTokens.Space.s4)
                                .background(AeroTokens.surface, in: RoundedRectangle(cornerRadius: AeroTokens.Radius.lg, style: .continuous))
                                .accessibilityIdentifier("onboarding.ack")
                            }
                        }
                        .padding(AeroTokens.Space.s6)
                        .frame(maxWidth: 600, alignment: .leading)
                    }
                    .tag(p.id)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
            .indexViewStyle(.page(backgroundDisplayMode: .never))

            Group {
                if page < pages.count - 1 {
                    Button("Devam") { withAnimation { page += 1 } }
                        .buttonStyle(.aeroPrimaryLarge)
                        .accessibilityIdentifier("onboarding.next")
                } else {
                    Button("Anladım, başla") { model.onboardingCompleted = true }
                        .buttonStyle(.aeroPrimaryLarge)
                        .disabled(!acknowledged)
                        .accessibilityIdentifier("onboarding.finish")
                }
            }
            .padding(.horizontal, AeroTokens.Space.s6)
            .padding(.bottom, AeroTokens.Space.s4)
        }
        .aeroBackground()
    }
}
