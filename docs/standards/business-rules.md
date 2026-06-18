# Business Rules — Plexco

> Registry quy tắc nghiệp vụ, tổng hợp từ `docs/core/BRD.md` v3.1 · `docs/core/PRD.md` v2.1 · `docs/core/TDD.md` v2.1 · `docs/appendices/player-side-saas-AUDIT.md`.
> Khi conflict, authority theo topic trong BRD §0; security dùng rule nghiêm ngặt hơn.
> v1.2 · 2026-06-19

---

## BL-PAY — Thanh toán & Đối soát (Module Tiền)

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-PAY-1** | **Durable trước ACK** | Trong một DB transaction: insert `bank_transaction` idempotent + enqueue reconcile job/outbox; commit rồi mới trả 200. Match chạy async, retry an toàn sau crash. | BRD FR-5.1, TDD §3.6 |
| **BL-PAY-2** | **Không over-allocation** | Effective allocation của bank transaction nằm trong `[0, amount]`; allocation vào charge nằm trong `[0, amount_due]`. Charge chỉ paid khi phủ đủ. | BRD FR-5.2/5.3, NFR-R3 |
| **BL-PAY-3** | **Matching phase-gated** | P3 dùng name + amount + date; pay_code deterministic chỉ được phát khi P4 rollout hoàn tất. Trường hợp một CK/nhiều người nhập nhằng phải manual allocation. | PRD FLOW 6, TDD §3.7 |
| **BL-PAY-4** | **Idempotent per-tenant** | `UNIQUE(tenant_id, provider, external_id)` → webhook trùng skip, không double-count. | NFR-R2 |
| **BL-PAY-5** | **FIFO allocation** | Cùng người có nhiều charge đồng giá/ngày → allocate oldest-first; không suy danh tính chỉ từ `fee × N`. | PRD §4.1 |
| **BL-PAY-6** | **Route CK đúng tenant** | webhook_token + verify account_number → `bank_accounts` → tenant. | BRD FR-5.1, TDD §3.3 |
| **BL-PAY-7** | **Unmatched/remainder review** | CK không khớp hoặc còn dư → `/unmatched`; host có thể tạo nhiều allocations nhưng tổng không vượt funds. | BRD FR-5.4 |
| **BL-PAY-8** | **Immutable ledger** | Không sửa/xóa bank transaction/allocation đã audit; điều chỉnh bằng signed reversal tham chiếu allocation gốc. | TDD §3.2 |
| **BL-PAY-9** | **Cash/waiver có provenance** | `/cash`/waiver tạo allocation không có bank transaction nhưng bắt buộc authorized actor; không tạo webhook giả. | PRD command map, Payment feature v1.1 |
| **BL-PAY-10** | **STK change confirmation delay** | Đổi STK primary → pending 24h → hệ thống vẫn dùng STK cũ cho QR. Thông báo đổi gửi qua MỌI kênh đã link. Owner cancel được. Rate-limit: max 2 lần/30 ngày. | AUDIT G1 |

---

## BL-ID — Định danh & Gộp (Identity)

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-ID-1** | **Person toàn cục** | Mỗi người = 1 `Person`; mỗi TG/Zalo/Messenger = 1 `ChannelIdentity`; quan hệ với CLB = `Membership`. | BRD BR-9, FR-7.1 |
| **BL-ID-2** | **Claim-có-tiền cần khoá mạnh** | Claim membership đã có nợ/lịch sử tiền: chỉ qua (1) owner gán, (2) CK khớp từ cùng STK, (3) mã link OTP. **KHÔNG** cho claim bằng tên/alias. | AUDIT C2, BRD FR-7.2 |
| **BL-ID-3** | **Merge xuyên kênh** | Thứ tự tin cậy merge: mã link OTP → SĐT verified → email verified → STK+tên (gợi ý, owner duyệt). **Chỉ verified mới auto-merge.** | AUDIT C3/C5, BRD FR-7.3 |
| **BL-ID-4** | **UNIQUE per tenant + merge-safe** | Active membership unique per `(tenant,person)`; conflict merge dùng survivor+tombstone, re-parent charge/history, không sửa ledger rows. | TDD §3.2, Identity feature v1.1 |
| **BL-ID-5** | **Auto-create ChannelIdentity** | Tin nhắn đầu tiên từ kênh mới → tạo ChannelIdentity + gắn Person (mới hoặc merge nếu verified). | PRD FLOW 5 |
| **BL-ID-6** | **Routing theo kênh, KHÔNG nội dung** | Tenant luôn suy từ kênh (group chat_id / Zalo bot / page_id / deep-link / web-session). KHÔNG suy từ nội dung tin (chống spoof). | BRD CO-4, NFR-S3 |

---

## BL-DSC — Discovery & Marketplace

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-DSC-1** | **Field whitelist cho public** | `public_sessions`: sport_key, starts_at, ends_at, area, skill_level, price, slots_open, host/club display name, join_policy. Routing tenant ID không serialize. Không roster, debt/payment, contact, venue chi tiết hoặc STK. | BRD BR-4, NFR-S2, AUDIT §public |
| **BL-DSC-2** | **Publish theo từng kèo** | Host chọn `visibility=public` per-session → projector đẩy vào `public_sessions`. Đóng kèo → hạ khỏi marketplace. | BRD FR-3.1, PRD FLOW 12 |
| **BL-DSC-3** | **Join cross-club** | Player join kèo CLB chưa tham gia → tạo `Membership(guest)`. Nếu `join_policy=approval` → `join_requests` chờ host duyệt. | BRD FR-3.2 |
| **BL-DSC-4** | **Rate-limit + anti-scraping** | Discovery API: rate-limit per IP, phân trang, không expose danh sách toàn bộ tenant. | NFR-S2 |

---

## BL-SES — Session Management

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-SES-1** | **Timezone bắt buộc** | `starts_at/ends_at` là timestamptz; mỗi session có IANA timezone. DST xử lý deterministic. | BRD FR-2, TDD §3.2 |
| **BL-SES-2** | **Capacity không over-fill** | Join và capacity change lock session; concurrent ops không vượt `slots_max`. | PRD FLOW 2, Session feature |
| **BL-SES-3** | **Price change + charges** | Đổi giá sau khi có charges yêu cầu explicit impact policy; không silent mutation. | Session feature §rules |
| **BL-SES-4** | **Close/cancel immutable** | Session đóng/hủy reject mutation trừ privileged correction có audit. Public projection bị hạ. | PRD FLOW 2, BRD FR-2 |

---

## BL-SYN — Sync Engine

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-SYN-1** | **PostgreSQL/domain model canonical** | Web/chat là surfaces; mọi ghi qua command bus/services/tenantRepo vào PostgreSQL. Không multi-master. | BRD BR-6, CO-4 |
| **BL-SYN-2** | **Outbox + delivery ledger** | Thay đổi + outbox cùng transaction; command dedupe và projector delivery UNIQUE. Messenger projector chỉ ở P4.8. | TDD §3.8, BRD FR-4.2 |
| **BL-SYN-3** | **Re-project** | Surface lệch → re-project từ event replay. Không cần Surface giữ state độc lập. | BRD FR-4.3, NFR-R4 |

---

## BL-TEN — Multi-tenant & Cô lập

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-TEN-1** | **RLS fail-closed** | ENABLE + FORCE RLS; role `app` = `NOBYPASSRLS`; `SET LOCAL app.tenant_id`. Mọi tenant query qua `tenantRepo`. | BRD BR-1, NFR-S1 |
| **BL-TEN-2** | **3 tầng hiển thị** | Public (cross-tenant, field whitelist) / Tenant-private (RLS) / Person-self (person-authorized). | BRD §7 FR-0, TDD §3.2 |
| **BL-TEN-3** | **CLB tự mang provider** | Tenant tự nối SePay/ApiPay và Zalo bot; Messenger Page là P4.8 post-MVP. Platform không trung gian dòng tiền. | BRD BR-13, CO-1 |
| **BL-TEN-4** | **Đa môn** | `sports` table (badminton, pickleball, tennis, bóng đá…); mỗi session gắn 1 sport_id; discovery lọc theo môn. | BRD BR-2 |
| **BL-TEN-5** | **Worker không bypass rộng** | Cross-tenant scheduler/outbox chỉ claim qua narrow privileged function; từng job quay lại `SET LOCAL app.tenant_id` và audit. | TDD §3.4 |

---

## BL-BIL — Billing & Lifecycle

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-BIL-1** | **Subscription host** | Trial → active → past_due → suspended → cancelled. Invoice ledger tách khỏi player payment ledger. | BRD FR-9.1/9.2 |
| **BL-BIL-2** | **Suspended behavior** | Chặn lệnh quản trị nhưng vẫn durable-ingest CK player. Kèo public hiện có chỉ sống tới khi đóng/hết giờ; không tạo/gia hạn mới. | BRD BR-11, FR-9.3 |
| **BL-BIL-3** | **LLM/STT fair-use** | Platform trả chi phí LLM/STT; có trần fair-use per-tenant. | BRD §9.2 |

---

## BL-NTF — Nhắc & Xác nhận

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-NTF-1** | **Nhắc chống spam** | Cron nhắc theo ngưỡng (cấu hình), chống lặp, quiet-hours. Kênh: group-mention (TG) / DM (Zalo/Messenger/TG) theo `ChannelReachability` đúng tenant. | BRD FR-6.1 |
| **BL-NTF-2** | **Xác nhận best-effort** | Chỉ sau `payment.settled` (charge phủ đủ) → xác nhận player. Lỗi gửi không rollback ledger; correction event xử lý reversal sau notify. | BRD FR-6.2 |
| **BL-NTF-3** | **Messenger cửa sổ 24h** | Messenger chỉ gửi được trong 24h sau tin nhắn cuối. Nhắc nợ best-effort, không đảm bảo. | CO-3, messenger doc |

---

## BL-SEC — Bảo mật

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-SEC-1** | **Secret mã hoá at-rest** | Token bot/page, secret SePay: KMS at-rest. Không log. Có reset path. | NFR-S5, AUDIT §B2 |
| **BL-SEC-2** | **Webhook timing-safe verify** | Mọi webhook verify bằng constant-time compare (SePay API key) hoặc HMAC-SHA256 (ApiPay). | AUDIT B-webhook |
| **BL-SEC-3** | **Audit trail** | Mọi thao tác chạm tiền/định danh: ghi admin_id, timestamp, method (auto/manual). | NFR-S6, BRD BR-12 |
| **BL-SEC-4** | **PII consent + mã hoá** | SĐT/email thu có consent; AES at-rest; soft-delete; không vào URL/log. | NFR-P1 |
| **BL-SEC-5** | **Mutation rate limit** | POST/PATCH/DELETE: 60/min per account, 200/min per tenant. Public endpoints (discovery, join): 100/min per IP. Sliding window. | AUDIT G3 |
| **BL-SEC-6** | **Audit log retention** | Financial: 3 năm. Identity: 1 năm. Session/auth: 90 ngày. Không xoá — archive sau retention. | AUDIT G4 |

---

## Appendix: BL-SEC-5 Rate Limit Registry

> Bảng tham chiếu chuẩn cho **mọi BE tech doc**. Khi thêm endpoint mới, thêm vào bảng này.

| Category | Endpoint pattern | Limit | Scope | Error |
|----------|-----------------|-------|-------|-------|
| **Webhook (provider)** | `POST /webhook/*` | Unlimited | — | — |
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
