<!-- review-readiness: enforce -->
# PLEXCO CONTINUATION PROGRAM — DIRECT-TO-READY CONDUCTOR

> **Purpose:** turn every currently open Plexco backlog task into a bounded next action and drive every task whose authority is complete to `READY_TO_MERGE`. This is an orchestration plan, not a blanket coding handoff: no individual task is code-authorized until its own current-snapshot contract and acceptance matrix exist.
>
> **Snapshot:** review the live `main` and `docs/autopilot-backlog.md` before every cycle. Names, status, dependencies, and line numbers in this document are routing hints; the repository is the authority.
>
> **Classification:** program-control document. It may authorize investigation, packet authoring, and the selection of a task. Only an individually validated slice packet authorizes code.

---

## 1. Outcome and definition of done

The initial objective is not "one huge branch". It is to make the entire remaining project executable by Claude Code without repeatedly asking the owner to manage routine work.

The program is complete only when each active backlog task has exactly one current terminal or actionable state:

| State | Meaning |
|---|---|
| `READY_TO_MERGE` | One bounded branch has passed its declared verification and independent review; the owner may merge it. |
| `AWAIT_OWNER` | A material decision is genuinely absent. The task has one recommended option, evidence, and a binary resume condition. |
| `AWAIT_EXTERNAL` | A provider, legal, production, credential, deploy, or other external action is required; implementation remains dark/fail-closed. |
| `HALT_RESLICE` | The design or scope is unfit. Preserve evidence and create a fresh, narrower successor from current `main`. |
| `SUPERSEDED` / `MERGED` | Derived from current repository evidence, never asserted by prose alone. |

`READY_TO_MERGE` is deliberately not merge, deploy, enablement, secret rotation, or proof from real traffic. Those remain owner/external actions.

---

## 2. Operating idea

Run this as a **continuation program**, in small cycles, rather than as a single linear session or a single integration branch.

1. Freeze one fresh `origin/main` SHA and reconcile the backlog against that SHA.
2. Build a dependency graph from every non-terminal backlog row, including invariant collisions and cross-repo dependencies.
3. For every runnable root, Claude authors or refreshes a task packet from live code and authority.
4. A packet that reaches code readiness is implemented in its own worktree and taken to `READY_TO_MERGE`.
5. A packet missing a material decision becomes a concise `AWAIT_*` record; Claude continues with other roots rather than stopping the program.
6. After a merge, re-freeze `main`, prove the dependency landed, then open its dependent tasks from that fresh base.
7. Repeat until no active row is unclassified.

The program owns scheduling, diagnosis, normal design choices derivable from the repository, packet authoring, verification, and review. The owner supplies only material policy decisions, production/external authority, final merge, and deploy.

### The non-negotiable execution boundary

This plan does not depend on any one prose template. It does preserve the controls that make autonomous execution trustworthy:

- one bounded mechanism per writing slice, one writer and one explicit-base worktree;
- no shared migration, schema invariant, money model, permission model, or generated artifact in parallel;
- a current task contract with positive and negative scope, dependencies, expected tests, and stop conditions;
- real repository verification plus the pinned independent code review; security review for money, identity, permissions, schema, secret, public-data, or external-input work;
- review findings fixed only within the hard breaker limits; a breaker creates `HALT_RESLICE`, not a sixth repair round;
- task status is derived from merged evidence, never hand-flipped because a branch or a note exists.

The old "one branch, review once at the end" approach is rejected. It makes a finding in an early shared primitive invalidate several later milestones and cannot prove which dependency a later task actually consumed.

---

## 3. Program bootstrap — every cycle

The conductor starts a cycle by doing the following read-only work before any writer begins:

1. Fetch and pin `origin/main`; record its full SHA in the cycle ledger.
2. Read the live-truth block in `docs/00-start-here/HANDOFF.md`, the decision summary and the relevant decision bodies, `docs/features/README.md`, the backlog, active worktrees, and existing packets/manifests.
3. Reconcile backlog rows against merged probes and inspect every row’s declared dependency. A dependency absent from an in-flight list is not landing proof.
4. Build a graph whose nodes are active rows and whose edges include `depends_on`, shared file scope, schema/migration tails, money, authz, identity, public-read-model, and cross-repo contract invariants.
5. Write/update a compact cycle ledger: base SHA, parsed backlog roster, the intake roster in §5.1, selected roots, parked tasks, decisions made, and the exact searches used. The ledger is an audit trail, not an authority that can override source.

If the default branch advances after intake, do not rebase an active slice. Compare its scope against the new base; if the base or its declared dependencies changed materially, stop that slice and re-intake a successor.

---

## 4. How Claude handles every backlog status

| Backlog status | Claude’s next action | It may code when |
|---|---|---|
| `ready` | Re-verify the packet, dependencies, base, scope, and acceptance matrix against live `main`. | The fresh packet is still code-ready. |
| `planned` | Author the missing task contract and acceptance matrix from current authority. | The authoring phase closes every in-scope question. |
| `idea` | Research only the bounded mechanism; either author a packet, split it, or produce one `AWAIT_OWNER` decision record. | Never merely because the idea is well described. |
| `blocked` | Identify whether its named prerequisite is an active Plexco task. Execute that prerequisite first; otherwise create `AWAIT_EXTERNAL`. | Only after all declared blockers have landed or been resolved. |
| `deferred` | Retain the negative scope and resume only on its named trigger. | Never opportunistically. |

### Decision authority

- **Derivable:** existing code, migration, accepted decision, reviewed contract, or direct precedent answers it. Claude decides, records evidence, and continues.
- **Reversible and local:** Claude chooses the best option, records alternatives and rollback, and continues.
- **Reserved:** a new/changed money, identity/PII, permission, reviewed-contract, schema-semantic, enablement, secret, merge/deploy, or out-of-scope decision. Claude parks only that task as `AWAIT_OWNER` with a recommendation and continues other roots.

---

## 5. Full current roster

The roster is intentionally complete so no task is silently forgotten. At the snapshot used to create this plan: **2 ready, 6 planned, 37 idea, 6 blocked, and 1 deferred** — 52 task records. The backlog's `<slug>` status legend is not a task. The conductor must re-derive this count each cycle.

| Stream | Current tasks |
|---|---|
| **Ready roots** | `dd108-mirror-readiness-evidence-keys-to-canonical`; `docs-impact-policy-contract` |
| **Planned — author then gate** | `chat-identity-merge-reparent-enablement`; `reconcile-hand-closed-entries-never-age-out`; `local-dev-sanctioned-paths-are-harder-than-the-forbidden-one`; `gates-that-fire-correctly-and-cannot-say-why`; `breaker-counts-infra-flakes-as-fix-rounds`; `chat-shared-message-command-core` |
| **Product and platform ideas** | `auth-provider-google-email-swap`; `feature-identity`; `feature-billing-lifecycle`; `feature-cross-club-join`; `feature-marketplace-discovery`; `web-app-shell`; `core-matcher-ambiguous-consumer-wiring`; `tenant-capability-authority-core`; `dd104-delete-session-ratification`; `db-zalo-bots-secret-hardening`; `infra-do-app-vpc-deployment` |
| **Jobs, projection, and runtime ideas** | `job-scheduler-cron-registration`; `job-consumers-per-feature`; `job-infra-public-projection-reconciliation`; `db-projector-dlq-no-replay-path`; `job-outbox-dispatch-sync-lag-slo`; `db-app-worker-least-privilege-attestation`; `dev-app-worker-password-not-restored` |
| **Chat, AI, and identity ideas** | `chat-dm-safety-audit-queryable-path`; `docs-chat-spec-embed-group-scope-reconcile`; `dd18-embedding-candidate-active-multiprofile`; `dd18-profile-activation-cas-boundary`; `dd18-embedding-provider-profile-equality`; `test-harness-acquire-chat-definer-lock-leaks-client-on-error` |
| **Kit, review, and workflow ideas** | `classifier-blocks-kit-mandated-readiness-json`; `codex-review-verdict-nondeterminism`; `infra-autopilot-templates-mirror-v061`; `ap-merge-test-and-clean-tree-scope`; `ap-finish-squash-verify-defeated-by-closeout-order`; `precondition-halt-and-hashlock-force-full-rebuild`; `launcher-register-path-authored-to-runtime`; `codex-review-pin-worktree-isolation-defect`; `backlog-status-taxonomy-inflight-manual-close-gap`; `ap-finish-untracked-counts-as-dirty`; `scope-gate-plants-terminal-signals-on-retryable-register` |
| **Docs and quality ideas** | `pnpm-workspace-postcss-override-inert`; `docs-feature-index-version-freshness-check` |
| **Blocked / external- or dependency-first** | `infra-egress-compatibility-evidence`; `apipay-signed-body-reconciliation`; `email-provider-c7-evidence`; `email-password-bundle-order-4`; `session-publish-public-projector`; `session-commands-update-close-cancel` |
| **Deferred** | `docs-core-classifier-decision-table-lift` |

### 5.1 Intake roster — findings not yet represented by a backlog task

The parsed backlog is not the whole program boundary. Every known unrepresented finding receives an
intake record below. An intake record prevents loss; it is **not** permission to create a code task
or to mutate the backlog before its claim has been re-proven on the pinned base.

| Intake ID | Current evidence and classification | Automatic next action | Promotion condition |
|---|---|---|---|
| `intake-update-session-noop-version` | **Decision probe, not a confirmed defect.** The current `updateSession` deliberately validates `expectedVersion` before the no-op branch, so malformed versions cannot bypass validation. | Re-read the owner authority and the close/cancel precedents; produce a decision probe comparing the two contracts. | A decision explicitly changes the update no-op contract, then a bounded code task may be authored. |
| `intake-session-command-barrel-exports` | **Discovery.** The desired export surface is named, but consumer/import evidence is not yet pinned. | Locate all command consumers and current barrel exports; author a mechanical P2 task only if a missing public boundary is proven. | Exact export list, consumers, and regression test are pinned. |
| `intake-route-test-app-db-stubs` | **Confirmed test-harness debt.** Three session route tests return unusable `appDb().db` stubs. | Author one narrow test-harness task with the three exact files and a test proving stderr is eliminated without weakening route assertions. | Focused test plan and no shared harness collision. |
| `intake-dd118-person-language-drift` | **Confirmed contract drift.** The user-settings tech spec says `persons.language` wins, while the current route passes `null` because that column does not exist. | Author a docs-contract reconciliation task against DD-118 and the live tenant-locale path; do not add a person-language field. | Reviewed contract states the current behavior and names any future schema dependency separately. |
| `intake-doc-mirror-reconcile` | **Mechanical reconciliation, split by owner.** DD index, BUILD-STATUS, runner references, source comments, DBML, Docker, and README are not one mechanism. | Create separate bounded docs tasks by mirror owner; each is source-compared before edit. | Each task has an exact mirror set and an authoritative source. |
| `intake-lifecycle-forensics` | **Forensics, not cleanup.** The old reservation, two existing worktrees, and the stray state directory exist on disk, but existence does not prove they are safe to remove. | Inspect branch tips, landed proof, active process/reservation state, and lifecycle records. | A normal finish/disposition proof exists; only then may the lifecycle owner clean up. |
| `intake-zalo-secret-scope` | **Scope revalidation.** The existing backlog row names `zalo_bots.secret`, while current tracked fixtures use `bot_token_enc`. | Trace every real Zalo credential reader/writer and identify the stored field and provider requirement before choosing KMS, hash, or rotation behavior. | A live credential path and owner-approved security contract are pinned. |

At each cycle, the conductor parses the backlog **and** this intake roster. It promotes only
confirmed records one at a time, with a unique task ID, risk, dependency, owner, scope, negative
scope, acceptance matrix, and merged probe. This preserves the original objective — no forgotten
work — without treating a stale measurement or a product choice as an implementation instruction.

---

## 6. Dependency order and parallelism

### Wave 0 — establish a trustworthy runway

1. Run the read-only bootstrap and resolve duplicate/stale roster classification.
2. Run `dd108-mirror-readiness-evidence-keys-to-canonical` in the **canonical Claude template repository**, as its own P1 lane. It does not share a Plexco branch.
   **It is first because it has a destruction clock, not because kit work outranks code.** Measured 2026-08-26: `autopilot/parallel/autopilot-update.sh:35` lists `autopilot-review-readiness.mjs` in `pack_pairs`, `:178` is `cp "$KIT/$src" "$dst"` — a straight overwrite, not a merge — and `grep DYNAMIC_SEGMENT` across the canonical kit returns **zero**. The validator fix lives only in this consumer; the next kit update deletes it. Re-derive all three before relying on them. Two consumers share that mirror (this repo and `Bestminton Club Payment check bot`), so the owner's sync step runs **serially**, never both at once.
3. Do not update Plexco or any consumer mirror until canonical K1 is merged and the owner explicitly performs the consumer synchronization step.
4. In Plexco, independently revalidate and run `docs-impact-policy-contract` if its fresh packet remains code-ready. It is P1 despite being documentation because it controls a money-path contract.

### Wave 1 — author the graph, not speculative code

For every planned/idea root with no unresolved hard dependency, spawn a read-only authoring task. It must produce one of:

- a code-ready packet with an exact mechanism, file scope, negative scope, acceptance rows, and dependency proof; or
- `AWAIT_OWNER` / `AWAIT_EXTERNAL` with a single recommended option and binary trigger; or
- `HALT_RESLICE` when the proposed task actually contains multiple mechanisms.

Authoring may run in parallel only when it edits no shared authority document. Backlog and decision-log updates are serialized by the conductor.

### Wave 2 — run code-ready roots to `READY_TO_MERGE`

The conductor selects the lowest unbuilt dependency root, not the most attractive feature. It may run file- and invariant-disjoint P2 tasks in parallel. It serializes all P1 schema, grants/RLS, money, identity, public-data, and shared-core work.

Current known dependency chains to preserve:

- canonical-kit fixes → owner-performed consumer sync → any consumer task that relies on the fixed gate;
- capability registry / plan entitlements → `tenant-capability-authority-core` → `chat-shared-message-command-core`;
- job runtime dispatcher → scheduler/consumer/reconciliation work; scheduler must not enable production cron before its downstream safety contract exists — turning the schedule on is the named re-enable trigger for the announce route under DD-56 clause 1, so it converts `{announced:true}` into a promise to real users. And no consumer may assume per-aggregate outbox ordering: the outbox does not provide it (`0023:176-208`);
- identity authority → billing lifecycle and cross-club join;
- session aggregate substrate → public projector; the projector stays blocked until live occupancy, confirmed-count, holds, and alias prerequisites exist. Its write path goes through a definer function or its own writer role — **re-granting `app` base `SELECT` on `public_sessions` reopens exactly the hole migration `0033` closed**;
- the email/password order-4 release unit must be re-sliced into its missing DB, route, and delivery prerequisites before implementation.

### Wave 3 — unblock external and owner-owned work

Create one concise owner/external packet per blocker, never a speculative branch:

- P0 deployment/provider/email/ApiPay work requires explicit external authority and evidence.
- `db-zalo-bots-secret-hardening` requires the KMS/secret-use/rotation decision before a schema choice.
- enablement (`OUTBOX_DISPATCH_SCHEDULE_ENABLED`, auth-provider go-live, secret rotation) remains dark until separately authorized.
- any legal or production-traffic assertion remains `AWAIT_EXTERNAL` until the named evidence exists.

When an owner resolves one decision, the conductor re-opens only its dependency blast radius, not the entire program.

---

## 7. The reusable Claude Code execution brief

For each selected task, the conductor gives Claude Code this task-specific brief, populated from fresh repository truth:

```text
OUTCOME: <one observable task result>
BASE: <full current main SHA>; do not rebase this run.
AUTHORITY: <exact decisions, specs, code, migrations, tests, and prior landed probes>
MECHANISM: <one symbol/module>
SCOPE: <exact files and behavior>
NEGATIVE_SCOPE: <tempting adjacent systems explicitly excluded>
DEPENDENCIES: <landed proofs, not status prose>
RISK: <P0–P3>; AUTONOMY: autonomous_to_ready unless a reserved decision appears.

Before writing: search the repository for the mechanism, callers, invariants, and dependent docs.
Log the queries and read the material hits. Decide derivable or reversible local questions and log why.
For a reserved decision, write AWAIT_OWNER with one recommendation and continue no further in that task.

Implement only in one explicit-base worktree with one writer, never the shared root working copy:
sessions share one .git/index here, and commit eba1c27 landed one session's files under another
session's message. A commit that must reach main also needs the root lock AND PLEXCO_COMMIT_OWNER
exported in the SAME shell — ap-merge makes a root commit, so a missing export kills the ceremony
AFTER the squash is already staged.

RUNTIME-ROLE PROBE — MANDATORY FOR A TASK THAT ADDS OR CHANGES A PRODUCTION DATABASE PATH.
Before that task's own tests, execute one query or call AS THE PRODUCTION ROLE (`app`) against the
real cluster, exercising the changed path, with a known-true control in the SAME query so a silent
zero is distinguishable from a silent failure. Record it verbatim. On 2026-08-26 a lane was green on
lint, typecheck, format and 1,191 tests while its production path could not execute at all, because
the suite runs as the test superuser and production runs as `app`.

For docs-only, kit-only, pure-static, or non-DB tasks, record `RUNTIME_ROLE_PROBE: NOT_APPLICABLE`
with the task-specific proof instead (for example, a byte-identical mirror check, parser fixture,
or validator test). Never invent an `app` query for a task with no runtime database path.
Never write an assertion that passes under total failure — `value === null || typeof value ===
"string"` passes when everything is broken.

Verify with focused tests plus the repository's canonical test/lint/typecheck/build commands.
`pnpm run lint` is eslint across the repo; `pnpm -r run lint` DOES NOT EXIST and a missing script
looks identical to a failing check from outside.
For schema, grants/RLS, money, identity, public data, secret, or external-input changes, also run a
security-focused independent review.
Run the pinned independent code review. Fix accepted findings within the bounded breaker rules.
Finish exactly READY_TO_MERGE, AWAIT_OWNER, AWAIT_EXTERNAL, or HALT_RESLICE with paths to evidence.
Never merge, deploy, enable a feature, rotate a secret, or change an out-of-scope reviewed contract.
```

The brief deliberately describes outcomes and proof rather than copying an older lifecycle prompt. The repository’s current scripts remain the source of truth for the actual commands and evidence artifacts.

---

## 8. Review, integration, and program reporting

Every `READY_TO_MERGE` task carries:

- exact base and task branch;
- non-empty declared diff, verification output, and test data strategy;
- the runtime-role probe output, verbatim — the one artifact a reader cannot reconstruct;
- pinned independent review result bound to the actual diff, quoting the LAST verdict line of each
  transcript, never the first: every transcript carries `VERDICT: FINDINGS` near the top because the
  prompt enumerates the legal tokens, so a first-match grep returns the inverse of the truth;
- security review when risk requires it;
- dependency landing proof and any new blocker discovered;
- a clean handover containing merge order and enablement boundaries.

The conductor does not combine unrelated tasks merely to reduce review count. For independent ready branches, it may use an ephemeral integration worktree to test compatibility; dependent work starts only after its predecessor is merged and re-proven on fresh `main`.

At the end of each cycle, publish a program report with:

1. refreshed roster counts and base SHA;
2. branches at `READY_TO_MERGE`, in merge order;
3. tasks still authoring, and the next automatic action;
4. all `AWAIT_OWNER` and `AWAIT_EXTERNAL` items, each with recommendation and binary resume condition;
5. HALTed tasks, their preserved evidence, and successor design;
6. changes to the dependency graph or decision ledger.

---

## 9. Evidence consulted when designing this conductor

The useful parts of the Plexco and DKB direct-run prompts are retained: explicit outcome, negative scope, fresh-base re-derivation, design probes for consequential mechanisms, real verification, decision logging, and honest handover.

Their unsafe assumption is not retained: a long-lived multi-milestone branch with review only at the end is not a reliable route to autonomous readiness in a dependency-heavy repository. This conductor preserves the initial velocity objective by keeping other independent tasks moving whenever one task is parked, rather than by hiding dependencies in one branch.

---

## 10. Program acceptance matrix

| ID | The program is acceptable only if | Evidence at each cycle |
|---|---|---|
| PC-1 Coverage | Every active backlog task and every §5.1 intake record has exactly one next state or terminal disposition. | Parsed task count, intake ledger, and no unclassified row. |
| PC-2 No invented implementation | No code task starts from an idea, prose finding, or stale line number alone. | Its packet names current authority, a bounded mechanism, negative scope, and acceptance rows. |
| PC-3 Dependency order | A dependent writer starts only from a freshly pinned main containing the required landed proof. | Base SHA plus same-order dependency proof. |
| PC-4 Safe autonomy | A reserved decision parks one task, not the program; independent roots continue. | Cycle report lists each `AWAIT_*` item and the selected next roots. |
| PC-5 Evidence before merge | Every `READY_TO_MERGE` branch has exact diff, verification, applicable runtime proof, independent review, and security review when required. | Task handover packet. |
| PC-6 Honest external boundary | Deploy, enablement, secret, legal, provider, and production-traffic work is never represented as merged code readiness. | `AWAIT_OWNER` / `AWAIT_EXTERNAL` record with a binary resume condition. |
| PC-7 No unreferenced claim | Every status line this program emits names the check that produced it. A field with no referent reads `NOT_APPLICABLE` and says why. | Each verdict field maps to a PC row, a named artifact, or an explicit `NOT_APPLICABLE` reason. |

---

## 11. First cycle

1. Freeze `main`, reconcile the 52 active task records, and exclude the backlog schema legend from the count.
2. Re-prove every §5.1 intake record. Promote only confirmed, implementation-shaped records one at a time; write a decision probe or lifecycle-forensics record for the others.
3. Start K1 only in the canonical kit repo; independently re-check `docs-impact-policy-contract` in Plexco.
4. Author packets for eligible planned/idea roots. Serialize all edits to the backlog or decision log; parallel authoring remains read-only until each writer has disjoint output.
5. Run only fresh code-ready roots, report `READY_TO_MERGE`, `AWAIT_*`, and `HALT_RESLICE`, then schedule the next roots from the refreshed graph.

No file in this program may claim that all 52 current tasks are implementation-ready today. The program succeeds by making that statement true task by task, with evidence.

---

## 12. Program-plan verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: PLAN_READY
REVIEWED_AT: 2026-08-26
AUTHORITY_SHA: da43f60bb8ab9ce19db043295b0081e0b2dc939a
BASE_BRANCH: main
TARGET_FILES:
  - docs/sessions/2026-08-26-plexco-DIRECT-RUN.md
SLICE: plexco-continuation-program-control
IN_SCOPE: backlog-wide orchestration, packet-authoring order, and automatic execution to per-task READY_TO_MERGE
OUT_OF_SCOPE: code authorization for any un-authored slice; merge, deploy, enablement, secret rotation, and owner-reserved decisions
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY: owner and external actions remain parked per task
HARD_DEPENDENCIES: current backlog reconciliation and per-task packet verification
PRIOR_SLICES: none; selected implementation starts only after its own packet passes readiness
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: merge, deploy, provider/legal evidence, secrets, and production enablement
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: NOT_APPLICABLE  # program-control document: no migration, no security surface. Per-task gate is PC-5.
IMPLEMENTATION_ARTIFACTS: NOT_REQUIRED_FOR_PLAN_READY
FIRST_IMPLEMENTATION_STEP: re-verify dd108-mirror-readiness-evidence-keys-to-canonical in the canonical kit repository
REMAINING_BLOCKERS: none for program planning; task-specific blockers are classified by the conductor

NOTE: these PASS values evaluate the program-control contract and PC-1..PC-7, not any child task's
      implementation. A child remains non-runnable until its own current-snapshot packet passes its
      own readiness gate.
      SECURITY_AND_MIGRATION_GATE reads NOT_APPLICABLE rather than PASS because no PC row evaluates
      a migration or a security surface here, and a PASS printed in gate format for a check with no
      referent is the exact failure class PC-7 exists to prevent. Per-task security and migration
      review is enforced by PC-5 inside each child packet, not by this file.
```
