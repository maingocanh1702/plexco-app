<!-- workflow-authority: ap3-design -->
<!-- MIRROR — do not edit here. Sources (repo `Claude template`, refreshed 2026-09-10 after wave 1.1):
       docs/level3-native/DESIGN.md                    -> part 1 below (already carries the per-run writer contract)
       docs/level3-native/W1-DECISION-codex-sandbox.md -> part 2 below (BINDING correction)
     Refresh by re-copying both under this header. Plexco-specific bindings live in
     ap3/settings.plexco.json, ap3/routines.json, ap3/README-W2.md and CLAUDE.md section "Lan ap3". -->

> ⚠️ **Two measured corrections are already folded in; read them before trusting any single section.**
> **(1) Wave 1:** `codex` cannot initialize inside Claude Code's Seatbelt sandbox, so the writer only
> codes and stops at `.ap3-run/READY-FOR-REVIEW`; the unsandboxed dispatcher reviews and, only on a CLEAN
> verdict, pushes and opens the PR. Part 2 below is binding wherever part 1 disagrees.
> **(2) Wave 1.1:** the writer contract is passed **per run**
> (`claude -p --settings <run-state copy> --setting-sources ''`), never merged into the repo's
> `.claude/settings.json` — doing that once blocked `gh`, `git push`, `docker` and `psql` in the owner's
> own interactive sessions. Residual gaps: `docs/level3-native/W1-KNOWN-GAPS.md` in `Claude template`.

---

# Part 1 — DESIGN.md (current, includes the wave-1.1 per-run contract)

# ap3 — a native Level-3 workflow (design)

Status: proposal, 2026-09-09. Owner: Linh Hy. Supersedes nothing yet; the existing `autopilot/`
kit stays untouched until ap3 has produced evidence.

> **W1.1 correction (2026-09-10) applies document-wide — see §4 and `W1.1-HANDOVER.md`.** The writer
> contract is installed **per-run** (`ap3/writer-settings.json` + `claude --settings --setting-sources
> ''`), not in the target's repo-wide `.claude/settings.json`, and `install.sh`'s default no longer
> touches that file (opt-in `--repo-wide` keeps the old merge). Where later sections below still say the
> contract lives in a committed `.claude/settings.json`, or tell W2 to "merge settings" repo-wide, or
> describe in-writer/sandboxed Codex or push probes, read them through §4 and
> `W1-DECISION-codex-sandbox.md` (Codex + push run in the unsandboxed dispatcher). Those sections are
> not re-swept here; §4 and the handover are authoritative.

## 1. Goal, in the artifact's own words

Step 3 of "Steps of AI Adoption" (Boris Cherny, 2026-07-16) is unlocked when *"work you would
have kicked off manually now starts proactively"* and the human becomes a *manager of managers*:
Claude writes all or nearly all of the code, verifies it, gets it reviewed, and hands over a
mergeable result; the human merges and steers by exception. The practices the artifact lists for
this step are: subagents, `/loop` / `/batch` / routines, `CLAUDE.md` standards, a Skills registry,
token controls, sandboxing, cost monitoring.

Definition of done for ap3 (owner decision 2026-09-09):

> A run starts without a human typing anything, and reaches **READY = an open pull request with
> tests green, an independent review verdict of CLEAN, and its own cost/evidence row** — with zero
> human help during the run. The human's only job is to merge (or reject) the PR.

Out of scope for now (deliberately): auto-merge, Claude choosing its own work from a backlog, the
E0–E11 certification scale of the old kit.

## 2. Why a new kit instead of fixing the old one

The old kit (`autopilot/`) reached the step-3 *structure* but stalled at the first proactive run
(2026-09-09, `AWAIT-FOUNDER-exec-permission-blocked`): under `--permission-mode acceptEdits` every
shell command in a headless session needs an approval nobody is there to give. The old kit also
re-implements in bash what Claude Code 2.1.177 (installed) now provides natively: worktrees,
sandboxed auto-approved bash, permission allow/deny rules, hooks, subagents, Skills, per-run budget
caps and a JSON result that already contains `total_cost_usd`, `num_turns`, `duration_ms` and
`permission_denials`. ap3 uses those primitives and keeps only the parts of the old kit that carry
real value.

Kept from the old kit:
- `scripts/codex-review-pin.sh` — the pinned, ephemeral, read-only Codex reviewer (owner choice:
  the independent reviewer stays Codex).
- Test-first as a hard rule (RED proven before GREEN).
- The evidence ledger idea (one row per run, never fabricated, `unavailable` when unknown).
- Stop-rule names: `MAX_ROUNDS`, `SCOPE_DRIFT`, `VERIFY_FAIL`, `MISSING_CONTEXT`, `BUDGET`.
- "Founder merges at READY" as the human boundary.
- Telegram notification via `~/.ap-watch.env` (`AP_WATCH_TG_TOKEN`, `AP_WATCH_TG_CHAT`).

Dropped: `autopilot-scope-gate` binary and its registrations, `ap-watch.sh` daemon, `INFLIGHT.md`,
landings/dispositions/finish-intents, `KIT_VERSION` trust gate, the `level3-operational-v2`
manifest schema, `ap-init`/`ap-new`/`ap-intake` commands, E0–E11 certification.

## 3. Architecture

```text
launchd (every 15 min)                      target project repo
  └─ ap3/dispatch.sh ──► picks 1 queued task ──► git worktree (base = origin/main SHA, pinned)
                         (class enabled, scope ⊆ allowed_scope, caps OK)
                                                   └─ claude -p  (headless writer)
                                                        settings: sandbox + allow rules + hooks
                                                        skill: ap3-slice  (plan → RED → GREEN →
                                                               Codex review loop → PR)
                                                        └─ result.json (cost, turns, denials)
  next tick ─► reconcile: result.json → evidence row → push to PR branch → Telegram
               PR merged? → trust.json clean_runs++   PR closed / HALT → class paused
human: reads Telegram, opens PR, merges or rejects.  Nothing else.
```

Five moving parts, all small:

| Part | Where | Size |
|---|---|---|
| Queue | `ap3/queue/<slug>.md` (committed) | task files with YAML frontmatter |
| Registry | `ap3/routines.json` (committed, owner-edited only) | which task classes may auto-start, their boundaries |
| Dispatcher | `ap3/dispatch.sh` + `ap3/install-launchd.sh` | ~150 lines bash, python3 for JSON |
| Writer contract | `.claude/settings.json`, `.claude/skills/ap3-slice/SKILL.md`, `ap3/hooks/*.sh`, `ap3/review.sh` | the headless session's permissions, procedure, guardrails |
| Evidence | `ap3/evidence.jsonl` (committed via the PR), `ap3/state/` (gitignored), `ap3/report.sh` | cost / cycle-time / intervention monitoring |

## 4. The writer contract (this is the E12 fix)

> **W1.1 correction (2026-09-10, measurement wins — see `W1.1-HANDOVER.md`).** The contract below is
> installed **per-run**, not in the target's `.claude/settings.json`. `install.sh` writes it to a
> tracked `ap3/writer-settings.json`, and the dispatcher hands it to the writer with
> `claude --settings <abs path in the MAIN checkout>`. It does **not** touch `.claude/settings.json`.
> Why: `.claude/settings.json` is repo-wide **and** tracked, so its `sandbox` + `permissions.deny`
> would govern the owner's own interactive Claude Code sessions in that repo too — and, unlike the two
> ap3 hooks (which no-op on `[ -n "$AP3_TASK" ]`), `sandbox`/`deny` have no per-session escape. The
> first real Plexco install proved this: it hard-denied the owner's `gh`, `git push`, `docker ps` and
> `psql` within minutes. Probe 4 (`probes/RESULTS.md`) confirms `--settings` carries the sandbox, so
> the per-run file is sufficient. The path is the **main checkout's** copy (never the worktree's), so a
> writer cannot edit its own contract for the next fix round — the same discipline as the immutable
> base `task.md`. If `ap3/writer-settings.json` is absent on the pinned base, the tick reports a
> **non-terminal** `NO_WRITER_SETTINGS` and starts nothing (like `FETCH_FAILED`; it resolves the next
> tick once you commit + push the contract) — never a silent unsandboxed start. (The launch-time
> presence/`FS_ISOLATION_UNSAFE` checks are terminal HALTs for the rarer corrupted-run-state cases.)
> The old repo-wide merge survives behind an explicit, documented `install.sh --repo-wide` for anyone
> who deliberately wants the whole repo sandboxed.

The authoritative contract is **`ap3/settings.template.json`** (resolved from the project's
`ap3/settings.<project>.json` when present) — read it there rather than a copy here, which drifts (the
W1-DECISION trimming already left an older inline copy showing openai domains and `gh`/`codex` allow
rules the real template no longer carries). Its shape, and the design intent of each part:

- `sandbox.enabled: true` + `autoAllowBashIfSandboxed: true` — the OS Bash sandbox is on and a
  sandboxable command runs without a prompt (the E12 fix; the writer needs no per-command approval).
- `sandbox.network.allowedDomains` — github + npm only. The writer does **not** call Codex (the
  dispatcher does, unsandboxed — `W1-DECISION-codex-sandbox.md`), so no openai domains.
- `sandbox.filesystem.denyRead` — OS-enforced block on `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.codex`,
  `~/.ap-watch.env`, `**/.env*`, `**/.envrc`.
- `permissions.allow` — coding tools + `Bash(git *)`, `Bash(npm …)`, `Bash(npx *)`, `Bash(bash ap3/*)`;
  no `gh`/`codex`/push. `permissions.deny` — `Bash(git push*)`, `git reset --hard`, `rm -rf`, `.env`
  reads, `WebFetch`, `WebSearch`.
- `hooks.PreToolUse` (`Edit|Write|MultiEdit`) → `scope-guard.sh`; `hooks.Stop` → `finish-guard.sh`.
  Both no-op on `[ -n "$AP3_TASK" ]`, so they never affect a normal interactive session in the repo.

The dispatcher isolates this contract from the target repo's own `.claude/settings.json` (and `~/.claude`
and `.local`) with `--setting-sources ''`, because `--settings` otherwise LOADS ON TOP of those scopes
and array keys (`permissions.allow`/`deny`, `allowedDomains`) union across them — so a repo's own
settings could weaken the writer. Probe 4 (`probes/RESULTS.md`) proves this closes the **permissions**
vector on the installed `claude` 2.1.177 (a hostile project `deny: Bash(git *)` is applied without the
flag, ignored with it). Two precision caveats, both from the sandboxing docs: (a) excluding a source's
`sandbox.filesystem` entries via `--setting-sources` **requires ≥ 2.1.246**, so on 2.1.177 a hostile
scope's `filesystem.allowRead` is still merged — but a *specific* `denyRead` in the contract holds
inside a *broader* hostile `allowRead` (deny-wins), so only a more-specific hostile allow could
re-expose a path (narrow residual, recorded in `W1-KNOWN-GAPS.md` §6); (b) `failIfUnavailable: true`
makes a sandbox that can't start a hard failure instead of the default warn-and-run-unsandboxed.

Headless invocation (by the dispatcher, cwd = the worktree):

```bash
claude -p "$(cat ap3/prompts/run.md)" \
  --settings "$STATE/writer-settings.json" \      # W1.1: the per-run contract, materialized from the pinned base
  --setting-sources '' \               # W1.1: load NONE of user/project/local — the contract stands alone
  --permission-mode dontAsk \          # never hangs: anything not allowed above is denied and logged
  --max-budget-usd "$BUDGET" \         # native token control, per task (no --max-turns: absent in 2.1.177)
  --model "$WRITER_MODEL" \
  --output-format json > "$STATE/result.json" 2> "$STATE/stderr.log"
```

Why `dontAsk` and not `bypassPermissions`: with the allow list above the writer already has
everything a slice needs; `dontAsk` turns every *unexpected* request into a logged denial
(`permission_denials` in `result.json`) instead of a hang or a silent bypass. Those denials are
evidence for tuning the allow list. `bypassPermissions` is the documented fallback *inside the
sandbox only*, to be used if wave-1 probes show `dontAsk` blocking something essential.

Facts from the Claude Code docs that shape this (verified 2026-09-09 against
code.claude.com/docs — sandboxing, permission-modes, headless):
- `dontAsk` denies anything not covered by `permissions.allow` or the built-in read-only command
  set; `AskUserQuestion` is denied even if allowed — hence HALT `MISSING_CONTEXT` instead of asking.
- With `sandbox.enabled` + `autoAllowBashIfSandboxed` (default true) a sandboxable command runs
  without a prompt; a command that *cannot* be sandboxed (network to a non-allowed host, SSH)
  falls back to the permission rules — so `git push`/`gh` still need their allow rules, and may
  need `sandbox.excludedCommands` if the SSH/HTTPS path does not go through the sandbox proxy.
  Probe 2 and the W2 push probe decide this; do not guess.
- Inside the sandbox, writes to the files Claude Code loads configuration and code from
  (`.claude/settings*.json`, hook scripts) are denied and cannot be exempted — the writer cannot
  widen its own permissions. Keep hooks under `ap3/hooks/` and let the scope-guard deny edits
  there too.
- Prefer `sandbox.filesystem.denyRead` for credential paths (`~/.ssh`, `~/.aws`, `**/.env*`) —
  it is OS-enforced for child processes; the `Read(...)` deny rules only cover Claude's own tool.
- Do **not** use `--bare` (it skips hooks, skills and `CLAUDE.md`, which ap3 depends on) and do
  not rely on `--permission-prompts none` (requires ≥ 2.1.259; installed is 2.1.177).

Two hooks replace the old scope-gate:

- `scope-guard.sh` (PreToolUse on Edit/Write): reads the task's `scope` globs from `$AP3_TASK`,
  denies any edit outside them (test directories in scope are allowed; `.ap3-run/**` scratch is
  always allowed). Denial reason names the file and the scope, so the writer either stays in
  scope or HALTs with `SCOPE_DRIFT`.
- `finish-guard.sh` (Stop): if neither `.ap3-run/READY` nor `.ap3-run/HALT.md` exists, block the
  stop once with the reason "open the PR (READY) or write HALT.md with a stop-rule name". Guarded
  by `stop_hook_active` so it cannot loop.

## 5. Queue and registry

`ap3/queue/<slug>.md`:

```markdown
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
…what is wrong, how to reproduce…
## Acceptance
…observable behaviour the test must pin…
## Context
…files, docs, prior decisions (paths only; the writer reads them itself)…
```

`ap3/routines.json` (owner-edited only; the dispatcher never writes it):

```json
{
  "schema": "ap3-routines-v1",
  "writer_model": "claude-sonnet-5",
  "classes": {
    "bugfix-small": {
      "status": "enabled",
      "risk": "P2",
      "allowed_scope": ["src/**", "test/**"],
      "budget_usd_max": 10,
      "max_runs_per_day": 1,
      "review": "codex",
      "security_review": "auto"
    }
  }
}
```

Dispatch preconditions (all fail-closed): class `enabled`; every task scope glob is under one
`allowed_scope` glob; `budget_usd ≤ budget_usd_max`; daily cap not hit; no run in flight; no
`ap3/PAUSED` file; `origin/main` fetch succeeded.

### 5.1 Task file contract

A queue file is dispatchable only if `bash ap3/lint-task.sh ap3/queue/<slug>.md` passes. The owner
runs it before committing; the dispatcher runs the same lint on every tick and **skips** (never
starts) a failing file, logging `INVALID_TASK <slug>: <reason>` and notifying once per file.

Machine-checked by the lint:
- Path is `ap3/queue/<slug>.md`; `slug` matches `^[a-z0-9][a-z0-9-]{2,60}$` and equals the
  frontmatter `slug`; no run record and no `origin` branch `ap3/<slug>` exist yet.
- Frontmatter is valid YAML with these required keys and types: `slug` (string), `class` (string),
  `risk` (`P1`|`P2`|`P3`), `scope` (non-empty list of globs), `verify` (non-empty string),
  `budget_usd` (number > 0), `max_review_rounds` (integer 1–5). Unknown keys are ignored.
- `class` exists in `routines.json` with `status: enabled` and is not `paused` in `trust.json`;
  `risk` equals the class's risk.
- Every `scope` entry is under some `allowed_scope` glob of the class, and none of them touches
  `.claude/**`, `ap3/**`, `.github/**`, or a file matching `**/.env*` — those are never in scope
  for a routine, whatever the registry says.
- `budget_usd ≤ class.budget_usd_max`.
- `verify` starts with a prefix the writer may run under §4 (`npm test`, `npm run`, `npx`,
  `bash <path inside the repo>`); anything else would die at RED on a permission denial.
- The body has the headings `## Problem`, `## Acceptance`, `## Context`, each non-empty, and every
  repo path named in Context exists at `origin/main`.
- The file is on `origin/main`. The dispatcher reads the fetched ref, never the working tree.

Immutability: once a run has started, the dispatcher reads the task from
`git show <base_sha>:ap3/queue/<slug>.md` (scope proof, evidence); editing the file while its run
is in flight affects only a later run. A merged task's file is moved to `ap3/queue/done/` by the
owner in the same PR or afterwards — the dispatcher never deletes queue files.

Author-checked (what makes READY reachable; the lint cannot see these):
- Acceptance names a behaviour a test can pin **and that fails today** — if it cannot fail, RED is
  impossible and the run ends `VERIFY_FAIL`.
- Scope lists every file the change needs, test files included; one more file means
  `SCOPE_DRIFT`. One concern per task, about five files or fewer.
- Context carries every decision already made (approach, naming, what must not change — the old
  kit's `negative_scope` lives here as prose); anything the writer would have to ask becomes
  `HALT MISSING_CONTEXT`. Test: could an engineer with no chat access finish from this file alone?
- No manual steps, no UI clicks, no secrets, no network outside `allowedDomains`, no schema
  migration or data backfill in a P2 class.
- The work fits `budget_usd`; split it otherwise. Two queued tasks with overlapping scope are
  queued one after the other, not side by side.

## 6. The slice procedure (`.claude/skills/ap3-slice/SKILL.md`)

1. Read the task file. Restate scope and acceptance in `.ap3-run/plan.md` (≤ 20 lines).
2. **RED**: write or extend the test that pins the acceptance criterion; run `verify`; it must
   fail for the expected reason. Record the failing output in `.ap3-run/red.txt`.
3. **GREEN**: implement inside scope only. Run `verify` until green; then the project's full test
   command if it exists and takes < 10 min.
4. Commit on the run branch (`ap3/<slug>`) with a conventional message.
5. **Independent review**: `bash ap3/review.sh code --base "$AP3_BASE_SHA"` → pinned Codex,
   read-only, ephemeral, fed the task file + full diff; must print `AP3_REVIEW_VERDICT: CLEAN` or
   `AP3_REVIEW_VERDICT: FINDINGS` followed by numbered findings. Fix, commit, re-run. Stop at
   `max_review_rounds` with `HALT MAX_ROUNDS`.
6. **Security review** when `security_review: auto` and the diff touches auth, secrets, money,
   external input or shell/SQL construction (path + grep heuristic in `review.sh`):
   `bash ap3/review.sh security --base …`, same verdict contract.
7. **Scope proof**: `git diff --name-only "$AP3_BASE_SHA"..HEAD` must be a subset of the task's
   scope globs (`bash ap3/scope-check.sh`). The PreToolUse hook only sees Claude's own Edit/Write
   calls; a `sed -i` inside sandboxed bash can still touch any file in the worktree, so the diff
   is the boundary that counts. Out-of-scope files → `HALT SCOPE_DRIFT`, no PR.
8. Push the branch; `gh pr create` with the template body (task, what changed, RED→GREEN proof,
   review rounds + verdicts, stop rules honoured, `cost: filled by dispatcher`). Write
   `.ap3-run/READY` containing the PR URL. Stop.

HALT instead of READY when: a needed edit is outside scope (`SCOPE_DRIFT`), verify still fails
after 3 GREEN attempts (`VERIFY_FAIL`), the task needs a decision the file does not give
(`MISSING_CONTEXT` — write the exact question), review rounds exhausted (`MAX_ROUNDS`). Budget is
enforced natively (`BUDGET`). A HALT never opens a PR; it leaves the branch and `HALT.md`.

Subagents: the writer may use `Agent` subagents for exploration and for running the long test
suite in parallel with drafting the PR body; the review itself is Codex, not a subagent, by owner
choice.

## 7. Dispatcher (`ap3/dispatch.sh`)

Runs from launchd every 15 minutes (`StartInterval 900`, `RunAtLoad false`), logs to
`~/Library/Logs/ap3/<repo>.log`. Idempotent; every tick does, in order:

1. `ap3/PAUSED` present → exit 0 (`PAUSED`).
2. Take the lock (`mkdir ap3/state/.lock`); stale if its pid is dead.
3. `git fetch origin main` (fail → exit, `FETCH_FAILED`).
4. **Reconcile** every run in `ap3/state/runs/*.json`:
   - `running` and `result.json` absent and pid alive → exit `BUSY`.
   - `running` and pid dead, no `result.json` → mark `HALT CRASH`, notify.
   - `result.json` present → parse it; read `.ap3-run/READY` or `HALT.md`; re-run the scope
     proof independently (`git diff --name-only base..HEAD` ⊆ scope) — a violation overrides a
     READY claim: mark `halted SCOPE_DRIFT`, close the PR with a comment, pause the class; else
     append the evidence row (§8) to `ap3/evidence.jsonl` **on the run branch**, commit, push
     (the PR then carries its own evidence); mark `ready` / `halted`; Telegram:
     `✅ READY <slug> <PR url> $cost turns dur` or `⛔ HALT <slug> <reason>`.
   - `ready` → `gh pr view --json state,mergedAt,mergeCommit,reviews,commits`: merged → compare
     the merge's parent with the PR head; unchanged → `trust.json[class].clean_runs++`; changed
     by a human → `human_interventions++`, `clean_runs = 0`; closed unmerged → `rejected`.
     Merged or rejected → remove worktree (`git worktree remove`), archive the run record.
   - any `halted` → set the class to `paused` in `ap3/state/trust.json` (the owner re-enables by
     editing `routines.json` — trust is re-earned, never auto-restored).
5. Daily cap per class (count today's `started_at` in run records).
6. Pick the first `ap3/queue/*.md` (sorted) that is not already in `state/runs`, passes §5
   preconditions.
7. `git worktree add -b ap3/<slug> ap3/state/worktrees/<slug> <origin/main SHA>`; write the run
   record `{slug, class, base_sha, started_at, nonce, budget_usd, started_by: "ap3-dispatch"}`.
8. Export `AP3_TASK`, `AP3_BASE_SHA`, `AP3_SLUG`, `AP3_STATE`; start `claude -p …` (§4) with
   `nohup … &`, record the pid; exit `STARTED`.

No tick ever pushes to `main`, edits `routines.json`, or deletes a worktree that still has an
open PR.

## 8. Evidence and monitoring

One JSON row per run, appended by the dispatcher from `result.json` and the run's own files:

```json
{"slug":"payment-webhook-retry","class":"bugfix-small","risk":"P2","base_sha":"…","head_sha":"…",
 "started_by":"ap3-dispatch","started_at":"…","finished_at":"…","duration_ms":1830000,
 "num_turns":142,"total_cost_usd":4.21,"permission_denials":0,
 "verify":"pass","review_rounds":2,"review_verdict":"CLEAN","security_review":"not_required",
 "terminal":"READY","pr_url":"…","human_interventions":null,"merged_unchanged":null}
```

`human_interventions` and `merged_unchanged` are filled at merge time by the reconcile step.
`ap3/report.sh [--since 7d]` prints: runs, READY rate, mean/max cost, mean cycle time,
interventions, denials by tool; a second launchd job posts it to Telegram every Monday 09:00.
This is the cost / intervention / cycle-time monitoring the artifact asks for, with real numbers
from day one — nothing is estimated.

## 9. Trust ladder

`ap3/state/trust.json` per class: `clean_runs`, `paused`, `last_exception`. A class with
`clean_runs ≥ 3` is *eligible* for the owner to raise `max_runs_per_day` or, later, to enable
auto-merge behind CI — that promotion is a hand edit of `routines.json`, never automatic. Any HALT,
crash, rejected PR or human fix-before-merge pauses the class and resets `clean_runs`.

## 10. Ladder mapping

| Step-3 signal | ap3 mechanism |
|---|---|
| Work starts proactively | launchd → `dispatch.sh` → `claude -p` in a fresh worktree; no human command |
| Manager of managers | human only reads Telegram and merges PRs; every run is a PR |
| Subagents | `Agent` allowed; writer uses them for exploration/parallel verification |
| Routines / loops | the dispatcher is the routine; queue files are the batch; upgrade path: `/schedule` (cloud routines) once the repo is on GitHub with a cloud environment, `/loop` for interactive supervision |
| `CLAUDE.md` standards + Skills | `CLAUDE.md` section "ap3 slices" + `ap3-slice` and `ap3-review` skills |
| Automated code + security review | `review.sh` → pinned Codex, verdict contract, bounded loop |
| Token controls | `--max-budget-usd` (no `--max-turns`: absent in 2.1.177), per-class `budget_usd_max`, daily cap |
| Sandboxing | Claude Code sandbox with domain allow-list; `dontAsk` permission mode |
| Cost monitoring | `evidence.jsonl` from `result.json`, `report.sh`, weekly Telegram |

`DEMONSTRATED_STEP: 3` is claimed only after **three** dispatcher-started runs on a real project
reached READY with `human_interventions = 0` during the run.

## 11. Waves

- **W1 — build the kit** (Claude template repo, branch `feat/ap3`): everything in §3–§9,
  `ap3/test/` (bash tests for dispatch preconditions, reconcile transitions, scope-guard,
  review verdict parsing, evidence row), three probes (§12), a Codex review round of the kit
  (owner's standing rule), `ap3/README.md`. No change to `autopilot/`.
- **W2 — first proactive run** on **Plexco app** (`~/Projects/Plexco app`, decided 2026-09-09):
  `ap3/install.sh <repo>` copies the kit, merges `ap3/settings.plexco.json` into the existing
  `.claude/settings.json` (its `fallbackModel` and two `review:check:changed` hooks must survive),
  installs skills and the launchd plist; the owner records DD-120 and the `CLAUDE.md` "ap3" section
  (see `ap3/CLAUDE-section.md` in that repo), then pushes the prepared queue file
  `ap3/queue/core-package-const-has-no-consumer.md` (class `code-quality-p2`, 2 files in
  `packages/core`, `pnpm test:core`, independent of the unmerged bundle v6). Runbook:
  `ap3/README-W2.md` in the Plexco repo. Success = a PR exists that nobody typed a command for.
  Two further tasks wait in `ap3/queue/_after-v6/` until bundle v6 merges; they add the DB-in-sandbox
  probe (`pnpm test:db` → Docker Postgres on 5432) and the `next build` + security-round path.
- **W3 — evidence**: three READY runs, `report.sh` output pasted into
  `current-workflow.md § Position on the artifact ladder`, `DEMONSTRATED_STEP` re-measured.

## 12. Probes that must pass in W1 before W2

1. **Headless permission probe**: in a scratch repo with the settings from §4, run
   `claude -p "create hello.txt, run 'bash -c echo ok', commit" --permission-mode dontAsk
   --max-budget-usd 0.5 --output-format json` — expect `permission_denials: []`, a commit, and a
   parseable `total_cost_usd`.
2. **Codex-in-sandbox probe**: from the same session, `scripts/codex-review-pin.sh` must reach the
   API (domains in the allow-list, `~/.codex` readable) and print a verdict. If the sandbox blocks
   it, add the domains / the `~/.codex` read path, or move `review.sh` to `excludedCommands`.
3. **Worktree probe**: `git worktree add` from a pinned SHA + `claude -p` with cwd there inherits
   the project `.claude/settings.json` and hooks; `scope-guard.sh` denies an out-of-scope write.
4. **Push probe (W2, on the real target repo, before the first task is queued)**: a `claude -p`
   run with the installed settings pushes a throwaway branch `ap3-probe-<ts>` to `origin` and
   opens + closes a draft PR with `gh`; then the branch is deleted. Expect no denials. This is
   the only probe that needs the real remote and real credentials.

## 13. Owner decisions still open

- ~~Which product project runs W2 first, and which small P2 task is its first slice.~~ Decided
  2026-09-09: Plexco app, `core-package-const-has-no-consumer` (see §11 W2).
- DD-120 in Plexco's `decisions.md` + the `CLAUDE.md` "ap3" section — without them the headless
  writer follows Plexco's old Level-3 contract (scope-gate register, manifests) and stalls.
- Writer model and default budget (proposal: `claude-sonnet-5`, `$8`, `max_runs_per_day: 1`).
- Whether Codex needs `excludedCommands` (runs outside the sandbox) — decided by probe 2.
- Whether sandboxed `pnpm test:db` can reach `localhost:5432` (Docker Postgres) — W2 probe;
  `DATABASE_URL_TEST` must reach the dispatcher's environment without being tracked.


---

# Part 2 — Wave 1 measured correction (BINDING)

# W1 measured correction: Codex review runs in the dispatcher, not the writer

Date: 2026-09-09. Status: binding for the kit built on `feat/ap3`. DESIGN.md §4/§6/§7/§12.2
assumed the sandboxed writer runs `ap3/review.sh` in-session. **Measurement contradicts that; the
measurement wins** (anti-drift rule). This file is the durable record; the handover summarises it.

## What was measured

`codex` 0.153.4 cannot initialize inside Claude Code's macOS Seatbelt sandbox. Every sandboxed
invocation prints, then exits without a verdict:

```
WARNING: proceeding, even though we could not create PATH aliases: Operation not permitted (os error 1)
Error: failed to initialize in-process app-server client: Operation not permitted (os error 1)
```

codex spawns an in-process app-server (a subprocess/socket) that Seatbelt blocks. Five fixes were
tried in real headless `claude -p` sessions under the §4 settings — all reproduce the identical
error:

| # | Attempt | Result |
|---|---|---|
| 1 | `excludedCommands: ["scripts/codex-review-pin.sh"]`, run via the pin | same error |
| 2 | `excludedCommands: ["codex"]`, run `codex exec` directly | same error |
| 3 | `codex exec --sandbox danger-full-access` (codex's own sandbox off) | same error |
| 4 | drop the openai domains so the command "can't be sandboxed" → hoped fallback to unsandboxed | same error |
| 5 | writer runs the command with the Bash `dangerouslyDisableSandbox` parameter | no output produced |

The same pinned command run **unsandboxed** (a plain shell, i.e. what the dispatcher is) works:
`scripts/codex-review-pin.sh exec --sandbox read-only --ephemeral "Reply with exactly: AP3_PROBE_OK"`
→ prints `AP3_PROBE_OK`, model `gpt-6-astra`.

Turning the whole sandbox off for the writer is not an option: probe 1's zero-`permission_denials`
property depends on `autoAllowBashIfSandboxed`; without the sandbox, `--permission-mode dontAsk`
denies the generic bash (`mkdir`, `grep`, `sed`, …) a writer needs. That is the E12 fix; it must stay.

## The corrected architecture

- **Writer (sandboxed, `dontAsk`)** does coding only: plan → RED → GREEN → commit on `ap3/<slug>` →
  self scope-check → write `.ap3-run/READY-FOR-REVIEW` (or `.ap3-run/HALT.md`). It never runs codex,
  never pushes, never opens a PR. So it needs no openai domains and no `gh`/`codex` allow rules.
- **Dispatcher (launchd bash, unsandboxed)** does the network + review work on the finished worktree:
  independent scope-check → `ap3/review.sh code` (+ `security` when the heuristic fires) → on CLEAN
  push the branch, `gh pr create`, append the evidence row, notify READY; on FINDINGS below the round
  cap, write `.ap3-run/REVIEW-FINDINGS.md`, bump the round and re-dispatch a fix writer; at the cap,
  `HALT MAX_ROUNDS` and pause the class. "A PR exists only after a CLEAN review."

This is strictly more independent than the original: the writer cannot see, stub or influence the
reviewer, because the reviewer runs in a different process the writer has no access to.

## Ripple for W2 (owner, before installing on Plexco)

> **Superseded in part by W1.1 (2026-09-10).** The first real Plexco install exposed a second, worse
> problem than any ripple below: merging the writer contract into the repo-wide, tracked
> `.claude/settings.json` hard-denied the owner's OWN interactive `gh`/`git push`/`docker`/`psql` in
> that repo (the `sandbox`/`deny` keys have no `[ -n "$AP3_TASK" ]` escape the two hooks do). The kit
> now installs the contract per-run as `ap3/writer-settings.json` + `claude --settings`; `install.sh`
> leaves `.claude/settings.json` untouched by default. See `W1.1-HANDOVER.md`. The re-install command
> is now `bash <kit>/ap3/install.sh ~/Projects/Plexco\ app --yes` (NOT `--repo-wide`).

- `ap3/settings.plexco.json` — if present, it is the resolved `writer-settings.json` source and still
  lists the openai domains and `Bash(codex *)` / the pin in the writer allow list. Harmless (the
  writer won't call codex) but now unnecessary — may be trimmed.
- `ap3/CLAUDE-section.md` says the writer runs `bash ap3/review.sh code --base "$AP3_BASE_SHA"`.
  Under this correction the **dispatcher** runs it. The writer's rule is "stop at READY-FOR-REVIEW";
  the skill `ap3-slice` states this. Reconcile that sentence in the Plexco CLAUDE section.
- The DESIGN §12.4 push probe now tests the **dispatcher's** push/`gh` (unsandboxed) — lower risk.
