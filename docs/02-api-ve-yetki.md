# 02 – API ve Yetki

Taban: `/v1` (üretimde `https://retfast.com/api/v1`). JSON. Zaman: RFC 3339 UTC; konum noktalarında epoch ms.
Kimlik: `Authorization: Bearer <token>` veya `rf_session` cookie.
Hata: `{ "error": { "code", "message" } }` — istemci `code`'u çevirir. Liste: `{ "data": [...] }`.

## Roller

| Yetki | Kapsam | Nasıl verilir |
|---|---|---|
| Sistem admini | global | `retfast-server grant-admin <email>` |
| Etkinlik admini | tek etkinlik | sistem admini atar |
| Pilot / Retriever / Observer | tek etkinlik | başvuru kabulü veya admin ataması |

`Access` kapıları: **admin** = sistem admini ∨ etkinlik admini · **staff** = admin ∨ observer · **member** = aktif üye ∨ sistem admini.

## Uçlar

| Uç | Kim | Not |
|---|---|---|
| `POST /auth/register` · `/auth/login` · `/auth/logout` | herkes | `{user, token}` döner + cookie |
| `GET/PATCH /me` · `POST /me/consent/location` | giriş | profil, konum rızası |
| `GET /me/events` · `GET /me/notifications` · `POST /me/notifications/read` | giriş | üyelikler + başvurular |
| `GET /events?scope=current\|upcoming\|past` | herkes | public, taslak/arşiv hariç |
| `POST /events` | sistem admini | |
| `GET /events/{id}` | görünürlüğe göre | noktalar, bölgeler, araçlar, kendi üyelik/başvuru durumu |
| `PATCH /events/{id}` | admin | arşivleme yalnız sistem admini; `active`'ten çıkış takip oturumlarını kapatır |
| `POST/DELETE /events/{id}/points\|zones\|vehicles` | admin | |
| `GET /events/{id}/members` | member | iletişim alanları role göre |
| `PUT /events/{id}/members/{user}` | admin | rol ata/değiştir; `event_admin` yalnız sistem admini |
| `DELETE /events/{id}/members/{user}` · `POST /events/{id}/leave` | admin · kendisi | araçta pilot varken reddedilir (`ACTIVE_OPERATION`) |
| `POST /events/{id}/applications` | giriş | özel etkinlikte `invite_code` şart |
| `GET /events/{id}/applications` · `POST /applications/{id}/decide` | admin | `accept` + rol veya `reject`; bildirim + e-posta |
| `POST /applications/{id}/cancel` | başvuran | |
| `POST /events/{id}/tracking/start\|stop` | pilot, retriever | `start` uyarlanabilir takip ayarlarını döner |
| `POST /events/{id}/tracking/points` | oturum sahibi | `{session_id, points:[{t,lat,lon,acc,alt,spd,hdg,bat}]}` ≤ 500 |
| `GET /events/{id}/live` | member | tam canlı durum (üyeler, konumlar, uçuşlar, talepler, SOS, `last_seq`) |
| `GET /events/{id}/log?after=seq` | member | operasyon zaman çizelgesi / eşitleme |
| `GET /events/{id}/tracks/{user}?from&to` | kendisi, staff | `[t, lat, lon, alt, spd]` |
| `GET /events/{id}/ws` | member | canlı kanal |
| `POST /events/{id}/flights/takeoff\|land\|complete` | pilot; staff (`pilot_id` ile) | başkası adına işlem denetlenir |
| `POST /events/{id}/retrieves` | pilot; staff (`pilot_id` ile) | uçuş "uçuyor" ise inişi de kaydeder |
| `POST /retrieves/{id}/accept` | retriever | yalnız `open` iken; yarışı tek kişi kazanır |
| `POST /retrieves/{id}/assign` | staff | `{retriever_id}`; yeniden atama da bu |
| `POST /retrieves/{id}/release` | atanan retriever, pilot, staff | talep yeniden açılır |
| `POST /retrieves/{id}/arrived\|picked-up\|complete` | atanan retriever, staff | |
| `POST /retrieves/{id}/cancel` | pilot, staff | araca alındıktan sonra iptal yok |
| `PUT /events/{id}/availability` | retriever | `{available, vehicle_id?}` |
| `POST /events/{id}/sos` | her aktif üye | etkinlik durumundan bağımsız; tekrar gönderim aynı kaydı döner |
| `POST /sos/{id}/ack` · `/resolve` | staff · staff veya sahibi | |
| `GET/POST /events/{id}/announcements` · `DELETE /announcements/{id}` | member · admin | yayınlayınca tüm aktif üyelere bildirim + `announcement.posted` olayı |
| `POST /events/{id}/invites` | admin | `{emails[≤50], message}`; Resend ile e-posta, kayıtlı kullanıcıya ayrıca bildirim; özel etkinlikte davet kodu e-postaya eklenir |
| `GET /events/{id}/report` | staff | katılım, uçuş sayısı/süresi, retrieve atama/teslim süreleri, SOS, takip hacmi, günlük uçuş |
| `GET /events/{id}/tracks/{user}/export?format=gpx\|igc&from&to` | kendisi, staff | iz dosyası indirir (IGC başlıkları ASCII, basınç irtifası 0) |
| `GET /admin/users\|events\|stats` | sistem admini | |
| `GET /health` · `/ready` | herkes | `ready` Postgres + Redis'i yoklar |

Eşzamanlılık kuralı: her durum geçişi `UPDATE … WHERE status = ANY(izinli)` ile yapılır. Satır dönmezse `409 *_STATE_CHANGED`; istemci durumu yeniler.

## WebSocket çerçeveleri (sunucu → istemci)

| Çerçeve | Anlam |
|---|---|
| `{"t":"hello","last_seq":N}` | bağlandı; `GET /live` çek |
| `{"t":"positions","d":[{u,t,rx,lat,lon,acc,alt,spd,hdg,bat}]}` | ≤ 1/sn, kullanıcı başına son konum. `t` fix zamanı, `rx` sunucuya varış; güncellik `t`'den hesaplanır |
| `{"t":"<olay>","seq":N,"at":ms,"actor","subject","d":{…}}` | kalıcı operasyon olayı |
| `{"t":"tracking.started\|stopped","subject"}` | geçici (seq yok) |
| `{"t":"flight.suggestion","subject","d":{"kind":"takeoff\|landing"}}` | geçici. Sunucu GPS hızından kalkış/iniş **tahmini** üretir (kalkış: uçuş yokken son 5 nokta ≥ 4 m/s ve ≥ 15 sn; iniş: uçuyorken son 8 nokta < 1,5 m/s ve ≥ 40 sn; aynı öneri 10 dk'da bir). Durumu değiştirmez; istemci yalnızca ilgili pilota "kalkış yaptın mı?" diye sorar |
| `{"t":"resync"}` | istemci geride kaldı; `GET /live` çek |

Olaylar: `event.status`, `member.updated`, `member.removed`, `flight.takeoff`, `flight.landed`, `flight.completed`, `retrieve.requested`, `retrieve.assigned`, `retrieve.released`, `retrieve.arrived`, `retrieve.picked_up`, `retrieve.completed`, `retrieve.cancelled`, `retriever.availability`, `announcement.posted`, `sos.raised`, `sos.acknowledged`, `sos.resolved`.

İstemci WS üzerinden komut göndermez; tüm yazmalar HTTP'dir (yeniden deneme ve yetki tek yerde). Sunucu 25 sn'de bir ping yollar.

"Bağlantısı kopmuş kullanıcı" ayrı bir olay değildir: istemci, takip oturumu açık olup son `t`'si eşiği aşan kullanıcıyı bayat gösterir (öneri: 60 sn sarı, 5 dk gri).
