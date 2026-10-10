# Retfast

Yamaç paraşütü yarışmaları ve XC etkinlikleri için pilot, retriever ve observer koordinasyonu:
etkinlik yönetimi, gerçek zamanlı konum takibi, retrieve operasyonu ve SOS — tek sistemde.

> Bu branch (`v3`) sıfırdan yazılan sürümdür. Önceki Supabase + native sürüm: `legacy/v2-supabase` (etiket `v2-final`).

## Durum

| Parça | Durum |
|---|---|
| `server/` – Rust API (kimlik, etkinlik, başvuru, konum, canlı yayın, retrieve, SOS) | canlı: https://retfast.com/api/v1 |
| `apps/web/` – Next.js site + panel + canlı konsol | canlı: https://retfast.com |
| `apps/mobile/` – Expo + yerel takip modülü | Faz 3 |

## Çalıştırma

Gerekenler: Rust (stable), PostgreSQL 17, Redis.

```sh
psql -d postgres -c "create role retfast login password 'retfast' createdb"
createdb -O retfast retfast_dev
cd server
cp .env.example .env
cargo run -- migrate
cargo run                      # http://127.0.0.1:3001/v1/health
cargo run -- grant-admin sen@ornek.com   # kayıt olduktan sonra ilk sistem admini
```

Web (API çalışırken):

```sh
bun install
bun run dev:web                # http://localhost:3000 (/api → 127.0.0.1:3001)
bun scripts/simulate.ts --api http://127.0.0.1:3001/v1 --admin <email> --password <şifre>   # sahte pilotlar
```

Test (her test kendi geçici veritabanını açar; Postgres ve Redis çalışıyor olmalı):

```sh
cd server && cargo test
./scripts/drop-test-dbs.sh     # geçici veritabanlarını temizle
```

## Dokümanlar

- [00 – Teknik kararlar](docs/00-kararlar.md): backend dili, mobil yaklaşım, harita, konum veri hattı, monorepo, kimlik
- [01 – Mimari ve veri modeli](docs/01-mimari.md)
- [02 – API ve yetki](docs/02-api-ve-yetki.md)
- [03 – Yol haritası](docs/03-yol-haritasi.md)
- [04 – Dağıtım](docs/04-deploy.md)
