# Web MVP Phase 3 - thư viện prompt lane (M6, M9, M10) · 2026-10-16

> **Mục đích:** thư viện prompt agent-facing cho Phase 3 của Web MVP, chạy local-only: M6 (sync live, public/private), M9 (phía player, discovery, giá theo giới tính), M10 (in-app chat).
> Phần dẫn tiếng Việt cho owner; mọi khối `text` là English (agent-facing), không có dấu tiếng Việt.
>
> **NOT an authorization to code.** Authority = `docs/sessions/web-mvp-phase3-plan.md` (verdict) + the per-lane CODE_READY verdict written in each session's step 0 (S3).
> Chưa có verdict hoặc lane bị `NOT_CODE_READY` thì lane đó chỉ được AWAIT, không được viết code.
>
> **Owner decisions D1..D5 -> số DD** (số tiếp theo còn trống đo tại `3546f6b`: DD-132 là lớn nhất; nếu `decisions.md` đánh số khác thì `decisions.md` thắng):
> D1 Occupancy authority -> DD-133 · D2 M6 delivery policy -> DD-134 · D3 M9 join + tiền không ngân hàng -> DD-135 · D4 M10 chat MVP cut -> DD-136 · D5 Wave-A exit gate + Phase 3 envelope -> DD-137.
> Quy tắc nền: DD-132 / OD-0 (không bank, không billing, không nhắc tự động, không deploy DO, không M7/M8/M11/M12/M13; tiền chỉ `cash | attested_transfer`; M9 chỉ phụ thuộc M6).

## S0. Phase 3 chạy như thế nào

Conductor (session local của owner) -> **một orchestrator cho mỗi session P3-S1..P3-S10** -> workers. Mỗi lane = một PR.

- **Conductor** không sửa code. Nó tạo orchestrator theo thứ tự S1..S10; brief của orchestrator = block session trong S3 + block S1 + các block lane (S2) của session đó.
- **Orchestrator** tạo workers: readiness reviewer, writer, code reviewer, security reviewer (khi lane yêu cầu), merge clerk. Workers không tạo agent con. Tối đa 3 writer chạy đồng thời trong một session.
- **Một lane = một branch + một worktree + tối đa một writer = một PR.** Lane có migration chạy tuần tự từng cái một (số migration kế tiếp đo tại base của lane, không ghi cứng trong prose).
- **Step 0 của mỗi session:** với từng lane, readiness reviewer kiểm lại sự thật hiện hành tại base của session và ghi verdict của lane. `CODE_READY` mới được viết code; `NOT_CODE_READY` thì lane AWAIT với blocker chính xác, các lane khác tiếp tục.
- **Vòng đời một lane:** readiness -> test-first -> verify -> orchestrator push + mở PR -> review độc lập (tối đa 3 vòng) -> security round (lane có P1 auth/money/external input) -> CI GREEN -> dòng `MERGE_READY`.
- **Merge round sau mỗi session:** merge là việc của owner (RUN gốc: OWNER-ONLY). Conductor đưa danh sách `MERGE_READY` theo thứ tự phụ thuộc; chỉ khi owner đã cho phép một merge clerk trong chính session đó thì clerk merge theo thứ tự ấy, nếu không conductor dừng với `RESULT: AWAIT` (merge session N). Sau mỗi merge, PR kế tiếp của stack được cập nhật bằng `git merge --no-ff origin/main` (không rebase).
- **P0 không bao giờ là lane:** bật `OUTBOX_DISPATCH_SCHEDULE_ENABLED`, nối bot token Zalo thật, nhắn người dùng thật chỉ là bước của owner; agent chỉ chuẩn bị runbook.
- **AWAIT** = lane chờ đúng MỘT thứ bên ngoài (chữ ký một quyết định D1-D5, một lần merge, một bước P0) kèm một đề xuất và điều kiện resume nhị phân; chỉ lane phụ thuộc bị dừng, lane khác chạy tiếp.
- **HALT** (cấp lane) = breaker cứng, không có đường vòng: quá 3 vòng review chưa CLEAN (`MAX_ROUNDS`), cùng một vùng code bị sửa 3 vòng liên tiếp (`REGION_THRASH`), cần file ngoài FILES IN SCOPE (`SCOPE_DRIFT`), cần migration/secret không có trong brief, base lệch (`BASE_MISMATCH`). Orchestrator báo lên conductor dưới dạng `RESULT: BLOCKED`.
- **Local-only:** không staging, không DigitalOcean, không cờ production, không provider thật. Mỗi milestone đóng bằng một lần chạy golden path local mở rộng (runbook `docs/runbooks/local-mvp-smoke.md`).
- **Ngoài phạm vi toàn bộ plan:** PR #50 (M5 đóng băng, chỉ-owner) và mọi file của nó; mọi thứ DD-132 đã gỡ.

## S1. Quy tắc vận hành Phase 3

Khối này tự đủ: dán nguyên khối vào brief của mọi worker, kèm đúng một block lane (S2) và một dòng task.

```text
PLEXCO WEB MVP PHASE 3 - OPERATING RULES (worker brief = this block + one lane block + one task line)
RUN: unattended; nobody answers questions. Never ask: do the brief, or stop and report why you could not. Workers never spawn subagents.
SCOPE: do exactly the brief; stay inside FILES IN SCOPE and the lane worktree; anything else you notice goes under OPEN as OUT_OF_SCOPE.
  The repo root checkout ("$HOME/Projects/Plexco app") is read-only for agents: never check out, pull, reset, stash or edit there.
  Read current main with `git show origin/main:<path>`. In zsh write ${ref}:path.
  Before changing a schema, data model or architecture read packages/db/schema.ts, packages/db/migrations/*.sql, the feature spec
  (docs/features/FE/feature_<x>.md), its BE tech doc (docs/features/BE/feature_<x>_tech.md) and docs/standards/decisions.md.
  Never create tables parallel to persons / accounts / channel_identities / memberships.
HARD RULES (a violation is a real leak):
1. RLS fail-closed: every tenant-scoped query goes through tenantRepo / withTenant; never from a route handler or client code.
2. Money and PII never reach a public surface; public_sessions holds the whitelist only, and the invariant tests stay green.
3. No multi-master: Postgres + domain services are canonical; web and chat surfaces send commands and read projections.
4. A money-bearing claim or identity merge needs a strong factor: verified email on web, single-use link_code on the bot (DD-50).
   Name, alias or display name is never enough.
5. Every user-facing string is t(vi, en). No key-based i18n.
PROGRAM FACTS (owner rulings, do not re-decide): one shared VND formatter for the web (OD-4b, apps/web/lib/money.ts); no bank integration (no SePay,
  no ApiPay), no billing or host_pro paywall (all clubs
  get all features), no automatic reminders, no DigitalOcean, no secret or Google OAuth provisioning. Payments are manual only:
  cash | attested_transfer, partial payments allowed, reversal owner-only (money.correct) until a grant UI exists. Local-only.
REVIEW (DD-122 D4, owner 2026-10-12; Codex waived): NO codex-review-pin.sh, NO scope-gate register/ready, NO ap-finish. Review =
  an independent Claude reviewer that did not write the code (diff + specs + HARD RULES; findings BLOCKING / SHOULD_FIX / NIT with
  file:line and a one-line failure scenario; trust code, not comments or PR text), at most 3 rounds. A second opus/max security
  reviewer for auth, permission, secret, money or external input. Fixes after the final round are labelled "fix applied after the
  final round, not re-reviewed (3-round cap)". PR body carries: "Codex waived by owner 2026-10-12; reviewed by independent Claude subagent".
MODELS: writer opus/max for P1 and complex work (auth, identity, money, RLS, SECURITY DEFINER, migrations, webhooks, concurrency),
  sonnet/high for UI wiring, copy, e2e specs, docs, mechanical merges. Reviewer opus/max for money/auth/identity/security/SQL/
  concurrency and for any opus writer; opus/high for other code; sonnet/high for docs-only and mechanical merges. Readiness
  reviewer = same model and effort as the lane's code reviewer. Orchestrators: Fable xhigh, or opus/max while the Fable limit holds.
ENVIRONMENT: one shared local Postgres (compose) and one e2e port => one lock: never two DB suites, migrations or e2e runs at once.
  Never `docker compose down -v`. Compose started from another checkout re-binds the Postgres mount there: re-bind by running compose once with the
    root checkout as the working directory (a command, never a file edit; data persists).
  `pnpm db:bootstrap` as superuser (DATABASE_URL_MIGRATION) BEFORE migration 0054 on any older DB (old-text 0054/0055 => sha256 guard
  fails => reset the DB). No host psql: use the container psql. plexco_smoke: ENCRYPTION_KEY is fixed in ~/.plexco-smoke-encryption-key;
  a lost key means drop and recreate ONLY plexco_smoke; never touch plexco or plexco_test. Roles app / app_worker / readonly are
  cluster-global: re-run the password step of the runbook after every full test run. Always NODE_ENV=test. Sandbox off for git fetch/push,
  gh, git worktree add, Docker and local port binding.
KNOWN FLAKES (rerun ONCE; a second red is real): apps/web/e2e/pwa.spec.ts:39 offline test; db/bot suites on the cluster-global
  app_worker password clash (test-harness.ts:90 vs apps/bot *_jrd) and "tuple concurrently updated"; load-only timeouts (JCL-4, JCL-12, BR-5).
GIT: worktree = .autopilot/worktrees/<slug>; before writing `git -C <worktree> status --porcelain` is empty and no index.lock exists
  under `git rev-parse --git-dir`. Writers commit in the worktree and do NOT push (the orchestrator pushes). Never rebase a pushed
  branch, never force-push, never push to main, never merge or close PRs, never delete branches, never git worktree prune/remove.
  Cascades and catch-ups use `git merge --no-ff`; resolve conflicts mechanically (keep both sides' intent); a semantic conflict is
  reported, not guessed. Commits: conventional, no AI references. Migrations are append-only: next free number measured at your base.
VERIFY (cite measured output, `| tail -40`): pnpm typecheck; pnpm lint; pnpm format:check; pnpm review:check:changed; pnpm build;
  NODE_ENV=test pnpm --filter @plexco/web test; NODE_ENV=test DATABASE_URL_TEST=... pnpm -w test; Playwright e2e when UI changed
  (pnpm --filter @plexco/web exec playwright test); golden path only locally (apps/web/e2e/golden-path.config.ts, never in CI).
CI GREEN: check "verify" passed and every other check is pass or skipping; "OSV full dependency scan" is ignored (red on main, owner timing).
IMPACT: GitNexus impact before editing a symbol and detect_changes before every commit; if GitNexus is unavailable, a grep of callers
  stated in the PR body is the fallback. Report blast radius; warn on HIGH or CRITICAL.
REPORT: STATUS: done | partial | blocked / HEAD: <full sha> / CHANGED / CHECKS: <command> -> pass|fail / OPEN. Orchestrator last line
  per PR: MERGE_READY #<n> head=<full 40-char sha> by=<S>. Last line of a session report: RESULT: DONE | CONTINUE | AWAIT | BLOCKED.
```

## S2. Lane prompts L0..L17

Mỗi block là một prompt worker/orchestrator-ready (English). Đường dẫn đo tại `origin/main` `3546f6b`; `NEW` = file chưa tồn tại. Số dòng là tham chiếu, lane tự đo lại tại base của mình.
Quy ước chung của mọi block: `OWNER DECISIONS NEEDED` chưa ký => lane đó AWAIT (chỉ lane đó); `UNPINNED` = chưa có mã/giá trị trong spec hay BE doc => lane tự ghim, ghi vào PR body và `decisions.md` là "default applied 2026-10-xx, pending owner sign-off".
Mã lỗi mới phải được thêm vào `API_ERROR_CODES` (`packages/core/src/api-contract.ts`) cùng test và bản map ở `apps/web/lib/session-command-route.ts`.

### L0 - p3-docs-decisions-sync (docs, P2)

```text
LANE: L0 p3-docs-decisions-sync
GOAL: Record the owner-signed D1-D5 (DD-133..DD-137) as signed and propagate them into the specs; fix the measured spec drift; refresh the program
  ledger. Docs only.
MILESTONE: all (Phase 3 prerequisite)    RISK: P2 (docs)
BASE: origin/main at session start (git fetch first; record the full SHA in the report)
WORKTREE: .autopilot/worktrees/p3-docs-decisions-sync    BRANCH: docs/p3-docs-decisions-sync
DEPENDS ON: owner signs D1-D5 (merge of the Phase 3 plan PR, or the words "Phase 3 plan approved" plus any D-overrides)
OWNER DECISIONS NEEDED: D1-D5. An unsigned Dn => skip only the edits that depend on it and list them under OPEN.
FILES IN SCOPE (all exist; re-measure lines):
- docs/standards/decisions.md (flip DD-133..DD-137 to signed; no other row changes); docs/autopilot-backlog.md;
  docs/sessions/web-mvp-program-status.md; plans/261012-1400-web-mvp-program/plan.md
- D1 occupancy sync: docs/product/TDD.md (:111, :306, :673, :676); docs/standards/business-rules.md (BL-DSC-1 :50, BL-CBF-3 :63, BL-SES-2 :75); the
  Product + BE pairs of feature_channel_booking_funnel, feature_marketplace_discovery, feature_session_management under docs/features/{FE,BE}/;
  docs/channels/web/FE/feature_booking_funnel_fe.md
- Drift to fix: players.person_id and sessions.price and tenants.display_name in BE/feature_player_view_tech.md (:97-122) and
  BE/feature_channel_booking_funnel_tech.md (:237, :240); memberships.role in FE/feature_cross_club_join.md (:159); players.status 'pending' (:141
  same file); chat kind 'group' and chat_members.last_read_at in FE/feature_inapp_chat.md (:78, :215, :659) vs schema last_read_created_at +
  last_read_message_id (0031); two booking error-code sets in BE/feature_channel_booking_funnel_tech.md (:305 vs :330-340); discovery route names
  BE/feature_marketplace_discovery_tech.md (:26-29 vs :109-110); stale source pins in docs/channels/web/FE/*_fe.md headers
- Stale contract/manifest: docs/autopilot/contracts/autopilot-session-publish-public-projector.md and
  docs/autopilot-manifests/session-publish-public-projector.json (mark superseded by D1 + L10; skip any file the kit updater owns)
- Ledger: docs/sessions/2026-10-14-web-mvp-program-handoff-2.md pointer; ledger rows to 3546f6b (#57 and #51 merged); backlog row
  web-bot-vnd-display-convention -> merged; re-count the docs-drift row; plan.md status pointer
NEGATIVE SCOPE: no code, tests or migrations; no new decision numbers; never edit a Reviewed spec for an unsigned decision; Reviewed specs get a
  version bump + one changelog row, dated history rows are never rewritten; no handoff-3 (L17).
MODELS: writer sonnet/high; reviewer sonnet/high; security none; readiness sonnet/high.
DECISION TABLE: none (docs only).
TESTS: none (docs). Every path:line you write is re-verified with git grep at the base.
ACCEPTANCE COMMANDS: pnpm format:check; pnpm review:check:changed; pnpm review:check; git diff --name-only <base>..HEAD lists only docs/ and plans/.
REVIEW PLAN: one sonnet/high reviewer, max 3 rounds; question list = each edit matches the signed decision text, no dated row rewritten, every cited
  path exists.
DONE WHEN: signed Dn recorded; each spec sentence that contradicted a signed Dn is fixed or listed as OPEN; ledger at 3546f6b or newer; checks above
  pass.
```

### L1 - p3-ci-flake-hardening (infra, P2)

```text
LANE: L1 p3-ci-flake-hardening
GOAL: Remove the known suite flakes that slow every DB-touching lane. Test code only.
MILESTONE: infra    RISK: P2
BASE: origin/main at session start (git fetch first; record the full SHA)
WORKTREE: .autopilot/worktrees/p3-ci-flake-hardening    BRANCH: fix/p3-ci-flake-hardening
DEPENDS ON: none
OWNER DECISIONS NEEDED: none
FILES IN SCOPE (all exist):
- packages/db/src/test-harness.ts (ROLE_PW :89-91; ALTER ROLE at :530; teardown around :866-897); packages/db/src/test-harness.test.ts
- apps/bot/src/test-db.ts (setAppWorkerPasswordRaceSafe :46-60); apps/bot/src/test-harness.ts; apps/bot/src/dispatcher.test.ts:25,
  preflight.test.ts:24, schedule.test.ts:35 (APP_WORKER_PASSWORD "plexco_test_worker_jrd")
- packages/db/src/tenant-capability-authority.test.ts (:455-466 bare ALTER ROLE app, :508 appPool without an error listener => 57P01)
- packages/db/src/rls-invariants.test.ts (JCL-4, JCL-12 load timeouts near :2008); packages/db/src/migrate.test.ts (:1372 BR-5);
  packages/db/src/roster-service.test.ts (:235-241); apps/bot/src/preflight.test.ts:209 (JSO-2) and apps/bot/src/schedule.test.ts:291 (JSO-5)
- apps/web/e2e/pwa.spec.ts (:39 offline navigation test); apps/web/playwright.config.ts only if the root cause is there
NEGATIVE SCOPE: no production code, no migration, no CI workflow edit, no loosened timeout or retry-count to hide a flake (find the root cause); never
  touch the databases plexco, plexco_test or plexco_smoke; per-pid leaked test DBs (about 85) are removed ONLY by the exact per-pid name pattern the
  harness creates (measure it first), never by a broad plexco_% drop.
MODELS: writer opus/max; reviewer opus/max; security none; readiness opus/max.
DECISION TABLE: none (test code only; no money or permission branch).
TESTS (what must become deterministic): one shared app_worker password (or serialised ALTER ROLE) so the db and bot suites can run in parallel on one
  cluster; the cluster-global app/app_worker/readonly passwords are restored at teardown; no unhandled 57P01 in tenant-capability-authority.test.ts;
  JCL-4, JCL-12, BR-5 and roster-service timeouts fixed at the cause; pwa.spec.ts:39 root cause recorded in the PR body.
ACCEPTANCE COMMANDS: state N and cite results. N=5 parallel runs of the db + bot + web suites on the one cluster with 0 flakes (rerun counts as a
  flake); pwa.spec.ts 8 consecutive local runs, baseline was 3/8 red, target 0/8; then the S1 VERIFY set; count leaked per-pid DBs before and after
  one full run (target: no growth).
REVIEW PLAN: opus/max reviewer, max 3 rounds; questions = does any change weaken an assertion, hide a race, or alter production behaviour; is cleanup
  limited to the exact pattern.
DONE WHEN: N repeated parallel runs show the flakes gone, the leak stopped, numbers cited; the app_worker password section of
  docs/runbooks/local-mvp-smoke.md is listed under OPEN if the manual restore step became unnecessary.
```

### L2 - p3-session-text-control-chars (M9 prerequisite, P2)

```text
LANE: L2 p3-session-text-control-chars
GOAL: Reject control, bidi and newline characters in the session text fields players will see (area, venue_name, venue_address) before the player view
  ships, so a venue name cannot be spoofed.
MILESTONE: M9 prerequisite    RISK: P2 (input validation; the reviewer also covers the input-security question, no second round)
BASE: origin/main at session start (git fetch first; record the full SHA)
WORKTREE: .autopilot/worktrees/p3-session-text-control-chars    BRANCH: fix/p3-session-text-control-chars
DEPENDS ON: none
OWNER DECISIONS NEEDED: none
FILES IN SCOPE (all exist):
- packages/db/src/session-service.ts (isOptionalText :107 only rejects NUL; callers :203 and :1248; isOptionalVenueAddress :111);
  packages/db/src/session-service.test.ts
- packages/db/src/me-settings.ts (HIDDEN_CHAR and the visible-code-point rule, 0055 c_reject precedent: reuse that predicate, do not invent a second
  one; extract to a shared module if needed: NEW packages/db/src/text-safety.ts)
- apps/web/lib/session-form-model.ts (+ session-form-model.test.ts); apps/web/components/sessions/session-form.tsx; apps/web/lib/session-error-ui.ts
  (+ test) for the t(vi, en) copy
NEGATIVE SCOPE: no migration; no api-contract.ts change (INVALID_TEXT_FIELD collapsing to 400 INVALID_BODY is backlog row
  session-venue-address-error-field-contract, separate); no new session fields (the session row has only area, venue_name, venue_address as free text;
  there is no title or notes column); guest-note text and display names keep their existing rules.
MODELS: writer sonnet/high; reviewer opus/max (input validation = security); security: the same reviewer; readiness opus/max.
DECISION TABLE: none (validation only; no money or permission branch).
TESTS: each of area, venue_name, venue_address rejects U+0000, U+202E (bidi override), U+200B (zero-width), U+2028, U+2029, "\n", "\t", a Cc control,
  on create AND update, as INVALID_TEXT_FIELD with zero writes (no row, no outbox event); accepts Vietnamese diacritics, emoji with variation
  selector, and the empty/null clear; the venue_address 200-char cap still holds; web form shows t(vi, en) inline error and blocks submit.
ACCEPTANCE COMMANDS: S1 VERIFY set; NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test -- session-service; NODE_ENV=test pnpm --filter
  @plexco/web test.
REVIEW PLAN: opus/max reviewer, max 3 rounds; questions = bypass by normalisation or by the update path, set parity with the 0055/me-settings rule, no
  legitimate Vietnamese text rejected.
DONE WHEN: both write paths reject the set with zero writes, tests cover it, one shared predicate, S1 checks pass.
```

### L3 - p3-m6-outbox-delivery-core (M6, P1)

```text
LANE: L3 p3-m6-outbox-delivery-core
GOAL: Replace productionStubDeliver as the required consumer with a durable projector registry; bounded retry + DLQ with owner-only replay; a NOTIFY wake-up so sync-lag p95 <= 3 s is reachable; the shared
  scheduler + stale-draft auto-expiry; flag stays OFF.
MILESTONE: M6    RISK: P1 (shared choke point, migration, SECURITY DEFINER)
BASE: origin/main at session start (git fetch first; record the full SHA)
WORKTREE: .autopilot/worktrees/p3-m6-outbox-delivery-core    BRANCH: feat/p3-m6-outbox-delivery-core
DEPENDS ON: L1 merged; D2 signed
OWNER DECISIONS NEEDED: D2 (a) bound 8 + backoff min(15 s x 2^(n-1), 30 min), (b) DLQ inspect + replay owner-only, (e) schedule flag OFF. Unsigned => AWAIT this lane only.
FILES IN SCOPE:
- apps/bot/src/dispatcher.ts (REQUIRED_PROJECTORS :33, STUB_PROJECTOR :32, productionStubDeliver :77, runDispatchCycle, the 2-phase ack/deliver); apps/bot/src/worker.ts (:80-96 enablement, :138-142);
  apps/bot/src/queues.ts (OUTBOX_DISPATCH_CRON :47, 1-min floor :38-46); apps/bot/src/preflight.ts if it enumerates functions; their tests (dispatcher.test.ts, dispatcher-outcome.test.ts, schedule.test.ts)
- NEW apps/bot/src/projector-registry.ts; NEW apps/bot/src/projectors/index.ts (projector name -> deliver function map; each projector lane adds one line); NEW apps/bot/src/outbox-wake.ts (LISTEN loop,
  debounced cycle; the 1-min cron stays as the safety net); NEW apps/bot/src/draft-expiry-job.ts (feature_session_management_tech.md section 4 "Draft discard + auto-expiry", edges #28-#30)
- NEW packages/db/migrations/<next>_outbox_projector_registry_dlq_replay.sql: durable registry (event type -> required projectors; ack_outbox_event receives the array computed at ack time; a projector added
  later never retro-applies to acked events; seeded with web_realtime, zalo_dm and public_sessions DISABLED, enabling a row is a registry function call in the runbook, not a migration), NOTIFY trigger on
  outbox_events insert, narrow definers for DLQ inspect/replay and draft claim (EXECUTE app_worker or the owner path only; app_worker has no base grants, 0009:17); packages/db/schema.ts + db.dbml; a migration
  test
- NEW scripts/outbox-dlq-replay.mjs (owner CLI, no HTTP, no UI); NEW docs/runbooks/outbox-dispatch-enable-rollback.md (owner enable and rollback steps, sync-lag measurement procedure)
- packages/db/src/session-service.ts only if the system-actor cancel path needs a hook (cancelSession :2117)
NEGATIVE SCOPE: no provider call (L4); no web_realtime or public_sessions consumer (L5, L10); never enable OUTBOX_DISPATCH_SCHEDULE_ENABLED (default false stays in .env.example:95 and docker-compose.yml:130);
  no re-grant of base SELECT on any table; never edit migrations 0022/0023; no public_sessions write.
MODELS: writer opus/max; reviewer opus/max; security opus/max (replay authorization, definer functions, role grants); readiness opus/max.
DECISION TABLE (D2; error_code grammar ^[a-z][a-z0-9_]{0,63}$ from dispatcher.ts):
- delivered -> mark delivered, ack kept -> none
- transient failure, attempts < 8 -> retry at now + min(15 s x 2^(n-1), 30 min) -> the projector's error_code
- failure the projector classifies terminal -> DLQ at once -> the projector's error_code
- failure at attempts = 8 -> DLQ -> UNPINNED: lane pins the code (proposal attempts_exhausted) and records it as default applied, pending owner sign-off
- event type with no registered projector -> ack with an empty required set, never DLQ -> none
- replay of a DLQ row by the owner path -> status pending, attempts 0, one job_audit_events row, no other row touched -> none
- replay of a non-DLQ row -> refuse, zero writes -> UNPINNED (lane pins, default applied)
- replay or inspect by app, app_worker without the definer, or readonly -> privilege error, zero writes -> database privilege error (no HTTP code)
TESTS: registry lookup per event type; backoff schedule numbers 15 s, 30 s, 60 s ... capped 30 min and the 8th failure DLQs; replay resets attempts and writes one audit row; non-owner replay writes nothing (run
  as the real role); NOTIFY wake runs one debounced cycle and an idempotent double wake does not double-deliver; sync-lag measured under a stated load (state events/s and N) with p95 and p99 recorded;
  draft-expiry races publish on one row and the second runner is a no-op; worker.ts still refuses to schedule while the deliverer is the stub or the flag is not "true".
ACCEPTANCE COMMANDS: S1 VERIFY set; NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/bot test; pnpm --filter @plexco/db test (one DB lock).
REVIEW PLAN: opus/max reviewer then opus/max security round, max 3 rounds total; questions = ordering independence (no per-aggregate order guarantee, 0023), replay privilege, any path that lets app_worker read
  a base table, rolling-deploy safety of the registry.
DONE WHEN: no stub is the required set; DLQ replay works end to end locally; p95 recorded; flag still OFF; the runbook gives exact enable and rollback steps.
```

### L4 - p3-m6-zalo-outbound (M6, P1)

```text
LANE: L4 p3-m6-zalo-outbound
GOAL: A zalo_dm projector in the worker delivering exactly the D2 matrix through the Zalo Bot API, with retry/terminal classification and a per-recipient delivery disposition. No live proof.
MILESTONE: M6    RISK: P1 (secret decrypt, external input, new definer, migration likely)
BASE: origin/main at session start (git fetch first; record the full SHA)
WORKTREE: .autopilot/worktrees/p3-m6-zalo-outbound    BRANCH: feat/p3-m6-zalo-outbound
DEPENDS ON: L3 merged; D2 signed
OWNER DECISIONS NEEDED: D2 (c) delivery matrix. Unsigned => AWAIT this lane only.
FILES IN SCOPE:
- apps/web/lib/connector-secrets.ts (envelope + decryptConnectorSecret :89), apps/web/lib/auth-secrets.ts (resolveConnectorSecretRoot), apps/web/lib/oauth-transaction.ts (deriveAesKey): MOVE
  the envelope to NEW packages/db/src/connector-crypto.ts (or another existing package; record why); keep the same HKDF label, AAD and key_version check; the web imports it back; no new
  secret, local ENCRYPTION_KEY
- apps/web/lib/zalo/client.ts (sendMessage :91, base ZALO_BOT_API_BASE :32): move or share so the worker can call it; packages/db/src/zalo-ingress.ts (appendSecretDecryptAudit :66)
- NEW apps/bot/src/projectors/zalo-dm.ts; apps/bot/src/projectors/index.ts (one line); NEW recorded-contract Zalo stub for tests at ZALO_BOT_API_BASE
- NEW packages/db/migrations/<next>_zalo_delivery_targets_definer.sql (likely: app_worker has no grant on zalo_bots, channel_identities or players, so one narrow definer returns the target
  bot secret row + the linked recipients for an event; EXECUTE app_worker; if an existing definer already covers it, no migration)
- packages/db/src/session-service.ts announceSession payload (:951): additive requested_by_person_id (an id, no PII) so the announcement DM has a recipient
NEGATIVE SCOPE: never claim live delivery (live proof = owner P0); no group send (OD-2 ignores GROUP chats); no Messenger; no reminders; do NOT add the announce HTTP route or UI
  (decisions.md:757 re-enable condition: only after the owner enables the schedule); no player commands (L13).
MODELS: writer opus/max; reviewer opus/max; security opus/max; readiness opus/max.
DECISION TABLE (D2 c):
- session.updated whose changed_fields include starts_at, ends_at, timezone, venue_name, venue_address or price_amount -> one DM per ACTIVE roster player with an active Zalo identity on this
  club's bot; waitlisted, left, unlinked get none; other changed_fields only -> no DM, delivered as a no-op -> none
- session.cancelled -> same recipients -> none
- session.announcement_requested -> ONE DM to the requesting host with a ready-to-forward join text + web link; payload without requester -> terminal, no send -> UNPINNED (lane pins,
  proposal no_requester)
- every other event type -> no zalo_dm requirement -> none
- bot not usable (status not registered/active, key_version mismatch, undecryptable) -> terminal DLQ, no retry storm; the audit row is written BEFORE decrypt and an audit failure means no
  decrypt -> UNPINNED (proposal bot_unavailable)
- Zalo envelope ok:false transient (network, 5xx, rate limit) -> retry per D2; 4xx terminal for that recipient only, the others continue -> codes from the recorded contract, UNPINNED names
- retry after a partial send -> resend only recipients not recorded sent; a crash between send and record can duplicate one DM (accepted, documented) -> UNPINNED (default applied)
TESTS: the matrix above, one case per row against the stub; envelope {ok, result, description, error_code} parsing incl. malformed body; the token never appears in logs or audit rows;
  replies rendered with runWithLang(tenants.locale) (DD-118) as t(vi, en); recipient set excludes waitlisted/left/other tenant (RLS fixture); decrypt-failure and audit-failure send nothing.
ACCEPTANCE COMMANDS: S1 VERIFY set; NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/bot test; pnpm --filter @plexco/web test; pnpm --filter @plexco/db test.
REVIEW PLAN: opus/max reviewer + opus/max security round, max 3 rounds; questions = secret handling, SSRF via ZALO_BOT_API_BASE, definer leaks, PII in outbox payloads, recipient scoping.
DONE WHEN: matrix delivered and tested against the stub; envelope shared with identical crypto; no live claim; owner P0 steps (connect a real bot token, enable the schedule) listed in the PR
  body.
```

### L5 - p3-m6-web-live-sync (M6, P1)

```text
LANE: L5 p3-m6-web-live-sync
GOAL: web_realtime projector + an SSE route for the host workspace (session list and detail): id-only NOTIFY, per-event re-authorization before anything is sent,
  reconnect/backoff, CSP-compatible, p95 measured locally.
MILESTONE: M6    RISK: P1 (authorization on a streaming surface; no migration)
BASE: origin/main at session start (git fetch first; record the full SHA)
WORKTREE: .autopilot/worktrees/p3-m6-web-live-sync    BRANCH: feat/p3-m6-web-live-sync
DEPENDS ON: L3 merged (registry, wake-up, DLQ)
OWNER DECISIONS NEEDED: D2 (c): web_realtime receives every session event. Unsigned => AWAIT this lane only.
FILES IN SCOPE:
- NEW apps/bot/src/projectors/web-realtime.ts (delivery = pg_notify(channel, event id) only; no payload body); one line in apps/bot/src/projectors/index.ts
- NEW apps/web/app/api/realtime/subscribe/route.ts (GET, text/event-stream; path per feature_sync_engine_tech.md:161); NEW apps/web/lib/realtime-listener.ts (one LISTEN
  client per web process, fan-out in memory); NEW apps/web/lib/realtime-auth.ts (re-authorize each event through the existing read path before sending)
- apps/web/lib/use-sessions-data.ts, apps/web/lib/use-session.tsx (EventSource hook: invalidate and refetch through the authorized GET, exponential reconnect with jitter,
  polling-free); NEW apps/web/lib/use-realtime.ts (+ tests)
- apps/web/lib/request-policy.ts + apps/web/middleware.ts (route belongs to the web role, not the discovery role); apps/web/next.config.mjs (CSP stays compatible;
  same-origin stream)
- apps/web/e2e/ (two-context live-update spec), apps/web/e2e/support/ (SSE mock if needed); registry row for web_realtime enabled through L3's registry function, not a
  migration
NEGATIVE SCOPE: no chat events (L15 reuses this transport); no public or anonymous stream; no client-side polling fallback that bypasses authorization; no payload beyond
  event type + session id + version; no migration (else HALT).
MODELS: writer opus/max; reviewer opus/max; security opus/max; readiness opus/max.
DECISION TABLE:
- no valid session cookie -> AUTH_REQUIRED (401)
- ?tenant not a club the account actively belongs to, or unknown -> FORBIDDEN (403), one body for every reason (no existence oracle)
- event arrives and the subscriber is still authorized -> id-only invalidation {event type, session id, version}; the client refetches through the authorized GET
- event arrives and access was lost after subscribing (membership ended, role changed) -> dropped, nothing sent; stream closed at the next heartbeat check -> none
- too many concurrent streams for one account -> RATE_LIMITED (429); the number is UNPINNED: lane pins a default (proposal 5) and records it as default applied
- any field beyond ids and type in a pushed message -> whitelist test fails: never roster, money, PII
TESTS: cross-tenant leak test (tenant A event never reaches a tenant B subscriber); revoke-mid-stream test (no further events after membership removal); heartbeat at most
  every 30 s; NOTIFY payload is the event id only; reconnect resumes with a refetch, no duplicate-apply bug; slow-consumer and client-abort cleanup (no listener leak);
  two-browser Playwright test where a host edit appears on the second view; local p95 host-edit -> second-view recorded with the method and load stated; axe + 375px not
  regressed.
ACCEPTANCE COMMANDS: S1 VERIFY set; pnpm --filter @plexco/web exec playwright test; local measurement script output pasted in the PR body.
REVIEW PLAN: opus/max reviewer + opus/max security round, max 3 rounds; questions = event-to-subscriber authorization race, tenant isolation of the shared listener,
  resource exhaustion, CSP/headers on the stream, id-only claim.
DONE WHEN: a host change on web reaches a second web view with the measured p95 recorded; revoked users stop receiving; no new migration; owner P0 note: realtime only
  flows once the schedule is enabled.
```

### L6 - p3-m6-visibility-toggle (M6, P1)

```text
LANE: L6 p3-m6-visibility-toggle
GOAL: A host-facing public/private control on the existing update command with the immediate-deny fence, refusing a public session that lacks capacity
  or area. The command, the 0024 CHECK and the fence already exist; this lane adds the focused toggle and proves the behaviour. NO public_sessions
  projection (DD-114 D3 b).
MILESTONE: M6    RISK: P1 (public exposure control)
BASE: origin/main at session start (git fetch first; record the full SHA)
WORKTREE: .autopilot/worktrees/p3-m6-visibility-toggle    BRANCH: feat/p3-m6-visibility-toggle
DEPENDS ON: L2 merged (venue text safe before it can become public)
OWNER DECISIONS NEEDED: none
FILES IN SCOPE (all exist unless NEW):
- packages/db/src/session-service.ts (updateSession :1142; visibility event :1563-1571; MISSING_DISCOVERY_FIELDS check :1427-1446; fence call :1579);
  packages/db/src/public-session-fence.ts + public-session-fence.test.ts; packages/db/src/session-service.test.ts (read first; add only missing cases)
- apps/web/components/sessions/session-form.tsx (visibility select :236-250 already exists); apps/web/components/sessions/details-tab.tsx (:26 shows
  it); apps/web/components/sessions/session-action-bar.tsx; apps/web/components/sessions/session-detail-view.tsx; NEW
  apps/web/components/sessions/visibility-toggle.tsx (+ .test.tsx, .module.css)
- apps/web/lib/session-actions.ts, apps/web/lib/session-error-ui.ts (MISSING_DISCOVERY_FIELDS copy exists :100), apps/web/e2e/sessions.spec.ts,
  apps/web/e2e/support/session-api-mock.ts
NEGATIVE SCOPE: no migration (else HALT); no public_sessions writer or projection; no new command (reuse PUT /api/sessions/[id]); no discovery UI
  (L12); never re-grant public_sessions SELECT; the DTO keeps `visibility` internal to the host surface only.
MODELS: writer opus/max; reviewer opus/max; security none (no new input surface beyond the existing command; the reviewer asks the exposure
  questions); readiness opus/max.
DECISION TABLE:
- host with session.manage sets public, area non-empty, slots_max finite -> update + session.visibility_changed event (new_visibility) -> none
- sets public with empty area or slots_max NULL -> refuse, zero writes -> MISSING_DISCOVERY_FIELDS (400)
- public -> private -> update + event + fence raised in the SAME transaction (raisePublicSessionFence, reason visibility_private) -> none
- no change (private -> private, public -> public) -> no-op, no event, no fence -> none
- caller without session.manage -> FORBIDDEN (403), same body for every reason
- stale expectedVersion -> STALE_VERSION (409), zero writes
- cancel or close of a public session -> fence raised with reason cancelled / closed (existing :1937, :2360) -> unchanged; assert it, do not edit it
TESTS: toggle shows current state, optimistic UI never claims success before the server answers; private -> public refused with the t(vi, en) copy
  when area or slots are missing, and the form focuses the missing field; public -> private: the guarded view public_session_share_v returns zero rows
  for the session immediately (fence), asserted in a DB test; no DTO or response leaks anything new; all 5 UI states (loading, ready, empty, error,
  offline) at 375px, light and dark, axe clean.
ACCEPTANCE COMMANDS: S1 VERIFY set; NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test -- public-session-fence session-service; pnpm
  --filter @plexco/web exec playwright test.
REVIEW PLAN: opus/max reviewer, max 3 rounds; questions = can any path leave a fenced session publicly readable, does the toggle bypass
  MISSING_DISCOVERY_FIELDS, any new field in a response.
DONE WHEN: toggle works end to end locally with fence behaviour proven in the DB suite; no migration, no projection.
```

### L7 - p3-m9-occupancy-helper (M9, P1, no owner wait)

```text
LANE: L7 p3-m9-occupancy-helper
GOAL: ONE occupancy helper (stage 1 of the occupancy authority): getSessionOccupancy returns one number and replaces the two hand-written copies, with
  the same semantics as today. No schema change.
MILESTONE: M9    RISK: P1 (capacity decision shared by every join path)
BASE: origin/main at session start (git fetch first; record the full SHA)
WORKTREE: .autopilot/worktrees/p3-m9-occupancy-helper    BRANCH: feat/p3-m9-occupancy-helper
DEPENDS ON: none (stage 1 changes no semantics, so D1 is not needed)
OWNER DECISIONS NEEDED: none for this lane (D1 gates only the public part, L10)
FILES IN SCOPE:
- NEW packages/db/src/session-occupancy.ts: occupiedCountSql(sessionId) (THE formula as one SQL expression), getSessionOccupancy(tx, sessionId)
  (scalar wrapper), slotsOpen(slotsMax, occupied) (pure: NULL when slotsMax is NULL, else max(0, slotsMax - occupied)), activeCountSql +
  sessionActiveRosterCount moved here; NEW session-occupancy.test.ts
- packages/db/src/session-service.ts (sessionOccupancy :2664 removed; sessionActiveRosterCount :2066; callers :1460, :2802, :3003);
  packages/db/src/roster-service.ts (:181); packages/db/src/session-read.ts (activeCountSql :200 and occupiedCount :211 copies, detail :371);
  packages/db/src/index.ts exports
- apps/web/lib/sessions-api.ts (occupiedCount :37, counts.occupied :87, add slotsOpen); apps/web/components/sessions/roster-counts.tsx (:11 stops
  deriving free); apps/web/components/sessions/session-card.tsx (:28-29); apps/web/lib/session-read-route.ts / session-dto.ts if the DTO is mapped
  there; apps/web/e2e/support/session-api-mock.ts (:295)
NEGATIVE SCOPE: no migration, no new column or function in SQL (stage 2 is L10); no confirmed_count anywhere public; semantics unchanged: occupied =
  active players + guest notes, waitlisted/left/pending join requests never counted; no hold term (no hold table exists); the helper never returns a
  per-term breakdown.
MODELS: writer opus/max; reviewer opus/max; security none; readiness opus/max.
DECISION TABLE: none new (semantics unchanged). Equivalence matrix instead: active / waitlisted / left / guest-note fixtures must give the same
  numbers before and after.
TESTS: equivalence over the four fixture kinds across getSessionOccupancy, list occupiedCount and detail counts.occupied (extends
  session-read.test.ts:228); CONCURRENCY: N parallel addMemberToSession on a slots_max=1 session => exactly one active and N-1 waitlisted, run as the
  real app role; capacity-shrink guard (CAPACITY_BELOW_OCCUPANCY) still fires; slotsOpen: NULL for unlimited, clamps at 0, never negative; `git grep`
  proves no second occupancy SQL remains.
ACCEPTANCE COMMANDS: S1 VERIFY set; NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test; pnpm --filter @plexco/web test; git grep -n
  "sessionGuestNotes" packages/db/src/session-read.ts must show no occupancy expression.
REVIEW PLAN: opus/max reviewer, max 3 rounds; questions = any semantic drift, lock order (helper called after sessions FOR UPDATE inside the command
  transaction), tenant filters kept, unlocked reads stay advisory.
DONE WHEN: one formula, two former copies deleted, backlog row list-sessions-occupied-count-single-source closable, tests green.
```

### L8 - p3-m9-join-core (M9, P1)

```text
LANE: L8 p3-m9-join-core
GOAL: Player self-join on web (open -> active or waitlisted; approval -> join request), approve/reject, self-leave, FIFO waitlist promotion, cross-club guest membership, charge at join per D3 (base price until
  L11). Postgres is the only source of truth; reuse the host-add capacity/waitlist logic under the session row lock.
MILESTONE: M9    RISK: P1 (money, identity, concurrency, migration likely)
BASE: origin/main at session start (git fetch first; record the full SHA)
WORKTREE: .autopilot/worktrees/p3-m9-join-core    BRANCH: feat/p3-m9-join-core
DEPENDS ON: L7 merged; D3 signed; M6 done (S3 merged)
OWNER DECISIONS NEEDED: D3 (join and money without a bank). Unsigned => AWAIT this lane only.
FILES IN SCOPE:
- packages/db/src/roster-service.ts (addMemberToSession :121, removePlayerFromSession :300, upsertCharge); packages/db/src/roster-money-shared.ts (RosterMoneyErrorCode :14-32, emitSessionEvent :148);
  packages/db/src/session-occupancy.ts (L7)
- NEW packages/db/src/session-join-service.ts (joinSession, leaveSession, promoteFromWaitlist); NEW packages/db/src/join-request-service.ts (create, cancel, approve, reject); packages/db/src/index.ts
- NEW packages/db/migrations/<next>_player_self_join.sql (likely): join_requests policy + grants (table exists 0006:37 but has zero code), narrow definers for guest-membership creation and for resolving a
  public+open session id to its tenant (never returned to the client); packages/db/schema.ts + db.dbml
- NEW apps/web/app/api/sessions/[id]/join/route.ts, .../leave/route.ts; NEW apps/web/app/api/join-requests/[id]/route.ts (DELETE), .../approve/route.ts, .../reject/route.ts;
  apps/web/lib/session-command-route.ts; packages/core/src/api-contract.ts (+ test)
NEGATIVE SCOPE: no holds, QR, pay-now, provider webhook or verified-settlement finalizer; no money moved by join; no gender price (L11); no discovery or projector; no player view pages (L12); no Zalo (L13);
  DD-41/42/52 eligibility and ban evaluators are not built in the repo and stay out; reversal stays owner-only.
MODELS: writer opus/max; reviewer opus/max; security opus/max; readiness opus/max.
DECISION TABLE (codes from feature_cross_club_join_tech.md section 3 and roster-money-shared.ts):
- no authenticated account -> AUTH_REQUIRED (401); identity comes from the session, never the body
- session not open, private for a non-member, or past -> SESSION_NOT_JOINABLE (400); private joinable only by an active member of the owning club -> UNPINNED (default applied)
- already active or waitlisted -> current outcome returned, zero mutation (idempotent)
- left, with net recorded money > 0 or disposition unprovable -> REJOIN_REQUIRES_REVIEW (409); left with zero money -> row reused, one charge revived
- open + free seat -> active + exactly one charge (amount_due = base price; price 0 follows host-add: one charge row, status paid) -> none
- open + full -> waitlisted at the FIFO tail, no charge, no venue -> none
- approval policy -> join_requests(pending) only: no membership, player, charge or held seat; duplicate active request -> idempotent
- approve by a host with manage_roster -> re-derive under lock: free seat -> active + charge; full -> approved + waitlisted; already decided -> REQUEST_DECIDED (409); expired -> REQUEST_EXPIRED (409); no
  manage_roster -> FORBIDDEN (403); reject -> rejected
- self-leave while open and before start, net money 0 -> left, charge void, FIFO promotion in the same transaction; net money > 0 -> refused, zero writes -> UNPINNED (proposal: reuse REMOVE_REQUIRES_REVIEW with
  player copy "ask the host"); after start -> UNPINNED (default applied)
- freed seat, host remove or capacity raise -> promote the lowest waitlist_position; promoted player gets exactly one charge; no money moves
- more than 10 joins per hour per person -> RATE_LIMITED (429) (number from the BE doc)
TESTS: CONCURRENCY: N parallel joins on a slots_max=1 session => exactly one active, the rest waitlisted, as the real app role (an insert-then-count pattern oversells under concurrent Postgres transactions;
  lock the session row first); double-join replay with one command id; confirm-time re-check against live state; approval race (approve vs capacity change); leave + promote atomicity; cross-tenant: a person
  never reads another club's roster; guest membership UNIQUE(person, tenant); public DTO unchanged.
ACCEPTANCE COMMANDS: S1 VERIFY set; NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test; pnpm --filter @plexco/web test; one migration at a time.
REVIEW PLAN: opus/max reviewer + opus/max security round, max 3 rounds; questions = oversell, tenant resolution leak, identity claim without a strong factor (HARD RULE 4: a web account never claims an existing
  membership by name; Zalo history only via the M3b link code), charge duplication.
DONE WHEN: the table rows each have a test; no oversell under concurrency; no client-supplied person or tenant id is trusted.
```

### L9 - p3-m9-me-reads (M9, P1)

```text
LANE: L9 p3-m9-me-reads
GOAL: Person-scoped cross-club reads for the signed-in player (my clubs, my sessions, my charges, my join requests) through SECURITY DEFINER functions
  that filter by the caller's own person. Own money only.
MILESTONE: M9    RISK: P1 (cross-tenant read path, money visibility, migration)
BASE: origin/main at session start (git fetch first; record the full SHA)
WORKTREE: .autopilot/worktrees/p3-m9-me-reads    BRANCH: feat/p3-m9-me-reads
DEPENDS ON: L8 merged
OWNER DECISIONS NEEDED: D3 (own-money-only visibility, no buddy pay). Unsigned => AWAIT this lane only.
FILES IN SCOPE:
- NEW packages/db/migrations/<next>_me_player_reads_definers.sql: definers keyed by the ACCOUNT id from the session, no person or tenant parameter
  (precedent 0055_me_settings_definers.sql: p_account_id, GRANT EXECUTE to app); today memberships, players, charges and join_requests have
  tenant-isolation RLS only (0009)
- NEW packages/db/src/me-player-reads.ts (+ test); packages/db/src/me-settings.ts (precedent); packages/db/src/index.ts
- NEW apps/web/app/api/me/clubs/route.ts, .../sessions/route.ts, .../charges/route.ts, .../requests/route.ts (GET, Cache-Control private no-store);
  apps/web/lib/me-route-gate.ts (reuse); packages/core/src/api-contract.ts if a code is added
NEGATIVE SCOPE: no other player's roster, debt or charge ever (PV:39,44 win over the PV:69 buddy-pay row, out of MVP); no host receivable; no
  paid/void/left history; no magic link; no /pay chat; no pages (L12); no tenant-admin shortcut (tenant_ids_for_person covers admin tenants only).
MODELS: writer opus/max; reviewer opus/max; security opus/max; readiness opus/max.
DECISION TABLE:
- account with no person or no memberships -> 200 with empty lists
- charge on the caller's own membership with status open or partial -> returned with amountDue, amountAllocated, remaining; a charge of any other
  person in the same session -> never returned
- charge void or paid -> excluded (history deferred)
- amount cannot be derived (null, error) -> state unknown, never 0; a cross-club summary is unknown if any club is unknown, no partial sum
- request carries person_id, tenant_id or membership_id in query or body -> ignored (never read); the definer takes the account id only
- membership status left or merged -> club not listed -> UNPINNED (default applied: active and guest only)
- session where the caller is active -> includes venue; waitlisted or pending request -> area + position only, no venue
- unauthenticated -> AUTH_REQUIRED (401)
TESTS: cross-person isolation (person A never sees person B in the same session, as the real app role); cross-tenant: only the caller's tenants
  appear; unknown dominates in the summary; no phone, email, pay_code or gender in any DTO (allowlist test); responses are no-store; the routes take
  the account id only from the verified session; SQL review: no search_path hole, REVOKE from PUBLIC.
ACCEPTANCE COMMANDS: S1 VERIFY set; NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test; pnpm --filter @plexco/web test; one migration
  at a time.
REVIEW PLAN: opus/max reviewer + opus/max security round, max 3 rounds; questions = any path returning another person's data, definer privilege and
  search_path, caching, enumeration.
DONE WHEN: four GET routes return person-scoped data with the isolation tests green.
```

### L10 - p3-m9-public-projector-discovery (M9, P1)

```text
LANE: L10 p3-m9-public-projector-discovery
GOAL: The public_sessions writer (a narrow SECURITY DEFINER function for app_worker), the projector consumer, the stage-2 session_occupancy(uuid) SQL function, and anonymous discovery read routes over the guarded view. Whitelist only;
  slots_open only; never confirmed_count.
MILESTONE: M9    RISK: P1 (public exposure of tenant data, migration, SECURITY DEFINER)
BASE: origin/main at session start (git fetch first; record the full SHA)
WORKTREE: .autopilot/worktrees/p3-m9-public-projector-discovery    BRANCH: feat/p3-m9-public-projector-discovery
DEPENDS ON: L3, L6, L7 merged; D1 signed (includes the stage-2 function authorization)
OWNER DECISIONS NEEDED: D1 (a) occupancy authority, (b) session_occupancy(uuid) inside this migration. Unsigned => AWAIT this lane only.
FILES IN SCOPE:
- NEW packages/db/migrations/<next>_public_sessions_projector_writer.sql: definers upsert/delete of public_sessions recomputed from canonical rows (EXECUTE app_worker; the writer role is excluded because preflight rejects SET ROLE,
  apps/bot/src/preflight.ts:98-118); session_occupancy(p_session_id uuid) RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path = public, pg_temp, REVOKE FROM PUBLIC, EXECUTE app + the definer owner; optional CHECK (slots_open >=
  0). Never re-grant base SELECT on public_sessions to app or readonly (0033:232-238); app DML stays revoked (0036)
- packages/db/src/session-occupancy.ts (occupiedCountSql now emits session_occupancy(x): one body for TS and SQL); packages/db/src/public-session-fence.ts (+ CAS-clear wrapper for clear_public_session_fence, 0033:208); packages/db/schema.ts
  + db.dbml
- NEW apps/bot/src/projectors/public-sessions.ts (consumes session.published, updated, visibility_changed, closed, cancelled and the occupancy events player.* and guest_note.*); apps/bot/src/projectors/index.ts (one line); registry row
  enabled through L3's registry function
- NEW packages/db/src/public-discovery-read.ts (reads public_session_share_v as the readonly role); NEW apps/web/app/api/discover/route.ts and apps/web/app/api/discover/sessions/[publicId]/route.ts (path per
  feature_marketplace_discovery_tech.md section 3, :109-110; the :26-29 names are drift); NEW apps/web/lib/discovery-cursor.ts (opaque signed cursor); apps/web/lib/request-policy.ts + middleware.ts (discovery process allowlist)
- packages/db/src/rls-invariants.test.ts (:171 whitelist test stays green, add the new invariants); infra/docker-compose.yml discovery profile and .env.example only if wiring needs it
NEGATIVE SCOPE: no confirmed_count column or field; no gender, money beyond price_amount, roster, venue address, tenant id, channel id or hold count in any public object; no DD-41 columns, no search overlay, no DD-46 alias substrate
  (host_display_name stays NULL: UNPINNED default applied; club_display_name = tenants.name); no cache layer (UNPINNED default: none in the MVP); no player pages (L12); no bank or hold branch.
MODELS: writer opus/max; reviewer opus/max; security opus/max; readiness opus/max.
DECISION TABLE:
- published, public, status open, starts in the future, area non-blank, slots_max finite -> upsert the whitelist row, slots_open = slotsOpen(slots_max, session_occupancy(id)) recomputed at delivery time -> none
- draft (even if public), private, closed, cancelled, past, blank area, slots_max NULL -> no row, delete if present, siblings continue; NULL slots_max is also an audit event -> none
- public -> private, cancel, close -> delete the row, then CAS-clear the fence only if the token is still the one observed (a newer fence stays) -> none
- occupancy events (player.*, guest_note.*, session.updated) -> recompute slots_open from canonical rows; events may arrive in any order and the result is identical -> none
- expires_at < now() -> swept -> none
- anonymous read -> whitelist DTO only: session_id, sport_key, starts_at, ends_at, area, price_amount, slots_open, club_display_name, host_display_name, join_policy; ORDER BY starts_at ASC, id ASC (MKT-OQ-3 default)
- unknown filter value or malformed cursor -> INVALID_FILTER (400); over the rate limit -> DISCOVERY_RATE_LIMITED (429); numbers UNPINNED: lane pins default applied (proposal 60 requests per minute per IP, page size 20, max 50)
- unknown, fenced or expired public id on detail -> NOT_FOUND (404), one body for all three
TESTS: public-whitelist test (exact column list of the view and the DTO; no gender, price_male, roster, PII, tenant_id, slots_max, confirmed_count); permuted-event-order convergence; projector idempotent and a poison event does not block
  siblings; the readonly role cannot SELECT the base table and app cannot write it; fence immediate-deny then CAS-clear; slots_open parity between session_occupancy(id) and getSessionOccupancy over active / waitlisted / left / guest-note
  fixtures; cursor tamper rejected; rate limit; DTO golden JSON.
ACCEPTANCE COMMANDS: S1 VERIFY set; NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test; pnpm --filter @plexco/bot test; pnpm --filter @plexco/web test; one migration at a time.
REVIEW PLAN: opus/max reviewer + opus/max security round, max 3 rounds; questions = any public leak path, definer privilege and search_path, re-grant of base SELECT, fence race, anonymous abuse.
DONE WHEN: a public open session appears in the anonymous API within the sync-lag budget and disappears immediately on private/cancel/close; whitelist tests green; chosen local wiring of the readonly read path recorded as default applied.
```

### L11 - p3-m9-gender-pricing (M9, P1)

```text
LANE: L11 p3-m9-gender-pricing
GOAL: DD-39 gender pricing (signed, decisions.md:542-556): persons.gender_enc with consent, sessions.price_male/price_female, a self-declared settings control, host price
  mode, and charge derivation at host-add, self-join and waitlist promotion.
MILESTONE: M9    RISK: P1 (money, PII encryption, migration)
BASE: origin/main at session start (git fetch first; record the full SHA)
WORKTREE: .autopilot/worktrees/p3-m9-gender-pricing    BRANCH: feat/p3-m9-gender-pricing
DEPENDS ON: L8 merged (DD-39 is signed; no owner wait)
OWNER DECISIONS NEEDED: none (DD-39 + the 2026-07-16 addendum are signed)
FILES IN SCOPE:
- NEW packages/db/migrations/<next>_gender_pricing.sql: persons.gender_enc bytea (+ key version and consent columns, names UNPINNED), sessions.price_male / price_female
  integer CHECK >= 0 (both NULL = single price; at least one set = gender mode, a missing side falls back to price_amount); definers keyed by the account id (0055
  pattern) to write the caller's own gender and to read it for charge derivation only; packages/db/schema.ts + db.dbml
- NEW packages/db/src/charge-derivation.ts (deriveChargeAmount returns an amount or a typed failure, never enqueues); NEW packages/db/src/gender-crypto.ts reusing the
  AES-256-GCM envelope of connector-crypto.ts with a distinct HKDF label and person-bound AAD; no new secret, local ENCRYPTION_KEY
- packages/db/src/roster-service.ts (host-add charge :246-262), packages/db/src/session-join-service.ts (L8), the waitlist promotion path (L8),
  packages/db/src/session-service.ts (create/update accept the two prices; price guard PRICE_CHANGE_REQUIRES_POLICY), packages/db/src/me-settings.ts
- apps/web/components/me/settings-profile-form.tsx + settings-view.tsx (gender + consent), apps/web/components/sessions/session-form.tsx +
  apps/web/lib/session-form-model.ts (price mode), the existing profile route apps/web/app/api/me/profile/route.ts (extend it: UNPINNED default applied; the BE doc names
  PUT /api/me/settings), packages/core/src/api-contract.ts
NEGATIVE SCOPE: no host-set gender (self-declared only); no raw gender returned to any host or any public surface, only the resulting price; no dob, no username; no
  projector change except the whitelist test proving gender and per-gender prices never appear; no second price table.
MODELS: writer opus/max; reviewer opus/max; security opus/max; readiness opus/max.
DECISION TABLE (codes verbatim from feature_user_settings_tech.md):
- session without price_male / price_female -> price_amount
- gender_enc NULL (never set) -> price_amount + a visible "set your gender" prompt; a valid state, not an error
- gender_enc present and decrypt/KMS fails -> FAIL-CLOSED, typed CHARGE_DERIVATION_UNAVAILABLE, NO fallback price; direct join/approve rolls back (no player, charge or
  venue; a new guest membership rolls back too); host-add creates no charge and shows the host an error; waitlist promotion leaves the candidate unchanged + audit event
- male with price_male set -> price_male; female with price_female set -> price_female; the missing side, other, undisclosed -> price_amount
- consent OFF -> the charge path reads NULL -> price_amount
- gender value outside male|female|other|undisclosed -> INVALID_GENDER (400)
- anyone but the owner person or a host of a related club asking for gender -> GENDER_FORBIDDEN (403); hosts get the derived price only
- host changes the price mode while any charge exists -> PRICE_CHANGE_REQUIRES_POLICY (existing guard), zero writes
- derived amount outside int4 or negative -> refused, zero writes -> UNPINNED (default applied)
TESTS: DECRYPT-FAILURE NO-CHARGE test (corrupt ciphertext and wrong key version: no charge row, no active player, host-visible error, for host-add, join and promotion);
  NULL gender fallback + prompt; consent OFF path; one case per row above; public-whitelist test proving gender and price_male / price_female never reach public_sessions,
  the view, any DTO or any log; ciphertext is person-bound (a blob copied to another person fails); settings UI is t(vi, en), labels read from the DD-39 value set.
ACCEPTANCE COMMANDS: S1 VERIFY set; NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test; pnpm --filter @plexco/web test; one migration at a time.
REVIEW PLAN: opus/max reviewer + opus/max security round, max 3 rounds; questions = any fallback on decrypt failure, plaintext gender in logs or errors, host able to read
  raw gender, key reuse across purposes.
DONE WHEN: every row has a passing test, decrypt failure provably charges nobody, public surfaces proven free of gender.
```

### L12 - p3-m9-player-web (M9, P2)

```text
LANE: L12 p3-m9-player-web
GOAL: The player-facing web pages: discovery list and detail (anonymous allowed), member session detail with join / leave / waitlist state, my clubs /
  sessions / charges / requests, and the host approval inbox. Extends the local golden path with a player journey.
MILESTONE: M9    RISK: P2 (UI over finished commands; money display only)
BASE: origin/main at session start (git fetch first; record the full SHA)
WORKTREE: .autopilot/worktrees/p3-m9-player-web    BRANCH: feat/p3-m9-player-web
DEPENDS ON: L8, L9, L10 merged
OWNER DECISIONS NEEDED: D3 (join and money), D1 (slots_open shown, no denominator). Unsigned => AWAIT this lane only.
FILES IN SCOPE:
- NEW apps/web/app/discover/page.tsx and apps/web/app/discover/[publicId]/page.tsx; NEW apps/web/app/me/page.tsx, apps/web/app/me/clubs/page.tsx,
  apps/web/app/me/sessions/page.tsx, apps/web/app/me/charges/page.tsx, apps/web/app/me/requests/page.tsx; NEW host inbox under
  apps/web/app/c/[tenantId]/sessions/[id]/ (a requests tab); apps/web/app/me/layout.tsx (exists)
- NEW apps/web/components/discover/*, apps/web/components/player/*, apps/web/components/sessions/join-panel.tsx and request-inbox.tsx (each with
  .module.css, tokens only) + tests; apps/web/lib/discover-api.ts, apps/web/lib/me-player-api.ts
- apps/web/lib/money.ts (the ONE formatter; apps/web/lib/money-single-formatter-guard.test.ts must stay green); apps/web/lib/session-error-ui.ts
  (error mapping per screen)
- apps/web/e2e/ new specs + a11y.spec.ts additions; apps/web/e2e/golden-path.spec.ts (player journey, local only) + docs/runbooks/local-mvp-smoke.md
  section 9
NEGATIVE SCOPE: no API or DB change (an API gap goes under OPEN, not into this lane); no pay-now, QR or bank detail anywhere; no other player's debt;
  no venue before the player is active; no chat UI (L16); docs/channels/web/FE/*_fe.md are reference input only, any field without an owner DTO is
  omitted (UNPINNED - omit active UI).
MODELS: writer sonnet/high; reviewer opus/high; security none; readiness opus/high.
DECISION TABLE: none new (UI renders outcomes of L8 to L10; each screen's Error mapping table uses only codes from the merged routes and ends with an
  unknown/timeout fail-closed row).
TESTS: every screen has loading, ready, empty, error and offline states at 375px and desktop, light and dark; axe clean; amounts only through
  formatVnd; waitlisted/pending users see area and position but no venue; anonymous discovery page works with no session; join button disabled and
  busy while pending, double-tap sends one command id; player journey e2e (discover -> join -> see in my sessions -> leave); i18n strings are t(vi,
  en) pairs.
ACCEPTANCE COMMANDS: S1 VERIFY set; pnpm --filter @plexco/web exec playwright test; local golden-path run (apps/web/e2e/golden-path.config.ts) output
  cited or marked NOT RUN with the reason.
REVIEW PLAN: opus/high reviewer, max 3 rounds; questions = any DTO field shown that is not whitelisted, debt of another person, hardcoded value,
  client-trusted ids.
DONE WHEN: the player journey passes locally end to end and the extended golden path run is recorded.
```

### L13 - p3-m9-zalo-player-commands (M9, P1)

```text
LANE: L13 p3-m9-zalo-player-commands
GOAL: Zalo DM commands /join, /leave and /pay for linked accounts only. /pay shows the player's own amount due and "pay the host directly", never bank
  details. Dedupe per message; replies in the club locale.
MILESTONE: M9    RISK: P1 (money display, identity gate, external input)
BASE: origin/main at session start (git fetch first; record the full SHA)
WORKTREE: .autopilot/worktrees/p3-m9-zalo-player-commands    BRANCH: feat/p3-m9-zalo-player-commands
DEPENDS ON: L8, L4 merged; D3 signed
OWNER DECISIONS NEEDED: D3 (Zalo /join /leave /pay, own amount due, no bank data). Unsigned => AWAIT this lane only.
FILES IN SCOPE:
- apps/web/lib/zalo/commands.ts (COMING_SOON join/pay/leave :20); apps/web/lib/zalo/process-event.ts (identity resolution, runWithLang, reply
  :96-168); NEW apps/web/lib/zalo/player-commands.ts; apps/web/lib/zalo/commands.test.ts, process-event.test.ts;
  apps/web/app/api/webhooks/zalo/[token]/route.test.ts
- packages/db/src/zalo-ingress.ts (zalo_reply_contexts access for numbered replies: table exists since 0004, version + expires_at + consumed_at);
  packages/db/src/session-join-service.ts (L8), packages/db/src/me-player-reads.ts (L9, for /pay)
NEGATIVE SCOPE: no migration (a missing grant => HALT); no group handling (OD-2 ignores GROUP chats); no ack-then-async rewrite (D2 d keeps
  process-then-ack); no pay-now, QR or bank data; no booking-funnel holds; no Messenger; no reminders; no unlinked access to any data.
MODELS: writer opus/max; reviewer opus/max; security opus/max; readiness opus/max.
DECISION TABLE:
- chat is GROUP, or chat.id != from.id -> ignored, nothing stored beyond the existing ledger -> none (existing rule, process-event.ts:84)
- same message_id + chat.id + from.id again -> processed once; the replay does nothing new (channel_inbound_events dedup) -> none
- sender has no active Zalo identity or no verified Plexco account on the same person -> link prompt only (t(vi, en)); no club data, no amount -> none
  (HARD RULE 4)
- /join with no argument -> numbered list of the club's open sessions this player may join, stored as a zalo_reply_context with expiry; reply = that
  number -> L8 joinSession with a command id derived from the message key -> active / waitlisted / request pending reply -> UNPINNED: command grammar
  (default applied)
- number reply on an expired, consumed or version-mismatched context -> "list outdated" reply, zero mutation (live state is re-validated at confirm
  time)
- /join when already active or waitlisted -> current state reply
- /leave -> numbered list of the player's own active/waitlisted sessions; net recorded money > 0 -> refused with "ask the host", zero mutation (D3)
- /pay -> own open or partial charges only: amount due + "pay the host directly"; nothing due -> "nothing due"; amount unknown -> "unavailable", never
  0; another person's debt never shown; no bank detail, no QR
TESTS: one case per row against the webhook route with recorded Zalo payloads; unlinked and half-linked senders get the prompt and nothing else
  (assert the reply text contains no club or money data); replay of the same message_id sends one reply and creates one player; confirm-time re-check
  flips a full session to a waitlist reply; /pay never includes another player; replies use the club locale (DD-118) and are t(vi, en); logs contain
  no message text or ids beyond keyed hashes.
ACCEPTANCE COMMANDS: S1 VERIFY set; pnpm --filter @plexco/web test; NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test.
REVIEW PLAN: opus/max reviewer + opus/max security round, max 3 rounds; questions = identity gate bypass by display name, replay double-join, bank
  data leak, group-chat handling, injection through message text.
DONE WHEN: /join, /leave, /pay work for linked accounts against the recorded-payload tests; unlinked users get only the link prompt; no live Zalo
  claim.
```

### L14 - p3-m10-chat-core (M10, P1)

```text
LANE: L14 p3-m10-chat-core
GOAL: The chat command core on the existing chat_* tables, through chat_definer functions: send, edit own, soft-delete own, mark read, moderation hide/restore, plus the default club channel
  auto-provisioned with chat_members rows in the same transaction as membership activation. DM stays disabled.
MILESTONE: M10    RISK: P1 (authorization, new definer functions, migration)
BASE: origin/main at session start (git fetch first; record the full SHA)
WORKTREE: .autopilot/worktrees/p3-m10-chat-core    BRANCH: feat/p3-m10-chat-core
DEPENDS ON: L8 merged; D4 signed
OWNER DECISIONS NEEDED: D4 (club channels only; no DM, media, reactions, search, group, pin, poll, slash commands, digests). Unsigned => AWAIT this lane only.
FILES IN SCOPE:
- NEW packages/db/migrations/<next>_chat_message_commands.sql: functions owned by chat_definer (role bootstrap infra/postgres-init/02-chat-definer.sql, run pnpm db:bootstrap first): send,
  edit own, delete own, mark read, moderate hide/restore, provision default channel + chat_members; capability checks via tenant_capability_authorize (0049) with keys from 0047
  (chat.channel.post_restricted, chat.message.moderate); append-only revision store and moderation audit (names UNPINNED, no UPDATE/DELETE grants); idempotent backfill of the default channel
  and members for existing clubs (creation_origin system_bootstrap); app keeps SELECT only (0031:353-354)
- NEW packages/db/src/chat-service.ts (+ test); packages/db/src/index.ts; packages/db/schema.ts (+ db.dbml); packages/db/src/authorization.ts and capability.ts (use, do not change)
- membership activation paths: packages/db/src/roster-service.ts, packages/db/src/session-join-service.ts (L8), the onboarding club-create path, the 0051 host-add definer: pin trigger vs
  explicit call (proposal: an AFTER trigger on memberships calling a chat_definer function, so no activation path can forget; UNPINNED default applied)
- packages/core/src/api-contract.ts (CHAT_* codes + test)
NEGATIVE SCOPE: no HTTP route or UI (L15, L16); no DM (all four dm_safety flags stay false, assert_dm_allowed denies safety_disabled); no media, reactions, search, mentions, mutes, group,
  pin, poll, nickname, slash commands, digest, push or email; no chat content in logs, NOTIFY payloads or any public surface; no Zalo or Messenger bridge; the Assistant stays off.
MODELS: writer opus/max; reviewer opus/max; security opus/max; readiness opus/max.
DECISION TABLE (codes verbatim from feature_inapp_chat_tech.md section 3):
- sender is not an active member of the tenant or has no chat_members row -> CHAT_FORBIDDEN (403)
- channel post_policy admins_only and sender lacks chat.channel.post_restricted (or the capability is unknown) -> CHAT_CAPABILITY_REQUIRED (403), fail-closed
- same client_msg_id again -> CHAT_DUP_MESSAGE (200-safe): the original message is returned, no second row
- body over the cap -> CHAT_MESSAGE_TOO_LARGE (413); the cap is UNPINNED (proposal 4000 characters); empty body -> INVALID_BODY (UNPINNED)
- reply target missing, cross-channel or tombstoned -> CHAT_REPLY_INVALID (409), no partial insert
- edit by a non-author, on an assistant/system message, at 15 minutes or later, or with five edits used -> CHAT_EDIT_WINDOW_CLOSED (409); stale expectedEditCount -> CHAT_EDIT_CONFLICT (409)
- author soft-delete -> tombstone via author_deleted_at, idempotent, no restore, no hard delete
- hide or restore without chat.message.moderate, or on a DM, assistant or system message -> CHAT_MODERATION_FORBIDDEN (403), generic; reason outside spam|harassment|unsafe|off_topic|other ->
  CHAT_REASON_INVALID (422)
- any operation on a kind dm channel -> CHAT_SAFETY_BLOCKED (403), generic
- more than 20 sends per 10 s or 300 per minute per person and channel -> CHAT_RATE_LIMITED (429)
- mark read -> the cursor (last_read_created_at, last_read_message_id) only moves forward; non-members cannot write it
TESTS: one case per row against the real DB as the app role; a non-member cannot read or write (RLS + chat_current_is_member); a message hidden by a moderator is a tombstone to everyone
  else; membership activation provisions exactly one default channel and one chat_members row per member, retry-safe, rolled back with the activation; concurrent sends keep per-channel order
  by (created_at, id); no chat text in any log line or NOTIFY payload (grep test); the chat_definer role must exist (CI runs db:bootstrap).
ACCEPTANCE COMMANDS: S1 VERIFY set; NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test; one migration at a time.
REVIEW PLAN: opus/max reviewer + opus/max security round, max 3 rounds; questions = definer privilege and search_path, capability bypass, cross-tenant read, DM reachable through any
  function, audit tamper.
DONE WHEN: all rows tested, provisioning proven transactional, DM provably unreachable.
```

### L15 - p3-m10-chat-api-live (M10, P1)

```text
LANE: L15 p3-m10-chat-api-live
GOAL: The chat HTTP routes for the D4 cut and the live-update adapter, reusing L5's SSE transport with per-event re-authorization. No migration.
MILESTONE: M10    RISK: P1 (authorization on read, write and streaming surfaces)
BASE: origin/main at session start (git fetch first; record the full SHA)
WORKTREE: .autopilot/worktrees/p3-m10-chat-api-live    BRANCH: feat/p3-m10-chat-api-live
DEPENDS ON: L14 and L5 merged; D4 signed
OWNER DECISIONS NEEDED: D4. Unsigned => AWAIT this lane only.
FILES IN SCOPE:
- NEW apps/web/app/api/chat/channels/route.ts (GET), .../channels/[id]/messages/route.ts (GET keyset (created_at, id), POST),
  .../messages/[messageId]/route.ts (PATCH, DELETE), .../channels/[id]/read/route.ts (POST), .../messages/[messageId]/moderation/route.ts (POST
  hide|restore), NEW apps/web/app/api/chat/subscribe/route.ts (SSE); paths per feature_inapp_chat_tech.md section 4 route contract
- NEW apps/web/lib/chat-route.ts (gate, envelope, error map, rate limits); apps/web/lib/realtime-listener.ts + realtime-auth.ts (L5, extended with a
  chat topic: id-only NOTIFY); packages/db/src/chat-service.ts (L14, call only); packages/core/src/api-contract.ts + test;
  apps/web/lib/request-policy.ts (web role only)
- the NOTIFY emission lives in the L14 send/edit/delete/moderate functions or a trigger: pin which (default applied) and keep the payload the message
  id only
NEGATIVE SCOPE: no new migration (a needed schema change => HALT and report); no DM, search, reactions, media, mutes, slash commands or digest routes;
  no chat body in logs or in a NOTIFY payload; no public or anonymous route; no polling fallback that skips authorization.
MODELS: writer opus/max; reviewer opus/max; security opus/max; readiness opus/max.
DECISION TABLE (HTTP mapping of L14 outcomes; envelope {data, error, meta}):
- no session -> AUTH_REQUIRED (401); wrong tenant or not a member -> CHAT_FORBIDDEN (403), one body for every reason
- POST message -> 200 with the message; duplicate client_msg_id -> 200 with the original (CHAT_DUP_MESSAGE is 200-safe); too large -> 413
  CHAT_MESSAGE_TOO_LARGE; admins_only without capability -> 403 CHAT_CAPABILITY_REQUIRED; rate limit -> 429 CHAT_RATE_LIMITED; bad reply target -> 409
  CHAT_REPLY_INVALID
- PATCH -> 409 CHAT_EDIT_WINDOW_CLOSED or CHAT_EDIT_CONFLICT as in L14; DELETE by the author -> idempotent tombstone; DELETE by anyone else -> 403
  CHAT_FORBIDDEN
- moderation by a caller without chat.message.moderate -> 403 CHAT_MODERATION_FORBIDDEN; bad reason -> 422 CHAT_REASON_INVALID; the response never
  reveals the previous body or who else moderated
- subscribe: event arrives for a channel the subscriber can no longer read -> dropped, nothing sent; stream closes at the next heartbeat check;
  payload to clients = event type + channel id + message id only, the client fetches content through the authorized GET
- history GET: hidden or author-deleted messages are returned as tombstones without body or revision or moderation detail; the page size is UNPINNED
  (default applied, proposal 50, max 100); a malformed cursor -> INVALID_BODY (400)
TESTS: route tests with the real DB for every row; cross-tenant leak test on subscribe (tenant A message never reaches a tenant B member);
  revoke-mid-stream (membership ended => no further events); keyset history stable under concurrent inserts; heartbeat at most 30 s; response bodies
  and logs contain no body text outside the authorized GET (grep test); CSRF on every mutation (x-csrf-token); no-store on every chat response.
ACCEPTANCE COMMANDS: S1 VERIFY set; pnpm --filter @plexco/web test; NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test; pnpm --filter
  @plexco/web exec playwright test.
REVIEW PLAN: opus/max reviewer + opus/max security round, max 3 rounds; questions = authorization on every route and on every pushed event, tombstone
  leakage, enumeration, CSRF, resource exhaustion on the stream.
DONE WHEN: a message sent by one member appears for another member's stream with per-event re-authorization proven; no schema change.
```

### L16 - p3-m10-chat-web (M10, P2)

```text
LANE: L16 p3-m10-chat-web
GOAL: The chat UI for the D4 cut: channel list, keyset history, composer, reply, edit and delete own, host moderation, in-app unread state.
MILESTONE: M10    RISK: P2 (UI over finished routes)
BASE: origin/main at session start (git fetch first; record the full SHA)
WORKTREE: .autopilot/worktrees/p3-m10-chat-web    BRANCH: feat/p3-m10-chat-web
DEPENDS ON: L15 merged; D4 signed
OWNER DECISIONS NEEDED: D4. Unsigned => AWAIT this lane only.
FILES IN SCOPE:
- NEW apps/web/app/c/[tenantId]/chat/page.tsx and apps/web/app/c/[tenantId]/chat/[channelId]/page.tsx (Server Components gate auth with
  currentSession(); screens are Client Components); NEW apps/web/components/chat/* (channel list, message list, composer, message actions, moderation
  sheet, unread badge; each with .module.css, tokens only) + tests
- NEW apps/web/lib/chat-api.ts, apps/web/lib/use-chat.ts (history, send with client_msg_id, EventSource via L5 hook, reconnect refetch);
  apps/web/lib/session-error-ui.ts or a NEW chat-error-ui.ts (error mapping per screen)
- apps/web/components/sessions/ or the club shell navigation to add the Chat entry; apps/web/e2e/ new chat spec + a11y additions;
  apps/web/e2e/golden-path.spec.ts (chat step, local only); docs/runbooks/local-mvp-smoke.md section 9
NEGATIVE SCOPE: no API or DB change (a gap goes under OPEN); no DM, media, reactions, search, mentions, group, pin, poll, slash commands, digest or
  push UI; no hardcoded value; only the fields the merged DTOs return (UNPINNED - omit active UI); no message text in logs, analytics or the
  service-worker cache.
MODELS: writer sonnet/high; reviewer opus/high; security none; readiness opus/high.
DECISION TABLE: none new (the UI renders L14/L15 outcomes; the Error mapping table of each screen lists only codes of the merged routes and ends with
  an unknown/timeout fail-closed row).
TESTS: loading, ready, empty, error and offline states at 375px and desktop, light and dark, axe clean; optimistic send marks a message pending, then
  confirmed or failed with retry that reuses the same client_msg_id; edit allowed only while the server says so, a CHAT_EDIT_WINDOW_CLOSED answer is
  shown as a t(vi, en) message; tombstones render as "message removed" without detail; unread badge advances only after the read cursor call succeeds;
  host sees moderation actions, members do not; the service worker never caches /api/chat responses; two-browser e2e where a message appears live.
ACCEPTANCE COMMANDS: S1 VERIFY set; pnpm --filter @plexco/web exec playwright test; local golden-path run output cited or marked NOT RUN with the
  reason.
REVIEW PLAN: opus/high reviewer, max 3 rounds; questions = any content cached or logged client-side, moderation controls visible to members,
  double-send on retry, focus and live-region behaviour.
DONE WHEN: two members chat live locally, moderation works for a host, the extended golden path records a chat step.
```

### L17 - p3-closeout (all, P2)

```text
LANE: L17 p3-closeout
GOAL: Close Phase 3: ledger, handoff-3, backlog flips, runbook, owner P0 list and the recorded extended golden-path run. Docs only.
MILESTONE: all    RISK: P2 (docs)
BASE: origin/main at session start (git fetch first; record the full SHA)
WORKTREE: .autopilot/worktrees/p3-closeout    BRANCH: docs/p3-closeout
DEPENDS ON: all other lanes merged
OWNER DECISIONS NEEDED: none (list any default still "applied, pending owner sign-off")
FILES IN SCOPE:
- docs/sessions/web-mvp-program-status.md (milestone rows M6, M9, M10 with PR numbers and measured SHA); NEW
  docs/sessions/<date>-web-mvp-program-handoff-3.md; plans/261012-1400-web-mvp-program/plan.md (status pointer)
- docs/autopilot-backlog.md: flip every row the merged lanes closed (examples: app-worker-test-password-clash-flake,
  dev-app-worker-password-not-restored, db-test-unhandled-57p01-and-load-timeouts, e2e-web-pwa-offline-online-flake,
  session-text-fields-control-char-validation, list-sessions-occupied-count-single-source, the M6 chain rows projector-real-replace-stub,
  db-projector-dlq-no-replay-path, job-outbox-dispatch-sync-lag-slo, job-scheduler-cron-registration, session-publish-public-projector,
  feature-cross-club-join, feature-marketplace-discovery); flip only rows whose PR is merged, never by guess
- docs/runbooks/local-mvp-smoke.md (player + chat journey steps, readonly/discovery wiring, the extended golden-path command);
  docs/runbooks/outbox-dispatch-enable-rollback.md (L3) cross-check
- docs/00-start-here/HANDOFF.md newest LIVE TRUTH block only if the repo convention requires it
NEGATIVE SCOPE: no code, tests or migrations; no new decision numbers; no edit of Reviewed specs (L0 owns spec sync); never mark an owner P0 step
  done; no claim of live delivery, production or staging.
MODELS: writer sonnet/high; reviewer sonnet/high; security none; readiness sonnet/high.
DECISION TABLE: none (docs only).
TESTS: none. Evidence: run the extended local golden path (apps/web/e2e/golden-path.config.ts with GOLDEN_PATH_BASE_URL) on the final main and paste
  the measured result and the not-proven reporter output; if Docker or the port is unavailable write NOT RUN with the reason, never a pass.
ACCEPTANCE COMMANDS: pnpm format:check; pnpm review:check:changed; pnpm review:check; git diff --name-only <base>..HEAD lists only docs/ and plans/.
REVIEW PLAN: one sonnet/high reviewer, max 3 rounds; questions = every flipped row has a merged PR, every number carries its measuring SHA, owner
  steps are listed and none is claimed done.
DONE WHEN: handoff-3 lists state, open proposals (defaults applied, pending sign-off), the owner P0 steps (enable OUTBOX_DISPATCH_SCHEDULE_ENABLED,
  connect a real Zalo bot token, re-enable the announce route per decisions.md:757, message real users) and the golden-path evidence.
```

## S3. Sessions P3-S1..P3-S10

Mỗi block là một session tự đủ: conductor chép nguyên block vào file session local, đính kèm block S1 và các block lane (S2) của session đó. Thứ tự lane trong cùng session ghi rõ; migration lane không bao giờ chạy song song.

### P3-S1 - docs sync + CI hardening + text safety (L0, L1, L2)

```text
SESSION P3-S1 (orchestrator: Fable xhigh, or opus/max while the Fable limit holds)
DEPENDS ON: Phase 3 plan merged or approved. L0 also needs D1-D5 signed (an unsigned Dn only skips its own edits). L1 and L2 need nothing else.
READ FIRST: the S1 operating rules block; lane blocks L0, L1, L2; docs/00-start-here/HANDOFF.md (newest LIVE TRUTH block); docs/standards/decisions.md (DD-122, DD-131, DD-132, DD-133..DD-137);
  docs/sessions/web-mvp-program-status.md.
STEP 0: per lane, a readiness reviewer (same model and effort as that lane's code reviewer) re-verifies live truth at the session base (commit, schema, migrations, grants and RLS, tests, dependent specs) and
  writes docs/sessions/web-mvp-phase3-readiness-<slug>.md: the code-ready review-readiness marker, the canonical verdict block of docs/standards/review-code-readiness-gate.md, TARGET_FILES only files that
  exist. It is the lane branch's FIRST commit and must pass pnpm review:check:changed. NOT_CODE_READY => that lane AWAITs with the exact blocker; other lanes continue.
TASKS: 1) step 0 for L0, L1, L2. 2) Writers run in parallel in .autopilot/worktrees/p3-docs-decisions-sync, p3-ci-flake-hardening, p3-session-text-control-chars. 3) Each lane: verify, orchestrator pushes and
  opens the PR, independent review (max 3 rounds, L2 reviewer also covers input security), CI GREEN, MERGE_READY.
PARALLEL: all three. File-disjoint: L0 edits docs/ and plans/ only; L1 edits test files and test harnesses plus apps/web/e2e/pwa.spec.ts; L2 edits session-service.ts, a new text-safety module and the web
  session form model. DB and e2e verification runs serialise on the one lock (one Postgres, one port).
MERGE ROUND: order L0, L1, L2 (L2's verification benefits from L1's harness). After each merge, bring the next PR up to date with git merge --no-ff origin/main.
STOP: AWAIT per lane on NOT_CODE_READY or unsigned Dn; BLOCKED on 3 failed review rounds, scope drift, or a flake that survives the L1 root-cause work; never loosen a timeout to pass.
REPORT: per lane: STATUS, HEAD (full sha), CHANGED, CHECKS with measured output, OPEN; the L1 N-run flake evidence; MERGE_READY #<n> head=<full 40-char sha> by=S1 per PR; last line RESULT: DONE | CONTINUE |
  AWAIT | BLOCKED.
```

### P3-S2 - M6 delivery core + visibility toggle (L3, L6)

```text
SESSION P3-S2 (orchestrator: Fable xhigh, or opus/max while the Fable limit holds)
DEPENDS ON: P3-S1 merged (L1 flake hardening and L2 text safety); D2 signed (L3) and D5 signed (starts M6). L6 needs only L2.
READ FIRST: S1 operating rules; lane blocks L3, L6; docs/features/BE/feature_sync_engine_tech.md; docs/features/BE/feature_session_management_tech.md (section 4 draft discard + auto-expiry,
  edges #28-#30); apps/bot/src/dispatcher.ts, worker.ts, queues.ts; packages/db/migrations/0022, 0023, 0033.
STEP 0: per lane, a readiness reviewer (same model and effort as that lane's code reviewer) re-verifies live truth at the session base and writes
  docs/sessions/web-mvp-phase3-readiness-<slug>.md (code-ready marker, canonical verdict block, TARGET_FILES only existing files) as the lane branch's FIRST commit; it must pass pnpm
  review:check:changed. NOT_CODE_READY => that lane AWAITs with the exact blocker.
TASKS: 1) step 0 for L3 and L6. 2) L3 (migration lane, opus/max + security) and L6 (no migration) run in parallel. 3) Each lane: verify, push + PR, independent review (max 3 rounds),
  security round for L3, CI GREEN, MERGE_READY. 4) L3 report carries the measured sync-lag numbers with the stated load.
PARALLEL: L3 and L6. File-disjoint: L3 edits apps/bot, packages/db migrations/schema, scripts, runbook (session-service.ts only for a system-cancel hook); L6 edits apps/web session
  components, web lib and e2e, and adds only tests under packages/db. L3 is the only migration lane in this session.
MERGE ROUND: order L3, L6. Owner note after merge: OUTBOX_DISPATCH_SCHEDULE_ENABLED stays false; the runbook from L3 holds the enable and rollback steps (owner P0).
STOP: AWAIT L3 if D2 is unsigned (L6 continues); HALT L6 if the toggle needs a migration; BLOCKED on 3 failed rounds, a REGION_THRASH, or any path found that lets app_worker read a base
  table.
REPORT: per lane STATUS, HEAD, CHANGED, CHECKS, OPEN; L3 sync-lag table; MERGE_READY #<n> head=<full 40-char sha> by=S2 per PR; last line RESULT: DONE | CONTINUE | AWAIT | BLOCKED.
```

### P3-S3 - M6 Zalo outbound + web live sync (L4, L5)

```text
SESSION P3-S3 (orchestrator: Fable xhigh, or opus/max while the Fable limit holds)
DEPENDS ON: P3-S2 merged (L3 registry, wake-up, DLQ); D2 signed. After this session merges M6 is code-complete.
READ FIRST: S1 operating rules; lane blocks L4, L5; apps/web/lib/connector-secrets.ts, apps/web/lib/zalo/client.ts, apps/web/lib/zalo/process-event.ts; packages/db/src/zalo-ingress.ts;
  docs/features/BE/feature_sync_engine_tech.md; docs/runbooks/outbox-dispatch-enable-rollback.md (from L3).
STEP 0: per lane, a readiness reviewer (same model and effort as that lane's code reviewer) re-verifies live truth at the session base and writes docs/sessions/web-mvp-phase3-readiness-<slug>.md (code-ready
  marker, canonical verdict block, TARGET_FILES only existing files) as the lane branch's FIRST commit; it must pass pnpm review:check:changed. NOT_CODE_READY => that lane AWAITs with the exact blocker.
TASKS: 1) step 0 for L4 and L5. 2) L4 (opus/max + security; migration likely) and L5 (opus/max + security; no migration) run in parallel. 3) Each lane: verify, push + PR, independent review plus security round
  (max 3 rounds), CI GREEN, MERGE_READY. 4) Prepare the owner P0 list: enable the schedule, connect a real Zalo bot token, re-enable the announce route (decisions.md:757), message real users; none is done by an
  agent.
PARALLEL: L4 and L5. File-disjoint: L4 edits the Zalo projector, the shared connector crypto, packages/db (definer migration, session-service announce payload) and web connector files; L5 edits the web_realtime
  projector, the web realtime route/lib/hooks and e2e. Both add one line to apps/bot/src/projectors/index.ts (created by L3): the merge clerk resolves that mechanically, any other overlap is reported. Only L4
  may carry a migration.
MERGE ROUND: order L4, L5. Then the conductor runs the M6 local golden-path check (verifier worker sonnet/high, evidence only).
STOP: AWAIT L4 or L5 if D2 is unsigned; BLOCKED on any claim of live delivery, a secret that must be provisioned, or 3 failed rounds.
REPORT: per lane STATUS, HEAD, CHANGED, CHECKS, OPEN; L5 p95 numbers with load; the P0 list; MERGE_READY #<n> head=<full 40-char sha> by=S3 per PR; last line RESULT: DONE | CONTINUE | AWAIT | BLOCKED.
```

### P3-S4 - M9 occupancy helper then join core (L7, L8)

```text
SESSION P3-S4 (orchestrator: Fable xhigh, or opus/max while the Fable limit holds)
DEPENDS ON: P3-S3 merged (M6 done). L7 needs nothing else; L8 needs L7 and D3 signed.
READ FIRST: S1 operating rules; lane blocks L7, L8; docs/features/FE/feature_cross_club_join.md + BE/feature_cross_club_join_tech.md; packages/db/src/roster-service.ts;
  docs/research/occupancy-authority-2026-10-16.md if present; docs/standards/decisions.md (DD-133, DD-135).
STEP 0: per lane, a readiness reviewer (same model and effort as that lane's code reviewer) re-verifies live truth at the session base and writes
  docs/sessions/web-mvp-phase3-readiness-<slug>.md (code-ready marker, canonical verdict block, TARGET_FILES only existing files) as the lane branch's FIRST commit; it must pass pnpm
  review:check:changed. NOT_CODE_READY => that lane AWAITs with the exact blocker.
TASKS: 1) step 0 for L7 and L8. 2) L7 first (no owner wait), verify, push + PR, review, CI GREEN, MERGE_READY. 3) L8 starts from the L7 branch head (stacked PR; its base branch is the L7
  branch), same flow plus the security round; the concurrency test must run as the real app role. 4) L8 AWAITs alone if D3 is unsigned; L7 still ships.
PARALLEL: none. L8 reads and extends L7's helper and both touch roster-service.ts and session-service.ts, so they run in sequence on a stack.
MERGE ROUND: merge L7, retarget L8 to main and bring it up to date with git merge --no-ff origin/main, re-run its checks, then merge L8. L8 is the migration lane of this session.
STOP: AWAIT L8 on unsigned D3; HALT on an oversell in the concurrency test, a second occupancy formula found, or any client-supplied person or tenant id being trusted; BLOCKED on 3 failed
  rounds.
REPORT: per lane STATUS, HEAD, CHANGED, CHECKS, OPEN; L7 equivalence evidence; L8 concurrency evidence and the UNPINNED pins; MERGE_READY #<n> head=<full 40-char sha> by=S4 per PR; last line
  RESULT: DONE | CONTINUE | AWAIT | BLOCKED.
```

### P3-S5 - M9 person-scoped reads (L9)

```text
SESSION P3-S5 (orchestrator: Fable xhigh, or opus/max while the Fable limit holds)
DEPENDS ON: P3-S4 merged (L8); D3 signed.
READ FIRST: S1 operating rules; lane block L9; docs/features/FE/feature_player_view.md + BE/feature_player_view_tech.md;
  packages/db/migrations/0055_me_settings_definers.sql; packages/db/src/me-settings.ts; apps/web/lib/me-route-gate.ts.
STEP 0: a readiness reviewer (same model and effort as L9's code reviewer) re-verifies live truth at the session base and writes
  docs/sessions/web-mvp-phase3-readiness-p3-m9-me-reads.md (code-ready marker, canonical verdict block, TARGET_FILES only existing files) as the lane
  branch's FIRST commit; it must pass pnpm review:check:changed. NOT_CODE_READY => AWAIT with the exact blocker.
TASKS: 1) step 0 for L9. 2) L9 writer (opus/max) in .autopilot/worktrees/p3-m9-me-reads. 3) Verify, push + PR, independent review plus security round
  (max 3 rounds), CI GREEN, MERGE_READY. 4) Evidence: cross-person and cross-tenant isolation tests run as the real app role.
PARALLEL: none (single migration lane; migrations never overlap).
MERGE ROUND: merge L9 after owner approval; nothing is stacked on it.
STOP: AWAIT on unsigned D3; HALT if any function needs a person or tenant parameter from the client, or any response can carry another person's data;
  BLOCKED on 3 failed rounds.
REPORT: STATUS, HEAD, CHANGED, CHECKS, OPEN; the isolation test list with output; MERGE_READY #<n> head=<full 40-char sha> by=S5; last line RESULT:
  DONE | CONTINUE | AWAIT | BLOCKED.
```

### P3-S6 - M9 public projector + discovery (L10)

```text
SESSION P3-S6 (orchestrator: Fable xhigh, or opus/max while the Fable limit holds)
DEPENDS ON: P3-S5 merged (migrations are strictly sequential); L3, L6, L7 merged; D1 signed including the stage-2 session_occupancy(uuid) authorization.
READ FIRST: S1 operating rules; lane block L10; docs/features/FE/feature_marketplace_discovery.md + BE/feature_marketplace_discovery_tech.md; packages/db/migrations/0006, 0024, 0033, 0036;
  docs/standards/decisions.md (DD-12, DD-114 D3, DD-133); docs/research/occupancy-authority-2026-10-16.md if present; apps/web/middleware.ts and lib/request-policy.ts.
STEP 0: a readiness reviewer (same model and effort as L10's code reviewer) re-verifies live truth at the session base and writes
  docs/sessions/web-mvp-phase3-readiness-p3-m9-public-projector-discovery.md (code-ready marker, canonical verdict block, TARGET_FILES only existing files) as the lane branch's FIRST commit;
  it must pass pnpm review:check:changed. NOT_CODE_READY => AWAIT with the exact blocker.
TASKS: 1) step 0 for L10. 2) L10 writer (opus/max) in .autopilot/worktrees/p3-m9-public-projector-discovery. 3) Verify, push + PR, independent review plus security round (max 3 rounds), CI
  GREEN, MERGE_READY. 4) Record the chosen local wiring of the readonly read path and the UNPINNED pins (rate limit, page size, no cache, host_display_name NULL).
PARALLEL: none.
MERGE ROUND: merge L10 after owner approval.
STOP: AWAIT on unsigned D1; HALT on any re-grant of base SELECT, any new public field beyond the whitelist, or a confirmed_count appearing anywhere; BLOCKED on 3 failed rounds.
REPORT: STATUS, HEAD, CHANGED, CHECKS, OPEN; whitelist test output; slots_open parity evidence; MERGE_READY #<n> head=<full 40-char sha> by=S6; last line RESULT: DONE | CONTINUE | AWAIT |
  BLOCKED.
```

### P3-S7 - M9 gender pricing (L11)

```text
SESSION P3-S7 (orchestrator: Fable xhigh, or opus/max while the Fable limit holds)
DEPENDS ON: P3-S6 merged (migrations are strictly sequential); L8 merged. DD-39 is signed, no owner wait.
READ FIRST: S1 operating rules; lane block L11; docs/standards/decisions.md (DD-39 at :542-556); docs/features/BE/feature_user_settings_tech.md (charge derivation
  section); docs/features/FE/feature_user_settings.md; apps/web/lib/connector-secrets.ts or the shared connector crypto from L4.
STEP 0: a readiness reviewer (same model and effort as L11's code reviewer) re-verifies live truth at the session base and writes
  docs/sessions/web-mvp-phase3-readiness-p3-m9-gender-pricing.md (code-ready marker, canonical verdict block, TARGET_FILES only existing files) as the lane branch's FIRST
  commit; it must pass pnpm review:check:changed. NOT_CODE_READY => AWAIT with the exact blocker.
TASKS: 1) step 0 for L11. 2) L11 writer (opus/max) in .autopilot/worktrees/p3-m9-gender-pricing. 3) Verify, push + PR, independent review plus security round (max 3
  rounds), CI GREEN, MERGE_READY. 4) Evidence: the decrypt-failure no-charge test for host-add, join and promotion, and the public-whitelist test.
PARALLEL: none.
MERGE ROUND: merge L11 after owner approval.
STOP: HALT on any fallback price after a decrypt failure, plaintext gender in a log or error, or a host path that reads raw gender; BLOCKED on 3 failed rounds.
REPORT: STATUS, HEAD, CHANGED, CHECKS, OPEN; the decision-table test map; MERGE_READY #<n> head=<full 40-char sha> by=S7; last line RESULT: DONE | CONTINUE | AWAIT |
  BLOCKED.
```

### P3-S8 - M9 player web + Zalo player commands (L12, L13)

```text
SESSION P3-S8 (orchestrator: Fable xhigh, or opus/max while the Fable limit holds)
DEPENDS ON: P3-S7 merged; L8, L9, L10 merged (L12); L8, L4 merged (L13); D3 signed (D1 for the slots_open display). Neither lane has a migration.
READ FIRST: S1 operating rules; lane blocks L12, L13; docs/channels/web/FE/feature_player_view_fe.md and feature_marketplace_fe.md (reference input only); docs/standards/design-tokens.md;
  apps/web/lib/zalo/*; docs/runbooks/local-mvp-smoke.md.
STEP 0: per lane, a readiness reviewer (same model and effort as that lane's code reviewer) re-verifies live truth at the session base and writes
  docs/sessions/web-mvp-phase3-readiness-<slug>.md (code-ready marker, canonical verdict block, TARGET_FILES only existing files) as the lane branch's FIRST commit; it must pass pnpm
  review:check:changed. NOT_CODE_READY => that lane AWAITs with the exact blocker.
TASKS: 1) step 0 for L12 and L13. 2) L12 writer sonnet/high (reviewer opus/high) and L13 writer opus/max (reviewer + security opus/max) in parallel. 3) Each lane: verify, push + PR, review
  (max 3 rounds), CI GREEN, MERGE_READY. 4) After the merge round the conductor runs the extended local golden path for M9 (verifier worker sonnet/high; evidence only).
PARALLEL: L12 and L13. File-disjoint: L12 edits apps/web/app/discover, apps/web/app/me, apps/web/components, discover/player libs and e2e; L13 edits apps/web/lib/zalo, packages/db
  zalo-ingress and the webhook route test. An API gap found by L12 goes under OPEN, never into its scope.
MERGE ROUND: order L13, L12 (L12 carries the golden-path extension and is verified last on the merged base).
STOP: AWAIT a lane on an unsigned decision; HALT on bank data or another player's debt appearing in any UI or reply; BLOCKED on 3 failed rounds.
REPORT: per lane STATUS, HEAD, CHANGED, CHECKS, OPEN; the golden-path result or NOT RUN with the reason; MERGE_READY #<n> head=<full 40-char sha> by=S8 per PR; last line RESULT: DONE |
  CONTINUE | AWAIT | BLOCKED.
```

### P3-S9 - M10 chat core (L14)

```text
SESSION P3-S9 (orchestrator: Fable xhigh, or opus/max while the Fable limit holds)
DEPENDS ON: P3-S8 merged; L8 merged; D4 signed. Needs pnpm db:bootstrap run first (chat_definer role).
READ FIRST: S1 operating rules; lane block L14; docs/features/FE/feature_inapp_chat.md + BE/feature_inapp_chat_tech.md (sections 3-4); packages/db/migrations/0030, 0031,
  0032, 0047, 0049; infra/postgres-init/02-chat-definer.sql; docs/standards/decisions.md (DD-86, DD-136).
STEP 0: a readiness reviewer (same model and effort as L14's code reviewer) re-verifies live truth at the session base and writes
  docs/sessions/web-mvp-phase3-readiness-p3-m10-chat-core.md (code-ready marker, canonical verdict block, TARGET_FILES only existing files) as the lane branch's FIRST
  commit; it must pass pnpm review:check:changed. NOT_CODE_READY => AWAIT with the exact blocker.
TASKS: 1) step 0 for L14. 2) L14 writer (opus/max) in .autopilot/worktrees/p3-m10-chat-core. 3) Verify, push + PR, independent review plus security round (max 3 rounds),
  CI GREEN, MERGE_READY. 4) Record the UNPINNED pins (message cap, audit and revision table names, provisioning trigger vs call).
PARALLEL: none (single migration lane).
MERGE ROUND: merge L14 after owner approval.
STOP: AWAIT on unsigned D4; HALT if any function makes a DM channel reachable, bypasses a capability check, or logs message text; BLOCKED on 3 failed rounds.
REPORT: STATUS, HEAD, CHANGED, CHECKS, OPEN; decision-table test map; MERGE_READY #<n> head=<full 40-char sha> by=S9; last line RESULT: DONE | CONTINUE | AWAIT | BLOCKED.
```

### P3-S10 - M10 chat API + UI, then closeout (L15, L16, L17)

```text
SESSION P3-S10 (orchestrator: Fable xhigh, or opus/max while the Fable limit holds)
DEPENDS ON: P3-S9 merged; L5 merged (transport); D4 signed. No migration lane here.
READ FIRST: S1 operating rules; lane blocks L15, L16, L17; docs/features/BE/feature_inapp_chat_tech.md (route contract); apps/web/lib/realtime-listener.ts and realtime-auth.ts (L5);
  docs/sessions/web-mvp-program-status.md.
STEP 0: per lane, a readiness reviewer (same model and effort as that lane's code reviewer) re-verifies live truth at the session base and writes
  docs/sessions/web-mvp-phase3-readiness-<slug>.md (code-ready marker, canonical verdict block, TARGET_FILES only existing files) as the lane branch's FIRST commit; it must pass pnpm
  review:check:changed. NOT_CODE_READY => that lane AWAITs with the exact blocker.
TASKS: 1) step 0 per lane when it starts. 2) L15 (opus/max + security), then L16 (stacked on L15, sonnet/high, reviewer opus/high), each: verify, push + PR, review (max 3 rounds), CI GREEN,
  MERGE_READY. 3) L17 (docs, sonnet/high) last, stacked on L16: flips only backlog rows whose PR is merged at its base; rows of L15 and L16 are marked merge-ready and flipped by the merge
  clerk in the final round with one follow-up commit on the L17 branch before it merges. 4) Run the extended golden path for M10 after the final merge round (verifier sonnet/high) and paste
  the result into the closeout.
PARALLEL: none (L16 needs L15's routes; L17 needs both).
MERGE ROUND (FINAL): order L15, L16, L17; retarget each stacked PR to main and bring it up to date with git merge --no-ff origin/main before merging.
STOP: AWAIT a lane on unsigned D4; HALT on chat text in a log, NOTIFY payload or service-worker cache, or any new migration need in L15; BLOCKED on 3 failed rounds.
REPORT: per lane STATUS, HEAD, CHANGED, CHECKS, OPEN; the closeout evidence; MERGE_READY #<n> head=<full 40-char sha> by=S10 per PR; last line RESULT: DONE | CONTINUE | AWAIT | BLOCKED.
```

## S4. Ghi chú cho conductor

| Session | Lane | Milestone | Cổng sau merge round |
|---|---|---|---|
| P3-S1 | L0, L1, L2 | docs, infra, M9 prerequisite | CI GREEN trên main; L1 có N lần chạy song song không flake |
| P3-S2 | L3, L6 | M6 | cờ schedule vẫn false; runbook enable/rollback có mặt |
| P3-S3 | L4, L5 | M6 xong | golden path local M6 (evidence); danh sách P0 của owner |
| P3-S4 | L7 -> L8 | M9 | test concurrency không oversell |
| P3-S5, S6, S7 | L9, L10, L11 | M9 | migration tuần tự, mỗi PR một migration |
| P3-S8 | L12, L13 | M9 xong | golden path local M9 (evidence) |
| P3-S9, S10 | L14, L15 -> L16 -> L17 | M10 xong | golden path local M10 + closeout |

- **Vòng lặp:** chạy tuần tự S1..S10; session N+1 chỉ bắt đầu sau khi merge round của session N đã xong (hoặc owner nói rõ bỏ qua một lane). Mỗi session tối đa **6 lần chạy orchestrator**; lần thứ 7 coi như `BLOCKED` và báo owner.
- **CONTINUE:** orchestrator chạm khoảng 20 kết quả worker thì ghi `CHECKPOINT` (trạng thái từng lane, số PR, head đầy đủ, finding còn mở, việc kế tiếp) và trả `RESULT: CONTINUE`; conductor tiếp tục cùng orchestrator bằng SendMessage, hoặc mở lần chạy mới với đúng CHECKPOINT đó.
- **AWAIT:** chuyển cho owner đúng một câu hỏi + một đề xuất + điều kiện resume nhị phân; trong lúc chờ chạy tiếp các lane không phụ thuộc. Một Dn chưa ký chỉ chặn lane của nó.
- **BLOCKED:** không retry mù. Theo thứ tự: thêm context -> chia nhỏ task -> nâng Sonnet lên Opus -> báo owner. Cùng một lane thất bại 3 lần thì dừng và báo.
- **Hết usage limit** (429 hoặc thông báo giới hạn từ bất kỳ agent nào): dừng tạo agent mới, để worker đang chạy kết thúc hoặc dừng sạch, ghi CHECKPOINT, trả `RESULT: CONTINUE` lý do `usage_limit`. Conductor đề xuất cho owner chọn (đợi hoặc chạy ngay bằng opus/max); không im lặng đổi model; resume bằng SendMessage tới orchestrator cũ.
- **Merge round:** merge là việc của owner (hoặc merge clerk chỉ khi owner cho phép trong session đó). Orchestrator không merge, không đóng PR, không xoá branch.
- **P0:** không bao giờ là lane. Danh sách việc owner (bật `OUTBOX_DISPATCH_SCHEDULE_ENABLED`, nối bot token Zalo thật, bật lại announce route theo `decisions.md:757`, nhắn người dùng thật) nằm trong handoff-3 của L17.
- **Kết thúc:** sau merge round cuối, conductor chạy một summariser (sonnet/high): đọc ledger, handoff-3, danh sách PR, rồi viết MỘT báo cáo tiếng Việt cho owner (đã ship gì, số đo, default đang chờ ký, việc P0, rủi ro còn lại, câu hỏi mở). Summariser không sửa file trong repo.

