# TÀI LIỆU YÊU CẦU SẢN PHẨM (PRD) — User Flows
## Plexco — platform thể thao đa môn (host + player): Zalo · Facebook Messenger + Web app *(Telegram đã loại khỏi phạm vi)*

**Sản phẩm:** **Plexco** — platform quản lý & khám phá hoạt động thể thao đa môn, 2 phía (host + player); bot-in-chat (Zalo/Messenger) + web app sync 2 chiều; **phase-1 không app native** (target = web app PWA installable/offline; S9/S20 chưa phải runtime evidence) — **native là hướng phase-2** (DD-69 direction ✅ accepted; build TBD)
**Phiên bản:** 2.8h
**Ngày cập nhật:** 25/07/2026
**Tài liệu tham chiếu:** `BRD.md` v3.9i · `TDD.md` v3.1c · `../strategy/saas-implementation-plan.md` · `../research/player-side-saas-AUDIT.md` · `../channels/messenger/messenger-channel-design.md` · `../standards/decisions.md` **v2.04 WIP** (canonical current decision log; status đọc theo từng DD; `DECISION_FINAL` không phải runtime/readiness) · `../dd-69-app-native-analysis.md`

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 25/07/2026 | v2.8h | **Authority pointer reconcile:** BRD/PRD/TDD cùng trỏ current decisions v2.04 WIP và nhắc đọc status theo từng DD; pointer-only, không đổi flow/runtime. |
| 24/07/2026 | v2.8g | **Reconcile FLOW 2 public-projection timing (`docs-prd-flow2-publish-projection-reconcile`, hard dependency of the ratified publish contract; 4 codex rounds to close all mirrors):** step 1 thêm rõ create = trạng thái `draft`, chưa nhận join/chưa lên marketplace dù đã chọn `visibility=public`; step 2 làm rõ Host **Đăng kèo** (`PublishSession` `draft`→`open`) là lúc marketplace push xảy ra (không phải tại create); step 3 (auto-announce, trước là step 2) **dời sau publish** (round-01 P2). FLOW 12 invariant note + FLOW 14 marketplace bullet thêm cùng điều kiện `open`; FLOW 12/BE cross-ref step-number sửa lại "bước 2" sau reorder (round-03 P2). Khớp `feature_session_management_tech.md` §4 bước 7, `feature_marketplace_discovery(.md/_tech.md)` §4, TDD.md §3.2/§3.8/§3.9 FR-16, `BRD.md` AC-5 và `business-rules.md` BL-DSC-2 (round-04 P1 — cùng round reconcile để đóng hết mirror còn lại trong authority chain BRD→PRD→TDD). `ROADMAP.md` (2 mirror khác) và `docs/strategy/saas-implementation-plan.md` (directional input, không phải authority) được xác nhận nhưng KHÔNG sửa — ROADMAP.md scope-gate collision với in-flight `docs-migration-tail-0018-to-0020-sweep` (deferred follow-up, xem manifest `_note`); strategy doc deliberately out of scope. Prose only; dated changelog giữ verbatim; không resolve OQ nào khác. |
| 19/07/2026 | v2.8f | **Mirror DD-79 ✅ Home hub (S9):** note dưới FLOW 10 — Home landing compose person-self + marketplace + §A; nav shell 5 slot + 💬 header; composition-only, không flow/contract mới. DD-81 Pencil ghi ở design docs. |
| 19/07/2026 | v2.8e | Authority pointer refresh v1.67→v1.74 + BRD v3.9f: v1.68–v1.74 là BE-contract closure no-runtime (join/invite idempotency v1.68 · notification v1.69–71/74 · DD-45a v1.72 · DD-50 v1.73). Pointer-only, không thêm flow/runtime. |
| 19/07/2026 | v2.8d | Current authority v1.65/BRD v3.9e; DD-73..78 sequencing correction ở v1.64. DD-74/75 tạo baseline; chỉ DD-76/77 evidence-gated; DD-78 đi cùng consumer. Pointer-only, không thêm flow/runtime. |
| 19/07/2026 | v2.8c | **DD-05/06/45/49 integrity:** approval rejoin preflight nhưng không persist proof; approve re-derive live aggregate. Venue active-only; refunded rejoin waitlisted không new lifecycle. Waitlist retry one origin event + max 3/backoff/no recursion/exhausted review-DLQ. `0014` branch-only; behavior chưa build. Authority v1.58. |
| 18/07/2026 | v2.8b | **Founder batch (decisions v1.47):** DD-69 định hướng accepted (native phase-2 TBD, gates mở); DD-33 Facebook Login phase-1 ✅; DD-61..64 accept-in-principle. PRD không thêm native flow vào phase-1; flow/scope phase-1 không đổi. |
| 18/07/2026 | v2.8a | **DD-69 proposal + review closure:** phase-1 target là web PWA nhưng chưa claim live; native là phase-2 TBD. Technical details (RN+Expo recommendation, auth/push/API/offline/store gates) ở DD-69 analysis; PRD không thêm native flow vào phase-1. Phase-1 flow/scope không đổi. |
| 17/07/2026 | v2.8 | Feature-doc closure: endpoint identity dùng hai HMAC domain-separated; SePay production webhook dùng timestamp/raw-body HMAC; DM safety + canonical block store; rejoin/merge không cộng nợ ad hoc; Assistant DLP và Session Organize correction/SSE giữ đúng proposal boundary. |
| 17/07/2026 | v2.7 | Authority → BRD v3.9 / TDD v2.9 / decisions v1.44; Session Organize v0.3 vẫn post-phase-1 proposal, không đổi flow phase-1. |
| 17/07/2026 | v2.6 | **DD-65..68:** Messenger hybrid central+optional club Page; cả host/player dùng cả hai; protected tenant/action routing, Page-scoped identity/reachability, create-session wizard, global/local discovery và one-route delivery. Không claim runtime đã implement. |
| 16/07/2026 | v2.5 | **Founder batch DD-49..56 (decisions v1.36):** merge path bỏ SĐT verified → email verified (DD-50, FLOW link/merge); FLOW 11 billing chốt DD-51 (trial 14d/remind 2d/khoá ngay; grace 7d; refund window 7d). Correction/rejoin/DM/co-admin contract chi tiết ở feature specs + DD-49/55/56. |
| 15/07/2026 | v2.4 | **Decision reconcile + review fixes:** refs qua DD-48 theo `decisions.md` v1.32; đồng bộ phase Messenger P2.5/P4.5 và Zalo P4.7; chuẩn hoá policy wording Messenger 24h. Session/social là contract build P2–P4+; flow chi tiết (gating/attendance/tags/invite/Skip-Club/follow) viết cùng build slice. |
| 15/07/2026 | v2.3 | **DD-45:** FLOW 13 và discovery race đổi `SESSION_FULL` thành active-vs-waitlisted outcome; full không charge/venue, promotion mới tạo charge; approval full cũng vào waitlist. |
| 10/07/2026 | v2.2 (review fixes) | **DD-38/39 ✅ scope-committed phase-1** — FLOW 15 + surface map + FLOW 1/2/6 bỏ 🟡/proposal (schema `chat_*`/`person.gender` vẫn chờ migration, không claim done). **Money vocab → canonical ledger:** FLOW 6 mark-paid = INSERT `payment_allocations` (cash/manual) + cập nhật `charges`, bỏ bảng `payment` & source `bank_transfer`. Đồng bộ `decisions.md` v1.16. |
| 10/07/2026 | v2.2 | **v3.4 channel pivot: bỏ Telegram; Messenger + Zalo là kênh phase-1 (+ Google login/chat/gender-pricing/manual mark-paid) — DD-37/13/33/38/39/40.** Surface & command map bỏ Telegram, thêm Messenger phase-1; FLOW 1 auth = Google OAuth + email (bỏ TG Login); FLOW 3 player join → Messenger (quick-reply, cửa sổ 24h); FLOW 6 thêm mark-paid thủ công tiền mặt/CK (tap/multi-select, DD-40); FLOW 7/8 nhắc & xác nhận qua web + Zalo (Messenger best-effort 24h); FLOW 5/10/14 bỏ Telegram identity/projector. Chat in-app (DD-38 🟡) + cài đặt hồ sơ/giá theo giới tính (DD-39 🟡) nêu ở dạng proposal. |
| 19/06/2026 | v2.1 | Chuẩn hoá Changelog table format |
| 18/06/2026 | v2.1 | Messenger ra khỏi MVP; canonical store = PostgreSQL/domain model; webhook durable-ingest; payment allocation hỗ trợ partial/overpay/multi-person |
| 18/06/2026 | v2.0 | **Reposition** → platform đa môn 2 phía. Thêm persona P4 discovery, web app là surface trung tâm, đa môn trong FLOW 1/2, FLOW 12 discovery/tìm kèo, FLOW 13 join cross-club, FLOW 14 sync 2 chiều |
| 18/06/2026 | v1.1 | Đổi tên → **Plexco**, thêm tham chiếu Messenger |
| 16/06/2026 | v1.0 | Bản đầu — flows theo kênh, identity directory, đối soát CK đa-tenant, billing |

---

# 1. PERSONAS

- **P1 — Host / Organizer** (tenant admin): tạo & quản lý kèo (chat + web), thu tiền, **mark-paid thủ công (tiền mặt/CK)** + gán tay, **publish kèo lên marketplace**, xem dashboard club.
- **P2 — Co-admin** (tùy chọn): được host uỷ quyền chạy lệnh quản trị.
- **P3 — Player (member)**: người chơi trong CLB — join kèo, nhận nhắc/xác nhận, xem clubs/kèo/nợ của mình.
- **P4 — Player (discovery)**: người tìm kèo mới — **khám phá kèo xuyên CLB/môn** (lọc môn/khu vực/giờ/trình độ/giá), join kèo CLB chưa từng tham gia.
- **P5 — Platform Owner** (mình): vận hành Plexco, không xuất hiện trong flow người dùng cuối.

> Plexco **là** marketplace 2 phía (host publish kèo ↔ player tìm & join). **Không** làm matchmaking xếp cặp theo trình độ, **không** booking sân — discovery = *tìm kèo có sẵn*. Tiền/roster/chat nội bộ vẫn **cô lập tuyệt đối** (3 tầng hiển thị, xem BRD §3.2 / TDD §3.2).

---

# 2. SURFACE & COMMAND MAP

Bề mặt tương tác phase-1 = **web app + Zalo + Facebook Messenger**. **Telegram đã loại khỏi phạm vi (DD-37).** PostgreSQL/domain model là canonical store; mọi action đi qua FLOW 14:

| Surface | Dùng cho | Ai |
|---|---|---|
| **Web app** (surface) | onboarding; host dashboard (kèo/roster/doanh thu); **discovery/tìm kèo**; player view; billing; **chat in-app** (DD-38 ✅); cài đặt hồ sơ (DD-39 ✅) | P1, P3, P4 |
| **Zalo bot DM** (bot-per-club) | join number-reply, `/me`,`/pay`,`/name`, nhắc/xác nhận (kênh chính cùng web) | P3 |
| **Facebook Messenger** (central Page + optional club Page, **phase-1**) | role-aware host create/manage + player local/global discover/join; nhắc best-effort 24h | P1/P2/P3/P4 |

**Command map (rút gọn):**

| Lệnh / Action | Kênh | Quyền |
|---|---|---|
| `/newsession`, `/announce`, `/config`, `/cash`, **mark-paid (tap/multi-select tiền mặt/CK)**, `/unmatched`, publish/approve | web + Zalo/Messenger DM | P1/P2 (admin) |
| **Join** (Messenger quick-reply / Zalo number-reply / web 1-click) | Messenger, Zalo, web | P3 |
| `/me`, `/leave`, `/pay`, `/who`, `/myclubs` | Zalo/Messenger DM, web | P3 |
| **`/discover` / tìm kèo** (lọc môn/khu vực/giờ) + **join cross-club** | web + Zalo/Messenger DM | P3, P4 |
| `/name` | Zalo/Messenger DM | P3 |
| `/link` (sinh mã merge) | Zalo/Messenger DM | P3 |

> Tenant/resource **không suy từ nội dung**. Zalo token/web session có thể pin tenant; Messenger `page_id` resolve endpoint/default context, còn target từ opaque action/protected public ref/server-side picker. Discovery đọc public read model cross-tenant.

> **Kênh Messenger (DD-65..68):** Plexco central Page luôn có; club Page là optional và có capability parity. Root menu role-aware; host `/newsession` hoàn tất basic wizard trên cả hai, player discover/join local hoặc cross-club bằng opaque action. Standard messaging vẫn giới hạn 24h; proactive ngoài window fail-closed/fallback web+Zalo; App Review bắt buộc.

---

# 3. DETAILED USER FLOWS

---

## FLOW 1: ONBOARDING TENANT (Web) *(P4)*

**Mục tiêu:** chủ CLB tự đăng ký → vận hành được, không cần platform can thiệp.

1. **Đăng nhập** web bằng **Google OAuth**, **tài khoản web (email + mật khẩu)** (DD-13), hoặc **Facebook Login** khi DD-33 external enablement evidence đã active. Facebook chưa active → ẩn/OFF CTA và dùng transactional one-time `link_code` cho account-link; không auto-link Messenger PSID. Sau auth hợp lệ → tạo `Account` + `Tenant` (CLB). *(Telegram Login: đã loại.)*
2. **Nối ngân hàng (SePay/ApiPay):** nhập số TK + bank; hệ thống sinh `webhookToken`, đăng ký SePay webhook với `authen_type=HMAC_SHA256` + secret protected, hiện hướng dẫn/trạng thái ở dashboard. Không downgrade production webhook sang `Api_Key`.
3. **Nối Zalo:** owner **tự tạo bot** trong Zalo Bot Manager (tài khoản của họ, free ≤3 bot) → **dán Bot Token** → hệ thống set webhook `/webhook/zalo/<token>` (bot-per-club).
4. **Messenger sẵn qua central Page.** Tuỳ chọn: FB Login + chọn Page riêng của CLB → hệ thống tạo tenant Page binding; không nối Page vẫn dùng đủ create/join cơ bản qua central (DD-65). Kênh chạy dưới App Review của platform.
5. **Cấu hình:** **môn mặc định** (badminton/pickleball/…), ngôn ngữ, giá mặc định **+ tùy chọn giá theo giới tính (nam/nữ)** (DD-39 ✅, cột `person.gender` chờ migration), `roster on/off`, `auto-announce on/off`, **chính sách publish (private/public mặc định) + join (open/approval)**.
6. **Checklist** trên dashboard: ☐ nối bank ☐ link Zalo ☐ (tuỳ chọn) nối Page riêng ☐ tạo & (tùy chọn) publish kèo đầu.

> **DoD:** người lạ đi hết flow tới khi tạo/publish kèo đầu; Messenger central hoạt động mà không cần Page club, Page riêng onboarding nếu chọn không đụng env file.

---

## FLOW 2: TẠO & ĐĂNG KÈO — Host (chat **hoặc** web) *(P2 / P4)*

1. Host `/newsession` (Zalo/Messenger central hoặc club Page) **hoặc** tạo trên web. Messenger central auto-select một eligible club hoặc hiện server-side picker; wizard → preview → confirm, mỗi consume re-check `session.manage`/context/snapshot và phát đúng một shared `CreateSession` command. Kèo tạo ở trạng thái **`draft`** (`private` hoặc `public`) — **chưa nhận join và chưa lên marketplace** dù đã chọn `visibility=public`.
2. Host **Đăng kèo** (lệnh/callback bot hoặc nút web "Đăng kèo" + confirm riêng) → `PublishSession` chuyển `draft` → **`open`**, kèo bắt đầu nhận join. Nếu `visibility=public` — **đúng lúc publish này** — kèo mới được **đẩy lên marketplace** (public projection field-whitelist — FLOW 12); còn `draft` thì chưa xuất hiện dù đã chọn public.
3. Sau khi đăng (session đã `open`), nếu `auto-announce=on` + có kênh → bot **tự đăng** message join vào Zalo/Messenger; hoặc `/announce <id>` đăng tay.
4. Message hiển thị roster; lưu `announce` ref (Zalo/Messenger) để cập nhật live. **Mọi thay đổi sync sang web + marketplace + kênh** (FLOW 14).
5. Host `/close` (hoặc trên web), xem danh sách + trạng thái trả; kèo đóng → **hạ khỏi marketplace**.

---

## FLOW 3: PLAYER JOIN — Facebook Messenger *(base P2.5 · player workflow P4.5)*

1. Player nhắn **central hoặc club Page** / dùng persistent menu. Central mặc định global discovery; club Page mặc định local và có “Khám phá tất cả”. Mỗi trang tối đa 8 business choices + navigation.
2. Player chọn opaque action; server validate actor+Page binding, TTL, target session, snapshot/version. Protected resolver lấy target `session→tenant`; source club Page có thể khác target khi cross-club và không grant authority.
3. Resolve identity (FLOW 5) → tạo/`addMemberToSession` (idempotent theo membership).
4. Trả **xác nhận qua Messenger** (trong **cửa sổ 24h**) + **nội dung CK name-based / pay_code+QR**; **roster sync lên web** (FLOW 14).
5. Rời: quick-reply **[Rời]** → bỏ nếu chưa trả; đã trả → chặn + báo.

> Messenger dùng standard messaging trong cửa sổ 24h. Identity lookup dùng hai HMAC domain-separated — provider scope từ `page_id`, provider user từ PSID — rồi unique theo ba phần `(platform, scope_hash, user_hash)`; không auto-merge xuyên Page. Tenant/resource không route từ free text/raw callback ID.

---

## FLOW 4: PLAYER JOIN — Zalo (DM number-reply) *(P4.7)*

1. Player DM bot Zalo của club `/join` → bot liệt kê buổi đang mở, đánh số.
2. Player **trả lời số** (vd `1`).
3. Resolve identity (FLOW 5) → `addMemberToSession` → trả xác nhận + **nội dung CK name-based** (P1–P3) / pay_code+QR (P4).
4. Lệnh phụ: `/me`, `/name <tên>`, `/leave`, `/pay`, `/who`.

> Zalo **không inline button** → number-reply; bot-per-club nên DM tự ghim tenant (không cần picker). GROUP Zalo còn Beta → player-flow bám **DM number-reply**.

---

## FLOW 5: IDENTITY — CLAIM & MERGE *(P3.5)*

**Khi player xuất hiện lần đầu ở 1 CLB:**

1. `(platform, provider_scope_lookup_hash, platform_user_lookup_hash)` → `ChannelIdentity` → `Person` (global). Messenger scope = Page; Zalo scope = bot/OA tới khi DD-15 chứng minh rộng hơn. `platform ∈ {zalo, messenger}` (kênh chat), auth account ∈ `{google, email, facebook, zalo}`. Chưa có → tạo Person.
2. Tìm `Membership(Person, Tenant)`:
   - Chưa có → matcher tên scoped-tenant:
     - Không khớp → **tạo membership mới** (an toàn, auto).
     - Khớp membership **chưa có tiền** → claim auto.
     - ⚠️ Khớp membership **đã có nợ/payment** → **KHÔNG auto theo tên**. Chỉ verified account email hoặc transactional one-time `link_code` mở claim; owner assertion/CK chỉ là review evidence. (DD-50)
     - Mơ hồ → hỏi chọn (Zalo số / Messenger quick-reply).

**Merge xuyên kênh (Facebook Messenger ⇄ Zalo cùng người; link vào Person đăng nhập Google):**

1. **`/link`** ở đúng một authenticated channel/account → cấp **`link_code` purpose-bound** (≥64-bit entropy, hash-at-rest, TTL ngắn, single-use, `max_attempts` + lock/revoke) → player gửi mã ở bot/web B → transaction lock+re-check issuer/action/TTL/lifecycle, tạo merge plan, **xác nhận tường minh** + audit. (DD-50)
2. **Email verified** (Google OAuth hoặc email/password đã verify) → auto-merge. *(DD-50: phase-1 không thu SĐT — share-contact/SĐT bỏ khỏi merge path, phone dormant.)*
3. STK/tên → **chỉ gợi ý, owner duyệt** (không auto). (AUDIT B4)

> Merge mà 2 Person đều có membership cùng tenant → **reconcile về 1 membership survivor** dưới lock, re-parent references và giữ tombstone/pay-code recognition; obligations/allocations vẫn là ledger facts, không “cộng nợ” hay rewrite bằng công thức ad hoc. Conflict không chứng minh được thì fail-closed/manual review. (AUDIT C4/C5, DD-50/53)

---

## FLOW 6: ĐÁNH DẤU TIỀN — mark-paid thủ công + đối soát CK *(P2 / P3)*

**Mark-paid thủ công (mọi tier — DD-40):**
1. Host mở danh sách roster (web/bot) → chọn **1 hoặc nhiều player (tap/multi-select)** → đánh dấu **đã trả bằng tiền mặt** hoặc **đã trả bằng CK**.
2. Áp **preview + confirm** (DD-25, human-initiated money mutation) → INSERT `payment_allocations` (tiền mặt → `source='cash'`; CK đã ingest → `source='manual'` + exact `bank_transaction_id`) + cập nhật `charges`, có audit, **idempotent** → trigger FLOW 8. CK host-attested chưa ingest chỉ được ghi qua dedicated allocation source sau migration (`bank_transaction_id=NULL`, actor + opaque evidence); trước migration reject. Cấm synthetic `bank_transaction` hoặc map sang `cash|manual`. (DD-40 v1.39)

**Đối soát CK tự động (`host_pro` — P3):**
3. CK về → **webhook SePay** `/webhook/sepay/:token` → token route đúng account/tenant; verify `X-SePay-Timestamp` ±300s và timing-safe `X-SePay-Signature: sha256=<hex>` trên `{timestamp}.{raw_body}`, rồi verify số TK. Thiếu/sai signature hoặc stale timestamp → reject trước ingest.
4. Trong **một DB transaction**: insert `bank_transactions` idempotent + enqueue reconcile job/outbox; commit thành công rồi mới ACK provider.
5. Matching engine (tenant-scoped): ưu tiên `pay_code` (nếu có) → fallback **tên + số tiền + ngày**.
6. Phân bổ CK vào `charges` qua `payment_allocations`; 2 buổi đồng giá cùng ngày → **FIFO**; tổng allocation không vượt CK và chỉ mark paid khi charge được phủ đủ.
7. Match được → cập nhật charge/debt → trigger FLOW 8 (xác nhận). Còn dư/không khớp → `/unmatched` (FLOW 9); worker retry an toàn sau crash.

> `charge` mỗi lượt chơi suy giá theo **giới tính member** nếu kèo đặt giá nam/nữ (DD-39 ✅, cột `person.gender` chờ migration). Auto-reconcile CK là tính năng **`host_pro`**; free tier dùng **mark-paid thủ công**.

---

## FLOW 7: NHẮC NỢ *(P2 manual → P3 auto)*

- **Manual (mọi tier):** owner `/remind` → nhắc người chưa trả; rate-limit.
- **Auto (`host_pro`):** cron quét người chưa trả quá **ngưỡng cấu hình (mặc định 2h → 24h → …)** → gửi qua **web push + Zalo DM** (kênh chính, theo exact bot/OA-scoped `channel_identity_id` reachability rồi authorize target tenant riêng); **Messenger chỉ best-effort trong cửa sổ standard 24h**, ngoài cửa sổ phụ thuộc cơ chế Meta đủ điều kiện/được phê duyệt → set `last_reminded_at` chống spam; quiet-hours; max N.

> Với Messenger, reachability/window **theo channel identity × Page endpoint**, không theo tenant-level platform. Dispatcher chọn tenant Page reachable → central Page reachable → web/Zalo và chỉ gửi một logical notification.

---

## FLOW 8: XÁC NHẬN ĐÃ TRẢ *(P4.5 / P4.7)*

Sau **mọi** điểm markPaid (thủ công tiền mặt/CK + auto-match CK) → `notifyPlayersPaid(tenant, paidMembershipIds[])`:
- Chọn kênh theo policy: web+Zalo chính; Messenger best-effort, chọn đúng một reachable Page endpoint (tenant rồi central), không gửi trùng.
- Best-effort try/catch, **không chặn dòng tiền**.

---

## FLOW 9: /UNMATCHED — Owner gán tay *(P3)*

1. CK không khớp → vào danh sách `/unmatched`.
2. Owner xem → gán cho đúng player → markPaid → FLOW 8.
3. Retry cron định kỳ thử khớp lại trước khi cần tay.

---

## FLOW 10: PLAYER VIEW — `/myclubs` + Web *(P4.6)*

> **DD-79 ✅ (19/07) — Home hub (S9):** phase-1 PWA lấy **Home** làm landing sau đăng nhập, compose chính data của FLOW này (person-self) + marketplace + notifications §A + onboarding_steps: chips Còn nợ/Kèo tuần · hero kèo kế tiếp (CTA theo role) · upcoming max 4 + "Tất cả →" (= danh sách person-self FLOW 10) · suggested. Shell: bottom nav 5 slot **Home · Feed (config-OFF tới DD-76) · [Khám phá — center/FAB] · Club (CLB sở hữu owner/admin + CLB tham gia, CTA Tạo CLB) · Setting**, 💬 chat (DD-38) + 🔔 ở header. Không flow tiền mới, không data contract mới. Spec: `../features/feature_home.md` v0.5a.

1. `/myclubs` (bot Zalo/Messenger) hoặc web (auth = phiên Google/email verify) → liệt kê **các CLB của Person + nợ/trạng thái từng CLB**.
2. **Chỉ dữ liệu của chính họ** — đường query person-authorized, KHÔNG qua tenant-RLS thường (AUDIT C6).
3. Web mở từ Zalo/Messenger cần **magic-link do bot phát** để auth (kênh chat không có login widget web).

---

## FLOW 11: BILLING — host subscription tiers *(P5)*

1. Tạo tenant: `free` → `active` ngay, không invoice; plan trả phí `host_pro` → `trialing` (**✅ DD-51: 14 ngày**, remind khi còn 2 ngày; hết trial không thanh toán → khoá ngay về `free`; trễ invoice khi đang active → grace 7 ngày; huỷ giữa kỳ: hoàn toàn bộ nếu request trong 7 ngày từ khi thanh toán).
2. Owner chọn plan: `free` (0đ — web + **kết nối Zalo + Messenger** + **mark-paid thủ công (tiền mặt/CK)** + nhắc thủ công + **chat cơ bản in-app**) hoặc `host_pro` (250k — thêm **đối soát CK tự động** + báo thu + **nhắc nợ tự động** + Trợ lý AI + CRM). Tính năng do capability flags quyết định (DD-29, DD-40 giải nuance).
3. Với paid plan, owner CK đúng số tiền vào **tài khoản platform**, nội dung mang `invoiceCode` → webhook match → đẩy `currentPeriodEnd +1 tháng`, `status=active`.
4. Invoice active trễ hạn → `past_due` + grace **7 ngày** (nhắc web/email) → `suspended`; riêng trial hết mà chưa trả → khoá ngay về `free`, không đi qua grace (DD-51).
5. **Suspended:** chặn lệnh nhưng **vẫn nhận & lưu CK player** (không mất giao dịch khi quay lại).
6. Free plan không cần payment để active nhưng bị giới hạn tính năng theo capability flags; MVP có thể **manual-activate** paid plan trước khi tự động hoá match.

---

## FLOW 12: DISCOVERY — Tìm kèo (marketplace) *(P4.3)*

1. Player mở **web** (`/discover`) hoặc bot (`/discover` Zalo/Messenger DM) — **không cần là member CLB nào**.
2. Lọc: **môn** (cầu lông/pickleball/…), **khu vực**, **ngày/giờ**, **trình độ**, **giá tối đa**, **còn slot**.
3. Hệ thống đọc **`public_sessions`** (read model cross-tenant, KHÔNG RLS, **field whitelist**) → trả danh sách: môn, giờ, **khu vực** (không địa chỉ chi tiết), giá, slot trống, tên host/CLB.
4. Xem chi tiết kèo công khai — **KHÔNG** roster người khác, **KHÔNG** STK/PII/giới tính, **KHÔNG** ai trả/chưa.
5. Bấm **Join** → FLOW 13.

> ⚠️ **Bất biến public (AUDIT §C8):** marketplace chỉ chứa field whitelist; tiền/PII/giới tính/roster không bao giờ lộ. `venue` chi tiết chỉ hiện khi canonical player outcome là `active`; approved-but-waitlisted vẫn ẩn (OD-6). Rate-limit + phân trang chống scrape. Chỉ kèo đã **Đăng** (`status=open`, FLOW 2 bước 2) mới vào đây — `draft` dù `visibility=public` chưa xuất hiện trong marketplace.

---

## FLOW 13: JOIN CROSS-CLUB — từ marketplace *(P4.3)*

1. Player bấm Join bằng opaque action/public session ref → protected resolver route `session→tenant`; raw ID/client tenant không có authority.
2. Resolve identity (FLOW 5): `(platform/web-session) → Person`, rồi lookup processed command + membership/player + pending request hiện có. **Không eager-create guest membership** ở bước này. Existing `active|waitlisted|pending` trả current outcome idempotently; DD-52 ban áp sau đó không auto-evict và không tạo alert/write mới.
3. Theo `join_policy` của kèo:
   - **`open`** → absent/`left` final join dưới session lock chỉ sau DD-41/DD-42/shared DD-52. First-entry còn slot → active+exactly-one charge+venue; full → waitlisted, không charge/venue/QR. Existing `left` re-derive DD-49: active carry-over/append refunded lifecycle; full waitlisted, refunded không new lifecycle; unknown→review.
   - **`approval`** → absent/`left` request-create preflight DD-41/DD-42/DD-52; first-entry pending only. Existing `left` chỉ preflight live DD-49 disposition; `join_requests` không lưu/bind financial proof. Host approve lock session→root-job→request→player/aggregate, re-check restrictions và re-derive; drift/unknown giữ pending + zero mutation. Active carry-over/append lifecycle; full approved+waitlisted/no-new-lifecycle/no-venue. Active fill resolves all nonterminal promotion roots.
4. Chỉ active outcome hiện venue + canonical obligation mới. Waitlisted chỉ queue position: chưa-refund rejoin có thể giữ historical aggregate, refunded không new lifecycle. Promotion re-derive rồi carry-over/append lifecycle khi activation. Mọi surface sync (FLOW 14).

> Slug/elink chỉ ghim context, **không** tự cấp quyền (AUDIT B2). Join có tiền/định danh nhạy cảm vẫn theo khoá mạnh (AUDIT C2).

---

## FLOW 14: SYNC ĐA SURFACE — web ⇄ kênh *(P4)*

**Nguyên tắc:** PostgreSQL + domain model = **canonical store**; web và các kênh là surface. Một action ở bất kỳ đâu → nhất quán mọi nơi.

1. Action ở 1 surface (host tạo kèo trên **web**; player **join trên Zalo/Messenger**; host sửa roster trên **web/bot**) → chuẩn hoá thành **command** (có `commandId`).
2. Command áp vào canonical store (tenantRepo + RLS) → ghi kèm **outbox event** (cùng transaction).
3. **Dispatcher** đẩy event → **projectors** fan-out:
   - Zalo: DM/message theo exact bot/OA-scoped channel identity/reachability; target-tenant eligibility kiểm tra riêng.
   - Messenger: one-route delivery tới tenant Page reachable, fallback central Page reachable; ngoài policy window dồn web + Zalo.
   - Web: **push SSE** (`tenant:<id>` cho host, `person:<id>` cho player).
   - Marketplace: upsert/xoá `public_sessions` nếu kèo **public và `open`** (FLOW 2 bước 2) — `draft` dù public chưa chiếu.
4. **Idempotent** (`commandId` + `event.id`); surface lệch (msg cũ/SSE rớt) → **re-project** dựng lại từ canonical.

> Surface **không bao giờ** giữ sự thật → không có conflict multi-master. Độ trễ mục tiêu p95 ≤ 3 giây, p99 ≤ 10 giây. Xác nhận đã trả (FLOW 8) là projection của event `payment.settled`.

---

## FLOW 15: CHAT IN-APP + CÀI ĐẶT HỒ SƠ — *(P4, DD-38 ✅ / DD-39 ✅ scope-committed phase-1)*

> **DD-38/DD-39 scope-committed phase-1** (đã chốt hướng). **Schema chưa vào canonical** `packages/db/schema.ts` — `chat_*` + cột `person.gender/dob/username/language` là **migration còn chờ** (nguồn authoritative vẫn là schema.ts + migrations). Nguồn: `../standards/decisions.md` (DD-38 chat, DD-39 giá theo giới tính) + doc Draft `../features/feature_inapp_chat.md`, `../features/feature_user_settings.md`.

- **Chat in-app (DD-38/55 ✅):** chat **toàn CLB** (member trong tenant, RLS) + chat **riêng 1-1** (person ↔ person, person-self); **chỉ sống trong Plexco**, **không bridge** ra group Zalo/Messenger. DM request/create/send/read đều qua một safety core fail-closed (block/report/rate-limit/audit); User Settings/social tái dùng canonical `chat_blocks`. Realtime SSE (DD-07).
- **Cài đặt hồ sơ + giá theo giới tính (DD-39 ✅):** người dùng đặt **giới tính / ngày sinh / tên / username / ngôn ngữ**; host đặt **giá nam/nữ** cho kèo, hệ suy `charge` theo `person.gender`. Giới tính/ngày sinh là **PII có consent, không lộ public**.

---

# 4. EDGE CASES

## 4.1 Payment

| # | Edge case | Hành vi hệ thống | Canonical phase |
|---|---|---|---|
| 1 | **2 buổi đồng giá cùng ngày, cùng player** | Biết ai, **không pin được buổi** → FIFO allocation (net đúng); cần chính xác → VietQR-per-session | P3 |
| 2 | **Trả hộ / 1 CK cho nhiều người** | Số tiền nhập nhằng → `/unmatched`; owner tạo nhiều `payment_allocations`, tổng không vượt CK; **không tự đoán** | P3 |
| 3 | **CK sai/thiếu nội dung** | Lưu unmatched + retry cron 1h + fallback owner (mark-paid thủ công) | P3 |
| 4 | **Trả dư / trả thiếu** | Allocation phần đã xác định; charge chỉ paid khi phủ đủ; số dư chưa phân bổ được flag cho owner | P3 |
| 5 | **Webhook trùng (cùng external_id)** | Idempotent `UNIQUE(tenant_id, provider, external_id)` + `ON CONFLICT DO NOTHING` | P3 |
| 6 | **CK thiếu id từ provider** | Sinh id tổng hợp `sha256(provider\|acct\|amount\|date\|content)` → vẫn idempotent + unmatched | P3 |
| 7 | **Hủy buổi khi có CK** | Platform không giữ tiền → owner hoàn tiền tay; log refund | P2 |
| 7b | **Mark-paid thủ công trùng/nhầm** | markPaid idempotent theo (charge, membership); sửa bằng reversal có audit, không xoá allocation gốc (DD-40) | P2 |

## 4.2 Identity & Routing

| # | Edge case | Hành vi | Canonical phase |
|---|---|---|---|
| 8 | **Host/player thuộc >1 CLB (web/Messenger)** | Zalo token pin club; Messenger central/ambiguous context hiện bounded server picker, một eligible tenant auto-select; tenant Page chỉ default | P2/P4.5 |
| 9 | **Membership trùng do race (Zalo join trước khi link Messenger)** | cờ nghi-trùng + tool owner merge (reconcile gộp nợ) | P3.5 |
| 10 | **Claim membership có tiền theo tên** | Cấm auto → yêu cầu owner/CK/mã link | P3.5 |
| 11 | **Mã link bị đoán/brute-force** | `link_code` entropy cao + hash-at-rest + TTL/purpose + attempts/rate-limit + atomic single-use + xác nhận | P3.5 |
| 12 | **Context trỏ club player không còn là member** | fail-closed → bỏ context → picker | P4.5 |
| 13 | **Zalo `message.unsupported.received`** (user nhóm bảo vệ) | không nhận nội dung → fallback owner xử tay | P4.7 |

## 4.3 Tenant / Bảo mật

| # | Edge case | Hành vi | Canonical phase |
|---|---|---|---|
| 14 | **Webhook sai token/secret/số TK** | 401/409 từ chối; vẫn lưu raw payload, không log secret | P3 |
| 15 | **Zalo bot token / Page token bị lộ** | `getWebhookInfo`-drift detection → alert + auto-reset; kill-switch reset token (AUDIT §B2) | P4.7 |
| 16 | **Lệnh admin gửi trong kênh bởi non-admin** | Phân quyền theo `from.id` (`TenantAdmin`), không theo chat | P2 |
| 17 | **Tenant suspended** | Chặn lệnh nhưng vẫn nhận & lưu CK player | P5 |
| 18 | **Truy vấn quên scope tenant** | RLS fail-closed → 0 dòng (không lộ) | P1 |

## 4.4 Auth & Hạ tầng

| # | Edge case | Hành vi | Canonical phase |
|---|---|---|---|
| 19 | **Cron nhắc 1k CLB cùng giờ** | throttler + rải giờ (jitter) + hàng đợi | P3 |
| 20 | **Phiên Google/email hết hạn / magic-link Zalo-Messenger hết hạn** | yêu cầu đăng nhập lại | P4 |
| 21 | **DM player chưa từng nhắn bot / ngoài cửa sổ 24h Messenger** | `canDm=false` hoặc quá 24h → fallback **web + Zalo**; vào bản tổng hợp owner | P4.5/4.7 |

## 4.5 Discovery / Marketplace / Sync

| # | Edge case | Hành vi | Canonical phase |
|---|---|---|---|
| 22 | **Kèo public bị sửa/đóng/huỷ** | Projector upsert/xoá `public_sessions`; đóng/quá giờ → tự hạ khỏi marketplace | P4.3 |
| 23 | **Join khi vừa hết slot (race)** | Session lock → một first-entry active+charge, người còn lại first-entry waitlisted/positive-position/no-charge; proven DD-49 rejoin giữ aggregate nhưng không tạo charge mới; không over-fill | P4.3 |
| 24 | **Approval-mode: host không duyệt** | `join_requests` hết hạn → tự huỷ + báo player; player có thể tìm kèo khác | P4.3 |
| 25 | **Scrape/enumerate marketplace** | Rate-limit + phân trang + chỉ field whitelist; không trả tiền/PII/giới tính dù lặp request | P4.3 |
| 26 | **Vị trí riêng tư** | Public chỉ `area`; `venue` chỉ cho `players.status='active'`, không cho approved-waitlisted (OD-6) | P4.3 |
| 27 | **Sync: 2 surface sửa gần như đồng thời** | Command serialize ở canonical store (transaction) per-tenant/session; event theo thứ tự → không lệch | P4 |
| 28 | **Surface state cũ** (msg roster lỗi thời / SSE rớt) | Re-project từ canonical (edit lại msg / refresh SSE); surface không giữ sự thật | P4 |
| 29 | **Command lặp** (retry kênh) | Idempotent theo `commandId` → `STALE_COMMAND` bỏ qua, không double | P4 |
| 30 | **Kèo môn lạ / chưa có trong `sports`** | Chỉ chọn môn từ danh sách `sports` active; không tự do nhập | P1 |

---

# END OF DOCUMENT
