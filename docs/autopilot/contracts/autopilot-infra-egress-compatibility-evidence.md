# Autopilot slice — DD-04 fixed-egress compatibility evidence

> **Slug:** `infra-egress-compatibility-evidence`  
> **Risk:** P2 docs-only · `manual_only` · STOP_AT_READY · 1 FULL-base Codex clean round  
> **Canonical framework:** `autopilot-prompt-GENERIC` v0.6.0  
> **Authority:** `dd-04-hosting-final-decision.md` §7.1 + `standards/environments-setup.md` §1.1  
> **Manifest:** `docs/autopilot-manifests/infra-egress-compatibility-evidence.json`

## Task

```text
Close DD-04 §7.1 with attributable, current evidence for whether Plexco's outbound calls to SePay, ApiPay,
Zalo Bot and Meta Messenger require a fixed public source IP.

Edit only docs/standards/environments-setup.md. Produce a decision-useful evidence table and one overall result.
Do not author deployment configuration, change code/schema/migrations, handle secret values, provision resources,
or infer a provider contract from unrelated inbound webhook requirements.
```

## Evidence contract

Replace the current two-column question table in §1.1 with rows containing:

1. dependency and exact Plexco outbound call surface;
2. fixed source-IP requirement: `NO`, `YES`, or `UNRESOLVED`;
3. primary source title/URL or attributable provider support/contract reference;
4. checked date;
5. concise paraphrase explaining why the source supports the conclusion.

Rules:

- Verify SePay, ApiPay, Zalo Bot and Meta Messenger independently.
- Prefer current official provider documentation. Search snippets, resellers, community posts and model memory
  do not close a row.
- Official documentation silence is not `NO`. If docs are silent, only an attributable provider support or
  contractual response supplied by the owner can close the row.
- Distinguish outbound API source-IP allowlisting from inbound webhook signature, callback IP, domain or app
  review rules. Evidence for one direction cannot answer the other.
- Paraphrase; do not paste long source passages. Record access dates and direct links where available.
- Do not invent prices, enterprise capabilities, allowlists or provider behavior.

## Deterministic outcome

Use this decision table with no silent fall-through:

| Evidence state | Required document result |
|---|---|
| All four rows are attributable and all are `NO` | `Overall result: DO_VPC_COMPATIBLE` |
| All four rows are attributable and one or more are `YES` | `Overall result: FIXED_EGRESS_REQUIRED` |
| Any row is missing, ambiguous, stale, or only inferred | `HALT-EVIDENCE_INCOMPLETE`; no overall result/marker |

Only for either complete result:

- add the literal HTML comment `<!-- DD04_EGRESS_EVIDENCE_CLOSED -->` immediately below the table;
- mark the matching fixed-egress acceptance checklist item complete;
- explain that `DO_VPC_COMPATIBLE` permits later manual design review only, while
  `FIXED_EGRESS_REQUIRED` blocks the DO App Platform + VPC green path and requires a separate fallback design.

The marker proves evidence completeness, not that the answer was favorable and not that AP-21 is authorized.

## Negative scope

- No changes outside `docs/standards/environments-setup.md`.
- No App Specs, GitHub Actions, Docker/Fly config, application code, schema, migration or test edits.
- No secret values, credentials, login/session changes, DNS/webhook mutations, provider provisioning or spend.
- No fallback implementation and no weakening of the accepted private DB/VPC decision.
- Do not edit the canonical generic prompt, invariant catalog, backlog, manifest or launcher from the worktree.

## Verification

```bash
pnpm exec prettier --check docs/standards/environments-setup.md
git diff --check
git diff --stat main...HEAD
```

The final diff must be non-empty and contain exactly `docs/standards/environments-setup.md`. Confirm all four
rows have attributable evidence, a checked date and exactly one supported outcome before trusting the marker.
No DB/application suite is required for this docs-only scope; any scope expansion invalidates that exemption.

## Review and stop condition

Register the manifest before edits and create both required counter files. Persist the pinned Codex round with
direct stdout/stderr redirection, never `tee` or a substitute reviewer. P2 docs-only requires one FULL-base
round with zero findings and a real tail verdict on current HEAD. Quota/auth failure halts; no degraded mode.

After verification, run scope-gate `ready`, leave the branch/worktree intact, and STOP_AT_READY. Do not merge,
run AP-21, provision anything, or begin a second task.
