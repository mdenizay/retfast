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
             body: "Retfast yamaç paraşütü uçuşlarınızı GPS ile kaydeder, katıldığınız organizasyonun canlı haritasında paylaşır ve acil durumda konumunuzu kurtarma ekibine iletmeye çalışır."),
        Page(id: 1, icon: "location.north.line", title: "Takip nasıl çalışır?",
             body: "Uçuşu siz başlatırsınız. Her GPS noktası önce telefonunuza kaydedilir, bağlantı olduğunda sunucuya gönderilir. Uçuş ekranından çıkmak kaydı durdurmaz; kaydı yalnızca siz bitirirsiniz."),
        Page(id: 2, icon: "lock.iphone", title: "Arka planda konum",
             body: "Ekran kilitliyken kaydın sürmesi için konum iznini \"Her Zaman\" olarak vermeniz önerilir. Kayıt sırasında durum çubuğunda konum göstergesi görünür. Uygulamayı uygulama değiştiriciden kaydırarak kapatırsanız iOS konum vermeyi durdurur ve iz kesilir."),
        Page(id: 3, icon: "battery.75percent", title: "Pil kullanımı",
             body: "Sürekli GPS pil tüketir. Uçuşa tam şarjla çıkın. Düşük Güç Modu ve yüksek sıcaklık konum güncellemelerini seyrekleştirebilir; örnekleme sıklığı hedeftir, garanti değildir."),
        Page(id: 4, icon: "eye", title: "Gizlilik ve paylaşım",
             body: "Her uçuş için görünürlüğü siz seçersiniz: yalnızca ben, organizasyon veya herkese açık. Acil durum çağrısı açtığınızda yetkili kurtarma ekibi son konumunuzu ve acil durum kişinizi görebilir."),
        Page(id: 5, icon: "antenna.radiowaves.left.and.right.slash", title: "Bağlantı sınırları",
             body: "Dağda mobil veri olmayabilir. Bağlantı yokken kayıt devam eder ama canlı haritada görünmezsiniz; veriler bağlantı gelince gönderilir. Uygulama durumu her zaman \"senkronize\", \"bekleyen\" veya \"çevrimdışı\" olarak gösterir."),
        Page(id: 6, icon: "sos", title: "Acil durum sınırlamaları",
             body: "Retfast SOS, çağrınızı internet üzerinden Retfast sunucusuna iletir. Yetkililere veya 112'ye otomatik olarak ulaşmaz ve acil servislerin yerini tutmaz. Bağlantı yoksa çağrı iletilemez; uygulama çağrının hangi aşamada olduğunu açıkça gösterir. Mümkünse her zaman 112'yi arayın."),
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
                                    Text("Retfast'in acil servislerin yerini tutmadığını ve bağlantı olmadan çağrı iletemeyeceğini anladım.")
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
