# Phase B5 — Operations, compliance, reporting

> Status: **IN PROGRESS** · drafted 2026-10-21 · ADR-005, ADR-006, ADR-008, ADR-014, ADR-015
> Convention: `[ ]` todo · `[~]` in progress · `[x]` done & verified · `[!]` blocked (reason)

## Goal
Run the day-to-day: maintenance tickets with photos and costs, caretaker cash that only counts
once an owner confirms it, KRA Monthly Rental Income computed every month and exported, TRA
licences tracked, and owner statements and reports that reconcile to the ledger. Diaspora owners
can read their portfolio without being able to change anything.

## Key decisions
- **Maintenance (`maintenance` module):** `maintenance_ticket` (unit or property, reporter kind
  `staff | caretaker | tenant`, category, priority, status `open → in_progress → resolved →
  closed`, or `cancelled`, assignee, cost) and `maintenance_update` (note, status change, photo
  upload keys). Caretakers see and update tickets on their assigned properties only. When a ticket
  with a cost is resolved, it records **one** `unit_expense` (category `repair`, linked by
  `maintenance_ticket_id`, unique), so repairs show in the short-stay P&L and owner statements.
  Tenant-reported tickets arrive with the tenant portal (B6). The API already accepts
  `reporterKind = tenant` for staff entering a tenant's report.
- **Unit expense register:** `unit_expense` (B4) becomes the single register for every unit
  (long-term too). It stays owned by `short-stay`, which exposes `recordUnitExpense` through its
  `index.ts`.
- **Cash collections (`payments`):** a caretaker logs `cash_collection` (amount, lease or
  booking, received on, receipt/photo upload key, note), status `pending`. An owner or manager
  confirms it, which records a `payment` (`source = manual`, `method = cash`) allocated to the
  target, so the ledger and receipt follow the B3 path. Rejecting it records a reason. Nothing
  touches the ledger before confirmation. Caretakers see only their own submissions.
- **MRI (`compliance` module, pure maths in `packages/core/tax.ts`):** 7.5% of the **rent
  portion of money received** in the month, per landlord. The landlord is the org for its own
  properties, or each client landlord for an agency.
  - Payments (and deposits applied to arrears at settlement) are applied to the lease's live
    invoices oldest-first. The rent share of each application is
    `applied × rent lines ÷ invoice total` (deposit, service charge, utilities and late fees
    excluded). Any unapplied remainder counts as rent received in advance.
  - Each received shilling is attributed once, to the month it was received.
  - Residential and mixed properties count (mixed are flagged for review); commercial does not.
    Short-stay income is not MRI.
  - Eligibility band from the calendar year's residential rent received: below KES 288,000 →
    `below_threshold`; KES 288,000–15,000,000 → `eligible`; above → `above_threshold` (normal
    income tax).
  - Due on the 20th of the following month.
  - `mri_filing` snapshots the computed figures when the landlord marks a month filed (with the
    KRA payment reference). Later changes to the computation then show as a difference.
  - eRITS-ready CSV export: per tenant PIN, name, unit, rent received, tax.
  - Tenant KRA PIN register: which tenants are missing a PIN.
- **Licences (`compliance`):** `licence` per unit or property (kind `tra_short_stay |
  county_business_permit | other`), number, issued/expiry dates, fee, document key. A daily
  compliance job queues reminders (deduped) 30, 7 and 1 day(s) before expiry and on expiry day,
  plus the MRI reminder on the 15th. Reminders go to owners and managers by SMS and email via the
  outbox.
- **Reporting (`reporting` module):** read-only; it reads other modules' data only through SQL
  views it owns (`WITH (security_invoker = true)`, so RLS still applies) or other modules'
  `index.ts`.
  - **Rent roll** (per long-term unit: tenant, rent, lease dates, balance, occupied/vacant).
  - **Collections** (per day, channel, method and source in a date range).
  - **Occupancy** (long-term occupied units; short-stay occupied nights).
  - Arrears stays in leasing (`getArrears`).
  - **CSV exports:** `GET /v1/exports/{dataset}` (`text/csv`) for rent roll, arrears,
    collections, payments, tenants, bookings, unit expenses, tickets and MRI.
- **Owner statements (`reporting`):** per landlord per month.
  - Income is the ledger's payment entries (net of reversals) on the landlord's units in the
    month, so the statement reconciles to the ledger by construction.
  - Expenses come from `unit_expense`.
  - The management fee (client landlord `percent` of income or `flat`) is computed, not posted:
    Kejasha never moves the money (ADR-008).
  - Net = income − expenses − fee.
  - The PDF (`@react-pdf/renderer`, cached in storage) carries the agency's branding (name, logo
    colour) for client landlords.
- **Viewer role (diaspora owner):** a fifth org role, `viewer`, below caretaker.
  - Viewers may call **only** routes marked `allowViewer`: owner dashboard, statements, reports
    and exports. Everything else is 403 `viewer_read_only`, enforced centrally in the auth plugin
    (deny by default).
  - In an agency org a viewer must be scoped to one client landlord (`member_scope`) and sees only
    that landlord's figures. Without a scope they are refused (`viewer_scope_required`).
  - In a landlord or host org an unscoped viewer sees the whole org.

## Tasks
### B5.1 Schema & core
- [ ] Migration: maintenance_ticket, maintenance_update, cash_collection, mri_filing, licence,
      member_scope; unit_expense.maintenance_ticket_id; reporting views; RLS + fixtures
- [ ] Core `tax`: MRI rent attribution, 7.5%, band, due date + tests (hand-calculated fixtures)
### B5.2 Maintenance & cash
- [ ] Tickets CRUD + updates with photos, caretaker scoping, cost → unit expense
- [ ] Cash collections: submit (caretaker), list, confirm (→ payment + allocation), reject
### B5.3 Compliance
- [ ] MRI monthly view per landlord, year band, mark filed (snapshot), eRITS CSV, PIN register
- [ ] Licences CRUD; daily compliance job (licence + MRI reminders)
### B5.4 Reporting & statements
- [ ] Rent roll, collections, occupancy; CSV exports
- [ ] Owner statement JSON + PDF (white-label); owner dashboard
- [ ] Viewer role: auth gate, member scope, scoped reporting
### B5.5 Proof
- [ ] Integration tests per module; RLS fixtures for every new table
- [ ] Journeys: owner statement totals = ledger; MRI matches a hand-calculated fixture; cash
      proposal → confirm → ledger; ticket with cost → expense in P&L; viewer sees only their
      landlord and cannot write
- [ ] Spec + client regenerated; spec lint + Schemathesis green

## Screens this phase must power (ADR-018)
Tickets board/detail · cash confirmations · MRI monthly view + export · licences · reports hub ·
owner statements · owner dashboard.

## Definition of Done
Statements reconcile to the ledger; MRI matches the hand calculation; cash reaches the ledger
only on confirmation; viewers cannot write; CI green.
