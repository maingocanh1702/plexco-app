---
feature: session-management
readiness_version: null
status: READY_WITH_SUPERVISED_SLICES
measured_at: 2026-09-11T09:42:12Z
base_sha: bf7933be34be6a3f009d5730aeb968c4941e0338
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

All 7 hard-gate GAPs from the `6bfa905c` score round are resolved by owner answers 1-9 (§ Answers
below), applied in commit `bf7933b`. `R6.1`/`R7.1`/`R8.1` stay GAP **by design** — the rubric routes
a genuinely-triggered supervised condition to GAP regardless of documentation completeness; per
`feature-readiness.md`'s own fail-closed rule, all-PASS on R1-R5 with only R6-R8 GAP is
`READY_WITH_SUPERVISED_SLICES`, not `NOT_READY`.

| id | gate | verdict | decided by | note |
|----|------|---------|------------|------|
| R1.1 | hard | PASS | `docs/features/FE/feature_session_management.md:3` + `docs/product/ROADMAP.md:635,166,170-173` | Header states "Canonical phase: P2 (chat CRUD) · P4 (web parity)"; corroborated by ROADMAP row #8 (P4) and DD-113/DD-114 launch-scope entries. No single unified ROADMAP row — phase is reconstructable from 7 scattered mentions, none contradicting the header's P2/P4 claim. |
| R1.2 | hard | PASS | `docs/features/FE/feature_session_management.md:28` (new "Marketplace discovery / FLOW 13" §1 paragraph) + header FLOW annotation (`:9`) | **Fixed (answer 1):** SES-UC-8 explicitly scoped to toggle+fence only; FLOW 13's marketplace-discovery dependency named as deferred to the "public read model" epic (4 prerequisites: DD-73/DD-41/occupancy-helper/DD-46, DD-114 D3) with an explicit AWAIT condition. FLOW 2 was already clean. |
| R1.3 | hard | PASS | `docs/features/FE/feature_session_management.md:6` | `> **Status:** Reviewed` — plain, unambiguous. |
| R2.1 | hard | PASS | `docs/features/FE/feature_session_management.md:806-851` (§6 Acceptance Criteria) | Section exists, matches template name exactly, 44 bullets, 0 hits repo-wide for banned words ("hợp lý"/"phù hợp"/"tốt"). Most bullets are condition→observable-behavior. (Structural note, not scored: template expects 5 `###` sub-headings incl. NFR compliance; this doc has none — out of this rubric's scope but worth owner awareness.) |
| R2.2 | hard | PASS | `docs/features/FE/feature_session_management.md:7` (Implementation line, rewritten — answer 2) | Named criterion "Invite friend đã có trong session → reject `ALREADY_JOINED`" still fails today (real RED confirmed — `InviteFriend` command/schema still unbuilt). **Caveat resolved:** FE:7 no longer falsely claims "Not started"; now mirrors BE:6's accurate status, re-verified 2026-09-11 at `6bfa905`. |
| R2.3 | hard | PASS | `docs/features/FE/feature_session_management.md:39-46` (new edges) + `docs/features/BE/feature_session_management_tech.md:47-52` (new edges) | **Fixed (answer 3):** SES-UC-5 (close), SES-UC-10 (auto-close, marked OWNER-CHECK/chưa build), and SES-UC-18 (approve/reject, FE now mirrors BE #44/#45) all have dedicated edge cases in both docs. Close edges derived from live `closeSession`/`cancelSession` code (verified via research fork, not invented). |
| R3.1 | hard | PASS | `docs/features/BE/feature_session_management_tech.md` §1-§6 vs `docs/templates/be-tech-spec-template.md` | All 6 canonical sections present, names match template verbatim; `### Entry points` present at `:33`. |
| R3.2 | hard | PASS | `docs/features/BE/feature_session_management_tech.md:198-199` (new Migration & Rollback bullet — answer 4) | **Fixed:** `session_guest_notes`/`allow_player_invite`/`invited_by_person_id`(+index) now explicitly tracked as pending, routed to its own supervised migration slice (R6.1) per the rubric's own routing rule ("task cần migration mới ⇒ GAP R6"). Migration tail re-verified live (`0024`→`0043`, none of the 19 new migrations touch this schema). |
| R3.3 | hard | PASS | `docs/features/BE/feature_session_management_tech.md` §3 Endpoints table (14 rows, verified) + new examples (`PUT` success, announce, close, `GET` list, `GET` detail) | **Fixed (answer 5):** table reconciled to all 14 real endpoints; every previously-missing request/response example added. |
| R3.4 | hard | PASS | `docs/features/BE/feature_session_management_tech.md` §4 (5 new inline parentheticals, verified via grep) | **Fixed (answer 6):** `publish-suspend-gate`, `session-command`, `billing-authz`, `retry-liveness`, `member-safety` all now appear inline as `catalog invariant \`token\`` parentheticals at the paragraph describing each mechanism; `session-lock-ordering` already matched. Catalog itself left unchanged (owner's explicit instruction — cross-doc authority). |
| R4.1 | hard | PASS | `docs/standards/decisions.md` (28 unique DD numbers cited, all ✅ — DD-121 added this round) | Every DD cited by FE/BE (directly or via `DD-NN..MM` ranges) is `✅ Chốt`/`✅ owner-final`/`✅ Accept in-principle` in decisions.md — none 🟡/⬜. DD-61-64 are pointer-only citations to the sibling `feature_session_organize`, not this feature's own scope. |
| R4.2 | hard | PASS | `docs/features/FE/feature_session_management.md:862-863` (SES-OQ-2 ✅ DD-121, SES-OQ-10 ✅ new) | **Fixed (answer 7):** SES-OQ-2 resolved via new `DD-121` (this-and-future only, single-occurrence deferred as a named follow-up, not blocking). New SES-OQ-10 resolves the checklist's untracked timezone-validation gap (`INVALID_TIMEZONE`). Verified: zero remaining `⬜`/"Chưa chốt" rows in FE §7. |
| R5.1 | hard | PASS | `docs/features/BE/feature_session_management_tech.md:723-844` (§5 Testing Plan, now 92 unit + 8 integration rows) | §5 itself has rows covering the newer invite/guest-note/DD-112 behavior — satisfies the rubric's first clause directly. New tests #85-92 (this round) mirror the new close/auto-close edges plus recurrence/timezone, so §5 doesn't immediately drift from §2 again. |
| R5.2 | hard | PASS | `docs/features/BE/feature_session_management_tech.md` new "### Verify" subsection (§5, before Rollout) | **Fixed (answer 8):** real sandbox (`pnpm --filter @plexco/db run typecheck`), `verify_host` (`... exec vitest run src/session-service.test.ts`, needs `DATABASE_URL_TEST`), and CI-gate (`typecheck→format:check→review:check→lint→build→test`) commands — cross-checked against live `package.json` scripts and `.github/workflows/ci.yml`, not invented. |
| R6.1 | supervised | GAP (by design) | `docs/features/BE/feature_session_management_tech.md:198-199` | Condition still triggers — feature genuinely needs new schema (now properly tracked as its own supervised migration slice, merged before code slices, per answer 4). This is the expected, non-blocking end state for a supervised-tier item. |
| R7.1 | supervised | GAP (by design) | `docs/features/FE/feature_session_management.md:194,231,238,290,419-420,696` | Condition still triggers — feature is inherently copy-heavy across bot and web surfaces (HARD RULE 5). Not addressed by any owner answer (none asked for it) — any slice touching this copy needs the supervised tag. Expected, non-blocking. |
| R8.1 | supervised | GAP (by design) | `docs/features/FE/feature_session_management.md` §3 (restructured — answer 9) | Condition still triggers — feature genuinely owns `apps/web/app/**` screens. **Follow-on requirement now fully met:** Bot session detail has its own 4-state table, Bot publish/discard have explicit Loading/Empty rows, the 6 orphaned rows are restructured into proper "Join/Leave action" + "Publish/Discard control" sections with 3 duplicates removed. Still GAP because the condition (touches web pages) is true — future slices touching these screens must be tagged supervised. |

## Questions — RESOLVED 2026-09-11

All 9 questions below were answered by the owner in one round (verbatim in § Answers) and applied to
the FE/BE specs + `decisions.md` (new `DD-121`) in commit `bf7933b`. Kept verbatim as the historical
record of what was asked and why; see the Rubric table above for the resulting verdict per item.

1. (R1.2) FLOW 13 (`docs/product/PRD.md` §FLOW 13, P4.3, cross-club join via marketplace) is cited in the FE spec header, but the PRD's own changelog (`:16`, v2.8q) says the marketplace listing/discovery mechanism this flow depends on is "epic-gated" and won't exist in phase-1 — only a toggle + immediate-deny fence, no actual findable listing. Is FLOW 13 / public marketplace discovery actually required for session_management's phase-1 (P2)/P4 slices (e.g. SES-UC-8 public join), or should the public-join path be scoped to "toggle-only, no discovery" for now, deferring true marketplace join until FLOW 13's epic unlocks? Proposed answer: scope current slices to toggle-only; defer marketplace-discovery-dependent behavior and note it explicitly in FE §1 "Ngoài phạm vi".

2. (R2.2 — caveat on a PASS, not a GAP) FE spec's own `> **Implementation:**` line (`:7`) says "Not started... SessionService/routes/projector/auto-promote vẫn chưa build" — this is now factually wrong. `packages/db/src/session-service.ts` has 6 live commands (create/publish/announce/update/close/cancel) and 5 routes are merged as of current HEAD `6bfa905`. BE spec's own header (`:6`) already carries the accurate, current status. Should FE's Implementation line be updated to mirror BE's so a future writer doesn't assume nothing is built and risk duplicating or breaking existing SessionService code? Proposed answer: yes, update FE:7 to match BE:6's wording.

3. (R2.3) SES-UC-5 (CloseSession) and SES-UC-10 (system auto-close) have no dedicated edge case anywhere (FE or BE). SES-UC-18 (approve/reject pending) is uncovered in FE §2 specifically (BE covers it via edges #44/#45). Should edge cases be authored for the close and auto-close transitions before those commands are sliced, and should FE §2 gain a row mirroring BE's #44/#45 for approve/reject?

4. (R3.2 / R6.1) `session_guest_notes`, `sessions.allow_player_invite`, and `players.invited_by_person_id` (+ index) are fully specified in BE §2 but exist in neither live schema nor any merged migration, and are absent from §2's own Migration & Rollback pending list. Should that pending list be updated to include this schema, and should it become its own supervised migration slice merged before any invite/guest-note code slice?

5. (R3.3) 4 of 8 §3-listed endpoints (announce, close, `GET` list, `GET` detail) have no request/response examples, and `PUT` has error-only coverage. Separately, the invite/guest-note/approve/reject endpoints (which DO have examples) aren't listed in the §3 Endpoints table at all. Should §3 be reconciled to list all 14 actual endpoints, with an example (or explicit pointer) for each?

6. (R3.4) The invariant catalog names `publish-suspend-gate`, `session-command`, `billing-authz`, `retry-liveness`, `member-safety` as owned by this BE doc, but none of the 5 tokens appear verbatim in it — the doc uses different prose for the same mechanisms. Should the BE doc adopt the catalog's canonical names inline (at least as parentheticals), or should the catalog be updated to the doc's actual vocabulary?

7. (R4.2) Two unresolved items overlap current scope: (a) SES-OQ-2 (recurrence edit granularity, `⬜ Chưa chốt`) overlaps in-scope SES-UC-2; (b) checklist §9-A's timezone-validation gap (malformed-string rejection not concretely specified) isn't even tracked in FE's own Open Questions table, yet every session create/edit touches the required `timezone` field. Resolve both before slicing recurrence-editing or timezone-validation behavior?

8. (R5.2) No verify/test command is stated anywhere in the 908-line BE doc. What is the actual sandbox-runnable verify command for this package (e.g. `pnpm --filter @plexco/db test`, `pnpm --filter @plexco/db typecheck`?), and which parts (if any) need `next build` or a real DB and should be split to `verify_host`/CI?

9. (R8.1) FE §3 has 3 structural gaps: (a) "Bot — Session detail (`/status`)" has no inline 4-state table (only indirect coverage via the aggregate matrix); (b) "Bot — Publish draft / Discard draft" sub-tables show only Ready+Error, no explicit Loading/Empty rows (not even "N/A"); (c) 6 unheaded rows at FE:711-716 sit under the Approve/Reject heading using the aggregate-matrix's column shape, duplicating 2 screens' state info and introducing 2 screens ("Join/Leave action", "Publish/Discard control") with no inline per-screen table of their own. Should §3 be cleaned up before those specific screens are sliced?

## Decisions to finalize — RESOLVED

- ~~SES-OQ-2 (recurrence edit granularity — single occurrence vs this-and-future)~~ → resolved via `DD-121` (this-and-future only; single-occurrence deferred as a named, non-blocking follow-up).
- ~~Timezone input validation contract (checklist §9-A item 2)~~ → resolved via new SES-OQ-10 (`INVALID_TIMEZONE`, `Intl.supportedValuesOf('timeZone')`).

## Answers
<!-- the owner edits below this line, or dictates answers in chat and Claude writes them here
     verbatim before the --apply round reads them -->

1. Yes — toggle-only. DD-114 D3 (owner 26/08) already decided phase-1 = public/private toggle + immediate-deny fence, no public_sessions projector. Scope SES-UC-8 to that; add an explicit "Ngoài phạm vi" bullet in FE §1: marketplace discovery / FLOW 13 cross-club join is deferred until the "public read model" epic (its four named prerequisites) lands. Keep the FLOW 2/13 citation in the header but annotate FLOW 13 as deferred.

2. Yes — update FE:7 Implementation line to mirror BE:6 (current status, commands and routes that exist on main). Add the commit sha you measured against.

3. Yes — author edge cases now, in BOTH FE §2 and BE §2. For SES-UC-5 (CloseSession) and the manual close/cancel paths, derive the rows from the LIVE code (packages/db/src/session-service.ts closeSession/cancelSession) and the existing BE §3 idempotency contract — document actual behaviour, do not invent. For SES-UC-10 (auto-close, not yet implemented) draft the rows from the state machine + DD-45/DD-45a: same close transition triggered by the system at end time + grace, idempotent with a prior manual close, no new join after, projection removed, charges/venue untouched; mark every rule you had to decide with "OWNER-CHECK". Mirror BE edges #44/#45 into FE §2 for SES-UC-18. I review the drafted rows in the PR.

4. Yes — update BE §2 Migration & Rollback pending list to include session_guest_notes, sessions.allow_player_invite, players.invited_by_person_id (+ index), with rollback notes. It becomes its own supervised migration slice (per feature-readiness R6.1), merged before any invite / guest-note code slice.

5. Yes — reconcile BE §3 Endpoints table to all 14 real endpoints (the 8 listed + the invite/guest-note/approve/reject family from §1 Entry points). Add a request + success response example for announce, close, GET list, GET detail, and a success example for PUT. Point to existing examples rather than duplicating where one already exists.

6. BE doc adopts the catalog's canonical tokens inline as parentheticals at the paragraph that describes each mechanism (publish-suspend-gate, session-command, billing-authz, retry-liveness, member-safety). Do NOT rename the catalog — it is cross-doc authority and other docs reference its tokens.

7. (a) SES-OQ-2 decided: recurrence edits are THIS-AND-FUTURE only for the current phase — editing a rule creates a new rule version from the chosen occurrence onward; past and already-generated earlier occurrences are not rewritten (this is exactly BE "Recurrence Implementation" as written, no schema change). Single-occurrence edits are explicitly "Ngoài phạm vi" (record as a follow-up open question, not blocking). Mark SES-OQ-2 ✅ in FE §7, add a decisions.md entry if that is the convention, and add BE §5 unit rows for "edit from occurrence N: earlier occurrences unchanged, N+ regenerated under new version".
   (b) Timezone validation: reject any timezone not in Intl.supportedValuesOf('timeZone') at create/update with error code INVALID_TIMEZONE (400); record as ✅ in FE §7 and as a BE §5 unit row.

8. Verify commands, from the repo as it is on main:
   - sandbox `verify` for @plexco/db slices: pnpm --filter @plexco/db run typecheck
   - dispatcher-side `verify_host` (needs DATABASE_URL_TEST): pnpm --filter @plexco/db exec vitest run src/session-service.test.ts   (or the slice's own test file)
   - @plexco/web route slices: sandbox verify = pnpm --filter @plexco/web run typecheck plus pnpm --filter @plexco/web exec vitest run app/api/sessions (route tests mock the DB, no DATABASE_URL_TEST)
   - next build and the full suite stay CI's gate (typecheck → format:check → review:check → lint → build → test).
   Write this into BE §5 as a "Verify" subsection, and note that any slice under a needs_db class must set verify_host.

9. Yes — clean up FE §3: (a) give "Bot — Session detail (/status)" its own 4-state table; (b) add Loading/Empty rows to Publish/Discard draft tables (explicit "N/A — instant command" is acceptable); (c) move the 6 orphan rows at FE:711-716 under proper per-screen headings, creating tables for "Join/Leave action" and "Publish/Discard control", and delete the duplicated rows. Docs-only; the screens themselves stay supervised slices (R8.1).
