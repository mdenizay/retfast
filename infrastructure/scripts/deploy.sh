#!/usr/bin/env bash
# Trigger a Dokploy compose deployment and wait for its real outcome.
# Usage: DOKPLOY_URL=https://dp.mdenizay.com DOKPLOY_TOKEN=... deploy.sh <composeId> [title]
set -euo pipefail
COMPOSE_ID="${1:?composeId required}"; TITLE="${2:-deploy $(git rev-parse --short HEAD 2>/dev/null || echo manual)}"
B="${DOKPLOY_URL:-https://dp.mdenizay.com}/api"; H="x-api-key: ${DOKPLOY_TOKEN:?DOKPLOY_TOKEN required}"
latest() { curl -fsS -H "$H" "$B/deployment.allByCompose?composeId=$COMPOSE_ID" | python3 -c 'import json,sys;d=sorted(json.load(sys.stdin),key=lambda x:x["createdAt"]);print((d[-1]["deploymentId"]+" "+d[-1]["status"]) if d else "none none")'; }
before=$(latest | cut -d" " -f1)
curl -fsS -o /dev/null -H "$H" -H 'content-type: application/json' -X POST "$B/compose.deploy" \
  -d "$(python3 -c 'import json,sys;print(json.dumps({"composeId":sys.argv[1],"title":sys.argv[2]}))' "$COMPOSE_ID" "$TITLE")"
echo "deployment triggered for $COMPOSE_ID"
for i in $(seq 1 120); do
  sleep 10; read -r id status < <(latest)
  [ "$id" = "$before" ] && { echo "waiting for deployment to register…"; continue; }
  echo "deployment $id: $status"
  case "$status" in done) exit 0;; error) echo "deployment failed — see Dokploy logs" >&2; exit 1;; esac
done
echo "timed out waiting for deployment" >&2; exit 1
