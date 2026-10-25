# operator module

Kejasha staff console API (`/v1/operator/*`, `auth: 'operator'`). Owns no tenant data; reads
across orgs with the owner role on purpose. Guard rails:

- Only users in `platform_operator` pass (`make operator-grant EMAIL=…`); it is not an org role.
- The auth plugin writes **every** operator request, reads included, to `operator_access_log`
  (user, method, route, target org, request id).
- Changes to an org's subscription are also written to that org's own `audit_log` as
  `actor_kind = operator`, with the operator's note.
- Plan prices are data; edits apply from each org's next invoice.
