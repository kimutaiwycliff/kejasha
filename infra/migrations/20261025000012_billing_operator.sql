-- migrate:up
-- B6b: Kejasha's own SaaS billing (never rent — ADR-008) and platform operators.

-- Prices are data (operator-editable). No free tier (owner decision 2026-10-25).
CREATE TABLE plan (
  code                 text        PRIMARY KEY CHECK (code IN ('landlord', 'host', 'agency')),
  name                 text        NOT NULL,
  base_cents           bigint      NOT NULL DEFAULT 0 CHECK (base_cents >= 0),
  unit_price_cents     bigint      NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0),
  listing_price_cents  bigint      NOT NULL DEFAULT 0 CHECK (listing_price_cents >= 0),
  minimum_cents        bigint      NOT NULL DEFAULT 0 CHECK (minimum_cents >= 0),
  white_label          boolean     NOT NULL DEFAULT false,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
INSERT INTO plan (code, name, base_cents, unit_price_cents, listing_price_cents, minimum_cents, white_label) VALUES
  ('landlord', 'Landlord', 0, 10000, 50000, 50000, false),
  ('host', 'Host', 0, 10000, 50000, 50000, false),
  ('agency', 'Agency', 300000, 7000, 50000, 300000, true);
REVOKE ALL ON plan FROM app_authenticated;

CREATE TABLE subscription (
  org_id                    uuid        PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
  plan_code                 text        NOT NULL REFERENCES plan(code),
  status                    text        NOT NULL DEFAULT 'incomplete'
                                        CHECK (status IN ('incomplete', 'trialing', 'active', 'past_due', 'suspended', 'cancelled')),
  trial_ends_on             date,
  current_period_start      date,
  current_period_end        date,
  billing_email             text,
  paystack_customer_code    text,
  -- A reusable card authorization charges the customer: envelope-encrypted like Daraja secrets.
  authorization_ciphertext  bytea,
  card_brand                text,
  card_last4                text,
  past_due_since            date,
  cancelled_at              timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'trialing' OR trial_ends_on IS NOT NULL),
  CHECK (current_period_end IS NULL OR current_period_start <= current_period_end)
);
SELECT app.enable_tenant_rls('public.subscription');
CREATE TRIGGER subscription_touch BEFORE UPDATE ON subscription FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
-- Orgs that exist before billing launches start active for one month.
INSERT INTO subscription (org_id, plan_code, status, current_period_start, current_period_end)
SELECT id, CASE kind WHEN 'agency' THEN 'agency' WHEN 'host' THEN 'host' ELSE 'landlord' END,
       'active', current_date, current_date + 30
  FROM organization;

CREATE TABLE subscription_invoice (
  id                 uuid        PRIMARY KEY,
  org_id             uuid        NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  number             text        NOT NULL,
  plan_code          text        NOT NULL REFERENCES plan(code),
  period_start       date        NOT NULL,
  period_end         date        NOT NULL,
  units              integer     NOT NULL CHECK (units >= 0),
  listings           integer     NOT NULL CHECK (listings >= 0),
  amount_cents       bigint      NOT NULL CHECK (amount_cents > 0),
  status             text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'void')),
  reference          text        NOT NULL UNIQUE,
  attempts           integer     NOT NULL DEFAULT 0,
  last_attempt_at    timestamptz,
  paid_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, number),
  CHECK (period_start <= period_end),
  CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);
-- One live invoice per org and period (the renewal job is idempotent).
CREATE UNIQUE INDEX subscription_invoice_one_per_period ON subscription_invoice (org_id, period_start) WHERE status <> 'void';
SELECT app.enable_tenant_rls('public.subscription_invoice');
CREATE TRIGGER subscription_invoice_touch BEFORE UPDATE ON subscription_invoice FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE subscription_payment (
  id            uuid        PRIMARY KEY,
  org_id        uuid        NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  invoice_id    uuid        NOT NULL,
  reference     text        NOT NULL UNIQUE,
  amount_cents  bigint      NOT NULL CHECK (amount_cents > 0),
  channel       text,
  paid_at       timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, invoice_id) REFERENCES subscription_invoice (org_id, id)
);
SELECT app.enable_tenant_rls('public.subscription_payment');

-- Raw Paystack webhooks, stored before processing (platform table: the org is known only after parsing).
CREATE TABLE paystack_event (
  id           uuid        PRIMARY KEY,
  event        text        NOT NULL,
  reference    text,
  body         jsonb       NOT NULL,
  signature_ok boolean     NOT NULL,
  outcome      text,
  received_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX paystack_event_reference_idx ON paystack_event (reference);
REVOKE ALL ON paystack_event FROM app_authenticated;

-- Kejasha platform staff (not an org role). Granted with `make operator-grant EMAIL=…`.
CREATE TABLE platform_operator (
  user_id    uuid        PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  note       text,
  granted_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON platform_operator FROM app_authenticated;

-- Every operator request, reads included (cross-tenant access is always accounted for).
CREATE TABLE operator_access_log (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid        NOT NULL,
  method      text        NOT NULL,
  route       text        NOT NULL,
  target_org  uuid,
  request_id  text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operator_access_log_org_idx ON operator_access_log (target_org, occurred_at DESC);
REVOKE ALL ON operator_access_log FROM app_authenticated;

-- migrate:down
DROP TABLE IF EXISTS operator_access_log;
DROP TABLE platform_operator;
DROP TABLE paystack_event;
DROP TABLE subscription_payment;
DROP TABLE subscription_invoice;
DROP TABLE subscription;
DROP TABLE plan;
