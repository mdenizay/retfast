# Deployment

## Topology (production)

```
Cloudflare DNS (proxy off) ──► 51.83.159.253 Traefik (Let's Encrypt)
   retfast.com, www, app ──► compose retfast / web:8080 (nginx, SPA)
   api.retfast.com      ──► compose retfast / api:8080 (REST + WSS /api/v1/realtime)
                               │  dokploy-network (internal)
                               ├─► retfast-postgres-gcezha:5432  (Dokploy postgres, postgis/postgis:17-3.5, no public port)
                               └─► retfast-redis-vmarln:6379     (Dokploy redis, redis:7-alpine, no public port)
   compose retfast also runs: migrate (one-shot, before api), backup (daily pg_dump to a volume)
```

| Dokploy resource | ID | appName |
|---|---|---|
| project `retfast` | `L0iO24smAUxi7zRbF_7DB` | — |
| environment `production` | `VzYrmyDeZ-kl6VjRrai8J` | — |
| compose `retfast` | `WPu39mM2BL_nnlxBudRa5` | `retfast-stack-nioeia` |
| postgres `retfast-postgres` | `ad0Ar4ebO-0YndYKTysDG` | `retfast-postgres-gcezha` |
| redis `retfast-redis` | `fHKay9M35ra1Oar6y7ALb` | `retfast-redis-vmarln` |

Source: GitHub `mdenizay/retfast`, branch `rebuild` (moves to `main` once merged), compose path `./infrastructure/dokploy/docker-compose.yml`, autoDeploy off — deployments are triggered by CI or by `infrastructure/scripts/deploy.sh`.

## Environment variables (compose `retfast`)

| Name | Notes |
|---|---|
| `APP_ENV` | `production` / `staging` |
| `DATABASE_URL` | `postgres://retfast:<pw>@retfast-postgres-gcezha:5432/retfast?sslmode=disable` (internal network only) |
| `REDIS_URL` | `redis://default:<pw>@retfast-redis-vmarln:6379/0` |
| `JWT_SECRET` | ≥ 48 random bytes hex |
| `PUBLIC_WEB_URL`, `APP_WEB_URL`, `CORS_ORIGINS` | public origins |
| `RESEND_API_KEY` | empty until a valid key exists → email disabled (observable as `failed: provider_unconfigured`) |
| `MAIL_FROM` | `Retfast <noreply@retfast.com>` — only after the domain is verified in the Resend account that owns the key |
| `VITE_API_URL` | web build arg, `https://api.retfast.com` |

Secret values live in Dokploy and in the operator's git-ignored `infrastructure/secrets/production.local.env`. Nothing secret is committed.

## Deploy

```sh
set -a; source ~/Works/yuut/infra/secrets.local.env; source infrastructure/secrets/production.local.env; set +a
DOKPLOY_URL=https://dp.mdenizay.com infrastructure/scripts/deploy.sh "$PROD_COMPOSE_ID"
infrastructure/scripts/smoke.sh https://api.retfast.com https://retfast.com
```

CI (`.github/workflows/ci.yml`) runs formatting, vet, sqlc drift, govulncheck, Go tests (with PostGIS + Redis service containers), web typecheck/lint/test/build/audit, token contrast checks and Docker image builds; the `deploy` job runs only when the GitHub environment has `DOKPLOY_URL`/`DOKPLOY_TOKEN` secrets and a `DOKPLOY_COMPOSE_ID` variable (staging for `rebuild`, production for `main` with required reviewers).

## Bootstrap (first deployment only)

```sh
ssh ubuntu@51.83.159.253 'sudo docker exec $(sudo docker ps -qf name=retfast-stack-nioeia-api) retfast-api seed'
```

The seed is idempotent. Seeded accounts must change the bootstrap password at first login, cannot use any other endpoint before that, and the bootstrap password expires after 7 days (ADR-003).

## Migrations

`migrate` runs `retfast-api migrate up` before `api` starts; if it fails, `api` does not start and the previous containers keep serving until Dokploy swaps. Migrations are additive (expand → migrate → contract) so rolling back to the previous image is safe. Down migrations exist for development; never run them against production without a fresh backup.

## Rollback

1. Dokploy → compose `retfast` → Deployments → redeploy the previous commit (or `git revert` + deploy).
2. Schema is not rolled back automatically (additive migrations keep old images working).
3. Data restore: `backup-restore.md`.

## Operations

- Logs: JSON on stdout → Dokploy logs (`Deployments` / `Logs`). Requests carry `X-Request-Id`.
- Metrics: Prometheus format on the internal port `api:9090/metrics` (not routed publicly).
- WebSocket: Traefik passes upgrades natively; the server pings every 25 s.
- Health: `GET https://api.retfast.com/api/v1/health/ready`.
