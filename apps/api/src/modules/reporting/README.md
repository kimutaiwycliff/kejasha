# reporting module

Read-only. Owns the `report_collection_entry` view (`security_invoker`, so RLS applies): the
collections leg of every payment and payment-reversal entry, with unit, property and landlord.
Everything else is read through other modules' `index.ts` (ADR-001).

- **Owner statement** per landlord per month: income = the view's entries in the month (it
  reconciles to the ledger by construction), expenses = the expense register for the landlord's
  properties, management fee = client landlord `percent` of income (never negative) or `flat`,
  net = income − expenses − fee. The fee is computed, not posted: Kejasha never moves the money.
  The PDF is rendered on request (not cached, since late receipts change it) with the org's name
  and `brandColor` (agency white-label).
- **Rent roll** (current rent via the lease schedule, balance from the ledger), **collections**
  (by day/method/source/property, ≤ 1 year), **occupancy** (long-term units let at month end or
  today; short-stay nights from the short-stay P&L), **owner dashboard** (month + 6-month trend).
- **CSV exports** (`/v1/exports/{dataset}`) for every main list, formula-safe (`lib/csv`).
- **Viewers** (read-only owners) reach these routes via `allowViewer`; `ctx.scope` limits them to
  their client landlord, and other landlords answer 404. Viewers may export only rent-roll,
  collections and unit-expenses.
