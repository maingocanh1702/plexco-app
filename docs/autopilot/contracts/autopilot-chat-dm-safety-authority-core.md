<!-- review-readiness: code-ready -->
# AP-50 — chat-dm-safety-authority-core: DD-55 DM safety authority contract

> **Status:** `CODE_READY` (see verdict, §10), **amended 2026-08-05** (implementation session, same
> day) · **Authored:** 2026-08-05 · **Risk:** P1
> **This is an AUTHORING artifact, now also an implementation record.** Implemented in worktree
> `feat/chat-dm-safety-authority-core`. The amendment: `chat_dm_safety_audit` (a table) is REMOVED
> from this slice's scope, replaced by `assert_dm_allowed` emitting `RAISE LOG` — implementation proved
> the original table-INSERT-then-RAISE-EXCEPTION shape can never persist a row (§5 row 6, §6.1 both
> updated in place, rationale replaced not appended, per owner instruction). Scope also amended to
> include `packages/db/src/test-harness.ts` and `packages/db/src/rls-invariants.test.ts` (§6.3, §8) —
> owner-authorized, same registration, no separate slice. Slice 2 of the serialized DB lane
> `chat-definer-role-provisioning → chat-dm-safety-authority-core → dd38-dd86-chat-schema-core →
> tenant-capability-authority-core`. Unlike its root sibling (`dd38-dd86-chat-schema-core`, AP-45), the
> primary-surface plan does **not** pin an exact-file packet for this slice (§9.2 only pins slice 1) —
> authoring this was real design work, not transcription, per the backlog stub's own note.

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
  - docs/autopilot-dd38-dd86-chat-schema-core.md (AP-45 — downstream consumer, its own launcher
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
| 6 | Denial audit mechanism (owner-amended 2026-08-05, replacing this row's original rationale rather than appending to it — the original chose *what* to log inside a `chat_dm_safety_audit` table without noticing the deny path is exactly the path that rolls back everything written on it) | **`RAISE LOG`** inside `assert_dm_allowed`, gated by `audit_enabled`, carrying `actor`/`peer`/`action`/`deny_reason`/`at` — no table. Postgres's log levels are delivered outside transactional rollback, so the line survives the `RAISE EXCEPTION` immediately after it; a table row written by the SAME `INSERT`-then-`RAISE EXCEPTION` statement cannot, for any calling pattern (verified empirically during implementation). The denial signal that matters for abuse forensics — who attempted, against whom, why refused — is **not** captured by `rate_limit_hits` (records hits, not denials or reasons) or `chat_blocks` (current state, not an attempt log); this is a real, unfilled gap, not a wontfix. A queryable table remains the goal, deferred to backlog `chat-dm-safety-audit-queryable-path` (depends on `dd38-dd86-chat-schema-core`): the write needs to happen from a transaction that actually commits, which means either the future caller (`create_dm`/`send_chat_message`/`mark_read`) writes it itself from inside its OWN exception handler after catching the refusal — that caller does not exist yet — or a genuinely separate connection (e.g. `dblink`) commits it independently | **Keep the original `chat_dm_safety_audit` table, ship empty** — rejected: an audit table that always reads zero rows does not look unimplemented to the next reader, it looks like a working audit trail; a machine-readable claim contradicting reality. **`dblink` now, in this slice** — rejected on cost, not correctness: `chat_definer` is `NOLOGIN` and cannot itself authenticate a loopback connection, so this needs a brand-new dedicated `LOGIN` role — new credential surface on the exact mechanism that decides who can reach whom — plus a new per-denial connection, plus DO Managed PostgreSQL's `dblink` availability is itself unverified (this host has twice already refused things assumed to work, `infra-do-app-vpc-deployment`'s consolidated deployment inputs) |
| 7 | **OBSOLETE 2026-08-05** — `chat_dm_safety_audit` — FK to `persons` (superseded by row 6's amendment: no such table exists, so this row's decision no longer applies to anything; kept, not deleted, so the escalation-check paragraph below still refers to "14 rows" accurately) | ~~**No** FK on `actor_person_id`/`peer_person_id`~~ | ~~FK to `persons(id)` — rejected: breaks the established `merge_audit`/`routing_audit` precedent...~~ |
| 8 | RLS posture for all new tables (3, after row 6's amendment removed the 4th) | **No RLS**, **zero grant to `app`/`readonly`** — global-protected plane, reached only via `chat_definer`-owned `SECURITY DEFINER` functions | RLS keyed on `app.tenant_id` (root's own idiom) — rejected: DM safety is a cross-tenant, person-level concern (`tenant_id` does not even apply — DM channels have `tenant_id IS NULL`); `app` never needs direct access to these tables at all (every access is mediated), which is exactly the `persons`/`accounts` model already established in `0009`, not the tenant-isolation model |
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

**Not a verbatim copy (codex round-02 [P2] made the cost of that promise concrete: this block drifted
from the real file across BOTH review rounds this session, most recently by not tracking the
round-02 search_path/config-default/note-constraint fixes below).** The prior approach — a full
embedded copy, "kept here so the contract and the code never drift" — required a byte-for-byte
re-sync on every round and failed to deliver that twice. Per this repo's own anti-drift principle
("don't hard-pin a value the reader can measure — point at the measurement instead"),
`packages/db/migrations/0030_chat_dm_safety_authority_core.sql` is the sole authoritative source;
this section summarizes shape and intent, not literal text.

**Amended 2026-08-05, owner-directed, replacing the originally pinned shape**: the original had a
fourth table, `chat_dm_safety_audit`, and `assert_dm_allowed` wrote to it via `INSERT` immediately
before `RAISE EXCEPTION` in the same statement. Implementation proved empirically that this can
never persist a row — PL/pgSQL's exception handling is savepoint-rollback-based, so the `RAISE`
unconditionally undoes the `INSERT`, for every calling pattern. Per §5 row 6 (rationale replaced, not
appended), the table was dropped entirely and `assert_dm_allowed` emits `RAISE LOG` instead.

**Amended 2026-08-06, codex round-02 findings, all fixed in the migration file directly:**
- All three `SECURITY DEFINER` functions use `SET search_path = public, pg_temp` (not `pg_catalog,
  public`, which left `pg_temp` implicitly searched first — a same-session temp table could shadow
  `chat_dm_safety_config`/`chat_blocks`). Matches this codebase's own existing convention across
  every other `SECURITY DEFINER` function (0012/0016), including `rate_limit_check` which this
  migration calls.
- `chat_dm_safety_config`'s four capability booleans (`block_enabled`/`report_enabled`/
  `rate_limit_enabled`/`audit_enabled`) default `false`, not `true` — an enablement gate (see
  `ENABLEMENT_ONLY_GATES` in §10), reversing round-01's position. `dm_sender_limit_per_min`/
  `dm_target_limit_per_min` still default to `30` (unaffected — placeholder operational numbers,
  not a live/dead-subsystem question).
- `chat_reports_note_shape_chk` bounds raw `length(note) <= 500` (not `length(btrim(note)) BETWEEN
  1 AND 500`, which only bounded the trimmed length — a note padded with whitespace could store
  arbitrarily more than 500 raw characters) plus `length(btrim(note)) >= 1` for non-emptiness.

**Amended 2026-08-06, codex round-04 finding, fixed in the migration file directly:**
- `assert_dm_allowed` carries its own `SET client_min_messages = warning` clause, alongside its
  existing `SET search_path`. `client_min_messages` is a plain, caller-controlled session GUC — a
  session that itself sets it to `log` DOES receive a `LOG`-severity `RAISE` as a client notice
  (verified directly), regardless of `SECURITY DEFINER`, since delivery is keyed to the calling
  connection, not the function owner. Without this override, `assert_dm_allowed`'s own `RAISE LOG`
  (actor/peer/action/deny_reason) was client-reachable by any role with `EXECUTE`, contradicting
  this migration's own design goal and DD-55's "no block detail leaked" requirement. The
  function-local `SET` clause forces the threshold above `LOG` for the duration of that call only
  (confirmed: the caller's own session setting is unchanged before and after), suppressing the
  client-visible notice while leaving `log_min_messages` (a separate GUC controlling the SERVER log)
  unaffected.

Shape otherwise unchanged from the round-01 description: 3 tables (`chat_dm_safety_config`,
`chat_blocks`, `chat_reports`, no `chat_dm_safety_audit`), a `trg_chat_dm_safety_config_touch_updated_at`
trigger (round-01), and the 3 functions (`dm_safety_enabled`, `chat_pair_blocked`,
`assert_dm_allowed`) with the grants described in §6.3 below.

<details><summary>Migration body as of commit 79cb540 (round-01 fixes) — historical, superseded by
round-02 above, kept for the record rather than deleted per this repo's own "never rewrite dated
history" convention. Read the live file for current truth.</summary>

```sql
-- ============================================================================
-- 0030_chat_dm_safety_authority_core.sql
-- chat-dm-safety-authority-core (slice 2 of the DD-38/DD-86 chat tree).
-- Canonical DD-55 DM safety authority: block/report/rate storage plus the
-- pure predicates and fail-closed gate that dd38-dd86-chat-schema-core
-- (slice 3) and every later DM-touching slice (7/8) call into. Creates no
-- chat_* content table -- those are root's own deliverable (slice 3).
-- Source: docs/autopilot-chat-dm-safety-authority-core.md, decisions.md
--         DD-55, feature_inapp_chat_tech.md v0.23 section "DD-55 design-probe
--         gates" / section 2 (helper idiom) / section 4-5.
--
-- Every CHECK below carries an explicit CONSTRAINT name (contract SS6.1's own
-- verbatim text left 6 of 8 unnamed; SS6.2 requires the schema.ts mirror to
-- declare matching explicit names so rls-invariants.test.ts's generic CND
-- guard covers these tables -- an unnamed CHECK here would make that
-- instruction unsatisfiable, since schema.ts can only truthfully declare a
-- name Postgres actually assigned). Naming propagates SS6.1's own two
-- examples (chat_dm_safety_config_{sender,target}_limit_positive_chk) to the
-- rest; no CHECK semantics changed.
--
-- NO chat_dm_safety_audit TABLE (owner-amended 2026-08-05, replacing SS6.1's
-- original pinned shape -- see design probe row 6 and this file's own
-- assert_dm_allowed() comment below for why). A table written via INSERT
-- immediately before RAISE EXCEPTION in the same statement can never persist
-- a row through normal operation: PL/pgSQL's exception handling is
-- savepoint-rollback-based, so the RAISE unconditionally undoes the INSERT,
-- for every calling pattern (proven empirically, not just reasoned). Shipping
-- that table anyway would have looked like a working audit trail to the next
-- reader while never actually holding a row -- a machine-readable claim that
-- contradicts reality. assert_dm_allowed() instead emits RAISE LOG, which
-- Postgres delivers outside transactional rollback.
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
-- audit_enabled has TWO effects (owner-amended 2026-08-05, no new column):
-- (1) unchanged -- it is one of the four flags dm_safety_enabled() ANDs, so
-- disabling it alone still fail-closes the whole subsystem (test #28's own
-- "disable any ONE of the four" requirement). (2) it now ALSO gates whether
-- assert_dm_allowed() emits its RAISE LOG line on a denial -- see that
-- function's own comment; there is no queryable chat_dm_safety_audit table
-- in this migration.
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
  singleton boolean PRIMARY KEY DEFAULT true
    CONSTRAINT chat_dm_safety_config_singleton_chk CHECK (singleton),
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
  CONSTRAINT chat_blocks_no_self_chk CHECK (blocker_person_id <> blocked_person_id)
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
    CONSTRAINT chat_reports_reason_code_chk
    CHECK (reason_code IN ('spam','harassment','unsafe','off_topic','other')),
  note text,
  status text NOT NULL DEFAULT 'submitted'
    CONSTRAINT chat_reports_status_chk
    CHECK (status IN ('submitted','triaged','actioned','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_reports_no_self_chk CHECK (reporter_person_id <> reported_person_id),
  CONSTRAINT chat_reports_note_shape_chk CHECK (
    (reason_code = 'other' AND note IS NOT NULL AND length(btrim(note)) BETWEEN 1 AND 500)
    OR (reason_code <> 'other' AND note IS NULL)
  )
);

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
-- emits ONE RAISE LOG line with the real reason (when audit_enabled), then
-- raises the SAME generic message the Reviewed spec already uses at the RLS
-- boundary (feature_inapp_chat_tech.md:684, send_chat_message) -- one
-- wire-visible error text for the whole DM safety surface, by construction,
-- not by convention someone has to remember.
--
-- RAISE LOG, not a chat_dm_safety_audit table (owner-amended 2026-08-05,
-- replacing SS6.1's original pinned shape; see design probe row 6): an
-- INSERT immediately before RAISE EXCEPTION in the same statement can never
-- persist, because PL/pgSQL's exception handling is savepoint-rollback-based
-- -- the RAISE unconditionally undoes the INSERT, for every calling pattern
-- (proven empirically). RAISE LOG is delivered through Postgres's own
-- logging subsystem, which sits OUTSIDE transactional rollback, so it
-- survives the RAISE EXCEPTION that immediately follows it. This trades a
-- queryable table for unstructured server-log text; a queryable path is a
-- separate, deliberately deferred follow-up (backlog:
-- chat-dm-safety-audit-queryable-path) once a caller exists that can write
-- the row from inside its OWN exception handler, in a transaction that
-- actually commits.
--
-- The two rate limits (and now audit_enabled) are read from
-- chat_dm_safety_config on every call, the same
-- COALESCE-wrapped-scalar-subquery-to-fail-closed idiom dm_safety_enabled()
-- itself already uses, not a fresh pattern. A missing config row (should
-- never happen -- see that table's own header) COALESCEs the two limits to
-- 0, which makes rate_limit_check deny unconditionally (v_count >= 0 is true
-- even for a brand-new bucket) -- fail-closed defense in depth, even though
-- dm_safety_enabled()'s own identical missing-row COALESCE already denies
-- first via the IF/ELSIF chain below and would prevent this branch from ever
-- being reached with a NULL-turned-0 limit in practice. Belt and suspenders
-- on purpose: this function's fail-closed property should not depend on the
-- two checks staying in this exact order forever. audit_enabled COALESCEs to
-- false on a missing row -- fail-closed means "do not log", consistent with
-- every other missing-row behavior in this migration, never "log anyway".
-- ---------------------------------------------------------------------------
CREATE FUNCTION assert_dm_allowed(p_actor uuid, p_peer uuid, p_action text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_deny_reason text;
  v_sender_limit integer;
  v_target_limit integer;
  v_audit_enabled boolean;
BEGIN
  IF p_action NOT IN ('create','send','read') THEN
    RAISE EXCEPTION 'assert_dm_allowed: invalid action' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_actor IS NULL OR p_peer IS NULL OR p_actor = p_peer THEN
    RAISE EXCEPTION 'assert_dm_allowed: invalid participants' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_sender_limit := COALESCE((SELECT dm_sender_limit_per_min FROM chat_dm_safety_config WHERE singleton), 0);
  v_target_limit := COALESCE((SELECT dm_target_limit_per_min FROM chat_dm_safety_config WHERE singleton), 0);
  v_audit_enabled := COALESCE((SELECT audit_enabled FROM chat_dm_safety_config WHERE singleton), false);

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
    IF v_audit_enabled THEN
      RAISE LOG 'chat_dm_safety_audit actor=% peer=% action=% deny_reason=% at=%',
        p_actor, p_peer, p_action, v_deny_reason, clock_timestamp();
    END IF;
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
GRANT EXECUTE ON FUNCTION rate_limit_check(text, integer, interval) TO chat_definer;

-- No grant of any kind to app/app_worker/readonly on either table above:
-- both global protected (not tenant-scoped -- DM is cross-tenant/
-- person-scoped, RLS keyed on app.tenant_id would be the wrong boundary
-- here), reached only through chat_definer-owned SECURITY DEFINER
-- functions -- same model as persons/accounts (0009). No grant on
-- chat_reports at all: nothing in this slice reads or writes it (see
-- design probe row 13); slice 8 grants what it needs when it lands the
-- report RPC.
```

</details>

Line-count estimate for this file superseded by the measured total in §6.4 — genuinely not repeated
here this time (self-caught while fixing codex round-03 [P2]'s LOC finding: this exact sentence was
itself echoing round-02's now-stale numbers, proving "point at the measurement" only works if the
pointer itself carries no number to go stale).

### 6.2 Schema mirror (`packages/db/schema.ts`)

Add Drizzle definitions for `chatDmSafetyConfig`, `chatBlocks`, `chatReports` matching the DDL above
exactly (column names, nullability, defaults, checks) — including `chatDmSafetyConfig`'s two integer
columns `dmSenderLimitPerMin`/`dmTargetLimitPerMin` and their named
`chat_dm_safety_config_sender_limit_positive_chk`/`chat_dm_safety_config_target_limit_positive_chk`
constraints. No `chatDmSafetyAudit` (owner-amended 2026-08-05 — no such table). Every `CHECK`/`UNIQUE`/FK
constraint must use an explicit declared name via Drizzle's `check()`/`unique()`/`foreignKey()` builders
(e.g. `chat_blocks_no_self_chk`, `chat_reports_note_shape_chk`), matching this repo's existing
convention (`notif_deliveries_status_chk` precedent, tail of `schema.ts`) — this is what lets
`rls-invariants.test.ts`'s generic CND (check-constraint-naming-drift) guard cover these new tables
automatically.

### 6.3 Focused invariant test — new file

`packages/db/src/chat-dm-safety-invariants.test.ts` (kebab-case, matching `chat-schema-invariants.test.ts`'s
naming convention from the sibling slice — do not extend `rls-invariants.test.ts`/`auth.test.ts`, both
already 4000+ lines). Reuses `setupRlsTestContext` from `test-harness.ts`; connects with a privileged
test role (not `app`) to seed `chat_blocks`/`chat_dm_safety_config` fixtures directly (this slice owns
no write RPC, so fixture setup is direct SQL, exactly as root's own test plan directly manipulates
`chat_members` to test RLS in isolation). Must cover the full acceptance matrix in §9 — the negative-
proof rows (blocked pair denies both directions, disabled-capability denies, rate-limit denies,
read is never rate-limited, no block-detail in the raised exception) are the actual point of this
slice; do not ship only happy-path coverage. Since `assert_dm_allowed` emits `RAISE LOG` rather than
writing a table (§6.1 amendment), and that function forces `client_min_messages = warning` for its
own call regardless of the caller's session (codex round-04 [P1] — closing a leak where the original
version left it client-observable to any caller that raised its own threshold), the CONTENT of that
line is not verifiable from a live client round-trip test at all — tests instead prove the negative
(no client ever sees it, via `captureNotices()` returning nothing on every denial path, no matter
what the caller's session requests).

`packages/db/src/migrate.test.ts` needs the same mechanical literal bump (migration count/tail
filename) the `dd38-dd86-chat-schema-core` and `db-tenants-authz-grant-security-definer` manifests both
pre-declared for the identical reason — declared here to not repeat that lesson a third time.

**Scope amendment (owner-authorized 2026-08-05, same registration):** implementation surfaced that this
migration is the first in the repo to require `chat_definer` role membership under a non-superuser
migration role (`ALTER FUNCTION ... OWNER TO chat_definer` needs `SET ROLE` privilege), which
`packages/db/src/test-harness.ts`'s `setupNonSuperuserOwnerContext` has no counterpart for (it has
`bootstrapJobDefinerForOwner()` but no `chat_definer` equivalent) — breaking 3 pre-existing tests
(`migrate.test.ts` BR-3/BR-6, `rls-invariants.test.ts` JCL-1). Since this slice's own migration causes
the breakage, the owner authorized closing the gap in the SAME registration rather than opening a
separate slice: mirror `bootstrapJobDefinerForOwner` for `chat_definer` in `test-harness.ts`, wire it
into those 3 call sites, and fix `rls-invariants.test.ts`'s 3 stale migration-count/tail literals
(`30`→`31`, `"0029_..."`→`"0030_..."`) that any new migration mechanically forces stale. Also fix
`migrate.test.ts`'s own `chat_definer` DigitalOcean-degraded-lock test cleanup (`DROP ROLE IF EXISTS
chat_definer` now fails — the role owns real objects for the first time) — narrowly, without weakening
any assertion or refactoring the surrounding test.

### 6.4 Full scope list

```text
packages/db/migrations/0030_chat_dm_safety_authority_core.sql
packages/db/schema.ts
packages/db/src/chat-dm-safety-invariants.test.ts                -- NEW file
packages/db/src/migrate.test.ts                                  -- literal bump + amended cleanup fix
packages/db/src/test-harness.ts                                  -- scope amendment, SS6.3
packages/db/src/rls-invariants.test.ts                            -- scope amendment, SS6.3 (literal bump only)
packages/db/README.md                                            -- document the three new functions
docs/autopilot-manifests/chat-dm-safety-authority-core.json      -- self, per AP-39/AP-40 lesson
docs/autopilot/contracts/autopilot-chat-dm-safety-authority-core.md -- self
docs/autopilot-backlog.md                                        -- own entry + new chat-dm-safety-audit-queryable-path idea entry
```

**Measured, not estimated — and re-measured after EVERY round, because this exact paragraph went
stale twice already by not doing that (codex round-03 [P2]: claimed 1,121/1,503 against an actual
1,257/1,743; then this same figure went stale again mid-round-03 itself before being caught before
commit). The discipline that finally held: measure ONLY after every code change for the round is
complete, never before.** `git diff --numstat <base_sha>...HEAD` on the final, post-round-05 diff
totals **1,616 insertions across `packages/db/*`** (`chat-dm-safety-invariants.test.ts` 714,
migration 363, `test-harness.ts` 223, `migrate.test.ts` 143, `schema.ts` 68,
`README.md` 59, `rls-invariants.test.ts` 46 — this one net-SHRANK from round-04's own peak, since
round-05 removed a redundant lock-nesting layer rather than adding one) plus the doc/manifest/backlog
files (this file's own size necessarily keeps moving as this exact paragraph is edited, so not
pinned to a single digit here — see `git diff --stat` for the live number). File set stayed at the
10 files named in TARGET_FILES throughout all five rounds — only line count grew, driven by five
real codex review rounds' worth of fixes: temp-shadow regression tests, a
genuinely-concurrent-connections rewrite of the concurrency test, a full snapshot/restore fix for
chat_definer's cluster-global membership with its own round-trip regression test, a
role/table/privilege coverage matrix for the zero-grant proof
(`has_table_privilege`/`has_function_privilege` across all PG16 privilege types), a
`client_min_messages` leak closure with its own regression suite, and a manual-release lock handle
(`acquireChatDefinerLock`) closing a real gap between a test's own revoke and its later restore —
not scope creep into new tables/RPCs/grants. This exceeds the original `~650-750` planning estimate
by roughly 2.2x. Recorded honestly rather than re-asserting a stale figure; the original planning
line below is kept for history, not as a current claim.

<details><summary>Original planning estimate (2026-08-05, pre-implementation — historical, not
current)</summary>

Estimated total ~650-750 changed LOC (migration ~230 after the audit-mechanism amendment, schema mirror
~75, focused test ~350-400, `migrate.test.ts` ~15, `test-harness.ts` ~40, `rls-invariants.test.ts` ~5,
`README.md` ~30, backlog ~40) — an estimate for planning only, not a measurement; module count for the
B3 budget grows from 3 to 5 with the owner-authorized scope amendment (migration + schema mirror +
focused test + test-harness + the two amended pre-existing test files), still within the `≤750 LOC`
ceiling but no longer comfortably so — flag to the reviewer rather than silently absorb.

</details>

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
- any grant of any kind to `app`, `app_worker`, or `readonly` on any of the tables this slice
  creates (3, after the row-6 amendment) — global-protected plane, mediated access only (§5
  design-probe row 8)
- the DD-56 capability registry, grants, or append-only grant audit (`tenant-capability-authority-core`,
  catalog slice 4 — collision-dependent on root, not on this slice)
- any HTTP route or SSE topic
- a `channel_id` column on `chat_reports` (§5 design-probe row 4 — hard forward-reference constraint,
  not a style choice)
- a report-triage/action UI or API — future support/ops tooling, unscoped
- any modification to `infra/postgres-init/02-chat-definer.sql`, `01-job-definer.sql`, or
  `packages/db/src/tenant.ts`
- (narrowed 2026-08-05, owner-authorized scope amendment, §6.3; enumeration EXPANDED codex round-05
  [P2] to match every touch actually made across rounds 1-5, all mechanically necessitated by the
  same gap, none a broader refactor) `packages/db/src/test-harness.ts`, `packages/db/src/
  rls-invariants.test.ts`, and `packages/db/src/migrate.test.ts` are no longer blanket-excluded —
  this migration is the first to require `chat_definer` membership under a non-superuser migration
  role, breaking 3 pre-existing tests through no fault of their own. Still excluded: any edit beyond
  the following, all closing the SAME chat_definer-membership-race problem class: a
  `bootstrapChatDefinerForOwner` mirroring the existing `bootstrapJobDefinerForOwner`, wired into its
  3 original call sites; `rls-invariants.test.ts`'s 3 stale migration-count/tail literals;
  `revokeStaleChatDefinerMembership`/`restoreChatDefinerMembership` as a matched revoke/restore pair
  with regression tests, closing a real membership-loss bug this migration's own test infrastructure
  introduced (round-03); `withChatDefinerLock` on `rls-invariants.test.ts`'s TI-7/CND-7/UCC-6 — the
  only three unfiltered full-migration replay paths in that file (round-03); a role x table x
  privilege catalog matrix proving the zero-grant contract (round-04); `acquireChatDefinerLock`
  replacing a two-separately-locked-halves pattern that left a real race between a test's own revoke
  and its later restore (round-05). No broader refactor beyond these named fixes; no new RLS
  coverage for these tables (they still have none, unchanged)
- a new exported `withPerson`-style helper — this slice's own test file sets `app.person_id` inline for
  its own fixtures the same way `chat-schema-invariants.test.ts` will; not a shared export (would be a
  4th module, breaching the B3 budget's module ceiling)
- an edit to `docs/autopilot-backlog.md`'s `merged_probe`/`status` for `dd38-dd86-chat-schema-core` or
  any other sibling slice's entry — only this slice's own backlog entry, plus one NEW entry
  (`chat-dm-safety-audit-queryable-path`, owner-authorized 2026-08-05, §5 row 6 amendment) are touched
- a rollback/reverse-migration runbook (P17 — forward-only; every object created here is fresh/additive,
  nothing to roll back on failure, and a later-judged-wrong decision gets a new forward migration)
- a retention/deletion sweep on `chat_reports` — BL-SEC-6 requires audit-shaped data be archived after
  retention, never deleted; no archival tooling exists yet in this repo, so this slice takes no
  destructive action and defers archival to a future, separately-scoped operational slice (moot for
  denial forensics specifically after the row-6 amendment: `RAISE LOG` output lives in Postgres's own
  log retention, not a table this slice owns)

If any acceptance row in §9 turns out to need a file outside this slice's scope, or the four-capability
kill-switch model proves insufficient, HALT and report — that means this slice's premise needs
re-deriving, an owner question, not an implementation choice.

## 9. Acceptance matrix

| Category | Row | Expected |
|---|---|---|
| Happy path | Unblocked pair, safety fully enabled, under rate limits, `assert_dm_allowed(a,b,'create')` | Returns (void), no exception, no `RAISE LOG` line |
| Happy path | Same, `action='send'` and `action='read'` | Returns (void) for both |
| Happy path | `dm_safety_enabled()` with all four config flags explicitly set true | Returns `true` |
| Boundary | `dm_safety_enabled()` on a genuinely fresh migration, no config `UPDATE` yet (codex round-02 [P1]) | Returns `false` — all four flags default `false`, an enablement gate (see §10 `ENABLEMENT_ONLY_GATES`) |
| Happy path | `chat_pair_blocked(a,b)` with no row for either direction | Returns `false` |
| Boundary | `chat_dm_safety_config` has exactly one row after migration | `SELECT count(*) FROM chat_dm_safety_config` = 1; second `INSERT` violates the `singleton` PK |
| Boundary | `chat_dm_safety_config` default `dm_sender_limit_per_min`/`dm_target_limit_per_min` after migration | Both `30` |
| Boundary | `UPDATE chat_dm_safety_config SET dm_sender_limit_per_min = 0` (and `= -1`); same for `dm_target_limit_per_min` | Rejected — CHECK constraint; row's prior value unchanged |
| Failure | `UPDATE chat_dm_safety_config SET dm_sender_limit_per_min = 1`, then two `assert_dm_allowed(a, x, 'create')` calls for the same `a` inside the rate window (no migration, no reconnect) | First succeeds, second denies with `deny_reason='rate_limited_sender'` — the new limit takes effect on the very next call, proving tuning is a live `UPDATE`, not a migration (this is the acceptance proof for §5 row 11's whole rationale) |
| Boundary | `chat_blocks` insert with `blocker_person_id = blocked_person_id` | Rejected — CHECK constraint |
| Boundary | `chat_reports` insert with `reason_code='other'` and NULL/empty note | Rejected — CHECK constraint |
| Boundary | `chat_reports` insert with `reason_code='spam'` and non-NULL note | Rejected — CHECK constraint |
| Boundary | `chat_reports` note at exactly 500 chars / 501 chars | 500 succeeds, 501 rejected |
| Boundary | `chat_reports` note: 1 real char padded with whitespace to 501 raw chars (codex round-02 [P2]) | Rejected — raw `length(note) <= 500`, not just the trimmed length |
| Authorization | `chat_pair_blocked(a,b)` after a row `(blocker=a, blocked=b)` exists | Returns `true` |
| Authorization | `chat_pair_blocked(b,a)` (swapped args) after the same row | Returns `true` — direction-agnostic |
| Authorization | `assert_dm_allowed(a,b,'create')` when `chat_pair_blocked(a,b)` is true | Raises `chat safety blocked`; one `RAISE LOG` line carrying `deny_reason=blocked` written to the SERVER log (codex round-04 [P1]: NOT visible to any client, even one whose own session requests `client_min_messages='log'` — see the row below) |
| Authorization | `role app` attempts direct `SELECT`/`INSERT` on `chat_blocks`/`chat_reports`/`chat_dm_safety_config` | Permission denied — zero grants issued to `app` |
| Authorization | `role app` attempts direct `EXECUTE` on `dm_safety_enabled`/`chat_pair_blocked`/`assert_dm_allowed` | Permission denied — `REVOKE ALL ... FROM PUBLIC`, no `GRANT ... TO app` issued (only `chat_definer`, via ownership) |
| Failure | `chat_dm_safety_config.block_enabled = false` (others true) | `dm_safety_enabled()` → `false`; `assert_dm_allowed` denies with `deny_reason='safety_disabled'` regardless of block/rate state |
| Failure | Same, toggling `report_enabled`/`rate_limit_enabled`/`audit_enabled` false one at a time | Each independently makes `dm_safety_enabled()` → `false` (test #28's "disable any ONE") |
| Failure | `assert_dm_allowed(NULL, b, 'create')`, `(a, NULL, 'create')`, `(a, a, 'create')` | All raise `invalid_parameter_value` before any audit/rate side effect |
| Failure | `assert_dm_allowed(a, b, 'unknown_action')` | Raises `invalid_parameter_value` |
| Failure | `assert_dm_allowed(a, b, NULL)` (codex round-01 [P1]) | Raises `invalid_parameter_value` — `NULL NOT IN (...)` is SQL `UNKNOWN`, not `TRUE`, so this needs an explicit `p_action IS NULL` guard, not just the whitelist check |
| Concurrency | 6 truly concurrent `assert_dm_allowed(a, x, 'create')` calls (different peers, independent connections, codex round-02 [P2] — the original test fired all 6 through one `pg.Client`, which node-postgres queues FIFO on a single connection, never exercising real contention) racing against `dm_sender_limit_per_min = 3` | `rate_limit_check`'s own advisory-lock serialization (0012, already proven) admits exactly 3 of 6; the rest deny with `deny_reason='rate_limited_sender'` |
| Security | A same-session temp table named `chat_dm_safety_config`/`chat_blocks` (codex round-02 [P1]) | `dm_safety_enabled()`/`chat_pair_blocked()` still read the real `public.*` table — `SET search_path = public, pg_temp` (pg_temp last) means an unqualified reference resolves to the real table before ever reaching a same-named temp shadow |
| Boundary | `chat_dm_safety_config` retuned via `UPDATE` (codex round-01 [P2], actually asserted in round-03 — round-01's own claim of a test was never backed by one) | `updated_at` advances — `trg_chat_dm_safety_config_touch_updated_at` fires on every `UPDATE`, not just the initial `INSERT`'s `DEFAULT now()` |
| Failure | `dm_safety_enabled()`/`assert_dm_allowed()` with the `chat_dm_safety_config` row itself deleted (codex round-03 [P2]) | Both deny (`false`/`safety_disabled`), not error — COALESCE fails closed on a missing row, matching the migration's own comment |
| Authorization | `app`/`app_worker`/`readonly` each attempt `SELECT` AND `INSERT` on all three tables, plus `EXECUTE` on all three functions (codex round-03 [P2] — the original only tried `SELECT` and only `app`) | Permission denied in all 21 combinations — zero grant of any kind to any of the three protected roles |
| Observability | Racing the same `(actor,peer,action)` denial twice (codex round-03 [P2]) | Two independent `RAISE LOG` lines, no dedupe |
| Migration | Exactly one new `.sql` file added | `git diff --name-only` against base shows exactly one file under `packages/db/migrations/` |
| Migration | No destructive change to any existing table | Only fresh `CREATE TABLE`/`CREATE FUNCTION` and one new `GRANT ... TO chat_definer` on the pre-existing `rate_limit_check`; zero `ALTER`/`DROP` on any table that predates this migration |
| Migration | Migration applies under the real, non-superuser `DATABASE_URL_MIGRATION` role after `chat_definer` bootstrap | Succeeds — mirrors root's own test #25/#26 (PG16 `ALTER FUNCTION ... OWNER TO` needs `CREATE ON SCHEMA public` granted first); this slice's own `GRANT CREATE ... / REVOKE CREATE ...` bracket proves it independently of root |
| Security/privacy | Exception raised by `assert_dm_allowed` on any deny path | Message is exactly `chat safety blocked` regardless of `deny_reason` — no reason code, bucket name, or block state leaked to the caller |
| Security/privacy | `RAISE LOG` line content | Real `deny_reason` delivered only through Postgres's own SERVER-side logging subsystem (codex round-04 [P1]: NOT a `client_min_messages='log'` connection — that path was itself a leak, since client_min_messages is a plain caller-controlled session GUC; `assert_dm_allowed`'s own `SET client_min_messages = warning` clause forces the threshold above LOG for the duration of that call regardless of what the caller's session requests) — no table, no client-visible channel of any kind, so no caller-reachable read path exists in this slice regardless of grants |
| Security/privacy | `dm_safety_enabled()`/`chat_pair_blocked()`/`assert_dm_allowed()` all `SECURITY DEFINER` owned by `chat_definer` | `chat_definer` is `BYPASSRLS` at the role level, but none of the three tables use RLS at all — access control is entirely the grant system (§5 design-probe row 8), not RLS bypass |
| Regression | Full existing canonical DB suite stays green | `DATABASE_URL_TEST=... pnpm test` — no existing test's behavior changes; the one modified pre-existing object (`rate_limit_check`) only gains an additional grantee, no signature/body change |
| Observability | Every denial is individually attributable | Each `RAISE LOG` line carries `actor`, `peer`, `action`, `deny_reason`, `at` — sufficient for an on-call abuse investigation per P15 IF the server's `log_min_messages` captures LOG-level lines (an ops/deploy config this slice does not verify); the queryable-without-that-dependency version is backlog `chat-dm-safety-audit-queryable-path` |

## 10. Canonical verdict

**Amendment history, both dated, neither silently blended (codex round-01 [P1] on this exact block:
the original text left `TARGET_FILES`/`IN_SCOPE` amended in place while claiming `G1`–`G6`/
`CLOSURE_MATRIX` PASS were untouched pre-amendment values — internally inconsistent, since the block
below is read as ONE active, machine-checked verdict by this repo's own `pnpm review:check:changed`,
which does not parse prose qualifiers above the fence).**

- **2026-08-05, original authoring:** `AUTHORITY_SHA`/`LIVE_BASE_SHA` pinned, `REVIEWED_AT: 2026-08-05`,
  design per SS6.1's original (pre-amendment) `chat_dm_safety_audit` table shape.
- **2026-08-05, same day, owner-directed amendment:** SS5 row 6 rationale replaced, SS6.1 DDL rewritten
  (drop `chat_dm_safety_audit`, add `RAISE LOG`), scope extended to `packages/db/src/test-harness.ts`/
  `packages/db/src/rls-invariants.test.ts` (SS6.3/SS8).
- **2026-08-06, round-01/02 re-verification:** every gate below RE-CHECKED against the amended,
  as-implemented state (not carried over from 2026-08-05) — `REVIEWED_AT` updated to reflect that.
  None needed to change verdict: G1 (authority pin, DD-55 itself unchanged)/G2 (decision scope, the
  audit-mechanism swap is an implementation detail, not a new product/policy question)/G3
  (dependency, `chat-definer-role-provisioning` still MERGED)/G6 (external, same) hold
  unconditionally; G4 (acceptance-matrix coverage) re-verified against the amended SS9; G5 (scope)
  re-verified against the CURRENT, amended `TARGET_FILES`/`IN_SCOPE` below, not the original
  7-file list.
- **2026-08-06, round-03 re-verification:** a hard-pinned test count ("36/36") was here and went
  stale within the SAME re-verification note after round-02 added tests — removed rather than
  re-pinned (codex round-03 [P2]); G4's own evidence is `pnpm --filter @plexco/db test` passing in
  full, not a specific number copied into this doc. Round-03 also found and fixed one genuine P1
  (chat_definer cluster-global membership permanently lost on test teardown, confirmed as real
  damage to this session's own local dev cluster, not theoretical) and 3 P2s (an unlocked
  full-migration path, an under-covered acceptance/security matrix including a claimed-but-
  never-actually-tested NULL-action regression, and this doc's own LOC/test-count claims going stale a
  second time within one slice). None change G1/G2/G3/G6; G4/G5 re-verified again against the
  round-03 state specifically.
- **2026-08-06, round-04 re-verification:** found and fixed the most consequential defect across all
  four rounds — `client_min_messages` is a plain, caller-controlled session GUC, so
  `assert_dm_allowed`'s own `RAISE LOG` (actor/peer/action/deny_reason) was client-reachable by any
  caller that raised its own threshold to `log`, directly contradicting DD-55's "no block detail
  leaked" requirement and this migration's own stated design goal (§5 row 6, §9's own prior wording)
  — a real gap this doc itself had not caught across three earlier rounds. Fixed with a
  function-local `SET client_min_messages = warning` clause, verified directly (a session that sets
  `client_min_messages='log'` itself no longer receives the notice; the override does not persist
  into the caller's own session afterward). This closes a security property this doc had
  (incorrectly) described as already satisfied — SS5 row 6, SS9, and this file's README counterpart
  are all corrected accordingly, not just this block. Also fixed: this backlog entry's own
  `status:` line was unparseable by `autopilot-backlog-reconcile` (a narrative sentence instead of a
  canonical token), and the zero-grant test only covered SELECT/INSERT/EXECUTE — widened to the full
  PG16 table-privilege set via `has_table_privilege`/`has_function_privilege`. None of the four
  findings changed G1/G2/G3; G4/G5/G6 re-verified again against the round-04 state.
- **2026-08-06, round-05 re-verification (this feature's LAST allowed review round under the
  MAX_ROUNDS=5 breaker):** found and fixed the most subtle defect across all five rounds — the
  chat_definer revoke/restore hand-off (added round-03 to fix a real membership-loss bug) itself
  released the advisory lock between the revoke step and the later restore step, leaving a genuine
  window for another test to occupy the slot in between; reproduced in this session's own history
  (JCL-1 observing BR-6's transient member) but not previously recognized as a LOCKING gap rather
  than just a missing-restore gap. Fixed with `acquireChatDefinerLock`, a manual-release counterpart
  to `withChatDefinerLock`, holding one continuous critical section from the initial revoke through
  the final restore across `test-harness.ts`'s `bootstrapChatDefinerForOwner`/`teardown`,
  `migrate.test.ts`'s BR-3, and `rls-invariants.test.ts`'s JCL-1 — which required REMOVING two
  now-redundant outer `withChatDefinerLock` wrappers (BR-6, JCL-1) that would otherwise deadlock
  against the newly-internal lock (verified this restructuring directly: 3 consecutive full DB
  suite runs, 414/414 each, no hangs). Also fixed: the manifest's own `_verification_note` and
  `security_review.reason` still described the PRE-round-04 (leaky) RAISE LOG behavior as the
  thing to verify, exactly backwards from what round-04 made correct; the negative-scope
  enumeration in both the manifest and this doc's SS8 had not been updated since the original
  2026-08-05 owner amendment despite three further rounds of narrowly-justified, mechanically-
  necessitated additions on top of it; and this doc's own closure matrix still cited the stale
  `5cad41f` original-authoring base (SS10 itself was already correctly pinned to `3289e3b`) and a
  stale `planned` backlog status (round-04 had already corrected the actual status line to
  `blocked`). None of round-05's findings changed G1/G2/G3; G4/G5/G6 re-verified again against the
  round-05 state — this is the closest any round came to a scope-boundary finding (G5), resolved by
  accurately enumerating what was already narrowly justified, not by reverting real fixes. The
  mandatory independent code +
  security review (manifest `code_review`/`security_review`) is running against this exact,
  re-verified, as-amended diff — this block is not a substitute for that review, it is this slice's
  own re-affirmation ahead of it.

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-08-06 (re-verified after round-05, the last allowed round under MAX_ROUNDS=5; originally 2026-08-05, re-verified again after round-01/02/03/04)
AUTHORITY_SHA: 90d292d85fbe92db7a5afcd118a99e28f3d3b3b7
LIVE_BASE_SHA: 3289e3b90b1e46739ead4bab8a05fe95fec0b77a
BASE_BRANCH: main
BASE_REMOTE_RELATION: MAIN_EQUALS_ORIGIN_MAIN
TARGET_FILES:
  # codex round-02 [P2]: the list below was this slice's ROOT (dd38-dd86-chat-schema-core)
  # contract's own TARGET_FILES, copy-carried in error -- it neither matched this slice's actual
  # diff nor omitted files, it was simply the WRONG list. Replaced with the exact 10 files in
  # `git diff --stat <LIVE_BASE_SHA>...HEAD`, matching manifest.json's own scope array.
  - docs/autopilot-backlog.md
  - docs/autopilot/contracts/autopilot-chat-dm-safety-authority-core.md
  - docs/autopilot-manifests/chat-dm-safety-authority-core.json
  - packages/db/README.md
  - packages/db/migrations/0030_chat_dm_safety_authority_core.sql
  - packages/db/schema.ts
  - packages/db/src/chat-dm-safety-invariants.test.ts
  - packages/db/src/migrate.test.ts
  - packages/db/src/rls-invariants.test.ts
  - packages/db/src/test-harness.ts
SLICE: chat-dm-safety-authority-core
IN_SCOPE: chat_dm_safety_config/chat_blocks/chat_reports storage; dm_safety_enabled()/
  chat_pair_blocked() pure predicates; assert_dm_allowed() fail-closed gate emitting RAISE LOG on
  deny (amended 2026-08-05 — no chat_dm_safety_audit table); exact grants (chat_definer SELECT +
  EXECUTE on rate_limit_check); invariant tests proving the negative (blocked/disabled/rate-limited
  all deny, no leak); owner-authorized scope amendment closing a chat_definer test-harness gap
  (test-harness.ts, rls-invariants.test.ts — §6.3/§8)
OUT_OF_SCOPE: any chat_* content table; chat_definer role creation; create_dm/send_chat_message/
  mark_read/block-report RPCs; any grant to app on the three new tables; any mutation grant to
  chat_definer on chat_blocks/chat_reports; DD-56 capability registry; any HTTP route; a queryable
  audit table (backlog: chat-dm-safety-audit-queryable-path) (full list §8)
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
ENABLEMENT_ONLY_GATES: chat_dm_safety_config's four capability flags (block_enabled/
  report_enabled/rate_limit_enabled/audit_enabled) default false (codex round-02 [P1], reversing
  round-01's position -- see the migration's own comment). dm_safety_enabled() is false and
  assert_dm_allowed() denies with safety_disabled on a fresh migration; an explicit operator
  UPDATE is required to enable, expected to land alongside slice 7/8's create_dm/send_chat_message
  wiring once production-appropriate dm_sender_limit_per_min/dm_target_limit_per_min values are
  confirmed. Proven by a dedicated fresh-migration test (SS9 row updated).
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12 — see §10.1, re-verified 2026-08-06 against the amended state)
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: PASS (implemented in worktree feat/chat-dm-safety-authority-core, 2026-08-05,
  amended same day per owner ruling, re-verified 2026-08-06 across five real codex review rounds —
  see amendment history above; round-05 is the last allowed round under MAX_ROUNDS=5)
FIRST_IMPLEMENTATION_STEP: DONE — see the amendment history above; next step is a sixth code +
  security review round on this exact, round-05-fixed diff. Per this repo's own MAX_ROUNDS=5
  breaker, any actionable finding in that round is a HALT, not a sixth fix round
REMAINING_BLOCKERS: none in this slice's own scope; the local dev cluster's chat_definer role
  currently has zero members (confirmed real damage from this session's own pre-fix test runs,
  not caused by the fix itself — see backlog note) and needs an operator-run `pnpm db:bootstrap`
  to restore normal (non-test) migration capability. Not a code blocker on this slice; flagged for
  the owner to action directly.
```

### 10.1 Closure matrix (12/12)

| # | Gate | Evidence | PASS/FAIL |
|---|---|---|---|
| 1 | Authority snapshot pin theo SHA | `90d292d` (decision, unchanged) + `3289e3b` (codex round-05 [P2]: this row still cited `5cad41f`, the original 2026-08-05 authoring-time base, three commits behind the ACTUAL pinned worktree/implementation base `3289e3b` that every round's own review has been diffing against since; corrected to match §10's own `LIVE_BASE_SHA`), verified 2026-08-06 | PASS |
| 2 | Decision trong scope đã chốt | DD-55 `✅ Chốt` (2026-07-16, hard-gate language quoted verbatim §5); no open product/policy question touches this slice's storage+predicate+gate scope | PASS |
| 3 | Scope IN/OUT và owner rõ | §6 (in) / §8 (out), each row justified against the Reviewed spec or an explicit forward-reference/ownership constraint | PASS |
| 4 | Dependency phân loại đủ | Exactly one hard dependency, `chat-definer-role-provisioning`, classified `MERGED` with same-order `base_sha`/`landed_sha`/`file`/`symbol` proof (§4.1) — not a placeholder | PASS |
| 5 | Live schema/code khớp doc | §3 table — migration tail `0029` (re-derived, corrects AP-45's own stale `0029` guess), zero `chat_*` runtime, `chat_definer` role confirmed live with exact attributes | PASS |
| 6 | Data/API/state/auth contract đủ | Exact DDL §6.1 (amended 2026-08-05: `chat_dm_safety_audit` table removed, `RAISE LOG` added — implementation-proven, see §5 row 6), consistent with root's pinned consumer contract (§4.2) and every applicable core-db-architecture-principles.md rule (P1/P2/P4/P6/P7/P8/P17) | PASS |
| 7 | Fail-closed/idempotency/order đủ | `COALESCE(...,false)` on missing config, incl. `audit_enabled` (amended); ordered `disabled → blocked → rate` checks; generic exception text; `RAISE LOG` (amended, replacing an append-only audit table that could not persist); `rate_limit_check` reuse inherits its own proven idempotent-consume/retention behavior | PASS |
| 8 | Open question trong scope = 0 | §5 escalation check — all 14 design decisions resolved at Tier 1 at authoring time; row 6's mechanism was later found wrong by implementation and amended by the owner (§5 row 6) — not a Tier 2/3 escalation left open, a closed amendment | PASS |
| 9 | Acceptance matrix có expected result | §9 (amended 2026-08-05 for the `RAISE LOG` mechanism), full B2 category coverage incl. negative-proof rows (blocked/disabled/rate-limited, no-leak, permission-denied) | PASS |
| 10 | Migration/security/rollback pin | Exactly 1 migration (+ mechanical/doc files + owner-authorized scope amendment, §6.4); B3 budget exception `≤750 LOC` cited and measured EXCEEDED by roughly 2.2x (§6.4 — codex round-03 [P2]: this row previously said "estimated within" after §6.4 itself already recorded otherwise, an internal contradiction, not just a stale number), attributed to five real review rounds' worth of fixes and NOT scope creep — file set held at 10 throughout; module count grew 3→5 with the owner-authorized amendment; P17 forward-only acknowledged explicitly (no rollback runbook, nothing destructive to undo); safe to drop entirely pre-enable (zero live caller until slice 3 lands) | PASS |
| 11 | First slice có hard dependency merged | `chat-definer-role-provisioning` is merged (§4.1) — this is not a first-to-code node with an unmerged prerequisite, unlike AP-45's own current state | PASS |
| 12 | Implementation handoff sẵn sàng | Packet (this doc) + manifest + launcher all authored and internally complete; backlog entry's canonical status token is `blocked` (codex round-05 [P2]: this row said `planned`, stale since round-04 corrected the backlog line's own token from an unparseable narrative sentence to `blocked` — accurate for a task genuinely blocked pending its own review-gate cycle, not `planned`, which implies not-yet-started) — §11 of this task's own work, tracked separately from this doc | PASS |

12/12 PASS. Verdict: `CODE_READY`.

## 11. Notes for the future implementer

**Implemented 2026-08-05** in worktree `feat/chat-dm-safety-authority-core`, migration number `0030`
(re-derived at implementation time, matched the provisional guess in §7). The notes below are kept as
the historical implementation record; §6.1 is now the AS-IMPLEMENTED, owner-amended DDL.

- Migration number and "no `chat_*` exists" were re-verified live at implementation time, per this
  section's original instruction — both held; `0030` was correct.
- §6.1 was copied verbatim at first, THEN amended: implementation found `chat_dm_safety_audit` (an
  `INSERT`-then-`RAISE EXCEPTION` table write) could never persist a row — exactly the class of
  "looks wrong once you're staring at a live database" this note originally warned about. Per this
  note's own original instruction, that was reported rather than silently patched; the owner ruled
  (a) drop the table, emit `RAISE LOG` instead, (b) go further and record the design-gap rationale in
  §5 row 6, (c) authorize a scope amendment to `test-harness.ts`/`rls-invariants.test.ts` (§6.3/§8) for
  a related, mechanically-forced test-harness gap. §6.1/§5 row 6/§8/§9 are all updated in place to
  match.
- The two rate-limit numbers (30/min sender, 30/min target, §5 row 11) remained this session's own
  default, not an owner ruling, through the amendment — unaffected by it. If real traffic data or an
  owner review disagrees, change them via a new forward migration (P17) — never a hand-edited
  already-applied file.
- Security review (manifest `security_review.required: true`) must specifically verify: (a)
  `dm_safety_enabled()` truly fails closed (not just "usually returns false") when the config row is
  missing/mid-transaction-invisible; (b) `chat_pair_blocked` checks BOTH directions (a common one-line
  bug is to check only one); (c) `assert_dm_allowed`'s raised exception never varies by `deny_reason`;
  (d) no grant beyond exactly what §6.1's owner/grant block lists exists after migration (in particular,
  confirm `app` truly has zero grant on any of the three tables and zero `EXECUTE` on any of the three
  functions); (e) **amended, then hardened in codex round-04 [P1]** — `RAISE LOG` fires only when
  `audit_enabled` is true (fail-closed: missing config row means no log, not "log anyway"), and
  never leaks to ANY client, including one that raises its own `client_min_messages` to `log` —
  `assert_dm_allowed`'s own `SET client_min_messages = warning` clause forces that regardless of the
  caller's session (verified directly that the override is scoped to the single call and does not
  persist into the caller's session afterward) — SERVER log only, no table, no grant, so no
  caller-reachable read path of any kind.

## 12. HALT MAX_ROUNDS record (2026-08-06)

Copied verbatim from the gitignored, worktree-local
`.autopilot/state/chat-dm-safety-authority-core/HALT-MAX_ROUNDS.txt` (7739 bytes, confirmed by byte
count before this copy) into this tracked file, because `ap-finish.sh`'s own sanctioned close path
removes the worktree — and with it, that file — with no separate warning at the moment it does so.
The backlog entry's own dated note (`docs/autopilot-backlog.md`, commit `ddb9bc9`) summarizes the
same two findings; this section is the exact, complete record, kept verbatim rather than
re-derived, per this repo's own "never rewrite dated history" convention.

```text
HALT: MAX_ROUNDS
FEATURE: chat-dm-safety-authority-core
DATE: 2026-08-06
WORKTREE: .autopilot/worktrees/chat-dm-safety-authority-core
BRANCH: feat/chat-dm-safety-authority-core
BASE_SHA: 3289e3b90b1e46739ead4bab8a05fe95fec0b77a
HEAD_SHA (last committed, NOT fixed further): 018ef920d186dfeea78d13d984e724f326e5474e
FIX_ROUND_COUNT: 5 (hard cap under this repo's own operating invariants: "fix-round-count > 5 -> HALT MAX_ROUNDS, a HARD stop, not advisory")

WHY THIS IS A HALT, NOT ANOTHER FIX ROUND
------------------------------------------
Five real codex review rounds ran against this feature (gate-attempt-03/05/06/07/08), each with
genuine, distinct findings, each fixed in-slice:
  round-01 (commit 79cb540): 7 findings
  round-02 (commit ba1935d): 6 findings
  round-03 (commit 4336f38): 4 findings
  round-04 (commit 7daa250): 3 findings
  round-05 (commit 018ef92): 4 findings
fix-round-count.txt now reads 5 -- the exact hard cap. A sixth review round (gate-attempt-09,
reviewing commit 018ef92) returned 2 MORE actionable findings. Per this repo's own global
operating invariant ("fix-round-count > 5 -> HALT MAX_ROUNDS -- a HARD stop, not advisory. The
round loop MUST exit at >5 even if findings are still 'real' and distinct; do NOT 'just one more
round'"), and per this session's own explicit, written commitment to that effect recorded in the
readiness.json acceptance notes for rounds 03, 04, and 05, this HALTs now rather than attempting a
sixth fix round -- regardless of how small or clearly-correct the two findings below are.

THE TWO UNFIXED FINDINGS FROM ROUND-06 (gate-attempt-09-code-review-round-01.txt) -- BOTH VERIFIED
ACCURATE BY DIRECT RE-READ OF THE ACTUAL CODE BEFORE WRITING THIS FILE, NOT TAKEN ON FAITH
----------------------------------------------------------------------------------------------------

1. [P1] job_definer is unlocked before BR-6 runs the migration (packages/db/src/migrate.test.ts:473).
   Round-05's own fix (this HALT's own predecessor commit) narrowed BR-6's withJobDefinerLock to wrap
   ONLY `ctx.bootstrapJobDefinerForOwner()`, specifically to avoid a deadlock against
   bootstrapChatDefinerForOwner's newly-internal chat lock. That fix was correct for the chat-lock
   deadlock it targeted, but it is a REGRESSION for job_definer's own protection: migration 0022
   ASSERTS (never creates) the cluster-global job_definer role, and `ctx.runMigration()` (line 475,
   AFTER the job lock has already been released at line 473) now reaches it unprotected. With
   fileParallelism enabled, a concurrent migrate.test.ts JCL-2/JCL-3 test (which deliberately hides
   or corrupts job_definer for its own negative-path assertion) can now race BR-6's own migration
   run, producing intermittent, misleading failures -- exactly the class of bug withJobDefinerLock
   exists to prevent, and exactly what job_definer's own lock contract (test-harness.ts's own
   withJobDefinerLock documentation, ~line 243) requires it not do.

   THE FIX (not applied, out of round budget): keep bootstrapJobDefinerForOwner, bootstrapChatDefiner
   ForOwner, and runMigration all inside ONE withJobDefinerLock, preserving job-outer/chat-inner
   ordering -- i.e. `withJobDefinerLock(BASE!, async () => { await ctx.bootstrapJobDefinerForOwner();
   await ctx.bootstrapChatDefinerForOwner(); await ctx.runMigration(); ... })`. This does NOT
   reintroduce the chat-lock deadlock round-05 fixed: withJobDefinerLock and the chat lock
   bootstrapChatDefinerForOwner acquires internally are DIFFERENT advisory-lock keys (0x6a6f6264
   "jobd" vs 0x63686164 "chad"), so nesting the (unrelated-key) job lock around a call that
   internally acquires the chat lock is safe -- only nesting the SAME key twice deadlocks, which is
   what round-05 correctly removed. rls-invariants.test.ts's JCL-1 (round-05's OTHER fix site) may
   have the identical shape -- re-check it under the same lens before trusting it clean.

2. [P2] The new manual advisory-lock lifecycles (acquireChatDefinerLock, added round-05) do not
   release on every cleanup failure.
   - test-harness.ts's own teardown() (~line 581-599): `ownerPool.end()`, each workerPool's `.end()`,
     `DROP DATABASE ... WITH (FORCE)`, and `DROP ROLE IF EXISTS` all run BEFORE the
     `if (chatDefinerLockRelease) { try { ...restore... } finally { await chatDefinerLockRelease(); } }`
     block. If ANY of those four preceding statements throws, chatDefinerLockRelease() is never
     called -- the dedicated lock-holder pg.Client connection is never closed, and the advisory lock
     it holds is never released, blocking every other test file's own chat_definer work until the
     leaked connection times out or the whole suite run ends.
   - migrate.test.ts's BR-3 (~line 246-260) has the same shape: `DROP DATABASE`/`DROP ROLE` run
     before the `try { restore } finally { releaseChatDefinerLock() }` block, not inside an outer
     finally that covers them too.

   THE FIX (not applied, out of round budget): wrap the ENTIRE post-acquisition cleanup sequence --
   pool shutdown, database/role deletion, AND the restore -- in one outer try/finally whose finally
   unconditionally calls the lock's release(), re-throwing (not swallowing) whatever the inner
   cleanup itself threw, so a genuine cleanup failure still surfaces as a test failure while never
   leaking the lock.

WHAT IS SAFE, VERIFIED, AND SHOULD NOT BE RE-LITIGATED FROM SCRATCH
---------------------------------------------------------------------
- Every prior round's fix (79cb540, ba1935d, 4336f38, 7daa250) remains correct and does not need
  re-review; only round-05's own commit (018ef92) introduced the job_definer-lock regression above.
- 414/414 DB tests, 732/732 total across the monorepo, all passed cleanly as of commit 018ef92 --
  these findings describe a RACE CONDITION (job_definer) and a CLEANUP-FAILURE-PATH leak (both
  require a specific concurrent-timing or throwing-cleanup condition to manifest), not a
  deterministic failure the existing green suite would have caught. This is not "the suite is lying"
  -- it is the suite testing the happy path correctly while these two edge conditions sit outside it.
- The local dev cluster's chat_definer role currently has ZERO members (confirmed real, pre-existing
  damage from EARLY in this session, BEFORE round-03's fix existed -- not caused by round-05's
  regression above). This still needs an owner-run `pnpm db:bootstrap` to repair; unrelated to this
  HALT, tracked separately in the backlog entry's own status line and REMAINING_BLOCKERS field.

RESUME CONDITION
----------------
Per this repo's canonical registration mechanics (any change to `scope`, `verification`,
`stop_conditions`, or fields "with teeth" requires the full close-and-rebuild sequence): a fresh
successor task/registration should re-slice from `main` at a freshly-verified base SHA (main has not
moved since 3289e3b as of this HALT, but re-verify before trusting that), apply the two fixes above
as its OWN first commit (not a continuation of fix-round-count, which resets with the new
registration per this repo's own documented registration mechanics), then resume the review cycle
with a fresh MAX_ROUNDS=5 budget. Do NOT hand-edit this worktree further under the current
registration to "sneak in" the two fixes above -- that would not reset fix-round-count honestly and
would misrepresent this feature's own review history.

Every other artifact in this worktree (readiness.json, regions.log, fix-round-count.txt, the 5
commits, the contract doc's own round-01..05 amendment history, the manifest's negative-scope
enumeration) is accurate as of this HALT and should be read, not re-derived, by whoever picks this
up next.
```
