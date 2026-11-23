#!/usr/bin/env bash
# Maestro flows against the local API on a running emulator with the dev build installed:
#   make up && make db-seed && make dev-api
#   cd apps/android && ./gradlew :app:installDevDebug && maestro/run.sh [flow…]
# OTPs are read from the dev database, like the web e2e suite (DATABASE_URL overrides the default).
set -euo pipefail
cd "$(dirname "$0")"
DB="${DATABASE_URL:-postgresql://app_owner:secret@localhost:5432/kejasha}"
# Uploads go to object storage on the host: the emulator's localhost:9000 reaches it this way.
adb reverse tcp:9000 tcp:9000 >/dev/null

latest_otp() { psql "$DB" -At -c "SELECT split_part(value, ':', 1) FROM verification WHERE identifier = '$1' ORDER BY created_at DESC LIMIT 1"; }

sign_in() {
  local local_number="07$(printf '%08d' $(( (RANDOM * 32768 + RANDOM) % 100000000 )))"
  maestro test -e PHONE="$local_number" sign-in-otp-request.yaml
  maestro test -e OTP="$(latest_otp "+254${local_number:1}")" sign-in-otp-verify.yaml
}

owner() {
  local args=()
  while IFS= read -r line; do args+=(-e "$line"); done < <(node setup.mjs owner)
  maestro test "${args[@]}" owner-money.yaml
}

# A2: invite a new caretaker, join in the app, assign the property, work offline, verify once.
caretaker() {
  local out; out="$(node setup.mjs caretakerInvite)"
  val() { printf '%s\n' "$out" | sed -n "s/^$1=//p"; }
  maestro test -e PHONE="$(val PHONE)" sign-in-otp-request.yaml
  maestro test -e OTP="$(latest_otp "$(val E164)")" caretaker-join.yaml
  node setup.mjs caretakerAssign "$(val E164)" "$(val PROPERTY_ID)" >/dev/null
  local cents=$(( 300000 + RANDOM ))
  maestro test -e UNIT="$(val UNIT)" -e CASH_AMOUNT="$(printf '%d.%02d' $((cents / 100)) $((cents % 100)))" caretaker-shift.yaml
  node setup.mjs caretakerVerify "$(val PROPERTY_ID)" "$(val METER_ID)" "$cents"
}

flows=("${@:-sign_in owner caretaker}")
for f in ${flows[@]}; do "$f"; done
