# subscriptions module (Kejasha's own billing)

Owns `subscription`, `subscription_invoice` and `subscription_payment` (tenant tables) and reads
`plan` (platform data). This is Kejasha's revenue, never rent (ADR-008).

- **No free use (owner decision 2026-10-25).** New orgs start `incomplete`: setup only, every other
  write answers 402 (`plugins/billing-gate.ts`). Reads always work. Trials exist only when an
  operator grants one.
- **Prices** (`plan`): landlord KES 100 per occupied unit (min 500); host KES 500 per listing;
  agency KES 3,000 + KES 70 per occupied unit. Monthly, billed in advance from usage (occupied
  long-term units today, active short-stay listings), using the core `subscriptions` pricing.
- **Paystack:** checkout (`transaction/initialize`, KES); the webhook is verified by HMAC-SHA512 of
  the raw body, stored raw in `paystack_event`, and re-verified with Paystack before applying.
  `applyPayment` is idempotent per Paystack reference and extends the paid period. A reusable card
  authorization is stored envelope-encrypted and charged on renewal.
- **Daily run** (`billing.daily_run`, 06:00): an expired period becomes `past_due` with a new
  invoice. The saved card is charged, or the customer is reminded, on days 0, 1, 3 and 7. After 7
  days the org is `suspended` (read-only) until it pays. Lapsed operator trials return to
  `incomplete`.
- `BILLING_REQUIRED=false` (tests only; refused in production) disables the gate.
