# Quyền riêng tư của Plexco — BẢN NHÁP — chờ pháp lý duyệt, chưa publish

> **⚠️ BẢN NHÁP — chờ pháp lý duyệt, chưa publish.** Bản này chưa được liên kết từ sản phẩm và chỉ được publish sau khi pháp lý duyệt và owner trả lời [S1][S2][S3]. Mọi câu nêu sự kiện đều có nguồn trong bảng nguồn ở cuối file. Tám điểm pháp lý được để trống ở §10 [S4].

## 1. Phạm vi

Bản nháp này mô tả dữ liệu của sản phẩm Plexco trên ứng dụng web và trên kênh bot Zalo [S5][S6][S7].

> **[ĐỂ TRỐNG — CHỜ OWNER — bên vận hành dịch vụ]**

## 2. Dữ liệu Plexco lưu

Bảng dưới theo schema và migration hiện tại; mục đích chỉ được ghi khi nguồn ghi rõ.

| Loại dữ liệu | Plexco lưu gì, ở dạng nào |
| --- | --- |
| Tên | Tên hiển thị trên hồ sơ của bạn; với mỗi CLB bạn là thành viên: một tên hiển thị, một mã thanh toán (pay code) và trạng thái thành viên [S8][S9][S10][S11]. |
| Giới tính | Giới tính tự khai, lưu dạng bản mã AES-256-GCM gắn với từng người, cùng lựa chọn cho phép CLB dùng giới tính để tính giá, mặc định là không cho phép; mục đích là tính giá (xem §6) [S12][S13][S14]. |
| Danh tính đăng nhập Google | Mã định danh Google chỉ lưu dạng hash có khoá; email Google lưu dạng hash để tra cứu và dạng mã hoá [S15][S16][S17][S18]. |
| Phiên đăng nhập web | Hash của mã phiên, một khoá bí mật CSRF, thời điểm hết hạn và thời điểm hoạt động gần nhất [S19][S20][S21][S22]. |
| Danh tính Zalo và mã liên kết | Mã người dùng Zalo và tên người dùng Zalo lưu dạng mã hoá, kèm một hash để tra cứu; mã liên kết chỉ lưu dạng hash, kèm thời điểm hết hạn [S23][S24][S25][S26][S27][S28]. |
| Tham gia buổi chơi | Trạng thái của bạn trong từng buổi (đang tham gia, đã rời, hoặc trong danh sách chờ) và thời điểm tham gia [S29][S30]. |
| Địa điểm do host nhập | Tên sân, địa chỉ sân và khu vực của buổi, cùng tuỳ chọn ẩn địa chỉ chính xác, mặc định tắt (xem §5) [S31][S32][S33][S34]. |
| Ghi nhận tiền | Khoản phải trả và số đã ghi nhận; mỗi lần ghi tiền lưu số tiền, nguồn ghi và người ghi (xem §7) [S35][S36][S37][S38][S39]. |
| Chat CLB | Nội dung tin nhắn, người viết, thời điểm sửa và thời điểm người viết xoá tin [S40][S41][S42][S43]. |
| Bộ đếm giới hạn tần suất | Cho danh sách khám phá ẩn danh: số lượt theo từng cửa sổ thời gian và theo khoá [S44][S45][S46][S48]. Khoá là chính địa chỉ IPv4 của máy khách, hoặc dạng /64 của địa chỉ IPv6 của máy khách (bốn nhóm hextet đầu), hoặc một giá trị dự phòng cố định; khoá được lưu nguyên dạng theo từng cửa sổ [S47][S143][S144][S145]. Với địa chỉ IPv6, mỗi cửa sổ còn đếm theo ba nhóm hextet đầu, cũng lưu nguyên dạng [S143][S145]. |
| Nhật ký kiểm toán đăng nhập | Nhật ký chỉ ghi thêm: loại sự kiện, tài khoản, nhóm kết quả và mã tham chiếu của yêu cầu [S49][S50][S51][S52][S53]. |

## 3. Đăng nhập bằng Google

- Ứng dụng web cho đăng nhập bằng tài khoản Google và chỉ xin Google phạm vi openid và email [S54].
- Plexco không lưu tên lấy từ tài khoản Google; người dùng mới bắt đầu với tên hiển thị trống [S55][S56].
- Mã định danh Google và email Google được lưu như ở §2 [S15][S17][S18].
- Sau khi đăng nhập, phiên được giữ bằng cookie (xem §9) [S131].

## 4. Zalo

- Bạn có thể liên kết Zalo với tài khoản Plexco bằng một mã liên kết [S5][S26][S57].
- Khi liên kết xong, giao diện hiện: "Đã liên kết Zalo với tài khoản Plexco của bạn." [S5]
- Danh tính Zalo được lưu như ở §2 [S23][S25].
- Bot Zalo gửi bốn loại tin: buổi được cập nhật, buổi bị huỷ, thông báo của buổi, và người chơi được đôn lên [S58][S59][S60][S61].
- Tin cập nhật chỉ được gửi khi buổi đổi giờ, địa điểm hoặc giá [S62][S63][S64][S65].

## 5. Thông tin công khai

- Theo mặc định, địa điểm của buổi chơi là công khai [S66][S67].
- Danh sách khám phá ẩn danh chỉ hiện một buổi khi buổi đang mở, để công khai, chưa bắt đầu, có khu vực, và CLB có tên công khai đã được duyệt [S48][S68][S69][S70][S71][S72].
- Mỗi buổi trong danh sách đó cho thấy: môn, giờ bắt đầu và kết thúc, khu vực, giá, số chỗ còn trống, tên công khai đã duyệt của CLB, cách tham gia, tên sân và địa chỉ sân [S73][S74][S75][S76][S77][S78][S79][S80][S81][S82][S83].
- Danh sách công khai không lấy dữ liệu từ hồ sơ của người nào; tên hiển thị của host không có trong đó [S84].
- Host có thể bật, cho từng buổi, tuỳ chọn ẩn địa chỉ chính xác cho tới khi xác nhận; tuỳ chọn này mặc định tắt [S34][S85][S86].
- Khi tuỳ chọn bật, danh sách công khai không có tên sân và địa chỉ sân; người xem công khai chỉ thấy khu vực [S87][S88][S89].
- Khi tuỳ chọn bật, tên và địa chỉ sân chỉ được trả cho người có chỗ đang ở trạng thái tham gia trong buổi đó [S90][S91].

## 6. Giới tính

- Việc thu thập giới tính bật hay tắt theo một cờ cấu hình; chỉ giá trị "true" mới bật, và cờ được đọc ở mỗi lần gọi [S92].
- Kế hoạch ra mắt đặt cờ này ở trạng thái tắt trên môi trường người dùng thật đầu tiên [S93][S94].
- Ở cả hai trạng thái, bạn luôn xoá được giới tính và rút lại được sự cho phép [S95].
- Giới tính chỉ được đọc ra ở dạng rõ khi chính bạn xem hồ sơ của mình; nó không được ghi log và không hiện trong thông báo lỗi [S96].

**Khi cờ tắt** (trạng thái dự kiến lúc ra mắt):

- Ô giới tính và ghi chú quyền riêng tư về giới tính không hiện [S97][S98][S99].
- Hệ thống từ chối mọi giá trị giới tính khác rỗng và mọi lựa chọn cho phép [S100].

**Khi cờ bật:**

- Ô giới tính có các lựa chọn: Chưa đặt, Nam, Nữ, Khác, Không tiết lộ [S101][S102][S103][S104][S105].
- Ngay tại ô giới tính có thông báo ngắn về mục đích và sự cho phép [S146], vì việc thu thập giới tính được quyết định là phải đi kèm thông báo đó [S106]. Nguyên văn:
  - "Giới tính của bạn được dùng để tính giá khi CLB đặt giá theo giới tính cho một kèo." [S14]
  - "Việc đặt giới tính là tuỳ chọn; nếu để chưa đặt, bạn trả giá mặc định của kèo." [S107]
  - "CLB chỉ được dùng giới tính của bạn để tính giá nếu bạn đánh dấu ô bên dưới." [S108]
- Ô cho phép ghi nguyên văn: "Cho phép CLB sử dụng giới tính để tính giá" [S109].
- Trang cài đặt có ghi chú "Dữ liệu giới tính của bạn" [S110][S111]. Nguyên văn:
  - "Giới tính của bạn được lưu ở dạng mã hoá trên hồ sơ Plexco của bạn." [S112]
  - "Giới tính của bạn không được hiển thị cho CLB hay người chơi khác, và không xuất hiện trên bất kỳ trang công khai nào." [S113]
  - "CLB chỉ nhận mức giá được tính từ giới tính của bạn, không nhận chính giới tính đó; nhưng nếu CLB đặt giá riêng cho nam hoặc nữ, mức giá đó có thể cho CLB biết giới tính của bạn." [S114]
  - "Bạn có thể đổi giới tính đã đặt bất cứ lúc nào bằng cách chọn lựa chọn khác rồi lưu." [S115]
  - "Để xoá giới tính khỏi hồ sơ, đặt lại thành Chưa đặt rồi lưu; quyền dùng giới tính để tính giá cũng bị tắt theo." [S116]
  - "Để CLB ngừng dùng giới tính mà không xoá nó, bỏ đánh dấu ô cho phép rồi lưu." [S117]

Còn để trống: (điểm pháp lý 1/8, §10) và (điểm pháp lý 7/8, §10).

## 7. Tiền

- Bản MVP không có tích hợp ngân hàng [S118].
- Tiền chỉ được ghi thủ công, dưới dạng tiền mặt hoặc chuyển khoản có xác nhận, và có thể trả một phần [S119][S120][S121].
- Mỗi lần ghi tiền mặt hoặc chuyển khoản có xác nhận phải có người ghi và không gắn với giao dịch ngân hàng nào [S122][S123].
- Dữ liệu tiền được lưu như ở §2 [S35][S36][S37][S38][S39].

## 8. Đồng bộ trực tiếp, chat và thông báo

- Khu làm việc của host nhận cập nhật qua một luồng đồng bộ trực tiếp, xác thực bằng cookie [S124][S125].
- Mỗi khung tin của luồng đó chỉ mang mã định danh; luồng không bao giờ công khai và không mở cho người ẩn danh [S126][S127][S128].
- Chat của CLB có luồng trực tiếp chỉ cho thành viên; khung tin của luồng chỉ mang mã định danh; luồng này không bao giờ công khai và không ghi log [S129][S130].
- Tin nhắn qua bot Zalo: xem §4.

## 9. Cookie

- Ứng dụng web dùng một cookie phiên đăng nhập [S131].
- Trong lúc đăng nhập bằng Google, ứng dụng đặt một cookie ràng buộc cho lượt đăng nhập đó [S132][S133].
- Ngoài cookie: để giới hạn tần suất, ứng dụng lấy địa chỉ IP của máy khách từ một lớp biên tin cậy đã cấu hình (xem §2) [S134].

## 10. Tám điểm pháp lý

> **[ĐỂ TRỐNG — ĐIỂM PHÁP LÝ 1/8 — owner và luật sư điền]** Cơ sở pháp lý hoặc câu chữ tuân thủ cho việc thu thập giới tính. [S135]

> **[ĐỂ TRỐNG — ĐIỂM PHÁP LÝ 2/8 — owner và luật sư điền]** Thời hạn lưu giữ, và giới tính đã lưu được xử lý thế nào khi tài khoản đóng. [S136]

> **[ĐỂ TRỐNG — ĐIỂM PHÁP LÝ 3/8 — owner và luật sư điền]** Các tuyên bố về bên thứ ba, nhà cung cấp, bản sao lưu và việc giữ khoá. [S137]

> **[ĐỂ TRỐNG — ĐIỂM PHÁP LÝ 4/8 — owner và luật sư điền]** Đầu mối liên hệ về bảo vệ dữ liệu. [S138]

> **[ĐỂ TRỐNG — ĐIỂM PHÁP LÝ 5/8 — owner và luật sư điền]** Cam kết về thời hạn xoá dữ liệu. [S139]

> **[ĐỂ TRỐNG — ĐIỂM PHÁP LÝ 6/8 — owner và luật sư điền]** Nơi lưu trữ (hosting) dữ liệu. [S140]

> **[ĐỂ TRỐNG — ĐIỂM PHÁP LÝ 7/8 — owner và luật sư điền]** Giới tính có phải là một loại dữ liệu cá nhân nhạy cảm hay không. [S141]

> **[ĐỂ TRỐNG — ĐIỂM PHÁP LÝ 8/8 — owner và luật sư điền]** Có nên có một trang quyền riêng tư công khai, hoặc một luồng xem và rút lại sự cho phép, hay không. [S142]

## 11. Các mục khác còn để trống

> **[ĐỂ TRỐNG — CHỜ OWNER — tên pháp lý và địa chỉ của bên vận hành]**

> **[ĐỂ TRỐNG — CHỜ OWNER — ngày hiệu lực]**

> **[ĐỂ TRỐNG — CHỜ OWNER — cách thông báo khi trang này thay đổi]**

## Bảng nguồn (xoá trước khi publish)

| Mã | Nguồn | Đoạn trích |
| --- | --- | --- |
| S1 | docs/sessions/web-mvp-phase5-golive-plan.md:87 | `bản nháp chờ pháp lý duyệt` |
| S2 | docs/sessions/web-mvp-phase5-golive-plan.md:87 | `không publish trước câu trả lời của owner` |
| S3 | docs/sessions/web-mvp-phase5-readiness-p5-privacy-terms-draft.md:56 | `publishing or linking the drafts` |
| S4 | docs/sessions/web-mvp-phase5-golive-plan.md:51 | `lane L75 chỉ viết bản nháp và để trống tám điểm đó` |
| S5 | apps/web/components/me/link-code-view.tsx:29 | `Đã liên kết Zalo với tài khoản Plexco của bạn.` |
| S6 | packages/db/schema.ts:150 | `export const webSessions = pgTable("web_sessions", {` |
| S7 | apps/bot/src/projectors/zalo-dm-templates.ts:15 | `export const ZALO_DM_TEMPLATES` |
| S8 | packages/db/schema.ts:42 | `displayName: text("display_name"),` |
| S9 | packages/db/schema.ts:559 | `displayName: text("display_name"),` |
| S10 | packages/db/schema.ts:560 | `payCode: text("pay_code"),` |
| S11 | packages/db/schema.ts:561 | `status: text("status").notNull().default("active"), // active` |
| S12 | packages/db/schema.ts:49 | `self-declared gender as person-bound AES-256-GCM ciphertext` |
| S13 | packages/db/schema.ts:53 | `genderPricingConsent: boolean("gender_pricing_consent").notNull().default(false),` |
| S14 | apps/web/components/me/settings-profile-form.tsx:162 | `Giới tính của bạn được dùng để tính giá khi CLB đặt giá theo giới tính cho một kèo.` |
| S15 | packages/db/schema.ts:178 | `platformUserHash: text("platform_user_hash").notNull(),` |
| S16 | apps/web/app/api/auth/google/callback/route.ts:169 | `const subjectHash = await keyedHash(` |
| S17 | packages/db/schema.ts:294 | `emailLookupHash: text("email_lookup_hash").notNull().unique(),` |
| S18 | packages/db/schema.ts:295 | `emailEnc: bytea("email_enc").notNull(),` |
| S19 | packages/db/schema.ts:153 | `tokenHash: text("token_hash").notNull().unique(),` |
| S20 | packages/db/schema.ts:154 | `csrfSecret: text("csrf_secret").notNull(),` |
| S21 | packages/db/schema.ts:155 | `expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),` |
| S22 | packages/db/schema.ts:164 | `lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),` |
| S23 | packages/db/schema.ts:66 | `platformUserIdEnc: bytea("platform_user_id_enc").notNull(),` |
| S24 | packages/db/schema.ts:67 | `platformUserLookupHash: text("platform_user_lookup_hash").notNull(),` |
| S25 | packages/db/schema.ts:68 | `usernameEnc: bytea("username_enc"),` |
| S26 | packages/db/schema.ts:100 | `codeLookupHash: text("code_lookup_hash").notNull().unique(),` |
| S27 | packages/db/schema.ts:101 | `codeHash: bytea("code_hash").notNull(),` |
| S28 | packages/db/schema.ts:104 | `expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),` |
| S29 | packages/db/schema.ts:734 | `waitlisted (DD-45)` |
| S30 | packages/db/schema.ts:735 | `joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),` |
| S31 | packages/db/schema.ts:644 | `venueName: text("venue_name"),` |
| S32 | packages/db/schema.ts:645 | `venueAddress: text("venue_address"),` |
| S33 | packages/db/schema.ts:648 | `area: text("area"),` |
| S34 | packages/db/schema.ts:647 | `hideExactAddress: boolean("hide_exact_address").notNull().default(false),` |
| S35 | packages/db/schema.ts:1231 | `amountDue: integer("amount_due").notNull(),` |
| S36 | packages/db/schema.ts:1232 | `amountAllocated: integer("amount_allocated").notNull().default(0),` |
| S37 | packages/db/schema.ts:1318 | `amount: integer("amount").notNull(),` |
| S38 | packages/db/schema.ts:1319 | `source: text("source").notNull(),` |
| S39 | packages/db/schema.ts:1325 | `createdBy: uuid("created_by"),` |
| S40 | packages/db/schema.ts:1015 | `body: text("body").notNull(),` |
| S41 | packages/db/schema.ts:1013 | `authorPersonId: uuid("author_person_id").references(() => persons.id),` |
| S42 | packages/db/schema.ts:1017 | `editedAt: timestamp("edited_at", { withTimezone: true }),` |
| S43 | packages/db/schema.ts:1019 | `authorDeletedAt: timestamp("author_deleted_at", { withTimezone: true }),` |
| S44 | packages/db/schema.ts:220 | `export const discoveryRateLimitCounters = pgTable("discovery_rate_limit_counters", {` |
| S45 | packages/db/schema.ts:221 | `windowId: bigint("window_id", { mode: "number" }).notNull(),` |
| S46 | packages/db/schema.ts:223 | `hits: integer("hits").notNull(),` |
| S47 | packages/db/migrations/0075_discovery_rate_limit_definer.sql:79 | `a dotted IPv4, the /64 form (four padded` |
| S48 | apps/web/app/api/discover/route.ts:14 | `the anonymous discovery list` |
| S49 | packages/db/schema.ts:229 | `Shared append-only auth audit` |
| S50 | packages/db/schema.ts:240 | `eventType: text("event_type").notNull(),` |
| S51 | packages/db/schema.ts:241 | `accountId: uuid("account_id"),` |
| S52 | packages/db/schema.ts:243 | `outcomeClass: text("outcome_class").notNull(),` |
| S53 | packages/db/schema.ts:245 | `requestRef: text("request_ref").notNull(),` |
| S54 | apps/web/lib/google-oidc.ts:151 | `url.searchParams.set("scope", "openid email");` |
| S55 | apps/web/app/api/auth/google/callback/route.ts:196 | `displayName: null, // DD-26: no silent name persist from a provider claim` |
| S56 | packages/db/migrations/0073_member_name_length_cap_120.sql:236 | `INSERT INTO persons(display_name) VALUES` |
| S57 | apps/web/lib/me-link-client.ts:85 | `const res = await fetchImpl("/api/me/link", {` |
| S58 | apps/bot/src/projectors/zalo-dm-templates.ts:16 | `["session.updated", "updated"],` |
| S59 | apps/bot/src/projectors/zalo-dm-templates.ts:17 | `["session.cancelled", "cancelled"],` |
| S60 | apps/bot/src/projectors/zalo-dm-templates.ts:18 | `["session.announcement_requested", "announce"],` |
| S61 | apps/bot/src/projectors/zalo-dm-templates.ts:19 | `["player.promoted", "promoted"],` |
| S62 | apps/bot/src/projectors/zalo-dm-templates.ts:22 | `session.updated fields that warrant a DM` |
| S63 | apps/bot/src/projectors/zalo-dm-templates.ts:24 | `[["starts_at", "ends_at", "timezone"]` |
| S64 | apps/bot/src/projectors/zalo-dm-templates.ts:25 | `[["venue_name", "venue_address"]` |
| S65 | apps/bot/src/projectors/zalo-dm-templates.ts:26 | `[["price_amount"]` |
| S66 | docs/standards/decisions.md:135 | `Venue là PUBLIC theo mặc định` |
| S67 | packages/db/migrations/0067_session_venue_visibility.sql:1 | `the session venue is public by default; a per-session host` |
| S68 | packages/db/migrations/0067_session_venue_visibility.sql:263 | `AND v_status = 'open'` |
| S69 | packages/db/migrations/0067_session_venue_visibility.sql:264 | `AND v_visibility = 'public'` |
| S70 | packages/db/migrations/0067_session_venue_visibility.sql:265 | `AND v_starts_at > now()` |
| S71 | packages/db/migrations/0067_session_venue_visibility.sql:266 | `AND btrim(coalesce(v_area, '')) <> ''` |
| S72 | packages/db/migrations/0067_session_venue_visibility.sql:267 | `AND v_alias_status = 'approved'` |
| S73 | packages/db/migrations/0067_session_venue_visibility.sql:382 | `GRANT SELECT ON public.public_session_share_v TO readonly;` |
| S74 | packages/db/migrations/0067_session_venue_visibility.sql:168 | `ps.sport_key,` |
| S75 | packages/db/migrations/0067_session_venue_visibility.sql:169 | `ps.starts_at,` |
| S76 | packages/db/migrations/0067_session_venue_visibility.sql:170 | `ps.ends_at,` |
| S77 | packages/db/migrations/0067_session_venue_visibility.sql:171 | `ps.area,` |
| S78 | packages/db/migrations/0067_session_venue_visibility.sql:172 | `ps.price_amount,` |
| S79 | packages/db/migrations/0067_session_venue_visibility.sql:173 | `ps.slots_open,` |
| S80 | packages/db/migrations/0067_session_venue_visibility.sql:174 | `t.public_alias AS club_display_name,` |
| S81 | packages/db/migrations/0067_session_venue_visibility.sql:175 | `ps.join_policy,` |
| S82 | packages/db/migrations/0067_session_venue_visibility.sql:184 | `ps.venue_name,` |
| S83 | packages/db/migrations/0067_session_venue_visibility.sql:185 | `ps.venue_address` |
| S84 | packages/db/schema.ts:1714 | `host_display_name (persons are never projected) were dropped by 0061.` |
| S85 | packages/db/migrations/0067_session_venue_visibility.sql:6 | `unless the host turns ON the new per-session option "hide exact address until confirmed"` |
| S86 | packages/db/migrations/0067_session_venue_visibility.sql:7 | `(sessions.hide_exact_address, default OFF)` |
| S87 | packages/db/migrations/0067_session_venue_visibility.sql:249 | `CASE WHEN s.hide_exact_address THEN NULL ELSE s.venue_name END,` |
| S88 | packages/db/migrations/0067_session_venue_visibility.sql:250 | `CASE WHEN s.hide_exact_address THEN NULL ELSE s.venue_address END` |
| S89 | packages/db/migrations/0067_session_venue_visibility.sql:8 | `the public sees the area only` |
| S90 | packages/db/migrations/0067_session_venue_visibility.sql:2 | `option hides the exact address until the viewer holds an active seat.` |
| S91 | packages/db/migrations/0067_session_venue_visibility.sql:103 | `own seats; with sessions.hide_exact_address ON the venue never leaves the database` |
| S92 | apps/web/app/api/me/profile/route.ts:32 | `const genderCollection = () => process.env.GENDER_COLLECTION_ENABLED === "true";` |
| S93 | docs/sessions/web-mvp-phase5-golive-plan.md:243 | `G4 production up, giới tính tắt` |
| S94 | docs/standards/decisions.md:1898 | `đặt false ở môi trường người dùng thật đầu tiên` |
| S95 | apps/web/app/api/me/profile/route.ts:20 | `erase (gender null) and withdraw (genderConsent false) always pass.` |
| S96 | apps/web/app/api/me/profile/route.ts:12 | `self-read is the ONLY plaintext exit of gender: never logged, never echoed in an error;` |
| S97 | docs/standards/decisions.md:1898 | `ở môi trường đó ô giới tính và notice không hiện` |
| S98 | apps/web/components/me/settings-profile-form.tsx:142 | `{initial.genderCollection ? (` |
| S99 | apps/web/components/me/settings-privacy-note.tsx:9 | `SettingsView renders it only while gender collection is on.` |
| S100 | apps/web/app/api/me/profile/route.ts:19 | `OFF rejects a non-null gender or genderConsent true with INVALID_BODY;` |
| S101 | apps/web/components/me/settings-profile-form.tsx:149 | `{ value: "", label: t("Chưa đặt", "Not set") },` |
| S102 | apps/web/components/me/settings-profile-form.tsx:65 | `male: t("Nam", "Male"),` |
| S103 | apps/web/components/me/settings-profile-form.tsx:66 | `female: t("Nữ", "Female"),` |
| S104 | apps/web/components/me/settings-profile-form.tsx:67 | `other: t("Khác", "Other"),` |
| S105 | apps/web/components/me/settings-profile-form.tsx:68 | `undisclosed: t("Không tiết lộ", "Prefer not to say"),` |
| S106 | docs/standards/decisions.md:133 | `gender collection phải đi kèm thông báo ngắn về consent / mục đích tại điểm thu thập` |
| S107 | apps/web/components/me/settings-profile-form.tsx:166 | `Việc đặt giới tính là tuỳ chọn; nếu để chưa đặt, bạn trả giá mặc định của kèo.` |
| S108 | apps/web/components/me/settings-profile-form.tsx:170 | `CLB chỉ được dùng giới tính của bạn để tính giá nếu bạn đánh dấu ô bên dưới.` |
| S109 | apps/web/components/me/settings-profile-form.tsx:185 | `Cho phép CLB sử dụng giới tính để tính giá` |
| S110 | apps/web/components/me/settings-privacy-note.tsx:8 | `/me/settings privacy note for gender data` |
| S111 | apps/web/components/me/settings-privacy-note.tsx:19 | `Dữ liệu giới tính của bạn` |
| S112 | apps/web/components/me/settings-privacy-note.tsx:22 | `Giới tính của bạn được lưu ở dạng mã hoá trên hồ sơ Plexco của bạn.` |
| S113 | apps/web/components/me/settings-privacy-note.tsx:28 | `Giới tính của bạn không được hiển thị cho CLB hay người chơi khác, và không xuất hiện trên bất kỳ trang công khai nào.` |
| S114 | apps/web/components/me/settings-privacy-note.tsx:34 | `CLB chỉ nhận mức giá được tính từ giới tính của bạn, không nhận chính giới tính đó; nhưng nếu CLB đặt giá riêng cho nam hoặc nữ, mức giá đó có thể cho CLB biết giới tính của bạn.` |
| S115 | apps/web/components/me/settings-privacy-note.tsx:40 | `Bạn có thể đổi giới tính đã đặt bất cứ lúc nào bằng cách chọn lựa chọn khác rồi lưu.` |
| S116 | apps/web/components/me/settings-privacy-note.tsx:46 | `Để xoá giới tính khỏi hồ sơ, đặt lại thành Chưa đặt rồi lưu; quyền dùng giới tính để tính giá cũng bị tắt theo.` |
| S117 | apps/web/components/me/settings-privacy-note.tsx:52 | `Để CLB ngừng dùng giới tính mà không xoá nó, bỏ đánh dấu ô cho phép rồi lưu.` |
| S118 | docs/standards/decisions.md:142 | `MVP không có tích hợp ngân hàng` |
| S119 | docs/standards/decisions.md:142 | `Tiền chỉ thủ công` |
| S120 | docs/standards/decisions.md:142 | `cho trả một phần` |
| S121 | packages/db/schema.ts:1332 | `IN ('auto','manual','cash','waiver','reversal','attested_transfer')` |
| S122 | packages/db/schema.ts:1335 | `IN ('cash','waiver') AND ${t.amount} > 0 AND ${t.bankTransactionId} IS NULL AND ${t.createdBy} IS NOT NULL` |
| S123 | packages/db/schema.ts:1336 | `= 'attested_transfer' AND ${t.amount} > 0 AND ${t.bankTransactionId} IS NULL AND ${t.createdBy} IS NOT NULL` |
| S124 | apps/web/app/api/realtime/subscribe/route.ts:8 | `the host workspace's` |
| S125 | apps/web/app/api/realtime/subscribe/route.ts:9 | `same-origin, cookie-authenticated live-sync stream.` |
| S126 | apps/web/app/api/realtime/subscribe/route.ts:11 | `Ids only` |
| S127 | apps/web/app/api/realtime/subscribe/route.ts:12 | `Never public or` |
| S128 | apps/web/app/api/realtime/subscribe/route.ts:13 | `anonymous.` |
| S129 | apps/web/app/api/chat/subscribe/route.ts:19 | `a club member's chat stream` |
| S130 | apps/web/app/api/chat/subscribe/route.ts:21 | `frames carry ids only. Never public; no logging.` |
| S131 | apps/web/lib/session-cookies.ts:149 | `(await cookies()).set(SESSION_COOKIE, token, {` |
| S132 | apps/web/lib/oauth-transaction.ts:172 | `(await cookies()).set(oauthCookieName(provider),` |
| S133 | apps/web/app/api/auth/google/state/route.ts:29 | `binding cookie at the` |
| S134 | apps/web/lib/session-cookies.ts:397 | `Resolve the rate-limit identity from exactly one configured trusted edge.` |
| S135 | docs/sessions/web-mvp-phase3-readiness-p3-flags-default-on.md:257 | `Legal basis or compliance wording for gender collection` |
| S136 | docs/sessions/web-mvp-phase3-readiness-p3-flags-default-on.md:258 | `Retention period, and what happens to the stored gender on account closure` |
| S137 | docs/sessions/web-mvp-phase3-readiness-p3-flags-default-on.md:259 | `Third-party, vendor, backup and key-custody statements` |
| S138 | docs/sessions/web-mvp-phase3-readiness-p3-flags-default-on.md:260 | `A data-protection contact` |
| S139 | docs/sessions/web-mvp-phase3-readiness-p3-flags-default-on.md:261 | `A deletion SLA.` |
| S140 | docs/sessions/web-mvp-phase3-readiness-p3-flags-default-on.md:262 | `Hosting location` |
| S141 | docs/sessions/web-mvp-phase3-readiness-p3-flags-default-on.md:263 | `Whether gender is a sensitive class of personal data` |
| S142 | docs/sessions/web-mvp-phase3-readiness-p3-flags-default-on.md:264 | `Whether a public privacy page or a view-and-revoke consent flow should exist` |
| S143 | packages/db/migrations/0075_discovery_rate_limit_definer.sql:44 | `bucket    text    NOT NULL,  -- 'k:'` |
| S144 | packages/db/migrations/0075_discovery_rate_limit_definer.sql:80 | `or a fixed fallback of session-cookies.ts (clientIp)` |
| S145 | apps/web/lib/discovery-route-support.ts:227 | `an IPv6 address is its /64, the first four hextets of the` |
| S146 | apps/web/components/me/settings-profile-form.tsx:158 | `Purpose notice at the point of collection, wired to the Select` |
