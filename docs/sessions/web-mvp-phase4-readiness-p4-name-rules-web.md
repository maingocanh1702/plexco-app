<!-- review-readiness: code-ready -->

# Step-0 readiness: L43 p4-name-rules-web (session P4-S6c)

> Agent-facing. Step-0 readiness readers A (Q1, Q5, Q6) and B (Q2, Q3, Q4, Q7), opus, one live at a time (run 1). This file was
> written by the step-0 readiness-file writer (opus, run 1) from their notes and the orchestrator's decisions. Writers opus (W1 the shared
> rule, the web models, the form and the validator; W2 the three readers and the route; W3 tests); reviewers R1a, R1b and SEC opus, one
> after another (Claude subagents: the Web MVP program's named exception DD-122 D4), at most 3 rounds counting pre-push rounds. RISK: P2
> (web forms, one route, one validator; USER-VISIBLE copy and limits; no money, no schema). Base
> `4566effeef395e8c662fa62c760af504e5378a60` (origin/main, the merge of PR #129, L49); branch `feat/p4-name-rules-web`; worktree
> `.autopilot/worktrees/p4-name-rules-web`; HEAD = base at step 0 (measured). Every `path:line` below was MEASURED at the base by reader A
> or B, or by this writer where marked (O). The readers' notes live outside the repo, so this file restates every fact it relies on. No
> tracked file was edited at step 0; no DB suite ran.

Short forms: a bare path is under `apps/web/` unless it starts with `packages/` or `docs/`. SFM = `apps/web/lib/session-form-model.ts`;
CSM = `apps/web/lib/club-settings-model.ts`; MSC = `apps/web/lib/me-settings-client.ts`; RAF =
`apps/web/components/sessions/roster-add-player-form.tsx`; START = `apps/web/app/api/onboarding/start/route.ts`; CCV =
`packages/db/src/club-config-validation.ts`; TSAFE = `packages/db/src/text-safety.ts`. Units: UTF-16 = `String.length`; CP = code
points `[...s].length` = SQL `char_length`.

## 1. Authority

- **DD-150**: the owner's written approval of 2026-10-26 ("Phase 4 plan approved, Q1-Q10 default") of `docs/sessions/web-mvp-phase4-plan.md`,
  whose section 3 row L43 (:59, O) is this lane. The owner's own answer Q4 (plan :111, O), applied by that approval and the owner's own
  decision (not a default of this lane), verbatim: "(a) ONE fallback string for a NULL name, chosen from strings that already exist in
  the code, no new string; (b) ONE maximum display-name length, 120 (the largest level in use, so that no stored name becomes wrong); (c)
  no DB CHECK on persons.display_name in Phase 4".
- **L42** (PR #124) did the db half of (b): ONE `DISPLAY_NAME_MAX = 120` counted in CP (TSAFE:71-76) and migration 0073 (the roster
  definer 100 -> 120). This lane is the web half.
- **The three rows** (pre-existing contracts, O): `## task: name-readers-null-name-one-fallback` (`docs/autopilot-backlog.md:6788`),
  `## task: club-create-sql-22023-maps-to-400` (`:6802`) and `## task: name-fields-one-visible-check-one-length-rule` (`:6833`, updated by
  L42 and left open for this lane). The lane block's "about :6782 / :7160 / :6827" are stale (section 4).
- **RO-L43-1**, "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature" (Tier B, reversible): item 3
  (B3 is an estimate: up to 300 non-test, 600 test and 20 non-docs files with a logged design reason need no ruling; counting code points
  as the SQL already does is not a change of what the server accepts), item 4 (the security unit, section 10), item 7 (database, e2e and
  local-server commands are the orchestrator's only).
- **Ruling requests RQ-L43-1** (the orchestrator's notes, outside the repo): RQ1 and RQ2 (ownership extensions, D7) and RQ3 (the e2e pin
  of D5), answered by **RO-L43-2**, "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature" (Tier B,
  reversible): RQ1 and RQ2 ACCEPTED (five files join the FILE OWNERSHIP, D7; the step-0 default, backlog rows R1 and R2 with no edit, is
  overruled), RQ3 CONFIRMED (D5), and the non-docs file ceiling raised from 20 to 24 (non-test 300 and test 600 stay; section 9).
- **Negative scope** (lane block): no server or db RULE change beyond counting code points as the SQL already does; no migration; no CHECK
  constraint (Q4 (c)); no homoglyph or confusable rule; no new dependency; no new fallback string (Q4 (a)); no change of L49's command-key
  code; PR #50 untouched.
- Dependencies: L42 merged (PR #124); L49 merged (PR #129: the base is its merge commit). RO-L43-1 item 1 (C22): L53 (PR #128, docs
  only) shares only `docs/autopilot-backlog.md`; L45 is parked and L47 waits on it, neither has a file in common with this lane.

## 2. Measured at base

### 2.1 Every name field (Q1, reader A; the last column is the target after this lane)

| # | Field | Web check today | Server rule (live) | Today | After this lane |
|---|---|---|---|---|---|
| 1 | Roster add-player (`persons.display_name`) | RAF:23-27 `addPlayerNameProblem`, :25 `name.length > DISPLAY_NAME_MAX` (UTF-16; local `DISPLAY_NAME_MAX = 100` :15); hint :126/:127 hard-codes "1–100"; docstring :31 "trimmed 1..100"; error copy :132-133 interpolates the cap; input :143 `maxLength={DISPLAY_NAME_MAX}`; visible rule `checkTypedName` :26 | TS `packages/db/src/roster-service.ts:117` `isBoundedText(name, 1, DISPLAY_NAME_MAX)` (120, CP; also refuses U+0000 and unpaired surrogates, `packages/db/src/roster-money-shared.ts:63-77`); SQL create_host_added_person live 0073:75, check :111-112 (CP, 1..120); no CHECK on the column (0073:5-6) | STRICTER (100 UTF-16 vs 120 CP) | SFM `DISPLAY_NAME_MAX` + `isBoundedName` + `checkTypedName`; `maxLength={2 * DISPLAY_NAME_MAX}` (240); the hint interpolates the cap: EQUAL (D3) |
| 2 | Me-settings display name | MSC:114-123 `displayNameProblem` (CP :116; literal 120 :118; hidden regex copy :119; visible regex copy :122); input `components/me/settings-profile-form.tsx:134` `maxLength={200}` | TS `packages/db/src/me-settings.ts:40-44` validateDisplayName (strip, trim, CP, DISPLAY_NAME_MAX, hasHiddenChar, hasVisibleChar); SQL person_profile_update live 0072:148, check :187-188 (CP) | EQUAL | SFM `DISPLAY_NAME_MAX`, `isBoundedName`, `hasHiddenChar`, `hasVisibleChar` (no copies): EQUAL, plus the unpaired-surrogate refusal (stricter, D4); `maxLength={2 * DISPLAY_NAME_MAX}` (D7, RO-L43-2 item 2) |
| 3 | Club name, club settings (`tenants.name`) | CSM:36-41 `clubNameProblem`, :39 `name.length > 120` (UTF-16 on purpose, docstring :30-31); `checkTypedName` :40; input `components/settings/club-profile-form.tsx:113` `maxLength={200}` | TS CCV:68-69 `name.length > 120 \|\| checkTypedName(name) === null` (UTF-16); SQL tenant_profile_update live 0072:337, check :374 (CP); CHECK `tenants_name_len_chk` 0039:129-130 (CP, 1..120) | EQUAL to TS; web and TS STRICTER than SQL | SFM `CLUB_NAME_MAX` counted in CP in CSM and CCV (the counting only): EQUAL to SQL (D2); `maxLength={2 * CLUB_NAME_MAX}` (D7, RO-L43-2 item 2) |
| 4 | Club name, onboarding create-club | client `lib/new-club-form.ts:48` validateNewClub, :52-53 `name.length` vs `MAX_NAME_CHARS = 120` (:6, UTF-16); input `components/onboarding/new-club-form.tsx:136` `maxLength={120}`; START:65 `checkTypedName(stripInvisibleChars(body.name)) ?? ""`, :76-79 `name.length > MAX_TENANT_NAME_CHARS` (:20, 120, UTF-16) | SQL tenant_provision live 0072:253: its own check :269-270 is the rule only (22023 'name required'), no length; the length is `tenants_name_len_chk` at the INSERT :276-277 (CP) | client = route; both STRICTER than SQL | START counts CP with `CLUB_NAME_MAX` (D2) and answers a 22023 with 400 (D6): EQUAL to SQL; the client form counts CP with `CLUB_NAME_MAX` and `maxLength={2 * CLUB_NAME_MAX}`: EQUAL (D7, RO-L43-2 item 1) |
| 5 | Club public alias (`tenants.public_alias`) | CSM:64-71 `publicAliasProblem` (CP :66; literal 60 :68; `hasHiddenChar` :69; inline visible regex :70) | SQL tenant_public_alias_set live 0072:747, check :808 (CP, 1..60); CHECK 0060:32 | EQUAL (its TS twin `packages/db/src/public-alias.ts` was not opened by reader A) | the inline visible regex :70 becomes SFM `hasVisibleChar` (D1); cap and count unchanged: EQUAL |

Outside the lane (reader A, rows 6-7): the session venue name, area and address (not person names; outside DD-150 Q4); the guest name
(`session_guest_notes.guest_name`) has no web check, and its server rule is 1..100 CP (`packages/db/src/session-service.ts:2740`, 0044:95).

### 2.2 The visible and hidden character rules (readers A and B)

- The hidden-char regex exists twice: SFM:102 (`hasHiddenChar` :101-103, exported) and MSC:119 (SFM:96-99: "copied from
  me-settings-client.ts").
- The visible regex exists three times: SFM:161-162 `VISIBLE_CHAR = /[^\s\p{DI}]/u` (module-private, "Copy of VISIBLE_CHAR in
  packages/db/src/text-safety.ts"), MSC:122 and CSM:70. The web exports no `hasVisibleChar`; the db exports one (TSAFE:122; its
  VISIBLE_CHAR :114 is not exported). VISIBLE_CHAR is pinned only indirectly, through `checkTypedName` in AG2 (lead correction B-C2).
- SFM `checkTypedName` :167-169 = strip, trim, `hasHiddenChar(name) || !VISIBLE_CHAR.test(name) ? null : name`. SFM's imports :1-4 are
  web-local only; a client file already imports it (RAF:7), as do CSM:3, `lib/new-club-form.ts:2` and MSC:4. SFM:106-111 declares itself
  the web's one copy ("Client code cannot import the db package (FE-INV-3) ... Do not fork it").
- An unpaired surrogate (reader A OQ4): the server roster rule refuses it (`roster-money-shared.ts:73-75`); the web `checkTypedName` does
  not (HIDDEN_CHAR :102 has no `\p{Cs}`; VISIBLE_CHAR matches it). What validateDisplayName does with one was not measured.
- Server counting: `me-settings.ts:43` and `roster-money-shared.ts:64-67` count CP; `session-service.ts:2752` has a module-local CP helper
  (not exported); CCV:65-69 counts UTF-16 (lead correction B-C1).

### 2.3 Where a shared client-safe rule can live (Q2, reader B)

- `packages/core/package.json:6-15` exports `.` and `./i18n`, with no runtime dependencies (:20-24). The `.` entry is client-safe (a "use
  client" file imports a runtime value from it: `components/me/settings-profile-form.tsx:1`, :3 `GENDER_VALUES`); `./i18n` is not
  (`node:async_hooks`, `packages/core/src/i18n.ts:14`; `lib/i18n-client.tsx:7`).
- `packages/db/package.json:6-18` exports `.`, `./schema`, `./connector-crypto`, `./zalo-bot-api` and `./read-bounded-body` (no
  `./text-safety`); runtime deps `@aws-sdk/client-kms`, `drizzle-orm`, `pg` (:24-28): server-only. No "use client" file imports
  `@plexco/db` (grep empty). `apps/web/next.config.mjs:77` transpiles both packages.
- The db root entry re-exports `DISPLAY_NAME_MAX`, `validateDisplayName`, `checkTypedName`, `normalizeExternalName`,
  `STRIP_CHAR_RANGES` and `stripInvisibleChars` (`packages/db/src/index.ts:270-288`), not hasHiddenChar or hasVisibleChar; `pgErrorHasCode`
  at :37.
- (O) `validatePatch` (CCV:59) is NOT on the db root entry: `packages/db/src/index.ts:27-36` re-exports from `./club-config.js` only
  `CLUB_ACTION`, `ClubConfigError`, `getClubConfig`, `updateClubConfig` and types; `packages/db/src/club-config.ts:14-18` imports
  validatePatch and :20-25 re-exports ClubConfigError and types only. Its one existing test is the block at
  `packages/db/src/member-name-invisible-chars.test.ts:2373` ("L29-TW T2 validatePatch refuses with checkTypedName"; import :22), in a file
  that needs the database (`setupRlsTestContext`, :27).
- Parity tests today, all in `lib/session-form-model.test.ts` (pure, node vitest, no DATABASE_URL_TEST): imports from the db ROOT (:1-5);
  W7 (:473); SF-PIN (:643, a 30_000 budget); L29-AG2 (:666-700: every scalar x 3 positions x 4 mirrors `checkTypedName`, `clubNameProblem`,
  `validateNewClub`, `addPlayerNameProblem`, each position and mirror within its own 30 s budget, C12). No test pins a web cap to a db cap:
  the db one-definition guard (`packages/db/src/text-safety.test.ts:196`) scans `packages/db/src` only (:203), which is why the web's
  `DISPLAY_NAME_MAX = 100` passed it.

### 2.4 The NULL-name readers (Q3, reader B)

- `lib/roster-rules.ts:39-41` `displayNameOf = (name, t) => name ?? t("(chưa đặt tên)", "(unnamed)")`; doc :39 "The ONE place a player's
  name is rendered: a roster row may have no display name."; a pure module (not "use client"; :1-3 are all `import type`); 5 callers:
  `mark-paid-lines.tsx:37`, `mark-paid-result.tsx:31`, `roster-player-row.tsx:45`, `roster-tab.tsx:65`, `session-action-error-extra.tsx:45`.
- `components/sessions/request-inbox.tsx:98` `request.displayName ?? t("Người chơi chưa có tên", "Unnamed player")` ("use client" :1; the
  host's join-request inbox).
- `components/chat/message-list.tsx:57-61`, the author-type map `person: t("Thành viên", "Member")`, `assistant: t("Trợ lý", "Assistant")`,
  `system: t("Hệ thống", "System")`; :67-72 `sender`: a person author that is not mine and has a truthy `authorLabel` shows the label,
  else `kind[m.authorType]` (:71). So `kind.person` is the fallback of a person author whose label is null or empty ("use client" :1).
- Not person-name readers, unchanged: `lib/zalo/commands.ts:78` `deps.displayName ?? t("bạn", "you")` (the second person of a bot reply);
  the club-name fallbacks `components/shell/shell-frame.tsx:44`, `components/shell/tenant-switcher.tsx:25` and
  `components/landing/workspace-redirect.tsx:60` (source `packages/db/src/auth.ts:285-298`, fail-open nulls); `ui/spinner.tsx:10` and
  `lib/settings-error-ui.ts:52` (not names).
- Tests that pin the fallbacks: `lib/roster-rules.test.ts:125-129` (null, undefined, "Lan"); `components/sessions/request-inbox.test.tsx:151-153`
  ("Unnamed player" / "Người chơi chưa có tên"); `components/chat/message-list.test.tsx:69-78` (`authorLabel: null` expects "Member @
  msg:5", :77); `components/sessions/session-action-error-extra.test.tsx:33` ("(chưa đặt tên)", unchanged); `e2e/player.spec.ts:519-520`
  `UNNAMED = "Người chơi chưa có tên"`, used at :545 (host inbox rows); `e2e/sessions.spec.ts:550` already expects "(chưa đặt tên)";
  `e2e/golden-path.spec.ts:333/486` "Thành viên" is the role word, not the chat fallback.

### 2.5 The start route and SQL 22023 (Q4, reader B)

- START:24/:26/:29 answer 401/403/429; :35-62 the body checks (413; 400 INVALID_BODY); :63 the slug; :65 the name; :67-72 locale and
  timezone; :74-86 the comment "MAX_TENANT_NAME_CHARS mirrors tenants_name_len_chk (0039): reject here with a 400 rather than let the CHECK
  surface as a 500 from tenant_provision", the slug regex and the UTF-16 length; failure: 400 INVALID_BODY
  `t("Tên CLB hoặc slug không hợp lệ.", "Invalid club name or slug.")` (:83).
- The call :89-95 `provisionTenant(appDb().pool, {...})` = `packages/db/src/auth.ts:198-217` (the raw pg Pool, so `.code` is at the top
  level; :205-207 a refused name is sent as '' so the definer raises its 22023 'name required'; :214 23505 -> SlugTakenError; :215
  rethrow). Route mapping: :103-104 SessionReauthRequiredError -> 401 AUTH_INVALID; :106-107 SlugTakenError -> 409 SLUG_TAKEN; :109
  `throw error` (every other error, a 22023 included, is a 500).
- 22023 in the live tenant_provision (0072:253): :266-267 'invalid slug' (unreachable: START:77 uses the same regex) and :269-270 'name
  required' (reached only when the SQL rule refuses a name that the TS rule accepted: drift); :330-332 `EXCEPTION WHEN OTHERS ... RAISE`
  keeps the code.
- `pgErrorHasCode(error, code)` (`packages/db/src/pg-error.ts:1-14`, "The ONE walker for callers that branch on a pg code", walks `.cause`),
  root export `packages/db/src/index.ts:37`. apps/web has no pg-code-to-HTTP helper.
- `app/api/onboarding/start/route.test.ts`: the db mock :12-21 is an explicit factory (`stripInvisibleChars` and `checkTypedName` through
  `importOriginal`), so a new import must be added there; precedent :503-508 (SlugTakenError -> 409 SLUG_TAKEN); guard :492-500 (a
  code-less `new Error("dependency failed")` still rejects); :45 a dummy DATABASE_URL that is never connected.

### 2.6 Test rules and flakes (Q6, Q7)

- Vitest: `apps/web/vitest.config.ts:3-7` has no `environment` key: the node default, no DOM; component tests check static markup
  (`renderToStaticMarkup`). Every lane web test file is a pure module (reader A: 0 DB markers; the START test mocks the db).
- Pinned old behaviour, to move deliberately: `components/sessions/roster-add-player-form.test.tsx:2` (imports `DISPLAY_NAME_MAX` from the
  form) and :23 (the "101 characters" row; no row at the cap, no astral row); `lib/club-settings-model.test.ts:29` (title "same count as
  club-config-validation.ts: UTF-16 units") and :34-36 (60 astral accepted, 61 "too_long": pins UTF-16); `lib/new-club-form.test.ts:47-48`
  (comments only; outside ownership; both rows pass under either unit); the START test :221-225 (ASCII 121/120, unit-free). Already CP,
  the pattern to copy: `lib/me-settings-client.test.ts:50-55` (`"\u{1F600}".repeat(120)` accepted, 121 refused).
- Clerk flake list (reader B): no ACTIVE or RETIRED entry names apps/web, the onboarding route or club-config-validation, so a red in this
  lane's files is real: no rerun (caveat: ACTIVE lines 6-11 were not read).

## 3. Design and decision table

Source: the orchestrator's design (run 1). Every decision is Tier B, "default applied, pending owner sign-off" (rejected alternatives in
section 5), unless a ruling or the owner's Q4 decided it. Step-0 OQ1 of both readers (the club-name unit) is resolved by the lane block
itself: GOAL (1) "the db club-name validator counts code points" and lead (5) "switch it to the same code-point rule"; by RO-L43-1 item
3, counting code points as the SQL already does is not a ruling request.

### 3.1 Decisions D1-D8

- **D1 The shared rule home = SFM** (option (iii) of Q2). SFM gains:
  - `export const DISPLAY_NAME_MAX = 120`: the twin of TSAFE:76, pinned by a parity test importing `DISPLAY_NAME_MAX` from the db root
    (`packages/db/src/index.ts:270-288`) in `lib/session-form-model.test.ts`.
  - `export const CLUB_NAME_MAX = 120`: its own field, the twin of `tenants_name_len_chk` (0039:129-130) and tenant_profile_update
    (0072:374), NOT the person cap (two authorities: W-8 for the club, 0039:125-127; DD-150 Q4 (b) for the person; reader A Q5). Pinned by
    a behaviour parity on ONE shared input table (120 and 121 CP, astral letters) run through the web club-name check and through
    validatePatch. validatePatch is not on the db root entry (2.3, O), so the web half lives in `lib/club-settings-model.test.ts` (pure)
    and the db half in the existing validatePatch block `packages/db/src/member-name-invisible-chars.test.ts:2373` (an existing test file
    of the owned CCV; it needs the database: a writer only edits it, the orchestrator runs it under the lock).
  - `export function hasVisibleChar`: the existing VISIBLE_CHAR, exported as the twin of TSAFE:122, so MSC:122 and CSM:70 stop copying it
    (MSC:119 imports SFM `hasHiddenChar` likewise).
  - `export function isBoundedName(name, max)`: 1..max code points (`[...name].length`) with no unpaired surrogate, the web twin of
    isBoundedText (`packages/db/src/roster-money-shared.ts:63-77`); it closes reader A's OQ4 on the web side. U+0000 (isBoundedText :70)
    must be refused on the web too: acceptance A-6 proves it through the existing hidden-char rule; if it is not refused there,
    isBoundedName refuses it as well (the twin, Tier A).
  - Rejected: (i) a packages/core module (a second definition the server never reads); (ii) a new web module (one more file; SFM is
    already the web mirror with parity tests and declares itself the one copy, :106-111).
- **D2 The club name in CP** with `CLUB_NAME_MAX`: CSM `clubNameProblem` (:39), START (the constant :20 removed, the count :76-79) and CCV:68
  (the counting only: the db package cannot import SFM, so its literal 120 and its message stay): all equal to the SQL `char_length`
  rule. RO-L43-1 item 3: not a ruling request; the server margin it opens is astral names of 61-120 CP, which the SQL already accepts
  (`tenants_name_len_chk`, 0039:130; tenant_profile_update's own 22023 check, 0072:374). The CSM docstring :30-33 and the test title :29 follow the new unit.
- **D3 The roster form (RAF)**: the local `DISPLAY_NAME_MAX = 100` (:15) removed and SFM's imported; `isBoundedName(name,
  DISPLAY_NAME_MAX)` replaces the `.length` check (:25); `maxLength={2 * DISPLAY_NAME_MAX}` replaces :143 (240 UTF-16 units: the most a
  120-CP name takes); the hint's hard-coded "1–100" (:126/:127) interpolates the cap and the docstring :31 follows. L49's command-key code
  (its `replayedNotice` and `autoFocus` wiring) is untouched. The test's import of `DISPLAY_NAME_MAX` (:2) moves to SFM. Rejected:
  dropping `maxLength` (no bound on a paste); `maxLength` = the cap (it blocks astral names: threat 5).
- **D4 Me-settings** (MSC `displayNameProblem`, :114-123): `DISPLAY_NAME_MAX`, `isBoundedName` and SFM's `hasHiddenChar` and
  `hasVisibleChar` replace the literal 120 (:118) and the regex copies (:119, :122). Equal to the server (`packages/db/src/me-settings.ts:40-44`)
  except that an unpaired surrogate is refused (stricter, never more permissive).
- **D5 The ONE NULL-name fallback** (Q4 (a) is the owner's decision; the pair is the Tier B choice): the existing `displayNameOf`
  (`lib/roster-rules.ts:39-41`), pair t("(chưa đặt tên)", "(unnamed)"). `request-inbox.tsx:98` and `message-list.tsx` call it; in the chat
  only the person branch reached when `authorLabel` is null or empty (:57-61, :67-72), the assistant and system labels kept. Its doc
  comment :39 widens to name the three readers (no code change). The three pairs and the choice:
  - "(chưa đặt tên)" / "(unnamed)": reads as "no name" in a roster row, a join-request inbox and a chat author; it already has 5 callers,
    so the fewest screens change. CHOSEN.
  - "Người chơi chưa có tên" / "Unnamed player": wrong for a chat author who is not a player (a host or an admin).
  - "Thành viên" / "Member": reads like a role (the membership-role word, `components/player/player-views.test.tsx:146-149`); false on a
    guest's roster row or a requester's inbox row.
  - Not changed (not person-name readers, or the second person): `lib/zalo/commands.ts:78`, `components/shell/shell-frame.tsx:44`,
    `components/shell/tenant-switcher.tsx:25`, `components/landing/workspace-redirect.tsx:60`.
  - Tests that move: `components/sessions/request-inbox.test.tsx:151-153`, `components/chat/message-list.test.tsx:77` and
    `e2e/player.spec.ts:520` (conductor ruling request RQ3, read as an existing test file of an owned unit: the one constant, nothing
    else; the orchestrator runs that spec).
- **D6 The start route**: a SQL 22023 from tenant_provision (0072:266-270) is caught through the existing `pgErrorHasCode`
  (`packages/db/src/index.ts:37`) and answered 400 INVALID_BODY with the route's existing pair t("Tên CLB hoặc slug không hợp lệ.",
  "Invalid club name or slug.") (:83): no new string; the body carries the code and that pair only (no SQL message, no stack). Every other
  db error still re-throws (5xx). The route test's db mock (:12-21) gains `pgErrorHasCode`: the real walker through `importOriginal`, as
  the factory already does for `stripInvisibleChars` and `checkTypedName`.
- **D7 The ownership extension** (RO-L43-2 items 1, 2 and 4: RQ1 and RQ2 accepted, "decided by the conductor under the owner's
  delegation of 2026-10-22, not an owner signature"; Tier B, reversible). Five files join the FILE OWNERSHIP and the step-0 default
  (backlog rows R1 and R2, no edit) is dropped. Once done, none of them is stricter than the server on length, and none is more
  permissive:
  - `lib/new-club-form.ts`: the local `MAX_NAME_CHARS = 120` (:6, no other user at the base) removed and SFM's `CLUB_NAME_MAX` imported;
    the too-long check (:53) counts code points with `isBoundedName(name, CLUB_NAME_MAX)`; the copy (:55-56) interpolates the cap (no new
    string). Equal to START after D2 and to the SQL `char_length` rule; AG2 (:666-700) already runs `validateNewClub` as one of its four
    mirrors and stays green.
  - `components/onboarding/new-club-form.tsx:136`: `maxLength={120}` -> `maxLength={2 * CLUB_NAME_MAX}` (240).
  - `lib/new-club-form.test.ts`: only where it pins the count (the UTF-16 comments :47-48); its rows (:39-40, :46-48) pass under either
    unit.
  - `components/settings/club-profile-form.tsx:113`: `maxLength={200}` -> `maxLength={2 * CLUB_NAME_MAX}` (240), that line only.
  - `components/me/settings-profile-form.tsx:134`: `maxLength={200}` -> `maxLength={2 * DISPLAY_NAME_MAX}` (240), that line only.
  - Why: the attribute is only a coarse cap in UTF-16 units and the JS rule decides, so a valid 120-CP astral name is no longer blocked
    (it was at 61-120 astral CP on the create-club form and at 101-120 on the two 200 inputs). A file beyond the FILE OWNERSHIP as
    extended here is a ruling request; the non-docs ceiling is 24 (section 9). The PR body's "Deviations" names this extension (RO-L43-2).
- **D8 The rows** (GOAL (4)): `name-readers-null-name-one-fallback` and `club-create-sql-22023-maps-to-400` closed BY HAND in the L37/L58
  form (status merged + `merged:` + `note_merged:`, no PR number or SHA), each with a slice-unique bare-identifier `merged_probe` verified
  ABSENT at the base by `git grep -w` at the rows step (O: `CLUB_NAME_MAX` and `isBoundedName` are absent at the base, 0 files);
  `name-fields-one-visible-check-one-length-rule` (:6833) closed only if every open item it lists is done here, else a dated update line
  and it stays open. New rows: none (RO-L43-2 dropped R1 and R2, D7).

### 3.2 Route error mapping (decision table, START after D6)

| # | `provisionTenant` outcome | Answer | Body | Proof |
|---|---|---|---|---|
| 1 | resolves with an id | as today | as today | existing tests |
| 2 | SessionReauthRequiredError | 401 AUTH_INVALID (as today, :103-104) | the existing pair | existing tests |
| 3 | SlugTakenError (23505, `auth.ts:214`) | 409 SLUG_TAKEN (as today, :106-107) | the existing pair | :503-508 (A-19) |
| 4 | an error whose chain carries code 22023 (top level or `.cause`) | 400 INVALID_BODY | exactly the :83 pair; no SQL text, no stack | A-17 |
| 5 | another coded pg error (for example 42501) | re-thrown (5xx), as today | none of the route's | A-18 |
| 6 | a code-less error | re-thrown (5xx), as today | none of the route's | the guard :492-500 (A-19) |

The 22023 check sits after the two class checks and before the re-throw at :109. Row 4 also covers 'invalid slug' (:266-267), which the
route's own regex (:77) makes unreachable; the one pair names both the club name and the slug.

## 4. Lead corrections (12)

In every case the measured file wins and the design follows it.

- L-1: lead (1) RAF "about :14 / :24 / :141", copy "about :130-131": measured :15, :25, :143, copy :132-133; and the HINT :126/:127
  hard-codes "1–100" in both strings, and the docstring :31 says "trimmed 1..100" (reader A, 1).
- L-2: lead (1) "session-form-model.ts about :162 adds a THIRD inline visible-character literal beside publicAliasProblem and
  displayNameProblem": SFM contains neither; publicAliasProblem is CSM:64 (CP/60) and displayNameProblem MSC:114; SFM's VISIBLE_CHAR
  :161-162 is module-private; SFM's "public name" fields are area, venueName and venueAddress (:173-177) (reader A, 3).
- L-3: lead (1) "code points (the DB-package TS)": for the club name CCV:68 counts UTF-16; only the SQL counts CP (reader B, C1).
- L-4: lead (2) "the client models import only TYPES from @plexco/core": a "use client" file imports a runtime value from the core root
  (`components/me/settings-profile-form.tsx:3`); the root is client-safe, `./i18n` is not (reader B, Q2).
- L-5: lead (3) message-list "about :58": an author-TYPE map (:57-61), the fallback only through :71 `kind[m.authorType]` (reader B, C3);
  roster-rules :41 and request-inbox :98 are exact.
- L-6: lead (5) CCV "about :68": the check is :68-69 and the strip :65 (reader A, 4).
- L-7: the lane block's rows "about :6782 / :6827 / :7160": measured :6788 / :6833 / :6802 (O).
- L-8: me-settings "~115" (the step-0 brief): the function spans :114-123; :115 the strip, :116 the count, :118 the cap (reader A, 2).
- L-9: reader B C2: no "VISIBLE_CHAR parity test" exists as such; VISIBLE_CHAR is pinned only through `checkTypedName` in AG2, so D1's
  exported `hasVisibleChar` is pinned by AG2 through `checkTypedName`, with no new every-scalar loop (C12).
- L-10: reader B C4 and its question 2 ("0072:242-243 > 100 matches the web roster cap"): superseded. The live create_host_added_person is
  0073:75 with its check :111-112 (> 120); 0072:242 is among the superseded checks (reader A's SQL list). Raising the web cap to 120
  equals the definer.
- L-11 (O): one test that runs both the web club-name check and validatePatch needs a new db root export (validatePatch is not on it,
  2.3), so the club-name parity is ONE input table in two halves (D1).
- L-12: TSAFE :71-76, :114, :127 and CSM:39 are exact (reader A, 5).

## 5. Pinned defaults (Tier B; each "default applied, pending owner sign-off")

| # | Default | REJECTED alternative (why) |
|---|---|---|
| 1 | The shared rule in SFM (D1) | a packages/core module (a second definition the server never reads); a new web module (one more file, a second web home) |
| 2 | `CLUB_NAME_MAX` its own constant, counted in CP (D1, D2) | reusing `DISPLAY_NAME_MAX` (a later person-cap change would silently move a cap a DB CHECK enforces); keeping UTF-16 (reader A OQ1 (a): GOAL (1) and lead (5) ask for CP) |
| 3 | `maxLength={2 * DISPLAY_NAME_MAX}` (240) on the roster input (D3) | no `maxLength` (no bound on a paste); `maxLength` = the cap (it blocks valid astral names) |
| 4 | The pair "(chưa đặt tên)" / "(unnamed)" through `displayNameOf` (D5) | "Người chơi chưa có tên" / "Unnamed player" (wrong for a non-player chat author); "Thành viên" / "Member" (reads as a role) |
| 5 | 22023 -> 400 INVALID_BODY with the existing :83 pair (D6) | a new pair (the lane block (4): reuse first; Q4 (a): no new string) |
| 6 | The ownership extension (D7; RO-L43-2, the conductor's ruling on RQ1 and RQ2): the create-club client counts code points on `CLUB_NAME_MAX`; `maxLength` 240 (2 x the cap) on the create-club, club-settings and me-settings name inputs | backlog rows R1 and R2 with no edit (the step-0 default, overruled by RO-L43-2: a second UTF-16 definition of 120 on the create-club form is the drift the lane exists to remove, and the 120 and 200 attributes block valid astral names) |
| 7 | The club-name parity in two halves on one input table (D1) | a new db root export of validatePatch (`packages/db/src/index.ts` is outside the ownership); a web test importing db source by a relative path (no precedent measured) |

USER-VISIBLE (each "default applied, pending owner sign-off"; no new string):

- The roster cap 100 -> 120: names of 101-120 CP are accepted at the roster; the hint's "1–100" (RAF:126/:127) and the error copy
  (:132-133, which interpolates the cap) now say 120.
- The inbox fallback "Người chơi chưa có tên" / "Unnamed player" and the chat person-author fallback "Thành viên" / "Member" both become
  "(chưa đặt tên)" / "(unnamed)" (D5).
- `maxLength` 240 on the roster input (UTF-16 units; the JS rule decides at 120 CP).
- `maxLength` 240 UTF-16 units on the create-club, club-settings and me-settings name inputs (was 120 / 200 / 200), "default applied,
  pending owner sign-off" (D7, RO-L43-2): the JS rule decides at 120 CP, and the create-club form now accepts club names of 61-120
  astral CP, as the start route does.
- Behaviour without copy: club names of 61-120 astral CP are accepted at club settings and at the start route (equal to the SQL); an
  unpaired surrogate is refused in the roster and me-settings forms; a SQL 22023 at club creation answers 400 with the existing pair
  instead of a 500.

## 6. Implementation steps

1. **W1**: SFM (D1), CSM (D2), MSC (D4), RAF (D3), CCV:68 (D2) and the RO-L43-2 extension (D7), with the existing tests that pin the old behaviour moved (the roster
   test :2/:23, the club-settings test :29/:34-36) so the focused files stay green.
2. **W2**: the readers (D5: `request-inbox.tsx`, `message-list.tsx`, the `roster-rules.ts` doc comment) and their pins (:151-153, :77,
   `e2e/player.spec.ts:520`); START (D2, D6) and the route test's mock.
3. **W3**: the new tests of section 7, including the db half `packages/db/src/member-name-invisible-chars.test.ts:2373` (edited only; the
   orchestrator runs it under the lock), each with its planted mutation (R1b).
4. **O-rows**: D8 in `docs/autopilot-backlog.md`.

GitNexus `impact` before each exported-symbol edit (`checkTypedName`'s module, `clubNameProblem`, `publicAliasProblem`,
`displayNameProblem`, `addPlayerNameProblem`, `validatePatch`, `displayNameOf`; HIGH or CRITICAL recorded in the PR body), `detect_changes`
before every commit.

## 7. Acceptance matrix (A-1..A-22)

Each new test must FAIL on its planted mutation (R1b).

| ID | Expected result | Proving test |
|---|---|---|
| A-1 | SFM `DISPLAY_NAME_MAX` equals `@plexco/db` `DISPLAY_NAME_MAX` (120) | `lib/session-form-model.test.ts` |
| A-2 | `isBoundedName(x, 120)`: "" refused; 120 ASCII accepted, 121 refused; `"\u{1F600}".repeat(120)` (240 units) accepted, 121 refused | `lib/session-form-model.test.ts` |
| A-3 | `isBoundedName`: a lone high or low surrogate (alone or inside a name) refused; a valid pair accepted | `lib/session-form-model.test.ts` |
| A-4 | `hasVisibleChar` refuses whitespace-only and default-ignorable-only strings and accepts a letter (the regex `/[^\s\p{DI}]/u` unchanged); AG2 (:666-700) green unchanged | `lib/session-form-model.test.ts` |
| A-5 | Roster: 101 and 120 CP accepted, 121 refused, 120 astral accepted (counted in CP); the "101 characters" row relabelled; the cap imported from SFM | `components/sessions/roster-add-player-form.test.tsx` |
| A-6 | Roster: U+0000 inside a name refused (as isBoundedText :70) | `components/sessions/roster-add-player-form.test.tsx` |
| A-7 | Roster: the rendered input carries `maxLength="240"`; the hint shows 120 (static markup) | `components/sessions/roster-add-player-form.test.tsx` |
| A-8 | Roster: production-shaped names (emoji with ZWJ, combining marks, bidi-wrapped, hidden-only) answer as the server rule: accepted exactly when the db `checkTypedName` (root entry) accepts and the CP count is 1..120 | `components/sessions/roster-add-player-form.test.tsx` |
| A-9 | Me-settings: 120 astral accepted, 121 "too_long"; an unpaired surrogate refused; the existing rows (:50-55, :72, :80-81, :85) green | `lib/me-settings-client.test.ts` |
| A-10 | Club settings: 120 astral accepted, 121 astral "too_long" (the :34-36 rows move from 60/61 to 120/121; the title :29 says code points); ASCII 120/121 (:32-33) and 120 + 3 ZWSP (:44) unchanged | `lib/club-settings-model.test.ts` |
| A-11 | Club-name parity, db half: validatePatch on the same table: 120 astral accepted, 121 astral refused with "name must be 1-120 printable chars" | `packages/db/src/member-name-invisible-chars.test.ts` (orchestrator, DB) |
| A-12 | Alias: `publicAliasProblem` unchanged (the CP/60 rows :85-87, :162-163, :209-210 green) | `lib/club-settings-model.test.ts` |
| A-13 | Inbox: a NULL `displayName` renders "(unnamed)" (en) and "(chưa đặt tên)" (vi), never "", "null" or "Unnamed player" | `components/sessions/request-inbox.test.tsx` |
| A-14 | Chat: a person author with `authorLabel` null and with "" renders "(unnamed)"; assistant and system keep "Assistant" and "System"; mine keeps "You" | `components/chat/message-list.test.tsx` |
| A-15 | `displayNameOf` (:125-129) green unchanged | `lib/roster-rules.test.ts` |
| A-16 | START: 120 astral CP accepted (provisionTenant gets the name); 121 astral refused with 400 INVALID_BODY; ASCII 121/120 (:221-225) unchanged | `app/api/onboarding/start/route.test.ts` |
| A-17 | START: provisionTenant rejects with a 22023-coded error (top level, and under `.cause`) -> 400 INVALID_BODY with exactly the :83 pair; the body holds no "tenant_provision" text | `app/api/onboarding/start/route.test.ts` |
| A-18 | START: another coded pg error (42501) still rejects (5xx) | `app/api/onboarding/start/route.test.ts` |
| A-19 | START: the code-less guard :492-500 and the 409 precedent :503-508 green unchanged | `app/api/onboarding/start/route.test.ts` |
| A-20 | e2e host inbox: the unnamed row is found by "(chưa đặt tên)" (:520, used at :545) | `e2e/player.spec.ts` (orchestrator) |
| A-21 | One definition: outside SFM no non-test file under `apps/web` declares `DISPLAY_NAME_MAX` or `CLUB_NAME_MAX` or holds the visible-regex literal (a source guard modelled on `packages/db/src/text-safety.test.ts:196`) | `lib/session-form-model.test.ts` |
| A-22 | The RO-L43-2 extension (D7): `validateNewClub` counts code points against `CLUB_NAME_MAX` (120 astral letters accepted, 121 refused), and the create-club, club-settings and me-settings name inputs carry `maxLength` = 2 x their cap | `lib/new-club-form.test.ts` (+ the A-21 source guard for the three `maxLength` values) |

## 8. Verification

- Writers (no DB, no `next`): `pnpm --filter @plexco/web exec vitest run lib/session-form-model.test.ts lib/club-settings-model.test.ts
  lib/me-settings-client.test.ts lib/roster-rules.test.ts components/sessions/roster-add-player-form.test.tsx
  components/sessions/request-inbox.test.tsx components/chat/message-list.test.tsx app/api/onboarding/start/route.test.ts`; `pnpm -w lint`;
  `pnpm -w format:check`; `pnpm review:check:changed`.
- Orchestrator only (RO-L43-1 item 7): `pnpm -w typecheck` (the web runs `next typegen`); the db half
  `packages/db/src/member-name-invisible-chars.test.ts` and `pnpm -w test` with `DATABASE_URL_TEST` through the lane's locked-run wrapper;
  the browser leg `e2e/player.spec.ts` under the lock (fallback: the CI e2e job); `pnpm build` once (sandbox off); the full
  `pnpm review:check`.
- C11/C12: no new every-scalar loop (AG2 is reused); any loop test at most about 3 s locally, with its own 30_000 budget.
- Q7: no flake-list entry covers these paths: a red is real, no rerun.

## 9. Budget (B3)

- Estimate (lane block): 170 non-test / 340 test / 510 total lines (docs excluded), 16 files, 0 migrations. RO-L43-1 item 3: a logged
  design-reason overrun up to 300 non-test / 600 test / 20 non-docs files needs no ruling; above any of them, a ruling request before the
  next writer.
- Planned 23 non-docs files, a logged overrun of the 16-file estimate, within the ceiling of 24 (RO-L43-2 item 4 raised the 20 of
  RO-L43-1 item 3 to 24; non-test 300 and test 600 stay). Design reasons: the db half of the club-name parity lives in
  `packages/db/src/member-name-invisible-chars.test.ts` because validatePatch is not on the db root entry (D1, O); the e2e pin
  `apps/web/e2e/player.spec.ts` (RQ3); the `roster-rules.ts` doc comment (D5); the five files of the ownership extension (D7, RO-L43-2:
  the Q1 table found these name fields outside the block's list).
  - 13 non-test: SFM, CSM, MSC, `apps/web/lib/roster-rules.ts` (doc comment only), RAF, `apps/web/components/sessions/request-inbox.tsx`,
    `apps/web/components/chat/message-list.tsx`, START, CCV, `apps/web/lib/new-club-form.ts`,
    `apps/web/components/onboarding/new-club-form.tsx`, `apps/web/components/settings/club-profile-form.tsx` (:113 only),
    `apps/web/components/me/settings-profile-form.tsx` (:134 only).
  - 10 test: `apps/web/lib/session-form-model.test.ts`, `apps/web/lib/club-settings-model.test.ts`, `apps/web/lib/me-settings-client.test.ts`,
    `apps/web/components/sessions/roster-add-player-form.test.tsx`, `apps/web/components/sessions/request-inbox.test.tsx`,
    `apps/web/components/chat/message-list.test.tsx`, `apps/web/app/api/onboarding/start/route.test.ts`,
    `packages/db/src/member-name-invisible-chars.test.ts`, `apps/web/e2e/player.spec.ts`, `apps/web/lib/new-club-form.test.ts` (only
    where it pins the count).
  - 2 docs: `docs/autopilot-backlog.md` and this file.
- MIGRATION: none.

## 10. Threat model

Verbatim from the lane block: defends against (1) a web form accepting a name the server refuses (a confusing late error) or refusing
one the server accepts (the L42 gap), (2) the layers drifting apart again (the parity test, the one definition), (3) a NULL name
rendered as an empty string or "null" in any reader, (4) a SQL 22023 surfacing as a 500 with internals, (5) the `maxLength` attribute
silently truncating or blocking valid astral input. Not defended: homoglyphs and confusables (Q3, deferred by the owner), stored
production values nobody here can measure.

| # | Threat | Defended by |
|---|---|---|
| 1 | a web form accepting a name the server refuses, or refusing one it accepts | D1-D4, D6; 2.1 rows 1-5 (every lane field equal to its server rule, or stricter where named); A-2, A-3, A-5, A-6, A-8, A-9, A-10, A-11, A-16 |
| 2 | the layers drifting apart again | D1 (one web definition in SFM); the parity pins A-1, A-10 with A-11, the source guard A-21 |
| 3 | a NULL name rendered as "" or "null" | D5 (one `displayNameOf`; the chat's empty label too); A-13, A-14, A-15, A-20 |
| 4 | a SQL 22023 surfacing as a 500 with internals | D6 and 3.2; A-17 (no SQL text in the body), A-18, A-19 |
| 5 | `maxLength` truncating or blocking valid astral input | D3 and D7 (240 = 2 x the cap on the roster, create-club, club-settings and me-settings name inputs); A-7 (the roster) |

Also named: RO-L43-2 brought the RQ1/RQ2 surfaces into the lane (D7: `maxLength` 240 on the create-club, club-settings and me-settings
name inputs, the create-club count in code points), so none stays stricter than the server on length; the alias TS twin was not opened
(2.1 row 5).

**SECURITY_REVIEW: required because the lane edits server-route validation and error mapping** (RO-L43-1 item 4). SEC (opus, alone,
after R1b) checklist: threats (1)-(5); no SQL internals or stack in the 400/5xx bodies; another db error still answers 5xx; no widening
beyond the SQL `char_length` rule; the web never more permissive than the server.

## 11. Open

- **In scope: 0.** RQ1, RQ2 and RQ3 are answered by RO-L43-2: RQ1 and RQ2 accepted (the ownership extension D7; the default rows R1 and
  R2 dropped), RQ3 confirmed (D5).
- Out of scope, named, behaviour pinned:
  - Unchanged: the guest name (1..100 CP on the server, no web check), the session venue fields, homoglyphs and confusables, the shell
    club-name fallbacks and `lib/zalo/commands.ts:78`.
  - Reader gaps (named, not blocking): the alias TS twin `packages/db/src/public-alias.ts` (row 5 rests on CSM's docstring);
    validateDisplayName's answer to an unpaired surrogate (the web refuses it: stricter either way); the flake list's ACTIVE lines 6-11.
- Backlog: no new row (RO-L43-2 dropped R1 and R2); the two rows closed by hand and the third closed or updated (D8).

## 12. Closure matrix (12 of 12 PASS)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the worktree HEAD at step 0, the merge of PR #129 (measured); every TARGET_FILES path exists at the base (`ls`, O) | PASS |
| 2 | Decisions in scope final | DD-150 Q4 (the owner's); the three rows as the contract; RO-L43-1 (conductor); D1-D8 pinned as defaults pending owner sign-off (section 5) | PASS |
| 3 | Scope IN/OUT and owner clear | the lane block's FILE OWNERSHIP as extended by RO-L43-2 (RQ1 and RQ2, D7); the negative scope (section 1); the file list (section 9) | PASS |
| 4 | Dependencies classified | L42 merged (PR #124), L49 merged (PR #129, the base); plan :92 `L43 <- L42, L49`; RO-L43-1 item 1 (C22): L53 (PR #128, docs only) shares only `docs/autopilot-backlog.md`, L45 (parked) and L47 (waits on L45) share no file (section 1) | PASS |
| 5 | Live schema and code match | section 2 measured at the base; no schema, migration or SQL change | PASS |
| 6 | Data, API, state, auth contract | no schema or HTTP shape change; one new answer (22023 -> 400 INVALID_BODY with an existing pair, 3.2); the club-name count in CP = the SQL (D2); USER-VISIBLE listed (section 5) | PASS |
| 7 | Fail-closed, idempotency, order | every web check equal to or stricter than its server rule (2.1); the route table 3.2 (only 22023 mapped, everything else re-thrown) | PASS |
| 8 | Open questions in scope = 0 | section 11 | PASS |
| 9 | Acceptance matrix with expected results | section 7 (A-1..A-22) | PASS |
| 10 | Migration, security, rollback | no migration; SEC planned (section 10); rollback = revert the PR | PASS |
| 11 | First slice hard dependencies merged | L42 and L49 merged; W1 depends on nothing unmerged | PASS |
| 12 | Implementation handoff ready | sections 3 and 5-8 | PASS |

## 13. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-27
AUTHORITY_SHA: 4566effeef395e8c662fa62c760af504e5378a60
BASE_BRANCH: main
TARGET_FILES:
  - apps/web/lib/session-form-model.ts (edited: DISPLAY_NAME_MAX, CLUB_NAME_MAX, the exported hasVisibleChar and isBoundedName, D1)
  - apps/web/lib/session-form-model.test.ts (edited: the DISPLAY_NAME_MAX parity, the isBoundedName and hasVisibleChar cases, the source guard)
  - apps/web/lib/club-settings-model.ts (edited: clubNameProblem in code points with CLUB_NAME_MAX, hasVisibleChar in publicAliasProblem)
  - apps/web/lib/club-settings-model.test.ts (edited: the title :29 and the rows :34-36 to code points, the web half of the club-name parity)
  - apps/web/lib/me-settings-client.ts (edited: displayNameProblem on the shared cap and rules, D4)
  - apps/web/lib/me-settings-client.test.ts (edited: the unpaired-surrogate case)
  - apps/web/lib/roster-rules.ts (edited: the displayNameOf doc comment only, D5)
  - apps/web/lib/roster-rules.test.ts (unchanged: the displayNameOf pin :125-129 stays green)
  - apps/web/components/sessions/roster-add-player-form.tsx (edited: the name rule only, D3; the command-key code untouched)
  - apps/web/components/sessions/roster-add-player-form.test.tsx (edited: the cap import, the boundary, astral, U+0000 and maxLength rows)
  - apps/web/components/sessions/request-inbox.tsx (edited: the fallback through displayNameOf, D5)
  - apps/web/components/sessions/request-inbox.test.tsx (edited: the fallback pin :151-153)
  - apps/web/components/chat/message-list.tsx (edited: the person-author fallback through displayNameOf only, D5)
  - apps/web/components/chat/message-list.test.tsx (edited: the fallback pin :77)
  - apps/web/app/api/onboarding/start/route.ts (edited: CLUB_NAME_MAX in code points, 22023 to 400 INVALID_BODY, D2 and D6)
  - apps/web/app/api/onboarding/start/route.test.ts (edited: pgErrorHasCode in the mock, the astral and 22023 cases)
  - apps/web/e2e/player.spec.ts (edited: the UNNAMED constant :520 only, RQ3)
  - apps/web/lib/new-club-form.ts (edited: CLUB_NAME_MAX imported in place of MAX_NAME_CHARS, the name counted in code points with isBoundedName, D7)
  - apps/web/lib/new-club-form.test.ts (edited only where it pins the count: the UTF-16 comments :47-48, D7)
  - apps/web/components/onboarding/new-club-form.tsx (edited: maxLength = twice CLUB_NAME_MAX at :136, D7)
  - apps/web/components/settings/club-profile-form.tsx (edited: maxLength = twice CLUB_NAME_MAX at :113 only, D7)
  - apps/web/components/me/settings-profile-form.tsx (edited: maxLength = twice DISPLAY_NAME_MAX at :134 only, D7)
  - packages/db/src/club-config-validation.ts (edited: the counting only at :68, D2)
  - packages/db/src/member-name-invisible-chars.test.ts (edited: the validatePatch rows of the club-name parity, the :2373 block)
  - docs/autopilot-backlog.md (edited: the rows of D8)
SLICE: p4-name-rules-web
IN_SCOPE: the shared rule in apps/web/lib/session-form-model.ts (DISPLAY_NAME_MAX, CLUB_NAME_MAX, hasVisibleChar, isBoundedName) and its parity tests; the club-settings, me-settings and roster-form name checks on it; the ownership extension of D7 (RO-L43-2): the create-club client form counted in code points on CLUB_NAME_MAX and maxLength 240 (2 x the cap) on the create-club, club-settings and me-settings name inputs; the club-name count in code points in the start route and in packages/db/src/club-config-validation.ts; the one NULL-name fallback displayNameOf in the join-request inbox and the chat person-author fallback; the start route's 22023 to 400 INVALID_BODY; the tests of section 7; the rows of D8; this readiness file
OUT_OF_SCOPE: any server or db rule change beyond counting code points as the SQL already does; migrations and CHECK constraints; homoglyph or confusable rules; new dependencies; new strings; the command-key code of L49; the shell club-name fallbacks and the Zalo second-person reply; the guest name and the session venue fields; a new db root export; PR #50
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: L42 merged (PR #124) and L49 merged (PR #129): the base commit is the merge of PR #129
PRIOR_SLICES: L42 (merged, PR #124, migration 0073); L49 (merged, PR #129)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration; security round required (SEC, opus) because the lane edits server-route validation and error mapping; rollback = revert the PR
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 - in apps/web/lib/session-form-model.ts add DISPLAY_NAME_MAX, CLUB_NAME_MAX and the exported hasVisibleChar and isBoundedName, then move club-settings-model.ts, me-settings-client.ts, roster-add-player-form.tsx and the counting at club-config-validation.ts:68 onto them (D1-D4), then the RO-L43-2 extension (D7: new-club-form.ts and .tsx, the two settings maxLength edits); GitNexus impact before each exported symbol; commit in the worktree
REMAINING_BLOCKERS: none
```
