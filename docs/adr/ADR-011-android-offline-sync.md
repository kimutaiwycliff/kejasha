# ADR-011 — Android offline sync with WatermelonDB pull/push protocol

- Status: **Superseded by ADR-017** · 2026-10-21 (was Accepted 2026-10-16)

## Decision
- Expo (React Native) app with role-based shells: owner/host, caretaker, tenant.
- Offline data for caretaker/owner: WatermelonDB (SQLite).
- Sync endpoints: `GET /v1/sync/pull?last_pulled_at=` (changes per table since cursor, scoped by
  RLS and role) and `POST /v1/sync/push` (client-generated UUIDs, idempotency keys).
- Server tables used offline carry `updated_at` + soft-delete `deleted_at` for change tracking.
- Conflict rule: server wins for money and ledger; client wins for field data it owns (meter
  readings, ticket notes) unless the record was closed server-side. Rejected pushes go to an
  on-device dead-letter list shown to the user.
- Money-affecting actions from the device (cash collections) are proposals the owner confirms.
- Tenant app is online-first (pay, receipts, tickets).

## Consequences
+ Caretakers work in buildings with poor signal.
− Sync endpoints need their own contract and test suite.
