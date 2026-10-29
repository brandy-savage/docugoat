#!/usr/bin/env bash
# One-time: put the relay on Cloudflare Workers (free tier) and point the Pages site at it.
# Needs a Cloudflare account; `wrangler login` opens a browser once. Nothing else is ever asked of users.
set -euo pipefail
cd "$(dirname "$0")/../apps/worker"
npx wrangler whoami >/dev/null 2>&1 || npx wrangler login
if grep -q 'replace-after-wrangler-d1-create' wrangler.toml; then
  echo "creating D1 database docugoat…"
  id=$(npx wrangler d1 create docugoat 2>&1 | grep -oE 'database_id = "[^"]+"' | head -1 | cut -d'"' -f2)
  [ -n "$id" ] || { echo "could not read the database id; run: npx wrangler d1 create docugoat"; exit 1; }
  sed -i "s/replace-after-wrangler-d1-create/$id/" wrangler.toml
fi
npx wrangler r2 bucket create docugoat-blobs 2>/dev/null || true
npx wrangler d1 migrations apply docugoat --remote
out=$(npx wrangler deploy 2>&1); echo "$out" | tail -3
url=$(echo "$out" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)
[ -n "$url" ] || { echo "deployed, but could not read the workers.dev URL from the output above"; exit 1; }
echo "$url" > ../../deploy/relay.url
echo "relay live at $url — now run: npm run deploy:pages"
