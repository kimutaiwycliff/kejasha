-- migrate:up

-- Transactional outbox (ADR-014). Tenant code may only INSERT rows for its own org;
-- the relay (owner role) reads and dispatches.
CREATE TABLE outbox (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        uuid,
  topic         text        NOT NULL,
  payload       jsonb       NOT NULL,
  dedupe_key    text        UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  available_at  timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  attempts      integer     NOT NULL DEFAULT 0,
  last_error    text
);
CREATE INDEX outbox_pending_idx ON outbox (available_at, id) WHERE dispatched_at IS NULL;

ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON outbox FROM app_authenticated;
GRANT INSERT ON outbox TO app_authenticated;
CREATE POLICY tenant_insert ON outbox FOR INSERT TO app_authenticated
  WITH CHECK (org_id = app.current_org_id());

-- Idempotency-Key store (CLAUDE.md §2.8). Platform table, owner role only:
-- the plugin runs outside the request's tenant transaction.
CREATE TABLE idempotency_key (
  scope            text        NOT NULL,
  key              text        NOT NULL,
  method           text        NOT NULL,
  route            text        NOT NULL,
  request_hash     text        NOT NULL,
  status           text        NOT NULL CHECK (status IN ('in_progress', 'completed')),
  response_status  integer,
  response_headers jsonb,
  response_body    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  expires_at       timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (scope, key)
);
CREATE INDEX idempotency_key_expires_idx ON idempotency_key (expires_at);
REVOKE ALL ON idempotency_key FROM app_authenticated;

-- Audit log: append-only, tenant-readable.
CREATE TABLE audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        uuid        NOT NULL,
  actor_kind    text        NOT NULL CHECK (actor_kind IN ('user', 'system', 'operator')),
  actor_user_id text,
  action        text        NOT NULL,
  entity_type   text        NOT NULL,
  entity_id     text,
  diff          jsonb,
  request_id    text,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_time_idx ON audit_log (org_id, occurred_at DESC);
SELECT app.enable_tenant_rls('public.audit_log');
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM app_authenticated;

-- RLS harness probe: the simplest possible tenant table.
CREATE TABLE _rls_probe (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NOT NULL DEFAULT app.current_org_id(),
  label      text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
SELECT app.enable_tenant_rls('public._rls_probe');

-- migrate:down
DROP TABLE _rls_probe;
DROP TABLE audit_log;
DROP TABLE idempotency_key;
DROP TABLE outbox;
