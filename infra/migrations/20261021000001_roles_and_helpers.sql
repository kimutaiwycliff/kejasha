-- migrate:up
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- app_authenticated: the API's tenant role. RLS always applies to it (ADR-003).
-- LOGIN + password are set by infra (compose init script / ops), never in migrations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_authenticated') THEN
    CREATE ROLE app_authenticated NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO app_authenticated;
GRANT USAGE ON SCHEMA public TO app_authenticated;

-- Tenant context, set per transaction by withTenant() via set_config(..., is_local => true).
CREATE FUNCTION app.current_org_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;

CREATE FUNCTION app.current_user_id() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;

GRANT EXECUTE ON FUNCTION app.current_org_id(), app.current_user_id() TO app_authenticated;

-- Standard tenant isolation: enable + FORCE RLS and add the org_id policy.
-- Every tenant table calls this in its migration: SELECT app.enable_tenant_rls('public.x');
CREATE FUNCTION app.enable_tenant_rls(tbl regclass) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s FOR ALL TO app_authenticated
       USING (org_id = app.current_org_id())
       WITH CHECK (org_id = app.current_org_id())',
    tbl);
END
$$;

-- Tables created by the migration owner are usable by the tenant role (RLS still applies).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_authenticated;

-- migrate:down
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM app_authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM app_authenticated;
DROP FUNCTION app.enable_tenant_rls(regclass);
DROP FUNCTION app.current_user_id();
DROP FUNCTION app.current_org_id();
DROP SCHEMA app;
