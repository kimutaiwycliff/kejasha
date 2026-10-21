-- migrate:up
-- Accounts / portfolio (ADR-005). Child rows reference parents by (org_id, id) so a row can
-- never point into another org, independent of RLS.

CREATE FUNCTION app.touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE TABLE org_profile (
  org_id     uuid        PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
  kra_pin    text        CHECK (kra_pin ~ '^[AP][0-9]{9}[A-Z]$'),
  phone      text        CHECK (phone ~ '^\+254[17][0-9]{8}$'),
  email      text,
  county     text,
  branding   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
SELECT app.enable_tenant_rls('public.org_profile');
CREATE TRIGGER org_profile_touch BEFORE UPDATE ON org_profile
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE client_landlord (
  id                  uuid        PRIMARY KEY,
  org_id              uuid        NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  is_self             boolean     NOT NULL DEFAULT false,
  name                text        NOT NULL CHECK (length(trim(name)) > 0),
  phone               text        CHECK (phone ~ '^\+254[17][0-9]{8}$'),
  email               text,
  kra_pin             text        CHECK (kra_pin ~ '^[AP][0-9]{9}[A-Z]$'),
  mgmt_fee_kind       text        NOT NULL DEFAULT 'none' CHECK (mgmt_fee_kind IN ('none', 'percent', 'flat')),
  mgmt_fee_bps        integer     CHECK (mgmt_fee_bps BETWEEN 0 AND 10000),
  mgmt_fee_flat_cents bigint      CHECK (mgmt_fee_flat_cents >= 0),
  notes               text,
  archived_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  CHECK (
    (mgmt_fee_kind = 'none'    AND mgmt_fee_bps IS NULL     AND mgmt_fee_flat_cents IS NULL) OR
    (mgmt_fee_kind = 'percent' AND mgmt_fee_bps IS NOT NULL AND mgmt_fee_flat_cents IS NULL) OR
    (mgmt_fee_kind = 'flat'    AND mgmt_fee_bps IS NULL     AND mgmt_fee_flat_cents IS NOT NULL)
  ),
  CHECK (NOT (is_self AND archived_at IS NOT NULL))
);
CREATE UNIQUE INDEX client_landlord_one_self ON client_landlord (org_id) WHERE is_self;
CREATE INDEX client_landlord_org_name_idx ON client_landlord (org_id, lower(name), id);
SELECT app.enable_tenant_rls('public.client_landlord');
CREATE TRIGGER client_landlord_touch BEFORE UPDATE ON client_landlord
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE property (
  id                 uuid          PRIMARY KEY,
  org_id             uuid          NOT NULL,
  client_landlord_id uuid          NOT NULL,
  name               text          NOT NULL CHECK (length(trim(name)) > 0),
  kind               text          NOT NULL CHECK (kind IN ('residential', 'commercial', 'mixed')),
  county             text          NOT NULL,
  area               text,
  address            text,
  latitude           numeric(9, 6) CHECK (latitude BETWEEN -90 AND 90),
  longitude          numeric(9, 6) CHECK (longitude BETWEEN -180 AND 180),
  notes              text,
  archived_at        timestamptz,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, client_landlord_id) REFERENCES client_landlord (org_id, id)
);
CREATE INDEX property_org_name_idx ON property (org_id, lower(name), id);
CREATE INDEX property_client_landlord_idx ON property (org_id, client_landlord_id);
SELECT app.enable_tenant_rls('public.property');
CREATE TRIGGER property_touch BEFORE UPDATE ON property
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE unit (
  id                 uuid        PRIMARY KEY,
  org_id             uuid        NOT NULL,
  property_id        uuid        NOT NULL,
  -- Paybill account number for this unit (ADR-008): normalised uppercase, ≤ 12 chars.
  code               text        NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{0,11}$'),
  label              text,
  mode               text        NOT NULL CHECK (mode IN ('long_term', 'short_stay')),
  status             text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  bedrooms           smallint    CHECK (bedrooms BETWEEN 0 AND 50),
  bathrooms          smallint    CHECK (bathrooms BETWEEN 0 AND 50),
  floor              text,
  size_sqm           integer     CHECK (size_sqm > 0),
  rent_cents         bigint      CHECK (rent_cents >= 0),
  deposit_cents      bigint      CHECK (deposit_cents >= 0),
  base_nightly_cents bigint      CHECK (base_nightly_cents >= 0),
  max_guests         smallint    CHECK (max_guests > 0),
  notes              text,
  archived_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, code),
  FOREIGN KEY (org_id, property_id) REFERENCES property (org_id, id),
  CHECK (mode <> 'long_term' OR rent_cents IS NOT NULL),
  CHECK (mode <> 'short_stay' OR base_nightly_cents IS NOT NULL)
);
CREATE INDEX unit_property_code_idx ON unit (org_id, property_id, code);
SELECT app.enable_tenant_rls('public.unit');
CREATE TRIGGER unit_touch BEFORE UPDATE ON unit
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Which staff (typically caretakers) work at which property.
CREATE TABLE property_staff (
  org_id      uuid        NOT NULL,
  property_id uuid        NOT NULL,
  user_id     uuid        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, user_id),
  FOREIGN KEY (org_id, property_id) REFERENCES property (org_id, id) ON DELETE CASCADE
);
CREATE INDEX property_staff_user_idx ON property_staff (org_id, user_id);
SELECT app.enable_tenant_rls('public.property_staff');

-- migrate:down
DROP TABLE property_staff;
DROP TABLE unit;
DROP TABLE property;
DROP TABLE client_landlord;
DROP TABLE org_profile;
DROP FUNCTION app.touch_updated_at();
