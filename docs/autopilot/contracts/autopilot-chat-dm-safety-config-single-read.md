<!-- review-readiness: code-ready -->
# chat-dm-safety-config-single-read — task contract

> **Slice:** `chat-dm-safety-config-single-read` (slug = mechanism: collapse `assert_dm_allowed`'s
> four-statement config read into one consistent read).
> **Risk:** P1 · **Change class:** schema (one forward-only migration) · **Autonomy:** supervised.
> **Opened from:** DD-102 (owner-final 2026-08-10) — the conditional waiver whose hard condition this
> slice discharges.
> **Authored:** 2026-08-11 against `origin/main` @ `37c6f8bc3fc4d2b2d15416adeed2138d1f0e8262`.
> **Manifest:** `docs/autopilot-manifests/chat-dm-safety-config-single-read.json`.
> **Launcher:** `.claude/commands/ap-53-chat-dm-safety-config-single-read.md`.
> **Verdict:** `CODE_READY` — see §8. Task-contract fields (level3-workflow §3) are in §0.

## 0. Task contract (level3-workflow §3)

```text
TASK_ID: plexco:chat-dm-safety-config-single-read
OUTCOME: assert_dm_allowed() decides on ONE consistent snapshot of chat_dm_safety_config, closing the
  DD-102 torn read, before slice 7/8 become its first callers. Behavior byte-identical otherwise.
REPOSITORY_AND_BASE: plexco-app @ origin/main (re-pin live tip at register; authored at 37c6f8b).
CONTEXT_SOURCES: DD-102 (decisions.md), 0030_chat_dm_safety_authority_core.sql, DD-55 in
  feature_inapp_chat_tech.md, 0012_auth_functions.sql (rate_limit_check), chat-dm-safety-invariants.test.ts.
APPLICABLE_SKILLS: none (DB migration + pgTAP-style vitest already resident in packages/db).
SCOPE: one new migration 0032 + chat-dm-safety-invariants.test.ts + mechanical literals in
  rls-invariants.test.ts / migrate.test.ts + README.md + this contract + manifest + backlog entry.
NEGATIVE_SCOPE: no edit to 0030; no schema.ts change; no table/constraint/grant/RLS change; no RPC/route;
  no change to any deny branch, deny reason, exception text, read-skip, or audit line — read count only.
RISK: P1
AUTONOMY_MODE: supervised
MODEL_POLICY: planner=primary-agent; worker=assigned-agent; reviewer=scripts/codex-review-pin.sh (2 clean
  code rounds + 1 security round); fallback=HALT_TOOL_UNAVAILABLE.
SANDBOX_AND_PERMISSIONS: network none; secrets none; external side effects none.
HUMAN_DECISIONS_REQUIRED: none for code (DD-102 owner-final). Merge/deploy authority stays with owner.
SLICE_GRAPH: single slice; hard-depends on chat-dm-safety-authority-core (MERGED, 0030). Serializes
  against chat-identity-merge-reparent-enablement (shared migration tail + shared backlog/test literals).
WORKTREE_PLAN: one worktree feat/chat-dm-safety-config-single-read from the verified live origin/main tip.
VERIFICATION: focused property greps + full canonical suite incl. real-Postgres pnpm test (see manifest).
CODE_REVIEW: required, scripts/codex-review-pin.sh, 2 consecutive clean rounds.
SECURITY_REVIEW: required — fail-closed safety-gate recreation (see §7).
BUDGETS: ~<=120 changed LOC of real logic, <=1 migration, wall <=120min, fix_rounds_max 5.
STOP_CONDITIONS: MAX_ROUNDS(>5) · REGION_THRASH · SCOPE_OR_BASE_DRIFT · any fail-OPEN regression on the
  gate · dm_current_read_allowed behavior change · migration-number drift (see manifest stop_conditions).
DELIVERABLES: migration 0032, invariant/regression tests, README entry, green canonical suite, 2 clean
  code rounds + 1 clean security round, READY report with exact merge inputs.
```

## 1. Why this slice exists — DD-102's hard condition

DD-102 (decisions.md, owner-final 2026-08-10) waived, **for one registration only**, codex round-5
finding 1 against `chat-dm-safety-authority-core--v3`: `assert_dm_allowed()` reads its configuration
through **four separate statements**, each taking its own snapshot under READ COMMITTED, so a
concurrent config tightening can apply **partially** to an in-flight call (a torn read).

The waiver carries a **hard, dated condition** (DD-102 bullet "ĐIỀU KIỆN CỨNG"): the follow-up
migration that collapses the four reads into **one statement (or an equivalent lock)** must land
**before the first caller** — i.e. before slice 7 (`chat-shared-message-command-core`) and slice 8
(`chat-dm-lifecycle-command-core`). If either of those reaches the queue before this slice lands,
**this becomes their blocker**, not a debt they may carry. This slice discharges that condition.

**Re-measured, not inherited (2026-08-11) — two facts DD-102 states, both confirmed against 0030 on disk:**

- **This is NOT fail-open.** `rate_limit_check(bucket, 0, interval)` (`0012_auth_functions.sql`) runs
  `IF v_count >= p_limit THEN RETURN false`; with `p_limit = 0`, `v_count >= 0` is always true, so a
  missing/zeroed config **denies**. `dm_safety_enabled()` false ⇒ `safety_disabled` ⇒ deny. The torn
  read can only make a concurrent **tightening** apply one beat late; it never turns a deny into an
  allow. Exposure today = 0 (`assert_dm_allowed` has zero production caller; it appears only in a
  schema.ts comment). **The defect is inconsistency, not bypass** — which is exactly why it is a
  correctness fix that must land before the gate goes live, not an emergency.
- **`dm_current_read_allowed()` is NOT what this slice fixes.** It (root, `0031`) calls only
  `dm_safety_enabled()` and `chat_pair_blocked()` — each a single statement — so it has no
  four-statement shape. This slice must PRESERVE it unchanged (see §3, §7).

## 2. The defect, exactly — four reads in `0030`

`packages/db/migrations/0030_chat_dm_safety_authority_core.sql`, function `assert_dm_allowed` (lines
290–333). Four independent reads of the singleton config, each its own snapshot:

```text
310: v_sender_limit := COALESCE((SELECT dm_sender_limit_per_min FROM chat_dm_safety_config WHERE singleton), 0);
311: v_target_limit := COALESCE((SELECT dm_target_limit_per_min FROM chat_dm_safety_config WHERE singleton), 0);
312: v_audit_enabled := COALESCE((SELECT audit_enabled      FROM chat_dm_safety_config WHERE singleton), false);
314: IF NOT dm_safety_enabled() THEN            -- dm_safety_enabled() runs its OWN SELECT ... WHERE singleton (0030:214)
```

Reads 1–3 are inline `SELECT`s; read 4 is inside `dm_safety_enabled()`. Under READ COMMITTED an
`UPDATE chat_dm_safety_config SET ...` committing between any two of these statements is seen by the
later statements but not the earlier ones — the call decides on a mix of pre- and post-tightening
values.

## 3. The pinned fix — single source of the AND, single read of the row

Two design rules the codebase already enforces make the fix nearly unique:

- **Single read (DD-102's literal requirement):** `assert_dm_allowed` reads the singleton row **once**,
  into a record, and derives everything (enabled, both limits, audit flag) from that one snapshot.
- **Single source of the derived aggregate (autopilot-invariant-catalog "single source of truth" rule):**
  the "enabled = AND of the four flags" value must have **one** definition, not one inside
  `dm_safety_enabled()` and a second re-derived inside `assert_dm_allowed`. Re-deriving it per call
  site is the catalog's named #1 thrash source, and here it is also a **security** hazard: if the two
  copies ever drift, one DM path could enforce safety while another does not. So the AND is extracted
  into one pure helper that both functions call.

**Pinned DDL for migration `0032_chat_dm_safety_config_single_read.sql`** (re-number per manifest note;
copy verbatim otherwise):

```sql
-- dm_safety_flags_enabled: the SINGLE definition of the four-flag kill-switch AND.
-- Pure (no table access), so no SECURITY DEFINER and no search_path pinning is needed -- it references
-- only its arguments and built-in AND/COALESCE. COALESCE(...,false) makes any NULL flag fail closed.
CREATE FUNCTION dm_safety_flags_enabled(p_block boolean, p_report boolean, p_rate boolean, p_audit boolean)
  RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_block AND p_report AND p_rate AND p_audit, false);
$$;
REVOKE ALL ON FUNCTION dm_safety_flags_enabled(boolean, boolean, boolean, boolean) FROM PUBLIC;

-- dm_safety_enabled: unchanged signature/semantics; now DELEGATES to the shared helper so the AND has
-- one definition. The OUTER COALESCE over the singleton subquery preserves 0030's missing-row -> false
-- exactly (an empty row set makes the subquery NULL; the inner helper form alone would return NULL).
CREATE OR REPLACE FUNCTION dm_safety_enabled() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    (SELECT dm_safety_flags_enabled(block_enabled, report_enabled, rate_limit_enabled, audit_enabled)
       FROM chat_dm_safety_config WHERE singleton),
    false
  );
$$;

-- assert_dm_allowed: reads the singleton row ONCE (one snapshot), derives enabled via the shared
-- helper, and uses the record's limits + audit flag. Every branch, reason, exception text, read-skip
-- and the RAISE LOG audit line is preserved verbatim from 0030 -- ONLY the read count changes (4 -> 1).
-- It no longer calls dm_safety_enabled() (that was read #4); it computes enabled from its own snapshot.
CREATE OR REPLACE FUNCTION assert_dm_allowed(p_actor uuid, p_peer uuid, p_action text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  SET client_min_messages = warning AS $$
DECLARE
  v_deny_reason text;
  v_cfg chat_dm_safety_config%ROWTYPE;   -- one snapshot; %ROWTYPE survives future column additions
  v_enabled boolean;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('create','send','read') THEN
    RAISE EXCEPTION 'assert_dm_allowed: invalid action' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_actor IS NULL OR p_peer IS NULL OR p_actor = p_peer THEN
    RAISE EXCEPTION 'assert_dm_allowed: invalid participants' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_cfg FROM chat_dm_safety_config WHERE singleton;   -- <-- the single read
  v_enabled := dm_safety_flags_enabled(v_cfg.block_enabled, v_cfg.report_enabled,
                                       v_cfg.rate_limit_enabled, v_cfg.audit_enabled);

  IF NOT v_enabled THEN                                             -- helper guarantees non-null
    v_deny_reason := 'safety_disabled';
  ELSIF chat_pair_blocked(p_actor, p_peer) THEN                     -- different table; intentionally separate (§NEGATIVE)
    v_deny_reason := 'blocked';
  ELSIF p_action IN ('create','send')
        AND NOT rate_limit_check('chat_dm_sender:' || p_actor::text,
                                 COALESCE(v_cfg.dm_sender_limit_per_min, 0), interval '1 minute') THEN
    v_deny_reason := 'rate_limited_sender';
  ELSIF p_action IN ('create','send')
        AND NOT rate_limit_check('chat_dm_target:' || p_peer::text,
                                 COALESCE(v_cfg.dm_target_limit_per_min, 0), interval '1 minute') THEN
    v_deny_reason := 'rate_limited_target';
  END IF;

  IF v_deny_reason IS NOT NULL THEN
    IF COALESCE(v_cfg.audit_enabled, false) THEN
      RAISE LOG 'chat_dm_safety_audit actor=% peer=% action=% deny_reason=% at=%',
        p_actor, p_peer, p_action, v_deny_reason, clock_timestamp();
    END IF;
    RAISE EXCEPTION 'chat safety blocked' USING ERRCODE = 'insufficient_privilege';
  END IF;
END; $$;
```

**Fail-closed is preserved by construction** (missing row ⇒ `v_cfg` all-NULL): `dm_safety_flags_enabled(NULL,…)`
= `COALESCE(NULL,false)` = false ⇒ `safety_disabled`; `COALESCE(NULL,0)` = 0 ⇒ `rate_limit_check` denies
(defense in depth); `COALESCE(NULL,false)` audit ⇒ no log. `%ROWTYPE` binds owner (`chat_definer`) is
preserved by `CREATE OR REPLACE` (ownership/ACL unchanged). `dm_safety_flags_enabled` is owned by
`chat_definer` via the same `GRANT USAGE, CREATE … / ALTER FUNCTION … OWNER TO chat_definer / REVOKE
CREATE …` block 0030/0031 already use, so `chat_definer` (owner of the two definer functions that call
it) has implicit EXECUTE and no extra grant is required.

**Behaviour preservation is PROVEN, not asserted.** `dm_safety_enabled()` is recreated and it is already
the designated single source of the four-flag AND (`0030:207` documents it as "pure predicate, the AND of
all four capability toggles"); it has exactly one external consumer, `dm_current_read_allowed` at
`0031:296`. So acceptance row 2b pins its **observable semantics** across the `CREATE OR REPLACE` — call
the function directly and assert a missing singleton row returns false, and each of the four toggles
individually set false (others true) returns false, and all-true returns true — as properties of the
function's behaviour, not a diff of its body. That check is the answer to the reviewer's "did the replace
change anything?", and it protects `0031`'s consumer without depending on the implementer noticing it
exists (row 12 then confirms that consumer end-to-end).

**Why `chat_pair_blocked` stays a separate statement (not a defect):** DD-102 scopes the torn read to
`chat_dm_safety_config`. `chat_pair_blocked` reads a **different** table (`chat_blocks`) whose
current-state semantics already accept a block landing mid-call; folding it into the config read would
change no correctness property and would couple two unrelated tables. It is intentionally left as-is.

## 4. Dependency — one, MERGED, proven

| Dependency | Type | Proof |
|---|---|---|
| `chat-dm-safety-authority-core` (migration `0030`) | `MERGED` (hard functional) | landed `d5b31f942969ad3629bcd673f2fd4de91678147a`; symbol `assert_dm_allowed` **absent** in `packages/` at the dependency base `75f06c5…`, present at landed and at the live base. |

This slice recreates functions `0030` created, so the dependency is functional, not collision-only.
`0030` was closed via owner-authorized disposition + evidence merge (DD-101/DD-102), not a normal READY
gate; the authority is the **merged code at `d5b31f9`, verified on disk**, not the lane's lifecycle.

## 5. Scope, budget, migration number

**In scope (exact files):** the eight paths in the manifest `scope`. Core logic lives in the migration
and `chat-dm-safety-invariants.test.ts`. `rls-invariants.test.ts` and `migrate.test.ts` carry **only**
mechanical migration-count/tail literal bumps a new migration forces — **derive the full set by grep,
never from a line-number list.** Line numbers shift every time a migration lands, so a list is stale the
moment it is written; a grep is not. Method (number-agnostic — re-run it at worktree open):

```sh
CUR=$(ls packages/db/migrations/*.sql | wc -l | tr -d ' ')                 # current count, BEFORE this migration
TAILBASE=$(ls packages/db/migrations/*.sql | sort | tail -1 | xargs basename | sed 's/\.sql$//')
grep -nE "MIGRATION_COUNT|\.toBe\(${CUR}\)|${TAILBASE}" \
  packages/db/src/migrate.test.ts packages/db/src/rls-invariants.test.ts
```

Bump each count literal `CUR → CUR+1` and each tail literal to the new filename. Two shapes to know,
because they are edited differently: `migrate.test.ts` **centralises** the count in
`const MIGRATION_COUNT` — edit the **declaration** once; its consumers reference the const, leave them —
plus one tail literal. `rls-invariants.test.ts` **inlines** the number at each `.toBe(<count>)` site
(edit every one), plus two tail literals and the UCC-8 test-name string. At authoring (`CUR=32`) the grep
returns **14 lines**; the 4 `MIGRATION_COUNT` consumers in `migrate.test.ts` need no edit, leaving
**10 literal sites** (migrate: the const + 1 tail; rls-invariants: 5 count + 2 tail + 1 test-name). **The
completeness proof is the full `pnpm test` suite going green — a missed literal turns the suite red — not
the count of lines you edited.** No other change to those two files. `README.md` gets the per-migration
entry.

**Budget:** ~<=120 LOC of real logic (three small functions), <=1 migration, well under the default
`<=300 LOC / <=3 modules` ceiling; the test-literal and README touches are mechanical/documentation,
the same accounting the sibling `chat-dm-safety-authority-core` manifest used.

**Migration number `0032` is PROVISIONAL** — re-derive with `ls packages/db/migrations/*.sql | sort |
tail -1` at worktree open. AP-45 guessed and lost its number to two unrelated migrations; treat the
guess with the same suspicion, correct scope + re-register if the tail has moved.

**`schema.ts` is out of scope:** zero table/constraint change; the functions are not Drizzle objects.

## 6. Acceptance matrix (specified before code)

| # | Group | Input / precondition | Expected | Layer |
|---|---|---|---|---|
| 1 | Structural (the point) | `pg_get_functiondef(assert_dm_allowed)` after migrate | body reads `chat_dm_safety_config` **exactly once** and **never calls** `dm_safety_enabled()` | vitest (real PG) |
| 2 | Structural | `pg_get_functiondef(dm_safety_enabled)` after migrate | body calls `dm_safety_flags_enabled(` (single-source delegation) | vitest |
| 2b | Behaviour preservation (the recreated predicate) | call `dm_safety_enabled()` directly (as owner) | missing singleton row → false; each of the four toggles individually false (others true) → false; all four true → true | vitest |
| 3 | Boundary / fail-closed | config row deleted (or all-NULL) | `assert_dm_allowed(...,'create')` raises `chat safety blocked` (safety_disabled) | vitest |
| 4 | Fail-closed per flag | each of block/report/rate/audit set false in turn, others true | gate denies | vitest |
| 5 | Authorization | actor blocks peer (row stored one direction only) | denies for BOTH `(actor,peer)` and `(peer,actor)` | vitest |
| 6 | Rate | sender over `dm_sender_limit_per_min`; separately target over its limit | `rate_limited_sender` / `rate_limited_target` deny | vitest |
| 7 | Read-skip | `action='read'` at/over the rate limit | NOT rate-limited; still enforces enabled + blocked | vitest |
| 8 | Failure | invalid `p_action` (incl. NULL) / `p_actor=p_peer` / NULL participant | raises `invalid_parameter_value` | vitest |
| 9 | Security/leak | any deny path with a caller that `SET client_min_messages='log'` | zero client-visible notice content; deny reason only in server log when `audit_enabled` | vitest |
| 10 | Observability | deny with `audit_enabled=true` vs false | `RAISE LOG chat_dm_safety_audit …` present vs absent (server log) | vitest |
| 11 | Regression (uniform text) | every deny branch | raised message is the exact string `chat safety blocked`, never varying by reason | vitest |
| 12 | Regression (consumer) | `dm_current_read_allowed(dm_channel)` before/after migration | identical result — recreating `dm_safety_enabled()` did not change it | vitest |
| 13 | Migration | full `migrate()` replay | applied count and tail advance to the new number; suite green | migrate.test.ts / rls-invariants.test.ts |

Rows 3–12 re-assert `0030`'s behavior against the **recreated** functions — the slice is correct iff
every one of them still holds. Row 1 is the new invariant proving the four reads collapsed to one.

## 7. Security review focus (required)

This slice recreates the DD-55 fail-closed authority gate **and** the predicate a security-sensitive
RLS policy set on root depends on. A regression here is **fail-OPEN on a safety gate**. The security
round must verify, against the migrated live DB, items (1)–(8) in the manifest `security_review.reason`
— in particular that missing-row and per-flag denial are **preserved** (not weakened), that
`dm_safety_enabled()`'s recreated body keeps the **outer** COALESCE (empty row set ⇒ false, not NULL),
that `chat_pair_blocked` is still two-directional, that the exception text is uniform, that
`client_min_messages=warning` still suppresses the client-visible notice, and that the new pure helper
leaks nothing. DD-102 waived this exact class once; the fix must not open a different hole.

## 8. Canonical readiness verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-08-11
AUTHORITY_SHA: 37c6f8bc3fc4d2b2d15416adeed2138d1f0e8262
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot/contracts/autopilot-chat-dm-safety-config-single-read.md
  - docs/autopilot-manifests/chat-dm-safety-config-single-read.json
  - .claude/commands/ap-53-chat-dm-safety-config-single-read.md
  - docs/standards/decisions.md
  - packages/db/migrations/0030_chat_dm_safety_authority_core.sql
  - packages/db/src/chat-dm-safety-invariants.test.ts
  - packages/db/src/rls-invariants.test.ts
  - packages/db/src/migrate.test.ts
  - docs/autopilot-backlog.md
SLICE: chat-dm-safety-config-single-read
IN_SCOPE: one new forward-only migration recreating dm_safety_enabled()/assert_dm_allowed() plus a new pure helper dm_safety_flags_enabled(), collapsing the four config reads to one; regression + single-read structural tests; mechanical migration-count/tail literals in rls-invariants.test.ts and migrate.test.ts; README per-migration entry.
OUT_OF_SCOPE: no edit to migration 0030; no schema.ts change; no table/constraint/index/grant/RLS change; no change to any deny branch/reason/exception-text/read-skip/audit-line; no RPC/route/SSE; no change to chat_pair_blocked or dm_current_read_allowed behavior; only the config read count changes.
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: chat-dm-safety-authority-core (migration 0030) merged at d5b31f942969ad3629bcd673f2fd4de91678147a; probe symbol assert_dm_allowed absent in packages/ at dep base 75f06c5, present at landed.
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: create worktree feat/chat-dm-safety-config-single-read from the verified live origin/main tip, re-derive the migration number, register the runtime manifest, then write 0032 with the §3 DDL and apply it.
REMAINING_BLOCKERS: none
```

### Closure matrix (12/12)

| # | Gate | Evidence | PASS |
|---|---|---|---|
| 1 | Authority pinned by SHA + paths | `37c6f8b…` + §0/§8 target files | PASS |
| 2 | In-scope decisions closed | DD-102 owner-final; no product choice open | PASS |
| 3 | Scope IN/OUT + owner | §5, manifest scope/negative_scope | PASS |
| 4 | Dependencies classified | §4 — one MERGED with same-order probe | PASS |
| 5 | Live schema/code matches doc | §2/§3 quote 0030 verbatim (lines 290–333) | PASS |
| 6 | Data/API/state/auth contract | §3 pins exact DDL, owner, grants, fail-closed | PASS |
| 7 | Fail-closed/idempotency/order | §3 preserves branch order + missing-row → deny | PASS |
| 8 | In-scope open questions = 0 | §0/§8 | PASS |
| 9 | Acceptance matrix has expected results | §6 (13 rows) | PASS |
| 10 | Migration/security/rollback pinned | §5 (0032, forward-only P17) + §7 | PASS |
| 11 | First slice hard-deps merged | §4 — 0030 merged | PASS |
| 12 | Implementation handoff ready | manifest + launcher ap-53 + §3 DDL | PASS |
