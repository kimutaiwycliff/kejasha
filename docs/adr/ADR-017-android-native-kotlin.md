# ADR-017 — Android: native Kotlin (supersedes ADR-011)

- Status: Accepted · 2026-10-21
- Supersedes: ADR-011 (Expo + WatermelonDB)

## Context
ADR-011 chose Expo (React Native) + WatermelonDB. The owner prefers native Android: better
offline/background behaviour (WorkManager), first-class CameraX, SMS/notification handling for
ADR-009, and a long-lived Kotlin codebase. The API is contract-first (ADR-002), so the client
language is a free choice as long as the client is generated from `openapi.json`.

## Decision
- **One app** (`apps/android`), role-based shells after login: owner/host, caretaker, tenant.
- **Stack:** Kotlin 2.x, Jetpack Compose + Material 3, Hilt (DI), Room (SQLite) for offline,
  WorkManager for background sync, OkHttp + Retrofit + kotlinx.serialization, Coil (images),
  CameraX (meter/maintenance photos), DataStore + Android Keystore for tokens. Min SDK 26.
- **Generated client:** `openapi-generator` (`kotlin` generator, `jvm-retrofit2` library,
  `kotlinx_serialization`) from `apps/api/openapi.json` into `apps/android/api-client/` during the
  Gradle build. Hand edits forbidden — same rule as the TS client.
- **Contract requirements this imposes on the API (enforced by spec lint in CI):**
  - Every `*Cents` field is `type: integer, format: int64` (Kotlin `Long`).
  - Every operation has a stable `operationId`; request/response bodies use named schemas.
  - Enums are string enums with explicit values.
  - Auth flows the app needs (phone OTP request/verify, email sign-in, sign-out, session, switch
    org) are exposed as **our own contract routes** under `/v1/identity/*` that wrap Better Auth,
    so the generated client covers them. Bearer tokens (ADR-004) on every request.
- **Offline sync protocol (client-agnostic, owned by the API, unchanged in spirit from ADR-011):**
  - `GET /v1/sync/pull?cursor=&tables=` → `{changes: {<table>: {upserted, deleted}}, cursor}`
    scoped by RLS and role. Cursor is an opaque server watermark.
  - `POST /v1/sync/push` with client-generated UUIDv7 ids and an `Idempotency-Key`; per-record
    results (`applied | rejected{reason}`).
  - Synced tables carry `updated_at` and soft-delete `deleted_at`.
  - Conflicts: server wins for money/ledger; client wins for field data it owns (meter readings,
    ticket notes) unless the record was closed server-side. Rejections go to an on-device
    dead-letter list shown to the user.
  - Money-affecting device actions (cash collections) are proposals the owner confirms.
- **Remote config / domain moves (ADR-016):** `API_URL` is a Gradle `buildConfigField` per
  flavour; the app also reads `GET /v1/meta/config` for the canonical API URL.
- **SMS match (ADR-009):** `READ_SMS` is restricted on Google Play. v1 ships the **share-to-app**
  path (user shares an M-Pesa SMS into Kejasha) plus statement import. Auto-read is only pursued
  if a Play policy exception is granted, or as a sideloaded build — decided in a later ADR.
- **Monorepo:** Gradle project inside the pnpm repo; Turborepo does not drive it. Separate CI
  job: generate client → ktlint/detekt → unit tests → assemble.
- **Testing:** JUnit5 + MockK + Turbine, Room in-memory tests for sync, Compose UI tests,
  MockWebServer against recorded API fixtures, Maestro E2E (login, offline caretaker shift,
  tenant pay).

## Consequences
+ Native background sync, camera and SMS handling; no JS bridge.
+ API contract quality is enforced harder (int64, operationIds) — benefits every client.
− No code sharing with web; business rules live in the API, the app only formats.
− Two client toolchains (pnpm + Gradle) in CI.
