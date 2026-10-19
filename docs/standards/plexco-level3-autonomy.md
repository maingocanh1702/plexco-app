<!-- review-readiness: policy -->
# Plexco Level 3 autonomy supplement (DD-107)

This is Plexco's consumer-owned **local supplement** to §6.1 `autonomous_to_ready` of the
[canonical workflow](../autopilot-templates/level3-workflow.md). Since KIT_VERSION 43 (canonical
`a6097b36c153d07194e1464924c8e74acc53df63`), canonical §6.1 states the generic rules; this file binds
them to Plexco's files and keeps the measured evidence behind them. `CLAUDE.md` and `AGENTS.md` name
this file, which is how Plexco opts in. It sits outside the kit pack, so a kit sync never overwrites it.
Read it together with canonical §6.1 whenever a task runs under `autonomous_to_ready`: canonical §6.1
states each rule; this file names Plexco's instances of it and records where Plexco differs — who elects
the mode and the Web MVP program's owner override (§3), and two rules stricter than canonical (*Review
rounds (DD-107)* and the demotion pin under *Tier C instances in Plexco*). *Changes adopted from canonical
KIT 43* lists where the rules moved.

Authority: [DD-107](./decisions.md) (owner-final, 2026-08-14), amended for KIT 43 by the ✅ amendment the
owner signed in the Claude Code session on 2026-10-19 (see *Changes adopted from canonical KIT 43*). History: the DD-107 additions (§6.1 and the §9 READY/AWAIT
notes) lived in Plexco's copy of `docs/autopilot-templates/level3-workflow.md` through Plexco commit
`dd5375f71a6c05c9ca1ac33e38d3aa241efc897a`; DD-107 itself is in `decisions.md`.

Headings keep the canonical section numbers they extend, so existing references to
"`plexco-level3-autonomy.md` §6.1" and "§9" still land here. A reference to
"`plexco-level3-autonomy.md` §6.1 item N" means Tier C item N of canonical §6.1; Plexco's instances of
those items are listed below under *Tier C instances in Plexco*.

## 3. Recording and electing the mode

- **Task contract:** `AUTONOMY_MODE: autonomous_to_ready` (canonical §3 lists the value).
- **Runtime manifest, and the authored manifest it is resolved from:** `autonomy_mode: "supervised"`.
  `scripts/autopilot-review-readiness.mjs` accepts only `supervised` and `proactive_routine` and requires
  `supervised` at P1; `autonomous_to_ready` there halts `register` with `CONTRACT_INVALID`.
  `docs/autopilot-manifests/session-routes-close-cancel.json` is the established example of applying
  DD-107 behaviour under the `supervised` runtime value. Known historical exception, left unedited:
  `docs/autopilot-manifests/docs-impact-policy-contract.json` (authored contract, P1) still carries
  `"autonomy_mode": "autonomous_to_ready"`, so registering it as-is would halt `CONTRACT_INVALID`.
- The gate-level mode therefore stays `supervised`, and `CLAUDE.md`'s "P1 luôn supervised" stays true.
  No kit gate reads the mode; its tiers, its Decision Ledger and its AWAIT restriction are rules the agent
  follows and the owner checks at READY.
- **Who elects the mode.** The owner elects the mode per task (task request or RUN doc), or through an
  owner-signed standing delegation; the primary agent never selects it on its own. Nothing here implies
  auto-merge.
- **The only standing delegation on record** is `DD-122` D3, DEFAULTS row O2, limited to the Web MVP
  program's P1/P2 slices. `docs/sessions/web-mvp-program-status.md` records it as signed through the M0
  merge `1681f5f` (PR #42, 2026-10-13 18:49Z); the row in `decisions.md` still reads "pending owner
  sign-off". **O2 is confirmed in force:** the owner confirmed in the Claude Code session on 2026-10-19 (chose "Còn hiệu lực") that O2 remains in
  force after `DD-131` (whose header says "Mục G thay thế mọi dòng 'default applied' của DD-122 D3" while
  its status line says "Không đổi DD-122 D1/D3/D4"); the confirmation is recorded next to the signature
  line of DD-107's amendment. O2 changes only who elects the mode: the Tier C list, AWAIT on Tier C items,
  the Decision Ledger and human merge are unchanged.
- **Those slices run under `DD-122` D4's review regime:** an independent Claude subagent reviews every PR,
  plus a security-focused subagent when the PR touches auth, permissions, secrets, money, external input
  or deployment; no Codex, and no scope-gate register/ready/ap-finish lifecycle; at most 3 review rounds
  per PR. That is an owner override of canonical §6.1's reviewer and registration conditions (the pinned
  reviewer, scope-gate registration with a `supervised` manifest), scoped to that program. The review-round
  rule that applies there is D4's, not *Review rounds (DD-107)* below, and it keeps D4's fail-closed parts:
  - D4 item 4: fix every `blocking` finding and re-review with a **new** subagent; fix or justify each
    `should-fix` in the PR body; at most 3 rounds per PR; **still blocking after round 3 ⇒ the PR stays
    open, is marked blocked and is listed in the final report.**
  - D4 item 6: the quality gate is unchanged — `pnpm -w test` · `typecheck` · `lint` · `format:check` ·
    `review:check` · `build` green on every PR, plus CI (`.github/workflows/ci.yml`) green before merge.
  - READY there is O2's bar: **PR open + gate green + clean review** (the final subagent review clean);
    P0 stays prepare-only.

## 6.1 Plexco binding of `autonomous_to_ready`

The decision authority ladder, Tier C items 1–9, the AWAIT restriction and the Decision Ledger are in
`docs/autopilot-templates/level3-workflow.md` §6.1 (AWAIT restriction: §9); this section only binds them to
Plexco.

### Entry readiness verdict

The project readiness verdict that canonical §6.1 *Entry conditions* requires before implementation
starts is a packet at strict **`CODE_READY`** under
[`review-code-readiness-gate.md`](./review-code-readiness-gate.md).

### Review rounds (DD-107)

Plexco (DD-107): a slice under this mode reaches READY only after **two clean review rounds at P1 and
P2** — stricter than the gate's floor (≥2 at P1, ≥1 at P2). DD-107 lists "hai vòng review sạch" among the
things the mode does not change.

Bind it mechanically: under this mode at P2, set `code_review.clean_rounds: 2` in the manifest. The gate
requires `clean_rounds` to be at least its floor and then runs that many code-review rounds, each of which
must end CLEAN (`scripts/autopilot-review-readiness.mjs`), so it enforces two. This is Plexco's reading of
DD-107: the gate's P2 floor was already 1 on 2026-08-14 (the tree at `2f859dd`; the floor dates from
`49fd155`). The rule does not apply to Web MVP program slices under `DD-122` D4 (see §3).

### Why the mode exists here (measured)

Under `supervised`, the agent stopped for a decision the moment one appeared, even when the answer was
derivable from the repo. Measured cost on `session-service-create-command-core` v1 (2026-08-13): **four
owner round-trips on budget alone** (300→360→440→470 compact), and the lane still ended
`HALT MAX_ROUNDS` — the budget was never the binding constraint, the validation design was. Every one of
those four stops produced a number, not an insight. Meanwhile three of the four authoring blockers (B1
acceptance matrix, B2 module home, B3 producer contract) were resolved by *reading the repo*; only B4 was
a genuine owner decision.

### Corpus size

Measured at `1fdba1d`:

| Set | Size | Roughly |
|---|---|---|
| Whole `docs/` corpus | 303 files · 8.5 MB · 1.13M words | **~2M+ tokens** |
| Just the six core authority docs | 871 KB | **~220k+ tokens** |
| `decisions.md` summary table only | 60 KB · 126 lines | ~18k tokens |

The full corpus is an order of magnitude past any context window; even the six core docs overflow one on
their own. The live proof is in this repo: the `session-service` build session hit **98% context** having
loaded only its own slice's context pack.

### Always-load core

`docs/00-start-here/HANDOFF.md` live-truth block · `decisions.md` **summary table** (the `| DD-nn |` rows,
not the full bodies) · `docs/standards/review-code-readiness-gate.md` · the slice's own packet
(`docs/autopilot/contracts/autopilot-<slug>.md`) and manifest. This is the constitution; it fits.

### Corpus maps and search span

Search `docs/` **and** `packages/`/`apps/` (canonical's "the docs and the source tree"), then read the hits
that matter; the ledger's `Searched:` field covers both. The maps are `docs/docs-inventory.md` and
`docs/features/README.md`.

### Authority rungs mapped to Plexco files

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

Plexco's terms in the canonical tie-breaks, each of which has already cost a session here:

- the slice's authored contract is its **packet on its own branch**, which outranks the copy on `main`;
- a newer current-state block is a newer **live-truth block** (for example in `HANDOFF.md`), and an older
  block's instructions go stale too, not just its numbers;
- **`Doc status ≠ Implementation status`:** `Reviewed` never implies runtime; the `BUILD-STATUS`/`ROADMAP`
  axes do, and only from runner output.

### Tier C instances in Plexco

Canonical §6.1 fixes the Tier C list; Plexco names instances of its items and never adds or removes one.

- **Item 2:** the 5 HARD RULES in `CLAUDE.md`.
- **Item 5 covers any flag or env that turns behaviour on in production, listed or not.** Known instances,
  each read in code: `OUTBOX_DISPATCH_SCHEDULE_ENABLED` (`apps/bot/src/worker.ts`); `GOOGLE_OAUTH_*`;
  `GENDER_COLLECTION_ENABLED` (`apps/web/app/api/me/profile/route.ts`, DD-54: only `"true"` turns on gender
  collection, a PII path); `CSP_SCRIPT_NONCE_ENABLED` (`apps/web/middleware.ts`: `"true"` turns on the
  per-request nonce CSP, off by default); `DB_EXPECTED_ROLE` (`apps/web/lib/session-cookies.ts`: when set,
  every DB query waits on a role check and a mismatch fails the DB-touching routes closed; opt-in under
  `DD-122` D3). Not item-5 instances: `PLEXCO_DEV_LOGIN` cannot be on in production (boot refuses it
  outside development, `apps/web/next.config.mjs`), and `TRUSTED_INGRESS_PROVIDER` is a required
  production setting rather than a switch (`direct` is refused in production); changing any production
  env is still item 6. Re-measure the env surface with
  `grep -rhoE 'process\.env\.[A-Z0-9_]+' apps packages | sort -u` — a starting point, not a complete
  list: it misses dynamic reads such as `process.env[name]` and env objects passed as parameters (for
  example `assertDevLoginBootSafe(process.env)` in `apps/web/next.config.mjs`), so follow those call
  paths too.
- **Demotion rule, pinned for Plexco:** only an owner-final (✅) DD or OD in `docs/standards/decisions.md`
  that names both the artifact and the change demotes a Tier C item to Tier A. 🟡/⬜ proposals, unsigned
  defaults, RUN-doc tables and Decision Ledger entries never demote a Tier C item.
- **Demotion rule, worked example:** `DD-104 D2a` naming "action class hẹp `delete_draft_session` trong
  `authorizeTenantAction` (sửa contract billing, slice riêng)" is exactly this: editing that Reviewed
  billing spec is Tier A *for that edit*, because the DD says to.

### Precedent examples for the decision criterion

- **Tie-break 2, one source of truth:** `0032` exists because `assert_dm_allowed` had grown a second
  reading of the same four toggles.
- **Tie-break 4, existing precedent:** `auth.ts` and `authorization.ts` live in `packages/db/src`, so a new
  service does too — even if another location reads slightly nicer.

### The incident behind Tier C items 1–3

`DD-106` (2026-08-13) exists because a spec pass wrote a money contract — `buddy_payment_requests`,
`payment_allocations.source='buddy'` — into two **Reviewed** specs without a decision, while
`decisions.md` already held `DD-26` saying *"không thêm model 'buddy'"*. The doc existed. Nobody read it,
and nobody was reckless; the contract simply had no cheap way to say "this one needs an owner". Items 1–3
are that lesson, priced. "Searched `decisions.md` for `buddy`, found `DD-26`: don't add a buddy model" is
the ledger sentence that would have prevented it — priors, not the corpus, produced `DD-106`.

### Null results that misfired here

The canonical warning that an empty grep is evidence about the query has already misfired here twice: an
`awk` written for backticks against a catalog that used em-dashes returned empty twice and got read as "no
data"; and the language-rule check returned zero hits for a rule that existed but had never been written
down.

### Changes adopted from canonical KIT 43

Moving to canonical §6.1 changes these rules relative to the DD-107 text and to the copy this file carried
before KIT_VERSION 43. Canonical §6.1 (and §9 for the READY and AWAIT points) governs each of them. DD-107's
*Amendment 2026-10-19 — KIT 43 canonical §6.1* in `decisions.md` adopts them for Plexco; it is ✅, signed by
the owner in the Claude Code session on 2026-10-19 (the "Ký" line in `decisions.md` records that act and
quotes what the owner was shown; the merge of the PR merging `chore/kit-sync-43` signs nothing). DD-107's original text and older Plexco documents that still state the earlier form
(for example "exactly 8 items" or "gate violation") are historical on these points, superseded by the
signed amendment.

- **The mode is recorded in the task contract only;** the manifest keeps `supervised` (DD-107's text says
  "Thêm `autonomy_mode: autonomous_to_ready`").
- **Tier C has nine items, not eight.** Item 9 is a doc-authority conflict: two docs both claim to be
  canonical for the same question and neither names a decision ID. The earlier text treated that case as
  "a Tier C conflict" outside the numbered list; references to "exactly 8 items" predate this change.
- **Misclassifying a decision downward is a contract violation (agent-enforced; no kit gate checks tiers
  or the ledger)**, not a "gate violation" as the earlier text said.
- **READY without the Decision Ledger is a contract violation (agent-enforced).** The scope gate writes
  `READY.txt` on a gate pass alone. The earlier text called such a READY "incomplete".
- **A new entry condition:** the project has enabled the mode, i.e. its `CLAUDE.md` names the supplement
  (Plexco: `CLAUDE.md` and `AGENTS.md` name this file).
- **After `HALT MAX_ROUNDS` or `REGION_THRASH`,** a pre-authorized successor registers from the verified
  default-branch tip (earlier: "current `main`"). Without pre-authorization (contested findings, or no
  nameable design cause) the HALT stays the terminal state and the owner decides any successor; the
  earlier text said AWAIT.
- **Reviewer unavailable:** there is no wait-and-retry-with-backoff step. Inside a gate run the gate names
  the case: `REQUIRED_TOOL_UNAVAILABLE` for a missing or non-executable wrapper, `AWAIT CODEX_QUOTA` for a
  usage limit or an interrupted review, and `HALT REVIEW_UNAVAILABLE` for a run without a valid verdict.
  Outside a gate run, `HALT TOOL_UNAVAILABLE`. The earlier text said wait and retry with backoff, then
  `HALT TOOL_UNAVAILABLE`.
- **The AWAIT restriction covers only an AWAIT the agent raises for a decision.** The gate's reviewer
  AWAITs, `AWAIT_CONTEXT` and an AWAIT for missing external authority are unchanged. The earlier text
  restricted every AWAIT under this mode to the Tier C list.
- **"Budget is a signal" covers only the slice's own size estimate.** `wall_time_minutes` and
  `fix_rounds_max` stay hard gate limits in every mode. The earlier text did not draw that line.

Plexco keeps two rules stricter than canonical — *Review rounds (DD-107)* and the demotion pin — and §3
records who elects the mode and the `DD-122` override for the Web MVP program.

## 9. Terminal states

Canonical §9 carries the READY Decision Ledger and the AWAIT restriction since KIT_VERSION 43. Under this
mode, READY without the ledger is a contract violation (agent-enforced): the scope gate writes `READY.txt`
on a gate pass alone, so a gate pass is not a complete READY here. The ledger path is
`.autopilot/state/<FEATURE_ID>/DECISIONS.md`.
