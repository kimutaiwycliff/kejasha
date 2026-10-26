# Deployment

Operational docs live in the documentation site (ADR-020), so there is one copy:

- [Deployment — first-time setup, deploy, rollback](apps/docs/content/docs/operations/deployment.mdx)
- [Backups and restore drill](apps/docs/content/docs/operations/backups.mdx)
- [Changing the domain (runbook)](apps/docs/content/docs/operations/domain-change.mdx)
- [Security](apps/docs/content/docs/operations/security.mdx) · [latest review](docs/security/review-2026-10.md)

Quick reference:

```bash
DEPLOY_HOST=deploy@<vm> make deploy [TAG=<sha>]   # CI-built images, migrations, health check
DEPLOY_HOST=deploy@<vm> make rollback [TAG=<sha>] # previous tag; migrations are forward-only
make backup / make restore-drill                  # dump to the backups bucket / prove a restore
make operator-grant EMAIL=you@example.com         # Kejasha staff console access
```
