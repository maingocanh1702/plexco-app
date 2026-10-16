<!-- review-readiness: code-ready -->

# Step-0 readiness: L7 p3-m9-occupancy-helper (session P3-S3)

> Agent-facing. Readiness reviewer: opus/max (same model and effort as the lane's code reviewer). Writer: opus/max. Code reviewer: opus/max, at most 3 rounds,
> no security round (lane MODELS line: `security none`). Review questions (lane REVIEW PLAN): semantic drift, lock order, tenant filters kept, unlocked reads advisory.
> Lane contract: `docs/autopilot-templates/web-mvp-phase3-2026-10-16-RUN.md:430-467` (L7) and the P3-S3 session block `:1025-1042`. File-disjoint rule `:1036-1038`:
> L7 is the ONLY editor of `session-service.ts`, `roster-service.ts`, `session-read.ts`, the occupancy module, `sessions-api.ts`, the roster-counts and session-card
> components and `e2e/support/session-api-mock.ts` (L5 must not touch it); L4 is the ONLY `packages/db/src/index.ts` editor.
> Every `path:line` below is MEASURED at base `442aa1bf61234a7b4330295dfd36211446988a8a`. The lane block was measured at `c762c90`; #61, #62, #63 and #64 shifted
> lines since. Use THIS file's numbers.

## 1. Authority

- DD-133 (D1), owner-signed 2026-10-16 "Phase 3 plan approved. D1 signed (a)-(e)." (`docs/standards/decisions.md:124` row, `:1837-1859` section). Part (a)
  `:1844-1845`: one helper `getSessionOccupancy` returning one number; `confirmed_count` = active players, tenant-private; `slots_open` = NULL when `slots_max` is
  NULL, else max(0, slots_max - occupied); the public DTO carries `slots_open` only. Consequence `:1855`: L7 (occupancy stage 1) does not wait. Parts (b)-(e) are
  the single L10 migration and lane L10a, not L7.
- DD-32 amend pointers (`decisions.md:469`, `:472`): the only helper is `getSessionOccupancy()` = active + guest notes + live holds, live holds = 0 until a hold table
  exists; browse shows `slots_open` only.
- Research backing DD-133 (part (a) signed "as written in sections 2-3"): `docs/research/occupancy-authority-2026-10-16.md` section 2 `:39-48` (module, exports,
  consumers; `:48` "both DTOs gain a server `slotsOpen`, so `roster-counts.tsx:11` stops deriving"), section 6 `:82` (stage 1 = code only, no migration, no owner
  wait), `:92` (stage 1 never waits for part (a) or (b)).
- Lane: `OWNER DECISIONS NEEDED: none`; `DEPENDS ON: none`. DD-122 D4 (owner 2026-10-12): review by an independent Claude subagent, Codex waived.

## 2. Measured at base (Q1 copies, Q3 locks)

| # | Copy | Where | What it computes | Tenant filter | Locked |
|---|---|---|---|---|---|
| C1 | `sessionActiveRosterCount` (not exported; doc `:2072-2077`) | `packages/db/src/session-service.ts:2078-2084` | `count(*)` players, `session_id = $s and status = 'active'` (`:2080-2082`), `Number()` | none explicit (caller's `withTenant` GUC) | by caller |
| C2 | `sessionOccupancy` (exported; doc `:2662-2675`) | `session-service.ts:2676-2683` | C1 + `count(*)` session_guest_notes `session_id = $s` (`:2678-2681`); two statements | none explicit | by caller |
| C3 | list `activeCountSql` | `packages/db/src/session-read.ts:200` (selected `:208`) | correlated `count(*)::int` players, `session_id = sessions.id and tenant_id = $t and status = 'active'` | explicit `tenant_id`; `withTenant` `:202`; outer `sessions.tenant_id` `:218` | no |
| C4 | list `occupiedCount` | `session-read.ts:211` | `(C3 + count(*)::int session_guest_notes where session_id = sessions.id and tenant_id = $t)::int` | explicit, both terms | no |
| C5 | detail `counts.occupied` | `session-read.ts:371` | calls C2 | session id only (documented exception `:22-23`); head verified in tenant `:259` | no |
| C6 | detail `counts.active / waitlisted / guestNotes` | `session-read.ts:368-370` | JS filters over the roster rows (`:288`, tenant + session, no limit) and `notes.length` (`:301`) | explicit | no |
| C7 | client `free` | `apps/web/components/sessions/roster-counts.tsx:11` | `slotsMax === null ? null : Math.max(0, slotsMax - counts.occupied)` | n/a | n/a |
| C8 | card | `apps/web/components/sessions/session-card.tsx:21-30` | renders `occupiedCount/slotsMax` (`:28-29`) and `activeCount` when unlimited (`:24-25`); derives nothing | n/a | n/a |
| C9 | web DTO types | `apps/web/lib/sessions-api.ts:33-38` (`occupiedCount` `:37`), `:84-88` (`counts.occupied` `:87`) | types only | n/a | n/a |
| M1 | e2e mock, list | `apps/web/e2e/support/session-api-mock.ts:289-296` | `activeOf(s)` (status `active`, `:289-290`) + `s.guestNotes.length` (`:295`) | n/a | test double |
| M2 | e2e mock, detail | `session-api-mock.ts:357-373` | `active + target.guestNotes.length` (`:373`) | n/a | test double |
| M3 | e2e roster mock (out of scope, no change) | `apps/web/e2e/support/roster-api-mock.ts:134-136` | active + guest notes; `full = occupied >= slotsMax` | n/a | test double |

- Not occupancy: `guestNoteCountFor` `session-service.ts:2649-2660` (per-person 3-note limit; stays). `apps/web/lib/session-read-route.ts` is the generic read gate
  (`handleSessionRead` `:77-105`) and `apps/web/lib/session-dto.ts` (17 lines) is the auth-session DTO of `GET /api/auth/session`: neither maps a session DTO. The
  routes pass the read model through: `apps/web/app/api/sessions/route.ts:69` (`listSessions`), `apps/web/app/api/sessions/[id]/route.ts:60` (`getSessionDetail`);
  `git grep occupiedCount apps/web/app` is empty. Repo-wide, only `schema.ts`, `session-read.ts` and `session-service.ts` read guest notes outside migrations.
- Imports today: `roster-service.ts:18` and `session-read.ts:14` import `sessionOccupancy` from `./session-service.js`; `packages/db/src/index.ts` exports neither C1 nor C2.
- **Q1 drift verdict: none.** Every copy is active players + guest notes; waitlisted and left rows are excluded by the status filter; pending join requests are never
  read (`join_requests`, `packages/db/schema.ts:1629-1645`, status default `pending`, is referenced by no copy); pending players and holds are structurally zero
  (doc `session-service.ts:2664-2674`: `players_status_chk` has no `pending`, no hold table). Non-semantic differences, each pinned by an equivalence row (section 7):
  d1 the list adds an explicit `tenant_id` filter to both terms, the commands do not (equal under the same-tenant composite FKs, research `:44`); d2 commands use
  `count(*)` bigint then `Number()`, the list `::int`; d3 C2 is two statements, C4 one; d4 detail `counts.active` is a JS count from another statement than
  `counts.occupied` (unlocked, advisory).

**Q3 command callers** - every capacity read happens AFTER `sessions ... FOR UPDATE`, inside the command's `withTenant` transaction:

| Caller | Transaction | Session lock | Count call | Effect |
|---|---|---|---|---|
| `updateSession` `session-service.ts:1151` | tenant GUC (lock comment `:1270-1272`) | `:1273-1290` | C1 `:1468`, C2 `:1472` | `CAPACITY_BELOW_ROSTER` `:1469-1471`, then `CAPACITY_BELOW_OCCUPANCY` `:1473` (`:1019` union); only when slots_max changes to a finite value `:1467` |
| `cancelSession` `:2129` | `withTenant` `:2138` | `:2204-2208` | C1 `:2283` | `CANCEL_REQUIRES_REVIEW` on a non-zero active roster |
| `createGuestNote` `:2711` | `withTenant` `:2716` | `:2760-2768` | C2 `:2814` | `SESSION_FULL`; NULL slots_max is never full |
| `deleteGuestNote` `:2932` | `withTenant` `:2937` | `:2991-2995` | C2 `:3015`, after the delete `:3004-3007` | event field `occupancy_after` |
| `addMemberToSession` `packages/db/src/roster-service.ts:121` | `withTenant` `:126` | `:156-160`, then the existing player row `:171-175` | C2 `:180-181` | full: waitlisted (tail `:183-189`), no charge |

Unlocked reads, advisory only (they never admit anyone): `listSessions` `session-read.ts:187-239`, `getSessionDetail` `:247-375`.

## 3. Answers Q2, Q4, Q5, Q6

- **Q2.** DD-133 (a) and the research change NO stage-1 semantics (active + guest notes; holds 0; pending not representable). What they ask of L7: the module and
  exports of section 4, the renames at the five callers, the SR:211 fragment through `occupiedCountSql`, a server `slotsOpen` in BOTH host DTOs, and equivalence
  tests. Parts (b)-(e) (SQL function `session_occupancy(uuid)`, DD-41 columns, `public_listing_id`, view replacement, alias moderation) are L10/L10a.
- **Q4.** Harness #62: `setupRlsTestContext` (`packages/db/src/test-harness.ts:679`) leases role passwords (`leaseTestRolePasswords` `:721`) and builds `appDb` as
  user `app` (`:722`, pool `max: 4` `:725`); used by `roster-service.test.ts:15` and `session-read.test.ts:17`. Never add per-suite role passwords. Equivalence:
  extend `describe("listSessions occupiedCount")` `session-read.test.ts:181-232` (the cited `:228` = list vs detail assertion); key list `:125-150` and detail
  `counts` `toEqual` `:280-285` gain `slotsOpen`. Concurrency: replace the 2-way test `roster-service.test.ts:212-227` (via `add()` -> `addMemberToSession(ctx.appDb.db, ...)` `:28`)
  with N = 4. `CAPACITY_BELOW_OCCUPANCY` is pinned today by `session-service.test.ts:2148-2169` (U-CAPACITY `it.each`) and `:2219` onward (lock-ordered race vs
  `SESSION_FULL`); `SESSION_FULL` by `:4599-4606`, `:4611` (unlimited), `:4857`. They stay unchanged and green. `slotsOpen` pure tests: NEW `session-occupancy.test.ts`
  (no DB). Proof commands: section 7 G1-G5 (POSIX classes: macOS `git grep -E` has no `\s` or `\b`).
- **Q5.** DTO path: `session-read.ts` read models -> routes (pass-through, section 2) -> `sessions-api.ts` types -> components. `slotsOpen` is computed in
  `session-read.ts` with the pure helper; the web only types and renders it; `roster-counts.tsx:11` stops deriving. Host-only reads behind `authorize(session.manage)`
  (`session-read.ts:19-20`); `public_sessions` (`0006_discovery.sql:21`), `public_session_share_v` (`0033_public_projection_fences.sql:132-145`) and the whitelist test
  stay untouched; no `confirmed_count` anywhere (`session-read.ts:25-27`).
- **Q6.** Section 9: about 305 changed lines, 4 modules, 0 migrations: explicit B3 exception (module count).

## 4. Contract

NEW `packages/db/src/session-occupancy.ts` (internal to `packages/db`; NOT exported from `index.ts`):
- `activeCountSql(sessionId: AnyColumn | SQL | string, tenantId?: string): SQL<number>` = `(select count(*)::int from players where session_id = <s> [and tenant_id = <t>] and status = 'active')`.
- `occupiedCountSql(sessionId, tenantId?): SQL<number>` = `(<activeCountSql> + (select count(*)::int from session_guest_notes where session_id = <s> [and tenant_id = <t>]))::int`.
  THE formula: the only per-session guest-note count in production code.
- `sessionActiveRosterCount(tx: Tx, sessionId: string): Promise<number>` and `getSessionOccupancy(tx: Tx, sessionId: string): Promise<number>`: one statement each,
  `tx.execute(sql\`select ${expr} as n\`)` then `Number(rows[0].n)` (execute pattern: `packages/db/src/auth.ts:234`, `tenant.ts:55`). Call only inside the caller's
  `withTenant` transaction; a capacity decision calls it after `sessions ... FOR UPDATE`. The doc `session-service.ts:2662-2675` and `:2072-2077` move here.
- `slotsOpen(slotsMax: number | null, occupied: number): number | null` = `slotsMax === null ? null : Math.max(0, slotsMax - occupied)` (pure).
- Imports drizzle `sql`, `players`, `sessionGuestNotes` and type `Tx` only; never imports `session-service.ts` (no cycle). No per-term breakdown, no hold term, no join_requests.

Read models: `SessionListItem` (`session-read.ts:107-110`) gains `slotsOpen: number | null`, set in the page mapper `:233` from `slotsMax` and `occupiedCount`;
`SessionDetail.counts` (`:152-153`) gains `slotsOpen` from `head.slotsMax` and `getSessionOccupancy` (`:371`). Web: `SessionListItemDto` (`sessions-api.ts:35-38`)
and `SessionDetailDto.counts` (`:87`) gain `slotsOpen: number | null`; `roster-counts.tsx:11` becomes `const free = counts.slotsOpen;` with the render `:24-27`
unchanged (no new strings). Additive JSON only; command responses, error codes and events are unchanged.

## 5. Pinned defaults (each is "default applied, pending owner sign-off"; repeat them in the PR body; L17 consolidates)

- **OC-1** tenant filters: optional `tenantId` on both SQL builders; `listSessions` passes it (explicit filters of C3/C4 kept); the scalar wrappers pass none
  (session id only, as C1/C2 today). Default applied, pending owner sign-off.
- **OC-2** one statement per wrapper (d3): same numbers, because every writer serializes on the session row lock and unlocked reads are advisory. Default applied, pending owner sign-off.
- **OC-3** placement: list row field `slotsOpen` and detail `counts.slotsOpen`, both `number | null`, computed server-side with `slotsOpen()`. Default applied, pending owner sign-off.
- **OC-4** `session-card.tsx` unchanged: it derives nothing (C8). Default applied, pending owner sign-off.
- **OC-5** scope addition, compile-forced: `apps/web/lib/session-form-model.test.ts:48` (fixture typed `SessionDetailDto` at `:25`; `apps/web/tsconfig.json:12-19`
  includes `lib`) gains `slotsOpen: 12`. `roster-tab.test.tsx:55-64` casts through `unknown` and is not edited. Default applied, pending owner sign-off.
- **OC-6** concurrency N = 4 = the app pool max (`test-harness.ts:725`), so all N transactions are open at once. Default applied, pending owner sign-off.
- **OC-7** equivalence fixtures: rows EQ1-EQ9 of section 7, seeded through `ctx.owner` raw SQL as the existing test does; a pending `join_requests` row is one of
  them. Default applied, pending owner sign-off.
- **OC-8** names: `sessionOccupancy` is renamed `getSessionOccupancy` everywhere (11 lines today, all in scope files); `sessionActiveRosterCount` keeps its name.
  Default applied, pending owner sign-off.
- **OC-9** the e2e mock (M1, M2) mirrors `slotsOpen` with the same formula; it is the server double, not app code. Default applied, pending owner sign-off.

## 6. Implementation steps (dependency order, test-first)

1. GitNexus `impact` upstream on `sessionOccupancy`, `sessionActiveRosterCount`, `listSessions`, `getSessionDetail`, `addMemberToSession`, `RosterCounts`; report
   the blast radius, warn on HIGH or CRITICAL (fallback: the caller greps of section 2 in the PR body).
2. Tests first: NEW `packages/db/src/session-occupancy.test.ts` (SO1-SO6); EQ1-EQ9 in `session-read.test.ts:181-232` (import `getSessionOccupancy` and
   `sessionActiveRosterCount` from `./session-occupancy.js`, run them through `withTenant(ctx.appDb.db, tenant, ...)`), `slotsOpen` in `:125-150` and `:280-285`;
   CC1 in `roster-service.test.ts:212-227`.
3. Create `packages/db/src/session-occupancy.ts` (section 4).
4. `session-service.ts`: delete C1 (`:2072-2084`) and C2 (`:2662-2683`), import from `./session-occupancy.js`; `:1472`, `:2814`, `:3015` call
   `getSessionOccupancy`; `:1468`, `:2283` unchanged; refresh comments that name the old helper (`:1463-1466`).
5. `roster-service.ts:18` import and `:181` call. `session-read.ts`: `:14` import; `:200` and `:211` use the builders with `tenantId`; types `:107-110` and
   `:152-153`; mapper `:233`; detail `:367-372`; header `:22-23` names `getSessionOccupancy`.
6. DB suite under the session DB lock (section 8); proofs G1-G5. Commit (db).
7. Web: `sessions-api.ts` types, `roster-counts.tsx:11`, OC-5 fixture line, mock `:295` and `:373` (OC-9). Web unit tests, then e2e under the lock. Commit (web).
8. Full S1 VERIFY set; GitNexus `detect_changes` before each commit.

## 7. Acceptance matrix

| ID | Fixture / input | Expected |
|---|---|---|
| EQ1 | one `active` player, slots_max 2 | `getSessionOccupancy` 1 = list `occupiedCount` 1 = detail `counts.occupied` 1; `slotsOpen` 1 (list and detail); `sessionActiveRosterCount` 1 = `activeCount` = `counts.active` |
| EQ2 | one `waitlisted` player, slots_max 2 | occupied 0 on all three paths; `slotsOpen` 2; active 0 |
| EQ3 | one `left` player, slots_max 2 | occupied 0; `slotsOpen` 2; active 0 |
| EQ4 | one guest note, slots_max 2 | occupied 1; `slotsOpen` 1; active 0 |
| EQ5 | one `pending` join_requests row, slots_max 2 | occupied 0; `slotsOpen` 2 |
| EQ6 | all five kinds on one session, slots_max 2 | occupied 2; `slotsOpen` 0; active 1 |
| EQ7 | EQ6 with slots_max NULL | occupied 2; `slotsOpen` null on list and detail |
| EQ8 | over cap: slots_max lowered to 1 by owner SQL under 1 active + 1 note | occupied 2; `slotsOpen` 0, never negative |
| EQ9 | tenant B note on tenant B session (existing `:229-231`) | never counted in tenant A; tenant B list counts 1 |
| CC1 | N = 4 parallel `addMemberToSession` (host_add, distinct names) on an open slots_max 1 session, app role | exactly 1 `active`, 3 `waitlisted` with positions {1,2,3}; exactly one charge; events 1 `player.added` + 3 `player.waitlisted` |
| CC2 | existing U-CAPACITY `session-service.test.ts:2148-2169` and race `:2219` (`it.each(["guest", "decrease"])`) | unchanged, green: `CAPACITY_BELOW_OCCUPANCY` still fires |
| CC3 | existing `SESSION_FULL` tests `:4599-4606`, `:4611`, `:4857` | unchanged, green |
| SO1-SO6 | `slotsOpen(null,0)`, `(null,5)`, `(5,0)`, `(5,3)`, `(5,5)`, `(2,3)` | null, null, 5, 2, 0, 0; never negative |
| G1 | `git grep -nw sessionOccupancy -- packages apps` | empty (11 lines at base) |
| G2 | `git grep -nE "count\(\*\)" -- packages/db/src/session-read.ts packages/db/src/session-service.ts packages/db/src/roster-service.ts` | exactly one line: `guestNoteCountFor` (5 at base) |
| G3 | `git grep -nE "count\(\*\)" -- packages/db/src/session-occupancy.ts` | exactly two lines: the active term and the guest-note term |
| G4 | `git grep -n "sessionGuestNotes" packages/db/src/session-read.ts` | only the import and the detail notes select (`:292-303`); no occupancy expression |
| G5 | `git grep -nE "slotsMax[[:space:]]*-" -- apps/web/app apps/web/lib apps/web/components` | empty (`roster-counts.tsx:11` at base) |
| W1 | `NODE_ENV=test pnpm --filter @plexco/web test` | green, incl. `session-form-model.test.ts` |
| W2 | Playwright `e2e/sessions.spec.ts`, `e2e/roster.spec.ts` | green; "Free slots" shows the server value (`sessions.spec.ts:351` region) |

## 8. Verification (cite measured output, `| tail -40`)

`pnpm typecheck`; `pnpm lint`; `pnpm format:check`; `pnpm review:check:changed`; `pnpm build`; `NODE_ENV=test pnpm --filter @plexco/web test`;
`NODE_ENV=test DATABASE_URL_TEST=<plexco_test URL> pnpm --filter @plexco/db test`, then `pnpm -w test`; Playwright for W2. DB suites and e2e only under the
session DB/e2e lock (`locked-run.sh`, as at step 0); never two at once; re-run the runbook password step after every full test run. Known flakes: rerun once.
The P3-S3 report carries the EQ/CC test names and the G1-G5 outputs as the equivalence evidence.

## 9. Budget (B3 exception, recorded here and in the P3-S3 report)

Estimate about 305 changed lines, 0 migrations, 4 modules: `packages/db/src` about 270 (new module 75 with about 35 moved doc lines; `session-service.ts` about 50,
mostly deletions; `roster-service.ts` 4; `session-read.ts` 20; tests about 135), `apps/web/lib` 7, `apps/web/components/sessions` 4, `apps/web/e2e` 7. Production
about 170 (incl. the mock), tests about 135. At the default line budget, over the module budget by one.

- **Modules named:** `packages/db/src`, `apps/web/lib`, `apps/web/components/sessions`, `apps/web/e2e`.
- **Why a split breaks coherence:** DONE WHEN needs one formula AND `roster-counts.tsx` no longer deriving; the server `slotsOpen` and its only consumer must land
  together (a db-only PR leaves the client derivation and an unread field; a web-only PR types a field the server does not send and renders an empty "Free slots");
  the e2e mock must mirror the shape in the same PR or W2 breaks; the web part is about 18 lines, not worth a merge round.
- **Compatibility proof:** additive JSON fields on authenticated host reads only; routes pass through (no route or contract change); no migration; no public
  surface; commands keep the same lock order and numbers (CC2, CC3 unchanged and green); rollback = revert the PR.
- **Cap:** at most 420 changed lines in total, at most 200 production. Over the cap: compact with `it.each` and shared helpers, never drop a matrix row; still over:
  stop and report the measured numbers.

## 10. OPEN (out of scope: report, do not edit)

- OUT_OF_SCOPE docs sync (L0/L17): Reviewed specs that name `sessionOccupancy` or the host DTOs (research section 5 item 7) and the backlog row
  `list-sessions-occupied-count-single-source` (closable by this lane; flipped by the backlog reconcile, not here).
- OUT_OF_SCOPE: `apps/web/e2e/support/roster-api-mock.ts:134-136` mirrors the capacity decision correctly (M3); `roster-tab.test.tsx:55-64` lacks `slotsOpen` but compiles.
- Stage 2 (L10): when `occupiedCountSql` emits `session_occupancy(x)`, L10 decides whether the list keeps its explicit tenant filter (OC-1).

## 11. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = worktree HEAD = session base; every TARGET_FILES path exists at the base | PASS |
| 2 | Decisions in scope final | DD-133 (a) signed; lane `OWNER DECISIONS NEEDED: none`; OC-1..OC-9 pinned | PASS |
| 3 | Scope IN/OUT and owner clear | lane FILES IN SCOPE + OC-5; NEGATIVE SCOPE; L7 sole editor per RUN `:1036-1038` | PASS |
| 4 | Dependencies classified | root slice: `DEPENDS ON: none`; `index.ts` untouched (L4) | PASS |
| 5 | Live schema and code match | section 2, measured at the base | PASS |
| 6 | Data, API, state, auth contract | section 4: helper API, additive DTO fields, tenant filters (OC-1) | PASS |
| 7 | Fail-closed, idempotency, order | lock order unchanged at five callers (section 2); CC1-CC3 | PASS |
| 8 | Open questions in scope = 0 | OC-1..OC-9 pinned; section 10 residue is out of scope | PASS |
| 9 | Acceptance matrix with expected results | section 7 | PASS |
| 10 | Migration, security, rollback | no migration, no new input surface, no public field; opus/max reviewer; rollback = revert | PASS |
| 11 | First slice hard dependencies merged | none required | PASS |
| 12 | Implementation handoff ready | sections 4-9; worktree clean at the base with deps installed | PASS |

## 12. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-16
AUTHORITY_SHA: 442aa1bf61234a7b4330295dfd36211446988a8a
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-templates/web-mvp-phase3-2026-10-16-RUN.md (lane contract, read only)
  - docs/standards/decisions.md (DD-133 and DD-32 amend pointers, read only)
  - docs/research/occupancy-authority-2026-10-16.md (read only)
  - packages/db/src/session-service.ts
  - packages/db/src/roster-service.ts
  - packages/db/src/session-read.ts
  - packages/db/src/session-read.test.ts
  - packages/db/src/roster-service.test.ts
  - packages/db/src/session-service.test.ts (read only: capacity pins, no change expected)
  - packages/db/src/test-harness.ts (read only)
  - packages/db/schema.ts (read only)
  - apps/web/lib/sessions-api.ts
  - apps/web/lib/session-form-model.test.ts (one compile-forced fixture property, OC-5)
  - apps/web/lib/session-read-route.ts (read only)
  - apps/web/lib/session-dto.ts (read only)
  - apps/web/app/api/sessions/route.ts (read only: pass-through)
  - apps/web/app/api/sessions/[id]/route.ts (read only: pass-through)
  - apps/web/components/sessions/roster-counts.tsx
  - apps/web/components/sessions/session-card.tsx (reviewed, no change expected)
  - apps/web/e2e/support/session-api-mock.ts
SLICE: p3-m9-occupancy-helper
IN_SCOPE: stage 1 of the occupancy authority with unchanged semantics (active players + guest notes): NEW packages/db/src/session-occupancy.ts (activeCountSql, occupiedCountSql, sessionActiveRosterCount, getSessionOccupancy, pure slotsOpen) and its pure test; the two hand-written copies (session-service.ts sessionOccupancy and the session-read.ts list fragment) deleted and the five command callers plus the detail read switched to the helper with lock order unchanged; a server-computed slotsOpen on the host list row and detail counts mirrored in sessions-api.ts so roster-counts.tsx stops deriving free; the e2e session mock mirrors it; equivalence, concurrency and grep proofs
OUT_OF_SCOPE: any migration, SQL function or column (stage 2 is L10); packages/db/src/index.ts (L4); public_sessions, public_session_share_v and the whitelist test; confirmed_count anywhere; a hold or pending term; join_requests changes; a per-term breakdown; route, api-contract, error-code or event changes; session-card.tsx edits; roster-api-mock.ts and roster-tab.test.tsx; Reviewed spec, decisions and backlog edits (L0, L17)
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none (root slice; stage 1 changes no semantics, so DD-133 is not a precondition)
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration, no new input surface, no public field; tenant filters kept (OC-1); helper runs only inside the callers' withTenant transactions; opus/max reviewer
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: section 6 steps 1-2 - run GitNexus impact on the listed symbols, then write SO1-SO6 in NEW packages/db/src/session-occupancy.test.ts, EQ1-EQ9 in packages/db/src/session-read.test.ts and CC1 in packages/db/src/roster-service.test.ts before creating the module
REMAINING_BLOCKERS: none
```
