# Feature: User Settings & Gender-based Pricing — Backend Tech Spec

> **Canonical phase:** P4
> **Version:** 0.17 · 2026-08-10
> **Status:** DD-39 ✅ · DD-47/48 ✅ framework — Draft, pending migration/build
> **Implementation:** Not started · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Product spec:** `../FE/feature_user_settings.md` *(Draft)*
> **References:** `../../standards/decisions.md` DD-39 (giá theo giới tính) · **DD-45 (first-activation waitlist promotion) · DD-49 (rejoin/correction)** · **DD-47 (follow graph) · DD-48 (profile visibility)** · DD-13 (Google/email — nguồn hồ sơ web) · `../BE/feature_payment_reconcile_tech.md` (suy charge) · `../BE/feature_session_management_tech.md` (đặt giá) · `feature_identity.md` (merge re-parent) · `feature_player_view.md` (profile path) · BRD MODULE 11 / FR-11 / NFR-P1

> ✅ **Follow + private/public (DD-47/48 — framework chốt, §6):** `person_follows` là global protected, không table grant cho `app`; chỉ narrow `SECURITY DEFINER`. Existing users backfill private, new users default public. Social DTO chỉ chứa field có canonical source; self và host operational paths tách riêng. Migration mới — số monotonic kế tiếp sau tail đã sync (hiện `0024`); code chưa build.
>
> ✅ **DD-70(a) owner-final target (runtime chưa build):** only a newly-created private follow request appends a global item, in the same fence-first transaction. `follow_accepted` is analytics-only; visibility bulk auto-accept emits no notification. Tenant outbox is not a global fallback; option (b) SSE-only/offline-loss đã bị loại.

> ✅ **DD-39 chốt (2026-07-10).** Schema dưới đây là **thiết kế đã pin** (fail-closed khi decrypt lỗi); authoritative khi thực thi là `packages/db/schema.ts` + `migrations/*.sql` (**migration mới — số monotonic kế tiếp sau tail đã sync, hiện `0024`**) + `decisions.md` DD-39. **KHÔNG** tạo bảng song song với `persons/sessions/charges`; `persons` vẫn là anchor người thật (§P6). Propagation vào `feature_session_management`/`feature_payment_reconcile` (FR-5.3) khi build.

---

## 1. Tổng quan triển khai

```text
Profile settings (web) → persons.{gender,dob,username,language} (PII enc at-rest)
Host set session price → sessions single price | price_male/price_female
Player joins → create charge → deriveChargeAmount(session, person.gender)
Public projection → field-whitelist (KHÔNG gender, KHÔNG per-gender price/PII)
```

**Hai mảng:**
1. **Hồ sơ người dùng** — giới tính, ngày sinh, tên hiển thị, username (duy nhất toàn hệ), ngôn ngữ (vi/en).
2. **Giá theo giới tính** — kèo cho phép **giá đơn** hoặc **giá nam/nữ**; khi tạo `charge`/`debt` cho member → suy giá theo `person.gender`.

**Design decisions:**
- `gender`/`dob` là **PII có consent**, **mã hoá at-rest** (`*_enc` bytea, KMS), **KHÔNG lộ ra public marketplace** (NFR-P1/NFR-S2/CO-5).
- Host của CLB member tham gia chỉ thấy giới tính **ở mức cần cho suy giá** (kết quả giá, không phơi raw gender ra marketplace).
- Member **thiếu gender** (`gender_enc IS NULL`) khi kèo đặt giá nam/nữ → **fallback giá mặc định** + nhắc set (không đoán giới tính). **Nhưng** nếu `gender_enc` có mà **decrypt lỗi (KMS)** → **fail-closed**, KHÔNG tạo charge (không fallback — tránh tính sai tiền).
- `username` duy nhất toàn hệ; đổi có kiểm tra trùng.

### Entry points

| Entry | Caller | Mô tả |
|-------|--------|-------|
| `PATCH /api/me/profile` | Player (web) | Update gender/dob/username/language (PII enc at-rest) |
| `PUT /api/me/username` | Player (web) | Set/change unique username (global uniqueness check) |
| `deriveChargeAmount(session, person.gender)` | SessionService / Join flow | Derive price from gender when host sets male/female pricing |
| `POST /api/me/follow/:personId` | Player (web) | Create private follow request → global notification (DD-70a) |
| `DELETE /api/me/follow/:personId` | Player (web) | Unfollow |
| KMS decrypt `gender_enc`/`dob_enc` | Internal | Fail-closed: decrypt error → block charge creation |

---

## 2. Database Schema + Edge Cases (BE) — contract đã pin, migration pending

### Schema (đã pin — trỏ schema.ts/migrations khi thực thi)

```sql
-- Mở rộng persons (anchor có sẵn) — expand→contract migration, KHÔNG tạo bảng users
ALTER TABLE persons
  ADD COLUMN gender_enc bytea,                    -- PII enc at-rest (KMS); DD-39 set: male|female|other|undisclosed
  ADD COLUMN dob_enc bytea,                        -- PII enc at-rest
  ADD COLUMN username text,                        -- duy nhất toàn hệ (unique global)
  ADD COLUMN language text NOT NULL DEFAULT 'vi' CHECK (language IN ('vi','en'));
CREATE UNIQUE INDEX persons_username_uq ON persons(lower(username)) WHERE username IS NOT NULL;
-- display_name đã có sẵn trên persons (schema.ts).

-- Giá theo giới tính trên sessions: giá đơn (priceAmount có sẵn) HOẶC price_male/price_female
ALTER TABLE sessions
  ADD COLUMN price_male integer CHECK (price_male IS NULL OR price_male >= 0),
  ADD COLUMN price_female integer CHECK (price_female IS NULL OR price_female >= 0);
-- Quy ước: cả hai NULL → dùng price_amount (giá đơn). Set ≥1 trong hai → chế độ giá theo giới tính
-- (bên thiếu fallback về price_amount). Phase-1 storage is these columns; no parallel price table.
```

> **Chọn hình thức giá:** phase-1 dùng **cột `price_male`/`price_female` trên `sessions`** (2 nhóm giá phổ biến CLB cầu lông/pickleball VN). Nếu tương lai cần >2 nhóm → mở quyết định/migration sang bảng `session_price_by_gender(session_id, gender, amount)`. **DD-39 đã ✅** — hình thức cột (2 nhóm) chốt ở migration có **số monotonic kế tiếp còn trống sau khi sync mọi prerequisite đã merge**; `0014_players_waitlist` đã merge (`1a6ac38`) và giữ số của nó — không ảnh hưởng số slice này sẽ nhận (tail hiện tại: `0024`).

### Migration & Rollback

> Grep live `packages/db/migrations/` (`0000`–`0024` đã merge trên main, 25 migrations; tail `0024_public_visibility_capacity_check.sql`): `persons` **đã tồn tại từ `0001_global_directory.sql`**, `sessions` **từ `0002_tenants_core.sql`** — reuse/ALTER additive, **không recreate**, không tạo bảng `users` song song. **Chưa có** trong `0000`–`0024`: `persons.{gender_enc, dob_enc, username, language, profile_visibility}`, `sessions.{price_male, price_female}`, bảng `person_follows` + narrow `SECURITY DEFINER` functions — toàn bộ là genuinely new.

- **Migration:** migration mới monotonic sau tail đã merge (số chốt sau khi sync prerequisites — blockquote trên; `0014` đã merge và giữ số của nó, không ảnh hưởng số slice này sẽ nhận). DD-39 = ALTER additive trên `persons`/`sessions`; DD-47/48 = transaction §6.1 (backfill existing `private` → default `public` → NOT NULL/CHECK) + `person_follows` + REVOKE/GRANT narrow functions.
- **Rollback:**

| Bước | Hành động | An toàn? |
|------|-----------|----------|
| 1 | Disable settings/username/pricing routes (§3) + follow/visibility/profile routes (§6.4) + charge-create wiring `deriveChargeAmount` | ✅ |
| 2 | Migration revert mới: revert **CHỈ additive objects của slice** — DROP các cột mới trên `persons`/`sessions`, DROP `person_follows` + narrow functions/grants | ✅ Có điều kiện — mất data cột mới (gender/dob đã thu theo consent) |
| 3 | Drop baseline `persons` (`0001`) / `sessions` (`0002`) | ❌ NEVER — anchor identity + session data thật, đã apply trên main |

### Charge derivation (đã pin — chạm `feature_payment_reconcile` FR-5.3 khi build)

```text
deriveChargeAmount(session, person):
  if session không đặt giá theo giới tính → return session.price_amount

  # PHÂN BIỆT 2 CASE (bắt buộc — DD-39):
  if person.gender_enc IS NULL:                  # (1) gender THẬT SỰ chưa set — trạng thái hợp lệ
      return session.price_amount (fallback) + flag "gender chưa set → nhắc set"

  try:
      g = decrypt(person.gender_enc)             # dưới authz, không log
  except KmsError | DecryptError:                # (2) LỖI HẠ TẦNG — KHÔNG phải "thiếu gender"
      FAIL-CLOSED: throw typed CHARGE_DERIVATION_UNAVAILABLE; KHÔNG tạo charge với giá fallback
                   # helper không enqueue; caller sở hữu rollback/event/retry policy

  if g == 'male'   and price_male   != NULL → price_male
  if g == 'female' and price_female != NULL → price_female
  else → session.price_amount (bên giá thiếu → fallback price_amount)
```

> ⚠️ **KHÔNG gộp decrypt-fail vào nhánh "gender thiếu".** `gender_enc IS NULL` = chưa set (fallback + nhắc, hợp lệ). `gender_enc` có giá trị nhưng decrypt fail = lỗi KMS/hạ tầng → **fail-closed**, không tạo charge (nếu fallback sẽ tính sai tiền cho người đã set gender). Đây là ràng buộc đường tiền (HR2).
>
> **Caller behavior đã pin (DD-45×DD-49):** `deriveChargeAmount` chỉ trả amount hoặc typed failure; không tự enqueue. Direct first-entry active join/approve failure → rollback riêng transaction, không active player/charge/venue (new guest membership cũng rollback; request vẫn pending). First-activation waitlist opener failure giữ candidate `waitlisted`/no-charge/no-venue; SessionService owns audit + candidate event referencing a root `promotion_retry_id` lazy-created on first failure. Root CAS/lease job runs max 3 claimed attempts; each completed current-order sweep tries each candidate at most once. Sibling events never fork budget/job, owner digest dedupes per root, and expired final claim resolves-or-terminalizes without derivation/attempt 4. Proven DD-49 rejoin promotion revalidates live aggregate: chưa-refund carry-over; refunded append chỉ atomic với activation; full defers. Không chạy charge-create derivation hay fallback giá.
>
> **One-payment-truth boundary (DD-91):** `deriveChargeAmount` chỉ sở hữu **write-time amount** của charge; sau khi charge commit, canonical `charges.amount_due` + allocations là authority. Player View `getSelfPaymentStatus`/`remainingAmount` sở hữu read-time status cho Home, `/api/me/charges`, exact `/pay` và notification detail. Các reader không được decrypt gender hoặc chạy lại công thức giá để suy nợ.

### Public projection (giữ NFR-S2/CO-5)

`public_sessions` field-whitelist **KHÔNG** gồm `gender` và **KHÔNG** per-gender price/PII. Với kèo giá theo giới tính, public hiển thị **giá đại diện** (vd `price_amount` hoặc khoảng giá) — không lộ nhóm giá theo giới tính, không lộ giới tính member.

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Gender/dob lộ ra public | ❌ NEVER — không vào `public_sessions` whitelist (test bất biến) |
| 2 | Security | Gender/dob lưu plaintext / log | ❌ NEVER — `*_enc` KMS, redaction |
| 3 | Data Integrity | Member thiếu gender, kèo giá nam/nữ | Fallback `price_amount` + nhắc set — không đoán |
| 4 | Data Integrity | Username trùng | Reject `USERNAME_TAKEN` (unique lower(username)) |
| 5 | Concurrency | 2 người đặt cùng username | UNIQUE index — một thắng |
| 6 | Data Integrity | Giá nam/nữ âm | CHECK ≥ 0 |
| 7 | Cross-Feature | Đổi gender sau khi có charge | Charge đã tạo bất biến; chỉ ảnh hưởng charge mới (không retroactive tự động) |
| 8 | Security | Host xem gender member CLB khác | ❌ Chỉ host của CLB member tham gia, ở mức suy giá (authz per-tenant) |
| 9 | Privacy | Consent chưa cấp | Không thu gender/dob; giá về mặc định |
| 10 | Data Integrity | Đổi hồ sơ | Sync mọi surface (canonical → project) |
| 11 | Financial/Resilience | KMS/decrypt fail trong first-activation waitlist promotion | Candidate giữ waitlisted/no-charge/no-venue; audit+retry/owner-alert; opener commit; continue next; không fallback `price_amount`. Proven DD-49 rejoin promotion không chạy derivation này |

---

## 3. API Contract — build contract

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET | /api/me/settings | Authenticated Person | Hồ sơ của tôi (gender/dob giải mã cho chính chủ) |
| PUT | /api/me/settings | Authenticated Person | Cập nhật gender/dob/display_name/language (consent) |
| PUT | /api/me/username | Authenticated Person | Đổi username (check trùng) |
| PATCH | /api/sessions/:id/pricing | TenantAdmin | Đặt giá đơn hoặc `price_male`/`price_female` |

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 409 | `USERNAME_TAKEN` | Username đã tồn tại | Trùng lower(username) |
| 400 | `INVALID_GENDER` | Giá trị giới tính không hợp lệ | Ngoài enum |
| 403 | `GENDER_FORBIDDEN` | Không có quyền xem giới tính | Không phải chính chủ / host CLB liên quan |

### Request/Response Examples

> DTO minh hoạ theo contract đã pin; field name cụ thể chốt ở build slice; envelope DD-60 (`../../standards/api-reference-convention.md`).

**PUT `/api/me/username`** — đổi username (check trùng qua UNIQUE `lower(username)` §2):

- Request:

```json
{ "username": "…" }
```

- Success:

```json
{ "data": { "username": "…" }, "error": null, "meta": { "requestId": "req_…" } }
```

- `409` — trùng username (Error Codes trên):

```json
{ "data": null, "error": { "code": "USERNAME_TAKEN", "message": "Username đã tồn tại", "statusCode": 409 }, "meta": { "requestId": "req_…" } }
```

**PUT `/api/me/settings`** — `400` giá trị ngoài enum DD-39:

```json
{ "data": null, "error": { "code": "INVALID_GENDER", "message": "Giá trị giới tính không hợp lệ", "statusCode": 400 }, "meta": { "requestId": "req_…" } }
```

### Idempotency

| Endpoint | Idempotent? | Key |
|----------|-------------|-----|
| PUT `/api/me/settings` | ⬜ chưa pin — chốt ở build slice | — |
| PUT `/api/me/username` | ⬜ chưa pin — chốt ở build slice (UNIQUE `lower(username)` là constraint chống trùng, không phải retry key) | — |
| PATCH `/api/sessions/:id/pricing` | ⬜ chưa pin — chốt ở build slice | — |
| Follow/unfollow/approve/reject/remove (§6.4) | ✅ | State-idempotency theo canonical state (§6.2): UNIQUE edge, duplicate trả edge hiện tại, delete absent = no-op; **không** dùng tenant `processed_commands` |
| PUT `/api/me/settings/visibility` | ⬜ chưa pin — chốt ở build slice (mutation serialize theo lock §6.2) | — |

---

## 4. Chi tiết triển khai — build contract

- **PII at-rest:** `gender_enc`/`dob_enc` mã hoá KMS (như `phone_enc`); giải mã dưới authz person-self hoặc host-of-tenant cho suy giá; **không** log plaintext.
- **Suy giá:** `deriveChargeAmount` chạy trong ledger/charge-create path (`feature_payment_reconcile` FR-5.3); fallback default + nhắc set khi thiếu gender.
- **Ranh giới read:** kết quả derivation được persist vào canonical `charges.amount_due`; Home/chat/notification đọc qua Player View payment service, không gọi lại `deriveChargeAmount` và không tự re-derive theo gender.
- **Sync:** đổi hồ sơ = command → canonical → project (username/display_name/language hiện đúng mọi surface).
- **Ngôn ngữ:** `persons.language` ưu tiên cho message tới person; tenant locale (`tenants.locale`) là mặc định CLB (NFR-L1).

### Caching Strategy

| Data | Cache? | TTL | Invalidation |
|------|--------|-----|-------------|
| `deriveChargeAmount` inputs (gender/giá session) | ❌ | — | Đường tiền HR2 — decrypt dưới authz trong charge-create transaction, fail-closed khi KMS lỗi (§2) |
| PII plaintext (gender/dob) | ❌ | — | Không cache/log plaintext (§4, edge #2); chỉ decrypt on-demand dưới authz |
| Social profile DTO / visibility gating (§6.3) | ❌ | — | Authz decision path fail-closed — đọc canonical `profile_visibility` + follow edge live |
| Settings self-read (`/api/me/settings`) | ❌ | — | Fail-closed — đọc canonical trực tiếp; cache nếu có chốt ở build slice |

### Security Checklist (template v2.33 — map về section đã pin)

| Mục | Trả lời trong spec |
|-----|---------------------|
| Authorization/ownership | §3/§6.4: Authenticated Person / TenantAdmin / Followee per endpoint; actor từ verified session, URL/body chỉ mang target (§6.1 actor binding, edge F4); host chỉ thấy gender ở mức suy giá per-tenant (edge #8, `GENDER_FORBIDDEN`); `person_follows` GLOBAL PROTECTED, no table grant, chỉ narrow `SECURITY DEFINER` (§6.1, edge F10) |
| Injection/validation | §2: CHECK enums (`language`, giá ≥ 0), UNIQUE `lower(username)`; §3 `INVALID_GENDER` ngoài enum; §6.1 CHECK no-self/decision-shape; §6.3 minimal card cố định, không dùng 403 body biến thiên làm oracle (§6.4) |
| Secret & log redaction | §2/§4: `gender_enc`/`dob_enc` KMS at-rest như `phone_enc`, không plaintext trong DB/log (edge #2, test #5); decrypt không log (§2 charge derivation) |
| Webhook signature + replay | N/A — không có webhook trong feature này |
| Idempotency | §3 bảng Idempotency + §6.2 state-idempotency (không dùng tenant `processed_commands`) |
| Data retention/xoá | §2 edge #9: consent chưa cấp → không thu gender/dob; retention/erasure per-field chưa pin trong doc này — theo `feature_security_operations_tech.md` |

---

## 5. Testing Plan — build contract

| # | Test | Expected |
|---|------|----------|
| 1 | Public không lộ gender | `public_sessions` serializer không có gender/per-gender price |
| 2 | Charge theo gender | male→price_male, female→price_female |
| 3 | Thiếu gender (`gender_enc IS NULL`) fallback | → price_amount + nhắc set (hợp lệ) |
| 3b | **`gender_enc != NULL` + KMS/decrypt FAIL** | Helper throws typed failure; **không tạo charge/fallback và không tự enqueue**; caller-specific test owns effect |
| 3c | KMS/decrypt FAIL trong first-activation waitlist promotion (DD-45) | Candidate/player/position unchanged; opener commits; first failure lazy-creates one root and candidate event. Retry CAS/lease max 3 claimed attempts; each completed sweep visits candidate once, siblings share budget/root digest. Expired final claim resolves-or-terminalizes without attempt 4; persistent failure→review/DLQ. Proven DD-49 rejoin không vào nhánh này |
| 4 | Username trùng | `USERNAME_TAKEN` |
| 5 | Gender enc at-rest | Cột `*_enc`; không plaintext trong DB/log |
| 6 | Host CLB khác xem gender | 403 |
| 7 | Đổi gender không retroactive | Charge cũ giữ nguyên |
| 8 | Consent chưa cấp | Không thu gender; giá mặc định |

---

## 6. Follow & Profile Visibility (DD-47/48) — framework chốt, build P4+

> `person_follows` là **GLOBAL PROTECTED** như `persons`/`accounts`: no RLS nhưng cũng **no table grant** cho `app`/PUBLIC. Identity service chỉ gọi narrow `SECURITY DEFINER` functions; app authz là lớp bổ sung, không phải DB boundary.

### 6.1 Schema + privileged boundary (đã pin)

```sql
-- Existing profiles chưa từng public cross-user: preserve privacy fail-closed.
-- Chạy trong một migration transaction.
ALTER TABLE persons ADD COLUMN profile_visibility text;
UPDATE persons SET profile_visibility = 'private';
ALTER TABLE persons ALTER COLUMN profile_visibility SET DEFAULT 'public';
ALTER TABLE persons ALTER COLUMN profile_visibility SET NOT NULL;
ALTER TABLE persons ADD CONSTRAINT persons_profile_visibility_chk
  CHECK (profile_visibility IN ('public','private'));

-- Social follow graph: cạnh CÓ HƯỚNG follower→followee (global, no tenant_id)
CREATE TABLE person_follows (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_person_id  uuid NOT NULL REFERENCES persons(id),
  followee_person_id  uuid NOT NULL REFERENCES persons(id),
  status              text NOT NULL CHECK (status IN ('pending','accepted')),
  requested_at        timestamptz NOT NULL DEFAULT now(),
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_follows_no_self CHECK (follower_person_id <> followee_person_id),
  CONSTRAINT person_follows_decision_shape
    CHECK ((status = 'pending') = (decided_at IS NULL))
);
CREATE UNIQUE INDEX person_follows_edge_uq
  ON person_follows(follower_person_id, followee_person_id);
CREATE INDEX idx_person_follows_followee ON person_follows(followee_person_id, status);
CREATE INDEX idx_person_follows_follower ON person_follows(follower_person_id, status);

-- GLOBAL PROTECTED: role app/PUBLIC không chạm bảng trực tiếp.
REVOKE ALL ON TABLE person_follows FROM app, PUBLIC;
-- Mỗi person_follow_* / person_profile_* fn:
-- SECURITY DEFINER + fixed search_path;
-- REVOKE ALL ON FUNCTION ... FROM PUBLIC;
-- GRANT EXECUTE ON FUNCTION ... TO app;
```

> **Actor binding:** identity service resolve actor từ verified session/channel identity; URL/body chỉ mang target/follower id. Privileged fn re-check `actor=follower` cho follow/unfollow và `actor=followee` cho approve/reject/remove. Function list gồm follow/unfollow/approve/reject/remove/list + profile visibility/read; fixed search path và fail-closed.
>
> **Status + concurrency:** `status` không có default; `person_follow_*` luôn ghi tường minh. Theo owner-final target DD-70(a), follow/pair mutations inventory actor+target read-only, lock their inbox fences UUID-order, then lock pair/Person rows and re-derive state; drift rolls back/retries. Visibility mutation locks only the actor fence/Person and serializes the bounded follow-state update under its canonical owner; private→public auto-accept writes analytics only, not one item per follower. Known producers must obey this order or build HALT — no tenant-outbox projector fallback. Đây là target contract, chưa phải runtime.

### 6.2 Follow lifecycle

```text
follow(actor, target):
  if actor == target → FOLLOW_SELF_FORBIDDEN
  if canonical chat_blocks says either direction blocked → FOLLOW_NOT_ALLOWED (generic)
  lock inbox_fences[actor,target] in Person UUID order        # DD-70(a), before Person/source rows
  lock persons[target] FOR UPDATE
  re-check block/current canonical actor+target after locks; drift → rollback
  visibility = persons[target].profile_visibility
  status = (visibility == 'public') ? 'accepted' : 'pending'
  call person_follow(actor-from-session, target)              # fn upsert/return current edge
  if visibility == 'private' and new row → append source-derived follow_request item in this TX (DD-70(a))
  if visibility == 'public' → analytics follow_accepted only; no notification

approve/reject(followee=actor, follower):   # chỉ followee
  approve → status='accepted', decided_at=now()
  reject  → DELETE edge

block(actor, target):
  call canonical DD-55 chat safety service / `chat_blocks` store
  in one command: upsert block + delete follow edges actor↔target + audit
  future follow/approve/DM request-create-send-read → generic deny
unblock(actor, target): delete own block + audit; DO NOT restore old follow edges/DM access

unfollow(actor=follower) → fn DELETE own edge; absent = success/no-op
removeFollower(actor=followee, follower) → fn DELETE incoming edge; absent = success/no-op

setVisibility(actor, v):
  lock inbox_fences[actor]                         # DD-70(a), before Person/follow rows
  lock persons[actor] FOR UPDATE
  re-check current visibility + affected follow set; drift → rollback/retry
  'private'→'public': UPDATE pending→accepted (auto-accept), decided_at=now()
                      append analytics only; no follow_accepted item/fan-out/follower fences
  'public'→'private': giữ nguyên accepted (grandfather); follow mới → pending
```

Idempotency theo canonical state, không dùng `processed_commands` vì store đó tenant-scoped: duplicate follow/approve trả edge hiện tại; duplicate delete là success/no-op; approve edge chưa từng tồn tại trả `FOLLOW_NOT_FOUND`.

### 6.3 Profile read gating (fail-closed, default-deny)

```text
getProfile(viewer V, target T):
  if V == T                          → route /api/me (không dùng social DTO)
  vis = persons[T].profile_visibility
  if vis == 'public'                 → APPROVED_SOCIAL_FIELDS(T)
  # vis == 'private':
  if person_follows(V→T)=='accepted' → APPROVED_SOCIAL_FIELDS(T)
  else                               → FIXED MINIMAL card (no profile fields; placeholder avatar, 'private', follow/request CTA)
```

- **Approved field/source matrix:** `display_name ← persons.display_name`; `username ← persons.username` sau migration DD-39; `plexco_since ← coarse month/year(persons.created_at)`. Avatar và `sports[]` **exclude** tới khi có canonical field/model; không derive từ memberships/sessions. Aggregate số buổi vẫn open và default exclude.
- **Host operational access:** host đọc mức cần cho roster/suy giá/đối soát qua tenant-scoped membership/roster API dưới RLS. Host role không widen social profile serializer và không đưa gender/charge vào `GET /api/persons/:id/profile`.
- **⚠️ Ranh giới:** gating này **chỉ** cho **profile xã hội cross-user**. **KHÔNG** thay/nới RLS-membership (roster/charge của host giữ nguyên) và **KHÔNG** đụng đường tiền (HR1/HR2). Private **không** gỡ `players`/`charges` của T.

### 6.4 API Contract (framework đã pin)

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| PUT | /api/me/settings/visibility | Authenticated Person | Đặt `public`/`private` (áp auto-accept/grandfather) |
| GET | /api/persons/:id/profile | Authenticated Person | Social profile cross-user only; không self/host operational DTO |
| POST | /api/persons/:id/follow | Authenticated Person | Follow (auto-accept nếu public; pending nếu private); idempotent |
| DELETE | /api/persons/:id/follow | Authenticated Person | Unfollow |
| GET | /api/me/followers?status=pending | Authenticated Person | Yêu cầu theo dõi đến |
| POST | /api/me/followers/:followerId/approve | Followee | Duyệt follower |
| POST | /api/me/followers/:followerId/reject | Followee | Từ chối (xoá edge) |
| DELETE | /api/me/followers/:followerId | Followee | Remove follower |
| GET | /api/me/following · /api/me/followers | Authenticated Person | Danh sách của tôi |
| POST | /api/chat/block | Authenticated Person | Canonical DD-55 block service; User Settings/Profile chỉ là surface |
| DELETE | /api/chat/block/:targetPersonId | Authenticated Person | Canonical unblock; không restore follow edge |

**Error codes:** `FOLLOW_SELF_FORBIDDEN` (400), `FOLLOW_NOT_FOUND` (404), `NOT_FOLLOWEE` (403). Private social profile trả `200` với minimal-card DTO cố định, không dùng 403 body biến thiên làm oracle.

### 6.5 Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| F1 | Data Integrity | Self-follow | CHECK `person_follows_no_self` → reject |
| F2 | Concurrency | 2 request follow đồng thời | Narrow fn + `UNIQUE` + return current edge → 1 edge, state-idempotent |
| F3 | Privacy | Profile path lộ tiền/PII/roster | ❌ NEVER — approved social fields có canonical source (test bất biến), fail-closed |
| F4 | Security | person ID từ URL/body để xem/ghi | URL/body chỉ target; actor từ verified session; privileged fn re-check ownership |
| F5 | Cross-Feature | Merge person (DD-01) | Lock incident edges; canonicalize endpoints; drop self + collapse duplicate (`accepted>pending`) **trước** update survivors để không vỡ UNIQUE; cùng merge tx/audit |
| F6 | Data Integrity | Đổi visibility | private→public: pending→accepted; public→private: grandfather accepted |
| F7 | Cross-Feature | Private ảnh hưởng roster/charge của host | ❌ KHÔNG — RLS/membership + tiền không đổi (HR1/HR2) |
| F8 | Abuse | reject rồi re-request | Rate-limit; canonical `chat_blocks` chặn follow/approve/DM ở shared predicate |
| F9 | Privacy | reliability per-tenant (DD-42) lộ qua profile | ❌ NEVER — tenant-scoped, không vào approved social fields |
| F10 | Security | role `app`/PUBLIC đọc bảng trực tiếp hoặc PUBLIC execute fn | ❌ REVOKED; test grants chỉ cho narrow function execution |
| F11 | Privacy | Host mở social profile của member private | Minimal/approved theo follow như viewer khác; operational data chỉ ở tenant route |
| F12 | Migration | Existing profile gặp migration giữa chừng | Transaction rollback hoặc vẫn private; không có window public hoá ngầm |
| F13 | Concurrency | Follow đồng thời private↔public toggle | Cùng target-row lock; edge phản ánh visibility theo serialization order, không default-accepted fail-open |
| F14 | Abuse | Block pair đã có follow pending/accepted | Block command gỡ edge hai chiều atomically; future follow/approve/DM generic deny; unblock không restore |
| F15 | Architecture | User Settings tạo bảng/block predicate riêng | ❌ NEVER — reuse `chat_blocks` + canonical DD-55 safety service |

### 6.6 Testing Plan (framework đã pin)

| # | Test | Expected |
|---|------|----------|
| F-1 | Follow public | edge `accepted` ngay |
| F-2 | Follow private | edge `pending`; approve→accepted; reject→deleted |
| F-3 | Self-follow | reject (CHECK) |
| F-4 | Follow trùng | idempotent (1 edge) |
| F-5 | Profile private + non-follower + non-host | fixed minimal card, **không** display_name/username/plexco_since/stats/PII/tiền |
| F-6 | Profile private + host non-follower | Social route minimal; tenant operational route vẫn trả đúng scoped data |
| F-7 | Social field matrix | Chỉ display_name/username-khi-migrated/plexco_since; không avatar/sports/aggregate khi thiếu source; không PII/tiền/tenant data |
| F-8 | Đổi visibility | private→public auto-accept; public→private grandfather |
| F-9 | Merge person | re-parent + dedupe + drop self-edge; edge follow không nhân đôi/trỏ mồ côi |
| F-10 | Private không đụng roster/tiền | `players`/`charges` của user private không đổi; host vẫn thấy |
| F-11 | DB grants — `app`/PUBLIC direct table access + PUBLIC execute | denied; `app` execute narrow fn only |
| F-12 | Migration existing/new — existing rows + row tạo sau migration | existing=`private`, new=`public`, no NULL/window leak |
| F-13 | Follow ↔ visibility race — hai transaction ngược thứ tự | Target-row lock serialize; private không nhận edge auto-accepted do stale read |
| F-14 | Block vs follow race | Canonical pair lock serialize; end-state blocked + no follow edge; no notification/DM leak |
| F-15 | Unblock | Block removed, no old follow edge restored; new follow obeys current visibility |
| F-16 | Cross-surface parity | Block from profile/settings then DM/follow from chat/API | Same canonical denial and audit; one block row/store |
| F-17 | Visibility bulk auto-accept under DD-70(a) | Update all pending edges + analytics under actor/domain lock; zero `follow_accepted` notification rows, zero unbounded follower-fence acquisition |

### 6.7 Chi tiết triển khai (impl-gap)

- **Notify follow-request (person-directed global):** `notification_intents`/tenant `outbox_events` không cover event global. Theo DD-70(a), only a newly-created private follow request uses `candidate read → ordered inbox fences → Person/source → child` and appends via owner-derived helper in the same transaction; never lock target Person first then fence. If the canonical mutation cannot be reordered safely, build HALT pending an explicit GLOBAL PROTECTED source-event owner. Option (b) SSE/person-self with offline loss **đã bị loại**; runtime vẫn chưa build.
- **Sync (HR3):** đổi visibility/follow state = command → canonical → normal surface projection. Durable global notification, nếu có, là same-transaction item từ canonical source — không có notification projector song song.
- **i18n (HR5):** mọi chuỗi ("Hồ sơ riêng tư", nút follow/request…) qua `t(vi, en)`.

---

## 7. Rollout Plan + Changelog

### Rollout follow/visibility (DD-47/48 ✅ framework; khi mở build P4+)

1. Sau migration DD-39, add nullable `profile_visibility`; backfill existing private; set new default public + NOT NULL/CHECK trong một transaction.
2. Tạo `person_follows` global protected; no table grant; narrow functions fixed search path + explicit revoke/grant tests.
3. Follow service/API dùng state-idempotency (`UNIQUE`/no-op), không tái dùng tenant `processed_commands`.
4. Social profile serializer theo field/source matrix; `/api/me` và host operational routes giữ tách biệt.
5. Merge plan thêm lock/canonicalize/drop-self/dedupe-before-update cho follow edges.
6. Test migration, grants, actor binding và invariant không lộ tiền/PII/roster/tenant activity.
7. Wire profile/settings Block UI to canonical DD-55 chat safety service; do not add a User Settings block table.

### Rollout gender-pricing (khi DD-39 ✅)

1. Migration `persons.{gender_enc,dob_enc,username,language}` + `sessions.price_male/female`.
2. Settings API + username uniqueness.
3. `deriveChargeAmount` vào mọi **charge-create** path (direct first-entry join/approve + first-activation waitlist promotion); helper chỉ return/throw, caller sở hữu rollback/event. DD-49 rejoin path dùng correction core: active→carry-or-append-refunded, full→carry-history-or-defer-refunded; không tạo charge row mới.
4. Test bất biến public không lộ gender + no-fallback/no-active-without-charge.

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-08-10 | v0.17 | **A-grade upgrade:** thêm Entry points table (6 entries); bump version. Không đổi contract/settings model. |
| 2026-07-27 | v0.16 | Reconcile migration live `0000`–`0024` (25 migrations, tail `0024`) và cập nhật mọi current-tail marker. Pin DD-91 one-payment-truth boundary: gender pricing chỉ derive lúc ghi `charges.amount_due`; Home/chat/notification đọc canonical Player View status, không chạy lại công thức. Reconcile DD-70(a) từ stale proposal/conditional sang owner-final target, option (b) đã bị loại; runtime vẫn chưa build. |
| 2026-07-26 | v0.15 | **Merge-state reconcile:** `0014_players_waitlist` đã merge (`1a6ac38`); tail sync hiện `0000`–`0022` (23 migrations). Sửa 5 dòng current-state stale (dòng 10, 14, 61, 65, 67) từng nói `0000`–`0013` là merged set / `0014` branch-only. Giữ nguyên GUIDANCE đánh số (monotonic kế tiếp sau tail đã sync) và danh sách genuinely-new không đổi. Không đổi schema/code/DD; Status/Implementation không đổi. |
| 2026-07-19 | v0.14 | **Template v2.30/v2.33 uplift:** thêm §2 Migration & Rollback (reuse/ALTER `persons`/`sessions` baseline `0001`/`0002`; mọi object DD-39/DD-47/48 = migration mới monotonic), §3 Request/Response Examples (DD-60 envelope) + Idempotency, §4 Caching Strategy + Security Checklist. Derivative/editorial — không đổi contract. |
| 2026-07-19 | v0.13a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-19 | v0.13 | **DD-70(a) v1.70 propagation:** private follow-request appends same-TX under bounded fences; `follow_accepted` remains analytics-only and visibility auto-accept has no notification fan-out; tenant outbox fallback forbidden. No runtime/migration. |
| 2026-07-19 | v0.12 | **Intermediate doc revision; superseded by v0.13 for DD-70 ownership.** No runtime/migration. |
| 2026-07-19 | v0.11 | **DD-45 retry-owner mirror:** candidate failure events point to one root max-3 promotion-sweep job; helper still returns/throws only and never owns event/job effects. No runtime. |
| 2026-07-19 | v0.10 | **Superseded by v0.13:** initial DD-70(a) lock-order propagation. No runtime. |
| 2026-07-19 | v0.9 | **Caller-ownership closure:** `deriveChargeAmount` returns/throws only; direct joins rollback, only first-activation waitlist opener owns the entry/origin-bound failure event. Mirror CAS/lease max-3 retry and active-only refunded lifecycle. |
| 2026-07-19 | v0.8 | **DD-45×DD-49 consistency:** scope `deriveChargeAmount` failure contract to first-entry/direct charge-create and first-activation promotion; proven rejoin promotion revalidates/carries canonical aggregate and does not create or derive a second charge. |
| 2026-07-17 | v0.7 | **DD-39 storage/value-set closure:** gender enum is resolved; phase-1 pricing uses only additive `price_male/price_female` columns beside `price_amount`, with no competing table path. |
| 2026-07-17 | v0.6 | **USR-OQ-7 closure:** follow lifecycle consults canonical DD-55 `chat_blocks`; block atomically removes bilateral follow edges and gates DM/follow; profile/settings are thin surfaces, no second store. |
| 2026-07-15 | v0.5 | **DD-39×DD-45 caller behavior:** direct active join/approve derivation failure rolls back that transaction; waitlist promotion keeps candidate waitlisted/no-charge/no-venue, writes one audit + canonical failure outbox event without rolling back opener, and continues queue; retry/alert consume the event. |
| 2026-07-15 | v0.4 | **DD-47/48 framework ✅:** global-protected narrow functions + actor binding; state-idempotency không dùng tenant command ledger; staged existing-private/new-public migration; sourced social field matrix; tách `/api/me`, social profile và host operational paths. |
| 2026-07-10 | v0.1 | Draft khởi tạo (DD-39 🟡): đề xuất `persons.{gender,dob,username,language}` (PII enc), `sessions.price_male/price_female`, `deriveChargeAmount` theo gender, public projection loại gender. Chạm `feature_session_management`/`feature_payment_reconcile` là pointer tới khi DD-39 ✅. |
| 2026-07-10 | v0.2 | **DD-39 ✅ + fail-closed (review fix):** `deriveChargeAmount` tách rõ `gender_enc IS NULL` (fallback giá + nhắc, hợp lệ) khỏi **decrypt/KMS FAIL** (**KHÔNG tạo charge**, enqueue retry + alert — HR2 đường tiền). Thêm test §5 case 3b (`gender_enc != NULL` + decrypt fail ⇒ no charge). |
| 2026-07-11 | v0.3 | **Thêm §6 Follow & Profile Visibility (DD-47/48 🟡).** Schema `person_follows` (global, no RLS, authz app-level; cạnh có hướng, `pending/accepted`, `UNIQUE`+`CHECK no-self`) + `persons.profile_visibility` (default `public`); follow lifecycle (auto-accept public / approve private / auto-accept-on-public / grandfather-on-private); profile gating fail-closed + whitelist non-PII; ngoại lệ host-of-tenant qua membership (không follow); merge re-parent+dedupe; API + error codes + edge/test; impl-gap notify global. Ranh giới HR1/HR2: KHÔNG nới RLS/không đụng tiền. Renumber Rollout/Changelog → §7. |
