# Feature: Club AI Assistant + Knowledge Base — Product/UX Spec

> **Canonical phase:** P7 (post-MVP)
> **Track:** 🤖 Club Assistant
> **Version:** 0.19 · 2026-08-10
> **Status:** ✅ **Reviewed contract** — DD-86/DD-91/DD-93 authority đã mirror, Product/BE companion closure hoàn tất; implementation vẫn chưa bắt đầu. **DD-18** (provider LLM + privacy/ToS) chỉ là `ENABLEMENT_ONLY` cho GO-LIVE vì provider nằm sau interface swappable; Reviewed không tự authorize code/runtime.
> **Implementation:** Not started · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Prerequisites:** P4 web/app surface + sync engine · P3.5 identity · P5 billing entitlement · (KHÔNG cần channel adapters — trợ lý chỉ chạy trong app Plexco)
> **Tài liệu liên quan:** proposal `../../proposals/club-ai-bot-knowledge-base.md` · BE `../BE/feature_club_assistant_tech.md` · `feature_inapp_chat.md` (DD-38/DD-86) · `../../standards/decisions.md` DD-16..DD-23 · DD-37/DD-38/DD-86/DD-91 · `../../standards/core-db-architecture-principles.md`

> **Cập nhật v3.4 (DD-37 + DD-38, 2026-07-10):** hạ tầng `chat_*` (native chat in-app) nay **được dựng sớm ở P4** bởi **DD-38** (chat cơ bản phase-1, người↔người) — trợ lý (pha B, DD-19) **tái dùng** cùng bộ bảng ở P7, không tạo model song song. Kênh phase-1 = **Zalo + Messenger** (Telegram loại — DD-37); trợ lý vẫn **chỉ trong app Plexco**, không trả lời ở kênh ngoài.

> ✅ **DD-86 decision mirror (2026-07-28):** Option B đã `DECISION_FINAL`. Server derive `assistant_enabled=true` cho `all_members`, `false` cho `admins_only`; actor có exact `chat.channel.manage` được đổi flag trên **cả hai** policy, nhưng execution luôn cần channel flag **AND** tenant bot config + exact entitlement `assistant_ai_kb` + cap/provider/privacy gates. Announcements là `admins_only` nên mặc định false, không phải special-case cấm bật. Ingress/projector consume re-check toàn bộ conjunction; false/unknown → không enqueue/provider/project. Pair Reviewed/not implemented và decision này không authorize chat migration.

> **DD-91 primary-surface boundary:** Club Assistant vẫn là capability **Host Pro** với exact entitlement key `assistant_ai_kb`. Exact slash `/pay` thuộc command registry + Player View, không đi `bot.ask`, không gọi LLM và vẫn hoạt động độc lập khi tenant không có entitlement Assistant. Nếu member @mention trợ lý để hỏi số nợ bằng ngôn ngữ tự nhiên, trợ lý chỉ được trả guidance có trong KB (ví dụ hướng dẫn dùng `/pay`) hoặc `no_answer`; không đọc ledger.

---

## 1. Mô tả

Mỗi CLB (tenant) bật được một **trợ lý AI** riêng **bên trong app Plexco**. Host nạp **knowledge base** từ FAQ + tài liệu nội bộ (dán text, **upload PDF/DOCX/MD/TXT**, URL) và chọn **tone giọng**. Khi thành viên **@mention** trợ lý trong **kênh chat in-app của CLB** (hoặc dùng panel "Hỏi trợ lý"), trợ lý tự trả lời theo KB bằng **RAG hybrid** (BM25 + semantic + RRF), có trích dẫn, có ngưỡng "chưa biết". Mỗi CLB có **1 KB riêng**, cô lập bằng RLS. **Trợ lý CHỈ hoạt động trong app Plexco — KHÔNG trả lời ở kênh ngoài (Zalo/Messenger).** *(Telegram đã loại khỏi phạm vi — DD-37.)*

Hai pha surface, đều trong app Plexco (DD-19): **Pha A** = panel "Hỏi trợ lý" (Q&A trực tiếp, MVP feature), gồm private Club Bot thread derive theo `(tenant_id, requester_person_id)`. **Pha B** = kênh chat in-app native (channel/message/realtime), Assistant trả lời khi structured `@mention` bằng `author_type='assistant'`; không thêm bot membership hay bot `Person`.

**Execution ownership theo primary-surface plan v1.8:** `assistant-kb-storage-authority-core` (27: storage + bounded config) → `assistant-kb-text-ingest-core` (28) → URL/file adapters (29/30) → `assistant-kb-index-activation-worker` (31: generation re-check + CAS activation) → `assistant-kb-retrieval-core` (32) → `assistant-bot-ask-worker` (33) → chat mention/private thread (34/35). HTTP được giao riêng cho A14 `assistant-private-thread-ask-api`, A15 `assistant-kb-text-url-config-api`, A16 `assistant-kb-file-status-api`; product UI được giao cho F12 `assistant-fe-kb-source-manager` và F13 `assistant-fe-config-tone-analytics` sau F0 design authority. Mechanism slices 27–35 không ngầm sở hữu route/UI và adapter không được tái dựng KB, retrieval hoặc provider state. Initiative `PLAN_READY` tại `90d292d`, runtime = 0 và từng slice vẫn phải đạt strict `CODE_READY`.

### Entry points

| Entry | Route / Surface | Actor | Mô tả |
|-------|----------------|-------|-------|
| Club settings → Trợ lý | `/clubs/:id/settings/assistant` | Host | KB manager + config + analytics |
| Chat channel → @mention | In-app chat channel → `@Trợ_lý` | Member | Pha B: bot reply trong channel |
| Club detail → "Hỏi trợ lý" | Side panel / FAB button | Member | Pha A: private ask panel Q&A |
| Club Bot thread | `/clubs/:id/assistant` | Member | Private derived thread `(tenant,requester)` |
| Settings → Upload KB | `/clubs/:id/settings/assistant/sources` | Host | Upload/manage KB sources |
| Settings → Analytics | `/clubs/:id/settings/assistant/analytics` | Host | Usage stats + top unanswered |

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
- Assistant ingress luôn gate exact entitlement `assistant_ai_kb` (Host Pro). Exact `/pay` bị slash registry intercept trước Assistant ingress và không phụ thuộc entitlement này.
- Câu hỏi về nợ gửi qua @mention vẫn là KB-RAG thuần: chỉ guidance đã có trong KB hoặc `no_answer`, tuyệt đối không gọi Player View/ledger/money tool.
- Per-channel Assistant theo DD-86: server default true cho `all_members`, false cho `admins_only`; `chat.channel.manage` có thể đổi flag trên cả hai policy sau server revalidation. Tenant-level enabled không tự vượt qua channel OFF hoặc bất kỳ entitlement/cap/provider/privacy gate nào.
- Private Club Bot thread là presentation shell trên ask-panel, không phải `chat_channels(kind='dm')`: tenant lấy từ route, person lấy từ session, raw transcript chỉ requester đọc, host chỉ aggregate, mỗi câu hỏi độc lập và prior transcript không đi vào prompt. DD-93 slash registry chạy trước `bot.ask`: ASCII case-insensitive, zero alias/arg; `/help|/pay|/me|/myclubs|/discover|/name|/sessions|/waitlist` hợp lệ ở bot thread, mọi command-like input khác private reject.

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
| CAS-UC-16 | Member | Gõ exact `/pay` trong chat có Assistant | Slash registry route thẳng Player View; không tạo `bot_query`, không dùng LLM/Assistant entitlement |
| CAS-UC-17 | Member | @mention trợ lý hỏi “mình còn nợ bao nhiêu?” | Chỉ trả KB guidance hoặc `no_answer`; không trả số tiền từ ledger |
| CAS-UC-18 | Member | Mở private Club Bot thread của một CLB | Derived ask-panel `(tenant,requester)` hiển thị đúng raw Q&A của requester + slash palette; không tạo human DM/bot Person và không dùng prior transcript làm prompt |

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
| 20 | Routing/Security | Exact `/pay` bị phân loại thành `bot.ask` | ❌ NEVER — slash parser có precedence; 0 query/provider call, route Player View requester-only |
| 21 | Security | @mention hỏi số nợ cố kéo money context vào RAG | ❌ NEVER — KB guidance hoặc `no_answer`; prompt/context không có charge/allocation/person data |

---

## 3. Screens & States

> Host web dashboard (KB management + analytics) + Player app/chat (Q&A). Mobile-first 375px; desktop ≥1024.

### Web dashboard — KB manager

**Purpose:** Host quản lý Knowledge Base: upload, re-ingest, archive sources.

**Layout (desktop):**

```
┌──────────────────────────────────────────────────────────┐
│ ← CLB Settings       🤖 Trợ lý CLB                      │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ─── Nguồn tri thức (3) ───                    [+ Thêm] │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Tên              Loại    Đoạn  Gen  Trạng thái    │  │
│  ├────────────────────────────────────────────────────┤  │
│  │ FAQ Cầu lông     Text     12   v3   ✅ Active     │  │
│  │ Nội quy CLB      PDF       8   v1   ✅ Active     │  │
│  │ Bảng giá 2026    CSV       5   v2   ⚠️ Cách ly   │  │
│  │                                      [Re-ingest]   │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Component: Status chip:**

| Status | Chip | Ghi chú |
|--------|------|---------|
| `active` | ✅ Active | Current gen, queryable |
| `processing` | ⏳ Đang xử lý | Ingesting/embedding |
| `blocked_sensitive_content` | ⚠️ Cách ly | DLP flagged; chỉ hiện class, không secret |
| `archived` | 📦 Đã lưu trữ | No longer queryable |
| `error` | ❌ Lỗi | Ingest/embed failed |

**4 States:**

| State | Nội dung |
|-------|----------|
| Loading | "Đang tải KB..." skeleton table |
| Ready | Source table + status chips + actions |
| Error | "Lỗi tải KB" banner + retry |
| Empty | Icon 📚 + "Chưa có tài liệu" + "Thêm FAQ / Upload" CTA |

### Web dashboard — Upload / nạp nguồn

**Layout:**

```
┌──────────────────────────────────────────────────────────┐
│ ← KB Manager          📄 Thêm nguồn tri thức            │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Loại nguồn     [Text/FAQ ▼]                             │
│                                                          │
│  ─── Text ───                                            │
│  Tên nguồn *    [FAQ Cầu lông              ]             │
│  Nội dung *     [                          ]             │
│                 [                          ]             │
│                 [                          ]             │
│                                                          │
│  ─── HOẶC Upload file ───                                │
│  [📎 Kéo thả file hoặc chọn file]                       │
│  Hỗ trợ: PDF, TXT, CSV, MD (≤5MB)                      │
│                                                          │
│        [═══ Nạp & Index ═══]                             │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**States:** Loading ("Đang xử lý tài liệu...") | Ready ("✅ Đã index [n] đoạn") | Error ("Nội dung nhạy cảm — đã cách ly") | Empty (N/A)

### Web dashboard — Cấu hình trợ lý

**Layout:**

```
┌──────────────────────────────────────────────────────────┐
│ ← Trợ lý CLB         ⚙️ Cấu hình                       │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Tên trợ lý      [Trợ lý CLB Rồng Xanh     ]           │
│  Giọng điệu      [Thân thiện ▼]                         │
│                   Chuyên nghiệp / Thân thiện / Vui vẻ   │
│  Ngưỡng tương tự  [0.7] ◼◼◼◼◼◻◻◻ (min_similarity)      │
│  Giới hạn/tháng   [500] câu hỏi                         │
│  Bật trợ lý       [●○] ON                               │
│                                                          │
│  ─── Preview ───                                         │
│  "Xin chào! Mình là trợ lý CLB Rồng Xanh 👋            │
│   Hỏi mình bất cứ gì về CLB nhé!"                       │
│                                                          │
│        [═══ Lưu cấu hình ═══]                            │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### App panel — Hỏi trợ lý (Pha A)

**Layout (side panel or modal):**

```
┌──────────────────────────────────────┐
│ 🤖 Trợ lý CLB Rồng Xanh            │
├──────────────────────────────────────┤
│                                      │
│  Bạn: "Giá cầu lông bao nhiêu?"     │
│                                      │
│  🤖: "Giá buổi cầu lông là          │
│       120,000₫/người. Buổi tối      │
│       thứ 3, 5 là 150,000₫."        │
│                                      │
│  📎 Nguồn: FAQ Cầu lông (đoạn 3)   │
│                                      │
│  ─── Bạn hài lòng? ───              │
│  [👍] [👎]                           │
│                                      │
├──────────────────────────────────────┤
│ [Hỏi trợ lý...                 ] [→]│
└──────────────────────────────────────┘
```

**States:** Loading ("Đang tìm...") | Ready (answer + source citation) | Error ("Lỗi — thử lại") | Empty ("Chưa có tri thức để trả lời")

### Native chat — Bot reply (Pha B)

**Layout (in-chat):**

```
│  @Trợ lý giá cầu lông?       Bạn   │
│                                      │
│  🤖 Trợ lý CLB                      │
│  ┌──────────────────────────────┐   │
│  │ Giá cầu lông: 120,000₫.    │   │
│  │ Buổi tối T3/T5: 150,000₫.  │   │
│  │ 📎 FAQ Cầu lông             │   │
│  └──────────────────────────────┘   │
```

### Web dashboard — Analytics trợ lý

**Layout:**

```
┌──────────────────────────────────────────────────────────┐
│ ← Trợ lý CLB         📊 Phân tích                       │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ─── Tháng 08/2026 ───                                   │
│  Câu hỏi: 142 / 500          ████████░░ 28%             │
│  Không trả lời được: 8%                                  │
│                                                          │
│  ─── Top câu chưa trả lời ───                           │
│  1. "Sân ở đâu?" (12 lần)                               │
│  2. "Có dạy kèm không?" (5 lần)                         │
│  3. "Giờ mở cửa?" (3 lần)                               │
│                                                          │
│  → Thêm câu trả lời vào KB để cải thiện                │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**States:** Loading ("Đang tải...") | Ready (stats + top unanswered) | Error ("Lỗi") | Empty ("Chưa có lượt hỏi")

### Data source mapping

| Component | Data source | Ghi chú |
|-----------|-------------|---------|
| KB sources | `kb_sources` per tenant | Status + generation tracking |
| Documents | `kb_documents` per source | Text normalized, revision |
| Chunks/vectors | `kb_chunks` | Embedding + FTS, fenced by source |
| Config | `bot_configs` per tenant | Tone, threshold, cap |
| Query log | `bot_queries` | Append-only, retention/redact |
| Embed cache | `embedding_cache` | Global, profile+hash key |

### State coverage matrix

| Screen | Loading | Ready | Error | Empty |
|--------|---------|-------|-------|-------|
| KB manager | ✅ "Đang tải KB..." | ✅ Source table + chips | ✅ "Lỗi tải KB" | ✅ "Chưa có tài liệu" + CTA |
| Upload source | ✅ "Đang xử lý..." | ✅ "Đã index [n] đoạn" | ✅ "Cách ly" / file error | ⚪ N/A |
| Config | — | ✅ Form + preview | ✅ "Lỗi lưu" | ⚪ N/A |
| App Q&A (Pha A) | ✅ "Đang tìm..." | ✅ Answer + citation | ✅ "Lỗi — thử lại" | ✅ "Chưa có tri thức" |
| Chat bot (Pha B) | ✅ Typing indicator | ✅ Bot message + citation | ✅ "Lỗi — thử lại" | ✅ "Chưa có thông tin" |
| Analytics | ✅ "Đang tải..." | ✅ Stats + top unanswered | ✅ "Lỗi" | ✅ "Chưa có lượt hỏi" |

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
| `chat_channels` | Tenant-private cho club | Kênh chat in-app canonical (pha B) | Assistant chỉ phát trong `kind='club'`, không phát trong DM; DD-86: default true `all_members`/false `admins_only`, mutable trên cả hai chỉ qua `chat.channel.manage`; consume-time all-gates vẫn bắt buộc |
| `chat_members` | Theo canonical In-app Chat | Membership/read-state của channel | Tái dùng nguyên `feature_inapp_chat.md`; không tạo membership table song song |
| `chat_messages` | Theo canonical In-app Chat | Tin nhắn person/assistant/system | `author_type ∈ {person,assistant,system}`, `client_msg_id`; assistant/system ⇒ `membership_id` NULL; assistant adapter gắn `bot_query_id` |

> Chi tiết DDL + RLS ở `../BE/feature_club_assistant_tech.md §2`. Không entity nào thuộc public plane (không vào `public_sessions`).

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
- [ ] Per-channel `assistant_enabled` server-default true cho `all_members`, false cho `admins_only`; exact `chat.channel.manage` có thể đổi trên cả hai policy, nhưng ingress + consume chỉ chạy khi channel flag và toàn bộ tenant/entitlement/cap/provider/privacy gates cùng pass.
- [ ] Ingress và projector consume re-read channel flag + tenant config + `assistant_ai_kb` + cap/provider/privacy; mọi false/unknown không tạo query/provider attempt/assistant message.
- [ ] Tone host chọn phản ánh trong giọng câu trả lời; nội dung KB không đổi.
- [ ] Dưới ngưỡng similarity → no-answer lịch sự, không bịa.
- [ ] Rate-limit + cap câu hỏi/tháng hoạt động; vượt cap thông báo nâng gói.
- [ ] Provider lỗi/crash → fallback, không hỏng canonical, một durable answer/message theo `command_id`; telemetry/cap phản ánh mọi provider attempt và docs không tuyên bố exactly-once external billing nếu adapter chưa hỗ trợ idempotency key.
- [ ] i18n: fallback + câu trả lời qua `t(vi,en)`.
- [ ] Mọi Assistant ingress gate exact Host Pro entitlement `assistant_ai_kb`; key `assistant` rút gọn không được dùng làm authority.
- [ ] Exact `/pay` không tạo `bot_query`, không gọi embed/chat provider và vẫn dùng được khi `assistant_ai_kb` false/unavailable.
- [ ] @mention hỏi nợ chỉ trả KB guidance hoặc `no_answer`; test prompt/context chứng minh không đọc Player View/ledger/money data.
- [ ] Private Club Bot thread bind exact `(tenant,requester)`, raw transcript chỉ asker đọc, host/support chỉ aggregate; DD-93 ASCII case-insensitive zero-arg catalog đi command router trước `bot.ask`, unsupported/invalid command private reject, và prior Q&A không được concat vào prompt.
- [ ] KB delivery giữ đúng chain 27→28→29/30→31→32→33→34/35; stale generation không thể thắng CAS để active lại document/chunk cũ.
- [ ] A14–A16 chỉ làm auth/session/action authz, validation, privacy/cache header và DTO; không re-derive ingest/retrieval/answer state. F12/F13 chỉ mở sau F0 và dùng API thật, đủ loading/ready/empty/error.
- [ ] Reviewed contract này không được dùng làm runtime proof: trước immutable authority re-pin và strict per-slice `CODE_READY`, không migration/worktree/route/provider/UI nào được coi là authorized hoặc implemented.

---

## 7. Open Questions / Changelog

### Open Questions (→ decisions.md)

- **DD-18** — Provider embedding/LLM + review privacy/ToS/khu vực dữ liệu (⬜ mở, chặn go-live).
- **DD-19** — ✅ Đã pin: pha A ask-panel trước, pha B native chat chỉ sau canonical chat root.
- **DD-22** — ✅ Chốt: exact entitlement `assistant_ai_kb` thuộc Host Pro (DD-29/DD-91); không còn open pricing decision trong feature này.
- Object storage vendor/credential/region là `ENABLEMENT_ONLY`: Product contract đã chốt private pending/quarantine/ready lifecycle, signed access, retention và DLP-before-provider. File upload nằm ở mechanism 30 sau storage/text 27/28, route A16 và UI F12; thiếu provider/scanner config giữ upload OFF, không làm thay đổi schema/behavior dark.
- Trong kênh chat in-app: ✅ phase-1 chỉ `active` member đã được authorize trong channel được hỏi; `guest|left|non-member` bị deny. Role-restricted ask mode không nằm trong phase-1.
- Ask-panel async: ✅ `POST` trả `202 {query_id}`; SSE `assistant.answer` là đường chính, authenticated poll cùng query là fallback. Không wait-with-timeout.
- **DD-86** — ✅ `DECISION_FINAL`, 0 open in-scope; Option B + defaults true `all_members`/false `admins_only` + exact capability mutation/full conjunction đã mirror. Pha B vẫn phụ thuộc canonical chat root runtime; pair Reviewed/not implemented.

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-08-10 | v0.19 | **A-grade upgrade:** thêm Entry points table (6 entries); bump version. Không đổi contract/domain model. |
| 2026-07-28 | v0.18 | Re-pin primary-surface plan v1.8 `PLAN_READY` tại `90d292d`; immutable authority/closure blocker đã đóng. Giữ runtime = 0, B4/worktree chưa author và strict per-slice `CODE_READY`; DD-18 vẫn enablement-only. |
| 2026-07-28 | v0.17 | Mirror executable ownership từ primary-surface plan v1.7: slices 27→35 tách storage/config, text, URL/file, generation-CAS index, retrieval, `bot.ask`, mention/private thread; A14–A16 sở hữu HTTP và F12/F13 sở hữu Host UI sau F0. Giữ `NOT_PLAN_READY`, runtime = 0 tới immutable re-pin + strict per-slice `CODE_READY`. |
| 2026-07-28 | v0.16 | Owner-final companion closure: promote Product spec to Reviewed; mirror DD-86 defaults true `all_members`/false `admins_only`, mutable on both policies under exact capability + full conjunction; mirror DD-93 eight-command private-thread registry. DD-18 remains enablement-only; no runtime/migration authorization. |
| 2026-07-28 | v0.15 | Historical snapshot superseded by v0.16; it temporarily restored Draft/universal-default-OFF after an overlapping stale-authority reconciliation. |
| 2026-07-28 | v0.14 | Historical working-tree snapshot; its Reviewed/default-ON direction is now ratified and reissued with complete companion closure in v0.16. |
| 2026-07-28 | v0.13 | Mirror DD-86 final: per-channel Assistant storage defaults OFF, explicit `chat.channel.manage` opt-in, consume-time conjunction with tenant/`assistant_ai_kb`/cap/provider/privacy gates, and Announcements always OFF. DD-86 open count closes; Assistant remains Draft/not implemented. |
| 2026-07-27 | v0.12 | Close stale OQ bằng contract đã có: DD-19 A→B, active-member ask authority và `202 + SSE/poll` async. Reuse exact 30-day `bot_queries` TTL/purge cho private Assistant thread. Raw file-upload object storage được negative-scope khỏi primary-surface v1; FAQ/paste/URL KB vẫn in-scope. Draft/not implemented giữ nguyên. |
| 2026-07-27 | v0.11 | Mirror DD-91: giữ Assistant ở Host Pro với exact key `assistant_ai_kb`; `/pay` bypass `bot.ask`/LLM và độc lập entitlement; @mention hỏi nợ chỉ KB guidance/`no_answer`. Giữ Draft/not implemented. |
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
