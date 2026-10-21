-- migrate:up
-- Payments & reconciliation (B3, ADR-008/009). We record and reconcile; we never hold money.

-- Money received into the landlord's own channel (asset). Matched payments: Dr collections / Cr receivable.
ALTER TABLE ledger_account DROP CONSTRAINT ledger_account_kind_check;
ALTER TABLE ledger_account ADD CONSTRAINT ledger_account_kind_check CHECK (kind IN (
  'lease_receivable', 'lease_deposit',
  'income_rent', 'income_service_charge', 'income_garbage', 'income_water',
  'income_electricity', 'income_security', 'income_late_fee', 'income_deposit_deductions',
  'income_other', 'deposit_refund_payable', 'collections'));

CREATE TABLE payment_channel (
  id                      uuid        PRIMARY KEY,
  org_id                  uuid        NOT NULL REFERENCES organization(id),
  -- Agencies may run one channel per client landlord; auto-matching then stays inside that landlord.
  client_landlord_id      uuid,
  kind                    text        NOT NULL CHECK (kind IN ('paybill', 'till', 'phone')),
  -- Paybill / Till number, or the E.164 number for a personal M-Pesa line.
  shortcode               text        NOT NULL,
  display_name            text        NOT NULL,
  status                  text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  -- Opaque 256-bit token used in Daraja callback URLs instead of any internal id (ADR-008).
  channel_token           text        NOT NULL UNIQUE,
  daraja_env              text        NOT NULL DEFAULT 'sandbox' CHECK (daraja_env IN ('sandbox', 'production')),
  -- Envelope-encrypted Daraja credentials: per-record data key wrapped by CREDENTIALS_MASTER_KEY.
  credentials_key_version smallint,
  credentials_wrapped_key bytea,
  credentials_ciphertext  bytea,
  credentials_updated_at  timestamptz,
  c2b_registered_at       timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, client_landlord_id) REFERENCES client_landlord (org_id, id),
  CHECK ((credentials_ciphertext IS NULL) = (credentials_wrapped_key IS NULL)),
  CHECK (kind <> 'phone' OR shortcode ~ '^\+254[17][0-9]{8}$'),
  CHECK (kind = 'phone' OR shortcode ~ '^[0-9]{5,8}$')
);
CREATE UNIQUE INDEX payment_channel_org_shortcode ON payment_channel (org_id, kind, shortcode);
SELECT app.enable_tenant_rls('public.payment_channel');
CREATE TRIGGER payment_channel_touch BEFORE UPDATE ON payment_channel FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE statement_import (
  id              uuid        PRIMARY KEY,
  org_id          uuid        NOT NULL,
  channel_id      uuid,
  file_key        text        NOT NULL,
  file_name       text,
  format          text        NOT NULL CHECK (format IN ('mpesa_business_csv', 'mpesa_statement_pdf')),
  status          text        NOT NULL CHECK (status IN ('parsed', 'failed')),
  rows_total      integer     NOT NULL DEFAULT 0,
  rows_credits    integer     NOT NULL DEFAULT 0,
  rows_new        integer     NOT NULL DEFAULT 0,
  rows_duplicate  integer     NOT NULL DEFAULT 0,
  rows_matched    integer     NOT NULL DEFAULT 0,
  period_from     date,
  period_to       date,
  error           text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, channel_id) REFERENCES payment_channel (org_id, id)
);
SELECT app.enable_tenant_rls('public.statement_import');

CREATE TABLE payment (
  id               uuid        PRIMARY KEY,
  org_id           uuid        NOT NULL,
  channel_id       uuid,
  source           text        NOT NULL CHECK (source IN ('c2b', 'stk', 'statement_import', 'sms', 'manual')),
  method           text        NOT NULL DEFAULT 'mpesa' CHECK (method IN ('mpesa', 'cash', 'bank', 'other')),
  -- M-Pesa transaction code (or manual reference). One payment per transaction (ADR-008).
  provider_ref     text        NOT NULL,
  amount_cents     bigint      NOT NULL CHECK (amount_cents > 0),
  paid_at          timestamptz NOT NULL,
  msisdn           text,
  payer_name       text,
  account_ref      text,
  raw              jsonb,
  import_id        uuid,
  match_status     text        NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched', 'matched', 'ignored')),
  match_method     text        CHECK (match_method IN ('auto_account', 'auto_phone', 'manual')),
  lease_id         uuid,
  matched_by       uuid,
  matched_at       timestamptz,
  ledger_entry_id  uuid,
  receipt_number   text,
  receipt_file_key text,
  ignore_reason    text,
  notes            text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, provider_ref),
  UNIQUE (org_id, receipt_number),
  FOREIGN KEY (org_id, channel_id) REFERENCES payment_channel (org_id, id),
  FOREIGN KEY (org_id, lease_id) REFERENCES lease (org_id, id),
  FOREIGN KEY (org_id, import_id) REFERENCES statement_import (org_id, id),
  FOREIGN KEY (org_id, ledger_entry_id) REFERENCES ledger_entry (org_id, id),
  CHECK ((match_status = 'matched') = (lease_id IS NOT NULL AND ledger_entry_id IS NOT NULL)),
  CHECK ((match_status = 'ignored') = (ignore_reason IS NOT NULL))
);
CREATE INDEX payment_status_idx ON payment (org_id, match_status, paid_at DESC);
CREATE INDEX payment_lease_idx ON payment (org_id, lease_id);
SELECT app.enable_tenant_rls('public.payment');
CREATE TRIGGER payment_touch BEFORE UPDATE ON payment FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Every Daraja callback, stored raw before processing (audit + replay).
CREATE TABLE payment_callback (
  id           uuid        PRIMARY KEY,
  org_id       uuid        NOT NULL,
  channel_id   uuid        NOT NULL,
  kind         text        NOT NULL CHECK (kind IN ('c2b_validation', 'c2b_confirmation', 'stk_result')),
  body         jsonb       NOT NULL,
  source_ip    text,
  received_at  timestamptz NOT NULL DEFAULT now(),
  outcome      text,
  payment_id   uuid,
  FOREIGN KEY (org_id, channel_id) REFERENCES payment_channel (org_id, id)
);
CREATE INDEX payment_callback_channel_idx ON payment_callback (org_id, channel_id, received_at DESC);
SELECT app.enable_tenant_rls('public.payment_callback');

CREATE TABLE stk_request (
  id                  uuid        PRIMARY KEY,
  org_id              uuid        NOT NULL,
  channel_id          uuid        NOT NULL,
  lease_id            uuid,
  invoice_id          uuid,
  msisdn              text        NOT NULL CHECK (msisdn ~ '^\+254[17][0-9]{8}$'),
  amount_cents        bigint      NOT NULL CHECK (amount_cents > 0 AND amount_cents % 100 = 0),
  account_ref         text        NOT NULL,
  merchant_request_id text,
  checkout_request_id text        UNIQUE,
  status              text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled', 'timeout')),
  result_code         text,
  result_desc         text,
  payment_id          uuid,
  requested_by        uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, channel_id) REFERENCES payment_channel (org_id, id),
  FOREIGN KEY (org_id, lease_id) REFERENCES lease (org_id, id),
  FOREIGN KEY (org_id, invoice_id) REFERENCES invoice (org_id, id),
  FOREIGN KEY (org_id, payment_id) REFERENCES payment (org_id, id)
);
CREATE INDEX stk_request_pending_idx ON stk_request (org_id, created_at) WHERE status = 'pending';
SELECT app.enable_tenant_rls('public.stk_request');
CREATE TRIGGER stk_request_touch BEFORE UPDATE ON stk_request FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- migrate:down
DROP TABLE stk_request;
DROP TABLE payment_callback;
DROP TABLE payment;
DROP TABLE statement_import;
DROP TABLE payment_channel;
ALTER TABLE ledger_account DROP CONSTRAINT ledger_account_kind_check;
ALTER TABLE ledger_account ADD CONSTRAINT ledger_account_kind_check CHECK (kind IN (
  'lease_receivable', 'lease_deposit',
  'income_rent', 'income_service_charge', 'income_garbage', 'income_water',
  'income_electricity', 'income_security', 'income_late_fee', 'income_deposit_deductions',
  'income_other', 'deposit_refund_payable'));
