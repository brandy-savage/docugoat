#!/usr/bin/env bash
# Run the relay with a CORS allow-list and expose it on a public HTTPS URL via a Cloudflare quick tunnel.
# Writes the URL to deploy/relay.url so `npm run deploy:pages` bakes it in as the site's default store.
# Quick tunnels get a new hostname each start; for a permanent address use a named tunnel or a VPS.
set -euo pipefail
cd "$(dirname "$0")/.."
ORIGINS=${ALLOWED_ORIGINS:-https://redcloudinfosec.com,https://brandy-savage.github.io,https://localhost:5183}
pids=$(pgrep -f "[n]ode_modules/.bin/tsx watch src/index.ts" || true); [ -n "$pids" ] && kill $pids && sleep 1
( cd apps/relay && ALLOWED_ORIGINS="$ORIGINS" setsid nohup npx tsx watch src/index.ts > /tmp/docugoat-relay.log 2>&1 < /dev/null & )
pkill -f "[c]loudflared tunnel --url http://localhost:4173" || true
( setsid nohup "${CLOUDFLARED:-$HOME/.local/bin/cloudflared}" tunnel --url http://localhost:4173 --no-autoupdate > /tmp/cloudflared.log 2>&1 < /dev/null & )
for i in $(seq 1 40); do url=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/cloudflared.log | head -1); [ -n "$url" ] && break; sleep 1; done
[ -n "${url:-}" ] || { echo "tunnel did not come up; see /tmp/cloudflared.log"; exit 1; }
echo "$url" > deploy/relay.url
sleep 3; curl -sf --max-time 20 "$url/api/health" >/dev/null && echo "relay public at $url (allowed origins: $ORIGINS)" || echo "tunnel up at $url but the relay is not answering yet"
