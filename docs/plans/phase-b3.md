# Phase B3 — Payments & reconciliation

> Status: **DONE** · DoD green locally and in CI (PR #4, 2026-10-21) · drafted 2026-10-21 · ADR-006, ADR-008, ADR-009, ADR-014, ADR-015, ADR-016
> Convention: `[ ]` todo · `[~]` in progress · `[x]` done & verified · `[!]` blocked (reason)

## Goal
Money a tenant sends to the landlord's own Paybill/Till (or personal number) is recorded once,
matched to the right lease automatically when possible, and otherwise lands in an unmatched queue
with suggestions. Every matched payment credits the lease in the ledger and sends a receipt.
Kejasha never holds money (ADR-008).

## Key decisions
- **Payment channels** per org (optionally per client landlord for agencies): `paybill | till |
  phone`. Daraja consumer key/secret/passkey are **envelope-encrypted** (AES-256-GCM data key per
  record, wrapped by `CREDENTIALS_MASTER_KEY`, `key_version` for rotation); never returned, never
  logged — the API only reports `hasCredentials`.
- **Callbacks** hit `/v1/payments/daraja/{channelToken}/…` — an opaque 256-bit token per channel
  (not the org id). Public routes, no Idempotency-Key, optional Safaricom IP allowlist
  (`DARAJA_CALLBACK_IPS`). Every callback body is stored raw before processing; validation always
  accepts (we never bounce a tenant's money).
- **One payment per M-Pesa transaction:** `payment.provider_ref` unique per org — duplicate C2B
  callbacks, re-imported statements and re-shared SMS are no-ops.
- **STK Push** against the landlord's shortcode; a success callback is **confirmed by an STK
  query** before the payment is recorded (ADR-008). Pending requests are reconciled by a worker job.
  Amounts are whole shillings (Daraja limitation).
- **Matching** (in order): account reference = unit code → the lease occupying that unit on the
  payment date (`auto_account`); else the payer's phone uniquely identifies one active tenant
  (`auto_phone`); else **unmatched** with ranked suggestions (phone, exact outstanding amount, name
  tokens). For agency channels scoped to a client landlord, auto-match only within that landlord's
  units. Manual allocate / unallocate (reversing entry) / ignore.
- **Ledger:** matched payment → `Dr collections` (money now in the landlord's channel) / `Cr
  lease_receivable`. Unmatched payments are not in the ledger. Overpayment simply leaves a credit
  (FIFO allocation from B2 handles it).
- **Receipts:** per-org `RCT-…` number on match; SMS receipt via outbox; PDF receipt rendered on
  request with `@react-pdf/renderer` and cached in object storage.
- **Without a Paybill (ADR-009):** M-Pesa statement import (business-portal CSV; personal-statement
  PDF incl. password) and SMS-text parsing (for Android share-to-app, ADR-017), all producing the
  same `payment` rows (`source` differs) and the same matching.
- **Honest limits (recorded, not hidden):** PDF and SMS layouts are parsed from documented formats
  and synthetic fixtures; they must be validated against real Safaricom samples before launch
  (B7 checklist). Daraja is exercised through a fake client with recorded payload shapes; a live
  sandbox smoke test needs sandbox credentials (B7).

## Tasks
### B3.1 Foundations
- [x] Migration: `payment_channel`, `payment`, `payment_callback`, `stk_request`, `statement_import`;
      ledger kind `collections`; RLS + fixtures
- [x] Envelope encryption helper + tests; `DARAJA_CALLBACK_IPS`, credentials config
- [x] `packages/integrations/daraja`: OAuth (cached), C2B register, STK push, STK query, payload
      parsers; fake client for tests
### B3.2 Channels & Daraja
- [x] Channels CRUD, set credentials (write-only), register C2B URLs, go-live checklist
- [x] Callback routes: C2B validation/confirmation, STK result — raw-logged, idempotent
- [x] STK request create/status; worker reconcile job; `make daraja-reregister`
### B3.3 Matching & allocation
- [x] Matching engine (account → phone → suggestions); payments list/detail; suggestions
- [x] Allocate / unallocate / ignore; manual payment entry (cash, bank)
- [x] Receipts: number, SMS, PDF
### B3.4 Statement import & SMS
- [x] CSV (M-Pesa business portal) and PDF (personal statement, password) parsers with fixtures
- [x] Import endpoint (file from `/v1/uploads`), dedupe, summary; SMS-text parse endpoint
### B3.5 Proof
- [x] Integration tests; RLS fixtures for every new table
- [x] Journeys: C2B → matched → receipt; same callback ×3 → one payment; statement of 20 rows →
      auto-matched + queued → manual allocate; STK success and failure paths
- [x] Spec + client regenerated; spec lint + authenticated Schemathesis green

## Notes (2026-10-21)
- **Not yet verified against Safaricom for real** (as planned): Daraja calls run through
  `FakeDarajaClient` with documented payload shapes; statement CSV/PDF and SMS parsers use
  synthetic fixtures; the password-protected PDF path passes the password to pdfjs but has no
  encrypted fixture. All three go on the B7 launch checklist (sandbox smoke test, real samples).
- **STK safety:** a success callback books money only after an STK *query* confirms it. The
  reconcile job marks confirmed-but-callback-less requests `succeeded` without booking anything,
  because the query carries no M-Pesa code — the money arrives via C2B or a statement import and
  matches by account number. This avoids ever counting one payment twice.
- **Callbacks always ACK** once the raw body is stored; processing errors are recorded on
  `payment_callback.outcome` (replay tooling → B7).
- **MSISDN:** newer Daraja versions may mask/hash payer numbers; phone matching then simply does
  not fire and the account-number match (or the queue) applies.
- **Routes:** SMS import lives at `/v1/sms-payments` (a `/v1/payments/sms` path was shadowed by
  `/v1/payments/{id}` — Schemathesis ST204).
- **Contract timing:** the ~36 s client-side timings on garbage binary bodies recurred on two
  operations in one local run (see B2 notes; server-side handling stays < 100 ms). Still watched.
- `lib/numbering` now owns per-org document numbers (INV/CN/RCT).

## Screens this phase must power (ADR-018)
Payment channels setup & go-live checklist · payments list · unmatched queue with suggestions ·
statement upload & review · receipt view · "request payment" (STK) action.

## Definition of Done
Sandbox-shaped payment → matched → receipt; duplicate callbacks are no-ops; ledger balances to
zero; unmatched queue works end to end; CI green.
