<!-- review-readiness: code-ready -->

# Step-0 readiness: L42 p4-name-rules-db (session P4-S3a)

> Agent-facing. Step-0 readiness reviewers: opus/high, split by area (RA: Q1 the writers of every name field and their caps, Q2 the Google
> path; RB: Q3 the migration mechanics; RC: Q4 the TypeScript side of the cap, Q5 `tenantRepo.sessions.create`), plus the orchestrator's own
> measurements (the scratch-database length probe and the grep closures of the readers' open items). This file was written by the step-0
> readiness-file writer (opus/high). Writers: W1 opus/max (the migration), W4 opus/high (TypeScript), W3 opus/high (tests); the mechanical pin
> lines and the backlog rows by the orchestrator. Code reviewer: opus/max, one role in two area units (R1a, R1b), plus a security reviewer
> opus/max, at most 3 rounds counting pre-push rounds. RISK: P1 (SECURITY DEFINER re-creation of an identity and PII writer, one migration;
> security round). Base `39c503d7b9fc353380a23752edd3c574ab08fb41` (main, the merge of PR #119 = lane L41; migration tail 0072); branch
> `feat/p4-name-rules-db`; worktree `.autopilot/worktrees/p4-name-rules-db`, clean at step 0 (measured: HEAD = base, `status --porcelain`
> empty). Every `path:line` below was MEASURED at the base, on the source text and on a scratch database migrated at the base. The readers'
> notes live outside the repo, so this file restates every fact it relies on. No tracked file was edited at step 0; no DB suite ran (the
> scratch probe ran under the lane's lock, inside BEGIN ... ROLLBACK).

Short forms below: `0072` = `packages/db/migrations/0072_member_name_definers_qualify_builtins.sql`; a bare `name.ts:line` is under
`packages/db/src/`.

## 1. Authority

- **DD-150** (`docs/standards/decisions.md:120` summary row, `:1765` section, `:1790` consequences): the owner's written approval of
  2026-10-26, verbatim `Phase 4 plan approved, Q1-Q10 default`; Q1-Q10 take the defaults of the plan's section 5
  (`docs/sessions/web-mvp-phase4-plan.md`, row Q4 at `:111`).
- **Q4** as applied: (a) one existing fallback string for NULL names, no new string (lane L43's web side); (b) a maximum display-name length
  of **120**, "the largest level in use ... so that no stored name becomes wrong", with the user-visible effect, the owner's own answer: **the
  host can enter names of 101-120 characters at the roster**; (c) **no DB CHECK** on `persons.display_name` in Phase 4.
- **Q3**: no new confusables rule; no confusables work here (lane L57 does not run, DD-150 `:1790`).
- **The plan row** `docs/sessions/web-mvp-phase4-plan.md:58` (section 3, row L42): backlog rows `name-fields-one-visible-check-one-length-rule`
  (the DB half) and `tenant-repo-sessions-create-area-venue-strip`; outcome "one length constant and one shared visible-character function;
  session creation through tenantRepo applies L23's strip to area and venue"; acceptance "grep finds exactly one definition; a hidden-only
  name is refused at every writer; area and venue with hidden characters are stripped as on the session-service path"; risk P2 (P1 with a
  CHECK); dependency L41; migration column `không (Q4 c)` (none).
- **RO-L42-1** (decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature): lead (1) is confirmed (section
  2): Q4(b)'s effect cannot be delivered by TypeScript alone, so the lane carries ONE migration. DD-150 Q4(b) names the effect, so by the
  demotion rule (a change a decision record authorizes by name is Tier A) no owner step is needed before W1. The risk is P1 (a SECURITY
  DEFINER re-creation), not the plan row's P2.
- **The plan-level gap**, recorded as the conductor's D35 and carried in the owner summary: the plan row's migration column says none
  (`:58`), and DD-150 says Phase 4 has migrations 0072 (L41) and 0073 (L46) only (`:1790`, also `:120`; the plan's dependency line `:92`
  gives L46 `[0073, after 0072 merges]`). L42 takes 0073, the next free number at the base; L46 takes the number after it.
- Provenance: every choice of this file is "default applied, pending owner sign-off" (section 8) or the conductor's ruling above; nothing
  here is an owner signature.

## 2. Measured at base

### 2.1 Writers of a name field (Q1)

Guard index: WRITERS = 8 functions (`member-name-writer-guard.test.ts:50-59`), VIA_RULE = 6 that call `member_name_apply_rule` (`:82-89`);
guarded columns `persons.display_name`, `memberships.display_name`, `tenants.name`, `sessions.venue_address` (`:19-24`). Every SQL definition
below is newest in 0072.

| # | TS writer | SQL function | TS cap, unit | SQL cap, message (SQLSTATE) |
|---|---|---|---|---|
| 1 | roster `resolveMembership` `roster-service.ts:82` (SQL call `:124`) | `create_host_added_person` 0072:205 | `isBoundedText(name, 1, DISPLAY_NAME_MAX)` `:117` with **100** (`roster-money-shared.ts:58`, imported `roster-service.ts:7`); code points, counted after `stripInvisibleChars` (`:113`) and BEFORE the trim; message `` displayName must be 1..${DISPLAY_NAME_MAX} characters `` (`:119`) | `pg_catalog.char_length(v_name) > 100` 0072:242; `create_host_added_person: display name must be 1..100 characters` 0072:243 (22023); counted after the rule's strip and trim (0072:241) |
| 2 | profile `validateDisplayName` `me-settings.ts:35` (SQL call `:171`) | `person_profile_update` 0072:148 | `[...name].length` (`:38`) on `stripInvisibleChars(raw).trim()` (`:37`), local `DISPLAY_NAME_MAX = 120` (`:20`); message `display name must be 1-120 printable characters` (`:24`, a second hand-written 120) | `> 120` 0072:187-188; `person_profile_update: display name must be 1-120 printable characters` 0072:189 |
| 3 | club name `validatePatch` `club-config-validation.ts:59` | `tenant_profile_update` 0072:337 | `name.length > 120` (`:68`): UTF-16 units, a literal | `> 120` 0072:374; `tenant_profile_update: name must be 1..120 chars` 0072:375 |
| 4 | sign-up `provisionTenant` `auth.ts:198` | `tenant_provision` 0072:253 | none in `auth.ts` (`:207` checkTypedName only); the web route `apps/web/app/api/onboarding/start/route.ts:78-79`, `MAX_TENANT_NAME_CHARS = 120` (`:20`), UTF-16 | no length in the body (0072:269-277); the table CHECK `tenants_name_len_chk` bounds it (section 2.2) |
| 5 | alias `validatePublicAlias` `public-alias.ts:46` | `tenant_public_alias_set` 0072:747 | `[...alias].length` (`:51`) against `PUBLIC_ALIAS_MAX` (value not read at step 0) | `> 60` 0072:808-809; `tenant_public_alias_set: alias must be 1-60 printable characters` 0072:810 |
| 6 | Zalo `resolveZaloIdentity` `zalo-ingress.ts:173` | `zalo_identity_resolve` 0072:401 | `normalizeExternalName` (`:185`): no cap, never raises | `pg_catalog.left(public.member_name_apply_rule(p_display_name, true), 120)` 0072:419: truncates, never raises |
| 7 | Google `loginGoogle` `apps/web/lib/oauth-transaction.ts:283` (SQL `:297`, name argument `:304`) | `auth_login_google` 0072:488 | none | **none** (0072:601; section 3) |
| 8 | guest copy `mintGuestMembership` `session-join-service.ts:319` | `create_guest_membership` 0072:675 | no typed name | copies `public.member_name_apply_rule(p.display_name, true)` (0072:702) into `memberships.display_name` (0072:722): inherits the person row's length |
| 9 | detach `detachMyChannel` `me-settings.ts:228` | `channel_identity_detach` | - | writes a NULL name only (guard NULL_INSERT, `member-name-writer-guard.test.ts:64-65`) |

Web callers: row 1 `apps/web/app/api/sessions/[id]/players/route.ts:41`; row 2 `apps/web/app/api/me/profile/route.ts:82`; rows 3 and 5
`apps/web/app/api/onboarding/club/route.ts:103` and `:93`; row 4 `apps/web/app/api/onboarding/start/route.ts:89`; row 6
`apps/web/lib/zalo/process-event.ts:129`; row 7 section 3.

### 2.2 Scratch-database length probe

Run by the orchestrator through the lane's locked wrapper on a scratch database migrated at the base, inside BEGIN ... ROLLBACK (exit 0);
the names are `repeat('x', n)`; counts and error texts only.

| writer | 100 | 101 | 120 | 121 |
|---|---|---|---|---|
| `create_host_added_person` | stored 100 | 22023 `create_host_added_person: display name must be 1..100 characters` | same 22023 | same 22023 |
| `person_profile_update` | stored 100 | stored 101 | stored 120 | 22023 `person_profile_update: display name must be 1-120 printable characters` |
| `tenant_profile_update` | stored 100 | stored 101 | stored 120 | 22023 `tenant_profile_update: name must be 1..120 chars` |
| `tenant_provision` | stored 100 | stored 101 | stored 120 | 23514 `new row for relation "tenants" violates check constraint "tenants_name_len_chk"` (the 0039 table CHECK, not the body) |
| `tenant_public_alias_set` | 22023 `...alias must be 1-60 printable characters` | same | same | same |
| `auth_login_google` (external name) | stored 100 | stored 101 | stored 120 | stored 121; a 200-character name is stored as 200: no cap today |
| `auth_login_google`, hidden-only (3 x U+200B) | stored NULL, no raise | | | |
| `member_name_apply_rule(3 x U+200B, true / false)` | NULL / NULL | | | |
| `zalo_identity_resolve` | NOT MEASURED: the fixture was refused (23502, `zalo_bots.bot_token_enc` NOT NULL); its cap is read from the body (0072:419) and pinned by the existing Zalo truncation tests (`member-name-invisible-chars.test.ts:1521-1527`) | | | |

Result: lead (1) holds (the roster SQL refuses 101-120 today, so a roster TS cap of 120 alone would pass names the definer refuses); lead (2)
holds at the SQL level (section 3).

### 2.3 Lead corrections (measured)

- Lead (2) quotes the Zalo precedent as `left(...)`; 0072:419 reads `pg_catalog.left(...)`. 0073 must use the qualified form, or L41-G1(a)
  fails (`member-name-writer-guard.test.ts:742-744`).
- Lead (2) "the Google path stores the external display name unbounded": true for the SQL function; production passes `displayName: null`
  (section 3).
- Lead (3) "the DB package counts code points": not `club-config-validation.ts:68` (UTF-16, a literal 120). That file is outside this lane's
  ownership; its residue belongs to the second backlog row (section 7).
- Lead (3) misses a second hand-written 120: `me-settings.ts:24` (the `DisplayNameError` text), which the acceptance grep does not see.
- Lead (4): the body of `create` is `tenant.ts:123-143`; its input type `tenant.ts:81-94` has no venueAddress, so only area and venueName are
  mirrored.
- Lead (5) names only the RC-BODY layer; a second break is the SQL message pin `member-name-invisible-chars.test.ts:1207`. The tail-pin grep
  also hits `member-name-invisible-chars.test.ts:489` and `:1923`, which load 0072's blocks by name and stay.
- The plan row cites the strip row at `docs/autopilot-backlog.md:6707`; at the base the row is `:6711-6721`.
- The UCC-8 tail pins are `rls-invariants.test.ts:4741`, `:4743`, `:4744` (measured by `git grep` at the base while writing this file; an
  earlier step-0 count had `:4721`, `:4723`, `:4724`).
- DD-150 `:1790` assigns 0073 to L46; L42 takes 0073 (section 1, D35).

## 3. The Google path

- Signature (0072:488-499): `auth_login_google(p_subject_hash text, p_email_lookup_hash text, p_email_enc bytea, p_kms_key_version text,
p_account_email_id uuid, p_display_name text, p_request_ref text) RETURNS TABLE (account_id uuid, person_id uuid, outcome text)`, `SECURITY
DEFINER`, `SET search_path = public, pg_temp`.
- The name is written once, only on the new-person branch (no Google identity for the subject and no `account_emails` row for the email),
  0072:601: `INSERT INTO persons(display_name) VALUES (public.member_name_apply_rule(p_display_name, true))`. The login_success and
  identity_conflict branches never touch the name (0072:572-650); the only RAISE is the subject-hash check (0072:513-514). There is no
  `left(`, no `char_length` and no RAISE on the name.
- The rule `public.member_name_apply_rule(p_value text, p_external boolean)` (0072:101) is `IMMUTABLE STRICT` (0072:104-105); external mode
  strips, trims, deletes the c_reject characters, trims again and returns NULL when no visible character remains (0072:134-143); a NULL
  argument returns NULL.
- Measured (section 2.2): 121 and 200 code points are stored whole; a hidden-only name is stored NULL without a raise.
- Reachability: the production callback passes `displayName: null, // DD-26: no silent name persist from a provider claim`
  (`apps/web/app/api/auth/google/callback/route.ts:196`, the call at `:190`), so production stores NULL today. The uncapped write is
  reachable through the dev persona login (`apps/web/lib/dev-login/persona-account.ts:58`, `displayName: persona.displayName` at `:64`), a
  future caller, or a direct EXECUTE by `app` (the ACL, section 14). `create_guest_membership` then copies the person name uncapped into
  `memberships.display_name` (0072:702, :722).
- The Zalo precedent, verbatim (0072:419): `  v_name text := pg_catalog.left(public.member_name_apply_rule(p_display_name, true), 120);`
- After 0073 (D1), line 601 reads
  `      INSERT INTO persons(display_name) VALUES (pg_catalog.left(public.member_name_apply_rule(p_display_name, true), 120))`. `left` never
  raises and `left(NULL, 120)` is NULL, so a hidden-only name still stores NULL and sign-in never fails on a name (threat 4). The change is
  truncation only: it does not change sign-in behaviour beyond truncation (the lane's STOP line).

## 4. Migration mechanics

- File: `packages/db/migrations/0073_member_name_length_cap_120.sql` (new; the next free number 0073, measured: the directory ends at
  `0072_member_name_definers_qualify_builtins.sql`; a descriptive name with no decision number; append-only). If another lane's migration
  merges first, the lane takes the next free number and says so.
- Blocks restated from 0072, both newest there:
  - `create_host_added_person` 0072:205-250: CREATE `:205`, parameters `(uuid, uuid, text)` `:206-209`, `RETURNS uuid` `:210`,
    `LANGUAGE plpgsql` `:211`, `SECURITY DEFINER` `:212`, `SET search_path = pg_catalog, public, pg_temp` `:213`, `AS $$` `:214`, body
    `:215-249`, `$$;` `:250`.
  - `auth_login_google` 0072:488-672: CREATE `:488`, seven parameters `:489-495`, `RETURNS TABLE` `:496`, `LANGUAGE plpgsql` `:497`,
    `SECURITY DEFINER` `:498`, `SET search_path = public, pg_temp` `:499`, `AS $$` `:500`, body `:501-671`, `$$;` `:672`.
  - Older CREATEs, for reference only: `create_host_added_person` 0051:18, 0069:292, 0070:147; `auth_login_google` 0017:292, 0069:104,
    0070:449.
- The three literal edits, nothing else:

| # | 0072 line | old text | new text |
|---|---|---|---|
| E1 | 242 | `pg_catalog.char_length(v_name) > 100` | `pg_catalog.char_length(v_name) > 120` |
| E2 | 243 | `1..100 characters` | `1..120 characters` |
| E3 | 601 | `VALUES (public.member_name_apply_rule(p_display_name, true))` | `VALUES (pg_catalog.left(public.member_name_apply_rule(p_display_name, true), 120))` |

- No other `100` is in the roster block (`100` over 0072:203-251 hits only :242-243); the `< 1` and the `1..` stay. The only other
  `display_name` in the Google block is the parameter (0072:494).
- Owner check, in the shape of 0072:45-82: a comment; `-- L42-OWNER-CHECK-BEGIN`; `DO $l42_owner_check$`; `SELECT p.proowner INTO STRICT
v_helper_owner` of `'public.public_name_strip_invisible(text)'::pg_catalog.regprocedure`; a `pg_catalog.string_agg(pg_catalog.format('%s
(owner %s)', ...))` over `pg_catalog.unnest(ARRAY[...]::pg_catalog.regprocedure[])` with exactly the two signatures
  `'public.create_host_added_person(uuid, uuid, text)'` and `'public.auth_login_google(text, text, bytea, text, uuid, text, text)'`;
  `WHERE p.proowner <> v_helper_owner`; `RAISE EXCEPTION '0073: not owned by %, the owner of public.public_name_strip_invisible(text): %'`
  with `USING ERRCODE = '42501'`; `$l42_owner_check$;`; `-- L42-OWNER-CHECK-END`. It only reads the catalog and runs before the first
  CREATE OR REPLACE.
- Header, in the shape of 0072:1-43: `-- ====`; the file name; lane, authority (DD-150 Q4(b), RO-L42-1) and spec pointer; `-- WHAT:`;
  `-- WHY (THREAT MODEL):` (section 13); `-- NOT CHANGED:` (every attribute, the owner and the ACL; no privilege, owner, comment, table, role
  or column change; the rule, the strip helper and every other definer untouched); `-- ROLLBACK:` (one line: a forward migration restating
  the two 0072 blocks); `-- ====`. Each block is preceded by `-- n/2 <name>, newest definition 0072:<start>-<end>: <k> literal edit(s).`
- Generator (the L41 method): a copy of L41's 0072 generator, kept outside the repo (L41's own copy is never edited). Input: the 0072 file
  only, with two FUNCTIONS rows and their edits. It checks: each edit's old text occurs exactly once on its line and once in its block; line 1
  of each block starts `CREATE OR REPLACE FUNCTION `; no `SET search_path` line changes; the CR guard; authored text ASCII-only and
  non-ASCII only where inherited; each marker exactly once; no `GRANT`, `REVOKE`, `ALTER`, `DROP` or `COMMENT ON`; the file ends with
  `$$;` and one newline (RC-BODY's `cutCreate`, `member-name-invisible-chars.test.ts:461-466`, needs a newline before and after `$$;`).
  **Equality rule:** each new block with its named edits reverted (new text back to old, on its line) equals its 0072 block byte for byte;
  the line count is the same; the lines that differ are exactly the edit lines; the `pg_catalog.` delta is 0 for the roster block and 1 for
  the Google block.
- Attributes are kept byte-identical (section 14). No GRANT, REVOKE or OWNER: CREATE OR REPLACE keeps the owner and the ACL; the only ACL
  lines of the two functions are `0017_oauth_transactions.sql:477-478` and `0051_host_add_person_definer.sql:64-65`, and no migration sets
  either owner (no `OWNER TO`, `DEFAULT PRIVILEGES` or `ALL FUNCTIONS IN SCHEMA` touches them); 0072:35-40 is the precedent.
- The migrator applies the file in one transaction, as for 0072 (not re-measured at step 0).

## 5. Tests and pins

`member-name-invisible-chars.test.ts`:

- **Breaks by design: RC-BODY `:563-586`.** For each RECREATED row (from `:369`; `auth_login_google` `:370-380` with file 0017,
  `create_host_added_person` `:382-390` with file 0051) it builds `want` (subs, then l29, then `layer0072`), sets `want = body0072(name)`
  (`:579-581`) and pins the live `prosrc` to it (`:582-585`). After 0073 both rows fail until the new layer exists.
- **New layer, after `:581`:** `if (EDITS_0073[name]) { const next0073 = body0073(name); expect(layer0073(want, next0073,
EDITS_0073[name])).toBeNull(); want = next0073; }`. `layer0073` returns null only when each old text occurs once in the previous body and
  the previous body with the replacements equals the next body exactly. `const M0073` and `CREATES_0073` go next to `:489-491`; `body0073`
  is a copy of `body0072` (`:494-499`).
- **RC-BODY-0073** describe, modelled on RC-BODY-0072 (`:588-612`): M0073 holds exactly two `CREATE OR REPLACE FUNCTION ` statements, each at
  a line start; their names equal the keys of `EDITS_0073`; planted cases (an edit missing; one extra character) are red.
- **Message pin `:1207`** (L29-W1): `create_host_added_person: display name must be 1..100 characters` becomes `1..120`; it is the only pin of
  that SQL message in the repo.
- **Stay on 0072:** `:489` (`M0072`) and `:1923` (L41-C1) load 0072's blocks by name.
- **L42-C1**: an owner-mismatch test of 0073's DO block (cut between the L42 markers and replayed under a planted owner mismatch; expects
  SQLSTATE 42501 and the `0073:` prefix), modelled on L41-C1 (`:1920-1968`).
- **The Google length tests**, modelled on the Zalo 120 truncation tests (`:1521-1527`): a 200-character external name is stored as 120 code
  points without a raise; a hidden-only external name is stored NULL without a raise.

Lines that move, one literal each, by the orchestrator's apply script:

- `roster-service.test.ts:391` `{ displayName: "x".repeat(101) },` in the `bad` list becomes `repeat(121)` (red either way once the TS cap is
  120).
- `rls-invariants.test.ts:4950` `await expect(call(ctx.tenantA, admin, "x".repeat(101))).rejects.toThrow(/display name/);` (the 0051 definer
  describe at `:4905`) becomes `repeat(121)`.
- The 14 migration-tail pin lines, the same lines L41 moved in `ff921c472de8e096f922cdc4d8632d3c3b7b6f53`
  (`test(db): move the fourteen migration-tail pins to 0072 [L41]`), each 73 -> 74 and 0072 -> 0073 (the comment tails gain 0073):
  - `migrate.test.ts:53` (`const MIGRATION_COUNT = 73; // 0000..0072 (0072 ...`) and `:756` (the tail name; the statement `:755-757`);
  - `outbox-projector-registry.test.ts:114` (the A1 title `73 migrations apply with tail 0072`), `:115` (`applied.length).toBe(73)`), `:117`
    (`applied.at(-1)` tail), `:120` (`skipped.length).toBe(73)`);
  - `rls-invariants.test.ts:70` (`applied.length).toBe(73); // 0000..0072 ...`), `:73` (`skipped.length).toBe(73)`), `:1841`
    (`toBe(73); // 0000..0072`), `:1846` (`rows.length).toBe(73)`), `:2123` (the tail in the array inside `nsCtx.runMigration()`,
    `:2121-2124`), `:4741` (the UCC-8 title `MIGRATION_COUNT (73) ... the tail is 0072`), `:4743` (`files.length).toBe(73)`), `:4744`
    (`files[files.length - 1]` tail).

Guards expected green with no edit:

- L41-G1 (`member-name-writer-guard.test.ts:722-800`, the live catalog of `L41_TEN` at `:663`): (a) no unqualified call (hence
  `pg_catalog.left`); (b) pg_temp last in search_path (both search_path lines are kept).
- L29-G1 (`:325-353`; `lateWriters` defined at `:312`, used at `:321`, `:347`): 0073 re-defines two VIA_RULE members (P2, P4), as 0072 did;
  no list edit.
- G1 (`:199-`, catalog-based) and G2 (`:416-`, flags statements and DO blocks that WRITE the four columns; 0073's owner check only reads).
- RC-ACL (`member-name-invisible-chars.test.ts:640-689`), RC-OWNER (`:691-720`, 0069's block), L29-RC P2 (`:1336-1381`) and P4
  (`:1601-1645`: `calls: 1, ingress: 1, strip: false` still holds, the new expression contains the rule call once), L41-C1 (`:1920-1968`),
  L41-PT (`:2352-2400`).
- `auth.test.ts:3780`, `:4115`, `:4133` (calls) and `:4383` (D1-12, EXECUTE for app); `rls-invariants.test.ts:4905-5005` (the 0051 definer
  describe: EXECUTE for app only, prosecdef, proconfig `search_path=pg_catalog, public, pg_temp`, no PUBLIC EXECUTE, the same owner). All
  attribute-only; no length pin among them except `:4950` above.
- Stay green (another field or the unchanged 120): `me-settings.test.ts:202-205`, `:335-341`; `member-name-invisible-chars.test.ts:1246`,
  `:1521-1522`, `:2231`; `club-config.test.ts:337`, `:409-410`; `migrate.test.ts:4407`; `chat-read.test.ts:371-375`. No test asserts that a
  100-code-point roster name is accepted, and no test pins the TS text `displayName must be 1..`.

## 6. TypeScript side

The cap (Q4):

- Today: `me-settings.ts:20` `export const DISPLAY_NAME_MAX = 120;` (local use `:39`), exported by `index.ts:270` (block `:268-279`, ending
  `} from "./me-settings.js";`); `roster-money-shared.ts:58` `export const DISPLAY_NAME_MAX = 100;` (no local use), imported by
  `roster-service.ts:7` (block `:6-18`) and used at `:117` and `:119`. No apps/ file imports it from `@plexco/db`. The web's own `= 100`
  (`apps/web/components/sessions/roster-add-player-form.tsx:14`) is lane L43's.
- After (D2): ONE `export const DISPLAY_NAME_MAX = 120;` in `text-safety.ts`, with a doc line (code points of the stripped value; DD-150
  Q4(b)). `text-safety.ts` has no import statement (its three ` from ` hits, `:33`, `:40`, `:45`, are comment text): a leaf module, so no
  cycle. `me-settings.ts` adds `DISPLAY_NAME_MAX` to its text-safety import at `:8`, `:20` becomes `export { DISPLAY_NAME_MAX };`, and `:24`
  becomes `` super(`display name must be 1-${DISPLAY_NAME_MAX} printable characters`) `` (the same text, D6; precedent `public-alias.ts:55`).
  `roster-money-shared.ts:58` becomes `export { DISPLAY_NAME_MAX } from "./text-safety.js";`. `index.ts:270`/`:279` and `roster-service.ts:7`
  stay unchanged and keep working; the roster now reads 120.
- Rejected alternative: no forwarding exports (roster-service imports from text-safety, `index.ts` moves the export to its text-safety block
  `:281-286`, me-settings drops its export): it removes two module exports the lane block asks to keep.
- Units: the DB package counts code points (`me-settings.ts:38` `[...name].length`; `isBoundedText`, `roster-money-shared.ts:64-67`, counts
  `[...v]` and refuses NUL and unpaired surrogates; SQL `char_length`). The roster counts before the trim (`roster-service.ts:113`, `:117`;
  checkTypedName trims afterwards), the profile writer after it (`me-settings.ts:37-38`), SQL after strip and trim: the roster TS is the
  stricter side, so it fails closed (threat 3); the order is not changed here (a rule change is a ruling request). The web counts UTF-16 units
  (`roster-add-player-form.tsx:24`): lane L43 aligns it to code points, and the PR body says so for L43.
- The one-definition guard (D4) goes in `text-safety.test.ts` (a pure unit test with no DB; imports `:1-3`, already imports
  `validateDisplayName` at `:2`), not in `member-name-writer-guard.test.ts` (it needs a DB, `beforeAll` at `:176`). Without `git grep`, it
  reads every `.ts` file of `packages/db/src` (flat, no subdirectories) with `node:fs` and counts the files that define the cap (a `const`
  declaration of `DISPLAY_NAME_MAX`, matched by a literal RegExp, not one built from data): exactly 1, `text-safety.ts`; and the imported
  value is 120. The test text must not contain the literal the acceptance grep searches for, or that grep finds two. Precedent for reading
  TS source: `chat-service.test.ts:454`.

`tenantRepo.sessions.create` (Q5):

- `tenant.ts:123-143` (`create`, inside `tenantRepo` at `:102`, `sessions:` at `:106`) stores the typed text raw: `:135`
  `area: input.area ?? null,` and `:136` `venueName: input.venueName ?? null,`; `:132` `timezone` is an IANA id. Input type `tenant.ts:81-94`
  (`area?: string | null`, `venueName?: string | null`; no venueAddress). Doc `:73-79` (audit D-15): it bypasses SessionService; a
  test-fixture seam with 0 production callers, guarded by `tenant.test.ts:192-193`.
- Mirror `session-service.ts:131-132` (`...(typeof area === "string" ? { area: stripInvisibleChars(area) } : {}),` and the same for
  venueName; strip only, no trim; imported as at `session-service.ts:22`): `tenant.ts:135` becomes
  `area: typeof input.area === "string" ? stripInvisibleChars(input.area) : null,`, `:136` the same for venueName, and
  `import { stripInvisibleChars } from "./text-safety.js";` goes after `tenant.ts:3`. For every non-string value the type allows this equals
  `?? null`. An invisible-only value strips to the empty string, exactly as on the session-service path (`:131`).
- Callers, tests only: `rls-invariants.test.ts:59` (`createIn`, `:58-66`) and `:1888` (`createSession`, `:1884-1894`); neither passes area
  or venueName, so no current caller changes.
- The strip test: a new describe in `tenant.test.ts` (its own `setupRlsTestContext`, teardown in `afterAll`) that creates one session through
  the seam with a production-shaped area and venueName carrying U+200B and U+202E and asserts the stored row is stripped; model
  `rls-invariants.test.ts:58-66`; harness `test-harness.ts:683` (`appDb`), `:690` (`tenantA`), `:692` (`badmintonSportId`).
- GitNexus impact at the base (upstream): `DISPLAY_NAME_MAX` (roster-money-shared.ts) 0 direct, 0 processes, LOW; `isBoundedText` 3 direct,
  0 processes, 1 module, LOW; `validateDisplayName` 1 direct (`updateMyProfile`), LOW; `create` (tenant.ts) 0 direct, 0 processes, LOW. The
  index has no edge for const imports or for the `tenantRepo(...).sessions.create(` member call, so it under-reports: `git grep` is the
  authority for the blast radius (the counts above). The writers re-run impact before each edit and `detect_changes` at the end.

## 7. Backlog rows

- `tenant-repo-sessions-create-area-venue-strip` (`docs/autopilot-backlog.md:6711-6721`): status idea, risk P2, change_class code, invariants
  [session-command], scope [packages/db/src/tenant.ts], `merged_probe: null`, no close_by line. This lane does the whole row: close it BY
  HAND (status merged, `merged:` and `note_merged:`, no PR number or SHA) in the L41 form (row `member-name-definers-qualify-builtins`,
  `:6881-6885`: the reconcile scans only planned, ready and blocked rows, so it cannot flip an `idea` row with `merged_probe: null`).
- `name-fields-one-visible-check-one-length-rule` (`:6820-6834`): status idea, risk P1, scope [packages/db/src/me-settings.ts,
  packages/db/src/roster-money-shared.ts, apps/web/lib/session-form-model.ts, apps/web/lib/club-settings-model.ts,
  apps/web/lib/me-settings-client.ts]. The DB half (one DISPLAY_NAME_MAX, the roster at 120, the Google cap O7) is this lane's; the web half
  (three inline literals, UTF-16 counting) is L43's; `club-config-validation.ts:68` is in packages/db/src but outside this lane's ownership
  and inside the row's "mixed length units". Default D3: a dated `Update 2026-10-26 (lane L42 ...)` line naming what landed and the
  remaining scope (L43's web half, `club-config-validation.ts:68`, the roster's count-before-trim order); the status is NOT flipped.
- The related row `session-text-fields-control-char-validation` (`:6296-6305`) is `status: merged`, scope
  [packages/db/src/session-service.ts, apps/web/lib/session-form-model.ts]: not touched (the strip row is its named residue).
- New out-of-scope rows: none needed (the UTF-16 units of `club-config-validation.ts:68` and `apps/web/app/api/onboarding/start/route.ts:78-79`
  are inside the second row's "mixed length units"; `tenant_provision` is bounded by `tenants_name_len_chk`, measured). At most 3 if a
  writer finds one.

## 8. Pinned defaults

Each is "default applied, pending owner sign-off" (Tier B), here and in the PR body, with its rejected alternative.

- **D1 the Google cap in the same migration**: `auth_login_google` gets `pg_catalog.left(..., 120)` on the same value (E3). Rejected: leaving
  `auth_login_google` alone (the Zalo twin, 0072:419, truncates; the guest copy, 0072:702 and :722, inherits the length; the dev persona, a
  future caller or a direct EXECUTE reaches the uncapped write).
- **D2 the constant's home**: `text-safety.ts`, next to the one visible-character check (`stripInvisibleChars` `:82`, `hasVisibleChar`
  `:115`, `checkTypedName` `:120`, `normalizeExternalName` `:126`). Rejected: keeping it in `me-settings.ts` (the roster module would import
  a profile module); the no-forwarding variant (section 6).
- **D3 the first row**: a dated update line, not flipped (section 7). Rejected: closing it (its web half is L43's).
- **D4 the test shapes**: `layer0073` plus RC-BODY-0073 with planted cases; L42-C1; real-DB roster tests at 100, 101, 120 and 121 code
  points; the Google tests at 200 and hidden-only; the guard in `text-safety.test.ts`; the strip describe in `tenant.test.ts`; no new test
  file. Rejected: a hash pin (opaque on failure); a new test file (the file ceiling, section 12).
- **D5 the migration file name**: `0073_member_name_length_cap_120.sql`, marker tag L42. Rejected: a name carrying a decision number.
- **D6 the `me-settings.ts:24` message** is built from the constant (the same text), so no second literal 120 remains in that file. Rejected:
  leaving the literal.
- **Tier A** (the lane block's FILE OWNERSHIP, "their tests ... or the focused existing files step 0 names"): `rls-invariants.test.ts:4950`
  is the roster definer's own length test, named here: it is edited beside the tail pins, that one line only.

## 9. Implementation steps

1. **W1 the migration** (opus/max, the generator method, at most two edits): generate 0073 (section 4); on a scratch database record both
   functions' attributes and ACL before (at the base) and after (with 0073) for section 14, and re-run the section 2.2 probe after (roster
   101 and 120 stored, 121 refused with the new message; Google 121 and 200 stored at 120, hidden-only NULL; the other rows unchanged).
   Commit.
2. **W4 TypeScript** (opus/high): the constant, the imports and the `me-settings.ts:24` message (section 6); the `tenant.ts` strip; the strip
   describe in `tenant.test.ts`; the guard in `text-safety.test.ts`. GitNexus impact before each symbol edit. Commit.
3. **W3 tests** (opus/high): `layer0073`, RC-BODY-0073, L42-C1 and `:1207` in `member-name-invisible-chars.test.ts`; the real-DB roster tests
   in `roster-service.test.ts` (a 101-character and a 120-character typed name through the host roster command, stored whole; 121 refused
   with `displayName must be 1..120 characters`; a hidden-only typed name refused); the Google length tests (section 5). Commit.
4. **The orchestrator's apply script**: the 14 tail-pin lines and the two `repeat(121)` lines (section 5); the backlog rows (section 7).
   Commit. Until this step the db suite shows exactly these 16 lines red; the full suite runs after it.
5. **Review**: R1a (the migration against the 0072 blocks and the live catalog, the generator equality, the attribute table), R1b (the TS
   side, the tests and the pins) and SEC (the threat model as the checklist; the sign-in path with an oversized and a hidden-only external
   name), on COMMITTED content with lean inputs; at most 3 rounds counting pre-push rounds.

The lane's B3 measurement runs after every writer.

## 10. Acceptance matrix

| Row | Check | Expected |
|---|---|---|
| A1 | roster TS (`resolveMembership`) | 101 and 120 code points accepted; 121 refused `INVALID_INPUT` with `displayName must be 1..120 characters` |
| A2 | roster SQL (`create_host_added_person`) | 101 and 120 stored whole; 121 refused 22023 `create_host_added_person: display name must be 1..120 characters`; a NULL rule result refused with the same message (0072:241-243) |
| A3 | end to end (host roster command, real DB) | a 101-character and a 120-character typed name stored whole |
| A4 | Google (`auth_login_google`) | stores min(length, 120) code points (121 and 200 -> 120); never raises on the name; hidden-only -> NULL; the other branches unchanged |
| A5 | attributes and ACL | before = after for both functions (section 14); RC-ACL, the rls-invariants 0051 describe and auth.test.ts D1-12 green |
| A6 | generator equality | each 0073 block with its named edits reverted equals its 0072 block byte for byte; same line count; the differing lines are E1-E3; `pg_catalog.` delta 0 and 1 |
| A7 | RC-BODY | `layer0073` green on both rows; RC-BODY-0073 green, red on each planted case |
| A8 | owner check | 0073 applies on a fresh database, on `plexco_test` and through the owner role; L42-C1 raises 42501 with the `0073:` prefix on a planted mismatch |
| A9 | one definition | `git grep -n "DISPLAY_NAME_MAX = " -- packages/db/src` finds `text-safety.ts` only; the guard test green; `index.ts` and `roster-service.ts` resolve to 120 |
| A10 | profile writer | unchanged: 120 accepted, 121 refused, the same message text |
| A11 | tenant create | area and venueName with U+200B and U+202E stored stripped, as `session-service.ts:131-132`; a non-string value -> null |
| A12 | guards | L41-G1, L29-G1, G1, G2, RC-ACL, RC-OWNER, L29-RC P2 and P4, L41-C1, L41-PT green, none loosened |
| A13 | pins | the 14 tail pins at 74 / 0073; `:1207` at `1..120`; `:391` and `:4950` at 121 |
| A14 | backlog | one row closed by hand; one dated update line; 0 new rows (at most 3) |
| REG | db suite, `pnpm -w test` | green; no assertion weakened or deleted; detect_changes shows only the lane's files |

## 11. Verification

- **Before every commit:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm review:check:changed`; the full `pnpm review:check`
  once; `pnpm build` once; the C11/C12 scans (no `new RegExp(` built from data; every every-scalar loop at most about 3 s locally with its own
  explicit 30_000 budget).
- **DB commands** through the lane's locked-run wrapper (outside the repo), sandbox off: the focused files first
  (`member-name-invisible-chars.test.ts`, `member-name-writer-guard.test.ts`, `roster-service.test.ts`, `tenant.test.ts`,
  `text-safety.test.ts`, the three tail-pin files); `pnpm --filter @plexco/db test` at the final head; `pnpm -w test` once at the final head
  (one rerun only for a flake on the active clerk list). A `plexco_test` reset only through the sanctioned script when the checksum guard
  demands it, announced; never `docker compose down -v`.
- **GitNexus:** impact before editing `validateDisplayName`, the `isBoundedText` users, the `DISPLAY_NAME_MAX` importers and `tenantRepo`;
  `detect_changes` at the end.
- **Security round:** required (SECURITY DEFINER re-creation of identity and PII writers; external input on the sign-in path).
- **A classifier denial** is never retried or rerouted: an AWAIT with the exact owner commands.

## 12. Budget (B3)

- Ceilings (lane block): non-test at most 420 changed lines; tests at most 400; total (docs excluded) at most 820; files at most 14; exactly
  1 migration. A crossing is a ruling request before the next writer.
- Estimate: the migration about 300 lines (the two restated blocks 46 + 185 = 231, the header about 40, the owner check about 30, block
  comments 2) plus TypeScript about 15 (text-safety about 3, me-settings about 4, roster-money-shared 1, tenant.ts about 4): non-test about
  315. Tests about 170-240 (the layer and RC-BODY-0073 40-60, L42-C1 20-30, roster tests 30-40, Google tests 20-30, the guard 12-15, the
  strip describe 25-35, the 16 moved lines and `:1207`).
- Files: 14 expected, at the ceiling: the migration, `text-safety.ts`, `me-settings.ts`, `roster-money-shared.ts`, `tenant.ts`,
  `text-safety.test.ts`, `tenant.test.ts`, `member-name-invisible-chars.test.ts`, `roster-service.test.ts`, `migrate.test.ts`,
  `rls-invariants.test.ts`, `outbox-projector-registry.test.ts`, `docs/autopilot-backlog.md` and this file. Any further file (`index.ts`,
  `roster-service.ts`, `me-settings.test.ts`, `member-name-writer-guard.test.ts`, a new test file) is a ruling request first.

## 13. THREAT MODEL

Lane block, verbatim: "defends against (1) a re-creation that silently drops or changes an attribute (owner, SECURITY DEFINER, search_path,
ACL) of an identity writer; (2) body drift between the migration, the byte pin and the live catalog (the generator equality test); (3) a
writer that accepts a length another layer refuses (TS and SQL disagree) or a name another layer would strip/refuse: fail-closed on every
path; (4) the external-name path raising instead of normalizing (a hostile Google name blocking sign-in); (5) the unbounded stored name (O7);
(6) a second definition of the cap drifting from the first (the grep guard). Not defended (named): homoglyphs and confusables (Q3), stored
production values nobody here can measure."

Where each is checked: (1) section 14, RC-ACL, the L42 owner check, L42-C1; (2) the generator equality, `layer0073`, RC-BODY-0073; (3) A1-A3,
A10, A11 and the stricter roster order (section 6); (4) E3, A4; (5) E3, A4; (6) the guard test and the acceptance grep (A9).

## 14. Before/after attribute table

The before values are the live 0072 text, pinned by RC-ACL (`member-name-invisible-chars.test.ts:640-689`) and the rls-invariants 0051
describe (`:4905-5005`). The after column is expected equal; W1 measures it on a scratch database and RC-ACL pins it. No after value is
written before that measurement.

| attribute | `create_host_added_person` before | `auth_login_google` before | after |
|---|---|---|---|
| signature | `(uuid, uuid, text) RETURNS uuid` (0072:206-210) | seven parameters, `RETURNS TABLE (account_id uuid, person_id uuid, outcome text)` (0072:489-496) | expected equal; measured by W1 on a scratch database and pinned by RC-ACL |
| LANGUAGE | `plpgsql` (0072:211) | `plpgsql` (0072:497) | expected equal; measured by W1 on a scratch database and pinned by RC-ACL |
| SECURITY | `SECURITY DEFINER` (0072:212) | `SECURITY DEFINER` (0072:498) | expected equal; measured by W1 on a scratch database and pinned by RC-ACL |
| search_path | `SET search_path = pg_catalog, public, pg_temp` (0072:213) | `SET search_path = public, pg_temp` (0072:499) | expected equal; measured by W1 on a scratch database and pinned by RC-ACL |
| volatility, PARALLEL, strictness | no clause: VOLATILE, PARALLEL UNSAFE, CALLED ON NULL INPUT | the same | expected equal; measured by W1 on a scratch database and pinned by RC-ACL |
| LEAKPROOF, COST, ROWS | no clause: the defaults (RC-ACL pins not leakproof and cost 100) | the same | expected equal; measured by W1 on a scratch database and pinned by RC-ACL |
| ACL | `REVOKE ALL ... FROM PUBLIC` and `GRANT EXECUTE ... TO app` (`0051_host_add_person_definer.sql:64-65`) | the same pair (`0017_oauth_transactions.sql:477-478`) | expected equal (RC-ACL `["app:EXECUTE"]`); measured by W1 on a scratch database |
| owner | the migrating role (never set; 0072's owner check compares it with the strip helper's owner) | the same | expected equal; checked by the L42 owner check and measured by W1 |

## 15. OPEN

- In scope: 0.
- Out of scope, named (current behaviour and negative scope pinned; none affects this slice):
  - the web half (lane L43): the apps/web roster form cap of 100 (`roster-add-player-form.tsx:14`, `:24`, `:130-131`, `:141`) and UTF-16
    counting in apps/web;
  - `club-config-validation.ts:68` (UTF-16, the literal 120): inside the second backlog row's "mixed length units";
  - the production Google callback passes `displayName: null` (DD-26; `callback/route.ts:196`): unchanged;
  - `zalo_identity_resolve` was not measured on the scratch database (the fixture was refused; section 2.2): its 120 cap is read from the
    body and pinned by existing tests; unchanged here;
  - the roster's count-before-trim order (section 6): it fails closed; recorded in the second row's update line.

## 16. Closure matrix (12 of 12 PASS)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the worktree HEAD at step 0, the merge of PR #119 (measured); every TARGET_FILES path exists (`git ls-files --error-unmatch` and the migrations listing, measured) | PASS |
| 2 | Decisions in scope final | DD-150 (Q4 b and c, Q3); RO-L42-1 and D35 (conductor); D1-D6 pinned as defaults pending owner sign-off (section 8) | PASS |
| 3 | Scope IN/OUT and owner clear | the lane block's FILE OWNERSHIP and NEGATIVE SCOPE; the Tier A `:4950` line (section 8); the 14 files (section 12) | PASS |
| 4 | Dependencies classified | L41 merged (the base is its merge); L46 takes the number after 0073; L43 and L48 wait for this lane; other Phase 4 lanes share only the backlog | PASS |
| 5 | Live schema and code match | sections 2-6: the 0072 bodies, the probe, the TS definitions and the pins measured at the base | PASS |
| 6 | Data, API, state, auth contract | the only behaviour changes are the ruled roster cap 120 (TS and SQL) and the Google truncation at 120; no attribute, ACL, table, column, role, grant or env change | PASS |
| 7 | Fail-closed, idempotency, order | the owner check (42501) before the first CREATE OR REPLACE; the Google cap truncates and never raises; the roster TS stricter than SQL | PASS |
| 8 | Open questions in scope = 0 | section 15 | PASS |
| 9 | Acceptance matrix with expected results | section 10 | PASS |
| 10 | Migration, security, rollback | exactly one append-only migration 0073; security round planned; rollback = a forward migration restating the 0072 blocks | PASS |
| 11 | First slice hard dependencies merged | L41 merged (PR #119); the base holds 0072 | PASS |
| 12 | Implementation handoff ready | sections 4-12; the worktree at the base with this file as its first commit; W1 has every input (the two block ranges, E1-E3, the owner check, the generator rule) | PASS |

## 17. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-26
AUTHORITY_SHA: 39c503d7b9fc353380a23752edd3c574ab08fb41
BASE_BRANCH: main
TARGET_FILES:
  - packages/db/src/text-safety.ts (edited: one new export of the cap, 120)
  - packages/db/src/me-settings.ts (edited: the import :8, the re-export :20, the message :24 only)
  - packages/db/src/roster-money-shared.ts (edited: the re-export :58 only)
  - packages/db/src/tenant.ts (edited: the text-safety import after :3, :135-136 only)
  - packages/db/src/text-safety.test.ts (edited: the one-definition guard)
  - packages/db/src/tenant.test.ts (edited: one new strip describe)
  - packages/db/src/member-name-invisible-chars.test.ts (edited: layer0073, RC-BODY-0073, L42-C1, :1207, the Google length tests)
  - packages/db/src/roster-service.test.ts (edited: :391 and the real-DB roster length tests)
  - packages/db/src/migrate.test.ts (edited: tail pins :53, :756 only)
  - packages/db/src/rls-invariants.test.ts (edited: tail pins :70, :73, :1841, :1846, :2123, :4741, :4743, :4744 and the length line :4950 only)
  - packages/db/src/outbox-projector-registry.test.ts (edited: tail pins :114, :115, :117, :120 only)
  - docs/autopilot-backlog.md (edited: rows :6711-6721 and :6820-6834 only)
  - packages/db/migrations/0072_member_name_definers_qualify_builtins.sql (read only: header :1-43, owner check :45-82, :205-250, :419, :488-672)
  - packages/db/migrations/0051_host_add_person_definer.sql (read only: the ACL :64-65)
  - packages/db/migrations/0017_oauth_transactions.sql (read only: the ACL :477-478)
  - packages/db/src/member-name-writer-guard.test.ts (read only: :50-89, :312-353, :663, :722-800; expected green)
  - packages/db/src/roster-service.ts (read only: :7, :113, :117-119, :124)
  - packages/db/src/index.ts (read only: :268-286)
  - packages/db/src/session-service.ts (read only: :22, :124-137)
  - packages/db/src/club-config-validation.ts (read only: :68, out of scope)
  - packages/db/src/auth.test.ts (read only: :3780, :4115, :4133, :4383)
  - apps/web/lib/oauth-transaction.ts (read only: :283-304)
  - apps/web/app/api/auth/google/callback/route.ts (read only: :190, :196)
  - apps/web/lib/dev-login/persona-account.ts (read only: :58, :64)
  - apps/web/components/sessions/roster-add-player-form.tsx (read only: :14, :24; lane L43)
  - docs/sessions/web-mvp-phase4-plan.md (read only: section 3 row L42 :58, Q4 :111, :92)
  - docs/standards/decisions.md (read only: DD-150 :120, :1765, :1790)
SLICE: p4-name-rules-db
IN_SCOPE: packages/db/migrations/0073_member_name_length_cap_120.sql re-creating create_host_added_person (cap 120, E1 and E2) and auth_login_google (pg_catalog.left of the rule result to 120, E3) by the generator method, every attribute and the ACL unchanged, the L42 owner check, no GRANT, REVOKE or OWNER; one DISPLAY_NAME_MAX of 120 in text-safety.ts imported by me-settings.ts and roster-money-shared.ts with the existing exports kept; the tenantRepo.sessions.create strip of area and venueName; the tests and pins of sections 5-6; the 14 migration-tail pin lines and the two repeat(121) lines; the two backlog rows; this readiness file
OUT_OF_SCOPE: a CHECK constraint (DD-150 Q4 c); any change of the SQL rule, the strip helper, the strip set, the visible test, the emoji rule or any other definer; what a writer accepts beyond the ruled length; the 120 cap elsewhere; any apps/web file (L43); club-config-validation.ts; the roster count-before-trim order; a new table, column, role, grant or env; confusables work (DD-150 Q3); edits of migrations 0068-0072; enabling anything; PR #50
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: p4-name-definers-and-rule-tests (L41) merged: the base commit is the merge of PR #119
PRIOR_SLICES: L23, L27, L29 (merged: migrations 0068-0070 at the base); L41 (merged: migration 0072, PR #119)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # one append-only migration 0073; security round planned (opus/max); rollback = a forward migration
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 - generate 0073 from the two 0072 blocks with the three literal edits, the L42 owner check and the header by the generator method, then record the before/after attributes and the length probe on a scratch database; commit in the worktree
REMAINING_BLOCKERS: none
```
