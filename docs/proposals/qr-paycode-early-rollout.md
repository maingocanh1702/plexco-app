# Đề xuất: Đưa QR cá nhân hóa + pay_code lên sớm hơn P4

> **Trạng thái:** Draft để review · 2026-06-24
> **Liên quan:** TDD §3.6/§3.7 · `feature_payment_reconcile_tech.md` §4 · `business-rules.md` BL-PAY-3 · `player-side-saas-reconciliation.md` §1/§3 · AUDIT C2/G1
> **Câu hỏi gốc:** Cơ chế "bot tự gửi QR cá nhân hóa cho từng session/player + auto-confirm CK" — có thể bật sớm trên Plexco không, và phải xử lý gì?
>
> ⚠️ **Current channel note (DD-37/DD-15/DD-65..68):** Telegram examples và `ChannelReachability(person,tenant,platform)` bên dưới là historical input. Kênh hiện hành = Zalo + Messenger + web; cả Zalo và Messenger dùng provider-endpoint identity, reachability gắn `channel_identity_id`, tenant eligibility authorize riêng và delivery chọn một route. Khi conflict, theo `../standards/decisions.md` v1.45 và feature identity/notification specs hiện hành.

---

## 1. Tóm tắt

Có. Về bản chất đây chính là luồng **reconcile CK killer-flow** của Plexco, chỉ khác cơ chế khớp:

- **P3 (hiện tại):** memo **name-based** — matcher khớp bằng `tên + amount + ngày`, FIFO 2-buổi-identical. QR (nếu có) chỉ là QR tài khoản chung, người chuyển tự ghi nội dung.
- **Mục tiêu sớm:** mỗi `charge` (= 1 player × 1 session) phát **một pay_code deterministic** + **VietQR cá nhân hóa** nhúng sẵn STK + amount + nội dung = pay_code → webhook về khớp **1 phát đúng** thay vì đoán theo tên.

Spec đã chừa sẵn chỗ: cột `membership.pay_code` (`UNIQUE(tenant_id, pay_code)`), nhánh matcher `pay_code` nullable, VietQR lib `img.vietqr.io`. Việc "đưa sớm" = **bật nhánh đang tắt** + bổ sung sinh mã/QR + migration, **không phải xây mới từ đầu**.

Lý do spec hoãn sang P4 **không** phải vì khó kỹ thuật mà vì **an toàn đối soát đa-tenant**: phát mã sai/đổi cơ chế khớp giữa chừng có thể gây ghi nhầm tiền giữa các CLB. Đề xuất này giữ nguyên 4 bất biến tài chính, chỉ rút ngắn lộ trình bằng cách chạy **song song name-based + pay_code** thay vì cắt phụ thuộc đột ngột.

---

## 2. Khoảng cách giữa "hiện tại" và "QR + pay_code"

| Thành phần | P3 đã có | Cần thêm để bật sớm |
|---|---|---|
| `charges` (player×session) | ✅ schema đủ | — |
| Webhook ingest + idempotency | ✅ (`UNIQUE(tenant,provider,external_id)`) | — |
| Ledger (writer duy nhất) | ✅ applyAllocations + lock + invariants | — |
| Matcher | ✅ name+amount+date | **Bật nhánh `pay_code`** (parse memo → charge) |
| `membership.pay_code` | ✅ cột nullable | **Sinh mã** deterministic + unique/tenant + backfill |
| VietQR | 📄 chỉ liệt kê lib | **Render QR** per-charge (STK + amount + addInfo=pay_code) |
| Phát mã tới player | ❌ | **Outbox → projector** gửi QR vào DM/group đúng kênh |
| `pending_change` STK (G1) | ✅ schema | Đảm bảo QR **luôn dùng STK hiện hành**, không dùng STK pending |

Kết luận: phần "đường tiền" (webhook → ledger) **đã production-grade**. Việc bật sớm tập trung ở **4 ô**: sinh pay_code, render VietQR, parser memo, projector phát QR.

---

## 3. Phương án rollout — 4 bước, không cắt name-based đột ngột

### Bước 0 — Sinh & gán pay_code (migration + backfill)
- Sinh `pay_code` cho mọi `Membership` đang active: chuỗi entropy đủ, **UNIQUE(tenant_id, pay_code)**, lưu **mã trần trong DB**, hiển thị có prefix CLB (vd `BMC-`) — theo Open Question #3 / OD-2.
- Pay_code gắn **per-membership** (ổn định theo người trong 1 CLB), nội dung CK = `pay_code` để khớp về đúng membership; charge cụ thể suy ra bằng FIFO trong các charge `open/partial` của membership đó (giữ nguyên logic FIFO P3).
- Tránh ký tự dễ nhầm (0/O, 1/l), giới hạn độ dài để vừa `addInfo` VietQR và dễ gõ tay khi người dùng chuyển thủ công.

### Bước 1 — Matcher chạy SONG SONG (shadow trước, enforce sau)
- Bật nhánh parser: `pay_code present & parse OK → deterministic candidate`; **else** rơi về `name+amount+date` y như P3.
- **Giai đoạn shadow:** matcher tính cả hai nhánh, **chỉ name-based được phép auto-allocate**, pay_code chỉ ghi log "would-match" để so. Chạy tới khi tỉ lệ pay_code ⊇ name-based và 0 mâu thuẫn trên fixtures + traffic thật.
- **Giai đoạn enforce:** pay_code thành nhánh ưu tiên; name-based thành fallback cho CK thiếu/sai mã.
- Ngưỡng tin cậy là **policy versioned từ calibration fixtures**, không hard-code (theo §4 tech spec).

### Bước 2 — Render VietQR per-charge
- QR nhúng: STK **primary hiện hành** (KHÔNG dùng `pending_account_number` — G1), `amount = charge.amount_due - amount_allocated`, `addInfo = pay_code`.
- QR là **ảnh suy ra**, không lưu trạng thái tiền → không tạo bất biến mới; nếu amount đổi (partial) thì render lại theo charge hiện tại.
- Lưu ý token/secret theo AUDIT 10.4 (QR giả khi token Zalo lộ): QR chỉ chứa STK + nội dung công khai, **không** nhúng secret; nguồn STK lấy từ `bank_accounts` tenant-scoped, không từ input kênh.

### Bước 3 — Projector phát QR đúng kênh
- Khi tạo charge (hoặc player mở `/pay`): outbox event → projector chọn kênh qua **`ChannelReachability` per (person,tenant,platform)** → gửi QR + pay_code vào DM/group đúng CLB.
- Zalo: bám DM 1-1 (không inline button); Telegram: deep-link/DM. Throttler + jitter như reminder cron.

---

## 4. Rủi ro & mitigation

| # | Rủi ro | Mức | Mitigation |
|---|---|---|---|
| R1 | **Đổi cơ chế khớp giữa chừng** → ghi nhầm/bỏ sót allocation | 🔴 Cao | Shadow-mode trước enforce; name-based luôn là fallback; bật theo tenant (canary) thay vì big-bang |
| R2 | **pay_code đụng độ / đoán được** xuyên tenant | 🔴 Cao | `UNIQUE(tenant_id, pay_code)`; entropy đủ; matcher vẫn **scoped trong tenant** (BL-PAY-3) — mã CLB A không bao giờ khớp charge CLB B |
| R3 | Người chuyển **gõ sai / thiếu** nội dung mã | 🟡 TB | Fallback name+amount+date; mã ngắn + bỏ ký tự dễ nhầm; CK thiếu nội dung → giữ `unmatched`, không đoán theo amount đơn thuần (PAY edge #6) |
| R4 | QR dùng **STK pending** sau khi host đổi STK | 🟡 TB | G1: QR luôn render từ STK **hiện hành**; STK mới chỉ hiệu lực sau 24h pending; notify mọi kênh (BL-PAY-10) |
| R5 | **Claim membership có tiền theo tên** khi pay_code chưa phủ hết | 🔴 Cao | Giữ AUDIT C2: name-match chỉ **đề xuất**, membership đã có nợ cần khoá mạnh (owner/CK từ STK chính chủ/mã link) |
| R6 | **QR giả** do token kênh lộ | 🟡 TB | AUDIT 10.4: KMS + không log + getWebhookInfo drift-detect; blast-radius gói trong 1 CLB |
| R7 | **Double-count** webhook trùng | 🟢 Thấp (đã chặn) | `UNIQUE(tenant,provider,external_id)` + ON CONFLICT DO NOTHING (đã có ở P3) |
| R8 | Migration backfill pay_code va `UNIQUE` | 🟢 Thấp | Sinh trong transaction, retry trên đụng độ; chạy backfill theo tenant |

**Gate enforce (đề xuất, tương tự checklist tech spec):**
1. Calibration fixtures: pay_code-match ≥ name-based, 0 ca over-allocate, 0 cross-tenant leak.
2. Shadow ≥ N ngày trên traffic thật, sai khác được điều tra hết.
3. Test bất biến CI (cô lập tenant, ledger không đếm quá tiền) xanh.
4. Rollout per-tenant canary trước khi mở toàn hệ.

---

## 5. Việc nên làm tiếp

- Chốt **Open Question #3** (`pay_code` hiển thị prefix vs trần) trước Bước 0 — nó định format mã & QR `addInfo`.
- Quyết **pay_code per-membership (ổn định) vs per-charge (1 mã/buổi)**: per-membership rẻ & ổn định + FIFO; per-charge khớp thẳng charge nhưng nhiều mã hơn. Đề xuất: **per-membership** để giữ FIFO P3 nguyên vẹn.
- Bổ sung fixtures pay_code vào bộ test reconcile hiện có (§8 tech spec) trước khi viết code.

> ⚠️ Giả định cần xác nhận: spec mô tả nhánh `pay_code` "có thể tồn tại sau feature flag tắt" nhưng repo **chưa có code TS** (mới docs). Nên Bước 0–3 là **xây mới theo contract đã chốt**, không phải chỉ lật cờ. Nếu bot single-club cũ đã có sinh mã/VietQR, phần đó **lift được** — xem `single-club-bot-port-map.md`.
