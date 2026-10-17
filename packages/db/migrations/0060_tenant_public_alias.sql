-- ============================================================================
-- 0060_tenant_public_alias.sql
-- The moderated club public alias (DD-114 D3 precondition 4, DD-46 fail-closed): a club sets a
-- public alias (status pending), and ONLY the platform owner moves it to approved or rejected.
-- The public club name will be the approved alias (L10 reads it); tenants.name is never public.
-- This migration adds the substrate only: no projector, no view change, no public read path.
--
-- DECISION TABLE (deny and integrity faults write nothing)
--   set      GUC <> p_tenant_id, or content.manage denied (one message)    42501 insufficient_privilege
--            NULL, or after trim not 1..60 code points / refused / invisible   22023 invalid_parameter_value
--            trimmed text equals the stored one                         stored row, changed=false
--            otherwise: text stored, status pending (clears any approval), one tenant.public_alias_set event
--   read     GUC <> p_tenant_id => 42501; else (alias, status)
--   decide   bad argument => 22023; tenant missing => P0002; no alias, digest <> sha256(UTF-8 text) or
--            status = decision => 55000; else status + one audit row + one tenant.public_alias_<decision> event
--   pending  tenant id, pending text and its digest, ordered by tenant id
--
-- Privileges: app / app_worker / readonly hold ZERO privileges on tenants (0035, 0052) and nothing
-- here grants on tenants or the audit table, so these definers are the only writers of the new
-- columns. set and read: EXECUTE app only. decide and pending: NO grant; the owner path is the
-- migration role (scripts/public-alias-moderate.mjs, DATABASE_URL_MIGRATION, no SET ROLE). The digest
-- binds a decision to the text the owner reviewed. Serialization: the club-config:<tenant> advisory
-- key (club-config.ts) + the tenants row FOR UPDATE. Payload is exactly {"status"}; aggregate
-- 'tenant' has no route yet, so its events ack until L10 adds one. search_path pinned, relations
-- public.-qualified; set's character constants are a byte-identical copy of 0055 (text-safety.ts).
-- ============================================================================

ALTER TABLE tenants
  ADD COLUMN public_alias text,
  ADD COLUMN public_alias_status text,
  ADD CONSTRAINT tenants_public_alias_pair_chk CHECK ((public_alias IS NULL) = (public_alias_status IS NULL)),
  ADD CONSTRAINT tenants_public_alias_len_chk CHECK (public_alias IS NULL OR char_length(public_alias) BETWEEN 1 AND 60),
  ADD CONSTRAINT tenants_public_alias_status_chk
    CHECK (public_alias_status IS NULL OR public_alias_status IN ('pending', 'approved', 'rejected'));

-- One row per owner decision; written only by tenant_public_alias_decide, never updated or deleted.
CREATE TABLE tenant_public_alias_audit (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  decision   text NOT NULL,
  alias      text NOT NULL,
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT tenant_public_alias_audit_decision_chk CHECK (decision IN ('approved', 'rejected')),
  CONSTRAINT tenant_public_alias_audit_alias_len_chk CHECK (char_length(alias) BETWEEN 1 AND 60),
  CONSTRAINT tenant_public_alias_audit_decided_by_chk CHECK (decided_by ~ '^[a-z0-9][a-z0-9._-]{0,31}$')
);
CREATE INDEX idx_tenant_public_alias_audit_tenant ON tenant_public_alias_audit(tenant_id, decided_at);

ALTER TABLE tenant_public_alias_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_public_alias_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_public_alias_audit
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE FUNCTION forbid_tenant_public_alias_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'tenant_public_alias_audit is append-only (% blocked)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER trg_tenant_public_alias_audit_immutable
  BEFORE UPDATE OR DELETE ON tenant_public_alias_audit
  FOR EACH ROW EXECUTE FUNCTION forbid_tenant_public_alias_audit_mutation();

CREATE FUNCTION tenant_public_alias_set(p_tenant_id uuid, p_actor_person_id uuid, p_alias text)
RETURNS TABLE (public_alias text, public_alias_status text, changed boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_ctx     uuid;
  v_allowed boolean;
  v_alias   text;
  v_old     text;
  v_status  text;
  -- ECMAScript WhiteSpace + LineTerminator: exactly the set String.prototype.trim removes.
  c_ws     CONSTANT text := E'\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
  c_space  CONSTANT text := '[' || c_ws || ']';
  -- Cc (U+0000 never reaches a text parameter), Cf, Zl/Zp, the default-ignorable code points that are
  -- not variation selectors, and U+2800; see the header for where each list comes from.
  c_reject CONSTANT text := '['
    || E'\u0001-\u001f\u007f-\u009f'
    || E'\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u180e'
    || E'\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb'
    || E'\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3'
    || E'\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f'
    || E'\u2028\u2029'
    || E'\u034f\u17b4\u17b5\u115f\u1160\u3164\uffa0'
    || E'\u2800'
    || ']';
  -- One code point outside c_ws and Default_Ignorable_Code_Point (all 17 ranges, variation selectors
  -- and unassigned code points included): one that renders as something.
  c_visible CONSTANT text := '[^' || c_ws
    || E'\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e'
    || E'\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufff8'
    || E'\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0000-\U000e0fff'
    || ']';
BEGIN
  BEGIN
    v_ctx := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_ctx := NULL;
  END;
  IF p_tenant_id IS NULL OR v_ctx IS NULL OR p_tenant_id <> v_ctx THEN
    RAISE EXCEPTION 'tenant_public_alias_set: tenant context mismatch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Authorization FIRST (DD-56), one message for every deny reason.
  SELECT a.allowed INTO v_allowed
    FROM public.tenant_capability_authorize(p_tenant_id, 'content.manage', p_actor_person_id) a;
  IF v_allowed IS NOT TRUE THEN
    RAISE EXCEPTION 'tenant_public_alias_set: not permitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_alias IS NULL THEN
    RAISE EXCEPTION 'tenant_public_alias_set: alias is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_alias := regexp_replace(p_alias, '^' || c_space || '+|' || c_space || '+$', '', 'g');
  IF char_length(v_alias) < 1 OR char_length(v_alias) > 60 OR v_alias ~ c_reject
     OR v_alias !~ c_visible THEN
    RAISE EXCEPTION 'tenant_public_alias_set: alias must be 1-60 printable characters'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Same key as club-config.ts (re-entrant when the TS caller already holds it), then the row.
  PERFORM pg_advisory_xact_lock(hashtextextended('club-config:' || p_tenant_id::text, 0));
  SELECT t.public_alias, t.public_alias_status INTO v_old, v_status
    FROM public.tenants t
   WHERE t.id = p_tenant_id
     FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  -- Identical trimmed text is a no-op whatever the status (approved stays approved).
  IF v_old IS NOT DISTINCT FROM v_alias THEN
    RETURN QUERY SELECT v_old, v_status, false;
    RETURN;
  END IF;

  -- A different text always goes back to pending: no club edit keeps an approval.
  UPDATE public.tenants
     SET public_alias = v_alias, public_alias_status = 'pending'
   WHERE id = p_tenant_id;
  INSERT INTO public.outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
  SELECT p_tenant_id, 'tenant', p_tenant_id, coalesce(max(o.sequence), 0) + 1,
         'tenant.public_alias_set', jsonb_build_object('status', 'pending')
    FROM public.outbox_events o
   WHERE o.aggregate_id = p_tenant_id;
  RETURN QUERY SELECT v_alias, 'pending'::text, true;
END;
$$;

-- READ is not an authorization decision (tenant_profile_read posture, 0052): GUC-bound only.
CREATE FUNCTION tenant_public_alias_read(p_tenant_id uuid)
RETURNS TABLE (public_alias text, public_alias_status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_ctx uuid;
BEGIN
  BEGIN
    v_ctx := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_ctx := NULL;
  END;
  IF p_tenant_id IS NULL OR v_ctx IS NULL OR p_tenant_id <> v_ctx THEN
    RAISE EXCEPTION 'tenant_public_alias_read: tenant context mismatch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT t.public_alias, t.public_alias_status
      FROM public.tenants t
     WHERE t.id = p_tenant_id;
END;
$$;

-- Owner-only moderation (no grant): the decision is bound to the digest of the reviewed text.
CREATE FUNCTION tenant_public_alias_decide(
  p_tenant_id uuid,
  p_decision text,
  p_expected_alias_sha256 text,
  p_decided_by text
)
RETURNS TABLE (tenant_id uuid, public_alias_status text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_alias  text;
  v_status text;
  v_prev   text := current_setting('app.tenant_id', true);
BEGIN
  IF p_tenant_id IS NULL OR p_decision IS NULL OR p_expected_alias_sha256 IS NULL
     OR p_decided_by IS NULL
     OR p_decision NOT IN ('approved', 'rejected')
     OR p_expected_alias_sha256 !~ '^[0-9a-f]{64}$'
     OR p_decided_by !~ '^[a-z0-9][a-z0-9._-]{0,31}$' THEN
    RAISE EXCEPTION 'tenant_public_alias_decide: invalid arguments'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('club-config:' || p_tenant_id::text, 0));
  SELECT t.public_alias, t.public_alias_status INTO v_alias, v_status
    FROM public.tenants t
   WHERE t.id = p_tenant_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant_public_alias_decide: tenant not found'
      USING ERRCODE = 'no_data_found';
  END IF;
  -- CAS: the text changed since the owner listed it, or the decision is already in force.
  IF v_alias IS NULL
     OR encode(sha256(convert_to(v_alias, 'UTF8')), 'hex') <> p_expected_alias_sha256
     OR v_status = p_decision THEN
    RAISE EXCEPTION 'tenant_public_alias_decide: alias changed or decision already applied'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  -- FORCE RLS on outbox_events and the audit table binds a NOBYPASSRLS owner too.
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  UPDATE public.tenants
     SET public_alias_status = p_decision
   WHERE id = p_tenant_id;
  INSERT INTO public.tenant_public_alias_audit (tenant_id, decision, alias, decided_by)
  VALUES (p_tenant_id, p_decision, v_alias, p_decided_by);
  INSERT INTO public.outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
  SELECT p_tenant_id, 'tenant', p_tenant_id, coalesce(max(o.sequence), 0) + 1,
         'tenant.public_alias_' || p_decision, jsonb_build_object('status', p_decision)
    FROM public.outbox_events o
   WHERE o.aggregate_id = p_tenant_id;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
  RETURN QUERY SELECT p_tenant_id, p_decision;
END;
$$;

-- Owner-only listing: tenant id, the pending text and its digest; no name, slug, person or host.
CREATE FUNCTION tenant_public_alias_pending()
RETURNS TABLE (tenant_id uuid, public_alias text, alias_sha256 text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT t.id, t.public_alias, encode(sha256(convert_to(t.public_alias, 'UTF8')), 'hex')
    FROM public.tenants t
   WHERE t.public_alias_status = 'pending'
   ORDER BY t.id;
$$;

REVOKE ALL ON FUNCTION public.tenant_public_alias_set(uuid, uuid, text) FROM PUBLIC, app_worker, readonly;
REVOKE ALL ON FUNCTION public.tenant_public_alias_read(uuid) FROM PUBLIC, app_worker, readonly;
REVOKE ALL ON FUNCTION public.tenant_public_alias_decide(uuid, text, text, text) FROM PUBLIC, app, app_worker, readonly;
REVOKE ALL ON FUNCTION public.tenant_public_alias_pending() FROM PUBLIC, app, app_worker, readonly;
GRANT EXECUTE ON FUNCTION public.tenant_public_alias_set(uuid, uuid, text) TO app;
GRANT EXECUTE ON FUNCTION public.tenant_public_alias_read(uuid) TO app;
REVOKE ALL ON TABLE public.tenant_public_alias_audit FROM PUBLIC, app, app_worker, readonly;
