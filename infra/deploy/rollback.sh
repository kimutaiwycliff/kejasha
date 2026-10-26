#!/usr/bin/env bash
# Roll back to the previously deployed tag (or TAG=<sha>). Migrations are forward-only: a release
# whose migration must be undone needs a new forward migration instead (DEPLOYMENT.md).
set -euo pipefail
: "${DEPLOY_HOST:?set DEPLOY_HOST (ssh target)}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/kejasha}"
ssh "$DEPLOY_HOST" bash -s -- "$DEPLOY_PATH" "${TAG:-}" <<'REMOTE'
set -euo pipefail
cd "$1"
TAG="${2:-$(tail -n 2 .deployed-tags 2>/dev/null | head -n 1)}"
[ -n "$TAG" ] || { echo "No previous tag recorded in .deployed-tags" >&2; exit 1; }
export TAG
docker compose -f compose.prod.yml up -d --remove-orphans api worker docs
echo "$TAG" >> .deployed-tags
echo "↩ rolled back to $TAG"
REMOTE
