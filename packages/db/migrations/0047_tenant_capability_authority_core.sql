-- ============================================================================
-- 0047_tenant_capability_authority_core.sql
-- tenant-capability-authority-core--m01-capability-schema-migration — the
-- STORAGE half of DD-56's single authorization source (Milestone 1 of
-- ap3/features/tenant-routing-authz/PLAN.md). Pinned DDL:
-- docs/features/BE/feature_tenant_routing_authz_tech.md §2 "Target DDL —
-- tenant-capability-authority-core"; seed = §4 AuthZ Action Matrix.
--
-- Three tables:
--   1. tenant_capability_actions      — migration-owned CLOSED registry. No
--      runtime role (app / app_worker / readonly) holds any privilege on it;
--      only this migration writes it. Milestone 2's locked SECURITY DEFINER
--      authorize() is the one planned reader.
--   2. tenant_capability_grants       — tenant-private, expiring, revocable
--      delegation of an owner-grantable action to one person. app may SELECT
--      (tenant_isolation RLS); app has NO INSERT/UPDATE/DELETE — the writer
--      command is the follow-up task tenant-sensitive-capability-grant-lifecycle.
--   3. tenant_capability_grant_audit  — append-only grant/revoke history,
--      immutability by trigger (0022 job_audit_events precedent). Same
--      SELECT-only posture for app.
--
-- Seed: exactly the 17 tenant-scoped action keys (owner answer 2026-09-20,
-- PLAN.md §Owner answers #1). The two PlatformAdmin-only matrix rows (global billing override,
-- freeze/split/relink) resolve through their own services and are
-- deliberately NOT rows here — 'platform_admin_only' stays a legal
-- authority_class value (the pinned DDL CHECK) but no seed row uses it.
--
--   authority_class  | co_admin_default | delegable | keys
--   preset           | true             | false     | session.manage, content.manage,
--                    |                  |           | member.manage_routine, member.ban,
--                    |                  |           | money.read, money.mark_paid, and the
--                    |                  |           | four DD-86 chat.* keys
--   owner_grantable  | false            | true      | money.correct, money.refund,
--                    |                  |           | money.waive_or_void, bank_account.manage,
--                    |                  |           | connector.secret_manage, billing.manage
--   owner_only       | false            | false     | role.manage
--
-- Additive to the pinned DDL (authored-contract design decision, BE spec §5
-- test #25 storage half): the database itself rejects a grant row for a
-- non-delegable action (role.manage and every preset key). A CHECK cannot
-- reference another table, so a BEFORE INSERT OR UPDATE trigger
-- forbid_non_delegable_capability_grant() raises check_violation when the
-- registry row's delegable IS DISTINCT FROM true. BEFORE triggers fire ahead
-- of the FK check, so an unknown action_key (no registry row, NULL delegable)
-- is rejected here first; the FK stays as the second line of defense.
--
-- Same-tenant integrity: the audit row's (tenant_id, grant_id) is a composite
-- FK to the grant's (tenant_id, id) — DD-68 / 0019 pattern, added inline
-- because both tables are new and empty.
--
-- CHECK constraints are named (table-prefixed _chk convention, 0025/AP-37) so
-- schema.ts can declare them and the CND regression guard stays green.
--
-- Scope fence (M2/M3 own these): no authorize() function, no SECURITY
-- DEFINER reader, no TS wrapper, no route change. Forward-only; every object
-- here is new.
-- ============================================================================

-- ---- 1. tenant_capability_actions (closed registry) -----------------------
CREATE TABLE tenant_capability_actions (
  action_key text PRIMARY KEY,
  co_admin_default boolean NOT NULL,
  delegable boolean NOT NULL,
  authority_class text NOT NULL
    CONSTRAINT tenant_capability_actions_authority_class_chk
    CHECK (authority_class IN ('preset', 'owner_grantable', 'owner_only', 'platform_admin_only')),
  -- The two flags are derived from the class, so the non-delegable trigger (reads delegable) and a
  -- future reader of authority_class can never disagree about whether a key is grantable.
  CONSTRAINT tenant_capability_actions_class_flags_chk
    CHECK (delegable = (authority_class = 'owner_grantable')
           AND co_admin_default = (authority_class = 'preset'))
);
REVOKE ALL ON tenant_capability_actions FROM PUBLIC, app, app_worker, readonly;

INSERT INTO tenant_capability_actions (action_key, co_admin_default, delegable, authority_class) VALUES
  -- co-admin preset (DD-56 matrix)
  ('session.manage',               true,  false, 'preset'),
  ('content.manage',               true,  false, 'preset'),
  ('member.manage_routine',        true,  false, 'preset'),
  ('member.ban',                   true,  false, 'preset'),
  ('money.read',                   true,  false, 'preset'),
  ('money.mark_paid',              true,  false, 'preset'),
  -- DD-86 Chat keys (preset)
  ('chat.channel.manage',          true,  false, 'preset'),
  ('chat.channel.post_restricted', true,  false, 'preset'),
  ('chat.message.moderate',        true,  false, 'preset'),
  ('chat.member.mute',             true,  false, 'preset'),
  -- owner-grantable sensitive actions (explicit, expiring, audited grant)
  ('money.correct',                false, true,  'owner_grantable'),
  ('money.refund',                 false, true,  'owner_grantable'),
  ('money.waive_or_void',          false, true,  'owner_grantable'),
  ('bank_account.manage',          false, true,  'owner_grantable'),
  ('connector.secret_manage',      false, true,  'owner_grantable'),
  ('billing.manage',               false, true,  'owner_grantable'),
  -- tenant-owner only, never delegable
  ('role.manage',                  false, false, 'owner_only');

-- ---- 2. tenant_capability_grants -------------------------------------------
CREATE TABLE tenant_capability_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  grantee_person_id uuid NOT NULL REFERENCES persons(id),
  action_key text NOT NULL REFERENCES tenant_capability_actions(action_key),
  reason text NOT NULL,
  granted_by_person_id uuid NOT NULL REFERENCES persons(id),
  granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT tenant_capability_grants_expiry_chk CHECK (expires_at > granted_at),
  -- timestamptz accepts 'infinity' / '-infinity', and 'infinity' > any finite granted_at, so the
  -- ordering CHECK alone lets an "expiring" grant never expire. Both ends must be real instants.
  CONSTRAINT tenant_capability_grants_finite_chk CHECK (isfinite(granted_at) AND isfinite(expires_at)),
  -- target of the audit table's same-tenant composite FK (DD-68 / 0019 pattern)
  CONSTRAINT tenant_capability_grants_tenant_id_candidate_key UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX idx_tenant_capability_grants_active
  ON tenant_capability_grants(tenant_id, grantee_person_id, action_key)
  WHERE revoked_at IS NULL;

ALTER TABLE tenant_capability_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_capability_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_capability_grants
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
REVOKE ALL ON tenant_capability_grants FROM PUBLIC, app_worker, readonly;
REVOKE INSERT, UPDATE, DELETE ON tenant_capability_grants FROM app;
GRANT SELECT ON tenant_capability_grants TO app;

-- Non-delegable storage rejection (BE spec §5 test #25, storage half).
-- SECURITY INVOKER: no runtime role can write this table yet, and a caller
-- without SELECT on the registry fails with permission denied, which is also
-- a rejection. The grant-lifecycle follow-up decides its own writer identity.
CREATE FUNCTION forbid_non_delegable_capability_grant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (SELECT a.delegable FROM tenant_capability_actions a WHERE a.action_key = NEW.action_key)
       IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'capability % is non-delegable and cannot be granted', NEW.action_key
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION forbid_non_delegable_capability_grant() FROM PUBLIC;
CREATE TRIGGER trg_tenant_capability_grants_delegable
  BEFORE INSERT OR UPDATE ON tenant_capability_grants
  FOR EACH ROW EXECUTE FUNCTION forbid_non_delegable_capability_grant();

-- ---- 3. tenant_capability_grant_audit (append-only) -----------------------
CREATE TABLE tenant_capability_grant_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  grant_id uuid NOT NULL REFERENCES tenant_capability_grants(id),
  action text NOT NULL
    CONSTRAINT tenant_capability_grant_audit_action_chk CHECK (action IN ('grant', 'revoke')),
  actor_person_id uuid NOT NULL REFERENCES persons(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- DD-68 / 0019 pattern: FK checks are not RLS-filtered, so without this an
  -- audit row in tenant A could point at tenant B's grant.
  CONSTRAINT tenant_capability_grant_audit_tenant_grant_fk
    FOREIGN KEY (tenant_id, grant_id) REFERENCES tenant_capability_grants (tenant_id, id)
);
CREATE INDEX idx_tenant_capability_grant_audit_grant ON tenant_capability_grant_audit(grant_id);

ALTER TABLE tenant_capability_grant_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_capability_grant_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_capability_grant_audit
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
REVOKE ALL ON tenant_capability_grant_audit FROM PUBLIC, app_worker, readonly;
REVOKE INSERT, UPDATE, DELETE ON tenant_capability_grant_audit FROM app;
GRANT SELECT ON tenant_capability_grant_audit TO app;

CREATE OR REPLACE FUNCTION forbid_tenant_capability_grant_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'tenant_capability_grant_audit is append-only (% blocked)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER trg_tenant_capability_grant_audit_immutable
  BEFORE UPDATE OR DELETE ON tenant_capability_grant_audit
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_capability_grant_audit_mutation();
