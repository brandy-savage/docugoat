#!/usr/bin/env bash
# Build the web app for GitHub Pages and publish web/dist to the gh-pages branch.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=$(basename "$(git rev-parse --show-toplevel)")
REMOTE=${REMOTE:-origin}
OWNER=$(gh repo view --json owner -q .owner.login 2>/dev/null || git remote get-url "$REMOTE" | sed -E 's#.*[:/]([^/]+)/[^/]+(\.git)?$#\1#')
BACKEND=${BACKEND:-github}
DATA_REPO=${DATA_REPO:-docugoat-data}
echo "building with VITE_BASE=/$REPO/ VITE_BACKEND=$BACKEND VITE_GH_OWNER=$OWNER VITE_GH_DATA_REPO=$DATA_REPO VITE_RELAY_URL=${RELAY_URL:-<unset>}"
VITE_BASE="/$REPO/" VITE_BACKEND="$BACKEND" VITE_GH_OWNER="$OWNER" VITE_GH_DATA_REPO="$DATA_REPO" VITE_RELAY_URL="${RELAY_URL:-}" npm run build --workspace web
cp web/dist/index.html web/dist/404.html
touch web/dist/.nojekyll
WT=$(mktemp -d)
git worktree add --detach "$WT" >/dev/null
TMPBRANCH="gh-pages-build-$$"
( cd "$WT" && git checkout --orphan "$TMPBRANCH" && git rm -rfq . && cp -r "$OLDPWD/web/dist/." . && git add -A \
  && git -c user.name="docugoat deploy" -c user.email="deploy@docugoat.local" commit -qm "Deploy $(git -C "$OLDPWD" rev-parse --short HEAD) to GitHub Pages" \
  && git push -f "$REMOTE" "$TMPBRANCH:gh-pages" )
git worktree remove --force "$WT"
git branch -D "$TMPBRANCH" >/dev/null 2>&1 || true
echo "published gh-pages"
