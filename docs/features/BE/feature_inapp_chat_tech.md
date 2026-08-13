# Feature: In-app Chat (club-wide + 1-1 + Group) — Backend Tech Spec

> **Canonical phase:** P4
> **Version:** 0.27 · 2026-08-12
> **Status:** ✅ Reviewed contract — DD-38/DD-55/DD-86/DD-91/DD-92/DD-93/DD-94/DD-95 ratified; pending migration
> **Implementation:** Not started — schema `chat_*` chưa vào canonical · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Product spec:** `../FE/feature_inapp_chat.md` *(Reviewed)*
> **References:** `../../standards/decisions.md` DD-38 (chat cơ bản phase-1) · DD-55 (open-DM safety + media) · DD-56 (capability registry) · DD-86 (multi-channel final) · DD-91 (requester-only `/pay`) · DD-92 (conversation interactions/search) · DD-93 (slash registry) · DD-94 (unread-derived notification/digest) · DD-95 (club moderation) · DD-19/DD-20 (trợ lý tái dùng hạ tầng chat) · DD-07 (SSE + LISTEN/NOTIFY) · `../BE/feature_multi_tenant_tech.md` (RLS template) · `../BE/feature_sync_engine_tech.md` (realtime authz)

> ✅ **DD-38 chốt (2026-07-10).** Schema dưới đây là **thiết kế đã pin** (ràng buộc trong DD-38: 2 loại channel, DM guard, dedupe theo `client_msg_id`); nguồn authoritative khi thực thi vẫn là `packages/db/schema.ts` + `packages/db/migrations/*.sql` (**thêm `chat_*` + RLS bằng migration monotonic mới sau migration canonical mới nhất tại lúc build**) + `decisions.md` DD-38. **KHÔNG** tạo bảng song song với `persons/memberships/tenants`.

> ✅ **DD-86 final boundary (2026-07-28):** root `dd38-dd86-chat-schema-core` phải author **final Option-B multi-channel schema trực tiếp**; không land one-channel index rồi sửa lịch sử. DD-86 is `DECISION_FINAL`, but root remains **HOLD** until pre-root DM safety authority, exact `chat_definer` provisioning and their readiness packets land. Reviewed docs are not `PLAN_READY`, `CODE_READY` or runtime proof.

> ✅ **DD-91 mirror (2026-07-27):** registered requester-only slash như `/pay` chạy qua authenticated synchronous command endpoint với `Cache-Control: private, no-store`, không qua Assistant/bot writer và không ghi command/result vào `chat_messages`, result row/ref, SSE, outbox, push hoặc shared history. Human-DM peer quan sát zero message/event/unread. Normal message endpoint phải classifier-reject registered requester-only slash **trước** mọi INSERT/NOTIFY.

> ✅ **Owner-final Chat v1 floor (2026-07-28):** DD-92 chốt reply/mention, exact Unicode reactions, own-edit/soft-delete và search bắt buộc trước beta; DD-93 chốt registry ASCII case-insensitive gồm tám command theo surface; DD-94 chốt unread-derived generic push/digest không snapshot; DD-95 chốt club-only hide/restore + timed mute với receipt/audit. Các quyết định đã final nhưng chưa tạo runtime trên `main`.

---

## 1. Tổng quan triển khai

```text
Surface (web/app Plexco) → SendMessageCommand(client_msg_id, channel, actor)
    → AuthZ (active member; admins_only additionally exact capability)
        → Insert chat_messages (idempotent) → NOTIFY topic
        → SSE fan-out (web_realtime) → subscribers of that channel
```

Chat **chỉ sống trong Plexco** (web + app surface). **KHÔNG bridge** ra group Zalo/Messenger ở phase-1 (CO-7 BRD / DD-38) — không có projector kênh ngoài cho chat. Canonical store là nguồn sự thật; SSE chỉ là surface realtime (reuse DD-07 `LISTEN/NOTIFY`, giống sync engine `web_realtime`).

**Design decisions:**
- Ba loại kênh: **`club`** (chat toàn CLB — member trong 1 tenant, RLS tenant-private), **`dm`** (1-1 person ↔ person, person-self path), và **`group`** (nhóm nhiều người 3–50, global hoặc tenant-scoped, membership-gated RLS).
- **Group chat** hỗ trợ hai scope: **global** (`tenant_id=NULL`) cho bạn bè ngoài CLB và **tenant-scoped** (`tenant_id NOT NULL`) cho subset ad-hoc members trong CLB.
- **Follow-guard** cho add member vào group: chỉ add được nếu target đã follow actor (DD-47 `person_follows.status='accepted'`). Block boundary (DD-55) cũng chặn add.
- **Multi-pin:** tối đa 5 pinned messages/channel (áp dụng cho cả group, club, DM).
- **Poll/Vote:** Telegram-style — single/multi choice, anonymous, quiz mode, deadline, allow add options. Poll gắn 1:1 với message.
- **Group admin:** creator tự động admin đầu; admin đặt/bỏ admin, kick, rename, đổi avatar.
- Trợ lý AI (DD-19 pha B, P7) **tái dùng** chính bộ bảng `chat_*` — phát ngôn với `author_type='assistant'` (DD-20), **không** tạo Person/ChannelIdentity mới. Chat cơ bản (DD-38) dựng hạ tầng sớm ở P4; trợ lý plug vào sau.
- Idempotent theo `client_msg_id` (chống double khi retry/mạng chờn).
- Anti-spam: rate-limit per (person, channel) + cap kích thước message.
- **Structured embed:** message có thể kèm `embed_type='session'` + `embed_ref_id`. Server resolve session, validate actor visibility, snapshot BL-DSC-1 whitelist fields vào `embed_snapshot` (JSONB). Client KHÔNG cung cấp snapshot. Extensible to `activity`, `tournament`, `club` sau.

### Entry points

| Entry | Caller | Mô tả |
|-------|--------|-------|
| `POST /api/chat/channels/:id/messages` | Player (web) | Send message (idempotent `client_msg_id`) |
| `POST /api/chat/dm` | Player (web) | Create/reuse DM channel (`create_dm` SECURITY DEFINER) |
| `POST /api/chat/channels/:id/messages/:id/react` | Player | Add/remove Unicode reaction |
| `PATCH /api/chat/channels/:id/messages/:id` | Author | Own body edit (<15m, max 5) |
| `DELETE /api/chat/channels/:id/messages/:id` | Author | Irreversible author tombstone |
| `POST /api/chat/channels/:id/mark-read` | Player | `mark_read()` SECURITY DEFINER |
| `POST /api/chat/channels/:id/messages/:id/forward` | Player | Forward to target channel |
| `GET /api/chat/channels/:id/search` | Player | PostgreSQL `simple` text search |
| `/pay` slash command | Player | Registry intercept → canonical `getSelfPaymentStatus` |
| `POST /api/chat/channels/:id/moderate` | Admin (`chat.message.moderate`) | Soft-hide/restore + timed mute |
| `POST /api/chat/media/upload` | Player | Private media upload with scan/moderation |
| SSE `chat:channel:<id>` topic | System | Realtime fan-out via `LISTEN/NOTIFY` |
| `POST /api/chat/groups` | Player | Create group chat (global or tenant-scoped) |
| `POST /api/chat/groups/:id/members` | Group member | Add member (follow-guard DD-47) |
| `DELETE /api/chat/groups/:id/members/:personId` | Group admin | Kick member |
| `PATCH /api/chat/groups/:id` | Group admin | Rename / change avatar |
| `PATCH /api/chat/groups/:id/members/:personId/role` | Group admin | Set/unset admin role |
| `POST /api/chat/groups/:id/leave` | Group member | Leave group (last-admin guard) |
| `POST /api/chat/channels/:id/pins` | Member | Pin message (max 5/channel) |
| `DELETE /api/chat/channels/:id/pins/:messageId` | Member | Unpin message |
| `POST /api/chat/channels/:id/polls` | Member | Create poll (Telegram-style) |
| `POST /api/chat/polls/:id/vote` | Member | Cast/change vote |
| `POST /api/chat/polls/:id/close` | Creator/Admin | Close poll early |
| `POST /api/chat/polls/:id/options` | Member (if allowed) | Add option to poll |
| `PUT /api/chat/channels/:id/nicknames/:personId` | Member | Set custom nickname (viewer-local) |
| `DELETE /api/chat/channels/:id/nicknames/:personId` | Member | Remove custom nickname |
- **DD-55 hard gate:** open DM remains disabled until block, report, per-sender/per-target throttles, and abuse audit all pass. Host/support/tenant-admin roles never gain DM read access.
- **DD-55 media:** private object storage + short-lived signed access + content-derived MIME/type/size/quota checks + malware scan + moderation + deletion/orphan lifecycle. A message can attach only an actor-owned object in `ready` state.
- **DD-92 conversation floor:** same-channel authorized reply; immutable structured mentions; one active Unicode reaction/person/message from exact `👍|❤️|😂|😮|😢|🙏`; own human body edit `<15m` and at most five revisions; author soft-delete anytime to an irreversible shared tombstone; current-visible authorized search is a required pre-beta slice.
- **DD-93 slash registry:** ASCII case-insensitive exact whole-input command, zero arguments and no aliases. `/help|/pay|/me|/myclubs|/discover|/name` work on every eligible Chat surface; `/sessions|/waitlist` additionally work in club channel/private Club Bot only. Every unsupported/unknown/arg command is requester-only and rejected before insertion; `/help` is derived from the post-authz registry.
- **DD-94 unread/notification boundary:** Chat read cursors are the only unread source. Push/digest is generic and opaque, coalesces by person+channel+highest unread cursor, and never stores message body/title/amount snapshot. Timing config is enablement-only and absent/untested means OFF; DD-88 remains a broader deferred proposal.
- **DD-95 moderation floor:** club-only human-message hide/restore and exact `1h|24h|7d` channel mute through exact capabilities and actor-scoped receipts. Reason code/note and actor are immutable append-only audit. No DM moderation/read, assistant/system target, moderator content edit, hard delete, permanent ban or system-message side effect.

### DD-55 design-probe gates before root chat schema

The existing `chat_*` DDL below covers text/DM invariants, but its dependency order is strict. Actual DB worktrees serialize `chat-definer-role-provisioning → chat-dm-safety-authority-core → dd38-dd86-chat-schema-core → tenant-capability-authority-core`: the four slices share the migration tail, schema mirror, DB catalog tests and schema/authz invariants. Capability core owns the canonical DD-56 registry/preset, expiring/revocable grant-read authority, **append-only grant audit** and fail-closed `authorize`; Chat never creates a local registry. After `chat-club-channel-lifecycle-core`, stable catalog slice 9 `chat-authorized-member-target-read-core` must land its opaque current-channel DTO + consume-time resolver **before** slice 6 moderation, slice 7 shared send and slice 8 DM lifecycle. DD-95 moderation then lands mute storage/writers/audit **dark**, shared core owns the single send/history/mark-read path, and DM lifecycle alone owns create/reuse/block/report. Catalog IDs are not execution order. Bounded mechanism slices `1–47` own no HTTP route; every route belongs to one `A1–A21` thin adapter. Do not place a policy/function reference to storage that is created later, or bolt media/abuse checks onto scattered endpoints.

```text
DM request: blocked? -> deny | safety gates unavailable? -> deny | limits pass -> create/reuse DM
Media: initiated -> uploaded -> pending_scan -> ready | rejected | quarantined -> deleted/tombstone
Report: submitted -> triaged -> actioned | closed  (audit append-only; no tenant-host DM read grant)
```

One canonical DM safety decision owns enablement, pair block state, per-sender/per-target limits and abuse audit, and is called at request/create/**SECURITY DEFINER bootstrap**/send/read boundaries. The pre-send core additionally checks membership and attachment readiness/ownership before writing. No endpoint or RPC may implement or bypass its own block formula.

### DD-91 requester-only slash overlay

- A registered requester-only slash is control input, not chat content. `/api/chat/channels/:id/messages` runs the exact command-registry classifier before `send_chat_message`; a match returns `CHAT_COMMAND_ROUTE_REQUIRED` with zero insert/rate-consume/NOTIFY/unread mutation.
- `POST /api/chat/commands/execute` resolves actor from the verified session and authorizes the referenced surface. It never invokes the Assistant/bot writer. The direct response is a typed ephemeral UI outcome with `Cache-Control: private, no-store`; no result identifier or replay/read endpoint exists.
- Human DM rows have `tenant_id=NULL`. `/pay` therefore asks the canonical person-self service for requester-owned eligible clubs: one → select server-side; many → return requester-only choices carrying short-lived opaque selectors; none → generic `no_eligible_club`. A selector binds actor + DM channel + eligible tenant + command (+ expiry); the API does not accept a raw tenant ID as authority.
- Result data comes from the canonical Player View/self-payment adapter at request time. The chat module does not derive money, copy debt formulae or persist the returned status. Peer-visible history, SSE, unread and notifications remain byte-for-byte unchanged.

### DD-86 final multi-channel contract

- Giữ `kind IN ('club','dm','group')`; bỏ one-channel-per-tenant index. Club thêm `title`, `sort_order`, `post_policy`, `is_default`, `assistant_enabled`, `created_by_membership_id`, `created_by_person_id`; DM CHECK bắt `tenant_id` và mọi club-only/creator field là `NULL`. Group thêm `group_avatar_url`, `max_members` (default 50), `created_by_person_id` NOT NULL; `dm_key` NULL, `tenant_id` NULL (global) hoặc NOT NULL (tenant-scoped).
- Creator dùng composite FK `(created_by_membership_id, created_by_person_id, tenant_id) → memberships(id, person_id, tenant_id)`; không dùng một membership id cho FK ba cột. Cặp `NULL/NULL` chỉ hợp lệ trong exact system-bootstrap command, không phải client/admin escape hatch.
- Partial unique `(tenant_id) WHERE kind='club' AND is_default AND archived_at IS NULL` chỉ chặn **at-most-one**. Create/set-default/archive chạy dưới tenant parent lock và deferred assertion để bảo đảm **exactly-one active default**; archive default bắt buộc replacement cùng transaction.
- Tạo club channel và activation membership đều upsert đủ membership × active-channel trong cùng transaction, retry-safe; lỗi giữa chừng rollback. `UNIQUE(channel_id, membership_id)`/equivalent là replay fence.
- Channel lifecycle create/rename/set-default/archive dùng duy nhất `chat.channel.manage`; shared-message core dùng `chat.channel.post_restricted` chỉ khi `post_policy='admins_only'`. `all_members` vẫn bắt active channel membership. Không dựa vào `chat_members.role`; registry unavailable/unknown → deny.
- Mỗi create/rename/set-default/archive nhận actor-scoped UUID idempotency key + request fingerprint; exact replay trả receipt cũ, cùng key khác payload → `CHAT_IDEMPOTENCY_MISMATCH`.
- Chat moderation owns `chat.message.moderate`/`chat.member.mute`; DD-86 lifecycle không tự cấp hoặc suy hai capability này.
- `create_club_channel` derives `assistant_enabled=true` for `post_policy='all_members'` and `false` for `post_policy='admins_only'`. Exact `chat.channel.manage` may mutate the setting on either kind; accepting `true` and every ingress/projector consume additionally require tenant config, exact `assistant_ai_kb` entitlement, provider and privacy gates. Any false/unknown yields zero bot effect. “Announcements” has no hidden special case beyond being an `admins_only` channel with default `false`.

### DD-92 conversation interaction/search contract

- `send_chat_message` nhận optional reply ref + immutable mention targets. Reply ref phải ở cùng channel, requester đang authorized và target chưa moderation-hide/author-delete tại send time; ngược lại reject toàn transaction. Nếu target bị tombstone sau đó, reply renderer chỉ trả tombstone metadata, không body/attachment cũ.
- Mention input là typed target, không parse authority từ body. Core resolve target trong current channel, persist immutable target ref + sanitized render snapshot atomically với message; không có update path.
- `target_assistant_key='club_assistant'` chỉ là immutable addressed target trong club channel, không phải provider authorization. Projector phải re-check sender membership, current message/channel visibility, DD-86 channel setting và toàn bộ DD-20/DD-21 tenant/entitlement/provider/privacy gates; false/unknown yields zero `bot_query`/provider/message.
- Reaction endpoint expresses desired state: one of exact Unicode `👍|❤️|😂|😮|😢|🙏` or remove. Under message lock it upserts exactly one row per `(message,person)`, atomically replaces another value, and treats same-value/remove-absent retry as success.
- Edit chỉ cho chính tác giả của human message, khi `statement_timestamp() < created_at + interval '15 minutes'` và `edit_count < 5`. Chỉ `body` được đổi; author/channel/reply/attachments/mentions bất biến. Mỗi accepted edit khóa message, append old body vào restricted `chat_message_revisions`, rồi update body/search vector atomically. Assistant/system message không có edit path.
- Author có thể soft-delete own human message bất kỳ lúc nào. Lệnh này một chiều/idempotent, giữ row/refs/audit nhưng mọi shared renderer trả tombstone; author không restore. Moderator restore không được phục hồi author-deleted message.
- Search là slice riêng nhưng **bắt buộc trước beta**: optional current-readable channel filter; query only current visible body in channels requester can read at execution; generated PostgreSQL `to_tsvector('simple', body)` plus `plainto_tsquery('simple', q)` is the sole canonical index/query pair. Exclude moderator/author tombstones, revision bodies, requester-only slash inputs/results and private Club Bot results. Authz/RLS is live at query time, never from cached channel IDs.

### DD-93 slash grammar and surface matrix

The classifier runs before every normal send and treats any leading slash as command control input. It applies ASCII case-folding only, accepts one exact whole-input canonical command with zero arguments and no aliases; non-ASCII lookalikes do not normalize into commands.

| Canonical command | Club channel | Private Club Bot | Human DM overlay |
|---|:---:|:---:|:---:|
| `/help`, `/pay`, `/me`, `/myclubs`, `/discover`, `/name` | ✅ | ✅ | ✅ |
| `/sessions`, `/waitlist` | ✅ | ✅ | ❌ private `CHAT_COMMAND_UNSUPPORTED_SURFACE` |

ASCII case variants route to the same canonical command. Alias, unknown command, any argument/tail token or unsupported human-DM surface returns a requester-only error/help response and creates zero message/rate/NOTIFY/unread mutation. `/help` enumerates only commands authorized for that requester+surface from this same registry after authz; there is no second handwritten command list.

### DD-94 unread and Notification boundary

Chat history ordering/keyset is the immutable pair `(created_at,id)` and Chat keeps the canonical per-person/channel read cursor. Reconnect, history catch-up, unread, badge and notification eligibility derive from this state; Notification never owns a parallel unread counter or durable message/body/title/amount snapshot.

- DM notifications default ON. Club channel preference is exact `all|mentions|off`, default `mentions`: `all` makes every unread message eligible, `mentions` only a direct structured mention or direct reply, and `off` none. Thus direct mention/reply is ON by default without creating a second preference source.
- Pending delivery/digest work coalesces by `(person_id,channel_id,highest_unread_cursor)`. Advancing read state cancels any pending work whose cursor is now obsolete.
- Payload is generic/opaque (“Bạn có tin nhắn mới”), contains only an opaque deep-link/ref and never chat content, club title, sender name, debt/amount or attachment metadata.
- Immediately before provider write, the worker re-checks current club membership or DM block+safety, effective preference, device validity and current session/trust epoch. Any false/unknown cancels; no send.
- Retry/ambiguous provider outcome is sticky under one attempt identity and must not duplicate delivery. Digest timing/config is enablement-only; missing or untested config keeps that route OFF. DD-88 remains a broader proposal and neither owns nor blocks this exact DD-94 slice.

### DD-95 club moderation contract

- Target must be a human-authored message in `kind='club'`. Hide/restore requires exact `chat.message.moderate`; timed mute requires exact `chat.member.mute`. Both re-check current tenant/channel target and active capability inside the mutation transaction; unknown/unavailable denies.
- Hide/restore affects only moderation visibility state and renders/removes the moderation tombstone; it never edits or hard-deletes body and cannot restore an author-deleted message. Timed mute accepts only exact `1h|24h|7d`; expiry is computed from DB time and send checks DB time. Mute blocks write, never read.
- Every action requires reason code from exact `spam|harassment|unsafe|off_topic|other`; `other` requires a bounded note while every non-`other` action rejects a note. It also requires actor-scoped UUID command id + canonical fingerprint over action/target/reason/duration. Exact replay returns fixed receipt; same key/different fingerprint rejects before mutation. Each newly accepted action writes exactly one append-only immutable actor/reason/note/duration audit event.
- Every DM, assistant/system target, hard-delete, moderator content-edit, permanent-ban or system-message side effect is structurally unsupported and returns generic deny without content disclosure.

### Current-channel safe member-target contract

- `chat-authorized-member-target-read-core` is the only target lookup/resolution owner. It lists **active human members in the already-authorized current club channel** as `{targetRef, safeLabel}`; the ref is opaque, short-lived and bound to requester + channel + intended target class.
- The DTO never exposes raw `person_id`/membership UUID, phone/email, gender, debt, `pay_code`, contact handles or a global people-search oracle. There is no free-text/fuzzy target lookup endpoint.
- Structured mention, timed mute and start-DM accept only the opaque current-channel ref and call the same consume-time resolver. Each consumer re-checks current tenant/channel membership, target activity and the action-specific block/capability/safety guard inside its transaction.
- A stale, wrong-actor, wrong-channel, cross-tenant or replayed ref fails generically before message, moderation, DM, audit or notification mutation. Safe display labels are presentation snapshots, never authority.

---

## 2. Database Schema + Edge Cases (BE) — target contract

### Schema (Reviewed target; trỏ schema.ts/migrations khi thực thi)

```sql
-- FK target phụ (BẮT BUỘC tạo TRƯỚC chat_members/chat_messages): PK(id) không đủ
-- làm target cho FK ba cột. Đây là DDL thực thi trong migration chat, không phải comment TODO.
ALTER TABLE memberships
  ADD CONSTRAINT memberships_id_person_tenant_uq UNIQUE (id, person_id, tenant_id);

CREATE TABLE chat_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),           -- NOT NULL cho 'club'; NULL cho 'dm'
  kind text NOT NULL CHECK (kind IN ('club','dm','group')),
  dm_key text,                                     -- 'least(a,b):greatest(a,b)' của 2 person cho 'dm'
  title text,
  is_default boolean,
  sort_order integer,
  created_by_membership_id uuid,
  created_by_person_id uuid,
  creation_origin text,
  post_policy text,
  assistant_enabled boolean,
  pinned_message_id uuid,                          -- 1 pinned post/channel; NULL = no pin; club only (legacy, xem chat_pinned_messages cho multi-pin)
  pinned_at timestamptz,                           -- khi nào pin; NULL nếu chưa pin
  archived_at timestamptz,                          -- soft-close DM (thay cho xoá member)
  group_avatar_url text,                           -- group only: avatar URL (nullable)
  max_members smallint DEFAULT 50,                  -- group only: giới hạn member (default 50)
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'club'
      AND tenant_id IS NOT NULL AND dm_key IS NULL
      AND title IS NOT NULL AND is_default IS NOT NULL AND sort_order IS NOT NULL
      AND creation_origin IN ('actor','system_bootstrap')
      AND post_policy IN ('all_members','admins_only')
      AND assistant_enabled IS NOT NULL
      AND group_avatar_url IS NULL)
    OR
    (kind = 'dm'
      AND tenant_id IS NULL AND dm_key IS NOT NULL
      AND title IS NULL AND is_default IS NULL AND sort_order IS NULL
      AND created_by_membership_id IS NULL AND created_by_person_id IS NULL
      AND creation_origin IS NULL
      AND post_policy IS NULL AND assistant_enabled IS NULL
      AND group_avatar_url IS NULL AND max_members IS NULL)
    OR
    (kind = 'group'
      AND dm_key IS NULL
      AND title IS NOT NULL
      AND is_default IS NULL AND sort_order IS NULL
      AND post_policy IS NULL AND assistant_enabled IS NULL
      AND created_by_person_id IS NOT NULL
      AND created_by_membership_id IS NULL
      AND creation_origin IS NULL
      AND max_members IS NOT NULL AND max_members BETWEEN 3 AND 200)
  ),
  CHECK ((created_by_membership_id IS NULL) = (created_by_person_id IS NULL)),
  CHECK (
    kind <> 'club'
    OR (creation_origin='actor' AND created_by_membership_id IS NOT NULL)
    OR (creation_origin='system_bootstrap' AND created_by_membership_id IS NULL)
  ),
  FOREIGN KEY (created_by_membership_id, created_by_person_id, tenant_id)
    REFERENCES memberships(id, person_id, tenant_id),
  UNIQUE (dm_key),                                 -- idempotent tạo DM (1 kênh/cặp)
  UNIQUE (id, tenant_id)                           -- FK target cho child (bind message/member ↔ tenant channel)
);
CREATE UNIQUE INDEX chat_channels_default_uq
  ON chat_channels(tenant_id)
  WHERE kind='club' AND is_default IS TRUE AND archived_at IS NULL;

CREATE TABLE chat_members (
  channel_id uuid NOT NULL REFERENCES chat_channels(id),
  tenant_id  uuid,                                 -- = channel.tenant_id (NULL cho dm)
  person_id  uuid NOT NULL REFERENCES persons(id),
  membership_id uuid,                              -- club: NOT NULL; dm: NULL
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  last_read_created_at timestamptz,
  last_read_message_id uuid,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, person_id),
  -- (a) bind member.tenant_id = channel.tenant_id (club enforce; dm tenant_id NULL → FK MATCH SIMPLE bỏ qua)
  FOREIGN KEY (channel_id, tenant_id) REFERENCES chat_channels(id, tenant_id),
  -- (b) club member phải là membership của ĐÚNG (person, tenant); dm (membership_id NULL) → không ràng
  FOREIGN KEY (membership_id, person_id, tenant_id) REFERENCES memberships(id, person_id, tenant_id),
  -- (c) shape: club ⇒ (tenant_id, membership_id) NOT NULL; dm ⇒ cả hai NULL
  CHECK ((tenant_id IS NOT NULL AND membership_id IS NOT NULL)
      OR (tenant_id IS NULL     AND membership_id IS NULL)),
  CHECK ((last_read_created_at IS NULL) = (last_read_message_id IS NULL))
);

CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES chat_channels(id),
  tenant_id  uuid,                                 -- = channel.tenant_id (NULL cho dm)
  author_type text NOT NULL DEFAULT 'person' CHECK (author_type IN ('person','assistant','system')),
  author_person_id uuid REFERENCES persons(id),
  membership_id uuid,                              -- club person: NOT NULL & khớp author; assistant/system: NULL
  body text NOT NULL,
  reply_to_message_id uuid,
  edited_at timestamptz,
  edit_count smallint NOT NULL DEFAULT 0 CHECK (edit_count BETWEEN 0 AND 5),
  author_deleted_at timestamptz,
  moderation_state text NOT NULL DEFAULT 'visible'
    CHECK (moderation_state IN ('visible','hidden')),
  moderation_updated_at timestamptz,
  moderation_actor_person_id uuid REFERENCES persons(id),
  moderation_reason_code text
    CHECK (
      moderation_reason_code IS NULL
      OR moderation_reason_code IN ('spam','harassment','unsafe','off_topic','other')
    ),
  -- Forward support: khi message là forwarded, lưu attribution gốc
  forward_from_message_id uuid,                    -- original message id (nullable — NULL = không phải forward)
  forward_from_channel_id uuid REFERENCES chat_channels(id), -- original channel
  forward_from_author_name text,                   -- snapshot tên người gửi gốc (không join realtime)
  forward_from_channel_name text,                  -- snapshot tên channel gốc
  forward_from_created_at timestamptz,              -- timestamp gốc
  client_msg_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  search_document tsvector GENERATED ALWAYS AS (
    to_tsvector('simple'::regconfig, coalesce(body, ''))
  ) STORED,
  -- Dedupe ĐỘC LẬP author (assistant/system author_person_id NULL vẫn dedupe):
  UNIQUE (channel_id, client_msg_id),
  UNIQUE (channel_id, id),
  UNIQUE (channel_id, created_at, id),
  -- (a) bind message.tenant_id = channel.tenant_id (club enforce; dm NULL → bỏ qua)
  FOREIGN KEY (channel_id, tenant_id) REFERENCES chat_channels(id, tenant_id),
  -- (b) author membership khớp ĐÚNG (author_person_id, tenant_id) khi là club person; assistant/system NULL → bỏ qua
  FOREIGN KEY (membership_id, author_person_id, tenant_id) REFERENCES memberships(id, person_id, tenant_id),
  FOREIGN KEY (channel_id, reply_to_message_id) REFERENCES chat_messages(channel_id, id),
  CHECK (reply_to_message_id IS NULL OR reply_to_message_id IS DISTINCT FROM id),
  CHECK (
    (moderation_state='visible' AND moderation_updated_at IS NULL
      AND moderation_actor_person_id IS NULL AND moderation_reason_code IS NULL)
    OR
    (moderation_state='hidden' AND moderation_updated_at IS NOT NULL
      AND moderation_actor_person_id IS NOT NULL AND moderation_reason_code IS NOT NULL)
  ),
  CHECK (author_type <> 'person' OR author_person_id IS NOT NULL),  -- person ⇒ author_person_id NOT NULL
  CHECK (author_type =  'person' OR author_person_id IS NULL),      -- assistant/system ⇒ author_person_id NULL
  CHECK (author_type = 'person' OR membership_id IS NULL),          -- assistant/system: membership NULL (DD-20)
  CHECK (author_type <> 'person' OR tenant_id IS NULL OR membership_id IS NOT NULL), -- club person phải có membership
  -- ⬜ Structured embed HOÃN, ràng buộc NHỊ PHÂN — DD-106 Q2 (owner-delegated 2026-08-14).
  --    KHÔNG thêm ba cột dưới đây cho tới khi `public_projection_fences` + guarded view +
  --    narrow raise/CAS-clear ĐÃ MERGE.
  --    Lý do: `embed_snapshot` là projection THỨ HAI của session state, trong khi projection thứ
  --    nhất còn chưa có đường invalidate — DD-73..78 ghi rõ kèo chuyển private/cancel hiện phải chờ
  --    projector async mới hết lộ, và fence là nợ DD-12 chưa land. Thêm cái thứ hai khi cái thứ nhất
  --    chưa invalidate được là NHÂN ĐÔI một lỗi đã biết, không phải thêm tính năng.
  --    Khi fence land, Q2 mở lại và phải trả lời: snapshot đóng băng hay refresh, và embed ĐÃ GỬI xử
  --    lý thế nào khi session chuyển private/cancel. Xem ../../standards/decisions.md → DD-106 Q2.
  -- Structured embed (optional): session card, extensible to activity/tournament/club later
  embed_type text CHECK (embed_type IS NULL OR embed_type IN ('session')),
  embed_ref_id uuid,                                      -- source entity id (session_id for 'session')
  embed_snapshot jsonb,                                    -- server-rendered BL-DSC-1 whitelist snapshot at send time
  CHECK (
    (embed_type IS NULL AND embed_ref_id IS NULL AND embed_snapshot IS NULL)
    OR
    (embed_type IS NOT NULL AND embed_ref_id IS NOT NULL AND embed_snapshot IS NOT NULL)
  ),
  -- At least one of body or embed must be present
  CHECK (length(body) > 0 OR embed_type IS NOT NULL)
);
CREATE INDEX idx_chat_messages_channel_time ON chat_messages(channel_id, created_at, id);
CREATE INDEX idx_chat_messages_search_simple
  ON chat_messages USING gin(search_document)
  WHERE moderation_state='visible' AND author_deleted_at IS NULL;
ALTER TABLE chat_members
  ADD FOREIGN KEY (channel_id, last_read_created_at, last_read_message_id)
  REFERENCES chat_messages(channel_id, created_at, id);

CREATE TABLE chat_message_mentions (
  channel_id uuid NOT NULL,
  message_id uuid NOT NULL,
  mention_ordinal integer NOT NULL CHECK (mention_ordinal >= 0),
  target_kind text NOT NULL CHECK (target_kind IN ('person','assistant')),
  target_person_id uuid REFERENCES persons(id),
  target_assistant_key text,
  render_label_snapshot text NOT NULL,
  PRIMARY KEY (message_id, mention_ordinal),
  FOREIGN KEY (channel_id, message_id) REFERENCES chat_messages(channel_id, id),
  CHECK (octet_length(render_label_snapshot) BETWEEN 1 AND 256),
  CHECK ((target_kind='person' AND target_person_id IS NOT NULL
          AND target_assistant_key IS NULL)
      OR (target_kind='assistant' AND target_person_id IS NULL
          AND target_assistant_key='club_assistant'))
);

CREATE TABLE chat_message_reactions (
  channel_id uuid NOT NULL,
  message_id uuid NOT NULL,
  person_id uuid NOT NULL REFERENCES persons(id),
  reaction text NOT NULL CHECK (reaction IN ('👍','❤️','😂','😮','😢','🙏')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, person_id),
  FOREIGN KEY (channel_id, message_id) REFERENCES chat_messages(channel_id, id)
);

CREATE TABLE chat_message_revisions (
  message_id uuid NOT NULL REFERENCES chat_messages(id),
  revision_no smallint NOT NULL CHECK (revision_no BETWEEN 1 AND 5),
  previous_body text NOT NULL,
  edited_by_person_id uuid NOT NULL REFERENCES persons(id),
  edited_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (message_id, revision_no)
);

-- DD-94 SLICE ONLY: neither root schema nor shared-message slice creates/uses these tables.
CREATE TABLE chat_notification_preferences (
  channel_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  person_id uuid NOT NULL REFERENCES persons(id),
  club_mode text NOT NULL DEFAULT 'mentions' CHECK (club_mode IN ('all','mentions','off')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, person_id),
  FOREIGN KEY (channel_id, tenant_id) REFERENCES chat_channels(id, tenant_id)
);

-- Opaque delivery coordination only: no message body/title/sender/amount/object snapshot.
CREATE TABLE chat_notification_dispatches (
  person_id uuid NOT NULL REFERENCES persons(id),
  channel_id uuid NOT NULL REFERENCES chat_channels(id),
  highest_unread_created_at timestamptz NOT NULL,
  highest_unread_message_id uuid NOT NULL,
  delivery_kind text NOT NULL CHECK (delivery_kind IN ('push','digest')),
  state text NOT NULL CHECK (state IN ('pending','in_flight','delivered','unknown','cancelled')),
  attempt_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (
    person_id, channel_id, highest_unread_created_at, highest_unread_message_id
  ),
  FOREIGN KEY (channel_id, highest_unread_created_at, highest_unread_message_id)
    REFERENCES chat_messages(channel_id, created_at, id),
  CHECK (
    (state='pending' AND attempt_id IS NULL)
    OR (state IN ('in_flight','delivered','unknown') AND attempt_id IS NOT NULL)
    OR state='cancelled'
  )
);

-- Owned by post-root `chat-club-moderation-core`, which lands dark before
-- `chat-shared-message-command-core`; shown here only as part of the final-target view.
CREATE TABLE chat_channel_mutes (
  channel_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  target_person_id uuid NOT NULL REFERENCES persons(id),
  muted_by_person_id uuid NOT NULL REFERENCES persons(id),
  duration_code text NOT NULL CHECK (duration_code IN ('1h','24h','7d')),
  reason_code text NOT NULL
    CHECK (reason_code IN ('spam','harassment','unsafe','off_topic','other')),
  reason_note text,
  starts_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (channel_id, target_person_id),
  FOREIGN KEY (channel_id, tenant_id) REFERENCES chat_channels(id, tenant_id),
  CHECK (expires_at > starts_at),
  CHECK (
    expires_at = starts_at + CASE duration_code
      WHEN '1h' THEN interval '1 hour'
      WHEN '24h' THEN interval '24 hours'
      WHEN '7d' THEN interval '7 days'
    END
  ),
  CHECK (
    (reason_code='other' AND reason_note IS NOT NULL
      AND octet_length(reason_note) BETWEEN 1 AND 500)
    OR (reason_code<>'other' AND reason_note IS NULL)
  )
);

CREATE TABLE chat_moderation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  channel_id uuid NOT NULL,
  message_id uuid,
  target_person_id uuid REFERENCES persons(id),
  actor_person_id uuid NOT NULL REFERENCES persons(id),
  action text NOT NULL CHECK (action IN ('hide','restore','mute')),
  reason_code text NOT NULL
    CHECK (reason_code IN ('spam','harassment','unsafe','off_topic','other')),
  reason_note text,
  duration_code text CHECK (duration_code IN ('1h','24h','7d')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (channel_id, tenant_id) REFERENCES chat_channels(id, tenant_id),
  FOREIGN KEY (channel_id, message_id) REFERENCES chat_messages(channel_id, id),
  CHECK (
    (reason_code='other' AND reason_note IS NOT NULL
      AND octet_length(reason_note) BETWEEN 1 AND 500)
    OR (reason_code<>'other' AND reason_note IS NULL)
  ),
  CHECK ((action IN ('hide','restore') AND message_id IS NOT NULL
          AND target_person_id IS NULL AND duration_code IS NULL AND expires_at IS NULL)
      OR (action = 'mute' AND message_id IS NULL AND target_person_id IS NOT NULL
          AND duration_code IS NOT NULL AND expires_at IS NOT NULL))
);

CREATE TABLE chat_command_receipts (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_person_id uuid NOT NULL REFERENCES persons(id),
  command_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN (
    'channel.create','channel.rename','channel.set_default','channel.archive',
    'message.hide','message.restore','member.mute'
  )),
  canonical_fingerprint text NOT NULL,
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, actor_person_id, command_id)
);

-- ====== GROUP CHAT + PIN + POLL + NICKNAME (v0.26) ======

-- Multi-pin: tối đa 5 pinned messages per channel (áp dụng cho cả group, club, DM).
-- Thay thế legacy `chat_channels.pinned_message_id` (single pin, club only) bằng mô hình mở rộng hơn.
CREATE TABLE chat_pinned_messages (
  channel_id uuid NOT NULL REFERENCES chat_channels(id),
  message_id uuid NOT NULL,
  pinned_by_person_id uuid NOT NULL REFERENCES persons(id),
  pinned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, message_id),
  FOREIGN KEY (channel_id, message_id) REFERENCES chat_messages(channel_id, id)
);
CREATE INDEX idx_chat_pinned_channel ON chat_pinned_messages(channel_id, pinned_at DESC);

-- Trigger: max 5 pinned per channel (serialize dưới channel lock)
CREATE FUNCTION chat_pin_limit_guard() RETURNS trigger AS $$
DECLARE c int; BEGIN
  -- Lock channel row: serialize concurrent pin attempts
  PERFORM id FROM chat_channels WHERE id = NEW.channel_id FOR UPDATE;
  SELECT count(*) INTO c FROM chat_pinned_messages WHERE channel_id = NEW.channel_id;
  IF c >= 5 THEN RAISE EXCEPTION 'PIN_LIMIT_REACHED: channel % already has 5 pinned messages', NEW.channel_id; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_chat_pin_limit BEFORE INSERT ON chat_pinned_messages
  FOR EACH ROW EXECUTE FUNCTION chat_pin_limit_guard();

-- Poll: bình chọn Telegram-style, 1:1 với message
CREATE TABLE chat_polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES chat_channels(id),
  message_id uuid NOT NULL,
  creator_person_id uuid NOT NULL REFERENCES persons(id),
  question text NOT NULL CHECK (octet_length(question) BETWEEN 1 AND 1000),
  is_multiple_choice boolean NOT NULL DEFAULT false,
  is_anonymous boolean NOT NULL DEFAULT false,
  is_quiz boolean NOT NULL DEFAULT false,
  correct_option_id uuid,                            -- for quiz mode; set after option creation
  allow_add_options boolean NOT NULL DEFAULT false,
  deadline_at timestamptz,                           -- NULL = no deadline
  closed_at timestamptz,                             -- NULL = open; set khi creator/admin đóng hoặc hết deadline
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (channel_id, message_id) REFERENCES chat_messages(channel_id, id),
  UNIQUE (channel_id, message_id),
  CHECK (is_quiz = false OR correct_option_id IS NOT NULL OR closed_at IS NULL),
  -- quiz + closed => correct_option_id phải set; quiz + open => có thể chưa set (set khi tạo option)
  CHECK (deadline_at IS NULL OR deadline_at > created_at)
);

CREATE TABLE chat_poll_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES chat_polls(id) ON DELETE CASCADE,
  option_text text NOT NULL CHECK (octet_length(option_text) BETWEEN 1 AND 500),
  added_by_person_id uuid NOT NULL REFERENCES persons(id),
  sort_order smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poll_id, sort_order)
);
-- Trigger: max 10 options per poll
CREATE FUNCTION chat_poll_option_limit() RETURNS trigger AS $$
DECLARE c int; BEGIN
  SELECT count(*) INTO c FROM chat_poll_options WHERE poll_id = NEW.poll_id;
  IF c >= 10 THEN RAISE EXCEPTION 'POLL_OPTION_LIMIT: poll % already has 10 options', NEW.poll_id; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_chat_poll_option_limit BEFORE INSERT ON chat_poll_options
  FOR EACH ROW EXECUTE FUNCTION chat_poll_option_limit();

CREATE TABLE chat_poll_votes (
  poll_id uuid NOT NULL REFERENCES chat_polls(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES chat_poll_options(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES persons(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, option_id, person_id)
);
-- Trigger: single-choice enforce max 1 vote per person per poll
CREATE FUNCTION chat_poll_single_choice_guard() RETURNS trigger AS $$
DECLARE is_multi boolean; c int; BEGIN
  SELECT is_multiple_choice INTO is_multi FROM chat_polls WHERE id = NEW.poll_id;
  IF NOT is_multi THEN
    SELECT count(*) INTO c FROM chat_poll_votes WHERE poll_id = NEW.poll_id AND person_id = NEW.person_id;
    IF c >= 1 THEN RAISE EXCEPTION 'POLL_SINGLE_CHOICE: person % already voted in single-choice poll %', NEW.person_id, NEW.poll_id; END IF;
  END IF;
  -- Check poll open
  IF EXISTS (SELECT 1 FROM chat_polls WHERE id = NEW.poll_id AND (
    closed_at IS NOT NULL OR (deadline_at IS NOT NULL AND statement_timestamp() > deadline_at)
  )) THEN
    RAISE EXCEPTION 'POLL_CLOSED: poll % is closed', NEW.poll_id;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_chat_poll_single_choice BEFORE INSERT ON chat_poll_votes
  FOR EACH ROW EXECUTE FUNCTION chat_poll_single_choice_guard();

-- Custom nickname (viewer-local, chỉ mình thấy)
CREATE TABLE chat_member_nicknames (
  channel_id uuid NOT NULL REFERENCES chat_channels(id),
  viewer_person_id uuid NOT NULL REFERENCES persons(id),
  target_person_id uuid NOT NULL REFERENCES persons(id),
  nickname text NOT NULL CHECK (octet_length(nickname) BETWEEN 1 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, viewer_person_id, target_person_id)
);

-- Group member max guard (serialize dưới channel lock)
CREATE FUNCTION chat_group_member_limit_guard() RETURNS trigger AS $$
DECLARE k text; mx smallint; c int; BEGIN
  SELECT kind, max_members INTO k, mx FROM chat_channels WHERE id = NEW.channel_id FOR UPDATE;
  IF k = 'group' THEN
    SELECT count(*) INTO c FROM chat_members WHERE channel_id = NEW.channel_id;
    IF c >= mx THEN RAISE EXCEPTION 'GROUP_MAX_MEMBERS: group % already has % members (max %)', NEW.channel_id, c, mx; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_chat_group_member_limit BEFORE INSERT ON chat_members
  FOR EACH ROW EXECUTE FUNCTION chat_group_member_limit_guard();
```

`chat_channels_default_uq` proves only at-most-one. Tenant-locked create/set-default/archive commands plus a deferred exact-one assertion prove exactly one active default. `create_club_channel` derives `assistant_enabled=true` for `all_members` and `false` for `admins_only`; client input never supplies the creation value. A later setting mutation on either policy requires `chat.channel.manage`; accepting `true` and every Assistant consume re-check every tenant-config/entitlement/provider/privacy gate. “Announcements” is not a special case beyond its `admins_only` default. Mention/reaction/revision/search/read-preference/delivery/moderation/mute/receipt tables receive explicit RLS/grant policy in their owning slices; no runtime role gets direct mutation DML.

Moderation actor/reason evidence and message revisions are restricted immutable audit data: normal history/SSE/search cannot select them. Mention rows are append-only after parent-message creation. Only the author-edit command may update current `body`, within the DD-92 window/count while atomically appending the prior body; author, channel, reply, attachments and mention targets have no update path. Author-delete is one-way and all shared reads/search return a tombstone. Moderator hide/restore moves only moderation visibility and cannot restore author deletion. Search uses only the generated PostgreSQL `simple` vector on current visible bodies. Notification-dispatch rows are unread-cursor coordination only and contain no message/content snapshot; there is no hard-delete function or per-message durable notification item.

> **Bind cứng:** composite FK ở trên là **defense-in-depth**, NHƯNG **không đủ một mình** — FK mặc định `MATCH SIMPLE` **bỏ qua** khi bất kỳ cột nào NULL, nên một club-child cố tình đặt `tenant_id=NULL` sẽ **lọt FK + rơi vào shape "DM"**. Vì vậy `tenant_id` của child được **bind cứng bằng trigger** (dưới): trigger **set** `NEW.tenant_id := channel.tenant_id` và assert `IS NOT DISTINCT FROM` → club-child KHÔNG thể NULL tenant, DM-child luôn NULL. FK memberships `(membership_id, person_id, tenant_id)` khoá author/member là membership của đúng person+tenant (club).

**DM "đúng 2 người" (hard guard — CHECK không đếm được row nên dùng trigger):**

```sql
-- (0) BIND tenant_id của child = channel.tenant_id (đóng lỗ FK MATCH-SIMPLE-NULL). Áp cho chat_members + chat_messages.
CREATE FUNCTION chat_bind_tenant() RETURNS trigger AS $$
DECLARE ct uuid; BEGIN
  SELECT tenant_id INTO ct FROM chat_channels WHERE id = NEW.channel_id;
  -- assert + set: club → ct NOT NULL; dm → ct NULL. IS NOT DISTINCT FROM để so cả NULL.
  IF NEW.tenant_id IS NOT NULL AND NEW.tenant_id IS DISTINCT FROM ct THEN
    RAISE EXCEPTION 'child tenant_id % != channel tenant %', NEW.tenant_id, ct;
  END IF;
  NEW.tenant_id := ct;                       -- authoritative: không cho NULL "giả DM" trên club channel
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_chat_members_bind  BEFORE INSERT OR UPDATE ON chat_members  FOR EACH ROW EXECUTE FUNCTION chat_bind_tenant();
CREATE TRIGGER trg_chat_messages_bind BEFORE INSERT OR UPDATE ON chat_messages FOR EACH ROW EXECUTE FUNCTION chat_bind_tenant();

-- (1) IMMEDIATE guard + ROW LOCK: chặn người lạ + chặn người thứ 3, serialize theo channel (chống race).
CREATE FUNCTION chat_dm_member_insert_guard() RETURNS trigger AS $$
DECLARE k text; c int; BEGIN
  -- LOCK channel row: hai txn cùng thêm member vào 1 DM sẽ tuần tự hoá (không cùng thấy count=1).
  SELECT dm_key INTO k FROM chat_channels WHERE id = NEW.channel_id AND kind = 'dm' FOR UPDATE;
  IF FOUND THEN
    IF NEW.person_id::text NOT IN (split_part(k,':',1), split_part(k,':',2)) THEN
      RAISE EXCEPTION 'DM member % not in dm_key %', NEW.person_id, k;            -- người lạ
    END IF;
    SELECT count(*) INTO c FROM chat_members WHERE channel_id = NEW.channel_id;
    IF c >= 2 THEN RAISE EXCEPTION 'DM channel already has 2 members'; END IF;      -- chặn người thứ 3
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_chat_dm_member_insert BEFORE INSERT ON chat_members
  FOR EACH ROW EXECUTE FUNCTION chat_dm_member_insert_guard();

-- (2) DEFERRABLE constraint trigger: trạng thái CUỐI TXN của DM = ĐÚNG 2 member khớp dm_key.
--     ⚠️ KHÔNG dùng 1 function chung tham chiếu cả NEW.channel_id LẪN NEW.id: mỗi trigger fire trên 1 bảng
--        và PL/pgSQL sẽ lỗi khi đọc cột không tồn tại trên row đó (chat_channels không có channel_id, và
--        chat_members không có id). Tách: 1 helper nhận channel id tường minh + 2 trigger-fn mỏng theo bảng.
CREATE FUNCTION chat_assert_dm_two(p_channel uuid) RETURNS void AS $$
DECLARE c int; k text; BEGIN
  IF (SELECT kind FROM chat_channels WHERE id = p_channel) = 'dm' THEN
    SELECT count(*) INTO c FROM chat_members WHERE channel_id = p_channel;
    IF c <> 2 THEN RAISE EXCEPTION 'DM channel % must have exactly 2 members (got %)', p_channel, c; END IF;
    SELECT string_agg(person_id::text, ':' ORDER BY person_id) INTO k
      FROM chat_members WHERE channel_id = p_channel;
    IF k <> (SELECT dm_key FROM chat_channels WHERE id = p_channel) THEN
      RAISE EXCEPTION 'DM member set % != dm_key', k; END IF;
  END IF;
END; $$ LANGUAGE plpgsql;
-- fire trên chat_members → chỉ đọc channel_id
CREATE FUNCTION chat_dm_two_from_members() RETURNS trigger AS $$
BEGIN PERFORM chat_assert_dm_two(COALESCE(NEW.channel_id, OLD.channel_id)); RETURN NULL; END; $$ LANGUAGE plpgsql;
-- fire trên chat_channels → chỉ đọc id
CREATE FUNCTION chat_dm_two_from_channel() RETURNS trigger AS $$
BEGIN PERFORM chat_assert_dm_two(COALESCE(NEW.id, OLD.id)); RETURN NULL; END; $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_chat_dm_two_members AFTER INSERT OR UPDATE OR DELETE ON chat_members
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION chat_dm_two_from_members();
CREATE CONSTRAINT TRIGGER trg_chat_dm_two_channel  AFTER INSERT OR UPDATE ON chat_channels
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION chat_dm_two_from_channel();

-- (3) DELETE guard: DM member bất biến — rời/ẩn = set chat_channels.archived_at (soft-close), KHÔNG xoá lẻ.
CREATE FUNCTION chat_dm_no_member_delete() RETURNS trigger AS $$
BEGIN
  IF (SELECT kind FROM chat_channels WHERE id = OLD.channel_id) = 'dm' THEN
    RAISE EXCEPTION 'DM members immutable; soft-close channel via archived_at';
  END IF;
  RETURN OLD;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_chat_dm_no_delete BEFORE DELETE ON chat_members
  FOR EACH ROW EXECUTE FUNCTION chat_dm_no_member_delete();
```

#### Root-owned schema/read boundary

Core `chat_channels/chat_members/chat_messages` shape, DD-86 channel constraints, `dm_current_read_allowed`, RLS policies, read-helper ownership/grants và direct-DML revokes thuộc `dd38-dd86-chat-schema-core`. `tenant-capability-authority-core` then owns registry/grants/append-only grant audit/`authorize`; lifecycle lands next. `chat-authorized-member-target-read-core` lands its safe DTO + consume-time resolver after lifecycle and before every target consumer. Reply/mention additions belong shared-message core; reaction/revision/author-delete belong bounded DD-92 interaction slices; generated `simple` search vector/index is its own required pre-beta core; notification preference/opaque dispatch coordination belongs DD-94. DD-95 `chat-club-moderation-core` alone owns mute/moderation storage, writers, receipts and audit, and must land dark before shared send consumes current mute state. Root **không** tạo `create_dm`, `send_chat_message`, `mark_read`, edit/delete/search/reaction/moderation RPC, notification worker hoặc HTTP route. SQL blocks are a combined final-target view, not one migration.

**Cô lập — RLS policy khả thi đã pin (thêm `chat_*` vào RLS list qua migration monotonic mới, không sửa lịch sử):**

Vì một bảng chứa **cả** club-row (`tenant_id NOT NULL`) lẫn dm-row (`tenant_id NULL`), một policy **tenant-only** sẽ **khoá mất** dm-row (fail-closed → không ai đọc được DM). Giải: **2 policy permissive** (Postgres OR chúng lại) trên mỗi bảng `chat_*`, dùng cả `app.tenant_id` lẫn `app.person_id` GUC:

```sql
-- ⚠️ DEFINER ROLE PHẢI CÓ BYPASSRLS. `SECURITY DEFINER` chỉ đổi role thực thi sang OWNER — KHÔNG tự bypass RLS.
--    Vì các bảng dùng FORCE ROW LEVEL SECURITY (RLS áp cho CẢ owner), nếu owner là NOBYPASSRLS thì:
--      · helper `chat_current_is_member` SELECT `chat_members` vẫn dưới RLS → policy DM gọi helper → ĐỆ QUY;
--      · `create_dm` INSERT vẫn bị policy chặn (chicken-and-egg không giải được).
--    Runtime `app`/`readonly` đều NOBYPASSRLS (0000_roles_extensions.sql).
--
-- ‼️ PROVISION (PRE-MIGRATION, tier SUPERUSER — KHÔNG phải migration DDL-owner). `DATABASE_URL_MIGRATION` chỉ cam
--    kết là DDL-owner (không superuser); test harness dùng superuser nên "che" lỗi này → phải test bằng migration role thật.
--    Chạy bởi superuser/admin (managed-PG console/bootstrap), production-equivalent, IDEMPOTENT + KIỂM ATTRIBUTE:
--       -- DO-block chỉ kiểm "role tồn tại" là CHƯA đủ: nếu chat_definer đã tồn tại nhưng LOGIN / NOBYPASSRLS /
--       -- SUPERUSER / CREATEROLE thì bootstrap vẫn cấp table grants cho một role sai attribute (LOGIN+BYPASSRLS
--       -- đặc biệt nguy hiểm). Phải chuẩn hoá về exact attributes HOẶC fail-closed sau khi đọc pg_roles.
--       DO $$
--       DECLARE r record;
--       BEGIN
--         SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolreplication
--           INTO r FROM pg_roles WHERE rolname = 'chat_definer';
--         IF NOT FOUND THEN
--           CREATE ROLE chat_definer NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
--         ELSIF r.rolcanlogin OR r.rolsuper OR (NOT r.rolbypassrls) OR r.rolcreatedb OR r.rolcreaterole
--               OR r.rolinherit OR r.rolreplication THEN
--           -- FAIL-CLOSED (mặc định): role đã tồn tại với BẤT KỲ attribute thừa → dừng, điều tra (tránh cấp table cho role sai).
--           -- Kiểm ĐỦ bộ: login, super, bypassrls(phải TRUE), createdb, createrole, inherit(phải FALSE), replication(phải FALSE).
--           RAISE EXCEPTION 'chat_definer unexpected attrs (login=% super=% bypassrls=% createdb=% createrole=% inherit=% replication=%) — refuse bootstrap',
--             r.rolcanlogin, r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole, r.rolinherit, r.rolreplication;
--           -- Hoặc CHUẨN HOÁ (bootstrap có kiểm soát, cần superuser): ALTER ROLE chat_definer NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
--         END IF;
--       END $$;
--       -- PG16: gán BYPASSRLS cần **superuser HOẶC role đã có BYPASSRLS** (+ CREATEROLE) — CREATEROLE thường KHÔNG đủ.
--       GRANT chat_definer TO <migration_owner_role>;   -- để migration được SET ROLE + ALTER … OWNER TO chat_definer
--       GRANT USAGE ON SCHEMA public TO chat_definer;    -- runtime: function chạy như chat_definer, truy cập bảng public
--    Migration DDL-owner sau đó: tạo function + ALTER OWNER + GRANT table privileges.
--    ⚠️ PG16 `ALTER FUNCTION … OWNER TO chat_definer`: owner mới phải có **CREATE trên schema** chứa function.
--       Fresh PG15+/PG16 KHÔNG cấp `CREATE ON SCHEMA public` mặc định → phải grant tạm rồi revoke (least-privilege):
--         GRANT CREATE ON SCHEMA public TO chat_definer;      -- chỉ để nhận ownership
--         ALTER FUNCTION ... OWNER TO chat_definer;  -- toàn bộ membership/safety/mutation RPC bên dưới
--         REVOKE CREATE ON SCHEMA public FROM chat_definer;   -- runtime KHÔNG cần CREATE (giữ USAGE)
--    Nếu chat_definer chưa provision → migration FAIL sớm (fail-closed), không im lặng chạy dưới NOBYPASSRLS.

-- Helper: CHỈ dùng CURRENT person (không nhận person tùy ý → không membership oracle).
CREATE FUNCTION chat_current_is_member(p_channel uuid) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM chat_members cm
    JOIN chat_channels c ON c.id = cm.channel_id
    LEFT JOIN memberships m
      ON (m.id, m.person_id, m.tenant_id) = (cm.membership_id, cm.person_id, cm.tenant_id)
    WHERE cm.channel_id = p_channel
      AND cm.person_id = current_setting('app.person_id', true)::uuid
      AND (c.kind = 'dm' OR (c.kind = 'club' AND m.status = 'active'))
  );
$$;
-- (OWNER TO chat_definer làm ở BLOCK CHUYỂN OWNER cuối — sau khi có GRANT CREATE ON SCHEMA, xem dưới)
REVOKE ALL ON FUNCTION chat_current_is_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chat_current_is_member(uuid) TO app;   -- chỉ role runtime app

-- Predicate đọc THUẦN, không consume rate bucket/ghi audit: membership + safety-enabled + no block pair.
-- Safety authority/functions were created by pre-root chat-dm-safety-authority-core.
-- Root migration creates only this chat-specific adapter after those dependencies exist;
-- missing capability/error => FALSE.
CREATE FUNCTION dm_current_read_allowed(p_channel uuid) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT dm_safety_enabled()
     AND EXISTS (
       SELECT 1
       FROM chat_members me
       JOIN chat_members peer ON peer.channel_id = me.channel_id AND peer.person_id <> me.person_id
       WHERE me.channel_id = p_channel
         AND me.person_id = current_setting('app.person_id', true)::uuid
         AND NOT chat_pair_blocked(me.person_id, peer.person_id));
$$;
REVOKE ALL ON FUNCTION dm_current_read_allowed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dm_current_read_allowed(uuid) TO app;

-- ROOT OWNER/GRANT BLOCK: chỉ hai read helpers + quyền đọc tối thiểu.
-- Pre-root safety-authority core đã own/grant `dm_safety_enabled`, `chat_pair_blocked`
-- và `assert_dm_allowed`; root không CREATE OR REPLACE/re-own các function đó.
GRANT USAGE, CREATE ON SCHEMA public TO chat_definer;
ALTER FUNCTION chat_current_is_member(uuid) OWNER TO chat_definer;
ALTER FUNCTION dm_current_read_allowed(uuid) OWNER TO chat_definer;
REVOKE CREATE ON SCHEMA public FROM chat_definer;
GRANT SELECT (id, person_id, tenant_id, status) ON memberships TO chat_definer;
GRANT SELECT ON chat_channels, chat_members TO chat_definer;

-- chat_channels
ALTER TABLE chat_channels ENABLE ROW LEVEL SECURITY;  ALTER TABLE chat_channels FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_channels_club ON chat_channels USING (
  tenant_id IS NOT NULL AND tenant_id = current_setting('app.tenant_id', true)::uuid
  AND chat_current_is_member(id));
CREATE POLICY chat_channels_dm ON chat_channels USING (
  tenant_id IS NULL AND dm_current_read_allowed(id));

-- chat_members
ALTER TABLE chat_members ENABLE ROW LEVEL SECURITY;   ALTER TABLE chat_members FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_members_club ON chat_members USING (
  tenant_id IS NOT NULL AND tenant_id = current_setting('app.tenant_id', true)::uuid
  AND chat_current_is_member(channel_id));
CREATE POLICY chat_members_dm ON chat_members USING (
  tenant_id IS NULL AND dm_current_read_allowed(channel_id));

-- chat_messages: USING (đọc) + WITH CHECK (ghi) — author phải LÀ current person (chống mạo danh trong DM/club).
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;  ALTER TABLE chat_messages FORCE ROW LEVEL SECURITY;
-- ⚠️ WITH CHECK BẮT BUỘC author_type='person' + author = current person cho CẢ club LẪN dm:
--    nếu để "author_type <> 'person' OR ..." thì runtime user có thể ghi message author_type='assistant'/'system'
--    (mạo danh trợ lý). Message assistant/system CHỈ được ghi qua đường SECURITY DEFINER của bot (P7), KHÔNG qua
--    role app dưới RLS thường.
CREATE POLICY chat_messages_club ON chat_messages
  USING      (tenant_id IS NOT NULL AND tenant_id = current_setting('app.tenant_id', true)::uuid
              AND chat_current_is_member(channel_id))
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = current_setting('app.tenant_id', true)::uuid
              AND chat_current_is_member(channel_id)
              AND author_type = 'person' AND author_person_id = current_setting('app.person_id', true)::uuid);
CREATE POLICY chat_messages_dm ON chat_messages
  USING      (tenant_id IS NULL AND dm_current_read_allowed(channel_id))
  WITH CHECK (tenant_id IS NULL AND dm_current_read_allowed(channel_id)
              AND author_type = 'person' AND author_person_id = current_setting('app.person_id', true)::uuid);

-- ROOT pins the runtime DML boundary before any route is enabled.
REVOKE INSERT, UPDATE, DELETE ON chat_channels, chat_members, chat_messages FROM app;
GRANT SELECT ON chat_channels, chat_members, chat_messages TO app;
```

#### Post-root command boundaries

After channel lifecycle, `chat-authorized-member-target-read-core` lands first and owns the only opaque current-channel target DTO/resolver. `chat-club-moderation-core` then lands dark and owns mute/moderation storage, hide/restore/mute writers, receipts and immutable audit. `chat-shared-message-command-core` lands after both, owns only `send_chat_message`, `mark_read` and history/list core logic for club+DM; its mention path consumes the target resolver and its club branch only **reads** current mute state. `chat-dm-lifecycle-command-core` lands after shared + target core, owns only `create_dm`/reuse + block/report/request lifecycle and consumes the same resolver for start-DM. Each mechanism slice has zero HTTP ownership; `A1–A21` adapters expose it. No slice redefines another slice's storage/function and no command is hidden in the root migration.

**Mọi DM boundary phải enforce được ở DB/service choke-point.** `dm_current_read_allowed` là predicate thuần cho RLS GET/list/SSE filtering: membership + safety enabled + no block; unavailable/error state yields false or aborts the request, never grants access. Mutations đi qua SECURITY DEFINER RPC **OWNER = `chat_definer` (BYPASSRLS)**. `create_dm`, DM send và DM mark-read đều resolve peer rồi gọi canonical side-effecting `assert_dm_allowed(actor, peer, action)` trước read/reuse/write; primitive fail-closed nếu capability block/report/sender-target-limit/abuse-audit chưa enabled, consume đúng rate bucket và ghi bounded audit. Club send/read vẫn dùng tenant membership rules nhưng cũng qua shared send RPC. Runtime `app` không có direct INSERT vào `chat_messages`, nên không thể bypass block/rate/audit bằng DML.

```sql
-- Tạo DM nguyên tử: caller (current person) phải là 1 trong 2; tạo channel + ĐÚNG 2 member trong 1 txn.
CREATE FUNCTION create_dm(p_other uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE me uuid := current_setting('app.person_id', true)::uuid; a uuid; b uuid; k text; ch uuid; BEGIN
  IF me IS NULL OR p_other IS NULL OR me = p_other THEN RAISE EXCEPTION 'invalid DM participants'; END IF;
  PERFORM assert_dm_allowed(me, p_other, 'create'); -- fail-closed enablement+block+rate+audit; before create/reuse
  a := least(me, p_other); b := greatest(me, p_other); k := a || ':' || b;
  INSERT INTO chat_channels(kind, dm_key) VALUES ('dm', k)
    ON CONFLICT (dm_key) DO NOTHING RETURNING id INTO ch;              -- idempotent
  IF ch IS NULL THEN SELECT id INTO ch FROM chat_channels WHERE dm_key = k; RETURN ch; END IF;
  INSERT INTO chat_members(channel_id, person_id) VALUES (ch, a), (ch, b);  -- đúng 2, khớp dm_key
  RETURN ch;                                                          -- deferred exactly-2 verify ở COMMIT
END; $$;
-- (OWNER TO chat_definer làm ở BLOCK CHUYỂN OWNER cuối)
REVOKE ALL ON FUNCTION create_dm(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_dm(uuid) TO app;
-- Club lifecycle commands derive actor+tenant from trusted context and call the canonical DD-56
-- adapter with exact `chat.channel.manage`. Restricted post is checked only inside the shared
-- message core with `chat.channel.post_restricted`. Club moderation owns its two separate keys.
-- Unknown/registry failure denies; no role-label fallback.

-- DM-LIFECYCLE OWNER/GRANT BLOCK: create/reuse cần INSERT channel+member, không DELETE/UPDATE.
GRANT INSERT ON chat_channels, chat_members TO chat_definer;
GRANT USAGE, CREATE ON SCHEMA public TO chat_definer;
ALTER FUNCTION create_dm(uuid) OWNER TO chat_definer;
REVOKE CREATE ON SCHEMA public FROM chat_definer;

-- SHARED-MESSAGE grant block: send cần SELECT/INSERT message; mark-read chỉ UPDATE member cursor.
-- Channel/member SELECT đã do root cấp. BYPASSRLS không thay table grant; thiếu quyền phải fail.
GRANT SELECT, INSERT ON chat_messages TO chat_definer;
GRANT UPDATE ON chat_members TO chat_definer;
-- Không grant/đụng chat_notification_dispatches tại shared slice. DD-94 slice tự tạo table,
-- cancellation function + AFTER UPDATE cursor trigger và exact grants của chúng.
-- Migration DD-55 phải GRANT tường minh các quyền tối thiểu mà `assert_dm_allowed` dùng trên
-- canonical chat_blocks + rate/audit state; không dựa vào ownership ngầm hay PUBLIC.

-- Gửi message qua MỘT choke-point. Route + RPC reuse one ASCII-trim/leading-slash classifier primitive;
-- EVERY leading-slash control input rejects before mutation. Khoá idempotency key trước safety side effects để hai retry
-- đồng thời không double-consume rate bucket/audit. API không nhận author_type/author_person_id/membership_id.
CREATE FUNCTION send_chat_message(
  p_channel uuid,
  p_client_msg_id text,
  p_body text,
  p_reply_to_message_id uuid DEFAULT NULL,
  p_mentions jsonb DEFAULT '[]'::jsonb
)
RETURNS chat_messages
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  me uuid := current_setting('app.person_id', true)::uuid;
  ch chat_channels%ROWTYPE;
  peer uuid;
  member_id uuid;
  out_msg chat_messages%ROWTYPE;
BEGIN
  IF me IS NULL OR p_channel IS NULL OR p_client_msg_id IS NULL OR p_client_msg_id = '' THEN
    RAISE EXCEPTION 'invalid chat send';
  END IF;
  IF chat_starts_with_slash_after_ascii_trim(p_body) THEN
    RAISE EXCEPTION 'chat command route required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_channel::text || ':' || p_client_msg_id, 0));
  SELECT * INTO ch FROM chat_channels WHERE id = p_channel FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'chat forbidden'; END IF;

  SELECT * INTO out_msg FROM chat_messages
   WHERE channel_id = p_channel AND client_msg_id = p_client_msg_id;
  IF FOUND THEN
    IF out_msg.author_type <> 'person' OR out_msg.author_person_id IS DISTINCT FROM me THEN
      RAISE EXCEPTION 'duplicate message key';
    END IF;
    IF ch.kind = 'dm' AND NOT dm_current_read_allowed(p_channel) THEN
      RAISE EXCEPTION 'chat safety blocked';
    ELSIF ch.kind = 'club' AND NOT chat_current_is_member(p_channel) THEN
      RAISE EXCEPTION 'chat forbidden';
    END IF;
    RETURN out_msg;
  END IF;

  IF ch.kind = 'dm' THEN
    SELECT other_member.person_id INTO peer
      FROM chat_members self_member
      JOIN chat_members other_member
        ON other_member.channel_id = self_member.channel_id
       AND other_member.person_id <> self_member.person_id
     WHERE self_member.channel_id = p_channel AND self_member.person_id = me;
    IF peer IS NULL THEN RAISE EXCEPTION 'chat forbidden'; END IF;
    PERFORM assert_dm_allowed(me, peer, 'send');
  ELSE
    IF ch.tenant_id IS DISTINCT FROM current_setting('app.tenant_id', true)::uuid THEN
      RAISE EXCEPTION 'chat forbidden';
    END IF;
    SELECT cm.membership_id INTO member_id
      FROM chat_members cm JOIN memberships m ON m.id = cm.membership_id
     WHERE cm.channel_id = p_channel AND cm.person_id = me AND m.status = 'active';
    IF member_id IS NULL THEN RAISE EXCEPTION 'chat forbidden'; END IF;
    IF EXISTS (
      SELECT 1 FROM chat_channel_mutes mute
       WHERE mute.channel_id = p_channel AND mute.target_person_id = me
         AND statement_timestamp() < mute.expires_at
    ) THEN RAISE EXCEPTION 'chat muted'; END IF;
    IF ch.post_policy = 'admins_only' THEN
      -- Exact DD-56 adapter; re-checks current actor/tenant/action inside this transaction.
      PERFORM chat_require_capability('chat.channel.post_restricted', ch.tenant_id, me);
    ELSIF ch.post_policy <> 'all_members' THEN
      RAISE EXCEPTION 'chat forbidden'; -- unknown policy fails closed
    END IF;
  END IF;

  -- validate_chat_body/attachment ownership+ready-state runs in this command before INSERT.
  -- Reply must be same-channel + currently visible; already-tombstoned target rejects.
  IF p_reply_to_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chat_messages target
     WHERE target.id = p_reply_to_message_id
       AND target.channel_id = p_channel
       AND target.moderation_state = 'visible'
       AND target.author_deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'chat reply target unavailable'; END IF;
  INSERT INTO chat_messages(channel_id, tenant_id, author_type, author_person_id,
                            membership_id, body, reply_to_message_id, client_msg_id)
  VALUES (p_channel, ch.tenant_id, 'person', me, member_id, p_body,
          p_reply_to_message_id, p_client_msg_id)
  RETURNING * INTO out_msg;
  -- Helper validates a closed JSON shape, resolves current-channel targets and derives safe snapshots.
  -- Any invalid target raises and rolls this INSERT back; caller-supplied labels/refs are not authority.
  INSERT INTO chat_message_mentions(
    channel_id, message_id, mention_ordinal, target_kind,
    target_person_id, target_assistant_key, render_label_snapshot
  )
  SELECT p_channel, out_msg.id, mention_ordinal, target_kind,
         target_person_id, target_assistant_key, render_label_snapshot
    FROM resolve_chat_mentions(p_channel, me, p_mentions);
  -- Transactional NOTIFY is delivered only after COMMIT; payload is opaque message id, never body/object/PII.
  PERFORM pg_notify('chat_' || p_channel::text, out_msg.id::text);
  RETURN out_msg;
END; $$;
REVOKE ALL ON FUNCTION send_chat_message(uuid, text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION send_chat_message(uuid, text, text, uuid, jsonb) TO app;

-- Cập nhật canonical read cursor: KHÔNG dùng direct UPDATE — policy có thể cho member sửa cursor
-- của NGƯỜI KHÁC trong cùng DM/tenant. Dùng RPC khoá theo current person; DM phải re-check
-- canonical safety ngay tại consume boundary, club phải còn membership active. Cursor không lùi.
CREATE FUNCTION mark_read(p_channel uuid, p_through_message uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  me uuid := current_setting('app.person_id', true)::uuid;
  k text;
  peer uuid;
  through_created_at timestamptz;
  changed int;
BEGIN
  SELECT kind INTO k FROM chat_channels WHERE id = p_channel;
  IF me IS NULL OR k IS NULL THEN RAISE EXCEPTION 'chat forbidden'; END IF;
  IF k = 'dm' THEN
    SELECT other_member.person_id INTO peer
      FROM chat_members self_member
      JOIN chat_members other_member
        ON other_member.channel_id = self_member.channel_id
       AND other_member.person_id <> self_member.person_id
     WHERE self_member.channel_id = p_channel AND self_member.person_id = me;
    IF peer IS NULL THEN RAISE EXCEPTION 'chat forbidden'; END IF;
    PERFORM assert_dm_allowed(me, peer, 'read');
  ELSIF NOT chat_current_is_member(p_channel) THEN
    RAISE EXCEPTION 'chat forbidden';
  END IF;
  SELECT created_at INTO through_created_at
    FROM chat_messages
   WHERE channel_id = p_channel AND id = p_through_message;
  IF through_created_at IS NULL THEN RAISE EXCEPTION 'chat read cursor invalid'; END IF;
  UPDATE chat_members
     SET last_read_created_at = through_created_at,
         last_read_message_id = p_through_message
   WHERE channel_id = p_channel AND person_id = me
     AND (
       last_read_created_at IS NULL
       OR (last_read_created_at, last_read_message_id) < (through_created_at, p_through_message)
     );
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed NOT IN (0,1) THEN RAISE EXCEPTION 'chat forbidden'; END IF;
  -- Shared owner stops here: canonical cursor mutation only.
  -- When DD-94 lands, its own AFTER UPDATE OF last_read_* trigger observes this row and
  -- cancels covered pending dispatches. That trigger/function/table are all DD-94-owned,
  -- so mark_read has zero compile-time/runtime dependency on notification storage.
END; $$;
REVOKE ALL ON FUNCTION mark_read(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_read(uuid, uuid) TO app;

-- SHARED-MESSAGE OWNER BLOCK (câu lệnh THẬT, đúng thứ tự): GRANT CREATE trước ALTER → REVOKE sau ALTER cuối.
-- (Chạy bởi migration owner; owner phải sở hữu schema public để GRANT/REVOKE trên nó — nếu không, làm ở pre-provision superuser.)
GRANT USAGE, CREATE ON SCHEMA public TO chat_definer;   -- PG16: owner mới cần CREATE trên schema mới nhận được ownership
ALTER FUNCTION send_chat_message(uuid, text, text, uuid, jsonb) OWNER TO chat_definer;
ALTER FUNCTION mark_read(uuid, uuid)        OWNER TO chat_definer;
REVOKE CREATE ON SCHEMA public FROM chat_definer;       -- giữ USAGE (runtime); bỏ CREATE (least-privilege)
```

> **Đóng các đường fail-open (review):** (1) `chat_bind_tenant` set/assert `tenant_id` = channel → club-child không thể NULL "giả DM" (FK MATCH SIMPLE không đủ); (2) deferred check trên **cả** `chat_channels` → DM 0-member vẫn bị bắt ở COMMIT; (3) `FOR UPDATE` khoá channel row → hai insert đồng thời không cùng thấy count=1; (4) helper chỉ đọc **current person** + `REVOKE PUBLIC`/`GRANT app` → không phải membership oracle và club member `left` mất read/send; (5) `WITH CHECK author_type='person' AND author_person_id = app.person_id` (**cả club lẫn dm**) → defense-in-depth chống mạo danh; (6) DB CHECK `assistant/system ⇒ author_person_id IS NULL`; (7) constraint trigger tách 2 function theo bảng (không tham chiếu cột chéo → không lỗi runtime); (8) `create_dm()` SECURITY DEFINER bootstrap DM nhưng gọi `assert_dm_allowed` trước create/reuse, nên BYPASSRLS không thành safety bypass; (9) **toàn bộ definer functions OWNER = `chat_definer` (BYPASSRLS)**; (10) **`chat_definer` được GRANT đúng table privileges**, gồm canonical block/rate/audit rows; (11) **pin quyền `app`**: no direct DML, send qua `send_chat_message`, read-state qua guarded `mark_read()`.

`chat_require_capability(action, tenant, actor)` ở snippet là narrow adapter tới canonical DD-56 registry, không phải registry thứ hai. Allowlist gồm bốn exact keys nhưng ownership tách rõ: DD-86 lifecycle dùng `chat.channel.manage`, shared-message restricted post dùng `chat.channel.post_restricted`, club moderation dùng `chat.message.moderate`/`chat.member.mute`. Nó re-check current target/grant trong mutation transaction và raises khi unknown/unavailable/missing. Channel lifecycle và moderation action dùng actor-scoped UUID receipts; exact replay trả prior safe result, cùng key/khác canonical fingerprint reject trước mutation. Không có RPC hard delete, moderator edit, permanent ban, system-message moderation effect hoặc human-DM moderation.

**Post-root one-owner split:**

| Slice owner | Owns | Must not own |
|---|---|---|
| `tenant-capability-authority-core` | Canonical DD-56 action registry, `admin|co_admin` preset, expiring/revocable grant-read authority, append-only grant audit and fail-closed `authorize` | Chat-local registry, feature mutation, owner/global privilege invention, sensitive grant UI/workflow |
| `chat-club-channel-lifecycle-core` | DD-86 create/rename/set-default/archive, exact-one default, auto-provision, lifecycle receipts | Message post auth, moderation, DM lifecycle |
| `chat-authorized-member-target-read-core` | Current-channel active-human `{targetRef,safeLabel}` DTO with short-lived requester+channel binding + consume-time resolver for mention/mute/start-DM | Global/fuzzy people search, raw UUID authority, persistent target directory, contact/gender/debt/PII, cached authorization |
| `chat-club-moderation-core` | DD-95 mute/moderation storage, hide/restore/mute writers, exact receipts and immutable actor/reason audit | Shared send/read, DM reads/actions, content edit, hard delete, permanent ban, system message |
| `chat-shared-message-command-core` | Send/history/mark-read, reply+mention atomic insert, `post_policy` + read-only active-mute enforcement | Channel lifecycle, mute/moderation storage or writer, DM create/block/report, reaction |
| `chat-dm-lifecycle-command-core` | Create/reuse/block/report/request with canonical DD-55 safety and safe target resolver | Shared send/read writer, club lifecycle or target lookup |
| `chat-realtime-unread-core` | Authorized topics, monotonic cursor, reconnect/history catch-up, unread/badge | Provider/subscription/client delivery or DD-88 grouping |
| `chat-media-upload-scan-core` | Private upload grant, type/size/quota checks, scan worker and `pending|ready|quarantined` state | Message attach, signed read, delete/orphan lifecycle |
| `chat-media-attachment-read-lifecycle` | Ready-only attach, live-authorized signed read, delete/tombstone and bounded orphan cleanup | Upload/scan implementation |
| `chat-message-reaction-core` | Exact Unicode reaction desired-state | Normal send, edit/search/hard delete/moderation |
| `chat-author-edit-delete-revision-core` | Own-human body edit `<15m`/max 5 + revisions; irreversible author tombstone | Author/channel/reply/attachment/mention mutation, assistant/system edit, restore, hard delete |
| `chat-authorized-search-core` | Generated PostgreSQL `simple` vector/index + current authz query | Revision/tombstone/requester-only result indexing, cached ACL |
| `core-payment-remaining-primitive → player-self-charge-read-core` | One remaining formula and canonical person-self payment status | Chat-owned formula/store, other-person debt or unknown→zero |
| `player-self-profile-clubs-read-core` | Canonical `/me` + `/me/clubs` person-self DTO | Charges, Session mutation or Chat-local profile state |
| `player-self-sessions-waitlist-read-core` | Read-only self sessions/waitlist DTO over merged baseline tables | Full SessionService, join/leave/promotion or roster-other-person |
| `marketplace-discovery-navigation-read` / `identity-self-name-navigation-flow` | Canonical discovery and self-name/settings destinations | Chat ranking, join/name mutation or other-person lookup |
| `chat-slash-command-registry-core` | DD-93 ASCII-folded exact zero-arg descriptors + surface matrix | Private response transport, picker, domain handler, normal persistence or LLM routing |
| `chat-requester-only-sync-response` | Authenticated typed `private, no-store` outcome + opaque picker; no row/ref/SSE/outbox | Command grammar or domain formula |
| `chat-pay-command-adapter` | Thin `/pay` route to canonical person-self payment owner | Debt formula/store, LLM or persisted result |
| `chat-profile-navigation-command-adapters` | Thin `/me|/myclubs|/discover|/name` delegation | Profile/discovery/identity business logic |
| `chat-session-command-adapters` | Thin club/bot-only `/sessions|/waitlist` delegation | Session mutation/business rules or human-DM support |
| `assistant-kb-storage-authority-core → assistant-kb-text-ingest-core → assistant-kb-url-ingest-adapter / assistant-kb-file-ingest-adapter → assistant-kb-index-activation-worker → assistant-kb-retrieval-core → assistant-bot-ask-worker` | Storage/config, DLP ingest, bounded URL/file sources, generation-CAS activation, tenant retrieval and answer attempts/results | Alternate indexes, mixed-generation activation, ledger/PII prompt context or Chat projection |
| `assistant-chat-mention-adapter` / `assistant-private-thread-surface` | Structured channel projection / requester-only ask-panel composition after canonical `bot.ask` | Money/session tool selection, human-DM participant or duplicate transcript store |
| `notification-route-integrity-core → notification-web-push-subscription-authority-core → notification-web-push-provider-attempt-core → pwa-installable-shell-core → web-push-registration-client → web-push-display-telemetry-client` | One DD-67→DD-72 route/subscription/provider/PWA/client chain | Generic “Web Push substrate” mega-owner or business content |
| `chat-unread-notification-core` | DD-94 preference/dispatch signal, cursor cancellation, coalescing and send-time reauth through the landed chain | Provider attempt/subscription/client state, parallel unread counter, content/title/amount snapshot |
| `notification-payment-lifecycle-intent-core → notification-payment-reminder-producer / notification-payment-settled-correction-projector → notification-inbox-payment-detail → notification-web-push-payment-adapter` | Source-version lifecycle, real producers, durable authenticated detail and thin generic push | Push-before-Inbox, amount snapshot or second delivery implementation |

Stable mechanism IDs `1–47` are catalog identifiers, not execution order; the catalog spans DB/core/worker/client mechanisms. In particular, execution after lifecycle is `5→9→6→7→8`. Every mechanism row above explicitly owns **zero HTTP**; route ownership is pinned by `A1–A21` below.

- `chat_channels(kind='club')`, club `chat_members`/`chat_messages(tenant_id NOT NULL)` = **tenant-private** (template `feature_multi_tenant_tech.md §3`), cô lập cross-tenant (NFR-S1).
- `chat_channels(kind='dm')` + DM rows = **person-self**: chỉ 2 person ∈ `chat_members` đọc/ghi (policy (b) + DM 2-member guard ở trên). App phải set `app.person_id` cho đường person-self (giống `resolvePersonSelf`, identity §7).
- **Public projection KHÔNG bao giờ chứa chat** (NFR-S2). Không có projector kênh ngoài (CO-7).

### Migration & Rollback

> Toàn bộ `chat_*` và safety storage (`chat_blocks`/`chat_reports`/rate-audit state) đều **chưa tồn tại trong canonical migrations** (verified: no `chat_*` in `packages/db/migrations/`, tail hiện là `0024_public_visibility_capacity_check.sql`). Các SQL block trong doc mô tả **combined target**, không cho phép gộp sai dependency: (1) `chat-dm-safety-authority-core` land safety storage/primitives độc lập với `chat_*`; (2) `dd38-dd86-chat-schema-core` dùng số monotonic kế tiếp tại build để land final tables/constraints/RLS/read adapters; (3) post-root command slices land đúng one-owner split ở trên. KHÔNG sửa migration đã apply, không để root tham chiếu helper chưa land và không land baseline one-channel rồi fold. Candidate key `memberships_id_person_tenant_uq` là ALTER additive trên bảng baseline `memberships` (`0002` — LIVE).

| Bước | Hành động | An toàn? |
|------|-----------|----------|
| 1 | Disable chat routes/RPC + SSE topic trước mọi revert | ✅ |
| 2 | Revert post-root routes/slices theo reverse dependency; rồi root chat migration | ✅ khi chưa enable cho user thật; không drop safety authority như side effect |
| 3 | Revert pre-root safety storage sau khi đã có block/report/audit hoặc DM thật | ❌ Mất safety/audit — sau enable chỉ disable routes + forward-fix |
| 4 | DROP bảng `chat_*` sau khi đã có message/DM thật | ❌ Mất dữ liệu user — chỉ chấp nhận trước enable; sau enable dùng disable routes + forward-fix |
| 5 | DROP/ALTER destructive bảng baseline (`memberships`/`persons`/`tenants`) | ❌ NEVER |

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Non-member gửi/đọc club channel | ❌ Reject — authz `chat_members` + RLS tenant |
| 2 | Security | DM: người thứ 3 đọc | ❌ NEVER — chỉ 2 person trong `chat_members` (person-self) |
| 3 | Security | Cross-tenant club chat leak | ❌ NEVER — RLS fail-closed; test bất biến cô lập |
| 4 | Concurrency | Double-send (retry cùng client_msg_id) | UNIQUE(channel_id, client_msg_id) → trả message cũ, no dup; **dedupe cả assistant/system** (author NULL) vì không phụ thuộc author |
| 4b | Data Integrity | DM thêm người thứ 3 (ghi) | ❌ Trigger `chat_dm_members_guard` chặn — DM đúng 2 member khớp `dm_key` |
| 5 | Anti-spam | Flood messages | Rate-limit per (person, channel) + max_count/window; 429 |
| 6 | Anti-spam | Message quá dài / media lớn | Content-derived type + size/quota cap; reject before attach/serve |
| 7 | Security | Bridge ra Zalo/Messenger | ❌ NEVER phase-1 — không có projector kênh ngoài (CO-7) |
| 8 | Realtime | Topic guessing (SSE) | AuthZ per subscription — reject unauthorized (giống sync engine §3) |
| 9 | Data Integrity | Assistant/system message (DD-20) | `author_type≠'person'` → `membership_id` NULL (CHECK) |
| 10 | Cross-Feature | Account merge → chat authorship | Re-parent `author_person_id`/members về canonical person (identity merge) |
| 11 | Data Integrity | DM tạo trùng cho cùng cặp | `dm_key` normalized + UNIQUE — 1 kênh/cặp, idempotent |
| 12 | Security | Member rời CLB vẫn đọc club chat | Membership `left` → mất quyền club channel (authz theo membership active) |
| 13 | Abuse | Actor or target has blocked the other | Deny DM request/create/send/read at boundary; public error stays generic |
| 14 | Abuse | Sender targets many users or repeatedly targets one user | Enforce both per-sender and per-target/pair windows; audit limit outcome |
| 15 | Security | Media pending, quarantined, rejected, deleted, wrong owner, or wrong channel | Never attach/serve; signed-read endpoint re-checks current channel authz |
| 16 | Security | Host/support tries to inspect a reported DM | Deny by person-self RLS; report stores bounded abuse artifact/reference only, not a host-readable transcript |
| 17 | Security | Muted member or non-capable actor posts to `admins_only` | Reject before message/rate/NOTIFY mutation; DB-time expiry controls mute |
| 18 | Privacy | Case variant/alias/unknown/arg/unsupported slash reaches send | ASCII case variant canonicalizes; every alias/unknown/arg/unsupported surface gets private registry-derived error/help. DB defense rejects every leading slash before message/rate/NOTIFY/unread mutation |
| 19 | Data Integrity | Reply/mention/reaction violates channel/target/set | Reject atomically; target must be current/visible; immutable refs and one of exact `👍|❤️|😂|😮|😢|🙏` only |
| 20 | Security | Moderator targets DM/assistant/system or asks hard delete/edit/permanent ban | Generic deny; no RPC/path and no transcript/content disclosure |
| 21 | Concurrency | Reaction/moderation retry or race | Row/advisory lock + desired state/receipt produces one committed state and one required audit; retry returns current/prior result, never partial |
| 22 | Data Integrity | Edit at/after 15m, sixth edit, concurrent edit, or immutable-field mutation | DB-time/row-lock/count/expected-version guards reject outside contract; one accepted transaction appends exactly one prior-body revision and changes only current body |
| 23 | Privacy | Author soft-deletes then tries restore; reply/search/history reads target | Delete is idempotent and irreversible; all shared reads show tombstone metadata only; moderator restore cannot resurrect it |
| 24 | Security | Search across guessed/left/blocked channel or hidden/deleted/revision/requester-only content | Live authz + current-visible filter returns zero unauthorized content and no channel-existence oracle; only canonical generated `simple` vector is queried |
| 25 | Privacy | Notification/digest worker sees unread message | Durable row/payload stays generic and opaque; no body/title/sender/amount/object snapshot |
| 26 | Security | Access/preference/device/trust changes before provider write | Immediate re-auth cancels on any false/unknown; read advancement cancels obsolete pending work; sticky `unknown` never creates a second send |
| 27 | Security | Client gửi forged `embed_snapshot` | ❌ REJECT — API không nhận `embed_snapshot` từ client. Chỉ nhận `embed_type` + `embed_ref_id`; server resolve + snapshot tại insert time |
| 28 | Security | `embed_ref_id` trỏ tới session mà actor không có quyền xem | 422 `CHAT_EMBED_TARGET_NOT_FOUND` — generic, không tiết lộ session tồn tại hay không. Authz: session phải visible cho actor (same-tenant member hoặc public published) |
| 29 | Data Integrity | Session bị cancel/private/closed sau khi embed đã gửi | Message + snapshot giữ nguyên trong `chat_messages`. Embed là snapshot tại send time, không live-update. Tap CTA phía client re-check live status |
| 30 | Privacy | Embed snapshot chứa venue/roster/PII/charge/debt | ❌ NEVER — server snapshot chỉ BL-DSC-1 whitelist: `sport_key`, `title`, `starts_at`, `ends_at`, `area`, `price_amount`, `confirmed_count`, `slots_open`, `club_display_name`, `host_display_name`, `join_policy`, `session_type`, `session_slug`. KHÔNG `tenant_id`, exact venue, roster, charge, membership refs |
| 31 | Data Integrity | Message có embed_type nhưng không có embed_ref_id (hoặc ngược lại) | DDL CHECK constraint enforce all-NULL or all-NOT-NULL. INSERT reject |
| 32 | Data Integrity | Message không có body và không có embed | DDL CHECK `length(body) > 0 OR embed_type IS NOT NULL`. Ít nhất một phải có |

---

## 3. API Contract — target

### A1–A21 thin HTTP adapter ownership

Mechanism slices `1–47` own no HTTP route. Every `A*` adapter is bounded to session/app-role authentication, exact action authorization, validation, cache/privacy headers, DTO/error mapping and production-shaped route/security tests; it delegates business state to the named mechanism owner and never re-derives money, membership, moderation, unread, KB or notification state.

| API slice | Hard dependency | Boundary |
|---|---|---|
| `A1 chat-channel-list-create-update-api` | 5 | Authorized list/create/rename; no default/archive/send |
| `A2 chat-channel-default-archive-api` | 5 | Atomic default/archive receipts |
| `A3 chat-history-send-read-api` | 7/9/10 | History/send/mark-read; no DM creation or slash persistence |
| `A4 chat-dm-list-create-api` | 8 | DM list/create/reuse; no target discovery |
| `A5 chat-dm-block-report-api` | 8 | Actor-scoped block/unblock/report; no club moderation or DM-read grant |
| `A6 chat-current-member-target-api` | 8/9/A4 | Opaque current-channel targets + start-DM delegation; no global/raw-ID/PII lookup |
| `A7 chat-reaction-api` | 13 | Exact desired-state reaction |
| `A8 chat-author-edit-delete-api` | 14 | Own edit/delete only |
| `A9 chat-authorized-search-api` | 15 | Live-readable current-visible search |
| `A10 chat-media-upload-status-api` | 11 | Upload intent/status |
| `A11 chat-media-attachment-read-delete-api` | 12 | Ready attach/signed read/delete |
| `A12 chat-club-moderation-api` | 6/9 | Club hide/restore/timed mute |
| `A13 chat-slash-execute-private-picker-api` | 22–26 | Exact command + private picker; no result ref |
| `A14 assistant-private-thread-ask-api` | 33–35 | Private bot list/ask and mention status |
| `A15 assistant-kb-text-url-config-api` | 27–29/33 | FAQ/paste/URL/config/aggregate analytics |
| `A16 assistant-kb-file-status-api` | 27/30/31 | Private file/status/quarantine |
| `A17 chat-notification-preference-api` | 42 | Chat preference only |
| `A18 notification-inbox-payment-detail-api` | 46 | Authenticated payment Inbox/detail |
| `A19 web-push-subscription-device-telemetry-api` | 37/41 | Protected device/telemetry boundary |
| `A20 marketplace-discovery-navigation-api` | 20 | Guarded public discovery navigation |
| `A21 identity-self-name-navigation-api` | 21 | Authenticated self-name/settings navigation |

### Route contract

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET | /api/chat/channels | Authenticated Person | Kênh của tôi (club của các tenant tôi là member + DM) |
| GET | /api/chat/channels/:id/member-targets | Current club-channel readability | A6 lists active human `{targetRef,safeLabel}` only; opaque ref is requester+channel-bound and short-lived; no global/fuzzy search, raw UUID or PII |
| GET | /api/chat/channels/:id/messages | Current channel readability | Lịch sử keyset `(createdAt,id)`; shared tombstone-safe renderer; không lộ revision/moderation detail |
| GET | /api/chat/search | Authenticated Person | Required pre-beta search; `q` + optional opaque `channelRef`; current-readable/current-visible body only via canonical generated PostgreSQL `simple` vector and live authz |
| POST | /api/chat/channels/:id/messages | Active channel member | Classifier chạy trước RPC. Shared core alone decides `all_members` vs `admins_only` (`chat.channel.post_restricted`, unknown deny). Normal text may include same-channel `replyToMessageId` + structured mentions + optional `embedType`/`embedRefId` (server resolves and snapshots). API never accepts author fields/direct INSERT/embed_snapshot |
| PATCH | /api/chat/channels/:id/messages/:messageId | Own current human message | Body-only edit while DB time is `<15m` and edit count `<5`; atomic restricted revision append; author/channel/reply/attachments/mentions immutable |
| DELETE | /api/chat/channels/:id/messages/:messageId | Own human message | Anytime irreversible author soft-delete; idempotent shared tombstone; no restore/hard delete |
| POST | /api/chat/commands/execute | Authenticated Person + current surface access | ASCII case-insensitive exact zero-arg/no-alias registry. All surfaces: `/help|/pay|/me|/myclubs|/discover|/name`; club/bot additionally `/sessions|/waitlist`; unsupported human-DM command and every invalid form reject privately before insert. `/help` is registry-derived post-authz. Sync `private, no-store`; no raw tenant authority/result ref/shared persistence |
| POST | /api/chat/dm | Current club-channel member | A6/A4 accept only opaque current-channel `targetRef`; slice 9 re-authorizes actor+target then slice 8 opens/reuses DM by internal deterministic pair key |
| POST | /api/chat/channels/:id/read | Member of channel | Advance canonical `(createdAt,id)` read cursor monotonically and cancel obsolete pending notification work |
| PUT | /api/chat/channels/:id/notification-preference | Active club member | Exact `all|mentions|off`, default `mentions`; DM/direct-mention/reply default ON |
| POST | /api/chat/block | Authorized current DM peer | Resolve target from an authorized DM context/opaque ref, then block deterministically; no raw person ID authority |
| DELETE | /api/chat/block | Authorized current DM peer | Resolve the same bounded target context, unblock and audit; no global target lookup |
| POST | /api/chat/report | Authorized current DM peer/message | Report bounded target/evidence with actor-scoped receipt; no raw target authority or host DM-read grant |
| POST | /api/chat/media/initiate | Authenticated Person | Validate declared size/type/quota; return private short-lived upload grant |
| POST | /api/chat/media/:id/finalize | Attachment owner | Verify object metadata; enqueue malware/moderation scan idempotently |
| GET | /api/chat/media/:id/access | Authorized channel member | Re-authorize current membership/state; issue short-lived signed read only for `ready` object |
| DELETE | /api/chat/media/:id | Attachment owner or authorized moderator | Apply deletion policy; tombstone references; revoke future signed access |
| GET | /api/chat/subscribe | Authenticated | SSE — topic `tenant:<id>:chat:<channel>` (club) / `person:<id>:chat` (dm) |
| POST | /api/chat/channels | `chat.channel.manage` | Create club channel + atomic auto-provision; server derives Assistant `true` for `all_members`, `false` for `admins_only`; actor-scoped idempotency key |
| PATCH | /api/chat/channels/:id | `chat.channel.manage` | Update title/club-only metadata or Assistant setting on either post policy; accepting true requires current tenant-config/`assistant_ai_kb` entitlement/provider/privacy gates and consume re-checks them; no Announcements special case |
| POST | /api/chat/channels/:id/default | `chat.channel.manage` | Serialized default swap; exactly-one invariant |
| POST | /api/chat/channels/:id/archive | `chat.channel.manage` | Archive; default requires replacement channel in same command |
| PUT | /api/chat/channels/:id/messages/:messageId/reaction | Current message readability | Desired own state `{reaction: 👍|❤️|😂|😮|😢|🙏|null}`; one active row, atomic replace/remove/idempotent |
| POST | /api/chat/channels/:id/messages/:messageId/moderation | `chat.message.moderate` | `{action: hide|restore, reasonCode, reasonNote?, commandId}` on human club message; exact reason contract + actor-scoped receipt/immutable audit |
| POST | /api/chat/channels/:id/mutes | `chat.member.mute` | `{targetRef,duration: 1h|24h|7d,reasonCode,reasonNote?,commandId}`; DB-computed expiry + receipt/audit; write blocked/read unchanged; no permanent/DM target |

### Request/Response Examples

> Field names dưới là canonical DTO whitelist; build slice không được thêm actor/tenant/author authority fields. Envelope chuẩn DD-60 (`../../standards/api-reference-convention.md`); additive `meta.requestId` không đổi fingerprint nghiệp vụ.

**POST `/api/chat/channels/:id/messages`** (qua `send_chat_message`, idempotent theo `client_msg_id`):

- Request:

```json
{
  "clientMsgId": "cmsg_…",
  "body": "Tối nay 19h sân A nhé",
  "replyToMessageId": null,
  "mentions": [{ "targetKind": "person", "targetRef": "opaque_person_ref" }]
}
```

**POST `/api/chat/channels/:id/messages`** (với session embed):

- Request:

```json
{
  "clientMsgId": "cmsg_…",
  "body": "Tham gia kèo này đi!",
  "embedType": "session",
  "embedRefId": "<session_uuid>"
}
```

> Server resolve `embedRefId` → validate actor visibility → snapshot BL-DSC-1 whitelist → atomic insert message + embed. Client KHÔNG gửi `embedSnapshot`.

- `200` — success (embed included):

```json
{
  "data": {
    "message": {
      "id": "…",
      "channelId": "…",
      "authorType": "person",
      "body": "Tham gia kèo này đi!",
      "embed": {
        "type": "session",
        "refId": "<session_uuid>",
        "snapshot": {
          "sportKey": "badminton",
          "title": "Kèo chiều thứ 5",
          "startsAt": "2026-08-14T10:00:00Z",
          "endsAt": "2026-08-14T12:00:00Z",
          "area": "Quận 7",
          "priceAmount": 150000,
          "confirmedCount": 4,
          "slotsOpen": 2,
          "clubDisplayName": "CLB Cầu Lông Q7",
          "hostDisplayName": "Minh Hoàng",
          "joinPolicy": "open",
          "sessionType": "pickup",
          "sessionSlug": "keo-chieu-thu-5-abc123"
        }
      },
      "createdAt": "…"
    }
  },
  "error": null,
  "meta": { "requestId": "req_…" }
}
```

- `200` — thành công (duplicate `client_msg_id` trả cùng message, không tạo mới):

```json
{ "data": { "message": { "id": "…", "channelId": "…", "authorType": "person", "createdAt": "…" } }, "error": null, "meta": { "requestId": "req_…" } }
```

- `403` — không phải member / sai tenant:

```json
{ "data": null, "error": { "code": "CHAT_FORBIDDEN", "message": "Không có quyền trong kênh này", "statusCode": 403 }, "meta": { "requestId": "req_…" } }
```

- `429` — anti-spam:

```json
{ "data": null, "error": { "code": "CHAT_RATE_LIMITED", "message": "Gửi quá nhanh — thử lại", "statusCode": 429 }, "meta": { "requestId": "req_…" } }
```

**POST `/api/chat/commands/execute`** (requester-only):

- Request: `{ "surface": "club|club_bot|human_dm", "channelRef": "opaque", "input": "/PAY" }`. Server ASCII-case-folds the exact whole input to canonical `/pay`; it does not accept a client-supplied canonical command or tenant authority.
- All three surfaces expose `/help`, `/pay`, `/me`, `/myclubs`, `/discover`, `/name`; club and private Club Bot additionally expose `/sessions`, `/waitlist`. There are no aliases or arguments. Unknown/arg/non-ASCII-lookalike/unsupported human-DM input returns private error/help and never falls through to message send. `/help` comes from this same registry after requester+surface authz.
- Response luôn có `Cache-Control: private, no-store`; actor derive từ session. Mỗi canonical command có typed requester-only outcome do domain owner tương ứng sở hữu. Riêng `/pay`, `data.outcome ∈ {self_payment_status, club_choice_required, no_eligible_club}` và exact self-payment payload thuộc Player View contract.
- `club_choice_required` chỉ trả display label + opaque short-lived selector; không trả raw tenant authority. Request chọn lại chỉ gửi selector cùng surface+command, không gửi tenant ID.
- Response **không có** `messageId`, `resultRef`, `eventId` hoặc URL đọc lại. Server tạo zero `chat_messages`, result row, SSE, outbox, push hoặc unread entry; human-DM peer không có observable delta.

**PATCH own message / DELETE own message / GET search:**

- Edit request contains only `{ "body": "…", "expectedEditCount": 2 }`; server derives actor, locks the current row and uses DB time. It accepts only own human message before 15 minutes and while fewer than five edits exist, appends the previous body to restricted revisions, then returns the current message with incremented count. Any attempt to change author/channel/reply/attachments/mentions is rejected.
- Delete is an idempotent irreversible soft-delete. Shared history/replies/search return only tombstone metadata afterward; no author restore or hard-delete route exists.
- Search accepts `q` and optional opaque `channelRef`, re-authorizes live, and returns only current visible message hits. Response never includes revisions, author-deleted/moderation-hidden bodies, requester-only slash/private Club Bot results or unauthorized-channel existence.

**PUT reaction / POST moderation or mute:**

```json
{ "reaction": "❤️" }
```

```json
{
  "action": "hide",
  "reasonCode": "off_topic",
  "commandId": "uuid"
}
```

- Reaction `reaction:null` removes own reaction; same desired state is 200-safe. Exact `👍|❤️|😂|😮|😢|🙏` are the only accepted values.
- Moderation reason is exact `spam|harassment|unsafe|off_topic|other`; `other` requires a bounded `reasonNote`, and every other reason rejects one. Mute additionally accepts only `duration: 1h|24h|7d`; server computes expiry from DB time.
- Moderation response is a receipt, never message content/transcript. Actor, target, action, reason/note, duration and timestamp are immutable restricted audit fields.

### Realtime Authorization (reuse DD-07 / sync engine §3)

```text
Topic tenant:<id>:chat:<channel> → requires active club membership + chat_members
Topic person:<id>:chat          → subscription requires authenticated person == <id>; every event reloads
                                 its channel and requires dm_current_read_allowed(channel)
```

SSE re-authorizes before every event and on a heartbeat no slower than 30 seconds. A block, membership `left`, disabled safety capability or auth-session revocation closes delivery immediately; topic possession alone never authorizes a DM payload.

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 403 | `CHAT_FORBIDDEN` | Không có quyền trong kênh này | Not a member / wrong tenant |
| 409 | `CHAT_DUP_MESSAGE` (200-safe) | — | Duplicate `client_msg_id` → trả message cũ |
| 413 | `CHAT_MESSAGE_TOO_LARGE` | Tin nhắn quá dài | Over size cap |
| 429 | `CHAT_RATE_LIMITED` | Gửi quá nhanh — thử lại | Anti-spam limit |
| 403 | `CHAT_SAFETY_BLOCKED` | Không thể thực hiện thao tác | Blocked pair or open-DM safety gate unavailable; intentionally generic |
| 409 | `CHAT_MEDIA_NOT_READY` | Tệp chưa sẵn sàng | Pending/rejected/quarantined/deleted/wrong-owner attachment |
| 415 | `CHAT_MEDIA_TYPE_REJECTED` | Loại tệp không được hỗ trợ | Content-derived MIME not allow-listed |
| 422 | `CHAT_MEDIA_REJECTED` | Tệp không thể sử dụng | Malware/moderation rejection; no signed access |
| 403 | `CHAT_CAPABILITY_REQUIRED` | Không có quyền thực hiện thao tác | DD-86 channel command capability missing/unknown; fail-closed |
| 409 | `CHAT_DEFAULT_REQUIRED` | CLB phải có một kênh mặc định | Archive/default transition would leave zero active defaults |
| 409 | `CHAT_IDEMPOTENCY_MISMATCH` | Yêu cầu không khớp lần gửi trước | Same command idempotency key reused with a different request fingerprint |
| 409 | `CHAT_COMMAND_ROUTE_REQUIRED` | Hãy dùng thao tác riêng tư này trong ứng dụng | Registered requester-only slash reached normal message endpoint; zero mutation |
| 400 | `CHAT_COMMAND_SELECTOR_INVALID` | Lựa chọn không còn hợp lệ | Selector expired, wrong actor/DM/command, or tenant no longer eligible; intentionally generic |
| 400 | `CHAT_COMMAND_UNKNOWN` | Lệnh chưa hỗ trợ — xem `/help` | Alias, unknown or non-ASCII-lookalike leading slash; ASCII case variants are canonicalized |
| 400 | `CHAT_COMMAND_ARGUMENTS_NOT_ALLOWED` | Lệnh này không nhận tham số | Any token after a canonical command; private/pre-insert |
| 400 | `CHAT_COMMAND_UNSUPPORTED_SURFACE` | Lệnh chưa dùng được tại đây | `/sessions` or `/waitlist` in human DM; private/pre-insert |
| 403 | `CHAT_MUTED` | Bạn đang tạm bị giới hạn gửi trong kênh này | Active DB-time channel mute; read access unchanged |
| 409 | `CHAT_REPLY_INVALID` | Tin nhắn trả lời không còn hợp lệ | Reply target missing/cross-channel/already tombstoned; no partial insert |
| 422 | `CHAT_MENTION_INVALID` | Mention không hợp lệ | Forged/non-member/invalid structured target |
| 422 | `CHAT_REACTION_INVALID` | Cảm xúc không hợp lệ | Value outside exact `👍|❤️|😂|😮|😢|🙏` |
| 409 | `CHAT_MESSAGE_TOMBSTONED` | Tin nhắn đã được ẩn | Reply/reaction target is moderation-hidden or author-deleted where visible content is required |
| 409 | `CHAT_EDIT_WINDOW_CLOSED` | Không thể sửa tin nhắn này nữa | DB time is not `<15m`, five edits already used, wrong author, or assistant/system message |
| 409 | `CHAT_EDIT_CONFLICT` | Tin nhắn đã thay đổi | `expectedEditCount` is stale; no revision/body mutation |
| 422 | `CHAT_REASON_INVALID` | Lý do không hợp lệ | Not exact `spam|harassment|unsafe|off_topic|other`, or `other` note rule fails |
| 422 | `CHAT_MUTE_DURATION_INVALID` | Thời hạn tạm ẩn không hợp lệ | Value outside exact `1h|24h|7d` |
| 403 | `CHAT_MODERATION_FORBIDDEN` | Không thể kiểm duyệt nội dung này | Missing exact capability; non-human/non-club/DM target; generic no-disclosure |

### Rate Limits

| Endpoint | Limit | Scope |
|----------|-------|-------|
| POST message | 20/10s (burst), 300/min | Per (person, channel) |
| POST /chat/dm | 30/min | Per person |
| POST /chat/dm + DM sends | Product-tuned bounded windows | Both per sender and per sender-target pair; no open-DM launch without verified thresholds |
| POST /chat/commands/execute | 60/min + command-specific policy | Per authenticated person; picker retry does not consume chat send quota |
| PATCH/DELETE own message | 30/min | Per (person, channel); edit additionally capped at five accepted revisions/message |
| GET /chat/search | 30/min | Per person; bounded query length/result page and live authz |
| PUT reaction | 60/min | Per (person, channel); same desired-state replay is no-op |
| Moderation/mute commands | 30/min | Per (actor, tenant) + per target; receipts prevent retry duplication |
| Media initiate/finalize | Product-tuned object + byte quota | Per person/day + concurrent pending objects + channel |
| Report | Bounded burst + daily cap | Per reporter/target; preserve legitimate safety escalation path |

Numeric DM/media/report thresholds are **enablement values**, not guessed code defaults. Corresponding routes remain OFF/fail-closed until configured values pass boundary tests; this does not authorize an unbounded fallback.

### Idempotency

> Tổng hợp từ cơ chế đã pin ở §2/§4 (canonical) — bảng này chỉ tham chiếu.

| Đường | Idempotent? | Key/Cơ chế |
|-------|-------------|------------|
| Send message | ✅ | `UNIQUE(channel_id, client_msg_id)` + advisory lock trong `send_chat_message` — retry trả message cũ, không double-consume rate/audit (test #43) |
| Tạo DM | ✅ | `dm_key` normalized UNIQUE — 1 kênh/cặp; `create_dm` reuse sau `assert_dm_allowed` (test #38) |
| Assistant projector (P7) | ✅ | `client_msg_id='assistant:'+query_id` deterministic + unique `bot_query_id` (xem `feature_club_assistant_tech.md`) |
| Media finalize/scan | ✅ | Enqueue scan idempotent (endpoint §3); một scan lifecycle + orphan cleanup (test #35) |
| Block/unblock/report | ✅ v1 contract | Actor-scoped UUID command receipt + canonical `(action,target,reason/evidence fingerprint)`; exact replay returns prior safe result, same key/different fingerprint rejects before mutation. Block state is deterministic per actor-target pair; report writes exactly one append-only report/audit effect under retry/concurrency |
| DD-86 channel lifecycle commands | ✅ final contract | Tenant+actor-scoped UUID key + command/request fingerprint in `chat_command_receipts`; exact replay returns prior result, mismatch fails closed |
| Moderation/mute commands | ✅ final contract | Tenant+actor-scoped UUID key + canonical action/target/reason fingerprint in `chat_command_receipts`; exact replay returns prior result and creates no second audit, mismatch fails closed |
| Reaction desired state | ✅ | Primary key `(message_id,person_id)` + message row lock; same desired token and remove-absent return current state, another accepted token atomically replaces the one row |
| Own edit/delete | Edit: optimistic concurrency; delete: idempotent | Edit locks row and requires expected current edit count before one revision/body mutation. Delete sets author tombstone once; retry returns tombstoned state and never restores |
| Push/digest provider write | ✅ sticky attempt | One attempt identity per coalesced `(person,channel,highest_unread_cursor)` row (which records its selected delivery kind); `unknown` is not retried as a new send, and read advancement cancels obsolete pending work |
| Requester-only read command | Read-only/retriable; no durable result receipt | Re-authorize surface + selector + eligible club and recompute canonical self view on every call; selector is short-lived/bound, not result authority |

---

## 4. Chi tiết triển khai — target

### Send pipeline

```text
API → send_chat_message(channel, client_msg_id, body, reply_ref?, mentions[]) SECURITY DEFINER
    → deterministic idempotency lock + existing-owned-message check
    → resolve actor/channel
        → club: active membership + active mute check
            → admins_only: exact chat.channel.post_restricted; unknown/unavailable deny
        → DM: block + sender + target/pair safety core
    → resolve visible same-channel reply
    → consume each opaque mention target through slice 9; re-authorize current actor+target+channel
      and persist only immutable resolved target ref + sanitized safe-label snapshot
    → validate every attachment is actor-owned + channel-bound + ready
    → INSERT message + mention rows atomically (ON CONFLICT client_msg_id → return existing)
    → pg NOTIFY 'chat_<channel>' (payload = message id, không PII)
    → SSE dispatcher đọc canonical message, re-authorize current channel access, rồi mới đẩy
```

Message body escape/sanitize. Media upload is private and separate from send: validate declared metadata → direct private upload → verify object metadata/content-derived MIME → scan/moderate → mark `ready`; pending/rejected/quarantined/deleted objects are never attached or served. Read access is short-lived and re-authorized on each request; deletion revokes future grants and leaves a message tombstone. Orphan pending objects expire through a cleanup job. NOTIFY payload **không** chứa body/object key/PII — subscriber refetch canonical dưới authz.

Requester-only command pipeline đứng trước pipeline trên:

```text
POST message → whole-input leading-slash classifier
  ├─ normal text → send_chat_message
  └─ leading slash control input
       ├─ ASCII-casefold exact /help|/pay|/me|/myclubs|/discover|/name on all surfaces
       ├─ ASCII-casefold exact /sessions|/waitlist on club|club_bot only
       └─ alias|arg|unknown|non-ASCII lookalike|unsupported surface → private typed error + /help
     Every command/control branch creates zero message/rate/NOTIFY/unread mutation

POST command/execute → verify session + current surface
  → dispatch exact ASCII-casefolded zero-arg/no-alias catalog entry
  → /help derives current allowed entries from that same registry after authz
  → when club context is needed in human DM: derive requester eligible clubs
      (1 auto | many opaque picker | 0 generic) and verify bound selector when present
  → each command calls its canonical domain owner; /pay uses Player View/self-payment adapter
  → synchronous `Cache-Control: private, no-store` typed response; no bot writer/result persistence/event
```

Interaction, search, moderation and notification stay out of the normal-send writer:

```text
PUT reaction → current-readable visible message → lock
  → upsert one of 👍|❤️|😂|😮|😢|🙏 or remove own row

PATCH own message → own human row lock + DB time <15m + edit_count<5 + expected count
  → append prior body revision + update only body/edit metadata/search vector atomically
DELETE own message → own human row lock → one-way author tombstone
GET search → live-readable channels + current visible body + generated PostgreSQL simple vector

POST moderation/mute → club target + exact capability + receipt fingerprint
  → validate exact reason/note and exact 1h|24h|7d mute duration
  → hide/restore visibility or apply DB-timed write mute under lock + append one immutable audit
  → no DM transcript read, content edit, hard delete, permanent ban or system message

Unread transition → evaluate DM/direct-mention/reply default ON or club all|mentions|off
  → coalesce generic opaque work by person+channel+highest unread cursor
  → mark-read cancels obsolete pending work
  → immediately before provider write re-check access+safety+preference+device+trust epoch
  → sticky attempt: delivered/unknown never spawns a duplicate send
```

### Trợ lý tái dùng (DD-19 pha B, DD-20 — P7, ngoài phase-1)

Khi trợ lý bật: bot-participant phát ngôn trong `chat_channels(kind='club')` với `author_type='assistant'`, `membership_id=NULL`, log ở `bot_queries` (Club Assistant). **Không** tạo model chat song song — cùng bộ bảng `chat_*`. Grounding trợ lý vẫn chỉ KB (DD-21). DD-86 final derives `assistant_enabled=true` for new `all_members` channels and `false` for new `admins_only` channels; exact `chat.channel.manage` may mutate either kind, while accepting true requires tenant config, exact `assistant_ai_kb` entitlement, provider and privacy gates. “Announcements” has no hidden special case beyond its `admins_only` default. Ingress lẫn projector consume đều re-check the full conjunction; bất kỳ false/unknown nào tạo zero query/provider/message.

### Caching Strategy

| Data | Cache? | TTL | Invalidation |
|------|--------|-----|-------------|
| Membership/DM safety decision (`chat_current_is_member`/`dm_current_read_allowed`/`assert_dm_allowed`) | ❌ | — | Fail-closed, live per-request/per-event; SSE re-authorize trước mỗi event + heartbeat ≤30s (§3) |
| Message history/list | ❌ | — | Live read dưới RLS + cursor pagination |
| Search result/ACL | ❌ | — | Generated `simple` vector is DB index only; current channel readability + visibility re-evaluated per query |
| Notification/digest payload | ❌ content cache | Configured enablement window only | Opaque cursor coordination; pre-provider live re-auth and mark-read cancellation |
| Signed media access | Short-lived grant (không phải cache) | Ngắn (§2 DD-55) | Re-authorize mỗi request; delete/leave revoke future grants |
| Channel mute | ❌ | DB-owned `expires_at` | Compare `statement_timestamp()` at every send; no client timer authority |

### Security Checklist (template v2.33 — map về section đã pin)

| Mục | Trả lời trong spec |
|-----|---------------------|
| Authorization/ownership | §2 RLS 2-policy + RPC choke-point (app không direct DML); §3 SSE re-auth per event; DM person-self, host/support không đọc DM (edge #16, test #31) |
| Injection/validation | §4 body escape/sanitize; media content-derived MIME + malware scan; API/RPC không nhận author fields (test #16) |
| Secret & log redaction | §4 NOTIFY payload chỉ message id, không body/object key/PII; error DM cố ý generic (`CHAT_SAFETY_BLOCKED`), không lộ block detail |
| Webhook signature + replay | N/A — không có webhook ingress; realtime là SSE nội bộ (DD-07), không bridge kênh ngoài (CO-7) |
| Idempotency | Bảng Idempotency §3: send/DM deterministic keys; lifecycle/moderation receipts; reaction desired-state |
| Data retention/xoá | Không TTL/auto-delete/hard purge. Own edit giữ tối đa năm restricted prior-body revisions; author soft-delete là tombstone một chiều; moderator hide/restore chỉ đổi visibility và giữ immutable actor/reason audit. Search chỉ current-visible body. Push/digest giữ opaque unread cursor/attempt, không durable item/body/title/amount snapshot |

---

## 5. Testing Plan — acceptance authority

### Unit / Integration (test bất biến DD-38)

| # | Test | Expected |
|---|------|----------|
| 1 | Club chat cross-tenant | Tenant A message không hiện ở tenant B (RLS) |
| 2 | DM 2-person only | Person thứ 3 không đọc được |
| 3 | Non-member post | 403 `CHAT_FORBIDDEN` |
| 4 | Duplicate client_msg_id | 1 message, trả cũ (idempotent) |
| 5 | Rate-limit flood | 429 sau ngưỡng |
| 6 | Size cap | 413 khi vượt |
| 7 | No external bridge | Message không xuất hiện ở Zalo/Messenger (không projector kênh ngoài) |
| 8 | SSE topic authz | person:other / tenant khác → rejected |
| 9 | Assistant message shape | `author_type='assistant'` → `membership_id` NULL (CHECK) |
| 10 | DM idempotent | Mở DM 2 lần cùng cặp → 1 channel (`dm_key`) |
| 11 | Merge re-parent | Merge 2 person → authorship/members hội tụ canonical |
| 12 | Left member loses club chat | Membership `left` → 403 |
| 13 | **DM bootstrap** | `create_dm(other)` (RLS bật) → tạo channel + 2 member OK; gọi lại cùng cặp → cùng channel (idempotent). Input xấu `create_dm(self)`/`create_dm(NULL)` → reject (caller LUÔN là 1 trong 2 nên không test "ngoài cặp") |
| 14 | **Shared-trigger execution** | INSERT `chat_channels(kind='dm')` không kèm 2 member trong txn → **FAIL ở COMMIT** (trigger `chat_channels` chạy, KHÔNG lỗi "field channel_id not found"); club channel/message không bị trigger DM đụng |
| 15 | **Assistant/system spoof** | Role `app` direct INSERT bất kỳ `chat_messages` → **permission denied**; user RPC không nhận `author_type`, chỉ bot SECURITY DEFINER riêng ở P7 mới ghi assistant/system |
| 16 | **Author spoof** | Gọi user send API/RPC với payload cố chèn `author_person_id`/`membership_id`/`author_type` → field bị từ chối/không có trong signature; persisted author luôn là current person + membership server-resolved |
| 17 | **Nullable-tenant giả DM** | Club message/member cố đặt `tenant_id=NULL` → `chat_bind_tenant` set lại = tenant channel (không lọt shape DM) |
| 18 | **DM member immutable** | DELETE 1 member của DM → rejected; thêm người thứ 3 → rejected (insert guard + deferred) |
| 19 | **create_dm dưới FORCE RLS (role `app` THẬT)** | `SET ROLE app` + set `app.person_id` → `create_dm(other)` **chạy OK** (definer OWNER BYPASSRLS + có table grant); tạo channel + 2 member. Input xấu: `create_dm(self)` hoặc `create_dm(NULL)` → reject `invalid DM participants` (caller LUÔN là 1 trong 2 nên không test "ngoài cặp") |
| 20 | **Direct DML bị chặn (role `app`)** | `app` INSERT/UPDATE/DELETE **thẳng** `chat_channels`/`chat_members`/`chat_messages` → **permission denied**; chỉ `create_dm`/`send_chat_message`/`mark_read` và bot RPC hẹp làm được |
| 21 | **Helper không đệ quy (role `app`)** | SELECT DM dưới RLS (policy gọi `chat_current_is_member`) → trả kết quả, **không** stack-overflow/recursion (helper OWNER BYPASSRLS đọc `chat_members` ngoài RLS) |
| 22 | **Bot writer tách biệt** | User role không EXECUTE bot writer; bot writer chỉ chấp nhận `bot_query_id` đã authorized và cố định `author_type='assistant'`, không cho caller chọn system/person |
| 23 | **chat_definer thiếu grant** | Nếu quên `GRANT … TO chat_definer` → `create_dm`/helper báo **permission denied** (regression: BYPASSRLS không thay table privilege) |
| 24 | **Read-state isolation + safety** | `app` gọi `mark_read(channel,throughMessage)` → chỉ current person advance cursor monotonically; DM blocked/safety-off và club membership `left` bị deny trước UPDATE; không có direct UPDATE grant; shared slice chạy được khi notification tables hoàn toàn chưa tồn tại |
| 25 | **Provision bằng MIGRATION ROLE thật (không superuser)** | Chạy migration DDL dưới `DATABASE_URL_MIGRATION` (DDL-owner, NOSUPERUSER): (a) `CREATE ROLE … BYPASSRLS` do migration role → **FAIL** (PG16: cần superuser hoặc role có BYPASSRLS+CREATEROLE); (b) khi `chat_definer` đã pre-provision + `GRANT chat_definer TO migration_owner` → `CREATE FUNCTION` + `ALTER … OWNER TO chat_definer` + GRANT table **chạy OK**; (c) thiếu pre-provision → migration FAIL sớm. Test harness **không** được dùng superuser để "che" |
| 26 | **ALTER OWNER thiếu CREATE ON SCHEMA (PG16)** | Fresh PG16 (public không cấp CREATE mặc định): `ALTER FUNCTION … OWNER TO chat_definer` khi chat_definer **chưa** có `CREATE ON SCHEMA public` → **FAIL**; sau `GRANT CREATE … TO chat_definer` → OK; `REVOKE CREATE` sau đó không phá runtime (chỉ cần USAGE) |
| 27 | **Pre-provision idempotent + attribute check ĐỦ BỘ** | Re-run với chat_definer đúng exact attributes → **no-op**; `CREATE ROLE` thuần (không guard) → FAIL "already exists". **chat_definer tồn tại với BẤT KỲ attribute thừa** — `LOGIN`, `NOBYPASSRLS`, `SUPERUSER`, `CREATEDB`, `CREATEROLE`, **`INHERIT`**, hoặc **`REPLICATION`** → DO-block **RAISE fail-closed**, KHÔNG cấp table grants. Từng attribute phải có case riêng (regression: thiếu kiểm `rolinherit`/`rolreplication` → role privilege thừa vẫn lọt validation) |
| 28 | **Open-DM hard gate** | Disable any one of block/report/sender-target-limit/audit capabilities | `create_dm` and DM send both fail closed; feature cannot launch |
| 29 | **Block bypass** | A blocks B; either side reuses existing DM and attempts request/create/send/read | Every boundary denies per canonical block decision; no block detail leaked |
| 30 | **Sender-target throttle** | One sender fans out and repeatedly targets one person | Independent sender and pair/target windows enforce + audit |
| 31 | **Host/support DM denial** | Tenant owner/support queries normal or reported DM | RLS/authz deny; reporting does not grant transcript read |
| 32 | **Media content validation** | Declared image with executable bytes / oversize / quota exceeded | Reject or quarantine; never `ready`, attachable, or signed-readable |
| 33 | **Media ready-only attach** | Pending/rejected/wrong-owner/wrong-channel object in send command | Transaction rejected; no message/attachment partial write |
| 34 | **Signed read re-authz** | Member gets old URL then leaves channel/object is deleted | New access denied; short-lived old grant expires; tombstone remains |
| 35 | **Media scan idempotency + orphan cleanup** | Finalize retry + abandoned upload | One scan lifecycle; stale orphan deleted after TTL |
| 36 | **Media deletion lifecycle** | Delete attached media | Object unavailable, future grants denied, message renders tombstone, audit retained |
| 37 | **DM bootstrap safety parity** | Block A↔B, disable từng safety capability, hoặc vượt create target-rate rồi gọi `create_dm` trực tiếp dưới real `app` role | Generic denial before INSERT/reuse; no channel/member mutation; bounded audit, no block-detail leak |
| 38 | **Existing DM reuse safety** | DM đã tồn tại rồi A blocks B; B gọi `create_dm(A)` | `assert_dm_allowed` denies before returning existing channel; reuse cannot bypass block |
| 39 | **Direct-send bypass closure** | `SET ROLE app; INSERT INTO chat_messages ...` cho club/DM | Permission denied; block/rate/audit không thể bị né bằng raw DML |
| 40 | **Blocked DM read/mark-read** | A/B đã có DM, sau đó một bên block; GET list/history và `mark_read` | Zero rows/generic denial; canonical `(created_at,id)` read cursor không đổi |
| 41 | **Blocked DM realtime** | Block xảy ra khi SSE đang mở | Re-auth ở event/heartbeat kế tiếp đóng stream; không phát message mới hoặc body qua stale subscription |
| 42 | **Club membership lifecycle** | Club member chuyển `active → left` trong lúc list/SSE/send | RLS read về zero, send/mark-read deny, SSE đóng; quay lại active thì quyền được tính từ membership hiện hành |
| 43 | **Concurrent send retry** | Hai transaction cùng `(channel_id, client_msg_id)` | Idempotency advisory lock serialize; đúng 1 message và rate/audit side effect không bị double-consume |
| 44 | **Transactional realtime signal** | First send commits, duplicate retries, and injected rollback after INSERT | Successful first commit emits exactly one `chat_<channel>` notification containing message ID only; duplicate retry emits none; rollback delivers none |
| 45 | **Composite parent key tồn tại thật** | Chạy migration chat trên toàn bộ canonical migrations mới nhất; query `pg_constraint`, rồi thử club member/message đúng và sai `(membership_id, person_id, tenant_id)` | Có `memberships_id_person_tenant_uq` trước khi tạo FK; tuple đúng insert được, đổi person hoặc tenant bị FK reject; migration không lỗi “there is no unique constraint matching given keys” |
| 46 | **DD-86 DM metadata shape** | Thử ghi title/sort-order/post-policy/default/assistant/creator/tenant vào DM | Constraint reject; DM hợp lệ giữ toàn bộ club-only/creator fields NULL |
| 47 | **DD-86 exactly-one default** | Create tenant + first/subsequent channel, rồi swap default | Mọi commit có đúng một active default; partial unique không được dùng như proof duy nhất |
| 48 | **DD-86 concurrent default swap** | Hai transaction set hai channel khác nhau làm default | Tenant lock serialize; một final default, không zero/two default |
| 49 | **DD-86 archive default** | Archive default thiếu replacement / có replacement | Thiếu replacement → `CHAT_DEFAULT_REQUIRED`; có replacement → swap+archive atomic |
| 50 | **DD-86 create-channel provisioning rollback** | Inject failure giữa batch membership provision | Không channel/member partial rows; retry tạo đúng một channel và đủ members |
| 51 | **DD-86 membership activation replay** | Activate cùng membership lặp/concurrent khi N channels active | Đủ đúng một member row/channel, không duplicate/thiếu |
| 52 | **DD-86 capability fail-closed** | Role label admin nhưng capability thiếu; registry unavailable/unknown | Channel mutation/restricted post đều deny; role label không bypass |
| 53 | **DD-86 command idempotency** | Replay exact request và reuse key với payload khác | Exact replay trả receipt cũ/no second mutation; mismatch → `CHAT_IDEMPOTENCY_MISMATCH` |
| 54 | **DD-86 Assistant derived default + conjunction** | Create `all_members`, `admins_only` and Announcements-labelled channels; try client-supplied setting and unauthorized mutation; then enable/toggle each tenant/`assistant_ai_kb`/provider/privacy gate | Server derives true for `all_members`, false for `admins_only`; exact `chat.channel.manage` mutates either policy and accepting true requires all gates. Announcements has no special rule beyond `admins_only`; every false/unknown ingress/consume gate creates zero query/provider/message |
| 55 | **DD-93 exact slash × surface matrix** | Run all eight canonical commands in ASCII lower/upper/mixed case on `club`, `club_bot`, `human_dm`; repeat aliases, arguments, unknown and non-ASCII lookalikes; inspect `/help` per actor/surface | Six common commands route privately on all surfaces; `/sessions|/waitlist` route only club/bot. Case variants canonicalize; every other leading slash returns registry-derived private error/help with zero message/rate/NOTIFY/unread mutation |
| 56 | **DD-91 `/pay` in club channel** | Requester executes `/pay` while another member watches history/SSE/unread | Requester receives canonical self-payment result synchronously; observers and all shared state remain byte-identical; no Assistant/bot writer |
| 57 | **DD-91 `/pay` in private Club Bot** | Requester executes `/pay` in bot surface and changes debt before retry | Each call re-authorizes and recomputes current Player View; zero result row/ref/message/SSE/outbox/push |
| 58 | **DD-91 `/pay` in human DM one/many/none** | Requester has 1, 2, 0 eligible clubs while peer watches DM state | One auto-selects; two returns requester-only picker; zero returns generic empty. Peer sees zero message/event/unread delta and cannot infer tenant/status |
| 59 | **Opaque selector authority** | Valid selector; raw tenant ID; expired/wrong actor/wrong DM/wrong command; membership changes after issue | Only a still-eligible bound selector passes; all others generic `CHAT_COMMAND_SELECTOR_INVALID`, zero status disclosure |
| 60 | **No-store/no-ref command contract** | Inspect success/picker/error across all three surfaces and DB/outbox | `Cache-Control: private, no-store`; no `messageId/resultRef/eventId`, result row, replay endpoint, SSE, outbox or push entry |
| 61 | **Safety dependency migration order** | Apply root chat migration without pre-root safety migration; then apply pre-root→root→post-root sequence | Wrong order fails before partial chat schema/policy; correct order succeeds and post-root DM commands call the landed canonical safety primitive |
| 62 | **Block/report command replay** | Exact retry, concurrent retry, then same key with changed target/reason/evidence | Exact retry returns prior safe result; concurrency yields one block transition or one append-only report/audit effect; fingerprint mismatch rejects before mutation |
| 63 | **Text retention boundary** | Advance time; edit up to five times, author soft-delete, moderator hide/restore, then probe hard delete | No TTL/auto-delete/hard purge; current body + restricted revision trail obey DD-92; author tombstone is irreversible; immutable moderation audit remains restricted |
| 64 | **Slice ownership catalog** | Inspect DB/routes after root and after each post-root slice | Root has no command writers; shared send, reaction, own edit/delete, search, moderation, slash, unread-notification and DM lifecycle each appear exactly once in their named owner; no duplicate derivation |
| 65 | **Same-channel reply lifecycle** | Reply to current-visible target; try missing/cross-channel/already-tombstoned target; then tombstone a valid target after reply exists | Only current-visible same-channel target inserts atomically; already tombstoned target rejects. Later tombstone renders target metadata only and never resurrects body/media |
| 66 | **Structured mention immutability** | Mention current channel person/Assistant; forge cross-channel/non-member/unsafe label; probe update path | Server persists immutable resolved target ref + sanitized snapshot atomically; invalid target rejects; no update path exists |
| 67 | **DD-92 exact Unicode reaction desired state** | Set/replace/remove each of `👍|❤️|😂|😮|😢|🙏`; retry/concurrently race; send aliases/arbitrary token | Exactly one row per `(message,person)`; accepted replacement is atomic, same-state/remove-absent is 200-safe, every non-exact value rejects |
| 68 | **DD-95 hide/restore + immutable reason audit** | Capable/non-capable actor targets human club message; try each exact reason, `other` with/without bounded note, non-other with note, replay/mismatch | Exact `chat.message.moderate` required; valid accepted action writes one receipt + one immutable actor/reason/note audit and only changes moderation visibility |
| 69 | **DD-95 exact timed mute** | Apply `1h|24h|7d`; try permanent/arbitrary/client expiry; retry; wait for expiry and skew client clock | Exact `chat.member.mute` + one receipt/audit; DB time denies write until expiry then allows; read unchanged; every other/client-authoritative duration rejects |
| 70 | **Moderation negative surface** | Owner/admin/support/capability holder targets DM, assistant/system message, or requests hard delete/content edit/permanent ban/system message | Generic deny; zero transcript/content disclosure and zero mutation; role label alone confers nothing |
| 71 | **DD-92 own edit boundary** | Edit own human message before/at/after 15m; race edits; attempt sixth edit; edit assistant/system or immutable fields | Only body edits strictly before 15m and at counts 0–4 pass; one prior-body revision per accepted update; author/channel/reply/attachments/mentions unchanged |
| 72 | **DD-86 post policy shared-core enforcement** | Active member sends to `all_members`; role-labeled admin without capability sends to `admins_only`; capability registry is unknown/unavailable | `all_members` succeeds on active membership; `admins_only` requires exact `chat.channel.post_restricted` inside shared writer; every unknown/missing case denies before mutation |
| 73 | **DD-86 creator composite FK/bootstrap** | Create channel with mismatched membership/person/tenant tuples, a correct tuple, client/admin `NULL/NULL`, and exact system bootstrap | Only one active membership tuple persists for actor-created channels; no single-ID/cross-tenant/null creator spoof. `NULL/NULL` passes only the dedicated system-bootstrap path |
| 74 | **Structured Club Assistant mention** | Active member mentions exact `club_assistant` in derived-enabled `all_members`, derived-disabled `admins_only`, and either after a capable toggle; repeat with each tenant/`assistant_ai_kb`/provider/privacy gate false or unknown; ask KB-known, KB-unknown and debt-status questions | Any current channel setting + all-gates-true case may create one idempotent bot query/message; answer is KB-grounded with citation or `no_answer`. Every false/unknown case creates zero query/provider/message; debt-status mention never returns actual ledger amount |
| 75 | **DD-92 author soft-delete** | Author deletes own human message immediately/late/retry; tries restore; moderator restores moderation state; read existing replies/history/search | One irreversible tombstone, no hard delete or body leak; retries safe; neither author nor moderator resurrects content; reply structure remains with tombstone metadata |
| 76 | **DD-92 search scope/vector** | Search with/without channel filter across active/left/blocked/guessed channels; include current, edited, hidden, deleted and revision-only terms | Only current visible authorized bodies match canonical generated PostgreSQL `simple` vector; live authz prevents existence oracle; old revisions/tombstones never match |
| 77 | **Requester-only exclusion from search** | Execute every slash/private Club Bot result then search exact sensitive terms | Zero command/result rows or hits; no requester-only/private bot content enters message/revision/vector index |
| 78 | **DD-94 defaults/preferences** | New DM, direct mention, reply and club channel with no preference; then set `all|mentions|off` | DM/direct mention/reply eligible by default; club defaults `mentions`; each exact mode controls eligibility and arbitrary value rejects |
| 79 | **DD-94 coalesce/read cancellation** | Sau khi DD-94 cài cancellation trigger/function riêng, generate multiple unread messages, update highest cursor, then mark through each cursor before send | One pending unit per `(person,channel,highest_unread_cursor)` carrying its selected delivery kind; DD-94-owned trigger coalesces/cancels read-covered pending rows; shared `mark_read` không có grant hoặc direct DML trên dispatch table; no parallel unread counter |
| 80 | **DD-94 opaque payload/storage** | Inspect DB row, queue, logs, push and digest for text/title/sender/amount/attachment metadata | Only opaque refs/cursors/attempt state + generic copy exist; zero durable content/title/amount snapshot |
| 81 | **DD-94 immediate re-auth** | Revoke club membership, block DM, change preference, invalidate device or advance trust epoch after enqueue and just before provider write | Every false/unknown state cancels with zero provider write; current valid state alone may send |
| 82 | **DD-94 sticky provider outcome** | Provider succeeds, fails retriably, or times out/returns unknown; worker crashes between write and persistence | Same attempt identity is reused where safe; delivered/unknown never creates a second provider send; no duplicate |
| 83 | **DD-94 digest timing enablement** | Timing/config absent, malformed, untested, then verified | Digest remains OFF for absent/malformed/untested configuration; verified enablement uses the same unread/coalesce/re-auth/sticky rules |
| 84 | **DD-95 negative surface + reason/duration contract** | Capability holder targets DM/assistant/system, asks content edit/hard delete/permanent ban/system message, or submits invalid reason/note/duration | Generic deny, zero transcript/content disclosure and zero mutation; mute never changes read access |
| 85 | **Current-channel safe-target disclosure** | Authorized member lists targets; outsider/cross-tenant actor guesses channel; inspect every DTO/cache/log | Only active human members of the already-authorized current club channel return as opaque short-lived `{targetRef,safeLabel}`; zero raw UUID, contact, gender, debt, `pay_code`, PII, global/fuzzy result or membership oracle |
| 86 | **Safe-target consume-time re-authorization** | Issue valid target ref, then change actor/target membership, tenant/channel binding, block/safety or action capability before mention/mute/start-DM; replay from another actor/channel | Every consumer invokes the same resolver and generically denies before message/moderation/DM/audit/notification mutation when any live guard is false or unknown |
| 87 | **Mechanism/API ownership fence** | Inspect slices `1–47` and routes `A1–A21`; call each adapter with invalid session/action/DTO/cache case | Mechanism owners expose zero HTTP; each route has exactly one thin adapter, delegates to one canonical owner, and does not re-derive protected state |
| 88 | **Create group (global)** | Player creates group with title, 2 followers | Group channel `kind='group'`, `tenant_id=NULL`, 3 members (creator + 2), creator is admin |
| 89 | **Create group (tenant-scoped)** | Player creates group within CLB | Group `tenant_id=NOT NULL`, all members have active club membership |
| 90 | **Follow-guard reject** | Add member who has NOT followed actor | Reject `FOLLOW_REQUIRED`; member not added |
| 91 | **Follow-guard with block** | Add member who follows actor but is blocked (DD-55) | Reject `MEMBER_BLOCKED`; block boundary overrides follow |
| 92 | **Group max member limit** | Add 51st member to group (max 50) | Reject `GROUP_MAX_MEMBERS`; concurrent add serialize under channel lock |
| 93 | **Concurrent group member add** | Two transactions add members to a group near max | Channel lock serializes; no over-capacity; exactly correct final count |
| 94 | **Group admin set/unset** | Admin sets another member as admin; unsets admin | Role updated; system message generated |
| 95 | **Last admin leave guard** | Last admin tries to leave group | Reject `LAST_ADMIN_CANNOT_LEAVE`; must set another admin first |
| 96 | **Kick member** | Admin kicks a member | Member removed; system message; kicked user cannot send/receive |
| 97 | **Kick idempotent** | Admin kicks already-removed member | 200 no-op; no duplicate system message |
| 98 | **Group rename** | Admin renames group | Title updated; system message |
| 99 | **Group avatar change** | Admin changes avatar | `group_avatar_url` updated; system message |
| 100 | **Member leave group** | Non-last-admin member leaves | Member removed; system message |
| 101 | **Pin message** | Member pins own message; admin pins any message | Pinned row created; count ≤ 5 |
| 102 | **Pin limit reached** | Pin 6th message in channel | Reject `PIN_LIMIT_REACHED` |
| 103 | **Pin authorization (member)** | Member pins message by someone else | Reject `PIN_NOT_AUTHORIZED` |
| 104 | **Unpin authorization** | Member unpins own pin; admin unpins any | Own pin removed OK; admin unpin any OK; member unpin other’s pin rejected |
| 105 | **Create poll** | Member creates poll with question + 3 options | Poll + message created; options stored in sort_order |
| 106 | **Poll option limit** | Create poll with 11 options; add 11th option later | Reject `POLL_OPTION_LIMIT` |
| 107 | **Poll single-choice vote** | Vote in single-choice poll; then vote for different option | First vote OK; second vote rejected `POLL_SINGLE_CHOICE` (must change vote explicitly) |
| 108 | **Poll multi-choice vote** | Vote for multiple options in multi-choice poll | Multiple votes per person accepted |
| 109 | **Vote on closed poll** | Vote after deadline expired or manual close | Reject `POLL_CLOSED` |
| 110 | **Close poll early** | Creator/admin closes poll before deadline | `closed_at` set; no new votes accepted |
| 111 | **Custom nickname** | Set nickname for another member | Nickname visible only to setter; does not affect identity |
| 112 | **Group RLS (global vs tenant)** | Global group member queries; tenant-scoped group cross-tenant | Global: membership-gated only; tenant: RLS tenant-private + membership |
| 113 | **Send message with session embed (happy path)** | Active member sends message with `embedType='session'` + valid `embedRefId` | Message created with `embed_type`, `embed_ref_id`, `embed_snapshot` (JSONB with BL-DSC-1 whitelist). Body optional (empty string OK) |
| 114 | **Embed — session not found** | Send with `embedRefId` pointing to non-existent session | 422 `CHAT_EMBED_TARGET_NOT_FOUND`; no message created |
| 115 | **Embed — actor has no visibility** | Send with session in a different tenant that actor is not member of (non-public) | 422 `CHAT_EMBED_TARGET_NOT_FOUND`; generic, no existence oracle |
| 116 | **Embed — forged snapshot rejected** | Client includes `embedSnapshot` field in request body | Server ignores client-supplied `embedSnapshot`; always resolves server-side |
| 117 | **Embed — snapshot whitelist** | Send with valid session; inspect snapshot JSONB | Snapshot contains ONLY: `sportKey`, `title`, `startsAt`, `endsAt`, `area`, `priceAmount`, `confirmedCount`, `slotsOpen`, `clubDisplayName`, `hostDisplayName`, `joinPolicy`, `sessionType`, `sessionSlug`. NO `tenant_id`, venue, roster, charge |
| 118 | **Embed — DDL constraint (all-or-nothing)** | Direct INSERT with `embed_type` NOT NULL but `embed_ref_id` NULL | CHECK constraint violation; INSERT rejected |
| 119 | **Embed — DDL constraint (empty message)** | Direct INSERT with `body=''` AND `embed_type` NULL | CHECK constraint violation (`length(body) > 0 OR embed_type IS NOT NULL`); INSERT rejected |
| 120 | **Embed idempotent (duplicate client_msg_id)** | Send same `clientMsgId` with embed twice | Second call returns same message (idempotent); no duplicate embed |

---

## 6. Rollout Plan + Changelog

### Rollout (DD-38/DD-86/DD-91–DD-95 ✅ decision-final; execution still HOLD on readiness dependencies)

Catalog IDs are stable identifiers, not execution order. Runtime work follows explicit hard dependencies:

0. Exact owner-final authority pack đã commit/push tại `90d292d`; primary plan v1.8 đạt `PLAN_READY` closure 12/12. Trước implementation, author packet/manifest/launcher cho slice 1 và đạt strict slice-local `CODE_READY`; không mở worktree từ verdict cấp initiative.
1. Serialize the colliding DB worktrees exactly: `1 chat-definer-role-provisioning → 2 chat-dm-safety-authority-core → 3 dd38-dd86-chat-schema-core → 4 tenant-capability-authority-core`. Slice 4 includes closed DD-56 registry/preset, expiring/revocable grant-read authority, append-only grant audit and fail-closed authorization. Do not run these four in parallel.
2. Land `5 chat-club-channel-lifecycle-core`, then `9 chat-authorized-member-target-read-core`. Slice 9 establishes the only current-channel active-human `{targetRef,safeLabel}` DTO and consume-time resolver before any mention, mute or start-DM consumer.
3. Land `6 chat-club-moderation-core` **dark**, then `7 chat-shared-message-command-core`, then `8 chat-dm-lifecycle-command-core`: exact execution `5→9→6→7→8`. Shared send consumes the target resolver for mentions; moderation consumes it for mute; DM consumes it for start-DM. No consumer invents a lookup or accepts raw UUID authority.
4. Land `10 chat-realtime-unread-core`; then split media as `11 chat-media-upload-scan-core → 12 chat-media-attachment-read-lifecycle`. Land reactions `13`, edit/delete/revisions `14`, then required pre-beta search `15` after its 3/6/7/14 dependencies.
5. Land self/domain mechanisms: `16→17`; independently 18, 20 and 21. Slice 19 may be **authored** as a read-only query over merged `players/memberships/sessions`, but `/sessions|/waitlist` stays OFF until strict current-authority `svc-session-crud`, `svc-session-join-leave`, `svc-waitlist-promotion-core` producer packets and production-shaped data E2E pass.
6. Land slash mechanisms exactly `22 registry → 23 requester-only response → 24/25/26 domain adapters`. Registry owns no private transport/domain formula; response owns no grammar/domain logic; adapters stay thin.
7. Land Assistant/KB `27 storage+config → 28 text ingest → 29 URL and 30 file adapters → 31 generation-CAS index activation → 32 retrieval → 33 bot.ask worker → 34 mention and 35 private thread`. URL/file are source adapters, not alternate indexes. Mention/private surfaces project only canonical worker outcomes.
8. Land notification delivery `36 route integrity → 37 protected subscription → 38 provider attempt`; after accepted F0 design authority, continue `39 PWA shell → 40 registration → 41 display/telemetry → 42 chat unread notification`. Slice 42 owns Chat preference/coalescing/cancellation/reauth, not provider/subscription/client state. DD-88 is not a dependency.
9. Land payment notification `43 lifecycle intent → 44 reminder producer and 45 settled/correction projector → 46 authenticated Inbox/detail → 47 thin payment push`. Push never precedes durable Inbox/detail and never snapshots amount.
10. Land thin HTTP adapters `A1–A21` only after each row's dependency in §3. Mechanism slices `1–47` own zero HTTP.
11. Complete tracked design `F0`, then ship FE `F1–F15` by the dependency table below; no production FE may substitute mock business logic for an absent `A*` route.
12. Enable club-chat beta only after shared send, safe targeting, reactions, edit/delete, search, moderation, slash, realtime/unread/push and observability suites are green. Enable DM only after complete DD-55 safety E2E. Enable Assistant, media, Session commands, Web Push/digest and payment notification only after their explicit provider/producer/config/consent/data gates pass; otherwise keep the affected route OFF.

#### Tracked-design FE rollout

`F0 chat-design-authority-handoff` must persist tracked `design.pen`, receive owner approval and pin token/component/API-state mapping for Chat, Assistant and Notification. All production slices cover `loading|ready|empty|error`, auth loss, keyboard/focus/screen-reader/WCAG contrast and responsive PWA states.

| FE slice | Hard dependency |
|---|---|
| `F0 chat-design-authority-handoff` | Immutable authority pack; no production FE |
| `F1 chat-fe-channel-list-shell` | F0 + A1/A2/A4/A14 |
| `F2 chat-fe-safe-member-target-picker` | F0/F1 + 9/A6 |
| `F3 chat-fe-thread-history-realtime` | F0/F1 + 7/10/A3 |
| `F4 chat-fe-text-composer-send` | F0/F2/F3 + 7/9/22/A3/A6 |
| `F5 chat-fe-requester-command-overlay` | F0/F4 + 22–26/A13 |
| `F6 chat-fe-private-bot-mention` | F0/F3/F5 + 33–35/A14 |
| `F7 chat-fe-message-interactions` | F0/F3 + 13/14/A7/A8 |
| `F8 chat-fe-authorized-search` | F0/F3 + 15/A9 |
| `F9 chat-fe-media-lifecycle` | F0/F3/F4 + 11/12/A10/A11 |
| `F10 chat-fe-safety-moderation` | F0/F2/F3 + 6/8/9/A5/A6/A12 |
| `F11 notification-fe-inbox-payment-detail` | F0 + 17/41/43–47/A18/A19 |
| `F12 assistant-fe-kb-source-manager` | F0 + 27–31/A15/A16 |
| `F13 assistant-fe-config-tone-analytics` | F0 + 27/33/A15 |
| `F14 chat-fe-notification-preferences` | F0 + 42/A17 |
| `F15 web-push-fe-contextual-onboarding-devices` | F0 + 37/39/40/41/A19 |

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-08-12 | v0.27 | **Share Session in Chat (Structured Embed):** Thêm embed columns vào `chat_messages`: `embed_type CHECK IN ('session')`, `embed_ref_id uuid`, `embed_snapshot jsonb` — tất cả all-NULL hoặc all-NOT-NULL (CHECK constraint). Body cho phép rỗng khi có embed (`CHECK length(body) > 0 OR embed_type IS NOT NULL`). Server resolve session, validate actor visibility, snapshot BL-DSC-1 whitelist fields vào JSONB tại insert time — client KHÔNG cung cấp snapshot. API send message nhận optional `embedType` + `embedRefId`. Thêm 6 BE edge cases (#27–32), 8 tests (#113–120), request/response examples. Extensible to `activity`, `tournament`, `club` sau. |
| 2026-08-11 | v0.26 | **Group Chat expansion:** Thêm `kind='group'` (global + tenant-scoped, 3–50 members) với follow-guard (DD-47), multi-pin (max 5/channel với trigger guard), advanced poll/vote (Telegram-style: single/multi choice, anonymous, quiz, deadline, allow add options — với triggers cho single-choice guard, option limit, poll-closed guard), group admin management, group settings (mute, leave, custom nickname). Thêm 14 entry points mới, 5 tables (`chat_pinned_messages`, `chat_polls`, `chat_poll_options`, `chat_poll_votes`, `chat_member_nicknames`), 4 triggers + 4 functions, 25 tests mới (#88–#112). |
| 2026-08-10 | v0.25 | **A-grade upgrade:** thêm Entry points table (12 entries); bump version. Không đổi contract/schema. |
| 2026-08-10 | v0.24 | **Message Forward:** Thêm forward fields vào `chat_messages`: `forward_from_message_id`, `forward_from_channel_id`, `forward_from_author_name`, `forward_from_channel_name`, `forward_from_created_at`. Forward lưu snapshot attribution gốc để hiển thị mà không cần JOIN realtime. Authz: chỉ forward tin mình có quyền đọc; reject tombstone/hidden. Chỉ tạo message mới trong target channel. |
| 2026-07-28 | v0.23 | Re-pin primary plan v1.8 `PLAN_READY` tại immutable authority `90d292d`; thay gate “commit pack” đã đóng bằng exact next gate: author slice-1 artifacts + strict `CODE_READY` trước worktree. No runtime/migration change. |
| 2026-07-28 | v0.22 | Reconcile primary-surface execution topology: bounded mechanism catalog `1–47`, separate thin API `A1–A21` and tracked-design FE `F0–F15`; serialize DB worktrees `1→2→3→4`, then lifecycle→safe current-channel target `5→9`→moderation dark `6`→shared send `7`→DM `8`. Add opaque target/ref privacy + consume-time re-authorization tests, split media/registry/KB/Web Push/payment chains, and distinguish Session read authoring from producer/E2E enablement. Retire active bundled media/slash/notification substrate ownership; Reviewed/not implemented unchanged. |
| 2026-07-28 | v0.21 | Owner-final DD-56/DD-86/DD-92–DD-95: Assistant defaults ON for `all_members`/OFF for `admins_only`, mutable on both behind the full gate; same-channel reply + immutable mentions; exact Unicode reactions; own body edit `<15m`/max five + restricted revisions; irreversible author tombstone; required pre-beta current-visible PostgreSQL `simple` search; ASCII case-insensitive exact eight-command registry; unread-derived generic push/digest with exact preferences/coalescing/cancel/re-auth/sticky attempt and enablement-only timing; club-only exact moderation reasons + `1h|24h|7d` mutes. Semantic freeze adds the missing cross-feature capability-authority branch, makes DD-95 storage/writers a dark prerequisite of shared send, keeps reply/mention atomic in that shared writer, and canonicalizes every slice ID across plan/graph/BE. Requester-only responses use `private, no-store`; Reviewed/not implemented unchanged. |
| 2026-07-28 | v0.20 | Intermediate working-tree snapshot, superseded in full by the exact owner-final v0.21 contract. |
| 2026-07-28 | v0.19 | Historical DD-86/CHT-OQ-2 floor; superseded by owner-final v0.21 for Assistant defaults, interactions, slash, search and notification/digest. |
| 2026-07-27 | v0.18 | Make slice ownership executable: root owns final tables/constraints + pure DM read adapter/RLS/read grants/direct-DML revokes only; pre-root retains safety primitives; shared post-root core owns the single send/history/mark-read path for club+DM, while DM lifecycle core alone owns create/reuse/block/report. Pin exact block/report command idempotency, phase-1 no-purge text retention and ownership tests #62–64. Combined SQL remains a final-target view, not one migration. |
| 2026-07-27 | v0.17 | Mirror DD-91 requester-only `/pay`: exact classifier fence before normal message insert; authenticated sync `private,no-store` command endpoint; human-DM tenant-null one/many/none club resolution with actor+DM+tenant+command-bound opaque selector; zero bot/result ref/row/SSE/outbox/push/history/unread; canonical Player View source. Correct dependency graph to safety pre-root → final chat schema → DM command core; add tests #55–61. Draft/not implemented remains. |
| 2026-07-22 | v0.16 | Mirror DD-86 proposal có điều kiện: final multi-channel schema delta, exact-one default lifecycle, atomic provisioning, DD-56 capability commands, actor-scoped command idempotency, Assistant conjunction, tests #46–54 và root-migration sequencing. Migration HOLD tới owner decision; spec Draft/not implemented. |
| 2026-07-19 | v0.15 | **Template v2.30/v2.33 uplift:** thêm §2 Migration & Rollback (`chat_*` chưa vào canonical — DD-38 pending, migration mới monotonic; DROP baseline = ❌ NEVER), §3 Request/Response Examples (DD-60 envelope) + Idempotency, §4 Caching Strategy + Security Checklist. Derivative/editorial — không đổi contract. |
| 2026-07-19 | v0.14a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-17 | v0.14 | **Executable parent-key closure:** migration chat nay bắt buộc chạy `ALTER TABLE memberships ADD CONSTRAINT memberships_id_person_tenant_uq UNIQUE(id, person_id, tenant_id)` trước khi tạo `chat_members/messages`; thêm schema-parity và cross-person/cross-tenant FK regression để các composite FK không còn trỏ tới một candidate key chỉ tồn tại trong comment. |
| 2026-07-17 | v0.13 | **DD-55 enforceability closure:** pure read predicate gates DM RLS/list/SSE; guarded `send_chat_message` and `mark_read` resolve current membership/peer and call canonical safety core; runtime `app` loses direct message INSERT; all definer ownership/grants and blocked-read/realtime/concurrent-idempotency tests pinned. Club `left` is denied at RLS/RPC boundaries. |
| 2026-07-17 | v0.12 | **DD-55 bootstrap closure:** `create_dm` calls canonical fail-closed `assert_dm_allowed` before create/reuse; pins direct-RPC parity and existing-DM reuse tests. |
| 2026-07-10 | v0.1 | Draft khởi tạo (DD-38 🟡): schema đề xuất `chat_channels/messages/members`, RLS tenant cho club + person-self cho DM, SSE reuse DD-07, idempotency `client_msg_id`, anti-spam; note trợ lý DD-19/20 tái dùng ở P7; không bridge kênh ngoài (CO-7). |
| 2026-07-10 | v0.2 | **DD-38 ✅ + hard-constraint (review fix):** DM guard nay là **DDL thật** — DEFERRABLE constraint trigger đảm bảo trạng thái cuối = ĐÚNG 2 member khớp `dm_key` (không chỉ chặn insert thứ 3), delete guard (member bất biến, soft-close qua `archived_at`). Bind cứng bằng composite FK: `message/member.tenant_id` = tenant channel `(channel_id,tenant_id)→chat_channels(id,tenant_id)`, và author/member membership khớp `(membership_id,person_id,tenant_id)→memberships`. RLS child (`chat_members`/`chat_messages`) policy TƯỜNG MINH + helper SECURITY DEFINER (chống đệ quy RLS). |
| 2026-07-10 | v0.3 | **Đóng 5 đường fail-open (review):** (1) trigger `chat_bind_tenant` set/assert `tenant_id := channel.tenant_id` (`IS NOT DISTINCT FROM`) — club-child không thể NULL "giả DM" (FK MATCH SIMPLE không đủ); (2) deferred exactly-2 gắn trên **cả `chat_channels`** — DM 0-member cũng bị bắt ở COMMIT; (3) `SELECT … FOR UPDATE` khoá channel row trong insert guard — chống race 2 txn cùng thấy count=1; (4) helper đổi thành `chat_current_is_member(channel)` chỉ dùng **current person** + `REVOKE PUBLIC` / `GRANT app` — không còn membership oracle; (5) policy `chat_messages` thêm `WITH CHECK author_person_id = app.person_id` — chống ghi message mạo danh. |
| 2026-07-11 | v0.4 | **Round-2 fix (review):** (a) constraint trigger tách 2 function theo bảng (`chat_dm_two_from_members`/`_from_channel` + helper `chat_assert_dm_two`) — bỏ `COALESCE(NEW.channel_id, NEW.id)` gây lỗi runtime khi trigger chạy trên `chat_channels`; (b) thêm `create_dm()` SECURITY DEFINER (bootstrap DM vì RLS chặn chính bước tạo member đầu) + note mutation channel/member qua SECURITY DEFINER RPC; (c) club `WITH CHECK` nay bắt buộc `author_type='person' AND author = app.person_id` (bỏ escape `author_type<>'person'`) — role app không tự tạo assistant/system message; (d) thêm DB CHECK `assistant/system ⇒ author_person_id IS NULL`; (e) test §5 thêm case 13–18 (DM bootstrap, shared-trigger execution, assistant/system spoof, author spoof, nullable-tenant, DM immutable). |
| 2026-07-11 | v0.5 | **Round-3 fix (review) — SECURITY DEFINER contract enforce được:** (a) tạo definer role **`chat_definer NOLOGIN BYPASSRLS`** + `ALTER FUNCTION chat_current_is_member / create_dm OWNER TO chat_definer` — vì bảng FORCE RLS áp cho cả owner, `SECURITY DEFINER` một mình KHÔNG bypass (runtime `app`/`readonly` = NOBYPASSRLS → helper đệ quy + `create_dm` vẫn bị chặn); (b) **pin quyền bảng**: `REVOKE INSERT/UPDATE/DELETE ON chat_channels, chat_members FROM app` + `GRANT SELECT` (+ `UPDATE(last_read_at)`); `chat_messages`: `GRANT SELECT, INSERT`, revoke UPDATE/DELETE → "mutation qua RPC" là enforce chứ không prose; (c) test §5 thêm case 19–22 (create_dm dưới FORCE RLS role app thật, direct DML bị chặn, helper không đệ quy, assistant/system direct insert bị chặn). |
| 2026-07-11 | v0.6 | **Round-4 fix (review):** (a) **`GRANT SELECT,INSERT,UPDATE,DELETE ON chat_channels,chat_members TO chat_definer`** (+ SELECT chat_messages) — BYPASSRLS KHÔNG thay table grant; role mới không có privilege mặc định → thiếu grant thì helper/`create_dm` `permission denied`; (b) bỏ `GRANT UPDATE(last_read_at) ON chat_members TO app` (cho member sửa read-state của người khác trong cùng DM/tenant) → thay bằng **`mark_read(channel)` SECURITY DEFINER** khoá theo `app.person_id`; `app` không còn UPDATE trên chat_members; (c) sửa test 19 (bỏ nhánh "caller ∉ cặp" bất khả — `create_dm` luôn dựng cặp từ current person; thay bằng `create_dm(self/NULL)` → reject) + thêm test 23 (thiếu grant chat_definer) & 24 (read-state isolation qua mark_read). |
| 2026-07-11 | v0.7 | **Round-5 fix (review):** (a) **`chat_definer BYPASSRLS` phải PRE-PROVISION ở tier SUPERUSER** (không phải `DATABASE_URL_MIGRATION` DDL-owner): `CREATE ROLE … BYPASSRLS` chỉ superuser đặt được + `GRANT chat_definer TO migration_owner` để migration `ALTER … OWNER TO` được; migration DDL-owner chỉ tạo function + ALTER OWNER + GRANT bảng; thiếu pre-provision → migration FAIL sớm (không im lặng chạy NOBYPASSRLS). (b) **Test 25: chạy provisioning bằng migration role THẬT** (không superuser) để bắt gap này (test harness đừng dùng superuser che). (c) Sửa test **13** (vẫn còn "caller không thuộc cặp" bất khả) và test **20** (`UPDATE(last_read_at) OK` → nay đã revoke, read-state chỉ qua `mark_read`). |
| 2026-07-11 | v0.8 | **Round-6 fix (review, PG16 chính xác):** (a) **`ALTER FUNCTION … OWNER TO chat_definer` cần owner mới có `CREATE ON SCHEMA public`** — PG15+/PG16 KHÔNG cấp `CREATE public` mặc định → `GRANT chat_definer TO migration_owner` (SET ROLE) là **chưa đủ**; thêm bracket `GRANT CREATE ON SCHEMA public TO chat_definer` → ALTER OWNER (cả 3) → `REVOKE CREATE` (giữ USAGE, least-privilege). (b) role-creation block nay **idempotent** (`DO … IF NOT EXISTS`, không `CREATE ROLE` thuần), + wording PG16 đúng: gán BYPASSRLS cần **superuser hoặc role đã có BYPASSRLS (+CREATEROLE)**. (c) test 26 (ALTER OWNER thiếu CREATE ON SCHEMA → FAIL) + test 27 (idempotent re-run). |
| 2026-07-11 | v0.9 | **Round-7 fix (review, SQL chạy được thật):** (a) **`GRANT/REVOKE CREATE ON SCHEMA public` nay là câu lệnh THẬT, đúng thứ tự** — gom 3 `ALTER FUNCTION … OWNER` vào **BLOCK CHUYỂN OWNER** cuối, bracket bởi GRANT CREATE (trước ALTER đầu) và REVOKE CREATE (sau ALTER cuối); bỏ ALTER OWNER rải rác inline (trước đây chạy TRƯỚC grant → copy/chạy dưới migration role sẽ fail). (b) **DO-block kiểm ATTRIBUTE, không chỉ existence**: nếu chat_definer tồn tại với LOGIN/NOBYPASSRLS/SUPERUSER/CREATEROLE → **RAISE fail-closed** (LOGIN+BYPASSRLS nguy hiểm khi nhận table grants); kèm option chuẩn hoá `ALTER ROLE`. (c) test 27 mở rộng: attribute sai → fail-closed. |
| 2026-07-11 | v0.10 | **Round-8 fix (review, attribute check ĐỦ BỘ):** DO-block trước chỉ kiểm login/super/bypassrls/createdb/createrole → role thừa **`INHERIT`** hoặc **`REPLICATION`** vẫn lọt. Thêm `rolinherit, rolreplication` vào `SELECT` + điều kiện `ELSIF` (inherit phải FALSE, replication phải FALSE); `CREATE ROLE`/normalize thêm **`NOINHERIT NOREPLICATION`**; RAISE log đủ 7 field. Test 27 mở rộng phủ INHERIT/REPLICATION. |
| 2026-07-16 | v0.11 | **Full propagation DD-55 (decisions v1.37):** open-DM hard gate (block/report/per-sender+pair limits/abuse audit), shared pre-send core, host/support DM denial, and complete private media upload/scan/moderation/ready-only attach/signed access/deletion/orphan lifecycle. Added APIs, errors, rollout gates and tests 28–36. |
