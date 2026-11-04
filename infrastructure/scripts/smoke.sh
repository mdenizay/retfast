#!/usr/bin/env bash
# Post-deploy smoke checks against real endpoints. Usage: smoke.sh [api_url] [web_url]
set -euo pipefail
API="${1:-https://api.retfast.com}"; WEB="${2:-https://retfast.com}"; fail=0
check() { local name="$1" url="$2" want="$3"; local code; code=$(curl -s -o /tmp/smoke.$$ -w '%{http_code}' -m 15 "$url" || echo 000)
  if [ "$code" = "$want" ]; then echo "ok   $name ($code)"; else echo "FAIL $name: got $code want $want"; fail=1; fi; }
for i in $(seq 1 18); do curl -fsS -m 5 "$API/api/v1/health/ready" >/dev/null 2>&1 && break; sleep 5; done
check "api live"   "$API/api/v1/health/live" 200
check "api ready"  "$API/api/v1/health/ready" 200
check "events"     "$API/api/v1/events" 200
check "me (no auth -> 401)" "$API/api/v1/me" 401
check "web root"   "$WEB/" 200
check "web healthz" "$WEB/healthz" 200
check "web deep link (SPA fallback)" "$WEB/events/cameli-paragliding-demo" 200
rm -f /tmp/smoke.$$; exit $fail
