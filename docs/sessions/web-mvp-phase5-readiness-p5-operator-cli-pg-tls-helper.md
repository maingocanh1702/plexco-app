<!-- review-readiness: code-ready -->

# Step-0 readiness: L90 p5-operator-cli-pg-tls-helper (session P5-S20a)

Writers: W1 (opus), completed by W2 (opus) with the orchestrator's rulings on D1-D6, 2026-11-01, from the step-0 findings of units U1 (the helper, the loading paths on every Node version in play, the CLIs' error paths) and U2 (the spawners, the sites guard, the test home, the kit record), the writer's own step-1 measurements, and the orchestrator's decisions after step 0. Base and authority: `ae6bc1b7c9071b64fe92135b14fefddfca06cf40` (origin/main, PR 160's merge = L89; the worktree HEAD at the start). Every line number is a source line at that base. Risk P1 (TLS on the owner's credential path to the managed database) with one security round; 0 migrations. Installed: pg 8.22.0, tsx 4.23.0 (a devDependency of `@plexco/db`). This record is the only input the next writer needs.

## 1. Authority

- The owner's message of 2026-11-01 17:22, verbatim (status/OWNER-DECISIONS-2026-11-01.md, section 17:22): "Owner ok: thêm một lane nhỏ xử lý hàng operator-cli-pg-tls-helper. Ba script outbox-dlq-replay, outbox-projector-enable và public-alias-moderate phải dùng helper pgSslConnectionConfig để nhận DATABASE_CA_CERT và quy tắc production; không dùng no-verify. Chạy ngay sau L89 (không song song nếu chung file), phải merge TRƯỚC bước G5 (owner chạy outbox-projector-enable) và nên trước G2. Theo luật hiện hành: readiness, review, security round vì P1, clerk merge nếu không chạm deploy guard. Ghi lane vào P5-SEQUENCE."
- The production-build call (2.1) is "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature" (that section, point 4). The loading path (2.2), the call sites (2.3), the refusal (2.4), the guard (2.5), the test home and the kit record (section 5) are the conductor's decisions after step 0, labelled the same way. The writer's choices in section 3 are Tier B under it (D4 is Tier A), each with the orchestrator's ruling after step 1.
- Precedent: L78's helper `packages/db/src/pg-ssl-options.ts` and L89's rule in it (docs/sessions/web-mvp-phase5-readiness-p5-db-tls-ca-required.md, rows A1-E4), both read-only here.

## 2. Scope and design

### 2.1 The production call (one definition)

NEW `scripts/lib/operator-cli-pg-config.mjs` exports `async function operatorCliPgConfig(connectionString, env = process.env)`, which returns `pgSslConnectionConfig(connectionString, { ...env, NODE_ENV: "production" })`. The caller's NODE_ENV (unset on the owner's machine) never disables the rule: a host that is not loopback or a Unix socket needs DATABASE_CA_CERT, and with a CA a URL that weakens TLS is refused. The helper's logic is never copied: the module only loads and calls it. The helper reads only `env.NODE_ENV` (:49) and `env.DATABASE_CA_CERT` (:47); the host is the one pg dials (:61-81), from the real process PGHOST, as the Client the CLI then builds (section 4, O4-O5).

### 2.2 The loading path (lead 2, measured)

The helper is TypeScript; the CLIs run as plain `node scripts/<cli>.mjs`. On the first call, cached in a module-level promise: `createRequire(new URL("../../packages/db/package.json", import.meta.url))("tsx/esm/api").tsImport(<file URL of packages/db/src/pg-ssl-options.ts>, { parentURL: import.meta.url, tsconfig: false })` (D1). No top-level await: `scripts/outbox-projector-enable.mjs` is imported in-process by `packages/db/src/outbox-projector-enable.test.ts:16-17` and `apps/bot/src/projector-registry.test.ts:10-11`. No try/catch: a load failure or a `PgSslConfigError` rejects, and the CLI's own catch handles it (2.4).

Node versions in play: CI `node-version: 22` (.github/workflows/ci.yml:63, :123), the image `node:22-bookworm-slim` (infra/Dockerfile:7), engines `^22.13.0 || >=24` (package.json:5-6). Measured on official v22.13.0 (the floor), v22.23.4 (newest 22.x) and the owner's v25.6.0:

| Path | v22.13.0 | v22.23.4 | v25.6.0 |
| --- | --- | --- | --- |
| (a) tsx `tsImport`, string parentURL, normal env, cwd = repo root (U1) | exit 0, stderr empty | exit 0, stderr empty | exit 0, stderr empty |
| (a) same, `env -i PATH=...` (the env of `packages/db/src/public-alias.test.ts:875-888`), cwd repo root and `packages/db` (W1) | exit 0, stderr empty | exit 0, stderr empty | exit 0, stderr empty |
| (a) options form `{ parentURL, tsconfig: false }`, `env -i`, both cwds (W1) | exit 0, stderr empty | exit 0, stderr empty | exit 0, stderr empty |
| (b) Node type stripping, no flag (U1) | exit 1, 14-line stack | exit 0, stderr empty | exit 0, stderr empty |
| (b) with `--experimental-strip-types` (U1) | exit 0, 2-line ExperimentalWarning | exit 0, stderr empty | exit 0, stderr empty |

(a) is clean on every version; (b) is not clean on the engines floor; (c), tsx as the runner of every invocation (runbook, tests, e2e), is the largest change and is not needed. No spawner or e2e spec changes: tsx resolves from the CLI's own file, not the caller's cwd.

### 2.3 The call sites

Each CLI changes only its loading lines (one static import of the shared module) and its construction line, to `new pg.Client({ ...(await operatorCliPgConfig(url, env)), application_name: <its existing name> })`: `scripts/outbox-dlq-replay.mjs:104`, `scripts/outbox-projector-enable.mjs:305`, `scripts/public-alias-moderate.mjs:107`. `application_name` follows the spread; no own `ssl` or `connectionString` key; the URL is passed as read (:97, :297, :98), never rewritten. Arguments, SQL, output and exit codes are unchanged. Every construction is already inside the handler's `try` (dlq :103, enable :303, alias :106), before `client.connect()`.

### 2.4 The refusal (lead 4)

A `PgSslConfigError` has no `.code`, so each CLI prints `error: DATABASE_CA_CERT <reason>` (dlq :119, enable :315, alias :117) and exits 1, before connecting; `client` is still undefined, so `finally` ends nothing. The enable CLI then prints its existing generic second line (:316-318), as for an unparsable URL (runbook :59); the enable step has not run. No new error handling. The helper's reasons are constants: none holds the URL, a host, a password or the CA text (pg-ssl-options.ts:19); `redact()` stays in front of every message.

### 2.5 The guard (lead 5)

`packages/db/src/pg-ssl-connection-sites-guard.test.ts`: `DIRS` (:11) gains `"scripts"`; `ROUTED` (:16) also accepts `operatorCliPgConfig(`; `SITES` (:24-35) grows from 10 to 13 (the three CLIs); one assertion reads `scripts/lib/operator-cli-pg-config.mjs` and requires both the forced call `pgSslConnectionConfig(connectionString, { ...env, NODE_ENV: "production" })` and the helper's path as the load target, so a wrapper that stops routing, or routes to a copy, fails CI. With `scripts` scanned, the only constructions are the three CLIs (U2 Q5: the guard's own regex over `scripts`), and no `scripts` file matches its insecure-option pattern.

### 2.6 The docs and the backlog row (leads 6-7)

- `docs/runbooks/outbox-dispatch-enable-rollback.md` section 6: the owner's environment gains DATABASE_CA_CERT (set before a CLI runs against a managed database, cleared with the rest when done), pointing to the one description of its value, `docs/runbooks/staging-deploy.md` §2.5 step (5) (the `[Owner] CA của PostgreSQL` item, :58); and :177's "UNPINNED" TLS line becomes the new behaviour for all three CLIs.
- The alias CLI: see D4.
- `docs/autopilot-backlog.md`: the row `operator-cli-pg-tls-helper` (added by L89, the file's last row) closed by hand in L72's form: `status: merged`, a `merged:` line written before the merge, a `note_merged:` line; `merged_probe: scripts :: operatorCliPgConfig` stays (the shared module satisfies it). No other row.
- Not touched (the orchestrator's): `.env.example:70` ("the operator CLIs in scripts/ keep today's behaviour") becomes stale with this lane.

## 3. Decisions (the writer's, with the orchestrator's rulings)

The orchestrator's rulings after step 1: D1, D2, D3, D5 and D6 ACCEPTED (Tier B, reversible); D4 is the lead's correction (Tier A, measured: no alias procedure doc exists).

- D1 `tsconfig: false` in the tsImport options (U1's recommendation, measured by W1 above): the load never reads a tsconfig found by walking up from the caller's cwd (from a worktree that walk leaves the worktree). One line to revert. ACCEPTED (measured clean, `env -i`, 3 Node builds x 2 cwds).
- D2 the call sites pass `main`'s `env`, the object the URL is read from; at each CLI's only call of `main` it is `process.env` (dlq :126, enable :327, alias :124), so behaviour is the decided `process.env` call, and URL and CA can never come from two environments. ACCEPTED (the URL and the CA come from the same env; `main(argv, env)` stays the one injection point for both).
- D3 the import takes the place of the blank line after each CLI's imports (dlq :20, enable :57, alias :23), so no line above the construction moves and the current pins stay true: env manifest :72 (dlq :97, enable :297, alias :98; negative scope), runbook :161, :174, :175, :208, :236, decisions.md :2210-:2211. Prettier (printWidth 100) splits the construction into 4 lines, moving the lines after it by 3: the one current pin after a construction, runbook :177's `scripts/outbox-dlq-replay.mjs:106`, is in the line this lane rewrites. ACCEPTED.
- D4 (Tier A, the lead's correction) the alias CLI's procedure doc: measured (`git grep public-alias-moderate -- docs`), no doc tells the owner to run it against a managed database. The candidates are `docs/runbooks/local-mvp-smoke.md:205` (the local proof script on a loopback database: row O1, unchanged) and `docs/autopilot-templates/web-mvp-phase3-2026-10-16-RUN.md:573` (a dated lane prompt). Section 6 of the enable runbook is the owner's conditions for staging and production, so its TLS line names all three CLIs and its environment carries the CA: one description, no other doc is edited.
- D5 the per-CLI refusal tests live in the module's test file, next to the module cases: the existing spawners (projector-registry, outbox-projector-enable, public-alias tests) stay untouched and their assertions stay valid (U2 Q4). ACCEPTED.
- D6 one test for the threat "no fallback": a copy of the module whose helper cannot resolve rejects, with no config returned. ACCEPTED.

## 4. Decision table (each row is a test or a measurement)

Env forced to production by the module, so the caller's NODE_ENV changes no row. "Today" = `new pg.Client({ connectionString: url, application_name })`, DATABASE_CA_CERT ignored.

| Row | Case | Host / CA / URL | Result | Evidence |
| --- | --- | --- | --- | --- |
| O1 | local compose, the tests, the e2e proofs | loopback (`localhost`, `127.x`, `::1`, `[::1]`); no CA; plain | `{ connectionString }`, unchanged = today's | unit test; U1 Q1b |
| O2 | loopback with a weakening URL | loopback; no CA; `sslmode=disable` and similar | unchanged = today's (the weakening check runs only with a CA) | U1 Q1b |
| O3 | Unix socket | `host=%2F...` or an encoded socket host; no CA | today's | U1 Q1b |
| O4 | host-less URL | `postgres:///d`; pg falls back to the real PGHOST, then localhost | PGHOST unset or loopback: today's; PGHOST remote: refuse (the helper and the Client decide on the same host; an env argument's PGHOST is ignored, as pg ignores it) | W1 Q9.1, Q9.5 |
| O5 | `host=` overrides the URL host | remote URL host + `host=127.0.0.1`; loopback URL host + `host=db.invalid` | today's; refuse | W1 Q9.3, Q9.4 |
| O6 | the owner's machine, no CA | remote (`db.invalid`, `0.0.0.0`, `LOCALHOST`, `127.1`, unparsable); caller NODE_ENV unset, `development`, `test` or `production` | REFUSE `DATABASE_CA_CERT is required when NODE_ENV is production and the database host is not loopback or a Unix socket` | unit tests (unset, development); per-CLI spawn |
| O7 | the owner's machine with the CA | any host; valid certificate blocks; plain URL | `{ connectionString, ssl: { ca: [...], rejectUnauthorized: true } }` | unit test (remote); W1 Q9.2 (loopback) |
| O8 | the runbook's URL form with the CA | `sslmode=verify-full&sslrootcert=<path>` and the other allowed values | as O7; every `ssl*` and `uselibpqcompat` parameter removed from the URL | U1 Q1b |
| O9 | a weakening URL with the CA | any host; `sslmode=disable/allow/prefer/no-verify` (any name case), `ssl=false/0`, `uselibpqcompat=true` | REFUSE `DATABASE_CA_CERT is set, so the database URL parameter <name> must be <allowed>` | unit test; U1 Q1b |
| O10 | a CA that is not certificate text | not PEM, empty, another block, unparsable | REFUSE (pg-ssl-options.ts:88, :92, :97) | U1 Q1b; L78 tests |
| O11 | a URL with a tab or line break, CA set | any | REFUSE (:107-109) | L78 tests |
| O12 | the helper cannot load | tsx or the helper unresolvable | the promise rejects; no config; the CLI's error line, exit 1 | unit test (D6) |
| O13 | a CA left in a shell that runs a loopback database without TLS | loopback; CA set | verified TLS is attempted and the connection fails, exit 1 (fail closed; from O7, not measured); no spawner, CI file or proof wrapper sets DATABASE_CA_CERT (U2 Q10), and the runbook clears it after the work | runbook section 6 |

## 5. Tests and placement

- NEW `packages/db/src/operator-cli-pg-config.test.ts` (vitest project "parallel", no database; the `.mjs` imported behind `// @ts-expect-error` as `outbox-projector-enable.test.ts:16-17`): the module cases, each named for its real case (O6 with NODE_ENV unset and with `development`; O7 remote; O1; O9), O12, and per CLI the refusal spawn: `node scripts/<cli>.mjs` with minimal valid arguments (dlq `list`, enable `enable --projector zalo_dm`, alias `list`), env = PATH and `DATABASE_URL_MIGRATION` (`db.invalid` host, a marker password) only: exit 1, a first stderr line `error: DATABASE_CA_CERT is required ...`, no stack line, neither stream holds the URL, the host or the marker. The CA is made by openssl at test time in a temp dir, as `pg-ssl-options.test.ts:34-61`: no key or certificate text in the file.
- The guard (2.5), and its mutation: a copy of one CLI that builds `{ connectionString: url, ... }` copied over the CLI after commit 3 makes the guard test fail; restored with `git checkout`.
- Kit record: `scripts/lib/operator-cli-pg-config.mjs` gets a record in `docs/standards/kit-pack-membership.json` in the shape of `scripts/outbox-dlq-replay.mjs` (:171-175), then `pnpm kit:generate` rewrites `docs/standards/kit-pack-membership.md`, then `pnpm kit:check` (the audit classifies every file under `scripts/`, U2 Q6).

## 6. Verification and review

Through the DB/e2e lock: `pnpm --filter @plexco/db test` and `pnpm --filter @plexco/bot test` (projector-registry spawns two CLIs); `pnpm -w test` at the end; `pnpm typecheck`, `pnpm lint`, `pnpm format:check`; `pnpm review:check:changed` before every commit and `pnpm review:check` at the end; the local Semgrep scan before the first push; the reconcile with no new refusal. CI e2e green proves the e2e proofs still run the CLIs. Review: R1 (code) and S1 (security) in parallel on the committed head, with section 8.

## 7. Budget (B3) and commits

B3 estimate 360 owned-diff lines (module about 30, call sites about 15, tests about 170, this record about 110, runbook about 15, backlog about 15, guard about 5). Commits: (1) this record; (2) the module, its unit tests and the kit record; (3) the three CLIs, the guard and the per-CLI refusal tests; (4) the runbook and the backlog row.

## 8. Security notes for the security round (threat model)

Adversaries: a mistake or an operator edit that downgrades TLS on the owner's credential path, and a network attacker between the owner's machine and the database.

- A CLI, or a future CLI, that bypasses the helper: the guard scans `scripts` and requires every construction there to route through `operatorCliPgConfig(` or the helper with no own `ssl`/`connectionString` key; the mutation proves it fails.
- The caller's NODE_ENV disabling the rule: forced in the one module; unit tests with unset and `development`; the guard pins the forced call's text.
- A load path that falls back to an unverified connection: no catch in the module; O12.
- A refusal or error that prints the URL, a host, the CA or the credential: constant reasons; `redact()`; the spawn tests assert both streams. A load failure prints a module path, never input.
- A URL rewritten before the helper: the call sites pass `url` as read; the helper decides on the host pg dials, equal to the Client's in every measured row (O4, O5).
- New stderr output: none on any version or env measured (2.2); the existing stderr assertions (projector-registry.test.ts:92-96, public-alias.test.ts:936-938) stay as they are.
- No no-verify, no insecure option, no committed key or certificate, no new env name.

## 9. Open

None in scope. Out of scope, reported to the orchestrator: no runbook describes running the alias CLI against staging or production (D4); `.env.example:70` (2.6).

## 10. Hard dependencies

PR 160 (L89, the rule in the helper) is merged and is the base. Nothing unmerged.

## 11. Closure matrix (12 of 12 PASS)

| # | Gate | Evidence | Result |
| --- | --- | --- | --- |
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the worktree HEAD = the base; section 1 | PASS |
| 2 | Decisions in scope final | the owner's 17:22 message, the conductor's decisions after step 0, the writer's D1-D6 with the orchestrator's rulings (section 3) | PASS |
| 3 | Scope IN/OUT and owner clear | sections 2 and 7; the verdict's IN_SCOPE and OUT_OF_SCOPE | PASS |
| 4 | Dependencies classified | section 10 | PASS |
| 5 | Live schema and code match | 2.2-2.5 measured at the base; no schema change | PASS |
| 6 | Data, API, state, auth contract | 2.1 and the decision table; CLI arguments, SQL, output and exit codes unchanged | PASS |
| 7 | Fail-closed, idempotency, order | unknown host = remote; no fallback (O12); the refusal before any connection | PASS |
| 8 | Open questions in scope = 0 | section 9 | PASS |
| 9 | Acceptance matrix with expected results | section 4 (every row) and section 5 | PASS |
| 10 | Migration, security, rollback | no migration; one security round on section 8; rollback = revert the merge | PASS |
| 11 | First slice hard dependencies merged | section 10 | PASS |
| 12 | Implementation handoff ready | sections 2-7 | PASS |

## 12. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-11-01
AUTHORITY_SHA: ae6bc1b7c9071b64fe92135b14fefddfca06cf40
BASE_BRANCH: main
TARGET_FILES:
  - scripts/outbox-dlq-replay.mjs (edited: one import line, the construction)
  - scripts/outbox-projector-enable.mjs (edited: one import line, the construction)
  - scripts/public-alias-moderate.mjs (edited: one import line, the construction)
  - packages/db/src/pg-ssl-connection-sites-guard.test.ts (edited: DIRS, ROUTED, SITES, the wrapper assertion)
  - docs/standards/kit-pack-membership.json (edited: one record)
  - docs/standards/kit-pack-membership.md (regenerated by pnpm kit:generate)
  - docs/runbooks/outbox-dispatch-enable-rollback.md (edited: section 6, the owner environment and the TLS line)
  - docs/autopilot-backlog.md (edited: the row operator-cli-pg-tls-helper, closed by hand)
  - packages/db/src/pg-ssl-options.ts (read-only: the helper)
  - apps/bot/src/projector-registry.test.ts (read-only: a spawner whose assertions stay valid)
  - packages/db/src/outbox-projector-enable.test.ts (read-only: a spawner and in-process importer)
  - packages/db/src/public-alias.test.ts (read-only: the PATH-only spawner)
  - docs/runbooks/staging-deploy.md (read-only: the one description of the CA value)
SLICE: p5-operator-cli-pg-tls-helper
IN_SCOPE: the new module scripts/lib/operator-cli-pg-config.mjs and its test packages/db/src/operator-cli-pg-config.test.ts; the loading and construction lines of the three owner CLIs; the sites guard scan of scripts; one kit record and the regenerated kit doc; runbook section 6; the one backlog row closed by hand; this record
OUT_OF_SCOPE: packages/db/src/pg-ssl-options.ts and any second definition of its rule; every deploy-guard file, App Spec and the env manifest; .env.example; the e2e specs and proofs; public-alias.test.ts; root package.json; any change to the CLIs beyond the connection config; any no-verify or insecure option; any committed key, certificate or real CA; migrations; other backlog rows; any secret value or connection string
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none unmerged; ae6bc1b7c9071b64fe92135b14fefddfca06cf40 (PR 160's merge, L89) is the base
PRIOR_SLICES: p5-db-tls-ca-options (L78, merged), p5-db-tls-ca-required (L89, merged)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none # the owner sets DATABASE_CA_CERT on the owner machine before G5, a post-merge runbook step
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration; one security round (opus) on section 8
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W writes scripts/lib/operator-cli-pg-config.mjs and packages/db/src/operator-cli-pg-config.test.ts (section 5), adds the kit record, runs the test and the package typecheck, and commits
REMAINING_BLOCKERS: none
```
