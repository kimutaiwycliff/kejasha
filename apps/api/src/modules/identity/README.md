# identity module

Owns: sign-up/sign-in (email + password, phone OTP), sessions, organizations, `org_profile`,
members, invitations. Wraps Better Auth (`@kejasha/auth`, ADR-004) — clients only see the contract
routes under `/v1/identity`, `/v1/orgs`, `/v1/org`, `/v1/members`, `/v1/invitations`.

Tables: Better Auth's `user, session, account, verification, organization, member, invitation`
(platform tables, owner pool) and `org_profile` (tenant table, RLS).

Rules enforced here:

- Only owners change roles; managers may invite/remove managers, agents and caretakers.
- The last owner cannot be demoted or removed; nobody removes themselves.
- Phone invitations target the user's placeholder email (`<digits>@phone.invalid`), so accepting
  after an OTP sign-in works with Better Auth's email check.
- Org creation is compensated: if the tenant-side bootstrap fails, the Better Auth org is deleted.

Events: `notifications.email` (invitation, password reset), `notifications.sms` (invitation).
Hooks it runs: `orgCreated` (accounts creates the self client landlord), `memberRemoved`
(accounts drops property assignments).
