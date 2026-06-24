# Feature: Host Billing & Tenant Lifecycle — Backend Tech Spec

> **Canonical phase:** P5  
> **Version:** 2.2 · 2026-06-20
> **Status:** Reviewed  
> **Product spec:** `../feature_billing_lifecycle.md`  
> **References:** `../../standards/business-rules.md`

---

## 1. Tổng quan triển khai

```text
Tenant creation → free_web active immediately OR paid plan trial → Daily lifecycle job
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
  plan_key text NOT NULL CHECK (plan_key IN ('free_web','telegram','plus_channel','all_channels')),
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
  selected_extra_channel text CHECK (selected_extra_channel IN ('zalo','messenger') OR selected_extra_channel IS NULL),
  status text NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing','active','past_due','suspended','cancelled')),
  -- free_web (price=0): tạo row với status='active', trial_end/grace_end = NULL, period_end xa/null;
  --   KHÔNG sinh invoice; lifecycle job bỏ qua (xem §4 + edge #17). Không có trạng thái riêng cho free —
  --   phân biệt bằng plans.price=0. Free rời 'active' chỉ khi đổi plan / cancel / suspend-vì-abuse.
  trial_end timestamptz,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  grace_end timestamptz,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed v1 (DD-03)
INSERT INTO plans (plan_key, version, price, limits, entitlements) VALUES
  ('free_web', 1, 0, '{}', '{"web_app": true, "telegram": false, "zalo": false, "messenger": false}'),
  ('telegram', 1, 79000, '{}', '{"web_app": true, "telegram": true, "zalo": false, "messenger": false}'),
  ('plus_channel', 1, 159000, '{}', '{"web_app": true, "telegram": true, "extra_channel_count": 1, "extra_channel_options": ["zalo", "messenger"]}'),
  ('all_channels', 1, 199000, '{}', '{"web_app": true, "telegram": true, "zalo": true, "messenger": true}');

CREATE TABLE subscription_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  invoice_code text NOT NULL UNIQUE,
  amount_due integer NOT NULL,
  amount_paid integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','partial','overdue','cancelled')),
  due_at timestamptz NOT NULL,
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
| 4 | Financial | Partial/overpayment | Billing credit/manual review — NOT allocated to player |
| 5 | Data Integrity | Double period extension | `UNIQUE(tenant_id, period_key)` — exactly once |
| 6 | Data Integrity | Retroactive price change | ❌ NEVER — plan version immutable |
| 7 | Data Integrity | Clock/timezone billing date | UTC billing dates only |
| 8 | Security | Suspended tenant publish new sessions | ❌ Block — `authorizeTenantAction` check |
| 9 | Security | Suspended tenant CK ingest | ✅ Allow — safety path |
| 10 | Data Integrity | Reactivation replay jobs | Version check — no duplicate reminders/projectors |
| 11 | Security | Override without expiry | ❌ Must have expiry — auto-expire enforced |
| 12 | Cross-Feature | Owner lost access | Support ticket + audit — manual recovery |
| 13 | Entitlement | Channel not included in plan | Block with `PLAN_UPGRADE_REQUIRED`; do not affect payment ingest |
| 14 | Entitlement | `plus_channel` has no selected channel | Block Zalo/Messenger setup until owner selects one option |
| 15 | Data Integrity | `free_web` (price=0) routed through trial/past_due/suspended | ❌ NEVER — created `status='active'`, no invoice; lifecycle job filters `WHERE p.price > 0`. Free chỉ suspend qua đường ToS/abuse, không qua non-payment |
| 16 | Data Integrity | Invoice issued for price=0 plan | ❌ NEVER — `IssueInvoice` skip khi `plan.price = 0` |
| 17 | Entitlement | Downgrade paid → `free_web` | Hạ entitlement cuối period đã trả; set `status='active'`, `period_end=NULL`, ngừng invoice; không retroactive refund tự động (BIL-OQ-2) |

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
Cron (daily) → Claim due subscriptions JOIN plans WHERE plans.price > 0   (bỏ qua free_web)
                 FOR UPDATE SKIP LOCKED
    → Per tenant TX: check dates → transition status
    → Send owner notices (outbox) → COMMIT
```

> **free_web bỏ qua hoàn toàn:** join `plans.price > 0` loại mọi subscription 0đ khỏi nhánh `period expired → past_due → suspended`. `IssueInvoice` cũng skip khi `plan.price = 0`. Free chỉ đổi trạng thái qua `CancelSubscription`, đổi plan, hoặc `ApplyOverride`/suspend vì abuse (đường riêng, không phải lifecycle non-payment).

### Billing Webhook Ingest

```text
Webhook → Durable ingest: billing_transaction + job COMMIT before ACK
    → Parser: strict invoice code match
    → Ambiguous/partial/overpay → billing review queue
    → Matched → allocate + extend period (exactly once)
```

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Trial start (paid plan) | New tenant, plan trả phí | trialing + dates set |
| 1b | free_web start | New tenant, plan `free_web` | `active` ngay, không trial, không invoice |
| 1c | free_web never past_due | free_web qua nhiều chu kỳ, không payment | vẫn `active`; lifecycle job bỏ qua; 0 invoice |
| 2 | Trial → active | Payment before trial end | active |
| 3 | Trial → past_due | No payment + trial expired | past_due |
| 4 | Active → past_due | Period expired, no renewal | past_due |
| 5 | Past_due → suspended | Grace expired | suspended |
| 6 | Past_due → active | Payment received | active |
| 7 | Suspended → active | Payment received | active |
| 8 | Suspended → cancelled | Owner cancel | cancelled |
| 9 | Duplicate webhook | Same external_id | Idempotent |
| 10 | Duplicate lifecycle job | Concurrent workers | One transition |
| 11 | One invoice per period | Same period_key | UNIQUE conflict |
| 12 | Partial payment | Amount < due | Billing credit |
| 13 | Overpayment | Amount > due | Manual review |
| 14 | Suspended blocks mutation | Admin create session | Blocked |
| 15 | Suspended allows CK ingest | Player payment | Allowed |
| 16 | Reactivation resumes jobs | Suspended → active | Jobs resume, no duplicates |
| 17 | Override with expiry | Admin override | Temporary, auto-expires |
| 18 | Override without expiry | Missing expiry | Rejected |
| 19 | Plan version immutable | Change price | New version created |
| 20 | Cross-tenant billing isolation | Tenant A invoice | Not visible to B |
| 21 | Entitlement gate | Free plan creates Telegram link | Rejected with `PLAN_UPGRADE_REQUIRED` |
| 22 | Plus channel selection | `plus_channel` selected `zalo` then tries Messenger | Rejected unless plan selection changed/audited |

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
| 2026-06-20 | v2.2 | Fix free_web lifecycle: tạo `status='active'` không trial/invoice; daily job join `plans.price>0` (skip free); `IssueInvoice` skip price=0; edge #15–17 + test #1b/1c; downgrade paid→free |
| 2026-06-20 | v2.1 | Add DD-03 plan keys/prices/entitlements and selected extra channel for plus plan |
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), DDL, 12 edge cases, suspended action matrix, 20 tests |
