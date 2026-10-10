#!/usr/bin/env bash
# Dokploy compose deploy tetikler ve bitene kadar bekler. Kimlikler infra/secrets.local.env içinde.
set -euo pipefail
source "$(dirname "$0")/../secrets.local.env"
api() { curl -fsS -H "x-api-key: $DOKPLOY_TOKEN" -H "Content-Type: application/json" "$@"; }
api -X POST "$DOKPLOY_URL/api/compose.deploy" -d "{\"composeId\":\"$COMPOSE_ID\"}" >/dev/null
echo "deploy triggered"
sleep 5
for _ in $(seq 1 120); do
  status=$(api "$DOKPLOY_URL/api/compose.one?composeId=$COMPOSE_ID" | python3 -c "
import json,sys
c=json.load(sys.stdin); ds=sorted(c.get('deployments') or [], key=lambda d: d.get('createdAt',''))
print(ds[-1]['status'] if ds else 'none')")
  case "$status" in
    done) echo "deploy done"; exit 0 ;;
    error) echo "deploy FAILED — log: ssh ubuntu@$SERVER_IP \"sudo tail -80 \$(infra/scripts/status.sh --log)\""; exit 1 ;;
  esac
  sleep 10
done
echo "timed out waiting for deploy"; exit 1
