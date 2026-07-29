<!-- review-readiness: criteria -->
# Gạch nợ tự động — phạm vi quốc gia và landscape partner

> **Ngày research:** 2026-07-27  
> **Repo snapshot:** `main@784bc8dd297163a5ec5415f33beabbbf34bbc8d7`  
> **Drift check:** delta từ snapshot research ban đầu `76e1f7b` đã thêm job mechanics, `0024` và authority/readiness docs nhưng không thêm payment webhook, auto-allocation producer/projector hay provider ngoài `sepay|apipay`; kết luận regional không đổi.  
> **Phân loại:** `RESEARCH / DECISION INPUT` — không phải decision đã chốt, implementation plan, `CODE_READY`, `ENABLE_READY` hay bằng chứng runtime.  
> **Phạm vi:** khả năng cung cấp gạch nợ chuyển khoản tự động cho Host Pro theo từng thị trường; đối chiếu SePay/ApiPay tại Việt Nam với các nhóm partner quốc tế.  
> **Ngoài phạm vi:** chốt provider, giá bán, ký hợp đồng, tư vấn pháp lý theo từng nước, thiết kế migration/API chi tiết hoặc author coding slice.  
> **Độ mới nguồn:** nguồn provider được kiểm tra ngày 2026-07-27; coverage, pricing, KYC và điều khoản partner có thể đổi, nên phải xác minh lại trước pilot/enablement.

---

## 1. Kết luận ngắn

1. **Nhận định của founder là đúng ở thời điểm hiện tại:** Plexco chỉ có authority, schema và provider contract cho `sepay|apipay`; cả hai phục vụ rail ngân hàng Việt Nam. Vì vậy **không được bán lời hứa “gạch nợ ngân hàng tự động” như một capability toàn cầu của Host Pro**.
2. **Việt Nam là launch market duy nhất hiện có đường provider phù hợp với mô hình tiền về thẳng tài khoản riêng của host.** Tuy nhiên capability này vẫn chưa phải runtime: repo mới có schema + core matching một phần; wiring `webhook → durable ingest → settle → notify` chưa được implement.
3. **Không tìm thấy một provider duy nhất là “SePay toàn cầu”.** Những lựa chọn ngoài Việt Nam chia thành ba mô hình khác nhau:
   - đọc giao dịch từ tài khoản ngân hàng hiện hữu của host;
   - thu tiền qua virtual account/payment rail do provider cấp;
   - đọc bank-feed định kỳ, không đủ realtime.
4. **Không nên khóa cả gói Host Pro theo quốc gia.** Host Pro còn có AI/KB, nhắc nợ, CRM và các automation khác. Nên tách:
   - **commercial entitlement:** tenant có mua `payment_reconcile_auto` hay không;
   - **market/provider availability:** bank account cụ thể có partner đủ chuẩn hay không.
5. **Khuyến nghị launch:** Việt Nam hiển thị auto-reconcile là `Available` sau khi runtime và provider gates đóng; ngoài Việt Nam giữ `payment_mark_manual`, ẩn hoặc gắn `Waitlist/Coming later` cho auto-reconcile. Không thu tiền cho một capability chưa dùng được.

---

## 2. Bài toán thực sự không chỉ là “có webhook”

Plexco chỉ có thể tự gạch nợ an toàn khi nhận được một event đủ để tạo `bank_transactions`, chống trùng và map vào đúng tenant/charge.

Một partner tương đương SePay/ApiPay phải chứng minh tối thiểu:

| Gate | Bằng chứng cần có |
|---|---|
| **P1 · Market/bank coverage** | Quốc gia, loại tài khoản và từng ngân hàng host dùng có trong coverage production |
| **P2 · Ownership/consent** | Host tự đồng ý link tài khoản; Plexco không thu thập internet-banking credential |
| **P3 · Tenant route** | Event xác định được đúng connected account/sub-merchant/host; không route chỉ bằng text chuyển khoản |
| **P4 · Transaction identity** | Có `external_id`/bank reference ổn định, amount, currency, direction, occurred/posted time và account reference |
| **P5 · Matching evidence** | Có raw description/remittance/reference đủ để đọc pay-code hoặc tên; field thiếu phải fail closed |
| **P6 · Authenticity/replay** | Signed webhook hoặc một cơ chế API auth đủ mạnh; retry có thể tạo duplicate và consumer phải idempotent |
| **P7 · Recovery** | Có transaction-history API/backfill để tìm event bị lỡ; webhook một mình không phải guarantee |
| **P8 · Freshness** | SLA/freshness phù hợp lời hứa sản phẩm; “cập nhật vài lần/ngày” không được quảng cáo là realtime |
| **P9 · Platform model** | Có multi-merchant/sub-account/connected-account/partner model hợp lệ; không giả định một account cá nhân quản lý bank của chủ khác |
| **P10 · Money topology** | Xác định tiền về thẳng host hay đi qua provider/platform; nếu đổi custody/settlement thì đó là product/legal architecture mới |
| **P11 · Operations** | Sandbox, delivery log, resend, outage status, support, rate limit và incident reconciliation |
| **P12 · Commercial/legal** | KYC/KYB, phí, data region, consent renewal, DPA/ToS và giấy phép phù hợp market |

**Fail-closed rule:** thiếu bằng chứng ở P3–P7 hoặc không chứng minh được event là tiền vào đã booked/confirmed thì chỉ ingest/review; không auto-allocation và không báo player “đã trả”.

---

## 3. Live repo truth

### 3.1 Product authority hiện hành

| Authority | Điều đã chốt |
|---|---|
| [`decisions.md` DD-29](../standards/decisions.md) | Host Pro 250k gồm đối soát CK tự động, auto reminder, AI/KB và CRM |
| [`decisions.md` DD-30](../standards/decisions.md) | ApiPay enterprise auto-provision per host; tiền vẫn về tài khoản riêng của host |
| [`decisions.md` DD-40](../standards/decisions.md) | Mark-paid thủ công có ở mọi tier; auto-reconcile chỉ `host_pro` |
| [`feature_billing_lifecycle_tech.md` §4b](../features/BE/feature_billing_lifecycle_tech.md) | Capability registry tách `payment_mark_manual` và `payment_reconcile_auto` |
| [`gtm-doi-soat-decision.md`](../strategy/gtm-doi-soat-decision.md) | Đã nhận diện COGS, multi-host/aggregator risk và khác biệt account-feed vs virtual account tại Việt Nam |

### 3.2 Runtime/data model hiện tại

| Repo evidence | Reality |
|---|---|
| [`0003_payments_ledger.sql`](../../packages/db/migrations/0003_payments_ledger.sql) | `bank_accounts.provider` bị giới hạn cứng ở `('sepay','apipay')`; `bank_transactions` có durable external id/amount/raw payload nhưng **không có currency** |
| [`0004_channels_connectors.sql`](../../packages/db/migrations/0004_channels_connectors.sql) | `provider_connections.provider` cũng chỉ `sepay|apipay`; auth mode chỉ theo hai provider hiện tại |
| [`schema.ts`](../../packages/db/schema.ts) | Tenant có `locale`/`timezone` nhưng chưa có country/operational currency; session/charge/bank transaction dùng integer amount mà chưa pin currency |
| [`BUILD-STATUS.md`](../standards/BUILD-STATUS.md) | Matching core có một phần; chưa có wiring webhook→settle→notify và chưa có product E2E |

### 3.3 Hệ quả

- Capability auto-reconcile **chưa thể enable ở bất kỳ quốc gia nào**, kể cả Việt Nam, cho tới khi runtime/payment slice được implement và external provider gates đóng.
- Khi nói “Việt Nam available”, phải hiểu là **market được ưu tiên và có partner path khả thi**, không phải feature đã chạy production.
- Mở rộng quốc tế không phải chỉ thêm một adapter. Ít nhất phải giải quyết:
  - provider registry/contract thay cho CHECK hard-code;
  - operational `currency` và minor-unit rule xuyên `sessions → charges → bank_transactions → allocations`;
  - cấm cross-currency allocation;
  - country/bank-account eligibility;
  - account-feed vs provider-owned virtual-account topology;
  - consent expiry/reconnect;
  - pending/posted/removed transaction semantics;
  - settlement/custody/KYB và pricing theo market.

---

## 4. Ba loại partner — không được coi là tương đương

### A. Bank feed vào tài khoản hiện hữu của host

Host giữ tài khoản ngân hàng và tiền đi thẳng vào host. Provider đọc biến động qua consent/OAuth/API rồi gửi webhook hoặc cho Plexco poll.

- Gần nhất với authority DD-30 “platform không giữ tiền”.
- Cần description/remittance và account route đủ tốt.
- Rủi ro chính: freshness, consent expiry, bank coverage, pending transaction mutation và data-access licensing.

### B. Virtual account / payment collection rail

Provider cấp virtual account/reference riêng; player chuyển vào rail này, provider xác nhận và reconcile.

- Dễ route và match hơn bank feed.
- Nhưng có thể đổi money topology: tiền vào provider/merchant balance trước rồi mới payout.
- Cần connected-account/sub-merchant model, KYC/KYB, settlement và legal review mới.
- Không phải drop-in replacement cho SePay/ApiPay nếu Plexco muốn tiền luôn vào thẳng tài khoản bank hiện hữu của host.

### C. Bank data định kỳ

Provider cho đọc transaction history và thông báo “có dữ liệu mới”, nhưng ngân hàng chỉ refresh một vài lần/ngày.

- Hợp dashboard, audit hoặc delayed reconciliation.
- Không đủ để hứa “trả xong được gạch nợ ngay”.
- Nếu dùng, UX phải ghi rõ độ trễ; payment chỉ được auto-allocation khi transaction đã booked/confirmed.

---

## 5. Landscape partner theo thị trường

### 5.1 Bảng tóm tắt

| Market | Candidate | Mô hình | Bằng chứng chính thức | Đánh giá cho Plexco |
|---|---|---|---|---|
| **Việt Nam** | **SePay** | Bank feed + webhook + history API | Realtime transaction webhook, HMAC/API key/OAuth, retry và API đối soát | **Fit cao nhất với topology hiện tại**; vẫn cần hợp đồng/coverage từng bank và runtime |
| **Việt Nam** | **ApiPay** | Bank-transfer/payment-link + signed webhook | Bank account scoped webhook, signature, delivery log/resend/retry | **Fit cao**; multi-host enterprise terms vẫn là external gate |
| **US · UK · SEPA · Japan · Mexico** | **Stripe Bank Transfers** | Provider virtual account + automatic reconciliation | Virtual account theo customer, auto-reconcile, webhooks; Connect supported | **Candidate mạnh nhưng đổi payment rail/topology**; không phải feed tài khoản host hiện hữu |
| **India** | **Razorpay Smart Collect** | Virtual account/customer identifier | `virtual_account.credited`, bank reference, instant webhook; Partner Auth có sub-merchant account | **Candidate mạnh cho India**; cần KYB, settlement, pricing và platform terms |
| **Indonesia · Philippines · Malaysia · Thailand · Singapore và SEA khác** | **Xendit** | Virtual account/payment methods + platform payments | Multi-market payment methods, VA, realtime payment notifications; sub-account webhook support | **Candidate ưu tiên cho SEA**; exact VA/API/settlement support phải verify theo từng nước |
| **US · Canada · UK và market Plaid hỗ trợ** | **Plaid Transactions** | Consented account data | Transaction sync + webhooks, nhưng update thường chỉ 1–4 lần/ngày | **Không tương đương realtime**; chỉ hợp delayed/batch reconcile hoặc recovery |
| **EEA · UK** | **GoCardless Bank Account Data** | PSD2 account data | Transaction data, đến 90 ngày continuous access; bank rate limit có thể chỉ 4 call/ngày | **Không phù hợp lời hứa realtime**; có thể dùng delayed reconcile |
| **Australia · New Zealand** | **Basiq** | CDR-consented bank data | Account/transaction APIs, event-driven data-change webhooks, AU/NZ coverage | **Candidate POC**; chưa có đủ bằng chứng về payment-confirmation latency để launch |

### 5.2 Việt Nam — SePay và ApiPay

**SePay**

- Official docs mô tả webhook realtime cho giao dịch trên tài khoản đã link, filter theo account/VA/payment code, có HMAC-SHA256/OAuth/API key, retry và delivery monitoring.
- SePay còn có transaction API để backfill/reconcile khi webhook bị lỡ — đúng với yêu cầu P7.
- Bank coverage vẫn phụ thuộc từng ngân hàng và loại giao dịch; không được suy “SePay account active = mọi bank đều realtime”.

Nguồn:

- [SePay Webhooks là gì?](https://developer.sepay.vn/vi/sepay-webhooks)
- [Ngân hàng nào hỗ trợ webhook SePay?](https://developer.sepay.vn/vi/sepay-webhooks/tai-khoan-ngan-hang)
- [Đối soát giao dịch qua API](https://developer.sepay.vn/vi/sepay-webhooks/doi-soat-giao-dich)
- [SePay OAuth2 Webhooks API](https://developer.sepay.vn/en/sepay-oauth2/api-webhook)

**ApiPay**

- Official docs ghi rõ bank transfer tại Việt Nam, webhook gần realtime, `ApiPay-Signature`, bank-scoped webhook, delivery history, resend và retry.
- Đây là bằng chứng tốt cho adapter/event contract.
- Public docs **không tự chứng minh** DD-30 enterprise platform có thể auto-provision tài khoản thuộc nhiều host khác nhau với terms phù hợp. Điểm đó phải đóng bằng hợp đồng/sales evidence.

Nguồn:

- [ApiPay introduction](https://docs.apipay.vn/en)
- [ApiPay Webhooks](https://docs.apipay.vn/en/api/webhooks)

**Kết luận market Việt Nam:** `Preferred launch market`, không phải “đã enable”. SePay và ApiPay đều cần pass checklist P1–P12 ở exact bank/account model sẽ bán.

### 5.3 Stripe Bank Transfers — US/UK/SEPA/Japan/Mexico

Stripe tạo virtual bank account theo customer, nhận transfer rồi tự reconcile vào invoice/payment. Official docs hiện ghi business locations/currencies hỗ trợ gồm Europe/SEPA, UK, Japan, Mexico và US; Connect được hỗ trợ.

Điểm mạnh:

- unique virtual account/reference giúp route chính xác hơn fuzzy name;
- có automatic reconciliation, handling over/underpayment và webhook;
- platform ecosystem/KYB tương đối hoàn chỉnh.

Khoảng cách với Plexco:

- player trả vào rail của Stripe, không nhất thiết vào tài khoản bank hiện hữu của host;
- cần kiểm tra connected-account model, payout timing, fee và host KYC/KYB;
- Stripe docs ghi `on_behalf_of` không được hỗ trợ cho bank transfers, nên không được giả định một platform account trung tâm tự động đại diện mọi host;
- Mexico có thể chậm tới ngày làm việc tiếp theo hoặc lâu hơn, không nên dùng copy “instant”.

Nguồn:

- [Stripe Bank transfer payments](https://docs.stripe.com/payments/bank-transfers)
- [Accept a bank transfer](https://docs.stripe.com/payments/bank-transfers/accept-a-payment)
- [Stripe Invoicing bank transfer reconciliation](https://docs.stripe.com/invoicing/bank-transfer)

**Kết luận:** candidate tốt nếu Plexco chấp nhận provider-controlled collection rail; không phải adapter-only extension.

### 5.4 Razorpay Smart Collect — India

Razorpay Smart Collect tạo Customer Identifier/virtual account để nhận NEFT/RTGS/IMPS. Event `virtual_account.credited` mang payment, bank transfer, bank reference và customer/VA identifiers. Partner Auth cho phép gọi dưới `account_id` của sub-merchant.

Điểm phù hợp:

- server-to-server webhook gần realtime;
- deterministic customer/sub-merchant route;
- unique bank reference phục vụ idempotency/recovery;
- có platform/sub-merchant primitive công khai.

Nguồn:

- [Smart Collect webhooks](https://razorpay.com/docs/payments/smart-collect/subscribe-to-webhooks/)
- [Smart Collect webhook payloads](https://razorpay.com/docs/webhooks/smart-collect/)
- [Partner Auth — Smart Collect](https://razorpay.com/docs/partners/aggregators/partner-auth/smart-collect/)

**Kết luận:** candidate ưu tiên nếu vào India, nhưng là virtual-account rail; cần commercial/legal review trước khi thiết kế.

### 5.5 Xendit — Southeast Asia

Xendit công bố payment coverage ở Indonesia, Philippines, Malaysia, Thailand, Vietnam, Singapore và các market khác; có virtual accounts, bank transfers, realtime payment notifications và platform payments cho sub-merchants.

Điểm phù hợp:

- một integration có thể phủ nhiều market SEA;
- virtual account giúp deterministic route;
- có platform/sub-account pattern và payment webhooks.

Điểm phải xác minh:

- exact VA/bank-transfer product khác nhau theo quốc gia;
- một số legacy callback như `fva_paid` chỉ ghi support Indonesia; không được suy từ marketing multi-market rằng cùng API/semantics dùng ở mọi nước;
- settlement account, KYB, phí, refund và sub-merchant model cần sales evidence theo market.

Nguồn:

- [Xendit market and platform coverage](https://www.xendit.co/en/)
- [Xendit payment methods](https://www.xendit.co/en-ph/products/all-payment-methods/)
- [Xendit webhook URL API](https://docs.xendit.co/apidocs/set-webhook-url)

**Kết luận:** candidate ưu tiên cho SEA ngoài Việt Nam; chạy discovery/POC theo từng country, không bật bằng một flag “SEA”.

### 5.6 Plaid — bank feed nhưng không realtime

Plaid Transactions cho link account, đọc transaction history và nhận `SYNC_UPDATES_AVAILABLE` khi có thay đổi. Tuy nhiên official docs nói Plaid thường check transaction **một hoặc vài lần mỗi ngày**, phụ thuộc institution; refresh realtime hơn là add-on/on-demand và cũng không biến bank data thành payment confirmation SLA.

Nguồn:

- [Plaid Transactions](https://plaid.com/docs/transactions/)
- [Plaid Transactions webhooks](https://plaid.com/docs/transactions/webhooks/)

**Kết luận:** dùng được cho delayed reconciliation/recovery, không dùng để quảng cáo auto-clear realtime.

### 5.7 GoCardless Bank Account Data — EEA/UK batch feed

GoCardless cung cấp account/transaction data qua PSD2 ở EEA/UK, đến 90 ngày continuous access. Official docs cảnh báo bank có thể áp rate limit thấp tới 4 calls/account/day.

Nguồn:

- [GoCardless Bank Account Data overview](https://developer.gocardless.com/bank-account-data/overview)
- [Transaction data fields](https://developer.gocardless.com/bank-account-data/transactions)

**Kết luận:** phù hợp dashboard/delayed reconcile; không đạt yêu cầu immediate auto-clear nếu không có một payment rail khác.

### 5.8 Basiq — Australia/New Zealand

Basiq là CDR-accredited platform, có customer-consented accounts/transactions, webhooks cho jobs/connections/data changes và coverage Australia/New Zealand.

Nguồn:

- [Basiq introduction and coverage](https://api.basiq.io/reference/introduction)
- [Basiq transactions](https://api.basiq.io/reference/gettransactions)

**Kết luận:** candidate POC. Trước khi đưa vào roadmap phải đo freshness theo bank, pending→posted behavior, stable transaction id và support model.

---

## 6. Tác động tới Host Pro

### 6.1 Ba phương án packaging

| Phương án | Ưu điểm | Vấn đề | Đánh giá |
|---|---|---|---|
| **A. Host Pro chỉ bán ở Việt Nam** | Copy đơn giản, không over-promise auto-reconcile | Chặn doanh thu quốc tế từ AI/KB, CRM, reminders và automation không phụ thuộc bank | Hợp như launch policy tạm thời, không nên là architecture dài hạn |
| **B. Host Pro global, luôn liệt kê auto-reconcile** | Một bảng giá toàn cầu | Bán capability không hoạt động; support/refund risk; sai truth-in-advertising | **Không chọn** |
| **C. Host Pro global + availability theo market/bank; có thể tách add-on** | Đúng sự thật, giữ đường monetization global, pricing theo COGS market | UI/billing/entitlement phức tạp hơn | **Khuyến nghị** |

### 6.2 Khuyến nghị cụ thể

**Near-term**

- Tại Việt Nam:
  - `Host Pro` có thể quảng bá “Đối soát chuyển khoản tự động” **sau** khi runtime và enablement gates pass.
  - Hiển thị danh sách bank/provider được hỗ trợ; không dùng copy “mọi ngân hàng”.
- Ngoài Việt Nam:
  - mọi tier vẫn có `payment_mark_manual`;
  - auto-reconcile hiển thị `Chưa hỗ trợ tại quốc gia/ngân hàng này` hoặc `Tham gia waitlist`;
  - nếu các Pro feature khác chưa đủ giá trị độc lập, có thể tạm thời không mở bán Host Pro ở market đó.

**Long-term**

- Giữ `host_pro` là plan thương mại.
- Biến auto-reconcile thành capability có hai điều kiện:

```text
AUTO_RECONCILE_ENABLED
  = subscription_has("payment_reconcile_auto")
  AND bank_connection.status == "active"
  AND provider_market_capability == "supported"
  AND exact_bank_account_capability == "realtime_booked_transactions"
```

- Không gate chỉ bằng `tenant.country`. Availability phải bám **connected bank account + provider + bank + currency + consent state**.
- Cho phép pricing khác theo market hoặc tách `Auto Reconcile` thành add-on nếu COGS/support khác lớn.

### 6.3 Copy sản phẩm đề xuất

**Việt Nam, sau enablement**

> Đối soát chuyển khoản và gạch nợ tự động — áp dụng cho ngân hàng được hỗ trợ.

**Ngoài Việt Nam**

> Gạch nợ thủ công có sẵn. Đối soát ngân hàng tự động đang được mở theo từng quốc gia và ngân hàng.

Không dùng:

- “Host Pro tự động gạch mọi chuyển khoản”;
- “hỗ trợ toàn cầu”;
- “realtime” nếu provider chỉ refresh vài lần/ngày;
- “tiền về thẳng host” với virtual-account rail chưa chứng minh settlement topology.

---

## 7. Kiến trúc sản phẩm cần quyết định trước khi mở international slice

Research này phát hiện một blocker lớn hơn provider adapter: **operational money model hiện đang ngầm VND**.

Trước khi author implementation plan quốc tế, owner/architecture cần chốt:

1. **Market scope đầu tiên sau Việt Nam:** India, một nước SEA, AU/NZ hay US/Europe — không làm “global” mega-slice.
2. **Money topology:** chỉ chấp nhận account-feed/direct-to-host, hay cho phép provider virtual account + payout?
3. **Currency authority:** currency thuộc tenant, session, bank account hay charge; rule chuyển market/currency; minor units; cấm cross-currency allocation.
4. **Provider contract chung:** normalized booked-credit event, stable ID, amount/currency, remittance, account route, raw payload, recovery cursor và provider evidence.
5. **Freshness product classes:** `realtime`, `delayed`, `manual`; copy và notifications theo class.
6. **Entitlement vs availability:** plan mua quyền, provider/bank xác định có dùng được; billing không thu capability unavailable.
7. **Consent lifecycle:** active/expiring/expired/revoked/drift, reconnect UX và behavior khi feed ngừng.
8. **Custody/KYB gate:** platform/connected-account/sub-merchant owner, settlement, refunds, disputes và legal owner từng market.
9. **Launch evidence:** sandbox fixture + production-shaped event + duplicate/retry + missed-event backfill + outage drill + bank-specific pilot.

---

## 8. Đề xuất decision để founder chốt sau research

### Proposed direction

> **Host Pro là plan global, nhưng `payment_reconcile_auto` là capability regional. Việt Nam là market launch đầu tiên và duy nhất được công bố ở thời điểm hiện tại. Ngoài Việt Nam, Plexco chỉ cung cấp mark-paid thủ công cho tới khi exact provider/bank/currency qua partner gate. Không có provider evidence thì capability absent/fail-closed, không degrade thành auto-match từ dữ liệu không đáng tin.**

### Các câu cần owner trả lời

| ID | Câu hỏi | Khuyến nghị |
|---|---|---|
| **OQ-RAR-1** | Host Pro ngoài Việt Nam có bán ngay với AI/CRM/reminders nhưng không auto-reconcile không? | Có, chỉ khi value/copy/pricing đủ độc lập; nếu chưa thì waitlist |
| **OQ-RAR-2** | Plexco có chấp nhận virtual-account/custody topology ngoài Việt Nam không? | Chưa mặc định; mở market-specific decision vì ảnh hưởng legal và ledger |
| **OQ-RAR-3** | Market discovery ưu tiên sau Việt Nam? | SEA qua Xendit trước nếu chiến lược khu vực; India/Razorpay là alternative có fit kỹ thuật mạnh |
| **OQ-RAR-4** | Auto-reconcile nằm trong Host Pro hay add-on? | Giữ capability trong Pro ở Việt Nam launch; cho phép add-on/price override theo market sau khi có COGS |
| **OQ-RAR-5** | Mức latency nào còn được gọi “tự động”? | Chỉ `realtime/near-realtime` được auto-notify ngay; delayed feed phải có copy riêng |

Không câu trả lời nào ở trên được phép do implementer tự chọn trong lúc code.

---

## 9. Lộ trình research/partner validation đề xuất

### Wave 0 — Việt Nam

- Chốt ApiPay enterprise multi-host contract hoặc SePay partner path.
- Lấy exact supported-bank matrix, payload, signature, retry, history API, pricing và incident SLA.
- Pilot tối thiểu hai bank và hai host account owner khác nhau.
- Chỉ sau đó mới phân loại provider gate là đủ cho enablement.

### Wave 1 — một market ngoài Việt Nam

Chọn **một**:

- SEA: Xendit exact-country VA/platform POC;
- India: Razorpay Smart Collect Partner Auth POC;
- AU/NZ: Basiq bank-feed freshness POC;
- US/Europe: Stripe Bank Transfers nếu chấp nhận virtual-account topology.

Mỗi POC phải trả ra cùng một evidence packet P1–P12 để so sánh được.

### Wave 2 — generalize sau khi có hai provider thật

Chỉ extract provider-neutral contract sau khi đã có:

- một provider account-feed direct-to-host; và
- một provider virtual-account/sub-merchant rail.

Không thiết kế “global provider abstraction” từ lý thuyết trước hai implementation-shaped probes; hai mô hình có lifecycle và legal boundary khác nhau.

---

## 10. Research verdict

**Kết luận áp dụng ngay:**

- `AUTO_RECONCILE_MARKET_AT_LAUNCH: VIETNAM_ONLY`
- `HOST_PRO_GLOBAL_AVAILABILITY: CONDITIONAL_ON_NON_BANK_VALUE_AND_LOCAL_COPY`
- `MANUAL_MARK_PAID: GLOBAL_BASELINE`
- `NON_VN_AUTO_RECONCILE: WAITLIST_UNTIL_EXACT_PROVIDER_GATE`
- `NO_SINGLE_GLOBAL_SEPAY_EQUIVALENT_FOUND`
- `NEXT_DECISION: OQ-RAR-1..5`

Các dòng trên là kết luận research/product direction đề xuất, **không phải readiness verdict và không authorize implementation**.

---

## 11. Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
| 2026-07-28 | v1.2 | Re-pin repo truth to `main@784bc8d`; the Chat authority/readiness docs after `2dc9b8c` add no payment runtime/provider authority, so regional conclusions and OQ-RAR-1..5 remain unchanged. |
| 2026-07-27 | v1.1 | Re-pin repo truth sang `main@2dc9b8c`; xác nhận delta gần đây không thêm auto-reconcile runtime/provider authority, nên giữ nguyên research boundary và OQ-RAR-1..5. |
| 2026-07-27 | v1.0 | Tạo research về regional availability, phân loại partner models, shortlist theo market và khuyến nghị tách Host Pro entitlement khỏi bank/provider availability |
