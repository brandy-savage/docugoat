#!/usr/bin/env bash
# Build the web app for GitHub Pages and publish web/dist to the gh-pages branch.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=$(basename "$(git rev-parse --show-toplevel)")
REMOTE=${REMOTE:-origin}
echo "building with VITE_BASE=/$REPO/ VITE_RELAY_URL=${RELAY_URL:-<unset>}"
VITE_BASE="/$REPO/" VITE_RELAY_URL="${RELAY_URL:-}" npm run build --workspace web
cp web/dist/index.html web/dist/404.html
touch web/dist/.nojekyll
WT=$(mktemp -d)
git worktree add --detach "$WT" >/dev/null
( cd "$WT" && git checkout --orphan gh-pages >/dev/null 2>&1 && git rm -rfq . && cp -r "$OLDPWD/web/dist/." . && git add -A \
  && git -c user.name="docugoat deploy" -c user.email="deploy@docugoat.local" commit -qm "Deploy $(git -C "$OLDPWD" rev-parse --short HEAD) to GitHub Pages" \
  && git push -f "$REMOTE" gh-pages:gh-pages )
git worktree remove --force "$WT"
echo "published gh-pages"
