# Web MVP program — ledger (chỉ primary agent ghi)

> **Nguồn thẩm quyền:** `../standards/decisions.md` DD-122 (owner 2026-10-12) · `../autopilot-templates/web-mvp-2026-10-12-RUN.md` (M0–M13).
> **Quy ước:** ledger này đi PR docs-only riêng, không bao giờ nằm trong PR slice. Mỗi dòng mốc ghi trạng thái
> đo được + PR + blocker; số liệu luôn kèm SHA đo. Review của chương trình theo DD-122 D4 (Claude subagent
> độc lập, không Codex, ≤3 vòng/PR). **Owner giữ merge · deploy · flag/credential production.**
> **Cập nhật:** 2026-10-12 (khởi tạo, đo tại `main@0db92b9`) · 2026-10-13 (M0–M5 từ PR body #42–#50; trạng thái
> lấy từ mục Review của từng PR, không từ suy đoán. Vòng review không có trong PR body được ghi là "không có trong snapshot") ·
> **2026-10-15 22:00 Asia/Saigon** (sau các phiên phase-2: trạng thái PR kiểm trực tiếp trên GitHub lúc 21:56,
> `origin/main` = `7fe5525`, tail migration `0055`, 56 file; `mergedAt` ghi theo UTC, Asia/Saigon = UTC+7). Bảng "Trạng thái mốc"
> dưới đây thay snapshot 13/10 (còn trong git history của file này); các mục baseline và default giữ nguyên làm lịch sử.
> **2026-10-16** (phiên P3-S1, lane L0): `origin/main` = `c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a` (merge #58), tail migration `0055`, 56 file. #57 và #51 đã merge; owner ký D1-D5 (DD-133..DD-137, mục "Quyết định owner 2026-10-16"). Kế hoạch hiện hành: `web-mvp-phase3-plan.md`. Các mốc, bảng và mục "Việc kế tiếp" bên dưới đã cập nhật theo trạng thái này; hàng lịch sử có ngày giữ nguyên.

## Trạng thái mốc

Đo trên GitHub lúc 2026-10-15 21:56 Asia/Saigon (riêng hai hàng #57 và #51 cập nhật 2026-10-16 theo `gh pr view`). **Phạm vi MVP theo DD-132 / DD-131 OD-0:** không SePay/ApiPay, không billing/`host_pro`,
không nhắc tự động, không deploy DigitalOcean, không cấp phát secret/Google OAuth; tiền chỉ thủ công (`cash` | `attested_transfer`).

| Mốc | Đợt | Nội dung | Trạng thái | PR | Blocker / chờ ai |
|---|---|---|---|---|---|
| M0 | A | Ghi DD-122, commit RUN + BACKEND-HANDOFF, ledger này, baseline | ✅ Đã merge `1681f5f` (2026-10-13 18:49Z): DD-122 đã ký bằng merge | [#42](https://github.com/maingocanh1702/plexco-app/pull/42) | — |
| M1 | A | Shell PWA + tokens DD-81 target C + Google sign-in UI + tạo CLB (M1a) · cấu hình CLB (M1b) | ✅ M1a đã merge `83f36dc` (2026-10-14 03:53Z). M1b: #45 merge `535471b` vào **nhánh cha đã chết**, nên nội dung lên `main` qua #54 (merge `9c07a33`, 2026-10-13 19:35Z) | [#44](https://github.com/maingocanh1702/plexco-app/pull/44), [#45](https://github.com/maingocanh1702/plexco-app/pull/45), [#54](https://github.com/maingocanh1702/plexco-app/pull/54) | Owner: install thật Android/iOS + VoiceOver/TalkBack chưa verify (chỉ Chromium headless). Google OAuth thật không còn trong MVP (DD-132) |
| M2a | A | `authorize()` (0049) thay cổng tạm + route GET session (list/detail) | ✅ Đã merge `b2391ff` (2026-10-13 18:59Z) | [#43](https://github.com/maingocanh1702/plexco-app/pull/43) | Backlog `session-commands-actor-recheck-under-lock` còn mở |
| M2b | A | Host workspace UI: list/detail/create/edit/publish/close/cancel | ✅ Đã merge `802e051` (2026-10-14 04:00Z) | [#48](https://github.com/maingocanh1702/plexco-app/pull/48) | `venueAddress` lúc tạo + formatter VND: đã vào `main` qua #57 (`844a0a9`, 2026-10-15 19:24Z) |
| M2c | A | Roster host-add + thủ công DD-40 (cash/transfer, partial, reversal): BE (#46) và UI (#53) | ✅ BE: #46 merge `10774d6` vào nhánh cha đã chết, nội dung lên `main` qua #54 (`9c07a33`). UI: #53 merge `d962b0c` (2026-10-14 20:45Z) | [#46](https://github.com/maingocanh1702/plexco-app/pull/46), [#53](https://github.com/maingocanh1702/plexco-app/pull/53), [#54](https://github.com/maingocanh1702/plexco-app/pull/54) | Backlog `m2c-round3-nits-follow-up`, `web-command-id-persistence-and-conflict-copy` |
| M3 | A | Zalo webhook durable + link CLB⇄bot (M3a) + link account⇄Zalo (M3b) | ✅ M3a: #47 merge `2339c8a` (2026-10-14 07:44Z). M3b: #49 merge `561086a` (2026-10-14 20:29Z), role `identity_definer` (0054) | [#47](https://github.com/maingocanh1702/plexco-app/pull/47), [#49](https://github.com/maingocanh1702/plexco-app/pull/49) | Đề xuất chấp nhận xử lý đồng bộ rồi ack của #47 đã được owner ký 2026-10-16 (DD-134 (d)); mục "Proposal đang mở"). |
| M4 | A | Settings tối thiểu (profile · linked channels · locale CLB) (`/me/settings`, club settings, 0055) | ✅ Đã merge `b06f33f` (2026-10-14 20:38Z) | [#52](https://github.com/maingocanh1702/plexco-app/pull/52) | — |
| M5 | A | Staging DO App Platform + Managed PG VPC, log, PITR drill, E2E, runbook tenant #1 | 🧊 **Đóng băng**: #50 vẫn mở (head `f3ceab7`), chỉ owner, **ngoài phạm vi MVP** theo DD-132 / OD-0 | [#50](https://github.com/maingocanh1702/plexco-app/pull/50) | Owner-only: tài khoản DO + secret staging (DD-129 không ký). Deploy production = owner (P0) |
| M6 | B | Projector thật, DLQ replay, SLO sync, scheduler, auto-expiry, toggle public/private | ⬜ chưa có PR | — | M3 đã xong; owner bật `OUTBOX_DISPATCH_SCHEDULE_ENABLED`. Kế hoạch: `web-mvp-phase3-plan.md` (DD-134 đã ký 2026-10-16) |
| M7 | B | Billing + entitlement reader + webhook SePay/ApiPay + nhắc tự động | ⛔ Ngoài phạm vi MVP (DD-132 / OD-0) | — | — |
| M8 | B | Privacy + settings đầy đủ | ⛔ Ngoài phạm vi MVP (DD-132 / OD-0) | — | — |
| M9 | C | Player view · join web/Zalo · cross-club · discovery · giá theo giới tính | ⬜ chưa có PR | — | **Chỉ phụ thuộc M6** (DD-132); occupancy authority đã ký ở DD-133 (2026-10-16). Kế hoạch: `web-mvp-phase3-plan.md` (DD-133, DD-135) |
| M10 | C | In-app Chat | ⬜ chưa có PR | — | M2a (xong), M9. Kế hoạch: `web-mvp-phase3-plan.md` (DD-136 đã ký 2026-10-16: chỉ kênh CLB) |
| M11 | C | Messenger | ⛔ Ngoài phạm vi MVP (DD-132 / OD-0) | — | — |
| M12 | C | Email/password | ⛔ Ngoài phạm vi MVP (DD-132 / OD-0) | — | — |
| M13 | C | Hardening MVP | ⛔ Ngoài phạm vi MVP (DD-132 / OD-0) | — | — |

**Giao hàng phase-2 (ngoài bảng M0–M13):**

| Hạng mục | Trạng thái | PR | Ghi chú |
|---|---|---|---|
| Chính sách close/cancel (DD-131 OD-1, đảo DD-117 D3 vế close) | ✅ Đã merge `8d4b4b6` (2026-10-15 06:39Z) | [#55](https://github.com/maingocanh1702/plexco-app/pull/55) | `close` từ chối khi còn dư nợ bằng 409 `CLOSE_BLOCKED_OPEN_DEBT`; `cancel` chỉ chặn khi có tiền đã ghi nhận. Chặn luồng "chạy buổi → đóng" đã gỡ |
| Dev-login chỉ local | ✅ Đã merge `7fe5525` (2026-10-15 13:10Z) | [#56](https://github.com/maingocanh1702/plexco-app/pull/56) | Residual và owner waiver: mục "Quyết định owner 2026-10-15" bên dưới |
| Polish + golden path chạy local | ✅ Đã merge `844a0a92d3e9cfbcc67d0197ea53f725998ba6ec` (2026-10-15 19:24Z) | [#57](https://github.com/maingocanh1702/plexco-app/pull/57) | `venueAddress` lúc tạo (OD-4a) · một formatter VND + guard (OD-4b) · heading font Be Vietnam Pro + `worker-src 'self'` (OD-7) · spec Playwright golden path chỉ local · `docs/runbooks/local-mvp-smoke.md`. Trích theo số PR, không theo head SHA (head còn có thể đổi) |
| Ledger này + ghi chú DD-131 + backlog | ✅ Đã merge `3546f6b49bc32e82dbe12e5da636c62206c63b2e` (2026-10-15 19:32Z) | [#51](https://github.com/maingocanh1702/plexco-app/pull/51) | Đã merge sau #57 như kế hoạch |

## Baseline đo tại `main@0db92b9` (2026-10-12)

- `pnpm progress`: 49 migration (tail `0048`) · 15 API route (7 nghiệp vụ, **0** GET session) · 0 màn FE ·
  ROADMAP pin `12f5191` stale (14 file).
- `pnpm -w typecheck` · `lint` · `format:check` · `review:check` · `build` → exit 0.
- `pnpm -w test`: **không chạy local** (Docker daemon tắt trên máy phiên) — CI trên PR #42 là authority cho suite DB.

## Default đã áp (DD-122 D3) — chờ owner ký bằng merge M0

Tier C #1 host-add · DD-56-read-routes chờ `authorize()` · O4 chặt nhất · DD-114-D6 self-serve ·
DB_EXPECTED_ROLE opt-in · C4 staging-only · O2 uỷ quyền · Tier C #2 per-club · DD-119 superseded.

*(15/10: M0 đã merge `1681f5f`, tức DD-122 và các default này đã được owner ký.)*

## Proposal đang mở (🟡, chờ owner ký — chi tiết trong `decisions.md`)

DD-123 → DD-128 và DD-130 đã được đóng bởi DD-131 (owner ký 14/10); DD-129 đóng băng theo OD-0 + DD-132. *(16/10: hai proposal đầu bên dưới đã đóng, xem mục "Quyết định owner 2026-10-16".)* Còn mở:

- ✅ *Đã đóng 2026-10-16 bởi DD-134 (d), owner ký.* **Zalo ingress xử lý đồng bộ rồi mới ack** (đề xuất ack đồng bộ; DD-131 OD-2, PR #47). OD-2 mô tả "trả Success ngay rồi xử lý bất đồng bộ";
  #47 xử lý trong request rồi ack. *Đề xuất (chưa quyết):* chấp nhận xử lý đồng bộ cho MVP. Backlog liên quan:
  `channel-inbound-events-retention-reclaimer`.
- ✅ *Đã đóng 2026-10-16 bởi DD-137, owner ký.* **Cổng thoát đợt A** (đề xuất cổng thoát; DD-132). DD-132 gỡ cổng "E2E staging" và không nêu cổng thay thế. *Đề xuất (chưa quyết):* đợt A thoát
  khi Playwright `e2e-web` chạy **local** XANH trên tip của stack.
- **Cột consumer trên `link_codes`** (tuỳ chọn, hardening; cần owner quyết schema): ràng buộc tài khoản tiêu thụ trong
  definer và đóng cửa sổ `same_person` 10 phút (hiện tối đa một dòng audit thừa). Đi kèm hai rủi ro có sẵn: insert con FK phía bot
  chạy đua với link có thể gắn vào Person nguồn đã tombstone; worker test chết giữa lúc revoke/restore có thể để một LOGIN role
  test `SET ROLE identity_definer` được. Backlog: `identity-link-hardening-consumer-column`.

## Quyết định owner 2026-10-15

Ghi lúc 18:39 Asia/Saigon, **không** mang số DD mới:

- **Waive finding A2 của review PR #56 (dev-login):** prefix `/internal-dev-login` được phép trả 404 rỗng khi chỉ các kiểm tra theo từng request thất bại.
- **Migration `auth_audit_dev_login` KHÔNG được cấp phép.** Đăng nhập dev vẫn được ghi là `login_success`/`google`: giới hạn đã biết,
  không phải lỗi cần sửa trong MVP.

**Ghi chú của owner (không phải backlog row):**

- Formatter VND của OD-4(b) hiển thị `1.500đ` cả ở UI tiếng Anh, nên trình đọc màn hình tiếng Anh có thể đọc thành số thập phân.
  Đây là format owner đã ký.
- `docker compose -f infra/docker-compose.yml up -d postgres` chạy từ một đường dẫn checkout khác (ví dụ một worktree của PR) sẽ
  **tạo lại** container `plexco-postgres-1` với bind mount của init script trỏ vào checkout đó. Volume dữ liệu vẫn còn và init script
  chỉ chạy khi volume còn trống, nên việc này vô hại; chạy lại đúng lệnh đó một lần từ checkout chính sẽ gắn lại mount. Không bao giờ
  `docker compose down -v`.

## Quyết định owner 2026-10-16

Ghi từ tin nhắn của owner "Phase 3 plan approved" (2026-10-16); L0 chỉ ghi lại chữ ký, **không** mang số DD mới. D1-D5 = DD-133..DD-137 trong `../standards/decisions.md`:

- **D1 (DD-133)** signed (a)-(e): occupancy authority, hàm SQL, cột DD-41 và `public_listing_id`, public chỉ `slots_open`.
- **D2 (DD-134)** signed (a)-(f), kèm một override cho (c), nguyên văn owner: "also send exactly ONE Zalo DM to a player promoted from the waitlist (that player only, only if their Zalo is linked), saying they now hold a seat and the fee owed; the lane that introduces the promotion event wires it; no other new DM types, no reminders."
- **D3 (DD-135)** signed. **D4 (DD-136)** signed.
- **D5 (DD-137)** signed, kèm phần bổ sung, nguyên văn owner: "fix the OSV advisories on main (1 Critical shell-quote, 5 High) as a separate PR alongside L1, with full test runs; any bump that needs a breaking change goes to the backlog instead."

## Việc kế tiếp

1. ✅ **Vòng merge cuối đã xong:** #57 (`844a0a9`) rồi #51 (`3546f6b`) đã vào `main`, kế tiếp là #58 (`c762c90`, kế hoạch Phase 3). Phiên P3-S1 (L0) chạy trên `main` chứa #58.
2. **#50 (M5) chỉ owner**, đóng băng, ngoài phạm vi MVP. Không có lane nào đụng tới nó.
3. **Test local:** #57 đã vào `main`; làm theo `docs/runbooks/local-mvp-smoke.md` (Postgres local + dev-login + golden path
   click tay hoặc Playwright). File có trên `main` từ 2026-10-15.
4. **Lane flake (backlog, mỗi cái một lane):** `app-worker-test-password-clash-flake` · `db-test-unhandled-57p01-and-load-timeouts` ·
   `e2e-web-pwa-offline-online-flake` · `dev-app-worker-password-not-restored` (hai row password `app_worker` liên quan nhau: làm cùng nhau hoặc theo thứ tự, không sửa chồng). CI đỏ do flake đã biết: chạy lại một lần.
5. **OSV:** Security run `38456110453` trên `main` có 9 advisory (backlog `osv-full-scan-red-on-main-2026-10`). Owner đã chọn sửa (D5, 2026-10-16): 1 Critical shell-quote + 5 High, một PR riêng cạnh L1 với test đầy đủ; bump cần breaking change đi vào backlog.
6. ✅ **Owner đã quyết** hai đề xuất (ack đồng bộ của #47 → DD-134 (d); cổng thoát đợt A → DD-137), 2026-10-16.
7. **Phiên kế tiếp:** đợt B/C trong phạm vi MVP còn lại là M6, M9, M10 (M9 chỉ phụ thuộc M6). Kế hoạch hiện hành: `web-mvp-phase3-plan.md`; handoff cũ cho agent (lịch sử): `2026-10-14-web-mvp-program-handoff-2.md`.
