<!-- review-readiness: policy -->
# Plexco Level 3 autonomy extension (DD-107)

This repository-owned policy preserves the DD-107 additions previously embedded in
`docs/autopilot-templates/level3-workflow.md` at Plexco commit
`dd5375f71a6c05c9ca1ac33e38d3aa241efc897a`. Authority: [DD-107](./decisions.md).
It extends sections 3, 6 and 9 of the [canonical workflow](../autopilot-templates/level3-workflow.md).
References to "this document" in the preserved section below mean that workflow with this extension.
The canonical mirror can now be synchronized without removing Plexco policy.

DD-107 defines an elected behavioral mode and its entry conditions; moving this text does not enable
standing delegation or auto-merge. The runtime validator still accepts only `supervised` and
`proactive_routine`. Use the established `supervised` runtime value while applying authorized DD-107
behavior, as documented in `session-routes-close-cancel.json`; this move adds no new validator mode.
Canonical review/base mechanics, isolation and breakers continue to apply.

## 3. Task-contract extension

The behavioral task contract retains the original mode choice:

```text
AUTONOMY_MODE: supervised|proactive_routine|autonomous_to_ready
```

The runtime manifest value is constrained separately as described above.

### 6.1 `autonomous_to_ready` — run to READY without mid-flight owner decisions

**Problem this solves.** Under `supervised`, the agent stops for a decision the moment one appears, even
when the answer is derivable from the repo. Measured cost on `session-service-create-command-core` v1
(2026-08-13): **four owner round-trips on budget alone** (300→360→440→470 compact), and the lane still
ended `HALT MAX_ROUNDS` — the budget was never the binding constraint, the validation design was. Every
one of those four stops produced a number, not an insight. Meanwhile three of the four authoring blockers
(B1 acceptance matrix, B2 module home, B3 producer contract) were resolved by *reading the repo*; only B4
was a genuine owner decision.

**The move is not "remove the owner". It is "batch the owner".** Owner involvement shifts from *interrupt*
to *one review at READY*, reading a Decision Ledger. The agent decides in-flight and defends every decision
in writing.

#### Context: the whole doc corpus is in scope — but it cannot be *loaded*

The intent is right and non-negotiable: **no decision may be made while ignorant of a doc that governs it.**
`DD-106` is what ignorance costs — a spec pass wrote a money contract into two Reviewed specs while
`decisions.md` already held `DD-26` saying *"không thêm model 'buddy'"*. The doc existed. Nobody read it.

But "load every doc" is not a plan a machine can execute here. Measured at `1fdba1d`:

| Set | Size | Roughly |
|---|---|---|
| Whole `docs/` corpus | 303 files · 8.5 MB · 1.13M words | **~2M+ tokens** |
| Just the six core authority docs | 871 KB | **~220k+ tokens** |
| `decisions.md` summary table only | 60 KB · 126 lines | ~18k tokens |

The full corpus is an order of magnitude past any context window; even the six core docs overflow one on
their own. The live proof is in this repo today: the `session-service` build session hit **98% context**
having loaded only its own slice's context pack.

So the rule is **guaranteed coverage, not guaranteed loading** — three obligations, all executable:

1. **Always load (small, non-negotiable):** `docs/00-start-here/HANDOFF.md` live-truth block ·
   `decisions.md` **summary table** (the `| DD-nn |` rows, not the full bodies) ·
   `docs/standards/review-code-readiness-gate.md` · the slice's own packet and manifest. This is the
   constitution; it fits.
2. **Search the rest, and log the search.** Before any Tier A/B decision, run a corpus-wide search for the
   concepts the decision touches — entity names, column names, endpoint shapes, the feature noun — across
   `docs/` **and** `packages/`/`apps/`. Then read the hits that matter. `docs/docs-inventory.md` and
   `docs/features/README.md` are the maps.
3. **Negative evidence counts, and must be recorded as such.** "Searched `decisions.md` for `buddy`, found
   `DD-26`: don't add a buddy model" is the sentence that would have prevented `DD-106`. "Found nothing" is
   a valid and valuable ledger entry — but only if the query is written down so a reader can judge whether
   it was the right query. An unlogged search did not happen.

> **A grep that returns nothing is evidence about the query, not proof about the repo.** This has already
> misfired here twice: an `awk` written for backticks against a catalog that used em-dashes returned empty
> twice and got read as "no data"; and the language-rule check returned zero hits for a rule that existed
> but had never been written down. Before trusting a null result, verify the query finds a known-present
> control case.

#### Authority precedence — resolve conflicts without asking

Docs in this repo **do** contradict each other; the 2026-08-13 audit found conflicts in specs, playbooks,
templates and index files simultaneously. An autonomous lane therefore needs a written order. Earlier wins:

| # | Authority | Why it outranks the next |
|---|---|---|
| 1 | **Runtime truth** — `pg_catalog`, applied migrations, canonical runner output, live code | Measurement, not intention. `schema.ts` declares; `pg_constraint` proves. |
| 2 | **`packages/db/migrations/*.sql` + `schema.ts`** | `CLAUDE.md` marks these AUTHORITATIVE for schema/data-model/architecture. |
| 3 | **`docs/standards/decisions.md`** | The decision log. Where a spec and a DD disagree, the DD wins and the spec must be corrected. |
| 4 | **Reviewed spec** (`features/FE` + `features/BE` pair) | Contract baseline — but only the Reviewed parts. A 🟡-tagged section inside a Reviewed spec is **not** contract. |
| 5 | **Draft spec / plan / proposal** | Direction, not contract. Never a basis for implementing. |
| 6 | **`ROADMAP.md`** for delivery order + dev progress · **BRD** scope · **PRD** behavior · **TDD** implementation contract | Each owns its own question and nothing else. |
| 7 | **Index/summary docs** — `features/README.md`, `docs-inventory.md`, `BUILD-STATUS.md`, quick-reference tables | Convenience mirrors. They go stale first; the audit found 46/51 version cells wrong in one index. |

Four tie-breaks that have each already cost a session here:

- **A lane's packet on its own branch outranks the copy on `main`.** A slice legitimately amends its own
  contract inside its commit; reading `main` and declaring a scope violation is the error.
- **Within one file, a newer live-truth block outranks an older one** — and an older block's *instructions*
  go stale too, not just its numbers. Sweep for stale directives, not only stale counts.
- **Where two docs both claim canonical, the one that names a decision ID wins**; if neither does, treat it
  as a Tier C conflict and AWAIT rather than picking.
- **`Doc status ≠ Implementation status`.** `Reviewed` never implies runtime; `BUILD-STATUS`/`ROADMAP` axes
  do, and only from runner output.

#### Decision authority ladder

The agent classifies each decision before making it. Misclassifying downward is a gate violation, not a
style error.

| Tier | Definition | Agent behaviour |
|---|---|---|
| **A — derivable** | The repo, migrations, specs, decision log or an existing precedent already contain the answer. Naming, module placement, test shape, error-code reuse, insert-contract shape read off a migration header, acceptance rows traced from a spec. | **Decide. Log one line.** Never stop. Stopping on a Tier-A item is itself a defect — record it in the ledger as one. |
| **B — judgment, reversible, in-scope** | Not written down, but the consequence stays inside the slice's declared scope and can be changed later by editing this slice's own files. Helper extraction, lock-key choice, validator placement, adding an invariant token, re-slicing after a budget overrun, opening a successor after an accepted HALT. | **Decide. Log with alternatives, reasoning, reversibility and the evidence read.** Flag at READY for batch review. |
| **C — reserved** | Enumerated below. Irreversible, cross-slice, or contract-level. | **AWAIT.** One recommended option, trade-offs, binary resume condition. |

**Tier C is exactly this list — nothing else, and nothing removed from it:**

1. Any new or changed **money contract**: a table, column, enum value, endpoint or allocation rule on the payment path.
2. Any change to a **PII/identity** contract, or anything touching the 5 HARD RULES in `CLAUDE.md`.
3. Editing the **contract content of a spec already marked Reviewed** (fixing a broken link or a stale number is Tier A; adding an entity/column/endpoint is Tier C).
4. A **migration** that changes schema semantics, or any migration on a tail shared with another in-flight lane.
5. **Enablement**: flipping a feature flag or env that turns behaviour on in production, including `OUTBOX_DISPATCH_SCHEDULE_ENABLED` and `GOOGLE_OAUTH_*`.
6. **Merge, deploy**, or any external side effect outside the worktree.
7. Work that requires **expanding beyond the declared negative scope** — re-slice or AWAIT, never widen silently.
8. A **contested** review finding: the agent believes the reviewer is wrong. Accepted findings are Tier B.

> Tier C is not bureaucracy left over from a stricter era. `DD-106` (2026-08-13) exists because a spec pass
> wrote a money contract — `buddy_payment_requests`, `payment_allocations.source='buddy'` — into two
> **Reviewed** specs without a decision. Nobody was reckless; the contract simply had no cheap way to say
> "this one needs an owner". Items 1–3 are that lesson, priced.

**One demotion rule, and it matters for lane selection.** A change that a decision record **explicitly
authorizes by name** is **Tier A, not Tier C** — the owner already decided; executing a written decision is
not making a new one. `DD-104 D2a` naming "action class hẹp `delete_draft_session` trong
`authorizeTenantAction` (sửa contract billing, slice riêng)" is exactly this: editing that Reviewed billing
spec is Tier A *for that edit*, because the DD says to. The test is narrow — the DD must name the artifact
and the change, not merely approve the direction. A DD that says "we should improve X" authorizes nothing.

**Corollary for choosing work: rank candidate lanes by Tier C density, not by size.** A large lane whose
decisions are all written down runs to READY untouched; a small lane with three undecided contract
questions stops three times. Before proposing a lane, count its Tier C items — that number, not the line
count, predicts whether `autonomous_to_ready` will actually reach READY.

#### The decision criterion

Every Tier A/B decision is justified by **maximum long-term benefit to the project**, not by what closes the
current round fastest. Operationally, that means one test and five tie-breaks.

**The test:** *would this choice still be right if the project had ten times this surface area in six
months?* If the honest answer is "it would need redoing", it is the wrong choice even when it passes today's
gate.

**Tie-breaks, in order — earlier wins:**

1. **Fail-closed over convenient.** A wrong deny is recoverable; a wrong allow on the money or tenant path may not be.
2. **One source of truth over a second definition.** Two definitions of the same predicate drift, and the drift is silent. (`0032` exists because `assert_dm_allowed` had grown a second reading of the same four toggles.)
3. **Fewer concepts over more.** A new table/role/abstraction must earn itself against reusing an existing one.
4. **Consistent with existing precedent over locally optimal.** If `auth.ts` and `authorization.ts` live in `packages/db/src`, the new service does too — even if another location reads slightly nicer.
5. **Reversible over clever.** Prefer the choice that a later slice can change without a migration or a contract amendment.

When two options tie on all five, pick the one that leaves **more evidence for the next reader** — a named
constraint, a test, a comment that says *why* — and say so in the ledger.

#### Budget is a signal, not a gate

Under `autonomous_to_ready` a budget overrun **never** stops the lane for a number.

- Declare a realistic ceiling up front, measured on a comparable merged slice — not aspirational.
- On overrun, the agent does one of: **(a)** re-slice within the declared scope; **(b)** continue and log an
  overrun entry naming the *design* reason. Both are Tier B.
- The overrun entry must answer: what did the estimate miss, and is that a property of this slice or of the
  contract? A second overrun on the same cause is a **design signal** — stop patching and re-slice.
- An overrun that can only be resolved by touching negative scope is Tier C.

#### After `HALT MAX_ROUNDS` or `REGION_THRASH`

Pre-authorized when **both** hold: the findings are accepted (not contested), and the agent can name a
*design* cause rather than a list of symptoms. Then the agent opens the successor itself — fresh
registration from current `main`, HALTed branch read-only, redesign stated in the successor contract.

Contested findings, or no nameable design cause, → AWAIT. "Try again harder" is not a design cause.

#### Reviewer unavailable

Still `HALT TOOL_UNAVAILABLE` — an external dependency, not a decision. But wait-and-retry with backoff
first; an account-wide saturation is a WAIT, not a reason to downgrade the gate. Never self-certify.

#### Decision Ledger — the artifact that makes this safe

One per lane: `.autopilot/state/<feature>/DECISIONS.md`, appended as decisions are made, **not**
reconstructed at the end.

```text
## D<n> · <tier A|B> · <one-line decision>
Context:      <what forced a choice>
Searched:     <exact queries run over docs/ and packages/, and their results —
               including the ones that returned nothing>
Alternatives: <what else was considered, and why not>
Reasoning:    <which tie-break applied, and the 10x test>
Evidence:     <exact files/lines/commits read; cite the precedence rung relied on>
Reversible:   <yes/no — if no, justify why this is not Tier C>
```

`Searched:` is not decoration. It is the only field a reviewer can use to judge whether the agent decided
from the corpus or from its own priors — and priors are exactly what produced `DD-106`.

At READY the agent reports: outcome, evidence, **and the ledger**. The owner reviews all decisions in one
pass. A Tier-B decision the owner rejects becomes a follow-up slice, not a re-litigation of the lane.

An empty ledger on a non-trivial lane is a red flag, not a clean run — it means decisions were made without
being recorded.

#### Entry conditions

`autonomous_to_ready` requires all of: risk `P1` or `P2`; packet at strict `CODE_READY`; scope and negative
scope enumerated at file level; verification commands runnable by the gate; the pinned reviewer reachable;
the always-load core actually loaded. `P0` never qualifies. `P3` has no writer and does not need the mode.

Everything else in this document still applies unchanged: worktree isolation, scope-gate registration, two
clean review rounds, loop breakers, and **human merge**. `autonomous_to_ready` removes mid-flight
interrupts. It does not remove the gate, and it never implies auto-merge.

## 9. Terminal-state additions

### READY

- under `autonomous_to_ready`: the **Decision Ledger** (`.autopilot/state/<feature>/DECISIONS.md`), which is
  the owner's single batch review point. READY without a ledger is incomplete in that mode.

### AWAIT

> Under `autonomy_mode: autonomous_to_ready`, AWAIT is restricted to the **Tier C** list in §6.1. An AWAIT
> raised for a Tier-A or Tier-B item is a contract violation: resolve it and record the misclassification in
> the Decision Ledger. Budget numbers are never a valid AWAIT reason in this mode.
