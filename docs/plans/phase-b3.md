# Phase B3 — Payments & reconciliation

> Status: **IN PROGRESS** · drafted 2026-10-21 · ADR-006, ADR-008, ADR-009, ADR-014, ADR-015, ADR-016
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
- [ ] Migration: `payment_channel`, `payment`, `payment_callback`, `stk_request`, `statement_import`;
      ledger kind `collections`; RLS + fixtures
- [ ] Envelope encryption helper + tests; `DARAJA_CALLBACK_IPS`, credentials config
- [ ] `packages/integrations/daraja`: OAuth (cached), C2B register, STK push, STK query, payload
      parsers; fake client for tests
### B3.2 Channels & Daraja
- [ ] Channels CRUD, set credentials (write-only), register C2B URLs, go-live checklist
- [ ] Callback routes: C2B validation/confirmation, STK result — raw-logged, idempotent
- [ ] STK request create/status; worker reconcile job; `make daraja-reregister`
### B3.3 Matching & allocation
- [ ] Matching engine (account → phone → suggestions); payments list/detail; suggestions
- [ ] Allocate / unallocate / ignore; manual payment entry (cash, bank)
- [ ] Receipts: number, SMS, PDF
### B3.4 Statement import & SMS
- [ ] CSV (M-Pesa business portal) and PDF (personal statement, password) parsers with fixtures
- [ ] Import endpoint (file from `/v1/uploads`), dedupe, summary; SMS-text parse endpoint
### B3.5 Proof
- [ ] Integration tests; RLS fixtures for every new table
- [ ] Journeys: C2B → matched → receipt; same callback ×3 → one payment; statement of 20 rows →
      auto-matched + queued → manual allocate; STK success and failure paths
- [ ] Spec + client regenerated; spec lint + authenticated Schemathesis green

## Screens this phase must power (ADR-018)
Payment channels setup & go-live checklist · payments list · unmatched queue with suggestions ·
statement upload & review · receipt view · "request payment" (STK) action.

## Definition of Done
Sandbox-shaped payment → matched → receipt; duplicate callbacks are no-ops; ledger balances to
zero; unmatched queue works end to end; CI green.
