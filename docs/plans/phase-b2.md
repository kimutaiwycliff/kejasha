# Phase B2 — Leasing & ledger

> Status: **DONE** · DoD green locally and in CI (PR #3, 2026-10-21) · drafted 2026-10-21 · ADR-006, ADR-007, ADR-014, ADR-015
> Convention: `[ ]` todo · `[~]` in progress · `[x]` done & verified · `[!]` blocked (reason)

## Goal
A landlord can register tenants, sign leases on long-term units, attach recurring and metered
charges, and have invoices generated automatically every month — prorated, escalated, late-fee'd
and reminded — with every shilling recorded in an append-only double-entry ledger whose trial
balance is always zero. Arrears and statements are derived from the ledger, never stored.

## Key decisions
- **Ledger (ADR-006):** `ledger_account` / `ledger_entry` / `ledger_posting`. Postings are signed
  `bigint` cents (debit +, credit −). A deferred constraint trigger rejects any entry whose postings
  do not sum to zero (or that has fewer than two). Entries and postings are append-only (no
  UPDATE/DELETE grants + trigger); corrections are reversing entries. `idempotency_key` is unique
  per org, so re-posting the same business event is a no-op. Balances come from a
  `security_invoker` view, so RLS applies to them too.
- **Accounts:** per lease — `lease_receivable` (asset; negative = tenant credit) and
  `lease_deposit` (liability). Per org — `income_*` by charge kind, `deposit_refund_payable`.
  Payments (B3) will credit `lease_receivable` against a cash/clearing account.
- **Only invoices debit a receivable.** Credits (credit notes, deposit applied, payments in B3)
  only credit it. Therefore *outstanding per invoice* is derived: total credits =
  Σ non-void invoices − receivable balance, applied oldest-due-first (FIFO). Arrears aging,
  late fees and reminders all use this one function in `@kejasha/core`.
- **No overlaps (ADR-007):** `lease.during` is a generated `daterange(start_date, end_date, '[]')`
  with `EXCLUDE USING gist (unit_id WITH =, during WITH &&) WHERE (status <> 'cancelled')`.
- **Billing:** calendar-month periods (Africa/Nairobi). Invoice for period P is issued
  `INVOICE_LEAD_DAYS` (5) before its due date (`billing_day`, clamped to month end).
  Rent and flat charges are prorated by occupied days; escalation compounds every N months from
  the latest rent step; metered charges bill consumption since the last billed reading (water
  billed in arrears). The run is idempotent per (lease, period) — partial unique index plus a
  row lock on the lease — and catches up any missed periods.
- **Deposits:** invoiced at lease creation (credit `lease_deposit`, not income). Settlement on
  move-out: deductions → income, applied to arrears → receivable, remainder → refund payable.
  We never hold money (ADR-008): the refund is recorded as payable by the landlord.
- **Time is injected:** `deps.clock.today()` (Nairobi date) so billing, late fees and reminders
  are tested against fixed dates. Services take a `Ctx` (org, user, actor kind) instead of a
  Fastify request, so the worker's daily jobs run the exact same code.
- **Scheduler:** the worker registers BullMQ job schedulers (cron, `tz: Africa/Nairobi`):
  `invoicing.daily_run` (00:15) → per org: billing run, late fees, reminders. Reminders are SMS via
  the outbox with dedupe keys `reminder:<invoice>:<stage>` (3 days before, on due, 3/7/14 overdue).
- **Photos:** presigned S3 PUT uploads (`POST /v1/uploads`), keys scoped `org/<orgId>/…`; move-in/out
  inspections store item conditions + photo keys.

## Tasks
### B2.1 Core (pure, ~100% branch coverage)
- [x] Proration, occupied days, period iteration, issue/due dates
- [x] Rent schedule: base + steps + compounding escalation
- [x] Metered consumption in milli-units (no floats), amount rounding
- [x] FIFO allocation of credits, aging buckets, late-fee amount
### B2.2 Ledger module
- [x] Migration (accounts, entries, postings, balance view, triggers, RLS + fixtures)
- [x] `post` (idempotent), `reverse`, balances, lease statement with running balance, trial balance
### B2.3 Leasing schema & CRUD
- [x] Tenants (KRA PIN, national ID, phone, next of kin) — list/create/get/update/archive
- [x] Leases with exclusion constraint; create (deposit invoice + catch-up billing), get detail,
      update terms, rent change, renew (extend), terminate (final proration + credits/voids), cancel
- [x] Charge rules (flat / metered); meters + readings (monotonic; caretaker can record; bulk)
### B2.4 Invoicing
- [x] Invoice + lines + per-org numbering; billing run per lease/org; `POST /v1/billing/run`
- [x] Late fees (idempotent per invoice); manual invoices; void (reversing entry); credit notes
- [x] Invoices list/detail with derived outstanding; lease statement; arrears aging
### B2.5 Deposits, inspections, reminders, scheduler
- [x] Deposit settlement; move-in/out inspections with photo uploads
- [x] Reminder stages via outbox; worker job schedulers; daily run for all orgs
- [x] Lease expiry & escalation calendar endpoint
### B2.6 Proof
- [x] Integration tests per area; RLS fixtures for every new table
- [x] Journeys: mid-month lease → prorated invoice → monthly run twice (no dupes) → late fee →
      arrears aging; overlapping lease refused by the DB; trial balance = 0 after everything
- [x] Spec + client regenerated; spec lint + authenticated Schemathesis green

## Notes (2026-10-21)
- **Invoices are issued on the day they are produced** (`asOf`); only the due date comes from the
  terms. Back-dating a catch-up invoice to its theoretical issue date produced documents dated
  before the lease existed.
- **Escalation vs rent steps:** a step landing before the next computed escalation restarts the
  cycle (found by the calendar test; `nextEscalationPeriod` fixed + regression tests).
- **Years 0–99:** `Date.UTC` maps them to 19xx; core date helpers now use `setUTCFullYear`
  (found by Schemathesis as a 500 on `/v1/lease-calendar`).
- **Business-date window:** dates outside 1900–2199 → 422 `date_out_of_range`, enforced once by a
  pre-handler and documented on every route with a body/query (keeps billing from iterating over
  centuries; keeps the schema simple enough for clients and fuzzers).
- **Slowloris:** Node enforces `requestTimeout` only every `connectionsCheckingInterval` (30 s
  default) — the server is now created with a 2 s check; a stalled body gets 408 at ~15 s.
- **Contract timing:** Schemathesis `max_response_time` = 20 s (above the 15 s cut-off). One full
  run reported 35–68 s client-side timings that never appear server-side (max 99 ms over 3,636
  fuzzed requests on rerun) — treated as transport artefacts; watch CI.
- **Tests:** integration and journey files run one at a time against their shared Postgres
  (timeouts under parallel load were contention, not failures).
- **Object storage (ADR-019):** MinIO images are no longer published; production moves to
  Cloudflare R2, dev/CI/tests to SeaweedFS. Switching exposed a real bug: the AWS SDK's default
  flexible checksums made every presigned upload fail (checksum of an empty body). Fixed with
  `requestChecksumCalculation: 'WHEN_REQUIRED'`; a real upload/download round trip now runs in CI.
- **Module boundaries:** leasing reads units/properties only through `accounts` lookups;
  the worker runs the API's own services via `@kejasha/api/jobs` with a system `Ctx`.

## Screens this phase must power (ADR-018)
Tenants list/detail · lease create/renew/terminate · unit/lease statement · invoices list/detail ·
arrears aging · meter reading entry (incl. caretaker) · lease-expiry & escalation calendar.

## Definition of Done
Ledger balances to zero after every journey; invoicing idempotent; arrears correct against a
hand-computed fixture; double leases impossible; CI green.
