<!-- review-readiness: code-ready -->

# Step-0 readiness: L91 p5-db-tls-ca-system (session P5-S21a)

Writers: W1 (opus) measured the base and decided D1-D6 and the decision table; W2 (opus) wrote this record from W1's handoff and added D7 (2.2), 2026-11-01, from the step-0 findings of unit U1 (the helper's branch point, the consumers, Node's trust-set docs on 22.x and 25.x with a measured probe, pg's TLS options, the L78 stub). W9, W9b and W9c (opus) brought it up to the branch after the code and docs commits: the owner's message verbatim (section 1), D8 (section 3), the exact near-miss list (D4, T13), the head pins and what has run (2.5, sections 4, 6 and 9). Base and authority: `ccaa70f03f21fc1d4eb5ee54f9b969a3cda5d6be` (origin/main, PR 161's merge = L90; the worktree HEAD at the start). Every line number is a source line at that base unless marked "head", which means measured at `a539fea10488d46c9205f2b5ca5593f4663c5e3d` (W11's commit); the docs commit after it edits lines in place only, so no head pin moves. Risk P1 (TLS trust on every DB path; a shared choke point) with one security round; 0 migrations. Installed: pg 8.22.0; Node 25.6.0 locally, Node 22 in CI (.github/workflows/ci.yml:63, :123) and in the image (infra/Dockerfile:7, :43). This record is the only input the next writer needs.

## 1. Authority

The owner's message of 2026-11-01 20:47, verbatim (status/OWNER-DECISIONS-2026-11-01.md, section 20:47; the same line as in the DD-159 addendum of 2.5 (g)):

> || Owner chọn L91 system (uỷ quyền chọn phương án tối ưu): mở lane nhỏ cho phép DATABASE_CA_CERT=system. Chỉ khi đặt đúng chữ system mới dùng kho CA gốc của Node; vẫn kiểm chứng chỉ và tên host đầy đủ, KHÔNG BAO GIỜ no-verify; giá trị PEM vẫn dùng như cũ và vẫn đáp ứng luật bắt buộc ở staging và production. Áp dụng cho cả helper chung và ba script vận hành. Cập nhật runbook, env manifest và App Spec nếu cần: Standard Edition dùng CA tải về dạng PEM, Advanced Edition dùng system. Có test cho từng nhánh, mutation, security round vì P1. PR chạm deploy guard thì dừng ở MERGE_READY chờ owner, không chạm thì clerk merge. Chạy ngay, không song song với lane nào chung file. Báo ngắn sau khi xong.

- The owner's message of 2026-11-01 20:47 and the conductor's narrow reading of it (status/OWNER-DECISIONS-2026-11-01.md, section 20:47), labelled "decided by the conductor under the owner's delegation of 2026-11-01 20:47 (L91), not an owner signature". As the conductor reads it (the lane's goal): DATABASE_CA_CERT also accepts the exact value `system`, which means Node's bundled root CAs, given explicitly, with full certificate and host-name verification; and the App Spec comments name the env manifest row as the one description of the value (point 3 (c)). The message is quoted verbatim above, the same line as in the dated DD-159 addendum of this lane (2.5 (g)).
- The writer's choices in section 3 are Tier B under that delegation (D6 is Tier A).
- Precedent, read-only: L78's helper and rows R1-R11 (docs/sessions/web-mvp-phase5-readiness-p5-db-tls-ca-options.md), L89's rule A1-E4 in it (docs/sessions/web-mvp-phase5-readiness-p5-db-tls-ca-required.md), L90's operator CLI module O1-O13 (docs/sessions/web-mvp-phase5-readiness-p5-operator-cli-pg-tls-helper.md).

## 2. Scope and design

### 2.1 The branch (lead 1, D1)

In `packages/db/src/pg-ssl-options.ts`, `pgSslConnectionConfig` (head :46-62; :43-59 at base ccaa70f), the base line :54 `const ca = certificateBlocks(value);` is head :57 `const ca = value === "system" ? [...rootCertificates] : certificateBlocks(value);`. The comparison is exact: no trim, no case folding. Head :58-61 (`withoutSslParameters` at :59 and the single `rejectUnauthorized: true` literal at :60) serve both forms, so the URL rules and the verify flag cannot diverge between them. The return type is unchanged (`ca: string[]`, head :49). The unset path (head :50-56, L89's requirement) is untouched; a set value of either form satisfies it, as PEM does today (A5, A7). No consumer changes (lead 2, U1 Q2): every Pool, Client and PgBoss config, the boot check and `operatorCliPgConfig` spread this one result.

### 2.2 The import and the header sentence (D1, placement refined by W2 as D7)

`import { rootCertificates } from "node:tls";` takes the place of the blank line :6 (between the last import :5 and the JSDoc :7), the placement of L90's D3, instead of a new line after :2, so lines :1-:19 keep their numbers. One sentence is added to the JSDoc after :19, before its closing line (base :20, head :23): head :20-:22, three lines (k = 3). Neither the import, the branch nor the sentence may contain the standalone word `env`: L89's E4 (pg-ssl-options-ca-required.test.ts:215-224 at base ccaa70f) counts `\benv\b` in the file (exactly 4) and pins the names the helper reads (exactly NODE_ENV and the variable). Head line map, measured with `git diff -U0` from the base (three hunks: `-6 +6`, `-19,0 +20,3`, `-54 +57`): :1-:19 unchanged; base :20-:133 are head :23-:136, identical except the branch (base :54, head :57). `pnpm lint` did not object to the import directly above the JSDoc (W5), so D1's fallback after :2 was not used.

Measured pins of pg-ssl-options.ts lines outside docs/sessions (`git grep` at the base) and what D7 does to them: docs/runbooks/outbox-dispatch-enable-rollback.md:178 (`:16-18`, `:19`) and docs/autopilot-backlog.md:8201 (`:17-18`) stay true; docs/runbooks/staging-deploy.md:58 (`:38`) and docs/runbooks/env-manifest-staging-production.md:66 (`:47`, `:49-50`, `(:85-100)`) move by +k and are corrected in 2.5 (owned lines); docs/autopilot-backlog.md:8202 (`:43`) is in the merged row `operator-cli-pg-tls-helper` (:8185), dated history at its merge, not edited (negative scope). At head the two backlog lines are :8202 and :8203 and the row's header :8186 (W8's new line :5901 moved them by +1). W7b's head measurement found three more helper cites on outbox :178 (`:30-32`, `:38`, `:55-58`), which moved by +3 and were corrected in 2.5 (e).

### 2.3 The trust set (lead 3, D1): the explicit bundled array

Chosen: `ca: [...rootCertificates]`, Node's bundled Mozilla store, given explicitly. Not chosen: leaving `ca` out (Node then uses its default store, which `NODE_EXTRA_CA_CERTS`, `--use-system-ca`, `--use-openssl-ca` and `tls.setDefaultCACertificates` change, so the environment would widen the trust set: a threat-model item), and `tls.getCACertificates("default")` (the same environment-dependent set; mutation M3, `[...getCACertificates()]`, shows a test catches that choice: the child-built T15 row fails, section 6).

The current Node docs (fetched 2026-11-01 from nodejs.org, latest-v22.x and latest-v25.x, tls.md and cli.md; the two versions identical for these passages):

- `tls.rootCertificates` (v22 tls.md:2459-2475; v25 tls.md:2381-): "An immutable array of strings representing the root certificates (in PEM format) from the bundled Mozilla CA store as supplied by the current Node.js version." and "The bundled CA store, as supplied by Node.js, is a snapshot of Mozilla CA store that is fixed at release time. It is identical on all supported platforms."
- The `ca` option of `tls.createSecureContext` (v22 tls.md:1981-1990; v25 tls.md:1961-): "Optionally override the trusted CA certificates. If not specified, the CA certificates trusted by default are the same as the ones returned by `tls.getCACertificates()` using the `default` type. If specified, the default list would be completely replaced (instead of being concatenated) by the certificates in the `ca` option. Users need to concatenate manually if they wish to add additional certificates instead of completely overriding the default."
- `NODE_EXTRA_CA_CERTS` (v22 cli.md:3286-3305; v25 cli.md:3505-): "Neither the well known nor extra certificates are used when the `ca` options property is explicitly specified for a TLS or HTTPS client or server."
- The older sentence "Mozilla's CAs are completely replaced when CAs are explicitly specified using this option" is not on the v22 or v25 page; the wording above is the current one.

The measured probe (U1; local Node 25.6.0 in the sandbox; a throwaway CA and a localhost leaf made by openssl at run time with the openssl commands of pg-ssl-options.test.ts:36-102, deleted on exit; an in-memory TLS stream pair, because the sandbox refuses `listen`). In all five runs `tls.rootCertificates` had length 144, was frozen and had the same sha256.

| Run | Default store count | Handshake to the throwaway CA's leaf (SAN DNS:localhost, servername localhost) |
| --- | --- | --- |
| (i) plain | 144 | control (no `ca`): refused UNABLE_TO_VERIFY_LEAF_SIGNATURE; explicit `ca: [...tls.rootCertificates]`: refused UNABLE_TO_VERIFY_LEAF_SIGNATURE |
| (ii) `NODE_EXTRA_CA_CERTS` = the throwaway CA | 145 (one extra) | control: connected, authorized; explicit bundled array: refused SELF_SIGNED_CERT_IN_CHAIN |
| (iii) `--use-system-ca` | 144 (system 0) | both refused UNABLE_TO_VERIFY_LEAF_SIGNATURE |
| (iv) `--use-openssl-ca` | 0 | both refused UNABLE_TO_VERIFY_LEAF_SIGNATURE |
| (v) `tls.setDefaultCACertificates` with one certificate | 1 | both refused UNABLE_TO_VERIFY_LEAF_SIGNATURE |

Reading: the default store moved (144, 145, 144, 0, 1) while the bundled array did not; in (ii) the variable made the default store trust the throwaway CA and the explicit bundled array still refused it, as the docs say. Caveats: the system store loaded 0 certificates in the sandbox, so its widening of the default store is not shown (it does not reach an explicit `ca`); locally Node 22 is covered by the docs only, and CI's run of T15 (ubuntu, Node 22) is the Node 22 measurement; the two refusal codes differ because in (ii) the in-process server also sent the CA in its chain, and both codes are in the repo's VERIFY_CODES (pg-ssl-options.test.ts:330-334).

### 2.4 Verification and the host name (T18)

pg 8.22.0 `lib/connection.js` :101-107 copies every key of the helper's `ssl` object into the TLS options, and :115-118 sets `servername` to the host only when it is a name, not an IP. The helper's `ssl` has no `checkServerIdentity` and no `servername` key, so Node's default host-name check runs, and Node's `rejectUnauthorized` ("If not `false`, the server certificate is verified against the list of supplied CAs.") is the explicit true. L78's R10 asserts `ERR_TLS_CERT_ALTNAME_INVALID` for a wrong-name certificate (pg-ssl-options.test.ts:504-510). A public-root success and the host-name check against a real Advanced Edition cluster cannot be proven offline: staging proves them (2.5 (d), staging-deploy.md §9). An IP host (no servername) is not measured; it is the PEM path's behaviour, unchanged.

### 2.5 The docs and the backlog (leads 5-9): targets and rules, not prose

Base lines verified with `grep -n` on each anchor at the base. Content rule for every place that describes the value: Standard Edition = the cluster's downloaded CA certificate (PEM, verbatim with its BEGIN and END lines, F7); Advanced Edition = exactly `system` (no quotes, spaces or line break; Node's bundled roots with full certificate and host-name verification; an Advanced cluster has no downloadable CA); either satisfies the production rule; any other value refuses at start. No doc tells the owner to use `system` for a Standard cluster or PEM for an Advanced one. Done in two commits: (a)-(f) in `1be033d8b215d7312aa144a9053d0ec1d6bd2754`, (g) and (h) in `5b0e869a3a398d92a6665b7ceef257767df8cf5b`; each item ends with the head lines it changed.

- (a) The App Specs: infra/app.staging.yaml :86, :158, :246, :304 and infra/app.prod.yaml :73, :146, :233 (`grep -n 'DB cluster CA'`: exactly these 7, the same text, 6-space indent; no other file in the tree carries it, and infra/render-app-spec.test.mjs pins only the CA entry's key, scope and type at :956 and :964, never the comment). Base text: `# The DB cluster CA (PEM), pasted per component in the console; without it this production build refuses to start against a remote DB, staging included (NODE_ENV=production from the image).` New text, the same on all 7: `# Set per component in the console; its value is described once, in the DATABASE_CA_CERT row of docs/runbooks/env-manifest-staging-production.md; without it this production build refuses to start against a remote DB, staging included (NODE_ENV=production from the image).` Rules: neither PEM nor `system` in the comment (point 3 (c)); the `- key:`, `scope:` and `type:` lines byte-unchanged; `git diff -U0 -- infra/` shows exactly these 7 lines and nothing else in infra/. Head: the same 7 lines, each replaced in place.
- (b) docs/runbooks/env-manifest-staging-production.md :66, row 35 `DATABASE_CA_CERT`, the one description of the value: the content rule above, with the type cell `secret (PEM)` naming both forms; its cites re-measured at the head: `pg-ssl-options.ts:47`, `:49-50` and `(:85-100)` at base are head `:50`, `:52-53` and `(:88-103)`, plus the new `:57` (the `system` branch); `.env.example:70-71`. Must not: change the component or S/P cells, another row, or add an env name. Head: :66.
- (c) The same file's five renderer cites (owed since L89's round 3), measured against infra/render-app-spec.sh at the base (161 lines): :48 `:90` becomes `:116` (the `__KMS_PROVIDER__` fill) and `(:96-103)` becomes `(:122-129)` (the KMS_PROVIDER agreement guard); :68 `:61` becomes `:87`, `:111-112` (the AWS pair in `awsOnly`, dropped when KEY_ROOT is local); :72, :104 and :129 `:69-75` become `:95-101` (the guard that refuses DATABASE_URL_MIGRATION outside the PRE_DEPLOY job). Only the cite text changes on those lines. Head: :48, :68, :72, :104 and :129, the cite text only; :28's `render-app-spec.sh:87-88` is true and stays.
- (d) docs/runbooks/staging-deploy.md: step (5) (:57), its CA item :58: Standard downloads the CA (F7), Advanced types exactly `system`; its `pg-ssl-options.ts:38` cite is head `:41`, plus the new `:57`. F7 (:10): the download is the Standard Edition path; Advanced has no downloadable CA. §9 (:146), the line :153: Advanced's trust (Node's bundled roots, host name verified) is proven only at staging. No other step changes. Head: :10 (F7), :58 (the CA item) and :153 (§9); :57 not changed (nothing CA-specific on it).
- (e) docs/runbooks/outbox-dispatch-enable-rollback.md :165 (the PEM export) and :178 (the TLS line): each adds the Advanced form `export DATABASE_CA_CERT=system`; :178's `pg-ssl-options.ts:16-18` and `:19` stay true under D7; its other cites moved by +3 (`:30-32` to `:33-35`, `:38` to `:41`, `:55-58` to `:58-61`), plus the new `:57`. Head: :161, :165 and :178. Outbox :161 (psql for Advanced): RQ-L91-2, ruled YES (RO-L91-3 (1), section 9): the Advanced form `sslrootcert=system` with `sslmode=verify-full` and its two quoted conditions; the same line's CA sentence names `system` for Advanced.
- (f) .env.example, the DATABASE_CA_CERT comment line (:70; the file has 176 lines): names both forms. Read and edited only through a names-only line reader and a one-line fixer (L90's pattern for ruling RO-L90-2 (2)), checked with `git diff --numstat -- .env.example`, never shown through a diff hunk (RO-L90-3 (1)). Head: line :70 only (numstat `1 1`), never shown.
- (g) docs/standards/decisions.md, DD-159 (heading :1790, summary row :120): one dated addendum in the file's convention for an addendum (precedent DD-142, DD-150): the owner's 20:47 message verbatim and the conductor's narrow reading with the label of section 1. Head: the addendum is :1814-:1837 (its heading :1814) inside DD-159 (heading :1790), one hunk, no heading or index-row change; its quote line is byte-equal to the owner's message. Nothing else in the file changed.
- (h) docs/autopilot-backlog.md, in place: the row `db-tls-ca-verification-do-managed-pg` (:5881) gets the `system` form; in the row `prod-pg-ha-upgrade-before-money-or-more-clubs` (:7719), the line :7732 ("Upgrade path NOT measured yet ... else Advanced") gets "an Advanced Edition cluster has no downloadable CA; use DATABASE_CA_CERT=system (L91)". No other row; the reconcile gives no new refusal. Head: one new dated line :5901 in the first row (header :5881); the HA row's header is now :7720 and its line base :7732 is head :7733, edited in place.

## 3. Decisions (the writers')

- D1 (Tier B) the branch form (2.1) and the trust set (2.3): one line; the URL rules and the verify literal are shared, so the two forms cannot diverge.
- D2 (Tier B) row ids T1-T18 (R = L78, A-E = L89, P = the boot check, O = L90 and S1 = the security reviewer are taken).
- D3 (Tier B) placement (section 5): pure rows in pg-ssl-options-ca-required.test.ts (no openssl, no listen); rows that need the generated CA, the stub or a child in pg-ssl-options.test.ts (its existing `tls` import).
- D4 (Tier B) the near-miss set: the lane's list, `System`, ` system` (a leading space), `system ` (a trailing space), `system` followed by a line break (`system\n`) and `systems`, plus `SYSTEM`, `system\r\n`, a leading tab (`\tsystem`) and `"system"` (quotes typed into the console, a real paste mistake); the empty string is T14. The test holds the nine as `NEAR_MISSES` (pg-ssl-options-ca-required.test.ts head :192-202).
- D5 (Tier B) three mutations on a copy, saved with the session notes: M1 `value.toLowerCase() === "system"` (T13's `System` and `SYSTEM` must fail); M2 `ssl: { ca, rejectUnauthorized: value !== "system" }` (false on the `system` branch only; T8's exact shape and T15 must fail; the sites guard's literal-false pattern does not see it, by design); M3 `[...getCACertificates()]` in place of `[...rootCertificates]`, its import changed to match (an environment-dependent trust set, the choice 2.3 rejects; added with W11's child-built T15 row for S1 round 1 P2-1, and killed by that row, section 6).
- D6 (Tier A, read from the code, today's behaviour kept): unset outside production keeps today's config (L89 C1-C4: head :52 false, then :55); an invalid PEM is refused at head :57 (`certificateBlocks`) before the URL is checked at :59, both fail closed; a set value takes the TLS branch for every NODE_ENV and host, as PEM does (A5, A7); `system` with a line break refuses (no trim; the runbooks say type exactly `system`); the empty string is set (head :51 compares with `undefined`) and refuses everywhere (L89 A3).
- D7 (Tier B, W2) the import in place of the blank line :6 and the sentence after :19 (2.2), so :1-:19 keep their numbers; one line to move back if lint objects. Lint did not object (W5).
- D8 (Tier B, W3) T15 reuses `connectInChildWithCaA` instead of a second, sibling child: its config transport moves from the `L78_PG_CONFIG` env string to a JSON file whose path is argv[1], one child transport for R9's default store and T15. Why: one mechanism, no copied child script; Linux caps one env or argv string at 128 KiB, and the `system` config is about 200 KB. Reversible, test-only. The child-built T15 row (W11) has its own child, `connectInTsxChildWithCaA` (apps/bot's tsx), which gets only the URL, in a temp-dir file, and builds the `system` config itself through the helper, so no config crosses the process boundary on that path.

## 4. Decision table (one test per row, each named for its real case)

| Row | Value | NODE_ENV / host / URL | Result | Code (head) | Test |
| --- | --- | --- | --- | --- | --- |
| T1 | unset | production, remote | refuse `DATABASE_CA_CERT is required when NODE_ENV is production and the database host is not loopback or a Unix socket` | :51-54 | existing A1 |
| T2 | unset | production, loopback or socket, any URL | `{ connectionString }`, no ssl key | :51, :55 | existing A4, A6, B1 |
| T3 | unset | not production, remote | same as T2 | :52, :55 | existing C2-C4 |
| T4 | unset | not production, loopback | same as T2 | :55 | existing C1-C3 |
| T5 | PEM, valid | any, clean URL | unchanged: stripped URL, ssl with the certificate blocks and `rejectUnauthorized: true` | :57-61 | existing R2, R3, A2-A9 |
| T6 | PEM, valid | a weakening URL, or one with a tab or line break | refuse | :110-112, :124-126 | existing R5, R6 |
| T7 | PEM, invalid | any | refuse, the PEM reason first | :91, :95, :100 | existing R4, A3 |
| T8 | `system` | production, remote | `{ connectionString, ssl: { ca: [...tls.rootCertificates], rejectUnauthorized: true } }`, keys exactly `ca` and `rejectUnauthorized`; the requirement is met | :57, :60 | NEW, exact shape |
| T9 | `system` | production, loopback and Unix socket | same as T8 | :57 | NEW |
| T10 | `system` | NODE_ENV unset, development and test, each with a remote and a loopback host | same as T8 | :57 | NEW |
| T11 | `system` | each allowed ssl parameter of L78's R7 list | the URL stripped exactly as with PEM; ssl.ca the bundled array | :59, shared | NEW, equal to the PEM output's URL |
| T12 | `system` | the R5 and R6 queries | the PEM refusal, the same message, no config | :59, :110-112, :124-126 | NEW, message equal to the PEM one |
| T13 | the nine near-misses of D4: `System`, ` system`, `system `, `system\n`, `systems`, `SYSTEM`, `system\r\n`, `\tsystem`, `"system"` | production and not, remote and loopback | refuse `DATABASE_CA_CERT is set but is not PEM certificate text (certificate blocks only)` | :90-91 | NEW, the full matrix |
| T14 | the empty string | the three combinations A3 lacks | the same refusal as T13 | :51, :90-91 | NEW (A3 covers production with a remote host) |
| T15 | `system` | the L78 TLS stub, its server leaf issued by a private CA-A made at test time | two tests. "T15: DATABASE_CA_CERT=system refuses a server certificate from a private CA with a verify code, and that config, built in this process, is not widened at connect time by a child's NODE_EXTRA_CA_CERTS trusting the CA": in process a VERIFY code, startupOverTls 0, plainStartup 0, no password sent; in a child with `NODE_EXTRA_CA_CERTS` = CA-A's file, the control (no `ca`) connects and the config built in this process, handed over as a file path in argv, gets a VERIFY code. "T15: a child whose NODE_EXTRA_CA_CERTS trusts a private CA builds its own DATABASE_CA_CERT=system config through the helper, and a server certificate from that CA is still refused with a verify code": a tsx child with `NODE_EXTRA_CA_CERTS` = CA-A's file calls the helper with its own env plus `DATABASE_CA_CERT: "system"` and gets a VERIFY code; the no-`ca` control in that child connects; the stub saw 2 connections, 1 startup over TLS (the control's), 0 plain | pg connection.js:101-107 | NEW, `15_000` and `30_000` ms budgets |
| T16 | `system` | the consumers | the boot check in production with remote `DATABASE_URL` and `DISCOVERY_DATABASE_URL` exits 0 with empty stdout and stderr (a new row beside P4); `operatorCliPgConfig(REMOTE, { DATABASE_CA_CERT: "system" })` returns the T8 config | - | NEW (commit 3) |
| T17 | - | every new refusal (T12's `system` case, T13, T14) | the message starts `DATABASE_CA_CERT ` and holds no password, host or value | - | NEW, R11-style loop |
| T18 | - | host-name check, public-root success | not provable offline: R10 for the check, T8's shape (no `checkServerIdentity`, no `servername` key), staging for the rest | - | staging (2.5 (d)) |

## 5. Tests and placement

- packages/db/src/pg-ssl-options-ca-required.test.ts (no openssl, no listen; adds `import { rootCertificates } from "node:tls";`): T8, T9, T10, T13, T14, T17. E4 there counts the helper file only, so these lines do not touch its count.
- packages/db/src/pg-ssl-options.test.ts (its generated CA and the stub; existing `tls` import): T11, T12 and T15. T15's child part reuses `connectInChildWithCaA` (:414-426 at base ccaa70f; D8): its config transport moved from the `L78_PG_CONFIG` env string to a JSON file whose path is the child's argv[1] (one transport for R9's default store and T15), because the ~200 KB `system` config exceeds Linux's 128 KiB cap on one env or argv string. No new env name, and the child connects with exactly the helper's output. T15's second row ("T15: a child whose NODE_EXTRA_CA_CERTS trusts a private CA builds its own DATABASE_CA_CERT=system config through the helper, and a server certificate from that CA is still refused with a verify code", W11, S1 round 1 P2-1) has its own child, `connectInTsxChildWithCaA`: apps/bot's tsx runs a script written to the test's temp dir that imports the helper by file URL and pg through createRequire, reads the URL from a temp-dir file (not argv: a failed execFile echoes its argv) and builds the `system` config inside the child under `NODE_EXTRA_CA_CERTS` trusting CA-A, the child's whole env as the helper's env; the connection is still refused, and its "no-ca" mode, the control, connects.
- packages/db/src/pg-ssl-boot-check.test.ts and packages/db/src/operator-cli-pg-config.test.ts: T16, new rows only (`rootCertificates` from `await import("node:tls")` inside the test, so only new lines).
- Rows T1-T7 are existing tests, unchanged (lines at base ccaa70f): L89's REFUSE and TODAY rows (pg-ssl-options-ca-required.test.ts:32-148), A3 (:181-186), L78's R2-R6 (pg-ssl-options.test.ts:125-165, :187-238), R10 (:504-510), R11 (:298-321).
- The mutation run of D5 on a copy after commit 2; the tree restored byte-identical; killed or survived recorded. Run by W5: both killed (section 6).

## 6. Verification and review

The focused files through the DB/e2e lock with the sandbox off (the stub listens on 127.0.0.1): `pnpm --filter @plexco/db exec vitest run src/pg-ssl-options.test.ts src/pg-ssl-options-ca-required.test.ts src/pg-ssl-boot-check.test.ts src/operator-cli-pg-config.test.ts` (package name and vitest form confirmed against packages/db first); `pnpm -w test` through the lock at the end; `pnpm typecheck`, `pnpm lint`, `pnpm format:check`; `pnpm review:check:changed` before every commit and `pnpm review:check` at the end; the local Semgrep CE scan (an l91 copy of L90's) before the first push; GitNexus `impact` on `pgSslConnectionConfig` and `detect_changes` where the tools are available (recorded if not); the reconcile with no new refusal. Review: R1 (code) and S1 (security) in parallel on the committed head with section 8, up to 3 rounds.

Run so far, with results:

- The focused files through the lock, sandbox off: exit 0, 4 files, 239 passed (239) at head `67b69e5bad3ac089dea9c3d491c21decf13d86f2` (W6, after T16; 237 before it); the lock's before and after probes identical. At `a539fea10488d46c9205f2b5ca5593f4663c5e3d` (W11, after the child-built T15 row and T11's `ssl` pin): exit 0, 4 files, 240 passed (240).
- The mutation run of D5 (W5, at head `0c24bf0b0bb56b87d68676ae949b94e5a6f7c024`, the helper unchanged since; each mutant through the lock, the helper restored after each, `git diff` 0 bytes at the end): M1, `value.toLowerCase() === "system"` at :57, KILLED (3 of 237 failed: T13 `System`, T13 `SYSTEM`, T17); M2, `rejectUnauthorized: value !== "system"` at :60, KILLED (11 of 237 failed: the 10 `system` rows of T8-T10, and T15); the unmutated control 237 passed. Run again with M3 (W11b, at `a539fea10488d46c9205f2b5ca5593f4663c5e3d`, the helper unchanged; each mutant through the lock, the helper restored after each, porcelain empty and `git diff` 0 bytes at the end): M1 KILLED (3 of 240 failed: T13 `System`, T13 `SYSTEM`, T17, the same list); M2 KILLED (26 of 240 failed: T8 1, T9 3, T10 6, both T15 rows, T11 13 through W11's new `ssl` pin, T16 1); M3, `[...getCACertificates()]` at :57 with its import at :6, KILLED (1 of 240 failed: the child-built T15 row; the parent-built T15 row and T11's bundled-array pin pass, as a parent with no extra CA predicts); the unmutated control 240 passed.
- `pnpm typecheck`, `pnpm lint` and `pnpm format:check` at the worktree root: rc 0 each (W5; lint raised nothing on the import at :6); after T16, `pnpm --filter @plexco/db typecheck` and `pnpm lint` rc 0 (W6).
- `pnpm review:check:changed`: PASS before the T16 commit and before the commit of 2.5 (g) and (h).

Run since, at `42bb33dde3ff6b6d363a440b7d74498ef8f109e5` (results in the PR body): `pnpm -w test` through the lock, final-checks.sh, b3-measure.sh (section 7) and the Semgrep scan; review round 1 (R1, R1b, S1), its findings fixed in `a539fea10488d46c9205f2b5ca5593f4663c5e3d` and `41c1668032c8e6e3bb8d890718b22ba4d6525d8d`. Not run yet, so not claimed: review round 2, the re-runs on the final head, and CI on the PR (T15's Node 22 run).

## 7. Budget (B3) and commits

B3 estimate 420 owned-diff lines (helper about 5, tests about 190, this record about 150, App Specs 14, env manifest about 14, staging-deploy about 8, outbox runbook about 6, .env.example 2, decisions about 10, backlog about 6). Commits: (1) this record; (2) the import, the branch, the header sentence and rows T8-T15, T17; (3) rows T16; (4) the docs and backlog rows of 2.5.

## 8. Security notes for the security round (threat model)

Adversaries: a mistake or an operator edit that downgrades TLS without anyone noticing, and a network attacker between the app and the database.

- A near-miss of `system` accepted (case, whitespace, prefix) and treated as something else: exact `===`, no trim or case folding; T13 refuses the D4 set everywhere; M1 must be killed.
- `system` meaning no verification, or verification without the host name: the one `rejectUnauthorized: true` literal is shared; T8's exact shape (no `checkServerIdentity`, no `servername`); T15 refuses a private-CA server; R10; M2 must be killed.
- The trust set widened by the environment or left implicit: the explicit bundled array (2.3, docs and probe); the child-built T15 row (a child whose `NODE_EXTRA_CA_CERTS` trusts CA-A builds its own `system` config through the helper and is still refused, while the no-`ca` control there connects); M3 must be killed (it is, by that row only, section 6).
- A weakening URL accepted under `system`: the shared `withoutSslParameters`; T11, T12.
- `system` failing the production requirement, or PEM behaviour changing: T8-T10, T16; T1-T7 unchanged and passing.
- A refusal or log that prints the URL, a host or the value: constant reasons (pg-ssl-options.ts:19, the same line at base and head); T17.
- A doc that tells the owner the wrong form: the content rule of 2.5; the App Spec comments carry neither form and point to the one row.
- No `rejectUnauthorized: false`, no no-verify, no `checkServerIdentity` override, no committed key or certificate (the stub CA is made at test time), no new env name, no migration.

## 9. Open

None in scope. Recorded, out of scope: the merged backlog row's cite `pg-ssl-options.ts:43` (docs/autopilot-backlog.md:8202 at base ccaa70f, head :8203) moves by +k (the function is head :46) and stays as dated history; Node 22 is not measured locally (CI's T15 run is the measurement); the host-name check for an IP host is not measured (the PEM path's behaviour, unchanged).

RQ-L91-2, a ruling request to the conductor, outside the authorized slice: docs/runbooks/outbox-dispatch-enable-rollback.md :161 gives the owner a psql connection with `sslrootcert=<CA file>`, and an Advanced Edition cluster has no CA file to download, so that line gives no verified psql path for Advanced. Ruling RO-L91-3 (1), decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature (Tier B, reversible): YES, the ownership is extended by that one line. :161 now gives the Advanced Edition form `sslrootcert=system` (with `sslmode=verify-full`) and its two conditions, verbatim from https://docs.digitalocean.com/products/databases/postgresql/how-to/connect/ (the F7 page), section `Connect with verify-full on Advanced Edition`, read 2026-11-01: "Use a PostgreSQL client with libpq 16 or later." and "Older libpq versions treat system as a filename and the connection fails." So a psql older than libpq 16 fails closed, never unverified; the same line's CA sentence names `system` for Advanced. It changes no row of section 4, so OPEN_QUESTIONS_IN_SCOPE stays 0.

## 10. Hard dependencies

PR 161 (L90) is merged and is the base; it contains PR 160 (L89) and L78. Nothing unmerged.

## 11. Closure matrix (12 of 12 PASS)

| # | Gate | Evidence | Result |
| --- | --- | --- | --- |
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the worktree HEAD = the base; section 1 | PASS |
| 2 | Decisions in scope final | the owner's 20:47 message with the conductor's narrow reading, the writers' D1-D8 (section 3) | PASS |
| 3 | Scope IN/OUT and owner clear | sections 2 and 7; the verdict's IN_SCOPE and OUT_OF_SCOPE | PASS |
| 4 | Dependencies classified | section 10 | PASS |
| 5 | Live schema and code match | 2.1-2.5 measured at the base; no schema change | PASS |
| 6 | Data, API, state, auth contract | 2.1 and the decision table; the return type and every consumer unchanged | PASS |
| 7 | Fail-closed, idempotency, order | any value other than exact `system` goes the PEM path and refuses unless it is certificate text; the verify literal shared | PASS |
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
AUTHORITY_SHA: ccaa70f03f21fc1d4eb5ee54f9b969a3cda5d6be
BASE_BRANCH: main
TARGET_FILES:
  - packages/db/src/pg-ssl-options.ts (edited: one import line in place of the blank line 6, the branch at base line 54, head line 57, one header sentence)
  - packages/db/src/pg-ssl-options-ca-required.test.ts (edited: new rows T8-T10, T13, T14, T17)
  - packages/db/src/pg-ssl-options.test.ts (edited: new rows T11, T12, T15; the child transport of connectInChildWithCaA, D8)
  - packages/db/src/pg-ssl-boot-check.test.ts (edited: one new row, T16)
  - packages/db/src/operator-cli-pg-config.test.ts (edited: one new row, T16)
  - infra/app.staging.yaml (edited: the 4 DATABASE_CA_CERT comment lines only)
  - infra/app.prod.yaml (edited: the 3 DATABASE_CA_CERT comment lines only)
  - docs/runbooks/env-manifest-staging-production.md (edited: row 35 and the five renderer cites)
  - docs/runbooks/staging-deploy.md (edited: the step (5) CA item, F7, the section 9 line)
  - docs/runbooks/outbox-dispatch-enable-rollback.md (edited: lines 161, 165 and 178; 161 by ruling RO-L91-3 (1))
  - .env.example (edited: the DATABASE_CA_CERT comment line only)
  - docs/standards/decisions.md (edited: one dated addendum to DD-159)
  - docs/autopilot-backlog.md (edited: two rows in place)
  - infra/render-app-spec.sh (read-only: the targets of the five cites)
  - infra/render-app-spec.test.mjs (read-only: pins the CA entry, not the comment)
  - packages/db/src/pg-ssl-boot-check.ts (read-only: a consumer)
  - scripts/lib/operator-cli-pg-config.mjs (read-only: a consumer)
SLICE: p5-db-tls-ca-system
IN_SCOPE: the one branch in pgSslConnectionConfig, its node:tls import and one header sentence; new test rows T8-T17 in the four test files and the child transport of connectInChildWithCaA (D8); the 7 App Spec comment lines; env manifest row 35 and its five renderer cites; staging-deploy step (5), F7 and the section 9 line; outbox runbook lines 165 and 178; the .env.example DATABASE_CA_CERT comment; one dated DD-159 addendum; two backlog rows in place; this record
OUT_OF_SCOPE: L89's requirement predicate and the PEM rows beyond accepting system; every connection site and consumer; scripts/; every other deploy-guard file and App Spec line; every other line of .env.example; any new env name; trimming or case folding of the value; rejectUnauthorized false, no-verify or a checkServerIdentity override; any committed key or certificate; migrations; other backlog rows, the merged row operator-cli-pg-tls-helper included; any secret value or connection string
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none unmerged; ccaa70f03f21fc1d4eb5ee54f9b969a3cda5d6be (PR 161's merge, L90) is the base
PRIOR_SLICES: p5-db-tls-ca-options (L78, merged), p5-db-tls-ca-required (L89, merged), p5-operator-cli-pg-tls-helper (L90, merged)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none # the owner sets DATABASE_CA_CERT per component in the console, a post-merge runbook step
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration; one security round (opus) on section 8
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W adds the import, the branch and the header sentence (2.1, 2.2), writes rows T8-T15 and T17 (section 5), runs the focused files through the DB/e2e lock and the package typecheck, and commits
REMAINING_BLOCKERS: none
```
