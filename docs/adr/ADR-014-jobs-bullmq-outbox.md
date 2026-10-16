# ADR-014 — Jobs: BullMQ + Redis with a transactional outbox

- Status: Accepted · 2026-10-16

## Decision
- BullMQ on Redis in `apps/worker` for: monthly invoice generation, reminders, iCal polling,
  payment matching, statement parsing, PDF statements, dunning, MRI summaries.
- Business code never enqueues directly. It writes an `outbox` row **in the same transaction** as
  the business change; a relay in the worker publishes outbox rows to BullMQ and marks them sent.
  This removes the "job enqueued but transaction rolled back" (and vice versa) class of bugs.
- Every job handler is idempotent (natural keys like `UNIQUE(lease_id, period)`), retried with
  exponential backoff, and lands in a dead-letter queue with an alert when exhausted.
- Repeatable (cron) jobs are defined in code and reconciled at worker start.

## Consequences
+ Familiar from PharmaTrack; Redis also serves rate limiting.
− Two stores (Postgres + Redis) to operate; outbox relay is one more moving part, tested in integration.
