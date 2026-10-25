# compliance module

Owns `mri_filing` and `licence`. Reads leases, invoices, credit notes and deposit settlements
through the leasing module, matched payments through payments, and properties/landlords through
accounts (ADR-001). The maths is pure, in `@kejasha/core` `tax`.

- **MRI** = 7.5% of the rent portion of money received in the month, per landlord (the org's own
  "self" landlord, or each client landlord of an agency). Each received payment (or deposit
  applied to arrears) is applied to the lease's invoices oldest-first; its rent share is
  `applied × rent lines ÷ invoice total`, and any unapplied remainder is advance rent. Commercial
  properties are excluded; mixed are included and flagged. Short-stay income is not MRI.
- The computation runs live on every read. `POST …/filings` snapshots it, and the month view
  shows `differenceCents` if receipts change after filing.
- **Band:** calendar-year rent received to the end of the month vs KES 288,000–15,000,000.
- **Exports:** eRITS-ready CSV per landlord and month (`lib/csv`, formula-safe cells).
- **Licences:** status `valid | expiring (≤30 days) | expired`; DELETE archives.
- **Daily run** (`compliance.daily_run`, 07:00 Nairobi): licence reminders 30/7/1/0 days before
  expiry, and on the 15th an MRI reminder for eligible, unfiled landlords for the previous month.
  Sent to owners and managers by SMS/email through the outbox, deduped per recipient.
