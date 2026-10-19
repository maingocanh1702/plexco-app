<!-- review-readiness: code-ready -->

# Step-0 readiness: L13a p3-m9-channel-identity-link-gate (session P3-S12)

> Agent-facing. Readiness reviewer: opus/max (same model and effort as the lane's code reviewer). Writer opus/max; code reviewer opus/max
> plus an opus/max security round (app-granted SECURITY DEFINER on the global identity surface), at most 3 rounds (DD-122 D4: Codex
> waived, independent Claude reviewer). Every `path:line` below is MEASURED at base `819de9cc982bac48c84196612bae2f961f2bbade`. Use THIS
> file's numbers. TARGET_FILES (section 12) are read-only context that exists at the base; the edit set is section 4 + section 8 (new
> files are scope, never TARGET_FILES).
> Authority: owner decision B-A1 R1 (2026-10-19, verbatim in status/CONDUCTOR-LOG.md): "add the narrow predecessor migration (SECURITY
> DEFINER wrapper returning (linked, account_ref) for one channel identity, granted to app)". No other owner decision is needed.
> Review questions (lane REVIEW PLAN) and where each is closed: **privilege escalation** -> 3.1, 3.3, LG-5a..c; **search_path and
> ownership** -> 3.1, LG-6b; **divergence from the core's predicate** -> 3.2 (the wrapper only maps); **enumeration or oracle** -> 4.2
> (one generic deny row, no raise), LG-3a..i, LG-6a; **legacy rows** -> LG-2b; **ACL regression on the core** -> LG-5c; **reserved name
> and comment claims** -> 4.1, 4.3; **lock footprint** -> 3.4, LG-C1, LG-C2.
> Provenance: Q1-Q5 answered by readiness reviewer #1 (stopped at the token rule, nothing committed); readiness reviewer #2 (fresh,
> opus/max) closed its three OPEN items (A-12/A-13 lines, the link-code consume lock order, RLS on the core's relations) and wrote this file.

## 1. Base, dependencies, authority

- Worktree HEAD = origin/main = `819de9cc982bac48c84196612bae2f961f2bbade`; branch `feat/p3-m9-channel-identity-link-gate`;
  `git status --porcelain` empty, no index.lock at step 0.
- L14 merged: 64 migration files 0000..0063, tail `packages/db/migrations/0063_chat_message_commands.sql` => next free number **0064**.
- 0034 core present: `resolve_deferred_payment_account_core(p_channel_identity_id uuid)` (0034:83); its ACL is owner-only (0034:372).
- 0059 definers present (attribute and grant pattern); 0043 `link_code_consume` present (0043:258, EXECUTE to app 0043:458).
- DD-50 predicate as quoted in the 0034 header (0034:53-59) and in the lane GOAL: a verified Account = at least one
  `account_emails.verified_at IS NOT NULL`; legacy `account_identities` do not count. The core implements it literally (3.2). No STOP.

## 2. Live schema facts (measured)

- Functions are not mirrored in `packages/db/schema.ts` or `packages/db/db.dbml` (0059:5-6) => neither changes.
- Relations the core reads (0034 FROM/JOIN grep): `persons`, `channel_identities`, `accounts`, `account_emails`, `merge_tombstones`.
- The name `channel_identity_link_gate` is free (no hit in packages/db/migrations, packages/db/src, apps/bot/src). The bare name
  `resolve_deferred_payment_account` is RESERVED for the DD-65..68 app-granted resolver (0034:31-35) and is not used.
- rls-invariants.test.ts D-11 (:4724, FORCE-RLS tables with tenant_id need a policy) does not apply: L13a adds no relation, column or policy.

## 3. Answers to the lane questions

### 3.1 Q1 name, signature, owner, volatility, search_path

- Core: `RETURNS TABLE (qualified boolean, account_ref uuid, person_ref uuid, binding_version text)`, plpgsql SECURITY DEFINER,
  `SET search_path = public, pg_temp`, VOLATILE by default (0034:83-88).
- Owner: the migration role. A fresh CREATE FUNCTION is owned by the migration role (0034:366); 0059 has no OWNER TO (0059:20, "Owned by
  the migration role (0051/0052/0055/0058 shape, M-14)"). The wrapper is created the same way, so its owner IS the core's owner and holds
  EXECUTE on the core implicitly: no grant on the core, no change to it.
- Core ACL: `REVOKE ALL ... FROM PUBLIC, app, app_worker, readonly` (0034:372). Core tests: app, app_worker, readonly denied
  (identity-account-link.test.ts:181-188); owner executes (:205-208); has_function_privilege false (:225-233); GRANT-then-REVOKE probe
  (:235-254, GRANT :240, REVOKE :248, assert :253).
- Wrapper attributes copy 0059 (0059:46-53, :78-79): plpgsql, VOLATILE, SECURITY DEFINER, `SET search_path = pg_catalog, public, pg_temp`,
  the core called as `public.resolve_deferred_payment_account_core(...)`. The OUT column `account_ref` collides with the core's column:
  use `#variable_conflict use_column` (0059:53) and alias-qualify (`c.qualified`, `c.account_ref`). No RAISE, no dynamic SQL, no
  set_config, no relation read by the wrapper itself.

### 3.2 Q2 decision cells: every cell is decided by the core; the wrapper only maps

- Every core path returns exactly one row; a deny is always (false, NULL, NULL, NULL).
- Cell -> core line -> core test: NULL argument 0034:112-115 (:384); unknown or inactive identity 0034:122-129 (:260, :269); deleted
  person, merged person with NULL pointer, cycle, more than 16 hops 0034:136-167 (:277, :285, :334); active person still carrying a merge
  pointer 0034:155-158 (:392); tombstoned canonical 0034:173-176 (:406); missing or divergent tombstone 0034:185-191 (:415, :426, :439,
  :452); no account, unverified, legacy-only, several accounts across the chain 0034:198-207 (:291, :300, :316, :324, :465, :476); account
  with NULL person or not on the canonical 0034:210-222 (:308, :465); drift under lock 0034:246-339 (:575); qualified 0034:348-359
  (:342, :350, :369).
- Legacy `account_identities` are never read by the core => a legacy-only account is a deny. No divergence from DD-50.

### 3.3 Q3 ACL and catalog tests

- Only 0034 names the core in any migration; no GRANT on it exists. The wrapper calls no other function.
- No test keeps an allowlist of app-executable definers or EXECUTE grants => allowlist addition = **0 lines**. Every pg_proc /
  has_function_privilege probe is filtered to one function or a named list (tenant.test.ts:125, chat-catalog.test.ts:368,
  chat-schema-invariants.test.ts:931, migrate.test.ts:5191, outbox-projector-registry.test.ts:371/:547, me-player-reads.test.ts:191-232);
  the only whole-catalog function scan (migrate.test.ts:4834-4835) is a before/after equality (:4892, :5075, :5163) a new function cannot break.
- **Closed OPEN item 1 (A-12/A-13, me-player-reads.test.ts):** `describe("0059 catalog (A-12, A-13, M-5)")` :189.
  - A-12 :190-215: query pg_proc JOIN pg_namespace JOIN pg_language (:191-200) for proname, prosecdef, provolatile, proconfig, lanname,
    `pg_get_function_identity_arguments(p.oid) AS args`, `pg_get_userbyid(p.proowner) AS owner`; reference owner (:201-203); exact name
    list (:204); `toMatchObject({ prosecdef: true, provolatile: "v", lanname: "plpgsql", args: "p_account_id uuid", owner,
    proconfig: ["search_path=pg_catalog, public, pg_temp"] })` (:206-213).
  - A-13 :217-244: per function, has_function_privilege for app, app_worker, readonly (:220-222), `p.proacl IS NOT NULL AS explicit_acl`
    (:223), `EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS public_grant` (:224), owner (:225), the EXECUTE grantee
    array from `aclexplode(p.proacl)` (:226-229), looked up by `$1::text::regprocedure` (:230); exact grantee set
    `[...grantees].sort()` equals `[owner, "app"].sort()` (:235); flags `{ app: true, worker: false, ro: false, explicit_acl: true,
    public_grant: false }` (:236-242).
  - Note 33 compliance: the load-bearing privilege assertion is the exact grantee set from the function's own ACL entries (aclexplode,
    as chat-catalog.test.ts:355-366). The copied has_function_privilege flags stay stable because no *_definer role owns or is granted
    the wrapper. The new test names no job_definer, chat_definer or identity_definer => no definer reader lock (note 34).

### 3.4 Q4 lock footprint, fixtures, caller contract

- The wrapper adds no lock. The core takes FOR SHARE only after phase 1 qualifies (deny paths take no row lock), in canonical order:
  the account (0034:233), its verified email (0034:234), the chain persons UUID-sorted (0034:235-237), the channel identity (0034:238).
  The locks survive into the caller's transaction; the result is a snapshot, not finalizer-safe (0034:37-51).
- **Closed OPEN item 2 (link-code consume lock order):** `link_code_consume(text, bytea, uuid, uuid, interval)` (0043:258-456, the only
  definition in any migration). Its locks (0043:336-353): "accounts -> persons -> channel_identities -> the code row, UUID-sorted within a
  tier, one row per statement": accounts FOR UPDATE (:345), persons FOR UPDATE (:348), channel_identities FOR UPDATE (:351), link_codes
  FOR UPDATE (:353). It writes only `link_codes` (:413, :436); 0043 never touches `account_emails` or `merge_tombstones` (the :86 header
  says merge_tombstones have no writer). The shared tiers have the SAME order on both sides (accounts < persons < channel_identities,
  UUID-sorted within a tier); the core never locks link_codes and consume never locks account_emails => no wait-for cycle between one
  wrapper call and one consume => no 40P01 by construction. LG-C1 proves it on the real DB (no gap under OPEN).
- **Closed OPEN item 3 (RLS on the core's relations):** none of the five relations has RLS enabled or forced: no migration names them in an
  `ALTER TABLE ... ROW LEVEL SECURITY` statement, and the only loop (0009:47-52, `ENABLE` :49, `FORCE` :50) iterates `tenant_tables`
  (0009 array ending :46; tenant-scoped tables only, each given a `tenant_isolation` policy), which does not list them. So RLS does not
  touch the core's reads whatever the owner's BYPASSRLS attribute; the surface is grant-protected. Even if a later migration forced RLS
  on one of them under a NOBYPASSRLS owner, the core would see no row and return the generic deny => (false, NULL): fail closed, not a
  leak. The wrapper reads no relation itself, so it needs no nobypass harness (0059 needed one for its per-tenant GUC loop).
- Fixtures are file-local in identity-account-link.test.ts: copy makePerson :27, makeChannelIdentity :39, makeAccount :64,
  addVerifiedEmail :71, addPendingEmail :83, addLegacyAccountIdentity :94, seedQualified :120, tombstone :134, expectDeny :152; the
  deterministic-wait concurrency pattern (pg_blocking_pids) :574-633. Link-code issue and consume helpers: copy the file-local ones of
  identity-link-code.test.ts.

### 3.5 Q5 migration number, pin sites, B3

- Migration: **0064** (`packages/db/migrations/0064_channel_identity_link_gate.sql`).
- Pin sites re-measured at the base: **11 sites on 14 lines** (note 36), same as reviewer #1; `chat-service.test.ts:415` reads the 0063 file
  by name (a content test for 0063, not a tail pin) and does not change. See section 8.
- B3: non-test LOC about 45-60 (comment block about 35, function about 15, grants 3); 1 module (packages/db); 1 migration => within the
  default caps (about 300 LOC, 3 modules, 1 migration). Not counted: test LOC about 300-400, the 14 pin lines, this docs file.

## 4. Contract

### 4.1 Function (defaults pinned in section 5)

`public.channel_identity_link_gate(p_channel_identity_id uuid) RETURNS TABLE (linked boolean, account_ref uuid)`, LANGUAGE plpgsql,
VOLATILE, SECURITY DEFINER, `SET search_path = pg_catalog, public, pg_temp`, owner = the migration role (no OWNER TO), every relation and
function `public.`-qualified. Body = one SELECT over `public.resolve_deferred_payment_account_core(p_channel_identity_id) c`:
`linked = (c.qualified IS TRUE)`, `account_ref = CASE WHEN c.qualified IS TRUE THEN c.account_ref END`; no core row => (false, NULL).
`person_ref` and `binding_version` are NOT returned. Grants: `REVOKE ALL ON FUNCTION public.channel_identity_link_gate(uuid) FROM PUBLIC,
app_worker, readonly;` `GRANT EXECUTE ON FUNCTION public.channel_identity_link_gate(uuid) TO app;`. The core's ACL (0034:372) is NOT touched.

### 4.2 Result rules

- Exactly two columns, exactly one row. Every deny is the one generic row (false, NULL); a deny is data, never an error.
- `account_ref` is non-NULL only when `linked` is true, and then it is the account the core qualified.
- No email, hash, person id, platform, timestamp, binding or version in any result or error; the SQL emits no RAISE or log line.

### 4.3 Comment block (migration header comment)

States the THREAT MODEL (4.4) and what the function is NOT: a read gate for a message handler, NOT the DD-50 pay-later resolver (the bare
name `resolve_deferred_payment_account` stays reserved for DD-65..68, 0034:31-35); a snapshot at call time; not finalizer-safe; not
endpoint-complete (the endpoint scope comes from the caller's bot-scoped HMAC identity); no money action may rest on it.

### 4.4 THREAT MODEL

Defends against an app-tier caller obtaining an account id for a channel identity that does not qualify (legacy account without a verified
email, unverified, merged without tombstone, ambiguous across the merge chain, inactive or deleted person), and against an enumeration or
oracle through the result shape or an error. It does NOT defend against a compromised app tier, which already holds the account-keyed L9
reads (the 0059 posture).

### 4.5 CALLER CONTRACT (pin in the PR body; L13 implements it)

- Call the function as its own short transaction (autocommit statement) BEFORE and outside any tenant transaction: the core's FOR SHARE
  locks (0034:233-238) survive into the caller's transaction (0034:37-51).
- Treat (false, NULL), an error, a timeout or a missing row as not linked (fail closed).
- Never cache linked = true beyond the request.
- Never log the identity id together with a platform or any user text.

## 5. Pinned defaults (each: default applied, pending owner sign-off)

- M-1 Name and signature `public.channel_identity_link_gate(p_channel_identity_id uuid) RETURNS TABLE (linked boolean, account_ref uuid)`
  (default applied, pending owner sign-off).
- M-2 Attributes: plpgsql, VOLATILE, SECURITY DEFINER, `SET search_path = pg_catalog, public, pg_temp`, owner = migration role, no OWNER TO,
  `#variable_conflict use_column` (default applied, pending owner sign-off).
- M-3 Mapping of 4.1, zero core rows => (false, NULL) (default applied, pending owner sign-off).
- M-4 Grants of 4.1: REVOKE ALL FROM PUBLIC, app_worker, readonly; GRANT EXECUTE TO app only (default applied, pending owner sign-off).
- M-5 Migration file `packages/db/migrations/0064_channel_identity_link_gate.sql` (default applied, pending owner sign-off).
- M-6 Test file `packages/db/src/channel-identity-link-gate.test.ts`, suite DB `plexco_channel_identity_link_gate_check` (pattern
  identity-account-link.test.ts:18), test ids LG-* (default applied, pending owner sign-off).

OPEN_QUESTIONS_IN_SCOPE = 0: every unpinned item above carries a default.

## 6. Implementation order

1. Re-check HEAD = this commit and a clean tree; take the shared DB lock; GitNexus impact is empty (new symbol, no TypeScript caller).
2. Write the 11 pin edits (section 8) and `channel-identity-link-gate.test.ts` (section 7): red (function missing, count 64).
3. Write `0064_channel_identity_link_gate.sql` (4.1, 4.3): green. One migration at a time.
4. S1 VERIFY set; `NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test | tail -40`; reruns only per the flake list.
5. PR body: name, signature, owner, grants, CALLER CONTRACT, what the function is not, the pins (listed separately), 0064, section 5 defaults.

## 7. Acceptance matrix (real DB, app role unless stated; one test per lane decision-table row)

| Lane row | Test | Expected |
|---|---|---|
| core qualifies | LG-1 seedQualified identity | (true, that account id) |
| verified vs legacy | LG-2a account + verified email | (true, its id) |
| verified vs legacy | LG-2b legacy-shaped: account + account_identities row, no account_emails row | (false, NULL) |
| deny cells | LG-3a NULL; 3b unknown id; 3c inactive identity; 3d deleted person; 3e merged person; 3f no account; 3g unverified (pending email only); 3h several accounts across the chain; 3i missing tombstone (core fixtures, section 3.2) | each row deep-equals { linked: false, account_ref: null } |
| account_ref only when linked | LG-4 every LG case | `account_ref === null` iff `linked === false` |
| grants | LG-5a A-13 copy for the wrapper | grantees = sorted [owner, app]; app true, worker false, ro false, explicit_acl true, public_grant false |
| grants | LG-5b app_worker and readonly call the wrapper | 42501 |
| grants | LG-5c core ACL unchanged | core grantees = [owner] only; app has no EXECUTE; app call to the core -> 42501 |
| never raises, never writes, two columns | LG-6a result fields; `pg_get_function_result` | exactly linked, account_ref; `TABLE(linked boolean, account_ref uuid)` |
| never raises, never writes, two columns | LG-6b A-12 copy | prosecdef true, provolatile v, plpgsql, args `p_channel_identity_id uuid`, owner = the core's owner, proconfig `search_path=pg_catalog, public, pg_temp` |
| never raises, never writes, two columns | LG-6c every deny inside BEGIN | resolves (no throw); `pg_current_xact_id_if_assigned()` IS NULL (no write, no row lock) |
| no PII in result, error or log | LG-7 prosrc | no RAISE, no EXECUTE; result keys only linked, account_ref |
| lock footprint | LG-C1 B (app) BEGIN; `link_code_consume` of an account-issued code of account A for another identity (holds accounts A FOR UPDATE, 0043:345); A (app, autocommit, statement_timeout 10 s) calls the wrapper for A's qualified identity; wait proven by pg_blocking_pids (:574-633 pattern); B COMMIT | A returns (true, A); no 40P01 and no error on either side; consume returns its success status |
| lock footprint | LG-C2 qualified call inside an app BEGIN | relation locks of the backend on public relations limited to the core's five relations, modes AccessShareLock or RowShareLock only; owner `SELECT 1 FROM accounts WHERE id = A FOR UPDATE NOWAIT` -> 55P03 until COMMIT, then succeeds |
| migration tail | migrate, rls-invariants, outbox-projector-registry suites | green with 65 and the 0064 name |

## 8. Pin sites (test-only mechanical edits, listed separately in the PR body)

- `packages/db/src/migrate.test.ts:53` `MIGRATION_COUNT = 64; // 0000..0063 (0063 chat message commands)...` -> `65`, comment
  `0000..0064 (0064 channel identity link gate) (0063 chat message commands) ...` (existing style).
- `packages/db/src/migrate.test.ts:769` tail `"0063_chat_message_commands.sql"` -> `"0064_channel_identity_link_gate.sql"`.
- `packages/db/src/rls-invariants.test.ts:70` `toBe(64); // 0000..0063 (...)` -> `65`, comment `0000..0064 (0064 channel identity link gate, ...`.
- `packages/db/src/rls-invariants.test.ts:73` `second.skipped.length).toBe(64)` -> `65`.
- `packages/db/src/rls-invariants.test.ts:1825` `toBe(64); // 0000..0063` -> `65` / `0000..0064`.
- `packages/db/src/rls-invariants.test.ts:1830` `rows.length).toBe(64)` -> `65`.
- `packages/db/src/rls-invariants.test.ts:2108` tail -> `"0064_channel_identity_link_gate.sql"`.
- `packages/db/src/rls-invariants.test.ts:4701` title `UCC-8: MIGRATION_COUNT (64) ... tail is 0063` -> `(65)` / `0064`.
- `packages/db/src/rls-invariants.test.ts:4703` `files.length).toBe(64)` -> `65`.
- `packages/db/src/rls-invariants.test.ts:4704` tail -> `"0064_channel_identity_link_gate.sql"`.
- `packages/db/src/outbox-projector-registry.test.ts` A1 block (one site, four lines): :114 title `A1: 64 migrations apply with tail 0063`
  -> `65` / `0064`; :115 `toBe(64)` -> `65`; :117 tail -> `"0064_channel_identity_link_gate.sql"`; :120 `again.skipped.length).toBe(64)` -> `65`.
- Catalog allowlist: none exists (3.3) => 0 lines.

## 9. Scope

- IN: NEW `packages/db/migrations/0064_channel_identity_link_gate.sql`; NEW `packages/db/src/channel-identity-link-gate.test.ts`; the
  section 8 pin edits; this file.
- OUT: lane NEGATIVE SCOPE verbatim (no table, column, index, trigger, policy, role or other grant; no change to the 0034 core or its ACL,
  zalo_identity_resolve, any L9 definer or any other function; no write path; no TypeScript caller, Zalo command, reply or route; no new
  identity concept; no list, search or by-account direction); schema.ts and db.dbml (no change needed); decisions.md.

## 10. OPEN (non-blocking)

- O-1 The three OPEN items of reviewer #1 are closed (3.3 item 1, 3.4 items 2 and 3); none remains.
- O-2 LG-C1 races the account-issued consume shape; the identity-issued shape takes the same tier order (0043:336-353), so no extra case.
- O-3 This docs-only commit changes no code symbol; GitNexus detect_changes is not applicable (fallback: `git show --stat HEAD` = this file only).

## 11. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = worktree HEAD = session base; every TARGET_FILES path exists at the base | PASS |
| 2 | Decisions in scope final | B-A1 R1 signed 2026-10-19; M-1..M-6 pinned as defaults pending sign-off | PASS |
| 3 | Scope IN/OUT and owner clear | section 9; lane NEGATIVE SCOPE; L13 owns the TypeScript caller | PASS |
| 4 | Dependencies classified | L14 merged at the base (tail 0063); 0034 core, 0043 consume, 0059 pattern present | PASS |
| 5 | Live schema and code match | sections 2-3, measured at the base | PASS |
| 6 | Data, API, state, auth contract | sections 4.1-4.5 | PASS |
| 7 | Fail-closed, idempotency, order | one generic deny row; read only; canonical lock order shared with consume (3.4) | PASS |
| 8 | Open questions in scope = 0 | section 5 pins; section 10 is non-blocking | PASS |
| 9 | Acceptance matrix with expected results | section 7 | PASS |
| 10 | Migration, security, rollback | one additive migration; app-only EXECUTE; pinned search_path; core ACL asserted unchanged; rollback = revert | PASS |
| 11 | First slice hard dependencies merged | L14 merged; 0034, 0043, 0059 on the base | PASS |
| 12 | Implementation handoff ready | sections 4-9; worktree clean at the base | PASS |

## 12. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-19
AUTHORITY_SHA: 819de9cc982bac48c84196612bae2f961f2bbade
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/review-code-readiness-gate.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m9-me-reads.md
  - packages/db/schema.ts
  - packages/db/db.dbml
  - packages/db/migrations/0009_rls_policies_grants.sql
  - packages/db/migrations/0034_identity_account_link_resolver.sql
  - packages/db/migrations/0043_identity_link_code_issue_consume.sql
  - packages/db/migrations/0059_me_player_reads_definers.sql
  - packages/db/migrations/0063_chat_message_commands.sql
  - packages/db/src/identity-account-link.test.ts
  - packages/db/src/identity-link-code.test.ts
  - packages/db/src/me-player-reads.test.ts
  - packages/db/src/chat-catalog.test.ts
  - packages/db/src/chat-service.test.ts
  - packages/db/src/migrate.test.ts
  - packages/db/src/rls-invariants.test.ts
  - packages/db/src/outbox-projector-registry.test.ts
SLICE: p3-m9-channel-identity-link-gate
IN_SCOPE: one app-granted SECURITY DEFINER read gate public.channel_identity_link_gate(uuid) returning exactly (linked, account_ref) by delegating to the 0034 core in one migration 0064, its real-DB test file (decision table, catalog, ACL, lock footprint, consume race) and the 11 migration-tail pin sites
OUT_OF_SCOPE: any table, column, index, trigger, policy, role or other grant; the 0034 core and its ACL; zalo_identity_resolve; L9 definers and every other function; any write path; the TypeScript caller, Zalo commands, replies and routes (L13); any list, search or by-account lookup; schema.ts and db.dbml (no change needed); decisions.md
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: L14 merged 819de9cc982bac48c84196612bae2f961f2bbade (probe 0063_chat_message_commands.sql is the tail); 0034 core and 0043 link_code_consume present; owner decision B-A1 R1 signed 2026-10-19
PRIOR_SLICES: L14 (P3-S11, #83)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # one additive migration (one function, two grant statements); owner = the core's owner; pinned search_path; app-only EXECUTE; core ACL asserted unchanged; opus/max reviewer + opus/max security round
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: section 6 steps 1-2 - the 11 pin edits and packages/db/src/channel-identity-link-gate.test.ts red before writing packages/db/migrations/0064_channel_identity_link_gate.sql
REMAINING_BLOCKERS: none
```
