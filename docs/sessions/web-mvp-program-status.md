# Web MVP program — ledger (chỉ primary agent ghi)

> **Nguồn thẩm quyền:** `../standards/decisions.md` DD-122 (owner 2026-10-12) · `../autopilot-templates/web-mvp-2026-10-12-RUN.md` (M0–M13).
> **Quy ước:** ledger này đi PR docs-only riêng, không bao giờ nằm trong PR slice. Mỗi dòng mốc ghi trạng thái
> đo được + PR + blocker; số liệu luôn kèm SHA đo. Review của chương trình theo DD-122 D4 (Claude subagent
> độc lập, không Codex). **Owner giữ merge · deploy · flag/credential production.**
> **Cập nhật:** 2026-10-12 (khởi tạo, đo tại `main@0db92b9`).

## Trạng thái mốc

| Mốc | Đợt | Nội dung | Trạng thái | PR | Blocker / chờ ai |
|---|---|---|---|---|---|
| M0 | A | Ghi DD-122, commit RUN + BACKEND-HANDOFF, ledger này, baseline | 🟡 PR mở (docs-only), 3 vòng review Claude độc lập: vòng 3 READY (0 blocking); CI `verify` xanh | [#42](https://github.com/maingocanh1702/plexco-app/pull/42) | owner merge = ký DD-122 |
| M1 | A | Shell PWA (manifest · SW · offline · icons) + tokens DD-81 target C + Google sign-in UI + tạo CLB | ⬜ chưa bắt đầu | — | `GOOGLE_OAUTH_*` staging (default C4) |
| M2a | A | `authorize()` DD-56 M2/M3 thay cổng tạm + route GET session (list/detail) | ⬜ | — | — |
| M2b | A | Host workspace UI: list/detail/create/edit/publish/close/cancel | ⬜ | — | M2a |
| M2c | A | Roster host-add (Tier C #1 default) + gạch nợ thủ công DD-40 (cash/transfer, reversal) | ⬜ | — | M2a; security review |
| M3 | A | Zalo webhook durable + link CLB⇄bot + link account⇄Zalo (`link_code` caller đầu tiên) | ⬜ | — | credentials Zalo OA (DD-14/15) · egress evidence (E6) |
| M4 | A | Settings tối thiểu (profile · linked channels · locale CLB) | ⬜ | — | M1, M3 |
| M5 | A | Staging DO App Platform + Managed PG VPC, log, PITR drill, E2E, runbook tenant #1, go/no-go | ⬜ | — | owner: tài khoản DO + secret staging; deploy production = owner (P0) |
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

## Proposal đang mở (🟡, do lane viết, chờ owner)

_(chưa có — lane M1/M2 sẽ ghi proposal về dependency/pattern mới trong cùng PR của chúng)_

## Việc kế tiếp

1. Owner merge PR M0 (= ký DD-122). 2. Primary mở M1 (shell PWA + sign-in + tạo CLB) và M2a (`authorize()`)
song song trên hai worktree; M2a đi trước M3 vì cùng đụng migration tail.
