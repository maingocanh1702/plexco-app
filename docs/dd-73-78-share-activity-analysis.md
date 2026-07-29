# 📣 DD-73..78 Analysis — Share kèo · Activity per player · Feed & kudos · Ảnh mặc định (tham khảo Strava)

> **Mục đích:** đóng gap "chia sẻ kèo" + "chia sẻ hoạt động của từng player" + feed/kudos + **ảnh share mặc định**, **ground vào canonical** trước khi đề xuất bất kỳ bảng nào.
> **Ngày:** 2026-07-18 · **Nguồn yêu cầu:** session hỏi feature 2026-07-18 ("thêm feature share session/kèo, share activity cho từng player, tham khảo feature share activity của Strava"; bổ sung: *"mỗi player đều share được activity của mình với ảnh mặc định từ Plexco"*).
> **Canonical đã đọc:** `packages/db/schema.ts` (`sessions`/`players`/`public_sessions`/`memberships`/`persons`) · `packages/db/migrations/0005_sync_engine.sql` + `0010_functions_triggers.sql` (outbox sequence/claim hiện hành) · `packages/db/migrations/0006_discovery.sql` + `docs/standards/business-rules.md` BL-DSC-1 (public whitelist authority) · `packages/db/migrations/0009_rls_policies_grants.sql:11-18,105,115-132` (global-protected vs public plane grants) · `docs/standards/decisions.md` (**current authority v1.67; cụm DD-73..78 được chốt tại v1.67, sequencing corrected v1.67**) — DD-06/12/38/39/41/42/44/46/47/48/50/55/56/61..64/67/69/70 · `docs/features/feature_player_view.md` (person-self boundary) · `docs/standards/design-tokens.md` · `docs/standards/core-db-architecture-principles.md` §P6. Ghi → `docs/standards/decisions.md` **DD-73..78**.
> **Brief để chốt:** `founder-decision-brief-2026-07-19-share-activity.md` (6 câu ở §12).
> **Trạng thái:** ✅ **CHỐT (owner 2026-07-19)** — 6 câu ở §12 đã có câu trả lời (Q1 a · Q2 a · Q3 a · Q4 a · Q5 a + re-scope · Q6 a). **Chốt contract ≠ mở lịch build:** chỉ slice fence/marketplace (nay thuộc **DD-12**) và DD-73 được vào hàng đợi ngay. DD-74/75 chưa vào hàng đợi nhưng **không** bị chặn bởi social evidence gate: chúng mở sau dependency kỹ thuật + một lần ưu tiên lại bằng telemetry DD-73, rồi tạo baseline activity. Chỉ DD-76/77 bị hard-gate bởi baseline/liquidity đó; DD-78 đi cùng từng consumer (ảnh session với DD-73, ảnh activity với DD-75). Vẫn không có migration, không đổi code-readiness, không sửa spec đã Reviewed.
>
> **Current-state note (2026-07-28):** contract owner-final vẫn giữ nguyên, nhưng file này không phải
> delivery status. Trên `main@784bc8d` chưa có activity/share/feed/kudos business route, projector hay FE;
> mọi claim sequencing bên dưới phải được re-pin qua readiness gate trước khi author slice.

---

## 0. TL;DR

| DD | Nội dung | Chốt (owner 19/07) | Phụ thuộc |
|---|---|---|---|
| **DD-73** | Share link + preview card cho **session** | Tách share link khỏi invite capability; OG chỉ từ guarded public view (`public_sessions` + denial-only fence, không canonical); CTA revalidate Join service; funnel telemetry land cùng slice | Marketplace projector — DD-12 ở **P4.3** |
| **DD-74** | **Activity per player** = **derived**, không tạo bảng roster song song | Chỉ Person-self đã xác thực được publish sau khi buổi kết thúc + attendance=`present`; v1 mỏng, v2 additive từ DD-61/62 | DD-42 · DD-50 · DD-61/62 (post-P4) |
| **DD-75** | Publish contract: lifecycle + audience + snapshot do **projector** sở hữu | Tenant intent giữ `draft/published/revoked` + `publication_version` monotonic; correction event chỉ đánh thức reconcile, projector lock + re-read canonical source hiện hành; global card có deterministic source key/`card_state` riêng | DD-74 |
| **DD-76** | **Feed** người mình follow | Fan-in trên global plane; chỉ build sau product-evidence gate chứng minh đủ activity/follow liquidity | DD-47/48 · DD-75 (P4+) |
| **DD-77** | **Kudos / comment** | Ship **kudos** với abuse controls (không cần content moderation) **— cùng product-evidence gate với DD-76, không sớm hơn**; **defer comment** sau DD-55 + OQ moderation global-plane | DD-76 · DD-55 |
| **DD-78** | **Ảnh share mặc định từ Plexco** | Một template system versioned + sport variants; authenticated draft preview; **không upload phase-1**; public URL qua guarded origin, object store không public trực tiếp và tách hẳn DD-55 | DD-73 · DD-75 · DD-48 (avatar excluded) |

**Ba phát hiện quan trọng nhất (không có trong yêu cầu gốc):**

1. **Strava activity = single-owner. Plexco session = tenant-owned, multi-participant.** Không map 1-1 được. Copy thẳng model Strava sẽ biến kèo của CLB thành bài đăng cá nhân và kéo theo rò roster.
2. **Gắn tên CLB lên activity card cá nhân = rò roster theo chiều ngược.** `public_sessions.club_display_name` an toàn vì **CLB tự publish chính nó**; card cá nhân gắn tên CLB thì thế giới suy ra được "người X là thành viên CLB Y" — đúng thứ HR2 cấm. → phase-1 **không có attribution**; nếu mở về sau thì bắt buộc **đồng thuận hai phía** (person opt-in **và** tenant policy), default **tắt**, bằng contract additive riêng.
3. **Feed sống ở global plane, activity source sống ở tenant plane.** Đây đúng là gap mà DD-70 đang mở cho notification. Feed **không được** query bảng tenant-scoped (HR1) → buộc phải đọc qua projection, và projection phải do projector ghi (HR3).

---

## 0.1 Correction log (các verify pass — chi tiết đầy đủ ở Changelog cuối file)

| Rev trước (SAI) | Sự thật (đã sửa) |
|---|---|
| Whitelist card lấy từ DDL `0006` (gồm `skill_level`) | Authority là **`BL-DSC-1`**; DD-41 đã **retire `skill_level`** khỏi public và thêm 8 session-policy field. Lấy DDL làm whitelist = hồi sinh field đã bỏ. |
| "Invite token bị forward ⇒ `used_count` bị đốt" | DD-44 pin `used_count` **chỉ tăng khi redeem thành công**. Rủi ro thật là **ai cũng vào được kèo private**, không phải mất lượt. |
| `players.status` liệt kê `waitlisted` như thể đã vận hành | `waitlisted` chỉ mới có ở tầng DDL tại **commit `1a6ac38` trên `feat/session-waitlist-expand` qua `0014_players_waitlist.sql` (expand-only, chưa merge `main`@`22c23aa`)** — promotion/join logic chưa build. |
| `players` = "per-person per-session" | UNIQUE thật là `(tenant_id, session_id, membership_id)` → **per-membership**. |
| Dùng CHT-OQ-2 làm gate moderation cho comment | CHT-OQ-2 chỉ phủ **host moderation trong club channel**; comment ở global plane **không có host** → cần OQ mới. |
| `readonly` "chỉ SELECT trên `public_sessions`" | Còn `GRANT SELECT ON sports` (`0009:105`). |
| "Mỗi player" tự suy ra quyền publish | `players` là per-membership; actor phải resolve từ verified Person-self rồi chứng minh đúng membership/player. Client-supplied `person_id`/`player_id` không phải authority. |
| `person_id` đủ làm key cho activity card | Một Person có nhiều activity; projection cần deterministic source key + internal source tenant/player/share refs. |
| Public activity của hai người = consent xuất hiện trên card nhau | Không tương đương. Phase-1 không hiện co-participant; tagged-participant cần consent riêng sau này. |
| Fence `activity_card×session` raise theo cancel/private/**close** | `closed` là kết thúc **bình thường** và là nguồn eligible của DD-74 ⇒ fence theo close sẽ revoke card của mọi player. Chỉ `cancelled`/xoá mới raise. |
| `GRANT SELECT` view activity cho `readonly` | Tạo danh bạ activity cross-person duyệt được **không cần slug**, phá chính anti-enumeration của cụm. Crawler đi qua app + narrow function, không cần grant DB. |
| View public/feed lọc theo `publication_state` | Cột đó ở **tenant plane**; view/feed là **global-only** ⇒ như viết cũ là buộc join cross-plane, phá chính HR1/DD-76. Global row phải có **`card_state` riêng**; `draft` không tạo global row. |
| Public long-cache namespace = bucket/object public trực tiếp | Sai: nếu object store cho anonymous read thì DB `card_state` không thể ép origin 404 và purge lỗi sẽ làm ảnh đã revoke còn sống. Chỉ URL/CDN là public; object store private-to-origin, mọi fetch qua guarded origin kiểm tra snapshot/version hiện hành. |
| Một scalar `source_version` + idempotency là đủ chống event cũ | Không có total order chung vì snapshot lấy từ nhiều aggregate (`session`, `player/attendance`, `persons.display_name`, consent, sau này organize). Lifecycle dùng `publication_version`; correction event chỉ là wake-up. Projector serialize theo source key, lock + re-read **current canonical sources**, rồi lưu HMAC `source_fingerprint`; không apply snapshot payload cũ. |
| Revoke phải giữ nguyên cả global card row vĩnh viễn để slug không sống lại | Sai owner: **`activity_card_slugs.slug_hash`** mới là tombstone vĩnh viễn. Card row chỉ giữ `revoked` trong retention/audit window rồi scrub/minimize hoặc xoá; không giữ PII snapshot để làm việc của slug registry. |
| Template render không có nội dung user nên không cần sanitation/report | Không có **uploaded image/caption UGC**, nhưng card vẫn render canonical text do user/tenant kiểm soát (`persons.display_name`, session title, host/club name). Không cần media-moderation pipeline mới; vẫn bắt buộc sanitation + report/takedown cho các text source. |
| Chỉ chờ projector xoá/update row vẫn bảo đảm revoke/private “ngay” | Projector là eventual; row cũ có thể còn visible sau source commit. Privacy-reducing mutation phải raise **global denial-only safety fence** trong cùng DB transaction. Read path kiểm tra fence; projector chỉ CAS-clear đúng token sau khi projection đã phản ánh current state. |

---

## 1. Canonical hiện trạng — cái gì đã có, cái gì thật sự thiếu

| Sự thật | Nguồn |
|---|---|
| `sessions` là **tenant-owned event** (`tenant_id NOT NULL`), có `visibility ∈ private/public`, `join_policy`, `status ∈ draft/open/closed/cancelled` | `schema.ts:214-243` |
| `players` là **bản ghi tham gia per-membership per-session**, tenant-scoped, `UNIQUE(tenant_id, session_id, membership_id)`. `main`@`22c23aa` có `active/left`; commit `1a6ac38` trên feature branch thêm `waitlisted` qua **`0014_players_waitlist.sql` — expand-only, chưa merge main, logic chưa build**, `joined_at` | `packages/db/schema.ts` · `packages/db/migrations/0014_players_waitlist.sql` |
| `public_sessions` là projection **cross-tenant, KHÔNG RLS, field-whitelist**, có `expires_at` — bản chất là **marketplace hướng tương lai**, không phải lưu trữ lịch sử | `schema.ts:586-609` · `0006_discovery.sql:3,11-27` · `0009:115` |
| **Whitelist authority là `BL-DSC-1`, không phải DDL `0006`** — DD-41 retire `skill_level` và thêm 8 session-policy field; DD-32 thêm `confirmed_count` và active+live-hold `slots_open` | `business-rules.md` BL-DSC-1 · DD-32/41 |
| `readonly` chỉ `SELECT` trên `public_sessions` (+ `sports`); **zero grant** trên bảng canonical | `0009:105,115-132` |
| Bảng identity global (`persons`/`accounts`/`link_codes`) = **GLOBAL PROTECTED**: không blanket grant cho `app`, chỉ `SECURITY DEFINER` | `0009:11-18` · DD-47 |
| DD-44 `session_invite_tokens` = **capability bearer token** (entropy ≥128-bit, hash-only, revoke, max_uses) cho kèo **private** | DD-44 |
| DD-06: **venue chính xác ẩn tới khi join**; public chỉ tới mức `area` | DD-06 · `0006_discovery.sql:18` |
| DD-42: attendance trên `players` (`present/no_show/excused/unknown`) + reliability trên `memberships` — **per-tenant, KHÔNG public** | DD-42 |
| DD-61/62: `session_courts`/`matches`/`match_participants`/`match_sets`/`score_events` — **accept-in-principle, build post-P4**, chưa có trong `schema.ts` | DD-61/62 |
| DD-64: **organize KHÔNG project ra public** | DD-64 |
| DD-47 `person_follows` (global protected) + DD-48 `profile_visibility` = **framework ✅, build P4+** | DD-47/48 |
| DD-55: block/report/rate-limit là **hard enablement gate**; canonical `chat_blocks` dùng chung cho chat/social | DD-55 |

**Kết luận hiện trạng:** Plexco **không có** khái niệm "activity" (bản ghi hoạt động hậu-sự-kiện của một người), **không có** feed, **không có** reaction, và **không có** share surface nào cho session ngoài (a) marketplace discovery và (b) invite token capability. Yêu cầu này là feature **mới hoàn toàn** ở tầng surface, nhưng **không cần** fact table mới ở tầng dữ liệu — xem §3.

---

## 2. DD-73 — Share link cho session (pre-event)

### 2.1 Vấn đề: hai loại link bị lẫn lộn

Cám dỗ lớn nhất là dùng luôn DD-44 invite token làm "nút Share". **Không được.** Invite token là **capability**: ai cầm link cũng mở được trang join của kèo **private**. Link share thì bị forward, screenshot, đăng lại group — nghĩa là capability phát tán ngoài tầm kiểm soát của host. *(Lưu ý chính xác theo DD-44: `used_count` **chỉ tăng khi redeem thành công**, không tăng lúc mở link — nên rủi ro ở đây **không** phải "bị đốt lượt", mà là **ai cũng vào được kèo private** và `max_uses`/revoke trở thành công cụ tù mù: host muốn thu hồi quyền vào thì buộc phải revoke cả link đã chia sẻ công khai.)*

### 2.2 Contract đề xuất — hai loại link, không bao giờ trộn

| | **Invite link (DD-44, đã chốt)** | **Share link (DD-73, mới)** |
|---|---|---|
| Bản chất | Capability bearer token | **Không phải capability** — chỉ là URL tới nội dung đã public |
| Route | `/i/<token>` | `/s/<session_id>` |
| Áp dụng | Kèo **private** | **Chỉ** kèo xuất hiện trong guarded `public_session_share_v`: row `public_sessions` chưa hết `expires_at` và không có active fence `(surface='session_share', target_kind='session', target_id=session_id)`. Row tồn tại là hệ quả projector đảm bảo; route không tự đọc/check `sessions` |
| Đọc từ | `sessions` (dưới RLS, sau khi verify token) | **Guarded public view** chỉ project cột từ `public_sessions` và anti-join `public_projection_fences`; không đọc bảng canonical |
| Không thoả điều kiện | Token sai/hết hạn/revoked → generic reject | Trả **fixed generic "không khả dụng"**, **KHÔNG** tiết lộ session có tồn tại hay không (cùng khuôn `feature_player_view` edge case 7 + DD-06) |

### 2.3 OG preview card — vì sao guarded public view là ràng buộc cấu trúc, không phải kỷ luật code

Renderer OG (`/s/<id>/card.png` + meta tags) phục vụ **crawler chưa xác thực** (Zalo, Messenger, iMessage). Nếu renderer được phép đọc `sessions`, thì mọi lỗi logic nhỏ đều thành rò tiền/PII ra ngoài internet. Ràng buộc renderer vào **guarded view có cột đúng bằng whitelist `public_sessions` và chỉ anti-join denial fence** biến HR2 thành thuộc tính kiến trúc; fence không thêm content, chỉ làm row biến mất ngay khi privacy transition commit.

Guarded view phải trở thành **public read authority cho cả marketplace lẫn share**, không chỉ route mới. Migration tương lai `REVOKE SELECT ON public_sessions FROM readonly`, giữ write cho projector, rồi `GRANT SELECT` đúng view; nếu marketplace còn đọc base thì fence chỉ bảo vệ share và stale row vẫn rò ở discovery.

- **⚠️ BLOCKER chưa được liệt kê: whitelist BL-DSC-1 hiện KHÔNG tồn tại trong `public_sessions`.** Live projection (`0006_discovery.sql:11-27` + `schema.ts`) vẫn còn `skill_level` và **chưa có** `confirmed_count`, `title`, `session_type`, `level_min_rank/level_max_rank/level_strict`, `gender_restriction`, `age_min/age_max` — migration cột session của **DD-41/DD-32 chưa implement** và bị sequence sau các business-core dependency tương ứng. Nghĩa là guarded view **không thể** phục vụ đủ field BL-DSC-1 ở thời điểm này, và cám dỗ sửa sai là đúng thứ DD-73 cấm: đọc `sessions`. ⇒ **DD-73 phụ thuộc projection migration của DD-41/DD-32**, không chỉ DD-12. Trước khi migration đó land, card chỉ được render **tập con field đã thực sự có trong `public_sessions`** — không bao giờ bù bằng cách đọc canonical.
- **Ngoại lệ cột duy nhất ngoài BL-DSC-1:** `public_projection_version` (control metadata, non-PII) **được phép** nằm trong guarded view, vì DD-78 dùng nó làm authorization-before-cache gate. Không có ngoại lệ nào khác.
- **Field cho phép trên card = đúng `BL-DSC-1` (authority), KHÔNG phải DDL `0006`.** BL-DSC-1 gồm `sport_key`, `starts_at`/`ends_at`, `area`, `price_amount`, `confirmed_count` (active players), `slots_open` (trừ active + live payment holds), `club_display_name`, `host_display_name`, `join_policy` + session-policy field an toàn `title`, `session_type`, `level_min_rank`, `level_max_rank`, `level_strict`, `gender_restriction`, `age_min`, `age_max`. Hold count/identity không public. **`skill_level` đã retire khỏi public** (DD-41 expand→contract) — card **không** được render lại field này. Cột `0006` là ảnh chụp trước DD-41/DD-32; lấy DDL làm whitelist sẽ hồi sinh field đã bỏ và bỏ sót các field target đã duyệt.
- **CẤM tuyệt đối trên card:** venue chính xác (DD-06), roster/tên người tham gia, nợ/charge, SĐT/email, tag thành viên (DD-43), attendance/reliability (DD-42), organize/score (DD-64).
- **Immediate deny + stale-copy boundary:** session cancel/private/close raise fence token trong **cùng source transaction**; guarded view/landing/image gate thấy fence và fixed 404 trước khi async projector xoá row. Projector chỉ clear bằng CAS đúng token sau khi projection hội tụ; stale worker không clear fence mới. Bên thứ ba đã fetch vẫn có thể cache ảnh và Plexco không thu hồi được bản sao đó. Delivery path do Plexco kiểm soát gate trước cached bytes; TTL + purge chỉ giảm stale copy ngoài hạ tầng.
- **i18n (HR5):** crawler không mang locale người dùng ⇒ **không** suy từ `Accept-Language`. Locale lấy từ chính share link (`/s/<id>?l=vi|en`), default `vi`; text trên ảnh vẫn qua `t(vi,en)`.
- **Share link KHÔNG cấp quyền join.** CTA trên landing chỉ phát protected join intent/ref vào canonical Join service. Service phải resolve target server-side rồi re-check live `visibility/status/capacity/join_policy/eligibility` dưới đúng tenant context; stale `public_sessions`, raw `session_id` hoặc `share_ref` không được bypass DD-05/32/41/45/52.
- **OG contract phải server-render đầy đủ:** `og:title`, `og:type=website`, locale-specific `og:url`, `og:image` + dimensions/type/alt và `og:description`; HTML/canonical URL và image bytes cùng đọc một guarded snapshot. Mọi text/attribute context-escape, URL build từ server allowlist; không raw HTML/URL từ snapshot và không dựa client JS.

### 2.4 Acquisition telemetry — phải land cùng DD-73

DD-73 được ưu tiên vì kỳ vọng kéo join qua discovery, nên không được ship một share surface không đo được tác động:

- `share_initiated` → `share_landing_viewed` → `join_started` → `join_succeeded`; payload chỉ gồm opaque refs + source surface/channel + coarse locale, **không** PII/roster/tiền.
- `share_ref` là random opaque attribution ref do server mint, TTL/retention bounded, **không phải capability** và không mở thêm field/quyền. Cấm nhúng raw `person_id`/`tenant_id`/`membership_id` vào URL.
- Tách known crawler fetch khỏi human landing view; không dùng fingerprint/raw user-agent làm analytics identity. Conversion tính từ server-side join outcome, không từ click client tự khai.
- Đây là hard requirement cùng slice, theo đúng bài học DD-69: không instrument từ đầu thì KPI "% join qua discovery" không có baseline để quyết DD-76/77.

---

## 3. DD-74 — Activity per player: derived, KHÔNG phải fact table mới

### 3.1 Vì sao không tạo bảng `activities`

Đúng cái bẫy HANDOFF §8 đã ghi ("thiết kế schema/model từ nguyên tắc chung mà chưa đọc canonical → đề xuất sai + tạo bảng song song"). Bản ghi "người X đã chơi buổi Y" **đã tồn tại**: `players` (tenant, session, membership, status, joined_at) + attendance DD-42. Thêm bảng `activities` sẽ tạo **nguồn sự thật thứ hai** cho cùng một sự kiện → vi phạm HR3 và tự chuốc lấy bài toán đồng bộ khi host sửa attendance.

> **Activity = read model** trên `players ⋈ sessions` (+ organize khi có), **không phải** thực thể mới.

### 3.2 Hai tầng dữ liệu (v1/v2 — **Q4 còn mở**: chọn (b) ở brief nghĩa là bỏ hẳn v2)

| | **v1 — dữ liệu sẵn có** | **v2 — khi DD-61/62 land** |
|---|---|---|
| Nguồn | `players` + `sessions` + DD-42 attendance | + `matches`/`match_sets`/`score_events` |
| Field public | `sport_key`, `played_on` (ngày, không giờ chính xác), optional `area`, `scheduled_duration_minutes` (từ `starts_at/ends_at`, **không gọi là thời lượng player thực chơi**), `activity_display_name` (candidate từ `persons.display_name`; chỉ public sau sanitation contract + preview — xem dưới) | + `matches_played`, `sets_won/lost`, `win_rate` |
| Sớm nhất | Sau Session CRUD + DD-42 | Post-P4 (theo DD-61) |

**Quy tắc mở rộng (bắt buộc để v2 không phá v1):** card có `schema_version`; field **chỉ được thêm, không đổi nghĩa**; v1 **vắng mặt** field v2 (không fill `null` giả) và renderer phải chịu được. Không version hoá bằng cách nhân bản bảng.

`attendance` là **predicate eligibility nội bộ**, không phải field public. Sự tồn tại của card đã nói actor có attendance=`present`; serialize thêm `attended=true` vừa thừa vừa phá invariant "attendance không ra public". `duration` của lịch kèo cũng không được diễn giải thành thời lượng cá nhân vì Plexco chưa đo check-in/check-out.

Phase-1 **không có caption/title free-text cho activity**. Candidate duy nhất cho tên actor là canonical, user-controlled `persons.display_name`, và user phải preview/confirm đúng output đã sanitize. ⚠️ **DD-48 approve *field*, chưa có accepted sanitation/report-takedown contract** (analysis DD-48 chỉ ghi chú `(sanitize + user-controlled)`); vì vậy slice phải định nghĩa + land contract đó trước public enablement, không tuyên bố reuse một guarantee chưa tồn tại. Không lấy `memberships.display_name`, alias tenant hoặc text gửi trong publish command; canonical profile/name owner sở hữu report/takedown, không dựng moderation owner thứ hai. Alias CLB cũng không thể lách dual-consent attribution.

### 3.2.1 Authority + eligibility để publish

"Mỗi player share được" nghĩa là **mỗi player đủ điều kiện có đường Person-self để tự publish**, không có nghĩa mọi row `players` tự có quyền public:

1. Actor chỉ lấy từ verified web session/magic link hoặc channel identity đã link Person theo DD-50; **không nhận authority từ URL/body `person_id`, `membership_id`, `player_id`**.
2. Dưới lock, resolve actor Person → đúng membership → đúng player/source session. Thiếu, nhiều kết quả, merge đang freeze hoặc ownership không chứng minh được ⇒ fail closed.
3. Chỉ eligible khi `now >= sessions.ends_at`, session không `cancelled`, player không `waitlisted`, và DD-42 attendance hiện hành = **`present`**. `active/left` không tự chứng minh đã chơi; một player `left` sau khi đã tham dự vẫn eligible nếu attendance=`present`.
4. Publish command bind actor + source player + server-owned `publication_version`, idempotent, rồi projector mới reconcile current canonical sources để tạo global snapshot. Host không duyệt card cá nhân, nhưng host cũng không thể publish thay player.
5. Source về sau mất eligibility (`present→no_show/unknown`, session cancelled, identity freeze/conflict) ⇒ auto-revoke/tombstone public projection; canonical attendance/player history không bị sửa.

### 3.3 ⚠️ v2 cần **amend DD-64**, không được lách

DD-64 chốt: *"không project organize sang public"*. Card v2 có `matches_played`/`sets_won` **là** dữ liệu organize đi ra ngoài. Đây **không** phải chỗ để "vì doc thấp hơn chưa cập nhật nên nới fail-closed". Đề xuất tường minh:

> **Amend DD-64:** ngoại lệ **duy nhất** = **aggregate của chính actor**, do **chính actor publish**, **không** kèm tên đối thủ/đồng đội, **không** kèm chi tiết trận/điểm từng set, **không** kèm sơ đồ sân. Board organize và mọi read cross-player vẫn tenant-private y nguyên.

### 3.4 Attribution — hai điểm rò tinh vi

**(a) Tên CLB trên card cá nhân = rò roster ngược.** ✅ **Chốt phase-1 (Q1): KHÔNG gắn tên CLB, không dựng cơ chế bật.** Dual-consent dưới đây là **đích đến tương lai**, thêm sau bằng đường additive — ở phase-1 nó cho ra đúng cùng hành vi (mọi card đều không có tên CLB) nhưng tốn 2 setting + 2 UI + test tổ hợp. *(Contract khi/nếu bật:* **đồng thuận hai phía**: person opt-in **và** tenant policy `allow_club_attribution` (host có quyền không muốn danh sách thành viên bị suy ra). Giá trị chỉ được copy từ canonical moderated `club_display_name` source của marketplace, không từ raw `tenants.name`, membership alias hay client text. Kèo thuộc **personal tenant (DD-46)** ⇒ luôn OFF.

**(b) Đồng đội/đối thủ — phase-1 KHÔNG HIỆN.** Việc người B publish card của chính B không phải consent để B xuất hiện trên card của A; "giao của tập đã publish" vẫn đổi context hiển thị và tạo quan hệ roster công khai. DD-48 open item #5 vì vậy **giữ mở**, không bị DD-74 đóng. Phase sau chỉ được thêm tagged participant khi có consent riêng theo person×activity/card, quyền remove khỏi grouping và re-project/tombstone propagation; thiếu bất kỳ bằng chứng nào ⇒ không tên, không avatar, không số lượng theo danh tính.

**(c) Địa điểm.** Card cá nhân + thời gian + venue chính xác = hồ sơ vị trí lặp lại của một người. Giữ **`area`-level** như DD-06, kể cả hậu sự kiện.

### 3.5 ⚠️ Ranh giới với DD-48 open item (1) — card ≠ profile field

DD-48 chốt *"avatar/sports/aggregate excluded tới khi có model"* và để mở **item (1): stats/aggregate cross-tenant**. Card ở DD-74/75 **là** một aggregate cross-tenant của một người — nên phải nói rõ nó **không** mở item (1):

| | **Card (DD-74/75)** | **Profile aggregate (DD-48 item 1 — vẫn ĐÓNG)** |
|---|---|---|
| Đơn vị | **Một buổi**, do chủ sở hữu **publish từng cái** | **Tổng hợp mọi buổi** của một người |
| Cơ chế | Opt-in, revoke được từng cái | Suy tự động từ `memberships`/`players` — đúng thứ DD-48 cấm ("không suy từ memberships/sessions") |
| Rò gì nếu sai | Một buổi đã chọn khoe | **Toàn bộ mức độ hoạt động + số CLB** của một người |

⇒ **Pin:** publish card **không** kéo theo quyền hiển thị "tổng số buổi đã chơi", "số CLB", "streak" trên profile. Muốn có mấy thứ đó thì vẫn phải đóng DD-48 item (1) bằng một quyết định riêng. Card là **một nội dung user chủ động publish**, không phải **hồ sơ hoạt động được suy ra**.

---

## 4. DD-75 — Publish lifecycle, audience, snapshot, correction, revoke

### 4.1 Ai sở hữu bản đã publish

Fact được whitelist có thể **đổi sau khi share**: host sửa attendance/session metadata (DD-42/41), correction điểm (DD-62); nếu attribution được bật bằng contract tương lai thì còn có rút consent. **DD-49 money correction không phải trigger** vì tiền/charge/allocation bị cấm khỏi activity snapshot; nối projector vào event tiền chỉ tăng coupling và bề mặt rò. Ba lựa chọn:

| | Ưu | Nhược |
|---|---|---|
| (A) Live-render mỗi lần xem | Luôn đúng | Người xem ngoài cần đọc dữ liệu tenant → đụng HR1; correction âm thầm đổi nội dung đã chia sẻ |
| (B) Snapshot bất biến lúc publish | Ổn định, dễ cache | Sai vĩnh viễn sau correction |
| **(C) Snapshot do projector sở hữu + re-project khi source đổi** ✅ | Whitelist là cấu trúc; correction hội tụ; đúng khuôn `public_sessions` đã có | Cần outbox event cho correction |

**Khuyến nghị (C).** Hệ quả bắt buộc: **user không bao giờ ghi trực tiếp vào snapshot** (làm vậy là multi-master, HR3). User chỉ ghi publication intent; projector ghi nội dung theo một allowlist trigger đóng.

### 4.2 Hai plane, bốn store có trách nhiệm tách biệt

| Bảng | Plane | Vai trò |
|---|---|---|
| `player_activity_shares` | **TENANT-scoped, RLS** (hang off `players`, same-tenant composite FK) | Ý định: `publication_state ∈ draft/published/revoked`; `audience ∈ followers/public` chỉ khi published; server-owned monotonic `publication_version`; `published_at`, `revoked_at` — không giữ public routing secret |
| `person_activity_cards` | **GLOBAL PROTECTED** | Snapshot đã whitelist + deterministic provenance do projector ghi; **có `card_state ∈ published/revoked` của riêng nó**; không phải fact table mới |
| `activity_card_slugs` | **GLOBAL PROTECTED** | Registry URL: `slug_hash PK`, nullable `card_id`, `state ∈ active/tombstoned`, timestamps; `active ⇒ card_id NOT NULL`, tombstone được detach `card_id=NULL`; partial unique một active slug/card, old slug không bao giờ sống lại |
| `public_projection_fences` | **GLOBAL PROTECTED, denial-only** | `(surface, target_kind, target_id) PK`, random `fence_token`, `deny_scope ∈ public/all`, reason/timestamps. `surface ∈ session_share/activity_card`; activity target phase-1 = `activity_share/session/person/tenant`. `tenant_attribution` chỉ được thêm bằng migration additive khi feature attribution thật sự được bật. Không content/PII DTO; source mutation raise/replace qua narrow function; đúng surface projector CAS-clear token sau khi **mọi row target đó** hội tụ |

- **⚠️ State phải sống ở CẢ HAI plane, không mượn qua plane.** `publication_state` trên `player_activity_shares` là **ý định của user** (tenant plane); global row có **`card_state ∈ published/revoked` riêng** (projector ghi). Lý do: view public và feed đều là **global-only** (§5) — nếu chúng filter theo `publication_state` thì phải join sang bảng tenant-scoped, tức phá đúng invariant §8.3 và DD-76. **`draft` KHÔNG BAO GIỜ có global row**: projector chỉ tạo row khi publish. Revoke trước hết chuyển `card_state='revoked'` và atomically tombstone active slug; card row chỉ cần tồn tại qua retention/audit window, sau đó payload được scrub/minimize hoặc row bị xoá. **Slug registry mới là permanent non-reuse authority**, không phải full card row.
- **Published intent ≠ public delivery proof.** Sau khi tenant transaction ghi `publication_state='published'`, API trả `202/PUBLISHING` + opaque operation ref cho tới khi global card/current asset/slug đã CAS-activate; không trả share URL sớm. Client-visible projection status được derive từ projector delivery ledger + global projection, không là field user ghi và không tạo source of truth thứ hai. Render/reconcile lỗi retry bounded/DLQ + owner-visible failure/retry/revoke path; tuyệt đối không fail-open bằng cách public card thiếu current image/authorization gate.
- **Safety fence không phá single-writer và không thành DoS primitive:** chỉ projector ghi snapshot/card/slug content. Privacy source transaction gọi **typed narrow functions** (session/share/current-tenant target được derive + ownership-verify server-side; person target chỉ identity service), không có generic client-callable `(surface,target_kind,target_id)`. Function chỉ deny/replace random token, reason enum đóng, không trả/log token/content; failure làm mutation fail closed. Tenant/app không thể fence target tenant khác, raise person-global target hay clear fence; CAS-clear exact token chỉ cho đúng projector worker. Session **cancel/private/close** raise `session_share×session` (de-list marketplace/share link). ⚠️ **`activity_card×session` CHỈ raise khi `cancelled` (hoặc session bị xoá)** — **KHÔNG** raise khi `closed`/`private`: `closed` là trạng thái kết thúc **bình thường** và chính là nguồn eligible của DD-74 (`now >= ends_at` + không cancelled), nên fence theo `close` sẽ giết mọi card của mọi player ngay khi host đóng kèo; `private` chỉ đổi tình trạng listing của kèo, không phủ nhận việc người ta đã chơi. Name/erasure dùng `activity_card×person`; tenant deletion dùng `activity_card×tenant`; per-card audience/attendance/revoke dùng `activity_card×activity_share`. **Phase-1 không có club attribution**, nên không tạo `tenant_attribution` target/function/flag; nếu feature này được bật về sau thì migration additive mới thêm target, `club_attribution_included` và withdrawal flow. Card phase-1 chỉ cần internal `source_session_id` để match session fence. Mỗi projector clear surface token chỉ sau mọi target rows hội tụ; fence mới thắng stale clear.
- **Source key + applied state bắt buộc:** global row phase-1 có `card_id`, internal-only `source_tenant_id`, `source_session_id`, `source_player_id`, `source_share_id`, `person_id`, `applied_publication_version`, domain-separated HMAC `source_fingerprint`, `projection_schema_version`, `snapshot_hash`, `card_version`, `card_state`, `published_at`, `updated_at`, `audience`. Fingerprint bao phủ exact normalized allowlisted inputs + eligibility + sanitizer/schema versions, không serialize raw PII. Consent/`club_attribution_included` chỉ tham gia fingerprint/schema khi attribution được bật bằng contract additive. `UNIQUE(source_tenant_id,source_player_id)` và `UNIQUE(source_tenant_id,source_share_id)` giữ idempotency. Source refs/tenant id **không bao giờ** vào public DTO/URL; cross-plane refs không dùng FK giả.
- **Ordering/reconcile fail-closed:** mọi publish/audience/revoke mutation tăng `publication_version` trong cùng tenant transaction ghi intent + outbox; privacy-reducing mutation đồng thời raise fence. Mọi correction event từ session/player/person/consent/organize chỉ là **wake-up keyed tới source share**, không phải snapshot authority. Worker serialize theo deterministic source key, rồi trong một DB transaction lock current share + allowlisted canonical source rows theo documented order, re-check eligibility/lifecycle và compute snapshot/fingerprint từ **current state**. `current publication_version < applied_publication_version` = integrity fault; same lifecycle + same fingerprint/hash = no-op; same fingerprint nhưng khác snapshot hash = integrity fault; current correction hợp lệ tăng `card_version`. Vì stale wake-up cũng re-read current state và không CAS-clear được fence token mới, nó không thể resurrect revoke/downgrade hoặc overwrite correction mới. Source/tenant deletion phải atomically raise fence + durable-write versioned revoke **trước khi** source trở nên không đọc được; retry/sweeper không được tự suy `missing = safe to republish`.
- `person_activity_cards`/`activity_card_slugs`: **không blanket grant** cho `app` (khuôn `0009:11-18` + DD-47). Public lookup hash slug rồi đi narrow `SECURITY DEFINER`; raw slug không lưu at-rest. Shape CHECK: `state='active' ⇒ card_id IS NOT NULL`; tombstoned row có thể detach `card_id=NULL`. `UNIQUE active(card_id)`; public→followers/revoke atomically tombstone active slug trước khi commit state. Re-publicize mint slug mới; old hash vĩnh viễn fixed 404. Registry ở global plane để route không chạm tenant table.
- **DB ↔ renderer là staged/CAS, không giả vờ atomic cross-system.** External render/CDN call không nằm trong DB transaction; job dùng stable operation key `(card_id, applied_publication_version, source_fingerprint, card_version, operation)`. Initial publish/followers→public và benign correction: render vào private staging, rồi worker re-lock/re-read current sources; chỉ khi `publication_version + source_fingerprint` vẫn khớp mới một global DB transaction activate card/current asset + slug + invalidate job. Mismatch ⇒ orphan staging object bị cleanup, reconcile lại. Privacy-reducing correction (name/eligibility; club attribution chỉ khi feature tương lai đã bật), downgrade hoặc revoke: **DB/delivery gate deny old version trước**, purge sau; new image có thể tạm 404 cho tới khi render current version xong — không serve stale sensitive bytes để đổi lấy availability. Purge chậm/hỏng chỉ để lại bản sao đã thoát ra client/cache bên thứ ba; cache do Plexco kiểm soát nằm **sau** authorization gate và không được serve bytes khi gate fail.
- Bề mặt đọc card: view cột tường minh `public_activity_cards_v WHERE card_state='published' AND audience='public'` và anti-join mọi applicable `surface='activity_card'` fence phase-1 (share/session/person/tenant); `REVOKE` base/fence. `tenant_attribution` chỉ tham gia sau migration additive tương lai. ⚠️ **KHÔNG `GRANT SELECT` view này cho `readonly`.** Crawler không đọc DB — nó đi `/a/<slug>` qua app, và app resolve bằng narrow `SECURITY DEFINER` theo slug hash. Cấp `readonly` quyền SELECT trên view = trao một **danh bạ activity cross-person duyệt được không cần slug**, phá nguyên tắc slug/anti-enumeration của chính cụm này và tạo một discovery surface chưa ai quyết định làm (surface public duy nhất đã chốt là `public_sessions`, và nó có BL-DSC-4 anti-scrape). View vẫn giữ vì nó là chỗ **cưỡng chế cấu trúc** cho column allowlist + fence anti-join; chỉ narrow function được đọc nó. Followers path cũng deny applicable `deny_scope='all'`. Không stable unauthenticated URL/object; draft chỉ owner preview.
- **Profile visibility và activity audience là hai control độc lập.** `profile_visibility=private` vẫn giữ social profile minimal theo DD-48. Nếu owner explicit publish một card `public`, đó là narrow per-card override chỉ cho đúng snapshot `activity_display_name ← persons.display_name` + fields đã preview; không mở profile route, aggregate hay card khác. `memberships.display_name`/tenant alias không được dùng làm fallback. Confirm phải liệt kê field/audience công khai — không có auto-upgrade từ profile setting.
- Public activity route = `/a/<slug>`. `share_slug` CSPRNG entropy **≥128-bit**, chỉ mint cho active `published+public`; at-rest lưu domain-separated hash/HMAC, không raw slug và không phải capability. Invalid/tombstoned/non-public/fenced đều cùng fixed 404. Downgrade/revoke tombstone; re-publicize mint slug mới. Revoke không đụng canonical player/attendance history.

### 4.3 Correction, audience change và revoke

| Source transition | Public behavior bắt buộc |
|---|---|
| Eligible content correction (session metadata/self stats/`persons.display_name`) | Reconcile current sources, tăng `card_version`, giữ nguyên `published_at` để không boost feed. Benign change được stage-render rồi verify-current/CAS; name/attribution/privacy-reducing change deny old image trước, new image có thể tạm 404. Mọi old version bị invalidate; landing slug chỉ resolve current snapshot |
| **Future-only:** club attribution consent bị rút sau khi feature additive được bật | Re-project bản đã bỏ tên CLB, invalidate mọi image cũ có attribution |
| `present→no_show/unknown`, session cancelled, identity conflict/freeze, Person deleted/erasure hoặc source tenant/player không còn chứng minh được | Auto-revoke: slug + mọi image version trả fixed 404, purge CDN; không tự republish nếu source eligible trở lại |
| Owner đổi `public↔followers` | Hiệu lực ngay ở lần read kế; public→followers tombstone/purge public OG image cũ, followers→public cần confirm mới |
| Owner revoke | Permanent tombstone slug, mọi version 404, không tái sử dụng |
| Event duplicate/out-of-order | Event chỉ wake reconcile; worker re-read current locked intent/sources. Duplicate/stale wake-up hội tụ về current fingerprint hoặc no-op; không apply payload cũ. `current publication_version < applied` hoặc same fingerprint khác snapshot hash = integrity fault + audit |
| Privacy-reducing mutation trước projector | Source transaction raise/replace fence token; global reads deny ngay. Projector apply current state rồi CAS-clear exact observed token; token mới không bị stale worker clear |

Delivery gate/origin 404 chặn fetch tương lai qua hạ tầng Plexco; **không thể thu hồi** screenshot, download hay cache bên thứ ba đã nhận ảnh. Publish confirm phải nói rõ giới hạn này. Vì vậy "revoke là thật" nghĩa là authorization-before-cache + tombstone đúng và best-effort external-cache invalidation, không hứa xoá mọi bản sao ngoài Plexco.

Sau revoke/erasure, global content snapshot và render artifacts phải được scrub theo retention/erasure matrix; `person_activity_cards` có thể bị minimize hoặc xoá sau khi không còn cần cho audit. Trước khi xoá card row, tombstoned slug phải detach `card_id=NULL`; chỉ `activity_card_slugs.slug_hash` + state/timestamps và non-PII audit metadata tối thiểu được giữ để old URL không sống lại. **Exact SLA/retention chưa được tự chốt ở đây** — phải đóng cùng USR-OQ-3/legal review trước enablement. Canonical tenant attendance/player history tuân retention riêng, không bị global projector tự xoá.

### 4.4 Merge identity (DD-01/§P6)

Card **không keyed chỉ bằng `person_id`**. Merge re-parent `person_id` và reaction actor; chỉ collapse duplicate nếu deterministic source key thật sự trùng, không collapse mọi activity của cùng Person. Lock source/card/reaction rows, canonicalize/drop-self/collapse exact duplicates trước update survivors, cùng transaction/audit theo §P6.

---

## 5. DD-76 — Feed

**Ràng buộc lõi:** `person_follows` là **global** (không `tenant_id`); activity source là **tenant-scoped**. Feed **không được** query bảng tenant-scoped (HR1), và **không được** `UNION` cross-plane trong SQL (buộc nới grant hoặc bypass RLS — đúng cảnh báo DD-70). Vì `person_activity_cards` đã là global plane nên feed đọc **hoàn toàn trong global plane** — đây chính là lý do §4.2 đặt snapshot ở global, không ở tenant.

- **Fan-in, không fan-out.** Query card của tập followee + phân trang keyset theo `(published_at, card_id)`. Correction giữ nguyên `published_at`, chỉ đổi `updated_at/card_version`, nên không tự boost card cũ lên đầu feed. Fan-out (ghi 1 row/follower) sẽ nhân bản dữ liệu và biến merge identity thành cơn ác mộng re-parent — không xứng ở quy mô hiện tại.
- **Audience tại read time:** `public` → ai cũng thấy; `followers` → chỉ `person_follows.status='accepted'`; `card_state='revoked'` hoặc applicable active fence → không vào feed; `draft` không tồn tại ở global plane nên không cần lọc. Unfollow/block/fence/audience downgrade có hiệu lực ở lần read kế, không snapshot follower list.
- **Block (DD-55):** loại **hai chiều** bằng canonical `chat_blocks`, không tạo store block thứ hai.
- **Không có tiền/PII/roster trong feed** — feed chỉ đọc `person_activity_cards`, tự thừa hưởng whitelist.

### 5.1 Product-evidence gate — direction không đồng nghĩa lịch build

DD-76/77 chỉ nên mở build sau khi DD-73/74/75 có baseline thật và owner đặt ngưỡng `TBD`, tối thiểu cho: eligible ended activities/tuần, tỷ lệ player publish ≥1 card, tỷ lệ active Person có ≥1 accepted follow, và feed non-empty rate. Không đạt baseline ⇒ tiếp tục tối ưu share/discovery, không dựng feed/kudos để lấp một graph rỗng. Gate này độc lập với technical dependencies DD-47/48/55 và cùng tinh thần DD-69 product-evidence gate.

---

## 6. DD-77 — Kudos & comment

| | Kudos (reaction) | Comment (free-text) |
|---|---|---|
| Moderation | Không cần **content moderation**; vẫn cần abuse/rate/block controls | **Cần** — và **chưa doc nào sở hữu** |
| Đề xuất | ✅ **Ship sau evidence gate**: `activity_reactions` global-protected, `UNIQUE(card_id,person_id)`, explicit add/remove idempotent, không lộ actor ngoài audience | ⬜ **Defer** sau đúng safety gate DD-55 (block + report + rate-limit) **+ một open question mới của chính surface này** |

Kudos contract tối thiểu: actor session-bound; add/list phải resolve card qua đúng guarded visibility path nên active fence được coi như card không tồn tại; `PUT/add` trùng no-op, `DELETE/remove` trùng no-op (không dùng tap-again mơ hồ). Owner vẫn được remove reaction của chính mình để cleanup dù card vừa bị fence/revoke, nhưng không được đọc lại card/actor list qua đường đó. Block gỡ/ẩn reaction hai chiều ngay; fence/revoke làm reaction không đọc/notify được; Person erasure xoá/anonymize reaction theo USR-OQ-3; trước khi card row bị xoá phải cleanup/anonymize reaction để không dangling; per-actor + per-card rate-limit và abuse audit. Reaction không sinh notification tới khi DD-70 có person-directed global path.

Lý do defer comment: DD-55 đã nâng block/report/rate-limit thành **hard enablement gate** cho open-DM. Comment công khai dưới card có bề mặt lạm dụng **rộng hơn** DM (người lạ, hiển thị cho bên thứ ba, khó gỡ). Mở comment trước khi có moderation là đi ngược chính gate mình vừa dựng.

> ⚠️ **Không tái dùng CHT-OQ-2 làm gate.** CHT-OQ-2 (`feature_inapp_chat.md`) hỏi về **quyền moderation của host trong club channel** (xoá/ẩn/mute) — một surface **tenant-scoped có chủ sở hữu rõ ràng**. Comment dưới activity card sống ở **global plane, không có host nào sở hữu**: ai xoá, ai nhận report, ai chịu trách nhiệm pháp lý đều chưa có câu trả lời. Đây là **open question mới**, phải mở khi/nếu owner muốn ship comment — không phải mục đã có sẵn để dựa vào.

---

## 7. DD-78 — Ảnh share mặc định do Plexco render

> **Yêu cầu owner (18/07):** *"mỗi player đều share được activity của mình với ảnh mặc định từ Plexco"*.

### 7.1 Vì sao "ảnh mặc định" là lựa chọn đúng, không phải giải pháp tạm

Strava có ảnh vì có **route GPS** để vẽ bản đồ, hoặc ảnh người dùng chụp. Plexco **không có cả hai**: không track GPS, và **DD-48 đã chốt `avatar` excluded tới khi có model**. Nghĩa là hiện **không tồn tại nguồn ảnh cá nhân hợp lệ nào** — ảnh mặc định do Plexco render không phải fallback, nó là **lựa chọn duy nhất đúng** với contract hiện tại.

Và nó tốt hơn upload ở đúng những chỗ dự án này quan tâm:

| Rủi ro nếu cho upload phase-1 | Ảnh render mặc định |
|---|---|
| Moderation **media/caption UGC** công khai (khó hơn DM — xem §6) | Không nhận upload/caption ⇒ không cần media-moderation pipeline mới; canonical text vẫn phải sanitize + có report/takedown |
| **EXIF chứa toạ độ GPS chính xác** của sân → phá thẳng DD-06 (`area`-only) | Không có EXIF |
| Storage/bandwidth abuse, quota, malware scan | Ảnh deterministic, cache được, không nhận byte từ user |
| Bản quyền / ảnh người khác trong khung hình | Không phát sinh |

### 7.2 Contract đề xuất

1. **Ảnh = server-rendered template**, sinh từ **đúng guarded snapshot đã whitelist** (`public_session_share_v` cho card kèo DD-73; `public_activity_cards_v`/protected card function cho DD-75). Renderer **không** query bảng canonical; active safety fence làm snapshot unavailable chứ không thêm field — cùng lý do cấu trúc ở §2.3.
2. **⚠️ Tách hẳn khỏi media store DD-55.** Chat media nhận byte UGC, private + signed read + malware scan. Share-card subsystem chỉ render server-side: session/`published+public` dùng **public URL/CDN namespace qua guarded origin**; draft/followers dùng protected ephemeral path. Object store phía sau **không anonymous-readable/listable**, chỉ renderer/origin credential đọc được; object key không được là alternate public URL. Cả namespace/credential/endpoint đều tách khỏi chat media và **không tái dùng `/api/chat/media/:id/access`**; nếu dùng chung, một lỗi grant có thể rò DM ra internet.
3. **Một template system versioned**, dùng design tokens + sport icon/palette variant theo `sports` (DD-08). Không bắt mỗi môn phải có layout/asset riêng trước khi có share-CTR evidence; unknown sport dùng generic variant, không fail. Bespoke per-sport layout là additive optimization sau telemetry.
4. **Renderer input/output sandbox:** mọi text NFC-normalize, strip/reject control + bidi-override chars, enforce grapheme/byte limits và context-escape; không raw HTML/SVG/CSS/URL interpolation. Template chỉ dùng fixed bundled fonts/icons/assets từ read-only allowlisted directory; worker không network egress, cloud metadata, arbitrary filesystem hay secret access. Output chỉ raster PNG với exact MIME/dimensions, metadata stripped — không serve SVG/HTML động. Sanitation business-rule và context escaping là hai lớp khác nhau, đều bắt buộc.
5. **Deterministic internal key, opaque public URL:** render/cache key nội bộ theo `(session_id,public_projection_version,locale,template_version)` hoặc `(card_id,card_version,locale,template_version)`, nhưng public image path chỉ mang domain-separated HMAC/opaque `image_ref` (không raw `card_id`, source/tenant/person id). Mỗi current public version có ref riêng; correction tạo ref/URL mới **và** invalidate/purge mọi version cũ theo §4.3.
6. **Authorization-before-cache là source of truth:** mọi request, kể cả CDN cache hit, qua guarded delivery/origin gate trước byte cache. Session image chỉ trả khi guarded session view còn đúng current `public_projection_version`; activity image chỉ khi global card có `card_state='published'`, `audience='public'`, requested `card_version` current và không bị fence deny. Old version/active fence/downgrade/revoke/projection loss đều fixed 404 dù purge lỗi; direct object URL không tồn tại.
7. **Chỉ pre-render public khi snapshot `published+public`; không render public on-demand theo crawler request.** Publish/followers→public render private staging rồi verify-current/CAS trước activate; render lỗi/fingerprint đổi ⇒ chưa public, cleanup, status `PUBLISHING`/failed và không URL. Benign correction dùng cùng flow; privacy-reducing correction/downgrade/revoke deny old version trước rồi purge/render current, chấp nhận image tạm 404. Draft/followers chỉ authenticated protected render, không public CDN namespace/URL.
8. **i18n (HR5):** text trên ảnh qua `t(vi,en)`, locale lấy từ link (`?l=vi|en`), không từ `Accept-Language` crawler.
9. **Tách money boundary:** activity image không `price_amount`/charge/allocation/nợ. Session image chỉ `price_amount` đã ở BL-DSC-1/`public_sessions`; không đọc charge/debt/allocation. Mọi ảnh cấm co-participant, exact venue, avatar, membership tag, raw attendance.
10. **Branding = distribution:** logo + CTA Plexco trên ảnh là acquisition loop DD-73/74. Đo bằng opaque `share_ref`, không nhúng person/tenant id vào public URL.

### 7.3 Quyền publish thuộc về player

"Mỗi player **đều** share được" ⇒ mỗi player đủ eligibility ở §3.2.1 có đường Person-self để publish, **không cần host duyệt**. Ranh giới phase-1: player quyết card của mình, card không có tên CLB và tenant không có attribution setting/field. Nếu attribution được bật về sau, tenant chỉ quyết consent thương hiệu chứ không được publish/chặn thay player; player cũng không được tự gắn thương hiệu CLB. Player chưa chứng minh được Person-self phải đi link/claim flow DD-50 trước — không hạ authz để đạt khẩu hiệu "mọi player".

### 7.4 Phase-2 (không chốt bây giờ)

Cho upload ảnh riêng **chỉ khi** đã có đủ media safety stack DD-55 **và** một quyết định riêng cho ảnh **công khai**: EXIF strip bắt buộc, moderation trước khi hiển thị, takedown path. Ảnh công khai khó hơn ảnh trong DM — không suy ra từ DD-55.

---

## 8. Invariants (✅ đã chốt cùng cluster)

1. **HR2 — whitelist theo surface:** activity card/feed/image không bao giờ chứa `price_amount`/charge/allocation/nợ; session share card chỉ được dùng `price_amount` đã project trong BL-DSC-1, không charge/debt/allocation. Cả hai cấm PII người chơi (`SĐT/email/gender/dob`; `gender_restriction` là session policy được phép), venue chính xác, roster/co-participant phase-1, membership tag, raw attendance/reliability và chi tiết organize (trừ ngoại lệ §3.3).
2. **HR3 — một writer:** chỉ projector ghi `person_activity_cards`. User ghi `player_activity_shares` (ý định). Không có đường thứ hai.
3. **HR1 — feed không chạm tenant plane.** Không `UNION` cross-plane trong SQL; hợp nhất (nếu cần) ở service layer.
4. **Fail-closed:** actor/source/attendance=`present`/eligibility không chứng minh được ⇒ **không publish**, không đoán. `persons.display_name` trống ⇒ không project; không fallback sang membership/tenant alias.
5. **Revoke ở Plexco là thật nhưng không hứa xoá bản sao ngoài:** slug + mọi version tombstone 404, không tái dùng, purge CDN; screenshot/download/cache bên thứ ba không thu hồi được và phải được cảnh báo trước publish.
6. **HR5 — i18n:** mọi chuỗi trên card/feed/OG image qua `t(vi,en)`; locale từ link, không từ crawler.
7. **Ordering/reconcile:** `publication_version` là total order cho lifecycle; correction event chỉ wake reconcile. Projector serialize theo source key, lock + re-read current canonical inputs; stale/duplicate không apply payload cũ, impossible version regression/fingerprint mismatch fail closed + audit.
8. **Public URL ≠ public bucket:** object store private-to-origin; guarded delivery re-authorize current projection/card version **trước mọi cache hit/fetch** và trả fixed 404 khi state/version mất hiệu lực, độc lập với CDN purge.
9. **Immediate denial:** privacy-reducing source mutation raise/replace global safety-fence token cùng transaction; public/follower/feed/image path kiểm tra fence. Projector chỉ clear exact token sau convergence; stale worker không mở lại dữ liệu.
10. **Renderer injection boundary:** typed allowlisted input + Unicode/control limits + context escaping; fixed local assets; no renderer egress/secrets; raster-only output. Canonical sanitation không thay thế output-context escaping.

---

## 9. Dependencies & thứ tự đề xuất

| Cụm | Chặn bởi | Sớm nhất |
|---|---|---|
| DD-73 share link + OG | (1) marketplace projector hoạt động — **DD-12 ở P4.3**; (2) **DD-41/DD-32 projection migrations** (BL-DSC-1 target fields chưa có đủ trong `public_sessions`); (3) khối fence/guarded-view/narrow-functions/`public_projection_version`/grant migration — **nay thuộc DD-12 (Q5 re-scope)**, DD-73 chỉ là consumer | **P4.3** (không thể sớm hơn blocker). Vẫn là phần rẻ nhất cụm về **rủi ro/quyết định**, nhưng **không còn là “không có bảng mới”** — xem §4.2/§10 |
| DD-74/75 activity + publish | Session CRUD + DD-42 attendance | Sau P4 |
| DD-74 v2 (match stats) | DD-61/62 (post-P4) + **amend DD-64** | Post-P4 |
| DD-76/77 feed + kudos | **DD-47/48**, DD-55, DD-75 + **product-evidence gate §5.1** | P4+ sau baseline/ngưỡng owner |
| DD-78 ảnh share | template asset + guarded origin/object store private-to-origin tách DD-55 | **Đi kèm từng consumer**: card kèo cùng DD-73 (P4.3), card activity cùng DD-75 (sau P4). Không phải một slice độc lập — nhưng renderer/contract viết một lần, dùng chung |

**Ghi chú giá trị sản phẩm:** DD-73 phục vụ **acquisition** (link kèo lan ra Zalo/Messenger → discovery), thẳng hàng với KPI "% player join qua discovery" (BRD §4.2) và với gate product-evidence #2 của DD-69. DD-74..77 phục vụ **retention** (gate #1). Đây là hai bài toán khác nhau — không nên gộp thành một slice.

---

## 10. Downstream propagation còn lại (owner đã chốt 19/07 — **chưa thực hiện**)

- `features/feature_marketplace_discovery(.md/_tech)` — share route + OG contract (DD-73).
- Cặp mới `feature_activity_share(.md/BE/_tech)` hoặc mở rộng `feature_user_settings` (DD-74..77) — quyết định lúc chốt, không tạo file trước.
- `features/feature_user_settings.md` — neo **USR-OQ-4** là vẫn mở (card không mở profile aggregate) và **giữ USR-OQ-8 mở**; phase-1 activity card không hiện co-participant.
- `features/feature_user_settings.md` USR-OQ-3/legal matrix — chốt SLA scrub global snapshot/render artifact sau revoke/erasure; tombstone hash tối thiểu được giữ để chống URL sống lại.
- `features/feature_session_organize(.md/_tech)` + **DD-64** — ghi ngoại lệ self-aggregate §3.3.
- `standards/business-rules.md` — BL mới cho whitelist card + revoke.
- `schema.ts` + migration **monotonic sau migration mới nhất đã merge tại thời điểm mở slice**: activity stores + generic denial-only `public_projection_fences`, guarded views, narrow raise/CAS-clear functions, `public_projection_version`; **revoke current `readonly` SELECT trên base `public_sessions`**, grant guarded view; base/fence/activity-card tables không grant `readonly`. Hiện `0014_players_waitlist.sql` mới commit tại `1a6ac38` trên `feat/session-waitlist-expand`, chưa có trên `main`@`22c23aa`; slice tương lai phải sync merged prerequisites rồi chọn next available number — không sửa migration lịch sử/hardcode số trước slice + DBML + ERD.
- CI invariant test **phải land trước** khi bật projector (khuôn DD-70).

---

## 11. Test fixtures (bắt buộc khi build)

1. Kèo private → `/s/<id>` trả generic, **không** phân biệt được với id không tồn tại.
2. Kèo public → card chỉ chứa đúng BL-DSC-1; bytes không exact venue/roster/PII/charge/debt/allocation. `price_amount` chỉ từ `public_sessions`. Malicious title/host/club text không thoát HTML text/attribute context, không đổi canonical/OG URL. Activity bytes không money/caption; actor name chỉ từ snapshotted `persons.display_name` (assert payload thật, không chỉ type).
3. Huỷ/private/close kèo → source transaction raise fence; guarded marketplace/landing/image trả generic/404 ngay **trước khi projector chạy**. `readonly` SELECT base `public_sessions` bị deny, chỉ guarded view được grant. Projector hội tụ rồi chỉ CAS-clear exact token; stale worker không clear fence mới. Bản sao đã ra ngoài vẫn bounded bởi cảnh báo/TTL/purge.
4. Publish authority: arbitrary `person_id/player_id` bị reject; verified actor resolve sai/ambiguous bị reject; chỉ session ended + attendance=`present` publish được; waitlisted/no_show/unknown/cancelled không publish.
5. Attendance `present→no_show/unknown` hoặc session cancelled sau publish → cùng source transaction raise `deny_scope='all'`; active slug + mọi image version bị global read gate 404 ngay, rồi projector revoke/purge; không auto-republish khi source eligible lại. Nếu owner explicit public lại sau khi hợp lệ, mint slug mới; old slug vẫn 404.
6. Safe correction → `card_version` mới, `published_at` giữ nguyên; staged render chỉ activate nếu re-lock/CAS còn đúng `publication_version+source_fingerprint`; source đổi giữa render ⇒ discard/cleanup và retry. Revoke/downgrade trong lúc render ⇒ CAS fail, không resurrect public card/slug. Name/attribution/privacy-reducing correction deny old image trước (new image được phép tạm 404); slug chỉ resolve current snapshot.
7. Card `followers`: A follow B (accepted) đọc được; A unfollow/block → mất quyền ngay lần đọc kế; card/image không có stable unauthenticated URL/object. Draft không có public URL; explicit public card của private profile không mở profile route/aggregate.
8. Phase-1 snapshot/bytes **không có co-participant name/avatar** dù cả hai cùng publish; USR-OQ-8 vẫn mở.
9. Club attribution **phase-1**: test là **absence** — không setting, không field, không đường nào khiến tên CLB lên card. (Test toggle dual-consent chỉ thêm khi/nếu bật ở phase sau; khi đó:) rút consent → raise all-fence cùng transaction, mọi ảnh/card cũ có attribution bị deny trước re-project; projector chỉ clear observed token sau bản không tên CLB; personal tenant luôn OFF.
10. Source provenance: hai card khác nhau của cùng Person cùng tồn tại; duplicate source event idempotent; merge Person không collapse activity khác source.
11. Grants/fence authz: `readonly` bị từ chối trên base card/fence và chỉ đọc guarded view; tenant A không raise fence cho target tenant B/person-global, app không clear/đọc token, token không log/DTO; only typed source functions + projector-worker exact-token clear. Guarded view chỉ `card_state='published' AND audience='public'` anti-join fence.
12. Kudos explicit add/remove idempotent; add/list đi qua guarded visibility nên active fence deny như card không tồn tại; own-remove vẫn cleanup được mà không mở card/actor list; block/revoke/Person-erasure visibility; rate-limit; không lộ actor ngoài audience; không notify trước DD-70; cleanup/anonymize reaction trước card deletion.
13. **Ảnh (DD-78):** draft/followers không public URL/object; public intent `PUBLISHING` và không URL tới staged render+CAS; failure không active slug/card. Inputs như `<script>`, SVG/CSS/url(), bidi override, control chars, overlong Unicode không execute/fetch/read secret; output raster PNG exact MIME/dimensions, metadata-free. Generic/sport variant không throw; old version 404; không dùng chat-media endpoint/bucket.
14. Telemetry: known crawler không tính human view; `share_ref` không cấp join; join outcome re-check live canonical service; analytics payload không PII/raw tenant/person ids.
15. Person erasure/source deletion → atomically raise all-fence + durable revoke trước source delete, public 404 ngay dù projector chưa chạy; snapshot/render content scrub theo retention gate; trước khi card row bị xoá, old slug tombstone detach `card_id=NULL`; hash/state tối thiểu không chứa PII và không thể reactivate.
16. Projector ordering: apply revoke/downgrade ở `publication_version=N`, rồi deliver correction wake-up cũ quan sát `N-1` → worker re-read current `N` và giữ revoke/downgrade; không apply event payload. Hai correction từ khác aggregate giao ngược thứ tự vẫn hội tụ về current locked sources; duplicate current fingerprint/hash no-op; version regression hoặc same fingerprint khác snapshot hash → integrity fault/audit. Raise fence token B sau khi worker quan sát token A ⇒ worker A không CAS-clear B.
17. Origin/cache: public image URL không chứa raw card/source/person/tenant id và object-store URL không anonymous-read được; active session/activity fence hoặc correction/revoke/projection removal bị gate **trước simulated CDN cache hit** và trả fixed 404 cho old/current-invalid ref ngay cả khi purge giả lập thất bại.

---

## 12. Sáu câu hỏi — ✅ ĐÃ CHỐT (owner 2026-07-19)

| # | Câu hỏi | Chốt | Ghi chú |
|---|---|---|---|
| 1 | Card cá nhân có gắn **tên CLB**? | **(a) Phase-1 KHÔNG gắn** | Dual-consent = đích đến, thêm sau bằng đường additive; ở phase-1 nó cho ra cùng hành vi nhưng tốn 2 setting/2 UI |
| 2 | Activity mới là draft hay auto-publish? | **(a) `draft` + chọn audience khi publish** | **Không** auto-publish kể cả opt-in; muốn mở phải **amend DD-75** (mâu thuẫn confirm-per-publish) |
| 3 | Comment ship cùng kudos? | **(a) Kudos trước, defer comment** | Comment cần DD-55 stack + **OQ moderation mới** cho surface global-plane không-có-host |
| 4 | Amend DD-64 cho self-aggregate v2? | **(a) Amend, accept-in-principle** | Exact field chốt tại build cùng DD-61/62; DD-64 đã ghi amendment |
| 5 | DD-73 tách slice riêng? | **(a) Tách — kèm RE-SCOPE** | Fence/guarded-view/narrow-functions/`public_projection_version`/grant migration **→ DD-12/marketplace**; DD-73 = route + OG + telemetry |
| 6 | Ảnh: template hay upload? | **(a) Chỉ template** | Upload chỉ mở khi có DD-55 media stack **và** quyết định riêng cho ảnh công khai (EXIF strip · moderation · takedown) |

**Cross-cutting:** chốt contract **≠** mở lịch build. Chỉ **(8a) fence/guarded-view thuộc DD-12** và **(8b) DD-73** vào hàng đợi ngay. DD-74/75 chưa tự động vào queue: mở sau dependency kỹ thuật và một lần ưu tiên lại bằng telemetry DD-73, rồi chính chúng tạo baseline activity. **Chỉ DD-76/77** nằm sau product-evidence/liquidity gate ở §5.1. DD-78 không có queue độc lập: ảnh session đi cùng DD-73; ảnh activity đi cùng DD-75.

---

## Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
| 28/07/2026 | v1.2 | Re-pin current-state note to `main@784bc8d`; Chat authority/readiness docs after `2dc9b8c` do not add share/activity runtime or change DD-73–78 sequencing. |
| 28/07/2026 | v1.1 | Sync additive DD-32 public aggregate vào exact BL-DSC-1 mirror: `confirmed_count=active`, `slots_open=capacity-active-live holds`, hold count/identity private; live `public_sessions` vẫn thiếu field mới nên projection migration remains a hard dependency. No runtime. |
| 19/07/2026 | v1.0 | **Sequencing/scope correction (decisions v1.64).** Gỡ vòng lặp “DD-74/75 sau gate nhưng gate cần baseline DD-74/75”: DD-73 acquisition trước; DD-74/75 sau dependency + reprioritization để tạo activity baseline; chỉ DD-76/77 hard-gated bởi liquidity; DD-78 đi cùng consumer. Q1 phase-1 no-club-attribution nay loại luôn target/function/flag consent chưa dùng khỏi schema phase-1, chỉ thêm additive khi bật. Kudos add/list bắt buộc guarded visibility/fence; own-remove cleanup vẫn được; reaction cleanup trước card deletion. Đồng bộ current authority + grant wording. |
| 19/07/2026 | v0.9 | **Owner chốt 6 câu (2026-07-19) → decisions v1.60.** Q1 **(a)** không gắn tên CLB phase-1 (dual-consent là đích đến, additive); Q2 **(a)** `draft` + chọn audience khi publish, không auto-publish; Q3 **(a)** kudos-only, defer comment; Q4 **(a)** amend DD-64 accept-in-principle; Q5 **(a) + re-scope**: fence/guarded-view/grant migration **chuyển về DD-12/marketplace**, DD-73 = route + OG + telemetry; Q6 **(a)** template-only. Sequencing wording của entry này được corrected ở v1.0. |
| 19/07/2026 | v0.8 | **Fence/surface fixes.** (1) `activity_card×session` chỉ raise khi `cancelled`/xoá — **không** theo `closed`/`private` (v0.7 như viết sẽ giết mọi card khi host đóng kèo, dù `closed` chính là nguồn eligible). (2) Thêm **blocker DD-41 projection migration** cho DD-73: BL-DSC-1 whitelist chưa có trong `public_sessions`. (3) `public_projection_version` được khai báo là ngoại lệ cột hợp lệ trong guarded view (DD-78 gate cần nó). (4) **Bỏ `GRANT SELECT` cho `readonly`** trên `public_activity_cards_v` — tránh danh bạ activity duyệt được không cần slug. |
| 19/07/2026 | v0.7 | **Revoke/origin/order integrity closure.** Thêm per-surface/target denial-only safety fence: privacy transition raise token cùng source transaction, global read deny ngay, projector CAS-clear exact token sau convergence — khép gap eventual-projector vs immediate revoke/private cho session/activity; guarded view thay `readonly` base access. Public image dùng opaque ref + authorization-before-cache/private origin. Lifecycle dùng `publication_version`; correction chỉ wake reconcile current multi-source fingerprint. DB↔renderer staging/CAS. Renderer sandbox typed/escaped Unicode-limited input, fixed local assets, no egress/secrets, raster-only. Slug detach tombstone; card payload scrub. Thêm fixtures fence/multi-source/order/render/injection/retention/cache. Đồng bộ decisions v1.56 + brief v0.4; vẫn proposal, không runtime/migration mới. |
| 19/07/2026 | v0.6 | **Plane-correctness + audit fixes.** (1) `person_activity_cards` có **`card_state ∈ published/revoked` riêng**; `draft` không bao giờ tạo global row; view/feed lọc `card_state`, không lọc `publication_state` (cột tenant) — bản v0.5 vô tình bắt view/feed join cross-plane, phá đúng invariant §8.3/DD-76. (2) §9 thêm dòng DD-78 (đi kèm consumer, không phải slice độc lập). (3) v1 field list thêm `activity_display_name`. (4) TL;DR DD-77 thêm qualifier evidence-gate. (5) §3.2 nêu rõ Q4 còn mở nên v2 chưa phải chuyện đã chốt. (6) Ghi rõ DD-48 approve *field* chứ chưa có *contract sanitation* — là dependency phải định nghĩa, không phải thứ có sẵn để reuse. |
| 19/07/2026 | v0.5 | **Review closure theo live identity/privacy/product contracts.** Pin Person-self + ended/present eligibility; v1 bỏ raw attendance, dùng scheduled duration/canonical sanitized name, không caption/co-participant. DD-75 tách lifecycle/audience; deterministic provenance + hash-only slug registry; profile/card privacy độc lập; followers/draft không public object; correction/revoke/erasure scrub + tombstone; bỏ DD-49 money trigger và tách public session price khỏi activity money ban. DD-73 thêm join revalidation + privacy-safe telemetry. DD-76/77 thêm evidence gate + kudos abuse/erasure controls. DD-78 dùng one template system, sport variants, protected preview/follower render và invalidate old public versions. Đồng bộ founder brief + decisions v1.53; vẫn proposal, không runtime/migration mới. |
| 19/07/2026 | v0.4 | **Consistency pass sau khi repo di chuyển.** Sửa 6 điểm: (1) điều kiện render `/s/<id>` viết lại thành **hệ quả** — `public_sessions` không có cột `visibility`/`status` nên route không được tự check (nếu check là buộc đọc `sessions`, phá chính ràng buộc của DD-73); (2) tách `gender` người chơi (cấm) khỏi `gender_restriction` (session policy, được phép); (3) DD-73 phase **P4.3** theo blocker DD-12, không phải P4; (4) `0014_players_waitlist` **đã commit tại `1a6ac38` trên `feat/session-waitlist-expand`, chưa merge `main`@`22c23aa`** (expand-only, logic chưa build); (5) revoke chốt **404 đồng nhất**, bỏ 410 vì 410 tiết lộ card từng tồn tại; (6) thêm §3.5 — **card ≠ profile field**, publish card KHÔNG mở DD-48 open item (1). |
| 18/07/2026 | v0.3 | **Thêm DD-78 — ảnh share mặc định do Plexco render** (yêu cầu owner). Không upload phase-1 (EXIF-GPS phá DD-06, moderation ảnh công khai, storage abuse); **tách hẳn bucket/endpoint khỏi media store DD-55** vì access semantics ngược nhau; template per-sport + design tokens; URL immutable theo `card_version`, pre-render lúc publish. Pin **quyền publish thuộc player**, tenant chỉ kiểm soát club attribution. Đổi tên file `dd-73-77-*` → `dd-73-78-*`; renumber §7..§12. |
| 18/07/2026 | v0.2 | **Verify pass (đối chiếu canonical).** Whitelist card → `BL-DSC-1` thay vì DDL `0006` (`skill_level` đã retire theo DD-41, +8 session-policy field); sửa mô tả `used_count` của DD-44; `players` = per-membership và `waitlisted` chưa migrate; CHT-OQ-2 không phải gate cho comment global-plane; sửa citation `0006`/`0009`. Xem §0.1. |
| 18/07/2026 | v0.1 | Khởi tạo. Phân tích share session + activity per player + feed/kudos tham chiếu Strava; đề xuất DD-73..77 🟡. Không migration, không đổi code-readiness, không sửa spec Reviewed. |
