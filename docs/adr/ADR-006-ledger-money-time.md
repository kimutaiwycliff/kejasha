# ADR-006 — Double-entry ledger, bigint cents, Africa/Nairobi business dates

- Status: Accepted · 2026-10-16

## Decision
- Money: `bigint` minor units in DB and core; JSON as integer cents with a `currency` field
  (default `KES`). No floats anywhere; formatting only at the UI edge.
- Ledger: `ledger_entry` (header, `idempotency_key` UNIQUE) + `ledger_posting` (signed amounts).
  A deferred constraint trigger rejects any entry whose postings do not sum to zero.
  Entries are append-only (no UPDATE/DELETE grants); corrections are reversing entries.
- Accounts: tenant receivable, deposit liability, guest receivable, income by type, mgmt fee, etc.
- Balances are derived (views / queries), never stored columns.
- Payment application: oldest open invoice first, overpayment → tenant credit.
- Time: `timestamptz` storage; business dates (billing day, due dates, report groupings, MRI month)
  computed in `Africa/Nairobi` via `date-fns-tz` / `AT TIME ZONE`.

## Consequences
+ Arrears, statements and tax summaries are reproducible from one source.
− More tables and posting logic than a simple `balance` column — worth it.
