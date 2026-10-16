# ADR-009 — Reconciliation without a Paybill: statement import + SMS match

- Status: Accepted · 2026-10-16

## Context
Many small landlords collect on a Till or personal M-Pesa number with no Daraja access.

## Decision
- **Statement import:** upload M-Pesa statement (PDF, password-protected supported; or CSV) →
  parsed rows → deduped on transaction code → matched by amount, phone, name, and expected invoices.
  Raw files stored in S3 and deleted after a retention window.
- **SMS match (Android, opt-in):** the owner app reads incoming M-Pesa confirmation SMS
  (explicit consent, filtered to M-Pesa sender) and posts parsed transactions. Play Store SMS
  permission policy must be satisfied — fallback is a share-to-app action on the SMS.
- Matching produces suggestions; low-confidence matches require owner confirmation.
- Same `payment` table and ledger path as Daraja payments (`source` differs).

## Consequences
+ Serves the long tail of landlords competitors ignore.
− Parser maintenance as Safaricom statement formats change; covered by fixture tests.
