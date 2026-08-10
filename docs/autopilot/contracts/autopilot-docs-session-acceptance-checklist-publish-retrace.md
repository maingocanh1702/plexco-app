# Autopilot slice — Session Management acceptance checklist publish retrace

> **Slug:** `docs-session-acceptance-checklist-publish-retrace`
> **Risk:** P2 docs-only · `manual_only` · STOP_AT_READY · 1 FULL-base Codex clean round
> **Canonical framework:** `autopilot-prompt-GENERIC` v0.6.0
> **Authority (LOCAL specs only):** `features/FE/feature_session_management.md` (v2.13a) · `features/BE/feature_session_management_tech.md` (v2.14c) · `features/BE/feature_billing_lifecycle_tech.md` (v2.8d, cross-ref only) · `product/PRD.md` (v2.8g, cross-ref only)
> **Manifest:** `docs/autopilot-manifests/docs-session-acceptance-checklist-publish-retrace.json`
> **Depends on:** `docs-session-publish-contract` (merged)

## Task

```text
The publish contract + billing status-authority + concurrency-recheck have all merged. Re-trace
docs/issues/session-management-acceptance-checklist.md: bump the Sources pin (P v2.12b->v2.13a,
T v2.13a->v2.14c); fold the now-authored publish artifacts (SES-UC-12, edges #16-19, AC#15-20,
session_published event, T tests #40-48) into the checklist's §1/§5/§6 area rows and §7/§8 ledgers;
remove/reframe the §9-B "publish mechanics decided-to-exist, deferred" bullet since that framing is
stale now that mechanics are authored and its three former hard dependencies (billing status-authority,
PRD FLOW 2 projection-timing, publish concurrency re-check-under-lock) are RESOLVED at spec level.

Checklist re-traces itself (not the publish slice's job, per founder). Docs-only; no code/schema.
```

## Source contract

- Read only `feature_session_management.md`, `feature_session_management_tech.md` as primary sources; the
  billing-suspend row and the Result section's publish-retrace note may cross-reference
  `feature_billing_lifecycle_tech.md` §3/§5 and `PRD.md` FLOW 2 for the publish sub-feature specifically —
  declare these explicitly in the checklist's own Sources section so "no other input used" stays accurate.
  Do not pull from web or from memory.
- Every new/changed checklist item must trace to a specific spec section/use-case/edge/AC/test id, re-derived
  from the on-disk spec at author time — never copied from a stale citation (line numbers and version pins
  drift).
- Preserve every dated/point-in-time provenance row verbatim (Result section reconciliation history, dated
  changelog rows in the cited specs). Fix CURRENT-STATE claims only (Sources pin, migration-tail wording,
  §9-B framing); add exactly the new dated rows needed to record this pass, never rewrite history.
- Resolve no new design question; do not choose any storage/API/mutation shape the specs leave open.

## Deterministic outcome

No silent fall-through:

| State | Required document result |
|---|---|
| Every publish artifact now in P/T maps to a traceable checklist row (§1/§5/§6), the §7/§8 ledgers total correctly, and §9-B no longer claims publish mechanics are deferred | `Overall result: SESSION_MGMT_CHECKLIST_COMPLETE` (unchanged marker, re-verified) |
| A referenced spec section is missing/ambiguous, or a publish artifact cannot be traced | `HALT-SPEC_INCOMPLETE`; no completion claim |

The existing `<!-- SESSION_MGMT_CHECKLIST_CLOSED -->` marker stays; it proves traceability coverage only, not
build authorization.

## Negative scope

- No changes outside `docs/issues/session-management-acceptance-checklist.md` (+ this slice's own manifest/
  slice-doc/launcher/backlog-reconcile artifacts).
- No code, schema, migration, App Spec, workflow or test edits; no auth/token/secret/money content.
- Do not edit the source specs (`feature_session_management.md`, `feature_session_management_tech.md`,
  `feature_billing_lifecycle_tech.md`, `PRD.md`) — this slice traces them, it does not author into them.
- Do not resolve any §9 open question or invent acceptance criteria the specs do not state.

## Verification

```bash
pnpm review:check:changed
git diff --check
git diff --stat main...HEAD
```

The final diff must contain only the checklist file + this slice's own manifest/backlog/slice-doc/launcher.
Confirm every new row carries a `src:` trace, the §8 ledger totals match the recount, and the Sources section's
"no other input used" framing stays internally consistent with any cross-feature citation added.

## Review and stop condition

Register the manifest before edits and create both counter files. Persist the pinned Codex round with direct
stdout/stderr redirection, never `tee` or a substitute reviewer. P2 docs-only requires one FULL-base round with
zero findings and a real tail verdict on current HEAD. Quota/auth failure halts; no degraded mode. After
verification, run scope-gate `ready`, leave the branch/worktree intact, and STOP_AT_READY. Do not merge, author
session code, or begin a second task.
