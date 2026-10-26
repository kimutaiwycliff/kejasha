#!/usr/bin/env bash
# Deploy a CI-built image tag to the production VM (ADR-013). Usage: make deploy [TAG=<sha>]
# Needs: DEPLOY_HOST (ssh target, e.g. deploy@203.0.113.10), optional DEPLOY_PATH (/opt/kejasha).
# Images ghcr.io/$IMAGE_OWNER/kejasha-{api,worker,docs}:$TAG are published by CI on main.
set -euo pipefail
: "${DEPLOY_HOST:?set DEPLOY_HOST (ssh target)}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/kejasha}"
TAG="${TAG:-$(git rev-parse HEAD)}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

if [ "$TAG" = "$(git rev-parse HEAD)" ] && [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is dirty; commit (and let CI publish) before deploying." >&2
  exit 1
fi

echo "→ syncing infra to $DEPLOY_HOST:$DEPLOY_PATH"
ssh "$DEPLOY_HOST" "mkdir -p '$DEPLOY_PATH'"
rsync -az --delete "$ROOT/infra/migrations/" "$DEPLOY_HOST:$DEPLOY_PATH/migrations/"
rsync -az --delete "$ROOT/infra/postgres/" "$DEPLOY_HOST:$DEPLOY_PATH/postgres/"
rsync -az "$ROOT/infra/compose.prod.yml" "$ROOT/infra/Caddyfile" "$DEPLOY_HOST:$DEPLOY_PATH/"

echo "→ deploying $TAG"
ssh "$DEPLOY_HOST" bash -s -- "$DEPLOY_PATH" "$TAG" <<'REMOTE'
set -euo pipefail
cd "$1"; TAG="$2"; export TAG
test -f .env || { echo ".env missing in $1 (see DEPLOYMENT.md)" >&2; exit 1; }
dc() { docker compose -f compose.prod.yml "$@"; }
dc pull api worker docs
dc up -d postgres redis
dc run --rm migrate
dc up -d --remove-orphans
for i in $(seq 1 30); do
  if dc exec -T api wget -q -O /dev/null http://127.0.0.1:4000/v1/health; then
    echo "$TAG" >> .deployed-tags
    echo "✓ $TAG is live"; exit 0
  fi
  sleep 2
done
echo "✗ health check failed for $TAG — run make rollback" >&2; exit 1
REMOTE
