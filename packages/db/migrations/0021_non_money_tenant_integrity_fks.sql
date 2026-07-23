-- ============================================================================
-- 0021_non_money_tenant_integrity_fks.sql
-- Same-tenant tenant-integrity, non-money leg: composite candidate keys +
-- composite FKs on the channel/notification child rows. EXPAND ONLY, additive,
-- code stays dark. Sibling of 0019 (session domain, DD-68) and 0020 (ledger
-- domain) — same mechanism, applied to the remaining tenant-scoped non-money
-- children.
--
-- Contract: manifest docs/autopilot-manifests/db-non-money-tenant-integrity-fks.json
--   · 0019_tenant_integrity_fks.sql (mechanism + full RLS-independence argument)
--   · 0020_ledger_tenant_integrity_fks.sql (same mechanism, ledger leg) ·
--   HANDOFF HR1 (the DB is the fail-closed choke-point). This migration does
--   NOT cite "DD-68" the way 0019/0020 do: decisions.md's current DD-68 entry
--   covers an unrelated Messenger interaction contract (durable
--   interaction/opaque actions/E2E gate), not tenant-integrity FKs. Authority
--   here is the sibling migrations + the manifest + HR1, per HANDOFF's
--   live-schema-first citation hierarchy (§7).
--
-- The gap this closes (same class as 0019/0020, non-money leg):
--   every remaining tenant-scoped non-money child references its parent by a
--   SINGLE-column FK only —
--     zalo_reply_contexts.bot_id            → zalo_bots.id               (0004)
--     notification_deliveries.intent_id     → notification_intents.id   (0008)
--     memberships.merged_into_membership_id → memberships.id (self)     (0002)
--   A single-column FK proves the parent EXISTS; it does NOT prove the parent
--   belongs to the SAME tenant as the child's own tenant_id. RLS filters
--   reads, so a service-layer bug can write a row pointing at another
--   tenant's parent — silent cross-tenant integrity corruption: a Zalo DM
--   reply-context resolved against another club's bot (wrong club's session
--   list read back to a user), a notification delivery attempt fanned out
--   under another tenant's intent, or a tenant-B membership's merge pointer
--   left resolving into tenant-A's membership tree (identity/roster
--   corruption on a merge — not money, but still cross-tenant state leaking
--   past RLS). The composite FK (tenant_id, fk) → parent(tenant_id, id)
--   makes such rows unrepresentable at the database. PostgreSQL
--   referential-integrity checks run as an internal system mechanism NOT
--   subject to the querying role's RLS, so enforcement holds on the app-role
--   (NOBYPASSRLS) runtime path — see 0019's header for the full argument.
--
--   notification_deliveries → notification_intents is also independently
--   documented as a pending contract item in
--   feature_notifications_reminders_tech.md v2.5 ("Tenant/endpoint integrity
--   closure... enforce same-tenant delivery→intent... composite FKs... Runtime
--   migration pending."). This migration implements ONLY that tenant_id-scoped
--   composite-FK layer; the broader v2.5 contract (person-bound composite FKs
--   `(intent_id, tenant_id, person_id)`, `channel_identity_id`/platform
--   binding, SECURITY DEFINER capability functions) is NOT in scope here — it
--   is a separate, larger notification-security slice.
--
-- FK inventory — derived by an EXHAUSTIVE scan of every `tenantId: uuid(...)`
--   column and every `.references(` call in schema.ts, THEN cross-checked
--   against every literal `REFERENCES` clause in the live SQL across
--   0000-0020 (not just schema.ts's mirror). That second pass matters: a
--   schema.ts-only grep missed `memberships.merged_into_membership_id` — the
--   SQL (0002) carries `REFERENCES memberships(id)` but the Drizzle mirror
--   never had `.references()` on that column, the same class of schema.ts
--   drift 0020 found and fixed on `payment_allocations.reverses_allocation_id`
--   (round-02 of THIS slice caught it via codex review; the mirror is fixed
--   here). Per this slice's own round-01 discipline (the 0019 round-01
--   lesson: a hand-listed inventory missed charges → players), every
--   tenant-scoped table was walked at the SQL level; the only three
--   single-column FKs from one tenant-scoped table to another tenant-scoped
--   table's `id` that are NOT already bound by 0019/0020 are:
--     1. zalo_reply_contexts (tenant_id, bot_id) → zalo_bots — both columns
--        NOT NULL, always enforced. Surfaced by the exhaustive scan (no
--        pre-existing spec doc calls this leg out explicitly).
--     2. notification_deliveries (tenant_id, intent_id) → notification_intents
--        — both columns NOT NULL, always enforced. Independently documented in
--        feature_notifications_reminders_tech.md v2.5 (see above).
--     3. memberships (tenant_id, merged_into_membership_id) → memberships
--        (self-reference) — merged_into_membership_id is NULLABLE (set only
--        when status='merged') → MATCH SIMPLE leaves the composite unenforced
--        while it is NULL (every non-merged membership), enforced the moment
--        a merge sets it, binding the merge target to the SAME tenant as the
--        merged-away row.
--   Relationships 1-2 are always enforced (both legs NOT NULL); relationship 3
--   is the one MATCH SIMPLE case in this migration, spelled out explicitly
--   below like 0019/0020 do for their own nullable legs.
--
-- What this migration does and does NOT do:
--   DOES  — add UNIQUE (tenant_id, id) candidate keys on zalo_bots and
--           notification_intents (a composite FK must target a unique
--           constraint on exactly its referenced column set; id is already
--           the PK, so each is a strict-superset uniqueness — additive, it
--           cannot reject any existing row; zalo_bots.tenant_id already
--           carries its own single-column UNIQUE from 0004, but a composite FK
--           still requires a unique constraint matching its exact column
--           list). `memberships` needs NO new candidate key — 0019 already
--           added `memberships_tenant_id_candidate_key UNIQUE (tenant_id,
--           id)`; this migration's merge-self composite FK targets that
--           existing key. Then add the three composite FKs above NOT VALID
--           and VALIDATE each under a named-halt wrapper.
--   DOES NOT — drop any single-column FK (each stays and still governs
--           ON DELETE / ON UPDATE, both default NO ACTION). No new table, no
--           column added or dropped, no RLS policy change (RLS is already
--           ENABLE+FORCE on every table involved — see 0009 — and its grants
--           are table-level — constraints change neither), no grant change,
--           no service/repo/adapter code (the Zalo/notification feature
--           layers are unbuilt or partially built, and membership merges are
--           unbuilt — code dark for the tables touched here).
--
-- Deliberately OUT (scanned and excluded — every tenant-scoped table was
--   walked; these are the ones with an otherwise-bindable-looking relationship
--   that do NOT qualify):
--   * session_occurrences, projector_deliveries, surface_refs, billing_allocations,
--     onboarding_steps — each has a single-column FK to a tenant-scoped parent
--     (sessionRecurrenceRules/sessions, outbox_events, [none — aggregate_id is
--     a bare polymorphic uuid, not an FK], subscription_invoices,
--     onboarding_runs respectively) but the CHILD table itself carries NO
--     tenant_id column, so there is no child tenant_id to bind. Same treatment
--     0019 gave session_occurrences and 0020 gave billing_allocations.
--   * routing_audit — tenant_id is nullable with no FK to tenants at all
--     ("Routing/authz audit (platform-level, no RLS)", 0002); an audit trail
--     outliving normal referential concerns, same class as auth_audit_events.
--   * public_sessions — tenant_id present but no FK by design (the cross-tenant
--     public read model has no FK into tenant tables, HR2); already excluded
--     explicitly by 0019's header.
--   * messenger_pages — tenant-scoped and shaped like zalo_bots (one row per
--     tenant), but nothing currently references messenger_pages.id by FK, so
--     there is no child-side gap to close for it in this slice.
--   * Every other tenant-scoped table (aliases, channel_reachability,
--     settings, sessions, session_recurrence_rules, session_surface_refs,
--     players, telegram_links, tenant_admins, tenant_link_codes,
--     player_chat_context, oauth_transactions, zalo_bots, processed_commands,
--     outbox_events, join_requests, subscriptions, subscription_invoices,
--     billing_overrides, notification_policies, notification_intents,
--     onboarding_runs) either has no OTHER tenant-scoped FK column, is already
--     bound by 0019/0020, or its only FK targets a GLOBAL table (persons,
--     sports, plans) or a platform-scoped table — none of those are bindable
--     relationships (tenant_id → tenants itself is the anchor being bound, not
--     a bindable relationship, per 0020's framing). `memberships` itself is
--     relationship 3 above (self-merge), not in this excluded set.
--   * Money-path/ledger tables (bank_accounts, charges, bank_transactions,
--     payment_allocations, provider_connections) are explicitly out of scope
--     for this non-money slice — already fully covered by 0019/0020.
--
-- VALIDATE → named halt (not a bare mid-migration error): identical mechanism
--   to 0019/0020 — detection runs through VALIDATE CONSTRAINT (an internal
--   integrity operation that is NOT RLS-filtered, unlike a SELECT probe under
--   a least-privilege DDL owner; see 0019's header / its codex round-02
--   [P2]). Each VALIDATE runs in its own BEGIN/EXCEPTION subtransaction; a
--   caught foreign_key_violation is re-raised as a NAMED halt naming the
--   child table, the relationship, and the offending (tenant_id, fk) key from
--   the FK error detail — an owner-actionable halt, never an auto delete or
--   re-parent. On clean data every VALIDATE succeeds instantly.
--
-- Locking — identical caveat to 0019/0020/0014: "EXPAND ONLY" here is
--   additive-and-reversible, NOT online-safe. migrate.ts applies this file in
--   ONE transaction, so ADD CONSTRAINT … NOT VALID + VALIDATE run under one
--   lock and the candidate-key index builds hold ACCESS EXCLUSIVE on the
--   parents. Acceptable now ONLY because every table touched here is empty
--   (the Zalo/notification feature layers are unbuilt or not yet driving
--   traffic). A future slice against POPULATED tables must split NOT VALID and
--   VALIDATE across separate migration files so VALIDATE can run without
--   blocking writers — do not copy this single-transaction shape onto live
--   data.
-- ============================================================================

-- ---- 1. Candidate keys on the parents -------------------------------------
-- A composite FK must reference a UNIQUE/PRIMARY KEY on exactly its referenced
-- column set. id is already the PK (unique on its own), so UNIQUE (tenant_id,
-- id) is a strict superset and is always satisfiable — it cannot reject any
-- existing row. Column order (tenant_id, id) matches the FK reference lists.
ALTER TABLE zalo_bots
  ADD CONSTRAINT zalo_bots_tenant_id_candidate_key UNIQUE (tenant_id, id);
ALTER TABLE notification_intents
  ADD CONSTRAINT notification_intents_tenant_id_candidate_key UNIQUE (tenant_id, id);

-- ---- 2. Composite FKs, added NOT VALID (single-column FKs kept intact) -----
-- Each ADD is additive: the pre-existing single-column FK from 0002/0004/0008
-- stays and continues to govern ON DELETE (NO ACTION). These bind the
-- child's tenant_id to its parent's tenant_id. The zalo/notification
-- referencing column pairs are both NOT NULL, so those two composites are
-- always enforced (no MATCH SIMPLE case). memberships.merged_into_membership_id
-- is NULLABLE (set only when status='merged') — MATCH SIMPLE spelled out below.
ALTER TABLE zalo_reply_contexts
  ADD CONSTRAINT zalo_reply_contexts_tenant_bot_fk
  FOREIGN KEY (tenant_id, bot_id) REFERENCES zalo_bots (tenant_id, id) NOT VALID;

ALTER TABLE notification_deliveries
  ADD CONSTRAINT notification_deliveries_tenant_intent_fk
  FOREIGN KEY (tenant_id, intent_id) REFERENCES notification_intents (tenant_id, id) NOT VALID;

-- merged_into_membership_id is NULLABLE — MATCH SIMPLE leaves the composite
-- unenforced while it is NULL (every non-merged membership), enforced the
-- moment a merge sets it. Self-referencing: targets memberships' OWN
-- (tenant_id, id) candidate key, already added by 0019.
ALTER TABLE memberships
  ADD CONSTRAINT memberships_tenant_merged_into_fk
  FOREIGN KEY (tenant_id, merged_into_membership_id) REFERENCES memberships (tenant_id, id)
  MATCH SIMPLE NOT VALID;

-- ---- 3. VALIDATE each composite FK, converting a violation to a NAMED halt --
-- Detection is via VALIDATE CONSTRAINT (RLS-independent), NOT a SELECT scan
-- (see the header note / 0019's codex round-02 [P2]). Each VALIDATE runs in
-- its own BEGIN/EXCEPTION subtransaction; a foreign_key_violation is caught
-- and re-raised naming the child table, the relationship, and the offending
-- (tenant_id, fk) key from the FK error detail. A clean table validates
-- instantly; the first offender aborts the whole migration in one piece
-- (migrate.ts wraps each file in a single transaction). No auto delete/re-parent.
DO $$
DECLARE
  r record;
  v_detail text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('zalo_reply_contexts',    'zalo_reply_contexts_tenant_bot_fk',        '(tenant_id, bot_id) -> zalo_bots'),
      ('notification_deliveries','notification_deliveries_tenant_intent_fk', '(tenant_id, intent_id) -> notification_intents'),
      ('memberships',            'memberships_tenant_merged_into_fk',        '(tenant_id, merged_into_membership_id) -> memberships')
    ) AS t(child_table, constraint_name, rel)
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', r.child_table, r.constraint_name);
    EXCEPTION WHEN foreign_key_violation THEN
      GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
      RAISE EXCEPTION 'tenant-integrity halt (0021): table % has a cross-tenant row on % — %  Owner must resolve this row before 0021 can apply (this migration never deletes or re-parents a row).',
        r.child_table, r.rel, COALESCE(NULLIF(v_detail, ''), '(offending key unavailable)')
        USING ERRCODE = 'raise_exception';
    END;
  END LOOP;
END $$;
