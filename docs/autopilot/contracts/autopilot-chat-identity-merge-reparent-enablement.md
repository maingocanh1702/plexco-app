<!-- review-readiness: enforce -->
# chat-identity-merge-reparent-enablement — task contract

> **Slice:** `chat-identity-merge-reparent-enablement` (slug = mechanism: open a provably-authorized,
> merge-scoped path for Person-merge to re-parent chat rows, plus `DEFERRABLE` FKs).
> **Risk:** P1 · **Change class:** schema (identity) · **Autonomy:** supervised.
> **Opened from:** DD-103 (owner-final 2026-08-11).
> **Authored:** 2026-08-11 against `origin/main` @ `37c6f8bc3fc4d2b2d15416adeed2138d1f0e8262`.
> **Manifest:** `docs/autopilot-manifests/chat-identity-merge-reparent-enablement.json`.
> **Launcher:** `.claude/commands/ap-54-chat-identity-merge-reparent-enablement.md`.
> **Verdict:** `NOT_CODE_READY` — blocked on the non-existent Person-merge transaction (§7). This is an
> `enforce` evidence artifact + design direction, **not** a coding handoff. Do not open a worktree.

## 0. Task contract (level3-workflow §3)

```text
TASK_ID: plexco:chat-identity-merge-reparent-enablement
OUTCOME (target): a Person-merge transaction can re-parent chat_members / chat_channels / chat_messages
  onto the canonical person, while the security bypass 0031 closed stays closed for every other caller.
REPOSITORY_AND_BASE: plexco-app @ origin/main (authored at 37c6f8b). No base is pinned for building —
  the slice is blocked.
CONTEXT_SOURCES: DD-103 (decisions.md); 0031_chat_schema_core.sql (triggers 209-237, FKs 93/113/148,
  prereq unique 53-54); feature_inapp_chat_tech.md rows 10/11; identity-model.md:234-237; backlog task.
APPLICABLE_SKILLS: none resident; the Person-merge transaction design is the missing input.
SCOPE (intended, not authorized): one new migration recreating the two immutability triggers with a
  merge-role-gated bypass + FK -> DEFERRABLE INITIALLY IMMEDIATE; schema.ts mirror; deferred-transaction
  regression test; mechanical migration-count literals; README; this contract + manifest + backlog.
NEGATIVE_SCOPE: no unconditional trigger removal; no app-settable authorization; no app write on
  person_id/dm_key/author_person_id; no standalone build ahead of Person-merge; no in-place 0031 edit;
  no spec rewrite to 'tombstone'.
RISK: P1
AUTONOMY_MODE: supervised
MODEL_POLICY: planner=primary-agent; worker=assigned-agent; reviewer=scripts/codex-review-pin.sh (2 clean
  code rounds + 1 security round); fallback=HALT_TOOL_UNAVAILABLE.
SANDBOX_AND_PERMISSIONS: network none; secrets none; external side effects none.
HUMAN_DECISIONS_REQUIRED: none pending — DD-103 already decided (defer to the Person-merge slice). The
  blocker is a missing dependency, not a missing owner decision.
SLICE_GRAPH: hard-depends on dd38-dd86-chat-schema-core (MERGED, 0031) AND on a Person-merge transaction/
  role that DOES NOT EXIST. Serializes against chat-dm-safety-config-single-read (shared migration tail /
  backlog / test literals) — that slice goes first; this one is blocked.
WORKTREE_PLAN: none now. When unblocked, it is a portion of the Person-merge slice's own worktree, not a
  separate one (DD-103 hard constraint).
VERIFICATION: deferred — the concrete checks depend on the merge transaction shape (see §6).
CODE_REVIEW: required (2 clean rounds) when eventually built.
SECURITY_REVIEW: required — deliberately reopens a trigger that closed a real bypass (§5, manifest).
BUDGETS: to be set with the Person-merge slice; fix_rounds_max 5.
STOP_CONDITIONS: opened standalone · designed against a non-existent merge transaction · app-settable
  authorization (see manifest stop_conditions).
DELIVERABLES (when unblocked): the escape-hatch migration, DEFERRABLE FKs, deferred-transaction test,
  green suite, 2 clean code rounds + 1 security round — all inside the Person-merge slice.
```

## 1. Why this slice exists — DD-103's accepted structural gap

DD-103 (decisions.md, owner-final 2026-08-11) accepts a **structural** gap in `0031_chat_schema_core`
and moves the obligation to fix it onto the Person-merge slice with a hard constraint. It waives no
finding and loosens no gate.

## 2. The gap, exactly — three barriers in `0031`

`packages/db/migrations/0031_chat_schema_core.sql`:

```text
209-217  chat_members_identity_immutable   -- BEFORE UPDATE OF channel_id, person_id -> RAISE unconditionally
227-237  chat_channels_identity_immutable  -- BEFORE UPDATE OF kind, tenant_id, dm_key -> RAISE unconditionally
 53-54   memberships_id_person_tenant_uq   -- UNIQUE(id, person_id, tenant_id) — the composite FK target
 93-94   chat_channels_created_by_membership_fk  FOREIGN KEY (...,created_by_person_id,tenant_id)  -- NOT DEFERRABLE
   113   chat_members_membership_fk              FOREIGN KEY (membership_id,person_id,tenant_id)   -- NOT DEFERRABLE
   148   chat_messages_membership_fk             FOREIGN KEY (membership_id,author_person_id,tenant_id) -- NOT DEFERRABLE
    95   chat_channels_dm_key_uq                 UNIQUE (dm_key)  -- dm_key encodes least(a,b):greatest(a,b)
```

To merge person B into canonical A a real re-parent must change `chat_members.person_id` (B→A) and the
DM channel's `dm_key` (which contains B). Both changes are **blocked outright** by the immutability
triggers. Even past the triggers, the non-`DEFERRABLE` composite FKs check immediately, so you cannot
repoint `memberships` and the dependent chat rows in the same transaction — there is no consistent
intermediate state. That is why DD-103 calls it *structurally impossible*, not unimplemented.

**A subtlety the future slice must not miss:** `chat_messages.author_person_id` (0031:126, references
`persons`) and `chat_channels.created_by_person_id` are part of composite FKs but have **no**
immutability trigger — so a merge must repoint them too, guarded only by the (non-deferrable) FK. The
guards across the three tables are **heterogeneous**; the escape hatch is not one trigger edit.

## 3. Design direction to argue for (per the task, NOT finalized here)

The task asks for "a narrowly-scoped, provably-authorized path plus `DEFERRABLE` on the FK, stating
exactly who may take it and how authorization is proven at the database level." The direction:

- **Who may take it:** only a dedicated **Person-merge role** (e.g. `person_merge_definer`), reached
  only via a `SECURITY DEFINER` merge function owned by that role. Never `app` (NOBYPASSRLS runtime),
  never a bot/session role.
- **How authorization is proven at the DB level:** the recreated immutability triggers allow the
  identity-changing UPDATE **only when `current_user` equals the merge role**. Postgres enforces
  `current_user`; the application cannot forge it — it can reach that role only through the privileged
  `SET ROLE` or by calling the owner's `SECURITY DEFINER` function. Every other caller still hits the
  `RAISE EXCEPTION`, so the bypass 0031 closed stays closed. **This is why an app-settable signal is
  rejected:** a custom GUC (`SET LOCAL app.merge_authorized = on`), a session variable, or an
  application-layer check can be set by any session, so it proves nothing at the DB boundary. Role
  identity is the only DB-provable authorization.
- **FK change:** the composite FKs to `memberships` that the merge repoints → `DEFERRABLE INITIALLY
  IMMEDIATE`, so the merge transaction issues `SET CONSTRAINTS ALL DEFERRED` and the FK is validated
  once at `COMMIT` — normal transactions are unaffected (still effectively immediate).
- **Regression test:** re-parent inside one **deferred** transaction, asserting (a) the merge role
  succeeds, (b) `app`/any non-merge role still raises, (c) the DM exactly-2-members guard and
  `dm_key` consistency hold at `COMMIT`.

This direction is the recommended shape to bring INTO the Person-merge slice; it is not code-ready
because the exact predicate/columns/FK-set depend on the real merge transaction (§7).

## 4. Dependencies

| Dependency | Type | Status |
|---|---|---|
| `dd38-dd86-chat-schema-core` (`0031`) | `MERGED` (the schema this slice amends) | landed `3b3bb091205564e181f5c077a7e3390388a31e31`; symbol `chat_members_identity_immutable` absent in `packages/` at dep base `6f63c7d`, present at landed. |
| Person-merge transaction / merge role | `MISSING` (blocking) | **Does not exist.** Zero `mergePersons`/`merge_persons`/`mergeIdentity`/`person_merge` in `packages`/`apps` (verified 2026-08-11). No merge role, no merge function, no merge sequence. The parent node already exists: `feature-identity` (P0, backlog) whose notes name the `merge/claim mutation` split — this slice is recorded there as a hard precondition of that split; **do not create a new person-merge placeholder** (it would duplicate an existing node). |

## 5. Security review focus (required when built)

This slice deliberately opens a hole in a trigger pair that closed a real bypass. The security round
must prove the hole is exactly as wide as an authorized merge and no wider — items (1)–(4) in the
manifest `security_review.reason`: role-gated success only (with a test that `app`/a non-merge role
still raises), DM-2/`dm_key` invariants preserved at `COMMIT`, `DEFERRABLE` not leaving dangling refs
for ordinary transactions, and `app` retaining zero write on the identity columns.

## 6. Why acceptance/verification cannot be pinned now

The deferred-transaction regression test needs the real merge transaction to run against (which merge
function, which role, which repoint sequence, how a `dm_key` UNIQUE collision — two DMs for the same
pair collapsing to one — is resolved). None of that exists. Fabricating placeholder checks would be
inventing a design the owner deferred (DD-103) and manufacturing machine-checkable evidence for an
un-authored slice, which the readiness gate §11.2 forbids. The manifest `verification.focused` is
therefore honestly empty.

## 7. Canonical readiness verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-08-11
AUTHORITY_SHA: 37c6f8bc3fc4d2b2d15416adeed2138d1f0e8262
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot/contracts/autopilot-chat-identity-merge-reparent-enablement.md
  - docs/autopilot-manifests/chat-identity-merge-reparent-enablement.json
  - .claude/commands/ap-54-chat-identity-merge-reparent-enablement.md
  - docs/standards/decisions.md
  - packages/db/migrations/0031_chat_schema_core.sql
  - docs/features/BE/feature_inapp_chat_tech.md
  - docs/00-start-here/identity-model.md
  - docs/autopilot-backlog.md
SLICE: chat-identity-merge-reparent-enablement
IN_SCOPE: the specified schema-enablement target — recreate chat_members_identity_immutable and chat_channels_identity_immutable to allow the identity-changing UPDATE only when current_user is a dedicated Person-merge role; alter the composite FKs to memberships to DEFERRABLE INITIALLY IMMEDIATE; a deferred-transaction re-parent regression test that also proves app/non-merge roles still raise; mechanical migration-count literals; README; this contract, manifest, backlog entry.
OUT_OF_SCOPE: no unconditional removal or weakening of the two triggers; no app-settable authorization signal; no app write on person_id/dm_key/author_person_id/created_by_person_id; no in-place edit of 0031; no spec rewrite to tombstone; no standalone build ahead of the Person-merge slice.
G1_DECISION: FAIL
G2_SPEC: PARTIAL
G3_DEPENDENCY: FAIL
G4_TEST: FAIL
G5_SCOPE: PARTIAL
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: dd38-dd86-chat-schema-core (0031) merged at 3b3bb091205564e181f5c077a7e3390388a31e31; the Person-merge transaction/role is MISSING (zero implementation) and is the blocker.
PRIOR_SLICES: a Person-merge slice must exist first and absorb this one (DD-103 hard constraint); it does not yet exist.
OPEN_QUESTIONS_IN_SCOPE: 4
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PARTIAL
CLOSURE_MATRIX: FAIL
ACCEPTANCE_MATRIX: FAIL
SECURITY_AND_MIGRATION_GATE: PARTIAL
IMPLEMENTATION_ARTIFACTS: FAIL
FIRST_IMPLEMENTATION_STEP: blocked — do not open a standalone worktree; the escape-hatch migration, DEFERRABLE FK and deferred-transaction test are authored inside the Person-merge slice when it exists, along the §3 design direction.
REMAINING_BLOCKERS:
  - blocker: the Person-merge transaction, merge role and repoint sequence do not exist (zero mergePersons/merge_persons/mergeIdentity in packages/apps), so the trigger predicate (which current_user), the exact repointed column set (person_id, author_person_id, dm_key, created_by_person_id) and which composite FKs to defer cannot be pinned.
    owner: Person-merge / Identity slice (P3.5)
    resolution: a Person-merge slice/spec exists on origin/main defining the merge role and transaction, against which the escape hatch and deferred-transaction test can be designed and asserted.
  - blocker: DD-103 requires the escape hatch, DEFERRABLE FK change and deferred-transaction test to land in the SAME slice as Person-merge; a standalone enablement slice contradicts owner-final authority.
    owner: DD-103 (owner) / Person-merge slice
    resolution: this contract is consumed as the schema-enablement portion of the Person-merge slice rather than run independently.
  - blocker: the dm_key UNIQUE (0031:95) collision when both persons already share a DM with the same peer (two DM channels must collapse into one) is an unresolved merge-conflict rule with no owner outside the merge transaction.
    owner: Person-merge / Identity slice (P3.5)
    resolution: the Person-merge design pins the dm_key-collision merge rule (which channel survives, how the losing channel's members/messages fold in), following the pay_code DD-02 and money "combine two state records" precedents.
NEXT_REVIEW_TRIGGER: a Person-merge slice/spec (a merged or in-design mergePersons/merge_persons transaction defining the merge role and repoint sequence) appears on origin/main; re-open this contract and finalize the escape-hatch DDL + tests against it.
```

### Closure matrix (why it is not 12/12)

| # | Gate | Evidence | State |
|---|---|---|---|
| 1 | Authority pinned by SHA + paths | `37c6f8b…` + §7 target files | PASS |
| 2 | In-scope decisions closed | DD-103 owner-final, but it DEFERS the escape-hatch design | FAIL |
| 3 | Scope IN/OUT + owner | §3/§7 direction pinned; standalone boundary disputed by DD-103 | PARTIAL |
| 4 | Dependencies classified | §4 — 0031 MERGED; Person-merge MISSING | FAIL |
| 5 | Live schema/code matches doc | §2 quotes 0031 verbatim (triggers 209-237, FKs) | PASS |
| 6 | Data/API/state/auth contract | direction only; exact predicate/columns depend on merge txn | PARTIAL |
| 7 | Fail-closed/idempotency/order | role-gated bypass direction set; not proven against a real txn | PARTIAL |
| 8 | In-scope open questions = 0 | 4 open (role, column set, FK set, dm_key collision) | FAIL |
| 9 | Acceptance matrix has expected results | cannot specify without the merge transaction (§6) | FAIL |
| 10 | Migration/security/rollback pinned | direction + security focus set; DDL not finalizable | PARTIAL |
| 11 | First slice hard-deps merged | Person-merge dependency MISSING | FAIL |
| 12 | Implementation handoff ready | intentionally not a runnable handoff | FAIL |
