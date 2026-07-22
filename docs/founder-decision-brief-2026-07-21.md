# Founder Decision Brief — 2026-07-21

> Gom các quyết định đang **chờ founder** thành một lượt duyệt. Mỗi mục: **crux cần quyết → lựa chọn → khuyến nghị → nếu chọn khác → ảnh hưởng/phụ thuộc**.
> Nguồn sự thật vẫn là `standards/decisions.md`; brief này chỉ để owner quyết nhanh. Ghi lại lựa chọn vào `decisions.md` + changelog sau khi chốt.
> Không mục nào trong đây có runtime/migration — chốt xong mới vào readiness gate rồi build.

## Cách dùng

Với mỗi mục, owner chỉ cần trả lời phần **① Câu hỏi cần quyết**. Phần còn lại là ngữ cảnh để quyết đúng. Các mục **độc lập nhau**, quyết cái nào trước cũng được.

Thứ tự đề xuất xử lý: nhóm **A (chặn phase-1/P4)** trước → nhóm **B (share/URL/profile, P4+)** → nhóm **C (P7 KB, chưa gấp)** đã accept-in-principle, không cần trong đợt này.

---

# NHÓM A — Notification stack (chặn slice thông báo, P4)

Ba mục này khoá cùng một cụm: `feature_notifications_reminders` (Product/BE) đang **Draft**, phần business-invariant §A đã reviewed nhưng §B/C/D + DDL chờ DD-70/71/72. Chốt cả ba thì cụm mới đóng được để build.

## DD-70 — Thông báo person-directed GLOBAL · ✅ ĐÃ CHỐT (owner 2026-07-21)

> **Owner chốt: notification là năng lực TOÀN PLEXCO** — mọi user có một inbox thông báo hợp nhất xuyên club + user config chọn loại nhận (per-type). Tức chọn **hướng (a) — global plane**.
> **Giữ HR2/RLS:** lưu trữ vẫn **hai plane** (tenant RLS cho thông báo trong-club + global protected cho follow/identity/security), merge ở service layer thành một danh sách; KHÔNG gộp một bảng bỏ `tenant_id`. Thêm `notification_preferences` theo Person. Chi tiết schema/preferences chờ build.

**① Câu hỏi cần quyết (đã trả lời):** Thông báo hướng-tới-một-người-xuyên-club (follow request, link/merge identity, cảnh báo bảo mật) lưu thế nào?

- **(a) — khuyến nghị:** thêm bảng `person_notifications` **global protected** (không `tenant_id`, enum đóng phase-1 = `follow_request | identity_link | identity_merged | security_alert`), đọc qua narrow function, có durable inbox + read-state.
- **(b):** không lưu bền, chỉ SSE + inbox in-app. **Đánh đổi phải chấp nhận:** follow request khi người nhận offline sẽ **mất**; chỉ thấy nếu mở màn settings liệt kê `pending`.

**Khuyến nghị: (a).** Hạ tầng `notification_intents`/`outbox_events` hiện là tenant-scoped (`tenant_id NOT NULL`) nên không cover được event global; (a) là đường duy nhất giữ đúng HR2 (không denormalize nội dung, render bằng reference) mà vẫn gộp được một danh sách cross-tenant, và không mất event khi offline.

**Nếu chọn (b):** chấp nhận mất thông báo social/security khi offline; vẫn cần `notification_reads` cho tenant plane. Có thể nâng cấp lên (a) sau nhưng tốn thêm một migration.

**Ảnh hưởng/phụ thuộc:** DD-47 (follow), DD-50 (identity link/merge), auth security-alert. **Không** chặn DD-76 feed core / DD-77 kudos core — chỉ chặn *durable notification* của activity/kudos. Cần CI invariant (không cột tiền/PII/JSON tuỳ ý, không blanket grant) land trước khi bật projector.

## DD-71 — Announcement: tier + preview/confirm · ✅ ĐÃ CHỐT (owner 2026-07-21)

> **Owner chốt: announce cơ bản FREE mọi tier**; `host_pro` thêm scheduling/recurring/template/analytics/quota. Preview→confirm bắt buộc (proof-bound, không undo).

**① Câu hỏi cần quyết (đã trả lời):** Host broadcast tới thành viên (theo tag audience) là **free mọi tier** hay **tính phí `host_pro`**?

- **Đề xuất:** **announce cơ bản = free mọi tier** (thủ công, khớp DD-40 "thủ công free / tự động host_pro"); `host_pro` thêm scheduling/recurring/template/analytics/quota cao hơn. Free vẫn có rate-limit theo actor + fan-out budget + quiet-hours + opt-out.
- **Kèm theo (kỹ thuật, không cần owner cân):** preview→confirm **bắt buộc** vì fan-out không thu hồi được (proof-bound token, consume-once). ⚠️ Cơ sở là "không thể undo", **không phải DD-25** (DD-25 chỉ phủ mutation tiền).

**Khuyến nghị: free mọi tier.** Nếu bắt trả phí kênh liên lạc cơ bản, host free sẽ quay lại copy tay sang group → mất dấu, mất lọc đối tượng, mất dữ liệu delivery.

**Nếu chọn tính phí:** cần định nghĩa fallback cho host free (hay chấp nhận đẩy họ ra group ngoài).

**Ảnh hưởng/phụ thuộc:** DD-43 (`membership_tags`, chưa có migration), DD-40, BL-NTF-4. Migration mới cho tags + announcements/audiences + quota reservations.

## DD-72 — Web Push: schema + provider · ✅ ĐÃ CHỐT (owner 2026-07-21)

> **Owner chốt: bảng `device_push_subscriptions` phase-1 CHỈ web** (global protected/Person, mã hoá; native chờ DD-69 phase-2); **provider = Web Push VAPID trực tiếp, không vendor SDK**; payload OS generic (opaque ref + i18n_key), không tenant/tiền/PII/tên CLB.

**① Câu hỏi cần quyết (đã trả lời):** Chốt (1) có tạo bảng `device_push_subscriptions` phase-1 chỉ cho **web** không, và (2) provider push?

- **Schema — đề xuất:** GLOBAL PROTECTED theo Person, **chỉ web** phase-1 (native chờ DD-69 phase-2 spike), endpoint/keys mã hoá, lookup HMAC, trust epoch server-only.
- **Provider — khuyến nghị:** **Web Push chuẩn qua VAPID trực tiếp**, KHÔNG thêm vendor SDK (OneSignal/Firebase) ở phase-1. Xét lại vendor ở native phase-2 nếu lợi ích ops vượt chi phí DPA/subprocessor/coupling.
- **Bất biến kèm theo:** payload OS chỉ generic (opaque ref + `i18n_key`), không tenant/tiền/PII/tên CLB.

**Khuyến nghị: web-only + VAPID trực tiếp.** Web push là kênh nhắc chính phase-1 (PRD §164, TDD FR-10, BL-NTF-1) nhưng chưa từng đặc tả; subscription endpoint là **bí mật** nên phải xử lý như `channel_identities`. Tách khỏi `ChannelIdentity` theo yêu cầu DD-69.

**Nếu chọn vendor SDK:** thêm subprocessor vào A3 legal review, coupling với SDK; không khuyến nghị phase-1.

**Ảnh hưởng/phụ thuộc:** DD-67 (route/platform), DD-69 (đặt tên bảng, ranh giới native). `apps/web` chưa có `manifest.json`/service worker (ship ở S9). `notification_deliveries.platform` hiện `text` không CHECK, `route_class` chưa tồn tại — cần migration.

---

# NHÓM B — Share / URL / Profile (P4+, owner đã có direction, chờ ratify sau readiness gate)

DD-82/83/84 owner đã cho **direction ngày 20/07** nhưng **chưa qua readiness gate**. DD-85 là mục mới hôm nay. Cần founder xác nhận để chuyển từ 🟡 → chốt.

## DD-82 — Tournament = aggregate độc lập · ✅ ĐÃ CHỐT (owner 2026-07-21)

> **Owner chốt: tournament = aggregate riêng.** Retire `session_type='tournament'` (amend DD-41 + migration/backfill); v1 gọn (tournaments + đăng ký + `public_tournaments`); bracket/money slice sau. Build chờ analysis + spec pair + readiness gate.

**① Câu hỏi cần quyết (đã trả lời):** Giải đấu (tournament) làm **aggregate riêng** hay tái dùng `sessions`/`players`?

- **Direction owner (20/07):** aggregate **độc lập**, không gom vào session. v1 gọn: bảng `tournaments` tenant-scoped + RLS, bảng đăng ký riêng, `public_tournaments` read model cho URL share. **Retire `session_type='tournament'`** ⇒ **amend DD-41 + cần migration/backfill** (không phải "no breakage").

**Cần owner xác nhận:** đồng ý retire `session_type='tournament'` (chấp nhận migration + backfill)? Bracket/standings/entry-fee để slice sau — ok?

**Ảnh hưởng/phụ thuộc:** amend DD-41, DD-73/75 (share), HR2. Phase P4+ sau session core.

## DD-83 — URL scheme thống nhất + slug registry · ✅ ĐÃ CHỐT (owner 2026-07-21)

> **Owner chốt: session = opaque slug** (`/session/x7k9m2`), thay `/s/<id>` của DD-73. 4 loại URL dùng chung registry (tombstone-on-rename, guarded-view-only, không lộ `tenant_id`/PII). Handle uniqueness + reserved-word + collision policy chốt tại build.

**① Câu hỏi cần quyết (đã trả lời):** Thống nhất URL 4 loại `/user/<handle>` · `/club/<slug>` · `/session/<slug>` · `/tournament/<slug>` dùng chung registry (mở rộng DD-75)?

- **Open point duy nhất cần owner:** session dùng **opaque slug** (khuyến nghị, ví dụ `/session/x7k9m2`, giữ chống-enumerate DD-75) hay **UUID thô**? Default đang ghi = **opaque slug** (thay wording `/s/<id>` của DD-73).

**Khuyến nghị: opaque slug cho session.** Nhất quán DD-75, chống enumerate, rotatable. User/club/tournament dùng slug/handle human-readable.

**Ảnh hưởng/phụ thuộc:** DD-73/75/12. Cần định nghĩa handle uniqueness (global) + reserved-word list + collision policy. Bất biến chung: rename → tombstone link cũ; URL public chỉ đọc guarded view, không lộ `tenant_id`/PII.

## DD-84 — Player profile default-public phase-1 · ✅ ĐÃ CHỐT (owner 2026-07-21)

> **Owner chốt: default-public, activity mặc định LÀM MỜ** + player tự bật chi tiết + minor ép off. Đảo DD-74. Build gated bởi child-safety review + cập nhật HR2 wording + consent/minor model + readiness gate.

**① Câu hỏi cần quyết (đã trả lời):** Trang `/user/<handle>` mặc định **public**, và **activity history** mặc định hiển thị ở mức nào?

- **Direction owner (20/07):** mặc định public, tách field theo độ nhạy:
  - **Default-public an toàn:** handle (tự chọn, đổi→tombstone), môn chơi, karma, kudos, tổng số buổi.
  - **Activity history mặc định LÀM MỜ** (coarsened, không venue+time cụ thể, không co-participant); player **tự bật** chi tiết.
  - **Trẻ vị thành niên: ép off** chi tiết bất kể config.

**Cần owner xác nhận:** đồng ý default activity ở mức **mờ** (không phải public chi tiết ngay)? Đây là điểm an-toàn/HR2 quan trọng — activity gắn venue+time = bản đồ vị trí + lịch sinh hoạt của một người.

**Ảnh hưởng/phụ thuộc:** **đảo DD-74** (vốn: gated, v2 post-P4, no club attribution); cần **cập nhật HANDOFF HR2 wording** + **child-safety review** + định nghĩa consent state + minor detection trước build.

## DD-85 — Disambiguation tên hiển thị trùng · ✅ ĐÃ CHỐT (owner 2026-07-21)

> **Owner chốt: disambiguator mặc định = `pay_code`.** Thêm bộ field hồ sơ user/player: `display_name` + `id` + `avatar` (ảnh nhỏ, field mới) + `gender` + thông tin khác.
> **Ràng buộc hard-rule:** `gender` giữ DD-39/54 (PII/consent, **không public**); `avatar` field mới, lưu object-store private, **default host-facing phase-1**, public opt-in sau (owner có thể lật, cần child-safety review). Disambiguator chỉ host/authenticated. Build chờ avatar migration/storage + gender surfacing + host-add spec + readiness gate.

**① Câu hỏi cần quyết (đã trả lời):** Khi hai member cùng một club trùng `display_name` (ví dụ hai "Minh"), UI có bắt buộc hiển thị **disambiguator** không, và dùng gì?

- **Bối cảnh:** identity nội bộ đã an toàn (key theo `membership_id`/`person_id`/`pay_code`, không theo tên). Rủi ro chỉ ở nơi **con người nhìn tên**: đọc roster thấy hai "Minh" giống hệt; host tự add player có thể chọn nhầm.
- **Đề xuất:** khi trùng `display_name` chuẩn-hoá trong cùng tenant, **roster render + host member-picker** hiển thị kèm disambiguator từ dữ liệu đã có — **`pay_code`** (unique/tenant) và/hoặc avatar/ngày join; host-add **cảnh báo** khi thêm tên đã có trên roster. Chỉ surface host/authenticated, không public, không PII; **không dùng phone** (DD-50 phase-1 không thu SĐT); không auto-suffix/auto-merge theo tên.

**Cần owner xác nhận:** (1) đồng ý hướng "collision-aware display" này? (2) disambiguator mặc định = `pay_code`?

**Ảnh hưởng/phụ thuộc:** identity-model, DD-02 (pay_code), DD-26, DD-50, DD-52/56. Luồng host-add-player **chưa build** (web chưa có route roster/player) — cần spec hoá luồng đó trước khi áp guard (2)/(3). Phần roster-render có thể làm sớm ở P4.3.

---

# NHÓM C — KB plane P7 (KHÔNG cần đợt này)

DD-34 / DD-35 / DD-36 đã **approve-in-principle** (P7, post-MVP); chi tiết chốt lúc build. Không cần founder trong đợt này.

# KHÔNG phải founder decision (để tách bạch, không đưa vào đây)

- **DD-14 / DD-15** — SPIKE xác minh Zalo (phụ thuộc bên ngoài).
- **DD-18** — review provider embedding/LLM: chặn GO-LIVE (P7), không chặn build; là review privacy/ToS.
- **DD-45a** — uniqueness `waitlist_position`: đã re-triage là **engineering pin**, không thuộc founder queue.
- **DD-57 / DD-58 / DD-59** — FE architecture/pipeline/token method: owner đã chủ động **defer**; chỉ cần mở lại khi bắt đầu FE.

---

## Bảng tóm tắt để owner tick

| DD | Crux | Khuyến nghị | Owner chốt? |
|----|------|-------------|-------------|
| DD-70 | Thông báo global lưu bền hay không | (a) global plane + inbox toàn Plexco + config per-type | ✅ (21/07) |
| DD-71 | Announce free hay host_pro | Free mọi tier | ✅ (21/07) |
| DD-72 | Web push schema + provider | Web-only + VAPID trực tiếp | ✅ (21/07) |
| DD-82 | Tournament aggregate riêng + retire `session_type` | Đồng ý (chấp nhận migration/backfill) | ✅ (21/07) |
| DD-83 | Session URL: slug hay UUID | Opaque slug | ✅ (21/07) |
| DD-84 | Activity mặc định mờ hay chi tiết | Mờ + player tự bật + minor ép off | ✅ (21/07) |
| DD-85 | Disambiguator tên trùng | Có; mặc định `pay_code` + avatar/gender field | ✅ (21/07) |
