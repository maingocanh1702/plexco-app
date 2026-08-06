# Sporta payment FE docs → Plexco: port analysis

> **Loại:** research / comparative analysis. **KHÔNG phải** review verdict, readiness gate, hay build contract.
> Không resolve open question nào ngoài việc **mở 2 proposal mới** (DD-97/DD-98 🟡 — chờ owner).
>
> **Cập nhật cùng ngày (decisions v2.18):** DD-97 (✅ direction + entitlement: view free · kỳ/export `host_pro`) và DD-98 (✅ NP-1..5) đã chốt owner-delegated. Các chỗ "chờ owner" trong file là snapshot trước thời điểm chốt.
>
> **Ngày:** 2026-08-07
> **Input (external, non-authoritative):** 5 FE docs `Sporta/docs/Phase 2/FE/` — `feature_auto_reconcile.md` · `feature_auto_remind.md` · `feature_dynamic_vietqr.md` · `feature_invoice_export.md` · `feature_timeout_partial.md`. Sản phẩm khác, host-centric, mobile app; dùng làm tham khảo UX, KHÔNG phải authority.
> **Baseline Plexco:** `main@7e21f65dc4eff0fb845448d8c9a974bcb64f7edb` — `packages/db/schema.ts` (charges/payment_allocations/bank_transactions/pay_code) · `feature_payment_reconcile.md` v1.10 · `feature_notifications_reminders.md` v3.11 · `feature_channel_booking_funnel.md` · `FE/feature_payments_fe.md` v0.3 · `FE/feature_player_view_fe.md` · `feature_billing_lifecycle.md` · `decisions.md`
> **Method:** mọi claim "Plexco có/không có" verify bằng live schema + spec text, không suy từ trí nhớ.
> **Sibling:** `sporta-session-docs-gap-2026-08-07.md` (cùng ngày, phạm vi session docs — file này phạm vi payment FE).

---

## 1. Verdict tổng

| Sporta doc | Plexco đã có? | Port được gì |
|---|---|---|
| `feature_auto_reconcile` | ✅ Mạnh hơn (ledger/allocation/append-only reversal, `pay_code` DD-02, entitlement DD-40 + availability tách rời) | UX pay screen: live status, reconnect, latency indicator → design input |
| `feature_dynamic_vietqr` | ✅ Một phần (`pay_code` per charge; QR/STK server-driven qua `payAction`) | UX: bank deep link, tap-to-copy, fallback text → design input. ❌ Custom split → DD-98 NP-1 |
| `feature_auto_remind` | ✅ BE contract vượt xa (NTF-UC-1..11: quiet hours tenant-tz, cooldown, override-with-reason, delivery report); **thiếu FE spec host config** | Wireframe config screen → design input cho A17/F11 family |
| `feature_timeout_partial` | ✅ Partial (charge `open\|partial\|paid\|void`); hold chỉ unlinked channel funnel (DD-32 Option D, 15') | UX countdown/progress → design input. ❌ Hold cho linked member → DD-98 NP-2 |
| `feature_invoice_export` | ❌ **Gap thật** — billing_lifecycle là host *subscription*, không có statement/export nào | Cả feature, reshape → **DD-97 🟡** |

## 2. Chi tiết đối chiếu

### 2.1 auto_reconcile — không port core

Core Sporta (webhook match → confirm ≤5s, unmatched → manual, idempotent, partial detect) Plexco đã sở hữu ở dạng chặt hơn: deterministic `pay_code` match (DD-02), `payment_allocations` append-only + reversal (không sửa/xoá), entitlement `payment_reconcile_auto` **≠** runtime availability (billing_lifecycle pin cả hai phải PASS). Host board đã có ở `feature_payments_fe.md` (surface còn `UNPINNED` chờ DTO owner). Không có gì để port ở tầng contract.

Khác biệt transport: Sporta WebSocket riêng — Plexco đã chốt SSE (DD-07). Mọi live-update port đều đi SSE hiện có, không mở kênh song song.

### 2.2 dynamic_vietqr — port UX, chặn split bill

`pay_code` unique per charge (trần 4 ký tự, prefix registry — DD-02) tương đương "unique transfer code". Ranh giới cứng phía Plexco: `feature_player_view_fe.md:221` — FE KHÔNG tự render QR/STK/pay_code; mọi thứ qua `data.clubs[].status.payAction` (BE tech `:186`: `{ kind: "open_protected_pay"; href }`). **Surface đích của `href` (protected pay display) chưa có FE spec owner** → toàn bộ UX port (copy fields, deep link + fallback, QR-fail fallback text, live status) ghi ở design input, chờ owner surface đó.

Custom split per player: đụng thẳng charge-derivation canonical (DD-39/41/45/49) → DD-98 NP-1.

### 2.3 auto_remind — BE vượt, FE config là gap nhỏ thật

Đối chiếu từng cột: Sporta frequency 6/12/24h cứng — Plexco escalation thresholds theo policy (mặc định 2h → 24h, NTF-UC-2); Sporta quiet hours device-local — Plexco theo **tenant timezone** (spec `:95`); Sporta max-reminders slider — Plexco cooldown + rate-limit + override-require-reason (NTF-UC-6); Sporta "check status trước gửi" — Plexco **effective charge state** + re-authorize ngay trước provider write (`:106`); Sporta push kèm số tiền+QR — Plexco **cấm** (OS push generic-only, NTF-UC-7) → DD-98 NP-3.

Gap thật: chưa FE spec nào sở hữu host reminder-policy config UI (`settings_fe`/`dashboard_fe` không có). Wireframe Sporta (toggle · schedule · quiet hours · preview "next remind at") là input tốt → design input §2, gate entitlement `reminders_auto`, absent-not-disabled.

"Nhắc gộp" multi-session của Sporta = scoped-bulk/grouping đã nằm trong **DD-88 `DEFERRED_PROPOSAL`** — không mở đường mới, chỉ ghi làm input DD-88.

### 2.4 timeout_partial — port cách hiển thị, không port model

Plexco hold **hẹp có chủ đích**: 15' chỉ cho unlinked channel pay-now (DD-32 Option D); occupancy = active + live holds; expiry → release + audited requeue-tail; payment-sau-expiry → manual review/refund-or-credit (CBF edge đã pin — Sporta `REFUND_NEEDED` không cần import). Linked member không bao giờ mất chỗ vì chưa trả → nợ đi đường reminders. Sporta "host toggle hold cho mọi player" = admission model khác → DD-98 NP-2.

Port được cách hiển thị: countdown từ server `timeout_at` (Sporta cũng pin server-time — hiếm hoi trùng khớp nguyên tắc), warning <5'/<1', partial progress presentation từ `amountDue`/`amountAllocated` server trả → design input §3 + enrich `feature_player_view_fe.md` v0.5.

### 2.5 invoice_export — gap thật → DD-97

Không spec nào sở hữu: bảng tổng kết ai-trả/ai-thiếu per session/kỳ + export PDF/XLSX. `feature_billing_lifecycle.md` = **platform thu tiền host** (subscription), không phải host thu tiền player. Input đã canonical đủ: charges + allocations (5 source values, reversal signed) + bank_transactions. DD-89 job foundation đã land (schedule OFF) cho async export. Reshape bắt buộc so với Sporta: composition-only (không bảng tiền mới), download authenticated tenant-scoped (HR2 — không public signed URL), behavior-contract-only cho async (không authorize job enablement), share-qua-chat ngoài scope. Chi tiết: DD-97.

## 3. Quy tắc chuyển đổi (áp cho mọi port từ Sporta)

1. Tiền server-authoritative — không client compute/sum/validate; unknown → fail-closed "—", không 0.
2. Realtime = SSE (DD-07), không WebSocket mới.
3. OS push generic-only; chi tiết sau authenticated fetch.
4. Error code theo catalog BE; chưa pin → `UNPINNED — omit active UI`, không mượn mã Sporta.
5. i18n `t(vi, en)` mọi chuỗi (Sporta hardcode vi).
6. Analytics không raw amount/PII — bucket như CBF (`amount_bucket`, `ttl_bucket`).
7. Entitlement absent → omit surface, không disabled control.
8. 4-states loading/ready/empty/error — hai bên trùng chuẩn, port dễ nhất ở đây.
9. Không cache person-self/money DTO offline.
10. Status enums không map 1-1 (UNPAID/CONFIRMED vs `open|partial|paid|void` + `matched|partial|unmatched`) — luôn dùng vocabulary Plexco.

## 4. Hành động đã thực hiện trong session 2026-08-07

| # | Hành động | Artifact | Trạng thái |
|---|---|---|---|
| 1 | Enrich FE spec Draft (phần khớp surface hiện có) | `../channels/web/FE/feature_player_view_fe.md` **v0.6** — partial progress presentation, settle-while-viewing edge, không thêm surface mới (v0.5 cùng ngày thuộc session song song khác, thêm 4 section Draft riêng) | ✅ session này |
| 2 | Design input cho các surface chưa có owner | `../proposals/sporta-payment-ux-port-design-input-2026-08-07.md` — protected pay UX · reminder-config UI · CBF countdown | ✅ session này |
| 3 | Proposal statement/export | `decisions.md` **DD-97 🟡** | ✅ ghi, chờ owner |
| 4 | Negative scope ratification | `decisions.md` **DD-98 🟡** (NP-1..4) | ✅ ghi, chờ owner |

Không sửa spec Reviewed nào; không authorize code/runtime/enablement; commit để lại cho owner theo root-lock workflow.
