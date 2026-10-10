# 06 – Mobil Uygulama (iOS)

`apps/mobile`: Expo (dev client) + Expo Router + **yerel takip modülü** (`modules/retfast-tracking`, Swift).
Bundle ID `com.mizibu.retfast`. Web ile aynı API, aynı ortak paket (`@retfast/core`: tipli istemci, canlı bağlantı, en/tr metinler).

## Neden yerel takip modülü

Konum yakalama, kuyruk ve yükleme **JS'e bağlı değil**. iOS uygulamayı öldürüp konum olayıyla (significant change) yeniden
başlattığında JS motorunu beklemeden `RetfastTrackingLaunchSubscriber` takibi sürdürür. Kuyruk SQLite (WAL) dosyasındadır;
sunucu 200 dönmeden nokta silinmez.

| Parça | Dosya | Görevi |
|---|---|---|
| Motor | `TrackingEngine.swift` | CoreLocation; sunucudan gelen `moving/slow/stationary` profillerine göre doğruluk, mesafe filtresi ve en az aralık; düşük pilde aralığı uzatır; hareketsizken seyrek "kalp atışı" konumu |
| Kuyruk | `PointStore.swift` | `(session_id, t)` benzersiz; en çok 50 000 nokta (eskiler düşer) |
| Senkron | `SyncEngine.swift` | toplu (≤100), üstel backoff **son tarih olarak** (uyumaz), arka plan görevi, `NWPathMonitor` ile bağlantı gelince boşaltır, 401/409 yönetimi |
| Kalıcılık | `Models.swift` | oturum `UserDefaults`, belirteç Keychain (`AfterFirstUnlock`) |
| Köprü | `RetfastTrackingModule.swift` | `start/stop/reset/flush/getStatus`, `onStatus`, `onSessionEvent` |

Sunucu davranışı: kullanıcı takibi durdurduktan sonra çevrimdışı kuyruk 6 saat boyunca kabul edilir; üyelik silindiyse veya
admin/etkinlik oturumu kapattıysa `409 TRACKING_SESSION_CLOSED` döner ve cihaz kuyruğu silip durur.

## Çalıştırma (simülatör)

```sh
cd apps/mobile
bun install
bunx expo prebuild --platform ios --no-install && (cd ios && pod install)   # önce bir kez; modül/eklenti değişince tekrar
EXPO_PUBLIC_API_URL=http://localhost:3001/v1 bunx expo start --dev-client   # yerel API
bunx expo run:ios                                                           # derler ve simülatöre kurar
```

Varsayılan API `https://retfast.com/api/v1`. Expo Go kullanılamaz (yerel modül var).

## Bilinen kısıtlar / yapılacaklar

- **UIScene:** iOS 27 SDK ile derlenen uygulamalar UIScene yaşam döngüsünü benimsemek zorunda. Expo şablonu henüz
  benimsemediği için `plugins/with-ios-scenes.js` bunu uygular; Expo şablonu düzelince kaldır.
- Push bildirimi (APNs), çevrimdışı harita paketleri, otomatik kalkış/iniş önerisi: henüz yok.
- Gerçek cihazda test edilmedi: ekran kilitliyken, düşük güç modunda, 4+ saat, zayıf bağlantı. Simülatör arka plan konumunu
  ve pil davranışını doğrulamaz; TestFlight öncesi zorunlu.
- Android: ayrı modül (Kotlin, foreground service) — Faz 4.
