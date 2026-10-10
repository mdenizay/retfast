# 04 – Dağıtım (Dokploy)

## Mevcut durum (2026-10-10) — dokunulmadı

Dokploy `dp.mdenizay.com`, proje `retfast`, ortam `production`, sunucu `51.83.159.253`:

| Servis | Alan adı | Kaynak |
|---|---|---|
| `web` (uygulama) | `retfast.com`, `www` | elle yükleme |
| `app` (compose) | `panel.retfast.com` | **GitHub `main`, her push'ta otomatik deploy** (`apps/web/docker-compose.yml`) |
| `supabase` (compose) | `supa.retfast.com` | ham compose |

> **`main`'e push eski paneli yeniden deploy eder.** Yeni kod `v3` branch'inde durur. `main`'e birleştirmeden önce `app` servisinin otomatik deploy'u kapatılmalı (veya servis `legacy/v2-supabase` branch'ine çevrilmeli).

Cloudflare: `retfast.com` bölgesi aktif. `api.retfast.com` A kaydı var ama arkasında servis yok. Resend DNS kayıtları (`send`, `resend._domainkey`) mevcut.

## Hedef kurulum

Aynı projede, eskilerin yanında:

| Servis | Tür | Not |
|---|---|---|
| `pg` | Dokploy Postgres 17 | dışarıya kapalı; günlük yedek |
| `redis` | Dokploy Redis 7 | dışarıya kapalı; AOF gerekmez (kalıcı veri yok) |
| `v3` | compose, GitHub `v3` → sonra `main` | `infra/compose/docker-compose.yml`; `migrate` → `api` (→ `web`, Faz 2) |

Alan adları (tek origin; cookie ve WS için CORS gerekmez):

| Yol | Hedef |
|---|---|
| `v3.retfast.com/` | web (Faz 2) |
| `v3.retfast.com/api` | api:3001, Traefik `/api` önekini siler |

Geçiş günü `v3.retfast.com` → `retfast.com` olur; eski servisler durdurulur, silinmez.

Geliştirme ortamı: aynı compose, ayrı Dokploy ortamı (`staging`), ayrı Postgres/Redis, `dev.retfast.com`.

## Adımlar (henüz çalıştırılmadı — onay bekliyor)

1. Dokploy'da `pg` ve `redis` servislerini oluştur; şifreleri üret.
2. Compose servisi `v3`: depo `mdenizay/retfast`, branch `v3`, yol `infra/compose/docker-compose.yml`, otomatik deploy kapalı. Ortam değişkenleri: `infra/compose/.env.example`.
3. Cloudflare: `v3.retfast.com` A → `51.83.159.253`, proxied, SSL Full (strict). WebSocket Cloudflare'de varsayılan açık.
4. Dokploy → Domains: `v3.retfast.com` + yol `/api` → `api:3001`, "strip path" açık.
5. Deploy, sonra: `docker exec <api> retfast-server grant-admin <email>`.
6. Doğrula: `curl https://v3.retfast.com/api/v1/ready`.

Kimlikler git dışı `infra/secrets.local.env` içinde tutulur (`DOKPLOY_TOKEN`, `CLOUDFLARE_API_TOKEN`, …). Şu an çalışan erişim `~/Works/yuut/infra/secrets.local.env` içindeki belirteçlerle doğrulandı (Dokploy proje listesi ve Cloudflare `retfast.com` bölgesi okunabiliyor).

## İşletim

- **Migration:** her deploy'da `migrate` servisi çalışır; başarısızsa `api` başlamaz. Migration'lar ileri uyumlu yazılır (önce ekle, sonra kullan, en son kaldır) ki bir önceki imaja dönmek güvenli olsun.
- **Geri dönüş:** Dokploy'da önceki commit'i yeniden deploy et. Şema geri alınmaz.
- **Yedek:** Dokploy Postgres yedeği → Cloudflare R2, günlük, 14 gün. Geri yükleme Faz 5'te tatbik edilecek.
- **Sağlık:** `/v1/ready` (compose healthcheck). Traefik "starting" konteynere yönlendirmez; deploy sonrası ~15 sn 404 olabilir.
- **Log:** JSON, stdout → Dokploy. İstek başına `tower_http` izi; 5xx'ler `internal error` olarak hata ayrıntısıyla loglanır, istemciye ayrıntı gitmez.
- **WS:** sunucu 25 sn'de bir ping yollar (Cloudflare boşta kesme süresi ~100 sn). Kapanışta 20 sn `stop_grace_period`; istemci yeniden bağlanıp `/live` çeker.
