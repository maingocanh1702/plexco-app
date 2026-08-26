-- ============================================================================
-- 0034_identity_account_link_resolver.sql
-- DD-32 Option D — account-backed link resolver (identity-account-link-core),
-- the FIRST prerequisite of the Channel Booking funnel (feature_channel_booking_
-- funnel_tech.md PRIOR_SLICES). Proves the linked-for-deferred-payment predicate:
-- an exact ChannelIdentity and a verified Plexco Account BOTH resolve to the SAME
-- current canonical Person, not frozen/merged/conflicted (HARD RULE 4, AUDIT C2/C5).
--
-- WHY A SECURITY DEFINER FUNCTION: role `app` holds ZERO privilege on the
-- global-protected identity tables (0009: "Global protected identity/auth tables:
-- NO grant to app — least privilege"); per feature_identity_tech §2/§4 those tables
-- are reachable ONLY through narrow SECURITY DEFINER functions. Mirrors the
-- resolve_tenant_status_locked (0027) precedent: a READ-ONLY definer, fixed
-- search_path. There is NO write path here. FOR SHARE needs the definer's
-- privilege (PostgreSQL requires UPDATE privilege for any row-locking clause),
-- which is exactly why this read is wrapped in a definer function.
--
-- SCOPE — INTERNAL PARTIAL CORE (owner ruling 2026-08-25, option A). This function
-- is deliberately NOT granted to `app` (no GRANT EXECUTE below — REVOKE ALL FROM
-- PUBLIC only), so on live schema NO runtime role (app / app_worker / readonly) can
-- call it; it is owner/definer-callable only. It is the person-convergence CORE, not
-- the full DD-32 resolver: it does NOT perform the contract's endpointContext /
-- Page-OA / authenticated-actor validation (feature_identity_tech §4), because live
-- channel_identities lacks the DD-65..68 endpoint-scope columns to validate against.
-- Exposing this partial core to `app` would be an incomplete money/identity
-- predicate (codex round 2 [P1]). RESUME CONDITION: when the DD-65..68 endpoint-scope
-- migration lands those columns, a successor slice adds the app-facing, endpoint-
-- complete, finalizer-safe resolver that WRAPS this core and grants EXECUTE there,
-- with its own security round.
--
-- NAMING (codex round 4 [P1]): this internal core is `resolve_deferred_payment_account_core`.
-- The bare contract name `resolve_deferred_payment_account`, which decisions.md DD-50 (:683) and
-- feature_identity_tech §4 reserve for the APP-GRANTED resolver, is deliberately NOT defined by
-- this migration — it is reserved for the DD-65..68 successor. That keeps the committed authority
-- (which requires that name to grant EXECUTE to app) consistent with this owner-only core.
--
-- CONCURRENCY (feature_identity_tech §4 consume pattern): resolve candidates
-- READ-ONLY first, then acquire FOR SHARE locks in the ONE canonical global order
-- the identity subsystem uses — account/email -> Person(s) -> channel_identity,
-- UUID-sorted within a tier — then REVALIDATE the whole binding under lock. The
-- read-then-lock-in-canonical-order sequence is what makes this resolver unable to
-- deadlock (40P01) against a concurrent merge / link-code consume that locks the
-- same rows in that order; the revalidation fails closed on any drift between the
-- read and the lock. The FOR SHARE locks survive into the caller's transaction — but
-- this is a SNAPSHOT, NOT a finalizer-safe guarantee: qualification is exactly-one
-- AT RESOLVE TIME, and a concurrent flow can still promote a second account's pending
-- email to verified (making the binding ambiguous) AFTER this returns. Full
-- serialization across the auth email-verify / account-insert flows is explicitly
-- OUT OF SCOPE here and OWNED by the finalizer, which MUST re-check binding_version
-- under its own full lock set before acting on money (codex round 2 [P1], owner
-- ruling 2026-08-25). binding_version is that deterministic recheck token.
--
-- Verified-account predicate (owner DD-50 amendment 2026-08-25): an active Account
-- on the canonical Person with >=1 account_emails.verified_at IS NOT NULL (Google
-- OIDC email_verified / email-password verify-token). Legacy Telegram
-- account_identities do NOT count (DD-37 removed the provider). account_emails
-- .verified_at is monotonic (0016 forbids un-verify); the verified-email evidence
-- row is itself locked FOR SHARE so it cannot be deleted out from under a positive
-- decision.
--
-- DEFERRED (fenced, not dropped): endpoint-scope validation (endpointContext /
-- Page-OA relation) needs the DD-65..68 endpoint columns that live
-- channel_identities lacks; when they land, add the endpoint relation check as
-- step 1. binding_version is a deterministic content token (no live version
-- column), rechecked under lock by the future finalizer.
--
-- The bridge between channel and account is person_id convergence ONLY — never a
-- raw PSID/from.id, provider name or display name. Every deny is generic (qualified
-- = false, all refs NULL): cause-agnostic, zero mutation.
--
-- MERGE CHAIN INTEGRITY (owner-ratified invariant — decisions.md DD-50 amendment
-- 2026-08-26, path-compressed): merge_tombstones is path-compressed — every merged
-- person has EXACTLY ONE tombstone whose canonical_person_id points straight at the
-- final active canonical. The resolver corroborates the merged_into_person_id walk
-- against this second authoritative source: every MERGED chain node must carry its
-- tombstone to the canonical (checked in BOTH phase 1 and the locked phase 3), else
-- fail closed. merge_tombstones has no writer yet (person-merge is a future slice,
-- DD-01/§P6) — this invariant is the contract that writer must honour (security round SEC-1).
--
-- Source: identity-account-link-core slice packet.
-- ============================================================================

CREATE FUNCTION resolve_deferred_payment_account_core(p_channel_identity_id uuid)
RETURNS TABLE (qualified boolean, account_ref uuid, person_ref uuid, binding_version text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- phase 1 (read-only resolution)
  v_ci_person   uuid;
  v_ci_status   text;
  v_canonical   uuid;
  v_chain       uuid[] := ARRAY[]::uuid[];
  v_account     uuid;
  v_email       uuid;
  v_cnt         integer;
  v_cur         uuid;
  v_cur_status  text;
  v_cur_merged  uuid;
  v_hops        integer;
  v_p           uuid;
  -- phase 3 (revalidation under lock)
  v_r_person    uuid;
  v_r_status    text;
  v_r_canonical uuid;
  v_r_account   uuid;
  v_r_email     uuid;
  v_r_chain     uuid[] := ARRAY[]::uuid[];
BEGIN
  -- Null input → generic not-qualified (a data state never throws).
  IF p_channel_identity_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- ==========================================================================
  -- PHASE 1 — READ-ONLY resolution (NO row locks). Discovering WHAT to lock
  -- without holding a lock is what lets PHASE 2 take locks in the canonical
  -- global order, so this resolver cannot deadlock against a concurrent merge.
  -- ==========================================================================
  SELECT ci.person_id, ci.status
    INTO v_ci_person, v_ci_status
    FROM channel_identities ci
   WHERE ci.id = p_channel_identity_id;
  IF NOT FOUND OR v_ci_status <> 'active' THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- Walk merged_into_person_id to the current canonical ACTIVE person, collecting
  -- every visited person id for the lock phase. A merged row with a NULL pointer, a
  -- deleted person, a cycle or an over-long chain all fail closed.
  v_cur := v_ci_person;
  v_hops := 0;
  LOOP
    v_hops := v_hops + 1;
    IF v_hops > 16 THEN
      RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
      RETURN;
    END IF;
    SELECT p.status, p.merged_into_person_id
      INTO v_cur_status, v_cur_merged
      FROM persons p
     WHERE p.id = v_cur;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
      RETURN;
    END IF;
    v_chain := v_chain || v_cur;
    IF v_cur_status = 'active' THEN
      -- An 'active' person that still carries a merge pointer is a CONFLICTED /
      -- inconsistent state (the merge invariant is status='merged' <-> pointer set);
      -- fail closed rather than treat it as canonical (codex round 2 [P1]).
      IF v_cur_merged IS NOT NULL THEN
        RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
        RETURN;
      END IF;
      v_canonical := v_cur;
      EXIT;
    ELSIF v_cur_status = 'merged' AND v_cur_merged IS NOT NULL THEN
      v_cur := v_cur_merged;
    ELSE
      RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
      RETURN;
    END IF;
  END LOOP;

  -- The canonical must not itself be tombstoned: a merge_tombstones row keyed on it
  -- (as old_person_id) means it was merged away — a divergent state vs its 'active'
  -- status. Reject it (codex round 2 [P1]). This read is why merge_tombstones is in
  -- the function's protected-table read set.
  IF EXISTS (SELECT 1 FROM merge_tombstones WHERE old_person_id = v_canonical) THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- Per-node tombstone corroboration (owner-ratified invariant — decisions.md DD-50
  -- amendment 2026-08-26, path-compressed): every MERGED node in the chain must carry a
  -- merge_tombstones row whose canonical_person_id points straight at this final canonical.
  -- A merged node with a MISSING tombstone (incomplete merge) or a DIVERGENT one (points
  -- elsewhere) fails closed. The active canonical (last chain element) is excluded — it is
  -- the merge target, not a merged-away node. Corroborates the merged_into_person_id walk
  -- against the second authoritative source (security round SEC-1 [P1]).
  FOR v_p IN SELECT pid FROM unnest(v_chain) AS t(pid) WHERE pid <> v_canonical LOOP
    IF NOT EXISTS (SELECT 1 FROM merge_tombstones
                    WHERE old_person_id = v_p AND canonical_person_id = v_canonical) THEN
      RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
      RETURN;
    END IF;
  END LOOP;

  -- Exactly one verified account across the ENTIRE resolved chain (owner ratification 2026-08-26:
  -- fail-closed across the whole merge chain, extending SEC-1 to accounts). 0 → unlinked/unverified;
  -- >1 → ambiguous. A verified account lingering on a merged source node (accounts are NOT re-parented
  -- yet — DD-103, merge-commit unbuilt) makes the binding ambiguous and must fail closed here, not slip
  -- past a canonical-only count.
  SELECT count(*)
    INTO v_cnt
    FROM accounts a
   WHERE a.person_id = ANY(v_chain)
     AND EXISTS (SELECT 1 FROM account_emails ae
                  WHERE ae.account_id = a.id AND ae.verified_at IS NOT NULL);
  IF v_cnt <> 1 THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  -- The single verified account must resolve to the final active canonical; one on a non-canonical
  -- (merged) node has count = 1 above but is NOT FOUND here → fail closed.
  SELECT a.id, ae.id
    INTO v_account, v_email
    FROM accounts a
    JOIN account_emails ae ON ae.account_id = a.id AND ae.verified_at IS NOT NULL
   WHERE a.person_id = v_canonical;
  -- The counted account could have disappeared between the count and this SELECT (a
  -- concurrent delete/replace under READ COMMITTED). Without a FOUND check v_account/
  -- v_email would stay NULL and later flow into a MALFORMED qualified row (qualified=
  -- true with null refs) — fail closed instead (codex round 3 [P1]).
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- ==========================================================================
  -- PHASE 2 — acquire FOR SHARE locks in the CANONICAL GLOBAL ORDER:
  --   tier 1: account, then its verified-email evidence
  --   tier 2: chain persons, UUID-sorted
  --   tier 3: the channel identity
  -- A deleted/replaced target simply locks nothing here; PHASE 3 revalidation
  -- then fails closed. Locking every chain person (not only the canonical) in
  -- UUID order matches the merge commit's own sorted Person locks.
  -- ==========================================================================
  PERFORM 1 FROM accounts WHERE id = v_account FOR SHARE;
  PERFORM 1 FROM account_emails WHERE id = v_email FOR SHARE;
  FOR v_p IN SELECT pid FROM unnest(v_chain) AS t(pid) ORDER BY pid LOOP
    PERFORM 1 FROM persons WHERE id = v_p FOR SHARE;
  END LOOP;
  PERFORM 1 FROM channel_identities WHERE id = p_channel_identity_id FOR SHARE;

  -- ==========================================================================
  -- PHASE 3 — revalidate the whole binding UNDER LOCK. Any drift between the read
  -- (phase 1) and the lock (phase 2) fails closed to a generic deny; a finalizer
  -- re-calls and retries. This is §4's "re-read issuer binding and derive current
  -- Person server-side; stale/merged Person -> generic invalid".
  -- ==========================================================================
  SELECT ci.person_id, ci.status
    INTO v_r_person, v_r_status
    FROM channel_identities ci
   WHERE ci.id = p_channel_identity_id;
  IF NOT FOUND OR v_r_status <> 'active' OR v_r_person <> v_ci_person THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  v_cur := v_ci_person;
  v_hops := 0;
  LOOP
    v_hops := v_hops + 1;
    IF v_hops > 16 THEN
      RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
      RETURN;
    END IF;
    SELECT p.status, p.merged_into_person_id
      INTO v_cur_status, v_cur_merged
      FROM persons p
     WHERE p.id = v_cur;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
      RETURN;
    END IF;
    v_r_chain := v_r_chain || v_cur;
    IF v_cur_status = 'active' THEN
      IF v_cur_merged IS NOT NULL THEN
        RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
        RETURN;
      END IF;
      v_r_canonical := v_cur;
      EXIT;
    ELSIF v_cur_status = 'merged' AND v_cur_merged IS NOT NULL THEN
      v_cur := v_cur_merged;
    ELSE
      RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
      RETURN;
    END IF;
  END LOOP;
  -- Compare the COMPLETE revalidated chain, not just the final canonical id. If the
  -- chain changed in the read->lock window (e.g. A->C became A->B->C), the final
  -- canonical is unchanged but a NEW intermediate (B) was never locked in PHASE 2, so
  -- the whole-binding-under-lock guarantee would be violated. Fail closed on ANY chain
  -- difference (codex round 2 [P1]); a finalizer re-calls and retries. (Order matches
  -- because both walks start from v_ci_person deterministically.)
  IF v_r_chain <> v_chain THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  -- Re-check the tombstone predicate under lock: a merge_tombstones row for the
  -- canonical could have appeared concurrently between the read and the lock
  -- (codex round 2 [P1]).
  IF EXISTS (SELECT 1 FROM merge_tombstones WHERE old_person_id = v_canonical) THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  -- Per-node tombstone corroboration under lock (mirror of the phase-1 check; the chain
  -- persons are FOR SHARE-locked, so a concurrent merge cannot change these tombstones
  -- here). Every merged node must still carry its path-compressed tombstone to the
  -- canonical (security round SEC-1 [P1]).
  FOR v_p IN SELECT pid FROM unnest(v_r_chain) AS t(pid) WHERE pid <> v_r_canonical LOOP
    IF NOT EXISTS (SELECT 1 FROM merge_tombstones
                    WHERE old_person_id = v_p AND canonical_person_id = v_r_canonical) THEN
      RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
      RETURN;
    END IF;
  END LOOP;

  -- Chain-wide verified-account count under lock (mirror of phase-1; owner ratification 2026-08-26).
  SELECT count(*)
    INTO v_cnt
    FROM accounts a
   WHERE a.person_id = ANY(v_r_chain)
     AND EXISTS (SELECT 1 FROM account_emails ae
                  WHERE ae.account_id = a.id AND ae.verified_at IS NOT NULL);
  IF v_cnt <> 1 THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  SELECT a.id, ae.id
    INTO v_r_account, v_r_email
    FROM accounts a
    JOIN account_emails ae ON ae.account_id = a.id AND ae.verified_at IS NOT NULL
   WHERE a.person_id = v_canonical;
  -- FOUND guard (as in phase 1) + NULL-SAFE comparison: `<>` yields SQL NULL when
  -- either side is NULL, which PL/pgSQL treats as false and would fall through to a
  -- malformed qualified row; IS DISTINCT FROM compares NULLs correctly (codex round 3 [P1]).
  IF NOT FOUND
     OR v_r_account IS DISTINCT FROM v_account
     OR v_r_email IS DISTINCT FROM v_email THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- ==========================================================================
  -- PHASE 4 — qualified. binding_version = deterministic sha256 over the immutable
  -- resolved tuple. A re-parent (v_ci_person), a further merge (v_canonical) or an
  -- account change (v_account) changes it; losing the verified email flips the
  -- outcome to not-qualified instead. The finalizer re-calls under its own lock and
  -- compares this value.
  -- ==========================================================================
  RETURN QUERY
    SELECT true,
           v_account,
           v_canonical,
           encode(
             sha256(convert_to(
               'plexco:deferred-payment-binding:v1:'
               || p_channel_identity_id::text || ':'
               || v_ci_person::text || ':'
               || v_canonical::text || ':'
               || v_account::text, 'utf8')),
             'hex');
  RETURN;
END;
$$;

-- Owner/definer-only (option A), per the 0027 resolve_tenant_status_locked posture — the migration is
-- owner-authored and TRUSTED (owner ratification, decisions.md DD-50 amendment 2026-08-26 · #2, commit
-- a8ae81d). A fresh CREATE FUNCTION is owned by the migration role; PostgreSQL grants EXECUTE to PUBLIC
-- by default, so REVOKE FROM PUBLIC makes it owner-only. app/app_worker/readonly are revoked explicitly
-- (this internal core grants EXECUTE to NO runtime role — the DD-65..68 endpoint-complete successor
-- grants app there). Per the ratified threat model, hardening the migration-time DDL against a hostile
-- search_path / pre-set ALTER DEFAULT PRIVILEGES / injected overload is OUT of the phase-1 threat model
-- for migration-authored objects; no migration in this repo schema-qualifies CREATE FUNCTION, incl. 0027.
REVOKE ALL ON FUNCTION resolve_deferred_payment_account_core(uuid) FROM PUBLIC, app, app_worker, readonly;
