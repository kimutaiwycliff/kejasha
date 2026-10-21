# Kejasha

Property management, rent collection and short-stay management for Kenya.
API-first: one Fastify backend serving the Next.js web app and the native Kotlin Android app.
The backend is built first (ADR-018); clients follow against a frozen contract.

- Product + engineering reference: [CLAUDE.md](CLAUDE.md)
- Roadmap: [docs/plans/roadmap.md](docs/plans/roadmap.md) · current phase: [docs/plans/phase-0.md](docs/plans/phase-0.md)
- Architecture decisions: [docs/adr/](docs/adr/)

## Quick start

Requirements: Node 22, pnpm 9 (`corepack enable`), Docker.

```bash
cp .env.example .env
pnpm install
make up            # postgres 17, redis 7, minio + buckets, migrations
make dev-api       # http://localhost:4000/v1/health · docs at http://localhost:4000/docs
make dev-worker    # outbox relay + BullMQ workers
```

## Tests

```bash
make test          # unit + integration + RLS (Testcontainers — Docker must be running)
make test-journeys # API journeys through the generated client
make test-contract # Schemathesis against a running API
```

## Contract workflow

Zod schema in `packages/contracts` → route → tests → `make api-spec` → `make client-gen`.
Never hand-edit `apps/api/openapi.json` or `packages/api-client/src/schema.d.ts`.
