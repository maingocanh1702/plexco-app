# Feature: Player View (Person-self) — Backend Tech Spec

> **Canonical phase:** P4.6  
> **Version:** 2.10 · 2026-08-10
> **Status:** Reviewed  
> **Implementation:** Not started · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Product spec:** `../FE/feature_player_view.md`  
> **References:** `../../product/TDD.md` §3.4/§4 (person-self contract) · `../../standards/decisions.md` DD-37/DD-91/DD-96 · `../../proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md`

> **DD-48 boundary:** endpoints `/api/me*` chỉ self. Cross-user social profile dùng service/DTO trong `feature_user_settings_tech` §6; host operational reads tiếp tục qua tenant-scoped membership/roster authz. Không thêm `:personId` vào player-view API và không share serializer có tiền/PII.

> **DD-91 primary-surface boundary:** `getSelfPaymentStatus` là person-self authority duy nhất cho `/api/me/charges`, exact chat `/pay` và authenticated notification detail. Human DM không có tenant authority (`tenant_id=NULL`), nên phải resolve CLB từ own memberships và dùng opaque actor-bound picker khi mơ hồ. Primitive số học dùng chung là `remainingAmount(amountDue, amountAllocated)`; service giữ fail-closed `unknown` cho authz/integrity/dependency failure và không đổi null/unproven thành 0.

> **Execution ownership:** mechanism slices 17 `player-self-charge-read-core`, 18 `player-self-profile-clubs-read-core`, 19 `player-self-sessions-waitlist-read-core`; thin chat composition là 24 `chat-pay-command-adapter`, 25 `chat-profile-navigation-command-adapters`, 26 `chat-session-command-adapters`. Slice 19 đọc trực tiếp baseline `players/memberships/sessions` đã merge, không hard-depend full SessionService và không sở hữu mutation/business rules. Enable `/sessions|/waitlist` beta vẫn bắt buộc strict current-authority packets `svc-session-crud`, `svc-session-join-leave`, `svc-waitlist-promotion-core` + production-shaped data E2E. Primary plan v1.8 đã `PLAN_READY` tại `90d292d`; pair vẫn Not started và từng mechanism slice vẫn phải strict `CODE_READY`.

> **Cập nhật v2.1 (DD-37 ✅, 2026-07-10):** magic-link/bot surfaces phase-1 = **Zalo + Facebook Messenger** (bỏ Telegram); đăng nhập web = Google/email (DD-13). Person-self contract không đổi.

---

## 1. Tổng quan triển khai

```text
Authenticated session / Magic link → Person resolver
    → getSelfPaymentStatus (person-self scope) → DTO allowlist
        → /api/me/charges · exact chat /pay · authenticated notification detail
    → own profile/clubs read (slice 18)
    → own sessions/waitlist read over players/memberships/sessions (slice 19)
    → Realtime topic: person:<id> (authorized)
```

Privileged cross-tenant read path — NOT normal tenant-admin access. Person authority comes only from verified session/magic link.

### Entry points

| Entry | Caller | Mô tả |
|-------|--------|-------|
| `GET /api/me/charges` | Player (web) | Person-self payment status per club |
| `GET /api/me/payment-summary` | Player (web/Home) | Cross-club `SelfPaymentSummary` (unknown-dominates) |
| `GET /api/me/profile` | Player (web) | Own profile + clubs read (slice 18) |
| `GET /api/me/sessions` | Player (web) | Own sessions + waitlist over players/memberships (slice 19) |
| `/pay` chat command adapter | Player (chat) | Requester-only `getSelfPaymentStatus` — no ledger write |
| Magic link resolver | Player (Zalo/Messenger) | Verify hash → person session → DTO allowlist |
| SSE `person:<id>` topic | System | Realtime push for person-self changes |

---

## 2. Database Schema + Edge Cases (BE)

### Schema

```sql
CREATE TABLE magic_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hash text NOT NULL UNIQUE,
  person_id uuid NOT NULL REFERENCES persons(id),
  channel text NOT NULL,  -- 'zalo', 'messenger' (phase-1, DD-37); 'telegram' legacy tenant-1
  session_id uuid REFERENCES web_sessions(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_magic_links_hash ON magic_links(hash) WHERE used_at IS NULL;
```

Uses existing tables: `persons`, `memberships`, `players`, `charges`, `payment_allocations`.

### Migration & Rollback

- **Live-schema truth (main; số migration verify live tại `packages/db/migrations/` — đừng hard-pin range):** `magic_links` **đã tồn tại** trong `0001_global_directory.sql` với đúng shape DDL trên (kể cả partial index `idx_magic_links_hash`) — **reuse baseline, không recreate; `DROP` = ❌ NEVER**. Các bảng đọc (`persons`/`memberships`/`players`/`charges`/`payment_allocations`) cũng đã có ở `0001`–`0003`.
- `magic_links.channel` live là `text NOT NULL` không CHECK — thay đổi channel values theo DD-37 (`zalo`/`messenger`, `telegram` legacy) là comment/runtime-validation, không cần DDL. Nếu build slice thêm CHECK/constraint/cleanup object mới → migration mới **monotonic theo next available number sau tail hiện tại của main** (verify tail hiện hành tại `packages/db/migrations/` tại thời điểm author, KHÔNG hard-pin số); không sửa migration lịch sử.
- **Rollback:** tắt routes `/api/me*` + `/api/magic-link/consume` (feature-level) → revert additive-only các object mới nếu có; không DROP `magic_links` baseline (chứa link/session lineage thật).

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | URL/body contains arbitrary person_id | ❌ Reject — use verified session only |
| 2 | Security | DTO includes other-player data | ❌ NEVER — allowlist enforced |
| 3 | Security | Magic link replay | Single-use — `used_at` set on consume |
| 4 | Security | Magic link expired | Reject — TTL check |
| 5 | Security | Magic link wrong channel/person | Reject — channel + person bound |
| 6 | Cross-Feature | Account merge → old magic links | Invalidate all old person's links |
| 7 | Security | Cross-tenant error reveals club | Generic 403/empty — no club info leaked |
| 8 | Data Integrity | Left membership still visible | Historical display with clear "Đã rời" status |
| 9 | Data Integrity | Partial/overpay/unallocated tx | Display only when safely attributable |
| 10 | Security | Realtime topic guessing | AuthZ per subscription — reject |
| 11 | Security | Log/analytics contains other-player PII | ❌ NEVER — opaque IDs only |
| 12 | Cross-Feature | Session revocation after merge | Invalidate old sessions/topics |
| 13 | Security | Human DM `/pay` có `tenant_id=NULL` | Không derive từ peer/channel; resolve own eligible clubs, auto-select đúng một hoặc trả opaque actor-bound picker |
| 14 | Privacy | Human-DM peer nhận slash/picker/result | ❌ NEVER — authenticated response requester-only; không shared message/event/history/notification |
| 15 | Data Integrity | Charge/allocation/authz/dependency không chứng minh được | `SelfPaymentStatus.kind='unknown'`; không null/error→0 |
| 16 | Security | Client truyền arbitrary `person_id`/raw `tenant_id` | Reject/ignore fail-closed; person từ auth context, club từ trusted channel/notification subject hoặc opaque bound ref |
| 17 | Enablement | Slice 19 read tests pass nhưng một current Session packet hoặc production-shaped E2E còn thiếu | Deploy/read core dark nếu cần; `/sessions|/waitlist` beta route vẫn OFF |

---

### Query Patterns

```sql
-- getPlayerDashboard (person-self, multi-tenant aggregate)
SELECT s.id, s.sport_key, s.starts_at, s.area, s.price,
       p.status AS player_status,
       t.display_name AS club_name
FROM players p
JOIN sessions s ON s.id = p.session_id
JOIN tenants t ON t.id = s.tenant_id
WHERE p.person_id = $1
  AND s.starts_at > now()
ORDER BY s.starts_at
LIMIT 20;

-- getPaymentHistory (person-self)
SELECT c.id, c.amount, c.currency, c.status, c.created_at,
       s.sport_key, s.starts_at
FROM charges c
JOIN players p ON p.id = c.player_id
JOIN sessions s ON s.id = p.session_id
WHERE p.person_id = $1
ORDER BY c.created_at DESC
LIMIT 20;
```

## 3. API Contract

### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET | /api/me | Authenticated Person | Dashboard summary |
| GET | /api/me/clubs | Authenticated Person | Own memberships |
| GET | /api/me/clubs/:id | Authenticated Person | Club detail (own data) |
| GET | /api/me/sessions | Authenticated Person | Upcoming sessions |
| GET | /api/me/charges | Authenticated Person | Own charge/payment projections grouped by authorized club ref; không nhận raw tenant/person authority |
| GET | /api/me/requests | Authenticated Person | Join request status |
| POST | /api/magic-link/consume | Public (with hash) | Consume magic link |

### Request/Response Examples

> DTO minh hoạ theo DTO allowlist §4 (chỉ own-data); field name chốt ở build slice; envelope DD-60 (`../../standards/api-reference-convention.md`).

**GET `/api/me/charges`** (own charges + allocation status):

```json
{
  "data": {
    "clubs": [
      {
        "clubRef": "club_opaque",
        "clubLabel": "Bestminton",
        "status": {
          "kind": "known_amount",
          "currency": "VND",
          "totalOutstanding": 50000,
          "chargeCount": 1,
          "items": [
            {
              "sessionRef": "session_opaque",
              "startsAt": "2026-07-30T12:00:00Z",
              "amountDue": 120000,
              "amountAllocated": 70000,
              "remaining": 50000,
              "status": "partial"
            }
          ],
          "asOf": "2026-07-27T12:00:00Z"
        }
      }
    ]
  },
  "error": null,
  "meta": { "requestId": "req_…" }
}
```

- `401` — không có session hợp lệ:

```json
{ "data": null, "error": { "code": "AUTH_REQUIRED", "message": "Cần đăng nhập", "statusCode": 401 }, "meta": { "requestId": "req_…" } }
```

**POST `/api/magic-link/consume`** — invalid/expired/used/sai person/sai channel đều trả một error generic (edge cases #3–#5):

```json
{ "data": null, "error": { "code": "MAGIC_LINK_INVALID", "message": "Link không hợp lệ hoặc đã hết hạn", "statusCode": 400 }, "meta": { "requestId": "req_…" } }
```

### Idempotency

| Endpoint | Idempotent? | Key |
|----------|-------------|-----|
| `GET /api/me*` | ✅ read-only | — (không mutation) |
| `POST /api/magic-link/consume` | ✅ single-use fail-closed | `hash` UNIQUE + `used_at` set on consume (edge case #3); replay → `MAGIC_LINK_INVALID`, không mint session thứ hai |

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 401 | `AUTH_REQUIRED` | Cần đăng nhập | No valid session |
| 400 | `MAGIC_LINK_INVALID` | Link không hợp lệ hoặc đã hết hạn | Invalid/expired/used |
| 403 | `TOPIC_UNAUTHORIZED` | Không có quyền theo dõi | Wrong realtime topic |


### Rate Limits

| Endpoint | Limit | Scope |
|----------|-------|-------|
| `GET /api/player/dashboard` | 30/min | per user |
| `GET /api/player/sessions` | 30/min | per user |
| `GET /api/player/payments` | 20/min | per user |
| `GET /api/player/clubs` | 20/min | per user |
---

## 4. Chi tiết triển khai

### Canonical self-payment service (DD-91)

```ts
type SelfPaymentStatus =
  | { kind: "known_zero"; currency: "VND"; asOf: string }
  | {
      kind: "known_amount";
      currency: "VND";
      totalOutstanding: number;
      chargeCount: number;
      items: readonly {
        sessionRef: string;
        startsAt: string;
        amountDue: number;
        amountAllocated: number;
        remaining: number;
        status: "open" | "partial";
      }[];
      payAction?: { kind: "open_protected_pay"; href: string };
      asOf: string;
    }
  | { kind: "unknown"; reasonCode: string; retryable: boolean };

// DD-96 Part A — cross-club aggregate. Owner = player_view; KHÔNG helper thứ hai ở consumer.
type SelfPaymentSummary =
  | { kind: "known_zero"; currency: "VND"; asOf: string }
  | {
      kind: "known_amount";
      currency: "VND";
      totalOutstanding: number;  // tổng remaining xuyên CLB
      clubCount: number;         // số CLB CÓ outstanding > 0 — không phải tổng số CLB
      asOf: string;
    }
  | { kind: "unknown"; reasonCode: string; retryable: boolean };

function remainingAmount(amountDue: number, amountAllocated: number): number {
  return Math.max(0, amountDue - amountAllocated);
}

// Signature KHÔNG đổi so với live `packages/core/src/payments-logic.ts:258`:
// tham số vẫn là `OpenDebt` (`paid_amount?: number | null` — OPTIONAL), guard vẫn
// kiểm cả `null` lẫn `undefined`. Thu hẹp thành object literal có
// `paid_amount: number | null` sẽ làm bốn caller hiện có vỡ typecheck, mâu thuẫn
// với ràng buộc "bốn caller giữ nguyên" của DD-91.
function effectiveFee(d: OpenDebt): number | null {
  if (d.fee === null || d.fee === undefined) return null;
  return remainingAmount(d.fee, d.paid_amount ?? 0);
}
```

- `getSelfPaymentStatus(authenticatedPerson, resolvedOwnClub)` nhận person từ verified auth context; không nhận `person_id` từ URL/body/message. `resolvedOwnClub` chỉ đến từ trusted club channel, authenticated notification subject hoặc opaque requester-bound club ref.
- Chỉ số `amountDue`/`amountAllocated` đã được service chứng minh hợp lệ mới đi vào `remainingAmount`. Missing row/field, allocation không toàn vẹn, authz hoặc dependency failure trả `{kind:"unknown"}`; **không** coerce thành `0`. `effectiveFee` giữ semantics hiện hành: `fee=NULL → NULL`; với fee đã biết, `paid_amount=NULL` mang nghĩa canonical “chưa allocate” rồi mới delegate primitive.
- **`getSelfPaymentSummary(authenticatedPerson)` (DD-96 Part A)** — cross-club aggregate cho Home chip "Còn nợ". Cùng service family, cùng primitive `remainingAmount`; consumer (Home) **không** được tự cộng per-club status. Quy tắc:
  - **Unknown-dominates:** bất kỳ club nào trong own authorized set trả `kind='unknown'` ⇒ summary = `unknown`. **Cấm** sum các club `known_*` rồi hiển thị — partial sum tạo một con số trông authoritative nhưng **thấp hơn nợ thật**, user đọc thành "đã trả gần hết". Đây là bất biến `unknown ≠ 0` (§Bất biến Product) áp ở tầng aggregate, không phải một policy mới.
  - `known_zero` chỉ khi **mọi** authorized club đều proven `known_zero`. Person chưa thuộc CLB nào cũng là `known_zero`, không phải `unknown`.
  - `clubCount` đếm **CLB có `totalOutstanding > 0`**, không phải tổng số membership — chip hiện "còn nợ ở N CLB".
  - **Không** `payAction` ở tầng summary: `payAction` là optional field của per-club `SelfPaymentStatus` và v2.6 đã pin *"never a global/item action"*. Aggregate pay CTA xuyên CLB là quyết định chưa mở.
  - Chip tap điều hướng tới outstanding detail đã có (`/me — outstanding detail`), nơi render per-club `SelfPaymentStatus.items[]` = các kèo chưa trả. Không cần DTO mới cho màn detail.
  - Additive read-only; **không** bảng/migration/route mới — surface (`/api/me/charges` mở rộng hay sibling endpoint) chốt ở build slice.
- `/api/me/charges` enumerate own authorized clubs rồi bọc mỗi kết quả thành `{clubRef, clubLabel, status: SelfPaymentStatus}`; wrapper không chứa raw tenant ID. Exact chat `/pay` và authenticated notification detail gọi cùng service một lần cho trusted/opaque selected club. Ba consumer không có formula/serializer money riêng. `known_zero` chỉ được tạo sau query ledger đầy đủ chứng minh không còn open/partial remaining.

**Human-DM `/pay` tenant resolution (`chat_channels.tenant_id=NULL`):**

| Own eligible clubs | Hành vi |
|---|---|
| `0` | Requester-only generic “không có CLB phù hợp”; không tiết lộ tenant |
| `1` | Server auto-select CLB đó rồi gọi `getSelfPaymentStatus` |
| `>1` | Trả picker gồm opaque, actor-bound, short-lived club refs; chọn ref mới gọi service |
| Ref sai actor/hết hạn/replay | Generic invalid/reload picker; không fallback sang raw tenant id |

Slash được intercept trước human-message writer. Peer không nhận slash, picker, result, event hay notification; authenticated response không được persist vào shared chat history.

### Person-self DTO Allowlist

| Field | Source | Allowed |
|-------|--------|---------|
| Own memberships | memberships WHERE person_id = self | ✅ role, status, club display name |
| Own sessions | `players` JOIN `memberships` WHERE `memberships.person_id = self` | ✅ session info, starts_at, player status |
| Own charges | `charges` JOIN `memberships` WHERE `memberships.person_id = self` | ✅ amount, status, `payment_allocations` |
| Other player roster | `players` joined to membership of another person | ❌ NEVER |
| Admin data | tenant settings, other charges | ❌ NEVER |

### Magic Link Flow

```text
Bot conversation (Zalo/Messenger) → Verify conversation → Issue magic link
    → Hash stored, expires in 5min, single-use, person+channel bound
    → Player clicks → Consume hash → Create web session → Redirect to /me
```

### Caching Strategy

| Data | Cache? | Lý do |
|------|--------|-------|
| Person-self DTO (memberships/sessions/charges) | ❌ | Tiền + PII cross-tenant — đọc live dưới person-self authz; cache có thể serve data cũ sau merge/session revocation (edge cases #6/#12) |
| Magic link state | ❌ | Single-use + TTL 5 phút — check live trong consume transaction |
| Realtime topic authz | ❌ | AuthZ per subscription (edge case #10), không cache verdict |
| Chưa liệt kê | ❌ fail-closed | Mặc định không cache trên surface person-self |

### Security Checklist (template v2.33 — map về section đã pin)

| Mục | Trả lời trong spec |
|-----|---------------------|
| Authorization/ownership | DD-48 boundary (chỉ self, không `:personId`); person authority chỉ từ verified session/magic link (§1); DTO allowlist §4; realtime topic authz per subscription (edge #10) |
| Injection/validation | Edge #1: reject person_id từ URL/body — chỉ dùng verified session; cross-tenant error generic 403/empty, không leak club info (edge #7) |
| Secret & log redaction | Magic link lưu hash-only, single-use (§2); edge #11: log/analytics opaque IDs only, không other-player PII |
| Webhook signature + replay | N/A — doc không có webhook surface; magic-link replay đã chống bằng single-use `used_at` (edge #3) |
| Idempotency | Bảng Idempotency §3 + edge #3 |
| Data retention/xoá | ⬜ chưa pin — cleanup/expiry sweep cho `magic_links` rows hết hạn chốt ở build slice; retention policy chung theo `feature_security_operations_tech.md`. Merge → invalidate old links/sessions (edge #6/#12) đã pin |

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | /me valid session | Authenticated | Own summary |
| 2 | /me no session | Unauthenticated | 401 |
| 3 | /me/clubs returns own | 3 memberships | 3 clubs |
| 4 | /me/clubs excludes others | Other person's clubs | Not visible |
| 5 | /me/charges returns own | 2 charges | 2 charges |
| 6 | Other player data | Direct query attempt | ❌ Blocked |
| 7 | Magic link valid | Fresh hash | Session created |
| 8 | Magic link expired | Expired TTL | `MAGIC_LINK_INVALID` |
| 9 | Magic link replay | Already used | `MAGIC_LINK_INVALID` |
| 10 | Magic link wrong person | Different person | `MAGIC_LINK_INVALID` |
| 11 | Magic link wrong channel | Wrong channel | `MAGIC_LINK_INVALID` |
| 12 | Left membership visible | Historical | Shows "Đã rời" |
| 13 | Partial payment display | Partial charge | Remaining amount shown |
| 14 | Overpay display | Overpayment | Safely attributed |
| 15 | Cross-tenant error | Guess tenant | 403/empty |
| 16 | Realtime topic valid | person:self | Subscribed |
| 17 | Realtime topic invalid | person:other | Rejected |
| 18 | Merge invalidates links | Account merged | Old links invalid |
| 19 | Merge converges view | 2 persons merged | Combined data |
| 20 | Log PII check | Request logs | No other-player PII |
| 21 | Remaining primitive | amountDue=120000, amountAllocated=70000 | `remainingAmount(...) = 50000` |
| 22 | Effective fee delegation | fee null vs known fee + null paid | null fee → null; known fee delegates với allocated=0 |
| 23 | Canonical consumer parity | Cùng person/club snapshot qua web, `/pay`, notification detail | Cùng `SelfPaymentStatus`/remaining/status |
| 24 | Unknown fail-closed | Authz/integrity/dependency error hoặc unproven field | `kind='unknown'`, không amount 0/no-debt |
| 25 | Human-DM picker isolation | Requester có 2 clubs, peer đang mở DM | Chỉ requester nhận opaque actor-bound picker/result; peer/shared history nhận 0 artifact |
| 26 | Arbitrary ID rejection | Body/message có other `person_id` hoặc raw `tenant_id` | Không ảnh hưởng resolver; reject generic, không leak |
| 27 | Sessions/waitlist baseline read | Own active/left memberships + upcoming players/waitlist rows | Chỉ own DTO; không đọc roster người khác hoặc gọi mutation rule |
| 28 | Session adapter boundary | `/sessions|/waitlist` qua slice 26 | Adapter delegate slice 19; không duplicate join/leave/promotion logic |
| 29 | Cross-club summary happy (DD-96) | 3 CLB: `known_amount` 50k · `known_amount` 35k · `known_zero` | `kind='known_amount'`, `totalOutstanding=85000`, `clubCount=2` (CLB `known_zero` không đếm) |
| 30 | **Unknown dominates** (DD-96) | 1 CLB `known_amount` 50k + 1 CLB `unknown` | `kind='unknown'`; **KHÔNG** trả `50000`, không partial sum, không `clubCount=1` |
| 31 | Summary all-zero | Mọi authorized club `known_zero` | `kind='known_zero'` |
| 32 | Summary zero-club | Person chưa có membership nào | `kind='known_zero'` — **không** `unknown` |
| 33 | No aggregate payAction | Summary có outstanding > 0 | DTO summary không chứa `payAction` (per-club only, v2.6) |
| 34 | Consumer không re-derive | Home consume summary | Không có code path nào ngoài `getSelfPaymentSummary` tạo cross-club total |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Web auth → /me | Google/email login → view | Own data shown |
| 2 | Magic link E2E | Zalo/Messenger → magic link → /me | Works |
| 3 | Merge → view update | Merge 2 persons → /me | Combined |
| 4 | Realtime update | Join session → /me update | SSE received |
| 5 | Self-payment parity E2E | Seed one own partial charge → web + club `/pay` + notification detail | Ba surface cùng status/remaining từ canonical service |
| 6 | Human-DM `/pay` privacy E2E | Requester có 2 clubs, peer khác person | Requester picker→result; peer và shared history không có command/result |
| 7 | Dependency failure E2E | Ledger read unavailable | Mọi surface trả generic `unknown`/retry; không surface hiển thị 0 |
| 8 | Sessions/waitlist production-shaped data E2E | Current `svc-session-crud` + `svc-session-join-leave` + `svc-waitlist-promotion-core` packets, active/left/waitlisted fixtures | Own DTO đúng authority; route beta chỉ enable khi cả ba packets và E2E pass |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Slice 16 `core-payment-remaining-primitive` land trước; slice 17 thêm canonical `getSelfPaymentStatus`/own charges và parity tests.
2. Slice 18 `player-self-profile-clubs-read-core` cho `/api/me` + `/api/me/clubs`; không gộp charge/session logic.
3. Slice 19 `player-self-sessions-waitlist-read-core` author read-only từ baseline `players JOIN memberships JOIN sessions`; không chờ full SessionService và không thêm join/leave/promotion mutation.
4. Giữ web auth/magic link/realtime person-self boundary hiện hành; mỗi route/adapter vẫn cần packet riêng và không được suy implementation từ spec.
5. Sau slash registry/requester-only mechanism slices 22/23, slices 24/25/26 lần lượt delegate `/pay`, `/me|/myclubs|/discover|/name`, `/sessions|/waitlist`; adapter không re-derive domain state.
6. Enable `/sessions|/waitlist` beta chỉ sau strict current-authority packets `svc-session-crud`, `svc-session-join-leave`, `svc-waitlist-promotion-core` và integration #8 trên production-shaped data đều xanh. Trước gate này route giữ OFF dù slice 19 compile/test read-only.

### Metrics

- Player view opened / source (web/bot)
- Magic link consumed/failed rate
- Own-debt viewed count
- Realtime reconnect rate

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-08-10 | v2.10 | **A-grade upgrade:** thêm Entry points table (7 entries); bump version. Không đổi contract/person-self model. |
| 2026-08-07 | v2.9 | **DD-96 Part A:** thêm canonical cross-club `SelfPaymentSummary` + `getSelfPaymentSummary` vào §4 — đóng gap `feature_home_tech.md:166` (`SelfPaymentStatus` là per-club, Home bị cấm tự cộng). Pin **unknown-dominates** (một CLB `unknown` ⇒ cả summary `unknown`, cấm partial sum vì nó hiện số thấp hơn nợ thật), `clubCount` = số CLB có outstanding > 0, không `payAction` ở tầng aggregate. Thêm unit #29–34. Additive read-only: không bảng/migration/route mới, surface chốt ở build slice. Host receivable ("Chưa thu") **không** vào file này — DD-48 + DTO allowlist §4 `other charges ❌ NEVER`; xem DD-96 Part B. Không authorize runtime. |
| 2026-07-28 | v2.8 | Reconcile immutable authority `90d292d` and primary plan v1.8 `PLAN_READY`; retain per-mechanism `CODE_READY`, beta OFF and no-runtime boundaries. |
| 2026-07-28 | v2.7 | Mirror exact read owners 17–19 và thin chat adapters 24–26; pin slice 19 authorable từ merged baseline nhưng `/sessions|/waitlist` beta giữ OFF tới ba strict current Session packets + production-shaped data E2E. Add unit #27–28/integration #8; pair remains Not started/no runtime authorization. |
| 2026-07-27 | v2.6 | Sửa signature `effectiveFee` trong §snippet: v2.5 viết tham số thành object literal `{ fee: number \| null; paid_amount: number \| null }`, thu hẹp so với live `OpenDebt` (`paid_amount?` OPTIONAL, `payments-logic.ts:258`) và bỏ guard `undefined`. Implement đúng chữ sẽ làm bốn caller hiện có (`coverRemaining`, `classifyDeposit`, `classifyIncoming`, `classifyCoverage`) vỡ typecheck — trái ràng buộc "bốn caller giữ nguyên" của DD-91. Chỉ sửa contract snippet; không đổi semantics, không đổi status. |
| 2026-07-27 | v2.5 | Mirror DD-91: pin `remainingAmount`/`effectiveFee` delegation, canonical `getSelfPaymentStatus` cho web/chat/notification, human-DM opaque requester-only picker và fail-closed `unknown`; thêm parity/privacy/ID-rejection tests. Giữ Reviewed/not implemented. |
| 2026-07-24 | v2.4a | **De-pin migration-tail** (docs-migration-tail-0018-to-0020-sweep): Live-schema truth header + numbering guidance hard-pinned `migrations 0000–0018` → non-pinned "verify tail hiện hành tại `packages/db/migrations/`, không hard-pin số" (live tail nay `0020`; `0019`/`0020` tenant-integrity FKs DD-68). Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-23 | v2.4 | **Reconcile migration-tail 0018:** current-state §2 migration facts sửa: (a) `tail = 0014_players_waitlist` → **tail = 0018** (`0018_oauth_completion_handoff.sql`; migrations 0000–0018 đã merge trên `main` — 0014 waitlist schema-only, lane auth DD-80 0015–0018 ⛔ chưa enable); (b) "Live-schema truth (main, migrations `0000`–`0014`)" range → `0000`–`0018` (nhất quán, tránh mâu thuẫn với tail). Numbering guidance giữ nguyên (next-available monotonic sau synced tail, verify live `packages/db/migrations/` trước khi tạo, không hardcode/sửa lịch sử). Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-19 | v2.3 | **Template v2.30/v2.33 uplift:** thêm §2 Migration & Rollback (`magic_links` đã có ở `0001` — reuse baseline, DROP ❌ NEVER; channel values không cần DDL), §3 Request/Response Examples (DD-60) + Idempotency, §4 Caching Strategy + Security Checklist. Derivative/editorial — không đổi contract. |
| 2026-07-19 | v2.2a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), DDL, 12 edge cases, DTO allowlist, 20 tests |
| 2026-07-10 | v2.1 | **DD-37 ✅:** magic-link channels = Zalo/Messenger (bỏ Telegram); /me web auth = Google/email (DD-13). Cập nhật `magic_links.channel` comment, Magic Link Flow, rollout, tests. |
| 2026-07-13 | v2.2 | Person-self query contract dùng canonical `players` + `memberships` và `payment_allocations`; bỏ tên bảng giả `session_roster`/`allocations`. |
