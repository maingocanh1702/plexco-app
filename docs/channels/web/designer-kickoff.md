# Designer Kickoff — Plexco Web FE

> **Status:** ✅ Active governance; execution HOLD · **Version:** 0.8 · 2026-07-28
> **Execution boundary:** kickoff/pipeline đã chốt nhưng không tự mở FE; exact screen chỉ bắt đầu sau Reviewed feature spec + tracked owner-approved node trong `design.pen`.
> **Visual source:** ✅ **DD-81: Pencil; canonical path amended 25/07/2026** — root file `design.pen`. FE/design handoff vẫn HOLD tới khi file được persist/track + owner nghiệm thu; variables phải khớp SoT `../../standards/design-tokens.md` tại gate đó. `Plexco-DS-fable5.pen` superseded, không dùng.
> **Authority:** DD-57/58/59 đã ✅ chốt (owner 2026-07-28); DD-60 API convention áp độc lập cho API docs mới/materially changed. Governance final không phải runtime proof.
> **DD-91 boundary:** In-app Chat primary-daily direction và requester-only `/pay` đã được primary plan
> v1.8 đóng ở mức `PLAN_READY` tại `90d292d`. Đây chưa phải slice-local `CODE_READY`; designer không tự
> mở thêm screen/handoff trước khi exact slice gate và `design.pen` tracked, owner-approved cùng đóng.

---

## 0. Gói tài liệu designer cần (đọc theo thứ tự)

| # | Tài liệu | Dùng để |
|---|---|---|
| 1 | `design-brief.md` | Sản phẩm, personas, key screens, deliverables §9, a11y §8 |
| 2 | `../../standards/design-tokens.md` | **Token canonical** — designer bám giá trị này |
| 3 | `../../standards/frontend-architecture.md` | Active DD-57 governance (server-first · feature-first · FE-INV-1..6) |
| 4 | `./README.md §2` | **Route/auth/phase canonical** (Screen Map + Permission Matrix) |
| 5 | `./frontend-pipeline.md` + `../../templates/feature-dev/fe-*-template.md` | Cách bàn giao từng màn visual-source→code |
| 6 | `../../standards/design-tokens-benchmark.md` | Khi cần đề xuất đổi/thêm token (không tự chế) |
| 7 | `../../features/feature_*.md §Screens & States / §Use Cases + Edge Cases` | Chi tiết state + edge case mỗi feature |

## 1. Chốt trước khi bắt đầu (owner)

- [x] **Target theme direction** — DD-81 chọn Candidate C Energetic Orange `#FF5A1F` + Sora/Inter. Current Indigo/Outfit chưa đổi; xem activation gates ở [`./theme-direction-2026-07.md`](./theme-direction-2026-07.md).
- [x] **Token value SoT = `design-tokens.md`** — benchmark chỉ là advisory evidence; `design.pen` variables phải match `.md` (DD-59).
- [ ] **Route canonical = `README.md §2`** — nơi lệch với `design-brief §3` thì README thắng. *(đã note ở `design-brief §3`)*
- [ ] **Visual authority = canonical `design.pen` được track + owner duyệt** — ghi exact node id; chưa pass thì không handoff/code.
- [ ] **Visual/WCAG gate** — confirm/tune target C trên Home light/dark; normal text dùng dark `#22100A` trên primary nếu activate (white không đạt AA).
- [ ] Xác nhận scope phase-1 (mục §3 dưới).

## 2. Ràng buộc active theo DD-57

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
3. **Patterns**: navigation — dashboard sidebar (host) / **player bottom-nav 5 slot: Home · Feed · [Khám phá center/FAB] · Club · Setting** + **Chat 💬 ở header cạnh 🔔** (DD-79 amendment v3; Kèo của tôi = sub-screen từ Home; Feed config-OFF tới DD-76 → phase-1 render 4 tab, designer giải cân bằng FAB), form layout, money display (tabular-nums), status color mapping (paid/partial/unpaid).
4. **Token gate lock** — chỉ thêm usage/component alias từ owner-approved accepted/reused states; benchmark/inventory không tự tạo token. Mọi value vẫn vào `design-tokens.md`.

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
| 13 | Home | Landing sau đăng nhập — personal dashboard (chips Còn nợ/Kèo tuần · hero next-session · suggested) | `feature_home.md` (DD-79 ✅) — dựng ĐẦU TIÊN để **confirm/tune target C + Sora/Inter** và kiểm light/dark/WCAG; không tự reopen hue |

### Giai đoạn C — Handoff từng màn (pipeline DD-58)
Với mỗi màn xong design: canonical `design.pen` path + exact node id → `handoff/<screen>-handoff.md` (template) → `handoff/<screen>-token-mapping.md` (template) → code → verify screenshot ×3 breakpoint.

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
1. Canonical `design.pen` được track + owner duyệt — tokens + component library đủ states.
2. Screen designs theo §3B — mỗi màn 4 state × light/dark × 3 breakpoint.
3. Handoff per-screen (§C) — để FE code pixel-perfect.

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 28/07/2026 | 0.8 | Mirror immutable Chat authority and primary plan v1.8 `PLAN_READY`; retain exact-slice `CODE_READY` and tracked owner-approved `design.pen` gates. |
| 28/07/2026 | 0.7 | **DD-57/58/59/81 ratification:** activate FE/pipeline/token governance; chọn target C + Sora/Inter; Pencil-only exact-node handoff; giữ execution HOLD tới tracked owner-approved `design.pen` + visual/WCAG gate. |
| 27/07/2026 | 0.6 | Add DD-91 conditional/no-handoff boundary; keep deferred status and `design.pen` approval gate. |
| 25/07/2026 | 0.5 | **DD-81 path reconcile:** canonical root file = `design.pen`; giữ deferred/HOLD tới khi persist/track + owner nghiệm thu. |
| 19/07/2026 | 0.4 | **Visual source resolved (DD-81 ✅):** tool = Pencil, file `plexco-app-design.pen` root repo; variables khớp SoT khi tạo. Thêm màn #13 Home (DD-79 ✅) — màn theme-exploration đầu tiên. |
| 18/07/2026 | 0.3 | Owner defer DD-57..59; kickoff/pipeline/checklists chuyển thành reference-only. Tách rõ DD-60 vẫn accepted và áp độc lập. |
| 17/07/2026 | 0.2 | Gỡ `.pen` SoT không tồn tại; tách token SoT và visual SoT; thêm hard gate chọn + track/link source mới trước handoff/code. |
| 16/07/2026 | 0.1 | 🟡 Kickoff đầu tiên — gộp gói tài liệu + thứ tự design-system→screens + checklist nghiệm thu. Vá drift color (`design-brief §5.1`) + route (`§3`). Operationalize DD-57..60. |
