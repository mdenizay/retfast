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
        Page(id: 0, icon: "paperplane.circle", title: "Retfast nedir?",
             body: "Retfast yamaç paraşütü etkinlikleri için uçuş takibi ve retrieve uygulamasıdır. Katıldığın etkinlikte uçuşunu GPS ile kaydeder, organizatör ve gözlemcilerin canlı haritasında gösterir; indikten sonra seni alacak retriever'ı bulmanı sağlar."),
        Page(id: 1, icon: "person.3", title: "Roller",
             body: "Her etkinlikte bir rolün olur: pilot, gözlemci veya retriever. Etkinliğe başvurursun, organizatör onaylayıp rolünü belirler. Etkinlik ekranı rolüne göre açılır."),
        Page(id: 2, icon: "location.north.line", title: "Takip nasıl çalışır?",
             body: "Uçuşu sen başlatırsın. Her GPS noktası önce telefona kaydedilir, bağlantı olduğunda sunucuya gönderilir. Ekrandan çıkmak kaydı durdurmaz; kaydı yalnızca sen bitirirsin. İrtifa GPS irtifasıdır, dikey hız bir tahmindir."),
        Page(id: 3, icon: "car", title: "Retrieve",
             body: "İndiğinde \"Retrieve iste\" ile bulunduğun yeri ve kısa bir not gönderirsin. Bir retriever kabul edince adını, konumunu ve telefonunu görürsün; o da seni bulmak için güncel konumunu görür. Beklerken konumun yaklaşık 30 saniyede bir paylaşılır, alındığında durur."),
        Page(id: 4, icon: "lock.iphone", title: "Arka planda konum",
             body: "Ekran kilitliyken kaydın ve paylaşımın sürmesi için konum iznini \"Her Zaman\" olarak vermen önerilir. Uygulamayı uygulama değiştiriciden kaydırarak kapatırsan iOS konum vermeyi durdurur: iz kesilir ve retriever güncel konumunu göremez. Sürekli GPS pil tüketir; Düşük Güç Modu güncellemeleri seyrekleştirebilir."),
        Page(id: 5, icon: "antenna.radiowaves.left.and.right.slash", title: "Bağlantı ve GPS sınırları",
             body: "Dağda mobil veri olmayabilir. Bağlantı yokken kayıt sürer ve retrieve talebin telefonda bekler; bağlantı gelince gönderilir. Canlı harita anlık değildir ve GPS konumu metrelerce hatalı olabilir. Uygulama durumu her zaman açıkça gösterir."),
        Page(id: 6, icon: "exclamationmark.shield", title: "Acil durum servisi değildir",
             body: "Retfast bir etkinlik ve retrieve uygulamasıdır; acil durum ya da kurtarma servisi değildir, yetkililere veya 112'ye ulaşmaz. Yaralanma veya tehlike durumunda her zaman 112'yi ve normal acil durum kanallarını kullan."),
    ]

    var body: some View {
        VStack(spacing: AeroTokens.Space.s4) {
            TabView(selection: $page) {
                ForEach(pages) { p in
                    ScrollView {
                        VStack(alignment: .leading, spacing: AeroTokens.Space.s4) {
                            Image(systemName: p.icon)
                                .font(.system(size: 56, weight: .light))
                                .foregroundStyle(AeroTokens.primary)
                                .accessibilityHidden(true)
                            Text(p.title).font(.largeTitle.bold()).foregroundStyle(AeroTokens.textPrimary)
                            Text(p.body).font(.body).foregroundStyle(AeroTokens.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                            if p.id == pages.count - 1 {
                                Toggle(isOn: $acknowledged) {
                                    Text("Retfast'in bir acil durum servisi olmadığını; acil durumda 112'yi aramam gerektiğini anladım.")
                                        .font(.subheadline)
                                }
                                .toggleStyle(.switch)
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
            .indexViewStyle(.page(backgroundDisplayMode: .always))

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
