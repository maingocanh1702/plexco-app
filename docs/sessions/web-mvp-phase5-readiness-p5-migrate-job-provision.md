<!-- review-readiness: code-ready -->

# Step-0 readiness: L82 p5-migrate-job-provision (session P5-S11a)

Reader: S0 (opus, step-0 readiness reader), 2026-10-30. Base and authority: `2d91aea9c99dc5bc71ab932f208929f76de37436` (origin/main, PR #150's merge; the worktree HEAD at the start). Every line number is a source line at that base. Risk P1 (the DDL-credential job of every deploy) with one security round; 0 migrations.

## 1. Authority

- Conductor ruling RO-L67-2 (option B): provision runs inside the existing `migrate` PRE_DEPLOY job, after the migrations, in the same shell; the `migrate` arm runs the migration runner without `exec`, then `exec`s provision. "Decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature"; Tier B, reversible.
- `docs/standards/environments-setup.md` "Required CI order" (heading :429, items :431-435): 2 migrations with `DATABASE_URL_MIGRATION`; 3 `infra/entrypoint.sh provision` "using the same job-scoped credential"; 4 deploy. :437-438: never a runtime command that injects the DDL credential into all components.
- The env manifest's open item, `docs/runbooks/env-manifest-staging-production.md:24`: the provision row leaves its place in the deploy order to L63 and L67.
- The owner's approval of the Phase 5 plan ("Phase 5 plan approved, 2026-10-28", DD-154) and the owner's later order to continue the deploy chain.

## 2. Measured at base

Excerpt index: E1 `infra/entrypoint.sh`, E2 `apps/bot/src/provision-queue.ts`, E3 `apps/bot/package.json`, E4 `packages/db/src/migrate.ts`, E5 `packages/db/migrations/0000_roles_extensions.sql`, E6 `infra/Dockerfile`, E7 `package.json`, E8 `infra/render-app-spec.test.mjs`, E9 the env manifest and environments-setup.md.

### 2.1 Q1: the new `migrate` arm, fail-closed in POSIX sh

(a) The new lines 79-84 replace the comment and the command at E1 :79-84; :78 `migrate)` and :85 `;;` are unchanged:

```sh
    # Steps 2 and 3 of the required CI order in docs/standards/environments-setup.md, in one shell: the SQL
    # migrations, then the queues; both read only DATABASE_URL_MIGRATION and refuse an empty value. No exec
    # on the runner: under set -eu its failure exits here, before provision. tsx is a production dependency
    # of apps/bot. A filter matching nothing exits 0 without --fail-if-no-match, and the deploy goes ahead.
    pnpm --filter @plexco/bot --fail-if-no-match exec tsx ../../packages/db/src/migrate.ts
    exec pnpm --filter @plexco/bot --fail-if-no-match provision:queue
```

The arm keeps its span (:78-85), the unknown-role arm stays :86-89 and the file stays 90 lines, so every base citation stays exact: `infra/entrypoint.sh:78-85` (env manifest :23, :75, :128; `docs/autopilot-backlog.md:7891`), `:87-88` (env manifest :16) and ":80" (env manifest :23, "reads only `DATABASE_URL_MIGRATION`", still on :80). Longest new line: 107 characters (base :83: 108). Both scripts refuse an empty credential: E4 :415-422 (exit 1), E2 :18-20 and :62-71 (exit 1).

(b) Interpreter: E1 :1 `#!/bin/sh`, :5 `set -eu`. Image: E6 :43 `FROM node:22-bookworm-slim AS runtime` (Debian bookworm, whose `/bin/sh` is dash); :63-64 copy and `chmod +x`; :83 exec-form `ENTRYPOINT`, so the kernel runs the shebang's `/bin/sh`. The dispatch (E1 :54-90) is a top-level `case`: not an `if`/`while`/`until` condition, not a non-final command of an `&&`/`||` list, not under `!`, not in a function. So `set -e` applies to the runner call: a non-zero status exits the shell at once, as `exit` without an argument, that is with the runner's own status, and provision never starts. Provision is `exec`'d, so its status is the process status. Measured on a scratch copy with a stub `pnpm` and `env -i`, identically under macOS `/bin/sh` and `/bin/dash`: runner status 3 gives script status 3 and one call; provision status 4 gives script status 4 and two calls; `sh -n` passes under both. Fail-closed: yes.

(c) pnpm 10.30.2 (the packageManager pin), cwd the worktree, a filter matching no package (nothing runs): `pnpm --filter @plexco/no-such-package provision:queue` prints "No projects matched the filters" and exits 0 (the base comment's claim, E1 :82-83); `pnpm --filter @plexco/no-such-package --fail-if-no-match provision:queue` prints the same and exits 1. The flag before the script name is honored, as it is before `exec` at E1 :84.

(d) Signals: while the runner runs, the shell (PID 1 in the container) stays its parent and dash sets no SIGTERM handler, so a platform stop during the migrations reaches the runner only as the final SIGKILL; the job still ends non-zero and the deploy stays blocked. Known risk for a one-shot PRE_DEPLOY job; fail-closed holds; no extra code.

Order matters on an empty DB: provision's grants (E2 :42-54) name `app_worker`, which migration 0000 creates (E5 :25-26).

### 2.2 Q2: the test design (new `infra/entrypoint.test.mjs`, E8 style)

- Style (E8): `node:test`, `node:assert/strict`, `spawnSync` (:4), one `mkdtempSync` dir per call, removed in `finally` (:36-50), the script path from `fileURLToPath(new URL(..., import.meta.url))` (:11).
- Env before the dispatch: for `migrate`, `provision` and an unknown role, E1 :1-53 reads only the role (:10, every expansion defaulted, safe under `set -u`), takes the `*)` branch at :34-36 (no expected DB role, so :45 is skipped) and prints `[entrypoint] starting role=<role>` on stdout (:52). Nothing else is needed; PATH must find `pnpm` (the stub) and `wc` (used by the stub).
- Role channel: the App Specs pass env `PROCESS_ROLE` = `migrate` and no command argument (`infra/app.staging.yaml:79-82`, `infra/app.prod.yaml:69`), the third source at E1 :10. The test uses that channel (D2).
- The stub `pnpm`, mode 0755, in the case's temp dir. The JS that writes it must not use a template literal (the stub contains `${`):

```sh
#!/bin/sh
# Stub pnpm: one log line per call (its argv, and whether DATABASE_URL_MIGRATION is the fake value; never the
# value itself), then exits with STUB_RC_<call index>, default 0. The log file must exist (empty) before call 1.
n=$(( $(wc -l < "$STUB_LOG") + 1 ))
case "$n" in
  1) rc="${STUB_RC_1:-0}" ;;
  2) rc="${STUB_RC_2:-0}" ;;
  *) rc=0 ;;
esac
if [ "${DATABASE_URL_MIGRATION:-}" = "$STUB_FAKE_URL" ]; then url=fake; else url=other; fi
printf '%s url=%s\n' "$*" "$url" >> "$STUB_LOG"
exit "$rc"
```

- Child env, built explicitly (never a spread of `process.env`): `PATH` = `<dir>:/usr/bin:/bin`; `PROCESS_ROLE`; `DATABASE_URL_MIGRATION` and `STUB_FAKE_URL` = FAKE = `postgres://fake@fake-host.invalid:5432/fake`; `STUB_LOG` (created empty first); `STUB_RC_1`/`STUB_RC_2` per case. Spawn `/bin/sh` with the entrypoint's path (the shebang's interpreter; no exec bit needed).

| Case | Role, codes | Exit | Calls, in order (log lines) |
| --- | --- | --- | --- |
| T1 | `migrate` | 0 | `--filter @plexco/bot --fail-if-no-match exec tsx ../../packages/db/src/migrate.ts url=fake`, then `--filter @plexco/bot --fail-if-no-match provision:queue url=fake` |
| T2 | `migrate`, `STUB_RC_1=3` | 3 | the runner line only: provision is never called |
| T3 | `migrate`, `STUB_RC_2=4` | 4 | both T1 lines, in T1's order |
| T4 | `provision` | 0 | `--filter @plexco/bot provision:queue url=fake` (unchanged, no flag) |
| T5 | `nope` | 1 | none; stderr names `nope` and the five valid roles |

Every case: stdout is exactly `[entrypoint] starting role=<role>` plus a newline; stderr is empty for T1-T4; FAKE appears in neither stream. Codes 3 and 4 prove that the script's status is the failing call's own, not the `exit 1` of the `*)` arm. Measured on the scratch copy of 2.1 (b): T1-T5 as in the table under both shells, and with `exec` put back on the runner T1 sees one call (exit 0), so T1 and T3 fail.

`test:infra` (E7 :12) becomes `"node --test infra/render-app-spec.test.mjs infra/entrypoint.test.mjs"`; the root `test` chain (E7 :11) already runs it.

### 2.3 Q3: other readers of the arm's behavior at the base

`git grep -n -F` at the base: `entrypoint.sh migrate` 0 hits; `PROCESS_ROLE=migrate` 0 (the App Specs split it into YAML `key`/`value`, added below); `provision:queue` 19. Spellings added because hits showed them: the App Specs' `migrate` job; line citations `entrypoint.sh:7`, `:8`, `:9` (6 hits); `entrypoint.sh provision` (6); `provision job` and `job provision` (6).

No later update needed:

- `provision:queue` as a local or operator command, still true: `.env.example:80`; `README.md:104`, `:122`; `docs/00-start-here/DEV-ONBOARDING.md:170`; `apps/bot/package.json:8` (the script); `apps/bot/src/provision-queue.ts:16`; `apps/bot/src/preflight.ts:159`, `:168`, `:191` (the worker's "run provision:queue" hint); preconditions now met by every deploy's `migrate` job: `docs/runbooks/outbox-dispatch-enable-rollback.md:26`, `docs/sessions/web-mvp-phase5-golive-plan.md:212`, `:218`.
- `infra/entrypoint.sh:76`, the `provision` arm: unchanged (negative scope). The App Spec jobs (`infra/app.staging.yaml:70-85`, `infra/app.prod.yaml:57-70`): unchanged env and credential; the same job now also provisions.
- Line citations: exact, because the arm keeps its span (2.1 (a)); `docs/autopilot-backlog.md:7803` cites :76 at an older pinned base.
- Dated records, never rewritten: `docs/sessions/web-mvp-phase3-readiness-p3-m6-outbox-delivery-core.md:345`; `docs/sessions/web-mvp-phase4-plan.md:169`; `docs/sessions/web-mvp-phase5-readiness-p5-env-manifest.md:6`, `:11`; `docs/sessions/web-mvp-phase5-readiness-p5-app-specs.md:301`; `docs/sessions/web-mvp-phase5-readiness-p5-runbook-outbox-staging-prod.md:10`, `:30` ("the provision job", superseded by RO-L67-2); `docs/sessions/web-mvp-phase5-readiness-p5-staging-tooling-port.md:58`, `:164` (lane L65 kept the two steps apart; RO-L67-2 joins them); `docs/archive/ap22-egress-run/round-02.txt:382`, `round-03.txt:421`, `:790`, `:1088`.

Later update, wording only, outside the ownership (for the report and the PR body, never an edit in this lane):

1. `docs/standards/environments-setup.md:433` "Run `infra/entrypoint.sh provision`": step 3 now runs inside the `migrate` arm (the same script plus `--fail-if-no-match`, the same credential); the order and credential clauses hold (RO-L67-2).
2. `docs/runbooks/env-manifest-staging-production.md:71` and `docs/runbooks/outbox-dispatch-enable-rollback.md:161`: "and on the provision job if it runs" is now moot (there is no separate job).
3. `infra/app.staging.yaml:66` and `infra/app.prod.yaml:53` ("Runs the database migrations"): the job now also provisions the queues.
4. `docs/autopilot-backlog.md:7792`, row `p5-entrypoint-provision-role-fails-if-no-package-matches`: stays open (the `provision` arm keeps no flag); after this lane no deploy runs that arm, which lowers its impact.

### 2.4 The env manifest's provision row (:24), new text

Same five columns, in the manifest's language; the stale `E:425-430` gives way to the section's name (it is :429-435 at this base):

> | provision, chạy trong job migrate PRE_DEPLOY | `migrate`, :78-85: chạy sau migration, cùng shell; role `provision` (:68-77) không đổi | có, trong job migrate, sau migration (thứ tự "Required CI order" của `docs/standards/environments-setup.md`; RO-L67-2; D-4) | như staging | cùng `DATABASE_URL_MIGRATION` của job migrate (`apps/bot/src/provision-queue.ts:63`); migration lỗi thì provision không chạy, bước nào lỗi cũng làm job fail và chặn deploy; E4 |

W1 writes it as a plain table row (without the leading `> `).

## 3. Decisions

- D1, decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature (RO-L67-2): provision inside the `migrate` arm; the runner without `exec`, then `exec` provision with `--fail-if-no-match`.
- D2, in-lane default, Tier B, reversible: the tests pass the role as `PROCESS_ROLE` with no argument, the App Specs' channel; the argument form reaches the same arm through E1 :10 (measured: exit 0, two calls).
- D3, in-lane default, Tier B, reversible: the arm keeps its :78-85 span (comment 5 lines to 4), so the base line citations stay exact.
- D4, in-lane default, Tier B, reversible: stub codes 3 and 4, never 1, and a fixed `/usr/bin:/bin` after the stub dir, so no real `pnpm` can be reached.
- D5, in-lane default, Tier B, reversible: no backlog row; the four later-update items live in this tracked record and the PR body, for the conductor to route (L69 documents the chain after L82 merges, RO-L67-2 item 5).
- D6, in-lane default, Tier B, reversible: the manifest row names the "Required CI order" section instead of the stale line range.

## 4. Acceptance matrix (A-1..A-12; expected results)

| ID | Command or check | Expected |
| --- | --- | --- |
| A-1 | `pnpm run test:infra` | both files run; the render-app-spec tests unchanged and green; T1-T5 green |
| A-2 | T1 | exit 0; two calls: the runner, then provision with `--fail-if-no-match`, both `url=fake` |
| A-3 | T2 (`STUB_RC_1=3`) | exit 3; one call; provision never called |
| A-4 | T3 (`STUB_RC_2=4`) | exit 4; two calls |
| A-5 | T4 (`provision`) | exit 0; one call, `--filter @plexco/bot provision:queue` |
| A-6 | T5 (unknown role) | exit 1; no call; stderr names the role |
| A-7 | planted mutation: `exec` back on the runner after the fix commit, restored with `git checkout --` | T1 (and T3) fail on the call count; the restored file equals the committed one |
| A-8 | `sh -n infra/entrypoint.sh`; `shellcheck -s sh infra/entrypoint.sh` if installed | exit 0; shellcheck was not installed on the lane machine on 2026-10-30: say so |
| A-9 | `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | exit 0 each |
| A-10 | `pnpm review:check:changed` before every commit; `pnpm review:check` at the end | exit 0 |
| A-11 | `git diff --name-only 2d91aea9c99dc5bc71ab932f208929f76de37436...HEAD` | exactly this record, `infra/entrypoint.sh`, `infra/entrypoint.test.mjs`, `package.json`, the env manifest |
| A-12 | the diff of `infra/entrypoint.sh` | only lines 79-84 change; 90 lines; no echo of any env value |

## 5. Verification and review

One opus reviewer role, at most 3 rounds counting pre-push rounds, plus one opus security round on the threat model (section 7); they may run together on one committed HEAD when no writer is live. The last round follows the L44 policy: a P3 or lower docs or comment fix is labelled "fix applied after the final round, not re-reviewed (3-round cap)"; a P1 or P2, or any code change, becomes ruling request RQ-L82-R3 and an AWAIT. CI runs the full suite on one push. No local DB run: no DB-touching change.

## 6. Budget (B3) and files

About 120 changed lines in 4 files (entrypoint 6 replaced lines, test about 100, `package.json` 1, manifest 1) plus this record; 0 migrations; no migration slot; the DB/e2e lock is not needed.

## 7. Security notes for the security round

Threat model: the adversary is a mistake, not a motivated attacker.

- A filter matching nothing exits 0 (a deploy on the old schema or without its queues): both calls carry `--fail-if-no-match` (2.1 (c): exit 1); T1 pins both argv lines exactly.
- A provision failure that does not fail the job: provision is the `exec`'d last command, so its status is the job's (T3: 4).
- Provision before the migrations, or after a failed one: the order is textual, the runner is not `exec`'d and `set -e` applies (2.1 (b)); T2 (one call, exit 3); the planted mutation proves T1 catches a returned `exec`.
- `DATABASE_URL_MIGRATION` in a log: the arm prints nothing, E1 :52 prints the role only, the stub records a match flag and never the value, and every case asserts FAKE in neither stream. The credential surface is unchanged: the same job and env (App Specs unchanged; `infra/render-app-spec.sh:59-65` keeps it off other components) and no new component (environments-setup.md :437-438 holds).
- Signals: 2.1 (d).

## 8. Open

0 in scope.

## 9. Hard dependencies and backlog rows

None unmerged; `2d91aea9c99dc5bc71ab932f208929f76de37436` (PR #150's merge) is the base. The lane runs beside L67 with no shared file (RO-L67-2 item 4 withdraws L67's spec-block ownership). Backlog rows: none planned (D5).

## 10. Closure matrix (12 of 12 PASS)

| # | Gate | Evidence | Result |
| --- | --- | --- | --- |
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the worktree HEAD = the base; section 1 | PASS |
| 2 | Decisions in scope final | RO-L67-2 (D1); in-lane defaults D2-D6 (section 3) | PASS |
| 3 | Scope IN/OUT and owner clear | the lane's file ownership and negative scope; A-11, A-12 | PASS |
| 4 | Dependencies classified | section 9 | PASS |
| 5 | Live schema and code match | section 2, measured at the base; no schema change | PASS |
| 6 | Data, API, state, auth contract | same job, env and credential (section 7); E2 and E4 untouched | PASS |
| 7 | Fail-closed, idempotency, order | 2.1 (b) and (c); provision idempotent (E2 :7-17); T1-T3 | PASS |
| 8 | Open questions in scope = 0 | section 8 | PASS |
| 9 | Acceptance matrix with expected results | section 4 (A-1..A-12) | PASS |
| 10 | Migration, security, rollback | no migration; one security round on section 7; rollback = revert the commit | PASS |
| 11 | First slice hard dependencies merged | W1 depends on nothing unmerged (section 9) | PASS |
| 12 | Implementation handoff ready | sections 2.1-2.4 and 4: the arm, the stub, the cases, `test:infra`, the manifest row | PASS |

## 11. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-30
AUTHORITY_SHA: 2d91aea9c99dc5bc71ab932f208929f76de37436
BASE_BRANCH: main
TARGET_FILES:
  - infra/entrypoint.sh (edited: the migrate arm, lines 79-84 only)
  - package.json (edited: the test:infra script only)
  - docs/runbooks/env-manifest-staging-production.md (edited: the provision row, line 24 only)
  - infra/render-app-spec.test.mjs (read-only: the test style)
  - apps/bot/src/provision-queue.ts (read-only: the refusal, the grants and the exits)
  - apps/bot/package.json (read-only: the provision:queue script; tsx is a production dependency)
  - packages/db/src/migrate.ts (read-only: the runner's credential and exits)
  - packages/db/migrations/0000_roles_extensions.sql (read-only: app_worker, the order)
  - infra/Dockerfile (read-only: the runtime image and the entrypoint)
  - infra/app.staging.yaml (read-only: the migrate job passes PROCESS_ROLE)
  - infra/app.prod.yaml (read-only: the migrate job passes PROCESS_ROLE)
  - docs/standards/environments-setup.md (read-only: the Required CI order)
  - docs/autopilot-backlog.md (read-only: the open provision-arm row, section 2.3)
SLICE: p5-migrate-job-provision
IN_SCOPE: the migrate arm of infra/entrypoint.sh; the new infra/entrypoint.test.mjs; the test:infra script; the env manifest's provision row; this record
OUT_OF_SCOPE: every other entrypoint arm, provision-queue.ts, migrate.ts, the Dockerfile, the App Specs, the workflows and environments-setup.md; any DB, docker, network or cloud CLI; any secret value
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none unmerged; 2d91aea9c99dc5bc71ab932f208929f76de37436 (PR 150's merge) is the base
PRIOR_SLICES: L65 and L66, both merged and in the base (the migrate role; the App Specs' PRE_DEPLOY migrate job)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration; one security round (opus) on section 7
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 edits the migrate arm (2.1), adds infra/entrypoint.test.mjs (2.2), wires test:infra and updates the manifest row (2.4), runs A-1..A-12, commits in the worktree
REMAINING_BLOCKERS: none
```
