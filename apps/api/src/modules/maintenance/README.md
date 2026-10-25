# maintenance module

Owns `maintenance_ticket` and `maintenance_update`. Reads units, properties and tenants through
the accounts and leasing modules. Records repair costs through the short-stay module's expense
register (ADR-001).

- **Who:** caretakers report, note, photograph and move tickets to in progress or resolved, but
  only on properties assigned to them; anything else answers 404. Agents and above edit fields
  (priority, assignee, cost) and close or cancel.
- **Status:** `open ↔ in_progress → resolved → closed`. A resolved ticket can be reopened;
  open/in-progress tickets can be cancelled; closed and cancelled are final.
- **Cost → expense:** while a ticket is resolved or closed with a cost above zero it has exactly
  one `repair` expense (`unit_expense.maintenance_ticket_id` is unique). Changing the cost
  replaces it; reopening removes it. The expense cannot be deleted from the expense API.
- **Photos:** keys from `POST /v1/uploads` (purpose `maintenance_photo`), checked against the
  org's prefix; reads return short-lived links.
- Numbers come from the org counter (`MT-000001`).
