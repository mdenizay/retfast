#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup_dir="${deploy_dir}/backups"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "${backup_dir}"
docker compose --env-file "${deploy_dir}/.env" \
  -f "${deploy_dir}/compose.production.yml" \
  exec -T postgres pg_dump \
  -U "$(sed -n 's/^POSTGRES_USER=//p' "${deploy_dir}/.env")" \
  -d "$(sed -n 's/^POSTGRES_DB=//p' "${deploy_dir}/.env")" \
  --format=custom > "${backup_dir}/retfast-${timestamp}.dump"

echo "Backup created: ${backup_dir}/retfast-${timestamp}.dump"
