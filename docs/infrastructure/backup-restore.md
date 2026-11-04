# Backup and Restore

## What exists today

| Layer | Mechanism | Retention | Location |
|---|---|---|---|
| PostgreSQL (all durable data) | `backup` service in the `retfast` compose: `pg_dump --format=custom` daily, verified with `pg_restore --list` | 14 days | Docker volume `retfast-stack-nioeia_retfast-backups` **on the same host** |
| PostgreSQL volume | Dokploy volume of `retfast-postgres` | — | same host |
| Redis | Not backed up on purpose: it only holds caches (latest positions), the realtime stream (≤ ~10 min replay window) and rate-limit counters. All durable state is in PostgreSQL; the outbox re-fills Redis. | — | — |

**Limitation:** an on-host backup does not survive loss of the host. Dokploy has no backup destination configured (`destination.all` was empty at discovery). To get off-site backups, create an S3-compatible destination (e.g. a Cloudflare R2 bucket `retfast-backups` with an S3 access key) in Dokploy → Settings → Destinations, then add a schedule on `retfast-postgres` (Backups → daily `0 3 * * *`, keep 14). This needs credentials the owner has to create; it is tracked in `deployment-verification.md`.

## Listing and verifying backups

```sh
ssh ubuntu@51.83.159.253 'sudo docker run --rm -v retfast-stack-nioeia_retfast-backups:/b alpine ls -lh /b'
ssh ubuntu@51.83.159.253 'sudo docker logs --tail 20 $(sudo docker ps -qf name=retfast-stack-nioeia-backup)'
```

## Restore (full)

1. Stop writers: Dokploy → compose `retfast` → Stop (or `compose.stop`).
2. Pick a dump and restore into the running PostGIS service:
   ```sh
   ssh ubuntu@51.83.159.253
   PG=$(sudo docker ps -qf name=retfast-postgres-gcezha)
   sudo docker run --rm -v retfast-stack-nioeia_retfast-backups:/b alpine cat /b/retfast-<TS>.dump > /tmp/r.dump
   sudo docker cp /tmp/r.dump $PG:/tmp/r.dump
   sudo docker exec $PG sh -c 'dropdb -U retfast --if-exists retfast_restore && createdb -U retfast retfast_restore && pg_restore -U retfast -d retfast_restore --no-owner /tmp/r.dump'
   # inspect retfast_restore; when satisfied swap:
   sudo docker exec $PG psql -U retfast -d postgres -c "ALTER DATABASE retfast RENAME TO retfast_old_$(date +%s)" -c "ALTER DATABASE retfast_restore RENAME TO retfast"
   ```
3. Start the compose again (migrations run first; they are idempotent).
4. Run `infrastructure/scripts/smoke.sh`. Redis needs no restore.

## Restore drill

A restore drill (dump → restore into `retfast_restore` → row counts compared) is part of the deployment verification; results go to `docs/infrastructure/deployment-verification.md`.
