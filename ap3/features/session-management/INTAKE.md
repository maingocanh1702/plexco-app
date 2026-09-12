---
feature: session-management
readiness_version: null
status: READY_WITH_SUPERVISED_SLICES
measured_at: 2026-09-12T14:46:51Z
base_sha: 3fda34d97b1a10e7743f19318d9eb56288eaa037
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

Apply round for the 2026-09-12 NOT_READY score (full history in this file's git history). Owner
answered Q1/Q2 yes; both applied verbatim in commit `3fda34d` (FE v2.26→v2.27, BE v2.28→v2.29,
docs-only). Re-scoring the 5 items that changed; everything else carries forward unchanged from the
NOT_READY round's table.

| id | gate | verdict | decided by | note |
|----|------|---------|------------|------|
| R1.1 | hard | PASS | `docs/features/FE/feature_session_management.md:3` + `docs/product/ROADMAP.md:635,166,170-173` (unchanged) | Carried forward. |
| R1.2 | hard | PASS | `docs/features/FE/feature_session_management.md:28,9` (unchanged) | Carried forward. |
| R1.3 | hard | PASS | `docs/features/FE/feature_session_management.md:6` | `> **Status:** Reviewed` — unchanged. |
| R2.1 | hard | PASS | `docs/features/FE/feature_session_management.md:806-851` §6 (unchanged) | Carried forward. **Caveat RESOLVED (Q2, commit `3fda34d`):** the 3 stale "trigger waitlist auto-promote" lines (§UC-17 `:77`, edge #38 `:117`, AC checklist `:885`) now read "occupancy recompute; KHÔNG promote waitlist thật" with the D2 citation. |
| R2.2 | hard | PASS | `docs/features/FE/feature_session_management.md:7` (unchanged) | Named RED criterion (InviteFriend → `ALREADY_JOINED`) still fails at current base — `InviteFriend` remains fully unbuilt (D1). Carried forward. |
| R2.3 | hard | PASS | `docs/features/FE/feature_session_management.md:39-46` + `docs/features/BE/feature_session_management_tech.md:47-52` (unchanged) | Carried forward. Same Q2 resolution as R2.1 — edge #38's outcome column no longer contradicts shipped code. |
| R3.1 | hard | PASS | `docs/features/BE/feature_session_management_tech.md` §1-§6 vs `docs/templates/be-tech-spec-template.md` (unchanged) | Carried forward. |
| R3.2 | hard | PASS | `docs/features/BE/feature_session_management_tech.md:214` (✅ Landed bullet, v2.28) + `packages/db/schema.ts:624,701,719-720,747,756,770` + `packages/db/migrations/0044_session_guest_notes.sql` | Carried forward — unaffected by this round's edits (schema section was already reconciled). |
| R3.3 | hard | **PASS (was GAP)** | `docs/features/BE/feature_session_management_tech.md:551-561` (POST/DELETE examples, rewritten), `:48,302,570` (GET annotated CHƯA BUILD), `:332` (new `INVALID_INPUT` Error Codes row), commit `3fda34d` | **Fixed (Q1a/b/c).** POST/DELETE success examples now match the actual shipped/tested DTOs verbatim (`guestNote:{id,sessionId,remainingNotes}` / `guestNote:{id,sessionId,deleted:true}`, no `slotsFreed`); POST error-case list + the canonical Error Codes table both gained `INVALID_INPUT` (owner's item C, verified against `packages/db/src/session-service.ts:2690-2709` + commit `c1e8bcf` before applying); `GET /guest-notes` now annotated **CHƯA BUILD — chờ Milestone 2** everywhere it appears (header Implementation line, §1 entry points, §3 endpoint table, its own example block). |
| R3.4 | hard | PASS | `docs/features/BE/feature_session_management_tech.md:747` (§4 step 4, reworded) | **Caveat RESOLVED (Q2, commit `3fda34d`):** step 4 now says occupancy is recomputed and published, and explicitly states promotion itself is deferred to the waitlist/promotion engine (D2), citing the shipped code's own inline rationale (`session-service.ts:2818-2825`). |
| R4.1 | hard | PASS | `docs/standards/decisions.md` (unchanged DD set, all governing DDs still ✅) | Carried forward. |
| R4.2 | hard | PASS | `docs/features/FE/feature_session_management.md:902` (SES-OQ-10, unchanged this round) | Carried forward. |
| R5.1 | hard | PASS | `docs/features/BE/feature_session_management_tech.md:934` (row #80, reworded) | **Caveat RESOLVED (Q2, commit `3fda34d`):** row #80 no longer claims candidate promotion; outcome column now states occupancy recompute + event only, explicitly citing that GN22 (the real test) covers only the buildable half. |
| R5.2 | hard | PASS | `docs/features/BE/feature_session_management_tech.md` "### Verify" subsection (unchanged) | Carried forward. |
| R6.1 | supervised | GAP (by design) | `ap3/features/session-management/PLAN.md` D1 (`person_follows`/`person_blocks`/`players.status='pending'` absent) and D4 (`idx_sessions_draft_starts_at`, not yet migrated) | Unchanged from the NOT_READY round — the feature's next concrete schema gaps are still open. D1 and D4 are now also tracked below under **Decisions to finalize** (owner request, item A) — that's forward-planning context, not a rubric re-score; this row's verdict is unaffected. Expected, non-blocking. |
| R7.1 | supervised | GAP (by design) | `docs/features/FE/feature_session_management.md:194,231,238,290,419-420,696` (unchanged) | Unchanged. Expected, non-blocking. |
| R8.1 | supervised | GAP (by design) | `docs/features/FE/feature_session_management.md` §3 (unchanged) | Unchanged. Expected, non-blocking. |

## Status

`READY_WITH_SUPERVISED_SLICES` — zero hard-gate GAPs (R3.3 fixed), computed via `python3
ap3/aplib.py intake-score docs/standards/feature-readiness.md <evidence.json>`. Supervised gaps
R6.1/R7.1/R8.1 remain by design (any slice touching schema/copy/web-pages is still tagged
supervised) — this is the expected non-blocking end state per `feature-readiness.md`'s own
fail-closed rule.

## Questions — RESOLVED 2026-09-12

Both questions were answered `yes` by the owner in one round and applied verbatim to the FE/BE specs
in commit `3fda34d` (branch `docs/intake-session-management`). Kept as the historical record of what
was asked and why; see the Rubric table above for the resulting verdict per item.

1. **(R3.3, blocking)** Reconcile BE §1/§3 to the actual PR #13 response shapes (POST/DELETE
   examples), and mark `GET /guest-notes` as deferred, blocked on Milestone 2.
   **Owner answer:** yes to all three — owner independently verified the same three mismatches
   against shipped code before answering (POST returns `guestNote{id,sessionId,remainingNotes}`;
   DELETE returns `guestNote{id,sessionId,deleted:true}`; `slotsFreed` has zero occurrences
   repo-wide; no `GET` handler exported under the guest-notes route tree). Applied in Vietnamese,
   mirroring the v2.28 "what landed vs. what is deferred, and why" pattern, citing PR #13 +
   `PLAN.md` Milestone 2 for the GET deferral.

2. **(R3.4/R5.1/R2.1/R2.3, non-blocking, same root cause as Q1)** Fix the "trigger waitlist
   auto-promote" wording in the 5 places that describe real candidate promotion on guest-note
   delete, to say what `deleteGuestNote` actually does (occupancy recompute + publish; promotion
   deferred to D2).
   **Owner answer:** yes, reword all 5 places the same way, citing `PLAN.md` D2 and the inline
   rationale in `deleteGuestNote`.
   **Addition beyond the literal 5 (flagged, not separately asked):** while applying this fix, a 6th
   location with the identical pattern was found and fixed the same way — BE §2 edge #43
   (`docs/features/BE/feature_session_management_tech.md:272`, "Delete guest note khi đang có
   waitlist"), which the original score round's citation (`FE:47-52`) had not enumerated
   individually. Same root cause, same fix, same commit — flagged here so the owner can review or
   revert it independently of Q1/Q2 proper.

## Decisions to finalize

Three items the owner asked to record this round. **None of these gate this round's `READY_WITH_
SUPERVISED_SLICES` status** — they are forward-looking, non-blocking, and do not overlap any slice
already shipped or in flight. Carried into the next `/ap3-plan` round as open context.

- **D4 — Auto-close grace period (SES-UC-10, BE edge #50, row #89).** Still `chưa chốt`
  (`docs/features/BE/feature_session_management_tech.md:279`, unchanged this round) — this is what
  blocks Milestone 4 (`PLAN.md` D4) from being scoped at all. **Owner's recommendation (not yet a
  decision — his own words, for himself to confirm or reject on review):** no grace period —
  `ends_at` itself is the cutoff, because closing only stops new joins and removes the public
  projection; nothing about a late-running session needs the session to stay open past `ends_at`.
  Recorded verbatim as a recommendation, not applied to any spec — `feature-readiness.md`'s own
  language rule (R4.1) requires an actual `decisions.md` entry with owner sign-off before a decision
  is `DECISION_FINAL`, and this skill's rule forbids marking anything final without that explicit
  step.

- **D8 — Does `CreateGuestNote`/`DeleteGuestNote` need a Suspended Action Matrix (DD-110) row?**
  Verified this round: `ActionClass` (`packages/db/src/authorization.ts:49-56`) pins exactly 7
  literals (`publish_new_sessions`, `admin_mutation`, `integration_changes`, `announce_session`,
  `update_open_session`, `close_session`, `cancel_session`) — none guest-note-related — and neither
  shipped guest-note command calls `authorizeTenantAction` anywhere (confirmed: zero matches in
  `createGuestNote`/`deleteGuestNote`'s line range). **Cost of "yes"** (not recommended either way,
  per owner's ask — just the cost, for the owner to weigh): a new BE §3/§4 spec row describing the
  gate, an `authorization.ts` change adding an 8th `ActionClass` literal + its Suspended Action
  Matrix row, and its own slice to wire + test it (guest-note creation/deletion while
  billing-suspended is currently **unguarded** — neither blocked nor explicitly decided as
  exempt).

- **D1 — SES-UC-16/18 (InviteFriend/ApproveInvite/RejectInvite) phase placement.** Confirmed
  blocked on 3 prerequisites, none of which exist on `main`: `person_follows` (DD-47, ✅ Chốt
  framework 2026-07-13, scheduled **P4+**), `person_blocks` (DD-55, ✅ Chốt policy 2026-07-16,
  scoped **P4 chat slice**), and `players.status='pending'` (constraint still exactly
  `('active','left','waitlisted')` per `0014_players_waitlist.sql:79-80` — the doc-comment claiming
  otherwise was the factual error fixed in this same round's commit `3fda34d`, see R3.2's history).
  **Open choice for the owner** (not decided here): (a) move SES-UC-16/18 to whichever phase
  DD-47/DD-55 actually land in (and annotate the feature header the same way SES-UC-8's
  marketplace-discovery dependency is already annotated, per the 2026-09-11 round's answer 1), or
  (b) fast-track `person_follows`/`person_blocks`/`pending` as their own supervised prerequisite
  slice ahead of schedule. No recommendation given (owner didn't ask for one on this item).

## Goal for the next plan round

Per owner instruction, for `/ap3-plan` to inherit verbatim: **the objective is not the largest
remaining increment.** It is the smallest genuinely-`P2` slice a headless writer can take from RED to
a merged PR with zero human edit. This class (`feature-session-p2`) has been dispatched four times
(M1 twice-ish across the timezone slice's BUDGET halt, M3b three times before its supervised finish)
and has never once reached READY fully unattended.

Preference order for the next slice: (1) touches exactly one package, (2) requires no new schema
migration, (3) makes no auth-surface change (i.e. does not touch `session-command-route.ts` or any
other choke-point), (4) if possible, needs no real-database dependency at verify time (sandbox
typecheck + mocked-DB route tests only, no `verify_host`).

If no such DB-free, schema-free, auth-free slice exists anywhere in this feature's remaining scope,
`/ap3-plan` must say so explicitly and name the smallest DB-dependent slice instead, including its
exact `verify`/`verify_host` commands (see BE spec `### Verify` subsection for the canonical forms).
Do not silently default to planning the largest or most valuable remaining milestone (M2, M4, or the
D1/D3 families) just because it is next in `PLAN.md`'s list order — re-evaluate against this
preference order first.

## Answers
<!-- the owner edits below this line, or dictates answers in chat and Claude writes them here
     verbatim before the --apply round reads them -->

Both questions: YES — I verified all three Q1 mismatches against the shipped code myself (POST
returns guestNote{id,sessionId,remainingNotes}; DELETE returns guestNote{id,sessionId,deleted:true};
slotsFreed has zero occurrences repo-wide; no GET is exported under
apps/web/app/api/sessions/[id]/guest-notes/). Apply them exactly as proposed, in Vietnamese,
mirroring the v2.28 "what landed vs what is deferred, and why" pattern, and cite PR #13 + PLAN.md
Milestone 2 for the GET deferral. Q2: yes, reword all 5 places the same way, citing PLAN.md D2 and
the inline rationale in deleteGuestNote.

Three additions to write into INTAKE.md in the same round — they were missing because I gave you this
context too late, not because they are closed:

A. Record these as OPEN owner decisions under "Decisions to finalize" (they do NOT gate this round's
   status; none of them blocks a P2 slice):
   - D4 auto-close grace period after ends_at (SES-UC-10). Still "chưa chốt" in BE. Blocks M4 from
     being scoped at all. My recommendation to the owner, for him to confirm or reject: no grace —
     ends_at itself is the cutoff, because closing only stops new joins and removes the public
     projection; nothing about a late-running session needs the session to stay open. State it as a
     recommendation, not a decision.
   - D8 whether CreateGuestNote/DeleteGuestNote need a row in the Suspended Action Matrix (DD-110).
     ActionClass pins seven literals, none guest-note, and the shipped commands call no
     authorizeTenantAction. Record what a "yes" costs: a spec row + an authorization.ts change + its
     own slice.
   - D1 SES-UC-16/18 (InviteFriend/Approve/Reject): blocked on person_follows (DD-47, P4+),
     person_blocks (DD-55, P4 chat slice), and 'pending' absent from the live players_status_chk. The
     owner must choose between moving SES-UC-16/18 to whatever phase DD-47/DD-55 land in, or
     fast-tracking those three prerequisites as their own supervised slice. Also note that BE §2's
     doc comment claiming 'pending' was already added to the enum is still inaccurate against
     0014_players_waitlist.sql — fix that comment in this same round, it is a factual error about
     live schema.

B. Add a short "Goal for the next plan round" section to INTAKE.md so /ap3-plan inherits it verbatim:
   the objective is NOT the largest remaining increment. It is the SMALLEST genuinely-P2 slice a
   headless writer can take from RED to a merged PR with no human edit — this class has been
   dispatched four times and has never once reached READY unattended. Prefer a slice in one package,
   no new schema, no auth-surface change, and if possible no real-database dependency. If no such
   DB-free slice exists in this feature, say so explicitly and name the smallest DB-dependent one
   instead, with its verify/verify_host commands.

C. While you are in the docs anyway: BE §3's error-case list for POST /guest-notes omits
   INVALID_INPUT, which the shipped code returns for NUL/lone-surrogate text (commit c1e8bcf). Add it
   if my reading is right; if the code says otherwise, say so and leave it alone.

Then run /ap3-intake session-management --apply, open the docs PR, and STOP. Report the PR number and
the re-scored status. Do not merge.
