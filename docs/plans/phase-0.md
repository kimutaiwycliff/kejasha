# Phase B0 — Foundations

> Status: **APPROVED · IN PROGRESS** · drafted 2026-10-16 · revised 2026-10-21 (ADR-017, ADR-018)
> Goal: a working skeleton where isolation, contracts and tests are proven before any feature exists.
> Convention: `[ ]` todo · `[~]` in progress · `[x]` done & verified · `[!]` blocked (reason)

## 0.1 Monorepo scaffold
- [ ] pnpm workspaces + Turborepo; Node 22 pinned (`.nvmrc`, `engines`, `packageManager`)
- [ ] `tsconfig.base.json` strict (+ `noUncheckedIndexedAccess`); package stubs per CLAUDE.md §4
      (`@kejasha/*`), ESM everywhere, internal packages consumed as TS source (no build step in dev)
- [ ] ESLint (flat config, typescript-eslint) + Prettier; module-boundary rule (API modules import
      other modules only via their `index.ts`)
- [ ] Husky + lint-staged + commitlint (conventional commits)
- [ ] `.env.example` with every variable from CLAUDE.md §10; `packages/config` parses env with Zod,
      fails fast
- [ ] Config derives all URLs/origins/sender/cookie domain from `APP_DOMAIN` (ADR-016);
      guard test fails if the literal production domain appears in source

## 0.2 Local infrastructure
- [ ] `infra/compose.yml`: postgres 17, redis 7, minio (+ bucket init); api/worker under an
      `app` profile; caddy under an `edge` profile (B7 finalises)
- [ ] `Makefile` targets from CLAUDE.md §9 (stubs print "not yet — phase Bn" where not built)
- [ ] `make up` boots clean on a fresh machine

## 0.3 Database foundation
- [ ] dbmate wired (`infra/migrations`); first migration: roles `app_owner` (migrations, admin) /
      `app_authenticated` (NOLOGIN, used via `SET LOCAL ROLE`) + login role `app_api`;
      extensions `btree_gist`, `citext`, `pgcrypto`; helper `app.current_org_id()`
- [ ] `packages/db`: Drizzle client, `withTenant(orgId, fn)` (tx + `SET LOCAL app.org_id` +
      `SET LOCAL ROLE app_authenticated`), `withAdmin(fn)` (platform only)
- [ ] Platform tables: `outbox`, `idempotency_key`, `audit_log`
- [ ] Sample tenant table `_rls_probe` to exercise the harness
- [ ] Testcontainers harness: one Postgres per test run, migrations applied, helpers to create orgs

## 0.4 RLS isolation suite
- [ ] `make test-rls`: two orgs; select/insert/update/delete across orgs denied on every tenant table
- [ ] Meta-test: every table with `org_id` has RLS enabled **and forced** with a policy; fails if missing
- [ ] Missing `app.org_id` ⇒ zero rows and inserts rejected

## 0.5 API skeleton
- [ ] Fastify 5 + `fastify-type-provider-zod`; module loader for `src/modules/*`; `buildApp()`
      factory used by server, tests and spec generation
- [ ] Problem+json error handler (RFC 9457, Zod validation → 400 with field errors);
      request id (`x-request-id`); pino logs with `{reqId, orgId, userId, route, ms, status}`
- [ ] `Idempotency-Key` plugin backed by `idempotency_key` table (same key + same hash → replay
      stored response; same key + different hash → 422; in-flight → 409)
- [ ] `/v1/health` → `{status, checks: {db, redis, storage}}`; `/v1/meta/config`;
      `/openapi.json`; Scalar at `/docs`
- [ ] CORS (origins from config) + security headers (`@fastify/helmet`); Redis rate-limit plugin,
      off by default, opt-in per route
- [ ] OpenTelemetry + GlitchTip hooks (no-op without DSN/endpoint)

## 0.6 Contracts, spec lint & generated client
- [ ] `packages/contracts`: problem+json, pagination envelope, money (`amountCents` int64 +
      `currency`), ids (UUID), health, meta
- [ ] `make api-spec` → `apps/api/openapi.json` (no server needed; built from `buildApp()`);
      `make client-gen` → `packages/api-client`
- [ ] Spec lint (Redocly + custom rule script): every operation has `operationId`; every
      `*Cents` property is `integer/int64`; no unnamed request/response body schemas (ADR-017)
- [ ] CI check: committed spec == generated spec

## 0.7 Journey harness (ADR-018)
- [ ] `apps/api/test/journeys/`: boots API on a random port against Testcontainers, exposes a
      typed client from `packages/api-client`
- [ ] First journey: health + meta config through the generated client

## 0.8 Jobs foundation
- [ ] `packages/jobs`: queue registry, `enqueueInTx(tx, event)` writes the outbox row
- [ ] `apps/worker`: BullMQ; outbox relay (poll + `FOR UPDATE SKIP LOCKED`, mark dispatched)
- [ ] Integration test: business row + outbox row commit atomically; rollback leaves neither;
      relay delivers exactly once to a test queue; failing job exhausts retries into DLQ

## 0.9 Core package
- [ ] `packages/core/money.ts`: bigint cents helpers, KES formatting, allocation without remainder loss
- [ ] `packages/core/time.ts`: Africa/Nairobi business-date helpers (month boundaries, due dates)
- [ ] `packages/core/phone.ts`: Kenyan E.164 normalisation (`07…`, `01…`, `2547…`, `+2547…`, `7…`)
- [ ] Exhaustive unit tests for all three

## 0.10 CI
- [ ] GitHub Actions: install → typecheck → lint → unit → integration + RLS (Testcontainers) →
      journeys → spec up-to-date + spec lint + oasdiff → Schemathesis vs booted API → build
- [ ] Docker images for api/worker build for `linux/amd64`

## Removed from B0 (ADR-018)
- Web shell (Next.js) → track W, after the contract freeze.

## Definition of Done
- `make up` boots clean; `/v1/health` returns 200 with all dependencies green.
- `/docs` renders the OpenAPI spec; spec lint passes; generated client compiles and drives the
  health journey.
- RLS isolation suite + meta-test green.
- Outbox atomicity + relay tests green.
- CI green from a fresh clone on a fresh database.

## Open items
- Confirm `kejasha.co.ke` is registered (set as `APP_DOMAIN` in prod; changeable per ADR-016).
