# Web MVP program — ledger (chỉ primary agent ghi)

> **Nguồn thẩm quyền:** `../standards/decisions.md` DD-122 (owner 2026-10-12) · `../autopilot-templates/web-mvp-2026-10-12-RUN.md` (M0–M13).
> **Quy ước:** ledger này đi PR docs-only riêng, không bao giờ nằm trong PR slice. Mỗi dòng mốc ghi trạng thái
> đo được + PR + blocker; số liệu luôn kèm SHA đo. Review của chương trình theo DD-122 D4 (Claude subagent
> độc lập, không Codex, ≤3 vòng/PR). **Owner giữ merge · deploy · flag/credential production.**
> **Cập nhật:** 2026-10-12 (khởi tạo, đo tại `main@0db92b9`) · **2026-10-13** (M0–M5 từ PR body #42–#50; trạng thái
> lấy từ mục Review của từng PR, không từ suy đoán. Vòng review không có trong PR body được ghi là "không có trong snapshot").

## Trạng thái mốc

| Mốc | Đợt | Nội dung | Trạng thái | PR | Blocker / chờ ai |
|---|---|---|---|---|---|
| M0 | A | Ghi DD-122, commit RUN + BACKEND-HANDOFF, ledger này, baseline | 🟡 PR mở (docs-only). Vòng 3 Claude độc lập = READY (0 blocking). Sau vòng 3: `15cde0f` doc-only, không review lại. CI `verify` xanh tại `0f6a058` (2 run) | [#42](https://github.com/maingocanh1702/plexco-app/pull/42) | owner merge = ký DD-122 |
| M1 | A | Shell PWA + tokens DD-81 target C + Google sign-in UI + tạo CLB (#44 = M1a) · cấu hình CLB (#45 = M1b-be) | 🟡 #44: vòng 3 có 1 blocking (open redirect) đã sửa `fb386e0` — **không review lại**; CI `verify`+`Security`+`e2e-web` xanh tại `818edf4` (trước `fb386e0`). #45: READY (3 vòng, vòng 3 = 0 blocking); CI xanh tại `71b5516` | [#44](https://github.com/maingocanh1702/plexco-app/pull/44), [#45](https://github.com/maingocanh1702/plexco-app/pull/45) | #44 sau #42; #45 sau #46 (stack). Owner: install thật Android/iOS + VoiceOver/TalkBack chưa verify; `GOOGLE_OAUTH_*` staging (C4); DD-123 heading font; DD-124 ký |
| M2a | A | `authorize()` (0049) thay cổng tạm + route GET session (list/detail) | 🟡 #43: READY sau vòng 3 (0 blocking). Commit `7535e26` sau vòng 3 (9 file, +60/−10): primary đọc diff, **không có vòng review**. CI xanh tại `7535e26` không có trong body; push-run `d262fa5` có 1 flake (`apps/bot dispatcher.test.ts JRD-6`) | [#43](https://github.com/maingocanh1702/plexco-app/pull/43) | owner merge đầu tiên trong thứ tự merge. Backlog `session-commands-actor-recheck-under-lock` còn mở |
| M2b | A | Host workspace UI: list/detail/create/edit/publish/close/cancel | 🟡 #48: vòng 1 (5 should-fix) đã sửa; **vòng 2 không có kết quả trong snapshot**. CI `verify`+`e2e-web` xanh tại `daa5659` (trước sửa vòng 1). Stack trên #44; diff còn chứa file của #43 tới khi #43 merge | [#48](https://github.com/maingocanh1702/plexco-app/pull/48) | sau #44. Owner: DD-128 (venueAddress, convention VND) |
| M2c | A | Roster host-add (Tier C #1 default) + thủ công DD-40 (cash/transfer, reversal) — **phần BE** | 🟡 #46: READY sau vòng 3 (0 blocking; 7 nit → backlog `m2c-round3-nits-follow-up`). CI `verify` xanh tại `42ff94a`. **UI add/mark-paid (M2c-fe) chưa có PR nào** | [#46](https://github.com/maingocanh1702/plexco-app/pull/46) | ⚠️ DD-117: `closeSession`/`cancelSession` bị chặn khi session có roster/charge — câu hỏi mở quan trọng nhất của wave (DD-125). 5 mã lỗi chưa pin |
| M3 | A | Zalo webhook durable + link CLB⇄bot (#47 = M3a) + link account⇄Zalo (#49 = M3b, `link_code` caller đầu tiên) | 🟡 #47: vòng 1–2 đã sửa (vòng 2 fix tại `0de7b9f`); **vòng 3 không có kết quả trong snapshot** — chưa đánh giá READY. Migration 0053 chưa chạy trên DB thật. #49: **không có kết quả review trong snapshot**; 0054 chưa chạy (Docker tắt) | [#47](https://github.com/maingocanh1702/plexco-app/pull/47), [#49](https://github.com/maingocanh1702/plexco-app/pull/49) | credentials Zalo OA + xác nhận 5 điểm AWAIT-verify (DD-126) · owner chọn mô hình owner definer 0054 (DD-127) · egress evidence (E6) |
| M4 | A | Settings tối thiểu (profile · linked channels · locale CLB) | ⬜ chưa có PR. Chờ #44/#45 (M1) và #47/#49 (M3) merge | — | M1, M3 |
| M5 | A | Staging DO App Platform + Managed PG VPC, log, PITR drill, E2E, runbook tenant #1, go/no-go | 🟡 #50: chuẩn bị only, **chưa chạy trên DO**. Mục Review không có kết quả trong snapshot. Chưa chạy Docker build · `doctl apps spec validate` · `actionlint` | [#50](https://github.com/maingocanh1702/plexco-app/pull/50) | owner: tài khoản DO + secret staging (6 mục, §Việc kế tiếp); DD-129 ký. Deploy production = owner (P0) |
| M6 | B | Projector thật, DLQ replay, SLO sync, scheduler, auto-expiry, toggle public/private | ⬜ | — | M3; owner bật `OUTBOX_DISPATCH_SCHEDULE_ENABLED` |
| M7 | B | Billing + entitlement reader + webhook SePay/ApiPay + nhắc tự động | ⬜ | — | M2, M6; ApiPay signed body · egress · tài khoản provider |
| M8 | B | Privacy + settings đầy đủ | ⬜ | — | M4; A3 luật sư |
| M9 | C | Player view · join web/Zalo · cross-club · discovery · giá theo giới tính | ⬜ | — | M6, M7; Occupancy authority (không default) |
| M10 | C | In-app Chat | ⬜ | — | M2a, M9 |
| M11 | C | Messenger | ⬜ | — | M3, M9; Meta App Review |
| M12 | C | Email/password | ⬜ | — | M1; vendor email (C7) |
| M13 | C | Hardening MVP | ⬜ | — | M9–M12; owner thuê pen-test |

## Baseline đo tại `main@0db92b9` (2026-10-12)

- `pnpm progress`: 49 migration (tail `0048`) · 15 API route (7 nghiệp vụ, **0** GET session) · 0 màn FE ·
  ROADMAP pin `12f5191` stale (14 file).
- `pnpm -w typecheck` · `lint` · `format:check` · `review:check` · `build` → exit 0.
- `pnpm -w test`: **không chạy local** (Docker daemon tắt trên máy phiên) — CI trên PR #42 là authority cho suite DB.

## Default đã áp (DD-122 D3) — chờ owner ký bằng merge M0

Tier C #1 host-add · DD-56-read-routes chờ `authorize()` · O4 chặt nhất · DD-114-D6 self-serve ·
DB_EXPECTED_ROLE opt-in · C4 staging-only · O2 uỷ quyền · Tier C #2 per-club · DD-119 superseded.

## Proposal đang mở (🟡, chờ owner ký — chi tiết trong `decisions.md`)

- **DD-123** — Quy ước FE: CSS Modules + token DD-81, SW theo build, `useT()`, `/c/[tenantId]`, Playwright + axe · [#44](https://github.com/maingocanh1702/plexco-app/pull/44)
- **DD-124** — Cấu hình CLB: definer `tenant_profile_*`, mapping `content.manage`, settings `club.default_*` · [#45](https://github.com/maingocanh1702/plexco-app/pull/45)
- **DD-125** — Roster + mark-paid + reversal; ⚠️ hệ quả DD-117 cho close/cancel (câu hỏi mở chính) · [#46](https://github.com/maingocanh1702/plexco-app/pull/46)
- **DD-126** — Bot Zalo ingress: shape webhook (AWAIT-verify), identity 3 phần, pepper + key version, retention · [#47](https://github.com/maingocanh1702/plexco-app/pull/47)
- **DD-127** — Link web ⇄ Zalo: re-parent rule + FK scan fail-closed; ⚠️ OPEN mô hình owner definer NOBYPASSRLS · [#49](https://github.com/maingocanh1702/plexco-app/pull/49)
- **DD-128** — Đọc workspace host session: `upcoming`, occupancy một công thức, `venueAddress`, VND · [#48](https://github.com/maingocanh1702/plexco-app/pull/48)
- **DD-129** — Staging: migrate PRE_DEPLOY (lệch §5), trigger policy, RPO/RTO đề xuất; rủi ro R1 BYPASSRLS, R2 TLS CA · [#50](https://github.com/maingocanh1702/plexco-app/pull/50)
- **DD-130** — Fix sau vòng review 3 không được review lại (#42, #43, #44; #47 chưa rõ) — owner chọn (a) đọc rồi merge hoặc (b) một vòng review riêng · PR #42–#47

## Việc kế tiếp

1. **Thứ tự owner merge:** #42 (= ký DD-122) → #43 → #46 → #45 → #47 → #49. #44 sau #42; #48 sau #44; #50 sau #44.
2. **Trước khi merge, primary phải có kết quả review còn thiếu** (không merge trên "appended below" rỗng):
   #44 fix `fb386e0` (DD-130) · #47 vòng 3 · #48 vòng 2 · #49 vòng review · #50 vòng review.
3. **Owner asks cho M5 (chi tiết lệnh trong `docs/runbooks/staging-deploy.md`):** (a) DO resources `sgp1`: VPC, DOCR,
   Managed PG 16 private, DB `plexco`; (b) bootstrap DB một lần bằng admin rồi đặt password role `app`/`app_worker`/`readonly`;
   (c) GitHub environments `staging` → `production`, owner là required reviewer, secret/variable theo runbook;
   (d) `doctl apps create` với spec local (gitignored), secret component theo tên; (e) đóng cổng IP outbound (SePay · ApiPay ·
   Zalo Bot) trước production; (f) chạy PITR drill và điền `pitr-restore-drill.md` §6, rồi approve `deploy-staging`.
4. **Owner quyết trong DD đã mở:** DD-127 (mô hình owner definer 0054) · DD-125 (DD-117 close/cancel với roster — chặn
   luồng "chạy buổi → đóng") · DD-130 (cách xử lý fix sau vòng 3) · DD-129 (R1/R2 và log forwarder).
5. **M4** chưa có PR; mở sau khi M1 và M3 merge.
