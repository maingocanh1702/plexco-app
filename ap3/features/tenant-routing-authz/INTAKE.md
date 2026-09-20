---
feature: tenant-routing-authz
readiness_version: null
status: READY_WITH_SUPERVISED_SLICES
measured_at: 2026-09-20T09:45:10Z
base_sha: a99b1ffc097706b8965487ea0004d61199f27c22
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
`BE/feature_tenant_routing_authz_tech.md`, both v2.9, Reviewed, 2026-09-19 as of `base_sha`) but the readiness
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

## Re-pin 2026-09-20 (base_sha → `a99b1ff`)

`/ap3-plan` refused on its sources-scoped staleness diff: between the scored `41b36d3` and
`origin/main` exactly one of the 22 `sources:` paths differed — `docs/product/ROADMAP.md` — because
the Project-tier commits `ae374b8` + `065390d` landed on `main` while this intake was in flight, and
PR #28 merged the two histories at `a99b1ff` without a rebase. The gate was right to refuse: a
whole-file diff is the contract, and "looks like render churn" is not something the planner may
judge for itself.

Re-verified here instead, against `origin/main@a99b1ff`:

- `git diff 41b36d3 origin/main -- <all 22 sources>` names only `docs/product/ROADMAP.md`.
- That diff, outside the Module Progress table, is one reworded note line under LUẬT THANH, one new
  note line above the table, and the two `<!-- modules:begin/end -->` markers. Inside the table the
  rows are re-rendered from `docs/project/modules.json` with identical `#`, track, phase, spec, axis
  symbols and rev (round-trip checked at `ae374b8`). No phase, status or axis the R1.1 citation
  relies on changed.
- R1.1's citations shift by the four inserted lines: §"P2–P3: TENANT ENGINE" `:510-522` → `:514-526`
  (item 4.3 now at `:526`), and the Next Actions mention `:846` → `:850`; the blocker-list mention
  at `:84` is unchanged. The rubric row above carries the corrected line numbers.

No other rubric row cites `ROADMAP.md`. Status stays `READY_WITH_SUPERVISED_SLICES`; the
`intake-score` result is unchanged because no verdict changed. This commit touches `INTAKE.md` only,
so once it merges the sources diff between the new `base_sha` and `origin/main` is empty by
construction.

Lesson recorded for the next intake: when `sources:` lists a file that another lane re-pins or
renders on a cadence (`ROADMAP.md`, `BUILD-STATUS.md`, `HANDOFF.md`), rebase the intake branch onto
`origin/main` immediately before opening its PR, and re-stamp `base_sha` if any source moved.

## Rubric

| id | gate | verdict | decided by | note |
|----|------|---------|------------|------|
| R1.1 | hard | PASS | `docs/features/FE/feature_tenant_routing_authz.md:3` ("Canonical phase: P2") + `docs/product/ROADMAP.md:514-526` (§"P2–P3: TENANT ENGINE" → R1 "Zalo biết tenant" item 4.3: "Authz 2 lớp... qua DD-56 registry") + `:84,850` (`tenant-capability-authority-core` named in the live blocker list and Next Actions) | Feature/task both have roadmap presence with a matching phase label; FE spec doesn't literally cite "ROADMAP.md" as its source but the phase numbers agree. |
| R1.2 | hard | N/A | Owner ruling, this doc's § Answers A1 (2026-09-19) | "PRD's FLOW model describes user journeys; `tenant-capability-authority-core` is a cross-cutting authorization primitive with no journey of its own. PRD §4.2 Identity & Routing / §4.3 Tenant / Bảo mật already cover the routing-then-authorize predicate this task serves." No PRD edit — a PRD version bump would churn 71 feature specs' 📍 pointer blocks. |
| R1.3 | hard | PASS | `docs/features/FE/feature_tenant_routing_authz.md:6` ("Status: Reviewed") | v2.9 as of `base_sha`. |
| R2.1 | hard | PASS | `docs/features/FE/feature_tenant_routing_authz.md:186-203` (§6 Acceptance Criteria, 16 bullets, line numbers as of `base_sha`) | Scanned for "hợp lý"/"phù hợp"/"tốt" — zero hits. |
| R2.2 | hard | PASS | `docs/features/FE/feature_tenant_routing_authz.md:197-198` (§6 criterion #10 annotated `[RED anchor]` — first writer test `authorize({ action: "no.such.key", actor, target })` denies, RED because `authorize` does not exist; #11 annotated `[RED #2]`) | ap3-intake A2 (2026-09-19). |
| R2.3 | hard | PASS | `docs/features/FE/feature_tenant_routing_authz.md:85-87` (new edge cases #17-19: role revoked mid-request, grant expiry mid-lock-wait, post-migration-milestone registry-only guard) | ap3-intake A3 item 4 (2026-09-19). Covers the two DD-56 amendment #1 clause 4/5 obligations previously missing. |
| R3.1 | hard | PASS | `docs/features/BE/feature_tenant_routing_authz_tech.md` §1-§6 headings (`:12,48,258,381,483,560` as of `base_sha`) + `### Entry points` at `:34-44` (7 rows), matching `docs/features/README.md:38-40` and `docs/templates/be-tech-spec-template.md`'s 6-section structure exactly | Structurally complete. Line numbers shift with each edit; re-measure at cite time, don't trust the pinned numbers verbatim. |
| R3.2 | hard | PASS | `docs/features/BE/feature_tenant_routing_authz_tech.md:113-168` (new "Target DDL" subsection: `tenant_capability_actions` `:119`, `tenant_capability_grants` `:130`, `tenant_capability_grant_audit` `:151`, each with types/constraints/indexes/RLS/REVOKE/trigger) | ap3-intake A4 (2026-09-19). `routing_audit` unchanged (already live). |
| R3.3 | hard | PASS | `docs/features/BE/feature_tenant_routing_authz_tech.md:340-342` (three grants endpoints marked `follow-up: tenant-sensitive-capability-grant-lifecycle`) + `:346-372` (new "Migration of the seven interim-gated routes" subsection: route→action-key table + guard-retirement + "what land means") | ap3-intake A3 items 2-3 + A4 (2026-09-19). DTOs for the deferred grants endpoints remain out of this task's scope by design (A4). |
| R3.4 | hard | PASS | `docs/features/BE/feature_tenant_routing_authz_tech.md:422-441` (new "Actor-recheck-under-lock" invariant subsection, registered in `docs/autopilot-invariant-catalog.md`) + `:385` (`authorize(action, actor, target)` — 3-arg form, contradiction with the old 4-arg `:274` text fixed) | ap3-intake A3 item 1 + A5 (2026-09-19). |
| R4.1 | hard | PASS | `docs/standards/decisions.md` — 27 distinct `DD-xxx` IDs swept (union of every citation in both specs, plus the mandated DD-110/29/32/12/117/38/91-95/101/102/52 set); every one is `✅ Chốt` or `✅ \`DECISION_FINAL\`` in both its summary-table row and body heading, zero "proposal"/"chưa chốt" hits as an actual status claim anywhere | DD-56 itself: table row `:77` reads "✅ Chốt matrix... chưa runtime" — matrix/decision finality is explicitly separate from runtime/code existence in this repo's own convention (`decisions.md:737-738`), and the rubric only requires the former. |
| R4.2 | hard | PASS | `docs/features/FE/feature_tenant_routing_authz.md:209-214` (§ Open Questions, RTE-OQ-1 and RTE-OQ-2 — both rows already marked `✅ Chốt`), line numbers as of `base_sha` | Zero unresolved open questions exist in the table at all; no `docs/issues/` acceptance checklist exists for this feature (confirmed — only `session-management-acceptance-checklist.md` exists in that directory). |
| R5.1 | hard | PASS | `docs/features/BE/feature_tenant_routing_authz_tech.md:485-529` (§5 Unit Tests, rows 17-28/30/32-35 directly exercise least-privilege preset, sensitive-action deny/allow, expired/revoked/wrong-tenant deny, non-delegable role management, unknown registry action, mid-request re-check, exact Chat keys) + `:531-541` (4 relevant Integration Tests), line numbers as of `base_sha` | Caveat noted but no longer blocking: the grants API DTOs and choke-point-replacement obligation are now covered by design (R3.3/R3.4 PASS above) — deferred DTOs have no test because they're out of this task's scope (A4), and the choke-point migration is now described in BE §3 for a future slice to test against. |
| R5.2 | hard | PASS | `docs/features/BE/feature_tenant_routing_authz_tech.md:543-561` (new `### Verify` section, table copied from `feature_session_management_tech.md`'s pattern + a supervised-lane `verify_host` note) | ap3-intake A6 (2026-09-19). |
| R6.1 | supervised | GAP (by design) | `docs/autopilot-backlog.md:1678` (`change_class: schema-migration`) + migration tail confirmed at `packages/db/migrations/0046_rate_limit_bounded_cleanup.sql` (no `0047_*` exists yet) | Expected, non-blocking — this task's core deliverable is exactly a new-schema slice. Routes to Level 3 supervised per `docs/autopilot-templates/level3-workflow.md`, not the ap3 dispatcher (P1 + schema-migration is outside `ap3/routines.json`'s two enabled P2 classes). |
| R7.1 | supervised | PASS | `docs/autopilot-backlog.md:1694-1695` ("Sensitive grant/revoke mutation command/UI is a separate follow-up if it cannot fit the bounded core") + `docs/features/FE/feature_tenant_routing_authz.md:138` ("Sensitive grant/revoke mutation command + management UI tách thành `tenant-sensitive-capability-grant-lifecycle` nếu vượt scope"), line number as of `base_sha` | Two independent sources agree the grant-management UI/strings belong to a separate, not-yet-authored follow-up task, not to this core task's bounded scope. Flagging this boundary explicitly since the FE spec's own Entry points table (`:29`, "Grant management") and Screens & States could otherwise read as in-scope for a future reader. |
| R8.1 | supervised | PASS | Same citations as R7.1 | This task's deliverable (registry + `authorize()` + grant storage) owns no page; `/clubs/:id/settings/team/:memberId/grants` belongs to the deferred follow-up task. |

## Status

`READY_WITH_SUPERVISED_SLICES` — computed via `python3 ap3/aplib.py intake-score
docs/standards/feature-readiness.md <evidence.json>` against the rescored table above:

```json
{
  "status": "READY_WITH_SUPERVISED_SLICES",
  "hard_gaps": [],
  "supervised_gaps": ["R6.1"],
  "gaps": ["R6.1"]
}
```

All seven hard-tier gaps (R1.2, R2.2, R2.3, R3.2, R3.3, R3.4, R5.2) were closed by owner answers
A1–A6 (§ Answers) and the resulting FE/BE spec edits landed at `base_sha`
(`41b36d322ad2e53bc9e3dd7bf81918150543dd29`, commit "docs(tenant-routing-authz): close ap3-intake
A1-A6 gaps in FE/BE spec pair"). R6.1 remains an expected, non-blocking supervised gap — this
task's core deliverable is exactly a new-schema slice, so it routes through Level 3 supervised
autonomy per `docs/autopilot-templates/level3-workflow.md`, not the ap3 dispatcher (P1 +
schema-migration falls outside `ap3/routines.json`'s two enabled P2 classes). Next step is
`/ap3-plan tenant-routing-authz`, which per its own staleness check cannot start until this
branch's PR is merged into `origin/main`.

**Root cause of the original seven gaps, stated once instead of seven times:** both specs were
frozen at v2.8 / 2026-08-10 — *before* DD-56 amendment #1 was ratified (2026-08-26), let alone
amendment #2 (2026-09-04) or amendment #3 (2026-09-19). The specs were correctly Reviewed at the
time (`docs/features/README.md:47-50`'s 3-way gate — "spec claim ↔ snippet trong spec ↔ live
code/schema phải khớp" — has nothing to say about a decision layered on *after* Reviewed status was
granted). Five of the seven hard gaps (R2.3, R3.2, R3.3, R3.4, and half of R5.2's missing-Verify
surface) traced back to this one staleness fact. R1.2 (no PRD FLOW) and R2.2 (no named RED
criterion) were unrelated, pre-existing gaps.

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

<!-- Owner decisions, 2026-09-19, dictated in the Cowork session and written verbatim. Each answer
     names the doc edit it authorizes. No new DD is required; nothing below changes a DD status. -->

### A1 (R1.2) — N/A, with a recorded waiver. Do NOT edit the PRD.

R1.2 is scored **N/A** for this task with this one-line reason, to be kept in the rubric table's
note column: "PRD's FLOW model describes user journeys; `tenant-capability-authority-core` is a
cross-cutting authorization primitive with no journey of its own. PRD §4.2 Identity & Routing /
§4.3 Tenant / Bảo mật already cover the routing-then-authorize predicate this task serves."
Reason for not amending the PRD instead: a PRD version bump (v2.9 -> v2.10) propagates to the
`PRD v2.9` pointer carried by 71 feature specs' 📍 blocks -- exactly the hand-maintained churn the
project is retiring. The anchor for future consumer intakes (chat, billing) is this waiver text.

### A2 (R2.2) — RED anchor = FE §6 criterion #10; #11 is the second test.

Name criterion #10 as the RED reference point: "One canonical action→capability registry drives
API/UI/adapters; unknown action and missing/expired grants deny." The first test a writer runs is
`authorize({ action: "no.such.key", actor, target })` expecting deny; it is RED at base because
`authorize` does not exist. Mark criterion #11 ("`admin` và `co_admin` cho cùng least-privilege
preset; không label nào nhận owner-only action") as the second test: it also documents that the
interim gate over-grants today (`apps/web/lib/session-command-route.ts` treats owner/admin/co_admin
identically via `ALLOWED_ROLES`). Edit FE §6: annotate #10 as `RED anchor` and #11 as `RED #2`.

### A3 (R2.3 + R3.3 + R3.4) — write both DD-56 obligations into the specs; "under lock" is the repo's existing FOR SHARE precedent.

Authorized edits:

1. **BE §4, new invariant `actor-recheck-under-lock`** (register the name in
   `docs/autopilot-invariant-catalog.md` if the catalog has no equivalent): `authorize()` runs
   INSIDE the consumer command's transaction and takes `SELECT ... FOR SHARE` on the actor's
   `tenant_admins` row (and on the grant row when the action is sensitive) through a SECURITY
   DEFINER function, following the precedent of `authorizeTenantAction` ->
   `resolve_subscription_locked` (migrations 0027/0038; `packages/db/src/authorization.ts` -- the
   locks persist to commit). A concurrent revoke therefore waits for the command to commit or abort.
   Every time predicate (`expires_at`, `revoked_at`) is evaluated with `clock_timestamp()`, never
   `now()` (lesson C1, audit 2026-09-06: `now()` is frozen at transaction start and does not move
   while waiting on a lock). The pre-transaction read at the route layer remains only as a cheap
   early deny; it is not the authority.
2. **BE §3, new subsection "Migration of the seven interim-gated routes"**: the routes named by
   DD-56 amendment #1 (create · PUT /:id · publish), #2 (close · cancel) and #3 (POST /:id/guest-notes ·
   DELETE /:id/guest-notes/:noteId) switch from `resolveSessionCommandContext`'s `ALLOWED_ROLES`
   check to `authorize(action, actor, target)`; the ESLint `no-restricted-imports` allowlist for
   `tenantsForPerson` (`eslint.config.mjs`) and the AST tests in `session-command-route.test.ts` are
   retired in the same change that switches the last route. Map each route to its registry action
   key in a table (all seven resolve to `session.manage` today).
3. **BE §3, define "land" for amendment #1 clause 5 explicitly**: amendments #1/#2/#3 become void
   at the milestone in which ALL seven routes are switched to `authorize()` -- not when the registry
   table lands. `/ap3-plan` is expected to split this task into at least three milestones
   (schema + registry seed; `authorize()` primitive + tests; route migration + guard retirement);
   the amendments survive until the third lands.
4. **FE §2, three edge cases**: (a) role revoked between the route-layer early deny and the command
   transaction -> the in-transaction `authorize()` denies and the command aborts, no partial
   mutation; (b) grant expires while the command waits on a lock -> `clock_timestamp()` sees the
   expiry, deny; (c) a route still on the interim gate after the switch milestone -> the ESLint rule
   is gone, so the guard is the registry: an action key missing from `tenant_capability_actions`
   denies.

### A4 (R3.2 + R3.3) — table names confirmed; real DDL; grants API is the follow-up task, not this one.

Canonical names: **`tenant_capability_actions`** (closed registry) and **`tenant_capability_grants`**
(grants), matching the `tenant_*` precedent (`tenant_admins`, `tenant_link_codes`). Fix the §2 Query
Patterns example (`FROM grants g` -> `FROM tenant_capability_grants g`). Authorized DDL for §2, from
§4's own column list:
- `tenant_capability_actions(action_key text PK, co_admin_default boolean NOT NULL, delegable
  boolean NOT NULL, authority_class text NOT NULL CHECK (...))` -- **migration-owned and closed by
  grants, not by convention**: `REVOKE ALL` DML from `app`, `app_worker`, `readonly` (posture of
  0034/0036); the seed is the exact DD-56 matrix plus the four Chat keys.
- `tenant_capability_grants(id uuid PK, tenant_id FK tenants, grantee_person_id FK persons,
  action_key FK tenant_capability_actions, reason text NOT NULL, granted_by_person_id FK persons,
  granted_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL)` with `CHECK (expires_at > granted_at)`, a partial unique index on
  `(tenant_id, grantee_person_id, action_key) WHERE revoked_at IS NULL`, tenant-scoped RLS, and
  `REVOKE` direct DML from `app` (writes go through the follow-up's SECURITY DEFINER command).
- Append-only audit rows for grant/revoke: the table and its append-only trigger belong to this
  task; the writer command belongs to the follow-up.
The `GET/POST/DELETE /api/tenants/:tid/grants(/:gid)` endpoints and their DTOs are **out of this
task's scope**: both `docs/autopilot-backlog.md` (task block) and FE §4 assign grant/revoke
mutation + UI to the follow-up `tenant-sensitive-capability-grant-lifecycle`. Mark those three
endpoint rows in §3 as `follow-up: tenant-sensitive-capability-grant-lifecycle`. What §3 pins for
THIS task is the `authorize()` contract (inputs, decision shape, audit reason classes) and the
seven-route migration contract from A3. Error code: exactly one outward code, `CAPABILITY_DENIED`,
for unknown action, missing grant, expired grant, revoked grant and wrong tenant alike -- the caller
never learns which (same tenant-existence-oracle invariant as `session-command-route.ts`); the
reason class is recorded in the audit row.

### A5 (R3.4) — `authorize(action, actor, target)`, three arguments.

The signature is the one DD-56 amendment #1 clause 5 writes verbatim in `decisions.md`. `now` is
never a parameter: time is the database's, read inside the locked SECURITY DEFINER call (A3), so
the caller cannot pass a stale or forged clock. `tenant` is derived from `target`, not passed. Fix
§4:274 to the three-argument form.

### A6 (R5.2) — copy the `### Verify` table of `docs/features/BE/feature_session_management_tech.md`.

That is the one BE spec with a Verify section and it passed R5.2 in the session-management intake.
Same five rows: `@plexco/db` typecheck (writer sandbox) · `@plexco/db` tests that need Postgres
(`verify_host`) · `@plexco/web` typecheck (sandbox) · `@plexco/web` route tests with mocked DB
(sandbox) · full gate in CI. Because this task is P1 + schema-migration and runs supervised (not
via the ap3 dispatcher), state in the section that `verify_host` means the supervising session runs
it on a machine with Postgres, as the 2026-09-19 gate run did.
