# 📋 Founder Decision Brief — Nhóm A (2026-07-18)

> **Mục đích:** historical decision worksheet; owner outcome đã được ghi vào authority.
> **Authority:** `standards/decisions.md` v1.47. Brief này không còn là pending vote; các checkbox chi tiết bên dưới là lịch sử trước khi chốt.
> **Cách dùng:** mỗi mục tick một ô. `✏️ Sửa` thì ghi chú ngắn ở dòng "Ghi chú".

---

## ✅ Kết quả (owner chốt 2026-07-18 — đã ghi `decisions.md` v1.47)

| DD | Quyết định |
|---|---|
| **DD-33** | ✅ Chốt phase-1 + **kick off Meta App Review** (action ngoài) |
| **DD-57/58/59** | ⏸️ Defer — không ảnh hưởng BE, quyết sau (giữ 🟡) |
| **DD-60** | ✅ Chốt (API reference convention) |
| **DD-61–64** | ✅ Accept in-principle cả cụm — build **post-P4**, phased; DD-63 `balanced` degrade random tới khi có level source |
| **DD-69** | ✅ Định hướng accepted (app-first); technical gates chốt dần ở phase-2 |

> **Propagation completed trên current-authority docs (18/07):** DD-33 identity/web-auth + external gate task; DD-60 convention forward-looking/on-touch; DD-61–64 post-P4/no-runtime status; DD-69 accepted direction. External submissions/evidence vẫn pending riêng.

---

## ⏱️ Ưu tiên vì lead-time ngoài (làm song song, không chờ họp)
- **DD-33** — nếu duyệt phase-1 thì **kick off Meta App Review / Business Verification NGAY** (lead-time dài, rủi ro lịch §13 BRD).
- **A3 (ngoài nhóm A)** — review pháp lý VN cho PII/bank memo (Luật 91/2025 + NĐ 356/2025): nên khởi động counsel sớm. *(Không nằm trong brief này nhưng cùng lý do lead-time.)*

---

## A1 · DD-33 — Facebook Login / Messenger account-link (phase-1) · P2.5

**Bối cảnh:** Messenger là kênh MVP (DD-37); cần link Plexco↔Facebook. FB Login (web-auth provider `account_identities.platform='facebook'`) và Messenger PSID (page-scoped) là **hai subject khác nhau** → phải link qua verified account identity hoặc transactional one-time `link_code` về cùng `person`, không auto-link chéo. Rào: phụ thuộc **Meta App Review / Business Verification** (ngoài tầm kiểm soát, lead-time dài).

**Đề xuất:** duyệt là provider phase-1 **+ kick off App Review ngay** (song song code). App Review chậm → capability OFF và degrade sang transactional one-time `/link` code.

**Khuyến nghị:** ✅ Chốt phase-1 + kick off App Review.

**Duyệt:** ☐ ✅ Chốt (phase-1 + App Review) ☐ ❌ Hoãn khỏi phase-1 ☐ ✏️ Sửa
**Ghi chú:** …

---

## A2 · DD-57–60 — Bộ FE conventions (port từ Sporta) · Docs / P1 FE

> 4 doc-standard độc lập, không đụng tiền/schema. Có thể duyệt cả cụm hoặc từng cái. Đều neo về HARD RULES đã có, **không tạo luật mới**.

**DD-57 — FE architecture principles.** Thêm `standards/frontend-architecture.md`: 6 bất biến FE-INV-1..6 (4-state loading/ready/empty/error · tokens-only · UI không chạm DB · i18n `t(vi,en)` · không tiền/PII ra client/public · envelope live). Counterpart FE của `core-db-architecture-principles.md`.
**Duyệt:** ☐ ✅ ☐ ❌ ☐ ✏️  · Ghi chú: …

**DD-58 — Visual-source→code pipeline.** 5 bước `visual source → handoff → token-mapping → code → verify` + 2 template + luật `// Source:` comment mỗi component; CSS-var (không Tailwind). *Gate:* chỉ author handoff/code khi owner chốt theme + visual tool (`.pen`/Figma) và asset được track bền vững.
**Duyệt:** ☐ ✅ ☐ ❌ ☐ ✏️  · Ghi chú: …

**DD-59 — Design-token benchmark + usage-token layer.** Method-doc luận token từ 5–7 app đối thủ (không bịa số) + lớp usage/component token chống hardcode; reconcile `standards/design-tokens.md` = SoT, `channels/web/design-tokens.md` → pointer.
**Duyệt:** ☐ ✅ ☐ ❌ ☐ ✏️  · Ghi chú: …

**DD-60 — API reference convention.** Auth-level legend (⬜✅🔑🔒) + format 1-endpoint cố định + envelope live chuẩn; thống nhất §API Contract của mọi `BE/feature_*_tech.md`.
**Duyệt:** ☐ ✅ ☐ ❌ ☐ ✏️  · Ghi chú: …

**Khuyến nghị:** ✅ cả 4 (chặn FE track; rẻ, chỉ là chuẩn tài liệu). DD-58 duyệt kèm điều kiện "chốt visual SoT trước khi author screen".

---

## A3 · DD-61–64 — Session Organize (điều phối trong buổi) · post-phase-1, TBD (sớm nhất sau P4)

**Bối cảnh:** feature MỚI hoàn toàn (schema chưa có court/match/score; bot Bestminton không có logic này để lift). Aggregate tenant-private hang off `sessions`/`players`, v0.4 chỉ hỗ trợ **2 phía**. Không lộ public, không đụng đường tiền/merge.

**Cụm 4 DD (vote như một gói):**
- **DD-61** — schema tổ chức (`session_courts`/`matches`/`match_participants`/`match_sets`/`score_events`), migration mới, không sửa migration cũ.
- **DD-62** — live scoring per-point (append-only ledger `point|reversal`; correction bounded trước session end).
- **DD-63** — assign-to-court 4 mode (random/manual/balanced/rotation); `balanced` thiếu nguồn level → random + warning (🔗 phụ thuộc level source per-sport).
- **DD-64** — privacy/authz (không public; `session.organize` & `session.score` là 2 grant độc lập; SSE re-auth ≤30s).

**Đề xuất:** accept cụm để **lịch build sau P4** (không chèn vào phase-1). Lưu ý DD-63 `balanced` còn phụ thuộc nguồn level per-person×sport — chấp nhận degrade random khi chưa có.

**Khuyến nghị:** ✅ accept-in-principle, phase sau P4; hoặc ❌ để ngỏ nếu chưa chắc nhu cầu điều phối trong buổi.

**Duyệt:** ☐ ✅ Accept cụm (build sau P4) ☐ ❌ Để ngỏ ☐ ✏️ Sửa (vd bỏ live-score, giữ assign)
**Ghi chú:** …

---

## A4 · DD-69 — Định vị app-native (phase-1 PWA → phase-2 native) · phase-2, TBD

**Bối cảnh:** đã ghi proposal + patch BRD/PRD/ROADMAP + 2 doc phân tích (`dd-69-app-native-analysis.md`, `strategy/native-app-strategy.md`). Native NGOÀI phase-1 committed scope; không đảo DD-10/DD-37.

**Đề xuất (khi accept):** RN+Expo là recommendation *sau native spike*; bearer auth (Google PKCE + Apple/equivalent iOS); push tách `device_push_subscriptions` khỏi DD-67; offline v1 read-only; client-safe contract boundary; khóa `/api/v1`.

**Khuyến nghị:** ✅ accept *định hướng* (app-first, PWA→native) ngay để docs nhất quán; các gate kỹ thuật (framework/platform/contract) chốt dần khi tới phase-2. Chưa cần quyết framework hôm nay.

**Duyệt:** ☐ ✅ Accept định hướng ☐ ❌ Giữ web-only ☐ ✏️ Sửa
**Ghi chú:** …

---

## Ngoài nhóm A (đã duyệt nguyên tắc / external — chỉ để bạn nắm, không cần quyết lại)
- **DD-34/35/36** (Global KB) — approve-in-principle, build P7.
- **DD-18** (LLM provider) — hướng hosted-first swappable OK; chọn provider + pháp lý → sát P7 (chặn Assistant go-live, không chặn build).
- **DD-14/15** — spike xác minh Zalo (giao dev; không chặn build).
- **DD-11** — Zalo Premium managed add-on (external, P4.7).

---

## Sau khi bạn tick
Mình sẽ, cho mỗi DD ✅: cập nhật `decisions.md` (🟡→✅ + changelog bump), rồi propagate theo Hệ quả của DD đó (tạo doc/standard, patch spec, hoặc thêm phase vào ROADMAP). DD ❌/✏️ → ghi lại lý do vào decisions.md để không mở lại nhầm.
