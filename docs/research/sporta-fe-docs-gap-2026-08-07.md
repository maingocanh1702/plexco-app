# Sporta FE docs → Plexco FE docs: gap analysis + porting record

> **Loại:** research / comparative analysis. **KHÔNG phải** review verdict, readiness gate, hay build contract.
> Không resolve open question nào; không tạo decision nào (đề xuất route qua DD-99 🟡).
>
> **Ngày:** 2026-08-07
> **Input (external, non-authoritative):** 7 file `Sporta/docs/Phase 1/FE/` (`feature_auth` · `feature_home` · `feature_explore` · `feature_search` · `feature_session` · `feature_session_detail` · `feature_payment`) — React Native mobile app, host-centric. Tham khảo UX, KHÔNG phải authority.
> **Baseline Plexco:** 12 file `docs/channels/web/FE/*_fe.md` (tất cả Draft) + source contracts Reviewed tương ứng + `decisions.md` v2.13.
> **Anh em cùng ngày:** `sporta-session-docs-gap-2026-08-07.md` (product/BE session-level) · `sporta-payment-fe-port-analysis-2026-08-07.md` (payment FE → DD-97/98) · `../proposals/sporta-payment-ux-port-design-input-2026-08-07.md` · `../proposals/cross-project-standardization-2026-08-07.md`. File này là lát cắt **FE spec structure + non-payment FE UX**; các claim payment đã được downgrade theo hai file kia (xem §5).

---

## 1. Kết luận chính

**Giá trị port lớn nhất là cấu trúc spec, không phải nội dung UI.** Cả 7 file Sporta đều có 4 mục mà cả 12 file Plexco FE (trước session này) thiếu một cách hệ thống: Analytics events taxonomy · State machine tường minh · Acceptance Criteria · Test plan. Thiếu AC nghĩa là spec không testable — đây là lỗ cấu trúc, không phải lỗ nội dung.

Nội dung UI: phần lớn REJECT/ADAPT vì model khác (Court/Slot, `FULL`/`IN_PROGRESS`, 4 loại pricing, `hostId`, karma, client-side money math — chi tiết xung đột xem Category C của research session-level). Phần PORT được là micro-UX: debounce, empty/loading/success states, confirm dialogs, fallback flows.

## 2. Đã áp dụng trong session 2026-08-07 (Draft, add-only, không authorize render)

| File | Thay đổi | Version |
|---|---|---|
| `feature_auth_fe.md` | `AUTH_CANCELLED` client-local state (user hủy OAuth consent → về entry point im lặng, không rơi vào `AUTH_INVALID`) + 4 section Draft | v0.2→v0.3 |
| `feature_onboarding_fe.md` | 4 section Draft (step funnel analytics; completion gate TBD) | v0.2→v0.3 |
| `feature_home_fe.md` | Nội dung 3 bước `OnboardingChecklist` (Draft — chỉ hành động đã tồn tại trong docs) + phân biệt Onboarding vs Empty + 4 section; **không đụng** vùng money chips/§6 (DD-96 mirror pending) | v0.4→v0.5 |
| `feature_marketplace_fe.md` | Search behavior spec (debounce 300ms · AbortController · min 2 ký tự · whitespace guard) + empty-state 2 CTA + tách LOADING/LOADING_MORE/REFRESHING + 4 section | v0.2→v0.3 |
| `feature_sessions_fe.md` | Submitting state + Success surface cho create form (fence "không authorize render theo §6") + 4 section; **không đụng** mâu thuẫn header/§6, hàng 768px, payment tab OMITTED | v0.2→v0.3 |
| `feature_player_view_fe.md` | 4 section Draft (analytics cấm amount/`payAction.href`) | v0.4→v0.5 (v0.6 cùng ngày là của session payment song song) |
| `feature_payments_fe.md` | Happy empty state (điều kiện từ server) + 4 section | v0.3→v0.4 |
| `feature_chat_fe.md` · `feature_dashboard_fe.md` · `feature_members_fe.md` · `feature_notifications_fe.md` · `feature_settings_fe.md` | Skeleton 4 section (TBD UNPINNED — node state lấy từ §States từng file; không bịa nội dung) | bump nhỏ từng file |

Ràng buộc chung đã giữ: add-only; không error code mới vào catalog (UNPINNED giữ nguyên); trạng thái client thuần đánh dấu "(client-local, không phải BE token)"; analytics cấm amount/tiền/PII/toạ độ/query text; state machine chỉ dùng state đã pin, thiếu căn cứ ghi `TBD (UNPINNED)`; AC trace về § có sẵn.

## 3. PORT/ADAPT/REJECT theo cặp (tóm tắt — phần chưa áp dụng là backlog)

**Auth/Onboarding:** PORT countdown retry 60s, cancel-im-lặng, confirm trước destructive action. ADAPT: lockout/refresh là server-owned state. REJECT: local `isOnboarded` flag, token client-side, auto-link email trùng, `karmaScore`/`HOST_PRO`. GAP còn lại → DD-99 P3 (account management).

**Home:** PORT checklist content + Onboarding-vs-Empty trigger (đã áp). ADAPT: chips selection server-side. REJECT: chip tiền host-centric trên landing (nay do DD-96 own cả hai chip — mọi claim cũ về "bỏ chip Chưa thu" hết hiệu lực), payment dot `paid` (union chỉ `open|partial`), streak từ `COMPLETED` (không tồn tại), offline hiện cached person-self (fail-open).

**Explore/Search → Marketplace:** PORT debounce/abort/min-2-chars/2-CTA/3-loading-states (đã áp). ADAPT: recent searches localStorage keyword-only; district coarse thay GPS. REJECT: Haversine/lat-lng trên public surface, badge từ `FULL`, denominator "8/16", karma/avatar public, bê error catalog vào chỗ UNPINNED. GAP còn lại: sort control (time/price), FilterSheet gom + preview count — FE-level, chờ DTO pin, không cần DD.

**Session/Session detail:** PORT submitting/success surface (đã áp), tab Sắp tới/Đã qua (backlog). ADAPT: venue picker web, duplicate-warning server-side, join idempotent-fail-closed (KHÔNG optimistic — file đã pin), share Web Share API. REJECT: Court/Slot, 4 pricing + auto-calc, `FULL`/`IN_PROGRESS`, Match/Score client, AsyncStorage draft, friend/karma/co-host. GAP lớn → DD-99 P2 (player session-detail + join/leave/waitlist UX FE spec).

**Payment:** xem `sporta-payment-fe-port-analysis-2026-08-07.md` (authority cho lát này) — DD-97 (statement/export), DD-98 (negative scope), design-input proposal (protected-pay UX · reminder-config · CBF countdown). Phần file này chỉ giữ: happy empty state (đã áp) + 2 leftover chưa ai own → DD-99 P4 (mark-paid/`cash|waiver` surface — SourceBadge hiện là dead enum; refund-on-cancel UX — `void` chưa có flow vào/ra).

## 4. Route sang DD-99 (🟡 proposal, chờ owner)

- **P1** ratify bộ 4 section thành điều kiện FE Draft→Reviewed.
- **P2** FE spec player session-detail + join/leave/waitlist — hard-dep: owner gỡ mâu thuẫn header/§6 `feature_sessions_fe.md`.
- **P3** security/account-management owner contract (logout · delete account · linked providers · session-device) — `feature_settings_fe.md` đang treo negative scope chờ đúng source authority này.
- **P4** mark-paid/`cash|waiver`/refund-on-cancel surface contract.
- **OQ-DD99-1** breakpoint 768px (`sessions_fe`/`dashboard_fe` pin 768 vs `home_fe`/`player_view_fe` cấm trung gian) → F0 design authority, resolution nhị phân.

## 5. Corrections so với bản phân tích thô (trước cross-check)

Ba claim GAP trong bản phân tích thô (chỉ đọc folder FE) đã bị **hạ cấp** sau khi verify toàn docs tree — ghi lại để người sau không lặp:

1. ~~"Plexco chưa có màn nào cho người chơi biết phải trả bao nhiêu"~~ — SAI. `feature_player_view_fe.md` §3/§4 đã có outstanding items + `amountDue/amountAllocated/remaining` + per-club `payAction`; QR/STK bị fence **có chủ đích**. Gap thật chỉ là protected-pay surface đích (design-input §1 own).
2. ~~"Không có screen quản lý tài khoản"~~ — thiếu chính xác. `feature_settings_fe.md` đã ghi negative scope **có chủ đích** cho security mutations, chờ source authority. Gap thật = chưa ai author source contract đó (→ P3), không phải "quên".
3. Mọi nhận định về Home money chips viết trước DD-96 (cùng ngày) đều phải đọc lại qua DD-96 — đặc biệt: chip "Chưa thu" là direction ✅ (không phải REJECT vĩnh viễn), nhưng negative scope render tới khi B1–B4 đóng.

Bài học phương pháp: gap-claim từ so sánh 1 folder phải verify trên toàn docs tree + decisions.md trước khi phát biểu "Plexco thiếu X".
