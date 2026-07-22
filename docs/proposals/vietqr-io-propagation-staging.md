# Staging: decisions.md entries + feature-spec propagation cho VietQR (D0)

> **Trạng thái:** 🟡 Staging / pre-approval · 2026-07-22 · **KHÔNG sửa bất kỳ spec `Reviewed` nào**
> **Authority repo:** `main@ad10194129a2c46512301a584ca9cec572c11244` · file on-disk chưa commit
> **Nguồn:** `docs/proposals/vietqr-io-payment-integration.md` (decision packet, verdict NOT_PLAN_READY)
> **Mục đích:** chuẩn bị sẵn (a) entry cho `decisions.md` và (b) bản propagation đề xuất cho từng feature spec, để owner review. Nội dung phụ thuộc quyết định được viết theo **khuyến nghị mặc định** và đánh dấu *conditional* — **owner vẫn là người chọn**.

## Guardrail (theo review gate + features/README)

- Đây là **D0 staging**, không phải patch đã duyệt. Không được coi là contract.
- **Không** ghi vào spec `Reviewed` (`feature_payment_reconcile*`) cho tới khi: owner chốt VQR-OQ-1..4 → ghi `decisions.md` → re-Review gate 3 chiều (spec claim ↔ snippet ↔ live code).
- Agent **không** tự chọn product/security policy: 4 quyết định dưới đây để **owner** chốt; mặc định chỉ là khuyến nghị.
- Money/PII: mọi nội dung giữ nguyên 5 HARD RULES (QR/STK không ra `public_sessions`; money custody không đổi; ledger reuse; không thêm `bank_transfer` vào source enum).

---

## A. Entry đề xuất cho `docs/standards/decisions.md`

> Ghi dạng **proposal** (🟡), owner approve mới thành ✅. Số DD do owner cấp (repo hiện ~DD-01..82 → dự kiến DD-83+). OQ-5/6 giữ deferred, không mở trong đợt này.

### VQR-OQ-1 · Renderer / data path của QR — 🟡 (proposed DD-NN) · CODE-BLOCKING
- **Vấn đề:** render VietQR dynamic mà không lộ STK/holder/amount/memo của host ra provider/CDN/log.
- **Option:** A = tự sinh payload VietQR/NAPAS **local** (không gửi bank data ra provider); B = server-side proxy tới Quick Link (provider vẫn nhận bank data, che IP/referrer player); C = client fetch `img.vietqr.io` trực tiếp.
- **Khuyến nghị:** **A**; B chỉ sau khi security/privacy ghi named data/retention/ToS contract; **C forbidden**.
- **Binary closure:** owner chọn A/B/C **và** security ghi exact data/log/retention contract.
- **Blast radius:** `feature_payment_reconcile_tech` §3 (QR render) + §4 Caching + CSP/allowlist.

### VQR-OQ-2 · Lưu account holder + legacy pending plaintext — 🟡 (proposed DD-NN) · CODE-BLOCKING
- **Vấn đề:** holder là dữ liệu định danh tài chính; hiện `bank_accounts.pending_account_holder` đang plaintext, **không có current holder**.
- **Khuyến nghị:** `account_holder_enc` (KMS) + encrypted pending holder; expand→backfill→retire plaintext theo compatibility window; decrypt/mismatch → HALT, không coerce NULL.
- **Binary closure:** owner/security duyệt at-rest representation + migration compatibility proof.
- **Blast radius:** `feature_payment_reconcile_tech` §2 Schema + Migration & Rollback.

### VQR-OQ-3 · Surface đầu tiên — 🟡 (proposed DD-NN) · CODE-BLOCKING (D3 scope)
- **Khuyến nghị:** protected web `/pay` (player có authorization với charge/session/tenant); bot Zalo/Messenger chỉ gửi deep link **sau**.
- **Binary closure:** owner chọn web-only hoặc exact multi-surface scope.
- **Blast radius:** `feature_payment_reconcile` §2/§3 (Screens), `_tech` §3 API.

### VQR-OQ-4 · Verification tài khoản nhận tiền — 🟡 (proposed DD-NN) · CODE-BLOCKING
- **Vấn đề:** VietQR lookup đã dừng; webhook không chứng minh beneficiary holder.
- **Khuyến nghị:** **owner-declared only** (`owner_declared`, không ghi `verified`); webhook đầu tiên không đổi verification state; nếu cần signal đặt tên `provider_route_observed_at`, không nâng badge/quyền; bankHub Pay Out để slice riêng (D5) sau pricing/KYC/ToS.
- **Binary closure:** owner chọn owner-declared hoặc approve BankHub due-diligence riêng.
- **Blast radius:** `feature_payment_reconcile`/`feature_connector_onboarding` (field trạng thái tài khoản).

### Deferred (không mở đợt này)
- **VQR-OQ-5 · Deeplink (D4 optional):** autofill-aware payer-app chooser; chỉ cần owner quyết trước khi author D4.
- **VQR-OQ-6 · Pay-code timing:** giữ DD-02 phase P4; proposal không đổi phase.

---

## B. Propagation đề xuất per spec

> Nội dung *conditional theo khuyến nghị* (A / holder-enc / web `/pay` / owner-declared). Vị trí mục dựa trên cấu trúc hiện tại của từng spec tại SHA trên; xác nhận exact insertion point khi merge.

### B1. `feature_payment_reconcile.md` — Product (Reviewed v1.7a) → cần re-Review

| Mục | Thêm/sửa (đề xuất) |
|---|---|
| §2 Use Cases | **PAY-UC mới — QR render:** player mở `/pay` cho charge open → server dựng QR/text từ **current destination tuple** + remaining amount; không mutate ledger. **Mở rộng PAY-UC-13/14:** đổi STK nay là đổi **toàn tuple** (BIN+STK+holder+version), preview→confirm (DD-25), promote sau 24h atomic; QR luôn dùng current, fail-closed nếu tuple partial/mismatch. **UC optional (D4):** nút deeplink app người trả (`autofill=1` mới prefilled). |
| §3 Screens & States | Trạng thái QR: available / unavailable (tuple thiếu → text fallback + owner warning) / provider-down (text fallback, ledger unchanged). Error state map về Error Codes catalog BE §3. |
| Domain Model | `current/pending destination tuple = {bank_bin, account_number, holder, version}`; `owner_declared` (không `verified`); QR = ảnh suy ra, không lưu trạng thái tiền. |
| Acceptance / Open Questions | Thêm acceptance rows (mục 6 decision packet). Link VQR-OQ-1..4. |

### B2. `feature_payment_reconcile_tech.md` — BE (Reviewed v1.10) → cần re-Review

| Mục | Thêm/sửa (đề xuất) |
|---|---|
| §2 Schema | `bank_accounts` + `bank_bin`, `pending_bank_bin` (**FK `REFERENCES bank_directory(bin) ON DELETE RESTRICT`**), `account_holder_enc` + encrypted pending holder (VQR-OQ-2), `destination_version`. **Không** thêm `bank_code` (derive từ directory theo BIN). Composite same-tenant FK giữ như §1.8. |
| §2 Migration & Rollback | Additive sau migration mới nhất trên `main` lúc mở worktree (không sửa `0003`/`0009`); nullable expand; **không** suy BIN/holder từ fingerprint/memo — existing rows NULL → **QR OFF tới khi owner re-confirm**; holder backfill bounded + HALT-on-mismatch; rollback = disable QR/destination routes, giữ cột/data. |
| §3 API Contract | Protected QR/text DTO: server derive `{bank_bin, account_number, holder, remaining_amount, addInfo}` từ auth/context; caller không truyền destination/tenant/amount; `remaining_amount` từ canonical balance helper (`<=0` → no QR); validation (BIN active-row, account ≤19, holder non-empty, amount int VND>0, addInfo canonical memo). Error codes tiếng Việt, không lộ secret. Renderer theo **VQR-OQ-1** (A khuyến nghị). |
| §3 Idempotency | QR render idempotent read-only; không tạo ledger effect. |
| §4 Caching | Protected response `Cache-Control: private, no-store`; CSP/allowlist chỉ mở domain cần sau VQR-OQ-1; Option C default forbidden. |
| §5 Testing Plan | Rows từ acceptance matrix: happy/boundary/authz/pending-lifecycle/concurrency/migration/**security-privacy (HR2 invariant: public bytes không có STK/holder/amount/memo/QR URL)**/regression/observability. |
| Security Checklist §4.8 pattern | authz/ownership, redaction (không log plaintext account/holder), no public projection, webhook không đổi verification state. |

### B3. `feature_connector_onboarding.md` — Product (Draft v0.9a) → sửa dễ hơn (đang Draft)

| Mục | Thêm/sửa (đề xuất) |
|---|---|
| §3 Domain Model / §3.2 DDL delta | Giới thiệu `bank_directory` (GLOBAL reference) + host chọn bank → lưu `bank_bin` trên `bank_accounts`. |
| §6 Screens & States | Bước wizard "tài khoản nhận tiền": dropdown chọn ngân hàng (từ directory: shortName + logo), nhập STK + holder → preview masked → confirm (`owner_declared`). |
| §12 Open Questions | Link VQR-OQ-1..4 (đặc biệt OQ-4 verification thuộc onboard). |

### B4. `feature_connector_onboarding_tech.md` — BE (Draft v0.7)

| Mục | Thêm/sửa (đề xuất) |
|---|---|
| §2 Schema | `bank_directory(bin PK, code, name, short_name, logo_url, transfer_supported, lookup_supported_raw, active, source_synced_at, source_snapshot_hash, first_seen_at, last_seen_at)` — GLOBAL, **direct DML revoke, chỉ sync writer mutate**. Migration additive. |
| §4.4 Jobs (pg-boss) | Daily sync worker: full validated snapshot → idempotent upsert; lỗi/count=0/duplicate BIN/schema drift → **abort snapshot, giữ last-known-good, alert**; soft-retire (`active=false`), không hard-delete. |
| §4.7 Caching | Directory đọc qua repository (last-known-good); **không gọi live API trong onboarding/payment hot path**. |
| §4.8 Security Checklist | Directory DML grants revoked; `lookup_supported_raw` không cấp capability verify (VQR-OQ-4 / V6). |
| §5 Testing Plan | Sync failure atomic-abort; new destination chỉ chọn `active=true AND transfer_supported=1`; FK không dangling. |

> **Ghi chú chủ sở hữu:** `bank_directory` + host-bank-selection đặt ở **connector_onboarding** (Draft) vì đó là nơi provisioning `bank_accounts`; destination-tuple + QR render đặt ở **payment_reconcile** (Reviewed → cần re-Review). Đây là split theo domain, chấp nhận đánh đổi phải re-Review 1 spec Reviewed.

---

## C. Bảng conditional — mỗi lựa chọn đổi propagation thế nào

| Quyết định | Nếu chọn KHUYẾN NGHỊ | Nếu chọn khác |
|---|---|---|
| VQR-OQ-1 renderer | A: B2 §3 dựng payload local, không outbound; §4 CSP không mở provider domain | B: thêm named provider data/retention/ToS contract + proxy route + log controls; C: bị chặn (build HALT) |
| VQR-OQ-2 holder | `account_holder_enc` + expand/backfill/retire ở B2 §2 | plaintext holder → phải thêm justification + vẫn cấm log; đổi migration & rollback |
| VQR-OQ-3 surface | Chỉ `/pay` web ở B1/B2 | multi-surface: thêm scope bot (Zalo/Messenger) + auth per-surface |
| VQR-OQ-4 verification | `owner_declared` ở B3/B4; webhook không đổi state | BankHub: mở D5 (spec riêng) + pricing/KYC/ToS/evidence field |

---

## D. Sequencing + gate re-review checklist (trước khi merge propagation)

1. Owner chốt **VQR-OQ-1..4** → ghi `decisions.md` (proposal 🟡 → ✅) với provenance/date + số DD.
2. Propagate B1–B4 vào từng spec (bắt đầu spec **Draft** connector_onboarding, rồi spec **Reviewed** payment_reconcile).
3. **Re-Review gate 3 chiều** từng cặp: spec claim ↔ snippet trong spec ↔ live code/schema; sửa 1 → re-check 2. payment_reconcile phải giữ nguyên các bất biến BL-PAY + không hạ cấp Reviewed vì lý do ngoài blast radius.
4. Cập nhật `features/README.md` coverage nếu status đổi; đồng bộ `BUILD-STATUS.md` (Doc status ≠ Implementation).
5. Re-run **readiness gate cho D1a `bank-directory-schema-access`** trước (root code node), không gộp D1a–D4 thành mega-slice.
6. Chỉ sau `PLAN_READY/CODE_READY` mới tạo autopilot manifest/launcher/worktree.

## E. Self-check (gate compliance của chính staging doc)

- Không sửa file spec nào — chỉ tạo doc staging này. ✅
- 4 quyết định để **owner** chốt; agent không tự quyết product/security. ✅
- Money custody không đổi; không thêm `bank_transfer` source enum; QR/STK không vào public. ✅
- Nội dung conditional đánh dấu rõ theo từng VQR-OQ. ✅
