# 🏸 DD-46 Analysis — Kèo không thuộc CLB (Skip Club / personal meet)

> **Mục đích:** chốt hướng kiến trúc cho "kèo cá nhân không cần club" — đụng bất biến `sessions.tenant_id NOT NULL` + RLS (HR1). **Phải chốt TRƯỚC cụm session-model** (DD-41/42/43/44/45).
> **Ngày:** 2026-07-13 · **Canonical:** `packages/db/schema.ts` (sessions/tenants + toàn bộ tenant-scoped) · `feature_web_auth_onboarding.md` (WAO-UC-2 tạo tenant) · `feature_billing_lifecycle.md` (logical free tier) · HANDOFF §3 (5 HARD RULES). Đã ghi → `decisions.md` DD-46 (✅ Option B).

---

## 0. TL;DR — ✅ ĐÃ CHỐT: Option B (personal tenant), phase-1

**Owner 2026-07-13 chốt Option B.**

- ❌ **CẤM: session không tenant / `tenant_id` nullable.** Không phải vì auto-leak (policy hiện cho NULL → 0 rows), mà vì buộc phải **dựng authz/money plane thứ hai** cho session không-tenant → phá HR1/HR2/HR4. Loại vĩnh viễn.
- ⚪ **Option A (đã cân nhắc, KHÔNG chọn): không hỗ trợ kèo không-CLB.** Giữ để tham chiếu ở §3.
- ✅ **Option B (ĐÃ CHỌN): "Personal tenant".** User không có/không muốn dùng club → **auto-provision một personal tenant** (nền, logical free tier, owner=self, `tenants.kind='personal'`). **Giữ nguyên `tenant_id NOT NULL` + RLS + money model**; tái dùng shared provisioning core sẵn có (WAO-UC-2 / **`tenant_provision`** fn `0012`, TS `provisionTenant`).

**Vì sao B an toàn & không nặng:** personal tenant = **một tenant đầy đủ** → mọi bất biến RLS/tiền áp y hệt club; tạo tenant + free plan đã có sẵn. Chi tiết contract (uniqueness, marketplace, money, merge) ở §4 (đã pin để triển khai được).

---

## 1. Canonical đã cố định gì

| Sự thật | Nguồn |
|---|---|
| **`tenant_id NOT NULL` phổ quát** — sessions, memberships, players, charges, bank_*, allocations… đều `tenant_id uuid NOT NULL REFERENCES tenants(id)` | `schema.ts` (26+ bảng) |
| **RLS fail-closed keyed `app.tenant_id`** — thiếu GUC → 0 rows. Role `app` = NOBYPASSRLS | `0009_rls_policies_grants.sql`, HR1 |
| **Tạo tenant = flow onboarding chuẩn** — WAO-UC-2 "New Host → tạo Account + Tenant, idempotent, assign owner role" | `feature_web_auth_onboarding.md:46` |
| **Logical free tier** — free tenant = `active`, **không sinh invoice** (target `free` của **DD-29**; live schema vẫn `free_web` — migration chờ) | `feature_billing_lifecycle.md` · `0012:288` |
| Marketplace `public_sessions` whitelist gồm `host_display_name`, `club_display_name` | HANDOFF §2 |

> **Hệ quả:** "session phải có tenant" là **xương sống cô lập + đường tiền**, không phải ràng buộc phụ. Và "tạo một tenant" **rẻ** (flow có sẵn + free plan không tính phí).

---

## 2. ❌ Option bị CẤM — session không tenant / nullable `tenant_id`

**Chính xác về rủi ro:** policy hiện tại `USING (tenant_id = NULLIF(current_setting('app.tenant_id'),'')::uuid)` (`0009:52`) → row có `tenant_id = NULL` **không khớp bất kỳ GUC nào → 0 visible rows**, KHÔNG tự gây leak. Rủi ro thật là: để **dùng được** session không-tenant, phải dựng **một mặt phẳng authorization + money thứ hai** (ai đọc/ghi/sở hữu/thu tiền session không-tenant) **song song** với RLS/ledger hiện có.

- **HR1:** cần đường đọc/ghi **ngoài** `tenantRepo` choke-point cho loại session này → phá mô hình cô lập một-choke-point.
- **HR2:** charges/allocations của session không-tenant thuộc plane nào? → phải nhân đôi money model.
- **HR4:** claim/merge membership-có-tiền dựa trên tenant scope → không tenant thì không khoá được.
- **HR3:** đẻ đường ghi song song cho 2 loại session = multi-master.

⇒ **Loại tuyệt đối.** Mọi hướng "skip club" phải **giữ** `tenant_id NOT NULL` (Option B làm đúng điều này).

---

## 3. ✅ Option A — Không hỗ trợ kèo không-CLB (MVP)

- **Nội dung:** mọi session thuộc một tenant. Muốn host → user phải có/tạo một club (WAO-UC-2). UI **không** có "Skip Club".
- **Ưu:** zero kiến trúc mới; không rủi ro HARD RULES; khớp beachhead club-first (tenant #1 = CLB founder); cụm session-model (DD-41…) build thẳng trên `tenant_id NOT NULL`.
- **Nhược:** không phục vụ use case "kèo cá nhân/pickup không muốn lập club" mà 2 app tham khảo có (nút Skip Club). Player casual đa môn (Lan — persona P4) hơi ma sát nếu muốn tự mở kèo lẻ.
- **Giảm nhẹ:** onboarding "tạo club" có thể rất nhẹ (1 field tên) — ranh giới giữa "club" và "personal" mờ đi; tức là A ≈ B nhưng **luôn gọi là club**.

---

## 4. ✅ Option B — Personal tenant (đường đúng nếu muốn tính năng)

- **Nội dung:** user bấm "tạo kèo" ở không-gian-cá-nhân → **auto-provision một personal tenant** (nền, logical free tier, `kind='personal'`, owner=self). Session gắn tenant đó → **`tenant_id NOT NULL` nguyên vẹn**, RLS/money y hệt club.

**Contract đã PIN (triển khai được):**

1. **Schema `tenants` (fail-closed shape):**
   ```sql
   ALTER TABLE tenants
     ADD COLUMN kind text NOT NULL DEFAULT 'club' CHECK (kind IN ('club','personal')),
     ADD COLUMN owner_person_id uuid REFERENCES persons(id),
     ADD CONSTRAINT tenants_personal_owner_chk
       CHECK ((kind = 'personal') = (owner_person_id IS NOT NULL));  -- personal⇔owner non-null
   -- partial unique = INDEX, KHÔNG phải table constraint:
   CREATE UNIQUE INDEX tenants_personal_owner_uq
     ON tenants(owner_person_id) WHERE kind = 'personal';           -- 1 personal/person
   ```
2. **Provision — SHARED CORE cho club + personal (không đẻ đường song song):** live **`tenant_provision`** (`0012:256`) / TS **`provisionTenant`** (`auth.ts:143`) **đã** tạo đủ: `tenants(name,slug)` + **owner `memberships` row** + web-owner `tenant_admins` + free subscription (+ onboarding). Personal **tái dùng core này**, chỉ khác input:
   - **Wrapper mới `getOrCreatePersonalTenant(personId)`** (TS) / DB **`tenant_get_or_create_personal(p_person_id)`** — gọi shared core với **`name` internal non-PII** + **slug opaque deterministic** hợp validator `^[a-z0-9][a-z0-9-]{1,62}$` (vd **`p-<lowercase-hex/base32 của hash(person_id)>`** — dấu `-` không `_`; **không** raw UUID/PII), set `kind='personal'` + `owner_person_id`. Owner membership **vẫn được tạo** (như club).
   - **Coordinate lock với merge:** resolve canonical Person (follow `merged_into_person_id`) + `persons.status='active'` + **lock `persons` row `FOR UPDATE` cùng cơ chế merge** (không chỉ advisory) → tránh race create×merge. Idempotent (SELECT existing personal → else provision).
3. **Marketplace — alias ở owner membership (khớp contract sẵn có):** marketplace `host_display_name` ← **`memberships.display_name` (Moderated)** (`feature_marketplace_discovery.md:92`). Owner **CÓ** membership (mục 2) → **public alias lưu vào `owner membership.display_name`** — **không tạo nguồn alias mới**. `internal name/slug` non-PII, không project.
   - **Fail-closed:** khi `owner membership.display_name` **trống** → projector **KHÔNG** project public (personal meet giữ private/link-only). **CẤM** `person.display_name` thô. `club_display_name` = alias (giữ NOT NULL).
4. **Money/participant — GIỮ NGUYÊN đường tiền:** personal = tenant đầy đủ → join tạo **guest membership + player + charge**; reconcile/pay_code (DD-02) y hệt. Personal meet **được** có phí. *(host_pro cho personal = impl-mở; mặc định free.)*
5. **Availability:** Skip Club dùng được **bất kể** người tạo đã thuộc/own club khác (keyed theo person).
6. **Identity merge (DD-01) — decision table PIN:**
   - **Chỉ loser có personal** → re-parent `owner_person_id` sang canonical.
   - **Cả hai có personal** → **loser personal → `kind='club'` + clear `owner_person_id` TRƯỚC** (không update vào unique collision); giữ session/charge/tiền dưới tenant_id nó (không move cross-tenant, HR2).
   - **`tenant_admins` dedupe — predicate ĐÚNG scope + precedence:** chỉ row **`platform='web'`** chứa person UUID text (Zalo/Messenger dùng provider hash — **không đụng**). Re-parent predicate:
     ```
     platform = 'web' AND platform_user_lookup_hash = loser_person_id::text
     → set = canonical_person_id::text
     ```
     Nếu canonical đã có active web-admin cùng tenant → **giữ role cao nhất** theo precedence `owner > admin > co_admin` **trước khi** deactivate duplicate (tránh mất quyền `owner`). ⚠️ `tenant_admins.platform_user_lookup_hash` = UUID text **không FK** (`schema.ts:304`) → merge phải rewrite; `identity-model:213` chưa xử lý.
7. **Guards:** RLS đầy đủ; **rate-limit** `getOrCreatePersonalTenant`.
- **Nhược:** proliferation tenant nhỏ; nhánh UX; **billing free phụ thuộc DD-29 migration** (live `free_web` → logical free tier); public alias bắt buộc trước khi personal meet lên marketplace.

---

## 4.1 Ranh giới scope — DD-46 = authority KIẾN TRÚC

DD-46 đã ổn định ở tầng **kiến trúc + bất biến** (giữ `tenant_id NOT NULL`; personal = một loại tenant; shared provisioning core; đường tiền y hệt; marketplace fail-closed). **Chi tiết implementation** (SQL đầy đủ của `tenant_get_or_create_personal`, decision table merge đầy đủ + dedupe `tenant_admins`, tests concurrency create×merge/marketplace-alias) → **tách một design-probe/slice riêng** khi build, **KHÔNG** tiếp tục edge-patch vào DD này. DD-46 chốt các *quyết định*; slice thực thi các *chi tiết* dưới `feature_multi_tenant`/`feature_identity` + tests.

---

## 5. So sánh (A đã cân nhắc, KHÔNG chọn)

| Tiêu chí | A (không hỗ trợ — *không chọn*) | **B (personal tenant — ĐÃ CHỌN)** |
|---|---|---|
| HARD RULES | ✅ nguyên vẹn | ✅ nguyên vẹn (giữ tenant_id) |
| Kiến trúc mới | Không | Nhẹ (`kind`+`owner_person_id`+auto-provision, tái dùng WAO-UC-2/free) |
| Phục vụ "Skip Club" | ❌ | ✅ |
| Khớp beachhead club-first | ✅ | ✅ (personal = một loại tenant) |
| Rủi ro/UX | Thấp nhất | Trung bình (personal-vs-club, abuse → rate-limit) |

**Owner chọn B** để phục vụ casual pickup-game (đa môn, không cần lập club) ngay phase-1. A giữ lại làm tham chiếu; **không bao giờ** đụng nullable tenant_id.

---

## 6. Quyết định (đã chốt) — Option B "personal tenant"

**Owner 2026-07-13: chọn B.** Kèo không-CLB được hỗ trợ qua **personal tenant** (auto-provision, plan `free`, owner=self, `tenants.kind='personal'`) — **giữ nguyên `tenant_id NOT NULL` + RLS + money model**. Nullable tenant_id / session-không-tenant **CẤM vĩnh viễn**.

**Propagation khi build (xem `decisions.md` DD-46):** `tenants.kind` + auto-provision (WAO-UC-2) + 1-personal-per-person unique + rate-limit; điểm chạm `feature_multi_tenant`/`feature_web_auth_onboarding`/`feature_identity`/`feature_marketplace_discovery`/`feature_billing_lifecycle`. **Mở khoá cụm session-model** (DD-41/42/43/44/45). Không sửa spec Reviewed tới khi build (DD ✅ → theo checklist).

**Nguồn:** `packages/db/schema.ts` (sessions:214, tenants:152, tenant_id NOT NULL toàn bộ) · `feature_web_auth_onboarding.md:46` (WAO-UC-2) · `feature_billing_lifecycle.md` (plan free) · `0009_rls_policies_grants.sql` (RLS) · HANDOFF §3 (HARD RULES).
