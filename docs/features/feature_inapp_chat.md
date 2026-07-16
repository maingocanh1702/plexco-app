# Feature: In-app Chat (toàn CLB + 1-1) — Product/UX Spec

> ⚙️ **Status:** ✅ **DD-38 chốt (2026-07-10)** — Draft, pending migration. Nguồn canonical: `../standards/decisions.md` **DD-38** (ràng buộc đã pin: 2 loại channel, DM guard đúng 2 người, dedupe `client_msg_id` độc lập author).

> **Canonical phase:** P4 (đề xuất — dựng sớm hạ tầng `chat_*`)
> **Track:** 💬 In-app Chat
> **Version:** 0.5 · 2026-07-16
> **Status:** ✅ DD chốt — Draft (pending migration)
> **Prerequisites:** P4 web/app surface + sync engine · **DD-07** (SSE + `LISTEN/NOTIFY`) · P3.5 identity (Person/Membership)
> **Tài liệu liên quan:** `../product/BRD.md` MODULE 10 / BR-15 / AC-10 / FR-10 · `../standards/decisions.md` **DD-38/DD-55** · DD-07 · DD-19/DD-20 (trợ lý tái dùng `chat_*` ở P7) · `feature_club_assistant.md` · `feature_identity.md` · `packages/db/schema.ts` (**AUTHORITATIVE** khi triển khai)

---

## 1. Mô tả

**Chat cơ bản trong app** cho tương tác không lệ thuộc nhóm chat bên ngoài (Zalo/Messenger). Hai loại kênh:

- **Chat toàn CLB (`club`):** kênh chung cho **member trong 1 tenant**; scoped `tenant_id` + **RLS fail-closed** (tenant-private).
- **Chat riêng 1-1 (`dm`):** person ↔ person; **chỉ 2 người** trong hội thoại đọc được (đường **person-self**).

Chat **chỉ sống trong Plexco** (web + surface app của Plexco), **KHÔNG bridge** ra group Zalo/Messenger ở phase-1 (BRD CO-7). Lưu **canonical** rồi project realtime qua **SSE (DD-07)**. Phase-1 gồm text + media hoàn chỉnh: private object storage, signed access, MIME/type/size/quota checks, malware scan, moderation và deletion lifecycle; không ship media half-built.

**Tái dùng hạ tầng:** dùng **chung bộ bảng `chat_*`** mà trợ lý AI (DD-19 pha B, DD-20) sẽ tái dùng ở **P7** (bot-participant `author_type='assistant'`). DD-38 chỉ **đảo thứ tự** — dựng hạ tầng chat người↔người sớm ở P4 thay vì P7. **Không tạo model song song.**

### Bất biến

- Chat `club` **cô lập cross-tenant** — app scoped `tenant_id` + DB **RLS fail-closed**; CLB A không đọc được chat CLB B (NFR-S1, bao gồm chat toàn CLB).
- Chat `dm` **chỉ 2 người** đọc được — đường **person-self**, không cho query person khác.
- **KHÔNG bridge** ra Zalo/Messenger/kênh ngoài ở phase-1 (CO-7); chat không xuất hiện ở group ngoài.
- Tenant + person resolve từ **phiên đăng nhập app**, **KHÔNG** từ nội dung message.
- Tin nhắn ghi canonical qua **command → outbox → projector** (không multi-master, HR3); realtime qua SSE, idempotent theo `command_id`.
- **Tiền/PII không lộ** qua chat; chat KHÔNG thuộc public plane (không vào `public_sessions`).
- Rate-limit / anti-spam theo person + tenant.
- Phase-1 open DM chỉ được bật sau khi **block + report + per-sender/per-target rate-limit + abuse audit** đều hoạt động fail-closed. Host/support/tenant admin không có quyền đọc DM.
- Media object mặc định private; pending/quarantined/rejected/deleted không được serve. Mọi signed access phải re-authorize channel membership tại thời điểm đọc.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| CHT-UC-1 | Member | Mở kênh chat toàn CLB | Load lịch sử (phân trang) trong tenant; RLS scoped |
| CHT-UC-2 | Member | Gửi tin nhắn text vào chat CLB | Ghi canonical → project realtime tới member online (SSE) |
| CHT-UC-3 | User | Mở DM 1-1 với user khác | Phase-1 open DM sau safety gate; upsert theo cặp person — chỉ 2 người |
| CHT-UC-4 | Member | Gửi DM 1-1 | Chỉ 2 người nhận realtime; không lộ ra chat CLB |
| CHT-UC-5 | Member | Nhận tin realtime khi đang online | SSE push; badge/thông báo chưa đọc |
| CHT-UC-6 | Member | Cuộn xem lịch sử cũ | Phân trang keyset theo thời gian |
| CHT-UC-7 | Member | Rời CLB (membership `left`) | Mất quyền đọc/gửi chat CLB đó; lịch sử giữ (audit) |
| CHT-UC-8 | Host/Admin | Kiểm duyệt: ẩn/xoá tin vi phạm | Soft-delete + audit; không sửa lịch sử thô |
| CHT-UC-9 | System | Reconnect sau mất mạng | Re-sync từ last-seen cursor; idempotent, không double |
| CHT-UC-10 | System | (P7) Trợ lý @mention trong chat CLB | Bot-participant trả lời (`author_type='assistant'`, DD-19/DD-20) — tái dùng cùng `chat_*` |
| CHT-UC-11 | User | Gửi ảnh/file hợp lệ | Upload private → scan/moderate → attach khi `ready`; recipient mở qua signed URL ngắn hạn sau authz |
| CHT-UC-12 | User | Block hoặc report người khác | Block chặn request/create/send/read boundary theo policy; report tạo abuse record/audit, không cấp host quyền đọc lịch sử DM |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Security | Member CLB A đọc chat CLB B | ❌ NEVER — RLS fail-closed; test bất biến cross-tenant |
| 2 | Security | Người thứ ba đọc DM 1-1 | ❌ NEVER — chỉ 2 person trong hội thoại (person-self) |
| 3 | Security | Resolve tenant/person từ nội dung message | ❌ NEVER — chỉ từ phiên đăng nhập + kênh |
| 4 | Security | Bridge chat ra Zalo/Messenger | ❌ NEVER phase-1 (CO-7) — chat chỉ sống trong Plexco |
| 5 | Abuse | Spam flood tin nhắn | Rate-limit per person+tenant; chặn/slow-mode |
| 6 | Concurrency | Double-send / retry (mất mạng) | Idempotent theo `command_id` — 1 tin |
| 7 | Data Integrity | Non-member cố gửi vào chat CLB | Eligibility fail — 403, không ghi |
| 8 | Abuse | DM giữa hai user không có quan hệ CLB | Phase-1 được phép **chỉ khi** safety gate DD-55 xanh; nếu gate/config chưa sẵn sàng → fail-closed, không tạo DM |
| 9 | Privacy | Tin chứa PII/số tiền người khác | Không có đường public; không đưa vào analytics/log thô |
| 10 | Resilience | SSE rớt kết nối | Reconnect + re-sync cursor; không mất/không trùng |
| 11 | Security | Tin đã xoá vẫn hiển thị ở client cũ | Reproject soft-delete; client hiển thị "đã thu hồi" |
| 12 | Data Integrity | Member `left` rồi quay lại | Re-grant quyền theo membership hiện hành; lịch sử liền mạch |
| 13 | Abuse | Sender/target đã block nhau hoặc sender vượt target-rate | Reject request/create/send/read tại boundary; không tiết lộ chi tiết block cho đối phương |
| 14 | Abuse | Report DM | Ghi reason/status/audit tối thiểu; abuse operator chỉ thấy artifact đúng policy, host/support tenant không đọc DM |
| 15 | Security | Upload giả MIME, malware, quá size/quota | Quarantine/reject; không tạo attachment `ready`, không phát signed URL |
| 16 | Data Integrity | Upload xong nhưng gửi message fail / object bị xoá | Orphan cleanup theo TTL; message chỉ tham chiếu attachment `ready`; deleted object hiển thị tombstone |

---

## 3. Screens & States

| Surface | Screen | Loading | Ready | Error | Empty |
|---------|--------|---------|-------|-------|-------|
| Web/App | Danh sách kênh (CLB + DM) | Skeleton | List kênh CLB + DM gần đây + badge chưa đọc | "Lỗi tải" + retry | "Chưa có hội thoại" |
| Web/App | Chat toàn CLB | "Đang tải..." | Lịch sử + ô soạn + realtime | "Mất kết nối — đang thử lại" | "Chưa có tin nhắn" |
| Web/App | DM 1-1 | "Đang tải..." | Lịch sử 2 người + ô soạn | "Lỗi gửi — thử lại" | "Bắt đầu trò chuyện" |
| Web/App | Media composer/viewer | Upload/scan progress | Preview attachment `ready`; signed view/download | Rejected/quarantined/deleted tombstone | Chọn ảnh/file |
| Web/App | Safety actions | — | Block / unblock / report + generic confirmation | Generic retry | N/A |
| Web/App | Kiểm duyệt (host) | — | Ẩn/xoá tin + lý do | "Lỗi" | N/A |

---

## 4. Domain Model

> **Schema ở mức proposal (DD-38).** Nguồn AUTHORITATIVE khi triển khai: `../standards/decisions.md` DD-38 + `packages/db/schema.ts` + migration. **Dùng chung** bộ bảng `chat_*` với trợ lý (DD-19/DD-20) — KHÔNG tạo bảng song song.

| Entity (proposal) | Plane | Vai trò | Key constraints (dự kiến) |
|--------|-------|---------|-----------------|
| `chat_channels` | `club`: Tenant-private · `dm`: **Person-self (global)** | Kênh chat | `kind ∈ {club, dm}`; **club** → `tenant_id` NOT NULL, `dm_key` NULL, 1 kênh chính/CLB; **dm** → `tenant_id` **NULL**, `dm_key='least:greatest'` 2 person UNIQUE (CHECK XOR) |
| `chat_channel_members` | theo channel (`club` tenant-private / `dm` person-self) | Thành viên kênh | **club**: `tenant_id`+`membership_id` NOT NULL, `UNIQUE(tenant, channel, membership)`; **dm**: `tenant_id`/`membership_id` NULL, đúng 2 person theo `dm_key` |
| `chat_messages` | theo channel (`club` tenant-private / `dm` person-self) | Tin nhắn | `author_type ∈ {person, assistant, system}`; assistant/system ⇒ `membership_id` NULL; **dm** ⇒ `tenant_id`/`membership_id` NULL; `command_id` idempotent |
| `chat_attachments` (proposal) | Private, channel-authorized | Metadata + storage/scan/deletion state | Owner + object key; `pending_scan → ready | rejected | quarantined | deleted`; message chỉ attach `ready`; no raw signed URL persisted |
| `chat_blocks` / `chat_reports` (proposal) | Person-self / abuse-control | Open-DM safety gate | Deterministic actor-target block; report reason/status + immutable audit; không làm DM readable cho host/support |

- **RLS:** `club` channel → thêm `chat_*` vào RLS list (ENABLE + FORCE theo `app.tenant_id`). `dm` (`tenant_id` NULL) **không** qua tenant-RLS mà gate **person-self** (chỉ 2 person trong `dm_key`) — khớp `BE/feature_inapp_chat_tech.md`. Migration RLS list tương lai.
- **Realtime:** SSE + `LISTEN/NOTIFY` theo tenant/person (DD-07) — cùng cơ chế sync engine.
- **Không** entity nào thuộc public plane.

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu (no PII) |
|-------|---------|-------------------|
| `chat_channel_opened` | Member mở kênh | `tenant_id`, `kind` (club/dm) |
| `chat_message_sent` | Gửi tin thành công | `tenant_id`, `kind`, `len_bucket` |
| `chat_message_moderated` | Host ẩn/xoá tin | `tenant_id`, `reason_code` |
| `chat_rate_limited` | Bị chặn spam | `tenant_id`, `person_id` (opaque) |
| `chat_realtime_reconnect` | SSE reconnect | `tenant_id` |
| `chat_media_outcome` | Scan/upload lifecycle completes | `kind`, `size_bucket`, `outcome_class` — no object key/content |
| `chat_block_or_report` | Safety action | `action`, opaque actor/target ids, `reason_code` only |

> KHÔNG log nội dung tin nhắn, tên, số tiền, raw platform ID trong analytics.

---

## 6. Acceptance Criteria

- [ ] Chat toàn CLB cô lập cross-tenant (RLS fail-closed) — test A≠B pass.
- [ ] DM 1-1 chỉ 2 người đọc được — person-self test pass.
- [ ] Không bridge ra Zalo/Messenger; chat không xuất hiện ở kênh ngoài (CO-7).
- [ ] Tenant/person resolve từ phiên đăng nhập, không từ nội dung.
- [ ] Gửi tin idempotent theo `command_id`; SSE realtime độ trễ thấp.
- [ ] Rate-limit/anti-spam hoạt động theo person+tenant.
- [ ] Tin/PII/tiền không lộ ra public; không vào analytics thô.
- [ ] Dùng chung `chat_*` với trợ lý (DD-19/DD-20) — không model song song.
- [ ] Reconnect/re-sync không mất/không trùng tin.
- [ ] Open DM remains OFF until block/report/per-sender+per-target limits/abuse audit pass; blocked pair cannot request/create/send/read through the DM boundary.
- [ ] Host/support/tenant admin cannot read DM, including after a report.
- [ ] Media E2E passes private upload, MIME sniff, size/quota, malware scan, moderation, ready-only attach, signed read authz, delete/tombstone and orphan cleanup.

---

## 7. Open Questions / Changelog

### Open Questions (→ decisions.md)

| ID | Quyết định | Trạng thái |
|---|---|---|
| DD-38 | Chat cơ bản in-app phase-1 (toàn CLB + 1-1, chỉ Plexco, không bridge) | ✅ Chốt |
| CHT-OQ-1 | Chính sách cho phép DM | ✅ **Chốt DD-55 (2026-07-16)** — **phase-1: open DM** nhưng hard-gated bởi block + report + per-sender/per-target rate-limit + abuse audit; thiếu một gate thì DM OFF. **Phase-2:** chỉ follower accepted (DD-47) DM direct, còn lại vào request box. Host/support/tenant admin KHÔNG đọc DM (person-scoped, tenant NULL) |
| CHT-OQ-2 | Quyền kiểm duyệt host trong club channel: xoá/ẩn/mute — granularity | ⬜ Chưa chốt — chốt lúc build chat slice (DD-55 note) |
| CHT-OQ-3 | Media/emoji phase-1 | ✅ **Chốt DD-55 (2026-07-16)** — **media in-scope phase-1** (core value): build đủ object storage, signed access, malware scan, quota/type/size limits, moderation, deletion lifecycle — không ship half-built |

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-16 | v0.4 | **Propagation (light) DD-55:** CHT-OQ-1 ✅ (phase-1 open DM / phase-2 follow-gated + request box; host không đọc DM), CHT-OQ-3 ✅ (media in-scope full stack). CHT-OQ-2 giữ mở (build-time). Media stack/schema defer build slice — BE tech cần bổ sung media requirements. Authority: decisions v1.36. |
| 2026-07-16 | v0.5 | **Full propagation DD-55 (decisions v1.37):** open-DM hard safety gate; block/report abuse contract; host/support DM denial; full private media upload/scan/signed-access/quota/moderation/deletion lifecycle; acceptance + domain proposals pinned. |
| 2026-07-15 | v0.3 | Làm rõ §4 Domain Model: `dm` là **person-self** (`tenant_id` NULL, `dm_key` cặp person) tách khỏi `club` tenant-private — khớp §1 + `BE/feature_inapp_chat_tech.md`. RLS note tách club (tenant-RLS) vs dm (person-self gate). Đồng bộ version header ↔ changelog. |
| 2026-07-10 | v0.1 | Khởi tạo Draft (DD-38): chat toàn CLB + 1-1, chỉ Plexco (không bridge, CO-7), SSE (DD-07), RLS tenant cho club-chat + person-self cho DM, anti-spam; tái dùng `chat_*` mà trợ lý DD-19/DD-20 dùng ở P7. Schema proposal-level trỏ decisions.md + `packages/db/schema.ts`. |
