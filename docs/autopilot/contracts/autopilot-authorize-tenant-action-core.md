<!-- review-readiness: code-ready -->

# Autopilot task contract — `authorize-tenant-action-core`

> **Đây là coding handoff.** Verdict canonical nằm ở cuối file. Slice được author TRƯỚC verdict
> (gate §11.2 cấm verdict một slice chưa tồn tại), rồi verdict pin đúng commit chứa nó —
> `AUTHORITY_SHA` dưới là commit đã land ba artifact này, không phải một nhãn version di động.

---

## Vì sao có file này — và vì sao nó là một slice TÁCH RA

Backlog có task `tenant-capability-authority-core` gộp **hai hàm** mà spec mô tả cạnh nhau:

| Hàm | Đọc gì | Trạng thái dữ liệu sống |
|---|---|---|
| `authorizeTenantAction(tenantId, actionClass)` | `tenants.status` + `subscriptions.status` | ✅ cả hai cột tồn tại, đúng CHECK enum, đúng default |
| `hasCapability(tenant, key)` | `plans.entitlements.capabilities.<key>` | ❌ **không tồn tại trong dữ liệu sống** |

Đo ngày 2026-07-30 trên `0011_seeds.sql`:

```sql
INSERT INTO plans (plan_key, version, price, limits, entitlements) VALUES
  ('free_web', 1, 0, '{}', '{"web_app": true, "telegram": false, "zalo": false, "messenger": false}'),
  ...
```

Seed sống là **flat**, không có lớp bọc `capabilities`, tên khoá khác spec (`zalo` vs `bot_zalo`), và
thiếu toàn bộ khoá nghiệp vụ (`session_management`, `payment_reconcile_auto`, `reminders_auto`, …).
CHECK sống vẫn là `plan_key IN ('free_web','telegram','plus_channel','all_channels')`
(`0007_billing.sql:14`); mục tiêu DD-29 `('free','host_pro')` **chưa land** — chính
`feature_billing_lifecycle_tech.md` tự cảnh báo điều này ở dòng 35 (`⚠️ PENDING MIGRATION`).

Viết `hasCapability` hôm nay ⇒ mọi lần gọi trả `undefined`. Nó cần migration đổi enum + reshape
`entitlements` + reseed — một quyết định dữ liệu, không phải logic. Gộp vào đây là kéo một migration
có rủi ro dữ liệu vào một slice thuần logic. **Tách.** DD-29 mở block riêng.

**Hệ quả phụ, và nó gỡ một blocker cứng:** task gốc khai `depends_on: [dd38-dd86-chat-schema-core]`
(status `idea`, chưa merged) ⇒ `scripts/autopilot-scope-gate register` sẽ `HALT DEP_MISSING`.
Phụ thuộc đó thuộc nửa capability (chat), không phải nửa authority — `authorizeTenantAction` không
đọc một bảng chat nào. Tách xong, slice này có `depends_on: []` và **chính nó là root dependency**,
thoả B1 (`gate §4`: *"hoặc slice hiện tại chính là dependency gốc"*).

---

## §3 Task contract

```text
TASK_ID: authorize-tenant-action-core
OUTCOME: một choke-point `authorizeTenantAction(tenantId, actionClass)` duy nhất resolve effective
  tenant status fail-closed 2-step, để mọi caller (publish, và mọi action class sau này) KHÔNG tự
  đọc `tenants.status`/`subscriptions.status`. Không caller nào được wire trong slice này.
REPOSITORY_AND_BASE: Plexco app · base `main` · PIN SHA lúc mở worktree (đo lại, đừng chép số ở đây)
CONTEXT_SOURCES:
  - docs/features/BE/feature_billing_lifecycle_tech.md §3 Status Authority  (AUTHORITY — bảng quyết
    định 6 case, founder-ratified 2026-07-24, v2.8a; test #29–36a)
  - docs/features/BE/feature_session_management_tech.md §4 step 6 + edge #24  (consumer contract:
    locking read, thứ tự khoá, failure mode)
  - packages/db/migrations/0002_tenants_core.sql:15-16 · 0007_billing.sql:34 · 0012_auth_functions.sql
  - packages/db/schema.ts  (AUTHORITATIVE cho shape)
APPLICABLE_SKILLS: none — logic thuần + test, không có skill nào áp dụng.
SCOPE: packages/db/src/authorization.ts (mới) · packages/db/src/authorization.test.ts (mới) ·
  packages/db/src/index.ts (export) · docs/autopilot-manifests/authorize-tenant-action-core.json
NEGATIVE_SCOPE:
  - KHÔNG viết `hasCapability` — chờ DD-29 (xem trên).
  - KHÔNG sửa `plans` (enum, seed, entitlements) — đó là DD-29.
  - KHÔNG thêm migration. Cả hai cột đã tồn tại; slice này không cần `0027`.
  - KHÔNG wire vào publish/session/billing route nào. Đây là dependency gốc, consumer là slice sau.
  - KHÔNG tự invent error code. `TENANT_SUSPENDED` đã tồn tại và là 403 canonical.
  - KHÔNG copy bảng quyết định 6 case vào code comment hay doc — cross-ref. Bản sao là cách nó lệch.
  - KHÔNG viết write path cho `tenants.status` (trust-safety mechanism chưa xây; set ⊥ clear là một
    cặp phải cùng một owner — spec §3 pin điều này).
RISK: P1  (authorization boundary · fail-closed · tenant isolation)
AUTONOMY_MODE: supervised
MODEL_POLICY: code gate = `scripts/codex-review-pin.sh`. **Slice này là authorization ⇒ bắt buộc
  thêm 1 vòng security-focused.** Reviewer không gọi được → `HALT TOOL_UNAVAILABLE`, cấm tự hạ gate.
SANDBOX_AND_PERMISSIONS: cần Postgres cho test (`DATABASE_URL_TEST`). Không network. Không secret.
HUMAN_DECISIONS_REQUIRED: none — bảng quyết định đã founder-ratified 2026-07-24, không còn product
  choice trong scope.
SLICE_GRAPH: một slice, không fan-out. Root dependency.
DEPENDENCIES: none (root)
INVARIANTS: [billing, publish-suspend-gate]  (corrected 2026-07-30 — xem changelog)
  ⚠️ **KHÔNG khai `schema`.** Task gốc khai nó, nhưng slice này không thêm migration và không sửa
  `schema.ts`. Khai thừa `schema` sẽ khoá lane của mọi slice migration khác mà không có lý do thật.
VERIFICATION: xem Acceptance matrix dưới. Khai bằng **thuộc tính**, không phải literal — runtime
  manifest bị hash-lock sau `register`, một con số cứng đi lệch là phải đăng ký lại toàn bộ.
CODE_REVIEW: bắt buộc, **2 vòng clean liên tiếp cùng HEAD** (P1 — autopilot-review-readiness.mjs
  yêu cầu `clean_rounds >= 2` khi `risk=P1`).
SECURITY_REVIEW: bắt buộc (authorization boundary).
BUDGETS: MAX_ROUNDS 5 · REGION_THRASH 3 cùng vùng ⇒ HALT. Ước lượng ≤300 LOC, 3 module, 0 migration.
STOP_CONDITIONS: STOP_AT_READY. HALT nếu (a) phát hiện `authorizeTenantAction` cần đọc cột thứ ba
  ngoài hai cột đã pin, (b) bất kỳ case nào của bảng quyết định không map được sang test,
  (c) test đòi write path cho `tenants.status` (chưa tồn tại — dùng fixture insert trực tiếp).
DELIVERABLES: diff trong scope · acceptance matrix chạy thật · bằng chứng review sạch · READY report.
```

---

## Live-truth verification — đo 2026-07-30

Ba tiền đề mà toàn bộ thiết kế §3 dựa lên, kiểm trực tiếp trên migration chứ không đọc prose:

| Tiền đề spec | Bằng chứng | Kết quả |
|---|---|---|
| `tenants.status` có `DEFAULT 'trialing'` | `0002_tenants_core.sql:15` | ✅ |
| `tenants.status` CHECK 5 giá trị | `0002_tenants_core.sql:16` — `CHECK (status IN ('trialing','active','past_due','suspended','cancelled'))`; đổi tên thành `tenants_status_chk` ở `0025` | ✅ |
| `subscriptions.status` cùng CHECK | `0007_billing.sql:34` | ✅ |
| `tenant_provision` set `'active'` tường minh, không rơi vào default | `0012_auth_functions.sql` — `INSERT INTO tenants(name, slug, status, ...) VALUES (..., 'active', ...)` | ✅ |

**Hệ quả cho test:** vì cả hai cột **có** CHECK, case 1b (`tenants.status ∈ {past_due, cancelled}`)
chỉ dựng được bằng giá trị hợp lệ trong enum — không dựng được bằng chuỗi rác. Fixture phải insert
trực tiếp; không có write path nào sinh ra hai giá trị đó ở trục tenant-root.

**Ranh giới contract vs runtime:** hai cột là runtime thật. Bảng quyết định là contract — chưa có
một dòng code nào cài nó. Slice này là lần đầu.

---

## Bảng quyết định — CROSS-REF, không sao chép

Nguồn duy nhất: `features/BE/feature_billing_lifecycle_tech.md` §3 Status Authority, 6 case
(`1`, `1b`, `2`, `2b`, `3`, `4`), founder-ratified 2026-07-24.

**Không chép bảng đó vào đây và không chép vào code comment.** Lý do không phải sạch sẽ mà là đã
đo được: lineage `deps-security-bump` mất ba lần đăng ký vì các bản sao literal đi lệch khỏi nguồn.
Test phải cite case number (`case 2b`), người đọc mở spec.

Hai thứ implementation PHẢI giữ, và chúng nằm ngoài bảng:

1. **Chữ ký nhận `tenantId`, KHÔNG nhận status đã resolve sẵn.** Hàm tự đọc cả hai cột. Một caller
   pre-resolve một cột sẽ âm thầm bỏ sót trục kia — spec §1 nêu đích danh đây là lý do bảo đảm
   *"adapters cannot implement inconsistent suspension rules"* còn thật.
2. **Nhánh mutating phải đọc bằng locking read** — `SELECT ... FOR SHARE` trên `tenants` rồi
   `subscriptions`, đúng thứ tự step 1 → step 2. Plain re-SELECT trong cùng transaction **không đủ**
   dưới READ COMMITTED: giữ lock trên `sessions` không khoá được row billing. Đây là kết luận của
   codex round-01 [P1] trên `docs-session-publish-concurrency-recheck`, không phải hardening tuỳ chọn.

---

## Acceptance matrix

| # | Nhóm | Input / precondition | Expected | Layer |
|---|---|---|---|---|
| A1 | Happy | `tenants.status='active'`, `subscriptions.status='active'` | allow, `effective='active'` (case 3) | unit+db |
| A2 | Happy | tenant `'trialing'`, sub `'trialing'` | allow (case 3) | unit+db |
| A3 | Happy | tenant `'active'`, sub `'past_due'` | allow — `past_due` **không** khoá | unit+db |
| B1 | Boundary | tenant `'active'`, **thiếu row** `subscriptions` | deny `TENANT_SUSPENDED` (case 4, fail-closed) | db |
| B2 | Boundary | tenant `'suspended'`, sub `'active'` | deny — trục tenant thắng ở step 1, **không xét step 2** (case 1) | db |
| B3 | Boundary | tenant `'past_due'` (anomaly), sub bất kỳ | deny (case 1b) | db |
| B4 | Boundary | tenant `'cancelled'` (anomaly), sub bất kỳ | deny (case 1b) | db |
| B5 | Boundary | tenant `'active'`, sub `'cancelled'` | deny (case 2b) — **không** treat như active; đóng lối tắt `suspended→cancelled` né nợ | db |
| B6 | Boundary | tenant `'active'`, sub `'suspended'` | deny (case 2) | db |
| C1 | AuthZ | `tenantId` không tồn tại | deny fail-closed, **không** throw lộ thông tin tồn tại | db |
| C2 | AuthZ | `actionClass` không nhận diện được | deny fail-closed — không allow-by-default | unit |
| D1 | Failure | query lỗi / dependency unavailable | deny, không nuốt lỗi thành allow | unit |
| E1 | Concurrency | nhánh mutating: writer đối thủ giữ `FOR UPDATE` trên `subscriptions` trước | re-check **BLOCK** tới khi writer resolve, rồi đọc giá trị mới → deny nếu vừa thành `suspended`. Mirror billing test **#36** | db |
| E2 | Concurrency | nhánh mutating: `FOR SHARE` giành được trước | writer `SKIP LOCKED` bỏ qua row lượt này; hàm proceed trên trạng thái đã quan sát ở một điểm serialize hợp lệ. Mirror **#36a** | db |
| E3 | Concurrency | chứng minh plain re-SELECT **không** đủ | test phải fail nếu implementation bỏ `FOR SHARE` — nếu nó pass với cả hai cài đặt thì test vô giá trị | db |
| F1 | Migration | — | **không có migration.** Assert: không file `.sql` mới trong diff | gate |
| G1 | Security | deny không lộ trục nào gây khoá | một mã `TENANT_SUSPENDED` cho mọi nguyên nhân — spec cố ý cause-agnostic | unit |
| H1 | Regression | suite hiện có | không đổi hành vi; `rls-invariants.test.ts` vẫn xanh | full |

**E3 là hàng quan trọng nhất bảng này.** Một test concurrency pass với cả implementation đúng lẫn sai
thì không chứng minh gì — đó chính là finding codex round-02 [P1] đã bắt trên billing test #36 bản đầu.
Harness phải **giữ transaction của writer đối thủ MỞ** trong lúc hàm đọc; nếu để nó commit xong mới đọc
thì một plain re-SELECT cũng thấy giá trị mới và pass nhầm.

---

## Open questions trong scope

**0.** Bảng quyết định founder-ratified 2026-07-24; sáu case đều có expected result; không còn
product choice. Hai câu hỏi phase sau đã pin negative scope và **không** chặn slice này:

| Câu hỏi | Vì sao không chặn |
|---|---|
| Trust-safety write path cho `tenants.status` | Chưa tồn tại. Slice này chỉ ĐỌC. Spec §3 đã pin: set ⊥ clear phải cùng một owner khi mechanism đó land; một sự kiện trục billing không được ngầm clear cột này. Negative scope trên đã cấm viết. |
| DD-29 `plan_key` + reshape `entitlements` | Chỉ ảnh hưởng `hasCapability`, đã tách khỏi slice. `authorizeTenantAction` không đọc `plans`. |

---

## Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-30
AUTHORITY_SHA: b4d08c83767f0ff6693a05452e61248b58defc01
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot/contracts/autopilot-authorize-tenant-action-core.md
  - docs/autopilot-manifests/authorize-tenant-action-core.json
  - docs/features/BE/feature_billing_lifecycle_tech.md
  - docs/features/BE/feature_session_management_tech.md
  - packages/db/migrations/0002_tenants_core.sql
  - packages/db/migrations/0007_billing.sql
  - packages/db/migrations/0012_auth_functions.sql
SLICE: authorize-tenant-action-core
IN_SCOPE: authorizeTenantAction resolver — fail-closed 2-step effective-status resolution over tenants.status then subscriptions.status, với locking read cho nhánh mutating; unit + real-Postgres tests
OUT_OF_SCOPE: hasCapability · plans enum/seed/entitlements (DD-29) · migration nào · wiring vào publish/session/billing route · error code mới · write path cho tenants.status
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none — slice này là dependency gốc
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: tạo packages/db/src/authorization.ts với chữ ký nhận tenantId (KHÔNG nhận status đã resolve sẵn) và test case 3 (allow path) trước, để pin shape trước khi thêm nhánh deny
REMAINING_BLOCKERS: none
```

### Closure matrix

| # | Gate | Bằng chứng | |
|---|---|---|---|
| 1 | Authority pin theo SHA | `b4d08c8` + `TARGET_FILES` liệt kê exact, không glob | PASS |
| 2 | Decision trong scope đã chốt | bảng 6 case founder-ratified 2026-07-24 (`feature_billing_lifecycle_tech.md` v2.8a) | PASS |
| 3 | Scope IN/OUT và owner rõ | manifest `scope` 5 file exact + `negative_scope` 7 mục | PASS |
| 4 | Dependency phân loại đủ | none — root dependency; `dd38-dd86` đã loại bằng phép đo, không phải bằng giả định | PASS |
| 5 | Live schema khớp doc | `0002:15-16` · `0007:34` · `0012` — đo trực tiếp 30/07, ba tiền đề đều đúng | PASS |
| 6 | Data/auth contract đủ | chữ ký nhận `tenantId` · thứ tự khoá `tenants`→`subscriptions` · `TENANT_SUSPENDED` 403 cause-agnostic | PASS |
| 7 | Fail-closed/order đủ | cả 6 case có expected; thiếu row = deny; anomaly = deny; step 1 thắng vô điều kiện | PASS |
| 8 | Open question trong scope | 0 — hai câu hỏi phase sau đã pin negative scope | PASS |
| 9 | Acceptance matrix có expected | 17 hàng, mỗi hàng có input · precondition · expected · layer | PASS |
| 10 | Migration/security/rollback pin | 0 migration (F1 assert diff không có `.sql` mới) · security round bắt buộc · rollback = revert thuần, hàm chưa có caller nào | PASS |
| 11 | First slice hard deps merged | root, không có gì phải chờ | PASS |
| 12 | Implementation handoff sẵn sàng | slice doc + manifest + backlog entry + launcher `ap-40` | PASS |

**Ba điều verdict này KHÔNG chứng minh.** Nó không nói feature publish đã sẵn sàng — slice này chỉ tạo
dependency gốc, chưa wire caller nào. Nó không nói `hasCapability` sẵn sàng — hàm đó chờ DD-29. Và nó
không phải bằng chứng runtime: `CODE_READY` nghĩa là mở worktree được, không phải `IMPLEMENTED`.

---

## Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
| 30/07/2026 | v0.2 | **Register-time correction, launcher `ap-40` execution.** Đo trực tiếp `docs/autopilot-invariant-catalog.md` (block `<!-- catalog:start -->…<!-- catalog:end -->`) lúc mở worktree: hai token `invariants` gốc (`tenant-isolation`, `authorization`) **không tồn tại** trong catalog ⇒ `register` sẽ `HALT INVARIANT_UNKNOWN`. Đổi sang hai token canonical sẵn có: `billing` (slice đọc hai bảng do billing spec sở hữu, cài đúng §3 Status Authority) và `publish-suspend-gate` (định nghĩa trong catalog trỏ thẳng `authorizeTenantAction('publish_new_sessions')`). Đồng thời sửa `code_review.clean_rounds` từ `1` lên `2` — `autopilot-review-readiness.mjs` bắt buộc `clean_rounds ≥ 2` khi `risk=P1` (đã đọc trực tiếp source), giá trị `1` gốc sẽ bị `CONTRACT_INVALID`. Sửa `verification.focused` từ 4 câu prose thành 2 lệnh bash thật thi hành được — gate chạy từng phần tử của mảng này qua `spawnSync("/bin/bash",["-lc", cmd])`, một câu tiếng Anh không phải shell hợp lệ sẽ fail ngay attempt đầu; thuộc tính "không migration mới" đã được gate tự enforce qua cơ chế `SCOPE_DRIFT` (scope không khai file `.sql` nào) nên không cần một dòng focused riêng cho nó. Không đổi bảng quyết định 6-case, acceptance matrix, hay bất kỳ quyết định sản phẩm nào — thuần sửa lỗi cơ chế đăng ký. |
| 30/07/2026 | v0.1 | Author slice contract, tách từ `tenant-capability-authority-core`. Ba việc đo được lật cách đặt task gốc: (1) seed `plans` sống là flat, không có lớp `capabilities` ⇒ `hasCapability` trả `undefined`, phải chờ DD-29; (2) task gốc khai `depends_on: [dd38-dd86-chat-schema-core]` chưa merged ⇒ `register` sẽ `HALT DEP_MISSING`, mà phụ thuộc đó thuộc nửa capability nên tách xong là tự gỡ; (3) task gốc khai `invariants: [schema, ...]` nhưng slice này không thêm migration cũng không sửa `schema.ts` ⇒ bỏ `schema`, tránh khoá lane migration vô cớ. Verify ba tiền đề spec trực tiếp trên `0002`/`0007`/`0012`, đều đúng. |
