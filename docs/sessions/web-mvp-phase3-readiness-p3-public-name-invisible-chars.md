<!-- review-readiness: code-ready -->

# Step-0 readiness: L23 p3-public-name-invisible-chars (session P3-S15d)

> Agent-facing. Readiness reviewer: opus/max (the lane's code-reviewer model and effort). Writers: opus/max (W1-W4b), sonnet/high (W4c, W5, W6). Code
> reviewer opus/max plus a separate opus/max security round (external input on public surfaces, a SQL definer, a data backfill). RISK: P1.
> Lane contract: lane block L23 of the conductor-authored P3-S15d brief (not on main). Base `065ce65f98fa0f300414b15f7b56fd3586278b2c` (merge of PR #96, L20);
> branch `feat/p3-public-name-invisible-chars`; worktree `.autopilot/worktrees/p3-public-name-invisible-chars`, clean at step 0 (measured).
> Every `path:line` below is MEASURED at the base by the step-0 reviewers (their notes live outside the repo, `status/P3-S15d-notes`); each fact carries its repo
> `path:line`, so it can be re-checked at the base. Code points are written U+XXXX on purpose: this file holds no invisible byte.

## 1. Authority

- Owner decision 2026-10-21 (`OWNER-DECISIONS-2026-10-21.md` section A.1, confirmed by the owner in the conductor terminal), verbatim: "#61 R1-5 (default-ignorable
  code points allowed): REJECTED -> follow-up lane: strip default-ignorable / invisible code points from every publicly displayed name."
- The rejected default, as DD-138 lists it (`#61 R1-5`, L2 · #61): "4029 default-ignorable code points (260 variation selectors, 3769 unassigned) stay allowed
  anywhere, matching the display-name rule"; the consequence it names: invisible characters can be inserted to impersonate a venue name.
- Recorded on main by lane L19 (PR #93, merge `6d7bfccac7401d0052be643d29e5bb0cbfbc0c0e`; `git merge-base --is-ancestor` printed `L19_ON_BASE`):
  `docs/standards/decisions.md:1848` (DD-138), `:1857` (subsection "Kết quả ký của owner (2026-10-21)"), `:1885` (the `#61 R1-5` rejection, lane L23), `:1917`
  (the DD-138 row `#61 R1-5`, status rejected 2026-10-21, lane L23).
- Conductor ruling RO-L23-1 (2026-10-22): a conductor reading, NOT an owner approval. The publicly displayed names are the user-typed names the anonymous public
  surface renders: `sessions.area`, `sessions.venue_name`, `tenants.public_alias` (shown as `club_display_name`). `public_sessions.title` is dormant;
  `sessions.venue_address` keeps today's rule; `persons.display_name`, `tenants.name` and `memberships.display_name` are out. R2 and R3 need no ruling (0 affected
  rows); the lane defaults apply (D6, D7).
- Conductor notes A1-A3: base and migration slot 0068; the emoji consequence stated in the PR body and in a test; the S4 gate. Review per DD-122 D4 (Codex waived by
  the owner 2026-10-12). Dependencies: L19 (above) and L20 (PR #96 = the base: public venue fields, migration 0067); no lane runs beside L23.

## 2. Measured at base

| Fact | Evidence (at the base) |
|---|---|
| Q1: `public_sessions` copies area, venue_name, venue_address and title; it has no club_display_name or host_display_name column; `club_display_name` comes from the live view join | `0067:174`; catalog of plexco_smoke at tail 0067 |
| `public_sessions.title` is always NULL; `sessions` has no title column | `0067:310`, `0067:324` |
| TS rule today: `HIDDEN_CHAR` (not exported) `:24`; `VISIBLE_CHAR` `:35`; exports `hasHiddenChar` `:38`, `hasVisibleChar` `:43-44`; header `:4-5`, `:14`; no strip function | `packages/db/src/text-safety.ts` |
| No module re-exports text-safety: importers are `me-settings.ts:8`, `public-alias.ts:9`, `session-service.ts:22`; `packages/db/src/index.ts` has no text-safety line | `git grep text-safety` (non-test) |
| Create: `validateInput` `:167`; discovery check `:174-188` (`input.area.trim().length > 0` `:183`) BEFORE the text check `:223-228` (`INVALID_TEXT_FIELD` `:225`); `isOptionalText` `:121-122` tests the RAW value, no trim; insert `area` `:313`, `venueName` `:314` (`?? null`) | `packages/db/src/session-service.ts` |
| Update: `updateSession` `:1209`; text check `:1321-1326`; current row `:1353-1354`; change detection `:1458-1460` (area), `:1462-1464` (venue_name); effective area `:1528`; discovery re-check `:1538-1547`; `publishSession` `:644-654` only reads | same file |
| No other writer of area or venue_name: the only `sessions` UPDATE in migrations is `0056:395` (status, version); no session write under apps/web/app, apps/web/lib, apps/bot/src, scripts; `tenant.ts:123-126` is a test-only seam (`:74-79`) | grep at the base |
| Alias TS: `validatePublicAlias` `:44-53` (trim `:48`; length 1..60, `hasHiddenChar`, `hasVisibleChar` `:50` -> `INVALID_INPUT`); `setPublicAlias` `:91`, SQL call `:129`, error map `:136`; production caller `apps/web/app/api/onboarding/club/route.ts:79-101` (`:93`) | `packages/db/src/public-alias.ts` |
| Alias SQL: `tenant_public_alias_set(p_tenant_id, p_actor_person_id, p_alias)` `:70-161`, SECURITY DEFINER `:74`, `SET search_path = pg_catalog, public, pg_temp` `:75`; c_ws `:85`, c_space `:86`, c_reject `:89-98`, c_visible `:101-104`; NULL -> 22023 `:125-128`; trim `:129`; length and c_reject `:130`; c_visible `:131`; RAISE `:132`; REVOKE `:267`; GRANT EXECUTE TO app `:271`; no OWNER TO, no COMMENT; the only text writer of the alias | `packages/db/migrations/0060_tenant_public_alias.sql` |
| Alias columns `0060:28-34` (`schema.ts:537-541`): both NULL or both set `:31`, 1..60 chars `:32`, status pending/approved/rejected `:33-34`; no UNIQUE or normalized key; audit `0060:36-56` (decision approved/rejected, decided_by NOT NULL, FORCE RLS, append-only `:56`) | 0060, schema.ts |
| Catalog pins: A-12 block equality `public-alias.test.ts:463-479`; set definer `:374-396` (prosecdef `:386`, proconfig exactly the search_path `:387`, no PUBLIC `:389-392`, grantees exactly app `:393-396`); exact job_definer function lists `rls-invariants.test.ts:2126-2129`, `:2599-2602` | packages/db/src |
| Web mirror: `session-form-model.ts:96-100` (FE-INV-3), `hasHiddenChar` `:101-102` (= `text-safety.ts:24`), legacy skip `:105-110`, `hasNewHiddenChar` `:111-113`; `club-settings-model.ts:3` imports it, check `:55`; pin test `session-form-model.test.ts:433-446` takes its oracle from `@plexco/db` (`:1`) | apps/web/lib |
| `route.test.ts:243` sends the ALIAS (`alias(text)` `:246`) and expects 400 for a + U+200B + b among its 8 inputs; no other literal of U+200B, U+3164, U+00AD, U+FE0F or U+200D (0x, backslash-u, U+ forms) under apps/web/app or apps/web/e2e | `apps/web/app/api/onboarding/club/route.test.ts:243-249` |
| Cleanup visibility: `sessions` is FORCE RLS (`0009:26-50`, `:31`, `:50`; `0024:82`, `:125`); `tenants` is not; the harness migrates as superuser `plexco` (`test-harness.ts:815-819`); nsCtx `rls-invariants.test.ts:2105` is NOSUPERUSER NOBYPASSRLS (`test-harness.ts:852`) and migrates the chain on an empty schema (`:2122-2124`) | migrations, tests |
| Projector: `public_sessions_project_session` re-created `0067:201`, owner job_definer (`0067:26`), REVOKE PUBLIC `:379`, EXECUTE to app_worker only `:381`; raises 25000 unless read committed `:234-236`; no migration PERFORMs it today | 0067 |
| Runner: `migrate.ts:415` (`DATABASE_URL_MIGRATION`), one transaction per file (`:351`, `:357`), no superuser check | `packages/db/src/migrate.ts` |
| Q4 (plexco_smoke at tail 0067, read-only counts): area 21 rows / 8 non-null, venue_name 21 / 21, public_alias 12 / 0; 0 hold a STRIP code point, 0 turn blank, 0 public rows change (`public_sessions` empty); plexco is stale at 0031 | counts |
| Q6: tail `0067_session_venue_visibility.sql`; slot 0068. Tail pins (4): `migrate.test.ts:769`, `outbox-projector-registry.test.ts:117`, `rls-invariants.test.ts:2124`, `:4720`. Count pins 68 -> 69 (10): `migrate.test.ts:53`; `outbox-projector-registry.test.ts:114`, `:115`, `:120`; `rls-invariants.test.ts:70`, `:73`, `:1841`, `:1846`, `:4717`, `:4719` | packages/db/src |

## 3. Code-point sets

- Runtimes: Node 25.6.0 and 20.20.0, ICU 78.2, Unicode 17.0 (both link the same system ICU: one measurement). CI Node 22 is not measured locally; the
  every-code-point test proves it on the first push. PostgreSQL 16.15, UTF8, en_US.utf8 (libc); the SQL class is explicit code points, so PG's own Unicode tables
  play no part.
- DI (Default_Ignorable_Code_Point) = 4174 code points in 17 ranges. Bidi_Control = 12: U+061C, U+200E-200F, U+202A-202E, U+2066-2069.
- **STRIP = DI minus Bidi_Control = 4162 code points in 16 ranges** (byte-identical in both Node runs and in the PG sweep):
  `00AD 034F 115F-1160 17B4-17B5 180B-180F 200B-200D 2060-2065 206A-206F 3164 FE00-FE0F FEFF FFA0 FFF0-FFF8 1BCA0-1BCA3 1D173-1D17A E0000-E0FFF`.
  The JS v-flag class (DI minus Bidi_C) and the u-flag lookahead form both equal it on both runtimes. Fingerprints (sha256, 16 hex): STRIP 06d872ae68f052ad,
  REFUSE dad8470bb898f826, VISIBLE dbfc6ed4dca7d53b.
- Moves: 133 code points refused today become stripped (15 ranges: the 126 Cf inside DI incl. U+200D, plus U+034F, U+115F-1160, U+17B4-17B5, U+3164, U+FFA0);
  4029 allowed today become stripped (260 variation selectors incl. U+FE0F, 3769 unassigned DI): exactly the R1-5 number.
- **REFUSE (unchanged) = HIDDEN_CHAR minus STRIP = 112 code points in 16 ranges**: Cc 65, U+2028, U+2029, Bidi_Control 12, the 32 Cf outside DI (U+0600-0605,
  U+06DD, U+070F, U+0890-0891, U+08E2, U+110BD, U+110CD, U+13430-1343F, U+FFF9-FFFB), U+2800. Why they stay refused: bidi controls reorder visible text; the
  prepended concatenation marks render glyphs; U+FFF9-FFFB and U+13430-1343F are not DI; U+2800 is a visible blank glyph. Every invisible format character that
  `hasHiddenChar` names explicitly is inside DI.
- SQL today: c_reject (244) = HIDDEN_CHAR minus U+0000; c_ws = the JS trim set (25, U+FEFF included); the complement of c_visible (4198) = trim set or DI; the three
  declarations are byte-identical in 0055 and 0060. STRIP meets the trim set only at U+FEFF; STRIP and REFUSE are disjoint.
- PG probe: the 27 range edges stripped and matched (plain and E'' forms); every keep sample (the refuse classes, letters, combining marks, emoji, Vietnamese NFC and
  NFD, whitespace) untouched; sweep U+0001-U+10FFFF without surrogates = 4162 in 16 ranges, identical to Node; `regexp_replace` is IMMUTABLE and PARALLEL SAFE.
- Emoji consequence (PG, code points left): U+2764 U+FE0F -> U+2764; U+1F468 U+200D U+1F469 U+200D U+1F467 -> U+1F468 U+1F469 U+1F467; U+0031 U+FE0F U+20E3
  -> U+0031 U+20E3; the England tag flag -> U+1F3F4; U+1F44D U+1F3FB and U+1F1FB U+1F1F3 unchanged.

## 4. Pinned defaults

Tiers per level3 §6.1. D2-D8 are Tier B: each is "default applied, pending owner sign-off" here and in the PR body. D1, D9 and D10 are Tier A (derived).

- **D1** (Tier A, conductor reading RO-L23-1, not an owner approval): fields = `sessions.area`, `sessions.venue_name`, `tenants.public_alias`. Title dormant: no
  change. `venue_address` keeps today's rule. OUT: `persons.display_name`, `tenants.name`, `memberships.display_name`, `me-settings.ts`, `me-settings-client.ts`,
  0055 `person_profile_update`. PR-body follow-up row, verbatim: "member-facing names (persons.display_name, tenants.name, memberships.display_name) and
  sessions.venue_address still allow variation selectors and unassigned default-ignorables; extend the strip rule to them only on an owner decision".
- **D2**: STRIP = DI minus Bidi_Control, Unicode 17.0, 4162 code points in 16 ranges; REFUSE unchanged (112) (section 3). Default applied, pending owner sign-off.
- **D3**: order at every layer = strip STRIP -> the layer's existing trim -> every existing check UNCHANGED on the stripped value (`hasHiddenChar`, the web mirror
  and 0060 c_reject stay byte-identical; after the strip they can meet only the 112 REFUSE code points) -> the existing empty and visible checks. Strip before
  trim. The session service stores the stripped value (its only trim is the discovery check's): the strip runs before the create discovery check `:183` and
  before the update text check `:1321-1326` and change detection `:1458-1464`, so the stored, compared and evented value is the stripped one; a stripped value
  equal to the stored one is no change. Default applied, pending owner sign-off.
- **D4**: "refused exactly as an empty name today", per field: `public_alias` invisible-only -> refused at every layer like empty (TS `INVALID_INPUT`, the route
  answers 400 `INVALID_BODY`; SQL 22023); `area` invisible-only -> exactly as empty: refused on a public session (`MISSING_DISCOVERY_FIELDS` 400), handled as
  empty on a private one; `venue_name` invisible-only -> handled as empty (no layer refuses an empty venue_name today). No new refusal is added. Default applied,
  pending owner sign-off.
- **D5**: strip on write at both layers plus a one-time cleanup in 0068, not display-time stripping. Default applied, pending owner sign-off.
- **D6**: an approved alias the cleanup changes keeps 'approved', with one NOTICE per tenant id; the cleanup writes no `tenant_public_alias_audit` row (decision
  approved/rejected, decided_by NOT NULL, FORCE RLS). Two aliases equal after stripping are legal (no UNIQUE or normalized key). Default applied, pending owner
  sign-off.
- **D7**: a stored value left with no visible character after the strip stays unchanged and is reported by NOTICE (0 such rows at the base). Default applied,
  pending owner sign-off.
- **D8**: the cleanup fails closed on visibility: it never silently skips a row it cannot see. If `current_user` is neither superuser nor BYPASSRLS, 0068
  proceeds only when it can prove no candidate row is hidden from it (the writer measures the nsCtx case and picks the proof, for example the FORCE-RLS table holds
  no page at all), otherwise it RAISEs with the reason (apply 0068 as the superuser migration role). No new grant to any role, no new job_definer-owned function,
  no FORCE-RLS toggle. Re-projection: `PERFORM public_sessions_project_session(session_id, NULL)` for each session whose area or venue_name changed, inside 0068's
  transaction (EXECUTE is app_worker-only, `0067:381`, so only the superuser path reaches it; the read-committed check `0067:234` relies on the server default).
  The alias is served live: no re-projection. Default applied, pending owner sign-off.
- **D9** (Tier A, precedent): SQL = ONE helper function in 0068 holding the explicit 16-range bracket class (the single SQL list), owned by the migration role
  (NOT job_definer), REVOKE ALL FROM PUBLIC, no other grant unless a caller needs one; used by the re-created `tenant_public_alias_set` and by the cleanup.
  CREATE OR REPLACE restates SECURITY DEFINER and the exact SET search_path (`public-alias.test.ts:374-396`; owner and ACL kept, grantees stay app); its
  c_ws..c_visible block stays byte-equal to 0055 (`public-alias.test.ts:463-479`); the strip goes before the trim at `0060:129`. New file, 0060 untouched: the
  migrate.ts sha256 guard holds.
- **D10** (Tier A, FE-INV-3 precedent): TS = ONE explicit range list and ONE strip function in `text-safety.ts` beside `:24`, used by `session-service.ts` and
  `public-alias.ts`; its test proves over every code point 0..0x10FFFF that the function removes exactly DI minus Bidi_Control of the running Node, and pins
  4162 / 16. Web = ONE mirror in `session-form-model.ts` beside `:101-102`; `club-settings-model.ts` imports it; its every-code-point pin test imports the server's
  strip function from "@plexco/db", as `session-form-model.test.ts:433-446` does for its oracle. SQL vs TS: one SQL test proves the helper strips exactly the TS
  list over every code point (surrogates excluded).
- **D11** (the owner rule's consequence, NOT a default): U+200D and U+FE0F are stripped, so composed emoji split or render as text: a ZWJ family sequence becomes
  its separate emoji, a VS16 heart becomes the text heart (section 3). One test per layer documents the stripped result. No emoji exception: an exception would
  be a new owner decision. The PR body says so plainly.
- **D12** THREAT MODEL (stated here and in the 0068 header comment): defends against impersonation and blank-looking names on public surfaces through invisible
  code points (the R1-5 consequence: a venue name); does NOT defend against visible confusables (homoglyphs): a backlog candidate, listed in the PR body.

## 5. Implementation steps

Dependency order, one file or one section per writer, never two at once; each commits in the worktree, no push; GitNexus impact before each symbol edit,
detect_changes before each commit.

- **W1** opus/max: `text-safety.ts`: the STRIP list and ONE exported strip function beside `:24`; `hasHiddenChar` `:38` and `hasVisibleChar` `:43-44` unchanged;
  header `:4-5`, `:14` restated for the new order. `packages/db/src/index.ts`: one export line for the strip function (section 10 F1). NEW
  `packages/db/src/text-safety.test.ts`: every code point against DI minus Bidi_C of the running Node, the 4162 / 16 pin, the D11 rows.
- **W2** opus/max: `session-service.ts` validation only. Create: in `validateInput` `:167` strip area and venueName before `:174-188` and `:223-228`; the insert
  `:313-314` stores the stripped values. Update: in `updateSession` `:1209` strip before `:1321-1326`; the stripped values feed `:1458-1460`, `:1462-1464`,
  `:1528`, `:1538-1547`. `isOptionalText` `:121-122` and venueAddress unchanged. `session-service.test.ts`: rewrite `:66` (the ZWSP vector of `HIDDEN_VECTORS` x
  `TEXT_FIELDS` `:73-77` moves to R2 for area and venueName; venueAddress stays refused) and `:3117-3121` (an update to "Quan 1" + U+200B stores "Quan 1"); one
  case per row per field on create and update (section 6). No sessions route test holds a STRIP literal (section 2): none changes.
- **W3** opus/max: `public-alias.ts` `validatePublicAlias` `:44-53`: strip before the trim `:48`; `:50` unchanged. `public-alias.test.ts` TS part: `REFUSED_CPS`
  `:25` embedded rows (`:34`) of U+200B, U+3164, U+00AD move to accepted with the stored value (SAMPLES also read at `:206`); their alone rows and `:31` (U+FE0F
  alone) stay refused; `:41` (emoji + U+FE0F) stays accepted, stored without U+FE0F. `route.test.ts:243`: a + U+200B + b leaves the refusal list and becomes an
  accepted case; the other 7 inputs stay refused.
- **W4** opus/max: NEW `packages/db/migrations/0068_public_name_invisible_chars.sql`: header (D12, D2 with its Unicode version, D5-D8); the helper (D9); CREATE OR
  REPLACE `tenant_public_alias_set` with the strip before the trim (any new DECLARE line outside the A-12 slice; the M-5 no-change comparison sees the stripped,
  trimmed value); the cleanup: candidates are values matching the STRIP class; new value = the field's write transform (alias: strip then the 0060 trim; area,
  venue_name: strip only); a direct UPDATE of the alias (the set definer would reset the status and emit an event, `0060:11-12`), status kept, NOTICE per tenant
  id, no audit row (D6); blank-after-strip rows stay and are NOTICEd (D7); the visibility guard and the per-session PERFORM (D8). Note: a BYPASSRLS non-superuser
  runner with a session to re-project fails at the PERFORM (42501), still fail-closed (the file rolls back); migrate.ts isolation is unmeasured, so the W4b
  fixture proves the read-committed path under the harness.
- **W4b** opus/max: SQL tests: the alias definer rows (public-alias.test.ts DB part; `:697-713` rewritten so TS and SQL agree on the strip too); the TS-vs-SQL list
  equality over every code point; the cleanup on a fixture holding each class (an approved alias, an invisible-only row, a public session re-projected); the D8
  fail-closed branch; the emoji consequence at the SQL layer.
- **W4c** sonnet/high: the 14 pin sites (section 2, Q6) -> 0068 / 69; fix the stale "tail 0066" wording while bumping.
- **W5** sonnet/high: `session-form-model.ts`: ONE mirror strip (an explicit copy of the 16 ranges, documented like `:96-100`) beside `:101-102`; area and
  venue_name are stripped before `textOrNull` in `hasNewHiddenChar` `:111-113` and in what the form sends; legacy skip `:105-110` unchanged.
  `session-form-model.test.ts`: `:331-332` (C8 x area/venueName), `:388-389`, `:402-403` flip to stripped; review `:394` (legacy area with U+200B; recommended:
  keep the exemption proven with a REFUSE code point); rows R1-R5 per field; the every-code-point pin against the server strip; W7 `:433-446` unchanged.
- **W6** sonnet/high: `club-settings-model.ts`: import the mirror strip from `./session-form-model` (as `:3` does); `publicAliasProblem` strips before its checks
  (`:46-55`). `club-settings-model.test.ts`: `:57` (U+3164 alone) "invalid_chars" -> "empty"; `:60` (a + U+200B + b) "invalid_chars" -> null; R4, R5 rows;
  `:39`, `:56`, `:58` unchanged.

## 6. Acceptance matrix

Inputs are built with `String.fromCodePoint` (TS) and `chr()` (SQL), never pasted (section 8).

| Row | Input | area | venue_name | public_alias |
|---|---|---|---|---|
| R1 | no STRIP or REFUSE code point | stored as sent | stored as sent | trimmed, stored (today) |
| R2 | visible text with U+200B, U+00AD, U+3164, U+FE00, U+E0001 or U+2065 inside | stored without them | stored without them | stripped, trimmed, stored (pending) |
| R3 | only STRIP code points, or them plus whitespace | public: `MISSING_DISCOVERY_FIELDS` 400; private: handled as empty | handled as empty | refused like empty: `INVALID_INPUT` (route 400), SQL 22023 |
| R4 | U+2764 U+FE0F; U+1F468 U+200D U+1F469 U+200D U+1F467 | U+2764; U+1F468 U+1F469 U+1F467 | same | same |
| R5 | U+202E, U+0007, U+2028, U+2800 among visible text | `INVALID_TEXT_FIELD` (unchanged) | same | `INVALID_INPUT` / 22023 (unchanged) |
| R6 | stored value holding STRIP code points when 0068 runs | stripped once; public row re-projected | same | strip + trim once; status kept; NOTICE |

Test per cell, server layers. IDs: SS = `session-service.test.ts` (W2); PA = `public-alias.test.ts` TS part, RT = `route.test.ts` (W3); PS =
`public-alias.test.ts` DB part, MG = the 0068 cleanup test, file named in the PR (W4b); TX = `text-safety.test.ts` (W1).

| Row | area · TS | venue_name · TS | alias · TS | alias · SQL (the only SQL writer) |
|---|---|---|---|---|
| R1 | SS-area-R1 (create, update) | SS-venue-R1 | PA-R1 | PS-R1 |
| R2 | SS-area-R2 (`:66`, `:3117-3121`; equal after strip = no change) | SS-venue-R2 (`:66`) | PA-R2 (`:34`, `:206`), RT-R2 (`:243`) | PS-R2 (`:697-713`) |
| R3 | SS-area-R3 (public, private) | SS-venue-R3 | PA-R3 (alone rows, `:31`), RT-R3 | PS-R3 |
| R4 | SS-area-R4 | SS-venue-R4 | PA-R4 (`:41`), TX-R4 | PS-R4 |
| R5 | SS-area-R5 (`HIDDEN_VECTORS` rest) | SS-venue-R5 | PA-R5, RT-R5 (`:243` rest) | PS-R5 |
| R6 | MG-area-R6 (re-projected row) | MG-venue-R6 | MG-alias-R6 (approved kept) | MG-alias-R6, MG-blank (D7), MG-guard (D8) |

Web mirror rows (SF = `session-form-model.test.ts`, W5; CS = `club-settings-model.test.ts`, W6); R6 is server-only.

| Row | area · web | venue_name · web | alias · web |
|---|---|---|---|
| R1 | SF-area-R1 | SF-venue-R1 | CS-R1 |
| R2 | SF-area-R2 (`:331-332`) | SF-venue-R2 (`:331-332`, `:388-389`, `:402-403`) | CS-R2 (`:60` -> null) |
| R3 | SF-area-R3 (the empty-field outcome) | SF-venue-R3 | CS-R3 (`:57` -> "empty") |
| R4 | SF-area-R4 | SF-venue-R4 | CS-R4 |
| R5 | SF-area-R5 (C8 rest) | SF-venue-R5 | CS-R5 (`:58` unchanged) |

Cross-layer and regression: TX-ALL (the strip equals DI minus Bidi_C of the running Node over 0..0x10FFFF; 4162 / 16); SF-PIN (the mirror equals the server
strip imported from "@plexco/db", every code point); PS-PIN (the 0068 helper equals the TS list, every code point, surrogates excluded); client and server agree on
the R1-R5 inputs; unchanged and green: A-12 `public-alias.test.ts:463-479`, catalog `:374-396`, job_definer lists `rls-invariants.test.ts:2126-2129` and
`:2599-2602`, the nsCtx chain `:2122-2124`, `public-alias-nobypass.test.ts`, the me-settings tests; PIN: the 14 sites green at 0068 / 69.

## 7. Verification

Cite measured output through `| tail -40`. DB and e2e runs go through the session's lock wrapper, one at a time, one migration at a time.

1. Focused vitest per changed test file (TX, SS, PA/PS, MG, SF, CS, RT).
2. `pnpm typecheck`; `pnpm lint`; `pnpm format:check`; `pnpm review:check:changed`.
3. `NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test`.
4. `NODE_ENV=test pnpm --filter @plexco/web test` (the FULL web vitest).
5. `pnpm --filter @plexco/web exec playwright test e2e/sessions.spec.ts e2e/settings.spec.ts`.
6. Once at the final head: `pnpm build` (sandbox off) and `NODE_ENV=test DATABASE_URL_TEST=... pnpm -w test`.
7. Known flakes: the S1 list and `status/conductor-scripts/clerk-flake-list.txt`, one rerun, a second red is real; re-run the role-password step after a full run.
8. The byte check of section 8 prints 0 for every changed file.

## 8. Tool hazard

- The Edit and Write tools turn a backslash-u escape (a backslash, the letter u, four hex digits) into the raw character. Build every invisible character in TS
  tests with `String.fromCodePoint(0x200b)` (numbers, never an escape string); write the TS range list as numbers or check its bytes; in SQL build the class from
  `chr(n)` or U& literals, never a backslash-u escape; never paste an invisible character. Existing escapes (`route.test.ts:243`) must not be retyped through
  Edit/Write.
- Byte check after each write (must print 0): `LC_ALL=en_US.UTF-8 grep -c -P '[\x{00AD}\x{034F}\x{115F}\x{1160}\x{17B4}\x{17B5}\x{180B}-\x{180F}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{206F}\x{3164}\x{FE00}-\x{FE0F}\x{FEFF}\x{FFA0}]' <file>`.

## 9. Budget (B3)

Lane caps, pre-approved: 700 non-test, 1,200 test, 1,900 total, 24 files, 1 migration. Estimate: about 18 files: 8 non-test (this file, 0068, `text-safety.ts`,
`index.ts`, `session-service.ts`, `public-alias.ts`, `session-form-model.ts`, `club-settings-model.ts`) and about 10 test (incl. the 3 pin files and 2 new
files); non-test about 250-380 LOC, test about 600-750 LOC; 1 migration (0068); modules packages/db and apps/web. No B3 exception needed. Measured with
`b3-measure.sh` before the PR; a crossed cap is a ruling request before the next writer starts.

## 10. OPEN

OUT_OF_SCOPE residue (none is an open question in scope):

- O1 PR-body follow-up row (D1, RO-L23-1), verbatim: "member-facing names (persons.display_name, tenants.name, memberships.display_name) and
  sessions.venue_address still allow variation selectors and unassigned default-ignorables; extend the strip rule to them only on an owner decision".
- O2 visible confusables (homoglyphs): backlog candidate (D12).
- O3 future title source: `public_sessions.title` is dormant (`0067:310`, `:324`); any future title source applies the same strip rule (spec follow-up).
- O4 spec follow-ups, NOT edited: `git grep -i -E "default.ignorable|variation selector|R1-5"` over docs/features and docs/channels finds only
  `docs/features/BE/feature_user_settings_tech.md:212` (the persons.display_name rule: OUT) and `:457`, `:458` (dated changelog rows: never rewritten). No Reviewed
  spec line states the old allow rule for the three in-scope fields; the docs lane of owner section C documents the strip rule for them and the dormant title.
- O5 `me-settings.ts`, `me-settings-client.ts`, 0055 and their tests: OUT (RO-L23-1), untouched.

Flagged against the pins (recorded, not changed):

- F1 D10 and W1 need one more non-test file: at the base no module re-exports `text-safety.ts` (section 2), so the web pin test's import of the strip function
  from "@plexco/db" needs one export line in `packages/db/src/index.ts`. Recorded in W1, TARGET_FILES and the budget; the orchestrator confirms it as lane-owned.
- F2 resolved by measurement (step-0 H5 left it unmeasured): `route.test.ts:243` sends the alias, so its a + U+200B + b row flips (W3).

## 11. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the conductor-pinned base (A1) = the worktree HEAD at step 0 (measured); L19's merge is an ancestor; every TARGET_FILES path exists (`git ls-files`) | PASS |
| 2 | Decisions in scope final | owner A.1 (2026-10-21) at `decisions.md:1857`, `:1885`, `:1917`; RO-L23-1 fixes the fields; D2-D8 pinned as defaults pending owner sign-off; D11 has no exception | PASS |
| 3 | Scope IN/OUT and owner clear | section 5 edit sites; the lane's NEGATIVE SCOPE; section 10 residue; L23 runs alone in P3-S15d (A1) | PASS |
| 4 | Dependencies classified | L19 and L20 merged on the base; no parallel lane; migrations serialized (slot 0068) | PASS |
| 5 | Live schema and code match | sections 2 and 3, each row measured at the base | PASS |
| 6 | Data, API, state, auth contract | no new column, table, endpoint or error code; `INVALID_TEXT_FIELD`, `INVALID_INPUT`, `MISSING_DISCOVERY_FIELDS`, 22023 unchanged; the set definer keeps signature, owner, ACL and config | PASS |
| 7 | Fail-closed, idempotency, order | strip before trim and before every unchanged check (D3); REFUSE unchanged; the strip is idempotent; the cleanup fails closed on visibility (D8) and runs once in one transaction | PASS |
| 8 | Open questions in scope = 0 | D1-D12 pinned; F1 recorded with its edit site; section 10 residue is out of scope | PASS |
| 9 | Acceptance matrix with expected results | section 6: 6 rows x 3 fields x TS, SQL and web | PASS |
| 10 | Migration, security, rollback | one migration in slot 0068; opus/max security round; rollback = revert before merge; stripped code points are not restorable after 0068 by design (0 rows at the base) | PASS |
| 11 | First slice hard dependencies merged | L19 (PR #93) and L20 (PR #96) on the base | PASS |
| 12 | Implementation handoff ready | sections 5-9; the worktree exists at the base, clean | PASS |

## 12. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-22
AUTHORITY_SHA: 065ce65f98fa0f300414b15f7b56fd3586278b2c
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md (authority: the DD-138 sign-off, read only)
  - packages/db/src/text-safety.ts
  - packages/db/src/index.ts (one export line, section 10 F1)
  - packages/db/src/session-service.ts
  - packages/db/src/session-service.test.ts
  - packages/db/src/public-alias.ts
  - packages/db/src/public-alias.test.ts
  - packages/db/src/public-alias-nobypass.test.ts (read only: regression proof)
  - packages/db/src/migrate.test.ts (pin sites)
  - packages/db/src/outbox-projector-registry.test.ts (pin sites)
  - packages/db/src/rls-invariants.test.ts (pin sites)
  - packages/db/migrations/0055_me_settings_definers.sql (read only: the A-12 reference)
  - packages/db/migrations/0060_tenant_public_alias.sql (read only: the definer 0068 re-creates)
  - packages/db/migrations/0067_session_venue_visibility.sql (read only: projector, view, tail)
  - apps/web/lib/session-form-model.ts
  - apps/web/lib/session-form-model.test.ts
  - apps/web/lib/club-settings-model.ts
  - apps/web/lib/club-settings-model.test.ts
  - apps/web/app/api/onboarding/club/route.test.ts
  - apps/web/e2e/sessions.spec.ts (read only: verification)
  - apps/web/e2e/settings.spec.ts (read only: verification)
SLICE: p3-public-name-invisible-chars
IN_SCOPE: one STRIP list and one strip function per layer (TS text-safety.ts exported through index.ts; SQL one helper in 0068; web one mirror in session-form-model.ts pinned to the server's) applied before the trim and before every unchanged check on every write path of sessions.area and sessions.venue_name (createSession, updateSession) and tenants.public_alias (validatePublicAlias, tenant_public_alias_set, club-settings-model); invisible-only values handled exactly as empty today; a one-time fail-closed cleanup of the three columns with re-projection of changed public sessions; tests per decision-table row per field per layer; the 14 migration pin sites
OUT_OF_SCOPE: persons.display_name, tenants.name, memberships.display_name, sessions.venue_address, me-settings.ts, me-settings-client.ts and 0055 (RO-L23-1, follow-up row); public_sessions.title (dormant); any normalisation beyond stripping (no NFC or NFKC, no case folding, no confusable mapping); an emoji exception; changes to the control, bidi, line-separator and U+2800 refusals; non-name text; Zalo, DM and chat; new grants, job_definer-owned functions or FORCE-RLS toggles; Reviewed spec, decisions.md and backlog edits
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: L19 (PR 93, merged as 6d7bfccac7401d0052be643d29e5bb0cbfbc0c0e, an ancestor of the base) and L20 (PR 96, merged as the base 065ce65f98fa0f300414b15f7b56fd3586278b2c)
PRIOR_SLICES: L2 p3-session-text-control-chars (PR 61: text-safety.ts and the R1-5 default); the public-alias lane of 0060 (docs/sessions/web-mvp-phase3-readiness-p3-m9-public-alias-moderation.md)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # one migration in slot 0068 (helper, CREATE OR REPLACE of the alias definer, fail-closed one-time cleanup); opus/max security round
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: section 5 W1 - add the STRIP range list and one exported strip function to packages/db/src/text-safety.ts beside HIDDEN_CHAR, export it from packages/db/src/index.ts, create text-safety.test.ts (every code point against DI minus Bidi_C of the running Node, pin 4162 / 16), run it, commit in the worktree
REMAINING_BLOCKERS: none
```
