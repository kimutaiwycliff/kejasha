-- migrate:up
-- Double-entry ledger (ADR-006). Signed bigint cents: debit +, credit −. Append-only.

CREATE TABLE ledger_account (
  id         uuid        PRIMARY KEY,
  org_id     uuid        NOT NULL REFERENCES organization(id),
  kind       text        NOT NULL CHECK (kind IN (
               'lease_receivable', 'lease_deposit',
               'income_rent', 'income_service_charge', 'income_garbage', 'income_water',
               'income_electricity', 'income_security', 'income_late_fee', 'income_deposit_deductions',
               'income_other', 'deposit_refund_payable')),
  lease_id   uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, lease_id) REFERENCES lease (org_id, id),
  CHECK ((kind IN ('lease_receivable', 'lease_deposit')) = (lease_id IS NOT NULL))
);
CREATE UNIQUE INDEX ledger_account_org_kind ON ledger_account (org_id, kind) WHERE lease_id IS NULL;
CREATE UNIQUE INDEX ledger_account_lease_kind ON ledger_account (lease_id, kind) WHERE lease_id IS NOT NULL;
SELECT app.enable_tenant_rls('public.ledger_account');

CREATE TABLE ledger_entry (
  id                uuid        PRIMARY KEY,
  org_id            uuid        NOT NULL,
  -- Business date (Africa/Nairobi) the event belongs to; recorded_at is when it was written.
  occurred_on       date        NOT NULL,
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  source            text        NOT NULL CHECK (source IN (
                      'invoice', 'invoice_void', 'credit_note', 'deposit_settlement', 'payment',
                      'payment_reversal', 'adjustment')),
  source_id         uuid,
  lease_id          uuid,
  unit_id           uuid,
  memo              text,
  idempotency_key   text        NOT NULL,
  reverses_entry_id uuid,
  created_by        uuid,
  UNIQUE (org_id, id),
  UNIQUE (org_id, idempotency_key),
  FOREIGN KEY (org_id, lease_id) REFERENCES lease (org_id, id),
  FOREIGN KEY (org_id, reverses_entry_id) REFERENCES ledger_entry (org_id, id)
);
CREATE INDEX ledger_entry_lease_idx ON ledger_entry (org_id, lease_id, occurred_on);
SELECT app.enable_tenant_rls('public.ledger_entry');

CREATE TABLE ledger_posting (
  id           uuid   PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid   NOT NULL,
  entry_id     uuid   NOT NULL,
  account_id   uuid   NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents <> 0),
  FOREIGN KEY (org_id, entry_id) REFERENCES ledger_entry (org_id, id),
  FOREIGN KEY (org_id, account_id) REFERENCES ledger_account (org_id, id)
);
CREATE INDEX ledger_posting_account_idx ON ledger_posting (account_id);
CREATE INDEX ledger_posting_entry_idx ON ledger_posting (entry_id);
SELECT app.enable_tenant_rls('public.ledger_posting');

-- Every entry's postings must sum to zero, with at least two legs — checked at commit.
CREATE FUNCTION app.ledger_check_balanced() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  total bigint;
  legs  integer;
BEGIN
  SELECT coalesce(sum(amount_cents), 0), count(*) INTO total, legs
    FROM ledger_posting WHERE entry_id = NEW.entry_id;
  IF total <> 0 OR legs < 2 THEN
    RAISE EXCEPTION 'ledger entry % is unbalanced (sum %, legs %)', NEW.entry_id, total, legs
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ledger_entry_balanced';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER ledger_posting_balanced
  AFTER INSERT ON ledger_posting
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.ledger_check_balanced();

-- Append-only: corrections are reversing entries, never edits.
CREATE FUNCTION app.ledger_append_only() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege'; END $$;
CREATE TRIGGER ledger_entry_append_only BEFORE UPDATE OR DELETE ON ledger_entry
  FOR EACH ROW EXECUTE FUNCTION app.ledger_append_only();
CREATE TRIGGER ledger_posting_append_only BEFORE UPDATE OR DELETE ON ledger_posting
  FOR EACH ROW EXECUTE FUNCTION app.ledger_append_only();
CREATE TRIGGER ledger_account_append_only BEFORE UPDATE OR DELETE ON ledger_account
  FOR EACH ROW EXECUTE FUNCTION app.ledger_append_only();
REVOKE UPDATE, DELETE, TRUNCATE ON ledger_account, ledger_entry, ledger_posting FROM app_authenticated;

-- Derived balances; security_invoker so RLS of the caller applies.
CREATE VIEW ledger_account_balance WITH (security_invoker = true) AS
  SELECT a.id AS account_id, a.org_id, a.kind, a.lease_id,
         coalesce(sum(p.amount_cents), 0)::bigint AS balance_cents
    FROM ledger_account a
    LEFT JOIN ledger_posting p ON p.account_id = a.id
   GROUP BY a.id;

-- migrate:down
DROP VIEW ledger_account_balance;
DROP TABLE ledger_posting;
DROP TABLE ledger_entry;
DROP TABLE ledger_account;
DROP FUNCTION app.ledger_append_only();
DROP FUNCTION app.ledger_check_balanced();
