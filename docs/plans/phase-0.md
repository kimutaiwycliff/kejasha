# Phase 0 — Foundations

> Status: **AWAITING APPROVAL** · drafted 2026-10-16
> Goal: a working skeleton where isolation, contracts and tests are proven before any feature exists.
> Convention: `[ ]` todo · `[~]` in progress · `[x]` done & verified · `[!]` blocked (reason)

## 0.1 Monorepo scaffold
- [ ] pnpm workspaces + Turborepo; Node 22 pinned (`.nvmrc`, `engines`)
- [ ] `tsconfig.base.json` strict; package stubs per CLAUDE.md §4 (`@kejasha/*` names)
- [ ] ESLint (flat config) + Prettier; module-boundary rule (modules import only via `index.ts`)
- [ ] Husky + lint-staged + commitlint (conventional commits)
- [ ] `.env.example` with every variable from CLAUDE.md §10; env parsed with Zod, fail fast
- [ ] Config derives all URLs/origins/sender/cookie domain from `APP_DOMAIN` (ADR-016);
      CI guard test fails if the literal production domain appears in source

## 0.2 Local infrastructure
- [ ] `infra/compose.yml`: postgres 17, redis 7, minio, caddy (+ api/worker/web services)
- [ ] `Makefile` targets from CLAUDE.md §9 (stubs allowed where the feature doesn't exist yet)
- [ ] `make up` boots clean on a fresh machine

## 0.3 Database foundation
- [ ] dbmate wired; first migration: roles `app_owner` / `app_authenticated`, `btree_gist`,
      `citext`, `pgcrypto`, helper `current_org_id()`
- [ ] `packages/db`: Drizzle client for both roles, `withTenant()`, `dbAdmin`
- [ ] Platform tables: `outbox`, `idempotency_key`, `audit_log`
- [ ] Sample tenant table `_rls_probe` to exercise the harness
- [ ] Testcontainers harness: one Postgres per test run, migrations applied, per-test transaction/rollback

## 0.4 RLS isolation suite
- [ ] `make test-rls`: two orgs; select/insert/update/delete across orgs denied on every tenant table
- [ ] Meta-test: every table with `org_id` has RLS enabled **and forced**; fails if one is missing
- [ ] Missing `app.org_id` ⇒ zero rows

## 0.5 API skeleton
- [ ] Fastify 5 + `fastify-type-provider-zod`; module loader for `src/modules/*`
- [ ] Problem+json error handler; request id; pino logs with `{reqId, orgId, userId, route, ms, status}`
- [ ] `Idempotency-Key` plugin backed by `idempotency_key` table (replays stored response)
- [ ] `/v1/health` → `{db, redis, storage, email}`; `/openapi.json`; Scalar at `/docs`
- [ ] CORS + security headers; rate limiter (Redis) plugin, off by default per route
- [ ] OpenTelemetry + GlitchTip wired (no-op without DSN)

## 0.6 Contracts & generated client
- [ ] `packages/contracts`: problem+json, pagination envelope, money (`{amountCents, currency}`), ids
- [ ] `make api-spec` → `apps/api/openapi.json`; `make client-gen` → `packages/api-client`
- [ ] Example: health route defined via contracts and consumed through the generated client in a test

## 0.7 Jobs foundation
- [ ] `apps/worker` with BullMQ; outbox relay (poll + `FOR UPDATE SKIP LOCKED`)
- [ ] Integration test: business row + outbox row commit atomically; rollback leaves neither;
      relay delivers exactly once to a test queue; failed job lands in DLQ

## 0.8 Core package
- [ ] `packages/core/money.ts`: bigint cents helpers, KES formatting, allocation without remainder loss
- [ ] `packages/core/time.ts`: Africa/Nairobi business-date helpers (month boundaries, due dates)
- [ ] `packages/core/phone.ts`: Kenyan E.164 normalisation (`07…`, `01…`, `2547…`, `+2547…`, `7…`)
- [ ] Exhaustive unit tests for all three

## 0.9 Web shell
- [ ] Next.js 15 app (`apps/web`) with shadcn/ui + Tailwind v4, `--kj-*` tokens, light/dark
- [ ] TanStack Query + generated API client; health status page proves web → API path

## 0.10 CI
- [ ] GitHub Actions: install → typecheck → lint → unit → integration + RLS (service containers or
      Testcontainers) → spec up-to-date + Redocly lint + oasdiff → Schemathesis vs booted API → build
- [ ] Docker images for api/worker/web build for `linux/amd64`

## Definition of Done
- `make up` boots clean; `/v1/health` returns 200 with all dependencies green.
- `/docs` renders the OpenAPI spec; generated client compiles and is used by web and tests.
- RLS isolation suite + meta-test green.
- Outbox atomicity test green.
- CI green from a fresh clone on a fresh database.

## Open items before Phase 1
- Confirm `kejasha.co.ke` is registered (set as `APP_DOMAIN` in prod; changeable per ADR-016).
