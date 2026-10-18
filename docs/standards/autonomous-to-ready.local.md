# `autonomous_to_ready`: Plexco local supplement

Binds the generic rules in `docs/autopilot-templates/level3-workflow.md` §6.1 (kit pack) to Plexco's
files and keeps the evidence behind them. This file sits outside the kit pack, so a kit sync never
overwrites it. Read it together with §6.1 whenever a task runs under `autonomous_to_ready`.

## Why the mode exists here (measured)

Measured cost on `session-service-create-command-core` v1
(2026-08-13): **four owner round-trips on budget alone** (300→360→440→470 compact), and the lane still
ended `HALT MAX_ROUNDS` — the budget was never the binding constraint, the validation design was. Every
one of those four stops produced a number, not an insight. Meanwhile three of the four authoring blockers
(B1 acceptance matrix, B2 module home, B3 producer contract) were resolved by *reading the repo*; only B4
was a genuine owner decision.

## Corpus size

Measured at `1fdba1d`:

| Set | Size | Roughly |
|---|---|---|
| Whole `docs/` corpus | 303 files · 8.5 MB · 1.13M words | **~2M+ tokens** |
| Just the six core authority docs | 871 KB | **~220k+ tokens** |
| `decisions.md` summary table only | 60 KB · 126 lines | ~18k tokens |

The full corpus is an order of magnitude past any context window; even the six core docs overflow one on
their own. The live proof is in this repo today: the `session-service` build session hit **98% context**
having loaded only its own slice's context pack.

## Always-load core

**Always load (small, non-negotiable):** `docs/00-start-here/HANDOFF.md` live-truth block ·
`decisions.md` **summary table** (the `| DD-nn |` rows, not the full bodies) ·
`docs/standards/review-code-readiness-gate.md` · the slice's own packet and manifest. This is the
constitution; it fits.

## Corpus maps and search span

Search across `docs/` **and** `packages/`/`apps/`. The maps are `docs/docs-inventory.md` and
`docs/features/README.md`.

## Lessons behind the rules

`DD-106` is what ignorance costs — a spec pass wrote a money contract into two Reviewed specs while
`decisions.md` already held `DD-26` saying *"không thêm model 'buddy'"*. The doc existed. Nobody read it.

"Searched `decisions.md` for `buddy`, found
`DD-26`: don't add a buddy model" is the sentence that would have prevented `DD-106`.

> Tier C is not bureaucracy left over from a stricter era. `DD-106` (2026-08-13) exists because a spec pass
> wrote a money contract — `buddy_payment_requests`, `payment_allocations.source='buddy'` — into two
> **Reviewed** specs without a decision. Nobody was reckless; the contract simply had no cheap way to say
> "this one needs an owner". Items 1–3 are that lesson, priced.

> **A grep that returns nothing is evidence about the query, not proof about the repo.** This has already
> misfired here twice: an `awk` written for backticks against a catalog that used em-dashes returned empty
> twice and got read as "no data"; and the language-rule check returned zero hits for a rule that existed
> but had never been written down. Before trusting a null result, verify the query finds a known-present
> control case.

## Authority rungs mapped to Plexco files

Docs in this repo **do** contradict each other; the 2026-08-13 audit found conflicts in specs, playbooks,
templates and index files simultaneously.

| # | Authority | Why it outranks the next |
|---|---|---|
| 1 | **Runtime truth** — `pg_catalog`, applied migrations, canonical runner output, live code | Measurement, not intention. `schema.ts` declares; `pg_constraint` proves. |
| 2 | **`packages/db/migrations/*.sql` + `schema.ts`** | `CLAUDE.md` marks these AUTHORITATIVE for schema/data-model/architecture. |
| 3 | **`docs/standards/decisions.md`** | The decision log. Where a spec and a DD disagree, the DD wins and the spec must be corrected. |
| 4 | **Reviewed spec** (`features/FE` + `features/BE` pair) | Contract baseline — but only the Reviewed parts. A 🟡-tagged section inside a Reviewed spec is **not** contract. |
| 5 | **Draft spec / plan / proposal** | Direction, not contract. Never a basis for implementing. |
| 6 | **`ROADMAP.md`** for delivery order + dev progress · **BRD** scope · **PRD** behavior · **TDD** implementation contract | Each owns its own question and nothing else. |
| 7 | **Index/summary docs** — `features/README.md`, `docs-inventory.md`, `BUILD-STATUS.md`, quick-reference tables | Convenience mirrors. They go stale first; the audit found 46/51 version cells wrong in one index. |

- **`Doc status ≠ Implementation status`.** `Reviewed` never implies runtime; `BUILD-STATUS`/`ROADMAP` axes
  do, and only from runner output.

## Tier C instances in Plexco

- Item 2 covers the 5 HARD RULES in `CLAUDE.md`.
- Item 5 covers `OUTBOX_DISPATCH_SCHEDULE_ENABLED` and `GOOGLE_OAUTH_*`.
- Demotion rule, worked example: `DD-104 D2a` naming "action class hẹp `delete_draft_session` trong
  `authorizeTenantAction` (sửa contract billing, slice riêng)" is exactly this: editing that Reviewed billing
  spec is Tier A *for that edit*, because the DD says to.

## Precedent examples

- One source of truth: `0032` exists because `assert_dm_allowed` had grown a second reading of the same four toggles.
- Consistent with precedent: If `auth.ts` and `authorization.ts` live in `packages/db/src`, the new service does too — even if another location reads slightly nicer.
