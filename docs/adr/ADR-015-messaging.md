# ADR-015 — Messaging: Africa's Talking SMS/WhatsApp, Resend email

- Status: Accepted · 2026-10-16

## Decision
- One `notifications` module: templates (Swahili + English), channel selection per recipient
  preference, queued delivery via the outbox, delivery-status ledger (`notification` table).
- SMS + WhatsApp via Africa's Talking; OTP via AT SMS; email via Resend (React Email).
- SMS cost is metered per org (credits or plan allowance) since AT charges per message.
- Opt-out respected per channel; quiet hours (no reminders 21:00–07:00 Africa/Nairobi).
- Data Protection Act (Kenya) 2019: consent captured for tenant/guest contact data; retention policy
  documented.

## Consequences
+ Proven providers from PharmaTrack.
− Per-message costs must be visible to orgs to avoid margin leakage.
