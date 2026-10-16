# ADR-001 — TypeScript modular monolith on Fastify 5

- Status: Accepted · 2026-10-16

## Context
Kejasha serves web and Android clients from one backend. The team is TypeScript-native (PharmaTrack),
and we want shared types/validation across API, web and mobile. A rebuild of an earlier NestJS/Nx
prototype was chosen over continuing it.

## Decision
One deployable API (`apps/api`) on **Fastify 5**, organised as bounded-context modules under
`src/modules/*`, each exposing only `index.ts`. A separate `apps/worker` process runs jobs from the
same codebase. ESLint `no-restricted-imports` (or dependency-cruiser) enforces that modules import
each other only through `index.ts`.

## Consequences
+ Fast, mature, plugin-based; `app.inject()` makes route tests cheap.
+ One language across the stack; shared Zod contracts.
− Less built-in structure than NestJS — the module rules must be enforced by lint, not framework.

## Alternatives
NestJS (heavier decorator model conflicts with Zod-first contracts), Hono (younger ecosystem for
Node-specific plugins), Go/Django (splits the stack, no shared types).
