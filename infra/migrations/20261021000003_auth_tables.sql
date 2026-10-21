-- migrate:up
-- Better Auth tables (ADR-004). Platform tables: accessed only through the owner pool by
-- Better Auth itself; the tenant role gets no grants (B0 meta-test enforces this).
-- Column names are snake_case; the Drizzle schema maps Better Auth's camelCase fields.

CREATE TABLE "user" (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text        NOT NULL,
  email                 text        NOT NULL UNIQUE,
  email_verified        boolean     NOT NULL DEFAULT false,
  image                 text,
  phone_number          text        UNIQUE,
  phone_number_verified boolean,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  slug       text        NOT NULL UNIQUE,
  -- Kejasha addition (Better Auth additionalField): drives onboarding defaults (ADR-005).
  kind       text        NOT NULL CHECK (kind IN ('landlord', 'agency', 'host')),
  logo       text,
  metadata   text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE session (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token                    text        NOT NULL UNIQUE,
  expires_at               timestamptz NOT NULL,
  ip_address               text,
  user_agent               text,
  active_organization_id   uuid        REFERENCES organization(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_user_idx ON session (user_id);

CREATE TABLE account (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  account_id               text        NOT NULL,
  provider_id              text        NOT NULL,
  access_token             text,
  refresh_token            text,
  id_token                 text,
  access_token_expires_at  timestamptz,
  refresh_token_expires_at timestamptz,
  scope                    text,
  password                 text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_user_idx ON account (user_id);

CREATE TABLE verification (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text        NOT NULL,
  value      text        NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_identifier_idx ON verification (identifier);

CREATE TABLE member (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role            text        NOT NULL CHECK (role IN ('owner', 'manager', 'agent', 'caretaker')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX member_user_idx ON member (user_id);

CREATE TABLE invitation (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email           text        NOT NULL,
  role            text        CHECK (role IN ('owner', 'manager', 'agent', 'caretaker')),
  status          text        NOT NULL DEFAULT 'pending',
  expires_at      timestamptz NOT NULL,
  inviter_id      uuid        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitation_org_idx ON invitation (organization_id);
CREATE INDEX invitation_email_idx ON invitation (lower(email));

REVOKE ALL ON "user", organization, session, account, verification, member, invitation
  FROM app_authenticated;

-- migrate:down
DROP TABLE invitation;
DROP TABLE member;
DROP TABLE verification;
DROP TABLE account;
DROP TABLE session;
DROP TABLE organization;
DROP TABLE "user";
