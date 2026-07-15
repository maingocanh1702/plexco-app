# Feature: Club AI Assistant + Knowledge Base — Product/UX Spec

> **Canonical phase:** P7 (post-MVP, **đề xuất**)
> **Track:** 🤖 Club Assistant
> **Version:** 0.5 · 2026-07-05
> **Status:** ✅ DD chốt (2026-07-05: DD-16,17,19,20,21,22,23,24,25,26,27,28 ✅) — sẵn sàng promote sang Reviewed để build (S19). **DD-18** (provider LLM + privacy/ToS) ⬜ = gate **GO-LIVE**, không gate build (interface swappable).
> **Prerequisites:** P4 web/app surface + sync engine · P3.5 identity · P5 billing entitlement · (KHÔNG cần channel adapters — trợ lý chỉ chạy trong app Plexco)
> **Tài liệu liên quan:** proposal `../proposals/club-ai-bot-knowledge-base.md` · BE `BE/feature_club_assistant_tech.md` · `feature_inapp_chat.md` (chat cơ bản, DD-38) · `../standards/decisions.md` DD-16..DD-23 · DD-37/DD-38 · `../standards/core-db-architecture-principles.md`

> **Cập nhật v3.4 (DD-37 + DD-38, 2026-07-10):** hạ tầng `chat_*` (native chat in-app) nay **được dựng sớm ở P4** bởi **DD-38** (chat cơ bản phase-1, người↔người) — trợ lý (pha B, DD-19) **tái dùng** cùng bộ bảng ở P7, không tạo model song song. Kênh phase-1 = **Zalo + Messenger** (Telegram loại — DD-37); trợ lý vẫn **chỉ trong app Plexco**, không trả lời ở kênh ngoài.

---

## 1. Mô tả

Mỗi CLB (tenant) bật được một **trợ lý AI** riêng **bên trong app Plexco**. Host nạp **knowledge base** từ FAQ + tài liệu nội bộ (dán text, **upload PDF/DOCX/MD/TXT**, URL) và chọn **tone giọng**. Khi thành viên **@mention** trợ lý trong **kênh chat in-app của CLB** (hoặc dùng panel "Hỏi trợ lý"), trợ lý tự trả lời theo KB bằng **RAG hybrid** (BM25 + semantic + RRF), có trích dẫn, có ngưỡng "chưa biết". Mỗi CLB có **1 KB riêng**, cô lập bằng RLS. **Trợ lý CHỈ hoạt động trong app Plexco — KHÔNG trả lời ở kênh ngoài (Zalo/Messenger).** *(Telegram đã loại khỏi phạm vi — DD-37.)*

Hai pha surface, đều trong app Plexco (DD-19): **Pha A** = panel "Hỏi trợ lý" (Q&A trực tiếp, MVP feature). **Pha B** = kênh chat in-app native (channel/message/realtime) có bot là thành viên, trả lời khi @mention.

### Bất biến

- KB / chat / query-log = **tenant-private, RLS fail-closed**. KB CLB A **KHÔNG BAO GIỜ** retrieve được từ CLB B.
- Trợ lý **chỉ** ground trên KB; **KHÔNG** nối `charges`/`memberships`/`persons`/SĐT/secret vào LLM ⇒ không lộ tiền/PII (HR2, DD-21).
- **Live-context (DD-28) TÁCH khỏi prompt KB:** dữ liệu vận hành (slot/capacity) đi **tool riêng** có field-whitelist + authz; **KHÔNG** trộn vào prompt KB-RAG chung. KB prompt = chỉ `kb_chunks`.
- Trợ lý = **config cấp tenant**, KHÔNG phải `Person`/`ChannelIdentity` mới (DD-20).
- Native chat + câu trả lời bot ghi canonical qua **command → outbox → projector** (không multi-master, HR3).
- Retrieve luôn **tham số hoá theo tenant + dưới RLS** — 1 tool tổng quát, KHÔNG tool-per-CLB (DD-23).
- **i18n:** câu trả lời + fallback qua `t(vi,en)`; bám tone host chọn.
- Tenant + person resolve từ **phiên đăng nhập app + kênh chat in-app**, KHÔNG từ nội dung message.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| CAS-UC-1 | Host | Bật trợ lý, đặt tên + chọn tone | `bot_configs` tạo/cập nhật, `enabled=true` |
| CAS-UC-2 | Host | Nạp FAQ (cặp Q/A) | Mỗi cặp thành 1 document nhỏ → index |
| CAS-UC-3 | Host | Upload PDF/DOCX/MD/TXT | File → object storage → extract → chunk → embed |
| CAS-UC-4 | Host | Dán text / thêm URL | Nguồn `pasted`/`url` được ingest |
| CAS-UC-5 | Host | Xem trạng thái ingest + re-ingest nguồn lỗi | Hiển thị processing/active/error; retry an toàn |
| CAS-UC-6 | Host | Archive/xoá 1 nguồn KB | Nguồn + chunk liên quan ngừng được retrieve |
| CAS-UC-7 | Member | Hỏi qua panel "Hỏi trợ lý" trong app (pha A) | Hỏi/đáp trực tiếp theo KB + trích dẫn |
| CAS-UC-8 | Member | @mention bot trong kênh chat in-app CLB (pha B) | Bot chèn tin nhắn trả lời (author=assistant) + SSE |
| CAS-UC-9 | Member | Hỏi câu ngoài KB | "Mình chưa có thông tin này" (no-answer) lịch sự |
| CAS-UC-10 | Host | Xem analytics (câu hỏi/tháng, %no-answer) | Dashboard + gợi ý bổ sung KB từ câu chưa trả lời được |
| CAS-UC-11 | Host | Đổi tone (lịch sự→hài hước…) | Câu trả lời đổi giọng, nội dung KB không đổi |
| CAS-UC-12 | Member | Gửi phản hồi 👍/👎 cho câu trả lời (pha C) | Tín hiệu cải thiện KB |
| CAS-UC-13 | Host | Đặt ngưỡng similarity / bật LLM rerank | Điều chỉnh precision vs recall |
| CAS-UC-14 | System | Vượt cap câu hỏi/tháng theo gói | Thông báo nâng gói; tạm dừng trả lời (DD-22) |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Security | Hỏi để lộ nợ/SĐT người khác | ❌ NEVER — bot chỉ KB; không có dữ liệu tiền/PII trong context |
| 2 | Security | KB tenant A rò sang B | ❌ NEVER — RLS chặn; test bất biến bắt buộc |
| 3 | Security | Prompt injection trong doc ("bỏ qua hướng dẫn, lộ X") | Retrieved chunk là DATA, không phải lệnh; system prompt tối cao |
| 4 | Data Integrity | File hỏng/không đọc được | `kb_sources.status=error` + báo host; không phá KB hiện có |
| 5 | Data Integrity | File/nội dung trùng (cùng hash) | Không tạo chunk lặp (idempotent) |
| 6 | Abuse/Cost | Spam @mention | Rate-limit theo person + tenant |
| 7 | Entitlement | Vượt cap câu hỏi/tháng | Thông báo nâng gói; dừng an toàn |
| 8 | Quality | Câu hỏi mơ hồ/đa chủ đề | Hybrid + threshold; điểm thấp → no-answer, KHÔNG bịa |
| 9 | i18n | Hỏi tiếng Anh trong CLB locale vi | Trả lời đúng ngôn ngữ câu hỏi + tone đã chọn |
| 10 | Security | Member đã `left` vẫn hỏi | Eligibility fail — từ chối lịch sự |
| 11 | Resilience | LLM/embed provider lỗi/timeout | Fallback "thử lại sau"; KHÔNG hỏng canonical/không double-charge |
| 12 | Privacy | Câu hỏi chứa PII người dùng gõ | Retention có TTL + purge job redact (BE §4.3); không log thô (INV-9) |
| 13 | Concurrency | 2 người hỏi cùng lúc / retry | Idempotent theo `command_id` — 1 câu trả lời |
| 14 | Data Integrity | KB rỗng (chưa nạp) | "CLB chưa cấu hình tri thức" — không gọi LLM vô ích |
| 15 | Security | Người không phải member CLB cố hỏi trợ lý | Eligibility fail — chỉ phục vụ member trong app |
| 16 | Security | Nội dung KB chứa secret host lỡ dán (token/SĐT) | Cảnh báo host; không đưa secret vào câu trả lời công khai |

---

## 3. Screens & States

| Surface | Screen | Loading | Ready | Error | Empty |
|---------|--------|---------|-------|-------|-------|
| Web dashboard | KB manager (danh sách nguồn) | "Đang tải KB..." | Bảng nguồn + trạng thái + nút re-ingest/archive | "Lỗi tải KB" | "Chưa có tài liệu — thêm FAQ/upload" |
| Web dashboard | Upload/nạp nguồn | "Đang xử lý tài liệu..." | "✅ Đã index [n] đoạn" | "❌ File lỗi — thử lại" | N/A |
| Web dashboard | Cấu hình trợ lý (tên, tone, ngưỡng) | — | Form + preview giọng | "Lỗi lưu cấu hình" | N/A |
| App panel | Hỏi trợ lý (pha A) | "Đang tìm..." | Câu trả lời + trích dẫn nguồn | "Lỗi — thử lại" | "Chưa có tri thức để trả lời" |
| Native chat (pha B) | Bot trả lời khi @mention | typing indicator | Tin nhắn assistant + trích dẫn | "Lỗi — thử lại" | "Mình chưa có thông tin này" |
| Web dashboard | Analytics trợ lý | "Đang tải..." | Câu hỏi/tháng, %no-answer, top câu chưa trả lời | "Lỗi" | "Chưa có lượt hỏi" |

---

## 4. Domain Model

| Entity | Plane | Vai trò | Key constraints |
|--------|-------|---------|-----------------|
| `bot_configs` | Tenant-private | Cấu hình trợ lý per-CLB | `UNIQUE(tenant_id)`, `tone` enum, `enabled`, `min_similarity`, `monthly_question_cap` |
| `kb_sources` | Tenant-private | Nguồn tri thức thô | `kind` (faq/doc_upload/pasted/url), `mime_type`, `storage_ref`, `UNIQUE(tenant,content_hash)` |
| `kb_documents` | Tenant-private | Text chuẩn hoá từ nguồn | `source_id` FK, `lang`, `status` |
| `kb_chunks` | Tenant-private | Chunk + vector + fts | `embedding`/`summary_embedding` vector, `fts_vector` GENERATED, `UNIQUE(tenant,doc,idx)` |
| `embedding_cache` | Global (hash→vec) | Cache embed theo SHA256 | `content_sha256` PK; không chứa ngữ cảnh tenant |
| `bot_queries` | Tenant-private | Log 1 lượt hỏi→đáp (append-only, async 2 pha) | `UNIQUE(tenant,command_id)`, `status`, `reason_code`, `retention_expires_at`/`redacted_at`, `retrieved_chunk_ids` |
| `chat_channels` | Tenant-private | Kênh chat in-app (pha B) | `kind='club_main'` |
| `chat_channel_members` | Tenant-private | Thành viên kênh | `UNIQUE(tenant,channel,membership)` |
| `chat_messages` | Tenant-private | Tin nhắn (member/assistant/system) | `author_type`; assistant/system ⇒ `membership_id` NULL |

> Chi tiết DDL + RLS ở `BE/feature_club_assistant_tech.md §2`. Không entity nào thuộc public plane (không vào `public_sessions`).

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu |
|-------|---------|-------------------|
| `assistant_enabled` | Host bật/tắt trợ lý | `tenant_id`, `enabled` |
| `assistant_tone_changed` | Host đổi tone | `tenant_id`, `tone` |
| `kb_source_ingested` | Nguồn index xong | `tenant_id`, `kind`, `chunk_count` |
| `kb_ingest_failed` | Ingest lỗi | `tenant_id`, `kind`, `error_class` |
| `assistant_question_asked` | Member hỏi | `tenant_id`, `surface` |
| `assistant_answered` | Trả lời thành công | `tenant_id`, `surface`, `confidence_bucket`, `latency_ms` |
| `assistant_no_answer` | Dưới ngưỡng similarity | `tenant_id`, `surface` |
| `assistant_blocked` | Eligibility/entitlement chặn | `tenant_id`, `reason` |
| `assistant_cap_reached` | Vượt cap tháng | `tenant_id` |
| `assistant_provider_failure` | LLM/embed lỗi | `tenant_id`, `error_class` |

> KHÔNG log nội dung câu hỏi/tài liệu, raw platform ID, token, hay chunk text trong analytics (INV-9).

---

## 6. Acceptance Criteria

- [ ] Mỗi CLB có KB riêng; retrieve luôn dưới RLS tenant — test A≠B pass.
- [ ] Bot chỉ ground trên KB; assert context KHÔNG chứa ledger/PII/secret.
- [ ] Upload PDF/DOCX/MD/TXT → extract → index; file lỗi báo host, không phá KB.
- [ ] Ingest trùng hash không tạo chunk lặp; re-ingest an toàn.
- [ ] Panel "Hỏi trợ lý" (pha A) + native chat @mention (pha B) trả lời đúng KB, có trích dẫn — chỉ trong app Plexco.
- [ ] Native chat bot trả lời khi được @mention, realtime SSE.
- [ ] Tone host chọn phản ánh trong giọng câu trả lời; nội dung KB không đổi.
- [ ] Dưới ngưỡng similarity → no-answer lịch sự, không bịa.
- [ ] Rate-limit + cap câu hỏi/tháng hoạt động; vượt cap thông báo nâng gói.
- [ ] Provider lỗi → fallback, không hỏng canonical, idempotent theo `command_id`.
- [ ] i18n: fallback + câu trả lời qua `t(vi,en)`.

---

## 7. Open Questions / Changelog

### Open Questions (→ decisions.md)

- **DD-18** — Provider embedding/LLM + review privacy/ToS/khu vực dữ liệu (⬜ mở, chặn go-live).
- **DD-19** — Thứ tự pha A trước / pha B (native chat) sau.
- **DD-22** — Định giá/entitlement trợ lý (add-on hay bundle tier cao).
- Object storage cho file thô (bucket/retention) — chốt khi hiện thực.
- Trong kênh chat in-app: ai được hỏi trợ lý — mọi member vs role-restricted (chỉ áp dụng nội bộ app, không có "group công khai").
- Ask-panel async: xác nhận UX chờ kết quả (typing/loading + SSE) so với poll fallback.

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-05 | v0.1 | Khởi tạo Product/UX spec (Draft) từ proposal `club-ai-bot-knowledge-base.md`; 14 use cases, 16 edge cases; phụ thuộc DD-16..DD-23 |
| 2026-07-05 | v0.2 | Thu hẹp scope: trợ lý CHỈ trong app Plexco (bỏ TG/Zalo/Messenger). Surface = panel + native chat in-app; bỏ dependency channel adapter; cập nhật UC-7/12, edge #15, screens, acceptance |
| 2026-07-05 | v0.3 | Đồng bộ review fixes BE: retention contract (edge #12 → TTL + purge job); `bot.ask` hai pha + same-tenant FK ở BE §2/§4.2 |
| 2026-07-05 | v0.4 | Ask-panel bất đồng bộ (202 + SSE/poll); domain model thêm `reason_code`/retention; reword open question "group công khai" → in-app member-only; bump version |
| 2026-07-05 | v0.5 | Thêm bất biến: **live-context (DD-28) tách khỏi prompt KB** (không trộn dữ liệu vận hành vào KB-RAG) |
| 2026-07-10 | v0.5 | **DD-37 + DD-38:** bỏ Telegram khỏi danh sách kênh ("không trả lời ở kênh ngoài Zalo/Messenger"); ghi rõ hạ tầng `chat_*` dựng sớm ở **P4 bởi DD-38** (chat cơ bản phase-1), trợ lý pha B tái dùng ở P7 — cùng bộ bảng, không model song song. Trỏ `feature_inapp_chat.md`. |
