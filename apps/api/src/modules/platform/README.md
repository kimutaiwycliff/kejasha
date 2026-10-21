# platform module

Owns: `/v1/health`, `/v1/meta/config`. No tables.

- Health probes Postgres (tenant pool), Redis and S3/MinIO with a 1.5 s timeout each; 503 if any
  configured dependency is down. Storage reports `skipped` when S3 is not configured.
- Meta config gives installed clients the canonical API/web URLs and contract version (ADR-016/017).
