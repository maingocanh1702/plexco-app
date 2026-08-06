# Autopilot slice — inbound webhook verification contract evidence

> **Slug:** `infra-inbound-webhook-auth-evidence`  
> **Risk:** P2 docs-only · `manual_only` · STOP_AT_READY · 1 FULL-base Codex clean round  
> **Canonical framework:** `autopilot-prompt-GENERIC` v0.6.0  
> **Authority:** `features/BE/feature_connector_onboarding_tech.md` · `features/BE/feature_zalo_channel_tech.md` · `features/BE/feature_player_messenger_tech.md` · `standards/decisions.md` DD-30/DD-67  
> **Manifest:** `docs/autopilot-manifests/infra-inbound-webhook-auth-evidence.json`

## Task

```text
Capture attributable, current evidence for how Plexco must verify INBOUND webhooks from SePay, ApiPay,
Zalo Bot and Meta Messenger (signature header, algorithm, raw-body vs parsed body, replay/timestamp window).

Create only docs/standards/webhook-verification-matrix.md. Produce a decision-useful evidence table and one
overall result. Do not author code/config/migrations, handle or echo any secret VALUE, provision resources,
or infer an inbound rule from unrelated outbound source-IP requirements (that is AP-22, opposite direction).
```

## Evidence contract

One row per provider (SePay, ApiPay, Zalo Bot, Meta Messenger), each with:

1. exact inbound surface (webhook path/event) and the header carrying the signature/secret;
2. verification algorithm: hash/HMAC family, what bytes are signed (**raw body** vs parsed), timestamp/nonce
   and replay window, and whether comparison must be timing-safe — value `SPECIFIED`, `PARTIAL`, or `UNRESOLVED`;
3. primary source title/URL or attributable provider support/contract reference;
4. checked date;
5. concise paraphrase of why the source supports the conclusion.

Rules:

- Verify each provider independently; an inbound contract for one never answers another.
- Prefer current official provider documentation. Search snippets, resellers, community posts and model memory
  do not close a row. Documentation silence is not `SPECIFIED`.
- Document the verification CONTRACT only. Never record, paste or handle a real token/secret/App Secret value.
- Distinguish inbound signature/callback verification from outbound source-IP allowlisting (AP-22).
- Do not invent headers, algorithms, tolerances or provider behaviour.

## Deterministic outcome

No silent fall-through:

| Evidence state | Required document result |
|---|---|
| All four rows attributable and all `SPECIFIED` | `Overall result: WEBHOOK_AUTH_CONTRACT_COMPLETE` |
| All four rows attributable, one or more `PARTIAL` (documented gap, no invention) | `Overall result: WEBHOOK_AUTH_CONTRACT_PARTIAL` |
| Any row missing, ambiguous, stale or only inferred | `HALT-EVIDENCE_INCOMPLETE`; no overall result/marker |

Only for either complete result: add the literal HTML comment `<!-- WEBHOOK_AUTH_EVIDENCE_CLOSED -->`
immediately below the table. The marker proves evidence completeness, not that any adapter is authorized to
build — inbound-webhook code stays P0/manual.

## Negative scope

- No changes outside `docs/standards/webhook-verification-matrix.md`.
- No code, schema, migration, App Spec, workflow, Docker/Fly or test edits.
- No secret VALUES, credentials, DNS/webhook mutations, provider provisioning or spend.
- Do not edit the canonical generic prompt, invariant catalog, backlog, manifest or launcher from the worktree.

## Verification

```bash
pnpm exec prettier --check docs/standards/webhook-verification-matrix.md
git diff --check
git diff --stat main...HEAD
```

The final diff must be non-empty and contain exactly `docs/standards/webhook-verification-matrix.md`. Confirm
all four rows have attributable evidence, a checked date and exactly one supported outcome before trusting the
marker. No DB/application suite is required for this docs-only scope; any scope expansion invalidates that exemption.

## Review and stop condition

Register the manifest before edits and create both counter files. Persist the pinned Codex round with direct
stdout/stderr redirection, never `tee` or a substitute reviewer. P2 docs-only requires one FULL-base round with
zero findings and a real tail verdict on current HEAD. Quota/auth failure halts; no degraded mode. After
verification, run scope-gate `ready`, leave the branch/worktree intact, and STOP_AT_READY. Do not merge, begin a
second task, or author any adapter code.
