# BE + infra lanes — prompt sẵn dùng, xếp theo mật độ Tier C

**Ngày:** 02/09/2026 · **Base:** `main@7675e03` · **Chương trình:** `completion-program-2026-09-02-RUN.md`
**Ưu tiên đang áp (owner 25/08, tái xác nhận 02/09):** **BE + infra trước, FE sau.**

## §00 · ĐÍNH CHÍNH BẮT BUỘC — hợp đồng manifest, thêm 02/09 sau HALT của L12

**Hai trường trong mọi prompt của doc này từng sai, và cả hai làm `register` HALT `CONTRACT_INVALID`
trước khi lane viết được dòng nào.** Đo tại `scripts/autopilot-review-readiness.mjs`:

```
:363  if (!["P1","P2"].includes(risk))            halt CONTRACT_INVALID "only P1/P2 writing slices may register"
:366  if (!["supervised","proactive_routine"].includes(autonomyMode)
        || (risk === "P1" && autonomyMode !== "supervised"))  halt CONTRACT_INVALID
```

1. **`autonomous_to_ready` chưa bao giờ được validator chấp nhận.** DD-107 chốt mode này (owner
   14/08), `level3-workflow.md` §6.1 mô tả nó dài 205 dòng, và **không dòng code nào implement nó**.
   Đây không phải lệch canonical — đây là **khoảng cách decision→code nằm ngay trong consumer**, đúng
   lớp lỗi mà DD-106 tồn tại để bắt. ⇒ Trường `autonomy_mode` trong manifest phải ghi **`supervised`**.
   Ý định của DD-107 (quyết Tier A/B tại chỗ, giữ ledger, owner review một lượt ở READY) **vẫn áp dụng**
   — nó chỉ chưa gọi tên được bằng trường đó.
2. **Validator từ chối `P3` hoàn toàn.** Năm lane trong doc này từng ghi `RISK: P3` (L0 · L2 · L5 · L8 ·
   L16) — **cả năm đều ghi file**, nên cả năm là writing slice và phải là **P2**. Đã sửa.
3. **Còn một mâu thuẫn chưa sửa, để lại nguyên:** §6.1 viết *"`autonomous_to_ready` requires risk `P1`
   or `P2`"* trong khi `:366` ép `P1 ⇒ supervised`. Doc và validator nói ngược nhau về P1. Không lane
   nào trong hàng đợi này là P1 nên nó chưa cắn, nhưng nó là **hai edit chứ không phải một** khi ai đó
   dạy validator mode mới.

⚠️ `autopilot-review-readiness.mjs` **là pack file** (chính là file mang hunk `DYNAMIC_SEGMENT`). Sửa nó
trong consumer là tạo divergence mới — xem L11-v2.

### §00b · Hai đính chính đo được 03/09, sau ba lần HALT của họ kit-pack

**(1) `--audit` KHÔNG chạy trong CI. Tiền đề của phán quyết "Option A" trước đó SAI.** Đo trên nhánh
`feat/kit-pack-membership-doc`:

```
package.json  "kit:check": "node scripts/check-kit-pack-membership.mjs --audit"   <- không ai gọi
package.json  "test:review-readiness": node --test … check-kit-pack-membership.test.mjs  <- chạy TEST FILE
ci.yml:88     run: pnpm -w test   ->  test:review-readiness  ->  test file, KHÔNG phải --audit
```

CI **kiểm logic của checker**; CI **không audit repo**. Hai thứ khác nhau, và câu "enforcement of record
là `--audit` trong CI" mà anh viết đã gộp nhầm chúng. Hệ quả: nếu ship nguyên trạng, ta có một doc cộng
một checker mà **không gì chạy nó lên repo** — đúng cách một tài liệu tra cứu chết dần, cộng thêm một
lớp tưởng-là-có-cưỡng-chế. **Sửa rẻ: một dòng.** `kit:check` phải nằm trong chuỗi mà `pnpm -w test` gọi,
hoặc thành một step riêng trong `ci.yml`. **Đưa vào scope S1, không phải backlog row.**

**(2) Cấm parse Markdown làm authority.** S1 HALT REGION_THRASH sau ba vòng đóng lần lượt các biên
Markdown mịn dần (không ranh giới → có ranh giới nhưng không biết fence → luật đóng fence sai ở info
string). Tập biên còn lại bị chặn bởi **độ phức tạp của CommonMark**, không bởi độ cẩn thận của bản vá
kế: HTML block, link reference definition, setext heading, lazy continuation, tab-làm-indent. Không vòng
nào chứng minh được danh sách đó rỗng. ⇒ Authority là **JSON**; Markdown là **output sinh ra**, và bước
kiểm là **sinh lại rồi diff byte**, không phải parse rồi so tập. Bảng `.md` được **đối chiếu** thay vì
**sinh ra** là mang nguyên lớp lỗi đó quay lại, chỉ nhỏ hơn.

---

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
  DEFAULT_STOP_MODE: STOP_AT_READY · AUTO_MERGE: off
  AUTONOMY_MODE in the MANIFEST must be "supervised". Do not use "proactive_routine"
  even though the validator still accepts it today: DD-100 D4 deletes it outright
  (measured zero consumers -- 16/16 manifests declare supervised -- and zero writers),
  and its removal is part of lane L11-v2. It must NOT be
  "autonomous_to_ready": scripts/autopilot-review-readiness.mjs:366 accepts only
  ["supervised","proactive_routine"], so a manifest declaring the ratified mode HALTs
  CONTRACT_INVALID at register. See section 00. The batch-the-owner INTENT of
  DD-107 still governs how you work — decide Tier A/B in flight, keep the ledger,
  bring the owner one review at READY — it just cannot be spelled in that field yet.
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

  IF THIS LANE BUILDS OR CHANGES A CHECK, STATE ITS THREAT MODEL FIRST
    Write, in the deliverable itself, one paragraph naming what the check defends
    against AND what it explicitly does not. Then hold that line under review.
    Learned mechanically: lane kit-pack-membership-manifest HALTed REGION_THRASH
    after three rounds circling one line, because its brief never said who the
    adversary was. The reviewer had no scope to read (the known gate gap: a reviewer
    is not given scope), so it reasoned toward a deliberate attacker and found a new
    evasion every round -- correctly, given what it knew. Against a determined
    insider the evasions are unbounded: an opt-in hook, a documented --no-verify,
    and a checker whose own table is editable in the same commit.
    A check that catches MISTAKES is a complete and worthy deliverable. Say so, in
    writing, and refuse to defend a boundary the lane never claimed. If a reviewer
    files a tampering finding against a stated mistakes-only boundary, that is a
    contested finding -- Tier C item 8 -- not a fix round.

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
RISK: P2   # was P3; see section 00 — the validator refuses P3 registration outright
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
RISK: P2   # was P3; see section 00 — the validator refuses P3 registration outright
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

## L4a · infra · Gate chặn đúng nhưng không nói được vì sao — **chỉ phần `migrate.ts`**

Backlog `gates-that-fire-correctly-and-cannot-say-why`, status `planned`, scope đã rõ. **Cả hai gate hành xử
đúng** — chi phí nằm ở chỗ chúng không nói được lý do, khiến người đọc phải suy lại từ đầu cả nguyên nhân lẫn
cách chữa. Đây là loại việc infra rẻ mà trả lãi mỗi lần có người mới chạm repo.

> ⚠️ **Đã tách ở đợt 3 (§0).** Chỉ chạy phần `packages/db/src/migrate.ts`. Phần `scripts/autopilot-scope-gate`
> **hoãn tới sau L12** — file đó mang `KIT_VERSION: 33`, sửa ở consumer thì lần sync kế ghi đè.

**Tier C:** 0 · **Rủi ro:** P2 · **Chạy song song được với:** L1, L3 (khác cây file)

```text
TASK: gates-that-fire-correctly-and-cannot-say-why  --  SPLIT, see section 0
RISK: P2
SPLIT NOTICE (added 2026-09-02, batch 3)
  Run TARGET 1 (packages/db/src/migrate.ts) ONLY. This is lane L4a.
  TARGET 2 (scripts/autopilot-scope-gate) is SUSPENDED pending lane L12: that file
  carries KIT_VERSION: 33 and is probably a kit-pack file, so editing it in this
  consumer would be overwritten by the next successful kit sync. L12 establishes
  pack membership from canonical's pack_pairs; only then does target 2 get a repo.
  Do not "just do both while I am here". That is the exact mistake this notice fixes.
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

SCOPE (L4a as split above)
  packages/db/src/migrate.ts and its tests.
NEGATIVE SCOPE
  scripts/autopilot-scope-gate is OUT OF SCOPE until L12 lands — see the split
  notice. No change to when a gate fires, to migration content, or to the
  scope-gate contract. No kit sync — the mirror question is a separate lane.
ACCEPTANCE (L4a)
  - A test asserting migrate.ts's P17 firing condition is unchanged.
  - A test asserting the new message/cause is present and names the offending
    migration file.
```

---

## L5 · infra · Đường đúng đang khó hơn đường bị cấm

Backlog `local-dev-sanctioned-paths-are-harder-than-the-forbidden-one`, `planned`. Luận điểm của row đáng
giữ nguyên: **luật cấm đang gánh phần việc mà công cụ phải làm, và nó hỏng vào đúng lúc người ta mệt và đang
bị chặn.** Không có `db:reset:test` nên phải gõ tay `DROP DATABASE ... WITH (FORCE)` mỗi vòng sửa migration.

**Tier C:** 0 · **Rủi ro:** P3

```text
TASK: local-dev-sanctioned-paths
RISK: P2   # was P3; see section 00 — the validator refuses P3 registration outright
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

---
---

# Đợt 2 — L7…L11 (thêm 02/09, sau khi `b18efde` đã push)

`origin/main` = `b18efde`. Năm lane dưới đây phủ nốt phần BE/infra mà L0–L6 chưa chạm. Cùng khuôn: dán
**Bối cảnh chung** ở đầu file trước, rồi dán khối lane.

**Hai lane trong đợt này cố ý KHÔNG phải lane code** (L9, L10). Lý do ghi tại chỗ — đọc trước khi đổi ý.

---

## L7 · BE/test-infra · `acquireChatDefinerLock` rò client khi lỗi

**Đã đo lại tại `b18efde`, defect còn nguyên** — `packages/db/src/test-harness.ts:293-313`:

```
const lockClient = new pg.Client({ connectionString: base });
guardClientErrors(lockClient, () => tearingDown);
await lockClient.connect();                                    // <- có thể reject
await lockClient.query("SELECT pg_advisory_lock($1)", [...]);   // <- có thể reject
```

Chỉ `release()` mới gọi `lockClient.end()`. **Không có `try/catch` nào bọc connect→return**, nên nếu
`connect()` hoặc câu `pg_advisory_lock` reject (cancellation, DB bận, connection cạn), client không bao giờ
được đóng và caller không bao giờ nhận được `release` để đóng nó. Rò một connection **mỗi lần lỗi**, trong
đúng cái path mà nhiều test file chạy song song cùng gọi.

**Tier C:** 0 · **Rủi ro:** P2 · **Chạy song song được với:** mọi lane (một file, không ai khác chạm)

```text
TASK: test-harness-chat-definer-lock-client-leak
RISK: P2
OUTCOME
  acquireChatDefinerLock never leaks a pg.Client when it fails before returning.

THE DEFECT, verified at b18efde — confirm it yourself, then fix
  packages/db/src/test-harness.ts, acquireChatDefinerLock at line ~293.
  new pg.Client -> connect() -> query('SELECT pg_advisory_lock($1)') runs with no
  try/catch spanning connect through return. Only the returned release() calls
  lockClient.end(). A rejection from connect() or from the advisory-lock query
  therefore leaves a connected client with no owner and no way for the caller to
  close it, because the caller never received release().

FIX SHAPE
  Wrap connect-through-lock so that any rejection ends the client before the error
  propagates, then rethrow the ORIGINAL error unchanged. Two details that decide
  whether this fix is correct or merely plausible:
    - If connect() itself rejected, end() may reject too. Swallow the cleanup
      failure, never the original error. The existing release() already models this
      with .catch(() => {}) on the unlock — follow that precedent rather than
      inventing a second cleanup style.
    - tearingDown gates guardClientErrors. Set it before cleanup on the failure path
      too, or the guard will surface the teardown as an unhandled client error and
      turn a clean failure into a noisy one.

SCOPE
  packages/db/src/test-harness.ts and its test file.
NEGATIVE SCOPE
  No change to the lock key, to who calls this helper, to guardClientErrors' own
  contract, or to any other helper in this file. Do not "while I am here" the
  neighbouring job_definer helpers — they are a different hazard class with their
  own documented reasoning right below this function.

ACCEPTANCE
  - A test where connect() rejects proves no client remains open and the original
    error reaches the caller unwrapped.
  - A test where the advisory-lock query rejects proves the same.
  - The happy path is unchanged: release() still unlocks then ends, and a second
    release() is still a no-op.
  - Full db suite green under fileParallelism, which is the condition that made this
    leak matter in the first place.
```

---

## L8 · infra/dev · Suite đổi mật khẩu `app_worker` và không trả lại

**Đo tại `b18efde` — ba call site, đều trong `apps/bot`:**

```
apps/bot/src/schedule.test.ts:72     ALTER ROLE app_worker WITH LOGIN PASSWORD '...'
apps/bot/src/dispatcher.test.ts:63   ALTER ROLE app_worker WITH LOGIN PASSWORD '...'
apps/bot/src/preflight.test.ts:80    ALTER ROLE app_worker WITH LOGIN PASSWORD '...'
```

`app_worker` là role **cluster-global**. Ba file này đổi mật khẩu của nó khi chạy và **không file nào khôi
phục**. Trước khi có `worker.ts` chạy preflight fail-closed thì không ai để ý, vì không có gì local dùng
`app_worker`; từ `fca314e` thì có. Đây là **defect môi trường dev có sẵn trước slice 2b** — slice 2b chỉ làm
nó lộ ra.

**Tier C:** 0 · **Rủi ro:** P3 · **Ghép tự nhiên với L5** (cùng lớp ma sát local-dev), nhưng **khác cây file** nên chạy riêng được

```text
TASK: dev-app-worker-password-not-restored
RISK: P2   # was P3; see section 00 — the validator refuses P3 registration outright
OUTCOME
  Running the test suite leaves the cluster's app_worker credential exactly as it
  found it, so a later local run of worker.ts does not fail preflight for a reason
  the developer did not cause.

MEASURED STARTING POINT — verify, do not re-derive
  grep -rn "ALTER ROLE app_worker" apps packages --include=*.ts
  Expect three hits: apps/bot/src/{schedule,dispatcher,preflight}.test.ts.
  app_worker is cluster-global: it is not namespaced per test database, so this is
  shared mutable state across every parallel test file and every other project on
  the same cluster.

DESIGN CONSTRAINTS, in priority order
  1. Restoration must survive a failing test. An afterAll that only runs on success
     restores nothing on exactly the runs that matter most. Use the framework's
     guaranteed-teardown path and prove it with a deliberately failing case.
  2. Restoration must survive parallel files. Three files mutating one cluster role
     concurrently is the actual hazard; a per-file save/restore can restore a value
     another file has since changed. Decide explicitly between serialising these
     files against each other and giving each a distinct role, and record the choice
     with its trade-off in the ledger. Do not pick silently.
  3. Do not weaken what the tests prove. These files exist to exercise preflight's
     fail-closed credential assertions; a fix that stops them exercising a real
     credential has removed the coverage rather than the leak.

SCOPE
  apps/bot/src/schedule.test.ts, apps/bot/src/dispatcher.test.ts,
  apps/bot/src/preflight.test.ts, plus any shared test helper the fix introduces,
  plus a note in docs/standards/environments-setup.md if a developer needs to know
  how to recover a cluster already left in the mutated state.
NEGATIVE SCOPE
  No change to preflight.ts itself, to worker.ts, to grants, or to any migration.
  Do not change what app_worker is allowed to do — that is a different lane (L10)
  and it is deliberately not a code lane.

ACCEPTANCE
  - A test that fails mid-way still leaves the password restored, proven.
  - The full apps/bot suite green with the files running in their normal parallel
    configuration, not serialised specially for the proof.
  - The chosen approach to point 2 is in the ledger with the alternative named.
```

---

## L9 · BE/infra · Job runtime — lane AUTHORING cho **cả bốn** hàng backlog cùng lúc

**Vì sao gộp bốn hàng và vì sao không code ngay.** Bốn hàng backlog dưới đây được mở ở bốn thời điểm khác
nhau nhưng là **một đồ thị phụ thuộc**, và hàng thứ hai tự nó đã ghi *"chưa scope; nhiều slice nhỏ chứ không
phải một"*:

| Hàng | Điều đã đo được |
|---|---|
| `job-scheduler-cron-registration` | **Không có cron ở bất kỳ đâu**: không `boss.schedule()`, không `pg_cron` (`0000` chỉ có `pgcrypto`), không `setInterval` — chỉ 2 comment aspirational (`worker.ts:6`, `infra/entrypoint.sh:23`) |
| `job-consumers-per-feature` | Nhiều job đang chờ đúng khối hạ tầng trên: session draft auto-expiry · billing Daily Lifecycle Job · `ExpireJoinRequests` hourly · … |
| `db-projector-dlq-no-replay-path` | `0022:264` khai `dlq` là **terminal**; grep toàn repo **không ra** function/route/script nào đưa hàng từ `dlq` trở lại. Và nó **chết cả hai đầu**: `ack_outbox_event` gọi sau bước prepare, **độc lập với kết quả delivery** |
| `job-outbox-dispatch-sync-lag-slo` | `TDD.md:82` NFR-1c đòi sync-lag **p95 ≤ 3s, p99 ≤ 10s**; cron của pg-boss có **sàn một phút** ⇒ p95 rơi thẳng qua ngưỡng |

Hàng cuối là chỗ phải dừng lại mà nghĩ: **một cơ chế có sàn 60s không thể đáp ứng một NFR đòi p95 3s.** Đó
không phải bug cần sửa trong lane — đó là hai contract mâu thuẫn, và chọn bên nào là **Tier C**.

**Tier C:** ≥1 đã biết trước (NFR vs cơ chế) — đó là lý do lane này authoring · **Rủi ro:** P2 authoring

```text
TASK: job-runtime-authoring
RISK: P2 (authoring; the lanes it produces will be P1)
MODE: authoring. Produce a dependency graph, packets, and a Tier C count. Write no
      runtime code and no migration.

OUTCOME
  One dependency graph covering job-scheduler-cron-registration,
  job-consumers-per-feature, db-projector-dlq-no-replay-path and
  job-outbox-dispatch-sync-lag-slo, plus a code-ready packet for whichever root in
  that graph has zero Tier C items. If no root is Tier-C-free, say so plainly and
  produce the AWAIT list instead of a packet.

READ AND RECORD WHAT EACH SETTLES
  packages/db/migrations/0022_*.sql and 0023_*.sql, in full. 0022:264 defines the
  status enum with dlq terminal; 0023:176-208 is the ordering discussion.
  apps/bot/src/{worker,dispatcher,queue,queues,preflight,provision-queue}.ts
  docs/product/TDD.md around line 82 (NFR-1c) and line 494
  docs/features/BE/feature_sync_engine* around line 129
  decisions.md bodies for DD-89 and DD-90 (worker access, per-event job audit)
  The four backlog rows named above, for their measured claims — then verify each
  claim at HEAD before building on it. At least one of them was written weeks ago.

THE FOUR QUESTIONS THE GRAPH MUST ANSWER
  1. Ordering. The outbox does NOT guarantee per-aggregate ordering (0023:176-208).
     Every consumer must therefore be order-independent with a monotonic guard.
     State how each pending consumer satisfies that, or that it cannot.
  2. dlq is terminal and nothing replays it, AND ack_outbox_event runs after prepare
     independent of delivery outcome. Establish whether these are one defect or two,
     because the fix shape differs: a replay path is additive, while re-sequencing
     ack against delivery changes an existing durability contract and is Tier C
     item 4 if it needs a migration.
  3. NFR-1c demands sync-lag p95 <= 3s while pg-boss cron floors at 60s. These
     cannot both hold. Name the options — a different trigger mechanism, a revised
     NFR, or a scoped exemption for this path — recommend one, and mark it Tier C.
     Do NOT quietly pick one and build on it. Do NOT restate the conflict as a
     "performance concern": it is a contract conflict and it has an owner.
  4. Scheduler registration must carry the privileged-call audit envelope
     (job_id, tenant_id, actor=system, reason) that TDD:494 and deployment-infra:186
     require. Confirm whether any existing code already emits that envelope.

HARD BOUNDARY
  Turning the schedule on is NOT in scope for this lane or any lane it produces.
  OUTBOX_DISPATCH_SCHEDULE_ENABLED stays false. It is owner decision O3, and the
  announce route depends on the same gate: enabling the schedule is what converts
  {announced:true} into a promise to real users.

OUTPUT
  docs/autopilot-manifests/ packet(s) for any Tier-C-free root, plus a short graph
  document under docs/plexco-run/ naming every edge and every Tier C item with its
  reason. The Tier C COUNT is the headline output; report it even if nothing else
  reaches packet stage.
NEGATIVE SCOPE
  No runtime code. No migration. No enablement. No projector work — the public read
  model is an epic with four named prerequisites and is out of this program.
```

---

## L10 · infra/security · `app_worker` least-privilege — **ratify threat model, KHÔNG hardening thêm**

**Đọc kỹ đoạn này trước khi mở lane.** Hàng `db-app-worker-least-privilege-attestation` được mở bởi một
**`MAX_ROUNDS` HALT** (slice 2b, 27/07): vòng 1–6 mọc dần một allowlist ACL trong `preflight.ts` để chứng
minh `app_worker` có **đúng** tập quyền dự định — role attributes, CREATE grant, membership `job_definer`,
`session_user`, ownership, denylist TRUNCATE/REFERENCES/TRIGGER, `rolreplication`, ownership của
sequence/function — và **codex tìm được một cạnh mới ở mỗi vòng**.

Đó chính xác là hình dạng mà luật vận hành số 6 của repo mô tả: **security finding trở thành edge-family
không giới hạn ⇒ owner phê chuẩn threat model để bound cái class, KHÔNG thêm vòng hardening.** Mở lane này
như một lane code là lặp lại đúng vòng lặp đã HALT một lần rồi.

**Vì vậy đây là lane sinh packet cho owner.** Output là một threat model có biên, không phải thêm assertion.

**Tier C:** cả lane là input cho một quyết định Tier C · **Rủi ro:** P2 authoring

```text
TASK: app-worker-threat-model-ratification
RISK: P2
MODE: authoring. Produce an owner decision packet. Add no assertion to preflight.ts.

WHY THIS IS NOT A HARDENING LANE
  This task was opened BY a MAX_ROUNDS HALT. Rounds 1-6 grew an ACL allowlist in
  preflight.ts and the reviewer found a new edge every round: attributes, CREATE
  grant, job_definer membership, session_user, ownership, a TRUNCATE/REFERENCES/
  TRIGGER denylist, rolreplication, sequence and function ownership. The failure was
  not insufficient effort. It was an unbounded edge family with no stated boundary,
  so no round could ever be the last one.
  The repository's own operating rule for this shape: when a security finding becomes
  an unbounded edge family, the owner ratifies a threat model that BOUNDS the class.
  Adding a seventh assertion is the known-wrong move.

OUTCOME
  A short owner-decision packet that answers: what is app_worker trusted NOT to do,
  and what is the closed list of properties preflight asserts to prove it?
  Once the owner ratifies that list, any property outside it is out of scope by
  decision, and preflight becomes finishable.

METHOD
  1. Inventory what preflight.ts asserts TODAY, exactly, one line per assertion,
     each with the round or commit that added it and the finding it answered.
  2. Inventory what app_worker actually HOLDS today, measured from pg_catalog on a
     migrated database, not from schema.ts and not from prose. If you cannot reach a
     database, say so and mark the inventory unmeasured rather than inferring it.
  3. State the threat: which actor, with which access, is this attestation defending
     against? An attestation with no named adversary cannot be bounded, which is the
     root cause of the six rounds.
  4. Propose the CLOSED property list, with each property justified by the threat in
     step 3, and each currently-asserted property either kept with a reason or
     dropped with a reason. A property nobody can tie to the threat is a candidate
     for dropping — say so; the packet is allowed to make preflight smaller.
  5. State the self-invalidation trigger: what future change reopens this decision.

OUTPUT
  docs/decisions/ or docs/probes/ packet, owner-facing, Vietnamese prose (this one is
  read by the owner to decide, not by an agent to execute), with the closed list as
  a table.
SCOPE
  The new packet document only. Optionally one backlog-row correction.
NEGATIVE SCOPE
  Zero change to preflight.ts, to grants, to roles, to migrations. If while reading
  you find a REAL privilege escalation — not a missing attestation, an actual
  reachable escalation — that is a separate P0 finding: report it immediately and do
  not fold it into this packet.
```

---

## L11-v2 · infra/kit · Dạy kit cái mode mà owner đã chốt — **thay thế L11 cũ**

> 🔴 **L11 CŨ ĐÃ CHẾT — ĐỪNG CHẠY.** Lane L12 đo được: **nợ `DYNAMIC_SEGMENT` đã trả rồi** — canonical
> `188e756` port nó **một ngày sau** `0af75a2`, consumer và canonical **byte-identical**. Tiền đề của L11
> cũ mục hoàn toàn. Đây đúng là lý do prompt L11 mở đầu bằng "VERIFY THE PREMISE FIRST … If any
> expectation fails, STOP and report" — cơ chế đó đã làm đúng việc của nó.
>
> **Nợ pack thật, và chỉ có một:** `level3-workflow.md` — file pack **duy nhất** còn lệch, **205 dòng =
> trọn §6.1 `autonomous_to_ready`**, khái niệm canonical không có. Sync kế tiếp **xoá operating contract
> mà cả 16 lane đang trích dẫn**. Cộng với §00: validator cũng chưa từng biết mode đó. Nên lane này là
> **một việc, ba edit, land cùng nhau**.

```text
TASK: kit-teach-autonomous-to-ready  (folds DD-100 D4 -- same accept list, same file)
RISK: P2
REPOSITORY: the canonical kit repo (~/Projects/Claude template), NOT the Plexco repo.
            Never patch the kit from inside a consumer: that is the two-writers-one-
            mirror case. Kit changes happen in canonical; each consumer pulls.

WHY THIS LANE REPLACED THE OLD L11
  Lane L12 measured that the DYNAMIC_SEGMENT debt is already repaid: canonical 188e756
  ported it one day after 0af75a2, and consumer and canonical are byte-identical.
  Verify that yourself before anything else; if it is false, stop and report.
  The real divergence is level3-workflow.md: 205 lines, the whole section 6.1, present
  in the Plexco consumer and absent from canonical. The next successful sync deletes
  the operating contract that sixteen queued lanes cite.

THE THREE EDITS, and why they are one lane
  1. Port section 6.1 (autonomous_to_ready, the Tier A/B/C ladder, the authority
     precedence table, the Decision Ledger format) from the Plexco copy of
     level3-workflow.md into canonical.
  2. Teach the validator the mode. In canonical's autopilot-review-readiness.mjs the
     accept list at line ~366 is ["supervised","proactive_routine"]. A doc describing
     a mode no validator accepts is what produced L12's first CONTRACT_INVALID halt,
     and it is a decision-to-code gap of the DD-106 class: the owner ratified the mode
     on 2026-08-14 and no code ever learned it.
  3. Resolve the P1 contradiction rather than porting it. Section 6.1 says the mode
     "requires risk P1 or P2"; the validator forces P1 to supervised. Those disagree.
     Decide which is right, state the reasoning, and make doc and code say the same
     thing. Porting the doc without touching this ships the contradiction upstream to
     every consumer, which is worse than the divergence you are repaying.

  4. Execute DD-100 D4 in the same change, because it edits the SAME accept list and
     the SAME file. D4 (owner, measured) deletes `proactive_routine` outright: zero
     consumers -- 16/16 manifests declare supervised -- zero writers, and its original
     purpose (auto_merge_after_2x_codex_clean) was already rejected by Level 3. Its
     declared deletion scope includes autopilot-review-readiness.mjs:316 and
     level3-workflow.md:47,72,172,385 -- the very file this lane ports and the very
     line edit 2 rewrites. Doing them in separate lanes means writing that line twice
     and racing two edits into one region.
     After all four edits the accept list reads ["supervised","autonomous_to_ready"].

  Edit 1 without 2 ships a doc nothing enforces. Edit 2 without 1 ships an accept
  value nothing documents. Edit 4 apart from 2 is two writers on one line. They land
  together.

DO NOT
  Do not run autopilot-update.sh in any consumer. Consumer sync is a separate,
  owner-performed step. Do not fix DYNAMIC_SEGMENT — it is already fixed.
  Do not patch the consumer's validator to unblock the queue: that creates exactly
  the divergence L12 exists to surface. The queue's workaround is declaring
  supervised in manifests, which costs nothing but the field name.

ACCEPTANCE
  - The byte-identity of autopilot-review-readiness.mjs between consumer and canonical
    is re-verified and stated, before any edit.
  - Canonical suites green: test/unit.sh and test/e2e.sh, output pasted.
  - A test proving a manifest declaring autonomous_to_ready now registers, and one
    proving the P1 rule behaves as the resolved decision says.
  - The commit body states that consumers remain unsynced and syncing is the owner's
    action.
```

---

## L11-old · infra/kit · Đồng bộ mirror canonical *(GIỮ LÀM LỊCH SỬ — tiền đề đã mục, đừng chạy)*

⚠️ **Lane này KHÔNG chạy trong repo Plexco.** Nó chạy ở canonical `~/Projects/Claude template/`. Repo Plexco
là **consumer**; sửa kit từ trong consumer là đúng cái ca "hai writer chung một mirror" mà chương trình cấm.

**Hai món nợ mirror, khác nhau, đừng gộp:**

1. **`DYNAMIC_SEGMENT` + `e2e.sh`** (W0-3 của completion program). Fix validator cho Next.js dynamic segment
   `[id]` hiện **chỉ sống trong consumer** (`scripts/autopilot-review-readiness.mjs` của repo này). File đó
   nằm trong `pack_pairs` của `autopilot-update.sh`, và dòng copy là `cp "$KIT/$src" "$dst"` — **ghi đè
   thẳng, không merge**. Nghĩa là lần sync kit thành công kế tiếp **xoá fix**. Nó sống được tới giờ **chỉ vì
   đường sync đang hỏng** (`assert_canonical_suite_green` HALT `KIT_SUITE_RED` trước `copy_pack`). Sửa
   `e2e.sh` **khởi động lại đồng hồ**; mirror riêng hunk thì vô dụng vì không ai tiêu thụ được. **Hai thứ
   land cùng nhau hoặc không land.**
2. **`infra-autopilot-templates-mirror-v061`** — mirror trong repo kẹt ở v0.6.0 trong khi canonical đã
   v0.6.1, và v0.6.1 **đã xoá hẳn** pin model (`-c model="gpt-5.6-terra"`). Đây là mirror **docs**, khác
   đường với (1).

```text
TASK: kit-canonical-sync-dynamic-segment
RISK: P2
REPOSITORY: the canonical kit repo (~/Projects/Claude template), NOT the Plexco repo.
            Never patch the kit from inside a consumer: that is the two-writers-one-
            mirror case. Kit changes happen in canonical; each consumer pulls
            independently, whenever.

VERIFY THE PREMISE FIRST — it is weeks old and may have moved
  In canonical:  grep -rn DYNAMIC_SEGMENT .          # expected: zero hits
  In canonical:  sed -n '80,105p' test/e2e.sh        # the git-add list
  In canonical:  grep -n pack_pairs -A20 autopilot/parallel/autopilot-update.sh
  In Plexco:     grep -rln DYNAMIC_SEGMENT scripts/  # expected: the fix lives here
  If any expectation fails, STOP and report what is actually true. The whole plan
  below rests on these four measurements.

THE TWO HALVES, and why neither ships alone
  a) e2e.sh git-adds 13 files and omits autopilot-readiness-evidence-keys.mjs and
     autopilot-ephemeral-review-worktree.mjs, both of which are in pack_pairs and
     both imported at the top of the validator. The fixture therefore installs a
     validator that cannot load, and the assertions fail on a Node import error
     rather than a gate result. assert_canonical_suite_green runs before copy_pack,
     so no consumer has been able to sync since.
  b) The DYNAMIC_SEGMENT fix exists only in the Plexco consumer. pack_pairs copies
     with cp, which overwrites rather than merges.
  Fixing (a) alone RESTARTS the sync clock and the first successful sync DELETES the
  fix in (b). Mirroring (b) alone is inert because nothing can consume it.
  They land together or not at all.

STEPS
  1. Fix e2e.sh so the fixture installs a loadable validator: add the two omitted
     files to its git-add list. Prove the 24 previously-failing assertions now
     evaluate the gate rather than an import error.
  2. Port the DYNAMIC_SEGMENT hunk from the Plexco consumer into canonical, with its
     test cases. The consumer version came with 23 test cases and a mutation test —
     bring those, not just the hunk.
  3. Run the canonical suite: test/unit.sh and test/e2e.sh both green.
  4. Do NOT run autopilot-update.sh in any consumer as part of this lane. Consumer
     synchronisation is a separate, owner-performed step, and it is the step that
     would overwrite the consumer copy.

ACCEPTANCE
  - Both canonical suites green, output pasted.
  - A test proving a Next.js dynamic segment path like app/api/sessions/[id]/route.ts
    passes the validator in the CANONICAL tree.
  - The commit body states plainly that consumers remain unsynced and that syncing
    is the owner's next action.
```

---

## Bảng gộp — thứ tự chạy cả 11 lane

| Ưu tiên | Lane | Loại | Tier C | Chặn ai |
|---|---|---|---|---|
| 1 | **L0** re-pin runner | infra | 0 | Gỡ `STALE` cho mọi verdict số |
| 1 | **L2** zalo credential trace | infra | 0 | Feed quyết định **O4** |
| 1 | **L7** test-harness client leak | BE | 0 | — |
| 2 | **L1** route close/cancel | BE | 0 | L3 |
| 2 | **L8** app_worker password | infra | 0 | — |
| 2 | **L4** gates diagnosability | infra | 0 | — |
| 3 | **L3** DD-118 coverage | BE | 0 | *(đợi L1)* |
| 3 | **L5** local-dev paths | infra | 0 | — |
| 4 | **L9** job runtime authoring | BE/infra | ≥1 đã biết | Nhắc nợ (nhóm 6) + route announce |
| 4 | **L6** zalo routing authoring | BE | chưa đếm | Khối 2 của launch |
| 5 | **L10** app_worker threat model | security | packet cho owner | Đóng được `preflight.ts` |
| — | **L11** kit sync | infra | 0 | **Repo khác.** Chạy khi tiện; nợ này đang bị "đóng băng nhờ hỏng" |

**Sáu lane Tier C = 0** ở ưu tiên 1–3 chạy được liên tục, không cần bạn trả lời gì.

---

## Ba thứ cố ý KHÔNG có prompt, và lý do

1. **`core-matcher-ambiguous-consumer-wiring` (DD-87).** `splitNameAmount` trả tagged union, nhánh
   `ambiguous` không có top-level name/amount — fence compile-time đã land trước caller đầu tiên, và **đó là
   thứ tự đúng**. Nhưng caller đầu tiên chính là đường đối soát thanh toán, tức **vế tiền**. Viết prompt cho
   nó bây giờ đảm bảo AWAIT ngay câu đầu. Nó đi cùng epic tiền, không đứng riêng được.
2. **Billing P5 / enforce `payment_reconcile_auto`.** Lý do đã ghi ở đợt 1: DD-114 D2 clause 5.
3. **`tenant-capability-authority-core`.** Hàng backlog tự khai là *"evidence registry anchor only; this
   block does not issue a readiness verdict or authorize a worktree"* — nó là **neo bằng chứng**, không phải
   task. Packet thật của nó phải biến slice này thành **chủ sở hữu duy nhất** của closed action registry
   xuyên feature; viết prompt trước khi có packet đó là đặt cày trước trâu. Nó nên đi sau L9 (job runtime)
   và sau khi L6 đếm xong Tier C của routing, vì cả hai đều sẽ nói cho ta biết registry cần chứa gì.

> **Một quan sát nhỏ đáng ghi, không đáng thành lane:** `.autopilot/state/` có **25 thư mục** trong khi
> `.autopilot/worktrees/` **rỗng** và INFLIGHT không còn entry sống — dư lượng bình thường của các lane đã
> xong. Nhưng có một thư mục tên đúng bằng **`Plexco app`** (chứa mỗi `notify-sentinel.txt`), tức ở đâu đó
> một script đang lấy slug từ tên thư mục làm việc thay vì từ feature slug, và tên đó có dấu cách. Vô hại,
> gitignored, local-only — nhưng nếu lane nào đó tình cờ chạm script notify thì đây là dấu vết cần theo.

---
---

# Đợt 3 — L12…L16, và một đính chính cho L4

**Đo thêm 02/09 tại `186a965`.** Đợt này mở đầu bằng một phát hiện làm đổi thứ tự, nên đọc §0 trước.

---

## §0 · ĐÍNH CHÍNH L4 — và lý do nó không phải lỗi đánh máy

**L4 (đợt 1) khai scope gồm `scripts/autopilot-scope-gate`. Đó là sai, hoặc ít nhất là chưa chứng minh
được là đúng.** File đó mang header `# KIT_VERSION: 33` ⇒ nó gần chắc là **kit-pack file**, tức lần
`autopilot-update.sh` thành công kế tiếp sẽ **`cp` đè lên nó**, xoá mọi sửa đổi làm trong consumer. Đó
chính xác là món nợ mà L11 tồn tại để trả cho `DYNAMIC_SEGMENT`.

**Nhưng chỗ tệ hơn nằm ở đây, và nó là phát hiện thật của đợt này:**

```
scripts/autopilot-review-readiness.mjs   -> KHÔNG có header KIT_VERSION,  NHƯNG Ở TRONG pack_pairs
scripts/autopilot-scope-gate             -> CÓ header KIT_VERSION: 33
scripts/ap-finish.sh                     -> KHÔNG có header
scripts/codex-review-pin.sh              -> CÓ header KIT_VERSION: 3
scripts/autopilot-backlog-reconcile      -> CÓ header KIT_VERSION: 8
```

Hàng đầu tiên phá vỡ quy tắc. **Sự có mặt của header `KIT_VERSION` không phải điều kiện cần, và cũng
không phải điều kiện đủ, để biết một file có bị sync ghi đè hay không.** Authority duy nhất là danh sách
`pack_pairs` trong `autopilot/parallel/autopilot-update.sh` của **canonical** — một file **không tồn tại
trong repo này**.

Nói thẳng hệ quả: **đứng trong repo Plexco, không ai xác định được một sửa đổi vào `scripts/` sẽ sống hay
chết.** Mọi lane chạm `scripts/` đang là một lần tung đồng xu. `0af75a2` đã tung một lần và thua — fix
sống sót tới hôm nay **chỉ vì đường sync đang hỏng**, không phải vì ai đã tính đúng.

Vì vậy **L12 đứng trước mọi lane kit khác**, và **L4 tạm hoãn phần `autopilot-scope-gate`** cho tới khi
L12 trả lời xong. Phần `packages/db/src/migrate.ts` của L4 không bị ảnh hưởng — chạy được ngay, tách ra.

---

## L12 · infra · ĐÃ NGHỈ HƯU — thay bằng S1 + S2

> 🔴 **ĐỪNG DÁN LANE NÀY. Nó đã HALT ba lần và prompt gốc đã bị gỡ khỏi đây.**
> `kit-pack-membership-manifest` (v1) HALT REGION_THRASH · (v2) HALT MAX_ROUNDS ·
> `kit-pack-membership-doc` (S1) HALT REGION_THRASH. Ba nguyên nhân khác nhau — tamper surface ·
> giao thức ghi nợ chưa đặc tả · parse Markdown làm authority — nhưng **cùng một hình dạng: lane
> được giao thừa một mặt có biên mở, và mặt đó ăn hết budget.** Prompt gốc còn nằm đây là một cái
> bẫy: ai dán vào sẽ khởi động lại đúng cái monolith vừa chết ba lần. Nay đã gỡ.
>
> **Thay bằng hai lane, và đọc điều kiện của từng cái trước khi mở:**
>
> | | Nội dung | Điều kiện bắt buộc trước khi register |
> |---|---|---|
> | **S1** `kit-pack-membership-doc` | `kit-pack-membership.json` là authority máy đọc · bảng `.md` **SINH RA TỪ** JSON · check = sinh lại rồi **diff byte** · `--audit` **nối vào CI** | **Cấm mọi thành phần parse Markdown để lấy authority.** Xem §00b |
> | **S2** `kit-owned-commit-guard` | hook + trailer + thủ tục dựng lại nợ | Decision table `{sync,patch,both,neither}` × `{file đổi, row demote, xoá bảng}` + 1 ví dụ dựng lại end-to-end phải viết xong **trước** register |
>
> **Đã trả tiền rồi, mang thẳng sang, đừng đo lại:** nội dung doc (5 vòng review, **0 sự thật nào về
> pack bị sửa**; sweep canonical độc lập round 5 khớp bản đầu — 13 target, 12 identical, chỉ
> `level3-workflow.md` lệch 205/2) · threat model coverage-vs-evasion (đứng vững **11 vòng cộng dồn**,
> 0 lần tái tạo lớp tamper) · MIXED_DECLARATION · ngữ nghĩa hai trailer · ca `8e737fe` · ownership đọc
> từ git object · baseline last-known-table · fix `%B --name-only`.
>
> **Luật rút ra, áp cho mọi lane sau:** một region bị flag **lần thứ hai** là tín hiệu **đổi
> substrate**, không phải tín hiệu vá tổng quát hơn.
>
> **Điều kiện dừng đã chốt:** nếu S1 (bản JSON) HALT, lấy phương án "chỉ ship doc thủ công" và dừng
> hẳn hướng tự-bảo-trì. Không có successor thứ tư trong họ này.

---

## L13 · infra · `ap-finish` báo bẩn cho worktree không hề bẩn — thuế đánh vào **mọi** closeout

**Đây là lane có đòn bẩy cao nhất trong cả ba đợt, và nó nhỏ.** `scripts/ap-finish.sh:83` kiểm worktree
sạch bằng `git status --porcelain`, mà lệnh đó **đếm cả file untracked**. Repo này **luôn** có `design.pen`
+ `fe.pen` untracked **có chủ ý** (DD-81, FE PENDING — `git add` chúng là đi ngược lệnh owner). Nên gate
báo *dirty* cho một worktree hoàn toàn sạch, **ở mỗi lần closeout**.

Bạn sắp chạy 11 lane. Không sửa cái này thì nó bắn 11 lần.

**Tier C:** 0 · **Rủi ro:** P2 · **Điều kiện:** L12 xác nhận `ap-finish.sh` là repo-owned (nó không có header, nhưng header không quyết định — chờ L12)

```text
TASK: ap-finish-untracked-counts-as-dirty
RISK: P2
DEPENDS_ON: kit-pack-membership-manifest — confirm ap-finish.sh is repo-owned before
            editing it. If L12 finds it is kit-owned, this lane moves to canonical
            unchanged; the fix is identical, only the repository differs.

OUTCOME
  ap-finish stops reporting a clean worktree as dirty, without becoming blind to the
  dirt it exists to catch.

THE DEFECT
  scripts/ap-finish.sh:83 checks cleanliness with
    git -C "$WT" --no-optional-locks status --porcelain
  That output includes untracked files. This repository permanently and deliberately
  carries design.pen and fe.pen untracked under DD-81 / FE PENDING, so the check
  reports dirty on every closeout in a tree where nothing is actually wrong.

THE TRAP IN THE OBVIOUS FIX
  Passing --untracked-files=no makes the symptom vanish and creates a worse bug: a
  lane that CREATED a new file and forgot to add it would then close out silently,
  and the missing file would be discovered after the merge. The gate exists to catch
  exactly that.
  So the fix must distinguish "untracked and expected" from "untracked and
  surprising". Choose deliberately between:
    (a) an explicit expected-untracked allowlist, sourced from something that already
        declares intent rather than a second hand-maintained list; and
    (b) comparing the untracked set against the lane's declared scope, so an
        untracked file inside the lane's own scope is dirt while one outside it,
        pre-existing at base, is not.
  Record the choice, the rejected alternative, and the reversibility in the ledger.
  Option (b) is stronger but larger; if you take (a), say why (b) was not worth it
  rather than not mentioning it.

SCOPE
  scripts/ap-finish.sh and its test.
NEGATIVE SCOPE
  No change to what ap-finish does after the cleanliness check, to ap-merge.sh, or
  to the scope gate. Do not touch design.pen or fe.pen in any way.
ACCEPTANCE
  - A test with design.pen and fe.pen untracked and nothing else changed: passes.
  - A test with a NEW untracked file inside the lane's scope: still fails, with a
    message naming the file.
  - A test with a genuinely dirty tracked file: still fails.
```

---

## L14 · infra · Scope-gate cắm tín hiệu terminal lên một register **thử lại được**

**Ba ca đo được trong MỘT ngày (14/08), mỗi ca chặn một lane hợp lệ và mỗi ca cần owner can thiệp:**
`HALT-SCOPE_COLLISION.txt` (v2) · `HALT-BASE_MISMATCH.txt` (v2) · `HALT-BASE_MISMATCH.txt` (v3).

**Cơ chế:** `scripts/autopilot-scope-gate` dùng chung `halt_gate()` để ghi file `HALT-<REASON>.txt` vào
state dir cho **mọi** lý do — kể cả những lý do **thử lại được** (base lệch thì re-pin rồi register lại là
xong). Nhưng file `HALT-*.txt` là tín hiệu **terminal** với mọi thứ đọc nó. Một điều kiện tạm thời để lại
một dấu vết vĩnh viễn.

**⚠️ File này mang `KIT_VERSION: 33` ⇒ nhiều khả năng kit-owned ⇒ lane chạy ở canonical, không ở đây.** Chờ
L12 xác nhận.

**Tier C:** 0 · **Rủi ro:** P2 · **Repo:** quyết định bởi L12

```text
TASK: scope-gate-terminal-signal-on-retryable-register
RISK: P2
DEPENDS_ON: kit-pack-membership-manifest — this file carries KIT_VERSION: 33 and is
            probably kit-owned, in which case the lane runs in canonical.
            Do not edit it in the consumer on a guess.

OUTCOME
  A retryable register failure stops leaving a terminal artifact behind.

THE DEFECT, and the distinction that fixes it
  autopilot-scope-gate routes every failure through one halt_gate() helper that
  writes HALT-<REASON>.txt into the state dir. Readers treat HALT-*.txt as terminal.
  But the reasons are not all terminal:
    BASE_MISMATCH   -> retryable: re-pin the base and register again
    SCOPE_COLLISION -> retryable once the colliding lane lands or releases
    CONTRACT_INVALID -> terminal: the manifest is the wrong artifact entirely
  Three legitimate lanes were blocked in one day by the first two being recorded as
  though they were the third.

FIX SHAPE
  Split the failure vocabulary before touching the writer. Classify every existing
  halt reason as terminal or retryable, in a table, and get that table right first —
  a retryable reason misfiled as terminal is the bug being fixed, and a terminal one
  misfiled as retryable is a worse bug in the other direction, because it invites a
  lane to retry into a wall.
  Then give retryable failures a distinct, non-terminal artifact name and make the
  readers understand it. Enumerate the readers; a new artifact nothing reads is not
  a fix.

SCOPE
  scripts/autopilot-scope-gate (or its canonical original) and its tests, plus every
  reader of HALT-*.txt that the enumeration finds.
NEGATIVE SCOPE
  Do not change WHEN the gate refuses. Every condition that halts today still halts;
  this lane changes only what it records and how a retry is expressed. Widening or
  narrowing the gate's refusal set is a different lane and a Tier C question.
ACCEPTANCE
  - The terminal/retryable classification table is in the diff, complete.
  - A test per class proving the artifact written matches the classification.
  - The readers are enumerated in the commit body, each one either updated or
    explicitly noted as unaffected.
```

---

## L15 · BE/docs · DD-104 `DeleteSession` — packet phê chuẩn, không phải slice code

DD-104 đang giữ **🟡 đề xuất** trong `decisions.md`, D0–D4 ở mức decision, slice **DEFERRED**. Hàng backlog
ghi rõ blocker: `DeleteSession` là **destructive admin mutation**, authorize chỉ bằng `session.manage`,
và nó **không có trong session specs**.

Họ session command đã đủ sáu lệnh và ba route; `DeleteSession` là chỗ trống duy nhất còn lại có tên trong
một DD. Nhưng destructive + admin + chưa có trong spec ⇒ **Tier C item 3 và có thể cả item 1** nếu nó chạm
nghĩa vụ tiền của kèo đã có charge. Viết prompt code cho nó là mời một AWAIT.

**Tier C:** cả lane là input cho quyết định Tier C · **Rủi ro:** P2 authoring

```text
TASK: dd104-delete-session-ratification
RISK: P2
MODE: authoring. Produce an owner decision packet. Write no command and no migration.

OUTCOME
  DD-104 moves from proposal to a ratified decision with a named scope, or is closed
  as not-in-phase-1 with that stated. Either outcome unblocks the session family from
  carrying an open question indefinitely.

QUESTIONS THE PACKET MUST SETTLE, each with evidence
  1. What does delete MEAN here — hard delete, soft delete, or archive? The three
     have different consequences for the outbox, for processed_commands, and for any
     row that references the session. Read what already references sessions before
     proposing a semantics.
  2. What happens to a session that has charges or a roster? If deletion can strand
     an obligation, this is a money contract and therefore Tier C item 1, decided by
     the owner and not by the lane. Establish which side of that line it falls on;
     do not assume the safe-looking answer without checking.
  3. Which action class authorizes it? DD-110 pinned four narrow action-class
     literals for the session family. Does delete need a fifth, and does adding one
     touch the Suspended Action Matrix in the billing spec — a Reviewed contract, so
     Tier C item 3 unless a DD names the edit.
  4. Is it in phase-1 at all? DD-114's seven groups do not name it. The cheapest
     correct outcome may be an explicit "not in phase-1, revisit at <trigger>", and
     the packet should say so if the evidence points there rather than designing a
     feature nobody has asked for.

OUTPUT
  A decision packet in Vietnamese (owner-facing), with a recommendation, the
  alternatives, and a self-invalidation trigger. Update the DD-104 block in
  decisions.md only to point at the packet; do not flip its status — that is the
  owner's action.
SCOPE
  docs/decisions/ packet (new), decisions.md pointer line, backlog row status.
NEGATIVE SCOPE
  No deleteSession implementation. No migration. No change to the four existing
  action-class literals. No edit to the Reviewed session or billing specs beyond a
  pointer.
```

---

## L16 · infra/docs · Ô version trong index không ai kiểm

Phát hiện lặp lại: `docs-billing-authz-signature-reconcile` bị codex flag ô version stale trong README
index ở **round-06, 07, 08 liên tiếp**, và **chưa từng đóng được** vì README không nằm trong scope của
slice đó. Audit 13/08 đo được **46/51 ô version sai** trong một index.

Đây là dạng lỗi mà con người không bắt nổi vì nó rẻ để bỏ qua từng lần một, và đắt khi cộng dồn.

**Tier C:** 0 · **Rủi ro:** P3

```text
TASK: docs-feature-index-version-freshness-check
RISK: P2   # was P3; see section 00 — the validator refuses P3 registration outright
OUTCOME
  An index cell that disagrees with the document it points at fails a check instead
  of being flagged as advisory in someone's review round and then forgotten.

STARTING EVIDENCE
  The 2026-08-13 audit measured 46 of 51 version cells wrong in one index. The same
  finding was raised in three consecutive review rounds of a different slice and
  closed none of them, because the index was out of that slice's scope — which is
  precisely why a per-slice reviewer cannot be the mechanism here.

BUILD
  A check that, for each index row naming a document and a version, reads that
  document's own declared version and compares. Report every mismatch at once with
  file:line on both sides. Ambiguity is expected: some documents declare a version in
  a header line, some in frontmatter, and at least one has a header that disagrees
  with its own changelog — ROADMAP carried exactly that defect and it was corrected
  in v3.9. Decide how the check reads a version, write the rule down in the check
  itself, and make an unparseable version an explicit reported state rather than a
  silent pass. A check that silently passes what it cannot read is worse than no
  check, because it will be trusted.

SCOPE
  One check script under scripts/ (repo-owned by construction) and its test, plus
  the wiring line, plus the index corrections the first run produces.
NEGATIVE SCOPE
  Do not change any document's actual version number to make the check pass. If the
  index is wrong, fix the index; if a document's header contradicts its own
  changelog, that is a finding to report, not a number to overwrite.
ACCEPTANCE
  - The check finds the known-stale cells; the count is stated in the commit body.
  - A test with a deliberately mismatched pair fails, and a matched pair passes.
  - An unparseable version is reported as unparseable, proven by a test.
```

---

## Bảng gộp — 16 lane, và chỗ nên dừng viết prompt

| Ưu tiên | Lane | Loại | Tier C | Ghi chú |
|---|---|---|---|---|
| **0** | **L12** kit-pack membership | infra | 0 | **Chạy trước mọi lane chạm `scripts/`** — nếu không, mỗi sửa đổi là tung đồng xu |
| 1 | **L13** ap-finish untracked | infra | 0 | Đòn bẩy cao nhất: hiện bắn ở **mọi** closeout |
| 1 | **L0** re-pin runner | infra | 0 | Cần Postgres máy owner |
| 1 | **L7** test-harness leak | BE | 0 | Một file, không đụng ai |
| 1 | **L2** zalo credential trace | infra | 0 | Read-only, feed **O4** |
| 2 | **L1** route close/cancel | BE | 0 | Chặn L3 |
| 2 | **L8** app_worker password | infra | 0 | — |
| 2 | **L4a** migrate.ts diagnosability | infra | 0 | **Tách khỏi L4** — phần scope-gate chờ L12 |
| 3 | **L3** DD-118 coverage | BE | 0 | Đợi L1 |
| 3 | **L5** local-dev paths | infra | 0 | — |
| 3 | **L16** index freshness | infra | 0 | — |
| 4 | **L14** scope-gate signals | infra | 0 | Repo do L12 quyết |
| 4 | **L11** kit sync | infra | 0 | Canonical repo |
| 5 | **L9** job runtime | authoring | ≥1 | Contract conflict NFR vs cron |
| 5 | **L6** zalo routing | authoring | chưa đếm | Khối 2 của launch |
| 6 | **L10** app_worker threat model | authoring | packet | Đóng được `preflight.ts` |
| 6 | **L15** DD-104 delete | authoring | packet | Chỗ trống cuối của họ session |

**11 lane Tier C = 0.** Bốn lane authoring còn lại sinh ra quyết định chứ không sinh code.

> **Và đây là chỗ nên dừng viết prompt.** Phần backlog còn lại — `classifier-blocks-kit-mandated-readiness-json`,
> `codex-review-verdict-nondeterminism`, `ap-merge-test-and-clean-tree-scope`,
> `ap-finish-squash-verify-defeated-by-closeout-order`, `launcher-register-path-authored-to-runtime`,
> `codex-review-pin-worktree-isolation-defect`, `backlog-status-taxonomy-inflight-manual-close-gap`,
> `pnpm-workspace-postcss-override-inert` — đều là defect thật, nhưng **cả tám đều là kit/process, và cả tám
> đều nằm sau L12** theo đúng lý do §0. Viết prompt cho chúng bây giờ là viết tám prompt mà mỗi cái mở đầu
> bằng "chờ L12 trả lời đã". Chạy L12 xong thì tám cái đó gom được thành một hoặc hai lane có thật, xếp theo
> repo sở hữu — và lúc đó chúng mới đáng viết.
>
> Ba mục cố ý không có prompt (`core-matcher-ambiguous-consumer-wiring` · billing P5 ·
> `tenant-capability-authority-core`) giữ nguyên lý do đã ghi ở đợt 2.
