# Feature: Club AI Assistant + Knowledge Base — Product/UX Spec

> **Canonical phase:** P7 (post-MVP, **đề xuất**)
> **Track:** 🤖 Club Assistant
> **Version:** 0.10 · 2026-07-22
> **Status:** 🟡 Draft — DD-16/17/19–28 liên quan đã chốt và contract đã harden; sẵn sàng cho review/promotion, nhưng **chưa build-ready cho tới khi được formally promote sang Reviewed**. **DD-18** (provider LLM + privacy/ToS) ⬜ là gate **GO-LIVE** sau khi scope implementation được duyệt, không phải lý do tự động promote/build (interface swappable).
> **Implementation:** Not started · authority: `../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Prerequisites:** P4 web/app surface + sync engine · P3.5 identity · P5 billing entitlement · (KHÔNG cần channel adapters — trợ lý chỉ chạy trong app Plexco)
> **Tài liệu liên quan:** proposal `../proposals/club-ai-bot-knowledge-base.md` · BE `BE/feature_club_assistant_tech.md` · `feature_inapp_chat.md` (chat cơ bản, DD-38; multi-channel proposal DD-86) · `../standards/decisions.md` DD-16..DD-23 · DD-37/DD-38/DD-86 · `../standards/core-db-architecture-principles.md`

> **Cập nhật v3.4 (DD-37 + DD-38, 2026-07-10):** hạ tầng `chat_*` (native chat in-app) nay **được dựng sớm ở P4** bởi **DD-38** (chat cơ bản phase-1, người↔người) — trợ lý (pha B, DD-19) **tái dùng** cùng bộ bảng ở P7, không tạo model song song. Kênh phase-1 = **Zalo + Messenger** (Telegram loại — DD-37); trợ lý vẫn **chỉ trong app Plexco**, không trả lời ở kênh ngoài.

> 🟡 **DD-86 proposal boundary (2026-07-22):** nếu Option B được owner chốt, pha B chỉ hoạt động trong từng club channel khi `assistant_enabled=true` **AND** tenant bot config/entitlement/provider/privacy gates đều pass. DD-86 chưa là authority; Product/BE Assistant vẫn Draft/not implemented và không được dùng để authorize chat migration.

---

## 1. Mô tả

Mỗi CLB (tenant) bật được một **trợ lý AI** riêng **bên trong app Plexco**. Host nạp **knowledge base** từ FAQ + tài liệu nội bộ (dán text, **upload PDF/DOCX/MD/TXT**, URL) và chọn **tone giọng**. Khi thành viên **@mention** trợ lý trong **kênh chat in-app của CLB** (hoặc dùng panel "Hỏi trợ lý"), trợ lý tự trả lời theo KB bằng **RAG hybrid** (BM25 + semantic + RRF), có trích dẫn, có ngưỡng "chưa biết". Mỗi CLB có **1 KB riêng**, cô lập bằng RLS. **Trợ lý CHỈ hoạt động trong app Plexco — KHÔNG trả lời ở kênh ngoài (Zalo/Messenger).** *(Telegram đã loại khỏi phạm vi — DD-37.)*

Hai pha surface, đều trong app Plexco (DD-19): **Pha A** = panel "Hỏi trợ lý" (Q&A trực tiếp, MVP feature). **Pha B** = kênh chat in-app native (channel/message/realtime) có bot là thành viên, trả lời khi @mention.

### Bất biến

- KB / chat / query-log = **tenant-private, RLS fail-closed**. KB CLB A **KHÔNG BAO GIỜ** retrieve được từ CLB B.
- Trợ lý **chỉ** ground trên KB đã qua content-DLP; **KHÔNG** nối `charges`/`memberships`/`persons`/SĐT/secret vào LLM. Secret/credential/PII phát hiện sau extract phải quarantine trước chunk/embed/retrieve; host redact rồi re-ingest (HR2, DD-21).
- Mỗi nguồn có **một identity ổn định trong tenant** (`source_key` không đổi theo nội dung). Khi nội dung đổi, hệ thống phải atomically supersede document/chunk cũ **trước** khi xử lý revision mới; revision mới bị DLP chặn thì revision cũ vẫn bị loại khỏi retrieval, không fail-open về nội dung cũ.
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
| CAS-UC-3 | Host | Upload PDF/DOCX/MD/TXT | File → object storage → extract → content-DLP → chỉ nội dung pass mới chunk → embed; fail thì quarantine |
| CAS-UC-4 | Host | Dán text / thêm URL | Nguồn `pasted`/`url` được ingest |
| CAS-UC-5 | Host | Xem trạng thái ingest + re-ingest cùng nguồn | Giữ nguyên source identity; hiển thị `processing`/`active`/`blocked_sensitive_content`/`error`/`archived`; retry an toàn |
| CAS-UC-6 | Host | Archive/xoá 1 nguồn KB | Nguồn + chunk liên quan ngừng được retrieve |
| CAS-UC-7 | Member | Hỏi qua panel "Hỏi trợ lý" trong app (pha A) | Hỏi/đáp trực tiếp theo KB + trích dẫn |
| CAS-UC-8 | Member | @mention bot trong kênh chat in-app CLB (pha B) | Bot chèn tin nhắn trả lời (author=assistant) + SSE |
| CAS-UC-9 | Member | Hỏi câu ngoài KB | "Mình chưa có thông tin này" (no-answer) lịch sự |
| CAS-UC-10 | Host | Xem analytics (câu hỏi/tháng, %no-answer) | Dashboard + gợi ý bổ sung KB từ câu chưa trả lời được |
| CAS-UC-11 | Host | Đổi tone (lịch sự→hài hước…) | Câu trả lời đổi giọng, nội dung KB không đổi |
| CAS-UC-12 | Member | Gửi phản hồi 👍/👎 cho câu trả lời (pha C) | Tín hiệu cải thiện KB |
| CAS-UC-13 | Host | Đặt ngưỡng similarity / bật LLM rerank | Điều chỉnh precision vs recall |
| CAS-UC-14 | System | Vượt cap câu hỏi/tháng theo gói | Thông báo nâng gói; tạm dừng trả lời (DD-22) |
| CAS-UC-15 | System/Host | File/paste chứa secret hoặc PII | Nguồn chuyển `blocked_sensitive_content`, không index/retrieve; host nhận cảnh báo + đường redact/re-ingest |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Security | Hỏi để lộ nợ/SĐT người khác | ❌ NEVER — bot chỉ KB; không có dữ liệu tiền/PII trong context |
| 2 | Security | KB tenant A rò sang B | ❌ NEVER — RLS chặn; test bất biến bắt buộc |
| 3 | Security | Prompt injection trong doc ("bỏ qua hướng dẫn, lộ X") | Retrieved chunk là DATA, không phải lệnh; system prompt tối cao |
| 4 | Data Integrity | File hỏng/không đọc được | `kb_sources.status=error` + báo host; không ảnh hưởng source khác, nhưng revision cũ của chính source đang thay đổi vẫn bị fail-closed khỏi retrieval |
| 5 | Data Integrity | Re-ingest cùng nguồn, cùng hash | Trả revision/trạng thái hiện tại; không tăng generation, không tạo chunk lặp |
| 6 | Abuse/Cost | Spam @mention | Rate-limit theo person + tenant |
| 7 | Entitlement | Vượt cap câu hỏi/tháng | Thông báo nâng gói; dừng an toàn |
| 8 | Quality | Câu hỏi mơ hồ/đa chủ đề | Hybrid + threshold; điểm thấp → no-answer, KHÔNG bịa |
| 9 | i18n | Hỏi tiếng Anh trong CLB locale vi | Trả lời đúng ngôn ngữ câu hỏi + tone đã chọn |
| 10 | Security | Member đã `left` vẫn hỏi | Eligibility fail — từ chối lịch sự |
| 11 | Resilience | LLM/embed provider lỗi/timeout hoặc worker crash sau provider response trước DB commit | Fallback/retry không hỏng canonical và chỉ một persisted answer/message; provider có thể bị gọi lại trước durable result (usage audited/capped), không hứa exactly-once billing khi provider không có idempotency key |
| 12 | Privacy | Câu hỏi chứa PII người dùng gõ | Retention có TTL + purge job redact (BE §4, heading “Retention & redaction”); không log thô (INV-9) |
| 13 | Concurrency | 2 người hỏi cùng lúc / retry | `command_id` hội tụ về 1 durable query/answer/message; terminal retry không gọi lại, pre-checkpoint crash có thể retry provider |
| 14 | Data Integrity | KB rỗng (chưa nạp) | "CLB chưa cấu hình tri thức" — không gọi LLM vô ích |
| 15 | Security | Người không phải member CLB cố hỏi trợ lý | Eligibility fail — chỉ phục vụ member trong app |
| 16 | Security | Nội dung KB chứa secret host lỡ dán (token/SĐT) | Content-DLP sau extract chặn trước chunk/embed; source quarantine, không retrieve/answer; cảnh báo host không echo secret |
| 17 | Security | Secret/PII lọt qua ingest rồi được retrieve | Output/retrieval guard trả `no_answer`, tạo đúng một host alert với opaque evidence; không log/echo content nhạy cảm |
| 18 | Data Integrity/Security | Nguồn active được thay bằng nội dung mới nhưng revision mới bị DLP chặn | Document/chunk cũ đã `superseded` vẫn không retrieve được; UI giữ source ở `blocked_sensitive_content`/quarantine cho tới khi host redact và re-ingest |
| 19 | Concurrency | Worker revision cũ hoàn tất sau một re-ingest mới hơn | So khớp `source_id + generation`; worker cũ bị discard, không thể kích hoạt lại document/chunk cũ |

---

## 3. Screens & States

| Surface | Screen | Loading | Ready | Error | Empty |
|---------|--------|---------|-------|-------|-------|
| Web dashboard | KB manager (danh sách nguồn) | "Đang tải KB..." | Bảng nguồn + generation + status chip + nút re-ingest/archive; `blocked_sensitive_content` hiện “Đã cách ly” | "Lỗi tải KB" | "Chưa có tài liệu — thêm FAQ/upload" |
| Web dashboard | Upload/nạp nguồn | "Đang xử lý tài liệu..." | "✅ Đã index [n] đoạn" | File lỗi hoặc “Nội dung nhạy cảm — đã cách ly; hãy redact rồi nạp lại”; chỉ hiện detector class, không hiển thị secret | N/A |
| Web dashboard | Cấu hình trợ lý (tên, tone, ngưỡng) | — | Form + preview giọng | "Lỗi lưu cấu hình" | N/A |
| App panel | Hỏi trợ lý (pha A) | "Đang tìm..." | Câu trả lời + trích dẫn nguồn | "Lỗi — thử lại" | "Chưa có tri thức để trả lời" |
| Native chat (pha B) | Bot trả lời khi @mention | typing indicator | Tin nhắn assistant + trích dẫn | "Lỗi — thử lại" | "Mình chưa có thông tin này" |
| Web dashboard | Analytics trợ lý | "Đang tải..." | Câu hỏi/tháng, %no-answer, top câu chưa trả lời | "Lỗi" | "Chưa có lượt hỏi" |

---

## 4. Domain Model

| Entity | Plane | Vai trò | Key constraints |
|--------|-------|---------|-----------------|
| `bot_configs` | Tenant-private | Cấu hình trợ lý per-CLB | `UNIQUE(tenant_id)`, `tone` enum, `enabled`, `min_similarity`, `monthly_question_cap` |
| `kb_sources` | Tenant-private | Identity ổn định + revision hiện tại của nguồn | `UNIQUE(tenant,source_key)`, `current_generation`, `content_hash`, `status`, `dlp_cleared_at`; hash không phải identity |
| `kb_documents` | Tenant-private | Text chuẩn hoá theo revision | `source_id` + `source_generation`, `lang`, `status ∈ {active,superseded,archived}`; chỉ current generation active được retrieve |
| `kb_chunks` | Tenant-private | Chunk + vector + fts theo document revision | `status ∈ {active,superseded,archived}`, `embedding`/`summary_embedding`, `fts_vector`; query phải fence qua source + document + chunk |
| `embedding_cache` | Global (profile+hash→vec) | Cache embed theo model/profile + SHA256 content | Composite key `(embed_model, embed_dims, profile_version, content_sha256)`; không dùng vector model A cho model B; không chứa ngữ cảnh tenant |
| `bot_queries` | Tenant-private | Log 1 lượt hỏi→đáp (append-only, async 2 pha) | `UNIQUE(tenant,command_id)`, `status`, `reason_code`, `retention_expires_at`/`redacted_at`, `retrieved_chunk_ids` |
| `bot_provider_attempts` | Tenant-private | Durable evidence cho external embed/chat attempt | Per-query monotonic attempt; status/opaque provider request ID/usage/cost; dùng để cap và audit pre-checkpoint retry, không tuyên bố exactly-once provider |
| `chat_channels` | Tenant-private cho club | Kênh chat in-app canonical (pha B) | Assistant chỉ phát trong `kind='club'`, không phát trong DM; **conditional DD-86:** thêm `assistant_enabled=true` và vẫn bắt buộc toàn bộ tenant config/entitlement/provider/privacy gates |
| `chat_members` | Theo canonical In-app Chat | Membership/read-state của channel | Tái dùng nguyên `feature_inapp_chat.md`; không tạo membership table song song |
| `chat_messages` | Theo canonical In-app Chat | Tin nhắn person/assistant/system | `author_type ∈ {person,assistant,system}`, `client_msg_id`; assistant/system ⇒ `membership_id` NULL; assistant adapter gắn `bot_query_id` |

> Chi tiết DDL + RLS ở `BE/feature_club_assistant_tech.md §2`. Không entity nào thuộc public plane (không vào `public_sessions`).

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu |
|-------|---------|-------------------|
| `assistant_enabled` | Host bật/tắt trợ lý | `tenant_id`, `enabled` |
| `assistant_tone_changed` | Host đổi tone | `tenant_id`, `tone` |
| `kb_source_ingested` | Nguồn index xong | `tenant_id`, opaque `source_id`, `generation`, `kind`, `chunk_count` |
| `kb_ingest_failed` | Ingest lỗi | `tenant_id`, opaque `source_id`, `generation`, `kind`, `error_class` |
| `kb_sensitive_content_blocked` | DLP chặn ingest/retrieval | `tenant_id`, opaque `source_id`, `generation`, `kind`, `detector_class`; không content/match text |
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
- [ ] Extracted text phải qua DLP trước chunk/embed; test-secret/PII chuyển source sang `blocked_sensitive_content`, tạo 0 active chunk/embedding và không retrieve được tới khi redact/re-ingest.
- [ ] Retrieval/output guard không echo sensitive content và phát đúng một host alert có opaque evidence nếu invariant bị phá.
- [ ] Re-ingest giữ nguyên `(tenant_id, source_key)`; revision đổi hash atomically supersede document/chunk cũ trước worker, và chỉ current generation `active` + `dlp_cleared_at` được retrieve.
- [ ] Revision mới bị DLP chặn không fallback về revision cũ; UI hiện `blocked_sensitive_content`/quarantine cho host redact + re-ingest.
- [ ] Upload PDF/DOCX/MD/TXT → extract → index; file lỗi báo host, không ảnh hưởng source KB khác; source đang thay đổi vẫn fail-closed.
- [ ] Re-ingest cùng source + cùng hash không tăng generation/không tạo chunk lặp; re-ingest khác hash an toàn.
- [ ] Panel "Hỏi trợ lý" (pha A) + native chat @mention (pha B) trả lời đúng KB, có trích dẫn — chỉ trong app Plexco.
- [ ] Native chat bot trả lời khi được @mention, realtime SSE.
- [ ] Nếu DD-86 được chốt: per-channel `assistant_enabled` là gate bổ sung, không thay tenant bot config/entitlement/provider/privacy; mọi false/unknown đều không tạo assistant query/message.
- [ ] Tone host chọn phản ánh trong giọng câu trả lời; nội dung KB không đổi.
- [ ] Dưới ngưỡng similarity → no-answer lịch sự, không bịa.
- [ ] Rate-limit + cap câu hỏi/tháng hoạt động; vượt cap thông báo nâng gói.
- [ ] Provider lỗi/crash → fallback, không hỏng canonical, một durable answer/message theo `command_id`; telemetry/cap phản ánh mọi provider attempt và docs không tuyên bố exactly-once external billing nếu adapter chưa hỗ trợ idempotency key.
- [ ] i18n: fallback + câu trả lời qua `t(vi,en)`.

---

## 7. Open Questions / Changelog

### Open Questions (→ decisions.md)

- **DD-18** — Provider embedding/LLM + review privacy/ToS/khu vực dữ liệu (⬜ mở, chặn go-live).
- **DD-19** — Thứ tự pha A trước / pha B (native chat) sau.
- **DD-22** — ✅ Chốt: entitlement `assistant` thuộc Host Pro (DD-29); không còn open pricing decision trong feature này.
- Object storage cho file thô (bucket/retention) — chốt khi hiện thực.
- Trong kênh chat in-app: ai được hỏi trợ lý — mọi member vs role-restricted (chỉ áp dụng nội bộ app, không có "group công khai").
- Ask-panel async: xác nhận UX chờ kết quả (typing/loading + SSE) so với poll fallback.
- **DD-86** — 🟡 proposal multi-channel, 9 blocker in-scope; không đổi pha A. Pha B/migration chat HOLD tới owner decision + Product/BE chat promotion.

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-22 | v0.10 | Mirror DD-86 proposal có điều kiện: pha B yêu cầu per-channel `assistant_enabled` AND tenant config/entitlement/provider/privacy; giữ Assistant Draft/not implemented và không coi proposal là migration authorization. |
| 2026-07-19 | v0.9a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-17 | v0.9 | **Readiness closure:** giữ formal status 🟡 Draft cho tới khi Product + BE pair được promote Reviewed; DD-18 tiếp tục là gate GO-LIVE, không tự biến spec thành build-ready. BE companion đồng thời chuyển migration/RLS sang migration mới self-contained và canonical API envelope. |
| 2026-07-17 | v0.8 | **Provider-truth/cache closure:** narrow idempotency claim to one durable result/message while acknowledging pre-checkpoint provider retries; key embedding cache by model+dims+profile+content hash to prevent cross-model vector reuse. |
| 2026-07-17 | v0.7 | **DLP re-ingest + canonical chat closure:** pin stable tenant-scoped `source_key`, generation fencing, atomic supersession và fail-closed khi revision mới bị quarantine; UI hiển `blocked_sensitive_content`; bỏ membership/chat model song song, tái dùng canonical `chat_members`/`chat_messages` + `client_msg_id`. |
| 2026-07-17 | v0.6 | **DD-21 DLP closure:** extracted content scanned before chunk/embed; sensitive source quarantined, no retrieval; output guard + opaque host alert; DD-22 marked closed under Host Pro. |
| 2026-07-05 | v0.1 | Khởi tạo Product/UX spec (Draft) từ proposal `club-ai-bot-knowledge-base.md`; 14 use cases, 16 edge cases; phụ thuộc DD-16..DD-23 |
| 2026-07-05 | v0.2 | Thu hẹp scope: trợ lý CHỈ trong app Plexco (bỏ TG/Zalo/Messenger). Surface = panel + native chat in-app; bỏ dependency channel adapter; cập nhật UC-7/12, edge #15, screens, acceptance |
| 2026-07-05 | v0.3 | Đồng bộ review fixes BE: retention contract (edge #12 → TTL + purge job); `bot.ask` hai pha + same-tenant FK ở BE §2/§4 |
| 2026-07-05 | v0.4 | Ask-panel bất đồng bộ (202 + SSE/poll); domain model thêm `reason_code`/retention; reword open question "group công khai" → in-app member-only; bump version |
| 2026-07-05 | v0.5 | Thêm bất biến: **live-context (DD-28) tách khỏi prompt KB** (không trộn dữ liệu vận hành vào KB-RAG) |
| 2026-07-10 | v0.5 | **DD-37 + DD-38:** bỏ Telegram khỏi danh sách kênh ("không trả lời ở kênh ngoài Zalo/Messenger"); ghi rõ hạ tầng `chat_*` dựng sớm ở **P4 bởi DD-38** (chat cơ bản phase-1), trợ lý pha B tái dùng ở P7 — cùng bộ bảng, không model song song. Trỏ `feature_inapp_chat.md`. |
