# ADR-012 — Testing strategy

- Status: Accepted · 2026-10-16

| Level | Tooling | Scope |
|---|---|---|
| Unit | Vitest | `packages/core`: money, proration, ledger rules, MRI tax, profit, phone normalisation |
| Integration | Vitest + Testcontainers (Postgres 17, Redis) + Fastify `app.inject()` | Every route against a real DB; RLS; constraints; outbox atomicity |
| RLS isolation | `make test-rls` | Two orgs × every tenant table; RLS-forced meta-test |
| Contract | Schemathesis against `/openapi.json` | Fuzzed requests: no 5xx, responses match schema |
| Spec | Redocly lint, oasdiff vs `main` | No accidental breaking changes |
| Integrations | Recorded fixtures (Daraja callbacks, statements, iCal feeds) + sandbox smoke | Parsers and idempotency |
| E2E web | Playwright | One happy path per user journey |
| Journeys (API) | Vitest + generated `packages/api-client` against a booted API | One scenario per user journey per phase (ADR-018) |
| Android | JUnit5, MockK, Turbine, Room in-memory, Compose UI, Maestro | Sync, offline caretaker shift, tenant pay (ADR-017) |

Rules: tests ship with the feature; money paths (ledger, payments, invoicing) target ~100% branch
coverage; never mock the database for anything touching SQL; never weaken an assertion to pass.
CI gate: typecheck → lint → unit → integration + RLS → journeys → spec checks → contract → build.
