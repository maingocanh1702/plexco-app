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
--   1. lock subscriptions FIRST, before touching plans at all (codex round-05
--      [P1], gate-attempt-08 — see the dedicated note below: this ordering
--      is what prevents a deadlock against concurrent tenant_provision());
--   2. widen plans_key_chk (union of old ∪ new values — a CHECK applies to
--      every row, so the new rows below need it widened before they can
--      insert, and free_web rows need it widened until they have been
--      repointed, below);
--   3. insert the two new plans rows (idempotent, ON CONFLICT DO NOTHING);
--   4. verify both target rows — whether just inserted or pre-existing —
--      exactly match the canonical DD-29 shape (codex round-07 [P1],
--      gate-attempt-01 on this registration): ON CONFLICT DO NOTHING silently
--      keeps a pre-existing row as-is, so a stray free@1/host_pro@1 row with
--      the wrong price/limits/capabilities would otherwise become canonical
--      without anyone noticing;
--   5. redefine tenant_provision() so every NEW tenant created from this
--      point on gets 'free', not 'free_web' — same transaction as step 3, so
--      there is no window where a concurrent tenant_provision() call could
--      insert against a plan_key that doesn't exist yet;
--   6. fail-loud guards, then the data migration UPDATE.
--
-- Lock ordering vs. concurrent tenant_provision() (codex round-05 [P1],
-- gate-attempt-08): tenant_provision() is a live, SECURITY DEFINER write path
-- (apps/web's POST /api/onboarding/start) that, in its one INSERT INTO
-- subscriptions, takes a table-level lock on subscriptions FIRST and then a
-- FOR KEY SHARE row lock on the referenced plans row (Postgres validates the
-- FK as part of that same INSERT) — always in that order, since it never
-- touches plans anywhere else in its body. An earlier version of this
-- migration took ACCESS EXCLUSIVE on plans FIRST (step 2's DROP/ADD
-- CONSTRAINT) and did not lock subscriptions until step 5 — the REVERSE
-- order. Under that reverse order, a concurrent tenant_provision() call that
-- reaches its subscriptions INSERT while this migration already holds
-- plans, then this migration reaching its own subscriptions lock while that
-- INSERT's FK check is blocked waiting on plans, forms a genuine circular
-- wait: this migration blocks on subscriptions (held by tenant_provision's
-- insert), tenant_provision blocks on plans (held by this migration) —
-- Postgres's deadlock detector would abort one of the two transactions
-- (possibly the live onboarding request, not the migration) after
-- deadlock_timeout. Locking subscriptions FIRST here — matching
-- tenant_provision()'s own fixed order — makes that cycle structurally
-- impossible: whichever transaction reaches subscriptions first simply
-- makes the other wait for it, never the reverse. DD29-8 (migrate.test.ts)
-- proves the concurrent call blocks cleanly (not errors) and completes once
-- this migration's transaction ends.
--
-- OPERATIONAL PRECONDITION (found round-06 review; owner-ratified, no code
-- fence): a narrower window remains past the fix above. A tenant_provision()
-- call that started executing BEFORE step 4's CREATE OR REPLACE FUNCTION
-- commits — and was blocked on the subscriptions lock this file now takes
-- first — resumes, once unblocked, using Postgres's session-cached OLD
-- function body (still writing 'free_web'), because PL/pgSQL caches a
-- function's compiled body for the life of a call regardless of concurrent
-- redefinition. That call can therefore insert a 'free_web' row AFTER this
-- file's own guards have already run. IF THIS PAIR (0028+0029) IS EVER
-- APPLIED TO AN ENVIRONMENT CARRYING LIVE ONBOARDING TRAFFIC, PAUSE WRITES
-- TO tenant_provision() (i.e. onboarding) FOR THE DURATION OF THE DEPLOY.
-- No code fence (e.g. an advisory lock around tenant creation) is added for
-- this, deliberately: the window exists only between this file's commit and
-- 0029's, and closes PERMANENTLY once this pair lands — no future migration
-- ever reproduces it, so a fence would protect exactly one deploy event, and
-- today that event has zero traffic to protect (infra-do-app-vpc-deployment
-- is still status:idea — no deployment contract authored yet; BUILD-STATUS
-- records Chat and Channel Booking runtime at 0, D1 email-token as CODE
-- DARK with no route/provider send, DD-87 with no production caller; and a
-- repo-wide re-check at this slice's re-authoring confirmed tenant_provision
-- is still the ONLY writer of subscriptions.plan_key — zero application-level
-- references to plan_key/planKey exist outside this migration and its own
-- tests). If a straggler 'free_web' row is nonetheless created despite this
-- precondition being ignored, 0029's own self-guard (DD29-5/B2,
-- migrate.test.ts) already aborts on it — the failure mode is a loud,
-- recoverable deploy failure, not silent data corruption, which is why an
-- operational precondition is the right tool here rather than more code.
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
-- Rollback (codex round-13 [P1], gate-attempt-02: rounds 10 and 12 each
-- patched one gap in an INFERENCE-based precondition (tenant age, then an
-- unconditional host_pro count) and each left another — guard 4 above
-- deliberately TOLERATES a pre-existing 'free'/'host_pro' catalog row with
-- the correct payload, and a subscription could already reference it before
-- this migration ever runs; no inference from timestamps or plan_key values
-- alone can distinguish that untouched subscription from one this migration
-- actually repointed. Converged on a design that needs no inference: this
-- migration now records EXACTLY which subscriptions its own UPDATE touches,
-- in dd29_migrated_tenants (see that table's own comment below), so "which
-- rows to revert" is a plain lookup, not a derived property with edge cases):
--
-- To roll back (in this order):
--   1. (only if 0029 has already applied) roll 0029 back first — see its own
--      rollback note — so plans('free_web',1) etc. exist again before step 2
--      needs to reference them.
--   2. Revert ONLY the tracked tenants, never a blanket "every 'free' row":
--        UPDATE subscriptions SET plan_key = 'free_web'
--          WHERE plan_key = 'free'
--            AND tenant_id IN (SELECT tenant_id FROM dd29_migrated_tenants);
--      A tenant this migration never touched — a genuinely new one
--      provisioned afterward, OR a pre-existing anomalous 'free' row guard 4
--      tolerated, OR a manually-assigned 'host_pro' row — is simply absent
--      from dd29_migrated_tenants, so step 2 never touches it, unconditionally,
--      with no age check or plan-specific check required.
--   3. Revert tenant_provision() to the old literal, then attempt:
--        DELETE FROM plans WHERE plan_key IN ('free','host_pro');
--      This is the actual safety net, and it is enforced by Postgres itself,
--      not by this migration's own logic: if ANYTHING still references either
--      row after step 2 — an untracked new tenant, an untracked anomaly, or a
--      'host_pro' row with no inverse to revert to — the FK
--      (subscriptions_plan_key_plan_version_fkey) makes this DELETE fail,
--      aborting the whole rollback transaction cleanly. That failure IS the
--      correct outcome: resolving it (reassigning those specific tenants
--      manually, or accepting 'free'/'host_pro' as permanent and doing a
--      code-only partial rollback of just tenant_provision()'s literal) is an
--      owner decision this migration does not make. Only once the DELETE
--      succeeds is it safe to also narrow plans_key_chk back to the 4 old
--      values and DROP TABLE dd29_migrated_tenants — the very last step of a
--      fully successful rollback, never before.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Lock subscriptions FIRST — before touching plans at all. See the lock-
-- ordering note in the header above: this ACCESS EXCLUSIVE acquisition must
-- happen before plans is touched, matching tenant_provision()'s own fixed
-- lock order (subscriptions, then plans via its FK check), or a concurrent
-- tenant_provision() call and this migration can deadlock each other.
-- NO FORCE ROW LEVEL SECURITY is also the mechanism guards 1-3 and the data
-- migrate UPDATE below need (subscriptions carries FORCE RLS, 0009 — see
-- their own comments for why), so taking it here serves both purposes at
-- once; it is restored at the very end of this file, after the UPDATE.
-- ---------------------------------------------------------------------------
ALTER TABLE subscriptions NO FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Widen plans_key_chk: union of old ∪ new values. Postgres has no
-- in-place CHECK-predicate ALTER — DROP + ADD is required. plans is a small
-- shared catalog table (a handful of rows total), so the re-validation
-- ADD CONSTRAINT performs is cheap, unlike the money-path tables 0025 had to
-- reason carefully about.
-- ---------------------------------------------------------------------------
ALTER TABLE plans DROP CONSTRAINT plans_key_chk;
ALTER TABLE plans ADD CONSTRAINT plans_key_chk
  CHECK (plan_key IN ('free_web','telegram','plus_channel','all_channels','free','host_pro'));

-- ---------------------------------------------------------------------------
-- 3. Insert the two new catalog rows. Literals transcribed verbatim from
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
-- 4. Verify the two target rows exactly match the canonical DD-29 shape,
-- whether this INSERT just created them or ON CONFLICT DO NOTHING left a
-- pre-existing row untouched (codex round-07 [P1], gate-attempt-01 on this
-- registration): guards 1-3 below validate subscriptions' plan_key/version
-- references, but nothing previously checked the plans CATALOG payload
-- itself — a stray free@1 or host_pro@1 row from an earlier manual edit or a
-- partially-applied prior attempt could silently become "canonical" with the
-- wrong price/limits/capabilities, and every subscription this file repoints
-- would inherit that wrong entitlement set with no error anywhere. The
-- literal below is the exact same one used in step 3's INSERT (transcribed
-- from feature_billing_lifecycle_tech.md:68-81) — kept in sync by being
-- copied from the same source, proven non-vacuous by DD29-9's regression
-- test (a conflicting pre-existing free@1 row).
-- ---------------------------------------------------------------------------
DO $$ DECLARE v_free_ok boolean; v_host_pro_ok boolean; BEGIN
  SELECT (
    price = 0 AND currency = 'VND' AND interval = 'monthly' AND active
    AND limits = '{"max_clubs": 2, "ai_monthly_question_cap": 0}'::jsonb
    AND entitlements = '{"capabilities": {"web_app": true, "bot_zalo": true, "bot_messenger": true,
         "session_management": true, "discovery_marketplace": true,
         "payment_mark_manual": true, "payment_reconcile_auto": false,
         "reminders_manual": true, "reminders_auto": false,
         "assistant_ai_kb": false, "crm_dashboard": false}}'::jsonb
  ) INTO v_free_ok FROM plans WHERE plan_key = 'free' AND version = 1;
  SELECT (
    price = 250000 AND currency = 'VND' AND interval = 'monthly' AND active
    AND limits = '{"max_clubs": null, "ai_monthly_question_cap": 2000}'::jsonb
    AND entitlements = '{"capabilities": {"web_app": true, "bot_zalo": true, "bot_messenger": true,
         "session_management": true, "discovery_marketplace": true,
         "payment_mark_manual": true, "payment_reconcile_auto": true,
         "reminders_manual": true, "reminders_auto": true,
         "assistant_ai_kb": true, "crm_dashboard": true}}'::jsonb
  ) INTO v_host_pro_ok FROM plans WHERE plan_key = 'host_pro' AND version = 1;
  IF NOT coalesce(v_free_ok, false) THEN
    RAISE EXCEPTION 'DD-29 expand: an existing free@1 plans row does not match the canonical DD-29 payload (price/currency/interval/active/limits/entitlements) — resolve the conflicting row before retrying'
      USING ERRCODE = 'data_exception';
  END IF;
  IF NOT coalesce(v_host_pro_ok, false) THEN
    RAISE EXCEPTION 'DD-29 expand: an existing host_pro@1 plans row does not match the canonical DD-29 payload (price/currency/interval/active/limits/entitlements) — resolve the conflicting row before retrying'
      USING ERRCODE = 'data_exception';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Redefine tenant_provision() — identical body to 0012_auth_functions.sql
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
-- 6. Fail-loud guards, then data-migrate — in this order. See header for why
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
-- not just a boolean — step 1 already took NO FORCE ROW LEVEL SECURITY for
-- exactly this (and for lock ordering; see the header note), so it is
-- already in effect here. FORCE is restored at the very end, after the
-- UPDATE, before this transaction commits — the one toggle-off/toggle-on
-- pair runs inside the one transaction migrate.ts wraps this whole file in,
-- so a concurrent session only ever observes the fully-committed FORCE-ON
-- state, never a relaxed window, and any failure below rolls it back too.
-- ---------------------------------------------------------------------------

-- guard 1: refuse to proceed if any row is outside the known old∪new set
DO $$ DECLARE v_bad integer; BEGIN
  SELECT count(*) INTO v_bad FROM subscriptions
    WHERE plan_key NOT IN ('free_web','telegram','plus_channel','all_channels','free','host_pro');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'DD-29 expand: % subscriptions row(s) reference an unrecognized plan_key', v_bad
      USING ERRCODE = 'data_exception';
  END IF;
END $$;

-- guard 2: refuse the "only v1 ever existed" assumption unless it actually holds on THIS
-- database — checked against BOTH subscriptions (whose plan_version the CASE mapping below
-- assumes is 1) AND the plans catalog itself (codex round-08 [P1], gate-attempt-04: an
-- old-key catalog row at version <> 1 that no subscription references — e.g. a historical
-- telegram@2 price-change snapshot, exactly the shape business-rules.md edge case #6 calls
-- out as "plan version immutable" — would pass the subscriptions-only check below, then
-- 0029's unconditional DELETE FROM plans WHERE plan_key IN (...) silently erases it, since
-- that DELETE has no version filter. Checking plans directly closes that gap regardless of
-- whether any subscription ever pointed at the row.
DO $$ DECLARE v_bad_version integer; v_bad_catalog_version integer; BEGIN
  SELECT count(*) INTO v_bad_version FROM subscriptions
    WHERE plan_key IN ('free_web','telegram','plus_channel','all_channels') AND plan_version <> 1;
  IF v_bad_version > 0 THEN
    RAISE EXCEPTION 'DD-29 expand: % subscriptions row(s) sit on an old plan_key at version <> 1 — the CASE mapping below only handles v1', v_bad_version
      USING ERRCODE = 'data_exception';
  END IF;

  SELECT count(*) INTO v_bad_catalog_version FROM plans
    WHERE plan_key IN ('free_web','telegram','plus_channel','all_channels') AND version <> 1;
  IF v_bad_catalog_version > 0 THEN
    RAISE EXCEPTION 'DD-29 expand: % plans catalog row(s) exist on an old plan_key at version <> 1 (referenced by a live subscription or not) — 0029''s later DELETE has no version filter and would silently erase this immutable pricing history', v_bad_catalog_version
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

-- Explicit rollback provenance (codex round-13 [P1], gate-attempt-02: rounds
-- 10/12's inference-based rollback preconditions — tenant age for 'free',
-- an unconditional count for 'host_pro' — each closed one gap but left
-- another: guard 4 above deliberately TOLERATES a pre-existing 'free'/
-- 'host_pro' catalog row with the correct payload, and a subscription could
-- already reference that row before this migration even runs; the age-based
-- check could not distinguish that untouched subscription from one this
-- migration actually repointed, and would incorrectly revert it too. A
-- design needing no inference closes this permanently: record exactly which
-- subscriptions THIS UPDATE touches, in the same transaction, via a plain
-- table — "which rows to revert" becomes a lookup, not a derived property
-- with edge cases. Left in place indefinitely (harmless, one row per
-- migrated tenant) — 0029 must never drop it; only a fully successful
-- rollback of THIS file removes it, as its very last step.
CREATE TABLE IF NOT EXISTS dd29_migrated_tenants (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id)
);

-- data migrate: free_web -> free (explicit, DD-29 changelog); telegram /
-- plus_channel / all_channels -> host_pro (derived — DD-29 collapses 4 tiers
-- into exactly one paid tier, so no third destination value exists for any
-- of the three to map to instead — though guard 3 above makes these three
-- branches unreachable in practice; the WHERE clause below only ever
-- actually matches free_web rows). The RETURNING/INSERT captures exactly
-- the tenant_ids this UPDATE touches into dd29_migrated_tenants, atomically,
-- in the same statement.
WITH migrated AS (
  UPDATE subscriptions SET
    plan_key = CASE plan_key
      WHEN 'free_web' THEN 'free'
      WHEN 'telegram' THEN 'host_pro'
      WHEN 'plus_channel' THEN 'host_pro'
      WHEN 'all_channels' THEN 'host_pro'
      ELSE plan_key END,
    plan_version = 1
  WHERE plan_key IN ('free_web','telegram','plus_channel','all_channels')
  RETURNING tenant_id
)
INSERT INTO dd29_migrated_tenants (tenant_id)
SELECT tenant_id FROM migrated
ON CONFLICT (tenant_id) DO NOTHING;

ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
