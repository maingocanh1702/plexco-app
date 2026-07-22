# 🏆 DD-82 Analysis — Tournament (Giải đấu) = aggregate độc lập

> **Mục đích:** chốt hướng kiến trúc cho "giải đấu" — nó là aggregate riêng hay một biến thể của `sessions`? Đụng DD-41 (`session_type` gộp `tournament`), HR1 (RLS), HR2 (public whitelist). **Phải chốt sequencing với DD-41 TRƯỚC khi build tournament và trước khi DD-41 migrate `session_type`.**
> **Ngày:** 2026-07-21 · **Canonical:** `packages/db/schema.ts` (sessions:214, players:276, public_sessions:603, tenants:152) · `packages/db/migrations/*` · `decisions.md` DD-82/DD-41/DD-06/DD-12/DD-83/DD-84 · HANDOFF §3 (5 HARD RULES). Đã ghi → `decisions.md` DD-82 (✅ chốt hướng owner 2026-07-21) + spec pair `feature_tournament(.md/_tech)` v0.1 (Draft).

---

## 0. TL;DR — ✅ ĐÃ CHỐT HƯỚNG: aggregate độc lập, v1 gọn

**Owner 2026-07-21 chốt hướng aggregate độc lập.** Doc này là analysis nền cho readiness gate; specs (`feature_tournament`) là Draft, **chưa build**.

- ✅ **CHỌN — Option C: aggregate độc lập.** Bảng canonical riêng `tournaments` + `tournament_registrations` (tenant-scoped + RLS) + `public_tournaments` read model (whitelist). **Không** tái dùng `sessions`/`players`, **không** gom session vào tournament.
- ❌ **Option A (từng ngụ ý bởi DD-41, KHÔNG chọn): tournament = một giá trị `session_type`.** Trộn hai khái niệm (một buổi tập vs một giải nhiều vòng), không mô hình được đăng ký/vòng/bracket. → **Retire `session_type='tournament'`** (amend DD-41).
- ⚪ **Option B (đã cân nhắc, KHÔNG chọn): tournament = container chứa nhiều `sessions`.** Giữ để tham chiếu §5; nặng và ép cấu trúc session lên đơn vị thi đấu.
- **v1 cố tình gọn:** info + đăng ký + URL share. **v1 KHÔNG đụng tiền.** Bracket / standings / entry-fee = **slice sau** (§7).

**Vì sao C an toàn & đúng:** tournament có vòng đời + người tham gia + (tương lai) bracket riêng, khác bản chất một `session`. Aggregate riêng giữ `sessions`/`players` sạch, và vì v1 không đụng tiền nên **không mở blast radius sang ledger** (`charges`/`payment_allocations`). Mọi bất biến RLS/public áp y hệt các bảng tenant khác.

---

## 1. Canonical đã cố định gì

| Sự thật | Nguồn |
|---|---|
| **`players.session_id` là FK CỨNG tới `sessions`** — roster của một buổi luôn thuộc đúng một session | `schema.ts:279` |
| **`sessions` không có cột `session_type`** — hiện chỉ `skill_level` (chưa retire); DD-41 field-set **chưa migrate** | `schema.ts:214-243` |
| **`session_type` và chuỗi `tournament` KHÔNG xuất hiện ở đâu trong `packages/db`** (grep 0 match) | `packages/db/**` |
| **`public_sessions` pattern** — `id = sessions.id`, `tenant_id` "internal routing only — never serialized", field-whitelist (sport/time/area/price/slots_open/club+host display), `projected_at`/`expires_at` | `schema.ts:603-626` |
| **`tenant_id NOT NULL` phổ quát + RLS fail-closed** keyed `app.tenant_id`; role `app` NOBYPASSRLS | `schema.ts` (26+ bảng) · `0009_rls_policies_grants.sql` · HR1 |
| **`join_requests.command_id text` nullable** — pattern idempotency có sẵn để mượn | `schema.ts:637` |
| **DD-06:** chỉ `area` ra public; venue lộ theo **outcome** (`players.status='active'`) | `decisions.md` DD-06 |
| **DD-83:** URL 4 loại dùng chung slug registry; session/tournament = **opaque slug**, tombstone-on-rename, guarded-view-only | `decisions.md` DD-83 |
| **DD-41 (đã chốt):** `session_type` (1 field) với tập giá trị `social\|class\|coaching\|tournament\|singles`; gating enforce ở shared `evaluateSessionEligibility` | `decisions.md` DD-41 · `dd-41-session-fields-gating-analysis.md` |

> **Hệ quả:** (1) không thể "nhét" tournament vào `players` vì FK cứng tới `sessions`; (2) `public_sessions` là khuôn có sẵn để clone cho `public_tournaments`; (3) retire `tournament` khỏi `session_type` **rẻ ở hiện tại** vì `session_type` chưa migrate — không có dữ liệu live để backfill.

---

## 2. Vấn đề — DD-41 gộp `tournament` vào `session_type`

DD-41 chốt `session_type ∈ {social, class, coaching, tournament, singles}` và **tự cảnh báo** field này trộn hai trục: **format** (đơn/đôi) vs **intent** (buổi tập/lớp/giải). "Tournament" nằm lẫn trong đó như thể một giải đấu chỉ là "một buổi có nhãn tournament".

Thực tế một giải đấu ≠ một buổi:

- Có **đăng ký** tách biệt (người tham gia, có thể khác người chơi từng trận).
- Có **vòng/nhánh/bảng xếp hạng** (bracket/standings) — cấu trúc nhiều-trận.
- (Tương lai) có **phí tham gia** (entry-fee) với mô hình tiền riêng, khác `charges` theo buổi.
- Có **URL công khai** riêng để share (DD-83 `/tournament/<slug>`).

Ép tất cả vào `sessions` (một hàng, `slots_max`, `players` roster) không biểu diễn được các trục trên. Đây là lý do owner tách ra.

---

## 3. Options

### ❌ Option A — `session_type='tournament'` (status quo DD-41) — KHÔNG chọn

- **Nội dung:** giữ tournament là một giá trị của `session_type`; một giải = một `sessions` row + `players`.
- **Ưu:** không bảng mới; tái dùng join/waitlist/roster của session.
- **Nhược (chí mạng):** không có chỗ cho đăng ký-tách-người-chơi, vòng/bracket, entry-fee riêng; `players.session_id` FK cứng ⇒ mọi người tham gia buộc là "player của một buổi". Ép sau này sẽ đẻ cột/bảng phụ bám lên session → chính cái "trộn 2 khái niệm" DD-41 đã cảnh báo. **Loại.**

### ⚪ Option B — Tournament = container chứa nhiều `sessions` — cân nhắc, KHÔNG chọn

- **Nội dung:** `tournaments` là parent, mỗi trận/vòng là một `sessions` con.
- **Ưu:** tái dùng session cho từng trận (giờ, sân, roster từng trận).
- **Nhược:** nặng ngay v1 (giải nhỏ cũng phải đẻ N sessions); ép đơn-vị-thi-đấu vào khuôn "buổi tập" (visibility/join_policy/price của session không hợp cho một trận trong bracket); coupling chặt tournament↔session làm khó tiến hoá bracket. Quá tải cho v1 "gọn". **Không chọn v1**; có thể tái xem xét nếu về sau muốn mỗi trận là một buổi đặt sân thực.

### ✅ Option C — Aggregate độc lập — CHỌN

- **Nội dung:** `tournaments` + `tournament_registrations` (tenant-scoped/RLS) + `public_tournaments` (read model whitelist). Người tham gia key theo `person_id` (global) qua `tenantRepo`, **không** dùng `players`. Bracket/standings/entry-fee = bảng/slice thêm sau, hang off `tournaments`.
- **Ưu:** giữ `sessions`/`players` sạch; mô hình đúng bản chất (đăng ký ≠ roster buổi); v1 không đụng tiền ⇒ không chạm ledger; mở rộng bracket/money về sau là additive lên aggregate riêng.
- **Nhược:** thêm một aggregate (bảng + RLS + projector + UI); một phần cơ chế (đăng ký, slot-count, share) "hao hao" session nhưng phải viết lại — chấp nhận được vì bản chất khác.

---

## 4. ✅ Contract v1 đã PIN (gọn, triển khai được)

Chi tiết DDL/API/tests ở `feature_tournament_tech.md`; tóm tắt các quyết định:

1. **Bảng canonical (tenant-private, RLS fail-closed):**
   - `tournaments` — `tenant_id NOT NULL`, `sport_id`, title/notes, `starts_at<ends_at`, `area` (+ venue nội bộ), `slots_max`, `status ∈ {draft,published,completed,cancelled}`, `registration_status ∈ {closed,open}`, `slug` (opaque, cấp khi publish), `version`.
   - `tournament_registrations` — `tenant_id NOT NULL`, `tournament_id`, `person_id`, `status ∈ {registered,withdrawn}`, `command_id` (idempotency). **Partial unique** `(tournament_id, person_id) WHERE status='registered'` = fence chống đăng ký trùng + idempotent.
   - **KHÔNG cột tiền v1** (BI-TRN-3).
2. **Read model public (whitelist):** `public_tournaments` clone pattern `public_sessions` — `id = tournaments.id`, `tenant_id` internal-only (never serialized), `slug`/sport/title/time/`area`/`slots_max`/`slots_open`/registration_status/club+host display/status/`projected_at`/`expires_at`. **Không** money/PII/roster/venue. Projector-owned; guarded view (DD-12) đọc read model, không canonical.
3. **URL share (DD-83):** `/tournament/<slug>` opaque slug; rename → tombstone; đọc guarded view.
4. **Venue theo DD-06:** public chỉ `area`; venue cụ thể lộ theo **outcome đăng ký** (`registration.status='registered'`), không phải mọi authenticated.
5. **v1 không đụng tiền:** đăng ký không tạo `charges`/nghĩa vụ; entry-fee deferred (§7).
6. **Child-safety (DD-84):** không lộ PII trẻ vị thành niên ra public.

---

## 5. Retire `session_type='tournament'` — coordinate DD-41

**Quyết định:** `tournament` KHÔNG còn là giá trị `session_type` (amend DD-41). Vì `session_type` **chưa migrate**, sequencing rẽ hai nhánh:

| Tình huống tại thời điểm build | Hành động | Backfill? |
|---|---|---|
| **(a) DD-41 chưa ship `session_type`** (hiện trạng — không có cột trong `packages/db`) | Khi DD-41 migrate `session_type`, **CHECK loại `'tournament'`** ngay từ đầu (tập còn `social\|class\|coaching\|singles`) | Không có dữ liệu → không backfill |
| **(b) DD-41 đã ship `session_type` gồm `'tournament'` trước tournament slice** | Migration backfill chuyển session `session_type='tournament'` sang aggregate `tournaments` (hoặc mark theo policy owner), rồi thắt CHECK bỏ `'tournament'` | **Có** — không được gọi "no breakage" |

- Đây là **hard dependency** DD-82 ↔ DD-41: chốt ở readiness gate trước khi bên nào migrate.
- Khuyến nghị: **DD-41 nên loại `'tournament'` ngay khi migrate** (nhánh a) để tránh backfill — vì DD-82 đã tách, không có lý do để `session_type` từng mang `'tournament'` trong DB.

---

## 6. 5 HARD RULES — kiểm chiếu

- **HR1 (RLS fail-closed):** `tournaments`/`tournament_registrations` tenant-scoped + ENABLE/FORCE RLS + role `app` NOBYPASSRLS; mọi đọc/ghi qua `tenantRepo`. `public_tournaments` là read model no-RLS **nhưng** field-whitelist cưỡng chế bằng cột (giống `public_sessions`). ✅
- **HR2 (tiền/PII không public):** `public_tournaments` không có cột tiền/PII/roster; `tenant_id` internal-only never serialized; venue gated; test bất biến CI. ✅
- **HR3 (không multi-master):** canonical `tournaments` là nguồn duy nhất; public qua projector/outbox; surfaces gửi command, không sở hữu bản ghi song song. ✅
- **HR4 (claim-có-tiền cần khoá mạnh):** **v1 không đụng tiền** ⇒ không có claim-có-tiền để bảo vệ. Khi entry-fee slice sau vào, HR4 áp cho đường tiền tournament (khoá mạnh, pay_code/reconcile) — pin ở slice đó. ✅ (v1 N/A)
- **HR5 (i18n):** mọi chuỗi user-facing `t(vi, en)`; error catalog một nguồn (BE §3). ✅

---

## 7. Deferred (v2+) — vì sao để sau

| Hạng mục | Vì sao deferred | Ghi chú khi build |
|---|---|---|
| **Entry-fee (phí tham gia)** | Mở blast radius sang ledger (`charges`/`payment_allocations`/reconcile/pay_code); HR4 khoá mạnh. Tách khỏi v1 để giữ đường tiền sạch | Quyết reuse `charges` hay bảng phí riêng (TRN-OQ-3); áp DD-02 pay_code + DD-25/40 nếu có |
| **Bracket / nhánh / bảng** | Cấu trúc nhiều-trận, thuật toán seeding/advance; có thể tái dùng pattern DD-61/62 (Session Organize: assignment + score ledger idempotent) | Aggregate thêm `tournament_rounds`/`matches` hang off `tournaments` |
| **Standings / live score** | Phụ thuộc bracket; live score = ledger append-only như DD-62 | Reuse pattern DD-62 `score_events` |
| **Waitlist khi full** | v1 = từ chối (`TOURNAMENT_FULL`); waitlist = cơ chế DD-45 (queue/promotion) nếu cần | TRN-OQ-2 |

---

## 8. Open Questions (chưa chốt — readiness gate/build slice)

| ID | Câu hỏi | Default đề xuất |
|---|---|---|
| TRN-OQ-1 | Ai được đăng ký? | ✅ **Chốt (owner 2026-07-21):** host config `registration_policy ∈ {members_only, approval, anyone}` — chỉ member / cross-club có duyệt / bất kỳ user Plexco. `approval` dùng trạng thái `pending`+host duyệt |
| TRN-OQ-2 | Waitlist khi full? | ⬜ v1 từ chối; waitlist slice sau (DD-45 pattern) |
| TRN-OQ-3 | Entry-fee model: reuse `charges` hay bảng riêng? | ⬜ Deferred; quyết ở money-slice |
| TRN-OQ-4 | Bracket/standings cấu trúc? | ⬜ Deferred; xét reuse DD-61/62 |
| TRN-OQ-5 | Retire `session_type='tournament'` sequencing với DD-41 | ✅ **Chốt (owner 2026-07-21):** nhánh (a) — DD-41 không bao giờ thêm `'tournament'`; không backfill; tournament độc lập không đụng `sessions` |
| TRN-OQ-6 | Avatar/gender hiển thị roster tournament (host-facing) theo DD-85? | ⬜ Theo DD-85: host-facing disambiguator; không public |

---

## 9. Ranh giới scope + propagation + readiness gate

- **DD-82 = authority KIẾN TRÚC** (aggregate độc lập; không reuse sessions/players; v1 gọn; retire session_type). **Chi tiết implementation** (DDL đầy đủ, projector, tests, money-slice, bracket) → slice riêng khi build, không edge-patch vào DD.
- **Điểm chạm khi build:** `feature_tournament(.md/_tech)` (đã Draft) · DD-41 (retire `session_type`) · DD-83 (slug registry) · DD-12 (guarded view) · DD-06 (venue) · DD-84 (minor safety) · DD-85 (roster disambiguator) · features `README.md` index.
- **Readiness gate (bắt buộc trước code):** đọc `standards/review-code-readiness-gate.md`; verify live schema/migrations; chốt TRN-OQ-1/2/5 (ít nhất eligibility + retire sequencing); pin migration number tại build time (next-available sau khi sync `main`; baseline hiện `0000–0014`). Specs giữ **Draft** tới khi qua gate.
- **Không** migration/runtime tại thời điểm này.

---

## 10. Nguồn

`packages/db/schema.ts` (sessions:214, players:276-306, public_sessions:603-626, tenants:152, join_requests:628) · `packages/db/migrations/0009_rls_policies_grants.sql` (RLS/grants) · `decisions.md` DD-82 (chốt hướng) · DD-41 (`session_type`) · DD-06 (venue) · DD-12 (guarded view) · DD-83 (slug) · DD-84 (minor safety) · DD-85 (disambiguator) · `dd-41-session-fields-gating-analysis.md` · `feature_tournament.md` + `BE/feature_tournament_tech.md` v0.1 · HANDOFF §3 (5 HARD RULES).
