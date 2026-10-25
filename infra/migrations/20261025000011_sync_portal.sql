-- migrate:up
-- B6a: incremental sync needs updated_at on every synced table; the tenant portal finds a
-- tenant's records across orgs by verified phone.

ALTER TABLE meter ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE meter SET updated_at = created_at;
CREATE TRIGGER meter_touch BEFORE UPDATE ON meter FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE meter_reading ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE meter_reading SET updated_at = created_at;
CREATE TRIGGER meter_reading_touch BEFORE UPDATE ON meter_reading FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE maintenance_update ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE maintenance_update SET updated_at = created_at;
CREATE TRIGGER maintenance_update_touch BEFORE UPDATE ON maintenance_update FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE cash_collection ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE cash_collection SET updated_at = created_at;
CREATE TRIGGER cash_collection_touch BEFORE UPDATE ON cash_collection FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Incremental pull: rows changed after a watermark, per org.
CREATE INDEX property_sync_idx ON property (org_id, updated_at);
CREATE INDEX unit_sync_idx ON unit (org_id, updated_at);
CREATE INDEX meter_sync_idx ON meter (org_id, updated_at);
CREATE INDEX meter_reading_sync_idx ON meter_reading (org_id, updated_at);
CREATE INDEX maintenance_ticket_sync_idx ON maintenance_ticket (org_id, updated_at);
CREATE INDEX maintenance_update_sync_idx ON maintenance_update (org_id, updated_at);
CREATE INDEX cash_collection_sync_idx ON cash_collection (org_id, updated_at);
CREATE INDEX tenant_sync_idx ON tenant (org_id, updated_at);
CREATE INDEX lease_sync_idx ON lease (org_id, updated_at);

-- Tenant portal: a signed-in tenant's records in every org, by phone.
CREATE INDEX tenant_phone_idx ON tenant (phone) WHERE phone IS NOT NULL;

-- ── Sync read model (owned by the sync module; RLS applies via security_invoker) ─────────────
-- Each view exposes what a device stores, plus org_id, updated_at, archived and the property the
-- row belongs to (for caretaker scoping).
CREATE VIEW sync_property WITH (security_invoker = true) AS
SELECT org_id, id, id AS property_id, name, kind, county, area, archived_at IS NOT NULL AS archived, updated_at
  FROM property;
CREATE VIEW sync_unit WITH (security_invoker = true) AS
SELECT org_id, id, property_id, code, label, mode, status, bedrooms, archived_at IS NOT NULL AS archived, updated_at
  FROM unit;
CREATE VIEW sync_meter WITH (security_invoker = true) AS
SELECT m.org_id, m.id, u.property_id, m.unit_id, m.kind, m.serial, m.unit_label,
       m.archived_at IS NOT NULL AS archived, m.updated_at
  FROM meter m JOIN unit u ON u.id = m.unit_id;
CREATE VIEW sync_meter_reading WITH (security_invoker = true) AS
SELECT r.org_id, r.id, u.property_id, r.meter_id, r.read_on, r.reading::text AS reading, r.note,
       r.recorded_by, false AS archived, r.updated_at
  FROM meter_reading r JOIN meter m ON m.id = r.meter_id JOIN unit u ON u.id = m.unit_id;
CREATE VIEW sync_ticket WITH (security_invoker = true) AS
SELECT org_id, id, property_id, number, unit_id, title, description, category, priority, status,
       reporter_kind, cost_cents, status IN ('closed', 'cancelled') AS archived, created_at, updated_at
  FROM maintenance_ticket;
CREATE VIEW sync_ticket_update WITH (security_invoker = true) AS
SELECT mu.org_id, mu.id, t.property_id, mu.ticket_id, mu.author_id, mu.note, mu.status_from,
       mu.status_to, mu.photo_keys, false AS archived, mu.created_at, mu.updated_at
  FROM maintenance_update mu JOIN maintenance_ticket t ON t.id = mu.ticket_id;
CREATE VIEW sync_cash_collection WITH (security_invoker = true) AS
SELECT org_id, id, NULL::uuid AS property_id, lease_id, booking_id, amount_cents, received_on,
       payer_name, note, status, reject_reason, submitted_by, false AS archived, created_at, updated_at
  FROM cash_collection;
CREATE VIEW sync_tenant WITH (security_invoker = true) AS
SELECT org_id, id, NULL::uuid AS property_id, full_name, phone, archived_at IS NOT NULL AS archived, updated_at
  FROM tenant;
CREATE VIEW sync_lease WITH (security_invoker = true) AS
SELECT l.org_id, l.id, u.property_id, l.unit_id, l.tenant_id, l.start_date, l.end_date, l.status,
       l.status = 'cancelled' AS archived, l.updated_at
  FROM lease l JOIN unit u ON u.id = l.unit_id;
REVOKE INSERT, UPDATE, DELETE ON sync_property, sync_unit, sync_meter, sync_meter_reading,
  sync_ticket, sync_ticket_update, sync_cash_collection, sync_tenant, sync_lease FROM app_authenticated;

-- migrate:down
DROP VIEW IF EXISTS sync_lease, sync_tenant, sync_cash_collection, sync_ticket_update, sync_ticket,
  sync_meter_reading, sync_meter, sync_unit, sync_property;
DROP INDEX tenant_phone_idx;
DROP INDEX lease_sync_idx;
DROP INDEX tenant_sync_idx;
DROP INDEX cash_collection_sync_idx;
DROP INDEX maintenance_update_sync_idx;
DROP INDEX maintenance_ticket_sync_idx;
DROP INDEX meter_reading_sync_idx;
DROP INDEX meter_sync_idx;
DROP INDEX unit_sync_idx;
DROP INDEX property_sync_idx;
DROP TRIGGER cash_collection_touch ON cash_collection;
ALTER TABLE cash_collection DROP COLUMN updated_at;
DROP TRIGGER maintenance_update_touch ON maintenance_update;
ALTER TABLE maintenance_update DROP COLUMN updated_at;
DROP TRIGGER meter_reading_touch ON meter_reading;
ALTER TABLE meter_reading DROP COLUMN updated_at;
DROP TRIGGER meter_touch ON meter;
ALTER TABLE meter DROP COLUMN updated_at;
