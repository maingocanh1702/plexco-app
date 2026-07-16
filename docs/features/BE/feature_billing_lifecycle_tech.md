# Feature: Host Billing & Tenant Lifecycle — Backend Tech Spec

> **Canonical phase:** P5  
> **Version:** 2.6 · 2026-07-16
> **Status:** Reviewed  
> **Product spec:** `../feature_billing_lifecycle.md`  
> **References:** `../../standards/business-rules.md` · `../../standards/decisions.md` DD-29/DD-37/DD-40/DD-51

> **Cập nhật v2.4 (DD-40 ✅ + DD-37 ✅, 2026-07-10):** §4b capability registry — free = `payment_mark_manual` (tiền mặt/CK thủ công) + `reminders_manual`; host_pro thêm `payment_reconcile_auto` + `reminders_auto` + `assistant_ai_kb` + `crm_dashboard`. Bot kênh free = **Zalo + Facebook Messenger** (bỏ Telegram — DD-37).

---

## 1. Tổng quan triển khai

```text
Tenant creation → free active immediately OR paid plan trial → Daily lifecycle job
    → Issue invoice → Platform billing webhook → Match → Extend period
    → Due transitions: active → past_due → suspended → cancelled
    → Central authorizeTenantAction(status, actionClass)
```

Billing ledger **separate schema/table set** from player ledger. Central `authorizeTenantAction` defines allowed matrix — adapters cannot implement inconsistent suspension rules.

---

## 2. Database Schema + Edge Cases (BE)

### Schema

```sql
CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key text NOT NULL CHECK (plan_key IN ('free','host_pro')),  -- DD-29 target (thay DD-03 4-tier)
  -- ⚠️ PENDING MIGRATION: live packages/db/schema.ts vẫn CHECK 4-tier
  --   ('free_web','telegram','plus_channel','all_channels'). CHECK ('free','host_pro') chưa land — không claim done.
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
| 8 | Security | Suspended tenant publish new sessions | ❌ Block — `authorizeTenantAction` check |
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

### Suspended Action Matrix

| Action Class | Status: active | past_due | suspended |
|-------------|:---:|:---:|:---:|
| Admin mutation | ✅ | ✅ | ❌ |
| Integration changes | ✅ | ✅ | ❌ |
| Publish new sessions | ✅ | ✅ | ❌ |
| Player CK ingest | ✅ | ✅ | ✅ |
| Read-only queries | ✅ | ✅ | ✅ |
| System safety | ✅ | ✅ | ✅ |

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

---

## 4b. Capability registry (config-driven — DD-29)

Gate tính năng đọc `hasCapability(tenant, key)` → tra `plans.entitlements.capabilities[key]` của plan hiện hành. **Đổi tính năng nào ở free/pro = sửa seed/`entitlements` (config), KHÔNG sửa code.** `plan_key` chỉ là nhãn; quyền do capability flags quyết định.

| Capability key | Free | Pro | Ghi chú |
|---|:--:|:--:|---|
| `web_app` | ✓ | ✓ | Web app + dashboard |
| `bot_zalo` · `bot_messenger` | ✓ | ✓ | Kết nối bot kênh phase-1 (miễn phí — DD-29/DD-37). `bot_messenger` vẫn **gated bởi App Review Messenger** (DD-37/P2.5). *(Telegram đã bỏ — DD-37.)* |
| `session_management` | ✓ | ✓ | Kèo/roster/waitlist/join |
| `discovery_marketplace` | ✓ | ✓ | Player-side (cross-club) |
| `payment_mark_manual` | ✓ | ✓ | **Mark-paid thủ công** tiền mặt/CK (tap/multi-select), audit, idempotent, áp DD-25 confirm (DD-40) |
| `payment_reconcile_auto` | ✗ | ✓ | **Auto-settle** CK khớp (webhook match tên+tiền+ngày) + **auto-notify** player đã trả |
| `reminders_manual` | ✓ | ✓ | Host bấm nhắc thủ công |
| `reminders_auto` | ✗ | ✓ | Nhắc nợ / pre-post-session **tự động theo lịch** (2h→24h→…) |
| `assistant_ai_kb` | ✗ | ✓ | Club Assistant + KB (DD-16..28) |
| `crm_dashboard` | ✗ | ✓ | Analytics nâng cao (CRM_DASHBOARD_BRD) |

**Limits** (`plans.limits`): `max_clubs` (free 2 · pro null=∞), `ai_monthly_question_cap` (free 0 · pro 2000). Chỉnh tự do theo config.

**Bất biến gate:** (a) **CK ingest LUÔN chạy** bất kể plan (safety, BL-PAY-1) — capability chỉ gate hành vi **auto-settle/auto-notify**, không gate việc lưu giao dịch; (b) chặn capability trả về `PLAN_UPGRADE_REQUIRED`, không làm mất dữ liệu.

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
5. Automated billing payment

### Metrics

- MRR / conversion / churn
- Invoice age / match rate
- Transition lag
- Suspended ingestion count
- Reactivation rate / override usage

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-16 | v2.6 | **DD-51 full propagation:** nullable free period fields, invoice `paid_at`, override `ticket_ref`, exact trial/grace/refund/override commands, suspended automation-off and boundary tests. |
| 2026-07-10 | v2.5 | **Review fixes → canonical billing vocab.** Thêm ghi chú **PENDING MIGRATION** cho `plans` CHECK `('free','host_pro')` (live schema.ts vẫn 4-tier — không claim done). Overpay/partial = billing review queue qua `billing_allocations` (KHÔNG có bảng `billing_credits`); edge #4 + test #12 cập nhật. Schema đã dùng `subscription_invoices`/`billing_transactions`/`billing_allocations`/`billing_overrides` (canonical). |
| 2026-07-05 | v2.3 | **DD-29 pricing pivot:** `plan_key`→`('free','host_pro')`, host_pro 250k; bỏ `selected_extra_channel`/plus_channel; `entitlements`=**capability flags config-driven** + "Capability registry" (§4b: reconcile_manual free, reconcile_auto+reminders_auto+assistant+crm pro); edge #13/#14 + test #21/#22 đổi sang capability gate. Rename plan_key cũ `free_web`→`free`. |
| 2026-07-10 | v2.4 | **DD-40 ✅ + DD-37 ✅:** §4b registry — free capability `payment_reconcile_manual` → **`payment_mark_manual`** (mark-paid thủ công tiền mặt/CK, DD-40); host_pro giữ `payment_reconcile_auto`/`reminders_auto`/`assistant_ai_kb`/`crm_dashboard`. Seed bỏ `bot_telegram`; kênh free = **Zalo + Messenger** (DD-37); `bot_messenger` gated bởi App Review (DD-37/P2.5, thay DD-09/P4.8). Test #21 cập nhật. |
| 2026-06-20 | v2.1 | Add DD-03 plan keys/prices/entitlements and selected extra channel for plus plan |
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), DDL, 12 edge cases, suspended action matrix, 20 tests |
