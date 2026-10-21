# Kejasha Roadmap — backend first (ADR-018)

> Drafted 2026-10-21 · supersedes the phase table in CLAUDE.md §7 (now points here).
> Each phase gets its own detailed `phase-<id>.md` (task checklist) written before it starts.
> Rule: a phase starts only when the previous phase's DoD is green. Every commit passes
> `make typecheck lint test`.

```
B0 Foundations ─► B1 Identity & portfolio ─► B2 Leasing & ledger ─► B3 Payments
   ─► B4 Short-stay ─► B5 Ops, compliance, reporting ─► B6 Sync, billing, operator
   ─► B7 Hardening ─► [contract-v1.0 freeze] ─┬─► W  Web (Next.js)
                                              └─► A  Android (Kotlin)
```

Every backend phase's DoD includes: migrations with RLS + cross-tenant denial tests, contract
schemas, integration tests via `app.inject()`, **journey tests via the generated client**, spec
regenerated, Schemathesis green, module README updated.

---

## B0 — Foundations
Detail: `phase-0.md`.
Monorepo, config (`APP_DOMAIN`), compose infra, dbmate + roles + RLS harness, Testcontainers,
Fastify skeleton (problem+json, request id, idempotency, health, OpenAPI, Scalar), contracts +
generated TS client, spec lint (int64 money, operationIds), outbox + BullMQ worker, core
(money/time/phone), CI.
**DoD:** `make up` clean; `/v1/health` green; `/docs` live; RLS suite + meta-test green; outbox
atomicity green; journey harness runs the health journey through the generated client; CI green.

## B1 — Identity & portfolio
Modules: `identity`, `accounts`. ADR-004, ADR-005.
- Better Auth (Drizzle adapter) mounted at `/v1/auth/*`; organization, bearer, phone-number plugins;
  Africa's Talking OTP sender (`packages/integrations/africastalking`, sandbox + fake).
- Contract wrappers `/v1/identity/*`: sign-up (email), sign-in (email), OTP request/verify,
  sign-out, `me` (user, memberships, active org, role), switch active org, invites (email/SMS),
  accept invite, password reset.
- `withTenant()` driven by session's active org; `requireRole()`; `org_profile` (kind, KRA PIN,
  branding), `staff_profile`.
- Accounts: `client_landlord` (agency), `property`, `unit` (code unique per org = Paybill account
  no., mode, status, bedrooms, rent/nightly cents). Unit code generator + validation.
- Audit log writes for every mutation (shared plugin).
- `/v1/meta/config` (canonical API URL, min app version).
- **Screens powered:** sign-up/onboarding wizard, login (email + phone), team & invites, org
  settings, client landlords list/detail, properties list/detail, units list/detail.
- **Journeys:** landlord self-onboards → property → 10 units; agency invites manager, adds 2
  client landlords with portfolios; caretaker signs in by OTP and sees only allowed data; org A
  cannot see org B.

## B2 — Leasing & ledger
Modules: `leasing`, `ledger`, `meters`, `notifications` (reminders part). ADR-006, ADR-007.
- `packages/core`: proration, escalation, late-fee rules, arrears aging, allocation oldest-first.
- Ledger: `ledger_account`, `ledger_entry` (idempotency_key UNIQUE), `ledger_posting`; DB trigger
  enforcing SUM=0 per entry; append-only (no UPDATE/DELETE grants); balances via views.
- Tenants (KRA PIN, national ID, phone, next of kin); leases with `daterange` + EXCLUDE per unit;
  charge rules (rent, service, garbage, water/electricity metered or flat); deposits as liability.
- Meters + readings → metered charges.
- Invoice run: worker cron daily (Nairobi), idempotent per lease+period, invoice + lines + ledger.
- Late fees, credit notes, manual adjustments (owner/manager only), move-in/out checklists with
  photos (S3 presigned uploads — `packages/integrations/storage`), deposit refund calculation.
- Reminders (before due / on due / overdue) via outbox → SMS/WhatsApp/email adapters (Resend).
- **Screens:** tenants list/detail, lease create/renew/terminate, unit ledger/statement, invoices
  list/detail, arrears aging, meter reading entry, lease-expiry & escalation calendar.
- **Journeys:** create lease mid-month → prorated first invoice → monthly run twice (no dupes) →
  late fee → arrears aging correct; overlapping lease rejected by DB; ledger trial balance = 0.

## B3 — Payments & reconciliation
Module: `payments`. ADR-008, ADR-009.
- `payment_channel` (Paybill/Till/phone), envelope-encrypted Daraja creds (`CREDENTIALS_MASTER_KEY`),
  never returned; per-channel opaque `channelToken` in callback URLs.
- Daraja: OAuth token cache, C2B register/validation/confirmation, STK push + callback,
  transaction status query; `make daraja-reregister`.
- Payment ingest: `provider_ref` UNIQUE → duplicate callbacks no-op; auto-match by account ref =
  unit code → active lease → allocate oldest-first → ledger; overpayment → credit.
- Statement import (CSV + password-protected PDF) parser with fixtures; SMS-text parse endpoint
  (for Android share-to-app); match suggestions with confidence; unmatched queue; manual allocation.
- Receipts: PDF (`@react-pdf/renderer`) to S3 + SMS with link.
- Daraja go-live onboarding checklist + document pack endpoint.
- **Screens:** payment channels setup, payments list, unmatched queue + suggestion accept,
  statement upload & review, receipt view, STK "request payment" action.
- **Journeys:** sandbox C2B → matched → receipt; same callback ×3 → one payment; statement with
  20 rows → 18 auto-matched, 2 in queue → manual allocate; STK success and failure paths.

## B4 — Short-stay
Module: `short-stay`. ADR-007, ADR-010.
- Rate plans + overrides (weekday/season), min stay, buffer days; quote endpoint.
- Guests (repeat recognition by phone); bookings with source/commission/status; calendar blocks;
  single EXCLUDE covering bookings (not cancelled) + blocks (+ buffer).
- iCal feeds per unit: worker polls every 15–30 min with ETag, parses RFC 5545
  (`packages/integrations/ical`), upserts blocks/bookings by UID, removes cancelled.
- Booking payments via STK / manual; check-in/out status; damages; confirmation + check-in SMS.
- Unit expenses; profit engine in core: gross − commission − cleaning − expenses; occupancy, ADR,
  RevPAR, net per unit/month; channel comparison.
- **Screens:** multi-unit calendar (month + timeline), booking create/detail, rates editor,
  iCal feeds, guests, expenses, short-stay P&L dashboard.
- **Journeys:** double-booking impossible (concurrent requests); iCal fixture sync adds/removes;
  P&L for a month reconciles to bookings + expenses.

## B5 — Operations, compliance, reporting
Modules: `maintenance`, `compliance`, `reporting` (+ `payments` cash collections).
- Maintenance tickets (tenant/caretaker/owner) with photos, status, cost → unit expense.
- Cash collections logged by caretaker → owner confirm/reject → ledger only on confirm.
- MRI: 7.5% of gross residential rent received per landlord per month, eligibility band
  (KES 288k–15M/yr), due-date reminder (20th), eRITS-ready CSV export; tenant KRA PIN register.
- TRA short-stay licence tracker + expiry reminders.
- Reporting views (owned by `reporting`): rent roll, arrears, collections, occupancy; CSV export on
  every list; owner statement PDF monthly (agency white-label, mgmt fee); diaspora read-only owner role.
- **Screens:** tickets board/detail, cash confirmations, MRI monthly view + export, licences,
  reports hub, owner statements, owner dashboard.
- **Journeys:** owner statement totals = ledger; MRI matches hand-calculated fixture; cash
  proposal → confirm → ledger; ticket with cost → expense in P&L.

## B6 — Sync API, SaaS billing, operator, tenant portal
Modules: `sync`, `subscriptions`. ADR-017.
- Sync pull/push for caretaker/owner offline tables (units, tenants-lite, meters, readings,
  tickets, updates, cash collections); `updated_at`/`deleted_at` on those tables; conflict rules.
- Plans (per occupied unit / per listing / agency flat + white-label), trial, Paystack checkout +
  webhook (signature verified, idempotent), dunning → suspended; plan-limit gate plugin.
- Operator API (platform staff role; any cross-tenant read goes through audited `dbAdmin`
  endpoints): orgs, subscriptions, support views.
- Tenant portal API: my leases, invoices, receipts, pay (STK), tickets.
- **Journeys:** offline batch of 50 readings pushed twice → applied once; conflict on closed
  ticket → rejected; trial → paid → lapsed → suspended (writes blocked, reads allowed).

## B7 — Hardening & launch readiness
- Load test (k6): P95 < 500 ms @ 50 concurrent users on a prod-like VM.
- Backups: nightly `pg_dump` + WAL to S3, MinIO replication; **restore drill** scripted and passed.
- Security review: OWASP ASVS L2 checklist, rate limits on auth/OTP/webhooks, secrets via SOPS,
  dependency audit, RLS fuzz, Daraja/Paystack signature checks.
- Deploy: Caddyfile (`{$APP_DOMAIN}`), `make deploy/rollback`, GlitchTip + OTel dashboards,
  `DEPLOYMENT.md` with the domain-change runbook.
- **Freeze:** tag `contract-v1.0`; oasdiff becomes a breaking-change blocker.

---

## W — Web (Next.js 15, after freeze)
App shell + auth → portfolio → leasing/ledger → payments → short-stay calendar → ops/compliance →
reports/statements → billing + operator console → tenant portal. Playwright per journey (mirrors
the API journeys). Uses `packages/api-client` + TanStack Query, shadcn/ui, Tailwind v4.

## A — Android (Kotlin, after freeze; ADR-017)
Gradle project + generated Kotlin client → auth (OTP) → owner/host → caretaker offline
(Room + WorkManager sync, CameraX) → tenant pay/tickets → share-to-app M-Pesa SMS → Maestro E2E
on device. Runs in parallel with W.
