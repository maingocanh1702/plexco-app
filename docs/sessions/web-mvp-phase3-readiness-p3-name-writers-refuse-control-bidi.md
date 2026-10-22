<!-- review-readiness: code-ready -->

# Step-0 readiness: L29 p3-name-writers-refuse-control-bidi (session P3-S16g)

> Agent-facing. Readiness writers S0d1 (sections 1-8) and S0d2 (sections 9-17): opus/high. The facts were measured by the step-0 readiness reviewers S0a (SQL),
> S0b (TypeScript), S0c1 (web mirrors), S0c2 (web readers and e2e), S0e1 (SQL remainder) and S0e2 (rule sets and agreement tests), opus/high, whose notes live
> outside the repo in `status/P3-S16g-notes`; the design is the orchestrator's decision in the same directory (`design-decision.md`, conductor note A1), applied
> here unchanged. S0d1 re-read two of the notes' claims at the base (section 2). Writers: opus/max for the migration, its SQL tests, the writer guard and the
> SQL-versus-TS agreement (U1-U5); sonnet/high for the TypeScript validators and writers, the web mirrors and the DD entry (U6-U9). Code reviewer opus/max plus a
> separate opus/max security round (identity and PII writers, six re-created SQL definers and one new SQL function, external input, a data cleanup). RISK: P1.
> Lane contract: lane block L29 of the conductor-authored P3-S16g brief (not on main), authored under the owner's standing delegation of 2026-10-22 as conductor
> decision D3: a conductor decision, NEVER an owner signature; the owner can reverse it. It executes owner decision item 6
> (`status/OWNER-DECISIONS-2026-10-22.md:11`), verbatim as the lane block prints it: "Item 6 (invisible-character rule beyond the anonymous public surface): owner
> chose "a separate lane" (10:53). Extend the strip to the member-facing names (persons.display_name in the host roster, join-request inbox and chat author labels;
> tenants.name; memberships.display_name) and sessions.venue_address, including every writer (Zalo ingress definer and the others). Own lane, migration
> serialized, own review."
> Base `07bbe3482afec629456c4497f21a60a6d2fcef30` (origin/main at step 0: the merge of PR #104, with L27's 0069 as the migration tail); branch
> `feat/p3-name-writers-refuse-control-bidi`; worktree `.autopilot/worktrees/p3-name-writers-refuse-control-bidi`, clean at step 0 (measured: HEAD = base, empty
> porcelain). Migration slot 0070. Decision record DD-147. Every `path:line` below was measured at the base by the step-0 reviewers, except where marked (L27).
> Code points are written U+XXXX on purpose: this file holds no invisible byte.

## 1. Authority

- Lane block L29, authored by the conductor under the owner's standing delegation of 2026-10-22. The owner's words, verbatim: "chọn các option mang lại lợi ích
  long term và tối đa cho pj"; recorded as D3 in `status/P3-S16-conductor-decisions.md`. A conductor decision, NEVER an owner signature: the owner can reverse it.
  Every design item below (sections 4, 5, 7 and 8) is a Tier-B default, "default applied, pending owner sign-off", listed with its rejected alternatives in the
  PR body.
- Owner decision item 6: quoted verbatim in the header. The owner's prompt text for L27 (`status/CONDUCTOR-PROMPT-P3-S16.md:11`), verbatim as the lane block prints
  it: "extend the invisible and control code point strip to member-facing names (persons.display_name: host roster, join-request inbox, chat author labels;
  tenants.name; memberships.display_name) and sessions.venue_address, through every writer including the Zalo ingress definer; migration (next free number)
  serialized; clean stored values once like 0068; own review rounds, security-sensitive."
- What this lane closes: L27 delivered the INVISIBLE half (Default_Ignorable_Code_Point minus Bidi_Control stripped first at all 12 write paths) and left open,
  as this follow-up, O1 and T2 (control, bidi and line-separator code points still accepted by some writers) and M2 (an invisible-only source name copied as ''
  instead of NULL). This lane delivers the CONTROL half of the owner's own wording ("the invisible and control code point strip").
- The design is the orchestrator's (conductor note A1: "The design decision is yours within the lane block's bounds"), taken from `design-decision.md` items
  D1-D7 without change; where this file states a consequence the design leaves implicit, it says so.
- Decision record: DD-147 (unit U9; owner-facing Vietnamese prose in `docs/standards/decisions.md`, provenance "decided by the conductor under the owner's
  delegation of 2026-10-22 (D3), not an owner signature"). It builds on DD-144 (item 6, L27) and the L23 decision (the 0068 strip helper and the every-scalar
  agreement precedent). Review per DD-122 D4 (Codex waived by the owner 2026-10-12): an independent code reviewer plus a security reviewer.
- Dependencies: L27 is on the base (hard: it owns the strip helper's member-name use, the seven re-created definers, the writer guard test and the migration
  tail; tail measured 0069). L31 (P3-S16h, the zalo_dm delivery age check) may run beside this lane on disjoint files; this lane holds the migration number.
  PR #50 stays untouched.
- Negative scope (lane block, unchanged): no homoglyph or confusable work; no change to the strip set, the emoji rule (ZWJ and VS16 stripped, no exception:
  conductor decision D4 of P3-S16), the length limits or the L23 public-name semantics; no new table or column; no change to what Zalo ingress or Google sign-in
  accept as a request (a name never blocks an identity); no change to the identity-merge or person-equality logic; no edit of a Reviewed spec except through the
  DD entry; no enabling of anything.

## 2. Measured at base

| Fact | Evidence (at the base) |
|---|---|
| Worktree: HEAD = `07bbe3482afec629456c4497f21a60a6d2fcef30` = the brief's base, branch `feat/p3-name-writers-refuse-control-bidi`, empty porcelain; the base commit is "Merge pull request #104" (a dependency-floor chore) | S0a, S0b, S0c1, S0e1, S0e2; re-read by S0d1 (`git rev-parse HEAD`, `git log -1`) |
| Migration tail `0069_member_name_invisible_chars.sql` (L27); next free number 0070 | `ls packages/db/migrations` (S0a, S0e1, S0d1) |
| Rule sets compared scalar by scalar over 1,112,064 scalars (U+0000-U+10FFFF minus surrogates; the script imports nothing from the repo): TS `hasHiddenChar` 245 vs SQL `c_reject` 244, the only difference U+0000 (TS-only: PostgreSQL text cannot hold it, 22021); `hasVisibleChar` vs `c_visible` 1,107,866 each, none differ; `stripInvisibleChars` and `STRIP_CHAR_RANGES` vs `public_name_strip_invisible` 4,162 each, none differ (= runtime Default_Ignorable_Code_Point minus Bidi_Control); JS trim and the JS whitespace class vs `c_ws` 25 each, none differ; JS trim vs PostgreSQL `btrim`/`trim` without a characters argument 25 vs 1 (U+0020 only); the composed rule (strip, trim, then empty, hidden or no visible character), alone and as a+c+b, TS vs `person_profile_update` 4,291 / 112 vs 4,290 / 111, the only difference U+0000 | S0e2 section 1. SQL constants `0069:441-461` (byte-identical at `0055:104-124`, `0060:85-105`, `0068:91-111`; cleanup `c_ws`/`c_visible` `0069:716-722` = `0068:191-197`); helper `0068:50-63`; TS `text-safety.ts:37`, `:52-69`, `:82-96`, `:107`, `:110-117` |
| Among the 0069 definers only P1 `person_profile_update` applies `c_reject` and `c_visible`; P2 `:328` (`btrim`), P3 `:359` (`btrim`, `nullif`), P4 `:217` (`trim`), T1 `:577`, `:585` (`trim`) and T2 `:663` (`btrim`) apply only the strip, a U+0020 trim and their length checks; M2 `:514` copies the strip of the source alone | S0a, S0e2 |
| Design facts: 0069 `c_visible` counts U+2800 as VISIBLE; a bidi-only value is not '' after the strip and the trim yet has no visible character, so the "no visible character" test must be `c_visible`-shaped, not "empty after strip and trim" | S0e1 section 1 (controls) |
| Q5 counts (counts only, never values; container plexco-postgres-1 healthy; sandbox off; plexco_test never touched): plexco_smoke has 69 migrations applied, last 0068 (0069 is NOT applied there): persons.display_name 27 rows / 27 non-null, memberships.display_name 39 / 26, tenants.name 13 / 13, sessions.venue_address 23 / 23, and 0 in every class (Cc, bidi, separator, empty, blank or invisible-only, no visible character, U+2800-only, NBSP or U+3000-only). plexco (dev) has 32 applied, last 0031: 0 rows in each table (the strip emulated inline; on smoke the emulation equals the helper on every row). Five literal control values each hit exactly their class on both DBs. Production cannot be measured here | S0e1 section 1 |
| Node and Unicode: local `node v25.6.0`, `unicode 17.0`, `icu 78.2`; the SQL sets are explicit code-point lists whose comments say Unicode 17.0 (`0068:16`, `0069:24`, `text-safety.ts:41-42`); CI runs node-version 22 (`ci.yml:63`, `:123`; engines `^22.13.0 or >=24`), whose ICU Unicode version is NOT measured; the TS sets rest on runtime property classes (Cf, Default_Ignorable_Code_Point, whitespace), so tests compare sets with each other and never pin Unicode-17 counts | S0e2 header and OPEN |
| Identity decisions of the ingress definers: P4 `auth_login_google` `0069:104-288`: `p_display_name` occurs only at `:110` (signature) and `:217` (the value of the new-person INSERT, after the branch is chosen). P3 `zalo_identity_resolve` `0069:341-425`: `p_display_name` only at `:343` and `:359`, `v_name` only at `:359` and `:387` (the INSERT value); the returned display_name is the stored value (`:422`). PROVEN: the name never enters either decision | S0e1 section 3 |
| U+0000 at the Zalo bind (from PostgreSQL semantics, not run): `scalar(from.display_name)` (`process-event.ts:68-73`, `:90`) passes a Zalo name unchanged to the `zalo_identity_resolve` bind (`zalo-ingress.ts:184-186`); PostgreSQL rejects U+0000 in text at parameter input (22021) before the definer runs, so a SQL-only normalization cannot make P3 never raise | S0b Q4 |
| Existing every-scalar agreement tests: PS-PIN `public-name-invisible-chars.test.ts:186-202` (one `generate_series` query, `120_000`); TX-ALL `text-safety.test.ts:15-27`; `me-settings.test.ts:170-195` (one call per code point over derived subsets); web `club-settings-model.test.ts:82-98`, W7 `session-form-model.test.ts:465-480`, SF-PIN `:608-629` (each `30_000`). No test compares SQL `c_reject`/`c_visible` with TS over every scalar (they are PL/pgSQL locals); apps/web has no `testTimeout` (5 s default) | S0e2 section 2, S0c1 section 6 |
| Tail pin sites: 14 lines in 3 files, the lines L27 listed: `migrate.test.ts:53`, `:769`; `rls-invariants.test.ts:70`, `:73`, `:1841`, `:1846`, `:2124`, `:4717`, `:4719`, `:4720`; `outbox-projector-registry.test.ts:114`, `:115`, `:117`, `:120` (count 70 to 71, tail 0069 to 0070). Must NOT move: `member-name-writer-guard.test.ts:138` (`CLEANUP` = 0069), `member-name-invisible-chars.test.ts:412`, `:812` | S0e1 section 2 |
| GitNexus impact upstream on the seven SQL definers: "Target not found" (SQL is not indexed: risk UNKNOWN). Grep fallback: exactly one production call site each: `roster-service.ts:120`, `zalo-ingress.ts:185`, `oauth-transaction.ts:297`, `session-join-service.ts:325`, `auth.ts:203`, `club-config.ts:121`, `me-settings.ts:171` | S0e1 section 4 |
| S0d1 spot-checks (2 claims, re-read at the base): (1) P1's constants: `c_ws` `0069:441`, `c_space` `:442`, `c_reject` `:445-454` (comment `:443-444`), `c_visible` `:457-461`; NULL check `:463-466`; trim `:467` (a regexp_replace of the strip anchored on `c_space`); refusal `:468-471` (char_length 1..120, `c_reject`, `c_visible`, 22023): as S0a and S0e2 state (`design-decision.md` cites the literals as `0069:441-469`, a range that also spans the trim and the first refusal lines). (2) `0069:359` is `v_name text := left(nullif(btrim(public.public_name_strip_invisible(p_display_name)), ''), 120);` in P3's DECLARE, before `BEGIN` at `:360`: as S0a and S0e1 state | `sed -n` at the base |
| DD numbering: `grep -c DD-147 docs/standards/decisions.md` prints 0; DD-140 to DD-145 are present and DD-146 is absent at the base (the notes do not say which lane holds it; the brief assigns DD-147 to this lane) | S0d1 grep |

## 3. Writer inventory and behaviour today (Q1)

12 write paths, L27's inventory re-verified at this base: persons.display_name P1-P5, memberships.display_name M1-M3, tenants.name T1-T2, sessions.venue_address
V1-V2. SQL: 8 definers, 7 carry a name (P5 writes NULL only; M3 is inside T1). Direct TS writers: M1 (`roster-service.ts:126`), V1 and V2 (`session-service.ts`).
No writer outside the inventory was found (S0a, S0b, S0c1). The three lead claims are CONFIRMED in all three layers: Cc, Bidi_Control and U+2028/U+2029 are
still accepted by P2/M1, P3, P4, T1 and T2's SQL; non-default-ignorable blank-only values (NBSP, U+3000, U+2800) are stored non-empty by P2, P3, P4, T1 and T2's
SQL; M2 copies an invisible-only name as ''.

Legend: REF refused with the writer's error; keep = stored as sent after the strip; ACC accepted; PASS = no check at this layer, the value goes on unchanged;
n/a = no input at this layer (reason in the cell). Blank-only = only Zs blanks (U+00A0, U+1680, U+2000-U+200A, U+202F, U+205F, U+3000) or only U+2800 after the
strip. Edge = U+0009-U+000D, U+2028 or U+2029 at the start or end.

| Writer and layer (file:line) | Cc | Bidi_Control | U+2028/U+2029 | blank-only (Zs; U+2800) | invisible-only | ordinary |
|---|---|---|---|---|---|---|
| P1 SQL `person_profile_update` `0069:429-483` (ACL `0055:147-148`) | REF 22023 inside (`c_reject` `:446`); edge trimmed (`c_ws` `:441`) | REF 22023 (`:447-448`) | REF 22023 inside (`:451`); edge trimmed | Zs: trimmed to '', REF 22023; U+2800: REF (`:453`) | '' then REF 22023 | stored trimmed |
| P1 TS `validateDisplayName` `me-settings.ts:35-43` (via `updateMyProfile` `:130`, `:136`; SQL call `:171`) | REF `DisplayNameError`, U+0000 too; edge trimmed | REF | REF inside; edge trimmed | Zs: REF (empty); U+2800: REF | REF | stored trimmed |
| P1 web `displayNameProblem` `me-settings-client.ts:114-123` (hidden copy `:119`, visible `:122`) | REF invalid_chars; edge trimmed | REF invalid_chars | REF inside; edge trimmed | Zs: REF empty; U+2800: REF invalid_chars | REF empty | no error |
| P2 SQL `create_host_added_person` `0069:292-337` (`btrim` `:328`, 22023 `:329-331`; ACL `0051:64-65`) | keep | keep | keep | Zs: keep (`btrim` removes U+0020 only); U+2800: keep | REF 22023 | stored |
| P2 TS `addMemberToSession` `roster-service.ts:110-126` (strip `:113`; `isBoundedText` 1..100, NUL and lone surrogate only, `roster-money-shared.ts:64-76`; `INVALID_INPUT` `:114-115`) | U+0000 REF; the rest ACC | ACC | ACC inside; edge trimmed | Zs: REF (trim empty); U+2800: ACC | REF | stored trimmed |
| P2 web `roster-add-player-form.tsx:53-58` (strip and trim `:54`, UTF-16 1..100 `:55`; no unit test) | ACC | ACC | ACC inside; edge trimmed | Zs: REF, the length pair; U+2800: ACC | REF, the length pair | no error |
| M1 SQL | n/a: direct insert | n/a: direct insert | n/a: direct insert | n/a: direct insert | n/a: direct insert | n/a: direct insert (no definer, no CHECK) |
| M1 TS `roster-service.ts:126` (the P2 value) | as P2 TS | as P2 TS | as P2 TS | as P2 TS | as P2 TS | as P2 TS |
| M1 web | as P2 web | as P2 web | as P2 web | as P2 web | as P2 web | as P2 web |
| P3 SQL `zalo_identity_resolve` `0069:341-425` (DECLARE `:359`, INSERT `:387`; ACL `0053:263-264`) | keep | keep | keep | Zs: keep (non-empty); U+2800: keep | NULL | stored, cut to 120 |
| P3 TS `resolveZaloIdentity` `zalo-ingress.ts:172-201` (from `process-event.ts:129-136`) | PASS; U+0000 fails at the bind (22021, inferred) | PASS | PASS | PASS | PASS | PASS |
| P3 web | n/a: Zalo payload | n/a: Zalo payload | n/a: Zalo payload | n/a: Zalo payload | n/a: Zalo payload | n/a: no form |
| P4 SQL `auth_login_google` `0069:104-288` (INSERT value `:217`; ACL `0017:477-478`) | keep | keep | keep | Zs: keep; U+2800: keep | NULL | stored, no length cap (O7) |
| P4 TS `loginGoogle` `oauth-transaction.ts:283-314` (`$6` `:304`; production sends NULL, `route.ts:190-196`, DD-26; dev fixtures `persona-account.ts:58-64`) | PASS | PASS | PASS | PASS | PASS | PASS |
| P4 web | n/a: no form | n/a: no form | n/a: no form | n/a: no form | n/a: no form | n/a: no form |
| P5 all layers `channel_identity_detach` `0055:167` (`me-settings.ts:228-234`) | n/a: NULL only | n/a: NULL only | n/a: NULL only | n/a: NULL only | n/a: NULL only | n/a: writes the literal NULL |
| M2 SQL `create_guest_membership` `0069:487-556` (copy `:514`, INSERT `:534-535`; ACL `0058:101-102`; no catalog pin) | copied | copied | copied | Zs: copied non-empty; U+2800: copied | '' (the gap) | copied; a NULL source stays NULL |
| M2 TS `mintGuestMembership` `session-join-service.ts:319-329` (call `:325`; callers `:430`, `join-request-service.ts:352`) | n/a: no name argument | n/a: no name argument | n/a: no name argument | n/a: no name argument | n/a: no name argument | n/a: the copy is SQL-only |
| M2 web | n/a: no form | n/a: no form | n/a: no form | n/a: no form | n/a: no form | n/a: no form |
| M3 all layers (owner membership in `tenant_provision`) | n/a: no name | n/a: no name | n/a: no name | n/a: no name | n/a: no name | n/a: writes no display_name |
| T1 SQL `tenant_provision` `0069:561-642` (22023 'name required' `:577-578`, stores `:585`; CHECK `tenants_name_len_chk` `0039:130`; ACL `0037:171-172`) | keep | keep | keep | Zs: keep (`trim` removes U+0020 only); U+2800: keep | REF 22023 'name required' | stored; above 120: 23514 |
| T1 TS `api/onboarding/start/route.ts:57-91` (strip and trim `:65`, UTF-16 1..120 `:74-79`, 400 `INVALID_BODY` `:82-83`) then `provisionTenant` `auth.ts:198-216` (maps only 23505 `:213`; other errors become a 500) | ACC inside; U+0000 reaches PostgreSQL (expected 500, not run); edge trimmed | ACC | ACC inside; edge trimmed | Zs: REF; U+2800: ACC | REF | stored |
| T1 web `validateNewClub` `new-club-form.ts:48-58` | ACC | ACC | ACC inside; edge trimmed | Zs: REF empty; U+2800: ACC | REF empty | no error |
| T2 SQL `tenant_profile_update` `0069:646-707` (`btrim` `:663`, 22023 `:683-685`, NULL keeps the name `:699`; ACL `0052:125-126`) | keep (only TS refuses Cc and Cf) | keep | keep | Zs: keep; U+2800: keep | REF 22023 | stored; NULL keeps the name |
| T2 TS `validatePatch` `club-config-validation.ts:62-70` (inline Cc/Cf regex `:68`; `INVALID_INPUT` `:46`, `:69`) | REF | REF (Cf) | ACC inside (Zl and Zp are not Cc or Cf); edge trimmed | Zs: REF; U+2800: ACC | REF | stored |
| T2 web `clubNameProblem` `club-settings-model.ts:36-41` (Cc/Cf regex `:40`) | REF invalid_chars | REF invalid_chars | ACC inside; edge trimmed | Zs: REF empty; U+2800: ACC | REF empty | no error |
| V1/V2 SQL | n/a: direct writes | n/a: direct writes | n/a: direct writes | n/a: direct writes | n/a: direct writes | n/a: direct writes (insert `session-service.ts:336`, update `:1488-1490`; no CHECK) |
| V1/V2 TS `session-service.ts` (strip `:124-136`; shared `isOptionalText` `:141-142` checks the stripped, UNTRIMMED value; `isOptionalVenueAddress` `:145-146`; `INVALID_TEXT_FIELD` `:249-253`, `:1349-1353`) | REF, edges too (no trim) | REF | REF, edges too | Zs: ACC, stored as sent; U+2800: REF | ACC, stored '' | stored as sent |
| V1/V2 web `validateForm` `session-form-model.ts:234-247` (hidden check `:243` over the strip-and-trim key; blank sent as NULL `:166`; an unchanged loaded value exempt `:177-185`) | REF hidden; edge trimmed | REF hidden | REF inside; edge trimmed | Zs: sent as NULL; U+2800: REF hidden | sent as NULL | no error |

Gaps today: SQL: only P1 refuses; P2, P3, P4, T1 and T2 keep every class; M2 copies them and copies an invisible-only source as ''. TS: P2/M1 and T1 accept Cc
(except U+0000 at P2), Bidi_Control, separators and U+2800; T2 accepts separators and U+2800, so T1 and T2 disagree (a club name can be CREATED with a character
it can no longer be SET to); V stores a Zs-only address as sent and an invisible-only one as ''; P3 passes U+0000 into the bind. Web: P2/M1 and T1 have no hidden
check; T2 lacks Zl, Zp and U+2800. Readers: the chat author label renders inside `<bdi>` (`message-list.tsx:67-71`), which isolates the label from its neighbours
only; an override inside the label still reorders the label itself, and an NBSP, U+3000 or U+2800-only label is truthy and renders a blank `<bdi>` (S0c2).

Existing shared constants and twins: 0055 `c_ws`, `c_space`, `c_reject`, `c_visible` (byte-identical in 0060, 0068 and 0069 P1); the 0068 helper
`public.public_name_strip_invisible(text)` (`0068:50-63`, owner-only, ACL `0068:65`); 0069 creates no helper (header `0069:56-59`) and asserts the seven
definers' owner (`0069:66-99`). TS `text-safety.ts`: `STRIP_CHAR_RANGES` `:52-69`, `stripInvisibleChars` `:82-96`, `hasHiddenChar` `:110-112` (`HIDDEN_CHAR`
`:37`), `hasVisibleChar` `:115-117` (`VISIBLE_CHAR` `:107`). Web copies: `session-form-model.ts:101-103` (hidden), `:113-130` (ranges), `:145-158` (strip);
inline copies `me-settings-client.ts:119`, `:122`; the narrower Cc/Cf regex `club-settings-model.ts:40`; the visible alias `:70`.

## 4. Code point classes (D1)

No new set: the rule is the one P1 already enforces in all three layers, measured equal over every scalar (section 2).

| Set | Definition | SQL | TS | Web | Measured |
|---|---|---|---|---|---|
| S strip | Default_Ignorable_Code_Point minus Bidi_Control, Unicode 17.0, 16 ranges (L27, unchanged) | `public_name_strip_invisible` `0068:50-63` | `STRIP_CHAR_RANGES`, `stripInvisibleChars` | `session-form-model.ts:113-130`, `:145-158` | 4,162, equal |
| T trim | ECMAScript WhiteSpace plus LineTerminator: U+0009-U+000D, U+0020, U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF | `c_ws` `0069:441` (`c_space` `:442`) | JS trim | JS trim | 25, equal |
| R refused | Cc, Cf (which holds all 12 Bidi_Control), Zl and Zp (U+2028, U+2029), the default-ignorable code points that are not variation selectors, and U+2800 (the `0069:443-444` comment); members of S among them are stripped first and so moot | `c_reject` `0069:445-454` | `hasHiddenChar` | `hasHiddenChar` `session-form-model.ts:101-103` | SQL 244, TS 245: U+0000 is TS-only, a named exception (PostgreSQL text cannot hold it) |
| V visible | at least one code point outside T and outside every default-ignorable range (all 17, variation selectors and Bidi_Control included) | `c_visible` `0069:457-461` | `hasVisibleChar` | copy `me-settings-client.ts:122` | 1,107,866, equal |

| Class | Members | In S | In T | In R | Counts as V | Interactive writer | Ingress and copy writer |
|---|---|---|---|---|---|---|---|
| Cc | 65: U+0000-U+001F, U+007F-U+009F | no | 5 (U+0009-U+000D) | 64 in SQL, 65 in TS | 60 do | REFUSED | NORMALIZED (removed) |
| Bidi_Control | 12: U+061C, U+200E, U+200F, U+202A-U+202E, U+2066-U+2069 | no | no | all 12 | none | REFUSED | NORMALIZED (removed) |
| Line and paragraph separators | U+2028, U+2029 | no | yes | yes | no | REFUSED inside; trimmed at the edges | NORMALIZED (removed inside, trimmed at the edges) |
| Zs blanks | 16: U+00A0, U+1680, U+2000-U+200A, U+202F, U+205F, U+3000 | no | yes | no | no | trimmed at the edges, allowed inside; a value made only of them has no V character: REFUSED | trimmed at the edges, allowed inside; only them: NULL |
| U+2800 | BRAILLE PATTERN BLANK (So) | no | no | yes | yes | REFUSED anywhere | removed; only it: NULL |
| Other members of R | the non-default-ignorable Cf (for example U+0600-U+0605, U+06DD, U+070F, U+0890-U+0891, U+08E2, U+FFF9-U+FFFB, U+110BD, U+110CD, U+13430-U+1343F) | no | no | yes | yes | REFUSED (as P1 refuses them today) | NORMALIZED (removed) |
| Invisible | S, 4,162 (ZWJ and VS16 included, no exception) | yes | U+FEFF only | partly (moot) | no | stripped first (L27, unchanged) | stripped first (L27, unchanged) |
| U+3164, U+FFA0 | Hangul fillers | yes | no | yes (moot) | no | stripped (L27, unchanged) | stripped (L27, unchanged) |

- U+2800 and the Zs blanks are decided by measurement, not by instinct: U+2800 is in R (refused anywhere by P1 and by the web hidden check today) although V
  counts it visible, so R, not V, catches a U+2800-only value; a Zs-only value is empty after T, so V catches it.
- Order, interactive (P1, P2/M1, T1, T2, V1, V2): strip S, trim T, then REFUSE when the result contains an R code point or has no V character; otherwise the
  result is the value, and each writer's existing length check runs on it. Order, ingress and copy (P3, P4, M2): strip S, trim T, remove every R code point, trim
  T again, NULL when no V character remains; then each writer's existing length handling (P3 cuts to 120 AFTER the normalization). Removal joins the text on
  either side (an inner U+2028 between two words leaves the words joined); S0b's alternative, mapping whitespace-like controls to U+0020, is not part of D2.
- Edge rule (as P1 today: the trim at `0069:467` runs before the refusal at `:468`): an R code point that is also in T (U+0009-U+000D, U+2028, U+2029) is
  trimmed away at the edges (never stored) and refused or removed inside. Section 7 carries it as its own column.
- Unicode: the SQL lists and `STRIP_CHAR_RANGES` are explicit code points (Unicode 17.0); the TS hidden and visible tests rest on runtime property classes, so
  every new test compares the sets with each other (SQL function against the TS functions, TS against each web mirror), never against Unicode-version counts.

## 5. Choke-point design decision (D3)

| Alternative | Re-created definers | Restated SQL lines | New objects | Outcome against the tie-breaks |
|---|---|---|---|---|
| **Chosen: one new SQL function, six definers re-created to call it, P1 untouched** | 6: P2, T1, T2 in mode false; P3, P4, M2 in mode true | about 530 (S0a: P2 46, T1 82, T2 62, P3 85, P4 185, M2 70) plus about 180 for the function, the owner check, the cleanup and the header (D7 B3) | 1 function | fail-closed: every interactive writer refuses, P1 keeps refusing, no ingress writer raises; one source of truth: R, V and T held once in the function, byte-pinned to P1's copy; fewest concepts: one object; precedent: the 0068 helper shape and 0069's re-creation of the definers; reversible: a later migration re-creates the 0069 bodies from git and drops the function, no table, column or constraint changes |
| (a) re-create all seven with the rule inline | 7 | about 585 plus the owner check | 0 | loses one source of truth (seven copies of R, V and T) and precedent: re-creating P1 breaks the A-12 pin (`public-alias.test.ts:524`, P1's constants byte-equal to `tenant_public_alias_set`'s, L27) and the lane forbids moving L23 and L27 pins; it needlessly touches P1 |
| (b) change the shared 0068 helper | 0 | about 20 | 0 | loses fail-closed and the lane bounds: it changes the strip set and L23's public-name semantics (the lane's STOP condition; `tenant_public_alias_set` calls it at `0068:136`), PS-PIN breaks, P1 would normalize instead of refuse (a NULL sentinel instead would let P1 and T2 report success without a write), and M2 would still copy '' |
| (c) two new functions, one refusing and one normalizing | 6 | about 530 plus two functions | 2 | loses fewest concepts and one source of truth: two copies of the constants, or one function calling the other, for the same restated lines |
| (d) CHECK or domain backstop | P3, P4 and M2 still re-created to normalize first (about 340) | not measured | a constraint per column, or a domain | loses fail-closed at ingress (raises 23514 at P3 and P4, blocking an identity) and the error shape (23514, not 22023); cannot give M2 NULL; a CHECK calling the owner-only function fails the direct app writers M1, V1 and V2 (EXECUTE is checked for the current user), and an inline-regex CHECK is a second definition (threat 6); a table constraint change that needs the cleanup or NOT VALID first; a domain is a column type change |
| (e) BEFORE triggers | 0, plus the writers that must stop nulling | not measured | trigger functions and triggers | loses fail-closed (L27 section 4): a trigger cannot tell writers apart, runs after each writer's own checks, and its return value diverges from what P3 returns |
| (f) rename plus a thin wrapper around P3 and P4 to avoid restating their bodies | 6 | fewer | six extra definer objects with owner, ACL and catalog pins | loses fewest concepts and precedent: renamed functions keep their grants, no precedent |

The chosen function and its pins:

- Name and signature (chosen here; the design's example): `public.member_name_apply_rule(p_value text, p_external boolean) RETURNS text`.
- Attributes: STRICT, IMMUTABLE, PARALLEL SAFE, SECURITY INVOKER, `SET search_path = pg_catalog` (the 0068 helper's attributes, `0068:50-63`); the body calls the
  helper schema-qualified. LANGUAGE plpgsql (a Tier-A detail, precedent A-12): its four constants are DECLARE constants byte-identical to P1's lines
  `0069:441-461`, compared the way A-12 compares `tenant_public_alias_set`'s with P1's. It contains no RAISE.
- Mode false (interactive): returns the strip-and-trim result, or NULL when that result contains an R code point or has no V character; the calling definer
  raises its own 22023 with its existing message on NULL. Mode true (ingress and copy): returns the normalized value of section 4, or NULL when no V character
  remains; it never raises. STRICT: a NULL value returns NULL (P3, P4 and M2 keep NULL; T2 tests its argument before the call, so a NULL argument still keeps the
  name, and a non-NULL argument whose result is NULL is refused).
- Owner: the owner of the 0068 helper, asserted at migrate time in 0069's owner-check pattern (`0069:66-99`, 42501), extended to the new function and the six
  re-created definers. ACL: `REVOKE ALL ... FROM PUBLIC, app, app_worker, readonly` (the `0068:65` shape) and no grant: owner-only EXECUTE; the definers call it
  as their owner.
- The six re-created definers: CREATE OR REPLACE keeps owner and ACL (REVOKE ALL FROM PUBLIC plus GRANT EXECUTE TO app, unchanged) and resets every omitted
  attribute (`0068:73-75`), so each restates SECURITY DEFINER, its live volatility and its search_path unchanged: `public, pg_temp` for P4
  `auth_login_google` and T1 `tenant_provision`; `pg_catalog, public, pg_temp` for P2, P3, T2 and M2. Only the named expressions change: P2 `:328`, P3 `:359`,
  P4 `:217`, M2 `:514`, T1 `:577-578` and `:585`, T2 `:663` with its test `:683-685`. The bodies are restated mechanically by a generator script that copies their
  0069 line ranges and applies only the named edits (the L27 u1-gen-definers precedent); the RC, ACL and OWNER pins (L27 pattern) prove it.
- P1 `person_profile_update` is NOT re-created: it already enforces the rule, A-12 keeps its constants byte-identical, and the lane forbids moving L23 and L27
  pins. Its constants are the reference copy the new function's byte-identity test compares with.
- Why six definers are re-created rather than one shared function changed: the only function every writer already calls, `public_name_strip_invisible`
  (0068), also serves L23's public alias and P1 and is pinned scalar by scalar (PS-PIN), so changing it would change the strip set and the L23 public-name
  semantics (the STOP condition), turn P1's refusal into a silent normalization (fail-open) and still leave M2 copying ''; a new function takes effect in a
  definer only through a CREATE OR REPLACE of that definer's body, so each of the six writers whose behaviour must change is re-created once, to call it.
- Tie-breaks, in order: fail-closed (a wrong deny on a typed name is recoverable, a wrong allow of a bidi override is not; a hostile external name is never a
  deny); one source of truth (one SQL function plus P1's byte-pinned reference, one TS check and normalizer, every-scalar agreement between the layers); fewest
  concepts (one object); precedent (0068 helper shape, 0069 re-creation, A-12, PS-PIN); reversible (one later migration). The 10x test: with ten times the
  writers, each new writer calls one function and the extended writer guard fails one that does not.

## 6. Threat model (stated here and in the 0070 header)

Defends against:

1. bidi-override name spoofing on rosters, join-request inboxes, chat author labels and club names (a `<bdi>` wrapper does not stop an override inside the
   label);
2. control and separator code points breaking single-line fields, logs and exports;
3. blank-looking names impersonating "nobody" or hiding a person (Zs-only, U+2800-only, bidi-only and invisible-only values);
4. writer inconsistency: create versus set (T1 versus T2), SQL versus TypeScript versus web;
5. a hostile external display name (Zalo, Google) blocking sign-in or identity resolution: it is normalized, never raised, U+0000 at the Zalo bind included;
6. a second definition of the rule drifting from the first: one SQL function byte-pinned to P1, one TS check and one TS normalizer, web mirrors pinned over
   every scalar.

Not defended (named, backlog): homoglyphs and confusables (L27 O2). Residual risks: a writer missed by the inventory (the extended writer guard fails a writer
of the four columns that does not apply the rule) and stored production values that cannot be measured here (the guarded cleanup, section 8).

## 7. Decision table after the lane

Cells: REFUSED = the writer's existing error shape (SQL 22023 with the writer's existing message; TS the writer's existing error code; web a real t(vi, en)
pair); NORMALIZED = the class removed inside or trimmed at the edges and the rest stored; NULL = stored NULL; unchanged = today's behaviour kept; n/a = no input
at this layer (reason given); "(was ...)" names the change from section 3. Blank-only covers both Zs-only and U+2800-only values; "edge" is section 4's edge rule.
Web pairs: the name pair t("Tên không được chứa ký tự điều khiển hoặc ký tự ẩn.", "The name cannot contain control or hidden characters.")
(`settings-profile-form.tsx:58-59`, `club-profile-form.tsx:71-72`), newly wired at P2/M1 and T1 so that create and set say the same thing; P1, T2 and V keep
their own pairs; the address pair is t("Địa chỉ không được chứa ký tự điều khiển hoặc ký tự ẩn.", "The address cannot contain control or hidden characters.").

| Writer and layer | Cc | Bidi_Control | U+2028/U+2029 | blank-only | invisible-only | ordinary | edge |
|---|---|---|---|---|---|---|---|
| P1 SQL `person_profile_update` (not re-created) | REFUSED 22023 (unchanged) | REFUSED 22023 (unchanged) | REFUSED 22023 inside (unchanged) | REFUSED 22023 (unchanged) | REFUSED 22023 (unchanged) | stored trimmed (unchanged) | NORMALIZED: trimmed, never stored (unchanged) |
| P1 TS `validateDisplayName` (moves to the shared check only if that costs at most 3 lines; pinned equal by test either way) | REFUSED `DisplayNameError`, U+0000 included (unchanged) | REFUSED (unchanged) | REFUSED inside (unchanged) | REFUSED (unchanged) | REFUSED (unchanged) | stored trimmed (unchanged) | NORMALIZED: trimmed (unchanged) |
| P1 web `displayNameProblem` | REFUSED invalid_chars (unchanged) | REFUSED invalid_chars (unchanged) | REFUSED inside (unchanged) | REFUSED: Zs empty, U+2800 invalid_chars (unchanged) | REFUSED empty (unchanged) | no error (unchanged) | NORMALIZED: trimmed (unchanged) |
| P2 SQL `create_host_added_person` (re-created, mode false) | REFUSED 22023 (was kept) | REFUSED 22023 (was kept) | REFUSED 22023 (was kept) | REFUSED 22023 (was kept) | REFUSED 22023 (unchanged) | stored, the strip-and-trim result; 1..100 unchanged (was trimmed of U+0020 only) | NORMALIZED: trimmed (was kept) |
| P2 TS `addMemberToSession` (the shared TS check) | REFUSED `INVALID_INPUT` (was accepted except U+0000) | REFUSED `INVALID_INPUT` (was accepted) | REFUSED inside (was accepted) | REFUSED: Zs (unchanged), U+2800 (was accepted) | REFUSED (unchanged) | stored trimmed (unchanged) | NORMALIZED: trimmed (unchanged) |
| P2 web `roster-add-player-form.tsx` (the web hidden check; a problem kind replaces its boolean) | REFUSED, the name pair (was accepted) | REFUSED, the name pair (was accepted) | REFUSED inside, the name pair (was accepted) | REFUSED: Zs the length pair (unchanged), U+2800 the name pair (was accepted) | REFUSED, the length pair (unchanged) | no error (unchanged) | NORMALIZED: trimmed (unchanged) |
| M1 SQL | n/a: direct insert (`roster-service.ts:126`) | n/a: direct insert | n/a: direct insert | n/a: direct insert | n/a: direct insert | n/a: direct insert, no CHECK | n/a: direct insert |
| M1 TS (the P2 value) | as P2 TS: no person and no membership row | as P2 TS | as P2 TS | as P2 TS | as P2 TS | as P2 TS | as P2 TS |
| M1 web (the P2 form) | as P2 web | as P2 web | as P2 web | as P2 web | as P2 web | as P2 web | as P2 web |
| P3 SQL `zalo_identity_resolve` (re-created, mode true, then `left(..., 120)`) | NORMALIZED: removed (was kept) | NORMALIZED: removed (was kept) | NORMALIZED: removed (was kept) | NULL (was kept non-empty) | NULL (unchanged) | stored, cut to 120 after the normalization (unchanged) | NORMALIZED: trimmed (was kept) |
| P3 TS `resolveZaloIdentity` (the shared TS normalizer before the call) | NORMALIZED: removed, U+0000 included (was passed; U+0000 failed the bind) | NORMALIZED: removed (was passed) | NORMALIZED: removed (was passed) | NULL (was passed) | NULL (was passed) | passed (unchanged) | NORMALIZED: trimmed (was passed) |
| P3 web | n/a: Zalo payload, no form | n/a: no form | n/a: no form | n/a: no form | n/a: no form | n/a: no form | n/a: no form |
| P3 ingress never raises | resolves, same identity, name normalized | resolves, same identity, name normalized | resolves, same identity, name normalized | resolves, same identity, name NULL | resolves, same identity, name NULL | resolves (unchanged) | resolves, same identity |
| P4 SQL `auth_login_google` (re-created, mode true) | NORMALIZED: removed (was kept) | NORMALIZED: removed (was kept) | NORMALIZED: removed (was kept) | NULL (was kept non-empty) | NULL (unchanged) | stored, no length cap (unchanged; O7 out of scope) | NORMALIZED: trimmed (was kept) |
| P4 TS `loginGoogle` | n/a: no TS step (unchanged) | n/a: no TS step | n/a: no TS step | n/a: no TS step | n/a: no TS step | n/a: production sends NULL | n/a: no TS step |
| P4 web | n/a: no form | n/a: no form | n/a: no form | n/a: no form | n/a: no form | n/a: no form | n/a: no form |
| P4 ingress never raises | signs in, same account and person, name normalized | signs in, same result, name normalized | signs in, same result, name normalized | signs in, same result, name NULL | signs in, same result, name NULL | signs in (unchanged) | signs in, same result |
| P5 all layers `channel_identity_detach` | unchanged: NULL only | unchanged: NULL only | unchanged: NULL only | unchanged: NULL only | unchanged: NULL only | unchanged: writes the literal NULL | unchanged: NULL only |
| M2 SQL `create_guest_membership` (re-created, mode true on the copy at `:514`) | NORMALIZED: removed from the copy (was copied) | NORMALIZED: removed (was copied) | NORMALIZED: removed (was copied) | NULL (was copied non-empty) | NULL, never '' (was '') | copied (unchanged); a NULL source stays NULL | NORMALIZED: trimmed (was copied) |
| M2 TS `mintGuestMembership` | n/a: no name argument | n/a: no name argument | n/a: no name argument | n/a: no name argument | n/a: no name argument | n/a: the copy is SQL-only | n/a: no name argument |
| M2 web | n/a: no form | n/a: no form | n/a: no form | n/a: no form | n/a: no form | n/a: no form | n/a: no form |
| M3 all layers (owner membership) | unchanged: no name | unchanged: no name | unchanged: no name | unchanged: no name | unchanged: no name | unchanged: writes no display_name | unchanged: no name |
| T1 SQL `tenant_provision` (re-created, mode false) | REFUSED 22023 'name required' (was kept) | REFUSED 22023 (was kept) | REFUSED 22023 (was kept) | REFUSED 22023 (was kept) | REFUSED 22023 (unchanged) | stored, the strip-and-trim result; above 120 still 23514 (unchanged) | NORMALIZED: trimmed (was kept) |
| T1 TS route validator then `provisionTenant` (the check stays in the route, else a SQL 22023 becomes a 500) | REFUSED 400 `INVALID_BODY`, U+0000 included (was accepted; U+0000 reached PostgreSQL) | REFUSED 400 (was accepted) | REFUSED 400 inside (was accepted) | REFUSED 400: Zs (unchanged), U+2800 (was accepted) | REFUSED 400 (unchanged) | stored (unchanged) | NORMALIZED: trimmed (unchanged) |
| T1 web `validateNewClub` | REFUSED, the name pair (was accepted) | REFUSED, the name pair (was accepted) | REFUSED inside, the name pair (was accepted) | REFUSED: Zs the empty pair (unchanged), U+2800 the name pair (was accepted) | REFUSED, the empty pair (unchanged) | no error (unchanged) | NORMALIZED: trimmed (unchanged) |
| T2 SQL `tenant_profile_update` (re-created, mode false; a NULL argument keeps the name, unchanged) | REFUSED 22023 (was kept) | REFUSED 22023 (was kept) | REFUSED 22023 (was kept) | REFUSED 22023 (was kept) | REFUSED 22023 (unchanged) | stored, the strip-and-trim result (was trimmed of U+0020 only) | NORMALIZED: trimmed (was kept) |
| T2 TS `validatePatch` (the shared check replaces the inline Cc/Cf regex) | REFUSED `INVALID_INPUT` (unchanged) | REFUSED (unchanged) | REFUSED inside (was accepted) | REFUSED: Zs (unchanged), U+2800 (was accepted) | REFUSED (unchanged) | stored (unchanged) | NORMALIZED: trimmed (unchanged) |
| T2 web `clubNameProblem` (switched to the web hidden check) | REFUSED invalid_chars (unchanged) | REFUSED invalid_chars (unchanged) | REFUSED inside (was accepted) | REFUSED: Zs empty (unchanged), U+2800 invalid_chars (was accepted) | REFUSED empty (unchanged) | no error (unchanged) | NORMALIZED: trimmed (unchanged) |
| V1/V2 SQL | n/a: direct writes | n/a: direct writes | n/a: direct writes | n/a: direct writes | n/a: direct writes | n/a: direct writes, no CHECK | n/a: direct writes |
| V1/V2 TS `createSession`, `updateSession` (the venue_address call site; the shared `isOptionalText` unchanged) | REFUSED `INVALID_TEXT_FIELD` (unchanged) | REFUSED (unchanged) | REFUSED inside (unchanged) | Zs: NULL (was stored as sent); U+2800: REFUSED (unchanged) | NULL (was stored '') | stored, the strip-and-trim result, which the web already sends (was stored as sent) | NORMALIZED: trimmed (was REFUSED: the edge reached the untrimmed hidden check) |
| V1/V2 web `validateForm` | REFUSED, the address pair (unchanged) | REFUSED (unchanged) | REFUSED inside (unchanged) | Zs: NULL, sent as null or omitted (unchanged); U+2800: REFUSED (unchanged) | NULL (unchanged) | no error (unchanged) | NORMALIZED: trimmed (unchanged) |

- V1/V2: D2 pins S0c1's open blank-only cell (Zs-only gives NULL, U+2800-only is refused, in every layer). The edge and ordinary cells of V's TS row apply
  D1's edge rule ("trimmed away at the edges, never stored") to D2's "the strip-and-trim result decides": the TS checks and stores venue_address's
  strip-and-trim result at the call site, never inside the shared `isOptionalText` (S0b: it also serves venue_name and area, L23 negative scope). V2 still
  sends nothing for an unchanged loaded address (`session-form-model.ts:177-185`, unchanged).
- P3, ingress never raises. SQL: mode true is a pure text expression without RAISE (STRICT: NULL in, NULL out; text cannot hold U+0000); it runs in DECLARE
  (`0069:359`), before the identity lookup, which is why it must be raise-free. The identity is decided only by the tenant context (`:366`), the bot, scope and
  user hashes and the ciphertext (`:370-372`), the bot-in-tenant check (`:375`), the `channel_identities` lookup on platform 'zalo',
  `provider_scope_lookup_hash` and `platform_user_lookup_hash` (`:381-384`, re-read `:399-402`), the person active check (`:410`) and the reactivation
  (`:417`); the name never enters it (section 2), and the returned display_name stays the stored value (`:422`), so it can never be '' where NULL is the
  contract. TS: `zalo-ingress.ts` normalizes before the call, removing U+0000, which PostgreSQL would reject at parameter input (22021) before the definer runs
  (S0b, inferred from PostgreSQL semantics and not run: the lane's real-DB cell "U+0000 in display_name still resolves the identity" is expected to fail today).
- P4, ingress never raises. SQL: mode true sits in the new-person INSERT value (`0069:217`), after the branch is chosen; the identity is decided only by
  `p_subject_hash` (guard `:129`; the `account_identities` lookup on platform 'google', `:136-139`, re-read under the lock `:180-183`), `p_email_lookup_hash`
  and `v_email_verified` (`:142-144`, `:186-188`) and the advisory locks (`:163-164`); the function returns `account_id`, `person_id` and `outcome` only
  (`:283-285`). TS: production passes `displayName` NULL (callback `route.ts:190-196`, DD-26) and the dev persona passes constant ASCII fixtures
  (`persona-account.ts:58-64`, `personas.ts:24`, `:30`, `:36`), so U+0000 cannot reach the bind.
- M2, the NULL rule: an invisible-only or blank-only source (Zs-only, U+2800-only, R-only) is copied as NULL, never ''; a NULL source stays NULL; any other
  source is copied normalized. NULL-reader verdict (S0c2, S0b): every reader tolerates NULL, and '' is the hazard because `??` does not catch it. Host roster
  `displayNameOf` (`roster-rules.ts:39-40`): NULL shows t("(chưa đặt tên)", "(unnamed)"), '' shows a blank name. Join-request inbox (`request-inbox.tsx:98`;
  `str` in `discover-api.ts:21-22` maps '' to null): NULL and '' show t("Người chơi chưa có tên", "Unnamed player"). Chat author label
  (`message-list.tsx:67-71`): NULL and '' fall back to t("Thành viên", "Member"). No reader calls trim, length or negation on a nullable name, and no non-test DTO
  declares these names non-null. VERDICT: NULL is safe at every reader; the NULL copy removes the blank-roster case.

## 8. Cleanup design (D4)

- Measured: 0 stored violations (section 2: plexco_smoke at 0068 holds 27, 39, 13 and 23 rows, 0 in every class; plexco at 0031 is empty). Production cannot
  be measured here, and P2, P3, P4, T1 and T2's SQL accept these code points today, so violations can exist: 0070 keeps a guarded, idempotent cleanup in 0069's
  block pattern.
- Placement: one DO block in 0070 between its own marker lines (0069's L27-CLEANUP pattern), after the function and the six re-created definers. The writer
  guard's G2 admits a bare statement or DO block only inside 0069's L27-CLEANUP block (`member-name-writer-guard.test.ts:138`), so G2 is extended to admit
  0070's block (unit U4 or U5).
- Guard (fail-closed visibility, as 0069): raise 42501 when `row_security_active` is true and `pg_relation_size` is above 0 for any of public.persons,
  public.memberships, public.tenants and public.sessions (`0068:210-214` extended to the four tables); 0070 is applied as the superuser migration role.
- Owner-checked: the migration's owner assertion (section 5) passes before the block runs.
- Candidates: rows whose value is distinct from `public.member_name_apply_rule(value, true)`, `ORDER BY id`, `FOR UPDATE`.
- New value, mode true for all four columns: persons.display_name and memberships.display_name take the normalized value or NULL (both nullable; every reader
  tolerates NULL, section 7); sessions.venue_address takes the normalized value or NULL; tenants.name takes the normalized value, and a tenants.name that would
  become NULL is left unchanged with a NOTICE, exactly as 0069 handles an invisible-only tenants.name (NOT NULL and `tenants_name_len_chk` 1..120 stay intact).
- NOTICEs: one per changed row id and one per row left unchanged, never the text; a closing NOTICE with the counts per column.
- Projection: each session whose venue_address changed is re-projected with `PERFORM public.public_sessions_project_session(id, NULL)` inside the transaction,
  as 0069 does for its cleanup (L27 section 8, the `0068:241` pattern; the projector applies `hide_exact_address`); the other three columns are read live and
  need no projection (L27 section 2, Q4).
- Idempotent: mode true returns a normalized value unchanged, so a second run finds no candidate except the tenants rows left unchanged, changes nothing and
  re-reports only those.
- Tests (D6): the guard, the id-only NOTICEs, the idempotence and real-DB counts on the smoke DB after 0069 and 0070 are applied there under the DB/e2e lock
  (plexco_smoke lacks 0069 today: S0e1).

## 9. Pinned defaults

Every row is a Tier-B default: **default applied, pending owner sign-off** (conductor decision D3 under the owner's delegation of 2026-10-22, applied by
the orchestrator in `design-decision.md` D1-D8; never an owner signature, the owner can reverse it). The PR body repeats each row with its rejected
alternatives. Rows N1-N4 are S0d2's own readings, same status.

| # | Default (value) | Source | Rejected alternatives (why) |
|---|---|---|---|
| D1a | The rule is P1's existing one, no new set: strip S (the 0068 helper, Default_Ignorable minus Bidi_Control) -> trim T (SQL `c_ws` = JS trim, 25 code points) -> refused set R (SQL `c_reject` 244 = TS `hasHiddenChar` 245) -> visible test V (SQL `c_visible` = TS `hasVisibleChar`), measured equal over all 1,112,064 scalars (S0e2) | D1 | a lane-only minimal set (Cc, Bidi_Control, U+2028, U+2029): a second definition beside P1's (threat 6) that P1 already exceeds; a Unicode-property regex built at run time (version dependent, Semgrep CE, no precedent) |
| D1b | U+2800 is in R: refused at interactive writers, removed at ingress, although V counts it visible (decided by measurement) | D1 | treat it as blank (changes V, moves L23 and L27 pins); accept it (a blank-looking name impersonates "nobody": threat 3) |
| D1c | The 16 Zs blanks are trimmed at the edges and allowed inside; a value made only of them has no V character (refused or NULL by writer class); U+3164 and U+FFA0 stay stripped (L27) | D1 | refuse Zs inside (refuses ordinary names typed with NBSP or U+3000; no precedent); collapse inner runs (normalization beyond the lane: negative scope) |
| D1d | Edge rule: R is checked AFTER the strip and the trim, so an R code point that is also in T (U+0009-U+000D, U+2028, U+2029) is trimmed away at the edges and refused (interactive) or removed (ingress) inside | D1, as P1 today | check R before the trim (changes P1, breaks A-12) |
| D1e | U+0000 is a TS-only member of R (PostgreSQL text cannot hold it): the named exception of every SQL-versus-TS comparison | D1 | none: the SQL layer cannot store it |
| D1f | The sets stay explicit code-point lists (comments say Unicode 17.0; local Node v25.6.0, ICU 78.2); tests compare the sets with each other, never with Unicode-version counts | D1 | pin counts or property classes (flip on a Node or ICU upgrade; CI Node 22 unmeasured: section 15 O3) |
| D2a | Interactive, required name (P1, P2 and M1, T1, T2): after the strip and the trim REFUSE a value that contains an R code point or has no V character, with the writer's existing error shape (SQL 22023 and the writer's existing message; TS the writer's existing error code; web: P1 and T2 reuse their pair, P2/M1 and T1 wire the existing pair "Tên không được chứa ký tự điều khiển hoặc ký tự ẩn." / "The name cannot contain control or hidden characters.", measured by S0d2 at `apps/web/components/me/settings-profile-form.tsx:58-59` and `apps/web/components/settings/club-profile-form.tsx:72`) | D2 | normalize silently (the person never sees what was stored; human-typed input fails closed); a new error code (error codes unchanged: negative scope) |
| D2b | Interactive, optional field (V1, V2 sessions.venue_address): an empty strip-and-trim result is stored as NULL in every layer; a non-empty one that contains R or lacks V is REFUSED with the existing error shape (NBSP-only -> NULL, U+2800-only -> refused); the TS call site checks and stores the strip-and-trim result, the shared `isOptionalText` stays unchanged (D8) | D2, D8 | store '' (two spellings of absent); refuse blank-only (the field is optional and the web already sends NULL); change `isOptionalText` (other fields' behaviour) |
| D2c | Ingress and copy (P3 Zalo, P4 Google, M2 guest copy): NORMALIZE, never raise: strip -> trim -> remove every R code point -> trim -> NULL when no V character remains, then each writer's existing length handling (P3 cuts to 120 AFTER normalization); M2 copies NULL, never ''; TS P3 normalizes in `zalo-ingress.ts` before the SQL call (it also removes U+0000, which would fail the bind with 22021); TS P4 n/a (production passes displayName null, DD-26; the dev persona passes a repo fixture) and the SQL definer normalizes any non-null value | D2 | refuse at ingress (a name blocks sign-in or identity: threat 5, negative scope); leave ingress as is (bidi spoofing through a Zalo name: threat 1); a CHECK backstop (raises instead of normalizing) |
| D2d | NULL-only writers P5 and M3: unchanged | D2 | none |
| D3 | ONE new SQL function `public.member_name_apply_rule(p_value text, p_external boolean) RETURNS text`, LANGUAGE plpgsql (D8), with exactly the 0068 helper's attributes, which D3 lists as STRICT, IMMUTABLE, PARALLEL SAFE, SECURITY INVOKER, `SET search_path = pg_catalog` (where 0068 differs, 0068 wins: one precedent; the helper is called schema-qualified); owner = the 0068 helper's owner, asserted at migrate time as 0069 does; REVOKE ALL FROM PUBLIC and no grant to app or app_worker (only the definers call it, as its owner). Mode false returns the strip-and-trim result, or NULL when it contains R or lacks V (the caller raises its own 22023); mode true returns the normalized value or NULL. Its R, V and T DECLARE literals are byte-identical copies of P1's at 0069:441-461 (21 lines; the NULL check, trim and refusal at :463-471: D8, measured), pinned by a test. Re-created to call it: P2, T1, T2 in mode false (T2 keeps "a NULL argument keeps the name" and refuses a non-NULL argument whose result is NULL) and P3, P4, M2 in mode true; owner, SECURITY DEFINER, proconfig and search_path, and ACL unchanged. P1 is NOT re-created (it already enforces the rule; A-12 keeps its constants) | D3, D8 | (a) re-create all seven with the rule inline (breaks A-12 at P1, seven copies of R, V and T, 585 restated lines measured); (b) change the 0068 helper (changes the strip set and L23's public-name semantics: a STOP condition; PS-PIN breaks; P1 would normalize); (c) two functions, refusing and normalizing (two copies of the constants or one calling the other: more concepts for the same lines); (d) a CHECK or domain backstop (23514 instead of 22023, raises at P3 and P4, cannot give M2 NULL, changes a table); (e) BEFORE triggers (cannot tell writers apart, run after each writer's checks: L27 section 4); (f) rename plus thin wrappers for P3 and P4 (six extra definer objects with their own pins; renamed functions keep their grants; no precedent) |
| D4 | Cleanup: guarded, idempotent, id-only NOTICE counts, owner-checked, in 0069's block pattern: normalize the four columns with mode true; a tenants.name that would become NULL is handled exactly as 0069 handles an invisible-only tenants.name; changed venue_address rows are re-projected if 0069 re-projects for its cleanup. Measured 0 stored violations (plexco_smoke at 0068, plexco at 0031: S0e1); production cannot be measured here and P2, P3, P4, T1 accept these code points today, so violations can exist | D4 | no cleanup (a stored bidi override stays live); fail the migration on any violation (blocks the deploy on data nobody here can see; 0068 and 0069 normalize) |
| D5a | TS: ONE interactive check and ONE normalizer in `packages/db/src/text-safety.ts`, exported, used by every TS writer of the inventory: P2/M1 `roster-service.ts`, T1 `auth.ts` provisionTenant and the T1 validator in `apps/web/app/api/onboarding/start/route.ts`, T2 `club-config-validation.ts` (its inline Cc/Cf regex replaced by the shared check), V1 and V2 `session-service.ts`, P3 `zalo-ingress.ts`; P1 `me-settings.ts` keeps its code if switching costs more than 3 lines (then pinned equal by an every-scalar test) | D5 | a check per writer (second definitions: threat 6); leave the route validator out (create-versus-set drift at T1: threat 4) |
| RO-L29-1 | Orchestrator reading: `apps/web/app/api/onboarding/start/route.ts` is T1's TypeScript validator of L27's inventory (L27 edited it in 9294bde90238119af67a4d9f4125954e56e90c7b), so it applies the shared check | D5 | treat it as a reader (T1 would refuse in SQL only, behind an HTTP 500: section 15 O2) |
| RO-L29-2 | Orchestrator reading: the two TS functions are exported through ONE barrel line in `packages/db/src/index.ts` (precedent L23 10c49399ecc2f3ad83d6d86fd1d0738141abf504) | D5 | a deep import path (no precedent in the web routes) |
| D5b | Web: mirror copies (FE-INV-3, no runtime import of @plexco/db in client code): `roster-add-player-form.tsx` (P2/M1, gets its first unit test), `new-club-form.ts` (T1), `club-settings-model.ts` (T2, switches to the web HIDDEN copy), `session-form-model.ts` (V, pins the blank-only cell); the existing web HIDDEN and visible copies in `session-form-model.ts` are reused instead of a new web module when that is the shorter diff | D5 | import @plexco/db in client code (FE-INV-3); a new shared web module (one more file for the same copies) |
| N1 | Migration file `packages/db/migrations/0070_member_name_control_chars.sql` (slot 0070 measured: the tail at the base is 0069) | S0d2 | a name carrying a DD number (durable names outlive decision numbers) |
| N2 | The packages/db TS writer cells (P2/M1, T1 provisionTenant, T2, V1/V2, P3) live in ONE db test file, `packages/db/src/member-name-invisible-chars.test.ts`, one section per writer: one test file per writer measures 31 files (cap 30), one file measures 26 | D6 rule, S0d2 count | the five writer test files (31 files: a B3 crossing) |
| N3 | The U2 and U3 definer generator script lives in the notes directory outside the repo (L27 u1-gen-definers precedent): no `scripts/` file, so no `kit-pack-membership.json` record (note C10) | S0d2 | commit the generator (one more file and a kit-pack record for a one-shot tool) |
| N4 | Decision record DD-147 (note A2: DD-146 is lane L31's although absent at the base; DD-145 is the highest at the base, `decisions.md:1760`, measured) | D8 | DD-146 (collides with L31) |

## 10. Implementation units

Order: U1 -> U2 -> U3 -> U4 (one migration, serialized; every DB run under the DB/e2e lock), then U6 -> U5 (U5's SQL-versus-TS agreement needs U6's
functions: S0d2's reading of D7's order), then U7a-U7e, then U8d -> U8a, U8b, U8c (U8d first when another mirror imports a copy it must export), U9 at
any time. One writer at a time in the worktree; each unit commits there and does not push; `b3-measure.sh` after every unit (C6: a crossing is a ruling
request before the next unit); GitNexus `impact` before each edited TS symbol (the SQL definers are not indexed: S0e1 section 4) and `detect_changes` at
the end. Known intermediate reds, not unit failures: the count and tail pins from U1 until U4; G2 of the writer guard for 0070 from U2 until U5 (G2
requires `public_name_strip_invisible(` in every post-0069 writer today: S0e1 section 2).

| Unit | Model | Files | Content | Depends |
|---|---|---|---|---|
| U1 | opus/max | 0070 section A; `member-name-invisible-chars.test.ts` | header with the threat model (section 6); the owner assertion between L29-OWNER-CHECK markers (0069:67-100 pattern); `member_name_apply_rule` with its attributes, REVOKE and COMMENT; tests L29-F1-F5 | base |
| U2 | opus/max | 0070 section B; same test file | P2, T1, T2 re-created in mode false from 0069:292-337, :561-642, :646-707 by the generator (N3), only the named edits; tests L29-W1, L29-RC | U1 |
| U3 | opus/max | 0070 section C; same test file | P3, P4, M2 re-created in mode true from 0069:341-425, :104-288, :487-556; tests L29-W2, L29-I1-I3, L29-RC | U2 |
| U4 | opus/max | 0070 section D; same test file; `migrate.test.ts`, `rls-invariants.test.ts`, `outbox-projector-registry.test.ts` | the guarded cleanup between L29-CLEANUP markers (0069:712-821 pattern); tests L29-C1-C4; the 14 tail pin lines | U3 |
| U6 | sonnet/high | `text-safety.ts`, `index.ts`, `text-safety.test.ts` | the interactive check, the normalizer, the barrel line; tests L29-T1-T3 | U4 |
| U5 | opus/max | `member-name-writer-guard.test.ts`; `member-name-invisible-chars.test.ts` | the guard extension L29-G1-G3; the SQL-versus-TS every-scalar agreement L29-AG1 | U6 |
| U7a | sonnet/high | `roster-service.ts` | P2/M1: the interactive check before the SQL call (`:120` passes `name.trim()` today) and on the direct twin; cells L29-TW (N2 file) | U5 |
| U7b | sonnet/high | `club-config-validation.ts` | T2: the inline Cc/Cf regex replaced by the shared check; cells L29-TW | U5 |
| U7c | sonnet/high | `session-service.ts` | V1, V2 per D2b; cells L29-TW | U5 |
| U7d | sonnet/high | `zalo-ingress.ts` | P3: the normalizer before the SQL call (`:185`); cells L29-TW | U5 |
| U7e | sonnet/high | `auth.ts` provisionTenant (`:203`); `apps/web/app/api/onboarding/start/route.ts` and its `route.test.ts` | T1 at both TS sites; cells L29-TW and the route cells | U5 |
| U8d | sonnet/high | `session-form-model.ts` and its test | V blank-only cell; the TS-versus-web agreement L29-AG2 | U7a-U7e |
| U8a | sonnet/high | `roster-add-player-form.tsx`, new `roster-add-player-form.test.tsx` | P2/M1 mirror with the existing pair wired; its first unit test | U8d |
| U8b | sonnet/high | `new-club-form.ts` and its test | T1 mirror | U8d |
| U8c | sonnet/high | `club-settings-model.ts` and its test | T2 mirror on the web HIDDEN copy | U8d |
| U9 | sonnet/high | `docs/standards/decisions.md` | DD-147: owner-facing Vietnamese section, summary-table row, changelog row; provenance "decided by the conductor under the owner's delegation of 2026-10-22 (D3), not an owner signature" | any |

## 11. Test plan

Conventions: characters are built with `String.fromCodePoint(n)` (TS) and `chr(n)` (SQL); every test that loops over all scalars ends `}, 30_000);`
(C11a); no RegExp built from data: string or Set checks and `toMatchObject` only (C11b; precedent `apps/web/components/sessions/session-form.test.tsx:30`);
real-DB tests run under the lock; the cells are read from the decision table of section 7, every writer x class, with the edge cell.

`packages/db/src/member-name-invisible-chars.test.ts` (real DB; extend, do not scatter):
- L29-F1 `member_name_apply_rule(text, boolean)` exists once and returns text; L29-F2 its provolatile, proisstrict, proparallel, prosecdef and proconfig equal
  the 0068 helper's (D3); L29-F3 its owner equals the 0068 helper's owner; L29-F4 no EXECUTE for PUBLIC, app or app_worker (`has_function_privilege`);
  L29-F5 its R, V and T DECLARE literals are byte-identical to P1's 0069:441-461 (the A-12 method), and both modes return the expected value per class.
- L29-W1 (U2) P2, T1, T2 x {Cc, Bidi_Control, U+2028 and U+2029, blank-only (NBSP, U+3000, the Zs set), U+2800-only, invisible-only, ordinary, the edge
  cell (TAB or U+2028 at an edge is trimmed, inside it is refused)} -> 22023 with the writer's message, or the stored value; T2's NULL argument keeps the
  name; T1 and T2 accept and refuse the same values (create versus set, threat 4).
- L29-W2 (U3) P3, P4, M2 x the same classes -> the normalized value or NULL, never ''; M2 copies NULL for an invisible-only or blank-only source; P3's 120
  cut applies after normalization.
- L29-I1 ingress never raises: P3 and P4 complete without error for hostile names (every R code point SQL text can hold, a bidi override, U+2028,
  blank-only, invisible-only); L29-I2 identity unchanged: a hostile and a clean name resolve the same person and account (the identity is decided only by
  the provider ids: S0e1 section 3); L29-I3 a NULL display name stays NULL.
- L29-RC (U2, U3) each re-created definer keeps owner, prosecdef, proconfig and ACL (L27's RC, ACL and OWNER pattern) and its prosrc calls
  `member_name_apply_rule(` with the mode of its class.
- L29-C1 (U4) an owner mismatch fails the migration; L29-C2 the NOTICE lines carry ids and counts only, never a value; L29-C3 a re-run changes nothing;
  L29-C4 seeded violations in all four columns are normalized (tenants.name per D4) and changed venue_address rows re-projected; real counts on
  plexco_smoke after 0069 and 0070 are applied there under the lock.
- L29-AG1 (U5) SQL versus TS over every scalar: one `generate_series` query (PS-PIN pattern) through both modes against the U6 functions, with U+0000
  and the surrogates excluded by name; `30_000`.
- L29-TW (U7a-U7e) one section per packages/db TS writer (N2) with the same cells through the writer's TS entry point (its TS error code or the stored value).

`packages/db/src/member-name-writer-guard.test.ts` (U5): L29-G1 a writer of the four columns in a migration after 0069 that does not call
`member_name_apply_rule(` and is not P1, P5 or M3 by name fails; L29-G2 the 0070 cleanup block is recognized by its L29-CLEANUP markers; L29-G3 a TS write
site of the four columns that is not M1, V1, V2 or a caller of the U6 functions fails (a new write site fails until it is named); L27's G1-G4 stay and `:138`
`CLEANUP = "0069_..."` does not move.

`packages/db/src/text-safety.test.ts` (U6): L29-T1 the interactive check and L29-T2 the normalizer over every scalar against the set definitions
(`30_000`); L29-T3 if P1 keeps its code, `me-settings.ts`'s check equals the interactive check over every scalar.

Web (U7e, U8a-U8d): `apps/web/app/api/onboarding/start/route.test.ts` T1 cells; `roster-add-player-form.test.tsx` (new) P2/M1 cells and the wired pair;
`new-club-form.test.ts` and `club-settings-model.test.ts` T1 and T2 cells (T1 and T2 agree); `session-form-model.test.ts` V cells (NBSP-only -> NULL,
U+2800-only -> refused) and L29-AG2 TS versus each web mirror over every scalar (W7 and SF-PIN pattern, `30_000`).

The 14 tail pin lines (U4; counts 70 -> 71, tail 0069 -> 0070 with the new file name; S0e1 section 2): `packages/db/src/migrate.test.ts:53`, `:769`;
`packages/db/src/rls-invariants.test.ts:70`, `:73`, `:1841`, `:1846`, `:2124`, `:4717`, `:4719`, `:4720`;
`packages/db/src/outbox-projector-registry.test.ts:114`, `:115`, `:117`, `:120`.

Pins that stay unchanged (not edited, green at every unit): A-12 (`public-alias.test.ts`, P1's constants); PS-PIN and PS-ACL
(`public-name-invisible-chars.test.ts`); TX-ALL and TX-R4 (`text-safety.test.ts`); W7, SF-PIN and SF-R5 (`session-form-model.test.ts`);
`member-name-writer-guard.test.ts:138`; `member-name-invisible-chars.test.ts:412` and `:812`; the tenant_admins prosrc scan in
`identity-link-web.test.ts`; L27's G1-G4, RC, ACL and OWNER tests.

## 12. Verification

The ACCEPTANCE COMMANDS of lane block L29, each cited with measured output (`| tail -40`); DB and e2e runs one at a time through the lock
(`status/.db-e2e.lock` via `locked-run.sh` in the notes directory):

1. S1 VERIFY set: `pnpm typecheck`; `pnpm lint`; `pnpm format:check`; `pnpm review:check:changed`; `pnpm build` (once, sandbox off);
   `NODE_ENV=test pnpm --filter @plexco/web test` (the FULL web vitest); `NODE_ENV=test DATABASE_URL_TEST=... pnpm -w test` once at the final head (one
   rerun for a flake listed in `status/conductor-scripts/clerk-flake-list.txt`).
2. The db suite under the lock after each SQL unit (U1-U5) and at the final head; plexco_smoke gets 0069 and 0070 under the lock before L29-C4 (S0e1).
3. Playwright under the lock, sandbox off (ports): `cd apps/web && pnpm exec playwright test e2e/settings.spec.ts e2e/sessions.spec.ts e2e/roster.spec.ts`
   (S0c2: the specs run on a fake Postgres with HTTP mocks, so they check the web mirrors and rendering, not the SQL rule).
4. The full `pnpm review:check` after the readiness commit and at the final head.
5. GitNexus `impact` before each edited TS symbol; `detect_changes` against main at the end.
6. `b3-measure.sh` after every unit (section 14); the byte check of section 13 after every write.
7. Golden path: NOT RUN while any of the host interfaces en7, en8, en10 or utun6 exists (RO-L20-2a: `lib/dev-login/network-exposure.test.ts` "real probe"
   is KNOWN_ENV there and the PR's CI is the independent gate); written NOT RUN with that reason, never a pass. Semgrep CE runs in CI only.

## 13. Tool hazard

- The Edit and Write tools turn a backslash-u escape into the raw character. Build test characters in TS with `String.fromCodePoint(0x202e)` and in SQL
  with `chr(n)`; never type a backslash-u escape or paste an invisible, control or bidi character; never retype existing escapes through Edit or Write.
- Byte check after each write (must print 0): `LC_ALL=en_US.UTF-8 grep -c -P '[\x{0001}-\x{0008}\x{000B}\x{000C}\x{000E}-\x{001F}\x{007F}-\x{009F}\x{00AD}\x{034F}\x{061C}\x{115F}\x{1160}\x{17B4}\x{17B5}\x{180B}-\x{180F}\x{200B}-\x{200F}\x{2028}-\x{202E}\x{2060}-\x{206F}\x{2800}\x{3164}\x{FE00}-\x{FE0F}\x{FEFF}\x{FFA0}]' <file>`
  (L27's class plus the C0 and C1 controls other than TAB, LF and CR, U+061C, U+2028, U+2029 and U+2800).
- The Bash tool runs zsh: run multi-line snippets from a script file (`bash <file>`), never `bash -c`; `pnpm build` and Playwright need the sandbox off.

## 14. Budget (B3)

Caps (lane block L29): 900 non-test, 1,600 test, 2,500 total excluding docs, 30 files including docs, 1 migration. Units are added lines as
`b3-measure.sh` counts them (`git diff --numstat`; comment-only and blank added lines are reported and still count). Measured by S0d2 at the base with
`sed -n '<a>,<b>p' packages/db/migrations/0069_member_name_invisible_chars.sql | wc -l`: header 1-66 = 66; owner check 67-100 = 34; P4 104-288 = 185;
P2 292-337 = 46; P3 341-425 = 85; P1 429-483 = 55 (not restated); M2 487-556 = 70; T1 561-642 = 82; T2 646-707 = 62; cleanup 712-821 = 110; P1's
constants 441-461 = 21. The six restated bodies = 530 (with P1's 55: the 585 of rejected alternative D3 (a)).

| File | Class | Estimate (added) | Basis |
|---|---|---|---|
| `packages/db/migrations/0070_member_name_control_chars.sql` (new) | non-test | 790 | 530 restated (measured) + header 45 + owner check 34 + function 55 (its 21 constants restated) + edits and separators 21 + cleanup 105 |
| `packages/db/src/text-safety.ts` | non-test | 30 | two exported functions and their comments |
| `packages/db/src/index.ts` | non-test | 1 | one barrel line |
| `packages/db/src/roster-service.ts` | non-test | 5 | P2/M1 call sites |
| `packages/db/src/auth.ts` | non-test | 4 | T1 provisionTenant |
| `packages/db/src/club-config-validation.ts` | non-test | 3 | the inline regex replaced |
| `packages/db/src/session-service.ts` | non-test | 8 | V1, V2 |
| `packages/db/src/zalo-ingress.ts` | non-test | 4 | P3 |
| `packages/db/src/me-settings.ts` | non-test | 0 (3 if switched) | D5a |
| `apps/web/app/api/onboarding/start/route.ts` | non-test | 4 | T1 validator |
| `apps/web/components/sessions/roster-add-player-form.tsx` | non-test | 10 | check and pair |
| `apps/web/lib/new-club-form.ts` | non-test | 8 | T1 mirror |
| `apps/web/lib/club-settings-model.ts` | non-test | 6 | T2 mirror |
| `apps/web/lib/session-form-model.ts` | non-test | 12 | V mirror and exports |
| `packages/db/src/member-name-invisible-chars.test.ts` | test | 640 | F 70, W1 110, W2 with I and RC 170, C 90, AG1 50, TW 150 |
| `packages/db/src/member-name-writer-guard.test.ts` | test | 50 | G1-G3 |
| `packages/db/src/migrate.test.ts` | test | 2 | pins |
| `packages/db/src/rls-invariants.test.ts` | test | 8 | pins |
| `packages/db/src/outbox-projector-registry.test.ts` | test | 4 | pins |
| `packages/db/src/text-safety.test.ts` | test | 90 | T1-T3 |
| `apps/web/app/api/onboarding/start/route.test.ts` | test | 30 | T1 cells |
| `apps/web/components/sessions/roster-add-player-form.test.tsx` (new) | test | 80 | first unit test |
| `apps/web/lib/new-club-form.test.ts` | test | 40 | cells |
| `apps/web/lib/club-settings-model.test.ts` | test | 40 | cells |
| `apps/web/lib/session-form-model.test.ts` | test | 50 | cells and AG2 |
| this readiness file (new) | docs | about 500 | 301 part-1 lines plus sections 9-17 |
| `docs/standards/decisions.md` | docs | 60 | DD-147 |

Totals: non-test 885 (888 if P1 switches) of 900; test 1,034 of 1,600; total excluding docs 1,919 of 2,500; files 26 (27) of 30; migrations 1 of 1.
Every estimate is inside its cap. Watch item, the thinnest margin (12 to 15 lines, non-test): after U3, if the measured 0070 lines + 105 (cleanup) + 95
(TS and web) exceed 900, the orchestrator makes a ruling request before U4 (C6); the lever inside the design is compact comments (the threat model
stays), never a scope cut.

## 15. OPEN

OUT_OF_SCOPE residue (none is an open question in scope):

- O1 Three different NULL fallbacks for a person name (S0c2): `apps/web/lib/roster-rules.ts:40` "(chưa đặt tên)" / "(unnamed)", `request-inbox.tsx:98`
  "Người chơi chưa có tên" / "Unnamed player", `apps/web/components/chat/message-list.tsx:58` "Thành viên" / "Member". All three render NULL; M2's NULL
  copy (D2c) removes the roster's blank '' case. The `??` readers that show '' blank (displayNameOf, details-tab, shell-frame, tenant-switcher) stay: backlog.
- O2 T1's SQL refusal surfaces as HTTP 500 behind the TS refusal: the route validator and provisionTenant refuse first with their existing shape; a value
  that passes TS and fails SQL is reachable only if the layers disagree, which L29-AG1 and L29-AG2 fail on; mapping 22023 to a 4xx changes an error
  contract (negative scope): backlog.
- O3 CI runs Node 22, whose Unicode and ICU versions were not measured (local Node v25.6.0, Unicode 17.0, ICU 78.2): the sets are explicit lists, but JS
  trim follows the engine's Unicode version, so the every-scalar agreement fails closed on CI if they differ.
- O4 Homoglyphs and confusables (L27 O2): not defended (threat model); backlog candidate.
- O5 L27 residue still standing (L27, not re-measured): `docs/features/BE/feature_user_settings_tech.md:212` states the persons.display_name refusal (a
  PR-body follow-up; no Reviewed spec is edited, DD-147 is the record); memberships.display_name never follows a rename; two `DISPLAY_NAME_MAX` values;
  `auth_login_google` caps no length (length limits unchanged: negative scope).
- O6 The plexco dev DB is at 0031 (38 behind) with empty name tables (S0e1): informational.

## 16. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the base = the worktree HEAD at step 0 and at S0d2 (measured: `git rev-parse HEAD`; porcelain shows only this file); every TARGET_FILES path exists at the base and on disk (measured by S0d2 with `git cat-file -e`) | PASS |
| 2 | Decisions in scope final | owner item 6 and the L27 prompt line, verbatim (section 1); DD-144 at `decisions.md:1882`; the lane is conductor decision D3 under the owner's delegation; every choice pinned as a default pending owner sign-off (section 9) | PASS |
| 3 | Scope IN/OUT and owner clear | sections 3, 7 and 10; the lane NEGATIVE SCOPE; section 15 residue; L31 runs beside on disjoint files and this lane holds slot 0070 | PASS |
| 4 | Dependencies classified | L27 (PR 101, merge fb8ee675b49f9460ae8332950c82b40ec30610de; 0069 added by 393653f18443fca8af4137ef311fd76b41bfaad6) and L23 (PR 97) are ancestors of the base; slot 0070 measured (tail 0069); DD-147 free (N4) | PASS |
| 5 | Live schema and code match | sections 2 and 3, measured at the base; the 0069 ranges re-measured by S0d2 (section 14) | PASS |
| 6 | Data, API, state, auth contract | no new table, column, endpoint, error code or grant; one new SQL function owned by the 0068 helper's owner with no EXECUTE for PUBLIC, app or app_worker; the six definers keep signature, owner, ACL and attributes (L29-RC) | PASS |
| 7 | Fail-closed, idempotency, order | interactive writers refuse (D2a, D2b); ingress normalizes and never raises (D2c, L29-I1); strip, then trim, then R and V (D1d); an owner mismatch fails the migration; the cleanup re-run is a no-op (L29-C3) | PASS |
| 8 | Open questions in scope = 0 | every choice pinned in section 9; section 15 is out of scope | PASS |
| 9 | Acceptance matrix with expected results | section 7 (every writer x class, per layer, with the ingress rows) and the section 11 test IDs | PASS |
| 10 | Migration, security, rollback | one migration in slot 0070; opus/max security round (identity and PII writers, external input, a cleanup); rollback = revert before merge, after merge a migration restoring the 0069 bodies and dropping the function; normalized values are not restorable (0 stored violations measured locally) | PASS |
| 11 | First slice hard dependencies merged | L27 (PR 101) and L23 (PR 97) on the base | PASS |
| 12 | Implementation handoff ready | sections 9-14; the worktree exists at the base, clean apart from this file | PASS |

## 17. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-23
AUTHORITY_SHA: 07bbe3482afec629456c4497f21a60a6d2fcef30
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md (DD-144 read; DD-147 added by U9)
  - packages/db/migrations/0067_session_venue_visibility.sql (read only: projector)
  - packages/db/migrations/0068_public_name_invisible_chars.sql (read only: the strip helper, its owner and attributes)
  - packages/db/migrations/0069_member_name_invisible_chars.sql (read only: the six live bodies, P1's constants, the owner check and cleanup pattern)
  - packages/db/src/text-safety.ts
  - packages/db/src/index.ts
  - packages/db/src/roster-service.ts
  - packages/db/src/auth.ts
  - packages/db/src/club-config-validation.ts
  - packages/db/src/session-service.ts
  - packages/db/src/zalo-ingress.ts
  - packages/db/src/me-settings.ts (P1: edited only if the switch costs at most 3 lines)
  - packages/db/src/member-name-invisible-chars.test.ts
  - packages/db/src/member-name-writer-guard.test.ts
  - packages/db/src/text-safety.test.ts
  - packages/db/src/migrate.test.ts (pin sites)
  - packages/db/src/rls-invariants.test.ts (pin sites)
  - packages/db/src/outbox-projector-registry.test.ts (pin sites)
  - packages/db/src/public-name-invisible-chars.test.ts (read only: PS-PIN, PS-ACL stay green)
  - packages/db/src/public-alias.test.ts (read only: A-12 stays green)
  - packages/db/src/identity-link-web.test.ts (read only: the tenant_admins prosrc scan stays green)
  - packages/db/src/roster-service.test.ts (read only: stays green)
  - packages/db/src/auth.test.ts (read only: stays green)
  - packages/db/src/club-config.test.ts (read only: stays green)
  - packages/db/src/session-service.test.ts (read only: stays green)
  - packages/db/src/zalo-ingress.test.ts (read only: stays green)
  - apps/web/app/api/onboarding/start/route.ts
  - apps/web/app/api/onboarding/start/route.test.ts
  - apps/web/components/sessions/roster-add-player-form.tsx
  - apps/web/lib/new-club-form.ts
  - apps/web/lib/new-club-form.test.ts
  - apps/web/lib/club-settings-model.ts
  - apps/web/lib/club-settings-model.test.ts
  - apps/web/lib/session-form-model.ts
  - apps/web/lib/session-form-model.test.ts
  - apps/web/components/chat/message-list.tsx (read only: the bdi label and its NULL fallback)
  - apps/web/lib/roster-rules.ts (read only: the NULL fallback)
  - apps/web/e2e/settings.spec.ts (verification)
  - apps/web/e2e/sessions.spec.ts (verification)
  - apps/web/e2e/roster.spec.ts (verification)
SLICE: p3-name-writers-refuse-control-bidi
IN_SCOPE: one rule per layer (SQL, TS, web mirror) after the L27 strip at every writer of persons.display_name, memberships.display_name, tenants.name and sessions.venue_address: interactive writers (P1, P2 and M1, T1, T2, V1, V2) refuse a control, Bidi_Control, U+2028, U+2029 or U+2800 code point or a value with no visible character (V1 and V2 store an empty value as NULL); ingress and copy writers (P3, P4, M2) normalize and never raise, NULL when nothing visible remains; one new SQL function public.member_name_apply_rule and six definers re-created in migration 0070 (P1 untouched); one TS check and one TS normalizer in text-safety.ts used by every TS writer; the web mirrors; a guarded idempotent one-time cleanup; the writer guard and the every-scalar agreement across the three layers; the 14 migration pin lines; DD-147
OUT_OF_SCOPE: homoglyphs and confusables; the strip set, the emoji rule, the length limits and the L23 public-name semantics; new tables or columns; what Zalo ingress or Google sign-in accept as a request; identity-merge and person-equality logic; error codes and their HTTP mapping; the readers' NULL fallback strings; Reviewed spec edits (DD-147 only); enabling anything; PR 50
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: L27 (PR 101: migration 0069, the seven re-created definers and the writer guard), merged; its merge fb8ee675b49f9460ae8332950c82b40ec30610de is an ancestor of the base 07bbe3482afec629456c4497f21a60a6d2fcef30; L23 (PR 97) likewise
PRIOR_SLICES: L27 p3-strip-invisible-member-names (docs/sessions/web-mvp-phase3-readiness-p3-strip-invisible-member-names.md); L23 p3-public-name-invisible-chars (docs/sessions/web-mvp-phase3-readiness-p3-public-name-invisible-chars.md); L2 p3-session-text-control-chars (docs/sessions/web-mvp-phase3-readiness-p3-session-text-control-chars.md)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # one migration in slot 0070 (one new SECURITY INVOKER function without grants, six CREATE OR REPLACE re-creations with owner, ACL and attributes pinned, a migrate-time owner check, a guarded idempotent cleanup); opus/max security round
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: section 10 U1 - create packages/db/migrations/0070_member_name_control_chars.sql section A (the threat-model header, the owner assertion, public.member_name_apply_rule with its attributes, REVOKE and COMMENT), apply it on a scratch DB under the lock, run L29-F1-F5 (the count and tail pins stay red until U4, G2 until U5), commit in the worktree
REMAINING_BLOCKERS: none
```
