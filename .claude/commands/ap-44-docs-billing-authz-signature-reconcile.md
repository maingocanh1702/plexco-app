# AP-44 — docs-billing-authz-signature-reconcile: fix a stale signature across two Reviewed specs

`feature_billing_lifecycle_tech.md` §1/§3 and `feature_session_management_tech.md` §4 step 6 all
document or invoke `authorizeTenantAction(tenantId, actionClass)`. The merged code (`ddb69a9`,
`packages/db/src/authorization.ts:91-95`) is `authorizeTenantAction(tx, tenantId, actionClass)` — a
version that opened its own transaction would release its `FOR SHARE` locks before the caller could
mutate, reopening the race this same §3's Concurrency clause exists to close (codex round-01 [P1] on
`authorize-tenant-action-core`). Code is right, spec is stale — and in the session spec this is not just
stale prose: step 6 requires the re-check to run inside the transaction holding the session lock while
printing a call shape that structurally cannot receive that transaction. This slice reconciles both
specs — no code change.

## Read before you write

1. `docs/autopilot-backlog.md` task block `docs-billing-authz-signature-reconcile` — full reasoning.
2. `docs/autopilot-manifests/docs-billing-authz-signature-reconcile.json` — scope, negative scope,
   verification. Read the whole file; it is short by design.
3. `packages/db/src/authorization.ts` lines 1-95 — the live signature and its own doc comment, which
   independently explains the same FOR SHARE reasoning.
4. `docs/features/BE/feature_billing_lifecycle_tech.md` and
   `docs/features/BE/feature_session_management_tech.md` — confirm `Status: Reviewed` at the top of
   each before touching them. CLAUDE.md's actual rule bars writing an *unresolved decision* directly
   into a Reviewed spec (those go to `decisions.md` as a proposal instead) — it is not a blanket ban on
   any edit. This slice's changes are settled, factual signature corrections, not new decisions, so that
   specific rule does not apply to either file either way. It is still a separate reconcile slice, not
   an inline edit, because that is the established, auditable pattern this codebase already uses for
   every prior fix to a Reviewed spec.
5. In `feature_session_management_tech.md`, distinguish call-shaped occurrences of
   `authorizeTenantAction` from bare-name or single-arg prose mentions before touching anything — only
   the former are signature claims. Grep the whole file (`grep -n authorizeTenantAction <file>`); do not
   assume the count or shape from a prior run of this launcher.

## Registration mechanics — read this before running anything

**Measure the live kit version from `scripts/autopilot-scope-gate`'s own `# KIT_VERSION:` header before
assuming any behavior — do not trust a number written in this file.** At the version this launcher was
authored against, `register` HALTs `CONTRACT_INVALID` unless `--manifest` points at the RUNTIME manifest
(`.autopilot/state/<feature>/manifest.json`, carrying `manifest_schema_version: level3-operational-v2`)
— the authored contract under `docs/autopilot-manifests/` must never carry that field and is REJECTED as
a `--manifest` input. If `register` HALTs, the message names the missing field and the correct path —
read it before treating this as a defect. If the live kit is newer and behaves differently, trust what
`register` actually does over this description.

**`register` also requires worktree `HEAD` to equal the manifest's `base_sha` exactly** (checked
somewhere in `register`'s validation sequence — schema/contract-field checks, dependency checks and
reviewer availability can run before it; do not assume it is the very first thing checked, only that it
is checked). This means: author and register the RUNTIME manifest FIRST, while the worktree is still
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
entries or `.autopilot/worktrees/` being empty; that was a one-time eligibility check specific to a
prior repo-wide kit mechanism sync (a non-slice operation, done once when the installed kit was behind
canonical), not a general precondition for an ordinary slice like this one, and requiring it here would
incorrectly block this launcher from ever running again once any other slice is in flight.

## Steps

1. `git fetch origin main` and confirm `main == origin/main` before pinning `base_sha` (codex round-04 [P2]).
2. Create worktree `.autopilot/worktrees/docs-billing-authz-signature-reconcile` on branch
   `feat/docs-billing-authz-signature-reconcile` from that exact `base_sha`. Do not add, merge or
   cherry-pick any commit on top yet.
3. Author ONLY the runtime manifest (`.autopilot/state/docs-billing-authz-signature-reconcile/manifest.json`
   — untracked, does not move `HEAD`). Register immediately (see Registration mechanics) while `HEAD`
   still equals `base_sha`. Confirm `registered-manifest.sha256` exists before proceeding.
4. Now author the tracked authored contract
   (`docs/autopilot-manifests/docs-billing-authz-signature-reconcile.json`) and fix every current-state
   call-shaped occurrence across BOTH spec files:
   - `feature_billing_lifecycle_tech.md`: §1 overview diagram, §3 Status Authority heading, §2 edge
     case #8, §5 test cases #29-30 (five sites).
   - `feature_session_management_tech.md`: §4 step 6's billing re-check (one site). Its other mentions
     (edge #24, step 1, the "Billing suspension gate" and "Billing suspension — concurrency"
     blockquotes) are bare-name prose or single-arg action-class shorthand, not signature claims —
     leave those exactly as written.

   `(tenantId, actionClass)` / `(tenantId, 'publish_new_sessions')` →
   `(tx, tenantId, actionClass)` / `(tx, tenantId, 'publish_new_sessions')`. As currently registered,
   `verification.focused` asserts all six sites individually (each one verified locally by reverting
   that single site and confirming its own assertion fails, then restoring) — but do not trust this
   sentence either: read `docs/autopilot-manifests/docs-billing-authz-signature-reconcile.json` directly
   and count the live entries, since a manifest is hash-locked at register time and this launcher is not
   updated automatically when it changes. Do not treat "focused checks pass" as proof of completeness on
   its own — independently run `grep -n authorizeTenantAction <file>` on each spec by hand and classify
   every hit as call-shaped-current, call-shaped-historical (inside a dated changelog row — leave it),
   or prose-shorthand (leave it). Add ONE new changelog row per file dated today explaining why; preserve
   every existing dated row verbatim — do not touch the v2.8 row in the billing spec or the v2.14b/c rows
   in the session spec, which already discuss prior signature/locking changes and must read exactly as
   they did then. Bump each file's header Version/date to match its new top row.
5. Update `docs/autopilot-backlog.md`'s own task block: fill `manifest:` and `scope:` (both are `null`/
   `[]` today — that is expected; this slice is what fills them in).
6. Self-verify: run every `verification.focused` and `verification.canonical` command from the runtime
   manifest by hand as a pre-check. `pnpm test` needs `DATABASE_URL_TEST` —
   `docker compose -f infra/docker-compose.yml up -d postgres` first if it is not already running, then
   `DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm test`.
7. Commit the five scoped files (authored contract, launcher, both spec fixes, backlog update) in one
   commit.
   `HEAD` now legitimately moves ahead of `base_sha` — this is safe here because registration already
   happened in step 3, while `HEAD` still equaled `base_sha`.
8. Author `.autopilot/state/docs-billing-authz-signature-reconcile/readiness.json` (see
   `docs/autopilot-manifests/_READINESS_EVIDENCE_TEMPLATE.json`) BEFORE calling `ready` — `base_sha`/
   `head_sha` must match the manifest and the live branch tip exactly, or the gate HALTs
   `READINESS_JSON_INVALID`/`EVIDENCE_STALE`.
9. `scripts/autopilot-scope-gate ready --manifest .autopilot/state/docs-billing-authz-signature-reconcile/manifest.json`
   — this is what actually runs the counted verification + review round(s), via
   `autopilot-review-readiness.mjs` and `scripts/codex-review-pin.sh`. Read `code_review` and
   `security_review` in the manifest directly rather than assuming a count here — as authored, both are
   required: 1 clean code-review round (money/logic tiers need 2x; this is prose-only) AND a separate
   security-review round (owner-accepted on this slice despite the content being docs-only — see the
   manifest's `security_review.reason`, level3-workflow.md §8 gap 1). Do NOT hand-invoke
   `codex-review-pin.sh` as a separate step first and count it — a manual pre-gate round is diagnostic
   only, per `docs/autopilot-templates/level3-workflow.md` §8. A round with any finding is a real fix
   round: increment `fix-round-count.txt`, log the region in `regions.log`, fix in scope, recommit,
   retry — never clear the round by editing state files.
10. Stop at `READY | AWAIT | HALT`. Do not merge.

## Negative scope

No change to `packages/db/src/authorization.ts` or any code — it is already correct. No edit to any
existing dated changelog row in either spec. No edit to `docs/autopilot-authorize-tenant-action-core.md`
(AP-40's own pinned, already-merged coding-handoff record — historical, not live spec). No edit to
`feature_session_management_tech.md` beyond its one genuine stale call-shaped occurrence (§4 step 6) —
its bare-name and single-arg action-class mentions elsewhere are shorthand, not signature assertions, and
stay as written. No touching any of the pre-v28 launchers that still register with the authored path —
that cleanup is the separate, deliberately deferred backlog item `launcher-register-path-authored-to-runtime`.
