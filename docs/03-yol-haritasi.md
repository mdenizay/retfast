# 03 – Yol Haritası

Her faz sonunda sistem çalışır durumda kalır; faz bitmeden sonrakine geçilmez.

## Faz 0 – Temel ✅
- Eski kod `legacy/v2-supabase` branch'inde ve `v2-final` etiketinde.
- Teknik kararlar, mimari, veri modeli, API ve yetki sözleşmesi.

## Faz 1 – Backend çekirdeği ✅
- Kimlik, etkinlik, başvuru, üyelik, konum alımı, canlı yayın, uçuş, retrieve, SOS, denetim kaydı.
- Uçtan uca testler (gerçek Postgres + Redis + WS), CI, Dockerfile, Dokploy compose.
- Eksik bırakılanlar (bilinçli): davet e-postası, duyurular, push bildirimi, raporlar, veri saklama temizliği.

## Faz 2 – Web paneli ✅ (retfast.com'da canlı)
- `packages/core`: tipli API istemcisi, canlı bağlantı (WS + snapshot eşitleme, yeniden bağlanma), en/tr sözlükler.
- `apps/web`: tanıtım sayfası + herkese açık etkinlikler, kayıt/giriş, etkinlik detayı ve başvuru, panelim, profil.
- Observer canlı konsolu: MapLibre harita (arazi gölgelendirme), gruplu operasyon listesi, arama, pilot detay paneli, takip, iz gösterme, retrieve atama/iptal, pilot adına durum, SOS bandı + sesli uyarı, zaman çizelgesi.
- Etkinlik admini: başvurular, katılımcı/rol/numara/araç, harita noktaları (haritaya tıklayarak), araçlar, ayarlar.
- Sistem admini: etkinlik oluşturma, etkinlik admini atama, kullanıcı arama, sistem istatistikleri.
- `scripts/simulate.ts`: sahte pilot/retriever ile yerel uçtan uca deneme.
- Eksikler: bölge (polygon) çizimi, duyurular, davet e-postası, raporlar, açık tema, dar ekranda konsol listesi, uçuş izinin oynatılması.

## Faz 3 – Mobil (iOS)
1. `apps/mobile` (Expo dev build): giriş, etkinliklerim, rol ekranları, harita.
2. `modules/retfast-tracking` (Swift): eski `TrackingEngine`/`SyncEngine` taşınır; uyarlanabilir profil sunucudan.
3. Pilot: uçuş ekranı, Retriever İste, SOS (basılı tutarak onay). Retriever: müsaitlik, görev kabul, durak listesi, haritaya yönlendirme.
4. Push (APNs) + çevrimdışı harita paketi.
5. Saha testi: ekran kilitli, düşük güç modu, zayıf bağlantı, 4+ saat; pil tüketimi ölçümü.
6. TestFlight.

## Faz 4 – Operasyon derinliği (kısmen ✅)
Yapıldı ve canlı:
- Duyurular (yayınla/sil, üyelere bildirim, mobil ve web etkinlik sayfasında), e-posta daveti (Resend anahtarı girilene kadar yalnızca loglanır).
- Etkinlik raporu (web: Yönet → Rapor).
- İz dışa aktarma: GPX ve IGC (web konsolu detay paneli); uçuşu zaman çizelgesiyle oynatma (15×/60×/240×).
- Otomatik kalkış/iniş **önerisi** (sunucu tarafı, mobilde pilota onay sorusu); durum kendiliğinden değişmez.

Yapılmadı:
- **Android takip modülü** (Kotlin, foreground service): bu makinede Android SDK ve JDK yok, derleyip doğrulayamadığım kodu "bitti" saymıyorum. Eski `legacy/v2-supabase` içindeki `TrackingService/SyncEngine/PointBuffer` taşınacak; iOS modülüyle aynı sözleşme (`docs/06-mobil.md`).
- **Push bildirimi** (APNs/FCM): Apple Developer anahtarı ve Firebase projesi gerekiyor.
- Retriever operasyon paneli (web) için ayrı ekran, akıllı atama önerisi, IGC içe aktarma.

## Faz 5 – Üretim sertleştirme
- KVKK/GDPR: veri dışa aktarma, hesap silme, saklama süresi temizliği, metinler.
- Yedekleme + geri yükleme tatbikatı, uyarılar, eski Supabase yığınının kapatılması ve alan adı geçişi.

## Sonraya bırakılanlar
Akıllı atama/rota optimizasyonu, geofence uyarıları, hava durumu, harici takip cihazları (LoRa vb.), bas-konuş, QR ile katılımcı kontrolü, ekipman kaydı. Şema bunlara engel değil (`settings` jsonb, `stop_order`, `event_zones`, `bib`).
