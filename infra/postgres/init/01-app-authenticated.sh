#!/usr/bin/env bash
# Local/dev only: create the tenant login role before migrations run.
# Migrations create it NOLOGIN if absent; production roles are provisioned by ops.
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE app_authenticated LOGIN NOBYPASSRLS PASSWORD '${APP_AUTHENTICATED_PASSWORD}';
SQL
