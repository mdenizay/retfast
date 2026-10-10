# 00 – Teknik Kararlar

Her karar gerekçesi ve vazgeçilen seçenekle birlikte. Değiştirmeden önce buradaki gerekçenin hâlâ geçerli olup olmadığına bak.

## 1. Backend: Rust (axum + tokio + sqlx)

| Ölçüt | Rust | Go | Bun + Hono |
|---|---|---|---|
| Bellek (yük altında) | 113 MB (ölçüldü, aşağıda) | daha yüksek (GC'li; ölçülmedi) | en yüksek (JS çalışma zamanı; ölçülmedi) |
| Uzun ömürlü WebSocket yayını | GC yok, gecikme öngörülebilir | iyi, GC duraklaması küçük | tek iş parçacığı; yayın ve API aynı döngüde |
| Geliştirme hızı | en yavaş | orta | en hızlı |
| Tip paylaşımı (web/mobil) | OpenAPI/elle | OpenAPI/elle | doğrudan (TS) |
| Uzun vadeli bakım | derleyici çoğu hatayı yakalar | basit, sade | çalışma zamanı hâlâ hızlı değişiyor |

**Seçim: Rust.** Belirleyici olanlar:
- Sunucu paylaşımlı (aynı makinede ~14 proje). Küçük ve sabit bellek ayak izi burada gerçek bir kısıt.
- İş yükü tam olarak Rust'ın iyi olduğu yer: çok sayıda kısa yazma isteği + uzun ömürlü WS yayını.
- Yük hiçbir aday için sorun değil (400 pilot ≈ 40 istek/sn); bu yüzden karar hızdan değil **işletim maliyeti ve doğruluktan** verildi.
- Aynı ekip `yuut` projesinde Bun → Rust geçişini yeni yaptı; iki ayrı backend yığını taşımamak bakım kazancı.

Bedeli: TS ile doğrudan tip paylaşımı yok. Karşılığı: API sözleşmesi `docs/02-api-ve-yetki.md` + `packages/api-client` (Faz 2'de elle yazılmış ince TS istemcisi; uç sayısı ~45, üretilmiş istemciye değmez).

Ölçüm (M-serisi dizüstü, release, yerel Postgres 17 + Redis): 400 pilot, 12 000 istek / 120 000 nokta → **10 300 istek/sn, p95 47 ms**, süreç belleği 113 MB. 20 izleyicinin her biri 12 000 konum güncellemesi yerine 3 birleştirilmiş çerçeve aldı.

## 2. Mobil: Expo (dev build) + kendi yerel takip modülümüz

Soru "Expo mu native mi" değil, **takip kodu nerede çalışacak**:

- Arayüz tek kod tabanı olmalı (iOS + Android, küçük ekip) → React Native / Expo.
- Takip JS'e bağlı olmamalı. iOS uygulamayı öldürüp konum olayıyla yeniden başlattığında JS motorunun açılmasını beklemek, kısa arka plan penceresinde yükleme yapmak ve kuyruğu JS'te tutmak kırılgan. Eski sürümde (bkz. `legacy/v2-supabase` → `docs/ios-tracking.md`) tam bu sınıftan hatalar sahada yaşandı.
- Bu yüzden takip, **Expo Modules API ile yazılmış yerel bir modül** (`modules/retfast-tracking`): Swift'te `CLLocationManager` + arka plan oturumu + significant-change ile yeniden başlatma, Kotlin'de foreground service + Fused Location. Modül noktayı yerel SQLite'a yazar, partileri kendisi yükler; JS yalnızca başlat/durdur der ve durumu dinler.
- Eski native uygulamadaki `TrackingEngine` / `SyncEngine` / `PointBuffer` sahada test edilmiş; doğrudan bu modüle taşınacak.

Vazgeçilenler: `expo-location` arka plan görevi (JS'e bağımlı, uyarlanabilir profil ve yerel kuyruk kontrolü zayıf); `react-native-background-geolocation` (olgun ama Android için ücretli lisans ve kapalı çekirdek); iki ayrı tam native uygulama (her ekran iki kez yazılır).

Expo Go kullanılamaz (yerel modül var); geliştirme `expo-dev-client` ile.

## 3. Harita: MapLibre + PMTiles, çevrimdışı bölge paketleri

- **MapLibre** (web: GL JS, mobil: MapLibre Native). Açık kaynak, kullanıcı/yükleme başına ücret yok, çevrimdışı kullanımda lisans kısıtı yok. Mapbox: MAU ücretli, çevrimdışı paketler lisansa bağlı.
- **Karolar:** geliştirmede ücretsiz bir açık vektör stil (OpenFreeMap). Üretimde etkinlik bölgesinin **PMTiles** kesiti Cloudflare R2'de (tek dosya, sunucu gerektirmez). Stil URL'i ortam değişkeni; sağlayıcı kod değişmeden değişir.
- **Çevrimdışı:** mobilde MapLibre Native offline pack — etkinlik sınır kutusu, zoom 8–15. Pilot/retriever etkinliğe katılınca Wi-Fi'da indirir. Dağlık bölge için eş yükselti/arazi katmanı aynı pakete girer (Faz 4).
- Yönlendirme (retriever → pilot): uygulama içi rota yok; cihazın harita uygulamasına derin bağlantı (Apple/Google/Yandex). Tahmini süre için Faz 4'te OSRM değerlendirilir.

## 4. Konum verisi: cihaz kuyruğu → senkron PostgreSQL yazımı → Redis güncel konum + yayın

```
cihaz SQLite kuyruğu ──POST parti──► API ──INSERT … ON CONFLICT DO NOTHING──► PostgreSQL (kalıcı)
                                      ├─ Lua: daha yeniyse HSET live:{event} ───► Redis (güncel konum)
                                      └─ PUBLISH rt:{event} ───────────────────► WS merkezleri ─► izleyiciler (1 sn'de bir, birleştirilmiş)
```

- **Kalıcı kuyruk cihazdadır.** Sunucu noktaları PostgreSQL'e yazmadan 200 dönmez; cihaz 200 almadan silmez. Arada kaybolacak bir halka yok.
- **Sunucuda ayrı kuyruk (Redis Stream + worker) bilinçli olarak yok.** Ölçülen kapasite ihtiyacın ~250 katı; kuyruk yalnızca yeni bir arıza noktası ve "200 dedik ama henüz yazmadık" penceresi eklerdi. Tek düğümde yazma tavanına yaklaşılırsa eklenecek yer bellidir (ingest ucu).
- **Çoğaltma engeli:** birincil anahtar `(event_id, user_id, recorded_at)`. Aynı cihaz aynı milisaniyede iki fix üretmez; tekrar gönderilen parti sessizce atlanır. Aynı indeks "etkinlik + kullanıcı + zaman aralığı" sorgusunu da karşılar — ek indeks yok.
- **Sıra:** sıralama alınma zamanına değil fix zamanına göre. Gecikmiş eski nokta saklanır ama güncel konumu geri almaz (Lua betiği zaman damgasını karşılaştırır).
- **Yayın:** konumlar WS bağlantısında kullanıcı bazında birleştirilir, saniyede en çok bir çerçeve. Operasyon olayları (`event_log`, sıra numaralı) anında gider.
- **Yeniden bağlanma:** istemci `GET /events/{id}/live` ile tam durumu çeker, `seq > last_seq` olayları uygular; gerekirse `GET /events/{id}/log?after=` ile aradaki olayları alır.
- **Saklama:** ~210 bayt/nokta. 400 pilot × 6 saat ≈ 1,7 M nokta ≈ 360 MB/gün. Saklama süresi etkinlik ayarı; temizlik etkinlik bazında toplu silme (Faz 3). Tablo bölümleme şimdilik yok — tek etkinlik ölçeğinde gerekmez.

## 5. Monorepo

```
server/            Rust API (tek ikili: serve | migrate | grant-admin)
apps/web/          Next.js – tanıtım sitesi + panel            (Faz 2)
apps/mobile/       Expo – pilot / retriever                    (Faz 3)
  modules/retfast-tracking/   yerel takip modülü (Swift + Kotlin)
packages/shared/   TS: API tipleri, durum makinesi sabitleri, i18n sözlükleri (en, tr)
packages/api-client/  TS: fetch istemcisi + WS istemcisi (yeniden bağlanma, resync)
infra/             Dockerfile'lar, Dokploy compose
docs/
```

Bun workspaces (TS tarafı) + bağımsız Cargo projesi. Paylaşılan: tipler, hata kodları, pilot durum etiketleri, çeviri sözlükleri, WS istemcisi. **İş kuralları paylaşılmaz, yalnızca sunucudadır**; istemciler durumu sunucudan okur (ör. `pilot_state` sunucuda hesaplanır). Web: Next.js (tanıtım sitesi SEO ister; panel aynı uygulamada), Tailwind + shadcn/ui.

## 6. Kimlik doğrulama: opak oturum belirteci

256 bit rastgele belirteç; veritabanında yalnızca SHA-256 özeti. Web'de httpOnly + SameSite=Lax cookie, mobilde `Authorization: Bearer` (Keychain/Keystore). 90 gün kayan süre, anında iptal. Redis'te 60 sn önbellek.

JWT + yenileme belirteci yok: arka planda konum yükleyen yerel kod belirteç yenilemek zorunda kalmamalı (eski sürümde 401 senkronu durduruyordu). Şifre: Argon2id; eşzamanlı özetleme 4 ile sınırlı (yük testinde sınırsız hâli 1,2 GB bellek kullandı). Google/Apple girişi için `user_identities` tablosu hazır.

## 7. Dağıtım

Bkz. `04-deploy.md`. Özet: Dokploy'da ayrı Postgres + Redis servisleri, tek compose (`migrate` → `api`, sonra `web`), tek origin (`/api` öneki), Cloudflare proxy arkasında WSS.
