# ADR-021 — Web app on Next.js 16 and TanStack Table v9

- Status: Accepted · 2026-10-26
- Amends: CLAUDE.md §3 (Web: "Next.js 15"; Tables: "TanStack Table v8")

## Context
The stack froze Next.js 15 and TanStack Table v8 in October 2026, before any web code existed.
When the web phase starts (after `contract-v1.0`), the current majors are Next.js 16 and TanStack
Table v9. The docs site already runs on Next.js 16 (ADR-020). Starting a long-lived app on the
older majors means an upgrade before launch for no benefit.

## Decision
- `apps/web` uses **Next.js 16** (App Router) and **TanStack Table v9**, pinned exactly, like the
  docs app.
- Everything else in §3 is unchanged: a pure client of the API through `@kejasha/api-client`,
  TanStack Query, React Hook Form + Zod (schemas from `@kejasha/contracts`), shadcn/ui on
  Tailwind v4 in `packages/ui`, Playwright for journeys.

## Consequences
+ One Next.js major across the repo; no forced upgrade before launch.
− Examples and blog posts written for v8 tables need care; the shadcn data-table recipe is
  adapted to v9.
