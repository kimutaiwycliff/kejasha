# ADR-008 — Payments go direct to the landlord's own Paybill/Till; encrypted credentials; no custody

- Status: Accepted · 2026-10-16

## Decision
- Kejasha never receives, holds, splits or pays out rent or booking money. Tenants/guests pay the
  landlord's/host's own shortcode. (Custody would require CBK payment-service-provider licensing.)
- Each `payment_channel` stores the landlord's Daraja consumer key/secret/passkey **envelope-
  encrypted** (per-record data key, wrapped by `CREDENTIALS_MASTER_KEY`). Never returned by any API,
  never logged. Rotation supported.
- C2B: register validation/confirmation URLs per shortcode pointing at
  `/v1/payments/daraja/{channelToken}/confirm` (opaque token, not the org id).
- Account reference = unit code → automatic match; otherwise unmatched queue.
- STK Push initiated against the landlord's shortcode; results confirmed by callback **and**
  Transaction Status query (never trust the client).
- Every callback stored raw, deduped on `provider_ref` UNIQUE, processed idempotently.
- Kejasha subscription fees are billed separately via Paystack.
- Onboarding: assisted go-live (checklist + document pack) since Daraja production approval can take
  days to weeks per shortcode.

## Consequences
+ No licensing burden, no settlement risk.
− Per-landlord onboarding friction; mitigated by ADR-009 for landlords without Paybill/API access.
