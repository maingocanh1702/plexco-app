<!-- review-readiness: code-ready -->

# Step-0 readiness: L32 p3-db-test-role-hiding-isolation (session P3-S16j)

> Agent-facing. Step-0 readiness reviewers opus/high, split by area (lane block L32 MODELS): S0A the role-mutating tests (Q1, Q4); S0B the by-name checkers, the harness locks and the guard (Q1, Q2, Q5); S0C1 the vitest and CI invocation (Q2, Q3); S0C2 the reproducer and the design probe (Q2, Q3). The base hit rate and every choice below are the P3-S16j orchestrator's; this file is written by the step-0 readiness-file writer (opus/high) and does not re-decide them.
> Writers W1 and W2 opus/max, W3 sonnet/high. Code reviewer opus/max, at most 3 rounds; no security round (lane block judgement: no trust boundary; void if a product file or a migration enters the diff). RISK: P2 (test infrastructure only). Lane contract: lane block L32 of the conductor-authored P3-S16j brief (not on main).
> Base `07bbe3482afec629456c4497f21a60a6d2fcef30` (origin/main, the merge of PR #104; it contains L25 PR-A and PR-B); branch `test/p3-db-test-role-hiding-isolation`; worktree `.autopilot/worktrees/p3-db-test-role-hiding-isolation`, clean at step 0 (measured: HEAD = base, `status --porcelain` empty, no index.lock).
> Every `path:line` is MEASURED at the base. The step-0 notes live outside the repo in `status/P3-S16j-notes` (N): `s0a-role-mutating-inventory.md`, `s0b-checkers-helpers-guard.md`, `s0c1-vitest-ci-semantics.md`, `s0c2-repro-probe.md`, `hit-base-summary.txt` and the run logs. The reproducer's full source is in 3.4, so the evidence is durable in git.

## 1. Authority

- Owner standing delegation of 2026-10-22, verbatim: "chọn các option mang lại lợi ích long term và tối đa cho pj" (choose the options with the most long-term benefit for the project). Lane block L32 is conductor-authored under it (D11 and D13 in `status/P3-S16-conductor-decisions.md`): a conductor decision, NEVER an owner signature; the owner can reverse it. It extends the owner's item 9 of 2026-10-22 (lane L18: "YES. Serialize bootstrapJobDefiner with an advisory lock (no extra retry)") from one race to the whole CLASS of the same mechanism.
- Lane block GOAL: no test file of the @plexco/db suite, or of another package that shares the cluster, can observe a hidden cluster role or a temporary grant, BY CONSTRUCTION; every assertion unchanged (moved or wrapped, never weakened); a guard test fails on a role-hiding or temporary-grant statement outside the isolated place; a deterministic reproducer red on the base and green after, plus consecutive green full-suite runs. B3 pre-approved: 160 non-test lines, 900 test lines added (a moved block counts as added), 1,100 total excluding docs, 10 files, 0 migrations.
- FILE OWNERSHIP: `packages/db/vitest.config.ts`, `packages/db/package.json` (the test script only), `packages/db/src/test-harness.ts`, the role-hiding and temporary-grant blocks of `packages/db/src/migrate.test.ts` (lane L29, P3-S16g, owns its migration-tail pin lines), a new guard test, the `packages/db/README.md` hidden-role paragraph, this file.
- `status/conductor-scripts/clerk-flake-list.txt` is NOT edited by this lane: the conductor retires its CLASS entries after the merge has a green record on main (A2b). Review per DD-122 D4 (Codex waived by the owner 2026-10-12): an independent Claude reviewer.

## 2. Measured at base

- Hit rate (orchestrator, `N/hit-base-summary.txt`, 2026-10-22 16:08-16:21 Z): 10 locked runs of `pnpm --filter @plexco/db test`, 62 files and 2,039 tests each: 2 red, 8 green. Run 1 `src/chat-catalog.test.ts` "RO-L14-6 (DT-27): identity_definer may SELECT exactly the three person-FK columns"; run 10 `src/public-sessions-projector.test.ts` "PSP-5b: app_worker and app get 42501 on both fence functions". No run left a role hidden or a definer grant behind.
- Per-file times (`N/scripts/s0-file-durations.mjs` on run 2's JSON): wall 79.7 s = `migrate.test.ts` 79.7 s, overlapping all 61 other files; the sum of file durations is 237.6 s.
- vitest 4.1.12 (`packages/db/node_modules/vitest/package.json:4`) supports `test.projects` and `sequence.groupOrder`. `packages/db/vitest.config.ts:18-23`: `fileParallelism: true`, `sequence: { concurrent: false }`, `testTimeout: 30_000`, `hookTimeout: 120_000`; no projects, include, exclude, bail, pool or globalSetup. `packages/db/package.json:21` `"test": "vitest run --passWithNoTests"`; root `package.json:11` ends with `pnpm -r run test`; `.github/workflows/ci.yml:106` `run: pnpm -w test`, `DATABASE_URL_TEST` at `:45`.
- Other packages (S0C1 Q6, CI run 39806061526; local `pnpm -w test` the same): only packages/core overlaps the db suite (about 2 s), and it touches no Postgres (no DATABASE_URL, pg or @plexco/db reference: S0C1 T1, closed); apps/bot and apps/web (`"@plexco/db": "workspace:*"` at `apps/bot/package.json:14`, `apps/web/package.json:16`) start after the db suite is done.
- 62 tracked test files in `packages/db/src`; `migrate.test.ts` is 5,224 lines; 5 test files call withDefinerReadLock and 21 db test files take no lock (S0B).

## 3. Evidence and design

### 3.1 Role-mutating inventory (Q1; S0A section 1)

Only role-level state is cluster-global (CREATE, DROP, ALTER or RENAME ROLE; GRANT or REVOKE of a role); object grants live in each file's own throwaway database (S0B 1a). Every window must be COMMITTED (`migrate()` and the bootstrap scripts use their own connection or transaction), so no rollback variant can replace the isolation (S0A section 2). The windows are the rows of 3.7, each restored in a finally under its breaker lock: three role hides in `migrate.test.ts` (job_definer W1, identity_definer W3, chat_definer W7 with 21 sub-windows), four temporary `GRANT <definer> TO app_worker` (`:1162`, `:1313`, `:3093`, `:3745`), scratch-role tests, and the T1 hand-off: `setupNonSuperuserOwnerContext` (`test-harness.ts:861`) moves chat_definer and identity_definer membership from plexco to a LOGIN owner role for the context's lifetime (36 call sites in 6 files, restored in nested finally blocks `:1034-1095`, guarded only by chad, which no reader takes).

### 3.2 By-name checkers and lock coverage (Q1, Q2; S0B sections 1-2)

- A rename keeps the OID: `pg_get_userbyid(proowner)` returns `*_hidden_for_test` (PR #103 CI and main CI of #104 at `chat-dm-safety-invariants.test.ts:857-860`); `'x'::regrole`, `has_*_privilege('x', ...)` and `pg_roles WHERE rolname = 'x'` raise 42704 or return no row; `has_*_privilege('app_worker', ...)` follows membership, so a temporary definer grant reads true. Unprotected checkers: `chat-dm-safety-invariants.test.ts:508-548`, `:857`, `:862`; `gender-pricing-definers.test.ts:117`, `:123`, `:163`; `tenant.test.ts:119-122`; `chat-catalog.test.ts:131`, `:135`, `:279`, `:290`, `:299`, `:359`, `:369`, `:378`.
- Locks (`test-harness.ts`): withJobDefinerLock `:573` (jobd shared), withJobDefinerBreakerLock `:578` (jobd exclusive), withDefinerReadLock `:583` (jobd plus chst shared), withChatDefinerLock `:490` and acquireChatDefinerLock `:509` (chad), withIdentityDefinerNameLock `:649` (idnm), the password lease (rlpw, rlpr), withJobDefinerBootstrapLock `:247` (plxc): all session-level advisory locks on an own client on `DATABASE_URL_TEST`, released in a finally and by the server when a worker dies. Protection is per call site and per key (jobd shared never excludes the chat or identity windows; nothing excludes T1): per-test discipline, not structure.

### 3.3 vitest semantics (Q2, Q3; S0C1)

- One `vitest run` runs projects strictly in `sequence.groupOrder`: group N+1 starts after every file of group N has finished (afterAll included). No bail is configured, so a red group never skips a later one and the exit code covers every group.
- A CLI `--fileParallelism` overrides project settings and a CLI `--sequence.*` flag resets groupOrder. `extends: true` re-loads the root options; include and exclude are per project; the parallel exclude must spread `configDefaults.exclude`; every project needs a name. File and `-t` filters work across projects, `--project` drops the others, labels read `|name|`, and `--passWithNoTests` makes an empty project silent.

### 3.4 Deterministic reproducer (Q2; S0C2 sections 1, 2 and 3a)

The observer polls the cluster-global role catalogs every 100 ms and asserts it saw nothing. It is NEVER committed: kept at `N/repro/role-hiding-observer.test.ts`, copied to `packages/db/src/role-hiding-observer.test.ts` for a run and deleted right after (porcelain empty again). Command, one call per run through `N/scripts/locked-run.sh`: `pnpm --filter @plexco/db test src/migrate.test.ts src/role-hiding-observer.test.ts`; the evidence variant adds `--reporter=verbose --reporter=json --outputFile.json=<path>` (reporters only).

- Base config, RED 3 of 3 (`N/repro-base-{1,2,3}.log`): exit 1, 111 of 112 tests passed (all of `migrate.test.ts`); the observer failed with the same 8 observations at offsets within about 0.7 s (the window lengths of 3.7).
- Probe config (3.5), GREEN 2 of 2 (`N/repro-probe-{1,2}.log`): exit 0, 112 of 112; run 2 printed `[observer] done: polls=893 distinct_observations=0`; the observer ran under `|parallel|` from +0.0 s for 90.1 s and `migrate.test.ts` under `|isolated-1|` from +90.9 s; overlapping_files 0.

```ts
// P3-S16j step 0 (S0C2) SCRATCH reproducer for lane L32: never committed, never staged. It is copied into
// packages/db/src/ only for its own runs and deleted right after them.
//
// One pg.Client on DATABASE_URL_TEST polls the cluster-global role catalogs every 100 ms for OBSERVER_SECONDS
// (env, default 90) and records the first (and last) time it sees:
//   (a) a role whose name contains "hidden_for_test", or job_definer / chat_definer / identity_definer missing
//       from pg_roles;
//   (b) a membership of job_definer / chat_definer / identity_definer (current name, or a parked
//       "*hidden_for_test" name) granted to app, app_worker or readonly;
//   (c) the members of the role NAMED chat_definer or identity_definer differing from the set read at the
//       observer's start ("<missing>" when no role carries the name) -- by-name, which is exactly what a
//       by-name checker in another test file observes.
// It logs each first observation with its offset in seconds, then asserts that nothing was observed.
// Literal SQL only; no RegExp anywhere.
import pg from "pg";
import { describe, expect, it } from "vitest";

const SQL_A_HIDDEN = `SELECT rolname FROM pg_roles WHERE strpos(rolname, 'hidden_for_test') > 0 ORDER BY rolname`;

const SQL_A_MISSING = `SELECT x.name
  FROM (VALUES ('job_definer'), ('chat_definer'), ('identity_definer')) AS x(name)
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = x.name)
  ORDER BY x.name`;

const SQL_B = `SELECT r.rolname AS role, m.rolname AS member
  FROM pg_auth_members am
  JOIN pg_roles r ON r.oid = am.roleid
  JOIN pg_roles m ON m.oid = am.member
  WHERE (r.rolname IN ('job_definer', 'chat_definer', 'identity_definer')
         OR strpos(r.rolname, 'hidden_for_test') > 0)
    AND m.rolname IN ('app', 'app_worker', 'readonly')
  ORDER BY 1, 2`;

const SQL_C = `SELECT x.name AS role,
    EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = x.name) AS present,
    (SELECT coalesce(string_agg(m.rolname, ',' ORDER BY m.rolname), '')
       FROM pg_roles r
       JOIN pg_auth_members am ON am.roleid = r.oid
       JOIN pg_roles m ON m.oid = am.member
      WHERE r.rolname = x.name) AS members
  FROM (VALUES ('chat_definer'), ('identity_definer')) AS x(name)
  ORDER BY x.name`;

const seconds = Number(process.env.OBSERVER_SECONDS ?? "90");

type Seen = { first: number; last: number; polls: number; value: string };

describe("role-hiding observer (L32 step-0 scratch reproducer)", () => {
  it(`sees no hidden definer, temporary definer grant or changed definer membership for ${seconds} s`, async () => {
    const url = process.env.DATABASE_URL_TEST;
    if (!url) throw new Error("DATABASE_URL_TEST is not set");
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const seen = new Map<string, Seen>();
    const t0 = performance.now();
    const offset = () => (performance.now() - t0) / 1000;
    const note = (key: string, value: string) => {
      const at = offset();
      const rec = seen.get(key);
      if (rec) {
        rec.last = at;
        rec.polls += 1;
        return;
      }
      seen.set(key, { first: at, last: at, polls: 1, value });
      console.log(`[observer] FIRST +${at.toFixed(1)}s ${key}${value ? ` ${value}` : ""}`);
    };
    let polls = 0;
    try {
      const startRows = (await client.query<{ role: string; present: boolean; members: string }>(SQL_C)).rows;
      const start = new Map(startRows.map((r) => [r.role, r.present ? r.members : "<missing>"]));
      console.log(`[observer] start members: ${[...start].map(([r, m]) => `${r}=[${m}]`).join(" ")}`);
      while (offset() < seconds) {
        const tick = performance.now();
        polls += 1;
        for (const r of (await client.query<{ rolname: string }>(SQL_A_HIDDEN)).rows) {
          note(`(a) hidden role present: ${r.rolname}`, "");
        }
        for (const r of (await client.query<{ name: string }>(SQL_A_MISSING)).rows) {
          note(`(a) definer missing from pg_roles: ${r.name}`, "");
        }
        for (const r of (await client.query<{ role: string; member: string }>(SQL_B)).rows) {
          note(`(b) definer membership: ${r.role} -> ${r.member}`, "");
        }
        for (const r of (await client.query<{ role: string; present: boolean; members: string }>(SQL_C)).rows) {
          const now = r.present ? r.members : "<missing>";
          if (now !== start.get(r.role)) {
            note(`(c) members of ${r.role} differ from start`, `start=[${start.get(r.role)}] first_seen=[${now}]`);
          }
        }
        await new Promise((res) => setTimeout(res, Math.max(0, 100 - (performance.now() - tick))));
      }
    } finally {
      await client.end();
    }
    const report = [...seen].map(
      ([k, v]) =>
        `${k} first=+${v.first.toFixed(1)}s last=+${v.last.toFixed(1)}s polls=${v.polls}${v.value ? ` ${v.value}` : ""}`,
    );
    console.log(`[observer] done: polls=${polls} distinct_observations=${report.length}`);
    for (const line of report) console.log(`[observer] SUMMARY ${line}`);
    expect(report).toEqual([]);
  }, 120_000);
});
```

### 3.5 Design probe and alternatives (Q3; S0C2 section 3b; conductor note A1)

Probe = DF1's config (`N/s0c2-repro-probe.md` section 3 keeps its source). Full suite under it (`N/probe-full-1.log`): exit 0, 62 of 62 files and 2,039 of 2,039 tests (equal to the base); overlapping_files 0 for every isolated file (base 61, 14, 7, 7, 4, 5, 4); wall 105.8 s against 79.7 s (+26 s, about +33 %, of which about 10 s is per-group startup; `migrate.test.ts` alone 44.8 s).

| Alternative | Measured cost or failure mode | Verdict |
|---|---|---|
| A: one `vitest run`; project "parallel" (groupOrder 0) plus one project per isolated file (groupOrder 1..7) | +26 s wall; whole files, 0 test lines moved; `migrate.test.ts`, `test-harness.ts` and `package.json` unchanged; scheduling only, so no lock can be left held | CHOSEN (DF1): structural, fewest concepts, reversible by deleting the projects block |
| A': move only the role-mutating blocks to new files | about 1,950 added lines (over the 900 cap); a second MIGRATION_COUNT pin; conflicts with L29's hunks | rejected |
| B: universal shared lock per file, exclusive for the hiding tests | needs a new key (reusing jobd or chst makes nested readers hang behind a queued exclusive waiter, invisible to the deadlock detector, `test-harness.ts:589-593`); beforeAll queues up to the 120 s hookTimeout; one hung test starves the exclusive side (S0A section 5) | rejected: new hangs and timeouts, more concepts |
| C: per-test discipline (more withDefinerReadLock) | 21 files take no lock; protection depends on the key each test picks (3.2) | rejected: not structural |
| D1: `fileParallelism: false` for the whole package | sum of file durations 237.6 s (an upper estimate of the serial wall) | rejected: about 2.2 times the wall |
| D2: one isolated project with `fileParallelism: false` | a CLI `--fileParallelism` lets its files overlap each other (3.3) | rejected: not structural under the CLI |
| D3: transaction-and-rollback variants | the windows must be committed (3.1) | rejected: cannot express the tests |

### 3.6 Threat model (lane block THREAT MODEL)

| # | Threat | Control |
|---|---|---|
| 1 | a by-name role check observes a hidden role (false failure) | every file that renames a shared role runs alone in its own isolated project after the parallel phase (overlapping_files 0, 3.5); the reproducer is red on the base, green after (3.4) |
| 2 | a privilege check observes a temporary grant | the same isolation: every temporary grant and every T1 hand-off sits in an isolated file (3.7) |
| 3 | the isolation hides a REAL regression (a weakened assertion, a test no longer run, a phase skipped in CI) | 0 test lines moved, no assertion touched; one `vitest run` covers every group and its exit code (3.3); file and test counts reconcile with the base (62 and 2,039; the guard is the only addition); the guard pins includes, excludes, unique groupOrders and a flag-free test script; CI keeps `pnpm -w test` |
| 4 | a crashed hiding test leaves the cluster dirty or a lock held | groupOrder is scheduling, not a lock: nothing new can be held; the existing session locks die with the worker; leftover DDL after a kill is as today, but no other file runs beside it in that run; the README recovery text stays (DF6) |
| 5 | starvation or deadlock between exclusive and shared holders | no new lock; the helpers unchanged; the isolated groups run one after another, each with the cluster to itself |
| 6 | drift: a new test hides a role elsewhere | the guard (DF4): the set of files with a shared-role mutation must EQUAL the isolated includes, so a mutation in any other file, or an isolated file without its project, fails |

### 3.7 Decision table (Q1 x Q4; no blank cell)

| Row | Statement or window | Window length | Restore on crash | Observable before (base) | Observable after (A) | Outcome |
|---|---|---|---|---|---|---|
| W1 | `migrate.test.ts:1066` job_definer renamed (scratch job_definer `:1109`, `:1114`) | about 5.5 s within +9.4..+31.8 s; name absent about 1.1 s | finally `:1080-1083`; a kill parks it, no self-heal, manual rename back | by-name readers of job_definer (`gender-pricing-definers.test.ts:117`, `:123`, `:163`); jobd shared holders excluded | nobody: isolated-1 runs alone | isolated |
| W2 | `:1162` GRANT job_definer TO app_worker (JCL-3b) | 1-5 s by source; one sighting +11.2..+11.6 s | REVOKE in finally; a kill leaves app_worker a member, 01 refuses, manual REVOKE | app_worker privilege checks (`tenant.test.ts:119-122`) | nobody | isolated |
| W3 | `:1186` identity_definer renamed (scratch roles `:1293`-`:1343`) | one poll (about 0.1 s) per run; S0A's source estimate 2-8 s per case | finally `:1191-1192`; self-heals in the next `migrate.test.ts` beforeAll (README `:554-557`) | identity_definer checks (`chat-catalog.test.ts:279`, `:290`; base run 1) | nobody | isolated |
| W3g | `:1313` GRANT identity_definer TO app_worker | never seen: under 100 ms or uncommitted | inside W3's window (exact revert line unconfirmed, S0A TODO 2) | app_worker checks (`chat-dm-safety-invariants.test.ts:508-548`), theoretical | nobody | isolated |
| W4 | `:3093` GRANT job_definer TO app_worker | under 1 s | REVOKE in finally; a kill as W2 | as W2 | nobody | isolated |
| W5 | `:3032-3039` scratch admin role (probably a job_definer member through 01, S0A TODO 4) | seconds | dropped at `:3039` (finally unconfirmed); a kill leaves a scratch member | job_definer member-set readers | nobody | isolated |
| W6 | `:3140`, `:3180` scratch target role with job_definer membership | seconds | dropped at `:3180` (finally unconfirmed); a kill leaves a scratch member | job_definer member-set readers | nobody | isolated |
| W7 | `:3328` chat_definer renamed, 21 sub-windows, scratch chat_definer roles | +32..+40.7 s, about 8.6 s | finally `:3344-3346`; a kill parks it, no self-heal; every 0030+ function owner then reads `chat_definer_hidden_for_test` | `chat-dm-safety-invariants.test.ts:857`, `:862` (PR #103, main #104); `chat-catalog.test.ts:299`, `:359`, `:369`, `:378` | nobody | isolated |
| W7g | `:3514`, `:3531`, `:3605` chat_definer grants to scratch targets | never seen: under 100 ms or uncommitted | inside W7's finally | chat_definer member-set readers, theoretical | nobody | isolated |
| W8 | `:3745` GRANT chat_definer TO app_worker | never seen: under 100 ms or uncommitted | REVOKE in finally | app_worker checks, theoretical | nobody | isolated |
| W9 | `:330-660` one-member hand-off tests with scratch owners | seconds | drops in finally (comments `:429-447`, `:598-600`) | chat_definer member-set readers | nobody | isolated |
| W9o | `:366` owner `plexco_migrate_owner`: members of chat_definer and identity_definer `[plexco_migrate_owner]` instead of `[plexco]` (found by S0C2) | about 40 s (+6..+46 s), intermittent | the hand-off teardown restores plexco; a kill leaves plexco revoked, 02 and 03 refuse, manual DROP ROLE plus GRANT | any by-name membership reader of either definer (the observer's view c) | nobody | isolated |
| W10 | `:107`, `:123` DROP ROLE IF EXISTS of a scratch race role | one cleanup statement | scratch leftover only | nobody by a shared name | nobody | isolated (whole file) |
| W11 | `:2482-2513` scratch lowpriv and target roles | seconds | scratch leftover only | nobody by a shared name | nobody | isolated (whole file) |
| T1 | `setupNonSuperuserOwnerContext` in `migrate.test.ts` (31 call sites) | one test per context | nested finally `test-harness.ts:1034-1095`; a kill as W9o | membership readers of chat_definer and identity_definer; only chad holders excluded | nobody | isolated |
| T1-rls | `rls-invariants.test.ts:2105` (JCL-1) | one context | as T1 | as T1 | nobody | isolated (isolated-2) |
| T1-tca | `tenant-capability-authority.test.ts:452` | one context | as T1 | as T1 | nobody | isolated (isolated-3) |
| T1-nb | `identity-link-web-nobypass.test.ts:27`, `me-player-reads-nobypass.test.ts:31`, `public-alias-nobypass.test.ts:26` | up to the whole file (placement immaterial once isolated) | as T1 | as T1 | nobody | isolated (isolated-5..7) |
| ILW | `identity-link-web.test.ts:672` ALTER ROLE identity_definer NOBYPASSRLS inside BEGIN...ROLLBACK | one transaction | ROLLBACK; a kill aborts it | nobody (MVCC); its row lock makes a concurrent ALTER or RENAME wait | nobody | isolated anyway (isolated-4): the guard has no per-statement exception |
| DL | `dev-login-db.test.ts:517`, `:526` ALTER ROLE app IN DATABASE (its own db) | the file's run | DROP DATABASE removes it | nobody: keyed by database and role | nobody | not applicable: per-database |
| OBJ | object GRANT or REVOKE in own databases (`identity-link-web.test.ts:761`, `session-service.test.ts:4008`, `chat-schema-invariants.test.ts:476`, apps/bot `dispatcher.test.ts:924`, `preflight.test.ts:236`, `:329`) | the file's run | DROP DATABASE | nobody: per-database | nobody | not applicable: per-database |
| SCR | scratch names (`rls-invariants.test.ts:2180-2201`, `test-harness.test.ts:333-368`, `:524-536`) | seconds | dropped in the test | nobody by a shared name | nobody | not applicable: scratch name |
| PL | harness password lease (`test-harness.ts:162`, `:183`) | the whole run | the snapshot file restores it on the next run | every file, by design | every file, by design | not applicable: a different mechanism, serialized by the rlpw lease, outside this lane |
| BS | bootstraps 01-03 (permanent, idempotent ensure of each definer) | per call | refuse on drift (fail closed) | every file sees the same final state | the same | not applicable: no temporary state |

## 4. Pinned defaults

Tier B per level3 §6.1 (lane block DEFAULTS: reversible); each is "default applied, pending owner sign-off" here and in the PR body, with its rejected alternatives.

- **DF1** design = alternative A: `packages/db/vitest.config.ts` keeps its root options and gains `test.projects`: "parallel" (`extends: true`, include `src/**/*.test.ts`, exclude `[...configDefaults.exclude, ...isolated]`, `sequence.groupOrder: 0`) and ONE project per isolated file ("isolated-<k>", `extends: true`, include exactly that file, `groupOrder: k`, k = 1..7 in DF2's order), so the isolated files overlap neither the parallel phase nor each other, even under a CLI `--fileParallelism`; one `vitest run`, no `&&` chain, so every file runs and the exit code covers every group; a `ponytail:` comment names the +26 s ceiling and the upgrade path (split `migrate.test.ts` so its non-mutating tests rejoin the parallel phase). Rejected: A', B, C, D1, D2, D3 (3.5). Default applied, pending owner sign-off.
- **DF2** isolated set = every test file holding a cluster-global temporary mutation of a shared role (the guard's rule), in order: `src/migrate.test.ts`, `src/rls-invariants.test.ts`, `src/tenant-capability-authority.test.ts`, `src/identity-link-web.test.ts` (its `:672` is rolled back and MVCC-invisible; isolated anyway so the guard has no per-statement exception), `src/identity-link-web-nobypass.test.ts`, `src/me-player-reads-nobypass.test.ts`, `src/public-alias-nobypass.test.ts`. Whole files, 0 test lines moved. Rejected: block moves (A'), a per-statement allow-list. Default applied, pending owner sign-off.
- **DF3** unchanged: `packages/db/src/migrate.test.ts`, `packages/db/src/test-harness.ts` and `packages/db/package.json` (no hunk near L29's pin lines); the lock helpers withJobDefinerLock and withDefinerReadLock stay as defence in depth (their removal is O1). Default applied, pending owner sign-off.
- **DF4** guard = new `packages/db/src/role-hiding-isolation-guard.test.ts` (S0B section 4; precedent: lane L27's `member-name-writer-guard.test.ts`), a pure fs scan without a DB, in the parallel phase. It scans every `*.test.ts`, `*.test.tsx` and test helper under packages/ and apps/ (node_modules excluded), comments stripped, literal regexes only (C11b). It flags RENAME or DROP of a shared role (job_definer, chat_definer, identity_definer, app, app_worker, readonly, plexco), ALTER ROLE of a shared role except the pinned harness password-lease statements and the per-database `ALTER ROLE ... IN DATABASE` form, GRANT or REVOKE of a shared-role membership, and calls of `setupNonSuperuserOwnerContext(`. It asserts: the set of files with hits (the harness's own definitions pinned out) EQUALS the isolated includes; each isolated project has exactly one existing file and a unique groupOrder above the parallel one's; the parallel project excludes every isolated file; the package test script passes no `--sequence` or `--fileParallelism` flag; it is not vacuous (a planted fixture string is flagged, its commented twin is not, the scanned-file count is above a floor). Rejected: a statement allow-list, a lint rule. Default applied, pending owner sign-off.
- **DF5** stress N = 20 consecutive green locked full db-suite runs on the final head (at the base rate of 2 in 10, 20 greens by chance is about 1 % likely), plus the observer red 3 of 3 on the base (done) and green 3 of 3 on the final head under the real config. Default applied, pending owner sign-off.
- **DF6** the hidden-role paragraph `packages/db/README.md:554-557` gains the isolation (which files run alone, and why) and keeps its recovery text. Default applied, pending owner sign-off.

## 5. Implementation steps

- W1 (opus/max): `packages/db/vitest.config.ts` per DF1-DF2; one locked full run confirms 62 files, 2,039 tests and the project labels; `b3-measure.sh`; GitNexus `detect_changes`; commit.
- W2 (opus/max): the guard per DF4, red on a planted bypass before it is committed green; `b3-measure.sh`; commit. W3 (sonnet/high): the README paragraph per DF6; `b3-measure.sh`; commit.
- Then section 7, the reviewer (opus/max, at most 3 rounds, the five areas of the lane block REVIEW PLAN), ONE push, PR, CI green, MERGE_READY. `migrate.test.ts` stays unchanged (DF3), so no conflict with L29 is expected; a conflict is resolved only if the hunks are disjoint (said in the report), anything else is an AWAIT.

## 6. Acceptance matrix

| ID | Check | Expected |
|---|---|---|
| ISO-1 | the observer on the final head (3.4 command, real config) x3 | green 3 of 3, `distinct_observations=0`; the observer in the parallel project, `migrate.test.ts` in isolated-1 |
| ISO-2 | full db suite on the final head, verbose and JSON reporters | 63 files (62 plus the guard), 2,039 tests plus the guard's own; overlapping_files 0 for every isolated file |
| ISO-3 | the guard | green on the final head; red on a planted bypass (a forbidden statement in a non-isolated test file; an isolated file dropped from the projects) |
| ISO-4 | `pnpm --filter @plexco/db test` x20 under the lock on the final head | 20 of 20 green, counts as ISO-2 |
| ISO-5 | `pnpm -w test` once | green |
| ISO-6 | the PR's CI | check "verify" green; the db log shows the parallel and isolated-1..7 labels |
| REG | `git diff <base>...HEAD` | only the config, the guard, the README and this file; `migrate.test.ts`, `test-harness.ts` and `package.json` untouched |

## 7. Verification

The S1 VERIFY set, each through `| tail -40`, DB runs through the one lock (`N/scripts/locked-run.sh`): `pnpm typecheck`; `pnpm lint`; `pnpm format:check`; `pnpm review:check:changed` and the FULL `pnpm review:check`; `pnpm build` once (sandbox off); `NODE_ENV=test pnpm --filter @plexco/web test`; `NODE_ENV=test DATABASE_URL_TEST=... pnpm -w test` once; ISO-1 to ISO-4; GitNexus `detect_changes` at the end (expect config and test files only). No Playwright or golden path: no UI change. Counts: before 62 files and 2,039 tests; after, the difference is the guard file and its own tests, explained line by line.

## 8. Tool hazard

- A CLI `--sequence.*` flag resets groupOrder and `--fileParallelism` overrides the projects: never add either to the test script or the CI command.
- `--project` and file filters run a subset: never use a filtered run as suite evidence (ISO-2 and ISO-4 run the whole package); `--passWithNoTests` hides an empty project, so the guard checks the includes itself.
- vitest 4's default reporter prints nothing per file for a green non-TTY run: evidence runs add `--reporter=verbose --reporter=json`.
- C11: the guard inherits the root `testTimeout: 30_000` through `extends: true` (C11a's 5 s default does not apply); literal regexes only (C11b). The observer is never committed: copy, run, delete, then check that porcelain is empty.

## 9. Budget (B3)

Lane cap, pre-approved: 160 non-test lines, 900 test lines added, 1,100 total excluding docs, 10 files, 0 migrations. Estimate: about 40 non-test lines (the config), about 250 test lines added (the guard), 4 files (config, guard, README, this file), 0 migrations, module packages/db only; inside every cap, no B3 exception needed. Measured with `b3-measure.sh` after every writer; a crossed cap is a ruling request before the next writer.

## 10. OPEN

None in scope (OPEN_QUESTIONS_IN_SCOPE: 0). OUT_OF_SCOPE residue:

- O1 removing the per-test lock helpers' call sites, now defence in depth: a follow-up (DF3).
- O2 apps/bot and apps/web run after the db suite through pnpm's topological order (their `@plexco/db` dependency): measured (section 2), not pinned by a test.
- O3 the clerk flake list's CLASS entries: the conductor retires them after a green record on main (A2b).
- O4 S0A's open line checks (the revert line of `:1313`, the W5 and W6 drops, the beforeAll placement in the nobypass files) change no outcome: whole files are isolated, so a window's length inside a file decides nothing; W2 measures the exact hit lines while building the guard.

## 11. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the base = the worktree HEAD at step 0 (`git rev-parse`, measured); every TARGET_FILES path exists (`git ls-files`, measured) | PASS |
| 2 | Decisions in scope final | the owner's standing delegation (verbatim, section 1); lane block L32 (conductor decisions D11, D13); DF1-DF6 pinned as defaults pending owner sign-off | PASS |
| 3 | Scope IN/OUT and owner clear | lane block FILE OWNERSHIP and NEGATIVE SCOPE; DF3 unchanged files; L29 owns the pin lines, no shared hunk | PASS |
| 4 | Dependencies classified | L25 merged and in the base; no migration slot; L29 beside it with disjoint files | PASS |
| 5 | Live schema and code match | sections 2 and 3, each row measured at the base; no schema touched | PASS |
| 6 | Data, API, state, auth contract | no product file, migration, role creation or production grant change; config, guard and README only | PASS |
| 7 | Fail-closed, idempotency, order | strict groupOrder inside one run, exit code over every group, no bail; no new lock; a crash not worse than today (3.6 threat 4) | PASS |
| 8 | Open questions in scope = 0 | DF1-DF6 pinned; section 10 residue out of scope | PASS |
| 9 | Acceptance matrix with expected results | section 6: ISO-1..ISO-6 and REG | PASS |
| 10 | Migration, security, rollback | 0 migrations; no security round (lane block judgement, void if a product file or a migration enters the diff); rollback = revert of the config, the guard and the README | PASS |
| 11 | First slice hard dependencies merged | L25 merged; base = origin/main at the merge of PR #104 | PASS |
| 12 | Implementation handoff ready | sections 4-9; the worktree exists at the base, clean | PASS |

## 12. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-22
AUTHORITY_SHA: 07bbe3482afec629456c4497f21a60a6d2fcef30
BASE_BRANCH: main
TARGET_FILES:
  - packages/db/vitest.config.ts
  - packages/db/README.md
  - packages/db/package.json (read only: the test script :21, pinned by the guard; unchanged, DF3)
  - packages/db/src/migrate.test.ts (read only: the windows of 3.7; unchanged, DF3)
  - packages/db/src/test-harness.ts (read only: the locks, setupNonSuperuserOwnerContext :861; unchanged, DF3)
  - packages/db/src/rls-invariants.test.ts (read only: T1 :2105; isolated)
  - packages/db/src/tenant-capability-authority.test.ts (read only: T1 :452; isolated)
  - packages/db/src/identity-link-web.test.ts (read only: :672; isolated)
  - packages/db/src/identity-link-web-nobypass.test.ts (read only: T1 :27; isolated)
  - packages/db/src/me-player-reads-nobypass.test.ts (read only: T1 :31; isolated)
  - packages/db/src/public-alias-nobypass.test.ts (read only: T1 :26; isolated)
  - packages/db/src/chat-dm-safety-invariants.test.ts (read only: the PR #103 and #104 checker :857-862)
  - packages/db/src/chat-catalog.test.ts (read only: the base run-1 failure)
  - packages/db/src/public-sessions-projector.test.ts (read only: the base run-10 failure)
  - packages/db/src/member-name-writer-guard.test.ts (read only: the guard precedent)
  - .github/workflows/ci.yml (read only: :45, :106)
SLICE: p3-db-test-role-hiding-isolation
IN_SCOPE: packages/db/vitest.config.ts gains test.projects: a parallel project (groupOrder 0, every src test file except the isolated set, configDefaults.exclude kept) and one project per isolated file (isolated-1..7, extends true, groupOrder 1..7; DF1, DF2) with a ponytail comment on the +26 s ceiling; a new guard packages/db/src/role-hiding-isolation-guard.test.ts (DF4); the packages/db/README.md hidden-role paragraph (DF6); this readiness file
OUT_OF_SCOPE: any product file, migration, role creation or production grant; packages/db/src/migrate.test.ts, packages/db/src/test-harness.ts and packages/db/package.json (unchanged, DF3); any assertion weakened, deleted, skipped or turned into a retry; any vitest retry setting or timeout change; the lock helpers (O1); the migration-tail pin lines (lane L29); status/conductor-scripts/clerk-flake-list.txt (the conductor, A2b); docs/standards/decisions.md; PR #50
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration, no product file; no security round (lane block judgement: no trust boundary; void if a product file or a migration enters the diff)
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 - in packages/db/vitest.config.ts add test.projects per DF1-DF2 (the parallel project plus isolated-1..7) with the ponytail comment, confirm 62 files and 2,039 tests in one locked full run, b3-measure.sh, detect_changes, commit in the worktree
REMAINING_BLOCKERS: none
```
