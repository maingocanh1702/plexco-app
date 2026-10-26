<!-- review-readiness: code-ready -->

# Step-0 readiness: L41 p4-name-definers-and-rule-tests (session P4-S2a)

> Agent-facing. Step-0 readiness reviewers: opus/high, split by area (RA: the SQL bodies and attributes; RB: the pins, the guard and the migration
> mechanics; RC: the residue rows; RE: the CI Unicode measurement and the font comment). This file was written by the step-0 readiness-file writer
> (opus/high). Writers: W1 opus/max, W2 opus/high, W3 opus/high, W4 sonnet/high, W5 sonnet/high. Code reviewer: opus/max, one role in three area
> units (R1a, R1b, R1c), plus a security reviewer opus/max, at most 3 rounds counting pre-push rounds. RISK: P1 (SECURITY DEFINER re-creation,
> identity and PII writers, one migration). Base `2c6951c433a39336252ec573efa00160cc306d91` (main, the merge of PR #116); branch
> `feat/p4-name-definers-and-rule-tests`; worktree `.autopilot/worktrees/p4-name-definers-and-rule-tests`, clean at step 0 (measured: HEAD = base,
> `status --porcelain` empty). Every `path:line` below was MEASURED at the base, on the migration text and on a scratch database migrated at the
> base. The reviewers' notes live outside the repo, so this file restates every fact it relies on. No tracked file was edited at step 0; no DB suite
> ran (the scratch probes ran under the lane's lock).

## 1. Authority

- The owner's written approval of 2026-10-26, verbatim: "Phase 4 plan approved, Q1-Q10 default". It is the owner's own decision, recorded as DD-150
  (`docs/standards/decisions.md:120` and `:1765`, measured). It approves `docs/sessions/web-mvp-phase4-plan.md`, whose section 3 row L41 is this
  lane. Q3 (no new confusables or homoglyph rule; DD-147's emoji item D4 stays as written) and Q4 (c) (no DB CHECK on `persons.display_name` in
  Phase 4) govern its edges.
- The owner's decisions of 2026-10-21, section C, list "the R1-5 invisible-character lane" for the Phase 4 backlog. L41 follows the merged lanes L23,
  L27 and L29 (DD-144, DD-147).
- RO-L41-1, a conductor ruling, decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature; recorded here and in the
  PR body as "default applied, pending owner sign-off" (Tier B, reversible by a forward migration). Item 1: the pg_temp change (section 3). Item 2:
  the set of ten, function calls only, the generator method, the 1,000-line ceiling (sections 2, 9, 12). Item 3: the AG2 start edge (section 6).
  Item 4: the Unicode test (section 7). Item 5: lead corrections (section 2). Item 6: the residue as tests of the current behaviour (section 6).
- RO-L41-2, a conductor ruling with the same label and tier, answers RQ-L41-HELPER-PIN (section 15) with option 1: FILE OWNERSHIP extends by
  exactly two lines of `packages/db/src/public-name-invisible-chars.test.ts`, the PS-ACL `it` title `:224` and the helper pin `:242`, both moving
  from `search_path=pg_catalog` to `search_path=pg_catalog, pg_temp` (files 11 of 14; test lines +2 -2). Its item 2 assigns the mechanical edits
  (this flip, the 14 tail pins, those two lines, the `ci.yml:130` word, the backlog rows) to the orchestrator; workers write new code only.
- Lane contract: lane block L41 of the conductor-authored P4-S2a session brief (not on main): GOAL 1-7, FILE OWNERSHIP, NEGATIVE SCOPE, THREAT
  MODEL, TESTS, B3, STOP.
- Every other choice is labelled "default applied, pending owner sign-off" (section 8) and is repeated in the PR body.

## 2. Measured at base

- Migration tail `0071_zalo_dm_promotion_start_definer.sql` (`git ls-files packages/db/migrations`); next free number 0072;
  `packages/db/src/migrate.ts:105` refuses a file below the applied tail. The base commit is the merge of PR #116, lane L55 (`git log --merges`).
- For each of the ten functions, the live `pg_proc.prosrc` equals the body cut from its newest CREATE in the migration text: 10/10 md5 equal, 10/10
  length equal. No later migration redefines any of them (0071 defines only `zalo_dm_promotion_seconds_to_start`).

| Function | Newest CREATE (body) | Security | search_path | Unqualified built-in calls (lines) | n |
|---|---|---|---|---|---|
| `member_name_apply_rule(text, boolean)` | 0070:43 (51-87) | INVOKER | `pg_catalog` | regexp_replace x3 (0070:76, 78, 78) | 3 |
| `public_name_strip_invisible(text)` | 0068:50 (57-63) | INVOKER | `pg_catalog` | regexp_replace (0068:58) | 1 |
| `person_profile_update(uuid, text)` | 0069:429 (435-483) | DEFINER | `pg_catalog, public, pg_temp` | regexp_replace (0069:467); char_length x2 (468) | 3 |
| `create_host_added_person(uuid, uuid, text)` | 0070:147 (156-192) | DEFINER | `pg_catalog, public, pg_temp` | current_setting (0070:163); char_length x2 (184) | 3 |
| `tenant_provision(text, text, text, text, uuid)` | 0070:197 (203-278) | DEFINER | `public, pg_temp` | current_setting (0070:208); set_config x4 (236, 250, 272, 275); now (268) | 6 |
| `tenant_profile_update(uuid, uuid, text, text, text)` | 0070:283 (295-344) | DEFINER | `pg_catalog, public, pg_temp` | current_setting (0070:303); char_length x3 (320, 320, 328); btrim (328) | 5 |
| `zalo_identity_resolve(uuid, uuid, text, text, bytea, text)` | 0070:361 (371-445) | DEFINER | `pg_catalog, public, pg_temp` | left (0070:379); current_setting (382) | 2 |
| `auth_login_google(text, text, bytea, text, uuid, text, text)` | 0070:449 (461-633) | DEFINER | `public, pg_temp` | length (0070:474); pg_advisory_xact_lock x2 (508, 509); hashtextextended x2 (508, 509); now x6 (566, 568, 577, 591, 591, 606); transaction_timestamp x2 (595, 600) | 13 |
| `create_guest_membership(uuid, uuid)` | 0070:637 (645-706) | DEFINER | `pg_catalog, public, pg_temp` | current_setting (0070:652) | 1 |
| `tenant_public_alias_set(uuid, uuid, text)` | 0068:76 (82-168) | DEFINER | `pg_catalog, public, pg_temp` | current_setting (0068:114); regexp_replace (136); char_length x2 (137, 137); pg_advisory_xact_lock (144); hashtextextended (144); max (162); jsonb_build_object (163) | 8 |

Total: 45 unqualified built-in function calls. Owner of all ten: `plexco` (the migration role; superuser in this path). ACL: the eight definers
`{plexco=X/plexco,app=X/plexco}`, the two helpers `{plexco=X/plexco}` (section 14 has every attribute). Already qualified:
`public.member_name_apply_rule` x7, `public.public_name_strip_invisible` x3, `public.tenant_capability_authorize` x2; `pg_catalog.` inside the
bodies: 0; grammar forms (extract, position, substring, trim, overlay, normalize): 0.

- **The 4 non-exact calls resolve unchanged.** `hashtextextended(text, int4 literal 0)` x3 against pg_catalog's `(text, bigint)` (implicit cast;
  0070:508, 509; 0068:144) and `jsonb_build_object` x1 (VARIADIC "any"; 0068:163). Functions resolve through pg_catalog first in all ten (explicit in
  eight, implicit-first in `tenant_provision` and `auth_login_google`); pg_temp is never searched for functions; `public` takes CREATE only from
  pg_database_owner and plexco; no public function shares a name with any of the 45 (the one public function shadowing a pg_catalog name,
  `gen_random_uuid`, is called by none of the ten). So `pg_catalog.f(...)` binds the same pg_proc OID. The 4 would become exploitable only if another
  role held CREATE on public (0071:33 grants it to job_definer inside one migration, 0071:61 revokes it) or the database owner were not plexco;
  qualification closes that for the ten.
- **Operators and casts stay unqualified**: 147 explicit operators, 11 casts (5 `::uuid`, 6 `::text`) and 13 implicit `=` lookups (NULLIF 5, IN 6,
  IS DISTINCT FROM 2). Reason (also for the migration header): pg_temp is never searched for operators or functions and pg_catalog is first in every
  search_path of the ten; public holds 0 operators; `OPERATOR(pg_catalog.op)` takes the generic operator precedence (`x = 'a' || y` re-associates
  unless parenthesised) and the 13 implicit lookups cannot be qualified without rewriting them. L41-G1(b) pins the invariant (section 4).
- **No result, plan or asserted text changes.** All 45 resolve to pg_catalog today (a call resolving elsewhere, a HALT candidate: none), so each
  qualified call binds the same OID; RAISE texts are literals. The suites assert SQLSTATEs and the writers' own messages
  (`member-name-invisible-chars.test.ts:1061`, `:1190`, `:2063`; owner-check 42501 pins `:583-594`, `:863-878`, `:1752-1764`, `:1793-1827`).
  PL/pgSQL resolves names at the first call, so the before/after matrix executes every re-created function.
- **Hijackability today.** The eight definers: no (unqualified only; pg_catalog first, pg_temp last). The strip helper: no (no type or relation name
  in its body). The rule: functions and operators no; TYPE names yes (section 3).
- **Lead corrections** (also in the PR body): the set includes `tenant_public_alias_set` (0068:76, a DEFINER `app` may EXECUTE) and the strip helper;
  `person_profile_update` inlines the rule's regexps (0069:467-469) and does not call `member_name_apply_rule`; 0070 has no GRANT or REVOKE for its
  six definers (its only ACL line is the rule's REVOKE, 0070:89) and 0072 adds none; the tail pins are 14 lines, not 4 (section 5); RC-BODY pins the
  pre-0069 files plus inline literals, not 0070; AG2 is at `apps/web/lib/session-form-model.test.ts:670`; CI's Node 22.23.3 carries Unicode 17.0 by
  source; TX-ALL and L29-AG1 already compare every code point; the lead's 0070 line pointers and search_path split match the file.

## 3. The pg_temp type-name class (measured)

- The rule's proconfig is `search_path=pg_catalog`: pg_temp is not listed, so the caller's temp schema is searched FIRST for relation and type
  names. Its DECLARE block resolves `text` by name five times (0070:53, 54, 55, 58, 70).
- Probe on the scratch database (non-destructive, under the lock; SQLSTATEs and lengths only): the database ACL is NULL (default: PUBLIC holds TEMP
  and CONNECT), so `app`, `app_worker` and `readonly` all hold TEMP; the baseline rule and helper results have length 3. With a `pg_temp.text` domain
  `CHECK (VALUE IS NULL)` the rule raises 23514 ("value for domain text violates check constraint", schema `pg_temp_<n>`) during "statement block
  local variable initialization"; the helper still returns length 3; a domain with a DEFAULT and no CHECK leaves the rule's result unchanged. A session
  of `app` created `pg_temp.text` (CREATE DOMAIN succeeded).
- Not measured end to end through a definer at step 0 (the definer probe calls gave no usable result; one query was malformed, 0A000): the
  regression test of section 8, proof (a), is that proof. Reasoned, not measured: a domain CHECK that calls a `pg_temp` function would run it inside
  the definer, as the definer's owner.
- The strip helper is not affected today; including it is consistency, not a measured exposure. The eight definers list pg_temp last: not exposed.
  Repo precedent: `packages/db/README.md:531-534` (pg_temp left first was a P1 finding) and `:641-643` (relations).
- Fix (RO-L41-1 item 1): 0072 re-creates the rule and the helper with `SET search_path = pg_catalog, pg_temp`.

## 4. Pins and the writer guard

- `packages/db/src/member-name-invisible-chars.test.ts` RC-BODY (:508-527) is the ONLY byte pin of a body: live prosrc (`toBe(want)`, :525) must
  equal the LAST `CREATE [OR REPLACE] FUNCTION <name>(` in a NAMED pre-0069 file, cut by `previousCreate` (:461-471) between `AS $$` and `$$;`, after
  the substitution literals `subs` then `l29`, each asserted to occur exactly once (:513, :518). Pinned text: table `RECREATED` (:369-455), 7 rows
  (auth_login_google 0017, create_host_added_person 0051, zalo_identity_resolve 0053, person_profile_update 0055, create_guest_membership 0058,
  tenant_provision 0037, tenant_profile_update 0052). The rule and the helper have no byte pin; no hash pin exists. L29-F5 (:972-986) pins the rule's
  constant block byte-equal to `person_profile_update`'s (both from live prosrc) and no RAISE in the rule (:985). The rule's proconfig is pinned at
  :939 (`config: ["search_path=pg_catalog"]`, `git grep`, measured).
- `packages/db/src/member-name-writer-guard.test.ts`: G1 (:199-302, live catalog: a writer is in WRITERS :50-59 and calls the strip or the rule; rule
  pin :255-263; callers `toEqual(VIA_RULE)`, six, :82-89); G2 (:136-159, :416-469, migration text; a CREATE of a WRITERS member in a file above 0069
  is skipped, :153-154); G3 (:470-483); G4 (:547-586); L29-G1 (:303-385, late writers x live prosrc, `toEqual(VIA_RULE)` and `toEqual([])`,
  :346-351).
- What 0072 forces: RC-BODY (prosrc leaves the 0070 chain) and, by RO-L41-1 item 1, the rule's proconfig pin :939 (to
  `search_path=pg_catalog, pg_temp`). Nothing else fails by itself if W1 keeps: the call spellings `public.member_name_apply_rule(<arg>, <mode>)` and
  `public.public_name_strip_invisible(` byte-identical; `p_value` only inside `public.public_name_strip_invisible(p_value)` in the rule; the L29-F5
  block (0070:54-70) byte-identical in the rule and `person_profile_update`; every other attribute restated exactly; `AS $$` and `$$;` on their own
  lines; no bare write and no cleanup block.
- Outside the lane's FILE OWNERSHIP: `packages/db/src/public-name-invisible-chars.test.ts:242` also reads `config: ["search_path=pg_catalog"]`
  (`git grep`, measured; that file names the helper 5 times). If it pins the live helper after the full chain, the helper change of item 1 turns it
  red. Resolved by RO-L41-2 item 1 (section 15): that pin and its `it` title `:224` move to `search_path=pg_catalog, pg_temp`, no other line.
- Re-pin (default D1): RC-BODY gains a 0072 layer after `l29`: cut each re-created body from the 0072 file with `previousCreate`'s logic, assert
  `strip(body0072) === strip(want)` with `strip = (s) => s.split("pg_catalog.").join("")` (the generator equality made a test), then `want = body0072`
  so :525 pins prosrc byte for byte to 0072; the same two assertions for the rule (against 0070:51-87) and the helper (against 0068:57-63).
- New guard L41-G1 in `member-name-writer-guard.test.ts`: (a) a static scan of the ten live bodies (by name) for an unqualified built-in function
  call: lowercase, blank comments (the guard's `clean`), blank `'...'` literals, drop `"`, blank `insert into <ident>(` heads, then
  `matchAll(/(^|[^\w.$])([a-z_][a-z0-9_$]*)\s*\(/g)` with a static `NOT_A_CALL` set (keywords before `(`, grammar forms, type names with a typmod);
  static regex literals only, no RegExp built from data. It is shown to FAIL on planted cases kept inside the test file: the real live body of one
  definer with its first `pg_catalog.` prefix removed (a string replace: exactly one offender) and the fixtures `btrim(p)`, `LEFT (p, 120)`,
  `"btrim"(p)`, `member_name_apply_rule(p, true)`, `x_left(p)` (flagged) against `pg_catalog.btrim(p)`, `public.member_name_apply_rule(p, true)`,
  `-- btrim(p)`, `'btrim(p)'`, `coalesce(a, b)`, `insert into persons(display_name) values (x)` (not flagged). No tracked file receives a violating
  edit. (b) A catalog guard: each of the ten lists `pg_temp` LAST and `pg_catalog` first (explicit, or implicit when absent from the list).

## 5. Migration mechanics

- Name: `0072_member_name_definers_qualify_builtins.sql` (descriptive, no decision number).
- Owner check of 0070's shape: 0070 has `-- L29-OWNER-CHECK-BEGIN` (:100) and `-- L29-OWNER-CHECK-END` (:133) around `DO $l29_owner_check$`
  (:101-132), which reads the owner of `public.public_name_strip_invisible(text)` and raises 42501 for any listed function with another owner; "no
  ALTER OWNER, no SET ROLE" (0070:39). 0072: `-- L41-OWNER-CHECK-BEGIN` / `-- L41-OWNER-CHECK-END` around `DO $l41_owner_check$`, every call
  `pg_catalog.`-qualified, the nine other functions checked against the helper's owner, message
  `'0072: not owned by %, the owner of public.public_name_strip_invisible(text): %'`, 42501, before the first CREATE OR REPLACE. A distinct tag keeps
  the existing l27/l29 block readers independent.
- CREATE OR REPLACE keeps owner and ACL and resets every attribute it does not name: 0072 restates SECURITY, SET, volatility, STRICT, PARALLEL and
  LEAKPROOF for each of the ten (section 14) and adds no GRANT or REVOKE (as 0070, 0070:139-140).
- One transaction per file: `migrate.ts` sha256 (:296), the P17 immutability guard (:323-341), BEGIN (:351), the file, `INSERT INTO schema_migrations`
  (:353), COMMIT (:357), advisory lock (:195). A failing owner check rolls back the whole file.
- Non-superuser owner path: `setupNonSuperuserOwnerContext` (`test-harness.ts:878`) creates `<db>_owner` LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE
  (INHERIT or NOINHERIT, :905) and the database it owns (:910); `runMigration` (:1040) runs every migration as that role, which then owns the ten
  directly; `bootstrapAndMigrateAsOwner` (:1047-1053). Coverage: `migrate.test.ts:745-755` (BR-6, NOINHERIT) and `rls-invariants.test.ts:2120-2123`
  apply the chain as the owner role up to their tail pins (:755, :2123); moving those pins to 0072 covers 0072 the same way.
- Migration-tail pins, 14 lines (mechanical, listed SEPARATELY in the PR body; re-measure with
  `git -C <worktree> grep -n -E "0071_zalo_dm_promotion_start_definer|toBe\(72\)|\(72\)|MIGRATION_COUNT = " -- packages/db/src`):
  - 8 counts (72 to 73): `migrate.test.ts:53` (`MIGRATION_COUNT` and its comment); `outbox-projector-registry.test.ts:115`, `:120`;
    `rls-invariants.test.ts:70` (with its comment), `:73`, `:1841` (with its comment), `:1846`, `:4723`.
  - 4 filenames (to the 0072 file): `migrate.test.ts:755`; `outbox-projector-registry.test.ts:117`; `rls-invariants.test.ts:2123`, `:4724`.
  - 2 titles (72 and 0071 to 73 and 0072): `outbox-projector-registry.test.ts:114`; `rls-invariants.test.ts:4721`.
- `plexco_test` holds the chain to 0071, so 0072 applies on the first locked suite run. A reset is needed only if 0072's bytes change after that
  apply (P17): only then, announced, through the sanctioned reset script run by the lane's locked-run wrapper; never `docker compose down -v`, never
  an edit of `schema_migrations` rows.

## 6. Residue: tests of the current behaviour (no rule change)

RC measured each item of `member-name-rule-residual-precision` (`docs/autopilot-backlog.md:6843`) on the scratch database (counts only). No item is a
security defect, so there is no rule-change ruling request: (a)-(c) render as a missing-glyph box, not blank, so they are visible under the accepted
test V (DD-147; accepted under the owner's delegation of 2026-10-24 (assistant review), DD-149); (d) and (f) are visual-confusion cases of the
confusables family that DD-147 names as not defended and DD-150 Q3 keeps out; (e) is DD-147's ingress rule by design; under (g) no writer can store a
new NULL-mapped name. A rule change is a separate decision (DD-144/DD-147). Each new test and comment says "known residual, pinned as current
behaviour" and names the row.

| Item | Measured (both modes unless said) | Pinned today | Test (`member-name-invisible-chars.test.ts` unless said) |
|---|---|---|---|
| (a) noncharacters | all 66 kept when alone | no | L29-F5 `CASES` rows (describe :895, table ends :1026, `it.each` :1028): U+FDD0, U+FFFF |
| (b) private use | all 137,468 kept when alone | no | L29-F5 row U+E000 |
| (c) unassigned non-DI | U+40000..4FFFD 65,534/65,534 and U+E1000..EFFFD 61,438/61,438 kept | no | L29-F5 row U+40000 (unassigned in every Unicode version so far) |
| (d) lone combining mark | U+0300..036F alone: 111/112 kept (U+034F is stripped) | no | L29-F5 row U+0301 |
| (e) interior separator joined in mode true | 8 separators: mode false refuses, mode true joins; U+0020 and U+00A0 are not joined | yes: :1003, :1010, :1011; L29-W2 :1349, :1353, :1379 | a comment above :1010 only |
| (f) the 120 cut leaves a trailing Zs | 119 x "a" + X + "b" for 7 Zs: length 120, last code point X | no (:1393-1396 pins the cut order only) | `it.each([0x20, 0x3000])` next to :1393 through `zalo()` (:1266) |
| (g) a NULL-mapped tenants.name is kept | decided by the 0070 cleanup (0070:762-771); writers refuse it | yes: L29-C :1550-1553, L29-C4 :1662; refusals :317, :1120 | a comment at :1550 only |
| (h) AG1 start edge | SQL start and end edges identical per scalar (1,112,063 scalars, both modes) | no | AG1 (:1867-1949; POSITIONS :1879-1883, SQL :1904-1905) gains a start position `${c}a` |
| (h) AG2 start edge | `AG2_POSITIONS` :670-674, 4 mirrors :675-680 | no | ONE new `it` beside AG2 in `apps/web/lib/session-form-model.test.ts` (ruling item 3), 30_000 per case; no other line of that file |

C12: AG1's SQL side took 18.6-19.1 s per position locally (about 6x the 3 s ceiling). W3 first reads vitest's per-test durations of the existing
AG1; if a position exceeds about 3 s, every AG1 position is sharded by scalar range (8 ranges of 0x22000 code points, about 2.4 s each: SQL
`generate_series($2, $3)`, the TS loop over the same bounds, the per-shard row count asserted), each test with its own 30_000; never a raised
budget. An AG2 case takes about 0.8 s locally.

## 7. Unicode and the CI font comment

- Local (measured, `process.versions`): Node v25.6.0 = Unicode 17.0, ICU 78.2; the Homebrew Node 20.20.0 reports the same (shared icu4c), so the
  local Unicode follows icu4c, not the Node major.
- CI (measured from the CI run log of the push on main at the base): `actions/setup-node` with `node-version: 22` (`.github/workflows/ci.yml:63`,
  `:123`) resolved Node 22.23.3 in both jobs. Its Unicode 17.0 / ICU 78.3 is by the nodejs source at tag v22.23.3 (`tools/icu/current_ver.dep`,
  `deps/icu-small/source/common/unicode/uchar.h:64`, `uvernum.h:135`); the first L41-UV print in this PR's CI confirms it at runtime.
- The explicit lists name Unicode 17.0 (0068:16, :68; 0069:24; 0070 restates 0069's constants; the Cf source 0055:69); the TS twins
  (`packages/db/src/text-safety.ts:37`, `:41-60`, `:107`; `apps/web/lib/session-form-model.ts:102-165`) mix explicit lists and runtime classes.
  TX-ALL (`packages/db/src/text-safety.test.ts:18-30`, the explicit strip list against the runtime's DI minus Bidi_Control, every scalar) and L29-AG1
  (the SQL lists against the runtime-based TS rule, every scalar but U+0000) passed on Node 22.23.3 at the base: disagreement by proxy, 0 code
  points. No test pins or prints `process.versions.unicode`.
- L41-UV (RO-L41-1 item 4) in `member-name-invisible-chars.test.ts`: prints node, unicode and icu with `console.info`; FAILS only when
  `process.versions.unicode` is older than 17.0 (major and minor compared as numbers, no RegExp); a newer value logs `console.warn` and passes,
  because TX-ALL and L29-AG1 stay the per-code-point fail-closed check. `packages/db/vitest.config.ts` has no `silent`, `onConsoleLog` or
  `reporters`, so the line reaches the CI log. No workflow print step; if the first CI log has no `L41-UV runner` line, that is a ruling request.
- `.github/workflows/ci.yml:130` says next/font downloads "Sora + Inter"; `apps/web/app/layout.tsx:2` imports `Be_Vietnam_Pro, Inter`. Only :130
  changes, to "Be Vietnam Pro + Inter".
- The row `ci-node-unicode-version-vs-name-rule-sets` (`docs/autopilot-backlog.md:6799`) closes BY HAND in the L37/L58 form (no PR number, SHA or
  run id in the repo): L41-UV prints the runtime value in every CI run; the first measured value goes to the merge-log of the PR that lands it.

## 8. Pinned defaults

Each is "default applied, pending owner sign-off", here and in the PR body.

- **D1 re-pin form**: the RC-BODY 0072 layer (section 4). Rejected: re-pinning `RECREATED` to the 0072 file alone (it loses the proof that only
  prefixes changed); a hash pin (opaque on failure).
- **D2 guard scope**: L41-G1 by the ten names. Rejected: every function of files above 0071 (it binds later lanes to a repo-wide rule: a ruling,
  not a default).
- **D3 residue test form**: rows in the existing tables and `it.each` blocks, comments on (e) and (g) (section 6). Rejected: a new test file; a rule
  change.
- **D4 migration name**: `0072_member_name_definers_qualify_builtins.sql`, marker tag L41.
- **D5 pg_temp regression test**: in `member-name-invisible-chars.test.ts`, reusing its writer fixtures; a new test file under `packages/db/src/`
  only if a fresh backend as `app` needs its own harness.
- **D6 L41-C1**: a replay of the 0072 owner-check block (parameterise `l29Block`, :1519-1529, by file and tag), beside L29-C1 (:1733-1777).
- **D7 AG1 sharding** as in section 6, only when measured above about 3 s.
- **RO-L41-1** (decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature): item 1 is the ONLY permitted
  attribute change: the proconfig of the rule and the strip helper becomes `search_path=pg_catalog, pg_temp`; every other attribute is restated
  byte-identical. It amends the lane's STOP line for exactly those two values. Required proofs: (a) a real-DB regression test: in a FRESH backend as
  `app`, plant `pg_temp.text` (a CHECK domain), call the rule and one definer path with a fixture, assert the result equals the unplanted result; RED
  at the base (23514) shown on a scratch copy or on the base, never by editing a tracked file; GREEN after. (b) The before/after attribute table
  (section 14): only the two proconfig values differ. (c) The catalog guard L41-G1(b). (d) ONE read-only catalog query (counts and names only) of
  every other function in the app's schemas whose search_path does not list pg_temp last: W1 records the count and the names in section 14, and W5
  adds ONE out-of-scope backlog row `db-function-search-path-pg-temp-sweep` (absent at the base; nothing of it is changed by this lane).

## 9. Implementation steps

One writer at a time; each commits in the worktree and does not push. GitNexus impact before a symbol edit (a grep of callers when a SQL function
does not resolve) and `detect_changes` before each commit; `b3-measure.sh` after every writer. W1's dependency on section 15 is resolved (RO-L41-2 item 1).

- **W1** (opus/max), the migration: a GENERATOR kept outside the repository copies each body from 0068, 0069 or 0070 byte for byte and inserts
  `pg_catalog.` before exactly the 45 measured call sites from an explicit (function, call token, count) table, asserting 45 and each per-function
  count; never a blind regex; nothing inside string literals or comments. The writer authors only the header (the threat model, the permitted
  attribute change, why operators and casts stay unqualified), the owner-check block and the two `SET search_path` edits. Then, on a scratch
  database: migrate, fill the AFTER column of section 14, run proof (d), and run the before/after matrix (every writer x class cell of the L29
  decision table gives the same result; every re-created function executed).
- **W2** (opus/high): the RC-BODY 0072 layer; the rule's proconfig pin (:939); L41-G1 (a) and (b); L41-C1; the 14 tail pins; the pg_temp regression
  test (proof (a)); the helper's pin at `public-name-invisible-chars.test.ts:242` and its `it` title `:224` (RO-L41-2 item 1). By RO-L41-2
  item 2 the orchestrator applies the mechanical edits itself (the tail pins, those two lines, the `ci.yml:130` word, the backlog rows); workers
  write new code only.
- **W3** (opus/high): section 6 (rows, `it.each`, the AG1 start position and sharding if measured, the two comments, the AG2 start `it`).
- **W4** (sonnet/high): L41-UV and the `ci.yml:130` comment.
- **W5** (sonnet/high), `docs/autopilot-backlog.md` only: close BY HAND (L37/L58 form, no PR number or SHA) `member-name-definers-qualify-builtins`
  (:6872), `member-name-rule-residual-precision` (:6843, with the sentence that a RULE change is a separate decision, DD-144/DD-147) and
  `ci-node-unicode-version-vs-name-rule-sets` (:6799, section 7); ONE dated update line on `docs-drift-sessions-fe-zalo-tech-readme-pins` (:6064) for
  its ci.yml font item, not flipped; at most 3 new out-of-scope rows, `db-function-search-path-pg-temp-sweep` among them.
- **Review**: R1a (the migration against the live catalog and 0068/0069/0070; the generator equality), R1b (pins and guards with the planted
  proofs), R1c (residue, Unicode and AG2 tests, the CI comment) and the security reviewer (opus/max; section 13 as the checklist; section 14 and the
  matrix); at most 3 rounds counting pre-push rounds; reviewers read committed content.

## 10. Acceptance matrix

| Row | Check | Expected |
|---|---|---|
| G1 | 0072 on a fresh database, on `plexco_test` and through the owner role (BR-6; rls-invariants :2120-2123 with the moved pins) | applies; the owner check passes; one transaction |
| G1-EQ | RC-BODY 0072 layer | each 0072 body minus `pg_catalog.` equals its source body byte for byte; prosrc equals the 0072 body; 45 prefixes |
| G1-MX | before/after matrix (W1) | every writer x class cell of the L29 decision table identical; every function executed |
| G2 | L41-G1(a) | green on the ten; red on each planted case, naming the offender |
| G2-PIN | G1-G4, L29-G1, L29-F5, RC-ACL, RC-OWNER, L29-RC, L29-C1 | green, none loosened; only :939 (and :242 if ruled) re-pinned |
| G3 | section 6 tests | green on the current behaviour; every every-scalar test at most about 3 s locally with its own 30_000 |
| G4 | L41-UV | green locally and on CI; the CI log shows the `L41-UV runner` line with node 22 |
| G5 | `git diff` of ci.yml | one changed line (:130) |
| G6 | backlog | three rows closed by hand; one dated line on the drift row; at most 3 new rows |
| PA | proof (a) | red at the base (23514), green after |
| PB | proof (b), section 14 | only the two proconfig values differ |
| PC | proof (c), L41-G1(b) | pg_temp last and pg_catalog first in all ten |
| PD | proof (d) | count and names recorded; the backlog row exists |
| REG | db suite, web vitest, `pnpm -w test` | green; no assertion weakened or deleted; detect_changes shows only the lane's files |

## 11. Verification

- **Before every commit:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm review:check:changed`; `pnpm review:check` in full once;
  `pnpm build` once; the C11/C12 scans (no `new RegExp(` built from data; every every-scalar test at most about 3 s locally, its own 30_000).
- **DB commands** through the lane's locked-run wrapper (in the session notes, outside the repo), sandbox off, NODE_ENV=test:
  `pnpm --filter @plexco/db test` at the final head (0072 on a fresh database and on `plexco_test`); the full web vitest
  (`NODE_ENV=test pnpm --filter @plexco/web test`); `pnpm -w test` once at the final head, one rerun only for an active flake-list entry.
- **CI:** read the L41-UV line and the per-test durations of AG1, AG2 and `session-form-model.test.ts` (64 tests took 94.8 s at the base); keep a 2x
  margin to 30_000.
- **Security round:** required (SECURITY DEFINER, search_path, ACL, owner check, PII writers).
- **A classifier denial** is never retried or rerouted: an AWAIT file with the exact owner commands.

## 12. Budget (B3)

- Ceilings (lane block, raised by RO-L41-1 item 2): non-test (this ONE migration plus ci.yml) at most 1,000 changed lines; tests at most 600; total
  (docs excluded) at most 1,600; files at most 14; exactly 1 migration.
- Estimate: the migration about 820 lines (restated CREATE blocks about 737, header about 40, owner check about 35, comments about 10) plus 1 ci.yml
  line; tests about 200-260 (RC-BODY layer and pins 15-25, L41-G1 45-55, L41-C1 15-25, tail pins 14, pg_temp test 30-40, residue 25-40, L41-UV
  15-20, AG2 1-6).
- Files: 10 expected (the migration, the two name test files, the three tail-pin files, ci.yml, the backlog, this file, `session-form-model.test.ts`),
  plus `public-name-invisible-chars.test.ts` (RO-L41-2 item 1, test lines +2 -2): 11 expected, plus at most one new test file: at most 12 of 14.
- A crossing is a ruling request before the next writer.

## 13. THREAT MODEL

Lane block, verbatim: "defends against (1) function hijack through name resolution in a SECURITY DEFINER body (unqualified built-ins or operators
with a search_path an untrusted schema could precede); (2) a re-creation that silently drops or changes an attribute (owner, SECURITY DEFINER,
search_path, ACL) and so widens who can call a writer or which role it runs as; (3) body drift between the migration, the byte pin and the live
catalog; (4) a changed result for any name a writer already accepted or refused (a regression of the owner decisions DD-144 and DD-147); (5) the
rule list drifting from the runner's Unicode data unnoticed; (6) the non-superuser owner path failing differently from the superuser path. Not
defended (named): homoglyphs and confusables (DD-150 Q3), stored production values nobody here can measure (the guarded cleanup of 0068-0070
stands)."

Added by RO-L41-1 item 1: (7) the pg_temp class: a type name in a SECURITY INVOKER helper resolving through pg_temp because pg_temp is not listed in
its search_path, reachable inside a SECURITY DEFINER writer by any role holding TEMP (section 3).

## 14. Before/after attribute table

BEFORE: the base catalog (scratch database at the base, one `pg_proc` row per function; prosrc as md5 prefix and length in characters). AFTER: to be
filled by W1 from the same catalog query on a scratch database migrated with 0072. Expected: only the proconfig of the first two rows differs (to
`search_path=pg_catalog, pg_temp`); prosrc differs only by the inserted `pg_catalog.` prefixes.

| Function | proconfig | prosecdef | provolatile | proisstrict | proparallel | proleakproof | proowner | proacl | prosrc | AFTER |
|---|---|---|---|---|---|---|---|---|---|---|
| member_name_apply_rule | `search_path=pg_catalog` | false | i | true | s | false | plexco | `{plexco=X/plexco}` | 874d896d, 1721 | to be filled by W1 |
| public_name_strip_invisible | `search_path=pg_catalog` | false | i | true | s | false | plexco | `{plexco=X/plexco}` | 1b5656bb, 289 | to be filled by W1 |
| person_profile_update | `search_path=pg_catalog, public, pg_temp` | true | v | false | u | false | plexco | `{plexco=X/plexco,app=X/plexco}` | c6f72ea2, 2514 | to be filled by W1 |
| create_host_added_person | `search_path=pg_catalog, public, pg_temp` | true | v | false | u | false | plexco | `{plexco=X/plexco,app=X/plexco}` | 422e1e03, 1209 | to be filled by W1 |
| tenant_provision | `search_path=public, pg_temp` | true | v | false | u | false | plexco | `{plexco=X/plexco,app=X/plexco}` | 26823dda, 3245 | to be filled by W1 |
| tenant_profile_update | `search_path=pg_catalog, public, pg_temp` | true | v | false | u | false | plexco | `{plexco=X/plexco,app=X/plexco}` | a6f427bb, 1899 | to be filled by W1 |
| zalo_identity_resolve | `search_path=pg_catalog, public, pg_temp` | true | v | false | u | false | plexco | `{plexco=X/plexco,app=X/plexco}` | d63dc1a2, 3219 | to be filled by W1 |
| auth_login_google | `search_path=public, pg_temp` | true | v | false | u | false | plexco | `{plexco=X/plexco,app=X/plexco}` | d348c9b6, 8762 | to be filled by W1 |
| create_guest_membership | `search_path=pg_catalog, public, pg_temp` | true | v | false | u | false | plexco | `{plexco=X/plexco,app=X/plexco}` | 0b898660, 2043 | to be filled by W1 |
| tenant_public_alias_set | `search_path=pg_catalog, public, pg_temp` | true | v | false | u | false | plexco | `{plexco=X/plexco,app=X/plexco}` | 92f9d6cd, 3997 | to be filled by W1 |

Proof (d), other functions without pg_temp last: to be filled by W1 (count and names).

## 15. OPEN

In scope: none open. The one blocker of step 0 is resolved:

- **RQ-L41-HELPER-PIN.** `packages/db/src/public-name-invisible-chars.test.ts:242` reads `config: ["search_path=pg_catalog"]` (`git grep`,
  measured), in a file outside the lane block's FILE OWNERSHIP ("No other file"). RO-L41-1 item 1 changes the strip helper's proconfig to
  `search_path=pg_catalog, pg_temp`, so the lane cannot go green without that line if it pins the live helper (not read further at step 0).
  - Option 1 (recommended): the conductor extends FILE OWNERSHIP by exactly that pin line, re-pinned to `search_path=pg_catalog, pg_temp` (a
    mechanical consequence of item 1, like item 3's one-`it` extension; files 11-12 of 14). It keeps one rule for the whole family.
  - Option 2: amend item 1 so the helper keeps `search_path=pg_catalog` (measured unaffected: no type or relation name in its body); it is still
    re-created for its one qualification; L41-G1(b) then allows `pg_catalog` alone for exactly the helper, with that reason.
  - Owner of the decision: the conductor (under the owner's delegation of 2026-10-22). Binary resolution: the ruling names option 1 or option 2.
  - **Resolved by RO-L41-2 item 1: option 1** (decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature; Tier B,
    reversible). Ownership extends by exactly two lines, the PS-ACL `it` title `:224` and the pin `:242`, both re-pinned to
    `search_path=pg_catalog, pg_temp`; no other line of that file (files 11 of 14; test lines +2 -2). Same deliberate re-pin as the rule's pin
    `member-name-invisible-chars.test.ts:939`; option 2 would leave two rules in one family and a second guard shape.

Out of scope:

- **O1** `db-function-search-path-pg-temp-sweep` (proof (d)): a W5 row.
- **O2** C12 margin: `session-form-model.test.ts` took 94.8 s on CI for 64 tests at the base; the verifier reads its per-test durations.

## 16. Closure matrix (12 of 12 PASS)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the worktree HEAD at step 0, the merge of PR #116 (measured); every TARGET_FILES path exists (`git ls-files`, `git grep`, measured) | PASS |
| 2 | Decisions in scope final | DD-150 (Q3, Q4 c); RO-L41-1 items 1-6; RO-L41-2 items 1-5; D1-D7 pinned as defaults pending owner sign-off (section 8) | PASS |
| 3 | Scope IN/OUT and owner clear | FILE OWNERSHIP plus RO-L41-1 item 3 (one AG2 `it`) and RO-L41-2 item 1 (`public-name-invisible-chars.test.ts` `:224` and `:242` only) | PASS |
| 4 | Dependencies classified | L55 merged (the base is its merge); L39 and L51 share only the backlog; L42 waits for this lane's migration number and guards | PASS |
| 5 | Live schema and code match | sections 2-7; 10/10 live bodies equal the migration text | PASS |
| 6 | Data, API, state, auth contract | no change of what a writer accepts, refuses or stores; the only attribute change is the two ruled proconfig values; no table, column, role or grant | PASS |
| 7 | Fail-closed, idempotency, order | owner check 42501 before the first CREATE OR REPLACE; one transaction per file; the P17 guard; L41-UV fails on an older runtime | PASS |
| 8 | Open questions in scope = 0 | 0 open: RQ-L41-HELPER-PIN resolved by RO-L41-2 item 1 (section 15) | PASS |
| 9 | Acceptance matrix with expected results | section 10 | PASS |
| 10 | Migration, security, rollback | exactly one append-only migration; security round planned; rollback = a forward migration restating the 0068-0070 bodies and attributes | PASS |
| 11 | First slice hard dependencies merged | L55 merged; the base holds 0068-0071 | PASS |
| 12 | Implementation handoff ready | sections 8-12; the worktree at the base with this file as its first commit; W1's helper `SET` line is `pg_catalog, pg_temp` (RO-L41-2 item 1) | PASS |

## 17. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-26
AUTHORITY_SHA: 2c6951c433a39336252ec573efa00160cc306d91
BASE_BRANCH: main
TARGET_FILES:
  - packages/db/src/member-name-invisible-chars.test.ts (edited)
  - packages/db/src/member-name-writer-guard.test.ts (edited)
  - packages/db/src/migrate.test.ts (edited: tail pins :53, :755 only)
  - packages/db/src/rls-invariants.test.ts (edited: tail pins only)
  - packages/db/src/outbox-projector-registry.test.ts (edited: tail pins only)
  - .github/workflows/ci.yml (edited: :130 only)
  - docs/autopilot-backlog.md (edited)
  - apps/web/lib/session-form-model.test.ts (edited: one new it beside AG2, RO-L41-1 item 3)
  - packages/db/src/public-name-invisible-chars.test.ts (edited: the PS-ACL it title :224 and the helper pin :242 only, RO-L41-2 item 1)
  - packages/db/migrations/0068_public_name_invisible_chars.sql (read only: the helper :50, tenant_public_alias_set :76)
  - packages/db/migrations/0069_member_name_invisible_chars.sql (read only: person_profile_update :429)
  - packages/db/migrations/0070_member_name_control_chars.sql (read only: the rule :43, the six definers, the owner check :100-133)
  - packages/db/migrations/0071_zalo_dm_promotion_start_definer.sql (read only: the tail; CREATE on public :33, :61)
  - packages/db/src/migrate.ts (read only: :105, :195, :296, :323-341, :351-357)
  - packages/db/src/test-harness.ts (read only: :878, :905, :910, :1040, :1047-1053)
  - packages/db/src/text-safety.ts (read only: :37, :41-60, :107)
  - packages/db/src/text-safety.test.ts (read only: TX-ALL :18-30)
  - packages/db/vitest.config.ts (read only: no silent, onConsoleLog or reporters)
  - packages/db/README.md (read only: the pg_temp precedent :531-534)
  - apps/web/app/layout.tsx (read only: :2)
  - apps/web/lib/session-form-model.ts (read only: the TS twin :102-165)
  - docs/sessions/web-mvp-phase4-plan.md (read only: section 3 row L41, the authority)
  - docs/standards/decisions.md (read only: DD-150 :120, :1765; DD-144, DD-147, DD-149)
SLICE: p4-name-definers-and-rule-tests
IN_SCOPE: packages/db/migrations/0072_member_name_definers_qualify_builtins.sql re-creating the ten functions with the 45 measured built-in calls qualified with pg_catalog., every attribute restated as live except the two ruled proconfig values, the L41 owner check, no GRANT or REVOKE; the RC-BODY 0072 layer and the rule's proconfig pin; L41-G1 (static scan with planted cases, catalog search_path guard); L41-C1; the pg_temp regression test; the 14 migration-tail pin lines; the residue tests and comments of section 6 including one AG2 start-edge it; L41-UV; the ci.yml:130 font comment; the helper pin public-name-invisible-chars.test.ts :224 and :242 (RO-L41-2 item 1); the backlog rows; this readiness file
OUT_OF_SCOPE: any change of what a writer accepts, refuses or stores (strip set, emoji, length, refused set, visible test); any other attribute change (owner, security, ACL, volatility, strictness, parallel, leakproof); a new table, column, role or grant; operator or cast qualification; TypeScript or web writer changes; homoglyph or confusables work (DD-150 Q3); a CHECK constraint (DD-150 Q4 c); a workflow change beyond ci.yml:130; edits of migrations 0068-0071; the search_path of functions outside the ten (row db-function-search-path-pg-temp-sweep); text-safety.test.ts; enabling anything; PR #50
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS # RQ-L41-HELPER-PIN resolved by RO-L41-2 item 1: ownership extends by public-name-invisible-chars.test.ts :224 and :242
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: p4-db-test-hygiene (L55) merged: the base commit is the merge of PR #116
PRIOR_SLICES: L23, L27, L29 (merged: migrations 0068-0070 at the base); L55 (merged)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # one append-only migration 0072; security round planned (opus/max); rollback = a forward migration
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 - generate 0072 from 0068/0069/0070 with the 45 measured pg_catalog. prefixes, the L41 owner check and the two search_path edits, then fill section 14 on a scratch database; commit in the worktree
REMAINING_BLOCKERS: none
```
