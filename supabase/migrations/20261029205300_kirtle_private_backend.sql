-- Private server-only schema. Never add this schema to the Data API exposed schemas.
CREATE SCHEMA IF NOT EXISTS kirtle_private;
REVOKE ALL ON SCHEMA kirtle_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS kirtle_private.users (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 username text NOT NULL CHECK (username ~ '^[A-Za-z0-9_]{3,32}$'),
 password_hash text NOT NULL,
 role text NOT NULL CHECK (role IN ('owner','admin')),
 disabled integer NOT NULL DEFAULT 0 CHECK (disabled IN (0,1)),
 created_at bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON kirtle_private.users(lower(username));
CREATE TABLE IF NOT EXISTS kirtle_private.sessions (
 id text PRIMARY KEY, user_id bigint NOT NULL REFERENCES kirtle_private.users(id) ON DELETE CASCADE,
 csrf text NOT NULL, expires_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id ON kirtle_private.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON kirtle_private.sessions(expires_at);
CREATE TABLE IF NOT EXISTS kirtle_private.audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor text NOT NULL, action text NOT NULL, target text NOT NULL, created_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS kirtle_private.limits (key text PRIMARY KEY, count integer NOT NULL, expires_at bigint NOT NULL);
CREATE INDEX IF NOT EXISTS limits_expiry ON kirtle_private.limits(expires_at);
CREATE TABLE IF NOT EXISTS kirtle_private.jobs (
 id text PRIMARY KEY, source text NOT NULL CHECK (source IN ('website','square')),
 external_id text UNIQUE, external_version integer NOT NULL DEFAULT -1,
 external_json text NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(external_json::jsonb)='object'),
 intake_json text NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(intake_json::jsonb)='object'),
 work_json text NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(work_json::jsonb)='object'),
 tasks_json text NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(tasks_json::jsonb)='array'),
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 submission_key text UNIQUE, submission_hash text,
 linked_to text REFERENCES kirtle_private.jobs(id), created_at bigint NOT NULL, updated_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_open_created ON kirtle_private.jobs(created_at DESC) WHERE linked_to IS NULL;
CREATE INDEX IF NOT EXISTS jobs_linked_to ON kirtle_private.jobs(linked_to);
CREATE TABLE IF NOT EXISTS kirtle_private.integration_state (key text PRIMARY KEY,value text NOT NULL);

ALTER TABLE kirtle_private.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE kirtle_private.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kirtle_private.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE kirtle_private.limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE kirtle_private.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE kirtle_private.integration_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA kirtle_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA kirtle_private FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA kirtle_private REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA kirtle_private REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
