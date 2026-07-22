<!-- review-readiness: enforce -->
# Đề xuất: Tích hợp VietQR vào payment flow Plexco

> **Trạng thái:** 🟡 Draft decision packet · review-fix 2026-07-22 · **KHÔNG phải spec `Reviewed`, `PLAN_READY`, `CODE_READY` hay runtime đã implement**  
> **Authority repo đã đối chiếu:** `main@ad10194129a2c46512301a584ca9cec572c11244` · target hiện là file on-disk chưa commit  
> **Nguồn ngoài đã probe lại 2026-07-22:** `GET https://api.vietqr.io/v2/banks` · Android/iOS deeplink APIs · VietQR changelog · Quick Link · lookup notice  
> **Canonical repo:** `packages/db/schema.ts` · `packages/core/src/vietqr.ts` · `docs/features/feature_payment_reconcile.md` · `docs/features/BE/feature_payment_reconcile_tech.md` · `docs/standards/decisions.md` (DD-02/24/25/30/40/49) · `docs/standards/business-rules.md` · `docs/00-start-here/HANDOFF.md` §3  
> **Mục tiêu:** đánh giá và đề xuất contract cho (1) danh mục ngân hàng/BIN, (2) sinh QR chuyển khoản, (3) deeplink app ngân hàng và (4) xác minh tài khoản nhận tiền.

---

## 0. Kết luận ngắn

| Mục tiêu | Tình trạng provider 2026-07-22 | Tình trạng Plexco | Khuyến nghị proposal-level |
|---|---|---|---|
| Danh mục ngân hàng/BIN | ✅ API sống; **65** rows tại thời điểm probe | Chưa có `bank_directory` hoặc `bank_bin` | Nên làm thành dependency slice riêng, cache last-known-good; không gọi provider trong hot path |
| Sinh QR chuyển khoản | ✅ Quick Link sống | Chỉ có pure URL builder; chưa có payment route/service/UI | Có thể làm sau khi chốt data-boundary và bank-destination tuple; không gọi là production-ready |
| Deeplink app ngân hàng | ✅ 37 apps mỗi platform; có field `autofill` | Chưa có catalog/UI | Optional; player chọn **app ngân hàng của người trả**; 4 app hiện báo autofill, app khác open-only |
| Verify STK → tên chủ tài khoản | ❌ VietQR lookup đã dừng | Không có canonical beneficiary-verification evidence | Mặc định đề xuất **không auto-verify**; webhook không được nâng thành bằng chứng tên chủ TK |

**Direction hợp lý:** dùng `/v2/banks` làm nguồn danh mục và bổ sung QR vào protected payment surface.

**Không phải “cấu hình + một migration nhỏ”:** cần tách ít nhất bank-directory sync, bank-destination lifecycle và protected QR render; payment feature layer hiện chưa có webhook→settle→notify, `/pay` service hay UI thực thi.

**Default fail-closed trong khi chờ owner:** không render QR khi tuple nhận tiền thiếu/mismatch; không gửi bank data tới VietQR.io; không auto-verify; không bật deeplink/pay-code sớm.

---

## 1. Provider snapshot — dữ liệu live, không phải contract bất biến

### 1.1 Bank list

- `GET https://api.vietqr.io/v2/banks` trả `code="00"`, mô tả **65 banks** tại lần probe 2026-07-22.
- Field hiện thấy: `id`, `name`, `code`, `bin`, `shortName`, `logo`, `transferSupported`, `lookupSupported` và một số field legacy/additive.
- `bin` là BANK_ID phù hợp cho Quick Link và là dữ liệu Plexco đang thiếu.
- VietQR khuyến cáo refresh cache theo ngày. Đây chỉ là cadence provider gợi ý; Plexco vẫn phải có last-known-good, validation, stale policy và alert riêng.
- `lookupSupported` chỉ được lưu như **raw provider metadata**. Không dùng field này để bật account lookup, vì trang lookup chính thức đồng thời ghi dịch vụ đã dừng.

### 1.2 Deeplink app ngân hàng

- Hai endpoint Android/iOS trả **37 apps mỗi platform** tại lần probe 2026-07-22.
- Response có `appId`, `appLogo`, `appName`, `bankName`, `monthlyInstall`, `deeplink`, **`autofill`**.
- `autofill=1` hiện xuất hiện cho VietinBank iPay, BIDV SmartBanking, OCB OMNI và ACB One trên cả hai platform; changelog VietQR ghi các rollout tương ứng từ 2024–2026.
- Không được mô tả deeplink bằng một blanket rule “chỉ mở app” hoặc “thanh toán một chạm”:
  - `autofill=1`: gửi full supported parameter set sau khi server validate;
  - `autofill!=1`/unknown: chỉ open app; luôn giữ QR/copy fallback;
  - deeplink success **không phải** bằng chứng đã thanh toán; ledger chỉ đổi từ webhook/manual allocation canonical.
- App được chọn là **app ngân hàng của player/người trả**, không phải ngân hàng nhận tiền của host.

### 1.3 Account lookup

- VietQR ghi rõ dịch vụ lookup đã dừng và đang migrate sang bankHub Pay Out.
- Vì vậy không dùng `lookupSupported`, endpoint cũ hoặc response cache để gọi tài khoản “verified”.
- Incoming webhook chỉ chứng minh có một giao dịch đã được provider ingest cho bank account đã route; nó không tự chứng minh `account_holder` của tài khoản thụ hưởng. `bank_transactions` hiện không có canonical beneficiary-holder field.

### 1.4 Quick Link và data boundary

Quick Link đặt các giá trị sau vào request URL tới `img.vietqr.io`:

```text
/<BANK_ID>-<ACCOUNT_NO>-<TEMPLATE>.png
?amount=<AMOUNT>&addInfo=<DESCRIPTION>&accountName=<ACCOUNT_NAME>
```

Nếu browser fetch URL này trực tiếp, VietQR.io/CDN nhận STK, holder, amount, memo và metadata request của player; URL còn có thể đi vào browser history, proxy/CDN/access log hoặc referrer.

RLS chỉ bảo vệ việc đọc DB. Nó **không** cho phép tự động gửi plaintext sang provider. Renderer choice là `VQR-OQ-1`, gate code-blocking.

---

## 2. Live repo truth tại authority SHA

| Thành phần | Live truth | Không được suy diễn |
|---|---|---|
| `buildVietQrUrl({bin,account,holder,amount?,addInfo?})` | Có trong `packages/core/src/vietqr.ts`; pure string builder | Không validate bank/account/amount/memo; không chứng minh provider/privacy/route đã sẵn sàng |
| `canBuildDynamicVietQr` | Chỉ kiểm tra `bankBin` và `bankAccount` truthy | Không kiểm tra holder, destination version, active bank, amount hay auth |
| `bank_accounts` | Có encrypted current account number; có pending account number + pending holder | Không có current holder, current/pending BIN hoặc atomic destination tuple hoàn chỉnh |
| Ledger tables | `charges`, `bank_transactions`, `payment_allocations` tồn tại + RLS/trigger baseline | Feature service/writer/wiring chưa build; composite same-tenant FK upgrade trong BE spec vẫn pending |
| `memberships.pay_code` | Nullable column + unique tenant index tồn tại | DD-02 runtime/parser/resolver/rollout chưa build; phase authority hiện là P4 |
| Bank/deeplink directory | Chưa có | Không được gọi live API trong request/payment hot path |
| Web/payment feature layer | Apps mới có shell/auth-era routes; không có `/pay`/reconcile UI/service | Docs/spec và schema không phải runtime/E2E |

### Gap thật để render QR đúng

Renderer cần một **current destination tuple hoàn chỉnh**:

```text
{ bank_bin, account_number, account_holder, destination_version }
```

Live schema chỉ sở hữu một phần. Chỉ thêm `bank_bin` hiện hành sẽ tạo bug khi host đổi sang ngân hàng khác: account number/holder có pending lifecycle nhưng BIN không có snapshot/promotion tương ứng.

---

## 3. Contract đề xuất — chưa thành authority cho tới khi owner duyệt

### 3.1 Canonical bank-destination aggregate

Khuyến nghị giữ `bank_accounts` là aggregate owner hiện có, không tạo bảng payment/order/intent mới. Mọi create/change phải xử lý toàn bộ tuple:

```text
current = { bank_bin, account_number_enc, account_holder_enc, version }
pending = { bank_bin, account_number_enc, account_holder_enc, requested_by, requested_at, activates_at }
```

`account_holder_enc` là recommendation an toàn vì holder là dữ liệu định danh tài chính; exact encryption/backfill contract cần owner chốt ở `VQR-OQ-2`. Không dùng `pending_account_holder` plaintext cho write mới sau cutover nếu chọn encryption.

Không lưu `bank_code` song song trên `bank_accounts`: `code`/`short_name` là derived metadata đọc từ `bank_directory` theo `bank_bin`. Một BIN canonical tránh hai nguồn sự thật drift.

#### State machine

| Current | Pending | Event | Kết quả bắt buộc |
|---|---|---|---|
| none | none | Host submit tuple mới | Preview bind toàn tuple + current version; confirm tạo pending; QR unavailable |
| complete | none | Host submit tuple mới | Preview/confirm tạo pending; current giữ nguyên và tiếp tục phục vụ QR |
| complete | complete, chưa đủ 24h | Render `/pay` | Chỉ dùng current tuple; tuyệt đối không mix field current/pending |
| complete | complete | Host cancel | Clear **toàn bộ** pending tuple atomically; current không đổi |
| complete/none | complete, đủ 24h | System promote | Lock row; revalidate pending proof/version + current owner/capability state + directory; atomic swap toàn tuple; increment version; clear pending; audit |
| any | partial/mismatch/unknown | Render/promote | Fail closed: không QR; không tự đoán BIN/holder; owner alert/re-entry |
| complete | complete | Concurrent change/confirm | Chỉ proof bind current version mới nhất được commit; stale proof trả `BANK_DESTINATION_PREVIEW_STALE` |

#### Authorization và audit

- Set/change/cancel: TenantOwner hoặc exact capability owner-only theo DD-56; không TenantAdmin mặc định.
- Promote: system service/job là writer; nó phải revalidate pending proof, requesting actor/owner capability, current version và directory state trước mutation. User không có endpoint “force promote”.
- Preview/confirm tuân DD-24/DD-25, consume-once, bind exact tuple + actor + tenant + current `destination_version` + expiry.
- Audit tối thiểu: bank account ID, actor, old/new BIN, masked fingerprint, version before/after, action, reason; không log plaintext account/holder.
- QR reader không nhận tenant/account/amount từ body. Server derive tenant, charge, remaining amount và current destination từ auth/context.

### 3.2 `bank_directory` contract

Đề xuất bảng GLOBAL reference-data, không tenant RLS:

```text
bank_directory(
  bin PK,
  code,
  name,
  short_name,
  logo_url,
  transfer_supported,
  lookup_supported_raw,
  active,
  source_synced_at,
  source_snapshot_hash,
  first_seen_at,
  last_seen_at
)
```

Contract vận hành:

- `bin`: format/uniqueness canonical; `code` unique only when provider snapshot proves non-null/non-duplicate.
- `app` được `SELECT` qua repository/service; direct `INSERT/UPDATE/DELETE` bị revoke. `readonly` chỉ được grant nếu có public catalog endpoint được owner duyệt riêng.
- Chỉ dedicated pg-boss sync worker/narrow writer được mutate.
- Daily sync là idempotent upsert từ **một full validated snapshot**. Response lỗi, count=0, duplicate BIN/code, missing required field hoặc schema drift → abort toàn snapshot, giữ last-known-good và emit alert.
- Không hard-delete row mất khỏi snapshot; set `active=false`/`last_seen_at`. Existing FK không bị dangling.
- New destination chỉ chọn row `active=true AND transfer_supported=1`.
- Current destination trỏ row inactive/unknown: dynamic QR fail closed; protected UI vẫn có thể hiển thị current STK dạng text + owner warning, không âm thầm đổi BIN.
- `lookup_supported_raw` không cấp capability verify.

### 3.3 Destination FK và migration direction

Khuyến nghị `bank_accounts.bank_bin` và `pending_bank_bin` là strict FK `REFERENCES bank_directory(bin) ON DELETE RESTRICT`; không dùng “FK mềm”.

Migration phải additive sau migration mới nhất trên `main` tại lúc mở worktree; không sửa lịch sử `0003`/`0009`:

1. Tạo `bank_directory` + grants/writer boundary + last-known-good sync metadata.
2. Thêm nullable current/pending BIN, current holder storage và `destination_version`.
3. Không suy BIN/holder từ account fingerprint hoặc transaction memo. Existing rows thiếu tuple giữ NULL và QR OFF cho tới khi owner re-confirm.
4. Nếu chọn encrypted holder: backfill plaintext pending holder qua bounded KMS/application migration; mismatch/decrypt failure HALT, không coerce NULL; sau compatibility window mới retire plaintext write/read.
5. Update Drizzle schema, migration SQL, DBML/ERD, RLS/grant invariant inventory và migration tests cùng slice.
6. Rollback trước enablement: disable QR/destination mutation routes, giữ additive columns/data; không drop ledger/bank account baseline. Directory sync có thể disable độc lập và tiếp tục đọc last-known-good.

### 3.4 Protected QR render contract

#### Authorization/input owner

- Initial surface recommendation: authenticated web `/pay` hoặc equivalent protected API; player phải có current authorization với exact charge/session/tenant.
- Server derive `{bank_bin, account_number, holder, remaining_amount, addInfo}`; caller không truyền hoặc override bank destination/tenant/amount.
- `remaining_amount = canonical balance helper`, không re-derive tại controller. Helper phải merge trên default branch trước D3; `remaining_amount <= 0` → no QR/no bank instructions.
- Render chỉ từ current tuple cùng một `destination_version`; re-read/revalidate trước response.

#### Validation

- BIN: exact active directory row và renderer-supported BANK_ID.
- Account: renderer contract, tối đa 19 ký tự; reject control/path/query delimiters sau normalization.
- Holder: non-empty canonical display string; size/character policy pin theo renderer; không lấy từ pending/raw webhook.
- Amount: integer VND `>0`, tối đa provider limit; không float.
- `addInfo`: deterministic canonical payment memo; bounded theo renderer, không control chars/secret/free-form caller text.

#### Renderer decision (`VQR-OQ-1`)

| Option | Data exposure | Điều kiện |
|---|---|---|
| A — local VietQR/NAPAS payload generation | Không gửi bank data ra provider lúc render | **Khuyến nghị**; cần design-probe thư viện/spec/license + scan-fixture trên bank apps |
| B — server-side proxy tới VietQR Quick Link | Provider vẫn nhận account/holder/amount/memo; player IP/referrer được che | Chỉ khi owner + security/privacy chấp nhận named provider data contract, retention/ToS và log controls |
| C — client fetch `img.vietqr.io` trực tiếp | Provider nhận cả bank data và client metadata; URL dễ lọt history/log/referrer | **Không khuyến nghị; default forbidden** |

Mọi option:

- Không project QR/STK/debt/memo vào `public_sessions`, OG, CDN public cache, analytics payload hoặc logs.
- Protected response `Cache-Control: private, no-store`; CSP/allowlist chỉ mở domain cần thiết sau decision.
- Fallback: protected text instructions từ current tuple; provider/renderer failure không mutate ledger.
- QR/deeplink không là payment confirmation; chỉ canonical ledger writer được settle.

### 3.5 Account verification policy

Khuyến nghị cho phase đầu:

1. Host nhập bank + STK + holder.
2. Server validate shape + bank directory only.
3. Preview full masked destination; host confirm; lưu trạng thái `owner_declared`, **không ghi `verified`**.
4. Webhook đầu tiên không đổi verification state.
5. bankHub chỉ mở trong proposal/slice riêng sau pricing/KYC/ToS, exact evidence field, error/retry, retention và provider-outage policy.

Không dùng từ “soft verify” cho incoming transaction. Nếu cần operational signal, dùng tên khác như `provider_route_observed_at`; signal này không chứng minh beneficiary holder và không được nâng quyền/UX badge.

### 3.6 Deeplink contract

- Optional slice sau protected QR; không chặn bank directory hoặc QR core.
- Cache catalog theo platform; composite key `(platform, app_id)`; lưu `autofill`, `source_synced_at`, snapshot hash và soft-retire.
- Player chọn payer-bank app. Không tự chọn app theo host bank.
- `autofill=1`: server build deeplink với validated beneficiary/amount/memo; `autofill!=1`: open-only + UI nói rõ còn phải quét/nhập.
- App unknown/retired/missing: ẩn deeplink, giữ QR/copy fallback.
- Không gọi deeplink là “1 chạm”; không đánh dấu paid từ return URL hoặc app-open result.

### 3.7 Pay-code boundary

- DD-02 đã chốt pay-code contract và phase authority hiện là P4; proposal này không tự đổi phase.
- Khi pay-code runtime chưa enabled, `addInfo` dùng canonical memo contract hiện hành của Payment Reconciliation, không tự tạo name-based format mới trong controller.
- Khi pay-code được enable qua slice/authority riêng, QR chỉ consume canonical pay-code formatter/resolver output.
- `qr-paycode-early-rollout.md` là proposal tham khảo, không phải merged runtime/dependency.

---

## 4. Dependency graph và slice boundary đề xuất

| Thứ tự | Slice | Loại dependency | Phạm vi | Negative scope |
|---|---|---|---|---|
| D0 | `vietqr-owner-decisions-and-spec-propagation` | CODE-BLOCKING DOC | Chốt VQR-OQ-1..4; ghi authority; cập nhật cặp Payment Product/BE | Không code/migration |
| D1a | `bank-directory-schema-access` | ROOT SLICE sau D0 | One migration + Drizzle/DBML/grants + migration fixtures | Không worker, bank account mutation, QR, deeplink |
| D1b | `bank-directory-snapshot-sync` | PRIOR_SLICE: D1a | Snapshot validator/upsert repository + pg-boss job + last-known-good tests | Không schema redesign, bank account mutation, QR |
| D2a | `bank-destination-tuple-schema` | PRIOR_SLICE: D1a | One additive migration + schema/backfill/invariant fixtures | Không endpoint/service/QR/BankHub |
| D2b | `bank-destination-preview-promote-service` | PRIOR: D1b + D2a | Versioned preview/confirm/cancel/system-promote core + audit tests | Không host UI, QR render, ledger writer |
| D2c | `bank-destination-host-surface` | PRIOR_SLICE: D2b | Protected host endpoints/UI over existing service | Không duplicate lifecycle logic, QR, BankHub |
| D3 | `protected-payment-qr-render` | PRIOR: D2b + merged canonical balance/payment/session read path | Protected QR/text DTO, validation, chosen renderer, HR2 tests | Không public projection, direct client Quick Link, ledger mutation |
| D4 | `bank-app-deeplink-catalog` | OPTIONAL after D3 | Catalog + autofill-aware payer-app chooser | Không payment confirmation, no BankHub |
| D5 | `bankhub-beneficiary-verification` | DEFERRED_OUT_OF_SCOPE | Separate provider due diligence/spec if owner chooses | Không nằm trong D1a–D4 |

`D3` không được mở chỉ vì D1a–D2b xong: canonical balance helper + charge/session/payment read dependencies phải tồn tại trên default branch hoặc D3 phải pin exact root dependency/negative contract theo readiness gate.

Mỗi coding slice mặc định giữ `≤300 LOC`, `≤3 modules`, `≤1` monotonic migration; nếu encrypted-holder expand/contract vượt budget, tách compatibility/backfill thành prior slice.

---

## 5. Failure/rollback matrix

| Failure | Required behavior | Không được làm |
|---|---|---|
| VietQR bank API timeout/5xx/schema drift | Abort sync; keep last-known-good; metric + owner alert | Clear directory hoặc gọi live từ onboarding/payment request |
| Bank disappears from snapshot | Soft-retire; block new selection; QR fail closed for affected destination + warning | Cascade delete/mutate host destination |
| Pending tuple thiếu BIN/holder/account | Reject promote/render; preserve current | Mix pending account với current BIN |
| Stale confirm after another change | `BANK_DESTINATION_PREVIEW_STALE`; zero mutation | Last-write-wins silently |
| QR renderer/provider down | Show protected text fallback; ledger unchanged | Mark paid/settled hoặc expose public data |
| External renderer chosen but privacy gate absent | Feature flag OFF/build HALT for external path | Direct browser fetch |
| Deeplink app lacks autofill | Open-only copy + QR fallback | Claim prefilled/one-tap |
| Return URL/app opened | No ledger mutation | Treat as payment success |
| Lookup unavailable/unknown | Keep `owner_declared`; no verified badge | Infer holder from webhook/`lookupSupported` |
| Migration backfill cannot prove tuple | Leave QR OFF for row + owner re-confirm/HALT policy | Guess BIN/holder or treat unknown as safe |

---

## 6. Acceptance matrix trước code

| Nhóm | Input/precondition | Expected result | Test layer |
|---|---|---|---|
| Happy path | Active bank + authorized open charge + complete current tuple | QR/text uses exact current tuple and canonical remaining amount; no ledger write | Integration |
| Boundary | Amount 0, missing holder/BIN/account, retired bank | No QR; stable fail-closed code/fallback; no mixed tuple | Unit + integration |
| Authorization | Wrong tenant/player, non-participant, caller supplies foreign tenant/account | 403/404 enumeration-safe; server ignores supplied destination; zero decrypt/provider call | Integration/RLS |
| Pending lifecycle | Different-bank change inside 24h | Old tuple remains rendered; full pending tuple never leaks | Integration |
| Concurrency | Two confirms/promotions with stale `destination_version` | Exactly one version wins; other `PREVIEW_STALE`; audit matches winner | DB concurrency |
| Provider sync failure | Empty/duplicate/malformed/5xx snapshot | Atomic abort; last-known-good unchanged; alert emitted once | Job integration |
| Migration | Existing `bank_accounts` rows lack BIN/holder | No guessed backfill; QR OFF until owner re-confirms; FK/grants/DBML parity pass | Migration fixture |
| Security/privacy | Public projection/log/analytics/cache scan | No STK/holder/amount/memo/Quick Link URL; response private/no-store | CI invariant |
| External renderer gate | Option B/C without approved gate | Feature flag remains OFF or build fails; no outbound request | Integration/config |
| Deeplink | `autofill=1` vs `0`/unknown | Full params only for `1`; otherwise open-only; neither mutates ledger | Unit + UI integration |
| Regression | Existing core builder/matching/ledger tests | Current canonical behavior unchanged | Unit + full suite |
| Observability | Sync/render denied/provider failure | IDs/reason/version only; no plaintext financial data | Log/metric assertion |

Required pre-enable invariants:

- `public_sessions`/public bytes contain no account/holder/debt/memo/QR URL.
- Direct client `img.vietqr.io` path absent unless explicitly owner-approved (Option C is default forbidden).
- New global directory direct DML grants revoked; only sync writer mutates.
- Bank destination promote is atomic across BIN/account/holder/version.
- No webhook event changes account verification state.

---

## 7. Risk register

| ID | Risk | Level | Mitigation/gate |
|---|---|---|---|
| V1 | External QR request leaks financial/identity data | 🔴 | VQR-OQ-1; prefer local generation; no client direct fetch |
| V2 | BIN/account/holder from different versions | 🔴 | Atomic current/pending tuple + versioned confirm/promotion |
| V3 | Runtime readiness overstated | 🔴 | Pin BUILD-STATUS/live routes; D3 waits hard dependencies |
| V4 | Provider snapshot drift | 🟡 | Full validated last-known-good, hash, soft-retire, alert |
| V5 | Deeplink capability overclaimed | 🟡 | Consume `autofill` per app; open-only fallback; no paid inference |
| V6 | `lookupSupported` misused after lookup shutdown | 🔴 | Raw metadata only; no verification capability |
| V7 | Webhook mislabeled as holder verification | 🔴 | `owner_declared`; optional `provider_route_observed_at` only |
| V8 | Migration guesses missing bank identity | 🔴 | Nullable expand + owner re-confirm; no inference |
| V9 | QR data reaches public/cache/log | 🔴 | Protected DTO, no-store, HR2 invariant scans/redaction |
| V10 | Duplicate `bank_code` drifts from BIN directory | 🟡 | Store canonical BIN only on destination; derive display metadata |

---

## 8. Owner decision packet

Các recommendation dưới đây **chưa phải owner approval**.

| ID | Decision | Khuyến nghị | Phân loại | Binary closure |
|---|---|---|---|---|
| VQR-OQ-1 | Renderer/data path | **A: local QR generation**; B chỉ sau provider privacy/ToS approval; C forbidden | CODE-BLOCKING | Owner chọn A/B/C và security ghi exact data/log/retention contract |
| VQR-OQ-2 | Holder storage + legacy pending plaintext | `account_holder_enc` + encrypted pending holder; expand/backfill/retire plaintext | CODE-BLOCKING | Owner/security duyệt at-rest representation + migration compatibility |
| VQR-OQ-3 | Initial surface | Protected web `/pay`; bot chỉ gửi deep link sau | CODE-BLOCKING cho D3 scope | Owner chọn web-only hoặc exact multi-surface scope |
| VQR-OQ-4 | Verification | Owner-declared only; no webhook soft verify; BankHub deferred | CODE-BLOCKING | Owner chọn owner-declared hoặc approve separate BankHub due diligence |
| VQR-OQ-5 | Deeplink | Optional D4, autofill-aware payer-app chooser | DEFERRED_OUT_OF_SCOPE D1–D3 | Chỉ cần owner quyết trước khi author D4 |
| VQR-OQ-6 | Pay-code timing | Giữ DD-02 phase P4; proposal này không đổi phase | DEFERRED_OUT_OF_SCOPE D1–D3 | Chỉ mở lại bằng owner decision đổi roadmap/DD-02 dependency |

Sau khi VQR-OQ-1..4 được owner chốt:

1. Ghi decision vào `docs/standards/decisions.md` với provenance/date.
2. Propagate contract vào `docs/features/feature_payment_reconcile.md` và `docs/features/BE/feature_payment_reconcile_tech.md`.
3. Re-run readiness gate cho **D1a** trước; không author D1b–D4 như một mega-slice.
4. Chỉ sau `PLAN_READY/CODE_READY` mới tạo manifest/launcher/worktree theo autopilot policy.

---

## 9. Readiness hiện tại của proposal

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_PLAN_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: ad10194129a2c46512301a584ca9cec572c11244
BASE_BRANCH: main
TARGET_FILES:
  - docs/proposals/vietqr-io-payment-integration.md
SLICE: bank-directory-and-destination-decision-packet
IN_SCOPE: provider snapshot, bank directory, bank destination tuple, protected QR, deeplink, verification policy
OUT_OF_SCOPE: code/migration execution, ledger writer, public QR, BankHub implementation, pay-code phase change
G1_DECISION: FAIL
G2_SPEC: PARTIAL
G3_DEPENDENCY: FAIL
G4_TEST: PARTIAL
G5_SCOPE: PARTIAL
G6_EXTERNAL: FAIL
HARD_DEPENDENCIES: VQR-OQ-1..4 owner decisions; paired Payment Product/BE propagation; D3 payment/session read path
PRIOR_SLICES: D0 → D1a → D1b/D2a → D2b → D2c/D3; D4 optional; D5 deferred
OPEN_QUESTIONS_IN_SCOPE: 4
ENABLEMENT_ONLY_GATES: none — renderer/privacy and holder storage change the code/data contract
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PARTIAL
CLOSURE_MATRIX: FAIL
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PARTIAL
IMPLEMENTATION_ARTIFACTS: FAIL
FIRST_IMPLEMENTATION_STEP: blocked pending D0 owner decisions
REMAINING_BLOCKERS:
  - blocker: VQR-OQ-1..4 lack owner approval and authority propagation
    owner: Product owner + Payment architecture + Security/privacy
    resolution: All four decisions recorded in decisions.md and paired Payment specs at a tracked main commit
  - blocker: First coding slice artifacts do not exist
    owner: Autopilot orchestrator after PLAN_READY
    resolution: D1a slice doc + manifest + launcher + backlog committed/pushed from the approved authority baseline
NEXT_REVIEW_TRIGGER: tracked main commit containing owner-approved VQR-OQ-1..4 plus reconciled Payment Product/BE specs
```

---

## 10. External sources

- Bank list: `https://api.vietqr.io/v2/banks`
- Android apps: `https://api.vietqr.io/v2/android-app-deeplinks`
- iOS apps: `https://api.vietqr.io/v2/ios-app-deeplinks`
- Changelog/autofill: `https://vietqr.io/changelog/`
- Quick Link data shape: `https://vietqr.io/danh-sach-api/link-tao-ma-nhanh/`
- Lookup shutdown notice: `https://vietqr.io/danh-sach-api/api-tra-cuu-so-tai-khoan/`

Provider counts/capabilities are a dated observation, not an immutable business contract. Every implementation/enablement review must probe again and persist `source_synced_at` + snapshot evidence.
