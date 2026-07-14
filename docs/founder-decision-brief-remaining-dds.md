# 📋 Founder Decision Brief — Các DD còn treo (hợp nhất)

> **Mục đích:** đưa MỌI decision đang chờ founder (trừ DD-04 đã có brief riêng) về trạng thái **quyết-định-được**. Mỗi DD: bối cảnh · phương án · khuyến nghị · hệ quả · **cần founder gì**.
> **Ngày:** 2026-07-13 · **Nguồn:** `docs/standards/decisions.md` v1.20 (bản canonical — brief này KHÔNG thay thế, chỉ tóm tắt để quyết). DD-04 → xem `dd-04-hosting-decision-brief.md`.
> **Quy ước:** các DD 🟡 phần lớn đã có phương án đề xuất trong decisions.md; "duyệt" nghĩa là chuyển 🟡→✅ để mở khoá build. ⬜ = chưa có đề xuất, cần founder định hướng.

---

## 🔴 NHÓM 1 — Blocker gần (chốt sớm)

### DD-08 · Môn khởi điểm + taxonomy trình độ — ✅ CHỐT (2026-07-13) — *P0*
- **Quyết định (owner):**
  1. **Môn seed:** badminton, pickleball, tennis, padel, volleyball, basketball, football — extensible (thêm môn sau qua bảng `sports`, thêm hàng, không enum).
  2. **Level (5 bậc, ordered):** beginner < intermediate < upper_intermediate < advanced < professional.
- **Biểu diễn:** `sports` đã là bảng dữ liệu (`key`/`name`/`active`) → extensible sẵn. Level cần **rank số 1..5** cho gating DD-41 → lookup `skill_levels(key,label,rank)` thay `sessions.skill_level` text (migration đi cùng DD-41). Một nguồn level cho DD-41/DD-43.
- **Ghi canonical:** `decisions.md` DD-08 → ✅ + changelog v1.21.

### DD-02 · Format `pay_code` — 🟡 Đề xuất — *P3*
- **Bối cảnh:** mã đối soát CK cần dễ đọc cho player nhưng match bền ở backend. Đề xuất: **lưu trần** trong DB; **hiển thị** kèm prefix CLB (vd `BMC-xxxx`); parser webhook strip prefix trước khi match.
- **Còn lại:** chốt **format prefix cuối cùng** (độ dài, ký tự, per-club).
- **Khuyến nghị:** duyệt đề xuất; format cụ thể: `<CLUB>-<base32 5–6 ký tự>` (bỏ ký tự dễ nhầm 0/O/1/I); parser chấp nhận cả có/không prefix + chuẩn hoá hoa-thường.
- **Hệ quả:** chặn build payment ledger + parser đối soát (P3) nếu chưa chốt.
- **Cần founder:** OK đề xuất + duyệt quy ước prefix.

### DD-33 · Facebook Login / Messenger account-link — 🟡 (phase-1) — *P2.5*
- **Bối cảnh:** Messenger là kênh MVP (DD-37); feature-4 cần link Plexco↔Facebook. FB Login = provider `account_identities.platform='facebook'`. FB Login (web-auth) và Messenger PSID (page-scoped) là **hai subject khác nhau** → cần link (OTP/verified) về cùng `person`, **không** auto-link chéo.
- **Rào ngoài tầm kiểm soát:** phụ thuộc **FB Business Verification / App Review** (lead time dài, rủi ro lịch §13 BRD).
- **Khuyến nghị:** duyệt là phase-1 + **khởi động App Review NGAY** (song song code). Nếu App Review chậm → degrade sang OTP `/link` thủ công.
- **Hệ quả:** là đường tạo linked-state Facebook cho DD-32; chốt → cập nhật `identity-model §7` + `feature_web_auth_onboarding` + align SI-1/SI-2.
- **Cần founder:** duyệt provider + **kick off App Review**.

---

## 🟡 NHÓM 2 — Cụm session-model (chốt theo lô → migration một đợt)

> Cả cụm đụng schema `sessions`/`players`/`memberships` + public whitelist. **DD-46 phải chốt trước** vì đụng invariant `tenant_id NOT NULL`.

### DD-46 · Kèo không thuộc CLB (Skip Club / personal meet) — ⬜ Mở — **kiến trúc, chốt TRƯỚC cụm**
- **Bối cảnh:** app đối thủ có "Skip Club"/tạo kèo không cần club. Plexco: `sessions.tenant_id NOT NULL` là bất biến HR1 (mọi session qua choke-point RLS). Session không tenant = **không có RLS** (ai own? tiền thế nào?) → đụng thẳng 5 HARD RULES.
- **Phương án:** (A) **không hỗ trợ** kèo không-CLB trong MVP (giữ invariant); (B) **"personal tenant"** — mỗi host một tenant cá nhân nhẹ (giữ invariant nhưng ảnh hưởng onboarding/billing/identity).
- **Khuyến nghị:** **(A) cho MVP** — đơn giản, không phá HR1; cân nhắc (B) phase sau nếu có nhu cầu thật.
- **Cần founder:** chọn A/B (hoặc hoãn công khai) — **trước** khi viết schema cụm session-model.

### DD-41 · Field mô tả + gating cho `sessions` — 🟡
- **Bối cảnh:** `sessions` thiếu `title`/`notes`, chỉ 1 `skill_level` text không enforce. Đề xuất thêm **mô tả** (`title`,`notes`,`session_type` enum,`byoe`/`cost_shared`/`instructions`) + **gating enforce ở đường JOIN** (`level_min/max/strict`,`gender_restriction`,`age_group`). Gender ở đây = **điều kiện JOIN**, khác gender **PRICING** (DD-39).
- **Khuyến nghị:** duyệt; taxonomy `session_type` chốt chung DD-08.
- **Cần founder:** duyệt (mở khoá parity mô tả/targeting + filter discovery).

### DD-45 · Model hoá waitlist (đóng gap SES-UC-9) — 🟡
- **Bối cảnh:** spec Reviewed SES-UC-9 hứa "leave → slot freed, waitlist auto-promote" nhưng `players.status` chỉ `active|left`. Đề xuất thêm `waitlisted` + thứ tự; auto-promote **trong cùng transaction** (`FOR UPDATE`) để không over-fill.
- **Khuyến nghị:** duyệt — đóng gap spec↔data model, nhu cầu thật khi kèo full.
- **Cần founder:** duyệt.

### DD-42 · No-show / attendance / reliability — 🟡
- **Bối cảnh:** đề xuất subsystem **riêng**: `attendance` trên `players`, reliability tổng hợp trên `memberships`, policy per-tenant (deprioritize/ban). **Tenant-scoped (RLS), KHÔNG ra public.**
- **Cần chốt:** reliability **per-tenant** (đề xuất — khớp RLS, không lộ hành vi xuyên CLB) hay cross-tenant.
- **Khuyến nghị:** duyệt + **per-tenant** (an toàn HR2). Điểm mạnh của bot cũ (giảm no-show phá kèo). Chốt cùng DD-45 (waitlist ordering đọc reliability).
- **Cần founder:** duyệt + xác nhận per-tenant.

### DD-43 · Nhãn/hạng thành viên + audience targeting — 🟡
- **Bối cảnh:** đề xuất nhãn/hạng thành viên **per-tenant** host tự định nghĩa (`membership_tags`/`tier`); announce kèo chọn audience theo tag/tier. Là **targeting**, không phải field `sessions`. **Public không lộ tag nội bộ.** Phần "level" thống nhất một nguồn với DD-08.
- **Khuyến nghị:** duyệt.
- **Cần founder:** duyệt (parity điều phối kèo theo nhóm VIP/supporter/level).

### DD-44 · Invite-link token cho kèo private — 🟡
- **Bối cảnh:** đề xuất `session_invite_tokens` (hash,`expires_at`,`max_uses`); ai có link mở trang join kèo **private**, vẫn qua `join_policy` + gating. Token = cách **mời**, **không** hạ `visibility`.
- **Khuyến nghị:** duyệt — use case "mời nhóm riêng qua link" phổ biến.
- **Cần founder:** duyệt.

### DD-47 · Social follow graph (person↔person) — 🟡 — *P4+*
- **Bối cảnh:** `feature_user_settings` cần follow giữa user. Đề xuất bảng **global** `person_follows` (cạnh có hướng, `pending/accepted`), authz ở app choke-point (global plane không RLS), auto-accept khi followee public / approve khi private. **KHÔNG** cấp quyền tiền/PII/roster — chỉ mở profile view non-PII (DD-48).
- **Khuyến nghị:** duyệt **nếu** user-settings vào phase-1; nếu không → hoãn P4+.
- **Cần founder:** duyệt khung + xác nhận user-settings có trong scope gần không.

### DD-48 · Profile visibility (public/private) — 🟡 — *P4+*
- **Bối cảnh:** đề xuất `persons.profile_visibility` default **public** (owner đã chốt); profile read cross-user field-whitelist non-PII; gating fail-closed; private ẩn cả đồng đội cùng CLB (trừ host vận hành). **Không** nới RLS, không đụng tiền.
- **5 open item chờ chốt:** (1) tập "stats" + có aggregate cross-tenant không; (2) follower-count/following-list của private có ẩn không; (3) private ảnh hưởng DM in-app (DD-38) không; (4) có cần cơ chế **block** không; (5) trong session chung, đồng đội thấy tên tới mức nào.
- **Khuyến nghị:** duyệt khung; chốt 5 open item khi build user-settings (đi kèm DD-47).
- **Cần founder:** duyệt khung + có thể để 5 open item cho lúc build.

---

## 🟢 NHÓM 3 — Marketplace / phễu (P4.3+, chưa chặn)

### DD-05 · Join cross-club: open vs approval — 🟡
- **Đề xuất:** cấu hình **per-kèo**, mặc định **open**, host bật **approval**.
- **Khuyến nghị:** duyệt (cân tốc độ lấp slot vs kiểm soát host).
- **Cần founder:** duyệt.

### DD-06 · Độ chi tiết vị trí public — 🟡
- **Đề xuất:** public chỉ hiện **khu vực/quận**; lộ **venue chính xác** sau khi join/được duyệt.
- **Khuyến nghị:** duyệt (bảo vệ host/venue, vẫn đủ để player quyết định).
- **Cần founder:** duyệt.

### DD-32 · Booking funnel (link → book-in-chat → app) — 🟡
- **Bối cảnh:** proposal phễu tăng trưởng, **KHÔNG** phải gate chống gian lận. Mặc định khuyến nghị **phễu MỀM** (guest vẫn book).
- **Phương án:** (A) **phễu mềm** [khuyến nghị] — guest vẫn book, link chỉ mở thêm giá trị + CTA; (B) gate cứng toàn hệ (thu hẹp guest-join); (C) gate theo điều kiện (chỉ session có tiền cần link).
- **Khuyến nghị:** **(A)**. Định nghĩa "linked" = **OTP `/link` confirm là đủ** cho hook; **web-auth đầy đủ** chỉ bắt buộc ở **nhánh có tiền** (củng cố HR4/DD-01). Thứ tự bật social login: **DD-33 (FB) trước**, rồi DD-14 (Zalo).
- **Hệ quả:** phụ thuộc DD-33/DD-14; nếu chưa bật → tạm OTP `/link` thủ công. **KHÔNG** sửa spec Reviewed tới khi DD-32 ✅.
- **Cần founder:** chọn A/B/C + định nghĩa "linked" + thứ tự bật DD-33/DD-14.

---

## 🔵 NHÓM 4 — Cần xác minh bên ngoài (Zalo, P4+)

> Không phải quyết định nội bộ — là **việc xác minh với Zalo**, không chặn build vì `link_codes` đã bao ca xấu nhất.

### DD-14 · Zalo Login có bị chặn bởi cửa đăng ký OA không — ⬜
- **Cần xác minh** với developers.zalo.me: Zalo Login có buộc OA verified (đang pending) hay độc lập.
- **Hệ quả:** nếu độc lập → bật Zalo Login trước OA, làm cầu auto-match. Ảnh hưởng DD-32/link path (không phải DD-13).
- **Cần founder/dev:** giao 1 spike xác minh với Zalo.

### DD-15 · Zalo Bot `from.id` ổn định xuyên bot không — ⬜
- **Cần xác minh:** `from.id` là id toàn cục theo user Zalo hay scoped-per-bot (Messenger PSID đã xác nhận page-scoped).
- **Hệ quả:** ổn định xuyên bot → giảm số lần link; scoped → mỗi CLB link một lần. **Không chặn** (link_codes bao ca xấu nhất).
- **Cần founder/dev:** gộp vào spike DD-14.

---

## ⚪ NHÓM 5 — Post-MVP P7 (Club AI Assistant / KB) — không chặn build MVP

### DD-18 · Provider embedding/LLM + privacy/ToS — ⬜ (chặn GO-LIVE trợ lý, KHÔNG chặn build)
- **Bối cảnh:** chọn provider embedding + generation; phụ thuộc chất lượng tiếng Việt, chi phí/câu, độ trễ, **và privacy** (gửi doc nội bộ CLB tới LLM bên thứ 3 = xử lý dữ liệu tenant). Đã đặt sau interface `EmbeddingProvider`/`ChatProvider` swappable.
- **Khuyến nghị:** cho MVP trợ lý → **API hosted** (tốc độ) sau interface swappable; **review ToS/DPA/khu vực dữ liệu + công bố Privacy/ToS trước go-live** (P6). Provider cụ thể chốt sát P7.
- **Cần founder:** duyệt hướng (hosted-first, swappable) — quyết provider cụ thể + duyệt pháp lý để sau, trước go-live.

### DD-34 · Plexco Global KB plane + union retrieval — 🟡
- **Đề xuất:** plane **global** `platform_kb_*` (không `tenant_id`, role `app` chỉ SELECT), union `kb_chunks(tenant)` ∪ `platform_kb_chunks`, precedence club > platform. Guard nhiều lớp: source allowlist (platform-docs-only) + admin review + scanner PII/tenant-id.
- **Khuyến nghị:** duyệt như proposal P7 với các guard đã nêu; khi ✅ **phải patch DD-21** + Club Assistant specs.
- **Cần founder:** duyệt hướng (không gấp).

### DD-35 · Auto-derive KB-club từ canonical — 🟡
- **Đề xuất:** `kb_sources.kind='derived'`; field mô tả canonical đổi → command→outbox→projector dựng lại KB doc từ **field-whitelist** (tên/mô tả/nội quy/chính sách giá text/lịch/hướng dẫn). **CẤM** derive charges/memberships/persons/SĐT/pay_code. Precedence host-manual > derived.
- **Khuyến nghị:** duyệt như proposal P7.
- **Cần founder:** duyệt hướng (không gấp).

### DD-36 · Freshness: scheduled re-crawl + re-ingest KB-Plexco — 🟡
- **Đề xuất:** re-ingest KB-Plexco khi đổi tài liệu sản phẩm (change-detect `content_hash`); nguồn `url` re-crawl bằng **pg-boss cron** (so `source_etag`/`content_hash`, chỉ re-ingest khi đổi).
- **Khuyến nghị:** duyệt như proposal P7; chốt nguồn KB-Plexco (docs/ vs CMS) ở tech spec.
- **Cần founder:** duyệt hướng (không gấp).

---

## ✅ Thứ tự đề xuất unblock

1. **DD-08** (môn + level) — mở khoá seed P0 + kéo theo DD-41/DD-43.
2. **DD-46** (skip-club) — chốt trước, vì đụng invariant RLS của cả cụm session-model.
3. **Cụm session-model** DD-41/45/42/43/44 (+47/48 nếu user-settings vào scope) — duyệt theo lô → migration một đợt.
4. **DD-02** (pay_code) — trước khi build ledger P3.
5. **DD-33** — kick off App Review ngay (lead time ngoài).
6. **DD-32** + **DD-05/06** — khi tới P4.3.
7. **DD-14/15** — spike xác minh Zalo (P4+, không chặn).
8. **DD-18/34/35/36** — P7, duyệt hướng, chi tiết để sau.

> **Governance:** DD nào founder duyệt → cập nhật trạng thái 🟡→✅ trong `decisions.md` + changelog, và (nếu có) promote spec/schema theo checklist của DD đó. Brief này **không** tự chốt.

**Nguồn nội bộ:** `docs/standards/decisions.md` v1.20 · các proposal (`proposals/plexco-global-kb-and-kb-autosync.md`, `proposals/club-ai-bot-knowledge-base.md`) · feature docs liên quan. DD-04 hosting → `dd-04-hosting-decision-brief.md`.
