# Kejasha — Master Claude Code Reference

> Single source of truth for Claude Code in this repo.
> Author: Wycliff Kimutai · October 2026
> Stack freeze: October 2026 — open an ADR in `docs/adr/` before changing any pinned choice.

---

## 1. What You Are Building

**Kejasha** is a multi-tenant property-management SaaS for Kenya: long-term rental management,
rent collection, and short-stay (Airbnb-style) unit management — one account for every kind of
property a Kenyan owner, agency, or host runs.

It is **API-first**: one well-documented, well-tested backend (`apps/api`) serves every client —
the Next.js web app and the native Kotlin Android app (ADR-017). No client talks to the database directly.

**Target customers (all three at launch, one shared engine):**
1. **Independent landlords** — self-serve, free tier for a few units.
2. **Agencies / property managers** — multi-user, manage many client landlords, management fees,
   white-label statements. Highest-leverage channel (one agency → many landlords).
3. **Short-stay hosts** — calendar, bookings, and true per-unit profit.

**Why customers switch (positioning):**
- Payments reconcile themselves (Paybill account = unit code) — no more fake M-Pesa screenshots.
- Works for landlords **without** a Paybill (Till / personal number) via statement import + SMS match.
- KRA Monthly Rental Income (7.5%) computed every month, tenant PINs held, eRITS-ready summary.
- Long-term and short-stay units in one portfolio, with true profit per unit.
- Offline caretaker app: meter readings, maintenance with photos, cash logged.
- Diaspora-friendly owner dashboards and monthly PDF statements.

---

## 2. Non-Negotiable Constraints

Every PR must respect these. If you cannot, open an ADR first.

1. **API-first, contract-first.** Every route's request/response is a Zod schema; OpenAPI 3.1 is
   generated from those schemas; clients use the generated typed client. Spec drift fails CI. (ADR-002)
2. **Postgres RLS, deny by default.** Tenant data is only touched inside `withTenant()` which sets
   `SET LOCAL app.org_id` and `SET LOCAL ROLE app_authenticated`. Every tenant table ships with a
   cross-tenant denial test. `make test-rls` must be green to merge. (ADR-003)
3. **Money is `bigint` minor units (cents) everywhere** — DB, core, API (as integer). Never floats.
   Format only at the UI edge. (ADR-006)
4. **Business dates and groupings use `Africa/Nairobi`.** Timestamps stored as `timestamptz`.
5. **The ledger is append-only double-entry.** Balances are derived, never stored. Clients never
   write ledger entries; only domain services do. (ADR-006)
6. **No overlaps, enforced by the database.** Leases and short-stay bookings on the same unit cannot
   overlap — Postgres exclusion constraints, not app checks. (ADR-007)
7. **We never hold tenant money.** Rent and booking payments go directly to the landlord's/host's own
   Paybill/Till. Kejasha only reconciles. Per-landlord Daraja credentials are envelope-encrypted and
   never returned by any API. (ADR-008)
8. **Every write endpoint accepts an `Idempotency-Key`.** Every webhook/callback/job is safe to re-run.
9. **No channel-manager / OTA partner APIs in v1.** Short-stay = calendar + bookings + profit +
   read-only iCal import. (ADR-010)
10. **Modules are bounded contexts.** No importing another module's internals or tables. (ADR-001)
11. **Stack is fixed (§3).** Deviations require a numbered ADR.
12. **The domain is configuration, never code.** Production domain is `kejasha.co.ke`, but no file
    outside `.env*` / deploy config may contain it. Every URL, cookie domain, CORS origin, email
    sender, Caddy site and Daraja callback is derived from `APP_DOMAIN`. A test fails CI if the
    literal domain appears in source. (ADR-016)

---

## 3. Stack (Fixed)

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node 22 LTS, TypeScript `strict` | |
| Monorepo | pnpm workspaces + Turborepo | |
| API framework | **Fastify 5** + `fastify-type-provider-zod` | Modular monolith (ADR-001) |
| API docs | `@fastify/swagger` → OpenAPI 3.1, **Scalar** UI at `/docs` | Redocly lint + oasdiff in CI |
| API client | `openapi-typescript` + `openapi-fetch` (`packages/api-client`); Kotlin via openapi-generator | Generated, never hand-written |
| Validation | Zod (shared in `packages/contracts`) | Same schemas power web forms |
| Database | PostgreSQL 17 (+ `btree_gist`) | RLS, two roles |
| ORM | Drizzle ORM | SQL-first |
| Migrations | dbmate (raw SQL) | Hand-written RLS policies, constraints |
| Auth | Better Auth (organization, bearer, phone-number plugins) | Orgs = tenants (ADR-004) |
| Jobs | BullMQ + Redis (ioredis) + transactional outbox | (ADR-014) |
| Object storage | S3 API: Cloudflare R2 (prod), SeaweedFS (dev/CI) | Leases, photos, statements, backups (ADR-019) |
| PDFs | `@react-pdf/renderer` | Receipts, invoices, owner statements |
| Email | Resend | |
| SMS / WhatsApp | Africa's Talking | Reminders, OTP, receipts (ADR-015) |
| M-Pesa | Daraja: C2B (Paybill/Till), STK Push, Transaction Status | Landlord's own shortcode (ADR-008) |
| SaaS billing | Paystack | Kejasha subscriptions only — never rent |
| Web | Next.js 16 App Router (pure client of the API) + shadcn/ui + Tailwind v4 | ADR-021 |
| Tables / forms | TanStack Table v9, TanStack Query, React Hook Form + Zod | ADR-021 |
| Android | Kotlin + Jetpack Compose, Hilt, Room + WorkManager (offline), Retrofit + kotlinx.serialization; client generated by openapi-generator | (ADR-017) |
| Testing | Vitest, Testcontainers, `app.inject()`, journey tests, Schemathesis, Playwright, JUnit/Maestro | (ADR-012) |
| Observability | pino, OpenTelemetry, GlitchTip (Sentry SDK) | |
| Proxy / hosting | Caddy 2 on a single VM, Docker Compose, Cloudflare | (ADR-013) |
| CI | GitHub Actions | |
| Secrets | Doppler or SOPS + age | Never commit plaintext |

**Do NOT introduce:** NestJS, Prisma, MongoDB, GraphQL, WebSockets, Kubernetes, microservices,
Airbnb/Booking.com partner APIs or channel managers (v1), funds custody / wallets / payouts,
hand-built UI primitives, AI/ML pricing (v1).

---

## 4. Monorepo Layout

```
kejasha/
├─ apps/
│  ├─ api/                    # Fastify API — the product. /v1/*, /docs, /openapi.json
│  ├─ worker/                 # BullMQ workers + cron (invoices, reminders, iCal, reconciliation)
│  ├─ web/                    # Next.js — landlord/agency/host dashboard + tenant portal
│  ├─ docs/                   # Fumadocs (Next.js 16, static) — guides + generated API reference (ADR-020)
│  └─ android/                # Kotlin Android (Gradle) — owner/host, caretaker (offline), tenant
├─ packages/
│  ├─ config/                 # Zod env parsing; all URLs derived from APP_DOMAIN (ADR-016)
│  ├─ contracts/              # Zod schemas = API contract (request/response/error shapes)
│  ├─ api-client/             # Generated from OpenAPI — the ONLY way clients call the API
│  ├─ db/                     # Drizzle schema, withTenant(), RLS helpers, seed, test harness
│  ├─ core/                   # Pure domain logic: money, proration, ledger rules, tax, profit
│  ├─ auth/                   # Better Auth config, requireRole(), session helpers
│  ├─ jobs/                   # Queue definitions, job registry, outbox relay
│  ├─ ui/                     # shadcn design system (primitives → composites → features)
│  └─ integrations/
│     ├─ daraja/              # C2B register/confirm, STK push, transaction status
│     ├─ africastalking/      # SMS + WhatsApp + OTP
│     ├─ paystack/            # SaaS subscription billing
│     ├─ resend/              # Email (React Email templates)
│     ├─ storage/             # S3 client (R2 / SeaweedFS)
│     └─ ical/                # iCal (RFC 5545) fetch + parse, read-only
├─ infra/
│  ├─ compose.yml             # postgres, redis, seaweedfs (S3), caddy, api, worker
│  ├─ compose.ci.yml          # throwaway services for CI
│  ├─ Caddyfile
│  ├─ migrations/             # dbmate SQL (YYYYMMDDHHMMSS_*.sql)
│  └─ backups/                # gitignored
├─ docs/
│  ├─ adr/                    # Architecture decisions (ADR-001 …)
│  └─ plans/                  # Phase plans (phase-0.md …)
├─ Makefile
└─ CLAUDE.md
```

### API module layout (`apps/api/src/modules/<module>/`)
```
routes.ts      # Fastify plugin: routes + Zod schemas from packages/contracts
service.ts     # Use-cases; the only thing other modules may call (via index.ts)
repo.ts        # Drizzle queries — module-private
index.ts       # Public surface of the module
*.test.ts      # Unit + integration tests beside the code
README.md      # What the module owns, its tables, its events
```

**Modules:** `identity` · `accounts` (agency → landlord → property → unit) · `leasing` · `ledger` ·
`payments` · `short-stay` · `maintenance` · `meters` · `compliance` · `notifications` · `reporting` ·
`subscriptions`.

Rules: a module owns its tables; cross-module calls go through the other module's `index.ts`;
no cross-module table joins in write paths (reporting may read via SQL views it owns).

---

## 5. Domain Model (abbreviated — truth lives in migrations)

```sql
-- Tenancy & identity (Better Auth managed: user, session, account, verification,
--   organization, member, invitation)
org_profile          -- kind: landlord | agency | host; KRA PIN; branding (agency white-label)
client_landlord      -- agency-managed owners (agency org → many landlords); mgmt fee %
staff_profile        -- role, phone E.164

-- Portfolio
property             -- name, location, county, owner (org or client_landlord)
unit                 -- code (Paybill account no.), mode: long_term | short_stay, status
                     --   bedrooms, rent_cents / base_nightly_cents

-- Long-term
tenant               -- name, phone E.164, national ID, KRA PIN (eRITS), next of kin
lease                -- unit_id, tenant_id, during daterange, rent_cents, deposit_cents,
                     --   billing_day, escalation; EXCLUDE no overlap per unit
charge_rule          -- recurring: rent, service charge, garbage, water (metered/flat)
meter / meter_reading -- water/electricity readings → metered charges
invoice / invoice_line

-- Ledger (double-entry, append-only)
ledger_account       -- per tenant / booking / org; type
ledger_entry         -- journal header (idempotency_key UNIQUE, source, occurred_at)
ledger_posting       -- entry_id, account_id, amount_cents (signed); SUM per entry = 0

-- Payments (we never custody funds)
payment_channel      -- org's Paybill/Till/phone; type; encrypted Daraja creds (Paybill/Till)
payment              -- channel_id, provider_ref UNIQUE, msisdn, amount_cents, account_ref,
                     --   source: c2b | stk | statement_import | sms | manual; match_status
statement_import     -- uploaded M-Pesa statement + parsed rows

-- Short-stay
rate_plan / rate_override -- base nightly, weekday/season overrides, min stay
booking              -- unit_id, guest_id, stay daterange, source (airbnb|booking|direct|walk_in|
                     --   whatsapp|other), gross_cents, commission_pct, status
                     --   EXCLUDE no overlap per unit (status not cancelled)
calendar_block       -- owner use / maintenance; also in the same exclusion
ical_feed            -- unit_id, url, source, last_synced_at, etag
guest
unit_expense         -- category (tokens, wifi, cleaning, supplies, repair, licence…), amount

-- Operations
maintenance_ticket / maintenance_update (photos)
cash_collection      -- caretaker-logged cash with photo/receipt; must be confirmed by owner

-- Compliance
mri_period           -- month, gross residential rent, 7.5% computed, filed flag
licence              -- TRA short-stay licence per unit, expiry, fee

-- Platform
plan / subscription / subscription_payment
audit_log            -- actor, org, action, entity, diff jsonb
outbox               -- transactional outbox for jobs/events
idempotency_key      -- key, route, request hash, stored response
```

---

## 6. v1 Feature Inventory

### 6.1 Identity & access
- Email + password and **phone + SMS OTP** (tenants, caretakers often lack email).
- Org kinds: landlord, agency, host (an org can hold long-term and short-stay units).
- Roles: `owner` > `manager` > `agent` > `caretaker`; `tenant` is a separate portal identity.
- Invites by email/SMS; password reset; sessions; bearer tokens for mobile.

### 6.2 Portfolio
- Properties → units; unit mode long-term or short-stay; unit code = Paybill account number.
- Agency: client landlords, per-landlord portfolios, management fee %, white-label statements.

### 6.3 Long-term rentals
- Tenants (KRA PIN, ID, phone), leases (start/end, rent, deposit, billing day, escalation).
- Recurring charges: rent, service charge, garbage, water/electricity (metered or flat).
- Monthly invoice generation (idempotent per lease+period), proration on move-in/out.
- Late fees (configurable), arrears aging, payment application oldest-first.
- Reminders via SMS/WhatsApp/email (before due, on due, overdue).
- Deposits held as ledger liability; move-in/move-out checklists with photos; deposit refund calc.
- Lease expiry + rent-escalation calendar.

### 6.4 Payments & reconciliation
- Landlord connects own Paybill/Till (Daraja C2B). Account number = unit code → auto-match.
- STK Push request to tenant/guest against the landlord's shortcode.
- No Paybill? **M-Pesa statement import** (PDF/CSV) and **Android SMS match** (opt-in) → matched.
- Unmatched queue with suggested matches; manual allocation; overpayment → credit.
- Receipts (SMS + PDF) on every confirmed payment.
- Assisted Daraja go-live onboarding (checklist + document pack for the landlord).

### 6.5 Short-stay
- Multi-unit calendar (month + timeline), blocks, min-stay, buffer days.
- Rates: base nightly, weekday/season overrides.
- Bookings (manual or direct), source-tagged; DB-enforced no double-booking.
- **Read-only iCal import** from Airbnb/Booking.com per unit (poll every 15–30 min) → blocks/bookings.
- Guests with repeat recognition; deposit/full payment via STK; check-in/out status; damages.
- Confirmation + check-in instructions via SMS/WhatsApp.
- Profit: gross − commission − cleaning − expenses; occupancy, ADR, RevPAR, net per unit per month;
  channel comparison (what Airbnb really costs vs direct).

### 6.6 Maintenance & caretaker
- Tickets from tenant/caretaker/owner with photos, status, cost → expense.
- Caretaker Android app (offline): meter readings, tickets, cash collected (confirmed by owner).

### 6.7 Compliance
- Monthly Rental Income (7.5% of gross residential rent) computed per landlord per month,
  eligibility band check (KES 288k–15M/yr), due-date reminder (20th), eRITS-ready summary export.
- Tenant KRA PINs stored; TRA short-stay licence tracker with expiry reminders.
- (Fast-follow) eTIMS-compliant receipts; 2% tourism levy once confirmed in force.

### 6.8 Reporting & statements
- Owner statement (monthly PDF): income, expenses, mgmt fee, net — per landlord.
- Rent roll, arrears aging, collections, occupancy; short-stay P&L; CSV on every table.
- Diaspora owner dashboard (read-only owner login).

### 6.9 SaaS billing
- Plans: long-term per occupied unit, short-stay per listing, agency flat + white-label.
- Paystack checkout + webhook; trial; dunning → suspended; operator console.

---

## 7. Build Phases (backend first — ADR-018)

**Rule:** a phase starts only when the previous phase's DoD is green. The backend is built
completely (B0–B7), the contract is frozen (`contract-v1.0`), then Web (W) and Android (A) are
built in parallel. Journey tests through the generated client stand in for screens during B-phases.
Every commit passes `make typecheck lint test`. Full roadmap: `docs/plans/roadmap.md`; detailed
task plans live in `docs/plans/phase-<id>.md`, written before each phase starts.

| Phase | Scope | DoD headline |
|---|---|---|
| B0 Foundations | Monorepo, API skeleton, OpenAPI/Scalar, DB + roles + RLS harness, Testcontainers, outbox + BullMQ, CI, compose, generated client, journey harness | `make up` clean; `/health` + `/docs` live; RLS suite green; contract checks in CI |
| B1 Identity & portfolio | Better Auth (email, phone OTP, orgs, bearer), `/v1/identity/*`, roles, agency→landlord, properties, units | Two orgs isolated; auth journeys green |
| B2 Leasing & ledger | Tenants, leases, charges, meters, invoices, ledger, deposits, late fees, reminders | Ledger balances to zero; idempotent invoicing; arrears correct |
| B3 Payments | Daraja C2B/STK per landlord, auto-match, statement import, SMS parse, unmatched queue, receipts | Sandbox payment → matched → receipt; duplicate callbacks no-op |
| B4 Short-stay | Calendar, rates, bookings, exclusion, iCal import, guests, expenses, profit | Double-booking impossible; iCal sync verified; P&L reconciles |
| B5 Ops & compliance | Maintenance, cash collections, MRI calc, licences, owner statements, reports | Statements reconcile to ledger; MRI matches hand calc |
| B6 Sync, billing, operator | Offline sync API, Paystack plans/dunning, operator API, tenant portal API | Push replay applied once; suspension gate works |
| B7 Hardening | Load test, backups + restore drill, security review, deploy, contract freeze | Restore drill passes; P95 < 500 ms @ 50 users; `contract-v1.0` tagged |
| W Web | Next.js 16 screens for every journey + operator console (ADR-021) | Playwright journeys green |
| A Android | Kotlin app: owner/host, caretaker offline, tenant pay | Offline caretaker shift → sync verified on device |

---

## 8. ADR Index (`docs/adr/`)

| ADR | Decision |
|---|---|
| 001 | TypeScript modular monolith on Fastify 5 |
| 002 | Contract-first API: Zod → OpenAPI 3.1 → generated client |
| 003 | Multi-tenancy via Postgres RLS + `SET LOCAL` + two DB roles |
| 004 | Better Auth: orgs = tenants, phone OTP, bearer tokens for mobile |
| 005 | Account hierarchy: agency → client landlord → property → unit |
| 006 | Double-entry ledger, `bigint` cents, Africa/Nairobi business dates |
| 007 | Overlap prevention with Postgres exclusion constraints |
| 008 | Payments go direct to the landlord's own Paybill/Till; encrypted credentials; no custody |
| 009 | Reconciliation without a Paybill: statement import + SMS match |
| 010 | Short-stay scope: no channel manager; read-only iCal import |
| 011 | ~~Android offline sync with WatermelonDB~~ — superseded by 017 |
| 012 | Testing strategy |
| 013 | Hosting: single VM, Docker Compose, Caddy, Cloudflare |
| 014 | Jobs: BullMQ + Redis with a transactional outbox |
| 015 | Messaging: Africa's Talking SMS/WhatsApp, Resend email |
| 016 | Domain is configuration (`APP_DOMAIN`); domain-change runbook |
| 017 | Android: native Kotlin (Compose, Room, WorkManager); generated Kotlin client; sync protocol |
| 018 | Backend-first sequencing; journey tests; contract freeze before clients |
| 019 | Object storage: Cloudflare R2 in production, SeaweedFS for dev/CI |
| 020 | Documentation site: Fumadocs on Next.js 16 (`apps/docs`), generated API reference |
| 021 | Web app on Next.js 16 and TanStack Table v9 (amends §3) |

---

## 9. Makefile Targets

```makefile
make up / down / restart / logs      # infra/compose.yml lifecycle
make db-migrate / db-rollback / db-seed / db-reset / db-shell / db-dump
make api-spec        # write apps/api/openapi.json from the running schema registry
make client-gen      # regenerate packages/api-client from openapi.json
make test            # unit + integration
make test-unit       # vitest (pure)
make test-int        # vitest + Testcontainers
make test-rls        # RLS isolation suite
make test-contract   # Schemathesis against the API
make test-journeys   # journey scenarios via the generated client
make test-e2e        # Playwright (web)
make typecheck / lint
make build / build-image
make deploy / rollback
make daraja-reregister  # re-register C2B URLs for every channel (after a domain change)
make backup / restore-drill   # dump to the backups bucket / restore newest dump + invariant checks
make load-test       # k6, 50 VUs, P95 < 500 ms (running API + make db-seed)
make operator-grant EMAIL=…   # Kejasha staff console access
make deploy / rollback        # DEPLOY_HOST=…; CI-built SHA images (docs: operations/deployment)
```

---

## 10. Environment Variables

```env
NODE_ENV=development

# Domain — the ONLY place the domain is set (ADR-016). Production: kejasha.co.ke
# URLs below default to https://api.${APP_DOMAIN} / https://app.${APP_DOMAIN} when unset.
APP_DOMAIN=localhost
API_URL=http://localhost:4000          # override; prod derives https://api.${APP_DOMAIN}
WEB_URL=http://localhost:3000          # override; prod derives https://app.${APP_DOMAIN}
# Extra domains still accepted during a domain migration (comma-separated, optional)
LEGACY_DOMAINS=

DATABASE_URL=postgresql://app_owner:secret@localhost:5432/kejasha
DATABASE_AUTHENTICATED_URL=postgresql://app_authenticated:secret@localhost:5432/kejasha
REDIS_URL=redis://localhost:6379

BETTER_AUTH_SECRET=
BETTER_AUTH_URL=                       # derived from API_URL when unset

# Envelope encryption key for per-landlord Daraja credentials (32 bytes base64)
CREDENTIALS_MASTER_KEY=

S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_BUCKET_FILES=kejasha-files
S3_BUCKET_BACKUPS=kejasha-backups

RESEND_API_KEY=
EMAIL_FROM=                            # derived: no-reply@${APP_DOMAIN}

AFRICASTALKING_API_KEY=
AFRICASTALKING_USERNAME=sandbox
AFRICASTALKING_SENDER_ID=
AFRICASTALKING_WHATSAPP_CHANNEL=

# Daraja: platform-level only. Per-landlord keys live encrypted in DB.
# Callback URLs are derived: ${API_URL}/v1/payments/daraja/{channelToken}/...
DARAJA_ENV=sandbox

PAYSTACK_SECRET_KEY=
PAYSTACK_PUBLIC_KEY=
BILLING_REQUIRED=true                  # unpaid orgs cannot write; only tests turn it off (refused in prod)

# Hardening (B7)
TRUST_PROXY=1                          # Cloudflare → Caddy → API (refuses `true` in production)
DARAJA_CALLBACK_IPS=                   # Safaricom callback IPs (required in prod, or DARAJA_ALLOW_ANY_CALLBACK_IP=true)
SYNC_LAG_SECONDS=10
BACKUP_RETENTION_DAYS=30

CRON_SECRET=
GLITCHTIP_DSN=
OTEL_EXPORTER_OTLP_ENDPOINT=
```

---

## 11. Scope Guardrails — Not in v1

- No channel manager, no Airbnb/Booking.com API, no iCal export (fast-follow).
- No holding, splitting, or paying out funds (would require CBK PSP licensing).
- No tenant screening / credit bureau, no e-signature (fast-follow).
- No iOS build, no desktop app.
- No marketplace / listings portal.
- No dynamic pricing or AI.
- No eTIMS or tourism-levy filing until requirements are confirmed and an ADR is written.

---

## 12. How to Work in This Repo

1. Read this file, `docs/plans/roadmap.md` and the current `docs/plans/phase-<id>.md` before any work.
2. Contracts first: add/modify the Zod schema in `packages/contracts`, then the route, then tests,
   then regenerate the client. Never hand-edit `packages/api-client`.
3. Every new tenant table: migration with RLS policy + cross-tenant denial test in the same PR.
4. Every money path: unit tests on `packages/core` + integration test through the ledger.
5. Conventional commits (`feat(leasing): …`). Never commit red. Never weaken a test to pass.
6. Update the phase plan checkboxes as tasks complete; record scope changes as dated notes.
7. The contract is frozen at `contract-v1.0` (`docs/contract.md`): additive changes only; a
   breaking change needs an ADR and an entry in `apps/api/oasdiff-ignore.txt`.
8. When a flow or contract changes, update the guides in `apps/docs/content/docs` (ADR-020).
