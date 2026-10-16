# ADR-013 — Hosting: single VM, Docker Compose, Caddy, Cloudflare

- Status: Accepted · 2026-10-16

## Decision
- Dedicated VM (same class as PharmaTrack's: ~4 vCPU / 8 GB) running Docker Compose:
  postgres, redis, minio, caddy, api, worker, web.
- Caddy terminates TLS; Cloudflare DNS/proxy in front. `api.${APP_DOMAIN}` and `app.${APP_DOMAIN}` (launch: kejasha.co.ke) — see ADR-016.
- Images built in GitHub Actions for `linux/amd64`, pushed to GHCR, deployed by digest via
  `make deploy` (pull → `dbmate up` → compose up → health check); `make rollback` = previous digest.
- Backups: nightly `pg_dump` + WAL archiving to off-VM S3-compatible storage; restore drill before launch.
- Ops stack (Grafana/Loki/Prometheus/Uptime Kuma) added before launch, ideally off the app VM.

## Consequences
+ Cheap, simple, no cloud lock-in; same runbook muscle memory as PharmaTrack.
− Single VM is a single point of failure — mitigated by backups + scripted rebuild.
