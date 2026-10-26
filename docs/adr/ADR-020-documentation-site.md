# ADR-020 — Documentation site: Fumadocs on Next.js 16 (`apps/docs`)

- Status: Accepted · 2026-10-25
- Amends: CLAUDE.md §3 (adds a docs app; the web app's pinned Next.js 15 is unchanged)

## Context
The API is contract-first (ADR-002) and its OpenAPI spec is rendered by Scalar at `/docs` on the
API itself. That serves developers poking at endpoints, but there is no place for the knowledge
clients and operators need around the endpoints: how auth and orgs work, money in cents,
idempotency, problem+json errors, the sync protocol, M-Pesa onboarding, billing states, deployment
and runbooks. That knowledge lives today in ADRs, plans and module READMEs, written for us rather
than for client developers (web, Android) or support staff.

The owner asked for a proper documentation site using Fumadocs.

Fumadocs 16 (core/ui 16.17, mdx 15, openapi 12) requires **Next.js 16** and React 19.2. Fumadocs
15 is the last line supporting Next.js 15 and is no longer the maintained line.

## Decision
- New app **`apps/docs`**: Next.js 16 + Fumadocs (`fumadocs-core`, `fumadocs-ui`, `fumadocs-mdx`,
  `fumadocs-openapi`), statically exported (`output: 'export'`) and served by Caddy at
  `docs.${APP_DOMAIN}`. It has no server runtime, reads no database, and calls no API.
- **Content:**
  - **Guides** (MDX in `apps/docs/content/docs`): getting started, authentication and orgs, roles,
    money and dates, idempotency, errors, pagination, offline sync, M-Pesa payments, short-stay,
    compliance, reporting, billing and the tenant portal.
  - **Operations:** deployment, backups and restore, the domain-change runbook, and security.
  - **API reference:** generated from `apps/api/openapi.json` by `fumadocs-openapi` at build time.
    The reference can therefore never drift from the contract; CI builds the docs on every PR.
- **Versions are pinned exactly.** The docs app uses Next.js 16 while the web app (phase W) keeps
  Next.js 15 as pinned in §3 until its own ADR. The apps share nothing at runtime, so two Next
  majors in the monorepo is acceptable.
- No literal production domain in docs source (ADR-016): pages say `api.<your domain>` or use
  `APP_DOMAIN`-derived examples.

## Consequences
+ One place for client developers, support and operators. The API reference is generated, so it
  is always current.
+ A static export: cheap to host, no attack surface beyond Caddy.
− A second Next.js major in the repo. Turbo builds it like any other app.
− Guides must be maintained alongside the code; PR reviews should ask whether the docs need an
  update when a contract or flow changes.
