# Business Requirements Document (BRD) — Plexco
## Platform quản lý & khám phá hoạt động thể thao đa môn (host + player), tích hợp Zalo · Facebook Messenger + Web app *(Telegram đã loại khỏi phạm vi)*

---

## 0. Document Control

| | |
|---|---|
| **Sản phẩm** | **Plexco** — platform quản lý hoạt động thể thao cho **host** và khám phá/tham gia kèo cho **player**, đa môn (cầu lông, pickleball, tennis, bóng đá…), hoạt động ngay trong Zalo/Facebook Messenger + web app đồng bộ |
| **Phiên bản** | v3.9d — **Founder batch (18/07):** DD-69 **định hướng app-first accepted** (phase-1 target web PWA → phase-2 native; native build TBD, technical gates mở); DD-33 Facebook Login phase-1 ✅; DD-61..64 Session Organize accept-in-principle (post-P4). Phase-1 committed scope không đổi. (v3.9c: DD-69 proposal review closure.) |
| **Ngày** | 18/07/2026 |
| **Người soạn** | Ngoc-Anh |
| **Người duyệt (approvers)** | Ngoc-Anh (solo founder, self-approved) |
| **Trạng thái** | Draft để review |
| **Tài liệu liên quan** | `../strategy/saas-implementation-plan.md` (kiến trúc) · `PRD.md` v2.8b · `TDD.md` v3.1 · `../standards/decisions.md` **v1.47** (canonical; DD-69 direction ✅ + DD-61..64 accept-in-principle post-P4 + DD-33/60 ✅; DD-57..59 defer; DD-65..68 ✅) · `../dd-69-app-native-analysis.md` · `../research/player-side-saas-AUDIT.md` · `../channels/messenger/messenger-channel-design.md` |

> BRD là nguồn sự thật cho **product scope & business rules**; PRD cho hành vi/user flow; TDD cho implementation contract; ROADMAP cho thứ tự và tiến độ. Security constraints đã chốt trong AUDIT là bắt buộc. Khi có conflict cùng một chủ đề: **BRD → PRD → TDD → ROADMAP**; riêng security: quy tắc nghiêm ngặt hơn giữa BRD và AUDIT thắng.
>
> ⚠️ **v3.4 là pivot scope lớn.** Các doc downstream đã sync: `PRD.md` (bỏ Telegram flow, thêm chat/settings/gender-pricing), `TDD.md` (bỏ Telegram adapter, thêm Messenger projector vào MVP, chat model, gender price model), `../standards/decisions.md` (đã ghi: **DD-37** channel pivot ✅, **DD-38** chat ✅ và **DD-39** giá theo giới tính ✅ trong scope phase-1 nhưng schema/code còn pending, **DD-40** mark-paid thủ công ✅; cập nhật **DD-13** Google auth ✅, **DD-33** Facebook link phase-1, **DD-09** thay bằng DD-37). Xem §16.

---

## 1. Tóm tắt (Executive Summary)

**Plexco** là platform **2 phía** cho hoạt động thể thao phong trào đa môn:

- **Phía Host (chủ CLB/người tổ chức):** tạo & quản lý buổi chơi ("kèo"), roster, **thu & tự đối soát tiền sân** — ngay trong Zalo/Facebook Messenger và trên web app.
- **Phía Player:** **khám phá kèo** đang mở của nhiều môn / nhiều CLB (lọc theo môn, khu vực, giờ, trình độ, giá), **join**, theo dõi kèo & nợ của mình — xuyên CLB.

**Định vị cốt lõi:** Plexco gặp người dùng **ở nơi họ đã ở** (Zalo/Messenger — 0 cài app cho player) và cung cấp web app làm hub tương tác. **PostgreSQL + domain model là canonical store**; web và các kênh chat là surface. Một hành động ở bất kỳ surface nào tự động được ghi vào canonical store rồi project sang các surface liên quan.

**Kênh phase-1:** **Web app + Facebook Messenger + Zalo**. **Telegram đã bị loại khỏi phạm vi** (v3.4). Data từ 3 nguồn — web app, Messenger, Zalo — sync 2 chiều qua canonical store.

**GTM:** MVP tích hợp Zalo/Messenger—các platform đã có sẵn user—thay vì bắt cài app mới. Web app gom và đồng bộ session từ các kênh. **1 host mới ⇒ kéo nguyên community player vào** → chi phí acquisition ≈ 0.

Đã có bot single-club chạy thật (cầu lông) — logic tiền (matching, gạch nợ) đã kiểm chứng, được lift sang `packages/core`. Plexco hoá phần này thành platform đa tenant, đa môn, có **discovery marketplace** + **sync engine** + **web app** + **chat cơ bản trong app**.

---

## 2. Bài toán & Giải pháp (Problem & Solution)

### 2.1 Nỗi đau (Pain-points)

**Host:**
- Đối chiếu chuyển khoản (CK) ngân hàng thủ công với danh sách người chơi — nội dung lệch tên, trùng số tiền, trả hộ.
- Nhắc nợ thủ công, ngại nhắc, hay quên ai chưa trả.
- Dữ liệu rải rác nhiều nhóm chat (Zalo lẫn Messenger), không có cái nhìn tổng (lịch, doanh thu, ai hay đi).
- Giá nam/nữ khác nhau nhưng phải tính tay từng người.

**Player:**
- **Không biết hôm nay/cuối tuần có kèo nào mở** quanh mình, môn mình thích, còn slot không.
- Phải hỏi han trong từng nhóm; muốn chơi môn mới / CLB mới thì không có đường vào.
- Không rõ mình còn nợ buổi nào, đã CK rồi mà chưa được xác nhận.

### 2.2 Giải pháp
Một platform **2 phía** + **đa kênh** + **đa môn**:
- **Host** tự động hoá vòng tạo kèo → roster → **đối soát/đánh dấu tiền** → **nhắc** → **xác nhận**; quản lý club trên web; dữ liệu mỗi CLB **cô lập tuyệt đối** (tiền/roster nội bộ).
- **Player** mở **marketplace khám phá kèo** xuyên CLB/môn, join (kể cả CLB chưa từng tham gia), theo dõi kèo & nợ của mình.
- **Sync engine** giữ mọi kênh + web nhất quán: hành động ở 1 nơi hiện ngay ở mọi nơi (Zalo/Messenger ⇄ web).
- **Chat cơ bản trong app** (toàn CLB + riêng 1-1) cho tương tác không lệ thuộc nhóm chat bên ngoài.

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
| **Bên thứ ba** | SePay/ApiPay, Zalo Bot Platform, Meta Messenger, Google Identity (OAuth), Postgres host, LLM/STT | Xem §12 Dependencies |

**Phân quyền cốt lõi (3 tầng hiển thị dữ liệu — xem §7 / TDD §3.2):**
- **Public discovery:** thông tin kèo công khai (môn, giờ, khu vực, giá, slot trống, tên host/CLB) — **ai cũng đọc**, KHÔNG tiền/PII/roster đầy đủ.
- **Tenant-private:** tiền/nợ/roster/đối soát/subscription/chat CLB — **chỉ trong tenant** (RLS fail-closed, 0 rò rỉ).
- **Person-self:** "club & nợ của chính tôi" xuyên CLB + chat riêng 1-1 — chỉ chủ nhân (đường query person-authorized).

---

## 4. Mục tiêu & Chỉ số thành công

### 4.1 Mục tiêu (Objectives)

| ID | Mục tiêu |
|---|---|
| OBJ-1 | **Platform 2 phía đa môn**: host quản lý, player khám phá & join, xuyên CLB. |
| OBJ-2 | **Đa kênh + web app sync 2 chiều**: 1 hành động ở 1 kênh (web/Zalo/Messenger) → nhất quán mọi nơi. |
| OBJ-3 | **Marketplace khám phá kèo** cross-club hoạt động, có người lạ join được. |
| OBJ-4 | **Tự động hoá vòng tiền** (đánh dấu thủ công → đối soát/nhắc/xác nhận) — thế mạnh kế thừa, làm module. |
| OBJ-5 | **Cô lập dữ liệu tiền/nội bộ tuyệt đối** song song **public layer an toàn** (0 rò rỉ tiền/PII ra marketplace). |
| OBJ-6 | Monetization bền vững (host trả thuê bao); margin dương. |

### 4.2 KPI

| KPI | Định hướng |
|---|---|
| Số host hoạt động (active tenants) | Tăng đều |
| Số player hoạt động + **% player join qua discovery** (CLB chưa từng tham gia) | Tăng — chỉ số marketplace |
| Số kèo publish lên marketplace / tuần | Tăng |
| **% CK tự match không cần gán tay** | Càng cao càng tốt (chỉ số lõi module tiền, tier `host_pro`) |
| Độ trễ sync (action → hiện ở kênh khác + web) | p95 ≤ 3 giây, p99 ≤ 10 giây |
| MRR & churn | MRR tăng, churn thấp |
| Sự cố rò rỉ cross-tenant **hoặc lộ tiền/PII ra public** | **= 0 (bắt buộc)** |

---

## 5. Phạm vi (Scope)

### 5.1 Trong phạm vi (MVP — đa môn + web sync + discovery + chat)
**Đa môn** · Google/email · onboarding host self-serve (SePay/ApiPay, Zalo, **Messenger central có sẵn + optional link Page riêng**) · host quản lý kèo trên chat/web · giá theo giới tính · marketplace/cross-club join · mark-paid + auto reconcile · nhắc/xác nhận · global Person/link account · player view · chat in-app · profile · canonical PostgreSQL/domain services + sync · billing · multi-tenant isolation. Messenger central/tenant Page đều phục vụ host+player; Page riêng không phải prerequisite.

### 5.2 Ngoài phạm vi
Thanh toán in-app/ví/thẻ (platform **không cầm tiền player**) · đặt sân/quản lý lịch sân (booking nhà thi đấu) · **app mobile native trong phase-1** (phase-1 target = web app PWA installable/offline; S9/S20 còn là delivery plan, không phải runtime evidence; native là đích **phase-2** — DD-69/OD-20 direction ✅ accepted, native build TBD) · BI nâng cao · **Telegram và các nền tảng chat ngoài Zalo/Messenger** · **bridge/đồng bộ chat in-app ra group Zalo/Messenger** (chat in-app chỉ sống trong Plexco ở phase-1) · matchmaking xếp cặp theo trình độ tự động (discovery là *tìm kèo*, không phải xếp đối thủ) — để ngỏ tương lai.

---

## 6. Yêu cầu nghiệp vụ (Business Requirements)

| ID | Yêu cầu |
|---|---|
| **BR-1** | Nhiều host/CLB dùng chung nhưng **dữ liệu tiền/roster/chat cô lập tuyệt đối**. |
| **BR-2** | Hỗ trợ **nhiều môn thể thao**; mỗi kèo gắn 1 môn; discovery lọc theo môn. |
| **BR-3** | Host tự onboarding SePay + Zalo; Messenger central dùng ngay, Page riêng là optional self-serve integration, không cần platform can thiệp. |
| **BR-4** | Host **publish kèo công khai** (chọn từng kèo) → lên **marketplace**; thông tin public KHÔNG gồm tiền/PII/roster đầy đủ. |
| **BR-5** | Player **khám phá kèo** xuyên CLB/môn theo bộ lọc; **join** kèo (kể cả CLB chưa tham gia), open hoặc cần host duyệt theo cấu hình. |
| **BR-6** | **PostgreSQL + domain model là nguồn sự thật (canonical)**; web và các kênh là surface. Một hành động ở một surface → ghi canonical → project sang web + kênh liên quan. |
| **BR-7** | **Đánh dấu đã trả**: host **mark thủ công (tiền mặt hoặc CK)** bằng tap/multi-select; hệ **tự nhận diện CK** (tier `host_pro`) kể cả nội dung lệch tên; không khớp → vào chưa khớp cho host gán tay; **không tự đoán sai số tiền**. |
| **BR-8** | **Tự nhắc** chưa trả (ngưỡng cấu hình, mặc định 2h → 24h → …) & **tự xác nhận** đã trả, qua đúng kênh khả dụng (**web + Zalo** chính; **Messenger best-effort trong cửa sổ 24h**). |
| **BR-9** | Một người qua nhiều kênh được **gộp đúng 1 người**; trong cùng CLB không tách đôi nợ. |
| **BR-10** | Người chơi xem được **CLB, kèo & nợ của chính mình** xuyên CLB, không thấy của người khác. |
| **BR-11** | Host trả **thuê bao**; quá hạn **tạm ngừng lệnh quản trị** nhưng **vẫn lưu CK player** & vẫn hiển thị kèo đã publish. |
| **BR-12** | Thao tác chạm tiền/định danh phải **an toàn, có quyền, có audit**; **tiền/PII không bao giờ lọt ra public layer**. |
| **BR-13** | CLB tự mang tài khoản nhận tiền + Zalo bot; Facebook Page riêng là optional. Plexco sở hữu central Page/App nhưng không trung gian dòng tiền. |
| **BR-14** | Đăng ký/đăng nhập bằng **Google**, **email/password**, hoặc **Facebook khi external enablement gate active**; Facebook Login subject không auto-link Messenger PSID. Zalo Login vẫn gated riêng. |
| **BR-15** | **Chat cơ bản trong app**: chat **toàn CLB** (member trong tenant) và chat **riêng 1-1** (person ↔ person); chỉ sống trong Plexco, **không bridge** ra group Zalo/Messenger ở phase-1; tôn trọng cô lập tenant + person-self. |
| **BR-16** | Người dùng **cài đặt hồ sơ**: giới tính, ngày sinh, tên, username, ngôn ngữ. **Host có thể đặt giá theo giới tính** (giá nam/nữ khác nhau) cho kèo; hệ suy giá đúng cho từng member theo giới tính đã set. |
| **BR-17** | Player join qua Zalo hoặc Messenger central/club Page; protected target resolver bảo đảm đúng session/tenant và sync web. |
| **BR-18** | Host tạo/quản lý session cơ bản trên **cả central Plexco Page và optional club Page**; role-aware context + capability check; cùng domain service với web/Zalo. |

---

## 7. Yêu cầu chức năng (Functional Requirements — theo Module)

### MODULE 0 — Nền tảng đa tenant & 3 tầng hiển thị
- **FR-0.1** Mọi dữ liệu tiền/roster/chat scoped `tenant_id` + RLS fail-closed (tenant-private).
- **FR-0.2** **Public projection** kèo đã publish (cross-tenant, read-only, field whitelist) phục vụ marketplace — đường riêng, KHÔNG qua RLS per-tenant, KHÔNG tiền/PII.
- **FR-0.3** **Person-self**: query xuyên CLB scoped theo person đã xác thực.

### MODULE 1 — Onboarding & Tenant (host)
- **FR-1.1** Đăng ký/đăng nhập host qua web bằng **Google Login**, **email + mật khẩu**, hoặc **Facebook Login** khi DD-33 external evidence active; chưa pass thì capability OFF + transactional one-time `link_code` fallback.
- **FR-1.2** Wizard nối SePay/ApiPay (token + secret webhook).
- **FR-1.3** Link Zalo. Messenger central Page thuộc platform và luôn sẵn; FB Login + chọn Page riêng là optional tenant onboarding. App Review của platform vẫn bắt buộc.
- **FR-1.4** Cấu hình CLB: **môn mặc định**, ngôn ngữ, **giá mặc định + tùy chọn giá theo giới tính (nam/nữ)**, roster on/off, auto-announce, **chính sách publish & join** (open/approval).

### MODULE 2 — Quản lý kèo (Host) — chat **và** web
- **FR-2.1** Tạo kèo (web / bot / định kỳ); set **môn**, ngày/giờ, **khu vực/venue**, **giá** (một mức, hoặc **giá nam / giá nữ** riêng), **slot tối đa**, **trình độ**, **visibility (private/public)**, **join policy**.
- **FR-2.2** Đăng kèo + đường tham gia vào group (auto/thủ công); cập nhật roster trực tiếp; **mọi thay đổi sync sang web + marketplace + kênh (Zalo/Messenger)**.
- **FR-2.3** Đóng kèo; xem danh sách & trạng thái trả; dashboard club (lịch, doanh thu, ai hay đi) trên web.
- **FR-2.4** Messenger `/newsession` trên central/tenant Page dùng role-aware picker + durable wizard + preview/confirm; final command re-authorize và idempotent qua shared SessionService.

### MODULE 3 — Discovery & Join (Player) — **marketplace**
- **FR-3.1** **Tìm kèo** trên web/bot: lọc **môn, khu vực, ngày/giờ, trình độ, giá, còn slot**; xếp theo gần/sắp diễn ra.
- **FR-3.2** Xem chi tiết kèo công khai (KHÔNG roster đầy đủ/tiền người khác); **join** → nếu CLB chưa tham gia thì tạo membership (guest) + (nếu cấu hình) **gửi request host duyệt**.
- **FR-3.3** Join member: Zalo number-reply; Messenger central/global hoặc tenant/local-default quick-reply; web 1-click. Messenger choices dùng opaque server action, bounded pagination.
- **FR-3.4** Zalo/web trusted context và Messenger endpoint+protected action/picker resolve đúng target; không lấy tenant/resource từ message/client body.

### MODULE 4 — Sync Engine (web ⇄ kênh)
- **FR-4.1** PostgreSQL + domain model = **canonical store**; mỗi action (mọi surface) → command → áp vào store → phát **domain event**.
- **FR-4.2** Event project ra Zalo, web, public và **đúng một Messenger endpoint** (tenant Page reachable → central Page reachable). Idempotent; ngoài policy window fallback, không rollback canonical.
- **FR-4.3** Surface state lệch → **re-project** từ event (sửa lại message/UI). Web realtime (SSE + `LISTEN/NOTIFY`) theo tenant/person.

### MODULE 5 — Đánh dấu tiền, đối soát & gạch nợ (module tiền — killer kế thừa)
- **FR-5.1** **Mark-paid thủ công (mọi tier):** host chọn 1 hoặc **nhiều player (multi-select) / tap** để đánh dấu **đã trả bằng tiền mặt** hoặc **đã trả bằng CK**; INSERT **`payment_allocations`** (tiền mặt → `source='cash'`; CK đã ingest → `source='manual'` + exact `bank_transaction_id`) + cập nhật `charges.amount_allocated`/`status`, có audit, idempotent. CK host-attested chưa ingest chỉ được ghi qua dedicated allocation source sau migration (`bank_transaction_id=NULL`, actor + opaque evidence); trước migration reject fail-closed. Cấm synthetic `bank_transaction` và cấm map sang `cash|manual|bank_transfer`. (DD-40 v1.39)
- **FR-5.2** **Đối soát CK tự động (`host_pro`):** nhận CK webhook, **route đúng CLB** theo tài khoản nhận; trong cùng transaction lưu `bank_transaction` + enqueue reconcile job/outbox, commit rồi mới ack.
- **FR-5.3** Mỗi lượt chơi tạo một `charge/debt` (giá suy theo **giới tính member** nếu kèo đặt giá nam/nữ); CK gốc được giữ bất biến và phân bổ qua `payment_allocations`, hỗ trợ một CK trả nhiều khoản/người, trả thiếu/dư và hoàn tác có audit.
- **FR-5.4** Khớp CK ↔ khoản nợ theo **tên + số tiền + ngày** (mặc định); ưu tiên `pay_code` nếu có; FIFO khi đồng giá cùng ngày; tổng allocation **không vượt số tiền CK** và không mark quá số tiền phủ.
- **FR-5.5** CK không khớp hoặc còn dư → `/unmatched` gán tay; retry và thao tác gán đều **idempotent**.

### MODULE 6 — Nhắc & Xác nhận
- **FR-6.1** Cron nhắc qua web+Zalo chính; Messenger best-effort theo Page-endpoint reachability, one-route delivery; ngoài cửa sổ/không eligible fallback, chống spam.
- **FR-6.2** Sau **mọi** điểm markPaid (thủ công tiền mặt/CK & auto CK) → **xác nhận tới player** (best-effort, không chặn dòng tiền) + sync web.

### MODULE 7 — Định danh & Gộp người chơi
- **FR-7.1** Person toàn cục; Messenger identity là Page-scoped bằng hai HMAC domain-separated cho Page id và PSID, unique theo ba phần với platform; không auto-merge xuyên Page; quan hệ CLB = Membership.
- **FR-7.2** **Link tài khoản**: person đăng nhập Google có thể **link Facebook + Zalo** vào cùng Person. Claim membership đã có tiền cần strong proof = **verified account email hoặc transactional one-time `link_code`**; owner assertion/CK/name chỉ là evidence hỗ trợ, không được bypass DD-50.
- **FR-7.3** Merge xuyên kênh: verified account identity hoặc `link_code` purpose-bound/TTL/single-use → conflict checks → explicit confirmation + audit. STK/tên chỉ gợi ý review, không auto-merge. *(DD-50: phase-1 không thu SĐT — phone dormant làm merge signal tương lai.)*

### MODULE 8 — Player View (person-self)
- **FR-8.1** Web + bot: liệt kê **CLB, kèo sắp tới, nợ/trạng thái** của chính person; **chỉ dữ liệu của họ**.

### MODULE 9 — Billing (host)
- **FR-9.1** Subscription host (plan trả phí `host_pro`): trial → active → past_due → suspended. **`free` (0đ) vào thẳng `active` vô thời hạn — không trial/invoice, không past_due/suspended vì non-payment** (chỉ suspend vì ToS/abuse). Ref: DD-29 (thay DD-03), BL-BIL-1. **DD-51 (✅ 2026-07-16):** trial **14 ngày** (remind khi còn 2 ngày; hết trial → khoá ngay về `free`); trễ invoice → grace **7 ngày** rồi suspended; huỷ giữa kỳ hoàn toàn bộ nếu request trong **7 ngày kể từ khi thanh toán**, sau đó dùng nốt kỳ; override = PlatformAdmin (7d/ticket/audit).
- **FR-9.2** Thu qua CK vào tài khoản platform, khớp `invoiceCode`; idempotent.
- **FR-9.3** Suspended: chặn lệnh quản trị nhưng vẫn nhận & lưu CK player; kèo đã public chỉ tiếp tục hiển thị tới lúc đóng/hết giờ, không được tạo mới hoặc gia hạn.

### MODULE 10 — Chat trong app (in-app, chỉ Plexco) — *mới v3.4*
- **FR-10.1** **Chat toàn CLB:** kênh chat chung cho member trong 1 tenant; scoped `tenant_id` + RLS; realtime qua SSE.
- **FR-10.2** **Chat riêng 1-1:** person ↔ person; chỉ 2 người trong hội thoại đọc được (person-self path).
- **FR-10.3** Chat **chỉ sống trong Plexco**, **không bridge** ra group Zalo/Messenger ở phase-1; lưu canonical, project realtime. Media là full private lifecycle (signed access, MIME/type/size/quota, malware scan, moderation, deletion). Open DM chỉ bật sau block/report/per-sender+per-target throttles/abuse audit; host/support không đọc DM (DD-55).

### MODULE 11 — Tài khoản & Cài đặt (person profile) — *mới v3.4*
- **FR-11.1** Người dùng cài đặt hồ sơ: **giới tính** (dùng cho giá nam/nữ), **ngày sinh**, **tên hiển thị**, **username** (duy nhất), **ngôn ngữ** (vi/en).
- **FR-11.2** Giới tính/ngày sinh là **PII có consent**, mã hoá at-rest, **không lộ ra public marketplace**; chỉ host của CLB mà member tham gia thấy giới tính ở mức cần cho suy giá.
- **FR-11.3** Username duy nhất toàn hệ; đổi username có kiểm tra trùng; thay đổi hồ sơ sync mọi surface.

---

## 8. Yêu cầu phi chức năng (Non-Functional Requirements)

### 8.1 Bảo mật & Cô lập (ưu tiên cao nhất)
- **NFR-S1** Cô lập tenant-private 2 lớp: app scoped `tenant_id` + DB RLS fail-closed. **0 rò rỉ cross-tenant.** (Bao gồm chat toàn CLB.)
- **NFR-S2** **Public layer tách bạch:** chỉ field whitelist (môn/giờ/khu vực/giá/slot/host-name); **không bao giờ** tiền/PII/roster đầy đủ/STK/giới tính; chống enumeration & scraping (rate-limit, phân trang).
- **NFR-S3** Định tuyến tenant **luôn suy từ kênh**, không từ nội dung (chống spoof).
- **NFR-S4** Webhook xác thực per-tenant, timing-safe; lưu payload trước khi xử.
- **NFR-S5** Secret (Zalo Bot Token, Facebook Page access token, SePay HMAC secret, Google OAuth client secret) mã hoá at-rest (KMS); không log; có reset. Meta App Secret là deployment-level secret cấp App, không lặp theo Page registry.
- **NFR-S6** Thao tác chạm tiền/định danh qua **path có kiểm soát + audit**.
- **NFR-S7** Phân quyền theo định danh người, tách khỏi routing theo kênh.

### 8.2 Riêng tư & Tuân thủ
- **NFR-P1** PII (email/vị trí chính xác/**giới tính**/**ngày sinh**) thu có **consent**, mã hoá at-rest, retention & quyền xoá; **không lộ ra public** (marketplace chỉ hiện **khu vực**, không địa chỉ/PII/giới tính cho tới khi join/được duyệt). **DD-50:** phase-1 không thu SĐT. **DD-54:** PII optional (giới tính/ngày sinh) chỉ thu khi platform config bật (CMS admin, default OFF).
- **NFR-P2** ToS & Privacy Policy cho dữ liệu tài chính + dữ liệu vị trí + hồ sơ cá nhân.
- **NFR-P3** Tuân thủ ràng buộc nền tảng (Zalo/Meta/Google) & pháp luật VN.

### 8.3 Hiệu năng & Quy mô
- **NFR-PF1** Chịu **>1.000 tenant** + nhiều player discovery đồng thời (Postgres ghi song song + read model public).
- **NFR-PF2** Tôn trọng rate-limit Zalo/Messenger (throttler + rải giờ cron + bucket per channel).
- **NFR-PF3** Tương tác bot/web phản hồi "tức thì"; **sync action → surface khác ≤ vài giây**; chat realtime độ trễ thấp.

### 8.4 Độ tin cậy & Toàn vẹn
- **NFR-R1** Không **mất CK** (transaction lưu raw + enqueue reconcile trước ack; synthetic id khi thiếu; worker retry tới khi terminal).
- **NFR-R2** Không **double-count** (idempotent external_id) & **sync/chat idempotent** (command/event id).
- **NFR-R3** Không **auto-mark quá số tiền phủ**.
- **NFR-R4** **Single source of truth = PostgreSQL/domain model**; surface luôn reconcile được từ event (không multi-master conflict).
- **NFR-R5** Backup PITR; diễn tập restore.

### 8.5 Khả dụng & Vận hành
- **NFR-O1** Mỗi pha deploy độc lập, không phá bot CLB hiện tại.
- **NFR-O2** Observability: log gắn `tenant_id`, metrics sync-lag, error tracking; không lộ secret.

### 8.6 Bản địa hoá
- **NFR-L1** Tiếng Việt mặc định + tiếng Anh, cấu hình theo CLB và theo hồ sơ người dùng.

---

## 9. Mô hình doanh thu (Monetization)

### 9.1 Dòng cốt lõi — Subscription host
- Host trả **thuê bao** theo tier cho bộ tool quản lý + đối soát + đa kênh + chỗ trên marketplace. Pricing host đã chốt ở **DD-29**:

| Plan | Giá / tháng / CLB | Bao gồm |
|---|---:|---|
| `free` | **0đ** | Web + Zalo + Messenger central/optional club Page + quản kèo/roster + giá theo giới tính + mark-paid thủ công + nhắc thủ công + chat in-app |
| `host_pro` | **250.000đ** | Toàn bộ free + **đối soát CK tự động & báo thu** + **nhắc nợ tự động** + **Trợ lý AI + KB** + CRM dashboard |

> Tính năng free/pro do **capability flags** quyết định (config-driven; registry ở `feature_billing_lifecycle_tech.md §4b`). Ref: **DD-29** (thay DD-03).
- Thu qua **CK vào tài khoản platform**, khớp `invoiceCode`; tách `subscription_invoices` khỏi player payment ledger (`bank_transactions`/`payment_allocations`).

### 9.2 Cấu trúc chi phí & nguyên tắc tiền
- **Tenant tự mang & tự trả** phí provider thu CK (SePay/ApiPay) — platform **không trung gian dòng tiền player**.
- **Zalo Bot**: free 3 bot/tài khoản → BYO bot dưới tài khoản host ⇒ free-at-scale (1 bot/club).
- **Messenger:** FB App + central Page của Plexco; Page per-club optional. Cần App Review; token/reachability tách theo endpoint.
- **LLM/STT** (OCR ảnh, voice) do **platform trả**, có **trần fair-use**.

### 9.3 Dòng tương lai (ngoài MVP)
Player-side premium (lọc/nhắc kèo nâng cao), promote kèo trên marketplace, managed Messenger/Zalo bot trả phí, add-on ngoài tier host hiện tại. **Không** làm loãng MVP.

---

## 10. Giả định (Assumptions)
- **AS-1** Người chơi đã dùng Zalo/Facebook Messenger; CLB sinh hoạt qua nhóm chat.
- **AS-2** Player CK ngân hàng là chính; tên/nội dung CK gần tên trong CLB.
- **AS-3** Host tự nối SePay/Zalo; nếu có Facebook Page thì có thể nối optional, nếu không dùng central Page.
- **AS-4** Logic matching/đường tiền bot single-club hiện tại **đúng** & tái dùng được.
- **AS-5** Player **muốn** khám phá kèo mới nếu được hiển thị thuận tiện (giả định marketplace — cần validate sớm).
- **AS-6** Đa số kèo host sẵn lòng publish công khai (ít nhất phần thông tin cơ bản) để hút người.
- **AS-7** Người dùng chấp nhận đăng nhập Google và link tài khoản Facebook/Zalo để nhận diện xuyên kênh.

## 11. Ràng buộc (Constraints)
- **CO-1** Zalo = bot-token per-club; Messenger = một platform App, central Page luôn có + optional tenant Page (DD-65).
- **CO-2** Zalo Bot không inline button, GROUP còn Beta → player-flow Zalo bám **DM number-reply**.
- **CO-3** Messenger ràng buộc bởi **cửa sổ standard 24h**; gửi ngoài cửa sổ chỉ qua cơ chế Meta cho phép khi đúng eligibility/approval → kênh MVP là "join + xác nhận", **nhắc best-effort trong 24h**, fallback web + Zalo; cần **App Review** trước GA.
- **CO-4** **PostgreSQL/domain model là canonical store**; web và kênh chat là surface — command ghi vào store + projection ra surface, **không multi-master**.
- **CO-5** **Public marketplace KHÔNG bao giờ chứa tiền/PII/giới tính**; chỉ projection field whitelist.
- **CO-6** Plexco xây **repo riêng**, không refactor tại chỗ bot live.
- **CO-7** **Chat in-app không bridge** ra Zalo/Messenger ở phase-1 (chỉ trong Plexco).
- **CO-8** Messenger Page/source tenant không grant target authority; identity/reachability Page-scoped, action opaque/replay-safe và delivery chỉ một route (DD-66..68).

## 12. Phụ thuộc bên ngoài (Dependencies)

| Phụ thuộc | Vai trò | Rủi ro |
|---|---|---|
| Zalo Bot Platform | Kênh Zalo (bot per-club) | GROUP Beta; cap 3 bot free/tài khoản; không inline button |
| Meta Platform | Messenger + Facebook Login/account-link (phase-1) | Ghi exact evidence riêng cho messaging và login/account-link; capability chưa pass phải OFF; Messenger có cửa sổ standard 24h |
| Google Identity (OAuth) | Đăng nhập Google + định danh | Cấu hình OAuth; đồng ý người dùng |
| SePay / ApiPay | Webhook đối soát CK | Payload; độ trễ; thiếu trường |
| Postgres managed | Lưu trữ + RLS + read model public | Region VN; giá; backup |
| LLM/STT provider | OCR + voice | Chi phí; chính xác |
| (Tùy chọn) Geo/maps | Khu vực/khoảng cách cho discovery | Chi phí; privacy vị trí |

## 13. Rủi ro & Giảm thiểu (Risks)

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Rò rỉ dữ liệu cross-tenant (tiền/chat) | Nghiêm trọng | Repo scoped + RLS fail-closed + test bất biến + audit |
| **Lộ tiền/PII/giới tính ra public marketplace** | **Nghiêm trọng** | Public projection field-whitelist; tiền/PII không vào read model; test bất biến public; rate-limit chống scrape |
| Gán nhầm nợ / chiếm định danh | Cao | Claim-có-tiền cần khoá mạnh; merge chỉ verified (AUDIT C2/C5) |
| Sync sai/lệch trạng thái giữa kênh ↔ web | Cao | Canonical store + event re-projection; idempotent command/event; metrics sync-lag |
| Webhook route nhầm CLB / mất/đếm trùng CK | Cao | Token-in-URL + verify TK + lưu trước ack + idempotent |
| **Messenger App Review trượt/chậm → kẹt kênh phase-1** | **Cao** | Nộp App Review sớm; degrade sang web + Zalo; Messenger không phải kênh nhắc-nợ chính |
| Marketplace ít kèo / ít player (cold-start) | Cao | Beachhead bằng community host hiện có; seed tenant #1; khuyến khích publish |
| Lạm dụng marketplace/chat (spam join, scrape, spam chat) | Trung bình | Rate-limit, abuse controls, approval mode, area-level geo |
| Rate-limit cron/đa kênh 1k CLB | Trung bình | Throttler + rải giờ + hàng đợi |
| Chi phí LLM/STT vượt margin | Trung bình | Trần fair-use + provider rẻ + degrade nhẹ |

---

## 14. Lộ trình (Roadmap)

> Chi tiết kỹ thuật từng pha: `../strategy/saas-implementation-plan.md` §8 + `TDD.md` + `../research/player-side-saas-reconciliation.md` §7. Toàn bộ core docs dùng duy nhất canonical P-number; ROADMAP dùng cùng hệ này.

| Pha | Cột mốc nghiệp vụ |
|---|---|
| **P0–P1** | Nền multi-tenant + Postgres/RLS + **schema đa môn** + **3 tầng hiển thị** (cô lập) + **Google login / tài khoản web** |
| **P2** | Bot **Zalo** biết tenant; lệnh host + **mark-paid thủ công (tiền mặt/CK)** + nhắc nợ đa-tenant (Zalo DM + web) |
| **P2.5** | Messenger hybrid base: central+optional Page, role-aware host/player, protected actions, 24h/App Review |
| **P3** | Webhook đối soát CK biết tenant (module tiền, tier `host_pro`) |
| **P3.5** | Identity directory (Person/ChannelIdentity/Membership) + **link Facebook/Zalo** + merge an toàn |
| **P4** | **Web app + canonical backend + Sync engine** (Zalo/Messenger ⇄ web) + onboarding self-serve + **chat trong app** + **cài đặt hồ sơ + giá theo giới tính** |
| **P4.3** | **Marketplace discovery** (publish kèo + tìm kèo + join cross-club) |
| **P4.5–4.7** | Player-side Messenger → Player view → Player-side Zalo *(Messenger base enablement bắt đầu từ P2.5)* |
| **P5** | Billing + vòng đời tenant |
| **P6** | Hardening, load test, observability sync-lag, pen-test public layer, ToS/Privacy |

> Có thể **soft-launch miễn phí sau P4.3** để validate marketplace trước khi bật billing.
>
> **Phase-2 (DD-69 direction ✅ accepted; build TBD):** app native là đích sau phase-1; React Native + Expo là recommendation sau spike (framework chưa chốt). Phase-1 **target** = web app PWA installable/offline, nhưng PWA chưa live cho tới khi S9/S20 có evidence. Native chưa lên lịch; chat vẫn là acquisition 0-install, native cho retention. Technical gates: client-safe contracts, bearer/refresh + iOS login compliance, dedicated device push, privacy-safe payload, `/api/v1` compatibility và offline read-only — xem `../dd-69-app-native-analysis.md`.

---

## 15. Tiêu chí nghiệm thu (Acceptance Criteria)
- **AC-1** Host lạ onboarding và tạo/publish kèo; club không Page dùng central Messenger đầy đủ, optional Page tự nối không cần platform can thiệp.
- **AC-2** Hai CLB cùng hệ thống: tiền/nhắc/CK/roster/**chat** **không lẫn nhau**; test cô lập xanh.
- **AC-3** **Public marketplace** hiển thị kèo của nhiều CLB/môn; field public không lộ tiền/PII/giới tính (test bất biến public xanh).
- **AC-4** Player **chưa thuộc CLB** tìm thấy kèo qua bộ lọc và **join được** (open) / gửi request (approval).
- **AC-5** **Sync 2 chiều:** host tạo kèo trên web → hiện trong group **Zalo/Messenger** & marketplace; player join qua **Zalo bot / Messenger bot** → web + roster cập nhật đúng session; mọi nơi nhất quán ≤ vài giây.
- **AC-6** CK/tiền mặt được đánh dấu đúng CLB; **host multi-select mark paid** → **xác nhận tự động tới player**; chưa trả → **được nhắc** (web + Zalo; Messenger best-effort trong 24h).
- **AC-7** Một người qua **Facebook + Zalo** cùng CLB gộp về **1 nợ**.
- **AC-8** (plan trả phí) Hết trial bị **chặn lệnh quản trị** nhưng CK player **vẫn lưu**; kèo public hiện có chỉ sống tới lúc đóng/hết giờ; CK đúng mã **tự kích hoạt lại**. `free` **không** bị chặn vì non-payment.
- **AC-9** Không có đường rò rỉ cross-tenant **và** không có đường lộ tiền/PII ra public (pen-test).
- **AC-10** **Chat trong app:** member gửi được chat toàn CLB và chat riêng 1-1; chỉ đúng người đọc được; không rò rỉ cross-tenant; **không** xuất hiện ở group Zalo/Messenger.
- **AC-11** **Giá theo giới tính:** host đặt giá nam/nữ khác nhau; hệ tạo `charge` đúng theo giới tính từng member; giới tính không lộ ra public.
- **AC-12** **Cài đặt hồ sơ:** người dùng đặt giới tính/ngày sinh/tên/username/ngôn ngữ; username trùng bị chặn; thay đổi sync mọi surface.
- **AC-13** Hybrid E2E: central+tenant Page, hai tenant, host/player/dual-role, multi-club/cross-club, wizard replay/context-switch, final-slot race, 24h/fallback và one-route delivery đều pass; non-admin/wrong/stale action không mutate.

## 16. Quyết định mở (Open Decisions Log)

> ⭐ **Nguồn canonical:** xem `../standards/decisions.md`. Bảng dưới giữ để tra nhanh; khi chốt, cập nhật ở `decisions.md`.

| ID | Quyết định | Trạng thái |
|---|---|---|
| OD-1 | SĐT verified (share-contact) làm khoá merge chính | 🔄 **Điều chỉnh bởi DD-50 (16/07):** phase-1 không thu SĐT; khoá mạnh = verified email + link_code; phone dormant |
| OD-17 | **Founder batch 16/07/2026** — money correction (đổi giá/leave-refund/rejoin carry-over), Host Pro lifecycle, guest→full + ban, identity recovery authority, PII collection config, DM/media chat, co-admin capability | ✅ **DD-49..56** (batch closure ở `decisions.md` v1.45; current authority v1.47 không đổi batch này) |
| OD-18 | Messenger Page topology + host/player same surface | ✅ **DD-65..68 (owner 17/07):** central always + optional tenant Page; shared role-aware core; Page-scoped identity/reachability; durable opaque interactions |
| OD-19 | **Session Organize** (điều phối trong buổi: sân + trận hai phía + xếp người 4-mode + live score) | ✅ **DD-61..64 accept in-principle (owner 18/07)** — build **post-P4**, phased; tenant-private không lộ public, hang off `sessions`/`players`, không đổi phase-1 scope; DD-63 `balanced` degrade tới khi có level source. Spec: `../features/feature_session_organize.md`. |
| OD-2 | `pay_code` contract: suffix trần 4 ký tự + prefix namespace; resolver own/foreign/none; allocation invariant | ✅ **DD-02 chốt 13/07/2026** |
| OD-3 | Giá/tier subscription host | ✅ **DD-29**: `free` (web + Zalo + Messenger + mark-paid thủ công + chat) · `host_pro` 250k (auto reconcile/nhắc + AI + CRM). |
| OD-4 | Hosting Postgres — HA+PITR+Singapore ✅; ✅ **(2026-07-16): (c) co-locate DigitalOcean** (App Platform + Managed PG HA-standby, VPC private); Fly = fallback; pre-build gate = egress-IP verify | ✅ (→ DD-04, `../dd-04-hosting-final-decision.md`) |
| OD-5 | **Join cross-club mặc định:** open hay approval? | ✅ **DD-05:** per-kèo, mặc định `open`; approval → `join_requests(pending)` re-check eligibility trong tx |
| OD-6 | **Độ chi tiết vị trí public:** khu vực/quận vs venue chính xác | ✅ **DD-06:** public `area` only; venue post-join (invariant test) |
| OD-7 | **Realtime web:** SSE + fan-out `LISTEN/NOTIFY` (dùng chung cho sync + chat) | ✅ chốt (→ DD-07) |
| OD-8 | Danh sách môn khởi điểm (cầu lông, pickleball, …) + taxonomy trình độ | ✅ **DD-08:** 7 môn seed (extensible qua `sports`) + level 5-bậc ordered rank |
| OD-9 | **Kênh phase-1** | ✅ **v3.4: Zalo + Facebook Messenger + web; bỏ Telegram** (→ DD-37 ✅, thay DD-09) |
| OD-10 | Web stack = **Next.js App Router**, standalone/container; không Vercel | ✅ (→ DD-10) |
| OD-11 | **Auth phase-1:** Google OAuth + email/password + gated Facebook Login/account-link | ✅ **DD-13** (Google+email) · **DD-33** (Facebook accepted; external enablement evidence pending; no PSID auto-link) · DD-14 (Zalo login, ⬜) |
| OD-12 | **Chat in-app:** club-wide + 1-1, **chỉ Plexco, không bridge** kênh ngoài ở phase-1 | ✅ (→ DD-38 scope-committed phase-1; schema `chat_*` chờ migration) |
| OD-13 | **Giá theo giới tính:** kèo có giá nam/nữ; giới tính lấy từ hồ sơ, không lộ public | ✅ (→ DD-39 scope-committed phase-1; cột `person.gender` chờ migration) |
| OD-14 | **Mark-paid thủ công tiền mặt/CK (tap/multi-select)** mặc định mọi tier; auto-reconcile là `host_pro` | ✅ (→ DD-40 ✅, giải nuance DD-29) |
| OD-15 | **Session-model cluster** (mô tả kèo + gating, no-show/reliability, nhãn thành viên, invite-token kèo private, waitlist, kèo-không-CLB) | ✅ **DD-41/42/43/44/45/46** (build P2–P4+; contract chi tiết ở `../standards/decisions.md` + `../dd-*-analysis.md`). Giữ `tenant_id NOT NULL`+RLS; không lộ tiền/PII/tag ra public. |
| OD-16 | **Social layer** (follow user + hồ sơ public/private cross-user) | ✅ framework **DD-47/48** (build P4+; `person_follows` global-protected, `profile_visibility`; KHÔNG nới RLS/tiền — HR1/HR2). DD-55 đã đóng DM + block; còn 3 open item lúc build. |
| OD-20 | **Định vị app-native:** phase-1 target web app PWA → phase-2 app native; chat = acquisition 0-install, native = retention | ✅ **DD-69 direction accepted (owner 18/07)** — app-first; native ngoài phase-1 committed scope, **build phase-2 TBD**; technical gates (framework/platform/API-auth-push/offline/store) còn mở. Xem `../standards/decisions.md` DD-69 + `../dd-69-app-native-analysis.md` |

## 17. Thuật ngữ (Glossary)

| Thuật ngữ | Nghĩa |
|---|---|
| **Plexco** | Platform quản lý + khám phá hoạt động thể thao đa môn, 2 phía (host/player) |
| **Tenant / Club** | Một CLB = một đơn vị dữ liệu tiền/roster/chat cô lập |
| **Host / Organizer** | Chủ CLB (tenant admin) |
| **Player** | Người chơi (member của CLB hoặc người tìm kèo qua discovery) |
| **Kèo / Session** | Một buổi chơi (môn/ngày/giờ/khu vực/giá/slot) |
| **Sport** | Môn thể thao (cầu lông, pickleball…) — chiều dữ liệu của kèo |
| **Discovery / Marketplace** | Lớp công khai cho player tìm & join kèo xuyên CLB |
| **Public projection** | Bản chiếu công khai field-whitelist của kèo (không tiền/PII/giới tính) |
| **Canonical store** | PostgreSQL + domain model — nguồn sự thật duy nhất |
| **Sync engine** | Command/outbox/event + projection từ canonical store ra các surface |
| **Surface** | Một bề mặt tương tác (Zalo/Messenger/web) trên cùng store |
| **CK** | Chuyển khoản ngân hàng |
| **Mark-paid** | Đánh dấu đã trả (tiền mặt hoặc CK), thủ công hoặc auto-reconcile |
| **Person / AccountIdentity / ChannelIdentity / Membership** | Người thật toàn cục / định danh đăng nhập (Google/email/Apple tương lai) / định danh provider endpoint-scoped (Zalo/Messenger) / quan hệ người ⇄ club |
| **Chat in-app** | Chat toàn CLB + riêng 1-1 sống trong Plexco, không bridge kênh ngoài |
| **RLS** | Row-Level Security (cô lập tiền/roster/chat ở tầng DB) |
| **3 tầng hiển thị** | public discovery · tenant-private (RLS) · person-self |

---

*BRD tập trung yêu cầu nghiệp vụ. Thiết kế kỹ thuật chi tiết — xem `../strategy/saas-implementation-plan.md`, `TDD.md`, `../research/player-side-saas-reconciliation.md`, `../research/player-side-saas-AUDIT.md`, `../channels/messenger/messenger-channel-design.md`.*

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 18/07/2026 | v3.9d | **Founder batch (owner 18/07, decisions v1.47):** DD-69 **định hướng accepted** (§5.2/§14/§16 OD-20 "proposal"→"direction accepted"; native build phase-2 TBD, gates mở); DD-33 Facebook Login phase-1 ✅; DD-61..64 Session Organize accept-in-principle (post-P4). Phase-1 committed scope không đổi. |
| 18/07/2026 | v3.9c | **DD-69 proposal + review closure:** §5.2/§14/§16 pin phase-1 PWA là target chưa live, phase-2 native chưa committed; RN+Expo chỉ recommendation sau spike. Technical contract tách client-safe package, Google PKCE + Apple/equivalent iOS gate, device push khỏi ChannelIdentity, privacy-safe payload, `/api/v1` compatibility và offline read-only. Phase-1 scope không đổi. Xem `../standards/decisions.md` DD-69 + `../dd-69-app-native-analysis.md`. |
| 17/07/2026 | v3.9b | Feature-doc closure theo decisions v1.45/TDD v3.1: mirror exact endpoint identity/reachability, SePay HMAC, DM safety/block source, Assistant DLP và bounded Session Organize correction/SSE. Không đổi phase hoặc runtime readiness. |
| 17/07/2026 | v3.9a | §16: thêm **OD-19** Session Organize quick-ref (proposal, trỏ DD-61..64) cho khớp pattern OD-15/16/18 — mỗi cluster có row riêng. Không đổi scope/phase; vẫn proposal. |
| 17/07/2026 | v3.9 | Authority → decisions v1.44 / PRD v2.7 / TDD v2.9. Mirror Session Organize v0.3 contract hardening nhưng giữ DD-61..64 proposal và không đổi phase-1 scope/runtime readiness. |
| 17/07/2026 | v3.8 | **DD-65..68:** chốt hybrid Messenger central+optional club Page, host/player parity, protected target routing, Page-scoped identity/reachability, durable wizard/actions, one-route delivery và AC-13. Runtime/schema còn pending. |
| 16/06/2026 | v3.0 | Initial BRD — MVP scope, canonical store, identity model |
| 18/06/2026 | v3.1 | Chuẩn hoá durable webhook, payment ledger/allocation, discovery |
| 19/06/2026 | v3.1 | Thêm Changelog table, cập nhật cross-refs |
| 20/06/2026 | v3.2 | FR-9.1 + AC-8: làm rõ `free_web` (0đ) vào thẳng active, không past_due/suspended vì non-payment (DD-03, BL-BIL-1) |
| 05/07/2026 | v3.3 | **DD-29 pricing pivot** (thay DD-03): bảng tier → `free` / `host_pro` (250k); tính năng free-pro theo capability flags config-driven. |
| 10/07/2026 | v3.4 | **Phase-1 pivot kênh: bỏ Telegram, đưa Facebook Messenger + Zalo vào MVP.** Thêm **Google login** (FR-1.1, BR-14, OD-11), **chat trong app** (MODULE 10, BR-15, AC-10, OD-12), **cài đặt hồ sơ + giá theo giới tính** (MODULE 11, FR-2.1, BR-16, AC-11/12, OD-13), **mark-paid thủ công tiền mặt/CK tap/multi-select** (FR-5.1, BR-7, OD-14), **nhắc web+Zalo chính / Messenger best-effort 24h** (FR-6.1, CO-3). Cập nhật §5 scope, §11 constraints, §12 dependencies, §14 roadmap, glossary. Decisions: DD-37/38/39/40 mới + DD-13/33/09/29 cập nhật (`decisions.md` v1.15). Downstream cần sync: PRD/TDD/feature docs. |
| 10/07/2026 | v3.4 (review fixes) | **DD-38/39 ✅ scope-committed phase-1** (OD-12/13 · §16 callout — bỏ 🟡/đề xuất, giữ trong gói free-tier như đã viết). **Money vocab → canonical ledger:** FR-5.1 mark-paid = INSERT `payment_allocations` (cash/manual) + cập nhật `charges`, bỏ bảng `payment` & source `bank_transfer`. Đồng bộ với `decisions.md` v1.16 (DD-38/39 ✅). |
| 15/07/2026 | v3.5 | **Reconcile §16 + review fixes:** OD-2/5/6/8 → ✅ DD-02/05/06/08; thêm OD-15 (session-model cluster DD-41–46) + OD-16 (social DD-47/48 framework). Đồng bộ phase Messenger P2.5/P4.5, Zalo P4.7; chuẩn hoá Messenger 24h + eligible outside-window wording. MVP scope không đổi; schema/code vẫn chờ build (authority `decisions.md` v1.32 + feature specs). |
| 16/07/2026 | v3.6 | **DD-04 ✅ Accepted:** OD-4 → **(c) co-locate DigitalOcean** (App Platform + Managed PG HA-standby, VPC private, Singapore); Fly = fallback; pre-build egress-IP gate. Record `../dd-04-hosting-final-decision.md`. MVP scope/FR không đổi. |
| 16/07/2026 | v3.7 | **Founder batch DD-49..56 (decisions v1.36):** OD-1 → 🔄 DD-50 (không thu SĐT; FR-7.3 bỏ SĐT khỏi merge ladder; NFR-P1 + DD-54 PII config); FR-9.1 + DD-51 (trial 14d/khoá ngay, grace 7d invoice, refund window 7d); thêm OD-17 (batch summary). Schema/code vẫn defer build slice. |
