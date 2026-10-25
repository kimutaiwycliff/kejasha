# Phase B7 — Hardening & launch readiness (+ documentation site)

> Status: **IN PROGRESS** · drafted 2026-10-25 · ADR-013, ADR-016, ADR-019, ADR-020
> Convention: `[ ]` todo · `[~]` in progress · `[x]` done & verified · `[!]` blocked (reason)

## Goal
The backend is safe, measured, recoverable and deployable, and its contract is frozen as
`contract-v1.0` so the web and Android clients can start. A documentation site explains the API
and its operation to client developers, support and operators.

## Key decisions
- **Security review** (OWASP ASVS L2 lens): an independent read-only audit of auth/roles,
  tenancy (`db.owner` call sites, RLS, views), webhooks, secrets, SSRF, uploads, exports, rate
  limits, HTTP hardening and dependencies. Every confirmed finding is fixed with a test.
  Results go in `docs/security/review-2026-10.md`.
- **Backups:**
  - A nightly `pg_dump -Fc` (worker cron) uploaded to the backups bucket (R2 in production,
    ADR-019), keeping 30 days.
  - `make backup` runs one now; `make restore-drill` restores the latest dump into a scratch
    database and checks invariants: migrations applied, row counts, ledger trial balance = 0, RLS
    still on.
  - Point-in-time recovery (WAL archiving) is deferred: nightly dumps plus R2 meet the v1 RPO of
    24 h. Recorded in the runbook.
- **Deploy (ADR-013):**
  - `infra/compose.prod.yml` (postgres, redis, api, worker, caddy, docs).
  - A Caddyfile driven by `{$APP_DOMAIN}` (api., app., docs.). Built images are tagged with the
    git SHA.
  - `make deploy` (build → push → ssh → migrate → up) and `make rollback` (previous tag).
  - `DEPLOYMENT.md` covers first-time setup, secrets, deploy/rollback and the domain-change
    runbook.
  - The server address and credentials come from the environment; nothing is committed.
- **Load test:** k6 script (`infra/load/`) with a realistic mix (dashboards, lists, payments,
  statements, sync pull) at 50 virtual users. Target P95 < 500 ms; the result is recorded. A
  local run is indicative; the real number comes from the production-like VM before launch.
- **Docs (ADR-020):** `apps/docs` with Fumadocs 16 on Next.js 16, statically exported: guides,
  operations and a generated API reference from `apps/api/openapi.json`. Built in CI.
- **Contract freeze:**
  - After merge, tag `contract-v1.0`.
  - `apps/api/oasdiff-ignore.txt` is emptied: from then on every breaking change fails CI and
    needs a versioned path or an explicit decision.
  - `docs/contract.md` states the versioning policy.

## Tasks
- [ ] Security review report + fixes with tests
- [ ] Backups: nightly job, `make backup`, `make restore-drill` (passes locally)
- [ ] Deploy: compose.prod, Caddyfile, Dockerfiles checked, `make deploy/rollback`, DEPLOYMENT.md
- [ ] Load test script + local baseline recorded
- [ ] Docs site: Fumadocs app, guides, operations, generated API reference, CI build
- [ ] Contract freeze: policy doc, empty oasdiff ignore list, tag `contract-v1.0` after merge
- [ ] Launch checklist (owner inputs): Daraja sandbox creds, Paystack test keys, real M-Pesa
      samples (CSV, PDF incl. password, SMS), VM + DNS + R2 buckets/keys, TRUST_PROXY hops, first
      operator email

## Definition of Done
Security findings fixed or accepted with reasons; restore drill passes; deploy/rollback scripted
and documented; load-test baseline recorded; docs site builds in CI with the generated reference;
`contract-v1.0` tagged; CI green.
