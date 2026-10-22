<!-- review-readiness: code-ready -->

# Step-0 readiness: L27 p3-strip-invisible-member-names (session P3-S16e)

> Agent-facing. Readiness reviewer S0c: opus/high (the lane's readiness-reviewer model and effort). The Q1, Q3, Q4 and Q5 facts were measured by the step-0
> reviewers S0a (SQL) and S0b (TypeScript), opus/high, whose notes live outside the repo in `status/P3-S16e-notes`; S0c re-read three of their claims at the base
> (section 2) and answers Q2. Writers: opus/max for the migration, its SQL tests and the writer guard (U1-U3); sonnet/high for the pin sites, the TypeScript
> validators and the web mirrors (U4-U6). Code reviewer opus/max plus a separate opus/max security round (external input on personal data, seven SQL definers, a
> data cleanup). RISK: P1.
> Lane contract: lane block L27 of the conductor-authored P3-S16e brief (not on main). Base `5fb55e86d902c0c94fa7ff0db94ff6e1cdb62c6e` (origin/main at step 0: the
> merge of PR #98, L28, on top of the PR #97 merge, L23); branch `feat/p3-strip-invisible-member-names`; worktree `.autopilot/worktrees/p3-strip-invisible-member-names`,
> clean at step 0 (measured: HEAD = base, empty porcelain, no index.lock). Every `path:line` below is measured at the base. Code points are written U+XXXX on
> purpose: this file holds no invisible byte.

## 1. Authority

- Owner decision item 6 (`status/OWNER-DECISIONS-2026-10-22.md`, owner-confirmed in chat), verbatim: "Item 6 (invisible-character rule beyond the anonymous public
  surface): owner chose "a separate lane" (10:53). Extend the strip to the member-facing names (persons.display_name in the host roster, join-request inbox and chat
  author labels; tenants.name; memberships.display_name) and sessions.venue_address, including every writer (Zalo ingress definer and the others). Own lane, migration
  serialized, own review."
- The owner's prompt line for L27 (P3-S16 conductor prompt), verbatim: "L27 (item 6): extend the invisible and control code point strip to member-facing names
  (persons.display_name: host roster, join-request inbox, chat author labels; tenants.name; memberships.display_name) and sessions.venue_address, through every writer
  including the Zalo ingress definer; migration (next free number) serialized; clean stored values once like 0068; own review rounds, security-sensitive."
- Decision record: expected DD-144 (lane L26, not merged at this base): `grep -c DD-144 docs/standards/decisions.md` prints 0 at the base. The PR body cites the number
  measured on its own base, or quotes item 6 verbatim if L26 has still not merged.
- What item 6 widens: DD-138 (`docs/standards/decisions.md:1848`) and the L23 boundary. The conductor reading RO-L23-1 (R1 = A) kept these four columns out, and the
  0068 header (`0068:8-10`) names them "Untouched here ... (extending the rule to them is an owner decision)". Item 6 is that owner decision.
- Conductor notes A2 (the writer inventory is the main risk: cover writers structurally or add a source-scan guard; say which: section 4) and A3 (the emoji
  consequence stated, pinned by a test, no exception: section 7). Review per DD-122 D4 (Codex waived by the owner 2026-10-12).
- Dependencies: L23 (PR #97) is on the base (0068, `stripInvisibleChars`, the web mirror: section 2). L18 is recommended, not required, and is NOT on the base: the
  harness race "tuple concurrently updated" stays a listed flake (one rerun). L24 (P3-S16d) may run beside this lane on disjoint files. Migration slot 0069 is
  assigned to this lane.

## 2. Measured at base

| Fact | Evidence (at the base) |
|---|---|
| L23 TS blocks: `STRIP_CHAR_RANGES` `:48` (16 ranges, 4162 code points), `stripInvisibleChars` `:78` (linear scan, lone-surrogate safe), `hasHiddenChar` `:106`, `hasVisibleChar` `:111`; `index.ts:281` exports `STRIP_CHAR_RANGES` and `stripInvisibleChars` only | `packages/db/src/text-safety.ts` |
| Web mirror: `textOrNull` `:93`, `hasHiddenChar` `:101`, range copy `:113-130`, `stripInvisibleChars` `:145`; `club-settings-model.ts:3` imports it | `apps/web/lib/session-form-model.ts` |
| SQL helper `public_name_strip_invisible(text)` `0068:50-63`: LANGUAGE sql, IMMUTABLE, STRICT, PARALLEL SAFE, SECURITY INVOKER, `search_path = pg_catalog`; REVOKE ALL FROM PUBLIC, app, app_worker, readonly `0068:65` (owner-only EXECUTE); owner = owner of `tenant_public_alias_set` (L23-OWNER block `0068:173-182`); that definer strips before its trim at `0068:136` | `0068_public_name_invisible_chars.sql` |
| Agreement pins today: TX-ALL `text-safety.test.ts:15`, TX-R4 emoji split `:65-70`, the 133 refused today `:81`; PS-PIN `public-name-invisible-chars.test.ts:186-221`, PS-ACL `:223-256`, PS-OWNER-REPAIR `:258-297` (marked-block reader `:30-45`); SF-PIN `session-form-model.test.ts:594-597`; W7 `:452-463` | tests |
| No L27 writer strips today. `hasHiddenChar` refuses 133 of the 4162 strip code points; the other 4029 (every variation selector incl. U+FE0F, U+180B-180D, U+FFF0-FFF8, unassigned DI) pass every L27 check and are stored as sent | S0b section 0 |
| Constraints: persons.display_name text NULL, no CHECK (`0001:23`, `schema.ts:42`); memberships.display_name text NULL, no CHECK (`0002:27`, `schema.ts:548`); tenants.name text NOT NULL, CHECK `tenants_name_len_chk` 1..120 (`0002:13`, `0039:129`, `schema.ts:521`, `:535`); sessions.venue_address text NULL, no CHECK (`0002:84`, `schema.ts:634`); no index or UNIQUE on any of the four | S0a constraints |
| Empty value today: persons.display_name NULL in `auth_login_google` and `zalo_identity_resolve`, refused 22023 in `create_host_added_person` and `person_profile_update`; tenants.name refused 22023 by both writers (CHECK 23514 is the backstop); memberships.display_name copies persons; venue_address decided in TS (stored as sent, the client sends NULL for blank) | S0a, S0b |
| Triggers on the four tables: exactly one, `trg_memberships_chat_provision` (`0063:629`, AFTER INSERT OR UPDATE OF status, owned by chat_definer), pinned by name at `chat-catalog.test.ts:382-383`; no test holds an exhaustive trigger list for these tables | S0a |
| The seven name-carrying definers: SECURITY DEFINER, no OWNER TO (owned by the migration runner, the helper's owner in every measured DB), REVOKE ALL FROM PUBLIC plus GRANT EXECUTE TO app only; `search_path = pg_catalog, public, pg_temp` except `auth_login_google` and `tenant_provision` (`public, pg_temp`). CREATE OR REPLACE keeps owner and ACL and resets every omitted attribute (`0068:73-75`) | S0a rows 1-8 |
| Per-function pins that must stay green: `auth.test.ts:4308` D1-12; `rls-invariants.test.ts:4958` (create_host_added_person), `:5096-5127` (tenant_profile_update); `zalo-ingress.test.ts:122`, `:144`; `me-settings.test.ts:776`, `:781`, `:808-812`; `identity-link-web.test.ts:1231-1244` (prosrc scan: bodies inserting into tenant_admins = exactly [tenant_provision]); A-12 `public-alias.test.ts:524` (c_ws, c_space, c_reject, c_visible of `tenant_public_alias_set` byte-equal to `person_profile_update`'s); `create_guest_membership` has no catalog pin | S0a Q5 |
| Q3 (read-only counts, values never printed): plexco_smoke (tail 0068) persons 27 rows / 27 non-null / 0 with a strip code point / 0 empty after; memberships 39 / 26 / 0 / 0; tenants 13 / 13 / 0 / 0; sessions.venue_address 23 / 23 / 0 / 0. plexco (dev) is at 0031: 0 rows in each. No row would become empty: no ruling request | S0b section 2 (method validated on smoke: inline class vs helper mismatch 0 of 102) |
| Q4: only sessions.venue_address reaches a projection: `public_sessions_project_session` (`0067:223`, read `:250` masked by `hide_exact_address`, upsert `:307-355`) into `public_sessions.venue_address` (`0067:55`); 0061 dropped host and club display names from public_sessions (`0061:43-44`); tenants.name, memberships.display_name and persons.display_name are read live only | S0b section 3 |
| Q5: 14 pin lines in 3 files: `migrate.test.ts:53`, `:769`; `rls-invariants.test.ts:70`, `:73`, `:1841`, `:1846`, `:2124`, `:4717`, `:4719`, `:4720`; `outbox-projector-registry.test.ts:114`, `:115`, `:117`, `:120` (count 69 to 70, tail 0068 to 0069); no pin in apps | S0a Q5 |
| GitNexus impact upstream on `public_name_strip_invisible`: "Target not found" (SQL function, not indexed). Grep fallback: callers `0068:136`, `:176`, `:220-226`, `:250-254`; no non-test TS caller; tests `public-name-invisible-chars.test.ts:47`, `:191`, `:215`, `:266` | S0c, S0a |
| S0c spot-checks (3 of S0a's claims, re-read at the base): `0053:196` is `left(nullif(btrim(p_display_name), ''), 120)`; `0058:58` is `SELECT p.display_name INTO v_name`; `0037:105-106` raise 22023 'name required' on a blank name and `:112-113` store `trim(p_name)`: all as stated | `sed -n` at the base |

## 3. Writer inventory (Q1)

12 write paths: persons.display_name 5, memberships.display_name 3, tenants.name 2, sessions.venue_address 2. 8 SQL definers; 7 carry a name and are re-created
(P5 and M3 write NULL only). TS: 5 validator sites, 2 direct writers (M1, V1/V2). Functions calling another writer: none; the one data chain is the M2 copy.

| ID | Column | Writer (TS entry, then SQL sink) | Validation today | Definer | Callers |
|---|---|---|---|---|---|
| P1 | persons.display_name | `updateMyProfile` `me-settings.ts:128` -> `validateDisplayName` `:33-41` -> `person_profile_update` `0055:92-146` (UPDATE `:140`) | TS: JS trim, 1..120 code points, refuse `hasHiddenChar`, require `hasVisibleChar`. SQL: NULL refused; c_space trim `:130`; 1..120, c_reject, c_visible, else 22023 | yes, ACL `0055:147-148` | `api/me/profile/route.ts:80`; web `me-settings-client.ts:112-121`, `settings-profile-form.tsx:78` |
| P2 | persons.display_name | `addMemberToSession` `roster-service.ts:127` -> `:109-116` (`name.trim()`) -> `create_host_added_person` `0051:18-63` (INSERT `:60`) | TS: `isBoundedText(raw, 1, 100)` (`roster-money-shared.ts:64`: NUL, lone surrogate), trim non-empty; no hidden or visible check. SQL: btrim `:54`; NULL or outside 1..100, 22023 | yes, `0051:64-65` | `api/sessions/[id]/players/route.ts:39-41`; web `roster-add-player-form.tsx:52-56` |
| M1 | memberships.display_name | `roster-service.ts:120-122` Drizzle insert `displayName: name.trim()` (withTenant) | same value and checks as P2 | no (direct) | as P2 |
| P3 | persons.display_name | `resolveZaloIdentity` `zalo-ingress.ts:172-186` -> `zalo_identity_resolve` `0053:178-262` (INSERT `:224`, new person only) | TS: none (external Zalo payload `process-event.ts:90`). SQL `:196`: btrim, blank to NULL, cut to 120; never refuses | yes, `0053:263-264` | Zalo webhook `process-event.ts:129` |
| P4 | persons.display_name | `loginGoogle` `oauth-transaction.ts:283-306` -> `auth_login_google` `0017:292-476` (INSERT `:405`) | SQL: `NULLIF(trim(p_display_name), '')`; no length or character check. Production passes `displayName: null` (callback `route.ts:190-196`, DD-26); dev-only `persona-account.ts:58-64` passes a fixture name | yes, `0017:477-478` | google callback `route.ts:190`; dev-login |
| P5 | persons.display_name | `detachMyChannel` `me-settings.ts:226-233` -> `channel_identity_detach` `0055:167-215` (INSERT `:203`) | writes the literal NULL only | yes, `0055:216-217` | `api/me/channels/[id]/detach/route.ts:27` |
| M2 | memberships.display_name | `mintGuestMembership` `session-join-service.ts:319-329` -> `create_guest_membership` `0058:31-100` (INSERT `:78`) | copies persons.display_name verbatim (`:58`); no check | yes, `0058:101-102`; no catalog pin | `session-join-service.ts:430` (join), `join-request-service.ts:352` (approve) |
| M3 | memberships.display_name | `tenant_provision` owner membership `0037:148` | writes no display_name (NULL) | (T1) | (T1) |
| T1 | tenants.name | `provisionTenant` `auth.ts:197-209` -> `tenant_provision` `0037:89-170` (INSERT `:112`) | TS: JS trim, 1..120 UTF-16, no character check. SQL: blank, 22023 'name required' `:105-106`; stores `trim(p_name)` `:113`; CHECK 23514 backstop | yes, ACL `0037:171-172` | `api/onboarding/start/route.ts:63-90`; `dev-login/seed.ts:123`; web `new-club-form.ts:47-56` |
| T2 | tenants.name | `updateClubConfig` `club-config.ts:55-125` -> `validatePatch` `club-config-validation.ts:58-66` -> `tenant_profile_update` `0052:63-124` (UPDATE `:115`) | TS: trim, 1..120 UTF-16, refuse Cc and Cf. SQL: btrim `:80`; non-NULL outside 1..120, 22023; NULL keeps the name | yes, `0052:125-126` | `api/onboarding/club/route.ts:103`; `club-config-route.ts:19`; web `club-settings-model.ts:35-40` |
| V1 | sessions.venue_address | `createSession` `session-service.ts:259` -> check `:247-251` -> insert `:321-334` | `isOptionalVenueAddress` `:143-144`: `hasHiddenChar` on the RAW value, at most 200 UTF-16; no trim | no (direct) | `api/sessions/route.ts:29`; web `session-form-model.ts:235-249`, `textOrNull` `:316-319` |
| V2 | sessions.venue_address | `updateSession` `session-service.ts:1228` -> check `:1347-1352` -> changes `:1486-1487` -> `.update(sessions)` `:1624-1630` | as V1 | no (direct) | `api/sessions/[id]/route.ts:38`; `session-form-model.ts:362-363` |

- Fixtures that bypass validation (listed, NOT changed): `packages/db/src/test-harness.ts:713` (tenants.name), `:1088` (persons.display_name);
  `packages/db/src/roster-money-fixtures.ts:22`, `:37`, `:57`, `:70`; `packages/db/scripts/dev-seed-club-members.ts:43-45`; `apps/web/lib/dev-login/seed.ts:123` (goes
  through `provisionTenant`) and `dev-login/persona-account.ts:58-64` (goes through `auth_login_google`); `apps/web/e2e/support/player-api-mock.ts` (mock DTOs, no DB);
  61 test files write the four tables directly (apps/bot 6, apps/web 7, packages/db/src 48: S0b's sweep).
- Not writers (checked): `auth_login_telegram` (`0012:69`, dropped `0042:52`); `0054:384`, `0062:78`, `0060:238`, `0068:158` (other columns); `0056:395` (sessions status
  only); session publish, close and cancel (`session-service.ts:713`, `:2060`, `:2470`); `tenant.ts:126` (no venue_address); no writer in apps/bot; no `EXECUTE format`
  writer.
- S0b's correction of the lane text: the host roster (`session-read.ts:291-295`), the join-request inbox (`join-request-service.ts:448-456`) and the chat author labels
  (`0065:111`, `:126`) read memberships.display_name live, not persons.display_name. persons.display_name reaches other members only through the mint-time copies M1 and
  M2, so the memberships cleanup is the one that changes what other members see.

## 4. Q2 design decision

| Criterion | (A) re-create each writer definer to strip first (0068 precedent) plus a source-scan guard | (B) BEFORE INSERT OR UPDATE trigger per table |
|---|---|---|
| Invisible-only exactly as empty, per writer | yes by construction: the strip is inserted before each writer's own trim, so its own NULLIF or refusal fires on the stripped value | NO. The trigger runs after each definer's trim, length and NULLIF and cannot tell which writer called it. On persons it must either set NULL (then `create_host_added_person`, which refuses an empty name with 22023, stores a nameless person on a direct call) or raise (then `zalo_identity_resolve` and `auth_login_google`, which null an empty name, fail the identity resolution of an external user). On tenants the CHECK raises 23514, not 22023, unless the trigger raises its own |
| Order: strip, trim, then every check | yes | NO: "name, space, U+200B" keeps a trailing space; 100 visible plus one invisible is refused by the 1..100 check; Zalo's `left(..., 120)` cuts before the strip; `zalo_identity_resolve` returns its unstripped local variable while the row holds the stripped value |
| Future writers | the guard (section 11, G1-G4) fails CI when a writer of the four columns appears without the strip | structural, any writer including direct SQL |
| Privileges, owner, grants | no new function, no grant; the re-created definers keep owner and ACL; they need the helper's owner, asserted at migrate time (B7) | four new SECURITY DEFINER trigger functions owned by the helper's owner (an owner block each), REVOKE FROM PUBLIC; an INVOKER trigger fails with 42501 for app on the direct Drizzle writes (M1, V1, V2) because the helper is owner-only, and a grant would be an ACL widening (HALT) |
| RLS | no change (same definers, same owners) | BEFORE ROW triggers run before RLS WITH CHECK and constraints and read nothing; but privileged code then runs on every write of four tables, two of them FORCE RLS |
| Catalog pins | the seven per-function pins stay green; new PS-ACL-style pins for the seven (the first one for `create_guest_membership`) | definer pins untouched; new pins for four functions and four triggers; `chat-catalog.test.ts:382` is by name, unaffected |
| A-12 | `person_profile_update` keeps its constants byte-identical (the strip goes inside its trim expression, as `0068:136`) | untouched, but its c_reject still refuses the 133 before the trigger runs while the TS layer strips them: SQL and TS disagree on direct calls |
| Performance | one IMMUTABLE regexp per write call | one trigger call per INSERT or UPDATE OF the column on four tables; both negligible |
| Rollback | revert before merge; after merge a later migration re-creates the previous bodies (in git) | DROP TRIGGER and FUNCTION in a later migration; stripped values are not restorable in either design (0 rows at the base) |
| B3 (SQL lines) | about 780: 585 restated live bodies (S0a: 185 + 82 + 46 + 62 + 85 + 55 + 70), header, owner check, cleanup | about 275, plus about 270 more to re-create the two nulling writers so that the trigger may raise, and rows 1, 2 and 7 still diverge |
| Concepts | 0 new objects, 1 guard test | 8 new objects plus owner blocks |
| Precedent | 0068 re-created `tenant_public_alias_set` this way | none: the only trigger on these tables is the chat provisioning AFTER trigger |

**Choice: (A).** Deciding tie-break: fail-closed. (B) cannot make an invisible-only persons.display_name behave exactly as an empty one: one per-table trigger
either accepts a nameless host-added person (a wrong allow) or breaks Zalo identity resolution (a wrong deny on external input). Then fewest concepts and precedent
(0068) also favour (A); one source of truth ties (both call the one helper); reversible slightly favours (B) but is the last tie-break, and (A) is reversible by a
migration. The 10x test: with ten times the writers, (A) still holds because G1 fails on every unlisted writer and RC-BODY proves each re-creation changed one
expression. Completeness mechanism: the source-scan guard (A2: "prove completeness with a guard"), specified in section 11.

## 5. Threat model (stated here and in the 0069 header)

Defends against impersonation and blank-looking names through invisible code points on every surface that renders these names to other people: host roster,
join-request inbox, chat author labels (memberships.display_name), club names (tenants.name), venue addresses (sessions.venue_address, public when not hidden) and the
person names they are copied from. It does NOT defend against visible confusables (homoglyphs): a backlog candidate (O2). Bidi and control characters keep each
writer's current handling (A1); where a writer accepts them today, they stay accepted (O1). Main residual risk: a writer missed by the inventory; the guard (G1-G4)
fails when a new writer of the four columns appears without the strip.

## 6. Decision table (column x writer)

R1 clean value. R2 strip code points among visible text (U+200B, U+00AD, U+3164, U+FE00, U+E0001, U+2065). R3 invisible-only (strip code points, optionally with
whitespace). R4 a control, bidi, line-separator or U+2800 character among visible text. R5 U+200D or U+FE0F inside an emoji sequence.

| Writer | R1 | R2 | R3 | R4 | R5 |
|---|---|---|---|---|---|
| P1 (TS + `person_profile_update`) | stored as today | stored stripped (the 133 refused today are now stripped, B5) | refused as empty: TS `DisplayNameError`, 400 `INVALID_BODY`; SQL 22023 | refused (unchanged) | stripped and split (ZWJ refused today, VS16 stored today) |
| P2 + M1 (TS + `create_host_added_person`; the membership row gets the same value) | stored | stripped | refused as empty: TS `INVALID_INPUT` 400; SQL 22023; no person and no membership row | accepted (unchanged, O1) | split (stored as sent today) |
| P3 `zalo_identity_resolve` | stored | stripped, then btrim, NULLIF, cut to 120; the returned display_name is the stored one | NULL as empty; the identity still resolves | accepted (unchanged, O1) | split |
| P4 `auth_login_google` | stored (production sends NULL) | stripped | NULL as empty | accepted (unchanged, O1) | split |
| P5 `channel_identity_detach` | writes NULL only: not affected; G1 pins it as NULL-only | | | | |
| M2 `create_guest_membership` | copied | the copy is stripped (strip alone, the 0068 area rule) | the strip alone leaves what an empty source leaves (reachable only from a cleanup-left value, B6) | copied as the source holds it (unchanged) | split |
| M3 owner membership | writes no display_name: not affected | | | | |
| T1 (TS + `tenant_provision`) | stored | stripped, trimmed | refused as empty: TS 400 `INVALID_BODY`; SQL 22023 'name required' | accepted (unchanged, O1) | split |
| T2 (TS + `tenant_profile_update`) | stored | stripped, trimmed (U+200B refused today as Cf, now stripped, B5) | refused as empty: TS `INVALID_INPUT`, 400 `INVALID_BODY`; SQL 22023 | Cc and Cf refused (unchanged) | split (ZWJ refused today as Cf) |
| V1 `createSession` | stored as sent | stored stripped (no trim, as today) | handled as empty: the strip alone (the client sends NULL for blank) | `INVALID_TEXT_FIELD` (unchanged) | split (ZWJ refused today) |
| V2 `updateSession` | as V1; a stripped value equal to the stored one is no change | as V1 | as V1 | as V1 | as V1 |
| Web mirrors (P1, P2, T1, T2, V) | no error | no error (the server stores the stripped value) | the existing empty-value error and copy | the existing error | no error |

R6 stored value at the base and R7 cleanup re-run, per column (section 8): persons.display_name, memberships.display_name and tenants.name are stripped then trimmed
once; sessions.venue_address is stripped once and each changed session re-projected; an invisible-only stored value stays unchanged with a NOTICE; a re-run changes
nothing and re-reports only the values left unchanged. Every inventory writer of section 3 appears above.

## 7. Emoji consequence (the owner rule applied as written, no exception)

U+200D (ZERO WIDTH JOINER) and U+FE0F (VARIATION SELECTOR-16) are in the strip set, so player names, club names and venue addresses that contain composed emoji lose
the joiner and the selector: a ZWJ family (U+1F468 U+200D U+1F469 U+200D U+1F467) becomes three separate emoji, a VS16 heart (U+2764 U+FE0F) becomes the text heart
U+2764. Paths that refuse a ZWJ name today (P1 through `hasHiddenChar` and c_reject, T2 as Cf, V1 and V2) now accept it split; paths that store it as sent today (P2,
M1, P3, P4, T1, M2) now store it split. One test per column documents the stripped result (section 11); the PR body states this plainly.

## 8. Cleanup design (0068 pattern, in the 0069 block between the L27-CLEANUP marker lines)

- Fail-closed visibility guard: raise 42501 when `row_security_active` is true and `pg_relation_size` is above 0 for any of public.persons, public.memberships,
  public.tenants, public.sessions (`0068:210-214` extended to four tables); apply 0069 as the superuser migration role.
- Candidates: rows whose value differs from `public.public_name_strip_invisible(value)`, `ORDER BY id`, `FOR UPDATE`.
- New value: persons.display_name, memberships.display_name, tenants.name: the strip, then the c_space trim (a byte-equal copy of the 0068 cleanup constants
  `0068:191-197`); sessions.venue_address: the strip alone (its writers store without trim).
- A new value with no visible character (c_visible) leaves the row unchanged with a NOTICE (0 such rows at the base). For tenants.name this also keeps the CHECK.
- One NOTICE per changed row id, never the text; a closing NOTICE with the counts.
- Each session whose venue_address changed: `PERFORM public.public_sessions_project_session(id, NULL)` inside the transaction (`0068:241` pattern; the projector applies
  `hide_exact_address`). The other three columns are read live: no projection.
- Re-run: a cleaned value is no candidate, so a second run changes nothing and re-reports only the left values.

## 9. Pinned defaults

Tier A (derived, no sign-off needed):

- A1: the strip set is the 0068 helper and the `text-safety.ts` list (DI minus Bidi_Control, Unicode 17.0, 4162 code points). Controls, bidi controls, U+2028, U+2029 and
  U+2800 keep each writer's current handling (lane NEGATIVE SCOPE). The prompt's "invisible and control code point strip" names L23's strip, whose 0068 header keeps
  those characters refused exactly as before.
- A2: reuse only: no new list, no new helper, no `index.ts` change (`stripInvisibleChars` is exported at `:281`); web mirrors import the `session-form-model.ts` copy.
- A3: P5 and M3 write NULL: not changed (`tenant_provision` is re-created for T1 only).
- A4: no TS change in `zalo-ingress.ts` or `oauth-transaction.ts`: neither has a validator; the definer is the boundary.
- A5: lengths, error codes, copy, grants, owners, search_paths and the refusal sets stay as they are.
- A6: the emoji split is the owner rule's consequence (section 7), not a default.

Tier B (each "default applied, pending owner sign-off"; repeated in the PR body):

- B1: design (A), with the source-scan guard and the migrate-time owner check. Default applied, pending owner sign-off.
- B2: strip on write at the TS, web and SQL layers plus a one-time cleanup in 0069, not display-time stripping. Default applied, pending owner sign-off.
- B3: order at every layer: strip, then the writer's existing trim, then every existing check unchanged on the stripped value (lengths measured after the strip).
  Default applied, pending owner sign-off.
- B4: invisible-only exactly as empty per writer (section 6): refused by P1, P2, T1, T2; NULL in P3, P4; venue_address handled as empty (strip alone, no new refusal);
  the M2 copy is stripped alone. Default applied, pending owner sign-off.
- B5: the 133 code points refused today by P1 (`hasHiddenChar`, c_reject), T2 (Cf) and V1/V2 (`hasHiddenChar`) are now stripped instead (L23 D3 precedent; about 20
  SQL ranges in c_reject). Default applied, pending owner sign-off.
- B6: the cleanup of section 8 (per-column transform, NOTICE per changed row id, invisible-only stored values left unchanged with a NOTICE, the 42501 guard,
  re-projection of changed sessions). Default applied, pending owner sign-off.
- B7: 0069 raises 42501 when a re-created writer's owner differs from the helper's owner (a SECURITY DEFINER caller with another owner cannot execute the owner-only
  helper); no ALTER OWNER, no grant. Default applied, pending owner sign-off.
- B8: the source-scan guard G1-G4 with pinned lists measured at the 0069 tail. Default applied, pending owner sign-off.
- B9: the session form sends the stripped venue address (L23 precedent); the other forms post the typed value and the server strips (idempotent), while every client
  check strips first. Default applied, pending owner sign-off.

## 10. Implementation units

Dependency order, one file or one section per writer, never two writers at once; each commits in the worktree, no push; GitNexus impact before each symbol edit
(grep fallback for SQL functions), detect_changes before each commit.

- **U1** opus/max: NEW `packages/db/migrations/0069_member_name_invisible_chars.sql`, part 1: header (section 5, the four columns, the order B3, B4, B6, B7, the
  emoji consequence); an L27-OWNER-CHECK marked DO block (B7) over the seven regprocedures; the seven CREATE OR REPLACE, each byte-identical to its live body except
  ONE substitution, all attributes restated (SECURITY DEFINER, volatility, exact search_path):

| Function | Live site | Today | 0069 |
|---|---|---|---|
| `auth_login_google` | `0017:405` | `NULLIF(trim(p_display_name), '')` | `NULLIF(trim(public.public_name_strip_invisible(p_display_name)), '')` |
| `create_host_added_person` | `0051:54` | `v_name := btrim(p_display_name);` | `v_name := btrim(public.public_name_strip_invisible(p_display_name));` |
| `zalo_identity_resolve` | `0053:196` | `left(nullif(btrim(p_display_name), ''), 120)` | `left(nullif(btrim(public.public_name_strip_invisible(p_display_name)), ''), 120)` |
| `person_profile_update` | `0055:130` | `regexp_replace(p_display_name, ` (the c_space trim) | `regexp_replace(public.public_name_strip_invisible(p_display_name), ` (constants untouched, A-12) |
| `create_guest_membership` | `0058:58` | `SELECT p.display_name INTO v_name` | `SELECT public.public_name_strip_invisible(p.display_name) INTO v_name` |
| `tenant_provision` | `0037:105`, `:113` | `trim(coalesce(p_name, ''))`, `trim(p_name)` | `public.public_name_strip_invisible(p_name)` in place of `p_name` at both sites |
| `tenant_profile_update` | `0052:80` | `v_name text := btrim(p_name);` | `v_name text := btrim(public.public_name_strip_invisible(p_name));` |

- **U1b** opus/max: 0069 part 2: the L27-CLEANUP marked block (section 8).
- **U2** opus/max: NEW `packages/db/src/member-name-invisible-chars.test.ts` (section 11: MN, RC-BODY, RC-ACL, RC-OWNER, MG).
- **U3** opus/max: NEW `packages/db/src/member-name-writer-guard.test.ts` (G1-G4).
- **U4** sonnet/high: the 14 pin lines (section 2, Q5) to 70 and 0069.
- **U5** sonnet/high, one file plus its test per writer: `me-settings.ts` `validateDisplayName` `:33-41`; `roster-service.ts` `:109-122` (strip before
  `isBoundedText` and the trim; P2 and M1 get the same value); `auth.ts` `provisionTenant` `:197-209`; `club-config-validation.ts` `validatePatch` `:58-66`;
  `session-service.ts` venue address (strip before `isOptionalVenueAddress` `:139-144` on create `:247-251` and update `:1347-1352`; store and compare the stripped
  value `:321-334`, `:1486-1487`; restate the comment `:121`); `text-safety.ts` header comment only. Each uses `stripInvisibleChars` from `./text-safety`.
- **U6** sonnet/high: web mirrors, each importing the `session-form-model.ts` strip: `me-settings-client.ts` `displayNameProblem` `:112-121`;
  `club-settings-model.ts` `clubNameProblem` `:35-40`; `new-club-form.ts` `validateNewClub` `:47-56`; `components/sessions/roster-add-player-form.tsx` `:52-56`;
  `session-form-model.ts` venue address `:235-249`, `:316-319`, `:362-363`. No new copy string: invisible-only maps to the existing empty-value copy.

## 11. Test plan

- MN (real DB, U2): rows R1-R5 for each of the seven re-created definers (P1, P2, P3, P4, M2, T1, T2 at the SQL layer), inputs built with `chr()`; the R5 row per column
  documents the emoji split; P3 also checks the returned display_name equals the stored one.
- RC-BODY (U2): for each re-created definer, the live `prosrc` equals the previous body (its last CREATE in 0017, 0037, 0051, 0052, 0053, 0055, 0058) with exactly the
  documented substitution applied (one occurrence; two for `tenant_provision`).
- RC-ACL (U2, PS-ACL style): for each of the seven, `prosecdef` true, `proconfig` exactly its base value, volatility, strictness and parallel mode equal to the base
  values, owner equal to the helper's owner, EXECUTE app only, no PUBLIC entry.
- RC-OWNER (U2): the L27-OWNER-CHECK block, read by marker like `public-name-invisible-chars.test.ts:30-45`, raises 42501 inside a rolled-back transaction after one
  writer's owner is moved to another role, and is a no-op on the normal state.
- MG (U2): the L27-CLEANUP block replayed on fixtures (rolled back): each column with a mixed value (stripped), an invisible-only value (unchanged, NOTICE), a clean
  value (untouched); every NOTICE carries the row id and never the value; a venue_address change re-projects the public row (version bump) and a hidden address stays
  masked; the 42501 guard as a NOSUPERUSER NOBYPASSRLS runtime role with a non-empty table; the re-run changes nothing.
- Guard (U3), all four must hold at the 0069 tail:
  - G1 catalog: every function outside pg_catalog and information_schema whose `prosrc` (lower-cased, `--` comments removed) holds an INSERT, UPDATE or MERGE
    statement on persons, memberships, tenants or sessions that names display_name, name (whole word, tenants) or venue_address must belong to the pinned writer list
    {auth_login_google, create_host_added_person, zalo_identity_resolve, person_profile_update, channel_identity_detach, create_guest_membership, tenant_provision,
    tenant_profile_update}; every member must exist and contain `public_name_strip_invisible(`, except `channel_identity_detach` while its body still inserts
    `values (null, 'active')`. Fails on an unlisted writer, a listed writer without the strip, or a stale entry.
  - G2 migrations: every bare statement and DO block (CREATE FUNCTION bodies are covered by G1) in `packages/db/migrations/*.sql` that writes one of the four columns
    must be in the pinned list, measured on the first run (expected: only the 0069 L27-CLEANUP block, which must call the helper).
  - G3 triggers: the non-internal triggers on the four tables are exactly {trg_memberships_chat_provision}.
  - G4 TypeScript: every non-test file under packages/db/src, packages/db/scripts, apps/web and apps/bot/src (excluding tests, apps/web/e2e and the fixture list
    {test-harness.ts, roster-money-fixtures.ts, packages/db/scripts/dev-seed-club-members.ts}) with a Drizzle `.insert(` or `.update(` of one of the four tables, or a raw
    SQL INSERT or UPDATE of one, must be in the pinned direct-writer list measured on the first run (expected: `roster-service.ts` memberships, `session-service.ts`
    sessions, `tenant.ts` sessions without venue_address). A file pinned as writing a guarded column must contain `stripInvisibleChars(`; a file pinned as not writing it
    must not contain the column's TS key (`displayName`, `venueAddress`); any tenants direct writer outside the fixtures fails. Ceiling: file-level presence, not data
    flow; the MN and TS rows prove the actual strip.
- Agreement: no new list. TX-ALL, SF-PIN and PS-PIN stay green unchanged; W7 (`session-form-model.test.ts:452-463`) is restated with the strip first on both sides,
  still over every scalar.
- TS rows (U5), R1-R5 per writer: `me-settings.test.ts` (the 133 move from refused to stripped), `roster-service.test.ts` (the membership row holds the stripped
  name), the `provisionTenant` test file (the writer confirms it with `git grep provisionTenant`), `club-config.test.ts`, `session-service.test.ts` (the venueAddress
  column of `HIDDEN_VECTORS` moves to stripped; equal after the strip is no change), `zalo-ingress.test.ts`.
- Web rows (U6): `me-settings-client.test.ts:46-83`, `club-settings-model.test.ts:29-45`, `new-club-form.test.ts`, `session-form-model.test.ts` venue rows; the roster
  form in a colocated component test or one row in `e2e/roster.spec.ts`.
- Pins (U4): the 14 sites green at 70 and 0069; the per-function pins of section 2 and A-12 green unchanged.

## 12. Verification

Cite measured output through `| tail -40`. DB and e2e runs go through the session's lock, one at a time, one migration at a time.

1. Focused vitest per changed test file.
2. `pnpm typecheck`; `pnpm lint`; `pnpm format:check`; `pnpm review:check:changed`.
3. `NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test` (under the lock).
4. `NODE_ENV=test pnpm --filter @plexco/web test` (the FULL web vitest, DB-bound files under the lock); `pnpm --filter @plexco/bot test`.
5. `pnpm --filter @plexco/web exec playwright test e2e/settings.spec.ts e2e/sessions.spec.ts e2e/roster.spec.ts` (under the lock).
6. Once at the final head: `pnpm build` (sandbox off) and `NODE_ENV=test DATABASE_URL_TEST=... pnpm -w test` (one rerun for a listed flake); re-run the role-password
   step after a full run.
7. The byte check of section 13 prints 0 for every changed file.

## 13. Tool hazard

- The Edit and Write tools turn a backslash-u escape into the raw character. Build invisible characters in TS tests with `String.fromCodePoint(0x200b)` and in SQL
  with `chr(n)`; never type a backslash-u escape or paste an invisible character; never retype existing escapes through Edit or Write.
- Byte check after each write (must print 0): `LC_ALL=en_US.UTF-8 grep -c -P '[\x{00AD}\x{034F}\x{115F}\x{1160}\x{17B4}\x{17B5}\x{180B}-\x{180F}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{206F}\x{3164}\x{FE00}-\x{FE0F}\x{FEFF}\x{FFA0}]' <file>`.

## 14. Budget (B3)

Caps, pre-approved: 1,000 non-test (the migration included), 1,800 test, 2,800 total, 40 files, 1 migration. Basis: `b3-measure.sh` (added plus deleted lines,
comment-only lines count, the readiness file excluded; the RO-L13-1 basis).

| Unit | Non-test | Test | Files |
|---|---|---|---|
| U1 + U1b 0069 (585 restated + about 45 header + 20 owner check + 115 cleanup + 15 comments) | about 780 | 0 | 1 |
| U2 + U3 new test files | 0 | about 900 | 2 |
| U4 pin lines (14 edited) | 0 | 28 | 3 |
| U5 TS validators and their tests | about 45 | about 170 | 10 |
| U6 web mirrors and their tests | about 35 | about 110 | 9 |
| this readiness file (excluded from the LOC basis) | | | 1 |
| Total | about 860 | about 1,210 | about 26 |

Total about 2,070; 1 migration (0069); modules packages/db and apps/web. Every cap holds (non-test at 86 percent: the 585 restated lines are fixed, the variance is in
the header and the cleanup). No B3 exception needed. Measured with `b3-measure.sh` before the PR; a crossed cap is a ruling request before the next writer starts.

## 15. OPEN

OUT_OF_SCOPE residue (none is an open question in scope):

- O1 bidi and control characters stay accepted where they are accepted today: P2 and M1 (host add), P3 (Zalo), P4 (Google), T1 (onboarding; T2 refuses Cc and Cf, so
  a club name can be created with a character it can no longer be set to). Refusing them on the Zalo path changes external-input behaviour: an owner decision; a backlog
  candidate. The chat author label renders inside `<bdi>` (`message-list.tsx:68-69`).
- O2 visible confusables (homoglyphs): backlog candidate (threat model).
- O3 spec follow-ups for the PR body, NOT edited: `git grep -n -i -E 'default.ignorable|variation selector|R1-5|ký tự ẩn|hidden char|invisible' -- docs/features
  docs/channels` finds `docs/features/BE/feature_user_settings_tech.md:212` (the persons.display_name rule: hidden characters refused; after L27 the 133 are stripped
  first) and `:457`, `:458` (dated changelog rows: never rewritten). A second query for venue_address and the club name with hidden or control wording finds nothing.
- O4 `tenant.ts:123-140` `tenantRepo.sessions.create` writes area and venue_name without the L23 strip (test-only callers): L23 residue.
- O5 memberships.display_name never follows a rename (existing behaviour).
- O6 two `DISPLAY_NAME_MAX` (120 in `me-settings.ts:20`, 100 in `roster-money-shared.ts:58`) and different length units per writer: unchanged by the negative scope.
- O7 `auth_login_google` caps no length and persons.display_name has no CHECK (existing).
- O8 the host-shell tenant-name source (`auth.ts` near `:285`) was not opened: a reader, not a writer; it does not change the inventory.

## 16. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the base = the worktree HEAD at step 0 (measured); every TARGET_FILES path exists at the base | PASS |
| 2 | Decisions in scope final | owner item 6 and the prompt line, verbatim (section 1); DD-138 at `decisions.md:1848`; B1-B9 pinned as defaults pending owner sign-off; A6 has no exception | PASS |
| 3 | Scope IN/OUT and owner clear | sections 3 and 10; the lane NEGATIVE SCOPE; section 15 residue; L24 runs beside on disjoint files | PASS |
| 4 | Dependencies classified | L23 on the base; L18 recommended, not on the base (flake listed); L26 not a code dependency; migration slot 0069 assigned | PASS |
| 5 | Live schema and code match | sections 2 and 3, measured at the base; three claims re-read by S0c | PASS |
| 6 | Data, API, state, auth contract | no new column, table, endpoint, error code, grant or owner; the seven definers keep signature, owner, ACL and attributes (RC-ACL, RC-BODY) | PASS |
| 7 | Fail-closed, idempotency, order | strip before every trim and check (B3); refusals unchanged; owner mismatch fails the migration (B7); the cleanup fails closed on visibility and its re-run is a no-op | PASS |
| 8 | Open questions in scope = 0 | A1-A6 derived, B1-B9 pinned; section 15 is out of scope | PASS |
| 9 | Acceptance matrix with expected results | section 6 (every writer x R1-R7) and section 11 test IDs | PASS |
| 10 | Migration, security, rollback | one migration in slot 0069; opus/max security round; rollback = revert before merge, after merge a migration restoring the previous bodies; stripped values are not restorable (0 rows at the base) | PASS |
| 11 | First slice hard dependencies merged | L23 (PR 97) on the base | PASS |
| 12 | Implementation handoff ready | sections 8-14; the worktree exists at the base, clean | PASS |

## 17. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-22
AUTHORITY_SHA: 5fb55e86d902c0c94fa7ff0db94ff6e1cdb62c6e
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md (authority: DD-138, read only; the item 6 record, expected DD-144, is not on this base)
  - packages/db/migrations/0017_oauth_transactions.sql (read only: live body of auth_login_google)
  - packages/db/migrations/0037_tenant_provision_rls_self_scope.sql (read only: live body of tenant_provision)
  - packages/db/migrations/0051_host_add_person_definer.sql (read only)
  - packages/db/migrations/0052_tenant_profile_definers.sql (read only)
  - packages/db/migrations/0053_zalo_ingress.sql (read only)
  - packages/db/migrations/0055_me_settings_definers.sql (read only)
  - packages/db/migrations/0058_player_self_join.sql (read only)
  - packages/db/migrations/0067_session_venue_visibility.sql (read only: projector)
  - packages/db/migrations/0068_public_name_invisible_chars.sql (read only: helper and pattern)
  - packages/db/src/text-safety.ts (header comment only)
  - packages/db/src/me-settings.ts
  - packages/db/src/me-settings.test.ts
  - packages/db/src/roster-service.ts
  - packages/db/src/roster-service.test.ts
  - packages/db/src/auth.ts
  - packages/db/src/auth.test.ts
  - packages/db/src/club-config-validation.ts
  - packages/db/src/club-config.test.ts
  - packages/db/src/session-service.ts
  - packages/db/src/session-service.test.ts
  - packages/db/src/zalo-ingress.test.ts
  - packages/db/src/text-safety.test.ts (read only: TX-ALL, TX-R4)
  - packages/db/src/public-name-invisible-chars.test.ts (read only: PS-PIN, PS-ACL)
  - packages/db/src/public-alias.test.ts (read only: A-12 stays green)
  - packages/db/src/identity-link-web.test.ts (read only: the tenant_admins prosrc scan stays green)
  - packages/db/src/migrate.test.ts (pin sites)
  - packages/db/src/rls-invariants.test.ts (pin sites)
  - packages/db/src/outbox-projector-registry.test.ts (pin sites)
  - apps/web/lib/me-settings-client.ts
  - apps/web/lib/me-settings-client.test.ts
  - apps/web/lib/club-settings-model.ts
  - apps/web/lib/club-settings-model.test.ts
  - apps/web/lib/new-club-form.ts
  - apps/web/lib/new-club-form.test.ts
  - apps/web/components/sessions/roster-add-player-form.tsx
  - apps/web/lib/session-form-model.ts
  - apps/web/lib/session-form-model.test.ts
  - apps/web/e2e/settings.spec.ts (verification)
  - apps/web/e2e/sessions.spec.ts (verification)
  - apps/web/e2e/roster.spec.ts (verification)
SLICE: p3-strip-invisible-member-names
IN_SCOPE: the L23 strip (one TS list in text-safety.ts, one web mirror in session-form-model.ts, one SQL helper in 0068) applied first, before each writer's existing trim and unchanged checks, on every writer of persons.display_name, memberships.display_name, tenants.name and sessions.venue_address: seven SQL definers re-created in 0069 with one substitution each (auth_login_google, create_host_added_person, zalo_identity_resolve, person_profile_update, create_guest_membership, tenant_provision, tenant_profile_update), five TS validator sites and five web mirrors; invisible-only values handled exactly as empty per writer; a migrate-time owner check; a one-time fail-closed cleanup of the four columns with re-projection of changed sessions; the source-scan writer guard; tests per decision-table row; the 14 migration pin lines
OUT_OF_SCOPE: chat message bodies and other free text; any normalisation beyond stripping (no NFC or NFKC, no case folding, no confusable mapping); an emoji exception; changes to the control, bidi, line-separator and U+2800 handling of any writer; who may write a name; new grants, owner changes or new SECURITY DEFINER functions or triggers; lengths and error codes; Zalo and DM copy; public_sessions beyond re-projection; Reviewed spec, decisions.md and backlog edits; the fixtures of section 3; PR 50
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: L23 (PR 97: migration 0068, stripInvisibleChars and the web mirror), merged and an ancestor of the base 5fb55e86d902c0c94fa7ff0db94ff6e1cdb62c6e
PRIOR_SLICES: L23 p3-public-name-invisible-chars (docs/sessions/web-mvp-phase3-readiness-p3-public-name-invisible-chars.md); L2 p3-session-text-control-chars (PR 61: text-safety.ts and the R1-5 default)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # one migration in slot 0069 (seven CREATE OR REPLACE with one substitution each, a migrate-time owner check, a fail-closed one-time cleanup with re-projection); opus/max security round
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: section 10 U1 - create packages/db/migrations/0069_member_name_invisible_chars.sql with the header, the L27-OWNER-CHECK block and the seven CREATE OR REPLACE re-creations (each the live body with its one substitution), apply it on a scratch DB under the lock, run the per-function pin tests of section 2 (the count and tail pins stay red until U4), commit in the worktree
REMAINING_BLOCKERS: none
```
