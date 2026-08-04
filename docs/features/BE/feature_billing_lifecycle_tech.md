# Feature: Host Billing & Tenant Lifecycle — Backend Tech Spec

> **Canonical phase:** P5  
> **Version:** 2.10 · 2026-08-03
> **Status:** Reviewed  
> **Implementation:** Not started — bảng `subscriptions`/`billing_*` có sẵn; capability/availability resolver, provider wiring và lifecycle runtime chưa build · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)
> **Product spec:** `../feature_billing_lifecycle.md`  
> **References:** `../../standards/business-rules.md` · `../../standards/decisions.md` DD-29/DD-37/DD-40/DD-51/**DD-91** · `../../research/auto-debt-reconciliation-regional-availability-2026-07-27.md`

> **Cập nhật v2.4 (DD-40 ✅ + DD-37 ✅, 2026-07-10):** §4b capability registry — free = `payment_mark_manual` (tiền mặt/CK thủ công) + `reminders_manual`; host_pro thêm `payment_reconcile_auto` + `reminders_auto` + `assistant_ai_kb` + `crm_dashboard`. Bot kênh free = **Zalo + Facebook Messenger** (bỏ Telegram — DD-37).

---

## 1. Tổng quan triển khai

```text
Tenant creation → free active immediately OR paid plan trial → Daily lifecycle job
    → Issue invoice → Platform billing webhook → Match → Extend period
    → Due transitions: active → past_due → suspended → cancelled
    → Central authorizeTenantAction(tx, tenantId, actionClass)
```

Billing ledger **separate schema/table set** from player ledger. Central `authorizeTenantAction` defines allowed matrix — adapters cannot implement inconsistent suspension rules. It takes **tenant context, not a pre-resolved status** — callers never read `tenants.status`/`subscriptions.status` themselves and pass a scalar in; the function owns reading both columns and resolving the fail-closed union itself (§3 Status Authority). This keeps the "adapters cannot implement inconsistent suspension rules" guarantee real: a caller that pre-resolves only one column would silently miss the other axis.

---

## 2. Database Schema + Edge Cases (BE)

### Schema

```sql
CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key text NOT NULL CHECK (plan_key IN ('free','host_pro')),  -- DD-29 target (thay DD-03 4-tier)
  -- ✅ Migration authored + verified 2026-08-04 (plans-dd29-capability-registry slice):
  --   packages/db/migrations/0028_dd29_capability_registry_expand.sql (expand) +
  --   0029_dd29_capability_registry_contract.sql (contract) move plans_key_chk to this
  --   exact 2-tier CHECK; packages/db/schema.ts's keyChk predicate updated to match.
  --   Verified against real Postgres in this slice's own worktree (guards, upgrade
  --   path and contract self-guard all pass) — pending review/merge to `main`. Remove
  --   this note once merged and `main` itself reflects the 2-tier CHECK live.
  version integer NOT NULL,
  price integer NOT NULL,
  currency text NOT NULL DEFAULT 'VND',
  interval text NOT NULL DEFAULT 'monthly',
  limits jsonb NOT NULL DEFAULT '{}',
  entitlements jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_key, version)
);

CREATE TABLE subscriptions (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  plan_key text NOT NULL,
  plan_version integer NOT NULL,
  status text NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing','active','past_due','suspended','cancelled')),
  -- free (price=0): tạo row với status='active', trial_end/grace_end = NULL, period_end xa/null;
  --   KHÔNG sinh invoice; lifecycle job bỏ qua (xem §4 + edge #17). Không có trạng thái riêng cho free —
  --   phân biệt bằng plans.price=0. Free rời 'active' chỉ khi đổi plan / cancel / suspend-vì-abuse.
  -- DD-29: bỏ selected_extra_channel (không còn plus_channel/tính-theo-kênh); kênh & tính năng do capability flags quyết định.
  trial_end timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  grace_end timestamptz,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed v1 (DD-29). entitlements.capabilities = cờ tính năng (config-driven — xem "Capability registry").
-- Đổi tính năng nào free/pro = sửa seed/entitlements, KHÔNG sửa code (gate đọc hasCapability(tenant,key)).
INSERT INTO plans (plan_key, version, price, limits, entitlements) VALUES
  ('free', 1, 0,
     '{"max_clubs": 2, "ai_monthly_question_cap": 0}',
     '{"capabilities": {"web_app": true, "bot_zalo": true, "bot_messenger": true,
        "session_management": true, "discovery_marketplace": true,
        "payment_mark_manual": true, "payment_reconcile_auto": false,
        "reminders_manual": true, "reminders_auto": false,
        "assistant_ai_kb": false, "crm_dashboard": false}}'),
  ('host_pro', 1, 250000,
     '{"max_clubs": null, "ai_monthly_question_cap": 2000}',
     '{"capabilities": {"web_app": true, "bot_zalo": true, "bot_messenger": true,
        "session_management": true, "discovery_marketplace": true,
        "payment_mark_manual": true, "payment_reconcile_auto": true,
        "reminders_manual": true, "reminders_auto": true,
        "assistant_ai_kb": true, "crm_dashboard": true}}');
-- DD-37: bỏ bot_telegram; kênh free = Zalo + Messenger. bot_messenger=true nhưng
--   vẫn gated bởi App Review Messenger (DD-37/P2.5) bất kể flag.
-- DD-40: payment_mark_manual (mark-paid thủ công tiền mặt/CK) = mọi tier; auto = pro.

CREATE TABLE subscription_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  invoice_code text NOT NULL UNIQUE,
  amount_due integer NOT NULL,
  amount_paid integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','partial','overdue','cancelled')),
  due_at timestamptz NOT NULL,
  paid_at timestamptz,
  period_key text NOT NULL,
  UNIQUE (tenant_id, period_key)
);

CREATE TABLE billing_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  external_id text NOT NULL,
  amount integer NOT NULL,
  content_enc text,
  status text NOT NULL DEFAULT 'received',
  UNIQUE (provider, external_id)
);

CREATE TABLE billing_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES billing_transactions(id),
  invoice_id uuid NOT NULL REFERENCES subscription_invoices(id),
  amount integer NOT NULL
);

CREATE TABLE billing_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_id uuid NOT NULL,
  ticket_ref text NOT NULL,
  reason text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### Migration & Rollback

> Grep live `packages/db/migrations/` ngày 2026-07-27: `0000`–`0024` đã merge (25 migrations; tail `0024_public_visibility_capacity_check.sql`). **Cả 6 bảng** `plans` · `subscriptions` · `subscription_invoices` · `billing_transactions` · `billing_allocations` · `billing_overrides` **đã tồn tại từ `0007_billing.sql`** — DDL trên là baseline để đọc + target contract, **reuse, không recreate**. Mọi delta của slice billing phải dùng migration monotonic mới sau `0024`; không sửa migration đã apply.

- **Migration (delta doc-DDL vs live `0007` → monotonic migration(s) sau tail hiện tại, KHÔNG sửa `0007`;
  the `plans.plan_key` delta below specifically needed an expand→contract PAIR, not the single file this
  heading's general phrasing implies for a typical billing delta):**
  - `plans.plan_key` CHECK `('free','host_pro')` + seed v1 (DD-29) — ✅ **authored + verified 2026-08-04**
    (`plans-dd29-capability-registry` slice), landed as TWO files:
    `packages/db/migrations/0028_dd29_capability_registry_expand.sql` (expand — widen CHECK, seed,
    redefine `tenant_provision()`, and repoint the `free_web` subscriptions row, the ONLY tier this
    migration ever auto-migrates — a fail-closed guard unconditionally ABORTS the whole transaction
    instead if any subscriptions row still references `telegram`/`plus_channel`/`all_channels`,
    regardless of status, since the UPDATE would otherwise irreversibly lose which of those three
    tiers the row held) + `0029_dd29_capability_registry_contract.sql` (contract — self-guarding
    narrow). Pending review/merge to `main`; see the PENDING MIGRATION note in the DDL above for
    exact status.
  - **Still pending, NOT part of the above slice:** `period_start`/`period_end` nullable cho free
    (DD-51 — live đang NOT NULL); `subscription_invoices.paid_at` (DD-51 — refund window đọc canonical
    `paid_at`; live chưa có cột); `billing_overrides.ticket_ref NOT NULL` (DD-51 — live chưa có cột).
    `subscriptions.selected_extra_channel` column removal is ALSO not part of the above slice — note
    this doc's own DDL comment above attributes it to DD-29 while an earlier version of this bullet
    called it DD-51; that classification inconsistency predates this slice and is not resolved here,
    but either way, removing the column is out of this slice's scope regardless of which decision owns
    it. All of the above track under the separate, currently `idea`-status `feature-billing-lifecycle`
    backlog task — the DD-29 slice above
    explicitly does not touch them (see its manifest `negative_scope`), even though this section
    bundles them narratively with the DD-29 delta under one heading.
- **Rollback:**

| Bước | Hành động | An toàn? |
|------|-----------|----------|
| 1 | Disable billing routes (`/api/billing*`, `/internal/billing/*`) + daily lifecycle job + billing webhook worker | ✅ |
| 2a | DD-29 pair revert (`0028`+`0029`, once landed): revert **ONLY** `tenant_provision()`, the `plans_key_chk` CHECK, and the `plans` seed rows — conditional on no new-key row created downstream since, per each migration's own header | ✅ Có điều kiện — see each file's own rollback note |
| 2b | DD-51 columns revert (separate, future slice — not yet landed): revert **ONLY** those additive/alter objects, independently of 2a | ✅ Có điều kiện — chốt khi slice đó thực thi |
| 3 | Drop baseline 6 bảng billing của `0007` | ❌ NEVER — migration đã apply trên main, có thể chứa billing data thật |

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Data Integrity | Billing mixed with player ledger | ❌ NEVER — separate tables/schema |
| 2 | Concurrency | Duplicate billing webhook | `UNIQUE(provider, external_id)` — idempotent |
| 3 | Concurrency | Duplicate lifecycle job | Row/version lock — no double transition |
| 4 | Financial | Partial/overpayment | Billing review queue / manual review (KHÔNG có bảng `billing_credits`; đối chiếu qua `billing_allocations`) — NOT allocated to player |
| 5 | Data Integrity | Double period extension | `UNIQUE(tenant_id, period_key)` — exactly once |
| 6 | Data Integrity | Retroactive price change | ❌ NEVER — plan version immutable |
| 7 | Data Integrity | Clock/timezone billing date | UTC billing dates only |
| 8 | Security | Suspended tenant publish new sessions | ❌ Block `TENANT_SUSPENDED` — `authorizeTenantAction(tx, tenantId, 'publish_new_sessions')`; status = fail-closed union `tenants.status`/`subscriptions.status` (§3 Status Authority) |
| 9 | Security | Suspended tenant CK ingest | ✅ Allow — safety path |
| 10 | Data Integrity | Reactivation replay jobs | Version check — no duplicate reminders/projectors |
| 11 | Security | Override without expiry | ❌ Must have expiry — auto-expire enforced |
| 12 | Cross-Feature | Owner lost access | Support ticket + audit — manual recovery |
| 13 | Entitlement | Capability không có trong plan (vd `payment_reconcile_auto` ở free) | Block với `PLAN_UPGRADE_REQUIRED`; **không** ảnh hưởng payment ingest (CK vẫn lưu, chỉ chặn auto-settle/auto-notify) |
| 14 | Entitlement | Toggle 1 capability free↔pro | Sửa `plans.entitlements.capabilities` (config), gate đọc `hasCapability(tenant,key)` — KHÔNG hardcode theo `plan_key` |
| 15 | Data Integrity | `free` (price=0) routed through trial/past_due/suspended | ❌ NEVER — created `status='active'`, no invoice; lifecycle job filters `WHERE p.price > 0`. Free chỉ suspend qua đường ToS/abuse, không qua non-payment |
| 16 | Data Integrity | Invoice issued for price=0 plan | ❌ NEVER — `IssueInvoice` skip khi `plan.price = 0` |
| 17 | Entitlement | Downgrade/cancel paid → `free` | Trial unpaid: immediate free. Paid cancel >7d: keep entitlement to period end then free. Refund eligible ≤7d: full refund path. Always clear free period fields; no hidden retroactive refund |
| 18 | Financial | Refund window cannot prove `paid_at` | Fail-closed manual review; never treat as within window or zero-risk |
| 19 | Security | Override missing/overlong ticket fields | Reject unless PlatformAdmin + ticket_ref + reason + expires_at≤7d; auto-expire idempotently |
| 20 | Billing safety | Tenant suspended receives player CK | Ingest ON; auto-settle/auto-notify OFF regardless plan capability |
| 21 | Availability | Host Pro có `payment_reconcile_auto=true` nhưng provider/bank/market/currency/consent chưa khả dụng | Trả trạng thái unavailable ổn định (exact field/code chốt ở build slice) + manual fallback; **không** auto-settle/auto-notify, không suy entitlement thành availability và không chặn mark-paid thủ công |

---

## 3. API Contract

### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET | /api/billing | TenantOwner | Billing overview |
| GET | /api/billing/invoices | TenantOwner | Invoice list |
| POST | /api/billing/cancel | TenantOwner | Cancel subscription |
| POST | /internal/billing/webhook | Platform (webhook) | Payment ingest |
| POST | /internal/billing/override | PlatformAdmin | Manual override |

### Request/Response Examples

> DTO minh hoạ theo contract đã pin; field name cụ thể chốt ở build slice; envelope DD-60 (`../../standards/api-reference-convention.md`).

**GET `/api/billing`** — billing overview (field derive từ `subscriptions` §2):

```json
{
  "data": { "subscription": { "planKey": "host_pro", "status": "active", "periodEnd": "…" } },
  "error": null,
  "meta": { "requestId": "req_…" }
}
```

**Capability bị chặn theo plan** (edge #13, §4b — HTTP mapping minh hoạ):

```json
{ "data": null, "error": { "code": "PLAN_UPGRADE_REQUIRED", "message": "…", "statusCode": 403 }, "meta": { "requestId": "req_…" } }
```

**POST `/internal/billing/webhook`** — duplicate `(provider, external_id)` (edge #2): idempotent, trả kết quả cũ, **không** tạo transaction/allocation thứ hai.

### Idempotency

| Endpoint | Idempotent? | Key |
|----------|-------------|-----|
| GET `/api/billing` · `/api/billing/invoices` | ✅ | Read-only |
| POST `/api/billing/cancel` | ⬜ chưa pin — chốt ở build slice | — |
| POST `/internal/billing/webhook` | ✅ | `UNIQUE (provider, external_id)` (§2, edge #2) — duplicate không tạo transaction/job thứ hai |
| POST `/internal/billing/override` | ⬜ chưa pin — chốt ở build slice (auto-expire đã idempotent — edge #19) | — |
| Daily lifecycle job (system) | ✅ | Row/version lock (edge #3) + `UNIQUE (tenant_id, period_key)` — exactly-once transition/invoice (edge #5) |

### Suspended Action Matrix

| Action Class | Status: active | past_due | suspended |
|-------------|:---:|:---:|:---:|
| Admin mutation | ✅ | ✅ | ❌ |
| Integration changes | ✅ | ✅ | ❌ |
| Publish new sessions | ✅ | ✅ | ❌ |
| Player CK ingest | ✅ | ✅ | ✅ |
| Read-only queries | ✅ | ✅ | ✅ |
| System safety | ✅ | ✅ | ✅ |

### Status Authority (`authorizeTenantAction`)

> Resolves the status-authority gap `feature_session_management_tech.md` §4 publish billing note named as a **hard dependency** (billing owns; session slice only cross-refs — the status-authority CONTRACT and decision table are not edited here. A later, unrelated slice, `docs-billing-authz-signature-reconcile`, did touch that file's §4 step 6 once, prose-only, to sync a stale `authorizeTenantAction` call notation to the signature already correct here — no contract/algorithm change there either).

> **✅ Founder-ratified (2026-07-24):** the union direction below (fail-closed 2-step; tenant axis wins including anomaly values; subscription axis blocks on `suspended`/`cancelled`/missing row, allows `trialing`/`active`/`past_due`) is confirmed as the authoritative contract — this review/merge is the ratification. `feature_session_management_tech.md` §4's named hard dependency `docs-billing-publish-suspension-authority` is content-resolved by this contract; that file's decision-table dependency is not edited by THIS ratification (per scope) — its own dependency-status wording is a follow-up for whoever merges next. (A later, unrelated slice, `docs-billing-authz-signature-reconcile`, did sync one stale call notation in that file's §4 step 6 — prose-only, no contract change.)

`suspended` sống trên **hai cột vật lý**, cùng CHECK `('trialing','active','past_due','suspended','cancelled')` nhưng là **hai trục khác nhau** — không phải một khái niệm lặp lại hai lần:

| Cột | Trục | Write path hiện tại (live) |
|---|---|---|
| `subscriptions.status` (`0007`) | **Non-payment billing lifecycle** (trial/grace/quá hạn) — nguồn của Suspended Action Matrix trên. | Daily Lifecycle Job (§4) + billing webhook match — đây đúng là cột matrix mô tả. |
| `tenants.status` (`0002`) | **Tenant-root hard override** (abuse/ToS) — độc lập thanh toán. | **Chưa có write path nào ngoài** `tenant_provision` (`0012:256`) — hard-set `'active'` lúc tạo tenant, cùng transaction với `subscriptions` (free plan); mọi seed/test fixture khác cũng chỉ từng insert `'active'` explicit. **Cột có `DEFAULT 'trialing'`** (`0002_tenants_core.sql:15`) mà KHÔNG write path nào hiện dùng — `tenant_provision` luôn set `status` tường minh, không rơi vào default. Chưa tồn tại PlatformAdmin/trust-safety mutation nào ghi (hay xoá) cột này; contract dưới đây pin hành vi TRƯỚC khi mechanism đó build, để gate publish không phải sửa lại lúc nó land. **Set ⊥ clear là một cặp chưa xây** — khi trust-safety mechanism đó land, nó phải sở hữu CẢ set lẫn clear; một sự kiện trục billing (payment nhận được, `ApplyOverride`) **không được** ngầm định clear cột này (xem cảnh báo ở `feature_billing_lifecycle.md` §4 Lifecycle State Machine). |

**`authorizeTenantAction(tx, tenantId, actionClass)` resolve đúng MỘT `status` hiệu lực trước khi tra Suspended Action Matrix — FAIL-CLOSED, hai bước, trục tenant xét TRƯỚC:**

```text
step 1 (trục tenant-root — hard override, xét trước, thắng vô điều kiện):
  nếu tenants.status NOT IN ('active', 'trialing'):  effective_status = 'suspended'
    → fail-closed trên cả cột, nhưng CHẤP NHẬN 'trialing' vì đó là DEFAULT của chính cột này
      (`0002_tenants_core.sql:15`) — một insert path TƯƠNG LAI dựa vào default (không set status
      tường minh như tenant_provision hiện làm) không được tự khoá publish của một tenant hoàn
      toàn bình thường chỉ vì nó rơi vào default. 'active'/'trialing' là hai giá trị PLAUSIBLE cho
      một tenant mới/bình thường; `past_due`/`cancelled` thì KHÔNG (không path/default nào sinh ra
      chúng ở trục này) → vẫn khoá như anomaly, xem case 1b.
  ngược lại (tenants.status IN ('active','trialing')) → sang step 2

step 2 (trục billing/subscriptions — chỉ xét khi trục tenant đã rõ 'active' HOẶC 'trialing', tức step 1 không khoá):
  thiếu row `subscriptions`               → effective_status = 'suspended'  (unprovable ⇒ fail-closed)
  subscriptions.status IN ('suspended','cancelled') → effective_status = 'suspended'  (billing terminal)
  subscriptions.status IN ('trialing','active','past_due') → effective_status = subscriptions.status  (allow)
```

Decision table dưới đây không còn case chưa định nghĩa (TBD) **về mặt cơ chế** cho `publish_new_sessions` (và mọi action class khác gọi qua cùng choke-point) — **founder-ratified 2026-07-24, G1 Decision cho contract này giờ `PASS`** (xem ghi chú ✅ trên). Không tự claim `CODE_READY` cho toàn bộ publish BUILD slice: dependency thứ hai `docs-prd-flow2-publish-projection-reconcile` + implementation artifacts (task list, tests thật, migration) vẫn ngoài scope của slice docs-only này:

| # | `tenants.status` | `subscriptions.status` | `effective_status` | Publish new sessions |
|---|---|---|---|---|
| 1 | `suspended` (giá trị thiết kế) | bất kỳ (kể cả thiếu row) | `suspended` | ❌ `TENANT_SUSPENDED` — trục tenant thắng ở step 1, không cần xét step 2 |
| 1b | `past_due` / `cancelled` (KHÔNG write path/default nào tạo ra ở trục này, thuần anomaly) | bất kỳ | `suspended` | ❌ `TENANT_SUSPENDED` — fail-closed đồng nhất với case 1: step 1 chỉ coi `'active'`/`'trialing'` (giá trị thật sự có thể xuất hiện — set tường minh hoặc rơi vào `DEFAULT`) là rõ ràng ổn; `past_due`/`cancelled` không có cách nào hợp lệ xuất hiện ở trục tenant-root nên vẫn khoá như anomaly |
| 2 | `active` hoặc `trialing` | `suspended` | `suspended` | ❌ `TENANT_SUSPENDED` — trục billing tự đủ để khoá ở step 2 |
| 2b | `active` hoặc `trialing` | `cancelled` | `suspended` | ❌ `TENANT_SUSPENDED` — **không** treat như active/past_due: state machine có `suspended → cancelled` (owner/admin cancel một tenant ĐANG suspended, §4); cho `cancelled` publish sẽ mở lối tắt né suspend mà không cần trả nợ/reactivate. `cancelled` luôn terminal — khác nhánh "cancel >7d" vẫn giữ `status='active'` suốt kỳ còn lại (§4 Refund/cancel), nên nhánh đó KHÔNG đi qua case này |
| 3 | `active` hoặc `trialing` | `trialing` / `active` / `past_due` | = giá trị đó | ✅ Allow — matrix trên chỉ liệt kê cột `active`/`past_due` vì hai cột đó **giống hệt nhau ở mọi hàng**; `trialing` theo cùng pattern (đứng trước `active`, còn tốt hơn `past_due`) |
| 4 | `active` hoặc `trialing` | thiếu row (tenant chưa có `subscriptions`) | `suspended` (fail-closed) | ❌ `TENANT_SUSPENDED` — **không** phải "chưa vào billing nên bỏ qua": `tenant_provision` tạo `subscriptions` cùng transaction với MỌI tenant (kể cả personal tenant tương lai DD-46 — "tái dùng core… + free sub"), nên thiếu row trên tenant đã tồn tại = provisioning dở dang/data anomaly, không phải trạng thái hợp lệ. Không đủ bằng chứng tenant đang tốt → khoá (cùng nguyên tắc DD-51 fail-closed cho `paid_at` không chứng minh được, không phải coi-như-0/an-toàn) |

Hai cột **"mismatch"** (vd `tenants.status='suspended'` nhưng `subscriptions.status='active'`, hoặc ngược lại) không phải trạng thái mơ hồ cần xử lý riêng — cấu trúc 2-step đã resolve theo thứ tự cố định: step 1 (trục tenant) luôn xét trước và thắng vô điều kiện nếu nó khoá; step 2 (trục billing) chỉ chạy khi step 1 đã rõ `'active'`/`'trialing'`. Không có nhánh "ambiguous" cần đoán.

Case 1b (`tenants.status ∈ {past_due, cancelled}`) và case 4 (thiếu `subscriptions` row) hiện **không reachable** qua write path sống hôm nay (`tenant_provision` luôn set `tenants.status='active'` tường minh + tạo `subscriptions` cùng transaction — default `'trialing'` của cột `tenants.status` không bị rơi vào, nhưng NẾU một path tương lai rơi vào đó thì case 3 vẫn allow, không phải case 1b). Giữ case 1b/4 là **fail-closed** (không phải TBD chưa nghĩ tới, và không phải allow-by-default) cho code path/dữ liệu tương lai bất thường; cùng bucket `suspended`, không cần error code riêng.

`authorizeTenantAction` là **choke-point duy nhất** đọc cả hai cột; adapter/session slice không tự đọc `tenants.status`/`subscriptions.status`, không tự resolve step 1/2, và không tự truyền `status` đã resolve sẵn vào (xem `feature_session_management_tech.md` §4 cross-ref) — matrix + status authority ở đây là single source of truth, adapters không tự nới.

**Concurrency (bắt buộc cho mọi mutating action class — `publish_new_sessions`, admin mutation, integration changes; KHÔNG áp cho CK ingest/read-only/system safety vì các nhánh đó luôn ✅ bất kể status):** `authorizeTenantAction` KHÔNG phải một advisory point-in-time mà caller check-một-lần-sớm-rồi-quên. Daily Lifecycle Job (§4) claim `subscriptions` bằng `FOR UPDATE SKIP LOCKED` khi transition `past_due → suspended` — nếu caller check billing xong rồi mutate session ở một transaction/thời điểm sau đó KHÔNG re-validate, tồn tại race: lifecycle job suspend commit **giữa** lúc check và lúc mutation commit → session vẫn publish được cho tenant vừa suspend. Với mutating action class: check phải nằm **trong cùng transaction** với mutation, đủ gần commit để một suspend-transition concurrent trên `subscriptions`/`tenants` hoặc serialize trước nó (caller thấy `suspended` mới) hoặc bị block bởi lock cho tới khi caller's transaction resolve. Một check sớm-rồi-mutate-muộn-không-re-validate **không đủ** cho mutating class. **Không resolve ở đây:** liệu thứ tự hiện tại của `feature_session_management_tech.md` §4 publish algorithm (check billing tại step 1, TRƯỚC khi lock session row ở step 2, mutation ở step 6) đã thoả contract này hay cần thêm một re-check/lock — đó là chi tiết transaction của session slice, KHÔNG sửa ở đây (file đó không edit); pin làm **follow-up cần xác nhận riêng** (`docs-session-publish-concurrency-recheck`) trước khi publish thực sự code-ready, cạnh 2 hard dependency đã có ở đó (billing-authority — chính slice này; projection-timing). Test #36 pin acceptance criterion cho contract này (billing owns; session slice phải tự chứng minh nó thoả khi build).

**`TENANT_SUSPENDED` giờ có hai root cause khác nhau — reuse cùng code, KHÔNG tự tách code mới (theo đúng discipline slice này):** case 1/1b (`tenants.status`) là abuse/ToS hard override; case 2/2b/4 (`subscriptions.status`/missing row) là non-payment billing. Canonical error code/message ("Club đang tạm ngưng" — owned bởi `feature_tenant_routing_authz_tech.md`) không phân biệt hai nguyên nhân, và **trả tiền không sửa được case 1/1b** (xem cảnh báo cross-axis ở `feature_billing_lifecycle.md` §4). Owner-facing copy ("Reactivation" — §3 Screens & States) **không rẽ nhánh theo nguyên nhân** — billing overview API chỉ trả `subscription.status`, không có nguồn dữ liệu nào để UI phân biệt case nào đang áp; copy luôn hiển thị cả payment CTA lẫn "liên hệ hỗ trợ nếu nhầm lẫn", không tuyên bố tuyệt đối "trả tiền là xong". **Phân biệt rõ nguyên nhân cho owner** (server-side disposition field riêng cho hai root cause) là **scope expansion chưa chốt** — không resolve ở đây (không invent field/code mới, không sửa `feature_tenant_routing_authz_tech.md`); flag làm follow-up sản phẩm khi trust-safety mechanism thật sự được build (hiện chưa có write path nào tạo case 1, xem bảng cột trên).

---

## 4. Chi tiết triển khai

### Lifecycle Commands

`IssueInvoice`, `IngestBillingPayment`, `AllocateInvoice`, `AdvanceLifecycle`, `ApplyOverride`, `ReactivateTenant`, `CancelSubscription`.

### Daily Lifecycle Job

```text
Cron (daily) → Claim due subscriptions JOIN plans WHERE plans.price > 0 FOR UPDATE SKIP LOCKED
    → trialing: at trial_end-2d emit one deduped reminder
    → trialing unpaid at trial_end: switch plan/version to free + active immediately (no past_due)
    → active paid period expired/unpaid invoice: past_due + grace_end=due_at+7d
    → past_due after grace_end: suspended
    → expire billing_overrides where expires_at<=now()
    → Send owner notices (outbox) → COMMIT
```

> **free bỏ qua hoàn toàn:** join `plans.price > 0` loại mọi subscription 0đ khỏi nhánh `period expired → past_due → suspended`. `IssueInvoice` cũng skip khi `plan.price = 0`. Free chỉ đổi trạng thái qua `CancelSubscription`, đổi plan, hoặc `ApplyOverride`/suspend vì abuse (đường riêng, không phải lifecycle non-payment).

### Refund/cancel + override contract (DD-51)

- Refund eligibility reads canonical invoice `paid_at`; request at `paid_at + 7 days` is eligible, after that is not. NULL/unprovable `paid_at` fails closed to manual review.
- Eligible refund is full invoice amount; actual money movement remains external/provider-specific and must be evidenced/audited before marking complete.
- Cancel after the window sets cancel-at-period-end; entitlement remains until period end, then subscription becomes free active with NULL period fields.
- `ApplyOverride` derives actor from PlatformAdmin auth, requires `ticket_ref`, reason and expiry no more than 7 calendar days, records before/after, and auto-expires. It never changes invoice `paid_at` or refund eligibility.

### Billing Webhook Ingest

```text
Webhook → Durable ingest: billing_transaction + job COMMIT before ACK
    → Parser: strict invoice code match
    → Ambiguous/partial/overpay → billing review queue
    → Matched → allocate + extend period (exactly once)
```

### Caching Strategy

| Data | Cache? | TTL | Invalidation |
|------|--------|-----|-------------|
| Tenant/subscription status / `authorizeTenantAction` input | ❌ | — | Đường authz — đọc live cả `tenants.status` và `subscriptions.status`, fail-closed; matrix + Status Authority §3 áp thống nhất, adapter không tự nới |
| Billing ledger (invoices/transactions/allocations) | ❌ | — | Tiền — mọi transition dưới row/version lock (§4, edge #3/#5) |
| Capability flags (`plans.entitlements`) | ❌ | — | Gate đọc `hasCapability` live (§4b); caching nếu có là enablement riêng — fail-closed khi chưa pin |

### Security Checklist (template v2.33 — map về section đã pin)

| Mục | Trả lời trong spec |
|-----|---------------------|
| Authorization/ownership | §3: TenantOwner/PlatformAdmin per endpoint; `authorizeTenantAction` matrix trung tâm (§1/§3) + edge #8/#11/#19 (override chỉ PlatformAdmin, bắt buộc `ticket_ref`/expiry) |
| Injection/validation | §4: webhook parser strict invoice code match; ambiguous/partial/overpay → billing review queue, không auto-guess (edge #4); CHECK/UNIQUE constraints §2 |
| Secret & log redaction | §2: `billing_transactions.content_enc` at-rest; chi tiết log redaction theo `feature_security_operations_tech.md` |
| Webhook signature + replay | §3/§4: `/internal/billing/webhook` durable ingest COMMIT trước ACK + dedup `UNIQUE (provider, external_id)`; signature scheme chưa pin trong doc này — chốt ở build slice (pattern tham chiếu: `feature_payment_reconcile_tech.md` §3) |
| Idempotency | §3 bảng Idempotency (webhook UNIQUE, lifecycle row/version lock, `UNIQUE (tenant_id, period_key)`) |
| Data retention/xoá | Chưa pin trong doc này — theo `feature_security_operations_tech.md` |

---

## 4b. Capability registry (config-driven — DD-29)

Gate tính năng đọc `hasCapability(tenant, key)` → tra `plans.entitlements.capabilities[key]` của plan hiện hành. **Đổi tính năng nào ở free/pro = sửa seed/`entitlements` (config), KHÔNG sửa code.** `plan_key` chỉ là nhãn; quyền do capability flags quyết định.

Capability registry là **commercial entitlement**, không phải availability registry. Với `payment_reconcile_auto`, sau `hasCapability=true` còn phải qua một resolver riêng, fail-closed, theo ít nhất `provider × bank × market × currency × consent/connection state`. Research khu vực 2026-07-27 chỉ là **decision input**: authority hiện tại chỉ pin đường provider `sepay|apipay` cho rail Việt Nam; webhook→settle→notify và abstraction provider/market chưa có runtime. Vì vậy `payment_reconcile_auto=true` không được render thành “đã dùng được” nếu resolver chưa chứng minh availability. Mark-paid thủ công (`payment_mark_manual`) vẫn khả dụng toàn cầu và độc lập với resolver này.

| Capability key | Free | Pro | Ghi chú |
|---|:--:|:--:|---|
| `web_app` | ✓ | ✓ | Web app + dashboard |
| `bot_zalo` · `bot_messenger` | ✓ | ✓ | Kết nối bot kênh phase-1 (miễn phí — DD-29/DD-37). `bot_messenger` vẫn **gated bởi App Review Messenger** (DD-37/P2.5). *(Telegram đã bỏ — DD-37.)* |
| `session_management` | ✓ | ✓ | Kèo/roster/waitlist/join |
| `discovery_marketplace` | ✓ | ✓ | Player-side (cross-club) |
| `payment_mark_manual` | ✓ | ✓ | **Mark-paid thủ công** tiền mặt/CK (tap/multi-select), audit, idempotent, áp DD-25 confirm (DD-40) |
| `payment_reconcile_auto` | ✗ | ✓ | Entitlement thương mại cho **auto-settle** + **auto-notify**; chỉ chạy khi availability resolver cũng PASS. Authority provider hiện chỉ `sepay|apipay`/Việt Nam và chưa có runtime |
| `reminders_manual` | ✓ | ✓ | Host bấm nhắc thủ công |
| `reminders_auto` | ✗ | ✓ | Nhắc nợ / pre-post-session **tự động theo lịch** (2h→24h→…) |
| `assistant_ai_kb` | ✗ | ✓ | Club Assistant + KB (DD-16..28) |
| `crm_dashboard` | ✗ | ✓ | Analytics nâng cao (CRM_DASHBOARD_BRD) |

**Limits** (`plans.limits`): `max_clubs` (free 2 · pro null=∞), `ai_monthly_question_cap` (free 0 · pro 2000). Chỉnh tự do theo config.

**Bất biến gate:** (a) **CK ingest LUÔN chạy** bất kể plan (safety, BL-PAY-1) — capability chỉ gate hành vi **auto-settle/auto-notify**, không gate việc lưu giao dịch; (b) thiếu entitlement trả `PLAN_UPGRADE_REQUIRED`, không làm mất dữ liệu; (c) có entitlement nhưng thiếu availability trả trạng thái unavailable ổn định, không giả làm upgrade error và không fail-open; (d) deterministic requester-only `/pay` theo DD-91 không cần `assistant_ai_kb`, không gọi LLM và không ghi chat/payment-result state riêng.

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Trial start (paid plan) | New tenant, plan trả phí | trialing + dates set |
| 1b | free start | New tenant, plan `free` | `active` ngay, không trial, không invoice |
| 1c | free never past_due | free qua nhiều chu kỳ, không payment | vẫn `active`; lifecycle job bỏ qua; 0 invoice |
| 2 | Trial → active | Payment before trial end | active |
| 3 | Trial expiry unpaid | No payment + trial expired | Immediate free active; no past_due/grace/invoice |
| 4 | Active → past_due | Period expired, no renewal | past_due |
| 5 | Past_due → suspended | Grace expired | suspended |
| 6 | Past_due → active | Payment received | active |
| 7 | Suspended → active | Payment received | active |
| 8 | Suspended → cancelled | Owner cancel | cancelled |
| 9 | Duplicate webhook | Same external_id | Idempotent |
| 10 | Duplicate lifecycle job | Concurrent workers | One transition |
| 11 | One invoice per period | Same period_key | UNIQUE conflict |
| 12 | Partial payment | Amount < due | Billing review queue (không bảng `billing_credits`) |
| 13 | Overpayment | Amount > due | Manual review |
| 14 | Suspended blocks mutation | Admin create session | Blocked |
| 15 | Suspended allows CK ingest | Player payment | Allowed |
| 16 | Reactivation resumes jobs | Suspended → active | Jobs resume, no duplicates |
| 17 | Override with expiry | Admin override | Temporary, auto-expires |
| 18 | Override without expiry | Missing expiry | Rejected |
| 19 | Plan version immutable | Change price | New version created |
| 20 | Cross-tenant billing isolation | Tenant A invoice | Not visible to B |
| 21 | Entitlement gate | Free plan bật `payment_reconcile_auto` | Rejected `PLAN_UPGRADE_REQUIRED` (free chỉ `payment_mark_manual`); kênh Zalo/Messenger **được phép** ở free |
| 22 | Capability config-driven | Set `crm_dashboard:true` cho free trong seed | Free có CRM ngay, không sửa code (gate đọc capability) |
| 23 | Trial reminder boundary | 2 days before trial_end, job retries | Exactly one reminder; no duplicate |
| 24 | Refund at paid_at+7d | Exact boundary | Eligible full refund |
| 25 | Refund after paid_at+7d | Boundary + 1 second | Not eligible; retain entitlement through period |
| 26 | Refund paid_at NULL | Missing proof | Manual review fail-closed |
| 27 | Override authorization/expiry | Co-admin or expiry>7d or missing ticket | Rejected; PlatformAdmin valid override auto-expires |
| 28 | Suspended automation | Player bank transaction arrives | Durable ingest succeeds; no auto allocation/notification |
| 29 | Publish blocked — tenant hard-suspend (abuse), subscription active | `tenants.status='suspended'`, `subscriptions.status='active'` | `authorizeTenantAction(tx, tenantId, 'publish_new_sessions')` → `TENANT_SUSPENDED` (union: tenant axis alone blocks) |
| 30 | Publish blocked — subscription suspended (non-payment), tenant active | `tenants.status='active'`, `subscriptions.status='suspended'` | `authorizeTenantAction(tx, tenantId, 'publish_new_sessions')` → `TENANT_SUSPENDED` (union: subscription axis alone blocks) |
| 31 | Publish blocked — no subscription row | Tenant exists, no `subscriptions` row, `tenants.status='active'` | `TENANT_SUSPENDED` — fail-closed (unprovable state), not allow-by-default |
| 32 | Publish allowed — trialing subscription, tenant active | `subscriptions.status='trialing'`, `tenants.status='active'` | Allow — same non-suspended treatment as `active`/`past_due` |
| 33 | Publish blocked — cancelled subscription, tenant active | `subscriptions.status='cancelled'`, `tenants.status='active'` | `TENANT_SUSPENDED` — `cancelled` is terminal, folded into the `suspended` bucket (closes the `suspended → cancelled` escape-without-paying path) |
| 34 | Publish blocked — anomalous `tenants.status` value | `tenants.status='past_due'` (no live write path/default produces this; set directly for the test), `subscriptions.status='active'` | `TENANT_SUSPENDED` — step 1 fails closed on any value other than `active`/`trialing`, not just literal `suspended`; never reached at step 2 |
| 35 | Publish allowed — tenant row created via schema `DEFAULT`, no explicit status set | `tenants.status='trialing'` (column default, `0002_tenants_core.sql:15` — not set explicitly by any current path but must not self-lockout a future one), `subscriptions.status='active'` | Allow — step 1 treats `trialing` same as `active`; a normal insert relying on the default must not be classified as hard-suspended |
| 36 | Publish vs. concurrent lifecycle-job suspend — job-first, lock held open (competing writer, deny path) | Tenant subscription eligible for the Daily Lifecycle Job's `past_due→suspended` step (not just `status='past_due'` in isolation): `plans.price > 0` (paid plan — the job's `JOIN plans WHERE plans.price > 0` filter), `subscriptions.status='past_due'`, `grace_end <= now()` (grace already elapsed — without this the job cannot claim the row at all). Test harness: Daily Lifecycle Job's transaction claims the row (`FOR UPDATE SKIP LOCKED`) and executes its `past_due`→`suspended` `UPDATE`, but does **NOT commit yet** — holds the transaction open with the row locked. While held, publish's step-6 billing re-check (`feature_session_management_tech.md` §4) attempts its own read on the same row | A correct (`FOR SHARE`) re-check **BLOCKS** on the job's held lock (cannot proceed while `FOR UPDATE` is outstanding) — harness then commits the job's transaction, publish's blocked read unblocks and observes the now-committed `suspended` value → `TENANT_SUSPENDED` (403), zero mutation, `status` stays `draft`, no `session.published`. Assert the read measurably WAITED (was blocked) before returning. A non-locking plain re-read does **NOT** block — under READ COMMITTED it sees the last-*committed* (pre-`UPDATE`) value `past_due` (still allowed) and would incorrectly let the mutation proceed; this test must fail such an implementation, not merely happen to reach the same denial by coincidence (this row's own two prior drafts both let the job's transaction fully commit BEFORE publish's read ran, so a plain re-read also observed the post-commit `suspended` value and passed without ever exercising lock contention — this version closes that gap) |
| 36a | Publish vs. concurrent lifecycle-job suspend — publish-first (competing writer, job-deferred path) | Same eligible-row preconditions as #36 (`plans.price > 0`, `subscriptions.status='past_due'`, `grace_end <= now()`). Test harness barrier instead forces publish's step-6 `FOR SHARE` lock on the `tenants`/`subscriptions` row(s) to be acquired BEFORE the Daily Lifecycle Job's cron run attempts its `FOR UPDATE SKIP LOCKED` claim on the same row | Job's `SKIP LOCKED` claim skips the row this run (no error, no block) — suspend transition deferred to the job's next run; publish's mutation commits `status='open'` successfully, because it validly observed a not-yet-suspended tenant under lock at a real serialization point. This is the CORRECT outcome, not a race bug |
| 37 | Auto-reconcile entitlement ≠ availability | Host Pro có `payment_reconcile_auto=true`, nhưng provider/bank/market/currency/consent không PASS | Không auto-settle/auto-notify; trả unavailable ổn định; mark-paid thủ công vẫn hoạt động. Free/thiếu entitlement vẫn là `PLAN_UPGRADE_REQUIRED` |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Full lifecycle E2E | Trial → invoice → pay → renew | All transitions correct |
| 2 | Suspension → CK ingest | Suspend → player pays → ingest | CK processed |
| 3 | Suspension → reactivation | Suspend → owner pays → reactivate | Operations resume |
| 4 | Concurrent lifecycle + webhook | Parallel jobs | Consistent state |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Manual trial flags
2. Shadow lifecycle job (log only)
3. Owner notices enabled
4. Enforcement for beta
5. Automated billing payment chỉ sau khi entitlement **và** availability resolver đều PASS cho provider/bank/market/currency/consent cụ thể; manual mark-paid giữ nguyên ngoài gate

### Metrics

- MRR / conversion / churn
- Invoice age / match rate
- Transition lag
- Suspended ingestion count
- Reactivation rate / override usage

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-08-03 | v2.10 | **Reconcile `authorizeTenantAction` signature (`docs-billing-authz-signature-reconcile`):** every current-state call/signature mention updated `(tenantId, actionClass)` / `(tenantId, 'publish_new_sessions')` → `(tx, tenantId, actionClass)` / `(tx, tenantId, 'publish_new_sessions')`: §1 overview diagram, §3 Status Authority heading, §2 edge case #8, §5 test cases #29–30 — merged code (`ddb69a9`, `packages/db/src/authorization.ts:91-95`) takes the caller's already-open transaction as its first parameter; a version that opens its own transaction releases its `FOR SHARE` locks before the caller can mutate, reopening exactly the race this same §3's Concurrency clause (v2.8 round-05) exists to close — mechanically required, not a design choice (codex round-01 [P1] on `authorize-tenant-action-core`; the completeness gap across edge case #8 and tests #29–30 itself caught by this slice's own codex round-02 [P2]). §1's "takes tenant context, not a pre-resolved status" guarantee is unchanged — callers still never read/pass a resolved status, only now also pass their own open `tx`. Docs-only; code/schema/tests already merged and unchanged by this reconcile. Pre-existing dated changelog giữ verbatim. |
| 2026-07-27 | v2.9 | Đồng bộ DD-91 + research khả dụng khu vực: `payment_reconcile_auto` là entitlement thương mại, không phải bằng chứng availability; thêm resolver fail-closed theo provider/bank/market/currency/consent, giữ manual mark-paid toàn cầu, exact `assistant_ai_kb`, và `/pay` deterministic không qua LLM. Reconcile migration live `0000`–`0024` (25 migrations, tail `0024`). Contract only; provider/lifecycle/chat runtime vẫn chưa build. |
| 2026-07-24 | v2.8d | **Round-05 fix (`docs-session-publish-concurrency-recheck`, codex [P1]):** the round-02 fix split test #36 into job-first/publish-first, but #36's job-first barrier ("job's transaction commits before publish's read runs") let the job's transaction fully COMMIT before publish ever attempted its read — meaning by the time publish read, there was no concurrent lock holder left to contend with, so a naive plain re-read would ALSO observe the post-commit `suspended` value and pass, without the test ever exercising real lock contention. Fixed #36's harness to hold the job's transaction OPEN (claimed + `UPDATE`d but not committed) WHILE publish attempts its read: a correct `FOR SHARE` re-check now must BLOCK on the job's outstanding `FOR UPDATE` lock (assert the read measurably waited) and only proceed once the harness commits the job and the block releases; a non-locking plain re-read would NOT block and would instead see the last-*committed* (pre-`UPDATE`, still-`past_due`) value under READ COMMITTED — incorrectly allowing the mutation — so this version of the test actually fails a non-locking implementation instead of coincidentally passing it. #36a (publish-first) needed no change — its assertion ("job's `SKIP LOCKED` claim skips the row") already depends entirely on whether publish holds a real lock, with no coincidental-pass path. |
| 2026-07-24 | v2.8c | **Round-02 fix (`docs-session-publish-concurrency-recheck`, codex [P1]+[P2]):** codex confirmed the v2.8b algorithm fix (locking re-check in `feature_session_management_tech.md` §4 step 6) is "directionally correct" but flagged test #36 as not actually proving the race is closed. [P1] the test only said "check passes; job commits before mutation commits" without forcing a DETERMINISTIC interleaving — a naive implementation using a plain final re-read (no lock) could still coincidentally pass if the job's commit landed after that unlocked read by luck, and the test never exercised the reverse ordering (publish's lock acquired first) to prove real mutual exclusion. [P2] the precondition `subscriptions.status='past_due'` alone does not make the row claimable by the Daily Lifecycle Job — that job only claims `plans.price > 0` (paid) subscriptions and only transitions `past_due→suspended` after `grace_end` has elapsed; without both, the job cannot actually produce the competing write the test is supposed to model. Fixed: split #36 into two deterministic sub-scenarios — **#36 (job-first)**: test harness forces the job's `FOR UPDATE SKIP LOCKED` claim + suspend commit to complete before publish's `FOR SHARE` re-check runs → publish must observe `suspended` and be denied. **#36a (publish-first)**: harness forces publish's `FOR SHARE` lock to be acquired before the job's claim attempt → job's `SKIP LOCKED` skips the row (suspend deferred to next run), publish proceeds correctly. Both now require the eligible-row preconditions (`plans.price > 0`, `subscriptions.status='past_due'`, `grace_end <= now()`). §3 Status Authority decision table untouched — out of scope. |
| 2026-07-24 | v2.8b | **Clarify v2.8a scope + fix impossible-state test (`docs-session-publish-concurrency-recheck`):** (1) v2.8a's ratification clause said `feature_session_management_tech.md` §4's named hard dependency is "content-resolved by this contract" — narrowed that to **status authority only** (which column/value blocks publish, the decision table above); the **check-then-lock concurrency ordering** flagged by this same spec's own §3 Concurrency clause (added in v2.8, before v2.8a) was NOT resolved by v2.8a and is a separate sub-question — now closed directly in `feature_session_management_tech.md` §4 step 6 (billing re-check moved inside the same transaction/row-lock as the mutation) by this slice. (2) Test #36's precondition was an impossible state: it read the check-passes precondition as `subscriptions.status='active'`, but the Daily Lifecycle Job transition it races against (`past_due→suspended`) can only ever fire on a row that is ALREADY `past_due` — a single job run does not flip `active` straight to `suspended` (that requires an intervening `active→past_due` step, then a later run after `grace_end`). Corrected the precondition to `subscriptions.status='past_due'` (still an allowed status per the Suspended Action Matrix, so the check still passes — the race is now reachable). §3 Status Authority decision table **untouched** (not in scope — already ratified). Docs-only, no schema/algorithm change. |
| 2026-07-24 | v2.8a | **FOUNDER-RATIFIED + Round-06 fixes (`docs-billing-publish-suspension-authority`):** Owner ratified the v2.8 §3 Status Authority fail-closed 2-step resolution as authored (tenant axis wins incl. anomaly; subscription axis blocks `suspended`/`cancelled`/missing row, allows `trialing`/`active`/`past_due`) — decision table **unchanged**. Removed the "⏳ founder ratification pending" markers (§3 blockquote + G1-status line + product-mirror inline note) — this review/merge IS the ratification; `feature_session_management_tech.md` §4's named hard dependency is content-resolved **for status authority** (which column/value blocks — the decision table above) by this contract (that file itself not edited, per scope) — the check-then-lock **concurrency** ordering flagged by this same version's §3 Concurrency clause (above) is a separate, still-open sub-question at v2.8a's authoring time, tracked by `docs-session-publish-concurrency-recheck` (closed in `feature_session_management_tech.md` §4 step 6 by that slice — see v2.8b row). **Codex round-06 [P1] fix:** the round-05 Reactivation screen copy branched payment-CTA-vs-support-contact on suspension cause, but nothing in the contract (billing overview API only exposes `subscription.status`; `TENANT_SUSPENDED` is intentionally cause-agnostic) gives the UI a way to pick the branch — reverted to cause-agnostic copy that always shows both the payment CTA and a support-contact line, regardless of cause (see `feature_billing_lifecycle.md` §3). Round-06's other P1 (process concern re: authoring into a `Status: Reviewed` spec) is resolved by this ratification. Did not touch `feature_session_management_tech.md` or `docs/autopilot-backlog.md`. |
| 2026-07-24 | v2.8 | **Status authority for publish suspend gate (`docs-billing-publish-suspension-authority`):** §3 mới **Status Authority** — `authorizeTenantAction(tenantId, actionClass)` (takes tenant context, resolves both columns itself — never a pre-resolved scalar) fail-closed **two-step**: step 1 trục `tenants.status` (chỉ `'active'` rõ ràng ổn, MỌI giá trị khác kể cả anomaly đều khoá — không riêng literal `'suspended'`); step 2 (chỉ khi step 1 clear) trục `subscriptions.status` — `suspended`/`cancelled`/missing row → block, `trialing`/`active`/`past_due` → allow. 2 cột share CHECK enum nhưng 2 trục độc lập (non-payment billing lifecycle vs tenant-root abuse/ToS hard override — trục sau **chưa có write path** ngoài `tenant_provision` set cứng `'active'` lúc tạo tenant, `0012:256`, và **chưa có clearing mechanism** — một sự kiện billing-axis không được ngầm clear nó). Decision table 6-case (1/1b/2/2b/3/4) + 6 unit test (#29–34). §1 overview + edge #8 + Caching Strategy trỏ về §3. **Codex round-01 (2×P1):** draft đầu treat `cancelled`/thiếu-row = allow; sửa fail-closed (lối tắt `suspended→cancelled` né nợ; thiếu row = anomaly không phải "chưa vào billing"). **Round-02 (P1+P2):** "code-ready" mâu thuẫn với ghi chú ratification-pending; sửa wording tách "mechanism đủ" khỏi verdict `CODE_READY` thật; manifest `_note` cũ mâu thuẫn bảng đã sửa → thêm addendum RESOLVED. **Round-03 (3×P1):** (a) signature 1-scalar `(status, actionClass)` mơ hồ ai resolve — đổi `(tenantId, actionClass)`, hàm tự đọc cả 2 cột; (b) `feature_billing_lifecycle.md` state machine gộp 2 trục vào 1 diagram, "Payment received/manual override" có thể đọc nhầm thành clear luôn tenant-root hard-suspend — thêm cảnh báo ở §4 diagram đó; (c) `tenants.status` fail-open cho giá trị khác `suspended`/`active` — đổi step 1 thành fail-closed trên toàn cột (chỉ `'active'` allow), test #34. **Round-04 (P2):** `tenants.status` có `DEFAULT 'trialing'` (`0002_tenants_core.sql:15`) mà step 1 (post round-03) chỉ allow `'active'` — một insert path TƯƠNG LAI dựa default sẽ tự khoá publish của tenant hoàn toàn bình thường; broaden step 1 allow-set thành `{'active','trialing'}` (`past_due`/`cancelled` vẫn anomaly, vẫn khoá — case 1b), test #35. **P2 backlog registration (round-02 + round-04, cùng finding lặp lại) — DISMISSED có bằng chứng, không sửa:** task instruction tường minh "Do NOT touch docs/autopilot-backlog.md"; manifest `_note` gốc đã ghi "Backlog block deferred to batch" — đây là scope exclusion chủ ý, không phải thiếu sót; backlog reconciliation cho slice này để lại cho batch riêng (founder xử lý). **Round-05 (P1+2×P2):** thêm §3 clause **Concurrency** — `authorizeTenantAction` cho mutating action class không phải check-sớm-rồi-quên; race thật với Daily Lifecycle Job's `FOR UPDATE SKIP LOCKED` suspend-transition nếu caller không re-validate/serialize tới lúc mutation commit; pin follow-up `docs-session-publish-concurrency-recheck` (session spec's step-ordering exact fit — không sửa file đó ở đây), test #36. Sửa wording "step 2... trục tenant đã rõ 'active'" thiếu `trialing` (gap sót từ round-04). Thêm ghi chú `TENANT_SUSPENDED` giờ 2 root cause (abuse vs non-payment) share 1 code/message — không invent code mới (giữ discipline); sửa copy "Reactivation" ở `feature_billing_lifecycle.md` §3 để không tuyên bố trả tiền luôn sửa được; owner-facing cause-differentiation là UX decision chưa chốt, không resolve ở đây. **⏳ Founder ratification pending** cho SHAPE cụ thể (per manifest, STOP_AT_READY) — agent-authored theo hướng recommend; dependency mà `feature_session_management_tech.md` §4 publish billing note cross-ref chỉ thật sự resolved sau khi confirm (file đó **không sửa** — cross-ref giữ nguyên). Docs-only, không đổi schema/algorithm (2 cột đã tồn tại từ `0002`/`0007`); reuse `TENANT_SUSPENDED` (403), không session error code mới. **Không đổi** Suspended Action Matrix hiện có (3 cột/6 hàng nguyên vẹn). Pre-existing dated changelog giữ verbatim. |
| 2026-07-24 | v2.7b | **De-pin migration-tail** (docs-migration-tail-0018-to-0020-sweep): §Migration&Rollback grep-note hard-pinned `migrations 0000–0018` → non-pinned "verify tail hiện hành tại `packages/db/migrations/`, không hard-pin số" (live tail nay `0020`; `0019`/`0020` tenant-integrity FKs DD-68). 6 bảng billing vẫn từ `0007` — reuse, không đổi. Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-23 | v2.7a | **Reconcile 0014 merge-state:** current-state §2 grep-note sửa → migrations `0000–0018` đã merge trên `main`, `0014_players_waitlist` **đã merge** (`1a6ac38`), tail = 0018 (trước ghi "0000–0013 merged; 0014 branch-only"). 6 bảng billing vẫn từ `0007` — reuse, không recreate. Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-19 | v2.7 | **Template v2.30/v2.33 uplift:** thêm §2 Migration & Rollback (reuse 6 bảng `0007`; delta DD-29/DD-51 → migration mới monotonic), §3 Request/Response Examples (DD-60 envelope) + Idempotency, §4 Caching Strategy + Security Checklist. Derivative/editorial — không đổi contract. |
| 2026-07-19 | v2.6a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-16 | v2.6 | **DD-51 full propagation:** nullable free period fields, invoice `paid_at`, override `ticket_ref`, exact trial/grace/refund/override commands, suspended automation-off and boundary tests. |
| 2026-07-10 | v2.5 | **Review fixes → canonical billing vocab.** Thêm ghi chú **PENDING MIGRATION** cho `plans` CHECK `('free','host_pro')` (live schema.ts vẫn 4-tier — không claim done). Overpay/partial = billing review queue qua `billing_allocations` (KHÔNG có bảng `billing_credits`); edge #4 + test #12 cập nhật. Schema đã dùng `subscription_invoices`/`billing_transactions`/`billing_allocations`/`billing_overrides` (canonical). |
| 2026-07-05 | v2.3 | **DD-29 pricing pivot:** `plan_key`→`('free','host_pro')`, host_pro 250k; bỏ `selected_extra_channel`/plus_channel; `entitlements`=**capability flags config-driven** + "Capability registry" (§4b: reconcile_manual free, reconcile_auto+reminders_auto+assistant+crm pro); edge #13/#14 + test #21/#22 đổi sang capability gate. Rename plan_key cũ `free_web`→`free`. |
| 2026-07-10 | v2.4 | **DD-40 ✅ + DD-37 ✅:** §4b registry — free capability `payment_reconcile_manual` → **`payment_mark_manual`** (mark-paid thủ công tiền mặt/CK, DD-40); host_pro giữ `payment_reconcile_auto`/`reminders_auto`/`assistant_ai_kb`/`crm_dashboard`. Seed bỏ `bot_telegram`; kênh free = **Zalo + Messenger** (DD-37); `bot_messenger` gated bởi App Review (DD-37/P2.5, thay DD-09/P4.8). Test #21 cập nhật. |
| 2026-06-20 | v2.1 | Add DD-03 plan keys/prices/entitlements and selected extra channel for plus plan |
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), DDL, 12 edge cases, suspended action matrix, 20 tests |
