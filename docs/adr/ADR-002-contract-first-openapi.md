# ADR-002 — Contract-first API: Zod → OpenAPI 3.1 → generated client

- Status: Accepted · 2026-10-16

## Context
Several clients (web, Android: owner, caretaker, tenant) must stay in lockstep with the API, and the
API must be well documented.

## Decision
- All request/response/error shapes live as Zod schemas in `packages/contracts`.
- Routes register those schemas via `fastify-type-provider-zod`; `@fastify/swagger` emits
  OpenAPI 3.1; Scalar serves docs at `/docs`; raw spec at `/openapi.json`.
- `make api-spec` writes `apps/api/openapi.json` (committed). `make client-gen` regenerates
  `packages/api-client` (openapi-typescript + openapi-fetch). Hand edits are forbidden.
- CI: spec must be up to date (diff = fail), Redocly lint, **oasdiff** breaking-change check vs `main`.
- Versioning: path prefix `/v1`. Breaking changes require `/v2` routes or an ADR.
- Errors: RFC 9457 problem+json envelope, typed in contracts.
- Lists: cursor pagination (`?cursor=&limit=`) with a standard envelope.

## Consequences
+ Docs cannot drift; clients get compile errors on contract changes.
− Every change touches contracts first — slightly more ceremony, by design.
