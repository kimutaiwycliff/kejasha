-- migrate:up
-- Short-stay (B4, ADR-007/010): rates, guests, bookings, blocks, one occupancy table, iCal, expenses.

CREATE TABLE rate_plan (
  org_id                uuid        NOT NULL,
  unit_id               uuid        PRIMARY KEY,
  base_nightly_cents    bigint      NOT NULL CHECK (base_nightly_cents >= 0),
  weekend_nightly_cents bigint      CHECK (weekend_nightly_cents >= 0),
  min_stay_nights       smallint    NOT NULL DEFAULT 1 CHECK (min_stay_nights BETWEEN 1 AND 365),
  buffer_days           smallint    NOT NULL DEFAULT 0 CHECK (buffer_days BETWEEN 0 AND 14),
  cleaning_fee_cents    bigint      NOT NULL DEFAULT 0 CHECK (cleaning_fee_cents >= 0),
  checkin_instructions  text,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, unit_id) REFERENCES unit (org_id, id)
);
SELECT app.enable_tenant_rls('public.rate_plan');
CREATE TRIGGER rate_plan_touch BEFORE UPDATE ON rate_plan FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE rate_override (
  id              uuid      PRIMARY KEY,
  org_id          uuid      NOT NULL,
  unit_id         uuid      NOT NULL,
  label           text      NOT NULL,
  starts_on       date      NOT NULL,
  ends_on         date      NOT NULL,
  during          daterange GENERATED ALWAYS AS (daterange(starts_on, ends_on, '[)')) STORED,
  nightly_cents   bigint    NOT NULL CHECK (nightly_cents >= 0),
  min_stay_nights smallint  CHECK (min_stay_nights BETWEEN 1 AND 365),
  FOREIGN KEY (org_id, unit_id) REFERENCES unit (org_id, id),
  CHECK (ends_on > starts_on),
  CONSTRAINT rate_override_no_overlap EXCLUDE USING gist (unit_id WITH =, during WITH &&)
);
SELECT app.enable_tenant_rls('public.rate_override');

CREATE TABLE guest (
  id          uuid        PRIMARY KEY,
  org_id      uuid        NOT NULL REFERENCES organization(id),
  full_name   text        NOT NULL CHECK (length(trim(full_name)) > 0),
  phone       text        CHECK (phone ~ '^\+254[17][0-9]{8}$' OR phone ~ '^\+[1-9][0-9]{6,14}$'),
  email       text,
  id_number   text,
  nationality text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
-- Repeat recognition: one guest per phone in an org.
CREATE UNIQUE INDEX guest_org_phone ON guest (org_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX guest_org_name_idx ON guest (org_id, lower(full_name), id);
SELECT app.enable_tenant_rls('public.guest');
CREATE TRIGGER guest_touch BEFORE UPDATE ON guest FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE ical_feed (
  id             uuid        PRIMARY KEY,
  org_id         uuid        NOT NULL,
  unit_id        uuid        NOT NULL,
  source         text        NOT NULL CHECK (source IN ('airbnb', 'booking', 'other')),
  url            text        NOT NULL CHECK (url ~ '^https?://'),
  enabled        boolean     NOT NULL DEFAULT true,
  etag           text,
  last_modified  text,
  last_synced_at timestamptz,
  last_status    text        CHECK (last_status IN ('ok', 'not_modified', 'error')),
  last_error     text,
  -- Events that could not be placed because they overlap existing occupancy (never overwritten).
  conflicts      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, unit_id) REFERENCES unit (org_id, id)
);
SELECT app.enable_tenant_rls('public.ical_feed');

CREATE TABLE booking (
  id                 uuid        PRIMARY KEY,
  org_id             uuid        NOT NULL,
  unit_id            uuid        NOT NULL,
  guest_id           uuid,
  check_in           date        NOT NULL,
  check_out          date        NOT NULL,
  buffer_days        smallint    NOT NULL DEFAULT 0 CHECK (buffer_days BETWEEN 0 AND 14),
  source             text        NOT NULL CHECK (source IN ('direct', 'walk_in', 'whatsapp', 'airbnb', 'booking', 'other')),
  status             text        NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show')),
  guests_count       smallint    NOT NULL DEFAULT 1 CHECK (guests_count BETWEEN 1 AND 100),
  gross_cents        bigint      NOT NULL DEFAULT 0 CHECK (gross_cents >= 0),
  cleaning_fee_cents bigint      NOT NULL DEFAULT 0 CHECK (cleaning_fee_cents >= 0),
  commission_bps     integer     NOT NULL DEFAULT 0 CHECK (commission_bps BETWEEN 0 AND 10000),
  commission_cents   bigint      NOT NULL DEFAULT 0 CHECK (commission_cents >= 0),
  notes              text,
  ical_feed_id       uuid,
  external_uid       text,
  ledger_entry_id    uuid,
  cancelled_at       timestamptz,
  cancel_reason      text,
  checked_in_at      timestamptz,
  checked_out_at     timestamptz,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, unit_id) REFERENCES unit (org_id, id),
  FOREIGN KEY (org_id, guest_id) REFERENCES guest (org_id, id),
  FOREIGN KEY (org_id, ical_feed_id) REFERENCES ical_feed (org_id, id) ON DELETE SET NULL (ical_feed_id),
  FOREIGN KEY (org_id, ledger_entry_id) REFERENCES ledger_entry (org_id, id),
  CHECK (check_out > check_in),
  CHECK (commission_cents <= gross_cents)
);
CREATE UNIQUE INDEX booking_feed_uid ON booking (ical_feed_id, external_uid) WHERE ical_feed_id IS NOT NULL;
CREATE INDEX booking_unit_dates_idx ON booking (org_id, unit_id, check_in);
SELECT app.enable_tenant_rls('public.booking');
CREATE TRIGGER booking_touch BEFORE UPDATE ON booking FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE calendar_block (
  id           uuid        PRIMARY KEY,
  org_id       uuid        NOT NULL,
  unit_id      uuid        NOT NULL,
  starts_on    date        NOT NULL,
  ends_on      date        NOT NULL,
  reason       text        NOT NULL CHECK (reason IN ('owner_use', 'maintenance', 'ical', 'other')),
  note         text,
  ical_feed_id uuid,
  external_uid text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, unit_id) REFERENCES unit (org_id, id),
  FOREIGN KEY (org_id, ical_feed_id) REFERENCES ical_feed (org_id, id) ON DELETE CASCADE,
  CHECK (ends_on > starts_on)
);
CREATE UNIQUE INDEX calendar_block_feed_uid ON calendar_block (ical_feed_id, external_uid) WHERE ical_feed_id IS NOT NULL;
SELECT app.enable_tenant_rls('public.calendar_block');

-- ADR-007: bookings and blocks share one occupancy table; the database refuses any overlap.
CREATE TABLE unit_occupancy (
  id         uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid      NOT NULL,
  unit_id    uuid      NOT NULL,
  during     daterange NOT NULL,
  booking_id uuid      UNIQUE,
  block_id   uuid      UNIQUE,
  FOREIGN KEY (org_id, booking_id) REFERENCES booking (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, block_id) REFERENCES calendar_block (org_id, id) ON DELETE CASCADE,
  CHECK ((booking_id IS NULL) <> (block_id IS NULL)),
  CONSTRAINT unit_occupancy_no_overlap EXCLUDE USING gist (unit_id WITH =, during WITH &&)
);
SELECT app.enable_tenant_rls('public.unit_occupancy');
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON unit_occupancy FROM app_authenticated;

-- SECURITY DEFINER: occupancy is written only by this trigger, never directly by tenants.
-- The booking/block row it mirrors has already passed RLS, so org_id is the caller's own.
CREATE FUNCTION app.sync_booking_occupancy() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM unit_occupancy WHERE booking_id = OLD.id;
    RETURN NULL;
  END IF;
  DELETE FROM unit_occupancy WHERE booking_id = NEW.id;
  IF NEW.status NOT IN ('cancelled', 'no_show') THEN
    INSERT INTO unit_occupancy (org_id, unit_id, during, booking_id)
    VALUES (NEW.org_id, NEW.unit_id, daterange(NEW.check_in, NEW.check_out + NEW.buffer_days, '[)'), NEW.id);
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER booking_occupancy
  AFTER INSERT OR UPDATE OF unit_id, check_in, check_out, buffer_days, status OR DELETE ON booking
  FOR EACH ROW EXECUTE FUNCTION app.sync_booking_occupancy();

-- SECURITY DEFINER: occupancy is written only by this trigger, never directly by tenants.
-- The booking/block row it mirrors has already passed RLS, so org_id is the caller's own.
CREATE FUNCTION app.sync_block_occupancy() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM unit_occupancy WHERE block_id = OLD.id;
    RETURN NULL;
  END IF;
  DELETE FROM unit_occupancy WHERE block_id = NEW.id;
  INSERT INTO unit_occupancy (org_id, unit_id, during, block_id)
  VALUES (NEW.org_id, NEW.unit_id, daterange(NEW.starts_on, NEW.ends_on, '[)'), NEW.id);
  RETURN NULL;
END
$$;
CREATE TRIGGER block_occupancy
  AFTER INSERT OR UPDATE OF unit_id, starts_on, ends_on OR DELETE ON calendar_block
  FOR EACH ROW EXECUTE FUNCTION app.sync_block_occupancy();

CREATE TABLE unit_expense (
  id           uuid        PRIMARY KEY,
  org_id       uuid        NOT NULL,
  unit_id      uuid        NOT NULL,
  booking_id   uuid,
  incurred_on  date        NOT NULL,
  category     text        NOT NULL CHECK (category IN ('tokens', 'wifi', 'cleaning', 'supplies', 'repair', 'licence', 'laundry', 'other')),
  amount_cents bigint      NOT NULL CHECK (amount_cents > 0),
  description  text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, unit_id) REFERENCES unit (org_id, id),
  FOREIGN KEY (org_id, booking_id) REFERENCES booking (org_id, id)
);
CREATE INDEX unit_expense_unit_date_idx ON unit_expense (org_id, unit_id, incurred_on);
SELECT app.enable_tenant_rls('public.unit_expense');

-- Ledger: per-booking receivable + short-stay income; entries can reference a booking.
ALTER TABLE ledger_account ADD COLUMN booking_id uuid;
ALTER TABLE ledger_account ADD FOREIGN KEY (org_id, booking_id) REFERENCES booking (org_id, id);
ALTER TABLE ledger_account DROP CONSTRAINT ledger_account_kind_check;
ALTER TABLE ledger_account ADD CONSTRAINT ledger_account_kind_check CHECK (kind IN (
  'lease_receivable', 'lease_deposit',
  'income_rent', 'income_service_charge', 'income_garbage', 'income_water',
  'income_electricity', 'income_security', 'income_late_fee', 'income_deposit_deductions',
  'income_other', 'deposit_refund_payable', 'collections', 'booking_receivable', 'income_short_stay'));
ALTER TABLE ledger_account DROP CONSTRAINT ledger_account_check;
ALTER TABLE ledger_account ADD CONSTRAINT ledger_account_scope_check CHECK (
  ((kind IN ('lease_receivable', 'lease_deposit')) = (lease_id IS NOT NULL)) AND
  ((kind = 'booking_receivable') = (booking_id IS NOT NULL)));
DROP INDEX ledger_account_org_kind;
CREATE UNIQUE INDEX ledger_account_org_kind ON ledger_account (org_id, kind) WHERE lease_id IS NULL AND booking_id IS NULL;
CREATE UNIQUE INDEX ledger_account_booking_kind ON ledger_account (booking_id, kind) WHERE booking_id IS NOT NULL;

ALTER TABLE ledger_entry ADD COLUMN booking_id uuid;
ALTER TABLE ledger_entry ADD FOREIGN KEY (org_id, booking_id) REFERENCES booking (org_id, id);
ALTER TABLE ledger_entry DROP CONSTRAINT ledger_entry_source_check;
ALTER TABLE ledger_entry ADD CONSTRAINT ledger_entry_source_check CHECK (source IN (
  'invoice', 'invoice_void', 'credit_note', 'deposit_settlement', 'payment', 'payment_reversal',
  'adjustment', 'booking', 'booking_cancellation'));

-- Payments and STK requests can target a booking instead of a lease.
ALTER TABLE payment ADD COLUMN booking_id uuid;
ALTER TABLE payment ADD FOREIGN KEY (org_id, booking_id) REFERENCES booking (org_id, id);
ALTER TABLE payment DROP CONSTRAINT payment_check;
ALTER TABLE payment ADD CONSTRAINT payment_matched_target_check CHECK (
  (match_status = 'matched') = (((lease_id IS NOT NULL) <> (booking_id IS NOT NULL)) AND ledger_entry_id IS NOT NULL));
ALTER TABLE stk_request ADD COLUMN booking_id uuid;
ALTER TABLE stk_request ADD FOREIGN KEY (org_id, booking_id) REFERENCES booking (org_id, id);

-- migrate:down
ALTER TABLE stk_request DROP COLUMN booking_id;
ALTER TABLE payment DROP CONSTRAINT payment_matched_target_check;
ALTER TABLE payment DROP COLUMN booking_id;
ALTER TABLE payment ADD CONSTRAINT payment_check CHECK ((match_status = 'matched') = (lease_id IS NOT NULL AND ledger_entry_id IS NOT NULL));
ALTER TABLE ledger_entry DROP CONSTRAINT ledger_entry_source_check;
ALTER TABLE ledger_entry ADD CONSTRAINT ledger_entry_source_check CHECK (source IN (
  'invoice', 'invoice_void', 'credit_note', 'deposit_settlement', 'payment', 'payment_reversal', 'adjustment'));
ALTER TABLE ledger_entry DROP COLUMN booking_id;
DROP INDEX ledger_account_booking_kind;
DROP INDEX ledger_account_org_kind;
CREATE UNIQUE INDEX ledger_account_org_kind ON ledger_account (org_id, kind) WHERE lease_id IS NULL;
ALTER TABLE ledger_account DROP CONSTRAINT ledger_account_scope_check;
ALTER TABLE ledger_account ADD CONSTRAINT ledger_account_check CHECK ((kind IN ('lease_receivable', 'lease_deposit')) = (lease_id IS NOT NULL));
ALTER TABLE ledger_account DROP CONSTRAINT ledger_account_kind_check;
ALTER TABLE ledger_account ADD CONSTRAINT ledger_account_kind_check CHECK (kind IN (
  'lease_receivable', 'lease_deposit',
  'income_rent', 'income_service_charge', 'income_garbage', 'income_water',
  'income_electricity', 'income_security', 'income_late_fee', 'income_deposit_deductions',
  'income_other', 'deposit_refund_payable', 'collections'));
ALTER TABLE ledger_account DROP COLUMN booking_id;
DROP TABLE unit_expense;
DROP TABLE unit_occupancy;
DROP FUNCTION app.sync_block_occupancy() CASCADE;
DROP FUNCTION app.sync_booking_occupancy() CASCADE;
DROP TABLE calendar_block;
DROP TABLE booking;
DROP TABLE ical_feed;
DROP TABLE guest;
DROP TABLE rate_override;
DROP TABLE rate_plan;
