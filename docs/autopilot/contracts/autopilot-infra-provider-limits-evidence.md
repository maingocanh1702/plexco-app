# Autopilot slice — provider messaging limits and tier evidence

> **Slug:** `infra-provider-limits-evidence`  
> **Risk:** P2 docs-only · `manual_only` · STOP_AT_READY · 1 FULL-base Codex clean round  
> **Canonical framework:** `autopilot-prompt-GENERIC` v0.6.0  
> **Authority:** `strategy/gtm-doi-soat-decision.md` (existing limit notes to VERIFY) · `channels/zalo/README.md` · `channels/messenger/messenger-channel-design.md` · `standards/decisions.md` DD-37/DD-65..68  
> **Manifest:** `docs/autopilot-manifests/infra-provider-limits-evidence.json`

## Task

```text
Capture attributable, current evidence for the messaging limits and tier gates that constrain Plexco on
Zalo Bot, Meta Messenger, SePay and ApiPay (message quotas, send-window, bot/user caps, App-Review or plan
tier gates, and any beta-pricing risk).

Create only docs/standards/provider-limits-evidence.md. Produce a decision-useful evidence table and one
overall result. This is EVIDENCE ONLY: do not set pricing, GTM, capacity or architecture decisions, and do
not change code/config/migrations or provision anything.
```

## Evidence contract

One row per limit that actually constrains a phase-1 flow, grouped by provider. Each row:

1. provider + exact limit/gate (e.g. Zalo Bot free-tier bots-per-account, users-per-bot, messages-per-month;
   Messenger standard-messaging 24h window + App Review; SePay/ApiPay plan tier or rate limit);
2. current value/constraint, or `UNRESOLVED`; note explicitly if it is a **beta / subject-to-change** figure;
3. primary source title/URL or attributable provider support/contract reference;
4. checked date;
5. concise paraphrase of what the source states.

Rules:

- Verify each provider independently against current official documentation. Search snippets, resellers,
  community posts and model memory do not close a row. Silence is not a value.
- Treat any pre-existing figure in `gtm-doi-soat-decision.md` (e.g. "50 users/bot, 3000 msgs/month, beta") as a
  claim to RE-VERIFY, not a source; supersede or confirm it with an attributable citation.
- Do not invent numbers, tiers, allowlists or enterprise capabilities. Flag beta/unstable pricing as a risk row.

## Deterministic outcome

No silent fall-through:

| Evidence state | Required document result |
|---|---|
| Every constraining row attributable (value or explicit beta/risk note) | `Overall result: PROVIDER_LIMITS_EVIDENCE_COMPLETE` |
| Any row missing, ambiguous, stale or only inferred | `HALT-EVIDENCE_INCOMPLETE`; no overall result/marker |

Only for the complete result: add the literal HTML comment `<!-- PROVIDER_LIMITS_EVIDENCE_CLOSED -->`
immediately below the table. The marker proves evidence completeness, not a pricing/capacity decision.

## Negative scope

- No changes outside `docs/standards/provider-limits-evidence.md`.
- No code, schema, migration, App Spec, workflow, Docker/Fly or test edits.
- No secret values, credentials, DNS/webhook mutations, provider provisioning or spend.
- Do not set or change any GTM/pricing/capacity decision; do not edit the canonical generic prompt, invariant
  catalog, backlog, manifest or launcher from the worktree.

## Verification

```bash
pnpm exec prettier --check docs/standards/provider-limits-evidence.md
git diff --check
git diff --stat main...HEAD
```

The final diff must be non-empty and contain exactly `docs/standards/provider-limits-evidence.md`. Confirm each
row has attributable evidence, a checked date and exactly one supported outcome before trusting the marker. No
DB/application suite is required for this docs-only scope; any scope expansion invalidates that exemption.

## Review and stop condition

Register the manifest before edits and create both counter files. Persist the pinned Codex round with direct
stdout/stderr redirection, never `tee` or a substitute reviewer. P2 docs-only requires one FULL-base round with
zero findings and a real tail verdict on current HEAD. Quota/auth failure halts; no degraded mode. After
verification, run scope-gate `ready`, leave the branch/worktree intact, and STOP_AT_READY. Do not merge or begin
a second task.
