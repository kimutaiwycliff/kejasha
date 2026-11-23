#!/usr/bin/env bash
# Maestro flows against the local API (make up && make dev-api) on a running emulator with the
# dev build installed (./gradlew :app:installDevDebug). Reads OTPs from the dev database, like the
# web e2e suite: DATABASE_URL overrides the local default.
set -euo pipefail
cd "$(dirname "$0")"
DB="${DATABASE_URL:-postgresql://app_owner:secret@localhost:5432/kejasha}"
latest_otp() { psql "$DB" -At -c "SELECT split_part(value, ':', 1) FROM verification WHERE identifier = '$1' ORDER BY created_at DESC LIMIT 1"; }

# Sign-in by OTP with a fresh number.
local_number="07$(printf '%08d' $(( (RANDOM * 32768 + RANDOM) % 100000000 )))"
e164="+254${local_number:1}"
maestro test -e PHONE="$local_number" sign-in-otp-request.yaml
maestro test -e OTP="$(latest_otp "$e164")" sign-in-otp-verify.yaml
