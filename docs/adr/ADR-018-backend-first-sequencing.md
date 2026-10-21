# ADR-018 — Backend-first build sequencing (amends CLAUDE.md §7)

- Status: Accepted · 2026-10-21

## Context
The original plan shipped vertical slices (API + web screens per phase). The owner wants the
backend completed in full first — API, worker, all integrations, hardening — and then the web
(Next.js) and Android (Kotlin, ADR-017) clients built against a frozen contract, in parallel.

Risk: endpoints designed without a client consuming them can be awkward, and problems surface late.

## Decision
- **Backend phases B0–B7** (`docs/plans/roadmap.md`) cover everything server-side: API,
  worker/cron, integrations (Daraja, Africa's Talking, Resend, Paystack, iCal, S3), PDFs, sync
  API, SaaS billing + operator API, observability, backups, hardening.
- **Journey tests are the client proxy.** Every backend phase's DoD includes scenario tests in
  `apps/api/test/journeys/` that drive the API **only through the generated TypeScript client**
  (`packages/api-client`) the way a screen would. If one screen needs more than a few calls, the
  API shape is wrong — fix it before moving on.
- **Screen-shaped read models.** Each phase lists the screens its API must power; list/detail
  endpoints return what those screens need (no client-side N+1).
- **Contract freeze.** At the end of B7 the spec is tagged `contract-v1.0`. From then on oasdiff
  blocks breaking changes; additive only (or `/v2`).
- **Client tracks W (web) and A (Android)** start after the freeze and may run in parallel; they
  request additive API changes through the normal contract-first flow.
- The operator console is API-only in B6; its UI is part of track W.

## Consequences
+ One stable, fully tested API before any UI spend; clients can be built by separate people.
+ Journey tests double as executable API documentation.
− No clickable product until the backend is done; demos use Scalar (`/docs`) and journey tests.
− Some reshaping may still be needed once real screens exist — kept additive by the freeze.
