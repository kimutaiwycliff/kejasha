# sync module

Offline sync for the Android app (ADR-017). Owns no tables: it reads its own `sync_*` views
(`security_invoker`, so RLS applies) and writes only through other modules' services.

- **Pull** (`GET /v1/sync/pull`): per table, rows whose `updated_at` is past the cursor's keyset
  watermark `(µs, id)` and at least 10 s old. The lag means a still-open transaction's rows are
  sent on a later pull instead of being skipped; devices upsert by id, so re-sends are harmless.
  - Up to 500 rows per table per pull; `hasMore` asks the device to pull again.
  - Archived rows (and closed/cancelled tickets) come as `deleted`.
  - Caretakers get only their assigned properties and their own cash, and never tenants or
    leases.
  - The cursor carries a hash of role and assigned properties. When that changes, `reset: true`
    and a full snapshot follow, so revoked access does not linger on the device.
- **Push** (`POST /v1/sync/push`): records carry client UUIDv7 ids and are applied in order
  (tickets, ticket updates, readings, cash), each in its own transaction through the normal
  services.
  - An id that already exists is `duplicate`, which makes replays apply once.
  - Service refusals come back as `rejected` with their problem code (e.g. `ticket_finished`,
    `reading_decreased`).
  - Cash stays a proposal for an owner to confirm.
