# Feature: Club — CLB Management — Backend Tech Spec

> **Canonical phase:** P4
> **Version:** 1.0 · 2026-08-10
> **Status:** Draft
> **Implementation:** Not started · authority: `../../standards/BUILD-STATUS.md`
> **Product spec:** `../FE/feature_club.md`
> **References:** `../../standards/decisions.md` · `feature_inapp_chat_tech.md` (chat_channels schema) · `feature_session_management_tech.md` · `feature_cross_club_join_tech.md`

---

## 1. Tổng quan triển khai

```text
Club tab → GET /api/me/clubs (person-self memberships)
    → grouped by role (owner/admin vs member/guest)
    → per-club: member count, session frequency, pinned post

Club detail → GET /api/clubs/:tenantId (tenant-scoped, RLS)
    → sub-features: news, sessions, members, chat, settings

News/Announcement → reuse chat_channels(kind='club', post_policy='admins_only')
    → pin: PATCH /api/clubs/:tenantId/channels/:channelId/pin
    → unpin: DELETE /api/clubs/:tenantId/channels/:channelId/pin
```

### Module map

| Module | Trách nhiệm |
|--------|-------------|
| `ClubService` | Club list aggregation, detail, settings CRUD |
| `ClubNewsService` | News post CRUD, pin/unpin logic |
| Chat infrastructure | Tái dùng `chat_channels`, `chat_messages` từ `feature_inapp_chat_tech.md` |
| `PlayerViewService` | Person-self membership resolver (canonical) |

---

## 2. Database Schema + Edge Cases (BE)

### Schema additions

> Tái dùng `chat_channels` và `chat_messages` từ `feature_inapp_chat_tech.md`. Chỉ thêm fields cho pin post.

**Pin post fields** — đã thêm vào `chat_channels` (v0.24):

```sql
-- Trong chat_channels (đã có từ feature_inapp_chat_tech.md)
pinned_message_id uuid,                    -- 1 pinned post/channel; NULL = no pin; club only
pinned_at timestamptz,                     -- khi nào pin; NULL nếu chưa pin

-- FK constraint
ALTER TABLE chat_channels
  ADD FOREIGN KEY (id, pinned_message_id)
  REFERENCES chat_messages(channel_id, id);

-- CHECK: chỉ club channels mới có pin
ALTER TABLE chat_channels
  ADD CHECK (kind = 'club' OR pinned_message_id IS NULL);
```

### Key queries

```sql
-- Club list (person-self)
SELECT t.id, t.name, t.sport_type, m.role,
       COUNT(DISTINCT m2.person_id) AS member_count,
       ch.pinned_message_id
FROM memberships m
JOIN tenants t ON t.id = m.tenant_id
LEFT JOIN memberships m2 ON m2.tenant_id = t.id AND m2.status = 'active'
LEFT JOIN chat_channels ch ON ch.tenant_id = t.id AND ch.kind = 'club'
    AND ch.post_policy = 'admins_only' AND ch.is_default IS TRUE
WHERE m.person_id = $1 AND m.status = 'active'
GROUP BY t.id, t.name, t.sport_type, m.role, ch.pinned_message_id;

-- Pin post (atomic)
UPDATE chat_channels
SET pinned_message_id = $1,
    pinned_at = now()
WHERE id = $2
  AND tenant_id = $3
  AND kind = 'club'
RETURNING *;

-- Auto-unpin when message deleted/hidden
CREATE OR REPLACE FUNCTION auto_unpin_on_delete()
RETURNS trigger AS $$
BEGIN
  IF NEW.author_deleted_at IS NOT NULL OR NEW.moderation_state = 'hidden' THEN
    UPDATE chat_channels
    SET pinned_message_id = NULL, pinned_at = NULL
    WHERE pinned_message_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_unpin
  AFTER UPDATE ON chat_messages
  FOR EACH ROW
  WHEN (NEW.author_deleted_at IS NOT NULL OR NEW.moderation_state = 'hidden')
  EXECUTE FUNCTION auto_unpin_on_delete();
```

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Non-member gọi GET /api/clubs/:tenantId | RLS deny — 403 |
| 2 | Security | Member gọi PATCH pin (non-admin) | Capability check `chat.channel.manage` — 403 |
| 3 | Concurrency | 2 admin pin khác post cùng lúc | Last-write-wins (scalar `pinned_message_id`); idempotent |
| 4 | Data Integrity | Pin message không thuộc channel | FK constraint reject — 400 |
| 5 | Data Integrity | Pin message đã bị xóa (tombstone) | Check `author_deleted_at IS NULL AND moderation_state = 'visible'` trước pin — 400 |
| 6 | Data Integrity | Pinned message bị xóa sau khi pin | Trigger `auto_unpin_on_delete` → auto NULL |
| 7 | Security | Cross-tenant pin (pin message CLB A vào CLB B) | FK(channel_id, id) + tenant RLS — impossible |
| 8 | Concurrency | Pin + delete cùng lúc | Trigger chạy AFTER UPDATE; nếu pin trước delete → auto unpin |
| 9 | Data Integrity | Unpin khi chưa có pin | Idempotent — SET NULL khi đã NULL = no-op |
| 10 | Security | Non-club channel (DM) cố pin | CHECK constraint `kind = 'club' OR pinned_message_id IS NULL` — reject |
| 11 | Data Integrity | Club settings update concurrent với archive | Tenant-level lock; archived tenant reject mutation |
| 12 | Security | Visitor (non-authenticated) cố truy cập club | Auth middleware → 401 trước RLS |

---

## 3. API Contract

### `GET /api/me/clubs` — Club list

```json
// Response 200
{
  "data": {
    "owned": [
      {
        "tenantId": "uuid",
        "name": "CLB Cầu lông BT",
        "sportType": "badminton",
        "role": "owner",
        "memberCount": 12,
        "weeklySessionCount": 3,
        "pinnedPost": { "id": "uuid", "body": "Lịch tháng 8...", "pinnedAt": "..." } | null
      }
    ],
    "joined": [
      {
        "tenantId": "uuid",
        "name": "BK Badminton",
        "sportType": "badminton",
        "role": "member",
        "memberCount": 20,
        "weeklySessionCount": 2,
        "pinnedPost": null
      }
    ]
  }
}
```

### `PATCH /api/clubs/:tenantId/channels/:channelId/pin` — Pin post

**Requires:** `chat.channel.manage` capability

```json
// Request
{ "messageId": "uuid" }

// Response 200
{
  "data": {
    "channelId": "uuid",
    "pinnedMessageId": "uuid",
    "pinnedAt": "2026-08-10T..."
  }
}
```

**Idempotent:** Pin cùng message 2 lần → cùng result (update `pinned_at`).

**Rate limit:** 10 req/phút per tenant per actor.

### `DELETE /api/clubs/:tenantId/channels/:channelId/pin` — Unpin

**Requires:** `chat.channel.manage` capability

```json
// Response 200
{ "data": { "channelId": "uuid", "pinnedMessageId": null } }
```

**Idempotent:** Unpin khi chưa pin → 200 (no-op).

### `GET /api/clubs/:tenantId/announcements` — News feed

```json
// Response 200
{
  "data": {
    "pinnedPost": { ... } | null,
    "posts": [
      {
        "id": "uuid",
        "body": "Tối nay kèo bình thường...",
        "author": { "personId": "uuid", "displayName": "Anh T", "role": "admin" },
        "createdAt": "...",
        "isPinned": false,
        "reactions": { "👍": 3, "❤️": 1 }
      }
    ],
    "nextCursor": "..." | null
  }
}
```

---

## 4. Chi tiết triển khai

### Pin/Unpin State Machine

```
[No Pin] ──pin──→ [Pinned]
    ↑                  │
    │                  │
    └──unpin/auto──────┘
```

- **No Pin:** `pinned_message_id IS NULL`
- **Pinned:** `pinned_message_id = <uuid>, pinned_at = <timestamp>`
- **Auto-unpin trigger:** Khi pinned message bị `author_deleted_at` hoặc `moderation_state='hidden'`

### Caching Strategy

| Resource | Cache | TTL | Invalidation |
|----------|-------|-----|-------------|
| Club list | Person-scoped | `private, no-store` | SSE membership change |
| Club detail | Tenant-scoped | `private, no-store` | SSE tenant update |
| Announcements | Tenant-scoped | 30s `s-maxage` | SSE new post / pin change |
| Pin status | Included in channel metadata | Inherited | SSE pin event |

---

## 5. Testing Plan

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Club list returns owned + joined groups | Person with 3 memberships | 2 groups: owned(1) + joined(2) |
| 2 | Club list empty for new user | Person with 0 memberships | Empty arrays |
| 3 | Club list excludes `left` memberships | Person with 1 active + 1 left | Only active returned |
| 4 | Club detail returns tenant data | Valid tenant_id + active membership | 200 + detail |
| 5 | Club detail 403 for non-member | Valid tenant_id + no membership | 403 |
| 6 | Pin post success | Admin + valid message_id | 200 + pinned |
| 7 | Pin replaces existing pin | Admin + already pinned channel | 200 + new pin, old unpin |
| 8 | Pin 403 for non-admin | Member role | 403 |
| 9 | Pin 400 for deleted message | Tombstone message_id | 400 |
| 10 | Pin 400 for cross-channel message | Message from different channel | 400 (FK violation) |
| 11 | Unpin success | Admin + pinned channel | 200 + null |
| 12 | Unpin idempotent | Admin + not-pinned channel | 200 (no-op) |
| 13 | Auto-unpin on message delete | Pin message → soft-delete | Trigger → pinned_message_id = NULL |
| 14 | Auto-unpin on moderation hide | Pin message → moderator hide | Trigger → pinned_message_id = NULL |
| 15 | DM channel cannot pin | DM channel + pin attempt | CHECK constraint reject |
| 16 | Announcements feed returns pinned first | Channel with pinned + non-pinned | Pinned post separate + timeline |
| 17 | Announcements pagination | >20 posts | Keyset cursor pagination |
| 18 | Settings update success | Owner + valid payload | 200 + updated tenant |
| 19 | Settings 403 for member | Member role | 403 |
| 20 | Cross-tenant isolation | Pin in tenant A, query tenant B | No data leak |
| 21 | Rate limit pin | >10 pin requests/min | 429 |

---

## 6. Rollout Plan + Changelog

### Rollout

1. **Schema:** Pin fields added to `chat_channels` — migration after `chat_*` root tables exist
2. **API:** Club list + detail + announcements + pin/unpin endpoints
3. **SSE:** Pin/unpin events broadcast to channel members
4. **FE:** Club tab UI + News feed + pin/unpin interaction

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-08-10 | v1.0 | Initial: Club management BE spec. Pin post schema (tái dùng `chat_channels` + trigger auto-unpin), 3 API endpoints, 12 edge cases, 21 tests. Announcement feed tái dùng `chat_channels(admins_only)`. |
