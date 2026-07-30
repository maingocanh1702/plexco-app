# AP-39 — raise the next floor, and be the first slice to run the Level 3 gate for real

> **CURRENT STATE (2026-07-30, second split) — read this before anything below.** This launcher was
> authored for the original next+postcss+brace-expansion registration (`feature: deps-security-bump`).
> Two owner-ratified splits have narrowed it since: (1) 2026-07-29 removed `brace-expansion` — no
> in-range v1 patch exists, forcing v5 breaks `minimatch@3` at runtime; closed separately via
> `eslint-10-migration`. (2) 2026-07-30 removed `postcss` too — a security-review round independently
> reproduced a real, upstream-acknowledged file-read issue fixed in 8.5.23, which `minimumReleaseAge`
> (7 days) blocks landing until 2026-07-31T17:04:03Z; deferred to a follow-up slice rather than
> excepted. **The current and only authoritative execution is `feature: deps-security-bump--next-only`,
> branch `feat/deps-security-bump--next-only`, worktree `.autopilot/worktrees/deps-security-bump--next-only`,
> runtime manifest `.autopilot/state/deps-security-bump--next-only/manifest.json`. Scope is `next` ONLY.**
> See `docs/autopilot-manifests/deps-security-bump.json`'s `_owner_decision` field for full history.
> The body text below (worktree/branch examples, "next + postcss" framing) is the ORIGINAL preflight
> record and is deliberately left as-is below this notice — same convention as the manifest's own
> `_owner_decision` history, which is preserved verbatim rather than rewritten. It is historical, not
> current instruction. `docs/autopilot-deps-security-bump.md` (task contract) and this feature's entry
> in `docs/autopilot-backlog.md` carry the same pre-second-split framing; neither file is in this
> registration's `scope`, so they are not edited by this slice.
>
> **CORRECTION (gate-attempt-05, round 1) — the claim this notice previously made here was wrong and
> has been verified, not merely restated.** `scripts/ap-merge.sh` does NOT reconcile task-contract or
> backlog narrative at merge time — read on disk, it only calls `scripts/autopilot-backlog-reconcile
> --fix`, which rewrites exactly one `status:` line per task and touches nothing else (see that
> script's own `KIT_VERSION 4` header). Worse, for THIS task even that narrow flip will not fire
> automatically: this task's `merged_probe` in `docs/autopilot-backlog.md` is `pnpm-lock.yaml ::
> 15.5.21` — a version-number literal, not a slice-unique code symbol — which `is_symbol_probe()`
> rejects, so `--fix` reports it as `WEAK-PROBE` and explicitly refuses to flip it. **There is no
> automatic mechanism, at merge time or otherwise, that will ever correct
> `docs/autopilot-deps-security-bump.md` or the `deps-security-bump` backlog block's status/narrative
> for this task.** Whoever merges this slice must manually: (1) flip that backlog block's `status:` to
> `merged` (or add a merged-tracking note), and (2) either rewrite or explicitly mark superseded the
> Next+PostCSS framing in both the task-contract doc and the backlog block's `title`/`scope` fields —
> or authorize a widened-scope successor slice to do it. This manifest and this launcher (as of this
> correction) are the only tracked artifacts that currently encode the Next-only reality correctly.

Read canonical `/Users/maingocanh/Projects/Claude template/autopilot/autopilot-prompt-GENERIC.md` (the Level 3
worker contract; its authority is `level3-workflow.md`). It carries no version marker and no numbered trigger
list — earlier launchers told you to confirm "v0.6.1 §0.1" and that section does not exist. Backlog
`kit-dead-citation-prompt-generic-sections` tracks it; it changes nothing you must do.

Execute manifest `docs/autopilot-manifests/deps-security-bump.json` — the authored contract. Read
`_owner_decision` FIRST: `brace-expansion` is deliberately OUT of this slice and `DSB-2b` requires its two
lockfile lines to stay byte-unchanged.

P1 · `dependency-security` · `manual_only` · auto-merge `false` · `2x_clean`. Own worktree at
`.autopilot/worktrees/deps-security-bump`, branch `feat/deps-security-bump` (original, pre-split — the
CURRENT next-only execution is `.autopilot/worktrees/deps-security-bump--next-only`, branch
`feat/deps-security-bump--next-only`; see the notice at the top of this file). Never run from the repo root.

**Base is a condition, not a SHA.** The worktree must sit on an `origin/main` tip containing this launcher —
self-verifying: if `/ap-39-…` invoked, the file is in your tree. If it returned `Unknown command`, the worktree
predates the launcher; `git fetch origin && git reset --hard origin/main` (only while
`git log --oneline main..HEAD` is empty).

**PARALLELISM.** Holds `build-config`. `eslint-10-migration` also holds `build-config` and touches the same
lockfile ⇒ **strictly sequential** with this slice. Nothing else is active.

## THIS SLICE HAS A SECOND OUTCOME — read before the probe

You are the **first slice to generate a Level 3 runtime manifest and clear the real gate**. Owner decision
2026-07-30, backlog `level3-gate-adoption-runtime-manifest`. Every P1/P2 slice before you (AP-37, AP-38) hit
`HALT CONTRACT_INVALID` at `scope-gate ready` and fell back to invoking the reviewer by hand. That fallback is
being retired here.

**Why it fails today, so you do not re-diagnose it:** `autopilot-scope-gate`'s `ready` branch forces
`REVIEW_REQUIRED=1` whenever `scripts/autopilot-review-readiness.mjs` exists on the base ref — regardless of
whether the manifest opted in. The validator then HALTs on its first contract check because
`manifest_schema_version != level3-operational-v2`. **Do not "fix" the scope gate.** Deleting that line was
measured and rejected: `EMPTY_DIFF` and `WORKTREE_DIRTY` live only in the validator (zero occurrences in
`codex-review-pin.sh`), so removing the forcing silently drops two checks for every slice.

**Two roles, never conflate them:**

| Artifact | Role |
|---|---|
| `docs/autopilot-manifests/deps-security-bump.json` | **authored contract**, tracked. Must NEVER gain `manifest_schema_version` — the validator pins the runtime path, so adding it makes `register` HALT. |
| `.autopilot/state/deps-security-bump/manifest.json` | **runtime manifest**, per-run, gitignored, carries the full v2 field set. |

You were chosen for this because `depends_on: []` — that avoids the `dep_checks` proof chain, the most
intricate part of v2.

## Hard authorization gate

1. This launcher and the authored manifest are committed and pushed on `main`.
2. `git diff --stat main...HEAD` empty in this worktree before you start.
3. Scope gate reports this slice as the `build-config` holder; `eslint-10-migration` is NOT active.
4. `CODEX="${AUTOPILOT_CODEX_BIN:?HALT CODEX_UNAVAILABLE}"` resolves to an executable. Reviewer unavailable ⇒
   `HALT TOOL_UNAVAILABLE`; never lower the gate.
5. `not_before: 2026-07-30` has passed.

## Preflight

1. Worktree HEAD equals `origin/main`; `ls .claude/commands/ap-39-*.md` resolves.
2. Green baseline BEFORE any edit — full CI list: `pnpm typecheck`, `pnpm format:check` (`prettier --check .`
   repo-wide), `pnpm review:check`, `pnpm lint`, `pnpm build`, then the DB suite. Baseline is **573** workspace
   tests after AP-38 (was 561 before it; AP-38 added 12). Record what you actually measure.
3. Postgres: `docker compose -f infra/docker-compose.yml up -d postgres`. **`psql` is not on the host** — use
   `docker exec plexco-postgres-1 psql -U plexco -d <db>`. `pnpm db:bootstrap` shells out to `psql` and fails
   here; `job_definer` is cluster-global and already provisioned, which a green DB suite proves. Tests need
   `DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test`.
4. **Generate the runtime manifest** — `.autopilot/state/deps-security-bump/manifest.json`. Copy
   `docs/autopilot-manifests/_TEMPLATE.json` (read its `_role` field first) and fill every field from the
   authored contract plus this run. Requirements measured from the validator, not guessed:

   - `manifest_schema_version: level3-operational-v2` · `review_gate_version: level3-readiness-v2`
   - `task_id: plexco-app:deps-security-bump` · `feature: deps-security-bump` ·
     `branch: feat/deps-security-bump` (must equal `feat/<feature>`; `feature` must equal the task slug)
   - `base_ref: main` · `base_sha` = **full 40-char SHA** from `git rev-parse` (not abbreviated)
   - `risk: P1` (only P1/P2 may register) · `autonomy_mode: supervised` · `writer_processes_max: 1`
   - `scope` = **exact worktree-relative file paths**, no directories, no duplicates. Note the authored
     contract lists the manifest path itself; the runtime `scope` must list the files you will actually edit.
   - `model_policy.independent_reviewer: scripts/codex-review-pin.sh`
   - `code_review`: required `true`, tool `scripts/codex-review-pin.sh`, `clean_rounds: 2`
   - `security_review.required`: boolean, with tool `scripts/codex-review-pin.sh`. This slice touches
     supply-chain inputs, so `true` with a real round is the defensible answer.
   - `budgets.wall_time_minutes`: positive integer · `budgets.fix_rounds_max`: 0–5
   - `stop_conditions` must contain all four: `MAX_ROUNDS`, `REGION_THRASH`, `SCOPE_OR_BASE_DRIFT`,
     `REQUIRED_TOOL_UNAVAILABLE`
   - `readiness_evidence_path: .autopilot/state/deps-security-bump/readiness.json`
   - `dep_checks: []` (empty is correct here — `depends_on` is empty)

   Then `scripts/autopilot-scope-gate register --manifest .autopilot/state/deps-security-bump/manifest.json`.
   **If register HALTs, do NOT hand-roll around it** — that is what AP-38 did and it is what this slice exists
   to end. Record the exact HALT code and message, write `AWAIT-FOUNDER-gate-<code>.txt`, and stop. A failed
   first attempt at the real gate is a useful result; a bypass is not.

5. Re-measure publish dates: `npm view <pkg> time --json`, read the **exact version key** — `time.created` is
   the package's first-ever publish and returned 2011 for `next`. `minimumReleaseAge` is 10080 minutes (7
   days) and must not be lowered or bypassed.

## The two traps in this repo

**(1) `postcss` overrides live in TWO places.** `package.json` `pnpm.overrides` holds a floor (`^8.5.10`);
`pnpm-workspace.yaml` `overrides` holds a conditional rewrite (`postcss@<8.5.10: 8.5.16`). Raising only the
first leaves transitive `postcss` landing on `8.5.16` — the version under advisory — while `package.json`
looks patched. `DSB-4` exists for exactly this.

**(2) `next` may need no override at all.** Item (c) of the authored contract's design probe is **unmeasured**:
`apps/web` may already declare a range containing `15.5.21`, in which case a lockfile refresh suffices. Measure
it; do not copy the manifest's guess.

## Boundaries that fail the slice

- **No `brace-expansion` change of any kind** — not an override, not a floor, not a resolution pin. The v1
  branch has no in-range patch and forcing it to v5 breaks `minimatch@3` at runtime (v1 exports a function,
  v5 CJS exports an object, and `minimatch@3` calls it as a function). `DSB-2b` requires both lockfile lines
  byte-unchanged; a diff there means you drifted into the excluded package ⇒ HALT.
- **No eslint upgrade** — that is `eslint-10-migration`, a separate slice with its own compatibility probe.
- No lowering or per-run bypass of `minimumReleaseAge`, `trustPolicy`, `blockExoticSubdeps`.
- No `--ignore-scripts`, `--no-frozen-lockfile`, `--no-verify`.
- No source-code changes: if a bumped package needs one to compile or pass, that is a separate slice and this
  one HALTs with the exact failure.
- No edit to `.github/workflows/security.yml` and no `osv-scanner.toml` ignore entry.
- **Do not modify `docs/autopilot-manifests/*.json` to add v2 fields.** The runtime manifest is the only place
  v2 belongs.

## Acceptance and terminal state

`DSB-1..DSB-9` plus `DSB-2b` in the authored contract are the functional contract. Write
`.autopilot/state/deps-security-bump/readiness.json` with the seven fields the evidence template defines:
`evidence_schema_version: level3-readiness-v2`, `task_id`, `feature`, `base_sha`, `head_sha`,
`acceptance.status: satisfied`, `breakers.status: clear`. The validator checks identity/base/head against the
live slice, so fill them from `git rev-parse`, not by hand.

Review runs through the gate now, not by direct invocation. Note two facts the template corrected on
2026-07-30 (`33ce1f3`, `43aa833`): the wrapper diffs `base...HEAD` in **committed** history and cannot see the
working tree, so reviewing before committing yields an empty diff — which is not a clean round but **no round
at all**; and `--base` needs the slice's pinned `base_sha`, constant across rounds, not `HEAD^` (which
silently narrows the change set after a fix commit). `EMPTY_DIFF` and `WORKTREE_DIRTY` come from the gate, not
the wrapper.

Loop breakers: `MAX_ROUNDS` 5 · `REGION_THRASH` 3 rounds on the same region · findings spreading across the
design ⇒ stop and re-slice.

End at exactly one of **`READY | AWAIT | HALT`**, writing the marker `level3-workflow.md` §9 names into
`.autopilot/state/deps-security-bump/`:

| Terminal | File |
|---|---|
| `READY` | `READY.txt` — plus the gate's own `gate-result.json`, which is the artifact `ap-finish.sh` requires and which no slice has produced yet |
| `AWAIT` | `AWAIT-FOUNDER-<reason>.txt` — one recommended option, trade-offs, binary resume condition |
| `HALT` | `HALT-<REASON>.txt` — exact reason, forensic state, condition for a successor task |

**Do not merge, do not push to `main`.** Owner merges via `scripts/ap-merge.sh`, which reconciles the backlog
after push.

Finally, close the learning loop (§10). State plainly in the terminal report whether the **real gate** ran,
and if it HALTed, the exact code and what the runtime manifest was missing. That answer is the more valuable
half of this slice: it decides whether every future P1/P2 slice gets an automated gate or keeps hand-rolling
its review.
