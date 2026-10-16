<!-- review-readiness: code-ready -->

# Step-0 readiness: L2 p3-session-text-control-chars (session P3-S1)

> Agent-facing. Readiness reviewer: opus/max (same model and effort as the lane's code reviewer). Writer: sonnet/high. Code reviewer: opus/max; it is also the
> input-security round (no second round).
> Lane contract: `docs/autopilot-templates/web-mvp-phase3-2026-10-16-RUN.md:180-211` (L2). Plan: `docs/sessions/web-mvp-phase3-plan.md`.
> Every `path:line` below is MEASURED at base `c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a` (merge of PR #58). No file under `packages/` or `apps/` changed between
> `3546f6b` (where the lane block was measured) and the base, so the lane block's numbers are still exact. Use THIS file's numbers.

## 1. Authority

- Owner message 2026-10-16, first sentence verbatim: "Phase 3 plan approved." It approves the plan and its RUN doc, whose L2 block says
  `DEPENDS ON: none` and `OWNER DECISIONS NEEDED: none`. None of D1-D5 (DD-133..DD-137) touches L2.
- Backlog row `session-text-fields-control-char-validation` (`docs/autopilot-backlog.md:6237-6254`) was `NOT_CODE_READY` on two choices. The approved lane block
  closes both: the character set is the existing me-settings / 0055 predicate ("reuse that predicate, do not invent a second one"), and the rule lives in the
  service only (`NEGATIVE SCOPE: no migration`).
- Spec pair, both `Reviewed`: `docs/features/FE/feature_session_management.md` v2.27 and `docs/features/BE/feature_session_management_tech.md` v2.36. BE section 3
  (`:358`) pins the field family this lane extends: `venueAddress` is plain text, max 200 UTF-16 code units, the server does NOT normalise (no NFC/NFD),
  `INVALID_TEXT_FIELD` (the route maps it to `400 INVALID_BODY`), dedup on `(tenant_id, command_id)` runs BEFORE validation (DD-117 D5), the address is private
  (DD-06). Neither spec allows or forbids hidden characters.

## 2. Measured at base

| Fact | Evidence |
|---|---|
| `isOptionalText` rejects only U+0000; `isOptionalVenueAddress` adds `length <= 200` | `packages/db/src/session-service.ts:107-112` (`VENUE_ADDRESS_MAX` at `:110`) |
| Create: text checks live in `validateInput` | `:203-211`, called at `:263`, after the advisory lock `:226` and the dedup read `:229-258`, BEFORE the first write: `insert(sessions)` `:275`, `insert(outboxEvents)` `:300`, `insert(processedCommands)` `:316` |
| Create: the public presence check runs first and only tests `area.trim().length > 0` | `:165-177` (`:169`) |
| Update: text checks of PROVIDED fields | `:1248-1256`, after the dedup read `:1170-1209`, BEFORE `SELECT ... FOR UPDATE` `:1278` and every write: no-op `insert(processedCommands)` `:1397`, `update(sessions)` `:1498`, `insert(outboxEvents)` `:1542` and `:1558`, fence `:1579`, `insert(processedCommands)` `:1589` |
| A thrown command error rolls back the whole transaction | `withTenant` wraps `db.transaction`, `packages/db/src/tenant.ts:61-71` |
| The two commands are the only production writers of the three columns | `tenantRepo().sessions.create` is a test-only seam (`tenant.ts:73-79`, guard `tenant.test.ts:192`); no bot or zalo writer; routes `apps/web/app/api/sessions/route.ts:29` and `apps/web/app/api/sessions/[id]/route.ts:38` call the commands |
| The route passes text through untouched and collapses the code | `apps/web/lib/session-command-route.ts:337-416`; `INVALID_TEXT_FIELD` in `VALIDATION_VARIANTS` `:475-483`, mapped to `INVALID_BODY` 400 with fixed copy `:642-643`; tested at `apps/web/app/api/sessions/route.test.ts:248` |
| Rule to reuse | `packages/db/src/me-settings.ts:32` `HIDDEN_CHAR` (doc `:21-31`) and `:43` `VISIBLE_CHAR` (doc `:34-42`), module-private, used only by `validateDisplayName` `:49-62`; SQL twin `packages/db/migrations/0055_me_settings_definers.sql:108-117` (`c_reject`) and `:120-124` (`c_visible`) |
| Display names trim before testing; sessions do not trim | `me-settings.ts:51`, `0055:130`; BE section 3 `:358` |
| Web client-mirror precedent and the boundary that forces it | `apps/web/lib/me-settings-client.ts:64-83` (inline copy of the class at `:79`); FE-INV-3 forbids `@plexco/db` in client code (`docs/standards/frontend-architecture.md:25`); `session-form.tsx` is `"use client"` (`:1`) |
| No DB CHECK on `area`, `venue_name`, `venue_address` | `0002_tenants_core.sql:83-85`; live `pg_constraint` of `plexco_test` `public.sessions` lists none |
| Rows already holding a hidden character | 0 (`plexco`: 0 sessions; `plexco_smoke`: 0 of 2), container psql with the 0055 `c_reject` class |
| Web form today | `validateForm` (`apps/web/lib/session-form-model.ts:90-148`) checks only the address cap (`:113-122`) and public area/slots (`:136-146`); bodies send `textOrNull` values (`:72`, `:165-170`, `:199-204`); edit exemption pattern `addressKey` `:82`, `:113-117`; the venue-name input has NO `error` prop (`apps/web/components/sessions/session-form.tsx:169-174`; address `:178` and area `:186` have one); submit returns early on any client error (`:74-79`) |
| Error UI | `apps/web/lib/session-error-ui.ts:168-175` generic `INVALID_BODY` copy; `errorField` `:96-112` has no text-field mapping (the wire carries no field) |
| Migrations | 56 files, tail `0055_me_settings_definers.sql`; L2 adds none |
| Baselines | CI on the base: `verify` and `e2e-web` success (run 38851467108). Local: `session-service.test.ts` + `me-settings.test.ts` = 246 passed in 18.9 s (under the DB lock); `session-form-model`, `session-error-ui`, `session-form`, `me-settings-client` web tests = 72 passed in 0.7 s; `pnpm review:check` PASS (47 documents, 51 blocks) |

## 3. Coverage of the TESTS characters (measured, node v25.6.0, Unicode 17.0)

`HIDDEN_CHAR` already rejects every character the lane names. There is NO gap: no extra single-line rule is needed and me-settings keeps its exact set.

| TESTS character | Category | `HIDDEN_CHAR` | JS `trim()` removes it at an edge |
|---|---|---|---|
| U+0000 | Cc | rejects | no |
| U+202E RIGHT-TO-LEFT OVERRIDE | Cf | rejects | no |
| U+200B ZERO WIDTH SPACE | Cf | rejects | no |
| U+2028 LINE SEPARATOR | Zl | rejects | yes |
| U+2029 PARAGRAPH SEPARATOR | Zp | rejects | yes |
| U+000A (`\n`) | Cc | rejects | yes |
| U+0009 (`\t`) | Cc | rejects | yes |
| U+001B ESCAPE (the pinned "Cc control") | Cc | rejects | no |

- 245 hidden scalars; `HIDDEN_CHAR` equals the runtime-derived set of `me-settings.test.ts:163-175` (0 mismatches over 0..0x10FFFF).
- Normalisation bypass: 0 scalars outside the set whose NFC, NFD, NFKC or NFKD form contains a hidden character. The service and Postgres store the raw
  string, so the check runs on exactly the stored value. `JSON.parse` decodes an escaped U+202E into the real character before the command sees it.
- Update-path bypass: none. Every PROVIDED field is checked before the row lock; an absent field is never written; the no-op branch runs after the check.
- Accepted: Vietnamese NFC and NFD (combining marks are Mn), U+2764 U+FE0F, keycaps, skin tones, regional-indicator flags, CJK + ideographic variation
  selector, `""`, an inner NBSP.
- Rejected by parity (Cf): ZWJ U+200D and ZWNJ U+200C (so emoji ZWJ sequences), U+00AD, U+FEFF, tag characters (subdivision flags).
- Outside the set: a lone surrogate (node-postgres stores it as U+FFFD) and an unassigned default-ignorable after a visible character (same as display names).

## 4. Pinned defaults (each is "default applied, pending owner sign-off"; repeat them in the PR body; L17 consolidates)

| # | Default | Value |
|---|---|---|
| P1 | The one shared predicate | NEW `packages/db/src/text-safety.ts` holds `HIDDEN_CHAR` and `VISIBLE_CHAR` moved VERBATIM from `me-settings.ts:21-43` (same class, same order, `u` flag only, never `g` or `y`), module-private, exported as `hasHiddenChar(value: string): boolean` and `hasVisibleChar(value: string): boolean`. `me-settings.ts` imports both; `validateDisplayName` keeps its order (trim, length, hidden, visible). What me-settings accepts does not change. |
| P2 | Session rule | `isOptionalText(value)` is true for `undefined`, `null`, or a string with `!hasHiddenChar(value)`, applied to the RAW provided value (no trim, no normalisation) of `area`, `venue_name`, `venue_address` on create (`validateInput`) and update (provided fields only). U+0000 is Cc, so the explicit NUL test is subsumed. The 200-unit address cap stays. |
| P3 | Visible-code-point rule | NOT applied to session fields: they are optional, `""` and `null` stay valid clears, whitespace-only stays as today, and `MISSING_DISCOVERY_FIELDS` keeps owning "public area present" (`:169`, `:1440-1449`). `hasVisibleChar` is exported for later lanes (L10a). |
| P4 | Error | The existing `INVALID_TEXT_FIELD` on both paths; wire unchanged (`400 INVALID_BODY`). Domain messages become "area and venue_name must be a string with no control or hidden characters, or null" and "venue_address must be a string of at most 200 characters with no control or hidden characters, or null" (internal, never echoed). |
| P5 | Web predicate | A client mirror `export function hasHiddenChar(value: string): boolean` in `session-form-model.ts`, its class copied byte-for-byte from `me-settings-client.ts:79` (FE-INV-3: no `@plexco/db` in client code), pinned by the full-range parity test W7. |
| P6 | What the web checks | The value the body builders send, `textOrNull(v.field)`. Edge whitespace, including an edge `\n` or `\t`, is trimmed and never sent, so it is no error; an inner hidden character is. In edit mode a field is skipped when its trimmed value equals the trimmed `initial` value (an untouched legacy value; same exemption as the address cap at `:113-117`). |
| P7 | Inline copy, t(vi, en), distinct per field (the summary uses the message as its React key, `session-form.tsx:121-123`) | `venueName`: t("Tên sân không được chứa ký tự điều khiển hoặc ký tự ẩn.", "The venue name cannot contain control or hidden characters."); `venueAddress`: t("Địa chỉ không được chứa ký tự điều khiển hoặc ký tự ẩn.", "The address cannot contain control or hidden characters."); `area`: t("Khu vực không được chứa ký tự điều khiển hoặc ký tự ẩn.", "The area cannot contain control or hidden characters."). Tone follows `apps/web/components/me/settings-profile-form.tsx:42-45`. |
| P8 | Precedence | Address: the existing 200-cap message wins; the hidden-character message only when the cap passes. Area: the public "needs an area" message and the hidden-character message cannot both apply. |
| P9 | Venue-name inline error | Add `error={errors.venueName}` to the venue-name `TextField` (`session-form.tsx:169-174`). |
| P10 | `session-error-ui.ts` | No change: `INVALID_BODY` keeps its generic copy (`:168-175`); a field-level server error is backlog row `session-venue-address-error-field-contract`. |
| P11 | DB backstop | None (negative scope: no migration). The two commands are the only production writers (section 2). |

## 5. Implementation steps (dependency order; one commit each)

1. **text-safety** (DoD: `me-settings.test.ts` green and unedited). Copy `me-settings.ts:21-43` into the new file with a byte-preserving shell command
   (for example `sed -n '21,43p' packages/db/src/me-settings.ts`), make the two consts non-exported, add the two exported functions and a header comment: used by
   `validateDisplayName` (on the trimmed name) and by the session `isOptionalText` (on the raw value); sessions have no SQL twin. In `me-settings.ts` delete
   `:21-43`, import from `"./text-safety.js"`, call the functions in the same order, and point the `validateDisplayName` doc comment (`:45-48`, which names
   `HIDDEN_CHAR` / `VISIBLE_CHAR`) at the new functions. Run `me-settings.test.ts` under the DB lock.
2. **service** (DoD: TXT rows green, existing suite green). In `session-service.ts` import `hasHiddenChar`, change `isOptionalText` (`:107-108`) per P2 with a
   comment that NUL is Cc, and update the four message strings (`:204`, `:209`, `:1249`, `:1254`) per P4. Add the TXT tests to `session-service.test.ts`.
3. **web** (DoD: W rows green, existing web tests green). In `session-form-model.ts` add the mirror (P5) and the checks in `validateForm` (P6-P8); wire P9 in
   `session-form.tsx`; add the W tests to `session-form-model.test.ts`.
4. **verify** (section 7), then report. Do not push.

Commit messages are conventional with no AI references, for example `refactor(db): move the hidden-character predicate to text-safety`,
`fix(db): reject hidden characters in session text fields`, `fix(web): flag hidden characters in the session form`.

## 6. Acceptance matrix

Build every test character with `String.fromCodePoint(0x...)` (section 8). `C8` = U+0000, U+202E, U+200B, U+2028, U+2029, U+000A, U+0009, U+001B.
`F3` = `area`, `venueName`, `venueAddress`. A vector is `"Sân" + c + "A"` unless stated.

| ID | Group | Input / precondition | Expected | Layer |
|---|---|---|---|---|
| TXT1 | Security | create, each of F3 x C8 (24 cases), fresh commandId via `createBad` | `SessionCommandError` `INVALID_TEXT_FIELD`; `expectReject` counts of sessions, outbox_events, processed_commands unchanged (`session-service.test.ts:82-88`) | db |
| TXT2 | Boundary | create with `venueName: "Sân A\n"`; with `area: "\tQuận 1"`; with `venueAddress` = 199 x "đ" + U+200B (200 units) | `INVALID_TEXT_FIELD`, zero writes (the server does not trim; cap and hidden rule both apply) | db |
| TXT3 | Security | create `{ visibility: "public", slotsMax: 8, area: "Quận" + U+202E + "1" }` | `INVALID_TEXT_FIELD` (not `MISSING_DISCOVERY_FIELDS`), zero writes | db |
| TXT4 | Security | `seedTenant("active", "active")` + `seedSession` (`:1756`, open, private); each of F3 x C8 with `expectedVersion: version`, a fresh commandId each | `SessionUpdateError` `INVALID_TEXT_FIELD` each; afterwards version and the three columns unchanged, `updatedEvents(sessionId)` empty, 0 `processed_commands` rows for those commandIds; control: the same `expectedVersion` with a clean `venueName` succeeds (version + 1) | db |
| TXT5 | Happy / regression | create and update with a Vietnamese NFC string, its `.normalize("NFD")`, and `"Sân " + U+2764 U+FE0F`; create with `""` and `null`; on a private session, update clears with `null` and `""` | success; the stored value equals the input byte for byte (NFD stays NFD) | db |
| TXT6 | Regression | existing A3, A3b, Validation (NUL vectors `:233-236`), U8b, DED2 | green, unchanged | db |
| TXT7 | Regression | `me-settings.test.ts` | green, not edited | db |
| W1 | Security | `validateForm(base({ [f]: vector }), TZ, en)` for F3 x C8 (area on a private session) | exactly one key, `f`, with the P7 en text | web unit |
| W2 | i18n | the same with `t = (v) => v`, one vector per field | the P7 vi text | web unit |
| W3 | Happy | NFC, NFD, `"Sân " + U+2764 U+FE0F`, `""` | `{}` | web unit |
| W4 | Boundary | `venueName: "Sân A\n"` | `{}`, and `buildCreateBody` sends `"Sân A"` | web unit |
| W5 | Regression (edit) | `initial` holds a legacy `venueName` with U+202E; only `area` changes | `{}`; `buildUpdateBody` omits `venueName`; editing `venueName` to another hidden value flags it | web unit |
| W6 | Boundary | an address of 201 units that contains U+200B | only the existing cap message | web unit |
| W7 | Parity | every scalar 0..0x10FFFF except 0xD800-0xDFFF: client `hasHiddenChar(c)` versus `validateDisplayName("a" + c + "b")` throwing (import it from `@plexco/db`; web tests already import that package, e.g. `apps/web/app/api/me/profile/route.test.ts:1`) | 0 mismatches (measured 217 ms in node) | web unit |
| W8 | Regression | existing `session-form-model`, `session-form`, `session-error-ui` tests; Playwright suite, golden path locally | green | web unit / e2e |

Rendering and submit blocking: a `validateForm` error becomes the summary alert plus `aria-invalid` on a `TextField` that has an `error` prop, and submit stops
(`session-form.tsx:74-79`); that mechanism is already proven end to end by `apps/web/e2e/sessions.spec.ts:271-289`. L2 reuses it through W1/W2 plus the P9
wiring; no e2e or component test file is in scope (`session-form.test.tsx` renders static markup only and cannot submit).

Groups with no new row, and why: Authorization (no auth branch; validation runs inside the tenant transaction after the route's authz, and its result does not
depend on whether the session exists); Concurrency (a pure check; the dedup order is unchanged, TXT6); Migration (none; 0 existing rows hold a hidden
character; the web form never re-sends an untouched value); Observability (a reject writes nothing by design; success paths keep their `session.created` /
`session.updated` events).

## 7. Verification (cite measured output, `| tail -40`)

DB and e2e runs take the shared lock: atomic `mkdir "/Users/maingocanh/Projects/Plexco app/Claude outputs/plexco-phase3/status/.db-e2e.lock"` plus `owner.txt`
(lane, role, ISO time, command), poll every 30 s, `rm -rf` right after the run; L1 may hold it for a long exclusive window. After any run that touches Postgres,
restore the cluster-global role passwords (`docs/runbooks/local-mvp-smoke.md` step 5) through `docker exec -i plexco-postgres-1 psql -U plexco -d plexco_smoke`.
Never run `docker compose up` from the worktree.

| # | Command | Expected |
|---|---|---|
| V1 | `pnpm typecheck`; `pnpm lint`; `pnpm format:check`; `pnpm build` | exit 0 |
| V2 | `NODE_ENV=test DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm --filter @plexco/db test -- session-service me-settings` (lock) | all pass |
| V3 | `NODE_ENV=test DATABASE_URL_TEST=<same> pnpm --filter @plexco/web test` (lock: the web suite has DB tests, `apps/web/app/api/auth/logout-all/route.test.ts:42-47`) | all pass |
| V4 | `NODE_ENV=test DATABASE_URL_TEST=<same> pnpm -w test` (lock) | all pass; known flakes rerun once |
| V5 | `pnpm --filter @plexco/web exec playwright test` (lock; UI changed) | pass; `pwa.spec.ts:39` rerun once |
| V6 | `pnpm review:check:changed`, then `pnpm review:check` | PASS |
| V7 | `git diff --name-only c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a..HEAD` | this readiness file plus `packages/db/src/{text-safety.ts,me-settings.ts,session-service.ts,session-service.test.ts}`, `apps/web/lib/{session-form-model.ts,session-form-model.test.ts}`, `apps/web/components/sessions/session-form.tsx` |
| V8 | `LC_ALL=C grep -c -P '[^\x00-\x7F]' packages/db/src/text-safety.ts` | `0` |
| V9 | the hidden-character scan below over the changed code files | no output, exit 0 |

```bash
git diff --name-only c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a..HEAD -- packages apps | xargs node -e 'const fs=require("fs");const re=/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;let bad=0;for(const f of process.argv.slice(1)){fs.readFileSync(f,"utf8").split("\n").forEach((l,i)=>{if(re.test(l.replace(/[\t\r]/g,""))){console.log(f+":"+(i+1));bad++}})}process.exit(bad?1:0)'
```

Impact: the GitNexus `plexco-app` index is stale (built at `dd5375f`, 2026-09-26; it does not know `me-settings.ts` or `isOptionalVenueAddress`), so the grep
fallback applies; state it in the PR body. Callers measured with `git grep`: `isOptionalText` at `session-service.ts:203` and `:1248` (plus via
`isOptionalVenueAddress` at `:206` and `:1251`); `HIDDEN_CHAR` / `VISIBLE_CHAR` only inside `validateDisplayName` (exported at `packages/db/src/index.ts:221`, called
by `updateMyProfile` `me-settings.ts:93`); `validateForm` only at `session-form.tsx:74`. All LOW; none HIGH or CRITICAL.

## 8. Tool hazard (read before the first edit)

Measured in this session: a backslash-u escape with four hex digits inside ANY tool parameter (Edit, Write, Bash) is decoded into the literal character before it
reaches the file or the shell; backslash-x, backslash-t and backslash-n escapes are not decoded. A literal U+202E or U+200B typed into a test or a regex would put
the very characters this lane rejects into the source.

- Build test characters with `String.fromCodePoint(0x202e)` (the `ch(cp)` helper style of `me-settings.test.ts`).
- Move the regex lines with a shell copy (step 1). `me-settings.ts` and `me-settings-client.ts` are pure ASCII (0 non-ASCII lines measured), so a copy keeps the
  escapes intact.
- Never use the NUL-escape lines (`session-service.test.ts:233-236`, `:2282`) as Edit anchors.
- V8 and V9 prove the result. Repo precedent for the same concern: `apps/web/lib/session-command-route.ts:135-136`.

## 9. Budget (B3, no exception)

Estimate about 250-280 changed lines (text-safety 35; me-settings minus 23, plus 3; session-service 8; session-service tests 95; form model 30; form model tests
55; form 1), 3 modules (`packages/db/src`, `apps/web/lib`, `apps/web/components/sessions`), 0 migrations: within the default (about 300 LOC, 3 modules,
1 migration). If `git diff --stat` shows more than 300, compact the matrices with `it.each`; never drop a vector.

## 10. OPEN (out of scope: report, do not edit)

1. BE spec `docs/features/BE/feature_session_management_tech.md:358` lists the `INVALID_TEXT_FIELD` triggers as too long, not a string, or NUL; after L2 they also
   include hidden characters. Reviewed spec, not an L2 file: for L17 (docs).
2. Backlog row `session-text-fields-control-char-validation` (`docs/autopilot-backlog.md:6237`) is discharged by this PR; flip it at closeout.
3. No DB backstop: a CHECK on the three columns needs a migration.
4. P3 consequence: a public area made only of a variation selector (for example U+FE0F) passes `MISSING_DISCOVERY_FIELDS` (`trim().length`, `:169`, `:1441-1442`) and
   renders blank. Candidate for L6 or L10, using `hasVisibleChar`.
5. Lone surrogates in session text are stored as U+FFFD by the driver, not rejected (guest notes reject them, `packages/db/src/roster-money-shared.ts:54`).
6. Other player-visible free text keeps a weaker rule by the negative scope: guest name and note (NUL and lone surrogate only), club name (Cc and Cf only,
   `packages/db/src/club-config-validation.ts:64`, `apps/web/lib/club-settings-model.ts:38`).
7. After L2 the web holds two mirrors of the set (`me-settings-client.ts:79` and the new one in `session-form-model.ts`): consolidate in a web lane.
8. `sessions.skill_level` is free text with no write path at the base; a future writer must use `hasHiddenChar`.
9. `buildUpdateBody` compares trimmed `area` / `venueName` with the raw stored value (`session-form-model.ts:199-202`), so a legacy value with surrounding spaces is
   re-sent trimmed on any save (pre-existing; 0 such rows measured).

## 11. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = `git rev-parse origin/main` = the worktree HEAD at step 0; every TARGET_FILES path exists | PASS |
| 2 | Decisions in scope final | owner "Phase 3 plan approved" (2026-10-16); lane `OWNER DECISIONS NEEDED: none`; the backlog row's two choices closed by the lane block (section 1) | PASS |
| 3 | Scope IN/OUT and owner clear | lane FILES IN SCOPE and NEGATIVE SCOPE; section 4; L2 is the only `session-service.ts` editor in P3-S1 | PASS |
| 4 | Dependencies classified | root slice; file-disjoint from L0, L1 and L1b (their lane blocks and the conductor notes) | PASS |
| 5 | Live schema and code match | sections 2 and 3, each row measured at the base | PASS |
| 6 | Data, API, state, auth contract | typed `INVALID_TEXT_FIELD`, wire `400 INVALID_BODY` unchanged, no field or auth change (P2, P4, P10) | PASS |
| 7 | Fail-closed, idempotency, order | reject before the first write on both paths; dedup still precedes validation (DD-117 D5); rollback on throw (section 2) | PASS |
| 8 | Open questions in scope = 0 | P1-P11 pinned as defaults; the residue in section 10 is out of scope | PASS |
| 9 | Acceptance matrix with expected results | section 6 | PASS |
| 10 | Migration, security, rollback | no migration; normalisation and update-path bypass measured closed (section 3); the opus/max reviewer covers input security; rollback = revert the PR | PASS |
| 11 | First slice hard dependencies merged | none needed; the base contains PR #58 | PASS |
| 12 | Implementation handoff ready | sections 5-9; the worktree exists at the base with deps installed | PASS |

## 12. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-16
AUTHORITY_SHA: c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-templates/web-mvp-phase3-2026-10-16-RUN.md (lane contract, read only)
  - packages/db/src/session-service.ts
  - packages/db/src/session-service.test.ts
  - packages/db/src/me-settings.ts
  - packages/db/src/me-settings.test.ts (read only: regression proof)
  - apps/web/lib/session-form-model.ts
  - apps/web/lib/session-form-model.test.ts
  - apps/web/components/sessions/session-form.tsx
  - apps/web/lib/session-error-ui.ts (reviewed, no change expected)
  - apps/web/lib/session-error-ui.test.ts (reviewed, no change expected)
SLICE: p3-session-text-control-chars
IN_SCOPE: one shared hidden-character predicate in NEW packages/db/src/text-safety.ts (HIDDEN_CHAR and VISIBLE_CHAR moved verbatim from me-settings.ts, exported as hasHiddenChar and hasVisibleChar; me-settings behavior unchanged); session-service.ts isOptionalText rejects any hidden character in the raw area, venue_name and venue_address on createSession and updateSession with INVALID_TEXT_FIELD before the first write; web session form: a parity-tested client mirror, a per-field t(vi, en) inline error that blocks submit, and the venue-name error wiring; tests in session-service.test.ts and session-form-model.test.ts
OUT_OF_SCOPE: any migration or DB CHECK; api-contract.ts and session-command-route.ts (INVALID_TEXT_FIELD stays 400 INVALID_BODY, backlog row session-venue-address-error-field-contract); new session fields; guest-note, display-name and club-name rules; the visible-code-point rule for session fields; lone surrogates; skill_level; server-side trimming or normalisation; edits to me-settings.test.ts and me-settings-client.ts; Reviewed spec and backlog edits (L0, L17)
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none (root slice; base c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a is origin/main and contains PR 58)
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration; input-validation hardening whose opus/max code reviewer is also the input-security round
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: section 5 step 1 - create packages/db/src/text-safety.ts by a byte-preserving copy of me-settings.ts lines 21-43, export hasHiddenChar and hasVisibleChar, switch validateDisplayName to them, run me-settings.test.ts under the DB lock, commit
REMAINING_BLOCKERS: none
```
