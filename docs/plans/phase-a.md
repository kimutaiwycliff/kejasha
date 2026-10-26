# Phase A — Android app (Kotlin)

> Status: **IN PROGRESS** · drafted 2026-10-26 · ADR-004, ADR-009, ADR-016, ADR-017, ADR-018
> Convention: `[ ]` todo · `[~]` in progress · `[x]` done & verified · `[!]` blocked (reason)
> Shipped as slices A0–A5, one PR each. The contract is frozen (`contract-v1.1.1`): the app
> adapts to the API; an API gap is an additive change with tests (as with cash by `unitId`).

## Goal
One native Android app for the people who work on their feet: **caretakers** (offline: meter
readings, repairs with photos, cash collected), **owners and hosts** (what needs attention today:
money in, arrears, payments to match, bookings, repairs, cash to confirm, ask a tenant to pay) and
**tenants** (balance, pay by M-Pesa, statement, report a problem). Proven on an emulator by
Maestro flows against the real API.

The web app remains the place for setup and bulk work (portfolio, leases, reports, settings);
the phone app covers the daily loop and works without signal for caretakers.

## Key decisions
- **Project:** `apps/android`, Gradle (Kotlin DSL) with a version catalog, outside Turborepo.
  Modules: `app` (UI, DI, navigation) and `api-client` (generated, never edited).
- **Pinned versions (2026-10-26):**
  - Kotlin 2.4.21; AGP 9.4.1; Gradle 9.8.2; JDK 17 (Homebrew `openjdk@17` locally,
    `actions/setup-java` in CI).
  - Compose BOM 2026.09.00 (Material 3); Activity 1.13.0; Lifecycle 2.11.0; Navigation 2.10.2.
  - Hilt 2.60.1 (KSP 2.3.12); Room 2.8.5; WorkManager 2.12.0; DataStore 1.3.0; CameraX 1.6.2.
  - Retrofit 3.0.0; OkHttp 5.5.1; kotlinx-serialization 1.12.0; Coil 3.6.3.
  - openapi-generator 7.14.0.
  - minSdk 26, targetSdk/compileSdk 36.
- **Generated client:** openapi-generator (`kotlin`, `jvm-retrofit2`, `kotlinx_serialization`)
  from `apps/api/openapi.json` at build time into `api-client`. `*Cents` fields are `Long`. CI
  fails if the spec cannot be generated.
- **Networking:**
  - One OkHttp client with interceptors: bearer token (ADR-004), an `Idempotency-Key` per write
    (one per user action, reused on retry), and problem+json decoding into a typed `ApiError`.
  - The API base URL is a `buildConfigField` per flavour (`dev` → emulator host
    `http://10.0.2.2:4000`, `prod` → `https://api.<APP_DOMAIN>` from Gradle properties). There
    is no domain literal in source (ADR-016). The app confirms the canonical URL with
    `GET /v1/meta/config`.
- **Auth and session:**
  - Phone OTP first (caretakers and tenants), email + password as well.
  - The bearer token is kept in DataStore, encrypted with an Android Keystore key.
  - After sign-in the app reads `/v1/identity/me`:
    - with memberships → the role shell for the active org (switchable);
    - no membership but a tenancy (`/v1/portal/me`) → the tenant shell;
    - otherwise a message pointing to the web app to set up.
- **Shells by role:**
  - **Owner / manager / agent (and hosts):** Today, Money, Stays, Repairs, More.
  - **Caretaker:** Round (meter readings), Repairs, Cash, Sync status.
  - **Viewer:** Today and statements (read-only).
  - **Tenant:** Home (balance, pay), Statement, Repairs.
- **Offline (caretaker, ADR-017 protocol):**
  - Room mirrors the sync tables from `GET /v1/sync/pull`: properties, units, meters,
    readings, tickets, ticket updates, cash collections. The cursor is stored; `reset: true`
    replaces the snapshot.
  - Local writes go to an outbox with client UUIDv7 ids and are pushed in batches
    (`POST /v1/sync/push`, ≤ 200 per call, one `Idempotency-Key` per batch).
  - Per-record results: `applied` and `duplicate` clear the outbox entry; `rejected` moves to a
    dead-letter list the caretaker sees with the reason.
  - WorkManager runs sync on connectivity (and periodically).
  - Photos are taken with CameraX, queued, and uploaded through `POST /v1/uploads` when online
    before the record that references them is pushed.
  - Cash stays a proposal until an owner confirms it (on the web or in the owner shell).
- **SMS (ADR-009):** share-to-app only. The app accepts `text/plain` shares, previews the parsed
  payment and posts `POST /v1/sms-payments`. No `READ_SMS` permission in v1.
- **Money and dates:** cents as `Long`, shown in `Ksh` with the `en-KE` locale; business dates are
  `LocalDate` in Africa/Nairobi. Nothing converts money through floating point.
- **Quality:**
  - ktlint and Android Lint in CI.
  - JUnit + MockK + Turbine for view models.
  - Room in-memory tests for the sync engine, MockWebServer for the API layer, Compose UI
    tests for key screens.
  - Maestro flows on an emulator against the real API for sign-in, a caretaker offline shift,
    owner confirm and tenant pay.
  - Accessibility: content descriptions on icon-only actions, 48 dp touch targets, readable
    contrast.

## Slices
- [ ] **A0 Foundation:**
  - the Gradle project and version catalog;
  - the generated client and networking (bearer, Idempotency-Key, `ApiError`), flavours and
    `meta/config`;
  - the theme, phone OTP and email sign-in, the encrypted token store, the session, org switch
    and role routing;
  - a CI job (generate → lint → unit tests → assemble);
  - Maestro harness and a sign-in flow.
- [ ] **A1 Owner / host:** Today (collected, arrears, payments to match, cash to confirm, today's
  check-ins/outs, open repairs), match a payment (suggestions, apply), confirm/reject cash, request
  M-Pesa payment, bookings (upcoming, check-in/out), repairs (status, notes, photos).
- [ ] **A2 Caretaker offline:** Room schema and sync engine (pull, outbox push, dead letters,
  reset), WorkManager scheduling, meter round, report and update repairs with CameraX photos, log
  cash with a receipt photo, sync status screen.
- [ ] **A3 Tenant:** home with balances across landlords, pay by M-Pesa prompt, statement,
  report a problem and follow repairs.
- [ ] **A4 Share-to-app M-Pesa SMS:** receive shared text, preview, add the payment (owner/agent),
  matched or queued.
- [ ] **A5 Proof & polish:** Maestro flows for every slice on the emulator; Compose UI tests;
  accessibility pass; release build (R8, signing from environment), app docs page.

## Definition of Done
- The app builds in CI from the generated client.
- Unit and Room/sync tests are green.
- On an emulator against the real API, Maestro flows pass for:
  - sign-in by OTP;
  - a caretaker offline shift whose readings, repair and cash sync once when back online;
  - an owner confirming the cash and matching a payment;
  - a tenant paying from the app.
- No hand-written API types and no domain literal.
