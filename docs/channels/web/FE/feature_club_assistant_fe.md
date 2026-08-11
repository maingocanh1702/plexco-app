# Feature: Club AI Assistant — FE Design Spec

> **Route(s):** `/clubs/:tenantId/settings/assistant` · `/clubs/:tenantId/settings/assistant/sources` · `/clubs/:tenantId/settings/assistant/analytics` · Ask panel (in-app)
> **Source authority:** `../../../features/FE/feature_club_assistant.md` v0.19 · baseline `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4`
> **Source contract status:** Reviewed contract — DD-86/DD-91/DD-93 authority mirror; implementation chưa bắt đầu
> **Projection/API contract:** KB CRUD + bot.ask HTTP + SSE answer delivery
> **Capability/availability:** Host Pro entitlement `assistant_ai_kb` required; per-channel enabled flag
> **Priority:** — P7 post-MVP; thiết kế UI trước cho design consistency
> **FE design status:** Draft
> **Runtime status:** Not started — KB/bot/UI chưa build
> **Negative scope:** Trợ lý CHỈ trong app Plexco — không trả lời ở Zalo/Messenger; không đọc ledger/money/PII; `/pay` bypass trợ lý hoàn toàn

---

## 1. Mô tả

Mỗi CLB bật được một trợ lý AI riêng trong app Plexco. Host nạp knowledge base (FAQ, text, PDF/DOCX upload) và chọn tone giọng. Member hỏi trợ lý qua panel "Hỏi trợ lý" (pha A) hoặc @mention trong chat CLB (pha B). Trợ lý trả lời theo KB bằng RAG, có trích dẫn nguồn, có ngưỡng "chưa biết". Không trả lời về tiền/nợ/PII — chỉ guidance trong KB.

---

## 2. User Flows

### Flow 1: Host bật + cấu hình trợ lý

1. Host vào Settings → tab "Trợ lý"
2. Toggle bật → đặt tên, chọn tone, điều chỉnh ngưỡng similarity
3. Lưu cấu hình → preview welcome message

### Flow 2: Host nạp KB

1. Vào "Nguồn tri thức" → [+ Thêm]
2. Chọn loại: Text/FAQ | Upload file (PDF/DOCX/MD/TXT)
3. Submit → processing → active (hoặc quarantine nếu DLP detect sensitive content)
4. Source hiện trong table với status chip

### Flow 3: Member hỏi trợ lý (Pha A — Ask Panel)

1. Trong Club detail → tap FAB "🤖 Hỏi trợ lý"
2. Side panel mở → gõ câu hỏi → submit
3. Loading "Đang tìm..." → answer + source citation
4. Feedback: 👍/👎

### Flow 4: Host xem analytics

1. Settings → Analytics → thống kê tháng
2. Xem: câu hỏi/tháng, % no-answer, top câu chưa trả lời
3. CTA: "Thêm câu trả lời vào KB" → link về KB manager

---

## 3. Screens & States

### KB Manager — `/clubs/:tenantId/settings/assistant/sources`

#### Layout (Desktop 1440px)

```
┌──────────┬──────────────────────────────────────────────────────┐
│          │  ← Settings         🤖 Nguồn tri thức    [+ Thêm]  │
│ Sidebar  ├──────────────────────────────────────────────────────┤
│          │                                                      │
│          │  ┌─────────────────────────────────────────────────┐ │
│          │  │ Tên              Loại    Đoạn  Gen  Trạng thái │ │
│          │  ├─────────────────────────────────────────────────┤ │
│          │  │ FAQ Cầu lông     Text     12   v3   ✅ Active  │ │
│          │  │ Nội quy CLB      PDF       8   v1   ✅ Active  │ │
│          │  │ Bảng giá 2026    CSV       5   v2   ⚠️ Cách ly │ │
│          │  │                                     [Re-ingest] │ │
│          │  └─────────────────────────────────────────────────┘ │
│          │                                                      │
└──────────┴──────────────────────────────────────────────────────┘
```

#### Layout (Mobile 375px)

```
┌──────────────────────────┐
│ ← Settings    [+ Thêm]  │
│ 🤖 Nguồn tri thức       │
├──────────────────────────┤
│                           │
│ ┌──────────────────────┐ │
│ │ 📄 FAQ Cầu lông     │ │
│ │ Text · 12 đoạn · v3 │ │
│ │ ✅ Active            │ │
│ └──────────────────────┘ │
│ ┌──────────────────────┐ │
│ │ 📁 Nội quy CLB      │ │
│ │ PDF · 8 đoạn · v1   │ │
│ │ ✅ Active            │ │
│ └──────────────────────┘ │
│ ┌──────────────────────┐ │
│ │ 📊 Bảng giá 2026    │ │
│ │ CSV · 5 đoạn · v2   │ │
│ │ ⚠️ Cách ly          │ │
│ │ [Re-ingest]          │ │
│ └──────────────────────┘ │
│                           │
└──────────────────────────┘
```

#### States

- **Loading:** Skeleton table: header row + 3 source row skeletons (each = icon + 2 text lines + status chip placeholder)
- **Ready:** Source table with status chips (✅ Active | ⏳ Đang xử lý | ⚠️ Cách ly | 📦 Đã lưu trữ | ❌ Lỗi) + row actions (re-ingest, archive)
- **Empty:** Illustration 📚 + `t("Chưa có tài liệu nào", "No documents yet")` + `t("Thêm FAQ hoặc upload file để trợ lý có thể trả lời", "Add FAQ or upload files so the assistant can answer questions")` + CTA [+ Thêm nguồn]
- **Error:** Error banner + retry: `t("Không tải được danh sách nguồn. Thử lại.", "Couldn't load sources. Try again.")`

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 403 | `CAPABILITY_DENIED` | Redirect — host-only surface | `t("Bạn cần quyền admin để quản lý trợ lý", "Admin access required to manage assistant")` |
| 403 | `ENTITLEMENT_MISSING` | Banner: cần nâng gói Host Pro | `t("Tính năng trợ lý AI cần gói Host Pro", "AI Assistant requires Host Pro plan")` |
| — | *(unknown / timeout)* | **Fail closed** — error + retry | `t("Không tải được danh sách nguồn. Thử lại.", "Couldn't load sources. Try again.")` |

#### Responsive

| Breakpoint | KB Manager |
|---|---|
| 1440px | Sidebar 240px + table view: columns Tên/Loại/Đoạn/Gen/Trạng thái/Actions |
| 768px | Sidebar hidden; table responsive — hide Gen column |
| 375px | Card list layout (stacked cards); each card = source info + status chip |

---

### Upload / Add Source — modal or page

#### Layout (Desktop 1440px)

```
┌──────────────────────────────────────────────────────┐
│ ← KB Manager          📄 Thêm nguồn tri thức        │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Loại nguồn     [Text/FAQ ▼]                         │
│                                                      │
│  ─── Text ───                                        │
│  Tên nguồn *    [                              ]     │
│  Nội dung *     [                              ]     │
│                 [                              ]     │
│                                                      │
│  ─── HOẶC Upload file ───                            │
│  ┌──────────────────────────────────────────────┐   │
│  │  📎 Kéo thả file hoặc chọn file              │   │
│  │  Hỗ trợ: PDF, TXT, DOCX, MD (≤5MB)          │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│       [════ Nạp & Index ════]                        │
│                                                      │
└──────────────────────────────────────────────────────┘
```

#### States

- **Loading:** N/A (form)
- **Ready:** Form with type selector + text input or file dropzone
- **Submitting:** Button disabled + spinner + progress: "Đang xử lý tài liệu..."
- **Success:** Toast ✅ + `t("Đã index %d đoạn", "Indexed %d chunks")` → redirect KB Manager
- **Error (DLP):** Banner ⚠️ + `t("Nội dung nhạy cảm — đã cách ly. Hãy kiểm tra và loại bỏ thông tin nhạy cảm rồi thử lại.", "Sensitive content detected — quarantined. Please remove sensitive information and try again.")`
- **Error (file):** Inline error: `t("Không đọc được file. Kiểm tra định dạng.", "Couldn't read file. Check the format.")`

---

### Config & Tone — `/clubs/:tenantId/settings/assistant`

#### Layout (Mobile 375px)

```
┌──────────────────────────┐
│ ← Trợ lý CLB  ⚙️ Cấu hình│
├──────────────────────────┤
│                           │
│ Tên trợ lý               │
│ [Trợ lý CLB Rồng Xanh  ]│
│                           │
│ Giọng điệu               │
│ [Thân thiện ▼]           │
│ Chuyên nghiệp | Thân     │
│ thiện | Vui vẻ            │
│                           │
│ Ngưỡng tương tự          │
│ [0.7] ◼◼◼◼◼◻◻◻          │
│                           │
│ Giới hạn/tháng           │
│ [500] câu hỏi            │
│                           │
│ Bật trợ lý  [●○] ON     │
│                           │
│ ─── Preview ───           │
│ "Xin chào! Mình là trợ   │
│ lý CLB Rồng Xanh 👋"     │
│                           │
│ [═══ Lưu cấu hình ═══]  │
│                           │
└──────────────────────────┘
```

#### States

- **Loading:** Skeleton form fields (6 fields)
- **Ready:** Form pre-filled with current config + live preview
- **Empty:** N/A — config always has defaults
- **Error:** Inline error per field + toast: `t("Không lưu được cấu hình. Thử lại.", "Couldn't save config. Try again.")`

---

### Ask Panel — Pha A (side panel / FAB)

#### Layout (Mobile 375px)

```
┌──────────────────────────┐
│ 🤖 Trợ lý CLB    [✕]    │
├──────────────────────────┤
│                           │
│ Bạn: "Giá cầu lông?"    │
│                           │
│ 🤖: "Giá buổi cầu lông  │
│ là 120,000₫/người.       │
│ Buổi tối T3/T5:          │
│ 150,000₫."               │
│                           │
│ 📎 Nguồn: FAQ Cầu lông  │
│ (đoạn 3)                 │
│                           │
│ ─── Bạn hài lòng? ───   │
│ [👍]  [👎]               │
│                           │
├──────────────────────────┤
│ [Hỏi trợ lý...     ] [→]│
└──────────────────────────┘
```

#### States

- **Loading:** Typing indicator (3 dots pulsing) + `t("Đang tìm...", "Searching...")`
- **Ready:** Answer bubble + source citation card + feedback buttons
- **Empty (KB rỗng):** Illustration 📚 + `t("CLB chưa cấu hình tri thức. Liên hệ host để biết thêm.", "The club hasn't set up knowledge yet. Contact the host for more info.")`
- **No-answer:** Bot bubble: `t("Mình chưa có thông tin này. Hãy hỏi host nhé!", "I don't have that information. Please ask the host!")`
- **Error:** Retry inline: `t("Lỗi khi tìm câu trả lời. Thử lại.", "Error finding an answer. Try again.")`

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 403 | `NOT_A_MEMBER` | Panel disabled | `t("Chỉ thành viên CLB mới hỏi được trợ lý", "Only club members can ask the assistant")` |
| 429 | `RATE_LIMITED` | Cooldown message | `t("Bạn hỏi quá nhanh — thử lại sau", "Too many questions — try again shortly")` |
| 429 | `CAP_REACHED` | Cap banner | `t("CLB đã hết lượt hỏi tháng này", "This club has reached its monthly question limit")` |
| — | *(unknown / timeout)* | **Fail closed** — retry | `t("Lỗi khi tìm câu trả lời. Thử lại.", "Error finding an answer. Try again.")` |

---

### Analytics — `/clubs/:tenantId/settings/assistant/analytics`

#### Layout (Mobile 375px)

```
┌──────────────────────────┐
│ ← Trợ lý CLB  📊 Phân tích│
├──────────────────────────┤
│                           │
│ ─── Tháng 08/2026 ───    │
│ Câu hỏi: 142 / 500      │
│ ████████░░ 28%           │
│ Không trả lời: 8%        │
│                           │
│ ─── Top chưa trả lời ── │
│ 1. "Sân ở đâu?" (12 lần)│
│ 2. "Dạy kèm?" (5 lần)   │
│ 3. "Giờ mở cửa?" (3 lần)│
│                           │
│ → Thêm vào KB để cải     │
│   thiện                   │
│                           │
└──────────────────────────┘
```

#### States

- **Loading:** Skeleton: 2 stat card skeletons + 3 list item skeletons
- **Ready:** Usage stats (progress bar + %) + top unanswered list with CTA
- **Empty:** `t("Chưa có lượt hỏi nào", "No questions yet")` + `t("Thống kê sẽ hiện khi thành viên bắt đầu hỏi trợ lý", "Stats will appear when members start asking the assistant")`
- **Error:** Error banner + retry

---

## 4. Components Used

| Component | States | Mô tả |
|---|---|---|
| `KBSourceRow` | default, hover, processing (spinner), quarantined (⚠️ bg) | Row trong source table |
| `StatusChip` | ✅ Active, ⏳ Đang xử lý, ⚠️ Cách ly, 📦 Đã lưu trữ, ❌ Lỗi | Status indicator chip |
| `UploadDropzone` | idle, drag-over (highlight border), uploading (progress), error (red border) | Drag & drop file upload area |
| `ToneSelector` | 3 options: Chuyên nghiệp, Thân thiện, Vui vẻ | Radio group with preview |
| `SimilaritySlider` | range 0.5–0.9; value label | Threshold slider |
| `AskPanel` | closed (FAB), open (side panel), loading (typing indicator) | Pha A Q&A interface |
| `BotBubble` | answer + citation, no-answer, error | Bot response message |
| `CitationCard` | source name + chunk reference | Source attribution |
| `FeedbackButtons` | idle (👍👎), selected (fill), submitted (checkmark) | Feedback toggle |
| `UsageProgressBar` | normal (blue), warning (orange >80%), critical (red >95%) | Monthly cap progress |
| `UnansweredList` | list items with count badges | Top unanswered questions |

---

## 5. Edge Cases (UX)

| # | Case | Hiển thị |
|---|---|---|
| 1 | KB rỗng — member hỏi | "CLB chưa cấu hình tri thức" — không gọi LLM |
| 2 | File upload > 5MB | Inline error: `t("File quá lớn (tối đa 5MB)", "File too large (max 5MB)")` |
| 3 | DLP detect sensitive content | Source → ⚠️ Cách ly + toast host: "Nội dung nhạy cảm — đã cách ly" |
| 4 | Vượt cap câu hỏi/tháng | Banner: "Đã hết lượt hỏi tháng này" + CTA "Nâng gói" |
| 5 | LLM provider timeout | Retry loading → after 2nd fail: "Trợ lý tạm không khả dụng. Thử lại sau." |
| 6 | Câu trả lời dưới ngưỡng similarity | "Mình chưa có thông tin này" — lịch sự, không bịa |
| 7 | Member @mention trợ lý hỏi nợ | Chỉ KB guidance hoặc no-answer; không trả số tiền |
| 8 | Tên nguồn rất dài (>60 chars) | Truncate + tooltip trong table; full name trong detail |
| 9 | Re-ingest cùng file không đổi nội dung | Toast: "Nội dung không thay đổi" — không tạo revision mới |
| 10 | Offline khi hỏi trợ lý | Toast: "Cần kết nối để hỏi trợ lý" + input disabled |

---

## 6. Data hiển thị

| Field | Format | i18n `t(vi, en)` | Ghi chú |
|---|---|---|---|
| Source name | Text | `data — no copy` | Max 60 chars |
| Source type | Badge: Text/PDF/DOCX/MD/CSV/URL | `data — no copy` | Icon mapping |
| Chunk count | "N đoạn" | `t("%d đoạn", "%d chunks")` | |
| Generation | "vN" | `data — no copy` | |
| Status | Chip (5 variants) | `t("Active", "Active")` · `t("Đang xử lý", "Processing")` · `t("Cách ly", "Quarantined")` · `t("Đã lưu trữ", "Archived")` · `t("Lỗi", "Error")` | |
| Question count | "N / 500" | `t("%d / %d câu hỏi", "%d / %d questions")` | Progress bar |
| No-answer rate | "N%" | `data — no copy` | |
| Bot answer | Text (markdown-lite) | `server-localized` | Tone-aware |
| Citation | "Nguồn: {name} (đoạn N)" | `t("Nguồn: %s (đoạn %d)", "Source: %s (chunk %d)")` | |

> **i18n:** Mọi chuỗi user-facing qua `t(vi, en)`. Bot answer do server localize theo tone.

---

## 7. Responsive & Interaction Notes

- **KB table:** Desktop = table view; Mobile = card list. Sort by status (processing first) then name
- **Upload dropzone:** Drag & drop on desktop; file picker only on mobile. Progress bar during upload
- **Ask Panel:** Desktop = side panel 400px slide-in from right; Mobile = bottom sheet (swipe down to close)
- **Typing indicator:** 3 dots with staggered bounce animation (each dot 200ms offset)
- **Citation card:** Tap → expand source context (2-3 surrounding chunks). Collapse on second tap
- **Feedback:** Tap 👍 or 👎 → subtle fill animation + toast "Cảm ơn phản hồi!"
- **Analytics progress bar:** Animated count-up on mount. Color transitions: blue (<80%) → orange (80-95%) → red (>95%)
- **Dark mode:** Panel bg `var(--bg-card)`, bot bubble `var(--bg-surface)`, user bubble `var(--primary-muted)`, status chips use semantic tokens
- **Touch targets:** ≥ 44×44px
- **FAB button:** Bottom-right, 56px circle, `var(--primary)` bg, 🤖 icon white. Scale-in on mount

---

_FE Design Spec v0.1 · 2026-08-10 · Source: feature_club_assistant.md v0.19_
_Changelog v0.1: Initial — 5 screens (KB Manager, Upload, Config, Ask Panel, Analytics), 7 sections, 10 edge cases, ASCII wireframes Desktop + Mobile._
