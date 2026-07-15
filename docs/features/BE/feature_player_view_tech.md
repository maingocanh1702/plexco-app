# Feature: Player View (Person-self) — Backend Tech Spec

> **Canonical phase:** P4.6  
> **Version:** 2.2 · 2026-07-13
> **Status:** Reviewed  
> **Product spec:** `../feature_player_view.md`  
> **References:** `../../product/TDD.md` §3.4/§4 (person-self contract) · `../../standards/decisions.md` DD-37

> **DD-48 boundary:** endpoints `/api/me*` chỉ self. Cross-user social profile dùng service/DTO trong `feature_user_settings_tech` §6; host operational reads tiếp tục qua tenant-scoped membership/roster authz. Không thêm `:personId` vào player-view API và không share serializer có tiền/PII.

> **Cập nhật v2.1 (DD-37 ✅, 2026-07-10):** magic-link/bot surfaces phase-1 = **Zalo + Facebook Messenger** (bỏ Telegram); đăng nhập web = Google/email (DD-13). Person-self contract không đổi.

---

## 1. Tổng quan triển khai

```text
Authenticated session / Magic link → Person resolver
    → Cross-tenant read (person-self scope) → DTO allowlist
    → Realtime topic: person:<id> (authorized)
```

Privileged cross-tenant read path — NOT normal tenant-admin access. Person authority comes only from verified session/magic link.

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

---

## 3. API Contract

### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET | /api/me | Authenticated Person | Dashboard summary |
| GET | /api/me/clubs | Authenticated Person | Own memberships |
| GET | /api/me/clubs/:id | Authenticated Person | Club detail (own data) |
| GET | /api/me/sessions | Authenticated Person | Upcoming sessions |
| GET | /api/me/charges | Authenticated Person | Charge/payment status |
| GET | /api/me/requests | Authenticated Person | Join request status |
| POST | /api/magic-link/consume | Public (with hash) | Consume magic link |

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 401 | `AUTH_REQUIRED` | Cần đăng nhập | No valid session |
| 400 | `MAGIC_LINK_INVALID` | Link không hợp lệ hoặc đã hết hạn | Invalid/expired/used |
| 403 | `TOPIC_UNAUTHORIZED` | Không có quyền theo dõi | Wrong realtime topic |

---

## 4. Chi tiết triển khai

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

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Web auth → /me | Google/email login → view | Own data shown |
| 2 | Magic link E2E | Zalo/Messenger → magic link → /me | Works |
| 3 | Merge → view update | Merge 2 persons → /me | Combined |
| 4 | Realtime update | Join session → /me update | SSE received |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Web-authenticated /me only (Google/email — DD-13)
2. Magic link support (Zalo/Messenger)
3. Realtime topic
4. Cross-club summary

### Metrics

- Player view opened / source (web/bot)
- Magic link consumed/failed rate
- Own-debt viewed count
- Realtime reconnect rate

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), DDL, 12 edge cases, DTO allowlist, 20 tests |
| 2026-07-10 | v2.1 | **DD-37 ✅:** magic-link channels = Zalo/Messenger (bỏ Telegram); /me web auth = Google/email (DD-13). Cập nhật `magic_links.channel` comment, Magic Link Flow, rollout, tests. |
| 2026-07-13 | v2.2 | Person-self query contract dùng canonical `players` + `memberships` và `payment_allocations`; bỏ tên bảng giả `session_roster`/`allocations`. |
