# ADR-005 — Account hierarchy: agency → client landlord → property → unit

- Status: Accepted · 2026-10-16

## Context
Three customer types: independent landlords, agencies managing many owners, short-stay hosts.

## Decision
- Every customer is one **organization** (tenant boundary). `org_profile.kind` ∈
  `landlord | agency | host` only drives onboarding and defaults — not capabilities.
- `client_landlord` rows exist inside an org: an independent landlord org has exactly one implicit
  "self" client landlord; an agency has many. Properties belong to a client landlord.
- Units have `mode` = `long_term | short_stay`; any org may mix both.
- Owners of agency-managed properties may get a read-only **owner login** scoped to their
  `client_landlord_id` (row filter on top of RLS).
- Management fees (% of collections or flat) are configured per client landlord.

## Consequences
+ One engine for all three segments; an independent landlord can later become an agency.
− Owner logins need a second filter layer, tested explicitly.
