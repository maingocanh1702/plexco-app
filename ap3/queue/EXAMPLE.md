---
slug: payment-webhook-retry
class: bugfix-small
risk: P2
scope:
  - src/payments/webhook.ts
  - test/payments/**
verify: npm test -- payments
budget_usd: 8
max_review_rounds: 3
---
## Problem

What is wrong, and how to reproduce it. Name the file and the observable failure. If the task
depends on a re-derived fact (a grep count, a line number), give the exact command and the number
you measured, and tell the writer to re-measure at its base and HALT `MISSING_CONTEXT` if it differs.

## Acceptance

The observable behaviour a test must pin — and that fails today (so RED is real). List each
concrete criterion. Name the RED test and where it lives. If a specific assertion must change, say so.

## Context

Everything the writer needs and cannot ask for (paths only — the writer reads them itself): the
approach already decided, naming, what must NOT change (the old kit's negative_scope lives here as
prose), the blast radius, and the exact commit message if you want one. An engineer with no chat
access must be able to finish from this file alone. Every repo path named here must exist.

<!--
This file is a template. Its basename is not a valid slug (uppercase), and the dispatcher only
picks up ap3/queue/<lowercase-slug>.md, so EXAMPLE.md is never dispatched. Copy it to
ap3/queue/<your-slug>.md, fill it in, and run `bash ap3/lint-task.sh ap3/queue/<your-slug>.md`
until it prints OK before committing.
-->
