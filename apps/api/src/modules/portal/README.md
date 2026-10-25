# portal module (tenant portal)

Owns no tables. A tenant is any signed-in user whose **verified** phone (phone OTP sign-in) matches
non-archived `tenant` records; one person can rent from several landlords on Kejasha.

- Records are found with leasing's `tenantRecordsByPhone` (cross-org, owner role, exact phone).
  Every read and write after that runs inside the lease's org through the normal services:
  statement (leasing views), STK pay (payments: the landlord's own channel, to the tenant's own
  phone), receipt PDF, tickets (`reporterKind: tenant`).
- A lease is reachable only when its tenant record carries the caller's phone; anything else is
  404, and cancelled tenancies are hidden. An unverified or email-only user sees no tenancies.
- Photo uploads for tenant tickets are a follow-up (uploads are an org route today).
