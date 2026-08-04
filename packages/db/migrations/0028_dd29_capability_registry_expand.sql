-- ============================================================================
-- 0028_dd29_capability_registry_expand.sql
-- DD-29 capability registry — EXPAND half of an expand→contract pair (see
-- 0029_dd29_capability_registry_contract.sql for the narrowing half).
--
-- Source: docs/autopilot-plans-dd29-capability-registry.md (CODE_READY v1.1) ·
--         docs/autopilot-manifests/plans-dd29-capability-registry.json ·
--         docs/features/BE/feature_billing_lifecycle_tech.md §2/§4b (v2.10, Reviewed).
--
-- Moves plans.plan_key from the live 4-tier CHECK
-- ('free_web','telegram','plus_channel','all_channels') to DD-29's 2-tier
-- ('free','host_pro'), reshapes plans.entitlements to the nested
-- {"capabilities": {...}} shape, reseeds, repoints tenant_provision()'s write
-- path and every free_web subscriptions row (the only tier this migration
-- ever auto-migrates — see guard 3 below: a subscription still on telegram/
-- plus_channel/all_channels aborts the whole transaction instead of being
-- repointed). Runs as ONE transaction (migrate.ts wraps each file in
-- BEGIN…COMMIT/ROLLBACK) in this order:
--   1. widen plans_key_chk (union of old ∪ new values — a CHECK applies to
--      every row, so the new rows below need it widened before they can
--      insert, and free_web rows need it widened until they have been
--      repointed, below);
--   2. insert the two new plans rows (idempotent, ON CONFLICT DO NOTHING);
--   3. redefine tenant_provision() so every NEW tenant created from this
--      point on gets 'free', not 'free_web' — same transaction as step 2, so
--      there is no window where a concurrent tenant_provision() call could
--      insert against a plan_key that doesn't exist yet;
--   4. fail-loud guards, then the data migration UPDATE.
--
-- Why the guards are load-bearing, not defensive boilerplate: this session's
-- live-truth read found zero application code anywhere reading
-- entitlements/capabilities, and no deployment contract yet authored
-- (infra-do-app-vpc-deployment is still status:idea) — strong evidence no
-- live paying tenant exists on an old tier. But a document's belief about
-- live data is exactly the kind of thing that goes stale silently the moment
-- it stops being true, and nothing announces that change. So instead of
-- assuming "only free_web/telegram/plus_channel/all_channels at version 1
-- ever exist, and none of the three old PAID tiers has any row at all", the
-- three guards below make all three assumptions CHECKED PROPERTIES: guard 1
-- refuses to proceed if any subscriptions row references a plan_key outside
-- the known old∪new set; guard 2 refuses the "only v1 ever seeded"
-- assumption unless it actually holds on THIS database; guard 3 refuses to
-- collapse ANY subscription still on an old channel tier (telegram/
-- plus_channel/all_channels, any status) into host_pro — a business policy
-- decision this migration deliberately does not make, because the UPDATE
-- irreversibly destroys which of the three tiers a row held regardless of
-- its current status (see guard 3's own comment; this correction was found
-- by codex review across gate-attempt-02/03 — guards 1/2 alone cannot
-- express it). Any guard firing rolls back this whole file (RAISE EXCEPTION
-- inside a DO block aborts the migration's transaction) and stops the run
-- for owner review — never widen the map, invent a repricing policy, or
-- retry blindly (see manifest stop_conditions).
--
-- Rollback (conditional — safe only if committed and no new-key row has been
-- created downstream since): revert tenant_provision() to the old literal,
-- reverse the UPDATE below for only the rows this migration touched, delete
-- the 2 new plans rows, narrow plans_key_chk back to the 4 old values.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Widen plans_key_chk: union of old ∪ new values. Postgres has no
-- in-place CHECK-predicate ALTER — DROP + ADD is required. plans is a small
-- shared catalog table (a handful of rows total), so the re-validation
-- ADD CONSTRAINT performs is cheap, unlike the money-path tables 0025 had to
-- reason carefully about.
-- ---------------------------------------------------------------------------
ALTER TABLE plans DROP CONSTRAINT plans_key_chk;
ALTER TABLE plans ADD CONSTRAINT plans_key_chk
  CHECK (plan_key IN ('free_web','telegram','plus_channel','all_channels','free','host_pro'));

-- ---------------------------------------------------------------------------
-- 2. Insert the two new catalog rows. Literals transcribed verbatim from
-- feature_billing_lifecycle_tech.md:68-81 (Reviewed) — not re-derived.
-- ---------------------------------------------------------------------------
INSERT INTO plans (plan_key, version, price, limits, entitlements) VALUES
  ('free', 1, 0,
     '{"max_clubs": 2, "ai_monthly_question_cap": 0}',
     '{"capabilities": {"web_app": true, "bot_zalo": true, "bot_messenger": true,
        "session_management": true, "discovery_marketplace": true,
        "payment_mark_manual": true, "payment_reconcile_auto": false,
        "reminders_manual": true, "reminders_auto": false,
        "assistant_ai_kb": false, "crm_dashboard": false}}'),
  ('host_pro', 1, 250000,
     '{"max_clubs": null, "ai_monthly_question_cap": 2000}',
     '{"capabilities": {"web_app": true, "bot_zalo": true, "bot_messenger": true,
        "session_management": true, "discovery_marketplace": true,
        "payment_mark_manual": true, "payment_reconcile_auto": true,
        "reminders_manual": true, "reminders_auto": true,
        "assistant_ai_kb": true, "crm_dashboard": true}}')
ON CONFLICT (plan_key, version) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Redefine tenant_provision() — identical body to 0012_auth_functions.sql
-- (never edit that file directly; it is already applied), changing only the
-- literal on the subscriptions INSERT from 'free_web' to 'free'. Ownership
-- and grants are not reset by CREATE OR REPLACE FUNCTION with an unchanged
-- signature, but this repo's own precedent (0022 redefining 0010's
-- claim_outbox_batch) re-states REVOKE/GRANT on every redefinition, so this
-- follows the same convention rather than relying on that implicit behavior.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tenant_provision(
  p_slug text, p_name text, p_timezone text, p_locale text, p_person_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_owned boolean;
BEGIN
  IF p_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' THEN
    RAISE EXCEPTION 'tenant_provision: invalid slug' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF trim(coalesce(p_name, '')) = '' THEN
    RAISE EXCEPTION 'tenant_provision: name required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ATOMIC create-or-lookup: ON CONFLICT waits for a concurrent inserter's
  -- transaction to finish, so the reselect below always sees the committed
  -- winner (two same-owner tabs both get the tenant id, never a false 409).
  INSERT INTO tenants(name, slug, status, locale, timezone)
  VALUES (trim(p_name), p_slug, 'active', coalesce(p_locale, 'vi'),
          coalesce(p_timezone, 'Asia/Ho_Chi_Minh'))
  ON CONFLICT (slug) DO NOTHING
  RETURNING id INTO v_tenant;

  IF v_tenant IS NULL THEN
    SELECT id INTO v_tenant FROM tenants WHERE slug = p_slug;
    -- idempotent ONLY for the web OWNER/ADMIN of that tenant — a mere member
    -- re-submitting the slug must get SLUG_TAKEN, not the tenant id.
    SELECT EXISTS (
      SELECT 1 FROM tenant_admins ta
      WHERE ta.tenant_id = v_tenant
        AND ta.platform = 'web'
        AND ta.platform_user_lookup_hash = p_person_id::text
        AND ta.role IN ('owner','admin')
        AND ta.active
    ) INTO v_owned;
    IF v_owned THEN
      RETURN v_tenant; -- idempotent re-submit by the same owner
    END IF;
    RAISE EXCEPTION 'tenant_provision: slug taken' USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO memberships(tenant_id, person_id, status)
  VALUES (v_tenant, p_person_id, 'active');

  -- Web owner authz row. platform_user_lookup_hash carries the INTERNAL person
  -- uuid for platform='web' (not platform PII — nothing to hash).
  INSERT INTO tenant_admins(tenant_id, platform, platform_user_lookup_hash, role)
  VALUES (v_tenant, 'web', p_person_id::text, 'owner');

  -- FREE plan: active immediately, no trial, no period end in practice.
  -- DD-29: plan_key 'free' (was 'free_web' — see 0028 header).
  INSERT INTO subscriptions(tenant_id, plan_key, plan_version, status,
                            period_start, period_end)
  VALUES (v_tenant, 'free', 1, 'active', now(), 'infinity');

  INSERT INTO onboarding_runs(tenant_id, status) VALUES (v_tenant, 'in_progress');

  RETURN v_tenant;
END;
$$;
REVOKE ALL ON FUNCTION tenant_provision(text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_provision(text,text,text,text,uuid) TO app;

-- ---------------------------------------------------------------------------
-- 4. Fail-loud guards, then data-migrate — in this order. See header for why
-- these are checked properties, not defensive boilerplate.
--
-- subscriptions carries ENABLE + FORCE ROW LEVEL SECURITY (0009), keyed on the
-- app.tenant_id GUC (fail-closed: missing GUC -> NULL -> matches nothing).
-- FORCE removes even the normal table-OWNER exemption, so a plain SELECT/
-- UPDATE here under a connection with no app.tenant_id set — true for the
-- migration role whenever it is not also a superuser/BYPASSRLS — would
-- silently see ZERO rows across every tenant and let a real anomaly (or the
-- entire data migration below) pass as a no-op success. This is the exact
-- class of hazard 0024_public_visibility_capacity_check.sql already hit and
-- documented for `sessions` (that migration's own "RLS trap" comment, closed
-- there via VALIDATE CONSTRAINT's RLS-immune scan). Guards 1/2 and the UPDATE
-- below need an actual row count / actual affected rows across ALL tenants,
-- not just a boolean, so the guard here is a straight toggle instead:
-- NO FORCE ROW LEVEL SECURITY restores the owner exemption for the scope of
-- this transaction only (ALTER TABLE ... FORCE/NO FORCE requires only table
-- ownership — every table here was created by this same migration role — no
-- BYPASSRLS/superuser attribute needed), then FORCE is restored before this
-- transaction commits. Both toggles run inside the one transaction migrate.ts
-- wraps this whole file in, so a concurrent session only ever observes the
-- fully-committed FORCE-ON state, never a relaxed window, and any failure
-- below rolls the toggle back too — there is no path that leaves RLS relaxed
-- outside this migration's own transaction.
-- ---------------------------------------------------------------------------
ALTER TABLE subscriptions NO FORCE ROW LEVEL SECURITY;

-- guard 1: refuse to proceed if any row is outside the known old∪new set
DO $$ DECLARE v_bad integer; BEGIN
  SELECT count(*) INTO v_bad FROM subscriptions
    WHERE plan_key NOT IN ('free_web','telegram','plus_channel','all_channels','free','host_pro');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'DD-29 expand: % subscriptions row(s) reference an unrecognized plan_key', v_bad
      USING ERRCODE = 'data_exception';
  END IF;
END $$;

-- guard 2: refuse the "only v1 ever existed" assumption unless it actually holds on THIS database
DO $$ DECLARE v_bad_version integer; BEGIN
  SELECT count(*) INTO v_bad_version FROM subscriptions
    WHERE plan_key IN ('free_web','telegram','plus_channel','all_channels') AND plan_version <> 1;
  IF v_bad_version > 0 THEN
    RAISE EXCEPTION 'DD-29 expand: % subscriptions row(s) sit on an old plan_key at version <> 1 — the CASE mapping below only handles v1', v_bad_version
      USING ERRCODE = 'data_exception';
  END IF;
END $$;

-- guard 3: refuse to silently collapse ANY subscription on an old, distinctly-
-- priced channel tier (telegram=79k, plus_channel=159k, all_channels=199k) into
-- host_pro (250k) with full automation capabilities it never purchased —
-- REGARDLESS OF STATUS. Guards 1/2 above are pure data-integrity checks
-- (unrecognized value, wrong version) — neither one, by its own predicate, can
-- ever fire for a row on a RECOGNIZED old key at version 1, which is exactly the
-- shape of a real tenant on one of these tiers. This manifest's negative_scope is
-- explicit: "if the live pre-flight finds a paying tenant on an old paid tier,
-- STOP and escalate (AWAIT_FOUNDER), do not invent proration/notification/
-- legacy-price logic" — guard 3 is the mechanism that actually enforces that,
-- correcting a gap in this slice's own authoring: the CODE_READY contract's
-- STOP_CONDITIONS text described this check as something "a guard-1 hit" would
-- carry, but guard 1's predicate cannot express it.
--
-- Status is NOT filtered (widened from an earlier active/past_due-only version
-- — codex round-02 review, gate-attempt-03 [P1]): the UPDATE below overwrites
-- plan_key, irreversibly destroying which of the three tiers a row came from —
-- this loss applies to EVERY row on these keys, not just ones currently being
-- billed. A trialing tenant can convert to active later; a suspended tenant can
-- pay its balance and reactivate — either would then be priced/entitled as
-- host_pro instead of the tier it actually held, with no way to reconstruct the
-- original afterward (the rollback note below cannot recover data this UPDATE
-- already overwrote). free_web is still excluded: it maps to 'free' at the same
-- price (0), so there is no identity/re-pricing question for it at all.
DO $$ DECLARE v_legacy_paid integer; BEGIN
  SELECT count(*) INTO v_legacy_paid FROM subscriptions
    WHERE plan_key IN ('telegram','plus_channel','all_channels');
  IF v_legacy_paid > 0 THEN
    RAISE EXCEPTION 'DD-29 expand: % subscriptions row(s) still reference an old, distinctly-priced channel tier (telegram/plus_channel/all_channels) — collapsing any of them into host_pro would irreversibly destroy which tier they held and silently change price/capabilities regardless of current status. This is a grandfather-vs-reprice policy decision this migration deliberately does not make; STOP and escalate to the owner', v_legacy_paid
      USING ERRCODE = 'data_exception';
  END IF;
END $$;

-- data migrate: free_web -> free (explicit, DD-29 changelog); telegram /
-- plus_channel / all_channels -> host_pro (derived — DD-29 collapses 4 tiers
-- into exactly one paid tier, so no third destination value exists for any
-- of the three to map to instead).
UPDATE subscriptions SET
  plan_key = CASE plan_key
    WHEN 'free_web' THEN 'free'
    WHEN 'telegram' THEN 'host_pro'
    WHEN 'plus_channel' THEN 'host_pro'
    WHEN 'all_channels' THEN 'host_pro'
    ELSE plan_key END,
  plan_version = 1
WHERE plan_key IN ('free_web','telegram','plus_channel','all_channels');

ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
