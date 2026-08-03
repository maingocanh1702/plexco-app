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
`docs/autopilot-manifests/` must never carry that field and is REJECTED as a `--manifest` input. This is
expected to be among the first slices registered after that sync; if `register` HALTs, the message names
the missing field and the correct path — read it before treating this as a defect.

```
scripts/autopilot-scope-gate register --manifest .autopilot/state/docs-billing-authz-signature-reconcile/manifest.json
```

After it returns `registered: ... (in-flight)`, CONFIRM the hash-lock actually landed before doing
anything else — `register` printing "registered" is not itself proof:

```
test -f .autopilot/state/docs-billing-authz-signature-reconcile/registered-manifest.sha256 && echo LOCKED || echo NOT_LOCKED
```

## Steps

1. Verify `.autopilot/INFLIGHT.md` has zero active reservations and `.autopilot/worktrees/` is empty;
   verify `main`'s tip locally before pinning `base_sha`.
2. Create worktree `.autopilot/worktrees/docs-billing-authz-signature-reconcile` on branch
   `feat/docs-billing-authz-signature-reconcile` from that exact `base_sha`.
3. Author the tracked contract and the runtime manifest (see Registration mechanics), then register.
4. Fix exactly two current-state lines in `feature_billing_lifecycle_tech.md` (§1 overview diagram, §3
   Status Authority heading): `(tenantId, actionClass)` → `(tx, tenantId, actionClass)`. Add ONE new
   changelog row dated today explaining why; preserve every existing dated row verbatim — do not touch
   the v2.8 row, which already discusses a prior signature change and must read exactly as it did then.
   Bump the header Version/date to match the new top row.
5. Update `docs/autopilot-backlog.md`'s own task block: fill `manifest:` and `scope:` (both are `null`/
   `[]` today — that is expected; this slice is what fills them in).
6. Self-verify: run every `verification.focused` and `verification.canonical` command from the runtime
   manifest by hand as a pre-check. `pnpm test` needs `DATABASE_URL_TEST` —
   `docker compose -f infra/docker-compose.yml up -d postgres` first if it is not already running, then
   `DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm test`.
7. Commit the four scoped files in one commit.
8. `scripts/autopilot-scope-gate ready --manifest .autopilot/state/docs-billing-authz-signature-reconcile/manifest.json`
   — this is what actually runs the counted verification + codex review round(s), via
   `autopilot-review-readiness.mjs` and `scripts/codex-review-pin.sh`; 1 clean round required (P2,
   1x — money/logic tiers need 2x, this is prose-only). Do NOT hand-invoke `codex-review-pin.sh` as a
   separate step first and count it — a
   manual pre-gate round is diagnostic only, per `docs/autopilot-templates/level3-workflow.md` §8.
9. Stop at `READY | AWAIT | HALT`. Do not merge.

## Negative scope

No change to `packages/db/src/authorization.ts` or any code — it is already correct. No edit to any
existing dated changelog row. No edit to `docs/autopilot-authorize-tenant-action-core.md` (AP-40's own
pinned, already-merged coding-handoff record — historical, not live spec). No edit to
`feature_session_management_tech.md` (its mentions are partial-arg shorthand naming the actionClass
value, not signature assertions). No touching any of the pre-v28 launchers that still register with the
authored path — that cleanup is the separate, deliberately deferred backlog item
`launcher-register-path-authored-to-runtime`.
