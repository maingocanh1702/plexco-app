<!-- review-readiness: code-ready -->

# Step-0 readiness: L78 p5-db-tls-ca-options (session P5-S18a)

Writer: W1 (opus), 2026-11-01, from the step-0 findings of units U1 (the sites, pg's precedence rules) and U2 (the test design). Base and authority: `9eee265be97ea37947a87a9ad38594c5771e0289` (origin/main, PR 156's merge; the worktree HEAD at the start). Every line number is a source line at that base. Risk P1 (TLS verification on every DB path, a shared choke point) with one security round; 0 migrations. Installed: pg 8.22.0, pg-connection-string 2.14.0 (pcs below), pg-boss 10.4.2, one pg.

## 1. Authority

- The owner's message of 2026-11-01 00:2x, item (C), verbatim: "L78 nửa code: tuỳ chọn ssl và CA lấy từ env, CA sai thì fail closed; nếu tách được thì nửa đo chờ Managed PG thật của owner, ghi rõ pending, không giả số." Also: "Không chờ owner giữa chừng".
- The plan row docs/sessions/web-mvp-phase5-golive-plan.md:90 (L78, P1, conditional: the `ssl` option and the CA from env; the measurement half needs the owner's real Managed PG; CA and hostname are checked; a wrong CA fails closed; a security round) and section 7 row 4 (:254: the pooled, direct and listener URLs travel a private path with TLS that checks the CA and the hostname).
- The backlog row `db-tls-ca-verification-do-managed-pg` (docs/autopilot-backlog.md:5881-5896): "code không set `ssl` và image không mang CA bundle của DO → hiện chỉ `sslmode=require`. Phải có trước production."
- The rest is decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature. The writer's choices in section 3 are Tier B under it.

## 2. Scope and design

### 2.1 The split

- This lane is the code half: one helper, every connection site, the fail-closed tests.
- The MEASUREMENT HALF is PENDING, owed to the owner's real Managed PG (go-live step 8.1): the real CA and the host names its certificate carries; whether production requires the CA; the App Spec env entries, the env manifest line and the environments-setup.md text; whether the platform can supply the PEM value directly. This record states no certificate, host or platform fact: none was measured.
- G2 consequence (ruling RO-L78-2 item 3): a URL with `sslmode=require` makes pcs set `ssl = {}` (pcs :77-79, :144-147), and pg then calls `tls.connect` with only `servername` (pg connection.js:101-102, :116-120), so the connection verifies against Node's default CA store and the hostname. If the cluster's CA is not in that store (unmeasured: the measurement half), every connection fails closed until DATABASE_CA_CERT carries that CA. So the measurement half's wiring is a G2 prerequisite: DATABASE_CA_CERT on every connecting component in the App Specs, the env manifest line, and the owner step that pastes the cluster's CA. Not built here: the App Specs are deploy-guard files, and lane L87 holds the env manifest.
- No enforcement switch: default applied, pending owner sign-off. A process without DATABASE_CA_CERT keeps today's behaviour in every environment.

### 2.2 Today's behaviour (measured by U1 in the installed sources)

- No site passes `ssl`: 0 non-test hits for `ssl:`, `sslmode`, `PGSSL` and `rejectUnauthorized` under packages/ and apps/. With no `ssl` key pg reads PGSSLMODE, else `ssl: false` (pg defaults.js:50): plaintext unless the URL asks for TLS. `sslmode=require` gives `ssl = {}`: verification against Node's default CA store plus the hostname (pcs :144-151, :222).
- A URL ssl parameter silently overrides an explicit `ssl` object: pg connection-parameters.js:59-61, `config = Object.assign({}, config, parse(config.connectionString))`. `sslmode=disable` gives plaintext; `sslmode=no-verify` and `ssl=no-verify` give no verification; `sslmode=require` drops the CA; `sslrootcert`, `sslcert` and `sslkey` make pg read a file (pcs :90-99); `uselibpqcompat=true` switches to libpq semantics (pcs :106). A repeated key: the last value wins (pcs :40-42).
- PGSSLMODE is read only when the merged config has `ssl === undefined` (connection-parameters.js:85). pg sets `servername = host` only for a non-IP host (connection.js:116-117), and Node's default checkServerIdentity then checks that name. pg-boss hands its constructor options to `new pg.Pool` (db.js:18); the LISTEN client is a plain pg.Client; drizzle receives the Pool that createDb builds (client.ts:43).
- `tls.createSecureContext` does not throw on an invalid `ca`, and node:crypto `X509Certificate` parses only the first certificate of a bundle (measured by U2): the helper validates every block itself.

### 2.3 Interface

- `pgSslConnectionConfig(connectionString, env = process.env)` in packages/db/src/pg-ssl-options.ts returns `{ connectionString, ssl? }`. Every site spreads it into its Pool, Client or PgBoss config, with no per-site formula. It takes the URL because a helper that returned only `ssl` could not stop a URL parameter from replacing it (2.2).
- The env variable is DATABASE_CA_CERT, PEM text: one or more CERTIFICATE blocks (D1).

### 2.4 Decision table (the tests prove each row)

Tests live in packages/db/src/pg-ssl-options.test.ts unless named; "stub" = a local `net` server that answers pg's SSLRequest with `S` and hands the socket to a Node TLS server, driven by pg's own Client.

| # | Case | Helper behaviour | Proof |
| --- | --- | --- | --- |
| R1 | DATABASE_CA_CERT unset | returns `{ connectionString }` with the same string and no `ssl` key, not even `ssl: undefined`: today's behaviour (2.2), no new refusal | unit, strict equality and `"ssl" in`, for a plain URL, `?sslmode=require` and `?sslmode=disable` |
| R2 | set to one valid CA, URL with no ssl parameter | `{ connectionString, ssl: { ca, rejectUnauthorized: true } }`, the URL unchanged, `ca` = the validated block; exactly these keys, no checkServerIdentity, no servername | unit: the exact shape; stub: the right CA completes the handshake against a certificate for `localhost` |
| R3 | set to a valid bundle | every block is validated; `ca` = all blocks | unit: a two-certificate bundle; stub: the issuing CA is the second block and the handshake completes |
| R4 | set but not PEM certificates: plain text, empty or whitespace, truncated, a corrupted body, a private key, junk after a valid block, a bundle whose second block is not a certificate | refuses at config time with PgSslConfigError, before any Pool, Client or PgBoss exists | unit, one test per case (11, among them the two escaped-newline values of D1); stub, a Client loop and a createDb loop: each case must throw PgSslConfigError (a soft assertion), a case that did not throw goes on to an attempted connect, and the stub then counts 0 connections, so an accepted value fails the count |
| R5 | set, and the URL `sslmode` is outside {require, verify-ca, verify-full}: disable, allow, prefer, no-verify or any other value, in any position or repetition | refuses | unit, one per value, including `sslmode=require&sslmode=disable` |
| R6 | set, and the URL `ssl` is outside {true, 1} (0, false, no-verify, other), or `uselibpqcompat` is other than false | refuses | unit |
| R7 | set, and the URL carries accepted ssl parameters (`sslmode=require`, `verify-full`, `ssl=true`, `sslrootcert`, `sslcert`, `sslkey`, `sslnegotiation`, any other key starting with ssl, `uselibpqcompat=false`) | every key starting with `ssl` (case-insensitive) and `uselibpqcompat` is removed; the text before `?` and any fragment are kept byte for byte; other parameters are kept | unit: the effective `new pg.Client(cfg).ssl` equals the helper's object; the returned URL holds no ssl parameter |
| R8 | set, and PGSSLMODE is disable or no-verify in the process env | the explicit object wins (2.2, :85) | unit: `new pg.Client(cfg).ssl` with PGSSLMODE set |
| R9 | set, and the server certificate comes from another CA | the connection fails closed: the connect, or a pool's first query, rejects with a verification code; the stub sees one connection, no plaintext startup and no StartupMessage over TLS, so no client-side completion and no retry without verification; the same with NODE_TLS_REJECT_UNAUTHORIZED=0, because the explicit `true` wins. The server-side handshake count is not asserted (TB4) | stub, a Client and a createDb pool; and the default-store proof, a child Node started with NODE_EXTRA_CA_CERTS naming CA-A's file, against a localhost server certificate from CA-A: with `ssl: { rejectUnauthorized: true }` and no `ca` it connects (the control: CA-A is in its default store), and through the helper with CA-B it is refused with a verification code, so the helper's `ca` replaces Node's default store; the stub counts 2 connections, 1 StartupMessage over TLS (the control's) and no plaintext startup |
| R10 | set, and the hostname mismatches (certificate for other.example, host `localhost`) | the connection fails with ERR_TLS_CERT_ALTNAME_INVALID: pg's servername plus Node's default check | stub |
| R11 | every refusal message | names DATABASE_CA_CERT and the reason, at most a URL parameter NAME; never the URL, the user, the password, the host or any fragment of the CA body | unit, looping over R4-R6 with a password marker, a host marker and a 40-character slice of the CA |

### 2.5 The ten sites and how each takes the options

| Site | file:line at the base | Change |
| --- | --- | --- |
| S1 | packages/db/src/client.ts:38 (createDb: Pool plus drizzle) | `{ ...pgSslConnectionConfig(connectionString), max: ... }`; serves apps/web; a direct assertion |
| S2 | packages/db/src/migrate.ts:176 (the migrations runner's Client) | `new pg.Client(pgSslConnectionConfig(migrationUrl))`, built inside a try: a PgSslConfigError becomes a throwMigrateError whose safe log summary is its own message, so the migrate CLI prints the refusal reason (safe per R11); any other error is rethrown unchanged |
| S3 | apps/bot/src/worker.ts:127 (Pool) | `new pg.Pool(pgSslConnectionConfig(directUrl))` |
| S4 | apps/bot/src/outbox-wake.ts:141-146 (the LISTEN Client; every reconnect rebuilds it with the same options) | `{ ...pgSslConnectionConfig(options.connectionString), application_name: ..., keepAlive: true, ... }` |
| S5 | apps/bot/src/preflight.ts:84 (Client; the worker's first connection, worker.ts:125) | `new pg.Client(pgSslConnectionConfig(directConnectionString))` |
| S6 | apps/bot/src/provision-queue.ts:24 (Client; the PgBoss at :27-28 borrows it through `db.executeSql`) | `new pg.Client(pgSslConnectionConfig(migrationUrl))` |
| S7 | apps/bot/src/queue.ts:19-23 (queueOptions, then `new PgBoss` at :27, then pg.Pool) | `{ ...pgSslConnectionConfig(directConnectionString), schema: QUEUE_SCHEMA, migrate: false }`; a direct assertion |
| S8 | apps/bot/src/projectors/web-realtime.ts:32 (lazy Pool) | `{ ...pgSslConnectionConfig(connectionString), max: 1, ... }` |
| S9 | apps/bot/src/projectors/public-sessions.ts:98 (lazy Pool) | `{ ...pgSslConnectionConfig(connectionString), max: 2, allowExitOnIdle: true }` |
| S10 | apps/bot/src/projectors/zalo-dm.ts:247 (lazy Pool) | as S9 |

The bot sites import the helper from `@plexco/db/pg-ssl-options` (D6). The per-site proof is a scan guard, packages/db/src/pg-ssl-connection-sites-guard.test.ts: it fails when a `new pg.Pool(`, `new pg.Client(`, bare `new Pool(` or `new Client(`, or `new PgBoss(` in non-test source (`/\.[cm]?[jt]sx?$/`) under apps/bot/src, apps/web or packages/db/src does not pass the helper (or a `queueOptions(` call), or its argument, once the helper call is removed, still names `ssl` or `connectionString` (its own key before or after the spread), with a named allowlist, each entry with its reason; plus the S1 and S7 direct assertions (S7 in apps/bot/src/queue-ssl-options.test.ts).

### 2.6 Not sites

- apps/web has no own site: its three createDb callers (session-cookies.ts:59, discovery-route-support.ts:49, dev-login/seed.ts:93) inherit S1, so apps/web needs no edit.
- packages/db/drizzle.config.ts:14 is dev-only drizzle-kit, run by no script, CI job or deploy. packages/db/src/test-harness.ts and apps/bot/src/test-db.ts are test support against the local Postgres.
- Out of scope, a follow-up named in the backlog row: the operator CLIs scripts/outbox-dlq-replay.mjs:104, scripts/outbox-projector-enable.mjs:305 and scripts/public-alias-moderate.mjs:107 keep today's behaviour even when the CA is set.

## 3. Decisions (Tier B, reversible, the writer's)

- D1, the variable: DATABASE_CA_CERT holds PEM text. Reason: the backlog row (:5894-5895) says the image carries no CA bundle, and infra/** (the Dockerfile, entrypoint.sh, the App Specs) is negative scope, so a file-path form would need an out-of-scope image change before it could work; PEM text needs no file in the image and adds no config-time file read. The name is new: a git grep for DATABASE_CA, \_CA_CERT and PGSSL over apps, packages, scripts and infra (docs excluded) returns nothing. A value with escaped `\n` instead of newlines is refused (R4, its two escaped-newline rows: trimmed, the single block does not parse as a certificate; untrimmed, the trailing escape is text outside the block); whether the platform needs an unescape belongs to the measurement half.
- D2, unset: only `env.DATABASE_CA_CERT === undefined` is unset. Any defined value, empty and whitespace included, must pass R4 (fail closed: an empty binding must not silently become "no CA"). So .env.example gains the name on a commented-out line with its comment and no value: a .env copied from it does not define the variable.
- D3, the interface of 2.3.
- D4, URL parameters: closed sets (a finite membership, not a blocklist) for `sslmode`, `ssl` and `uselibpqcompat`, checked over every occurrence; then every ssl key is removed. The text before `?` is kept byte for byte, so the credentials are never re-serialized; a URL without an ssl key is returned unchanged.
- D5, the PEM rule: the armor is parsed generically, with no PEM literal in the source or the tests (the lane's final checks count PEM marker lines in the added lines, which must be 0); the value must be blocks and whitespace only; every label must be CERTIFICATE; every block must parse with node:crypto `X509Certificate`; `ca` = the blocks. No CA-flag requirement: the measurement half sees the real CA.
- D6, the export (ruling RO-L78-2 item 1): the subpath `@plexco/db/pg-ssl-options`, one line in the `exports` map of packages/db/package.json (`"./pg-ssl-options": "./src/pg-ssl-options.ts"`), on the bot's subpath precedent (`./zalo-bot-api`, which apps/bot/src/projectors/zalo-dm.ts:8 imports as `@plexco/db/zalo-bot-api`). The bot sites import the subpath, so that import does not load the root entry's module graph; the packages/db sites import `./pg-ssl-options.js`, and the root entry is not edited. No dependency change: pnpm-lock.yaml is byte-unchanged.
- D7, errors: one error class, PgSslConfigError, whose message names DATABASE_CA_CERT and the reason, at most a URL parameter name. No catch-and-retry anywhere; the only retry loop (outbox-wake.ts:149-159) rebuilds the client with the same options.
- D8, enforcement: none built, default applied, pending owner sign-off (2.1).
- D9, tests: one file holds the unit rows and the stub; openssl makes the certificates once in a mkdtemp directory and they are removed afterwards; a missing openssl fails the file and never skips it. The scan guard and the S7 test are separate files (the guard reads the repository; the S7 test must live in apps/bot). The stub binds 127.0.0.1 on port 0 (precedent: packages/db/src/zalo-bot-api-fake-server-matrix.test.ts:63) and connects to host `localhost`, so pg sets the servername.
- TB1 (W2), control characters: with DATABASE_CA_CERT set, a URL holding a tab, LF or CR is refused, because the URL parser deletes them and a parameter name could hide `sslmode`; with the CA unset nothing changes (R1).
- TB2 (W2), case: the R5 and R6 closed sets match the parameter name case-insensitively, as the R7 strip does, and the value exactly: `SSLMODE=disable` and `sslmode=REQUIRE` refuse.
- TB3 (W2), the strip: the query is filtered by raw segment (split on `&`, each key decoded by URLSearchParams), so the kept parameters stay byte for byte when a key is removed; empty segments are kept.
- TB4 (W2), R9's proof: the connect rejects with a verification code and the stub sees exactly one connection, no plaintext startup and no StartupMessage over TLS (measured 0, also with NODE_TLS_REJECT_UNAUTHORIZED=0). The server-side handshake count is not asserted for R9 or R10: whether Node completes the TLS handshake before its JS verify check is unmeasured.
- TB5 (W2), the input type: the helper takes `connectionString: string`; a site that holds `string | undefined` keeps its existing guard before the call, so the helper's input is not widened.
- W3, the guard's e2e entry: apps/web/e2e/public-share-page-prod.proof.ts:152 (its `new Client(`, a Playwright proof against a scratch database) is a named allowlist entry, not a skipped e2e directory, so a new e2e connection still forces a decision.
- W4, the .env.example comment: it says the web, bot and migration DB connections verify while the operator CLIs in scripts/ keep today's behaviour, not "every DB connection", because the three CLIs of 2.6 do not take the helper.
- Tier C: none. No money or PII contract, no migration, no deploy-guard file and no enforcement: the clerk merges.

## 4. Acceptance matrix (A-1..A-11; expected results)

| ID | Command or check | Expected |
| --- | --- | --- |
| A-1 | `pnpm --filter @plexco/db exec vitest run src/pg-ssl-options.test.ts`, where binding 127.0.0.1 is allowed | green: R1-R11 |
| A-2 | a mutation on a copy outside the worktree: `rejectUnauthorized: false` in the helper | an R9 test fails; the copy is discarded |
| A-3 | the scan guard, then a planted bypass on a copy | green; the planted bypass fails it |
| A-4 | the S1 assertion and `pnpm --filter @plexco/bot exec vitest run src/queue-ssl-options.test.ts` | green |
| A-5 | `pnpm --filter @plexco/db test` and `pnpm --filter @plexco/bot test` through the DB/e2e lock, CA unset | green |
| A-6 | `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | exit 0 each |
| A-7 | `pnpm review:check:changed` before every commit; `pnpm review:check` at the end | exit 0 |
| A-8 | `git diff --name-only` from the base (full SHA) to HEAD | exactly the files of section 6 |
| A-9 | the added lines in .ts, package.json and .env.example (this record itself cites `rejectUnauthorized: false` in A-2, A-9 and section 7): PEM marker lines; `rejectUnauthorized: false` | 0 each |
| A-10 | the backlog reconcile | no new refusal; the row stays `idea` |
| A-11 | `pnpm -w test` at the end; CI on one push | green |

## 5. Verification and review

R1 (code) and S1 (security), both opus, in parallel on one committed HEAD when no writer is live, with the threat model of section 7; up to 3 rounds (DD-122 D4). The last round follows the L44 policy: a P1 or P2 in round 3 becomes ruling request RQ-L78-R3 and an AWAIT. Every DB test run goes through the DB/e2e lock. CI runs the full suite on one push. The clerk merges: no deploy-guard file.

## 6. Budget (B3) and files

B3 about 450 owned-diff lines per the lane estimate (helper about 60, sites about 40, tests about 220, this record about 120, backlog and .env.example about 10); this record runs longer, so about 500 is expected. An overrun is logged with its design reason, not a gate. 0 migrations.

Exception (ruling RO-L78-2 item 2): 720 against the 675 cap (1.5 times 450) after commit 2, accepted; the estimate missed the 11-row decision table and the TLS stub harness (the fail-closed proofs), a property of the test design, not scope drift; a second overrun from the same cause means a re-slice. Final B3, added plus deleted lines from the base over the 18 owned files at the commit that adds this line: 988, 0 outside the ownership, 0 migrations. The commits after the ruling added 268 of it, against a remaining estimate of about 230 and a stop at about 300; the scan guard alone is 108 against 70 (prettier's wrapping).

Second exception: 988 against the 675 cap at f794744, the same cause as RO-L78-2 item 2, accepted (ruling RO-L78-3 item 1, decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature): production code about 155 lines (the helper 98, the ten sites about 45, client.ts, migrate.ts, one exports line, .env.example), tests 628 (pg-ssl-options.test.ts 479, the sites guard 108, the queue test 41), this record 209; the overrun is fail-closed proof density, not scope drift (0 files outside the ownership, 0 P1 or P2); a re-slice would separate the proofs from the code they prove; the estimate was wrong, not the slice. Later commits are measured by b3-measure.sh at the PR head (PR body).

- Edited, existing at the base: packages/db/src/client.ts (S1); packages/db/src/migrate.ts (S2); packages/db/package.json (one `exports` line, D6); the connection lines and one import line in each of apps/bot/src/worker.ts, outbox-wake.ts, preflight.ts, provision-queue.ts, queue.ts and apps/bot/src/projectors/web-realtime.ts, public-sessions.ts, zalo-dm.ts; .env.example (one commented name line and its comment, D2); docs/autopilot-backlog.md (the row, in place).
- New: packages/db/src/pg-ssl-options.ts, packages/db/src/pg-ssl-options.test.ts, packages/db/src/pg-ssl-connection-sites-guard.test.ts, apps/bot/src/queue-ssl-options.test.ts and this record.
- Commits, the lane's own (a merge commit from main is not one): 1 741878a this record; 2 90c546b the helper and its test; 3 424f54d the ten sites; 4 eb88729 the sites guard; 5 b494cd3 the S1 and S7 assertions; 6 818cd24 .env.example and the backlog row (its notes as the lane block states, plus the three operator CLIs as a follow-up; `scope` lists the measurement files by their tracked paths; status stays `idea`); 7 f794744 the subpath export, and in this record the Tier B choices, the G2 consequence and the final B3; 8 7433ce5 the round-1 review fixes, tests only (the two db test files and one comment line in apps/bot/src/projector-registry.test.ts, ruling RO-L78-3 item 2); 9 the readiness update; 10 the round-2 fix (R1-4).

## 7. Security notes for the security round

Threat model: the adversaries are a mistake, and a network attacker between the app and the DB.

- A verification downgrade: `rejectUnauthorized: false` anywhere (the helper sets `true` explicitly; A-2, A-9); a URL parameter that overrides the helper (R5-R7); PGSSLMODE (R8); a fallback to no verification after a TLS error (R9, D7); a site that bypasses the helper (the scan guard, the S1 and S7 assertions).
- A missing hostname check (R10; no checkServerIdentity or servername override, R2's exact key set).
- A CA trusted only through Node's default store: the helper's `ca` replaces that store (Node's tls docs, the `ca` option: "Mozilla's CAs are completely replaced when CAs are explicitly specified"), measured by R9's default-store test in a child Node (CA-A added through NODE_EXTRA_CA_CERTS, a CA-A server, the helper with CA-B: refused).
- An invalid CA that silently becomes "no CA" (R4, D2: an empty value refuses).
- The unset row changing today's behaviour (R1's strict equality; the existing suites with the CA unset, A-5).
- A log or error that prints a URL or a password (R11, D7).
- pg-boss or the LISTEN client ignoring the options (2.2; S4, S7; the guard).
- A test key or certificate committed (certificates made at test time and removed; A-9).
- Residual risk, accepted and named: the three operator CLIs of 2.6 keep today's behaviour; the backlog row carries them.

## 8. Open

0 in scope; 0 open. The measurement half (2.1) is pending and outside this lane. The one administrative item, the export route of D6, is resolved by ruling RO-L78-2 item 1: the subpath export, with packages/db/package.json added to the lane's file ownership for that one line.

## 9. Hard dependencies

None unmerged: this is the root slice, and `9eee265be97ea37947a87a9ad38594c5771e0289` (PR 156's merge) is the base. At most one other lane (L87, docs, or L88, the renderer) runs, on files this lane never touches; the backlog is the accepted overlap (this row only, edited in place).

## 10. Closure matrix (12 of 12 PASS)

| # | Gate | Evidence | Result |
| --- | --- | --- | --- |
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the worktree HEAD = the base; section 1 | PASS |
| 2 | Decisions in scope final | the owner's item (C) and the conductor's delegation; the writer's D1-D9 (section 3) | PASS |
| 3 | Scope IN/OUT and owner clear | sections 2.5, 2.6 and 6; the verdict's IN_SCOPE and OUT_OF_SCOPE; A-8 | PASS |
| 4 | Dependencies classified | section 9 | PASS |
| 5 | Live schema and code match | 2.2 and 2.5, measured at the base; no schema change | PASS |
| 6 | Data, API, state, auth contract | 2.3 and the decision table (2.4); no query or pool change beyond `ssl` | PASS |
| 7 | Fail-closed, idempotency, order | R4-R10 refuse or fail closed before or at the handshake; the helper is a pure function of its inputs | PASS |
| 8 | Open questions in scope = 0 | section 8 | PASS |
| 9 | Acceptance matrix with expected results | section 4 (A-1..A-11) | PASS |
| 10 | Migration, security, rollback | no migration; one security round on section 7; rollback = revert the merge, and with the CA unset every site is byte-identical to the base | PASS |
| 11 | First slice hard dependencies merged | commit 2 depends on nothing unmerged (section 9) | PASS |
| 12 | Implementation handoff ready | sections 2.3-2.5, 3 and 6 | PASS |

## 11. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-11-01
AUTHORITY_SHA: 9eee265be97ea37947a87a9ad38594c5771e0289
BASE_BRANCH: main
TARGET_FILES:
  - packages/db/src/client.ts (edited: createDb's config line, S1)
  - packages/db/src/migrate.ts (edited: the runner's Client line, S2)
  - packages/db/package.json (edited: one `exports` line, the `@plexco/db/pg-ssl-options` subpath, D6)
  - apps/bot/src/worker.ts (edited: the Pool line and one import, S3)
  - apps/bot/src/outbox-wake.ts (edited: the LISTEN Client options and one import, S4)
  - apps/bot/src/preflight.ts (edited: the Client line and one import, S5)
  - apps/bot/src/provision-queue.ts (edited: the Client line and one import, S6)
  - apps/bot/src/queue.ts (edited: queueOptions and one import, S7)
  - apps/bot/src/projectors/web-realtime.ts (edited: the Pool options and one import, S8)
  - apps/bot/src/projectors/public-sessions.ts (edited: the Pool options and one import, S9)
  - apps/bot/src/projectors/zalo-dm.ts (edited: the Pool options and one import, S10)
  - .env.example (edited: one commented name line and its comment, D2)
  - docs/autopilot-backlog.md (edited: the row db-tls-ca-verification-do-managed-pg, in place)
  - docs/sessions/web-mvp-phase5-golive-plan.md (read-only: row 90 and section 7 row 4)
  - docs/standards/environments-setup.md (read-only: section 4, the contract)
SLICE: p5-db-tls-ca-options
IN_SCOPE: one packages/db helper (pg-ssl-options.ts) and its tests; the ten sites of section 2.5; one `exports` line in packages/db/package.json (the subpath, D6); the scan guard; the S1 and S7 assertions; one commented .env.example line; the backlog row in place; this record
OUT_OF_SCOPE: infra/** (App Specs, the renderer, entrypoint.sh, the Dockerfile), .github/**, environments-setup.md, the env manifest, decisions.md, staging-deploy.md, migrations, apps/web edits, drizzle.config.ts, test-harness.ts, the three operator CLIs under scripts/; any enforcement switch; any committed key, certificate or real CA; any DigitalOcean call; any query or pool change beyond ssl; any secret value or connection string
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none unmerged; 9eee265be97ea37947a87a9ad38594c5771e0289 (PR 156's merge) is the base
PRIOR_SLICES: none (root slice)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none # enforcement in production belongs to the measurement half: default applied, pending owner sign-off
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration; one security round (opus) on section 7
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 writes packages/db/src/pg-ssl-options.ts and its test (rows R1-R11), runs them and the package typecheck, and commits
REMAINING_BLOCKERS: none # the export route is resolved by ruling RO-L78-2 item 1 (section 8)
```
