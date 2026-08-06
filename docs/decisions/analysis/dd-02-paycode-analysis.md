# 💳 DD-02 Deep Analysis — `pay_code` (rev 6)

> **Mục đích:** chốt **contract pay_code** đúng với core đã có + provider-agnostic (ApiPay primary, SePay fallback).
> **Ngày:** 2026-07-13 (rev 6) · **Canonical:** `packages/core/src/matching.ts` (`extractPayCode`/`countPayCodes`) · `packages/core/src/payments-logic.ts` (`classifyIncoming`/`classifyCoverage`) · `packages/db/schema.ts` (memberships/tenants) · `feature_payment_reconcile.md` (edge #8/#9) + `business-rules.md` (BL-PAY-2..7) · `feature_connector_onboarding(.md/_tech)` (ApiPay/SePay, CO-OQ-6) · `identity-model.md` (merge) · DD-30 · AUDIT.

> ⚠️ **REV 6** (xem §0.1): (a) **1 nguồn prefix** = `pay_prefix_registry` (bỏ `tenants.pay_prefix`, one-current-per-tenant); (b) **prefix IMMUTABLE sau first issuance** + **choke-point atomic** phát-code↔đổi-prefix (§6.1); (c) **full-issued code định nghĩa hình thức** = `registry.locked_at IS NOT NULL` + `membership.pay_code` khớp (§3.4) → retired-chưa-lock không tạo false issued; (d) memo-level precedence + `planIncomingAllocations()` (unknown-fee đầu vs sau).

---

## 0. TL;DR — contract chốt

- **DB lưu:** `memberships.pay_code` = **suffix trần UPPERCASE**, unique per-tenant, **immutable**. Prefix KHÔNG lưu trong pay_code (derive từ **current row của `pay_prefix_registry`**).
- **Alphabet + độ dài (CHỐT):** suffix **4 ký tự** (owner 2026-07-13), alphabet **A-Z + 2-9 TRỪ `0 O 1 I L`** (31 ký tự — **KHÔNG phải Crockford**). Không gian = 31⁴ − 8⁴ = 919,425.
- **Prefix:** nguồn **duy nhất** = bảng global **`pay_prefix_registry(prefix PK, tenant_id, state current|retired, locked_at)`** — **KHÔNG** cột `tenants.pay_prefix` (tránh 2 nguồn sự thật). Current prefix đọc từ row `state='current'`; **unique one-current-per-tenant**; retired **không tái dụng**. Lock qua `locked_at` trên current row; MVP cấm đổi sau lock. QR/memo luôn `<PREFIX>-<CODE>`.
- **Recognition = resolver `own | foreign | none`** (narrow SECURITY DEFINER, không lộ tenant/PII — §3.4), áp **memo-level precedence** (hard-token thắng name-fallback):

  | Nội dung memo | Kết quả |
  |---|---|
  | Có **bất kỳ** token foreign / invalid / **own-prefix + code unissued** / resolver-error | **HARD unmatched** |
  | Không hard-token, có **≥2 distinct own code** | `/unmatched` |
  | Không hard-token, **đúng 1 distinct own code** | resolve membership → ledger §4 |
  | **Chỉ `none`, không code evidence** (vd `PAYMENT`) | **name-fallback** |

  *Lặp cùng một own code hai lần = một distinct code. `none` chỉ dẫn tới name-fallback khi memo **không** chứa hard-token nào.*
- **Amount/allocation = INVARIANT:** pay_code chỉ **resolve MEMBERSHIP** (ai). **`planIncomingAllocations()`** (§4) dựng plan — **auto: `exact` / `over` / `under`(FIFO partial) / unknown-fee-PHÍA-SAU (giữ phần chắc chắn)**; **manual: unknown-fee-ĐẦU / `already-paid`**.
- **Provider-agnostic:** parser/generator/matcher ở **Plexco core**. **ApiPay = Phase-1 primary** (DD-30 ✅) — parse `data.content` (không có field code bóc sẵn). **SePay = optional fallback** — `code` chỉ là **evidence bổ sung, KHÔNG canonical**; `code` ↔ content/prefix/tenant bất đồng → **fail-closed → unmatched**.
- **Giữ webhook nhận cả giao dịch KHÔNG có code** (để name-based fallback chạy tiếp). **Không** bật `skip_if_no_code` ở tầng provider.
- **Phase:** pay_code = **P4** (BL-PAY-3). `decisions.md` DD-02 **đã sửa P3→P4** (2026-07-13).

---

## 0.1 Correction log

**rev 5 → rev 6:**

| Rev 5 (chưa an toàn) | Sự thật (rev 6) |
|---|---|
| Controlled-change + "retired prefix vẫn resolve" | **Không đủ dữ liệu:** `memberships` chỉ lưu suffix, không lưu prefix-tại-phát-hành → ghép retired-prefix × suffix mới **resolve nhầm** (`BMT-9K2P` chưa từng phát). **MVP: prefix IMMUTABLE vĩnh viễn sau code đầu tiên**; bỏ controlled-change + fixture retired-resolve. Tương lai cần → mapping `(membership_id,prefix,suffix,issued_at)`. §6 |
| Lock chỉ nêu predicate | Chưa đóng race first-issuance ↔ prefix-change. Chốt **choke-point atomic** (`SELECT current-prefix FOR UPDATE` cùng lock order). **§6.1** + test concurrent. |
| "full-issued" = prefix từng đăng ký | Chưa đủ: retired-prefix-chưa-lock (đổi trước first issuance) + suffix mới sẽ false-issued. **Định nghĩa hình thức: `registry.locked_at IS NOT NULL` + `membership.pay_code` khớp** → `BMT9K2P` (BMT chưa lock) = `none`; `BMT-9K2P` dash = hard. >1 candidate → fail-closed. §3.4 |
| Parser chỉ anchor OWN_PREFIX | Foreign full-issued code **không tới resolver** → memo rơi nhầm name-fallback. Thêm **`discoverPayCodeCandidates`** enumerate mọi split prefix{3,4}×suffix{4} + batch-resolve (không greedy — hỗ trợ 4→5). §3 bước 2 |
| `PAYMENT`→`none` vô điều kiện | Chỉ đúng khi `PAY` **không** own. Nếu `PAY` LÀ own prefix → `MENT` unissued → **hard-unmatched**. §3.4 |
| `skipCodes` loại TRƯỚC resolver | **Sai** — che dash `BMT-RANS` (phải hard) + che full-issued token. Thứ tự: enumerate → batch-resolve → **issued own/foreign thắng** → unresolved+dash=hard → unresolved+own-prefix mới xét `skipCodes` (skip→none, không→hard) → còn lại none. §3 bước 3 |
| Fixture unknown-fee "trả 50k" | 50k chưa chạm debt unknown → không chứng minh gì. Đổi **100k known→unknown, trả 150k → allocate 100k, giữ 50k unallocated**. |
| Sót `tenants.pay_prefix` (§0 derive, §7 canonical) | Đổi hết sang **`pay_prefix_registry` current row**. |

**rev 4 → rev 5 (suffix 4 CHỐT):**

| Rev 4 (chưa đủ) | Sự thật (rev 5) |
|---|---|
| `UNIQUE(pay_prefix)` + bảng alias + giữ `tenants.pay_prefix` | **Hai nguồn sự thật.** Chốt **1 bảng global `pay_prefix_registry(prefix PK, tenant_id, state, locked_at)`** + `UNIQUE one-current-per-tenant`; **BỎ cột `tenants.pay_prefix`**; retired không tái dụng; PK cho 1 tx thắng khi 2 tenant claim. §6 |
| Resolver: own-prefix + squashed → có thể rơi name-fallback | Thiếu case **own prefix + code UNISSUED → HARD unmatched**. Thêm **memo-level precedence** (bất kỳ hard-token → unmatched, thắng name-fallback; chỉ none mới name-fallback). §0/§3.4 |
| `under`/`unknown-fee` = enum không mang plan | Chốt **`planIncomingAllocations()`**: FIFO qua debt đã định giá, giữ phần chắc chắn khi unknown-fee **phía sau**, unknown-fee **đầu** → toàn bộ unmatched. §4 |
| Wording "4/5 mở", "hoặc {5}", "đổi độ dài", detector-registry, rev4 ở header | Dọn: suffix **4** duy nhất; resolver full-issued-code; header rev 5; note nâng cấp 4→5. |
| Fixture `PAYMENT` = "không có prefix registry" | Đúng: "prefix `PAY` có thể đã đăng ký, full code `PAYMENT` không issued → none". |

**rev 3 → rev 4:**

| Rev 3 (chưa đủ) | Sự thật (rev 4) |
|---|---|
| Foreign-detector = "generic shape 3–4 + 4" | **Fail-closed quá rộng** (`PAYMENT`→`PAY`+`MENT` chặn oan). Dùng **registry hữu hạn** (prefix canonical+retired); prefix charset `[A-Z0-9]`. §3.4 |
| `under` → manual `/unmatched` | **Mâu thuẫn edge #8** (allocation phần chắc chắn, charge `partial`). Paycode-resolved ⇒ FIFO partial **deterministic → AUTO**. Cần mở rộng `classifyIncoming`→`partial` / `planIncomingAllocations()`. §4 |
| Merge: "re-parent" (l.186) vs "giữ trên merged" (l.188) mâu thuẫn | Merge contract **silent về pay_code** (`identity-model` step 6). Chốt: **giữ trên tombstone + follow `merged_into_membership_id`** với guards → QR cũ chạy, không fuzzy. §8 (extend merge contract) |
| Prefix "immutable sau khi phát" (không enforce được) | Thêm predicate: lock khi có `pay_code IS NOT NULL` **hoặc** `pay_prefix_locked_at`; guard reject update sau lock; alias history. §6 |
| Cite `PAY-UC-9` cho overpay | Sai — đó là **edge case #9** (trả dư) + BL-PAY-2/7. `PAY-UC-9`/#13 là reversal. |
| "31⁴ ≈ 923k" | Thực = **31⁴ − 8⁴ = 919,425** (loại suffix toàn số). |
| An ninh lặp 2 lần (§8) | Gộp 1. ApiPay schema thêm nhãn **reverify khi build**. |

**rev 2 → rev 3:**

| Rev 2 nói (chưa đủ) | Sự thật (rev 3) |
|---|---|
| "Parser cho phép `-?`, align với core" | Regex core `payCodeRe` (`matching.ts:629`) **KHÔNG** nhận `-` (chỉ `prefixSUFFIX`). Giữ UX `-` ⇒ **phải sửa `payCodeRe` thành `prefix + '-?' + suffix`** + test cả 2 dạng. **Không** nói "align sẵn". |
| `CHECK (^[A-HJ-KM-NP-Z2-9]{4}$)` | Vẫn nhận `2345` (toàn số) mà generator/parser loại → thêm `AND pay_code ~ '[A-Z]'`. |
| pay_prefix "unique global khuyến nghị" | Khép kín: `CHECK` format + `UNIQUE` + **immutable/alias history**. §4-prefix. |
| "foreign prefix → fallback/unmatched" (nhập nhằng) | **HARD unmatched**, KHÔNG name-fallback. §3. |
| "auto khi 1 safe plan" (chưa map) | Map từng `IncomingClass` → disposition, chỉ định helper canonical. §4. |
| "loại toàn bộ membership `left`" | `left` **còn open charge** vẫn nhận diện an toàn; chỉ `merged` fail-closed. §8. |

**rev 1 → rev 2:**

| Rev 1 nói (SAI) | Sự thật (rev 2) |
|---|---|
| "Prefix optional; match mã trần bằng substring" | **Prefix BẮT BUỘC cho deterministic match** (core `payCodeRe` = `prefix + suffix`). Bare code → fallback/manual. Ví dụ hỏng: mã `THANH`, memo "THANH TOAN" → substring nhận nhầm. |
| "Crockford Base32" | **Sai tên.** Alphabet core = A-Z + 2-9 **trừ 0/O/1/I/L**; Crockford **giữ** 0 và 1. |
| "Strip toàn bộ non-alnum rồi kiểm token boundary" | **Tự mâu thuẫn** (xoá separator thì hết boundary). Đúng: **parse cấu trúc `<OWN_PREFIX>-?<CODE>`** (regex prefix-anchored), không squash rồi substring. |
| "Cross-check amount = khuyến nghị" | **Phải là INVARIANT.** pay_code chỉ resolve membership; ledger safe-allocation quyết charge — auto chỉ khi 1 safe plan, else unmatched. |
| "Verify với SePay" (SePay làm nền) | **Sai nền.** ApiPay = primary (DD-30). Parser thuộc **core**, độc lập provider; SePay `code` chỉ evidence. Xem **provider capability matrix §7**. |
| Không nhắc code core đã có | `extractPayCode`/`countPayCodes` **đã tồn tại** (`matching.ts`), chỉ **chưa wire vào reconcile production** (GitNexus: chỉ test gọi). DD-02 chốt ⇒ **thay core + tests**, không chỉ docs. Core tests hiện **111/111 xanh**. |

---

## 1. Canonical đã cố định gì (gồm CORE đã có)

| Sự thật | Nguồn |
|---|---|
| `memberships.pay_code text` nullable; unique per-tenant `(tenant_id, pay_code)` | `schema.ts:170,177` |
| **`extractPayCode(content,{prefix,skipCodes})`** — regex `prefix + [A-HJ-KM-NP-Z2-9]{4}\b`, case-insensitive, trả **UPPERCASE**; suffix toàn số bị loại; squashed-memo OK, trailing boundary | `matching.ts:607-643` |
| **`countPayCodes`** — đếm distinct (cho ca nhiều mã) | `matching.ts:646-653` |
| Prefix **bắt buộc**; không prefix bị reject | `matching.test.ts:529` |
| `extractPayCode` **chỉ được test gọi, chưa nối reconcile production** | GitNexus (reviewer) |
| Matching deterministic khi có code; CK **đã tenant-scoped trước match** | `feature_payment_reconcile.md`, AUDIT:92 |
| **Phase-gated P4**; P3 = name+amount+date | BL-PAY-3, PAY-UC-5 |
| Một CK/nhiều người → manual/deterministic-plan, **không** auto-split `fee×N` | BL-PAY-5 |
| `tenants.slug` (URL, dài) — **không** dùng làm prefix | `schema.ts` tenants |
| **ApiPay per-host auto-provision** = ✅ (DD-30); rollout ApiPay M2, SePay M3 | `decisions.md:320`, `connector_onboarding_tech.md:337` |

> **Kết luận:** contract pay_code **đã được thiết kế trong core** (prefix bắt buộc + suffix 4 alphabet-an-toàn). DD-02 "chốt" nghĩa là: (a) align docs vào contract này, (b) khép kín các tham số (prefix source/enforcement, ledger decision table, provider matrix — suffix **4 đã chốt**), (c) **wire core vào reconcile production + thay tests**, (d) sửa drift metadata (phase, connector spec).

---

## 2. Deterministic recognition = prefix namespace BẮT BUỘC

- **Quy tắc:** một memo chỉ deterministic-match khi chứa **`<OWN_PREFIX>` của đúng tenant + đúng một `<CODE>`** hợp lệ. Prefix = **namespace marker**, chống nhận nhầm mã trần lẫn trong text (vd `THANH` trong "THANH TOAN").
- **Bare code (không prefix):** **KHÔNG** deterministic. Nếu memo **không có token paycode nào đã-đăng-ký** → name/date/amount fallback. (Khớp `matching.test.ts:529`.)
- **Hard-token (full-issued foreign code, own-prefix + code unissued, hoặc explicit dash-token lạ `ABC-7Q2A`):** **HARD unmatched** — xem resolver §3.4 (phân loại theo **full issued code**, không phải shape/prefix chung).
- **≥2 own-prefix pay_code khác nhau:** `/unmatched` (`countPayCodes ≥ 2` — BL-PAY-5).
- DB lưu **suffix trần** (prefix là thuộc tính tenant) — nhưng **recognition luôn yêu cầu prefix** trên content.

---

## 3. Parser — parse CẤU TRÚC, không squash-rồi-substring

Thứ tự đúng:
1. **Chuẩn hoá nhẹ:** uppercase + bỏ dấu tiếng Việt. **Giữ** `-`/space để nhận cấu trúc prefix.
2. **`discoverPayCodeCandidates(memo)` — enumerate MỌI split, KHÔNG loại `skipCodes` ở bước này:**
   > ⚠️ **Sửa lỗi rev trước:** (a) parser cũ chỉ khớp `OWN_PREFIX` → foreign full-issued code không tới resolver; (b) **loại `skipCodes` TRƯỚC resolver là SAI** — sẽ bỏ qua dash `BMT-RANS` (contract yêu cầu hard) và che full-issued code nếu token nằm trong `skipCodes`.
   - Sinh mọi candidate `(prefix 3–4, `-?`, suffix 4)` + trailing boundary trên toàn memo (squashed **và** dash), **chỉ** loại suffix toàn số. **KHÔNG** loại `skipCodes` ở đây.
   - Ghi nhận mỗi candidate kèm **có dấu `-` hay không** (dash = explicit intent).
   - Regex: `PREFIX{3,4}` + **`-?`** + `SUFFIX{4}` + trailing boundary. *(`payCodeRe` hiện `matching.ts:629` neo OWN_PREFIX + không `-` + không enumerate → phải sửa.)*
3. **Thứ tự phân loại an toàn (issued THẮNG skipCodes):**
   1. **Batch-resolve** mọi candidate qua resolver (một lượt) — **KHÔNG greedy** (4→5 nhận `{4,5}` có thể nhiều split).
   2. **Issued `own`/`foreign` LUÔN THẮNG** — kể cả token trùng `skipCodes` (full-issued không bị `skipCodes` che).
   3. **Unresolved + có dash** (`BMT-RANS`) → **HARD** (explicit intent).
   4. **Unresolved + squashed + đúng own-prefix** → mới xét `skipCodes`: trong list → `skip`→`none`; không trong list → **HARD** (own-prefix + unissued).
   5. Còn lại (không own-prefix, không issued) → `none`.
4. **Token classification qua RESOLVER — theo full ISSUED code (định nghĩa hình thức):**
   > ⚠️ **Resolver = narrow SECURITY DEFINER function** (pattern `0010`; role `app` KHÔNG blanket cross-tenant — `0009:11`), nhận token đã parse, trả **`own | foreign | none`** — **KHÔNG** trả tenant/member/PII.

   **Một token `(prefix, suffix)` là "full-issued code" ⟺:**
   ```
   ∃ registry.prefix = token.prefix
     AND registry.locked_at IS NOT NULL      -- namespace ĐÃ TỪNG phát code
     AND ∃ membership: membership.tenant_id = registry.tenant_id
                       AND membership.pay_code = token.suffix
   ```
   `locked_at IS NOT NULL` là **bằng chứng namespace từng phát code** — nhờ invariant "prefix immutable sau first issuance" (§6), một prefix **retired mà chưa từng lock** (đổi trước khi phát mã nào) **KHÔNG** thể là namespace của bất kỳ code nào.

   | Token | Kết quả |
   |---|---|
   | Own current prefix + suffix issued (`BMT7Q2A`) | `own` → xét allocation |
   | Own prefix + suffix UNISSUED (`BMT7Q2B` typo) | **HARD unmatched** (evidence xung đột, không name-fallback) |
   | Full-issued **foreign** code (thoả định nghĩa với tenant khác) | **HARD unmatched** (foreign) |
   | **Dash-token** `PFX-XXXX` prefix lạ/không thoả full-issued | **HARD unmatched** (explicit code intent) |
   | **Retired prefix `locked_at IS NULL`** (đổi trước first issuance) + squashed suffix (`BMT9K2P` sau khi BMT→ABC) | **`none`** — BMT chưa từng phát mã → không phải issued code → name-fallback |
   | `PAYMENT` khi **`PAY` KHÔNG phải own prefix** và không tạo full-issued foreign (MENT không phải issued-suffix của tenant nào có prefix PAY locked) | **`none`** → name-fallback (không chặn oan) |
   | `PAYMENT` khi **`PAY` LÀ own current prefix** → `MENT` là own-prefix + suffix UNISSUED | **HARD unmatched** (rơi vào hàng "own-prefix + unissued") |
   | **Squashed own-prefix noise trong `skipCodes`** (`BMTRANS`, unresolved) | **`none`** — chỉ xét `skipCodes` SAU khi resolver không ra issued (bước 3.4) |
   | **Dash + `skipCodes`** (`BMT-RANS`) | **HARD unmatched** — dash = explicit intent, `skipCodes` KHÔNG cứu |
   | **Token trùng `skipCodes` nhưng LÀ full-issued** | resolve `own`/`foreign` theo ownership — **issued THẮNG `skipCodes`** |
   | Resolver thấy **>1 full-issued interpretation** (không phải số raw candidate từ generic scanner) | **HARD unmatched** (fail-closed) |
   | Resolver error / cycle | **HARD unmatched** (fail-closed) |

   > 📌 `PAYMENT`→`none` **chỉ** đúng khi `PAY` không phải own prefix và không là full-issued foreign. Nếu `PAY` là own prefix, `MENT` unissued ⇒ **hard-unmatched** (không name-fallback). Đây là lý do phải **enumerate + batch-resolve** (bước 2), không chỉ kiểm shape.

5. **Đếm distinct own code** (`countPayCodes`): 1 → ứng viên membership; ≥2 → `/unmatched` (BL-PAY-5).
6. Với `own`: strip prefix → lookup `pay_code` (bare) trong tenant (kể cả **follow tombstone** khi `merged` — §8).

> Điểm sửa: full-issued = **registry.locked_at IS NOT NULL + membership.pay_code khớp** (không chỉ "prefix từng đăng ký") → **retired-chưa-lock + suffix mới KHÔNG là issued** (`BMT9K2P`→`none`), nhưng **dash `BMT-9K2P` = explicit intent → hard-unmatched**; own-unissued → hard; `PAYMENT` không chặn oan; **>1 full-issued interpretation** → fail-closed.

---

## 4. Allocation = INVARIANT (decision table), pay_code chỉ resolve NGƯỜI

pay_code per-membership xác định **ai**, **không** xác định **charge/buổi nào**. Sau khi resolve membership → ledger dựng **FIFO plan** rồi map → disposition. Khi paycode **đã** xác định đúng membership, **FIFO partial là DETERMINISTIC** (khác ca fuzzy-name) → phải allocate phần chắc chắn, KHÔNG đẩy hết vào unmatched.

| `IncomingClass` (core) | Ý nghĩa | Disposition |
|---|---|---|
| `exact { settleCount }` | FIFO-prefix phủ đúng N charge | **Auto-allocate** N charge oldest-first |
| `over { overpay }` | Vượt tổng nợ | **Auto-allocate** tất cả open + giữ `overpay` ở `unallocated_amount` + notice (edge #9 "trả dư", BL-PAY-2/7) |
| **`under`** | Dương nhưng < tổng | **Auto FIFO PARTIAL** — allocate phần chắc chắn (fill oldest fully, boundary charge → `partial`), **không** notify "paid" (**edge case #8**: "allocation phần chắc chắn; charge `partial`"). *(Xem đổi core bên dưới.)* |
| `unknown-fee` (debt **đầu** chưa định giá) | Không allocate được phần nào chắc chắn | **`/unmatched`** — toàn bộ |
| `unknown-fee` (unknown ở **phía sau**, debt đầu đã định giá) | Phần trước unknown **chứng minh được** | **Auto-allocate phần chắc chắn** (tới trước debt unknown), phần dư `unallocated` (xem `planIncomingAllocations` bên dưới) |
| `already-paid { overpay }` | Không còn open debt | **`/unmatched`** — thanh toán bất ngờ, giữ `unallocated`, notify host |

> ⚠️ **Chốt `planIncomingAllocations()` (thay vì chỉ đổi enum):** `classifyIncoming` hiện trả `{kind:"under"}`/`{kind:"unknown-fee"}` **không mang plan** → không phân biệt được "unknown ở đầu" vs "unknown phía sau". Thêm helper canonical **`planIncomingAllocations(debts, amount) → { allocations, unallocatedAmount, reason }`**:
> 1. Đi **FIFO qua từng debt ĐÃ định giá**; allocate full/partial tới khi hết tiền.
> 2. **Gặp unknown-fee khi vẫn còn tiền** → **giữ allocations đã chứng minh**, phần còn lại `unallocatedAmount` (không đoán unknown).
> 3. **Unknown-fee là debt ĐẦU** → **không allocation, toàn bộ unmatched**.
> 4. Trả **một canonical plan** để ledger áp (khớp edge #8 "allocation phần chắc chắn" + hành vi hiện tại cho phép exact-prefix dù phía sau có unknown fee). `unknown-fee`-đầu vẫn manual.
> Khớp tech spec "FIFO ordering and **partial plans**" (`feature_payment_reconcile_tech.md:246`).

**Ngoài ledger (guard trước khi vào bảng):**
- ≥2 own-prefix pay_code khác nhau → **`/unmatched`** (không auto-split; `classifyCoverage` chỉ cho **deterministic combo có chủ đích** tương lai, KHÔNG auto MVP).
- provider `code` ↔ content/prefix/tenant **bất đồng** → **`/unmatched`** (fail-closed).

⇒ Auto ở `exact`/`over`/**`under`(FIFO partial)** + **unknown-fee-phía-sau (phần chắc chắn)**; manual ở **unknown-fee-đầu**/`already-paid`. `planIncomingAllocations()` là nguồn plan; ledger áp; pay_code chỉ chọn membership.

---

## 5. Suffix: alphabet + độ dài

- **Alphabet (đang dùng):** `A-H J-K M-N P-Z` + `2-9` = **31 ký tự**, loại `0 O 1 I L` (chống nhầm khi gõ tay/OCR memo). **Đừng gọi Crockford.**
- **Độ dài = 4 (CHỐT, owner 2026-07-13).** Không gian = **31⁴ − 8⁴ = 919,425** (loại suffix toàn số) — **ngưỡng tính PER-TENANT, không phải toàn platform** (unique per-tenant) → dư cho CLB vài trăm–nghìn member với generate-and-check-unique. Khớp core (`payCodeRe` {4}) → không đổi độ dài, chỉ thêm `-?` + CHECK.
- **Đường nâng cấp 4→5 (nếu tương lai cần):** DB/parser nhận `{4,5}`; **generator mới chỉ phát 5**; **giữ mã/QR 4 vĩnh viễn** (không backfill, không rotate mã cũ). Mã 4 và 5 cùng tồn tại an toàn (resolver theo full issued code).
- **Generator:** random + **check-unique per-tenant** (index bắt trùng → sinh lại); loại suffix toàn số (đã có).

---

## 6. Schema phải enforce format/case (không chỉ generator)

Hiện `pay_code text` + unique **case-sensitive** (`schema.ts:170,177`). Migration phải thêm — **enforce ở DB, không chỉ generator**:

- **`memberships.pay_code`:**
  ```sql
  CHECK (
    pay_code ~ '^[A-HJ-KM-NP-Z2-9]{4}$'   -- suffix 4 (CHỐT)
    AND pay_code ~ '[A-Z]'                 -- BẮT BUỘC ≥1 chữ cái → loại code toàn số (2345)
  )
  ```
  Vì generator/parser loại suffix toàn số, DB cũng phải chặn để không lưu được code parser sẽ không bao giờ nhận. `CHECK` đã ép uppercase → unique case-sensitive là đủ; test "insert lowercase / toàn số → CHECK reject".
- **Prefix registry = MỘT bảng global canonical (KHÔNG cột `tenants.pay_prefix`):**
  ```sql
  pay_prefix_registry (
    prefix    text PRIMARY KEY CHECK (prefix ~ '^[A-Z0-9]{3,4}$'),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    state     text NOT NULL CHECK (state IN ('current','retired')),
    locked_at timestamptz
  );
  -- Mỗi tenant tối đa MỘT current prefix:
  CREATE UNIQUE INDEX pay_prefix_registry_one_current_per_tenant
    ON pay_prefix_registry (tenant_id) WHERE state = 'current';
  -- PK trên `prefix` (gồm retired) ⇒ retired KHÔNG BAO GIỜ tái dụng cho tenant khác
  -- → cùng full code không thể resolve sang 2 tenant.
  ```
  - **Current prefix của tenant** = row `state='current'` (đọc từ registry, **không** projection ở `tenants`). Muốn cache ở `tenants` → phải khai báo rõ **projection + trigger atomic**; mặc định **bỏ hẳn**.
  - **MVP CHỐT: prefix IMMUTABLE VĨNH VIỄN sau khi phát paycode đầu tiên.** **KHÔNG** controlled-change-after-lock (bỏ luôn) — vì `memberships` chỉ lưu **suffix**, không lưu prefix-tại-thời-điểm-phát; ghép mọi retired-prefix × suffix hiện tại sẽ **resolve nhầm** mã chưa từng phát (vd đổi `BMT→ABC` rồi phát `9K2P` → `BMT-9K2P` bị coi là issued dù chưa bao giờ). `retired` **chỉ** dùng khi **tenant đóng** hoặc **đổi prefix TRƯỚC khi phát bất kỳ code nào**.
    > 🔮 **Nếu tương lai thật sự cần đổi sau lock:** phải có **mapping issuance riêng** `(membership_id, prefix, suffix, issued_at)` — không thể dựa registry + suffix hiện tại. Ngoài scope MVP.
  - **Lock = choke-point atomic (đóng race first-issuance ↔ prefix-change) — §6.1.**
  - **`memberships.pay_code` CHECK:** đã ép uppercase → unique per-tenant case-sensitive là đủ.
  - **Test:** 2 tenant claim cùng prefix đồng thời → PK cho đúng 1 tx thắng · retired không cấp lại · one-current-per-tenant · **concurrent first-issuance vs prefix-change → đúng 1 thắng, còn lại reject/retry** (§6.1).

#### 6.1 Choke-point atomic: phát paycode đầu tiên ↔ đổi prefix
Cùng một lock order (khoá **current-prefix row**) để không có cửa sổ race:
- **Phát paycode:** `SELECT current-prefix row FOR UPDATE` → nếu `locked_at IS NULL` set `locked_at` → `INSERT` paycode — **cùng transaction**.
- **Đổi prefix (chỉ khi chưa lock):** `SELECT current-prefix row FOR UPDATE` → xác nhận `locked_at IS NULL` **và** tenant chưa có paycode → đổi.
- Hai transaction đụng nhau → một thắng theo lock order; transaction kia **reload state → reject/retry** (không tạo prefix-drift).

---

## 7. Provider-agnostic contract (ApiPay primary, SePay fallback)

**Core sở hữu** generator/parser/matcher. Adapter provider chỉ chuẩn hoá về input chung:

```
ApiPay/SePay adapter
  → verify provider (chữ ký/secret)
  → route tenant bằng webhook token + bank account   (trước match — AUDIT)
  → normalize → BankTransactionInput {
        provider, externalId, amount, occurredAt, content,
        providerCode?   // evidence, KHÔNG canonical
    }
  → shared paycode parser (core, prefix-anchored)
  → shared safe-allocation decision table (§4)
```

**Provider capability matrix** (thay "verify với SePay"):

| Provider | Canonical input để parse | Provider-extracted code | Verify bắt buộc |
|---|---|---|---|
| **ApiPay — Phase-1 primary** | `data.content` | **Không giả định có** | HMAC raw body (`ApiPay-Signature`), `transactionId`, `bankAccountPublicId`, bảo toàn `content` |
| **SePay — optional/fallback** | `content` | `code` optional (**evidence**) | Auth, account, **`code` ↔ content nhất quán** |
| **Provider tương lai** | normalized `content` | optional | Adapter contract tests |

**Bất biến provider:**
- ApiPay **không** có field code bóc sẵn → Plexco **bắt buộc tự parse `content`** → càng cần parser prefix-anchored (§2/§3).
- SePay `code` là evidence; **core không được phụ thuộc** vào nó. `providerCode` có nhưng **không khớp** parser/content/prefix/tenant → **unmatched** (fail-closed).
- Options như `is_verify_payment`, `skip_if_no_code` **chỉ thuộc SePay adapter**, **không** vào core DD-02. **Không** bật `skip_if_no_code` (sẽ khiến giao dịch thiếu code không tới Plexco, phá name-based fallback).
- **`pay_prefix_registry`** là **canonical của Plexco**, KHÔNG phải "cấu hình SePay".
- ApiPay + SePay chạy **cùng fixtures** (§11).

---

## 8. An ninh + edge cases

- **An ninh:** pay_code chỉ resolve **membership**; ledger (§4) mới move tiền → đoán mã người khác = tự trả nợ hộ (không rút được gì), không lộ tiền/PII. Cross-tenant chặn ở route (AUDIT:92). pay_code **không** ra public (HR2).
- **Membership eligibility cho recognition:**
  - `active` / `guest` → eligible.
  - **`left` CÒN open charge → eligible** (đã rời club nhưng còn nợ, QR đã cấp → nhận diện an toàn; ledger §4 quyết). `left` **hết** open charge → `already-paid` → `/unmatched`.
  - **`merged` → FOLLOW TOMBSTONE (không hard-loại):** lookup mã trên membership `merged` (tombstone) → **follow `merged_into_membership_id` sang survivor**, với guards **tenant khớp + survivor `active/guest` + cycle hợp lệ**. QR/memo cũ vẫn hoạt động, **không** cần fuzzy. *(Mã KHÔNG re-parent — giữ trên tombstone; recognition đi qua con trỏ.)*
    > ✅ **Merge contract đã propagate (2026-07-13):** `identity-model.md` §merge step 6 + `feature_identity_tech.md` §merge đã bổ sung "pay_code giữ trên tombstone; recognition follow `merged_into_membership_id` (guards)". (Trước đó step 6 silent về pay_code.)
- **Immutable:** pay_code không rotate; giữ trên tombstone (index vẫn unique) để follow-through, không xoá.

---

## 9. Repo integration — spec đã propagate; code/migration còn lại

**✅ SPEC propagation ĐÃ làm (2026-07-13):**
- **Phase:** `decisions.md` DD-02 → P4 (khớp BL-PAY-3).
- **Merge contract:** `identity-model.md` §merge + `feature_identity_tech.md` §merge — pay_code tombstone follow-through.
- **Connector:** `feature_connector_onboarding.md` 4.3b ApiPay **✅ Phase-1 primary** + `_tech` M2 + **schema `provider_connections.auth_mode += 'enterprise'`** (CHECK shape; platform credential từ KMS, không per-tenant); **CO-OQ-6 đóng** (`skip_if_no_code=0`).
- **Reconcile:** `feature_payment_reconcile_tech.md` §4 worker (pipeline `normalize→discover→resolve→precedence→plan`, canonical) + §8 fixtures.

**⏳ CODE/MIGRATION còn lại (khi build P4) — impact analysis trước khi sửa `matching.ts`/`payments-logic.ts` (111/111 xanh):**
1. **Parser:** `payCodeRe` + `-?` + **`discoverPayCodeCandidates`** (enumerate mọi split, không loại `skipCodes` pre-resolve); **resolver narrow SECURITY DEFINER** `own|foreign|none` (full-issued = `locked_at NOT NULL` + `pay_code` match). Wire vào reconcile production.
2. **Ledger:** **`planIncomingAllocations()`** (§4). `classifyCoverage` để dành combo.
3. **Migration:** **`pay_prefix_registry`** (PK `prefix`, state, `locked_at`, one-current-per-tenant, **không** `tenants.pay_prefix`; choke-point atomic §6.1) + `CHECK` trên `memberships.pay_code` (format + `[A-Z]`) + **`bank_transactions.provider_code_enc`** (evidence) + **`provider_connections` CHECK shape đầy đủ per (provider, auth_mode)** (spec đã có).
   > ⚠️ **Backfill guard (bắt buộc khi migrate):** query DB **thật** xem có `memberships.pay_code IS NOT NULL` không. Code search hiện **không thấy production writer**, nhưng nếu DB đã có dữ liệu → **HALT**: map prefix **thủ công** per-tenant + set `locked_at` cho từng prefix đã phát. **KHÔNG** suy prefix từ `slug` (sai namespace → resolve nhầm). CHECK/registry chỉ bật sau khi backfill xong.
4. **Merge code:** recognition follow `merged_into_membership_id` (feature_identity merge path). **Provider-code cross-check** (SePay `provider_code` ↔ candidate/content/prefix/tenant → mismatch = hard-unmatched).
5. **Provider verify (build):** verify webhook + dedupe (`UNIQUE(tenant,provider,external_id)` — BL-PAY-4) + amount, cho **cả** ApiPay lẫn SePay.
   > ⚠️ **ApiPay header/payload schema chưa công khai đầy đủ** — trang chính thức mới xác nhận có webhook/API + "verify chữ ký nếu hỗ trợ". Field (`data.content`/`amount`/`transactionId`/`bankAccountPublicId`/`ApiPay-Signature`) §7 phải **REVERIFY khi build**. Positioning ApiPay-primary (DD-30) không đổi.

---

## 10. Quyết định (đã chốt) + việc thực thi

1. **Độ dài suffix = 4** (owner 2026-07-13) — contract duy nhất, không còn tuỳ chọn 5.
2. **Prefix:** nguồn duy nhất = **`pay_prefix_registry`** (prefix PK, state, `locked_at`, **one-current-per-tenant**; **không** cột `tenants.pay_prefix`); retired không tái dụng. **Prefix IMMUTABLE sau first issuance**; **issuance và pre-lock change dùng CÙNG `FOR UPDATE` choke-point** (§6.1). Memo/QR `<PREFIX>-<CODE>`.
3. **Bất biến:** recognition qua resolver **`own|foreign|none`** — **full-issued ⟺ `registry.locked_at IS NOT NULL` + `membership.pay_code` khớp** (retired-chưa-lock + suffix mới → `none`; dash-token lạ → hard); **memo-level precedence** (hard-token thắng name-fallback; own-unissued/foreign/error/>1-candidate → HARD unmatched; ≥2 own → unmatched; đúng 1 → resolve; chỉ none → name-fallback); **allocation qua `planIncomingAllocations()`** (auto exact/over/under-partial + unknown-fee-phía-sau; manual unknown-fee-đầu/already-paid); provider-agnostic (ApiPay primary, SePay code = evidence); `left`-còn-nợ nhận diện; **`merged` → follow tombstone**.
4. **Propagation:** SPEC **đã làm** (phase P4, connector ApiPay ✅ primary + `auth_mode='enterprise'` + CO-OQ-6 đóng, merge tombstone ở identity-model/_tech, reconcile §4/§8) — xem §9. **Còn lại = code/migration khi build P4** (parser/resolver/`planIncomingAllocations`/`pay_prefix_registry`).

**Đã ghi canonical (2026-07-13):** `decisions.md` DD-02 → ✅ + phase P4 + changelog v1.22/v1.23; spec propagation (identity-model/_tech, connector .md/_tech + `auth_mode='enterprise'`, reconcile §4/§8) — xem §9. **Còn lại = code/migration khi build P4** (impact analysis trước khi sửa `matching.ts`/`payments-logic.ts`).

---

## 11. Test fixtures bắt buộc (ApiPay + SePay cùng bộ)
`THANH TOAN` (không nhầm mã `THANH`) · **`PAYMENT` khi `PAY` KHÔNG own → `none` → name-fallback** · **`PAYMENT` khi `PAY` LÀ own current prefix → `MENT` unissued → HARD unmatched** · **own prefix + code UNISSUED `BMT7Q2B` → HARD unmatched** · **`BMTRANS` (skipCodes noise, unresolved squashed) → `none`** · **`BMT-RANS` (dash + skipCodes) → HARD** · **token trùng skipCodes nhưng full-issued → resolve theo ownership (issued thắng skipCodes)** · **foreign full-issued code trong memo (vd `... ABC7Q2A ...`, ABC là tenant khác đã lock) → discover + resolve → HARD unmatched** (không bỏ sót do chỉ anchor own-prefix) · `ABC-7Q2A` dash prefix lạ → hard-unmatched · bare code (reject deterministic) · no-token → name-fallback · **`BMT-7Q2A` + `BMT7Q2A` đều nhận** · provider/raw mismatch (→unmatched) · **lowercase / toàn-số DB insert → CHECK reject** · **`left` còn open charge → nhận diện** · `left` hết nợ → already-paid/unmatched · **`merged` → follow tombstone** (QR cũ chạy) · nhiều code (→unmatched) · `planIncomingAllocations`: exact→auto · over→auto+overpay · **under→auto FIFO partial** (charge `partial`, không notify paid) · **unknown-fee PHÍA SAU (100k known → unknown, trả 150k) → allocate 100k debt đầu, giữ 50k unallocated** · **unknown-fee ĐẦU → toàn bộ unmatched** · already-paid→unmatched · **retired prefix KHÔNG cấp lại** · **2 tenant claim cùng prefix đồng thời → PK cho đúng 1 tx thắng** · one-current-per-tenant enforce · **concurrent first-issuance vs prefix-change → đúng 1 thắng (§6.1)** · **đổi BMT→ABC TRƯỚC first issuance → phát `ABC-9K2P`: `BMT9K2P` (squashed, BMT `locked_at IS NULL`) = `none`/name-fallback, nhưng `BMT-9K2P` (dash) = HARD unmatched** · **retired prefix có `locked_at` (từng phát) + exact suffix → resolver công nhận** · >1 candidate → hard-unmatched · cross-tenant · dirty memo.

---

## Nguồn
Nội bộ: `packages/core/src/matching.ts:607-653` (`payCodeRe:629`, `matching.test.ts:529`) · `packages/core/src/payments-logic.ts:260-307` (`classifyIncoming:267`/`classifyCoverage:298`) · `packages/db/schema.ts:165-181` · `packages/db/migrations/0009_rls_policies_grants.sql:11` + `0010` (narrow SECURITY DEFINER) · `feature_payment_reconcile.md` (**edge #8/#9**, PAY-UC-5/10/12, OD-2) · `business-rules.md:14-19` (**BL-PAY-2..7**) · `decisions.md:17,320` (DD-02, DD-30) · `feature_connector_onboarding(.md:387/_tech.md:337)` (ApiPay/SePay, CO-OQ-6:571) · `identity-model.md:210-218` (merge) · AUDIT:92-93.
Provider (verify khi build): ApiPay Webhooks (`data.content`/`amount`/`transactionId`/`bankAccountPublicId`/`ApiPay-Signature`) · SePay webhooks (auth, dedupe, không bật `skip_if_no_code`).
