-- migrate:up
-- B5: maintenance, cash collections, MRI filings, licences, viewer scopes, reporting views.

-- ── Maintenance ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE maintenance_ticket (
  id               uuid        PRIMARY KEY,
  org_id           uuid        NOT NULL,
  number           text        NOT NULL,
  property_id      uuid        NOT NULL,
  unit_id          uuid,
  title            text        NOT NULL CHECK (length(trim(title)) > 0),
  description      text,
  category         text        NOT NULL CHECK (category IN ('plumbing', 'electrical', 'structural', 'appliance', 'pest', 'cleaning', 'security', 'other')),
  priority         text        NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status           text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed', 'cancelled')),
  reporter_kind    text        NOT NULL CHECK (reporter_kind IN ('staff', 'caretaker', 'tenant')),
  reported_by      uuid,
  tenant_id        uuid,
  assignee_user_id uuid,
  assignee_name    text,
  cost_cents       bigint      CHECK (cost_cents >= 0),
  resolved_at      timestamptz,
  closed_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, number),
  FOREIGN KEY (org_id, property_id) REFERENCES property (org_id, id),
  FOREIGN KEY (org_id, unit_id) REFERENCES unit (org_id, id),
  FOREIGN KEY (org_id, tenant_id) REFERENCES tenant (org_id, id)
);
CREATE INDEX maintenance_ticket_status_idx ON maintenance_ticket (org_id, status, created_at);
CREATE INDEX maintenance_ticket_property_idx ON maintenance_ticket (org_id, property_id);
SELECT app.enable_tenant_rls('public.maintenance_ticket');
CREATE TRIGGER maintenance_ticket_touch BEFORE UPDATE ON maintenance_ticket
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE maintenance_update (
  id          uuid        PRIMARY KEY,
  org_id      uuid        NOT NULL,
  ticket_id   uuid        NOT NULL,
  author_id   uuid,
  note        text,
  status_from text,
  status_to   text,
  photo_keys  text[]      NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, ticket_id) REFERENCES maintenance_ticket (org_id, id)
);
CREATE INDEX maintenance_update_ticket_idx ON maintenance_update (org_id, ticket_id, created_at);
SELECT app.enable_tenant_rls('public.maintenance_update');

-- The expense register covers every unit and whole properties (common areas).
ALTER TABLE unit_expense ADD COLUMN property_id uuid;
UPDATE unit_expense e SET property_id = u.property_id FROM unit u WHERE u.id = e.unit_id;
ALTER TABLE unit_expense ALTER COLUMN property_id SET NOT NULL;
ALTER TABLE unit_expense ALTER COLUMN unit_id DROP NOT NULL;
ALTER TABLE unit_expense ADD FOREIGN KEY (org_id, property_id) REFERENCES property (org_id, id);
ALTER TABLE unit_expense ADD COLUMN maintenance_ticket_id uuid UNIQUE;
ALTER TABLE unit_expense ADD FOREIGN KEY (org_id, maintenance_ticket_id) REFERENCES maintenance_ticket (org_id, id);
CREATE INDEX unit_expense_property_date_idx ON unit_expense (org_id, property_id, incurred_on);

-- ── Cash collected by caretakers (ledger only once confirmed) ───────────────────────────────
CREATE TABLE cash_collection (
  id            uuid        PRIMARY KEY,
  org_id        uuid        NOT NULL,
  lease_id      uuid,
  booking_id    uuid,
  amount_cents  bigint      NOT NULL CHECK (amount_cents > 0),
  received_on   date        NOT NULL,
  payer_name    text,
  note          text,
  receipt_key   text,
  status        text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  submitted_by  uuid        NOT NULL,
  decided_by    uuid,
  decided_at    timestamptz,
  reject_reason text,
  payment_id    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, lease_id) REFERENCES lease (org_id, id),
  FOREIGN KEY (org_id, booking_id) REFERENCES booking (org_id, id),
  FOREIGN KEY (org_id, payment_id) REFERENCES payment (org_id, id),
  CHECK ((lease_id IS NOT NULL) <> (booking_id IS NOT NULL)),
  CHECK ((status = 'confirmed') = (payment_id IS NOT NULL)),
  CHECK ((status = 'rejected') = (reject_reason IS NOT NULL))
);
CREATE INDEX cash_collection_status_idx ON cash_collection (org_id, status, created_at);
SELECT app.enable_tenant_rls('public.cash_collection');

-- ── Compliance ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE mri_filing (
  id                 uuid        PRIMARY KEY,
  org_id             uuid        NOT NULL,
  client_landlord_id uuid        NOT NULL,
  period             date        NOT NULL CHECK (extract(day FROM period) = 1),
  rent_cents         bigint      NOT NULL CHECK (rent_cents >= 0),
  tax_cents          bigint      NOT NULL CHECK (tax_cents >= 0),
  filed_on           date        NOT NULL,
  kra_reference      text,
  details            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  filed_by           uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, client_landlord_id, period),
  FOREIGN KEY (org_id, client_landlord_id) REFERENCES client_landlord (org_id, id)
);
SELECT app.enable_tenant_rls('public.mri_filing');

CREATE TABLE licence (
  id           uuid        PRIMARY KEY,
  org_id       uuid        NOT NULL,
  property_id  uuid        NOT NULL,
  unit_id      uuid,
  kind         text        NOT NULL CHECK (kind IN ('tra_short_stay', 'county_business_permit', 'other')),
  number       text,
  issuer       text,
  issued_on    date,
  expires_on   date        NOT NULL,
  fee_cents    bigint      CHECK (fee_cents >= 0),
  document_key text,
  notes        text,
  archived_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, property_id) REFERENCES property (org_id, id),
  FOREIGN KEY (org_id, unit_id) REFERENCES unit (org_id, id),
  CHECK (issued_on IS NULL OR issued_on <= expires_on)
);
CREATE INDEX licence_expiry_idx ON licence (org_id, expires_on) WHERE archived_at IS NULL;
SELECT app.enable_tenant_rls('public.licence');
CREATE TRIGGER licence_touch BEFORE UPDATE ON licence
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ── Viewer scope (diaspora owners of an agency's client landlord) ───────────────────────────
CREATE TABLE member_scope (
  org_id             uuid        NOT NULL,
  user_id            uuid        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  client_landlord_id uuid        NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id),
  FOREIGN KEY (org_id, client_landlord_id) REFERENCES client_landlord (org_id, id)
);
SELECT app.enable_tenant_rls('public.member_scope');

-- ── Reporting (owned by the reporting module; RLS applies through security_invoker) ──────────
-- Money that reached a landlord's channel: the collections leg of every payment entry and of
-- its reversal, with the unit's property and landlord.
CREATE VIEW report_collection_entry WITH (security_invoker = true) AS
SELECT e.org_id,
       e.id            AS entry_id,
       e.occurred_on,
       e.source,
       e.source_id     AS payment_id,
       e.lease_id,
       e.booking_id,
       e.unit_id,
       u.property_id,
       p.client_landlord_id,
       lp.amount_cents
  FROM ledger_entry e
  JOIN ledger_posting lp ON lp.entry_id = e.id
  JOIN ledger_account la ON la.id = lp.account_id AND la.kind = 'collections'
  JOIN unit u ON u.id = e.unit_id
  JOIN property p ON p.id = u.property_id
 WHERE e.source IN ('payment', 'payment_reversal');
REVOKE INSERT, UPDATE, DELETE ON report_collection_entry FROM app_authenticated;

-- migrate:down
DROP VIEW report_collection_entry;
DROP TABLE member_scope;
DROP TABLE licence;
DROP TABLE mri_filing;
DROP TABLE cash_collection;
DROP INDEX unit_expense_property_date_idx;
ALTER TABLE unit_expense DROP COLUMN maintenance_ticket_id;
DELETE FROM unit_expense WHERE unit_id IS NULL;
ALTER TABLE unit_expense ALTER COLUMN unit_id SET NOT NULL;
ALTER TABLE unit_expense DROP COLUMN property_id;
DROP TABLE maintenance_update;
DROP TABLE maintenance_ticket;
