# accounts module

Owns the portfolio (ADR-005): `client_landlord`, `property`, `unit`, `property_staff`.
All tenant tables with RLS; children reference parents by `(org_id, id)` so they cannot cross orgs.

- Every org has exactly one `self` client landlord, created by the `orgCreated` hook; properties
  default to it. Agencies add more client landlords (management fee: none / percent bps / flat cents).
- Unit `code` is the Paybill account number (ADR-008): normalised upper case, ≤ 12 chars, unique per
  org — including archived units, so an old account number can never be re-pointed at a new unit.
- Archive, never delete: a landlord needs no active properties; a property needs no active units.
- Caretakers see only properties assigned to them (`property_staff`) and those properties' units;
  agents read everything; managers and owners write.
- Staff validation goes through the identity module's `memberRoles` (injected as `StaffDirectory`).

Every mutation writes an `audit_log` row in the same transaction.
