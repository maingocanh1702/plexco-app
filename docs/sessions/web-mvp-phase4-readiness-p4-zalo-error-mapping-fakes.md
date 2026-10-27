<!-- review-readiness: code-ready -->

# Step-0 readiness: L47 p4-zalo-error-mapping-fakes (session P4-S6a)

> Agent-facing. Step-0 readers A (the lane block's Q1, Q2 and Q7, and the conductor's Q0) and B (Q3 and Q4), opus, one live at a time (run 1); Q5 and Q6 measured by the writer of this file (O). Writers W1 and W2 opus; the evidence template and the backlog rows by the orchestrator, who also runs every database, port-binding and fake-server test under the lane lock. Reviewers R1a, R1b and SEC opus, one after another (Claude subagents: the Web MVP program's named exception DD-122 D4), at most 3 rounds counting pre-push rounds. RISK: P2 (the connect path handles a bot token: no token may reach any log, error, test output or document; no money, no schema, 0 migrations). Base `a965de349f59a76b909296460520afd9c02e6d4b` (main, the merge of PR #128, L53; its first parent `4566effeef395e8c662fa62c760af504e5378a60` is the merge of PR #129, L49); branch `feat/p4-zalo-error-mapping-fakes`; worktree `.autopilot/worktrees/p4-zalo-error-mapping-fakes`; HEAD = base at step 0 (measured). Every `path:line` below was MEASURED at the base on the source text by the step-0 readers, or by the writer of this file where marked (O). The readers' notes live outside the repo, so this file restates every fact it relies on. No tracked file was edited at step 0; no DB suite ran.

Short forms: R = `apps/web/app/api/onboarding/zalo/connect/route.ts`, RT = its `route.test.ts`; I = `packages/db/src/zalo-ingress.ts`, IT = `packages/db/src/zalo-ingress.test.ts`, M = `packages/db/migrations/0053_zalo_ingress.sql`, API = `packages/db/src/zalo-bot-api.ts`, APIT = `packages/db/src/zalo-bot-api.test.ts`, RBB = `packages/db/src/read-bounded-body.ts`; DM = `apps/bot/src/projectors/zalo-dm.ts`, DMT = `apps/bot/src/projectors/zalo-dm.test.ts`, STUB = `apps/bot/src/test-zalo-stub.ts`; CARD = `apps/web/components/settings/zalo-connect-card.tsx`, SETUI = `apps/web/lib/settings-error-ui.ts`, SESUI = `apps/web/lib/session-error-ui.ts`, STATUS = `apps/web/components/settings/zalo-connect-status.ts`; DEC = `docs/standards/decisions.md`, BL = `docs/autopilot-backlog.md`, VAL = `scripts/check-review-readiness.mjs`.

## 1. Authority

- **DD-150** (DEC:123): the owner's written approval of 2026-10-26 ("Phase 4 plan approved, Q1-Q10 default") of `docs/sessions/web-mvp-phase4-plan.md`, whose section 3 row L47 (:63, O) is this lane.
- **Q5, the owner's own answer** (default applied by the approval), verbatim from the lane block: "a bot revoked at connect reuses the code and the t(vi, en) message that the connect route returns when `getMe` rejects the token; no new code". Its measured user-visible effect: section 2.2.
- **The two rows** (pre-existing contracts): `## task: zalo-connect-bot-revoked-error-mapping` (BL:6169, O: `status: idea`, P2, `scope: [R, I]`, `merged_probe: null`, `_readiness: NOT_CODE_READY` for want of the API error code, which Q5 now gives) and `## task: zalo-outbound-error-mapping-real-bot-verification` (BL:6580, O: `status: blocked`, `change_class: owner-evidence-gate`, `close_by: hand · owner-evidence-gate: closed by recorded real-bot responses, not by a commit`, its `scope` the evidence template's path). This lane does the whole first row and the FAKE half of the second, and changes no rule.
- **RO-L47-1** and **D42**, "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature" (Tier B, reversible): item 1, the owner's current concurrency rule C22 (up to two lanes in parallel; the block's "C20" and "main cannot move while you run" are superseded: before the push `git fetch` and, if origin/main moved, one `git merge --no-ff origin/main`); item 2 = D42 (section 1.1); item 3, the B3 ceilings (section 9); item 4, the security unit (sections 8 and 10); item 5, the review rounds (section 8); items 6-7, database, e2e, local-server and fake-server runs are the orchestrator's only, and the real Zalo bot token is the owner's: no test, script, fixture, log or document of this lane contains, requests or uses one; item 8, the user-visible note (2.2) and the blocked row not flipped; item 9, this file is the branch's first content commit and the rows close BY HAND in the L37/L58 form.
- **Negative scope** (the lane block): no new error code or message; no change of the outbound mapping (a disagreement with DD-138 is a ruling request) or of any other connect case; no migration; no change of `zalo_bot_set_status`; no real token or real network call in any test; no new dependency; the real-bot evidence is the owner's and is not produced here; PR #50 untouched.

### 1.1 Dependencies (Q0)

- The plan edge L47 <- L45 is treated as a conservative ordering, not a content dependency (conductor decision D42; precedent: L46 merged while L45 waited). L45 is parked on the owner's answer and is not merged.
- Q0, measured read-only: L47's files are disjoint from L45's (its parked worktree's diff against `8e918f0ec541ef4f72740be652a3a86584d381c3`: `apps/bot/src/dispatcher.ts`, `apps/bot/src/projector-registry.test.ts`, `apps/bot/src/queues.ts`, `apps/bot/src/zalo-dm-delivery-age-bound.json`, two scripts and its readiness file; its working tree modifies only `apps/bot/src/projector-registry.test.ts`) and from L43's (the web name-rule files). No content dependency: DM:10 is a type-only import from `../dispatcher.js`; DMT:14 imports `runDispatchCycle`, which the class tests do not use (they call deliver directly, DMT:244-245). L47's matrix goes into NEW test files; DMT is not touched.
- No other dependency: W1 and W2 need nothing unmerged.

## 2. Measured at base

### 2.1 The connect route's error mapping (reader B)

| Trigger | Answer | Line |
|---|---|---|
| `getMe` kind `timeout` or `network` (also a body-read failure after a 2xx, which API:92 maps to `timeout`) | AUTH_UNAVAILABLE 503 t("Zalo tạm thời không phản hồi.", "Zalo is temporarily unavailable.") | R:131-132 |
| `getMe` any other failure (`invalid_token`, `invalid_base`, `rejected` with any status incl. 5xx or `ok:false`, `bad_response`, a non-ZaloApiError) | `tokenInvalid()`: ZALO_TOKEN_INVALID 400 t("Token bot Zalo không hợp lệ.", "Invalid Zalo bot token.") | R:134, R:126-127 |
| ZaloConnectError BOT_REVOKED | FORBIDDEN 403 t("Bot này đã bị thu hồi.", "This bot has been revoked.") | R:199-200 |
| ZaloConnectError FORBIDDEN / COMMAND_ID_CONFLICT (also the probe R:116-121) / NO_ONBOARDING_RUN | FORBIDDEN 403 / COMMAND_ID_CONFLICT 409 / NOT_FOUND 404 | R:201-206 / R:207-212 / R:213-214 |
| superseded | CONNECT_SUPERSEDED 409 | R:183-193 |
| anything else | 500: `throw sanitizedConnectError(error)` = `zalo_connect_failed: <name> <SQLSTATE>`, no cause | R:60-69, R:217 |

- `tokenInvalid` is defined once (R:126-127, a const in the `runWithLang` callback R:79-219), used once (R:134) and in scope at R:199. The one catch R:196-218 wraps begin (R:140) AND finish (R:175), so `case "BOT_REVOKED": return tokenInvalid();` covers both paths. Today the begin path answers 403 and the finish path, with no catch in I, falls to R:217: a 500.
- Order: begin (R:140), the token encrypted (R:146-150), `setWebhook` (R:169; a failure answers 200 with status `error` and a `log.warn`, R:168-174), then finish (R:175).

### 2.2 What the host sees (reader B; USER-VISIBLE, Q5)

The screen maps the CODE to its own copy and never shows a server string (SETUI:9). After any failure it refetches the state (CARD:147-151); a `revoked` state clears the token and the commandId (CARD:80-84) and swaps the form for the focused revoked note (CARD:200-201, STATUS:52-56; no field highlight, no Retry). The form is hidden when the GET already says revoked (CARD:200), so a revoked connect comes only from a race (revoked after the page loaded) or a direct API call.

| | API answer | Brief alert | Settled screen |
|---|---|---|---|
| Before | begin: 403 FORBIDDEN t("Bot này đã bị thu hồi.", "This bot has been revoked."); finish: a sanitized 500 | FORBIDDEN falls through to SESUI:160-167: "Bạn không có quyền thực hiện thao tác này ở CLB này." / "You are not allowed to do this in this club." | badge "Đã thu hồi" / "Revoked" and the revoked note |
| After | begin and finish: 400 ZALO_TOKEN_INVALID t("Token bot Zalo không hợp lệ.", "Invalid Zalo bot token.") | SETUI:34-41: "Token bot Zalo không hợp lệ. Kiểm tra lại token rồi nhập lại." / "That Zalo bot token is not valid. Check it and enter it again." | identical |

- "This bot has been revoked." is never shown today. The lasting change is the API answer; on the screen only the brief alert changes, until the refetch shows the same revoked note (if the refetch fails, both show the GET's error, CARD:99-100, :173-176). Not measured: the card's alert for today's finish-path 500.
- **Default applied, pending owner sign-off** (Q5 itself is the owner's decision; this measured effect and the reuse of `tokenInvalid` are the lane's defaults). Rejected alternative: a copied t(vi, en) pair for BOT_REVOKED instead of reusing `tokenInvalid`.

### 2.3 The DB layer (reader B)

- `ZaloConnectError` I:434-445: codes `"FORBIDDEN" | "COMMAND_ID_CONFLICT" | "NO_ONBOARDING_RUN" | "BOT_REVOKED"` (I:435); the constructor takes a code and a message, no cause (I:438-444).
- Begin's catch I:543-549: 42501 -> FORBIDDEN (I:544); `if (pgErrorHasCode(e, "22023") && /bot is revoked/.test(pgErrorChainText(e))) throw new ZaloConnectError("BOT_REVOKED", "bot is revoked")` (I:545-546); else rethrow. It catches the upsert's raise M:305-309 (`zalo_bot_upsert_for_tenant: bot is revoked`, ERRCODE `invalid_parameter_value` = 22023).
- `finishZaloConnect` I:565-650 runs in one `withTenant` (= `db.transaction`, `packages/db/src/tenant.ts:62-71`): a row lock (I:579) and `readState` (I:580), reads only; the superseded branch (I:581-605) returns BEFORE set_status; the `zalo_bot_set_status` call I:606-609 has no try/catch; after it the run lookup, the `onboarding_steps` upsert and the `processed_commands` insert (I:610-647). A 22023 at I:606-609 rolls the transaction back: nothing is written.
- `zalo_bot_set_status` M:339-402: `IF v_cur = 'revoked' THEN RAISE EXCEPTION 'zalo_bot_set_status: bot is revoked' USING ERRCODE = 'invalid_parameter_value';` (M:371-372), BEFORE the `p_only_from` check (M:374), so finish's `ARRAY['connecting','registered']` does not avoid it. 22023 also means 'invalid status' (M:364) and 'invalid arguments' (M:301-302): hence the text test; the same `/bot is revoked/` matches both revoked raises.
- `readState` returns a revoked row's token (I:406-424) and set_status never changes it, so a finish with the matching token reaches M:372. No in-repo writer sets `revoked` (set_status callers: I:387 `'active'`, I:607 the outcome): the finish 22023 needs an out-of-band revoke between begin and finish. The sibling caller `markBotVerifiedActive` (I:372-390) would raise the same 22023 for a revoked bot (I:387): outside "the finish catch only" (row (b), section 11).
- IT:30 "Real-PG tests as role `app` (DATABASE_URL_TEST required; CI only)"; the harness throws without it (`packages/db/src/test-harness.ts:717-722`). No beginZaloConnect revoked test exists; no db test names BOT_REVOKED. Model: the describe IT:300; the revoked fixture IT:526-566 (IT:559 `await set("revoked", false);`, IT:562-565 a raw upsert -> `/bot is revoked/` via `expectErrorChainToMatch`); call shapes IT:327-382; "nothing written" asserts IT:411-421. botA stays revoked after IT:559 and later suites expect it (IT:594-597): the new tests go after IT:566 and read the token via `ctx.owner.query` (as `currentToken`, IT:586-592).
- RT mocks every dependency (RT:14-39: `@plexco/db` begin, finish, probe, authorize, withTenant, `appDb`; `getMe` and `setWebhook` as `vi.fn`) with real encryption (ENCRYPTION_KEY, RT:61); no DATABASE_URL_TEST, no port. Pins: RT:245-248 `it("a revoked bot cannot be re-connected: 403")` (status only); the 400 + code shape RT:123-129; the getMe timeout/network 503 RT:131-139; the token-absence pattern RT:94.

### 2.4 The token path (reader B)

The token is read at R:98 and length-checked (R:107-108); `getMe(botToken)` (R:129) builds `${base}/bot${botToken}/...` (API:70); every failure becomes a `ZaloApiError` whose message is `zalo api: ${kind}` (API:39), the raw fetch error dropped (API:77-81). Only ciphertext reaches the DB (R:146-150, `blobToText` R:157, I:537). The `setWebhook` log (R:173) carries the tenantId and the ZaloApiError only. The BOT_REVOKED path carries a fixed message without the pg error (I:546, I:438-444); R:199-216 logs nothing and returns a fixed pair; finish's SQL parameters are the tenantId, the botId and the outcome (I:607-608). `pgErrorChainText` (`packages/db/src/pg-error.ts:17-25`) only feeds `.test()` at I:545.

### 2.5 The outbound sender, the projector and DD-138 (reader A)

- `sendMessage(token, chatId, text, {timeoutMs})` (API:125-132) -> `call()` (API:60-108): a token shape check (API:25, 66: `invalid_token`, no fetch); the global `fetch` (the only import is API:20) `POST ${base}/bot${token}/sendMessage` with `signal: AbortSignal.timeout(timeoutMs)` and `redirect: "error"` (API:70-76, 131); `TIMEOUT_MS = 5_000` (API:23, 64), the signal also covering the body (API:90-91); `MAX_RESPONSE_BYTES = 64 * 1024` (API:24) via `readBoundedBody` (API:88): a declared content-length (RBB:9-12) and the streamed count with `reader.cancel()` (RBB:22-26); bad UTF-8 = `malformed_encoding` (RBB:30-37). `getMe` (API:111-113) shares `call()` without a timeout option.
- Kinds: fetch rejects with `TimeoutError` -> `timeout`, else `network` (API:77-81); a non-2xx -> `rejected(status)`, the body cancelled unread (API:82-85); a body read that throws after a 2xx -> `bad_response` for sendMessage (`timeout` for getMe and setWebhook) (API:89-93); oversize or bad UTF-8 (API:94), bad JSON (API:99), `ok` not boolean (API:105) -> `bad_response`; `ok:false` -> `rejected(null, integer error_code or null)` (API:106-107).
- Verdict: pure and DB-free, `classifyZaloError` (API:150-170) with `byStatus` (API:143-148); `rejected` uses `httpStatus ?? providerErrorCode` (API:164), so envelope codes use the HTTP table. The projector only switches on it inside `createZaloDmDeliver` (needs a `Queryable`): DM:222 `const verdict = classifyZaloError(error);`, `retry(code)` DM:223, `dlq(code)` DM:224, `recipient_terminal` -> that recipient recorded `terminal` (DM:184-197, 225-229), the others continue, the job `delivered("sent")` (DM:232).
- DD-138 (DEC:2377) row `p3-m6-zalo-outbound Z-6` (DEC:2451), verbatim: "as shipped: 401 -> DLQ `zalo_unauthorized`; 429 -> retry `zalo_rate_limited`; 5xx -> retry `zalo_server_error`; other 4xx -> recipient `zalo_rejected`; 2xx `ok:false` by numeric `error_code` (absent -> `zalo_rejected`); no boolean `ok`, bad JSON, oversize, or a `sendMessage` body that fails mid-read after a 2xx -> recipient `zalo_bad_response` (never resent); timeout -> retry `zalo_timeout`; network -> retry `zalo_network`" (source "L4 · #66").

### 2.6 The matrix (reader A; pinned by W2)

R = retry (DM:223), D = dlq (DM:224), T = recipient terminal (DM:225-232); rej(s, c) = `rejected(httpStatus, providerErrorCode)`. Disagreements with DD-138: **0**.

| # | Class | Fake returns | Kind | Verdict -> projector | DD-138 | Acceptance |
|---|---|---|---|---|---|---|
| 1 | HTTP 401 | 401 | rej(401, -) API:84 | D `zalo_unauthorized` API:144 | match | A-8 |
| 2 | HTTP 429 | 429 | rej(429, -) | R `zalo_rate_limited` API:145 | match | A-9 |
| 3 | HTTP 5xx | 500-599, any body | rej(5xx, -) | R `zalo_server_error` API:146 | match | A-10 |
| 4 | other 4xx | 400, 403, 404 | rej(4xx, -) | T `zalo_rejected` API:147 | match | A-11 |
| 5 | ok:false 401 | 200 `{ok:false, error_code:401}` | rej(-, 401) API:107 | D `zalo_unauthorized` API:164 | match | A-12 |
| 6 | ok:false 429 | error_code 429 | rej(-, 429) | R `zalo_rate_limited` | match | A-13 |
| 7 | ok:false >= 500 | error_code 500 | rej(-, 500) | R `zalo_server_error` | match | A-14 |
| 8 | ok:false other integer | 403, 0, -1 | rej(-, n) | T `zalo_rejected` | match | A-15 |
| 9 | ok:false no integer | no error_code, `"401"` | rej(-, -) API:107 | T `zalo_rejected` API:165-166 | match | A-16 |
| 10 | no boolean ok | `{result:{}}`, `ok:"true"`, `null` | bad_response API:105 | T `zalo_bad_response` API:161-162 | match | A-17 |
| 11 | bad JSON | `{not json`, an empty body, bad UTF-8 | bad_response API:94/99 | T `zalo_bad_response` | match | A-18 |
| 12 | oversize | content-length > 65536, or > 65536 bytes chunked | bad_response API:94 | T `zalo_bad_response` | match | A-19 |
| 13 | mid-read failure after a 2xx | 200 + a partial body, then destroy or stall | bad_response API:89-93 | T `zalo_bad_response` | match | A-20 |
| 14 | timeout | no headers before timeoutMs | timeout API:79 | R `zalo_timeout` API:153-154 | match | A-21 |
| 15 | network | destroy before headers, a closed port, 301-308 | network API:79 | R `zalo_network` API:155-156 | match | A-22 |

- Outside Z-6, pinned as shipped where the fake reaches them (A-23): `invalid_token` -> D `bot_unavailable` (API:157-158); `invalid_base` -> D `config_missing` (API:159-160; the projector pre-checks it, DM:137-141); a non-ZaloApiError -> R `zalo_network` (API:151); 300 and 304 -> T `zalo_rejected` (API:147). Classes DD-138 does not name, pinned as shipped (no disagreement, so no ruling): 3xx; a non-integer error_code = absent; an envelope error_code >= 500 (600+ too) -> R, a zero or negative one -> T (API:146-147, 164).

### 2.7 Base URL, existing tests, the fake (reader A)

- `zaloBotApiBase(raw = process.env.ZALO_BOT_API_BASE)` (API:45), default `"https://bot-api.zaloplatforms.com"` (API:22), plain http only for `["localhost", "127.0.0.1", "[::1]"]` (API:26, 52-53), read per call (API:67). A 127.0.0.1 fake works with NO code change (DMT:53 sets `process.env.ZALO_BOT_API_BASE = stub.base`, STUB:63; APIT:55 pins the "accepts" cases). **Seam needed: no.** A short timeout needs none either: `sendMessage(..., {timeoutMs})` (API:129-131; APIT:212 uses 20 ms) and the projector's `sendTimeoutMs` (DM:66, 87; DMT:249 uses 300 ms against STUB's 1 s "slow" reply, STUB:49); the shipped 5 s (API:23, DM:30) would cost about 5 s per timeout or stall case.
- APIT is a FETCH MOCK (`vi.stubGlobal("fetch", fetchMock)` in a file-level `beforeEach`, APIT:21-26; no socket, no real redirect or timeout): a real-server test there would inherit the stub. DMT drives the REAL `sendMessage` against STUB (DMT:51) but needs DATABASE_URL_TEST (`setupZaloDmContext` DMT:183-185, describe DMT:236) and binds 127.0.0.1:0 (STUB:60); its pins: DMT:561 (500, 429, a slow reply, a reset connection: retry), DMT:578 (403, okFalse 403, okFalse null, no_ok, malformed, oversize, cut: recipient terminal), DMT:607 (a 401 dead-letters, a 500 retries mid-roster).
- Unpinned at the base: ok:false 401/429/>=500 through a real server or the projector; 5xx other than 500/503; 4xx other than 403; a declared content-length oversize (STUB's is chunked: `writeHead` before `end`, STUB:46-47, 51); bad UTF-8; an empty body; JSON `null`; a stall after headers; a closed port; a real 3xx; a real sender-level timeout.
- STUB (STUB:34-72, replies STUB:10-19) is outside L47's ownership and not importable from `packages/db` (apps/bot imports @plexco/db, DM:8, not the reverse). The clerk's flake list names none of these files (no ACTIVE or RETIRED entry).

## 3. Design

### 3.1 W1: the revoked-bot fix

- (a) I: one non-exported predicate `isZaloBotRevokedError(e: unknown): boolean` holding today's begin test verbatim, `pgErrorHasCode(e, "22023") && /bot is revoked/.test(pgErrorChainText(e))` (I:545). Begin's catch calls it (I:545-546, behaviour unchanged). A new try/catch around finish's `zalo_bot_set_status` call (I:606-609) throws `new ZaloConnectError("BOT_REVOKED", "bot is revoked")` when the predicate holds and rethrows anything else unchanged; the throw leaves the `withTenant` callback, so the transaction rolls back and nothing is written. `isZaloBotRevokedError` is ABSENT at the base (`git grep -w`, O): it is the row's `merged_probe`.
- (b) R: `case "BOT_REVOKED": return tokenInvalid();` in place of R:199-200; no other case changes.
- (c) Tests: RT replaces RT:245-248 with begin BOT_REVOKED and finish BOT_REVOKED -> 400 `ZALO_TOKEN_INVALID`, the body equal to the getMe-rejected body, `not.toContain(BOT_TOKEN)`; the getMe timeout pin (RT:131-139) stays. IT, after IT:566: a real-DB `finishZaloConnect` with botA already revoked (BOT_REVOKED, not a raw 22023; no `onboarding_steps` and no `processed_commands` row for the commandId; the bot row unchanged) and a real-DB `beginZaloConnect` revoked test (the refactor onto the predicate is pinned).

### 3.2 W2: the fake server and the matrix

- A new `packages/db/src/` test file (descriptive kebab-case name chosen by W2) starts its own minimal `node:http` server on 127.0.0.1 port 0, points `ZALO_BOT_API_BASE` at it through the existing loopback allowance (API:26, 52-53; no seam) and drives the REAL `sendMessage` for rows 1-15 of 2.6: the ZaloApiError kind, then the `classifyZaloError` verdict and code. A short `timeoutMs` exercises the real `AbortSignal.timeout`. The server is closed after each test (`closeAllConnections()` then `close()`, as STUB:68), so a declared-oversize body left unread (RBB:10-11) cannot hold the run.
- A new `apps/bot/src/projectors/` test file (name chosen by W2) pins the projector outcome per class through the real `createZaloDmDeliver`: R -> retry with the code, D -> dlq with the code, T -> that recipient recorded terminal with the code and the job `delivered("sent")`. It may reuse STUB's replies (STUB:10-19, e.g. `{okFalse: n}` for rows 5-7) without editing STUB; whether it needs DATABASE_URL_TEST (DMT's `noDb` Queryable DMT:153, 166, or the real context DMT:183-185) is W2's measured choice; a DB-backed or port-binding run is the orchestrator's.
- The tests pin the SHIPPED mapping: a class whose result differs from 2.6 is a finding and a ruling request, never an edit of API or DM.

### 3.3 The template and the rows (the orchestrator)

- `docs/sessions/zalo-outbound-error-mapping-real-bot-evidence.md` (the path BL:6580's `scope` names): a TEMPLATE with one row per Z-6 class (401, 429, 5xx, other 4xx, 2xx `ok:false` by numeric `error_code`, bad or oversize response, timeout, network): how to provoke it with the real bot, the expected mapped outcome (2.6), empty slots for the recorded response (status, redacted body, date), and the redaction rule: never a token, a chat id, a user id or a webhook secret. Classification (O): the validator does not select this file (VAL:15 `CANDIDATE_NAME_RE` matches only a `review`, `readiness` or `plan` name segment; VAL:591-594 skips a non-candidate that has no line starting `REVIEW_VERDICT:`), so the template carries no directive and no such line; a verdict line added later fails as DIRECTIVE_MISSING (VAL:596-604).
- BL:6169 `zalo-connect-bot-revoked-error-mapping` closed BY HAND in the L37/L58 form (BL:7137 for L37, BL:6620-6621 for L58, O): `status: merged`; a `merged:` line (the date, "written before the merge; the merge time is the PR's mergedAt", the branch `feat/p4-zalo-error-mapping-fakes` and `gh pr list --state merged --head <branch>`; no PR number or merge SHA); a `note_merged:` line (measured at the base; the reconcile cannot flip it, `scripts/autopilot-backlog-reconcile:289` scanning only planned, ready and blocked rows while this row was `idea`); `merged_probe: isZaloBotRevokedError`.
- BL:6580 `zalo-outbound-error-mapping-real-bot-verification` NOT flipped: one dated update line pointing at the template and the fake matrix; it stays `blocked` on the owner's real token. Four new rows, one mechanism each (cap 5 for this lane, RO-L47-2; section 11).

### 3.4 Decision table (the connect error path)

| # | Path and error | At the base | After W1 |
|---|---|---|---|
| 1 | begin: the upsert raises 22023 "bot is revoked" (M:305-309) | BOT_REVOKED -> 403 FORBIDDEN (R:199-200) | BOT_REVOKED -> 400 ZALO_TOKEN_INVALID via `tokenInvalid` (A-1) |
| 2 | finish: set_status raises 22023 "bot is revoked" (M:371-372) | uncaught -> 500 `zalo_connect_failed: <name> 22023` (R:217) | BOT_REVOKED -> the same 400; the transaction rolled back, nothing written (A-2, A-5) |
| 3 | begin or finish: a 22023 without "bot is revoked" (M:301-302, M:364) | rethrown -> sanitized 500 | unchanged: the predicate needs the code AND the text (fail-closed) |
| 4 | begin: 42501 | FORBIDDEN 403 (I:544, R:201-206) | unchanged |
| 5 | finish: any other error | rethrown -> sanitized 500 | unchanged: the new catch rethrows it |
| 6 | getMe `timeout` or `network` | AUTH_UNAVAILABLE 503 (R:131-132) | unchanged (A-3) |
| 7 | getMe any other failure | ZALO_TOKEN_INVALID 400 (R:134) | unchanged (row (c), section 11) |
| 8 | superseded, COMMAND_ID_CONFLICT, NO_ONBOARDING_RUN | 409, 409, 404 (R:183-193, R:207-214) | unchanged (A-4) |

## 4. Lead corrections (7: reader A 3, reader B 4)

1. (A) Lead (2): the outcome codes live in `ZaloSendVerdict` and `classifyZaloError` (API:134-170), not in DM, which only calls `classifyZaloError(error)` (DM:222).
2. (A) Lead (2) "noop": the third result is `recipient_terminal` (API:141) with the job `delivered("sent")` (DM:232); `noop_*` (DM:43-45, 111) never comes from a send error.
3. (A) Lead (3): the sender already has a seam (API:45, 52-53, 67) and a `node:http` fake already exists (STUB:34-72): no seam is added.
4. (B) Lead (5) "the existing beginZaloConnect revoked test": none exists; the model is IT:526-566 with IT:327-382 and IT:411-421.
5. (B) Lead (1): begin catches the upsert's raise (M:305-309), not set_status's; finish will catch M:371-372; same 22023, same text.
6. (B) Lead (1)(d) and the Q5 premise "instead of today's 'This bot has been revoked' 403": the screen never shows that text today (FORBIDDEN maps to the generic copy, SESUI:160-167); after the change the invalid-token copy is the screen's own (SETUI:37-38), shown only until the refetch shows the revoked note; the lasting change is the API answer.
7. (B, O) Line drift: `tokenInvalid` R:126-127 (lead :125-127); the set_status call I:606-609 (lead about :607; the row cites :455 and :414); the begin catch I:545-546 (the row cites :394); the two rows at BL:6169 and BL:6580 (leads about :6163 and :6574).

## 5. Pinned defaults (Tier B; each "default applied, pending owner sign-off")

| # | Default | Rejected alternative |
|---|---|---|
| D1 | BOT_REVOKED answers `tokenInvalid()` itself (one definition of the pair) | a copied t(vi, en) pair (two definitions drift silently) |
| D2 | the fake is a real local `node:http` server on 127.0.0.1 that the real client reaches through the existing `ZALO_BOT_API_BASE` loopback allowance | a `fetch` mock (skips the real client, timeout, oversize and malformed-body paths); a new base-URL seam (not needed, 2.7) |
| D3 | one shared non-exported predicate `isZaloBotRevokedError` for begin and finish | a second copy of the code-and-text test in finish |
| D4 | the template's shape and redaction rule (3.3), without a review-readiness directive | `<!-- review-readiness: template -->` (accepted, VAL:607-608, but a later verdict line would then pass unchecked) |
| D5 | the matrix in two NEW test files, `packages/db/src/` (sender leg) and `apps/bot/src/projectors/` (projector leg) | APIT (its file-level fetch stub APIT:21-26 would catch the real server's calls); DMT (needs DATABASE_URL_TEST and sits next to L45's cycle-driving bot tests) |
| D6 | out-of-scope findings as backlog rows, one mechanism per row (section 11), as ruled in RO-L47-2 (decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature): RQ1 accepted (the two comment-only "answers 403" edits join the scope; the e2e fake stays a row), RQ2 default confirmed (a row), RQ3 the new-row cap raised from 3 to 5 | catch the 22023 in `markBotVerifiedActive` too (outside "the finish catch only"; its caller's handling unmeasured); one merged row for several mechanisms (rejected by RO-L47-2) |

## 6. Implementation steps

1. W1 (writer, no DB): GitNexus `impact` on `beginZaloConnect` and `finishZaloConnect` with a `git grep -w` callers line; edit I (3.1 a) and R (3.1 b); edit RT and IT (3.1 c); run RT, lint, format:check, `pnpm review:check:changed`; commit in the worktree. The orchestrator runs IT under the lane lock, each new test twice in a row.
2. R1a reviews W1.
3. W2 (writer): the two new test files (3.2); the orchestrator runs them under the lock (they bind a local port; the projector leg may need the DB), twice in a row.
4. The orchestrator writes the template and the rows (3.3, section 11).
5. R1b, then SEC (section 8); fixes, re-reviewed in round 2.
6. Final: `pnpm -w test` once at the final head under the lock, `pnpm build` once (sandbox off: next/font), the full `pnpm review:check`, `detect_changes`, one push.

## 7. Acceptance matrix (A-1..A-26)

| ID | Check | Where |
|---|---|---|
| A-1 | begin throws ZaloConnectError BOT_REVOKED -> 400, code ZALO_TOKEN_INVALID, the body equal to the getMe-rejected body; the bot token absent from the body | RT |
| A-2 | finish throws ZaloConnectError BOT_REVOKED -> the same 400 pair; the token absent | RT |
| A-3 | a getMe `timeout` and a `network` failure still answer AUTH_UNAVAILABLE 503 | RT:131-139 (existing, green) |
| A-4 | every other connect case unchanged (3.4 rows 3-8) | the existing RT cases, green |
| A-5 | real PG: `finishZaloConnect` with botA revoked -> ZaloConnectError BOT_REVOKED (not a raw 22023); no `onboarding_steps` and no `processed_commands` row for the commandId; the bot row unchanged (status revoked, token unchanged) | IT, after IT:566 |
| A-6 | real PG: `beginZaloConnect` for the revoked bot -> ZaloConnectError BOT_REVOKED (the predicate refactor pinned) | IT, after IT:566 |
| A-7 | no token in any error path: the BOT_REVOKED bodies (A-1, A-2) and the thrown errors (a fixed message, I:438-444) | RT, IT; R1a, SEC |
| A-8..A-22 | rows 1-15 of 2.6, one ID per row in order: the sender leg (the real `sendMessage` against the fake gives the Kind column, `classifyZaloError` the Verdict column) and the projector leg (the real deliver: R -> retry with the code, D -> dlq with the code, T -> the recipient recorded terminal with the code and the job `delivered("sent")`) | the two new files |
| A-23 | the classes outside Z-6 and the unnamed classes (the notes under 2.6) pinned as shipped where the fake reaches them | the sender-leg file |
| A-24 | the fake binds only 127.0.0.1 (port 0), is closed after each test (the sender matrix) / after the file (the projector matrix), makes no external call and carries no real token (a fake token of the shape API:25 accepts) | both new files; SEC |
| A-25 | the timeout and stall rows use the real `AbortSignal.timeout` with a short `timeoutMs` (API:129-131, DM:66, 87), no fake timers | both new files |
| A-26 | the template exists at the path BL:6580 names, one row per Z-6 class, with the redaction rule, and passes `pnpm review:check`; the rows as in 3.3 (one hand close with `merged_probe: isZaloBotRevokedError`, the blocked row not flipped, 4 new rows of one mechanism each, cap 5 per RO-L47-2; the two comment-only corrections in STATUS and CARD) | `pnpm review:check`; R1b |

## 8. Verification and review

- TESTS (the lane block's line as commands), focused files first. Writers (no DB, no port): `pnpm --filter @plexco/web exec vitest run app/api/onboarding/zalo/connect/route.test.ts`; `pnpm --filter @plexco/db typecheck` and `pnpm --filter @plexco/bot typecheck` (`tsc --noEmit`, `packages/db/package.json:20`, `apps/bot/package.json:9`); `pnpm -w lint`; `pnpm -w format:check`; `pnpm review:check:changed`. Orchestrator only (RO-L47-1 items 6-7), under the lane's locked-run wrapper: IT (`pnpm --filter @plexco/db exec vitest run src/zalo-ingress.test.ts` with DATABASE_URL_TEST) and the two new matrix files (they bind a local port), each new test twice in a row; the web typecheck (`next typegen && tsc --noEmit`, `apps/web/package.json:10`); the whole apps/web vitest suite before each commit; `pnpm -w test` once at the final head (one rerun for a flake on the ACTIVE clerk list; a RETIRED entry is a real failure); `pnpm build` once (sandbox off: next/font); the full `pnpm review:check`; the CI-only patterns C11/C12; GitNexus `impact` before editing a symbol and `detect_changes` before every commit.
- REVIEW (RO-L47-1 item 5): round 1 = R1a (W1: the finish catch, the route mapping, the route and real-DB tests; the token never appears), then R1b (W2 and the docs: the matrix against DD-138, the fake's realism, the template and the validator), then SEC; each alone (opus, Claude subagents, DD-122 D4), reading committed content; fixes are re-reviewed in round 2; at most 3 rounds counting pre-push rounds; the L44 last-round policy applies in round 3 only.

## 9. Budget (B3) and files

- Estimate (the lane block): 90 non-test / 360 test / 450 total lines (docs excluded; the template is docs), 9 files, 0 migrations. Ceilings (RO-L47-1 item 3, decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature): up to 180 non-test lines, 600 test lines and 14 non-docs files with a logged design reason need no ruling; above any of them, a ruling request before the next writer.
- Edited (TARGET_FILES): R and I (non-test); STATUS:49-50 and CARD:36 (comment-only, RO-L47-2: two more non-docs files, inside the 14-file ceiling); RT and IT (test); BL (docs). Read-only: API and DM.
- Planned new files (absent at the base, so not in TARGET_FILES): this readiness file; the sender-leg matrix test in `packages/db/src/` and the projector-leg matrix test in `apps/bot/src/projectors/` (names chosen by W2, descriptive kebab-case); `docs/sessions/zalo-outbound-error-mapping-real-bot-evidence.md` (the template).
- Planned 9 files: 2 non-test, 4 test, 3 docs (6 non-docs).

## 10. Threat model

| # | Threat (the lane block) | Defended by |
|---|---|---|
| 1 | an unhandled 22023 surfacing as a 500 whose body or log carries internals | 3.4 rows 1-2; the finish catch (3.1 a); A-2, A-5; everything else keeps the sanitized 500 (R:60-69) |
| 2 | a revoked bot reported as a permission problem (a misleading notice that sends the host to the wrong fix) | 3.1 b; A-1, A-2; 2.2 |
| 3 | a token or secret in any error, log, test output or the evidence template | 2.4; A-7, A-24; the template's redaction rule (3.3); SEC |
| 4 | the mapping drifting silently from DD-138 | the matrix A-8..A-23 pins every class; a difference is a ruling request (3.2) |
| 5 | a fake that is too kind | the real client code over a real socket (D2); the real timeout (A-25); the real oversize, malformed-payload and mid-read paths (2.6 rows 11-13); a closed port and a real 3xx (row 15) |

Not defended: the real Zalo API's behaviour (for example whether live `error_code` values are HTTP-shaped, API:14 "AWAIT-verify"); only the owner's real-bot run can show it, which is why BL:6580 stays `blocked`.

SECURITY_REVIEW: required because the lane edits the connect error path of a bot-token flow

One security-focused reviewer (SEC, opus, alone) after R1b (RO-L47-1 item 4: the lane block's "judgement VOID if" clause, exercised). Its checklist: threats 1-5 above, plus: the bot token never appears in any error body, log line, test output, fixture or the evidence template; the 22023 path leaks no internals; the fake server binds only to localhost and is closed after each test; no real network call.

## 11. Open

- **In scope: 0.** RQ-L47-1's three ruling questions are answered (RO-L47-2, D6): the comments STATUS:49-50 and CARD:36 ("the route answers 403") are corrected in this lane, comment-only; none blocks W1.
- Out of scope, named, behaviour unchanged, captured as 4 new rows, one mechanism each (cap 5, RO-L47-2):
  - **(a)** the stale e2e pin of today's 403: `apps/web/e2e/settings.spec.ts:801-823` (its fake :809-813 answers FORBIDDEN 403 for a revoked bot and stays green, since :817 matches the revoked note, not the server text).
  - **(b)** an unhandled 22023 from `zalo_bot_set_status` in the verified-active caller: `markBotVerifiedActive` (I:372-390) would raise it for a revoked bot (I:387).
  - **(c)** the connect route maps a getMe 5xx and a bad API base setting to ZALO_TOKEN_INVALID 400 (R:134: Zalo down reads as a bad token).
  - **(d)** API:94 leaves a response announced oversize by content-length unread and uncancelled (RBB:10-11; unlike API:83), so the connection stays open until the 5 s signal.
- Unchanged, no row: the webhook that `setWebhook` (R:169) registered before a finish that ends BOT_REVOKED stays registered, as at the base, where the same path ends in a 500.

## 12. Closure matrix (12 of 12 PASS)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the worktree HEAD at step 0, the merge of PR #128 (measured); every TARGET_FILES path exists at the base | PASS |
| 2 | Decisions in scope final | DD-150 and the owner's Q5; the two rows as the contract; RO-L47-1 and D42 (conductor); D1-D6 pinned as defaults pending owner sign-off (section 5) | PASS |
| 3 | Scope IN/OUT and owner clear | the lane block's FILE OWNERSHIP; the negative scope (section 1); the file list (section 9) | PASS |
| 4 | Dependencies classified | the plan edge L47 <- L45 an ordering, not a content dependency (D42; Q0 disjoint, 1.1); no other dependency | PASS |
| 5 | Live schema and code match | section 2 measured at the base; no schema or migration change | PASS |
| 6 | Data, API, state, auth contract | no schema, migration, new code or message; the one API change: BOT_REVOKED answers the existing ZALO_TOKEN_INVALID 400 pair (Q5; the user-visible effect in 2.2) | PASS |
| 7 | Fail-closed, idempotency, order | 3.4 (only the code AND the text map to BOT_REVOKED; everything else rethrown; the finish transaction rolls back) | PASS |
| 8 | Open questions in scope = 0 | section 11 | PASS |
| 9 | Acceptance matrix with expected results | section 7 (A-1..A-26) | PASS |
| 10 | Migration, security, rollback | no migration; SEC planned (section 10); rollback = revert the PR (no state, no data) | PASS |
| 11 | First slice hard dependencies merged | W1 depends on nothing unmerged | PASS |
| 12 | Implementation handoff ready | sections 3 and 5-8; W1 has every input (3.1, 2.3) | PASS |

## 13. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-27
AUTHORITY_SHA: a965de349f59a76b909296460520afd9c02e6d4b
BASE_BRANCH: main
TARGET_FILES:
  - apps/web/app/api/onboarding/zalo/connect/route.ts (edited: the BOT_REVOKED case returns tokenInvalid())
  - apps/web/app/api/onboarding/zalo/connect/route.test.ts (edited: BOT_REVOKED on begin and on finish answers the ZALO_TOKEN_INVALID 400 pair, replacing the 403 pin)
  - packages/db/src/zalo-ingress.ts (edited: the isZaloBotRevokedError predicate, the begin catch on it, the finish catch around zalo_bot_set_status)
  - packages/db/src/zalo-ingress.test.ts (edited: the real-DB finish and begin revoked tests after the revoked fixture)
  - apps/web/components/settings/zalo-connect-status.ts (edited, comment-only: the "route answers 403" lines 49-50, RO-L47-2)
  - apps/web/components/settings/zalo-connect-card.tsx (edited, comment-only: the "route answers 403" line 36, RO-L47-2)
  - packages/db/src/zalo-bot-api.ts (read-only: no seam needed)
  - apps/bot/src/projectors/zalo-dm.ts (read-only)
  - docs/autopilot-backlog.md (edited: one row closed by hand, one dated update line on the blocked row, 4 new rows)
SLICE: p4-zalo-error-mapping-fakes
IN_SCOPE: the BOT_REVOKED case of the connect route (tokenInvalid); the isZaloBotRevokedError predicate and the finish catch in zalo-ingress.ts; the route and real-DB tests; two new matrix test files (a packages/db sender leg over a local node:http fake, an apps/bot projector leg); the new evidence template docs/sessions/zalo-outbound-error-mapping-real-bot-evidence.md; the two comment-only "answers 403" corrections (zalo-connect-status.ts, zalo-connect-card.tsx); the two backlog rows and 4 new rows; this readiness file
OUT_OF_SCOPE: a new error code or message; any change of the outbound mapping (zalo-bot-api.ts, zalo-dm.ts) or of any other connect case; migrations and zalo_bot_set_status; markBotVerifiedActive; the e2e settings fake (row a); any behaviour change in zalo-connect-status.ts or zalo-connect-card.tsx; test-zalo-stub.ts, zalo-bot-api.test.ts and zalo-dm.test.ts; a real token or a real network call; the real-bot evidence itself (the owner's); new dependencies; PR #50
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none: the plan edge L47 <- L45 is a conservative ordering, not a content dependency (conductor decision D42; measured file-disjoint); the base commit is the merge of PR #128
PRIOR_SLICES: L4 (merged, PR #66: the shipped outbound mapping, DD-138 Z-6); L49 (merged, PR #129) and L53 (merged, PR #128): the base
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration; security round planned (SEC, opus, the threat model as the checklist) because the lane edits the connect error path of a bot-token flow; rollback = revert the PR
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 - add the isZaloBotRevokedError predicate to packages/db/src/zalo-ingress.ts, use it in the begin catch and in a new catch around the zalo_bot_set_status call of finishZaloConnect, return tokenInvalid() for BOT_REVOKED in the connect route, then edit route.test.ts and zalo-ingress.test.ts; GitNexus impact before each edited symbol; commit in the worktree
REMAINING_BLOCKERS: none
```
