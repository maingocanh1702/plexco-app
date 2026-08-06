<!-- review-readiness: historical -->

# Walkthrough — Round 2 P1 Fixes

> **Classification:** Historical session log only. Not a readiness assessment, design gate, implementation plan, or authorization to build `.pen`/runtime.
> **Repository snapshot:** `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4` (baseline pinned by all 12 FE specs)
> **Reconciled against live repo:** 2026-08-06 at `2cd52ce`. Every row below was re-read from the file it describes; version numbers and identifiers are as-of that read, not as-of the original edit.

## What Changed

### 10 Fix Groups Applied

| Group | File(s) | Key Fixes |
|-------|---------|-----------|
| 1. Members | `feature_members_fe.md` | Wireframe split: gate là server-owned `hasFinancialHistory`, không phải remaining debt. `false` → ✅ Merge; `true`/unknown/denied/dependency error → 🔒 chặn, kể cả nợ = 0. Edge case #3 rewritten. v0.4 |
| 2. Settings | `feature_settings_fe.md` | Structural split: `/dashboard/settings` = CLB/Bank/Kênh only. New `/me/settings` = Hồ sơ/Bảo mật. Connector capability gates + expired/insufficient states. v0.4 |
| 3. Auth | `feature_auth_fe.md` | Verify email: GET-inert (landing → button → POST). Reset-password: GET scrub token vào memory, chỉ submit cuối mới gọi API. Password: 15–128 (no composition). Google: conditional on gate. Edge case #4 fixed. v0.2 |
| 4. Onboarding | `feature_onboarding_fe.md` | Zalo CO-OQ-1 blocked (manual secret only, FE không gọi `getMe`, không tự set `active`). Readiness = 3 steps (CLB config + bank active + first session). Bank = opaque `bankSelectionRef`. v0.2 |
| 5. Sessions | `feature_sessions_fe.md` | Payment widget **omit hoàn toàn** tới khi owner contract Reviewed — không dựng QR/STK từ player-self `payAction` (§ contract gap). Price change khi đã có charges: chỉ trình bày 2 policy target, **Save bị block**, không tự invent `impact_policy`. Capacity guard với live holds = edge case **#11** (server trả canonical occupancy/max, FE không tự sum). v0.2 |
| 6. Payments | `feature_payments_fe.md` | Capability gate = `payment_reconcile_auto` entitlement + server availability (thay `host_pro`). Reversal là append-only: FE **không hardcode post-state**, server append entry rồi trả canonical `matched \| partial \| unmatched`; FE refresh và render. v0.3 |
| 7. Player/Market/Notif | 3 files | Player: FE không tự render QR/STK/pay_code, bỏ `QRPayment`, không cache person-self DTO. Marketplace: "5 trống" not "5/8". Notifications: bỏ join/leave/waitlist activity type khỏi surface (deferred bởi `NTF-OQ-18`) nên không còn template nào mang tên người; swipe-dismiss removed. v0.4 |
| 8. Dashboard | `feature_dashboard_fe.md` | Owner contract disclaimer cho stat card aggregates; `StatCard`/`SparklineMini` design-only. v0.2 (status "Draft shell") |
| 9. Meta docs | `docs_comparison.md`, `2026-07-31-fe-design-specs.md` | Verdict purged. Classification block added. file:// → relative paths. Score caveats |
| 10. Level 3.1 | `level3.1-design-discussion.md` | Re-pinned tầng authority: canonical `86fafd5d06aa3b162da09a74c676e50915b88e62` KIT_VERSION 25, Plexco `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4` KIT_VERSION 25. **Cả hai là immutable snapshot ngày 2026-07-31, không phải alias cho "current"** — kit trong repo đã lên v31 (`scripts/autopilot-scope-gate` header) tính đến 2026-08-06 |

### Files Modified (13)

1. `docs/channels/web/FE/feature_members_fe.md`
2. `docs/channels/web/FE/feature_settings_fe.md`
3. `docs/channels/web/FE/feature_auth_fe.md`
4. `docs/channels/web/FE/feature_onboarding_fe.md`
5. `docs/channels/web/FE/feature_sessions_fe.md`
6. `docs/channels/web/FE/feature_payments_fe.md`
7. `docs/channels/web/FE/feature_player_view_fe.md`
8. `docs/channels/web/FE/feature_marketplace_fe.md`
9. `docs/channels/web/FE/feature_notifications_fe.md`
10. `docs/channels/web/FE/feature_dashboard_fe.md`
11. `docs/channels/web/docs_comparison.md`
12. `docs/sessions/2026-07-31-fe-design-specs.md`
13. `docs/autopilot-templates/level3.1-design-discussion.md`

> Tất cả 13 file (cùng `feature_chat_fe.md`, `feature_home_fe.md`, `fe-spec-template.md` và chính file này) vẫn **untracked** tại `2cd52ce`. Chưa có gì được commit.

## Verification

### Automated Sweeps

Lệnh chạy từ repo root; `FE=docs/channels/web/FE`.

| Sweep | Command | Result |
|-------|---------|--------|
| `host_pro` đã bị gỡ | `grep -rn "host_pro" $FE` | ✅ 0 matches |
| Không còn rule 8 ký tự | `grep -rnE "(^\|[^0-9])8 ký tự" $FE` | ✅ 0 matches — chỉ còn 15–128. ⚠️ Pattern trần `8 ký tự` **không** dùng được: nó khớp đuôi của "15–12**8 ký tự**" và trả 3 hit |
| Không còn absolute path | `grep -c "file:///Users" docs/channels/web/docs_comparison.md` | ✅ 0 matches (converted to relative) |
| Denominator `X/Y slot` | `grep -rnE "[0-9]+/[0-9]+ *(slot\|chỗ)" $FE` | ✅ Chỉ host-facing: dashboard 2, sessions 5; player_view / marketplace / home / notifications = 0. **chat = 1 nhưng là hàng trích dẫn trong ghi chú R3-3** (`feature_chat_fe.md:119`) giải thích vì sao `3/8` bị gỡ — không phải UI |
| Tên người trong notification template | `grep -rnE "Lê \|Trần \|Nguyễn " $FE/feature_notifications_fe.md` | ✅ 0 matches. Lý do là structural: join/leave/waitlist bị loại khỏi closed-set type (`NTF-OQ-18`), không phải sửa chữ trong template |
| Không có tiền trong notification | `grep -rnE "[0-9]{2,3}k\|VNĐ" $FE/feature_notifications_fe.md` | ✅ 0 matches |

### Integrity checks (chạy 2026-08-06)

| Check | Result |
|-------|--------|
| Source doc version pin trong footer 12 FE spec vs `> **Version:**` thật của `docs/features/*` | ✅ 12/12 khớp |
| Baseline SHA pin | ✅ 12/12 dùng `0c5808fc...`; là ancestor của `2cd52ce` |
| Relative link trong 17 doc mới | ✅ 0 broken |
| `DD-25/55/76/79/91` + mọi `*-OQ-*` được tham chiếu | ✅ tồn tại trong `decisions.md` / `docs/features` |
| Template section (`## 1`–`## 7`) | ✅ 12/12 đủ 7 section |
| `node scripts/check-review-readiness.mjs --all` | ✅ PASS (29 classified docs, 39 active verdict blocks) |

## Round 3 — 2026-08-06 (áp lên cùng 12 FE spec + template)

Round 2 đóng được các lỗi *nội dung so với source*. Round 3 đóng ba lớp còn lại, phát hiện khi đối
chiếu 12 spec với template và với HARD RULES:

| # | Lỗi | Phạm vi | Sửa |
|---|---|---|---|
| R3-1 | **i18n sai API.** Spec dùng key-style `t('landing.hero_title')`; repo chỉ có `packages/core/src/i18n.ts` → `t(vi, en)`, và `HANDOFF.md:87` + `decisions.md:709` chốt `t(vi, en)`. Không một chuỗi EN nào trong 12 file | **12/12 file** + template | Đổi cột §6 sang ``i18n `t(vi, en)` ``, chuyển toàn bộ cell sang cặp chuỗi thật; data/server-localized ghi rõ thay vì bịa cặp. Dashboard (0 cell) được thêm bảng `Shell copy (i18n)` |
| R3-2 | **Không có error mapping.** Template `:66` bắt buộc pin status/error → visible state mỗi screen; cả 12 file có **đúng 1** status code trên 3686 dòng | **12/12 file** | **30 bảng** error mapping, **78 mã** lấy verbatim từ BE tech docs + route thật, mỗi bảng kết bằng hàng unknown/missing/timeout fail-closed. Endpoint chưa có catalog ⇒ `UNPINNED error catalog — omit active UI`, không bịa mã |
| R3-3 | **5 field/state không có nguồn** | 5 file | `SĐT sân` (sessions) gỡ — schema chỉ có `venue_name`/`venue_address`, DD-50 phase-1 không thu SĐT · `🟢 paid` (home) gỡ — union canonical chỉ `open \| partial` · `recalc chips` (home) → refetch aggregate, `feature_home.md:26` cấm tự tính · `[System] 3/8 slot filled` (chat) gỡ — không producer nào được authorize ghi system message + denominator player-facing · `RunningTotal` (payments) → `AllocationTotal` hiển thị số server trả, gỡ mâu thuẫn với chính negative scope |
| R3-4 | **chat/home tụt round-2** — §6 UNPINNED 100% nhưng §3–§7 mô tả UI sống, thiếu fence mà 10 file kia đều có | 2 file | Thêm `Current implementation boundary`; DM entry point omit tới khi safety gate live (`feature_inapp_chat.md:95`) |
| R3-5 | **Password rule không được cite.** `15–128` là thật nhưng nằm ở DD-80, không phải feature doc v2.11 được header cite; state "mật khẩu đã bị lộ" nguồn là **design probe chưa Reviewed** | auth | Bổ sung 2 dòng Source authority riêng; tách edge case 4/4b và đánh dấu blocklist state là design target chưa authorize |
| R3-6 | **`58 commit` sai** — `git rev-list --count 3d75c90..2cd52ce` = **88** (`--first-parent`/`--no-merges` cũng 88) | ROADMAP v3.4m · BUILD-STATUS | Sửa thành 88 kèm lệnh tái tạo |

Template cũng được sửa để lỗi không tái sinh: cột i18n đổi shape + thêm rule cấm key-based, và
`#### Error mapping` nâng từ blockquote lên **bảng bắt buộc** có sẵn khung.

### Verification round 3

| Check | Result |
|---|---|
| `grep -rn "t('" $FE` (trừ `Intl`) | ✅ 0 |
| File có i18n note | ✅ 12/12 |
| Bảng error mapping / hàng fail-closed | ✅ 30 / 30 |
| **78 mã lỗi vs `docs/features/BE` + `apps/web/app` + `packages`** | ✅ 78/78 tồn tại verbatim, 0 mã bịa |
| Template section `## 1`–`## 7` | ✅ 12/12 giữ nguyên 7 |
| Relative link (12 FE + template + ROADMAP + BUILD-STATUS) | ✅ 0 broken |
| `check-review-readiness --all` | ✅ PASS (29 docs, 39 blocks) |

## Round 4 — 2026-08-06 (đóng nốt lớp SHOULD-FIX)

| # | Lỗi | Phạm vi | Sửa |
|---|---|---|---|
| R4-1 | **Thu PII không có consent.** Wireframe `/me/settings` thu `gender` + `dob` — `feature_user_settings.md:29` chốt cả hai là **PII có consent** (NFR-P1), mã hoá at-rest, ngoài public whitelist — nhưng không có consent affordance nào, và §6 không có row cho `dob` | settings | Thêm consent toggle làm **gate** cho 2 field, CTA xem/thu hồi (USR-UC-6), 2 row §6 mới, sửa Flow 4 |
| R4-2 | **Lý do omit CTA sai sự thật.** Edge case 8 ghi "chưa có `member.manage_routine` command/capability cho host" — capability **có tồn tại và mặc định được cấp** (`feature_tenant_routing_authz.md:106`); thứ thiếu là command/endpoint | members | Viết lại đúng: thiếu endpoint + DTO, không phải thiếu quyền |
| R4-3 | **Client tự mark-read và tự dựng route.** §7 ghi "Tap → navigate + auto-mark-read" và edge case 9 hardcode `→ /me`, ngược §2 bước 3–4 ("server re-authorize rồi mới tạo read row"; "không tự build route từ type hay payload") | notifications | Cả hai đổi sang opaque source ref → resolver → authorized target; không optimistic |
| R4-4 | **Enum tiền bị gộp im lặng.** `SourceBadge` chỉ có 3 badge và gộp `auto`+`manual` thành "CK"; enum canonical có **5** giá trị `auto/manual/cash/waiver/reversal` (`feature_payment_reconcile.md:275`) — mất phân biệt khớp-tự-động với host-xác-nhận-thủ-công | payments | Khôi phục đủ 5, cấm gộp, mapping màu chờ owner contract |
| R4-5 | **`paid` sống sót ở 2 chỗ nữa** sau khi R3-3 gỡ ở component row: wireframe/edge-case của home và `UpcomingRow` của player_view vẫn vẽ 🟢 | home · player_view | Đổi sang `—`; edge case 5 chuyển thành refetch aggregate |
| R4-6 | **State list mâu thuẫn fence.** members và settings có fence ở wireframe nhưng §3 States vẫn khai `Ready` như surface sống | members · settings | Thêm dòng `Current implementation` + đổi `Ready` → `Ready (target)` |
| R4-7 | **Thiếu `#### Responsive` per screen** — template `:69-75` bắt buộc; 9/12 file thiếu toàn bộ hoặc một phần | 12 file | **31 bảng**, phủ 31/31 screen. Nơi wireframe không đủ để mô tả trung thực thì **ghi rõ là chưa pin ngưỡng**, không bịa số |
| R4-8 | **Thiếu fixture fence** ở sessions và notifications dù §6 UNPINNED toàn bộ | 2 file | Thêm fence; riêng sessions ghi thẳng ra **header và §6 mâu thuẫn nhau** (header nói chỉ payment widget unpinned, §6 nói mọi field unpinned) và §6 là dòng chặt hơn nên governing |
| R4-9 | **Provenance thiếu** — token load-bearing đến từ BE tech doc mà header không cite | members · settings · payments · sessions · auth · onboarding | Thêm dòng `Source authority (BE tokens)` nêu đúng token + nói rõ token đó **không** nằm ở feature doc được cite |
| R4-10 | NIT | notifications · members | Priority prose → số 11; footer members khôi phục `feature_payment_reconcile.md` + BE tokens |

### Verification round 4

| Check | Result |
|---|---|
| `#### Responsive` / screen | ✅ **31/31** — không file nào còn thiếu |
| `#### Error mapping` tables | ✅ 31 |
| Fixture fence | ✅ 12/12 file |
| **78 mã lỗi** vs `docs/features` + `docs/standards` + `apps/web/app` + `packages` | ✅ 78/78 verbatim, 0 mã bịa |
| `t('key')` còn lại | ✅ 0 |
| `🟢 paid` trong UI | ✅ 0 (chỉ còn trong câu phủ định giải thích) |
| Section `## 1`–`## 7` | ✅ 12/12 |
| Relative link | ✅ 0 broken |
| `check-review-readiness --all` | ✅ PASS |

> **Còn mở, cố ý không tự quyết:** (1) sessions — header vs §6 bất đồng về phạm vi `UNPINNED`, cần owner
> chốt; (2) marketplace §7 để ngỏ "modal overlay **hoặc** separate page" cho detail desktop; (3) breakpoint
> 768px chưa được pin ở chat/home (file chỉ vẽ 375 và ≥1024); (4) HTTP status cho phần lớn payment-reconcile
> catalog chưa pin (`feature_payment_reconcile_tech.md:472`) nên cột Status để `—`.

### Remaining Expected Patterns

- Dashboard/Sessions dùng `6/8 slot` — **correct** (host thấy filled/total)
- Chat system message dùng `3/8 slot filled` — **correct** (server-generated auto-message)
- `feature_dashboard_fe.md` ghi `FE design status: Draft shell` trong khi 11 file còn lại ghi `Draft` — cố ý (dashboard bị omit zone 1–4), nhưng lệch enum của `fe-spec-template.md`
- 12 FE spec không mang `<!-- review-readiness: ... -->`. Không phải lỗi gate: validator chỉ bắt buộc marker với file có tên chứa `review|readiness|plan` hoặc có block `REVIEW_VERDICT:`

---

_Historical session walkthrough · 2026-07-31 · reconciled 2026-08-06 at `2cd52ce` · no active verdict_
