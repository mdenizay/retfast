# Deployment Verification

Production: compose `retfast` (`WPu39mM2BL_nnlxBudRa5`) on Dokploy `dp.mdenizay.com`, host 51.83.159.253.
Only results that were actually observed are recorded. "Pending" means not yet verified.

## Status after the retrieval pivot (ADR-012)

The checks below were run on the pre-pivot build (2026-11-04/05). The production database will be reset and re-seeded with the pivot build; checks marked † must be re-run after that deploy.

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Public website routing (`retfast.com`, `www`) | ✅ 2026-11-05 | HTTP 200 after cut-over; SPA deep link `/events/cameli-paragliding-demo` 200 |
| 2 | Dashboard routing (`app.retfast.com`) | ✅ | HTTP 200 |
| 3 | API health | ✅ | `/api/v1/health/live` 200, `/health/ready` 200 `{"postgres":"ok","redis":"ok"}` |
| 4 | Database connectivity | ✅ | ready check + `migrate up` applied `0001_init` (121 ms) † |
| 5 | Redis connectivity | ✅ | ready check † |
| 6 | Account creation / seed | ✅ † | `seed`: users 5 (created 5), events 1, launch_sites 1, memberships 5 |
| 7 | First-login password change | ✅ † | `deniz@retfast.com` login → `must_change_password: true`; afterwards `must_change_password = false` in the DB for deniz and tecelli (changed by the users) |
| 8 | Event creation and participation | Pending (pivot) | |
| 9 | Simulated telemetry ingestion | Pending on production | verified locally (backend-results.md) |
| 10 | WebSocket live delivery | Pending on production | verified locally |
| 11 | Email delivery | ❌ not configured | Resend key from the old deployment is invalid; `RESEND_API_KEY` empty → emails recorded as `failed: provider_unconfigured` |
| 12 | iOS API connectivity | Pending | TestFlight 4.0.0 (build 202611042343) installed on the owner's iPhone; a successful app login against `https://api.retfast.com` has not been observed directly yet |
| 13 | DNS | ✅ | `retfast.com` A, `www` CNAME, `api` A, `app` A (created) → 51.83.159.253, proxy off; mail records untouched |
| 14 | HTTPS certificates | ✅ | Let's Encrypt; `retfast.com`/`www` valid to 2027-01-05, `app` to 2027-02-02 |
| 15 | Persistence after restart | Pending on production | verified locally (graceful restart test) |
| 16 | Backup | ✅ partial | daily `pg_dump` sidecar running; restore drill pending; no off-site destination |

## Known operational behaviour

- During a redeploy, Traefik returns 404 for ~30 s until the new containers report healthy (observed 2026-11-05). Acceptable for now; zero-downtime would need rolling updates.

## Execution log

- 2026-11-04 — Deleted legacy composes `app` (`j3_kgK5OYAzIIoZ4el_y0`) and `supabase` (`P_DdIbtNhJEjyVJY-4GUH`) with volumes; deleted DNS `panel`, `supa`; removed orphan volumes `retfast-db-ztih0y-data`, `retfast-redis-fhe65e-data`. Tagged `v3-final`.
- 2026-11-04 — Created `retfast-postgres` (postgis/postgis:17-3.5, `ad0Ar4ebO-0YndYKTysDG`), `retfast-redis` (`fHKay9M35ra1Oar6y7ALb`), compose `retfast`; domains `api`, `app`; DNS `app` A record. First deploy failed (compose command duplicated the entrypoint) — fixed in `d95edf0`, second deploy healthy. Seeded.
- 2026-11-05 — Cut-over: deleted compose `v3` (`skccx6prcYZKxqWJxAI0V`), postgres `nZ8hwGG71eADoAaBInRuY`, redis `2KmHY28GB_sv4kxti3Pcy` and their volumes (`retfast-pg-wfu7mo-data`, `retfast-redis-qws5ak-data`, verified unattached); attached `retfast.com` and `www.retfast.com` to `retfast/web`.
