---
feature: tenant-routing-authz
readiness_version: null
status: NOT_READY
measured_at: 2026-09-19T16:20:47Z
base_sha: d8b7a1236780493c7b6cf809059be53f1806da3e
sources:
  - docs/features/FE/feature_tenant_routing_authz.md
  - docs/features/BE/feature_tenant_routing_authz_tech.md
  - docs/standards/feature-readiness.md
  - docs/standards/decisions.md
  - docs/product/ROADMAP.md
  - docs/product/PRD.md
  - docs/product/TDD.md
  - docs/product/BRD.md
  - docs/templates/feature-spec-template.md
  - docs/templates/be-tech-spec-template.md
  - docs/features/README.md
  - docs/autopilot-backlog.md
  - docs/autopilot-invariant-catalog.md
  - docs/autopilot-templates/capability-authority-intake-2026-09-19-RUN.md
  - packages/db/schema.ts
  - packages/db/migrations/0002_tenants_core.sql
  - packages/db/migrations/0021_non_money_tenant_integrity_fks.sql
  - apps/web/lib/session-command-route.ts
  - eslint.config.mjs
  - packages/db/src/authorization.ts
  - packages/db/src/capability.ts
  - packages/db/src/session-service.ts
---

## Scope note

This intake scores the **feature** spec pair (`FE/feature_tenant_routing_authz.md` +
`BE/feature_tenant_routing_authz_tech.md`, both v2.8, Reviewed, 2026-08-10) but the readiness
question is scoped to exactly **one task** inside that feature: `tenant-capability-authority-core`
— the DD-56 closed action registry, the least-privilege preset shared by `admin|co_admin`, the
tenant/person authority resolver, tenant-private grants with expiry/revocation, the append-only
grant audit, and a fail-closed `authorize(action, actor, target)`. Task-scoped rubric items (R2.2,
R2.3, R3.2, R3.3, R6.1) are scored against that task's touch-set only, per
`docs/autopilot-templates/capability-authority-intake-2026-09-19-RUN.md`.

Dependency chain (`chat-definer-role-provisioning` → `chat-dm-safety-authority-core` →
`dd38-dd86-chat-schema-core` → `tenant-capability-authority-core`) is confirmed satisfied: all
three predecessors are `status: merged` in `docs/autopilot-backlog.md` (verified independently at
lines 2884, 2920, 1707). `docs/autopilot-backlog.md:1671-1704`'s own task block is left `status:
idea` deliberately per its `update_2026-09-19` note — moving to `planned` is `/ap3-plan`'s job, not
this round's.

## Rubric

| id | gate | verdict | decided by | note |
|----|------|---------|------------|------|
| R1.1 | hard | PASS | `docs/features/FE/feature_tenant_routing_authz.md:3` ("Canonical phase: P2") + `docs/product/ROADMAP.md:510-522` (§"P2–P3: TENANT ENGINE" → R1 "Zalo biết tenant" item 4.3: "Authz 2 lớp... qua DD-56 registry") + `:84,846` (`tenant-capability-authority-core` named in the live blocker list and Next Actions) | Feature/task both have roadmap presence with a matching phase label; FE spec doesn't literally cite "ROADMAP.md" as its source but the phase numbers agree. |
| R1.2 | hard | **GAP** | `docs/features/FE/feature_tenant_routing_authz.md:9` (cites PRD by **§2 / §4.2/4.3**, never a FLOW number; the literal token "FLOW" appears nowhere in the file) + `docs/product/PRD.md` (16 FLOW headings enumerated, none titled capability/authz/routing/grants; closest is `:336` §4.2 "Identity & Routing", an edge-case table inside a different structural unit, not its own FLOW) | See Q1. |
| R1.3 | hard | PASS | `docs/features/FE/feature_tenant_routing_authz.md:6` ("Status: Reviewed") | v2.8. |
| R2.1 | hard | PASS | `docs/features/FE/feature_tenant_routing_authz.md:183-200` (§6 Acceptance Criteria, 16 bullets) | Scanned for "hợp lý"/"phù hợp"/"tốt" — zero hits. |
| R2.2 | hard | **GAP** | `docs/features/FE/feature_tenant_routing_authz.md:183-200` (16 `- [ ]` bullets, none flagged as a currently-failing RED reference) vs. `:7` ("Implementation: Not started") and `:136` ("Live repo mới có `tenant_admins` role labels + `tenantsForPerson`; chưa có hai target table hay `authorize` primitive") | See Q2. |
| R2.3 | hard | **GAP** | `docs/features/FE/feature_tenant_routing_authz.md:65-84` (§2 Edge Cases, 16 cases / 5 categories — 9 touch capability/grant/wrong-tenant/admin boundaries) — but none of the 16 covers replacing `apps/web/lib/session-command-route.ts`'s interim gate across its seven routes, or the consume-time actor re-check under lock (DD-56 amendment #1 clauses 4/5) | See Q3. |
| R3.1 | hard | PASS | `docs/features/BE/feature_tenant_routing_authz_tech.md` §1-§6 headings (`:12,48,181,270,342,404`) + `### Entry points` at `:34-44` (7 rows), matching `docs/features/README.md:38-40` and `docs/templates/be-tech-spec-template.md`'s 6-section structure exactly | Structurally complete. |
| R3.2 | hard | **GAP** | `docs/features/BE/feature_tenant_routing_authz_tech.md:97-104` (real DDL exists only for `routing_audit`, explicitly marked "Live legacy baseline... reuse, không recreate" at `:50,124` — confirmed live at `packages/db/schema.ts:824`, seeded by `packages/db/migrations/0002_tenants_core.sql:199-206`) vs. `:172-174` (Query Patterns example queries `FROM grants g`) vs. `:302-303` (§4 prose independently names `tenant_capability_actions(...)` and `tenant_capability_grants(...)`, neither with a type/constraint/index — and neither matches the `grants` name used three sections earlier) | See Q4. `routing_audit` itself is correctly handled — the gap is the two tables this task must actually create. |
| R3.3 | hard | **GAP** | `docs/features/BE/feature_tenant_routing_authz_tech.md:263-265` (`GET`/`POST`/`DELETE /api/tenants/:tid/grants(/:gid)` — one-line table rows only) + `:222` ("doc này pin middleware/resolution contract, không pin REST path/DTO — field name chốt ở build slice") + whole-doc grep for "session-command-route", "no-restricted-imports", "seven", "guest-note", "AST test" = zero hits | See Q3 (choke-point obligation) and Q4 (DTO/error-code half). |
| R3.4 | hard | **GAP** | `docs/features/BE/feature_tenant_routing_authz_tech.md:272-296` (AuthZ Action Matrix, 19 rows — substantively solid) vs. whole-doc grep for "invariant" = zero hits anywhere; `:151,305,326,375` describe a generic "re-check inside mutation/command transaction" but never tie it to "actor" + "under lock" the way DD-56 amendment #1 clause 4 does; **and** `:22,40` state the primitive as `authorize(action, actor, target)` while `:274` states `authorize(action, actor, tenant, now)` — a 3-arg vs. 4-arg self-contradiction | See Q3 and Q5. |
| R4.1 | hard | PASS | `docs/standards/decisions.md` — 27 distinct `DD-xxx` IDs swept (union of every citation in both specs, plus the mandated DD-110/29/32/12/117/38/91-95/101/102/52 set); every one is `✅ Chốt` or `✅ \`DECISION_FINAL\`` in both its summary-table row and body heading, zero "proposal"/"chưa chốt" hits as an actual status claim anywhere | DD-56 itself: table row `:77` reads "✅ Chốt matrix... chưa runtime" — matrix/decision finality is explicitly separate from runtime/code existence in this repo's own convention (`decisions.md:737-738`), and the rubric only requires the former. |
| R4.2 | hard | PASS | `docs/features/FE/feature_tenant_routing_authz.md:206-211` (§ Open Questions, RTE-OQ-1 and RTE-OQ-2 — both rows already marked `✅ Chốt`) | Zero unresolved open questions exist in the table at all; no `docs/issues/` acceptance checklist exists for this feature (confirmed — only `session-management-acceptance-checklist.md` exists in that directory). |
| R5.1 | hard | PASS | `docs/features/BE/feature_tenant_routing_authz_tech.md:344-382` (§5 Unit Tests, rows 17-28/30/32-35 directly exercise least-privilege preset, sensitive-action deny/allow, expired/revoked/wrong-tenant deny, non-delegable role management, unknown registry action, mid-request re-check, exact Chat keys) + `:390-400` (4 relevant Integration Tests) | Caveat: does not cover the grants API endpoints (R3.3 gap: no DTO to test against) or the choke-point-replacement obligation (R2.3/R3.3/R3.4 gap: not described anywhere to test against). |
| R5.2 | hard | **GAP** | `docs/features/BE/feature_tenant_routing_authz_tech.md` — no `### Verify` heading exists anywhere (confirmed via the full heading list at R3.1's citation); whole-doc grep for "verify"/"vitest"/"typecheck"/"next build"/"pnpm"/"sandbox" = zero hits | See Q6. |
| R6.1 | supervised | GAP (by design) | `docs/autopilot-backlog.md:1678` (`change_class: schema-migration`) + migration tail confirmed at `packages/db/migrations/0046_rate_limit_bounded_cleanup.sql` (no `0047_*` exists yet) | Expected, non-blocking — this task's core deliverable is exactly a new-schema slice. Routes to Level 3 supervised per `docs/autopilot-templates/level3-workflow.md`, not the ap3 dispatcher (P1 + schema-migration is outside `ap3/routines.json`'s two enabled P2 classes). |
| R7.1 | supervised | PASS | `docs/autopilot-backlog.md:1694-1695` ("Sensitive grant/revoke mutation command/UI is a separate follow-up if it cannot fit the bounded core") + `docs/features/FE/feature_tenant_routing_authz.md:134` ("Sensitive grant/revoke mutation command + management UI tách thành `tenant-sensitive-capability-grant-lifecycle` nếu vượt scope") | Two independent sources agree the grant-management UI/strings belong to a separate, not-yet-authored follow-up task, not to this core task's bounded scope. Flagging this boundary explicitly since the FE spec's own Entry points table (`:29`, "Grant management") and Screens & States could otherwise read as in-scope for a future reader. |
| R8.1 | supervised | PASS | Same citations as R7.1 | This task's deliverable (registry + `authorize()` + grant storage) owns no page; `/clubs/:id/settings/team/:memberId/grants` belongs to the deferred follow-up task. |

## Status

`NOT_READY` — computed via `python3 ap3/aplib.py intake-score docs/standards/feature-readiness.md
<evidence.json>`:

```json
{
  "status": "NOT_READY",
  "hard_gaps": ["R1.2", "R2.2", "R2.3", "R3.2", "R3.3", "R3.4", "R5.2"],
  "supervised_gaps": ["R6.1"],
  "gaps": ["R1.2", "R2.2", "R2.3", "R3.2", "R3.3", "R3.4", "R5.2", "R6.1"]
}
```

**Root cause, stated once instead of seven times:** both specs are frozen at v2.8 / 2026-08-10 —
which is *before* DD-56 amendment #1 was even ratified (2026-08-26), let alone amendment #2
(2026-09-04) or amendment #3 (2026-09-19). The specs were correctly Reviewed at the time
(`docs/features/README.md:47-50`'s 3-way gate — "spec claim ↔ snippet trong spec ↔ live code/schema
phải khớp" — has nothing to say about a decision layered on *after* Reviewed status was granted).
Five of the seven hard gaps (R2.3, R3.2, R3.3, R3.4, and half of R5.2's missing-Verify surface)
trace back to this one staleness fact, not to five independent documentation failures. R1.2 (no PRD
FLOW) and R2.2 (no named RED criterion) are unrelated, pre-existing gaps.

## Questions

1. **(R1.2, blocking)** `docs/product/PRD.md` has no FLOW dedicated to tenant capability, routing, or
   authorization — its 16 FLOWs are all user journeys (onboarding, join, mark-paid, discovery...).
   The closest match, §4.2 "Identity & Routing" (`PRD.md:336`), is an edge-case table inside a
   different structural unit, not a FLOW, and isn't marked out-of-scope either — there's simply
   nothing to point R1.2 at.
   **Proposed answer:** treat R1.2 as structurally inapplicable to a cross-cutting authority
   primitive (as opposed to a user-facing journey), and record a one-line waiver here — e.g. "R1.2
   N/A for `tenant-capability-authority-core`-class tasks: PRD's FLOW model covers user journeys,
   not shared authorization infrastructure; `§4.2 Identity & Routing` is the closest applicable
   section and already covers the routing predicate this task's scope touches." The alternative is
   authoring a new FLOW or amending §4.2 to explicitly own capability/authz — happy to draft either
   if you'd rather go that way.

2. **(R2.2, blocking)** None of FE §6's 16 acceptance criteria is singled out as the RED reference
   point that currently fails at base (unlike the rubric's own worked example, session-management's
   InviteFriend → `ALREADY_JOINED`). Since the whole task is greenfield, arguably *every* criterion
   is trivially RED today — but the rubric's intent seems to be a *deliberately named* target a
   headless writer can run first.
   **Proposed answer:** name one criterion explicitly — my suggestion would be whichever criterion
   most directly asserts `authorize()` denying an unrecognized action/actor (since that's the
   sharpest "does not exist yet, must return X" test), but I don't want to guess which of the 16 you
   consider the right anchor. Which one, or should I draft new wording?

3. **(R2.3 + R3.3 + R3.4, blocking, one root cause)** Neither spec anywhere describes the two
   obligations DD-56 amendment #1 explicitly assigns to this task by name:
   - **clause 5**: replacing `apps/web/lib/session-command-route.ts`'s interim choke-point for all
     seven routes it now gates (create/publish/update/close/cancel/2 guest-note routes), plus
     retiring its ESLint `no-restricted-imports` rule (`eslint.config.mjs:101-189`) and the AST
     tests that back it;
   - **clause 4**: a consume-time re-check of the actor **under lock**, inside the command
     transaction — distinct from the generic "re-check inside mutation transaction" language BE
     §2/§4 already has (`:151,305,326,375`), which never ties the re-check to the *actor* or to a
     *lock*.
   **Proposed answer:** update BE §3 (Endpoints) to state the seven-route migration plan and ESLint/
   AST retirement explicitly, update BE §4 to name the actor-under-lock re-check as its own
   invariant, and add 2-3 edge cases to FE §2 covering both transitions. I can draft this edit for
   your review once you confirm the shape (e.g., does "under lock" mean a `SELECT ... FOR UPDATE` on
   the membership row inside the existing command transaction, or something else?).

4. **(R3.2 + half of R3.3, blocking)** There is no `CREATE TABLE` DDL anywhere in BE §2 for either
   table this task must create. Worse, the document disagrees with itself on names: §2's own Query
   Patterns example queries `FROM grants g` (`:172-174`), while §4's prose independently describes
   `tenant_capability_grants(tenant_id, grantee_person_id, action_key, reason, granted_by_person_id,
   granted_at, expires_at, revoked_at)` (`:303`) and a *second* table, the registry itself,
   `tenant_capability_actions(action_key PK, co_admin_default, delegable, authority_class)`
   (`:302`) — neither with types, constraints, or indexes.
   **Proposed answer:** confirm `tenant_capability_actions` (registry) and `tenant_capability_grants`
   (grants) as the two canonical names — they read as the more complete/deliberate naming versus the
   bare `grants` alias in the Query Patterns example — and I'll draft full DDL (types, FKs per
   `:303`'s own column list, the `expires_at > granted_at` / one-non-revoked-grant-per-tuple
   constraints it already names in prose, plus indexes) for §2, and fix the Query Patterns example to
   match. Also add the endpoint request/response DTOs for `/api/tenants/:tid/grants(/:gid)` and any
   grant-specific error codes (e.g. grant-not-found, expiry-in-the-past) to the master Error Codes
   table — right now only the generic `CAPABILITY_DENIED` exists.

5. **(R3.4, blocking, small)** Self-contradiction on the primitive's own signature: §1 (`:22,40`)
   says `authorize(action, actor, target)`, §4's intro (`:274`) says `authorize(action, actor,
   tenant, now)` — 3 args vs. 4, different parameter names.
   **Proposed answer:** I'd lean toward the 3-arg `authorize(action, actor, target)` form, since it's
   what both the FE spec's Implementation Ownership block and the backlog's own task description use
   consistently — but confirm, since §4 is the section actually meant to pin implementation detail.

6. **(R5.2, blocking)** No `### Verify` subsection exists anywhere in the BE spec — zero shell
   commands, no split between sandbox-runnable checks and DB/migration-dependent `verify_host`
   checks.
   **Proposed answer:** add one following this repo's usual pattern for `packages/db`-touching
   slices — sandbox: typecheck + vitest for the new package/module; `verify_host`: anything that
   needs a real Postgres (migration apply, RLS/constraint tests). I don't have a directly-comparable
   BE spec's Verify section in front of me to copy verbatim — if you can point me at one you consider
   canonical, I'll match its exact command shape; otherwise I'll draft from the repo's root
   `package.json` scripts.

## Decisions to finalize

None surfaced this round. Every gap above is a documentation-completeness or internal-consistency
issue resolvable by editing the FE/BE specs — none of them requires a new `DD-xxx` entry or reopens
an existing one. (Q3's "under lock" mechanism and Q5's signature choice are implementation-detail
clarifications, not product/architecture decisions.)

## Answers
<!-- the owner edits below this line, or dictates answers in chat and Claude writes them here
     verbatim before the --apply round reads them -->
