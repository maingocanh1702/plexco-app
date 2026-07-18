# AUDIT — Plexco: Mapping player/user × multi-tenant × data isolation

> ⚠️ **Pre-pivot audit reference (superseded in channel scope by DD-37, refined by DD-15/DD-65..68 v1.45):** Telegram/shared-bot examples below describe the pre-DD-37 model and are **not phase-1 runtime scope**. Current channels are **web + Zalo + Facebook Messenger**; auth is Google/email; Telegram data is legacy tenant #1 only. Isolation, identity/merge, money, public-whitelist and canonical-store findings C1–C8/B1–B6 remain applicable after current-binding substitution. Canonical C1 remediation is now endpoint-scoped for both channels: identity unique `(platform, provider_scope_lookup_hash, platform_user_lookup_hash)`, Messenger scope Page, Zalo scope bot/OA, reachability gắn `channel_identity_id`; tenant eligibility authorize riêng. SePay B3 hiện dùng HMAC timestamp/raw-body ±300s; các dòng API-key cũ chỉ là historical. Authority: `../standards/decisions.md` v1.45 + `../features/feature_connector_onboarding.md` v0.6.

> Soát lại mô hình trong `player-side-saas-reconciliation.md` + `saas-implementation-plan.md` + `tdd.md` về **chính xác / an toàn / bảo mật** cho phần: mapping player giữa Telegram + Zalo, multi-tenant (shared TG bot), BYO-bot Zalo, đồng bộ `players`/`payments`, **và (reposition v2) lớp public discovery cross-tenant + sync engine**.
> **Phán quyết tổng:** nền isolation (repo choke-point + RLS) **chắc**. Tầng **identity/mapping** có **7 lỗ critical (C1–C7)** phải sửa — quanh *claim membership có tiền*, *canDm sai tầng Zalo*, *link-code như bearer secret*. **Reposition thêm 1 lỗ critical (C8): public discovery layer** — đường đọc cross-tenant có chủ đích, rủi ro **rò field tiền/PII** ra marketplace. Chưa thể nói "đã an toàn" cho tới khi đóng C1–C8.

## A. Critical — phải sửa trước khi build

### C1. `canDm` đặt sai tầng → reminder/confirm Zalo gửi nhầm hoặc fail
**Hiện:** `ChannelIdentity.canDm` là **global** (1 cờ / zalo_user_id). **Sai cho Zalo** vì Zalo **bot-per-club**: Minh đã nhắn bot club A ⇏ club B DM được. Global `canDm=true` (từ A) → club B tưởng gửi được → `sendMessage` fail (Minh chưa từng nhắn bot B), player **không nhận xác nhận đã trả tiền**.
**Đúng hiện hành (DD-15/DD-67 v1.45):** reachability gắn exact endpoint-scoped `channel_identity_id`, không phải global flag hoặc `(person,tenant,platform)` aggregate.
```ts
interface ChannelReachability {   // thay canDm khỏi ChannelIdentity
  channelIdentityId: string; // identity includes platform + provider scope + provider user hash
  canDm: boolean; lastInboundAt: string;   // UNIQUE(channelIdentityId)
}
```
Zalo tách theo bot/OA; Messenger tách theo Page. `notifyPlayersPaid` phải đọc exact endpoint reachability, re-check tenant eligibility rồi chọn đúng một route.

### C2. Auto-claim membership-có-tiền theo TÊN = gán nhầm nợ / chiếm dụng
**Hiện:** §3 — channel identity lần đầu vào club → matcher tên "khớp chắc 1 member" → **claim + kế thừa nợ/lịch sử**. Tên VN trùng nhiều ("Minh", "Hùng"); player tự đặt được display name (Zalo `/name`) → có thể **cố tình** trùng. Hệ quả: A thấy/được gán nợ của B, hoặc xoá nợ người khác. **Đây là rủi ro toàn vẹn tiền nặng nhất.**
**Đúng:** tách 2 việc:
- Tạo membership **mới** (chưa có payment/nợ) theo tên → an toàn, giữ tự động.
- **Claim membership đã có payment/nợ** → **không** auto theo tên. Theo DD-50, chỉ verified account email hoặc transactional one-time `link_code` là strong proof. Owner/CK/STK/name chỉ tạo review evidence, không tự gán tiền hoặc bypass proof.

### C3. Link-code merge = bearer secret → chiếm Person nếu yếu
**Hiện:** §3 mã link round-trip merge ChannelIdentity B vào Person A. Nếu mã ngắn/không TTL/không rate-limit → brute-force → kẻ gắn **kênh của hắn** vào Person nạn nhân → thấy mọi club + nhận DM của nạn nhân.
**Đúng:** transactional one-time `link_code` phải **entropy cao, hash-at-rest, single-use, TTL ngắn, rate-limit, sinh on-demand và consume dưới row lock**; B gắn xong phải xác nhận impact tường minh. Log audit mọi merge. Đây không phải SMS OTP.

### C4. Merge Person khi cả hai đã có membership CÙNG 1 tenant → vỡ UNIQUE + nhập nhằng nợ
**Hiện:** chưa định nghĩa. `UNIQUE(tenant_id, person_id)` chặn 1 person 2 membership/tenant, nhưng merge A+B mà cả hai đều có membership trong tenant T → sau merge thành 2 membership cùng person trong T → **vi phạm constraint / crash / nợ tách đôi**.
**Đúng:** quy trình merge phải **reconcile per-tenant**: gộp 2 membership thành 1 (cộng dồn nợ/lịch sử, giữ 1 id, trỏ lại `players`/`payments`), rồi mới merge Person. Phải có path xử lý, không để DB tự ném lỗi.

### C5. Membership trùng do race (TG join vs Zalo join trước khi merge) → nợ tách đôi
**Hiện:** "1 TG + 1 Zalo cùng club = cùng 1 membership" chỉ đúng **nếu** TG-id và Zalo-id đã cùng Person *tại lúc join*. Nếu Minh join club bằng Zalo (tạo Person P2) **trước** khi link với Person TG (P1) → tenant có **2 membership** (P1, P2) cho 1 người → **nợ/CK tách hai sổ**, matcher gán lung tung.
**Đúng:** (a) ở join cố tìm Person sẵn có mạnh nhất có thể (owner pre-link / phone); (b) chấp nhận sẽ có trùng → **bắt buộc có tool owner merge 2 membership** (đi cùng C4); (c) cờ "nghi trùng" khi 2 membership cùng tenant tên giống + chưa link.

### C6. Player-view auth — phải suy `person_id` từ phiên đã xác thực, không từ tham số
**Hiện:** §3b query `WHERE person_id = <người đã xác thực>`. Rủi ro nếu `person_id` lấy từ query param / client → ai cũng xem nợ người khác (đây là **read cross-tenant**, RLS không đỡ vì đường này cố ý bỏ RLS).
**Đúng:** `person_id` **chỉ** suy từ phiên login đã verify (TG Login Widget → telegramUserId → ChannelIdentity → Person). **Zalo chưa có login widget** → cần **magic-link do bot phát** để auth web. Mọi field trả về whitelist (tên club, nợ của chính mình, ✅/❌) — không roster/tiền người khác. Audit log truy cập.

### C7. Kho secret tập trung = blast radius lớn (nhất là token TG shared + vault Zalo BYO)
**Hiện:** platform giữ `botTokenEnc` (mỗi club) + `webhookSecret` SePay + **1 token TG shared**. Lộ DB = (a) mạo danh **mọi** bot Zalo club (gửi tin dưới danh nghĩa club), (b) lộ token TG shared = **toàn bộ** messaging Telegram của mọi club.
**Đúng:** KMS/secret manager riêng (không để cạnh data), mã hoá per-secret (envelope), least-privilege, **scrub token khỏi log** (token nằm trong URL webhook → cấm log full URL). Tách rõ: lộ token = chỉ **messaging**, KHÔNG mở được hàng tiền (payments ở bảng tenant-scoped + RLS, role app `NOBYPASSRLS`). Có quy trình **reset token** (Zalo token reset được — §authorize).

### C8. Public discovery layer = đường đọc cross-tenant có chủ đích → rò field tiền/PII (reposition v2)
**Bối cảnh:** marketplace cho player **chưa thuộc CLB** tìm & join kèo → cần đọc kèo **cross-tenant**, cố ý **ngoài RLS**. RLS không còn là lưới chắn ở đường này → rủi ro chuyển từ *isolation* sang ***rò field***.
**Rủi ro:**
- **Lộ tiền/PII:** nếu projector publish nhầm field (STK, SĐT, roster, ai trả/chưa) vào `public_sessions` → lộ ra mọi người.
- **Enumeration/scrape:** quét `/discover` để dựng hồ sơ ai chơi ở đâu, khi nào, dò địa điểm (stalking/an ninh cá nhân).
- **Vị trí riêng tư:** lộ `venue` chính xác công khai → rủi ro vật lý.
- **Spoof join / spam join-request** làm nhiễu host.
**Đúng:**
- `public_sessions` là **read model riêng**, projector chỉ ghi **field whitelist** cứng (`sport_key, starts_at, area, price, slots_open, host_display_name, club_display_name, join_policy`); **không bao giờ** tiền/PII/roster/STK. **Test bất biến public trong CI** (mọi field ∈ whitelist; kèo private không xuất hiện; join không trả tiền/PII).
- **`venue` chi tiết chỉ lộ khi player `active`**; pending/approved-waitlisted chỉ có `area` — OD-6.
- Discovery API **rate-limit + phân trang**; cân nhắc che bớt độ chính xác thời gian/vị trí; abuse controls cho join-request (approval mode + giới hạn tần suất).
- Join từ marketplace: `session_id → tenant` route nội bộ, **không lộ `tenant_id`/cấu trúc nội bộ** ra response.

### C8b. Sync engine — tránh đa nguồn sự thật làm lệch tiền
**Hiện (reposition):** nhiều surface (web/TG/Zalo) cùng sửa dữ liệu. Nếu cho mỗi surface tự ghi/giữ trạng thái riêng → **multi-master** → lệch roster/nợ, khó hoà giải.
**Đúng:** **một canonical store** (TDD §3.8); surface gửi **command** (idempotent `commandId`), store là nơi duy nhất quyết; thay đổi phát **outbox event** → projector dựng lại surface. Surface là *derived*, **re-project** được. Không ghi 2 chiều multi-master.

## B. Important — sửa sớm

- **B1. Sticky context phải fail-closed.** `PlayerChatContext` (telegramUserId→tenant) là cross-tenant, ngoài RLS. Lúc dùng **phải validate tenant ∈ membership của Person**; nếu không còn → bỏ context, hỏi picker. Không bao giờ để context quyết định tenant mà không qua giao Membership.
- **B2. Deep-link `club_<slug>` ≠ join, slug không phải capability.** Bind context chỉ đặt "DM nhắm club nào", **không** auto-tạo membership. Join vẫn qua tap-in-group / `/join` + linking (+ duyệt nếu club kín). Slug đoán được → đừng cho slug quyền gì; nếu cần cấp quyền dùng **token opaque**.
- **B3. Verify fail-closed mọi webhook.** SePay production: `X-SePay-Timestamp` ±300s + `X-SePay-Signature: sha256=<hex>` trên `{timestamp}.{raw_body}`, constant-time compare và không auth downgrade. Zalo: `X-Bot-Api-Secret-Token`; Messenger: `X-Hub-Signature-256`. Sai → 401 trước parse/persist nghiệp vụ; sau khi auth hợp lệ mới lưu raw durable trước ACK; **không** log secret/token.
- **B4. Bank-account-number làm khoá merge = đồ thị tài chính xuyên club (privacy).** Dùng STK để merge Person xuyên tenant nghĩa là build index `account→person` toàn hệ thống. Nên giữ **matching STK trong-tenant**; merge xuyên club bằng STK chỉ **owner-mediated / opt-in**, không tự động — tránh tự dựng hồ sơ tài chính cá nhân tập trung.
- **B5. Cron nhắc nợ là path privileged cross-tenant.** "1 query mọi tenant" (saas §5.3) chạy ngoài RLS per-tenant → phải là **job role có kiểm soát**, group theo tenant, dispatch đúng bot/group từng club; đừng để pattern "select mọi tenant" rò ra ngoài cron.
- **B6. `message.unsupported.received` (Zalo, user nhóm bảo vệ).** Không nhận nội dung → không tự xử join/pay bằng text → **fallback owner xử tay**, đừng để luồng tự động kẹt/đoán.

## B2. Threat model — Zalo bot token bị lộ

Token cấp full API của 1 bot (`bot-api.zaloplatforms.com/bot<TOKEN>/...`) và **không hết hạn** tới khi reset tay → lộ là còn hiệu lực vô thời hạn cho tới khi rotate.

**Rủi ro (xếp theo mức):**
- **Nghiêm trọng — lừa đảo tài chính:** attacker `sendMessage`/`sendPhoto` dưới danh nghĩa **bot chính thức club** → gửi **VietQR giả / "STK mới"** → player CK nhầm vào tài khoản kẻ gian.
- **Nghiêm trọng — cướp webhook (MITM + DoS):** `setWebhook` trỏ update về server attacker → hứng hết tin player (tên, nội dung, **SĐT nếu share-contact**, xác nhận trả) **và** platform mất update (bot như chết). `deleteWebhook` = phá thẳng. `getUpdates` đọc tin chờ.
- **Kèm theo:** rò rỉ PII tầng hội thoại; mất uy tín club/SaaS; spam → 429 / Zalo ban bot.

**Containment (KHÔNG xảy ra — nhờ thiết kế):** không lấy tiền trực tiếp (CK vào NH club), không đọc DB tài chính (RLS, role `NOBYPASSRLS`), không chạm club khác (per-club), không vào Zalo cá nhân owner. → lộ 1 token = thảm hoạ **messaging 1 club**, không sập hệ thống.

**Controls:**
1. Giảm xác suất lộ: KMS at-rest, **không log**, UI che `••••`, TLS, least-privilege + audit truy cập secret (đã có ở C7).
2. **⭐ Phát hiện cướp webhook (control mới):** cron định kỳ gọi **`getWebhookInfo`**, so URL với URL của platform → **lệch = alert + tự `setWebhook` lại** + cân nhắc khoá bot chờ owner xác nhận.
3. **Kill-switch / rotation:** nghi lộ → owner **reset token** trong Zalo Bot Creator (token cũ chết tức thì) → dán token mới. Vì token không tự hết hạn, **rotation là cách vô hiệu hoá duy nhất** → dashboard phải hỗ trợ re-paste dễ.
4. **Bảo vệ player:** STK nhận của club **cố định + verify trong hệ thống**; giáo dục player "STK không đổi qua tin nhắn" để giảm hiệu quả QR giả.

## C. Đã chắc (xác nhận đạt)

- **Tenant luôn suy từ KÊNH** (group chat_id / Zalo bot webhookToken / SePay bank account), **không bao giờ từ nội dung message** → chống spoof tenant. ✅
- **RLS fail-closed + FORCE + role `NOBYPASSRLS`**, test bất biến trong CI. ✅
- **Tiền tenant-scoped**: `payments`/`pay_code` `UNIQUE(tenant_id,...)`, CK route theo bank account **trước** khi match → không khớp chéo tenant. ✅
- **Identity directory global KHÔNG chứa tiền** → merge Person không di chuyển payment giữa tenant; bất biến "tiền không rò rỉ" giữ được (với điều kiện C4/C7 về path privileged). ✅
- **Zalo BYO per-club**: token compromise giới hạn ở messaging 1 club, không chạm DB club khác. ✅

## D. Must-fix checklist trước khi viết code

1. [ ] C1 — `ChannelReachability` per (person,tenant,platform); bỏ `canDm` global.
2. [ ] C2 — claim membership-có-tiền: cấm auto theo tên; chỉ verified account email hoặc transactional one-time `link_code`; owner/CK chỉ là review evidence.
3. [ ] C3 — link-code: high-entropy, single-use, TTL ngắn, rate-limit, xác nhận + audit.
4. [ ] C4 — quy trình merge reconcile membership trùng-tenant (gộp nợ, 1 id).
5. [ ] C5 — tool owner merge 2 membership + cờ nghi-trùng ở join.
6. [ ] C6 — player-view: person_id từ phiên verify; magic-link auth cho Zalo; whitelist field.
7. [ ] C7 — secret trong KMS, scrub token khỏi log, quy trình reset, tách messaging vs tiền.
8. [ ] **C8 — public discovery: `public_sessions` field-whitelist cứng; test bất biến public CI; `venue` ẩn tới khi join; rate-limit/anti-scrape; không lộ `tenant_id`.**
9. [ ] **C8b — sync: 1 canonical store; command idempotent (`commandId`); outbox + re-projection; không multi-master.**
10. [ ] B1–B6 — sticky fail-closed, deep-link≠join, timing-safe ×3, STK-merge owner-mediated, cron job-role, unsupported→owner.
11. [ ] B2 — token lộ: `getWebhookInfo`-drift detection + alert/auto-reset; rotation/re-paste dễ; KMS + che UI; player edu "STK không đổi qua tin nhắn".
12. [x] **G1 — STK change confirmation delay (24h + notify kênh phụ).** → Folded: `feature_payment_reconcile.md` v1.2 (UC-13/14, edge #17), `BE/feature_payment_reconcile_tech.md` v1.2 (schema + API), `business-rules.md` BL-PAY-10.
13. [x] **G3 — Admin mutation rate limits (60 req/min per account).** → Folded: `business-rules.md` BL-SEC-5 + Rate Limit Registry appendix, `BE/feature_payment_reconcile_tech.md` v1.2.

---

## E. Security Gaps — bổ sung 19/06/2026

> Soát lại toàn bộ kiến trúc (identity, sync, marketplace, payment, multi-tenant, native-app-readiness) tìm thêm attack vectors chưa cover trong C1–C8 / B1–B6.

### G1. 🔴 Đổi STK primary — chưa có confirmation delay

**Attack:** Attacker chiếm TG account của host → đổi bank account primary → player CK vào STK attacker. Hiện tại nếu host chỉ cần click "đổi" → đổi ngay.

**Impact:** Mất tiền trực tiếp — player CK vào tài khoản kẻ gian.

**Mitigations:**

| # | Control | Chi tiết |
|---|---------|---------|
| G1-a | **Confirmation delay 24h** | Đổi STK primary → trạng thái `pending_change` → delay 24h → auto-apply nếu không cancel. Trong 24h, hệ thống vẫn dùng STK cũ cho QR |
| G1-b | **Notify qua kênh phụ** | Gửi thông báo đổi STK qua TẤT CẢ kênh đã link (TG + Zalo + email + web) — nếu attacker chỉ chiếm 1 kênh, owner thấy cảnh báo ở kênh khác → cancel |
| G1-c | **Rate limit** | Max 2 lần đổi STK primary / 30 ngày. Vượt → block + notify |
| G1-d | **Audit trail** | Log `bank_account_changed_by`, `old_account_number` (masked: `****1234`), `new_account_number` (masked), `changed_at`, `ip_address` |
| G1-e | **Micro-deposit verify** (optional, P5+) | Gửi 1đ VND về STK mới, host confirm mã → prove ownership. Không bắt buộc P0–P4 nhưng tăng cường đáng kể |

**Schema bổ sung:**
```sql
ALTER TABLE bank_accounts ADD COLUMN pending_account_number text;
ALTER TABLE bank_accounts ADD COLUMN pending_account_holder text;
ALTER TABLE bank_accounts ADD COLUMN pending_change_at     timestamptz;
ALTER TABLE bank_accounts ADD COLUMN pending_expires_at    timestamptz;
-- pending_expires_at = pending_change_at + 24h
-- cron: khi now() > pending_expires_at → apply change
```

**Rule mới → thêm vào `business-rules.md`:**
> **BL-PAY-7**: Đổi STK primary phải qua **confirmation delay 24h**. Trong 24h, hệ thống vẫn dùng STK cũ. Owner có thể cancel pending change. Thông báo đổi STK gửi qua MỌI kênh đã link.

---

### G2. 🟠 JWT / session token bị steal — native app

**Attack:** Attacker intercept hoặc steal JWT access token → impersonate user. Rủi ro cao hơn trên mobile (clipboard, shared device, malware).

**Impact:** Impersonation — thực hiện mọi action dưới danh nghĩa victim.

**Mitigations:**

| # | Control | Chi tiết |
|---|---------|---------|
| G2-a | **Short-lived access token** | 15 phút TTL (đã có trong TDD). Steal → chỉ có 15 phút window |
| G2-b | **Refresh token rotation** | Mỗi lần dùng refresh token → issue token mới, **void token cũ**. Dùng token cũ = **revoke toàn family** (phát hiện theft) |
| G2-c | **Secure storage** (native) | iOS: Keychain. Android: EncryptedSharedPreferences / Keystore. **KHÔNG** lưu token vào UserDefaults/SharedPreferences thường |
| G2-d | **Fingerprint binding** (optional) | Bind refresh token với device fingerprint (device_id + OS version + app version). Token dùng từ device khác = reject |
| G2-e | **Logout = server-side revoke** | DELETE `/auth/logout` → revoke tất cả refresh token của device. Không chỉ xoá local |

**Đây là defense-in-depth — không phải 1 control, mà tổng hợp nhiều tầng. Đã có concept trong TDD (access 15m + refresh 30d), cần bổ sung rotation + secure storage mandate cho native.**

---

### G3. 🟠 Admin mutation APIs — chưa có rate limit rõ

**Attack:** Attacker chiếm session → spam create/update/delete → phá data hoặc DoS. Hoặc script flood create sessions.

**Impact:** Data integrity (tạo hàng trăm session rác), DoS cho tenant.

**Mitigations:**

| # | Control | Chi tiết |
|---|---------|---------|
| G3-a | **Rate limit per account** | Mutation endpoints (POST/PATCH/DELETE): **60 req/min per account**. Vượt → 429 `RATE_LIMITED` |
| G3-b | **Rate limit per tenant** | Prevent 1 compromised account flood 1 tenant: **200 req/min per tenant** (tổng tất cả members) |
| G3-c | **Rate limit per IP** | Public endpoints (discovery, join): **100 req/min per IP** |
| G3-d | **Sliding window** | Dùng sliding window (không fixed window) — tránh burst ở ranh giới window |

**Implementation:** Middleware layer, config-driven (dễ tune). Dùng pg-boss hoặc Redis counter nếu cần distributed rate limit.

**Spec bổ sung vào mỗi feature tech doc:**
```
Rate Limit: POST /sessions — 60/min per account, 200/min per tenant
Rate Limit: POST /sessions/:id/join — 10/min per person, 100/min per IP
Rate Limit: PATCH /bank-accounts/:id — 5/min per account (đổi STK nhạy)
```

---

### G4. 🟡 Audit log retention policy — chưa specify

**Hiện:** Docs nói "log audit" nhưng chưa rõ giữ bao lâu, lưu đâu, ai truy cập.

**Đề xuất:**

| Category | Retention | Lý do |
|----------|-----------|-------|
| **Financial** (payment confirm, STK change, billing) | **3 năm** | Compliance tài chính VN (Thông tư 39 NHNN), audit trail |
| **Identity** (merge, claim, link) | **1 năm** | Trace dispute identity |
| **Session/roster** (create, join, leave) | **90 ngày** | Operational, ít nhạy |
| **Auth** (login, token refresh, failed attempts) | **90 ngày** | Security monitoring |

**Storage:** Audit log table riêng (`audit_logs`) hoặc append-only log service. **KHÔNG xoá**, chỉ archive sang cold storage sau retention period. Audit log table **KHÔNG nằm trong RLS** — cần superadmin/system role đọc cross-tenant cho investigation.

---

### G5. 🟡 GDPR / PDPA — data export & delete

**Hiện:** Chưa có endpoint "download my data" / "delete my account". Post-MVP nhưng cần plan architecture.

**Đề xuất:**

| Feature | Endpoint | Chi tiết |
|---------|---------|---------|
| **Data export** | `GET /me/data-export` | Trả JSON/ZIP chứa: profile, memberships, payments, sessions joined. Queue job vì có thể lớn. Download link TTL 24h |
| **Account delete** | `DELETE /me` | Soft-delete: `accounts.deleted_at = now()`. Grace period 30 ngày (user có thể restore). Sau 30 ngày → hard-delete PII (phone, email, display_name → hash). Giữ financial records (anonymized) cho compliance |

**Impact lên architecture:**
- `Person` + `ChannelIdentity` → anonymize (hash PII, keep id for FK integrity)
- `Membership` → keep for financial integrity, anonymize display_name
- `charges` / `bank_transactions` → **keep indefinitely** (financial compliance), anonymize person reference

**Timing:** Implement trước khi có EU/ASEAN users hoặc trước P6 (hardening). Không blocker cho P0–P4.

---

### G6. 🟡 DDoS — Discovery API

**Attack:** Flood `GET /discover` (public, no auth required) → overload DB / server.

**Mitigations:**

| # | Control | Chi tiết |
|---|---------|---------|
| G6-a | **Rate limit per IP** | 100 req/min. Cursor-based pagination max 20 items/page |
| G6-b | **CDN cache** | Popular queries (default sort, popular sports) → cache 60s tại CDN edge. Cache-Control headers |
| G6-c | **Read isolation + trigger-based node** | Day-1: projection-only role + bounded pool/timeout + reserved money-path budget + circuit-breaker; khi contention đo được mới chuyển discovery sang read-only node |
| G6-d | **Query complexity limit** | Max 3 filter params. Không cho arbitrary sort/filter → prevent slow query |
| G6-e | **Response size cap** | Max 20 sessions per page. Không cho `limit=1000` |

**Timing:** G6-a + isolation controls G6-c implement ở P4.3/infra slice; CDN bật Day-1. Read-only node vật lý chỉ provision khi telemetry justify.

---

## F. Tổng hợp Severity

| ID | Mô tả | Severity | Phase sửa |
|----|-------|----------|-----------|
| C1–C8b | Identity, discovery, sync (đã có) | 🔴 Critical | Trước P2 |
| G1 | STK change confirmation delay | 🔴 High | P3 (payment) |
| G2 | JWT secure storage + rotation (native) | 🟠 Medium | P7 (native) |
| G3 | Admin mutation rate limits | 🟠 Medium | P2 (routing + authz) |
| G4 | Audit log retention policy | 🟡 Low | P6 (hardening) |
| G5 | GDPR data export/delete | 🟡 Low | P6 (hardening) |
| G6 | DDoS discovery API | 🟡 Low | P4.3 (marketplace) |
| B1–B6 | Sticky, deep-link, timing-safe, etc. | 🟠 Important | P2–P3 |

---

*Kết: kiến trúc isolation & đường tiền **đúng và an toàn**. Rủi ro tập trung ở tầng **mapping danh tính** (mọi thao tác gắn/merge dính tiền cần khoá mạnh + audit; reachability Zalo per-bot), **public discovery layer** (rò field tiền/PII, phải field-whitelist + test bất biến public), **sync engine** (một canonical store, không multi-master), và **mutation controls** (STK change delay G1, rate limits G3). Đóng xong C1–C8b + B1–B6 + G1–G3 thì mới kết luận được "chính xác, an toàn, bảo mật". G4–G6 sửa ở P6 hardening.*


---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 17/07/2026 | v1.1 | Current-contract overlay: endpoint-scoped channel identity/reachability và SePay production timestamp/raw-body HMAC; giữ body pre-pivot làm historical audit evidence. |
| 19/06/2026 | — | Thêm Changelog table |
| 18/06/2026 | v1.0 | AUDIT bảo mật player-side + discovery |
