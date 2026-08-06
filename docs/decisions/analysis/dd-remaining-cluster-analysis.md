# 📦 Remaining DDs — Cluster Index + Quick-ref

> ✅ **2026-07-13: mỗi DD giờ có FILE CHI TIẾT riêng** (theo template DD-02/DD-41). Doc này = **index + quick-ref**; nguồn chi tiết:
> - DD-05 → `dd-05-join-policy-analysis.md` · DD-06 → `dd-06-location-granularity-analysis.md` · DD-32 → `dd-32-booking-funnel-analysis.md`
> - DD-42 → `dd-42-reliability-analysis.md` · DD-43 → `dd-43-membership-tags-analysis.md` · DD-44 → `dd-44-invite-token-analysis.md`
> - DD-45 → `dd-45-waitlist-analysis.md` · DD-47 → `dd-47-follow-graph-analysis.md` · DD-48 → `dd-48-profile-visibility-analysis.md`
> - **P7/External:** DD-18 → `dd-18-llm-provider-analysis.md` · DD-34/35/36 → `dd-34-36-kb-platform-analysis.md` · DD-14/15 → `dd-14-15-zalo-spike-analysis.md`
>
> **Mục đích:** chốt các DD còn lại ở **decision level** (contract + enforce point + money/PII-safety + dependency), ground vào canonical. Chi tiết SQL/tests → slice riêng khi build (pattern DD-46/41).
> **Ngày:** 2026-07-13 · **Re-check:** 2026-07-19 · **Owner decisions:** DD-32=**A (phễu mềm)**, DD-42=**per-tenant**, DD-47/48=**framework, build P4+**. Còn lại (05/06/43/44/45) = duyệt đề xuất; DD-49 supersedes DD-45 default rejoin reject.
> **Canonical:** `packages/db/schema.ts` + migrations · `feature_session_management` · `feature_cross_club_join` · `feature_marketplace_discovery` (whitelist) · DD-08/39/41/46/**49**. Ghi → `decisions.md`.
>
> **Supersession note (2026-07-28):** đây là quick-ref theo snapshot 13–19/07, không phải living
> implementation status. Dùng `decisions.md` cho authority và `HANDOFF.md`/`BUILD-STATUS.md`/`ROADMAP.md`
> cho live repo truth tại `main@784bc8d`.

---

## DD-05 — Join cross-club: open vs approval · ✅ (duyệt)
- **Canonical:** `sessions.join_policy` (`open|approval`); `join_requests` sẵn; final outcome theo capacity dưới lock (DD-45).
- **Chốt:** **per-session, mặc định `open`**; host bật `approval` từng kèo.
  - Resolve existing player/request trước: `active|waitlisted|pending` trả current outcome idempotently, không alert/write mới. Chỉ absent/`left` mới chạy DD-41/DD-42/shared DD-52. First-entry pending chỉ tạo `join_requests`; existing `left` request-create preflight live DD-49 disposition nhưng không persist proof. Không capacity/venue/financial mutation khi pending.
  - Approve dưới tenant RLS + lock session/root-job/request + **DD-41/DD-42/DD-52 re-check** và DD-49 re-derive. First-entry còn slot → active+exactly-one-charge; full → approved+waitlisted/no-charge. DD-49 rejoin active→carry-over/append-refunded; full→waitlisted giữ history/defer-refunded; unknown/restriction fail-closed giữ pending. Active fill resolves old promotion roots.
- **An toàn (sửa):** **CÓ** đụng state tiền + RLS — approve first-entry còn slot là money-write; first-entry full chỉ queue; proven rejoin phải resolve financial disposition trước khi tạo/giữ request và trước final mutation. First-entry pending chỉ có request; existing-`left` pending không tạo row/mutation mới và giữ nguyên aggregate lịch sử; unknown disposition không tạo request.

## DD-06 — Độ chi tiết vị trí public · ✅ (duyệt)
- **Canonical:** `sessions.area` + `venue_name`/`venue_address`; public whitelist emit **`area` only** (`feature_marketplace_discovery:87`).
- **Chốt:** public projector emit **`area` only**; venue details **chỉ lộ khi player active**. Pending/approved-waitlisted vẫn ẩn. **Invariant test:** venue không vào `public_sessions`.
- **An toàn:** privacy host/venue; đủ để player quyết định.

## DD-32 — Booking funnel · ✅ Option A (phễu MỀM)
- **Chốt (owner): A — phễu mềm.** Guest **vẫn book** — kể cả kèo có phí. First-entry active tạo exactly-one charge, full waitlisted/no-charge. DD-49 rejoin active→carry-over/append-refunded; full→waitlisted giữ history/defer-refunded. Link account chỉ mở giá trị + CTA; không bắt web-auth cho paid booking.
- **Tách rõ 3 việc (không lẫn):**
  1. **Tạo guest booking** → **được** theo A (không cần link); first-entry charge chỉ tạo khi guest active, không phải lúc waitlisted. Existing `left` theo DD-49, không duplicate charge.
  2. **Claim/merge một membership ĐÃ CÓ TIỀN** → đi nguyên **evidence matrix của `feature_identity`** (DD-01/DD-13: verified signal + conflict checks + confirmation/audit). **DD-26 chỉ là confirm-before-persist, KHÔNG tự nó là proof.** HR4 — **không** phải "web-auth cho booking".
  3. **"Linked" cho hook** = OTP `/link` confirmed đủ (lịch sử xuyên club, nhắc, magic-link).
- **Thứ tự bật social login:** DD-33 (FB) trước, rồi DD-14 (Zalo). Chưa bật → OTP `/link` thủ công.
- **⚠️ Nếu founder MUỐN paid-booking bắt buộc web-auth → đó là Option C, phải đổi quyết định** (hiện = A).

## DD-42 — No-show / attendance / reliability · ✅ per-tenant
- **Canonical:** `players.status` = active|left (không attendance); `memberships` không reliability.
- **Chốt (owner): subsystem RIÊNG, per-tenant (RLS, KHÔNG public):**
  - **Attendance** trên `players`: `attendance ∈ {present|no_show|excused|unknown}`, host mark sau buổi.
  - **Reliability** aggregate trên `memberships` (đếm no-show gần đây/score) — **per-tenant** (không lộ hành vi xuyên CLB, khớp RLS/HR2).
  - **Policy per-tenant** (setting): deprioritize (hạ waitlist DD-45) / ban N ngày (state có hạn trên membership; join-path check ban).
- **Tương tác:** DD-45 waitlist ordering đọc reliability. **An toàn:** tenant-scoped, không ra public.

## DD-43 — Nhãn/hạng thành viên + audience targeting · ✅ (duyệt)
- **Canonical:** `memberships` chỉ `status`+`pay_code`, không tier/tag.
- **Chốt — HAI contract RIÊNG (không gộp):**
  1. **Nhãn = `membership_tags` (many-to-many, per-tenant, host-defined)** — MVP chỉ dùng cho **NOTIFICATION AUDIENCE** khi announce (ai được **mời/thấy** announcement). *(Bỏ `membership_tier` khỏi MVP — chỉ thêm nếu có nhu cầu hạng thật; tránh 2 khái niệm.)*
  2. **Join eligibility** = **DD-41 gating** (level/gender/age) + `join_policy` (DD-05) — **KHÔNG** dùng tag để gate join ở MVP. "Join sớm" (early access theo tag) = **tách slice sau**, không MVP.
- **An toàn:** tenant-scoped RLS; **public projection KHÔNG lộ tag**. Level dùng chung DD-08 (rank), không nhân đôi.

## DD-44 — Invite-link token cho kèo private · ✅ (duyệt)
- **Canonical:** `visibility`+`join_policy`+`join_requests` có; thiếu token share.
- **Chốt — token + REDEMPTION contract:**
  - `session_invite_tokens` (tenant-scoped): **token = random entropy cao (≥128-bit)**, lưu **hash** (không lưu raw); **bound `session_id`+`tenant_id`**; `expires_at`, `max_uses`, `used_count`, `revoked_at` (revoke/rotate được).
  - Mở link → trang join kèo **private**, **vẫn qua `join_policy` + DD-41/DD-42/shared DD-52**. Token = **MỜI**, không hạ `visibility`.
  - Redeem lock `session→token`: validate hash/binding/expiry/revoke, rồi resolve exact replay/current `active|waitlisted|pending` trước dynamic gates. Current/replay không consume thêm; `max_uses` + restrictions chỉ gate absent/`left` transition mới. **`used_count` tăng atomic cùng transition thành công**; restriction/unknown → zero request/player/charge/token/host-alert mutation.
- **An toàn:** venue/PII ẩn tới active outcome (DD-06); rate-limit/anti-scrape; test hết hạn / quá `max_uses` transition mới / current replay không extra use / revoked / current-ban / race lượt cuối / không lộ tiền-PII.

## DD-45 — Model hoá waitlist (đóng gap SES-UC-9) · ✅ (duyệt)
- **Canonical state:** `main`/`origin/main`@`22c23aa` vẫn chỉ `active|left`; `0014_players_waitlist` land tại `1a6ac38` trên feature branch nhưng chưa merge. Schema branch có `waitlisted` + positive `waitlist_position`; behavior chưa build.
- **Chốt — lifecycle + ordering PIN:**
  - Mở `players_status_chk` **+ `waitlisted`**. First-entry waitlisted KHÔNG chiếm capacity, KHÔNG tạo charge, KHÔNG lộ venue. DD-49 rejoin-waitlisted chưa-refund giữ canonical history; refunded defer lifecycle/nợ mới tới activation.
  - **Open/approval first-entry full cùng tạo waitlisted**. Promotion first-activation assert no charge + derive amount rồi tạo exactly-one charge. DD-49 rejoin promotion re-derive; chưa-refund carry-over, refunded append chỉ atomic với activation; không charge row thứ hai.
  - **DD-39 derivation failure:** giữ candidate waitlisted/no-new-charge/no-venue; first failure lazy-creates one root promotion job `(tenant,session,origin)` rồi emit exactly-one candidate event bound `promotion_retry_id`+`waitlist_entry_version`+root `origin_command_id`, tiếp tục queue. Root CAS/lease job owns max 3 claimed attempts; each completed sweep visits each candidate once, sibling events share budget; DD-41/DD-42/DD-52 + financial state revalidated. Expired final claim finalizes under `session→job` to resolved-or-terminal without derivation/attempt 4; owner digest dedupes per root.
  - **Một ordering duy nhất:** `waitlist_position, joined_at, id`; position dương + state-shape CHECK; deprioritize (DD-42) chuyển xuống tail dưới session lock.
  - **Candidate fail eligibility DD-41, DD-42 restriction hoặc manual ban DD-52 lúc promote/retry:** **skip → promote người kế tiếp**; candidate bị skip **giữ trong waitlist** (không remove) trừ khi họ tự leave.
  - Active leave/capacity increase fill toàn bộ `slots_max-active_count`; finite→NULL promote mọi eligible. Capacity decrease không promote/evict và dưới active roster → `CAPACITY_BELOW_ROSTER`.
  - Existing `active|waitlisted` join lại idempotent; existing `left` chạy DD-49 correction core. Active→carry-over hoặc append-refunded; full→waitlisted giữ history hoặc defer-refunded. Chỉ unknown/unimplemented → `REJOIN_REQUIRES_REVIEW`.
  - Promote → notify (`feature_notifications_reminders`).
- **An toàn:** atomic + idempotent; test total order/không over-fill/capacity, active-vs-full refunded timing, stale entry, two-worker CAS, lease crash recovery, max-3 terminal retry. Exactly-one-charge chỉ cho first-activation; rejoin không duplicate charge row.

## DD-47 — Social follow graph (person↔person) · ✅ framework (build P4+)
- **Chốt (owner): duyệt framework, build P4+.** Bảng **GLOBAL `person_follows`** (cạnh có hướng, **KHÔNG `tenant_id`** — identity global plane, §P6).
  - **⚠️ Security boundary = GLOBAL PROTECTED (như `persons`/`accounts`/`link_codes`):** theo `0009_rls_policies_grants.sql:11` — **NO blanket grant cho role `app`**; chỉ truy cập qua **identity service / `SECURITY DEFINER` narrow functions**. `person_follows` **phải** theo boundary này, **không** chỉ dựa authz handler ở app.
  - Cột: `follower_person_id`/`followee_person_id` (FK persons), `status ∈ {pending,accepted}`, timestamps. `UNIQUE(follower,followee)` + `CHECK(follower<>followee)`.
  - **Auto-accept theo DD-48 visibility:** followee public → `accepted` ngay; private → `pending` (approve/reject).
  - **KHÔNG cấp quyền tiền/PII/roster** — follow chỉ mở approved public-profile fields (DD-48). Follow ≠ membership.
- **Merge (DD-01):** re-parent edge về canonical + dedupe (`accepted`>`pending`) + drop self-edge. Notify follow-request = person-directed global → impl-gap (outbox tenant-scoped).
- **An toàn:** grants theo `0009` (SECURITY DEFINER), fail-closed; test không rò tiền/PII/roster.

## DD-48 — Profile visibility (public/private) · ✅ framework (build P4+) → **chi tiết `dd-48-profile-visibility-analysis.md`**
- `persons.profile_visibility` default `public` **cho user mới**; **existing backfill `private`** (migration staged nullable→backfill→default→NOT NULL). Social profile (`GET /api/persons/:id/profile`) chỉ trả **approved fields CÓ canonical source** (`display_name`; `username` khi DD-39 migrate; `plexco_since` coarse) — **avatar/sports/aggregate EXCLUDE tới khi có model**. Không khẳng định blanket "non-PII".
- **Gating fail-closed:** self→`/api/me`; public→approved; private→approved chỉ khi `person_follows(V→T)=accepted` (DD-47); còn lại (kể cả đồng đội **và host non-follower**) → **card tối thiểu**. **Host operational access = ROUTE tenant-scoped RIÊNG, KHÔNG phải ngoại lệ trên social DTO.**
- **Ranh giới HR1/HR2:** gate xã hội bổ sung; KHÔNG nới RLS/tiền; private không gỡ roster/không giấu charges với host. 5 open item chốt lúc build.

---

## Post-MVP (P7) + External — quick-ref (chi tiết → file riêng)

- **DD-18 (LLM provider) — ⬜ hướng ✅** → `dd-18-llm-provider-analysis.md`: API hosted-first sau interface swappable; **provider + ToS/DPA/data-region CHẶN GO-LIVE** (P6), không chặn build.
- **DD-34/35/36 (KB platform) — 🟡 approve-in-principle P7** → `dd-34-36-kb-platform-analysis.md`: global KB plane grant-isolated + scanner PII; auto-derive field-whitelist; freshness re-crawl; **patch DD-21 khi build P7**.
- **DD-14/DD-15 (Zalo Login / `from.id`) — ⬜ SPIKE** → `dd-14-15-zalo-spike-analysis.md`: **xác minh với Zalo** (không phải quyết định nội bộ). Không chặn (link_codes bao ca xấu nhất).

---

**Nguồn:** `schema.ts` (sessions/players:276-288/join_requests:611/memberships/persons) · `feature_session_management`/`_tech` · `feature_cross_club_join`/`_tech` · `feature_marketplace_discovery:82` · `feature_user_settings` · DD-01/08/29/33/39/41/46 · HANDOFF §P6/§P7.
