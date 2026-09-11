---
feature: session-management
readiness_version: null
status: NOT_READY
measured_at: 2026-09-11T09:13:36Z
base_sha: 6bfa905c7ae2b7e63d756d76b8dda90706d51f3d
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
---

## Rubric

| id | gate | verdict | decided by | note |
|----|------|---------|------------|------|
| R1.1 | hard | PASS | `docs/features/FE/feature_session_management.md:3` + `docs/product/ROADMAP.md:635,166,170-173` | Header states "Canonical phase: P2 (chat CRUD) · P4 (web parity)"; corroborated by ROADMAP row #8 (P4) and DD-113/DD-114 launch-scope entries. No single unified ROADMAP row — phase is reconstructable from 7 scattered mentions, none contradicting the header's P2/P4 claim. |
| R1.2 | hard | **GAP** | `docs/product/PRD.md:108` (FLOW 2), `:252` (FLOW 13), `:16` (changelog v2.8q) | FLOW 2 clean, no scope marker. FLOW 13 (cited by FE header) depends on marketplace/public listing that PRD's own changelog says is "epic-gated" — won't exist functionally in phase-1 ("public" = toggle+fence only, not a findable listing). |
| R1.3 | hard | PASS | `docs/features/FE/feature_session_management.md:6` | `> **Status:** Reviewed` — plain, unambiguous. |
| R2.1 | hard | PASS | `docs/features/FE/feature_session_management.md:806-851` (§6 Acceptance Criteria) | Section exists, matches template name exactly, 44 bullets, 0 hits repo-wide for banned words ("hợp lý"/"phù hợp"/"tốt"). Most bullets are condition→observable-behavior. (Structural note, not scored: template expects 5 `###` sub-headings incl. NFR compliance; this doc has none — out of this rubric's scope but worth owner awareness.) |
| R2.2 | hard | PASS | `docs/features/FE/feature_session_management.md:840` vs live `packages/db/src/session-service.ts` | Named criterion "Invite friend đã có trong session → reject `ALREADY_JOINED`" fails today — `InviteFriend` command does not exist in code (0 grep hits) and its schema (`invited_by_person_id`) isn't migrated. Real RED confirmed. |
| R2.3 | hard | **GAP** | `docs/features/FE/feature_session_management.md:66,71,78` vs §2 Edge Cases table | SES-UC-5 (CloseSession) and SES-UC-10 (system auto-close) have no dedicated edge case in FE §2 **or** BE §2. SES-UC-18 (approve/reject pending) has none in FE §2 (BE §2 does cover it via edges #44/#45). |
| R3.1 | hard | PASS | `docs/features/BE/feature_session_management_tech.md` §1-§6 vs `docs/templates/be-tech-spec-template.md` | All 6 canonical sections present, names match template verbatim; `### Entry points` present at `:33`. |
| R3.2 | hard | **GAP** | `docs/features/BE/feature_session_management_tech.md:75,123,144-172,190-191,198` vs live `packages/db/schema.ts` + `packages/db/migrations/` (44 files, tail `0043`) | `session_guest_notes` table, `sessions.allow_player_invite`, `players.invited_by_person_id` (+ its index) are fully specified in §2 SQL but absent from live schema and every merged migration, **and** absent from §2's own "Migration & Rollback" pending list (which is dated to a pre-v2.21 grep note and only tracks DD-45a/retry-objects/draft-index). |
| R3.3 | hard | **GAP** | `docs/features/BE/feature_session_management_tech.md:261-270` (Endpoints table) vs `:307-486` (examples) | 4 of 8 listed endpoints (announce, close, `GET` list, `GET` detail) have zero request/response examples; `PUT` has error-only examples. 6 endpoints that DO have examples (invite/guest-note/approve/reject family) are missing from the §3 Endpoints table itself (only listed in §1 Entry points). |
| R3.4 | hard | **GAP** | `docs/features/BE/feature_session_management_tech.md` §4 vs `docs/autopilot-invariant-catalog.md:53-59` | Catalog names 6 mechanisms as owned by this doc; only `session-lock-ordering` (BE:240,578) is used verbatim. `publish-suspend-gate`, `session-command`, `billing-authz`, `retry-liveness`, `member-safety` are each described in prose under different names, never the catalog token. |
| R4.1 | hard | PASS | `docs/standards/decisions.md` (27 unique DD numbers cited, all ✅) | Every DD cited by FE/BE (directly or via `DD-NN..MM` ranges) is `✅ Chốt`/`✅ owner-final`/`✅ Accept in-principle` in decisions.md — none 🟡/⬜. DD-61-64 are pointer-only citations to the sibling `feature_session_organize`, not this feature's own scope. DD-45a is "Engineering chốt" but carries an explicit `(owner 2026-07-28)` date. |
| R4.2 | hard | **GAP** | `docs/features/FE/feature_session_management.md:862` (SES-OQ-2) + `docs/issues/session-management-acceptance-checklist.md:614-624` (§9-A) | SES-OQ-2 (recurrence edit granularity) is `⬜ Chưa chốt` and overlaps in-scope SES-UC-2. Checklist §9-A also flags a timezone-validation gap not tracked in FE's own Open Questions table at all, yet every session create/edit touches the required `timezone` field. |
| R5.1 | hard | PASS | `docs/features/BE/feature_session_management_tech.md:723-844` (§5 Testing Plan, 84 unit + 8 integration rows incl. `#70-84`) | §5 itself has rows covering the newer invite/guest-note/DD-112 behavior — satisfies the rubric's first clause directly. (Separate hygiene note: the acceptance checklist is pinned to BE v2.18a vs current v2.26 and doesn't trace `U#70-84`/DD-112 — not gating this item since BE §5 already has the rows, but reduces confidence in the checklist as a cross-check.) |
| R5.2 | hard | **GAP** | `docs/features/BE/feature_session_management_tech.md` (full-file grep) | Zero occurrences anywhere in the 908-line doc of `vitest`/`pnpm test`/`typecheck`/`verify_host`/`next build`/etc. No verify command stated at all. |
| R6.1 | supervised | **GAP** | same evidence as R3.2 | Condition triggers: new schema needed (both the already-tracked DD-45a/retry-objects/draft-index items and the untracked guest-note/invite schema). Per rubric: migration must be its own supervised slice, merged before code slices. |
| R7.1 | supervised | **GAP** | `docs/features/FE/feature_session_management.md:194,231,238,290,419-420,696` | Condition triggers: feature is copy-heavy across bot (error messages, wizard prompts) and web (labels, empty states, toasts). Any slice touching this copy needs the supervised tag (HARD RULE 5). |
| R8.1 | supervised | **GAP** | `docs/features/FE/feature_session_management.md` §3 (lines 121-717) | Condition triggers: feature owns 5+ `apps/web/app/**` screens. Follow-on requirement mostly met (11 screens with 4-state tables) but 3 structural gaps found — see Q9. |

## Questions

1. (R1.2) FLOW 13 (`docs/product/PRD.md` §FLOW 13, P4.3, cross-club join via marketplace) is cited in the FE spec header, but the PRD's own changelog (`:16`, v2.8q) says the marketplace listing/discovery mechanism this flow depends on is "epic-gated" and won't exist in phase-1 — only a toggle + immediate-deny fence, no actual findable listing. Is FLOW 13 / public marketplace discovery actually required for session_management's phase-1 (P2)/P4 slices (e.g. SES-UC-8 public join), or should the public-join path be scoped to "toggle-only, no discovery" for now, deferring true marketplace join until FLOW 13's epic unlocks? Proposed answer: scope current slices to toggle-only; defer marketplace-discovery-dependent behavior and note it explicitly in FE §1 "Ngoài phạm vi".

2. (R2.2 — caveat on a PASS, not a GAP) FE spec's own `> **Implementation:**` line (`:7`) says "Not started... SessionService/routes/projector/auto-promote vẫn chưa build" — this is now factually wrong. `packages/db/src/session-service.ts` has 6 live commands (create/publish/announce/update/close/cancel) and 5 routes are merged as of current HEAD `6bfa905`. BE spec's own header (`:6`) already carries the accurate, current status. Should FE's Implementation line be updated to mirror BE's so a future writer doesn't assume nothing is built and risk duplicating or breaking existing SessionService code? Proposed answer: yes, update FE:7 to match BE:6's wording.

3. (R2.3) SES-UC-5 (CloseSession) and SES-UC-10 (system auto-close) have no dedicated edge case anywhere (FE or BE). SES-UC-18 (approve/reject pending) is uncovered in FE §2 specifically (BE covers it via edges #44/#45). Should edge cases be authored for the close and auto-close transitions before those commands are sliced, and should FE §2 gain a row mirroring BE's #44/#45 for approve/reject?

4. (R3.2 / R6.1) `session_guest_notes`, `sessions.allow_player_invite`, and `players.invited_by_person_id` (+ index) are fully specified in BE §2 but exist in neither live schema nor any merged migration, and are absent from §2's own Migration & Rollback pending list. Should that pending list be updated to include this schema, and should it become its own supervised migration slice merged before any invite/guest-note code slice?

5. (R3.3) 4 of 8 §3-listed endpoints (announce, close, `GET` list, `GET` detail) have no request/response examples, and `PUT` has error-only coverage. Separately, the invite/guest-note/approve/reject endpoints (which DO have examples) aren't listed in the §3 Endpoints table at all. Should §3 be reconciled to list all 14 actual endpoints, with an example (or explicit pointer) for each?

6. (R3.4) The invariant catalog names `publish-suspend-gate`, `session-command`, `billing-authz`, `retry-liveness`, `member-safety` as owned by this BE doc, but none of the 5 tokens appear verbatim in it — the doc uses different prose for the same mechanisms. Should the BE doc adopt the catalog's canonical names inline (at least as parentheticals), or should the catalog be updated to the doc's actual vocabulary?

7. (R4.2) Two unresolved items overlap current scope: (a) SES-OQ-2 (recurrence edit granularity, `⬜ Chưa chốt`) overlaps in-scope SES-UC-2; (b) checklist §9-A's timezone-validation gap (malformed-string rejection not concretely specified) isn't even tracked in FE's own Open Questions table, yet every session create/edit touches the required `timezone` field. Resolve both before slicing recurrence-editing or timezone-validation behavior?

8. (R5.2) No verify/test command is stated anywhere in the 908-line BE doc. What is the actual sandbox-runnable verify command for this package (e.g. `pnpm --filter @plexco/db test`, `pnpm --filter @plexco/db typecheck`?), and which parts (if any) need `next build` or a real DB and should be split to `verify_host`/CI?

9. (R8.1) FE §3 has 3 structural gaps: (a) "Bot — Session detail (`/status`)" has no inline 4-state table (only indirect coverage via the aggregate matrix); (b) "Bot — Publish draft / Discard draft" sub-tables show only Ready+Error, no explicit Loading/Empty rows (not even "N/A"); (c) 6 unheaded rows at FE:711-716 sit under the Approve/Reject heading using the aggregate-matrix's column shape, duplicating 2 screens' state info and introducing 2 screens ("Join/Leave action", "Publish/Discard control") with no inline per-screen table of their own. Should §3 be cleaned up before those specific screens are sliced?

## Decisions to finalize

- SES-OQ-2 (recurrence edit granularity — single occurrence vs this-and-future)
- Timezone input validation contract (checklist §9-A item 2 — not yet in FE's own Open Questions table)

## Answers
<!-- the owner edits below this line, or dictates answers in chat and Claude writes them here
     verbatim before the --apply round reads them -->
