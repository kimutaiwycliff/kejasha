# API contract policy (frozen at `contract-v1.0`)

The OpenAPI document `apps/api/openapi.json` is the contract between the API and every client
(web, Android, integrations). It is generated from the Zod schemas (ADR-002); clients are
generated from it. On 2026-10-26 it was frozen as **`contract-v1.0`** (git tag; `info.version`
1.0.0) so the web and Android clients can be built against a stable surface (ADR-018).

## What may change without notice (additive)
- New endpoints, new tags.
- New **optional** request fields and query parameters.
- New response fields. Clients must ignore unknown fields (Kotlin: `ignoreUnknownKeys = true`;
  TypeScript: no exact-object checks on responses).
- New error `code` values within an already documented status. Clients branch on known codes and
  treat unknown ones by status.
- Wider request validation (accepting more input).

## What is breaking (CI fails)
`oasdiff breaking` runs on every PR against `main` and fails on any of these:
- removing or renaming an endpoint, field, parameter or enum value;
- a new **required** request field, or narrower request validation;
- a response field changing type, becoming nullable, or a response enum gaining a value
  (declare growing enums with `x-extensible-enum` first);
- a changed path, method or `operationId`.

## When a breaking change is unavoidable
1. Prefer an **additive** alternative: a new field or endpoint next to the old one, then mark
   the old one `deprecated: true` and keep it for at least **6 months** (or until no supported
   client version uses it).
2. If that is impossible, write an ADR explaining why and how clients migrate. Then list the
   exact oasdiff lines in `apps/api/oasdiff-ignore.txt`, citing the ADR, in the same PR. Bump
   `CONTRACT_VERSION` (minor for additive releases, major for breaking ones) and tag
   `contract-vX.Y` when released.

## Versioning
- `info.version` (`CONTRACT_VERSION` in `apps/api/src/plugins/openapi.ts`) follows semver:
  additive releases bump the minor version; a breaking release bumps the major version.
- Release tags: `contract-v1.0`, `contract-v1.1`, …
