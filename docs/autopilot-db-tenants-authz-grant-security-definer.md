<!-- review-readiness: code-ready -->

# Autopilot task contract — `db-tenants-authz-grant-security-definer`

> **Đây là coding handoff.** Verdict canonical nằm ở cuối file. `AUTHORITY_SHA` dưới pin đúng base
> HEAD mà toàn bộ live-truth verification bên dưới được đo — commit ngay trước commit chứa slice
> này (cùng quy ước với `docs/autopilot-eslint-10-migration.md`: `pnpm review:check:changed` xác
> minh bằng `git merge-base --is-ancestor`, đứng vững cả sau khi commit này land).

---

## Vì sao có file này

`authorize-tenant-action-core` (AP-40) merge tại `ddb69a9` — `authorizeTenantAction(tx, tenantId,
actionClass)` đúng logic, có test đầy đủ. Nhưng nó **không gọi được bởi role `app`**: phát hiện tại
thời điểm register của AP-40, ghi lại trong chính docstring của `authorization.ts` (dòng 74–95) bởi
tác giả slice trước — role `app` không có grant nào trên bảng `tenants`, và một `GRANT SELECT` đơn
thuần không đủ vì Postgres đòi quyền `UPDATE` cho **mọi** mệnh đề khoá hàng kể cả `FOR SHARE`. Mà
`GRANT UPDATE` thẳng lại tự mở đúng write path mà AP-40 cố ý đóng: `tenants.status` là trục
tenant-root hard override, và cơ chế trust-safety phải sở hữu CẢ set lẫn clear cột đó **chưa tồn
tại**. Slice này đóng khoảng cách đó bằng đúng pattern codebase đã dùng — SECURITY DEFINER hẹp
(`0012_auth_functions.sql`), không grant thô.

**Đo lại 2026-07-31, không tin bất kỳ dòng nào ở trên hay trong backlog:**

- `grep -rniw "tenants" packages/db/migrations/*.sql | grep -i "GRANT\|REVOKE"` → **rỗng**, xác nhận
  trên toàn bộ 27 migration (0000–0026), không chỉ hai file đã kiểm trước đó.
- Test thật trên PostgreSQL 16.14 đang chạy: một role chỉ có `GRANT SELECT` chạy `SELECT ... FOR
  SHARE` → `ERROR: permission denied for table`; cùng role chạy `SELECT` trần → thành công. Xác nhận
  trực tiếp bằng thực nghiệm, không suy từ tài liệu Postgres.
- **`subscriptions` KHÔNG cùng cảnh ngộ** — đây là điểm bản backlog note gốc không nói rõ: `app` đã
  có đủ `SELECT, INSERT, UPDATE, DELETE` trên `subscriptions` (đo qua
  `information_schema.role_table_grants`), vì bảng này nằm trong vòng lặp `tenant_tables` của
  `0009_rls_policies_grants.sql`. Đọc `subscriptions ... FOR SHARE` hiện tại của
  `authorizeTenantAction` **đã chạy được** cho role `app`. Chỉ có bước đọc `tenants` là bị chặn.
  `tenants` cũng **không có RLS** (`pg_class.relrowsecurity = false`), khác `subscriptions`
  (`= true`) — nó không nằm trong vòng lặp RLS+grant vì nó là bảng ROOT của tenant, không phải bảng
  con theo `tenant_id`.

Hệ quả thiết kế: **chỉ cần MỘT hàm SECURITY DEFINER hẹp bọc đúng bước đọc `tenants`**, không phải
một lớp bọc rộng hơn hay sửa `subscriptions`.

---

## §3 Task contract

```text
TASK_ID: db-tenants-authz-grant-security-definer
OUTCOME: role `app` gọi được `authorizeTenantAction` thành công đầu-cuối, qua một hàm SECURITY
  DEFINER hẹp `resolve_tenant_status_locked(uuid)` sở hữu đúng quyền đọc-khoá `tenants`, KHÔNG mở
  bất kỳ write path nào lên `tenants.status` và KHÔNG grant SELECT/UPDATE thô trên bảng.
REPOSITORY_AND_BASE: Plexco app · base `main` · PIN SHA lúc mở worktree (đo lại, đừng chép số ở đây)
CONTEXT_SOURCES:
  - packages/db/src/authorization.ts (AUTHORITATIVE cho hành vi hiện tại + docstring giải thích gap)
  - packages/db/migrations/0012_auth_functions.sql (pattern SECURITY DEFINER phải theo đúng)
  - packages/db/migrations/0009_rls_policies_grants.sql (xác nhận subscriptions đã có grant, tenants thì không)
  - packages/db/src/authorization.test.ts (suite hiện có; ctx.appDb.db là handle role app có sẵn)
  - packages/db/src/test-harness.ts (RlsTestContext — appDb/appPool đã tồn tại, không cần hạ tầng mới)
  - docs/autopilot-authorize-tenant-action-core.md (slice contract của dependency)
APPLICABLE_SKILLS: none.
SCOPE: packages/db/migrations/0027_resolve_tenant_status_locked.sql (mới; SỐ ĐO 2026-07-31, xác nhận
  lại tail thật lúc mở worktree) · packages/db/src/authorization.ts · packages/db/src/authorization.test.ts ·
  packages/db/src/migrate.test.ts · packages/db/src/rls-invariants.test.ts (2 file thêm vào lúc triển
  khai — file migration 0027 (file migration thứ 28, đếm 0000-0027) buộc phải cập nhật literal
  MIGRATION_COUNT/tail filename hardcode ở cả hai,
  cùng lớp fix db-undeclared-check-constraints-schema-mirror đã cần cho migration 0026 của nó) ·
  packages/db/README.md · docs/autopilot-manifests/db-tenants-authz-grant-security-definer.json ·
  docs/autopilot-db-tenants-authz-grant-security-definer.md
NEGATIVE_SCOPE:
  - KHÔNG `GRANT SELECT`/`UPDATE`/`INSERT`/`DELETE` thẳng trên `tenants` cho `app` hay role nào.
  - KHÔNG viết write path cho `tenants.status` — hàm CHỈ đọc (`FOR SHARE`), không bao giờ `UPDATE`.
  - KHÔNG đụng grant/RLS của `subscriptions` — đã đúng sẵn.
  - KHÔNG đổi decision logic của `authorizeTenantAction` (bảng 6 case, nhánh allow/deny) — chỉ đổi cơ
    chế truy cập bước đọc `tenants`, hành vi phải giữ nguyên y hệt với mọi test hiện có.
  - KHÔNG wire `authorizeTenantAction` vào route/caller nào — slice này làm choke-point GỌI ĐƯỢC bởi
    `app`, không phải thêm caller sản xuất đầu tiên.
  - KHÔNG grant EXECUTE cho `app_worker`/`readonly` — chỉ `app` gọi `authorizeTenantAction` hôm nay.
  - KHÔNG migration thứ hai — đúng một file `.sql` mới.
  - KHÔNG sửa `0012_auth_functions.sql` hay bất kỳ migration đã áp dụng nào khác.
  - KHÔNG audit/sửa rộng hơn mọi bảng có zero grant `app` — đúng phạm vi bước đọc `tenants` mà tên
    slice đã nêu, không phải một sweep access-control tổng quát.
  - Sửa `migrate.test.ts`/`rls-invariants.test.ts` CHỈ giới hạn ở literal MIGRATION_COUNT/tail
    filename mà file migration thứ 28 buộc phải đổi — không đổi assertion nào khác trong hai file đó.
RISK: P1 (authorization boundary trên bảng tenant-root · nếu sai, mở đúng write path AP-40 cố ý đóng)
AUTONOMY_MODE: supervised
MODEL_POLICY: code gate = `scripts/codex-review-pin.sh`, 2 vòng clean liên tiếp (P1). **Bắt buộc thêm
  1 vòng security-focused** — tạo SECURITY DEFINER function + EXECUTE grant trên bảng tenant-root là
  đúng loại thay đổi trust-boundary. Reviewer không gọi được → `HALT TOOL_UNAVAILABLE`, cấm tự hạ gate.
SANDBOX_AND_PERMISSIONS: cần Postgres cho test (`DATABASE_URL_TEST`). Không network, không secret.
HUMAN_DECISIONS_REQUIRED: none — hướng kỹ thuật (SECURITY DEFINER hẹp, không grant thô) đã bị khoá
  bởi chính negative scope của AP-40 (trust-safety mechanism cho write path chưa tồn tại) và bởi
  thực nghiệm Postgres (UPDATE bắt buộc cho FOR SHARE). Shape hàm follow đúng pattern 0012 đã có sẵn
  trong codebase, không phải một lựa chọn thiết kế mới.
SLICE_GRAPH: một slice, không fan-out. `depends_on: [authorize-tenant-action-core]` (đã merged,
  dep_checks pin đủ base/landed SHA + symbol).
DEPENDENCIES: authorize-tenant-action-core — MERGED `ddb69a92aa8b60afb4644acf211dffe2c0091a1b`
  (verify 2026-07-31: symbol `authorizeTenantAction` vắng mặt tại parent `55970df7f8ede2...`, có mặt
  tại chính commit đó).
INVARIANTS: [schema, auth, billing]
VERIFICATION: xem Acceptance matrix dưới + `verification` trong manifest — mọi lệnh đã chạy thật
  (`spawnSync` y hệt gate, round-trip qua JSON) trước khi commit slice doc này, không chỉ parse cú
  pháp. Lệnh đầu tiên (`verification.focused[0]`) là thực nghiệm sống trên Postgres đang chạy, không
  phải trích dẫn tài liệu.
CODE_REVIEW: bắt buộc, 2 vòng clean liên tiếp cùng HEAD (P1).
SECURITY_REVIEW: bắt buộc (authorization boundary trên bảng tenant-root).
BUDGETS: MAX_ROUNDS 5 · REGION_THRASH 3 cùng vùng ⇒ HALT. wall_time 120 phút.
STOP_CONDITIONS: STOP_AT_READY. HALT nếu (a) tail migration đã vượt `0026` lúc mở worktree — số kế
  tiếp phải đo lại chứ không đoán, (b) tiền đề "FOR SHARE cần hơn SELECT" hoá ra sai trên Postgres
  đang chạy thật, (c) `resolve_tenant_status_locked` hoá ra cần đọc cột/bảng khác ngoài
  `tenants.status`, (d) bất kỳ test hiện có nào đổi hành vi khi chạy qua `ctx.appDb` so với
  `ctx.superuserDb` ngoài đúng khoảng cách quyền mà slice này đóng.
DELIVERABLES: diff đúng scope · acceptance matrix chạy thật qua CẢ hai connection (`superuserDb` và
  `appDb`) · bằng chứng review sạch + security round · READY report.
```

---

## Live-truth verification — đo 2026-07-31

| Tiền đề | Bằng chứng | Kết quả |
|---|---|---|
| Không grant nào trên `tenants` trong TOÀN BỘ migration | `grep -rniw "tenants" packages/db/migrations/*.sql \| grep -i "GRANT\|REVOKE"` trên cả 27 file (0000–0026) | ✅ rỗng — khớp `_problem`, đo rộng hơn phép đo gốc (chỉ kiểm 0002+0009) |
| `FOR SHARE` cần quyền `UPDATE`, không chỉ `SELECT` | Thực nghiệm trực tiếp trên PostgreSQL 16.14 đang chạy: tạo role chỉ có `GRANT SELECT`, `SELECT ... FOR SHARE` → `ERROR: permission denied for table`; `SELECT` trần cùng role → thành công | ✅ xác nhận bằng thực nghiệm, không suy từ tài liệu |
| `subscriptions` đã có đủ grant cho `app` | `information_schema.role_table_grants`: `app` có `SELECT, INSERT, UPDATE, DELETE` trên `subscriptions` — nằm trong vòng lặp `tenant_tables` của `0009:26-58` | ✅ — bước đọc `subscriptions FOR SHARE` hiện tại KHÔNG cần sửa |
| `tenants` không có RLS | `pg_class`: `tenants.relrowsecurity = false`, `relforcerowsecurity = false`; `subscriptions` cả hai `= true` | ✅ — hàm SECURITY DEFINER không cần lo bypass RLS trên `tenants` (không có gì để bypass) |
| Migration tail hiện tại | `ls packages/db/migrations/*.sql \| sort \| tail -5` → `..., 0025_check_constraint_naming_drift.sql, 0026_undeclared_check_constraint_names.sql` — 27 file | ⚠️ số kế tiếp `0027` là ĐO HÔM NAY, không phải hằng số — re-verify lúc mở worktree |
| `authorize-tenant-action-core` đã merge | `git show ddb69a9:packages/db/src/authorization.ts \| grep -c authorizeTenantAction` → 3; `git show ddb69a9^:packages/db/src/authorization.ts` → file không tồn tại; `ddb69a9` là commit đơn (1 parent) | ✅ dep_checks trong manifest pin đủ base/landed |
| Pattern SECURITY DEFINER tham chiếu | `0012_auth_functions.sql`: mọi hàm đều `LANGUAGE sql\|plpgsql`, `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL ... FROM PUBLIC` rồi `GRANT EXECUTE ... TO app` | ✅ shape đã pin trong `_design_contract` của manifest theo đúng pattern này |

---

## Acceptance matrix

| # | Nhóm | Input / precondition | Expected | Layer |
|---|---|---|---|---|
| A1 | Happy | role `app` thật (qua `ctx.appDb.db`), tenant `active` + sub `active`, gọi `authorizeTenantAction` | allow, `effectiveStatus='active'` — LẦN ĐẦU chạy thành công qua role `app` thật (DBG-1) | db |
| A2 | Happy | role `app`, một case deny (vd tenant `suspended`) | deny `TENANT_SUSPENDED`, qua `ctx.appDb` (DBG-2) | db |
| B1 | Regression | toàn bộ acceptance suite hiện có (case 1, 1b, 2, 2b, 3, 4, C1, C2, D1, E1, E2, E3) qua `ctx.superuserDb` | không đổi hành vi — decision logic byte-identical (DBG-3) | db |
| C1 | AuthZ (negative) | role `app` chạy thẳng `SELECT ... FROM tenants ... FOR SHARE` (bypass hàm) | permission denied — bề mặt ghi/khoá thô vẫn đóng (DBG-5) | db |
| C2 | AuthZ (negative) | role `app` chạy thẳng `UPDATE tenants SET status = ...` (bypass hàm) | permission denied — write path vẫn đóng, đúng mục tiêu slice (DBG-5) | db |
| D1 | Failure | migration tail đã vượt `0026` lúc mở worktree | HALT, đo lại số kế tiếp, không đoán | gate |
| E1 | Concurrency | competing writer giữ `FOR UPDATE` trên `tenants` trước, `authorizeTenantAction` (qua hàm) đọc sau | re-check BLOCK tới khi writer resolve — mirror test "tenant-axis FOR SHARE equally load-bearing" đã có, nay qua đường hàm | db |
| E2 | Concurrency | lock từ `resolve_tenant_status_locked` có sống sót qua khỏi return của `authorizeTenantAction`, vào transaction của caller, không | còn sống — mirror test "lock survives past return" đã có; hàm SECURITY DEFINER không tự mở transaction riêng nên lock thuộc transaction gọi nó | db |
| F1 | Migration | file mới trong `packages/db/migrations/` | đúng MỘT file; chứa `SECURITY DEFINER`, `REVOKE ALL ... FROM PUBLIC`, `GRANT EXECUTE ... TO app`; KHÔNG chứa `GRANT` nào khác trên `tenants` (DBG-6) | gate + focused |
| G1 | Security | thực nghiệm sống trên Postgres đang chạy | `FOR SHARE` vẫn đòi hơn `SELECT` — premise của cả slice re-verify được, không chỉ trích dẫn (DBG-7) | focused |
| H1 | Documentation | `packages/db/README.md` | nêu tên `resolve_tenant_status_locked` + access pattern nó đóng, theo đúng convention per-migration hiện có (DBG-8) | manual |
| I1 | Regression | full CI + DB suite | xanh toàn bộ; test count chỉ TĂNG (test app-role + negative-permission mới), không giảm (DBG-9) | canonical |

---

## Open questions trong scope

**0.** Không còn product/security choice nào mở. Shape hàm (SECURITY DEFINER hẹp, `LANGUAGE sql`,
đúng theo pattern `0012`) và phạm vi (chỉ bọc bước đọc `tenants`, không đụng `subscriptions`) đã bị
khoá bởi (a) negative scope của chính AP-40 (trust-safety write-path mechanism chưa tồn tại), (b)
thực nghiệm Postgres thật, và (c) convention codebase đã có sẵn cho đúng lớp vấn đề này. Không có câu
hỏi phase-sau nào cần pin negative scope thêm — write path cho `tenants.status` vẫn đóng nguyên vẹn
sau slice này, y hệt trước.

---

## Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-31
AUTHORITY_SHA: 66ae878572a66c9c97e6f8afefaefb89751ead16
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-db-tenants-authz-grant-security-definer.md
  - docs/autopilot-manifests/db-tenants-authz-grant-security-definer.json
  - packages/db/src/authorization.ts
  - packages/db/migrations/0009_rls_policies_grants.sql
  - packages/db/migrations/0012_auth_functions.sql
SLICE: db-tenants-authz-grant-security-definer
IN_SCOPE: one narrow SECURITY DEFINER function resolve_tenant_status_locked(uuid) wrapping the tenants FOR SHARE read authorizeTenantAction already performs, EXECUTE granted to app only; authorization.ts routed through it; app-role and negative-permission test coverage; README documentation
OUT_OF_SCOPE: any GRANT of SELECT/UPDATE/INSERT/DELETE directly on tenants · any write path for tenants.status · changes to subscriptions grants/RLS (already correct) · changes to authorizeTenantAction's decision logic · wiring authorizeTenantAction into any route/caller · EXECUTE grant to app_worker/readonly · any second migration
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: authorize-tenant-action-core — MERGED ddb69a92aa8b60afb4644acf211dffe2c0091a1b, dep_checks proof pinned in manifest
PRIOR_SLICES: authorize-tenant-action-core
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: re-verify the live migration tail is still 0026 (re-derive the next number if not), then create packages/db/migrations/00NN_resolve_tenant_status_locked.sql with the exact function shape pinned in the manifest's _design_contract, applying it FIRST before touching authorization.ts
REMAINING_BLOCKERS: none
```

### Closure matrix

| # | Gate | Bằng chứng | |
|---|---|---|---|
| 1 | Authority pin theo SHA | `66ae878` (ancestor-of-main) + `TARGET_FILES` liệt kê exact, không glob | PASS |
| 2 | Decision trong scope đã chốt | negative scope của AP-40 (trust-safety write path chưa tồn tại) + thực nghiệm Postgres thật khoá hướng SECURITY DEFINER hẹp, không grant thô | PASS |
| 3 | Scope IN/OUT và owner rõ | manifest `scope` 8 file exact (2 file test literal-bump thêm lúc triển khai) + `negative_scope` 10 mục | PASS |
| 4 | Dependency phân loại đủ | `authorize-tenant-action-core` MERGED, `dep_checks` pin base `55970df`/landed `ddb69a9`/symbol `authorizeTenantAction`, verify được bằng `git show` trực tiếp | PASS |
| 5 | Live schema/code khớp doc | `pg_class`, `information_schema.role_table_grants`, thực nghiệm FOR SHARE — tất cả đo trực tiếp 2026-07-31 trên Postgres 16.14 đang chạy | PASS |
| 6 | Data/auth contract đủ | chữ ký hàm + body pin đúng trong `_design_contract`; `authorization.ts`'s FROM-position function call thay raw SELECT đã pin | PASS |
| 7 | Fail-closed/order đủ | hàm CHỈ đọc, không write path; lock semantics giữ nguyên (SECURITY DEFINER không tự mở transaction) | PASS |
| 8 | Open question trong scope | 0 | PASS |
| 9 | Acceptance matrix có expected | 12 hàng, mỗi hàng có input · precondition · expected · layer, bao gồm 2 hàng negative-permission (C1/C2) chứng minh bề mặt ghi vẫn đóng | PASS |
| 10 | Migration/security/rollback pin | đúng 1 migration mới, expand-only, không đổi `0000`–`0026`; rollback = revert thuần vì chưa có caller sản xuất nào phụ thuộc; security round bắt buộc | PASS |
| 11 | First slice hard deps merged | `authorize-tenant-action-core` đã merge, proof pin đủ | PASS |
| 12 | Implementation handoff sẵn sàng | slice doc + manifest (verification.focused đã chạy thật 7 lệnh, round-trip JSON) + backlog entry + launcher `ap-43` | PASS |

**Điều verdict này KHÔNG chứng minh.** Nó không nói có caller sản xuất nào gọi `authorizeTenantAction`
— vẫn chưa có, slice này chỉ mở đường gọi được. Nó không phải bằng chứng runtime: `CODE_READY` nghĩa
là mở worktree được, không phải `IMPLEMENTED`.

---

## Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
| 31/07/2026 | v0.1 | Author manifest + slice doc từ backlog block đã mở sẵn (30/07). Đo lại cả hai tiền đề backlog note yêu cầu re-verify thay vì tin: grant grep mở rộng ra toàn bộ 27 migration (không chỉ 2 file), và privilege requirement của `FOR SHARE` xác nhận bằng thực nghiệm trực tiếp trên Postgres 16.14 đang chạy (tạo role thật, không suy từ tài liệu). Phát hiện thêm không có trong backlog note gốc: `subscriptions` đã có đủ grant cho `app` (không cùng cảnh ngộ với `tenants`) và `tenants` không có RLS — cả hai thu hẹp đúng phạm vi sửa chữa xuống một hàm duy nhất bọc một bảng duy nhất. `verification.focused` command đầu tiên là một thực nghiệm Postgres sống (tạo role scratch, test, rollback vô điều kiện) chứ không phải trích dẫn — đã chạy qua `spawnSync` y hệt gate, round-trip qua JSON, trước khi commit. |
| 31/07/2026 | v0.2 | Implementation. Registration hit two stale `INFLIGHT.md` entries (`authorize-tenant-action-core`, `db-undeclared-check-constraints-schema-mirror`) blocking `DEP_MISSING`/would-be `SCOPE_COLLISION` — both already merged on `main` but never closed via `ap-finish.sh` because of a real bug in its `registry_status()` (unconditional accumulator reset, only the LAST `INFLIGHT.md` block resolved correctly); fixed upstream across kit v20–v24, closed with `--squash-verified`/`--authorized-close`, this slice rebased through each sync with net-empty diffs each time. Scope gap found after implementation: adding migration 0027 bumps two hardcoded `MIGRATION_COUNT`/tail-filename literals in `packages/db/src/migrate.test.ts` and `rls-invariants.test.ts` — the same class of fix `db-undeclared-check-constraints-schema-mirror` needed and correctly scoped for; this slice's authored scope omitted both. Corrected via close (`--authorized-close`) + fresh register on the same commits, not by editing scope post-registration. Separately, unrelated to this slice: `ap-merge.sh` step 8b reconciles `docs/autopilot-backlog.md` after a merge but never clears `.autopilot/INFLIGHT.md` — the same staleness class as the `registry_status()` bug, in a different file; owner is tracking it as its own backlog item, not fixed here. |
