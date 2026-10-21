# ledger module

Owns `ledger_account`, `ledger_entry`, `ledger_posting` and the `ledger_account_balance` view
(ADR-006). It has **no HTTP routes**: clients never write ledger entries; domain modules call
`post` / `reverse` inside their own tenant transaction.

- Signed `bigint` cents: debit +, credit −. `normaliseLines` merges per account and refuses an
  unbalanced entry; the database re-checks at commit (deferred constraint trigger).
- Append-only: no UPDATE/DELETE grants plus a trigger. Corrections are reversing entries
  (`reverses_entry_id`).
- `idempotency_key` is unique per org; replaying an event returns the original entry.
- Accounts: per lease `lease_receivable` (asset) and `lease_deposit` (liability, credit balance =
  money held); per org `income_*` and `deposit_refund_payable`. Created on first use.
- `trialBalance` (Σ all postings) must always be 0 — asserted after every journey.
