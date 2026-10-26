# Phase B7 — Hardening & launch readiness (+ documentation site)

> Status: **DONE** · merged (PR #9) and tagged `contract-v1.0` 2026-10-26 · drafted 2026-10-25 · ADR-013, ADR-016, ADR-019, ADR-020
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
- [x] Security review report + fixes with tests
- [x] Backups: nightly job, `make backup`, `make restore-drill` (passes locally)
- [x] Deploy: compose.prod, Caddyfile, Dockerfiles checked, `make deploy/rollback`, DEPLOYMENT.md
- [x] Load test script + local baseline recorded
- [x] Docs site: Fumadocs app, guides, operations, generated API reference, CI build
- [x] Contract freeze: policy doc, empty oasdiff ignore list, `contract-v1.0` tagged on main
- [!] Launch checklist (owner inputs): Daraja sandbox creds, Paystack test keys, real M-Pesa
      samples (CSV, PDF incl. password, SMS), VM + DNS + R2 buckets/keys, TRUST_PROXY hops, first
      operator email

## Notes (2026-10-26)
- **Security review:** 1 high, 8 medium and 9 low findings; all high/medium fixed with tests,
  lows fixed or accepted with reasons (`docs/security/review-2026-10.md`). `pnpm audit --prod`:
  0 advisories. Email verification was added as part of the H1 fix.
- **Backups:** the restore drill passed on a real local dump (12/12 migrations, 45 tenant tables
  under RLS, trial balance 0). Point-in-time recovery is deferred; RPO is 24 h.
- **Load test (local, production build, 2 min, 50 VUs, demo data):** 11,811 requests, 0 failed,
  overall P95 **132 ms**, max 461 ms. Dashboard P95 212 ms (six months of statements, the
  heaviest endpoint); everything else P95 ≤ 70 ms. Repeat on the production VM before launch.
- **Docs:** `apps/docs` builds 582 static pages (guides + generated reference) and ships as a
  Caddy image. CI builds it on every PR. Next.js 16 for docs only (ADR-020).
- **Deploy:** the CI images job now publishes api/worker/docs to GHCR on `main` (SHA + `main`
  tags). `make deploy` needs the VM; untested against a real host until one exists.
- **Contract:** `info.version` 1.0.0, policy in `docs/contract.md`, oasdiff ignore list emptied.

## Launch checklist (owner inputs) — blocked on
- [ ] Daraja sandbox credentials → live C2B/STK smoke test
- [ ] Paystack test keys → live checkout/webhook/renewal smoke test
- [ ] Real M-Pesa samples: business CSV, personal PDF (incl. password-protected), SMS texts
- [ ] Production VM, DNS on Cloudflare, Cloudflare Access for `/v1/operator/*`, R2 buckets and keys
- [ ] Safaricom callback IP list (`DARAJA_CALLBACK_IPS`), `TRUST_PROXY` hop count
- [ ] First Kejasha operator email (`make operator-grant`)
- [ ] Load test re-run on the VM; restore drill on production backups

## Definition of Done
Security findings fixed or accepted with reasons; restore drill passes; deploy/rollback scripted
and documented; load-test baseline recorded; docs site builds in CI with the generated reference;
`contract-v1.0` tagged; CI green.
