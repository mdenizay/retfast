# Infrastructure Inventory (Phase 0)

Discovered: 2026-11-04, via Dokploy API (`https://dp.mdenizay.com/api`), Cloudflare API, read-only SSH to the host, and the GitHub repository. No secret values are recorded here.

## Host

| Item | Value |
|---|---|
| Server | `51.83.159.253` (single Dokploy host, Docker Swarm + Traefik, SSH `ubuntu@`) |
| CPU / RAM / Disk | 6 vCPU, 11 GiB RAM (~4 GiB available at discovery), 96 GB disk (31 % used) |
| TLS | Traefik + Let's Encrypt (Cloudflare proxy **off** for Retfast hosts) |

Shared, **not Retfast-owned** (never touched): Traefik, `dokploy-network`, Dokploy itself, and the projects `isleworks`, `bananarepublic`, `propilot`, `panda`, `eticaret`, `mdenizay`, `vpn`, `venhall` with all their services/databases.

## Retfast Dokploy project

Project `retfast` — `L0iO24smAUxi7zRbF_7DB`, environment `production` — `VzYrmyDeZ-kl6VjRrai8J`.

| Resource | ID | appName | What it is | Domains | Decision |
|---|---|---|---|---|---|
| compose `v3` | `skccx6prcYZKxqWJxAI0V` | `retfast-v3-t4uios` | Rust API + Next.js web (v3 rewrite), GitHub branch `v3`, autoDeploy off | `retfast.com/` , `retfast.com/api`, `www.retfast.com` | Remove at cut-over (after new stack is healthy) |
| compose `app` | `j3_kgK5OYAzIIoZ4el_y0` | `retfast-app-wafyxq` | Legacy Vite panel, **auto-deploys on push to `main`** | `panel.retfast.com` | Remove now |
| compose `supabase` | `P_DdIbtNhJEjyVJY-4GUH` | `retfast-supabase-6wcnuj` | Self-hosted Supabase (v2 backend, 13 containers) | `supa.retfast.com` | Remove now |
| postgres `postgres` | `nZ8hwGG71eADoAaBInRuY` | `retfast-pg-wfu7mo` | `postgres:17` (no PostGIS), db `retfast`, used by v3 | internal only | Remove at cut-over |
| redis `redis` | `2KmHY28GB_sv4kxti3Pcy` | `retfast-redis-qws5ak` | `redis:7-alpine`, used by v3 | internal only | Remove at cut-over |

### Volumes on the host (`docker volume ls | grep retfast`)

| Volume | Owner | Decision |
|---|---|---|
| `retfast-pg-wfu7mo-data` | Dokploy postgres `postgres` (v3) | Removed with the service |
| `retfast-redis-qws5ak-data` | Dokploy redis `redis` (v3) | Removed with the service |
| `retfast-supabase-6wcnuj_db-config`, `retfast-supabase-6wcnuj_deno-cache` | compose `supabase` | Removed with the compose (`deleteVolumes: true`) |
| `retfast-db-ztih0y-data` | **orphan** — no Dokploy service references it (earlier deleted Retfast DB) | Remove (name-prefixed `retfast-`, unattached) |
| `retfast-redis-fhe65e-data` | **orphan** — earlier deleted Retfast Redis | Remove |

Networks `retfast-app-wafyxq_default`, `retfast-supabase-6wcnuj_default`, `retfast-v3-t4uios_default` are compose-default networks; Dokploy removes them with their compose.

### Backups

- No Dokploy backup destinations exist (`destination.all` → `[]`). No database backups were ever scheduled despite earlier docs mentioning R2.
- The user explicitly authorized discarding all old Retfast application data (clean install). No data backup is taken.

### Environment variable names (values not recorded)

- `v3`: `DATABASE_URL, REDIS_URL, PUBLIC_WEB_URL, CORS_ORIGINS, RESEND_API_KEY, MAIL_FROM` (`MAIL_FROM` = `Retfast <no-reply@retfast.com>`)
- `app`: `VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_MAP_STYLE_URL`
- `supabase`: standard self-hosted Supabase set (JWT, SMTP, pooler, storage …) — obsolete.

## Integrations

| Integration | Status |
|---|---|
| Dokploy API token | Valid (shared operator token, stored outside the repo) |
| Cloudflare API token | Valid; reads/writes zone `retfast.com` (`bb0ee4b48ed320022eafaed8f10cd28a`) |
| GitHub → Dokploy provider | `githubId 9FBJ7psyELk8EAQOQV5Z9` (reused for the new compose) |
| Resend (`RESEND_API_KEY` in v3) | **Invalid** — Resend API answers `API key is invalid`. A new key is required; the app runs with email delivery disabled (logged, observable) until one is set. |
| Apple (TestFlight, team) | Configured previously in `v3` (`ExportOptions.plist`); bundle `com.mizibu.retfast` |

## Cloudflare DNS — zone `retfast.com`

| Record | Type | Content | Proxy | Decision |
|---|---|---|---|---|
| `retfast.com` | A | 51.83.159.253 | off | Keep → new web |
| `www.retfast.com` | CNAME | retfast.com | off | Keep → new web |
| `api.retfast.com` | A | 51.83.159.253 | off | Keep → new API (+WebSocket) |
| `app.retfast.com` | — | — | — | **Create** A → 51.83.159.253, proxy off |
| `panel.retfast.com` | A | 51.83.159.253 | off | Delete (legacy panel) |
| `supa.retfast.com` | A | 51.83.159.253 | on | Delete (legacy Supabase) |
| `retfast.com` | MX ×2 | mx01/mx02.mail.icloud.com | — | **Keep** (iCloud mail) |
| `retfast.com` | TXT | `v=spf1 include:icloud.com ~all` | — | **Keep** |
| `retfast.com` | TXT | `apple-domain=…` | — | **Keep** (Apple verification) |
| `sig1._domainkey` | CNAME | iCloud DKIM | — | **Keep** |
| `resend._domainkey` | TXT | Resend DKIM | — | **Keep** |
| `send.retfast.com` | MX / TXT | Amazon SES feedback / SPF (Resend) | — | **Keep** |
| `links.retfast.com` | CNAME | links1.resend-dns.com | — | **Keep** (Resend click tracking) |

No DMARC record exists. Recommendation (not applied, mail-policy decision for the owner): `_dmarc TXT "v=DMARC1; p=none; rua=mailto:deniz@retfast.com"`.

Proxy stays **off** on Retfast hosts: TLS is issued by Traefik/Let's Encrypt via HTTP-01, and WebSockets go straight to Traefik. If the proxy is enabled later, set SSL mode "Full (strict)"; Cloudflare supports WebSockets but closes idle ones after ~100 s, which the 25 s server heartbeat covers.

## GitHub repository `mdenizay/retfast`

| Ref | Content |
|---|---|
| `main` | v2 (Supabase + Vite + native iOS/Android). Was auto-deployed by compose `app`. |
| `legacy/v2-supabase`, tag `v2-final` | v2 archive |
| `v3`, tag `v3-final` (added 2026-11-04) | v3 archive (Rust/Next.js/Expo) |
| `rebuild` (new) | This rebuild (Go/React/SwiftUI). Merged into `main` only after `app` is removed. |

## Deletion plan (authorized by the owner on 2026-11-04: clean install of Retfast-owned resources)

1. Now: `compose.delete` `j3_kgK5OYAzIIoZ4el_y0` (`app`) and `P_DdIbtNhJEjyVJY-4GUH` (`supabase`) with `deleteVolumes: true`; delete DNS `panel` and `supa`; remove orphan volumes `retfast-db-ztih0y-data`, `retfast-redis-fhe65e-data`.
2. Cut-over (after the new stack is deployed and healthy on internal checks): `compose.delete` `skccx6prcYZKxqWJxAI0V` (`v3`), `postgres.remove` `nZ8hwGG71eADoAaBInRuY`, `redis.remove` `2KmHY28GB_sv4kxti3Pcy`; then attach `retfast.com`, `www`, `app`, `api` domains to the new compose.

Rollback: old code is preserved in git (`v2-final`, `v3-final`); a v3 redeploy is possible from tag `v3-final` with a fresh database. Old data is intentionally not recoverable.

## Execution log

See the bottom of `docs/infrastructure/deployment-verification.md`.
