# ADR-007 — Overlap prevention with Postgres exclusion constraints

- Status: Accepted · 2026-10-16

## Decision
Enable `btree_gist`. Then:
- `lease`: `EXCLUDE USING gist (unit_id WITH =, during WITH &&) WHERE (status IN ('active','pending'))`.
- Short-stay: bookings and calendar blocks share one table of occupancy (`unit_occupancy`) or each
  carries the exclusion; a booking on `[check_in, check_out)` can never overlap another booking or
  block on the same unit when not cancelled.
- Ranges are half-open `daterange` (check-out day is free for the next check-in).
- API maps the constraint violation (`23P01`) to a 409 problem+json with the conflicting range.

## Consequences
+ Double bookings are impossible even under concurrent requests or iCal imports.
− iCal imports must handle conflicts explicitly (flag for review, never silently drop).
