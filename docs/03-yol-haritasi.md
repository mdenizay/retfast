# 03 – Yol Haritası

Her faz sonunda sistem çalışır durumda kalır; faz bitmeden sonrakine geçilmez.

## Faz 0 – Temel ✅
- Eski kod `legacy/v2-supabase` branch'inde ve `v2-final` etiketinde.
- Teknik kararlar, mimari, veri modeli, API ve yetki sözleşmesi.

## Faz 1 – Backend çekirdeği ✅
- Kimlik, etkinlik, başvuru, üyelik, konum alımı, canlı yayın, uçuş, retrieve, SOS, denetim kaydı.
- Uçtan uca testler (gerçek Postgres + Redis + WS), CI, Dockerfile, Dokploy compose.
- Eksik bırakılanlar (bilinçli): davet e-postası, duyurular, push bildirimi, raporlar, veri saklama temizliği.

## Faz 2 – Web paneli (sıradaki)
1. `apps/web` (Next.js, Tailwind, shadcn/ui, en/tr) + `packages/shared` + `packages/api-client` (WS yeniden bağlanma/resync dahil).
2. Giriş/kayıt, etkinlik listesi ve detayı, başvuru.
3. Etkinlik admini: başvurular, üyeler, harita noktaları/bölgeleri, araçlar.
4. **Observer ekranı**: canlı harita (MapLibre), operasyon listeleri, pilot detay paneli, retrieve atama, SOS alarmı.
5. Sistem admini: etkinlikler, kullanıcılar, sağlık/istatistik.
6. Yeni yığının `v3.retfast.com` altında yayına alınması (eski site ve panel dokunulmadan).

Çıkış ölçütü: ilk sürüm akışı tarayıcıdan + betikle üretilen sahte pilotlarla baştan sona izlenebiliyor.

## Faz 3 – Mobil (iOS)
1. `apps/mobile` (Expo dev build): giriş, etkinliklerim, rol ekranları, harita.
2. `modules/retfast-tracking` (Swift): eski `TrackingEngine`/`SyncEngine` taşınır; uyarlanabilir profil sunucudan.
3. Pilot: uçuş ekranı, Retriever İste, SOS (basılı tutarak onay). Retriever: müsaitlik, görev kabul, durak listesi, haritaya yönlendirme.
4. Push (APNs) + çevrimdışı harita paketi.
5. Saha testi: ekran kilitli, düşük güç modu, zayıf bağlantı, 4+ saat; pil tüketimi ölçümü.
6. TestFlight.

## Faz 4 – Android + operasyon derinliği
- Kotlin takip modülü (foreground service), FCM.
- Retriever operasyon paneli, duyurular, davet e-postası, otomatik kalkış/iniş önerisi, etkinlik raporu.
- Uçuş izinin yeniden oynatılması, IGC/GPX dışa aktarma.

## Faz 5 – Üretim sertleştirme
- KVKK/GDPR: veri dışa aktarma, hesap silme, saklama süresi temizliği, metinler.
- Yedekleme + geri yükleme tatbikatı, uyarılar, eski Supabase yığınının kapatılması ve alan adı geçişi.

## Sonraya bırakılanlar
Akıllı atama/rota optimizasyonu, geofence uyarıları, hava durumu, harici takip cihazları (LoRa vb.), bas-konuş, QR ile katılımcı kontrolü, ekipman kaydı. Şema bunlara engel değil (`settings` jsonb, `stop_order`, `event_zones`, `bib`).
