# Autopilot operating invariants — ALWAYS APPLY (all projects)

> Auto-loaded into every Claude Code session via `~/.claude/CLAUDE.md` (@import). These are the
> non-negotiable rules distilled from incidents. Compact prompt: `autopilot-prompt-GENERIC.md`;
> full rationale/archive: `reference/autopilot-prompt-GENERIC.full.md`.
> When running ANY autopilot/feature task, apply these even if the per-task prompt doesn't repeat them.

## Level 3 supervised autonomy — forward-only
- Normative operational authority:
  `$HOME/Projects/Claude template/autopilot/level3-workflow.md`. MUST read it at the start of every
  new task/session/feature opened after the template is installed or refreshed. Never retrofit a
  session already running.
- The primary agent owns the outcome: load code/docs/decisions, derive risk, build the compact task
  contract, split bounded independent slices, delegate agents, monitor them, integrate the result
  and drive to `READY|AWAIT|HALT`. Do not ask the human to route routine implementation steps.
- Human role = manager of managers: outcome, priority, policy, budget, material decisions,
  exceptions, merge/deploy. Auto-merge is separate and OFF.
- Pull required context before acting. Missing material code/wiki/discussion/decision context is
  `AWAIT_CONTEXT`, never permission to fabricate. Load applicable Skills lazily and capture durable
  learning in docs/tests/Skills/routines.
- One writing slice = one explicit-base worktree + at most one live writer. Parallelize only
  genuinely independent slices; serialize shared state/invariants/migrations/external mutation.
- Every writing slice self-verifies with real build/tests/lint/typecheck/e2e as applicable, then
  receives independent code review and relevant security review. Missing required tooling is HALT,
  not a silent downgrade.
- `supervised` is the default. `proactive_routine` is only for a narrow repeatable P2 class with
  encoded scope/tests/review/stop rules and recent successful evidence. P0 live actions remain
  preparation-only; P1 stays supervised; P3/read-only does not mutate.
- Formal global control-plane, activation, release-epoch and certification documents are optional
  Level-3+ machine-enforcement hardening. Their status cannot block this operational workflow and
  must not produce `LEVEL3_NOT_ACTIVATED` for an ordinary future task.

## Merge / authority
- Default **STOP_AT_READY**. **P0** → don't codegen with autopilot. **P1** → manual_only, NEVER auto-merge.
  P2 auto-merge stays OFF unless a separate current owner authority explicitly enables a narrow
  mature class with run opt-in + 2 FULL clean + green verify + clean tree.
- NEVER `git push --force`. NEVER touch out-of-scope files/modules/branches. NEVER `git add -A` (stage per-file).

## Review gate
- Cross-model review = **`$CODEX` (AUTOPILOT_CODEX_BIN) ONLY**. NEVER substitute a Claude/Task sub-agent.
- **EVERY slice and companion repo gets a Codex round.** Use a repo-agnostic pinned
  `AUTOPILOT_CODEX_BIN` from that repo; missing local wiring never reduces the gate to zero. Tier by
  risk (money/logic = 2× consecutive FULL clean; prompt/docs = 1×).
- A final round counts only when the readiness gate wrote its
  `gate-attempt-*-code-review-round-NN.txt`, bound it to current HEAD/base/diff and received the
  exact clean tail marker. Legacy/manual pre-gate `round-NN.txt` is diagnostic only. P1 =
  **2 consecutive FULL-base clean rounds on the current HEAD**.
- **Clean on an empty diff is not a pass.** Verify `git diff --stat <BASE_SHA>...HEAD` is non-empty and
  branch/base are correct before every trusted verdict.
- Final review resolves only through the executable repo-local `scripts/codex-review-pin.sh`;
  legacy/manual calls resolve via `${AUTOPILOT_CODEX_BIN:?...}`. Missing/wrong pin or auth-fatal
  means **CODEX_UNAVAILABLE HALT, NEVER fall back to PATH `codex` or manual review**.
- The final gate sanitizes reviewer HOME/PATH and ignores per-invocation `AUTOPILOT_CODEX_*`,
  `BASH_ENV`, `ENV` and `NODE_OPTIONS` overrides. A normal feature cannot certify changes to the
  scope gate, readiness validator or reviewer wrapper that is certifying it; use the separately
  reviewed/versioned kit-maintenance path.

## Loop control — counters are FILES, not prose
- **Step 1 MUST create** `.autopilot/state/<FEATURE_ID>/regions.log` and
  `.autopilot/state/<FEATURE_ID>/fix-round-count.txt` in the writing worktree. One task with
  multiple slices uses `<task-slug>--<slice-slug>` consistently.
- Each fix round: append exact `round-NN file:region` to regions.log, increment the counter, echo it.
- `fix-round-count > 5` → **MAX_ROUNDS HALT** — a HARD stop, not advisory. The round loop MUST exit at >5 even
  if findings are still "real" and distinct; do NOT "just one more round".
- Same exact `file:region` flagged in ≥3 consecutive rounds → **REGION_THRASH HALT**.
- Thrash = a DESIGN smell → **converge to a clean design, do NOT keep patching edges**.
- **Distinct findings that keep SPREADING across many files/regions round after round** (not the same region) =
  the SLICE is too big / under-specified, not thrash → still HALT at MAX_ROUNDS and **split the feature**, don't grind on.

## Design contract (choke-points & derived data)
- **Single source of truth for a derived aggregate** (money totals, counts, balances): one canonical field +
  one helper; every consumer reads it. NEVER re-derive per call site with its own formula (that's the #1 thrash source).
- **Self-generated data → deterministic key** (id/code), exact lookup — fuzzy only for arbitrary human input.
- **Mirrored logic across ≥2 transports/adapters → extract one shared core**; adapters stay thin.
- **A new gate routes to the existing deterministic handler/payload; it does not duplicate display
  state or re-render confirm UI.** Resolution + liveness belong in the gate; labels, derived values
  and downstream mutation guards stay with their canonical handler.
- Touching a matcher/parser/router/choke-point primitive: **reuse-scan** first, then a **decision-table** with no
  silent fall-through; if reusing a primitive, **design-probe** the hardest cases against it first (unfit → HALT).
- Money/data: **fail-closed** — "can't prove it's 0/safe" → block, never silently treat as 0.
- **State (money/credit/identity) mutated across MANY code paths** (markPaid + deposit + merge + refund +
  host-exempt + transports…) → pin a decision-table per interaction AND **split into core + edge slices UP FRONT**.
  A monolith touching one state across N flows makes review surface a new distinct edge every round (credit-autoapply: 8 rounds, 12 files).
- **A new arm→consume lifecycle on a universal handler belongs at one pre-dispatch interceptor,**
  not scattered branches. Pin `{armed?}×{resolve|other|expired|blocked}`, consume once, revalidate,
  then act or clear/fall through. (arch: concierge-s2-verbal-confirm)

## Maintenance cost control — keep large projects cheap to debug
- **Do not debug by reading the whole repo.** First load the project handoff/README, then use code intelligence
  (`gitnexus_query/context/impact` or the repo's equivalent) to identify the flow, symbols, callers, and blast radius.
  Read only the bounded files in that radius before editing.
- **Docs are an index, not decoration.** Every mature project should keep a short handoff/runbook plus business rules
  or decision tables for risky flows. When a bug reveals a missing rule, update the table/docs in the same slice.
- **Tests are a semantic map.** Every bug fix gets a regression test with a real-world case name and production-shaped
  input. Prefer extending existing focused test files over adding scattered suites that future agents cannot find.
- **Traceability beats re-derivation.** For money, identity, credits, refunds, permissions, and external events, preserve
  audit/log fields that answer: input id, deterministic key, state before/after, action, and reason.
- **Refactor only when it reduces future search.** Refactor when a rule/formula is duplicated, adapter logic drifts,
  a bug requires reading more than ~3 unrelated modules, or review finds the same region repeatedly. Otherwise keep the
  change small and local.

## Scope & parallelism
- Scope is a **ceiling** (~≤3 modules / ~300 LOC), not a target; don't over-split cohesive low-risk work.
- **EVERY repo-writing slice has exactly one worktree and at most one live writer; the repo root
  stays on the default branch.** P0 live actions and read-only/report outcomes have no code writer.
- Parallel slices require disjoint files + invariant tokens and isolated mutable test state.
  - Worktree creation must name and verify the actual default-base SHA; never fork from current HEAD.
  - HALT is terminal. Preserve forensics until explicit disposition; a replacement gets a new
    task/run and must not reuse a stale active reservation.
- **A writing agent never mutates repo-root/default directly.** It writes in its exact worktree;
  landing revalidates the base, diff, scope, verification and reviews.
- Persist the task contract/manifest/backlog before implementation when the project uses them.
  They bind the pinned base and scope; they do not self-authorize broader changes.
- **Shared KIT fixes land canonical-first and sync consumers direction-aware.** Never hand-fix only
  a copy or downgrade a newer consumer.

## Trust nothing un-verified
- Founder **verify-on-disk** before believing READY: right branch, ≥1 real commit, `git diff --stat` = declared
  scope only, clean tree, counters exist. Self-reported "READY/clean" without artifacts on disk is not trusted.

## Captured lessons — condensed (one rule each; full forensic write-ups in `reference/autopilot-invariants-incident-archive.md` — tagged `(arch: <slug>)` — and pre-2026-06-26 ones in git history)
<!-- lessons below this line auto-apply to every project next session. Keep each to 1–3 sentences;
     fold a new lesson into the nearest existing bullet rather than appending a long paragraph; put
     the verbose incident detail in the incident-archive (NOT auto-imported) and leave an (arch: <slug>) tag.
     This whole file is @imported and Claude Code TRUNCATES it past 40k chars (rules silently dropped). A
     pre-commit hook (autopilot/githooks/pre-commit) BLOCKS committing it over ~39.5k — consolidate, don't bypass. -->


### Slicing & design
- **Name + frame a slice by its MECHANISM (the symbol/file it changes), never a vague GOAL-word — and draw the NEGATIVE scope explicitly.** A goal-word title ("cost guard", "optimize") invites a high-agency model to INVENT an enforcement subsystem the slice never asked for; the NEGATIVE block must name the tempting-but-forbidden subsystem ("NO X tracking/enforcement; ONLY these N files"). Scope-gate reserves files but does NOT block an out-of-scope WRITE at edit-time — codex catches drift only LATE, so the SPEC must fence it up front. (arch: clawbot-routing-cost-guard)
- **KB / content-authoring slices: the no-fabrication rule applies at AUTHORING time, not just runtime — confirm every concrete fact with the OWNER up front, or only state facts derivable from existing KB.** An agent told to "answer everything" will invent plausible specifics (prices, amenities, country lists, policies) that codex CANNOT catch (it reviews code/retrieval, not real-world truth) and the bot then states as fact. The slice must STOP and ask the owner per concrete fact. (arch: clawbot-kb-advisory-coverage)
- **Re-slice a thrashed/HALTed feature FRESH from `<DEFAULT_BRANCH>`** (new worktree, named base); old branch is read-only reference, never resume on it.
- **Front-load diagnosis (~30' pre-scan) before any state/money slice:** grep the base for the canonical single-source helper → consume it (create it as the FIRST deliverable if absent + ≥2 consumers); list functions mutating state from ≥2 sources = choke-points, don't bundle with clean paths; decide refuse-vs-handle UP FRONT; author the choke-point decision-table BEFORE code. Every path tabled up-front landed 2× clean; every path discovered-via-review thrashed.
- **Mixed-money recompute / merging TWO state records = its own slice with a full per-state decision-table.** Core fail-closed REFUSEs the combine when either side carries value/ledger (owner resolves the dup first); only clean records auto-combine. Shipping sooner → narrow fail-closed to `paid_amount IS NULL` only (can't wipe real money); defer the paid/mixed cases.
- **Unknown/unprovable value → ONE uniform fail-closed rule for the WHOLE class** (DEFER untouched + one manual-review notice, or REFUSE) — never branch the unknown per sub-type/method (each branch spawns an edge every round).
- **A fail-closed guard must be scoped to the EXACT triggering predicate.** An unconditional `value===null` check also fires for an adjacent class that legitimately resolves null (regressing it); if a precise upstream block already handles the real case, DELETE the broad guard — don't narrow it further.
- **State cleared/checked at MANY entry-points = spreading-findings smell → ONE owner:** clear at a single pre-routing choke-point, OR validate-at-CONSUME (re-check freshness + refuse stale); table the lifecycle up front. **Validate-at-consume alone is INSUFFICIENT** — it guards STALENESS (armed entity gone) but NOT OWNER-CONTEXT-SWITCH (armed entity still valid but owner has since acted on a *different* one → consuming the armed one does the wrong thing, e.g. refunds the wrong player). So state armed at a CALLBACK also needs a clear at the callback choke-point (many sibling callbacks → ONE pre-callback middleware; enumerate callback-tap clears, not just text-consumer clears). Money: re-read disposal at consume AND clear on context-switch.
- **A slice whose correct end-state needs an OUT-OF-SCOPE file is a SCOPE-DESIGN error — re-slice to include it, don't ship a deferred money-gap.** Core logic + the surface that RENDERS it are one feature (a DEFER suppressing a total must also stop the adapters printing the fee, else overpay). Split: ship the display-independent cells now, re-slice the rest with those files in scope.
- **Boundary-context rules over raw free-text (URL/delimiter/preceder) = an UNBOUNDED edge family; closed-set token membership stays clean.** REGION_THRASH → redesign to membership/exactness; new boundary classes STILL appearing → re-slice: ship the stable vocabulary layers as v1 now, isolate the scanner into its own slice seeded with the accumulated corpus as a PINNED decision table. (arch: nl-join-day-core)
- **A multi-transport user-facing feature = estimate ×3 (one per transport); make the decision-CORE extraction the FIRST slice, adapters as thin ports after.** Building one transport fully then "cleaning it up" into a core later spawns TRANSPORT_DRIFT + repeat port rounds. First design question: "which part of the decision moves to core so each transport just calls + renders?" (the planning corollary of the shared transport-agnostic core rule). (arch: multitransport-core-first)

### Codex review / liveness
- **Codex auth-death vs TRANSIENT corpse — CLASSIFY, don't reflexively HALT (a tiny no-verdict gate review log ≠ auth-death).** Triage the generated `gate-attempt-*-review-round-NN.txt` IN ORDER: **(1) QUOTA** (`usage limit`/`Review was interrupted`/`try again at`) → CODEX_QUOTA, wait. **(2) AUTH-DEATH** — STRIP connector lines (`rmcp|mcp|transport::worker|TokenRefreshFailed`) FIRST, then grep survivors for a model-auth sentinel (401 / `token_invalidated` / `invalid_grant` NOT on an rmcp line / "log in again"); survives → `"$CODEX" logout && login`, resume SAME branch. **(3) TRANSIENT** (only connector noise, no sentinel, no quota) → re-run the SAME gate once; recurs → PERSISTENT CONNECTOR problem, NOT relogin. **Verdict-first:** an exact gate tail marker means review completed; never fall back to PATH `codex`/manual. (arch: codex-corpse-triage)
- **codex "can't serve model gpt-X" / "global config issue" = you are NOT going through the pin.** `codex-review-pin.sh` ($AUTOPILOT_CODEX_BIN) forces `-m <model>` + `mcp_servers='{}'` via CLI flag — precedence BEATS `~/.codex/config.toml` (which the ChatGPT/Codex app rewrites). Route EVERY review THROUGH the wrapper, NEVER a raw codex binary (raw = no mcp-off hang-guard + reviewer-model drift across slices); pinned binary can't serve the model -> bump `CRAWBOT_REAL_BIN`/`PIN_FLAGS` AT the wrapper; every launcher must `export AUTOPILOT_CODEX_BIN`. (arch: codex-pin-model-override)
- **Stall ≠ crash.** A frozen fingerprint (HEAD+mtime unchanged over the window) is often long reasoning/compaction. Before acting: confirm the process is gone OR the round file is a tiny corpse; a terminal glance ("Thinking…") resolves it. A watchdog STALL alert means "look at the terminal," not "it's dead."
- **ONE-TURN FINISH:** once the last clean round + verify starts, drive through `scope-gate ready` + READY report in the SAME turn; never yield at "tests passed — next is scope-gate ready" (turn-boundary artifact, not a designed gate — GENERIC §B.5 v0.5.6). If a session is parked there, just Enter.
- **Cross-model base hygiene:** sync the authority branch **before intake**, then bind its immutable
  `<BASE_SHA>`. After admission, fetch/compare read-only before each round but NEVER rebase or move
  the run's base in place; remote/base-policy drift → stale/HALT and successor intake. Verify/review
  `git diff <BASE_SHA>...HEAD` only. DISCOUNT findings about code outside that diff. NEVER `gc
  --prune` a shared repo. Scale verification to risk.
- **A round with ANY finding is NOT "clean"** — "2 consecutive clean" = ZERO findings; a money/data P2, or one the reviewer says "fix before merging", is NOT deferrable. Final truth is the generated gate log + exact tail marker + `gate-result.json`, never the agent's "clean/READY" summary.
- **Non-converging rounds = a DESIGN signal, NOT more rounds.** Act on the FIRST tell (~round 3, never 16): (a) SAME file:region ≥3 rounds (REGION_THRASH); (b) findings don't shrink + SAME CLASS = unbounded edge-family; (c) each round surfaces the NEXT infra layer of a scheduled JOB = altitude too fine; (d) each round adds one more DIMENSION of an open-ended PROPERTY of one subject (attributes→ownership→excess-privs→…) — first check the SPEC still asks for it: a PARAPHRASE in the manifest/verdict may have widened it, and an invented requirement thrashes exactly like a real one. → STOP, re-slice, DISCARD patches, redo at round 1. Fix BY LAYER: NL/fuzzy → DESIGN-PROBE GATE up front (FINITE membership set, NEVER a blocklist); docs-spec JOB → defer the whole job-infra class, spec ONLY behavior; open-ended property → REDUCE to the spec's literal text, don't enumerate harder — the cut is RIGHT when pending findings DISSOLVE instead of needing one more layer. (arch: s3d-waitlist, fuzzy-fix-ratio, clawbot-intent-broaden-fetch, clawbot-pending-clarification, docs-spec-scheduled-job-altitude, preflight-acl-unbounded)
- **Codex reviews the DIFF, not the merged BASE — a "not wired / dead code / X never set" finding can be a FALSE POSITIVE when the producer already lives on base (a sibling slice merged).** Slice B's `git diff <BASE_SHA>...HEAD` hides slice A's already-merged producer → "consumer reads X but nothing produces X". VERIFY against the pinned base (`git show <BASE_SHA>:<file>` / grep the producer + an e2e test) before treating as real; if wired, dismiss WITH EVIDENCE (producer+consumer file:line+passing test), don't burn rounds. (Genuine findings still block.)
- **The verdict is at the TAIL — codex echoes the review RUBRIC near the top (`Risk: LOW/…/CRITICAL`, `### Findings`, `### Recommendation …`), that is NOT the result.** The real findings + recommendation come at the END after a long exploration. Read the tail (grep the real `[P1]/[P2]`/recommendation lines); don't mistake the echoed template for a verdict, nor conclude "no verdict" from a mid-file glance (mid-file connector noise is strippable — judge by the tail verdict).

### Backlog / registry / parallel gate
- **Backlog status is DERIVED, not hand-maintained.** Each task uses exactly the probe for its
  `task_kind`: implementation=`merged_probe`, rollout=`rollout_probe`, evidence=`evidence_probe`,
  operation=`operation_probe`, decision=`decision_probe`. Reconcile against exact origin evidence;
  never let a merged code symbol authorize a live operation/rollout/evidence row. Verify any
  “ready” against the current authority branch before launch and capture deferred work as a durable
  `## task:` block.
- **Dependency absence from INFLIGHT is not landing proof.** Every Level-3 `depends_on` row carries
  a same-order proof with dependency `base_sha`, `landed_sha`, exact file and slice-unique identifier
  absent on the dependency base and present on both landed/downstream trees. A downstream worktree
  starts from that freshly pinned landed base.
- **`merged_probe` = a SLICE-UNIQUE code symbol, verified ABSENT on origin at AUTHOR time** — a shared literal ("26/7") matches already-merged content → `--fix` false-flips "merged" → the in-flight worktree gets torn down. KIT_VERSION 3 `is_symbol_probe` refuses non-identifier probes; manifest+backlog carry the SAME probe — sweep both in one pass. (arch: backlog-reconcile-probe)
- **"Scaffolded" ≠ "cleared to run."** A prompt+manifest+backlog authority pack can still be
  founder-HELD; there is no per-task executable launcher. Before admitting anything, read its gates:
  HOLD markers, typed backlog status/deferral and exact dependencies. Founder-held work must not be
  dispatched speculatively. (arch: scaffolded-not-cleared)
- **Sync before authoring a new slice:** `ls` manifests + read INFLIGHT + backlog + grep the feature across `docs/`; re-derive callers/rules from the CURRENT base, not memory or a stale sub-agent report. "Root cause = a separate slice" doesn't mean that slice doesn't already exist — check; extend it, never author a parallel duplicate.
- **The parallel gate serializes on shared INVARIANT tokens, not just shared files** — file-disjoint
  slices still collide on a shared domain token (money-model, schema); check invariants FIRST,
  expect broad tokens to queue. Before a writer starts, reconcile the contract/manifest and register
  the final scope. After writing starts, material scope/invariant/base/design drift is terminal:
  HALT, preserve evidence and create a fresh successor task; never rewrite the active reservation
  to legitimize drift.

### Cross-repo / data integrity / notices
- **"Companion repo needs no change" is UNVERIFIED until you read its router/whitelist/classifier on-disk** — a feature/payment bot adding owner commands or postback payloads is half-shipped until the gateway bot whitelists the EXACT tokens + payload regex; unwhitelisted = silently dropped, and no in-repo test catches it (whitelist lives in the other repo). Applies to STRUCTURAL refactors that re-emit an existing payload (notification-port / entry-point split), not just NEW commands — don't trust "no companion change needed". Add a unit test there. (arch: clawbot-bridge-whitelist)
- **A companion forwarding GATE stays a SUBSET of the authoritative parser (gate ⊆ parser)** — over-forward on an ACK-only bridge = user SILENCE; every parser-NARROWING change syncs the mirror IN THE SAME DECISION. The window opens between DEPLOYS, not merges (**deploy-gate ≠ merge-gate**): merge freely, HOLD the stricter side's deploy until the mirror lands, deploy both together. (arch: nl-join-gate-subset)
- **FK enforcement is PER-REPO — probe `PRAGMA foreign_keys` at runtime, never hardcode a global mode.** OFF → `ON DELETE SET NULL/CASCADE` do NOT fire: hand-repoint EVERY referencing column (grep schema `REFERENCES <table>(id)` for all, not just the obvious one) before the delete. ON → cascades fire, but still keep explicit repoint/cleanup where domain ordering, money conservation or audit immutability requires it (don't rely on cascade). Add a no-dangling regression test either way.
- **Surfacing user-supplied text → PLAIN reply** (no parse_mode; `_ * [ ]` break/reject it). Gate a "changed" notice on `old !== new`, not on the setter being called (idempotent no-ops fire false notices).
- **Additive extension of a shared contract union → the consumer test asserts on the OPAQUE/shared shape, not on fields only the OLD variant carries.** When a producer adds a new variant (e.g. `expectNextText` kind `joinpick` with NO `sessionId`, beside `name` which has one), the consumer reads presence + shared fields only, treats the discriminator as opaque (`if (resp.x)` not `=== "name"`), and does NOT bump the contract version unless it actually validates the discriminator enum. Spec the consumer test on the NEW shape exactly (`{kind:"joinpick", ttlSec}`, no sessionId). General rule: additive contract change ⇒ assert on the INTERSECTION, never on a removed/optional field.
- **A shared/downstream builder's output at a BOUNDARY value (0/null/empty) must be MEASURED, not assumed** — read or run the builder you don't own at the edge during Step-0 (assuming `builder(0)` renders amount-less cost 3 rounds when it still emitted full bank details).
- **Fail-closed across heterogeneous transports is ASYMMETRIC:** when one transport's shared builder can't express the fail-closed mode the others can, converge to SKIP + STAMP (throttle) + one owner-note — do NOT modify the out-of-scope builder, and do NOT leave the player un-stamped (un-stamp = repeated cron host-note = REGION_THRASH).

### Tests / harness / invocation
- **Run the CANONICAL test invocation before concluding a test is buggy.** Full suite = `DB_PATH=/tmp/ap-<repo>-suite.db npm test` (the `pretest` hook wipes the shared file ONCE; per-file `:memory:`/`/tmp` defaults are bypassed). Plain `npm test` makes each file fall to its own default → persistent `/tmp/ap-*.db` leaks across runs (a state-mutating test fails run 2+) → invocation-artifact failures, not code defects. Merge-gate runs the canonical form, `&&`-chained so a red suite blocks the push. A test's own DB reset fires ONLY when it owns the default (`if(!process.env.DB_PATH){ set; wipe }`) — never wipe an externally-supplied shared suite DB.
- **Merge-verify must run the FULL suite, not just `npm run build`** — build proves it COMPILES, not BEHAVES; a latent failure rides build-only merges until something runs the suite. The slice's own tests passing in its worktree ≠ the full suite green on the merged base.
- **Hard test on a notify/fail-closed path = harness problem, fix at the framework layer, don't weaken the assertion** — when a "message sent" spy sees nothing, a framework middleware short-circuited the send before your hook; install a CAPTURING transformer AFTER it to record the payload, keeping the end-to-end assertion.

### Git / shell / process hazards (owner's machine + sandbox)
- **Sandbox git is read-only-but-locky:** `git status`/`diff` on the mounted repo can leave a stale `.git/index.lock` blocking the owner's next commit → use `git --no-optional-locks` + index-free plumbing (`git show <ref>:<path>`, `git grep <rev>`, `git diff <base>..<branch>`), not `status`/`add`/`stash`/`merge`. A stale lock is usually the SANDBOX's own (sandbox uid, EPERM to remove) → the OWNER `rm -f .git/index.lock` on the Mac. NEVER git-WRITE (merge/commit/push/clean/branch -D) from the sandbox — hand multi-step git to the owner. NEVER hand-edit a file a LIVE autopilot session's worktree owns (two-writer race; a premature merge lands whichever tip is current; one writer/slice). `release` the lock UNCONDITIONALLY, never `&&`-behind a gate — a false probe skips it → orphaned lock blocks next commit. (arch: plexco-ap25-race-and-orphaned-lock)
- **`--no-ff` merge pre-flight gates on the STAGED INDEX** (`git diff --cached` empty), not whole-tree porcelain (untracked/WIP false-blocks it). Confirm `git diff <base>..<branch>` == scope and `git show --stat HEAD` post-merge shows only those files. Only `--squash` stages unrelated dirty files — that's the real dirty-index hazard.
- **Autopilot worktrees:** guard every `git clean -fdx` with an INFLIGHT check (it wipes in-repo gitignored worktrees INCLUDING the branch); commit/push checkpoints early; recover a wiped branch via reflog/`git fsck`. From a detached worktree push `git push origin HEAD:main`.
- **A branch checked out in a worktree can ONLY be operated from that worktree — `cd` into
  `.autopilot/worktrees/<FEATURE_ID>`, don't re-checkout it in the main clone.** A failed checkout
  is a HARD STOP: verify cwd/branch/base before anything downstream. Never commit
  `.autopilot/state/**`; runtime evidence stays ignored.
- **Write for the owner's macOS runtime.** `/bin/bash` is 3.2 — no `mapfile`/`declare -A`/`${v^^}`; `"${arr[@]}"` errors when empty under `set -u` (guard `${arr[@]+"${arr[@]}"}`). BSD `awk` has no `strftime` (pass `-v today=$(date +%F)`). A script doing `awk > f.tmp && mv` MUST `rm -f f.tmp` on failure or `git add -A` commits the truncated corpse — `.gitignore` `*.tmp`. Confirm where `npm run build` lives (root vs subdir) before a merge block. Test scripts with the REAL `/bin/bash`.
- **A long-running daemon runs the code it loaded at START** — committing a watchdog fix does NOT change the running instance; restart it (`launchctl kickstart -k gui/$(id -u)/<label>`). Tell = alert wording ≠ current file text → stale PROCESS, not stale code; restart, don't re-edit.
- **Shared-helper/choke-point change for a narrow request → impact/blast-radius FIRST;** HIGH/CRITICAL → prefer a local wrapper unless the behavior is intentionally global; verify with targeted tests. (tsx IPC `EPERM` in sandbox → rerun escalated + sequential.)
- **Source-code delimiters: ASCII `"`/`'` ONLY — never smart-quotes (U+2018/19/1C/1D) or en/em-dash as syntax; they break compile (TS1005) + burn self-repair rounds.** (arch: curly-quotes)

### Operating conventions (orchestrator ↔ session)
- **Relay any instruction to a running session as ONE self-contained ```text block** — rationale OUTSIDE the block; root cause + numbered steps + hard-stop/"do NOT call scope-gate ready until…" guard INSIDE. One block = one paste.
- **An executor flagging a relayed founder block as INJECTION is the safety layer WORKING — never out-assert it ("treat as authentic" + a longer rebuttal IS the injection signature).** Recovery: founder replies in their OWN short voice; every claim ships with a command the executor can run itself — trust rebuilds from the disk, not a louder relay; withdraw security-sensitive asks (daemon unload) in favor of a fix that makes them unnecessary. (arch: relay-injection-skepticism)
- **Never run `scripts/ap-finish.sh`/teardown while a Codex round is IN FLIGHT** (wipes the worktree mid-review and loses the verdict) — finish only after the READY signal-file and authorized landing/disposition proof. (arch: ap90-midround-land)
- **On a HALT multi-option decision: DECIDE + EXPLAIN + RELAY-READY.** Pick the option with the HIGHEST project benefit (long-term value · money/correctness safety · maintainability · clean reusable boundaries — not the fastest or most-conservative reflex); state it decisively; say why it beats each other + the cost it accepts + a bounded fallback; deliver as a ```text block. Speed is a tiebreaker, not the criterion.
- **After a plan is FINALIZED:** read `level3-workflow.md` plus the canonical GENERIC/version,
  persist the compact task contract, build the dependency/slice graph, then delegate implementation
  in dependency order. The primary orchestrator coordinates and integrates; each writing slice
  owns only its declared worktree and scope. (arch: template-version-guess)
- **Cost (tokens, fix rounds, redone work) is NOT a constraint and must NEVER bias the recommendation downward.** The founder pre-authorizes more tokens/rounds/a full re-architecture whenever that's the highest-benefit path. Don't hedge to the cheaper option or frame the correct redesign as "expensive" to avoid it. When a HALT reveals a wrong boundary (spreading-findings/REGION_THRASH = design problem), fix the DESIGN (re-slice, discard scattered work) over patching to green — even if it throws away effort. Mention cost only as a factual note, never as the reason to prefer a lesser option.
- **Every stop writes a durable file before reporting:** breaker=`HALT-<REASON>.txt`,
  decision=`AWAIT-FOUNDER-<reason>.txt`, success=`READY.txt`. TUI prose is invisible to monitors.
  P1/P2 use the writing-worktree state; P0/P3 allow only ignored repo-root task telemetry and no
  tracked/product/external mutation. Use the repository's scope/lifecycle gate when installed.
  Never reuse stale READY or resume HALT.
  (arch: stop-at-ready-signal, clawbot-advisor-guard-decouple)
- **Don't model an arbitrary AMOUNT as a free-text reply-STATE on a bot that can't route input per-flow — use a slash-command-with-argument; when a state keeps generating findings, question whether it should EXIST.** The arm→type-bare-number→consume lifecycle collides with every other text/selection flow; a slash command rides the value as an arg (slash escapes pending-state), DELETING arm/consume/clear/validate. Check how the codebase already takes that KIND of value — eliminate the state, don't guard it. (arch: partial-forfeit-ui)
- **Final review ALWAYS runs through `scope-gate ready`, which invokes repo-local
  `scripts/codex-review-pin.sh review --base <BASE_SHA> <marker-prompt>` and captures the process
  itself.** Do not manufacture, tee or edit the gate artifact. A manual pre-gate review is
  diagnostic only. Triage a tiny no-verdict gate log per the corpse-triage rule.
  (arch: pay-context-roster-fields, credit-exempt-defer)
- **SYNC THE BASE before intake/diagnosis (`git fetch` + confirm the candidate default root is not
  behind origin).** Pre-intake, advance the candidate root and re-read before binding `BASE_SHA`.
  Inside an admitted run, never rebase: read-only compare drift → `INTAKE_STALE`/successor. A target
  absent on a current pinned base → HALT DESIGN_UNFIT, never fabricate it. A 0-match can also be a
  wrong path/command; use `rg`/`git grep` on dirs that exist. (arch: clawbot-gioithieu)
- **Teardown is GATED on an ORIGIN-verified merge and goes through `ap-finish.sh <slug>` — never a bare `git worktree remove`.** READY ≠ merge. Normal cleanup requires the READY-bound branch tip on origin; squash cleanup requires the supplied origin commit to have the exact READY file set + binary-diff SHA-256. Unmerged closure requires `--authorized-close --reason <text>` and a durable disposition. Bulk `ap-housekeep --apply/--force` is retired; the helper is read-only. A bare remove leaves a stale reservation/orphan branch; squash only a stopped, unchanged READY tip. (arch: concierge-s3d1-waitlist-intent-order, join-session-order, plexco-merged-mid-review-snapshot)

- **Watchdog (ap-watch) internals live in `parallel/WATCHDOG-NOTES.md`** (maintenance-only). Count REAL watchers with `ps …|grep '[a]p-watch.sh'|awk '$2==1'` (launchd=PPID=1), NOT `pgrep -f` (over-counts transient `$(...)` subshells). Dup '🚀 START' for one session = >1 watcher outside launchd → one plist per repo + a PIDFILE single-instance guard. (arch: ap-watch-guard)
- **Money confirm buttons keyed by a per-flow/per-entry seq that RESETS per flow-type can confirm the WRONG session/flow when an old seq collides with a new flow.** Use a GLOBAL per-uid monotonic seq; a confirm is valid only if `seq === current`; never reset per flow. (arch: refund-stk-seq-global)
- Squash-merge → local main DIVERGES from origin (`branch -d` refuses, `--ff-only` fails); resync `git fetch && git reset --hard origin/main`, delete merged branches with `-D`. (arch: squash-merge-sync)

- **Multi-step runbooks with side effects must be a SCRIPT, not text to paste — a failed step will not stop the next one.** Gate clean-tree with `git diff --quiet && git diff --cached --quiet` (TRACKED only); `git status --porcelain` counts UNTRACKED so it always reads dirty and silently skips the guarded step. Use `ap-merge.sh`. (arch: paste-runbook-half-executed)
- Watchdog spam lặp START↔CẦN-FOUNDER/RESERVATION-STALE cho 1 slug = feature xong-chưa-merge còn `planned` (chưa lên origin/main) → orchestrator spin lại; dọn state từ sandbox vô ích. Fix: land với owner authority rồi chạy verified `scripts/ap-finish.sh <slug>` trên Mac. (arch: watchdog-planned-unmerged-respin)  _(2026-07-23)_
