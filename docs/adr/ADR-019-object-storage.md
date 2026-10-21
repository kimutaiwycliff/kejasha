# ADR-019 — Object storage: Cloudflare R2 in production, SeaweedFS for dev/CI (amends CLAUDE.md §3)

- Status: Accepted · 2026-10-21
- Amends: CLAUDE.md §3 "Object storage: S3-compatible (MinIO self-hosted)"; ADR-013 (backups bucket)

## Context
MinIO container images are no longer publicly published (Docker Hub and quay.io, including pinned
release tags, all refuse pulls as of 2026-10-21). Our compose stack, CI and production plan all
depended on them; a fresh `make up` or CI runner could not start object storage.

The application only uses the S3 API (HeadBucket, presigned PUT/GET, later Put/Get for PDFs), so
the server is replaceable without code changes.

## Decision
- **Production: Cloudflare R2.** Managed, S3-compatible, zero egress fees, and we already front the
  app with Cloudflare (ADR-013). Lease documents, photos, statements (`S3_BUCKET_FILES`) and
  database backups (`S3_BUCKET_BACKUPS`) live **off the single VM**, which also fixes the
  disaster-recovery weakness of keeping backups on the machine they protect.
- **Development & CI: SeaweedFS** (Apache-2.0) in `infra/compose.yml`, the CI contract job and the
  Testcontainers harness, with an S3 identity file (`infra/seaweedfs/s3.json`) so requests are
  signed and authenticated exactly as in production. Exposed on `localhost:9000` as before.
- Configuration stays env-only (`S3_ENDPOINT`, `S3_REGION`, keys, bucket names); for R2,
  `S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, `S3_REGION=auto`.
- **SDK setting found during the switch:** the AWS SDK's default "flexible checksums" bake a
  checksum of an empty body into presigned PUT URLs, so every real upload fails (and R2 rejects the
  extra parameters). The storage client sets `requestChecksumCalculation: 'WHEN_REQUIRED'`; a
  round-trip upload/download test guards it.

## Consequences
+ Dev, CI and fresh machines work again; production storage is managed and off-box.
+ Backups survive loss of the VM.
− Production depends on Cloudflare for storage (already true for DNS/proxy).
− Local storage (SeaweedFS) differs from production (R2); both are exercised only through the S3
  API, and the round-trip test runs against SeaweedFS.
