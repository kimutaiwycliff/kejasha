-- migrate:up
-- Leasing (B2). Tenant tables with RLS; children reference parents by (org_id, id).

CREATE TABLE tenant (
  id                uuid        PRIMARY KEY,
  org_id            uuid        NOT NULL REFERENCES organization(id),
  full_name         text        NOT NULL CHECK (length(trim(full_name)) > 0),
  phone             text        CHECK (phone ~ '^\+254[17][0-9]{8}$'),
  email             text,
  national_id       text,
  kra_pin           text        CHECK (kra_pin ~ '^[AP][0-9]{9}[A-Z]$'),
  next_of_kin_name  text,
  next_of_kin_phone text        CHECK (next_of_kin_phone ~ '^\+254[17][0-9]{8}$'),
  notes             text,
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
CREATE INDEX tenant_org_name_idx ON tenant (org_id, lower(full_name), id);
CREATE INDEX tenant_org_phone_idx ON tenant (org_id, phone);
SELECT app.enable_tenant_rls('public.tenant');
CREATE TRIGGER tenant_touch BEFORE UPDATE ON tenant FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE lease (
  id                      uuid        PRIMARY KEY,
  org_id                  uuid        NOT NULL,
  unit_id                 uuid        NOT NULL,
  tenant_id               uuid        NOT NULL,
  start_date              date        NOT NULL,
  -- Inclusive last day of occupancy; NULL = open-ended (periodic tenancy).
  end_date                date,
  during                  daterange   GENERATED ALWAYS AS (daterange(start_date, end_date, '[]')) STORED,
  status                  text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'terminated', 'cancelled')),
  rent_cents              bigint      NOT NULL CHECK (rent_cents >= 0),
  deposit_cents           bigint      NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0),
  billing_day             smallint    NOT NULL CHECK (billing_day BETWEEN 1 AND 31),
  escalation_bps          integer     CHECK (escalation_bps BETWEEN 1 AND 10000),
  escalation_every_months smallint    CHECK (escalation_every_months BETWEEN 1 AND 120),
  late_fee_kind           text        NOT NULL DEFAULT 'none' CHECK (late_fee_kind IN ('none', 'flat', 'percent')),
  late_fee_flat_cents     bigint      CHECK (late_fee_flat_cents > 0),
  late_fee_bps            integer     CHECK (late_fee_bps BETWEEN 1 AND 10000),
  late_fee_grace_days     smallint    NOT NULL DEFAULT 0 CHECK (late_fee_grace_days BETWEEN 0 AND 60),
  notes                   text,
  terminated_at           timestamptz,
  termination_reason      text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, unit_id) REFERENCES unit (org_id, id),
  FOREIGN KEY (org_id, tenant_id) REFERENCES tenant (org_id, id),
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK ((escalation_bps IS NULL) = (escalation_every_months IS NULL)),
  CHECK (
    (late_fee_kind = 'none'    AND late_fee_flat_cents IS NULL     AND late_fee_bps IS NULL) OR
    (late_fee_kind = 'flat'    AND late_fee_flat_cents IS NOT NULL AND late_fee_bps IS NULL) OR
    (late_fee_kind = 'percent' AND late_fee_bps IS NOT NULL        AND late_fee_flat_cents IS NULL)
  ),
  -- ADR-007: a unit can never have two overlapping (non-cancelled) leases.
  CONSTRAINT lease_no_overlap EXCLUDE USING gist (unit_id WITH =, during WITH &&) WHERE (status <> 'cancelled')
);
CREATE INDEX lease_tenant_idx ON lease (org_id, tenant_id);
CREATE INDEX lease_end_idx ON lease (org_id, end_date) WHERE status = 'active';
SELECT app.enable_tenant_rls('public.lease');
CREATE TRIGGER lease_touch BEFORE UPDATE ON lease FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Explicit rent changes (renewals); escalation restarts from the latest step.
CREATE TABLE lease_rent_step (
  org_id           uuid        NOT NULL,
  lease_id         uuid        NOT NULL,
  effective_period date        NOT NULL CHECK (extract(day FROM effective_period) = 1),
  rent_cents       bigint      NOT NULL CHECK (rent_cents >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lease_id, effective_period),
  FOREIGN KEY (org_id, lease_id) REFERENCES lease (org_id, id)
);
SELECT app.enable_tenant_rls('public.lease_rent_step');

CREATE TABLE meter (
  id          uuid        PRIMARY KEY,
  org_id      uuid        NOT NULL,
  unit_id     uuid        NOT NULL,
  kind        text        NOT NULL CHECK (kind IN ('water', 'electricity')),
  serial      text,
  unit_label  text        NOT NULL DEFAULT 'units',
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, unit_id) REFERENCES unit (org_id, id)
);
CREATE UNIQUE INDEX meter_one_active_kind ON meter (unit_id, kind) WHERE archived_at IS NULL;
SELECT app.enable_tenant_rls('public.meter');

CREATE TABLE meter_reading (
  id          uuid          PRIMARY KEY,
  org_id      uuid          NOT NULL,
  meter_id    uuid          NOT NULL,
  read_on     date          NOT NULL,
  reading     numeric(14,3) NOT NULL CHECK (reading >= 0),
  note        text,
  recorded_by uuid,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (meter_id, read_on),
  FOREIGN KEY (org_id, meter_id) REFERENCES meter (org_id, id)
);
SELECT app.enable_tenant_rls('public.meter_reading');

CREATE TABLE charge_rule (
  id               uuid        PRIMARY KEY,
  org_id           uuid        NOT NULL,
  lease_id         uuid        NOT NULL,
  kind             text        NOT NULL CHECK (kind IN ('service_charge', 'garbage', 'water', 'electricity', 'security', 'other')),
  label            text        NOT NULL,
  method           text        NOT NULL CHECK (method IN ('flat', 'metered')),
  amount_cents     bigint      CHECK (amount_cents >= 0),
  unit_price_cents bigint      CHECK (unit_price_cents >= 0),
  meter_id         uuid,
  starts_on        date        NOT NULL,
  ends_on          date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, lease_id) REFERENCES lease (org_id, id),
  FOREIGN KEY (org_id, meter_id) REFERENCES meter (org_id, id),
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CHECK (
    (method = 'flat'    AND amount_cents IS NOT NULL AND unit_price_cents IS NULL AND meter_id IS NULL) OR
    (method = 'metered' AND amount_cents IS NULL AND unit_price_cents IS NOT NULL AND meter_id IS NOT NULL)
  )
);
CREATE INDEX charge_rule_lease_idx ON charge_rule (org_id, lease_id);
SELECT app.enable_tenant_rls('public.charge_rule');
CREATE TRIGGER charge_rule_touch BEFORE UPDATE ON charge_rule FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Per-org sequences (invoice numbers, credit note numbers). Row-locked by UPDATE … RETURNING.
CREATE TABLE org_counter (
  org_id uuid   NOT NULL,
  name   text   NOT NULL,
  value  bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, name)
);
SELECT app.enable_tenant_rls('public.org_counter');

-- migrate:down
DROP TABLE org_counter;
DROP TABLE charge_rule;
DROP TABLE meter_reading;
DROP TABLE meter;
DROP TABLE lease_rent_step;
DROP TABLE lease;
DROP TABLE tenant;
