# leasing module

Owns tenants, leases (+ rent steps), charge rules, meters + readings, invoices + lines, credit
notes, deposit settlements, inspections and per-org counters. Posts to the ledger only through
the ledger module (ADR-006); reads units/properties only through the accounts module (ADR-001).

- **Overlap:** `lease_no_overlap` exclusion constraint (ADR-007) → 409 `lease_overlap`.
- **Billing run** (`ops.runDaily`, daily 00:15 Nairobi + `POST /v1/billing/run`): per lease, issue
  every period whose issue date (due − 5 days) has passed; idempotent via row lock + partial
  unique index; prorated rent/flat charges; metered charges in arrears since the last billed
  reading; late fees once per overdue invoice; SMS reminders via the outbox (deduped per stage).
- **Outstanding is derived:** credits = Σ live invoices − receivable balance, applied
  oldest-due-first (`@kejasha/core` billing.allocateCredits). Statements, arrears, invoice status,
  late fees and reminders all use it.
- **Terminate:** months after the end are voided; an already-billed final month is credited down
  to the prorated amount; the deposit is settled separately.
- **Void** only while nothing is applied (else credit note). **Cancel** only with no activity.
- Services take a `Ctx`, not a request, so the worker runs the same code (`systemCtx`).
