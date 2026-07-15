# Business Rules — Plexco

> Registry quy tắc nghiệp vụ, tổng hợp từ `docs/product/BRD.md` v3.6 · `docs/product/PRD.md` v2.4 · `docs/product/TDD.md` v2.5 · `docs/standards/decisions.md` v1.32 · `docs/research/player-side-saas-AUDIT.md`.
>
> **Reconcile 15/07/2026:** đã đồng bộ pivot kênh (DD-37), pricing/mark-paid (DD-29/40), session-model (DD-41–46) và social framework (DD-47/48). Decision log vẫn là authority khi một DD thay đổi; registry này là mirror để review/build.
> Khi conflict, authority theo topic trong BRD §0; security dùng rule nghiêm ngặt hơn.
> v1.7 · 2026-07-15 (full decision reconcile qua DD-48)

---

## BL-PAY — Thanh toán & Đối soát (Module Tiền)

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-PAY-1** | **Durable trước ACK** | Trong một DB transaction: insert `bank_transaction` idempotent + enqueue reconcile job/outbox; commit rồi mới trả 200. Match chạy async, retry an toàn sau crash. Đây là tên catalog của AUDIT BL-1. | BRD FR-5.2, TDD §3.6, AUDIT BL-1 |
| **BL-PAY-2** | **Không over-allocation** | Effective allocation của bank transaction nằm trong `[0, amount]`; allocation vào charge nằm trong `[0, amount_due]`. Charge chỉ paid khi phủ đủ. | BRD FR-5.3/5.4, NFR-R3 |
| **BL-PAY-3** | **Matching phase-gated** | P3 dùng name + amount + date; pay_code deterministic chỉ được phát khi P4 rollout hoàn tất. Trường hợp một CK/nhiều người nhập nhằng phải manual allocation. | PRD FLOW 6, TDD §3.7 |
| **BL-PAY-4** | **Idempotent per-tenant** | `UNIQUE(tenant_id, provider, external_id)` → webhook trùng skip, không double-count. | NFR-R2 |
| **BL-PAY-5** | **FIFO allocation** | Cùng người có nhiều charge đồng giá/ngày → allocate oldest-first; không suy danh tính chỉ từ `fee × N`. | PRD §4.1 |
| **BL-PAY-6** | **Route CK đúng tenant** | webhook_token + verify account_number → `bank_accounts` → tenant. | BRD FR-5.2, TDD §3.3 |
| **BL-PAY-7** | **Unmatched/remainder review** | CK không khớp hoặc còn dư → `/unmatched`; host có thể tạo nhiều allocations nhưng tổng không vượt funds. | BRD FR-5.5 |
| **BL-PAY-8** | **Immutable ledger** | Không sửa/xóa bank transaction/allocation đã audit; điều chỉnh bằng signed reversal tham chiếu allocation gốc. | TDD §3.2 |
| **BL-PAY-9** | **Cash/waiver có provenance** | `/cash`/waiver tạo allocation không có bank transaction nhưng bắt buộc authorized actor; không tạo webhook giả. | PRD command map, Payment feature v1.1 |
| **BL-PAY-10** | **STK change confirmation delay** | Đổi STK primary → pending 24h → hệ thống vẫn dùng STK cũ cho QR. Thông báo đổi gửi qua MỌI kênh đã link. Owner cancel được. Rate-limit: max 2 lần/30 ngày. | AUDIT G1 |
| **BL-PAY-11** | **Mark-paid = allocation, mọi tier (DD-40)** | Host xác nhận "đã thu" thủ công → INSERT `payment_allocations` + cập nhật `charges` (`amount_allocated`/`status`). **KHÔNG** ghi bảng `payment`/`payments` (không tồn tại trong schema). Tiền mặt → `source='cash'` (không `bank_transaction`, bắt buộc `created_by`); CK host xác nhận khớp một `bank_transaction` có sẵn → `source='manual'`. **KHÔNG** dùng `bank_transfer` làm source. Mark-paid có ở **mọi tier** (free + host_pro); đối soát **tự động** chỉ host_pro (capability `payment_reconcile_auto`, BL-BIL-1a). | DD-40, schema.ts §payment_allocations |

---

## BL-ID — Định danh & Gộp (Identity)

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-ID-1** | **Person toàn cục** | Mỗi người = 1 `Person`; mỗi identity Zalo/Messenger = 1 `ChannelIdentity` (Telegram chỉ còn legacy data, không phải surface MVP); quan hệ với CLB = `Membership`. | BRD BR-9, FR-7.1, DD-37 |
| **BL-ID-2** | **Claim-có-tiền cần khoá mạnh** | Claim membership đã có nợ/lịch sử tiền: chỉ qua (1) owner gán, (2) CK khớp từ cùng STK, (3) mã link OTP. **KHÔNG** cho claim bằng tên/alias. | AUDIT C2, BRD FR-7.2 |
| **BL-ID-3** | **Merge xuyên kênh** | Thứ tự tin cậy merge: mã link OTP → SĐT verified → email verified → STK+tên (gợi ý, owner duyệt). **Chỉ verified mới auto-merge.** | AUDIT C3/C5, BRD FR-7.3 |
| **BL-ID-4** | **UNIQUE per tenant + merge-safe** | Active membership unique per `(tenant,person)`; conflict merge dùng survivor+tombstone, re-parent charge/history, không sửa ledger rows. | TDD §3.2, Identity feature v1.1 |
| **BL-ID-5** | **Auto-create ChannelIdentity** | Tin nhắn đầu tiên từ kênh mới → tạo ChannelIdentity + gắn Person (mới hoặc merge nếu verified). | PRD FLOW 5 |
| **BL-ID-6** | **Routing theo kênh, KHÔNG nội dung** | Tenant luôn suy từ kênh (group chat_id / Zalo bot / page_id / deep-link / web-session). KHÔNG suy từ nội dung tin (chống spoof). | BRD CO-4, NFR-S3 |
| **BL-ID-7** | **Social profile tách khỏi dữ liệu vận hành** | Follow/profile cross-user chỉ trả approved social fields có canonical source. Host operational access vẫn qua tenant-scoped APIs; follow không mở roster, tiền, PII, `pay_code` hay membership. | DD-47/48 |

---

## BL-DSC — Discovery & Marketplace

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-DSC-1** | **Field whitelist cho public** | `public_sessions`: sport_key, starts_at, ends_at, area, price, slots_open, host/club display name, join_policy; session policy fields an toàn gồm `title`, `session_type`, `level_min_rank`, `level_max_rank`, `level_strict`, `gender_restriction`, `age_min`, `age_max`. Retire public `skill_level`. Routing tenant ID không serialize. Không roster, debt/payment, contact, venue chi tiết, STK, `notes`, `instructions`, `byoe` hay `cost_shared`. | BRD BR-4, DD-41, NFR-S2, AUDIT §public |
| **BL-DSC-2** | **Publish theo từng kèo** | Host chọn `visibility=public` per-session → projector đẩy vào `public_sessions`. Đóng kèo → hạ khỏi marketplace. | BRD FR-3.1, PRD FLOW 12 |
| **BL-DSC-3** | **Join cross-club** | Player join kèo CLB chưa tham gia. `open`: trong transaction lock/re-check eligibility+capacity; còn chỗ → membership/player active + charge + venue, full → waitlisted, không charge/venue. `approval`: chỉ tạo `join_requests(pending)`; chưa tạo membership/player/charge, chưa chiếm capacity và chưa lộ venue. Khi duyệt phải re-check cùng contract active-vs-waitlisted. | BRD FR-3.2, DD-05/06/45 |
| **BL-DSC-4** | **Rate-limit + anti-scraping** | Discovery API: rate-limit per IP, phân trang, không expose danh sách toàn bộ tenant. | NFR-S2 |

---

## BL-SES — Session Management

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-SES-1** | **Timezone bắt buộc** | `starts_at/ends_at` là timestamptz; mỗi session có IANA timezone. DST xử lý deterministic. | BRD FR-2, TDD §3.2 |
| **BL-SES-2** | **Capacity không over-fill** | Join và capacity change lock session; concurrent ops không vượt `slots_max`. | PRD FLOW 2, Session feature |
| **BL-SES-3** | **Price change + charges** | Đổi giá sau khi có charges yêu cầu explicit impact policy; không silent mutation. | Session feature §rules |
| **BL-SES-4** | **Close/cancel immutable** | Session đóng/hủy reject mutation trừ privileged correction có audit. Public projection bị hạ. | PRD FLOW 2, BRD FR-2 |
| **BL-SES-5** | **Session gating fail-closed** | `level_min_rank ≤ level_max_rank`; strict level, gender restriction và age range được kiểm tra tại join/approve/promote dưới lock. Không đủ hoặc không chứng minh được eligibility → không active/charge/venue. | DD-41 |
| **BL-SES-6** | **Attendance/reliability tenant-private** | No-show/attendance là dữ liệu vận hành per-tenant; reliability có provenance, correction/audit và không được đưa vào public projection hay suy thành global score. | DD-42 |
| **BL-SES-7** | **Membership tags chỉ định audience** | `membership_tags` là nhãn per-tenant để lọc người nhận announcement/invite; tag không tạo eligibility, role, giá, quyền hay dữ liệu public. | DD-43 |
| **BL-SES-8** | **Private invite token** | Invite token phải opaque, hash-at-rest, scoped đúng session, có expiry/revoke/max-use và redeem atomic/idempotent. Token hợp lệ chỉ mở đường join; vẫn re-check session, eligibility, capacity và waitlist. | DD-44 |
| **BL-SES-9** | **Waitlist là state canonical** | Full → `waitlisted` với position dương, không charge/venue. Capacity chỉ đếm active; promotion theo total order canonical và idempotent. Player `left` không tự rejoin: trả `REJOIN_REQUIRES_REVIEW`. | DD-45 |
| **BL-SES-10** | **Derive charge trước promotion mutation** | Khi promote, suy giá theo DD-39 trước khi đổi state. KMS/decrypt/price failure → giữ waitlisted/no-charge/no-venue; phát đúng một audit + canonical outbox event cho retry/owner alert, không rollback capacity opener và tiếp tục candidate kế. | DD-39/45 |

---

## BL-SYN — Sync Engine

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-SYN-1** | **PostgreSQL/domain model canonical** | Web/chat là surfaces; mọi ghi qua command bus/services/tenantRepo vào PostgreSQL. Không multi-master. | BRD BR-6, CO-4 |
| **BL-SYN-2** | **Outbox + delivery ledger** | Thay đổi + outbox cùng transaction; command dedupe và projector delivery UNIQUE. Messenger projector là **phase-1** (P2.5, cần Meta App Review — DD-37). | TDD §3.8, BRD FR-4.2 |
| **BL-SYN-3** | **Re-project** | Surface lệch → re-project từ event replay. Không cần Surface giữ state độc lập. | BRD FR-4.3, NFR-R4 |

---

## BL-TEN — Multi-tenant & Cô lập

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-TEN-1** | **RLS fail-closed** | ENABLE + FORCE RLS; role `app` = `NOBYPASSRLS`; `SET LOCAL app.tenant_id`. Mọi tenant query qua `tenantRepo`. | BRD BR-1, NFR-S1 |
| **BL-TEN-2** | **3 tầng hiển thị** | Public (cross-tenant, field whitelist) / Tenant-private (RLS) / Person-self (person-authorized). | BRD §7 FR-0, TDD §3.2 |
| **BL-TEN-3** | **CLB tự mang provider** | Tenant tự nối SePay/ApiPay và Zalo bot; Messenger Page là **phase-1** (P2.5, cần Meta App Review — DD-37). Telegram bỏ khỏi phạm vi (DD-37). Platform không trung gian dòng tiền. | BRD BR-13, CO-1 |
| **BL-TEN-4** | **Đa môn** | `sports` table (badminton, pickleball, tennis, bóng đá…); mỗi session gắn 1 sport_id; discovery lọc theo môn. | BRD BR-2 |
| **BL-TEN-5** | **Worker không bypass rộng** | Cross-tenant scheduler/outbox chỉ claim qua narrow privileged function; từng job quay lại `SET LOCAL app.tenant_id` và audit. | TDD §3.4 |
| **BL-TEN-6** | **Kèo cá nhân vẫn có tenant** | Skip Club auto-provision đúng một `tenants.kind='personal'` per Person, owner=self, logical free tier. `sessions.tenant_id` luôn NOT NULL; RLS, membership, participant và money model giữ nguyên. Không tạo session tenant-null. | DD-46 |

---

## BL-BIL — Billing & Lifecycle

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-BIL-1** | **Subscription host** | **Plan trả phí `host_pro`:** trial → active → past_due → suspended → cancelled. **`free` (0đ):** vào thẳng `active` vô thời hạn — không trial/invoice, **không bao giờ** past_due/suspended vì non-payment (chỉ suspend vì ToS/abuse hoặc owner cancel). Invoice ledger tách khỏi player payment ledger. Pricing theo **DD-29** (thay DD-03): `free` 0đ, `host_pro` 250k mỗi CLB/tháng. | BRD FR-9.1/9.2, DD-29 |
| **BL-BIL-1a** | **Plan entitlements** | `free`: web + kết nối 2 bot chat (**Zalo/Messenger** — Telegram bỏ, DD-37) + đối soát CK **thủ công** (mark-paid = allocation, BL-PAY-11/DD-40) + nhắc thủ công; `host_pro`: thêm đối soát **tự động** + nhắc nợ tự động + Trợ lý AI + CRM. Gate theo **capability flags config-driven** (registry `feature_billing_lifecycle_tech.md §4b`), không hardcode theo plan_key. (Messenger cần Meta App Review trước GA — DD-33/DD-37.) | DD-29 |
| **BL-BIL-2** | **Suspended behavior** | Chặn lệnh quản trị nhưng vẫn durable-ingest CK player. Kèo public hiện có chỉ sống tới khi đóng/hết giờ; không tạo/gia hạn mới. | BRD BR-11, FR-9.3 |
| **BL-BIL-3** | **LLM/STT fair-use** | Platform trả chi phí LLM/STT; có trần fair-use per-tenant. | BRD §9.2 |

---

## BL-NTF — Nhắc & Xác nhận

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-NTF-1** | **Nhắc chống spam** | Cron nhắc theo ngưỡng (cấu hình), chống lặp, quiet-hours. Kênh nhắc: **web (in-app/SSE) + DM Zalo**; Messenger chỉ best-effort trong cửa sổ 24h (BL-NTF-3). Fan-out theo `ChannelReachability` đúng tenant (Telegram bỏ — DD-37). | BRD FR-6.1 |
| **BL-NTF-2** | **Xác nhận best-effort** | Chỉ sau `payment.settled` (charge phủ đủ) → xác nhận player. Lỗi gửi không rollback ledger; correction event xử lý reversal sau notify. | BRD FR-6.2 |
| **BL-NTF-3** | **Messenger cửa sổ 24h** | Standard send chỉ dùng trong 24h sau inbound cuối. Ngoài cửa sổ chỉ dùng cơ chế Meta đủ điều kiện/được phê duyệt; nếu không fallback web + Zalo. Nhắc nợ best-effort, không đảm bảo. | CO-3, messenger doc |
| **BL-NTF-4** | **Audience theo tag không đổi quyền** | Announcement có thể lọc theo `membership_tags` per-tenant; dispatcher chỉ thu hẹp audience đã hợp lệ, không dùng tag để mở eligibility/visibility hoặc gửi cross-tenant. | DD-43 |

---

## BL-SOC — Follow & Profile Visibility

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-SOC-1** | **Follow graph global-protected** | `person_follows` là directed edge global, không `tenant_id`, không blanket grant cho app/PUBLIC; chỉ qua identity service + narrow `SECURITY DEFINER`. Public profile auto-accept; private profile tạo pending cần approve/reject. | DD-47 |
| **BL-SOC-2** | **Visibility migration an toàn** | Existing profiles backfill `private`; user mới default `public` sau khi migration hoàn tất. `public→private` giữ accepted followers cũ; follow mới pending. `private→public` auto-accept pending edges. | DD-47/48 |
| **BL-SOC-3** | **Approved social fields only** | Cross-user profile chỉ có `display_name`, `username` khi canonical field tồn tại, và `plexco_since` coarse. Avatar/sports/aggregate excluded tới khi có model; private non-follower nhận fixed minimal card. | DD-48 |
| **BL-SOC-4** | **Merge follow fail-closed** | Identity merge lock incident edges, canonicalize endpoints, drop self-edge và collapse duplicate (`accepted > pending`) trước update để không vỡ UNIQUE; cùng transaction/audit. | DD-47 |

---

## BL-SEC — Bảo mật

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-SEC-1** | **Secret mã hoá at-rest** | Token bot/page, secret SePay: KMS at-rest. Không log. Có reset path. | NFR-S5, AUDIT §B2 |
| **BL-SEC-2** | **Webhook timing-safe verify** | Mọi webhook verify bằng constant-time compare (SePay API key) hoặc HMAC-SHA256 (ApiPay). | AUDIT B-webhook |
| **BL-SEC-3** | **Audit trail** | Mọi thao tác chạm tiền/định danh: ghi admin_id, timestamp, method (auto/manual). | NFR-S6, BRD BR-12 |
| **BL-SEC-4** | **PII consent + mã hoá** | SĐT/email thu có consent; AES at-rest; soft-delete; không vào URL/log. | NFR-P1 |
| **BL-SEC-5** | **Mutation rate limit** | POST/PATCH/DELETE: 60/min per account, 200/min per tenant. Public endpoints (discovery, join): 100/min per IP. Provider webhooks không áp user mutation limit nhưng vẫn có edge per-token/IP burst cap + body-size cap. Sliding window. | AUDIT G3, deployment-infra §6 |
| **BL-SEC-6** | **Audit log retention** | Financial: 3 năm. Identity: 1 năm. Session/auth: 90 ngày. Không xoá — archive sau retention. | AUDIT G4 |

---

## Appendix: BL-SEC-5 Rate Limit Registry

> Bảng tham chiếu chuẩn cho **mọi BE tech doc**. Khi thêm endpoint mới, thêm vào bảng này.

| Category | Endpoint pattern | Limit | Scope | Error |
|----------|-----------------|-------|-------|-------|
| **Webhook (provider)** | `POST /webhook/*` | No app-level user limit; edge per-token/IP burst cap sized ≥100/s/token target + body-size cap | token + IP | 429/413 at edge |
| **Discovery (public)** | `GET /discover` | 100/min | IP | 429 `RATE_LIMITED` |
| **Join (public)** | `POST /sessions/:id/join` | 10/min per person, 100/min per IP | person + IP | 429 `RATE_LIMITED` |
| **Auth** | `POST /auth/*` | 10/min | IP | 429 `RATE_LIMITED` |
| **Session CRUD** | `POST/PATCH/DELETE /sessions` | 60/min | account | 429 `RATE_LIMITED` |
| **Payment allocation** | `POST /transactions/:id/allocations` | 60/min | account | 429 `RATE_LIMITED` |
| **Payment reversal** | `POST /allocations/:id/reverse` | 30/min | account | 429 `RATE_LIMITED` |
| **Cash/waiver** | `POST /cash` | 30/min | account | 429 `RATE_LIMITED` |
| **STK change** | `PATCH /bank-accounts/:id/primary` | 5/min per account; **max 2 / 30 days** | account | 429 `STK_CHANGE_RATE_LIMITED` |
| **Identity link-code** | `POST /identity/link` | 5/min | person | 429 `LINK_RATE_LIMITED` |
| **Identity merge** | `POST /identity/merge` | 10/min | account (admin) | 429 `RATE_LIMITED` |
| **Membership CRUD** | `POST/PATCH/DELETE /memberships` | 60/min | account | 429 `RATE_LIMITED` |
| **Tenant mutation** | `PATCH /tenants/:id` | 30/min | account (owner) | 429 `RATE_LIMITED` |
| **Tenant aggregate** | All mutations combined | 200/min | tenant | 429 `TENANT_RATE_LIMITED` |
| **Default mutation** | Any POST/PATCH/DELETE not listed | 60/min | account | 429 `RATE_LIMITED` |
| **Default read** | Any GET not listed | 120/min | account | 429 `RATE_LIMITED` |

**Implementation:** Sliding window middleware. Config-driven. Redis/pg-boss counter cho distributed.

---

## Source of Truth (khi conflict)

```
AUDIT → reconciliation → saas-implementation-plan → BRD → PRD → TDD → business-rules
```

Business rules file này **tổng hợp** từ các doc trên. Khi phát hiện mâu thuẫn → update doc nguồn TRƯỚC, rồi sync lại file này.

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 15/07/2026 | v1.7 | Reconcile authority qua decisions v1.31: public field whitelist/gating (DD-41), approval/waitlist/derivation fail-closed (DD-05/45), attendance/tags/invite (DD-42/43/44), personal tenant (DD-46), follow graph/profile visibility (DD-47/48); bỏ stale-baseline disclaimer. |
| 10/07/2026 | v1.6 | **DD-37 pivot:** Messenger P4.8 → phase-1 (P2.5, Meta App Review); free = 2 bot Zalo/Messenger (bỏ Telegram); nhắc = web + Zalo (bỏ group-mention TG). **DD-40:** thêm BL-PAY-11 mark-paid = INSERT `payment_allocations` (source cash/manual) + update `charges`, KHÔNG bảng `payment`, mọi tier; auto-reconcile chỉ host_pro. |
| 20/06/2026 | v1.4 | Add DD-03 host pricing tiers and entitlement gate rule |
| 20/06/2026 | v1.5 | BL-BIL-1: làm rõ `free_web` (0đ) vào thẳng active vô thời hạn, không past_due/suspended vì non-payment |
| 20/06/2026 | v1.3 | Clarify AUDIT BL-1 maps to BL-PAY-1 and provider webhooks require edge per-token/IP burst cap + body-size cap |
| 19/06/2026 | — | Thêm Changelog table |
| 18/06/2026 | v1.0 | Tổng hợp business rules từ BRD/PRD/TDD |
