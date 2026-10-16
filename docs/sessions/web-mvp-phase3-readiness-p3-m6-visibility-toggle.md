<!-- review-readiness: code-ready -->

# Step-0 readiness: L6 p3-m6-visibility-toggle (session P3-S2)

> Agent-facing. Readiness reviewer: opus/max (same model and effort as the lane's code reviewer). Writer: opus/max. Code reviewer: opus/max, at most 3 rounds,
> no separate security round (lane MODELS line); the reviewer asks the three exposure questions of section 3.
> Lane contract: `docs/autopilot-templates/web-mvp-phase3-2026-10-16-RUN.md:387-428` (L6) and the P3-S2 session block `:1006-1023` (STOP rule `:1021`: HALT L6 if
> the toggle needs a migration). Plan: `docs/sessions/web-mvp-phase3-plan.md`.
> Every `path:line` below is MEASURED at base `b0bf565ed72d8c4be3f47d3fe7a4e0e382605928` (merge of PR #61; P3-S1 fully merged: #59, #62, #60, #61). The lane
> block was measured at `c762c90`; #61 shifted `packages/db/src/session-service.ts` by +9 to +12 lines. Use THIS file's numbers.

## 1. Authority

- Owner message 2026-10-16, first sentence verbatim: "Phase 3 plan approved." It approves the RUN doc, whose L6 block says `DEPENDS ON: L2 merged` and
  `OWNER DECISIONS NEEDED: none`. None of D1-D5 (DD-133..DD-137) changes L6.
- DD-114 D3 (b), owner 2026-08-26 (`docs/standards/decisions.md:143`): phase 1 HAS the public/private toggle and the immediate-deny fence and does NOT project
  `public_sessions`. DD-122 (owner 2026-10-12, `decisions.md:135`): FE PENDING lifted, the agent owns UI design under the acceptance bar (375 px + desktop, light
  and dark, 5 states, WCAG 2.2 AA, tokens only, `t(vi, en)`); review is an independent Claude subagent (D4).
- Spec pair, both `Reviewed`: Product `docs/features/FE/feature_session_management.md` v2.28 (SES-UC-4 `:65` edit visibility; section 1 `:28` SES-UC-8 = toggle
  plus fence only, no listing; edge #7 `:90` a public session needs sport, area, starts_at and a finite slots_max; edge #8 `:91` private means immediate removal);
  BE `docs/features/BE/feature_session_management_tech.md` v2.37 (section 3 PUT `:299`; catalog STALE_VERSION 409 `:324`, MISSING_DISCOVERY_FIELDS 400 `:328`;
  edge #12 `:247`; edge #55 `:286` FORBIDDEN 403 at the route gate with the same body for every reason; events `:640` `session.visibility_changed`
  {session_id, new_visibility}; rate limit `:618` PUT 20/min per tenant).
- `docs/channels/web/FE/feature_sessions_fe.md` is Draft (FE design not reviewed). Under DD-122 its MISSING_DISCOVERY_FIELDS copy (`:236`) and its
  `VisibilityToggle` radio group (`:388`) are inputs, not authority; the defaults in section 5 replace them.

## 2. Measured at base

| Lane cite (c762c90) | At base | Note |
|---|---|---|
| `updateSession :1142` | `:1151-1611` | +9 |
| visibility event `:1563-1571` | comment `:1563-1568`, insert `:1569-1578` (type `:1575`, payload `:1576`) | gated on `changes.visibility !== undefined` |
| MISSING_DISCOVERY_FIELDS check `:1427-1446` | `:1448-1461` (rule `:1452-1454`, error `:1456-1459`); effective values `:1438-1440` | rule = `effArea.trim().length > 0` and `effSlotsMax != null` |
| fence call `:1579` | `:1590-1592` (call `:1591`) | gated only on `changes.visibility === "private"`, no status gate |
| close / cancel fence `:1937`, `:2360` | `:1949` (`closed`), `:2372` (`cancelled`) | both unconditional on the transition |
| `session-form.tsx` visibility select `:236-250` | `:236-247` | `:248-256` is the join-policy select |
| `details-tab.tsx :26` | row `:24-27`, strings `:26` | read-only display, unchanged |
| `session-error-ui.ts` "MISSING_DISCOVERY_FIELDS copy exists `:100`" | `:100-101` is `errorField()` mapping the code to `"area"`; it is NOT copy | the shown copy is the envelope message (DOMAIN_CODES `:55`, rendered `:181-182`), set server-side at `apps/web/lib/session-command-route.ts:592-598` |

| Fact | Evidence |
|---|---|
| `updateSession` order | payload guard `:1160-1165`; advisory lock `:1175-1177`; dedup `:1189-1217`; field checks `:1230-1268` (INVALID_VISIBILITY `:1245-1247`); `FOR UPDATE` `:1273-1294`; terminal guard `:1299-1301`; open past-guard `:1312-1322`; open billing gate `:1342-1347`; change-set `:1353-1394` (visibility `:1375-1378`); no-op `:1401-1418` (dedup row, no event, no version check); STALE_VERSION `:1428-1433`; discovery `:1452-1461`; UPDATE `:1509-1522`; past-fence `:1536-1546`; `session.updated` `:1554-1561`; `session.visibility_changed` `:1569-1578`; fence `:1590-1592`; ledger `:1600-1602` |
| One transaction | `withTenant` (`packages/db/src/tenant.ts:61`) wraps `db.transaction`; any throw rolls the whole command back, fence included |
| Fence core | `packages/db/src/public-session-fence.ts:24-30` (reason union `:9`); migration `0033`: view `:132-153` (security_barrier, fence anti-join `:147-153`), raise `:157-191` (reason allow-list `:166-169`, caller-tenant check `:173-180`, upsert replaces the token `:181-187`, EXECUTE app `:190-191`), observe `:194-204` and clear `:208-222` (EXECUTE app_worker only), grants `:237-239`; `0036` revokes app DML on `public_sessions` |
| Live grants (container psql, `plexco_test`, read only) | `public_sessions`, `public_projection_fences`: no grant to app, app_worker or readonly; `public_session_share_v`: SELECT to readonly only; EXECUTE raise: app only; observe and clear: app_worker only |
| DB CHECK | `sessions_public_capacity_chk` = NOT (public AND slots_max IS NULL) (`0024:116-118`, live `pg_constraint`): slots only; area presence is service-only |
| Writers of `sessions.visibility` | `createSession` insert `:284` and `updateSession` `:1510` only; publish `:673`, close `:1938`, cancel `:2361` set status only; `tenant.ts:126` is the test-only seam guarded by `tenant.test.ts:192-214`; no bot writer |
| PUT route | `apps/web/app/api/sessions/[id]/route.ts:25-47`: bucket `session-update` 20/min `:29`; `shapeSessionFields` `:34` (never rejects, `session-command-route.ts:336-411`); `readExpectedVersion` `:35`; command `:38-42`; response `{ session: { id, status, version } }` `:43-45`; visibility kept internal `:21-23` |
| Gate | `resolveSessionCommandContext` `session-command-route.ts:168-284`: AUTH_REQUIRED `:174`, CSRF_INVALID `:175-177`, actor 429 `:196-198`, FORBIDDEN `:200-218` (one body `:213-217`), tenant 429 `:245-249`, body `:252-280`; the detail GET uses the same capability (`apps/web/lib/session-read-route.ts:62`) |
| Host DTO already carries the fields | `SessionScalars` `packages/db/src/session-read.ts:82-103` (area `:92`, slotsMax `:95`, visibility `:96`), select `:166-170`; client mirror `apps/web/lib/sessions-api.ts:10-31` (`:20`, `:23`, `:24`); client `updateSession` `:178-184`, `command()` `:153-168` |
| Detail-view command pattern to mirror | `apps/web/components/sessions/session-detail-view.tsx`: idempotency ref `:42-43`, `closeDialog` `:140-145`, `confirm` `:147-168`, action bar `:189-197`, `ConfirmDialog` + `ApiErrorNotice` `:219-252`, toast `:254`; `refresh()` is silent (`apps/web/lib/use-sessions-data.ts:58-61`) |
| Form facts | `valuesFromSession` sets `slotsUnlimited = slotsMax === null` (`session-form-model.ts:56`); public checks `:178-187` (area `:180`, slots `:182-186`); the form focuses its error summary on any error (`session-form.tsx:63-65`, `:76-77`, `:90`); `TextField` takes no `id` or `ref` (`components/ui/text-field.tsx:7`) but spreads other input props (`:29`); area input `:184-191`, unlimited checkbox `:210-218`, slots input `:219-228` |
| Offline pattern | `useOnlineStatus` (`apps/web/lib/use-online-status.ts:15-21`); disabled writes with an `aria-describedby` hint (`components/sessions/roster-gate-hints.tsx:28-36`); proven by `context.setOffline(true)` (`apps/web/e2e/roster.spec.ts:563-576`) |
| e2e + axe infra | `@axe-core/playwright` 4.13.0 (`apps/web/package.json:23`); matrix light/dark x 375x812 + 1280x800, tags wcag2a..wcag22aa, serious/critical = [] (`apps/web/e2e/sessions.spec.ts:913-961`; the `detail` screen is `s-open`); dialog axe `:963-975`; refusal axe + layout `:754-779`, `expectDialogFits` `:62-89`; mock `failNext` / `holdNext` (`e2e/support/session-api-mock.ts:150-157`), PUT key `update` (`:262`), STALE_VERSION on a version mismatch (`:379-390`), field apply (`:395-409`); MISSING_DISCOVERY_FIELDS and the no-op branch are NOT modelled |
| Web unit infra | vitest in node, `renderToStaticMarkup` only (`apps/web/vitest.config.ts`, `components/sessions/session-form.test.tsx:1-20`): no DOM interaction, so interactive behaviour is proven in Playwright |
| DB harness (#62) | `setupRlsTestContext` (`packages/db/src/test-harness.ts:679-768`): own DB `:694-695`, `withDefinerReadLock` around migrate `:701-704`, lease after setup `:720-721`, `readonlyPool` `:726`, settled teardown and own-DB drop `:746-766`; suite context `session-service.test.ts:116`; tests within a file run sequentially (`packages/db/vitest.config.ts`, `sequence: { concurrent: false }`); `expectErrorChainToMatch` `test-harness.ts:56` |
| Existing helpers in `describe("updateSession")` | `seedTenant` `:1812`, `seedSession` `:1831-1861`, `update` `:1896-1897`, `sessionState` `:1899-1903`, `updatedEvents` `:1904-1908`, `projectToPublic` `:1942-1952`, `viewHasSession` `:1954-1959`, `baseStillProjected` `:1961-1963`, `fenceReason` `:1964-1971`, `expectUpdateReject` `:1973-1977` |
| Committed REVOKE precedent | `packages/db/src/identity-link-web.test.ts:680-694` (REVOKE EXECUTE committed, GRANT restored in `finally`, the DB is private to the file) |
| Migrations | 56 files, tail `0055_me_settings_definers.sql`; the next free number (0056) belongs to L3; L6 adds none |
| Baselines | CI on the base: CI run 38891692083 `verify` and `e2e-web` success; Security run 38891692809 Semgrep success, OSV full scan failure (ignored by rule). Local, under the DB lock: full db suite 29 files / 1225 tests pass in 84.5 s; `public-session-fence` + `session-service` 2 files / 205 tests in 7.1 s. Web unit (session-actions, session-error-ui, session-form-model, session-form, session-action-error-extra, roster-tab, session-command-route) 7 files / 246 tests in 1.4 s. `pnpm review:check` PASS (51 documents, 54 blocks). Cluster probe identical before and after each DB run (app=3688f053, app_worker=575cbd6e, readonly=182bc45a; per_pid 0; 7 databases; definers intact; 0 client sessions) |

## 3. Exposure questions (answered at the base)

1. **Can any path leave a fenced or newly private session publicly readable?** No.
   - The only public read path is `public_session_share_v` (readonly SELECT; no runtime role reads the base, `rls-invariants.test.ts:330`, grants `:628-655`).
   - A fence is removed only by `clear_public_session_fence`, EXECUTE app_worker only (`0033:208-222`, `rls-invariants.test.ts:649-654`). The toggle runs as
     app, so it can never unfence: private to public keeps the fence (VT6) and the re-published session stays denied until a projector converges (none exists).
   - Every public-to-private through `updateSession` raises inside the command transaction (`:1591` with `tx`). The leak direction is "private committed,
     fence missing"; VT3 proves a failing raise rolls the whole update back. Close and cancel raise unconditionally (C-FENCE `:3267`, C-FENCE-PRIVATE `:3280`,
     XC-FENCE `:3928`, XC-FENCE-PRIVATE `:3941`). No other writer of visibility exists (section 2).
2. **Can the toggle bypass MISSING_DISCOVERY_FIELDS?** No. The rule reads the effective area and slots on every mutate request whose result is public
   (`:1438-1461`), so a toggle, a combined patch, and a public session clearing area or slots are all refused; VT2 pins the variants the base does not test. The
   no-op branch (`:1401-1418`) only returns the current state. The route never validates (`session-command-route.ts:336-411`); INVALID_VISIBILITY collapses to
   INVALID_BODY 400 (`:475-483`, `:642-643`). The client pre-check (P5) uses the server's predicate, so it can refuse earlier but never accept what the server refuses.
3. **Any new field in a response?** No. L6 changes no server code. The PUT response stays `{id, status, version}` (`route.ts:43-45`, exact shape pinned by
   `route.test.ts:93-98`). Visibility, area and slots are already in the host-only detail DTO. Event keys are pinned exactly for "to public" (U-VIS `:2912`) and,
   by VT1, for "to private". MISSING_DISCOVERY_FIELDS carries no `details` (`session-command-route.ts:670-676`).

**Production fix in `session-service.ts`: none proven necessary.** L6 adds tests only under `packages/db` (P11). Residue for later lanes is in section 11.

## 4. Wire contract and error mapping

Request (built by `sessions-api.ts:178-184` + `command()` `:153-168`): `PUT /api/sessions/{id}?tenant={uuid}`, JSON, header `x-csrf-token`, body EXACTLY
`{ "commandId": "<uuid>", "expectedVersion": <session.version>, "visibility": "public" | "private" }`. Success 200:
`{ "data": { "session": { "id", "status", "version" } }, "error": null, "meta": { "requestId" } }`.

Refusal order: gate (AUTH_REQUIRED 401, CSRF_INVALID 403, actor RATE_LIMITED 429, FORBIDDEN 403, tenant RATE_LIMITED 429, INVALID_BODY 400 or 413), then the
command: replay of a known commandId returns the stored result; INVALID_VISIBILITY (as INVALID_BODY 400); SESSION_NOT_FOUND 404; SESSION_NOT_OPEN 409 (closed,
cancelled, or open past start); TENANT_SUSPENDED 403 (open sessions only); no-op success; STALE_VERSION 409; MISSING_DISCOVERY_FIELDS 400 (to public only).

#### Error mapping (codes verbatim from the BE catalog and `session-command-route.ts`; nothing invented)

| Code | HTTP | Source | Toggle behaviour | Copy shown |
|---|---|---|---|---|
| MISSING_DISCOVERY_FIELDS | 400 | BE `:328`; route `:461`, `:592-598`; `route.test.ts:205` | alert inside the dialog, shown state unchanged, commandId dropped (definite), plus the P5 link | envelope message `t("Thiếu thông tin bắt buộc để công khai kèo.", "Missing fields required to make the session public.")` |
| STALE_VERSION | 409 | BE `:324`; route `:466`, `:615-618`; `route.test.ts:202` | alert + "Tải lại dữ liệu" (close dialog, `refresh()`), commandId dropped | envelope `t("Kèo vừa được cập nhật — tải lại rồi thử lại.", "The session changed — reload and retry.")` |
| FORBIDDEN | 403 | BE edge #55 `:286`; gate `:200-218`; `session-command-route.test.ts:557-565`, `:599-609`; `route.test.ts:150-168` | alert, no action, commandId dropped | client `t("Bạn không có quyền thực hiện thao tác này ở CLB này.", "You are not allowed to do this in this club.")` (`session-error-ui.ts:144-151`) |
| TENANT_SUSPENDED | 403 | route `:467`, `:619`; `route.test.ts:216-222` | alert (open sessions only; a draft is exempt, U6 `:2310`) | envelope `t("CLB đang bị tạm ngưng.", "This club is suspended.")` |
| SESSION_NOT_OPEN | 409 | route `:464`, `:607-613` | alert (race with close, cancel or the start time) | envelope message |
| SESSION_NOT_FOUND | 404 | route `:463` | alert | client `t("Không tìm thấy buổi chơi này.", "This session was not found.")` (`:176-177`) |
| COMMAND_ID_CONFLICT | 409 | route `:459`, `:581-587` | alert, commandId dropped | envelope message |
| CSRF_INVALID 403 / AUTH_REQUIRED 401 / RATE_LIMITED 429 / INVALID_BODY 400 | gate | `session-error-ui.ts:136-175` | reload / redirect to `/` / retry / none | client copies |
| network, non-envelope, 5xx, any unknown code | none | `session-error-ui.ts:126-134`, `:184-191`, `:200-204` | alert + "Thử lại" with the SAME commandId; unknown code = generic message + requestId (fail closed) | client copies |

The toggle reuses `ApiErrorNotice` (`components/sessions/api-error-notice.tsx:16-67`) and `describeSessionError`; `session-error-ui.ts` does not change.

## 5. Pinned defaults (each is "default applied, pending owner sign-off"; repeat them in the PR body; L17 consolidates)

| # | Default | Value |
|---|---|---|
| P1 | Control and placement | NEW `apps/web/components/sessions/visibility-toggle.tsx`, mounted by `session-detail-view.tsx` directly below `<SessionActionBar>`: a state line, ONE action button, and a `ConfirmDialog` for BOTH directions (one code path, like publish/close/cancel). Not the FE spec's radio group (`feature_sessions_fe.md:388`): selecting a radio implies an instant change, which is either optimistic or needs a confirm anyway. `session-action-bar.tsx` and `details-tab.tsx` stay unchanged. |
| P2 | Availability (fail closed) | Rendered only when `allowedActions(session.status)` includes `edit` (draft or open) AND `session.visibility` is `private` or `public`; anything else renders no control. Disabled when `blockedReason("edit", session, now) === "started"` (open past start, mirrors the server past-guard `:1312-1322`) or when offline; each disabled reason has its own hint wired by `aria-describedby`. |
| P3 | No optimistic state | The shown state is `session.visibility` from the detail DTO, never local click state. In flight = the dialog's busy state. Success = PUT 200, then toast + `refresh()`; the state line changes only when the refetch lands. A failure leaves the last served state. The trigger button stays the same mounted element across the change, so the native dialog returns focus to it. |
| P4 | Command and idempotency | Body exactly as section 4. One commandId per dialog attempt (`crypto.randomUUID()`), kept across an uncertain failure, dropped on a definite failure (`isDefiniteFailure`), on dialog close and on success (pattern `session-detail-view.tsx:42-43`, `:140-168`). |
| P5 | Missing-field pre-check | Exported pure `discoveryGaps(session)` in `visibility-toggle.tsx` returns `"area"` when `!(typeof area === "string" && area.trim().length > 0)` and `"slots"` when `slotsMax === null`, in that order (the server predicate `:1452-1454`). Private to public with gaps sends NOTHING and shows an inline `role="alert"` refusal listing the gaps (P7 strings) and a link "Bổ sung thông tin" to `<editHref>#area` (area missing) else `<editHref>#slots`. Gaps never block public to private. A server MISSING_DISCOVERY_FIELDS (race) shows the envelope message plus the same link (plain `editHref` when the local DTO shows no gap). |
| P6 | "The form focuses the missing field" | `session-form.tsx` adds `name="area"` (area input), `name="slotsMax"` (slots input), `name="slotsUnlimited"` (checkbox), and ONE mount-only effect: read `window.location.hash`; `#area` focuses the area input; `#slots` focuses the "Không giới hạn số chỗ" checkbox when `slotsUnlimited`, else the slots input (via `formRef.current.elements.namedItem`); any other hash does nothing. The form's own submit validation keeps focusing its error summary (unchanged). `edit-session-view.tsx` and `text-field.tsx` are not touched. |
| P7 | Copy | Section 6 table, exact strings. |
| P8 | "Empty" state | = not actionable: closed, cancelled or unknown status shows no control (the action bar already says "Buổi này chỉ để xem."); an open session past its start shows the disabled control with the started hint. |
| P9 | Area presence | Unchanged: `trim().length > 0` on server and client. The visible-code-point rule (L2 OPEN item 4) is NOT applied here (OPEN 5). |
| P10 | Mock | `session-api-mock.ts` mirrors MISSING_DISCOVERY_FIELDS on PUT after its version check: effective `visibility` public and (trimmed effective area empty or effective `slotsMax` null) answers 400 `{ code: "MISSING_DISCOVERY_FIELDS", message: "Thiếu thông tin bắt buộc để công khai kèo.", statusCode: 400 }` with no write and no version bump. The no-op branch stays unmodelled. New e2e fixtures are passed per test (`open(page, path, [...fixtures(), extra])`), never added to `fixtures()` (the list tests count it). |
| P11 | DB scope | Tests only, all in `session-service.test.ts` inside `describe("updateSession")` using the existing helpers. No change to `session-service.ts` or `public-session-fence.ts`. `public-session-fence.test.ts` gets nothing: the raise-level rows are already covered (FENCE-1..3; `rls-invariants.test.ts` immediate deny `:317-328`, CAS `:548-624`, grants `:628-655`, tenant scope `:657`, unknown reason `:669-671`). |
| P12 | B3 | The exception of section 10. |

## 6. UI design

Structure: a small region `styles.toggle` (tokens only; stacked at 375 px, inline from the desktop breakpoint `min-width: 769px` that
`session-detail-view.module.css:74` and `:152` already use),
holding the state line, the action button (`variant="secondary"`), the disabled hint when present, and the refusal alert when present. No icon. Copy (HARD RULE 5):

| Use | `t(vi, en)` | Source |
|---|---|---|
| state line | `t("Hiển thị", "Visibility")` + ": " + `t("Công khai", "Public")` or `t("Riêng tư", "Private")` | reuse `details-tab.tsx:25-26` |
| action + confirm label, to public | `t("Chuyển sang Công khai", "Make public")` | new |
| action + confirm label, to private | `t("Chuyển về Riêng tư", "Make private")` | new |
| dialog title | `t("Công khai buổi này?", "Make this session public?")` / `t("Chuyển buổi này về Riêng tư?", "Make this session private?")` | new |
| dialog body | `t("Buổi sẽ chuyển sang Công khai.", "The session becomes Public.")` / `t("Buổi sẽ chuyển sang Riêng tư và không còn hiển thị công khai.", "The session becomes Private and is no longer shown publicly.")` | new, style of `session-detail-view.tsx:93-96`; no listing or marketplace claim (DD-114 D3 b) |
| toast | `t("Đã chuyển sang Công khai.", "The session is now public.")` / `t("Đã chuyển về Riêng tư.", "The session is now private.")` | new |
| busy / back | `t("Đang xử lý…", "Working…")` / `t("Quay lại", "Go back")` | `confirm-dialog.tsx:105`, `:97` |
| refusal lead | `t("Chưa thể công khai buổi này:", "This session cannot be made public yet:")` | new |
| refusal items | `t("Kèo công khai cần có khu vực.", "A public session needs an area.")`; `t("Kèo công khai cần số chỗ giới hạn.", "A public session needs a finite number of slots.")` | byte-identical to `session-form-model.ts:180`, `:182-186` |
| refusal link | `t("Bổ sung thông tin", "Add the missing details")` | new |
| started hint | `t("Buổi đã bắt đầu nên không đổi được chế độ hiển thị nữa.", "The session has started, so its visibility can no longer be changed.")` | new, tone of `session-action-bar.tsx:74-77` |
| offline hint | `t("Đang ngoại tuyến — chưa thể đổi chế độ hiển thị.", "You are offline — visibility cannot be changed right now.")` | new, tone of `roster-gate-hints.tsx:31-34` |
| errors | section 4 table | existing |

Five states of this component (each proven at 375x812, light and dark, axe serious/critical = []):

| State | What the host sees | Proof |
|---|---|---|
| loading | page load: the existing detail skeleton, no control; command in flight: dialog busy ("Đang xử lý…", Escape ignored), state line unchanged, no toast | E2, E12 |
| ready | state line + enabled button, draft or open before start | W1-W3, E1; existing axe matrix (`detail` = `s-open`) |
| empty (not actionable) | terminal or unknown status: no control; open past start: disabled button + started hint | W4, W5, E10, E12 |
| error | pre-check refusal alert with link; server refusal or failure alert inside the dialog | E4-E8, E12 |
| offline | disabled button, `aria-describedby` points at the existing offline hint; re-enabled when back online | E9, E12 |

## 7. Implementation steps (dependency order; one commit each)

1. **db tests** (DoD: VT1-VT6 green under the DB lock; `git diff --quiet` on every `packages/db` production file). Add the rows of section 8 to
   `describe("updateSession")` with the existing helpers; one local zero-write helper (version and visibility unchanged, no outbox row, no `processed_commands`
   row for the commandId, `fenceReason` null) keeps the matrix compact. Run `pnpm --filter @plexco/db exec vitest run session-service` under the lock.
2. **toggle** (DoD: W rows green, typecheck clean). NEW `visibility-toggle.tsx` (component + exported `discoveryGaps`), `visibility-toggle.module.css`,
   `visibility-toggle.test.tsx`.
3. **wiring** (DoD: typecheck, lint, existing web unit tests green). Mount it in `session-detail-view.tsx` with props `session`, `ctx`,
   `editHref={`${base}/${session.id}/edit`}`, `onDone={(m) => { setDone(m); refresh(); }}`, `onReload={refresh}`; P6 in `session-form.tsx`.
4. **e2e** (DoD: E rows and the whole Playwright suite green under the lock). P10 in `session-api-mock.ts`; one `test.describe("visibility toggle")` in
   `sessions.spec.ts`.
5. **verify** (section 9), then report. Do not push.

Commit messages are conventional with no AI reference, for example `test(db): pin the visibility toggle's fence and discovery rules`,
`feat(web): add the session visibility toggle`, `test(web): cover the visibility toggle end to end`.

## 8. Acceptance matrix

Decision-table coverage at the base: row 1 (to public) U-VIS `:2883`, U-ALLFIELDS `:2016`; row 2 only both-missing U8 `:2339` and public-to-unlimited U-CAPACITY
`:2202`; row 3 fence + immediate view deny U-FENCE `:2917`, draft U-FENCE-DRAFT `:2942`, but no exact "to private" event keys and no atomicity proof; row 4 only a
generic no-op U9 `:2472`; row 5 FORBIDDEN fully at the gate (section 4); row 6 generic U2 `:2109`, U-VERSION `:2120`, U-RACE `:2704`; row 7 C-FENCE, C-FENCE-PRIVATE,
XC-FENCE, XC-FENCE-PRIVATE (assert, do not edit). New rows add only what is missing. "Zero writes" = version and visibility unchanged, `updatedEvents` empty,
no `processed_commands` row for that commandId, `fenceReason` null.

| ID | Group | Input / precondition | Expected | Layer |
|---|---|---|---|---|
| VT1 | Happy / observability | public open session; `{ visibility: "private", expectedVersion: v }` | `{ visibility: "private", version: v + 1 }`; events exactly `[session.updated { changed_fields: ["visibility"] }, session.visibility_changed { new_visibility: "private" }]` with exact key sets `["changed_fields","session_id"]` and `["new_visibility","session_id"]`; the `processed_commands` row's `result_ref` keys are exactly `["sessionId","status","version","visibility"]` with `visibility: "private"`; `fenceReason` = `visibility_private` | db |
| VT2 | Boundary / security | `it.each`, fresh session per row, every patch with the CURRENT `expectedVersion: v` (else STALE_VERSION wins, `:1428`): (a) private, area NULL, slots 8, `{visibility: public}`; (b) area `""`; (c) area three spaces; (d) area "Quận 1", slots NULL; (e) private complete, `{visibility: public, area: ""}`; (f) private complete, `{visibility: public, slotsMax: null}`; (g) public complete, `{area: null}`; (h) public complete, `{area: "  "}` | each `SessionUpdateError` MISSING_DISCOVERY_FIELDS; zero writes | db |
| VT2c | Happy (control) | private, area NULL, slots 8; `{ visibility: "public", area: "Quận 1", expectedVersion: v }` | success, version v + 1, events `[session.updated, session.visibility_changed]` | db |
| VT3 | Failure / atomicity | public open session + `projectToPublic`; owner runs `REVOKE EXECUTE ON FUNCTION raise_public_session_fence(uuid, text) FROM app` (committed); `{ visibility: "private", expectedVersion: v }` | rejects, NOT a `SessionUpdateError`, `expectErrorChainToMatch(..., /permission denied/i)`; then visibility public, version v, zero outbox rows, no ledger row, no fence, `viewHasSession` true. `finally`: `GRANT EXECUTE ... TO app`; after it the same patch with a FRESH commandId succeeds and `fenceReason` = `visibility_private` (restore proven) | db |
| VT4 | Boundary / idempotent no-op | `it.each`: private session `{visibility: "private"}`; public projected session `{visibility: "public"}`; both with `expectedVersion: v + 5` and a fresh commandId | `{ version: v, replayed: false }`, visibility unchanged; `updatedEvents` empty; no fence; exactly one ledger row for the commandId with `result_ref.visibility` = current; for the public row `viewHasSession` stays true | db |
| VT5 | Concurrency / stale | `it.each`: (a) public projected `{visibility: "private", expectedVersion: v + 1}`; (b) private complete `{visibility: "public", expectedVersion: v + 1}`; (c) private area NULL `{visibility: "public", expectedVersion: v + 1}`; (d) public `{visibility: "private"}` with no expectedVersion | each STALE_VERSION (c proves the version check `:1428` precedes discovery `:1452`); zero writes; for (a) `viewHasSession` true | db |
| VT6 | Security / exposure | public projected; to private (v to v + 1); then `{ visibility: "public", expectedVersion: v + 1 }` | second update succeeds (v + 2); `fenceReason` still `visibility_private`; `viewHasSession` false; `baseStillProjected` true; last event `session.visibility_changed { new_visibility: "public" }` | db |
| W1 | Ready | static render, open future private session (vi) | contains "Hiển thị: Riêng tư" and an enabled button "Chuyển sang Công khai" | web unit |
| W2 | Ready | public session (vi) | "Hiển thị: Công khai" and button "Chuyển về Riêng tư" | web unit |
| W3 | i18n | the same two in `en` | "Visibility: Private" + "Make public"; "Visibility: Public" + "Make private" | web unit |
| W4 | Empty (fail closed) | status `closed`, `cancelled`, `paused`; visibility `"secret"` | no `<button` in the markup | web unit |
| W5 | Empty | open session whose `startsAt` is past | button disabled; its `aria-describedby` id exists and holds the started hint (vi and en) | web unit |
| W6 | Parity | `discoveryGaps` on: area NULL; `""`; three spaces; "Quận 1" with slots NULL; both missing; complete | `["area"]`, `["area"]`, `["area"]`, `["slots"]`, `["area","slots"]`, `[]` | web unit |
| E1 | Ready | detail of `s-open` (private) and of a public fixture | the state line shows the server's value; the button label matches | e2e |
| E2 | No optimism | `holdNext("update")`, to public, confirm | while held: confirm shows "Đang xử lý…", state line still "Riêng tư", no toast; after release: toast "Đã chuyển sang Công khai.", state "Công khai" after the refetch, focus on the toggle button; the PUT body keys are exactly `["commandId","expectedVersion","visibility"]`, `visibility: "public"`, `expectedVersion` = the fixture version | e2e |
| E3 | Happy | public fixture, to private | dialog "Chuyển buổi này về Riêng tư?", toast "Đã chuyển về Riêng tư.", state "Riêng tư", body `visibility: "private"` | e2e |
| E4 | Refusal (area) | fixture with area NULL | click: `role="alert"` lists "Kèo công khai cần có khu vực." and not the slots line; no dialog; zero PUT calls; the link goes to `.../edit#area` and the "Khu vực" input is focused | e2e |
| E5 | Refusal (slots) | fixture with `slotsMax: null`; then one with both missing | the slots line only; link to `#slots`, the "Không giới hạn số chỗ" checkbox is focused; both missing lists both lines and the link targets `#area` | e2e |
| E6 | Server refusal | complete fixture; `failNext("update", MISSING_DISCOVERY_FIELDS 400)` | dialog alert shows the message, state unchanged; confirming again sends a NEW commandId | e2e |
| E7 | Stale | mock version bumped after load | alert "Kèo vừa được cập nhật"; "Tải lại dữ liệu" closes the dialog and shows the new version | e2e |
| E8 | Uncertain failure | `failNext("update", "network")` | "Không có kết nối mạng" + "Thử lại"; the retry succeeds and both recorded PUT bodies carry the SAME commandId | e2e |
| E9 | Offline | `context.setOffline(true)` then `false` | button disabled, its `aria-describedby` element contains "Đang ngoại tuyến"; enabled again online | e2e |
| E10 | Empty | `s-past-open`; `s-closed`; `s-cancelled` | past: disabled + "Buổi đã bắt đầu nên không đổi được chế độ hiển thị nữa."; terminal: no toggle button | e2e |
| E11 | i18n | English club | "Visibility: Private", "Make public", refusal "A public session needs an area.", toast "The session is now public." | e2e |
| E12 | a11y + layout | light and dark at 375x812: busy dialog, refusal alert, server-error dialog, past-start disabled, offline disabled | axe serious/critical = [] for each; page states: `document.documentElement.scrollWidth <= clientWidth`; dialog states: `expectDialogFits` | e2e |
| R1 | Regression | the whole db suite, web unit suite, Playwright suite, golden path locally | green; no existing test edited or removed | all |

Groups with no new row, and why: Authorization (the gate decides before the command; every reason gives the same 403, pinned by
`session-command-route.test.ts:557-565`, `:599-609` and `route.test.ts:150-168`; the detail page itself needs `session.manage`); Migration (none; existing rows
unaffected, no schema read changes); Observability is VT1 and VT6 (the outbox rows are the audit trail).

## 9. Verification (cite measured output, `| tail -40`)

DB and e2e runs take the shared lock: atomic `mkdir "/Users/maingocanh/Projects/Plexco app/Claude outputs/plexco-phase3/status/.db-e2e.lock"` plus `owner.txt`
(lane, role, ISO time, command), poll every 30 s, `rm -rf` right after the run (use a trap). Run
`"/Users/maingocanh/Projects/Plexco app/Claude outputs/plexco-phase3/status/P3-S2-notes/cluster-probe.sh" <label>` before and after each run: the role fingerprint
must not change and `per_pid` must stay 0. Never run `docker compose up` from the worktree.

| # | Command | Expected |
|---|---|---|
| V1 | `pnpm typecheck`; `pnpm lint`; `pnpm format:check`; `pnpm build` | exit 0 |
| V2 | `NODE_ENV=test DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm --filter @plexco/db exec vitest run public-session-fence session-service` (lock) | all pass (205 at the base plus the VT rows). The lane's `pnpm --filter @plexco/db test -- public-session-fence session-service` does NOT filter: measured, it runs all 29 files / 1225 tests |
| V3 | `NODE_ENV=test DATABASE_URL_TEST=<same> pnpm --filter @plexco/web test` (lock: four web test files use Postgres) | all pass |
| V4 | `NODE_ENV=test DATABASE_URL_TEST=<same> pnpm -w test` (lock) | all pass; known flakes rerun once |
| V5 | `pnpm --filter @plexco/web exec playwright test` (lock) | pass; `pwa.spec.ts:39` rerun once |
| V6 | golden path locally with `apps/web/e2e/golden-path.config.ts` (lock) | pass |
| V7 | `pnpm review:check:changed`, then `pnpm review:check` | PASS |
| V8 | `git diff --name-only b0bf565ed72d8c4be3f47d3fe7a4e0e382605928..HEAD` | this readiness file plus only: `packages/db/src/session-service.test.ts`, `apps/web/components/sessions/{visibility-toggle.tsx,visibility-toggle.module.css,visibility-toggle.test.tsx,session-detail-view.tsx,session-form.tsx}`, `apps/web/e2e/sessions.spec.ts`, `apps/web/e2e/support/session-api-mock.ts` |
| V9 | `git diff --quiet b0bf565ed72d8c4be3f47d3fe7a4e0e382605928..HEAD -- packages/db/src/session-service.ts packages/db/src/public-session-fence.ts packages/db/schema.ts packages/db/migrations apps/web/app apps/web/lib` | exit 0 (no production DB change, no migration, no route or lib change) |
| V10 | `git diff --numstat b0bf565ed72d8c4be3f47d3fe7a4e0e382605928..HEAD` minus this file | total at most 700 changed lines; production files (`visibility-toggle.tsx`, `.module.css`, `session-detail-view.tsx`, `session-form.tsx`) at most 230 |

Impact: the GitNexus `plexco-app` index was built at `dd5375f` (2026-09-26) and does not contain `apps/web/components/sessions/` (measured: absent at that
commit), so the grep fallback applies; state it in the PR body. Callers measured with `git grep` in the worktree: `SessionDetailView` only at
`apps/web/app/c/[tenantId]/sessions/[id]/page.tsx:9`; `SessionForm` at `edit-session-view.tsx:74` and `new-session-view.tsx:39` (the hash effect is inert on `/new`);
`allowedActions` and `blockedReason` reused read-only; client `updateSession` already used by `edit-session-view.tsx:93`. GitNexus rates `raisePublicSessionFence`
HIGH (3 callers: update, close, cancel) but L6 does not edit it. All edited symbols are LOW; none HIGH or CRITICAL.

## 10. Budget (B3 exception, recorded here and in the P3-S2 report)

Estimate about 635 changed lines in 3 modules, 0 migrations: `packages/db/src` 190 (tests only), `apps/web/components/sessions` 263 (toggle 140, CSS 22, unit
test 75, detail view 10, form 16), `apps/web/e2e` 182 (spec 170, mock 12). Production lines about 188; tests about 447. Over the default line budget (about 300),
within the module and migration budget.

- **Modules named:** `packages/db/src` (tests only), `apps/web/components/sessions`, `apps/web/e2e`.
- **Why a split breaks coherence:** (1) this is a P1 exposure control and the review questions span both layers: VT2, VT3 and VT6 are the proof for the control the
  UI adds, so one reviewer must judge them together; (2) gate B2 lets public-byte and RLS invariant tests land with or before the control, never after, and a
  tests-only PR first would add a third PR and merge round to a session planned as exactly L3 and L6, for tests of code already on main (nothing to sequence);
  (3) the UI cannot ship without its e2e and axe proof, which is DD-122's merge condition; (4) about 70 % of the lines are tests.
- **Compatibility proof:** V9 (no production change under `packages/`, no migration, no route or lib change); the PUT response shape stays pinned by
  `route.test.ts:93-98`; the web change is additive (a new component, three `name` attributes and one mount-only effect in the form, one mount in the detail view);
  baseline suites stay green (V2-V6); rollback = revert the PR.
- **Cap:** V10 (at most 700 lines in total, at most 230 production). Over the cap: compact with `it.each` and shared helpers, never drop a matrix row; still over:
  stop and report the measured numbers (no silent expansion).

## 11. OPEN (out of scope: report, do not edit)

1. RUN doc (all lanes): `pnpm --filter @plexco/db test -- <names>` runs the whole db suite, because vitest ignores names after `--` (measured above); the filtered
   form is `pnpm --filter @plexco/db exec vitest run <names>`. For the orchestrator and L17.
2. `session-error-ui.ts:100-101` maps MISSING_DISCOVERY_FIELDS to the area field even when slots is the gap. Unreachable from the form while its client checks
   mirror the server; unchanged by L6.
3. An OPEN public session past its start cannot be made private: the update past-guard (`:1312-1322`) answers SESSION_NOT_OPEN, and the host's only
   privacy-reducing path is close (fence `closed`). Exposure is nil in phase 1 (no projector). A visibility-only public-to-private exception needs an owner
   decision on BE edge #11.
4. L3 cross-check: a stale-draft auto-expiry (draft to cancelled) is a privacy-reducing transition; DD-12 needs `raise_public_session_fence(..., 'cancelled')` in
   the same transaction (shared helper `public-session-fence.ts:24-30`). L3 must not edit `session-service.ts`, so its new path must raise the fence itself.
5. Visible-code-point area (L2 OPEN 4): an area made only of a variation selector passes the trim rule (`:171-185`, `:622-638`, `:1452-1454`) and the P5
   pre-check, then renders blank. Not a leak; candidate L10a, where public rendering lands.
6. Re-public keeps the fence by design; the future projector lane must CAS-clear it on convergence (`0033:50-65`) or a re-published session stays undiscoverable.
7. Docs for L17: `feature_sessions_fe.md:236`, `:355` MISSING_DISCOVERY_FIELDS copy names sport and time (always present on an existing session) and `:388` pins a
   radio group (P1 differs); Product spec `:440` public copy promises a Marketplace listing (phase-later, DD-114 D3 b); the BE spec has no PUT request/response
   example (`route.ts:21-23`).
8. The e2e mock still bumps the version on a no-op PUT (the real command does not).
9. The form's own validation focuses the error summary, not the field (`session-form.tsx:63-65`); P6 adds field focus only for the deep link.

## 12. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = `git rev-parse origin/main` = the worktree HEAD at step 0; every TARGET_FILES path exists | PASS |
| 2 | Decisions in scope final | owner "Phase 3 plan approved" (2026-10-16); lane `OWNER DECISIONS NEEDED: none`; DD-114 D3 (b); DD-122; P1-P12 pinned | PASS |
| 3 | Scope IN/OUT and owner clear | lane FILES IN SCOPE and NEGATIVE SCOPE; sections 5 and 9 (V8, V9); L6 is the only `session-service.ts` editor in P3-S2 and edits only its test | PASS |
| 4 | Dependencies classified | L2 MERGED (#61 = base; `packages/db/src/text-safety.ts` exists, imported at `session-service.ts:19`); 0033 fence, view and grants live; file-disjoint from L3 | PASS |
| 5 | Live schema and code match | section 2, each row measured at the base, grants measured live | PASS |
| 6 | Data, API, state, auth contract | section 4: existing PUT, exact body, unchanged response, gate FORBIDDEN, catalog codes | PASS |
| 7 | Fail-closed, idempotency, order | refusal order and zero-write rows (VT2, VT5); atomic fence (VT3); commandId rule (P4); unknown status or visibility renders no control (P2) | PASS |
| 8 | Open questions in scope = 0 | P1-P12 pinned as defaults; the residue in section 11 is out of scope | PASS |
| 9 | Acceptance matrix with expected results | section 8 | PASS |
| 10 | Migration, security, rollback | no migration (V9); exposure questions answered (section 3); opus/max reviewer; rollback = revert the PR | PASS |
| 11 | First slice hard dependencies merged | L2 merged in the base | PASS |
| 12 | Implementation handoff ready | sections 5-10; the worktree exists at the base with deps installed and is clean | PASS |

## 13. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-16
AUTHORITY_SHA: b0bf565ed72d8c4be3f47d3fe7a4e0e382605928
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-templates/web-mvp-phase3-2026-10-16-RUN.md (lane contract, read only)
  - docs/features/FE/feature_session_management.md (Reviewed product spec, read only)
  - docs/features/BE/feature_session_management_tech.md (Reviewed BE spec, read only)
  - packages/db/src/session-service.test.ts
  - packages/db/src/session-service.ts (read only: no change expected)
  - packages/db/src/public-session-fence.ts (read only)
  - packages/db/src/public-session-fence.test.ts (reviewed, no change expected)
  - packages/db/migrations/0033_public_projection_fences.sql (read only)
  - packages/db/migrations/0024_public_visibility_capacity_check.sql (read only)
  - apps/web/app/api/sessions/[id]/route.ts (read only: wire contract)
  - apps/web/lib/session-command-route.ts (read only: gate and error mapping)
  - apps/web/lib/session-actions.ts (reviewed, no change expected)
  - apps/web/lib/session-error-ui.ts (reviewed, no change expected)
  - apps/web/components/sessions/session-detail-view.tsx
  - apps/web/components/sessions/session-form.tsx
  - apps/web/components/sessions/session-action-bar.tsx (reviewed, no change expected)
  - apps/web/components/sessions/details-tab.tsx (reviewed, no change expected)
  - apps/web/e2e/sessions.spec.ts
  - apps/web/e2e/support/session-api-mock.ts
SLICE: p3-m6-visibility-toggle
IN_SCOPE: a host-facing public/private control on the existing PUT /api/sessions/[id] (updateSession): NEW apps/web/components/sessions/visibility-toggle.tsx with an exported discoveryGaps pre-check, its .module.css and .test.tsx, mounted below the action bar in session-detail-view.tsx; a confirm dialog for both directions, no optimistic state, one commandId per attempt; an inline refusal for a public session that lacks area or a finite slots_max with a deep link that the session form turns into focus on the missing field (name attributes plus one mount-only hash effect in session-form.tsx); the e2e mock mirrors MISSING_DISCOVERY_FIELDS; DB tests VT1-VT6 in session-service.test.ts pinning exact to-private events, every discovery gap, fence atomicity, the visibility no-op, stale toggles and the re-public fence; e2e and axe proof of the five states at 375px light and dark
OUT_OF_SCOPE: any migration (else HALT); any change to session-service.ts, public-session-fence.ts, schema.ts, routes, api-contract or apps/web/lib; a public_sessions writer, projection or fence clear; re-granting public_sessions SELECT; a new command or response field; discovery UI (L12); the visible-code-point area rule (L10a); a past-start privacy exception (owner, BE edge 11); edit-session-view.tsx and text-field.tsx; session-action-bar.tsx and details-tab.tsx edits; Reviewed spec, decisions and backlog edits (L17)
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: L2 p3-session-text-control-chars merged as PR 61 (merge commit b0bf565ed72d8c4be3f47d3fe7a4e0e382605928; probe packages/db/src/text-safety.ts exists); migration 0033 fence, guarded view and grants live on main
PRIOR_SLICES: L2 p3-session-text-control-chars (merged)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration and no new input surface; exposure questions answered at the base and pinned by VT2, VT3 and VT6; opus/max reviewer
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: section 7 step 1 - add VT1 to VT6 to describe updateSession in packages/db/src/session-service.test.ts with the existing helpers, run pnpm --filter @plexco/db exec vitest run session-service under the DB lock, commit
REMAINING_BLOCKERS: none
```
