# Token Needs Matrix — Plexco (từ BRD v3.9d)

> **Status:** 🟡 Đề xuất · v0.1 · 19/07/2026 · Owner: Ngoc-Anh
> **Phương pháp:** Bước 6A playbook `../templates/brd-to-pen-playbook.md` (6 lăng kính, template §5.10).
> **Vai trò:** input cho (a) đợt chốt theme (`../channels/web/theme-direction-2026-07.md`) và (b) DD-59 khi reopen. Đây là danh sách **nhu cầu** token — giá trị cụ thể chốt ở `design-tokens.md` (SoT).
> **Đối chiếu với:** `design-tokens.md` v1.1. Cột trạng thái: ✅ có · ⚠️ một phần · ❌ thiếu.

---

## 1. Lăng kính 3 — Enum & State machine (quan trọng nhất)

> Rule: mỗi chỗ BRD liệt kê ≥2 trạng thái của cùng 1 thứ = 1 nhóm token bắt buộc (usage-token alias về foundation semantic, theo DD-59).

| Nhu cầu | Nguồn BRD/DD | Nhóm token đề xuất | Trạng thái |
|---|---|---|---|
| Trạng thái nợ/charge: chưa trả · trả thiếu (partial) · đã trả · hoàn tác | FR-5.3, BR-7, DD-49 | `--debt-unpaid → var(--error)` · `--debt-partial → var(--warning)` · `--debt-paid → var(--success)` (usage layer) | ⚠️ semantic có, usage alias chưa |
| **CK chưa khớp (unmatched/dư)** — state thứ 4 không map sạch vào success/warning/error | FR-5.5 `/unmatched`, BR-7 | `--reconcile-unmatched` + `-subtle` (đề xuất: tím/neutral riêng, phân biệt với warning) | ❌ |
| Nguồn thanh toán: cash · manual CK · auto CK · host-attested | FR-5.1 (DD-40) | `--source-cash/manual/auto/attested` badge (alias) | ❌ |
| Subscription: trial · trial-sắp-hết (2d) · active · past_due (grace 7d) · suspended | FR-9.1, DD-51 | `--sub-trial/active/pastdue/suspended` (alias semantic) | ❌ |
| Tier gating free vs `host_pro` (capability flags) | DD-29, §9.1 | `--locked`, `--upgrade-accent` (pricing-gate UI: khoá/mờ/CTA nâng cấp) | ❌ |
| Join & membership: open-join · `join_requests(pending/approved/rejected)` · guest · full · left · ban | BR-5, DD-05, DD-32, DD-52/53 | `--join-pending/approved/rejected`, `--member-guest/full/banned` | ❌ |
| Kèo lifecycle: open · sắp full · full→**waitlisted** (auto-promote) · closed · hết giờ; visibility private/public; invite-token | FR-2.1/2.3, DD-44/45 | `--session-open/full/waitlist/closed/expired` + icon visibility | ❌ |
| Nhắc nợ escalation: 2h → 24h → … (mức độ tăng dần) | BR-8, FR-6.1 | escalation level: info → warning → error (alias) | ⚠️ semantic có, mapping chưa ghi |
| **Sync/delivery state:** synced · đang project · stale (re-project) · Messenger ngoài 24h (fallback) | FR-4.3, NFR-PF3, CO-3 | `--sync-ok/pending/stale`, `--delivery-fallback` — đặc thù Plexco đa kênh | ❌ |
| Reliability/no-show labels per-tenant (không public) | DD-42/43 | `--tag-*` per-tenant labels (alias) — chỉ tenant-private surface | ❌ |

## 2. Lăng kính 4 — Danh mục xuyên app

| Nhu cầu | Nguồn | Đề xuất | Trạng thái |
|---|---|---|---|
| **7 môn seed:** badminton · pickleball · tennis · padel · volleyball · basketball · football (extensible qua bảng `sports`) | DD-08, BR-2 | `--sport-*` đủ 7 + `--sport-default` fallback cho môn thêm sau (không migration token per môn mới) | ⚠️ 4/7 (thiếu padel/volleyball/basketball) |
| ⚠️ Xung đột semantic hiện tại: `--sport-pickleball` = green trùng `--success`; `--sport-tennis` từng trùng `--warning` (đã sửa v1.1) | `design-tokens.md` §9 | Khi chốt theme: chọn dải sport-accent không trùng semantic colors | ⚠️ |
| **Level 5 bậc ordered:** beginner < intermediate < upper_intermediate < advanced < professional | DD-08, DD-41 (gating) | `--level-1..5` (ramp 1 hue tăng đậm, hoặc badge outline) | ❌ |

## 3. Lăng kính 2 — Domain nghiệp vụ

| Nhu cầu | Nguồn | Đề xuất | Trạng thái |
|---|---|---|---|
| Hiển thị tiền VND (số lớn, so cột, multi-select mark-paid) | MODULE 5, BR-7 | token typography "Financial": `font-variant-numeric: tabular-nums` + weight/size riêng (Inter hỗ trợ sẵn) | ❌ (font có, token chưa) |
| `pay_code`/mã CK hiển thị | DD-02 | `--font-mono` | ✅ |
| i18n vi/en theo CLB + hồ sơ | NFR-L1, FR-11.1 | font chốt phải đủ glyph tiếng Việt (Sora: có hỗ trợ Vietnamese — verify khi chốt DD theme); độ dài label vi > en → không hardcode width | ⚠️ ghi chú, chưa thành rule |

## 4. Lăng kính 1 — NFR / Ngữ cảnh sử dụng

| Nhu cầu | Nguồn | Đề xuất | Trạng thái |
|---|---|---|---|
| PWA mobile-first 375px, cài đặt được (phase-1 target) | DD-69, §8 breakpoints | `--touch-target: 44px` (Apple HIG min) cho tap/multi-select mark-paid trên mobile | ❌ |
| Realtime SSE — trạng thái kết nối | DD-07, NFR-PF3 | `--conn-live/reconnecting` indicator | ❌ |
| Dark mode | đã có | `prefers-color-scheme` + semantic overrides | ✅ |

## 5. Lăng kính 5 — Personas

| Persona | Hệ quả token | Trạng thái |
|---|---|---|
| Host: dashboard doanh thu/lịch (FR-2.3), multi-select mark-paid | density thoải mái + selected-state rõ (`--primary-light` ✅); Financial typography (§3) | ⚠️ |
| Player: mobile, chat-first, xem nợ xuyên CLB (FR-8.1) | card-based, touch-target (§4), debt status colors (§1) | ⚠️ |
| Co-admin/capability | không cần token riêng — dùng locked/upgrade (§1) | — |

## 6. Lăng kính 6 — Roadmap (chừa chỗ, chưa build)

| Feature tương lai | Nguồn | Reserve naming | Ghi chú |
|---|---|---|---|
| Session Organize: sân + trận + live score | DD-61..64 (post-P4) | `--court-*`, `--score-*` | chỉ đặt tên nhóm, chưa cần giá trị |
| Social layer: follow, profile visibility | DD-47/48 (P4+) | `--visibility-public/private` badge | |
| App native phase-2 | DD-69 | giữ token platform-agnostic: CSS var hôm nay, export JSON design-tokens khi native | ảnh hưởng cách tổ chức, không thêm token |

## 7. Negative-visibility note (không phải token, là invariant)

Public marketplace surface **chỉ** dùng whitelist fields (NFR-S2/CO-5): không tồn tại component public nào cần token tiền/PII/giới tính. Component thuộc public surface không được import usage-token nhóm debt/reconcile/source (§1) — đưa vào review checklist FE, cùng nhóm test bất biến public.

---

## Tổng kết gap (ưu tiên khi chốt theme)

1. `--reconcile-unmatched` — state đặc thù killer-feature, không map semantic sẵn.
2. Usage-token layer cho debt/sub/join/session states (chống hardcode — đúng gap (b) DD-59).
3. Sports đủ 7 + tránh trùng semantic; level 1..5.
4. `--touch-target`, Financial/tabular-nums, `--locked`/`--upgrade-accent`.
5. Sync/delivery states (đặc thù đa kênh Plexco).

## Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
| 19/07/2026 | v0.1 | 🟡 Khởi tạo từ BRD v3.9d theo playbook Bước 6A; đối chiếu design-tokens.md v1.1. |
