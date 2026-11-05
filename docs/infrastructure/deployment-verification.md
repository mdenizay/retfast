# Deployment Verification

Production: compose `retfast` (`WPu39mM2BL_nnlxBudRa5`) on Dokploy `dp.mdenizay.com`, host 51.83.159.253.
Only results that were actually observed are recorded. "Pending" means not yet verified.

## Status — retrieval build (`19f2efd`), 2026-11-05

Production database and Redis were reset (owner-authorized, test data only), the retrieval build deployed, then verified with `infrastructure/scripts/verify-flow.mjs` using throwaway `qa-*@example.com` accounts (the admin one promoted via SQL). Afterwards the database and Redis were reset again and re-seeded, so production holds only the bootstrap data.

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Public website routing (`retfast.com`, `www`) | ✅ | 200; SPA deep link 200; JS served as `application/javascript`, MapLibre worker `.mjs` as `text/javascript` |
| 2 | Dashboard routing (`app.retfast.com`) | ✅ | 200 |
| 3 | API health | ✅ | `/health/live` 200, `/health/ready` 200 (postgres ok, redis ok) |
| 4 | Database connectivity + migration | ✅ | `migrate up`: 1 migration applied on an empty database |
| 5 | Redis connectivity | ✅ | ready check; realtime delivery below |
| 6 | User account creation | ✅ | 5 registrations → 201 with `roles: []` |
| 7 | First-login password change | ✅ (pre-pivot build, unchanged code path) | bootstrap login → `must_change_password: true`; re-verify on the iOS 4.1.0 / web after the clean seed |
| 8 | Event creation and participation | ✅ | non-admin create → 403; admin create 201; organizer assignment; 4 role-less applications 201; approve without role → 422; approve as pilot/observer/retriever ×2 → 200 |
| 9 | Simulated telemetry ingestion | ✅ | 30 samples accepted; same samples re-sent → 30 `duplicate`, 0 accepted |
| 10 | WebSocket live delivery | ✅ | observer received `position`, `retriever_position`, `retrieval` (incl. delivered) over `wss://api.retfast.com` |
| 10a | Role visibility | ✅ | observer snapshot contains the pilot; retriever gets no general pilots; guest gets 401 with `public_live_map` off; open request hides pilot phone; accepting retriever sees phone; other retriever 404 and no `pilot_position` |
| 10b | Retrieval workflow | ✅ | request 201, idempotent re-create 200, concurrent accept 200/409, pilot position share, picked up → delivered, accept after delivery 409, report includes retrievals |
| 11 | Email delivery | ❌ not configured | no valid `RESEND_API_KEY` |
| 12 | iOS API connectivity | Pending | 4.1.0 uploaded to TestFlight; awaiting owner test on device |
| 13 | DNS | ✅ | `retfast.com` A, `www` CNAME, `api` A, `app` A → 51.83.159.253, proxy off; mail records untouched |
| 14 | HTTPS certificates | ✅ | Let's Encrypt; `retfast.com`/`www` valid to 2027-01-05, `app` to 2027-02-02 |
| 15 | Persistence after restart | Pending on production | verified locally (graceful restart integration test) |
| 16 | Backup | ✅ partial | daily `pg_dump` sidecar; restore drill pending; no off-site destination |

Final state after reset + seed: users 5, events 1, flights 0, retrievals 0; smoke checks 7/7.

## Known operational behaviour

- During a redeploy, Traefik returns 404 for ~30 s until the new containers report healthy (observed 2026-11-05). Acceptable for now; zero-downtime would need rolling updates.

## Execution log

- 2026-11-04 — Deleted legacy composes `app` (`j3_kgK5OYAzIIoZ4el_y0`) and `supabase` (`P_DdIbtNhJEjyVJY-4GUH`) with volumes; deleted DNS `panel`, `supa`; removed orphan volumes `retfast-db-ztih0y-data`, `retfast-redis-fhe65e-data`. Tagged `v3-final`.
- 2026-11-04 — Created `retfast-postgres` (postgis/postgis:17-3.5, `ad0Ar4ebO-0YndYKTysDG`), `retfast-redis` (`fHKay9M35ra1Oar6y7ALb`), compose `retfast`; domains `api`, `app`; DNS `app` A record. First deploy failed (compose command duplicated the entrypoint) — fixed in `d95edf0`, second deploy healthy. Seeded.
- 2026-11-05 — Cut-over: deleted compose `v3` (`skccx6prcYZKxqWJxAI0V`), postgres `nZ8hwGG71eADoAaBInRuY`, redis `2KmHY28GB_sv4kxti3Pcy` and their volumes (`retfast-pg-wfu7mo-data`, `retfast-redis-qws5ak-data`, verified unattached); attached `retfast.com` and `www.retfast.com` to `retfast/web`.
- 2026-11-05 — Hot-fix: `.mjs` MIME type in nginx (map worker blocked). Two failed deploys caused by unfinished agent files slipping into commits; history corrected without touching the working tree (`93969f4`, `e8b867b`).
- 2026-11-05 — Retrieval pivot: production DB + Redis reset, deployed `19f2efd`, seeded, verified 37/37 with `verify-flow.mjs`, reset + re-seeded to the clean bootstrap state.
