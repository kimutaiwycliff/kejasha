# short-stay module

Owns rate plans + seasons (`rate_plan`, `rate_override`), guests, bookings, calendar blocks,
iCal feeds and unit expenses. `unit_occupancy` is written only by database triggers on `booking`
and `calendar_block`. Posts to the ledger through the ledger module (ADR-006). Reads units through
the accounts module (ADR-001).

- **No double-booking (ADR-007):** `unit_occupancy_no_overlap` covers live bookings
  (`[check_in, check_out + buffer_days)`) and blocks together. The service maps the violation to
  409 `dates_unavailable` and never checks availability itself before writing. Seasons use
  `rate_override_no_overlap` and map to 409 `season_overlap`.
- **Money:** only directly-collected sources (`direct`, `walk_in`, `whatsapp`, `other`) carry a
  receivable. `syncBookingLedger` posts the difference between the booking's gross and what is
  already billed (`Dr booking_receivable / Cr income_short_stay`). Creating, re-pricing,
  cancelling, marking a no-show and iCal removal or reconfirmation all go through it. Airbnb and
  Booking.com bookings feed the P&L only.
- **Payments:** `lookups.ts` (exported from `index.ts`) lets the payments module match a payment
  to a booking: by unit code (the one owing booking from 30 days before arrival until check-out)
  or by guest phone. It also allocates to a booking and runs STK against one.
- **iCal (ADR-010):** `ical.ts`. Feeds are polled every 20 minutes (`ical.sync_all`) or on demand,
  using ETag/Last-Modified. Each event is written in its own savepoint, so a clash with existing
  occupancy is recorded in `ical_feed.conflicts` and never overwrites anything. Events that leave
  the feed cancel the imported booking or delete the block. Feed URLs are secrets: the API only
  returns `urlHint`.
- **Profit:** `report` uses `@kejasha/core` `shortstay.monthlyProfit` / `channelComparison`.
  Bookings are split across months by night, and blocked nights reduce available nights.
