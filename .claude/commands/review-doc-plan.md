# Review Docs / Plans → Readiness Verdict

Target/request: `$ARGUMENTS`

Use this command for every doc, decision, spec, plan, readiness, or “updated/final” review.

## Mandatory sources

Before reviewing or editing, read completely:

1. `AGENTS.md` / `CLAUDE.md` project instructions.
2. `docs/standards/review-code-readiness-gate.md`.
3. `docs/templates/review-doc-plan-session-template.md`.
4. Every target file plus its authority/dependent specs.
5. Relevant live schema, migrations, code, auth/RLS/grants, tests, and current default-branch state.

## Required execution

1. Parse `$ARGUMENTS` into exact target files and expected outcome.
2. Pin full default-branch commit SHA; never use a moving global doc version as the snapshot.
3. Review live repo truth before prose.
4. Map G1–G6 and the canonical 12-row closure matrix.
5. If the user authorized fixes, patch only in scope and re-open/re-check the newest exact files.
6. Select the lowest unbuilt dependency node as the first implementation candidate; do not assume the reviewed feature is next to code.
7. End with the complete canonical verdict block. Do not omit fields.

## Hard constraints

- `DECISION_FINAL` is not `PLAN_READY`, `CODE_READY`, `ENABLE_READY`, or `IMPLEMENTED`.
- `CODE_READY` requires G1–G5 PASS, G6 PASS/named enablement-only, closure 12/12 PASS, zero in-scope open questions, merged hard dependencies, complete acceptance behavior, and an executable first slice.
- If not ready, return exact blocker + owner + binary resolution + `NEXT_REVIEW_TRIGGER`.
- Never end with “almost final”, “seems ready”, or an unbounded list of polish work.
- Never treat docs/contracts/test counts as runtime or production E2E proof.
- Do not implement feature code in a review-only request.

Follow the detailed workflow and output contract in `docs/templates/review-doc-plan-session-template.md` exactly.
