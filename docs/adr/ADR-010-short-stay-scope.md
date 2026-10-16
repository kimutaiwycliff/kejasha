# ADR-010 — Short-stay scope: no channel manager; read-only iCal import

- Status: Accepted · 2026-10-16

## Context
Airbnb and Booking.com APIs require partner programmes (NDA, security review, mandatory features).
A full channel manager was considered and deferred.

## Decision
- v1 short-stay = calendar, rates, bookings, guests, expenses, profit reporting.
- **Read-only iCal import** per unit (Airbnb, Booking.com, others): worker polls every 15–30 min
  using ETag/Last-Modified, upserts imported events keyed by feed UID as `booking` (source tagged,
  amounts unknown until the host fills them) or `calendar_block`.
- Conflicts with existing bookings are flagged for review, never overwritten (ADR-007).
- No iCal export, no OTA APIs, no channel-manager middleware in v1.

## Consequences
+ No partnership dependency; hosts avoid double entry for availability.
− iCal lag (up to ~1h) and no guest/price data — hosts enter amounts manually for OTA bookings.
Revisit (export feed, Channex-style connectivity) once short-stay traction justifies it.
