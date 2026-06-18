# Business Requirements Document (BRD) — Plexco
## Platform quản lý & khám phá hoạt động thể thao đa môn (host + player), tích hợp Telegram · Zalo + Web app *(Messenger post-MVP)*

---

## 0. Document Control

| | |
|---|---|
| **Sản phẩm** | **Plexco** — platform quản lý hoạt động thể thao cho **host** và khám phá/tham gia kèo cho **player**, đa môn (cầu lông, pickleball, tennis, bóng đá…), hoạt động ngay trong Telegram/Zalo + web app đồng bộ; Messenger là mở rộng post-MVP |
| **Phiên bản** | v3.1 — chuẩn hoá MVP scope, canonical store, durable webhook và payment ledger/allocation sau review |
| **Ngày** | 19/06/2026 |
| **Người soạn** | Ngoc-Anh |
| **Người duyệt (approvers)** | Ngoc-Anh (solo founder, self-approved) |
| **Trạng thái** | Draft để review |
| **Tài liệu liên quan** | `../appendices/saas-implementation-plan.md` (kiến trúc) · `PRD.md` (user flows) · `TDD.md` (thiết kế kỹ thuật) · `../appendices/player-side-saas-reconciliation.md` (identity/kênh/player) · `../appendices/player-side-saas-AUDIT.md` (bảo mật + threat model discovery) · `../appendices/messenger-channel-design.md` (kênh Messenger) |

> BRD là nguồn sự thật cho **product scope & business rules**; PRD cho hành vi/user flow; TDD cho implementation contract; ROADMAP cho thứ tự và tiến độ. Security constraints đã chốt trong AUDIT là bắt buộc. Khi có conflict cùng một chủ đề: **BRD → PRD → TDD → ROADMAP**; riêng security: quy tắc nghiêm ngặt hơn giữa BRD và AUDIT thắng.

---

## 1. Tóm tắt (Executive Summary)

**Plexco** là platform **2 phía** cho hoạt động thể thao phong trào đa môn:

- **Phía Host (chủ CLB/người tổ chức):** tạo & quản lý buổi chơi ("kèo"), roster, **thu & tự đối soát tiền sân** — ngay trong Telegram/Zalo và trên web app; Messenger bổ sung post-MVP.
- **Phía Player:** **khám phá kèo** đang mở của nhiều môn / nhiều CLB (lọc theo môn, khu vực, giờ, trình độ, giá), **join**, theo dõi kèo & nợ của mình — xuyên CLB.

**Định vị cốt lõi:** Plexco gặp người dùng **ở nơi họ đã ở** (Telegram/Zalo — 0 cài app cho player) và cung cấp web app làm hub tương tác. **PostgreSQL + domain model là canonical store**; web và các kênh chat là surface. Một hành động ở bất kỳ surface nào tự động được ghi vào canonical store rồi project sang các surface liên quan. Messenger là mở rộng post-MVP.

**GTM:** MVP tích hợp Telegram/Zalo—các platform đã có sẵn user—thay vì bắt cài app mới; Messenger mở rộng sau. Web app gom và đồng bộ session từ các kênh. **1 host mới ⇒ kéo nguyên community player vào** → chi phí acquisition ≈ 0.

Đã có bot single-club chạy thật (cầu lông) — logic tiền (matching, gạch nợ) đã kiểm chứng, được lift sang `packages/core`. Plexco hoá phần này thành platform đa tenant, đa môn, có **discovery marketplace** + **sync engine** + **web app**.

---

## 2. Bài toán & Giải pháp (Problem & Solution)

### 2.1 Nỗi đau (Pain-points)

**Host:**
- Đối chiếu chuyển khoản (CK) ngân hàng thủ công với danh sách người chơi — nội dung lệch tên, trùng số tiền, trả hộ.
- Nhắc nợ thủ công, ngại nhắc, hay quên ai chưa trả.
- Dữ liệu rải rác nhiều nhóm chat (Zalo lẫn Telegram), không có cái nhìn tổng (lịch, doanh thu, ai hay đi).

**Player:**
- **Không biết hôm nay/cuối tuần có kèo nào mở** quanh mình, môn mình thích, còn slot không.
- Phải hỏi han trong từng nhóm; muốn chơi môn mới / CLB mới thì không có đường vào.
- Không rõ mình còn nợ buổi nào, đã CK rồi mà chưa được xác nhận.

### 2.2 Giải pháp
Một platform **2 phía** + **đa kênh** + **đa môn**:
- **Host** tự động hoá vòng tạo kèo → roster → **đối soát CK** → **nhắc** → **xác nhận**; quản lý club trên web; dữ liệu mỗi CLB **cô lập tuyệt đối** (tiền/roster nội bộ).
- **Player** mở **marketplace khám phá kèo** xuyên CLB/môn, join (kể cả CLB chưa từng tham gia), theo dõi kèo & nợ của mình.
- **Sync engine** giữ mọi kênh + web nhất quán: hành động ở 1 nơi hiện ngay ở mọi nơi.

---

## 3. Người dùng (Personas) & Stakeholders

### 3.1 Personas (người dùng cuối)

| Persona | Vai trò | Nỗi đau chính | Động lực dùng |
|---|---|---|---|
| **P1. Host / Organizer** | Chủ CLB, tạo & quản lý kèo, thu tiền. Tenant admin. | Đối soát CK thủ công, đòi nợ lắt nhắt, dữ liệu phân mảnh, không có cái nhìn tổng. | Tự động thu & đối soát; quản club trên web; **publish kèo để hút người chơi mới**. |
| **P2. Co-admin** (tùy chọn) | Người được host uỷ quyền | Cần chạy lệnh quản trị thay host | Chia việc vận hành. |
| **P3. Player (member)** | Người chơi trong CLB | Quên trả, không rõ nợ, không thấy lịch kèo. | Join dễ, biết nợ, được xác nhận tự động, xem mọi CLB của mình. |
| **P4. Player (discovery)** | Người chơi tìm kèo mới (môn/CLB chưa tham gia) | Không biết quanh mình có kèo nào mở. | **Tìm kèo theo môn/khu vực/giờ/trình độ**, join kèo CLB lạ. |

### 3.2 Stakeholders & quyền

| Bên | Vai trò | Ghi chú |
|---|---|---|
| **Platform Owner** (mình) | Vận hành Plexco | Doanh thu, chi phí, isolation, vận hành marketplace |
| **Bên thứ ba** | SePay/ApiPay, Telegram, Zalo Bot Platform, Meta Messenger, Postgres host, LLM/STT | Xem §12 Dependencies |

**Phân quyền cốt lõi (3 tầng hiển thị dữ liệu — xem §7 / TDD §3.2):**
- **Public discovery:** thông tin kèo công khai (môn, giờ, khu vực, giá, slot trống, tên host/CLB) — **ai cũng đọc**, KHÔNG tiền/PII/roster đầy đủ.
- **Tenant-private:** tiền/nợ/roster/đối soát/subscription — **chỉ trong tenant** (RLS fail-closed, 0 rò rỉ).
- **Person-self:** "club & nợ của chính tôi" xuyên CLB — chỉ chủ nhân (đường query person-authorized).

---

## 4. Mục tiêu & Chỉ số thành công

### 4.1 Mục tiêu (Objectives)

| ID | Mục tiêu |
|---|---|
| OBJ-1 | **Platform 2 phía đa môn**: host quản lý, player khám phá & join, xuyên CLB. |
| OBJ-2 | **Đa kênh + web app sync 2 chiều**: 1 hành động ở 1 kênh → nhất quán mọi nơi. |
| OBJ-3 | **Marketplace khám phá kèo** cross-club hoạt động, có người lạ join được. |
| OBJ-4 | **Tự động hoá vòng tiền** (đối soát/nhắc/xác nhận) — thế mạnh kế thừa, làm module. |
| OBJ-5 | **Cô lập dữ liệu tiền/nội bộ tuyệt đối** song song **public layer an toàn** (0 rò rỉ tiền/PII ra marketplace). |
| OBJ-6 | Monetization bền vững (host trả thuê bao); margin dương. |

### 4.2 KPI

| KPI | Định hướng |
|---|---|
| Số host hoạt động (active tenants) | Tăng đều |
| Số player hoạt động + **% player join qua discovery** (CLB chưa từng tham gia) | Tăng — chỉ số marketplace |
| Số kèo publish lên marketplace / tuần | Tăng |
| **% CK tự match không cần gán tay** | Càng cao càng tốt (chỉ số lõi module tiền) |
| Độ trễ sync (action → hiện ở kênh khác + web) | p95 ≤ 3 giây, p99 ≤ 10 giây |
| MRR & churn | MRR tăng, churn thấp |
| Sự cố rò rỉ cross-tenant **hoặc lộ tiền/PII ra public** | **= 0 (bắt buộc)** |

---

## 5. Phạm vi (Scope)

### 5.1 Trong phạm vi (MVP — đa môn + web sync + discovery)
**Đa môn** (sport là một chiều dữ liệu) · onboarding host self-serve (nối SePay/ApiPay, link Telegram, dán Zalo token) · quản lý kèo (host) trên cả chat lẫn web · **publish kèo công khai** + **marketplace discovery** (lọc môn/khu vực/giờ/trình độ/giá) · **player join cross-club** (open / approval theo cấu hình kèo) · player join/leave member · **đối soát CK tự động** + `/unmatched` gán tay · **nhắc & xác nhận tự động** · **định danh xuyên kênh** (global Person) + merge an toàn · **player view** (clubs/nợ/kèo của tôi) · **PostgreSQL/domain model là canonical store + sync engine** (TG/Zalo/web) · billing thuê bao host + vòng đời tenant · **multi-tenant isolation 3 tầng**.

### 5.2 Ngoài phạm vi
Thanh toán in-app/ví/thẻ (platform **không cầm tiền player**) · đặt sân/quản lý lịch sân (booking nhà thi đấu) · app mobile native · BI nâng cao · **Messenger và các nền tảng chat ngoài Telegram/Zalo** · matchmaking xếp cặp theo trình độ tự động (discovery là *tìm kèo*, không phải xếp đối thủ) — để ngỏ tương lai.

---

## 6. Yêu cầu nghiệp vụ (Business Requirements)

| ID | Yêu cầu |
|---|---|
| **BR-1** | Nhiều host/CLB dùng chung nhưng **dữ liệu tiền/roster cô lập tuyệt đối**. |
| **BR-2** | Hỗ trợ **nhiều môn thể thao**; mỗi kèo gắn 1 môn; discovery lọc theo môn. |
| **BR-3** | Host **tự onboarding** SePay + Telegram/Zalo không cần can thiệp kỹ thuật; Messenger áp dụng cùng nguyên tắc khi triển khai P4.8. |
| **BR-4** | Host **publish kèo công khai** (chọn từng kèo) → lên **marketplace**; thông tin public KHÔNG gồm tiền/PII/roster đầy đủ. |
| **BR-5** | Player **khám phá kèo** xuyên CLB/môn theo bộ lọc; **join** kèo (kể cả CLB chưa tham gia), open hoặc cần host duyệt theo cấu hình. |
| **BR-6** | **PostgreSQL + domain model là nguồn sự thật (canonical)**; web và các kênh là surface. Một hành động ở một surface → ghi canonical → project sang web + kênh liên quan. |
| **BR-7** | **Tự nhận diện CK** & đánh dấu đã trả, kể cả nội dung lệch tên; không khớp → vào chưa khớp cho host gán tay; **không tự đoán sai số tiền**. |
| **BR-8** | **Tự nhắc** chưa trả & **tự xác nhận** đã trả, qua đúng kênh khả dụng. |
| **BR-9** | Một người qua nhiều kênh được **gộp đúng 1 người**; trong cùng CLB không tách đôi nợ. |
| **BR-10** | Người chơi xem được **CLB, kèo & nợ của chính mình** xuyên CLB, không thấy của người khác. |
| **BR-11** | Host trả **thuê bao**; quá hạn **tạm ngừng lệnh quản trị** nhưng **vẫn lưu CK player** & vẫn hiển thị kèo đã publish. |
| **BR-12** | Thao tác chạm tiền/định danh phải **an toàn, có quyền, có audit**; **tiền/PII không bao giờ lọt ra public layer**. |
| **BR-13** | CLB **tự mang** tài khoản nhận tiền & bot/kênh; platform **không trung gian dòng tiền**. |

---

## 7. Yêu cầu chức năng (Functional Requirements — theo Module)

### MODULE 0 — Nền tảng đa tenant & 3 tầng hiển thị
- **FR-0.1** Mọi dữ liệu tiền/roster scoped `tenant_id` + RLS fail-closed (tenant-private).
- **FR-0.2** **Public projection** kèo đã publish (cross-tenant, read-only, field whitelist) phục vụ marketplace — đường riêng, KHÔNG qua RLS per-tenant, KHÔNG tiền/PII.
- **FR-0.3** **Person-self**: query xuyên CLB scoped theo person đã xác thực.

### MODULE 1 — Onboarding & Tenant (host)
- **FR-1.1** Đăng ký host qua web (Telegram Login / tài khoản web).
- **FR-1.2** Wizard nối SePay/ApiPay (token + secret webhook).
- **FR-1.3** Link Telegram (bot vào group + bind admin deep-link); nối Zalo (dán Bot Token). Nối Messenger (FB Login + chọn Page) là post-MVP — xem `../appendices/messenger-channel-design.md`.
- **FR-1.4** Cấu hình CLB: **môn mặc định**, ngôn ngữ, giá mặc định, roster on/off, auto-announce, **chính sách publish & join** (open/approval).

### MODULE 2 — Quản lý kèo (Host) — chat **và** web
- **FR-2.1** Tạo kèo (`/newsession` / web / định kỳ); set **môn**, ngày/giờ, **khu vực/venue**, giá, **slot tối đa**, **trình độ**, **visibility (private/public)**, **join policy**.
- **FR-2.2** Đăng kèo + nút tham gia vào group (auto/`/announce`); cập nhật roster trực tiếp; **mọi thay đổi sync sang web + marketplace**.
- **FR-2.3** Đóng kèo; xem danh sách & trạng thái trả; dashboard club (lịch, doanh thu, ai hay đi) trên web.

### MODULE 3 — Discovery & Join (Player) — **marketplace**
- **FR-3.1** **Tìm kèo** trên web/bot: lọc **môn, khu vực, ngày/giờ, trình độ, giá, còn slot**; xếp theo gần/sắp diễn ra.
- **FR-3.2** Xem chi tiết kèo công khai (KHÔNG roster đầy đủ/tiền người khác); **join** → nếu CLB chưa tham gia thì tạo membership (guest) + (nếu cấu hình) **gửi request host duyệt**.
- **FR-3.3** Join member quen thuộc: Telegram tap nút trong group; Zalo `/join` + số; web 1-click; Messenger quick-reply *(post-Zalo)*.
- **FR-3.4** Routing đúng CLB suy **từ kênh** (group/bot/page/deep-link), không từ nội dung.

### MODULE 4 — Sync Engine (web ⇄ kênh)
- **FR-4.1** PostgreSQL + domain model = **canonical store**; mỗi action (mọi surface) → command → áp vào store → phát **domain event**.
- **FR-4.2** Event **fan-out projection** ra surfaces MVP: edit message roster TG, DM Zalo, push web realtime, cập nhật public projection. Messenger projector được thêm ở P4.8. **Idempotent**, không double.
- **FR-4.3** Surface state lệch → **re-project** từ event (sửa lại message/UI). Web realtime (SSE/websocket) theo tenant/person.

### MODULE 5 — Đối soát & gạch nợ (module tiền — killer kế thừa)
- **FR-5.1** Nhận CK webhook, **route đúng CLB** theo tài khoản nhận; trong cùng transaction lưu `bank_transaction` + enqueue reconcile job/outbox, commit rồi mới ack.
- **FR-5.2** Mỗi lượt chơi tạo một `charge/debt`; CK gốc được giữ bất biến và phân bổ qua `payment_allocations`, hỗ trợ một CK trả nhiều khoản/người, trả thiếu/dư và hoàn tác có audit.
- **FR-5.3** Khớp CK ↔ khoản nợ theo **tên + số tiền + ngày** (mặc định); ưu tiên `pay_code` nếu có; FIFO khi đồng giá cùng ngày; tổng allocation **không vượt số tiền CK** và không mark quá số tiền phủ.
- **FR-5.4** CK không khớp hoặc còn dư → `/unmatched` gán tay; retry và thao tác gán đều **idempotent**.

### MODULE 6 — Nhắc & Xác nhận
- **FR-6.1** Cron nhắc người chưa trả theo ngưỡng, qua group-mention (TG)/DM (Zalo/Messenger/TG), chống spam, theo `ChannelReachability` đúng tenant.
- **FR-6.2** Sau **mọi** điểm markPaid (auto & tay) → **xác nhận tới player** (best-effort, không chặn dòng tiền) + sync web.

### MODULE 7 — Định danh & Gộp người chơi
- **FR-7.1** Mỗi người = **Person** toàn cục; mỗi tài khoản TG/Zalo/Messenger = **ChannelIdentity**; quan hệ với CLB = **Membership** (chứa nợ/lịch sử).
- **FR-7.2** Claim membership đã có tiền cần **khoá mạnh** (owner / CK khớp / mã link OTP), không theo tên.
- **FR-7.3** Merge xuyên kênh: mã link OTP → SĐT verified → email verified → STK/tên (gợi ý, owner duyệt). **Chỉ verified mới auto-merge.**

### MODULE 8 — Player View (person-self)
- **FR-8.1** Web + bot: liệt kê **CLB, kèo sắp tới, nợ/trạng thái** của chính person; **chỉ dữ liệu của họ**.

### MODULE 9 — Billing (host)
- **FR-9.1** Subscription host; trial → active → past_due → suspended.
- **FR-9.2** Thu qua CK vào tài khoản platform, khớp `invoiceCode`; idempotent.
- **FR-9.3** Suspended: chặn lệnh quản trị nhưng vẫn nhận & lưu CK player; kèo đã public chỉ tiếp tục hiển thị tới lúc đóng/hết giờ, không được tạo mới hoặc gia hạn.

---

## 8. Yêu cầu phi chức năng (Non-Functional Requirements)

### 8.1 Bảo mật & Cô lập (ưu tiên cao nhất)
- **NFR-S1** Cô lập tenant-private 2 lớp: app scoped `tenant_id` + DB RLS fail-closed. **0 rò rỉ cross-tenant.**
- **NFR-S2** **Public layer tách bạch:** chỉ field whitelist (môn/giờ/khu vực/giá/slot/host-name); **không bao giờ** tiền/PII/roster đầy đủ/STK; chống enumeration & scraping (rate-limit, phân trang).
- **NFR-S3** Định tuyến tenant **luôn suy từ kênh**, không từ nội dung (chống spoof).
- **NFR-S4** Webhook xác thực per-tenant, timing-safe; lưu payload trước khi xử.
- **NFR-S5** Secret (token bot/page, secret SePay) mã hoá at-rest (KMS); không log; có reset.
- **NFR-S6** Thao tác chạm tiền/định danh qua **path có kiểm soát + audit**.
- **NFR-S7** Phân quyền theo định danh người, tách khỏi routing theo kênh.

### 8.2 Riêng tư & Tuân thủ
- **NFR-P1** PII (SĐT/email/vị trí chính xác) thu có **consent**, mã hoá at-rest, retention & quyền xoá; **không lộ ra public** (marketplace chỉ hiện **khu vực**, không địa chỉ/SĐT cho tới khi join/được duyệt).
- **NFR-P2** ToS & Privacy Policy cho dữ liệu tài chính + dữ liệu vị trí.
- **NFR-P3** Tuân thủ ràng buộc nền tảng (Telegram/Zalo/Meta) & pháp luật VN.

### 8.3 Hiệu năng & Quy mô
- **NFR-PF1** Chịu **>1.000 tenant** + nhiều player discovery đồng thời (Postgres ghi song song + read model public).
- **NFR-PF2** Tôn trọng rate-limit Telegram/Zalo/Messenger (throttler + rải giờ cron + bucket per channel).
- **NFR-PF3** Tương tác bot/web phản hồi "tức thì"; **sync action → surface khác ≤ vài giây**.

### 8.4 Độ tin cậy & Toàn vẹn
- **NFR-R1** Không **mất CK** (transaction lưu raw + enqueue reconcile trước ack; synthetic id khi thiếu; worker retry tới khi terminal).
- **NFR-R2** Không **double-count** (idempotent external_id) & **sync idempotent** (command/event id).
- **NFR-R3** Không **auto-mark quá số tiền phủ**.
- **NFR-R4** **Single source of truth = PostgreSQL/domain model**; surface luôn reconcile được từ event (không multi-master conflict).
- **NFR-R5** Backup PITR; diễn tập restore.

### 8.5 Khả dụng & Vận hành
- **NFR-O1** Mỗi pha deploy độc lập, không phá bot CLB hiện tại.
- **NFR-O2** Observability: log gắn `tenant_id`, metrics sync-lag, error tracking; không lộ secret.

### 8.6 Bản địa hoá
- **NFR-L1** Tiếng Việt mặc định + tiếng Anh, cấu hình theo CLB.

---

## 9. Mô hình doanh thu (Monetization)

### 9.1 Dòng cốt lõi — Subscription host
- Host trả **thuê bao** cho bộ tool quản lý + đối soát + đa kênh + chỗ trên marketplace. (Giá khởi điểm đề xuất tiếp tục từ mốc cũ **99.000đ/tháng/CLB**, có **trial**; reposition platform có thể mở tier sau — OD-3.)
- Thu qua **CK vào tài khoản platform**, khớp `invoiceCode`; tách `subscription_invoices` khỏi player payment ledger (`bank_transactions`/`payment_allocations`).

### 9.2 Cấu trúc chi phí & nguyên tắc tiền
- **Tenant tự mang & tự trả** phí provider thu CK (SePay/ApiPay) — platform **không trung gian dòng tiền player**.
- **Zalo Bot**: free 3 bot/tài khoản → BYO bot dưới tài khoản host ⇒ free-at-scale (1 bot/club).
- **Messenger**: FB App của platform + Page per-club (BYO Page) — *(post-MVP, xem messenger doc)*.
- **LLM/STT** (OCR ảnh, voice) do **platform trả**, có **trần fair-use**.

### 9.3 Dòng tương lai (ngoài MVP)
Player-side premium (lọc/nhắc kèo nâng cao), promote kèo trên marketplace, managed Messenger/Zalo bot trả phí, nhiều tier host. **Không** làm loãng MVP.

---

## 10. Giả định (Assumptions)
- **AS-1** Người chơi đã dùng Telegram/Zalo/Messenger; CLB sinh hoạt qua nhóm chat.
- **AS-2** Player CK ngân hàng là chính; tên/nội dung CK gần tên trong CLB.
- **AS-3** Host tự nối SePay & tạo bot theo hướng dẫn (~vài phút).
- **AS-4** Logic matching/đường tiền bot single-club hiện tại **đúng** & tái dùng được.
- **AS-5** Player **muốn** khám phá kèo mới nếu được hiển thị thuận tiện (giả định marketplace — cần validate sớm).
- **AS-6** Đa số kèo host sẵn lòng publish công khai (ít nhất phần thông tin cơ bản) để hút người.

## 11. Ràng buộc (Constraints)
- **CO-1** Telegram = **1 bot dùng chung** (route theo chat_id); Zalo = **bot-token per-club**; Messenger = **1 App, Page per-club** *(post-MVP)*.
- **CO-2** Zalo Bot không inline button, GROUP còn Beta → player-flow Zalo bám DM number-reply.
- **CO-3** Messenger ràng buộc chính sách 2026 (cửa sổ 24h, Message Tags chết) → kênh "join + xác nhận", nhắc best-effort — *(post-MVP)*.
- **CO-4** **PostgreSQL/domain model là canonical store**; web và kênh chat là surface — command ghi vào store + projection ra surface, **không multi-master**.
- **CO-5** **Public marketplace KHÔNG bao giờ chứa tiền/PII**; chỉ projection field whitelist.
- **CO-6** Plexco xây **repo riêng**, không refactor tại chỗ bot live.

## 12. Phụ thuộc bên ngoài (Dependencies)

| Phụ thuộc | Vai trò | Rủi ro |
|---|---|---|
| Telegram Bot API | Kênh chính (group-first + DM) | Rate-limit; 1 token shared = blast-radius lớn |
| Zalo Bot Platform | Kênh Zalo (bot per-club) | GROUP Beta; cap 3 bot free/tài khoản |
| Meta Messenger Platform | Kênh Messenger (post-MVP) | Cửa sổ 24h; App Review (xem messenger doc) |
| SePay / ApiPay | Webhook đối soát CK | Payload; độ trễ; thiếu trường |
| Postgres managed | Lưu trữ + RLS + read model public | Region VN; giá; backup |
| LLM/STT provider | OCR + voice | Chi phí; chính xác |
| (Tùy chọn) Geo/maps | Khu vực/khoảng cách cho discovery | Chi phí; privacy vị trí |

## 13. Rủi ro & Giảm thiểu (Risks)

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Rò rỉ dữ liệu cross-tenant (tiền) | Nghiêm trọng | Repo scoped + RLS fail-closed + test bất biến + audit |
| **Lộ tiền/PII ra public marketplace** | **Nghiêm trọng** | Public projection field-whitelist; tiền/PII không vào read model; test bất biến public; rate-limit chống scrape |
| Gán nhầm nợ / chiếm định danh | Cao | Claim-có-tiền cần khoá mạnh; merge chỉ verified (AUDIT C2/C5) |
| Sync sai/lệch trạng thái giữa kênh ↔ web | Cao | Canonical store + event re-projection; idempotent command/event; metrics sync-lag |
| Webhook route nhầm CLB / mất/đếm trùng CK | Cao | Token-in-URL + verify TK + lưu trước ack + idempotent |
| Marketplace ít kèo / ít player (cold-start) | Cao | Beachhead bằng community host hiện có; seed tenant #1; khuyến khích publish |
| Lạm dụng marketplace (spam join, scrape) | Trung bình | Rate-limit, abuse controls, approval mode, area-level geo |
| Rate-limit cron/đa kênh 1k CLB | Trung bình | Throttler + rải giờ + hàng đợi |
| Chi phí LLM/STT vượt margin | Trung bình | Trần fair-use + provider rẻ + degrade nhẹ |

---

## 14. Lộ trình (Roadmap)

> Chi tiết kỹ thuật từng pha: `../appendices/saas-implementation-plan.md` §8 + `TDD.md` + `../appendices/player-side-saas-reconciliation.md` §7. Toàn bộ core docs dùng duy nhất canonical P-number; ROADMAP dùng cùng hệ này.

| Pha | Cột mốc nghiệp vụ |
|---|---|
| **P0–P1** | Nền multi-tenant + Postgres/RLS + **schema đa môn** + **3 tầng hiển thị** (cô lập) |
| **P2** | Bot Telegram biết tenant; lệnh host + nhắc nợ đa-tenant |
| **P3** | Webhook đối soát CK biết tenant (module tiền) |
| **P3.5** | Identity directory (Person/ChannelIdentity/Membership) + merge an toàn |
| **P4** | **Web app + canonical backend + Sync engine** (TG/Zalo ⇄ web) + onboarding self-serve |
| **P4.3** | **Marketplace discovery** (publish kèo + tìm kèo + join cross-club) |
| **P4.5–4.7** | Player-side Telegram → Player view → Player-side Zalo |
| **P4.8** | (Post-MVP) Kênh Messenger — join + xác nhận |
| **P5** | Billing + vòng đời tenant |
| **P6** | Hardening, load test, observability sync-lag, pen-test public layer, ToS/Privacy |

> Có thể **soft-launch miễn phí sau P4.3** để validate marketplace trước khi bật billing.

---

## 15. Tiêu chí nghiệm thu (Acceptance Criteria)
- **AC-1** Host lạ tự đi hết onboarding tới khi tạo & publish kèo đầu, không cần platform can thiệp.
- **AC-2** Hai CLB cùng hệ thống: tiền/nhắc/CK/roster **không lẫn nhau**; test cô lập xanh.
- **AC-3** **Public marketplace** hiển thị kèo của nhiều CLB/môn; field public không lộ tiền/PII (test bất biến public xanh).
- **AC-4** Player **chưa thuộc CLB** tìm thấy kèo qua bộ lọc và **join được** (open) / gửi request (approval).
- **AC-5** **Sync 2 chiều:** host tạo kèo trên web → hiện trong group TG & marketplace; player tap join trên Zalo → web + roster cập nhật; mọi nơi nhất quán ≤ vài giây.
- **AC-6** CK tới đúng CLB; player join → CK → **xác nhận tự động**; chưa trả → **được nhắc**.
- **AC-7** Một người qua TG + Zalo cùng CLB gộp về **1 nợ**.
- **AC-8** Hết trial bị **chặn lệnh quản trị** nhưng CK player **vẫn lưu**; kèo public hiện có chỉ sống tới lúc đóng/hết giờ; CK đúng mã **tự kích hoạt lại**.
- **AC-9** Không có đường rò rỉ cross-tenant **và** không có đường lộ tiền/PII ra public (pen-test).

## 16. Quyết định mở (Open Decisions Log)

| ID | Quyết định | Trạng thái |
|---|---|---|
| OD-1 | SĐT verified (share-contact) làm khoá merge chính | ✅ chốt |
| OD-2 | `pay_code` hiển thị có prefix CLB, lưu code trần | Đề xuất ✅, chờ chốt cuối |
| OD-3 | Giá/tier subscription host sau reposition (1 gói vs nhiều tier) | Chờ chốt |
| OD-4 | Hosting Postgres (Neon/Supabase/Railway) | Chờ chọn |
| OD-5 | **Join cross-club mặc định:** open hay approval? (đề xuất: cấu hình per-kèo, mặc định open + host bật approval) | Chờ chốt |
| OD-6 | **Độ chi tiết vị trí public:** khu vực/quận vs venue chính xác (đề xuất: khu vực cho tới khi join/duyệt) | Chờ chốt |
| OD-7 | **Realtime web:** SSE vs WebSocket vs polling | Chờ chọn (đề xuất SSE) |
| OD-8 | Danh sách môn khởi điểm (cầu lông, pickleball, …) + taxonomy trình độ | Chờ chốt |
| OD-9 | Messenger vào lộ trình lúc nào | ✅ Post-MVP P4.8 |
| OD-10 | Web stack: Next.js hay Express SSR | Chờ chọn; không ảnh hưởng canonical store |

## 17. Thuật ngữ (Glossary)

| Thuật ngữ | Nghĩa |
|---|---|
| **Plexco** | Platform quản lý + khám phá hoạt động thể thao đa môn, 2 phía (host/player) |
| **Tenant / Club** | Một CLB = một đơn vị dữ liệu tiền/roster cô lập |
| **Host / Organizer** | Chủ CLB (tenant admin) |
| **Player** | Người chơi (member của CLB hoặc người tìm kèo qua discovery) |
| **Kèo / Session** | Một buổi chơi (môn/ngày/giờ/khu vực/giá/slot) |
| **Sport** | Môn thể thao (cầu lông, pickleball…) — chiều dữ liệu của kèo |
| **Discovery / Marketplace** | Lớp công khai cho player tìm & join kèo xuyên CLB |
| **Public projection** | Bản chiếu công khai field-whitelist của kèo (không tiền/PII) |
| **Canonical store** | PostgreSQL + domain model — nguồn sự thật duy nhất |
| **Sync engine** | Command/outbox/event + projection từ canonical store ra các surface |
| **Surface** | Một bề mặt tương tác (Telegram/Zalo/Messenger/web) trên cùng store |
| **CK** | Chuyển khoản ngân hàng |
| **Person / ChannelIdentity / Membership** | Người thật toàn cục / tài khoản 1 kênh / quan hệ người ⇄ club |
| **RLS** | Row-Level Security (cô lập tiền/roster ở tầng DB) |
| **3 tầng hiển thị** | public discovery · tenant-private (RLS) · person-self |

---

*BRD tập trung yêu cầu nghiệp vụ. Thiết kế kỹ thuật chi tiết — xem `../appendices/saas-implementation-plan.md`, `TDD.md`, `../appendices/player-side-saas-reconciliation.md`, `../appendices/player-side-saas-AUDIT.md`, `../appendices/messenger-channel-design.md`.*

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 16/06/2026 | v3.0 | Initial BRD — MVP scope, canonical store, identity model |
| 18/06/2026 | v3.1 | Chuẩn hoá durable webhook, payment ledger/allocation, discovery |
| 19/06/2026 | v3.1 | Thêm Changelog table, cập nhật cross-refs |

