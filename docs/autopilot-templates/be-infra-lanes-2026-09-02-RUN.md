# BE + infra lanes — prompt sẵn dùng, xếp theo mật độ Tier C

**Ngày:** 02/09/2026 · **Base:** `main@7675e03` · **Chương trình:** `completion-program-2026-09-02-RUN.md`
**Ưu tiên đang áp (owner 25/08, tái xác nhận 02/09):** **BE + infra trước, FE sau.**

> **Cách dùng:** mỗi lane dưới đây có một khối ` ```text ` dán thẳng vào Claude Code. Prose tiếng Việt là để
> bạn chọn lane; payload English là để agent thi hành (luật ngôn ngữ của repo).
> **Chạy theo thứ tự L0 → L6.** Trong cùng một wave, chỉ chạy song song các lane có `scope` và `invariants`
> rời nhau — L1 và L2 rời nhau; L3 phải đợi L1 vì cùng chạm `apps/web/lib/`.

---

## Bối cảnh chung — dán kèm mọi lane

Mọi prompt dưới đây **giả định** khối này đã được agent đọc. Nếu phiên mới tinh, dán khối này trước.

```text
REPO CONTEXT — read before acting, do not skip
  Base: main @ 7675e03 (re-pin to current origin/main first; main may be ahead of origin).
  Read, in this order, and nothing more until the lane is scoped:
    docs/00-start-here/HANDOFF.md              (live-truth block only)
    docs/standards/decisions.md                ("| DD-nn |" summary table only, not bodies)
    docs/standards/review-code-readiness-gate.md
    docs/autopilot-templates/level3-workflow.md  (sections 6.1, 7, 8, 9)
    docs/product/ROADMAP.md                    (block dated 2026-09-02 only)
  Do NOT attempt to load the whole docs/ corpus: it is ~2M tokens. Coverage is
  guaranteed by search-and-log, not by loading. Before trusting a null grep,
  verify the query finds a known-present control case.

  WORKFLOW_LEVEL: 3 · WORKFLOW_MODE: supervised_autonomy
  AUTONOMY_MODE: autonomous_to_ready · DEFAULT_STOP_MODE: STOP_AT_READY · AUTO_MERGE: off
  Tier A/B/C ladder per level3-workflow section 6.1, verbatim. Tier C is exactly
  its 8-item list; nothing added, nothing removed. Stopping on a Tier A item is a
  defect — log it in the ledger as one. Append every Tier A/B decision to
  .autopilot/state/<feature>/DECISIONS.md as it is made, with the mandatory
  Searched: field including queries that returned nothing.

  ONE WRITING SLICE = ONE BRANCH = ONE WORKTREE = AT MOST ONE WRITER.
  Register runtime scope before writing:
    scripts/autopilot-scope-gate register --manifest .autopilot/state/<feature>/manifest.json
  That manifest is the RUNTIME one, hand-written from
  docs/autopilot-manifests/_TEMPLATE.json, carrying
  manifest_schema_version: level3-operational-v2. Never pass the authored
  contract path under docs/autopilot-manifests/<slug>.json — that HALTs
  CONTRACT_INVALID. After every register, verify that
  .autopilot/state/<feature>/registered-manifest.sha256 exists before doing
  anything else. Do not trust the word "registered".

  HARD CONSTRAINTS no lane may cross
    - The 5 HARD RULES in CLAUDE.md. i18n is literal t("vi", "en") string pairs;
      this repo has NO key-based i18n and no locale files.
    - Never re-grant role app base SELECT on public_sessions (0033 + 0036).
    - The outbox does NOT guarantee per-aggregate ordering (0023:176-208).
    - Do not enable OUTBOX_DISPATCH_SCHEDULE_ENABLED or GOOGLE_OAUTH_*. Tier C.
    - Do not git add design.pen or fe.pen. FE is PENDING under DD-116.
    - Do not widen beyond declared negative scope. Re-slice or AWAIT.

  VERIFY WITH REAL COMMANDS, NOT PROSE
    DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm test
    pnpm build · pnpm lint · pnpm typecheck
    node scripts/check-review-readiness.mjs --changed      (red = hard stop)
    Then the mandatory independent review: scripts/codex-review-pin.sh
    Reviewer unreachable => wait and retry with backoff; if truly unavailable,
    HALT TOOL_UNAVAILABLE. Never self-certify, never lower the gate.

  TERMINAL STATES
    READY  = exact diff + gates run directly + clean independent review + ledger.
    AWAIT  = Tier C only. One question, one recommendation, one binary resume
             condition. Park the lane and continue other roots; never idle the
             program on one AWAIT.
    HALT   = MAX_ROUNDS above 5, or REGION_THRASH same region 3 rounds running.
```

---

## L0 · infra · Re-pin canonical runner và làm sạch trục Tests

**Vì sao trước tiên:** đây là **thứ duy nhất gỡ được nhãn `STALE`** mà ROADMAP v3.13 vừa đặt lên trục Tests.
Cho tới khi nó chạy, mọi verdict dựa trên số test phải đọc `854 + 30 @ 93f1e93` (15/08) — một con số đã
cách hiện tại 5 migration và 9 test file. **Lane này phải chạy trên máy có Postgres**, không chạy được trong
VM Cowork (không có `pnpm`).

**Tier C:** 0 · **Rủi ro:** P3 (không writer nghiệp vụ) · **Chạy song song được với:** mọi lane khác

```text
TASK: repin-canonical-runner-2026-09
RISK: P3
OUTCOME
  Replace the STALE marker on the Tests axis with a measured number, and close the
  law-4 reconciliation (static + generated = runner) that cannot be closed today.

WHY IT IS STALE (do not re-derive, verify then move on)
  The 813 @ 80a3464 mark cannot be carried to HEAD. Its precondition was that
  intervening commits touch neither packages/ nor apps/. Verify and expect failure:
    git diff --name-only 80a3464..HEAD -- packages apps | wc -l     # expect ~34
  The informal 919 measured after 9da3021 was never authority and is now several
  merges old. Authority remains 854 workspace + 30 validator @ 93f1e93.

STEPS
  1. Confirm a clean tree on current origin/main.
  2. Run the canonical runner, full, once:
       DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm test
     Capture the per-package split (core / db / web / bot) and the validator count
     separately. These are two measurement scales and must never be added silently
     into one number — that error has already been made once in this repo.
  3. Re-run the static cross-check and the TWO-LAYER generator inventory from
     the ROADMAP count-reproduction command block (section "Cach doc tien do",
     the collapsed <details> block). Layer 2 (it.each/test.each) now returns 17 hits,
     up from 2; static grep sees none of that class. Reconcile explicitly:
       static + generated == runner ?
     If it does not close, report the exact gap and which layer accounts for it.
     Do NOT adjust a number to make the identity hold.
  4. Update, in one commit:
       docs/product/ROADMAP.md          — Tests rows, remove the STALE marker,
                                          append the new mark to the workspace-only
                                          historical chain, add a changelog row
       docs/standards/BUILD-STATUS.md   — mirror the same numbers in its live-truth
                                          block; the two files must not disagree
SCOPE
  docs/product/ROADMAP.md, docs/standards/BUILD-STATUS.md
NEGATIVE SCOPE
  No code, no migration, no test change. If the runner FAILS, that is a finding to
  report, not a thing to fix in this lane.
ACCEPTANCE
  - Runner output pasted verbatim into the commit body, with per-package split.
  - Workspace and validator counts stated separately and labelled.
  - The static/generated/runner identity either closes with arithmetic shown, or
    the gap is named with its cause.
  - node scripts/check-review-readiness.mjs --changed passes.
```

---

## L1 · BE · Route `close` + `cancel` — và ba chặn cơ học đã đo được

**Vì sao lane này đứng đầu nhóm code:** hai command đã merge, DD-110 đã đặt tên action class, DD-117 đã chốt
nhánh paid/retry-root = fail-closed refuse, và ba route cùng khuôn đã tồn tại. **Tier C thực tế = 0.**

**Nhưng nó không "chỉ là copy route thứ tư".** Đo tại `7675e03`, có **ba chặn cơ học chưa ai ghi ra**:

1. **`closeSession`/`cancelSession` KHÔNG có trong barrel** `packages/db/src/index.ts` —
   `grep -c "closeSession\|cancelSession" packages/db/src/index.ts` trả **0**. Route import từ `@plexco/db`,
   nên không sửa barrel thì route không compile. Bốn error class (`SessionCloseError`,
   `SessionCloseAuthorizationError`, `SessionCancelError`, `SessionCancelAuthorizationError`) cũng vắng.
2. **`mapSessionCommandError` chỉ phủ Publish/Update** (`apps/web/lib/session-command-route.ts:518-524`).
   Không mở rộng thì lỗi close/cancel **rơi ra 500** thay vì mã lỗi đúng — đây là fail-open trên đường trả
   lỗi, không phải thiếu tiện nghi.
3. `announceSession` cũng chưa được phủ ở (2) — **đúng và phải giữ nguyên**, vì announce chưa có route và
   bị gate bởi DD-56 clause 1. Đừng "tiện tay" thêm.

**Tier C:** 0 · **Rủi ro:** P2 · **Không chạy song song với:** L3 (cùng chạm `apps/web/lib/`)

```text
TASK: session-routes-close-cancel
RISK: P2
BASE: current origin/main

OUTCOME
  POST /api/sessions/:id/close and POST /api/sessions/:id/cancel exist, behave like
  the three routes already merged, and return the command's real error codes rather
  than a 500.

THREE MEASURED PREREQUISITES — verify each yourself before writing, then fix in order
  P1. packages/db/src/index.ts does NOT export closeSession or cancelSession.
      Verify: grep -c "closeSession\|cancelSession" packages/db/src/index.ts   # expect 0
      Export both functions, their four error classes (SessionCloseError,
      SessionCloseAuthorizationError, SessionCancelError,
      SessionCancelAuthorizationError) and their param/result/error-code types,
      following the shape of the existing session block at index.ts:27-56 exactly.
  P2. apps/web/lib/session-command-route.ts:518-524 maps only Publish/Update errors.
      Extend mapSessionCommandError to the close and cancel classes. Read what the
      command actually throws before mapping it; do not infer the code set from the
      route layer.
  P3. Do NOT add announceSession to either P1 or P2. It has no route and is gated by
      DD-56 clause 1. Adding it here is scope widening, not tidiness.

THEN THE ROUTES
  Copy the exact shape of apps/web/app/api/sessions/[id]/publish/route.ts, including:
    - handleSessionCommand wrapper with a named rate-limit bucket
    - readExpectedVersion passed through unvalidated, because dedup precedes
      validation inside the command (DD-117 D5), so a retry of an already-committed
      command must replay rather than 400
    - id passed through unvalidated, because the command fails a non-UUID closed as
      SESSION_NOT_FOUND before any cast could raise a raw 22P02
  Rate limit: the BE spec pins create 10/min and update 20/min per tenant and does
  not pin close/cancel. Take the conservative pinned neighbour (10), exactly as the
  publish route already did, and say so in a comment. Inventing a looser limit is a
  Tier B decision that needs a ledger entry; taking the documented precedent is
  Tier A.

SCOPE
  packages/db/src/index.ts
  apps/web/lib/session-command-route.ts
  apps/web/app/api/sessions/[id]/close/route.ts        (new)
  apps/web/app/api/sessions/[id]/cancel/route.ts       (new)
  plus the test files for each of the above
NEGATIVE SCOPE
  No change to session-service.ts. No announce route. No new migration. No change to
  authorizeTenantAction or its action-class enum. No FE.

ACCEPTANCE
  - Both routes return the command's real error codes; prove it with a test per
    error class, not one happy-path test each.
  - A replayed commandId returns the stored result, not a 400 — matching the
    publish route's contract.
  - The DD-56 lint guard still passes.
  - Full suite green with DATABASE_URL_TEST; validator passes; one clean
    independent review round minimum, two to close the gate.
```

---

## L2 · infra · Trace credential Zalo trước khi chọn cơ chế

**Vì sao lane này là read-only:** backlog row `db-zalo-bots-secret-hardening` đang **sai scope** — row nói
`zalo_bots.secret`, còn fixture tracked dùng `bot_token_enc`. Chọn KMS / hash / rotation trước khi biết
field thật là ra quyết định trên dữ liệu sai. Lane này **không sửa gì**; nó trả về một đề xuất để owner chốt
(hàng **O4** của bảng quyết định).

**Tier C:** 0 (nó không quyết gì) · **Rủi ro:** P3 · **Chạy song song được với:** mọi lane

```text
TASK: zalo-credential-path-trace
RISK: P3
MODE: read-only research. This lane writes exactly one document and no code.

OUTCOME
  A pinned, evidence-backed answer to: which field actually stores a Zalo credential,
  who reads and writes it, and what the provider requires — so that the owner can
  choose a protection mechanism against real data instead of a stale backlog row.

QUESTIONS, each answered with file:line evidence
  1. Which column is real? The backlog row names zalo_bots.secret; tracked fixtures
     use bot_token_enc. Read packages/db/schema.ts around the zaloBots table
     (line ~1231) and every migration that touched it. State which columns exist
     today, which are populated, and which are vestigial.
  2. Every production reader and writer of each candidate column, across packages/
     and apps/. Include "none" as an answer where true — a column with no reader is
     a different problem from a column read in three places.
  3. What the Zalo provider contract actually requires: is the stored value a
     long-lived secret, a refreshable token, or a webhook verification token? The
     answer changes whether rotation is even meaningful. Cite the doc you read.
  4. What protection already exists: grants on the table, RLS, whether the value is
     encrypted at rest today and by what, and what preflight.ts asserts.
  5. Whether feature_zalo_channel_tech.md or feature_connector_onboarding.md already
     pins a secret lifecycle (BL-SEC-1 is referenced from the zalo channel spec).
     A pinned contract makes this Tier A execution, not an open choice.

OUTPUT
  docs/probes/zalo-credential-path-2026-09.md — findings, each with file:line, and
  a short recommendation section offering at most three mechanisms with their
  trade-offs. Recommend one. Do NOT implement it.

SCOPE
  docs/probes/zalo-credential-path-2026-09.md (new)
  docs/autopilot-backlog.md (correct the scope line of db-zalo-bots-secret-hardening
  to name the real column, and only that line)
NEGATIVE SCOPE
  No schema change. No migration. No code. No secret rotation. No grant change.
  Choosing the mechanism is owner decision O4 and stays open at the end of this lane.

ACCEPTANCE
  - Every claim carries file:line or a migration number. Prose alone is not evidence.
  - Null results are recorded as searched-and-absent with the query shown.
  - The backlog row no longer names a column that the fixtures contradict.
```

---

## L3 · BE · Phủ nốt `runWithLang` ngoài đường session-command (DD-118)

**Vì sao:** DD-118 chốt `tenants.locale` là **nguồn ngôn ngữ duy nhất** của mọi surface đã đăng nhập, đọc qua
`tenant_locale()` fail-closed `'vi'`. Nhưng độ phủ hiện tại là **một đường duy nhất** —
`apps/web/lib/session-command-route.ts:235`. ROADMAP khai thẳng "phủ chưa đủ và không được khai là xong".

**Điểm dễ sai:** response phát **trước khi** tenant được biết-và-xác-thực giữ tiếng Việt — đó là **hành vi đã
phê chuẩn**, không phải lỗ hổng cần vá. Lane này mở rộng phủ ở đúng chỗ tenant đã biết, không ở chỗ chưa biết.

**Tier C:** 0 (DD-118 đã name rule ⇒ thi hành là Tier A) · **Rủi ro:** P2 · **Đợi L1** (cùng chạm `apps/web/lib/`)

```text
TASK: dd118-runwithlang-coverage
RISK: P2
DEPENDS_ON: session-routes-close-cancel (landed) — shared file apps/web/lib/

OUTCOME
  Every authenticated response surface resolves language through tenants.locale via
  tenant_locale(), not through any second source, and the surfaces that legitimately
  cannot are enumerated rather than left ambiguous.

READ FIRST
  decisions.md DD-118 in full (this is the one DD body worth loading for this lane)
  packages/core/src/i18n.ts — parseLang / resolveLang / runWithLang / t
  apps/web/lib/session-command-route.ts:235 — the only current call site

METHOD
  1. Enumerate every response-producing surface in apps/web: each route.ts, plus any
     shared responder in apps/web/lib. For each, classify into exactly one bucket:
       (a) tenant known and authenticated at response time  -> must runWithLang
       (b) pre-authentication or tenant-unknown              -> stays Vietnamese, by
           DD-118, and is APPROVED BEHAVIOUR, not a gap
       (c) not a user-facing response (healthz, machine JSON) -> out of scope
     Write the classification into the lane's DECISIONS.md before changing anything.
     A surface you cannot classify is an AWAIT, not a guess.
  2. Wire bucket (a) only. Reuse the existing resolveLang/runWithLang path; do not
     invent a second language-resolution helper — a second source is exactly what
     DD-118 forbids.
  3. i18n strings are literal pairs t("vi", "en"). There is no key-based i18n in this
     repo and no locale files. A t('some.key') call does not resolve and must not
     appear.

SCOPE
  apps/web/lib/* and apps/web/app/api/**/route.ts for bucket (a) surfaces only,
  plus their tests.
NEGATIVE SCOPE
  No new column. Do NOT add persons.language — the user-settings spec drift on that
  point was already reconciled (6524857); the column does not exist and this lane
  does not create it. No change to tenant_locale() or migration 0035. No FE.

ACCEPTANCE
  - The bucket classification is in the ledger, complete, with every surface listed.
  - A test proves an (a) surface returns English under an en tenant and Vietnamese
    under a vi tenant.
  - A test proves a (b) surface stays Vietnamese, asserted as intended behaviour
    with DD-118 cited, so a future reader does not "fix" it.
```

---

## L4 · infra · Hai gate chặn đúng nhưng không nói được vì sao

Backlog `gates-that-fire-correctly-and-cannot-say-why`, status `planned`, scope đã rõ. **Cả hai gate hành xử
đúng** — chi phí nằm ở chỗ chúng không nói được lý do, khiến người đọc phải suy lại từ đầu cả nguyên nhân lẫn
cách chữa. Đây là loại việc infra rẻ mà trả lãi mỗi lần có người mới chạm repo.

**Tier C:** 0 · **Rủi ro:** P2 · **Chạy song song được với:** L1, L3 (khác cây file)

```text
TASK: gates-that-fire-correctly-and-cannot-say-why
RISK: P2
OUTCOME
  Both gates keep their exact current behaviour and gain a diagnosable failure.
  This lane must not change WHEN either gate fires — only what it says when it does.

TWO TARGETS, from the backlog row
  1. packages/db/src/migrate.ts — invariant guard P17. Editing an already-applied
     migration throws correctly, but through a code path that does not set .cause,
     so the surfacing symptom is an unrelated-looking assertion failure. Give it a
     cause and a message naming the migration file and what to do about it.
  2. scripts/autopilot-scope-gate — same class of defect. Read the row for its exact
     claim, then verify that claim against the current script before acting; the kit
     has moved to KIT_VERSION 33 and a row written earlier may describe a version
     that no longer exists.

METHOD
  Prove the current behaviour with a test BEFORE touching the code, so the diff shows
  behaviour held constant while diagnosability improved. A behaviour change here is
  out of scope and is the one thing that would make this lane dangerous.

SCOPE
  packages/db/src/migrate.ts, scripts/autopilot-scope-gate, and their tests.
NEGATIVE SCOPE
  No change to when a gate fires, to migration content, or to the scope-gate
  contract. No kit sync — the mirror question is a separate lane.
ACCEPTANCE
  - A test per gate asserting the firing condition is unchanged.
  - A test per gate asserting the new message/cause is present and names the
    offending artifact.
```

---

## L5 · infra · Đường đúng đang khó hơn đường bị cấm

Backlog `local-dev-sanctioned-paths-are-harder-than-the-forbidden-one`, `planned`. Luận điểm của row đáng
giữ nguyên: **luật cấm đang gánh phần việc mà công cụ phải làm, và nó hỏng vào đúng lúc người ta mệt và đang
bị chặn.** Không có `db:reset:test` nên phải gõ tay `DROP DATABASE ... WITH (FORCE)` mỗi vòng sửa migration.

**Tier C:** 0 · **Rủi ro:** P3

```text
TASK: local-dev-sanctioned-paths
RISK: P3
OUTCOME
  The correct local-dev path is the cheapest one to take, so the forbidden shortcut
  stops being tempting under pressure.

METHOD
  Read the backlog row for its three measured frictions. For each, verify the
  friction still exists at HEAD before building anything for it — one of them may
  already have been closed by a later lane, and building a script for a solved
  problem is worse than leaving the row open.
  Then add the missing scripts to package.json, and document each in
  docs/standards/environments-setup.md next to the rule it makes cheap to follow.
  A script that destroys data must name the database it will destroy and refuse to
  run against anything whose name does not end in _test. Fail closed.

SCOPE
  package.json, docs/standards/environments-setup.md, plus any new script file
  under scripts/ that the work requires.
NEGATIVE SCOPE
  No change to migration content, to the test harness, or to CI. No touching the
  egress evidence table in that same setup document — it is blocked on owner-only
  evidence and its HALT-EVIDENCE_INCOMPLETE marker is correct fail-closed state,
  not an unfinished section.
ACCEPTANCE
  - Each friction is re-verified at HEAD, with the verification shown, before it is
    addressed.
  - The destructive script refuses a non-_test database name, proven by a test.
```

---

## L6 · BE · Zalo tenant routing — lane AUTHORING, chưa phải lane code

**Đây là khe hở BE lớn nhất còn lại** và là **khối 2 của launch** (link club ⇄ Zalo bot). Thiếu nó thì PWA và
bot là hai sản phẩm rời chứ không phải một sản phẩm hai mặt.

**Nhưng đừng mở nó bằng một prompt code.** Spec `feature_tenant_routing_authz_tech.md` v2.8 là `Reviewed`
nhưng `Implementation: Not started`, canonical phase P2, và nó tham chiếu **DD-56 · DD-65..68 · DD-27 · DD-51
· DD-53**. Số Tier C thật của lane này **chưa ai đếm** — mà theo §6.1 chính con số đó, không phải số dòng,
mới dự đoán được lane có chạy tới READY hay không. Lane này đếm nó.

**Tier C:** chưa biết — đó là output của lane · **Rủi ro:** P1 khi thành lane code

```text
TASK: zalo-tenant-routing-authoring
RISK: P2 (authoring only; the implementation lane it produces will be P1)
MODE: authoring. Produce a packet or an AWAIT. Write no implementation code.

OUTCOME
  Either a code-ready packet for Zalo tenant routing with an exact mechanism, file
  scope, negative scope, acceptance rows and dependency proof — or a HALT_RESLICE
  showing the task contains more than one mechanism — or a single AWAIT_OWNER with
  one recommendation and a binary trigger.
  The most valuable single output is the Tier C COUNT with each item named. Per
  level3-workflow section 6.1, that number predicts whether the implementation lane
  reaches READY untouched. Report it even if everything else ends AWAIT.

READ, and record what each one settles
  docs/features/BE/feature_tenant_routing_authz_tech.md    (Reviewed, v2.8)
  docs/features/FE/feature_tenant_routing_authz.md         (its Product pair)
  docs/features/BE/feature_zalo_channel_tech.md            (Reviewed, v2.8, P4.7)
  decisions.md bodies for DD-56, DD-65, DD-66, DD-67, DD-68, and DD-15
  packages/db/schema.ts zaloBots table (~line 1231) and every migration touching it
  apps/bot/src/* — what the bot app actually is today: dispatcher, queue, preflight,
  worker, schedule. Establish whether an inbound webhook path exists at all.
  docs/autopilot-templates/ap23-inbound-webhook-RUN.md — prior art for this surface

QUESTIONS THE PACKET MUST ANSWER, or name as Tier C
  1. Where does an inbound Zalo webhook land today — is there a route, or none?
  2. How is tenant resolved from an inbound message, and what happens when it cannot
     be resolved? The answer must be fail-closed and must not be invented here if a
     spec already pins it.
  3. What is the trust boundary: what does the webhook verify before any tenant
     context is set, and what does preflight.ts already assert about roles?
  4. Which parts of DD-65..68's Messenger contract are shared substrate versus
     Messenger-specific? Building Zalo on a Messenger-shaped abstraction that has
     never had a second implementation is a known way to get the abstraction wrong.
  5. Does this lane need a migration? If yes it is Tier C item 4 and the packet
     stops there with a recommendation.
  6. Does anything here touch a money or PII contract? DD-114 D2 clause 5 puts the
     whole money branch of group 6 in Tier C with no lane deciding on its own.
     Routing itself should not — prove that, do not assume it.

NEGATIVE SCOPE FOR THE PACKET IT PRODUCES
  No player-facing Zalo flows (P4.7 — a later phase). No chat. No discovery. No
  auto-reconcile. No secret-mechanism choice — that is owner decision O4, fed by the
  L2 trace lane. Scope is exactly: an inbound message reaches the right tenant, or is
  refused fail-closed.

ACCEPTANCE
  - Tier C items counted and each one named, with why it is Tier C.
  - Every claim about current code carries file:line; "not started" is proven by a
    search whose query is written down, not asserted.
  - The packet, if produced, passes node scripts/check-review-readiness.mjs --changed
    and carries a strict verdict block. An "enforce" verdict does not authorize code.
```

---

## Thứ tự đề xuất và lý do

| Đợt | Lane | Vì sao ở đây |
|---|---|---|
| 1 | **L0** + **L2** song song | L0 cần máy owner có Postgres, L2 read-only — không cái nào chặn cái nào, và L0 gỡ nhãn `STALE` đang làm mọi verdict số bị treo |
| 2 | **L1** | Lane code Tier C = 0 duy nhất chạy được ngay; ba chặn cơ học đã pin sẵn ở trên nên nó không mất vòng khám phá |
| 3 | **L4** hoặc **L5** song song với L1 | Khác cây file hoàn toàn; đều là infra rẻ, trả lãi mỗi phiên sau |
| 4 | **L3** | Phải đợi L1 vì cùng chạm `apps/web/lib/` |
| 5 | **L6** | Authoring; output của nó quyết định lane code lớn kế tiếp có chạy tự động được không |

**Không nằm trong danh sách này, và cố ý:** billing P5 / enforcement `payment_reconcile_auto`. DD-114 D2
clause 5 ghi rõ **mọi slice trong vế tiền của nhóm 6 là Tier C, không lane nào tự quyết** — nó không phải
lane `autonomous_to_ready`, và nó còn đòi cả subscription + lifecycle chưa tồn tại. Đó là một epic có owner
trong vòng, không phải một lane tiếp theo.

> **Một điều nên nói thẳng khi bạn đọc bảng này:** cả sáu lane trên đều là việc thật và đều nên làm — nhưng
> không lane nào trong số đó làm thanh **~33%** nhúc nhích, vì luật 5 đo trục yếu nhất và trục đó là **0 màn
> FE**. Ưu tiên BE/infra trước là đúng khi FE còn PENDING; chỉ cần đừng nhầm việc rút ngắn hàng đợi BE với
> việc tiến gần launch. Hai thứ đó đã tách nhau từ 26/08, ngày route nghiệp vụ đầu tiên land.
