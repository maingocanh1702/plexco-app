<!-- review-readiness: code-ready -->

# Step-0 readiness: L20 p3-venue-public-default (session P3-S15a)

> Agent-facing. Readiness reviewer #4: opus/max (same model and effort as the lane's code reviewer). Writers opus/max for the migration,
> the core command, the projector, the reads and every security-sensitive unit; sonnet/high for the UI units. Code reviewer opus/max plus
> an opus/max security round (public read model, SECURITY DEFINER re-creates, a public DTO change), at most 3 rounds (DD-122 D4: Codex
> waived, independent Claude reviewer). Every `path:line` is MEASURED at base `6d7bfccac7401d0052be643d29e5bb0cbfbc0c0e` by readiness
> reviewers #1-#3 (handoffs `status/P3-S15a-notes/handoff-s0-readiness-{1,2,3}.md`) and re-measured here where this file relies on it
> (worktree state, test-file existence, e2e and route-test venue sites, `0061` return types, `changedFields` type, schema/dbml anchors,
> every TARGET_FILES path). TARGET_FILES (section 14) are files that exist at the base; new files (`0067`) are scope, never TARGET_FILES.
> Review questions (lane REVIEW PLAN) and where each is closed: **hidden venue reaching the public row or a non-active viewer** -> 4.1
> rules R2-R3, T1, A-2, A-4; **public DTO field set** -> 4.3, T2, A-8; **re-created functions' ACL, owner, attributes** -> 4.1 R1, R5,
> A-10; **re-projection on toggle** -> 4.2, T3, A-5; **copy pairs** -> D-3, A-11.

## 1. Base, dependencies, authority

- Worktree `.autopilot/worktrees/p3-venue-public-default`, branch `feat/p3-venue-public-default`, HEAD = origin/main =
  `6d7bfccac7401d0052be643d29e5bb0cbfbc0c0e` (L19 #93 merged); `git status --porcelain` empty; no `*.lock` under the worktree git-dir.
- Authority: owner decision B1 (OWNER-DECISIONS-2026-10-21, confirmed 2026-10-21), recorded as DD-139 `docs/standards/decisions.md:1825-1846`
  (B1 verbatim `:1831`; spec follow-up list `:1840-1846`). DD-139 reverses DD-06 (`:235-241`, invariant "venue NOT in public_sessions"
  `:239`) and L9 M-7 (`:1931`, rejected). The decision log outranks the Reviewed specs; no spec is edited (section 8).
- Migration slot: 67 files, tail `0066_account_club_chat_context.sql` => **0067**, name `0067_session_venue_visibility.sql`. No other lane
  writes a migration until this lane merges (lane block). L22 runs beside (file ownership disjoint); L23 waits for this merge.

## 2. Orchestrator pins applied (they amend the lane block's proposals, nothing else)

1. The public DTO is NOT in `packages/core/src/api-contract.ts` (no public DTO there; `:203` is the join comment). It is
   `apps/web/lib/discovery-route-support.ts` (server, OPTIONAL_DTO_KEYS `:228-237`) + `apps/web/lib/discover-api.ts` (client, `:62-75`,
   `:101-114`). Both are pinned IN SCOPE: they are the route layer of "the discover routes that return one" (lane FILE OWNERSHIP); L22 owns
   neither. The three discover route files need no edit; the share route (RO-L19-4 public card) follows B1 through the same mapper.
   `api-contract.ts` gets no edit.
2. Stale window on toggle ON: the outbox re-projection path (threat 3) is the mechanism; the DD-12 fence proposal is DECLINED (the fence
   denies the whole listing, the wrong semantics for "area only", and would re-create the 0033 fence function outside the lane's
   one-migration scope). Stated plainly in T3.
3. RQ1 answered: conductor reading RO-L20-1 (`status/P3-S15a-notes/conductor-ruling-l20-1.md`), option A: the web join response
   (`packages/core/src/api-contract.ts:203`, signed P-18 `decisions.md:2247`) stays unchanged (P-18 stands for its venue part); if the
   owner wants the venue in the web join response too, that is a follow-up lane (B1 does not name it). Not an open question in scope.
4. Pins: the base count is already 67 => 10 lines 67 -> 68 and 4 lines `0066_account_club_chat_context` -> `0067_session_venue_visibility`
   (section 6). `account_my_sessions` (0059) is re-created OUTSIDE the job_definer bracket; the 0061 writer INSIDE it. P-6 (`:2354`) is
   reversed by B1 for the option OFF like M-7: both are spec follow-ups.
5. `updateSession` pushes `"hide_exact_address"` into changedFields; `UpdateSessionErrorCode` gains `"INVALID_INPUT"` (one line).
6. B3 counted honestly from the unit plan (section 10): 40 files, within every cap.

## 3. Q1-Q7 answers (measured at the base)

**Q1 venue sites.** Source columns `0002_tenants_core.sql:83-84`, `packages/db/schema.ts:633-634` (table `:626`), `packages/db/db.dbml:203-204`
(table `:196`): unchanged, the option column is added beside them. **Public read model (B1 CHANGES):** `0061_public_sessions_projector_writer.sql`
table `:42-56`, job_definer SELECT on sessions `:62` (no venue), public_sessions grants `:67-77` (no venue), view `:128-158` (17 columns,
`WITH (security_barrier = true)` `:128`), writer `:164-328`; `packages/db/src/public-discovery-read.ts` row type `:13-30`, COLUMNS `:65-67`
(spliced into list `:69-71`, detail `:113-118`, share `:126-133`, resolve `:140-145`), comment `:64`; mapper `discovery-route-support.ts`
`:228-259` (list route `:28`, serveDiscoveryListing `:280`/`:291` for detail and share); client `discover-api.ts`; render
`apps/web/components/discover/listing-summary.tsx:27` ("no venue"). Route files and `discover-detail-view.tsx` / `discover-list-view.tsx`: 0
venue hits, no edit. **/me reads (B1 CHANGES):** `0059` `:81-149` (CASE active-only `:107-112`, pending branch `NULL::text` `:125`);
`me-player-reads.ts` passes through; `me-player-api.ts` TS cut `:134-135`; `my-sessions-view.tsx:38` (P-6), `:47-48`;
`app/api/me/sessions/route.ts:10` (comment). **Host (unchanged except the toggle):** `session-form.tsx:189-215`, `session-form-model.ts`,
`session-command-route.ts:372-403`, `sessions-api.ts:10-35`/`:125-134`, `session-read.ts:96-97`/`:183-184`, `details-tab.tsx:8-22`;
`session-card.tsx:11`/`:40` host only, `session-snapshot.ts:6`, `tenant.ts:89`/`:136`: no edit. **Not B1 surfaces (unchanged):** Zalo DM
`zalo-dm-templates.ts:7-8`, `:25` (Z-13), `zalo-dm.ts:17`, `zalo-ingress.ts:234`, `session-join-service.ts:46`/`:174`/`:237`, join response
(RQ1), `text-safety.ts:5` (L23).

**Q2 projector and re-projection.** `apps/bot/src/projectors/public-sessions.ts` never reads the payload (`:5-8`), one
`public_sessions_project_session` call per session (`:50-56`), tenant fan-out `:70-77`, sweep `:78`: no TS change. Route
`0061:489-503`: `session.updated` -> public_sessions `:494`. `updateSession` `:1198`; changedFields `:1405-1456`, declared
`const changedFields: string[]` `:1409` (measured: the only non-test declaration, no closed union, no validator); the event is emitted only
when non-empty `:1625-1632` => an option-only update must push `"hide_exact_address"` or it never reaches the projector. DM side:
`zalo-dm.ts:95-103` returns `noop_irrelevant_fields` when no changed field is in DM_RELEVANT_FIELDS (`zalo-dm-templates.ts:23-28`: time,
venue, price) => no DM, no Zalo file change. The writer must read the venue and the option in the sessions SELECT `:206-213` and write the
venue in the rotated INSERT `:260-266`, the upsert INSERT `:274-280`, DO UPDATE SET `:281-299` and BOTH tuples of IS DISTINCT FROM
`:300-307` (else a flip is "unchanged" and the row keeps the venue); keep the READ COMMITTED guard `:195-198`, lock `:200`, fence `:204`,
`:323-325`.

**Q3 headers, ownership, ACL, locks.** 0061 writer `:164-170`: RETURNS text `:165`, plpgsql VOLATILE SECURITY DEFINER, `SET search_path =
public, pg_temp`; owner job_definer (`:24-25`, P-12); bracket GRANT CREATE `:90`, SET ROLE `:91` ... RESET ROLE `:509`, REVOKE CREATE
`:510`; ACL REVOKE ALL FROM PUBLIC `:477-480`, view REVOKE `:481`, writer EXECUTE app_worker `:484-485`, view SELECT readonly `:487`.
Functions using the view: `:405` (JOIN, RETURNS text `:384`), `:460` (RETURNS TABLE(tenant_id, session_id, public_listing_id) `:448`),
`:473` (RETURNS TABLE(tenant_id, session_id) `:464`): none returns the view's row type (measured) => two trailing view columns need no other
re-create. 0059: owner = the migration role (`:20`; no SET ROLE / OWNER TO in the file); conventions `:41-43`; CREATE FUNCTION `:81`, RETURNS
TABLE `:82-84` (12 columns, venue last `:84`), plpgsql `:85`, VOLATILE `:86`, SECURITY DEFINER `:87`, `SET search_path = pg_catalog, public,
pg_temp` `:88`, `#variable_conflict use_column` `:90`; ACL REVOKE ALL FROM PUBLIC `:148`, GRANT EXECUTE TO app `:149`; header `:13-15`
restates M-7. Locks (`packages/db/src/test-harness.ts`): JOB_DEFINER_LOCK_KEY `:534`, withJobDefinerLock `:537` (reader side, never inside
a reader's fn `:536`), withJobDefinerBreakerLock `:542` only for tests that break job_definer; no chat/identity lock applies. Precedents:
`public-sessions-projector.test.ts:10`, `:603`, `:622`, `:653`; `me-player-reads-nobypass.test.ts:11-12`, `:31-32`, suite `:131` (A-14).

**Q4 form, validation, toggle pattern.** Core has no boolean session input (create payload `session-service.ts:67-84`, update `:1105-1124`).
Create validation validateInput `:165-233` via fail(); update inline `:1281-1320` via failUpdate(). `"INVALID_INPUT"` in the create union
`:41` (used `:170`), absent from UpdateSessionErrorCode `:1056-1070`; the route collapses it to INVALID_BODY 400
(`session-command-route.ts:555-561`), so no route or catalog edit. Form: the only checkbox = slots unlimited `session-form.tsx:268-277`
(the pattern to copy); TextField hint prop `:184`, `:203`, `:212`, `:238`. Model: values `:11-25`, empty `:37-50`, from-session `:54-70`
(legacy-DTO rule `:268`), buildCreateBody `:221-245`, buildUpdateBody `:251-284` (diff pattern `:275-276`). `details-tab.tsx:9` lists
"everything the edit form can change" => one row after `:17`. Test files present: `session-form.test.tsx`, `my-sessions-view.test.tsx`,
the 3 discover route tests, `app/api/me/sessions/route.test.ts`; no `details-tab` or `listing-summary` test file.

**Q5 public whitelist pins (19 sites, 7 files).** `public-sessions-projector.test.ts`: TABLE_COLS `:43-66` (asserts `:220`, `:231`) +2;
VIEW_COLS `:67-85` (asserts `:221`, `:245`) append 2; DD41_COLS `= VIEW_COLS.slice(9)` `:86` -> `slice(9, 17)` (else the venue enters the
all-NULL loop `:243`); venue fixture `${SECRET} Venue` `:135` vs leak loop `:248` -> drop SECRET from the venue fixture only, add a positive
assert. `apps/bot/src/projectors/public-sessions.test.ts:231`, `:395` (fixture `:132`): same fixture fix. `public-discovery-read.test.ts`:
golden `:161-179` (asserts `:181`, `:183`), VIEW_COLS `:41` (asserts `:184`, `:202`), "17 view columns" `:156`, `:189`.
`rls-invariants.test.ts`: public_sessions columns `:183` +2; view columns `:213-231` append 2; regexes `:238` (assert `:240`) and `:575`
(assert `:577`): drop `venue_address` only. `discover-detail-view.test.tsx:54`, `:78-86`; `discover-list-view.test.tsx:107-115`: venue
renders. Measured here: the 3 discover route tests carry no venue (whitelist-stub comments `route.test.ts:45`,
`[publicListingId]/route.test.ts:40`, `share/[slug]/route.test.ts:38`) => add positive venue rows; `discover-api.test.ts:61` has no venue
(add one positive parse). Must stay: `api-contract.test.ts:260` + `api-contract.ts:203`, `discover-api.test.ts:154` (join ignores
venueName), rls hidden list `:564-573` and the rest of both regexes, SECRET on tenant/person/host/guest fixtures, projector test
`:628-638`, rls `:495-497`, `public-alias.test.ts:495-502`, `outbox-projector-registry.test.ts:952`. `public-session-fence.ts` pins no
field set.

**Q6 slot, pins, B3.** Slot 0067 (section 1). Pins: section 6. B3: section 10.

**Q7 Reviewed-spec lines (PR-body follow-ups only).** Section 8.

## 4. Contract

### 4.1 Migration `packages/db/migrations/0067_session_venue_visibility.sql` (one file, three sections)

- **R1 shape and order.** (A) as the migration role: `ALTER TABLE public.sessions ADD COLUMN hide_exact_address boolean NOT NULL DEFAULT false`;
  `ALTER TABLE public.public_sessions ADD COLUMN venue_name text, ADD COLUMN venue_address text` (nullable); column grants in the 0061
  `:62` / `:67-77` pattern: SELECT (venue_name, venue_address, hide_exact_address) ON sessions TO job_definer; SELECT, INSERT, UPDATE
  (venue_name, venue_address) ON public_sessions TO job_definer. If `app`'s sessions grants are column-level (measure `0009`), add the new
  column there too; if table-level, nothing. (B) `CREATE OR REPLACE FUNCTION account_my_sessions` OUTSIDE the bracket, RETURNS TABLE
  byte-identical to `0059:82-84`, attributes `:85-88` and `:90` restated, ACL `:148-149` restated. (C) the bracket copied from 0061 `:90-91`
  / `:509-510`: `CREATE OR REPLACE VIEW public_session_share_v WITH (security_barrier = true)` with the 17 columns unchanged and
  `venue_name, venue_address` appended last (CREATE OR REPLACE VIEW replaces reloptions: restate `security_barrier`); `CREATE OR REPLACE
  FUNCTION public_sessions_project_session` with every attribute restated (CREATE OR REPLACE keeps owner and ACL but resets omitted
  attributes); the view/writer ACL restated at the 0061 place (`:477-487`, before RESET ROLE).
- **R2 public writer.** Reads `s.venue_name, s.venue_address, s.hide_exact_address`; writes `CASE WHEN s.hide_exact_address THEN NULL ELSE
  s.venue_name END` (address alike) in both INSERTs, DO UPDATE SET and both IS DISTINCT FROM tuples. An untyped venue stays NULL.
  As built (measured with grep at ccc579b00793856f4be20fd91dc915433cfdd4ad): the CASE masks the venue once at the session read
  (`0067:249-250`) into the plpgsql variables v_venue_name / v_venue_address; both INSERTs write the variables, DO UPDATE SET uses
  EXCLUDED and both IS DISTINCT FROM tuples carry the two columns: the same semantics as R2.
- **R3 /me definer.** Branch (a) seats: `CASE WHEN NOT s.hide_exact_address OR pl.status = 'active' THEN s.venue_name END` (address alike);
  branch (b) pending: `CASE WHEN NOT s.hide_exact_address THEN s.venue_name END` (address alike). Row set (M-3, `:119-120`, `:132-140`)
  unchanged, so left/removed seats return no row.
- **R4 header comment.** States the threat model (section 5), what changed and why (DD-139 / B1), and that the column comments of `0002:83-84`
  and the `0059:13-15` header are superseded (old migrations are append-only, never edited).
- **R5 nothing else.** No fence change (0033 untouched), no route row (`0061:489-503` unchanged), no other function, no new role.

### 4.2 Core command (`packages/db/src/session-service.ts`)

`hideExactAddress?: boolean` on the create payload (after `:81`) and the update payload (after `:1122`); `undefined | boolean` only,
anything else (null included: NOT NULL column) -> `INVALID_INPUT` (create via fail() before `:233`; update via failUpdate() after `:1320`,
union `:1056-1070` +1 line). Create writes `?? false`. Update: absent = unchanged; a changed value is SET and pushes `"hide_exact_address"`
into changedFields (`:1405-1456`) so `session.updated` fires (`:1625-1632`); same value = no change, no event. Venue text-safety rules
unchanged (L23). The host DTO (`session-read.ts:96-97`, `:183-184`) gains `hideExactAddress`.

### 4.3 Public DTO and views

`public-discovery-read.ts` row type +2 nullable fields, COLUMNS +2 (comment "17" -> "19"). `discovery-route-support.ts` OPTIONAL_DTO_KEYS
+2 pairs (`venueName`/`venue_name`, `venueAddress`/`venue_address`); null is dropped (`:256`) => OFF + typed = present, ON or untyped =
absent. `discover-api.ts` DiscoveryListing + parseListing via `str()`. `listing-summary.tsx` renders name and full address when present,
nothing otherwise (no placeholder); `:27` contract comment updated. Exactly two new public fields; no host, player, person or membership
field. /me: `me-player-api.ts` drops the active-only TS cut `:134-135` (the TS layer cannot see the option; SQL is the single enforcement
point); `my-sessions-view.tsx:38` renders the venue whenever the row carries it. Host: form toggle (D-3, D-8, D-9), `details-tab.tsx` row.

## 5. Threat model (repeat in the migration header)

Defends against: **T1** leaking an exact venue the host chose to hide: with the option ON the venue never leaves the database for the public
read model or for a viewer who is not active in that session; enforced in SQL in exactly two places (R2, R3); the web layers pass the SQL
value through and never re-derive it. **T2** leaking anything beyond the venue: the public DTO gains exactly `venueName` and `venueAddress`;
the whitelist tests (Q5) pin the exact column and key sets. **T3** a stale projection: toggling the option re-projects the session through
the outbox path the projector already uses (4.2 -> `0061:494` -> writer R2). Between the toggle and the next projection the public row
keeps the venue; the dispatch cycle bounds the window; the re-projection test (A-5) proves the row clears. With dispatch off (committed
default until L22) nothing re-projects: the same staleness every other public field has. Not defended: a viewer who copied the venue
before the toggle. The /me read has no window (it reads sessions directly). The DD-12 fence is declined (section 2 pin 2).

## 6. Decision table and acceptance matrix (real DB unless named)

| # | Row | Expected | Test |
|---|---|---|---|
| A-1 | option OFF, any viewer, any named surface | venue name and address | projector test (public row), public-discovery-read test (list/detail/share), me-player-reads test (active, waitlisted, requested), 3 discover route tests, discover-api test, detail/list view tests, my-sessions-view test, me-player-api test, e2e player.spec OFF case |
| A-2 | option ON, public read model (anonymous or any viewer without an active seat; an active player on discover detail too, the row is viewer-independent) | area only; both venue columns NULL | projector test, public-discovery-read test, route tests (keys absent), detail view test |
| A-3 | option ON, /me, players.status = 'active' | venue name and address | me-player-reads test + nobypass suite `:131` |
| A-4 | option ON, /me, waitlisted or requested | area only (venue NULL); left/removed: no row (M-3) | me-player-reads test; e2e player.spec ON case |
| A-5 | option turned ON after a projection / turned OFF | next projection clears / restores the venue | projector test: option-only `updateSession` -> outbox `session.updated` with `["hide_exact_address"]` -> writer -> row; session-service test (event emitted) |
| A-6 | no venue typed | fields NULL, no placeholder text | projector test, public-discovery-read test, detail view test |
| A-7 | create without the field / with true; update absent / changed / same; null or non-boolean | false / true; unchanged / SET + event / no event; INVALID_INPUT (route: INVALID_BODY 400) | session-service test, session-command-route test |
| A-8 | public DTO field set | exactly two new fields | projector TABLE_COLS/VIEW_COLS, rls `:183`, `:213-231`, route tests, discover-api test |
| A-9 | Zalo DM on an option-only update | none (noop_irrelevant_fields) | existing zalo-dm coverage (no edit) |
| A-10 | re-created functions | owner, SECURITY DEFINER, search_path, VOLATILE, ACL unchanged; view security_barrier kept | projector test `:628-638`, rls `:495-497`, nobypass suite, catalog asserts in the projector and me-player-reads tests |
| A-11 | form toggle | off by default, real t(vi, en) label + help, sends only when set/changed | session-form-model test, session-form test |
| A-12 | pins | 67 -> 68, tail 0067 | migrate, rls-invariants, outbox-projector-registry tests |

Verification: the S1 VERIFY set; `NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test`; `pnpm --filter @plexco/core test`;
`pnpm --filter @plexco/web test` (full web vitest after every unit); `pnpm --filter @plexco/bot test`; Playwright under the lock wrapper
(golden path included, unchanged); `pnpm build` once at the final head (sandbox off); one migration at a time; full `pnpm -w test` once at
the final head.

## 7. Pinned defaults: each "default applied, pending owner sign-off"; repeat each in the PR body

- **D-1** `sessions.hide_exact_address boolean NOT NULL DEFAULT false`; API field `hideExactAddress` (create body, update body, host DTO).
- **D-2** `public_sessions.venue_name text NULL`, `public_sessions.venue_address text NULL`, NULL whenever the option is ON (or untyped); view
  `public_session_share_v` appends both (17 -> 19 columns); public DTO keys `venueName`, `venueAddress`, absent when NULL.
- **D-3** copy: label `t("Ẩn địa chỉ chính xác đến khi xác nhận", "Hide exact address until confirmed")`; help line `t("Khi bật, chỉ người
  chơi đã có chỗ mới thấy tên sân và địa chỉ; người khác chỉ thấy khu vực.", "When on, only players with a confirmed seat see the venue name
  and address; everyone else sees the area only.")`; details row: the label pair, value `t("Bật", "On")` / `t("Tắt", "Off")`.
- **D-4** existing sessions get the option OFF, so their venue becomes public (say so plainly in the PR body: the owner's B1 default). The
  migration writes no public_sessions row (P-12 single writer); an existing listing shows its venue from its next projection.
- **D-5** the venue address is shown in full (no truncation).
- **D-6** a waitlisted or requested viewer sees the venue when the option is OFF.
- **D-7** validation: boolean only; null or any other type -> `INVALID_INPUT` (reused, no new code).
- **D-8** create body sends `hideExactAddress` only when true; update body only when it differs from `original.hideExactAddress ?? false`
  (keeps `session-form-model.test.ts:120`, `:141`, `:149`, `:152`, `:173` and `sessions.spec.ts:852-856` green).
- **D-9** toggle placement: end of the Place fieldset (`session-form.tsx:189-215`), help line with the TextField hint styling (no new CSS).

## 8. Pin sites (Q6), spec follow-ups (Q7), conductor readings

**Pin sites (14 lines, 3 files; mechanical, listed SEPARATELY in the PR body).** Count 67 -> 68 (10): `packages/db/src/migrate.test.ts:53`
(`MIGRATION_COUNT`, prepend the 0067 entry to the comment); `rls-invariants.test.ts:70`, `:73`, `:1825`, `:1830`, `:4701`, `:4703`;
`outbox-projector-registry.test.ts:114`, `:115`, `:120`. Tail `0066_account_club_chat_context.sql` -> `0067_session_venue_visibility.sql`
(4): `migrate.test.ts:769`; `rls-invariants.test.ts:2108`, `:4704`; `outbox-projector-registry.test.ts:117`. Comment-only 0066 mentions
and dated docs: no edit.

**Spec follow-ups (no spec edited).** `git diff --stat 3a97c7b650200a327d9ad705a8813619a1c528c9 6d7bfcc -- docs/features docs/product
docs/channels` is empty => DD-139's list (`decisions.md:1840-1846`: 32 old-rule spec lines + 11 join-contract venue lines, in
`feature_player_view.md`, `feature_player_view_tech.md`, `feature_marketplace_discovery.md`, `feature_marketplace_discovery_tech.md`
among others) holds at the base. Decision-log rows B1 reverses for the option OFF: M-7 `:1931` (rejected -> DD-139), P-6 `:2354` (signed;
survives as the option-ON rule), the DD-06 invariant `:239`. Kept: Z-13 `:1925`, P-11 `:1957`, P-18 `:2247` (RQ1), M-3 `:2217`, L2 #61
`:2075-2083` (L23).

**Conductor readings (PR body, not owner approvals).** RO-L19-4: the share route is a public card and follows B1; DMs, bot replies, chat
and tournament keep their rules. RQ1 answered: conductor reading RO-L20-1 (`status/P3-S15a-notes/conductor-ruling-l20-1.md`), option A:
join response unchanged (P-18 stands for its venue part); if the owner wants the venue in the web join response too, that is a follow-up
lane (B1 does not name it).

## 9. Out-of-scope test notes

`player-api-mock.ts:278-282` (NO_VENUE rows = the option-ON server shape) and `session-api-mock.ts`, `sessions.spec.ts`,
`golden-path.spec.ts` need no edit (bodies unchanged when the toggle is untouched; positive venue asserts stay). `player-views.test.tsx`,
`join-panel.test.tsx` and `app/api/me/sessions/route.test.ts` carry no venue rule that changes.

## 10. B3 estimate (from the unit plan)

Production 18 files ~495 LOC (0067 ~370 of it, mostly restated function bodies) + this file ~250 => **non-test ~745 / 1,600**; **test ~970 /
2,400** (21 files); **total ~1,715 / 4,000**; **files 40 / 45** (19 non-test incl. this file + 21 test); **1 migration / 1**. Modules
packages/db, apps/web, apps/bot (test only): the lane block pre-approves the B3 exception up to these caps; a split breaks coherence (the
option is meaningless without its projection and its reads); compatibility: additive column with default false, view appends columns,
RETURNS TABLE identical. A writer who finds the count would pass a cap stops and files a ruling request with the split (data path U1-U10,
U14-U15 first; UI second).

## 11. Unit plan (one file or one section each; test-first; DB suites, migrations and commits serialized under the one lock)

| U | File (section) | Model | Tests written or adapted | Depends | LOC code/test |
|---|---|---|---|---|---|
| U1 | 0067 section A (R1 A, R4) | opus/max | the 14 pins; rls `:183` | - | 70/25 |
| U2 | 0067 section B (R1 B, R3) | opus/max | me-player-reads.test.ts (A-1, A-3, A-4, A-6); me-player-reads-nobypass.test.ts suite `:131` (option ON) | U1 | 75/200 |
| U3 | 0067 section C (R1 C, R2, R5) | opus/max | public-sessions-projector.test.ts (Q5 sites; A-1, A-2, A-5, A-6, A-10); rls `:213-231`, `:238`, `:575` | U2 | 225/170 |
| U4 | packages/db/schema.ts `:633-634`, `:1683` | opus/max | existing schema/catalog tests | U3 | 5/0 |
| U5 | packages/db/db.dbml `:196-204`, `:497` | opus/max | - | U3 | 4/0 |
| U6 | packages/db/src/session-service.ts (4.2) | opus/max | session-service.test.ts (A-5 event, A-7) | U3 | 35/140 |
| U7 | packages/db/src/session-read.ts `:96-97`, `:183-184` | opus/max | session-service.test.ts host-read asserts | U6 | 4/15 |
| U8 | packages/db/src/public-discovery-read.ts | opus/max | public-discovery-read.test.ts (Q5; A-1, A-2, A-6) | U3 | 5/50 |
| U9 | packages/db/src/me-player-reads.ts (M-7 wording in comments -> DD-139; no logic) | opus/max | - | U3 | 3/0 |
| U10 | apps/bot/src/projectors/public-sessions.test.ts (fixture `:132`) | opus/max | itself | U3 | 0/10 |
| U11 | apps/web/lib/discovery-route-support.ts `:228-237` | opus/max | the 3 discover route tests (A-1, A-2, A-8) | U8 | 2/45 |
| U12 | apps/web/lib/discover-api.ts `:62-75`, `:101-114` | opus/max | discover-api.test.ts | U8 | 4/20 |
| U13 | apps/web/components/discover/listing-summary.tsx | sonnet/high | discover-detail-view.test.tsx, discover-list-view.test.tsx | U12 | 15/55 |
| U14 | apps/web/lib/me-player-api.ts `:134-135` (+ comments) | opus/max | me-player-api.test.ts | U3 | 6/30 |
| U15 | apps/web/app/api/me/sessions/route.ts `:10` (comment) | opus/max | - | U3 | 1/0 |
| U16 | apps/web/components/player/my-sessions-view.tsx `:38`, `:47-48` | sonnet/high | my-sessions-view.test.tsx | U14 | 6/35 |
| U17 | apps/web/lib/sessions-api.ts `:19`, `:132` | sonnet/high | typecheck | U7 | 2/0 |
| U18 | apps/web/lib/session-command-route.ts `:372-375`, `:392-403` | opus/max | session-command-route.test.ts (A-7) | U6 | 2/25 |
| U19 | apps/web/lib/session-form-model.ts (D-8) | sonnet/high | session-form-model.test.ts (A-11) | U17 | 12/60 |
| U20 | apps/web/components/sessions/session-form.tsx (D-3, D-9) | sonnet/high | session-form.test.tsx (A-11, both languages) | U19 | 16/45 |
| U21 | apps/web/components/sessions/details-tab.tsx after `:17` | sonnet/high | - (no test file at the base) | U17 | 3/0 |
| U22 | apps/web/e2e/player.spec.ts `:32-75` (ON case re-cast with server NULLs; new OFF case) | sonnet/high | itself (Playwright) | U13, U16 | 0/45 |

Parallel groups (file-disjoint): **W1** U1 -> U2 -> U3 serial (one file; every DB suite migrates to the tail, so nothing else starts before
U3). **W2** {U4, U5, U6, U8, U9, U10, U14, U15}. **W3** {U7, U18} after U6; {U11, U12} after U8; U16 after U14. **W4** U13 after U12; U17
after U7. **W5** {U19, U21} after U17; U22 after U13 + U16. **W6** U20 after U19. Each unit runs GitNexus impact before editing a symbol
and `detect_changes` before its commit (grep of callers in the PR body if GitNexus is unavailable).

## 12. OPEN (out of scope for L20)

- O-1 RQ1 answered: conductor reading RO-L20-1 (`status/P3-S15a-notes/conductor-ruling-l20-1.md`), option A: join response unchanged
  (P-18 stands for its venue part); if the owner wants the venue in the web join response too, that is a follow-up lane
  (B1 does not name it).
- O-2 Spec follow-ups of section 8 (Phase 4 docs lane, owner backlog C).
- O-3 OUT_OF_SCOPE observation: an update of only DD-39 per-gender prices emits no `session.updated` (`session-service.ts:1426-1427`);
  if those prices are projected publicly the public row goes stale (pre-existing; not this lane).
- O-4 L23 (R1-5) must cover the venue name once it is public (lane block dependency).

## 13. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = worktree HEAD = session base; every TARGET_FILES path exists at the base (measured) | PASS |
| 2 | Decisions in scope final | B1 / DD-139 `decisions.md:1825-1846`; D-1..D-9 pinned as defaults pending sign-off; RQ1 out of scope | PASS |
| 3 | Scope IN/OUT and owner clear | sections 2, 4, 11; lane NEGATIVE SCOPE; L22 ownership disjoint; sole migration writer in P3-S15 | PASS |
| 4 | Dependencies classified | L19 #93 merged at the base (DD-139 present); L23 waits for this lane | PASS |
| 5 | Live schema and code match | section 3, measured at the base | PASS |
| 6 | Data, API, state, auth contract | section 4 | PASS |
| 7 | Fail-closed, idempotency, order | NULL unless OFF or active (R2, R3); same value = no event; IS DISTINCT FROM covers the flip; T3 window stated | PASS |
| 8 | Open questions in scope = 0 | section 7 pins; section 12 is out of scope | PASS |
| 9 | Acceptance matrix with expected results | section 6 | PASS |
| 10 | Migration, security, rollback | one additive migration; owners, attributes and ACL restated; nobypass suite; rollback = revert | PASS |
| 11 | First slice hard dependencies merged | L19 #93 | PASS |
| 12 | Implementation handoff ready | sections 4-11; worktree clean at the base | PASS |

## 14. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-21
AUTHORITY_SHA: 6d7bfccac7401d0052be643d29e5bb0cbfbc0c0e
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/standards/review-code-readiness-gate.md
  - docs/features/FE/feature_player_view.md
  - docs/features/BE/feature_player_view_tech.md
  - docs/features/FE/feature_marketplace_discovery.md
  - docs/features/BE/feature_marketplace_discovery_tech.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m9-me-reads.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m10-chat-member-entry.md
  - package.json
  - packages/db/schema.ts
  - packages/db/db.dbml
  - packages/db/migrations/0002_tenants_core.sql
  - packages/db/migrations/0006_discovery.sql
  - packages/db/migrations/0033_public_projection_fences.sql
  - packages/db/migrations/0059_me_player_reads_definers.sql
  - packages/db/migrations/0061_public_sessions_projector_writer.sql
  - packages/db/migrations/0066_account_club_chat_context.sql
  - packages/db/src/index.ts
  - packages/db/src/session-service.ts
  - packages/db/src/session-service.test.ts
  - packages/db/src/session-read.ts
  - packages/db/src/public-discovery-read.ts
  - packages/db/src/public-discovery-read.test.ts
  - packages/db/src/public-session-fence.ts
  - packages/db/src/public-sessions-projector.test.ts
  - packages/db/src/me-player-reads.ts
  - packages/db/src/me-player-reads.test.ts
  - packages/db/src/me-player-reads-nobypass.test.ts
  - packages/db/src/test-harness.ts
  - packages/db/src/migrate.test.ts
  - packages/db/src/rls-invariants.test.ts
  - packages/db/src/outbox-projector-registry.test.ts
  - packages/core/src/api-contract.ts
  - packages/core/src/api-contract.test.ts
  - apps/bot/src/projectors/public-sessions.ts
  - apps/bot/src/projectors/public-sessions.test.ts
  - apps/web/lib/discovery-route-support.ts
  - apps/web/lib/discover-api.ts
  - apps/web/lib/discover-api.test.ts
  - apps/web/app/api/discover/route.ts
  - apps/web/app/api/discover/route.test.ts
  - apps/web/app/api/discover/[publicListingId]/route.ts
  - apps/web/app/api/discover/[publicListingId]/route.test.ts
  - apps/web/app/api/discover/share/[slug]/route.ts
  - apps/web/app/api/discover/share/[slug]/route.test.ts
  - apps/web/components/discover/listing-summary.tsx
  - apps/web/components/discover/discover-detail-view.tsx
  - apps/web/components/discover/discover-detail-view.test.tsx
  - apps/web/components/discover/discover-list-view.tsx
  - apps/web/components/discover/discover-list-view.test.tsx
  - apps/web/lib/me-player-api.ts
  - apps/web/lib/me-player-api.test.ts
  - apps/web/app/api/me/sessions/route.ts
  - apps/web/app/api/me/sessions/route.test.ts
  - apps/web/components/player/my-sessions-view.tsx
  - apps/web/components/player/my-sessions-view.test.tsx
  - apps/web/lib/session-form-model.ts
  - apps/web/lib/session-form-model.test.ts
  - apps/web/lib/session-command-route.ts
  - apps/web/lib/session-command-route.test.ts
  - apps/web/lib/sessions-api.ts
  - apps/web/lib/session-snapshot.ts
  - apps/web/components/sessions/session-form.tsx
  - apps/web/components/sessions/session-form.test.tsx
  - apps/web/components/sessions/details-tab.tsx
  - apps/web/components/sessions/session-card.tsx
  - apps/web/e2e/player.spec.ts
  - apps/web/e2e/support/player-api-mock.ts
  - apps/web/e2e/golden-path.spec.ts
  - apps/web/e2e/sessions.spec.ts
  - apps/web/app/api/sessions/[id]/join/route.ts
SLICE: p3-venue-public-default
IN_SCOPE: per-session host option sessions.hide_exact_address (default false) set from the session form on create and edit; venue name and address projected into public_sessions and public_session_share_v when the option is off (NULL when on) and served on the discover list, detail and share DTOs; account_my_sessions venue rule follows the option; web layers pass the SQL value through; one migration 0067; the 14 pin lines; a test for every decision-table row
OUT_OF_SCOPE: Zalo DM, notification and bot copy (Z-13 unchanged); the web join response (P-18, RQ1); chat and tournament surfaces; who can join, prices, occupancy, roster; any person or membership id on a public DTO; Reviewed specs and decisions.md (follow-ups listed only); flags, env and config files (L22); text-safety rules (L23); area rules; the DD-12 fence (0033) and every other function; packages/core/src/api-contract.ts (no edit)
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: L19 #93 merged 6d7bfccac7401d0052be643d29e5bb0cbfbc0c0e (probe DD-139 heading docs/standards/decisions.md:1825); owner decision B1 confirmed 2026-10-21
PRIOR_SLICES: L19 p3-dd138-signoff (#93); L9 p3-m9-me-reads (0059); 0061 public sessions projector writer
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # one additive migration; writer re-created as job_definer inside the bracket and account_my_sessions as the migration role outside it, attributes and ACL restated; the hidden venue is cut in SQL only; opus/max reviewer + opus/max security round
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: section 11 U1 - GitNexus impact (createSession, updateSession, toDiscoveryListingDto, parseListing, buildCreateBody, buildUpdateBody), then the 14 pins and the rls public_sessions column pin red before writing section A of packages/db/migrations/0067_session_venue_visibility.sql
REMAINING_BLOCKERS: none
```
