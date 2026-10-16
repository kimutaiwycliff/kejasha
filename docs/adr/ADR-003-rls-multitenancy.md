# ADR-003 — Multi-tenancy via Postgres RLS + SET LOCAL + two DB roles

- Status: Accepted · 2026-10-16

## Decision
- Roles: `app_owner` (migrations, platform/operator queries, bypasses RLS) and `app_authenticated`
  (all tenant queries, subject to RLS).
- Every tenant table has `org_id uuid not null`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, and a policy
  `org_id = current_setting('app.org_id')::uuid`. Missing setting ⇒ zero rows (deny by default).
- `withTenant(orgId, fn)` opens a transaction, runs `SET LOCAL app.org_id` and
  `SET LOCAL ROLE app_authenticated`, then calls `fn(tx)`. Route handlers never get a raw pool.
- Agency access to client-landlord data stays inside the agency org (client landlords are rows in
  the agency org, see ADR-005); cross-org access is never granted by policy.
- `make test-rls`: two orgs, every tenant table — select/insert/update/delete across orgs denied.
  A test asserts that every table with an `org_id` column has RLS forced (catches forgotten tables).

## Consequences
+ Isolation holds even if application code has a bug.
− Every query must run in a transaction with settings; pooled connections must not leak settings
  (hence `SET LOCAL`).
