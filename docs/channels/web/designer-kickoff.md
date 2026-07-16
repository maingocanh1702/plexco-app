# Designer Kickoff — Plexco Web FE

> **Status:** 🟡 Proposal · **Version:** 0.2 · 2026-07-17
> **Đọc file này ĐẦU TIÊN khi bắt đầu design FE.** Là entry point gộp mọi tài liệu + thứ tự làm + checklist nghiệm thu.
> **Visual source:** chưa chọn/chưa có asset được track. `Plexco-DS-fable5.pen` không có trong repo và đã superseded; chốt `.pen` mới hoặc Figma file/node trong `theme-direction-2026-07.md` trước handoff/code.
> **Operationalize:** DD-57 (FE architecture) · DD-58 (pipeline + template) · DD-59 (tokens) · DD-60 (API convention).

---

## 0. Gói tài liệu designer cần (đọc theo thứ tự)

| # | Tài liệu | Dùng để |
|---|---|---|
| 1 | `design-brief.md` | Sản phẩm, personas, key screens, deliverables §9, a11y §8 |
| 2 | `../../standards/design-tokens.md` | **Token canonical** — designer bám giá trị này |
| 3 | `../../standards/frontend-architecture.md` | Ràng buộc bắt buộc (FE-INV-1..6): 4-state, tokens-only, i18n vi/en, touch ≥44 |
| 4 | `./README.md §2` | **Route/auth/phase canonical** (Screen Map + Permission Matrix) |
| 5 | `./frontend-pipeline.md` + `../../templates/feature-dev/fe-*-template.md` | Cách bàn giao từng màn visual-source→code |
| 6 | `../../standards/design-tokens-benchmark.md` | Khi cần đề xuất đổi/thêm token (không tự chế) |
| 7 | `../../features/feature_*.md §Screens & States / §Use Cases + Edge Cases` | Chi tiết state + edge case mỗi feature |

## 1. Chốt trước khi bắt đầu (owner)

- [ ] **Theme màu + font** — đang trao đổi ở [`./theme-direction-2026-07.md`](./theme-direction-2026-07.md) (🟡 chờ chốt hue: Volt Green / Lime / Orange / Pink + font Sora+Inter). Chốt xong mới ghi vào `design-tokens.md`.
- [ ] **Token SoT = `design-tokens.md`** — designer match token; đổi token phải qua benchmark (DD-59). *(đã note ở `design-brief §5.1`)*
- [ ] **Route canonical = `README.md §2`** — nơi lệch với `design-brief §3` thì README thắng. *(đã note ở `design-brief §3`)*
- [ ] **Visual SoT = `.pen` mới được commit hoặc Figma file/node được link** — ghi exact path/URL + node/frame id; chưa chốt thì không handoff/code.
- [ ] Xác nhận scope phase-1 (mục §3 dưới).

## 2. Ràng buộc bắt buộc (mọi màn phải thoả — FE-INV)

- **4-state**: mọi màn data-driven vẽ đủ `loading · ready · empty · error`. Empty = icon + text + CTA; error = message + retry.
- **Tokens-only**: chỉ dùng token trong `design-tokens.md`; không màu/spacing tự do. Thiếu token → đề xuất, không hardcode.
- **Song ngữ vi/en**: mọi chuỗi có bản vi + en (đưa cả 2 trong handoff).
- **Dark mode**: mỗi component/màn có biến thể light + dark.
- **Responsive**: 3 breakpoint 375 / 768 / 1440 (theo `design-tokens.md §8`).
- **A11y**: touch ≥ 44×44, focus ring, tương phản WCAG AA, `prefers-reduced-motion`.

## 3. Trình tự làm việc

### Giai đoạn A — Design System (làm TRƯỚC, khoá trước khi vẽ màn)
1. **Tokens** trong visual source đã chọn khớp `design-tokens.md`: color · typography · spacing · radius · shadow · motion (+ sport accents §9, dark mode §Dark).
2. **Primitives / Component Library** (theo `design-brief §5.4/§9`): Button, Input/Field, Card, Table/List, Badge/Tag, Toast, Skeleton, **Empty state**, **Slot indicator**, Modal, Tabs, Avatar.
   - Mỗi component đủ **states**: default · hover · focus · active · disabled · loading.
   - Có biến thể light + dark; text mẫu vi + en.
3. **Patterns**: navigation (dashboard sidebar / player bottom-nav), form layout, money display (tabular-nums), status color mapping (paid/partial/unpaid).
4. ✅ **Gate lock** — owner duyệt token khớp `design-tokens.md`. **Không sửa token sau khi khoá** (đổi thì qua DD-59).

### Giai đoạn B — Màn theo feature (thứ tự ưu tiên)
> Route lấy từ `README.md §2`. Mỗi màn đủ 4-state + 3 breakpoint + edge case từ `feature_*.md`.

| Thứ tự | Nhóm | Màn | Feature spec |
|---|---|---|---|
| 1 | Auth | `/` Landing + Login (Google + email) | `feature_web_auth_onboarding.md` (DD-13) |
| 2 | Onboarding | `/onboarding` wizard 4 bước (Club · SePay · Zalo · Messenger + readiness) | `feature_connector_onboarding.md` |
| 3 | Host core | `/dashboard` overview | `feature_session_management.md` · `feature_payment_reconcile.md` |
| 4 | Host core | `/dashboard/sessions` list + `/sessions/new` create | `feature_session_management.md` (DD-41 fields/gating) |
| 5 | Host core | `/dashboard/sessions/:id` detail (roster · **mark-paid tap/multi-select** · QR) | `feature_session_management.md` · `feature_payment_reconcile.md` (DD-40) |
| 6 | Host money | `/dashboard/payments` ledger · unmatched · manual allocation | `feature_payment_reconcile.md` |
| 7 | Host | `/dashboard/members` list + merge tool | `feature_identity.md` |
| 8 | Host | `/dashboard/settings` config · bank · bot links | `feature_user_settings.md` · `feature_tenant_routing_authz.md` |
| 9 | Marketplace | `/discover` + `/discover/:id` (public, chỉ field-whitelist) | `feature_marketplace_discovery.md` · `feature_cross_club_join.md` |
| 10 | Player | `/me` clubs + nợ tổng, `/me/*` | `feature_player_view.md` |
| 11 | Chat | Chat in-app (club + DM) | `feature_inapp_chat.md` (DD-38) |
| 12 | Settings | Hồ sơ + **giá theo giới tính** | `feature_user_settings.md` (DD-39) |

### Giai đoạn C — Handoff từng màn (pipeline DD-58)
Với mỗi màn xong design: source path/URL + node/frame id → `handoff/<screen>-handoff.md` (template) → `handoff/<screen>-token-mapping.md` (template) → code → verify screenshot ×3 breakpoint.

## 4. Checklist nghiệm thu per-screen (owner ký trước khi code)

- [ ] Đúng route + auth theo `README.md §2` (+ Permission Matrix §2.1)
- [ ] Đủ 4 state: loading · ready · **empty (icon+text+CTA)** · error (message+retry)
- [ ] Light + dark mode
- [ ] 3 breakpoint 375 / 768 / 1440 không vỡ layout
- [ ] Chỉ dùng token `design-tokens.md` (không màu/spacing lạ)
- [ ] Mọi chuỗi có vi + en
- [ ] Touch ≥44, focus ring, tương phản AA
- [ ] Cover edge case liệt kê trong `feature_*.md §Use Cases + Edge Cases`
- [ ] **Không tiền/PII trên màn public** (`/discover*` chỉ field-whitelist — HARD RULE 2)
- [ ] Money hiển thị tabular-nums; status color đúng mapping paid/partial/unpaid
- [ ] Node/frame đặt tên rõ và handoff ghi exact source path/URL + ID

## 5. Deliverables mong đợi (tóm từ `design-brief §9`)
1. Design system source (`.pen` được track hoặc Figma file/node được link) — tokens + component library đủ states.
2. Screen designs theo §3B — mỗi màn 4 state × light/dark × 3 breakpoint.
3. Handoff per-screen (§C) — để FE code pixel-perfect.

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 17/07/2026 | 0.2 | Gỡ `.pen` SoT không tồn tại; tách token SoT và visual SoT; thêm hard gate chọn + track/link source mới trước handoff/code. |
| 16/07/2026 | 0.1 | 🟡 Kickoff đầu tiên — gộp gói tài liệu + thứ tự design-system→screens + checklist nghiệm thu. Vá drift color (`design-brief §5.1`) + route (`§3`). Operationalize DD-57..60. |
