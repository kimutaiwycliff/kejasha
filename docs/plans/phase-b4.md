# Phase B4 — Short-stay

> Status: **IN PROGRESS** · drafted 2026-10-21 · ADR-006, ADR-007, ADR-010
> Convention: `[ ]` todo · `[~]` in progress · `[x]` done & verified · `[!]` blocked (reason)

## Goal
A host runs short-stay units next to long-term ones: rates, a multi-unit calendar, bookings from
every channel (direct, walk-in, WhatsApp, Airbnb/Booking.com via read-only iCal), guests,
expenses, and **true profit per unit** — with double-booking made impossible by the database.

## Key decisions
- **One occupancy table (ADR-007):** `unit_occupancy` holds one row per live booking or block,
  maintained by triggers on `booking` and `calendar_block`, with
  `EXCLUDE USING gist (unit_id WITH =, during WITH &&)`. Ranges are half-open
  `[check_in, check_out + buffer_days)`; the check-out day (plus buffer) is free for the next
  arrival. Cancelled / no-show bookings leave the table. Violations → 409 `dates_unavailable`.
- **Rates:** per-unit `rate_plan` (base nightly, optional weekend nightly for Fri/Sat nights,
  min stay, buffer days, cleaning fee, check-in instructions) + dated `rate_override` seasons
  (no overlapping seasons per unit). `quote` prices each night (season > weekend > base).
- **Bookings:** short-stay units only; source `direct | walk_in | whatsapp | airbnb | booking |
  other`; status `confirmed → checked_in → checked_out` or `cancelled` / `no_show`. Amounts:
  `gross_cents` (nights + cleaning), `commission_bps` (OTA fee), `commission_cents` derived.
- **Money (ADR-006):** direct-collection bookings (direct, walk-in, WhatsApp, other) post
  `Dr booking_receivable / Cr income_short_stay` on confirm and are paid through the same
  payments module (allocate / STK to a booking; account number = unit code matches the
  booking covering that date). OTA bookings are paid out by the OTA: they are not receivables;
  their gross and commission feed the P&L only. Cancelling reverses the booking entry.
- **Guests:** repeat recognition by phone (same org) — creating a booking with a known phone
  reuses the guest and reports `isRepeat`.
- **iCal import (ADR-010):** per-unit feeds, polled every 20 minutes by the worker with
  ETag/Last-Modified. Reservation events → bookings (source tagged, amounts 0 until the host fills
  them); "not available" events → blocks. Keyed by feed + UID: changed dates update, vanished
  events are cancelled/removed. Conflicts with existing occupancy are **flagged on the feed, never
  overwritten**.
- **Profit (core, pure):** per unit per month — nights sold, available nights, occupancy %,
  ADR (gross / nights), RevPAR (gross / available nights), commission, cleaning, expenses,
  net. Channel comparison: gross, commission and net per source.
- **Expenses:** `unit_expense` (tokens, wifi, cleaning, supplies, repair, licence, laundry,
  other), optionally linked to a booking.

## Tasks
### B4.1 Core & schema
- [ ] Core: nightly pricing (season > weekend > base), stay validation, profit metrics + tests
- [ ] Migration: rate_plan, rate_override, guest, booking, calendar_block, unit_occupancy (+
      triggers, exclusion), ical_feed, unit_expense; ledger booking accounts; payment/stk booking
      links; RLS + fixtures
### B4.2 Short-stay module
- [ ] Rate plans, seasons, quote; guests; bookings (create, update amounts, confirm / check-in /
      check-out / cancel / no-show); blocks; multi-unit calendar
- [ ] Booking ledger entries; payments allocate/STK/auto-match to bookings; confirmation SMS
- [ ] Expenses; P&L per unit/month; channel comparison
### B4.3 iCal
- [ ] `packages/integrations/ical`: fetch (ETag), RFC 5545 parse (DATE / DATE-TIME, folding)
- [ ] Feed CRUD, sync service (upsert/cancel by UID, conflicts flagged), worker job
### B4.4 Proof
- [ ] Integration tests incl. concurrent double-booking attempts; iCal fixture sync adds/updates/
      removes; P&L reconciles to bookings + expenses; RLS fixtures
- [ ] Journey through the generated client; spec lint + Schemathesis green

## Screens this phase must power (ADR-018)
Multi-unit calendar (month + timeline) · booking create/detail · rates editor · iCal feeds ·
guests · expenses · short-stay P&L dashboard.

## Definition of Done
Double-booking impossible (DB-enforced, proven concurrently); iCal sync verified with fixtures;
P&L reconciles; ledger balances to zero; CI green.
