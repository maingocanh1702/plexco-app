<!-- review-readiness: code-ready -->

# Step-0 readiness: L68 p5-log-correlation (session P5-S6b)

> Agent-facing. Step 0 measured by the readers S0a (Q1-Q4) and S0b (open items O1-O7), decided by the orchestrator (decisions D1-D12, run 2, 2026-10-29, cited as `s0-decisions D<n>`), written by S0c (all opus); writers W1, W2 and W3 (opus) one at a time in run 3; ONE reviewer role (opus, a Claude subagent: the Web MVP program's named exception DD-122 D4) and ONE security round (opus) on the final diff. RISK: P2 code (auth-route logging is a trust-boundary surface: security round). Base `dc44cc55d8adbd586e6741f2d3f15d5423fc9c25` (origin/main at run 2; the merge commit of PR 142; its first parent is a5d8e65, the commit the lane block requires; measured); branch `feat/p5-log-correlation`; worktree `.autopilot/worktrees/p5-log-correlation`; HEAD = base, nothing committed at step 0. Every `path:line` below was re-checked on disk at the base by S0c unless marked `(s0-decisions D<n>)`, which means taken from the decision record without re-opening. The session notes live outside the repo, so this file restates every fact it relies on.

Short forms: LC = `apps/web/lib/log-context.ts` and LCT = `apps/web/lib/log-context.test.ts` (both new); LG = `apps/web/lib/log.ts`, LGT = `apps/web/lib/log.test.ts`; AE = `apps/web/lib/api-envelope.ts`, AET = `apps/web/lib/api-envelope.test.ts`; SCR = `apps/web/lib/session-command-route.ts`, SCRT = `apps/web/lib/session-command-route.test.ts`; TL = `apps/web/lib/tenant-lang.test.ts`; ST, CB, CO = `apps/web/app/api/auth/google/{state,callback,complete}/route.ts`; OC, OR, OS, OZ, OZC = `apps/web/app/api/onboarding/{club,readiness,start,zalo,zalo/connect}/route.ts`; each of the 9 handlers has its existing `route.test.ts` beside it; BL = `docs/autopilot-backlog.md`; N = the session notes folder (outside the repo).

## 1. Authority

- The owner's written approval of 2026-10-28 of the plan `docs/sessions/web-mvp-phase5-golive-plan.md` (the approval text is held outside the repo until lane L79 records it as a DD): "Phase 5 plan approved. Q1, Q2, Q4-Q10 default. ... Raise the run caps of L65, L68 and L74 to 6." It starts Phase 5; lane L68 runs under it with a run cap of 6.
- Conductor rulings, each "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature" (Tier B, reversible):
  - RO-L68-1 (`N/CONDUCTOR-HANDOFF-run1.md`:18-24): one agent at a time, code-reviewer units on opus; database, e2e, Playwright, next build/start and golden-path runs by the orchestrator only, through `N/scripts/locked-run.sh`; no secret in a log, ever: every test that pins a log line seeds recognizable fakes; GitNexus impact before handleSessionCommand or any route handler, its risk named here, and detect_changes before every commit; ONE catch-up merge before ONE push, no AI attribution; stop on a 429, a usage limit or "Not logged in".
  - RO-L68-2 (`N/CONDUCTOR-HANDOFF-run2.md`:14-18): item 1, one request id per request: AE and AET join the ownership for that purpose only (when a log context is active, `meta.requestId` is its id; otherwise the current `req_<uuid>`; the body's shape unchanged; one test pins body = header = log line); item 2, (a) parseLogLevel's own-property fix with a test, (b) code and comment agree on the callback and complete error logging, (c) keep every redaction main has; item 4, the binding rules restated.
- Decisions: s0-decisions D1-D12 (the orchestrator, run 2, 2026-10-29 14:25 +0700, at the base above; Tier A or B per level3 §6.1; every one reversible inside the lane's own files), restated in section 4.
- GOAL (the lane block, as-is): every log line written while serving the session-command family, the Google auth routes (state, callback, complete) and the onboarding routes carries `request_id` and `tenant_id` (when known) through ONE AsyncLocalStorage context (LC, ported from PR 50 rows 11-15 with edits) and the existing logger LG; an incoming request-id header that does not match the accepted form is replaced by a generated id; the response carries `x-request-id`; no secret, token, handoff, cookie, OAuth code or PII ever reaches a log line (a test pins it); the callback and complete routes log the error class of a failure they swallow today without its secret-bearing detail; LOG_LEVEL's existing reader is re-measured and the stale backlog row gets its dated note; no vendor is added.
- Scope: the files of section 9, and nothing else.
- Negative scope (the lane block's NEGATIVE SCOPE, as-is): no second logger or log transport; no vendor SDK; no change of what a route returns except the added `x-request-id` header; no logging of request bodies, headers other than the request id, cookies, tokens, codes, handoffs, emails, names or phone numbers; no behavior change in auth or onboarding beyond logging. From the lane block's FILE OWNERSHIP: not `apps/web/lib/session-cookies.ts`, not `next.config.mjs`, not `apps/web/middleware.ts`, never `apps/web/lib/dev-login/`, no migration, no workflow, no App Spec, no new dependency. Added at step 0: `apps/web/lib/club-config-route.ts`, `apps/web/lib/request-policy.ts`, `apps/web/lib/google-oidc.ts`, `apps/web/middleware.ts` and everything under `apps/web/lib/dev-login/` stay untouched.

## 2. Measured at base

### 2.1 Wrapping points and where a tenant is proven

- SCR:848-866 `handleSessionCommand(request, rateLimit, handler, options)`: :854 `resolveSessionCommandContext(...)`, :855 `if (context instanceof Response) return context;`, :857 `runWithLang(context.lang, ...)`, :860-862 `mapSessionCommandError` or rethrow. `resolveSessionCommandContext` (:242) reads the raw `?tenant=` at :255 and returns a context only once the caller is proven to belong to that tenant (S0a §4a).
- The onboarding routes call `resolveClubGate` (in `apps/web/lib/club-config-route.ts`, outside the ownership) and early-return its Response: OC:37 and :38 (GET), OC:47 and :48 (PATCH), OR:25 and :26, OZ:12 and :17, OZC:72-76 and :77. The proven tenant is `gate.tenantId` (OC:40, OR:27, OZ:19, OZC:173). OS provisions the tenant: `const tenantId = await provisionTenant(...)` at :96-102, then `issueSession` at :104.
- The auth routes have no tenant: ST:34, CB:51 and CO:44 serve a request before or during sign-in.

### 2.2 The logger, the envelope and the inventory

- LG (109 lines, zero imports): `LEVELS` :17; `REDACT_KEY` :21, kept in full including the gender alternative that LGT:41-50 pins (s0-decisions D4); `parseLogLevel` :24-26 tests `v in LEVELS`, which accepts inherited keys such as `__proto__` (s0-decisions D5); `currentLevel()` :29 reads LOG_LEVEL per call at :30, the only reader (s0-decisions D11); `sanitizeFields` :58 reduces an Error to `name` (:74, 64 chars), `message` (:75, 256 chars), a string `code` (:77) and, at debug only, `stack` (:79, 2048 chars); `emit` :91; `export const log` :104.
- Edge: `apps/web/middleware.ts` (Edge) requires `lib/dev-login/routing.ts` in development bundles, and routing.ts imports `{ log } from "../log"` (s0-decisions D3; the import re-seen in S0c's grep). LG must keep zero imports.
- AE (53 lines): `import { randomUUID } from "node:crypto"` :1; `ok` :20 and `err` :36 both write `meta: { requestId: req_${randomUUID()} }` (:25, :49). The user sees that id as the reference code of an error notice (`apps/web/components/sessions/api-error-notice.tsx`:53-55, s0-decisions D9).
- TL: `SURFACE_BUCKETS` :113; `"lib/api-envelope.ts": "c"` :210; `"lib/log.ts": "c"` :228. The lib discovery (:321-322) keeps `*.ts` and drops `*.test.ts`; :340 rejects an unclassified file and :345 a stale key, so LC needs one entry and LCT must have none.
- Response mutability (s0-decisions D10, re-checked): CB:64, CB:222, ST:105 and `apps/web/lib/request-policy.ts`:131 build `new Response(...)`; `ok()` and `err()` use `Response.json`; `Response.redirect` and `NextResponse` occur 0 times in the 9 handlers, SCR, AE and request-policy.ts.
- Log observation in tests: no target test mocks the log module; only OZC's test spies on `console.error` (its :229). New cases spy on `console` and run the real logger.

### 2.3 The swallowing catches (D7 sites) and the catches that stay as they are

- CB:54-62: the outer catch logs `log.error("auth.google.callback.unhandled", { error })`; its comment (:60-61) says the logger keeps name and message. CB:145: `catch { return fail("AUTH_INVALID"); }` (a tampered or corrupt state ciphertext). CB:183: `catch (error)` returns `fail("AUTH_INVALID")` for an `InvalidEmailError` and rethrows anything else to :54.
- CO:47-50: the outer catch logs `log.error("auth.google.complete.unhandled", { error })` under a comment (:49) that says "Logged by class only", untrue at base because LG writes the message (and the stack at debug). CO:83: `catch { limited = true; }` (limiter store down). CO:112: `catch { return fail(); }` (malformed body).
- ST:46: `catch { limited = true; }` (limiter store down).
- OZC:173: `log.warn("zalo_setwebhook_failed", { tenantId: gate.tenantId, error })`. OZC:60-69 `sanitizedConnectError`: `name` cut to 64 chars (`typeof error` for a non-Error) and the first string `code` on the cause chain that matches `/^[0-9A-Z_]{1,32}$/` within 8 hops; used at OZC:217 `throw sanitizedConnectError(error)`.
- Not D7 sites, unchanged: CO:128 (`SessionReauthRequiredError` returns `fail()`, anything else is rethrown to :47), OZC:48, :92, :115, :130 and :196.

### 2.4 Callers (paired with GitNexus in section 6)

- `handleSessionCommand`: 19 non-test caller files at base besides SCR (`git grep -l`): 15 under `apps/web/app/api/sessions/`, 3 under `apps/web/app/api/join-requests/`, and `apps/web/lib/session-guest-note-route.ts`.
- `log` (LG): 16 non-test importer files at base, every one `import { log }` (13 `.ts`, 3 `.tsx`).
- AE: 58 non-test importer files at base, all route files or server lib modules (no `.tsx`).

## 3. Lead corrections and recorded differences

1. LG importers: 16 at base (2.4), not the 12 the step-0 brief carried; the measurement wins. Nothing else changes: LG's change is additive.
2. AE importers: 58 at base; RO-L68-2 item 1's "54 importers" is GitNexus's `err` direct-caller count on the older index. Risk and mitigation unchanged (section 6).
3. RO-L68-2 item 2(c) speaks of PR 50's "2 SURFACE_BUCKETS lines" (S0a §6: PR 50 inserts two lines after TL:228). s0-decisions D8 adds exactly one, the entry, consistent with the lane block's "the SURFACE_BUCKETS entry only"; TL:321-322 and :345 forbid an entry for LCT. Narrower than the ruling, never wider.
4. RO-L68-2 item 2(c) "port only the 7 log.ts lines": D4 ports only PR 50's context lines; D3 replaces PR 50's import of log-context by a registration hook (Edge safety, measured); D5 (ruling item 2(a)) and D7's moved helper add lines that are not from PR 50, all inside LG.
5. RO-L68-1 item 3 and RO-L68-2 item 2(b) allow the class plus a bounded, sanitized message; D7 logs the class only, the stricter subset, chosen for the security round.
6. S0b RD1 ("never adopt an inbound id") is rejected by D2: the lane block pins adoption of a matching header.
7. CO:49's comment is untrue at base; under D7 it becomes true (code and comment agree, ruling item 2(b)).

## 4. Decisions (s0-decisions D1-D12, restated)

| # | Tier | Decision |
|---|---|---|
| D1 | A | LC is PR 50's AsyncLocalStorage core (`als.run`, never `enterWith`) with edits: no `do-request-id`, the M5/staging comment rewritten, ONE wrapper `withRequestLogContext(request, run)` used by the 9 handlers and by handleSessionCommand. Exports at most the wrapper, `currentRequestId()`, `setLogTenant(id)` and `newRequestId()`. merged_probe `withRequestLogContext` (0 hits at base). |
| D2 | A | The inbound `x-request-id`, trimmed, is adopted iff it matches `/^[A-Za-z0-9._-]{8,64}$/`; otherwise `newRequestId()` = `req_` + `randomUUID()` (AE's exact format). Table 5.1. |
| D3 | B | LG keeps zero imports; it gains `setLogContextReader(fn)` (about 4 lines) and LC registers its reader when it is evaluated. LG importing LC is rejected: it would put node:async_hooks into the dev Edge middleware bundle. |
| D4 | B | LG `emit` writes `request_id` and `tenant_id` after `...sanitizeFields(fields)`, so no caller field overrides them; `tenant_id` is omitted when unproven; `REDACT_KEY` kept in full. PR 50's log.ts and tenant-lang.test.ts are not copied. |
| D5 | B | LG:26 `v in LEVELS` becomes `Object.hasOwn(LEVELS, v)`; LGT gains `__proto__` and `constructor` cases expecting "info"; that red test runs on base before the fix and its output is recorded. |
| D6 | B | `tenant_id` only where proven, through `setLogTenant(id)` (a no-op outside a context). Table 5.2. |
| D7 | B | Auth and onboarding error logging is class only: the error's `name` and a string `code`, never `message`, never `stack`, never the request. OZC's `sanitizedConnectError` moves to LG as one exported helper used at its original site and at the auth sites (a route file may export only route fields). Table 5.3. |
| D8 | A | TL gains exactly one line, `"lib/log-context.ts": "c",` right after :228; nothing else in TL changes. |
| D9 | A | AE writes `meta: { requestId: currentRequestId() ?? newRequestId() }` at :25 and :49; its node:crypto import goes; the body's shape is unchanged. |
| D10 | B | The wrapper sets `x-request-id` in place on every Response the wrapped handler returns (2xx, the gates' early 401/403/429, the auth 302s and HTML); a rethrown error gets no header (Next's 500, unchanged). No immutable-header fallback: a `ponytail:` comment names the ceiling. |
| D11 | A | BL: dated notes on `observability-sentry-loglevel-readers` and `request-id-log-context-auth-onboarding`; at most 3 new rows at the END (section 14). |
| D12 | A | Tests: section 7. |

## 5. Decision tables

### 5.1 The request id (D2)

| Inbound `x-request-id` | Example | Result | Body `meta.requestId` (envelope responses) | `x-request-id` header | Log line `request_id` |
|---|---|---|---|---|---|
| absent | no header | replaced | a generated `req_<uuid>` | the same generated id | the same generated id |
| valid | exactly 8 chars `abcd-123`; exactly 64 chars; `trace.ID_42-xyz` | adopted as sent | the inbound value | the inbound value | the inbound value |
| CR or LF | `abcdefgh\r\nset-cookie: a=b` | replaced | generated | generated | generated |
| a quote | `abcd"efgh` | replaced | generated | generated | generated |
| 7 chars | `abcdefg` | replaced | generated | generated | generated |
| 65 chars | `"a".repeat(65)` | replaced | generated | generated | generated |
| whitespace-padded valid | `  abcdefgh  ` | trimmed, then adopted as `abcdefgh` | `abcdefgh` | `abcdefgh` | `abcdefgh` |
| empty or whitespace-only (derived) | `""`, `"   "` | replaced | generated | generated | generated |
| two headers (derived) | `abcdefgh, ijklmnop` (`Headers.get` joins with a comma and a space) | replaced: a space fails the form | generated | generated | generated |

In every row the body (when the response is an `ok()` or `err()` envelope), the header and the log line carry the SAME id. The auth 302s and the callback's HTML landing have no envelope: the header and the log line only. A real `Headers` object refuses CR, LF and NUL in a value (undici throws a TypeError), so the CR/LF row is tested with a stub request whose `headers.get` returns the raw string; every other row uses a real `Request`. The form admits no quote, backslash, space, CR or LF and at most 64 chars, and LG JSON-encodes every line, so an adopted id cannot inject into the header or the log line.

### 5.2 `tenant_id` (D6)

| Route (handler) | `setLogTenant` right after | Value |
|---|---|---|
| session family: the 19 caller files through `handleSessionCommand` (SCR:848) | SCR:855 `if (context instanceof Response) return context;`, before `runWithLang` at :857 | the tenant of the returned context, proven by `resolveSessionCommandContext` (S0a §4a); never the raw `?tenant=` read at SCR:255 |
| OC GET (:36) | OC:38 | `gate.tenantId` |
| OC PATCH (:46) | OC:48 | `gate.tenantId` |
| OR GET (:23) | OR:26 | `gate.tenantId` |
| OZ GET (:11) | OZ:17 | `gate.tenantId` |
| OZC POST (:71) | OZC:77 | `gate.tenantId` |
| OS POST (:32) | OS:102, the end of `const tenantId = await provisionTenant(...)` (:96-102), before `issueSession` at :104 | the id `provisionTenant` returned |
| ST GET (:34) | never | none: the request comes before sign-in, no tenant exists for it, and a `?tenant=` or any other client input is never a source |
| CB GET (:51) | never | none (as ST) |
| CO POST (:44) | never | none (as ST) |

Every line logged before the point in the second column, and every line of the three auth routes, has no `tenant_id` key at all (D4: omitted when unproven). A gate's early 400/401/403/429 is unproven: header yes, `tenant_id` no.

### 5.3 Error logging (D7)

| Site | Event, level | Today | After | Seeded fakes the test proves absent |
|---|---|---|---|---|
| CB:62 | `auth.google.callback.unhandled`, error (kept) | name, message, code; stack at debug | name, code | a fake OAuth `code` and `state` (the callback URL's query) and a fake state cookie, in the thrown error's message |
| CB:145 | new `auth.google.callback.state_invalid`, warn | nothing | name, code | a fake state value and a fake state-cookie ciphertext, in the decrypt error's message |
| CB:138 | new `auth.google.callback.secret_unavailable`, error (the key resolution, in its own try ahead of the decryption's: an outage, not bad input, so error although handled) (RO-L68-7) | nothing | name, code | a fake OAuth `code`, state, state cookie, PKCE ciphertext and email, in the resolver error's message |
| CB:183 | new `auth.google.callback.email_invalid`, warn (the `InvalidEmailError` branch only; the rethrow still reaches :62) | nothing | name, code | a fake email address and a fake OAuth code, in the `InvalidEmailError`'s message |
| CO:50 | `auth.google.complete.unhandled`, error (kept); the :49 comment becomes true | name, message, code; stack at debug | name, code | a fake handoff and a fake session cookie, in the thrown error's message |
| CO:83 | new `auth.google.complete.limiter_unavailable`, warn | nothing | name, code | a fake handoff and a fake client IP (the limiter key is `oauth-complete:<ip>`), in the store error's message |
| CO:112 | new `auth.google.complete.body_invalid`, warn | nothing | name, code | a fake handoff (the body's content), in the read error's message |
| ST:46 | new `auth.google.state.limiter_unavailable`, warn | nothing | name, code | a fake client IP (the key is `oauth-state:<ip>`) and a fake cookie, in the store error's message |
| OZC:173 | `zalo_setwebhook_failed`, warn (kept) | `tenantId`; name, message, code; stack at debug | `tenantId`; name, code | a fake bot token, a fake webhook URL token and a fake webhook secret, in the setWebhook error's message |

Rules for every row: `name` is the error's name cut to 64 chars (`typeof error` for a non-Error) and `code` is the first string code on the cause chain matching `/^[0-9A-Z_]{1,32}$/` within 8 hops, omitted when there is none: the moved helper keeps OZC:60-69's walk and bounds. The line keeps the existing `error` key as `{ name, code }` (today's shape without `message` and `stack`); a site never passes the error object itself, because LG:75 would write its message and LG:79 its stack at debug, and a stack starts with the message. Each case asserts on `JSON.stringify` of every console spy's calls, at the default level and again with `LOG_LEVEL=debug` stubbed (LG:30 reads it per call). OZC:217's rethrown message stays byte-identical (`zalo_connect_failed: <name>[ <code>]`), built from the same helper. The new event names are Tier A naming inside each route's existing namespace. Levels follow precedent: a handled, swallowed failure at warn (OZC:173), an unhandled one at error (CB:62, CO:50).

## 6. GitNexus risk

Index at `e049c9269554d72c60b21b8c1ecc5329c5cbcf1d` (indexed 2026-10-22), behind the base, so each result is paired with a grep at the base (2.4).

| Symbol | GitNexus impact (upstream) | Grep at base | Risk | Mitigation |
|---|---|---|---|---|
| `handleSessionCommand` (SCR:848) | 17 direct callers, 14 processes | 19 non-test caller files | CRITICAL | D6, D10: the wrap adds only the context, the tenant setter and the header; the arguments, the early-return order (:854-855), `runWithLang` (:857) and `mapSessionCommandError` (:860-862) are unchanged; every caller's existing tests stay green; `pnpm -w test` on the final head (A-17) |
| `ok` (AE:20) | 50 direct, 39 processes, 5 modules | 58 non-test importer files of AE | CRITICAL | D9: outside a context the output is the same fresh `req_<uuid>` per call (AET :31 and :64 stay green); inside a context the context's id; the body's shape unchanged; one test pins body = header = log line (A-12) |
| `err` (AE:36) | 54 direct, 43 processes, 8 modules | the same 58 files | CRITICAL | as `ok` |
| `emit` (LG:91) | 4 direct (the four `log` methods) | none needed | LOW | D4: additive fields after sanitize; no existing assertion enumerates headers or `toEqual`s a whole log line (S0b §2) |
| `log` (LG:104) | member calls not tracked by the index | 16 non-test importer files | LOW | additive; LG keeps zero imports (D3, A-9), so its 3 `.tsx` importers are unaffected whatever they bundle for |
| the 9 handlers (ST, CB, CO, OC GET and PATCH, OR, OS, OZ, OZC) | framework entry points | Next's router and their own tests | LOW | the header only (D10); behavior unchanged (negative scope) |

The orchestrator re-runs `impact` (upstream) on the current index before W1 edits AE, before W2 edits handleSessionCommand and before W3 edits each handler, and runs `detect_changes` before every commit (RO-L68-1 item 4, RO-L68-2 item 4).

## 7. Acceptance matrix (A-1..A-20; expected results)

| # | Test or command | Expected | Decision | Who |
|---|---|---|---|---|
| A-1 | LCT: inbound ids of exactly 8 and exactly 64 chars of the form | adopted: `currentRequestId()` inside `run` returns the inbound value | D2 | W1 |
| A-2 | LCT: absent, CR/LF (stub request), a quote, 7 chars, 65 chars, empty or whitespace-only, two joined headers | each replaced: the id matches `/^req_[0-9a-f-]{36}$/` and differs from the inbound value | D2 | W1 |
| A-3 | LCT: `  abcdefgh  ` | adopted as `abcdefgh` | D2 | W1 |
| A-4 | LCT: propagation | the same id after an `await` (a timer and a promise) inside `run`; two overlapping runs keep their own ids (no bleed: the reason for `als.run`, never `enterWith`) | D1 | W1 |
| A-5 | LCT: outside a context | `currentRequestId()` is undefined; `setLogTenant(id)` sets nothing and throws nothing; no context remains after `run` resolves | D1, D6 | W1 |
| A-6 | LCT: the reader and the header | a line logged inside `withRequestLogContext` carries `request_id`; the wrapper sets `x-request-id` on the Response that `run` returns | D3, D10 | W1 |
| A-7 | LGT: context fields | `request_id` and `tenant_id` passed as caller fields do not override the context's; no `tenant_id` key when unproven | D4 | W1 |
| A-8 | LGT: `parseLogLevel("__proto__")` and `parseLogLevel("constructor")` | "info"; the red run on base recorded before the fix | D5 | W1 |
| A-9 | `grep -c '^import' apps/web/lib/log.ts` | 0; LGT:41-50 (the gender redaction) green | D3, D4 | W1 |
| A-10 | AET | outside a context `ok()` and `err()` write a fresh `req_<uuid>` per call (:31 and :64 green); inside a context the context's id; the body's keys unchanged | D9 | W1 |
| A-11 | TL | the inventory test green with the one added line; no key for LCT | D8 | W1 |
| A-12 | SCRT: one wrapped request with a valid inbound id | body `meta.requestId` = header `x-request-id` = the log line's `request_id`; a line logged after SCR:855 carries the proven tenant; an early 401 (no session) has the header and no `tenant_id`; no seeded fake in any console call | D6, D9, D10, D12 | W2 |
| A-13 | the ST, CB and CO tests | every response (302, HTML landing, JSON) carries `x-request-id`; no line carries `tenant_id`; no seeded fake in any console call | D6, D10, D12 | W3 |
| A-14 | the 9 sites of table 5.3, one case each in its route's existing test | the site's event with `name` and `code` only; none of the row's seeded fakes, at the default level and at debug | D7 | W3 |
| A-15 | the OC, OR, OS, OZ and OZC tests | `tenant_id` on lines after the table 5.2 point and on none before; a gate's early return carries the header; OZC:217's rethrown message byte-identical | D6, D7, D10 | W3 |
| A-16 | LGT: the moved helper | `name` cut to 64; `code` from the cause chain (8 hops, the form); a non-Error described by its type; no message in the output | D7 | W3 |
| A-17 | existing tests | every existing route test and SCRT green per writer; `pnpm -w test` once on the final head through the lock | all | each writer; the orchestrator |
| A-18 | `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm review:check:changed` | green before every commit; `pnpm review:check` green at the end | none | each writer; the orchestrator |
| A-19 | the lane's final-checks.sh | B3 logged (section 9), attribution 0, closing keywords 0, porcelain clean, the file list within section 9 | none | the orchestrator |
| A-20 | the LOCAL golden path once on the final head through the lock | PASS, or an honest NOT RUN with the dev-login probe facts (never a workaround) | none | the orchestrator |

## 8. Slice plan for run 3

One writer at a time (opus), in this worktree, staging per file (never `git add -A`), committing in the worktree, then handing back. Each writer self-verifies with `pnpm --filter web exec vitest run <its files>`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm review:check:changed`, and runs GitNexus-free (the orchestrator runs `impact` before and `detect_changes` after each writer). Writers never run database, e2e, Playwright, next build/start or golden-path commands; a test that needs the database is run by the orchestrator through the lock. A writer stops at about 200k context or about 80 tool calls with its work committed (or the exact uncommitted state recorded) and a handoff in N.

- W1, the logger module (A-1..A-11): D5's red test first (its output on base recorded), then the `Object.hasOwn` fix; LC and LCT (D1, D2, D12, and D10's header set inside the wrapper); LG and LGT (the D3 hook, the D4 fields); the TL line (D8); AE and AET (D9).
- W2, the session family (A-12): the `handleSessionCommand` wrap, `setLogTenant` right after SCR:855, and SCRT (D6, D10, and D9's body = header = log line test).
- W3, the route wrappers (A-13..A-16): the 9 handlers wrapped (D10); `setLogTenant` per table 5.2 (D6); the 8 sites of table 5.3 and the helper's move from OZC:60-69 to LG with its LGT case, in one commit together with OZC's new import (D7); the route tests; BL's two dated notes and at most 3 rows (D11).

## 9. Budget (B3) and files

The lane block estimates about 300 changed lines in 3 modules, 0 migrations. Step-0 estimate per file (changed = added + deleted): `*.test.ts` = test; `*.md` = docs, outside the caps; everything else = non-test.

| File | A/M | Needed by | Class | Estimate |
|---|---|---|---|---|
| `apps/web/lib/log-context.ts` | A | D1, D2, D10 | non-test | ~55 |
| `apps/web/lib/log-context.test.ts` | A | A-1..A-6 | test | ~90 |
| `apps/web/lib/log.ts` | M | D3, D4, D5, D7's helper | non-test | ~30 |
| `apps/web/lib/log.test.ts` | M | A-7, A-8, A-16 | test | ~45 |
| `apps/web/lib/api-envelope.ts` | M | D9 (ruling RO-L68-2 item 1 only) | non-test | ~6 |
| `apps/web/lib/api-envelope.test.ts` | M | A-10 (ruling RO-L68-2 item 1 only) | test | ~12 |
| `apps/web/lib/tenant-lang.test.ts` | M | D8: the one SURFACE_BUCKETS line | test | 1 |
| `apps/web/lib/session-command-route.ts` | M | D6, D10 | non-test | ~10 |
| `apps/web/lib/session-command-route.test.ts` | M | A-12 | test | ~55 |
| ST, CB, CO `route.ts` | M | D7, D10 | non-test | ~38 (8, 16, 14) |
| ST, CB, CO `route.test.ts` | M | A-13, A-14 | test | ~88 (18, 35, 35) |
| OC, OR, OS, OZ, OZC `route.ts` | M | D6, D7 (OZC), D10 | non-test | ~50 (10, 6, 6, 6, 22) |
| OC, OR, OS, OZ, OZC `route.test.ts` | M | A-15 | test | ~66 (16, 10, 12, 10, 18) |
| `docs/autopilot-backlog.md` | M | D11: two dated notes, at most 3 rows at the END | docs | ~40 |
| `docs/sessions/web-mvp-phase5-readiness-p5-log-correlation.md` | A | this file | docs | measured at commit |

Files to create: `apps/web/lib/log-context.ts` and `apps/web/lib/log-context.test.ts` (plus this file). Every other file in the table exists at the base and is listed in TARGET_FILES.

Totals: about 190 non-test and about 360 test lines, about 550 code lines in 3 modules (the log context: LC, LCT; the logger and the envelope: LG, LGT, AE, AET and TL's line; the route wrappers: SCR, SCRT and the 9 handlers with their tests), plus about 40 docs lines and this file outside the caps; 0 migrations. The lane block's 300 will be overrun (about 1.8 times): logged with its design reason, not a stop. The estimate predates three things: ruling RO-L68-2 item 1 adds AE and AET (one request id per request); D7 adds class-only lines at 8 sites, each pinned by its own case with seeded fakes (the GOAL's "log the error class of a failure they swallow today" and RO-L68-1 item 3: every test that pins a log line seeds fakes); one seeded-secret test per family (D12). This is a property of the contract, not of a slice; the non-test code, about 190 lines, stays inside the lane's 300. A second overrun on the same cause is a design signal (re-slice), not more lines.

## 10. Verification and review

- TESTS (the lane block): log-context unit tests (the accepted form, the replacement, the propagation through await); a test per wrapped family that the log line carries `request_id` and `tenant_id` and that a seeded secret value never appears; the existing route tests green; tenant-lang's inventory test green; `pnpm -w test` once on the final head through the lock; `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm review:check:changed` before every commit and the full `pnpm review:check` at the end; the LOCAL golden path once on the final head through the lock by the orchestrator (a NOT RUN for the dev-login probe recorded honestly, never worked around).
- ACCEPTANCE COMMANDS (the lane block): the commands of TESTS; the lane's final-checks.sh (B3, attribution 0, closing keywords 0, porcelain, file list = ownership); GitNexus impact before editing handleSessionCommand, AE (ruling RO-L68-2 item 4) and each route handler, and detect_changes before every commit.
- REVIEW PLAN (the lane block): ONE opus reviewer role, at most 3 rounds counting pre-push rounds (C16), plus ONE security round (opus) on the final diff before the push: no secret, token, code, handoff, cookie or PII in any log line; the request-id header cannot inject (form, length, replacement); no auth behavior change. The reviewer checks tables 5.1-5.3 line by line against the diff.
- The L44 last-round policy: in the last round, a P3 or lower = a docs- or comment-only fix labelled "fix applied after the final round, not re-reviewed (3-round cap)"; a P1 or P2 or any code change = `N/RQ-L68-R3.md` and RESULT: AWAIT.
- The push: ONE catch-up merge before the ONE push (never a rebase, never a force push); the PR body follows P9 and P10; no AI-attribution line; no closing keyword.

## 11. STOP conditions

- HALT if the diff leaves the file ownership (section 9), adds a vendor or a dependency, or logs a secret.
- A ruling request (`N/RQ-L68-<n>.md`) when a route needs a behavior change to be logged, or when a source cannot be found.
- D5's red test passes on base: the writer records the output and stops for the orchestrator (no fix lands without a red test).
- A classifier denial = `N/AWAIT-L68-classifier-denied.txt` with the exact commands, then RESULT: AWAIT (never a workaround).
- BLOCKED on 3 failed rounds.
- A 429, a usage limit or "Not logged in": stop with the CHECKPOINT current.

## 12. Known risk

- Two CRITICAL blast radii (section 6): handleSessionCommand's 19 caller files and AE's 58 importers. Both changes are additive (a context, a header, the same id format); A-10, A-12 and A-17 pin it.
- D9 gives AE an import of LC, so every bundle that holds AE also holds node:async_hooks. AE is imported only by route files and server lib modules (2.4) and already imported node:crypto at base (:1); the Edge chain s0-decisions D3 measured (routing.ts, gate.ts, env-policy.mjs, LG) does not contain AE.
- D3's registration: a line logged in a module graph where LC was never evaluated has no `request_id` (omitted, never wrong). Every wrapped route imports LC, and AE imports it (D9), so an envelope route always registers the reader; A-6 pins it.
- D10's ceiling: a future wrapped route that returns `Response.redirect()` or a `fetch()` response (immutable headers) would throw on the header set; such returns measure 0 today; the `ponytail:` comment names the upgrade (copy into a new Response).
- A `tenant_id` set before its proof would mislabel a line: table 5.2 pins each point; A-12 and A-15 assert "none before".

## 13. Open

`OPEN_QUESTIONS_IN_SCOPE: 0`. S0b's O1-O7 are closed by the decisions: O1 by D3, O2 by D9's grep, O3 becomes D5's red test, O4 is moot under D7, O5 by D10, O6 by D1, and O7 was read by S0a §1. Out of scope with the current behavior pinned (the backlog rows of section 14): the Edge request-id header; `apps/web/lib/google-oidc.ts`'s swallowed errors (:77-83, :192-195, s0-decisions D11); the raw `console.error` in `packages/db` (tenant.ts:192, auth.ts:321, s0-decisions D11).

## 14. Hard dependencies and backlog rows

- None (the lane block: DEPENDS ON none, plan §4). The base contains a5d8e65 as its first parent (measured, `git log -1 --format=%P`). Lane L72 is paused beside this lane: no shared file; the ONE DB/e2e lock is shared.
- BL (7917 lines at base): dated notes in place on `observability-sentry-loglevel-readers` (no code reads SENTRY_DSN; only LG:30 reads LOG_LEVEL; the prototype-key fix lands here, D5) and on `request-id-log-context-auth-onboarding` (landed by this lane; merged_probe `withRequestLogContext`, D1); neither row has a close_by field (S0b). At most 3 new rows at the END: (i) `apps/web/lib/google-oidc.ts` swallows (:77-83, :192-195) lose the error class; (ii) `packages/db` tenant.ts:192 and auth.ts:321 write raw `console.error`, bypassing LG and `request_id`; (iii) the Edge request-id header (adopt once a deploy measures it).

## 15. Closure matrix (12 of 12 PASS)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = HEAD = the base (measured, `git log -1`); every TARGET_FILES path exists at the base (`git ls-tree`) and the two new files do not | PASS |
| 2 | Decisions in scope final | the owner's approval of 2026-10-28; rulings RO-L68-1 and RO-L68-2; s0-decisions D1-D12 (section 4) | PASS |
| 3 | Scope IN/OUT and owner clear | section 9's files; section 1's negative scope; section 8's writer order | PASS |
| 4 | Dependencies classified | none hard (section 14); L72 beside (no shared file, the shared lock); the 3 backlog rows downstream | PASS |
| 5 | Live schema and code match | section 2 re-measured at the base; no schema, no migration | PASS |
| 6 | Data, API, state, auth contract | the request id (5.1), the tenant proof (5.2), the error class (5.3), the header (D10), the body's shape unchanged (D9) | PASS |
| 7 | Fail-closed, idempotency, order | a rejected id is replaced, never adopted (5.1); `tenant_id` omitted unless proven (5.2); class only, never a message or a stack (5.3); `als.run`, never `enterWith` (D1); context fields written after sanitize (D4) | PASS |
| 8 | Open questions in scope = 0 | section 13 | PASS |
| 9 | Acceptance matrix with expected results | section 7 (A-1..A-20) | PASS |
| 10 | Migration, security, rollback | no migration; ONE opus security round on the final diff (section 10); rollback = revert the PR | PASS |
| 11 | First slice hard dependencies merged | W1 depends on nothing unmerged (section 14) | PASS |
| 12 | Implementation handoff ready | sections 2, 4, 5, 7, 8 and 9; W1 has every input | PASS |

## 16. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-29
AUTHORITY_SHA: dc44cc55d8adbd586e6741f2d3f15d5423fc9c25
BASE_BRANCH: main
TARGET_FILES:
  - apps/web/lib/log.ts (edited: the D3 hook, the D4 fields, the D5 fix, the D7 helper)
  - apps/web/lib/log.test.ts (edited: A-7, A-8, A-16)
  - apps/web/lib/api-envelope.ts (edited: D9 at :25 and :49, ruling RO-L68-2 item 1 only)
  - apps/web/lib/api-envelope.test.ts (edited: A-10, ruling RO-L68-2 item 1 only)
  - apps/web/lib/session-command-route.ts (edited: the handleSessionCommand wrap and the tenant setter after :855)
  - apps/web/lib/session-command-route.test.ts (edited: A-12)
  - apps/web/lib/tenant-lang.test.ts (edited: the one SURFACE_BUCKETS line after :228, D8)
  - apps/web/app/api/auth/google/state/route.ts (edited: the wrap, the site at :46)
  - apps/web/app/api/auth/google/state/route.test.ts (edited: A-13, A-14)
  - apps/web/app/api/auth/google/callback/route.ts (edited: the wrap, the sites at :62, :145 and :183)
  - apps/web/app/api/auth/google/callback/route.test.ts (edited: A-13, A-14)
  - apps/web/app/api/auth/google/complete/route.ts (edited: the wrap, the sites at :50, :83 and :112)
  - apps/web/app/api/auth/google/complete/route.test.ts (edited: A-13, A-14)
  - apps/web/app/api/onboarding/club/route.ts (edited: the wraps, the tenant setter after :38 and :48)
  - apps/web/app/api/onboarding/club/route.test.ts (edited: A-15)
  - apps/web/app/api/onboarding/readiness/route.ts (edited: the wrap, the tenant setter after :26)
  - apps/web/app/api/onboarding/readiness/route.test.ts (edited: A-15)
  - apps/web/app/api/onboarding/start/route.ts (edited: the wrap, the tenant setter after :102)
  - apps/web/app/api/onboarding/start/route.test.ts (edited: A-15)
  - apps/web/app/api/onboarding/zalo/route.ts (edited: the wrap, the tenant setter after :17)
  - apps/web/app/api/onboarding/zalo/route.test.ts (edited: A-15)
  - apps/web/app/api/onboarding/zalo/connect/route.ts (edited: the wrap, the tenant setter after :77, the site at :173, the helper moved out of :60-69)
  - apps/web/app/api/onboarding/zalo/connect/route.test.ts (edited: A-14, A-15)
  - docs/autopilot-backlog.md (edited: two dated notes, at most 3 new rows at the end, D11)
  - apps/web/lib/club-config-route.ts (read-only: resolveClubGate, untouched)
  - apps/web/lib/request-policy.ts (read-only: the redirect helper at :131, untouched)
  - apps/web/lib/google-oidc.ts (read-only: backlog row i, untouched)
  - apps/web/middleware.ts (read-only: the Edge importer chain of D3, untouched)
  - apps/web/components/sessions/api-error-notice.tsx (read-only: the reference code shown to the user, D9)
FILES_TO_CREATE: apps/web/lib/log-context.ts, apps/web/lib/log-context.test.ts (plus this readiness file)
SLICE: p5-log-correlation
IN_SCOPE: one AsyncLocalStorage request log context (apps/web/lib/log-context.ts and its test) with one wrapper used by handleSessionCommand and the 9 auth and onboarding handlers; request_id and tenant_id on log lines (apps/web/lib/log.ts); one request id per request in the envelope (apps/web/lib/api-envelope.ts); the x-request-id response header; class-only error logging at the 8 sites of table 5.3; the parseLogLevel own-property fix; one SURFACE_BUCKETS line; two backlog notes and at most 3 backlog rows; this readiness file
OUT_OF_SCOPE: a second logger or log transport; a vendor SDK or any new dependency; any change of what a route returns except the x-request-id header; logging request bodies, headers other than the request id, cookies, tokens, codes, handoffs, emails, names or phone numbers; any behavior change in auth or onboarding beyond logging; apps/web/lib/session-cookies.ts; apps/web/next.config.mjs; apps/web/middleware.ts; apps/web/lib/dev-login/; apps/web/lib/club-config-route.ts; apps/web/lib/request-policy.ts; apps/web/lib/google-oidc.ts; migrations; workflows; App Specs
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none (root dependency: the lane block's DEPENDS ON none; the base contains a5d8e65 as its first parent, measured)
PRIOR_SLICES: none (PR 142, docs, is in the base)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration; ONE opus security round on the final diff (section 10); rollback = revert the PR
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 - add the __proto__ and constructor cases to apps/web/lib/log.test.ts, run pnpm --filter web exec vitest run lib/log.test.ts on the base and record its red output (D5), change log.ts:26 to Object.hasOwn(LEVELS, v), then continue with log-context.ts and its test, the log.ts hook and fields, the tenant-lang line and api-envelope (section 8); run pnpm typecheck, pnpm lint, pnpm format:check and pnpm review:check:changed; commit in the worktree
REMAINING_BLOCKERS: none
```
