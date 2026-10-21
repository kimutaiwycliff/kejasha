# Phase B1 — Identity & portfolio

> Status: **DONE** · DoD green locally and in CI (PR #2, 2026-10-21) · drafted 2026-10-21 · ADR-004, ADR-005, ADR-016, ADR-017
> Convention: `[ ]` todo · `[~]` in progress · `[x]` done & verified · `[!]` blocked (reason)

## Goal
Anyone can sign up (email or phone OTP), create an organization (landlord / agency / host),
invite staff by email or SMS, and build a portfolio: client landlords → properties → units.
Two orgs are provably isolated; roles and caretaker scoping are enforced.

## Key decisions
- **Better Auth 1.7** with the Drizzle adapter on the **owner pool** (auth tables are platform
  tables: no grants to `app_authenticated`, enforced by the B0 meta-test). Plugins: organization
  (custom roles), phone-number (OTP), bearer. Ids are UUIDs, so `organization.id` = `org_id`.
- **Clients never call Better Auth directly.** Contract routes under `/v1/identity/*` wrap
  `auth.api.*` so the generated TS/Kotlin clients cover auth (ADR-017). The raw handler is not
  mounted publicly in v1. Web gets an HTTP-only cookie; mobile uses the returned bearer token.
- **Phone-only users** get a deterministic placeholder email (`254712345678@phone.invalid`);
  SMS invitations target that address, so Better Auth's invitation acceptance works unchanged.
- **Every route is authenticated by default.** Route config `auth: 'public' | 'user' | 'org'`
  (default `org` = signed in with an active org) and `minRole`. The OpenAPI `security` of each
  operation is derived from that config, so docs cannot drift from enforcement.
- **Roles:** `owner > manager > agent > caretaker` (Better Auth member.role). In B1: owner/manager
  write portfolio and staff; agent reads the whole portfolio; caretaker reads only properties they
  are assigned to (`property_staff`). Only owners change roles or invite owners; the last owner
  cannot be removed or demoted.
- **ADR-005:** every org gets one `self` client landlord at creation; every property belongs to a
  client landlord (`self` by default). Agencies add more.
- **Same-org integrity in the schema:** child tables reference parents with composite FKs
  `(org_id, parent_id) → parent(org_id, id)`, so a row can never point into another org.
- **Unit code** = Paybill account number: uppercase `A–Z 0–9 -`, 1–12 chars (STK AccountReference
  limit), unique per org, normalised on input (`a 101` → `A101`).
- **OTP SMS is sent synchronously** (user is waiting); invitations / password-reset messages go
  through the outbox → `notifications.*` workers. Without provider keys, a console/in-memory
  sender is used (journeys read OTPs from it).
- **IDs:** UUIDv7 generated in `@kejasha/core` for our tables (time-ordered → index locality and
  stable cursors).

## Tasks
### B1.1 Schema
- [x] Migration: Better Auth tables (`user, session, account, verification, organization, member,
      invitation`), snake_case, no tenant grants
- [x] Migration: `org_profile, client_landlord, property, unit, property_staff` + RLS +
      composite FKs + `updated_at` trigger; RLS fixtures for each (fixture `prepare` step)
### B1.2 Auth & request context
- [x] `packages/auth`: Better Auth config, roles/AC, temp email, OTP sender hook
- [x] `packages/integrations/africastalking` (SMS) and `resend` (email) with fake senders
- [x] API auth plugin: actor resolution (cookie or bearer), `auth`/`minRole` route config,
      `req.tenant()`, 401/403 problems, security schemes derived into the spec
- [x] Worker: `notifications.email` / `notifications.sms` handlers
### B1.3 Identity module
- [x] `POST /v1/identity/sign-up/email`, `sign-in/email`, `otp/request`, `otp/verify`, `sign-out`,
      `GET me`, `POST active-org`, `password/forgot`, `password/reset`
- [x] Orgs: `POST /v1/orgs`, `GET/PATCH /v1/org`
- [x] Members: `GET /v1/members`, `PATCH/DELETE /v1/members/{id}`
- [x] Invitations: `POST/GET /v1/invitations`, `DELETE /v1/invitations/{id}`,
      `GET /v1/identity/me/invitations`, `POST /v1/invitations/{id}/accept`
- [x] OTP rate limits (per phone and per IP)
### B1.4 Accounts module
- [x] Client landlords: list/create/get/update/archive (mgmt fee: none | percent bps | flat cents)
- [x] Properties: list (with unit counts) / create / get / update / archive; staff assignment
- [x] Units: list (filter property/mode/status/q, sorted by code) / create / bulk create / get /
      update / archive / code availability (`GET /v1/unit-code-availability`)
- [x] Audit log entry for every mutation
### B1.5 Proof
- [x] Integration tests per module (validation, roles, scoping, uniqueness, archive rules)
- [x] Journeys: landlord onboarding → property → 10 units; agency invites manager + 2 client
      landlords; caretaker OTP sign-in sees only assigned property; org A cannot see org B
- [x] `make db-seed` demo data
- [x] Spec regenerated, lint + Schemathesis green (authenticated operations included)

## Notes (2026-10-21)
- **Org `kind` lives on `organization`** (Better Auth additional field), not `org_profile`: it is
  read when listing a user's memberships across orgs, which must not touch tenant tables.
- **Error semantics:** 400 = request violates the published schema; 422 = valid shape but a
  business rule or state refuses it (fee/price rules, email-xor-phone, archived records, unknown
  cursor); 401 = failed credentials incl. wrong OTP / bad reset token; 409 = duplicates.
  Cross-field rules therefore live in services, not in `.refine()`.
- **Inputs are documented exactly:** no hidden trim/upper-case before validation; patterns are
  case-insensitive where we normalise; text inputs exclude NUL (Postgres cannot store it); ids
  use `guid` so any well-formed UUID the spec allows is accepted.
- **Routes moved** to avoid shadowing by `/{id}` routes: `/v1/identity/me/invitations`,
  `/v1/unit-code-availability`.
- **Hardening found by Schemathesis:** 15 s `requestTimeout` (a truncated body held sockets open
  indefinitely), `__proto__`/`constructor` keys stripped rather than rejected, Postgres encoding
  errors mapped to 400, error bodies documented as `application/problem+json`.
- **`TRUST_PROXY`** replaces blanket `trustProxy: true` (clients could spoof X-Forwarded-For and
  dodge per-IP limits). Production must set the hop count or proxy CIDRs (B7 deploy checklist).
- **Generated TS client:** `--default-non-nullable false`, otherwise fields with server defaults
  (`kind`, `padding`) were *required* in request types. The Kotlin generator gets the same spec.
- **Contract tests** run authenticated (seeded token) via `schemathesis.toml`; `signOut` is
  excluded because fuzzing it revokes the token under test.
- Unit codes stay reserved after archiving (an account number is never re-pointed).

## Screens this phase must power (ADR-018)
Sign-up/onboarding wizard · login (email + phone) · team & invites · org settings ·
client landlords list/detail · properties list/detail · units list/detail.

## Definition of Done
Two orgs isolated (RLS suite + journeys); auth journeys green through the generated client;
caretaker scoping proven; every new table has an RLS fixture; CI green.

## Deferred (noted, not forgotten)
- Email verification enforcement (sending is wired; enforcement before go-live, B7).
- Read-only owner logins for client landlords (ADR-005) → B5 with owner dashboards.
- `staff_profile` table: phone/name live on `user`; per-org staff fields added when needed.
