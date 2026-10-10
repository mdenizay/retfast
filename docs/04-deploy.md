# 04 – Dağıtım (Dokploy)

## Mevcut durum (2026-10-10)

Dokploy `dp.mdenizay.com`, proje `retfast`, ortam `production`, sunucu `51.83.159.253`. Kimlikler ve servis ID'leri git dışı `infra/secrets.local.env` içinde.

| Servis | Durum | Alan adı |
|---|---|---|
| `postgres` (Postgres 17, `retfast-pg-*`) | **v3, canlı** | dışarıya kapalı |
| `redis` (Redis 7, `retfast-redis-*`) | **v3, canlı** | dışarıya kapalı |
| `v3` (compose, GitHub `v3` branch, otomatik deploy kapalı) | **v3, canlı**: `migrate` → `api` → `web` | `retfast.com/` + `www` → web:3000 · `retfast.com/api` → api:3001 (önek silinir) |
| ~~`web` (eski tanıtım sitesi)~~ | 2026-10-10 silindi | — |
| `app` (compose, eski panel) | eski, canlı | `panel.retfast.com` — **`main`'e her push'ta otomatik deploy** |
| `supabase` (compose) | eski, canlı | `supa.retfast.com` |

> **`main`'e push eski paneli yeniden deploy eder.** `v3`'ü `main`'e birleştirmeden önce `app` servisinin otomatik deploy'u kapatılmalı; ardından `v3` compose'u `main`'e çevrilir.

DNS (Cloudflare): `retfast.com` A → 51.83.159.253, **proxy kapalı** (sertifika Traefik/Let's Encrypt). `www` CNAME → `retfast.com`. WebSocket doğrudan Traefik'e gider.

## Deploy

```sh
infra/scripts/deploy.sh      # deploy tetikler, bitene kadar bekler
infra/scripts/status.sh      # durum ve son deploy'lar
ssh ubuntu@51.83.159.253 "sudo tail -80 $(infra/scripts/status.sh --log)"   # deploy logu
```

İlk sistem admini (kullanıcı önce https://retfast.com/register ile kayıt olur):

```sh
ssh ubuntu@51.83.159.253 "sudo docker exec \$(sudo docker ps -qf name=retfast-v3-.*-api) retfast-server grant-admin <email>"
```

## Toplu hesap açma

`infra/test-users.csv` (git dışı, `email,ad,soyad[,admin]`) dosyasındaki hesapları açar, rastgele şifreleri bir kez yazdırır:

```sh
ssh ubuntu@51.83.159.253 'sudo docker exec -i $(sudo docker ps -qf name=retfast-v3-.*-api) retfast-server create-users' < infra/test-users.csv
```

## İşletim

- **Migration:** her deploy'da `migrate` servisi çalışır; başarısızsa `api` başlamaz. Migration'lar ileri uyumlu yazılır (önce ekle, sonra kullan, en son kaldır) ki bir önceki imaja dönmek güvenli olsun.
- **Geri dönüş:** Dokploy'da önceki commit'i yeniden deploy et. Şema geri alınmaz.
- **Yedek:** Dokploy Postgres yedeği → Cloudflare R2, günlük, 14 gün. Geri yükleme Faz 5'te tatbik edilecek.
- **Sağlık:** `/v1/ready` (compose healthcheck). Traefik "starting" konteynere yönlendirmez; deploy sonrası ~15 sn 404 olabilir.
- **Log:** JSON, stdout → Dokploy. İstek başına `tower_http` izi; 5xx'ler `internal error` olarak hata ayrıntısıyla loglanır, istemciye ayrıntı gitmez.
- **WS:** sunucu 25 sn'de bir ping yollar (Cloudflare boşta kesme süresi ~100 sn). Kapanışta 20 sn `stop_grace_period`; istemci yeniden bağlanıp `/live` çeker.
