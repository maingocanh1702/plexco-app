# Feature: Share Activities — Product/UX Spec

> **Canonical phase:** P4.3 (Share Session) · Sau P4 (Activity Card) · P4+ (Feed/Kudos)
> **Track:** 📣 Share & Social
> **Version:** 1.0 · 2026-08-12
> **Status:** Draft
> **Implementation:** Not started · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)
> **Prerequisites:** P2 session management · P4 web auth · P4 sync · DD-12 marketplace guarded view (P4.3) · DD-42 attendance · DD-47/48 follow/visibility · DD-55 block/report
> **Tài liệu liên quan:** `../../product/BRD.md` FR-3 · `../../product/PRD.md` FLOW 12/14 · `../../standards/decisions.md` **DD-73 · DD-74 · DD-75 · DD-76 · DD-77 · DD-78** · `../../decisions/analysis/dd-73-78-share-activity-analysis.md` · `feature_marketplace_discovery.md` · `feature_user_settings.md` (DD-47/48) · `feature_player_view.md` · `../BE/feature_share_activities_tech.md`

> **3 phát hiện quan trọng (DD-73–78 analysis):**
> 1. Strava activity = single-owner. Plexco session = **tenant-owned, multi-participant** → không map 1-1.
> 2. Gắn tên CLB lên card cá nhân = **rò roster ngược** → phase-1 **KHÔNG attribution**.
> 3. Feed sống ở global plane, activity source sống ở tenant plane → buộc đọc qua **projection**.

---

## 1. Mô tả

Feature cho phép user **chia sẻ hoạt động thể thao** tương tự Strava, bao gồm:

1. **Share Session Link (DD-73):** Share session **đang mở** cho người khác xem/tham gia — URL public + OG preview card + ảnh mặc định do Plexco render.
2. **Activity Card (DD-74/75):** Sau khi session kết thúc, player đã tham dự (attendance=`present`) có thể **publish activity card** — bản tóm tắt hoạt động cá nhân dạng card + ảnh share.
3. **Feed (DD-76):** Xem activity cards của người mình follow — fan-in trên global plane. **Chỉ build sau product-evidence gate.**
4. **Kudos (DD-77):** React (thả tim) lên activity card. **Cùng evidence gate với DD-76.**
5. **Share Image (DD-78):** Server-rendered ảnh template cho session card và activity card — download PNG hoặc share URL kèm OG. Không upload phase-1.

### Entry points

| Entry | Route / Surface | Actor | Mô tả |
|-------|----------------|-------|-------|
| Session detail → Share button | `/session/<slug>` → share sheet | Player/Host | Share session link + OG card |
| Session share landing | `/session/<slug>` (public) | Anyone (incl. guest) | OG preview + Join CTA |
| Activity publish flow | `/me/activities/<id>/publish` | Player (verified Person-self) | Draft → chọn audience → publish |
| Activity card public view | `/a/<slug>` | Anyone | Public activity card + kudos |
| Activity card follower view | In-feed/direct link (auth) | Follower | Follower-only card view |
| Feed tab | `/feed` hoặc Home → Feed section | Player (auth) | Activity cards từ followees |
| Share image download | Card → "Tải ảnh" button | Player | Download PNG template |
| Share to external | Card → Share sheet (Web Share API) | Player | Share URL + OG card to Zalo/Messenger/etc |
| Bot → share session | Messenger/Zalo action | Player/Host | Share link trong chat |
| Notification → activity | Push/in-app → deep link | Player | Navigate tới card |

### Bất biến

**Share Session (DD-73):**

- Share link **KHÔNG phải capability** — hoàn toàn tách khỏi invite token DD-44. Share link chỉ mở nội dung đã public.
- OG renderer **CHỈ** đọc guarded public view (`public_session_share_v`). **KHÔNG BAO GIỜ** đọc bảng canonical `sessions`.
- CTA trên landing **KHÔNG** cấp quyền join. Join service phải revalidate live `visibility/status/capacity/join_policy/eligibility`.
- Card chỉ chứa đúng **BL-DSC-1 whitelist**: sport, time, area, price, confirmed_count, slots_open, club display name, host display name, join_policy + session-policy fields. **CẤM:** exact venue (DD-06), roster, co-participant, tiền/charge/nợ, SĐT/email, gender người chơi (gender_restriction = session policy, được phép), attendance/reliability, organize/score.
- Session cancel/private/close → **fence deny ngay** (cùng source transaction), landing/image trả 404 trước projector chạy.
- `share_ref` là **opaque attribution ref**, không capability, không PII, TTL bounded.

**Activity Card (DD-74/75):**

- Activity = **read model** derive từ `players ⋈ sessions` (+ DD-42 attendance). **KHÔNG** tạo fact table mới.
- Chỉ verified **Person-self** publish khi session ended + attendance=`present`. Client-supplied `person_id`/`player_id` **không phải** authority.
- Phase-1: **KHÔNG gắn tên CLB** (rò roster ngược), **KHÔNG hiện co-participant** (DD-48 #5 mở), **KHÔNG caption/free-text**.
- Activity mới tạo ra = `draft`. User chọn `followers|public` khi publish — **KHÔNG auto-publish**.
- `persons.display_name` là nguồn duy nhất cho tên hiển thị trên card. Không fallback sang membership alias.
- Revoke = permanent tombstone slug + 404 mọi version. **Không tự republish** khi source eligible lại. Publish confirm phải nói rõ: screenshot/download bên thứ ba không thu hồi được.

**Feed (DD-76):**

- Fan-in trên **global plane** — **KHÔNG** query bảng tenant-scoped (HR1).
- Audience tại read time: `public` → ai cũng thấy; `followers` → chỉ `person_follows.status='accepted'`.
- Block (DD-55) loại **hai chiều** — dùng canonical `chat_blocks`.
- **Product-evidence gate:** chỉ build sau khi DD-73/74/75 có baseline thật (eligible activities/tuần, publish rate, follow liquidity, feed non-empty rate).

**Kudos (DD-77):**

- Ship **kudos only**, **defer comment** — comment cần DD-55 stack + OQ moderation mới cho global-plane.
- Explicit add/remove idempotent; actor resolve qua guarded visibility path.

**Share Image (DD-78):**

- Server-rendered template — **KHÔNG upload phase-1** (EXIF-GPS phá DD-06, moderation ảnh công khai, storage abuse).
- Renderer chỉ đọc guarded snapshot (whitelist), **KHÔNG** query canonical.
- **Tách hẳn** khỏi media store DD-55 (namespace/credential/endpoint).
- Template system: design tokens + sport variants; generic fallback cho unknown sport.
- Public image URL = opaque ref, authorization-before-cache, private origin.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| SHR-UC-1 | Host/Player | Tap "Share" trên session detail (session open + public) | Share sheet hiện: Copy link, Share to Zalo/Messenger, Download ảnh |
| SHR-UC-2 | Anyone (guest) | Mở share link `/session/<slug>` | Landing page: OG preview card + session info (whitelist) + Join CTA |
| SHR-UC-3 | Player (verified, attended) | Xem activity card draft sau session kết thúc | Draft card hiện: thông tin buổi chơi + preview ảnh + "Publish" button |
| SHR-UC-4 | Player | Publish activity card → chọn audience (followers/public) | Card published, slug minted (nếu public), ảnh rendered, share URL available |
| SHR-UC-5 | Player | Đổi audience public → followers | Slug tombstoned, public image purged, card chỉ visible cho followers |
| SHR-UC-6 | Player | Revoke activity card | Permanent: slug tombstone 404, mọi image version 404. Không tái publish |
| SHR-UC-7 | Player (auth) | Browse feed | Activity cards từ followees, keyset pagination (published_at, card_id) |
| SHR-UC-8 | Player | Kudos (thả tim) trên activity card | `activity_reactions` row created; count +1; idempotent |
| SHR-UC-9 | Player | Remove kudos | Row deleted; count -1; idempotent |
| SHR-UC-10 | Player | Download share image (session card hoặc activity card) | PNG file downloaded (metadata stripped, raster only) |
| SHR-UC-11 | System | Session metadata correction (host sửa title/area) | Activity cards re-project: `card_version` tăng, `published_at` giữ nguyên (không boost feed) |
| SHR-UC-12 | System | Attendance changed present→no_show | Auto-revoke: fence raised, card/image/slug deny ngay |
| SHR-UC-13 | Player | Share activity card URL ra Zalo/Messenger | URL kèm OG card (title, sport, area, tên player, ảnh template) |
| SHR-UC-14 | Player | Mở activity card của người khác (public) | Activity card view: info + kudos count + kudos action |
| SHR-UC-15 | Player (private profile) | Publish activity card `public` | Card public cho mọi người **nhưng** KHÔNG mở profile route/aggregate |

### Flow diagram — Publish Activity Card

```
Player (verified Person-self)
  │
  ├─ 1. Session ended? ──No──→ ❌ "Chưa kết thúc"
  │         │
  │        Yes
  │         │
  ├─ 2. Attendance = present? ──No──→ ❌ "Chưa xác nhận tham dự"
  │         │
  │        Yes
  │         │
  ├─ 3. Draft card tạo (hoặc đã tồn tại)
  │         │
  ├─ 4. Player preview card + ảnh template
  │         │
  ├─ 5. Chọn audience:
  │         ├─ "Mọi người" (public)
  │         └─ "Người theo dõi" (followers)
  │         │
  ├─ 6. Confirm publish (cảnh báo: screenshot bên thứ ba không thu hồi được)
  │         │
  ├─ 7. API: publish intent → 202/PUBLISHING
  │         │
  ├─ 8. Projector: render snapshot + image → CAS activate card + slug
  │         │
  └─ 9. Client: poll/realtime → share URL available → share sheet
```

### Flow diagram — Share Session Link

```
Host/Player (session detail)
  │
  ├─ 1. Session open + public? ──No──→ Share button disabled/hidden
  │         │
  │        Yes
  │         │
  ├─ 2. Tap "Share" → share sheet
  │         ├─ Copy link: `/session/<slug>`
  │         ├─ Share to Zalo/Messenger (Web Share API)
  │         └─ Download ảnh (PNG template)
  │
  └─ 3. Recipient opens link → landing page (guarded view)
            ├─ Session available → info + Join CTA
            └─ Not available → generic "không khả dụng" (không tiết lộ tồn tại)
```

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|------------------|
| 1 | Security | Share link cho session private | Share button **ẩn** cho session private. Private session chỉ share qua invite link (DD-44) |
| 2 | Security | OG crawler truy cập session đã cancel/private | Guarded view + fence → fixed 404 trước projector. Crawler nhận generic fallback |
| 3 | Security | Activity card chứa exact venue | ❌ NEVER — chỉ `area`-level (DD-06), kể cả hậu sự kiện |
| 4 | Security | Activity card chứa tên CLB | ❌ NEVER phase-1 — rò roster ngược. Dual-consent = đích đến tương lai |
| 5 | Security | Activity card chứa co-participant/đồng đội | ❌ NEVER phase-1 — DD-48 #5 vẫn mở. B publish card B ≠ consent xuất hiện trên card A |
| 6 | Security | Activity card chứa tiền/charge/nợ | ❌ NEVER — activity card cấm mọi money data. Session card chỉ `price_amount` từ BL-DSC-1 |
| 7 | Privacy | Player private profile publish card public | Card public nhưng **KHÔNG** mở profile route/aggregate/card khác. Narrow per-card override |
| 8 | Privacy | Unfollow sau khi thấy followers-only card | Card **biến mất** ở lần read kế. Không snapshot follower list |
| 9 | Data Integrity | Host sửa attendance present→no_show sau publish | Auto-revoke: fence raised cùng transaction, card/slug/image deny ngay. Không tự republish |
| 10 | Data Integrity | Session cancelled sau player publish activity | Fence `activity_card×session` raised khi `cancelled` (KHÔNG khi `closed`). Card auto-revoke |
| 11 | Data Integrity | Source correction (session metadata) sau publish | Projector reconcile current sources, `card_version` tăng, `published_at` giữ nguyên |
| 12 | Concurrency | Publish + revoke race | `publication_version` monotonic; worker serialize theo source key, re-read current locked state |
| 13 | Concurrency | Two corrections arrive out-of-order | Worker re-read current canonical dưới lock; duplicate fingerprint = no-op; version regression = integrity fault |
| 14 | Security | Ảnh share chứa malicious text (XSS/bidi/control chars) | Renderer: NFC normalize, strip control/bidi, context-escape, raster-only PNG output |
| 15 | Security | Direct object URL cho image (bypass auth gate) | Object store private-to-origin; mọi fetch qua guarded origin gate. Direct URL ❌ NEVER |
| 16 | Security | Old image version still cached after revoke | Authorization-before-cache; gate 404 trước simulated cache hit. CDN purge best-effort |
| 17 | Security | `share_ref` brute force | Opaque, TTL bounded, không capability, không mở field/quyền. Rate-limit analytics endpoint |
| 18 | Data Integrity | Person merge → duplicate activity cards | Re-parent `person_id`; chỉ collapse nếu deterministic source key trùng thật. Lock + canonicalize |
| 19 | UX | Session closed (bình thường kết thúc) | Fence **KHÔNG** raise cho `closed` — `closed` là nguồn eligible của DD-74. Share landing 404 (projector đã xoá marketplace row) nhưng activity card vẫn valid |
| 20 | UX | Player chưa set `persons.display_name` | Card **KHÔNG** project (fail-closed). Không fallback sang membership alias. CTA: "Cập nhật tên hiển thị" |

---

## 3. Screens & States

### Screen 1: Session Share Landing (`/session/<slug>`)

**Actor:** Anyone (guest/authenticated)
**Trigger:** Mở share link từ Zalo/Messenger/browser

| State | Mô tả |
|-------|-------|
| **Loading** | Skeleton: card shape + CTA placeholder |
| **Ready** | OG preview card: sport icon, title, time, area, price, confirmed/slots, club name, host name. Join CTA button. Plexco branding |
| **Empty** | N/A — URL hoặc có session hoặc không |
| **Error** | Generic "Kèo này không còn khả dụng" — cùng response cho session không tồn tại, private, cancelled, expired. **KHÔNG** tiết lộ session tồn tại hay không |

**Data source:** Guarded view `public_session_share_v` (anti-join `public_projection_fences`)
**CTA behavior:** Join → resolve target server-side → re-check live eligibility → cross-club join flow hoặc in-club join

### Screen 2: Session Share Sheet (Overlay)

**Actor:** Host/Player trên session detail
**Trigger:** Tap "Share" button (chỉ hiện cho session `open` + `public`)

| State | Mô tả |
|-------|-------|
| **Loading** | N/A (local UI overlay) |
| **Ready** | Options: "Copy link" · "Share to Zalo" · "Share to Messenger" · "Download ảnh" · "More..." (Web Share API). Preview card thumbnail |
| **Empty** | N/A |
| **Error** | "Không thể tạo link chia sẻ" + retry CTA |

### Screen 3: Activity Card Draft / Publish

**Actor:** Player (verified Person-self, session ended, attendance=`present`)
**Trigger:** Notification "Buổi chơi đã kết thúc" → CTA hoặc `/me` → sessions → completed

| State | Mô tả |
|-------|-------|
| **Loading** | Skeleton: card template + controls |
| **Ready (Draft)** | Preview card: sport icon/palette, `played_on`, area, duration, player name. Audience picker: "Mọi người" / "Người theo dõi". "Publish" primary CTA. "Tải ảnh" secondary. Cảnh báo text: "Sau khi chia sẻ, screenshot bên thứ ba không thu hồi được" |
| **Ready (Published)** | Card + status badge "Đã chia sẻ" + audience label. Actions: "Đổi đối tượng" · "Tải ảnh" · "Thu hồi". Share URL. Kudos count (nếu public) |
| **Ready (Publishing)** | Card + spinner + "Đang xử lý..." — chờ projector render + CAS. Không hiện share URL |
| **Empty** | N/A — luôn có data nếu eligible |
| **Error (Not eligible)** | "Bạn chưa được xác nhận tham dự buổi này" + CTA liên hệ host. Hoặc "Buổi chơi chưa kết thúc" |

### Screen 4: Activity Card Public View (`/a/<slug>`)

**Actor:** Anyone
**Trigger:** Mở public activity card link

| State | Mô tả |
|-------|-------|
| **Loading** | Skeleton: card + kudos area |
| **Ready** | Activity card: sport icon/palette, played_on, area, scheduled_duration, player display_name. Ảnh template (server-rendered). Kudos count + button (nếu auth). Share CTA. Plexco branding + download CTA |
| **Empty** | N/A |
| **Error** | Fixed generic 404 "Hoạt động này không còn khả dụng" — cùng response cho slug không tồn tại, tombstoned, fenced, revoked, followers-only |

### Screen 5: Feed (`/feed`)

**Actor:** Player (authenticated)
**Trigger:** Home → Feed tab hoặc `/feed`

| State | Mô tả |
|-------|-------|
| **Loading** | Skeleton: 3 card placeholders |
| **Ready** | Timeline cards từ followees, keyset pagination. Mỗi card: player avatar placeholder, name, sport, played_on, area, ảnh template. Kudos count + button. Tap → full card view |
| **Empty** | Icon 🏃 + "Chưa có hoạt động nào" + "Tìm người theo dõi" CTA (→ discover users) |
| **Error** | "Không thể tải bảng tin" + retry CTA |

**Filtering:** Không lọc — feed chronological by `(published_at, card_id)`. Correction giữ nguyên `published_at` (không boost).
**Pagination:** Infinite scroll, keyset cursor, 20 items/page.

### Screen 6: Share Image Preview

**Actor:** Player
**Trigger:** "Tải ảnh" trên session card hoặc activity card

| State | Mô tả |
|-------|-------|
| **Loading** | "Đang tạo ảnh..." + spinner |
| **Ready** | Full-size preview image (PNG, sport-themed template). "Tải về" primary CTA. "Chia sẻ" secondary (Web Share API) |
| **Empty** | N/A |
| **Error** | "Không thể tạo ảnh, thử lại sau" + retry CTA |

**Template elements (session card):** Sport icon/gradient, session title, time, area, price, confirmed_count/slots, club display name, host display name, Plexco logo + CTA.
**Template elements (activity card):** Sport icon/gradient, player display_name, played_on, area, scheduled_duration, Plexco logo + CTA.

### State Coverage Matrix

| Screen | Loading | Ready | Error | Empty |
|--------|---------|-------|-------|-------|
| Session Share Landing | ✅ Skeleton | ✅ OG card + CTA | ✅ Generic 404 | N/A |
| Session Share Sheet | N/A (local) | ✅ Share options | ✅ Retry CTA | N/A |
| Activity Card Draft/Publish | ✅ Skeleton | ✅ Draft / Published / Publishing | ✅ Not eligible | N/A |
| Activity Card Public View | ✅ Skeleton | ✅ Card + kudos | ✅ Generic 404 | N/A |
| Feed | ✅ Skeleton (3 cards) | ✅ Timeline + pagination | ✅ Retry CTA | ✅ "Tìm người theo dõi" |
| Share Image Preview | ✅ Spinner | ✅ Full-size + download | ✅ Retry CTA | N/A |

---

## 4. Domain Model

### Shareable entity types

| Entity | Share type | Phase | Source |
|--------|-----------|-------|--------|
| **Session** (pre-event) | Share link + OG card + image | P4.3 (DD-73) | `public_sessions` guarded view |
| **Activity** (post-event) | Publish card + slug + image | Sau P4 (DD-74/75) | `players ⋈ sessions` + DD-42 |
| Tournament | URL public `/tournament/<slug>` | P4+ (DD-82) | `public_tournaments` — share contract TBD |
| Club | URL public `/club/<slug>` | P4+ (DD-83) | Public club info — share contract TBD |
| User profile | URL public `/user/<handle>` | P4+ (DD-83/84) | Public profile whitelist — share contract TBD |

> **Scope v1:** Chỉ Session + Activity có full share contract. Tournament/Club/Profile có URL public (DD-83) nhưng share card/image contract là additive slice sau.

### Tables (entities tham gia feature)

#### `player_activity_shares` — Tenant-scoped, RLS

Ý định publish của player. Hang off `players` (same-tenant composite FK).

| Column | Type | Mô tả |
|--------|------|-------|
| `id` | UUID PK | |
| `tenant_id` | UUID NOT NULL FK | Same-tenant |
| `session_id` | UUID NOT NULL FK | Source session |
| `player_id` | UUID NOT NULL FK | Source player |
| `person_id` | UUID NOT NULL FK | Verified Person |
| `publication_state` | TEXT NOT NULL CHECK (`draft`/`published`/`revoked`) | Intent |
| `audience` | TEXT CHECK (`followers`/`public`) | Chỉ khi published |
| `publication_version` | INT NOT NULL DEFAULT 1 | Monotonic per-share |
| `published_at` | TIMESTAMPTZ | Khi publish lần đầu |
| `revoked_at` | TIMESTAMPTZ | Khi revoke |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |

**Constraints:** `UNIQUE(tenant_id, player_id)` — một share per player per session (via player FK).

#### `person_activity_cards` — Global Protected

Snapshot do projector sở hữu. Không grant `readonly`/`app`.

| Column | Type | Mô tả |
|--------|------|-------|
| `card_id` | UUID PK | |
| `person_id` | UUID NOT NULL | Actor |
| `card_state` | TEXT NOT NULL CHECK (`published`/`revoked`) | Global state (tách khỏi tenant intent) |
| `audience` | TEXT NOT NULL CHECK (`followers`/`public`) | |
| `source_tenant_id` | UUID NOT NULL | Internal ref — KHÔNG public |
| `source_session_id` | UUID NOT NULL | Internal ref |
| `source_player_id` | UUID NOT NULL | Internal ref |
| `source_share_id` | UUID NOT NULL | Internal ref |
| `applied_publication_version` | INT NOT NULL | Version đã apply |
| `source_fingerprint` | TEXT NOT NULL | HMAC normalized allowlisted inputs |
| `projection_schema_version` | INT NOT NULL | Schema version |
| `snapshot_hash` | TEXT NOT NULL | Hash of rendered content |
| `card_version` | INT NOT NULL DEFAULT 1 | Tăng mỗi correction |
| `snapshot` | JSONB NOT NULL | Whitelist fields only |
| `published_at` | TIMESTAMPTZ NOT NULL | Giữ nguyên qua correction |
| `updated_at` | TIMESTAMPTZ NOT NULL | |

**Constraints:** `UNIQUE(source_tenant_id, source_player_id)`, `UNIQUE(source_tenant_id, source_share_id)`.
**No `draft` row:** projector chỉ tạo row khi publish.

#### `activity_card_slugs` — Global Protected

Registry URL: tombstone-on-revoke, detach-on-card-delete.

| Column | Type | Mô tả |
|--------|------|-------|
| `slug_hash` | BYTEA PK | Domain-separated hash — raw slug KHÔNG lưu at-rest |
| `card_id` | UUID NULLABLE FK | NULL khi tombstoned + detached |
| `state` | TEXT NOT NULL CHECK (`active`/`tombstoned`) | |
| `created_at` | TIMESTAMPTZ NOT NULL | |
| `tombstoned_at` | TIMESTAMPTZ | |

**Constraints:** Partial unique `(card_id) WHERE state='active'` — tối đa 1 active slug per card.
**Invariant:** `state='active' ⇒ card_id IS NOT NULL`.

#### `public_projection_fences` — Global Protected, denial-only

Safety fence cho immediate deny trước projector async convergence.

| Column | Type | Mô tả |
|--------|------|-------|
| `surface` | TEXT NOT NULL | `session_share` / `activity_card` |
| `target_kind` | TEXT NOT NULL | `session` / `activity_share` / `person` / `tenant` |
| `target_id` | UUID NOT NULL | |
| `fence_token` | UUID NOT NULL | Random, CAS-clear by projector |
| `deny_scope` | TEXT NOT NULL CHECK (`public`/`all`) | |
| `reason` | TEXT NOT NULL | Enum đóng |
| `created_at` | TIMESTAMPTZ NOT NULL | |

**PK:** `(surface, target_kind, target_id)`.
**Invariant:** Source mutation raise/replace token; projector CAS-clear exact token sau convergence.

#### `activity_reactions` — Global Protected

Kudos store. Không grant `readonly`/`app`.

| Column | Type | Mô tả |
|--------|------|-------|
| `card_id` | UUID NOT NULL FK → `person_activity_cards` | |
| `person_id` | UUID NOT NULL | Actor |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |

**PK:** `(card_id, person_id)`.
**Invariant:** Add/remove idempotent. Block (DD-55) gỡ/ẩn hai chiều.

### Activity card snapshot fields (v1)

| Field | Source | Public |
|-------|--------|--------|
| `sport_key` | `sessions.sport_key` | ✅ |
| `played_on` | `sessions.starts_at` (date only, KHÔNG giờ chính xác) | ✅ |
| `area` | `sessions.area` (DD-06 level) | ✅ |
| `scheduled_duration_minutes` | `ends_at - starts_at` (KHÔNG phải thời lượng thực chơi) | ✅ |
| `activity_display_name` | `persons.display_name` (sanitized + preview confirmed) | ✅ |

**v2 (khi DD-61/62 land, cần amend DD-64):** + `matches_played`, `sets_won`, `sets_lost`, `win_rate`.

### Permission matrix

| Action | Actor | Condition |
|--------|-------|-----------|
| Share session link | Host/Player | Session `open` + `public` |
| View session share landing | Anyone | Guarded view row exists + no fence |
| Create activity draft | System | Session ended + player attendance=`present` |
| Publish activity card | Player (Person-self) | Draft exists + `display_name` set + confirm |
| Change audience | Player (owner) | Card published |
| Revoke activity card | Player (owner) | Card published |
| View public card | Anyone | `card_state='published'` + `audience='public'` + no fence |
| View followers card | Person-self hoặc accepted follower | `card_state='published'` + `audience='followers'` + no fence |
| Add/remove kudos | Player (auth) | Card visible theo audience rules |
| Download share image | Player (auth) | Card/session visible |
| Browse feed | Player (auth) | Authenticated |

### State machine — Activity Card

```
                    ┌─────────┐
                    │  draft  │ (tenant-only; no global row)
                    └────┬────┘
                         │ publish (chọn audience)
                    ┌────▼────┐
                    │published│ (global card + slug created)
                    └────┬────┘
                    ┌────┤────────────────┐
                    │    │                │
          ┌─────────▼┐   │         ┌──────▼─────┐
          │ revoked  │   │         │audience    │
          │(terminal)│   │         │change      │
          └──────────┘   │         │(pub↔follow)│
                         │         └────────────┘
                    ┌────▼────┐
                    │auto-    │ (attendance lost, session
                    │revoked  │  cancelled, identity issue)
                    │(terminal)│
                    └─────────┘
```

---

## 5. Analytics Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `share_session_initiated` | Player/Host taps share button on session | `session_slug` (opaque), `surface` (web/bot), `share_method` (copy/zalo/messenger/download) |
| `share_session_landing_viewed` | Visitor opens `/session/<slug>` | `session_slug`, `source_channel` (referrer opaque), `is_crawler` (boolean) |
| `share_session_join_started` | Visitor taps Join CTA on landing | `session_slug`, `share_ref` (opaque attribution) |
| `share_session_join_succeeded` | Join service confirms successful join | `session_slug`, `share_ref`, `join_method` (direct/waitlist/approval) |
| `activity_card_published` | Player publishes card | `card_id` (opaque), `audience`, `sport_key` |
| `activity_card_audience_changed` | Player changes audience | `card_id`, `old_audience`, `new_audience` |
| `activity_card_revoked` | Player revokes card | `card_id` |
| `activity_card_auto_revoked` | System auto-revokes (attendance/cancel) | `card_id`, `reason` (enum) |
| `activity_card_viewed` | Visitor views activity card | `card_id`, `viewer_relationship` (self/follower/public/unknown) |
| `share_image_downloaded` | Player downloads PNG | `target_type` (session/activity), `target_id` (opaque) |
| `feed_viewed` | Player views feed | `items_loaded` (count), `has_content` (boolean) |
| `kudos_added` | Player adds kudos | `card_id` |
| `kudos_removed` | Player removes kudos | `card_id` |

> **Telemetry cho DD-73 là hard requirement cùng slice** (DD-69 bài học: không instrument từ đầu → KPI "% join qua discovery" không có baseline). `share_ref` là attribution ref, **KHÔNG** capability, **KHÔNG** PII.

---

## 6. Acceptance Criteria

### Share Session Link (DD-73) — P4.3

- [ ] Session `open` + `public` hiện nút "Chia sẻ" trên detail
- [ ] Share sheet: copy link + share to Zalo/Messenger + download ảnh + Web Share API fallback
- [ ] Landing `/session/<slug>` hiện OG card với đúng BL-DSC-1 whitelist fields
- [ ] Landing cho session không khả dụng (private/cancelled/không tồn tại) trả **cùng generic 404** — không phân biệt lý do
- [ ] OG renderer chỉ đọc guarded view — test byte-level: không venue/roster/PII/charge/debt
- [ ] Fence raised cùng source transaction → landing/image 404 ngay trước projector chạy
- [ ] Join CTA revalidate live eligibility — share link KHÔNG cấp quyền join
- [ ] Telemetry: share_initiated → landing_viewed → join_started → join_succeeded pipeline hoạt động
- [ ] `share_ref` opaque, TTL bounded, không PII, rate-limited
- [ ] Share image PNG: sport-themed template, metadata stripped, correct MIME/dimensions
- [ ] Malicious text input (XSS/bidi/control) không execute trong rendered image
- [ ] i18n: text trên card/ảnh qua `t(vi,en)`, locale từ link param

### Activity Card (DD-74/75) — Sau P4

- [ ] Chỉ verified Person-self (session ended, attendance=`present`) có thể publish
- [ ] Activity tạo = `draft`; user chọn audience khi publish — KHÔNG auto-publish
- [ ] Card chỉ hiện: sport, played_on (date only), area, scheduled_duration, display_name — KHÔNG venue/CLB/co-participant/tiền
- [ ] `persons.display_name` trống → KHÔNG project (fail-closed), CTA cập nhật tên
- [ ] Publish → 202/PUBLISHING → projector render → share URL available
- [ ] Public card có opaque slug `/a/<slug>` + OG card + image
- [ ] Followers card: chỉ `person_follows.status='accepted'` thấy. Unfollow → biến mất lần read kế
- [ ] Audience change public→followers: slug tombstone + image purge. Followers→public: confirm mới
- [ ] Revoke = permanent tombstone + 404 mọi version. Cảnh báo: "screenshot bên thứ ba không thu hồi được"
- [ ] Correction (source thay đổi) → `card_version` tăng, `published_at` giữ nguyên (không boost)
- [ ] Auto-revoke khi attendance lost / session cancelled → fence + deny ngay
- [ ] Profile visibility và activity audience **độc lập** — private profile + public card = valid

### Feed (DD-76) — P4+ (evidence gate)

- [ ] Feed chỉ đọc `person_activity_cards` (global plane) — KHÔNG query tenant tables
- [ ] Keyset pagination `(published_at, card_id)`
- [ ] Block (DD-55) loại hai chiều ngay
- [ ] Fence/revoked cards không xuất hiện
- [ ] Empty state: "Chưa có hoạt động" + "Tìm người theo dõi" CTA

### Kudos (DD-77) — P4+ (evidence gate)

- [ ] Add/remove explicit idempotent (PUT no-op, DELETE no-op)
- [ ] Actor resolve qua guarded visibility — fenced card = card không tồn tại
- [ ] Block gỡ/ẩn reaction hai chiều
- [ ] Own-remove cleanup được kể cả khi card bị fence/revoke
- [ ] Rate-limit per actor per card
- [ ] Không notification tới khi DD-70 có person-directed global path

### Share Image (DD-78) — Đi kèm consumer

- [ ] Server-rendered template, KHÔNG upload user
- [ ] Renderer chỉ đọc guarded snapshot — KHÔNG query canonical
- [ ] Template: design tokens + sport variants + generic fallback
- [ ] Object store private-to-origin, tách hẳn DD-55 media store
- [ ] Authorization-before-cache: mọi fetch qua origin gate
- [ ] Old version / revoked / fenced → fixed 404 dù purge lỗi
- [ ] Output: raster PNG, exact MIME/dimensions, metadata stripped
- [ ] Renderer sandbox: no egress, no secrets, fixed local assets only

---

## 7. Open Questions / Cut scope / Changelog

### Open Questions

| ID | Câu hỏi | Ảnh hưởng | Status |
|----|---------|-----------|--------|
| SHR-OQ-1 | Tournament/Club/Profile share card contract | DD-82/83/84 có URL public nhưng chưa có share card/image contract | Mở — additive slice sau DD-73/75 |
| SHR-OQ-2 | Activity card v2 (match stats) | Cần DD-61/62 land + amend DD-64 | Mở — post-P4 |
| SHR-OQ-3 | Club attribution (tên CLB trên card) | Dual-consent contract additive | Mở — chờ product evidence |
| SHR-OQ-4 | Co-participant (đồng đội trên card) | DD-48 #5 vẫn mở | Mở |
| SHR-OQ-5 | Photo upload (user upload ảnh riêng) | Cần DD-55 media stack + quyết định ảnh công khai | Mở — phase-2 |
| SHR-OQ-6 | Comment trên activity card | Cần DD-55 + OQ moderation global-plane | Mở — defer |
| SHR-OQ-7 | Product-evidence gate thresholds | Ngưỡng eligible activities/tuần, publish rate, follow liquidity | Mở — owner define |
| SHR-OQ-8 | Retention/scrub SLA cho revoked cards | USR-OQ-3/legal review | Mở — chốt trước enablement |

### Cut scope (phase-1)

- ❌ Club attribution trên card
- ❌ Co-participant / đồng đội
- ❌ Caption / free-text
- ❌ Photo upload
- ❌ Comment
- ❌ Auto-publish (kể cả opt-in)
- ❌ Match stats v2 (DD-61/62)
- ❌ Tournament/Club/Profile share cards (contract TBD)

### Changelog

| Date | Version | Thay đổi |
|------|---------|----------|
| 2026-08-12 | v1.0 | Initial spec covering DD-73–78. 6 sub-features phased: Share Session Link (P4.3), Activity Card (sau P4), Feed + Kudos (P4+ evidence-gated), Share Image (cùng consumer). 15 use cases, 20 edge cases, 6 screens with 4-state matrix, domain model (5 tables + snapshot schema + permission matrix + state machine), 13 analytics events, acceptance criteria per phase, 8 open questions. Grounded entirely on owner-final decisions DD-73–78 analysis v1.2. |
