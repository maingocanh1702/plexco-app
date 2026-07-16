# Plexco - Identity Model (Person / Auth / Channel)

> Mục tiêu: một danh tính người thật ổn định, tách rõ khỏi tài khoản đăng nhập web,
> điểm nhắn tin của bot, và quan hệ membership trong từng club.
>
> Trạng thái: working model (**orientation — KHÔNG phải source of truth**), căn theo schema/docs hiện tại:
> `packages/db/schema.ts`, `packages/db/migrations/0001_global_directory.sql`,
> `docs/features/feature_identity.md`, `docs/features/BE/feature_identity_tech.md`,
> `docs/features/BE/feature_web_auth_onboarding_tech.md`,
> `docs/standards/core-db-architecture-principles.md`.
>
> **v3.4 Phase-1 pivot (DD-37 ✅):** một Person link **Google + Facebook + Zalo** — **không còn Telegram**.
> Auth phase-1 = **Google OAuth + email/password** (DD-13 ✅, thay TG Login) · link **Facebook** (DD-33 🟡, phase-1)
> · **Zalo Login** (DD-14 ⬜). **DD-50:** phase-1 không thu SĐT; strong proof cho claim có tiền = verified account email hoặc transactional one-time `link_code`. Phone fields giữ dormant. Xem §7 matrix.

---

## 1. Nguyên tắc

1. **`persons.id` là gốc người thật.** Lịch sử người chơi, membership, charge, audit và
   person-self view hội tụ về `Person`, không gắn trực tiếp vào Google email, Zalo id
   hay Facebook/Messenger PSID.
2. **`accounts` là principal đăng nhập web.** Một account dùng để mở web/app session và
   có thể trỏ về một `person_id`. Account không thay thế `Person`.
3. **Login provider khác channel nhắn tin.** Login = cách xác thực vào web/app
   (`account_identities`, `web_sessions`). Channel = endpoint bot/native để nhận/gửi
   tin (`channel_identities`, `channel_reachability`). Hai lớp này độc lập.
4. **Membership là tenant data.** `memberships(person_id, tenant_id)` mới là quan hệ một
   người với một club. First contact có thể tạo `Person`/`ChannelIdentity`, nhưng không
   tự cấp membership nếu chưa có join/approval rõ ràng.
5. **Phone là tín hiệu dormant, không phải phase-1 proof.** Physical schema encrypted +
   lookup hash được giữ cho tương lai nhưng phase-1 không thu phone, không tích hợp SMS OTP
   và không dùng phone để claim/merge.
6. **Claim có tiền chỉ mở bằng proof DD-50.** Verified account email hoặc transactional
   one-time `link_code` mới là strong proof. Tên, alias, username, bank holder/CK và owner
   assertion chỉ là hint/review evidence; không được bypass.
7. **Xung đột identity fail-closed.** Khi một provider/channel/link-code chạm account
   hoặc person khác, không tự merge im lặng. Tạo plan/review hoặc yêu cầu host/support
   xử lý bằng flow merge/unlink có audit.
8. **PII và raw provider IDs không nằm trong log/event/public projection.** Raw phone,
   email, platform id, OTP/code chỉ được lưu dạng encrypted/hash theo purpose.

---

## 2. Bảng canonical

### `persons` - người thật global protected

| cột | ghi chú |
|---|---|
| `id` | uuid PK, canonical person id |
| `display_name` | tên hiển thị, không phải identity proof |
| `phone_enc` | phone encrypted, không log/plaintext |
| `phone_lookup_hash` | deterministic lookup hash để tìm/merge |
| `phone_verified_at` | null = chưa verify |
| `status` | `active` / `merged` / `deleted` |
| `merged_into_person_id` | tombstone pointer khi đã merge |

Invariant vật lý giữ dormant cho tương lai: `UNIQUE(phone_lookup_hash) WHERE phone_verified_at IS NOT NULL AND status = 'active'`. Phase-1 không populate hoặc dùng các cột này làm proof.

### `accounts` + `web_sessions` - web/app auth principal

| bảng | vai trò |
|---|---|
| `accounts` | principal đăng nhập web/app; optional `person_id` |
| `web_sessions` | session token hash, CSRF, expiry, rotation/revoke |
| `account_identities` | login identity đã verify trỏ về `account_id` |
| `magic_links` | person-self passwordless entry, trỏ về `person_id` |

`account_identities` hiện là protected auth table với:

```text
(account_id, platform, platform_user_hash, verified_at)
UNIQUE(platform, platform_user_hash)
```

Product **đã chốt Google/email/password (DD-13 ✅, phase-1)** + link Facebook (DD-33 🟡): đó là
**web-auth schema/adaptor delta** trên `account_identities`/credential tables với
`platform ∈ { google, email, facebook(DD-33), zalo(DD-14) }` — **không** phải lý do tạo thêm root
table `users`. Adapter TG Login đã bỏ (DD-37).

### `channel_identities` - bot/native identity trỏ về Person

| cột | ghi chú |
|---|---|
| `id` | uuid PK |
| `person_id` | FK -> `persons.id` |
| `platform` | `zalo` / `messenger` (phase-1). *(Telegram archived — DD-37; enum trong `schema.ts` có thể giữ giá trị `telegram` forward-compat, nhưng không nhận runtime ở phase-1.)* |
| `platform_user_id_enc` | raw provider id encrypted |
| `platform_user_lookup_hash` | lookup hash cho uniqueness |
| `username_enc` | optional, không phải key |
| `status` | `active` / `inactive` |

Invariant: `UNIQUE(platform, platform_user_lookup_hash)`.

Runtime phase-1 (DD-37): channel accepts **Zalo + Messenger**. Messenger nay là **phase-1 (P2.5)**,
route theo `messenger_pages.page_id`, phụ thuộc App Review. **Telegram loại khỏi phase-1** (không nhận runtime).

### `channel_reachability` - nhắn được trong tenant nào

`channel_identities` là global. Reachability là tenant-scoped:

```text
PRIMARY KEY (person_id, tenant_id, platform)
can_dm, last_inbound_at, window_expires_at, otn_token_enc...
```

Không dùng `ChannelIdentity` global để suy ra "nhắn được mọi club"; mỗi tenant/platform
có trạng thái reachability riêng.

### `memberships` - Person trong một club

| cột | ghi chú |
|---|---|
| `tenant_id` | club/RLS boundary |
| `person_id` | FK -> `persons.id` |
| `display_name` | tên trong club, UI/local alias |
| `pay_code` | mã đối soát trong tenant |
| `status` | `active` / `guest` / `left` / `merged` |

Invariant: một active/guest membership cho một `(tenant_id, person_id)`.

---

## 3. Invariants phải enforce ở DB/service

- `persons`: phone schema dormant; nếu tương lai enable thì verified phone unique bằng lookup hash, không plaintext. Phase-1 không thu/không dùng làm proof.
- `account_identities`: `UNIQUE(platform, platform_user_hash)`.
- `channel_identities`: `UNIQUE(platform, platform_user_lookup_hash)`.
- `memberships`: active person unique theo tenant.
- `channel_reachability`: unique theo `(person_id, tenant_id, platform)`.
- `link_codes`: hash-only, TTL ngắn, single-use, attempts/rate-limit.
- `merge_audit` + `merge_tombstones`: mọi merge có actor, method, reason, before/after.
- Runtime API role không broad SELECT global protected tables; đi qua identity/auth service
  hoặc SECURITY DEFINER function hẹp, có purpose/audit.

---

## 4. Luồng chính

### A. Bot/native first contact

1. Adapter verify provider signature/token và lấy stable `(platform, platform_user_id)`.
2. Identity service hash/encrypt provider id.
3. Tra `channel_identities(platform, lookup_hash)`.
   - Có -> lấy `person_id`.
   - Không -> tạo `persons` + `channel_identities` idempotently; unique race thì reload.
4. Resolve tenant riêng bằng route context (Zalo bot token, Messenger Page — cả hai phase-1).
   *(Telegram group/admin đã loại — DD-37.)*
5. Chỉ tạo `membership` khi có join/approved action. Tin nhắn đầu tiên không tự thành member.

### B. Web/app login

1. Auth adapter verify login provider: **Google OAuth + email/password** (DD-13 ✅, phase-1) và
   **Facebook Login** (DD-33 🟡, phase-1 — phụ thuộc App Review). **Adapter TG Login đã bỏ** (DD-37).
2. Tra `account_identities(platform, platform_user_hash)`.
   - Có -> tạo/rotate `web_sessions`.
   - Không -> tạo `accounts` + `account_identities` theo flow onboarding.
3. Nếu account cần gắn với `Person`, chỉ dùng strong proof DD-50: verified account email
   hoặc transactional one-time `link_code`. Support/owner assertion, tên/alias và CK chỉ tạo
   review evidence; không gắn hoặc claim membership có tiền bằng các tín hiệu đó.

### C. Link bot channel với Person hiện có

Đường chính là transactional one-time `link_code` tường minh:

- Channel A hoặc web/app phát hành code cho `source_person_id`/`source_channel_identity_id`.
- Người dùng nhập code ở Channel B hoặc web/app.
- Service verify code, tạo merge plan, yêu cầu confirmation rõ ràng nếu thay đổi Person.
- Commit chỉ xảy ra trong transaction có lock/audit.

Không dùng SĐT hoặc tên làm điều kiện bắt buộc để link bot. Nếu provider API thay đổi và
cấp thêm signal, signal đó vẫn phải được verify riêng trong adapter trước khi dùng.

---

## 5. Link-code contract

Canonical table: `link_codes`, không phải `identity_link_codes`.

| trường | yêu cầu |
|---|---|
| `source_person_id` | Person phát hành code |
| `source_channel_identity_id` | channel nguồn đã authenticated |
| `code_lookup_hash` | indexed lookup hash, unique |
| `code_hash` + `salt` | slow hash để verify plaintext code |
| `action` | ví dụ `merge_identity` |
| `expires_at` | TTL mặc định 10 phút |
| `consumed_at` | single-use |
| `failed_attempts` | rate-limit/cooldown |

Yêu cầu:

- Code cryptographic, entropy mục tiêu >=32 bits. Không dùng 6 số nếu chỉ đạt khoảng
  20 bits entropy.
- Plaintext code chỉ trả một lần, không log.
- Verify transaction lock row, tăng failed attempts atomically, consume đúng một lần.
- Error generic: không tiết lộ code/person/channel có tồn tại.
- Code chỉ tạo quyền lập merge proposal; merge commit cần confirmation và conflict checks.

---

## 6. Merge contract

`mergeUsers` nên gọi theo domain hiện tại là `mergePersons` hoặc `mergeIdentity`, vì root
canonical là `Person`.

Transaction bắt buộc:

1. Authorize actor/signal; load source/target Person theo thứ tự ID ổn định để tránh deadlock.
2. Lock persons, channel identities, memberships, charges và reachability liên quan.
3. Reload merge plan; reject nếu stale.
4. Chọn canonical Person.
5. Move `channel_identities` sang canonical Person, xử lý unique conflict fail-closed.
6. Với mỗi tenant:
   - nếu chỉ có một membership -> re-parent membership;
   - nếu cả hai Person có membership cùng tenant -> chọn survivor, mark loser `merged`,
     re-parent players/charges, giữ tombstone mapping;
     **`pay_code` (DD-02): GIỮ trên tombstone (KHÔNG re-parent); recognition follow
     `merged_into_membership_id` sang survivor (guards tenant/status/cycle) → QR/memo cũ vẫn chạy;**
   - merge `channel_reachability` deterministic theo tenant/platform.
7. Không sửa/xóa `bank_transactions` hoặc `payment_allocations`. Ledger facts giữ nguyên;
   charges/players được re-parent hợp lệ.
8. Mark old Person `merged`, tạo `merge_tombstones`.
9. Invalidate outstanding link codes/sensitive sessions.
10. Ghi `merge_audit` + outbox event trong cùng transaction.

Rollback toàn bộ nếu bất kỳ tenant/money step nào fail.

---

## 7. Provider/channel phase matrix

> Cập nhật v3.4 (DD-37): auth phase-1 = Google + email; Facebook + Zalo là kênh + provider link phase-1; **Telegram loại khỏi phạm vi**.

| surface | loại | phase/status | ghi chú |
|---|---|---|---|
| **Google login (OAuth)** | web auth | **phase-1 ✅ (DD-13)** | `account_identities.platform='google'` + `web_sessions`; SI-2 keyed-hash cho `google.sub` |
| **Email/password (self-register)** | web auth | **phase-1 ✅ (DD-13)** | credential/verification table riêng (P12 expand→contract); verified email = auto-merge signal |
| **Facebook Login** | web auth | **phase-1 🟡 (DD-33)** | `platform='facebook'`; phụ thuộc App Review/BM verification; degrade → one-time `/link` code thủ công; **không** auto-link chéo với Messenger PSID |
| **Zalo Login** | web auth | ⬜ (DD-14) | `platform='zalo'`; cần xác minh gating OA; đường link cho auto-match Zalo bot |
| ~~Telegram Login / web fallback~~ | web auth | **loại khỏi phase-1 (DD-37)** | adapter TG Login đã bỏ; không còn là đường auth |
| **Zalo bot** | channel | **phase-1** | BYO bot token per club, tenant routing qua `zalo_bots`; DM-only, number-reply |
| **Messenger Page** | channel | **phase-1 (P2.5)** | route theo `messenger_pages.page_id`; PSID page-scoped; cửa sổ 24h; App Review/BM bắt buộc |
| ~~Telegram bot~~ | channel | **archived (DD-37)** | `channels/telegram/` giữ làm lịch sử; không có adapter/bot Telegram ở MVP |

Thêm provider/channel mới không được viết là "chỉ thêm dòng vào bảng" theo nghĩa tuyệt đối.
Đúng hơn:

- Core `Person`/`Membership` không đổi.
- Auth/channel adapter mới phải verify stable subject, hash/encrypt raw id, thêm enum/check
  migration nếu cần, và bổ sung tests/routing/reachability theo phase.

---

## 8. Open decisions

| ID | câu hỏi | trạng thái |
|---|---|---|
| ID-AUTH-1 | Google/email làm auth phase-1? | ✅ **CHỐT — DD-13** (Google OAuth + email/password là auth phase-1, bỏ TG Login theo DD-37) |
| ID-AUTH-2 | Email credential là password, magic-link, hay OAuth-only email claim? | ✅ **DD-13**: email + password self-register (credential table riêng) |
| ID-AUTH-3 | Facebook Login/Messenger account-link như web-auth provider (`platform='facebook'`) | 🟡 **phase-1 — DD-33** (nâng từ ⬜; Messenger nay là kênh MVP); phụ thuộc App Review |
| ID-LINK-1 | Per-provider bot id có scoped theo bot/page/OA thế nào? | verify khi implement → **DD-14** (Zalo Login/OA), **DD-15** (Zalo bot `from.id` cross-bot) |
| ID-MERGE-1 | Support recovery/split SLA và quyền support cụ thể | ✅ **DD-53:** PlatformAdmin freeze; split apply cần 2 approval; break-glass có ticket/expiry/audit; recovery proof không tự mở debt claim |

> **Truy vết:** file này là orientation, KHÔNG chốt quyết định. Mọi mục ở trên phải được
> chốt tại `docs/standards/decisions.md` (DD-13/14/15/33/50/53 — trong đó **Facebook OAuth/Login governed by DD-33**,
> DD-13 chỉ bao Google/email). Nếu DD được ✅, cập nhật spec tương
> ứng (`feature_web_auth_onboarding(.md/_tech)`) rồi mới sửa dòng ở đây cho khớp.

---

## 9. Không làm

- Không tạo bảng root `users` song song với `persons/accounts`.
- Không gắn session/player/charge vào raw provider id.
- Không auto-merge bằng tên, username, bank holder name hoặc unverified email/phone.
- Không lưu plaintext OTP/code/platform id/phone/email trong log/event/public projection.
- Không để bot channel tự giữ truth riêng ngoài canonical Postgres/domain model.
