# 01 – Mimari ve Veri Modeli

## Bileşenler

```
 mobil (Expo + yerel takip modülü) ─┐                      ┌─ PostgreSQL 17  (kalıcı her şey)
 web (Next.js: site + panel) ───────┼─ HTTPS/WSS ─► API ───┤
                                    │   (Rust, tek ikili)  └─ Redis  (güncel konum, yayın, oturum önbelleği, hız sınırı)
                                    └─ Cloudflare ─ Traefik (Dokploy)
```

API durumsuzdur; WS yayını Redis pub/sub üzerinden geçtiği için birden çok örnek yan yana çalışabilir. Redis kaybolursa kalıcı veri etkilenmez: güncel konumlar bir sonraki partiyle yeniden oluşur.

## Sunucu kod düzeni (`server/src`)

| Dosya | Sorumluluk |
|---|---|
| `auth.rs` | şifre, oturum belirteci, `AuthUser` çıkarıcısı, hız sınırı |
| `authz.rs` | `Access::load(event, user)` → rol; `admin()/staff()/member()` kapıları. **Her etkinlik ucu bununla başlar.** |
| `oplog.rs` | `record` (event_log + canlı yayın), `audit`, `notify` |
| `realtime.rs` | etkinlik başına yayın merkezi (Redis ↔ süreç içi kanal) |
| `routes/*.rs` | uçlar; okuma yanıtları SQL'de JSON olarak kurulur, yazmalar koşullu `UPDATE` ile durum geçişi yapar |
| `migrations/` | şema (kaynak gerçek burasıdır) |

Kural: bir işlem içinde `oplog::record` çağrılır, dönen değer **commit'ten sonra** `publish` edilir. Böylece yayınlanan her olay kalıcıdır.

## Veri modeli

Şemanın tamamı ve yorumları: `server/migrations/0001_init.sql`.

| Tablo | Not |
|---|---|
| `users`, `sessions`, `user_identities` | tek hesap; `is_system_admin` tek global yetki |
| `events` | `status`: draft → published → active → completed → archived; `visibility`: public / private (+ `invite_code`) |
| `event_points`, `event_zones`, `vehicles` | kalkış/iniş/toplanma/risk noktaları, GeoJSON bölgeler, retrieve araçları |
| `event_members` | **rol burada**: kullanıcının o etkinlikteki tek rolü (`event_admin`, `pilot`, `retriever`, `observer`) |
| `applications` | pending → accepted / rejected / cancelled; kullanıcı başına tek bekleyen başvuru |
| `tracking_sessions` | kullanıcı + etkinlik başına tek açık oturum; etkinlik bitince sunucu kapatır |
| `location_points` | PK `(event_id, user_id, recorded_at)` |
| `flights` | preparing / flying / landed / completed / cancelled; pilot başına tek açık uçuş |
| `retrieve_requests` | open → assigned → arrived → picked_up → completed (+ cancelled); pilot başına tek aktif talep |
| `sos_alerts` | active → acknowledged → resolved; retrieve'den bağımsız |
| `event_log` | sıra numaralı operasyon günlüğü: canlı yayın + eşitleme + zaman çizelgesi |
| `audit_log` | yönetim işlemleri ve başkası adına yapılan her müdahale |
| `notifications` | uygulama içi; `critical` bayrağı operasyon bildirimini ayırır |

Benzersizlik kuralları (tek açık uçuş, tek aktif talep, tek bekleyen başvuru, tek açık takip oturumu) kısmi benzersiz indekslerle **veritabanında** zorlanır; uygulama kodu yalnızca çakışmayı anlamlı hataya çevirir.

### Pilotun görünen durumu

İstenen sekiz durum iki tablodan türetilir, ayrıca saklanmaz (sapma olmaz):

| Görünen durum | Kaynak |
|---|---|
| Hazırlanıyor (`preparing`) | açık uçuş yok |
| Kalkış yaptı / Uçuşta (`flying`) | `flights.status = flying` (`takeoff_at` kalkış anı) |
| İniş yaptı (`landed`) | `flights.status = landed`, aktif talep yok |
| Retriever bekliyor (`awaiting_retrieve`) | talep `open` |
| Retriever atandı (`retriever_assigned`) | talep `assigned` / `arrived` |
| Alındı / araçta (`picked_up`) | talep `picked_up` |
| Operasyon tamamlandı (`completed`) | talep `completed` → uçuş `completed` |

"Kalkış yaptı" ile "Uçuşta" tek durumdur; aralarındaki fark yalnızca zamandır. GPS'ten otomatik kalkış/iniş tahmini Faz 3'te **öneri** olarak gelir (pilot onaylar), durumu kendiliğinden değiştirmez.

### Çok duraklı retrieve

Her talep bir duraktır. Bir retriever'ın aynı anda birden çok `assigned/arrived/picked_up` talebi olabilir; üst sınır aracının kapasitesidir (atama anında sunucuda kontrol edilir). `stop_order` sütunu sıralama/optimizasyon için ayrıldı.

## Güvenlik ve gizlilik

- Konum yalnızca aynı etkinliğin aktif üyelerine ve sistem adminine görünür; her okuma `Access::load` ile kapılanır, WS el sıkışmada aynı kontrol yapılır, üyeliği biten kullanıcının bağlantısı kapatılır.
- Telefon: yetkililer ve retriever'lar görür; pilotlar birbirininkini görmez. E-posta ve acil durum kişisi yalnızca yetkililere.
- Özel ve taslak etkinlikler üye olmayana 404 döner (varlığı sızmaz).
- Konum paylaşımı için açık rıza (`users.location_consent_at`) olmadan takip başlamaz. Etkinlik `active` olmaktan çıkınca açık oturumlar sunucuda kapanır; cihaz bir sonraki yüklemede `TRACKING_SESSION_CLOSED` alır ve GPS'i durdurur.
- Hız sınırı: kayıt, giriş (IP + e-posta), konum yükleme (kullanıcı başına). Gövde sınırı 256 KB, parti başına en çok 500 nokta.
- KVKK/GDPR için eksikler (Faz 5): veri dışa aktarma, hesap silme, saklama süresi dolunca otomatik silme, aydınlatma metni.
