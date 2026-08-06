<!-- review-readiness: code-ready -->
# AP-50 — chat-dm-safety-authority-core: DD-55 DM safety authority contract

> **Status:** `CODE_READY` (see verdict, §10) · **Authored:** 2026-08-05 · **Risk:** P1 (preparation-only —
> no worktree opened, no code written)
> **This is an AUTHORING artifact.** No `register` has been attempted, no worktree exists. Slice 2 of
> the serialized DB lane `chat-definer-role-provisioning → chat-dm-safety-authority-core →
> dd38-dd86-chat-schema-core → tenant-capability-authority-core`. Unlike its root sibling
> (`dd38-dd86-chat-schema-core`, AP-45), the primary-surface plan does **not** pin an exact-file
> packet for this slice (§9.2 only pins slice 1) — authoring this is real design work, not
> transcription, per the backlog stub's own note.

## 0. Session input

```text
REQUEST: final-readiness (authoring, not implementation)
TARGET_FILES:
  - docs/proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md (v1.8, §8.3/§9 row 2/§9.2)
  - docs/features/BE/feature_inapp_chat_tech.md (v0.23, §"DD-55 design-probe gates", §2 DDL, §4/§5)
  - docs/features/feature_inapp_chat.md (v0.15, CHT-OQ-1/2/3)
  - docs/standards/decisions.md (DD-55 full entry + DD-38/48/86/91-95 cross-refs)
  - docs/standards/business-rules.md (BL-SEC-5 rate-limit registry, BL-SEC-6 audit retention, BL-SOC-5)
  - docs/standards/core-db-architecture-principles.md (v1.8 — P1/P2/P4/P6/P7/P8/P17, §3.1 planes)
  - docs/autopilot-backlog.md (task chat-dm-safety-authority-core)
  - docs/autopilot/contracts/autopilot-dd38-dd86-chat-schema-core.md (AP-45 — downstream consumer, its own launcher
    blocks on this slice existing)
  - docs/autopilot-manifests/dd38-dd86-chat-schema-core.json (exact consumer DDL for
    dm_current_read_allowed — the literal caller contract this slice must satisfy)
  - infra/postgres-init/02-chat-definer.sql (live, merged — role this slice's functions are owned by)
  - packages/db/schema.ts (live, 1409 lines at base — table export list surveyed, no `chat_*`)
  - packages/db/migrations/0009_rls_policies_grants.sql (RLS/grant idiom; global-protected-plane model)
  - packages/db/migrations/0012_auth_functions.sql (SECURITY DEFINER idiom; canonical
    `rate_limit_check` — BL-SEC-5 shared counter, reused not re-invented)
  - packages/db/src/tenant.ts, packages/db/src/test-harness.ts (GUC/test-context idiom)
  - packages/db/README.md (per-migration documentation convention)
  - docs/autopilot-invariant-catalog.md (`schema` token)
  - docs/autopilot-manifests/db-tenants-authz-grant-security-definer.json (`dep_checks` shape precedent)
EXPECTED_OUTCOME: CODE_READY (target); actual = CODE_READY, see §10
BASE_BRANCH: main
SCOPE_REPO: /Users/maingocanh/Projects/Plexco app
USER_AUTHORIZED_EDITS: yes (authoring this packet + manifest + launcher + backlog update only; no
  register/worktree/code)
```

## 1. What this slice is

Slice 2 of the DD-38/DD-86 chat tree. The canonical DD-55 DM-safety authority: storage for block/
report/rate/audit state, the two **pure predicates** `dm_safety_enabled()` and `chat_pair_blocked()`
that root's RLS-adjacent read adapter (`dm_current_read_allowed`, already pinned verbatim in
`dd38-dd86-chat-schema-core`'s own contract) calls, and the one **side-effecting fail-closed gate**
`assert_dm_allowed(actor, peer, action)` that every DM-mutating command (`create_dm`, `send_chat_message`,
`mark_read` — owned by later slices 7/8) must call before doing anything else. Exactly one new
migration.

It does **not** own: any `chat_*` content table (`chat_channels`/`chat_members`/`chat_messages` —
root's deliverable, slice 3), the `chat_definer` role itself (slice 1's deliverable, already merged),
`create_dm`/`send_chat_message`/`mark_read`/block-report-unblock RPCs (slices 7/8's deliverable), any
HTTP route, or the DD-56 capability registry. See §8 for the full negative-scope list.

## 2. Authority pins

- **Immutable decision authority:** `90d292d85fbe92db7a5afcd118a99e28f3d3b3b7` — the same 27-file
  chat authority pack `dd38-dd86-chat-schema-core` pins; DD-55 is inside that pack
  (`docs/standards/decisions.md`, ratified 2026-07-16, reconciled inside the pack 2026-07-28).
- **Live base (verified 2026-08-05, this session):** `5cad41f4d7f6d47a2f591a1d70c75885568cb4b0` =
  `origin/main` = `main` (`git rev-parse HEAD` and `git rev-parse origin/main` both returned this SHA;
  `git status --porcelain` shows only untracked, unrelated WIP — `design.pen`,
  `docs/autopilot-templates/level3.1-design-discussion.md`, `docs/channels/web/FE/`,
  `docs/channels/web/docs_comparison.md`, `docs/sessions/`,
  `docs/templates/feature-dev/fe-spec-template.md` — none touch chat/schema/safety).
- **Why two SHAs:** identical rationale to AP-45 §2 — `90d292d` is the frozen product/decision
  snapshot; this packet separately re-verifies live-repo truth (migration tail, dependency landing
  state, absence of `chat_*`) against the current base, never conflating the two.

## 3. Live-repo verification (2026-08-05)

| Claim | Method | Result |
|---|---|---|
| No `chat_*` schema/function exists yet | `grep -rli "chat_channels\|chat_definer" --include="*.ts" --include="*.sql" .` (excl. node_modules) | Only `infra/postgres-init/01-job-definer.sql`/`02-chat-definer.sql` and `packages/db/src/migrate.test.ts` (test harness for the role bootstrap) — zero `chat_*` table/function/migration |
| Migration tail | `ls packages/db/migrations/*.sql \| sort \| tail -3` | `0027_resolve_tenant_status_locked.sql`, `0028_dd29_capability_registry_expand.sql`, `0029_dd29_capability_registry_contract.sql` — **tail is `0029`, not `0027`** (AP-45's own doc, authored 2026-08-03, guessed `0029` for *itself*; two unrelated DD-29 billing migrations have since consumed that number — confirms AP-45's own "provisional, re-derive" caveat was correct to include) |
| `0028`/`0029` are NOT the DD-56/DD-29 chat-capability slice | `grep -n "^## DD-29" docs/standards/decisions.md` + `head -30 packages/db/migrations/0028_*.sql` | DD-29 = "Phase-1 pricing pivot: free web + bot... Host Pro" (billing/plan tiers) — unrelated to DD-56 co-admin capability registry (`tenant-capability-authority-core`, catalog slice 4, still unbuilt). No naming collision in the dependency graph, just two different decisions that both happen to involve a table called "capability/registry" in prose. |
| Dependency `chat-definer-role-provisioning` (slice 1) landed? | `ls infra/postgres-init/` + `git log --oneline --all \| grep -i chat.definer` | `02-chat-definer.sql` present; landing commit `286f48bbbd5b9f41c3e63e5f201ecfd276706bff` (`feat(db): provision the chat_definer role — bootstrap script, no migration`), later hardened by `b55d628` (AP-49, cluster-wide serialization) — **slice 1 is merged** |
| `chat_definer` role attributes as bootstrapped | Read `infra/postgres-init/02-chat-definer.sql` in full | `NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`, idempotent, fails closed on attribute drift/runtime-role grant/re-pointing. No schema `USAGE`/`CREATE` granted by the bootstrap itself — the first migration to `ALTER FUNCTION ... OWNER TO chat_definer` must grant+revoke `CREATE ON SCHEMA public` itself (root's own doc already establishes this pattern; this slice is now the one that runs first) |
| Canonical shared rate limiter exists and is reusable | Read `packages/db/migrations/0012_auth_functions.sql` | `rate_limit_check(p_bucket text, p_limit integer, p_window interval) RETURNS boolean`, `SECURITY DEFINER`, advisory-lock-serialized sliding window, self-sweeping retention (BL-SEC-5). Currently granted only to `app` — this slice must add a `chat_definer` grant, not re-invent a chat-specific rate table |
| `chat_blocks`/`chat_reports` naming is pinned, not free choice | repo-wide grep across `docs/` | ≥15 independent references (`decisions.md` DD-55/§955/§632, `business-rules.md` BL-SOC-5, `feature_user_settings*.md` ×7, `feature_inapp_chat*.md`, `dd-73-78-share-activity-analysis.md`, `dd-48-profile-visibility-analysis.md`) all use the exact name `chat_blocks` as the canonical, cross-feature (chat + social/follow + User Settings) block store — "không tạo store thứ hai" appears verbatim three times. `chat_reports` is named once alongside it (`feature_inapp_chat.md:149`) as "schema pending" |
| No prior audit-table FK-to-person precedent to break | `packages/db/schema.ts` — `mergeAudit`, `routingAudit` | Neither `sourcePersonId`/`targetPersonId`/`canonicalPersonId`/`actorId` carries a `.references()` call — audit rows are deliberately independent of the referenced row's later lifecycle (merge/deletion) |
| Global-protected (non-RLS) plane precedent | `packages/db/migrations/0009_rls_policies_grants.sql` | `persons`/`accounts`/`web_sessions`/etc. are explicitly **excluded** from the `tenant_tables` RLS array and get **zero** grant to `app`/`readonly`; comment: "(Intentionally no GRANT statements — least privilege.)" — this is the exact plane DM-safety storage belongs to (cross-tenant, person-scoped, never queried by `app` directly) |
| `merged_probe` candidate is slice-unique | `grep -rn "dm_safety_enabled" packages/ infra/ docs/standards/ docs/features/` | Zero hits in live code (only in not-yet-landed spec/plan/AP-45-doc prose) — safe as a future merged-probe symbol |

## 4. Dependency graph

```text
1 chat-definer-role-provisioning (MERGED, 286f48b)
   → 2 chat-dm-safety-authority-core (THIS SLICE)
      → 3 dd38-dd86-chat-schema-core (blocked on this slice; its own migration calls
          dm_safety_enabled() and does ALTER FUNCTION ... OWNER TO chat_definer)
         → 4 tenant-capability-authority-core (collision-only dep on slice 3)
```

### 4.1 Dependency proof (`dep_checks`, same shape as `db-tenants-authz-grant-security-definer.json`)

| Field | Value |
|---|---|
| feature | `chat-definer-role-provisioning` |
| base_sha | `de78394493cf448ddc7f4a35f8483373ddf1d0c7` (parent of the landing commit — confirmed `infra/postgres-init/02-chat-definer.sql` does not exist at this SHA: `git show <sha>:<path>` → "exists on disk, but not in `<sha>`"; `git grep chat_definer <sha>` → zero hits repo-wide) |
| landed_sha | `286f48bbbd5b9f41c3e63e5f201ecfd276706bff` (`feat(db): provision the chat_definer role — bootstrap script, no migration`) |
| file | `infra/postgres-init/02-chat-definer.sql` |
| symbol | `chat_definer` |

Both `base_sha` and `landed_sha` are ancestors of the current live base `5cad41f`, and the symbol is
present at both `landed_sha` and the live base (`git show HEAD:infra/postgres-init/02-chat-definer.sql`
confirmed non-empty, matching content). This is a same-order, verified proof, not a placeholder.

### 4.2 Why slice 3 cannot skip this slice (mechanical, not sequencing preference)

`dd38-dd86-chat-schema-core`'s own pinned DDL (its contract §5.1, verbatim from the Reviewed BE spec)
contains:

```sql
CREATE FUNCTION dm_current_read_allowed(p_channel uuid) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT dm_safety_enabled()
     AND EXISTS ( ... AND NOT chat_pair_blocked(me.person_id, peer.person_id));
$$;
```

`dm_safety_enabled()` and `chat_pair_blocked()` do not exist until this slice lands — root's migration
cannot even apply without them (undefined function → migration fails, not "runs with reduced safety").
This is exactly the same class of mechanical dependency AP-45's own `chat_current_is_member`/
`ALTER FUNCTION ... OWNER TO chat_definer` has on slice 1.

## 5. Design probe (DESIGN_PROBE_REQUIRED — fires on identity/safety authority, new mechanism, and
schema/migration; all three trigger here)

The primary-surface plan pins the *shape* of this slice ("block/report/rate/audit storage + pure
predicates + `assert_dm_allowed`; exact grants/retention/invariant tests", plan line 422) and the
*consumer contract* (root's exact calls to `dm_safety_enabled()`/`chat_pair_blocked()`, above), but
does **not** pin exact table columns, the kill-switch mechanism, rate-limit bucket keys/numbers, or
the audit table shape. Those are this session's own design work. All resolved at **Tier 1** (algorithm/
data-shape/code-organization — mine to decide); none required Tier 2/3 escalation. Each row below
states the choice, the rejected alternative(s), and why.

| # | Decision | Chosen | Alternative(s) considered — rejected because |
|---|---|---|---|
| 1 | Rate-limit storage | **Reuse** `rate_limit_check(bucket,limit,window)` (0012, BL-SEC-5 canonical shared counter); grant `chat_definer` EXECUTE on it | A dedicated `chat_dm_rate_hits` table — rejected: DRY violation, this exact mechanism (advisory-lock-serialized sliding window with self-sweeping retention) already exists, is tested, and BL-SEC-5 is explicitly "một counter store cho ALL replicas" |
| 2 | Kill-switch mechanism (4 independently-disableable capabilities, required by BE spec test #28) | Singleton DB table `chat_dm_safety_config` (PK `singleton boolean CHECK (singleton)`, 4 named booleans), read by `dm_safety_enabled()` | (a) Env var (`OUTBOX_DISPATCH_SCHEDULE_ENABLED` precedent) — rejected: `dm_safety_enabled()` is called from inside a `STABLE` SQL function reached via RLS/SECURITY DEFINER, including by direct-`psql`-as-`app` test harnesses (test #28's own scenario) that never go through the Node app layer at all; an env var has no path into that context without a fragile per-connection GUC bridge. (b) No toggle, hardcode `true` — rejected: test #28 explicitly requires disabling any one of the four independently and observing fail-closed; there is no way to write that test without a flippable, DB-native switch |
| 3 | `chat_blocks` shape | Current-state relation: `PRIMARY KEY (blocker_person_id, blocked_person_id)`, row exists ⇔ blocked. Block = idempotent insert, unblock = delete (both owned by slice 8, not this slice) | Append-only log with an `active` flag — rejected: no history requirement anywhere in DD-55/spec; `chat_pair_blocked` only ever needs a present/absent answer, and the simpler shape is what "loại hai chiều" (bidirectional exclusion) naturally maps to (predicate checks both directions at query time, not at write time) |
| 4 | `chat_reports` — channel reference | **No** `channel_id` column; row keyed by the `(reporter_person_id, reported_person_id)` pair only | A `channel_id uuid REFERENCES chat_channels(id)` — rejected, and not just stylistically: `chat_channels` **does not exist yet** at this migration's position in the dependency order (root/slice 3 lands *after* this slice). Adding that FK here is a forward reference to a table this slice structurally cannot see; DM identity is already fully expressed by the person pair (`dm_key = least(a,b):greatest(a,b)` is root's own scheme), so no information is lost |
| 5 | `chat_reports` reason vocabulary | Reuse DD-95's exact set `spam\|harassment\|unsafe\|off_topic\|other`, plus DD-95's "other requires a bounded note, every non-other rejects a note" shape (note ≤500 chars) | A DM-specific vocabulary — rejected: one taxonomy across the chat safety surface avoids parallel-vocabulary drift; DD-55 and DD-95 are siblings in the same feature family and nothing in either spec calls for divergent categories |
| 6 | `chat_dm_safety_audit` write granularity | Log **denials only** (one row per failed `assert_dm_allowed` call, with the real reason) | Log every call (allow + deny) — rejected: unbounded volume with no abuse-forensics value over what `rate_limit_hits` (already logs every hit) and message history already capture; "abuse audit" is naturally about denied/abusive attempts, not routine traffic |
| 7 | `chat_dm_safety_audit` — FK to `persons` | **No** FK on `actor_person_id`/`peer_person_id` | FK to `persons(id)` — rejected: breaks the established `merge_audit`/`routing_audit` precedent in this exact codebase, where audit rows are deliberately independent of the referenced person's later merge/lifecycle (an audit record must survive a merge that re-parents or tombstones the person it names) |
| 8 | RLS posture for all 4 new tables | **No RLS**, **zero grant to `app`/`readonly`** — global-protected plane, reached only via `chat_definer`-owned `SECURITY DEFINER` functions | RLS keyed on `app.tenant_id` (root's own idiom) — rejected: DM safety is a cross-tenant, person-level concern (`tenant_id` does not even apply — DM channels have `tenant_id IS NULL`); `app` never needs direct access to these tables at all (every access is mediated), which is exactly the `persons`/`accounts` model already established in `0009`, not the tenant-isolation model |
| 9 | `assert_dm_allowed` rate-check scope across its 3 actions (`create`/`send`/`read`) | Enforce `dm_safety_enabled()` + `chat_pair_blocked()` uniformly for all 3 actions; enforce the sender/target **rate** dimension only for `create`/`send`, **skip it for `read`** | Rate-limit `read` too (uniform for all 3) — rejected: `mark_read` (the only caller of `assert_dm_allowed(...,'read')`) is receiver-side bookkeeping invoked on ordinary UI scroll/view activity, not a spam vector; root's own `dm_current_read_allowed` RLS predicate (the actual message/channel read boundary) never has a rate dimension either — rate-limiting `read` would risk locking an active legitimate user out of their own inbox for normal usage |
| 10 | Rate dimensions | Exactly **2** buckets: `chat_dm_sender:<actor>` and `chat_dm_target:<peer>`, each covering both `create` and `send` uniformly | 4 buckets (separate create/send × sender/target) — rejected as premature: decisions.md line 690 literally says "per-sender và per-target" (two dimensions), test #30's title is "Sender-target throttle" (two, not four); 2 buckets already satisfy the literal decision text and the acceptance test, and can be split later via a forward migration (P12) if real traffic data shows a need |
| 11 | Numeric limits — **value and storage location** | Value: `30` per bucket per `interval '1 minute'`, unchanged. Storage: **`chat_dm_safety_config.dm_sender_limit_per_min`/`dm_target_limit_per_min`** (integer columns, `CHECK > 0`), read at call time — **not** a literal baked into `assert_dm_allowed`'s body (this contract's original choice, corrected 2026-08-05) | No existing DD/spec pins an exact number; the `30` itself is still anchored against the closest BL-SEC-5 registry tiers already in this repo (`Session CRUD 60/min`, `Chat command execute 60/min` (DD-91, not yet implemented), `Identity link-code 5/min`) — a midpoint slightly stricter than general chat-command traffic while staying well above legitimate rapid-conversation cadence. **Storage location, on reflection:** a hardcoded literal — this session's own original choice — was inconsistent with the reasoning row 2 already used to put the four kill-switch flags in `chat_dm_safety_config` instead of an env var (unreachable from this call context, so config has to be DB-native). That same argument applies unchanged to the two numbers: under P17 (migrations are forward-only, no reverse runbook), retuning a hardcoded literal requires an entirely new migration that recreates this `SECURITY DEFINER` function's body — full code+security review for what is purely an operational number, not a behavior change. A config column makes retuning a single `UPDATE`, auditable via `updated_at`, no migration, no redeploy. Still this slice's own implementation default, not an owner-ratified number — only *where it lives* changed, not who gets to change it or how confident this session is in `30` specifically |
| 12 | Indexes | **None beyond the 4 tables' own PK/unique/FK-backed indexes** — no `idx_chat_blocks_blocked`, no `idx_chat_reports_reported` | Added reverse-lookup indexes for a future "who blocked me" / "reports against me" UI — rejected for this slice: no function this slice creates queries by `blocked_person_id`/`reported_person_id`; `chat_pair_blocked`'s OR-of-two-equalities is already served by the `chat_blocks` primary key (leading column covers both branches). A speculative index guessed at the wrong shape is worse than no index; the slice that actually needs the reverse query (a future block-management/report-triage UI) adds the exact index its own access pattern needs, per P14 |
| 13 | Grants on `chat_blocks`/`chat_reports` in this slice | `chat_definer` gets `SELECT` on `chat_blocks` only (needed by `chat_pair_blocked`); **zero** grant on `chat_reports` at all (nothing in this slice reads or writes it) | Pre-granting `INSERT`/`UPDATE`/`DELETE` now for slice 8's future convenience — rejected: repeats exactly the failure mode root's own doc (AP-45 §7) explicitly avoided for `chat_channels`/`chat_members`/`chat_messages` — "never grant a capability whose full lifecycle has no owner yet." Slice 8 adds its own grant in its own migration when it lands the block/report RPCs |
| 14 | Denial error text | Reuse the **exact existing string** `'chat safety blocked'`, already pinned verbatim in the Reviewed spec's `send_chat_message` DDL (`feature_inapp_chat_tech.md:684`, `dd38-dd86-chat-schema-core` contract §5.1) | Inventing a new message — rejected: the Reviewed spec already established this exact generic string at the RLS/DML boundary for the identical "no block-detail leak" requirement; reusing it means one wire-visible error for the whole DM-safety surface by construction |

**Escalation check:** none of the 14 rows above found evidence against the chosen option that this
session could not resolve — each is an ordinary implementation detail consistent with ratified DD-55
and this codebase's own established conventions (reuse over invention, global-protected plane for
non-tenant data, audit-independent-of-live-row precedent). No Tier 2 (what's-in-this-slice, round
budget, destructive/irreversible, ship order, split-vs-merge) or Tier 3 (flip ratified policy)
question arose: every `CREATE` in §6 is fresh/additive (P17 — nothing destructive, nothing to roll
back), ship order matches the plan's own explicit slice-2 position, and no ratified DD-55/86/91-95
behavior is touched, only implemented. Nothing was escalated to the founder in this session.

## 6. Scope — exact DDL (verbatim; the future implementer copies this into the migration, does not
re-derive it)

### 6.1 Migration body

```sql
-- ============================================================================
-- 0030_chat_dm_safety_authority_core.sql   -- number is PROVISIONAL, see §7
-- chat-dm-safety-authority-core (slice 2 of the DD-38/DD-86 chat tree).
-- Canonical DD-55 DM safety authority: block/report/rate/audit storage plus
-- the pure predicates and fail-closed gate that dd38-dd86-chat-schema-core
-- (slice 3) and every later DM-touching slice (7/8) call into. Creates no
-- chat_* content table -- those are root's own deliverable (slice 3).
-- Source: docs/autopilot/contracts/autopilot-chat-dm-safety-authority-core.md, decisions.md
--         DD-55, feature_inapp_chat_tech.md v0.23 section "DD-55 design-probe
--         gates" / section 2 (helper idiom) / section 4-5.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- chat_dm_safety_config -- singleton kill-switch + tuning row. Four
-- independent capability toggles; dm_safety_enabled() is their AND. Global
-- protected: no RLS (not tenant-scoped), zero grant to app/chat_definer for
-- writes -- flipped only via direct DDL-owner/superuser access, never
-- through the application. All boolean flags default true: this migration
-- ships all four subsystems complete, so there is no reason to land it
-- pre-disabled.
--
-- dm_sender_limit_per_min/dm_target_limit_per_min carry the same two
-- numbers previously hardcoded as literal arguments inside
-- assert_dm_allowed() (30 each -- see contract SS5 design-probe row 11).
-- Moved here for the identical reason the four booleans are here and not in
-- an env var: this table is read from inside SECURITY DEFINER functions
-- reached via direct-role test harnesses and future RPCs that never touch
-- the Node app layer, so config has to be DB-native. Under P17 (migrations
-- are forward-only, no reverse runbook), a hardcoded literal can only be
-- retuned by a brand-new migration that recreates this function's body --
-- full code+security review for what is purely an operational number.
-- A config column makes retuning a plain UPDATE. CHECK > 0 on both: a
-- typo'd UPDATE that sets either to 0 must fail loudly at write time, not
-- silently turn into "0 allowed per minute" (i.e. the limiter effectively
-- always denies, indistinguishable from a self-inflicted outage) discovered
-- only when DM traffic stops.
-- ---------------------------------------------------------------------------
CREATE TABLE chat_dm_safety_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  block_enabled boolean NOT NULL DEFAULT true,
  report_enabled boolean NOT NULL DEFAULT true,
  rate_limit_enabled boolean NOT NULL DEFAULT true,
  audit_enabled boolean NOT NULL DEFAULT true,
  dm_sender_limit_per_min integer NOT NULL DEFAULT 30
    CONSTRAINT chat_dm_safety_config_sender_limit_positive_chk CHECK (dm_sender_limit_per_min > 0),
  dm_target_limit_per_min integer NOT NULL DEFAULT 30
    CONSTRAINT chat_dm_safety_config_target_limit_positive_chk CHECK (dm_target_limit_per_min > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO chat_dm_safety_config (singleton) VALUES (true);

-- ---------------------------------------------------------------------------
-- chat_blocks -- canonical, cross-feature block-pair store (DD-55: "dùng
-- chung chat/social/User Settings, không tạo store thứ hai"). Current-state
-- relation, not a log: a row means "blocker currently blocks blocked".
-- Direction stored once; chat_pair_blocked() checks both directions, so the
-- effect is symmetric even though storage is directional (records WHO
-- acted). Write path (INSERT on block / DELETE on unblock) belongs to
-- chat-dm-lifecycle-command-core (slice 8) -- this migration grants no
-- INSERT/UPDATE/DELETE to chat_definer, only the SELECT its own predicate
-- needs; slice 8's own migration adds its own grant when it lands the RPC,
-- matching root's "never grant a capability whose lifecycle has no owner"
-- rule for chat_channels/members/messages.
-- ---------------------------------------------------------------------------
CREATE TABLE chat_blocks (
  blocker_person_id uuid NOT NULL REFERENCES persons(id),
  blocked_person_id uuid NOT NULL REFERENCES persons(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_person_id, blocked_person_id),
  CHECK (blocker_person_id <> blocked_person_id)
);

-- ---------------------------------------------------------------------------
-- chat_reports -- canonical DM abuse report store. Workflow state machine
-- submitted -> triaged -> actioned|closed (feature_inapp_chat_tech.md line
-- 50). No channel_id: DM identity is the (reporter,reported) pair itself
-- (dm_key = least(a,b):greatest(a,b), root's own scheme), and chat_channels
-- does not exist yet at this migration's position in the dependency order
-- (slice 3 lands after this one) -- a channel_id FK here would be a forward
-- reference to a table this slice cannot see. Reason vocabulary reuses
-- DD-95's exact set for one taxonomy across the chat safety surface, not a
-- parallel one. Triage/action write path belongs to a future support/ops
-- tool, out of this slice's scope; this migration grants no mutation to
-- chat_definer or app on this table for the same "no owner yet" reason as
-- chat_blocks.
-- ---------------------------------------------------------------------------
CREATE TABLE chat_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_person_id uuid NOT NULL REFERENCES persons(id),
  reported_person_id uuid NOT NULL REFERENCES persons(id),
  reason_code text NOT NULL
    CHECK (reason_code IN ('spam','harassment','unsafe','off_topic','other')),
  note text,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','triaged','actioned','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reporter_person_id <> reported_person_id),
  CHECK (
    (reason_code = 'other' AND note IS NOT NULL AND length(btrim(note)) BETWEEN 1 AND 500)
    OR (reason_code <> 'other' AND note IS NULL)
  )
);

-- ---------------------------------------------------------------------------
-- chat_dm_safety_audit -- append-only abuse-forensics log. Records only
-- DENIALS from assert_dm_allowed (not every call -- see design probe row 6
-- for the volume/signal tradeoff): what would otherwise be invisible ops
-- telemetry, since the caller only ever sees a generic error (no
-- block-detail leak, feature_inapp_chat_tech.md line 1186). No FK on the
-- person columns, matching merge_audit/routing_audit's existing convention
-- in this codebase -- an audit row must survive independent of the
-- referenced person's later merge/lifecycle. No delete/retention sweep
-- (BL-SEC-6: audit logs are archived after retention, never deleted); a
-- created_at index exists for that future archival job and for ops
-- "what got denied and why" queries, mirroring auth_audit_events'
-- created_at index.
-- ---------------------------------------------------------------------------
CREATE TABLE chat_dm_safety_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_person_id uuid NOT NULL,
  peer_person_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('create','send','read')),
  deny_reason text NOT NULL
    CHECK (deny_reason IN ('safety_disabled','blocked','rate_limited_sender','rate_limited_target')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_dm_safety_audit_created_at ON chat_dm_safety_audit(created_at);

-- ---------------------------------------------------------------------------
-- dm_safety_enabled() -- pure predicate, the AND of all four capability
-- toggles. Missing config row (should never happen -- inserted above, no
-- delete grant to anyone) still fails closed via COALESCE, not an error.
-- ---------------------------------------------------------------------------
CREATE FUNCTION dm_safety_enabled() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(
    (SELECT block_enabled AND report_enabled AND rate_limit_enabled AND audit_enabled
       FROM chat_dm_safety_config WHERE singleton),
    false
  );
$$;
REVOKE ALL ON FUNCTION dm_safety_enabled() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- chat_pair_blocked(a, b) -- pure predicate, direction-agnostic (checks
-- both storage directions -- DD-55 "loại hai chiều").
-- ---------------------------------------------------------------------------
CREATE FUNCTION chat_pair_blocked(p_a uuid, p_b uuid) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM chat_blocks
    WHERE (blocker_person_id = p_a AND blocked_person_id = p_b)
       OR (blocker_person_id = p_b AND blocked_person_id = p_a)
  );
$$;
REVOKE ALL ON FUNCTION chat_pair_blocked(uuid, uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- assert_dm_allowed(actor, peer, action) -- side-effecting fail-closed gate.
-- Called by create_dm/send_chat_message (slice 8/7 owners) for
-- action IN ('create','send'), and by mark_read (slice 7) for action =
-- 'read'. Order: malformed input -> disabled -> blocked -> sender rate ->
-- target rate; rate dimensions are skipped for 'read' (mark_read is
-- receiver-side bookkeeping, not a spam vector -- dm_current_read_allowed,
-- root's own RLS predicate, never rate-limits reads either). On any deny,
-- writes ONE audit row with the real reason, then raises the SAME generic
-- message the Reviewed spec already uses at the RLS boundary
-- (feature_inapp_chat_tech.md:684, send_chat_message) -- one wire-visible
-- error text for the whole DM safety surface, by construction, not by
-- convention someone has to remember.
--
-- The two rate limits are read from chat_dm_safety_config on every call,
-- the same COALESCE-wrapped-scalar-subquery-to-fail-closed idiom
-- dm_safety_enabled() itself already uses, not a fresh pattern. A missing
-- config row (should never happen -- see that table's own header) COALESCEs
-- to 0, which makes rate_limit_check deny unconditionally (v_count >= 0 is
-- true even for a brand-new bucket) -- fail-closed defense in depth, even
-- though dm_safety_enabled()'s own identical missing-row COALESCE already
-- denies first via the IF/ELSIF chain below and would prevent this branch
-- from ever being reached with a NULL-turned-0 limit in practice. Belt and
-- suspenders on purpose: this function's fail-closed property should not
-- depend on the two checks staying in this exact order forever.
-- ---------------------------------------------------------------------------
CREATE FUNCTION assert_dm_allowed(p_actor uuid, p_peer uuid, p_action text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_deny_reason text;
  v_sender_limit integer;
  v_target_limit integer;
BEGIN
  IF p_action NOT IN ('create','send','read') THEN
    RAISE EXCEPTION 'assert_dm_allowed: invalid action' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_actor IS NULL OR p_peer IS NULL OR p_actor = p_peer THEN
    RAISE EXCEPTION 'assert_dm_allowed: invalid participants' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_sender_limit := COALESCE((SELECT dm_sender_limit_per_min FROM chat_dm_safety_config WHERE singleton), 0);
  v_target_limit := COALESCE((SELECT dm_target_limit_per_min FROM chat_dm_safety_config WHERE singleton), 0);

  IF NOT dm_safety_enabled() THEN
    v_deny_reason := 'safety_disabled';
  ELSIF chat_pair_blocked(p_actor, p_peer) THEN
    v_deny_reason := 'blocked';
  ELSIF p_action IN ('create','send')
        AND NOT rate_limit_check('chat_dm_sender:' || p_actor::text, v_sender_limit, interval '1 minute') THEN
    v_deny_reason := 'rate_limited_sender';
  ELSIF p_action IN ('create','send')
        AND NOT rate_limit_check('chat_dm_target:' || p_peer::text, v_target_limit, interval '1 minute') THEN
    v_deny_reason := 'rate_limited_target';
  END IF;

  IF v_deny_reason IS NOT NULL THEN
    INSERT INTO chat_dm_safety_audit(actor_person_id, peer_person_id, action, deny_reason)
    VALUES (p_actor, p_peer, p_action, v_deny_reason);
    RAISE EXCEPTION 'chat safety blocked' USING ERRCODE = 'insufficient_privilege';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION assert_dm_allowed(uuid, uuid, text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Owner/grant block -- REQUIRES chat_definer role (chat-definer-role-
-- provisioning, merged) to exist first. Mirrors dd38-dd86-chat-schema-
-- core's own GRANT CREATE / ALTER OWNER / REVOKE CREATE dance exactly
-- (PG16: new owner needs CREATE on the function's schema at ALTER-OWNER
-- time only); this is the FIRST migration to do it, since this slice lands
-- before root. Owner implicitly has EXECUTE on its own functions -- no
-- separate GRANT EXECUTE ... TO chat_definer needed for the three
-- functions this migration creates.
-- ---------------------------------------------------------------------------
GRANT USAGE, CREATE ON SCHEMA public TO chat_definer;
ALTER FUNCTION dm_safety_enabled() OWNER TO chat_definer;
ALTER FUNCTION chat_pair_blocked(uuid, uuid) OWNER TO chat_definer;
ALTER FUNCTION assert_dm_allowed(uuid, uuid, text) OWNER TO chat_definer;
REVOKE CREATE ON SCHEMA public FROM chat_definer;

GRANT SELECT ON chat_dm_safety_config TO chat_definer;
GRANT SELECT ON chat_blocks TO chat_definer;
GRANT INSERT ON chat_dm_safety_audit TO chat_definer;
GRANT EXECUTE ON FUNCTION rate_limit_check(text, integer, interval) TO chat_definer;

-- No grant of any kind to app/app_worker/readonly on any of the four
-- tables above: all global protected (not tenant-scoped -- DM is
-- cross-tenant/person-scoped, RLS keyed on app.tenant_id would be the
-- wrong boundary here), reached only through chat_definer-owned
-- SECURITY DEFINER functions -- same model as persons/accounts (0009).
-- No grant on chat_reports at all: nothing in this slice reads or writes
-- it (see design probe row 13); slice 8 grants what it needs when it
-- lands the report RPC.
```

Estimated ~150 lines including comments — well inside the plan's `≤750 changed LOC` B3 exception for
this slice (plan line 409).

### 6.2 Schema mirror (`packages/db/schema.ts`)

Add Drizzle definitions for `chatDmSafetyConfig`, `chatBlocks`, `chatReports`, `chatDmSafetyAudit`
matching the DDL above exactly (column names, nullability, defaults, checks) — including
`chatDmSafetyConfig`'s two new integer columns `dmSenderLimitPerMin`/`dmTargetLimitPerMin` and their
named `chat_dm_safety_config_sender_limit_positive_chk`/`chat_dm_safety_config_target_limit_positive_chk`
constraints. Every `CHECK`/`UNIQUE`/FK constraint must use an explicit declared name via Drizzle's
`check()`/`unique()`/`foreignKey()` builders (e.g. `chat_blocks_no_self_chk`, `chat_reports_note_shape_chk`),
matching this repo's existing convention (`notif_deliveries_status_chk` precedent, tail of `schema.ts`)
— this is what lets `rls-invariants.test.ts`'s generic CND (check-constraint-naming-drift) guard cover
these new tables automatically; **no edit to `rls-invariants.test.ts` is needed**, same reasoning root's
own contract (§5.2) already established.

### 6.3 Focused invariant test — new file

`packages/db/src/chat-dm-safety-invariants.test.ts` (kebab-case, matching `chat-schema-invariants.test.ts`'s
naming convention from the sibling slice — do not extend `rls-invariants.test.ts`/`auth.test.ts`, both
already 4000+ lines). Reuses `setupRlsTestContext` from `test-harness.ts`; connects with a privileged
test role (not `app`) to seed `chat_blocks`/`chat_dm_safety_config` fixtures directly (this slice owns
no write RPC, so fixture setup is direct SQL, exactly as root's own test plan directly manipulates
`chat_members` to test RLS in isolation). Must cover the full acceptance matrix in §9 — the negative-
proof rows (blocked pair denies both directions, disabled-capability denies, rate-limit denies,
read is never rate-limited, no block-detail in the raised exception) are the actual point of this
slice; do not ship only happy-path coverage.

`packages/db/src/migrate.test.ts` needs the same mechanical literal bump (migration count/tail
filename) the `dd38-dd86-chat-schema-core` and `db-tenants-authz-grant-security-definer` manifests both
pre-declared for the identical reason — declared here to not repeat that lesson a third time.

### 6.4 Full scope list

```text
packages/db/migrations/0030_chat_dm_safety_authority_core.sql   -- SEE §7 — number is provisional
packages/db/schema.ts
packages/db/src/chat-dm-safety-invariants.test.ts                -- NEW file
packages/db/src/migrate.test.ts                                  -- mechanical literal bump only
packages/db/README.md                                            -- document the three new functions
docs/autopilot-manifests/chat-dm-safety-authority-core.json      -- self, per AP-39/AP-40 lesson
docs/autopilot/contracts/autopilot-chat-dm-safety-authority-core.md                  -- self
```

Estimated total ~550-650 changed LOC (migration ~150, schema mirror ~90, focused test ~300-350 covering
the full §9 matrix, `migrate.test.ts` ~5, `README.md` ~15-20) — an estimate for planning only, not a
measurement; safely inside the plan's `≤750 LOC / ≤3 modules / 1 migration` B3 exception for this slice
(module count = migration + schema mirror + focused test = 3; `migrate.test.ts`/`README.md`/self-docs
are mechanical/documentation, same accounting root's own contract used).

### 6.5 `packages/db/README.md` addition

Follows the file's existing per-migration section convention (`## <title> (<decision refs>,
\`<migration number>\` — <status tag>)`, see e.g. `## Privileged job-definer bootstrap...` at line 335).
New section: `## DM safety authority core (DD-55, \`0030\` — CODE DARK)` documenting
`dm_safety_enabled()`, `chat_pair_blocked()`, `assert_dm_allowed()` — their signatures, the fail-closed
COALESCE behavior, the two rate-limit bucket keys, and that this migration is inert (zero live caller)
until `dd38-dd86-chat-schema-core` (slice 3) lands. "CODE DARK" matches the tag `0022`'s own README
section uses for shipped-but-not-yet-wired-in mechanics.

## 7. Migration numbering — provisional, do not trust

Live tail at authoring time (2026-08-05): `0029_dd29_capability_registry_contract.sql`. This slice's
migration is therefore provisionally `0030`. Unlike root's own contract (which had to guess through two
unlanded prerequisite migrations), this slice's only hard dependency (`chat-definer-role-provisioning`)
consumes **zero** migration numbers (its deliverable is `infra/postgres-init/02-chat-definer.sql`, run
via `pnpm db:bootstrap`, never a `packages/db/migrations/*.sql` file) — so `0030` is a tighter estimate
than root's was. **Still not a commitment**: re-derive with
`ls packages/db/migrations/*.sql | sort | tail -5` immediately before creating anything at
implementation time; any migration-adding slice landing between now and then (there is no reason to
expect one — no other chat-tree slice is authored yet, and this repo's own history shows exactly this
kind of drift is common, e.g. AP-45's own `0029` guess was consumed by an unrelated DD-29 billing slice
between its authoring and now) shifts the real number.

## 8. Negative scope

This slice does **NOT** create:

- `chat_channels`, `chat_members`, `chat_messages`, or any other `chat_*` content table — root's
  deliverable (slice 3, `dd38-dd86-chat-schema-core`)
- the `chat_definer` role itself — slice 1's deliverable, already merged; this slice only *consumes* it
- `create_dm`, `send_chat_message`, `mark_read`, or any block/unblock/report-submit RPC — owned by
  later slices 7 (`chat-shared-message-command-core`) and 8 (`chat-dm-lifecycle-command-core`)
- any `INSERT`/`UPDATE`/`DELETE` grant to `chat_definer` on `chat_blocks` or `chat_reports` — mutation
  has no owner yet in this slice; granting it now repeats exactly the failure mode root's own contract
  (AP-45 §7) avoided for `chat_channels`/`chat_members`/`chat_messages`
- any grant of any kind to `app`, `app_worker`, or `readonly` on any of the four tables this slice
  creates — global-protected plane, mediated access only (§5 design-probe row 8)
- the DD-56 capability registry, grants, or append-only grant audit (`tenant-capability-authority-core`,
  catalog slice 4 — collision-dependent on root, not on this slice)
- any HTTP route or SSE topic
- a `channel_id` column on `chat_reports` (§5 design-probe row 4 — hard forward-reference constraint,
  not a style choice)
- a report-triage/action UI or API — future support/ops tooling, unscoped
- any modification to `infra/postgres-init/02-chat-definer.sql`, `01-job-definer.sql`,
  `packages/db/src/tenant.ts`, `packages/db/src/test-harness.ts`, or `packages/db/src/rls-invariants.test.ts`
- a new exported `withPerson`-style helper — this slice's own test file sets `app.person_id` inline for
  its own fixtures the same way `chat-schema-invariants.test.ts` will; not a shared export (would be a
  4th module, breaching the B3 budget's module ceiling)
- an edit to `docs/autopilot-backlog.md`'s `merged_probe`/`status` for `dd38-dd86-chat-schema-core` or
  any other sibling slice's entry — only this slice's own backlog entry is touched
- a rollback/reverse-migration runbook (P17 — forward-only; every object created here is fresh/additive,
  nothing to roll back on failure, and a later-judged-wrong decision gets a new forward migration)
- a retention/deletion sweep on `chat_reports` or `chat_dm_safety_audit` — BL-SEC-6 requires audit logs
  be archived after retention, never deleted; no archival tooling exists yet in this repo, so this
  slice takes no destructive action and defers archival to a future, separately-scoped operational slice

If any acceptance row in §9 turns out to need a file outside this slice's scope, or the four-capability
kill-switch model proves insufficient, HALT and report — that means this slice's premise needs
re-deriving, an owner question, not an implementation choice.

## 9. Acceptance matrix

| Category | Row | Expected |
|---|---|---|
| Happy path | Unblocked pair, safety fully enabled, under rate limits, `assert_dm_allowed(a,b,'create')` | Returns (void), no exception, no audit row written |
| Happy path | Same, `action='send'` and `action='read'` | Returns (void) for both |
| Happy path | `dm_safety_enabled()` with all four config flags true | Returns `true` |
| Happy path | `chat_pair_blocked(a,b)` with no row for either direction | Returns `false` |
| Boundary | `chat_dm_safety_config` has exactly one row after migration | `SELECT count(*) FROM chat_dm_safety_config` = 1; second `INSERT` violates the `singleton` PK |
| Boundary | `chat_dm_safety_config` default `dm_sender_limit_per_min`/`dm_target_limit_per_min` after migration | Both `30` |
| Boundary | `UPDATE chat_dm_safety_config SET dm_sender_limit_per_min = 0` (and `= -1`); same for `dm_target_limit_per_min` | Rejected — CHECK constraint; row's prior value unchanged |
| Failure | `UPDATE chat_dm_safety_config SET dm_sender_limit_per_min = 1`, then two `assert_dm_allowed(a, x, 'create')` calls for the same `a` inside the rate window (no migration, no reconnect) | First succeeds, second denies with `deny_reason='rate_limited_sender'` — the new limit takes effect on the very next call, proving tuning is a live `UPDATE`, not a migration (this is the acceptance proof for §5 row 11's whole rationale) |
| Boundary | `chat_blocks` insert with `blocker_person_id = blocked_person_id` | Rejected — CHECK constraint |
| Boundary | `chat_reports` insert with `reason_code='other'` and NULL/empty note | Rejected — CHECK constraint |
| Boundary | `chat_reports` insert with `reason_code='spam'` and non-NULL note | Rejected — CHECK constraint |
| Boundary | `chat_reports` note at exactly 500 chars / 501 chars | 500 succeeds, 501 rejected |
| Authorization | `chat_pair_blocked(a,b)` after a row `(blocker=a, blocked=b)` exists | Returns `true` |
| Authorization | `chat_pair_blocked(b,a)` (swapped args) after the same row | Returns `true` — direction-agnostic |
| Authorization | `assert_dm_allowed(a,b,'create')` when `chat_pair_blocked(a,b)` is true | Raises `chat safety blocked`; one `chat_dm_safety_audit` row with `deny_reason='blocked'` |
| Authorization | `role app` attempts direct `SELECT`/`INSERT` on `chat_blocks`/`chat_reports`/`chat_dm_safety_config`/`chat_dm_safety_audit` | Permission denied — zero grants issued to `app` |
| Authorization | `role app` attempts direct `EXECUTE` on `dm_safety_enabled`/`chat_pair_blocked`/`assert_dm_allowed` | Permission denied — `REVOKE ALL ... FROM PUBLIC`, no `GRANT ... TO app` issued (only `chat_definer`, via ownership) |
| Failure | `chat_dm_safety_config.block_enabled = false` (others true) | `dm_safety_enabled()` → `false`; `assert_dm_allowed` denies with `deny_reason='safety_disabled'` regardless of block/rate state |
| Failure | Same, toggling `report_enabled`/`rate_limit_enabled`/`audit_enabled` false one at a time | Each independently makes `dm_safety_enabled()` → `false` (test #28's "disable any ONE") |
| Failure | `assert_dm_allowed(NULL, b, 'create')`, `(a, NULL, 'create')`, `(a, a, 'create')` | All raise `invalid_parameter_value` before any audit/rate side effect |
| Failure | `assert_dm_allowed(a, b, 'unknown_action')` | Raises `invalid_parameter_value` |
| Concurrency | Two concurrent `assert_dm_allowed(a, x, 'send')` / `assert_dm_allowed(a, y, 'send')` calls (different peers) racing against the sender bucket at its limit boundary | `rate_limit_check`'s own advisory-lock serialization (0012, already proven) admits exactly up to the configured limit; the rest deny with `deny_reason='rate_limited_sender'` — this slice does not need to re-prove `rate_limit_check`'s own concurrency safety, only that it is correctly consumed |
| Concurrency | `assert_dm_allowed` denial path racing the same `(actor,peer,action)` twice | Two independent audit rows (append-only, no dedupe expected — this is a log, not an idempotent command) |
| Migration | Exactly one new `.sql` file added | `git diff --name-only` against base shows exactly one file under `packages/db/migrations/` |
| Migration | No destructive change to any existing table | Only fresh `CREATE TABLE`/`CREATE FUNCTION` and one new `GRANT ... TO chat_definer` on the pre-existing `rate_limit_check`; zero `ALTER`/`DROP` on any table that predates this migration |
| Migration | Migration applies under the real, non-superuser `DATABASE_URL_MIGRATION` role after `chat_definer` bootstrap | Succeeds — mirrors root's own test #25/#26 (PG16 `ALTER FUNCTION ... OWNER TO` needs `CREATE ON SCHEMA public` granted first); this slice's own `GRANT CREATE ... / REVOKE CREATE ...` bracket proves it independently of root |
| Security/privacy | Exception raised by `assert_dm_allowed` on any deny path | Message is exactly `chat safety blocked` regardless of `deny_reason` — no reason code, bucket name, or block state leaked to the caller |
| Security/privacy | `chat_dm_safety_audit` row content | Real `deny_reason` stored server-side only; table has zero grant to `app` — no caller-reachable read path exists in this slice |
| Security/privacy | `dm_safety_enabled()`/`chat_pair_blocked()`/`assert_dm_allowed()` all `SECURITY DEFINER` owned by `chat_definer` | `chat_definer` is `BYPASSRLS` at the role level, but none of the four tables use RLS at all — access control is entirely the grant system (§5 design-probe row 8), not RLS bypass |
| Regression | Full existing canonical DB suite stays green | `DATABASE_URL_TEST=... pnpm test` — no existing test's behavior changes; the one modified pre-existing object (`rate_limit_check`) only gains an additional grantee, no signature/body change |
| Observability | Every denial is individually attributable | `chat_dm_safety_audit` row carries `actor_person_id`, `peer_person_id`, `action`, `deny_reason`, `created_at` — sufficient for an on-call abuse investigation per P15 |

## 10. Canonical verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-08-05
AUTHORITY_SHA: 90d292d85fbe92db7a5afcd118a99e28f3d3b3b7
LIVE_BASE_SHA: 5cad41f4d7f6d47a2f591a1d70c75885568cb4b0
BASE_BRANCH: main
BASE_REMOTE_RELATION: MAIN_EQUALS_ORIGIN_MAIN
TARGET_FILES:
  - docs/proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md
  - docs/features/BE/feature_inapp_chat_tech.md
  - docs/features/feature_inapp_chat.md
  - docs/standards/decisions.md
  - docs/standards/business-rules.md
  - docs/standards/core-db-architecture-principles.md
  - docs/autopilot-backlog.md
  - docs/autopilot/contracts/autopilot-dd38-dd86-chat-schema-core.md
  - docs/autopilot-manifests/dd38-dd86-chat-schema-core.json
  - infra/postgres-init/02-chat-definer.sql
  - packages/db/schema.ts
  - packages/db/migrations/0012_auth_functions.sql
  - docs/autopilot/contracts/autopilot-chat-dm-safety-authority-core.md
  - docs/autopilot-manifests/chat-dm-safety-authority-core.json
SLICE: chat-dm-safety-authority-core
IN_SCOPE: chat_dm_safety_config/chat_blocks/chat_reports/chat_dm_safety_audit storage;
  dm_safety_enabled()/chat_pair_blocked() pure predicates; assert_dm_allowed() fail-closed gate;
  exact grants (chat_definer SELECT/INSERT + EXECUTE on rate_limit_check); invariant tests proving
  the negative (blocked/disabled/rate-limited all deny, no leak)
OUT_OF_SCOPE: any chat_* content table; chat_definer role creation; create_dm/send_chat_message/
  mark_read/block-report RPCs; any grant to app on the four new tables; any mutation grant to
  chat_definer on chat_blocks/chat_reports; DD-56 capability registry; any HTTP route (full list §8)
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES:
  - chat-definer-role-provisioning: MERGED (base_sha de78394493cf448ddc7f4a35f8483373ddf1d0c7,
      landed_sha 286f48bbbd5b9f41c3e63e5f201ecfd276706bff, file
      infra/postgres-init/02-chat-definer.sql, symbol chat_definer) — see §4.1
PRIOR_SLICES: chat-definer-role-provisioning (1, MERGED) -> chat-dm-safety-authority-core (2, this packet)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12 — see §10.1)
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: PASS (packet/manifest/launcher authored this session; executable once
  registered)
FIRST_IMPLEMENTATION_STEP: open a worktree from this slice's manifest
  (docs/autopilot-manifests/chat-dm-safety-authority-core.json), register the scope gate, write
  packages/db/migrations/0030_chat_dm_safety_authority_core.sql exactly per §6.1 (re-deriving the
  real number per §7 first), then the schema mirror and focused test per §6.2/§6.3
REMAINING_BLOCKERS: none
```

### 10.1 Closure matrix (12/12)

| # | Gate | Evidence | PASS/FAIL |
|---|---|---|---|
| 1 | Authority snapshot pin theo SHA | `90d292d` (decision) + `5cad41f` (live base = origin/main = HEAD), both verified 2026-08-05 | PASS |
| 2 | Decision trong scope đã chốt | DD-55 `✅ Chốt` (2026-07-16, hard-gate language quoted verbatim §5); no open product/policy question touches this slice's storage+predicate+gate scope | PASS |
| 3 | Scope IN/OUT và owner rõ | §6 (in) / §8 (out), each row justified against the Reviewed spec or an explicit forward-reference/ownership constraint | PASS |
| 4 | Dependency phân loại đủ | Exactly one hard dependency, `chat-definer-role-provisioning`, classified `MERGED` with same-order `base_sha`/`landed_sha`/`file`/`symbol` proof (§4.1) — not a placeholder | PASS |
| 5 | Live schema/code khớp doc | §3 table — migration tail `0029` (re-derived, corrects AP-45's own stale `0029` guess), zero `chat_*` runtime, `chat_definer` role confirmed live with exact attributes | PASS |
| 6 | Data/API/state/auth contract đủ | Exact DDL §6.1, copied from this slice's own design work (§5), consistent with root's pinned consumer contract (§4.2) and every applicable core-db-architecture-principles.md rule (P1/P2/P4/P6/P7/P8/P17) | PASS |
| 7 | Fail-closed/idempotency/order đủ | `COALESCE(...,false)` on missing config; ordered `disabled → blocked → rate` checks; generic exception text; append-only audit; `rate_limit_check` reuse inherits its own proven idempotent-consume/retention behavior | PASS |
| 8 | Open question trong scope = 0 | §5 escalation check — all 14 design decisions resolved at Tier 1, zero Tier 2/3 escalation | PASS |
| 9 | Acceptance matrix có expected result | §9, full B2 category coverage incl. negative-proof rows (blocked/disabled/rate-limited, no-leak, permission-denied) | PASS |
| 10 | Migration/security/rollback pin | Exactly 1 migration (+3 mechanical/doc files, §6.4); B3 budget exception `≤750 LOC/3 modules/1 migration` cited and estimated within; P17 forward-only acknowledged explicitly (no rollback runbook, nothing destructive to undo); safe to drop entirely pre-enable (zero live caller until slice 3 lands) | PASS |
| 11 | First slice có hard dependency merged | `chat-definer-role-provisioning` is merged (§4.1) — this is not a first-to-code node with an unmerged prerequisite, unlike AP-45's own current state | PASS |
| 12 | Implementation handoff sẵn sàng | Packet (this doc) + manifest + launcher all authored and internally complete; backlog entry updated to `planned` in the same session (§11 of this task's own work, tracked separately from this doc) | PASS |

12/12 PASS. Verdict: `CODE_READY`.

## 11. Notes for the future implementer

- Re-verify §7's migration number and §3's "no `chat_*` exists" claim live, immediately before writing
  code — both are point-in-time facts from this authoring session (2026-08-05), not guarantees.
- Copy §6.1 verbatim. If anything in it looks wrong once you're staring at a live database, that is a
  signal this slice's premise needs re-deriving — HALT and report, per §8's closing paragraph — not an
  invitation to improvise a fix inline.
- The two rate-limit numbers (30/min sender, 30/min target, §5 row 11) are this session's own default,
  not an owner ruling. If real traffic data or an owner review disagrees, change them via this same
  migration (not yet applied anywhere) or, if already applied, a new forward migration (P17) — never a
  hand-edited already-applied file.
- Security review (manifest `security_review.required: true`) must specifically verify: (a)
  `dm_safety_enabled()` truly fails closed (not just "usually returns false") when the config row is
  missing/mid-transaction-invisible; (b) `chat_pair_blocked` checks BOTH directions (a common one-line
  bug is to check only one); (c) `assert_dm_allowed`'s raised exception never varies by `deny_reason`;
  (d) no grant beyond exactly what §6.1's owner/grant block lists exists after migration (in particular,
  confirm `app` truly has zero grant on any of the four new tables and zero `EXECUTE` on any of the
  three new functions).
