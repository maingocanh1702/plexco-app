<!-- review-readiness: code-ready -->

# Step-0 readiness: L49 p4-web-command-id-persistence (session P4-S5b)

> Agent-facing. Step-0 readiness readers RA (Q1 the keeper and its users), RB (Q2-Q3 the server contract and the replay proofs), RC
> (Q4, Q7 the e2e harness, the browser targets and the unit-test rules), RD (Q5-Q6 apiFetch, the focus pattern and the conflict copy), all
> opus, one live at a time (run 1). This file was written by the step-0 readiness-file writer (opus, run 2). Writers W1-W4 opus; the db case
> run by the orchestrator under the lane lock; the backlog rows (O-rows) by the orchestrator. Reviewers R1a, R1b and SEC opus, one after
> another (Claude subagents: the Web MVP program's named exception DD-122 D4), at most 3 rounds counting pre-push rounds. RISK: P2 with
> money (a client that can re-send a money command under a stale key; the security round is REQUIRED). Base
> `336e84e616e672cf3958320909cb1e2c6475c59a` (main, `git fetch origin main` FETCH_HEAD, the merge of PR #127, L46; migration tail 0074);
> branch `feat/p4-web-command-id-persistence`; worktree `.autopilot/worktrees/p4-web-command-id-persistence`; HEAD = base at step 0
> (measured). Every `path:line` below was MEASURED at the base on the source text by the step-0 readers, or by the orchestrator in run 2
> where marked (O). The readers' notes live outside the repo, so this file restates every fact it relies on. No tracked file was edited at
> step 0; no DB suite ran.

Short forms (all under `apps/web/lib/`): UCI = `use-command-id.ts`, URC = `use-roster-command.ts`, AC = `api-client.ts`, SEU =
`session-error-ui.ts`, SCR = `session-command-route.ts`; AEN = `apps/web/components/sessions/api-error-notice.tsx`. A bare `lib/...`,
`components/...`, `app/...` or `e2e/...` path is under `apps/web/`; a bare server file (`payment-manual.ts`, `payment-reversal.ts`,
`roster-service.ts`, `roster-money-shared.ts`, `session-service.ts`, `join-request-service.ts` and their `.test.ts`) is under
`packages/db/src/`. The STORE = the new `apps/web/lib/uncertain-command-id-session-store.ts`; the KEEPER = UCI; the HOOK = URC.

## 1. Authority

- **DD-150**: the owner's written approval of 2026-10-26 ("Phase 4 plan approved, Q1-Q10 default") of `docs/sessions/web-mvp-phase4-plan.md`,
  whose section 3 row L49 is this lane (the plan adds a security round for money lanes).
- **The two rows** (pre-existing contracts, closed BY HAND in the L37/L58 form): `## task: web-command-id-persistence-and-conflict-copy`
  (`docs/autopilot-backlog.md:6091`, P2, `_readiness: NOT_CODE_READY` "needs a scope decision: sessionStorage by intent"; it records a
  residual the owner accepted in round 3 of PR #53) and `## task: web-api-client-timeout-and-refresh-notice-focus` (`:6109`, P2). The lane
  block's leads "about :6089 / :6107" are stale: the headings sit at :6091 / :6109 (O). Probes: `createUncertainCommandIdSessionStore` and
  `API_TIMEOUT_MS`, both bare identifiers ABSENT at the base (`git grep`, O), as are `CLIENT_TIMEOUT` and `useSessionPersonId`.
- **RO-L49-1** and **RO-L49-2**, each "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature" (Tier B,
  reversible). RO-L49-1: item 2 (database, e2e and local-server commands are run by the orchestrator only; the pre-authorized CI fallback for
  the browser leg), item 3 (main can move: re-fetch before the push), item 4 (the lane block's design defaults pre-approved Tier B; the
  decision table before any code, proved against the quoted server contract; a deliberate second payment of the SAME amount never reuses a
  persisted id), item 5 (B3 is an estimate; R1a, R1b and the mandatory SEC, each alone). RO-L49-2: item 1 (D1-D10 and the 16-row table
  ACCEPTED as written), item 2 (`useSessionPersonId` in `apps/web/lib/use-session.tsx`, ownership extended for that export only), item 3 (an
  OPT-IN focus prop on AEN, ownership extended by `apps/web/components/sessions/session-detail-view.tsx` for that one prop; one backlog row),
  item 4 (ONE test-only add-by-name replay case in `packages/db/src/roster-service.test.ts`, ownership extended; the orchestrator runs it),
  item 5 (the unresolved-attempt statement of section 3, confirmed), item 6 (up to 22 non-docs files; the new strings labelled; one row for
  the out-of-ownership conflict copies), item 7 (the write lesson).
- **No server rule changes**: no production `packages/db` change, no migration, no change of the dedup rule or of any command's behaviour; a
  change of what the server accepts or answers is a ruling request. Negative scope (lane block): no new dependency; no persisted body, token,
  name or amount (only an id, a hash and a time); no `localStorage`; no per-screen copy of the keeper logic; PR #50 untouched.
- Dependencies (O): L40 = PR #121 (merge `e1812aa5c56c6aea2da8d318f21b063f0de35b28`); L48 = PR #126 (merge
  `8e918f0ec541ef4f72740be652a3a86584d381c3`); every earlier lane merged (C20); the base is the merge of PR #127.

## 2. Measured at base

### 2.1 The server contract (measured at the base by step-0 reader RB)

- **Ledger**: `packages/db/migrations/0005_sync_engine.sql:8-18` creates `processed_commands` (`command_id text NOT NULL`, `command_type`,
  `result_hash`, `result_ref jsonb`, `created_at`, `UNIQUE (tenant_id, command_id)`); `packages/db/schema.ts:1517`
  `uq: uniqueIndex("processed_commands_tenant_cmd_uq").on(t.tenantId, t.commandId),`. Per tenant, shared by every command type; no actor
  column, no payload hash; `result_hash` is never written (writer `roster-money-shared.ts:152-153`).
- **Lookup**: an advisory xact lock on `'processed-command:' || tenant || ':' || commandId`, then a select on (tenant_id, command_id)
  (`session-service.ts:2814-2833`).
- **Dedup on commandId only (DD-117 D5)**: `roster-money-shared.ts:119-142` `replayOrNull`: `prior.commandType === commandType &&
  isStored(prior.stored) && prior.stored.sessionId === sessionId && prior.stored.actorPersonId === actorPersonId` returns the stored result,
  else `fail("COMMAND_ID_CONFLICT", ...)`; doc `:115` "Dedup (DD-117 D5: commandId-only)". So a 409 ALSO answers the SAME intent when
  `isStored` rejects its stored result (`:140` "or has no usable result"; create `session-service.ts:352-356` and update `:1357-1360` alike):
  a stored-shape change across a deploy, or a corrupt row (review R1a-1; row 4).
- **The 409 sites** (all exact): `payment-manual.ts:314` `return fail("COMMAND_ID_CONFLICT", "command_id belongs to a different player set");`;
  `payment-reversal.ts:100-101` (another allocation); `roster-service.ts:162-163` (add: another membershipId, only when the re-send carries
  one); `roster-service.ts:402-403` (remove: another player); `join-request-service.ts:229-230` (another join request); create
  `session-service.ts:354`; update `:1358`. HTTP status SCR:558 `["COMMAND_ID_CONFLICT", 409],`.
- **Same type + same target + another body = REPLAY**, the new body silently ignored: markPaid compares only the player-id SET
  (`payment-manual.ts:304-315`; the replay at :292 precedes validation :325-331); add by name is bound by session + actor only
  (`roster-service.ts:158-160`); reversal by allocationId only (`payment-reversal.ts:98-99`); update `session-service.ts:1328-1330` "returns
  the first result regardless of the patch"; create (test `session-service.test.ts:292` A3b). DD-117 D5 forbids content fingerprints on the
  server, so the client fingerprint is the ONLY guard against a changed-body replay.
- **Another person, same tenant**: roster, money and join commands answer 409 (actor-bound; `payment-manual.test.ts:378`,
  `roster-service.test.ts:235`); create/update REPLAY (no actor stored: `session-service.ts:138-143`, `:1232-1237`). **Another tenant**: a
  fresh command (the key and the lock include the tenant).
- **Authz precedes dedup**: `payment-manual.ts:271` requireActor before `:292`; a COMMITTED id can answer 403 or TENANT_SUSPENDED
  (`packages/db/src/session-commands-actor-recheck-under-lock.test.ts:313`), not the stored result.
- **HTTP `replayed`**: a replay is HTTP 200 `{data, error: null, meta}` (`lib/api-envelope.ts:19-28`) with `replayed: true` and zero writes.
  The mark-paid (:50), add (:57), reverse (:39) and approve (:43) routes carry `replayed: result.replayed,`; remove (:30) too. Create
  (`app/api/sessions/route.ts:41-43`) and update (`app/api/sessions/[id]/route.ts:44-46`, comment :23) do NOT forward it.
- **No retention**: no DELETE/TRUNCATE/prune of the ledger outside test cleanup (`lib/session-guest-note-route-db.test.ts:338`, `:528`);
  `session-service.test.ts:3834` `// processed_commands rows survive session deletion.` The server dedups indefinitely.
- **Two same-amount partial payments**: under a NEW id a new allocation (test `payment-manual.test.ts:541` pays 50000 twice: a1, a2); under
  the SAME id a replay, nothing written. No (player, amount) dedup. **Two "Minh" by name**: two persons, two memberships
  (`roster-service.ts:121-122`, test `roster-service.test.ts:212`), so a by-name re-send under a NEW id after an uncertain commit DOES
  duplicate the player.

### 2.2 Replay proofs per money command (RB)

Real DB: markPaid `payment-manual.test.ts:198` (batch, FULL-balance lines; `replayed: true`, counts unchanged); reversal `:541`; add by
membershipId `roster-service.test.ts:220`; remove `:481`; create `session-service.test.ts:518`; update `:3492`, `:3552`; the six host
commands `session-commands-actor-recheck-under-lock.test.ts:313`. The apps/web route tests mock `@plexco/db` (:6): not server proofs.
Gaps: **add BY NAME has no replay test** (closed by the O-db case, RO-L49-2 item 4); a partial-amount or different-amount markPaid replay
(the same code path as :198, untested); a reversal with another reason; a cross-person create/update replay (untested; those two commands
stay in-memory in this lane).

### 2.3 The client today (RA; the success-path facts O)

- The four money commands (all through the HOOK, tenant as `?tenant=`, `lib/sessions-api.ts:139`): mark-paid confirm POST
  `/api/sessions/{id}/mark-paid` body `{commandId, method, items:[{playerId, amount}], expectedTotal, note?}`; add POST `/players` body
  `{commandId, displayName}`; remove DELETE `/players/{playerId}` body `{commandId}`; reverse POST `/payments/{allocationId}/reverse` body
  `{commandId, reason}`. The preview is a read with its own random id (`lib/roster-payments-api.ts:75`, `:83-84`).
- KEEPER (61 lines): `createCommandIdKeeper(mint = () => crypto.randomUUID())` (:34-36), one in-memory `current = {id, payload, uncertain}`
  (:37); `if (current === null || current.payload !== payload) {` / `current = { id: mint(), payload, uncertain: false };` (:40-41); settle
  (:46-49) success drops, uncertain marks sticky, definite drops unless sticky; reset (:51-53) `current = null;`; hook (:59) `useState(() =>
  createCommandIdKeeper())`. The Zalo comment (:25-26): a secret-bearing caller calls `get()` without a payload.
- HOOK (77 lines): `const result = await call(id.get());` (:49) WITHOUT a payload; an uncertain failure is NEVER settled into the keeper
  (:55-56 `if (!isDefiniteFailure(e)) uncertain.current = true;` / `else if (!uncertain.current) id.settle(e);`); `setLocked(uncertain.current)`
  (:57), cleared on a 2xx (:52) and by `reset()` (:70-75).
- Cancel = an explicit `reset()`, the dialogs never unmount (`components/sessions/roster-tab.tsx:80-88`, `:143-184`): the mark-paid close
  effect (`mark-paid-sheet.tsx:59-69`), remove (`roster-remove-dialog.tsx:34-36`), reverse (`roster-reverse-dialog.tsx:41-45`), the add
  form's cancel (`roster-add-player-form.tsx:95-98`) and reopen (:111). `onAbandon` only in the add form (`roster-add-player-form.tsx:59`).
- Person id: in no prop and no ctx (`SessionApiContext` = `{tenantId, csrfToken}`, `lib/sessions-api.ts:116-119`); only through
  `useSessionContext()` (`lib/use-session.tsx:54`), which throws outside a provider (:56); `personId: string;` (`lib/session-dto.ts:13`);
  providers only `components/shell/app-shell.tsx:25` and `components/me/me-frame.tsx:33`. `components/sessions/roster-tab.test.tsx` renders
  RosterTab in LangProvider only (:65-70, 7 tests) and RosterTab renders all four hook users unconditionally (`roster-tab.tsx:80/:143/:157/:171`).
- Sign-out wipes only the list snapshots and the language (`components/shell/sign-out-button.tsx:22-23`); `lib/session-snapshot.ts` is the
  storage precedent (`defaultStorage` try/catch :17, key :25, injectable storage :31).
- Edit/new: bare refs, not payload-bound, not sticky, no lock (`edit-session-view.tsx:25/:91/:100`, `new-session-view.tsx:23/:48/:56`).
- (O) On success add/remove/reverse call `onAdded`/`onRemoved`/`onReversed(message)` (`roster-add-player-form.tsx:74-79`,
  `roster-remove-dialog.tsx:40-43`, `roster-reverse-dialog.tsx:54-58`) -> `roster-tab.tsx:60-63` `finished` = `setDone(message)` + the
  heading focus (:52-54, h2 `tabIndex={-1}` :76). The four client result types carry `replayed: boolean` (`lib/roster-payments-api.ts:28`,
  `:45`, `:69`, `:107`); no component reads it.

### 2.4 apiFetch (RD)

- AC forwards a caller signal (`ApiFetchInit extends Omit<RequestInit, ...>` :41, `...rest` :56, `fetch` :65), has no timeout, and every
  rejection becomes `ApiClientError(CLIENT_NETWORK_ERROR, "Network request failed", 0)` (:72-73); `response.json()` runs outside the try
  (:77-80): a body-read failure becomes CLIENT_BAD_RESPONSE. Codes :37-39.
- The caller-signal trap: three non-owned tests assert that fetch got EXACTLY the caller's signal (`lib/chat-api.test.ts:452/:463`,
  `lib/discover-api.test.ts:201/:208`, `lib/me-player-api.test.ts:290/:298`) and a caller timeout = CLIENT_NETWORK_ERROR status 0
  (`discover-api.test.ts:203-206`, `me-player-api.test.ts:292-295`): merging a caller signal breaks them.
- The 15_000 ms precedent: `request-inbox.tsx:35`, `chat-api.ts:31`, `discover-api.ts:12`, `me-player-api.ts:253`, `member-chat-gate.tsx:26`.
  The roster commands (`lib/roster-payments-api.ts:10-16`) and the session commands (`lib/sessions-api.ts:170-185`) pass no signal.
- CLIENT_NETWORK_ERROR means OFFLINE in six places: `discover-frame.tsx:23`, `request-inbox.tsx:148-149`, `lib/use-sessions-data.ts:178`,
  `lib/chat-error-ui.ts:117/:138/:193` (precedent `chat-api.ts:20` "a stalled server is not offline").
- `isDefiniteFailure` (SEU:202-206): not an ApiClientError or CLIENT_NETWORK_ERROR / CLIENT_BAD_RESPONSE (:204) -> false; else 400-499 (:205).
- The copy home is `describeSessionError` (SEU): CLIENT_NETWORK_ERROR (:128-135) t("Không có kết nối mạng. Kiểm tra mạng rồi thử lại.",
  "No connection. Check your network and try again."), action "retry"; the generic branch (:186-193) t("Đã có lỗi không mong muốn. Thử lại
  sau.", "Something unexpected went wrong. Try again later."); `ErrorAction` (:15).

### 2.5 Focus (RD; the prop-name fact O)

- House pattern: a counter, a ref on a `tabIndex={-1}` wrapper, `useEffect(() => { if (n > 0) ref.current?.focus(); }, [n])`
  (`session-form.tsx:59/:63/:65-67/:101/:132`, `form-feedback.tsx:35-38/:40`, `session-detail-view.tsx:49-53`).
- AEN NEVER takes focus: its live element is `<div role="alert">` (:42), no ref, no tabIndex; props :16-32. **25 mounts in 20 files**.
- The four roster screens render the hook's error straight through AEN, no wrapper: `mark-paid-sheet.tsx:170`,
  `roster-add-player-form.tsx:150-151`, `roster-remove-dialog.tsx:62-63`, `roster-reverse-dialog.tsx:100-103`.
- Failed refresh: a load failure sets `{status:"error"}` (`lib/use-sessions-data.ts:71`) and the screen swaps to its error branch; the
  roster path mounts AEN at `session-detail-view.tsx:81`; the heading effect (:51-53) cannot help (its ref exists only in the ready render).
- (O) The only focus-prop name in the codebase is React's `autoFocus` (`roster-add-player-form.tsx:143`, `mark-paid-lines.tsx:56`,
  `chat/message-actions.tsx:138`).

### 2.6 Conflict copy sites (RD)

- In scope (server tables): SCR:712-718 (strings :715-716, the `[vi, en]` tuple table `MESSAGE_BY_CODE` :598) and
  `session-guest-note-route.ts:50-53` (:52-53), both ["commandId đã được dùng cho yêu cầu khác.", "commandId was already used for a
  different request."]. Host screens show the SERVER message for this code (SEU:55, :183-184), so the server table fixes the roster screens.
- Out of ownership: `app/api/onboarding/club/route.ts:128-131`, `app/api/onboarding/zalo/connect/route.ts:116-119` and `:207-210`, all
  t("commandId đã được dùng.", "commandId already used."); the e2e hand copy `e2e/support/roster-api-mock.ts:96` (roster.spec.ts:266-276
  asserts the code only, :276).
- Client pairs: SEU:282-287 PLAYER_ERRORS ["Thao tác bị trùng. Tải lại trang rồi thử lại.", "Duplicate action. Reload the page and try
  again."], action "reload"; `settings-error-ui.ts:55-60`; `new-session-view.tsx:57-67` ["Lần gửi trước có thể đã được lưu — kiểm tra danh
  sách", "The earlier attempt may have gone through — check the list"] (:62-63). No unit test pins the server text.

### 2.7 E2E harness and unit-test rules (RC)

- `mock.failNext(key, "lost-response")` APPLIES the command, then `route.abort("internetdisconnected")` (`e2e/support/session-api-mock.ts:271-274`;
  roster keys only, :272); session create/update have only `"network"` (not applied, :266) or an injected MockError (:267-268).
- Calls are recorded with the parsed body before any hold (:250-252); `callsTo` (:213-215); `mock.callsTo("POST", /\/players$/).map((c) =>
  body(c).commandId)` (roster.spec.ts:146). Reload: `await page.reload();` (sessions.spec.ts:207; page.route survives it). The mock binds a
  key to `${key}|${sessionId}|${target}|${set}` (`e2e/support/roster-api-mock.ts:108`): a stale key with a changed amount replays there too.
- `page.clock`: unused today; Playwright 1.63.0 fakes setTimeout AND `AbortSignal.timeout` (playwright-core `coreBundle.js:12023`).
- `AbortSignal.any` NOT usable: Next 15.5.28 targets chrome 64 / edge 79 / firefox 67 / opera 51 / safari 12; repo comment `request-inbox.tsx:37`.
- No client sync hash (every sha256 helper is server-only `node:crypto`); `crypto.subtle.digest` is async while `get()` is sync (UCI:29).
- Vitest has no DOM (`apps/web/vitest.config.ts:3-7`, no DOM library): pure modules with injected storage and clock (precedent
  `lib/use-command-id.test.ts:1-3`). ACTIVE clerk flakes on apps/web: one ("the web logout-all test under load"); none for e2e-web.

## 3. Design and decision table

Source: the lane design (orchestrator, run 1), ACCEPTED as written by RO-L49-2 item 1. Every decision is Tier B, "default applied,
pending owner sign-off" (its rejected alternative in section 5), unless a ruling decided it. Where a lead differed from the measured file,
the design follows the file (section 4).

### 3.1 Commands in scope

- **Persisted** (sessionStorage, through the HOOK): the four roster money commands, mark-paid confirm, add by name, remove and reverse
  (2.3). The preview is excluded: a read with its own random id that writes nothing (2.3).
- **In-memory only** (the payload-bound KEEPER, no store): `components/sessions/new-session-view.tsx` (create) and
  `components/sessions/edit-session-view.tsx` (update). No money; their routes do not forward `replayed` (2.1); update is version-guarded
  (reader RB). Their bare refs (2.3) go: `const id = useCommandId()`, `id.get(JSON.stringify(body))`, then `id.settle()` on a 2xx and
  `id.settle(error)` on a failure.
- **Untouched**: the 10 other keeper users (no money, not owned) and the three sibling bare refs (`components/sessions/session-detail-view.tsx:46,152`,
  `components/sessions/visibility-toggle.tsx:115`, `components/me/link-code-form.tsx:25`): row R3 (section 11).

### 3.2 Decisions D1-D10

- **D1 Store.** ONE new pure module, the STORE, plus `apps/web/lib/uncertain-command-id-session-store.test.ts`, modelled on
  `lib/session-snapshot.ts` (2.3): injectable `Storage | null` and `now`; every storage access in try/catch; prefix `plx-cmd:v1:`. Key = the
  prefix + tenantId, personId, kind, targets and the fingerprint hash; value JSON `{id, at}`, nothing else. Expired records are pruned on
  access; at most 50 records under the prefix (the oldest removed first). TTL 24 h (86_400_000 ms): the server dedups indefinitely (2.1 "No
  retention"), so a long TTL is the fail-closed side (fewer double-apply windows). Its cost is row 6: a deliberate identical submit within
  24 h of an unresolved attempt that did land meets the replayed notice first, then goes out under a new id on the next submit.
- **D2 Fingerprint.** The CALLER builds a canonical string: mark-paid = method + the items sorted by playerId + expectedTotal + note; add =
  the displayName sent; remove = "" (the player is in the scope); reverse = the reason sent. The store keeps only a sync 53-bit
  non-cryptographic hash of it: no client sync hash exists and `crypto.subtle.digest` is async while `get()` is sync (2.7); equality only, a
  page-level attacker is outside the threat model; a `ponytail:` comment names the ceiling. Why the client must fingerprint at all: the
  server REPLAYS a changed body under the same type and target and ignores the new body (2.1), and DD-117 D5 forbids a server fingerprint.
- **D3 Keeper.** `createCommandIdKeeper` takes an optional store (3.3); with none it behaves exactly as today. `get` restores a persisted id
  for the identical intent, marked uncertain (sticky); otherwise it mints the id and saves its record at once, BEFORE the request is sent
  (review SEC-1, RO-L49-9 item 1: the standard idempotency-key shape). `settle`: success -> drop the record and the entry; uncertain -> keep
  both (the record is saved again); COMMAND_ID_CONFLICT -> drop the record, and the entry by the definite rule (kept when sticky, R1a-1);
  any other definite failure -> keep both when sticky, else drop both (the only attempt was refused: nothing is stored under the id).
  `reset()` clears memory ONLY and never removes a persisted record: Cancel is an explicit `reset()` (2.3), so this is what "survives a
  dialog Cancel" means. Measured during review (2026-10-27, Chromium, the e2e case "SEC-1" in `e2e/roster.spec.ts`): a reload aborts the
  in-flight fetch and the old page still settles it as uncertain, which saved the record before this change too; the save at `get` covers
  a page that dies without running more script (a discarded tab, a crash). Accepted edge (RO-L49-9 item 1): a Cancel while the request is
  in flight, then a late 2xx, leaves the record (that settle is a no-op), so the next identical intent within the TTL replays ONCE with the
  replayed notice and then mints (the unresolved-attempt rule, 3.4: never a double apply, never a silent loss).
- **D4 Hook.** `run(call, intent?)` passes the fingerprint and the scope to `get` and settles EVERY failure into the keeper, the uncertain
  ones too (today they are never settled: URC:55-56, 2.3). Scope = {tenantId, personId, kind, targets}: kind, targets and tenantId from the
  screen, the person from the NEW non-throwing export `useSessionPersonId(): string | undefined` in `lib/use-session.tsx` (RO-L49-2 item 2;
  ownership extended for that export only). No person id -> no persistence (row 16), so `components/sessions/roster-tab.test.tsx` stays
  untouched: its 7 renders without a provider (2.3) cover the no-provider branch (a throw or a broken persist attempt fails them); browser
  test (a) covers the provider branch (no person id = nothing persisted = its same-id-after-reload assertion fails). `locked` still derives
  from this mount's attempts only; a restored id is sticky in the keeper but does not lock the screen by itself.
- **D5 Replayed** (RO-L49-2 item 5, confirmed). A 2xx with `replayed: true` (no component reads it today, 2.3) shows ONE shared notice
  (section 5) and the record is gone (D3), so the next identical submit is a new command. It rides each screen's EXISTING success path, no
  new mount: add, remove and reverse pass it instead of their success message to `onAdded`/`onRemoved`/`onReversed` -> `roster-tab.tsx:60-63`
  `finished(message)` (`setDone(message)` + the heading focus, 2.3). Mark-paid: the sheet renders it as the first line of its result step,
  before the `MarkPaidResult` list, which takes only `lines` and `names` (`mark-paid-result.tsx:12-18`) and focuses itself on arrival (:21)
  (measured at the base, run 2). So the sheet renders the notice as a `tabIndex={-1}` paragraph and focuses it from its OWN effect
  (`step === "result"` and `replayed`): React runs a parent's effects after its child's, so the sheet's focus lands after the list's mount
  focus and the notice is read first (the house pattern, 2.5); the list stays one Tab away. `mark-paid-result.tsx` is not edited; needing
  to edit it is a ruling request (RO-L49-3).
- **D6 Conflict copy.** SCR:715-716 and `session-guest-note-route.ts:52-53` (2.6) get a human pair without the word commandId that advises
  reloading (section 5). Safe, because D3 drops the record on a 409, so the next submit mints a new id. The host roster screens show the
  server message for this code (2.6), so the server table fixes them. Out of ownership: the three onboarding sites (row R2) and the e2e hand
  copy `e2e/support/roster-api-mock.ts:96` (no assertion reads it: roster.spec.ts asserts the code only, :276), left as is.
- **D7 Timeout.** AC gets `API_TIMEOUT_MS = 15_000` (the five existing 15_000 ms client timeouts, 2.4), applied ONLY when the caller passes
  no `signal` (merging a caller signal breaks the three non-owned tests of 2.4, and the roster and session commands pass none, 2.4) AND the
  request is a GET or HEAD or its JSON body carries a string `commandId` (review SEC-2, RO-L49-9 item 2): only there is a timeout retried
  safely. A mutation without a commandId keeps the base behaviour, no client deadline, because its timeout would read as a definite failure
  while the server may still commit (`components/onboarding/new-club-form.tsx:75`: an edited slug would create a second club; backlog row
  `web-non-dedup-mutation-timeout`).
  Mechanism: setTimeout + an AbortController of its own, cleared when the call settles, covering `response.json()` too (today outside the
  try, 2.4); a timeout is classified by that controller, never by the error name. A NEW code `CLIENT_TIMEOUT` (status 0) joins the constant
  block (AC:37-39) and the uncertain list of `isDefiniteFailure` (SEU:204), and gets a copy branch in `describeSessionError` next to :128
  (action "retry"). Never CLIENT_NETWORK_ERROR: that code means OFFLINE in six places (2.4). The notice takes focus (D8).
- **D8 Focus** (RO-L49-2 item 3: option (b), NOT (a)). AEN gets an OPT-IN prop `autoFocus?: boolean`, default false (React's own attribute
  name, the only focus-prop name in the codebase, 2.5). When true, the `role="alert"` element gets `tabIndex={-1}` and a ref, and an effect
  focuses it on mount and whenever its `error` object changes (the house pattern, 2.5). No behaviour change at any other mount. Set at the AEN
  mounts of the four roster screens (`mark-paid-sheet.tsx:170`, `roster-add-player-form.tsx:150-151`, `roster-remove-dialog.tsx:62-63`,
  `roster-reverse-dialog.tsx:100-103`, 2.5: the uncertain, timeout and conflict errors all render there) and at the failed-refresh mount
  `session-detail-view.tsx:81` (ownership extended for that one prop). The replayed notice is not an error mount (D5). This SUPERSEDES the
  lane block's "one focus rule in the component, not per screen": the mechanism stays in ONE place and the mounts opt in. Why not (a): a
  default focus move across 25 mounts in 20 files is an unreviewed behaviour change with e2e and a11y fallout outside the lane (row R1).
- **D9 Server leg.** The real-DB replay proofs of 2.2 stand. Add by name has none, so (RO-L49-2 item 4, Q3 overruled) ONE test-only case
  goes into `packages/db/src/roster-service.test.ts`: the same commandId and body twice -> one person row, one membership row, the second
  answer is the stored result (`replayed: true`), nothing written twice (reader RB: `roster-service.ts:147` replayOrNull runs before :188
  resolveMembership, the path of the test at `roster-service.test.ts:220`). No production `packages/db` change; a pre-existing server defect
  it reveals is a ruling request, never a silent fix. It needs the database: a writer only edits it; the orchestrator runs it under the lane
  lock. No backlog row for it.
- **D10 Copy.** Three strings (section 5): the conflict pair (D6), the timeout pair (D7) and the replayed notice (D5), each "default applied,
  pending owner sign-off".

### 3.3 Interfaces (pinned in run 2 for W1 and W2; Tier B)

STORE (NEW, pure, no React):

- `export type CommandIdScope = { tenantId: string; personId: string; kind: string; targets: readonly string[] }`
- `export type UncertainCommandIdStore = { find(scope: CommandIdScope, fingerprint: string): string | null; save(scope: CommandIdScope,
  fingerprint: string, id: string): void; drop(scope: CommandIdScope, fingerprint: string): void }`
- `export function createUncertainCommandIdSessionStore(options?: { storage?: Storage | null; now?: () => number }): UncertainCommandIdStore`.
  With no `storage` option the default is resolved LAZILY per call: `window.sessionStorage` inside try/catch, null on the server or on a
  throw (as `lib/session-snapshot.ts`); `now` defaults to `Date.now`.
- Key = `plx-cmd:v1:` + `[tenantId, personId, kind, targets.join(","), hash53(fingerprint)].join(":")`; value = JSON
  `{"id":"<uuid>","at":<ms>}` and nothing else.
- `find`: getItem, parse and validate (id a non-empty string, at a finite number), else remove + null; `now - at > TTL_MS` (TTL_MS =
  86_400_000) or `at > now` -> remove + null. `save`: prune the expired records under the prefix, then while the prefix holds >= 50 records
  remove the oldest, then setItem. `drop`: removeItem. EVERY storage access in try/catch (a throw -> no-op or null).
- `hash53` (the hash ceiling): internal, sync, 53-bit, non-cryptographic (cyrb53 shape), with a `ponytail:` comment: equality only, not
  collision-resistant against a crafted input (a page-level attacker is outside the threat model); upgrade = SHA-256 via `crypto.subtle`
  (async) if that changes.

KEEPER (UCI):

- `createCommandIdKeeper(mint, store?: UncertainCommandIdStore)` -> `{ get(payload?: string, scope?: CommandIdScope): string; settle(error?:
  unknown): void; reset(): void }`; no store and no scope = EXACTLY today.
- `get`: the same payload AND the same scope as the current entry -> its id; else, when a store, a scope and a payload are all present,
  `store.find(scope, payload)`: a hit becomes the current entry with uncertain = true (sticky); else mint (as today) and, with a store, a
  scope and a payload, `store.save` the minted id at once, before the request is sent (review SEC-1, RO-L49-9 item 1).
- `settle()`: `store.drop` for the current entry, then current = null. `settle(e)`: `!isDefiniteFailure(e)` -> uncertain = true +
  `store.save` (again); an `ApiClientError` with code COMMAND_ID_CONFLICT -> `store.drop`, then the definite rule for the entry (R1a-1);
  any definite failure: sticky -> keep the entry (and, but for a conflict, the record); not sticky -> `store.drop` (the record saved at
  `get`: the only attempt was refused, so nothing is stored under the id) and current = null.
- `reset()`: current = null ONLY; never touches the store.
- `useCommandId(store?)` -> `useState(() => createCommandIdKeeper(() => crypto.randomUUID(), store))`. The 10 other users keep calling
  `useCommandId()`, unchanged; the two deliberate no-payload callers (`zalo-connect-card.tsx:141`, `moderation-sheet.tsx:38`, section 4
  RA-12) pass no store and no payload, so they never persist.

HOOK (URC):

- `export type RosterCommandKind = "mark-paid" | "add" | "remove" | "reverse"`; `run(call, intent?: { tenantId: string; kind:
  RosterCommandKind; targets: readonly string[]; fingerprint: string })`.
- personId = `useSessionPersonId()`; scope = intent && personId ? {tenantId, personId, kind, targets} : undefined;
  `id.get(intent?.fingerprint, scope)`; every failure is settled into the keeper; `locked` derives from this mount's attempts only, as
  today (a COMMAND_ID_CONFLICT does not unlock: review R1a-1, row 4).
- One module-level `const store = createUncertainCommandIdSessionStore()` passed to `useCommandId(store)`. The preview call
  (`mark-paid-sheet.tsx`) runs without an intent: unchanged.

PERSON ID (`lib/use-session.tsx`): `export function useSessionPersonId(): string | undefined { return
useContext(SessionContext)?.session?.personId; }` (about 4 lines with its doc comment).

SCREENS (W2; tenantId = ctx.tenantId):

- mark-paid confirm: kind "mark-paid", targets [sessionId], fingerprint = `JSON.stringify({method, items sorted by playerId,
  expectedTotal, note})` of the confirm body.
- add: kind "add", targets [sessionId], fingerprint = the displayName sent. Remove: kind "remove", targets [sessionId, playerId],
  fingerprint "". Reverse: kind "reverse", targets [sessionId, allocationId], fingerprint = the trimmed reason sent.
- A 2xx with `result.replayed === true`: the shared `replayedNotice(t)` (NEW in SEU) replaces the success message (D5).
- Edit and new session: 3.1.

PROBES (ABSENT at the base, section 1): `createUncertainCommandIdSessionStore` (row :6091) and `API_TIMEOUT_MS` (row :6109).

### 3.4 Decision table (16 rows; each row proved against the server contract of 2.1)

| # | Case | Key | locked | Host sees | Refetch | Why (2.1 unless noted) |
|---|---|---|---|---|---|---|
| 1 | Uncertain failure (network, 5xx, CLIENT_BAD_RESPONSE, CLIENT_TIMEOUT) | kept in memory + record kept (saved at `get`, before the send) | true (as today) | the uncertain copy, focused (D8) | none until Cancel/unmount (as today) | it may have committed; dedup on commandId only replays the SAME id, a NEW id applies twice (two same-amount payments; two "Minh") |
| 2 | Definite 4xx, no earlier uncertain attempt | dropped + the record saved at `get` dropped | false | the domain copy | none | the only attempt under this id was refused, so no stored result exists under it |
| 3 | Definite 4xx after an uncertain attempt (RATE_LIMITED, CSRF, 403/TENANT_SUSPENDED) | kept + record kept (sticky) | true | the copy | Cancel refetches (as today) | authz precedes dedup: a COMMITTED id can answer 403/TENANT_SUSPENDED, so the 4xx proves nothing about the first attempt |
| 4 | COMMAND_ID_CONFLICT 409 | record dropped; the key by the definite rule: dropped when fresh, kept when sticky (rows 2, 3) | unchanged (true after an uncertain attempt) | the human copy, "reload and try again" | Cancel refetches (as today); after a reload the next attempt mints a NEW id (no 24 h loop) | usually another type, session, actor or target (the 409 sites), but also the SAME intent when its stored result is unusable (2.1 Dedup), so a sticky key never becomes a new id before the host has seen a refetch (review R1a-1) |
| 5 | Success, first apply (`replayed: false`) | dropped + record dropped | false | the success copy | the screen's own refresh | outcome observed; a deliberate second payment gets its own id (RO-L49-1 item 4) |
| 6 | Success, `replayed: true` | dropped + record dropped | false | the replayed notice (D5) | the screen's own refresh | a replay is HTTP 200 `replayed: true` with zero writes: the first attempt had landed |
| 7 | Reload while uncertain or still in flight, or the page dies (a discarded tab, a crash) | memory lost, record survives (same tab; saved at `get`, before the send) | false (the body is not stored, the inputs cannot be re-frozen) | fresh state (the page fetches) | inherent | the record holds only id, hash and time; the identical intent restores it (row 9) |
| 8 | Dialog Cancel while uncertain or in flight | memory reset (as today), record KEPT (a late 2xx after a Cancel in flight leaves it too: D3's accepted edge) | false after Cancel | the refreshed roster | as today (locked Cancel -> onReload/finished) | Cancel is an explicit `reset()` (2.3); `reset()` never touches the store (D3) |
| 9 | Next attempt, identical fingerprint, within TTL | the persisted id restored, sticky | per outcome (rows 1-6); a restored key alone never locks (D4) | per outcome | per outcome | same type + target + body under the same id = a replay if the first landed, else the first apply |
| 10 | Changed payload (same scope, other fingerprint) | a NEW id (the keeper's changed-payload rule); the old record stays to its TTL | per outcome | per outcome | per outcome | under the old id the server would replay and silently ignore the new body |
| 11 | Another tab | a fresh tab has no records (as today); a duplicated tab starts with a copy: both send one id | - | - | - | `UNIQUE (tenant_id, command_id)` + the advisory lock: the server applies once |
| 12 | Storage absent, full or throwing | every op swallowed -> today's in-memory behaviour; the command is never blocked | as today | as today | as today | persistence only narrows a window; losing it is today's behaviour, never worse |
| 13 | Logout, login as another person (same tab) | never restored (person in the key); old records expire by TTL | - | - | - | another actor's roster or money id answers 409; sign-out wipes only list snapshots and lang (2.3) |
| 14 | Another tenant | never restored (tenant in the key) | - | - | - | the ledger and the lock are per tenant: the id would not dedup there |
| 15 | Record older than 24 h | ignored and pruned -> a new id | - | - | - | the server keeps ids indefinitely; the TTL is D1's bounded window |
| 16 | No person id (no SessionProvider, e.g. a static test render) | no persistence -> today's in-memory behaviour | as today | as today | as today | no person = no safe key (rows 13-14); `roster-tab.test.tsx` unchanged (D4) |

**The unresolved-attempt rule (RO-L49-2 item 5, confirmed).** An UNRESOLVED attempt (no 2xx, no definite 4xx) cannot be told apart from
its retry: the identical intent reuses the persisted id; if the first landed the server answers `replayed: true`, the screen shows the new
notice and the record is dropped, so a deliberate second payment goes out under its own NEW id on the next explicit submit: never a double
apply, never a silent loss; every case where the first outcome WAS observed (2xx, a definite 4xx, a 409) drops the record first. A Cancel while the request is in flight followed by a late 2xx is unresolved from
the screen's side (D3's accepted edge): the record stays, so the next identical intent replays once with the notice, then mints. The
user-visible effect: one new notice string (the replayed notice, section 5). The PR body states this rule as written here.

## 4. Lead corrections (33: RA 12, RB 9, RC 5, RD 7)

In every case the measured file wins and the design follows it.

- RA-1: lead (1) "about 70 lines": UCI has 61.
- RA-2: lead (1) uncertain set "network, bad response, 5xx": wider, any non-`ApiClientError` and any status outside 400-499 (SEU:203-205).
- RA-3: leads (2), (5) "the fingerprint gates the roster commands": no, URC:49 sends no payload; the fingerprint input to `run` is NEW (D4).
- RA-4: lead (5) "the keeper writes the store only while uncertain": the hook never settles an uncertain failure (URC:55-56); now it does (D4).
- RA-5: lead (2) "preview, one of two hooks": not a command, own random id (`lib/roster-payments-api.ts:84`), ignores the key (`mark-paid-sheet.tsx:79-80`).
- RA-6: lead (2)'s keeper users miss `components/settings/club-defaults-form.tsx:42`, `club-profile-form.tsx:44`, `:255`, `zalo-connect-card.tsx:59`.
- RA-7: lead (2) "on unmount it calls onAbandon": only the add form passes one (`roster-add-player-form.tsx:59`); the other three call the hook bare.
- RA-8: lead (1) "a reload or an unmount loses it": on Cancel nothing unmounts; explicit `reset()` kills the key (2.3), hence D3.
- RA-9: lead (3) edit :25/:91/:100 confirmed, new :23/:48/:56; neither sticky, edit never drops the key on success; three more bare refs (R3).
- RA-10: lead (6) new-session-view copy "about :57": it is :62-63 (:57 is the code test), with an English half.
- RA-11: the step-0 brief's URL `/api/tenants/${tenantId}/...`: the routes are `/api/sessions/...?tenant=` (`lib/sessions-api.ts:139`).
- RA-12: lead (5) "the Zalo case in UCI calls get()": UCI:25-26 is a comment; the calls are `zalo-connect-card.tsx:141` and `moderation-sheet.tsx:38`.
- RB-1: `packages/db/src/schema.ts` does not exist; the schema is `packages/db/schema.ts` (:1508-1518).
- RB-2: lead (4) "dedups on commandId ONLY": the key is (tenant_id, command_id), per tenant; DD-117 D5 means no content fingerprint.
- RB-3: lead (4) "another type or payload set answers 409": no payload is compared, a changed body REPLAYS; "set" only for markPaid's players (:313).
- RB-4: lead (4) omits the actor asymmetry: roster, money and join replays are actor-bound (409); create and update are not.
- RB-5: lead (4) omits authz before dedup (`payment-manual.ts:271` before :292): a committed id can answer 403/TENANT_SUSPENDED (row 3).
- RB-6: lead (8) cites payment-manual and payment-reversal tests: both live in `payment-manual.test.ts` (:198, :541); no reversal test file.
- RB-7: lead (8) "a real-DB test only where none" vs "no packages/db change": add by name has none; RO-L49-2 item 4 resolves it (D9).
- RB-8: GOAL (3): the SCR entry is already a t(vi, en) pair (:712-718); the defect is the wording that exposes "commandId".
- RB-9: the step-0 brief "the route forwards the gate's person id": only create/update use `context.personId`; the money routes re-read the cookie.
- RC-1: the step-0 brief "the clock fakes setTimeout but NOT AbortSignal.timeout": false for Playwright 1.63.0, which fakes both (2.7).
- RC-2: the step-0 brief: `withTimeout` is DEFINED at `request-inbox.tsx:38`; :60 is its call in `fetchPending`.
- RC-3: lane TESTS line "the e2e script in apps/web/package.json": there is none; the command is `.github/workflows/ci.yml:143` (section 8).
- RC-4: lead (8) "aborted after the request left": `"lost-response"` is roster-only (`e2e/support/session-api-mock.ts:272`); new/edit get "network" (:266).
- RC-5: lead (8)'s `callsTo("POST", /\/players$/)` commandId read fits :146 and :168 only; :231, :263, :273-277 are DELETE-key checks.
- RD-1: lead (6) SCR "about :703": the entry is :712-718 (strings :715-716, table :598, status :558); the row's ":591-595" is stale.
- RD-2: lead (6) names two server tables: five string sites exist; the three onboarding ones are out of ownership (R2).
- RD-3: lead (6) omits `settings-error-ui.ts:55-60` (a fourth client copy) and the e2e hand copy `e2e/support/roster-api-mock.ts:96`.
- RD-4: lead (6) cites the human pair at :283: that is the PLAYER table; host roster screens show the server message (SEU:55, :183-184).
- RD-5: lead (7) "apiFetch passes no timeout or signal": no timeout, but it DOES forward a caller signal (AC:41, :56, :65); 8+ sites pass one.
- RD-6: lead (7) "its tests need a mocked router": no AEN test file exists; the mocks sit in 11 screen tests.
- RD-7: the step-0 brief "session-form.tsx :94-103 focuses": :94-103 is the catch bumping the counter (:101); the focus is :65-67, target :132.

## 5. Pinned defaults (Tier B; each "default applied, pending owner sign-off")

| # | Default | REJECTED alternative (why) |
|---|---|---|
| 1 | The store behind the keeper (one place) | per-screen persistence (four copies of the logic; negative scope) |
| 2 | sessionStorage | localStorage (negative scope; outlives the tab and crosses tabs) |
| 3 | A fingerprint hash | storing the body (negative scope: no body, name or amount persisted) |
| 4 | TTL 24 h | shorter (more double-apply windows; the server keeps ids indefinitely, 2.1) |
| 5 | Cap 50 records | unbounded (storage growth) |
| 6 | `useSessionPersonId` (RO-L49-2 item 2) | a SessionProvider in `roster-tab.test.tsx` (a non-owned test edit); a tenant-only namespace (another person in the tab would restore an id and meet a 409) |
| 7 | Opt-in `autoFocus` (RO-L49-2 item 3) | a default focus move across 25 mounts in 20 files (unreviewed behaviour change) |
| 8 | Timeout 15_000 ms only without a caller signal, and only for a GET/HEAD or a JSON body with a `commandId` (SEC-2) | merging the signals (breaks three non-owned tests, 2.4); a deadline on every signal-less request (a POST without a commandId would read its timeout as definite, SEC-2) |
| 9 | `CLIENT_TIMEOUT` | CLIENT_NETWORK_ERROR (means offline in six places, 2.4) |
| 10 | Scope: 4 persisted, 2 in-memory, preview excluded | persisting create/update and the preview (no money; no `replayed` forwarded; the preview is a read) |
| 11 | The replayed notice via the success path | a new notice mount per screen (new mounts, new focus logic) |
| 12 | The three copy pairs below | none shipped today for the timeout and replayed cases; a new conflict wording (a second wording for one meaning) |

The three new strings, each "UI copy the owner has not seen":

- Conflict (SCR:715-716 and `session-guest-note-route.ts:52-53`, `[vi, en]` tuples; reuses the shipped client pair SEU:282-287): ["Thao
  tác bị trùng. Tải lại trang rồi thử lại.", "Duplicate action. Reload the page and try again."]
- Timeout (`describeSessionError`, action "retry"): t("Máy chủ chưa phản hồi kịp. Thao tác có thể vẫn đang được xử lý; thử lại sau giây
  lát.", "The server did not answer in time. It may still be processing; try again in a moment.")
- Replayed (`replayedNotice(t)` in SEU): t("Thao tác này đã được ghi nhận ở lần gửi trước; không có gì mới được lưu.", "Already recorded by
  an earlier attempt; nothing new was saved.")

## 6. Implementation steps

1. **W1**: the STORE + its test; the KEEPER (3.3) + the new `lib/use-command-id.test.ts` cases; the HOOK; `useSessionPersonId`.
2. **W2**: the four roster screens (intent, `replayedNotice` in SEU) and `edit-session-view.tsx` / `new-session-view.tsx` to the keeper.
3. **W3**: the conflict pair (SCR, `session-guest-note-route.ts`); the timeout (AC + `lib/api-client.test.ts`, `CLIENT_TIMEOUT` in SEU);
   `autoFocus` in AEN and its mounts (the four screens + `session-detail-view.tsx:81`).
4. **O-db**: the ONE case in `packages/db/src/roster-service.test.ts` (D9): a writer edits it, the orchestrator runs it under the lock.
5. **W4**: the browser tests (`e2e/roster.spec.ts`, `e2e/sessions.spec.ts`).
6. **O-rows**: the two rows closed by hand + rows R1-R3 in `docs/autopilot-backlog.md`.

GitNexus `impact` before each exported-symbol edit (HIGH expected; report it), `detect_changes` before every commit.

## 7. Acceptance matrix (A-1..A-30)

Each new test must FAIL on its planted mutation (R1b).

| ID | Expected result | Proving test |
|---|---|---|
| A-1 | save then find (same scope + fingerprint) -> the id; another fingerprint -> null | store test |
| A-2 | a record older than 86_400_000 ms (fake clock) or with `at > now` -> removed, null | store test |
| A-3 | the 51st save removes the oldest; never more than 50 under the prefix | store test |
| A-4 | another tenant, person, kind or targets -> null | store test |
| A-5 | storage null or throwing on every method: no throw; find null; save and drop no-ops | store test |
| A-6 | a malformed value (bad JSON, empty id, non-finite `at`) -> removed, null | store test |
| A-7 | the value holds only `id` and `at`; the key holds the hash, never the fingerprint text | store test |
| A-8 | no store = today: every existing keeper case green, unchanged | `use-command-id.test.ts` |
| A-9 | uncertain settle saves; a new keeper on the same store, scope and payload -> the SAME id, sticky | keeper test |
| A-10 | a changed payload -> a NEW id; the old record stays | keeper test |
| A-11 | `reset()` keeps the record; get after reset -> the same id | keeper test |
| A-12 | COMMAND_ID_CONFLICT drops the record; a fresh key is dropped, a sticky one kept until reset() (R1a-1) | keeper test |
| A-13 | success drops the record; a definite 4xx keeps it when sticky, drops the entry when not | keeper test |
| A-14 | get without a payload or a scope never calls the store | keeper test |
| A-15 | no caller signal, no answer in 15_000 ms (fake timers) -> `ApiClientError` CLIENT_TIMEOUT, status 0 | `api-client.test.ts` |
| A-16 | CLIENT_TIMEOUT is uncertain (`isDefiniteFailure` false) | `api-client.test.ts` |
| A-17 | the timer is cleared on success (no abort after the answer) | `api-client.test.ts` |
| A-18 | with a caller signal: no default timeout, fetch gets exactly that signal (the three non-owned tests green) | `api-client.test.ts` |
| A-19 | a stalled `response.json()` aborts -> CLIENT_TIMEOUT | `api-client.test.ts` |
| A-20 | add by name twice, same commandId and body: one person row, one membership row, second answer replayed, nothing written twice | `roster-service.test.ts` (O-db) |
| A-21 | `"lost-response"` + `page.reload()` + the identical submit -> the SAME commandId in `callsTo` (case (a)) | `roster.spec.ts` |
| A-22 | after `"lost-response"`, a changed payload -> a NEW commandId | `roster.spec.ts` |
| A-23 | `replayed: true` -> the replayed notice; the next identical submit -> a NEW commandId | `roster.spec.ts` |
| A-24 | Cancel while uncertain -> reopen -> the identical submit -> the same id | `roster.spec.ts` |
| A-25 | a 409 COMMAND_ID_CONFLICT -> the human copy, focused; the next submit -> a NEW id | `roster.spec.ts` |
| A-26 | `page.clock.install()` + `mock.holdNext` + `clock.fastForward(15_000)` -> the timeout copy, focused | `roster.spec.ts` |
| A-27 | new session: a "network" failure + an edited body -> a NEW id; unchanged -> the same id | `sessions.spec.ts` |
| A-28 | edit session: the same two cases as A-27 | `sessions.spec.ts` |
| A-29 | a failed refresh -> the AEN at `session-detail-view.tsx:81` takes focus | `roster.spec.ts` |
| A-30 | `components/sessions/roster-tab.test.tsx` untouched and green (no provider = no persistence, D4) | `roster-tab.test.tsx` |

## 8. Verification

- Writers (no DB, no `next`): `pnpm --filter @plexco/web exec vitest run lib/uncertain-command-id-session-store.test.ts
  lib/use-command-id.test.ts lib/api-client.test.ts components/sessions/roster-tab.test.tsx`; `pnpm -w lint`; `pnpm -w format:check`;
  `pnpm review:check:changed`.
- Orchestrator only (RO-L49-1 item 2): `pnpm -w typecheck` (web runs `next typegen`, `apps/web/package.json:10`); `pnpm -w test` with
  `DATABASE_URL_TEST` through the lane's locked-run wrapper (root `package.json:11`); the db case by `pnpm test:db` (:13) under the lock;
  the browser leg `pnpm --filter @plexco/web exec playwright test e2e/roster.spec.ts e2e/sessions.spec.ts` (the `.github/workflows/ci.yml:143`
  form, `E2E_SKIP_BUILD` :142). Pre-authorized fallback for the browser leg: the CI `e2e-web` job (ci.yml:112).
- This restates the lane block's TESTS line as commands (RC-3: no e2e script exists).

## 9. Budget (B3)

- Estimate about 230 non-test / 480 test lines; caps 260 non-test / 520 test / 780 total; a logged design-reason overrun up to 340 / 700
  (RO-L49-1 item 5). 0 migrations.
- Files: up to 22 non-docs (RO-L49-2 item 6). RO-L49-3 (2026-10-27): the cap counts non-docs files only; up to 24 with ONE logged design
  reason needs no ruling; a file outside the ownership as extended by RO-L49-2 is always a ruling request; `e2e/sessions.spec.ts` stays in.
- Planned 16 non-test: `apps/web/lib/` api-client.ts, use-command-id.ts, use-roster-command.ts, uncertain-command-id-session-store.ts (NEW),
  session-error-ui.ts, session-command-route.ts, session-guest-note-route.ts, use-session.tsx (the export only);
  `apps/web/components/sessions/` api-error-notice.tsx, mark-paid-sheet.tsx, roster-add-player-form.tsx, roster-remove-dialog.tsx,
  roster-reverse-dialog.tsx, edit-session-view.tsx, new-session-view.tsx, session-detail-view.tsx (the prop at :81 only).
- Planned 6 test: `apps/web/lib/uncertain-command-id-session-store.test.ts` (NEW), `apps/web/lib/use-command-id.test.ts`,
  `apps/web/lib/api-client.test.ts`, `apps/web/e2e/roster.spec.ts`, `apps/web/e2e/sessions.spec.ts`, `packages/db/src/roster-service.test.ts`.
- 2 docs: `docs/autopilot-backlog.md` and this file. `apps/web/lib/session-error-ui.test.ts` is not edited; needing it would be a file
  outside the ownership: a ruling request (RO-L49-3).

## 10. Threat model

The lane block's 7 threats, restated in substance from the design's threat-to-row mapping; SEC uses this table as its checklist.

| # | Threat | Defended by |
|---|---|---|
| 1 | the key is lost between an attempt and its retry (a reload or a page death while in flight or after an uncertain failure, a Cancel), so the retry applies twice | rows 7, 8, 9; D1, D3 (the record is saved at `get`, before the send: review SEC-1) |
| 2 | a stale key re-sent with another body replays and silently drops it, or a deliberate second payment shares an id | rows 10, 5, 6; D2, D5 |
| 3 | a key restored across person, tenant or time | rows 13, 14, 15; D1 |
| 4 | a COMMAND_ID_CONFLICT loop | row 4 (the record is dropped, so a reload ends it; a sticky key repeats in the mount until Cancel or a reload, both refetch first: fail-closed, R1a-1); D3, D6 |
| 5 | a timeout classified as definite (the key dropped while the server may have committed) | row 1; D7 (CLIENT_TIMEOUT is uncertain; a request that cannot dedupe gets no client deadline, review SEC-2), D8 |
| 6 | PII or money data in browser storage | D1, D2: only an id, a hash and a time, no name or amount in clear; the shared-device limit (the add key hashes the typed name, unsalted; the records survive a sign-out in the same tab) is named under Not defended (review SEC2-1) |
| 7 | storage that throws, is absent or full (private mode) | row 12 (degrade to today's in-memory behaviour; the command is never blocked) |

Not defended (named): a page-level attacker (script injection, an extension) can read or write sessionStorage and craft hash collisions
(outside the threat model; the D2 ceiling; nothing is stored in clear); a server that replays wrongly (the server contract is out of
scope and cited in section 2.1); a changed payload after an unresolved attempt that did land is a
new intent under a new id (row 10, as today; the server has no content dedup, DD-117 D5); an identical retry past the 24 h TTL is a new
command (row 15); a fresh tab has no records (row 11, as today); create and update keep their key in memory only (a reload loses it, as
today; no money). A shared device (review SEC2-1, RO-L49-9 item 3, a documented limit): the records survive a deliberate sign-out in the
same tab until their 24 h TTL, and a later user of that open tab with devtools can read them and recover a typed name from the add key's
unsalted 53-bit hash by a dictionary (no name, amount or id in clear; the keys are scoped by tenant and person). Clearing at sign-out is
rejected: a sign-in again and an identical retry would mint a new id and could apply a payment twice (backlog row
`web-command-id-records-shared-device`).

## 11. Open

- **In scope: 0.**
- Out of scope, named, behaviour pinned:
  - **R1** (row): the AEN default-focus audit, the 25 mounts in 20 files as evidence; today and after this lane only the opted-in mounts
    focus (D8).
  - **R2** (row): the COMMAND_ID_CONFLICT copy outside ownership (`app/api/onboarding/club/route.ts:128-131`,
    `app/api/onboarding/zalo/connect/route.ts:116-119` and `:207-210`), all t("commandId đã được dùng.", "commandId already used."),
    unchanged.
  - **R3** (row): the sibling bare commandId refs (`components/sessions/session-detail-view.tsx:46,152`,
    `components/sessions/visibility-toggle.tsx:115`, `components/me/link-code-form.tsx:25`), unchanged.
  - `e2e/support/roster-api-mock.ts:96` keeps its hand copy (no assertion reads it).
  - `new-session-view.tsx:57-67` keeps its own conflict copy, unchanged.
  - Sign-out does not wipe the records: the person in the key and the TTL cover it (rows 13, 15); the shared-device limit is named in
    section 10 (review SEC2-1, RO-L49-9 item 3) with the backlog row `web-command-id-records-shared-device`.
  - The 10 other keeper users are unchanged.
- Backlog: rows R1-R3 (the lane's allowance of three) and four review rows, `db-command-id-conflict-unusable-result-code` (RO-L49-7),
  `web-confirm-dialog-tab-trap-focused-notice`, `web-non-dedup-mutation-timeout` and `web-command-id-records-shared-device` (RO-L49-9
  item 5): seven new rows, plus the two rows closed by hand (section 1).

## 12. Closure matrix (12 of 12 PASS)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the worktree HEAD at step 0, the merge of PR #127 (measured); every TARGET_FILES path is tracked at the base (`git ls-files --error-unmatch`, run 2) | PASS |
| 2 | Decisions in scope final | DD-150; the two rows as the contract; RO-L49-1, RO-L49-2 and RO-L49-3 (conductor); D1-D10 pinned as defaults pending owner sign-off (section 5) | PASS |
| 3 | Scope IN/OUT and owner clear | the lane block's FILE OWNERSHIP as extended by RO-L49-2 (`use-session.tsx`, `session-detail-view.tsx`, `roster-service.test.ts`); the negative scope (section 1); the file list (section 9) | PASS |
| 4 | Dependencies classified | L40 merged (PR #121), L48 merged (PR #126); every earlier lane merged (C20; the base is the merge of PR #127) | PASS |
| 5 | Live schema and code match | section 2 measured at the base; no schema, migration or production server change | PASS |
| 6 | Data, API, state, auth contract | no schema, migration or HTTP contract change; the only new client state is the sessionStorage prefix `plx-cmd:v1:` (id, hash, time); user-visible: three strings and focus at the opted-in mounts | PASS |
| 7 | Fail-closed, idempotency, order | the 16-row table proved against 2.1; the unresolved-attempt rule (3.4); storage failure = today's behaviour (row 12) | PASS |
| 8 | Open questions in scope = 0 | section 11 | PASS |
| 9 | Acceptance matrix with expected results | section 7 (A-1..A-30) | PASS |
| 10 | Migration, security, rollback | no migration; security round planned (SEC, opus); rollback = revert the PR | PASS |
| 11 | First slice hard dependencies merged | L40 and L48 merged; W1 depends on nothing unmerged | PASS |
| 12 | Implementation handoff ready | sections 3 and 5-8; W1 has every input (the Interfaces, 3.3) | PASS |

## 13. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-27
AUTHORITY_SHA: 336e84e616e672cf3958320909cb1e2c6475c59a
BASE_BRANCH: main
TARGET_FILES:
  - apps/web/lib/api-client.ts (edited: API_TIMEOUT_MS, the own-controller timeout without a caller signal for a GET/HEAD or a commandId body, CLIENT_TIMEOUT in the codes :37-39)
  - apps/web/lib/use-command-id.ts (edited: the optional store, get(payload, scope) saving a minted record before the send, settle, reset keeps the record)
  - apps/web/lib/use-roster-command.ts (edited: run(call, intent), every failure settled, the module-level store)
  - apps/web/lib/session-error-ui.ts (edited: CLIENT_TIMEOUT uncertain :204, the timeout copy next to :128, replayedNotice)
  - apps/web/lib/session-command-route.ts (edited: the conflict pair :715-716)
  - apps/web/lib/session-guest-note-route.ts (edited: the conflict pair :52-53)
  - apps/web/lib/use-session.tsx (edited: the useSessionPersonId export only)
  - apps/web/lib/use-command-id.test.ts (edited: the store-backed keeper cases)
  - apps/web/lib/api-client.test.ts (edited: the timeout cases)
  - apps/web/components/sessions/api-error-notice.tsx (edited: the opt-in autoFocus prop)
  - apps/web/components/sessions/mark-paid-sheet.tsx (edited: the confirm intent, autoFocus at :170, the replayed notice in the result step)
  - apps/web/components/sessions/roster-add-player-form.tsx (edited: the intent, autoFocus at :150-151, the replayed message)
  - apps/web/components/sessions/roster-remove-dialog.tsx (edited: the intent, autoFocus at :62-63, the replayed message)
  - apps/web/components/sessions/roster-reverse-dialog.tsx (edited: the intent, autoFocus at :100-103, the replayed message)
  - apps/web/components/sessions/edit-session-view.tsx (edited: the bare ref to the in-memory keeper)
  - apps/web/components/sessions/new-session-view.tsx (edited: the bare ref to the in-memory keeper)
  - apps/web/components/sessions/session-detail-view.tsx (edited: autoFocus at :81 only)
  - apps/web/e2e/roster.spec.ts (edited: A-21 to A-26, A-29)
  - apps/web/e2e/sessions.spec.ts (edited: A-27, A-28)
  - packages/db/src/roster-service.test.ts (edited: the add-by-name replay case, A-20)
  - apps/web/lib/tenant-lang.test.ts (edited: one SURFACE_BUCKETS line for the new store file, RO-L49-6)
  - apps/web/lib/session-command-route.test.ts (edited: the D6 conflict wording pin, review R1b2-1)
  - apps/web/app/api/sessions/[id]/guest-notes/route.test.ts (edited: the D6 conflict wording pin, review R1b2-1)
  - docs/autopilot-backlog.md (edited: the two rows closed by hand, rows R1-R3 and the four review rows)
SLICE: p4-web-command-id-persistence
IN_SCOPE: the new apps/web/lib/uncertain-command-id-session-store.ts and apps/web/lib/uncertain-command-id-session-store.test.ts; the store-backed keeper; the hook's intent and settle-every-failure; useSessionPersonId; the four roster screens' intents and the replayed notice; edit and new session on the in-memory keeper; the conflict pair in the two server tables; the apiFetch timeout and CLIENT_TIMEOUT; the opt-in autoFocus on ApiErrorNotice at the four roster mounts and session-detail-view.tsx:81; the add-by-name replay case; the browser tests; the D6 wording pins in the two route tests; the two rows closed by hand, rows R1-R3 and the four review rows; this readiness file
OUT_OF_SCOPE: production packages/db, migrations, the ledger and the dedup rule (commandId-only, DD-117 D5) and any server answer; localStorage and any persisted body, token, name or amount; the 10 other keeper users and the three sibling bare refs (R3); the onboarding conflict copies (R2); a default focus rule for the other ApiErrorNotice mounts (R1); the e2e support mocks; mark-paid-result.tsx; session-error-ui.test.ts; new dependencies; PR #50
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: L40 merged (PR #121), L48 merged (PR #126) and every earlier lane merged: the base commit is the merge of PR #127
PRIOR_SLICES: L40 (merged, PR #121); L48 (merged, PR #126); L46 (merged, PR #127, migration 0074); every earlier Phase 4 lane (merged, owner concurrency rule C20)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration; security round planned (SEC, opus, the threat model as the checklist); rollback = revert the PR: the only new client state is the sessionStorage prefix plx-cmd:v1:, expiring in 24 h
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 - add apps/web/lib/uncertain-command-id-session-store.ts and its test, the optional store in use-command-id.ts with its new cases, run(call, intent) in use-roster-command.ts and the useSessionPersonId export; GitNexus impact before each exported symbol; commit in the worktree
REMAINING_BLOCKERS: none
```
