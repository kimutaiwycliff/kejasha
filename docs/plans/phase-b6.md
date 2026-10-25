# Phase B6 — Sync API, tenant portal, SaaS billing, operator

> Status: **IN PROGRESS** · drafted 2026-10-25 · ADR-004, ADR-008, ADR-014, ADR-017
> Convention: `[ ]` todo · `[~]` in progress · `[x]` done & verified · `[!]` blocked (reason)
> Shipped as two PRs: **B6a** (sync + tenant portal) and **B6b** (billing + operator).

## Goal
The Android app can work offline and sync safely; tenants see their leases, invoices and receipts
and pay by STK; Kejasha bills its own customers through Paystack and suspends non-payers without
ever blocking their reads; platform staff can support orgs through an audited operator API.

## Key decisions
### Sync (ADR-017)
- **Pull** `GET /v1/sync/pull?cursor=` returns `{ changes: { <table>: { upserted[], deleted[] } },
  cursor, reset }` for: properties, units, meters, meter_readings, tickets, ticket_updates,
  cash_collections (+ tenants-lite and leases-lite for owners/managers only; caretakers never
  see tenants or leases).
  - Scoped by RLS **and** role: caretakers get assigned properties only, and only their own
    cash collections.
  - "Deleted" = archived (soft delete). Tables that lack `updated_at` gain one with a touch
    trigger.
  - **Cursor** = opaque base64 `{v, t, s}`: `t` is a watermark 5 s behind the server clock when
    the pull ran (rows written by still-open transactions are re-sent, never missed; duplicates
    are harmless because clients upsert by id). `s` is a hash of the caller's role + assigned
    properties: if it changes, the response has `reset: true` and a full snapshot, so lost
    access is never left on the device.
- **Push** `POST /v1/sync/push` with an `Idempotency-Key` and up to 200 operations
  `{ id (client UUIDv7), type, data }`:
  - Types: `meter_reading.create`, `ticket.create`, `ticket_update.create`,
    `cash_collection.create`.
  - Each operation runs in its own transaction through the same services as HTTP (no second
    code path). The result per record is `applied | duplicate | rejected{code, message}`.
  - A record whose id already exists is `duplicate`, which is what makes a replay apply once.
  - Conflicts follow the services: an update to a closed ticket → `rejected{ticket_finished}`;
    cash stays a proposal.
- Services accept the client-generated id where sync creates records (readings, tickets,
  updates, cash).

### Tenant portal
- A tenant signs in with **phone OTP** (Better Auth user, no org membership). The portal finds
  their `tenant` records by the user's **verified** phone across orgs (indexed lookup with the
  owner role), then reads each org's data inside that org's tenant transaction.
- `auth: 'user'` routes under `/v1/portal/*`:
  - Read: my leases (landlord name, unit, balance), a lease statement (invoices, payments),
    receipt PDFs, my tickets.
  - Write: pay a lease by STK (the landlord's channel, to the tenant's own phone) and report a
    ticket (`reporterKind: tenant`, with photos).
  - A tenant never sees another tenant's data; leases on cancelled tenancies are hidden.

### SaaS billing (`subscriptions` module; Kejasha's own revenue, never rent — ADR-008)
- `plan` table (operator-editable data, not code), seeded with **placeholder prices for the
  owner to confirm in B7**:
  - free: up to 3 units;
  - landlord: per occupied long-term unit;
  - host: per short-stay listing;
  - agency: flat fee + per unit, white-label included.
- `subscription` per org: `trialing → active → past_due → suspended` (or `cancelled`), with a
  30-day trial from org creation and monthly periods.
- `subscription_invoice` holds the amount computed at period end from usage (occupied units,
  listings), using the core `subscriptions` pricing.
- **Paystack:** checkout via `transaction/initialize`; the webhook (`charge.success`) is verified
  by HMAC-SHA512 of the raw body and is idempotent by reference. Saved card authorizations are
  charged automatically at renewal (`charge_authorization`); otherwise a pay link is emailed.
  `packages/integrations/paystack` + a fake client in tests.
- **Dunning** (daily job): invoice at period end, retry / remind on days 1, 3 and 7, then
  `suspended` after a 7-day grace period.
- **Gate plugin:** a suspended org's writes answer **402** `subscription_suspended`, except
  billing, identity and sign-out routes. Reads always work. The plan's unit limit is checked
  when units are created (402 `plan_limit`).

### Operator (platform staff)
- `platform_operator` (user ids) granted by a CLI (`make operator-grant EMAIL=…`). It is not an
  org role.
- `/v1/operator/*` routes (`auth: 'operator'`):
  - orgs list/detail (kind, plan, status, unit counts);
  - subscription actions (extend trial, comp, suspend/reactivate);
  - plan prices;
  - audit log per org.
- Every operator request is written to `audit_log` (`actor_kind = operator`), reads included.
  Cross-tenant reads happen only here.

## Tasks
### B6a — Sync & tenant portal
- [x] Migration: `updated_at` (+ touch) on meter, meter_reading, maintenance_update, cash_collection; tenant phone index
- [x] Services accept client ids (readings, tickets, updates, cash)
- [x] Sync pull (scoped, cursor, reset) + push (per-record results, duplicates)
- [x] Tenant portal: leases, statement, receipt PDF, pay (STK), tickets
- [x] Tests: replay of 50 readings applies once; closed-ticket conflict rejected; caretaker scope + reset; portal isolation
### B6b — Billing & operator
- [ ] Migration: plan (seeded placeholders), subscription, subscription_invoice, subscription_payment, platform_operator; RLS
- [ ] Core pricing; Paystack client (+ fake); checkout, webhook, renewal/dunning job; gate plugin; plan limits
- [ ] Operator auth mode, CLI grant, orgs/subscriptions/plans/audit endpoints, audited reads
- [ ] Journey: trial → paid → lapsed → suspended (writes blocked, reads allowed) → paid → active
- [ ] Spec + client regenerated; spec lint + Schemathesis green (both PRs)

## Notes (2026-10-25)
- **B6a:**
  - Sync reads only the sync module's own `sync_*` views (security_invoker), like reporting.
  - The pull lag is `SYNC_LAG_SECONDS` (default 10; 0 in tests).
  - The push body has one array per record type, not a polymorphic list, so the generated
    Kotlin client stays simple.
  - Portal tickets have no photos yet (uploads are an org route).

## Screens this phase must power (ADR-018)
Android: caretaker offline shift, owner/host app, tenant pay. Web: billing/plan page, checkout
return, suspended banner, operator console, tenant portal.

## Definition of Done
Push replay applied once; closed-ticket conflict rejected; tenant sees only their own records;
suspension blocks writes but not reads; Paystack webhook verified and idempotent; CI green.
