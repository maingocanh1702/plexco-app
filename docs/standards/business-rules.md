# Business Rules — Plexco

> Registry quy tắc nghiệp vụ, tổng hợp từ `docs/product/BRD.md` · `docs/product/PRD.md` · `docs/product/TDD.md` v3.1 · `docs/standards/decisions.md` v1.69 · `docs/research/player-side-saas-AUDIT.md`.
>
> **Reconcile 18/07/2026:** đã đồng bộ full DD-49–56 và accepted-in-principle DD-61–64. DD-69 direction ✅ accepted; chưa tạo active business rule mới; decision log vẫn là authority khi một DD thay đổi, registry này là mirror để review/build.
> Khi conflict, authority theo topic trong BRD §0; security dùng rule nghiêm ngặt hơn.
> v1.23 · 2026-07-19 (current authority v1.69/TDD v3.1; DD-70..72 vẫn 🟡 và các rate row bên dưới là **PROPOSAL/INACTIVE**; share/activity sequencing corrected nhưng BL mới vẫn chờ downstream propagation; không claim runtime)

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
| **BL-PAY-11** | **Mark-paid = allocation, mọi tier (DD-40)** | Host xác nhận "đã thu" thủ công → INSERT `payment_allocations` + cập nhật `charges` (`amount_allocated`/`status`). **KHÔNG** ghi bảng `payment`/`payments`. Tiền mặt → `source='cash'` (`bank_transaction_id=NULL`, `created_by` bắt buộc); CK đã ingest → `source='manual'` + exact `bank_transaction_id`. CK host-attested **chưa ingest** chỉ được dùng dedicated allocation source sau migration, `bank_transaction_id=NULL`, actor + opaque evidence/audit; trước migration reject fail-closed. **Cấm** synthetic `bank_transaction` và cấm map sang `cash\|manual\|bank_transfer`. Mark-paid có ở mọi tier; auto-reconcile chỉ `host_pro`. | DD-40 v1.39, schema.ts §payment_allocations |

---

## BL-ID — Định danh & Gộp (Identity)

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-ID-1** | **Person toàn cục** | Mỗi người = 1 `Person`; mỗi identity Zalo/Messenger = 1 `ChannelIdentity` (Telegram chỉ còn legacy data, không phải surface MVP); quan hệ với CLB = `Membership`. | BRD BR-9, FR-7.1, DD-37 |
| **BL-ID-2** | **Claim-có-tiền cần khoá mạnh** | Claim membership đã có nợ/lịch sử tiền chỉ qua verified account email hoặc transactional one-time `link_code`. Tên/alias, owner assertion và CK/STK chỉ là review evidence; không được bypass. | DD-50, BRD FR-7.2 |
| **BL-ID-3** | **Merge xuyên kênh** | Phase-1 proof = verified account email hoặc `link_code` được lock/verify/consume once trong transaction + explicit impact confirm. Phone giữ dormant; tên/STK/owner chỉ tạo suggestion/review. Conflict fail-closed. | DD-50, BRD FR-7.3 |
| **BL-ID-4** | **UNIQUE per tenant + merge-safe** | Active membership unique per `(tenant,person)`; conflict merge dùng survivor+tombstone, re-parent charge/history, không sửa ledger rows. | TDD §3.2, Identity feature v1.1 |
| **BL-ID-5** | **ChannelIdentity scoped theo endpoint** | Tin nhắn đầu tiên tạo/resolve identity bằng `(platform, provider_scope_lookup_hash, platform_user_lookup_hash)`: Messenger scope Page; Zalo scope bot/OA tới khi DD-15 chứng minh rộng hơn. Không auto-merge xuyên endpoint bằng tên/alias. | PRD FLOW 5, DD-15/67 |
| **BL-ID-6** | **Routing theo trusted context, KHÔNG nội dung** | Zalo bot/Messenger Page chỉ pin endpoint và có thể cho default ingress context. Target tenant/resource eligibility luôn authorize riêng; action/ref/picker phải protected, KHÔNG lấy authority từ free text/client body. | BRD CO-4, NFR-S3, DD-66/67 |
| **BL-ID-7** | **Social profile tách khỏi dữ liệu vận hành** | Follow/profile cross-user chỉ trả approved social fields có canonical source. Host operational access vẫn qua tenant-scoped APIs; follow không mở roster, tiền, PII, `pay_code` hay membership. | DD-47/48 |

---

## BL-DSC — Discovery & Marketplace

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-DSC-1** | **Field whitelist cho public** | `public_sessions`: sport_key, starts_at, ends_at, area, price, slots_open, host/club display name, join_policy; session policy fields an toàn gồm `title`, `session_type`, `level_min_rank`, `level_max_rank`, `level_strict`, `gender_restriction`, `age_min`, `age_max`. Retire public `skill_level`. Routing tenant ID không serialize. Không roster, debt/payment, contact, venue chi tiết, STK, `notes`, `instructions`, `byoe` hay `cost_shared`. | BRD BR-4, DD-41, NFR-S2, AUDIT §public |
| **BL-DSC-2** | **Publish theo từng kèo** | Host chọn `visibility=public` per-session → projector đẩy vào `public_sessions`. Đóng kèo → hạ khỏi marketplace. | BRD FR-3.1, PRD FLOW 12 |
| **BL-DSC-3** | **Join cross-club** | Resolve current player/request trước: `active|waitlisted|pending` trả current outcome idempotently, không write/alert mới. Chỉ absent/`left` mới pass DD-41/DD-42/shared DD-52 trước membership/request/player mutation. `open`: còn chỗ → active + exactly-one charge + venue, full → waitlisted không charge/venue. `approval`: pending không membership/player/charge/capacity/venue; existing `left` request-create chỉ preflight live DD-49, không persist proof. Approve lock session→root-job→request, re-check restrictions + re-derive aggregate; drift/unknown giữ pending/zero mutation. Active fill resolves old promotion roots. | BRD FR-3.2, DD-05/06/41/42/45/49/52 |
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
| **BL-SES-8** | **Private invite token** | Invite token opaque/hash-at-rest, bound session, expiry/revoke/max-use, redeem atomic under `session→token`. Validate hash/binding/expiry/revoke, then current `active|waitlisted|pending`/exact actor-bound replay returns without extra use. `max_uses` + DD-41/DD-42/DD-52 gate only absent/left transition; restriction/unknown gives zero request/player/charge/token/host-alert mutation. Venue only after active. | DD-44 |
| **BL-SES-9** | **Waitlist là state canonical** | First-entry full → `waitlisted` với position dương, không tạo charge/venue. Capacity chỉ đếm active; initial promotion và retry đều chạy canonical current-order selector, không direct-promote theo stale event rank. Mỗi candidate re-check DD-41, DD-42 và shared `evaluateJoinRestriction()` DD-52; restricted candidate giữ queue nhưng bị skip. Existing-`left` rejoin re-derive DD-49: outcome active thì chưa-refund carry-over hoặc refunded append lifecycle; full→waitlisted thì chưa-refund giữ historical aggregate, refunded defer lifecycle mới tới activation. Chỉ fallback `REJOIN_REQUIRES_REVIEW` khi correction core chưa land/không chứng minh được disposition. | DD-41/42/45/49/52 |
| **BL-SES-10** | **Resolve financial disposition trước promotion mutation** | First-activation promotion phải suy giá theo DD-39 trước khi đổi state và tạo đúng một charge. DD-49 rejoin promotion re-derive live aggregate; chưa-refund carry-over, refunded append lifecycle mới atomic với activation, không tạo charge row thứ hai. First derivation failure lazy-creates one root job `(tenant,session,origin)`; job owns one CAS/lease claimed-attempt counter max 3, còn candidate events chỉ bind entry + root for audit. Each completed current-order sweep tries each candidate once and re-checks DD-41/DD-42/DD-52. Expired final claim finalizes under `session→job` to resolved-or-terminal without derivation/attempt 4. Owner digest dedupes per root; sibling events cannot multiply job/budget/alerts. | DD-39/41/42/45/49/52 |

---

## BL-ORG — Session Organize (**ACCEPT-IN-PRINCIPLE · INACTIVE, build post-P4**)

> Các rule BL-ORG chỉ là mirror của DD-61..64 (✅ accept-in-principle, build post-P4). Không gate runtime và không được implement trước khi có build slice + prerequisites (SessionService, DD-56 registry/grant, level source).

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-ORG-1** | **Lifecycle theo status + time** | Setup/assignment chỉ khi session `open` và `now < ends_at`; start/score chỉ khi `open` và `starts_at <= now < ends_at`. `past` là derived time, không phải session status; mutation sau end fail closed. | DD-61 accepted-in-principle |
| **BL-ORG-2** | **V0.4 chỉ hai phía** | `side_count=2`; scoring chỉ `none\|live`. Live cần target/win-by dương và best-of lẻ dương. N-side cần DD riêng. | DD-61/62 accepted-in-principle |
| **BL-ORG-3** | **Tenant/session integrity** | Organize rows dùng same-tenant/session composite FKs, ENABLE+FORCE RLS và migration mới; chỉ active player đúng session được assign/read. RLS không thay relation authz. | DD-61/64 accepted-in-principle |
| **BL-ORG-4** | **Live fence + participant stint** | Một court tối đa một live match; một match tối đa một live set; một player không ở hai live match. Participant withdraw giữ row lịch sử; replacement/re-entry tạo stint mới; partial unique chỉ trên player/slot đang `assigned`. Session-first lock order + race tests bắt buộc. | DD-61 accepted-in-principle |
| **BL-ORG-5** | **Score append-only + idempotent** | `point\|reversal`; correction = reversal + replacement point cùng transaction. Terminal winning point chỉ sửa trước session end, khi vẫn là latest effective point, chưa có dependent action và court chưa reassigned; nếu không chứng minh được thì fail-closed. Không UPDATE/DELETE ledger; mọi mutation dùng durable `commandId` + RFC 8785 canonical request hash. Retry chỉ trả prior DTO sau current authz re-check; payload/resource/version khác cùng key → conflict. | DD-62 accepted-in-principle |
| **BL-ORG-6** | **Private read/realtime + exact capability** | Không public projection. Owner/admin có built-in access; `session.organize` và `session.score` là grant session-scoped độc lập, không imply nhau. Read/SSE cho actor có grant hợp lệ hoặc active player đúng session; active stream re-authorize trước mỗi event và heartbeat ≤30s, đóng khi grant/session/participant relation hết hiệu lực; event không mang actor/PII/contact/payment/venue-private. | DD-64 accepted-in-principle |
| **BL-ORG-7** | **Không tự đổi attendance** | Match participation không tự đánh attendance/reliability. Leave/substitute chuyển stint thành `withdrawn`; replacement tạo row mới. Close hook cancel match nhưng giữ ledger và audit. | DD-42/61/64 accepted-in-principle |

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
| **BL-TEN-3** | **Provider boundary** | Tenant tự nối SePay/ApiPay và Zalo bot. Messenger dùng central Plexco Page mặc định; Page riêng là optional tenant integration. Telegram bỏ khỏi phạm vi. Platform không trung gian dòng tiền. | BRD BR-13, CO-1, DD-65 |
| **BL-TEN-4** | **Đa môn** | `sports` table (badminton, pickleball, tennis, bóng đá…); mỗi session gắn 1 sport_id; discovery lọc theo môn. | BRD BR-2 |
| **BL-TEN-5** | **Worker không bypass rộng** | Cross-tenant scheduler/outbox chỉ claim qua narrow privileged function; từng job quay lại `SET LOCAL app.tenant_id` và audit. | TDD §3.4 |
| **BL-TEN-6** | **Kèo cá nhân vẫn có tenant** | Skip Club auto-provision đúng một `tenants.kind='personal'` per Person, owner=self, logical free tier. `sessions.tenant_id` luôn NOT NULL; RLS, membership, participant và money model giữ nguyên. Không tạo session tenant-null. | DD-46 |

---

## BL-MSG — Messenger Hybrid Surface

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-MSG-1** | **Central luôn có, Page riêng optional** | Một Meta App; đúng một active central Page và tối đa một active tenant Page/tenant. Cả hai phục vụ host+player; club không Page vẫn hoàn tất create/join cơ bản. Registry global-protected, narrow resolver, không blanket grant. | DD-65 |
| **BL-MSG-2** | **Page không tự grant target tenant** | Tenant Page chỉ là default; central/multi-club/cross-club target từ opaque action, protected public ref hoặc server-side picker. Missing/stale/ambiguous/replayed → deny/re-pick. | DD-66 |
| **BL-MSG-3** | **Endpoint-scoped identity/reachability** | Messenger dùng Page scope + PSID theo contract chung ba phần; Zalo dùng bot/OA scope + `from.id`. Reachability/window gắn `channel_identity_id`; tenant eligibility authorize riêng. Không auto-merge xuyên endpoint. | DD-15, DD-50, DD-67 |
| **BL-MSG-4** | **Shared core + durable interaction** | Host wizard và player actions gọi cùng AuthZ/Session/Join services với web/Zalo. Một pre-dispatch owner giữ wizard; consume re-authorize/revalidate. Choice token opaque, actor+Page-bound, TTL+snapshot+version; tối đa 8 business choices/page + navigation. | DD-24, DD-56, DD-68 |
| **BL-MSG-5** | **One-route delivery** | Một logical notification giữ tối đa một active route xuyên platform và một live physical claim per exact target; tenant Page reachable → central Page reachable → web/Zalo. Fallback/retry chỉ sau proven-no-send dưới owner lock và fresh type-specific authorization/state check; provider failure không rollback canonical command. | DD-67, BL-SYN-2, BL-NTF-2 |

---

## BL-BIL — Billing & Lifecycle

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-BIL-1** | **Subscription host** | `host_pro`: trial 14 ngày, nhắc trước 2 ngày, hết trial không trả thì khoá ngay về free; invoice renewal trễ có grace 7 ngày rồi suspended. Cancel giữa kỳ được hoàn toàn bộ nếu request trong 7 ngày từ lúc paid, sau đó không hoàn và dùng tới cuối kỳ. PlatformAdmin override tối đa 7 ngày, có reason/ticket/expiry/audit. `free` active vô thời hạn, không trial/invoice/past_due vì non-payment. Invoice ledger tách player ledger. | DD-29, DD-51 |
| **BL-BIL-1a** | **Plan entitlements** | `free`: web + kết nối 2 bot chat (**Zalo/Messenger** — Telegram bỏ, DD-37) + đối soát CK **thủ công** (mark-paid = allocation, BL-PAY-11/DD-40) + nhắc thủ công; `host_pro`: thêm đối soát **tự động** + nhắc nợ tự động + Trợ lý AI + CRM. Gate theo **capability flags config-driven** (registry `feature_billing_lifecycle_tech.md §4b`), không hardcode theo plan_key. (Messenger cần Meta App Review trước GA — DD-33/DD-37.) | DD-29 |
| **BL-BIL-2** | **Suspended behavior** | Chặn lệnh quản trị nhưng vẫn durable-ingest CK player. Kèo public hiện có chỉ sống tới khi đóng/hết giờ; không tạo/gia hạn mới. | BRD BR-11, FR-9.3 |
| **BL-BIL-3** | **LLM/STT fair-use** | Platform trả chi phí LLM/STT; có trần fair-use per-tenant. | BRD §9.2 |

---

## BL-NTF — Nhắc & Xác nhận

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-NTF-1** | **Nhắc chống spam** | Cron nhắc theo ngưỡng, chống lặp, quiet-hours. Kênh chính web+Zalo; Messenger best-effort trong 24h. Dispatcher đọc exact `channel_identity_id` reachability, re-check tenant eligibility và chọn một route; không tenant-level fan-out sang nhiều endpoint. | BRD FR-6.1, DD-67 |
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
| **BL-SOC-5** | **Một block source cho social + DM** | Block/unblock chỉ ghi canonical `chat_blocks`; block atomically xoá follow edges hai chiều, chặn follow request/DM request-create-send-read và không tự restore quan hệ khi unblock. Mọi follow/DM path consult cùng safety decision; không tạo `social_blocks`/store thứ hai. | DD-55 · TDD chat safety contract |

---

## BL-SEC — Bảo mật

| ID | Luật | Chi tiết | Source |
|---|---|---|---|
| **BL-SEC-1** | **Secret mã hoá at-rest** | Token bot/page, secret SePay: KMS at-rest. Không log. Có reset path. | NFR-S5, AUDIT §B2 |
| **BL-SEC-2** | **Webhook verify fail-closed** | SePay production dùng `HMAC_SHA256`: parse `X-SePay-Signature: sha256=<hex>`, kiểm tra `X-SePay-Timestamp`, reject lệch quá 300 giây và constant-time compare HMAC của `{timestamp}.{raw_body}`; không downgrade sang `Api_Key`. API-key fallback chỉ dành connector không hỗ trợ HMAC và phải exact `Authorization: Apikey <key>`. Provider khác dùng contract ký riêng đã pin. | AUDIT B-webhook, connector contract |
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
| **Organize score — ACCEPTED-IN-PRINCIPLE, NOT IMPLEMENTED** | `POST /api/matches/:id/score/{points,reversals}` | 5/s burst per match; 120/min per actor; 600/min dedicated organize bucket per tenant | match + actor + tenant; khi activate thì exempt generic tenant 200/min | 429 `RATE_LIMITED` |
| **Organize assignment preview — ACCEPTED-IN-PRINCIPLE, NOT IMPLEMENTED** | `POST /api/sessions/:id/assignments/preview` | 10/min per session; 30/min per actor | session + actor + generic tenant bucket | 429 `RATE_LIMITED` |
| **Notification inbox read — PROPOSAL/INACTIVE (DD-70)** | `GET /api/notifications/inbox`, `/unread-count` | 60/min list; 120/min unread | person | 429 `RATE_LIMITED` |
| **Notification inbox mutation — PROPOSAL/INACTIVE (DD-70)** | `POST /api/notifications/inbox/*/read`, `/read-all` | 120/min | person | 429 `RATE_LIMITED` |
| **Notification inbox SSE — PROPOSAL/INACTIVE (DD-70)** | `GET /api/notifications/inbox/stream` | 5 concurrent | person | 429 `RATE_LIMITED` |
| **Announcement preview — PROPOSAL/INACTIVE (DD-71)** | `POST /api/announcements/preview` | 60/min | tenant + actor | 429 `RATE_LIMITED` |
| **Announcement confirm — PROPOSAL/INACTIVE (DD-71)** | `POST /api/announcements` | initial shadow 10/day + 3/hour commands; fan-out threshold `TBD` config | tenant + actor + fan-out recipients; exact command fingerprint + atomic reservation, outage fail closed | 409 `IDEMPOTENCY_KEY_REUSED` · 429 `ANNOUNCEMENT_RATE_LIMITED` |
| **Announcement retry — PROPOSAL/INACTIVE (DD-71)** | `POST /api/announcements/:id/retry-failed` | 5/hour | announcement + actor + tenant + command; no active outcome, deterministic current-policy route rank + persisted per-intent result before one-route CAS; fresh checks; no second fan-out charge | 429 `ANNOUNCEMENT_RATE_LIMITED` |
| **Membership tag mutation — PROPOSAL/INACTIVE (DD-71)** | `POST/PATCH/DELETE /api/membership-tags`, `POST /api/memberships/tags` | 60/min actor + 120/min tenant | actor + tenant | 429 `RATE_LIMITED` |
| **Announcement preference — PROPOSAL/INACTIVE (DD-71)** | `PUT /api/notifications/preferences/:tenantId` | 20/min | person + tenant | 429 `RATE_LIMITED` |
| **Web Push subscription — PROPOSAL/INACTIVE (DD-72)** | `POST/DELETE /api/push/subscriptions` | 10/hour | person; POST requires actor-scoped UUID Idempotency-Key | 429 `RATE_LIMITED` |
| **Web Push telemetry — PROPOSAL/INACTIVE (DD-72)** | `POST /api/push/telemetry` | 300/hour | subscription + signed capability scope | 429 `RATE_LIMITED` |
| **Tenant aggregate** | All mutations combined | 200/min | tenant; trừ endpoint có dedicated tenant bucket được registry chấp thuận rõ | 429 `TENANT_RATE_LIMITED` |
| **Default mutation** | Any POST/PATCH/DELETE not listed | 60/min | account | 429 `RATE_LIMITED` |
| **Default read** | Any GET not listed | 120/min | account | 429 `RATE_LIMITED` |

**Implementation:** Sliding window, config-driven. Confirm first locks structural tenant+actor+command receipt, compares versioned canonical fingerprint, then under ordered bucket locks writes durable `announcement_quota_reservations` with fixed tenant/actor/fan-out units + expiry/status and canonical announcement in one transaction. Same fingerprint replays; mismatch rejects before reserve; outage fails closed; janitor releases only canonical-absent row after proof expiry+grace. Retry has separate actor receipt + per-intent selected-delivery/skip result; it locks intent, blocks active outcomes, ranks current eligible failed routes by canonical policy+UUID, persists result then CASes one route. Push registration separately uses actor+command/JTI receipt and trust epoch; network retry must not become a new trust reset.

---

## Source of Truth (khi conflict)

1. Live schema + migrations + invariant tests cho implementation reality.
2. `standards/decisions.md` cho quyết định canonical.
3. BRD → PRD → TDD cho requirement và architecture.
4. Rule security/money nghiêm ngặt hơn khi hai nguồn cùng áp dụng.

Business rules file này là **mirror**, không tự tạo authority. Khi phát hiện mâu thuẫn → update đúng nguồn canonical trước, rồi sync lại file này.

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 19/07/2026 | v1.23 | Authority v1.69. BL-DSC-3/SES-8 pin current-state-before-restriction and no-extra token use. BL-SES-10 pins lazy root, max 3 claimed attempts, expired-final resolve-or-terminal, tenant-private narrow claim and one owner digest/root. No runtime. |
| 19/07/2026 | v1.22 | Authority v1.65. BL-SES-9/10 pin one root max-3 sweep job/opener; candidate events are sibling audit/alert refs, not budgets. Sweeps re-enter current order + DD-41/DD-42/DD-52; final-slot/no-failure resolves old root so it cannot sweep a later opening. No runtime. |
| 19/07/2026 | v1.21 | Authority v1.64. DD-74/75 là baseline producer sau dependency + reprioritization; chỉ DD-76/77 hard-gated bởi product evidence; DD-78 đi cùng consumer. Chưa thêm BL share/activity vì downstream spec/schema vẫn chưa author; không runtime. |
| 19/07/2026 | v1.20 | Authority v1.63; BL-SES-9 pin active-only refunded lifecycle, full→waitlisted defer. BL-SES-10 pin entry-bound origin event + CAS/lease max-3 retry and consume-time revalidation. Notification security-factor cutoff mirrored at immutable context start; DD-70..72 remain inactive proposals. No runtime. |
| 19/07/2026 | v1.19 | Authority v1.60. DD-73..78 ✅ chốt — **chưa thêm BL nào cho cụm share/activity** (BL whitelist card + revoke thuộc propagation chưa thực hiện). Không đổi rule hiện hành. |
| 19/07/2026 | v1.18 | Authority v1.62; waitlist integrity mirror + notification implementation closure v1.61: durable quota/retry receipts, deterministic route select, external push idempotency/trust epoch. DD-70..72/rate rows inactive; no runtime. |
| 18/07/2026 | v1.17 | Authority v1.50; thêm registry rows **PROPOSAL/INACTIVE** cho DD-70/71/72 notification endpoints. Announcement confirm pin atomic idempotent tenant+actor+fan-out reservation và fail-closed outage; chưa activate threshold/runtime. |
| 18/07/2026 | v1.16 | Authority v1.47: DD-61..64 accepted-in-principle; update BL-ORG sources/rate labels while retaining explicit not-implemented/inactive boundary. DD-69 accepted direction still creates no active business rule. |
| 18/07/2026 | v1.15 | Authority → decisions v1.46. DD-69 vẫn proposal kỹ thuật app client và không tạo active business rule mới; registry body unchanged. |
| 17/07/2026 | v1.14 | Feature-doc closure: SePay production HMAC timestamp/raw-body contract; bounded terminal-point correction + active SSE re-auth ≤30s; User Settings block tái dùng canonical `chat_blocks`. Runtime/migration vẫn pending. |
| 17/07/2026 | v1.13 | Authority → decisions v1.45/TDD v3.0. Generalize BL-ID/BL-MSG/BL-NTF từ Messenger Page-only sang provider-endpoint identity/reachability cho Messenger + Zalo; reachability gắn `channel_identity_id`, tenant eligibility authorize riêng. |
| 17/07/2026 | v1.12 | Reconcile BL-ORG với Session Organize v0.3: participant stint + partial assigned uniqueness, independent organize/score grants, canonical request hash và replay re-authorization. Vẫn proposal inactive. |
| 17/07/2026 | v1.11 | Authority refresh v1.44; giữ BL-MSG active, BL-ORG summary inactive proposal; chi tiết Session Organize v0.3 ở feature specs. |
| 17/07/2026 | v1.10 | Reconcile decisions v1.43/DD-65..68. Thêm BL-MSG-1..5: hybrid central+optional Page, shared host/player surface, protected target routing, Page-scoped identity/reachability, durable opaque interaction và one-route delivery. |
| 17/07/2026 | v1.9 | Reconcile decisions v1.42. Thêm BL-ORG-1..7 và exact organize score/assignment rate rows, đều ghi rõ **proposal inactive** tới khi owner accept DD-61..64; live score dùng dedicated tenant bucket thay generic 200/min khi/ nếu được activate. |
| 16/07/2026 | v1.8 | Reconcile decisions v1.39: DD-40 dedicated host-attested allocation source/no synthetic transaction; DD-49 rejoin/correction; DD-50 verified-email + transactional `link_code`; DD-51 exact lifecycle; source-of-truth order theo BRD §0. |
| 15/07/2026 | v1.7 | Reconcile authority qua decisions v1.31: public field whitelist/gating (DD-41), approval/waitlist/derivation fail-closed (DD-05/45), attendance/tags/invite (DD-42/43/44), personal tenant (DD-46), follow graph/profile visibility (DD-47/48); bỏ stale-baseline disclaimer. |
| 10/07/2026 | v1.6 | **DD-37 pivot:** Messenger P4.8 → phase-1 (P2.5, Meta App Review); free = 2 bot Zalo/Messenger (bỏ Telegram); nhắc = web + Zalo (bỏ group-mention TG). **DD-40:** thêm BL-PAY-11 mark-paid = INSERT `payment_allocations` (source cash/manual) + update `charges`, KHÔNG bảng `payment`, mọi tier; auto-reconcile chỉ host_pro. |
| 20/06/2026 | v1.4 | Add DD-03 host pricing tiers and entitlement gate rule |
| 20/06/2026 | v1.5 | BL-BIL-1: làm rõ `free_web` (0đ) vào thẳng active vô thời hạn, không past_due/suspended vì non-payment |
| 20/06/2026 | v1.3 | Clarify AUDIT BL-1 maps to BL-PAY-1 and provider webhooks require edge per-token/IP burst cap + body-size cap |
| 19/06/2026 | — | Thêm Changelog table |
| 18/06/2026 | v1.0 | Tổng hợp business rules từ BRD/PRD/TDD |
