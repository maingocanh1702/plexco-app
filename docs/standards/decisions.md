# Decision Log (ADR-lite) — Plexco

> Nguồn sự thật duy nhất cho các quyết định thiết kế/kỹ thuật. Gom từ `product/BRD.md §16 (Open Decisions)` và `product/TDD.md §11 (Open Questions)`.
> Khi chốt một quyết định ở đây, cập nhật trạng thái và xoá khỏi "Open" ở BRD/TDD (giữ một nguồn).

## Quy ước

- **Trạng thái:** ✅ Chốt · 🟡 Đề xuất (chờ xác nhận) · ⬜ Mở (chờ chọn) · 🔗 Phụ thuộc ngoài
- **ID:** `DD-NN`. DD-01..DD-10 kế thừa OD-1..OD-10 (BRD). DD-11+ là quyết định chỉ có trong TDD.
- Mỗi mục: Bối cảnh → Quyết định → Lý do → Hệ quả.

## Bảng tổng hợp

| ID | Quyết định | Trạng thái | Phase | Nguồn |
|---|---|---|---|---|
| DD-01 | SĐT verified (share-contact) là khoá merge chính | ✅ Chốt | P3.5 | BRD OD-1 · TDD Q6 |
| DD-02 | `pay_code` lưu trần trong DB, hiển thị có prefix CLB | 🟡 Đề xuất | P3 | BRD OD-2 · TDD Q3 |
| DD-03 | Pricing/tier subscription host (4 tier theo kênh) | 🔄 Thay bằng DD-29 | P5 | BRD OD-3 · TDD Q4 |
| DD-04 | Hosting PostgreSQL — HA+PITR+Singapore chốt; Neon vs Supabase còn lại | 🟡 Đề xuất | P0 | BRD OD-4 · TDD Q2 · `deployment-infra.md §2` |
| DD-05 | Join cross-club: open vs approval | 🟡 Đề xuất | P4.3 | BRD OD-5 · TDD Q8 |
| DD-06 | Độ chi tiết vị trí public: area vs venue | 🟡 Đề xuất | P4.3 | BRD OD-6 · TDD Q9 |
| DD-07 | Web realtime: SSE + fan-out qua `LISTEN/NOTIFY` | ✅ Chốt | P4 | BRD OD-7 · TDD Q7 · `deployment-infra.md §2` |
| DD-08 | Danh sách môn khởi điểm + taxonomy trình độ | ⬜ Mở | P0 | BRD OD-8 |
| DD-09 | Messenger vào lộ trình lúc nào | ✅ Chốt | P4.8 | BRD OD-9 |
| DD-10 | Web stack — cùng container (không Vercel) chốt; Express SSR vs Next standalone còn lại | 🟡 Đề xuất | P4 | BRD OD-10 · TDD Q1 · `deployment-infra.md §2` |
| DD-11 | Zalo Premium + add-on managed (owner >3 CLB) | 🔗 Phụ thuộc ngoài | P4.7 | TDD Q5 |
| DD-12 | Public read model: bảng projection vs materialized view | 🟡 Đề xuất | P4.3 | TDD Q10 |
| DD-13 | Mở rộng web-auth provider (Google / email-password) ngoài TG Login | 🟡 Đề xuất | P4+ | session 2026-07-02 · `feature_web_auth_onboarding.md` · `00-start-here/identity-model.md §7` |
| DD-14 | Zalo Login (Social API) có bị chặn bởi cửa đăng ký OA không | ⬜ Mở | P4+ | cần xác minh Zalo |
| DD-15 | Zalo Bot `from.id` có ổn định xuyên nhiều bot khác nhau không | ⬜ Mở | P4+ | cần xác minh Zalo |
| DD-16 | Feature Club AI Assistant + Knowledge Base (RAG per-CLB) | ✅ Chốt | P7 (post-MVP) | `proposals/club-ai-bot-knowledge-base.md` |
| DD-17 | Vector store = pgvector tenant-private (không vector DB ngoài giai đoạn đầu) | ✅ Chốt | P7 | proposal §7.1 |
| DD-18 | Provider embedding/LLM cho trợ lý + review privacy/ToS/khu vực dữ liệu | ⬜ Mở (chặn GO-LIVE, không chặn build) | P7 | proposal §7.2 |
| DD-19 | Trợ lý CHỈ trong app Plexco (không TG/Zalo/Messenger); pha A ask-panel, pha B native chat | ✅ Chốt | P7 | proposal §8 |
| DD-20 | Trợ lý là config tenant, KHÔNG phải Person/ChannelIdentity mới | ✅ Chốt | P7 | proposal §3.1 · §P6 |
| DD-21 | Grounding chỉ KB, không nối ledger/PII vào LLM (bảo mật) | ✅ Chốt | P7 | proposal §6.2 · HR2 |
| DD-22 | Entitlement/định giá trợ lý (add-on gói) | ✅ Chốt (gộp Host Pro — DD-29) | P5/P7 | DD-29 |
| DD-23 | Hybrid retrieval (BM25 + semantic + RRF), Postgres-native | ✅ Chốt | P7 | proposal §5.2 · §12 |
| DD-24 | Primitive `pending_interaction` (multi-step, idempotent, bounded, cancelable) cho lệnh tiền/host | ✅ Chốt | P3/P4 | `proposals/bots-weekly-review-2026-07-05.md` O2 |
| DD-25 | Preview + two-phase confirm cho **human-initiated** money mutation (không áp automated reconcile) | ✅ Chốt | P3 | bots-weekly-review M1 · BL-PAY |
| DD-26 | Confirm-before-persist + cross-channel parity cho identity **money-adjacent** (delta, không thêm model "buddy") | ✅ Chốt | P3.5 | bots-weekly-review I1 · `feature_identity.md` |
| DD-27 | Channel-aware authz & command-surface | ✅ Chốt | P4.5+ | bots-weekly-review P1 · `feature_tenant_routing_authz` |
| DD-28 | Tool live-context (đọc dữ liệu vận hành non-PII) **tách khỏi** KB-RAG (DD-21) | ✅ Chốt | P7 | bots-weekly-review A3 |
| DD-29 | **Phase-1 pricing pivot**: free web + 3 bot; 1 gói trả phí **Host Pro 250k/tháng** (thay 4-tier theo kênh) | ✅ Chốt | P5 | owner 2026-07-05 · thay DD-03 |
| DD-30 | Provider onboarding: **APIpay enterprise auto-provision per-host** (tiền vẫn về TK host — giữ money-custody) | ✅ Chốt | P3/P4 | owner 2026-07-05 · `feature_connector_onboarding` |
| DD-31 | Auth security invariant + test matrix (auth-onboarding v3): 8 bất biến SI-1..SI-8 + 4 gap (login-state CSRF, tenant-filter policy, KMS/secret wiring, keyed web-auth hash) — founder-decisions resolved (OQ-1/2/3), impl + spec-pin open tới v3 merge | 🟡 Đề xuất | P4 | session 2026-07-06 · `auth-onboarding-v2` round-01..09 · plan `proposals/auth-security-design-pass-plan-2026-07-06.md` · `BE/auth-security-invariant-table.md` |
| DD-32 | Phễu channel-first (proposal, **mặc định phễu MỀM**): link Plexco↔FB/Zalo → book slot trong Messenger/Zalo (lớp nhẹ, hook), hành động sâu/analytics → lên app. Giữ guest-join (CCJ-UC-1, ID-UC-2); phụ thuộc DD-33 (FB Login) + DD-14 (Zalo Login) | 🟡 Đề xuất | P4.3/P4.7 + Messenger P4.8 | session 2026-07-06 · `feature_channel_booking_funnel.md` |
| DD-33 | Facebook Login / Messenger account-link như web-auth provider (`account_identities.platform='facebook'`) — đường tạo linked-state FB cho DD-32; DD-13 KHÔNG bao Facebook | ⬜ Mở | P4+ | session 2026-07-06 · `00-start-here/identity-model.md §7` · `feature_web_auth_onboarding.md` |
| DD-34 | Plexco Global KB plane (global read-only, non-PII) + union retrieval KB-club ∪ KB-Plexco — trợ lý trả lời cả về nền tảng | 🟡 Đề xuất | P7 | session 2026-07-06 · `proposals/plexco-global-kb-and-kb-autosync.md` |
| DD-35 | Auto-derive KB-club từ dữ liệu canonical (projector, field-whitelist mô tả, tách DD-28 live-context) | 🟡 Đề xuất | P7 | session 2026-07-06 · proposal §4 |
| DD-36 | Freshness: scheduled re-crawl URL + re-ingest KB-Plexco, change-detect `content_hash` | 🟡 Đề xuất | P7 | session 2026-07-06 · proposal §5 |

---

## DD-01 — SĐT verified là khoá merge chính · ✅ Chốt

- **Bối cảnh:** Một người thật xuất hiện ở nhiều kênh (Telegram/Zalo/web); cần tránh gán nhầm tiền/merge sai (AUDIT C1/C2/C4/C5).
- **Quyết định:** Dùng số điện thoại đã verified qua share-contact làm khoá định danh chính để merge `Person`.
- **Lý do:** SĐT verified là tín hiệu định danh mạnh nhất, người dùng kiểm soát được; giảm rủi ro merge nhầm so với tên/username.
- **Hệ quả:** Luồng claim/merge bắt buộc bước verify SĐT; kênh không cấp SĐT verified chỉ link mềm cho tới khi verify.

## DD-02 — `pay_code` lưu trần, hiển thị có prefix · 🟡 Đề xuất

- **Bối cảnh:** Mã đối soát chuyển khoản cần dễ đọc cho player nhưng phải match bền ở backend.
- **Quyết định:** Lưu code **trần** trong DB; **hiển thị** kèm prefix CLB (vd `BMC-xxxx`).
- **Lý do:** Match đối soát ổn định không phụ thuộc cách hiển thị; prefix chỉ là lớp trình bày giúp người dùng nhận diện CLB.
- **Hệ quả:** Parser webhook strip prefix trước khi match; cần test edge case người dùng gõ kèm/không kèm prefix.
- **Còn lại:** Chốt cuối format prefix.

## DD-03 — Pricing/tier subscription host (4 tier theo kênh) · 🔄 Thay bằng DD-29

> **2026-07-05:** Bị thay bởi **DD-29** (Phase-1 pricing pivot: free web + 3 bot, 1 gói Host Pro 250k). Nội dung dưới giữ làm **lịch sử** — KHÔNG dùng làm pricing hiện hành.

- **Bối cảnh:** Cần pricing rõ cho host subscription theo giá trị kênh sử dụng.
- **Quyết định:** 4 tier theo tháng/CLB:
  - `free_web` — **0đ**: Web app.
  - `telegram` — **79.000đ**: Web app + bot Telegram.
  - `plus_channel` — **159.000đ**: Web app + bot Telegram + **1 kênh chọn thêm**: Zalo hoặc Messenger.
  - `all_channels` — **199.000đ**: Web app + bot Telegram + bot Zalo + bot Messenger.
- **Lý do:** Giữ cửa vào miễn phí cho web app, monetization tăng theo số kênh chat mà host cần vận hành.
- **Hệ quả:** Billing phải version plan/tier; entitlement channel gate theo plan. Messenger vẫn theo P4.8/post-MVP, quyền Messenger chỉ unlock khi kênh GA.
- **Còn lại:** Chốt lifecycle timing riêng (trial/past_due/suspended ~ 14/7 ngày — TDD Q4) và chính sách cancellation/refund/credit.

## DD-04 — Hosting PostgreSQL · 🟡 Đề xuất (đã thu hẹp)

- **Bối cảnh:** Cần chọn nhà cung cấp Postgres managed.
- **Đã chốt:** Managed Postgres **HA + PITR**, **region Singapore (ap-southeast-1)**. Railway PG chỉ dùng dev/staging (PITR/HA yếu cho hệ tiền).
- **Còn lại:** **Neon** (branching hợp CI migration gate; nhưng scale-to-zero xung đột pg-boss → phải tắt autosuspend) vs **Supabase** (RLS-native, Supavisor pooler sẵn).
- **Tiêu chí:** Hỗ trợ RLS, pooler, branching/backup, chi phí, độ trễ region.
- **Hệ quả:** RPO/RTO chốt sau khi chọn provider; bắt buộc restore drill định kỳ. Quyết định sớm (P0); không đổi domain model.
- **Chi tiết:** `deployment-infra.md §2 (DD-04)`.

## DD-05 — Join cross-club: open vs approval · 🟡 Đề xuất

- **Bối cảnh:** Player join kèo từ marketplace xuyên CLB.
- **Quyết định (đề xuất):** Cấu hình **per-kèo**, mặc định **open**, host có thể bật **approval**.
- **Lý do:** Cân bằng tốc độ lấp slot (open) và quyền kiểm soát của host.
- **Hệ quả:** Thêm field cấu hình ở session; state machine join có nhánh chờ duyệt.

## DD-06 — Độ chi tiết vị trí public · 🟡 Đề xuất

- **Bối cảnh:** Lộ địa điểm chính xác ra public gây rủi ro riêng tư/spam.
- **Quyết định (đề xuất):** Public chỉ hiện **khu vực/quận**; lộ **venue chính xác** sau khi join/được duyệt.
- **Lý do:** Bảo vệ host/venue, vẫn đủ thông tin để player quyết định join.
- **Hệ quả:** Public projection whitelist field theo trạng thái join.

## DD-07 — Web realtime · ✅ Chốt

- **Bối cảnh:** Web cần cập nhật slot/đối soát theo thời gian thực.
- **Quyết định:** **SSE**, fan-out qua Postgres **`LISTEN/NOTIFY`** (không Redis/broker). Worker `NOTIFY` sau projector; mỗi `web` replica `LISTEN`.
- **Lý do:** Nhu cầu chủ yếu một chiều server→client; SSE đơn giản hơn WebSocket, tốt hơn polling về độ trễ/chi phí.
- **Hệ quả:**
  - Listener SSE cần **session/direct connection riêng** (`DATABASE_URL_LISTEN`) vì txn-mode pooler không hỗ trợ `LISTEN`.
  - Post-write read của user đã auth nên đọc **primary** (read-your-writes) để tránh lệch với event — xem `deployment-infra.md §5.2`.
  - Cần endpoint stream + reconnect; size memory theo số connection; tier thấp fallback polling.
- **Chi tiết:** `deployment-infra.md §2 (DD-07)`.

## DD-08 — Môn khởi điểm + taxonomy trình độ · ⬜ Mở

- **Bối cảnh:** `Sport` là chiều dữ liệu của kèo; cần chốt danh sách môn ban đầu và thang trình độ.
- **Gợi ý:** Cầu lông, pickleball, … + taxonomy trình độ chuẩn hoá.
- **Hệ quả:** Ảnh hưởng schema/seed sớm (P0) và filter discovery.

## DD-09 — Messenger vào lộ trình · ✅ Chốt

- **Quyết định:** Messenger là **post-MVP, phase P4.8**.
- **Lý do:** Ưu tiên Telegram/Zalo/web cho MVP; Messenger thêm sau khi canonical store + sync ổn định.
- **Hệ quả:** Thiết kế giữ surface-agnostic; chi tiết ở `channels/messenger/messenger-channel-design.md`.

## DD-10 — Web stack · 🟡 Đề xuất (đã thu hẹp)

- **Bối cảnh:** Chọn framework cho web app.
- **Đã chốt:** Web chạy **trong cùng container/monolith**, **không** tách lên Vercel (giữ SSE long-lived + webhook durable + pg-boss sống được; giảm đầu mối vận hành).
- **Còn lại:** **Express SSR** vs **Next.js standalone/custom-server**.
- **Lý do:** Contract API/DTO không đổi dù chọn stack nào → có thể chốt muộn (P4).
- **Hệ quả:** Chỉ ảnh hưởng tầng channel adapter web.
- **Chi tiết:** `deployment-infra.md §2 (DD-10)`.

## DD-11 — Zalo Premium + add-on managed · 🔗 Phụ thuộc ngoài

- **Bối cảnh:** Khi owner quản >3 CLB/tài khoản có thể chạm giới hạn Zalo OA.
- **Trạng thái:** Cần xác nhận với Zalo về Premium/giới hạn + mô hình add-on managed.
- **Hệ quả:** Ảnh hưởng pricing host nhiều CLB (P4.7); chặn bởi câu trả lời từ Zalo.

## DD-12 — Public read model · 🟡 Đề xuất

- **Bối cảnh:** Marketplace cần đọc public nhanh, không lộ tiền/PII.
- **Quyết định (đề xuất):** Bảng `public_sessions` cập nhật qua **projector** (thay vì materialized view).
- **Lý do:** Kiểm soát field whitelist & thời điểm cập nhật rõ ràng; tách read model khỏi canonical.
- **Hệ quả:**
  - Sync engine có projector ghi `public_sessions`; cần đảm bảo nhất quán cuối.
  - **Bảo mật:** role `readonly` (process `discovery`) **chỉ `GRANT SELECT` trên `public_sessions`/public view, zero grant bảng canonical tiền/PII** → cô lập cross-tenant ở **tầng quyền**, không phụ thuộc RLS. Xem `deployment-infra.md §4/§6`.

## DD-13 — Mở rộng web-auth provider (Google / email-password) · 🟡 Đề xuất

- **Bối cảnh:** Direction web-auth hiện tại (P4) là **TG Login + web fallback** (`feature_web_auth_onboarding.md`). Buổi strategy 2026-07-02 nêu nhu cầu acquisition: Zalo/FB login và FB Business Verification đang pending, nên cần một login "bật ngay được" cho web/app (Google, hoặc email-password self-register) để không kẹt go-to-market khi đấu với Reclub.
- **Đề xuất (chưa chốt):** Cho phép thêm provider `google` (và/hoặc `email`) vào lớp web-auth.
- **Ràng buộc thiết kế (nếu chốt):**
  - Thêm provider = thêm giá trị `account_identities.platform` + adapter OAuth; nếu có password thì bảng credential riêng qua migration mới (P12 expand→contract). **KHÔNG** tạo root table `users` — `persons` vẫn là anchor (§P6).
  - Google/email **không cấp SĐT** → phone vẫn chỉ là merge signal (DD-01), gắn Person qua verified signal/link-code, không gắn bằng tên.
  - Chốt quan hệ với TG Login: superset hay song song; tác động lên claim/merge (verified email là auto-merge signal "khi email verification triển khai" — `feature_identity.md`).
- **Hệ quả:** Nếu chốt, cập nhật `feature_web_auth_onboarding(.md/_tech)` (WAO-UC-1, Auth Adapter) và giữ `00-start-here/identity-model.md §7` đồng bộ. Không sửa spec đã Reviewed cho tới khi DD này ✅.

## DD-14 — Zalo Login (Social API) có bị chặn bởi cửa đăng ký OA không · ⬜ Mở

- **Bối cảnh:** Zalo có nhiều bề mặt tách biệt (Bot Open API, Mini App, OA OpenAPI, Social/Login). Chiến lược auto-match "Zalo login ↔ Zalo bot" (giảm friction, thay cho SĐT) phụ thuộc việc bật được Zalo Login.
- **Cần xác minh:** Zalo Login yêu cầu đăng ký app trên developers.zalo.me — có buộc phải có OA verified không (thứ đang pending), hay độc lập.
- **Hệ quả:** Nếu độc lập → có thể bật Zalo Login trước OA, dùng làm cầu nối auto-match. Ảnh hưởng **DD-32 / provider-link path** (KHÔNG phải DD-13 — đã fence Google/email) và thiết kế link (`00-start-here/identity-model.md §5 link-code contract · §7 provider/channel phase matrix`).

## DD-15 — Zalo Bot `from.id` có ổn định xuyên nhiều bot khác nhau không · ⬜ Mở

- **Bối cảnh:** Plexco đa-bot (mỗi host/CLB một bot). Cùng một người ở hai bot khác nhau: `from.id` là id toàn cục theo user Zalo, hay scoped-per-bot? (Messenger PSID đã xác nhận page-scoped.)
- **Cần xác minh:** với Zalo Bot Platform.
- **Hệ quả:** Nếu ổn định xuyên bot → giảm số lần link cần thiết. Nếu scoped-per-bot → mỗi CLB link một lần. **Không chặn** vì link-code (`link_codes`) đã bao ca xấu nhất; chỉ ảnh hưởng mức độ auto-match (`00-start-here/identity-model.md §3`).

---

## DD-16 — Feature Club AI Assistant + Knowledge Base (RAG per-CLB) · ✅ Chốt

- **Bối cảnh:** Yêu cầu mới: mỗi CLB tạo "bot tư vấn" riêng, nạp KB từ FAQ + docs nội bộ, ai tag bot thì bot tự trả lời theo KB (giống chatbot tư vấn). Plexco hiện KHÔNG có KB/vector/chat in-app; "bot" trong repo = channel adapter, không phải trợ lý AI.
- **Quyết định:** Thêm **track feature mới, post-MVP**: trợ lý AI per-tenant + knowledge base + answer-engine RAG, **tái dùng** identity/tenantRepo-RLS/sync-engine/channel-adapter/billing thay vì dựng song song. Bảng mới (`bot_configs`, `kb_sources`, `kb_documents`, `kb_chunks`, `bot_queries`, `chat_*`) đều **tenant-private, RLS fail-closed**.
- **Lý do:** Giá trị cho host (giảm hỏi lặp trong nhóm); không đụng đường tiền MVP; nằm gọn trong kiến trúc canonical-store + surface-agnostic có sẵn.
- **Hệ quả:** **Chỉ trong app Plexco** (không TG/Zalo/Messenger). Phụ thuộc sync engine + web/app surface (P4), identity (P3.5), billing (P5). Chi tiết + schema sketch + test bất biến ở `proposals/club-ai-bot-knowledge-base.md`. Khi ✅ → promote thành `feature_club_assistant(.md/_tech)` + migration mới + cập nhật `0009` RLS list. **Không** sửa spec Reviewed tới khi DD này ✅.

## DD-17 — Vector store = pgvector tenant-private · ✅ Chốt

- **Bối cảnh:** KB cần lưu embedding để retrieve. Lựa chọn: pgvector trong Postgres hiện có vs vector DB ngoài (Qdrant/Pinecone/Weaviate).
- **Quyết định:** Dùng **pgvector** trong Postgres tenant-private, đặt dưới **RLS** như mọi bảng tenant khác.
- **Lý do:** Tái dùng luôn ranh giới cô lập RLS (INV-1) — không phải bảo mật hệ thống thứ 2; 1 DB/1 backup/PITR (hợp modular monolith, P14); KB mỗi CLB nhỏ nên ANN trên tập đã filter theo tenant rất nhẹ.
- **Hệ quả:** Bật extension `vector` (review riêng ở migration roles/extensions); cân nhắc tương tác ANN index (HNSW/IVFFlat) với RLS filter — cần benchmark recall khi filter chặt. Chuyển vector DB ngoài chỉ khi đo lường thực sự cần (P14 partition-when-measured).

## DD-18 — Provider embedding/LLM + privacy/ToS · ⬜ Mở

- **Bối cảnh:** Cần chọn provider embedding + generation. Câu trả lời phụ thuộc chất lượng tiếng Việt, chi phí/câu, độ trễ, và **quyền riêng tư** (gửi doc nội bộ CLB tới LLM bên thứ 3 = xử lý dữ liệu tenant).
- **Cần chốt:** Provider cụ thể (API hosted cho tốc độ MVP vs đường self-host cho privacy) + review ToS/DPA/khu vực dữ liệu, và công bố ở Privacy/ToS (đưa vào P6 Harden).
- **Ràng buộc thiết kế:** Đặt sau interface `EmbeddingProvider`/`ChatProvider` trong `packages/core` (adapter mỏng, swappable, không khoá vendor). `embedding` dim theo model; đổi model ⇒ reindex P12.
- **Hệ quả:** Chưa chốt được thì Phase A vẫn thiết kế được (interface cố định); chỉ chặn go-live tính năng cho tới khi có provider + duyệt pháp lý.

## DD-19 — Trợ lý CHỈ trong app Plexco; pha A ask-panel, pha B native chat · ✅ Chốt

- **Bối cảnh:** Làm rõ scope (05/07): trợ lý **chỉ** hoạt động **bên trong app Plexco**, **KHÔNG** trả lời ở Telegram/Zalo/Messenger. "Giống Telegram" chỉ là mô tả trải nghiệm kênh chat in-app.
- **Quyết định:** Hai surface đều in-app: **pha A** = panel "Hỏi trợ lý" (Q&A trực tiếp, slice nhỏ nhất) trước; **pha B** = kênh chat in-app native (`chat_channels/messages/members` + SSE + bot-participant, trả lời khi @mention) sau.
- **Lý do:** Bỏ answer-in-external-channel → giảm phụ thuộc (không cần channel adapter TG/Zalo cho trợ lý) và tránh rủi ro lộ câu trả lời ra nhóm ngoài. Pha A chứng minh giá trị nhanh; pha B nặng (hệ nhắn tin mới).
- **Hệ quả:** `bot_queries.surface ∈ {native_chat, ask_panel}` (bỏ telegram/zalo/messenger). Không phụ thuộc P2/P4.5–4.7 adapter. Roadmap tách 2 mốc trong app.

## DD-20 — Trợ lý là config tenant, không phải Person/ChannelIdentity · ✅ Chốt

- **Bối cảnh:** "Bot" cần một danh tính để "nói". Cám dỗ: tạo Person/ChannelIdentity cho bot ⇒ nguy cơ bảng song song, phá §P6 (Person là anchor người thật).
- **Quyết định:** Trợ lý = **cấu hình cấp tenant** (`bot_configs`), không tạo Person/ChannelIdentity mới. Khi phát ngôn: attribute `author_type='assistant'` trong kênh chat in-app + log ở `bot_queries`. Trợ lý chỉ phát ngôn trong app Plexco (không ra kênh ngoài).
- **Lý do:** Giữ §P6 sạch (identity chỉ cho người thật); tránh bảng identity song song; đơn giản hoá routing/authz.
- **Hệ quả:** `chat_messages.membership_id` NULL khi assistant/system (CHECK shape). Không cần đụng `persons`/`channel_identities`.

## DD-21 — Grounding chỉ KB, không nối ledger/PII vào LLM · ✅ Chốt

- **Bối cảnh:** RAG mà đọc được ledger/roster/SĐT ⇒ LLM có thể lộ nợ/PII của người khác qua câu trả lời trong nhóm (vi phạm HR2/INV-3).
- **Quyết định:** Trợ lý **chỉ** ground trên `kb_chunks` (FAQ/docs). **Không** đưa `charges`/`memberships`/`persons`/SĐT/secret vào context LLM.
- **Lý do:** Cắt tận gốc đường rò tiền/PII qua prompt; KB là dữ liệu công khai-nội-bộ do admin chủ động nạp.
- **Hệ quả:** Nếu sau này muốn "hỏi nợ của tôi" → làm **tool riêng có person-self authz** (chỉ trả nợ của chính người hỏi), tách khỏi RAG chung, là DD mới. Test bất biến: assert prompt context = chỉ kb_chunks tenant.

## DD-22 — Entitlement/định giá trợ lý (add-on) · ✅ Chốt (gộp Host Pro — DD-29)

- **Bối cảnh:** Trợ lý tốn chi phí LLM/embedding theo lượng dùng; cần gate theo gói.
- **Quyết định:** Dùng `plans.entitlements` (jsonb) sẵn có: thêm key `assistant` + `limits` (KB size, câu hỏi/tháng); cấu hình per-tenant ở `bot_configs.monthly_question_cap`. Định giá cụ thể (add-on hay bundle vào tier cao) chốt cùng review DD-03.
- **Lý do:** Không thêm bảng billing mới; kiểm soát chi phí biến đổi theo tenant.
- **Hệ quả:** Cần rate-limit + đếm dùng theo tenant; billing lifecycle (P5) tham chiếu entitlement này.

## DD-23 — Hybrid retrieval (BM25 + semantic + RRF), Postgres-native · ✅ Chốt

- **Bối cảnh:** Pipeline mẫu (ảnh tham khảo 05/07) dùng hybrid search: BM25 (keyword) + semantic (pgvector HNSW) trộn theo tỉ lệ ~70/30, merge + **RRF fusion** (mặc định ~0ms) hoặc **LLM rerank** (~300ms). Retrieve chỉ bằng vector đôi khi trượt câu hỏi nặng keyword (tên riêng, mã, thuật ngữ CLB).
- **Quyết định:** Trợ lý dùng **hybrid retrieval native Postgres**: cột `fts_vector tsvector GENERATED ALWAYS` + `websearch_to_tsquery` cho BM25, pgvector **HNSW** cho semantic; hợp nhất bằng **RRF** làm mặc định, **LLM rerank optional** khi cần precision. Kèm `embedding_cache(SHA256)` để khỏi embed lại text trùng; `summary`/`summary_embedding` (2-vector) là **optional** để tăng recall khái niệm.
- **Lý do:** Cả BM25 lẫn vector đều **trong Postgres** → không thêm hạ tầng (khớp DD-17); RRF rẻ và không cần LLM; rerank/summary bật khi đo lường thấy cần (P14). Hybrid tăng độ chính xác cho câu hỏi keyword-heavy.
- **Hệ quả:**
  - Schema `kb_chunks` thêm `fts_vector` (GENERATED), `summary`, `summary_embedding`; thêm bảng `embedding_cache`. Index: HNSW (embedding) + GIN (fts_vector).
  - Retrieve **tham số hoá theo tenant + dưới RLS** (khác pipeline mẫu vốn single-tenant, tool đặt tên cứng per-KB). Plexco dùng **1 tool tổng quát** `search_knowledge_base(tenant)`, không tạo tool-per-CLB.
  - `min_similarity` (mẫu ~0.3) là gate no-answer (DD-16/§6.2). Provider summary/rerank/embed vẫn để mở ở **DD-18**.

---

## DD-24 — Primitive `pending_interaction` cho lệnh tiền/host · ✅ Chốt

- **Bối cảnh:** Nhiều flow tiền/host cần nhiều bước ("đang chờ input tiếp theo"): refund STK, đổi STK nhận, capture bank info, confirm. 2 repo reference (`bestmintonclub-payment-check-bot` + `bestminton-club-chatbot`) đã hiện thực dạng `expectNextText` + chip-tap fail-closed + **bound re-arm** (chống loop) + **cancel signal** + **dedup in-flight** — nhưng **cross-process, trong group ngoài**. Plexco hiện **chưa có** khái niệm hội thoại nhiều bước trong docs.
- **Quyết định:** Thêm primitive **`pending_interaction` tenant-private** (hoặc mở rộng command bus): 1 slot chờ input gắn `(tenant, actor, flow, command_id)`, **idempotent theo `command_id`** (P8/INV-6), **có hạn re-arm + timeout sweep**, **cancelable**, **fail-closed** khi input/tap không khớp slot. Sống trong **canonical store**, hand-off **in-process** — **KHÔNG** bridge cross-process (HR3). Chủ sở hữu = **module tiền/host command**, **KHÔNG** phải trợ lý (DD-19/20).
- **Lý do:** Chuẩn hoá multi-step an toàn (idempotent, bounded, cancelable) thay vì mỗi flow tự chế; tránh loop/nuốt input; hợp HR3 khi in-process + outbox thay vì 2 process forward tin.
- **Hệ quả:** Khái niệm mới ở **tầng command** (không đụng core payment-logic thuần); cần timeout sweep (pg-boss); test: re-arm bounded, cancel, dedup in-flight, fail-closed tap sai. Là nền cho **DD-25**.

## DD-25 — Preview + two-phase confirm cho human-initiated money mutation · ✅ Chốt

- **Bối cảnh:** Contract tiền đã có durable webhook, safe-plan auto-match, manual allocation, reversal, cash provenance, STK pending 24h (`business-rules.md` BL-PAY-1..9). Nhưng thao tác **do người khởi tạo** làm **đổi đích tiền / mutate ledger** (refund tới STK, credit cashout, đổi STK nhận) cần chặn nhầm mạnh hơn. Bot đã hiện thực `/refundbank` two-phase confirm + single-slot capture.
- **Quyết định:** Mọi **human-initiated money-destination change hoặc ledger mutation** phải: **preview** (số tiền + đích) → **2-pha confirm** → capture **single-slot fail-closed** (dùng **DD-24**). **Automated provider ingest / worker settlement KHÔNG đòi confirm** — giữ **safe-plan + fail-closed** (BL-PAY-1/3).
- **Lý do:** Tách rõ 2 loại: **máy làm** (an toàn bằng safe-plan) vs **người làm đổi đích tiền** (cần xác nhận rõ). Tránh áp confirm nhầm cho ingest/settlement tự động.
- **Hệ quả:** Bổ sung **delta** cho BL-PAY/BL-NTF (không rewrite contract); gắn STK-change G1 (`proposals/single-club-bot-port-map.md §4`). Test: refund/credit/STK-change đòi 2-pha; ingest/settlement **không** đòi. Không sửa spec Reviewed tới khi ✅.

## DD-26 — Confirm-before-persist + cross-channel parity cho identity money-adjacent · ✅ Chốt

- **Bối cảnh:** `feature_identity.md` đã có explicit confirmation, strong-key claim, owner review, immutable audit (Bất biến + ID-UC-7/8). Bot bổ sung: **confirm gate trước khi persist tên buddy** + **parity audit TG/Zalo/Messenger** + multi-name intake + **collision interactive ask** + alias-norm collision guard.
- **Quyết định:** **Delta wording** cho BL-ID (không thêm model mới "buddy"): `display_name`/`alias`/`claim-suggestion` **money-adjacent** **KHÔNG** được persist hoặc ảnh hưởng matching nếu chưa có **explicit confirmation + audit**; alias chuẩn-hoá đụng nhau → **hỏi lại tương tác**, không tự gán. **Cross-channel parity** (mọi surface cùng cư xử) thành **test bắt buộc**. "Managed-subject" dùng authz identity/membership sẵn có.
- **Lý do:** Củng cố HR4/DD-01 cho nhánh **chưa-có-tiền** (soft-key), khép khe gán nhầm qua tên; parity chống drift đa kênh.
- **Hệ quả:** Bổ sung Bất biến BL-ID (delta); test parity đa surface + collision-ask + confirm-before-persist. Không sửa spec Reviewed tới khi ✅.

## DD-27 — Channel-aware authz & command-surface · ✅ Chốt

- **Bối cảnh:** Mỗi surface có affordance khác nhau (vd Zalo thiếu một số inline so với TG). Bot đã hiện thực **channel-aware owner/admin gating** + **channel-appropriate `/help` `/status` `/start`**.
- **Quyết định:** Trong `feature_tenant_routing_authz`: **authz + tập lệnh khả dụng tính theo capability từng kênh**; core **surface-agnostic**, gating theo kênh. Routing tenant vẫn **tách rời** authz người dùng (Bất biến identity).
- **Lý do:** Tránh lộ affordance không hỗ trợ / gate sai theo kênh; giữ 1 core, không copy logic sang từng transport.
- **Hệ quả:** Bổ sung matrix `capability × command` vào authz spec; test theo kênh. Không sửa spec Reviewed tới khi ✅.

## DD-28 — Tool live-context (đọc dữ liệu vận hành non-PII) tách khỏi KB-RAG · ✅ Chốt

- **Bối cảnh:** Câu hỏi "buổi tới khi nào / còn chỗ không" cần **dữ liệu vận hành thật** (session/slot/capacity), không phải KB. **DD-21** chốt trợ lý **chỉ** ground `kb_chunks`. Bot fetch live-context (joinedCount/capacity, joinable-only) nhưng **single-club** nên không có ranh giới tenant.
- **Quyết định:** Nếu cho trợ lý trả lời câu hỏi vận hành → làm **TOOL RIÊNG** (không gộp RAG chung, giống nhánh "hỏi nợ của tôi" ở DD-21): **field-whitelist matrix** (chỉ non-PII: môn/giờ/slot còn/tối đa/trạng thái joinable) + **authz** (member của tenant, dưới RLS) + **CẤM** đưa `charges`/`memberships`/`persons`/SĐT vào context LLM. Khớp DD-06 (độ chi tiết theo trạng thái join).
- **Lý do:** Giữ **DD-21/HR2** (KB-only grounding **không đổi**); mở khả năng trả lời vận hành nhưng **khoá chặt** field + authz để không rò tiền/PII.
- **Hệ quả:** Thêm tool `read_live_context(tenant)` tham số hoá + RLS; **field whitelist là test bất biến** (assert tool-output/prompt không chứa PII/ledger). Là **DD riêng**, **KHÔNG** sửa DD-21.

---

## DD-29 — Phase-1 pricing pivot: free web + 3 bot; 1 gói Host Pro 250k · ✅ Chốt

- **Bối cảnh:** DD-03 monetize theo **số kênh** (free_web / telegram 79k / plus 159k / all 199k). Chiến lược Phase-1 (owner, 05/07) đổi hướng **acquisition-first**: cho host kết nối CLB với **cả 3 bot miễn phí** để phủ nhanh, dời monetize sang **gói tính năng tự-động-hoá** thay vì tính theo kênh.
- **Quyết định (chốt):**
  - **Free (mặc định, mọi host) — 0đ:** web app + kết nối **3 bot kênh** (Telegram + Zalo; **Messenger khi GA** — DD-09/P4.8) + quản CLB/kèo/roster cơ bản. Vào thẳng `active` vô thời hạn (giữ **BL-BIL-1**: không trial/past_due/suspended vì non-payment).
  - **Host Pro — 250.000đ/tháng:** mở khoá **Trợ lý AI + KB** (Club Assistant, DD-16..28) + **đối soát CK tự động & báo thu phí** + **nhắc nợ tự động** (+ các tự-động-hoá nâng cao khác — chốt danh sách chi tiết khi promote billing spec).
  - **Bỏ** 3 tier theo kênh (`telegram`/`plus_channel`/`all_channels`). **DD-03 → 🔄 thay bằng DD-29.** DD-22 (định giá trợ lý) nay gộp vào Host Pro.
- **Lý do:** Kênh miễn phí giảm ma sát acquisition (đấu Reclub, phủ CLB nhanh); monetize theo **giá trị tự-động-hoá tiền** (đối soát/nhắc nợ/AI) — thứ host trả tiền thật để đỡ việc. 1 gói giá đơn giản, dễ bán.
- **Hệ quả — propagation checklist (các spec Reviewed cần cập nhật khi thực thi):**
  - `feature_billing_lifecycle(.md/_tech)`: `plans` CHECK → `('free','host_pro')`; price host_pro=250000; `entitlements` = **capability flags** (registry ở `BE/feature_billing_lifecycle_tech.md §4b`: free có `payment_reconcile_manual`/`reminders_manual`; host_pro thêm `payment_reconcile_auto`/`reminders_auto`/`assistant_ai_kb`/`crm_dashboard`). Bỏ edge/test `plus_channel` (#14/#22). ✅ **đã cập nhật spec 05/07; schema/migration implementation vẫn pending** — live schema còn 4-tier cũ (`packages/db/schema.ts` `plans` + `0007_billing.sql`), cần migration đổi CHECK → `('free','host_pro')` khi thực thi billing.
  - `product/BRD.md` (bảng tier L239-242, FR-9.1 L189, AC-8 L331, OD-3 L342) · `product/PRD.md` (chọn plan L182-183) · `product/TDD.md` (FR-13 L65, cron L552) · `product/ROADMAP.md` (P5 L262/264/316/326) · `product/CRM_DASHBOARD_BRD.md` (MRR/revenue-by-plan L421/424/430/527 → 1 gói).
  - ⚠️ **Nuance cần xác nhận khi promote billing:** nếu **auto-reconcile + nhắc nợ là Pro-only** thì free = bot cho session/roster nhưng **thu tiền thủ công**. Xác nhận split này (hoặc free vẫn có reconcile cơ bản, Pro thêm AI + nâng cao) trước khi sửa `feature_payment_reconcile`/`notifications_reminders`.

## DD-30 — Provider onboarding: APIpay enterprise auto-provision per-host · ✅ Chốt

- **Bối cảnh:** Onboarding hiện tại (`feature_connector_onboarding`, Draft) = mỗi host **BYO** (SePay OAuth / ApiPay api_key). Để **launch nhanh**, dùng **quan hệ enterprise với APIpay** ở cấp platform để **auto-provision** webhook/bank-account cho từng host (khỏi bắt host tự OAuth/nhập key).
- **Quyết định (chốt):** Platform giữ **APIpay enterprise credential**; onboarding host = platform gọi APIpay enterprise API đăng ký **per-host** bank-account + webhook `/webhook/apipay/:token`. **Tiền vẫn về tài khoản ngân hàng RIÊNG của host** — **money-custody KHÔNG đổi**, giữ invariant `feature_payment_reconcile` ("platform không giữ tiền player"). Routing tenant vẫn theo `:token → bank_accounts.webhook_token → tenant_id` (**BL-PAY-6**).
- **Lý do:** Giảm ma sát onboarding (self-serve chậm/khó với host phổ thông); tận dụng enterprise để auto-register. Vì không đảo money-custody nên **không** đụng hard rule / rủi ro pháp lý trung gian thanh toán.
- **Hệ quả:**
  - `feature_connector_onboarding(.md/_tech)` (Draft — sửa được): thêm path **"APIpay enterprise auto-provision"** (platform credential, per-host account/webhook), giữ BYO như fallback; provider vẫn `apipay`; verify HMAC `ApiPay-Signature` per-host secret không đổi.
  - **Bảo mật:** enterprise credential platform = tài sản KMS; lộ = ảnh hưởng nhiều tenant → cần rotation + audit riêng. Cần điều khoản enterprise (giới hạn số account/webhook, phí) từ APIpay.
  - **KHÔNG** đụng ledger/reconcile core — chỉ đường onboarding/provisioning.

## DD-31 — Auth security invariant + test matrix (auth-onboarding v3) · 🟡 Đề xuất

- **Bối cảnh:** `feature_web_auth_onboarding(.md/_tech)` đã Reviewed, nhưng lần triển khai đầu (`feat/auth-onboarding-v2`) trải qua 9 round codex review liên tiếp kể từ lúc resume (06→07→08→09), mỗi round phát hiện **một finding khác nhau ở một file khác nhau** — không phải region-thrash (không lặp cùng 1 vùng) mà là pattern "distinct findings spreading across nhiều file round sau round", điều mà standing invariants coi là dấu hiệu slice quá lớn/under-specified chứ không phải thrash đơn thuần. `HALT-MAX_ROUNDS.txt` (round-06, P2 logout-CSRF, đã fix khi resume) và `AWAIT-FOUNDER-round09-nonconvergence.txt` (round-09, P2 unkeyed lookup hash, chưa fix) đều dừng lại chờ founder quyết định thay vì tự vá tiếp lần thứ N. Trước khi build v3, cần một **invariant + test matrix thực thi được** (`BE/auth-security-invariant-table.md`) để design pass không lặp lại kiểu non-convergence này.
- **Quyết định (đề xuất):** Chốt danh mục 8 bất biến bảo mật (SI-1..SI-8, chi tiết đầy đủ + test cụ thể + schema ref ở `BE/auth-security-invariant-table.md`) làm scope bắt buộc cho `auth-onboarding-v3`. Trong đó **4 mục còn open ở mức implementation/spec-pin** — **founder decisions đã resolved 2026-07-06** (OQ-1/2/3, xem §5 invariant table), chỉ còn code + pin spec, **KHÔNG chờ founder nữa**:
  1. **SI-1 — Pre-auth login-state CSRF binding:** cơ chế state token single-use/short-TTL/browser-bound (3 artifact mới: migration `auth_login_state`, route issue login-state, callback consume) — bổ sung cho (không thay thế) `sameOriginRequest()` hiện tại.
  2. **SI-3 — Explicit tenant-filter policy:** chốt làm **policy bằng văn bản** (mọi query tenant-scoped mới trên bề mặt auth/onboarding phải dùng CẢ `withTenant` LẪN predicate `tenant_id` tường minh) + **PORT code fix round-07** (`onboardingSnapshot`) từ v2 sang v3 (base `feat/phase1-fable5` không có).
  3. **KMS/secret source wiring:** chưa có helper crypto/KMS nào trong `packages/` (đã grep toàn repo, 0 kết quả) và chưa có code nào đọc `KMS_PROVIDER`/`ENCRYPTION_KEY`/`SESSION_SECRET` dù đã tài liệu hoá quy ước ở `environments-setup.md §3`. **Đã chốt 2026-07-06 (OQ-2): AWS KMS** cho staging/prod (khớp ví dụ fly-secrets sẵn có `KMS_PROVIDER="aws-kms"`), dev local giữ fallback `ENCRYPTION_KEY`. Còn lại: viết 1 helper dùng chung (Phase B).
  4. **SI-2 — Keyed hash cho `account_identities.platform_user_hash`** (layer **web-auth**, KHÔNG phải `channel_identities.platform_user_lookup_hash` — hai cột khác tầng, xem bảng phân biệt trong invariant table §1): thay `sha256("telegram:"+id)` trần hiện tại (round-09 finding — brute-forceable vì TG user id entropy thấp, enumerable) bằng keyed HMAC; nguồn key đã chốt ở gap 3.
  Các SI còn lại (SI-4 logout fail-closed, SI-5 shared rate-limiter, SI-6 creation-race idempotency, SI-7 session rotation, SI-8 onboarding_steps recency dedupe) đã được **validate ở v2 reference (`feat/auth-onboarding-v2 @7407caa`)** — nhưng code/test đó **KHÔNG có trên base `feat/phase1-fable5`** (đã verify git). v3 phải **PORT/reimplement + giữ test trong manifest scope**, KHÔNG phải chỉ pin regression.
- **Lý do:** Gate class-aware autopilot coi auth/security/PII là **STRICT** (zero finding bất kể P-level). Một bảng bất biến tường minh, bám sát spec Reviewed + toàn bộ evidence trail v2 (9 round), giúp v3 build đúng ngay từ đầu thay vì lặp lại chu kỳ phát-hiện-rồi-vá-từng-round của v2.
- **Hệ quả:** `auth-onboarding-v3` (manifest mới) phải cover đủ 8 SI trong scope — **tất cả PORT/reimplement vì base không có auth code**. **Spec-pin (gỡ deadlock):** Phase A KHÔNG sửa spec; **Phase B ĐƯỢC pin 4 gap vào `_tech.md`** sau khi founder answers đã record (xong 2026-07-06) — đây là bổ sung phần **chưa đặc tả**, không phải sửa phần đã Reviewed. DD-31 giữ 🟡 tới khi v3 merge 2 round clean; việc pin gap **không** chờ DD-31 ✅.
- **Founder quyết định 2026-07-06:** OQ-1 → **giữ nguyên scope Phase-1** (TG Login + web-account fallback only; DD-13 vẫn 🟡, không mở rộng Google/email-password trong v3). OQ-2 → **AWS KMS** (staging/prod; `ENCRYPTION_KEY` fallback dev). OQ-3 → **giữ DD-31 🟡** tới khi `auth-onboarding-v3` merge với 2 round codex clean liên tiếp, mới chuyển ✅. Chi tiết đầy đủ: `BE/auth-security-invariant-table.md §5`.

## DD-32 — Channel-first booking funnel (link → book-in-chat → app) · 🟡 Đề xuất

> **Đây là PROPOSAL cho một phễu tăng trưởng, KHÔNG phải một luật đã chốt.** Mặc định khuyến nghị là **phễu MỀM** (guest vẫn book được). Implementer **KHÔNG** được coi đây là gate cứng hay thu hẹp guest-join hiện tại cho tới khi founder chốt phương án + DD-32 chuyển ✅.

- **Mục tiêu (owner 2026-07-06):** **Phễu tăng trưởng channel-first**, KHÔNG phải gate chống gian lận. Ý đồ: user **link Plexco account ↔ Facebook + Zalo** → mở khoá **đặt slot ngay trong Messenger/Zalo** (giá trị tức thì, ở nơi user đã có mặt) → **hook** user vào hệ Plexco. Book-in-chat = **lớp engagement nhẹ**; muốn làm nhiều hành động hơn / theo dõi chỉ số / phân tích sâu → **lên app Plexco** (lớp sâu). Link account là **cửa vào phễu**, không phải rào cản.
- **Bối cảnh — trạng thái docs hiện tại (giữ nguyên, không phải "thành luật"):** spec Reviewed hiện cho phép book **không cần link trước** (guest-join thuần). Proposal này **thêm một lớp phễu bên trên** đường guest đó, không thay nó:
  - `feature_identity.md` **ID-UC-2**: "Join một tenant lần đầu → tạo membership idempotently" — channel identity gắn `Person` tự động khi nhắn bot; không có bước link bắt buộc.
  - `feature_cross_club_join.md` **CCJ-UC-1**: open-join tạo **guest membership** on-the-fly; "verified identity" = player sở hữu channel identity của chính mình (CCJ edge #3), **không** đồng nghĩa "đã link web/Plexco account".
  - `feature_zalo_channel.md` **ZAL-UC-2/3**: `/join` → reply số → common join service; `/link` (OTP) chỉ để **merge cross-channel** (ID-UC-3, `link_codes`), **không** phải cổng chặn booking.
- **Phương án đưa link vào phễu (founder chọn 1):**
  - **(A) Phễu mềm — KHUYẾN NGHỊ (mặc định):** guest vẫn book được (**giữ nguyên CCJ-UC-1**); link account **chỉ mở thêm giá trị** (lịch sử xuyên club, nhắc nợ/nhắc kèo, magic-link lên app, giữ slot nhanh hơn) + **CTA link** hiện sau mỗi lần book guest. Không thu hẹp guest-join.
  - **(B) Gate cứng toàn hệ:** mọi book qua bot đều cần link trước — **thu hẹp** guest-join. Chỉ cân nhắc nếu đo được lạm dụng guest thực sự.
  - **(C) Gate theo điều kiện:** chỉ session **có tiền** mới cần link; free session vẫn guest-join.
- **Lý do (khớp DD-29 acquisition-first):**
  - Book-in-chat trên Messenger/Zalo phủ user tại đúng nơi họ dùng hằng ngày → giảm ma sát so với bắt cài app trước. Chặn cứng ngay bước book dễ **làm rớt chính nhóm user đang muốn kéo vào** → đó là lý do khuyến nghị (A).
  - **Tiered engagement:** channel = lớp nhẹ (book/nhắc/xác nhận), app = lớp sâu (nhiều hành động, dashboard, phân tích) → tạo lý do tự nhiên để user lên app; đồng thời định danh chắc hơn trước khi phát sinh nghĩa vụ tiền (củng cố HR4/DD-01 ở nhánh có tiền).
- **Phụ thuộc provider login (đường tạo linked-state):** "link ↔ Facebook" phụ thuộc **DD-33** (Facebook Login/Messenger account-link — ⬜); "link ↔ Zalo" phụ thuộc **DD-14** (Zalo Login gating — ⬜). Nếu social login chưa bật → phễu tạm dùng OTP `/link` thủ công (ma sát cao hơn, giảm hiệu quả hook). **DD-13** (Google/email-password) **KHÔNG** bao Facebook — xem `00-start-here/identity-model.md` §7 (provider/channel phase matrix).
- **Hệ quả (chỉ áp dụng KHI DD-32 ✅ + founder chốt phương án):** propagation vào spec Reviewed **theo phương án đã chọn** — với (A) là **thêm** lớp CTA/giá trị mà không sửa nhánh guest; với (B)/(C) mới cần chèn điều kiện require-link trước join. Chi tiết + use case + state machine phễu ở feature doc Draft `feature_channel_booking_funnel.md`. **KHÔNG** sửa thân spec Reviewed cho tới khi DD-32 ✅.
- **Còn lại (chờ founder chốt):** (1) Phương án **A / B / C** (khuyến nghị A); (2) định nghĩa "linked" — chỉ cần OTP `/link` đã confirm hay cần **web-auth account đầy đủ** (`accounts` + `account_identities` verified); (3) thứ tự bật **DD-33/DD-14** (FB/Zalo Login social); (4) neo hiện thực "book qua bot" trên **common join service** (CCJ).

## DD-33 — Facebook Login / Messenger account-link như web-auth provider · ⬜ Mở

- **Bối cảnh:** DD-13 hiện chỉ bao **Google / email-password** ("bật ngay được" cho web/app — `feature_web_auth_onboarding.md`). DD-14 bao **Zalo Login**. **Facebook Login chưa có DD riêng** — nhưng phễu channel-first (**DD-32**) cần "link Plexco ↔ Facebook" để book-in-chat trên Messenger. `00-start-here/identity-model.md` §7 (provider/channel phase matrix) để "Zalo/Facebook OAuth login" là **web-auth future riêng, không tự link chéo** với Messenger Page channel.
- **Cần chốt:** (1) Bật **Facebook Login** như một `account_identities.platform='facebook'` provider (verify stable FB user id, hash/encrypt, thêm enum/check migration); (2) Facebook Login có phụ thuộc **FB Business Verification / App Review** đang pending không (giống rào Messenger P4.8 — `messenger-channel-design` R-review); (3) quan hệ giữa **FB Login (web-auth)** và **Messenger PSID (channel, page-scoped)** — hai subject khác nhau, cần cơ chế link (OTP `/link` hoặc verified signal) để gắn về cùng `person`, **không** auto-link chéo.
- **Hệ quả:** Là **đường tạo linked-state Facebook** cho DD-32; nếu App Review chặn → phễu Facebook tạm dùng OTP `/link` thủ công. Khi chốt: cập nhật `00-start-here/identity-model.md` §7 (chuyển "Facebook OAuth" từ future → path có phase) + `feature_web_auth_onboarding` (thêm provider) + align SI-1/SI-2 (DD-31) cho callback/hash. **KHÔNG** đụng core `Person`/`Membership`.

---

## DD-34 — Plexco Global KB plane + union retrieval (KB-club ∪ KB-Plexco) · 🟡 Đề xuất

- **Bối cảnh:** Club Assistant đã chốt (DD-16..28) chỉ bao **KB per-CLB tenant-private**; trợ lý chỉ biết KB của đúng club. Owner (06/07) muốn trợ lý trả lời cả câu hỏi **về chính nền tảng Plexco** (tính năng, cách dùng, chính sách chung) — không có plane cho tri thức dùng chung không thuộc tenant nào.
- **Quyết định (đề xuất):** Thêm plane **GLOBAL read model** `platform_kb_*` (`platform_kb_sources/documents/chunks`) — **KHÔNG có `tenant_id`**, do process **platform-admin** ghi, role `app` chỉ **`GRANT SELECT`** (cô lập-bằng-grant như DD-12/`readonly`, KHÔNG vào RLS list `0009`). Mở rộng `searchKnowledgeBase(tenantCtx, query)` thành **union 2 nhánh**: `kb_chunks` WHERE tenant (RLS) ∪ `platform_kb_chunks` (global), hợp nhất RRF, gắn nhãn scope; **precedence club > platform** khi trùng chủ đề (`bot_configs.include_platform_kb`/`platform_kb_weight`).
- **Quan hệ với DD-21 (extension, KHÔNG "nguyên vẹn"):** DD-34 **mở rộng nguồn grounding** của DD-21: grounding vẫn **chỉ KB**, nhưng **allowed KB sources** mở từ `kb_chunks(tenant)` → `kb_chunks(tenant) ∪ platform_kb_chunks`. **Live-context (DD-28) vẫn tách riêng, không trộn.** Khi DD-34 ✅ **phải patch DD-21** + Club Assistant specs (`feature_club_assistant.md` bất biến "KB prompt = chỉ `kb_chunks`" · `BE/feature_club_assistant_tech.md` §5) để phản ánh nguồn union — đây là điều kiện promote, không được để DD-21 mâu thuẫn.
- **Lý do:** Tri thức nền tảng dùng chung mọi club → 1 nguồn, cập nhật đồng loạt (không nhồi-trùng-lặp N club); có tiền lệ bảng global trong feature (`embedding_cache`).
- **Cô lập & guard (bảng SELECT cho mọi tenant nên phải chặt):** thiếu `tenant_id` chỉ ngăn **routing/association** — **KHÔNG** tự ngăn nội dung tenant bị ingest **nhầm** vào `content`. Vì `platform_kb_*` đọc-chung mọi tenant, `platform_kb_*` **KHÔNG ĐƯỢC chứa** (không phải "không thể chứa") dữ liệu tenant/PII ⇒ cần guard nhiều lớp: (1) **source allowlist** — chỉ ingest tài liệu sản phẩm Plexco (platform-docs-only), không nhận nguồn tenant; (2) **admin review** trước khi `status='active'`; (3) **scanner + test bất biến** assert `content` không chứa tenant identifier/PII pattern (SĐT/email/`pay_code`/tên roster). Grant: role `app` chỉ SELECT; ghi bởi role platform-admin.
- **Hệ quả:** Test bất biến: platform table không `tenant_id`; role `app` không ghi được; **scanner PII/tenant-id trên `content` = xanh**; union không rò KB club A↔B; câu hỏi nền tảng nhận chunk platform. Chi tiết `proposals/plexco-global-kb-and-kb-autosync.md §3`. **Không** sửa spec Reviewed tới khi ✅ (khi ✅ mới patch DD-21 + Club Assistant specs).

## DD-35 — Auto-derive KB-club từ dữ liệu canonical · 🟡 Đề xuất

- **Bối cảnh:** KB-club hiện tại là host **nạp thủ công** (`kind ∈ faq/doc_upload/pasted/url`). Owner muốn KB **tự cập nhật theo update của từng club** — không bắt host nạp lại khi đổi mô tả/luật/chính sách.
- **Quyết định (đề xuất):** Thêm `kb_sources.kind='derived'`. Khi field **mô tả** canonical của club đổi → **command→outbox→projector** (HR3) tự dựng lại KB document từ **field-whitelist** (tên/mô tả CLB, nội quy, chính sách giá dạng text, khung lịch, hướng dẫn tham gia). 1 aggregate canonical : 1 derived source (upsert theo `derive_key`), idempotent `content_hash`.
- **Lý do:** Giữ KB tươi mà không tăng việc cho host; canonical là nguồn sự thật, KB-derived là read model dẫn xuất (không multi-master).
- **Ranh giới (giữ HR2/DD-21/DD-28):** **CẤM** derive `charges`/`memberships`/`persons`/SĐT/`pay_code`/số dư vào KB. **KHÔNG** derive dữ liệu vận hành realtime (slot buổi cụ thể, ai join) — cái đó là **DD-28 live-context tool**, không phải KB. Precedence: host-manual > derived (host tắt được từng mảng derived).
- **Hệ quả:** Thêm projector + field-whitelist (enumerate ở BE tech). Test bất biến: derived doc ⊆ whitelist (không ledger/PII); đổi field non-whitelist → KB không đổi; derive qua outbox (không ghi KB thẳng). Chi tiết proposal §4. **Không** sửa spec Reviewed tới khi ✅.

## DD-36 — Freshness: scheduled re-crawl + re-ingest KB-Plexco · 🟡 Đề xuất

- **Bối cảnh:** "Update KB theo update của **Plexco**" + nguồn URL cần tự làm mới; hiện ingest chỉ chạy khi host thao tác.
- **Quyết định (đề xuất):** (a) **KB-Plexco** re-ingest khi team Plexco đổi tài liệu sản phẩm (change-detect `platform_kb_sources.content_hash`); (b) nguồn `kind='url'` (tenant + platform) **scheduled re-crawl** bằng **pg-boss cron**: refetch → so `source_etag`/`content_hash` → chỉ re-ingest khi đổi. Thêm field freshness (`last_synced_at`, `next_sync_at`, `sync_interval`, `source_etag`).
- **Lý do:** Tự cập nhật theo nguồn thay đổi mà idempotent (INV-6) + bounded (P14); provider ngoài txn (P9); đổi model → P12.
- **Hệ quả:** Nguồn URL fail khi re-crawl → giữ KB active cũ + `status='error'` + cảnh báo (không phá KB). Metric staleness/DLQ (P15). Chốt nguồn KB-Plexco (docs/ vs CMS) ở tech spec. Chi tiết proposal §5. **Không** sửa spec Reviewed tới khi ✅.

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 20/06/2026 | v1.0 | Khởi tạo decision log; gom OD-1..OD-10 (BRD §16) + Open Questions (TDD §11) thành DD-01..DD-12 |
| 20/06/2026 | v1.1 | Đồng bộ với `deployment-infra.md`: DD-07 → ✅ Chốt (SSE+`LISTEN/NOTIFY`); DD-04 & DD-10 → 🟡 đã thu hẹp; thêm ghi chú grant scope `readonly` vào DD-12 |
| 20/06/2026 | v1.2 | Chốt DD-03 pricing 4 tier: free web, 79k Telegram, 159k thêm Zalo/Messenger, 199k tất cả |
| 02/07/2026 | v1.3 | Thêm DD-13 (web-auth provider Google/email — 🟡 đề xuất), DD-14 & DD-15 (⬜ cần xác minh Zalo Login/OA gating & Bot `from.id` cross-bot) từ session strategy identity/acquisition |
| 05/07/2026 | v1.4 | Thêm DD-16..DD-22 (Club AI Assistant + Knowledge Base RAG per-CLB): scope/plane, pgvector, provider LLM+privacy, chat phasing, bot-as-config, KB-only grounding, entitlement. Nguồn: `proposals/club-ai-bot-knowledge-base.md` |
| 05/07/2026 | v1.5 | Thêm DD-23 (hybrid retrieval BM25+semantic+RRF, Postgres-native) sau khi đối chiếu pipeline mẫu; proposal thêm tone selector + upload PDF + embedding_cache/fts/summary. |
| 05/07/2026 | v1.6 | Thu hẹp scope trợ lý: **CHỈ trong app Plexco** (không TG/Zalo/Messenger). Cập nhật DD-16 (dependencies), DD-19 (rewrite: ask-panel + native chat in-app), DD-20 (bỏ mượn adapter ngoài). |
| 05/07/2026 | v1.7 | Thêm DD-24..DD-28 từ review delta 2 bot (`proposals/bots-weekly-review-2026-07-05.md`): pending_interaction primitive, two-phase confirm (human-initiated), confirm-before-persist identity money-adjacent, channel-aware authz, live-context tool tách khỏi DD-21. |
| 05/07/2026 | v1.8 | **Chốt DD-29 (Phase-1 pricing pivot: free web + 3 bot; Host Pro 250k)** — thay DD-03 (🔄); **DD-30 (APIpay enterprise auto-provision per-host, giữ money-custody)**. Kèm propagation checklist cho BRD/PRD/TDD/ROADMAP/CRM/billing/connector. Nguồn: owner. |
| 05/07/2026 | v1.9 | **Chốt DD-16,17,19,20,21,22,23,24,25,26,27,28 → ✅** (owner) để mở khoá build Phase-1 (S19 Club Assistant + slice tiền/identity). **DD-18 giữ ⬜** (provider LLM + review privacy/ToS/DPA) — chặn **GO-LIVE** trợ lý, KHÔNG chặn build (đặt sau interface swappable). DD-22 gộp Host Pro (DD-29). |
| 06/07/2026 | v1.10 | Thêm **DD-31** (Auth security invariant + test matrix, auth-onboarding v3 — 🟡 đề xuất): 8 bất biến SI-1..SI-8 + 4 gap chưa chốt (login-state CSRF, tenant-filter policy, KMS/secret wiring, keyed web-auth hash), đối chiếu Reviewed specs + toàn bộ evidence trail `auth-onboarding-v2` (round-01..09, HALT/AWAIT-FOUNDER). Nguồn: security-design-pass session; chi tiết ở `BE/auth-security-invariant-table.md`. |
| 06/07/2026 | v1.11 | Thêm **DD-32** (🟡 đề xuất): gate book-slot qua bot sau khi link Plexco account — ghi nhận MÂU THUẪN với low-friction guest-join hiện tại (ID-UC-2, CCJ-UC-1) và DD-29 acquisition-first; nêu 3 phương án A/B/C + phụ thuộc DD-13/14, chờ founder chốt. Nguồn: session hỏi feature 2026-07-06. |
| 06/07/2026 | v1.12 | Review fixes: **DD-32** reframe heading "Channel-first booking funnel (proposal)" + bỏ wording "thành luật", nêu rõ **mặc định phễu MỀM** (giữ guest-join), tránh implementer hiểu là gate cứng. Thêm **DD-33** (⬜ Facebook Login/Messenger account-link — DD-13 KHÔNG bao Facebook); DD-32 nay trỏ DD-33+DD-14 thay vì DD-13/14. **DD-31** đổi wording "4 gap chưa đóng chờ founder" → "founder resolved, còn impl/spec-pin" (tránh v3 halt). **DD-29** làm rõ "đã cập nhật spec 05/07; schema/migration pending". Cleanup: bỏ "(đề xuất)" ở 12 DD đã ✅ Chốt (16,17,19,20,21,22,23,24,25,26,27,28). |
| 06/07/2026 | v1.13 | Ref fixes (round 2): sửa cross-ref `00-start-here/identity-model.md §6` → **§7** (provider/channel phase matrix) ở DD-32/DD-33 **+ DD-13** (lines bảng & hệ quả) + `feature_web_auth_onboarding(.md/_tech)`; phase DD-32 thêm **Messenger P4.8** (bảng tổng hợp + funnel doc + README); README + changelog đổi phụ thuộc `DD-13/DD-14` → **DD-33/DD-14**; DD-14 hệ quả đổi "ảnh hưởng DD-13" → **DD-32/provider-link path** (DD-13 đã fence Google/email) + trỏ §5/§7; `00-start-here/identity-model.md` §8 truy vết + §7 matrix thêm **DD-33**. |
| 06/07/2026 | v1.14 | Thêm **DD-34/35/36** (🟡 đề xuất) mở rộng Club Assistant: KB toàn nền tảng (global read-only, non-PII) + union retrieval club∪platform; auto-derive KB-club từ canonical (field-whitelist, tách DD-28); freshness scheduled re-crawl + re-ingest KB-Plexco. **DD-34 = extension DD-21** (allowed KB sources mở sang platform; patch DD-21 + Club Assistant specs khi ✅); guard platform-KB (allowlist + admin review + scanner PII). Nguồn: session hỏi feature 2026-07-06 · `proposals/plexco-global-kb-and-kb-autosync.md`. |
