# A3 — Ma trận phân loại dữ liệu cá nhân (PII data-class matrix) — DRAFT

> **⚠️ DRAFT — input cho luật sư, KHÔNG phải legal advice, KHÔNG phải authority.**
> Tài liệu này là **derived doc**: mọi dòng suy ra từ schema/migrations/docs đang commit, dùng làm
> đầu vào để luật sư VN phân loại và tư vấn. Nó **không** đưa ra kết luận pháp lý, **không** thay
> `standards/decisions.md`, và **không** tự authorize thu/giữ/chuyển dữ liệu. Cột "Đề xuất phân loại"
> là nhãn kỹ thuật tạm để luật sư đối chiếu — KHÔNG phải xác định pháp lý.
>
> **Nguồn suy dẫn (baseline `f2af39d6dba4c335f95a15ab7e8da46861f1400b`, nhánh `main`):**
> `packages/db/schema.ts` (AUTHORITATIVE cho cột) · `packages/db/migrations/0001…0032` ·
> `docs/product/BRD.md` §8.2 · `docs/standards/business-rules.md` (BL-SEC-4/5/6, BL-PAY-8) ·
> `docs/standards/decisions.md` (DD-50, DD-54, DD-80, DD-04) ·
> `docs/00-start-here/identity-model.md` §8 · `docs/standards/deployment-infra.md` (DD-04 hosting).
>
> **Trạng thái:** A3 = **phase-1 BLOCKER** (probe `docs/probes/pre-code-open-items-2026-07-16.md` §A3,
> nâng lên blocker bởi DD-114 D5). Phiên này **khởi động** A3; **không** đóng. Lead-time luật sư là
> item dài nhất trên critical path → gửi counsel ngay tuần này.

---

## 1. Cách đọc ma trận

**Mẫu lưu trữ PII trong schema** (header `schema.ts:9–16`):

- `*_enc` = `bytea`, **mã hoá at-rest bằng KMS envelope AES-GCM** (nhà cung cấp KMS chưa pin — xem cờ F8).
- `*_lookup_hash` / `*_fingerprint` / `*_hash` = **hash tất định** (keyed HMAC) chỉ để tra cứu bằng-nhau; không giải ngược được về plaintext.
- `*_phc` = password hash Argon2id (PHC string).
- Cột **plaintext** (không enc/hash) được đánh dấu rõ ở cột "Lưu trữ" vì đó là chỗ PII nằm dạng đọc-được (ví dụ `persons.display_name`, `chat_messages.body`).
- Tiền = số nguyên đơn vị nhỏ VND. Thời gian = `timestamptz`.

**Ba mặt phẳng hiển thị (visibility planes)** quyết định ai đọc được:

| Plane | Nghĩa | Bảng tiêu biểu |
|---|---|---|
| **GLOBAL protected** | Cross-tenant, person-scoped; RLS OFF nhưng `app` **zero-grant**, chỉ vào qua SECURITY DEFINER | `persons`, `channel_identities`, `accounts`, web-auth, chat DM-safety |
| **TENANT-private** | Có `tenant_id`; RLS fail-closed theo `app.tenant_id` GUC | membership, session, roster, ledger, connectors |
| **PUBLIC read model** | `public_sessions` — không RLS, chỉ field-whitelist | `public_sessions` |

**Chính sách thu thập đang chốt** (KHÔNG phải kết luận A3):

- **DD-50:** phase-1 **KHÔNG thu SĐT**; `persons.phone_*` giữ **dormant** (schema còn cột, không đi vào proof/flow phase-1).
- **DD-54:** PII **optional** (gender/DOB…) chỉ thu khi **platform config bật** (CMS admin, default OFF); PII **bắt buộc vận hành** (email verified, display name, bank ingest) không tắt được. **DD-54 ghi rõ: config KHÔNG thay legal review A3.**
- **identity-model §8:** PII và raw provider ID không nằm trong log/event/public projection; chỉ lưu encrypted/hash theo purpose.

**Retention đang code hoá hôm nay** (BL-SEC-6, nguồn AUDIT G4; DD-80; BL-PAY-8):

| Lớp | Retention coded | Nguồn |
|---|---|---|
| Audit tài chính | **3 năm**, không xoá → archive | BL-SEC-6 |
| Audit identity | **1 năm**, không xoá → archive | BL-SEC-6 |
| Audit session/auth | **90 ngày**, không xoá → archive | BL-SEC-6 |
| Verify/reset token | **30 ngày** single-use + sweep | DD-80 |
| Bank txn / allocation | **Immutable** — không sửa/xoá, chỉ signed reversal | BL-PAY-8 |
| Ephemeral (link_code, magic_link, oauth txn, login_state, rate_limit) | `expires_at` + cleanup sweep | schema |

> **Chưa có:** đường **export/erasure hướng người dùng (DSAR)**. Xoá person hiện chỉ là soft-delete flag
> `persons.status='deleted'` + `merge_tombstones`; ledger immutable (BL-PAY-8) nên **không thể xoá** giao dịch/allocation. Đây là cờ mở F5 và là câu hỏi Q9/Q10 cho luật sư.

**Chú thích cột "Đề xuất phân loại"** (nhãn kỹ thuật, chờ counsel): `Cơ bản` = định danh/liên hệ cơ bản ·
`Nhạy cảm?` = counsel xác nhận theo luật · `Định danh online` · `Secret` = bí mật xác thực/hệ thống ·
`Tài chính` · `Vị trí` · `UGC` = nội dung do người dùng tạo · `Audit`.

---

## 2. Ma trận — GLOBAL protected: directory & identity

| Bảng · cột (mang PII) | Đề xuất phân loại | Mục đích | Lưu trữ | Retention coded | Xoá/Export hôm nay | Cờ |
|---|---|---|---|---|---|---|
| `persons.display_name` | Cơ bản (tên) | Tên hiển thị người | **plaintext** | — (không có floor) | soft-delete `status='deleted'` | F2 |
| `persons.phone_enc` / `phone_lookup_hash` / `phone_verified_at` | Cơ bản (liên hệ) | Merge signal **tương lai** | enc(KMS) / hash | — | — | **DORMANT — DD-50 không thu phase-1** (F1) |
| `channel_identities.platform_user_id_enc` / `platform_user_lookup_hash` / `username_enc` | Định danh online | Gắn user Telegram/Zalo/Messenger → Person | enc(KMS) / hash / enc | — | xoá theo person merge/tombstone | Telegram = legacy (F3) |
| `link_codes.code_hash` / `salt` / `action` | Secret | Link/merge identity một lần | enc / enc | `expires_at` + sweep | consume/expire | — |
| `merge_audit.before_snapshot_enc` / `after_snapshot_enc` / `actor_id` / `reason_code` | Audit (chứa snapshot PII) | Audit merge identity | enc(KMS) | Identity **1 năm** (BL-SEC-6) | không xoá → archive | F5 |
| `merge_tombstones.old_person_id → canonical` | Định danh online | Ánh xạ id cũ→canonical sau merge | id | — | bất biến (integrity) | — |
| `accounts.person_id` | Cơ bản (khoá giả) | Web account ↔ Person | id | — | — | — |
| `web_sessions.token_hash` / `csrf_secret` | Secret | Phiên web + CSRF | hash / secret | `expires_at`; revoke-all epoch | revoke/expire | — |
| `account_identities.platform_user_hash` | Định danh online | Định danh provider đã verify (vd Google `sub` hash) | hash | — | — | — |
| `rate_limit_hits.bucket` | Định danh online? | Chống lạm dụng | text (có thể là **IP/email-HMAC bucket** — DD-80) | `at` + sweep | sweep | **bucket có thể suy từ IP** (F9) |
| `auth_audit_events.account_id` / `request_ref` / `outcome_class` / `actor_class` | Audit | Audit auth (logout-all, revoke…) | id / text | Session/auth **90 ngày** | không xoá → archive | — |
| `account_emails.email_enc` / `email_lookup_hash` / `kms_key_version` / `verified_at` | Cơ bản (liên hệ) | **Email verified — BẮT BUỘC vận hành** (DD-54) | enc(KMS) / hash | — (email chính); token 30d | soft-delete? chưa có DSAR | F5 |
| `email_password_credentials.password_phc` | Secret | Mật khẩu (Argon2id) | PHC | — | xoá khi đổi credential | — |
| `auth_pending_email_registrations.password_phc` / `registration_key_hash` | Secret | Đăng ký chờ verify | PHC / hash | `expires_at` + sweep | consume/expire | — |
| `auth_email_tokens.token_hash` / `purpose` | Secret | Verify email / reset password | hash | **30 ngày** single-use | consume/expire | — |
| `auth_email_deliveries.payload_enc` / `command_owner_hash` / `command_target_fingerprint` | Cơ bản (liên hệ, trong ledger) | Ledger gửi email (chứa email + link người nhận) | enc(KMS) khi replayable / hash | `expires_at` + terminal sweep | sweep | Email provider OFF (F6) |
| `auth_oauth_transactions.browser_binding_hash` / `nonce_hash` / `pkce_verifier_enc` / `resolved_account_id` | Secret + thiết bị | Giao dịch OAuth Google (Lax cookie binding) | hash / enc(KMS) | `expires_at` + sweep | consume/expire | — |
| `magic_links.hash` / `person_id` / `channel` | Secret | Đăng nhập magic-link | hash | `expires_at` + sweep | consume/expire | — |

---

## 3. Ma trận — TENANT-private: membership, roster, reachability

| Bảng · cột (mang PII) | Đề xuất phân loại | Mục đích | Lưu trữ | Retention coded | Xoá/Export hôm nay | Cờ |
|---|---|---|---|---|---|---|
| `memberships.display_name` / `pay_code` | Cơ bản (tên) | Tên hiển thị trong CLB | **plaintext** | — | re-parent khi merge; không xoá ledger | F2 |
| `aliases.alias_norm` | Cơ bản (tên/biệt danh) | Tên chuẩn hoá để match roster | **plaintext** | — | xoá theo membership | F2 |
| `channel_reachability.person_id` / `can_dm` / `last_inbound_at` / `window_expires_at` / `otn_token_enc` | Định danh online + reachability | Cửa sổ gửi tin per kênh; token OTN Messenger | id / bool / ts / enc(KMS) | window expiry | xoá theo person | — |
| `sessions.venue_name` / `venue_address` / `area` | **Vị trí** | Địa điểm buổi chơi | plaintext | — | theo session lifecycle | Địa điểm CLB, không phải nhà riêng (F7) |
| `players.membership_id` / `last_reminded_at` | Cơ bản (tham gia) | Suất tham gia + lần nhắc cuối | id / ts | — | theo session | — |
| `telegram_links.chat_id` / `linked_by` | Định danh online | Nhóm/kênh Telegram + người link | bigint / id | — | theo tenant | **LEGACY** — expand→contract remove (D1) (F3) |
| `tenant_admins.platform_user_lookup_hash` | Định danh online | Admin CLB theo platform id (hash) | hash | — | deactivate | — |
| `tenant_link_codes.code_hash` | Secret | Mã mời admin/role | hash | `expires_at` | consume/revoke | — |
| `player_chat_context.person_id` / `platform` | Định danh online | Ngữ cảnh routing chat player | id | `updated_at` | theo person | — |
| `routing_audit.actor_id` / `detail` (jsonb) | Audit | Audit định tuyến | id / jsonb | — | — | **jsonb `detail` có thể chứa identifier** (F10) |

---

## 4. Ma trận — Chat (GLOBAL DM-safety + TENANT chat content)

| Bảng · cột (mang PII) | Đề xuất phân loại | Mục đích | Lưu trữ | Retention coded | Xoá/Export hôm nay | Cờ |
|---|---|---|---|---|---|---|
| `chat_blocks.blocker_person_id` / `blocked_person_id` | Nhạy cảm? (quan hệ xã hội) | Ai chặn ai | id | — | theo person | Tiết lộ quan hệ (F11) |
| `chat_reports.reporter_person_id` / `reported_person_id` / `reason_code` / `note` | Nhạy cảm? (tố cáo) | Báo cáo lạm dụng | id / text (`note` **free text ≤500**) | — | — | `note` do người dùng nhập, có thể chứa PII/cáo buộc (F11) |
| `chat_channels.dm_key` / `title` / `created_by_person_id` | Định danh online | Kênh CLB + khoá cặp DM | text / id | `archived_at` | — | `dm_key` suy từ cặp person (F11) |
| `chat_messages.body` / `author_person_id` / `search_document` / `moderation_actor_person_id` | **UGC** (nhạy cảm nhất) | Nội dung tin nhắn, gồm **DM riêng tư** | **body plaintext**; tsvector derived | — (không floor) | soft-delete → tombstone (BL-CHT-5); không hard-delete | **body plaintext, gồm DM** (F4) |
| `chat_members.person_id` / `last_read_*` | Cơ bản (tham gia) | Thành viên kênh + trạng thái đã đọc | id / ts | — | theo person | — |

---

## 5. Ma trận — Tiền / ledger (money-adjacent personal data)

| Bảng · cột | Đề xuất phân loại | Mục đích | Lưu trữ | Retention coded | Xoá/Export hôm nay | Cờ |
|---|---|---|---|---|---|---|
| `bank_accounts.account_number_enc` / `account_fingerprint` / `webhook_secret_enc` / **`pending_account_holder`** / `pending_account_number_enc` | **Tài chính** | STK nhận tiền của host/CLB | enc(KMS) / hash / enc / **plaintext (holder)** / enc | — | active flag | **`pending_account_holder` PLAINTEXT** (F12) |
| `charges.player_id` / `membership_id` / `amount_due` / `amount_allocated` / `status` | Tài chính (gắn người) | Nghĩa vụ tiền của một người trong buổi | id / int | — | theo session; không xoá ledger | actor fields = player/membership |
| `bank_transactions.content_enc` / `raw_payload_enc` / `external_id` / `amount` | **Tài chính + PII bên thứ ba** | **Ingest CK — nội dung memo & payload gốc** | enc(KMS) | Immutable (BL-PAY-8); tài chính 3 năm | **KHÔNG xoá được** (BL-PAY-8) | **BANK MEMO — memo thường chứa tên/SĐT người chuyển** (F13, Q4) |
| `payment_allocations.created_by` / `reason_code` / `amount` / `source` | Tài chính (actor) | Ai đối soát/hoàn/waiver/reversal | id / text / int | Immutable (BL-PAY-8) | không xoá được | actor fields = created_by/reason_code |

---

## 6. Ma trận — Connectors, notifications, public read model

| Bảng · cột | Đề xuất phân loại | Mục đích | Lưu trữ | Cờ |
|---|---|---|---|---|
| `provider_connections.access_token_enc` / `refresh_token_enc` / `api_access_key_enc` / `api_secret_key_enc` | Secret | Credential SePay/ApiPay | enc(KMS) | — |
| `oauth_transactions.code_verifier_enc` | Secret | PKCE bootstrap connector (Sepay) | enc(KMS) | — |
| `zalo_bots.bot_token_enc` / `webhook_token` / `secret` | Secret | Bot token Zalo | enc / text / **`secret` plaintext** | `zalo_bots.secret` plaintext = legacy drift NFR-6 (TDD §660) (F8) |
| `zalo_reply_contexts.person_id` / `item_ids` (jsonb) | Định danh online | Ngữ cảnh trả lời Zalo theo person | id / jsonb | — |
| `messenger_pages.page_id` / `page_token_enc` / `app_secret_enc` | Secret | Credential Page Messenger (Meta) | text / enc | — |
| `notification_intents.person_id` / `type` | Cơ bản (targeting) | Ý định gửi thông báo tới person | id | — |
| `notification_deliveries.target_ref` / `provider_code` | Định danh online | Địa chỉ/đích gửi thực tế trên kênh | text | `target_ref` có thể là địa chỉ kênh (F10) |
| `public_sessions.club_display_name` / **`host_display_name`** / area / price / slots | **PUBLIC** | Read model marketplace (không RLS, field-whitelist) | plaintext (whitelist) | **`host_display_name` = tên người, lộ PUBLIC** (F14, Q13); `tenant_id` "never serialized" |

---

## 7. Bên xử lý & luồng xuyên biên giới (processors & cross-border)

> Danh sách để luật sư xác định vai trò controller/processor, yêu cầu DPA, và nghĩa vụ chuyển dữ liệu ra nước ngoài.
> Vị trí lưu trữ **at-rest** của toàn bộ dữ liệu ứng dụng: **DO Managed Postgres, region Singapore** (DD-04 ✅) —
> tức **đã là chuyển dữ liệu ra nước ngoài** dù người dùng và provider ở VN.

| Bên | Vai trò/luồng | Dữ liệu chạm | Vị trí / xuyên biên | Trạng thái |
|---|---|---|---|---|
| **DigitalOcean** | Hosting compute (App Platform) + DB (Managed PG VPC private) + KMS/secret manager | **Toàn bộ** (at-rest) | **Singapore** (DD-04; Fly = fallback) | ✅ live target; **cross-border → Q7** |
| **SePay / ApiPay** | Ingest CK, webhook đối soát (`provider IN ('sepay','apipay')`) | Bank txn: amount, memo (`content_enc`), payload gốc; STK | VN payment rail | Auto-reconcile chưa runtime; C2b evidence mở |
| **Zalo (VNG)** | Bot/OA messaging | `channel_identities` (zalo), `zalo_bots`, reply context, tên/tin nhắn qua bot | VN | Live central; auto-register/Login evidence mở (C2a/C3) |
| **Meta (Messenger/Facebook)** | Messaging + (tương lai) Facebook Login | `channel_identities` (messenger), `messenger_pages`, OTN token, PSID | **US — xuyên biên** | Submission chưa nộp (C4); OFF tới khi evidence |
| **Google** | OIDC login (strong proof DD-50) | `account_identities` (Google `sub` hash), `auth_oauth_transactions` | **US — xuyên biên** | Login chưa có bằng chứng enable/go-live (DD-80) |
| **Telegram** | Legacy messaging | `channel_identities` (telegram), `telegram_links` | US/EU (Telegram) | **LEGACY** — expand→contract remove (D1) |
| **Email provider (chưa chọn)** | Gửi verify/reset email | `auth_email_deliveries.payload_enc` (email + link) | Chưa xác định | **OFF** — DPA/data-region/retention pending (C7) |
| **LLM provider (chưa chọn)** | Chat assistant KB (Host Pro) | Nội dung chat gửi ra model | Chưa xác định | **Deferred P7** (A7/DD-18); due-diligence matrix pending |

---

## 8. Cờ cross-cutting (open flags) — để luật sư lưu ý

- **F1 — Phone dormant:** `persons.phone_*` còn trong schema nhưng DD-50 không thu phase-1. Counsel xác nhận: giữ cột không-thu có phải "xử lý" theo luật không?
- **F2 — Plaintext names:** `persons.display_name`, `memberships.display_name`, `aliases.alias_norm` lưu **plaintext** (không enc). Có cần mã hoá/minimization không?
- **F3 — Telegram legacy:** dữ liệu identity Telegram còn tồn tại; kế hoạch remove (D1) chưa chạy → nghĩa vụ xoá?
- **F4 — Chat body plaintext + DM:** `chat_messages.body` plaintext, gồm DM riêng tư; không hard-delete (chỉ tombstone). Lawful basis + retention + quyền xoá?
- **F5 — Không có DSAR pipeline:** chưa có đường export/erasure hướng người dùng; audit "không xoá → archive" (BL-SEC-6).
- **F6 — Email deliveries ledger:** `payload_enc` giữ email người nhận trong ledger gửi (provider OFF).
- **F7 — Location data:** `sessions.venue_*`/`area` là dữ liệu vị trí (địa điểm CLB) — NFR-P2 gộp vào "dữ liệu vị trí".
- **F8 — KMS provider chưa pin + `zalo_bots.secret` plaintext:** nhà cung cấp KMS chưa xác định; một secret Zalo còn plaintext (legacy drift, TDD §660).
- **F9 — rate_limit bucket:** có thể suy từ IP/email-HMAC (DD-80) → IP có là PII trong ngữ cảnh này?
- **F10 — jsonb tự do:** `routing_audit.detail`, `notification_deliveries.target_ref`, `zalo_reply_contexts.item_ids` có thể chứa identifier chưa phân loại kỹ.
- **F11 — Quan hệ xã hội / tố cáo:** `chat_blocks`, `chat_reports.note` (free text) tiết lộ quan hệ và có thể chứa cáo buộc.
- **F12 — `pending_account_holder` plaintext:** tên chủ tài khoản ngân hàng lưu plaintext.
- **F13 — Bank memo bên thứ ba:** `bank_transactions.content_enc`/`raw_payload_enc` chứa memo CK — thường có **tên/SĐT người chuyển** (có thể là người KHÔNG phải user của hệ thống). Immutable (BL-PAY-8) nên không xoá được.
- **F14 — Host name public:** `public_sessions.host_display_name` đẩy **tên người** ra surface public (marketplace).

---

## 9. Câu hỏi CHỈ luật sư trả lời được

> Khung pháp lý counsel cần đối chiếu (tài liệu này **không** khẳng định văn bản nào đang hiệu lực):
> **Nghị định 13/2023/NĐ-CP (PDPD)**; và theo probe A3, khả năng **Luật 91/2025 + Nghị định 356/2025** —
> counsel xác nhận văn bản áp dụng cho từng câu dưới đây.

1. **Văn bản áp dụng:** Hiện tại phân loại/nghĩa vụ theo NĐ 13/2023 hay đã chuyển sang Luật 91/2025 + NĐ 356/2025? Khác biệt nào tác động ma trận §2–§6?
2. **Lawful basis (căn cứ xử lý):** Với từng lớp — email verified (bắt buộc), tên hiển thị, định danh kênh (Zalo/Messenger/Google), dữ liệu vị trí venue, dữ liệu tài chính, nội dung chat — căn cứ hợp pháp là gì (đồng ý / hợp đồng / lợi ích chính đáng)? Cái nào **bắt buộc phải có consent tường minh**?
3. **Phân loại nhạy cảm:** Trong luật hiện hành, cái nào là **dữ liệu cá nhân nhạy cảm** — gender/DOB (DD-54 optional), dữ liệu tài chính (STK, charges, allocations), nội dung chat/DM, `chat_reports`, quan hệ block? Nghĩa vụ tăng thêm (bảo vệ, DPIA) là gì?
4. **Bank memo (F13):** `bank_transactions.content_enc`/`raw_payload_enc` chứa tên/SĐT **người chuyển tiền** (có thể không phải user). Căn cứ hợp pháp để thu & giữ PII bên thứ ba trong memo CK? Có phải minimization/redact không? Xử lý thế nào khi ledger **immutable** (BL-PAY-8) mâu thuẫn quyền xoá?
5. **Retention floors:** Luật **yêu cầu tối thiểu** giữ bao lâu cho dữ liệu tài chính/hoá đơn/audit? Retention đang code (tài chính 3 năm, identity 1 năm, session/auth 90 ngày — BL-SEC-6) có đạt sàn luật & có vi phạm nghĩa vụ xoá đúng hạn không?
6. **Quyền của chủ thể (DSAR):** Nghĩa vụ & thời hạn cho quyền truy cập / chỉnh sửa / **xoá** / **rút đồng ý** / **export (portability)**? Hôm nay **chưa có pipeline** — cần xây gì để tuân thủ, và xử lý ra sao khi ledger/audit không cho xoá?
7. **Chuyển dữ liệu ra nước ngoài:** Dữ liệu lưu at-rest ở **Singapore (DigitalOcean)** và một số processor ở **US (Meta/Google)**. Có cần **hồ sơ đánh giá tác động chuyển DL cá nhân ra nước ngoài** (và nộp cơ quan nào)? Điều kiện để hợp lệ?
8. **DPA với bên xử lý:** Cần ký DPA/điều khoản xử lý với những bên nào trong §7 (DigitalOcean, SePay/ApiPay, Zalo/VNG, Meta, Google, email provider, LLM provider)? Điều khoản tối thiểu?
9. **Người dùng vị thành niên:** Nếu có user < tuổi luật định (minor), nghĩa vụ về **consent của người giám hộ** và xử lý dữ liệu trẻ em là gì? Chúng tôi cần cơ chế xác minh tuổi/giám hộ nào?
10. **Consent surfaces:** Đồng ý cần thu **ở đâu, khi nào, dạng gì** trên các surface: web, bot Zalo, Messenger, notification? Một consent qua bot có hợp lệ không? Cần bản ghi consent (thời điểm/nội dung/phiên bản) như thế nào?
11. **ToS & Privacy Policy:** Nội dung tối thiểu bắt buộc cho Chính sách quyền riêng tư + ToS (dữ liệu tài chính + vị trí + hồ sơ cá nhân — NFR-P2)? Ngôn ngữ (VN/EN)?
12. **Encrypted/pseudonymized = personal data?** Dữ liệu chỉ ở dạng `*_enc`(KMS)/hash tất định có còn là "dữ liệu cá nhân" theo luật không? Ảnh hưởng tới nghĩa vụ ra sao?
13. **Host name public (F14):** Đẩy `host_display_name` ra marketplace public có cần consent riêng/căn cứ riêng không?
14. **Breach notification:** Nghĩa vụ & thời hạn thông báo vi phạm dữ liệu (tới cơ quan và tới chủ thể)? Ngưỡng kích hoạt?
15. **Controller vs processor:** Plexco là controller hay processor cho dữ liệu của các CLB (tenant)? Trách nhiệm phân chia giữa Plexco và host CLB thế nào?

---

## 10. Việc còn mở của A3 (không đóng trong phiên này)

- Đây là **starter packet**; luật sư trả lời §9 → kết quả ghi vào `standards/decisions.md` (A3/USR-OQ-3/SEC-OQ-2) theo closure checklist của probe, **không** viết ngược vào file DRAFT này.
- Chưa xác minh: nhà cung cấp KMS cụ thể; DPA hiện có với từng processor; có/không user vị thành niên thực tế; nội dung memo CK thực tế (mẫu hoá).
- Sau khi có tư vấn: cần một quyết định về **DSAR pipeline** và **cross-border TIA** — cả hai đều là công việc kỹ thuật mới, ngoài phạm vi phiên docs này.
