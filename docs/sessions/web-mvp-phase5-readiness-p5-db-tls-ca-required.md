<!-- review-readiness: code-ready -->

# Step-0 readiness: L89 p5-db-tls-ca-required (session P5-S19a)

Writer: W1 (opus), 2026-11-01, from the step-0 findings of units U1 (the effective host pg dials, the boot paths, the renderer) and U2 (the test design), and the orchestrator's rulings after step 0. Base and authority: `a411eef22c4e175b59119299dcc87790e2b34a89` (origin/main, PR 157's merge; the worktree HEAD at the start). Every line number is a source line at that base. Risk P1 (TLS on every DB path, a shared choke point, two deploy-guard files) with one security round; 0 migrations. Installed: pg 8.22.0, pg-connection-string 2.14.0, one pg. This record is the only input the next writer needs.

## 1. Authority

- The owner's message of 2026-11-01 12:59, verbatim: "clerk merges #157 || Owner ký 3 mục. (1) L88: giữ mặc định và giao diện --create. Chế độ create là việc owner tạo app DO, KHÔNG liên quan chuyện host hoặc organizer của CLB khác tự tạo buổi cho CLB mình (tính năng sản phẩm đã có qua nút + Tạo buổi mới trong host guide L76); không đổi code L88, nếu thấy khoảng trống ở luồng host thì ghi hàng backlog, đừng tự mở lane. (2) L78: owner UỶ QUYỀN cho conductor chọn phương án tốt nhất và nhiều lợi ích nhất. Chốt: giữ DATABASE_CA_CERT dạng PEM; XÂY công tắc bắt buộc: staging và production từ chối khởi động nếu thiếu CA (local, CI, dev không bị), để không ai hạ cấp TLS lặng lẽ và để staging chứng minh trước production. Mở thêm lane nhỏ làm luôn: biến DATABASE_CA_CERT trong App Spec cho từng component có kết nối DB, một dòng env manifest, công tắc nói trên, và bước owner dán CA vào runbook; file thuộc deploy guard thì dừng ở MERGE_READY chờ owner. (3) L87: ok, ký dòng bổ sung có ngày ở DD-153."
- The rule's design is "decided by the conductor under the owner's delegation of 2026-11-01 12:59 (L78), not an owner signature" (status/OWNER-DECISIONS-2026-11-01.md :53-69: the rule, reasons (a)-(e), the rejected options). Everything else here is decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature; the writer's choices in section 3 are Tier B under it.
- Precedent: L78's record docs/sessions/web-mvp-phase5-readiness-p5-db-tls-ca-options.md (rows R1-R11 stay as they are) and its helper packages/db/src/pg-ssl-options.ts.

## 2. Scope and design

### 2.1 The rule (one predicate, in the L78 helper)

Refuse iff `env.NODE_ENV === "production"` AND `env.DATABASE_CA_CERT === undefined` AND the host pg will dial is neither loopback nor a Unix socket. A string pg cannot parse counts as remote. Every other case keeps today's behaviour byte for byte. No on/off variable, no new env name.

- Placement: pg-ssl-options.ts:40 `if (value === undefined) return { connectionString };` becomes a block: the requirement (`if (env.NODE_ENV === "production" && !loopbackOrSocket(connectionString)) {` / `throw new PgSslConfigError(REQUIRED);` / `}`, exactly 3 lines) then the unchanged `return { connectionString };`. NODE_ENV is tested first, so outside production nothing is parsed and no new throw path exists. The CA-set branch :41-45, `certificateBlocks` and `withoutSslParameters` are untouched; no query or pool change.
- The refusal: one constant reason, `DATABASE_CA_CERT is required when NODE_ENV is production and the database host is not loopback or a Unix socket`, no `cause`, never the URL, a host or the CA text (the rule of :13).
- The header comment :7 gains one sentence stating the rule.

### 2.2 The effective host (U1 lead 3, measured)

- pg dials ONE host string: `parse(connectionString).host` (a lower-case `host=` query parameter wins over the authority, PCS:40-42 and :54-56), else PGHOST, else pg's default `localhost` (CP:9-23, :60, :71; DEF:12). An empty connectionString is not parsed (CP:59): PGHOST or `localhost`. No host list (a comma string is one host, CL:176, CONN:44), no hostaddr, no other env var changes the host (U1 3g). Brackets stay: `[::1]` (U1 3f). Percent-decoding, tab stripping and special-scheme normalisation happen inside pg's parser (T8, T9, T28).
- How the helper gets it (D1): `new ConnectionParameters({ connectionString }).host`, with `import ConnectionParameters from "pg/lib/connection-parameters.js";`. This is the object pg's own client builds (client.js:54 `this.connectionParameters = new ConnectionParameters(config)`, :58 `this.host = this.connectionParameters.host`). Allowed by pg's exports map (pg/package.json:31-32 `./lib/*`) and typed by @types/pg (its package.json:21 `"./lib/*": "./lib/*.d.ts"`; lib/connection-parameters.d.ts `host?: string`, `export = ConnectionParameters`). pg is already a prod dependency of packages/db (package.json:28): no new dependency, no package.json edit.
- Any throw of the constructor (ERR_INVALID_URL and anything else) = remote; the error is discarded. A non-string host = remote.
- Classification on that string, exact compare (pg does not lower-case a `postgres:` host): socket iff it starts with `/` (exactly client.js:173); loopback iff it is `localhost`, `::1`, `[::1]`, or `net.isIPv4(host) && host.startsWith("127.")` (strict dotted quad, stdlib). Everything else is remote: `LOCALHOST`, `localhost.`, `127.1`, `2130706433`, `0x7f.0.0.1`, `0`, `0.0.0.0`, `[::ffff:7f00:1]`, `localhost.example.com`, `127.0.0.1.nip.io`, every comma string, `base` (scheme-less garbage).

### 2.3 Boot paths (U1 lead 4)

| role | entrypoint.sh | DB names read | when the helper runs | refusal |
| --- | --- | --- | --- | --- |
| web | mapping :24-28 (:26 DATABASE_URL_WEB to DATABASE_URL); exec :57 `next start` | DATABASE_URL (session-cookies.ts:57), DISCOVERY_DATABASE_URL (discovery-route-support.ts:47) | LAZY (first request; no instrumentation.ts) | the new boot check before :57 |
| discovery | mapping :29-33 (:31); exec :62 | DISCOVERY_DATABASE_URL; DATABASE_URL if mapped | LAZY | the new boot check before :62 |
| worker | exec :66 `tsx src/worker.ts` | DATABASE_URL_DIRECT (worker.ts:117) | AT START: preflight.ts:85 via worker.ts:126, before the pool :128 and PgBoss | rejection, worker.ts:222-225 `[worker] fatal`, exit 1 |
| provision | exec :76 | DATABASE_URL_MIGRATION (provision-queue.ts:64) | AT START: provision-queue.ts:25 | :69-72 `[provision-queue] failed`, exit 1 |
| migrate | :83 runner, then :84 | DATABASE_URL_MIGRATION (migrate.ts:426) | AT START: migrate.ts:178-186 (PgSslConfigError branch) | `[migrate] failed:`, exit 1; `set -eu` (:5) stops before :84 |

### 2.4 The boot check (ruling; D4)

- ONE new module packages/db/src/pg-ssl-boot-check.ts. For each of `DATABASE_URL` and `DISCOVERY_DATABASE_URL` that is set and non-empty (an unset or empty name keeps today's lazy "is not set" error), it calls the SAME `pgSslConnectionConfig(value)` (default env). On a PgSslConfigError it prints `[pg-ssl-boot-check] ` + `error.message` to stderr and exits 1; on any other error it prints a fixed text without the error and exits 1 (fail closed, leak-free); otherwise it prints nothing and exits 0. It holds no copy of the rule and constructs no pg object (the sites guard stays at ten SITES). Nothing runs at import: a main guard copied from migrate.ts's own CLI guard (:42x).
- infra/entrypoint.sh gets exactly two lines, one in each arm before the `exec`: `    pnpm --filter @plexco/bot --fail-if-no-match exec tsx ../../packages/db/src/pg-ssl-boot-check.ts` above :57 and above :62 (the pattern of :83: cwd apps/bot, apps/bot's tsx is the prod one, :81-82). Under `set -eu` a non-zero status ends the script with that status before `exec`. The role mapping (:26, :31) has already run.
- Rejected: instrumentation.ts (absent; would also run in the `next build` phase); `node -e` (cannot import TS); a compiled packages/db (none in the image).

### 2.5 The App Specs and the renderer (U1 lead 5)

- Seven entries, each written exactly as `- key: DATABASE_CA_CERT` / `scope: RUN_TIME` / `type: SECRET` at the list's indentation, with one plain-ASCII comment line (no trailing space) directly above, inserted directly after the component's last DB URL entry: staging migrate after :85, web after :153, discovery after :237, worker after :291; production migrate after :72, web after :141, worker after :224. Production has no discovery component. No other spec line changes (the checker compares the spec minus these entries and their comment lines with the base byte for byte).
- Update mode: a committed SECRET with no live value FAILS the render, naming `<kind>/<component>/DATABASE_CA_CERT`, never a value (render-app-spec.sh:146-148). A live value is copied on every deploy (:149-151). A live key the committed spec does not declare is dropped (header :17-18). The lookup is per component (:78-81): a CA pasted on web is invisible to worker. `--create` keeps the key valueless (:139-142, header :37).
- So the runbook order is: merge, then the owner pastes the CA into DATABASE_CA_CERT of every DB component in the console (staging 4, production 3), then deploy. A deploy before the paste fails closed at render. A rollback to a commit before this one drops DATABASE_CA_CERT from the live spec (that spec does not declare it, and its image does not require it); re-deploying this commit later needs the paste again.

## 3. Decisions (Tier B, reversible, the writer's)

- D1. The host comes from pg's ConnectionParameters (2.2), so PGHOST is read where pg reads it, `process.env` (CP:15). This refines the ruling's "then env.PGHOST": the only other pg-owned route to `parse` is a `createRequire` from pg's resolved path, a dynamic require inside a module Next bundles (next.config.mjs:89 `transpilePackages: ["@plexco/core", "@plexco/db"]`), which a static subpath import avoids; pg is a default server external of Next (next/dist/lib/server-external-packages.json:53), so the subpath is handled exactly as the existing `pg` import. Production callers all use the default env (the ten SITES), so `env === process.env` there. Tests pin PGHOST with `vi.stubEnv` (unset in a `beforeEach`). Reversal is local to the classifier.
- D2. Exact compare, no lower-casing, no IPv6 normalisation beyond pg's own (fail closed: `LOCALHOST` refuses).
- D3. No marker comments in product code: the mutation anchors on the requirement's own `env.NODE_ENV === "production"` line (count 1) and deletes its 3 lines.
- D4. The boot check reads both URL names in both roles (both modules live in the one Next app); the module needs no role argument.
- D5. worker, provision and migrate get no extra check (2.3: the helper runs at start, exit 1 before work); process tests prove it on stderr.
- D6. Empty URL string: pg dials PGHOST or `localhost` (CP:59), so the row follows pg (loopback when PGHOST is unset); this replaces U2's assumption A6.

## 4. Decision table (each row is a test, named for its real case)

Notation: PROD = `{ NODE_ENV: "production" }`; today's = `toStrictEqual({ connectionString: input })`, no `ssl` key; REFUSE = PgSslConfigError, message `/^DATABASE_CA_CERT /`; placeholder host `db.example.invalid`, password marker `pw-marker-l89`.

| id | case (test name) | input | expected |
| --- | --- | --- | --- |
| A1 | production web against a DigitalOcean host with no CA refuses | PROD; remote, plain, `?sslmode=require`, `?sslmode=disable` | REFUSE (a URL cannot opt out) |
| A2 | normal production boot after the owner's paste keeps the CA branch | PROD + valid CA; remote | equals the no-NODE_ENV result (existing file) |
| A3 | an empty pasted CA in production is a bad CA, not a missing one | PROD + `""`; remote | L78 refusal `is set but is not PEM certificate text` |
| A4 | CI e2e production build on 127.0.0.1 keeps today's config | PROD; `127.0.0.1` | today's |
| A5 | a local production run with a CA keeps the CA branch on loopback | PROD + valid CA; loopback | equals the no-NODE_ENV result (existing file) |
| A6 | a Unix-socket database keeps today's config in production | PROD; `?host=/var/run/postgresql`, `%2Fvar%2Frun%2Fpostgresql` authority | today's |
| A7 | a socket with a CA keeps the CA branch | PROD + valid CA; socket | equals the no-NODE_ENV result (existing file) |
| A8 | a URL pg cannot parse is remote and refuses | PROD; bare `::1`, `[::1` unclosed, `h1:5432,h2:5432`, port 99999 | REFUSE |
| A9 | an unparsable URL with a CA keeps the CA branch | PROD + valid CA; same strings | equals the no-NODE_ENV result (existing file) |
| B1 | production on localhost keeps today's config | PROD; `localhost` | today's |
| B2 | an upper-case LOCALHOST is remote | PROD; `LOCALHOST` | REFUSE |
| B3 | a trailing-dot localhost is remote | PROD; `localhost.` | REFUSE |
| B4 | production on 127/8 keeps today's config | PROD; `127.0.0.1`, `127.0.0.2`, `127.255.255.254` | today's |
| B5 | short or numeric IPv4 forms are remote | PROD; `127.1`, `2130706433`, `0x7f.0.0.1`, `0` | REFUSE |
| B6 | production on IPv6 loopback keeps today's config | PROD; `[::1]`, `[0:0:0:0:0:0:0:1]` | today's |
| B7 | an IPv4-mapped loopback is remote | PROD; `[::ffff:127.0.0.1]` | REFUSE |
| B8 | loopback look-alikes are remote | PROD; `localhost.example.com`, `127.0.0.1.nip.io`, `0.0.0.0`, user `localhost`, db name `localhost`, `?application_name=127.0.0.1`, `#127.0.0.1` | REFUSE |
| B9 | a userinfo that looks like loopback does not hide the real host | PROD; `u@127.0.0.1@<remote>`, `127.0.0.1:5432@<remote>` | REFUSE |
| B10 | a remote host= behind a loopback authority refuses | PROD; `@127.0.0.1/d?host=<remote>` | REFUSE |
| B11 | a loopback host= behind a remote authority keeps today's config | PROD; `@<remote>/d?host=127.0.0.1` | today's |
| B12 | parameters pg ignores do not change the host | PROD; `@127.0.0.1` + `?HOST=<remote>`, `?hostaddr=203.0.113.5`, `?host=` | today's |
| B13 | encoded and tab-split loopback is decided on pg's parsed host | PROD; `%31%32%37.0.0.1`, encoded `localhost`, `loc<TAB>alhost` | today's |
| B14 | a host list is one string and refuses | PROD; `h1,h2`, `127.0.0.1,<remote>`, `?host=h1,<remote>` | REFUSE |
| B15 | no host in the URL uses PGHOST, then localhost | PROD; `postgres:///plexco` with PGHOST unset / `<remote>` / `/var/run/postgresql` | today's / REFUSE / today's |
| B16 | an empty URL follows pg (PGHOST, then localhost) | PROD; `""` with PGHOST unset / `<remote>` | today's / REFUSE |
| B17 | scheme-less garbage is remote | PROD; `not a url` | REFUSE |
| B18 | a socket authority with a remote host= refuses | PROD; encoded socket + `?host=<remote>` | REFUSE |
| B19 | a host= with a slash inside is not a socket | PROD; `?host=x%2Fy` | REFUSE |
| B20 | a special scheme is normalised by pg's parser | PROD; `http://u@127.1/d` | today's |
| B21 | an attempted off-switch has no effect | PROD + `DATABASE_CA_REQUIRED=false`, `DEPLOY_ENVIRONMENT=dev`, `PGSSLMODE=disable`, `NODE_TLS_REJECT_UNAUTHORIZED=0`; remote | REFUSE |
| B22 | production on the bare service name postgres is remote | PROD; host `postgres` | REFUSE (compose never runs production) |
| C1 | compose dev on host postgres keeps today's config | `development`; host `postgres` (docker-compose.yml:39, :119, :146) | today's |
| C2 | the unit tests' NODE_ENV keeps today's config | `test`; remote | today's |
| C3 | an ad-hoc script with no NODE_ENV keeps today's config | unset, `""`; remote | today's |
| C4 | a mis-set NODE_ENV is not production | `Production`, `PRODUCTION`, `production `, `staging`; remote | today's (exact compare; the image sets the exact value, Dockerfile:44) |
| C5 | an unparsable URL outside production never throws | `{}` and `test`; the A8 strings and `not a url` | `{ connectionString: input }` |
| E1 | every refusal of the rule is one constant message and leaks nothing | all REFUSE inputs above | one message; no `cause`; message and stack lack the password marker, the host, `nip.io`, the URL |
| E2 | createDb in production on a remote host with no CA throws before any pool | stubbed env; `createDb(remote)` | sync PgSslConfigError (client.ts:40 before :46) |
| E3 | importing the helper and the client in production does not throw | `vi.resetModules()`, stubbed env, dynamic import | resolves |
| E4 | the helper reads no env name besides DATABASE_CA_CERT and NODE_ENV | source scan of pg-ssl-options.ts | that set exactly |

## 5. Tests and placement (ruling)

- packages/db/src/pg-ssl-options-ca-required.test.ts (new, pure: no listen, no openssl, no DB; the mutation target): every row of section 4 except A2, A5, A7, A9; local `refusal()` helper as pg-ssl-options.test.ts:167-175; `afterEach(() => vi.unstubAllEnvs())`; `beforeEach(() => vi.stubEnv("PGHOST", undefined))`.
- packages/db/src/pg-ssl-options.test.ts (existing): A2, A5, A7, A9 only, added inside `describe("pgSslConnectionConfig: the decision table")` (:177), because they need the generated `caA` (L78 row R2 gains its production case). No L78 row is edited.
- packages/db/src/pg-ssl-boot-check.test.ts (new): ALL process-level tests. Child env built from scratch (`PATH`, `TMPDIR` if set, plus the case's names; never `...process.env`); tsx = `<repo>/apps/bot/node_modules/.bin/tsx`, cwd `<repo>/apps/bot`, timeout 20 s; URL `postgres://app:pw-marker-l89@db.example.invalid:25060/plexco?sslmode=require`. P1-P3 the module spawned (`../../packages/db/src/pg-ssl-boot-check.ts`) with NODE_ENV=production and no CA: DATABASE_URL remote alone; DISCOVERY_DATABASE_URL remote alone; DATABASE_URL loopback plus DISCOVERY_DATABASE_URL remote: non-zero exit, stderr names DATABASE_CA_CERT, stderr and stdout lack the host, the marker and the URL. P4 positive controls (production all-loopback; development remote): exit 0, stderr empty. P5 source scan: the module calls `pgSslConnectionConfig(`, holds none of `"production"`, `localhost`, `127.`, `::1`, and no constructor. P6-P8 the real start paths `tsx src/worker.ts` (DATABASE_URL_DIRECT), `tsx src/provision-queue.ts` (DATABASE_URL_MIGRATION), `tsx ../../packages/db/src/migrate.ts` (DATABASE_URL_MIGRATION): non-zero exit; stderr holds the role tag (`[worker]`, `[provision-queue] failed`, `[migrate] failed:`) and DATABASE_CA_CERT and no host (a missing check would exit 1 on DNS, so the stderr content is the assertion); stdout lacks `[preflight] passed`, `provisioned`, `[migrate] applied=`. If the worker needs another env name to reach preflight, add the minimal placeholder. Run with the sandbox off (tsx IPC), sequentially.
- infra/entrypoint.test.mjs (existing; stub pnpm first on PATH, never a real `next start`): CHECK = `[--filter][@plexco/bot][--fail-if-no-match][exec][tsx][../../packages/db/src/pg-ssl-boot-check.ts]`. T6 web: calls `[CHECK, START_WEB]`, status 0. T7 web, the check fails with code 3: status 3, calls `[CHECK]`. T8 and T9 the same for discovery. T10 the role mapping reaches the check (DATABASE_URL_WEB, resp. DATABASE_URL_DISCOVERY, only; the stub logs a fake-or-other fingerprint of DATABASE_URL, never the value). T1-T5 keep their expected strings unchanged.
- infra/render-app-spec.test.mjs (existing; root package.json :12 lists the infra tests explicitly, so no new infra file): AS1 staging and AS2 production, derived: every component with a `DATABASE_URL*` or `*_DATABASE_URL` key declares exactly one DATABASE_CA_CERT, `SECRET`, `RUN_TIME`, no value (4 and 3 components); AS3 negative controls with `variant()` (entry dropped, given a value, GENERAL, duplicated, a new DB service without it); AS4 no `-----BEGIN ` in either spec; AS5 update mode with the live CA dropped from one component fails, naming `<kind>/<name>/DATABASE_CA_CERT`; AS6 create mode keeps it valueless under both roots. Update the hard-coded counts in place (U2 F4: `EXPECTED_ENVS`; :507-509; :781-784), re-measured by running the file.
- Mutation: N/scripts/l89-mutation-run1.sh, on a COPY under TMPDIR (precedent status/P5-S18a-notes/scripts/l78-mutation-run1.sh): abort if W is dirty; `git archive HEAD`; clone node_modules; baseline of the new unit file must pass; delete the 3 requirement lines (anchor count 1, line count down by 3); the mutant run must fail with the A1 name among the failures; log N/mutation-l89.log; W untouched (`git diff --quiet`). Commit before the run.

## 6. Verification and review

Every DB suite through the lock: `bash N/scripts/locked-run.sh L89 writer p5-db-tls-ca-required N/w1-<name>.log <command>` for `pnpm --filter @plexco/db test`, `pnpm --filter @plexco/bot test`, the apps/web unit suite, and `pnpm -w test` last (it runs the infra tests). Then `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm review:check` (tail -40). Recommended once: `pnpm -w build` (the web bundle with the new pg subpath import, D1). CI e2e proves the production-build e2e (loopback) unaffected. GitNexus is not available to the writer unit; the orchestrator's `impact` on pgSslConnectionConfig returned "Target not found" (the index predates L78; re-indexing would write into the owner's root copy, NOT RUN). The L78 sites guard (packages/db/src/pg-ssl-connection-sites-guard.test.ts, ten SITES) is the blast-radius list. Review: R1 and S1 (opus) in parallel on the committed head with the lane's threat model; a local Semgrep CE scan (N/scripts/l89-semgrep-scan.sh) before the first push.

## 7. Budget (B3) and commits

About 560 owned-diff lines (cap 840; `bash N/scripts/b3-measure.sh | tail -3` after each commit). Commits, each through `REFUSED_BASE=2 bash N/scripts/check-and-commit.sh "<subject> [L89]" <files>`: (1) this record; (2) the rule and its unit tests; (3) the boot check, the two entrypoint lines, the process and entrypoint tests; (4) the seven App Spec entries and the App Spec test; (5) the docs: the env manifest row (and its count line if any); staging-deploy.md (the CA step at the SECRET step for staging :56 and production :73, the CA source from docs.digitalocean.com F-style or unverified in §9 :143, missing or broken PEM: every component refuses to start and the error names DATABASE_CA_CERT, the staging proof before production with the golden path 8.6, the :94 clause, the order of 2.5); .env.example (the DATABASE_CA_CERT comment states the rule, no CA); decisions.md (Vietnamese; ONE new entry at the next free DD number quoting section 1 verbatim with items (1)-(3) and the labels, plus the DD-153 addendum label "(default applied, pending owner sign-off)" replaced by the owner's signature of 2026-11-01 12:59 pointing to it; never a D-table row); the backlog row `db-tls-ca-verification-do-managed-pg` in place (done by L89: the wiring and the requirement; PENDING: the owner pastes the real CA, staging proves it, then production; the row stays open, status unchanged); environments-setup.md §4 (:180) only if a sentence becomes false.

## 8. Security notes for the security round

- Off-switches: no flag exists (B21); NODE_ENV comes from the image (Dockerfile:44) and neither App Spec sets it (U1), so changing it is a visible deploy-guard diff; a mis-cased value is not production (C4, pinned).
- Misclassification: the host is pg's own (D1), compared exactly (D2); every unknown shape is remote.
- Lazy pools: web and discovery are stopped by the boot check (2.4) before `exec`; the others refuse at start (2.3).
- Import and build time: nothing runs at import (E3; the module's main guard); `next build`, vitest and Playwright never run entrypoint.sh.
- Leaks: one constant reason, no cause (E1); the boot check prints only that message.
- App Specs: valueless SECRET on every DB component, derived test (AS1-AS6); no committed certificate (AS4).
- Render: a declared key is never dropped; a missing live value fails closed (2.5).

## 9. Open

- PENDING, not in this slice and not invented: the owner pastes the real cluster CA; staging proves the components start and the golden path 8.6 passes; then production.
- Unverified until the next writer checks: the DigitalOcean page for the cluster CA (WebFetch on docs.digitalocean.com only; a page that does not open is "not re-checked" and goes to staging-deploy.md §9).

## 10. Hard dependencies

PR 157 is merged and is the base. PR 159 (L78, the helper) is merged before it. Nothing unmerged.

## 11. Closure matrix (12 of 12 PASS)

| # | Gate | Evidence | Result |
| --- | --- | --- | --- |
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the worktree HEAD = the base; section 1 | PASS |
| 2 | Decisions in scope final | the owner's 12:59 message, the conductor's rule and rulings, the writer's D1-D6 | PASS |
| 3 | Scope IN/OUT and owner clear | sections 2 and 7; the verdict's IN_SCOPE and OUT_OF_SCOPE | PASS |
| 4 | Dependencies classified | section 10 | PASS |
| 5 | Live schema and code match | 2.2-2.5 measured at the base; no schema change | PASS |
| 6 | Data, API, state, auth contract | 2.1 and the decision table; no query or pool change | PASS |
| 7 | Fail-closed, idempotency, order | unknown host = remote; refusal before serving or work; render fails closed | PASS |
| 8 | Open questions in scope = 0 | section 9 holds only the post-merge measurement | PASS |
| 9 | Acceptance matrix with expected results | section 4 (every row) and section 5 | PASS |
| 10 | Migration, security, rollback | no migration; one security round on section 8; rollback = revert the merge (2.5 states what a rollback drops) | PASS |
| 11 | First slice hard dependencies merged | section 10 | PASS |
| 12 | Implementation handoff ready | sections 2-7 | PASS |

## 12. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-11-01
AUTHORITY_SHA: a411eef22c4e175b59119299dcc87790e2b34a89
BASE_BRANCH: main
TARGET_FILES:
  - packages/db/src/pg-ssl-options.ts (edited: the requirement in the unset branch and the header sentence)
  - packages/db/src/pg-ssl-options.test.ts (edited: rows A2, A5, A7, A9 added)
  - infra/entrypoint.sh (edited: one boot-check line in the web and discovery arms)
  - infra/entrypoint.test.mjs (edited: T6-T10)
  - infra/app.staging.yaml (edited: four DATABASE_CA_CERT entries and their comments)
  - infra/app.prod.yaml (edited: three DATABASE_CA_CERT entries and their comments)
  - infra/render-app-spec.test.mjs (edited: AS1-AS6 and the counts in place)
  - docs/runbooks/env-manifest-staging-production.md (edited: one row)
  - docs/runbooks/staging-deploy.md (edited: the CA step, the CA source, the proof order, the :94 clause)
  - .env.example (edited: the DATABASE_CA_CERT comment)
  - docs/standards/decisions.md (edited: one new entry and the DD-153 addendum label)
  - docs/autopilot-backlog.md (edited: the row db-tls-ca-verification-do-managed-pg, in place)
  - docs/standards/environments-setup.md (read-only unless a section 4 sentence becomes false)
  - infra/render-app-spec.sh (read-only: the render behaviour)
  - packages/db/src/pg-ssl-connection-sites-guard.test.ts (read-only: the blast-radius list)
SLICE: p5-db-tls-ca-required
IN_SCOPE: the rule in pg-ssl-options.ts; the new test file pg-ssl-options-ca-required.test.ts; the new module pg-ssl-boot-check.ts and its test; two entrypoint lines; the seven App Spec entries; the App Spec and entrypoint tests; the env manifest row; the runbook CA step; the .env.example comment; one decisions entry and one label; the backlog row in place; this record
OUT_OF_SCOPE: every other deploy-guard file (.github/**, infra/Dockerfile, .do/**) and every other App Spec line; package.json files; any on/off variable or new env name; any change to the L78 CA-set rows, queries or pools; databases components or bindable variables; any committed key, certificate or real CA; any DigitalOcean call; migrations; the decisions D-tables; other backlog rows; any secret value or connection string
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none unmerged; a411eef22c4e175b59119299dcc87790e2b34a89 (PR 157's merge) is the base
PRIOR_SLICES: p5-db-tls-ca-options (L78, merged)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none # the owner's CA paste and the staging proof are post-merge runbook steps, PENDING
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration; one security round (opus) on section 8
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W writes the rule in packages/db/src/pg-ssl-options.ts and pg-ssl-options-ca-required.test.ts (section 4), runs them and the package typecheck, and commits
REMAINING_BLOCKERS: none
```
