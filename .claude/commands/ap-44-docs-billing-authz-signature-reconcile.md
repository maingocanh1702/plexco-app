# AP-44 — docs-billing-authz-signature-reconcile: fix a stale signature in a Reviewed spec

`feature_billing_lifecycle_tech.md` §1/§3 still document `authorizeTenantAction(tenantId, actionClass)`.
The merged code (`ddb69a9`, `packages/db/src/authorization.ts:91-95`) is
`authorizeTenantAction(tx, tenantId, actionClass)` — a version that opened its own transaction would
release its `FOR SHARE` locks before the caller could mutate, reopening the race this same §3's
Concurrency clause exists to close (codex round-01 [P1] on `authorize-tenant-action-core`). Code is
right, spec is stale. This slice reconciles the spec — no code change.

## Read before you write

1. `docs/autopilot-backlog.md` task block `docs-billing-authz-signature-reconcile` — full reasoning.
2. `docs/autopilot-manifests/docs-billing-authz-signature-reconcile.json` — scope, negative scope,
   verification. Read the whole file; it is short by design.
3. `packages/db/src/authorization.ts` lines 1-95 — the live signature and its own doc comment, which
   independently explains the same FOR SHARE reasoning.
4. `docs/features/BE/feature_billing_lifecycle_tech.md` — confirm `Status: Reviewed` at the top before
   touching it. That status is why this is a separate reconcile slice, not an inline edit (CLAUDE.md
   forbids writing directly into a Reviewed spec).

## Registration mechanics — read this before running anything

**Kit v28 changed `register`.** It now HALTs `CONTRACT_INVALID` unless `--manifest` points at the
RUNTIME manifest (`.autopilot/state/<feature>/manifest.json`, carrying
`manifest_schema_version: level3-operational-v2`) — the authored contract under
`docs/autopilot-manifests/` must never carry that field and is REJECTED as a `--manifest` input. If
`register` HALTs, the message names the missing field and the correct path — read it before treating
this as a defect.

**`register` also requires worktree `HEAD` to equal the manifest's `base_sha` exactly** (checked before
anything else). This means: author and register the RUNTIME manifest FIRST, while the worktree is still
sitting untouched at `base_sha` — before writing any tracked file, and before merging or cherry-picking
any prior work back in. A worktree that already carries a commit ahead of `base_sha` at register time
HALTs `BASE_MISMATCH`, a real HALT (`docs-billing-authz-signature-reconcile` hit this once, first-hand,
on 2026-08-03). **The writing agent must never resolve a `HALT-*`/`AWAIT-FOUNDER-*` marker itself** — not
by deleting it, not by renaming it, not because the classification is obviously invocation-class, not
even when the correct fix is already known. Leave the marker exactly as written, report the HALT, and
stop; do not resume without an explicit disposition from the owner/orchestrator. (AWAIT is a different,
narrower thing — a concrete missing decision/context the writer cannot resolve; do not write one just
because a HALT fired. A HALT that never created an INFLIGHT.md block — `register` halting before
`acquire()`, as `BASE_MISMATCH` does — has no lifecycle to formally close via `ap-finish.sh`; that
specific incident's marker was later renamed to `RESOLVED-HALT-BASE_MISMATCH.txt` by the owner, not by
the writing agent, with a prepended resolution note and the original content preserved below it — that
is the pattern to expect, not something this launcher can trigger on its own. A HALT that DID create a
lifecycle needs real disposition through `ap-finish.sh --authorized-close --reason <text>` first.)

```
scripts/autopilot-scope-gate register --manifest .autopilot/state/docs-billing-authz-signature-reconcile/manifest.json
```

After it returns `registered: ... (in-flight)`, CONFIRM the hash-lock actually landed before doing
anything else — `register` printing "registered" is not itself proof:

```
test -f .autopilot/state/docs-billing-authz-signature-reconcile/registered-manifest.sha256 && echo LOCKED || echo NOT_LOCKED
```

**There is no global-emptiness precondition for this slice.** `scope-gate register` already serializes
correctly against other active work by checking this manifest's `scope`/`invariants` for intersection
with other in-flight features (`docs/autopilot-parallel-scope-gate.md`) — Level 3 explicitly supports
multiple parallel non-colliding slices. Do not gate registration on `.autopilot/INFLIGHT.md` having zero
entries or `.autopilot/worktrees/` being empty; that was a one-time eligibility check specific to the
kit v27→v28 mechanism sync (a repo-wide, non-slice operation), not a general precondition for an
ordinary slice like this one, and requiring it here would incorrectly block this launcher from ever
running again once any other slice is in flight.

## Steps

1. Verify `main`'s tip locally and pin it as `base_sha` — no other precondition on registry state.
2. Create worktree `.autopilot/worktrees/docs-billing-authz-signature-reconcile` on branch
   `feat/docs-billing-authz-signature-reconcile` from that exact `base_sha`. Do not add, merge or
   cherry-pick any commit on top yet.
3. Author ONLY the runtime manifest (`.autopilot/state/docs-billing-authz-signature-reconcile/manifest.json`
   — untracked, does not move `HEAD`). Register immediately (see Registration mechanics) while `HEAD`
   still equals `base_sha`. Confirm `registered-manifest.sha256` exists before proceeding.
4. Now author the tracked authored contract
   (`docs/autopilot-manifests/docs-billing-authz-signature-reconcile.json`) and fix ALL FIVE
   current-state occurrences in `feature_billing_lifecycle_tech.md`, not just the two obvious ones:
   §1 overview diagram, §3 Status Authority heading, §2 edge case #8, and §5 test cases #29-30 —
   `(tenantId, actionClass)` / `(tenantId, 'publish_new_sessions')` →
   `(tx, tenantId, actionClass)` / `(tx, tenantId, 'publish_new_sessions')`. This slice's own
   `verification.focused` only asserts 2 of the 5 (hash-locked at register time — it cannot be extended
   after; codex round-02 [P2] caught the other 3 by direct review, not by the focused checks). Do not
   treat "focused checks pass" as proof of completeness for this file — run
   `grep -n 'authorizeTenantAction(tenantId' docs/features/BE/feature_billing_lifecycle_tech.md` by hand
   and confirm every hit is inside a legitimate historical changelog row before moving on. This count is
   NOT stable across edits to this same launcher's own new changelog row: an earlier draft of that row
   phrased the before/after pair as `` `(tenantId, actionClass)` → `(tx, tenantId, actionClass)` `` (one
   grep hit, matching the pattern above); a later edit reworded it to drop the `authorizeTenantAction`
   prefix before the first parenthesis (zero hits from that row). Whichever wording is live when you run
   this, RE-RUN the grep and read what it actually returns — do not carry forward a count written by an
   earlier step in this same file, including this one. Add ONE new changelog row dated today explaining
   why; preserve every existing dated row verbatim — do not touch the v2.8 row, which already discusses a
   prior signature change and must read exactly as it did then. Bump the header Version/date to match the
   new top row.
5. Update `docs/autopilot-backlog.md`'s own task block: fill `manifest:` and `scope:` (both are `null`/
   `[]` today — that is expected; this slice is what fills them in).
6. Self-verify: run every `verification.focused` and `verification.canonical` command from the runtime
   manifest by hand as a pre-check. `pnpm test` needs `DATABASE_URL_TEST` —
   `docker compose -f infra/docker-compose.yml up -d postgres` first if it is not already running, then
   `DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm test`.
7. Commit the four scoped files (authored contract, launcher, spec fix, backlog update) in one commit.
   `HEAD` now legitimately moves ahead of `base_sha` — this is safe here because registration already
   happened in step 3, while `HEAD` still equaled `base_sha`.
8. Author `.autopilot/state/docs-billing-authz-signature-reconcile/readiness.json` (see
   `docs/autopilot-manifests/_READINESS_EVIDENCE_TEMPLATE.json`) BEFORE calling `ready` — `base_sha`/
   `head_sha` must match the manifest and the live branch tip exactly, or the gate HALTs
   `READINESS_JSON_INVALID`/`EVIDENCE_STALE`.
9. `scripts/autopilot-scope-gate ready --manifest .autopilot/state/docs-billing-authz-signature-reconcile/manifest.json`
   — this is what actually runs the counted verification + codex review round(s), via
   `autopilot-review-readiness.mjs` and `scripts/codex-review-pin.sh`; 1 clean round required (P2,
   1x — money/logic tiers need 2x, this is prose-only). Do NOT hand-invoke `codex-review-pin.sh` as a
   separate step first and count it — a manual pre-gate round is diagnostic only, per
   `docs/autopilot-templates/level3-workflow.md` §8. A round with any finding is a real fix round:
   increment `fix-round-count.txt`, log the region in `regions.log`, fix in scope, recommit, retry —
   never clear the round by editing state files.
10. Stop at `READY | AWAIT | HALT`. Do not merge.

## Negative scope

No change to `packages/db/src/authorization.ts` or any code — it is already correct. No edit to any
existing dated changelog row. No edit to `docs/autopilot-authorize-tenant-action-core.md` (AP-40's own
pinned, already-merged coding-handoff record — historical, not live spec). No edit to
`feature_session_management_tech.md` (its mentions are partial-arg shorthand naming the actionClass
value, not signature assertions). No touching any of the pre-v28 launchers that still register with the
authored path — that cleanup is the separate, deliberately deferred backlog item
`launcher-register-path-authored-to-runtime`.
