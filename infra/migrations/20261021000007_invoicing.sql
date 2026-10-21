-- migrate:up
-- Invoices, credit notes, deposit settlements, inspections (B2).

CREATE TABLE invoice (
  id                uuid        PRIMARY KEY,
  org_id            uuid        NOT NULL,
  lease_id          uuid        NOT NULL,
  number            text        NOT NULL,
  kind              text        NOT NULL CHECK (kind IN ('periodic', 'deposit', 'late_fee', 'manual')),
  -- First day of the billed month for periodic invoices.
  period            date        CHECK (period IS NULL OR extract(day FROM period) = 1),
  source_invoice_id uuid,
  issued_on         date        NOT NULL,
  due_on            date        NOT NULL,
  total_cents       bigint      NOT NULL CHECK (total_cents > 0),
  status            text        NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'void')),
  ledger_entry_id   uuid        NOT NULL,
  void_entry_id     uuid,
  voided_at         timestamptz,
  void_reason       text,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, number),
  FOREIGN KEY (org_id, lease_id) REFERENCES lease (org_id, id),
  FOREIGN KEY (org_id, source_invoice_id) REFERENCES invoice (org_id, id),
  FOREIGN KEY (org_id, ledger_entry_id) REFERENCES ledger_entry (org_id, id),
  FOREIGN KEY (org_id, void_entry_id) REFERENCES ledger_entry (org_id, id),
  CHECK ((kind = 'periodic') = (period IS NOT NULL)),
  CHECK ((kind = 'late_fee') = (source_invoice_id IS NOT NULL)),
  CHECK ((status = 'void') = (void_entry_id IS NOT NULL))
);
-- Idempotent billing: one live invoice per (lease, period), per deposit, per late-fee source.
CREATE UNIQUE INDEX invoice_one_periodic ON invoice (lease_id, period) WHERE kind = 'periodic' AND status = 'issued';
CREATE UNIQUE INDEX invoice_one_deposit ON invoice (lease_id) WHERE kind = 'deposit' AND status = 'issued';
CREATE UNIQUE INDEX invoice_one_late_fee ON invoice (source_invoice_id) WHERE kind = 'late_fee' AND status = 'issued';
CREATE INDEX invoice_lease_due_idx ON invoice (org_id, lease_id, due_on);
SELECT app.enable_tenant_rls('public.invoice');

CREATE TABLE invoice_line (
  id               uuid          PRIMARY KEY,
  org_id           uuid          NOT NULL,
  invoice_id       uuid          NOT NULL,
  kind             text          NOT NULL CHECK (kind IN ('rent', 'deposit', 'service_charge', 'garbage', 'water', 'electricity', 'security', 'late_fee', 'other')),
  description      text          NOT NULL,
  quantity         numeric(14,3) NOT NULL DEFAULT 1,
  unit_price_cents bigint,
  amount_cents     bigint        NOT NULL CHECK (amount_cents > 0),
  charge_rule_id   uuid,
  meter_id         uuid,
  reading_from_id  uuid,
  reading_to_id    uuid,
  period_start     date,
  period_end       date,
  FOREIGN KEY (org_id, invoice_id) REFERENCES invoice (org_id, id),
  FOREIGN KEY (org_id, charge_rule_id) REFERENCES charge_rule (org_id, id),
  FOREIGN KEY (org_id, reading_to_id) REFERENCES meter_reading (org_id, id),
  FOREIGN KEY (org_id, reading_from_id) REFERENCES meter_reading (org_id, id)
);
CREATE INDEX invoice_line_invoice_idx ON invoice_line (invoice_id);
CREATE INDEX invoice_line_meter_idx ON invoice_line (org_id, meter_id) WHERE meter_id IS NOT NULL;
SELECT app.enable_tenant_rls('public.invoice_line');

CREATE TABLE credit_note (
  id              uuid        PRIMARY KEY,
  org_id          uuid        NOT NULL,
  lease_id        uuid        NOT NULL,
  invoice_id      uuid,
  number          text        NOT NULL,
  amount_cents    bigint      NOT NULL CHECK (amount_cents > 0),
  reason          text        NOT NULL,
  issued_on       date        NOT NULL,
  ledger_entry_id uuid        NOT NULL,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, number),
  FOREIGN KEY (org_id, lease_id) REFERENCES lease (org_id, id),
  FOREIGN KEY (org_id, invoice_id) REFERENCES invoice (org_id, id),
  FOREIGN KEY (org_id, ledger_entry_id) REFERENCES ledger_entry (org_id, id)
);
SELECT app.enable_tenant_rls('public.credit_note');

CREATE TABLE deposit_settlement (
  id                       uuid        PRIMARY KEY,
  org_id                   uuid        NOT NULL,
  lease_id                 uuid        NOT NULL UNIQUE,
  settled_on               date        NOT NULL,
  deposit_held_cents       bigint      NOT NULL,
  deductions               jsonb       NOT NULL DEFAULT '[]'::jsonb,
  deductions_cents         bigint      NOT NULL CHECK (deductions_cents >= 0),
  applied_to_arrears_cents bigint      NOT NULL CHECK (applied_to_arrears_cents >= 0),
  refund_due_cents         bigint      NOT NULL CHECK (refund_due_cents >= 0),
  ledger_entry_id          uuid        NOT NULL,
  created_by               uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, lease_id) REFERENCES lease (org_id, id),
  FOREIGN KEY (org_id, ledger_entry_id) REFERENCES ledger_entry (org_id, id),
  CHECK (deductions_cents + applied_to_arrears_cents + refund_due_cents = deposit_held_cents)
);
SELECT app.enable_tenant_rls('public.deposit_settlement');

CREATE TABLE lease_inspection (
  id           uuid        PRIMARY KEY,
  org_id       uuid        NOT NULL,
  lease_id     uuid        NOT NULL,
  kind         text        NOT NULL CHECK (kind IN ('move_in', 'move_out')),
  inspected_on date        NOT NULL,
  items        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  notes        text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, lease_id) REFERENCES lease (org_id, id)
);
CREATE INDEX lease_inspection_lease_idx ON lease_inspection (org_id, lease_id);
SELECT app.enable_tenant_rls('public.lease_inspection');

-- migrate:down
DROP TABLE lease_inspection;
DROP TABLE deposit_settlement;
DROP TABLE credit_note;
DROP TABLE invoice_line;
DROP TABLE invoice;
