#!/usr/bin/env bash
# Compose durumunu ve son deploy'ları gösterir. `--log` en yeni deploy logunun sunucudaki yolunu yazar.
set -euo pipefail
source "$(dirname "$0")/../secrets.local.env"
curl -fsS -H "x-api-key: $DOKPLOY_TOKEN" "$DOKPLOY_URL/api/compose.one?composeId=$COMPOSE_ID" | python3 -c "
import json,sys
c=json.load(sys.stdin); ds=sorted(c.get('deployments') or [], key=lambda d: d.get('createdAt',''), reverse=True)
if '${1:-}'=='--log': print(ds[0]['logPath'] if ds else ''); sys.exit()
print('status:', c.get('composeStatus'))
for d in ds[:5]: print(d.get('status'), d.get('createdAt'), (d.get('title') or '').splitlines()[0][:60])"
