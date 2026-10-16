# ADR-004 — Better Auth: orgs = tenants, phone OTP, bearer tokens for mobile

- Status: Accepted · 2026-10-16

## Decision
- Better Auth mounted in the Fastify API under `/v1/auth/*` with the Drizzle adapter.
- Plugins: **organization** (org = tenant; members with roles), **bearer** (Android sends
  `Authorization: Bearer`), **phone-number** (SMS OTP via Africa's Talking) for tenants and caretakers.
- Web uses HTTP-only cookies on the API domain (same-site via Caddy: `app.` and `api.` subdomains).
- Roles: `owner > manager > agent > caretaker`; tenants authenticate to a separate tenant portal
  scope and only see their own leases/invoices/bookings.
- `requireRole()` preHandler on every protected route; active org resolved from session.
- Phones normalised to E.164 (`07…`, `01…`, `2547…`, `+2547…`, bare `7…`).
- OTP: rate-limited per phone and IP; codes expire in 5 minutes.

## Consequences
+ No bespoke auth crypto; mobile and web share one auth system.
− Cookie + bearer dual mode must be tested on both clients.
