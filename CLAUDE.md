# Retfast – Geliştirici Rehberi

Hava sporları etkinliklerinde pilot / retriever / observer koordinasyonu. Kararlar ve gerekçeleri `docs/00-kararlar.md`;
bir alana dokunmadan önce ilgili dokümanı oku.

## Dikkat
- **`main`'e push etme.** Dokploy'daki eski `panel.retfast.com` servisi `main`'den otomatik deploy olur. Geliştirme `v3` branch'inde (bkz. `docs/04-deploy.md`).
- Dokploy'daki mevcut `web`, `app`, `supabase` servisleri canlıdır; değiştirme, silme.
- Gizli bilgiler repoya yazılmaz: `server/.env`, `infra/secrets.local.env` (git dışı).

## Ortam
- Rust stable, yerel PostgreSQL 17 ve Redis (Homebrew). Geliştirme DB: `retfast_dev`, kullanıcı/şifre `retfast`.
- Testler kendi veritabanını açar (`retfast_test_<uuid>`); mevcut DB'yi sıfırlama. Temizlik: `server/scripts/drop-test-dbs.sh`.
- Docker yerelde yok; imajlar sunucuda derlenir.

## Sunucu (`server/`)
- Değişiklikten sonra: `cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test`.
- Her etkinlik ucu `Access::load(...)` + `.admin()/.staff()/.member()` ile başlar. Yetkiyi başka yerde kontrol etme.
- Durum geçişi = koşullu `UPDATE … WHERE status = ANY(...)`; satır dönmezse `Conflict`. Önce oku-sonra-yaz yapma.
- Operasyon olayı: işlem içinde `oplog::record`, **commit'ten sonra** `.publish()`. Başkası adına işlem → `oplog::audit`.
- SQL `'static` olmalı (sqlx 0.9); dinamik SQL kurma, koşulu parametreyle sorgunun içine taşı.
- Okuma yanıtları SQL'de `jsonb_build_object` ile kurulur; hassas alanları (telefon, e-posta) role göre koşullu ekle.
- Gövdesi isteğe bağlı uçlarda `OptJson<T>` kullan (`Option<Json<T>>` boş gövde + Content-Type'ta 400 verir).
- Şema değişikliği: yeni `migrations/NNNN_ad.sql`; var olan migration düzenlenmez. İleri uyumlu yaz.
- Yeni yazma ucu → `tests/flow.rs` içinde test.

## Kurallar
- Kod ve tanımlayıcılar İngilizce; yorumlar ve dokümanlar Türkçe.
- Kullanıcıya görünen metin i18n anahtarıdır (en + tr); API İngilizce `code` döner, çeviri istemcide.
- Zaman UTC `timestamptz`; ID UUID v7.
