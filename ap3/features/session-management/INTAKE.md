---
feature: session-management
readiness_version: null
status: NOT_READY
measured_at: 2026-09-12T14:26:42Z
base_sha: e235ea42d7946daac5d25ecccf51e298837e7c41
sources:
  - docs/features/FE/feature_session_management.md
  - docs/features/BE/feature_session_management_tech.md
  - docs/standards/feature-readiness.md
  - docs/standards/decisions.md
  - docs/product/ROADMAP.md
  - docs/product/PRD.md
  - docs/product/TDD.md
  - docs/issues/session-management-acceptance-checklist.md
  - docs/autopilot-invariant-catalog.md
  - docs/templates/feature-spec-template.md
  - docs/templates/be-tech-spec-template.md
  - docs/standards/BUILD-STATUS.md
  - ap3/features/session-management/PLAN.md
---

## Rubric

Re-score of the 2026-09-11 round (`base_sha bf7933b`, `status: READY_WITH_SUPERVISED_SLICES`, full
history preserved in this file's git history — 9 owner-resolved questions from that round). Since then
Milestone 3 (guest notes: schema + commands) fully landed — `0044_session_guest_notes.sql` (PR #12) and
the `CreateGuestNote`/`DeleteGuestNote` commands + routes (PR #13), per
`ap3/features/session-management/PLAN.md`. §2 Migration & Rollback was properly reconciled to the
landed schema (BE spec v2.28) — but §3 API Contract / §4 Algorithm / §5 Testing Plan were **not**
reconciled to the landed *commands*, and that gap is real, verified directly against the merged code
(not inferred from prose).

`git diff bf7933b..HEAD` for the FE/BE spec pair touches exactly 3 lines total (1 in FE, 2 in BE, both
about the SES-OQ-10 timezone correction + the migration-landed bullet) — every other section is
byte-identical to the 09-11 round, so those verdicts carry forward unchanged. Only `R3.2`-`R3.4`,
`R5.1`, and `R6.1`'s citation are re-derived against current code this round.

| id | gate | verdict | decided by | note |
|----|------|---------|------------|------|
| R1.1 | hard | PASS | `docs/features/FE/feature_session_management.md:3` + `docs/product/ROADMAP.md:635,166,170-173` (unchanged) | Carried forward from 2026-09-11 round — source untouched. |
| R1.2 | hard | PASS | `docs/features/FE/feature_session_management.md:28,9` (unchanged) | Carried forward. |
| R1.3 | hard | PASS | `docs/features/FE/feature_session_management.md:6` | `> **Status:** Reviewed` — unchanged. |
| R2.1 | hard | PASS | `docs/features/FE/feature_session_management.md:806-851` §6 (unchanged) | Carried forward. **Caveat (see Q2):** 3 lines (§UC-17 `:77`, edge #38 `:117`, AC checklist `:885`) claim guest-note deletion "trigger waitlist auto-promote" — sentence form itself satisfies R2.1, but the claim is stale against shipped code (see R3.4). |
| R2.2 | hard | PASS | `docs/features/FE/feature_session_management.md:7` (unchanged) | Named RED criterion (InviteFriend → `ALREADY_JOINED`) still fails at current base — re-verified this round: no `inviteFriend`/`approveInvite`/`rejectInvite` export exists anywhere in `packages/db/src/session-service.ts`. `InviteFriend` remains fully unbuilt (PLAN.md D1: blocked on `person_follows`/`person_blocks`/`players.status='pending'`, none of which exist in `schema.ts`). Carried forward. |
| R2.3 | hard | PASS | `docs/features/FE/feature_session_management.md:39-46` + `docs/features/BE/feature_session_management_tech.md:47-52` (unchanged) | Carried forward. Edge #38 (FE `:117`) exists as required; same staleness caveat as R2.1 in its outcome column. |
| R3.1 | hard | PASS | `docs/features/BE/feature_session_management_tech.md` §1-§6 vs `docs/templates/be-tech-spec-template.md` (unchanged) | Carried forward. |
| R3.2 | hard | PASS | `docs/features/BE/feature_session_management_tech.md:214` (✅ Landed bullet, v2.28) + live grep this round: `packages/db/schema.ts:624` (`allowPlayerInvite`), `:701,719-720` (`invitedByPersonId` + partial index), `:747,756,770` (`sessionGuestNotes` table + index + FK) + `packages/db/migrations/0044_session_guest_notes.sql` (file present) | **Stronger than last round** — the 3 objects flagged "pending" in the 09-11 round are now verified live in both `schema.ts` and the merged migration, checked against the actual columns this round (not just the doc's own claim of landing). |
| R3.3 | hard | **GAP** | `docs/features/BE/feature_session_management_tech.md:546-552` (POST example), `:559` (DELETE example), `:46-48,294-296,562-575` (GET entry point/row/example) vs `apps/web/app/api/sessions/[id]/guest-notes/route.ts:81-87` + its `route.test.ts:90-92` ("pinned DTO"), `apps/web/app/api/sessions/[id]/guest-notes/[noteId]/route.ts:81-83` + its `route.test.ts:85` ("pinned DTO"), and `route.ts:12-15`'s own docstring | **New finding this round.** §2 was reconciled when the schema landed (v2.28); §3 was never reconciled when the commands landed (PR #13). Three concrete, code-and-test-verified mismatches: **(a)** POST success example shows `guestNote:{id,guestName,note,createdAt}` + a sibling `remainingNotes`; the actual shipped/tested response is `guestNote:{id,sessionId,remainingNotes}` — `guestName`/`note`/`createdAt` are never echoed (deliberate: DD-117 D5 — a replay cannot reproduce request content, and one command must have one response shape). **(b)** DELETE success example shows `{deleted:true,slotsFreed:1}`; the actual shipped/tested response is `{guestNote:{id,sessionId,deleted:true}}` — no `slotsFreed` field exists anywhere in the code. **(c)** `GET /api/sessions/:id/guest-notes` is fully documented (entry point, endpoint table row, full response example) as if available now; the route file's own comment states it was deliberately dropped from M3b, blocked on Milestone 2's not-yet-built body-less auth-context resolver (`ap3/features/session-management/PLAN.md` Milestone 2 / Deferred D5) — the BE spec carries zero indication this endpoint is deferred or has a prerequisite. |
| R3.4 | hard | PASS | `docs/features/BE/feature_session_management_tech.md:739` (§4 step 4) vs `packages/db/src/session-service.ts:2818-2825` (`deleteGuestNote` docstring) | **Caveat, not GAP** — R3.4's own text asks only that the transition be *described*, which it is. §4 DeleteGuestNote step 4 still reads "waitlist candidates → trigger waitlist auto-promote" as real behavior. The shipped code's own inline comment: *"WAITLIST PROMOTION IS DELIBERATELY ABSENT... there is no candidate to promote and no promotion function to call... It lands with the waitlist engine"* (D2, still fully blocked per PLAN.md). Same root cause as R3.3 — see Q2. |
| R4.1 | hard | PASS | `docs/standards/decisions.md` (unchanged DD set cited by FE/BE + new v2.50 entry, all governing DDs still ✅) | Carried forward; v2.50's SES-OQ-10 correction doesn't reopen any DD status. |
| R4.2 | hard | PASS | `docs/features/FE/feature_session_management.md:902` (SES-OQ-10, corrected wording, still ✅) | Carried forward — the whitelist→`RangeError`-constructibility correction stays resolved, doesn't reopen the question. |
| R5.1 | hard | PASS | `docs/features/BE/feature_session_management_tech.md:924-927` (rows #78/#79/#80/#81) vs `packages/db/src/session-service.test.ts:3831` (GN1, #78), `:4006` (GN6, #79), `:4249` (GN18, #81), `:4311` (GN22) | Rows #78/#79/#81 verified accurate against real, passing tests. **Caveat, not GAP:** row #80's outcome column ("first eligible candidate promoted") contradicts the deliberately-shipped no-op — the actual regression test (GN22, line 4311, "deleting frees a slot — a session at capacity accepts a new note afterwards") covers only the buildable half of row #80 (slot freed), never candidate promotion. Same root cause as R3.4. |
| R5.2 | hard | PASS | `docs/features/BE/feature_session_management_tech.md` "### Verify" subsection (unchanged) | Carried forward — verify commands (`pnpm --filter @plexco/db run typecheck`, `verify_host` vitest invocation) unaffected by this landing; guest-note tests live in the same `session-service.test.ts` file the command already names. |
| R6.1 | supervised | GAP (by design) | `ap3/features/session-management/PLAN.md` D1 (`person_follows`, `person_blocks`, `players.status='pending'` all confirmed absent from `schema.ts`/migrations) and D4 (`idx_sessions_draft_starts_at` partial index, not yet migrated) | Condition still triggers — **citation updated from last round**: the specific pending-schema item scored here on 09-11 (guest-notes: `allow_player_invite`/`invited_by_person_id`/`session_guest_notes`) is now landed (`0044`). These are the feature's next concrete schema gaps. Expected, non-blocking. |
| R7.1 | supervised | GAP (by design) | `docs/features/FE/feature_session_management.md:194,231,238,290,419-420,696` (unchanged) | Unchanged — feature remains copy-heavy across bot/web surfaces (HARD RULE 5). Expected, non-blocking. |
| R8.1 | supervised | GAP (by design) | `docs/features/FE/feature_session_management.md` §3 (unchanged since the 09-11 restructure) | Unchanged — feature still owns `apps/web/app/**` screens. Expected, non-blocking. |

## Status

`NOT_READY` — one hard-gate GAP (`R3.3`), computed via `python3 ap3/aplib.py intake-score
docs/standards/feature-readiness.md <evidence.json>` (fail-closed: any hard-tier GAP wins over any
number of supervised-tier GAPs, regardless of R6-R8 — confirmed by reading `ap3/aplib.py`'s
`intake_score()` directly, not hand-derived). Both questions below are documentation-reconciliation
only — no code change, no new product decision, no schema/migration — but per this skill's fail-closed
rule the fix must go through the owner's explicit approval before it is applied.

## Questions

1. **(R3.3, blocking) Reconcile BE §1/§3 to the actual PR #13 response shapes, and mark GET as
   deferred.**
   (a) Update the POST `/guest-notes` success example (BE spec `:546-552`) to
   `{"guestNote":{"id":"…","sessionId":"…","remainingNotes":2},"error":null}` — drop `guestName`,
   `note`, `createdAt` from the example (the shipped DTO deliberately never echoes them, matching
   every other command's DD-117 D5 replay contract).
   (b) Update the DELETE `/guest-notes/:noteId` success example (BE spec `:559`) to
   `{"guestNote":{"id":"…","sessionId":"…","deleted":true},"error":null}` — drop `slotsFreed` (no
   such field exists anywhere in the shipped code).
   (c) Annotate `GET /api/sessions/:id/guest-notes` (BE spec `:48,296,562-575`) as **deferred,
   blocked on Milestone 2** (the body-less auth-context resolver, itself supervised) — either move
   the example into a "not yet built" callout or strike it until M2 lands, mirroring how §2's
   migration bullet was updated in v2.28 once its own blocker cleared.
   Proposed answer: yes to all three, worded to mirror the v2.28 precedent (state what's landed vs.
   deferred and why; cite PR #13 / `PLAN.md` Milestone 2).

2. **(R3.4/R5.1/R2.1/R2.3, non-blocking, same root cause as Q1) Fix the "trigger waitlist
   auto-promote" wording in 5 places to say what's actually shipped.**
   `docs/features/FE/feature_session_management.md:77` (UC-17), `:117` (edge #38), `:885` (AC
   checklist), `docs/features/BE/feature_session_management_tech.md:739` (§4 step 4), and `:926` (§5
   row #80) all describe real candidate promotion on guest-note delete. The shipped
   `deleteGuestNote` (`packages/db/src/session-service.ts:2818-2825`) deliberately no-ops this —
   occupancy is recomputed and published on the event, but no candidate is promoted, because no
   join/leave/waitlist-entry code exists anywhere yet (D2, fully blocked per PLAN.md). Should all 5
   locations be reworded to say occupancy-recompute-and-publish happens now, and actual promotion is
   deferred until the waitlist/promotion engine (D2) lands — matching the shipped code's own inline
   rationale?
   Proposed answer: yes — same "state landed vs. deferred, cite the blocking decision" pattern as
   Q1c.

## Decisions to finalize

None. Both questions above are documentation-reconciliation only (make the spec match already-shipped,
already-reviewed code) — no new product/technical decision, no `decisions.md` entry needed beyond
what applying Q1/Q2 touches directly in the FE/BE specs themselves.

## Answers
<!-- the owner edits below this line, or dictates answers in chat and Claude writes them here
     verbatim before the --apply round reads them -->
