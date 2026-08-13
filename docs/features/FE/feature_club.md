# Feature: Club — CLB của tôi — Product/UX Spec

> **Canonical phase:** P4 (cùng web surface)
> **Track:** 🏸 Club Management
> **Version:** 1.0 · 2026-08-10
> **Status:** Draft
> **Implementation:** Not started · authority: `../../standards/BUILD-STATUS.md`
> **Prerequisites:** P3.5 identity (Person/Membership) · P4 web auth · P4.6 player_view (person-self data)
> **Tài liệu liên quan:** `../../product/BRD.md` BR-1/BR-5/FR-2 · `feature_home.md` (bottom nav slot #4) · `feature_inapp_chat.md` (chat CLB) · `feature_session_management.md` (sessions CLB) · `feature_cross_club_join.md` (join flow) · `feature_connector_onboarding.md` (tạo CLB) · `feature_club_assistant.md` (AI trợ lý) · `../BE/feature_club_tech.md`

---

## 1. Mô tả

**Club** là tab riêng biệt trong bottom navigation (slot #4 — `feature_home.md §3`), hiển thị **tất cả CLB** của user: CLB user tạo/sở hữu (role owner/admin) và CLB user tham gia (member/guest) — dữ liệu từ person-self memberships (`/me/clubs`, player_view).

Bên trong mỗi CLB là nhiều sub-features:

| Sub-feature | Mô tả | Cross-ref |
|-------------|-------|-----------|
| **Club List** | Danh sách CLB, phân nhóm owner vs member, role badge | §3.1 |
| **Club Detail** | Trang chính CLB — hub cho các sub-features | §3.2 |
| **News/Announcement** | Feed bài đăng từ host/admin; **pin 1 post lên top** | §3.3 |
| **Members** | Danh sách thành viên CLB, role, invite/remove | `feature_cross_club_join.md` |
| **Sessions** | Danh sách kèo CLB (upcoming, past) | `feature_session_management.md` |
| **Chat** | Chat CLB — kênh `kind='club'` | `feature_inapp_chat.md` |
| **Settings** | Cài đặt CLB (host/admin) | §3.7 |
| **Tạo CLB** | Wizard tạo CLB mới | `feature_connector_onboarding.md` |

### Entry points

| Entry | Route / Surface | Actor | Mô tả |
|-------|----------------|-------|-------|
| Bottom nav → Club tab | `/me/clubs` (slot #4) | User (member+) | Danh sách CLB person-self (`feature_home.md §3`) |
| Club list → tap CLB | `/me/clubs` → tap | User (member) | → Club detail hub |
| Club detail → sub-feature | `/clubs/:tenantId` → News/Members/Sessions/Chat/Settings | Member (role-gated) | Hub điều hướng sub-features |
| Deep link CLB | `club_<slug>` sticky context (RTE-UC-4/DD-83) | User (member) | Direct vào Club detail |
| News → notification | Push/Inbox → club post | Member | → News/Announcement |
| Tạo CLB CTA | Club list → "Tạo CLB" | User | Wizard (`feature_connector_onboarding.md`) |
| Club Chat | Club detail → Chat | Member | Channel `kind='club'` (`feature_inapp_chat.md`) |
| Club Sessions | Club detail → Sessions | Host/Member | Kèo CLB (`feature_session_management.md`) |

### Bất biến

- Dữ liệu mỗi CLB **cô lập tuyệt đối** — RLS fail-closed (BRD BR-1).
- Club tab hiển thị **person-self** data — chỉ CLB user có membership.
- Role context quyết định UI: **owner/admin** → host board · **member/guest** → member view.
- News/Announcement thuộc `chat_channels(kind='club', post_policy='admins_only')` — chỉ host/admin post.
- **Chỉ 1 pinned post/channel** tại một thời điểm. Pin mới → tự unpin cũ.
- Pinned post bị soft-delete/hidden → auto unpin.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| CLB-UC-1 | User | Mở Club tab | Load danh sách CLB từ person-self memberships; phân nhóm owner vs member |
| CLB-UC-2 | User | Tap vào 1 CLB | Mở Club detail — hub hiển thị sub-features theo role |
| CLB-UC-3 | Host/Admin | Post bài trong News/Announcement | Bài đăng hiển thị cho tất cả member; push notification cho member online |
| CLB-UC-4 | Host/Admin | Pin 1 post lên top News/Announcement | Post được đánh dấu 📌, hiển thị cố định ở vị trí đầu tiên; pin mới tự unpin cũ |
| CLB-UC-5 | Host/Admin | Unpin post | Post trở lại vị trí timeline bình thường |
| CLB-UC-6 | Member | Xem News/Announcement | Feed posts sorted by time; pinned post luôn ở top |
| CLB-UC-7 | Host/Admin | Xem danh sách Members | Danh sách thành viên + role badge + trạng thái membership |
| CLB-UC-8 | Host/Admin | Mời thành viên mới / remove member | Invite link/code hoặc direct invite; remove → membership `left` |
| CLB-UC-9 | User | Xem Sessions CLB | Danh sách kèo (upcoming + past) scoped tenant; owner thấy đầy đủ, member thấy theo quyền |
| CLB-UC-10 | User | Mở Chat CLB | Navigate đến chat channel(s) của CLB → `feature_inapp_chat.md` |
| CLB-UC-11 | Host/Admin | Cài đặt CLB | Sửa tên, avatar, sport type, notification preferences, payment config |
| CLB-UC-12 | User | Tạo CLB mới (CTA + Tạo CLB) | Wizard onboarding → `feature_connector_onboarding.md` |
| CLB-UC-13 | User | Pull-to-refresh Club list | Refresh danh sách CLB + membership status |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Security | User cố truy cập CLB không có membership | ❌ NEVER — RLS fail-closed; redirect về Club list |
| 2 | UX | User chưa thuộc CLB nào | Empty state: icon + "Chưa có CLB" + CTA "Tìm CLB" (→ marketplace) + CTA "Tạo CLB" |
| 3 | Data | CLB bị suspended (billing) | Hiển thị với badge suspended; chỉ đọc, không tạo session/chat mới |
| 4 | UX | Pin post khi post bị xóa/ẩn | Unpin tự động nếu post bị soft-delete hoặc moderator hide; pinned slot trống cho đến khi host pin bài khác |
| 5 | Security | Non-admin cố pin/unpin post | ❌ NEVER — chỉ actor có `chat.channel.manage` mới pin/unpin được; UI ẩn nút pin cho non-admin |
| 6 | Concurrency | 2 admin pin khác post cùng lúc | Last-write-wins; chỉ 1 pinned/channel; DB constraint `pinned_message_id` là scalar |
| 7 | Data | Danh sách CLB dài (>10) | Pagination hoặc infinite scroll; không load hết 1 lần |
| 8 | UX | Role thay đổi (admin → member) | UI cập nhật realtime theo role hiện hành; mất quyền pin/settings |
| 9 | Data | CLB bị xóa/archived | Remove khỏi Club list; nếu đang xem → redirect về list + toast |
| 10 | Security | Member cố truy cập Settings CLB | ❌ NEVER — Settings chỉ hiển thị cho owner/admin; member không thấy tab Settings |
| 11 | Data | Post rất dài (>5000 chars) | Truncate preview trong feed; "Xem thêm" expand full |
| 12 | UX | News feed trống | Empty state: icon 📰 + "Chưa có thông báo" + (host: CTA "Đăng bài đầu tiên") |

### Flow: Pin Post

```
Host/Admin xem News feed
    │
    ▼
Long-press / ⋮ menu trên post
    │
    ▼
Chọn "📌 Ghim lên đầu"
    │
    ├── Post hiện tại chưa pin?
    │       → pin post mới
    │       → nếu có post cũ đang pin → auto unpin cũ
    │
    └── Post hiện tại đang pin?
        → hiện "Bỏ ghim" → unpin
```

---

## 3. Screens & States

### 3.1 Club List (bottom nav entry)

**Purpose:** Danh sách tất cả CLB của user, phân nhóm.

**Layout (mobile 375px):**

```
┌──────────────────────────────────────┐
│ ← Home           🏸 CLB của tôi     │
├──────────────────────────────────────┤
│                                      │
│ CLB tôi quản lý (2)                  │  section header
│ ──────────────────────────────────── │
│ [🏸] CLB Cầu lông BT      👑 Owner  │  row + role badge
│      12 thành viên · 3 kèo tuần     │
│ ──────────────────────────────────── │
│ [⚽] FC Thủ Đức             🛡 Admin │
│      8 thành viên · 1 kèo tuần      │
│                                      │
│ CLB tôi tham gia (3)                 │  section header
│ ──────────────────────────────────── │
│ [🏸] BK Badminton           Member   │
│      20 thành viên                   │
│ ──────────────────────────────────── │
│ [🎾] Tennis Q7               Member   │
│      15 thành viên                   │
│ ──────────────────────────────────── │
│ [🏸] SG Shuttle              Guest   │
│      30 thành viên                   │
│                                      │
│        [+ Tạo CLB mới]              │  CTA
│                                      │
├──────────────────────────────────────┤
│  🏠   🔍   🏸   ⚙️                  │  bottom nav (slot #4 active)
└──────────────────────────────────────┘
```

**Component: Club row**

| Field | Data source | Ghi chú |
|-------|-------------|---------|
| Sport icon | `tenants.sport_type` | Emoji hoặc icon set |
| Club name | `tenants.name` | Truncate nếu dài |
| Role badge | `memberships.role` | 👑 Owner · 🛡 Admin · Member · Guest |
| Member count | `memberships` count | Aggregate |
| Session frequency | Sessions/tuần | "3 kèo tuần" |

**4 States:**

| State | Nội dung |
|-------|----------|
| Loading | Skeleton (2 section headers + 4 club row skeletons) |
| Ready | Clubs grouped by role |
| Error | Toast "Không tải được danh sách CLB" + retry |
| Empty | Icon 🏸 + "Chưa có CLB nào" + CTA "Tìm CLB" + CTA "Tạo CLB" |

---

### 3.2 Club Detail (hub)

**Purpose:** Trang chính của 1 CLB — hub navigation cho sub-features.

**Layout (mobile 375px):**

```
┌──────────────────────────────────────┐
│ ← CLB của tôi    🏸 CLB Cầu lông BT│
│                   ⚙️ (owner/admin)   │  settings icon (role-gated)
├──────────────────────────────────────┤
│ ┌────────────────────────────────┐   │
│ │  [Club Avatar/Banner]          │   │  hero banner
│ │  12 thành viên · Cầu lông     │   │
│ └────────────────────────────────┘   │
├──────────────────────────────────────┤
│ [📰 Tin tức] [📋 Kèo] [👥 TV] [💬] │  horizontal tab bar
├──────────────────────────────────────┤
│                                      │
│  (Content area — switch by tab)      │
│                                      │
└──────────────────────────────────────┘
```

**Sub-tabs trong Club Detail:**

| Tab | Label | Content | Role |
|-----|-------|---------|------|
| 📰 | Tin tức | News/Announcement feed (§3.3) | All |
| 📋 | Kèo | Sessions CLB → `feature_session_management.md` | All |
| 👥 | Thành viên | Members list → cross-ref | All (manage = admin) |
| 💬 | Chat | Chat CLB → `feature_inapp_chat.md` | All |

---

### 3.3 News/Announcement Feed

**Purpose:** Feed bài đăng từ host/admin cho toàn CLB. Pinned post luôn ở top.

**Layout (mobile 375px):**

```
┌──────────────────────────────────────┐
│         📰 Tin tức CLB               │
├──────────────────────────────────────┤
│                                      │
│ 📌 GHIM ─────────────────────────── │  pinned post section
│ ┌────────────────────────────────┐   │
│ │ 👑 Anh T (Admin)     2 ngày   │   │
│ │                                │   │
│ │ 🏸 Lịch tập tháng 8:          │   │
│ │ - T3/T5: 19h-21h sân BT      │   │
│ │ - T7: 8h-10h sân Phú Nhuận   │   │
│ │                     📌 Đã ghim │   │
│ └────────────────────────────────┘   │
│                                      │
│ ──────────────────────────────────── │
│ ┌────────────────────────────────┐   │
│ │ 👑 Anh T (Admin)    30 phút   │   │
│ │                                │   │
│ │ Tối nay kèo bình thường nhé   │   │
│ │ mọi người. Ai vắng báo sớm!  │   │
│ │                        👍 3    │   │  reactions
│ └────────────────────────────────┘   │
│                                      │
│ ┌────────────────────────────────┐   │
│ │ 🛡 Minh (Admin)       Hôm qua │   │
│ │                                │   │
│ │ Nhắc mọi người thanh toán     │   │
│ │ tháng 7 nhé!                   │   │
│ └────────────────────────────────┘   │
│                                      │
├──────────────────────────────────────┤
│ (Host/Admin only)                    │
│ [📝 Đăng bài mới...]               │  composer (role-gated)
└──────────────────────────────────────┘
```

**Component: Post card**

| Field | Data source | Ghi chú |
|-------|-------------|---------|
| Author avatar + name | `persons` via `memberships` | + role badge |
| Timestamp | `chat_messages.created_at` | Relative |
| Body | `chat_messages.body` | Markdown-lite (bold, italic, links) |
| Pinned badge | `chat_channels.pinned_message_id` | 📌 nếu pinned |
| Reactions | `chat_message_reactions` | Count per emoji |
| Pin/Unpin action | `chat.channel.manage` capability | Long-press menu (admin only) |

**4 States:**

| State | Nội dung |
|-------|----------|
| Loading | Skeleton (1 pinned card skeleton + 3 post card skeletons) |
| Ready | Pinned post (nếu có) + timeline posts sorted by time DESC |
| Error | Toast "Không tải được tin tức" + retry |
| Empty | Icon 📰 + "Chưa có thông báo nào" + (host: "Đăng bài đầu tiên") |

**Data source mapping:**

| Element | Source | API |
|---------|--------|-----|
| Posts | `chat_messages` WHERE `channel.post_policy='admins_only'` | `GET /api/clubs/:tenantId/announcements` |
| Pinned post | `chat_channels.pinned_message_id` | Included in channel metadata |
| Author | `persons` + `memberships` | JOIN trong query |
| Reactions | `chat_message_reactions` | Aggregate per message |

---

### 3.7 Club Settings (Host/Admin only)

**Purpose:** Cài đặt CLB — chỉ hiển thị cho owner/admin.

**Layout (mobile 375px):**

```
┌──────────────────────────────────────┐
│ ← CLB Cầu lông BT    ⚙️ Cài đặt   │
├──────────────────────────────────────┤
│                                      │
│ Thông tin CLB                        │
│ ┌────────────────────────────────┐   │
│ │ Tên CLB        CLB Cầu lông BT│   │
│ │ Môn            🏸 Cầu lông    │   │
│ │ Avatar         [Đổi ảnh]      │   │
│ │ Mô tả          ...            │   │
│ └────────────────────────────────┘   │
│                                      │
│ Thanh toán                           │
│ ┌────────────────────────────────┐   │
│ │ Ngân hàng      Vietcombank    │   │
│ │ SePay          ✅ Kết nối     │   │
│ │ Auto-reconcile  ⛔ Chưa bật   │   │
│ └────────────────────────────────┘   │
│                                      │
│ Thông báo                            │
│ ┌────────────────────────────────┐   │
│ │ Push khi có kèo mới    [✅]   │   │
│ │ Nhắc thanh toán        [✅]   │   │
│ └────────────────────────────────┘   │
│                                      │
│ Danger Zone                          │
│ ┌────────────────────────────────┐   │
│ │ [🔴 Tạm dừng CLB]            │   │  pause club
│ │ [🔴 Xóa CLB]                  │   │  delete club (owner only)
│ └────────────────────────────────┘   │
│                                      │
└──────────────────────────────────────┘
```

**4 States:**

| State | Nội dung |
|-------|----------|
| Loading | Skeleton form fields |
| Ready | Form với giá trị hiện tại |
| Error | Inline error per field + toast cho save failure |
| Empty | N/A (luôn có data từ tenant config) |

---

## 4. Domain Model

> Shared ground truth — BE tech spec extends với DDL chi tiết.

**Entities chính:**

| Entity | Bảng | Mô tả |
|--------|------|-------|
| Tenant (CLB) | `tenants` | Mỗi CLB là 1 tenant |
| Membership | `memberships` | Person ↔ Tenant relationship + role |
| Person | `persons` | User identity |
| Chat Channel | `chat_channels` | Kênh chat/announcement + `pinned_message_id` |
| Chat Message | `chat_messages` | Bài đăng / tin nhắn |

**Permission matrix:**

| Action | Owner | Admin | Member | Guest |
|--------|-------|-------|--------|-------|
| Xem Club list | ✅ | ✅ | ✅ | ✅ |
| Xem Club detail | ✅ | ✅ | ✅ | ✅ |
| Post News/Announcement | ✅ | ✅ | ❌ | ❌ |
| Pin/Unpin post | ✅ | ✅ (`chat.channel.manage`) | ❌ | ❌ |
| Xem Members | ✅ | ✅ | ✅ | ✅ |
| Invite/Remove member | ✅ | ✅ | ❌ | ❌ |
| Xem Sessions | ✅ | ✅ | ✅ | ✅ (limited) |
| Tạo Session | ✅ | ✅ | ❌ | ❌ |
| Xem Chat | ✅ | ✅ | ✅ | ✅ |
| Settings CLB | ✅ | ✅ | ❌ | ❌ |
| Xóa CLB | ✅ | ❌ | ❌ | ❌ |
| Tạo CLB mới | ✅ (any user) | ✅ | ✅ | ✅ |

---

## 5. Analytics Events

| Event | Trigger | Properties |
|-------|---------|------------|
| `club_list_viewed` | Mở Club tab | `club_count`, `role_distribution` |
| `club_detail_viewed` | Tap vào 1 CLB | `tenant_id`, `role`, `member_count` |
| `club_tab_switched` | Switch sub-tab trong Club detail | `tab_key` (news/sessions/members/chat) |
| `club_news_posted` | Host/Admin đăng bài mới | `tenant_id`, `post_length` |
| `club_post_pinned` | Pin 1 post | `tenant_id`, `message_id` |
| `club_post_unpinned` | Unpin post | `tenant_id`, `message_id` |
| `club_settings_opened` | Mở Settings CLB | `tenant_id`, `role` |
| `club_settings_saved` | Lưu cài đặt CLB | `tenant_id`, `changed_fields[]` |
| `club_create_tapped` | Tap "Tạo CLB mới" | `source` (club_list/empty_state) |
| `club_member_invited` | Gửi lời mời | `tenant_id`, `invite_method` |
| `club_pull_to_refresh` | Pull-to-refresh Club list | — |

---

## 6. Acceptance Criteria

### Functional

- [ ] Club tab hiển thị đúng tất cả CLB user có membership (person-self)
- [ ] Phân nhóm owner/admin vs member/guest đúng role
- [ ] Club detail hiển thị sub-tabs: Tin tức, Kèo, Thành viên, Chat
- [ ] News/Announcement chỉ cho host/admin post (`post_policy='admins_only'`)
- [ ] Pin post: chỉ 1 pinned/channel; pin mới tự unpin cũ; pinned post luôn ở top
- [ ] Unpin: post trở lại timeline bình thường
- [ ] Pin post bị soft-delete/hidden → auto unpin
- [ ] Non-admin không thấy nút pin/unpin
- [ ] Members list hiển thị đúng + role badge
- [ ] Sessions list scoped đúng tenant
- [ ] Chat navigate đúng channel CLB
- [ ] Settings chỉ hiển thị cho owner/admin
- [ ] "Tạo CLB" CTA hoạt động → onboarding wizard

### States

- [ ] 4 states (Loading/Ready/Error/Empty) cho mọi screen: Club list, Club detail, News feed, Members, Settings
- [ ] Empty state cho Club list: icon + "Chưa có CLB" + 2 CTA
- [ ] Empty state cho News feed: icon + "Chưa có thông báo" + CTA (host only)

### UI

- [ ] Role badge đúng (👑 Owner · 🛡 Admin · Member · Guest)
- [ ] Pinned post có badge 📌 và section riêng "GHIM"
- [ ] Responsive: 375px / 768px / 1440px
- [ ] Touch targets ≥ 44px
- [ ] Dark mode

### Analytics

- [ ] `club_list_viewed` khi mở tab
- [ ] `club_post_pinned` / `club_post_unpinned` khi pin/unpin
- [ ] `club_tab_switched` khi switch sub-tab

---

## 7. Open Questions / Changelog

### Open Questions

| ID | Câu hỏi | Status | Quyết định |
|---|---|---|---|
| CLB-OQ-1 | News/Announcement dùng `chat_channels(admins_only)` hay bảng riêng `club_posts`? | 🟡 Open | Lean toward tái dùng `chat_channels` cho consistency — cần confirm DD |
| CLB-OQ-2 | Member có react được News post không? | 🟡 Open | Lean toward YES (reactions từ `feature_inapp_chat.md` set `👍❤️😂😮😢🙏`) |
| CLB-OQ-3 | Có cho phép member comment trên News post không? | 🟡 Open | Defer — phase-1 chỉ reactions, comment phase-2 |

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-08-10 | v1.0 | Initial: Tách Club tab thành feature riêng. Sub-features: Club list, Club detail, News/Announcement (pin post), Members, Sessions, Chat, Settings, Tạo CLB. 7 sections đầy đủ theo convention. 13 use cases, 12 edge cases, 4 screens (list/detail/news/settings), permission matrix, 11 analytics events. |
