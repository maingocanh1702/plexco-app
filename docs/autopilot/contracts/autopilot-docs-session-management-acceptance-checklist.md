# Autopilot slice — Session Management acceptance checklist (issue-ready)

> **Slug:** `docs-session-management-acceptance-checklist`  
> **Risk:** P2 docs-only · `manual_only` · STOP_AT_READY · 1 FULL-base Codex clean round  
> **Canonical framework:** `autopilot-prompt-GENERIC` v0.6.0  
> **Authority (LOCAL specs only):** `features/feature_session_management.md` · `features/BE/feature_session_management_tech.md` · `product/ROADMAP.md` (Next Actions #3)  
> **Manifest:** `docs/autopilot-manifests/docs-session-management-acceptance-checklist.json`

## Task

```text
Convert the acceptance criteria and DoD in the Session Management product + BE specs into an issue-ready,
traceable checklist that a founder can paste into a tracker before the (manual) session-management build slice.

Create only docs/issues/session-management-acceptance-checklist.md. Use LOCAL specs only — no web, no
invention beyond the specs. This is documentation traceability, NOT authorization to build session code.
```

## Source contract

- Read only `feature_session_management.md` and `feature_session_management_tech.md` (and, where a criterion
  cites one, the named DD/BL). Do not pull from web or from memory.
- Every checklist item must trace to a specific spec section/use-case/DoD line. Preserve tenant-scope, RLS and
  determinism requirements verbatim in intent; do not soften or add scope.
- Group items by area (create/edit/close, roster, waitlist/capacity, timezone, RLS/isolation, audit). Each item:
  `- [ ] <testable acceptance statement>  — src: <spec §/UC-id>`.
- Do not resolve open questions or invent acceptance criteria the specs do not state; list any spec gap in a
  dedicated "Unresolved / needs spec" section rather than guessing.

## Deterministic outcome

No silent fall-through:

| State | Required document result |
|---|---|
| Every acceptance criterion / DoD line in both specs is mapped to a traceable checklist item (gaps listed explicitly) | `Overall result: SESSION_MGMT_CHECKLIST_COMPLETE` |
| A referenced spec section is missing/ambiguous, or a criterion cannot be traced | `HALT-SPEC_INCOMPLETE`; no overall result/marker |

Only for the complete result: add the literal HTML comment `<!-- SESSION_MGMT_CHECKLIST_CLOSED -->`
immediately below the checklist. The marker proves traceability coverage, not build authorization — session
code remains a separate, risk-classified slice.

## Negative scope

- No changes outside `docs/issues/session-management-acceptance-checklist.md` (creating the `docs/issues/` dir
  is allowed only for this one file).
- No code, schema, migration, App Spec, workflow or test edits; no auth/token/secret/money content.
- Do not edit the source specs, the canonical generic prompt, invariant catalog, backlog, manifest or launcher.

## Verification

```bash
pnpm exec prettier --check docs/issues/session-management-acceptance-checklist.md
git diff --check
git diff --stat main...HEAD
```

The final diff must be non-empty and contain exactly `docs/issues/session-management-acceptance-checklist.md`.
Confirm every item carries a `src:` trace and that unresolved items are quarantined before trusting the marker.
No DB/application suite is required for this docs-only scope; any scope expansion invalidates that exemption.

## Review and stop condition

Register the manifest before edits and create both counter files. Persist the pinned Codex round with direct
stdout/stderr redirection, never `tee` or a substitute reviewer. P2 docs-only requires one FULL-base round with
zero findings and a real tail verdict on current HEAD. Quota/auth failure halts; no degraded mode. After
verification, run scope-gate `ready`, leave the branch/worktree intact, and STOP_AT_READY. Do not merge, author
session code, or begin a second task.
