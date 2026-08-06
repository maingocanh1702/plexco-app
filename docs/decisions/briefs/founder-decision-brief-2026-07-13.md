# 📋 Founder Decision Brief — Plexco

> ⚠️ **Historical snapshot — superseded bởi `docs/standards/decisions.md` hiện hành (v1.34).** DD-02/05/06/08/32/41–46 đã chốt; DD-47/48 chốt framework; DD-04 đã chốt (c) DO co-locate. Không dùng status trong body bên dưới làm authority hiện hành.
>
> **Mục đích:** gom mọi quyết định đang chờ founder để **mở khoá tiến độ**. Mỗi mục: bối cảnh · phương án · khuyến nghị · hệ quả nếu trì hoãn.
> **Nguồn:** `docs/standards/decisions.md` v1.19 · `ROADMAP` v2.5 · `HANDOFF` (2026-07-13). Trạng thái code: `main@1eb6f60`, ~20% (foundation + Auth v3 Telegram-era đã land; feature layer chưa build).
> **Ngày:** 2026-07-13.

**Cách dùng:** đọc từ trên xuống. Nhóm 🔴 chốt trong tuần này để không kẹt P0–P1 / P2–P3. Nhóm 🟡 chốt theo cụm (cùng đợt migration). Nhóm 🟢/⚪ có thể để sau.

---

## 🔴 NHÓM 1 — Chặn ngay (chốt tuần này)

### DD-04 · Hosting PostgreSQL — Neon vs Supabase — *P0*
- **Đã chốt:** Managed Postgres HA + PITR, region Singapore. Railway chỉ dev/staging.
- **Còn lại 2 lựa chọn:**
  - **Neon** — branching hợp CI migration gate; **nhưng** scale-to-zero xung đột `pg-boss` → phải tắt autosuspend.
  - **Supabase** — RLS-native, có sẵn Supavisor pooler.
- **Khuyến nghị:** cân giữa (a) giá trị branching cho CI vs (b) độ khớp RLS/pooler sẵn có. Nếu ưu tiên vận hành đường tiền ổn định (pooler + RLS native) → **Supabase**; nếu ưu tiên migration-gate qua branch → **Neon (tắt autosuspend)**.
- **Nếu trì hoãn:** chưa dựng được infra staging/prod thật → chặn mọi thứ cần DB có HA/PITR; RPO/RTO không chốt được.
- **Cần founder:** chọn provider.

### DD-08 · Danh sách môn khởi điểm + taxonomy trình độ — *P0* — ⬜ Mở
- **Bối cảnh:** `sport` là chiều dữ liệu của mọi kèo; cần chốt môn ban đầu + thang trình độ chuẩn hoá. Gợi ý: cầu lông (beachhead), pickleball, tennis…
- **Liên đới:** thang "level" này cũng là nguồn cho **DD-41** (level gating) và **DD-43** (nhãn theo level) — phải một nguồn duy nhất.
- **Khuyến nghị:** chốt tối thiểu **cầu lông** + thang level (vd 1–8 hoặc beginner/intermediate/advanced) để seed schema P0; thêm môn sau qua data.
- **Nếu trì hoãn:** kẹt seed schema đa môn (P0) + filter discovery; DD-41/DD-43 cũng treo theo.
- **Cần founder:** danh sách môn Day-1 + định nghĩa thang trình độ.

### DD-02 · Format `pay_code` (lưu trần, hiển thị có prefix) — *P3*
- **Đề xuất:** lưu code **trần** trong DB; hiển thị kèm prefix CLB (vd `BMC-xxxx`). Parser webhook strip prefix trước khi match.
- **Còn lại:** chốt **format prefix cuối cùng** (độ dài, ký tự, per-club ra sao).
- **Khuyến nghị:** duyệt đề xuất; chỉ cần chốt quy ước prefix.
- **Nếu trì hoãn:** chặn build payment ledger + parser đối soát (P3).
- **Cần founder:** OK đề xuất + quy ước prefix.

### DD-33 · Facebook Login / Messenger account-link — *P2.5, phase-1* — 🟡
- **Bối cảnh:** Messenger là kênh MVP (DD-37); feature-4 cần "link Plexco account ↔ Facebook". FB Login = provider `account_identities.platform='facebook'`.
- **Rào ngoài tầm kiểm soát:** phụ thuộc **FB Business Verification / App Review** (có lead time dài, rủi ro lịch — §13 BRD Risks).
- **Cần chốt:** (1) bật FB Login như provider; (2) xác nhận trạng thái App Review/Business Verification; (3) cơ chế link FB-Login (web-auth) ↔ Messenger PSID (page-scoped) về cùng `person` — **không** auto-link chéo.
- **Khuyến nghị:** **khởi động App Review NGAY** (song song việc code) vì đây là đường dài nhất; nếu chậm → degrade sang OTP `/link` thủ công.
- **Nếu trì hoãn:** Messenger phase-1 (P2.5) trượt lịch; phễu booking Facebook (DD-32) không có linked-state.
- **Cần founder:** duyệt bật provider + **kick off App Review**.

> ℹ️ **Không phải quyết định — chỉ là việc chưa code:** DD-37/DD-13 (Google + email/password) đã **CHỐT** (2026-07-10). Residual = swap provider Telegram-era → Google/email + audit SI-1..SI-8 trên main. DD-40 (mark-paid thủ công) đã **CHỐT**, chỉ còn 1 impl-gap kỹ thuật (host-attested "đã CK" khi chưa có `bank_transaction`) — không cần founder.

---

## 🟡 NHÓM 2 — Cụm "session model" (chốt theo lô, cùng đợt migration) — *P2/P4*

> Cả cụm này đụng schema `sessions`/`players`/`memberships` + public whitelist. Chốt cùng lúc để **không** phải migration nhiều đợt. Batch từ session 2026-07-11 (đối chiếu 2 app tham khảo).

### DD-46 · Kèo không thuộc CLB (Skip Club / personal meet) — ⬜ Mở — **QUYẾT ĐỊNH KIẾN TRÚC**
- **Vấn đề:** `sessions.tenant_id` **NOT NULL** là bất biến HR1 (mọi session qua choke-point RLS theo tenant). Session không tenant = **không có RLS** (ai own? tiền thế nào?) → đụng thẳng 5 HARD RULES.
- **Phương án:**
  - **A. Không hỗ trợ** kèo không-CLB trong MVP (giữ invariant nguyên).
  - **B. "Personal tenant"** — mỗi host một tenant cá nhân nhẹ → giữ invariant, nhưng ảnh hưởng onboarding/billing/identity.
- **Khuyến nghị:** **A cho MVP** (đơn giản, không phá HR1); cân nhắc B ở phase sau nếu có nhu cầu thật. Phải chốt **trước** khi viết bất kỳ spec/schema nào cho việc này.
- **Nếu trì hoãn:** không chặn các DD khác (giữ ⬜, không implement) — nhưng nếu định làm B thì đây là thay đổi lớn cần biết sớm.
- **Cần founder:** chọn A hay B (hoặc hoãn công khai).

### DD-41 · Field mô tả + gating cho `sessions` — 🟡
- **Bối cảnh:** `sessions` hiện **không** có `title`/`notes`, chỉ 1 field `skill_level` text (không enforce). App đối thủ có Meet name, notes, session_type, level min/max strict, gender/age restriction, BYOE/cost-shared.
- **Đề xuất:** thêm nhóm field **mô tả** (`title`, `notes`, `session_type` enum, `byoe`/`cost_shared`/`instructions`) + **gating enforce ở đường JOIN** (`level_min`/`level_max`/`level_strict`, `gender_restriction`, `age_group`).
- **Lưu ý:** gender ở đây = **điều kiện JOIN**, khác gender-based **PRICING** (DD-39) — độc lập, một session có thể có cả hai.
- **Khuyến nghị:** duyệt; taxonomy `session_type` chốt chung với DD-08.
- **Nếu trì hoãn:** thiếu parity mô tả/targeting; discovery lọc kém.

### DD-45 · Model hoá waitlist (đóng gap SES-UC-9) — 🟡
- **Bối cảnh:** spec đã Reviewed (SES-UC-9) hứa "leave → slot freed, waitlist auto-promote", nhưng `players.status` chỉ `active|left` — **chưa** model waitlist.
- **Đề xuất:** thêm `waitlisted` + thứ tự; auto-promote **trong cùng transaction** (dùng `FOR UPDATE`) để không over-fill.
- **Khuyến nghị:** duyệt — đây là đóng gap giữa spec và data model, nhu cầu thật khi kèo full.
- **Nếu trì hoãn:** spec SES-UC-9 không thực thi được.

### DD-42 · No-show / attendance / reliability — 🟡
- **Đề xuất:** subsystem **riêng** — `attendance` trên `players`, reliability tổng hợp trên `memberships`, policy per-tenant (deprioritize/ban). **Tenant-scoped (RLS), không ra public.**
- **Cần chốt:** reliability **per-tenant** (đề xuất — khớp RLS, không lộ hành vi xuyên CLB) hay cross-tenant.
- **Khuyến nghị:** **per-tenant** (an toàn HR2). Đây là điểm mạnh của bot cũ (giảm no-show phá kèo).
- **Nếu trì hoãn:** không chặn MVP tối thiểu, nhưng mất giá trị vận hành; DD-45 waitlist ordering đọc reliability nên nên chốt cùng.

### DD-43 · Nhãn/hạng thành viên + audience targeting — 🟡
- **Đề xuất:** nhãn/hạng thành viên **per-tenant** do host tự định nghĩa (`membership_tags`/`tier`); khi announce kèo chọn audience theo tag/tier. Là **targeting**, không phải field của `sessions`. **Public không lộ tag nội bộ.**
- **Khuyến nghị:** duyệt; phần "level" thống nhất một nguồn với DD-08.
- **Nếu trì hoãn:** host không điều phối kèo theo nhóm (VIP/supporter/level) — parity thấp hơn đối thủ, nhưng không chặn.

### DD-44 · Invite-link token cho kèo private — 🟡
- **Đề xuất:** `session_invite_tokens` (hash, `expires_at`, `max_uses`); ai có link mở trang join kèo **private**, vẫn qua `join_policy` + gating. Token = cách **mời**, **không** hạ `visibility`.
- **Khuyến nghị:** duyệt — use case "mời nhóm riêng qua link" phổ biến.
- **Nếu trì hoãn:** kèo private chỉ ẩn khỏi marketplace, chưa có đường mời qua link.

### DD-47 · Social follow graph (person↔person) — 🟡 — *P4+*
- **Đề xuất:** bảng **global** `person_follows` (cạnh có hướng, `pending/accepted`), authz ở app choke-point (global plane không RLS). Auto-accept khi followee public / approve khi private. **KHÔNG** cấp quyền tiền/PII/roster — chỉ mở profile view non-PII (DD-48).
- **Khuyến nghị:** duyệt nếu feature user-settings vào phase-1; nếu không → hoãn sang P4+.
- **Nếu trì hoãn:** `feature_user_settings` (follow) không build được.

### DD-48 · Profile visibility (public/private) — 🟡 — *P4+*
- **Đề xuất:** `persons.profile_visibility` default **`public`** (owner đã chốt 2026-07-11, hợp acquisition-first DD-29); profile read cross-user field-whitelist non-PII; gating fail-closed. Private ẩn cả đồng đội cùng CLB (trừ host vận hành). **Không** nới RLS, **không** đụng đường tiền.
- **Còn 5 open item chờ chốt:** (1) tập "stats" + có aggregate cross-tenant không; (2) follower-count/following-list của user private có ẩn không; (3) private có ảnh hưởng DM in-app (DD-38) không; (4) có cần cơ chế **block** không; (5) trong session chung, đồng đội thấy tên tới mức nào.
- **Khuyến nghị:** duyệt khung; chốt 5 open item khi build user-settings.
- **Nếu trì hoãn:** đi kèm DD-47.

---

## 🟢 NHÓM 3 — Phase sau (P4.3+), chưa chặn hiện tại

| DD | Nội dung | Cần chốt | Ghi chú |
|---|---|---|---|
| **DD-05** | Join cross-club: open vs approval | Duyệt đề xuất: per-kèo, default **open**, host bật approval | P4.3 |
| **DD-06** | Độ chi tiết vị trí public | Duyệt: public chỉ **khu vực/quận**, lộ venue sau khi join/duyệt | P4.3 |
| **DD-32** | Booking funnel (link→book-in-chat→app) | Chọn **A/B/C** (khuyến nghị A) + định nghĩa "linked" + thứ tự bật DD-33/DD-14 | Mặc định **phễu MỀM** — không siết guest-join tới khi chốt |
| **DD-14** | Zalo Login gating (OA registration chặn?) | **Xác minh với Zalo** (external) | P4+ |
| **DD-15** | Zalo Bot `from.id` ổn định xuyên bot? | **Xác minh với Zalo** (external) | P4+ |

---

## ⚪ NHÓM 4 — Post-MVP (P7, Club AI Assistant) — không chặn build MVP

| DD | Nội dung | Trạng thái |
|---|---|---|
| **DD-18** | Provider embedding/LLM + review privacy/ToS/DPA | ⬜ — **chặn GO-LIVE trợ lý**, KHÔNG chặn build (interface swappable) |
| **DD-34** | Plexco Global KB plane + union retrieval | 🟡 |
| **DD-35** | Auto-derive KB-club từ canonical | 🟡 |
| **DD-36** | Freshness: scheduled re-crawl + re-ingest | 🟡 |

---

## ✅ Thứ tự đề xuất để unblock

1. **DD-04** (hosting) — mở khoá infra thật.
2. **DD-08** (môn + level) — mở khoá seed schema P0 + kéo theo DD-41/DD-43.
3. **DD-33** — **kick off App Review ngay** (lead time ngoài).
4. **Cụm session model** (DD-41/45/42/43/44 + DD-46) — chốt theo lô để migration một đợt; ưu tiên **DD-46** vì đụng invariant RLS.
5. **DD-02** (pay_code) — trước khi build ledger P3.
6. DD-47/48 khi user-settings vào scope; nhóm 🟢/⚪ để sau.
