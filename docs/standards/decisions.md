# Decision Log (ADR-lite) — Plexco

> Nguồn sự thật duy nhất cho các quyết định thiết kế/kỹ thuật. Gom từ `product/BRD.md §16 (Open Decisions)` và `product/TDD.md §11 (Open Questions)`.
> Khi chốt một quyết định ở đây, cập nhật trạng thái và xoá khỏi "Open" ở BRD/TDD (giữ một nguồn).

## Quy ước

- **Trạng thái:** ✅ Chốt · 🟡 Đề xuất (chờ xác nhận) · ⬜ Mở (chờ chọn) · 🔗 Phụ thuộc ngoài
- **ID:** `DD-NN`. DD-01..DD-10 kế thừa OD-1..OD-10 (BRD). DD-11+ là quyết định chỉ có trong TDD.
- Mỗi mục: Bối cảnh → Quyết định → Lý do → Hệ quả.

## Bảng tổng hợp

> ⚠️ **Bảng này không đầy đủ — đo 22/08/2026: DD-110, DD-111, DD-112 KHÔNG có hàng ở đây** dù cả ba đã
> có mục thân bài. Đọc DD mới nhất bằng `grep -nE '^## DD-1[0-9][0-9]' docs/standards/decisions.md`,
> đừng dùng bảng này làm bản kiểm kê.

| ID | Quyết định | Trạng thái | Phase | Nguồn |
|---|---|---|---|---|
| DD-01 | SĐT verified (share-contact) là khoá merge chính | 🔄 Điều chỉnh bởi DD-50 (phase-1 KHÔNG thu SĐT; khoá mạnh = verified email + link_code; phone = merge signal tương lai, schema giữ dormant) | P3.5 | BRD OD-1 · TDD Q6 |
| DD-02 | `pay_code` contract: suffix trần 4-ký-tự + prefix namespace + resolver own/foreign/none + allocation invariant | ✅ Chốt (2026-07-13) | P4 | BRD OD-2 · TDD Q3 · `../decisions/analysis/dd-02-paycode-analysis.md` |
| DD-03 | Pricing/tier subscription host (4 tier theo kênh) | 🔄 Thay bằng DD-29 | P5 | BRD OD-3 · TDD Q4 |
| DD-04 | Hosting PostgreSQL → ✅ **(c) co-locate DigitalOcean** (App Platform + Managed PG HA-standby, VPC private, Singapore); Fly = fallback (a); **pre-build gate = §7.1 egress-IP verify** | ✅ Accepted (2026-07-16) | P0 | BRD OD-4 · TDD Q2 · `deployment-infra.md §2` · `../decisions/analysis/dd-04-hosting-final-decision.md` · `../decisions/analysis/dd-04-hosting-decision-brief.md` |
| DD-05 | Join cross-club: open vs approval → ✅ **per-session, default open**; approval first-entry chỉ tạo `join_requests(pending)`. Join/request resolve existing player trước: `active|waitlisted` trả current outcome idempotently; chỉ absent/`left` mới chạy DD-41/DD-42/shared DD-52 trước mutation/request. Existing-`left` request-create chỉ preflight DD-49 trên live aggregate, **không persist financial proof trong `join_requests`**; approve phải lock rồi re-check restrictions + re-derive/revalidate disposition hiện hành trước mutation | ✅ Chốt (2026-07-13; integrity re-check 2026-07-19) | P4.3 | `../decisions/analysis/dd-05-join-policy-analysis.md` |
| DD-06 | Độ chi tiết vị trí public → ✅ **`area` only public; venue chỉ khi outcome `players.status='active'`** (invariant test) | ✅ Chốt (2026-07-13; clarified 2026-07-19) | P4.3 | `../decisions/analysis/dd-06-location-granularity-analysis.md` · DD-98 NP-5 (geo/radius negative scope trong khuôn DD-06) |
| DD-07 | Web realtime: SSE + fan-out qua `LISTEN/NOTIFY` | ✅ Chốt | P4 | BRD OD-7 · TDD Q7 · `deployment-infra.md §2` |
| DD-08 | Danh sách môn khởi điểm + taxonomy trình độ | ✅ Chốt (2026-07-13) | P0 | BRD OD-8 |
| DD-09 | Messenger vào lộ trình lúc nào | 🔄 Thay bằng DD-37 (Messenger là kênh phase-1) | P4.8→P2.5 | BRD OD-9 |
| DD-10 | Web stack = Next.js App Router, standalone/container; không Vercel | ✅ Chốt | P4 | live `apps/web` · BRD OD-10 · TDD Q1 · `deployment-infra.md §2` |
| DD-11 | Zalo Premium + add-on managed (owner >3 CLB) | 🔗 Phụ thuộc ngoài | P4.7 | TDD Q5 |
| DD-12 | Public read model = bảng `public_sessions` cập nhật qua projector | ✅ Chốt | P4.3 | live schema/migrations · TDD Q10 |
| DD-13 | Web-auth provider **Google + email-password** là auth **phase-1** (thay TG Login đã bỏ) | ✅ Chốt | P1 | session 2026-07-02 · **owner 2026-07-10 (DD-37)** · `feature_web_auth_onboarding.md` · `00-start-here/identity-model.md §7` |
| DD-14 | Zalo Login (Social API) có bị chặn bởi cửa đăng ký OA không | 🔗 **External enablement evidence**; chưa có bằng chứng thì Login/CTA OFF, account-linking chỉ qua verified link-code path (DD-50 `/link`, phase-1 contract chưa build); không tự authorize bot↔Login auto-link | P4+ | cần bằng chứng Zalo attributable/reproducible |
| DD-15 | Zalo Bot `from.id` có ổn định xuyên nhiều bot khác nhau không | 🔗 **External optimization evidence**; endpoint-scoped identity vẫn là authority, kết quả spike không tự nới uniqueness/merge | P4+ | cần bằng chứng Zalo trước mọi proposal nới scope |
| DD-16 | Feature Club AI Assistant + Knowledge Base (RAG per-CLB) | ✅ Chốt | P7 (post-MVP) | `proposals/club-ai-bot-knowledge-base.md` |
| DD-17 | Vector store = pgvector tenant-private (không vector DB ngoài giai đoạn đầu) | ✅ Chốt | P7 | proposal §7.1 |
| DD-18 | Provider embedding/LLM cho trợ lý + review privacy/ToS/khu vực dữ liệu | ⬜ Mở (chặn GO-LIVE, không chặn build) | P7 | proposal §7.2 |
| DD-19 | Trợ lý CHỈ trong app Plexco (không TG/Zalo/Messenger); pha A ask-panel, pha B native chat | ✅ Chốt | P7 | proposal §8 |
| DD-20 | Trợ lý là config tenant, KHÔNG phải Person/ChannelIdentity mới | ✅ Chốt | P7 | proposal §3.1 · §P6 |
| DD-21 | Grounding chỉ KB đã qua DLP; không ingest/retrieve secret, PII, ledger vào LLM | ✅ Chốt (DLP clarified v1.45) | P7 | proposal §6.2 · HR2 |
| DD-22 | Entitlement/định giá trợ lý (add-on gói) | ✅ Chốt (gộp Host Pro — DD-29) | P5/P7 | DD-29 |
| DD-23 | Hybrid retrieval (BM25 + semantic + RRF), Postgres-native | ✅ Chốt | P7 | proposal §5.2 · §12 |
| DD-24 | Primitive `pending_interaction` (multi-step, idempotent, bounded, cancelable) cho lệnh tiền/host | ✅ Chốt | P3/P4 | `proposals/bots-weekly-review-2026-07-05.md` O2 |
| DD-25 | Preview + two-phase confirm cho **human-initiated** money mutation (không áp automated reconcile) | ✅ Chốt | P3 | bots-weekly-review M1 · BL-PAY |
| DD-26 | Confirm-before-persist + cross-channel parity cho identity **money-adjacent** (delta, không thêm model "buddy") | ✅ Chốt | P3.5 | bots-weekly-review I1 · `feature_identity.md` |
| DD-27 | Channel-aware authz & command-surface | ✅ Chốt | P4.5+ | bots-weekly-review P1 · `feature_tenant_routing_authz` |
| DD-28 | Tool live-context (đọc dữ liệu vận hành non-PII) **tách khỏi** KB-RAG (DD-21) | ✅ Chốt | P7 | bots-weekly-review A3 |
| DD-29 | **Phase-1 pricing pivot**: free web + bot (**Zalo + Messenger**); 1 gói trả phí **Host Pro 250k/tháng** (thay 4-tier theo kênh) | ✅ Chốt | P5 | owner 2026-07-05 · thay DD-03 · kênh cập nhật DD-37 |
| DD-30 | Provider onboarding: **APIpay enterprise auto-provision per-host** (tiền vẫn về TK host — giữ money-custody) | ✅ Chốt | P3/P4 | owner 2026-07-05 · `feature_connector_onboarding` |
| DD-31 | Auth security invariant + test matrix (auth-onboarding v3): 8 bất biến SI-1..SI-8. **v3 đã MERGE vào `main@1eb6f60`** (Telegram-era; migrations 0012/0013 + KMS pepper client + tests). Residual = **audit SI trên main + thay provider Telegram Login → Google/email** (DD-37/DD-13) | ✅ Merged (Telegram-era) · residual = Google/email swap | P4 | session 2026-07-06 · merge `5b1193b` · `BE/auth-security-invariant-table.md` |
| DD-32 | Phễu channel-first → ✅ **Option D (final risk gate)**: browse không link; free/full/approval giữ no-pay timing; paid+linked active+charge/pay-later; paid+unlinked giữ chỗ 15 phút và chỉ active sau verified full payment. Account link phải là exact ChannelIdentity↔current Person↔verified Plexco Account; provider outage fail closed | ✅ Reopen + chốt (2026-07-28; thay Option A) | P4.3 + Messenger **P2.5** | `../decisions/analysis/dd-32-booking-funnel-analysis.md` |
| DD-33 | Facebook Login / Messenger account-link như web-auth provider (`account_identities.platform='facebook'`) — **phase-1** (kênh Messenger + link account); phụ thuộc App Review | ✅ Chốt (owner 2026-07-18; phase-1 · App Review kick-off) | P2.5 | session 2026-07-06 · **owner 2026-07-10 (DD-37)** · `00-start-here/identity-model.md §7` |
| DD-34 | Plexco Global KB plane + union retrieval | 🟡 Approve-in-principle; reopen trước migration/union-read đầu tiên khi storage/profile + platform-content owner đã có evidence | P7 | `../decisions/analysis/dd-34-36-kb-platform-analysis.md` (authoritative; proposal `plexco-global-kb-and-kb-autosync.md` = historical provenance) |
| DD-35 | Auto-derive KB-club từ canonical | 🟡 Approve-in-principle; reopen khi canonical club-profile fields + sole mutation/outbox owner đã merge | P7 | `../decisions/analysis/dd-34-36-kb-platform-analysis.md` (authoritative; proposal §4 = historical provenance) |
| DD-36 | Freshness: scheduled re-crawl + re-ingest KB-Plexco | 🟡 Approve-in-principle; reopen sau URL-ingest security + generation/CAS + scheduler evidence | P7 | `../decisions/analysis/dd-34-36-kb-platform-analysis.md` (authoritative; proposal §5 = historical provenance) |
| DD-37 | **Phase-1 channel pivot: BỎ Telegram; Facebook Messenger + Zalo + web là kênh MVP** (thay DD-09) | ✅ Chốt | P1–P2.5 | owner 2026-07-10 · thay DD-09 · BRD v3.4 |
| DD-38 | **Chat cơ bản trong app phase-1** (toàn CLB + 1-1, chỉ Plexco, không bridge) — dựng hạ tầng `chat_*` sớm; trợ lý (DD-19) tái dùng ở P7 | ✅ Chốt | P4 | owner 2026-07-10 · BRD v3.4 MODULE 10 |
| DD-39 | **Giá theo giới tính** (kèo giá nam/nữ); giới tính từ hồ sơ person, PII có consent, không lộ public | ✅ Chốt | P2/P4 | owner 2026-07-10 · BRD v3.4 MODULE 11 |
| DD-40 | **Mark-paid thủ công (tiền mặt/CK, tap/multi-select) mặc định MỌI tier** → ghi `payment_allocations` (source `cash`/`manual`), KHÔNG bảng `payment`; auto-reconcile + nhắc tự động là `host_pro` (giải nuance DD-29) | ✅ Chốt | P2/P3 | owner 2026-07-10 · giải DD-29 nuance |
| DD-41 | **Field mô tả + gating cho `sessions`** → ✅: title/notes/`session_type`(1 field)/byoe/cost_shared/instructions + gating level-rank/gender/**age** (enforce ở **shared `evaluateSessionEligibility`**←`addMemberToSession`, self-attested, 9 exact codes); gender/age dùng `gender_enc`/`dob_enc`+consent state; retire `skill_level`→rank | ✅ Chốt (2026-07-13) | P2/P4 | `../decisions/analysis/dd-41-session-fields-gating-analysis.md` |
| DD-42 | **No-show/attendance/reliability** → ✅ **per-tenant** (attendance trên `players`, reliability trên `memberships`, policy deprioritize/ban; RLS, không public) | ✅ Chốt (2026-07-13) | P4+ | `../decisions/analysis/dd-42-reliability-analysis.md` |
| DD-43 | **Nhãn/hạng thành viên + audience targeting** → ✅ per-tenant tags (host-defined; announce audience; public không lộ tag; level dùng DD-08; `membership_tier` bỏ khỏi MVP) | ✅ Chốt (2026-07-13) | P4+ | `../decisions/analysis/dd-43-membership-tags-analysis.md` |
| DD-44 | **Invite-link token** cho kèo private → ✅ `session_invite_tokens` (entropy ≥128-bit/hash/expires/max_uses; used_count-on-state-transition; vẫn qua join_policy + DD-41/DD-42/shared DD-52; không hạ visibility). Existing active/waitlisted/pending hoặc command replay trả current outcome và không consume thêm use; ban/restriction/unknown fail-closed không request/player/charge/token mutation | ✅ Chốt (2026-07-13; restriction/idempotency clarified 2026-07-19) | P4 | `../decisions/analysis/dd-44-invite-token-analysis.md` |
| DD-45 | **Model hoá waitlist** → ✅ first-entry open/approval full→waitlisted không tạo charge/new-obligation/venue; DD-49 rejoin chưa-refund chỉ carry aggregate lịch sử, còn refunded **defer lifecycle mới tới activation**; state-shape/total order; promotion first-activation tạo đúng một charge, rejoin re-derive disposition rồi carry-over hoặc append lifecycle trong canonical aggregate, không tạo charge row thứ hai. Initial promotion và retry đều chạy canonical selector theo current queue order, `evaluateSessionEligibility()` + DD-42 restriction + shared `evaluateJoinRestriction()` DD-52. Một **failing capacity opener** lazy-create đúng một `promotion_retry_id`/CAS-lease job keyed `(tenant_id,session_id,origin_command_id)` khi gặp DD-39 failure đầu tiên; opener không failure thì không tạo job. Job tối đa 3 **claimed sweep attempts**; attempt hoàn tất mới là full sweep. Partial unique cho phép tối đa one nonterminal root/session. Claim là short job-only tx; mọi domain path lock `session→root job→candidate/finance`, verify opaque generation/token + live lease. Expired final claim được finalize dưới `session→job`: retry không còn applicable thì `resolved`, còn applicable thì `terminal`+owner-review/DLQ; không domain derivation/attempt thứ tư. New opener supersedes old roots; any path filling capacity resolves them. DD-39 candidate events chỉ audit+alert refs; sibling failure không tạo job/budget, retry command ID không thay root origin | ✅ Chốt (2026-07-13; integrity re-check 2026-07-19) · **schema `0014_players_waitlist` đã merge vào `main` tại `1a6ac38`**; status/position invariant đã implemented, nhưng chưa có SessionService/promotion worker; queue-entry-version/retry-job/consumer/DLQ và behavior DD-39/41/42/52 + DD-49 correction core vẫn pending | P2/P4 | `../decisions/analysis/dd-45-waitlist-analysis.md` |
| DD-45a | **Uniqueness của `waitlist_position`** → promotion slice phải thêm partial unique `UNIQUE (session_id, waitlist_position) WHERE status='waitlisted'` bằng migration monotonic mới. Preflight duplicate trước DDL; có duplicate thì HALT/manual, không tự renumber; gaps hợp lệ. Session lock là allocator, unique index là final fence. Khi migration land, fixture duplicate đổi thành duplicate-rejection; `ORDER BY position,joined_at,id` chỉ còn compatibility/defense | ✅ Engineering chốt (owner 2026-07-28); current runtime `0014` vẫn representable duplicate cho tới promotion slice, không đổi migration/test trong docs-only update này | promotion slice (P2/P4) | `../decisions/analysis/dd-45-waitlist-analysis.md` §6 · `../features/BE/feature_session_management_tech.md` §4 · `../../packages/db/src/waitlist-invariants.test.ts` |
| DD-46 | **Kèo không thuộc CLB (Skip Club)** → ✅ **Option B "personal tenant"** (auto-provision, free, `tenants.kind`; giữ tenant_id NOT NULL; CẤM nullable) | ✅ Chốt (2026-07-13) | P4 | `../decisions/analysis/dd-46-skip-club-analysis.md` |
| DD-47 | **Social follow graph** → ✅ framework: global-protected `person_follows`, no table grant, narrow `SECURITY DEFINER`, state-idempotent, actor session-bound, merge lock+dedupe | ✅ Chốt framework (2026-07-13) | P4+ | `../decisions/analysis/dd-47-follow-graph-analysis.md` |
| DD-48 | **Profile visibility** → ✅ framework: new user public/existing private; sourced social whitelist; self + host operational routes tách riêng; fail-closed, không nới RLS/tiền; DD-55 đã đóng DM+block, còn **3 open item lúc build** | ✅ Chốt framework (2026-07-13; items 3/4 closed 2026-07-17) | P4+ | `../decisions/analysis/dd-48-profile-visibility-analysis.md` |
| DD-49 | **Money correction lifecycle** → host đổi giá chọn per-change (append signed obligation adjustment HOẶC grandfather; không auto chuyển tiền); host cancel đã thu → hoàn toàn bộ; player leave đã paid → hoàn theo policy CLB (toàn bộ/một phần/không), player được request refund; **rejoin = join logic thường**. Chưa refund → carry-over obligation/allocation (không double charge). Đã refund + active outcome → append lifecycle mới trong canonical aggregate; nếu full→waitlisted thì **chưa ghi lifecycle/nợ mới**, re-derive và append lúc activation. **Không mặc định tạo row `charges` thứ hai**; storage/API chờ mutation-path design-probe | ✅ Chốt policy (2026-07-16; timing clarified 2026-07-19) | P2/P3 | SES-OQ-1 · PAY-OQ-3 · `../decisions/briefs/founder-decision-brief-2026-07-15.md` Item 3 |
| DD-50 | **Phase-1 không thu SĐT** → verified email bắt buộc; Google chỉ là strong proof khi OIDC signature/issuer/audience/nonce/time claims hợp lệ **và `email_verified=true`**; khoá mạnh HR4 cho claim-có-nợ = verified account email (web) hoặc `link_code` deterministic dùng-một-lần (bot/web); link issuer là exactly-one channel identity/account; consume read-only resolves candidate then locks issuer/account/Person parent **before** code row; KHÔNG claim bằng tên/alias; phone fields dormant; SMS OTP không dùng phase-1 | ✅ Chốt (2026-07-16; issuer v1.45; cross-flow lock order v1.73) | P3.5/P4 | Điều chỉnh DD-01 · HR4 · ID-OQ-1 |
| DD-51 | **Host Pro lifecycle** → trial 14 ngày (remind trước 2 ngày, hết → khoá ngay về free); invoice trễ → grace **7 ngày** rồi suspended; huỷ giữa kỳ → **hoàn toàn bộ nếu request trong 7 ngày kể từ khi thanh toán, sau 7 ngày không hoàn** (dùng nốt tới hết kỳ); manual override = PlatformAdmin only, max 7 ngày, bắt buộc reason+ticket_ref+expires_at+audit, auto-expire | ✅ Chốt (2026-07-16) | P5 | BIL-OQ-2 · DD-29 · `../decisions/briefs/founder-decision-brief-2026-07-15.md` Item 2 |
| DD-52 | **Guest→full + manual ban** → host invite/approve **và** player-request+host-approve coexist (auto-upgrade defer); manual safety ban = TenantOwner + co-admin có capability `member.ban`, bắt buộc reason+evidence, expires_at hoặc permanent, **không auto-evict** active/waitlisted (waitlisted giữ queue + skip theo DD-45); storage tách khỏi reliability-ban DD-42; mọi join path qua một `evaluateJoinRestriction()` core | ✅ Chốt (2026-07-16; actor amended DD-56/v1.37) | P4.3 | CCJ-OQ-2 · ID-OQ-3 · `../decisions/briefs/founder-decision-brief-2026-07-15.md` Item 4 |
| DD-53 | **Identity recovery + merge-split authority** → PlatformAdmin freeze ngay (1 người); split plan chỉ PlatformAdmin tạo; apply cần **2 approval độc lập**; break-glass 1 người chỉ khẩn cấp (ticket+expiry+immutable audit+hậu kiểm); recovery cần strong proof (verified email/recovery artifact — theo DD-50); split map rõ channel/membership/player/charge, **không rewrite bank_transactions/allocations**; SLA freeze ≤4h, plan ≤1 ngày làm việc | ✅ Chốt (2026-07-16) | Trước production S8 | ID-OQ-2 · ID-MERGE-1 · RTE-OQ-2 · `../decisions/briefs/founder-decision-brief-2026-07-15.md` Item 9 |
| DD-54 | **PII collection theo platform config** → giữ code logic hiện tại; PII *optional* (gender/DOB…) thu thập theo **config trên CMS admin dashboard** (PlatformAdmin bật khi cần); PII *bắt buộc vận hành* (email verified, display name, bank ingest) không config-off. Config KHÔNG thay legal review A3 | ✅ Chốt (2026-07-16) | P4 | USR-OQ-3 (partial) · SEC-OQ-2 giữ mở |
| DD-55 | **In-app DM policy + media** → phase-1: mọi user DM được nhau **chỉ khi một canonical safety core đã enforce tại request/create/send/read**, cùng block + report + per-sender/per-target rate-limit/abuse audit; phase-2 follow/request-box; media full stack; host/support KHÔNG đọc DM | ✅ Chốt policy + hard safety gate (2026-07-16; bootstrap closure v1.45) | P4 chat slice | CHT-OQ-1 · CHT-OQ-3 · DD-38/47/48(3) |
| DD-56 | **Co-admin capability** → một action registry canonical, **không blanket inherit owner**. Live role `admin` và `co_admin` cùng map least-privilege co-admin preset, không role nào được suy thành owner. Default allow: session/content, routine member ops, money read, manual mark-paid có DD-25 confirm/audit, manual ban/unban và bốn exact Chat keys. Default owner-only: role management, money correction/refund/waiver/void, bank-account/payment-connector secret, billing plan/cancel/refund. Owner có thể grant từng sensitive capability (trừ role management) bằng tenant-private expiring/revocable grant; mọi grant/revoke ghi append-only audit; global DD-51/53 vẫn PlatformAdmin-only | ✅ Chốt matrix (2026-07-16; legacy-admin mapping + runtime owner pinned 2026-07-28); chưa runtime | `tenant-capability-authority-core` trước mọi Chat capability consumer | RTE-OQ-1 · amend DD-52 · primary Chat plan |
| DD-57 | **FE architecture principles** → server-first, feature-first, 4-state. Client Component không import/gọi DB hoặc `tenantRepo`, phải qua web boundary; Server Component/Route Handler được gọi canonical authenticated application service trực tiếp, không bắt buộc self-HTTP; service sở hữu authz/DTO/RLS/repository | ✅ Chốt FE governance (owner 2026-07-28); activate trước product FE, không chặn Session BE | Docs/P1 FE | `frontend-architecture.md` |
| DD-58 | **FE design→code pipeline** → canonical `design.pen → handoff → token-mapping → code → screenshot verify`; Pencil-only; source comment ở screen/feature visual owner hoặc shared primitive, không bắt mọi atom; mỗi screen cần tracked owner-approved node + Reviewed feature spec | ✅ Chốt FE governance (owner 2026-07-28); per-screen gate vẫn đóng tới đủ authority | Docs/P1 FE | `../channels/web/frontend-pipeline.md` · `../templates/feature-dev/fe-*-template.md` |
| DD-59 | **Design-token benchmark + usage-token governance** → `standards/design-tokens.md` là value SoT; benchmark chỉ là evidence advisory, không bịa số; chỉ thêm usage/component alias từ screen owner-approved hoặc state thực sự tái dùng; `design.pen` variables phải khớp SoT, muốn đảo authority cần DD + exporter/drift proof riêng | ✅ Chốt FE governance (owner 2026-07-28); không thay active token values trong docs-only update | Docs/P1 FE | `design-tokens-benchmark.md` · `token-needs-matrix.md` |
| DD-60 | **API reference convention** (adopt từ Sporta) → auth-level legend (⬜✅🔑🔒) + endpoint block format + envelope chuẩn; thống nhất §API Contract của BE tech specs | ✅ Chốt (owner 2026-07-18) | Docs | `api-reference-convention.md` · ported Sporta |
| DD-61 | **Feature Session Organize** → aggregate tenant-private hang off `sessions`/`players`, v0.4 chỉ contest **hai phía**; participant stint giữ lịch sử với partial unique trên row `assigned`; chuẩn bị khi session open/chưa end, start/score chỉ trong `[starts_at, ends_at)`; migration mới + same-tenant/session FK + unique live-court/live-set, không sửa migration lịch sử | ✅ Accept in-principle (owner 2026-07-18; build post-P4, phased) | post-P4 | `../features/FE/feature_session_organize.md` · `../features/BE/feature_session_organize_tech.md` |
| DD-62 | **Live scoring per-point** → `match_sets` read model + `score_events` ledger chỉ `point\|reversal`, append-only bằng grant+trigger; mọi mutation durable-idempotent qua `processed_commands`; correction = reversal + replacement point cùng transaction; terminal-point correction chỉ trước session end, latest effective point, no dependent action, fail-closed nếu court đã reassigned; guarded SSE DD-07 | ✅ Accept in-principle (owner 2026-07-18; build post-P4, phased) | post-P4 | `../features/FE/feature_session_organize.md` §4–6 · `../features/BE/feature_session_organize_tech.md` §2–4 · DD-07 |
| DD-63 | **Assign-to-court engine 4 mode** ở `packages/core/src/organize/assign.ts`; preview thuần + `basisVersion`, apply revalidate dưới session lock. `balanced` thiếu source level đáng tin → deterministic random + warning, không tự chế rating store | ✅ Accept in-principle (owner 2026-07-18; build post-P4) · 🔗 balanced degrade tới khi có level source | post-P4 | `../features/FE/feature_session_organize.md` ORG-OQ-3 · DD-41 · DD-08 |
| DD-64 | **Privacy/authz/realtime organize** → không public — **trừ ngoại lệ self-aggregate của chính actor trên activity card (amend 2026-07-19, DD-74)**; active player đúng session mới read; `session.organize` và `session.score` là grant session-scoped độc lập, không imply nhau; exact action registry/rate buckets; active SSE re-authorize trước event và heartbeat ≤30s, đóng khi grant/session hết hiệu lực; không serialize actor/PII/tiền/venue; không tự đổi attendance | ✅ Accept in-principle (owner 2026-07-18; build post-P4, phased) | post-P4 | `../features/FE/feature_session_organize.md` ORG-OQ-4 · DD-42 · DD-56 |
| DD-65 | **Messenger topology hybrid** → một Meta App; **Page Plexco trung tâm luôn có**, Page riêng per-club là tuỳ chọn. Cả hai Page là surface đầy đủ cho host + player; App Secret là deployment secret cấp App, Page registry chỉ sở hữu Page access token trong protected store | ✅ Chốt (owner 2026-07-17; secret ownership v1.45) | P2.5 | owner 2026-07-17 · thay Page-per-club-only assumption của DD-37 docs |
| DD-66 | **Messenger shared role-aware surface + fail-closed routing** → tenant Page pin default club; central Page resolve context bằng signed/opaque action, public session ref hoặc server-side picker. Không lấy tenant từ free text/client body; mọi host/player action qua cùng capability registry + domain service | ✅ Chốt (owner 2026-07-17) | P2/P2.5/P4.3 | owner 2026-07-17 · DD-27 · DD-56 · DD-05 |
| DD-67 | **Channel identity/reachability theo provider endpoint** → identity unique `(platform, provider_scope_lookup_hash, platform_user_lookup_hash)`; Messenger HMAC scope Page, Zalo HMAC scope bot/OA cho tới khi DD-15 chứng minh rộng hơn; reachability gắn `channel_identity_id`. Delivery chọn một route, bind đúng Person của intent và không broadcast trùng | ✅ Chốt (owner 2026-07-17; generalized v1.45; integrity closure v1.54) | P2.5/P3.5 | owner 2026-07-17 · DD-15 · DD-50 · DD-32 |
| DD-68 | **Messenger interaction contract** → host create-session wizard dùng một durable pre-dispatch interaction owner; player/host choices dùng opaque action TTL+snapshot+version, phân trang bounded; re-authorize/revalidate tại consume; E2E hai tenant/hai Page là merge gate | ✅ Chốt (owner 2026-07-17) | P2/P2.5 | owner 2026-07-17 · DD-24 · DD-41 · DD-45 |
| DD-69 | **Định vị app-native + PWA stepping-stone** → Plexco là app-first; **phase-1 target = web app PWA** (S9/S20 đã plan, chưa live), **phase-2 = app native**. Chat Zalo/Messenger = acquisition 0-install; native = retention. Technical proposal: RN+Expo sau spike; client-safe contract boundary; bearer auth có Apple/equivalent iOS gate; native push tách `device_push_subscriptions` khỏi DD-67 ChannelIdentity; offline v1 read-only. Native NGOÀI phase-1 committed scope; không đảo DD-10/DD-37 | ✅ Định hướng accepted (owner 2026-07-18); technical gates (framework/platform/contract) mở tới phase-2 | phase-2 (post-P6, TBD) | owner 2026-07-18 · BRD OD-20 · `../decisions/analysis/dd-69-app-native-analysis.md` |
| DD-70 | **Notify person-directed GLOBAL — chọn phương án** → (a) GLOBAL PROTECTED `person_notifications` + explicit reads, hay (b) SSE person-self không lưu bền. Tenant intents remain durable source. Option (a): phase-1 chỉ `follow_request\|identity_link\|identity_merged\|security_alert` (**không** `follow_accepted`); structural source-event replay fence, owner-derived same-transaction emit, signed visible-ref read-state + synchronous visible-set mark-all under per-Person fence; no blanket grant/watermark/pending batch/global-via-tenant-outbox fallback. Security route requires a factor established before immutable `trigger_context_started_at`; global attempt owner still gates enablement. **✅ Owner chốt hướng (a) (2026-07-21): notification = năng lực toàn Plexco, inbox hợp nhất xuyên club + user config per-type; giữ HAI plane (tenant RLS + global protected) merge ở service layer, KHÔNG gộp một bảng bỏ `tenant_id`; thêm `notification_preferences` theo Person** | ✅ Chốt hướng (a) (owner 2026-07-21); schema/preferences chi tiết chờ build | P4+ | `../features/FE/feature_notifications_reminders.md` NTF-OQ-6 · DD-47 · DD-38 · DD-48 |
| DD-71 | **Announcement tier + proof-bound preview/confirm** → đề xuất manual basic free; `host_pro` automation/scheduling/analytics/quota cao hơn. Durable structural tenant+actor+fan-out reservation commits with canonical announcement; immutable proof-bound fan-out. Retry-failed has actor receipt + per-intent deterministic policy-ranked route result, fresh authorization and one-route CAS; report splits routed attempts from skipped intent reasons. **✅ Owner chốt (2026-07-21): announce cơ bản FREE mọi tier; `host_pro` thêm scheduling/recurring/template/analytics/quota; preview→confirm bắt buộc (proof-bound, không undo được — KHÔNG phải DD-25)** | ✅ Chốt (owner 2026-07-21) | P4+ | `../features/FE/feature_notifications_reminders.md` NTF-OQ-9 · DD-43 · DD-40 · BL-NTF-4 |
| DD-72 | **Web Push phase-1 schema + delivery provider** → only **web** subscriptions; native waits DD-69 spike. Required actor-scoped external Idempotency-Key + signed actor/command/JTI envelope, durable exact-replay receipt, serialized key-epoch rotation, proof-bound cross-Person **transfer to a new subscription UUID** and trust-epoch reset/elevation. Only a newly accepted external command resets trust; envelope JTI is a replay fence, not another reset trigger. Direct Web Push/VAPID, worker-only secret resolver + claim/start/finalize lifecycle. Ambiguous-after-write=`unknown`; stable Topic and attempt-ref telemetry/report replay fences. **✅ Owner chốt (2026-07-21): schema phase-1 CHỈ web (native chờ DD-69 phase-2), global protected/Person, endpoint+keys mã hoá; provider = Web Push chuẩn qua VAPID trực tiếp, không vendor SDK; payload OS generic (opaque ref + i18n_key), không tenant/tiền/PII/tên CLB** | ✅ Chốt (owner 2026-07-21) | P4 (slice S9/S20) | `../features/FE/feature_notifications_reminders.md` NTF-OQ-13 · DD-69 · DD-67 |
| DD-73 | **Share link + preview card cho session** → share link **KHÔNG phải capability**, tách khỏi invite DD-44; renderer OG chỉ đọc guarded public view (`public_sessions` + denial-only safety fence, không canonical); CTA không cấp quyền join mà Join service phải revalidate canonical live; opaque funnel telemetry là hard requirement cùng slice | **Q5 re-scope: fence/guarded-view/grant migration → DD-12**; DD-73 = route+OG+telemetry. ✅ Chốt (owner 2026-07-19) · build gated | P4.3 (theo DD-12) | `../decisions/analysis/dd-73-78-share-activity-analysis.md` · DD-44 · DD-12 · DD-06 · **DD-41 projection migration** |
| DD-74 | **Activity per player = read model, không phải fact table mới** → derive từ `players ⋈ sessions` (+ DD-42); chỉ verified **Person-self** publish khi session ended + attendance=`present`; v1 chỉ scheduled aggregate, v2 additive; club attribution: **phase-1 KHÔNG gắn tên CLB** (không setting/field/fence target attribution; dual-consent = additive sau); **không co-participant phase-1** | ✅ Chốt (owner 2026-07-19) · sau dependency + reprioritization, không bị social evidence gate chặn | Sau P4 (v2 post-P4) | `../decisions/analysis/dd-73-78-share-activity-analysis.md` · DD-42 · DD-50 · DD-61/62 · DD-48 #5 |
| DD-75 | **Publish lifecycle/audience + projector-owned snapshot** → tenant intent tách `draft/published/revoked` khỏi audience + `publication_version` monotonic; correction event chỉ wake reconcile, projector lock + re-read current multi-aggregate sources; global snapshot có deterministic provenance + `card_state` riêng; privacy mutation raise denial-only fence đồng transaction; hash-only slug registry giữ old URL tombstoned | ✅ Chốt (owner 2026-07-19) · đi cùng DD-74 để tạo baseline, không bị social evidence gate chặn | Sau P4 | `../decisions/analysis/dd-73-78-share-activity-analysis.md` · DD-47 grants · DD-41/42/62 correction |
| DD-76 | **Feed hoạt động (follow)** → fan-in hoàn toàn trong global plane, keyset `(published_at,card_id)`, không fan-out/cross-plane; audience + block re-evaluate mỗi read; **chỉ build sau product-evidence gate** có baseline/ngưỡng owner | ✅ Chốt (owner 2026-07-19) · build gated | P4+ sau evidence gate | `../decisions/analysis/dd-73-78-share-activity-analysis.md` · DD-47/48 · DD-55 · DD-69 · DD-70 *(optional notify only)* |
| DD-77 | **Kudos & comment** → kudos explicit add/remove idempotent, không free-text nên không cần content moderation nhưng vẫn bắt buộc block/rate-limit/abuse audit; ship sau evidence gate; **defer comment** sau DD-55 + OQ moderation riêng cho global surface | ✅ Chốt (owner 2026-07-19) · build gated | P4+ sau DD-76 | `../decisions/analysis/dd-73-78-share-activity-analysis.md` · DD-55 · DD-70 *(optional notify only)* |
| DD-78 | **Ảnh share mặc định do Plexco render** → một template system versioned + sport variants + authenticated ephemeral draft preview; không upload phase-1; public URL qua guarded origin, object store private-to-origin và tách DD-55; image key tách session/activity, old versions invalidated; publish theo eligibility DD-74 | ✅ Chốt (owner 2026-07-19) · không có queue/gate độc lập | Đi kèm consumer: card kèo cùng DD-73 (P4.3), card activity cùng DD-75 (sau P4) | `../decisions/analysis/dd-73-78-share-activity-analysis.md` · DD-48 (avatar excluded) · DD-55 · DD-06 |
| DD-79 | **Home — personal dashboard PWA** (fork từ Sporta): composition surface trên player_view person-self + marketplace whitelist + notifications §A + `onboarding_steps`; nav phase-1 = **Home · [Khám phá FAB] · Club · Setting**, Feed config-OFF, `Kèo của tôi` là Home sub-screen; không bảng/API mới ngoài aggregate DTO thuộc player_view surface | ✅ Chốt (owner 2026-07-19; nav completed 2026-07-28): composition-only · HOME-OQ-1 (c) defer host-receivable · OQ-2 landing S9 · OQ-3 defer streak | S9 (cùng PWA shell, sau P4.6) | `../features/FE/feature_home.md` v0.7 + `../features/BE/feature_home_tech.md` v0.3 · Sporta `feature_home.md` v2.5 |
| DD-80 | **Auth credential lifecycle (B0)** → provider-neutral verified email owner `account_emails` (Google + email/password chung record; password chỉ ở `email_password_credentials`; identity email tạo lúc verify, giữ `verified_at NOT NULL`); pending registration multi-attempt **verify-first** (không last-writer-wins, cookie browser-binding); Google OIDC collision table §4 (verified email = DD-50 strong proof; conflict → `AUTH_IDENTITY_CONFLICT`/DD-53, không auto-merge/silent rebind); verify/reset token 256-bit SHA-256-at-rest single-use + TTL/retention 30d + forgot qua protected outbox→pg-boss (retry/backoff/DLQ, enumeration-safe); password 15–128 Unicode + Argon2id floor m=19456/t=2/p=1 + PHC validator owner-only + dual-bucket rate limits §8.2; **revoke-all linearizable bằng account `session_epoch` + session `minted_epoch`, resolve chỉ hợp lệ khi hai epoch bằng nhau; logout-all bump epoch rồi materialize per-row revoke/count/audit cùng transaction; rotate A→B khóa cả hai parent theo UUID order và revalidate**; slice order §10: D0a epoch DB core → D0b logout-all web boundary → D1 email-token-core (dark) → D1 Google adapter (độc lập email flag) → D1 email bundle một release unit flag OFF → Telegram removal cuối | ✅ Chốt (owner 2026-07-19; G3 concurrency ratified 2026-07-20) — D0a/D0b/D1 email-token/Google/d1b đã merge qua `0015`–`0018`; Safari macOS+iOS M3 đo PASS 2026-07-26, nhưng Google login chưa có bằng chứng enable/go-live; email provider order 4 vẫn fail-closed OFF/chưa build | feature layer S4 (D0/D1) | `../probes/g3-revoke-all-concurrency-probe-seed.md` · `../probes/b0-auth-credential-lifecycle-design-probe.md` · DD-31/DD-33/DD-50/DD-53/DD-70 · `../features/BE/feature_web_auth_onboarding_tech.md` · `../features/BE/auth-security-invariant-table.md` |
| DD-81 | **Design tool + target direction** → Pencil `design.pen` ở root là canonical visual source sau khi tracked + owner-approved; target = Candidate C Energetic Orange `#FF5A1F`, Sora heading, Inter body, target `on-primary=#22100A`. Active Indigo/Outfit giữ nguyên tới khi visual/WCAG/track/approval gate PASS | ✅ Chốt direction (owner 2026-07-28); chưa `ENABLE_READY`, FE HOLD chưa mở | Đợt chốt theme (trước S9 UI) | `../channels/web/theme-direction-2026-07.md` §5/§7 · `../templates/design-system-playbook.md` · DD-58/DD-59 |
| DD-82 | **Tournament = aggregate độc lập** (không gom/không tái dùng `sessions`/`players`). v1 **gọn**: canonical `tournaments` tenant-scoped + RLS, bảng đăng ký riêng, `public_tournaments` read model (field-whitelist, không tiền/PII, không serialize `tenant_id`) cho URL share. Live schema chưa có `session_type='tournament'`; tournament cần migration aggregate mới nhưng **không có live session backfill/enum removal**. Bracket/standings/entry-fee = slice sau | ✅ Chốt (owner 2026-07-21; live-boundary corrected 2026-07-28); build chờ readiness gate + analysis/spec | P4+ (sau session core) | `decisions.md` DD-41 · DD-73/75 · HR2 |
| DD-83 | **URL scheme thống nhất + slug/handle registry dùng chung** — mở rộng registry hash-only DD-75 thành hạ tầng chung 4 loại: `/user/<handle>` · `/club/<slug>` · `/session/<slug>` · `/tournament/<slug>`; rename → tombstone link cũ; reserved words; mọi URL public **chỉ đọc guarded view**, không đọc canonical, không lộ `tenant_id`/PII. **Session dùng opaque slug** thay UUID thô → thay wording `/s/<id>` của DD-73 | ✅ Chốt (owner 2026-07-21) — session opaque slug là final; handle uniqueness + reserved-word + collision policy chốt tại build | P4.3+ (theo DD-12/DD-73) | DD-73 · DD-75 · DD-12 · feature_tenant_routing_authz |
| DD-87 | **`splitNameAmount` fail-closed ambiguity contract** → enumerate mọi positive trailing run qua canonical `parseMoney`; dedupe theo cặp `(name,amount)`; 0 candidate=`none`, 1=`resolved`, ≥2=`ambiguous` với ordered candidates. Nhánh ambiguous **không có top-level name/amount**, nên caller buộc narrow trước khi dùng; equal-amount/different-name vẫn ambiguous (`Player 0 110k`). Cấm grouped-number grammar/threshold/fuzzy heuristic | ✅ Chốt (owner 2026-07-22, yêu cầu “update hết”) — core implementation đã merge tại `d2a27e1`; hiện chỉ test gọi, chưa có production caller/consumer nên chưa phải payment runtime | P3 (trước payment reconcile) | `../decisions/analysis/dd-87-splitnameamount-decision-table-analysis.md` · BL-PAY-3 · live `parseMoney`/`splitNameAmount` |
| DD-84 | **Player public profile default-public, phase-1** (đảo scope DD-74) — mặc định public; tách field theo độ nhạy: default-public an toàn = handle (tự chọn, đổi→tombstone) + môn + karma + kudos + tổng buổi; **activity history mặc định làm mờ** (coarsened, không venue+time cụ thể, không co-participant), player tự bật chi tiết; **trẻ vị thành niên ép off** chi tiết. Cần cập nhật wording HANDOFF HR2 | ✅ Chốt hướng (owner 2026-07-21) — default-public, activity mặc định LÀM MỜ + player tự bật chi tiết, minor ép off; đảo DD-74; build chờ **child-safety review** + cập nhật HR2 wording + consent/minor model + readiness gate | P4+ (sớm hơn DD-74) | DD-74 · DD-75 · DD-83 · HR2 · HR (child-safety) |
| DD-85 | **Collision-aware display** → exact collision sau `NFKC → trim → collapse whitespace → locale-safe casefold`, giữ dấu tiếng Việt; không fuzzy/token-subset. `pay_code` là disambiguator mặc định; avatar/gender chỉ host/authenticated theo consent và avatar không public phase-1. Picker submit `membership_id`; roster collision bắt buộc explicit confirm. Không auto-suffix/auto-merge theo tên | ✅ Chốt (owner 2026-07-21; contract completed 2026-07-28); public avatar tương lai cần DD mới sau child-safety review | P4.3 (roster render) + host-add slice (chưa build) | `../00-start-here/identity-model.md` · DD-02 · DD-26 · DD-50 · DD-52/DD-56 · `../features/FE/feature_session_management.md` · `../features/BE/feature_session_organize_tech.md` |
| DD-86 | **In-app multi-channel per CLB — Option B** → giữ `kind='club'`, N channel/tenant; club-only metadata và DM-NULL shape; đúng một active default dưới tenant lock/atomic replacement; mọi active membership vào mọi active club channel; create/manage chỉ qua `chat.channel.manage`, restricted-post qua `chat.channel.post_restricted`, unknown deny; Announcements là admins-only chat channel tách DD-71; Assistant mặc định `true` cho `all_members`, `false` cho `admins_only`, mutable trên cả hai policy chỉ qua `chat.channel.manage`, và chỉ chạy khi channel flag **AND** tenant config/entitlement/provider/privacy gates PASS; actor-scoped receipt/fingerprint; creator composite; không public URL phase-1 | ✅ `DECISION_FINAL` (owner 2026-07-28); mọi product choice DD-86 đã ratify; chưa authorize migration/code. Readiness hiện hành chỉ lấy từ primary plan §13 | Root chat schema sau safety authority + Reviewed contract pack | `../decisions/analysis/dd-86-in-app-multi-channel-analysis.md` · DD-38/DD-55/DD-56/DD-71 · DD-91/DD-92..95 |
| DD-88 | **Notification grouping/message-request proposal** → taxonomy/grouping, `message_request`, scoped/bulk read và các source notification rộng hơn là một initiative riêng; không thay DD-70..72 và không sở hữu offline Chat digest DD-94 | 🟡 `DEFERRED_PROPOSAL`; không authorize migration/code và không chặn DD-94 | Reopen khi source producer/request-box/core Inbox evidence đã tồn tại | `../proposals/notification-grouping.md` · DD-55/DD-70..72/DD-94 |
| DD-89 | **Job-infra: worker access + pg-boss grant authority** → **Q1 chốt narrow SECURITY DEFINER functions**, không direct DML grant trên `projector_deliveries`/`surface_refs`; core slice chỉ thêm operation-specific delivery functions, `surface_refs` giữ zero exposure tới consumer/projector đầu tiên. **Q2 chốt controlled provisioning exception**: pg-boss tự sở hữu dynamic schema/queue-partition DDL; `provision-queue.ts` chạy bằng migration role sau app migrations và trước worker, là authority cho pg-boss DML/default grants; `app_worker` vẫn không DDL/ownership và runtime giữ `migrate:false`. **Q3** thêm index khớp `ORDER BY created_at`, không đổi ordering | ✅ Chốt (owner 2026-07-25) — `0022` core + `0023` ack, dispatcher/preflight và exact-string schedule đã implemented; schedule mặc định OFF, delivery vẫn placeholder và chưa có producer/real projector/replay nên chưa `ENABLE_READY` | Gỡ 2 owner-choice blocker; 7 BE spec dùng chung một privilege boundary | `../autopilot-manifests/db-job-claim-lease-core.json` · `../product/TDD.md:494` · `core-db-architecture-principles.md:49` (INV-8) · `deployment-infra.md:181,186` |
| DD-90 | **Job-infra implementation contract** (đóng 3 chỗ DD-89 bắt buộc nhưng chưa nói *bằng gì*; **không sửa DD-89**) → **Q4 chốt** `job_audit_events` append-only trong core, 1 row/claimed `outbox_event` với `job_id=event_id`, `tenant_id` NOT NULL, actor=`system`, reason/fn/operation; no read grant/query surface/retention job. **Q5 chốt** `job_definer` lane-specific `NOLOGIN BYPASSRLS`, exact table privileges, pre-provision bởi privileged platform bootstrap + migration assert membership/attributes; **không** thêm vào `RUNTIME_ROLES`, chỉ re-own function 0022 + `claim_outbox_batch`. **Q6 chốt** worker preflight fail-closed **trước `boss.start()`**, kiểm schema/queues/catalog grants từ `app_worker` | ✅ Chốt (owner 2026-07-25) — Q4/Q5 implemented trong `0022`; Q6 implemented ở dispatcher `fca314e`; schedule `a03d2d6` vẫn OFF và delivery chưa enable | Gỡ 3 owner choices; chặn silent RLS denial, stale role bootstrap và deploy sai thứ tự | DD-89 · `../product/TDD.md:494` · `deployment-infra.md:186` · `../features/BE/feature_inapp_chat_tech.md:221-238,235` · `packages/db/src/migrate.ts:48` · Verdict 14 |
| DD-91 | **In-app Chat primary player surface + requester-only `/pay`** → `/pay` chạy ở club, private Club Bot và requester-only human-DM overlay, synchronous authenticated `private, no-store`, không result row/ref/SSE/outbox/push/history. `/pay` deterministic, không LLM; Assistant giữ Host Pro `assistant_ai_kb`; message/slash/digest/moderation floor do DD-92..95 sở hữu | ✅ `DECISION_FINAL` (owner 2026-07-27; reconciled 2026-07-28), không authorize runtime/code | Chat/Player View/Assistant/Notification contract propagation; root và downstream slices vẫn qua readiness riêng | `../proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md` · DD-21/DD-22/DD-29/DD-38/DD-55/DD-56/DD-70..72/DD-86/DD-92..95 |
| DD-92 | **Chat interaction, edit/delete và search floor** → same-channel reply; immutable structured mentions; reactions exact `👍\|❤️\|😂\|😮\|😢\|🙏`, one active/person/message; own human body edit `<15m`, tối đa 5; author soft-delete/tombstone; beta-required authorized PostgreSQL `simple` FTS trên canonical current rows | ✅ `DECISION_FINAL` (owner 2026-07-28), không authorize runtime/code | Shared send sở hữu reply/mention atomically; reaction, edit/delete và search là các post-root slice riêng | `../proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md` · DD-38/DD-55/DD-91 |
| DD-93 | **Slash grammar/catalog theo surface** → ASCII case-insensitive canonicalization, zero alias/argument; sáu command `/help\|/pay\|/me\|/myclubs\|/discover\|/name` ở club, private Club Bot và human-DM overlay; thêm `/sessions\|/waitlist` chỉ ở club/bot; invalid/unsupported private-reject trước persist | ✅ `DECISION_FINAL` (owner 2026-07-28), không authorize runtime/code | Registry core rồi thin domain adapters | `../proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md` · DD-91 |
| DD-94 | **Offline Chat digest delivery contract** → source truth là Chat unread; zero durable item/message snapshot/body/title/amount; DM/direct mention/reply default ON; club preference `all\|mentions\|off`, default `mentions`; coalesce `(person,channel,highest_unread_cursor)`; mark-read cancels obsolete pending; live reauth ngay trước provider write; timing config enablement-only | ✅ `DECISION_FINAL` (owner 2026-07-28), không authorize runtime/code/enablement | Notification delivery slice sau Chat read model; DD-88 không phải dependency | `../proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md` · DD-70..72/DD-88/DD-91 |
| DD-95 | **Club-only moderation** → `chat.message.moderate` hide/restore và `chat.member.mute` timed `1h\|24h\|7d`; reason `spam\|harassment\|unsafe\|off_topic\|other`, bounded note cho `other`; actor-scoped receipt/fingerprint + append-only audit; mute chặn write không chặn read | ✅ `DECISION_FINAL` (owner 2026-07-28), không authorize runtime/code | `chat-club-moderation-core` land dark sau root/channel lifecycle và trước shared send; sở hữu duy nhất storage/writers/receipts/audit | `../proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md` · DD-55/DD-56/DD-91 |
| DD-96 | **Home money chips** → **Part A ✅** canonical `SelfPaymentSummary` cross-club thuộc `player_view` (Home cấm tự cộng; `feature_home_tech.md:166` đã yêu cầu mở rộng Player View owner), **unknown-dominates**: một CLB `unknown` ⇒ cả summary `unknown`, cấm sum các CLB known; `clubCount` = số CLB có outstanding > 0; không `payAction` ở tầng aggregate. **Part B 🟡** chip "Chưa thu" cross-club — owner chốt direction, đảo HOME-OQ-1(c), nhưng **không thuộc player_view** (DD-48 + DTO allowlist "other charges ❌ NEVER"); cần host-self owner riêng và còn 4 blocker B1–B4 (design-probe · `authorizeTenantAction` 0 caller · chưa Reviewed per-club owner · fan-out semantics) | Part A ✅ `DECISION_FINAL` contract shape (owner 2026-08-07), chưa authorize code · Part B ✅ direction / 🟡 `NOT_PLAN_READY` mechanism | Part A: S9 (cùng Home) sau P4.6 · Part B: sau per-club host receivable owner | DD-48 · DD-79 (HOME-OQ-1) · DD-91 · `../features/BE/feature_player_view_tech.md` · `../features/BE/feature_home_tech.md:166` · `../channels/web/FE/feature_dashboard_fe.md:59-66` |
| DD-97 | **Collection statement + export sao kê per-session/kỳ (PDF/XLSX)** → composition-only trên `charges`+`payment_allocations` (không bảng/formula tiền mới; DTO cần owner Reviewed — cùng họ blocker B3 của DD-96); export async behavior-contract-only trên DD-89 foundation (không authorize enablement); download authenticated tenant-scoped, không public link (HR2); entitlement ✅ tách lớp: per-session statement view = **free** · kỳ/tháng + export file = **`host_pro`** | ✅ Direction + entitlement chốt (owner-delegated 2026-08-07) · mechanism chờ DTO owner Reviewed | P5+ TBD | `../research/sporta-payment-fe-port-analysis-2026-08-07.md` · DD-89 · DD-40 |
| DD-98 | **Negative scope cho mechanic Sporta không port** → không theo đuổi: custom split per player (đụng derivation DD-39/41/45/49) · timeout-hold release cho linked member (DD-32 Option D giữ pay-later) · OS push kèm tiền/QR (mirror NTF — đã cấm sẵn) · auto-archive "nợ cũ" theo tuổi · geo/radius/distance/map picker (NP-5 — mâu thuẫn DD-06 area-only public) | ✅ Chốt (owner-delegated 2026-08-07) | — | `../research/sporta-payment-fe-port-analysis-2026-08-07.md` · `../research/sporta-fe-docs-gap-2026-08-07.md` · DD-06/32/39/49 |
| DD-117 | **`Close`/`Cancel` nhánh paid/retry-root = fail-closed REFUSE** (mã lỗi lớp `CANCEL_REQUIRES_REVIEW`) cho tới khi subsystem payments/review_policy land; **thay** phần deferral của disposition 14/08 (`session-commands-update-close-cancel`); **KHÔNG** authorize subsystem đó / migration / route / FE. Literal `update_open_session`/`close_session`/`cancel_session` vào `ActionClass` theo DD-110 D3 (cùng commit mang command). An toàn hôm nay vì paid roster/retry root **chưa reachable** trên `main` (chưa có join/waitlist/payments); refuse ép đường review tồn tại TRƯỚC khi paid reachable. DD-112 capacity giữ ⬜ — chỉ `CAPACITY_BELOW_ROSTER`, không couple `impact_policy`/DD-49. **D5 (bổ sung 2026-08-25):** cả họ lệnh session dedup trên `(tenant_id, command_id)` **DUY NHẤT** — content fingerprint **BỊ TỪ CHỐI** (không lưu verifier phái sinh PII, không kéo surface KMS chưa pin); Slice A HALT MAX_ROUNDS trên fingerprint P1, successor bỏ fingerprint | ✅ Chốt (owner 2026-08-25) · 🔧 D5 bổ sung (2026-08-25) | P2/P4 (session management) | disposition 14/08 · DD-110 · DD-111 D4 · DD-112 · DD-105 · edge #5 (`../features/BE/feature_session_management_tech.md:215`) |
| DD-116 | **Lệnh FE PENDING (13/08) → đưa vào decision log** → order chặn **100% launch scope DD-113** từng chỉ sống ở `../autopilot-templates/next-lanes-2026-08-13-RUN.md` + mirror (đúng thứ DD-111 D4 cấm); **DD-116 nay là nguồn bền**. Owner chọn **Option B — KEEP**: PENDING giữ nguyên, gỡ **chỉ** khi named trigger đủ **CẢ BA** — (a) owner chọn canonical design file (`design.pen`/`fe.pen`, đúng một) · (b) file đó tracked trên `main` · (c) owner ký nghiệm thu design authority trong `decisions.md` (đóng gate DD-81). Khi gỡ ⇒ authorize FE **bounded đúng 5 khối launch DD-113**, mỗi lane vẫn qua Level 3 + readiness gate. Không sự kiện nào khác gỡ. Không đảo DD-113 D5 / DD-69 | ✅ Chốt Option B (owner 2026-08-24) | Launch (DD-113) — chặn tới khi named trigger đủ 3 điều kiện | `../standards/decisions.md` DD-116 (nguồn bền) · `../autopilot-templates/next-lanes-2026-08-13-RUN.md` (lịch sử) · DD-111 D4 · DD-113 D5 · DD-81 · DD-69 |
| DD-115 | **Membership — gói hội viên chu kỳ 30 ngày cho player** (D1–D5 ✅, D6–D8 ⬜) → player chọn ngày bắt đầu, hệ thống đếm buổi theo lịch cố định trong 30 ngày, thu **một lần** đã chiết khấu. **D1** lớp thương mại **trên** `memberships`, không thêm cột vào bảng đó. **D2** model là **N charge đã chiết khấu + 1 giao dịch allocate sang N charge** — `charges.session_id` NOT NULL + `charges_tenant_session_player_uq` khiến "một charge tổng" phải sửa bất biến đường tiền, **bác**. **D3** số buổi **đo từ `sessions` thật**, cấm nhân số tuần (đo: start 23/08/2026 ⇒ T3+T5=8 nhưng T7+CN=9 ⇒ cả tháng=**17**, không phải 16 như requirement giả định). **D4** config gói có **version, immutable per version**; không dùng `settings` (không version/audit) và không dùng `membership_tags` (DD-43/BL-SES-7 cấm tag tạo giá). **D5** quyền lợi fail-closed, chỉ mở sau khi tiền phủ đủ. ⬜ **D6** quyền vượt `slots_max` là **ngoại lệ với BL-SES-2/BL-CBF-3** ⇒ Tier C. ⬜ **D7** bind allocation vào chu kỳ là **ngoại lệ với BL-PAY-5 FIFO**. ⛔ **D8** chiết khấu phí giải đấu chặn ngoài bởi DD-82 (`tournaments` chưa tồn tại, v1 không đụng tiền). 10 OQ, trong đó **D6 + D7 là blocker cứng trước build** | ✅ Chốt D1–D5 (owner 2026-08-25) · ⬜ D6–D8 | P4+ — **ngoài phase-1** (DD-114 D7) | `../features/FE/feature_membership.md` v0.1 · `../features/BE/feature_membership_tech.md` v0.1 · DD-02 · DD-39 · DD-40 · DD-43 · DD-82 · BL-PAY-2/5/8 · BL-SES-2/3 · BL-CBF-3/5 |
| DD-114 | **Phase-1 feature scope = 7 nhóm; launch (DD-113) là subset** → 1 signin/signup Google · 2 create club · 3 link club ⇄ Zalo bot · 4 link account ⇄ Zalo · 5 sync data + owner config public/private · 6 session management/detail + nhắc nợ/gạch nợ · 7 settings/privacy. **Hai hard dependency:** vế tiền chỉ `host_pro` (DD-40/DD-29) ⇒ **billing P5 + reader đầu tiên của entitlement registry vào phase-1**; toggle public/private chỉ mở **sau khi land `public_projection_fences` (8a, nợ DD-12)**. A3 legal thành blocker phase-1. ⬜ OQ: public để làm gì khi chưa có discovery | ✅ Chốt (owner 2026-08-22) | P0–P5 (trừ discovery/chat) | DD-113 · DD-40/DD-29 · DD-32 Option D · DD-12/DD-73/DD-41 · `../probes/pre-code-open-items-2026-07-16.md` A3 |
| DD-113 | **GTM re-sequencing: launch = webapp PWA + Zalo bot song song; app native lùi về phase sau** → web hết vai "fallback"; PWA v1 đúng 5 khối (signin/signup · link Zalo bot · session management · session detail · settings); negative scope launch gồm discovery/chat/feed/auto-reconcile/web push/fill-slot/native; gate native viết thành ngưỡng đo được. **Không** gỡ FE PENDING 13/08, **không** đảo DD-69 | ✅ Chốt (owner 2026-08-22) | — (GTM/surface order, ngoài P-number) | `../strategy/gtm-strategy.md` (rewrite 22/08) · DD-69 · `../strategy/native-app-strategy.md` §1 · `../decisions/analysis/dd-69-app-native-analysis.md` |
| DD-109 | **Nới `fix_rounds_max` 5 → 8 cho RIÊNG `session-draft-lifecycle-commands--v3`** → `PublishSession` HALT `MAX_ROUNDS` hai lần (v1, v2; 11+ vòng). Bằng chứng nói **không phải thrash**: `regions.log` v2 = 5 vòng / **5 vùng khác nhau**, `REGION_THRASH` không bắn. Nguyên nhân thật: reviewer đọc `git diff <base>...HEAD` = **toàn bộ 1.690 dòng mỗi vòng**, miss-rate đo được **≈2/3** ⇒ mỗi vòng là một lần **lấy mẫu**, finding mới là chữ ký **under-sampling** chứ không phải slice sai. Hệ quả: thu hẹp *việc* của successor KHÔNG thu hẹp *bề mặt review*. Chọn 8 vì `(2/3)^M`: M5≈13% → M8≈3,9% (ước lượng có căn cứ, không phải phép đo). **Điều kiện cứng:** v3 PHẢI tới được vòng security (chưa attempt nào chạm tới, dù slice gọi `authorizeTenantAction`); v3 HALT nữa = bằng chứng quyết định cho slice-too-big ⇒ **re-slice thật, cấm lần bốn**; `REGION_THRASH` giữ nguyên. Ngoại lệ MỘT lane, khuôn DD-101; §8 không đổi cho lane khác. | ✅ Chốt (owner 2026-08-14) | — | `../autopilot-templates/level3-workflow.md` §8 · DD-101 · `../decisions/analysis/codex-reviewer-determinism-2026-08-13/` |
| DD-108 | **Trust-gate file: mirror canonical + version phải ĐO được** → (1) mirror E1 sang canonical đủ **ba vế** (copy · `pack_pairs()` · bump `KIT_VERSION`); (2) fix gốc rễ: `KIT_VERSION` gõ tay không đổi khi nội dung đổi ⇒ **test phải đỏ khi hai bản phân kỳ** (assert byte-identical mọi `TRUSTED_GATE_FILES`, hoặc dẫn xuất version từ content hash); (3) **chặn `autopilot-update.sh`** tới khi (2) land. Căn cứ: footgun lần **thứ hai** cùng chỗ, và đo được **cả hai kit cùng `KIT_VERSION: 31`** — hai file khác nội dung, cùng số hiệu. | ✅ Chốt (owner-delegated 2026-08-14) | — | `../autopilot-backlog.md` → `reviewer-isolation-backport-canonical-kit` (tiền lệ) · E1 `a3c62ad` |
| DD-107 | **Autonomy mode `autonomous_to_ready` + context/authority protocol** → lane chạy thẳng tới READY **không dừng hỏi owner giữa chừng**. Context = **toàn bộ doc corpus thuộc phạm vi** nhưng ~2 triệu token nên **không nạp được** ⇒ luật là **bảo đảm độ phủ, không phải đã nạp**: luôn nạp lõi nhỏ (HANDOFF live-truth + bảng tổng hợp `decisions.md` + gate + packet), phần còn lại **search rồi GHI LẠI query** (kể cả query rỗng — grep rỗng là bằng chứng về query, không phải về repo). Kèm **thang authority 7 bậc** để tự giải mâu thuẫn: runtime truth > migrations/`schema.ts` > `decisions.md` > spec Reviewed > Draft/plan > ROADMAP/BRD/PRD/TDD theo câu hỏi > index/summary. Owner review **một lượt tại READY** qua Decision Ledger, thay vì bị ngắt từng quyết định. Ba tầng thẩm quyền: **A derivable** (agent quyết, log 1 dòng — dừng ở tầng này là defect) · **B judgment/reversible/in-scope** (agent quyết, log đủ alternatives+lý do, owner review batch) · **C reserved** (vẫn AWAIT — 8 mục: money contract · PII/HARD RULES · sửa contract của spec Reviewed · migration đổi semantics hoặc chung tail · enablement · merge/deploy · vượt negative scope · finding bị phản bác). Budget thành **tín hiệu, không phải cổng**. HALT successor pre-authorized khi finding được chấp nhận + gọi tên được nguyên nhân *thiết kế*. **Không đổi:** worktree isolation, scope-gate, 2 vòng review sạch, loop breaker, **human merge**. | ✅ Chốt (owner 2026-08-14) | — | `../autopilot-templates/level3-workflow.md` §6.1 · DD-100 |
| DD-106 | **Ba hợp đồng do spec pass 12/08 (`692f9f2`) viết thẳng vào spec đã Reviewed mà không có decision** → Q1 **Pay-for-Buddy** (bảng `buddy_payment_requests` + `payment_allocations.source='buddy'` — ĐƯỜNG TIỀN); Q2 **structured embed** (`chat_messages.embed_type/embed_ref_id/embed_snapshot` — schema thêm sau khi `0031` đã land); Q3 **unified `SessionCard`** (contract hiển thị dùng chung bot/web/home). Ba câu độc lập, chốt riêng được. | ✅ **Đã phân xử từng câu** (owner-delegated 2026-08-14): **Q1 ⬜ DEFER + bác enum `'buddy'`** (`created_by` đã có sẵn ⇒ `('cash'\|'manual', created_by)` biểu diễn được, chưa chứng minh cần giá trị enum mới trên đường tiền) · **Q2 ⬜ DEFER ràng buộc vào fence** (không thêm projection thứ hai trước khi `public_projection_fences` land) · **Q3 ✅ chấp nhận hướng**, pin canonical ở marketplace spec, chưa phải contract | P3/P4 | `../features/FE/feature_payment_reconcile.md` §5/§7 · `../features/BE/feature_payment_reconcile_tech.md` §2/§3 · `../features/BE/feature_inapp_chat_tech.md` §302-311 · `../features/FE/feature_channel_booking_funnel.md` §150 |
| DD-105 | **Suspension gate cho `CreateSession` — miễn theo TÍNH VÔ HÌNH của draft (KHÔNG phải miễn theo "mutation nhỏ")** → ma trận Suspended Action (`feature_billing_lifecycle_tech.md:273`) có hàng `Admin mutation \| suspended ❌`, nhưng action-class literal cho session hôm nay chỉ có `publish_new_sessions` (DD-104 thêm `delete_draft_session`) — **KHÔNG có literal cho create**. Owner chốt phương án (b): `createSession` **KHÔNG** gọi `authorizeTenantAction` (create-draft ungated). Miễn trừ **bounded** tới đúng command có hiệu ứng **(a) vô hình tới khi publish VÀ (b) không đụng tiền**; publish/announce/close/cancel/update-on-`open` (player-visible) hoặc chạm `charges` vẫn dưới ma trận và nhận narrow per-op action class khi build (tiền lệ DD-104 D2a). Fail-closed vẫn nguyên vẹn tại ranh giới thật (`publish_new_sessions` ❌ khi suspended). | ✅ Chốt (owner 2026-08-13) | P2/P4 (session management) | `../features/BE/feature_billing_lifecycle_tech.md` §3 · `../features/BE/feature_session_management_tech.md` §4 · DD-104 D2a · `../autopilot/contracts/autopilot-session-service-create-command-core.md` §7 B4 |
| DD-104 | **`DeleteSession` hard delete — cơ chế cascade mà spec dựa vào KHÔNG tồn tại** → `feature_session_management_tech.md` v2.20 (WIP, chưa commit) thêm command `DeleteSession` + `DELETE /api/sessions/:id`, algorithm bước 5 khai *"FK cascade xóa `players`, `session_surface_refs`, `session_occurrences` tự động"*. **Đo 2026-08-11: 9 FK trỏ tới `sessions`, ZERO khai `ON DELETE CASCADE`** ⇒ mặc định `NO ACTION` ⇒ `DELETE FROM sessions` ném FK violation ngay khi có child row, mà draft có người tham gia thì đã có `players` row. Ba quyết định: **D1** có chấp nhận hard delete và trả giá bằng sửa 9 FK (gồm `charges` → cascade xuống sổ tiền, chạm HARD RULE *claim-có-tiền cần khoá mạnh*), hay chỉ xoá khi không còn child row, hay bỏ hard delete; **D2** nếu hard delete thì charge `pending`/`failed` của mọi người và charge `paid` **của host** sẽ bị xoá — guard hiện chỉ chặn `paid` của player ngoài host; **D3** ai được xoá (spec tự mâu thuẫn ba chỗ). **Amendment 2026-08-13: owner chốt D0–D4 theo decision table** — D1a mọi FK `NO ACTION` chặn (final fence, không cascade — câu hỏi kế toán tự giải), D2a action class `delete_draft_session`, D3c tra `pg_constraint`, D4a ordering chung delete+publish, D0 không ưu tiên dependency | ✅ Decision-level chốt 13/08 (slice deferred — chờ `tenant-capability-authority-core` packet) | P2/P4 (session management) | `../features/BE/feature_session_management_tech.md` §4 *Delete transition* · `../features/FE/feature_session_management.md` · `packages/db/migrations/0003_payments_ledger.sql:46` · DD-103 |
| DD-103 | **Chấp nhận gap Person-merge re-parent của `0031_chat_schema_core`, có ràng buộc cứng** → trigger `chat_members_identity_immutable` / `chat_channels_identity_immutable` chặn vô điều kiện UPDATE lên `person_id`/`dm_key`, cộng composite FK tới `memberships` **không `DEFERRABLE`** ⇒ **cấu trúc chặn** việc re-parent chat rows khi merge Person — không phải "chưa implement". Spec `feature_inapp_chat_tech.md` (hàng `| 10 | Cross-Feature | Account merge → chat authorship |` và acceptance `| 11 | Merge re-parent |`) đang khai hành vi này như yêu cầu, schema hiện tại **không đáp ứng được**. Exposure = 0 (zero implementation của Person-merge trong repo). **Ràng buộc cứng:** slice implement Person-merge **phải** mang theo migration mở đường; chưa có thì đó là blocker của chính slice đó | ✅ Chốt (owner 2026-08-11) | P3.5 (Identity) | `../autopilot-backlog.md` task `chat-identity-merge-reparent-enablement` · `../features/BE/feature_inapp_chat_tech.md` (hàng 10 + acceptance 11) · `../00-start-here/identity-model.md:234-237` |
| DD-102 | **Waiver round-5 finding 1 cho `chat-dm-safety-authority-core--v3`, có điều kiện** → `assert_dm_allowed` đọc config qua **4 statement riêng** (3 × `chat_dm_safety_config` + `dm_safety_enabled()`), mỗi statement một snapshot READ COMMITTED ⇒ **torn read**, một lần siết config đồng thời có thể không áp đủ cho lời gọi đang bay. **KHÔNG phải fail-open**: mọi `COALESCE` default đều deny — `rate_limit_check(bucket, 0, …)` chạy `IF v_count >= p_limit THEN RETURN false` mà `v_count >= 0` luôn đúng ⇒ deny; config thiếu ⇒ deny; `dm_safety_enabled()` false ⇒ `safety_disabled` ⇒ deny. **Exposure = 0** (zero production caller). Fix bất khả thi trong scope: `0030` đã apply + hash-lock. **Điều kiện cứng:** migration follow-up phải land **TRƯỚC caller đầu tiên** (slice 7/8) | ✅ Chốt (owner 2026-08-10) | P4 (chat tree) | `../autopilot-backlog.md` task `chat-dm-safety-config-single-read` · `.autopilot/dispositions/chat-dm-safety-authority-core--v3.json` |
| DD-101 | **Ratify B3-budget amendment cho `chat-dm-safety-authority-core`** → owner-authorized scope amendment 2026-08-05 **override** `plan §9:416` (*"Vượt ceiling hoặc cần module thứ tư → SCOPE_DESIGN hard stop và re-slice"*) **cho riêng slice này**; module count 3→**5**, changed LOC ~**1.145** vs trần **750**. Ngoại lệ **có ghi chép, không phải trần bị phá lén**: `_scope_note` trên branch tự khai vượt trần, `negative_scope` liệt kê từng touch kèm lý do cơ học, và toàn bộ đã qua 5 vòng codex. Trần 750/3-module **vẫn hiệu lực cho mọi slice khác**; ngoại lệ không tạo tiền lệ tự động | ✅ Chốt (owner 2026-08-10) | — (kit/process, ngoài P-number) | `../autopilot-templates/level3.1-adoption-plan.md` B1b · `../proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md` §9:409,416,422 |
| DD-100 | **Level 3.1 adoption cho Plexco** → D1 hướng land = **Plexco-local trước, canonical sau** (chấp nhận fork khỏi kit v31, nợ backport có chủ, KIT_VERSION rẽ nhánh hậu tố consumer); D2 Phase 0 chạy song song P4/P5 **trong giới hạn va chạm file** (gap1/gap2/P5 cùng ghi `codex-review-pin.sh` ⇒ tuần tự; gap3 song song được); D3 nhận `manifest_schema_version: level3-operational-v3` + `design_contract`, có cửa sổ chuyển tiếp v2/v3, **không retrofit v2 active**; D4 **giết** maturity-ledger + `proactive_routine` | ✅ Chốt (owner 2026-08-09; D4 owner-delegated theo tiêu chí lợi ích dài hạn) | — (kit-maintenance, ngoài P-number) | `../autopilot-templates/level3.1-adoption-plan.md` (verdict `NOT_CODE_READY`, blocker B1–B5) · `../autopilot-templates/level3.1-design-discussion.md` §8 |
| DD-99 | **FE spec hardening + player-facing FE backlog (Sporta FE porting)** → P1 ratify bộ 4 section Analytics/State Machine/AC/Testing (12 file FE đã nhận dạng Draft 2026-08-07) thành điều kiện FE Draft→Reviewed; P2 FE spec player session-detail + join/leave/waitlist UX (hard-dep: owner gỡ mâu thuẫn header/§6 `feature_sessions_fe.md`); P3 security/account-management owner contract (logout · delete account · linked providers · session-device); P4 surface contract mark-paid + `cash\|waiver` + refund-on-cancel (SourceBadge hiện dead enum); OQ-DD99-1 breakpoint 768px → F0 | ✅ P1 + OQ-1 chốt · P2→P4→P3 prioritized (owner-delegated 2026-08-07) | — | `../research/sporta-fe-docs-gap-2026-08-07.md` · DD-96/97/98 |

---

## DD-01 — SĐT verified là khoá merge chính · 🔄 Điều chỉnh bởi DD-50

- **Bối cảnh lịch sử:** Quyết định ban đầu dùng SĐT verified để tránh gán nhầm tiền/merge sai khi một người xuất hiện ở nhiều kênh.
- **Quyết định hiện hành (DD-50):** Phase-1 **không thu SĐT**. Khoá mạnh cho claim membership có nợ/lịch sử tiền chỉ là **verified account email** hoặc transactional one-time **`link_code`**. Tên/alias, owner assertion và bằng chứng CK chỉ là review evidence, không được bypass khoá mạnh.
- **Hệ quả:** `persons.phone_*` giữ dormant cho tín hiệu tương lai nhưng không tham gia phase-1 proof; không tích hợp SMS OTP. Google/email-password và `link_code` phải qua proof/lifecycle contract đầy đủ ở DD-50 trước khi mở claim/merge.

## DD-02 — `pay_code` contract (suffix trần + prefix namespace) · ✅ Chốt (2026-07-13, owner)

> Contract đầy đủ + nguồn ở `../decisions/analysis/dd-02-paycode-analysis.md` (rev 6). Tóm tắt canonical dưới đây. **Phase = P4** (khớp BL-PAY-3; sửa drift "P3" cũ).

- **Bối cảnh:** Mã đối soát CK dễ đọc cho player nhưng match bền, provider-agnostic. Core **đã có** `extractPayCode`/`countPayCodes` (`matching.ts`) — chưa wire production.
- **Quyết định (owner):**
  - **DB lưu suffix trần UPPERCASE, 4 ký tự**, alphabet **A-Z + 2-9 trừ `0 O 1 I L`** (31, không phải Crockford); unique per-tenant; **immutable**; `CHECK (format + ≥1 chữ cái, loại toàn số)`.
  - **Prefix = bảng global `pay_prefix_registry(prefix PK, tenant_id, state current|retired, locked_at)` — nguồn DUY NHẤT, KHÔNG cột `tenants.pay_prefix`.** `UNIQUE one-current-per-tenant`; retired KHÔNG tái dụng (PK cho 1 tx thắng). **MVP: prefix IMMUTABLE vĩnh viễn sau code đầu tiên** (bỏ controlled-change — `memberships` chỉ lưu suffix nên đổi prefix sẽ resolve nhầm; tương lai cần thì phải có mapping `(membership_id,prefix,suffix,issued_at)`). **Choke-point atomic** phát-code ↔ đổi-prefix (`SELECT current-prefix FOR UPDATE` cùng lock order). Memo/QR `<PREFIX>-<CODE>`.
  - **Recognition = resolver `own | foreign | none`** (narrow SECURITY DEFINER, fail-closed — role `app` không blanket cross-tenant, `0009`). **full-issued ⟺ `registry.locked_at IS NOT NULL` + `membership.pay_code` khớp** (retired-chưa-lock + suffix mới → `none`, không false-issued). Prefix BẮT BUỘC; regex thêm `-?`. **Memo-level precedence:** hard-token (foreign / own-prefix+unissued / dash-lạ / error / >1-candidate) → HARD unmatched (thắng name-fallback); ≥2 distinct own → unmatched; đúng 1 own → resolve; chỉ `none`(`PAYMENT`) → name-fallback.
  - **Allocation = INVARIANT** qua **`planIncomingAllocations()`** (pay_code chỉ resolve MEMBERSHIP; ledger quyết charge): auto `exact`/`over`/`under`(FIFO partial, edge #8) **+ unknown-fee-phía-sau (giữ phần chắc chắn)**; manual **unknown-fee-đầu**/`already-paid`; ≥2 code / provider-code-mismatch → unmatched.
  - **Provider-agnostic:** parser/generator/matcher ở core. **ApiPay = Phase-1 primary** (DD-30) — parse `data.content` (schema reverify khi build); **SePay = fallback**, `code` chỉ evidence; giữ webhook nhận tx không-code (không `skip_if_no_code`).
  - **Merge:** pay_code giữ trên tombstone; recognition **follow `merged_into_membership_id`** (tenant/status/cycle guards). `left`-còn-nợ nhận diện.
- **Propagation ĐÃ làm ở SPEC (2026-07-13):** `identity-model` §merge + `feature_identity_tech` (pay_code tombstone follow-through) ✅ · connector `feature_connector_onboarding.md` 4.3b + `_tech` M2 (ApiPay enterprise = Phase-1 **primary**) + **schema `provider_connections.auth_mode += 'enterprise'`** (CHECK shape đầy đủ per provider/auth_mode; platform credential từ KMS, không per-tenant) + **CO-OQ-6 đóng** (`skip_if_no_code=0`, adapter-only) ✅ · `feature_payment_reconcile_tech` **§4 worker pipeline** (`normalize→discover→resolve→precedence→providerCode-crosscheck→plan`) + `bank_transactions.provider_code_enc` + §8 fixtures ✅.
- **Propagation CÒN LẠI (khi build P4, code):** wire core + **thay tests** (impact analysis trước khi sửa `matching.ts`/`payments-logic.ts`); implement **`discoverPayCodeCandidates` + resolver narrow fn + `planIncomingAllocations()`**; migration **`pay_prefix_registry`** (one-current-per-tenant, choke-point) + `CHECK` trên `memberships.pay_code`.

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

## DD-04 — Hosting PostgreSQL · ✅ Accepted (2026-07-16) — Option (c) DO co-locate

> ✅ **FINAL (2026-07-16, owner):** chọn **QĐ-1 (c) — co-locate compute + Postgres trên DigitalOcean** (App Platform + Managed PG HA-standby, **cùng VPC private**, Singapore). Supersede đề xuất (a) trong brief. Đổi deployment target **Fly → DO** (KHÔNG đảo DD-10 — App Platform chạy standalone container). Lý do: private DB by construction + managed HA/SLA/PITR + một provider (đơn giản cho solo dev) + fit `LISTEN/NOTIFY` session-pool (không scale-to-zero) + portability. Record đầy đủ: `../decisions/analysis/dd-04-hosting-final-decision.md`.
>
> ⚠️ **Pre-build gate (§7.1) — CHƯA verify:** DO App Platform **không bật đồng thời** VPC-private-DB **và** dedicated egress-IP. **Phải xác minh** SePay/ApiPay/Zalo/Messenger có yêu cầu fixed outbound source-IP không **TRƯỚC khi dựng DO App Spec**; nếu có → dùng fallback **(a) Fly + DO**, **KHÔNG** âm thầm tắt private-DB path. Mitigation bắt buộc: **offsite encrypted backup + restore-to-another-Postgres runbook** (chống concentration risk). Cost planning (record Rev 2 — Day-1 baseline + trigger-based): **`$120–135/mo` Day-1 baseline** (2 web + 2 discovery + 1 worker × 1 GiB + DO PG HA `$60.90` + Cloudflare Free + Sentry Developer + KMS `$1–3` + logs/R2 `$0–5` + egress `$0–8`) — **money-safe nhờ non-negotiables + read-isolation controls** (projection-role, bounded pool, reserved budget, CDN, circuit-breaker), KHÔNG cần read-replica/WAF-Pro/Sentry-Team Day-1. Add-on đó = **trigger-based upgrade** khi telemetry chạm ngưỡng. Ephemeral staging `$8–18` → prod+staging `$128–153`. **Caveat:** deferral chỉ an toàn khi read-isolation controls ship thật + trigger được giám sát. (thay số Tier `$202–254` cũ; chi tiết deployment-infra §9 + record §5)
>
> **2026-07-13 (reopen):** Phân tích trong `../decisions/analysis/dd-04-hosting-decision-brief.md` (nay rev 5: rev 2 factual analysis + rev 3 governance + rev 4 fact/cost closure + rev 5 read-isolation/portability closure) đã mở rộng provider/network gate. Chi tiết/nguồn ở brief; tóm tắt canonical dưới đây.

> *(§ dưới = lịch sử phân tích reopen-era; kết quả cuối = **(c)** ở block ✅ FINAL trên.)*

- **Bối cảnh:** Cần chọn nhà cung cấp Postgres cho hệ tiền multi-tenant RLS; compute app ban đầu target Fly.io — **DD-04 chốt (c) → DO App Platform** (DD-10 giữ nguyên: standalone container).
- **Đã chốt:** Managed Postgres **HA (auto-failover) + PITR**, **region Singapore**, **private VPC** (co-locate). Railway PG chỉ dev/staging.
- **Gate cứng (đã đạt qua (c)):** **auto-failover HA + uptime SLA + posture private-network** (VPC by construction).
- **QĐ-1 — posture network:** (a) public TLS + `sslmode=verify-full` + static-egress-IP allowlist [giữ Fly — **fallback**] · (b) PrivateLink AWS [rời Fly — loại] · **(c) co-locate compute+DB cùng cloud [đổi target Fly→DO, KHÔNG đảo DD-10] — ✅ ĐÃ CHỌN**.
- **QĐ-2 — ứng viên (theo posture a):**
  - **DigitalOcean Managed [nghiêng chọn]** — auto-failover standby + SLA 99.95% + PITR; bill phẳng, vận hành đơn giản; margin dự đoán chắc nhất (không nhất thiết rẻ nhất).
  - **Neon Scale** — HA multi-AZ **mọi plan**; SLA + PrivateLink ở Scale (PrivateLink **AWS-only → vô dụng từ Fly**); consumption floor 0.25 CU, trần = max-CU; rẻ hơn ở tải thấp nhưng cần benchmark.
  - **Supabase** — Pro và Team **rớt uptime-SLA gate**. Team từ `$599` có AWS PrivateLink nhưng không uptime SLA; SLA chỉ ở Enterprise custom, còn auto-failover phải contract-confirm. Không cost-comparable với finalist Day-1.
  - **Self-host / Railway-HA** — biến thể self-host (Patroni…), **không** Day-1 (hệ tiền + solo dev): tiết kiệm hạ tầng bị xoá bởi chi phí lao động/rủi ro.
- **Sửa dữ kiện so với lần thu hẹp trước:** (1) Neon HA **không** Scale-gated (multi-AZ mọi plan; Scale = SLA/PrivateLink/IP-allow); (2) Supabase Pro/Team không có uptime SLA; Team từ `$599` chỉ thêm PrivateLink, SLA ở Enterprise custom và auto-failover cần contract confirmation; (3) private-networking **chưa** được giải quyết bởi "Fly private networking" (khác cloud).
- **Tiêu chí:** auto-failover, SLA, posture network, RLS (Postgres core ở mọi provider), pooler/direct-conn cho pg-boss/`LISTEN`, chi phí *dự đoán được*, độ trễ Singapore, maintainability team nhỏ, **portability (chỉ Postgres thuần)**.
- **Hệ quả:** RPO/RTO chốt sau provision + restore drill; benchmark tải trước khi cam kết chi phí (đặc biệt Neon consumption). Không đổi domain model.
- **✅ Đã chốt (2026-07-16):** QĐ-1 = **(c) co-locate DO**; QĐ-2 = **DigitalOcean** (App Platform + Managed PG). **Còn lại TRƯỚC khi build infra slice:** (1) **§7.1 egress-IP gate** (verify SePay/ApiPay/Zalo/Messenger fixed-outbound-IP); (2) production acceptance **§7.6** (auto-failover drill · PITR restore drill · 4 DB roles · SSE reconnect · pg-boss no-dup · budget alerts); (3) benchmark cost ở staging trước procurement.
- **Chi tiết:** **`../decisions/analysis/dd-04-hosting-final-decision.md` (final ✅)** · `../decisions/analysis/dd-04-hosting-decision-brief.md` (rev 5, phân tích/nguồn) · `deployment-infra.md §2/§6/§9 (DD-04)`.

## DD-05 — Join cross-club: open vs approval · ✅ Chốt (2026-07-13) — `../decisions/analysis/dd-05-join-policy-analysis.md`
> **Chốt:** per-session, **mặc định `open`**. Open join/request-create lookup existing player trước restriction preflight: `active|waitlisted` trả current outcome idempotently, vì DD-52 không auto-evict; chỉ absent/`left` mới chạy DD-41, DD-42 và shared `evaluateJoinRestriction()` rồi mới tạo membership/request/player. Với first-entry, `pending` join_request chỉ tạo request, **KHÔNG tạo membership/player/charge**, không giữ capacity và không lộ venue. Với existing `left`, request-create chỉ preflight xem live DD-49 disposition có representable hay không; schema hiện tại **không lưu/bind financial proof**. Unknown/unimplemented → `REJOIN_REQUIRES_REVIEW`, không tạo request hay mutation. Khi approve, lock session→request→player/aggregate, re-check DD-41/DD-42/DD-52 và **re-derive/revalidate DD-49 từ live canonical aggregate**; drift/unknown giữ request pending và không mutation. First-entry: còn slot → membership+active player+exactly-one-charge+venue; full → membership+waitlisted player, không charge/venue. Existing `left`: active thì carry-over hoặc append refunded lifecycle; full thì waitlisted, chưa-refund giữ aggregate lịch sử còn refunded defer lifecycle mới tới activation. Approve là tenant state-write; active first-entry/refunded-rejoin branch là money-write. Bất kỳ active outcome nào lấp capacity phải resolve mọi nonterminal DD-45 promotion root trong cùng session transaction.

- **Bối cảnh:** Player join kèo từ marketplace xuyên CLB.
- **Quyết định (✅):** Cấu hình **per-kèo**, mặc định **open**, host có thể bật **approval**.
- **Lý do:** Cân bằng tốc độ lấp slot (open) và quyền kiểm soát của host.
- **Hệ quả:** Thêm field cấu hình ở session; state machine join có nhánh chờ duyệt.

## DD-06 — Độ chi tiết vị trí public · ✅ Chốt (2026-07-13) — `../decisions/analysis/dd-06-location-granularity-analysis.md`
> **Chốt:** public projector emit **`area` (quận/khu vực) only**; `venue_name`/`venue_address`+SĐT/bản đồ **chỉ lộ khi canonical player outcome là `active`**. Pending, rejected, expired và approved-but-`waitlisted` đều không thấy venue. Invariant test: venue KHÔNG vào `public_sessions`.

- **Bối cảnh:** Lộ địa điểm chính xác ra public gây rủi ro riêng tư/spam.
- **Quyết định (✅):** Public chỉ hiện **khu vực/quận**; lộ **venue chính xác** sau khi join/approval thực sự tạo outcome `players.status='active'`.
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

## DD-08 — Môn khởi điểm + taxonomy trình độ · ✅ Chốt (2026-07-13, owner)

- **Bối cảnh:** `sports` là chiều dữ liệu của kèo; cần chốt danh sách môn ban đầu và thang trình độ. Level còn là nguồn cho **DD-41** (level gating) + **DD-43** (nhãn theo level) → một nguồn duy nhất.
- **Quyết định (owner):**
  1. **Môn Day-1 (seed):** cầu lông (badminton), pickleball, tennis, padel, volleyball, basketball, football — **thiết kế cho phép mở rộng thêm môn sau này** (không hardcode).
  2. **Taxonomy trình độ (ordered, 5 bậc):** `beginner` < `intermediate` < `upper_intermediate` < `advanced` < `professional`.
- **Biểu diễn (khớp canonical `packages/db/schema.ts`):**
  - **Môn = bảng dữ liệu `sports` (đã có: `key`/`name`/`active`)** — mở rộng bằng **thêm hàng** (KHÔNG enum, KHÔNG migration cho môn mới); cờ `active` để bật/tắt. Seed 7 môn trên. ⇒ yêu cầu extensible đã được kiến trúc sẵn.
  - **Level = tập canonical có THỨ TỰ**, cần **rank số** (vd 1..5) để so sánh min/max/strict ở đường JOIN (DD-41). Đề xuất: lookup `skill_levels` (`key`,`label`,`rank`) hoặc enum + ordinal; **thay** `sessions.skill_level text` tự do hiện tại (migration mở rộng, đi cùng đợt DD-41). Level dùng chung một nguồn cho DD-41/DD-43.
- **Hệ quả:** seed `sports` (P0) + định nghĩa canonical level. `sessions.skill_level` (text) → chuẩn hoá về level canonical khi migration DD-41 land (min/max range). Filter discovery + gating dựa trên rank. Cập nhật `feature_marketplace_discovery` (filter môn/level) + DD-41/DD-43 khi build.
- **Còn lại (impl, không chặn quyết định):** chốt `key` chuẩn hoá (snake_case: `badminton`/`pickleball`/`tennis`/`padel`/`volleyball`/`basketball`/`football`) + cơ chế i18n `name` (vi/en) qua `t()`; chọn lookup-table vs enum cho level (khuyến nghị lookup để thêm bậc không cần migration enum).

## DD-09 — Messenger vào lộ trình · 🔄 Thay bằng DD-37

> **2026-07-10:** Bị thay bởi **DD-37** (Phase-1 channel pivot). Messenger **không còn post-MVP** — nay là **kênh phase-1 (P2.5)** cùng Zalo; **Telegram bị bỏ khỏi phạm vi**. Nội dung dưới giữ làm **lịch sử**.

- **Quyết định (lịch sử):** Messenger là **post-MVP, phase P4.8**.
- **Lý do (lịch sử):** Ưu tiên Telegram/Zalo/web cho MVP; Messenger thêm sau khi canonical store + sync ổn định.
- **Hệ quả:** Thiết kế giữ surface-agnostic; chi tiết ở `channels/messenger/messenger-channel-design.md`. **Xem DD-37** cho scope kênh hiện hành.

## DD-10 — Web stack · ✅ Chốt

- **Bối cảnh:** Chọn framework cho web app.
- **Quyết định:** Dùng **Next.js App Router** trong cùng container/monolith, build standalone; **không** tách lên Vercel. SSE chạy bằng route/Node runtime, fan-out theo DD-07.
- **Lý do:** Đây là stack đã có trên `main` (`apps/web` dùng `next dev/build/start`), giữ được SSE long-lived, webhook durable và deployment cùng worker/DB contracts.
- **Hệ quả:** README/TDD/ROADMAP và deployment docs phải mô tả Next.js; không dựng thêm Express SSR song song.
- **Chi tiết:** `deployment-infra.md §2 (DD-10)`.

## DD-11 — Zalo Premium + add-on managed · 🔗 Phụ thuộc ngoài

- **Bối cảnh:** Khi owner quản >3 CLB/tài khoản có thể chạm giới hạn Zalo OA.
- **Trạng thái:** Cần xác nhận với Zalo về Premium/giới hạn + mô hình add-on managed.
- **Hệ quả:** Ảnh hưởng pricing host nhiều CLB (P4.7); chặn bởi câu trả lời từ Zalo.

## DD-12 — Public read model · ✅ Chốt

- **Bối cảnh:** Marketplace cần đọc public nhanh, không lộ tiền/PII.
- **Quyết định:** Bảng `public_sessions` cập nhật qua **projector** (không dùng materialized view). Contract này đã có trong canonical schema/migrations; implementation projector vẫn thuộc Sync Engine.
- **Lý do:** Kiểm soát field whitelist & thời điểm cập nhật rõ ràng; tách read model khỏi canonical.
> **🔄 Scope mở rộng (owner 2026-07-19, qua DD-73 Q5):** phần **safety fence + guarded public view + narrow raise/CAS-clear functions + `public_projection_version` + grant migration chuyển mọi consumer khỏi base table** **thuộc DD-12/marketplace, không phải DD-73**. Lý do: marketplace hiện **không có đường deny tức thì** — kèo chuyển private/cancel phải chờ projector async mới hết lộ. Đây là nợ sẵn có của read model, cần làm dù không bao giờ có feature share. DD-73 chỉ dựng route/OG/telemetry lên trên.

- **Hệ quả:**
  - Sync engine có projector ghi `public_sessions`; cần đảm bảo nhất quán cuối.
  - **Immediate-deny path (từ 2026-07-19):** `public_projection_fences` (GLOBAL PROTECTED) + guarded view anti-join + narrow typed functions; privacy-reducing mutation raise fence **trong cùng source transaction**, projector CAS-clear đúng token sau convergence. Read path deny ngay, không chờ projector.
  - **Bảo mật:** live migration `0009` hiện còn `readonly SELECT public_sessions`; slice DD-12 mở rộng phải **REVOKE base SELECT trước khi bật consumer mới**, rồi chỉ grant guarded public view cho process `discovery`. `readonly` giữ zero grant trên canonical tiền/PII và fence table; projector writer giữ quyền hẹp cần thiết. Sau cutover không tồn tại trạng thái “base hoặc view đều đọc được”, vì đường base sẽ bypass immediate-deny fence. Xem `deployment-infra.md §4/§6`.

## DD-13 — Web-auth provider Google + email-password là auth phase-1 · ✅ Chốt

> **2026-07-10 (owner, cùng DD-37):** CHỐT. Vì **Telegram bị bỏ** (DD-37), TG Login không còn là đường auth. **Google Login (OAuth) + tài khoản web (email + password)** là auth **phase-1**. Điều này **đảo** quyết định OQ-1 trong DD-31 (2026-07-06: "giữ TG Login only, DD-13 vẫn 🟡") — nay OQ-1 hết hiệu lực.

- **Bối cảnh (lịch sử):** Direction web-auth ban đầu là **TG Login + web fallback**. Buổi strategy 2026-07-02 nêu nhu cầu acquisition: cần login "bật ngay được" (Google / email-password) để không kẹt go-to-market.
- **Quyết định (✅):** Auth phase-1 = provider `google` (OAuth) + `email` (email-password self-register). **Bỏ adapter TG Login.** `account_identities.platform ∈ { 'google', 'email', 'facebook'(DD-33), 'zalo'(DD-14) }`.
- **Ràng buộc thiết kế:**
  - Thêm provider = giá trị `account_identities.platform` + adapter OAuth; password → bảng credential riêng qua migration mới (P12 expand→contract). **KHÔNG** tạo root table `users` — `persons` vẫn là anchor (§P6).
  - **DD-50:** phase-1 không thu SĐT; phone schema dormant. Gắn Person bằng verified account email hoặc transactional one-time `link_code`; không gắn bằng tên/owner/CK.
  - **SI-2 keyed-hash (DD-31):** cột `account_identities.platform_user_hash` cho `google.sub`/email — dùng keyed HMAC (Google `sub` entropy cao hơn TG id nhưng vẫn keyed để nhất quán).
- **Hệ quả:** Cập nhật `feature_web_auth_onboarding(.md/_tech)` (WAO-UC-1, Auth Adapter: **bỏ Telegram, thêm Google/email**) + `00-start-here/identity-model.md §7`. Đây là spec-change có DD ✅ → được sửa spec Reviewed theo checklist DD-37.

## DD-14 — Zalo Login (Social API) có bị chặn bởi cửa đăng ký OA không · 🔗 External enablement evidence — `../decisions/analysis/dd-14-15-zalo-spike-analysis.md`
> **Không phải quyết định nội bộ.** Chưa có bằng chứng attributable/reproducible thì Zalo Login và CTA liên quan phải OFF; account-linking chỉ qua verified one-time link-code path (DD-50 `/link` — link_codes có sẵn, command handler là phase-1 contract chưa build), không auto-link. Kết quả spike không bao giờ tự chứng minh Zalo Login subject bằng bot/OA-scoped `from.id`.

- **Bối cảnh:** Zalo có nhiều bề mặt tách biệt (Bot Open API, Mini App, OA OpenAPI, Social/Login). Zalo Login có thể giảm friction cho verified Account, nhưng provider equality không phải join key và không tự nối subject web với subject bot/OA.
- **Cần xác minh:** Zalo Login yêu cầu đăng ký app trên developers.zalo.me — có buộc phải có OA verified không (thứ đang pending), hay độc lập.
- **Binary close condition:** lưu official evidence có nguồn/ngày/điều kiện App/OA hoặc sandbox run tái lập được với exact configuration. Evidence độc lập chỉ cho phép bật Login; mọi bot↔Account binding vẫn cần explicit verified link theo DD-50/DD-67.

## DD-15 — Zalo Bot `from.id` có ổn định xuyên nhiều bot khác nhau không · 🔗 External optimization evidence — `../decisions/analysis/dd-14-15-zalo-spike-analysis.md`
> Không chặn build/go-live an toàn: target luôn scope theo bot/OA endpoint. Chỉ reopen trước một proposal nới scope/cross-bot dedupe; provider evidence không tự authorize migration, merge hoặc đổi uniqueness.

- **Bối cảnh:** Plexco đa-bot (mỗi host/CLB một bot). Cùng một người ở hai bot khác nhau: `from.id` là id toàn cục theo user Zalo, hay scoped-per-bot? (Messenger PSID đã xác nhận page-scoped.)
- **Cần xác minh:** với Zalo Bot Platform.
- **Target fail-safe hiện hành:** normalize hai keyed HMAC domain-separated: `provider_scope_lookup_hash = HMAC("channel-scope:zalo:<bot_or_oa_id>")` và `platform_user_lookup_hash = HMAC("channel-user:zalo:<from.id>")`; uniqueness là `(platform, provider_scope_lookup_hash, platform_user_lookup_hash)`. Raw bot/OA id và `from.id` không trở thành authority key/plaintext lookup.
- **Hệ quả:** Nếu sau này chứng minh `from.id` ổn định xuyên bot, một migration/merge-plan được audit có thể giảm số lần link; không tự đổi uniqueness hoặc auto-merge bằng suy đoán. Nếu scoped-per-bot thì contract hiện tại đã đúng. `link_codes` bao ca xấu nhất (`00-start-here/identity-model.md §3`).

---

## DD-16 — Feature Club AI Assistant + Knowledge Base (RAG per-CLB) · ✅ Chốt

- **Bối cảnh:** Yêu cầu mới: mỗi CLB tạo "bot tư vấn" riêng, nạp KB từ FAQ + docs nội bộ, ai tag bot thì bot tự trả lời theo KB (giống chatbot tư vấn). Plexco hiện KHÔNG có KB/vector/chat in-app; "bot" trong repo = channel adapter, không phải trợ lý AI.
- **Quyết định:** Thêm **track feature mới, post-MVP**: trợ lý AI per-tenant + knowledge base + answer-engine RAG, **tái dùng** identity/tenantRepo-RLS/sync-engine/channel-adapter/billing thay vì dựng song song. Bảng mới (`bot_configs`, `kb_sources`, `kb_documents`, `kb_chunks`, `bot_queries`, `chat_*`) đều **tenant-private, RLS fail-closed**.
- **Lý do:** Giá trị cho host (giảm hỏi lặp trong nhóm); không đụng đường tiền MVP; nằm gọn trong kiến trúc canonical-store + surface-agnostic có sẵn.
- **Hệ quả:** **Chỉ trong app Plexco** (không TG/Zalo/Messenger). Phụ thuộc sync engine + web/app surface (P4), identity (P3.5), billing (P5). Chi tiết + schema sketch + test bất biến ở `proposals/club-ai-bot-knowledge-base.md`; implementation authority hiện hành là pair Reviewed `feature_club_assistant(.md/_tech)`. Pair vẫn chưa có runtime; DD-18 provider/privacy/ToS là enablement-only cho go-live. Khi implement phải dùng migration mới monotonic, tự chứa schema + ENABLE/FORCE RLS + policy + explicit grant/revoke; **không sửa `0000`/`0009` đã apply**.

## DD-17 — Vector store = pgvector tenant-private · ✅ Chốt

- **Bối cảnh:** KB cần lưu embedding để retrieve. Lựa chọn: pgvector trong Postgres hiện có vs vector DB ngoài (Qdrant/Pinecone/Weaviate).
- **Quyết định:** Dùng **pgvector** trong Postgres tenant-private, đặt dưới **RLS** như mọi bảng tenant khác.
- **Lý do:** Tái dùng luôn ranh giới cô lập RLS (INV-1) — không phải bảo mật hệ thống thứ 2; 1 DB/1 backup/PITR (hợp modular monolith, P14); KB mỗi CLB nhỏ nên ANN trên tập đã filter theo tenant rất nhẹ.
- **Hệ quả:** Migration mới của feature (hoặc một prerequisite migration mới monotonic ngay trước nó) phải `CREATE EXTENSION IF NOT EXISTS vector` và verify bằng migration role thật; **không sửa/chờ chạy lại migration roles/extensions lịch sử**. Cân nhắc tương tác ANN index (HNSW/IVFFlat) với RLS filter — cần benchmark recall khi filter chặt. Chuyển vector DB ngoài chỉ khi đo lường thực sự cần (P14 partition-when-measured).

## DD-18 — Provider embedding/LLM + privacy/ToS · ⬜ Mở (hướng ✅, chặn GO-LIVE) — `../decisions/analysis/dd-18-llm-provider-analysis.md`
> ⚠️ **Deferred in the clean subset (2026-08-12):** DD-18 stays **open** (base state above — blocks go-live, not build); this subset does **not** ratify or reconcile it. The **current base** Assistant contract keeps a single-slot `kb_chunks` (fixed `vector(1536)`, no embedding-profile registry) and a `bot_configs` with no active-profile pointer, and none of that schema is migrated (runtime absent). The archived v7 candidate design (HEAD `5009686`, since reverted) proposed the model-neutral + candidate/active profile lifecycle and surfaced three prerequisites its future spec must resolve before that lifecycle can be adopted: candidate + active embeddings cannot coexist under the single-slot `kb_chunks` `UNIQUE (tenant_id, document_id, chunk_index)`; activation lacked a protected CAS boundary; and the provider adapter was not pinned to the active profile. Blockers `dd18-embedding-candidate-active-multiprofile`, `dd18-profile-activation-cas-boundary`, `dd18-embedding-provider-profile-equality`.
> **Hướng (2026-07-13; reconcile 2026-07-28):** MVP trợ lý dùng **API hosted-first** sau interface swappable `EmbeddingProvider`/`ChatProvider`. Product + BE pair đã Reviewed; **provider cụ thể + ToS/DPA/data-region review vẫn CHẶN GO-LIVE** (P6), không phải build-time provider dependency. Giữ ⬜ vì open item pháp lý/provider.

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
- **Quyết định:** Trợ lý **chỉ** ground trên `kb_chunks` active đã qua content-DLP (FAQ/docs). **Không** đưa `charges`/`memberships`/`persons`/SĐT/secret vào context LLM. Sau extract, trước chunk/embed, scanner phải phát hiện secret/credential/PII; hit thì document chuyển `blocked_sensitive_content`/quarantine, không có active chunk, embedding hoặc retrieval cho tới khi admin redact và re-ingest. Retrieval/output guard fail-closed `no_answer` và tạo host alert nếu content nhạy cảm lọt qua.
- **Lý do:** Cắt tận gốc đường rò tiền/PII qua prompt; KB là dữ liệu công khai-nội-bộ do admin chủ động nạp.
- **Hệ quả:** Nếu sau này muốn "hỏi nợ của tôi" → làm **tool riêng có person-self authz** (chỉ trả nợ của chính người hỏi), tách khỏi RAG chung, là DD mới. Test bất biến: prompt context chỉ chứa active `kb_chunks` đúng tenant; file chứa test-secret/PII không tạo embedding/chunk và không thể được retrieve; guard cuối không echo secret và phát đúng một alert có opaque evidence, không ghi secret vào log.

## DD-22 — Entitlement/định giá trợ lý (add-on) · ✅ Chốt (gộp Host Pro — DD-29)

- **Bối cảnh:** Trợ lý tốn chi phí LLM/embedding theo lượng dùng; cần gate theo gói.
- **Quyết định:** Dùng `plans.entitlements` (jsonb) sẵn có với exact key **`assistant_ai_kb`** + `limits` (KB size, câu hỏi/tháng); cấu hình per-tenant ở `bot_configs.monthly_question_cap`. DD-29 đã chốt capability này thuộc **Host Pro 250k/tháng**; không còn add-on/pricing question riêng. Deterministic player commands như `/pay` không dùng Assistant entitlement.
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

## DD-29 — Phase-1 pricing pivot: free web + bot (Zalo + Messenger, DD-37); 1 gói Host Pro 250k · ✅ Chốt

- **Bối cảnh:** DD-03 monetize theo **số kênh** (free_web / telegram 79k / plus 159k / all 199k). Chiến lược Phase-1 (owner, 05/07) đổi hướng **acquisition-first**: cho host kết nối CLB với **bot miễn phí** để phủ nhanh (bối cảnh 05/07 dự kiến 3 bot gồm Telegram; **DD-37 sau đó bỏ Telegram → Zalo + Messenger**), dời monetize sang **gói tính năng tự-động-hoá** thay vì tính theo kênh.
- **Quyết định (chốt):**
  - **Free (mặc định, mọi host) — 0đ:** web app + kết nối **bot kênh Zalo + Facebook Messenger** (Telegram đã bỏ — DD-37) + quản CLB/kèo/roster cơ bản + **mark-paid thủ công tiền mặt/CK** (DD-40) + chat cơ bản (DD-38). Vào thẳng `active` vô thời hạn (giữ **BL-BIL-1**: không trial/past_due/suspended vì non-payment).
  - **Host Pro — 250.000đ/tháng:** mở khoá **Trợ lý AI + KB** (Club Assistant, DD-16..28) + **đối soát CK tự động & báo thu phí** + **nhắc nợ tự động** (+ các tự-động-hoá nâng cao khác — chốt danh sách chi tiết khi promote billing spec).
  - **Bỏ** 3 tier theo kênh (`telegram`/`plus_channel`/`all_channels`). **DD-03 → 🔄 thay bằng DD-29.** DD-22 (định giá trợ lý) nay gộp vào Host Pro.
- **Lý do:** Kênh miễn phí giảm ma sát acquisition (đấu Reclub, phủ CLB nhanh); monetize theo **giá trị tự-động-hoá tiền** (đối soát/nhắc nợ/AI) — thứ host trả tiền thật để đỡ việc. 1 gói giá đơn giản, dễ bán.
- **Hệ quả — propagation checklist (các spec Reviewed cần cập nhật khi thực thi):**
  - `feature_billing_lifecycle(.md/_tech)`: `plans` CHECK → `('free','host_pro')`; price host_pro=250000; `entitlements` = **capability flags** (registry ở `BE/feature_billing_lifecycle_tech.md §4b`: free có `payment_mark_manual`/`reminders_manual`; host_pro thêm `payment_reconcile_auto`/`reminders_auto`/`assistant_ai_kb`/`crm_dashboard`). Bỏ edge/test `plus_channel` (#14/#22). ✅ **đã cập nhật spec 05/07; schema/migration — xem addendum ngay dưới** (authored + verified 2026-08-04; self-verifying landed condition in the addendum below, not a status claim here).
  - ✅ **Addendum (2026-08-04, `plans-dd29-capability-registry` slice):** migration authored + verified — `packages/db/migrations/0028_dd29_capability_registry_expand.sql` (expand) + `0029_dd29_capability_registry_contract.sql` (contract) move `plans.plan_key` CHECK to `('free','host_pro')`, reshape `plans.entitlements` to the nested `capabilities` map (§4b), reseed, and repoint `tenant_provision()`'s write path plus the `free_web` subscriptions row — the only tier this migration ever auto-migrates. A fail-closed guard unconditionally aborts the whole transaction instead if any subscriptions row still references `telegram`/`plus_channel`/`all_channels`, regardless of status, since collapsing them would irreversibly lose which tier the row held; that is a grandfather-vs-reprice policy decision this migration deliberately does not make. `packages/db/schema.ts`'s `plans.keyChk` updated to match. Verified against real Postgres in this slice's own worktree (fail-closed guards, upgrade path, contract self-guard). Round-06 review found a residual `tenant_provision()` session-cached-body race spanning the two files' deploy; owner-ratified resolution is an operational precondition (pause onboarding writes for the deploy's duration on any live-traffic environment — see `0028`/`0029` headers + tech spec §2 Migration & Rollback), not a code fence, since the window closes permanently once the pair lands. Self-verifying landed condition, not a status claim that can drift: `packages/db/migrations/0028_dd29_capability_registry_expand.sql` and `0029_dd29_capability_registry_contract.sql` existing on `main` means this has landed — check the repo directly rather than a separately-maintained status line. Hard prerequisite for `hasCapability` (`tenant-capability-authority-core`, downstream — not implemented by this slice).
  - `product/BRD.md` (bảng tier L239-242, FR-9.1 L189, AC-8 L331, OD-3 L342) · `product/PRD.md` (chọn plan L182-183) · `product/TDD.md` (FR-13 L65, cron L552) · `product/ROADMAP.md` (P5 L262/264/316/326) · `product/CRM_DASHBOARD_BRD.md` (MRR/revenue-by-plan L421/424/430/527 → 1 gói).
  - ✅ **Nuance đã giải (DD-40, owner 2026-07-10):** free = **mark-paid thủ công (tiền mặt/CK, tap/multi-select)** + nhắc thủ công; **auto-reconcile CK + nhắc nợ tự động là `host_pro`**. Split này nay chốt — cập nhật `feature_payment_reconcile`/`feature_notifications_reminders` theo DD-40.

## DD-30 — Provider onboarding: APIpay enterprise auto-provision per-host · ✅ Chốt

- **Bối cảnh:** Onboarding hiện tại (`feature_connector_onboarding`, Draft) = mỗi host **BYO** (SePay OAuth / ApiPay api_key). Để **launch nhanh**, dùng **quan hệ enterprise với APIpay** ở cấp platform để **auto-provision** webhook/bank-account cho từng host (khỏi bắt host tự OAuth/nhập key).
- **Quyết định (chốt):** Platform giữ **APIpay enterprise credential**; onboarding host = platform gọi APIpay enterprise API đăng ký **per-host** bank-account + webhook `/webhook/apipay/:token`. **Tiền vẫn về tài khoản ngân hàng RIÊNG của host** — **money-custody KHÔNG đổi**, giữ invariant `feature_payment_reconcile` ("platform không giữ tiền player"). Routing tenant vẫn theo `:token → bank_accounts.webhook_token → tenant_id` (**BL-PAY-6**).
- **Lý do:** Giảm ma sát onboarding (self-serve chậm/khó với host phổ thông); tận dụng enterprise để auto-register. Vì không đảo money-custody nên **không** đụng hard rule / rủi ro pháp lý trung gian thanh toán.
- **Hệ quả:**
  - `feature_connector_onboarding(.md/_tech)` (Draft — sửa được): thêm path **"APIpay enterprise auto-provision"** (platform credential, per-host account/webhook), giữ BYO như fallback; provider vẫn `apipay`; verify HMAC `ApiPay-Signature` per-host secret không đổi.
  - **Bảo mật:** enterprise credential platform = tài sản KMS; lộ = ảnh hưởng nhiều tenant → cần rotation + audit riêng. Cần điều khoản enterprise (giới hạn số account/webhook, phí) từ APIpay.
  - **KHÔNG** đụng ledger/reconcile core — chỉ đường onboarding/provisioning.

## DD-31 — Auth security invariant + test matrix (auth-onboarding v3) · ✅ Merged (Telegram-era)

> **2026-07-10:** v3 ĐÃ MERGE vào `main@1eb6f60` (`5b1193b`) — Telegram-era, kèm migrations `0012/0013` + KMS pepper client (`37296ef`) + tests. Nội dung "🟡 đề xuất / chờ merge / build-new" bên dưới là **pre-merge** (giữ lịch sử). Residual thực sự = audit SI trên main + swap provider Google/email (DD-37/DD-13) — theo dõi dưới DD-13.

- **Bối cảnh:** `feature_web_auth_onboarding(.md/_tech)` đã Reviewed, nhưng lần triển khai đầu (`feat/auth-onboarding-v2`) trải qua 9 round codex review liên tiếp kể từ lúc resume (06→07→08→09), mỗi round phát hiện **một finding khác nhau ở một file khác nhau** — không phải region-thrash (không lặp cùng 1 vùng) mà là pattern "distinct findings spreading across nhiều file round sau round", điều mà standing invariants coi là dấu hiệu slice quá lớn/under-specified chứ không phải thrash đơn thuần. `HALT-MAX_ROUNDS.txt` (round-06, P2 logout-CSRF, đã fix khi resume) và `AWAIT-FOUNDER-round09-nonconvergence.txt` (round-09, P2 unkeyed lookup hash, chưa fix) đều dừng lại chờ founder quyết định thay vì tự vá tiếp lần thứ N. Trước khi build v3, cần một **invariant + test matrix thực thi được** (`BE/auth-security-invariant-table.md`) để design pass không lặp lại kiểu non-convergence này.
- **Quyết định (đề xuất):** Chốt danh mục 8 bất biến bảo mật (SI-1..SI-8, chi tiết đầy đủ + test cụ thể + schema ref ở `BE/auth-security-invariant-table.md`) làm scope bắt buộc cho `auth-onboarding-v3`. Trong đó **4 mục còn open ở mức implementation/spec-pin** — **founder decisions đã resolved 2026-07-06** (OQ-1/2/3, xem §5 invariant table), chỉ còn code + pin spec, **KHÔNG chờ founder nữa**:
  1. **SI-1 — Pre-auth login-state CSRF binding:** mục tiêu là state single-use/short-TTL/browser-bound, nhưng transport phải tách. Live Telegram-era/same-origin email form dùng `auth_login_state` + Strict cookie + `sameOriginRequest()`; Google/Facebook callback cross-site GET dùng protected `auth_oauth_transactions` + path-scoped Lax browser binding và **không** gọi `sameOriginRequest()`. Email verify/reset dùng non-mutating landing GET → explicit same-origin POST; session cookie luôn Strict.
  2. **SI-3 — Explicit tenant-filter policy:** chốt làm **policy bằng văn bản** (mọi query tenant-scoped mới trên bề mặt auth/onboarding phải dùng CẢ `withTenant` LẪN predicate `tenant_id` tường minh) + **PORT code fix round-07** (`onboardingSnapshot`) từ v2 sang v3 (base `feat/phase1-fable5` không có).
  3. **KMS/secret source wiring (historical pre-merge gap):** **đã chốt 2026-07-06 (OQ-2): AWS KMS** cho staging/prod, dev local giữ fallback `ENCRYPTION_KEY`; runtime delivery qua encrypted-env boundary, không phụ thuộc Fly. Helper dùng chung đã land trong Auth v3; provider port Google/email phải reuse.
  4. **SI-2 — Keyed hash cho `account_identities.platform_user_hash`** (layer **web-auth**, KHÔNG phải `channel_identities.platform_user_lookup_hash` — hai cột khác tầng, xem bảng phân biệt trong invariant table §1): thay `sha256("telegram:"+id)` trần hiện tại (round-09 finding — brute-forceable vì TG user id entropy thấp, enumerable) bằng keyed HMAC; nguồn key đã chốt ở gap 3.
  Các SI còn lại (SI-4 logout fail-closed, SI-5 shared rate-limiter, SI-6 creation-race idempotency, SI-7 session rotation, SI-8 onboarding_steps recency dedupe) đã được **validate ở v2 reference (`feat/auth-onboarding-v2 @7407caa`)** — nhưng code/test đó **KHÔNG có trên base `feat/phase1-fable5`** (đã verify git). v3 phải **PORT/reimplement + giữ test trong manifest scope**, KHÔNG phải chỉ pin regression.
- **Lý do:** Gate class-aware autopilot coi auth/security/PII là **STRICT** (zero finding bất kể P-level). Một bảng bất biến tường minh, bám sát spec Reviewed + toàn bộ evidence trail v2 (9 round), giúp v3 build đúng ngay từ đầu thay vì lặp lại chu kỳ phát-hiện-rồi-vá-từng-round của v2.
- **Hệ quả:** `auth-onboarding-v3` (manifest mới) phải cover đủ 8 SI trong scope — **tất cả PORT/reimplement vì base không có auth code**. **Spec-pin (gỡ deadlock):** Phase A KHÔNG sửa spec; **Phase B ĐƯỢC pin 4 gap vào `_tech.md`** sau khi founder answers đã record (xong 2026-07-06) — đây là bổ sung phần **chưa đặc tả**, không phải sửa phần đã Reviewed. DD-31 giữ 🟡 tới khi v3 merge 2 round clean; việc pin gap **không** chờ DD-31 ✅.
- **Founder quyết định 2026-07-06:** OQ-1 → **giữ nguyên scope Phase-1** (TG Login + web-account fallback only; DD-13 vẫn 🟡, không mở rộng Google/email-password trong v3). OQ-2 → **AWS KMS** (staging/prod; `ENCRYPTION_KEY` fallback dev). OQ-3 → **giữ DD-31 🟡** tới khi `auth-onboarding-v3` merge với 2 round codex clean liên tiếp, mới chuyển ✅. Chi tiết đầy đủ: `BE/auth-security-invariant-table.md §5`.
- **⚠️ Cập nhật 2026-07-10 (DD-37):** **OQ-1 đã bị đảo.** Telegram bị bỏ khỏi phạm vi (DD-37) ⇒ **không còn TG Login**; auth phase-1 = **Google + email-password** (DD-13 nay ✅). SI-2 keyed-hash áp cho `google.sub`/email thay cho `telegram:id`. Auth-onboarding v3 scope phải cập nhật: bỏ Telegram adapter, thêm Google/email adapter; các SI-1..SI-8 còn nguyên hiệu lực nhưng "telegram user id entropy thấp" (round-09 finding) nay là moot — vẫn giữ keyed HMAC cho nhất quán.
- **⚠️ Cập nhật 2026-07-10 (trạng thái merge):** **v3 đã MERGE vào `main@1eb6f60`** (`5b1193b`) — Telegram-era, kèm migrations `0012/0013`, **KMS pepper client** (`37296ef`), `SECURITY DEFINER search_path` fix (`3ce516f`), tests. Nên DD-31 chuyển từ 🟡 "chờ v3 merge" → **✅ Merged (Telegram-era)**. Mô tả "chưa có code KMS / SI phải build mới" trong `BE/auth-security-invariant-table.md §2/§3` là **pre-merge, đã đánh dấu lỗi thời**. **Residual thực sự:** audit SI-1..SI-8 trên code đã merge + **thay provider Telegram Login → Google/email** (DD-37/DD-13, chưa implement) — theo dõi như hạng mục con của DD-13, không phải DD-31 mở lại.
- **⚠️ Cập nhật 2026-07-18 (provider-port transport):** live SI-1 implementation không được copy nguyên sang OAuth. `SameSite=Strict` không đi theo top-level cross-site callback và OAuth `Origin/Referer` không phải same-origin; D1 dùng OAuth transaction + Lax binding riêng, còn email link dùng landing GET không mutation → same-origin POST. Đây là security correction trong B0 probe, không mở lại founder decision DD-31 và không phải runtime evidence.

## DD-32 — Channel-first booking funnel · ✅ Reopen + chốt (2026-07-28) Option D — `../decisions/analysis/dd-32-booking-funnel-analysis.md`
> **Chốt (owner): D — browse tự do, link-or-pay tại final confirm.** Option A ngày 13/07 bị supersede. User chưa link vẫn xem session và vẫn có đường đăng ký, nhưng paid+available chỉ active sau verified full payment; linked Account được active+charge và pay later.

- **Browse:** time, public `area`, fee display, confirmed count và slots available luôn xem được; exact venue chỉ sau `players.status='active'`, không roster/debt.
- **Decision table:** free+available→active không link/payment; full→waitlisted no charge/payment/venue; approval request→pending không thu trước. Paid+available: qualified Account link→active+exactly-one charge/pay-later; unlinked→một 15-minute seat/payment hold, verified full settlement mới atomic active+charge+allocation. Approval/promotion chỉ áp gate sau approval/có slot.
- **Qualified link:** exact endpoint-scoped `ChannelIdentity` và một `Account` có verified account identity phải cùng current canonical `Person`. PSID/`from.id`, display name, provider equality hoặc `link_code` chưa hoàn tất Account binding không đủ. `/link` là mechanism, không phải quyền pay-later tự thân.
- **Capacity/fairness:** một helper đếm `active players + unexpired payment holds`. Promotion hold hết hạn release slot, audited requeue candidate về cuối hàng đúng một lần rồi tiếp tục selector.
- **Money failure:** overpay allocate tối đa amount due, remainder unmatched; underpay/late/wrong-code/wrong-currency không active và đi manual refund-or-credit review. QR/nút “đã trả” không phải payment proof.
- **Provider gate:** pay-now chỉ enable khi connector/market/currency/consent/entitlement chứng minh settlement tự động; unhealthy/unknown thì không phát QR, offer link/web. Free và linked pay-later không bị provider outage chặn.
- **Ranh giới:** channel orchestrator chỉ gọi common Join service sau khi decision core chứng minh nhánh; không tạo `player.payment_pending`, temporary charge hay booking ledger song song. Claim/merge membership có lịch sử tiền vẫn giữ nguyên DD-50.
- **Hệ quả:** Product funnel v1.0 + BE companion v1.0 là contract; cần intent/hold schema, shared occupancy helper, payment finalizer, approval/waitlist integration và adapters riêng trước runtime.

## DD-33 — Facebook Login / Messenger account-link như web-auth provider · ✅ Chốt (owner 2026-07-18; phase-1 · App Review kick-off)

> **2026-07-18 (owner):** Đã chốt **phase-1 + kick-off App Review**. **App Review / Business Verification / permission evidence là external enablement/GA gate, không còn là open design decision.** Nếu gate chưa pass thì capability Facebook cho non-test user phải tắt và degrade sang transactional one-time `/link` code; không hiển thị một CTA hỏng.

- **Bối cảnh:** DD-13 bao **Google / email-password** (auth phase-1). DD-14 bao **Zalo Login**. Facebook Login là provider riêng cho **kênh Messenger phase-1** + link account (feature-4).
- **Quyết định (✅):** Bật **Facebook Login** như provider `account_identities.platform='facebook'`; chỉ nhận stable **app-scoped provider subject của đúng Meta App** sau server-side code exchange/verification và lưu lookup hash domain-separated. Facebook Login subject và Messenger Page-scoped PSID là hai subject khác nhau; chỉ quy về cùng `person` bằng verified account identity hoặc transactional one-time `link_code`, **không auto-link chéo**.
- **Hệ quả:** Là đường tạo linked-state Facebook cho DD-32 nhưng chỉ bật sau khi có exact App Review/Business Verification/permission evidence. Migration implementation phải audit live legacy rows rồi thêm validation `facebook` trong migration self-contained; **không giả định/drop một CHECK hiện chưa tồn tại**. Không đụng core `Person`/`Membership`; fallback là transactional one-time `/link` code.

---

## DD-34 — Plexco Global KB plane + union retrieval (KB-club ∪ KB-Plexco) · 🟡 Approve-in-principle P7 (2026-07-13) — `../decisions/analysis/dd-34-36-kb-platform-analysis.md`
> **Duyệt hướng** với các guard đã nêu (grant-isolated + scanner PII). **Chi tiết + patch DD-21 khi build P7.** Không chặn MVP.

- **Bối cảnh:** Club Assistant đã chốt (DD-16..28) chỉ bao **KB per-CLB tenant-private**; trợ lý chỉ biết KB của đúng club. Owner (06/07) muốn trợ lý trả lời cả câu hỏi **về chính nền tảng Plexco** (tính năng, cách dùng, chính sách chung) — không có plane cho tri thức dùng chung không thuộc tenant nào.
- **Quyết định (đề xuất):** Thêm plane **GLOBAL read model** `platform_kb_*` (`platform_kb_sources/documents/chunks`) — **KHÔNG có `tenant_id`**, do process **platform-admin** ghi. Role `app` chỉ SELECT qua exact active/reviewed read surface, không DML và không đọc draft/quarantine/unreviewed raw content (cô lập-bằng-grant như DD-12/`readonly`, KHÔNG vào RLS list `0009`). Mở rộng `searchKnowledgeBase(tenantCtx, query)` thành **union 2 nhánh**: `kb_chunks` WHERE tenant (RLS) ∪ active `platform_kb_chunks` (global), hợp nhất RRF, gắn nhãn scope; **precedence club > platform** khi trùng chủ đề (`bot_configs.include_platform_kb`/`platform_kb_weight`).
- **Quan hệ với DD-21 (extension, KHÔNG "nguyên vẹn"):** DD-34 **mở rộng nguồn grounding** của DD-21: grounding vẫn **chỉ KB**, nhưng **allowed KB sources** mở từ `kb_chunks(tenant)` → `kb_chunks(tenant) ∪ platform_kb_chunks`. **Live-context (DD-28) vẫn tách riêng, không trộn.** Khi DD-34 ✅ **phải patch DD-21** + Club Assistant specs (`feature_club_assistant.md` bất biến "KB prompt = chỉ `kb_chunks`" · `BE/feature_club_assistant_tech.md` §5) để phản ánh nguồn union — đây là điều kiện promote, không được để DD-21 mâu thuẫn.
- **Lý do:** Tri thức nền tảng dùng chung mọi club → 1 nguồn, cập nhật đồng loạt (không nhồi-trùng-lặp N club); có tiền lệ bảng global trong feature (`embedding_cache`).
- **Cô lập & guard (global read cho mọi tenant nên phải chặt):** thiếu `tenant_id` chỉ ngăn **routing/association** — **KHÔNG** tự ngăn nội dung tenant bị ingest **nhầm** vào `content`. Vì active platform KB đọc-chung mọi tenant, `platform_kb_*` **KHÔNG ĐƯỢC chứa** (không phải "không thể chứa") dữ liệu tenant/PII ⇒ cần guard nhiều lớp: (1) **source allowlist** — chỉ ingest tài liệu sản phẩm Plexco (platform-docs-only), không nhận nguồn tenant; (2) **admin review** trước activation; (3) **scanner + test bất biến** assert content không chứa tenant identifier/PII pattern (SĐT/email/`pay_code`/tên roster); (4) app runtime không đọc inactive/unreviewed raw rows. Ghi bởi role platform-admin.
- **Hệ quả:** Test bất biến: platform table không `tenant_id`; role `app` không ghi và không đọc inactive/unreviewed content; **scanner PII/tenant-id trên content = xanh**; union không rò KB club A↔B; câu hỏi nền tảng chỉ nhận active reviewed chunk. Chi tiết + normative rules: `../decisions/analysis/dd-34-36-kb-platform-analysis.md` (authoritative). Proposal `plexco-global-kb-and-kb-autosync.md §3` là sketch historical — bị superseded ở điểm mâu thuẫn (proposal phác `app` direct table SELECT; rule chốt ở trên là `app` CHỈ đọc qua active/reviewed read surface). **Không** sửa spec Reviewed tới khi ✅ (khi ✅ mới patch DD-21 + Club Assistant specs).
- **Reopen trigger:** chỉ reopen khi Assistant storage/profile/index/retrieval owners có merged probes trên default branch và owner đã chọn canonical platform-content source + activation authority; chốt ngay trước migration `platform_kb_*` đầu tiên hoặc trước khi union-read mở rộng `searchKnowledgeBase`.

## DD-35 — Auto-derive KB-club từ dữ liệu canonical · 🟡 Approve-in-principle P7 (2026-07-13) — `../decisions/analysis/dd-34-36-kb-platform-analysis.md`
> **Duyệt hướng** (field-whitelist, cấm ledger/PII). Chi tiết khi build P7.

- **Bối cảnh:** KB-club hiện tại là host **nạp thủ công** (`kind ∈ faq/doc_upload/pasted/url`). Owner muốn KB **tự cập nhật theo update của từng club** — không bắt host nạp lại khi đổi mô tả/luật/chính sách.
- **Quyết định (đề xuất):** Thêm `kb_sources.kind='derived'` nhưng **không author whitelist từ UI/proposal**. Chỉ field non-PII có canonical schema + sole mutation owner + source outbox event đã merge mới được enumerate vào whitelist. 1 aggregate canonical : 1 derived source (upsert theo `derive_key`), idempotent `content_hash`.
- **Lý do:** Giữ KB tươi mà không tăng việc cho host; canonical là nguồn sự thật, KB-derived là read model dẫn xuất (không multi-master).
- **Ranh giới (giữ HR2/DD-21/DD-28):** **CẤM** derive `charges`/`memberships`/`persons`/SĐT/`pay_code`/số dư vào KB. **KHÔNG** derive dữ liệu vận hành realtime (slot buổi cụ thể, ai join) — cái đó là **DD-28 live-context tool**, không phải KB. Precedence: host-manual > derived (host tắt được từng mảng derived).
- **Hệ quả:** Thêm projector + field-whitelist (enumerate ở BE tech). Test bất biến: derived doc ⊆ whitelist (không ledger/PII); đổi field non-whitelist → KB không đổi; derive qua outbox (không ghi KB thẳng). Chi tiết + normative: `../decisions/analysis/dd-34-36-kb-platform-analysis.md` (authoritative). Proposal §4 (pre-enumerate fields từ UI/proposal) là sketch historical, bị superseded — rule chốt: chỉ field non-PII có canonical schema + sole mutation owner + merged outbox event mới được enumerate. **Không** sửa spec Reviewed tới khi ✅.
- **Reopen trigger:** canonical club-profile schema, sole mutation owner và exact non-PII source events đã merge; Assistant storage/text-ingest/profile activation đã có owner. Reopen ngay trước khi author projector `kind='derived'`.

## DD-36 — Freshness: scheduled re-crawl + re-ingest KB-Plexco · 🟡 Approve-in-principle P7 (2026-07-13) — `../decisions/analysis/dd-34-36-kb-platform-analysis.md`
> **Duyệt hướng** (pg-boss cron, change-detect). Chi tiết khi build P7.

- **Bối cảnh:** "Update KB theo update của **Plexco**" + nguồn URL cần tự làm mới; hiện ingest chỉ chạy khi host thao tác.
- **Quyết định (đề xuất):** (a) **KB-Plexco** re-ingest khi team Plexco đổi tài liệu sản phẩm (change-detect `platform_kb_sources.content_hash`); (b) nguồn `kind='url'` (tenant + platform) **scheduled re-crawl** bằng **pg-boss cron**: refetch → so `source_etag`/`content_hash` → chỉ re-ingest khi đổi. Thêm field freshness (`last_synced_at`, `next_sync_at`, `sync_interval`, `source_etag`).
- **Lý do:** Tự cập nhật theo nguồn thay đổi mà idempotent (INV-6) + bounded (P14); provider ngoài txn (P9); đổi model → P12.
- **Hệ quả:** Serving lifecycle và sync-attempt lifecycle là hai state machine riêng. Fetch/re-crawl fail trước revision mới phải giữ source + serving generation `active`, đồng thời ghi `last_sync_status='error'`, bounded error code và attempt timestamp; không overload `source.status`. Khi changed hash đã được accept vào canonical `kb.ingest`, old generation bị supersede trước processing; DLP/index/activation fail giữ current source blocked/error, retrieve 0 và không fallback âm thầm. Không có staged serving pointer/state machine thứ hai. Metric staleness/DLQ (P15).
- **Reopen trigger:** URL-ingest adapter đã merge với SSRF/redirect/size/content-hash tests; generation/CAS + profile activation + scheduler substrate đã merge. Reopen ngay trước scheduled recrawl producer; platform-doc refresh còn chờ DD-34 source owner.

---

## DD-37 — Phase-1 channel pivot: bỏ Telegram; Facebook Messenger + Zalo + web là kênh MVP · ✅ Chốt

- **Bối cảnh:** Direction gốc (BRD v3.0–v3.3) đặt **Telegram làm kênh chính** + Zalo, Messenger post-MVP (DD-09/P4.8). Owner (2026-07-10) chốt lại phase-1 theo thị trường VN: **bỏ hẳn Telegram**, đưa **Facebook Messenger + Zalo** làm kênh phase-1 cùng web app.
- **Quyết định (chốt):** Kênh phase-1 = **web app + Facebook Messenger + Zalo**. **Telegram loại khỏi phạm vi** (không còn adapter/bot Telegram trong MVP). Data 3 nguồn (web/Messenger/Zalo) sync qua canonical store. **Thay DD-09** (Messenger không còn post-MVP → P2.5).
- **Lý do:** Zalo + Messenger phủ đúng tập user VN của các CLB mục tiêu; Telegram ít phổ biến ngoài một số cộng đồng. Acquisition-first (khớp DD-29): gặp user ở Zalo/Messenger.
- **Hệ quả — propagation checklist (spec cần cập nhật):**
  - **Auth:** DD-13 ✅ (Google + email thay TG Login); DD-33 lên phase-1 (Facebook Login/Messenger link). `feature_web_auth_onboarding(.md/_tech)` bỏ Telegram adapter, thêm Google/email/Facebook. `00-start-here/identity-model.md §7` provider/channel matrix cập nhật.
  - **Channels:** `channels/telegram/` archive (deprecation banner); `channels/messenger/` promote phase-1; `channels/zalo/`, `channels/web/` cập nhật channel-set.
  - **Player channel:** `feature_player_telegram(.md/_tech)` archive → tạo `feature_player_messenger` (join qua Messenger bot + quick-reply). Player Zalo giữ nguyên.
  - **Ràng buộc kênh:** Zalo (no inline button, GROUP Beta → DM number-reply); Messenger (standard messaging mặc định trong cửa sổ 24h; ngoài cửa sổ chỉ dùng cơ chế Meta cho phép/đủ điều kiện, nên MVP coi nhắc là best-effort 24h và fallback web+Zalo; **App Review bắt buộc**).
  - **Nhắc nợ:** kênh chính **web + Zalo**; Messenger best-effort trong 24h (CO-3, `feature_notifications_reminders`).
  - **Docs sản phẩm:** BRD v3.4 ✅ · PRD/TDD/ROADMAP/CRM_DASHBOARD_BRD · HANDOFF · saas-implementation-plan · standards (BUILD-STATUS/core-db/env-setup/deployment-infra) — bỏ Telegram-as-MVP, đặt Zalo+Messenger.
  - **Lịch sử/nghiên cứu giữ nguyên:** `research/bestminton-*` (bot Telegram cũ có thật), proposals đã đóng — KHÔNG viết lại (là bằng chứng lịch sử).

## DD-38 — Chat cơ bản trong app phase-1 (toàn CLB + 1-1, chỉ Plexco) · ✅ Chốt

> **2026-07-10 (owner):** CHỐT ✅ vào phase-1. Design gaps đã pin dưới đây (dedupe, DM guard, RLS policy) — `feature_inapp_chat(.md/_tech)` phải bám các ràng buộc này.

- **Bối cảnh:** Feature-6 phase-1 yêu cầu **chat cơ bản trong app**: chat toàn CLB + chat riêng 1-1. Hiện DD-19 đã thiết kế hạ tầng chat in-app native (`chat_channels/messages/members` + SSE) nhưng cho **trợ lý AI ở P7 (post-MVP)**.
- **Quyết định (✅):** Dựng **hạ tầng chat cơ bản ở phase-1** (P4): `chat_channels`, `chat_messages`, `chat_members`, realtime qua **SSE + LISTEN/NOTIFY (DD-07)**. **Chỉ sống trong Plexco**, **KHÔNG bridge** ra group Zalo/Messenger (CO-7 BRD).
- **Ràng buộc thiết kế đã pin (đóng design gap):**
  1. **Hai loại channel, RLS khả thi:** `chat_channels.kind ∈ {club, dm}`. **Club** channel có `tenant_id NOT NULL` → RLS **tenant-private** (như mọi bảng tenant). **DM** channel có `tenant_id NULL` → RLS **person-self**: chỉ đọc/ghi được nếu current person ∈ `chat_members(channel)`. **Không** để DM row phụ thuộc `tenant_id`. Policy tách theo `kind` (hoặc 2 policy: `tenant_id IS NOT NULL AND tenant match` HOẶC `EXISTS membership current person`). Không trộn một predicate `tenant_id` chung cho cả hai.
  2. **DM đúng 2 người (hard guard):** DM channel có cột `dm_key` = cặp `person_id` đã sort (`least:greatest`), **UNIQUE** trên (`kind='dm'`, `dm_key`) → không tạo trùng DM. `chat_members` của DM channel bị chặn ở **đúng 2** (trigger/CHECK đếm member khi `kind='dm'`). Tạo message DM phải re-check membership.
  3. **Dedupe độc lập với author:** message idempotency dùng **`client_msg_id` UNIQUE per `(channel_id, client_msg_id)`** — KHÔNG dựa vào `author_person_id` (assistant/system có `author_person_id NULL` theo DD-20 vẫn dedupe được). `author_type ∈ {person, assistant, system}`; `author_person_id` NULL khi assistant/system (CHECK shape như DD-20).
- **Quan hệ DD-19/DD-20:** Chat cơ bản (DD-38, người↔người) **dựng sớm** hạ tầng mà **trợ lý (DD-19 phase B) tái dùng** ở P7 (bot-participant `author_type='assistant'`, DD-20). Cùng bộ bảng `chat_*`, không model song song. Đảo thứ tự: hạ tầng chat lên P4 thay vì P7.
- **Hệ quả:** Thêm bảng `chat_*` vào RLS list (migration mới sau `0013`). Test bất biến: chat club cô lập cross-tenant; DM **đúng 2 người** đọc; dedupe `client_msg_id` cho cả assistant/system; không rò ra public/kênh ngoài. Cần rate-limit/anti-spam. Schema chi tiết (aligned với `packages/db/schema.ts`) → `feature_inapp_chat(.md/_tech)`.

## DD-39 — Giá theo giới tính (giá nam/nữ) · ✅ Chốt

> **2026-07-10 (owner):** CHỐT ✅ vào phase-1. Ràng buộc fail-closed khi decrypt lỗi đã pin dưới đây.
> **2026-07-16 (owner) — addendum USR-OQ-1 chốt:** value set công khai = **nam / nữ / khác / không tiết lộ** (`male`/`female`/`other`/`undisclosed`). `other`/`undisclosed`/NULL thật → **giá base** (không block, không đoán); fail-closed CHỈ khi KMS/decrypt lỗi. PII enc + consent, không lộ public.

- **Bối cảnh:** Feature-7 phase-1: host set **giá nam và nữ khác nhau** cho kèo; cần **giới tính** trong hồ sơ người dùng.
- **Quyết định (✅):** `sessions` cho phép **giá đơn** hoặc **giá theo giới tính** (`price_male`/`price_female`). Khi tạo `charge` cho member → suy `amount_due` theo `person.gender`. Giới tính lưu mã hoá ở hồ sơ person (`feature_user_settings`).
- **Ràng buộc "gender thiếu" vs "decrypt lỗi" (BẮT BUỘC, đóng design gap):** trên đường tạo charge, phân biệt rõ 2 case:
  - **Gender thật sự chưa set (`gender_enc IS NULL`):** fallback **giá mặc định** (hoặc giá cao hơn theo cấu hình CLB) + **nhắc member set gender**. Đây là trạng thái hợp lệ.
  - **Decrypt/KMS lỗi (có `gender_enc` nhưng giải mã fail):** **FAIL-CLOSED** — **KHÔNG** tạo charge với giá fallback (tránh tính sai tiền), báo lỗi + retry/queue; chờ KMS phục hồi rồi tạo charge đúng. **Tuyệt đối không** coi decrypt-fail như "gender thiếu".
- **Lý do:** Thực tế CLB cầu lông/pickleball VN hay có giá nam/nữ khác nhau; nhưng tính sai tiền do lỗi hạ tầng KMS là lỗi tiền → phải fail-closed (HR2, đường tiền).
- **Ranh giới bảo mật/PII (HR2, NFR-P1):** `gender` là **PII có consent**, mã hoá at-rest, **KHÔNG lộ ra public marketplace**. Host chỉ thấy giới tính ở mức cần cho suy giá. Public projection field-whitelist **không** gồm gender.
- **Hệ quả:** Schema `sessions` (+ `price_male`/`price_female`) + `persons.gender_enc` (migration mới sau `0013`). Ảnh hưởng `feature_session_management` (đặt giá) + `feature_payment_reconcile` (suy charge) + `feature_user_settings` (nguồn gender). Test: public không lộ gender; charge đúng giá theo gender; **gender NULL → fallback + nhắc; decrypt-fail → fail-closed (không charge)**.

## DD-40 — Mark-paid thủ công (tiền mặt/CK, tap/multi-select) mặc định mọi tier · ✅ Chốt

- **Bối cảnh:** DD-29 để mở nuance: free có auto-reconcile không? Feature-5 phase-1 nêu rõ **thu tiền ở mức manual**: host **tap/multi-select** player để mark **đã trả tiền mặt hoặc CK**; auto xác nhận; auto nhắc 2h/24h.
- **Quyết định (chốt) — bám canonical ledger (`packages/db/schema.ts`), KHÔNG bảng `payment` mới:**
  - Mark-paid = tạo **`payment_allocations`** vào đúng `charges` của player + cập nhật `charges.amount_allocated`/`status` (INV ledger sẵn có). **KHÔNG** tạo bảng/row `payment`. `payment_allocations.source ∈ {auto, manual, cash, waiver, reversal}` (enum sẵn có — **không thêm `bank_transfer`**).
  - **Đã trả tiền mặt:** allocation `source='cash'`, `bank_transaction_id = NULL`, `created_by = host` (đúng `alloc_shape_chk`). Host-attested, không cần webhook.
  - **Đã trả CK (host xác nhận thủ công):** gắn vào `bank_transaction` đã nhận → allocation `source='manual'`, `bank_transaction_id` set. Đây là đường manual-allocation sẵn có.
  - **⚠️ Impl-gap / hard boundary (reconcile v1.39):** host-attested "đã CK" **khi CHƯA có `bank_transaction`** (free tier không auto-reconcile) phải dùng **dedicated allocation source qua migration**, với `bank_transaction_id=NULL`, `created_by` bắt buộc và opaque evidence/audit. Trước migration → reject fail-closed. **Cấm** tạo `bank_transaction` synthetic và cấm map sang `cash|manual`; exact enum name/CHECK/idempotency pin ở B1 design-probe.
  - **Multi-select:** áp cho nhiều player một lần; mỗi charge một allocation; idempotent theo `commandId`.
  - Sau markPaid → **xác nhận tự động tới player** (FR-6.2). Nhắc theo ngưỡng (mặc định 2h→24h→…).
  - **`host_pro`:** thêm **đối soát CK tự động** (webhook `bank_transactions` → match tên+tiền+ngày → allocation `source='auto'`, `/unmatched`) + **nhắc nợ tự động** + AI/KB + CRM.
- **Lý do:** Giải nuance DD-29; free vẫn "thu tiền" được (thủ công) → giá trị ngay cả khi chưa trả phí; auto-reconcile là giá trị trả phí. Dùng đúng ledger canonical → không phá bất biến tiền.
- **Hệ quả:** Capability flags: free = `payment_mark_manual`, `reminders_manual`; host_pro thêm `payment_reconcile_auto`, `reminders_auto`. Cập nhật `feature_payment_reconcile(.md/_tech)` (mark-paid = allocation cash/manual + multi-select UX + impl-gap CK-không-txn), `feature_notifications_reminders` (ngưỡng 2h/24h + kênh web+Zalo, Messenger 24h), `feature_billing_lifecycle_tech §4b` capability registry. Áp **DD-25** (human-initiated money mutation cần preview+confirm) cho mark-paid. Test: cash allocation shape đúng (`bank_transaction_id NULL`, `created_by` set); manual allocation gắn `bank_transaction`; multi-select idempotent; `amount_allocated ≤ amount_due`; confirm tới player.

---

## DD-41 — Field mô tả + gating cho `sessions` · ✅ Chốt (2026-07-13, owner)

> Phân tích đầy đủ: `../decisions/analysis/dd-41-session-fields-gating-analysis.md`. Chi tiết SQL/enforce + player-attribute sources → **slice riêng** khi build (không nhồi vào DD).

- **Bối cảnh:** Đối chiếu 6 màn hình *Create Meet / Create Game* của 2 app tham khảo (2026-07-11) với `feature_session_management` + `sessions` schema (`packages/db/schema.ts`): `sessions` hiện **KHÔNG có tên kèo (`title`) lẫn `notes`**, chỉ có **1 field `skill_level`** (text gợi ý — không phải range, không enforce khi join), **không** có `session_type`/format, **không** gender/age restriction, **không** cờ instructions. 2 app kia đều có: Meet name (100 ký tự) + Notes, Social/Class/Singles + Regular/**Coaching**/**Tournament**, Min/Max Level + "Must Have" (strict), Gender/Age restriction, BYOE + Cost-Shared + free-text.
- **Quyết định (owner):**
  - **Mô tả:** `title` (public+moderated), `notes` (nội bộ), **`session_type` = MỘT field** `social|class|coaching|tournament|singles` *(⚠️ trộn 2 trục — `singles`=format vs intent; nâng 2 trục sau **cần backfill+đổi contract**, KHÔNG "no breakage")*, `byoe`, **`cost_shared` DESCRIPTIVE-ONLY** (KHÔNG đổi công thức `price_amount`/charge; phí biến động/chia-sau = **money slice riêng**), `instructions` (nội bộ).
  - **Gating = SESSION POLICY metadata (≠ player gender/DOB).** Enforce ở **shared `evaluateSessionEligibility`** gọi từ **canonical `addMemberToSession`** (TDD) **trước mọi roster mutation** — phủ cross-club/member/host-add/invite (KHÔNG chỉ CCJ). Fields: `level_min_rank`/`level_max_rank`+`level_strict` (rank DD-08), `gender_restriction`, `age_min`/`age_max`. Áp cả personal tenant (DD-46).
  - **Decision table (self-attested) — 9 error codes literal:** eligible→join; ineligible→`LEVEL_NOT_ELIGIBLE`/`GENDER_RESTRICTED`/`AGE_RESTRICTED` (level non-strict=advisory); **missing→`LEVEL_ATTRIBUTE_REQUIRED`/`GENDER_ATTRIBUTE_REQUIRED`/`AGE_ATTRIBUTE_REQUIRED`**; **consent-denied→`GENDER_CONSENT_REQUIRED`/`AGE_CONSENT_REQUIRED`** (privacy choice, ≠ missing; level không có consent); **decrypt/KMS-fail→`ATTRIBUTE_UNAVAILABLE`** (infra retry, KHÔNG prompt); `gender undisclosed` vs male/female→`GENDER_RESTRICTED`. **Age tính tại `sessions.starts_at` theo `sessions.timezone`.** Chặn transition open/public (cho draft) nếu source chưa khả dụng. Approval: pre-check + re-check trong transaction.
  - **Consent source (PIN):** phân biệt missing vs consent-denied cần **consent state per thuộc tính** (`persons.gender_consent`/`dob_consent` `not_set|granted|denied`; storage → user_settings slice) — `gender_enc`/`dob_enc` NULL không đủ.
  - **`skill_level` cutover (một nguồn = rank):** expand→contract — thêm `level_*_rank`+`level_strict`, backfill map text→rank (không map được → NULL = no gate), ngừng project, **drop `skill_level`** khỏi schema/projection + cập nhật exact-column test.
- **⚠️ Dependencies (chặn ENFORCE, không chặn thêm cột):** (1) **level per person×sport — CHƯA có source** → không publish `level_strict`; non-strict advisory; (2)(3) **`persons.gender_enc`/`dob_enc`** — **BRD FR-11 (ĐÃ trong MVP contract), migration CHƯA implement** (KHÔNG phải dependency mới từ DD-48); PII enc+consent. Migration cột session **sau** migration chat/gender (DD-38/39).
- **Public whitelist +:** `session_type`, level range + **`level_strict`** (advisory vs hard), `gender_restriction`, `age_min/max`, `title` (moderated) — đều là **session policy, không phải player PII**. `notes`/`instructions`/`byoe`/`cost_shared` **nội bộ**. Error codes exact (9): `LEVEL_NOT_ELIGIBLE` · `GENDER_RESTRICTED` · `AGE_RESTRICTED` · `LEVEL_ATTRIBUTE_REQUIRED` · `GENDER_ATTRIBUTE_REQUIRED` · `AGE_ATTRIBUTE_REQUIRED` · `GENDER_CONSENT_REQUIRED` · `AGE_CONSENT_REQUIRED` · `ATTRIBUTE_UNAVAILABLE`.
- **Phân biệt DD-39:** gender ở đây = **ĐIỀU KIỆN JOIN**; DD-39 = **PRICING** — độc lập.
- **Propagation (khi build):** `feature_session_management(.md/_tech)` (`evaluateSessionEligibility`/`addMemberToSession`) + `feature_cross_club_join(.md/_tech)` (enforce + approval re-check) + `feature_marketplace_discovery` (whitelist) + `business-rules` (gating invariants) + TDD discovery/join + **BRD NFR-S2 clarify (gender_restriction=policy≠player PII)** + **`feature_user_settings(.md/_tech)`** (gender/dob consent + age-at-starts_at) + `schema.ts`+migration+DBML + projector + invariant test (`rls-invariants.test.ts:133`). Session/CCJ domain **chưa implement** (live = schema + minimal `tenantRepo.sessions`). Chi tiết → slice riêng.

## DD-42 — Subsystem no-show / attendance / reliability · ✅ Chốt (2026-07-13) per-tenant — `../decisions/analysis/dd-42-reliability-analysis.md`
> **Chốt (owner): per-tenant.** Attendance trên `players` (`present|no_show|excused|unknown`); reliability aggregate trên `memberships` **per-tenant** (RLS, không lộ xuyên CLB); policy per-tenant deprioritize (hạ waitlist DD-45)/ban. **KHÔNG public.**

- **Bối cảnh:** Ảnh 1 (Create Meet, app club-centric) có filter **"No show - Deprioritize"** và **"No show twice - Banned 1 month"** — hệ thống điểm danh/độ tin cậy của club. Plexco: `players.status` chỉ `active|left` (không attendance/no-show); `memberships` không có reliability/score. Bot reference (Bestminton) có khái niệm này nhưng **chưa** đưa vào canonical/spec.
- **Quyết định:** Subsystem **RIÊNG, per-tenant** (không nhét vào session CRUD):
  - **Attendance** trên `players`: `attendance ∈ {present|no_show|excused|unknown}`, host mark sau buổi.
  - **Reliability** tổng hợp trên `memberships`: đếm no-show gần đây / score.
  - **Policy per-tenant** (setting): vd deprioritize khi 1 no-show; ban N ngày khi 2 no-show liên tiếp. Deprioritize = hạ ưu tiên join/waitlist (DD-45); ban = chặn join tạm thời (state có hạn trên membership).
- **Lý do:** Giá trị vận hành thật (giảm no-show phá kèo) — điểm mạnh của bot cũ; nhưng ảnh hưởng roster/eligibility → phải là subsystem có test riêng, không phải field lẻ.
- **Hệ quả:** Bảng/cột mới (attendance + reliability + tenant policy) — migration mới; command `markAttendance`; đường join phải check ban; waitlist ordering (DD-45) đọc reliability. Attendance/reliability **đã chốt TENANT-scoped (RLS)**, **KHÔNG ra public** (như nợ/PII); propagation vào spec/schema thực hiện cùng build slice.

## DD-43 — Nhãn/hạng thành viên + audience targeting khi announce · ✅ Chốt (2026-07-13) — `../decisions/analysis/dd-43-membership-tags-analysis.md`
> **Chốt — 2 contract RIÊNG:** (1) **`membership_tags`** (many-to-many, per-tenant, host-defined) chỉ cho **notification audience** khi announce (MVP); (2) **join eligibility = DD-41 gating + join_policy** (KHÔNG dùng tag gate join MVP). Bỏ `membership_tier` khỏi MVP; "join sớm theo tag" = slice sau. **Public không lộ tag**; level dùng DD-08.

- **Bối cảnh:** Ảnh 1 có chip lọc thành viên: **Bronze / Runner Up / Champions / Membership / Supporter / level 1–8** — phân hạng/nhãn thành viên của club, dùng để **nhắm đối tượng** khi tạo/announce kèo. Plexco `memberships` chỉ có `status` (`active|guest|left|merged`) + `pay_code`; **không** có tier/segment/label.
- **Quyết định:** Thêm **`membership_tags` many-to-many, per-tenant, host-defined**. MVP chỉ dùng tag để chọn **notification audience khi announce**; join eligibility vẫn do DD-41 + `join_policy`. Không có `membership_tier` hay tag-gated early join trong MVP.
- **Lý do:** Cho host điều phối kèo theo nhóm (VIP/supporter/theo trình độ) như app đối thủ; tái dùng `memberships` hiện có, **không** tạo identity song song (§P6).
- **Hệ quả:** Schema tag tenant-scoped + RLS; tích hợp bước announce (`session_surface_refs`/announcement); **public projection KHÔNG lộ tag nội bộ**. Thuộc `feature_multi_tenant`/membership + `feature_session_management` (bước announce). Level tiếp tục dùng một nguồn DD-08; propagation thực hiện cùng build slice.

## DD-44 — Invite-link token cho kèo private · ✅ Chốt (2026-07-13) — `../decisions/analysis/dd-44-invite-token-analysis.md`
> **Chốt + redemption:** `session_invite_tokens` — **entropy ≥128-bit**, lưu **hash**, **bound `session_id`+`tenant_id`**, `expires_at`/`max_uses`/`used_count`/`revoked_at` (revoke/rotate). Mở link → join kèo **private**, vẫn qua `join_policy` + DD-41/DD-42/shared `evaluateJoinRestriction()` DD-52. Transaction lock `session→token`, resolve existing player/request trước: current `active|waitlisted|pending` hoặc processed-command replay trả current outcome và **không consume thêm use**. Chỉ absent/`left` transition thành công mới `used_count += 1`; ban/restriction/unknown tạo zero request/player/charge/token mutation. Token = MỜI, không hạ `visibility`; venue chỉ lộ khi redeem/approval kết thúc với player `active` (DD-06).

- **Bối cảnh:** Ảnh 4 (Create Game) có **"Invite Only"** = *"restricted to invited players and can be accessed by anyone via shared link"*. Plexco có `visibility` (private/public) + `join_policy` (open/approval) + `join_requests`, nhưng **KHÔNG** có token link chia sẻ cho kèo private (private hiện = ẩn khỏi marketplace, chưa có đường mời qua link).
- **Quyết định:** Thêm **invite-link token per-session** (`session_invite_tokens`): entropy ≥128-bit, chỉ lưu hash, bound tenant+session, có expiry/max-use/revoke/rotate. Ai có link mở được trang join kèo **private**, vẫn đi qua `join_policy` + DD-41 + DD-42 + shared DD-52; token là cách **MỜI**, không hạ `visibility`. Dưới lock `session→token`, current `active|waitlisted|pending`/command replay trả current outcome không consume thêm use; `used_count` chỉ tăng cùng một absent/`left` state transition thành công. Restriction/ban/unknown fail-closed với zero mutation.
- **Lý do:** Đáp ứng use case "mời nhóm riêng qua link" phổ biến; giữ private khỏi marketplace nhưng vẫn share được.
- **Hệ quả:** Bảng token tenant-scoped + RLS; route join-by-token; venue/PII vẫn ẩn cho tới outcome `players.status='active'` (**DD-06**), kể cả request đã approved nhưng đang waitlisted; rate-limit/anti-scrape. Test expiry/revoke/max-use/concurrent-last-use/idempotency/no-leak; propagation vào session/cross-club specs thực hiện cùng build slice.

## DD-45 — Model hoá waitlist (đóng gap SES-UC-9) · ✅ Chốt (2026-07-13) — `../decisions/analysis/dd-45-waitlist-analysis.md`
> **Chốt — lifecycle:** first-entry open join hoặc approval khi full → `waitlisted`, không chiếm capacity, không tạo charge/new-obligation và không lộ venue; existing-`left` full chuyển lại chính player row sau DD-49 re-derive. **Ngoại lệ lịch sử DD-49:** rejoin chưa-refund có thể giữ canonical obligation/allocation cũ; rejoin đã refund chỉ xác nhận outcome waitlisted và **defer lifecycle mới tới activation**. Promotion lock session, re-count active, re-check eligibility/restriction rồi rẽ đúng hai nhánh tài chính: first-activation candidate phải không có charge, derive amount trước mutation và tạo đúng một charge; DD-49 rejoin candidate phải re-derive live disposition rồi carry-over hoặc append/activate lifecycle trong canonical aggregate, không tạo charge row thứ hai. Retry-job history unique `(tenant_id,session_id,origin_command_id)`; partial unique `(tenant_id,session_id) WHERE state IN ('due','claimed')` giữ tối đa one nonterminal root/session. Under session lock, every new capacity opener first resolves/supersedes older nonterminal roots (bump generation/clear token), then creates its own stable `promotion_retry_id` only on first DD-39 failure. Any join/approve/promotion/capacity change that fills capacity, and close/start/cancel, resolves all nonterminal roots in the same transaction. Mỗi DD-39 candidate failure giữ waitlisted/no-new-charge/no-venue, ensure đúng một `waitlist.charge_derivation_failed` event keyed candidate entry/reason + root origin và reference cùng job; event là audit/owner-alert dedupe, không sở hữu retry budget. Cuối synchronous opener: capacity đã đầy hoặc không còn retryable failure → job `resolved`; chỉ để `due` khi capacity còn trống và ít nhất một failure vẫn retryable. Job state machine `due→claimed→resolved|due(backoff)|terminal`; CAS claim is a **short job-only transaction** that increments `sweep_attempt_count`/generation, returns opaque token, then commits/releases. Counter bounds claimed attempts, không hứa ba sweep hoàn tất. Worker domain transaction follows universal lock order **session→root job→candidate/finance**, then proves `state='claimed'`, exact token/generation and live lease before selector/every mutation/final transition; stale claimant aborts zero mutation. Mỗi completed attempt starts current order, tries each candidate once, re-checks DD-41/DD-42/DD-52/live financial state. Sibling failure only ensure event on same job. Closed/started/full/no-candidate resolves; remaining failure after completed attempt 1–2 → due(backoff), after completed attempt 3 → terminal owner-review/DLQ. Maintenance finalizer seeing expired `claimed` with `sweep_attempt_count>=3` locks `session→job`, rechecks exact expired claim and live applicability, then clears claim: state no longer retryable → `resolved`; otherwise `terminal` + owner-review/DLQ. It performs no derivation/domain mutation and never opens attempt 4.

- **Bối cảnh:** `feature_session_management` FE spec **SES-UC-9** hứa *"leave trước giờ chơi → slot freed, waitlist auto-promote"*. Live `main@784bc8d` đã chứa schema `waitlisted` từ `0014_players_waitlist` (merge commit `1a6ac38`), nhưng chưa có SessionService hay promotion behavior. Cả 2 app đối thủ ngầm có khái niệm đầy chỗ.
- **Quyết định:** Mở `players.status` thêm `waitlisted`, `waitlist_position`, CHECK `waitlisted ⇔ position non-null` + position dương, queue index và total order `position,joined_at,id`. First-entry open join/approval khi full tạo waitlisted row mới; existing-`left` full chuyển lại row hiện có sau DD-49 re-derive; cả hai không tạo new obligation/venue. Mỗi transition vào waitlisted tăng durable `waitlist_entry_version`; deprioritize không đổi version. Queue entry/deprioritize gán `max(position)+1` dưới session lock. Leave/capacity+ re-count active rồi promote tới khi đầy. Initial promotion và retry đều bắt đầu lại từ canonical selector theo current `ORDER BY position,joined_at,id`, nên deprioritize không thể bị bypass. Mỗi candidate re-check `evaluateSessionEligibility()` (DD-41), DD-42 restriction và shared `evaluateJoinRestriction()` (DD-52); manual ban áp sau event phải skip/resolved no-op, không charge/venue. Promotion first-activation chỉ mutate sau khi assert chưa có charge và derive amount thành công; DD-49 rejoin promotion re-derive canonical disposition tại consume time rồi carry-over hoặc append refunded lifecycle khi activation thành công, không tạo charge row thứ hai. Retry jobs keep history unique by root origin and a partial unique permits one nonterminal root/session. All domain paths lock session first; a new opener supersedes old nonterminal roots before a lazy root is created on first failure, and any path filling capacity resolves them. CAS claim is short job-only; worker domain tx reacquires `session→job`, validates generation/token/live lease, then current selector/candidate/finance. Tối đa ba claimed attempts; each completed attempt tries each candidate once. Candidate events reference root for alert only; duplicate/sibling event cannot create job/budget. Persistent failure after completed attempt 3, hoặc expired final claim còn applicable, terminalizes to owner-review/DLQ; non-applicable expired claim resolves. Capacity decrease không promote/evict và `slots_max < active_count` → `CAPACITY_BELOW_ROSTER`.
- **Rejoin (DD-49 supersedes default fail-closed):** Existing `active|waitlisted` trả current outcome idempotently. Existing `left` chạy lại eligibility/capacity/ban và re-derive live financial disposition. Nếu còn slot: chưa refund thì carry-over; đã refund thì append obligation lifecycle mới trong cùng canonical aggregate, atomic với activation. Nếu full: player trở lại `waitlisted`; chưa-refund chỉ giữ aggregate lịch sử, còn refunded **chưa append lifecycle/nợ mới**. Promotion phải re-derive lại; chỉ lúc active mới carry-over hoặc append/activate lifecycle. Live UNIQUE charge/player/session cấm tạo charge đôi. Nếu correction core chưa land hoặc không chứng minh được disposition thì trả `REJOIN_REQUIRES_REVIEW`; không reopen/void/reset charge mù.
- **Lý do:** Đóng gap giữa spec đã Reviewed và data model thực tế; nhu cầu thật khi kèo full.
- **Hệ quả:** Migration `0014` đã merge và đang enforce status+position CHECK+index trên `main`; nó chưa có `waitlist_entry_version` hay root promotion-retry job store. Behavior vẫn pending trên SessionService/DD-39/41/42/52 + correction core DD-49 + migration queue-entry-version + candidate failure-event consumer + durable CAS/lease sweep worker/state/DLQ. One root budget, event idempotency, entry binding và expired-final-claim finalizer ngăn stale-rejoin promotion, N×N retries, double-promote/charge, attempt thứ tư và stuck worker.

### DD-45a — Unique waitlist position · ✅ Engineering chốt (owner 2026-07-28)

- **Quyết định:** promotion slice phải thêm partial unique index `UNIQUE (session_id, waitlist_position) WHERE status='waitlisted'` bằng một migration monotonic mới; tuyệt đối không sửa migration `0014`.
- **Preflight fail-closed:** kiểm tra duplicate trước khi thêm index. Nếu tồn tại duplicate thì `HALT` để xử lý thủ công; không tự renumber vì thứ tự queue là dữ liệu nghiệp vụ. Gaps trong position vẫn hợp lệ.
- **Concurrency contract:** session lock tiếp tục là allocator tuần tự; unique index là final database fence chống mọi writer sai hoặc race ngoài allocator.
- **Live boundary:** docs-only update này không đổi runtime. Cho tới khi promotion migration land, duplicate vẫn representable như live test hiện tại.
- **Test transition:** khi migration land, thay fixture duplicate bằng duplicate-rejection. Có thể giữ `ORDER BY waitlist_position,joined_at,id` như compatibility/defensive order, nhưng không được tiếp tục claim rằng test đó exercise equal-position tie-break.

## DD-46 — Kèo không thuộc CLB (Skip Club / personal meet) · ✅ Chốt (2026-07-13, owner) — Option B "personal tenant"

> Phân tích đầy đủ: `../decisions/analysis/dd-46-skip-club-analysis.md`. **Chốt: Option B — personal tenant** (phase-1).

- **Bối cảnh:** app tham khảo có "Skip Club"/Create Game không cần club → kèo cá nhân. Plexco: `sessions.tenant_id NOT NULL` phổ quát (26+ bảng tenant-scoped) = xương sống RLS + money (HR1).
- **CẤM (vĩnh viễn):** session không tenant / `tenant_id` nullable → phá HR1 (RLS keyed tenant_id), HR2 (tiền/PII không tường), HR4 (claim tiền). **Loại tuyệt đối** bất kể option.
- **Quyết định (owner): Option B — "personal tenant".** User chọn **không-gian-cá-nhân / Skip Club** (bất kể đã thuộc/own club khác) → **auto-provision một personal tenant** (nền, logical free tier, owner = chính person, `tenants.kind='personal'`). Session gắn tenant đó → **`tenant_id NOT NULL` + RLS + money model NGUYÊN VẸN**. Tái dùng flow tạo tenant sẵn có (WAO-UC-2) + free plan (không sinh invoice).
- **Contract đã PIN (khi build):**
  - **Schema fail-closed:** `tenants.kind text NOT NULL DEFAULT 'club' CHECK (kind IN ('club','personal'))` + `owner_person_id uuid REFERENCES persons(id)` + `CHECK ((kind='personal') = (owner_person_id IS NOT NULL))` + **partial UNIQUE INDEX** `ON tenants(owner_person_id) WHERE kind='personal'` (1/person; `UNIQUE...WHERE` không phải table constraint hợp lệ → dùng index).
  - **Provision = SHARED CORE:** live **`tenant_provision`** (`0012:256`)/TS **`provisionTenant`** đã tạo tenants+**owner membership**+web-owner tenant_admins+free sub. Personal **tái dùng core**, wrapper **`tenant_get_or_create_personal`**/**`getOrCreatePersonalTenant`** với `name` internal non-PII + slug opaque deterministic + `kind='personal'`+`owner_person_id`; owner membership **vẫn tạo**. Resolve canonical Person + `status='active'` + **lock `persons` row `FOR UPDATE` cùng merge** (không advisory); idempotent.
  - **Marketplace (alias ở owner membership):** `host_display_name` ← `memberships.display_name` (Moderated). Owner **CÓ** membership → **public alias = `owner membership.display_name`** (không tạo nguồn mới). Fail-closed: alias trống → **KHÔNG project public**. **CẤM** `person.display_name` thô. `club_display_name` NOT NULL = alias.
  - **Money/participant (GIỮ NGUYÊN đường tiền):** personal = tenant đầy đủ → join tạo **guest membership + player + charge**; reconcile/pay_code y hệt. Personal meet **được** có phí.
  - **Availability:** Skip Club dùng được **bất kể** người tạo đã thuộc/own club khác (keyed theo person).
  - **Merge (DD-01) — decision table:** chỉ loser có personal → re-parent `owner_person_id`; cả hai có → **loser personal → `kind='club'` + clear owner TRƯỚC** (không update vào unique collision). **`tenant_admins` dedupe** predicate đúng scope: `platform='web' AND platform_user_lookup_hash = loser_person_id::text → canonical::text` (Zalo/Messenger dùng provider hash — không đụng); canonical đã có web-admin cùng tenant → **giữ role cao nhất** (`owner>admin>co_admin`) trước khi deactivate dup. ⚠️ hash = UUID text **không FK** (`schema.ts:304`); `identity-model:213` chưa xử lý.
  - **Scope:** DD-46 = authority **kiến trúc**. Chi tiết impl (SQL `tenant_get_or_create_personal`, decision table merge đầy đủ, tests concurrency) → **tách design-probe/slice riêng** khi build (`feature_multi_tenant`/`feature_identity`), KHÔNG edge-patch DD.
  - **Billing:** personal khoá **logical free tier** (phụ thuộc **DD-29 migration** `free`; live `free_web`); không invoice. Onboarding bỏ "đặt tên club"; owner=self.
  - **Guards:** RLS đầy đủ; **rate-limit** `getOrCreatePersonalTenant`.
- **Hệ quả / propagation (khi build):** cập nhật `feature_multi_tenant(.md/_tech)` (`tenants.kind` + personal tenant) + `feature_web_auth_onboarding` (auto-provision path) + đánh dấu điểm chạm `feature_identity`/`feature_marketplace_discovery`/`feature_billing_lifecycle`. **Mở khoá cụm session-model** (DD-41/42/43/44/45 build thẳng trên `tenant_id NOT NULL`, personal = một loại tenant). **Không** sửa spec Reviewed tới khi build (đây là DD ✅ nên được sửa theo checklist).

---

## DD-47 — Social follow graph (person↔person) · ✅ Chốt framework (2026-07-13), build P4+ — `../decisions/analysis/dd-47-follow-graph-analysis.md`
> **Chốt (owner): duyệt framework, build P4+.** Bảng GLOBAL `person_follows` (directed, `pending/accepted`, no `tenant_id`). **⚠️ = GLOBAL PROTECTED** (như persons/accounts): grants theo `0009` — **no blanket grant cho `app`, chỉ qua identity service/`SECURITY DEFINER`** (không chỉ app choke-point). Auto-accept public/approve private (DD-48); **KHÔNG tiền/PII/roster**; merge re-parent+dedupe.

- **Bối cảnh:** `feature_user_settings` yêu cầu **cơ chế follow** (theo dõi) giữa các user. Plexco hiện **KHÔNG có social graph**: `persons` là anchor global (no `tenant_id`); `feature_player_view` chỉ cho xem dữ liệu của **chính mình** (person-self) — chưa có "user A theo dõi user B" hay "xem hồ sơ user khác". `memberships`/`players` là quan hệ person↔tenant/session, **KHÔNG** phải person↔person → không có bảng nào diễn tả được quan hệ theo dõi.
- **Quyết định:** Thêm bảng **GLOBAL PROTECTED** `person_follows` (cạnh follower→followee, không `tenant_id`). Không RLS nhưng cũng **không table grant** cho `app`/PUBLIC; mọi thao tác qua identity service + narrow `SECURITY DEFINER` functions (fixed search path, explicit revoke/grant). Actor resolve từ verified session/channel identity, không từ URL/body.
  - Cột: `id`, `follower_person_id`, `followee_person_id` (FK `persons`), `status ∈ {pending, accepted}` **không default**, `requested_at`, `decided_at`, `created_at`. `UNIQUE(follower_person_id, followee_person_id)` + no-self + decision-shape CHECK (`pending⇔decided_at NULL`).
  - **Auto-accept theo visibility (DD-48):** follow/visibility functions cùng lock target `persons` row. Followee **public** → ghi tường minh edge `accepted`+`decided_at`; followee **private** → `pending`+NULL, followee phải **approve** hoặc **reject**. Không có default-accepted fail-open.
  - **KHÔNG cấp quyền dữ liệu tiền/PII:** follow **chỉ** mở approved social-profile fields có canonical source (DD-48). **Tuyệt đối không** mở `charges`/nợ/roster/SĐT/email/gender/`pay_code` (HR2). Follower ≠ membership; follow **không** tạo/đụng `memberships`.
- **Ràng buộc đóng gap:**
  - **Merge identity (DD-01/§P6):** lock incident edges; canonicalize endpoints; drop self + collapse duplicate (`accepted > pending`) **trước** update survivors để không vỡ UNIQUE; cùng merge transaction/audit.
  - **Đổi visibility (DD-48):** `public→private`: follower `accepted` cũ **giữ nguyên** (grandfather); follow mới → `pending`. `private→public`: edge `pending` hiện có **auto-accept**.
  - **Idempotent theo state:** follow/approve trùng trả edge hiện tại; delete trùng success/no-op. Không tái dùng `processed_commands` vì store đó tenant-scoped.
  - **Thông báo follow-request (impl-gap):** notify tới followee là **person-directed GLOBAL**; hạ tầng `notification_intents`/`outbox_events` hiện **tenant-scoped** (`tenant_id NOT NULL`) → **KHÔNG** cover trực tiếp. Chọn khi build: (a) đường notify global mới, hoặc (b) tái dùng SSE person-self / in-app inbox (DD-38). Ghi open item ở `_tech`. **→ Lựa chọn này nay được đưa ra chốt ở DD-70** (spec: `../features/FE/feature_notifications_reminders.md` NTF-OQ-6 + `../features/BE/feature_notifications_reminders_tech.md` §2.2).
- **Lý do:** Follow là quan hệ xã hội cross-tenant giữa người thật → thuộc **global plane**, gắn `persons` anchor, **KHÔNG** tạo bảng identity song song (§P6). Một model cạnh-có-hướng + `pending/accepted` phục vụ **cả** public (auto) lẫn private (approval).
- **Hệ quả:** Migration sau profile fields; no-table-grant + narrow functions + grants tests. Merge phải lock incident edges, canonicalize/drop-self/collapse duplicate (`accepted>pending`) trước update survivors để không vỡ UNIQUE. Follow path không rò tiền/PII/roster. Framework đã propagate vào user-settings/player-view docs; migration/code chờ P4+.

## DD-48 — Profile visibility (public/private) + cross-user profile gating · ✅ Chốt framework (2026-07-13), build P4+ — `../decisions/analysis/dd-48-profile-visibility-analysis.md`
> **Chốt (owner): duyệt framework, build P4+.** User mới default public; existing profile backfill private trước khi set default/NOT NULL. Social profile chỉ trả approved fields có canonical source; avatar/sports/aggregate excluded tới khi có model. Self dùng `/api/me`; host operational data dùng tenant path riêng. Private chỉ mở social fields cho accepted follower; không nới RLS/tiền. DD-55 đã đóng DM + block; còn **3 open item chốt lúc build**.

- **Bối cảnh:** Plexco chưa có visibility flag hay cross-user social profile; `feature_player_view` hiện chỉ person-self.
- **Migration:** add nullable/no-default → existing=`private` → set new default=`public` → NOT NULL/CHECK trong một transaction. Không public hoá ngầm profile cũ.
- **Approved social fields:** `display_name`; `username` khi DD-39 migration tồn tại; `plexco_since` coarse từ `persons.created_at`. Avatar/sports/aggregate default exclude; không suy từ memberships/sessions.
- **Gating:** self đi `/api/me`; public hoặc private+accepted follower nhận sourced fields; mọi trường hợp khác (kể cả teammate/host non-follower) nhận fixed minimal card không có profile fields.
- **Operational split:** host vẫn đọc roster/suy giá/charge qua tenant-scoped APIs dưới RLS. Host role không widen social serializer; money/PII không bao giờ vào `GET /api/persons/:id/profile`. Private không gỡ user khỏi roster và không ẩn `host_display_name` trên public session.
- **Hệ quả:** User-settings product/BE + player-view boundary đã pin; schema/code chờ P4+. Tests cover existing-private/new-public migration, unsupported-field absence, social-vs-operational separation và no-leak.
- **Open còn lại:** (1) stats/aggregate cross-tenant; (2) follower counts/lists; (5) roster display trong shared session. **Đã đóng bởi DD-55:** ~~(3) DM~~ → phase-1 open DM qua safety gate, phase-2 follow-gated + request box; ~~(4) block~~ → canonical `chat_blocks` dùng chung chat/social/User Settings, không tạo store thứ hai.

---

## DD-49 — Money correction lifecycle (đổi giá / leave-cancel-refund / rejoin) · ✅ Chốt (2026-07-16)

> **Chốt (owner 2026-07-16):** resolve SES-OQ-1 + PAY-OQ-3; thay điểm "left rejoin fail-closed" của DD-45.

- **Bối cảnh:** tiền đã ghi sổ (charge/allocation) rồi thay đổi phía sau: host đổi giá, player rời/host huỷ, player quay lại. Cần policy trước khi build correction flows (S5/S7).
- **Quyết định:**
  1. **Đổi giá:** host chọn per-change giữa (a) **áp chênh lệch cho obligation hiện có** — thu thêm/trả lại phần chênh; hoặc (b) **grandfather** — giá mới chỉ áp cho obligation tạo sau. **Không tự động** thu bù/hoàn tiền. Policy (a) ghi **signed obligation adjustment append-only**; không mutate `charges.amount_due`. `payment_allocations.source='reversal'` chỉ dùng khi đảo một allocation tiền đã nhận, **không** dùng như price-adjustment thay thế. Mọi consumer đọc một helper canonical `effectiveAmountDue/effectiveBalance`; tên bảng/API cuối cùng chờ design-probe.
  2. **Leave/cancel:** host huỷ kèo đã thu tiền → **hoàn toàn bộ**. Player tự rời: chưa paid → void charge, không vấn đề; đã paid → hoàn **toàn bộ / một phần / không** theo policy CLB, host quyết + ghi lý do; **player có quyền gửi refund request** cho host. Refund thật host thực hiện ngoài + log opaque reference (Plexco không giữ tiền — PRD:262); reversal chỉ sửa ledger.
  3. **Rejoin:** `left` → join lại = **logic join bình thường** (qua eligibility/gating/ban + capacity). Nếu khi leave đã paid và host **chưa refund** → **carry-over** obligation/allocation hiệu lực, KHÔNG tạo charge đôi. Nếu host **đã refund** và outcome `active` → append obligation lifecycle mới trong cùng canonical aggregate, atomic với activation. Nếu full→`waitlisted` thì chỉ revalidate disposition, **không append lifecycle/nợ mới**; re-derive và append lúc promotion thành công. Không mặc định INSERT row `charges` mới: live UNIQUE `(tenant_id,session_id,player_id)` chưa biểu diễn lifecycle thứ hai; nếu correction core chưa land hoặc không chứng minh được disposition thì fail-closed `REJOIN_REQUIRES_REVIEW`.
- **Lý do:** cho host quyền chọn thay vì ép một policy; giữ ledger immutable; rejoin thân thiện người dùng thật (lỡ tay leave, đổi ý) mà không mất dấu tiền.
- **Hệ quả:** DD-45 điểm `left` rejoin fail-closed mặc định **bị thay**, nhưng `REJOIN_REQUIRES_REVIEW` vẫn là fail-closed fallback khi correction core chưa có hoặc disposition không chứng minh được. Trước schema/API: design-probe đủ {price up/down} × {unpaid/partial/paid/refunded} × {leave/cancel/rejoin active/waitlisted/promotion}; pin activation-time idempotency key, immutable entries, participation lifecycle và một helper balance canonical. Live UNIQUE charge/player/session là constraint phải giải, không được lách bằng duplicate row hoặc mutate charge cũ.

## DD-50 — Phase-1 không thu SĐT; khoá mạnh = verified email + link_code · ✅ Chốt (2026-07-16)

> **Chốt (owner 2026-07-16):** điều chỉnh DD-01 + HR4; resolve ID-OQ-1.

- **Bối cảnh:** DD-01/HR4 dựa trên SĐT verified (OTP) làm khoá merge/claim. Founder quyết phase-1 **không thu SĐT** — dùng email verified.
- **Quyết định:** (1) phase-1 không thu SĐT user; **email verified bắt buộc** cho account web. Email/password chỉ thành strong proof sau verify-token hash-at-rest, TTL, single-use. Google chỉ thành strong proof khi verify đầy đủ OIDC signature + exact issuer + audience/client ID + nonce + `exp/iat` và claim **`email_verified === true`**; không trust email/profile field từ client. (2) **Khoá mạnh HR4** cho claim membership có nợ = verified account email (web) **hoặc `link_code` deterministic dùng-một-lần** (bot Zalo/Messenger hoặc authenticated web/app handoff). Issuer shape là XOR: đúng một trong `source_channel_identity_id` hoặc `source_account_id`; cả hai phải resolve về `source_person_id` hiện hành dưới lock, không nhận `person_id` do client tự khai. Token có entropy **≥64 bit**, hash-at-rest, TTL, `max_attempts`, `locked_until`, `revoked_at`; mọi trạng thái terminal/locked/expired đều fail-closed. Consume phải transactionally lock row, re-check issuer/current person + TTL/action, increment attempts atomically, set `consumed_at` once và tạo merge plan; schema tồn tại **không** đồng nghĩa runtime đã implement. (3) **Tuyệt đối không** cho claim bằng tên/alias — giữ fail-closed. (4) Phone fields (`persons.phone_enc/lookup_hash/verified_at`) **giữ dormant** — merge signal tương lai, không xoá schema. (5) Không tích hợp SMS OTP phase-1.
- **Lý do:** giảm friction + chi phí SMS + thu hẹp scope PII (A3); link_code deterministic vốn mạnh hơn fuzzy phone-match cho claim.
- **Hệ quả:** HANDOFF HR4 wording đổi "OTP/SĐT-verified" → "verified factor (verified account email hoặc link_code)"; `feature_identity`/`feature_web_auth_onboarding` cập nhật claim/merge path + proof-evidence matrix; cross-channel merge suggestion theo phone không còn ở phase-1. S4 chưa code-ready tới khi credential lifecycle + revoke-all-affected-sessions và OIDC/link-code tests được pin. **Cross-flow lock order (v1.73):** consume first resolves the candidate code/issuer read-only; it then locks the canonical issuer/account and current Person parent in the shared deterministic order, only then locks/re-reads the `link_codes` row and performs terminal/action/hash/accounting/conditional-consume checks. This supersedes code-row-first wording and prevents reset/revoke versus consume deadlocks; any issuer/source drift after the parent/code locks fails closed.
- **Amendment (owner 2026-08-25) — predicate "verified Account" cho nhánh linked pay-later (DD-32 Option D · `feature_channel_booking_funnel_tech.md` §4.1.3 · `feature_identity_tech.md` §4):** slice `identity-account-link-core` (reader đầu tiên của qualified-link resolver) chốt: trong **phase-1**, một Plexco `Account` đủ tư cách "verified Account" cho pay-later **khi và chỉ khi có ≥1 `account_emails` với `verified_at IS NOT NULL`** — verified email theo DD-50 (phủ Google OIDC `email_verified === true` và email/password sau verify-token). **Legacy `account_identities` KHÔNG tính** vào qualification: bảng đó hiện chỉ do luồng Telegram cũ ghi (`apps/web/lib/telegram-login.ts`), mà DD-37 đã loại Telegram khỏi scope và các route đó đã lên lịch gỡ. Cụm chữ literal *"≥1 verified account identity"* trong hai spec Reviewed nêu trên là **wording drift từ thời trước DD-37 / trước khi bảng `account_emails` (migration 0016) tồn tại**, KHÔNG phải authority cạnh tranh — **DD-50 là authority của khoá mạnh** (strong proof = verified account email web *hoặc* `link_code` dùng-một-lần bot). Bản vá chữ trong hai spec Reviewed đó **được xếp hàng cho một phiên docs riêng**; lane code `identity-account-link-core` chỉ sửa `decisions.md` (amendment này), **không** tự sửa spec Reviewed. `link_code` vẫn là **cơ chế** hoàn tất binding, tự thân không mở pay-later khi Account chưa có verified email (đúng DD-50 (2)). **Cơ chế truy cập (shape) — owner 2026-08-25:** các bảng global-protected (`persons`, `channel_identities`, `accounts`, `account_emails`, `merge_tombstones`) **không** cấp quyền trực tiếp cho role `app` (`0009_rls_policies_grants.sql` §"Global protected identity/auth tables: NO grant" — least-privilege), và theo `feature_identity_tech` §2/§4 chỉ được truy cập qua **narrow SECURITY DEFINER function**. Vì vậy `resolveDeferredPaymentAccount` được hiện thực bằng **một SECURITY DEFINER function** (migration mới `resolve_deferred_payment_account`, `search_path` khoá, `EXECUTE` **chỉ** cấp cho `app`, read-only theo tiền lệ `resolve_tenant_status_locked` migration `0027`) — KHÔNG đọc bảng trực tiếp từ TS. Đây là shape spec Reviewed **đã demand** (global-protected = function-only), **không** phải nới negative scope; reader thuần-TS sẽ `permission denied` dưới `app` ở production (bẫy fail-in-prod), còn cấp `app` SELECT rộng sẽ vi phạm HR1/HR2 (mở bề mặt đọc PII) nên bị loại.

## DD-51 — Host Pro lifecycle: trial/grace/refund/override · ✅ Chốt (2026-07-16)

> **Chốt (owner 2026-07-16):** resolve BIL-OQ-2 (Item 2 founder brief).

- **Quyết định:** (1) **Trial 14 ngày**, remind khi còn **2 ngày**; hết trial không thanh toán → **khoá ngay** (về `free`), không grace. (2) Subscription đang trả mà **trễ invoice → grace 7 ngày** (past_due) rồi suspended. (3) **Huỷ giữa kỳ:** hoàn **toàn bộ** nếu request refund trong **7 ngày kể từ khi thanh toán**; sau 7 ngày → không hoàn, dùng nốt tới hết kỳ. (4) **Manual override:** chỉ `PlatformAdmin`, max **7 ngày lịch**, bắt buộc reason + `ticket_ref` + `expires_at` + audit before/after, auto-expire, không gia hạn ngầm; thiếu field → fail-closed.
- **Hệ quả:** `subscription` state machine pin trial/past_due/suspended timing; migration `billing_overrides` cần `ticket_ref` riêng (không giấu trong `reason`); refund-window logic cần mốc `paid_at` per invoice. PAY-OQ-2 giữ nguyên: tenant suspended → ingest ON, auto-settle/notify OFF.

## DD-52 — Guest→full membership + manual ban · ✅ Chốt (2026-07-16)

> **Chốt (owner 2026-07-16):** resolve CCJ-OQ-2 + ID-OQ-3 (Item 4 founder brief).

- **Quyết định:** (1) Guest→full: **host invite/approve** và **player-request + host-approve** cùng tồn tại; auto-upgrade (sau N lần/paid) defer slice sau. (2) **Manual safety/discipline ban:** `TenantOwner` **+ co-admin** (amend 2026-07-16 theo DD-56), bắt buộc reason + evidence/reference, `expires_at` hoặc permanent, unban cùng nhóm actor; audit ghi rõ actor. (3) Ban **không auto-evict**: active giữ nguyên (muốn gỡ → command remove riêng qua DD-49 có preview tiền); waitlisted **giữ queue + bị skip** đúng DD-45.
- **Hệ quả:** storage manual ban **tách** khỏi reliability-ban DD-42 (không chung bảng/semantics expiry-actor); mọi join/promotion/invite-redeem path gọi một **`evaluateJoinRestriction()`** core duy nhất (cùng chỗ với `evaluateSessionEligibility` DD-41). Join/request lookup existing player trước: `active|waitlisted` trả current outcome không mutation; absent/`left` mới bị ban/restriction chặn. Vì ban không auto-evict, một ban áp sau activation không được biến retry idempotent thành `PLAYER_BANNED`.

## DD-53 — Identity recovery + merge-split authority · ✅ Chốt (2026-07-16)

> **Chốt (owner 2026-07-16):** resolve ID-OQ-2 🔴 + ID-MERGE-1 + RTE-OQ-2 🔴 (Item 9 founder brief).

- **Quyết định:** (1) `PlatformAdmin` được **freeze ngay** identity nghi merge sai (1 người đủ); tenant owner/admin KHÔNG có quyền global split/relink. (2) Split plan chỉ PlatformAdmin tạo; **apply cần 2 approval độc lập**; break-glass 1 người chỉ tình huống khẩn cấp — bắt buộc ticket/reason + expiry + immutable before/after audit + review hậu kiểm. (3) Account recovery cần **strong proof**: verified email hoặc recovery artifact cấp trước (theo DD-50); không đủ → không relink, chuyển manual review. (4) Split plan map rõ channel identities/memberships/players/charges; **không rewrite `bank_transactions`/`payment_allocations`**; apply idempotent, re-run tenant/ledger invariants trước khi unfreeze. (5) SLA: freeze ≤4h khi nghi sai tiền/identity; plan chuẩn ≤1 ngày làm việc — SLA không bypass evidence.
- **Hệ quả:** chặn *production enablement* của S8 đã gỡ — build + shadow/dry-run được ngay; cần runbook + drill evidence trước khi bật thật.

## DD-54 — PII collection theo platform config (CMS admin dashboard) · ✅ Chốt (2026-07-16)

> **Chốt (owner 2026-07-16):** giữ nguyên code logic; việc *thu thập* field PII optional điều khiển bằng config.

- **Quyết định:** (1) Field PII **optional** (gender, DOB, và field tương lai) chỉ thu thập khi **platform config bật** — quản trên CMS admin dashboard (PlatformAdmin), default OFF tới khi cần (vd bật gender khi CLB dùng gender pricing). (2) Field **bắt buộc vận hành** không config-off được: email verified (DD-50 auth), display name, bank transaction ingest (đường tiền). (3) Config chỉ điều khiển *collection UI/flow*; code logic xử lý (enc, consent, fail-closed DD-39/41) giữ nguyên — field tắt thì NULL, đi nhánh fallback đã pin.
- **Hệ quả:** thu hẹp bề mặt PII mặc định (tốt cho A3); **KHÔNG thay legal review** — email/tên/bank memo vẫn là PII đang thu, luật sư VN vẫn phải confirm retention/erasure/cross-border trước go-live (SEC-OQ-2 giữ mở). CRM_DASHBOARD_BRD cần thêm mục config này.

## DD-55 — In-app DM policy + media scope · ✅ Chốt (2026-07-16)

> **Chốt (owner 2026-07-16):** resolve CHT-OQ-1 + CHT-OQ-3 + DD-48 open item (3).

- **Quyết định:** (1) **Phase-1:** mọi user DM được nhau in-app. (2) **Phase-2:** chỉ follower **accepted** (DD-47) DM trực tiếp; DM từ người chưa follow vào **request box** (người nhận accept mới thành thread). (3) **Media in-scope phase-1** — vì là core value, build đủ: object storage, signed access, malware scan, quota/type/size limits, moderation, deletion lifecycle; không ship half-built.
- **Hard enablement gate phase-1:** host/support **không đọc DM** (DM person-scoped, `tenant_id` NULL theo DD-38); trước khi bật open-DM phải có một canonical safety primitive (`assertDmAllowed`/DB-backed equivalent) dùng ở **request, create/bootstrap, send và read/delivery**. Primitive enforce block pair idempotent, report/abuse audit, per-sender và per-target rate-limit/spam throttling; blocked pair không tạo thread/message và không được read/deliver. Mọi `SECURITY DEFINER` bootstrap như `create_dm` phải gọi primitive này hoặc fail-closed khi safety subsystem chưa enabled — không có SQL bypass. Thiếu một gate → DM disabled fail-closed; đây không còn là optional build-time recommendation.
- **Block source of truth:** social/profile/User Settings tái dùng canonical `chat_blocks`; block command ghi đúng một store, xoá follow edges hai chiều trong cùng transaction và mọi follow/DM path đều consult store này. Không tạo `admin_links`, `social_blocks` hoặc block table thứ hai.
- **Club moderation (CHT-OQ-2 ✅ owner 2026-07-28):** `chat.message.moderate` chỉ soft-hide/restore human-authored club message bằng tombstone; `chat.member.mute` chỉ timed-mute trong channel. Actor, reason, before/after và timestamp là immutable audit; mọi mutation dùng actor-scoped receipt + canonical fingerprint. Không hard delete/content edit/permanent ban/system-message moderation; host/admin không được dùng capability để đọc hoặc moderate human DM.

## DD-56 — Co-admin capability · ✅ Chốt (2026-07-16)

> **Chốt (owner 2026-07-16):** resolve RTE-OQ-1; amend DD-52 ban actor.

- **Quyết định:** authorize bằng một registry action→capability canonical; adapter/API/UI chỉ hỏi registry, không rải `role === ...`. Live `tenant_admins.role='admin'` là legacy label và map **đúng cùng least-privilege preset** với `co_admin`, không map owner. Default preset: `session.manage`, `content.manage`, `member.manage_routine`, `member.ban`, `money.read`, `money.mark_paid` (DD-25 preview+confirm+audit), `chat.channel.manage`, `chat.channel.post_restricted`, `chat.message.moderate`, `chat.member.mute`. Default owner-only: `role.manage`, `money.correct`, `money.refund`, `money.waive_or_void`, `bank_account.manage`, `connector.secret_manage`, `billing.manage`. Owner có thể grant từng sensitive capability **trừ `role.manage`** cho co-admin bằng explicit grant có actor/reason/expiry/audit; thiếu/expired grant → deny. Co-admin/legacy-admin không bao giờ remove/demote owner/admin. Global split/relink DD-53 và billing override DD-51 vẫn PlatformAdmin-only.
- **Implementation owner:** `tenant-capability-authority-core` là cross-feature prerequisite duy nhất: closed action registry, cùng least-privilege preset cho `admin|co_admin`, tenant/person role resolver, tenant-private grant-read storage + expiry/revocation constraints, append-only grant audit và fail-closed `authorize`. Capability semantics độc lập với Chat schema, nhưng actual DB worktree của core là slice 4 và **execution hard-dep slice 3**: worktrees `chat-definer-role-provisioning → chat-dm-safety-authority-core → dd38-dd86-chat-schema-core → tenant-capability-authority-core` serialize vì cùng chạm migration tail/schema/catalog/authz tests. Chat không được tạo registry riêng. Sensitive grant/revoke mutation UI/workflow là follow-up riêng nếu vượt scope; bốn Chat keys dùng preset nên không phụ thuộc follow-up đó.
- **Hệ quả:** DD-52 manual ban actor = TenantOwner + actor có `member.ban`; BE spec phải pin exact action matrix + deny tests cho từng sensitive action. Một blanket “admin/owner except roles” không còn là implementation contract. Runtime hiện chưa có registry/grant storage/`authorize`, nên mọi Chat capability consumer vẫn HOLD tới khi core này land.

---

## DD-57 — FE architecture principles · ✅ Chốt FE governance (owner 2026-07-28)

> **Nguồn:** adapt cho Plexco từ reference Sporta, nhưng authority hiện hành là `frontend-architecture.md` và live Next.js App Router stack.

- **Quyết định (✅):** FE là **server-first, feature-first** và mọi async surface có bốn state `loading|ready|empty|error`. Client Component không được import/gọi `@plexco/db`, DB primitive hoặc `tenantRepo`; mọi client mutation/read đi qua web boundary. Server Component và Route Handler được gọi canonical authenticated application service trực tiếp; **không** ép server gọi HTTP ngược vào chính app.
- **Boundary owner:** application service sở hữu authentication/authorization, tenant/RLS context, repository call và DTO whitelist; UI chỉ render typed DTO. Các bất biến còn lại giữ nguyên: tokens-only, i18n `t(vi,en)`, không PII/tiền vào public/client bundle, live envelope `{data,error,meta.requestId}`.
- **Lý do:** giữ một choke-point nghiệp vụ mà không thêm self-HTTP latency/coupling cho server-rendered path; client boundary vẫn fail-closed.
- **Hệ quả:** activate trước product FE; không chặn Session BE. Lint/checklist phải chặn DB import ở client code nhưng không được cấm authenticated server service call hợp lệ.

## DD-58 — FE visual-source→code pipeline · ✅ Chốt FE governance (owner 2026-07-28)

> **Authority:** `design.pen` tại root repo, sau khi tracked và owner-approved; không còn Figma fallback trong active pipeline.

- **Quyết định (✅):** pipeline canonical là **`design.pen → handoff → token-mapping → code → screenshot verify`**. Mapping dùng CSS variables theo stack Plexco, không Tailwind.
- **Traceability:** `// Source:` đặt tại screen/feature visual owner hoặc shared primitive sở hữu quyết định thiết kế; không bắt mọi atom/presentational component lặp comment.
- **Per-screen gate:** chỉ được author handoff/code khi exact `design.pen` node đã tracked + owner-approved và feature Product/BE liên quan ở trạng thái `Reviewed contract`. Thiếu một trong hai thì giữ HOLD.
- **Hệ quả:** template/checklist dùng tên `*-token-mapping.md`; screenshot verification là acceptance bắt buộc, không thay bằng “nhìn gần giống”.

## DD-59 — Design-token benchmark + usage-token governance · ✅ Chốt FE governance (owner 2026-07-28)

- **Value authority:** `standards/design-tokens.md` tiếp tục là source of truth cho giá trị token; `channels/web/design-tokens.md` chỉ là pointer.
- **Benchmark rule:** benchmark là evidence advisory để giải thích lựa chọn, không phải authority và không được điền số liệu chưa đo/xác minh.
- **Alias rule:** chỉ thêm usage/component alias khi một owner-approved screen hoặc product state đã được chấp nhận và có reuse thật; không tạo trước một taxonomy component token mang tính suy đoán.
- **Pencil sync:** variables trong `design.pen` phải khớp `.md` SoT tại gate. Muốn đảo value authority sang `.pen` phải có DD mới, exporter xác định và drift proof chạy được.
- **Hệ quả:** decision này không tự thay active token values; mọi delta giá trị vẫn phải qua propagation/version/visual verification.

## DD-60 — API reference convention (adopt từ Sporta) · ✅ Chốt (owner 2026-07-18)

> **Nguồn:** ported từ Sporta `docs/architecture/sporta-api-reference.md`. Chi tiết: `api-reference-convention.md`.

- **Bối cảnh:** API contract Plexco nằm rải trong từng `BE/feature_*_tech.md §3` + `channels/web/README §7`, chưa có convention thống nhất để aggregate thành một reference.
- **Quyết định (✅):** convention chung: **auth-level legend** ⬜ Public / ✅ Account-Person / 🔑 exact capability / 🔒 provider-authenticated webhook; **response envelope live** success `{data,error:null,meta:{requestId}}`, error `{data:null,error:{code,message,statusCode},meta:{requestId}}` khớp `apps/web/lib/api-envelope.ts`; **format 1-endpoint cố định** (heading + icon + jsonc block Request/2xx/4xx + side-effects). DTO field-whitelist (HARD RULE 2), tenant qua `tenantRepo` (HARD RULE 1); error money/security cite `business-rules.md`.
- **Lý do:** đọc/gộp API đồng nhất; error-code kỷ luật; neo về envelope + HARD RULES đã có.
- **Hệ quả:** Mọi API block **mới hoặc materially changed** phải theo convention này; historical Reviewed specs retrofit khi được chạm, không tuyên bố toàn bộ legacy blocks đã chuyển format. Có thể sinh aggregate reference cho `apps/web` routes.

---

## DD-61 — Feature Session Organize (court + match orchestration) · ✅ Accept in-principle (owner 2026-07-18; build post-P4)

> **Nguồn:** session hỏi feature 2026-07-17 ("thêm feature organize sau khi session bắt đầu: create match, assign player to court, update score"). Spec: `../features/FE/feature_session_organize.md` + `../features/BE/feature_session_organize_tech.md`.

- **Bối cảnh:** `feature_session_management` **cố ý để "ngoài phạm vi"** phần *Đặt sân (court booking)* và *chấm điểm theo môn*. Canonical `schema.ts` hiện **không có** bảng nào cho court/match/score; anchor chỉ có `sessions` + `players`. Bot tham chiếu Bestminton là bot **thanh toán**, không có logic điều phối trận để lift. Đây là feature MỚI hoàn toàn.
- **Quyết định (accepted-in-principle):** thêm aggregate tenant-scoped **hang off `sessions`/`players`**: `session_courts`, `matches`, `match_participants`, `match_sets`, `score_events`. Tên model sport-agnostic nhưng v0.4 **chỉ hỗ trợ hai phía** (`side_count=2`); N-side cần DD riêng. Setup/assignment chỉ khi `status='open' AND now<ends_at`; start/score chỉ khi `status='open' AND starts_at<=now<ends_at`; `past` là thời gian suy ra, không phải session status. Chỉ player `active` đúng tenant/session; không roster song song. `match_participants` là stint: withdraw giữ row lịch sử, replacement/re-entry tạo row mới; partial unique chỉ trên player/slot đang `assigned`. Same-tenant/session composite FK, session→court→match lock order, unique partial index cho assigned player/slot, live court và live set là bắt buộc.
- **Lý do:** đáp ứng điều phối trong buổi nhưng giữ scope có thể chứng minh bằng constraint. V0.4 two-side khớp scoring/assignment hiện được thiết kế; participant stint tránh substitution phá uniqueness hoặc xoá lịch sử; tránh tuyên bố generic N-side trong khi công thức và UI chỉ có hai phía.
- **Hệ quả:** Design đã accepted-in-principle nhưng **chưa vào `schema.ts`, chưa migration/service/runtime**. Build slice dùng **next available monotonic migration** (tên `0014_session_organize.sql` trong spec chỉ minh hoạ, không giữ số) chứa schema+RLS+grants+trigger; **không sửa `0009`** vì DB đã apply sẽ không chạy lại. Delivery sau Session CRUD + Sync, sớm nhất sau P4; canonical phase còn TBD. Đi kèm DD-62/63/64.

---

## DD-62 — Live scoring per-point (append-only ledger) · ✅ Accept in-principle (owner 2026-07-18; build post-P4)

- **Bối cảnh:** owner chọn scoring **live từng điểm** (không chỉ kết quả cuối). Cần theo dõi điểm real-time, undo điểm ghi nhầm, audit ai ghi — mà không silent-mutate điểm cũ.
- **Quyết định (accepted-in-principle):** `match_sets.scores=[side0,side1]` là read model; `score_events` chỉ có `point|reversal`. Point bắt buộc side 0/1; reversal không có side và trỏ cùng tenant/match/set tới một point chưa bị đảo. Correction = reversal + optional replacement point trong một command/transaction. Normal point chỉ khi match `live`. Riêng winning point vừa làm set/match terminal vẫn được undo/correct khi session còn `open`, `now<ends_at`, target là **latest effective point**, `expectedMatchVersion` còn khớp, chưa có scoring/match action phụ thuộc sau nó và court vẫn free hoặc còn gắn đúng match. Reducer append reversal rồi reopen/re-complete set/match; court đã reassigned hoặc dependency không chứng minh được → `COURT_REASSIGNED`/`CORRECTION_REQUIRES_REVIEW`, không mutation. Không có privileged correction sau session end. Ledger bất biến bằng **SELECT/INSERT-only grant + UPDATE/DELETE trigger**; running score derivable. Mọi mutation dùng `processed_commands(tenant_id,command_id)`; score còn có unique command/seq per match. SSE dùng topic server-derived `session:<id>:organize` + outbox DD-07.
- **Lý do:** point/reversal là algebra hữu hạn, audit/rebuild được và khóa được cross-match/double reversal; durable command ledger ngăn double mutation khi client retry.
- **Hệ quả:** Contract đã accepted-in-principle nhưng implementation vẫn inactive. `scoring_mode=none|live`; live yêu cầu target/win-by dương và best-of lẻ dương. Tests cover concurrent seq, duplicate command, immutable DB path, ledger↔materialized, terminal winning-point reopen/re-complete, court reassignment và session-end refusal. Phụ thuộc DD-61.

---

## DD-63 — Assign-to-court engine (4 mode) + phụ thuộc level source · ✅ Accept in-principle (owner 2026-07-18; build post-P4) · 🔗

- **Bối cảnh:** owner muốn cả 4 chế độ xếp người vào sân: **random, manual, cân bằng theo trình độ, xoay tua công bằng**. Trong đó "cân bằng trình độ" cần **rating/level per player×sport** — nhưng **DD-41 đã ghi rõ dependency "level per person×sport CHƯA có source"** (level hiện chỉ là advisory, `sessions.skill_level` đang retire về rank ở DD-08/DD-41).
- **Quyết định (accepted-in-principle):** engine `planAssignment()` sống ở `packages/core/src/organize/assign.ts` (thuần, deterministic seed): `random`, `manual`, two-side `balanced`, `rotation`. Preview trả plan + `basisVersion`; apply re-read roster/history/version dưới session lock, stale thì fail closed. **`balanced` gated bởi level source:** thiếu/untrusted rating → deterministic random + `warnings[]=BALANCED_LEVEL_UNAVAILABLE`. Không thêm session-local rating store trong feature này.
- **Lý do:** tách engine khỏi transport (tránh drift chat/web); 3/4 mode chạy ngay không cần dữ liệu mới; balanced degrade duyên dáng thay vì chặn feature — đồng thời **flag rõ áp lực cần dựng nguồn level per-sport** (đo qua metric tỉ lệ fallback).
- **Hệ quả:** Contract accepted-in-principle + 🔗 phụ thuộc DD-41/DD-08; implementation/rate bucket vẫn inactive. `BALANCED_LEVEL_UNAVAILABLE` là advisory, không phải HTTP-200 error. Assignment preview 10/min/session + 30/min/actor; apply là mutation idempotent riêng.

---

## DD-64 — Organize tenant-private + authz scorer · ✅ Accept in-principle (owner 2026-07-18; build post-P4)

> **🔄 Amend (owner 2026-07-19, qua DD-74):** ngoại lệ **duy nhất** cho "không project organize sang public" = **aggregate của chính actor, do chính actor publish** trên activity card (`matches_played`, `sets_won/lost`, `win_rate`) — **không** tên đối thủ/đồng đội, **không** chi tiết từng set, **không** sơ đồ sân. Board organize và mọi read cross-player vẫn tenant-private nguyên vẹn. Accept-in-principle: exact field chốt tại build time cùng DD-61/62.

- **Bối cảnh:** organize chứa roster-theo-sân + kết quả trận — dữ liệu vận hành nội bộ CLB. Cần chốt (a) không rò ra public, (b) ai được ghi điểm, (c) tham gia trận có tính attendance (DD-42) không.
- **Quyết định (accepted-in-principle):** (a) **không project organize sang public**. (b) DD-56 registry mở rộng exact actions dưới `session.organize` và `session.score`; hai capability **độc lập, không imply nhau**. Co-admin/scorer grant bắt buộc `resource_type='session'`, đúng `resource_id`, expiry không sau session end — không tenant-wide role; owner/admin có built-in access. (c) Read board/SSE chỉ owner/admin, actor có grant organize/score hợp lệ hoặc `players.status='active'` đúng session; waitlisted/left/nonparticipant bị chặn. SSE authorize connect/reconnect **và re-authorize trước mỗi event cùng mỗi heartbeat tối đa 30 giây**; grant/player/session hết hiệu lực thì đóng stream ngay lần check kế tiếp (hard bound ≤30 giây dù không có event). Connection registry/revocation signal được phép đóng sớm hơn nhưng không thay hard bound. Topic server-derived; event/close reason không serialize actor/person/membership/contact/payment/venue-private. (d) Tham gia trận không tự đổi attendance/reliability.
- **Lý do:** giữ fail-closed + field-whitelist public (HR1/HR2); scorer role tái dùng capability registry đã chốt (DD-56) thay vì chế quyền mới; tách organize khỏi attendance để không vô tình đổi reliability/ban logic của DD-42.
- **Hệ quả:** Acceptance đã ghi nhận; phải mở rộng DD-56 registry **và grant storage** trước khi wire API. Point/reversal rate contract: 5/s burst per match + 120/min per actor + dedicated organize tenant bucket 600/min (không dùng generic 200/min tenant bucket cho live score). Assignment preview rates theo DD-63. Tất cả inactive tới khi registry/grant/rate-limit implementation và feature flag tương ứng được land, không phải vì còn chờ owner duyệt. Public/SSE/revocation integration tests bắt buộc, gồm revoke một stream đang mở và chứng minh không event nào phát sau lần recheck thất bại.

---

## DD-65 — Messenger topology hybrid: central Page + optional club Page · ✅ Chốt (2026-07-17)

- **Bối cảnh:** Page-per-club-only loại các CLB không có Facebook Page; central-Page-only lại làm mất trải nghiệm mang thương hiệu và context tự nhiên của CLB đã có Page. Runtime/schema hiện tại chưa implement feature Messenger và `messenger_pages.tenant_id NOT NULL UNIQUE` không biểu diễn được Page trung tâm.
- **Quyết định:** Dùng **một Meta App** và hai loại endpoint: (a) đúng **một active Plexco central Page**, luôn là đường mặc định; (b) tối đa một active tenant Page mỗi tenant, hoàn toàn tuỳ chọn. Hai loại Page phải cung cấp cùng capability host/player; web là parity/fallback cho tác vụ nâng cao, không phải điều kiện để tạo session cơ bản. Registry Page là global-protected vì central Page không thuộc một tenant: `scope='central'|'tenant'`, `tenant_id NULL` chỉ khi central, partial unique cho một central/tenant, `page_id` unique; resolver hẹp, không blanket table grant. **Meta App Secret là deployment/platform secret cấp App**, không lặp theo Page/tenant row. Page access token mới là secret theo endpoint và phải nằm trong narrow protected secret store tách khỏi Page metadata. Migration mới thay schema hiện tại, không sửa migration đã apply.
- **Lý do:** Phủ được 100% CLB ngay cả khi không có Page, vẫn giữ lợi ích branded Page cho CLB có sẵn; một App/adapter/domain core giảm vận hành và tránh hai bot lệch contract.
- **Hệ quả:** Mọi câu chữ “mỗi club bắt buộc nối Page” hoặc “Messenger player-only” bị **supersede**. Onboarding Page là optional. Production readiness vẫn phụ thuộc Meta App Review/Business Verification và policy hiện hành; quyết định này không tuyên bố runtime đã được build.

## DD-66 — Shared role-aware surface và tenant routing fail-closed · ✅ Chốt (2026-07-17)

- **Bối cảnh:** Host tạo session và player join trên cùng Messenger surface cần vừa tiện, vừa không cho phép central/cross-club message chọn nhầm tenant. Page nguồn không đủ làm authorization: central Page không pin tenant, còn user có thể discover/join session tenant khác từ một club Page.
- **Quyết định:** Sau signature + dedup, resolver xác định Page endpoint và Page-scoped identity. Tenant Page chỉ cung cấp **default context**; central Page dùng một eligible tenant tự chọn hoặc server-rendered picker nếu user có nhiều role/membership. Target tenant/session của action chỉ đến từ signed/opaque action, protected public session ref/referral hoặc server-side conversation context; **cấm** lấy tenant/session từ free text, raw client body hoặc raw callback ID. Cross-club action resolve target session→tenant trong protected resolver; source Page tenant chỉ là audit metadata, không phải quyền. Sau đó exact action đi qua DD-56 capability registry rồi gọi cùng domain service với web/Zalo. Thiếu/sai/stale/ambiguous context → từ chối hoặc hiện picker, không đoán.
- **Lý do:** Cho host/player dùng cùng Page mà vẫn giữ tenant isolation, hỗ trợ discovery xuyên CLB và loại logic nghiệp vụ trùng giữa central Page, club Page và web.
- **Hệ quả:** `GET_STARTED`/root menu là role-aware: host, player hoặc dual-role thấy đúng nhóm action. Club Page mặc định local nhưng có “Khám phá tất cả”; central Page hỗ trợ global discovery. Host `/newsession` phải hoàn tất flow cơ bản trong Messenger; adapter chỉ parse/render, không sở hữu rules/capacity/waitlist/authz.

## DD-67 — Page-scoped identity, reachability và một-route delivery · ✅ Chốt (2026-07-17)

- **Bối cảnh:** Messenger PSID và cửa sổ nhắn thuộc Page endpoint; DD-15 chưa chứng minh Zalo `from.id` global xuyên bot/OA. Một Person có thể có identifier khác theo endpoint; reachability `(person, tenant, platform)` không chứng minh endpoint nào còn gửi được.
- **Quyết định:** Channel identity dùng hai keyed HMAC domain-separated: `provider_scope_lookup_hash` cho Page/bot/OA và `platform_user_lookup_hash` cho PSID/`from.id`; uniqueness là `(platform, provider_scope_lookup_hash, platform_user_lookup_hash)`. Messenger scope input là Page id; Zalo scope input là bot/OA id cho tới khi DD-15 có bằng chứng đủ để migrate. Channel binding lưu endpoint registry. Không auto-merge identifier xuyên endpoint bằng tên/alias; chỉ link cùng Person qua verified web account hoặc transactional one-time `link_code` theo DD-50. Reachability/cửa sổ delivery gắn với `channel_identity_id`; eligibility tenant được kiểm tra riêng ở service. Một notification chọn đúng **một** route theo thứ tự: reachable club endpoint của tenant → reachable central/shared endpoint đã link Person → web/kênh khác theo policy; dedup bằng logical notification key, không broadcast trùng.
- **Lý do:** Đây là scope thật của identity và 24h delivery; tránh collision, merge nhầm Person, gửi bằng sai token Page và double notification.
- **Hệ quả:** Schema/BE spec cũ nói `(platform, platform_user_id)` hoặc tenant-level reachability là đủ bị supersede. Raw provider identifiers không lưu plaintext lookup. Outbound delivery phải **chứng minh cấu trúc cùng Person** giữa intent và `channel_identity_id` (composite person-binding FK hoặc narrow claim function tương đương); chỉ bind tenant+platform là chưa đủ vì có thể gửi nội dung Person A tới identity Person B. Nếu dùng hai composite FK qua `notification_deliveries.person_id`, cả hai phải `DEFERRABLE` và Person-merge service phải defer chúng trong đúng transaction re-parent intent + identity + delivery; ràng buộc non-deferrable sẽ khiến không có thứ tự update hợp lệ. Mỗi intent chỉ có **một active logical route** xuyên platform (`pending|sent|unknown`); fallback phải lock intent, terminalize proven-no-send route rồi tạo/activate đúng một route kế tiếp trong cùng transaction. Mỗi exact physical target chỉ có **một live attempt claim**; attempt sequence do server cấp dưới owner lock, không nhận từ caller và không có counter aggregate thứ hai. Worker chết sau khi request có thể đã write ⇒ attempt/logical delivery thành `unknown`, cấm route khác hoặc resend trừ khi provider có idempotency contract đã được chứng minh. Ngay trước mọi first send/fallback/retry, dispatcher phải re-read canonical state theo **type-specific predicate**: reminder vẫn `open|partial` và current policy (gồm explicit final-notice branch nếu được cấu hình); settled/correction giữ exact unsuperseded ledger/event version + original bound Person và membership rule tường minh; owner alert còn exact admin; announcement còn tenant/capability + active/allowed-guest membership + no opt-out; mọi route còn active/reachable/same-Person. Predicate fail thì terminal pre-send skip, không HTTP; không dùng eligibility lúc queue và không blanket-skip mọi `left` vì final notice/historical confirmation có contract riêng. Inbound vẫn dùng được khi user chủ động tương tác; proactive delivery ngoài policy window phải fail-closed/fallback, nên “mọi user luôn nhận được DM” không phải guarantee hợp lệ. Live root schema/runtime chưa có migration này; staged worktree không được tính là implemented.

## DD-68 — Durable interaction, opaque actions và E2E gate · ✅ Chốt (2026-07-17)

- **Bối cảnh:** Create-session là wizard có state; roster/discovery có thể dài hơn giới hạn choice của Messenger. Scattering pending state trong nhiều nhánh handler dễ bypass authz/context-switch; callback mang raw ID dễ replay hoặc cross-tenant.
- **Quyết định:** Một pre-dispatch interceptor sở hữu lifecycle interaction `kind/tenant/step/draft/expires/version/snapshot`; context switch/cancel/expiry clear state. Mỗi consume và final confirm re-authorize capability + tenant status + snapshot, rồi phát một durable command idempotent vào shared service. Mọi button/quick reply chứa opaque server-side action token có TTL, actor/Page binding, target ref, version/snapshot; tối đa **8 business choices/page** cộng Prev/Next/Cancel. Raw tenant/session/member ID không phải authority. Host preview+confirm tạo đúng một `CreateSession` command; player join dùng cùng join core và trả `active|waitlisted|current|rejoin_review` theo DD-45.
- **Lý do:** Một owner state + deterministic actions cho UX tốt mà vẫn bounded, replay-safe và dễ test; shared command/service bảo đảm Messenger và web không trôi business rule.
- **Hệ quả:** Merge gate phải có integration/E2E cho: central+club Page, hai tenant, club không Page, host/player/dual-role, multi-club picker, cross-club join, wrong/stale/expired/replayed action, non-admin denial, duplicate webhook/command, final-slot race/waitlist, provider failure sau commit, 24h closed, delivery priority không gửi trùng, wizard cancel/expiry/context-switch. Schema same-tenant composite constraints cho session/player/surface refs và waitlist state là prerequisite của slice session/join, không được coi live schema hiện tại đã đủ.

---

## DD-69 — Định vị app-native (phase-1 PWA → phase-2 native) · ✅ Định hướng accepted (owner 2026-07-18); technical gates mở

> **Nguồn:** owner định hướng 2026-07-18 ("Plexco là app native; phase-1 build web app PWA, phase-2 là app native"). Đối chiếu docs: BRD §5.2 ghi "app mobile native" ngoài phạm vi, PRD dòng 4 ghi "không app native", ROADMAP không có pha native → ghi định hướng trước khi propagate. **Phân tích framework + shared API contract:** `../decisions/analysis/dd-69-app-native-analysis.md`.

- **Bối cảnh:** Tầng product trước DD-69 loại native khỏi phase-1 và chưa nêu PWA. Autopilot template (`phase1-fable5-*`) đã **plan** S9 `web-pwa-shell` + S20 `pwa-polish`, nhưng live `apps/web` hiện chưa có manifest/service worker; đó là delivery target, không phải implementation evidence. Companion `strategy/native-app-strategy.md` đã tách native push khỏi ChannelIdentity và giữ offline read-only; DD-69 phải kế thừa các boundary đó.
- **Quyết định (accepted direction):** Định vị Plexco **app-first**. **Phase-1 target = web app PWA** (installable/offline app shell; không cache tiền/PII — HR2). **Phase-2 = app native**; RN+Expo là framework recommendation sau spike, chưa accepted. Chat Zalo/Messenger tiếp tục là acquisition 0-install; native phục vụ retention/engagement. Native dùng canonical API với client-safe contracts, không import server-only i18n/money engine. Bearer auth phải có Google PKCE + Apple/equivalent privacy login khi ship iOS; target tenant/action vẫn server-derived. Push dùng protected `device_push_subscriptions` theo person/app-installation, **không** mở rộng DD-67 `ChannelIdentity/channel_reachability`. Offline v1 read-only; không queue money/identity/admin/join mutations.
- **Lý do:** PWA giữ phase-1 dễ tiếp cận và cho phép validate product trước native. RN/Expo giữ một codebase TS nhưng chỉ an toàn khi package boundary, auth, API versioning, push privacy và old-client compatibility được pin. Tách device push khỏi provider-channel identity tránh hai authority plane nhập nhằng; read-only offline tránh replay mutation stale.
- **Go/no-go gate phase-2 native — product evidence (bổ sung owner 18/07):** PWA phase-1 là **bước validate thị trường**, không chỉ là surface giao hàng. **Không khởi động build native** trước khi có baseline phase-1 thật và đủ 4 nhóm bằng chứng dưới đây. Ngưỡng để `TBD` — owner điền sau khi có baseline, rồi cập nhật DD-69 + changelog.
  1. **Retention** — % host còn active sau 8–12 tuần ≥ `TBD`; % player join kèo thứ 2+ trong 30 ngày ≥ `TBD`. Đây chính là chỉ số native được kỳ vọng cải thiện; không đo được thì không chứng minh được ROI của native.
  2. **Liquidity marketplace** — số kèo publish/tuần ≥ `TBD`; **% player join qua discovery** ≥ `TBD` (KPI đã có ở BRD §4.2).
  3. **Monetization** — số tenant `host_pro` đủ bù chi phí **build + maintain** native (hai nền tảng, store fee/review, release cadence) ≥ `TBD`.
  4. **Trigger kỹ thuật — độ tin cậy push của PWA, đặc biệt iOS.** Giá trị lõi phase-1 là **nhắc nợ + xác nhận**, nên phải **đo trong phase-1**: tỉ lệ delivered/opened của web push theo nền tảng, tỉ lệ user add-to-home-screen, độ trễ. Push PWA không đạt ngưỡng vận hành trên iOS ⇒ đây là lý do **đo được** để lên native. Ngược lại **PWA đủ tốt là kết quả hợp lệ để hoãn native** — không coi là thất bại.
     **Yêu cầu instrument (bắt buộc, không được defer):** telemetry này phải được cài **ngay trong slice PWA S9/S20** — `delivered/opened/latency` per platform + trạng thái installed/subscription. Không cài từ đầu ⇒ tới lúc quyết phase-2 sẽ không có baseline và gate #4 thành cảm tính. Telemetry không chứa tiền/PII (HR2). Neo ở `../features/FE/feature_notifications_reminders.md` **NTF-OQ-5**.
  > Gate này **độc lập** với technical gates ở mục Hệ quả: phải pass **cả hai** mới mở build phase-2.
- **Hệ quả:** Hướng sản phẩm đã accepted nhưng **không đổi phase-1 committed scope** và không claim PWA/native đã build. Không đảo DD-10 hay DD-37. Trước build/GA phase-2 phải: hoàn tất PWA evidence; accept framework/platform; tách client-safe contract; khóa `/api/v1`; land bearer/refresh + iOS login compliance; land protected device subscription + privacy-safe push; giữ offline read-only; qua store/external gates. Propagate product positioning ở BRD/PRD/ROADMAP và technical contract ở `../decisions/analysis/dd-69-app-native-analysis.md` + `../strategy/native-app-strategy.md`.

---

## DD-70 — Notify person-directed GLOBAL · ✅ Chốt hướng (a) — global plane (owner 2026-07-21)

> **✅ Owner chốt (2026-07-21): chọn (a) — global plane + inbox toàn Plexco + user config per-type.** Notification là **năng lực toàn Plexco**, KHÔNG bị giới hạn theo tenant: mọi user đều có **một inbox thông báo thống nhất xuyên club**, và **user tự config chọn nhận loại thông báo nào** (per-type opt-in/opt-out, và theo kênh).
>
> **⚠️ Làm rõ để không phá HR2/RLS (interpretation em ghi lại — owner đính chính nếu sai):** "global" = **trải nghiệm/inbox hợp nhất** + **plane global-protected cho event hướng-tới-người**; KHÔNG phải gộp mọi thông báo tenant vào một bảng bỏ `tenant_id`. Lưu trữ giữ **HAI plane**: (1) **tenant durable** (`notification_intents`) giữ RLS cho thông báo trong-club (nhắc buổi, announce host→member DD-71, nhắc tiền); (2) **global protected** (`person_notifications`) cho person-directed cross-club (follow/identity/security). Hai plane **merge ở service layer thành một danh sách** cho user (render qua tenant RLS + narrow function cho global; không cross-plane SQL UNION). **Thêm so với proposal cũ:** `notification_preferences` **theo Person** (chọn loại + kênh), áp **cả hai plane**, fail-safe default (thông báo bảo mật/vận hành tối thiểu không tắt được). Nếu owner thực sự muốn **bỏ hẳn tenant plane** (một bảng global duy nhất) → cần quyết riêng vì đụng trực tiếp HR2 (rò nội dung club thành rò vĩnh viễn) + mất RLS fail-closed; hiện KHÔNG chọn hướng này.
>
> Đây là *impl-gap* do chính DD-47 ghi ra và để mở, không phải scope mới. Spec: `../features/FE/feature_notifications_reminders.md` NTF-OQ-6 + `../features/BE/feature_notifications_reminders_tech.md` §2.2.

- **Bối cảnh:** DD-47 (follow graph) ghi tường minh: thông báo follow-request là **person-directed GLOBAL**, nhưng hạ tầng `notification_intents`/`outbox_events` hiện **tenant-scoped** (`tenant_id NOT NULL` — đã verify ở `packages/db/schema.ts`, `migrations/0008`, `0005`) → **KHÔNG cover trực tiếp**. DD-47 để mở hai lựa chọn và yêu cầu "ghi open item ở `_tech`". Ngoài follow-request, cùng gap này áp cho **link/merge identity** (DD-50) và **security alert** (đăng nhập mới/đổi email) — đều thuộc `persons`, không thuộc CLB nào.
- **Contract đã chốt — phương án (a):**
  - Thêm `person_notifications` (GLOBAL PROTECTED, không `tenant_id`, versioned `event_key` + structural `UNIQUE(type,source_event_id)` qua key rotation, **không cột tiền/PII và không JSON/template params tuỳ ý**; system copy derive từ enum `type`) + explicit reads + durable read-all commands. Phase-1 closed enum chỉ gồm `follow_request|identity_link|identity_merged|security_alert`; `follow_accepted` vẫn là analytics event, **không** phải notification. Không blanket grant cho `app`; owner-only internal append chỉ được exact follow/identity/auth protected mutation gọi sau khi tự derive actor, Person, fixed type và canonical source row/audit — không generic app emit nhận caller-chosen fields. Với `security_alert`, DB derive immutable `trigger_context_started_at <= event_at <= created_at` từ locked session/recovery context và append alert **trước** triggering trust/email mutation trong cùng transaction; route chỉ dùng email `verified_at < trigger_context_started_at` hoặc device `trusted_at < trigger_context_started_at`. Delivery fail không xoá item bền.
  - **Phương án (b) đã bị loại:** không lưu bền, chỉ SSE person-self + in-app inbox (DD-38), sẽ làm follow request mất khi followee offline.
  - Tenant inbox **không có item store/projector thứ hai** — chính `notification_intents` là durable item; `notification_reads` chỉ lưu explicit per-source read state. Mọi insert tenant/global nhận một `inbox_sequence` server-owned từ cùng per-Person fence. Read-all does read-only discovery **outside** the mutation transaction, then opens bounded `READ COMMITTED`, acquires the Person fence first and only in a later statement snapshot captures the boundary + locks/re-authorizes visibility-owner rows + enumerates each plane. This avoids a stale snapshot taken before waiting on the fence. Receipt + exact visible reads commit all-or-nothing; hidden/late item unread, no watermark/pending batch. Cursor bind actor+filter+sequence. Read-dot lookup dùng one-time signed capability bind exact refs returned by authorized list queries; narrow global function only returns actor's intersection, so `app` never SELECTs raw reads or probes arbitrary source UUID. Render qua tenant RLS; merge ở service layer, không cross-plane SQL UNION.
- **Lý do:** Global plane **không có `tenant_id` để RLS bám vào** → không thể dựa RLS, buộc phải là global-protected + narrow function. Denormalize nội dung tenant vào bảng global sẽ biến một lần rò thành rò vĩnh viễn (HR2), nên reference-based render là điều kiện để hợp nhất một danh sách cross-tenant. Durable inbox giải quyết mất event khi offline; trusted out-of-band route mới giải quyết việc nạn nhân không mở app sau một đăng nhập đáng ngờ — hai lớp không thay thế nhau.
- **Hệ quả:** Migration dùng **next available monotonic number tại build time** sau khi sync prerequisite branches, không sửa lịch sử. CI invariant test (no money/PII/arbitrary JSON column, no blanket grant) phải land **trước** khi bật signal projector. Mark-read global tự verify source thuộc actor; mark-read tenant phải đi qua `tenantRepo` visibility check rồi dùng one-time short-lived capability bind actor+tenant+source để global read-writer consume — global function không được bypass RLS bằng source UUID. Missing/wrong actor/currently unauthorized đều cùng opaque 404 và không tạo orphan read. Mọi inbox producer, follow/auth/link emit và Person merge dùng một hierarchy: read-only inventory → inbox fences theo Person UUID → Person/source rows → child/FK rows; set drift rollback/retry, không late-lock. Known phase-1 producers đều có bounded Person set và phải được reorder để append atomically từ canonical protected source/audit. `link_code` consume tạo merge plan nhưng **không** emit notification; merge commit mới append `identity_merged` từ locked `merge_audit`. Tenant `outbox_events` có `tenant_id NOT NULL`, nên tuyệt đối không được dùng như fallback cho global event hoặc gán một tenant giả. Nếu một future global path thật sự không thể fence-first, build HALT tới khi có decision + migration riêng cho GLOBAL PROTECTED source-event/outbox (owner, grants, replay, retention); không được claim projector chưa có. Private→public bulk auto-accept chỉ đổi `person_follows` + analytics, không tạo `follow_accepted` item/fan-out và không lock unbounded follower fences. Merge Person (§P6/DD-01) dedupe explicit reads theo exact source key và re-parent only non-colliding committed read-all receipts; bất kỳ same `command_id` collision nào phải halt/manual vì chưa có alias ledger. Receipt boundary chỉ là audit/idempotency metadata, không phải read authority; survivor fence giữ `GREATEST(source.last_sequence)`. Security-alert tests phải chứng minh future/forged/post-mutation context/event boundaries bị reject và email/endpoint established trong chính triggering session/context không tự trở thành sole trusted route, kể cả factor timestamp vẫn sớm hơn event. Vì tenant `notification_deliveries` không thể sở hữu event global, auth-security slice phải pin exact global delivery-attempt owner/table, unknown/recovery lifecycle và pre-context verified-email/device lifecycle **trước migration/runtime enablement**; tenant `push_unknown_recovery_claim` không được giả vờ xử lý `security_alert`. Không có trusted route vẫn giữ durable item + audit. Cặp `feature_notifications_reminders` v3.5 là **Reviewed contract**; implementation/migration vẫn chưa bắt đầu.
  - **⚠️ Ranh giới với DD-76/77 (corrected v1.64):** DD-70 chỉ chặn **optional durable notification** phát sinh từ activity/kudos. DD-76 feed core đọc global `person_activity_cards` + `person_follows` và có blocker/evidence riêng; DD-77 kudos core add/remove/list cũng được phép ship nhưng **không emit notification** cho tới khi DD-70 chốt global path. Không serialize hai core feature sau DD-70 một cách không cần thiết; nếu chọn (b), chỉ durable activity/kudos notify bị thiếu.

---

## DD-71 — Announcement: tier + cơ sở preview/confirm · ✅ Chốt (owner 2026-07-21)

> **✅ Owner chốt (2026-07-21):** announce cơ bản **FREE mọi tier** (thủ công, khớp DD-40); `host_pro` thêm scheduling/recurring/template/analytics/quota cao hơn. Free vẫn có rate-limit theo actor + fan-out budget + quiet-hours + opt-out. **Preview→confirm bắt buộc** (proof-bound token, consume-once) vì fan-out **không thu hồi được** — cơ sở là "không undo", **KHÔNG phải DD-25** (DD-25 chỉ phủ mutation tiền). Migration mới cho tags + announcements/audiences + quota reservations chờ build; chi tiết impl giữ nguyên bên dưới.
>
> Spec: `../features/FE/feature_notifications_reminders.md` NTF-OQ-9.

- **Bối cảnh:** DD-43 ✅ đã chốt `membership_tags` **chỉ** dùng cho notification audience khi announce, và `BL-NTF-4` đã pin "tag thu hẹp audience, không đổi quyền". `membership_tags` **chưa có migration**. Trước khi DD-71 được draft vào cụm notification (v3.0), chưa doc nào sở hữu luồng broadcast host-authored tới thành viên: `SES-UC-3` chỉ announce **một session lên group đã link**, còn `SES-OQ-6`/`MT-OQ-3` chỉ trỏ DD-43 rồi dừng. Hiện cặp `feature_notifications_reminders` Product/BE v3.5 sở hữu Reviewed contract này; runtime/migration vẫn chưa có.
- **Contract đã chốt:**
  1. **Tier:** DD-40 chốt "thủ công = free, tự động = `host_pro`". Announce cơ bản là **hành động thủ công của host** nên **free ở mọi tier**. `host_pro` thêm scheduling/recurring/template/analytics/quota cao hơn. Free vẫn có tenant+actor command buckets, fan-out budget, quiet-hours và opt-out. Confirm atomically reserves all buckets in durable `announcement_quota_reservations`: structural tenant+actor+command and tenant+preview fences, versioned command/reservation fingerprints, fixed units/status/expiry; reservation + canonical announcement commit/rollback together under ordered bucket locks. Same command+same fingerprint replays; mismatch rejects before reserve. Crash leaves neither; janitor releases only canonical-absent row after proof expiry+grace. Audience decrease no refund; retry-failed no second fan-out charge. Initial `10/ngày · 3/giờ/tenant` remains shadow default, not founder constant.
  2. **Cơ sở cho preview+confirm bắt buộc:** ⚠️ **KHÔNG dùng DD-25** — DD-25 chỉ phủ *human-initiated money-destination change / ledger mutation* (refund STK, cashout, đổi STK); announcement không thuộc nhóm đó. Cơ sở đúng là **không thể thu hồi**: đã fan-out thì không rút lại được. Preview phải phát opaque short-lived token bind `tenant + actor + content_hash(body+session_ref+CTA) + audience_criteria_hash + count_by_channel + total_count + channel-schema/routing-policy version + expiry`; confirm consume-once, re-authorize và chỉ queue đúng content + audience criteria theo proof đã duyệt. Fan-out performs read-only candidate discovery outside the mutation transaction; then bounded `READ COMMITTED` locks every affected Person fence first. Only a later authoritative statement snapshot, while fences are held, locks announcement/audience/tags/membership/preferences/routes, re-authorizes creator+tenant, resolves roster/routes and recomputes vector/version. This avoids a stale pre-fence snapshot. Increase/drift rejects `preview_stale`; pass atomically inserts intents + pinned routes + actual vector. Chỉ vector giữ nguyên schema/policy và giảm theo từng component — không component nào tăng — do member rời/opt-out được phép; report final count. Không snapshot roster trong bảng trung gian; chính canonical intents là kết quả dispatch. Crash rollback về `queued`, không để `sending` treo; cancel chỉ thắng khi row còn `queued`, sau atomic expansion thì không thu hồi được.
- **Lý do:** Nếu tính `host_pro` thì host free mất kênh liên lạc cơ bản với thành viên và sẽ quay lại copy tay sang group — mất dấu, không lọc đối tượng, và mất luôn dữ liệu delivery. Nếu free mà chỉ rate-limit số command per tenant thì một broadcast lớn vẫn trở thành cửa sau để spam; layered quota kiểm soát cả actor lẫn fan-out thật. Proof-bound confirm biến bước preview thành authorization/data-integrity boundary thay vì UI ceremony có thể bị client bypass.
- **Hệ quả:** Migration mới cho tags, canonical announcements/audiences/preferences, durable quota reservations, actor-scoped retry commands và per-intent retry item receipts. Composite same-tenant FKs require `memberships/sessions UNIQUE(id,tenant_id)`; normalized audience-tag rows replace UUID arrays. Canonical row stores exact `body+session_ref+cta_kind` from proof (`view_session` requires same-tenant session); app has no direct content/audience DML and deferred constraint enforces mode↔tag count. **Estimate/debounced count is advisory only:** only a bounded exact snapshot may mint a confirmable preview JTI; over-limit/estimated previews cannot be confirmed. Quota reservation is deferred-bound to the exact announcement/actor/command/JTI and exact recipient units. Dispatch re-hashes immutable content/proof/criteria, resolves roster at dispatch and atomically pins canonical intents/routes; only component-wise vector decrease under same contract passes. Announcement status owns fan-out only; report routed outcomes from deliveries/attempts and skipped/unreachable from intent reason/vector, never fake deliveries. Preference owner remains announcement-only and is rechecked on dispatch/retry. Retry locks intent; any `pending|sent|unknown` blocks and the command is structurally bound to the same announcement/intent/delivery. A `retried` item must, in the same transaction, create and receipt the exact nonempty set of new `planned` physical attempts for still-eligible targets in the already-closed generation; a `skipped` item creates none. Deferred guards reconcile parent counts, item results and physical-attempt child receipts, so a route can never be CASed back to pending with zero runnable work. The retry window expires at `announcement.created_at+24h`; exact replay returns the fixed selected delivery **and** attempt set, never re-selects from changed state. With multiple historical failed routes it filters fresh-eligible routes, ranks by **current canonical route policy then delivery UUID**, then performs that atomic attempt materialization under the one-active-route fence. Tags are NFC/plain-text bounded (64 graphemes/256 bytes, no control/bidi override) and DELETE means irreversible soft-retire so historical audience FKs remain; dispatch locks/rechecks tag rows and distinguishes missing from retired before resolving recipients. Purge/announcement erasure waits the retention/legal gate. Audience remains criteria-only; host body untrusted plain text ≤16 KiB/no markup/log truncation. HR2/DLP limits, tag public/join bans, capability flag and BL-SEC-5 inactive proposal gates remain.

---

## DD-72 — Schema `device_push_subscriptions` + push provider · ✅ Chốt (owner 2026-07-21)

> **✅ Owner chốt (2026-07-21):** schema phase-1 **CHỈ web** (`device_push_subscriptions`, GLOBAL PROTECTED theo Person, endpoint/keys mã hoá, lookup HMAC, trust epoch server-only; native chờ DD-69 phase-2 spike). **Provider = Web Push chuẩn qua VAPID trực tiếp**, KHÔNG thêm vendor SDK (OneSignal/Firebase) phase-1 — xét lại ở native phase-2 nếu lợi ích ops vượt chi phí DPA/subprocessor/coupling. **Payload OS chỉ generic** (opaque logical ref + server-selected `i18n_key`), không tenant/tiền/PII/tên CLB; `buildPushPayload()` là choke-point có CI invariant. Chi tiết lifecycle/rebind/telemetry giữ nguyên bên dưới; migration + `manifest.json`/service worker (S9) chờ build.
>
> Spec: `../features/FE/feature_notifications_reminders.md` NTF-OQ-13 + `../features/BE/feature_notifications_reminders_tech.md` §2.4.

- **Bối cảnh:** Web push được **PRD §164, TDD FR-10, `deployment-infra.md` §162 và BL-NTF-1** gọi là **kênh nhắc chính** của phase-1, nhưng chưa từng được đặc tả: không bảng subscription, không VAPID contract, `apps/web` chưa có `manifest.json`/service worker (chưa có cả `public/`). Thêm nữa, `notification_deliveries.platform` hiện là **`text` không CHECK** và **`route_class` chưa tồn tại** — `platform IN ('web','zalo','messenger')` mới chỉ nằm trong spec v2.5 "runtime migration pending". DD-69 đã **đặt tên** `device_push_subscriptions` và pin ranh giới nhưng chưa chốt cột/kiểu.
- **Contract đã chốt:**
  - **Schema phase-1:** GLOBAL PROTECTED theo Person; only Web `device_push_subscriptions`, encrypted endpoint/keys, keyed lookup HMAC+version, coarse UA enum, status and server-only `trusted_at/trust_source/trust_epoch`. Client registration requires actor-scoped UUID `Idempotency-Key`; trusted boundary mints signed envelope bind actor+command, canonical fingerprint, current+supported-old aliases, ciphertext digests, expiry+JTI. Durable receipt has structural actor+command and JTI fences. Same command/fingerprint hoặc exact consumed JTI returns its fixed historical result; mismatch is zero mutation. **Only a newly accepted external command** increments epoch + resets trust, even with the same key material; minting/replaying a new envelope JTI for the same accepted command never resets again. Cross-Person rebind additionally consumes a signed one-time ownership proof bound to `action='rebind'`, old/current owner, new actor, exact target subscription + accepted endpoint-alias digest, current ownership/trust epoch, external command, canonical issuer/evidence, expiry and JTI; every field is rechecked after locks. Phase-1 chỉ nhận `verified_prior_owner_reauth` — canonical auth xác minh **current owner** rồi ký approval bind exact new actor/target/command — hoặc `manual_recovery` đã audit theo DD-53. `identity_merge` không phải rebind proof: canonical Person merge tự re-parent/reset subscription theo merge lifecycle và invalidate mọi challenge chưa consume. Rebind không update `person_id` in place: với no live attempt/report capability, audited transfer deletes the old secret row so same-Person live FKs become NULL while immutable refs remain, then inserts a **new subscription UUID** cho Person mới và records `rebound`. Trust-elevation proof/evidence là lifecycle riêng, one-time và bind exact current epoch; exact consumed-proof replay returns the historical event without mutating current trust, while a new stale-epoch proof fails. Only verified-email reauth, distinct pre-trusted device approval, or audited manual recovery can elevate trust. All lifecycle timestamps are DB-owned from one transaction time. A newly accepted same-Person registration may reactivate stale/revoked endpoint to `active`, clears lifecycle timestamps/failure count and resets trust; caller-supplied clocks are rejected. Historical refs/receipts/events outlive ordinary secret-row prune; live pointers may become NULL but never re-point to a different historical UUID. Native remains additive only after DD-69 phase-2 spike.
  - **Provider phase-1 — khuyến nghị:** **direct standards-based Web Push dùng VAPID**, không thêm app-level vendor notification platform/SDK. VAPID là application-server authentication, không phải một provider tự host; browser-selected push service vẫn là bên thứ ba trong data flow và A3 phải ghi nhận encrypted payload/traffic metadata. App-level integration như OneSignal hoặc Firebase Messaging chỉ xét lại ở native phase-2 khi lợi ích dashboard/ops vượt DPA/subprocessor/coupling cost; không gọi browser-selected service tự thân là “aggregator”.
  - **Bất biến kèm theo (không phụ thuộc provider):** **payload/OS push copy chỉ generic**. Nội dung nghiệp vụ chỉ có opaque logical ref + server-selected `i18n_key`; protocol metadata được allowlist thêm version, stable Topic/client tag và report capability write-only scope đúng một attempt/event-set. Không có tenant/club ref, tiền/PII/tên CLB; client đã xác thực tự derive tenant từ opaque ref rồi fetch nội dung thật. Registration API nhận endpoint/keys từ browser nhưng bind session person, HMAC lookup + mã hoá trước khi lưu. Secret resolver không có signature nhận raw `person_id`/endpoint và generic web `app` không được EXECUTE; dedicated worker chỉ consume send-claim TTL ngắn, derive person/subscription server-side và audit physical attempt. `buildPushPayload()` là choke-point duy nhất, có CI invariant allowlist/deny-list. Topic/tag token phải là `base64url(HMAC-SHA256(domain='web-push-topic', logical_ref))` bỏ padding rồi lấy **đúng 32 ký tự đầu**; không dùng raw ref/HMAC hex vì RFC 8030 giới hạn Topic ≤32 ký tự base64url và Topic header không được mã hoá/xác thực. Nhiều thiết bị → **một logical delivery** nhưng có physical attempt + telemetry riêng per subscription.
- **Lý do:** Subscription endpoint + khoá cho phép gửi push tới thiết bị người dùng → là **bí mật**, phải xử lý như `channel_identities` (mã hoá, protected, narrow resolver, adapter không nhận endpoint từ caller). Tách khỏi `ChannelIdentity`/`channel_reachability` là yêu cầu của DD-69 để tránh hai authority plane nhập nhằng — device push không có khái niệm "cửa sổ 24h".
- **Hệ quả:** Next monotonic migration depends on DD-67 platform/route/person-attempt fences. Historical delivery uniqueness and `delivery_key` are by `(intent,closed route_class)`, not platform/Page id, so tenant-Page→central-Page fallback cannot collide; a partial intent fence still permits only one live route. Every push writer follows read-only owner discovery → all affected inbox fences UUID-order → lookup-key epoch (`FOR SHARE`; rotation alone `FOR UPDATE`) → one sorted array of domain-separated advisory actor/command/JTI/proof/evidence/alias keys → Person/source/child locks; owner-set drift restarts. Advisory-lock bigint mapping uses a permanent/version-pinned server secret+algorithm so the same semantic key maps identically across workers/deploys; any future rotation is a serialized migration that dual-locks old+new mappings until old workers drain. UNIQUE remains the final fence, not absent-row replay control. Registration/trust live pointers use same-Person composite FKs; immutable historical refs outlive ordinary stale/revoked secret-row prune. Cross-Person transfer is a special proof-bound owner-only delete-old/insert-new lifecycle, never an in-place owner rewrite; it first locks/clears every old live receipt/trust/telemetry pointer and any live attempt/report cap blocks it. The rebind completion guard requires a live new pointer in the consume transaction, but after commit ordinary authorized prune may NULL that pointer while the immutable new-subscription ref and exactly-one rebound receipt remain; it can never re-point. Active Web subscriptions have an owner-controlled initial cap 10/hard ceiling 20 under actor lock; over-limit rejects before command/proof consumption and never auto-evicts a trusted device. Trust elevation issuers are canonical verified-email reauth, a durable distinct pre-trusted-device challenge/ack, or audited manual recovery. Issuance and event rows structurally bind original immutable actor ref, live Person, target, epoch, source/evidence, fingerprint/key version and expiry; a deferred exactly-once guard permits only `issued` with zero event, `consumed` with one exact event, or `expired` with zero event. Cross-Person rebind is narrower: only current/prior-owner reauth approval or audited manual recovery may authorize it; Person merge is a separate re-parent/reset path and never mints/consumes rebind proof. Generic app cannot mint either proof class. Owner-only status transitions write one `transaction_timestamp()` and enforce lifecycle/success times `>= created_at` plus `revoked_at >= stale_at` when both exist. Ordinary prune uses `GREATEST(created_at, COALESCE(stale_at,'-infinity'), COALESCE(revoked_at,'-infinity'), COALESCE(last_success_at,'-infinity')) <= transaction_timestamp()-interval '180 days'` and still requires no live attempt/report cap. Person merge resets every re-parented subscription, never re-points an audit pointer to another UUID, invalidates unconsumed rebind challenges and halts any command-receipt collision without an alias ledger. Worker/core roles lose broad DML; planned→claimed→started→terminal functions own attempts. Start distinguishes whole-intent invalidation, exact target invalidation and quiet-hour defer; whole-intent skip is allowed only before any possible write, while sent or sticky unreconciled unknown outranks later cancellation. Successful start returns an exact-target send authorization; only that token can resolve one secret or mark that derived target stale. Once logical sent is established, unstarted normal-retry/recovery rows are cancelled and can never claim; only initial `(attempt_seq=1,recovery_wave=0)` rows already pinned in the closed generation may still start. Evidence=`sent` applies the same cancellation, while evidence=`terminal_no_send` may leave an already-authorized retry pending; any row that already crossed `send_started_at` remains possible-write evidence and is never erased. `unknown` after possible write stays sticky across later no-send recovery and forbids alternate route until canonical evidence resolves it; only tenant settled/correction has ≤2 same-route recovery waves with persisted Topic/version, while reminder/announcement are evidence-manual and security alert awaits DD-70 global owner. Canonical provider/device evidence ingestion must atomically reconcile its exact unknown attempt or create a durable evidence job keyed by that evidence; caller never supplies outcome, attempt or Person. S9 ships manifest/SW and telemetry. Raw telemetry remains protected/no PII, with `event_key=HMAC(domain='push-telemetry', canonical_json([attempt_ref,event]))` + persisted key version and structural `UNIQUE(attempt_ref,event)`. Report cap binds exact attempt/event set and expires `send_started_at+24h`; delivered/opened only follow successful display/click evidence and carry non-null server-calculated latency. Dashboard separates iOS/Android/desktop+installed. Gate thresholds remain TBD from baseline.

---

## DD-73 — Share link + preview card cho session · ✅ Chốt (owner 2026-07-19) — build **tách hai slice**

> **Nguồn:** session hỏi feature 2026-07-18 ("share session/kèo, share activity cho từng player, tham khảo Strava"). Phân tích: `../decisions/analysis/dd-73-78-share-activity-analysis.md` §2.

- **Bối cảnh:** Plexco **chưa có** share surface nào cho session. Chỉ có (a) `public_sessions` — projection marketplace để **khám phá**, không phải một URL chia sẻ có preview, và (b) DD-44 `session_invite_tokens` — **capability bearer** cho kèo private. Cám dỗ trực tiếp là dùng luôn invite token làm nút "Share", nhưng link share bị forward/screenshot/đăng lại group ⇒ đó là **capability rò rỉ không kiểm soát**, và `max_uses`/revoke của host mất hết ý nghĩa.
- **Quyết định (✅ owner 2026-07-19):** contract dưới đây được chốt. **Q5 — tách hai slice:** phần *safety fence + guarded public view + narrow raise/CAS-clear functions + `public_projection_version` + grant migration chuyển consumer khỏi base table* **thuộc về DD-12/marketplace**, làm vì marketplace đang thiếu đường deny tức thì (hiện privacy-reducing change phải chờ projector async) — **không** tính là chi phí của share. **DD-73 đúng nghĩa** = route `/s/<id>` + OG card + funnel telemetry dựng trên nền đó. Chốt contract **không** đồng nghĩa mở lịch build.
- **Đề xuất (đã chốt, giữ nguyên nội dung):**
  - **Hai loại link, không bao giờ trộn.** `/i/<token>` = invite (capability, DD-44, kèo private). `/s/<session_id>` = **share (không phải capability)** — chỉ render khi guarded `public_session_share_v` có row: `public_sessions` chưa hết `expires_at` và không có active public safety fence. `public_sessions` không có `visibility/status`; row là hệ quả projector đảm bảo, route không đọc/check `sessions`. Không có guarded row ⇒ fixed generic, không tiết lộ session có tồn tại hay không.
  - **Renderer OG bị ràng buộc vào guarded public view.** View chỉ project cột từ `public_sessions` và anti-join `public_projection_fences`; không bao giờ đọc `sessions`, fence không thêm content. **Ngoại lệ cột duy nhất:** `public_projection_version` (control metadata non-PII) được phép nằm trong view vì DD-78 dùng nó làm authorization-before-cache gate. Vì crawler không xác thực, ràng buộc này biến HR2 thành thuộc tính cấu trúc. Field = đúng **`BL-DSC-1`**, không lấy DDL `0006`: `sport_key`, `starts_at/ends_at`, `area`, `price_amount`, `confirmed_count` (active players), `slots_open` (trừ active + live payment holds), `club_display_name`, `host_display_name`, `join_policy` + `title`, `session_type`, `level_min_rank/level_max_rank/level_strict`, `gender_restriction`, `age_min/age_max`; hold count/identity không public và `skill_level` đã retire. `confirmed_count` là additive target field của DD-32, chưa có trong live projection.
  - **Guarded view là authority cho cả marketplace + share** *(khối này **do DD-12 sở hữu** theo Q5 re-scope; ghi ở đây vì DD-73 là consumer)*: migration mới revoke current `readonly` SELECT trên base `public_sessions`, giữ projector write, grant guarded view. Mọi public discovery consumer migrate sang view; nếu marketplace còn đọc base thì fence không bảo vệ surface đó.
  - **CẤM trên card:** venue chính xác (DD-06), roster/tên người tham gia, nợ/charge, SĐT/email, **`gender` của người chơi** (PII, DD-39 — **khác** `gender_restriction` là session policy và **được phép** theo BL-DSC-1/DD-41), membership tag (DD-43), attendance/reliability (DD-42), organize/score (DD-64).
  - **Immediate deny + stale-copy boundary:** session private/cancel/close raise/replace random fence token **cho surface `session_share`** trong cùng source transaction; guarded landing/image deny trước async projector. ⚠️ **Fence `activity_card×session` chỉ raise khi `cancelled`/session bị xoá** — **không** raise theo `closed`/`private`: `closed` là trạng thái kết thúc bình thường và chính là nguồn eligible của DD-74, nên fence theo `close` sẽ revoke card của **mọi** player ngay khi host đóng kèo. Projector chỉ CAS-clear exact observed token sau projection convergence. Public projection có monotonic `public_projection_version`; every request gate trước byte cache. Bên thứ ba đã fetch có thể giữ ảnh, Plexco không thu hồi được; TTL + purge chỉ là optimization.
  - **Share link không cấp quyền join.** CTA chỉ gửi protected join intent/ref tới canonical Join service; service resolve target server-side rồi re-check live `visibility/status/capacity/join_policy/eligibility` dưới đúng tenant context. Stale projection, raw `session_id` hoặc `share_ref` không được bypass DD-05/32/41/45/52.
  - **OG contract server-render đầy đủ:** `og:title`, `og:type=website`, locale-specific `og:url`, `og:image` + dimensions/type/alt và `og:description`; HTML/canonical URL và image bytes cùng đọc một guarded snapshot. Mọi text/attribute context-escape, URL build từ server allowlist; không raw HTML/URL từ snapshot, không phụ thuộc client JS.
  - **i18n (HR5):** crawler không mang locale người dùng ⇒ **không** suy từ `Accept-Language`; locale lấy từ chính link (`?l=vi|en`), default `vi`, text qua `t(vi,en)`.
- **Acquisition telemetry là hard requirement cùng slice:** đo `share_initiated → share_landing_viewed → join_started → join_succeeded` bằng random opaque `share_ref` TTL/retention bounded; không nhúng raw person/tenant/membership id, PII, roster hoặc tiền. Tách known crawler fetch khỏi human view; conversion lấy từ server-side join outcome, không từ click client tự khai.
- **Lý do:** Đây là slice **acquisition**: link kèo lan ra Zalo/Messenger kéo về discovery — thẳng hàng KPI "% player join qua discovery" (BRD §4.2) và gate product-evidence #2 của DD-69. Nó cũng là phần **rẻ nhất** của cụm vì `public_sessions` đã whitelist sẵn; không cần bảng mới.
- **Hệ quả:** ⚠️ **Q5 re-scope (✅ 2026-07-19): khối `public_projection_fences` + guarded public view + narrow raise/CAS-clear functions + `public_projection_version` + revoke `readonly` base grant + migrate consumer sang view nay THUỘC DD-12/marketplace**, không tính là chi phí DD-73 — marketplace cần nó dù không bao giờ có share (hiện private/cancel phải chờ projector async mới hết lộ). **DD-73 đúng nghĩa = route `/s/<id>` + OG card + funnel telemetry** dựng trên nền đó. Phụ thuộc **(a)** marketplace projector DD-12 P4.3 và **(b)** projection migrations của **DD-41/DD-32**: BL-DSC-1 target whitelist (`confirmed_count`, `title`, `session_type`, `level_*_rank/strict`, `gender_restriction`, `age_min/max`, bỏ `skill_level`) **chưa tồn tại đầy đủ trong `public_sessions`** (`0006:11-27` vẫn còn `skill_level` và thiếu các target field), nên trước khi migrations đó land, card chỉ render **tập con field thực có** — tuyệt đối không bù bằng cách đọc `sessions`. Propagate vào `feature_marketplace_discovery(.md/_tech)`. Test rate-limit/anti-scrape, base-deny/view-whitelist/fence-race và byte-level no exact venue/roster/PII/charge/debt/allocation; `price_amount` chỉ từ BL-DSC-1/`public_sessions`.

---

## DD-74 — Activity per player = read model, không phải fact table mới · ✅ Chốt (owner 2026-07-19; sau dependency + reprioritization)

> Phân tích: `../decisions/analysis/dd-73-78-share-activity-analysis.md` §3. **Đây là chỗ dễ sai nhất của cả cụm.**

- **Bối cảnh:** Strava activity = bản ghi **một chủ sở hữu**, sinh ra hậu sự kiện. Plexco `sessions` = **event của tenant, nhiều người tham gia**. Không map 1-1. Copy thẳng model Strava sẽ tạo bảng `activities` song song với `players` — đúng cái bẫy HANDOFF §8 ("tạo bảng song song với khái niệm đã có") và vi phạm §P6/HR3 vì sinh **nguồn sự thật thứ hai** cho cùng một sự kiện (host sửa attendance thì hai nguồn lệch ngay).
- **Quyết định (✅ owner 2026-07-19):** contract dưới đây được chốt, kèm hai lựa chọn sản phẩm: **Q1 — phase-1 KHÔNG gắn tên CLB lên card cá nhân** (phương án (a)). Dual-consent (`allow_club_attribution` + person opt-in) giữ nguyên làm **đích đến**, bật sau bằng đường additive — vì ở phase-1 dual-consent cho ra **đúng cùng hành vi** (mọi card đều OFF) nhưng tốn 2 setting + 2 UI + test tổ hợp thiếu-một-phía. **Q4 — amend DD-64: ĐỒNG Ý, accept-in-principle**; exact field v2 chốt tại build time cùng DD-61/62, không thiết kế trước.
- **Đề xuất (đã chốt, giữ nguyên nội dung):**
  - **Activity = read model** trên `players ⋈ sessions` (+ DD-42 attendance), **KHÔNG** phải thực thể mới. `players` là row **per-membership**, nên nó chứng minh source participation chứ **không** tự cấp quyền publish cho actor hiện tại.
  - **Authority + eligibility fail-closed:** actor chỉ lấy từ verified Person-self (web/magic link hoặc channel identity đã link theo DD-50), không từ client-supplied `person_id/membership_id/player_id`. Dưới lock, resolve Person → membership → player/source session; thiếu/ambiguous/identity freeze thì reject. Chỉ publish khi `now >= ends_at`, session không cancelled, player không waitlisted và attendance DD-42 hiện hành=`present`; host không duyệt nhưng cũng không được publish thay player. Eligibility mất về sau ⇒ auto-revoke/tombstone, không sửa canonical history và không auto-republish.
  - **Hai tầng theo owner:** **v1** = `sport_key`, `played_on` (ngày, không giờ chính xác), optional `area`, `scheduled_duration_minutes` từ `starts_at/ends_at` (**không** gọi là thời lượng player thực chơi), và previewed `activity_display_name ← persons.display_name`. Attendance chỉ là eligibility predicate nội bộ, **không** serialize `attended=true`. Phase-1 không caption/title free-text, không fallback sang membership/tenant alias. **DD-48 approve field nhưng live schema/accepted contract chưa có public-name sanitation/report-takedown guarantee**; slice phải định nghĩa và land sanitation + canonical-name report/takedown trước public enablement, không tuyên bố “reuse” một guarantee chưa có và không tạo owner thứ hai. **v2** (khi DD-61/62 land) thêm `matches_played`, `sets_won/lost`, `win_rate`.
  - **Quy tắc mở rộng bắt buộc:** card có `schema_version`; field **chỉ thêm, không đổi nghĩa**; v1 **vắng mặt** field v2 (không fill `null` giả) và renderer phải chịu được. Không version hoá bằng nhân bản bảng.
  - **⚠️ v2 cần AMEND DD-64, không được lách.** DD-64 đã chốt "không project organize sang public"; `matches_played`/`sets_won` **là** organize đi ra ngoài. Ngoại lệ đề xuất **duy nhất**: **aggregate của chính actor**, do **chính actor publish**, **không** tên đối thủ/đồng đội, **không** chi tiết trận/điểm từng set, **không** sơ đồ sân. Board organize và mọi read cross-player vẫn tenant-private nguyên vẹn.
  - **Attribution — hai đường rò tinh vi:** (a) **tên CLB trên card cá nhân = rò roster theo chiều ngược.** ✅ **Chốt phase-1: KHÔNG gắn tên CLB, không có cơ chế bật và không dựng setting/field/fence target attribution chưa dùng.** Dual-consent (person opt-in + tenant `allow_club_attribution`) giữ làm **đích đến tương lai**, thêm sau bằng migration/contract additive — ở phase-1 nó cho ra cùng hành vi (mọi card OFF) nhưng tốn 2 setting + 2 UI + test tổ hợp. Khi/nếu bật, value chỉ từ canonical moderated `club_display_name`, không raw `tenants.name`/membership alias/client text; personal tenant luôn OFF. (b) **đồng đội/đối thủ phase-1 KHÔNG HIỆN**; B public card của B không phải consent để bị tag trên A, nên USR-OQ-8 giữ mở tới consent scoped+revocable. (c) địa điểm giữ `area`-level DD-06.
  - **⚠️ Ranh giới với DD-48 open item (1) — card ≠ profile field.** DD-48 chốt "aggregate excluded tới khi có model" và để mở item (1) *stats/aggregate cross-tenant*. Card **là** aggregate cross-tenant, nên phải pin rõ nó **KHÔNG** mở item đó: card là **một buổi, do chủ sở hữu publish từng cái, revoke được từng cái**; profile aggregate là **tổng hợp mọi buổi, suy tự động từ `memberships`/`players`** — đúng thứ DD-48 cấm. Publish card **không** kéo theo quyền hiển thị "tổng số buổi", "số CLB", "streak" trên profile; muốn có thì vẫn phải đóng DD-48 item (1) bằng quyết định riêng.
- **Lý do:** Giữ đúng một canonical store cho sự kiện tham gia; tránh bài toán đồng bộ khi correction xảy ra. Hai tầng cho phép ship giá trị trước khi Session Organize (post-P4) land, mà không khoá contract. Tách card khỏi profile aggregate giữ được nguyên tắc "user khoe cái gì thì lộ cái đó", thay vì biến việc share một buổi thành bật hồ sơ hoạt động suy diễn.
- **Hệ quả:** **Không** thêm fact table. Phụ thuộc Session CRUD + **DD-42 attendance** (chưa có migration) + Person-self claim/link DD-50. v2 phụ thuộc DD-61/62 **và** amend DD-64. Propagation khi build: neo USR-OQ-4 vẫn mở; **giữ USR-OQ-8 mở** và cấm co-participant phase-1; `feature_session_organize(.md/_tech)` + DD-64 ghi ngoại lệ self-aggregate.

---

## DD-75 — Publish lifecycle, audience, projector-owned snapshot, revoke · ✅ Chốt (owner 2026-07-19; đi cùng DD-74 để tạo baseline)

> Phân tích: `../decisions/analysis/dd-73-78-share-activity-analysis.md` §4.

- **Bối cảnh:** Field đã whitelist vẫn **đổi được sau khi share**: host sửa session metadata/attendance (DD-41/42), correction điểm (DD-62); nếu attribution được bật bằng contract tương lai thì còn có rút consent. **DD-49 money correction không phải trigger** vì tiền/charge/allocation bị cấm khỏi snapshot; nối projector vào event tiền chỉ tăng coupling và bề mặt rò. Đồng thời người xem card có thể ở ngoài tenant ⇒ không thể để họ đọc bảng tenant-scoped (HR1).
- **Quyết định (✅ owner 2026-07-19):** **Q2 — activity mới tạo ra ở trạng thái `draft`; user chọn `followers` hoặc `public` tại thời điểm publish** (phương án (a)). **KHÔNG** auto-publish, kể cả opt-in — auto-publish mâu thuẫn confirm-per-publish và chỉ có lãi khi đã có volume chưa tồn tại; nếu sau này muốn, phải amend DD-75 tường minh chứ không suy ra từ chốt này.
- **Đề xuất (đã chốt, giữ nguyên nội dung):**
  - **Chọn (C) — snapshot do projector sở hữu + re-project khi source đổi**, thay vì (A) live-render (đụng HR1, correction âm thầm đổi nội dung đã chia sẻ) hay (B) snapshot bất biến (sai vĩnh viễn sau correction). Đây đúng khuôn `public_sessions` đã có.
  - **User KHÔNG BAO GIỜ ghi trực tiếp vào snapshot** — làm vậy là multi-master (HR3). User ghi **ý định**; projector ghi **nội dung**.
  - **Hai plane, bốn store tách trách nhiệm:** tenant intent; global card snapshot; hash-only slug registry; generic GLOBAL PROTECTED denial-only `public_projection_fences(surface,target_kind,target_id,fence_token,deny_scope,reason,timestamps)`. `surface ∈ session_share/activity_card`; activity targets phase-1 = share/session/person/tenant. `tenant_attribution` chỉ được thêm bằng migration additive khi feature attribution thật sự được bật. Slug registry có nullable `card_id`, terminal tombstone detach trước card deletion. Fence không chứa/ghi snapshot content.
  - **Deterministic source key + applied state bắt buộc:** tenant share có monotonic `publication_version`; global card phase-1 có internal-only `source_tenant_id/source_session_id/source_player_id/source_share_id`, `person_id`, `applied_publication_version`, HMAC `source_fingerprint`, `projection_schema_version`, `snapshot_hash`, `card_version`, timestamps, global `card_state` và `audience`. Fingerprint bao phủ normalized allowlisted inputs + eligibility + sanitizer/schema versions, không raw PII. Consent/`club_attribution_included` chỉ được thêm khi attribution feature được bật bằng contract additive. Uniques giữ idempotency; internal refs/tenant id không public DTO/URL/FK giả.
  - **Ordering/reconcile + immediate deny fail-closed:** publish/audience/revoke tăng `publication_version`; privacy mutation raise token cho affected surfaces. Fence writes qua typed narrow functions: session/share/current-tenant target derive+verify server-side, person target identity-service-only; không generic client target, reason enum đóng, token không trả/log. Tenant/app không fence tenant khác/person-global hay clear; exact-token clear projector-worker-only. Correction event chỉ wake reconcile; worker lock/re-read current sources. Version/fingerprint fault fail closed; duplicate no-op. Mỗi projector clear surface token sau mọi target rows hội tụ; token mới thắng stale worker. Source delete raise all-fences + durable revoke trước deletion.
  - **Slug lifecycle:** `/a/<slug>` dùng CSPRNG entropy ≥128-bit, chỉ mint cho active `published+public`; lưu domain-separated hash/HMAC, không raw slug; tối đa một active slug/card. Invalid/tombstoned/non-public/fenced cùng fixed 404. Public→followers/revoke tombstone; re-publicize mint slug mới, old hash vĩnh viễn 404. Terminal retention detach trước card deletion; lookup narrow/global-only.
  - **Grants theo khuôn `0009:11-18` + DD-47:** base/fence không blanket grant cho `app`/`readonly`; narrow `SECURITY DEFINER` đọc/raise/clear đúng quyền. `public_activity_cards_v` có cột tường minh + `WHERE card_state='published' AND audience='public'` và anti-join active fence; `card_state` là global column, không tenant `publication_state`. ⚠️ **View này KHÔNG `GRANT SELECT` cho `readonly`** — crawler đi `/a/<slug>` qua app + narrow `SECURITY DEFINER`, không đọc DB; cấp `readonly` SELECT trên view = một **danh bạ activity cross-person duyệt được không cần slug**, phá anti-enumeration của chính cụm và tạo discovery surface chưa ai quyết định (surface public đã chốt duy nhất là `public_sessions`, có BL-DSC-4 anti-scrape). View giữ vai trò **cưỡng chế cấu trúc** column allowlist + fence anti-join cho narrow function. Followers path cũng deny `deny_scope='all'`. `draft` không có global row. Revoke ghi `card_state='revoked'` + tombstone; card row giữ qua retention rồi scrub/minimize/xoá. Draft chỉ owner preview.
  - **Published intent ≠ delivery proof:** tenant transaction ghi desired `publication_state='published'`, nhưng API trả `202/PUBLISHING` + opaque operation ref và **không trả public URL** cho tới global card/current asset/slug CAS-activate. Projection status derive từ delivery ledger + global projection, không là user-writable field/source of truth thứ hai. Render/reconcile retry bounded/DLQ và có owner-visible failure/retry/revoke path; không fail-open card thiếu current image/gate.
  - **Profile visibility và activity audience độc lập.** Một card explicit `public` là narrow per-card override chỉ cho snapshot `activity_display_name ← persons.display_name` + fields đã preview; không mở profile route/aggregate/card khác. `memberships.display_name`/tenant alias không được fallback. Confirm phải liệt kê field/audience public, không auto-upgrade từ profile setting.
  - **Correction/lifecycle + DB↔renderer boundary:** correction tăng `card_version`, giữ `published_at`. External render/CDN không nằm trong DB transaction; job key `(card_id, applied_publication_version, source_fingerprint, card_version, operation)`. Initial publish/followers→public và benign correction render private staging, re-lock/re-read, chỉ CAS-activate khi current version+fingerprint khớp. Name/eligibility correction, public→followers, identity conflict/freeze, erasure/source loss hoặc revoke raise appropriate fence **cùng source transaction**, deny old global delivery trước, rồi projector update/purge/render và CAS-clear observed token; new image được phép tạm 404. **Future-only:** nếu attribution feature được bật, rút consent cũng đi đúng flow này và re-project bản không tên CLB. Followers→public cần confirm; revoke/mất eligibility không auto-republish.
  - **Revoke không thể thu hồi bản sao ngoài Plexco.** Origin phải fixed 404, slug không tái sử dụng, mọi version bị invalidated; publish confirm nói rõ screenshot/download/cache bên thứ ba không thể xoá từ xa.
  - **Retention/erasure:** sau revoke/erasure, scrub global snapshot content + render artifacts theo matrix USR-OQ-3/legal; card row có thể minimize/xoá sau audit window. Trước card deletion, tombstoned slug detach `card_id=NULL`; chỉ **`activity_card_slugs.slug_hash`** + state/timestamps và non-PII audit tối thiểu được giữ để old URL không sống lại. Exact SLA là enablement gate, không tự đặt trong DD này; canonical tenant history có retention riêng.
  - **Fail-closed:** thiếu source, actor proof, attendance=`present` hoặc eligibility ⇒ **không publish**, không đoán. `persons.display_name` trống ⇒ không project; không fallback sang membership/tenant alias.
  - **Merge Person (§P6/DD-01):** card không keyed chỉ bằng `person_id`; re-parent person/reaction actor và chỉ collapse khi deterministic source key trùng. Lock/canonicalize/drop-self/collapse exact duplicate trước update survivors, cùng transaction/audit.
- **Lý do:** Đặt snapshot ở **global plane** không phải để tiện, mà vì DD-76 (feed) là cross-tenant: nếu snapshot nằm ở tenant plane thì feed buộc phải nới grant hoặc bypass RLS — đúng cảnh báo DD-70 về UNION cross-plane. Tách "ý định" khỏi "nội dung" giữ đúng một writer cho dữ liệu công khai.
- **Hệ quả:** Migration mới monotonic thêm activity stores + generic safety fence, guarded views và narrow raise/CAS-clear functions; không sửa `0009`/lịch sử (`0014` đã merge, còn activity migration vẫn pending). Privacy-reducing mutation phải fail closed nếu không raise được fence. CI invariant test + canonical-name report/takedown + USR-OQ-3 retention SLA phải land/close trước projector enablement. Chỉ allowlisted source events DD-41/42/62 + lifecycle re-project; attribution event chỉ thêm khi feature attribution được bật; money DD-49 bị loại. Chưa có schema/code. Contract đã ✅ chốt 2026-07-19; DD-74/75 chưa vào queue ngay nhưng **không nằm sau social evidence gate** — chúng phải tồn tại để tạo chính activity baseline mà DD-76/77 dùng.

---

## DD-76 — Feed hoạt động (fan-in trên follow graph) · ✅ Chốt contract (owner 2026-07-19); build **gated bởi product-evidence**

> Phân tích: `../decisions/analysis/dd-73-78-share-activity-analysis.md` §5. **Phụ thuộc DD-47/48 (build P4+).**

- **Bối cảnh:** `person_follows` là **global** (không `tenant_id`, DD-47); activity source là **tenant-scoped**. Đây đúng gap mà DD-70 đang mở cho notification: feed **không được** query bảng tenant-scoped (HR1) và **không được** `UNION` cross-plane trong SQL (buộc nới grant hoặc bypass RLS).
- **Quyết định (✅ owner 2026-07-19):** contract feed được chốt, nhưng **build vẫn gated bởi product-evidence/liquidity gate**. Telemetry share→join của DD-73 được review trước khi ưu tiên DD-74/75; sau đó chính baseline DD-74/75 (eligible activity, publish rate, accepted-follow liquidity, feed non-empty projection) mới là dữ liệu quyết định có mở DD-76/77 hay không. Chốt contract ở đây để đóng băng thiết kế, không phải để lên lịch.
- **Đề xuất (đã chốt, giữ nguyên nội dung):**
  - Feed đọc **hoàn toàn trong global plane** — chỉ `person_activity_cards` (DD-75) ⋈ `person_follows`, nên tự thừa hưởng whitelist và không cần đường đọc mới vào tenant plane.
  - **Fan-in, không fan-out:** query card của tập followee + phân trang keyset `(published_at, card_id)`. Correction giữ nguyên `published_at`, chỉ đổi `updated_at/card_version`, nên card cũ không tự boost lên đầu feed. Fan-out nhân bản dữ liệu và làm merge identity khó kiểm soát.
  - **Audience tại read time:** `public` → ai cũng thấy; `followers` → chỉ `person_follows.status='accepted'`; `card_state='revoked'` hoặc safety fence deny scope phù hợp → không vào feed; `draft` không tồn tại ở global plane. Unfollow, block, fence hoặc audience downgrade có hiệu lực ở lần read kế, không snapshot follower list.
  - **Block (DD-55):** loại **hai chiều** bằng canonical `chat_blocks`; không tạo store block thứ hai.
- **Product-evidence gate:** hướng kiến trúc không đồng nghĩa lịch build. Chỉ mở DD-76/77 sau khi DD-73/74/75 có baseline thật và owner đặt ngưỡng `TBD`, tối thiểu: eligible ended activities/tuần, tỷ lệ player publish ≥1 card, tỷ lệ active Person có ≥1 accepted follow và feed non-empty rate. Không đạt ⇒ tối ưu share/discovery trước, không dựng social surface cho graph rỗng.
- **Lý do:** Audience/block phải re-evaluate mỗi read để downgrade có hiệu lực ngay trong Plexco; feed fan-in giữ một source snapshot và giảm chi phí merge/revoke. Evidence gate bảo đảm dự án chỉ trả chi phí vận hành social graph khi có liquidity thật.
- **Hệ quả:** Chặn bởi DD-47/48 (framework ✅, build P4+), DD-75 và product-evidence gate độc lập với technical gates. Không bảng mới ngoài DD-75. Không tiền/PII/roster trong feed theo cấu trúc. Notify cho hoạt động của người mình follow (nếu có) thuộc đúng gap **DD-70** — không tự dựng đường notify thứ hai.

---

## DD-77 — Kudos & comment · ✅ Chốt (owner 2026-07-19): kudos-only, comment deferred; build gated cùng DD-76

> Phân tích: `../decisions/analysis/dd-73-78-share-activity-analysis.md` §6.

- **Bối cảnh:** Strava có kudos + comment. Plexco chưa có reaction nào. DD-55 đã nâng **block + report + rate-limit** thành **hard enablement gate** cho open-DM. **Không doc nào sở hữu moderation cho comment công khai**: CHT-OQ-2 chỉ hỏi về quyền host trong **club channel** (xoá/ẩn/mute) — surface tenant-scoped **có chủ sở hữu rõ ràng**; comment dưới activity card sống ở **global plane không có host**.
- **Quyết định (✅ owner 2026-07-19):** **Q3 — ship kudos, defer comment** (phương án (a)). Comment chỉ mở khi có (i) safety stack DD-55 và (ii) một OQ moderation mới cho surface global-plane không-có-host. Kudos cũng nằm sau cùng evidence gate với DD-76.
- **Đề xuất (đã chốt, giữ nguyên nội dung):**
  - **Ship kudos sau evidence gate:** `activity_reactions` GLOBAL PROTECTED, `UNIQUE(card_id, person_id)`; `PUT/add` và `DELETE/remove` idempotent tường minh (không dùng tap-again mơ hồ). Không free-text ⇒ không cần **content moderation**, nhưng vẫn bắt buộc actor session-bound; add/list resolve qua guarded visibility nên active fence được coi như card không tồn tại; own-remove vẫn được cleanup mà không mở card/actor list; block hai chiều, per-actor/per-card rate-limit, undo, abuse audit; fence/revoke ẩn reaction và chặn notify; Person erasure/card deletion cleanup hoặc anonymize theo USR-OQ-3, không dangling. Không lộ danh tính người kudos ngoài audience.
  - **Defer comment** cho tới khi qua đúng safety gate DD-55 **và** mở/đóng một **open question moderation mới cho surface global-plane** (ai xoá, ai nhận report, ai chịu trách nhiệm khi không có host) — **không** tái dùng CHT-OQ-2 làm gate vì nó không phủ trường hợp này.
- **Lý do:** Comment công khai dưới card có bề mặt lạm dụng **rộng hơn DM** (người lạ, hiển thị cho bên thứ ba, khó gỡ). Mở comment trước khi có moderation là đi ngược chính cái gate vừa dựng ở DD-55 — và một lần nữa, không nới fail-closed chỉ vì đây là feature "nhẹ".
- **Hệ quả:** Chặn bởi DD-76 + evidence gate. Merge Person phải collapse duplicate reaction trước update (khuôn DD-47/DD-75). Reaction **không** sinh notification mới cho tới khi DD-70 chốt đường person-directed global.

---

## DD-78 — Ảnh share mặc định do Plexco render · ✅ Chốt (owner 2026-07-19): template-only, không upload phase-1

> **Nguồn:** owner 2026-07-18 — *"mỗi player đều share được activity của mình với ảnh mặc định từ Plexco"*. Phân tích: `../decisions/analysis/dd-73-78-share-activity-analysis.md` §7.

- **Bối cảnh:** Strava có ảnh vì có **route GPS** để vẽ bản đồ hoặc ảnh người dùng chụp. Plexco **không có cả hai**: không track GPS, và **DD-48 đã chốt `avatar` excluded tới khi có model**. Nghĩa là hiện **không tồn tại nguồn ảnh cá nhân hợp lệ nào** — ảnh mặc định do Plexco render không phải giải pháp tạm, nó là lựa chọn **duy nhất đúng** với contract hiện tại.
- **Quyết định (✅ owner 2026-07-19):** **Q6 — chỉ template do Plexco render, KHÔNG cho upload ở phase-1** (phương án (a)). Upload mở lại chỉ khi có đủ media safety stack DD-55 **và** một quyết định riêng cho ảnh công khai (EXIF strip bắt buộc, moderation trước hiển thị, takedown path) — không suy ra từ DD-55.
- **Đề xuất (đã chốt, giữ nguyên nội dung):**
  - **Ảnh = server-rendered template**, sinh từ **đúng guarded snapshot đã whitelist** (`public_session_share_v` cho card kèo DD-73; `public_activity_cards_v`/protected card function cho DD-75). Renderer không query canonical; active safety fence làm snapshot unavailable, không thêm field.
  - **KHÔNG cho upload ảnh ở phase-1.** Upload kéo theo: **EXIF chứa toạ độ GPS chính xác của sân → phá thẳng DD-06** (`area`-only), moderation media UGC **công khai** (khó hơn DM — xem DD-77), storage/bandwidth abuse, và rủi ro bản quyền/ảnh người khác trong khung hình. Template không nhận upload/caption nên không cần media-moderation pipeline mới, nhưng vẫn render canonical text do user/tenant kiểm soát (`persons.display_name`, session title, host/club name) ⇒ sanitation + report/takedown cho text source vẫn là enablement gate.
  - **⚠️ Tách hẳn khỏi media store DD-55.** Chat media nhận byte UGC, private + signed read + malware scan. Share-card subsystem chỉ render server-side: session/`published+public` dùng **public URL/CDN namespace qua guarded origin**; draft/followers dùng protected ephemeral path. Object store phía sau không anonymous-readable/listable; chỉ renderer/origin credential đọc được và object key không là alternate public URL. Namespace/credential/endpoint tách khỏi chat media và **không tái dùng `/api/chat/media/:id/access`**; dùng chung grant có thể rò DM ra internet.
  - **Một template system versioned**, dùng design tokens + sport icon/palette variant theo `sports` (DD-08). Không bắt mỗi môn có layout/asset riêng trước share-CTR evidence; unknown sport dùng generic variant. Bespoke per-sport layout chỉ là additive optimization sau telemetry.
  - **Renderer sandbox/injection boundary:** typed allowlisted text phải NFC-normalize, strip/reject control + bidi-override, có grapheme/byte limits và context escaping; không raw HTML/SVG/CSS/URL interpolation. Chỉ bundled fonts/icons/assets trong read-only allowlisted directory; worker không network egress, cloud metadata, arbitrary filesystem hay secret access. Output raster PNG exact MIME/dimensions, metadata stripped; không serve dynamic SVG/HTML. Canonical sanitation không thay context escaping.
  - **Deterministic internal key, opaque public URL:** render/cache key nội bộ dùng `(session_id, public_projection_version, locale, template_version)` hoặc `(card_id, card_version, locale, template_version)`, nhưng public image path chỉ mang domain-separated HMAC/opaque `image_ref`, không raw card/source/person/tenant id. Mỗi current public version có ref riêng; correction tạo URL mới **và** invalidate/purge mọi origin version cũ.
  - **Authorization-before-cache là authority, purge chỉ là optimization:** mọi request, kể cả CDN cache hit, qua guarded delivery/origin gate trước byte cache. Session image chỉ trả khi guarded session view còn đúng current `public_projection_version`; activity image chỉ khi global card còn `card_state='published'`, `audience='public'`, requested `card_version` current và không bị fence deny. Old version/active fence/downgrade/revoke/projection removal đều fixed 404 dù purge lỗi; direct bucket/object URL không tồn tại.
  - **Chỉ pre-render public khi snapshot `published+public`**, không render public on-demand theo crawler request. Publish/followers→public render private staging rồi verify-current/CAS trước activate; render lỗi/fingerprint đổi thì chưa public, staging cleanup và status vẫn `PUBLISHING`/failed — không share URL. Benign correction dùng cùng flow; privacy-reducing correction/downgrade/revoke deny DB/delivery version cũ trước rồi purge/render current, chấp nhận image tạm 404. Draft preview và `published+followers` image là authenticated ephemeral/protected render từ đúng allowlisted input, không ghi public CDN namespace và không có stable unauthenticated URL.
  - **i18n (HR5):** text trên ảnh qua `t(vi,en)`; locale từ link (`?l=`), không từ `Accept-Language` của crawler.
  - **Quyền publish thuộc về player đủ điều kiện:** mỗi player có verified Person-self + eligibility DD-74 có đường tự publish, không cần host duyệt. Host không publish/chặn thay player; player chưa claim/link được identity phải qua DD-50, không hạ authz để đạt khẩu hiệu “mọi player”. Phase-1 card **không mang tên CLB** (Q1 ✅), nên không có input attribution nào cho renderer; dual-consent chỉ là đích đến tương lai.
- **Lý do:** Ảnh là thứ quyết định link có được bấm hay không, nên nó là **kênh acquisition** chứ không phải trang trí — nhưng cũng là bề mặt rò rỉ mới (ảnh đi ra ngoài, không thu hồi được, crawler cache lại). Ràng buộc renderer vào snapshot đã whitelist + cấm upload giữ được giá trị phân phối mà không mở thêm đường rò nào.
- **Hệ quả:** Không bảng domain mới ngoài DD-75, nhưng DD-73/75 cần safety fence + guarded views + `public_projection_version`; renderer không đọc canonical. Cần template system, sandboxed no-egress worker, sport variants, private-to-origin object store và render budget. Test money/PII bans; malicious HTML/SVG/CSS/URL/bidi/control/overlong inputs không execute/fetch/read secret; PNG exact MIME/dimensions/metadata-free; opaque URL; `PUBLISHING` không URL trước CAS; fence deny trước projector/cache hit; stale worker không clear token mới; direct object denied; old versions 404 dù purge fail; detached tombstone; out-of-order correction; không dùng chat-media endpoint/bucket. Phase-2 upload chỉ khi đủ DD-55 + quyết định ảnh công khai riêng.

## DD-79 — Home personal dashboard (PWA) — fork từ Sporta · ✅ Chốt (owner 2026-07-19): composition-only, landing S9, defer host-receivable & streak

> **Nguồn:** session so sánh Plexco↔Sporta 2026-07-19. Spec proposal ban đầu: `../features/FE/feature_home.md` v0.1 (index v2.36); canonical pair hiện tại là Product v0.6 + BE v0.2. Tham chiếu: Sporta `feature_home.md` v2.5 + design `app-design-opus-4.6.pen` (hero recipe đã distill vào `../channels/web/theme-direction-2026-07.md` §7).

- **Bối cảnh:** PWA phase-1 (DD-69, S9/S20) chưa có màn landing sau đăng nhập; web shell hiện không có personal dashboard. Sporta Home chứng minh pattern hiệu quả (chips tài chính + hero next-session + suggested sessions + onboarding checklist). Plexco đã có đủ backbone contract: `player_view` person-self (FR-8, cross-tenant own data), `public_sessions` whitelist (HR2), notifications §A (reviewed), bảng `onboarding_steps` (migration `0008`).
- **Quyết định (✅ owner 2026-07-19):** chấp nhận toàn bộ defaults của đề xuất — (1) composition-only, (2) landing S9, (3) HOME-OQ-1 **(c) defer** (chip Chưa thu host chờ contract riêng) · HOME-OQ-2 **yes, S9** · HOME-OQ-3 **defer streak** (phase-1 chỉ đếm kèo tuần). Spec pair được promote Reviewed ở Product v0.2 + BE v0.1; canonical pair hiện tại đã reconcile lên Product v0.7 + BE v0.3 (`../features/BE/feature_home_tech.md`) mà không đổi decision boundary.
- **Quyết định (✅):** Home là **composition surface** — không bảng mới, không đường đọc mới vượt person-self/public boundary; một aggregate DTO thuộc `player_view`. HOME-OQ-1 defer host-receivable phase-1, HOME-OQ-2 landing S9, HOME-OQ-3 defer streak; phase-1 chỉ đếm kèo tuần.
- **Nav final:** phase-1 render **Home · [Khám phá FAB] · Club · Setting**; Feed giữ registry slot nhưng config-OFF tới DD-76 evidence gate. `Kèo của tôi` là sub-screen person-self của Home, không phải tab. Chat ở header cạnh Notifications. Registry là một ordered config duy nhất; không user customization phase-1.
- **Rationale:** Home/person-self, Khám phá/public acquisition và Club/membership context là ba vai khác nhau. Cấu trúc này giữ first-screen value, acquisition và club context mà không mở thêm RLS/authz surface.
- **Hệ quả:** S9 thêm composition screen + aggregate endpoint person-self; không migration. Suggested cards phải giữ HR2; host-receivable cần design-probe riêng nếu reopen.

## DD-80 — Auth credential lifecycle + live boundary · ✅ Chốt/implemented một phần

- **Decision authority:** provider-neutral verified email, verify-first registration, OIDC collision fail-closed, hash-at-rest single-use email tokens, password/Argon2id floor và account-level `session_epoch`/session `minted_epoch` revoke-all contract giữ nguyên theo B0/G3.
- **Live truth (`main@784bc8d`):** D0a, D0b, email-token core, Google adapter và d1b đã merge qua migrations `0015`–`0018`; Safari macOS+iOS M3 đã measured PASS. Hai commit sau runtime snapshot `2dc9b8c` chỉ là Chat authority/readiness docs.
- **Enablement boundary:** Google login chưa có enable/go-live proof. Email provider/order 4 vẫn OFF và email password provider bundle chưa build; merged schema/core không đồng nghĩa provider đang bật.
- **Authority refs:** `../probes/b0-auth-credential-lifecycle-design-probe.md`, `../probes/g3-revoke-all-concurrency-probe-seed.md`, `../features/BE/feature_web_auth_onboarding_tech.md` và `../features/BE/auth-security-invariant-table.md`.

## DD-81 — Pencil + target theme direction · ✅ Chốt direction (owner 2026-07-28)

> **Nguồn:** theme-direction §5/§7 và canonical root `design.pen`. Decision này chốt target direction nhưng chưa mở FE implementation gate.

- **Bối cảnh:** root `design.pen` hiện tồn tại dưới dạng untracked/local WIP; nó chưa là visual authority. Active `design-tokens.md` vẫn mang Indigo/Outfit.
- **Quyết định (✅):** tool = **Pencil**, canonical file = root `design.pen`; target direction = **Candidate C Energetic Orange `#FF5A1F`**, **Sora** cho heading và **Inter** cho body. Contrast probe: white on orange = `3.118:1` (FAIL WCAG AA normal text), dark `#22100A` = `5.874:1` (PASS), nên target `--on-primary` phải là dark nếu direction được activate.
- **Authority/gate:** file chỉ thành authority sau khi tracked + owner-approved; variables phải khớp `standards/design-tokens.md` SoT. Visual review, WCAG evidence và source tracking đều phải PASS trước khi thay active token values hoặc lift FE HOLD.
- **Lý do:** machine-readable + verify được máy móc (drift audit DD-59; handoff sinh từ `get_variables`/`batch_get` — đúng luật bước 8 playbook, chống "code từ trí nhớ ≈30% sai"); file local git-tracked, không phụ thuộc license/cloud; đội đã có kinh nghiệm và reference thật từ Sporta.
- **Hệ quả:** active Indigo/Outfit và current token values giữ nguyên. Designer có thể hoàn thiện `design.pen`, nhưng handoff/code vẫn HOLD; sau gate dùng `*-token-mapping.md` + pixel-perfect handoff + screenshot verification. Không migration/runtime; không đổi code-readiness.

---

## DD-82 — Tournament = aggregate độc lập · ✅ Chốt hướng (owner 2026-07-21)

> **✅ Owner chốt (2026-07-21): tournament = aggregate riêng** (xác nhận direction 2026-07-20). Không gom session, không tái dùng `sessions`/`players`. Live schema chưa có `session_type='tournament'`, nên tournament cần migration aggregate mới nhưng **không có session backfill/enum removal trên live data**. v1 gọn (canonical `tournaments` + bảng đăng ký + `public_tournaments` read model); bracket/standings/entry-fee = slice sau. **Build vẫn chờ:** analysis doc + spec pair (Product/BE) + readiness gate riêng trước code.
>
> **Nguồn:** owner direction 2026-07-20, ratified 2026-07-21 (session chia-sẻ URL).

- **Bối cảnh:** DD-41 hiện gộp "tournament" thành MỘT giá trị của `session_type` (`social|class|coaching|tournament|singles`) và tự cảnh báo field này trộn 2 trục (format vs intent), nâng cấp cần backfill + đổi contract. Owner quyết tournament là **type độc lập**, khác session, có URL riêng — nên nó không còn là một biến thể của session.
- **Quyết định (✅):** Tournament là **aggregate riêng**, KHÔNG gom session và KHÔNG tái dùng `sessions`/`players` (vì `players.session_id` là FK cứng tới session). v1 **gọn**: (1) canonical `tournaments` — tenant-scoped + **RLS fail-closed** như mọi bảng nội bộ; (2) bảng đăng ký/participant riêng của tournament; (3) `public_tournaments` — PUBLIC read model, **field-whitelist**, KHÔNG tiền/PII, **KHÔNG serialize `tenant_id`** (internal routing only), để URL share (DD-83) đọc qua guarded view. DD-41 không được thêm `tournament`; live schema chưa có giá trị này nên không backfill/enum removal. Bracket / standings / entry-fee (money model riêng: charge/reconcile) = **slice sau**, không thuộc v1.
- **Lý do:** "Độc lập" đúng mô hình owner muốn và tránh ép session gánh 2 khái niệm; tách read model public giữ HR2 (tiền/PII không ra public). Giữ v1 gọn để không phải nhân đôi toàn bộ bộ máy join/waitlist/payment của session ngay từ đầu.
- **Hệ quả:** DD-41 nhận cross-ref để cấm thêm `tournament`; tournament aggregate cần migration monotonic mới + analysis/spec pair trước code. Money/bracket là dependency mở của v2. Chưa migration/runtime; cần readiness gate riêng khi vào build.
- **Analysis (2026-07-21):** `../decisions/analysis/dd-82-tournament-analysis.md` — canonical facts, 3 options (A `session_type='tournament'` reject, B container-of-sessions cân nhắc, C aggregate độc lập chọn), retire-sequencing với DD-41, hard-rules check, deferred (entry-fee/bracket), OQ.
- **OQ chốt (owner 2026-07-21, phục vụ readiness gate slice-1):** **TRN-OQ-1** (ai được đăng ký) = host config `registration_policy ∈ {members_only, approval, anyone}` (chỉ member / cross-club có duyệt / bất kỳ user Plexco; `approval` dùng `pending`+host duyệt). **TRN-OQ-5** (retire sequencing) = nhánh (a): DD-41 **không bao giờ** thêm `'tournament'` khi migrate → không backfill, tournament slice độc lập không đụng `sessions`. Còn TRN-OQ-2/3/4/6 (waitlist/entry-fee/bracket/roster-disambiguator) = out-of-scope slice-1, giữ mở.
- **Spec pair (Draft; current Product v0.1 + BE v0.2a):** `../features/FE/feature_tournament.md` + `../features/BE/feature_tournament_tech.md` — data model `tournaments` + `tournament_registrations` (tenant-scoped/RLS) + `public_tournaments` read model (whitelist, không tiền/PII, không serialize `tenant_id`); v1 không đụng tiền; bracket/standings/entry-fee = slice sau. **Live-truth pin:** `session_type`/`tournament` **không** xuất hiện trong `packages/db` hiện tại → "retire" là coordinate DD-41 (chưa migrate), không phải backfill dữ liệu live. Specs = Draft, **chưa readiness gate**, không phải Reviewed contract.

---

## DD-83 — URL scheme thống nhất + slug/handle registry dùng chung · ✅ Chốt hướng (owner 2026-07-21)

> **✅ Owner chốt (2026-07-21): session dùng OPAQUE SLUG** (ví dụ `/session/x7k9m2`), đóng open point "raw-UUID vs opaque-slug" theo default đã đề xuất — **thay wording `/s/<id>` của DD-73**. Thống nhất 4 loại `/user/<handle>` · `/club/<slug>` · `/session/<slug>` · `/tournament/<slug>` dùng chung registry (mở rộng DD-75): rename → tombstone link cũ, reserved words, mọi URL public chỉ đọc guarded view, KHÔNG lộ `tenant_id`/PII. **Build vẫn chờ:** định nghĩa handle uniqueness (global) + reserved-word list + collision policy trong spec + readiness gate.
>
> **Nguồn:** owner direction 2026-07-20, ratified 2026-07-21. Mở rộng registry hash-only của DD-75 (vốn chỉ phục vụ session share) thành hạ tầng chung.

- **Bối cảnh:** Hiện chỉ `/s/<id>` (DD-73) được chốt cho session, club dùng deep link `club_<slug>` (RTE-UC-4, sticky context). DD-75 đã chốt **slug registry hash-only + tombstone-on-rename** nhưng chỉ trong phạm vi session. Owner muốn một hệ URL nhất quán cho 4 loại: user, club, session, tournament.
- **Quyết định (✅):** Mở rộng registry thành **hạ tầng chung 4 loại**: `plexco.app/user/<handle>`, `/club/<slug>`, `/session/<slug>`, `/tournament/<slug>`. Bất biến chung: (a) **rename → tombstone link cũ**; (b) **reserved words**; (c) mọi URL public **chỉ đọc guarded view**, KHÔNG đọc canonical, **KHÔNG lộ `tenant_id`/PII**. Session dùng **opaque slug final** (ví dụ `/session/x7k9m2`) thay UUID thô và thay wording `/s/<id>` của DD-73. User/club/tournament dùng human-readable slug/handle.
- **Lý do:** Một registry + một luật tombstone/guarded-view cho cả 4 loại dễ test bất biến hơn 4 cơ chế rời; opaque slug cho session giữ đúng lựa chọn chống-enumerate/rotatable của DD-75; human-readable cho user/club/tournament đáp ứng UX owner muốn.
- **Hệ quả:** DD-73/DD-75 nhận cross-ref 🔄 (route `/s/` → `/session/<slug>`, registry mở rộng scope); phụ thuộc DD-12 (guarded public view + safety fence) như DD-73; cần định nghĩa handle uniqueness (global) + reserved-word list + collision policy trong spec. Chưa migration/runtime.

---

## DD-84 — Player public profile default-public phase-1 (đảo scope DD-74) · ✅ Chốt hướng (owner 2026-07-21)

> **✅ Owner chốt (2026-07-21):** profile mặc định **public**, tách field theo độ nhạy: (1) default-public an toàn = handle (tự chọn, đổi→tombstone) + môn + karma + kudos + tổng buổi; (2) **activity history mặc định LÀM MỜ** (coarsened, không venue+time cụ thể, không co-participant), player **tự bật** chi tiết; (3) **trẻ vị thành niên: ép off** chi tiết bất kể config. Handle không auto-derive từ tên thật. **Đảo DD-74.** **Build vẫn chờ (hard):** child-safety review + cập nhật HANDOFF HR2 wording (phân biệt "PII định danh" vs "hành-vi/vị-trí nhạy cảm mặc định-mờ") + định nghĩa consent state + minor detection + readiness gate; đọc qua guarded public read model, không canonical.
>
> **Nguồn:** owner direction 2026-07-20, ratified 2026-07-21. Đảo DD-74 (chốt 2026-07-19: activity gated sau evidence gate, v2 post-P4, phase-1 no club attribution).

- **Bối cảnh:** Owner muốn `plexco.app/user/<handle>` **mặc định public**, hiển thị môn chơi, lịch sử activities, karma, kudos. Trao đổi 2026-07-20: các field môn/karma/kudos KHÔNG phải PII cổ điển (đúng), nhưng **activity history gắn venue+time** = bản đồ vị trí + lịch sinh hoạt của một người cụ thể ⇒ vector theo dõi/an-toàn, nhạy hơn cả email; và default-public cho tất cả (kể cả trẻ vị thành niên, player vào qua bot chưa từng biết có trang web) là posture rủi ro.
- **Quyết định (✅):** Profile mặc định **public**, tách field theo độ nhạy: (1) **default-public an toàn** — handle (tự chọn, đổi được → tombstone theo DD-83), môn chơi, karma, kudos, tổng số buổi; (2) **activity history mặc định LÀM MỜ** — dạng tổng hợp/coarsened (ví dụ "cầu lông ~3 buổi/tuần"), KHÔNG venue+time cụ thể, KHÔNG co-participant; **player tự bật chi tiết** qua config nếu muốn; (3) **trẻ vị thành niên**: chi tiết activity **ép off** bất kể config. Handle **không auto-derive từ tên thật** để player kiểm soát mức lộ danh tính.
- **Lý do:** Giữ được profile mở/sinh động owner muốn mà không biến activity thành công cụ theo dõi mặc định; field-split + default-mờ + child-safety off là mức thoả hiệp tôn trọng HR2 ("PII/an-toàn không ra public") mà vẫn cho player quyền chọn công khai chi tiết.
- **Hệ quả:** DD-74 nhận cross-ref 🔄 (đảo: bật player-public sớm hơn, thêm consent/visibility model + child-safety gate); **HANDOFF HR2 wording** cần cập nhật để phân biệt "PII định danh" với "hành-vi/vị-trí nhạy cảm mặc định-mờ"; cần định nghĩa consent state + minor detection; đọc qua guarded public read model (không canonical). Chưa migration/runtime; cần readiness gate + child-safety review trước build.

---

## DD-85 — Disambiguation tên hiển thị trùng ở tầng UI/con người · ✅ Chốt hướng (owner 2026-07-21)

> **✅ Owner chốt (2026-07-21):** áp rule "collision-aware display", disambiguator mặc định = **`pay_code`**. Owner thêm direction: **mỗi user/player phải có bộ field hồ sơ** `display_name` + `id` + **`avatar` (ảnh nhỏ)** + **`gender`** + các thông tin cần thiết khác → dùng làm thông tin phân biệt trên surface con người.
>
> **Reconcile với quyết định/hard-rule đã có (interpretation em pin, owner đính chính nếu sai):**
> - **`display_name`, `id`:** đã có (`persons`/`memberships`). `id` là UUID (máy dùng, người không nhìn), `pay_code` là khoá vừa-unique-vừa-người-đọc-được → làm disambiguator chính.
> - **`avatar` (mới — chưa có field):** thêm field ảnh nhỏ, lưu ở object store private-to-origin, key tách PII. Phase-1 chỉ host/authenticated (roster, host picker, self, người trong club); **không public**. Muốn public avatar sau này phải mở DD mới sau child-safety review.
> - **`gender`:** đã bị ràng buộc bởi **DD-39 + DD-54** — PII, mã hoá (`gender_enc`), thu theo consent/config, **KHÔNG ra public**. Giữ nguyên: chỉ hiện ở surface host/authenticated khi đã thu thập + consent; không lên trang public.
> - Disambiguator hiển thị = `pay_code` (chính) + avatar + gender (nếu đã có/consent) + display_name, **chỉ host/authenticated**; không đưa PII/avatar ra public read model ngoài phạm vi DD-84/DD-48 cho phép.
>
> **Build vẫn chờ:** field avatar (migration + storage) + gender surfacing (DD-39/54) + canonical normalization + luồng host-add-member spec hoá + readiness gate. Avatar-public không thuộc phase-1.
>
> **Nguồn:** session review 2026-07-21, ratified 2026-07-21. Đây là **contract mới cần build**, không mô tả symbol đang có.

- **Bối cảnh (live repo truth):**
  - **Không có "tên hiển thị theo từng session".** Dòng roster `players` chỉ giữ `membership_id` (`packages/db/schema.ts:276-306`; `0002_tenants_core.sql:133-145`), unique `(tenant_id, session_id, membership_id)`. Tên trên roster **resolve từ `memberships.display_name`** (cấp tenant, nullable — `schema.ts:169`, `0002:27`). Không có cột display-name cấp session ⇒ thao tác "user chọn tên hiển thị cho buổi" **chưa có chỗ biểu diễn**.
  - **`memberships.display_name` KHÔNG có unique constraint** (chỉ unique `(tenant_id, person_id)` active/guest + `(tenant_id, pay_code)` — `schema.ts:175-178`). Hai member cùng "Minh" trong một club là hợp lệ, hệ thống nhận âm thầm; không auto-suffix/auto-number/hỏi-lại ở đâu.
  - **Identity nội bộ an toàn:** mọi thứ (charge, roster, đối soát) key theo `membership_id`/`person_id`/`pay_code`, **không bao giờ theo tên**. `display_name` "không phải identity proof" (`identity-model.md:52`); "không auto-merge bằng tên" (`:287`). Bot phân giải đúng người ngay cả khi trùng tên.
  - **Rủi ro là human-facing, chưa được chặn bởi design:** (a) render roster hai dòng "Minh" giống hệt, không gì phân biệt bằng mắt; (b) **host add player** — luồng này **chưa build** (web chưa có route roster/player; `packages/db/src/tenant.ts` chỉ có `sessions.list/getById/create`; `feature_session_organize_tech.md:10` ghi "Chưa có OrganizeService…"), và chưa có member-picker nào; khi build, nếu picker chỉ hiện tên thì host có thể chọn nhầm Minh này thành Minh kia, guard DB duy nhất `(tenant_id,session_id,membership_id)` chỉ chặn add trùng **cùng** membership, không chặn chọn sai membership cùng tên.
  - Collision-handling duy nhất trong repo là **money-adjacent**: DD-26 alias-norm trùng → hỏi lại tương tác; matcher "Minh" vs "Minh Tran" fail-closed sang manual (`packages/core/src/matching.ts:330-343`). Cả hai **không** áp cho render roster / picker đăng ký.
- **Quyết định (✅):**
  1. **Reaffirm:** `display_name` là nhãn hiển thị, không phải khoá; giữ nguyên non-unique. **Không** auto-suffix/auto-merge theo tên; không thêm cột display-name cấp session trừ khi có nhu cầu sản phẩm rõ ràng.
  2. **Canonical collision:** exact equality sau `NFKC → trim → collapse whitespace → locale-safe casefold`, giữ dấu tiếng Việt. Không fuzzy, không token-subset (`Minh` không collision với `Minh Trần`).
  3. **Collision-aware display:** khi ≥2 active/guest membership trong cùng tenant collision theo rule trên, mọi human-read/select surface phải kèm `pay_code` mặc định; avatar/gender chỉ phụ trợ khi đã có consent và chỉ host/authenticated.
  4. **Host-add guard:** picker luôn submit `membership_id`. Nếu tên collision đã có trên roster nhưng là membership khác, bắt buộc explicit confirm với disambiguator trước commit; không resolve theo tên.
  5. **Ràng buộc:** chỉ surface **host/authenticated**; avatar không public phase-1, gender theo DD-39/DD-54 consent, phone không dùng. `pay_code` chỉ là membership disambiguator, không đổi ngữ nghĩa đối soát.
- **Lý do:** Correctness đã được bảo toàn ở tầng dữ liệu nhờ khoá ID; lỗ hổng nằm ở nơi **con người nhìn vào tên** để quyết định (đọc roster, host chọn add). Dùng `pay_code`/avatar/ngày-join đã có sẵn là chi phí thấp, không cần model mới, tôn trọng HR2 và DD-50 (không phone). Gộp cả hai tình huống (self-registration + host-add) vào một rule để test bất biến một chỗ thay vì hai cơ chế rời.
- **Hệ quả:** normalization, disambiguator và host-add confirm đã chốt; build còn cần avatar storage, consent-aware DTO, host-add-member spec, tests và readiness gate. Chưa migration/runtime.

---

## DD-86 — In-app multi-channel per CLB · ✅ `DECISION_FINAL` (owner 2026-07-28)

> **Status boundary:** owner đã ratify toàn bộ decision matrix. Đây là decision authority, **không authorize migration/runtime/code**. Exact machine readiness chỉ nằm tại `../decisions/analysis/dd-86-in-app-multi-channel-analysis.md` và primary plan §13.

- **Model — Option B:** giữ `kind IN ('club','dm')`, cho phép N club channel/tenant. `title`, `sort_order`, `post_policy`, `is_default`, `assistant_enabled` và creator chỉ hợp lệ cho club; DM bắt buộc các field club-only, creator và `tenant_id` đều `NULL`.
- **Provisioning:** mọi active membership được auto-provision vào **mọi active club channel** trong cùng transaction với channel-create/membership-activate; retry-safe và rollback toàn bộ khi thiếu một row. Private/subset membership là phase sau.
- **Announcements:** mỗi tenant có một admins-only Announcements chat channel, nhưng nó chỉ là conversational surface; DD-71 vẫn sở hữu canonical announcement/audience/preferences/quota/intents/deliveries. Không ghi per-recipient DD-71 fan-out thành chat message source of truth.
- **Creation/authz:** DD-86 chỉ sở hữu hai capability lifecycle/posting: actor có `chat.channel.manage` mới được create/manage/archive/set-default; restricted posting dùng `chat.channel.post_restricted`. Hai key resolve qua DD-56 canonical registry; unknown/unavailable/missing/expired grant đều deny và `chat_members.role` không là tenant authority. `chat.message.moderate`/`chat.member.mute` thuộc duy nhất DD-95.
- **No public route:** không public/shareable channel URL/slug phase-1. Q5 được đóng bằng negative scope này; nếu mở sau phải có DD83-compatible guarded route riêng.
- **Assistant:** server derive mặc định `assistant_enabled=true` cho `post_policy='all_members'` và `false` cho `post_policy='admins_only'`. Chỉ actor có `chat.channel.manage` được đổi flag trên **cả hai** policy. Persist/project/consume chỉ khi channel flag **AND** tenant config **AND** entitlement `assistant_ai_kb` **AND** provider/privacy/cap gates đều PASS; unknown/unavailable=false.
- **Default lifecycle:** mỗi tenant có **đúng một active default**. Create/set-default/archive khóa tenant và thay thế atomically; không archive default nếu không chỉ định replacement cùng transaction. Partial unique chỉ là at-most-one fence; command core phải chứng minh exactly-one.
- **Command idempotency:** channel mutations dùng actor-scoped UUID receipt bind canonical request fingerprint; exact replay trả exact prior outcome, cùng key khác fingerprint = `409`, concurrent loser re-read receipt.
- **Creator integrity:** creator membership/person/tenant dùng composite identity; NULL/NULL chỉ cho system bootstrap, không được làm escape hatch cho human create.
- **Adjacent owner-final contracts:** DD-91 sở hữu primary surface + requester-only `/pay`; DD-92 sở hữu interaction/edit/delete/search; DD-93 sở hữu slash registry; DD-94 sở hữu digest delivery; DD-95 sở hữu club moderation. Không nhét các mechanism này vào lifecycle owner của DD-86.
- **Sequence:** exact Chat Product/BE authority pack đã chứa Reviewed DD-55 DM-safety contract; first runtime branch được thiết kế là `chat-definer-role-provisioning → chat-dm-safety-authority-core`. Root `dd38-dd86-chat-schema-core` chỉ chạy sau safety authority và chỉ sở hữu final chat tables + pure membership/DM read adapters/RLS. Post-root shared-message và DM-lifecycle cores sở hữu command riêng. Current readiness, blocker và next trigger không được sao chép tại decision log; đọc canonical primary plan §13.

---

## DD-87 — `splitNameAmount` fail-closed ambiguity contract · ✅ Chốt

> **Owner decision:** 2026-07-22, yêu cầu “update hết”. Đây là `DECISION_FINAL`; core implementation
> đã merge tại `d2a27e1`, nhưng chưa có production caller/consumer. Authority kỹ thuật đầy đủ và
> 18-row matrix nằm ở
> `../decisions/analysis/dd-87-splitnameamount-decision-table-analysis.md`.

- **Bối cảnh:** implementation trước `d2a27e1` chọn shortest positive trailing run, bảo toàn numeric
  suffix của tên (`Player 2 110k`) nhưng misparse grouped amount khi final group dương
  (`Wang 110 500` → `Wang 110` + `500`). Live core hiện implement exhaustive tagged union bên dưới;
  `splitNameAmount` vẫn chỉ có test caller, không có production execution flow.
- **Quyết định:** enumerate mọi digit-led trailing run bằng canonical `parseMoney`, giữ các amount dương,
  map thành `{name,amount,rawAmount}`, dedupe theo cặp `(name,amount)` và order shortest→longest.
  - 0 candidate → `{kind:"none",name}`.
  - 1 candidate → `{kind:"resolved",name,amount}`.
  - ≥2 candidate → `{kind:"ambiguous",candidates}`.
- **Compile-time fence:** nhánh `ambiguous` không có top-level `name`/`amount`; caller phải narrow `kind`
  và hiển thị candidate picker. Không được mặc định candidate 0.
- **Identity ambiguity cũng là money ambiguity:** `Player 0 110k` có hai payer-name khác nhau nhưng cùng
  amount 110.000, nên vẫn `ambiguous`. Không được chỉ so distinct amount.
- **Cấm:** grouped-number grammar thứ hai, longest-run winner, magnitude/price threshold, known-name lookup,
  fuzzy heuristic hoặc blocklist. `parseMoney` tiếp tục là money grammar duy nhất.
- **Ranh giới:** core chỉ propose; không DB/IO/log/settle. Multi-person name match tiếp tục manual-confirm
  theo BL-PAY-3; auto-settle nhiều người chỉ qua `pay_code` deterministic.
- **Ignored historical tables:** ba bảng dưới worktree `phase1-fable5` hiện còn tồn tại và worktree không
  prunable theo live dry-run, nhưng không có row splitter, không phải DD-87 authority và không là dependency.
  Việc lift chúng được theo dõi riêng trong backlog.
- **Readiness:** decision và core slice đã implemented/merged; wiring consumer production là slice
  riêng, vẫn phải qua readiness gate và hiện chưa tồn tại. Vì vậy không được suy core merge thành
  payment reconciliation runtime.

---

## DD-90 — Job-infra implementation contract: audit sink · definer ownership · provision ordering · ✅ Chốt (owner 2026-07-25)

> **Status boundary:** decision vẫn là `DECISION_FINAL`; live implementation đã land sau các readiness gate:
> `0022_job_claim_lease_core.sql`, `0023_outbox_ack_marker.sql`, dispatcher/preflight và exact-string
> schedule. Schedule mặc định OFF; delivery hiện dùng placeholder terminal-DLQ, chưa có producer, real
> projector hay replay, nên không được gọi là `ENABLE_READY`. Contract gốc vẫn không tự authorize
> những slice delivery tiếp theo và không sửa semantics của DD-89.

**Q4 — Audit sink cho privileged job call: tạo trong slice core, hay defer?**

- **Bằng chứng tại thời điểm quyết định (`main@2937ed9`):** DD-89 Q1 + `../product/TDD.md:494` + `deployment-infra.md:186` (B5) bắt buộc envelope `job_id` · `tenant_id` · actor=`system` · reason, nhưng khi đó `packages/db` chưa có job-audit sink và `claim_outbox_batch` vẫn là privileged cross-tenant call không audit.
- **Live refresh (`main@784bc8d`):** `0022_job_claim_lease_core.sql` đã tạo `job_audit_events` và ghi một audit row cho mỗi claimed outbox event cùng transaction; Q4 đã implemented. Các giới hạn no-read-grant/no-retention-job của decision vẫn giữ nguyên.
- **Chốt (a), `job_audit_events` ngay trong slice core.** Platform plane, append-only, only definer `INSERT`, zero grant cho `app`/`readonly`, no read surface và no retention **job** trong slice này. Không dùng một batch record `tenant_id=NULL`: `claim_outbox_batch` ghi **một row cho mỗi claimed `outbox_event` cùng transaction**, với `job_id = event_id` (canonical job identity ở core), `tenant_id NOT NULL`, actor `system`, reason, `fn_name`, `operation_id` và `created_at`. Nhờ vậy audit giữ được tenant traceability dù function quét nhiều tenant; dispatcher sau chỉ mang `event_id` này vào pg-boss, không thay bằng ID queue ephemeral. Audit table là root infrastructure nên không defer sang slice 2.
- **Không chọn (b).** Claim routing metadata vẫn là privileged cross-tenant call theo TDD/DD-89; defer làm nó tiếp tục không audit và gộp infrastructure debt vào runtime slice.

**Q5 — Chủ sở hữu function definer: tạo role non-login hay giữ migration-role?**

- **Bằng chứng tại thời điểm quyết định (`main@2937ed9`):** chưa có `CREATE ROLE … NOLOGIN`/`ALTER FUNCTION … OWNER TO`; các function `SECURITY DEFINER` hiện hữu do migration role sở hữu. Đây là gap làm phát sinh Q5.
- **Live refresh (`main@784bc8d`):** privileged bootstrap + `0022` đã pre-provision/assert `job_definer`, cấp exact privileges và re-own function mục tiêu, gồm `claim_outbox_batch`; Q5 đã implemented. Các function lịch sử ngoài lane này vẫn không bị mega-reown.
- **Chốt (a), nhưng với `job_definer`, không phải generic `plexco_definer`.** Role lane-specific là `NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`. `BYPASSRLS` là bắt buộc, không phải tuỳ chọn: `claim_outbox_batch` quét/UPDATE `outbox_events` đang FORCE RLS và không có tenant GUC; an toàn đến từ exact grants (SELECT/UPDATE `outbox_events`, INSERT `job_audit_events`, các table worker-plane cần thiết), không phải từ một role `NOBYPASSRLS` sẽ thấy 0 rows. Role này được **pre-provision bởi privileged platform bootstrap trước migration**, attribute-checked fail-closed, `GRANT job_definer TO <migration_role>` để `SET ROLE`/`ALTER OWNER`; migration chỉ assert role/membership, temporary grant/revoke `CREATE ON public` cho PG16 và fail nếu prerequisite thiếu. **Không thêm vào `RUNTIME_ROLES`**: gate đó chỉ chạy trước 0000, còn `ensureRoleExists` hard-code `LOGIN NOBYPASSRLS`; cả hai đều sai cho role này. 52 function cũ không đổi owner; chỉ function mới 0022 và `claim_outbox_batch` được `ALTER FUNCTION … OWNER TO job_definer` tường minh sau mọi `CREATE OR REPLACE`.
- **Không chọn (b)/(c).** Giữ migration-role owner trái DD-89 và không xử lý FORCE RLS ownership; re-own 52 function là mega-slice auth/money. Bẫy luôn áp dụng: `CREATE OR REPLACE FUNCTION` không đổi owner.

**Q6 — Ai enforce thứ tự provision → worker?**

- **Bằng chứng tại thời điểm quyết định (`main@2937ed9`):** `ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss` chỉ áp cho object do chính provisioning role tạo; `app_worker` không có CREATE, nhưng queue registry còn rỗng và chưa có catalog-grant preflight test.
- **Live refresh (`main@784bc8d`):** registry hiện có `outbox_dispatch` + `__pgboss__send-it`; preflight chạy trước `boss.start()` và có tests provision-first/missing grant/queue fail-closed. Exact-string schedule đã implemented nhưng mặc định OFF.
- **Chốt (a), preflight fail-closed ở slice 2.** Chạy **trước `boss.start()`** (không phải `boss.work()`: startup đã dùng pg-boss schema). Kết nối bằng `app_worker`, assert pgboss schema/base objects, mọi queue registry và exact catalog grants/sequence usage; thiếu bất kỳ item nào ⇒ exit non-zero trước khi scheduler/maintenance chạy. Test phải chứng minh provision-first pass và missing queue/grant fail.
- **Không chọn (b).** Runbook/CI ordering không tạo runtime fence; một deploy sai thứ tự vẫn làm worker chạy degraded hoặc fail mơ hồ.
- **Hệ quả scope:** Q6 đã land trong dispatcher slice, không làm đổi negative scope lịch sử của core slice. Queue/schedule existence không phải delivery proof: chưa có producer, real projector hay replay.

**Hệ quả sau khi chốt:** Q4/Q5/Q6 đã implemented theo đúng split core/dispatcher. Enablement tiếp theo vẫn fail-closed cho tới khi có producer thật, projector/delivery thật, replay/recovery contract và bằng chứng vận hành; schedule tiếp tục OFF mặc định.

---

## DD-91 — In-app Chat primary player surface + requester-only `/pay` · ✅ Chốt (owner 2026-07-27)

> **Status boundary:** `DECISION_FINAL`, **không authorize migration/runtime/code**. DD-86 và DD-91..95 đã final. Exact current readiness, blocker và next trigger chỉ lấy từ `../proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md` §13; decision log không phát hành verdict song song. Mọi runtime slice vẫn phải qua readiness gate riêng.

- **Surfaces + tenant authority.** Exact `/pay` phase đầu chạy ở club channel, private Club Bot thread và private command overlay của human DM 1-1. Club channel lấy tenant từ authorized channel; bot thread lấy tenant từ route. Human DM có `tenant_id=NULL`, nên **cấm** suy tenant từ peer/thread/CLB chung: server enumerate requester-owned eligible clubs/historical obligations, một club thì auto-select, nhiều club trả requester-only picker, không có thì generic empty. Picker option opaque, short-lived, bind requester + DM + command + tenant + expiry và luôn re-authorize; raw `tenant_id`/`person_id` không phải authority.
- **Requester-only transport.** Registered private slash bị classifier chặn trước normal message INSERT. Command endpoint trả synchronous authenticated typed response với `Cache-Control: private, no-store`; client render ephemeral card/picker. Không có command/result message, result row/id/ref, private SSE, replay store, outbox, push, notification hay shared unread. DM peer nhận zero bytes và không có ref/oracle để probe.
- **Adjacent decision owners.** DD-92 sở hữu reply/mention/reaction/edit/delete/search; DD-93 sở hữu grammar/catalog/surface matrix; DD-94 sở hữu offline digest; DD-95 sở hữu club moderation. DD-91 không giữ bản sao rút gọn của bốn contract này.
- **Assistant boundary + entitlement.** `/pay` gọi deterministic person-self service, không `bot.ask`, không prompt/tool/LLM và vẫn chạy khi Assistant tắt. `@ClubBot tôi nợ bao nhiêu` chỉ được KB guidance/citation hoặc `no_answer`, không actual ledger amount. Assistant giữ Host Pro theo DD-22/DD-29 với exact entitlement key `assistant_ai_kb`; không mở limited-free mode trong decision này.
- **Một formula owner.** Extract `remainingAmount(amountDue, amountAllocated) = max(0, amountDue - amountAllocated)` thành primitive domain-neutral. `effectiveFee(OpenDebt)` giữ `fee == null → null`, sau đó delegate primitive với `paid_amount ?? 0`; **bốn production caller hiện có tiếp tục gọi `effectiveFee` và không đổi**, còn bounded slice thêm regression coverage cho đủ bốn path. Player View self-payment service validate charge integrity rồi dùng primitive. `unknown` chỉ do authz/integrity/decryption/dependency failure ở service layer; null không bao giờ thành known-zero.
- **Primary-surface payment lifecycle.** `reminder|settled|correction` dùng canonical durable tenant Inbox của Notification DD-70..72; generic OS Web Push chỉ mang opaque ref/copy key và mở authenticated detail dùng cùng self-payment projection như `/api/me/charges` và `/pay`. Provider failure không xoá Inbox item và không mutate/rollback ledger. DD-88/DD-94 không phải dependency của payment lifecycle hoặc realtime chat unread; DD-94 digest là delivery-only và không tạo durable notification item per source message.
- **Dependency consequence.** Reviewed DD-55 DM-safety contract nằm trong exact 27-file authority pack đã commit/push tại `90d292d`; primary plan v1.8 đạt `PLAN_READY` closure 12/12. Actual DB worktrees serialize `chat-definer-role-provisioning → chat-dm-safety-authority-core → dd38-dd86-chat-schema-core → tenant-capability-authority-core`. Capability semantics vẫn độc lập với Chat schema; execution hard-dep chỉ do cùng migration tail, `packages/db/schema.ts`, DB catalog/schema/authz tests. Sau slice 4 là `chat-club-channel-lifecycle-core → chat-authorized-member-target-read-core → chat-club-moderation-core → chat-shared-message-command-core`; stable catalog ID 9 phải chạy trước 6/7/8 theo dependency. Target core là owner duy nhất của short-lived requester+channel-bound opaque member DTO + consume-time resolver cho mention/mute/start-DM. Root chỉ sở hữu final `chat_channels/chat_members/chat_messages` + pure read adapter/RLS, không capability registry/grant, moderation/mute/notification storage. Capability core là cross-feature DD-56 authority duy nhất; moderation core land dark và sở hữu duy nhất mute/moderation storage + writers/receipts/audit; shared core chỉ đọc current mute state và sở hữu duy nhất send/history/mark-read + atomic reply/mention. `chat-dm-lifecycle-command-core` sau đó sở hữu duy nhất `create_dm`/reuse/block/report; reaction/edit/search là các owner riêng. Payment đi theo `remainingAmount → player-self charge read → chat-slash-command-registry-core + sync response → /pay adapter`. Full delivery authority nằm ở primary plan: bounded mechanism slices 1–47, thin API A1–A21, tracked-design FE F0–F15; executable first handoff ở §9.2. Notification payment lifecycle là hard gate của `PRIMARY_SURFACE_READY`, không phải hard dependency của root chat migration. Runtime vẫn absent; B4 artifacts/worktree chưa author và mỗi slice phải đạt strict `CODE_READY` trước execution.

---

## DD-92 — Chat interaction, bounded author lifecycle và authorized search · ✅ Chốt (owner 2026-07-28)

> **Status boundary:** `DECISION_FINAL`, không authorize schema/API/runtime. Search là beta-required post-root slice riêng, không phình root schema migration.

- **Reply + mentions:** reply chỉ tới message current-visible trong cùng channel; target đã tombstone tại send time thì reject. Reply đã tồn tại vẫn render tombstone nếu target bị ẩn/xoá sau đó. Mention target refs và safe render snapshot là structured, immutable và server-authorized.
- **Reactions:** closed set exact `👍|❤️|😂|😮|😢|🙏`; tối đa một active reaction cho mỗi `(person,message)`. Add/remove/same-state replay idempotent; đổi reaction là một atomic replace.
- **Own edit:** chỉ original human author được sửa body, dùng DB time `<15m` kể từ create, tối đa 5 lần. Author/channel/reply/attachments/mentions bất biến; mỗi prior body vào restricted revision audit. Assistant/system không edit.
- **Author delete:** original human author được soft-delete bất cứ lúc nào. Hành động irreversible với author; shared surface chỉ còn tombstone, body/media không được phục hồi hay hard-delete. Restricted audit giữ nguyên.
- **Search:** trước beta phải có API search riêng trên tập channel requester đang đọc **hiện tại**, optional channel filter. Index là generated PostgreSQL `simple` tsvector từ canonical current row; tombstone/removed content, revision history, requester-only slash và private bot query/result không được index/query. Mỗi query re-check live authorization.

---

## DD-93 — Slash grammar/catalog theo surface · ✅ Chốt (owner 2026-07-28)

> **Status boundary:** `DECISION_FINAL`, không authorize handler/runtime. Registry là source of truth duy nhất cho parser, authz, `/help` và surface availability.

- Outer-trim ASCII whitespace, ASCII-casefold command token rồi canonicalize lowercase; không alias, mọi command v1 nhận zero argument. Non-ASCII lookalike không normalize thành command.
- `/help`, `/pay`, `/me`, `/myclubs`, `/discover`, `/name` chạy ở club channel, private Club Bot và human-DM requester-only overlay.
- `/sessions`, `/waitlist` chỉ chạy ở club channel và private Club Bot; human-DM overlay trả `CHAT_COMMAND_UNSUPPORTED_SURFACE`.
- Unknown, extra argument hoặc unsupported surface đều private-reject trước message insert/rate/NOTIFY/unread/search/digest mutation. `/help` derive từ registry **sau authz** và chỉ liệt kê command actor dùng được tại surface hiện hành.

---

## DD-94 — Offline Chat digest delivery contract · ✅ Chốt (owner 2026-07-28)

> **Status boundary:** `DECISION_FINAL`; delivery timing/cooldown vẫn là `ENABLEMENT_ONLY`, không authorize provider enablement. DD-88 broader grouping proposal không sở hữu hoặc chặn contract này.

- Chat unread/current-visible content là source truth. Notification chỉ giữ opaque delivery signal; không durable notification item per source message, không copy body/title/amount/attachment/mention/author hay tạo chat/system message.
- DM, direct mention và reply mặc định ON. Club channel có preference `all|mentions|off`, mặc định `mentions`.
- Coalesce monotonic theo `(person_id,channel_id,highest_unread_cursor)`; cùng/thấp hơn là no-op. Mark-read huỷ pending signal đã obsolete.
- Ngay trước provider write phải re-check current unread + channel membership hoặc DM block/safety + preference + device/subscription + trust epoch. False/unknown cancels send; retry/unknown-after-write dùng stable delivery identity và không duplicate.
- Delay/coalesce window là config enablement-only. Thiếu config hoặc chưa có privacy/reauthorization boundary tests thì route OFF; realtime history/SSE/unread/badge vẫn hoạt động độc lập.

---

## DD-95 — Club-only moderation · ✅ Chốt (owner 2026-07-28)

> **Status boundary:** `DECISION_FINAL`, không authorize migration/API/runtime. Human DM transcript không bao giờ trở thành moderator surface.

- `chat.message.moderate` sở hữu hide/restore human-authored club message; `chat.member.mute` sở hữu timed mute/unmute `1h|24h|7d`. Unknown/unavailable/missing capability deny.
- Required `reason_code ∈ {spam,harassment,unsafe,off_topic,other}`; `other` cần bounded plain-text note. Detail chỉ vào restricted audit, analytics chỉ nhận reason code.
- Mỗi action dùng actor-scoped UUID receipt + canonical fingerprint; exact replay trả prior result, cùng key khác fingerprint reject trước mutation; một accepted action tạo đúng một append-only actor/reason/before-after/timestamp audit event.
- Mute chặn write tại canonical send theo DB-owned expiry nhưng không chặn read. Không có DM moderation/read, hard delete, moderator content edit, permanent ban, moderation assistant/system message hoặc system-message side effect.

---

## DD-96 — Home money chips: cross-club self-payment summary (A ✅) + host receivable cross-club (B 🟡) · owner 2026-08-07
> ⚠️ **Deferred in the clean subset (2026-08-12):** DD-96 Part A remains `DECISION_FINAL` (base, owner 2026-08-07); this subset does **not** re-ratify or reconcile it. The base Home contract represents the `unknown` self-payment state consistently as `null` + a section `reason` (edge #14; DTO `debt: null`/`debtReason: UNAVAILABLE`), so there is no current-base Part-A contradiction; the typed-union mismatch existed only in the reverted v7 candidate (`5009686`). DD-96 Part B (host receivable cross-club) stays deferred on its own blockers B1–B4 (see the DD-96 index row + the Part B section below).

> **Nguồn:** owner request 2026-08-07 — "cần có chip Còn nợ bên cạnh chip Chưa thu, hiển thị số tiền còn nợ các kèo chưa trả, click → màn chi tiết các kèo chưa trả tiền".
> **Status boundary:** Part A = `DECISION_FINAL` cho contract shape, **không** authorize migration/route/runtime. Part B = `DECISION_FINAL` cho **direction**, `NOT_PLAN_READY` cho mechanism — reopen HOME-OQ-1 nhưng chưa đóng điều kiện reopen của DD-79.

### Bối cảnh — ba sự thật đã verify tại `cc0e8a8`

1. **Phần "màn chi tiết các kèo chưa trả" đã tồn tại trong contract, không cần contract mới.** `SelfPaymentStatus.items[]` (`../features/BE/feature_player_view_tech.md:178-185`) đã mang per-session `sessionRef/startsAt/amountDue/amountAllocated/remaining/status`; màn đích `/me — outstanding detail` đã ở `../features/FE/feature_player_view.md:84`; Home đã wire ở HOME-UC-2 (`../features/FE/feature_home.md:37`).
2. **`SelfPaymentStatus` là per-club, không có cross-club aggregate nào.** `/api/me/charges` trả `clubs: [{clubRef, clubLabel, status}]`. Chip "Còn nợ" của Home cần `totalOutstanding` + `clubCount` xuyên CLB, mà `../features/FE/feature_home.md:26` cấm Home tự tính tiền và `../features/BE/feature_home_tech.md:166` đã pin sẵn: *"Nếu Player View chưa expose canonical cross-club summary cần thiết, build Home phải dừng ở dependency đó và mở rộng Player View owner; không tạo helper thứ hai trong Home."* Đây là gap thật → Part A.
3. **"Chưa thu" không thuộc player_view.** DD-48 boundary có ở cả hai spec player_view; DTO allowlist `../features/BE/feature_player_view_tech.md:228-229` ghi `Other player roster ❌ NEVER` và `Admin data: tenant settings, other charges ❌ NEVER`. Host receivable **theo định nghĩa** là charge của người khác → tenant-scoped, phải qua `tenantRepo` per tenant. Nhét vào `getSelfPaymentStatus` là gộp hai authz model vào một serializer — đúng thứ DD-48 cấm → Part B phải có owner riêng.

### Part A — cross-club self-payment summary · ✅ `DECISION_FINAL` (owner 2026-08-07)

- **Owner:** `player_view`. Cùng service family với `getSelfPaymentStatus`, dùng chung primitive `remainingAmount`. **Không** helper/formula/serializer thứ hai; Home vẫn là pure consumer.
- **Contract shape** (field name chốt ở build slice, nhưng discriminant/semantics là contract):

```ts
type SelfPaymentSummary =
  | { kind: "known_zero"; currency: "VND"; asOf: string }
  | {
      kind: "known_amount";
      currency: "VND";
      totalOutstanding: number;   // tổng remaining xuyên CLB
      clubCount: number;          // số CLB CÓ outstanding > 0, không phải tổng số CLB
      asOf: string;
    }
  | { kind: "unknown"; reasonCode: string; retryable: boolean };
```

- **Unknown-dominates (owner ✅ 2026-08-07):** nếu **bất kỳ** club nào trong own authorized set trả `kind='unknown'`, summary = `unknown`. **Cấm** sum các club known rồi hiển thị. Lý do: partial sum tạo một con số **trông authoritative nhưng thấp hơn nợ thật** — user đọc thành "đã trả gần hết". Đây là cùng một fail-closed với bất biến hiện hành *"chỉ `known_zero` mới hiển thị 0"* (`../features/FE/feature_player_view.md:29`), áp ở tầng aggregate.
- `known_zero` chỉ khi **mọi** authorized club đều proven `known_zero`. Zero-club (chưa vào CLB nào) cũng là `known_zero` — không phải `unknown`.
- **Không** thêm `payAction` ở tầng summary. `payAction` là optional field của per-club `SelfPaymentStatus` (v2.6 pin: *"never a global/item action"*); một aggregate pay CTA xuyên CLB là quyết định khác, chưa mở.
- Chip tap → `/me` outstanding detail đã có; **không** contract mới cho màn detail.
- **Không migration, không bảng mới, không route mới** — additive read trên `/api/me/charges` surface hoặc sibling; chốt ở build slice.

### Part B — host receivable cross-club ("Chưa thu") · ✅ direction, 🟡 mechanism

- **Owner direction (2026-08-07):** có chip "Chưa thu" cạnh "Còn nợ" trên Home, phạm vi **cross-club**. Đảo HOME-OQ-1 (c) của DD-79.
- **Owner mới bắt buộc — KHÔNG phải player_view.** Cần một `host-self` read owner tách biệt, authz theo role owner/admin per tenant, đi qua `tenantRepo(tenantId)` từng tenant. Không tái dùng serializer person-self.
- **Blocker chưa đóng được trong session này:**

| # | Blocker | Owner | Điều kiện đóng (nhị phân) |
|---|---|---|---|
| B1 | Chưa có design-probe contract host-self cross-tenant — chính là điều kiện reopen mà DD-79 ghi (`decisions.md:1005`) | owner + BE | Một probe doc tồn tại, pin authz model + fan-out semantics, được owner duyệt |
| B2 | `authorizeTenantAction` merged (`ddb69a9`) nhưng **0 production caller**; DD-29 capability registry **0 TS đọc `entitlements`/`capabilities`** → không có role/capability gate đang chạy. **G3 FAIL** | job/authz lane | `authorizeTenantAction` có ít nhất một production caller đã merge trên `main` |
| B3 | Chưa Reviewed DTO owner nào sở hữu host receivable ở bất kỳ đâu. `../channels/web/FE/feature_dashboard_fe.md:59-66` ghi thẳng "OWNER CONTRACT PENDING" cho đúng stat card này | Product+BE | Một cặp spec Reviewed sở hữu per-club host receivable (formula gross/net, reversal, timezone, period boundary) |
| B4 | Cross-club host aggregate là **fan-out N tenant**, không phải một query. Chưa pin per-tenant timeout, unknown-dominates, tenant suspended, role bị thu hồi giữa fan-out | BE | Các mục này được pin trong probe B1 |

- **Thứ tự bắt buộc:** B3 (per-club owner) → B1 (probe cross-tenant) → B2 (authz gate có caller thật) → cross-club chip. **Cấm** đi tắt cross-club trước khi per-club có owner; đó là cách tạo formula tiền thứ hai.
- **Unknown-dominates cho Part B:** *suy ra* từ ratification của Part A, **chưa được owner ratify riêng**. Ghi ở đây để hiển lộ, không phải để coi là đã chốt — probe B1 phải hỏi lại.
- **Negative scope tới khi B1–B4 đóng:** Home **không** render chip "Chưa thu" — không placeholder, không `0`, không "coming soon", không slot trống. Giống cách Feed tab bị xử lý ở DD-79 (config-OFF, không tab chết).

### Lý do

Tách A/B vì hai chip trông giống nhau trên màn hình nhưng **khác hẳn authz class**: "Còn nợ" là tiền *của tôi* (person-self, cross-tenant read đã có contract); "Chưa thu" là tiền *của người khác nợ tôi* (tenant-scoped, role-gated, chưa có owner nào). Gộp chúng vào một projection vì chúng cạnh nhau trong UI là đúng loại lỗi mà DD-48 và HR1 tồn tại để chặn. Part A rẻ và mở khoá được ngay yêu cầu chính; Part B đắt và bị chặn ở tầng dependency thật, không phải ở tầng doc.

### Hệ quả — mirror phải propagate

| Artifact | Thay đổi | Trạng thái |
|---|---|---|
| `../features/BE/feature_player_view_tech.md` | Thêm `SelfPaymentSummary` + unknown-dominates vào §4; thêm unit test cross-club aggregate + unknown-dominates | ✅ v2.9 (session này) |
| `../features/FE/feature_player_view.md` | Thêm use case + acceptance criterion cho cross-club summary | ✅ v2.8 (session này) |
| `../features/FE/feature_home.md` | HOME-OQ-1 reopen (status đổi từ "✅ chốt defer"); chip "Còn nợ" trỏ `SelfPaymentSummary`; Part B negative scope | ⬜ chưa làm |
| `../features/BE/feature_home_tech.md` | `debt` section wrap `SelfPaymentSummary` thay vì "wraps `getSelfPaymentStatus`" | ⬜ chưa làm |
| `../channels/web/FE/feature_home_fe.md` | §6 debt row response path; chip unavailable khi aggregate `unknown` | ⬜ chưa làm |
| `../features/README.md:144` | Dòng ghi HOME-OQ-1 "chặn riêng chip host receivable" — nay reopen | ⬜ chưa làm |
| DD-79 (`decisions.md:1001,1005`) | HOME-OQ-1 (c) defer bị Part B đảo | ⬜ chưa làm |

**Không** authorize worktree/code. Part A cần slice riêng đạt strict `CODE_READY`; Part B chưa `PLAN_READY`.

---

## DD-97 — Collection statement + export sao kê per-session/kỳ · ✅ Direction + entitlement chốt (owner-delegated 2026-08-07)

> **Status boundary:** ✅ direction + entitlement split là `DECISION_FINAL` (owner uỷ quyền quyết định trong session 2026-08-07, tiêu chí lợi ích lớn nhất cho pj); **mechanism vẫn chưa `PLAN_READY`** — không authorize schema/migration/route/UI/worker/enablement. Mọi ràng buộc composition-only + HR2 bên dưới giữ nguyên hiệu lực.
> Nguồn: đối chiếu 5 FE docs payment của Sporta Phase-2 (`../research/sporta-payment-fe-port-analysis-2026-08-07.md`) — gap thật duy nhất trong nhóm docs đó.

### Bối cảnh — verify tại `main@7e21f65dc4eff0fb845448d8c9a974bcb64f7edb`

1. Không feature spec nào sở hữu "host xem bảng tổng kết ai trả/chưa trả per session/kỳ + export file": `feature_billing_lifecycle.md` là **host subscription** (platform thu tiền host — khác hẳn host thu tiền player); `feature_payment_reconcile.md` sở hữu ledger/allocation nhưng không statement/export; `feature_dashboard_fe.md` stat card còn "OWNER CONTRACT PENDING"; `feature_payments_fe.md` unified ledger/month summary còn `UNPINNED`.
2. Input đã canonical trong live schema: `charges` (`open|partial|paid|void`, `amount_due`/`amount_allocated`) + `payment_allocations` (append-only, source `auto|manual|cash|waiver|reversal`, reversal qua `reverses_allocation_id`) + `bank_transactions`. Persona P1 Host pain "soi sao kê CK thủ công" (`../product/ROADMAP.md:133`) là đúng bài này.
3. DD-89 job foundation đã land (`0022`/`0023`, dispatcher, schedule OFF) — có chỗ đứng cho async export mà không dựng hạ tầng mới.

### Đề xuất

- **Statement read model — composition-only.** Per-session: project từ charges+allocations của session (ai trả/thiếu, source, waiver, reversal). Per-kỳ: group theo period + tenant timezone. **Không bảng tiền mới, không formula thứ hai:** gross/net/reversal/timezone formula phải có DTO owner Reviewed — cùng họ blocker B3 của DD-96; statement không đi trước owner đó.
- **Export PDF/XLSX async — behavior contract only.** request → job → ready → authenticated download → expire (+ re-request). Job chạy trên DD-89 foundation; proposal này **không** authorize producer/enablement — export slice phải qua readiness riêng (giữ altitude: spec pin hành vi, defer job-infra).
- **HR2 fail-closed.** File chứa tiền + PII → download chỉ authenticated + tenant-scoped admin; **không** public/unauthenticated signed URL; file expiry + audit export actor. "Share invoice qua chat/Zalo" của Sporta **ngoài scope** (nếu muốn: chỉ summary không PII, DD riêng).
- **Entitlement ✅ (owner-delegated 2026-08-07) — tách hai lớp theo đúng logic DD-40 (manual=free, heavy/auto=pro):**
  - **Free:** per-session collection statement **view** (đọc composition ai-trả/ai-thiếu của một kèo). Lý do: đây là mặt đọc của core loop P1 Host ("soi sao kê thủ công" — pain số 1 của persona trả tiền tương lai); chặn nó sau paywall là chặn chính lý do host adopt sản phẩm. Chi phí hạ tầng ≈ 0 (read trên projection, không job).
  - **`host_pro`:** statement theo **kỳ/tháng** + **export file PDF/XLSX**. Lý do: (1) export job có chi phí hạ tầng thật (DD-89 foundation, storage, retry); (2) nhu cầu "sổ sách theo kỳ" xuất hiện khi CLB đủ lớn — đúng thời điểm host sẵn sàng trả tiền; (3) cùng họ `crm_dashboard` của DD-40, giữ ranh giới free/pro nhất quán, không tạo tier logic mới.
- **BE mechanics input (bổ sung 2026-08-07, vòng BE):** `../research/sporta-be-docs-gap-2026-08-07.md` §2.1 — dedupe pending job, `202` + `estimatedSeconds`, cờ `preliminary` cho kỳ chưa chốt, cap record + streaming, fail path bounded → `FAILED` + notify. Dùng khi author spec pair; không thay đổi các ràng buộc đã pin ở trên.

### Lý do

Gap có thật, giá trị host cao (P1 persona pain), mọi input đã canonical — chi phí chủ yếu là DTO owner + export job slice. Ghi proposal để giữ altitude đúng: không nhét vào `feature_payments_fe.md` hiện tại (surface đó còn `UNPINNED`), không mở job enablement bằng docs.

### Hệ quả nếu owner ✅

| Việc | Ghi chú |
|---|---|
| DTO owner Reviewed cho statement formula | Có thể chung owner với dashboard/month summary (payments_fe đang chờ đúng owner này) |
| Spec pair mới hoặc § mới trong payment_reconcile pair | Product + BE tech |
| Export job slice | Sau readiness riêng; DD-89 foundation, schedule vẫn OFF tới enablement |
| FE surface | Sau F0 + DTO owner; states/error-mapping theo chuẩn FE template |

---

## DD-98 — Negative scope cho mechanic Sporta không port · ✅ Chốt (owner-delegated 2026-08-07)

> **Status boundary:** ✅ `DECISION_FINAL` — NP-1..5 là negative scope chính thức (owner uỷ quyền 2026-08-07).
> Lý do chốt nguyên gói: cả 5 mục đều là hệ quả trực tiếp của decision đã ✅ từ trước (DD-39/41/45/49 ·
> DD-32 Option D · NTF contract · player_view fence · DD-06) — ratify không tạo ràng buộc mới, chỉ đóng
> cửa drift; chi phí = 0, lợi ích = mọi session tương lai đọc Sporta docs có ranh giới cứng để cite.
> Muốn mở mục nào → DD mới reopen decision gốc tương ứng, không sửa DD-98. Không đổi contract Reviewed nào.

- **NP-1 · Custom split bill per player — không theo đuổi.** Charge amount là derived per-player từ canonical (DD-39 gender pricing · DD-41 gating · DD-45 promotion derive-before-mutation · DD-49 price-change carry-over). Custom split = formula tiền thứ hai + đổi promotion/rejoin derive; muốn mở phải DD mới với blast radius charges/promotion/rejoin, không phải FE port.
- **NP-2 · Timeout-hold slot release cho linked member — không theo đuổi.** DD-32 Option D đã pin: linked account book paid → pay later, không mất chỗ vì chưa trả; hold 15' chỉ cho unlinked pay-now. Nợ xử lý qua NTF reminders. Sporta "host bật hold cho mọi player" là admission model khác.
- **NP-3 · OS push kèm số tiền/QR — mirror, đã cấm sẵn.** NTF contract: OS push generic-only; số tiền/QR chỉ sau authenticated fetch (Zalo/Messenger DM theo policy riêng — NTF-UC-7). Ghi lại để người port không mở lại.
- **NP-4 · Auto-archive "nợ cũ" theo tuổi (>30 ngày) — không theo đuổi.** `SelfPaymentStatus` union chỉ `open|partial`; paid/void rời surface (BE v2.7 cố ý). "Archive" theo tuổi tạo trạng thái tiền thứ hai ngoài canonical + đổi ngữ nghĩa reminder eligibility. History surface (nếu cần) là DTO owner riêng như `feature_player_view_fe.md` đã fence.
- **NP-5 · Geo/location port (radius filter · distance sort · lat/lng public · map picker) — không theo đuổi trong khuôn DD-06 hiện hành.** *(Bổ sung 2026-08-07, vòng 2 — ratify điều `../research/sporta-fe-docs-gap-2026-08-07.md` đã REJECT ở mức phân tích.)* DD-06 pin `area`-only public; venue chỉ hiện khi `players.status='active'`. Radius/Haversine/distance sort đòi venue coordinates trên public surface — mâu thuẫn trực tiếp. Muốn có geo discovery → reopen DD-06 với privacy analysis riêng (coarse-grid/quantized coords là một hướng), không phải FE port. Filter theo `area` hiện hành không bị ảnh hưởng.
- **Hệ quả:** research/design-input docs link về đây; owner muốn mở mục nào → DD mới, không sửa DD-98 thành "✅ một phần".

---

## DD-99 — FE spec hardening + player-facing FE backlog (Sporta FE porting) · ✅ P1 + OQ-1 chốt · P2–P4 prioritized (owner-delegated 2026-08-07)

> **Status boundary:** ✅ P1 và OQ-DD99-1 là `DECISION_FINAL`; P2–P4 được xếp thứ tự ưu tiên (chưa phải
> build authorization — mỗi mục vẫn cần spec + review riêng theo gate). Không authorize code/runtime/render.
> **Nguồn:** `../research/sporta-fe-docs-gap-2026-08-07.md` (FE-level; bổ trợ — không trùng — 2 research files payment/session cùng ngày, DD-96/97/98 và 2 proposals `cross-project-standardization` · `sporta-payment-ux-port-design-input`).

- **P1 · Ratify bộ 4 section FE spec.** Session 2026-08-07 đã thêm 4 section dạng Draft (Analytics Events · State Machine · Acceptance Criteria · Testing Notes) vào cả 12 file `docs/channels/web/FE/*_fe.md` — nguồn template: 7 file Sporta FE đều có 4 mục này trong khi Plexco FE thiếu hệ thống (spec không AC = không testable). Đề xuất: owner ratify bộ 4 section thành **điều kiện G2 khi FE doc Draft→Reviewed**; nếu duyệt, sửa gate/template là docs-only slice riêng. Quy tắc điền đã pin trong từng section: analytics cấm amount/tiền/PII; state machine chỉ dùng state đã pin; AC trace về § có sẵn; thiếu căn cứ → `TBD (UNPINNED)`.
- **P2 · FE spec: player session-detail + join/leave/waitlist UX** ⬜ — surface player xem chi tiết 1 kèo, join/leave với confirm + hệ quả, waitlist join/promote/expire (product/BE đã có DD-45/45a/49; FE chưa spec). **Hard-dep:** owner gỡ mâu thuẫn header vs §6 của `feature_sessions_fe.md` (đã ghi nhận trong file, chưa gỡ — §6 chặt hơn đang có hiệu lực) + DTO pin. Không mở screen ngoài scope `feature_session_management.md` Reviewed.
- **P3 · Security/account-management owner contract** ⬜ — logout, delete account, linked providers, session-device list/revoke. `feature_settings_fe.md` đang treo negative scope **có chủ đích** chờ đúng source authority này; `feature_auth_fe.md` Flow 4 nhắc revoke session nhưng không UI nào own. Gap thật = chưa ai author source contract, không phải FE quên.
- **P4 · Payment FE leftovers chưa ai own** ⬜ — surface contract cho manual mark-paid + tạo `cash|waiver` (`feature_payments_fe.md` §4 `SourceBadge` hiện là dead enum — có badge, không có flow tạo) và refund-on-cancel UX (`void` chưa có flow vào/ra nào trong file). **KHÔNG gồm** (đã có owner khác): QR/protected-pay (design-input §1) · reminder-config (design-input §2) · statement/export (DD-97) · các mục negative scope (DD-98).
- **OQ-DD99-1 · Breakpoint 768px** ⬜ → F0 design authority: `feature_sessions_fe.md` (hàng 768px ở ~129/213/335, kế thừa `feature_dashboard_fe.md` ≤768 sidebar) pin breakpoint trung gian, trong khi `feature_home_fe.md`/`feature_player_view_fe.md` chỉ pin 375px + desktop và cấm tự đặt số trung gian. Resolution nhị phân: (a) pin rule "dashboard-shell surfaces được phép 768px" hoặc (b) bỏ các hàng 768px khỏi 2 file. `NEXT_REVIEW_TRIGGER`: phiên F0 design authority kế tiếp.
- **Hệ quả:** các section Draft trong 12 file FE là đề xuất, không phải contract — owner duyệt P1 thì mới thành điều kiện Reviewed-gate. Không mục nào authorize render/implement; P2–P4 mỗi mục cần spec + review riêng theo gate hiện hành.

### Owner decisions (delegated) — 2026-08-07

- **P1 → ✅ ratified.** Bộ 4 section (Analytics Events · State Machine · Acceptance Criteria · Testing Notes) là **điều kiện bắt buộc khi FE doc Draft→Reviewed**. Lý do: 12/12 file đã có sẵn dạng Draft — chi phí ratify ≈ 0; lợi ích = spec không AC thì không testable, và điều kiện gate chặn được thế-hệ-template-trộn-lẫn (đúng bệnh BotShopez docs mắc phải — `../research/botshopez-docs-template-gap-2026-08-07.md` §3). **Optional, không bắt buộc:** State Coverage Matrix · AC trace BRD `FR-x.y` · effect matrix · Forbidden-appendix đánh số (cùng research §2) — giữ gate nhẹ, tránh template phình. Việc sửa `review-code-readiness-gate.md`/template là **docs-only slice riêng**, đi gate bình thường, chưa schedule ở đây.
- **OQ-DD99-1 → ✅ chốt (a), có điều kiện F0-override.** Rule hai lớp: **dashboard-shell surfaces** (sessions/payments/members/settings/dashboard — kế thừa sidebar ≤768 của `feature_dashboard_fe.md`) **được phép pin 768px**; **player-facing mobile-first surfaces** (home, player_view) chỉ pin 375px + desktop, ngưỡng trung gian thuộc F0. Lý do chọn (a) thay (b): các hàng 768px hiện có của sessions_fe mô tả hành vi kế thừa có thật từ dashboard shell — xoá đi là mất thông tin đúng; (b) chỉ đổi mâu thuẫn văn bản thành lỗ hổng thông tin. F0 design authority có quyền override cả hai lớp khi có visual design thật — `NEXT_REVIEW_TRIGGER` giữ nguyên phiên F0 kế tiếp. Không file nào phải sửa ngay (hai lớp đang tự mô tả đúng hành vi của mình).
- **P2–P4 → thứ tự ưu tiên: P2 → P4 → P3.** Căn cứ roadmap hiện hành:
  1. **P2 trước** — player session-detail/join/leave/waitlist FE nằm trên critical path S9–S12 (PWA player-facing là target phase-1; ROADMAP gate native = "PWA live + retention đo được"). Hard-dep của nó (gỡ mâu thuẫn header/§6 `feature_sessions_fe.md`) là docs-only, rẻ, nên gỡ ngay trong slice authoring P2.
  2. **P4 giữa** — mark-paid + `cash|waiver` surface là **free-tier core value** (DD-40: `payment_mark_manual` là capability free; SourceBadge dead enum là inconsistency đang nằm trong spec). Tách **refund-on-cancel ra sau** — bị chặn bởi refund/void policy chưa chốt, không cho nó kéo cả P4.
  3. **P3 sau** — account-management cần identity/security source contract nặng (họ DD-70), không chặn adoption ngắn hạn; làm sớm sẽ tranh capacity với P2/P4 mà lợi ích dồn về sau.

---

## DD-89 — Job-infra: worker access và thẩm quyền grant của pg-boss · ✅ Chốt (owner 2026-07-25)

> **Status boundary:** `DECISION_FINAL`; implementation đã land qua `0022` core, `0023` ack,
> dispatcher/preflight và schedule. Schedule mặc định OFF; placeholder delivery chỉ terminal-DLQ và
> chưa có producer/real projector/replay, nên current runtime vẫn không `ENABLE_READY`. Decision này
> không tự authorize các slice delivery tiếp theo và không thay TDD §3.4 hay các DD đang ✅.

- **Bối cảnh tại thời điểm quyết định (verify on-disk `main@2937ed9`):** `app_worker` đã tồn tại nhưng chỉ có đặc quyền runtime tối thiểu; `projector_deliveries` không RLS/tenant key/direct grant nên grant boundary là hàng rào chính.
- **Live refresh (`main@784bc8d`):** `0022_job_claim_lease_core.sql` đã land narrow job functions/audit/lease/index + `job_definer`; `0023_outbox_ack_marker.sql` thêm ack marker/token. Dispatcher và preflight đã land, schedule exact-string đã land nhưng OFF mặc định.
- **Q1 — chốt (b), narrow SECURITY DEFINER functions.** `app_worker` nhận **zero direct DML grant** trên `projector_deliveries` và `surface_refs`. Với `projector_deliveries`, slice core chỉ được thêm function operation-specific cho delivery recording/retry advance; không generic table/column/SQL input, không trả arbitrary business rows. Mọi function có fixed `search_path`, input validation, owner non-login, `REVOKE ALL ... FROM PUBLIC` và `GRANT EXECUTE` chỉ cho `app_worker`; privileged call phải có audit envelope theo TDD §3.4. `surface_refs` **không có function/grant trong core slice** vì chưa có consumer; projector đầu tiên cần nó phải author operation-specific function + contract riêng. Điều này giữ INV-8, không mở rộng grant boundary của hai bảng không RLS/không `tenant_id`.
- **Q2 — chốt (a), controlled provisioning exception.** Không chuyển pg-boss DML/default grants vào `packages/db` migration: `pgboss` schema và queue partitions là DDL dynamic do dependency `pg-boss` tạo/nâng cấp tại provisioning, sau app migrations và trước worker. `apps/bot/src/provision-queue.ts` là authority versioned cho đúng exception này và phải luôn chạy với migration credential tách biệt; worker giữ `migrate:false`, `app_worker` chỉ DML/sequence usage trong schema `pgboss`, không `CREATE`, ownership hay grant trên business schema. Provision phải idempotent, re-apply grants cho objects hiện hữu và default privileges cho partitions/objects sau này; test deployment-infra phải chứng minh exact catalog grants từ seat `app_worker` trước khi worker được enable.
- **Q3 (không chặn, ghi nhận) —** `claim_outbox_batch` sắp xếp theo `created_at` (`0010:22-28`) trong khi index partial duy nhất là `(aggregate_id, sequence)` (`0005:34-35`). Thêm index khớp thì nằm trong scope slice 1; **đổi ngữ nghĩa thứ tự thì không** — đó là hợp đồng của sync-engine.
- **Vì sao đáng chốt sớm:** **7 BE spec** cùng defer đúng khối hạ tầng này (`feature_session_management_tech.md:365,378,379` · `feature_session_management.md:172` · `feature_cross_club_join_tech.md:224` · `feature_sync_engine_tech.md:88` · và `feature_notifications_reminders_tech.md:1368` thì **giả định `app_worker` đã có** rồi tự viết grant). Đáng chú ý: `feature_billing_lifecycle_tech.md:287-297` — nơi được viện dẫn làm **tiền lệ** để defer — thực ra **không có câu defer nào**, nó chỉ bỏ trống hạ tầng. Mỗi spec tự suy diễn tiếp là cách drift bắt đầu.
- **Hệ quả sau khi chốt:** core/dispatcher/schedule đã implemented, nhưng chỉ là job foundation. Không được suy thành business delivery runtime: hiện chưa có producer, real projector hay replay; placeholder delivery DLQ terminal và schedule OFF mặc định. Mọi enablement tiếp theo cần readiness/acceptance riêng.

---

## DD-88 — Notification grouping/message-request · 🟡 `DEFERRED_PROPOSAL`

> **Status boundary:** DD-88 là proposal cho một initiative grouping/message-request rộng hơn, không phải runtime/code authorization và không chặn DD-94. DD-70..72 tiếp tục sở hữu durable Inbox/payment/security; DD-94 sở hữu exact offline Chat digest.

- **Proposed grouping direction:** group chỉ là read-model/FE view derive từ closed-set `type`; không thêm cột/free-text `group`.
- **Proposed bulk direction:** scoped/bulk read chỉ sau core Inbox/read và phải bind canonical filter/ref fingerprint, re-authorize, all-or-nothing, cap 100.
- **Deferred sources:** `message_request` chỉ reopen sau DD-55 phase-2 request box; session/activity notification chỉ sau producer/recipient/anti-spam/effective-state contract.
- **Compatibility boundary:** Chat read/unread và Notification read là hai plane độc lập. DD-94 digest dùng opaque unread cursor, không durable notification item per message và không materialize body/title/amount; DD-88 không được định nghĩa lại contract đó.

---

## DD-104 — `DeleteSession` hard delete · ✅ Decision-level chốt D0–D4 (owner 2026-08-13) · slice DEFERRED

> **Status boundary (2026-08-13):** owner đã chốt **D0–D4** theo `../decisions/dd104-delete-session-decision-table.md`
> (bảng đo tại `main@1303c31`) — xem amendment bên dưới. Đây là `DECISION_FINAL` **decision-level**,
> KHÔNG phải `PLAN_READY`/`CODE_READY`: slice DD-104 vẫn **không mở được** cho tới khi
> `tenant-capability-authority-core` (P1, hiện `status: idea`) có packet — và theo **D0** dependency đó
> **không được ưu tiên lên trước** (2 nợ chat P1 giữ thứ tự, next-lanes 2026-08-11). Không authorize
> migration, code, packet hay FK change nào.
>
> **Lịch sử spec-WIP (2 lần):** nội dung `DeleteSession` từng nằm WIP chưa-commit trong
> `feature_session_management_tech.md` v2.20 + `feature_session_management.md` (mở proposal 2026-08-11),
> được revert 2026-08-12 (reconcile clean subset), rồi **tái xuất hiện** trong docs pass 12/08 và được
> **gỡ lần hai 2026-08-13** (spec FE v2.25 / BE v2.22 — body chỉ còn pointer về đây, changelog rows v2.20
> đánh dấu RÚT làm audit trail). Cả hai file mang `Status: Reviewed`, nên theo `CLAUDE.md` nội dung
> chưa-author thuộc về đây, không thuộc về spec; spec DeleteSession sẽ được author lại trong slice DD-104.

- **Phát hiện chặn, đo 2026-08-11 tại `main@d91656c`.** Algorithm bước 5 của spec khai:

  > `DELETE FROM sessions WHERE id = :id` — FK cascade xóa `players`, `session_surface_refs`,
  > `session_occurrences` tự động

  Đo trên migration (canonical, không đọc `schema.ts`):

  ```
  grep -riE "REFERENCES +(public\.)?sessions ?\(" packages/db/migrations/*.sql
  → 9 FK · số khai ON DELETE CASCADE: 0
  ```

  Mặc định Postgres là `NO ACTION`. **Câu `DELETE` đó sẽ ném foreign-key violation** ngay khi tồn tại
  bất kỳ child row nào — và một draft đã có người tham gia thì đã có `players` row. Spec không mô tả một
  hành vi chưa implement; nó mô tả một **cơ chế không tồn tại**. Mọi thảo luận về guard, race và error
  code đều đứng trên tiền đề này.

- **D1 — Có chấp nhận hard delete không, và trả giá thế nào?** Ba hướng khác nhau về bản chất:
  1. **Cascade thật** — sửa 9 FK sang `ON DELETE CASCADE`, gồm `charges`
     (`0003_payments_ledger.sql:46`). Mở đường cascade từ session xuống **sổ tiền**; chạm trực tiếp
     HARD RULE *"claim-có-tiền cần khoá mạnh"*. Mạnh nhất, rủi ro nhất, và một khi FK đã cascade thì
     mọi đường xoá session khác cũng thừa hưởng — không chỉ `DeleteSession`.
  2. **Giữ `NO ACTION`, chỉ xoá khi sạch child row** — FK trở thành chốt chặn tự nhiên: DB từ chối thay
     vì code phải nhớ kiểm. Fail-closed theo mặc định. Đổi lại host phải dọn thủ công trước.
  3. **Bỏ hard delete** — dùng `CancelSession` (soft delete đã có) cộng lọc ở UI.

- **D2 — Nếu chọn hard delete: bản ghi tài chính nào bị xoá?** Guard trong spec chỉ chặn charge
  `status='paid'` của player **ngoài host membership**. Hệ quả trực tiếp: charge `pending`/`failed` của
  **mọi người**, và charge `paid` **của chính host**, sẽ bị xoá cùng session. Xoá một bản ghi thanh toán
  đã hoàn tất là quyết định kế toán, không phải chi tiết implement — cần chốt tường minh chứ không để
  suy ra từ phạm vi guard.

- **D3 — Ai được xoá?** Spec tự mâu thuẫn ba chỗ trong cùng một bản sửa:

  | Vị trí trong spec | Chủ thể |
  | --- | --- |
  | bảng endpoint | `Host (web/Messenger)` |
  | bảng API | `TenantAdmin` |
  | algorithm bước 1 | `session.manage` (Host) |

  Đây không phải quyết định — là lỗi cần sửa. Ghi ở đây để nó không bị code theo dòng sai.

- **Hai điểm ĐÃ kiểm và KHÔNG cần quyết:**
  - `processed_commands` **không** có FK tới `sessions`, nên nó sống sót sau hard delete ⇒ replay trả
    previous result đúng như spec khai. Phần này chuẩn.
  - Ghi outbox `session.deleted` trước `DELETE` trong cùng transaction: cơ chế hợp lệ.

- **Cờ phụ — i18n.** Error message đang là chuỗi tiếng Việt literal trong spec
  (`"Chỉ có thể xoá buổi chơi nháp"`, `"Cần hoàn tiền cho người chơi trước khi xoá"`). i18n nằm trong 5
  HARD RULE. Nếu chuẩn là key thì sửa lúc còn là proposal rẻ hơn nhiều so với sau khi land.

- **Trạng thái [lịch sử — lúc mở proposal 2026-08-11]:** hai file spec khi đó đang `modified` chưa commit và chặn `ap-merge.sh`.
  **Trạng thái hiện tại (2026-08-12, sau reconcile clean subset):** cả hai spec đã revert về base (byte-identical, KHÔNG chứa `DeleteSession`); DD-104 algorithm absent + deferred (xem deferred-blocker note bên dưới).
  Khi build DD-104 slice: chốt D1/D2 rồi mới viết spec, KHÔNG để lại WIP trong spec đã `Reviewed`.

### Amendment 2026-08-13 — owner chốt D0–D4 (provenance: Cowork session, chọn cả 4 khuyến nghị của decision table + D0)

Nguồn: `../decisions/dd104-delete-session-decision-table.md` (soạn 2026-08-13, đo tại `main@1303c31`).
Mỗi lựa chọn dưới đây là (a)/(c) theo đúng ký hiệu của bảng; lý do đo lường nằm trong bảng, đây là bản ghi quyết định.

- **D0 — Sequencing: KHÔNG ưu tiên.** `tenant-capability-authority-core` không được kéo lên trước;
  bảng này chốt để làm vốn cho packet sau. Slice DD-104 vẫn parked cho tới khi dependency đó có packet.
  Thứ tự lane hiện hành giữ nguyên (2 nợ chat P1 trước — next-lanes 2026-08-11).
- **D1 = (a) — Ranh giới xoá: cả 5 bảng FK đều chặn, "pristine draft" đúng nghĩa.** Mọi FK trỏ
  `sessions` (`session_occurrences`, `session_surface_refs`, `players`, `charges`, `join_requests` + 4
  composite `0019`) giữ `NO ACTION`; câu `DELETE` là **final fence** — bất kỳ child row nào cũng chặn.
  KHÔNG có cascade, KHÔNG danh sách "bảng được phép dọn" phái sinh phải đồng bộ tay với schema.
  **Hệ quả: câu hỏi kế toán D2-cũ (v2.24) tự giải** — không bản ghi `charges` nào bị xoá vì bất kỳ
  charges row nào cũng đã chặn delete; hard delete chỉ khả thi trên draft thực sự sạch.
- **D2 = (a) — Authority: action class hẹp `delete_draft_session`.** Tạo mới trong ma trận
  `authorizeTenantAction` (billing contract) — mỗi admin op một class, hàng suspension rõ ràng; KHÔNG dùng
  class rộng `admin_mutation`. Đây là **sửa contract billing, slice riêng** — không phải sửa spec session.
  Đóng deferred-blocker #1 (suspension gate) ở decision level.
- **D3 = (c) — `23503` trusted resolution: hỏi catalog.** Bắt `23503`, lấy `constraint_name` từ error,
  tra `pg_constraint` xem `confrelid = 'sessions'::regclass`; chỉ map thành lỗi draft-chưa-rỗng khi đúng.
  Loại (a) allowlist (5 FK đơn dùng tên tự sinh — `DROP/ADD` tương lai làm allowlist trượt im lặng về
  fail-open) và (b) pre-check `EXISTS` (TOCTOU). Đóng deferred-blocker #3.
- **D4 = (a) — Concurrency ordering: một quyết định chung cho delete + publish.** Delete kế thừa y nguyên
  obligation của publish (`feature_session_management_tech.md` §4 step 6, `docs-session-publish-concurrency-recheck`
  merged): authority/suspension check re-evaluate **trong cùng transaction với session lock, ngay trước
  commit, qua locking read** — không check-một-lần-sớm-rồi-quên. Đóng deferred-blocker #2, không tạo cặp
  câu-trả-lời-lệch kiểu DD-79 vs DD-96.
- **Old-D3 của v2.24 (authz mâu thuẫn 3 chỗ) giải theo D2:** chủ thể chuẩn = capability `session.manage`
  thực thi qua action class `delete_draft_session`; khi spec được author lại, mọi bảng surface
  (endpoint/API/algorithm) phải dùng nhất quán một chủ thể này.
- **Cờ i18n giữ nguyên:** error message phải qua `t(vi, en)` khi author spec — không chuỗi literal một thứ tiếng.
- **Không authorize:** code, migration, packet, worktree. Slice DD-104 khi mở vẫn phải tự qua đủ
  G1–G6 + closure matrix của `review-code-readiness-gate.md`; amendment này chỉ đóng tầng decision.

---

> **⚠️ Deferred trong clean subset (2026-08-12) — DD-104 KHÔNG ratify ở đây.** *(Cập nhật 2026-08-13: cả 4 blocker dưới đã được giải Ở DECISION LEVEL bởi amendment D0–D4 ở trên — #1→D2a, #2→D4a, #3→D3c, #4→D1a. Giữ nguyên văn bản làm ràng buộc: slice DD-104 vẫn phải chứng minh implementation thoả từng điểm; decision không thay bằng chứng chạy thật.)* Reconcile giữ DD-104 ở trạng thái 🟡 đề xuất trên base; bốn blocker sau phải được giải trong **slice DD-104 riêng** với decision-table chốt **trước khi** viết algorithm (authority · 23503 resolution · money-FK boundaries · concurrency ordering), không phải phát hiện từng vòng review:
>
> 1. `DeleteSession` là **destructive admin mutation**; theo thiết kế DD-104 (algorithm hiện deferred, KHÔNG có trong session specs) nó chỉ authorize `session.manage`. Billing contract `feature_billing_lifecycle_tech.md:30` (hàng helper `authorizeTenantAction … | Any mutating API | Fail-closed 2-step suspension gate`) scope gate suspension cho **mọi mutating API**, và `:329` (khối **Concurrency**) nêu đích danh **admin mutation** là mutating action class. Như đang khai, một tenant **suspended vẫn hard-delete được session**.
> 2. `:329` yêu cầu check nằm **trong cùng transaction** với mutation, đủ gần commit để một concurrent suspend hoặc serialize trước nó hoặc bị lock chặn. Publish đã đóng ordering này (`docs-session-publish-concurrency-recheck` **merged**; resolved ở spec level `feature_session_management_tech.md` §4 step 6). **Delete có cùng shape nhưng CHƯA có delete-specific ordering obligation** — DD-104 slice phải chốt riêng cho Delete, dùng publish làm precedent. (Lưu ý: `feature_billing_lifecycle_tech.md:329` prose vẫn ghi "unresolved" — stale so với follow-up đã merged; ngoài scope reconcile này.)
> 3. Map `23503` vẫn cần **trusted constraint resolution** (chứng minh `confrelid=sessions` qua `pg_constraint`), không blanket map.
> 4. **Money-FK boundaries (D1/D2 chưa chốt) — blocker destructive-money cốt lõi:** `DELETE FROM sessions` chạm 9 FK child gồm `charges` (sổ tiền). **D1** = cascade thật (sửa 9 FK, cascade xuống `charges` — chạm HARD RULE *claim-có-tiền cần khoá mạnh*) vs giữ `NO ACTION` (FK làm chốt fail-closed) vs bỏ hard delete (dùng `CancelSession`). **D2** = nếu hard delete thì charge `pending`/`failed` của mọi người và charge `paid` **của host** bị xoá (guard hiện chỉ chặn `paid` của player ngoài host) — quyết định kế toán, phải chốt tường minh.

## DD-103 — Gap Person-merge re-parent của `0031_chat_schema_core` · ✅ Chốt (2026-08-11)

> **Status boundary:** DD-103 chấp nhận một gap **cấu trúc**, không waive một finding. Nó không nới bất kỳ gate nào, và **không** miễn nghĩa vụ sửa — nó chuyển nghĩa vụ đó sang slice Person-merge kèm mốc cứng.

- **Finding (codex round 11, lane `dd38-dd86-chat-schema-core--v2`).** Hai trigger do chính slice này thêm ở round 1–2 để đóng một security bypass — `chat_members_identity_immutable` và `chat_channels_identity_immutable` — chặn **vô điều kiện** mọi UPDATE lên `person_id` / `dm_key`. Cộng với composite FK tới `memberships` **không khai `DEFERRABLE`**, kết quả là re-parent chat rows trong một transaction merge **bất khả thi về cấu trúc**.
- **Vì sao đây không phải "chưa implement".** Một tính năng chưa làm thì viết thêm code là xong. Ở đây schema **chủ động chặn**: slice Person-merge tương lai sẽ phải viết **một migration mở đường** trước khi viết được logic. Đó là chi phí thật và phải nằm trên giấy.
- **Đo lại trước khi chốt — cả ba đều xác nhận:**
  - `docs/features/BE/feature_inapp_chat_tech.md`, hàng `| 10 | Cross-Feature | Account merge → chat authorship |`, khai *"Account merge → chat authorship | Re-parent `author_person_id`/members về canonical person (identity merge)"*, và hàng `| 11 | Merge re-parent |` là acceptance criterion *"Merge 2 person → authorship/members hội tụ canonical"*. Tức **spec đang khai một hành vi mà schema hiện tại không đáp ứng được.**
  - `docs/00-start-here/identity-model.md:234-237` xác nhận re-parent vật lý là **mặc định** của codebase này (`channel_identities`, `players`/`charges`, reachability đều repoint); tombstone-in-place là ngoại lệ **có tên**, chỉ áp cho `pay_code` (DD-02). Chữ *"Re-parent"* của spec chat khớp mặc định, không phải ngoại lệ.
  - **Person-merge chưa tồn tại**: zero match `mergePersons` / `mergeIdentity` / `merge_persons` trong `packages`/`apps` — chỉ có schema scaffolding và hợp đồng viết ra. Exposure hôm nay = 0.
- **Quyết định.** Chấp nhận gap; **không** chặn slice `dd38-dd86-chat-schema-core` vì nó.
- **Lý do — không phải "cho tiện":** hình dạng đúng của escape hatch (trigger merge-scoped) và của `DEFERRABLE` FK **phụ thuộc vào transaction merge thật trông thế nào**, mà transaction đó chưa tồn tại. Thiết kế mù rồi làm lại là kịch bản nhiều khả năng hơn. Codebase này đã có tiền lệ đúng nghĩa: `pay_code` (DD-02) được quyết cách xử lý lúc merge **khi entity đó được xây**, không phải trước. Ngoài ra lane đã ở round 11 với `fix-round-count` 5/5 — thêm design work vào đây là đúng thứ guardrail sinh ra để chặn.
- **RÀNG BUỘC CỨNG — gap này có chủ, không trôi:** slice nào implement Person-merge **phải** mang theo, trong cùng slice đó:
  1. migration mở đường: escape hatch **merge-scoped** cho hai trigger (không được nới thành mở vô điều kiện — bypass mà round 1–2 đóng phải giữ nguyên đóng),
  2. composite FK tới `memberships` chuyển sang `DEFERRABLE INITIALLY IMMEDIATE`,
  3. regression test chạy re-parent trong **một transaction deferred** thật.
  Nếu slice Person-merge tới hàng đợi mà chưa có đủ ba thứ trên, đó là **blocker của chính nó**, không phải nợ được mang tiếp. Backlog: `chat-identity-merge-reparent-enablement`.
- **Hệ quả tài liệu.** `feature_inapp_chat_tech.md` (hàng `| 10 | Cross-Feature | Account merge → chat authorship |` và acceptance `| 11 | Merge re-parent |`) giữ nguyên chữ — chúng khai đúng hành vi **mục tiêu**. Nhưng người đọc spec sau này phải biết schema chưa đáp ứng; DD này là nơi ghi điều đó. Không sửa spec thành "tombstone" — đó sẽ là đổi quyết định sản phẩm bằng một hạn chế kỹ thuật tạm thời.
- **Hệ quả vận hành cho lane hiện tại.** `fix-round-count` 5/5 nên registration `--v2` **không về READY được nữa**. Đóng bằng `ap-finish.sh --authorized-close` rồi merge trên bằng chứng, đúng đường `chat-dm-safety-authority-core--v3` đã đi dưới DD-102. Bằng chứng: 11 vòng review, mọi finding đều thật và khác nhau, suite canonical xanh 795 test tại `a8f120f`.

---

## DD-102 — Waiver round-5 finding 1, có điều kiện · ✅ Chốt (2026-08-10)

> **Status boundary:** DD-102 waive **một finding, trong một registration**. Nó không hạ gate 2-round-sạch cho slice khác, không tạo kênh waiver chung, và **không** miễn nghĩa vụ sửa — chỉ dời thời điểm sửa sang một slice khác với một mốc cứng.

- **Finding.** Codex round 5 nêu: `assert_dm_allowed` đọc cấu hình qua **bốn statement riêng biệt** — ba `SELECT … FROM chat_dm_safety_config WHERE singleton` cho `dm_sender_limit_per_min` / `dm_target_limit_per_min` / `audit_enabled`, cộng lời gọi `dm_safety_enabled()`. Dưới READ COMMITTED mỗi statement lấy snapshot riêng, nên một thay đổi config đồng thời có thể áp một phần: **torn read**.
- **Đo lại trước khi quyết — finding đúng về kỹ thuật, nhưng KHÔNG phải fail-open:**
  - `rate_limit_check(p_bucket, p_limit, p_window)` (`0012_auth_functions.sql`) chạy `IF v_count >= p_limit THEN RETURN false`. Với `p_limit = 0` thì `v_count >= 0` luôn đúng ⇒ trả `false` ⇒ `NOT false` ⇒ `deny_reason` được set ⇒ **deny**. Nên `COALESCE(…, 0)` khi thiếu config là **fail-closed**, không phải mở.
  - `dm_safety_enabled()` false ⇒ `v_deny_reason := 'safety_disabled'` ⇒ deny. Tắt safety **cấm hết**, không phải cho qua hết.
  - `audit_enabled` false chỉ tắt `RAISE LOG`, không đụng nhánh quyết định.
  - Hệ quả thật: một lần **siết** config đồng thời có thể không áp đủ cho đúng một lời gọi đang bay. Bounded, và không biến deny thành allow.
- **Exposure = 0.** `assert_dm_allowed` có **zero production caller** — chỉ xuất hiện trong comment ở `packages/db/schema.ts`. `create_dm`/`send_chat_message` (slice 7/8) chưa tồn tại. Hàm đang dark.
- **Vì sao không sửa trong slice.** Fix nằm hoàn toàn trong `0030_chat_dm_safety_authority_core.sql`, đã apply và **hash-lock** — sửa tại chỗ vỡ immutability check; viết migration mới thì ngoài registered scope. Đây đúng **known gap #1** trong `level3-workflow.md`: reviewer không có scope và **không có kênh waiver**. `fix-round-count` đã 5/5 với `clean_rounds` cần 2, nên thử lại gần như chắc chắn dính `MAX_ROUNDS` rồi vẫn phải đóng lifecycle.
- **Quyết định.** Waive finding này **cho riêng registration `--v3`**, và merge trên bằng chứng review đã có.
- **ĐIỀU KIỆN CỨNG — waiver này có hạn, không mở vô thời hạn:** migration follow-up gộp bốn lần đọc thành **một** statement (hoặc khoá tương đương) phải land **TRƯỚC caller đầu tiên**, tức trước slice 7 (`chat-shared-message-command-core`) và slice 8 (`chat-dm-lifecycle-command-core`). Backlog: `chat-dm-safety-config-single-read`. Nếu slice 7/8 tới hàng đợi mà migration đó chưa land, đó là **blocker của slice 7/8**, không phải nợ được mang tiếp.
- ✅ **ĐIỀU KIỆN CỨNG ĐÃ THOẢ — 2026-08-12, `main@80a3464`.** `0032_chat_dm_safety_config_single_read.sql` đã land, **trước** khi slice 7 hoặc 8 tồn tại (cả hai vẫn chưa được author). `assert_dm_allowed` giờ đọc singleton row **một lần** (`SELECT * INTO`) và phép AND của bốn capability toggle nằm trong helper `dm_safety_flags_enabled` làm single source, `dm_safety_enabled()` delegate về đó — số lần đọc 4 → 1, hành vi giữ nguyên từng nhánh. Bằng chứng: gate attempt 1 pass, 13/13 focused check, 813 test xanh, 2 vòng code review + 1 vòng security review đều CLEAN, `fix-round-count` 0; `ap-finish --squash-verified` xác nhận *"origin squash patch equals the READY feature diff"*. Behaviour-preservation của `CREATE OR REPLACE dm_safety_enabled()` được pin bằng acceptance row riêng (missing singleton row → deny, từng toggle false → deny, all true → allow) chứ không bằng so sánh thân hàm. **Waiver DD-102 hết nghĩa vụ; slice 7/8 không còn mang blocker này.**
- **Cơ chế đóng — có tiền lệ, không phát minh.** `deps-security-bump` registration #3 (30/07) cũng *"đóng KHÔNG qua READY … owner dispose registration và merge trên bằng chứng review"*. Ở đây: `ap-finish.sh --authorized-close` (đã chạy 2026-08-10, disposition tại `.autopilot/dispositions/chat-dm-safety-authority-core--v3.json`), rồi squash-merge qua `ap-merge.sh`. Branch `feat/chat-dm-safety-authority-core--v3` @ `fcec76b` giữ lại làm hồ sơ.
- **Ghi nhận riêng, không thuộc quyết định này:** cùng finding đã bị round 2, 3 và 4 xếp *advisory / ngoài registration / không chặn verdict* — **ba lần giống hệt** — rồi round 5 nâng thành blocking **không nêu lý do đổi**. Đó là reviewer non-determinism, đã tốn của lane đúng vòng cuối; mở riêng ở backlog, không phải căn cứ của waiver này.

---

## DD-101 — Ratify B3-budget amendment cho `chat-dm-safety-authority-core` · ✅ Chốt (2026-08-10)

> **Status boundary:** DD-101 chỉ đóng câu hỏi ngân sách cho **một slice**. Nó **không** authorize code, không đổi trần cho slice khác, và không miễn `--v3` khỏi bất kỳ gate nào — slice vẫn phải đạt strict `CODE_READY` theo `review-code-readiness-gate.md`.

- **Bối cảnh.** `plan §9:409` định nghĩa trần B3 cho slice 2: `750 changed LOC`, `≤3 modules`, `1 migration`, và ghi rõ `module set = migration + schema mirror + focused invariant test`. `§9:416` quy định: *"Vượt ceiling hoặc cần module thứ tư → `SCOPE_DESIGN` hard stop và re-slice. Cấm cắt grants, rollback proof hoặc invariant tests để ép budget."* Lane `chat-dm-safety-authority-core` vướng **cả hai vế**.
- **Đo được (2026-08-10, tại `feat/chat-dm-safety-authority-core--v2@31bd4d9`):** module `migration 0030` (363) + `schema.ts` (68) + `chat-dm-safety-invariants.test.ts` (714) = **1.145 changed LOC** cho riêng 3 module cốt lõi. Cộng `migrate.test.ts` (198), `README.md` (59), `test-harness.ts` (255), `rls-invariants.test.ts` (70) ⇒ **7 file code, 1.650 dòng thêm**. `_scope_note` trên branch tự khai: *"Module count … grew from 3 to 5 with the 2026-08-05 owner-authorized scope amendment."*
- **Quyết định.** Ratify amendment 05/08 làm **ngoại lệ có thẩm quyền** cho slice này; **không** re-slice.
- **Lý do — ba điểm, không phải "cho tiện":**
  1. **Ngoại lệ được ghi chép, không phải trần bị phá lén.** `negative_scope` trên branch không xoá điều cấm mà **thu hẹp** nó (*"NARROWED, not blanket-excluded"*), liệt kê từng touch một kèm lý do cơ học, và được mở rộng ở codex round-05 [P2] để khớp đúng thực tế đã làm. Đây là hình dạng của một ngoại lệ được quản trị.
  2. **Phần vượt là hệ quả cơ học, không phải scope creep.** Cả 4 file ngoài module set gốc đều phát sinh từ **cùng một nguyên nhân**: migration `0030` làm `ALTER FUNCTION … OWNER TO chat_definer`, buộc mọi đường replay migration hiện có phải có role đó và phải bọc lock. `rls-invariants.test.ts` chỉ bump `30→31`, đổi tên tail và thêm `withChatDefinerLock` — **không thêm RLS coverage nào**, đúng như contract nói ba bảng mới không dùng RLS.
  3. **Re-slice ở đây tốn nhiều hơn thu.** Phần lớn LOC là `chat-dm-safety-invariants.test.ts` (714) — mà `§9:416` **cấm cắt invariant tests để ép budget**. Tách nó ra slice riêng là chia một hợp đồng bất biến làm hai nửa cùng phụ thuộc một migration, tạo thêm một điểm serialize mà không giảm rủi ro nào.
- **Ranh giới — điều DD-101 KHÔNG làm:**
  - Trần `750 LOC / 3 modules / 1 migration` **giữ nguyên hiệu lực** cho slice 4 (`tenant-capability-authority-core`), slice 36 và mọi slice khác khai `§B3`.
  - Slice 3 (`dd38-dd86-chat-schema-core`) giữ trần riêng của nó (`≤1.000 LOC / 3 modules / 1 migration`) — DD-101 không đụng tới.
  - **Không tạo tiền lệ tự động.** Slice sau vượt trần vẫn phải dừng ở `SCOPE_DESIGN` và xin quyết định riêng; viện dẫn DD-101 không thay được quyết định đó.
  - Không miễn `--v3` khỏi 2 vòng codex sạch, security round, hay bất kỳ gate nào khác.
- **Hệ quả vận hành.** Reviewer của `--v3` nếu nêu chuyện vượt trần thì trỏ về DD-101 và tiếp tục, **không** `AWAIT`. Đây chính là lý do DD này phải tồn tại trước khi T0b chạy: không có nó, câu hỏi sẽ nổ giữa vòng review và tốn một vòng codex để trả lời bằng đúng những dữ kiện đã có sẵn ở đây.

---

## DD-100 — Level 3.1 adoption cho Plexco · ✅ Chốt (2026-08-09)

> **Status boundary:** DD-100 chốt **hướng đi và thứ tự**, không authorize code. Slice packet, register, worktree và merge vẫn đi qua `review-code-readiness-gate.md`. Plan kèm verdict: `../autopilot-templates/level3.1-adoption-plan.md` — hiện `NOT_CODE_READY` với blocker B1–B5.

- **Bối cảnh.** `level3.1-design-discussion.md` là draft `workflow-authority: none` với 5 câu hỏi mở, pin snapshot KIT_VERSION 25 (31/07). Bước 0 đo lại 2026-08-09 tại `64e9ccb` / **KIT_VERSION 31**: ba claim cốt lõi còn đúng — validator vẫn pin cứng `level3-operational-v2` (`autopilot-review-readiness.mjs:273-274`, `autopilot-scope-gate:547,550,607,640`); ledger vẫn là hoá thạch mọi count = 0; cả ba gap Phase 0 còn hở.
- **D1 — Plexco-local trước, canonical sau.** Đảo hướng consumer của discussion doc. Giá đã chấp nhận: Plexco fork khỏi kit v31 kể từ slice đầu; mọi sync canonical sau là merge tay; mỗi slice phải mở backport entry; `KIT_VERSION` dùng hậu tố consumer để không đọc nhầm fork thành canonical.
- **D2 — Phase 0 song song P4/P5, nhưng serialize theo file thật.** Phase0-gap1, Phase0-gap2 và P5 **cùng ghi `scripts/codex-review-pin.sh`** ⇒ ba writer một file, Level 3 §7 cấm. Land order: làn A tuần tự `P4-standard → gap1 → gap2 → P5`, làn B song song `gap3`. Hai ràng buộc không đảo: **P4-standard trước Phase 0** (chuẩn fixture phải có trước khi ba gap viết fixture theo nó), **P1 sau gap3** (gap 3 làm hỏng chính tín hiệu `MAX_ROUNDS` mà P1 dựa vào).
- **D3 — nhận schema v3, forward-only.** `design_contract` chỉ tồn tại trong `level3-operational-v3`; validator + scope-gate sửa phối hợp, chấp nhận cả v2 lẫn v3 trong cửa sổ chuyển tiếp. **Không retrofit manifest v2 đang active** — runtime manifest hash-lock sau `register`, thêm trường = ép `MANIFEST_DRIFT`. Lane `chat-dm-safety-authority-core--v2` sống hết vòng đời ở v2. Không thêm `manifest_schema_version` vào authored contract (`scope-gate:548` HALT `CONTRACT_INVALID`).
- **D4 — giết ledger + `proactive_routine`.** Owner uỷ quyền theo tiêu chí lợi ích dài hạn; quyết định bằng đo, không bằng sở thích: **zero consumer** (16/16 manifest khai `supervised`, không nơi nào khai `proactive_routine`), **zero writer** (consumer duy nhất `autopilot-onboard.sh:236` chỉ kiểm file tồn tại), **mục đích gốc đã bị bác** (ledger phục vụ `auto_merge_after_2x_codex_clean`, thứ Level 3 đã bỏ), và **cứu nó xung đột ràng buộc git của Plexco** (durable append buộc `ap-finish.sh` mutate default worktree — đúng lớp tranh chấp root-lock sinh ra để dập). Phạm vi xoá: `.autopilot/maturity-ledger.md` · `.gitignore:55-57` · `autopilot-review-readiness.mjs:316` · `level3-workflow.md:47,72,172,385` · `autopilot-ONBOARDING.md` (3 chỗ) · `autopilot-onboard.sh:236` · block `level3-workflow` trong `CLAUDE.md`.
- **Hệ quả.** Mọi slice 3.1 là **kit-maintenance**: theo P3, `gate_profile: light` không bao giờ áp dụng cho diff chạm reviewer wrapper / scope-readiness validator / manifest schema / review-readiness gate — kể cả file `.md`/`.sh`; và không slice nào được tự certify bằng gate mà chính nó đang sửa. Blocker nặng nhất là **B1**: lane `chat-dm-safety-authority-core--v2` @ `31bd4d9` đang đỗ chờ đúng `codex-review-pin.sh` mà ba slice đầu sẽ sửa ⇒ đóng M1 trước khi mở slice 3.1 đầu tiên.

---

## DD-117 — `CloseSession`/`CancelSession`: nhánh paid/retry-root = FAIL-CLOSED REFUSE; deferral 14/08 bị thay · ✅ Chốt (owner 2026-08-25)

> **Status boundary:** DD-117 chốt **hành vi nhánh tiền** của `CloseSession`/`CancelSession` (và các guard
> tiền tương ứng của `UpdateSession`) khi subsystem payments/review_policy CHƯA tồn tại: **fail-closed
> refuse** bằng mã lỗi theo spec §3 (lớp `CANCEL_REQUIRES_REVIEW`). Nó **thay phần deferral** của
> disposition 14/08 (`session-commands-update-close-cancel`). Nó **KHÔNG** authorize subsystem
> payments/review_policy, migration/schema.ts, route/API/FE, projector/dispatcher/schedule, hay
> `DeleteSession`. Literal `update_open_session`/`close_session`/`cancel_session` vào `ActionClass` theo
> DD-110 D3 (cùng commit mang command). Slice vẫn phải qua G1–G6 + closure matrix của
> `review-code-readiness-gate.md`.

### Bối cảnh — hai bản ghi mâu thuẫn, bản mới thắng

Disposition 14/08 (`.autopilot/dispositions/session-commands-update-close-cancel.json`, `authorized_close`)
re-scope task về announce-only và ghi: *"close_session/cancel_session are blocked on the payments/
review_policy subsystem (spec edge #5 requires resolving nonterminal finance roots before commit;
mechanism absent on base) and deferred to a future slice."* Chỉ `announce_session` ship (→
`session-command-announce--v2`, merged).

**Hôm sau, DD-110 (15/08) mint `close_session`/`cancel_session` + hàng ma trận ✅-khi-suspended** — chỉ có
nghĩa nếu hai command đó **sẽ được build**. Hai bản ghi cùng chủ đề, ngược hướng. Theo đúng nguyên tắc
DD-111 D4 (bản ghi bền, mới hơn, thắng lời khai/disposition cũ), owner phân xử tại đây.

### D1 — Deferral 14/08 là mis-scope; fail-closed refuse là đọc đúng edge #5

Edge #5 (`feature_session_management_tech.md:215`): *"require review_policy — no silent cancellation …
successful close/cancel resolves all nonterminal roots before commit"*. Bản 14/08 đọc thành *"phải BUILD
cơ chế resolve roots mới ship được"* ⇒ blocked. Đọc đúng hơn: close/cancel **bắt buộc review_policy** cho
ca paid roster / retry root; khi cơ chế đó chưa tồn tại thì thao tác **không thành công** ⇒ **từ chối**
bằng mã lỗi lớp `CANCEL_REQUIRES_REVIEW` (`:284`) — đúng "no silent cancellation". Refuse **không phải
money-gap**: không tiền nào bị dịch chuyển sai, chỉ là chặn có mã lỗi (cùng hình đã dùng cho edge #28
draft-anomaly).

### D2 — An toàn hôm nay vì ca nguy hiểm CHƯA reachable

Trên `main` hiện tại **chưa có luồng join/waitlist/payments** (0 route nghiệp vụ; create/publish/announce
là toàn bộ session op). Một session **không thể** mang paid roster, `charges`, hay nonterminal retry root
⇒ nhánh refuse là **guard phòng thủ**, hôm nay không reachable. Khi subsystem đó land, close/cancel một
session paid sẽ **refuse** cho tới khi slice review_policy được build — tức fail-closed **ép** đường review
phải tồn tại TRƯỚC khi trạng thái paid trở nên reachable. Posture forward-safe, không rò tiền.

### D3 — Authorize / KHÔNG authorize

**Authorize:** build `UpdateSession` + `CloseSession` + `CancelSession` như SessionService command trên
pattern S2 (`createSession`), mỗi command một `withTenant` transaction — dedup `processed_commands`,
`expected_version`, transition guard, outbox event, re-check suspension dưới lock qua
`authorizeTenantAction`; literal `update_open_session`/`close_session`/`cancel_session` + hàng ma trận vào
cùng commit mang command (DD-110 D1/D2/D3); nhánh paid roster / retry root / charge → **fail-closed
refuse** (mã lỗi theo spec §3). Slicing do primary agent quyết (1 hoặc nhiều slice tuần tự, cùng worktree
— cùng file nên không writer song song). STOP_AT_READY.

**KHÔNG authorize:** subsystem payments/review_policy (resolve nonterminal roots, refund/settlement, apply
impact_policy resolution) = slice riêng tương lai; migration/schema.ts; route/API/FE;
projector/dispatcher/schedule; `DeleteSession` (DD-104 parked); đổi nguyên tắc miễn trừ DD-105 hay
fail-closed resolution / thứ tự `FOR SHARE` của billing; **capacity policy** — DD-112 vẫn ⬜: slice giữ
`CAPACITY_BELOW_ROSTER` cho ca dưới roster, **KHÔNG** couple capacity vào `impact_policy`/DD-49, **KHÔNG**
sửa edge #4.

### D4 — Nghĩa vụ test (giữ nguyên DD-110 D4)

Slice bắt buộc mang: (1) test âm `updateSession` trên `draft` **KHÔNG** gọi `authorizeTenantAction` (miễn
trừ DD-105 + DD-110 D4); (2) test ma trận suspended — close/cancel **allowed** khi suspended,
update/announce **denied**; (3) test nhánh fail-closed refuse cho paid/retry-root/charge. Thiếu (1)/(2)
thì D1/D2 mới được viết chứ chưa được thực thi.

### D5 — (Bổ sung 2026-08-25) Họ lệnh session dedup trên `(tenant_id, command_id)` DUY NHẤT; content fingerprint BỊ TỪ CHỐI

**Bối cảnh.** Slice `session-command-update` (Slice A, `UpdateSession`) **HALT MAX_ROUNDS** ở vòng review thứ 6
trên một **[P1]**: `updateRequestFingerprint()` dùng **SHA-256 không khoá** trên trường PII địa điểm
(`venue_name`/`venue_address`/`area`), rồi **lưu digest vào `processed_commands`** — bảng **sống lâu hơn
session sau khi xoá**. `session_id` + `version` nằm ngay cùng row (plaintext) và cấu trúc JSON canonical nằm
trong source ⇒ ẩn số duy nhất là chuỗi địa điểm **entropy thấp** (quận VN, tên sân phổ biến) ⇒ kẻ đọc được
`processed_commands` **dò từ điển offline** khôi phục PII đã xoá — mâu thuẫn chính lời hứa "no recoverable
field value" của contract + **HARD RULE 2**.

**Nguyên nhân thiết kế (không phải lỗi lẻ).** Fingerprint là **escalation do reviewer lái**: vòng 2 codex ép
`updateSession` "bind replay theo nội dung request" (cơ chế mà `createSession`/`publishSession`/`announceSession`
**không** có) → vòng 3 binding đó rò PII thô ⇒ hash SHA-256 → vòng 6 hash vẫn dò được ⇒ đòi keyed HMAC.
**Đã verify:** ba lệnh chị em dedup trên `(tenant_id, command_id)` **DUY NHẤT**, không fingerprint nội dung
(`createHash`/`requestFingerprint` chỉ xuất hiện trong vùng `updateSession`). `updateSession` một mình lưu
verifier phái sinh PII ⇒ **lệch chuẩn** + chống lại bất biến "PII phải xoá được".

**Quyết định (owner 2026-08-25).** Cả họ lệnh session (`update`/`close`/`cancel` cùng
`create`/`publish`/`announce`) dedup trên `(tenant_id, command_id)` **DUY NHẤT**. **Content fingerprinting BỊ
TỪ CHỐI** cho họ lệnh này: (a) một file **không** mang hai dedup semantics — commandId-only là house pattern
đã ratify ba lần; (b) chuỗi R2→R3→R6 là cơ chế fingerprint **đòi cả một surface key-management** (pepper/KMS)
mà repo **cố ý CHƯA pin** (A3 matrix đang cờ KMS provider *unpinned*) — một slice session-command **không
phải** chỗ giới thiệu surface đó; (c) mất phát hiện "cùng commandId + request khác nội dung" là **semantics
tiền-tồn-tại, đã chấp nhận**, không phải rủi ro mới — caller chịu trách nhiệm commandId duy nhất per request.
**Revisit chỉ như một DD family-wide** nếu về sau thật sự cần.

**Hệ quả thực thi.** Nếu vòng review sau **tái nêu** "bind replay theo nội dung request" (lớp R2), nó
**OUT-OF-CONTRACT** — dismiss bằng cách trỏ D5 này + pin trong contract của successor; **KHÔNG** thêm lại
fingerprint. Successor (`session-command-update` kế) **re-register từ `main` sạch**, manifest mới, **scope NHỎ
HƠN**: bỏ `updateRequestFingerprint` + guard/test của nó, **port outcomes vòng 1–5 làm tham chiếu** (past-guard,
optimistic lock, effective past-fence, `session.visibility_changed`, payload spec-exact, DD-110 D4 test âm, ma
trận suspended). Lane cũ đóng qua HALT path (`ap-finish.sh --authorized-close`, forensics lưu, branch giữ),
finding **ACCEPTED** ⇒ successor pre-authorized (level3-workflow §6.1), MAX_ROUNDS budget mới, **không mang theo
amendment nào**.

---

## DD-116 — Lệnh FE PENDING (13/08): đưa vào decision log · ✅ Chốt Option B — KEEP (owner 2026-08-24)

> **Nguồn:** audit V2 (`../sessions/2026-08-24-repo-audit.md`) + DD-113 D5. Lệnh FE PENDING owner ra 13/08 đang chặn **100% launch scope DD-113**, nhưng primary source duy nhất là `../autopilot-templates/next-lanes-2026-08-13-RUN.md` rồi mirror sang ROADMAP/HANDOFF — **chưa từng thành một DD**. Đây đúng thứ **DD-111 D4** cấm: quyết định owner phải sống trong decision log (bản ghi bền), không chỉ trong RUN doc/hội thoại (lời khai). **DD-116 nay là nguồn bền (durable source) của trạng thái FE PENDING**, thay cho RUN doc 13/08; owner đã ratify **Option B — KEEP** (2026-08-24).

- **Bối cảnh:** FE từng là **HOLD chờ gate** (owner nghiệm thu canonical `.pen` theo DD-81). Từ 13/08 owner đổi thành **PENDING theo lệnh** — mạnh hơn HOLD: DD-81 / M0.3 / M4 và **mọi việc FE** treo lại, **không** track `.pen`, **không** mở page/component, lane FE không chạy. Khác biệt cốt lõi: HOLD thì hoàn thành gate là đi tiếp được; PENDING thì gate không còn là thứ chặn, **quyết định owner mới là**. Hệ quả đo được (audit V2): 5 khối launch DD-113 (signin/signup · link Zalo bot · session management · session detail · settings) **không khối nào khởi động được**, dù nhóm 1 (auth) BE đã ~80%. `design.pen` (22/07) + `fe.pen` (07/08) vẫn untracked **có chủ ý**.

### Quyết định (owner 2026-08-24): **Option B — KEEP**

FE PENDING **giữ nguyên hiệu lực**. Trạng thái chặn nay bền + audit được: chỉ **một named trigger owner-verifiable** dưới đây gỡ được nó — **không** sự kiện nào khác (không phải đổi GTM, không phải BE readiness, không phải hội thoại).

**Named trigger — FE PENDING gỡ khi CẢ BA điều kiện đồng thời đúng, verify tại một chỗ:**

1. **(a)** owner đã chọn **canonical design file** (đường DD-81: `design.pen` **hoặc** `fe.pen` — đúng **một** file được đặt tên canonical);
2. **(b)** file đó **được track trong git trên `main`** (tới khi đó luật *không track `.pen`* của PENDING vẫn nguyên hiệu lực);
3. **(c)** owner đã **ký nghiệm thu** file đó làm design authority bằng một mục trong `decisions.md` (đóng gate DD-81).

**Khi trigger thoả:** FE work được authorize **giới hạn chặt trong đúng 5 khối launch DD-113** (signin/signup · link Zalo bot · session management · session detail · settings), và **mọi lane FE vẫn phải** qua Level 3 + readiness gate bình thường.

### Không gian lựa chọn đã cân nhắc (giữ cho audit)

- **Option A — LIFT (gỡ PENDING) — ⛔ KHÔNG chọn.** Sẽ kết thúc PENDING ngay + authorize FE bounded đúng 5 khối launch (lane vẫn qua gate), track `.pen` theo DD-81. Owner **không** chọn hướng này.
- **Option B — KEEP (giữ PENDING) — ✅ ĐÃ CHỌN.** Giữ PENDING kèm named trigger ở trên ⇒ trạng thái chặn **bền + audit được** thay vì hội thoại.

### Ràng buộc chung

- **Không đảo DD-113 D5:** DD-113 **không** gỡ PENDING — đổi ưu tiên GTM và cấp quyền thực thi FE là hai quyết định khác nhau; DD-116 là chỗ ký riêng cho quyết định thứ hai.
- **Không đảo DD-69** (PWA là phase-1 target) và **không** đổi P-number.
- `.pen` tracking vẫn theo **DD-81 gate riêng**, và chính là **điều kiện (b)+(c)** của named trigger.
- **Tới khi named trigger thoả đủ 3 điều kiện:** **KHÔNG** authorize code / migration / FE lane / `.pen` tracking. Khi thoả ⇒ chỉ authorize FE **bounded đúng 5 khối launch DD-113**, mỗi lane vẫn qua Level 3 + readiness gate. **DD-116 là nguồn bền** của trạng thái PENDING; RUN doc 13/08 hạ xuống vai trò lịch sử. ROADMAP/HANDOFF đã mirror cùng phiên (2026-08-24).

---

## DD-115 — Membership: gói hội viên chu kỳ 30 ngày cho player · ✅ Chốt D1–D5 (owner 2026-08-25) · ⬜ D6–D8 còn mở

> **Nguồn:** requirement owner 2026-08-24; owner ratify D1–D5 ngày 2026-08-25. Spec: `../features/FE/feature_membership.md` v0.3 + `../features/BE/feature_membership_tech.md` v0.3 — vẫn **Draft**, chưa qua readiness gate.
>
> ⚠️ **Đọc đúng cấp thẩm quyền:** ✅ ở đây là **decision-level cho D1–D5** (hình dạng dữ liệu + đường tiền + cách tính), **không** phải `PLAN_READY`/`CODE_READY` và **không** authorize code/migration/slice. Ba nhánh D6/D7/D8 còn ⬜ và **chặn build đầu-cuối**: D6 chặn quyền lợi, D7 chặn kích hoạt gói, D8 chặn ngoài. Slice chạm ba nhánh đó phải `AWAIT`.

- **Bối cảnh:** Player sinh hoạt theo lịch cố định đang trả tiền từng buổi — mỗi buổi một `charge`, một lần CK, một lần đối soát. Requirement: cho phép trả **một lần** cho toàn bộ buổi trong **30 ngày** kể từ ngày player chọn, có chiết khấu theo gói (weekdays / weekends / cả tháng), kèm quyền lợi (vào buổi đã full, chiết khấu phí giải đấu) và **mọi tham số đều config động**.

  Trước khi thiết kế phải gỡ một cái bẫy tên gọi: repo đã có **ba** thứ mang chữ membership/subscription — `memberships` (quan hệ person↔tenant, BL-ID-1/BL-ID-4), `subscriptions`+`plans` (billing SaaS của **host**, `free`/`host_pro`, DD-29) và `membership_tags` (DD-43, chưa migrate). Gói trả phí của **player** không phải cái nào trong ba cái đó. DD-43 + BL-SES-7 còn đóng thẳng đường tắt hấp dẫn nhất: *"tag không tạo eligibility, role, **giá**, quyền"* — nên không được nhét gói vào tag.

### Quyết định — D1–D5 ✅ chốt, D6–D8 ⬜ còn mở

- ✅ **D1 — Lớp thương mại ĐẶT TRÊN `memberships`, không sửa `memberships`.** `memberships` giữ nguyên 7 cột, tiếp tục là identity anchor duy nhất (`pay_code`, merge chain, `memberships_active_person_unique`). Chu kỳ gói là **bảng con** hang off nó. Đây là cách thoả CLAUDE.md *"không tạo bảng song song với khái niệm đã có"* mà vẫn không nhồi vòng đời tiền vào một bảng định danh.

- ✅ **D2 — Model là N charge đã chiết khấu + một giao dịch allocate sang N charge. "Một charge tổng" bị BÁC.** Đo tại live schema (`packages/db/schema.ts:1053`, `0003_payments_ledger.sql`): `charges.session_id` và `charges.player_id` đều **NOT NULL**, có `charges_tenant_session_player_uq (tenant_id, session_id, player_id)`, cộng hai composite FK tenant-integrity `charges_tenant_session_fk`/`charges_tenant_player_fk` vừa land ở `0019` (DD-68). Một charge phủ 17 buổi cần `session_id` NULL ⇒ drop NOT NULL + đổi UNIQUE + nới cả hai FK. Đó là **sửa bất biến đường tiền cho một tính năng bán hàng** — đúng thứ HR2 cấm. Ngược lại, `payment_allocations` vốn đã là quan hệ **nhiều allocation trên một `bank_transaction`** (`idx_alloc_bank_txn`), nên N-charge model chạy được với **zero thay đổi trên mọi bảng tiền**. Chi phí duy nhất chuyển sang **chính sách** (D7), không phải schema.

- ✅ **D3 — Số buổi là dữ liệu ĐO từ `sessions` thật, cấm nhân số tuần.** Cửa sổ 30 ngày = 4 tuần + 2 ngày, nên số buổi của mỗi thứ trong tuần **không đều nhau**. Kiểm bằng lịch thật trên chính ví dụ của requirement — `start = 23/08/2026` (Chủ nhật), cửa sổ `[23/08 … 21/09]`:

  | Gói | Các buổi | Số buổi |
  |---|---|---|
  | weekdays (T3+T5) | 25/08, 27/08, 01/09, 03/09, 08/09, 10/09, 15/09, 17/09 | **8** |
  | weekends (T7+CN) | 23/08, 29/08, 30/08, 05/09, 06/09, 12/09, 13/09, 19/09, 20/09 | **9** |
  | cả tháng | hợp hai tập trên | **17** |

  Requirement giả định cả tháng = 16 buổi. Với chính ngày bắt đầu mà requirement nêu, con số đúng là **17**. Hệ quả phải nói rõ: hai gói "2 buổi/tuần" **không** bằng nhau về giá, và gói cả tháng **không** bằng tổng hai gói kia. Vì vậy: đếm bằng query trên `sessions` trong cửa sổ (lọc theo **ngày địa phương** của từng buổi, không theo UTC), và **fail-closed** khi horizon recurrence chưa sinh đủ buổi tới `ends_on` — không bán gói rồi tạo charge treo.

- ✅ **D4 — Config gói có version, immutable per version.** Yêu cầu "mọi tham số config động" **không** được cài bằng `settings(tenant_id, key, jsonb)`: bảng đó không có version, không có provenance, không có kiểu — không đủ cho tham số quyết định tiền (BL-SEC-3 buộc audit mọi thao tác chạm tiền). Đề xuất `membership_plans` với `(tenant_id, plan_key, version)` UNIQUE, `created_by` NOT NULL, sửa = INSERT version mới. Chu kỳ **snapshot** `plan_version` + đơn giá từng buổi ⇒ host đổi giá hay đổi tỉ lệ chiết khấu về sau **không hồi tố** lên chu kỳ đã bán (BL-SES-3 *"không silent mutation"*).

- ✅ **D5 — Quyền lợi fail-closed.** Chu kỳ chỉ `active` khi **mọi** charge của nó đã `paid`. CK thiếu ⇒ không kích hoạt một phần, không quyền lợi (cùng nguyên tắc BL-CBF-2: QR và nút "đã trả" không phải bằng chứng). Trạng thái tiền không chứng minh được ⇒ trả `unknown` và **không** cấp quyền (BL-PAY-12).

- ⬜ **D6 — CHƯA CHỐT, chạm HARD RULE: quyền vào buổi đã full.** BL-SES-2 và BL-CBF-3 pin *"một capacity authority"* — admission occupancy không vượt `slots_max`. Cho member vượt là **sửa bất biến đó**, nên phải là quyết định owner, không phải chi tiết spec ⇒ **Tier C** theo DD-107. Kèm theo là một gap hạ tầng: **repo không có khái niệm "sân"** — `sessions` chỉ có `slots_max`, và chuỗi `court` **không xuất hiện ở đâu** trong `packages/db`. "Tối đa 8 người/sân" vì vậy cần thêm `sessions.court_count` (hoặc config tenant-level) trước khi phát biểu được. Hai nhánh: (a) nâng trần hiệu dụng cho member `active` lên `court_count × max_per_court`; (b) không nâng trần, chỉ cho member quyền ưu tiên trong waitlist.

- ⬜ **D7 — CHƯA CHỐT: bind giao dịch vào chu kỳ (ngoại lệ với BL-PAY-5).** BL-PAY-5 quy định FIFO oldest-first. Một CK 1.496.000đ của người **đang nợ buổi lẻ cũ** sẽ bị matcher hút vào nợ cũ trước, khiến gói không đủ tiền và không kích hoạt — trong khi player tin là đã trả xong. Cần cơ chế bind (pay_code riêng cho chu kỳ / allocation group / memo có cấu trúc). Đây là **ngoại lệ có chủ đích** với một business rule đang active, nên phải viết vào DD chứ không giấu trong service.

- ⛔ **D8 — CHẶN NGOÀI: chiết khấu phí giải đấu.** `tournaments` **chưa tồn tại** trong `packages/db`; `../features/BE/feature_tournament_tech.md` v0.3 ghi rõ **v1 không đụng tiền, entry-fee deferred** (DD-82). Quyền lợi này không có nơi tiêu thụ. Thêm nữa, "giải ngay sau đó" chưa định nghĩa được — giải nào đủ điều kiện (bắt đầu trong chu kỳ? giải kế tiếp bất kể ngày?). Spec giữ `tournament_discount_bp` như trường config **không có consumer**, và không viết luồng.

- **Lý do:** Ba ràng buộc kỹ thuật quyết định gần như toàn bộ hình dạng feature này, và cả ba đều đo được chứ không phải suy đoán: `charges` bị khoá theo session (D2), số buổi không chia đều cho 7 (D3), và capacity chỉ có một authority (D6). Thiết kế nào bỏ qua một trong ba đều dẫn tới hoặc sửa bất biến tiền, hoặc bán sai giá, hoặc tạo capacity authority thứ hai.

- **Hệ quả:**
  - **Schema:** 3 bảng mới (`membership_plans`, `membership_cycles`, `membership_cycle_charges`) tenant-private ENABLE+FORCE RLS, composite FK cùng-tenant theo pattern DD-68; **0 thay đổi** trên `charges`/`payment_allocations`/`bank_transactions`; `memberships` **0 thay đổi**. Thêm `sessions.court_count` **chỉ khi** D6 chọn nhánh (a), đi migration riêng.
  - **Business rules:** cần bổ sung nhóm `BL-MBS-*` khi DD chốt, và **ghi rõ ngoại lệ** với BL-SES-2 (D6) + BL-PAY-5 (D7) — không để hai rule mâu thuẫn ngầm.
  - **Rate registry:** thêm hàng `/api/membership/*` vào Appendix BL-SEC-5.
  - **Phase:** P4+ sau Session core + Payment reconcile; **ngoài phase-1** theo DD-114 D7 và ngoài launch theo DD-113 D3.
  - **Chưa authorize:** ✅ D1–D5 chỉ mở đường **viết spec/plan**, không mở đường code. Không migration, không packet/worktree/slice, không enablement. DDL trong BE spec là **contract cần build**. Điều kiện resume nhị phân: D6 + D7 có quyết định owner (D8 chờ DD-82) ⇒ lúc đó mới author được implementation plan để qua `review-code-readiness-gate`.

- **Open questions (mirror `MBS-OQ-1..10` của spec):**

  | OQ | Câu hỏi | Chặn gì |
  |---|---|---|
  | MBS-OQ-1 | Phạm vi ngày bắt đầu — requirement tự mâu thuẫn: *"chọn 1 ngày bất kỳ trong tháng đó"* vs ví dụ *"hỏi ngày 23/08 thì chỉ được chọn 23/08"* | Luồng bot bước 2 |
  | MBS-OQ-2 | Số sân — thêm `sessions.court_count`, suy từ `slots_max`, hay config tenant-level | D6, quyền vượt slot |
  | MBS-OQ-3 | Buổi **ngoài** gói (weekdays muốn chơi T7): giá lẻ hay giá chiết khấu? có quyền vượt slot không? | UC-8 |
  | MBS-OQ-4 | Cơ chế bind CK vào chu kỳ | D7, kích hoạt gói |
  | MBS-OQ-5 | Chính sách huỷ/hoàn: buổi bị huỷ · member rời CLB · player huỷ giữa chừng | Rollout GA |
  | MBS-OQ-6 | Chồng lấn chu kỳ: cấm, cho phép, hay auto-nối tiếp | Constraint EXCLUDE |
  | MBS-OQ-7 | Ngoại lệ capacity (D6) | Tier C, cần owner |
  | MBS-OQ-8 | Chiết khấu giải đấu (D8) | Chặn ngoài bởi DD-82 |
  | MBS-OQ-9 | Đơn vị + hướng làm tròn khi chiết khấu ra số lẻ | Bất biến Σ charge = total |
  | MBS-OQ-10 | Đặt tên bảng — `membership_cycles`/`membership_plans` đụng ngữ nghĩa `subscriptions`/`plans` của billing host | Tránh nhầm ở code lẫn doc |

---

## DD-114 — Phase-1 feature scope: 7 nhóm; launch (DD-113) là **subset**, không phải cùng một thứ · ✅ Chốt (owner 2026-08-22)

> **Status boundary:** DD-114 định nghĩa **phạm vi phase-1** + **thứ tự ship** + **hai hard dependency**.
> Nó KHÔNG authorize slice/code/migration/worktree/enablement, KHÔNG đổi canonical P-number, KHÔNG gỡ
> lệnh FE PENDING 13/08, và **KHÔNG thay DD-113 D2** — launch scope 5 khối giữ nguyên và là subset của
> phase-1. Hai văn bản không mâu thuẫn: DD-113 trả lời *ship trước cái gì*, DD-114 trả lời *phase-1 gồm
> những gì*.

### D1 — Phase-1 = 7 nhóm

| # | Nhóm | Spec owner hiện có | P-number ROADMAP | Ở launch DD-113? |
|---|---|---|---|---|
| 1 | **Signup / signin bằng Google account** | `../features/BE/feature_web_auth_onboarding_tech.md` + FE pair | P0–P1 | ✅ khối 1 |
| 2 | **Create club** (tenant provisioning self-serve) | `feature_multi_tenant_tech.md` · `feature_club_tech.md` · `feature_connector_onboarding_tech.md` (R5) | P4 | ❌ **mới so với launch** |
| 3 | **Link club ⇄ Zalo bot** (tenant routing) | `feature_zalo_channel_tech.md` · `feature_tenant_routing_authz_tech.md` (R1) | P2 | ❌ **mới so với launch** |
| 4 | **Link Plexco account ⇄ Zalo account** (identity) | `feature_identity_tech.md` · DD-50 `link_code` · DD-14 🔗 | P3.5 | ✅ khối 2 |
| 5 | **Sync data Plexco ⇄ Zalo bot** + owner config public/private session | `feature_sync_engine_tech.md` · `feature_channel_booking_funnel_tech.md` (DD-32) · `feature_marketplace_discovery_tech.md` (DD-12/DD-73..78) | P4 / P4.3 | ❌ **mới so với launch** |
| 6 | **Manage session · session detail · auto remind payment** (confirm thanh toán, nhắc nợ, gạch nợ tự động) | `feature_session_management_tech.md` · `feature_payment_reconcile_tech.md` · `feature_notifications_reminders_tech.md` | P2 / P3 / P4 | 🟡 **một phần** — khối 3+4 ở launch; toàn bộ vế tiền ❌ |
| 7 | **Settings · user setting / privacy** | `feature_user_settings_tech.md` | P4 | 🟡 khối 5 ở mức tối thiểu; vế privacy ❌ |

**Đọc bảng này cho đúng: "phase-1" như định nghĩa ở đây ≈ P0→P5 của ROADMAP trừ discovery/chat.** Nhóm 6
kéo theo cả P2 (mark-paid) lẫn P3 (đối soát CK) lẫn P5 (billing — xem D2); nhóm 5 kéo theo P4 + P4.3.
Đây là phạm vi lớn cho một solo dev, và **launch subset của DD-113 chính là thứ giữ cho nó không trôi**:
launch chứng minh vòng lặp chạy được, phần còn lại của phase-1 mới đáng đầu tư.

**Vì sao nhóm 2 và 3 ở phase-1 nhưng không ở launch:** launch chạy trên **tenant provision thủ công**
(tenant #1 dogfood, đã có trong kế hoạch migrate). Self-serve create club + link club ⇄ bot là thứ mở
cửa cho **host ngoài**; chúng cần thiết cho phase-1 nhưng không cần thiết để ship lần đầu.

### D2 — Nhóm 6, vế tiền: giữ đúng DD-40/DD-29 — auto-reconcile **và** nhắc tự động đều là `host_pro`

Owner chốt: **cả hai có trong phase-1, nhưng chỉ cho `host_pro`**; tier free giữ **mark-paid thủ công**
làm baseline toàn cầu. Đây là đọc đúng DD-40 (mark-paid thủ công mặc định MỌI tier; auto-reconcile +
nhắc tự động là `host_pro`) chứ không phải ngoại lệ mới.

**Hệ quả bắt buộc, phải nói ra vì nó đắt:**

1. **Billing (P5) vào phase-1.** Không có subscription + lifecycle thì không có `host_pro` để gate. Kéo
   theo `feature_billing_lifecycle_tech.md`, Suspended Action Matrix, và bốn action-class literal của
   DD-110 phải thực sự vào enum khi command của chúng land.
2. **DD-29 entitlement registry phải có reader thật đầu tiên.** Đo tại `a151b15`: `entitlements` /
   `capabilities` có trong schema (`0028`/`0029`) nhưng **0 TS nào đọc** — code dark từ 07/08. Phase-1
   biến nó thành đường thực thi, tức `payment_reconcile_auto` là capability đầu tiên được enforce thật.
3. **Đối soát CK durable vào phase-1:** webhook → transaction → allocation → charge/debt → `/unmatched`
   (R2), cộng provider onboarding DD-30 (APIpay enterprise auto-provision per-host, tiền vẫn về TK host).
   Current provider authority là `sepay|apipay` cho Việt Nam.
4. **Auto-reconcile chỉ `Available` khi ĐỦ chuỗi gate cùng pass:** entitlement + market + provider + bank
   + currency + consent + runtime. Đây không phải capability toàn cầu và **cấm quảng bá như capability
   toàn cầu** trong bất kỳ sales script hay landing nào (ràng buộc đã có từ mirror 28/07).
5. **Chạm HARD RULE.** Vế tiền của nhóm 6 đi thẳng vào *claim-có-tiền cần khoá mạnh* (HR4 — khoá mạnh
   phase-1 là verified email hoặc `link_code`, DD-50) và *tiền/PII không ra public* (HR2). Mọi slice
   trong vế này là Tier C theo DD-107; không lane nào tự quyết.

### D3 — Nhóm 5, vế public/private: **trả nợ fence TRƯỚC**, đây là hard dependency

Owner chốt: `public_projection_fences` + guarded view + narrow raise/CAS-clear + `public_projection_version`
+ grant migration đưa consumer khỏi base table (**(8a)** trong `../product/ROADMAP.md` §Next Actions, là
**nợ sẵn có của DD-12** chứ không phải chi phí của tính năng mới) phải **land trước** khi mở toggle
public/private cho club owner.

Lý do là một lỗ đang mở, không phải nguyên tắc: hiện kèo chuyển **private** hoặc **cancel** vẫn còn lộ
trên public read model **cho tới khi projector async chạy xong**. Mở toggle trước khi có immediate-deny
path nghĩa là trao cho owner một cái công tắc **không tắt ngay được** — đúng thứ HR2 cấm.

⬜ **Open question kèm theo, chưa chốt:** *public để làm gì khi phase-1 chưa có discovery?* Danh sách 7
nhóm **không** có marketplace discovery/search. Một kèo `public` mà không có surface tìm kiếm thì chỉ
tới được người khác qua **share link `/s/<id>`** (DD-73) — mà DD-73 lại còn bị chặn bởi **DD-41
projection migration** (whitelist BL-DSC-1 chưa có trong `public_sessions`). Ba khả năng, chưa chọn:
(a) public = chỉ để share link ⇒ phải kéo DD-73 + DD-41 vào phase-1; (b) public = chuẩn bị sẵn cho
discovery phase sau, phase-1 chỉ có toggle + fence; (c) bỏ toggle khỏi phase-1, mọi kèo private. Slice
nào chạm nhánh này phải **AWAIT** tới khi owner chọn.

### D4 — Nhóm 5, vế "đăng ký trên Zalo bot ⇒ auto signup player vào session tương ứng": đường này **đã có chủ**

Đây không phải luồng mới. Nó là **DD-32 Option D** (phễu channel-first, owner-final 28/07) cộng DD-05
join policy, DD-41 gating, DD-45 waitlist và shared DD-52 restriction. Ràng buộc đã chốt, nhắc lại vì
mô tả "auto signup" rất dễ bị hiện thực hoá thành một luồng join thứ hai:

- browse **không** cần link account; free/full/approval giữ nguyên no-pay timing.
- **paid + linked** ⇒ active + charge / pay-later.
- **paid + unlinked** ⇒ **giữ chỗ 15 phút**, chỉ active **sau verified full payment**.
- Account link phải là exact `ChannelIdentity ↔ current Person ↔ verified Plexco Account`.
- **Provider outage fail closed.**

**Cấm dựng luồng join song song với `addMemberToSession` / `evaluateSessionEligibility`.** Bot là port
mỏng; rule sống server-side (HR3, no multi-master).

### D5 — Nhóm 7, vế privacy: gate **A3 legal** chuyển từ "lead-time item" thành **blocker của phase-1**

`../probes/pre-code-open-items-2026-07-16.md` A3 (**PII data-class matrix** — scope đã hẹp lại: không thu
SĐT theo DD-50, PII optional theo platform config DD-54; còn **email, tên, bank memo** là bắt buộc vận
hành) được đánh dấu **chặn go-live khi thu PII**, và cần luật sư VN ⇒ **lead-time dài**. Phase-1 có
settings/privacy và có đường tiền (bank memo) ⇒ A3 không còn là việc "chạy song song cho kịp" mà là
**điều kiện go-live của chính phase-1**. Khởi động ngay là quyết định rẻ nhất còn lại trong DD này.

### D6 — Thứ tự ship (ba làn; **không phải cam kết ngày**)

| Làn | Nội dung | Điều kiện mở |
|---|---|---|
| **A — Launch (DD-113)** | 1 signin/signup → 4 link account ⇄ Zalo → 6a session management + detail → 7a settings tối thiểu | Gỡ FE PENDING; tenant provision **thủ công**; pre-beta gate ở `../strategy/gtm-strategy.md` |
| **B — Mở cửa cho host ngoài** | 2 create club → 3 link club ⇄ bot → 5a sync một chiều (bot → Plexco: đăng ký trên bot vào đúng session) | Làn A chạy thật; DD-32 Option D là contract, không tái phát minh |
| **C — Nặng nhất, mỗi mục một gate riêng** | 5b toggle public/private **sau fence (8a)** · 6b nhắc nợ + confirm + mark-paid · 6c auto-reconcile + billing/entitlement `host_pro` · 7b privacy **sau A3** | Từng gate ở D2/D3/D5; không mục nào trong làn C được ship bằng cách nới gate |

Làn B và làn C **không** chạy song song bừa: mọi slice dùng chung migration tail / state / generated
artifact phải tuần tự (luật §3 `CLAUDE.md`).

### D7 — Vẫn NGOÀI phase-1

In-app Chat (DD-38/DD-91) · feed/kudos (DD-76/DD-77) · **marketplace discovery/search** · fill-slot ·
tournament + club tools nâng cao · Session Organize (DD-61..64) · Club Assistant (P7, DD-16..23) ·
**app native** (DD-113) · **web push** (DD-67/DD-72 chain, điều kiện iOS install) · Messenger nếu chưa
qua App Review.

### D8 — Nghĩa vụ mirror

`../product/ROADMAP.md` (§Canonical Delivery Groups + §GTM theo phase + Phụ lục A) →
`../00-start-here/HANDOFF.md` (khối LIVE TRUTH) → `../strategy/gtm-strategy.md` (§Product roadmap by
phase) → `../product/BRD.md` §5.1 (phân lớp *MVP scope* vs *phase-1*) + §14 → `../product/PRD.md` header.
**Trạng thái 22/08: đã propagate đủ chuỗi** — ROADMAP **v3.7** · HANDOFF **v1.37** · gtm-strategy
(§Product roadmap by phase) · BRD **v3.9p** · PRD **v2.8o**. Mirror **không** phải bằng chứng runtime.

### Không authorize

Code, migration, packet, worktree, slice, enablement, gỡ FE PENDING, nới bất kỳ gate nào ở D2/D3/D5,
đổi canonical P-number. DD-114 đóng đúng tầng **phạm vi + thứ tự**.

---

## DD-113 — GTM re-sequencing: launch = webapp PWA + Zalo bot song song, app native lùi về phase sau · ✅ Chốt (owner 2026-08-22)

> **Status boundary:** DD-113 chốt **thứ tự surface ra mắt** và **launch scope của PWA v1**. Nó KHÔNG
> authorize code/migration/slice/worktree/enablement, KHÔNG đảo DD-69 (direction native accepted 18/07,
> giữ nguyên), KHÔNG đổi canonical P-number của ROADMAP, và **KHÔNG gỡ lệnh FE PENDING 13/08** — xem D5.

### D1 — Launch = hai surface song song; web không còn vai "fallback"

Trước 22/08, doc chiến lược khai **bot-first + web/Messenger fallback** (`../strategy/gtm-strategy.md`
bản 28/07: *Beta gates* #1, *Market reality* §1, *Week 0*). Từ nay: **webapp PWA và Zalo bot ra mắt
cùng lúc**; phạm vi mỗi surface do **thiết kế** quyết định, không do giới hạn của Zalo quyết định.

Ranh giới một dòng: thao tác **kết thúc gọn trong một tin nhắn** → bot; thứ cần **nhìn nhiều hơn một
dòng, hoặc sửa được về sau** → PWA.

**Căn cứ là số đo, không phải sở thích.** Nhãn "fallback" khiến web không được build: đo tại `a151b15`
là **0 màn FE · 1 `page.tsx` · 0 API route nghiệp vụ**, trong khi DD-69 đã đặt **PWA là phase-1 target
từ 18/07**. Một surface mang nhãn dự phòng suốt hơn một tháng thì trên thực tế nó không tồn tại — đây
là lỗi *tổ chức* do cách gọi tên, không phải lỗi ưu tiên.

**Hệ quả thứ hai, nặng hơn:** Zalo OA là rủi ro nhà cung cấp (quota · rate limit · quyền gửi tin ·
policy; DD-14/DD-15 tới nay vẫn là 🔗 *external evidence*, chưa có bằng chứng attributable). Khi web là
fallback thì **mất Zalo = mất sản phẩm**; khi web là surface độc lập thì **mất Zalo = mất kênh
acquisition 0-install** — đắt, nhưng không chết. Đổi vai chính là đổi lớp rủi ro này.

### D2 — Launch scope PWA v1 = đúng năm khối

| # | Khối | Nội dung tối thiểu |
|---|---|---|
| 1 | **Signin / signup** | Đăng nhập tài khoản Plexco; root của mọi thứ còn lại |
| 2 | **Link Zalo bot** | Nối account ⇄ ChannelIdentity Zalo, đúng một Person |
| 3 | **Session management** | Danh sách kèo của host: tạo/sửa/publish/announce/đóng, xem ai đã nhận slot |
| 4 | **Session detail** | Một kèo: roster, slot còn trống, trạng thái, thao tác của host |
| 5 | **Settings** | Hồ sơ tối thiểu, kênh đã liên kết, tuỳ chọn nhắc, ngôn ngữ |

**Khối 2 là khớp nối, không phải tính năng phụ.** Thiếu nó, hai surface là hai sản phẩm rời và toàn bộ
lập luận D1 sụp. Nó đi qua đúng authority identity đang có (`persons`/`accounts`/`channel_identities`/
`memberships`, endpoint-scoped theo DD-67) — **không** tạo khái niệm identity song song.

**Điều kiện để được gọi là PWA** chứ không phải "web page": manifest + service worker + installable +
mobile-first 375px. Chưa có installable shell thì **cấm dùng chữ PWA** trong mọi doc — `apps/web` hiện
**chưa có `manifest.json`/service worker** (đã ghi trong `../decisions/analysis/dd-69-app-native-analysis.md`
§1 và DD-67/DD-72 context), nên đây là nghĩa vụ phải land, không phải trạng thái đang có.

### D3 — Negative scope của launch

Không có trong launch: marketplace discovery public · in-app chat (DD-38/DD-91) · feed/kudos
(DD-76/DD-77) · đối soát chuyển khoản tự động (mark-paid thủ công là baseline toàn cầu — DD-40) ·
rating công khai · tournament/club tools · **web push** (DD-67/DD-72 chain 36→41) · **fill-slot** ·
**app native**.

Fill-slot giữ đúng chỗ cũ trong beta plan (Weeks 5-6), sau khi có attendance data. Web push nằm ngoài
vì trên iOS nó **chỉ chạy khi PWA đã cài** — xem D4.

### D4 — Gate mở bàn app native (đo được, thay cho "TBD")

DD-69 để native ở phase-2 với gate mở; ROADMAP đã ghi traction signal *"PWA (S9/S20) live + retention
đo được trên PWA trước khi bàn native"*. DD-113 giữ nguyên tinh thần đó và viết thành ngưỡng
(**working hypotheses**, không phải cam kết ngày):

| Điều kiện | Ngưỡng |
|---|---|
| PWA v1 live, có host dùng thật | ≥ 5 host vận hành ≥ 4 tuần liên tục trên PWA |
| Bằng chứng quay lại | Host weekly return rate ≥ 60% trong 4 tuần |
| Installable thật sự được dùng | PWA install rate ≥ 30% host, **đo tách iOS/Android** |
| API/auth boundary ổn định | `/api/v1` + bearer/refresh + client-safe contracts đã land (`../strategy/native-app-strategy.md` §3–4) |
| Có lý do native cụ thể | Nêu được ≥ 1 capability push/offline mà PWA **đo được là không làm nổi** |

Hàng thứ ba không phải chi tiết vụn: iOS chỉ cho web push khi PWA đã được add-to-home-screen
(`../features/BE/feature_notifications_reminders_tech.md`, hàng 22 🟡 và gate #4). Nghĩa là mọi lập
luận "PWA đủ rồi, có push mà" **treo trên một tỉ lệ install chưa ai đo**. Đó cũng là lý do web push
nằm ngoài launch (D3): reminder ở launch đi qua bot Zalo, kênh không phụ thuộc install.

### D5 — DD này KHÔNG gỡ lệnh FE PENDING; và bản thân lệnh đó cũng chưa có DD

Launch scope D2 **không thể bắt đầu** khi lệnh owner 13/08 (FE PENDING: không track `.pen`, không mở
page/component, lane FE không chạy) còn hiệu lực. DD-113 **không** gỡ nó: đổi ưu tiên GTM và cấp quyền
thực thi FE là hai quyết định khác nhau, và trộn hai thứ vào một DD chính là cách một DD trở thành
authority cho việc nó chưa từng xét.

⚠️ **Đo được và nên sửa:** lệnh FE PENDING **chưa từng vào `decisions.md`**. Nguồn duy nhất là
`../autopilot-templates/next-lanes-2026-08-13-RUN.md`, rồi mirror sang ROADMAP (`:38`, `:337`, `:378`)
và HANDOFF. Theo đúng luật DD-111 D4 — *quyết định owner phải vào `decisions.md` trước khi lane mang
qua gate; bản ghi bền thắng lời khai hội thoại* — thì trạng thái chặn FE hiện đang sống ngoài decision
log. Việc gỡ (hoặc giữ) PENDING phải là một quyết định **ghi ra**, và nên ghi luôn cả lệnh gốc.

### D6 — Nghĩa vụ mirror

Thứ tự propagate, mỗi bước là một nghĩa vụ riêng, không suy từ nhau: `../strategy/gtm-strategy.md`
(**đã rewrite 22/08**) → DD này → `../product/ROADMAP.md` (§Positioning · §Canonical Delivery Groups
hàng *App Native* · §GTM theo phase · Phụ lục A) → `../00-start-here/HANDOFF.md` (khối LIVE TRUTH mới
nhất) → `../strategy/native-app-strategy.md` §1 → `../product/BRD.md`/`PRD.md`.
**Trạng thái 22/08: đã propagate đủ chuỗi** — ROADMAP **v3.7** · HANDOFF **v1.37** · native-app-strategy
**2.1** · BRD **v3.9p** (§14: câu *"ngưỡng chốt khi có baseline"* của product-evidence gate nay được thay
bằng chính bảng ngưỡng ở D4) · PRD **v2.8o** (header). Mirror **không** phải bằng chứng runtime.

### Không authorize

Code, migration, packet, worktree, slice, enablement, gỡ FE PENDING, đổi canonical P-number. DD-113
đóng đúng tầng quyết định cho **thứ tự surface** + **launch scope PWA v1** + **gate native**. Ba
session command trong `packages/db/src/session-service.ts` vẫn là thư viện không caller; launch scope
là **đích**, không phải mô tả trạng thái hiện có.

---

## DD-112 — ⬜ **CHƯA CHỐT** — đổi **sức chứa** khi đã có charges thì làm gì với tiền? (mở 2026-08-17)

> ⬜ **Đây là câu hỏi mở, KHÔNG phải quyết định.** Không slice nào được viện nó làm thẩm quyền. Ghi ra
> để nó có chỗ đứng và có người sở hữu, thay vì tiếp tục sống như một coupling không ai đứng sau.

**Phát hiện thế nào.** Lane `docs-impact-policy-contract--narrowed` cạn trần fix-round sau 6 vòng
codex. Năm vùng khác hội tụ dần (5→3→4→2→1→3) và hợp đồng đã sạch một lần; **chỉ mỗi capacity thrash**,
bị flag ở vòng 1/3/4/6 với **hướng dẫn ngược nhau** giữa các vòng ("thêm capacity vào DD-49 probe" ↔
"DD-49 không cover capacity, bỏ ra"). Reviewer dao động vì **văn bản không quyết được**, không phải vì
tác giả viết dở.

**Sự thật đo được.** `feature_session_management_tech.md:214` (edge #4) ghép *"Price/**capacity**
change with existing charges"* rồi *"require explicit `impact_policy`"*. Nhưng **DD-49** — quyết định
duy nhất chi phối `impact_policy` — chỉ có ba mục: **đổi giá**, **leave/cancel/refund**, **rejoin**.
**Không có capacity.** Nên "capacity cần `impact_policy`" hiện **không có owner decision nào đứng sau**.

**Một cách đọc thứ ba, chưa ai kiểm, và nên kiểm trước khi mở quyết định lớn.** Điều kiện của hàng là
*"Price/capacity change with existing charges **or retry root**"*; phần hành động có **hai vế ngăn bởi
`;`**: `require explicit impact_policy` — và — *"a capacity outcome that is full **resolves roots** in
the same tx"*. Rất có thể vế `impact_policy` chỉ thuộc **price**, còn capacity thuộc vế **retry root**
(waitlist promotion), tức chuyện job chứ không phải chuyện tiền. Nếu đúng vậy thì đây **không phải
coupling sai mà là một hàng ghép hai luật**, và cách sửa là tách hàng, không phải mở policy mới.

**Câu hỏi thật sự cần trả lời, theo thứ tự:**
1. Vế `impact_policy` ở edge #4 có áp cho capacity không, hay chỉ áp cho price? (đọc hàng + lịch sử
   commit của nó; rẻ, làm trước)
2. Nếu có: **giảm** sức chứa khi đã có charges mà **không** xuống dưới roster (`CAPACITY_BELOW_ROSTER`
   ở `:714` đã chặn ca dưới roster) thì ảnh hưởng gì tới tiền? Nếu **không** ảnh hưởng thì yêu cầu
   `impact_policy` là thừa và phải gỡ. **Tăng** sức chứa gần như chắc chắn không đụng tiền.
3. Chỉ khi (2) cho ra một ảnh hưởng tiền thật mới cần một policy — và khi đó nó là **quyết định riêng**,
   không nhét vào DD-49, vì DD-49 chốt cơ chế cho *đổi giá* và ma trận của nó là
   `{price}×{charge-state}×{lifecycle}`.

**Ràng buộc tới khi chốt:** slice không được (a) viết capacity vào phạm vi DD-49, (b) tự pin một
capacity policy, (c) sửa edge #4 để tách capacity ra. Cả ba đều là sửa contract spec Reviewed trên
đường tiền. Slice **được** ghi rằng edge #4 có liệt kê capacity và slice **không giải** nó — đúng cách
đã xử `impact_policy` token.

**Không chặn gì hiện tại.** `update_open_session` vẫn có `CAPACITY_BELOW_ROSTER` cho ca nguy hiểm nhất.

---

## DD-111 — `AnnounceSession`: guard `ends_at` + `SESSION_ALREADY_ENDED`, và edge #11 thuộc về FE · ✅ Chốt (owner 2026-08-15)

> **Status boundary:** DD-111 chốt **hành vi** của `AnnounceSession` quanh thời gian, **mã lỗi** kèm
> theo, và **ai sở hữu edge #11**. Nó KHÔNG authorize command khác, không mở `close`/`cancel`.

### D1 — Gate `status='open'` **và** `ends_at > now()`

`AnnounceSession` từ chối khi session đã kết thúc, đánh giá **sau khi đã giữ row lock**, bằng đồng hồ
DATABASE chứ không phải `Date.now()` — cùng lớp lỗi clock-skew mà lane PublishSession đã tốn một vòng
review (P1, ghi trong DD-109).

> ⚠️ **Amendment 15/08 — câu trên ban đầu owner viết là `ends_at <= now()`. `now()` SAI, và
> `clock_timestamp()` đặt sai chỗ cũng sai.** Lane `session-command-announce--v2` đo trực tiếp trên
> Postgres thật (test `REG-CLOCK2`) và tìm ra hai bậc:
> 1. `now()` = `transaction_timestamp()`, **đóng băng lúc transaction bắt đầu**. Một lượt chờ lock kéo
>    dài vắt qua `ends_at` sẽ khiến check đọc thời điểm TRƯỚC khi chờ ⇒ announce lọt.
> 2. Đổi sang `clock_timestamp()` **trong cùng câu lệnh có `FOR UPDATE`** vẫn sai — biểu thức được
>    lượng giá ở node LockRows, nên nó **cũng** trả về thời điểm trước khi chờ. Đây là bẫy tinh vi hơn,
>    và là thứ chỉ phép đo mới thấy chứ suy từ tài liệu thì không.
>
> **Hình đúng, bắt buộc cho mọi guard thời gian sau này:** một **câu truy vấn riêng, chạy SAU khi lock
> đã giữ** — `select (ends_at <= clock_timestamp()) ...` — vì câu đó chỉ tới lượt thực thi khi
> `FOR UPDATE` phía trên đã trả về. Không cần `FOR UPDATE` lần hai; transaction đang giữ lock rồi.
> Implement tại `session-service.ts:906`, kèm regression `REG-CLOCK2` làm hàng rào — bỏ hình này ra là
> test đỏ, không phải review mới bắt được.

**Vì sao đây KHÔNG phải đảo ngược quyết định "không cutoff" trước đó.** Quyết định trước nói về
`starts_at`: không chặn announce khi trận **đang diễn ra** ("đang đá, xuống chơi đi"). `ends_at` là
**vị từ khác** — nó chỉ chặn buổi **đã kết thúc**, và nhờ `CHECK (ends_at > starts_at)`
(`0002_tenants_core.sql:98`) nó **không thể** chạm ca late-join. Hai luật cùng tồn tại, không mâu thuẫn.

**Tiền đề cũ bị bác bằng phép đo.** Lập luận ban đầu chấp nhận rằng announce một buổi vừa kết thúc là
"minor/transient" vì auto-close sẽ dọn. **Không có auto-close.** `feature_session_management_tech.md:533`
chỉ *viện dẫn* auto-close như một ngưỡng quy ước; cơ chế chưa build. Một hàng `open` quá `ends_at` nằm
đó **vĩnh viễn**, nên announce sẽ phát "vào chơi đi" cho một buổi đã xong, lặp lại không giới hạn.

**Vì sao announce chịu guard này còn các command đổi-state thì không.** Announce là **thông báo**. Một
thông báo cũ gây hại theo cách một mutation không gây: nó đi tới người thật, mang thông tin sai, và
không có trạng thái nào để sửa lại. Khi auto-close land, guard này thành lớp thứ hai chứ không thừa.

### D2 — Mã lỗi mới `SESSION_ALREADY_ENDED` (409), không tái dùng `SESSION_NOT_OPEN`

Buổi chơi **đang** `open`. Trả `SESSION_NOT_OPEN` là phát biểu sai về trạng thái, và i18n nằm trong 5
HARD RULE: bề mặt tiếng Việt sẽ báo host "chưa mở" về một buổi đã đá xong. Thêm vào §3 Error Codes
kèm cả hai khoá ngôn ngữ.

### D3 — Edge #11 thuộc FE; dòng BE là bản chép thiếu

`feature_session_management.md:94` (FE, product authority):
`| 11 | Security | Mutation on closed/cancelled/past session | Reject mọi mutation — trừ privileged correction với audit trail |`
`feature_session_management_tech.md:221` (BE) chỉ ghi *"after status=closed"* — **thiếu
`cancelled`/`past`**. Đây **không phải hai thẩm quyền mâu thuẫn**; là một dòng BE chép thiếu một luật
Security. **Sửa dòng BE cho khớp FE**, không thu hẹp FE.

Hệ quả cho announce, phải viết **cả hai vế** kẻo người sau xoá nhầm guard:
1. Announce **miễn** edge #11 vì nó **không mutate** session (không đổi status, không bump version).
2. Announce **vẫn** mang guard `ends_at` của riêng nó, vì lý do D1 — **không** vì edge #11.

Past-weight của cancel tiếp tục do **edge #31** sở hữu, không đẩy ngược lên edge #11.

### D4 — Quyết định trong chat không phải thẩm quyền

Guard này được owner chốt trong một phiên chat, rồi lane mang nó qua gate. Reviewer gắn [P1]
"unauthorized Tier-C change to a Reviewed spec". **False positive về nội dung, true positive về hình
thức**: guard *đã* được authorize, nhưng chỗ duy nhất ghi lại điều đó là chat + ledger gitignored +
chính cái spec đang bị chất vấn — **không có bản ghi bền nào để reviewer đọc**.

**Luật:** một quyết định owner mở đường cho thay đổi spec Reviewed **phải nằm trong `decisions.md`
trước khi** lane mang nó qua gate. Cùng nguyên tắc đã dùng để bắt slice này re-register: bản ghi bền
thắng lời khai trong hội thoại — áp cho owner y như áp cho lane.

⚠️ **Đính chính một khiển trách sai của owner.** Owner đã hai lần nói lane "chế ra" `AN1`/`CL1`/`CA1`.
Sai: chúng nằm trong `docs/autopilot/contracts/autopilot-session-commands-update-close-cancel.md`
dòng 224/227/232, do một phiên authoring trước viết. Owner grep **spec** rồi kết luận "không tồn tại"
— đúng lớp lỗi "kết quả rỗng là bằng chứng về truy vấn". Lỗi thật của lane hẹp hơn nhiều: gọi authored
contract là *"acceptance matrix you ratified"*, tức nâng sai **cấp thẩm quyền** (authored ≠ owner-ratified).
Các mục DI ghi theo khung cũ phải sửa lại theo mô tả này.

### D5 — Authored packet vào scope, không để "advisory"

`autopilot-session-commands-update-close-cancel.md` giờ stale hai chỗ: AN1 không có guard, và nó khai
event `session.announced` trong khi spec §4 (`:514`) khai `session.announcement_requested` — bản
implement theo spec. Một authored contract stale vừa sinh ra một [P1] và hai vòng review; để nguyên là
để lại đúng cái bẫy đó cho người sau. Slice kéo file này vào scope và reconcile trong commit của mình.

### Không authorize

Command khác, `close`/`cancel`, `ALLOWED_WHEN_SUSPENDED`, migration, enablement, merge.

---

## DD-110 — Bốn action class hẹp cho session command family, và hàng ma trận của chúng · ✅ Chốt (owner 2026-08-15)

> **Status boundary:** DD-110 chốt **tên literal** + **giá trị hàng Suspended Action Matrix** cho bốn
> command session còn lại. Nó **KHÔNG** authorize code/migration/enablement. Slice
> `session-commands-update-close-cancel` vẫn phải tự qua G1–G6 + closure matrix của
> `review-code-readiness-gate.md`. DD này đóng đúng blocker Tier C mà packet đó tự nêu ở
> `_blocker_note` (`docs/autopilot-manifests/session-commands-update-close-cancel.json:3`).

### Vì sao cần DD này

DD-105 chốt **hướng** — command player-visible/chạm roster/chạm tiền phải nhận *"narrow per-op action
class khi build"* — nhưng **không đặt tên** cho cái nào. DD-104 D2a chỉ đặt `delete_draft_session`, cho
một op khác và đang parked. Packet 14/08 đo tại `519fb9f` và kết luận đúng: `ActionClass` có chính xác
`{publish_new_sessions, admin_mutation, integration_changes}`, grep `decisions.md` cho mọi tên op còn
lại trả **rỗng**. Tác giả slice **không được tự đặt tên** — đây là giá trị trên gate tiền, Tier C.

### D1 — Bốn tên, theo dialect `verb_noun` của DD-104 D2a

| Command | Literal | Ghi chú |
|---|---|---|
| `UpdateSession` khi `open` | `update_open_session` | update lúc `draft` **giữ nguyên miễn trừ DD-105** (vô hình + không tiền) — tên mang luôn ranh giới đó |
| `CloseSession` | `close_session` | |
| `CancelSession` | `cancel_session` | |
| `AnnounceSession` | `announce_session` | |

**Enum từ nay có hai phương ngữ, cố ý.** `publish_new_sessions`/`admin_mutation`/`integration_changes`
là danh ngữ; `delete_draft_session` + bốn tên trên là `verb_noun`. **Không đổi tên ba cái cũ:**
`publish_new_sessions` đã có caller production (`publishSession`, `1ccbe5d`), một hàng ma trận và một
entry trong invariant catalog — đổi là sửa contract có consumer sống để lấy thẩm mỹ. `verb_noun` là
chuẩn cho mọi literal **mới**.

### D2 — Hàng ma trận: close/cancel ✅ khi suspended, announce/update ❌

| Action Class | active | past_due | suspended |
|---|:---:|:---:|:---:|
| Update open session | ✅ | ✅ | ❌ |
| Announce session | ✅ | ✅ | ❌ |
| Close session | ✅ | ✅ | **✅** |
| Cancel session | ✅ | ✅ | **✅** |

**Căn cứ nằm trong chính ma trận, không phải nguyên tắc nhập từ ngoài.** Hàng `Player CK ingest ✅` cho
thấy tenant bị suspend **vẫn nhận đối soát chuyển khoản của người chơi** — tức ma trận đã tự khai một
ranh giới: suspension chặn **hoạt động thương mại mới**, không **đóng băng nghĩa vụ đang chạy**.
`announce`/`update-on-open` tạo hoạt động mới trên listing sống ⇒ ❌, cùng lớp với publish.
`close`/`cancel` là đường **kết thúc** nghĩa vụ ⇒ ✅.

**Cái giá của lựa chọn ngược lại là bất đối xứng, nên chọn được.** Nếu để cả bốn ❌: host bị suspend
không đóng và không huỷ được buổi đã `open`, trong khi người chơi đã join và có thể đã chuyển khoản —
**thiệt hại chắc chắn, không có đường thoát**, và chỉ lộ ra lần suspend thật đầu tiên trên production.
Nếu để close/cancel ✅: một tenant abuse huỷ được buổi của chính nó — **phiền, không phải thiệt hại**,
và đằng nào tenant đó cũng không publish, không announce, không update được.

⚠️ **Giới hạn cấu trúc kế thừa, ghi ra để không ai tưởng DD này giải nó.** `authorizeTenantAction`
resolve **hai** trục suspend về **một** status rồi tra **một** hàng, trong khi §3 của spec billing
(`:288-291`) tách rõ `subscriptions.status` = nợ tiền và `tenants.status` = abuse/ToS. Tenant nợ tiền
đáng được dọn dẹp; tenant abuse thì có thể không. Bốn literal này **không phân biệt được**, y như ba
literal cũ. Muốn phân biệt phải đổi chữ ký gate — việc riêng, chưa mở, **không** kéo vào slice này.

### D3 — Tên vào decision log ngay, literal vào `ActionClass` cùng commit mang command của nó

Chốt tên **không** đồng nghĩa thêm cả bốn giá trị vào enum ngay. Một literal không caller là **code
dark** — đúng thứ project đang mất tám ngày để thoát ra với `authorizeTenantAction`. Packet cho phép
ship subset khi vượt budget (`AnnounceSession` *"fits ONLY if budget allows"*,
`stop_conditions:96` bắt re-slice), nên gom cả bốn lên trước sẽ tái tạo đúng vấn đề vừa tránh.

**Luật:** command nào ship trong slice thì literal + hàng ma trận của nó vào cùng commit đó; command bị
cắt thì tên **nằm lại DD này** và chờ. Đây đúng hình DD-104 đã làm — `delete_draft_session` có tên từ
13/08, tới nay vẫn chưa vào enum, và không sao cả.

> **Amendment 15/08 — hệ quả tổng quát, viết ra vì nó vừa tốn một lane.** D3 không chỉ cấm *lần này*:
> nó làm **mọi slice kiểu "đăng ký literal trước, nối caller sau" trên gate này trở nên không khả thi
> về cấu trúc**, vĩnh viễn. Đây là điều đáng nói vì "mint class trước cho gọn scope" là một phản xạ
> hợp lý — nó *trông* như cách thu nhỏ slice, trong khi thực chất nó tách một thay đổi thành hai nửa
> mà nửa đầu không kiểm chứng được bằng bất cứ test nào có nghĩa. Lane `session-action-class-literals`
> (branch `feat/session-action-class-literals` @ `9e2e75a`, HALT decision-superseded 15/08, **không
> merge**) đi đúng vào đây: bốn literal + bốn hàng ma trận, **zero caller theo đúng thiết kế**.
> Provenance: salvage report của chính lane đó nêu ra khái quát này.
>
> Salvage report cũng để lại một cảnh báo cụ thể cho slice kế: bốn test `recognises <literal>` của lane
> đó **không copy được**. Hai cái `announce_session`/`update_open_session` đúng kết quả nhưng sai thời
> điểm (D3); hai cái `close_session`/`cancel_session` **sai nội dung** — chúng assert deny-under-suspended,
> ngược hẳn D2. Chỉ một test dùng lại nguyên được: case near-miss string (`update_session`,
> `close_draft_session`, `delete_session`…) vẫn deny fail-closed — nó không nói gì về bốn literal thật
> nên hợp lệ bất kể chúng land lúc nào.

### D4 — Nghĩa vụ test kèm theo (đóng lỗ "tên là chú thích, không phải enforcement")

`authorizeTenantAction` **không biết** session đang ở status nào; caller chọn literal. Nên
`update_open_session` là **quy ước ở call site**, không có gì cưỡng chế — một caller truyền nhầm nó cho
một `draft` sẽ deny update-trên-draft của tenant suspended và **phá miễn trừ DD-105 âm thầm**, mà
`authorization.test.ts` không bắt được vì ở tầng đó hành vi là đúng.

Slice **bắt buộc** mang một test âm ở tầng service: *`updateSession` trên session `draft` KHÔNG gọi
`authorizeTenantAction`*. Không có test này thì D1 chưa được thực thi, chỉ mới được viết ra.
(`delete_draft_session` có y hệt lỗ này — lỗ kế thừa, không phải lỗ mới; khi slice DD-104 mở, nó nợ
cùng một test.)

### Không authorize

Code, migration, packet, worktree, enablement. DD-110 chỉ đóng tầng quyết định cho đúng bốn tên + bốn
hàng. Command session **khác** bốn cái này vẫn phải quay lại DD-105 + DD-104 D2a để lấy class hẹp.

---

## DD-107 — Autonomy mode `autonomous_to_ready`: batch owner ở READY thay vì ngắt giữa chừng · ✅ Chốt (owner 2026-08-14)

### Bối cảnh — chi phí đo được, không phải cảm giác

Lane `session-service-create-command-core` v1 (13/08) dừng hỏi owner **bốn lần chỉ vì budget**
(300→360→440→470 compact) rồi vẫn kết `HALT MAX_ROUNDS`. Budget chưa bao giờ là ràng buộc thật —
thiết kế validation mới là. Bốn lần ngắt đó sinh ra bốn con số, không sinh ra một hiểu biết nào.

Ngược lại, trong bốn blocker của packet, **ba** (B1 acceptance matrix · B2 module home · B3 producer
insert contract) được giải bằng cách **đọc repo**; chỉ B4 (suspension gate) là quyết định owner thật và
thành DD-105. Tỉ lệ 3:1 là chỗ mode này nhắm vào.

### Quyết định

Thêm `autonomy_mode: autonomous_to_ready`. **Không phải "bỏ owner" mà "gom owner"**: owner chuyển từ
*bị ngắt từng quyết định* sang *review một lượt tại READY*, đọc **Decision Ledger** mà agent ghi trong lúc
chạy. Agent quyết trong luồng và **phải biện minh bằng văn bản**.

**Thang thẩm quyền** (agent tự phân loại trước khi quyết; phân loại xuống thấp là vi phạm gate):

- **Tier A — derivable.** Repo/migration/spec/decision log/tiền lệ đã có câu trả lời. Quyết + log 1 dòng.
  **Dừng ở tầng này là defect** và phải ghi vào ledger như một defect.
- **Tier B — judgment, reversible, in-scope.** Chưa ghi ở đâu nhưng hệ quả nằm trong scope đã khai và sửa
  lại được bằng chính file của slice. Quyết + log đủ alternatives/lý do/reversibility/bằng chứng đã đọc.
- **Tier C — reserved, vẫn AWAIT.** Đúng 8 mục, không thêm không bớt: (1) money contract mới/đổi;
  (2) PII/identity hoặc chạm 5 HARD RULES; (3) sửa **nội dung contract** của spec đã Reviewed (sửa link
  hỏng/số mục là Tier A; thêm entity/cột/endpoint là Tier C); (4) migration đổi semantics hoặc dùng chung
  tail với lane khác đang bay; (5) enablement (bật flag/env ra production); (6) merge/deploy/side effect
  ngoài worktree; (7) phải vượt negative scope; (8) finding review bị agent phản bác.

**Tiêu chí quyết định** — *lợi ích dài hạn tối đa cho project*, cụ thể hoá thành một phép thử và năm
tie-break: **phép thử 10×** ("lựa chọn này còn đúng không nếu 6 tháng nữa surface gấp 10 lần?"); tie-break
theo thứ tự **fail-closed > một nguồn sự thật > ít khái niệm hơn > theo tiền lệ sẵn có > reversible**.
Hoà cả năm thì chọn cái để lại **nhiều bằng chứng hơn cho người đọc sau**.

**Budget thành tín hiệu.** Overrun không bao giờ dừng lane để hỏi một con số. Agent hoặc re-slice trong
scope, hoặc chạy tiếp kèm entry ghi **nguyên nhân thiết kế**. Overrun lần hai cùng nguyên nhân = tín hiệu
thiết kế ⇒ re-slice, ngừng vá. Overrun chỉ giải được bằng cách chạm negative scope ⇒ Tier C.

**HALT successor pre-authorized** khi *cả hai*: finding được chấp nhận (không phản bác) **và** agent gọi
tên được **nguyên nhân thiết kế** chứ không phải danh sách triệu chứng. "Thử lại kỹ hơn" không phải nguyên
nhân thiết kế.

**Reviewer không gọi được** vẫn `HALT TOOL_UNAVAILABLE` — đây là phụ thuộc ngoài, không phải quyết định;
nhưng retry có backoff trước, saturation toàn tài khoản là WAIT chứ không phải lý do hạ gate.

### Context — toàn bộ doc corpus thuộc phạm vi, nhưng KHÔNG nạp được

Ý định đúng và không thương lượng: **không được quyết khi chưa biết một doc đang chi phối quyết định đó.**
DD-106 chính là giá của việc không biết — spec pass viết money contract vào 2 spec Reviewed trong khi
`decisions.md` đã có DD-26 nói *"không thêm model 'buddy'"*. Doc có sẵn. Không ai đọc.

Nhưng "nạp hết docs" là việc máy không làm được. Đo tại `1fdba1d`:

| Tập | Kích thước | Ước |
|---|---|---|
| Toàn bộ `docs/` | 303 file · 8,5 MB · 1,13 triệu từ | **~2 triệu+ token** |
| Chỉ 6 doc authority lõi | 871 KB | **~220k+ token** |
| Riêng bảng tổng hợp `decisions.md` | 60 KB · 126 dòng | ~18k token |

Toàn corpus vượt cửa sổ context một bậc độ lớn; ngay cả 6 doc lõi cũng đã tràn. Bằng chứng sống ngay trong
repo: session build `session-service` chạm **98% context** khi mới chỉ nạp context pack của chính slice.

Nên luật là **bảo đảm ĐỘ PHỦ, không phải bảo đảm ĐÃ NẠP** — ba nghĩa vụ, đều thực thi được:

1. **Luôn nạp (nhỏ, bắt buộc):** khối live-truth `HANDOFF.md` · **bảng tổng hợp** `decisions.md` (các dòng
   `| DD-nn |`, không phải toàn thân) · `review-code-readiness-gate.md` · packet + manifest của chính slice.
2. **Phần còn lại thì TÌM, và ghi lại việc tìm.** Trước mọi quyết định Tier A/B: search toàn corpus theo
   khái niệm mà quyết định chạm tới — tên entity/cột/endpoint/danh từ feature — trên cả `docs/` lẫn
   `packages/`|`apps/`, rồi đọc hit nào đáng đọc. Bản đồ: `docs-inventory.md` + `features/README.md`.
3. **Kết quả rỗng cũng là bằng chứng, và phải ghi như bằng chứng.** *"Search `decisions.md` cho `buddy` →
   ra DD-26: không thêm model buddy"* chính là câu đáng lẽ ngăn được DD-106. "Không tìm thấy gì" là entry
   hợp lệ **chỉ khi** query được ghi ra để người sau phán được nó có đúng query không. Search không ghi lại
   = chưa từng search.

> ⚠️ **Grep rỗng là bằng chứng về QUERY, không phải bằng chứng về REPO.** Đã sập hai lần ở đây: một `awk`
> viết cho backtick trong khi catalog dùng em-dash → rỗng hai lần, bị đọc thành "không có dữ liệu"; và luật
> ngôn ngữ grep ra zero cho một luật **có tồn tại** nhưng chưa ai viết ra. Trước khi tin null, kiểm query
> bằng một control case chắc chắn có.

### Thứ tự authority — giải mâu thuẫn không cần hỏi

Docs trong repo **có** mâu thuẫn nhau; rà soát 13/08 tìm thấy mâu thuẫn đồng thời ở spec, playbook,
template và index. Lane tự chạy vì thế cần một thứ tự viết ra. Trên thắng dưới:

1. **Runtime truth** — `pg_catalog`, migration đã áp, output canonical runner, code sống. *(Phép đo, không
   phải khai báo: `schema.ts` khai, `pg_constraint` chứng minh.)*
2. **`packages/db/migrations/*.sql` + `schema.ts`** — `CLAUDE.md` đánh dấu AUTHORITATIVE.
3. **`decisions.md`** — spec lệch DD thì **DD thắng**, và spec phải sửa.
4. **Spec Reviewed** (cặp FE+BE) — chỉ phần Reviewed. Mục gắn 🟡 nằm trong spec Reviewed **không phải**
   contract.
5. **Spec Draft / plan / proposal** — định hướng, không phải contract, không bao giờ là căn cứ để implement.
6. **`ROADMAP.md`** (delivery order + dev progress) · **BRD** scope · **PRD** behavior · **TDD** implementation
   contract — mỗi cái sở hữu đúng câu hỏi của nó.
7. **Doc index/summary** — `features/README.md`, `docs-inventory.md`, `BUILD-STATUS.md`, bảng tra nhanh.
   Mục trước nhất: rà soát 13/08 thấy 46/51 ô version sai trong một index.

Bốn tie-break, mỗi cái đã từng tốn một phiên:

- **Packet trên branch của lane thắng bản trên `main`** — slice hợp lệ khi tự amend contract của nó trong
  commit của nó; đọc bản `main` rồi kết luận "vi phạm scope" là sai.
- **Trong cùng một file, khối live-truth mới thắng khối cũ** — và **chỉ thị** của khối cũ cũng mục, không
  chỉ con số. Quét cả chỉ thị bị mục.
- **Hai doc cùng khai canonical → cái nào dẫn được decision ID thì thắng**; không cái nào dẫn được ⇒ coi là
  mâu thuẫn Tier C và AWAIT, đừng tự chọn.
- **`Doc status ≠ Implementation status`** — `Reviewed` không bao giờ hàm ý runtime.

### Vì sao Tier C không được rút gọn thêm

`DD-106` (13/08) tồn tại vì một spec pass đã viết **money contract** — `buddy_payment_requests`,
`payment_allocations.source='buddy'` — vào **hai spec đã Reviewed** mà không qua decision. Không ai liều
lĩnh; chỉ là hợp đồng lúc đó **không có cách rẻ để nói "cái này cần owner"**. Mục 1–3 của Tier C chính là
bài học đó, đã định giá. Rút gọn Tier C = mua lại DD-106 với giá cao hơn.

Nói thẳng: yêu cầu "mọi decision đều mang lại lợi ích tối đa và long term" **tự nó hàm ý** giữ Tier C —
một agent tự chốt hợp đồng tiền để đi nhanh hơn là đang tối ưu ngắn hạn, đúng thứ tiêu chí này cấm.

### Hệ quả

- `AWAIT` trong mode này **bị giới hạn vào Tier C**. AWAIT cho Tier A/B là vi phạm contract: giải quyết rồi
  ghi nhận nhầm-phân-loại vào ledger.
- `READY` trong mode này **phải kèm Decision Ledger** (`.autopilot/state/<feature>/DECISIONS.md`, ghi dần
  chứ không dựng lại lúc cuối). Ledger rỗng ở một lane không tầm thường là **cờ đỏ**, không phải run sạch.
- Tier B nào owner bác → thành slice tiếp theo, **không** mở lại lane đã READY.
- **Không đổi:** worktree isolation, scope-gate register + hash-lock, hai vòng review sạch, loop breaker,
  và **human merge**. Mode này bỏ *ngắt giữa chừng*, không bỏ *gate*, và **không hàm ý auto-merge**.
- Điều kiện vào mode: risk `P1`/`P2` · packet strict `CODE_READY` · scope + negative scope liệt kê tới mức
  file · verification command gate chạy được · reviewer gọi được. `P0` không bao giờ đủ điều kiện.

---

## DD-109 — Nới trần fix-round cho `session-draft-lifecycle-commands--v3`: trần 5 có giả định ngầm về kích thước diff · ✅ Chốt (owner 2026-08-14)

> **Ngoại lệ MỘT lane, có ghi chép — không đổi luật chung.** Tiền lệ khuôn: DD-101.
> Trần 5 vòng ở `level3-workflow.md` §8 **giữ nguyên** cho mọi lane khác.

### Bối cảnh — hai HALT liên tiếp trên cùng một command

`PublishSession` đã HALT `MAX_ROUNDS` **hai lần**: v1 (họ edge-case validation không hội tụ) và v2
(chuỗi DB-clock, rồi lan sang test fidelity). Cộng lại **11+ vòng** cho một command.

Câu hỏi phải trả lời trước khi cho chạy lần ba: đây là **thrash** (trần đang làm đúng việc) hay là
**thứ khác** (trần đang cắt nhầm)?

**Bằng chứng nói: không phải thrash.** `regions.log` của v2 ghi 5 vòng chạm **5 vùng khác nhau**,
không vùng nào lặp: `stale-counts-and-citations` → `updated-at-clock-query` +
`test-fixture-durability` → `clock-native-test-assertions` → `starts-at-precision-fix` +
`deterministic-clock-poll`. Breaker `REGION_THRASH` (cùng vùng 3 vòng liên tiếp) **không hề bắn**.
Mỗi vòng đóng một lỗ thật, khác lỗ trước.

### Nguyên nhân thật — đo được, và trước nay chưa ai viết ra

**Reviewer đọc `git diff <base>...HEAD` mỗi vòng — tức TOÀN BỘ diff, không phải phần vừa sửa.**
Diff của v2 là **1.690 dòng**. Và per-run miss-rate của reviewer **đã đo được ≈ 2/3**, hướng lỗi
false-CLEAN (`../decisions/analysis/codex-reviewer-determinism-2026-08-13/`).

Ghép hai dữ kiện đó lại: mỗi vòng là **một lần lấy mẫu** trên cùng 1.690 dòng, và mỗi lần lấy được
một tập con khác. Finding "mới" ở vòng sau **không chứng minh** slice sai — nó là chữ ký của
under-sampling, đúng như `codex-review-verdict-nondeterminism` đã ghi:
*"một lane surface finding mới-khác-nhau vòng này qua vòng khác **DÙ scope đúng** — đây là
UNDER-SAMPLING, không phải slice-too-big."*

**Hệ quả then chốt, và là chỗ một phán đoán trước đó của tôi sai:** thu hẹp **việc** của successor
KHÔNG thu hẹp **bề mặt review** của nó. Đề xuất "v3 chỉ sửa 2-3 finding" nghe hợp lý nhưng vô hiệu —
reviewer vẫn đọc đủ 1.690 dòng mỗi vòng.

### Quyết định

**`fix_rounds_max` = 8 cho riêng `session-draft-lifecycle-commands--v3`.** Không đổi cho lane khác.

Vì sao 8 chứ không phải "bỏ trần": với miss-rate 2/3, xác suất một finding cụ thể còn bị bỏ sót sau
M vòng là `(2/3)^M` — M5 ≈ 13%, **M8 ≈ 3,9%**. Tám vòng mua được một bậc độ lớn so với năm, còn thêm
nữa thì lợi ích giảm nhanh trong khi rủi ro "vá vô hạn" tăng. Con số này là **ước lượng có căn cứ,
không phải phép đo** — n=3 của lần đo cũ chỉ pin được hướng, không pin được độ lớn.

**Trần 5 KHÔNG sai — nó có một giả định ngầm chưa ai viết ra:** nó được đặt để bắt design thrash, và
ngầm giả định diff đủ nhỏ để một vòng review phủ gần hết. Ở 1.690 dòng dưới reviewer stochastic, giả
định đó vỡ. Ghi ra đây để lần sau không ai phải suy lại từ đầu.

### Điều kiện cứng — làm nó sinh thông tin dù thắng hay thua

1. **v3 PHẢI tới được vòng security.** Sau 11+ vòng, thứ slice này thật sự cần — security review trên
   một thay đổi gọi `authorizeTenantAction` (§8 bắt buộc cho trust boundary) — **chưa từng chạy một
   lần nào**; mọi attempt đều HALT ở code-review round 1 trước đó. Nếu v3 đốt hết 8 vòng mà vẫn chưa
   chạm security round, thì số vòng không phải vấn đề duy nhất.
2. **Nếu v3 vẫn HALT: đó là bằng chứng quyết định cho giả thuyết slice-too-big.** Khi đó **re-slice
   thật**, cấm thử lần bốn với trần cao hơn. Nới trần lần này là để *phân biệt hai giả thuyết*, không
   phải để mua thêm lượt.
3. **`REGION_THRASH` giữ nguyên hiệu lực.** Cùng vùng 3 vòng liên tiếp vẫn HALT ngay, bất kể còn bao
   nhiêu vòng trong ngân sách. Nới trần đếm-vòng không nới trần chống-thrash.
4. Ghi `fix-round-count` và `regions.log` như thường; DD này phải được dẫn trong contract của v3.

### Việc DD này KHÔNG làm

Không đổi §8 cho lane khác · không hợp thức hoá "chạy thêm vòng khi bí" · không thay cho **E2
re-measurement per-run detection**, vẫn là thứ duy nhất trả lời dứt điểm câu under-sampling vs
slice-too-big. Lane này là một ca thực nghiệm sống của chính câu hỏi đó; kết quả của nó nên được ghi
vào task `codex-review-verdict-nondeterminism`.

---

## DD-108 — Trust-gate file: mirror canonical + version phải đo được, không phải gõ tay · ✅ Chốt (owner-delegated 2026-08-14)

### Bối cảnh — footgun lần thứ hai, cùng một chỗ

E1 (`readiness-evidence-strict-keys`, land `a3c62ad`) siết readiness gate thành fail-closed. Reviewer của
chính nó cảnh báo: **canonical kit vẫn mang bản cũ non-fail-closed**, nên một lần `autopilot-update.sh`
sẽ ghi đè và **revert âm thầm** — không test nào đỏ, vì test bị ghi đè cùng lúc.

Đây là **lần thứ hai**. Lần một là `reviewer-isolation-backport-canonical-kit` (P1, invariant
`review-integrity`), đóng bằng backport byte-identical sang `f990469`. Đóng xong, footgun quay lại sau 1 ngày
ở file kế bên.

**Đo 2026-08-14: cả hai kit cùng `KIT_VERSION: 31`.** Tức hai file **khác nội dung** đang mang **cùng số
hiệu**. Không phải "bản cũ hơn bị thay" — mà là không có tín hiệu nào để bất kỳ ai nhận ra có gì đã thay.

### Quyết định

**(1) Mirror ngay, đủ ba vế — làm cả ba hoặc đừng làm vế nào.** Copy 2 file sang canonical · thêm dòng
`pack_pairs()` cho module mới (thiếu vế này thì file mới không được sync và gate ở consumer khác crash vì
import thiếu) · **bump `KIT_VERSION`** (thiếu vế này thì consumer khác không có cách biết cần re-sync).

**(2) Ràng buộc dài hạn — `KIT_VERSION` gõ tay là gốc rễ, không phải triệu chứng.** Một số hiệu do người gõ
sẽ không đổi khi nội dung đổi; đó đúng là *"khai báo không phải phép đo"*. Fix bền: **kit test suite assert
bản Plexco và bản canonical byte-identical cho mọi file trong `TRUSTED_GATE_FILES`**, hoặc dẫn xuất
`KIT_VERSION` từ content hash. Chọn cái nào cũng được; điều kiện là **divergence phải làm một test đỏ**,
không phụ thuộc ai đó nhớ.

**(3) Tới khi (2) xong: `autopilot-update.sh` bị chặn.** Không chạy sync khi chưa mirror. Đây là ràng buộc
vận hành có thời hạn, không phải luật vĩnh viễn — (2) land thì bỏ.

### Lý do (tiêu chí: lợi ích dài hạn tối đa)

Phép thử 10×: ở 10× số consumer của kit, một trust-gate file có thể phân kỳ im lặng ở cùng version number
là lỗi **nhân lên theo số consumer**, và mỗi consumer đều tin mình đang chạy gate đã siết. Tie-break
**fail-closed** và **một nguồn sự thật** đều trỏ cùng hướng: hai bản sao của cùng một file bảo vệ phải
**không thể** khác nhau mà không ai biết.

Vì sao không chỉ "nhớ mirror mỗi lần": lần một đã chứng minh trí nhớ không đủ — task backport lần trước đóng
sạch, rồi footgun tái xuất ngay ở file kế bên. Một quy trình dựa vào phải-nhớ đã hỏng một lần ở đây thì
không nên là câu trả lời cho lần thứ hai.

---

## DD-106 — Ba hợp đồng chưa chốt do spec pass 12/08 viết vào spec Reviewed · ✅ Đã phân xử từng câu (owner-delegated 2026-08-14)

> **Cập nhật 2026-08-14 (owner-delegated).** Ba câu nay có phán quyết riêng, đúng như DD-106 thiết kế
> (*"ba câu độc lập, chốt riêng được"*). Tiền lệ delegate: DD-97/98/99.
>
> | | Phán quyết | Nhãn 🟡 trong spec |
> |---|---|---|
> | **Q1 Pay-for-Buddy** | ⬜ **DEFER** — và **bác enum `'buddy'`** cho tới khi chứng minh được là cần | giữ nguyên |
> | **Q2 chat embed** | ⬜ **DEFER, ràng buộc vào fence** — không thêm projection thứ hai trước khi projection thứ nhất có đường invalidate | giữ nguyên |
> | **Q3 unified `SessionCard`** | ✅ **Chấp nhận hướng** — pin nơi ở canonical, chưa phải contract | gỡ nhãn, thay bằng ghi chú vị trí |

### Q1 — Pay-for-Buddy · ⬜ DEFER, và bác riêng phần enum

**Phát hiện quyết định:** `payment_allocations` **đã có** `created_by uuid` (`0003_payments_ledger.sql:87`,
chú thích *"actor for cash/waiver/manual"*), và CHECK hiện hành **đã cho phép**
`source IN ('cash','waiver') AND created_by IS NOT NULL` (`:92`). Nghĩa là *"A trả hộ charge của B"* **biểu
diễn được ngay hôm nay** bằng `source='cash'` + `created_by = A`. **Không cần enum value mới.**

Spec đang gộp hai thứ khác loại vào một đề xuất:
- **Đổi money model** (thêm `'buddy'` vào CHECK) — chưa chứng minh được là cần;
- **Workflow** (player request → host confirm, bảng `buddy_payment_requests`) — không phải money-model change.

**Quyết định:** bác vế một, hoãn vế hai. Nếu sau này vẫn muốn Pay-for-Buddy, mở DD riêng và phải trả lời
được: `'buddy'` mang thông tin gì mà `('cash'|'manual', created_by)` không mang? Không trả lời được thì
không thêm giá trị enum — mỗi giá trị trên đường tiền là một nhánh vĩnh viễn trong mọi truy vấn đối soát,
report và reversal về sau.

**Lý do (10× + tie-break):** ở 10× surface, một enum tiền thừa xuất hiện trong mọi báo cáo và mọi nhánh
reversal mãi mãi; tie-break **ít khái niệm hơn** yêu cầu nó phải tự chứng minh trước một khái niệm đã có.
Và về thứ tự: project hiện có **0 route nghiệp vụ, 0 màn FE**, chưa host nào dùng — Pay-for-Buddy là tinh
chỉnh một luồng thanh toán **chưa tồn tại**, trong khi mark-paid thủ công (DD-40) mới là thứ chặn doanh thu.
Xây nhánh trước khi có thân.

**Không chặn gì:** hoãn Q1 không chặn lane nào đang xếp hàng.

### Q2 — Structured embed `chat_messages.embed_*` · ⬜ DEFER, ràng buộc vào fence

**Quyết định:** không thêm ba cột trước khi **đường invalidate của public projection tồn tại**.

**Lý do:** `embed_snapshot` là **bản sao dữ liệu session nằm trong bảng chat** — một projection thứ hai của
state session. Repo đã có **nợ chưa trả đúng chỗ đó**: DD-73..78 ghi rõ kèo chuyển private/cancel hiện phải
chờ projector async mới hết lộ, và `public_projection_fences` (immediate-deny path) là nợ của DD-12 chưa
land. Thêm projection thứ hai khi projection thứ nhất còn chưa invalidate được là **nhân đôi một lỗi đã
biết**, không phải thêm một tính năng.

Phép thử 10×: ở 10× tin nhắn, mỗi embed đã gửi là một bản sao phải vô hiệu khi session đổi visibility. Không
có fence thì đó là rò rỉ tăng theo lưu lượng.

**Điều kiện gỡ hoãn (nhị phân):** `public_projection_fences` + guarded view + narrow raise/CAS-clear đã
merge. Lúc đó Q2 mở lại, và phải trả lời: snapshot đóng băng hay refresh, và embed đã gửi xử lý thế nào khi
session chuyển private/cancel.

### Q3 — Unified `SessionCard` · ✅ Chấp nhận hướng, chưa phải contract

**Quyết định:** chấp nhận có **một** shape dùng chung; pin nơi ở canonical là spec đã sở hữu hiển thị session
công khai (`FE/feature_marketplace_discovery.md` §3), spec khác **trỏ tới**, không định nghĩa lại. **Không
tạo file mới.** Chưa nâng thành contract cho tới khi có surface thật render nó.

**Lý do:** rủi ro thấp, đảo ngược rẻ, và cái nó ngăn thì đắt — tie-break **một nguồn sự thật**: một shape
hiển thị cross-surface không có chủ sẽ trôi mỗi surface một kiểu, đúng failure mode DRIFT repo đã ghi. Nhưng
tie-break **reversible** nói đừng đóng băng thành contract khi chưa surface nào render: contract viết trước
người dùng đầu tiên thường sai ở chỗ không đoán được.

**Ghi chú biên:** bot degrade được (không pill/badge) là **hợp lệ và phải ghi trong shape**, không phải
ngoại lệ chữa cháy sau.

---

## DD-106 (bản gốc 2026-08-13) — bối cảnh phát hiện

> **Status boundary:** DD-106 **không** quyết định gì. Nó ghi nhận rằng ba hợp đồng đã tồn tại trong spec
> **đã Reviewed** mà chưa qua decision, và đưa chúng về đúng chỗ để owner chốt. Không authorize
> code/migration/slice nào.

### Bối cảnh — cách phát hiện

Rà soát docs 2026-08-13 tại `main@1fdba1d`. `CLAUDE.md` quy định: *"Quyết định chưa chốt → ghi vào
`decisions.md` dạng proposal (🟡/⬜), KHÔNG viết vào spec đã Reviewed."* Spec pass 12/08 (`692f9f2`,
+2.022 dòng / 11 file) đã đi ngược điều này ở ba chỗ. Đây **không phải lỗi nội dung** — cả ba đều là ý
tưởng hợp lý; lỗi là **đường đi**: chúng vào thẳng contract mà không qua cửa quyết định, nên hiện không ai
phân biệt được phần nào của spec Reviewed là đã chốt và phần nào chưa.

Cơ chế sinh lỗi đáng ghi: cả ba đến từ một pass "tham chiếu Playo" gộp hai lượt vào một commit (6/10 file
nhảy **hai** version cùng lúc, changelog hai dòng cùng ngày) — bước author dày lên nhanh hơn bước quyết định
theo kịp.

### Q1 — Pay-for-Buddy (đường tiền) · 🟡

- **Spec đang khai:** `feature_payment_reconcile.md` v1.13 §5/§7 (Reviewed) + BE v1.15 §2/§3/§5e — bảng
  `buddy_payment_requests`, `payment_allocations.source='buddy'`, 5 endpoint, 6 error code, 3 use case
  PAY-UC-19/20/21, 8 edge case, 11 acceptance criterion.
- **Repo nói khác:** `packages/db/migrations/0003_payments_ledger.sql:85` —
  `CHECK (source IN ('auto','manual','cash','waiver','reversal'))`. Không có `'buddy'`, không có bảng đó,
  0 hit trong `schema.ts`.
- **Tiền lệ ngược chiều:** DD-26 chốt "delta wording … **không thêm model mới 'buddy'**" cho lớp identity
  money-adjacent. Q1 thêm model buddy ở lớp **payment** — khác lớp, nhưng vì thế càng cần một quyết định
  tường minh chứ không phải im lặng.
- **Vì sao không tự chốt được:** chạm **HARD RULE "claim-có-tiền cần khoá mạnh"**. A trả hộ B nghĩa là một
  người tạo nghĩa vụ tài chính gắn với charge của người khác. Cần trả lời tối thiểu: ai được request (cùng
  session? cùng tenant? đã verified?), host confirm là khoá đủ mạnh hay cần thêm, reversal/refund đi đường
  nào, và `source='buddy'` có phá invariant FIFO/allocation nào không.
- **Lựa chọn:** (a) owner chốt → viết DD đầy đủ, spec giữ nguyên; (b) revert §5/§7 về v1.12/v1.14, đưa nội
  dung sang proposal; (c) giữ trong spec nhưng gắn nhãn 🟡 tại chỗ (đang áp dụng tạm để không mất công tác
  đã làm — xem "Hệ quả").

### Q2 — Structured embed cho `chat_messages` · 🟡

- **Spec đang khai:** `feature_inapp_chat_tech.md:302-311` — `embed_type` CHECK `IN ('session')`,
  `embed_ref_id`, `embed_snapshot` JSONB + 2 CHECK, server snapshot theo whitelist BL-DSC-1.
- **Repo nói khác:** `0031_chat_schema_core.sql` **đã land** (11/08) và không có ba cột này.
- **Vì sao đáng một quyết định riêng:** đây là **expand một bảng vừa land**, không phải spec cho bảng chưa
  tồn tại — nên nó là migration `0033+` với đầy đủ gate, và `embed_snapshot` là **bản sao dữ liệu session
  nằm trong bảng chat**, tức một mặt lộ mới cho whitelist public/tiền/PII. Câu phải trả lời: snapshot
  refresh hay đóng băng, và khi session chuyển private/cancel thì embed đã gửi xử lý thế nào (cùng họ với
  nợ immediate-deny của DD-12/DD-73..78).

### Q3 — Unified `SessionCard` · 🟡

- **Spec đang khai:** `feature_channel_booking_funnel.md:150` + `feature_home.md:100` +
  marketplace/player_view — một shape thẻ dùng chung bot/web/home (time range, `N/M Going`, giá VND
  "/Người", skill range, urgency ≤3 slot).
- **Vì sao đáng ghi:** ít rủi ro nhất trong ba, nhưng nó là **contract hiển thị cross-surface** — đúng loại
  thứ mà nếu không có một nguồn thì mỗi surface trôi một kiểu (chính là failure mode DRIFT đã ghi ở chỗ
  khác trong repo). Cần chốt: field set canonical nằm ở đâu, surface nào được phép degrade (bot không có
  pill/badge), và quan hệ với whitelist BL-DSC-1.

### Hệ quả

- Ba mục nhận nhãn 🟡 **tại chỗ trong spec** để không ai đọc nhầm là đã chốt, thay vì revert — nội dung
  authoring giữ lại, chỉ đính chính trạng thái. Owner chốt cái nào thì gỡ nhãn cái đó.
- **Không slice nào được author/implement** từ ba mục này khi nhãn 🟡 còn.
- Không đổi trạng thái DD nào khác. Không đụng delivery order.
- Bài học quy trình đáng giữ: khi một spec pass thêm **entity/cột/endpoint** chứ không chỉ sửa câu chữ, nó
  đã vượt khỏi "editorial" và cần đi qua `decisions.md` trước — kể cả khi spec đích đang Reviewed và người
  viết chắc chắn về ý tưởng.

---

## DD-105 — Suspension gate cho `CreateSession`: miễn theo tính vô hình của draft · ✅ Chốt (owner 2026-08-13)

> **Status boundary:** DD-105 chốt **một policy suspension** ở decision level cho đúng command `CreateSession`.
> Nó KHÔNG authorize code (slice `session-service-create-command-core` vẫn đi qua gate của nó), KHÔNG đổi
> ma trận Suspended Action hiện có, và KHÔNG nới miễn trừ sang command khác.

- **Bối cảnh.** Slice `session-service-create-command-core` (outbox producer đầu tiên của Session BE vertical,
  service-only, 0 migration) cần một câu trả lời dứt khoát: một tenant billing-`suspended` có được tạo `draft`
  session không? Ma trận **Suspended Action** (`feature_billing_lifecycle_tech.md:269-273`) có hàng
  **`Admin mutation | active ✅ | past_due ✅ | suspended ❌`**, và `:30` scope gate cho *"Any mutating API"*.
  Nhưng cơ chế thực thi là **per-action-class literal** trong `authorizeTenantAction`: hôm nay chỉ có
  `publish_new_sessions` (session) — DD-104 D2a thêm `delete_draft_session`. **KHÔNG có literal cho create.**
  `authorizeTenantAction` fail-closed `DENY` với action class không nằm trong `RECOGNIZED_ACTION_CLASSES`
  (`packages/db/src/authorization.ts:91`), nên create không thể "cứ gọi" gate mà không thêm literal trước.
- **Hai lựa chọn owner được trình:**
  - **(a)** Thêm class hẹp (vd `create_session`) vào billing contract + `authorizeTenantAction` **TRƯỚC** (tiền lệ
    DD-104 D2a); create gọi gate → create fail-closed khi suspended. Giá: slice này **hard-depend** billing docs
    slice → `NOT_CODE_READY` cho tới khi nó land.
  - **(b)** Pin create-draft **ungated** kèm rationale. Giá: slice self-contained → `CODE_READY` ngay.
- **Quyết định: (b) — create-draft ungated.** `createSession` **KHÔNG** gọi `authorizeTenantAction`.
- **Lý do — miễn trừ theo TÍNH VÔ HÌNH CỦA DRAFT, có chứng minh fail-closed 0-tiền:**
  1. **Vô hình tới khi publish.** Draft KHÔNG bao giờ được chiếu sang `public_sessions` — projection bật tại
     publish (`draft`→`open`), TDD §3.8/§3.9 + `feature_session_management_tech.md` §4 step 7 (project-on-publish).
     Draft không hiện trên marketplace, không có link join.
  2. **Không đụng tiền.** Draft không thể có `players`/`charges` theo thiết kế (join chỉ mở tại publish —
     SES-UC-12). Không có đường nào để một draft mang tiền.
  3. **Ranh giới bị chặn đã có gate.** `PublishSession` (`publish_new_sessions`) **đã** ❌ khi suspended. Một
     tenant suspended tạo draft không làm được gì có hại: không publish được, không ai thấy, không tiền chuyển.
     Mục đích của suspension (chặn tenant vận hành/thu tiền/hiển thị) được thực thi đầy đủ tại publish — đúng
     ranh giới quan trọng.
  - Đây **KHÔNG** vi phạm nguyên tắc fail-closed "không chứng minh được 0/an toàn thì chặn": ở đây **chứng minh
    được** 0-tiền + 0-hiển thị, nên miễn là hợp lệ, không phải nới lỏng bừa.
- **RANH GIỚI CỨNG — đây là miễn trừ theo TÍNH VÔ HÌNH, KHÔNG phải miễn trừ theo "mutation nhỏ".** Miễn trừ chỉ
  áp cho command có hiệu ứng **(a) vô hình tới khi publish VÀ (b) không đụng tiền**. Mọi command KHÔNG thoả **cả
  hai** vẫn nằm dưới Suspended Action Matrix và phải nhận **narrow per-op action class** khi build (tiền lệ
  DD-104 D2a):
  - `PublishSession` (player-visible) — `publish_new_sessions`, đã có.
  - `AnnounceSession` / `CloseSession` / `CancelSession` / `UpdateSession`-khi-`open` (player-visible hoặc chạm
    roster/tiền) — mỗi cái một class hẹp khi build.
  - Bất kỳ command nào chạm `charges` — luôn dưới ma trận.
  - `DeleteSession` — `delete_draft_session` (DD-104 D2a).
- **Không authorize:** ngoài việc cho phép slice `session-service-create-command-core` flip `CODE_READY`, DD-105
  không authorize code/migration/enablement nào khác. Khi build một command session **KHÁC**, tác giả phải quay
  lại đây + DD-104 D2a để lấy class hẹp — KHÔNG được suy "create ungated ⇒ mutation nhỏ ungated".

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 25/08/2026 | v2.41 | **DD-117 D5 (bổ sung, owner 2026-08-25) — họ lệnh session dedup trên `(tenant_id, command_id)` DUY NHẤT; content fingerprint BỊ TỪ CHỐI.** Slice A (`session-command-update`, `UpdateSession`) HALT MAX_ROUNDS ở vòng review 6 trên [P1]: `updateRequestFingerprint()` SHA-256 **không khoá** trên PII địa điểm (`venue`/`area`) lưu vào `processed_commands` (sống lâu hơn session sau xoá) ⇒ dò từ điển offline khôi phục PII đã xoá (mâu thuẫn "no recoverable field value" + HARD RULE 2). Nguyên nhân: fingerprint là escalation do reviewer lái (R2 "replay not request-bound" → R3 hash PII → R6 đòi keyed HMAC); đã verify `create`/`publish`/`announce` dedup trên `(tenant_id, command_id)` DUY NHẤT — `updateSession` một mình lưu verifier phái sinh PII = lệch chuẩn. **Quyết định:** cả họ lệnh dedup commandId-only; fingerprint BỊ TỪ CHỐI cho họ này ((a) một file không hai dedup semantics; (b) không kéo surface pepper/KMS repo cố ý chưa pin — A3 cờ KMS unpinned; (c) mất "cùng commandId + request khác" là semantics tiền-tồn-tại, đã chấp nhận). Tái nêu lớp R2 ở vòng sau = OUT-OF-CONTRACT. Lane cũ đóng `ap-finish.sh --authorized-close`, finding ACCEPTED ⇒ successor pre-authorized (§6.1), re-register từ `main` sạch, scope NHỎ HƠN (bỏ `updateRequestFingerprint` + guard/test, port outcomes vòng 1–5), budget MAX_ROUNDS mới. **KHÔNG** authorize thêm gì ngoài phạm vi DD-117 D3. |
| 25/08/2026 | v2.40 | **Thêm DD-117 ✅ — `CloseSession`/`CancelSession` nhánh paid/retry-root = fail-closed refuse; deferral 14/08 bị thay (owner 2026-08-25).** Disposition 14/08 defer close/cancel vì "blocked on payments/review_policy subsystem (edge #5)"; DD-110 (15/08) lại mint literal `close_session`/`cancel_session` + hàng ma trận ✅-khi-suspended, chỉ có nghĩa nếu chúng sẽ build ⇒ hai bản ghi ngược hướng, DD-111 D4 (bản mới thắng) phân xử. **D1:** edge #5 "require review_policy — no silent cancellation" đọc đúng là **refuse** khi cơ chế resolve-roots chưa tồn tại, không phải "phải build mới ship được" — refuse không phải money-gap (cùng hình edge #28). **D2:** an toàn hôm nay vì `main` chưa có join/waitlist/payments ⇒ paid roster/retry root **chưa reachable**; refuse ép đường review tồn tại TRƯỚC khi paid reachable (forward-safe). **D3 authorize:** build Update+Close+Cancel trên pattern S2, literal vào `ActionClass` cùng commit mang command (DD-110 D3), nhánh paid/retry-root/charge → fail-closed refuse; slicing do primary agent quyết, STOP_AT_READY. **KHÔNG authorize:** subsystem payments/review_policy, migration/schema.ts, route/FE, projector/schedule, `DeleteSession`, capacity policy (DD-112 vẫn ⬜ — giữ `CAPACITY_BELOW_ROSTER`, không couple `impact_policy`). **D4:** giữ DD-110 D4 test âm (`updateSession` trên `draft` không gọi `authorizeTenantAction`) + test ma trận suspended. |
| 25/08/2026 | v2.39 | **DD-115 → ✅ CHỐT D1–D5, ⬜ giữ D6–D8 mở (owner 2026-08-25) + mirror chain.** Owner ratify **phần cấu trúc** của Membership sau khi đọc ba bằng chứng đo được ở bản 🟡 24/08: (a) `charges.session_id`/`player_id` NOT NULL + `charges_tenant_session_player_uq` + composite FK `0019` ⇒ "một charge tổng" phải sửa bất biến đường tiền, **bác**; (b) cửa sổ 30 ngày không chia hết cho 7 ⇒ với chính ví dụ của requirement (start 23/08/2026, CN) thì T3+T5 = 8 nhưng T7+CN = **9**, cả tháng = **17** chứ không phải 16 ⇒ số buổi phải **đo** từ `sessions`; (c) `settings(tenant_id,key,jsonb)` không có version/audit ⇒ không đủ cho tham số quyết định tiền. **Chốt:** D1 lớp thương mại trên `memberships`, bảng đó **0 thay đổi cột** · D2 **N charge đã chiết khấu + 1 giao dịch allocate sang N charge**, 0 thay đổi trên mọi bảng tiền · D3 đếm từ `sessions` thật, fail-closed khi horizon recurrence chưa phủ hết chu kỳ · D4 `membership_plans` có version, immutable per version, chu kỳ snapshot `plan_version` ⇒ đổi giá **không hồi tố** (BL-SES-3) · D5 quyền lợi fail-closed, chu kỳ chỉ `active` khi **mọi** charge đã `paid`, tiền `unknown` ⇒ không quyền (BL-PAY-12). **Vẫn ⬜ và là blocker cứng trước build:** D6 quyền vào buổi đã full — **ngoại lệ với BL-SES-2/BL-CBF-3 "một capacity authority"** ⇒ Tier C theo DD-107, kèm gap `court` không tồn tại ở đâu trong `packages/db` · D7 bind CK vào chu kỳ — **ngoại lệ với BL-PAY-5 FIFO** · D8 chiết khấu phí giải đấu — chặn ngoài bởi DD-82 (`tournaments` chưa tồn tại, v1 không đụng tiền). **Mirror chain đã thực hiện:** BRD v3.9q (§5.2 → §9.3 dòng doanh thu player-side + OD-23) · PRD v2.8p (FLOW 16) · TDD v3.1j (§11 Q16–Q18) · `business-rules.md` v1.32 (**BL-MBS-1..5 chỉ cho D1–D5**; cố ý **KHÔNG** viết rule cho D6/D7 để hai rule không mâu thuẫn ngầm với BL-SES-2/BL-PAY-5) · ROADMAP · HANDOFF · `feature-dependency-graph.md` · cặp spec lên v0.3 (v0.2 là bản đóng gap review gate cho feature tiền: decision table `MBS-D*`/`MBS-M*` + abuse cases, do phiên khác land cùng ngày 24/08). **Không authorize** code/migration/packet/worktree/slice/enablement: D6 chặn quyền lợi, D7 chặn kích hoạt gói, nên chưa slice nào chạy được đầu-cuối. |
| 24/08/2026 | v2.38 | **Thêm DD-116 → ✅ Chốt Option B — KEEP: đưa lệnh FE PENDING (13/08) vào decision log kèm named trigger (owner 2026-08-24).** Audit V2 + DD-113 D5: lệnh chặn 100% launch scope DD-113 từng chỉ sống ở `../autopilot-templates/next-lanes-2026-08-13-RUN.md` + mirror, **chưa từng thành DD** — đúng thứ DD-111 D4 cấm. Owner ratify **Option B**: PENDING giữ nguyên, **DD-116 là nguồn bền**; gỡ **chỉ** khi named trigger đủ CẢ BA — (a) chọn canonical design file (`design.pen`/`fe.pen`, đúng một) · (b) tracked trên `main` · (c) owner ký nghiệm thu design authority trong `decisions.md` (gate DD-81). Khi gỡ ⇒ authorize FE **bounded đúng 5 khối launch DD-113**, mỗi lane vẫn qua Level 3 + readiness gate; không sự kiện nào khác gỡ. Mirror ROADMAP (v3.8) + HANDOFF (v1.38) cùng phiên. **Không authorize** code/migration/FE lane/`.pen` tracking. |
| 24/08/2026 | v2.37 | **Thêm DD-115 🟡 — Membership: gói hội viên chu kỳ 30 ngày cho player (requirement owner 2026-08-24).** Mở cùng cặp spec `../features/FE/feature_membership.md` v0.1 + `BE/feature_membership_tech.md` v0.1, cả hai **Draft**. **D1 — khái niệm thứ tư, không phải cái nào trong ba cái đang có:** repo đã có `memberships` (person↔tenant), `subscriptions`/`plans` (billing host DD-29) và `membership_tags` (DD-43); gói trả phí của **player** không phải cái nào trong đó, và DD-43 + BL-SES-7 đã đóng đường dùng tag để làm giá ⇒ phải có model riêng, `memberships` **không đổi một cột nào**. **D2 — "thanh toán 1 lần" KHÔNG model được thành một charge:** đo tại live schema, `charges.session_id`/`player_id` đều NOT NULL, có `charges_tenant_session_player_uq` và hai composite FK tenant-integrity vừa land ở `0019`; một charge tổng buộc phải drop NOT NULL + đổi UNIQUE + nới FK — sửa bất biến đường tiền cho một tính năng bán hàng, đúng thứ HR2 cấm. Phương án chọn: **N charge đã chiết khấu + một `bank_transaction` allocate sang N charge**, tận dụng quan hệ nhiều-allocation-một-giao-dịch vốn đã có ⇒ **zero thay đổi trên bảng tiền**. **D3 — số buổi là dữ liệu đo, không phải phép nhân:** cửa sổ 30 ngày = 4 tuần + 2 ngày nên số buổi mỗi thứ không đều. Kiểm bằng lịch thật với chính ví dụ của requirement (start 23/08/2026, Chủ nhật): T3+T5 = 8 buổi nhưng T7+CN = **9** buổi ⇒ gói cả tháng = **17**, không phải 16 — tức hai gói "2 buổi/tuần" **không** bằng nhau và gói cả tháng **không** bằng tổng hai gói kia. Spec vì vậy bắt buộc đếm từ `sessions` thật trong cửa sổ, và fail-closed khi horizon recurrence chưa phủ hết chu kỳ. **D4 — config có version, immutable per version** (yêu cầu "mọi tham số config động"): `settings(tenant_id,key,jsonb)` không có version/audit/kiểu ⇒ không đủ cho tham số quyết định tiền; chu kỳ snapshot `plan_version` để host đổi giá không hồi tố (BL-SES-3). **D5 — quyền lợi fail-closed:** chưa phủ đủ tiền thì không quyền vượt slot, không chiết khấu; trạng thái tiền unknown → không quyền (BL-PAY-12). ⬜ **D6 chưa chốt, chạm HARD RULE:** cho member vào buổi đã full là **ngoại lệ với BL-SES-2/BL-CBF-3 "một capacity authority"** ⇒ Tier C theo DD-107, không được quyết ở tầng spec; kèm theo là **repo không có khái niệm "sân"** — `sessions` chỉ có `slots_max`, chuỗi `court` không xuất hiện ở đâu trong `packages/db` ⇒ "tối đa 8 người/sân" cần cột/config mới. ⬜ **D7 chưa chốt:** BL-PAY-5 quy định FIFO oldest-first, nên một CK trả gói của người đang nợ buổi cũ sẽ bị hút vào nợ cũ; cần cơ chế bind giao dịch vào đúng chu kỳ — cũng là **ngoại lệ có chủ đích với BL-PAY-5**. ⛔ **D8 chặn ngoài:** chiết khấu phí giải đấu không có nơi tiêu thụ — `tournaments` chưa tồn tại trong schema và `feature_tournament_tech.md` v0.3 ghi rõ v1 **không đụng tiền, entry-fee deferred** (DD-82). **10 OQ** (MBS-OQ-1..10) gồm: phạm vi ngày bắt đầu (requirement tự mâu thuẫn — "ngày bất kỳ trong tháng" vs ví dụ "chỉ 23/08"), số sân, buổi ngoài gói, bind CK, chính sách hoàn tiền, chồng lấn chu kỳ, ngoại lệ capacity, chiết khấu giải đấu, làm tròn, đặt tên bảng. **Không authorize** code/migration/packet/worktree/slice/enablement; DDL trong BE spec là contract cần build, chưa migrate. |
| 22/08/2026 | v2.36 | **Thêm DD-114 ✅ — phase-1 feature scope = 7 nhóm, launch (DD-113) là SUBSET (owner 2026-08-22).** **D1:** 1 signup/signin Google · 2 create club (tenant provisioning self-serve) · 3 link club ⇄ Zalo bot (tenant routing) · 4 link Plexco account ⇄ Zalo account · 5 sync data hai chiều + owner config public/private session · 6 manage session + session detail + nhắc nợ/confirm/gạch nợ · 7 settings + user/privacy. Đọc cho đúng: phạm vi này **≈ P0→P5 trừ discovery/chat**, và launch subset của DD-113 chính là thứ giữ nó không trôi. Nhóm 2/3 ở phase-1 nhưng **không** ở launch vì launch chạy trên **tenant provision thủ công** (tenant #1 dogfood); self-serve là thứ mở cửa cho host ngoài. **D2 — vế tiền giữ đúng DD-40/DD-29: auto-reconcile VÀ nhắc tự động đều là `host_pro`**, free giữ mark-paid thủ công. Bốn hệ quả đắt phải nói ra: (a) **billing P5 vào phase-1** — không có subscription thì không có `host_pro` để gate; (b) **DD-29 entitlement registry phải có reader thật đầu tiên** — đo tại `a151b15` vẫn **0 TS đọc `entitlements`/`capabilities`**, code dark từ 07/08; (c) đối soát CK durable (R2) + provider onboarding DD-30, provider authority `sepay|apipay`; (d) auto-reconcile chỉ `Available` khi **đủ chuỗi** entitlement+market+provider+bank+currency+consent+runtime, **cấm quảng bá như capability toàn cầu**. Toàn bộ vế này chạm HR4 *claim-có-tiền cần khoá mạnh* + HR2 ⇒ Tier C theo DD-107. **D3 — toggle public/private chỉ mở SAU khi land `public_projection_fences` + guarded view + CAS-clear + grant migration (8a — nợ sẵn có của DD-12, không phải chi phí tính năng mới)**: hiện kèo chuyển private/cancel **vẫn lộ tới khi projector async chạy**, mở toggle trước fence là trao cho owner một công tắc không tắt ngay được, đúng thứ HR2 cấm. ⬜ **OQ kèm theo, chưa chốt:** *public để làm gì khi phase-1 không có discovery?* — kèo public chỉ tới người khác qua share link `/s/<id>` (DD-73), mà DD-73 còn bị chặn bởi DD-41 projection migration; ba khả năng (kéo DD-73+DD-41 vào phase-1 / chỉ toggle+fence / bỏ toggle) chưa chọn ⇒ slice chạm nhánh này **AWAIT**. **D4 — "đăng ký trên bot ⇒ auto signup vào session" KHÔNG phải luồng mới:** nó là DD-32 Option D + DD-05 + DD-41 + DD-45 + DD-52; nhắc lại ràng buộc paid+unlinked giữ chỗ **15 phút** chỉ active sau verified full payment, account link phải exact `ChannelIdentity↔Person↔verified Account`, provider outage **fail closed**; **cấm dựng luồng join thứ hai** song song `addMemberToSession`. **D5 — gate A3 legal (PII data-class matrix) chuyển từ lead-time item thành BLOCKER của phase-1** vì phase-1 có settings/privacy + bank memo; cần luật sư VN ⇒ khởi động ngay. **D6 — thứ tự ship ba làn** (A launch · B mở cửa host ngoài: create club → link club ⇄ bot → sync một chiều · C nặng nhất, mỗi mục một gate). **D7 — vẫn ngoài phase-1:** in-app Chat · feed/kudos · discovery/search · fill-slot · tournament/club nâng cao · Session Organize · Club Assistant · native · web push · Messenger chưa App Review. **Không authorize** code/migration/packet/worktree/slice/enablement/gỡ FE PENDING/nới gate/đổi P-number. |
| 22/08/2026 | v2.35 | **Thêm DD-113 ✅ — GTM re-sequencing: launch = webapp PWA + Zalo bot song song, app native lùi về phase sau (owner 2026-08-22).** **D1:** web hết vai "fallback"; hai surface ra mắt cùng lúc, ranh giới do thiết kế quyết định (một tin nhắn → bot; cần nhìn nhiều hơn một dòng hoặc sửa được về sau → PWA). Căn cứ là số đo chứ không phải sở thích: DD-69 đặt PWA là phase-1 target từ 18/07, nhưng đo tại `a151b15` vẫn là **0 màn FE · 1 `page.tsx` · 0 route nghiệp vụ** — nhãn "fallback" khiến surface đó không được build, đây là lỗi cách gọi tên chứ không phải lỗi ưu tiên. Hệ quả nặng hơn: Zalo OA là rủi ro nhà cung cấp (DD-14/DD-15 vẫn 🔗 external evidence) ⇒ web-là-fallback nghĩa là **mất Zalo = mất sản phẩm**, còn web-là-surface-độc-lập thì mất Zalo chỉ là **mất acquisition 0-install**. **D2:** launch scope PWA v1 = đúng **5 khối** (signin/signup · link Zalo bot · session management · session detail · settings); khối *link Zalo bot* là **khớp nối**, thiếu nó thì hai surface là hai sản phẩm rời và D1 sụp — đi qua identity authority sẵn có, **không** tạo khái niệm song song. Cấm dùng chữ "PWA" khi chưa có manifest + service worker + installable (`apps/web` hiện chưa có). **D3:** negative scope launch — discovery public · in-app chat · feed/kudos · auto-reconcile (mark-paid thủ công vẫn là baseline, DD-40) · rating công khai · tournament/club tools · **web push** · **fill-slot** (giữ Weeks 5-6) · **native**. **D4:** gate mở native viết thành ngưỡng đo được thay cho "TBD" (≥5 host ≥4 tuần · weekly return ≥60% · install rate ≥30% **tách iOS/Android** · `/api/v1`+bearer/refresh đã land · nêu được capability PWA đo được là không làm nổi). Hàng install-rate không vụn: **iOS chỉ cho web push khi PWA đã cài**, nên mọi lập luận "PWA đủ rồi, có push mà" treo trên một tỉ lệ chưa ai đo — cũng là lý do web push nằm ngoài launch. **D5 — DD này KHÔNG gỡ FE PENDING 13/08:** đổi ưu tiên GTM và cấp quyền thực thi FE là hai quyết định khác nhau. ⚠️ Kèm phát hiện: **lệnh FE PENDING chưa từng vào `decisions.md`** — nguồn duy nhất là `next-lanes-2026-08-13-RUN.md` rồi mirror ROADMAP/HANDOFF, tức trạng thái chặn FE đang sống ngoài decision log, đúng thứ DD-111 D4 vừa cấm. **D6:** nghĩa vụ mirror theo thứ tự gtm-strategy (đã xong) → ROADMAP → HANDOFF → native-app-strategy → BRD/PRD nếu chạm surface scope. **Không authorize** code/migration/packet/worktree/slice/enablement/gỡ PENDING/đổi P-number. ⚠️ **Ghi chú version:** v2.34 (15/08) là số cuối được ghi, nhưng **DD-112 (17/08) đã thêm vào file mà không có dòng changelog** ⇒ nhảy v2.34 → v2.35 ở đây thực chất gánh **hai** DD (112 + 113). Đừng đọc chuỗi version như một chuỗi liên tục 1-DD-một-bậc. |
| 15/08/2026 | v2.34 | **Thêm DD-111 ✅ — `AnnounceSession` guard `ends_at` + `SESSION_ALREADY_ENDED`, edge #11 thuộc FE (owner 2026-08-15).** **D1:** announce gate `status='open'` **và** `ends_at > now()`, đánh giá dưới row lock bằng đồng hồ DATABASE (cùng lớp clock-skew P1 mà PublishSession tốn một vòng). **Không** đảo ngược ruling "không cutoff" trước đó: ruling đó về `starts_at` (đừng chặn announce khi đang đá), `ends_at` là vị từ khác và nhờ `CHECK (ends_at > starts_at)` (`0002:98`) **không thể** chạm ca late-join. Tiền đề cũ bị bác bằng đo: lập luận ban đầu coi việc announce buổi vừa xong là "transient" vì auto-close sẽ dọn — **auto-close không tồn tại**, `:533` chỉ viện dẫn nó như ngưỡng quy ước, nên hàng `open` quá giờ nằm đó vĩnh viễn và announce phát "vào chơi đi" cho buổi đã xong, lặp vô hạn. Announce chịu guard này còn command đổi-state thì không, vì **thông báo cũ gây hại theo cách mutation không gây**: nó tới người thật, mang tin sai, không có state nào để sửa. **D2:** mã lỗi mới `SESSION_ALREADY_ENDED` (409) — buổi **đang** `open` nên `SESSION_NOT_OPEN` là phát biểu sai về trạng thái, và i18n là HARD RULE (bề mặt tiếng Việt sẽ báo "chưa mở" về buổi đã đá xong). **D3:** edge #11 thuộc **FE** (`feature_session_management.md:94` — "closed/cancelled/past"); dòng BE `:221` chỉ ghi "after status=closed" là **bản chép thiếu một luật Security**, không phải hai thẩm quyền mâu thuẫn ⇒ sửa dòng BE cho khớp FE, KHÔNG thu hẹp FE. Spec phải viết **cả hai vế** kẻo người sau xoá nhầm guard: announce **miễn** edge #11 vì không mutate, **và** announce **vẫn** mang guard `ends_at` riêng vì lý do D1. Past-weight của cancel vẫn do **edge #31** sở hữu. **D4 — quyết định trong chat không phải thẩm quyền:** guard được owner chốt trong chat rồi lane mang qua gate; reviewer gắn [P1] "unauthorized Tier-C change" — **false positive về nội dung, true positive về hình thức**, vì chỗ duy nhất ghi lại authorization là chat + ledger gitignored + chính spec đang bị chất vấn. Luật: quyết định owner mở đường sửa spec Reviewed **phải vào `decisions.md` TRƯỚC khi** lane mang qua gate — cùng nguyên tắc "bản ghi bền thắng lời khai hội thoại" đã dùng để bắt slice re-register, áp cho owner y như áp cho lane. ⚠️ **Đính chính khiển trách sai của owner:** owner hai lần nói lane "chế ra" `AN1`/`CL1`/`CA1`; thực tế chúng nằm ở `docs/autopilot/contracts/autopilot-session-commands-update-close-cancel.md:224,227,232` do phiên authoring trước viết. Owner grep **spec** rồi kết luận "không tồn tại" — đúng lớp lỗi "kết quả rỗng là bằng chứng về truy vấn". Lỗi thật của lane hẹp hơn: gọi authored contract là "acceptance matrix you ratified", tức nâng sai **cấp thẩm quyền** (authored ≠ owner-ratified); các mục DI phải sửa lại theo khung này. **D5:** kéo authored packet vào scope thay vì để "advisory" — nó stale hai chỗ (AN1 không guard; khai `session.announced` trong khi spec `:514` khai `session.announcement_requested`), và một authored contract stale vừa sinh ra một [P1] cùng hai vòng review. |
| 15/08/2026 | v2.33 | **Thêm DD-110 ✅ — bốn action class hẹp cho session command family + hàng ma trận (owner 2026-08-15).** Đóng đúng blocker Tier C mà packet `session-commands-update-close-cancel` tự nêu ở `_blocker_note`: DD-105 chốt **hướng** ("narrow per-op class khi build") nhưng **không đặt tên** cái nào, DD-104 D2a chỉ đặt `delete_draft_session` cho op khác đang parked, và tác giả slice bị `negative_scope:41` HALT nếu tự đặt. **D1 — bốn tên theo dialect `verb_noun`:** `update_open_session` · `close_session` · `cancel_session` · `announce_session`; ba literal cũ (danh ngữ) **không đổi tên** vì `publish_new_sessions` đã có caller production `1ccbe5d` + hàng ma trận + catalog entry — enum có hai phương ngữ là cố ý, `verb_noun` chuẩn cho literal mới. **D2 — close/cancel ✅ khi suspended, announce/update ❌:** căn cứ lấy từ chính ma trận, không nhập từ ngoài — hàng `Player CK ingest ✅` cho thấy tenant suspend **vẫn nhận đối soát chuyển khoản**, tức ranh giới đã khai sẵn là *chặn hoạt động thương mại MỚI, không đóng băng nghĩa vụ ĐANG CHẠY*; bất đối xứng chi phí quyết định lựa chọn: cả bốn ❌ ⇒ host suspend không đóng/huỷ được buổi đã `open` trong khi người chơi đã join và có thể đã chuyển khoản (**thiệt hại chắc chắn, không đường thoát, chỉ lộ ở lần suspend thật đầu tiên**), còn close/cancel ✅ ⇒ tenant abuse huỷ buổi của chính nó (**phiền, không phải thiệt hại**; nó vẫn không publish/announce/update được). ⚠️ **Giới hạn kế thừa, DD này KHÔNG giải:** gate resolve **hai** trục suspend (`subscriptions.status` = nợ tiền vs `tenants.status` = abuse/ToS, spec billing `:288-291`) về **một** hàng ⇒ bốn literal mới không phân biệt được, y như ba cái cũ. **D3 — tên vào decision log ngay, literal vào `ActionClass` cùng commit mang command của nó:** literal không caller là code dark, đúng thứ vừa mất tám ngày để thoát với `authorizeTenantAction`; packet cho phép ship subset khi vượt budget (`AnnounceSession` "ONLY if budget allows") nên gom cả bốn lên trước sẽ tái tạo đúng vấn đề vừa tránh — hình mẫu là `delete_draft_session`, có tên từ 13/08, tới nay vẫn chưa vào enum. **D4 — nghĩa vụ test bắt buộc:** gate **không biết** status của session, caller chọn literal, nên `update_open_session` là quy ước ở call site chứ không phải enforcement; slice phải mang test âm *`updateSession` trên `draft` KHÔNG gọi `authorizeTenantAction`*, nếu không D1 mới chỉ được viết ra chứ chưa được thực thi. **Không authorize** code/migration/packet/worktree/enablement. |
| 14/08/2026 | v2.32 | **Thêm DD-109 ✅ — nới `fix_rounds_max` 5→8 cho RIÊNG `session-draft-lifecycle-commands--v3`.** `PublishSession` HALT `MAX_ROUNDS` hai lần liên tiếp (v1 validation-edge-family, v2 DB-clock rồi lan sang test fidelity; 11+ vòng gộp). Trước khi cho chạy lần ba phải phân biệt **thrash** với **thứ khác** — và bằng chứng nói không phải thrash: `regions.log` của v2 ghi **5 vòng chạm 5 vùng khác nhau, không lặp**, `REGION_THRASH` không hề bắn, mỗi vòng đóng một lỗ thật khác lỗ trước. **Nguyên nhân thật, đo được và trước nay chưa viết ra:** pinned reviewer đọc `git diff <base>...HEAD` — **toàn bộ 1.690 dòng mỗi vòng, không phải phần vừa sửa** — trong khi per-run miss-rate đã đo ≈ **2/3** (analysis 13/08). Ghép lại: mỗi vòng là một lần **lấy mẫu** trên cùng diff, finding "mới" ở vòng sau là chữ ký **under-sampling** chứ không chứng minh slice sai — đúng điều `codex-review-verdict-nondeterminism` đã ghi. **Hệ quả sửa một phán đoán sai trước đó:** thu hẹp *việc* của successor KHÔNG thu hẹp *bề mặt review*, nên đề xuất "v3 chỉ sửa 2-3 finding" là vô hiệu. Chọn 8: `(2/3)^M` cho M5≈13% → M8≈3,9%, thêm nữa lợi ích giảm nhanh mà rủi ro vá-vô-hạn tăng; **ước lượng có căn cứ, không phải phép đo** (n=3 chỉ pin được hướng). Ghi rõ **trần 5 không sai** — nó có giả định ngầm rằng diff đủ nhỏ để một vòng phủ gần hết, và giả định đó vỡ ở 1.690 dòng dưới reviewer stochastic. **Bốn điều kiện cứng:** (1) v3 **phải tới được vòng security** — chưa attempt nào chạm tới dù slice gọi `authorizeTenantAction`, tức thứ §8 bắt buộc cho trust boundary chưa từng chạy; (2) v3 HALT nữa = **bằng chứng quyết định** cho slice-too-big ⇒ re-slice thật, **cấm thử lần bốn**; (3) `REGION_THRASH` giữ nguyên hiệu lực; (4) DD phải được dẫn trong contract v3. Ngoại lệ **một lane, có ghi chép** theo khuôn DD-101; §8 **không đổi** cho lane khác, và DD này **không thay** E2 re-measurement — v3 là ca thực nghiệm sống, kết quả nên ghi ngược vào task nondeterminism. |
| 14/08/2026 | v2.31 | **DD-106 phân xử từng câu + thêm DD-108 ✅ (cả hai owner-delegated; tiền lệ DD-97/98/99).** **DD-106 Q1 Pay-for-Buddy ⬜ DEFER và BÁC riêng enum `'buddy'`:** phát hiện `payment_allocations` **đã có** `created_by uuid` (`0003:87`, *"actor for cash/waiver/manual"*) và CHECK **đã cho phép** `source IN ('cash','waiver') AND created_by IS NOT NULL` (`0003:92`) ⇒ *"A trả hộ charge của B"* biểu diễn được **hôm nay** bằng `('cash', created_by=A)`. Spec gộp hai thứ khác loại: đổi money model (thêm enum) vs workflow (request→confirm); bác vế một, hoãn vế hai. Muốn mở lại phải trả lời được `'buddy'` mang thông tin gì mà `('cash'\|'manual', created_by)` không mang — mỗi giá trị enum trên đường tiền là một nhánh vĩnh viễn trong mọi đối soát/report/reversal. Thứ tự cũng sai: project có 0 route nghiệp vụ, Pay-for-Buddy tinh chỉnh luồng chưa tồn tại trong khi DD-40 mark-paid mới chặn doanh thu. **Q2 embed ⬜ DEFER ràng buộc nhị phân vào fence:** `embed_snapshot` là projection **thứ hai** của session state, trong khi projection thứ nhất còn chưa có đường invalidate (`public_projection_fences` — nợ DD-12 chưa land, DD-73..78 ghi rõ private/cancel phải chờ projector async); thêm cái thứ hai là nhân đôi lỗi đã biết. Gỡ hoãn khi fence + guarded view + CAS-clear merge. **Q3 SessionCard ✅ chấp nhận hướng:** pin canonical ở `feature_marketplace_discovery.md` §3, spec khác trỏ tới, **không tạo file mới**, chưa nâng contract cho tới khi có surface render; bot degrade là hợp lệ và phải ghi trong shape. **DD-108:** mirror trust-gate file sang canonical đủ ba vế + fix gốc rễ (test phải đỏ khi hai bản phân kỳ — `KIT_VERSION` gõ tay không đổi khi nội dung đổi, đúng lỗi "khai báo không phải phép đo") + chặn `autopilot-update.sh` tới khi fix land; căn cứ: footgun lần **thứ hai**, đo được cả hai kit cùng `KIT_VERSION: 31`. |
| 14/08/2026 | v2.30 | **Thêm DD-107 ✅ — autonomy mode `autonomous_to_ready` + context/authority protocol.** **Context:** toàn bộ doc corpus thuộc phạm vi quyết định, nhưng đo tại `1fdba1d` là **303 file / 8,5 MB / ~2 triệu token** (riêng 6 doc lõi đã ~220k) ⇒ **không nạp được**; bằng chứng sống: session build `session-service` chạm 98% context khi mới nạp context pack của chính nó. Luật thành **bảo đảm ĐỘ PHỦ chứ không phải ĐÃ NẠP**: (1) luôn nạp lõi nhỏ — HANDOFF live-truth + **bảng tổng hợp** `decisions.md` (~18k token, không phải toàn thân) + gate + packet; (2) phần còn lại **search toàn corpus rồi ghi query vào ledger**; (3) **kết quả rỗng là bằng chứng và phải ghi** — "search `buddy` → DD-26 cấm" chính là câu đáng lẽ ngăn được DD-106; kèm cảnh báo grep rỗng là bằng chứng về *query* (đã sập 2 lần: awk backtick vs em-dash, và luật ngôn ngữ grep zero cho luật có thật). **Thang authority 7 bậc** viết lần đầu để lane tự giải mâu thuẫn (rà soát 13/08 tìm thấy mâu thuẫn đồng thời ở spec/playbook/template/index): runtime truth > migrations+`schema.ts` > `decisions.md` > spec Reviewed (mục 🟡 bên trong **không** phải contract) > Draft/plan/proposal > ROADMAP/BRD/PRD/TDD theo đúng câu hỏi mỗi cái sở hữu > index/summary (mục trước nhất — 46/51 ô version sai). Bốn tie-break: packet trên branch thắng bản `main`; khối live-truth mới thắng khối cũ **kể cả phần chỉ thị**; hai doc cùng khai canonical thì cái dẫn được decision ID thắng, không thì AWAIT; `Doc status ≠ Implementation status`. Ledger thêm field **`Searched:`** — trường duy nhất cho phép reviewer biết agent quyết từ corpus hay từ prior. |
| | | **(tiếp DD-107 — phần autonomy)** Lane chạy thẳng tới READY, owner review **một lượt tại READY** qua Decision Ledger thay vì bị ngắt từng quyết định. Căn cứ đo được: lane `session-service-create-command-core` v1 dừng hỏi owner **4 lần chỉ vì budget** (300→360→440→470) rồi vẫn `HALT MAX_ROUNDS` — budget không phải ràng buộc thật; và 3/4 blocker của packet giải được bằng cách **đọc repo**, chỉ B4 là quyết định owner thật (→ DD-105). Thang thẩm quyền **A derivable** (quyết + log; dừng ở tầng này là defect) · **B judgment/reversible/in-scope** (quyết + log đủ, owner review batch) · **C reserved** (vẫn AWAIT — đúng 8 mục: money contract · PII/HARD RULES · sửa contract spec Reviewed · migration đổi semantics/chung tail · enablement · merge/deploy · vượt negative scope · finding bị phản bác). Tiêu chí: **phép thử 10×** + tie-break `fail-closed > một nguồn sự thật > ít khái niệm > theo tiền lệ > reversible`. Budget thành **tín hiệu** (overrun ⇒ re-slice hoặc log nguyên nhân thiết kế, lần hai cùng nguyên nhân ⇒ re-slice bắt buộc). HALT successor pre-authorized khi finding được chấp nhận **và** gọi tên được nguyên nhân thiết kế. **Tier C không rút gọn thêm** vì DD-106 là hoá đơn của việc thiếu nó. **Không đổi:** worktree isolation, scope-gate, 2 vòng review sạch, loop breaker, **human merge**; mode này không hàm ý auto-merge. Mirror: `../autopilot-templates/level3-workflow.md` §6.1 (+ §9 READY/AWAIT). |
| 13/08/2026 | v2.29 | **Thêm DD-106 🟡 — ba hợp đồng do spec pass 12/08 (`692f9f2`) viết thẳng vào spec đã Reviewed mà không có decision.** Phát hiện khi rà soát docs tại `main@1fdba1d`. **Q1 Pay-for-Buddy** (đường tiền): bảng `buddy_payment_requests` + `payment_allocations.source='buddy'` + 5 endpoint nằm trong `feature_payment_reconcile.md` v1.13 **Reviewed**, trong khi live `0003_payments_ledger.sql:85` chỉ có 5 giá trị và DD-26 từng chốt "không thêm model 'buddy'" ở lớp identity — chạm HARD RULE claim-có-tiền-cần-khoá-mạnh, không tự chốt được. **Q2 structured embed**: `chat_messages.embed_type/embed_ref_id/embed_snapshot` khai trong BE chat spec nhưng `0031` **đã land** không có; đây là expand bảng vừa land (⇒ migration `0033+` đủ gate) và `embed_snapshot` là mặt lộ mới cho whitelist. **Q3 unified `SessionCard`**: contract hiển thị cross-surface chưa có nguồn canonical. Ba câu độc lập, chốt riêng được (khuôn DD-90). **Xử lý tạm: gắn nhãn 🟡 tại chỗ trong spec thay vì revert** — giữ nội dung authoring, chỉ đính chính trạng thái; không slice nào được author/implement khi nhãn còn. Không đổi DD khác, không đụng delivery order. Ghi kèm cơ chế sinh lỗi: pass gộp hai lượt vào một commit (6/10 file nhảy 2 version) nên bước author vượt bước quyết định. |
| 13/08/2026 | v2.28 | **Thêm DD-105 ✅ — suspension gate cho `CreateSession`: miễn theo tính vô hình của draft.** Owner chốt phương án (b) (Cowork session, 13/08): `createSession` KHÔNG gọi `authorizeTenantAction` (create-draft ungated). Lý do fail-closed-có-chứng-minh: draft vô hình tới publish (project-on-publish, TDD §3.8/§3.9 + `feature_session_management_tech.md` §4 step 7) + không đụng tiền (draft không có `players`/`charges` theo thiết kế) + ranh giới thật (`publish_new_sessions`) đã ❌ khi suspended. **Ranh giới cứng: miễn trừ theo TÍNH VÔ HÌNH (a invisible-until-publish + b money-free), KHÔNG phải "mutation nhỏ"** — publish/announce/close/cancel/update-on-`open` (player-visible) hoặc chạm `charges` vẫn dưới Suspended Action Matrix + nhận narrow per-op class khi build (tiền lệ DD-104 D2a). Đóng blocker B4 của slice `session-service-create-command-core` (→ `CODE_READY`). Không authorize code/migration/enablement khác. |
| 13/08/2026 | v2.27 | **DD-104 chốt D0–D4 (decision-level) + gỡ WIP DeleteSession lần hai khỏi 2 spec Session.** Owner chốt theo `../decisions/dd104-delete-session-decision-table.md` (đo tại `main@1303c31`): **D0** không ưu tiên `tenant-capability-authority-core` — bảng để dành, slice DD-104 parked; **D1a** mọi FK trỏ `sessions` giữ `NO ACTION` và chặn delete — `DELETE` là final fence, KHÔNG cascade, không danh sách bảng-được-dọn phái sinh (hệ quả: câu hỏi kế toán D2-cũ v2.24 tự giải — không charges row nào bị xoá); **D2a** action class hẹp `delete_draft_session` trong `authorizeTenantAction` (sửa contract billing, slice riêng) — đóng blocker suspension-gate ở decision level; **D3c** bắt `23503` rồi tra `pg_constraint` `confrelid='sessions'::regclass` (loại allowlist tên tự sinh + pre-check TOCTOU); **D4a** ordering chung delete+publish theo precedent publish §4 step 6 (re-check trong cùng transaction, locking read, ngay trước commit). Old-D3 authz mâu thuẫn giải theo D2a (`session.manage` qua `delete_draft_session`, dùng nhất quán khi author lại spec). 4 deferred-blocker của v2.26 → resolved decision-level, văn bản giữ nguyên làm ràng buộc implementation. Spec-side: WIP DeleteSession (tái xuất hiện trong docs pass 12/08) gỡ lần hai — FE v2.25 / BE v2.22 chỉ giữ pointer + changelog audit trail, ID edges/tests giữ trống không renumber. **Không authorize code/migration/packet/worktree** — slice DD-104 khi mở vẫn qua đủ gate G1–G6 + closure matrix. |
| 12/08/2026 | v2.26 | **Ratify/reconcile open-decision batch (clean subset) vì lợi ích dài hạn.** DD-14/15 phân loại external enablement/optimization evidence: Login/CTA OFF tới khi có bằng chứng, account-linking chỉ qua verified one-time link-code path (DD-50 `/link`, phase-1 contract chưa build), không auto-link. DD-34/35/36 có exact reopen trigger, không speculative whitelist và tách serving/sync lifecycle; DD-36 replacement lifecycle: last-good chỉ giữ khi fetch fail trước khi accept revision/hash mới, sau accept canonical `kb.ingest` supersede old generation trước processing, DLP/index/activation fail trả zero retrieval (không fallback, không dựng staged-serving state machine thứ hai). **DD-104, DD-18 và DD-96/DD-79 KHÔNG ratify trong subset này** — DD-104 giữ 🟡 đề xuất (blocker: suspension gate + money-FK boundaries D1/D2 + concurrency ordering + 23503 trusted-resolution, xem note trên DD-104 + backlog); DD-18 (blocker tasks ở backlog) và DD-96/DD-79 (blockers B1–B4 ở DD-96 Part B section) ratification deferred (xem note trên DD-18/DD-96). Không authorize code/runtime/enablement. |
| 12/08/2026 | v2.25 | **DD-102 điều kiện cứng ĐÃ THOẢ — đóng nghĩa vụ, không đổi quyết định.** `0032_chat_dm_safety_config_single_read.sql` land tại `main@80a3464` (2026-08-12), **trước** khi slice 7 (`chat-shared-message-command-core`) hoặc slice 8 (`chat-dm-lifecycle-command-core`) tồn tại — cả hai chưa được author. Torn read bốn-statement của `assert_dm_allowed` đóng: đọc singleton row một lần, phép AND của bốn capability toggle chuyển vào helper `dm_safety_flags_enabled` làm single source, `dm_safety_enabled()` delegate về đó (4 → 1 lần đọc, hành vi giữ nguyên từng nhánh). Chọn helper thay vì lặp AND inline vì `0030:207` đã khai `dm_safety_enabled()` là *"pure predicate, the AND of all four capability toggles"* — một định nghĩa thứ hai sẽ để hai path DM trôi khác nhau, tức bất đối xứng an ninh chứ không phải khác biệt style. Behaviour-preservation của `CREATE OR REPLACE` được pin bằng acceptance row riêng (missing row → deny, từng toggle false → deny, all true → allow), không bằng so sánh thân hàm. Bằng chứng: gate attempt 1 pass, 13/13 focused, 813 test xanh, 2 vòng code + 1 vòng security review CLEAN, `fix-round-count` 0, `ap-finish --squash-verified` xác nhận origin squash patch **bằng đúng** READY feature diff. Implementation lệch có chủ đích khỏi DDL phẳng pinned ở contract §3: `CREATE OR REPLACE` một hàm do `chat_definer` sở hữu cần bracket `GRANT CREATE → SET ROLE → RESET → REVOKE` (idiom `0022`/`0023`) vì đường NOINHERIT kiểm cả ownership lẫn CREATE trên schema — `migrate.test.ts` BR-6 là forcing function chứng minh, thân hàm giữ byte-for-byte. Không đổi nội dung quyết định DD-102, chỉ ghi nhận nghĩa vụ đã hoàn tất. |
| 11/08/2026 | v2.24 | **Thêm DD-104 🟡 — `DeleteSession` hard delete, proposal (chưa chốt).** Nội dung `DeleteSession` đang nằm WIP-chưa-commit trong `feature_session_management_tech.md` v2.20 + `feature_session_management.md`, cả hai mang `Status: Reviewed` ⇒ theo `CLAUDE.md` nội dung chưa-chốt thuộc `decisions.md`, không thuộc spec. **Phát hiện chặn:** algorithm bước 5 khai *"FK cascade xóa `players`, `session_surface_refs`, `session_occurrences` tự động"*, nhưng đo trên migration (canonical, không đọc `schema.ts`) cho **9 FK trỏ tới `sessions` và ZERO khai `ON DELETE CASCADE`** ⇒ mặc định `NO ACTION` ⇒ `DELETE FROM sessions` ném FK violation ngay khi có child row. Spec không mô tả hành vi chưa-implement mà mô tả một cơ chế **không tồn tại**. D1 = cascade thật (sửa 9 FK gồm `charges` ⇒ cascade xuống sổ tiền, chạm HARD RULE *claim-có-tiền cần khoá mạnh*) vs giữ `NO ACTION` để FK làm chốt fail-closed vs bỏ hard delete dùng `CancelSession`. D2 = guard chỉ chặn `paid` của player ngoài host ⇒ charge `pending`/`failed` của mọi người và charge `paid` **của host** sẽ bị xoá — quyết định kế toán, phải chốt tường minh. D3 = authz mâu thuẫn ba chỗ (`Host` / `TenantAdmin` / `session.manage`) — lỗi cần sửa, không phải quyết định. Đã kiểm và KHÔNG cần quyết: `processed_commands` không có FK tới `sessions` nên replay đúng như spec khai; outbox ghi trước DELETE trong cùng transaction hợp lệ. Cờ phụ: error message là literal tiếng Việt, i18n nằm trong 5 HARD RULE. Không authorize migration/code/FK change nào. |
| 11/08/2026 | v2.23 | **Thêm DD-103 ✅ — chấp nhận gap Person-merge re-parent của `0031_chat_schema_core`, có ràng buộc cứng.** Trigger `chat_members_identity_immutable`/`chat_channels_identity_immutable` (do chính slice thêm ở round 1–2 để đóng một security bypass) chặn vô điều kiện UPDATE lên `person_id`/`dm_key`; composite FK tới `memberships` không `DEFERRABLE` ⇒ **cấu trúc chặn** re-parent, không phải chưa-implement. Đo lại xác nhận cả ba: spec `feature_inapp_chat_tech.md` (hàng `| 10 | Cross-Feature | Account merge → chat authorship |` và acceptance `| 11 | Merge re-parent |`) khai re-parent là yêu cầu; `identity-model.md:234-237` xác nhận re-parent vật lý là mặc định còn tombstone chỉ là ngoại lệ có tên cho `pay_code` (DD-02); Person-merge **chưa tồn tại** (zero implementation) nên exposure = 0. Chấp nhận vì hình dạng escape hatch + `DEFERRABLE` phụ thuộc transaction merge thật chưa có — thiết kế mù dễ phải làm lại, và `pay_code` là tiền lệ "quyết lúc xây entity". **Ràng buộc cứng:** slice Person-merge phải mang theo migration mở đường (escape hatch merge-scoped, FK `DEFERRABLE INITIALLY IMMEDIATE`, regression test deferred-transaction); thiếu là blocker của chính nó. Backlog `chat-identity-merge-reparent-enablement`. Lane `--v2` ở `fix-round-count` 5/5 nên đóng qua `--authorized-close` + merge trên bằng chứng (795 test xanh tại `a8f120f`, 11 vòng review, mọi finding đều thật). |
| 10/08/2026 | v2.22 | **Thêm DD-102 ✅ — waiver có điều kiện cho round-5 finding 1 của `chat-dm-safety-authority-core--v3`.** `assert_dm_allowed` đọc config qua 4 statement riêng ⇒ torn read dưới READ COMMITTED. **Đo lại: KHÔNG phải fail-open** — `rate_limit_check(…, 0, …)` trả `false` (`v_count >= 0` luôn đúng) nên thiếu config là deny; `dm_safety_enabled()` false cũng deny; `audit_enabled` chỉ đụng log. Exposure = 0 (zero production caller; slice 7/8 chưa tồn tại). Fix bất khả thi trong scope vì `0030` đã apply + hash-lock, và `fix-round-count` 5/5 với `clean_rounds` 2. **Điều kiện cứng:** migration follow-up (`chat-dm-safety-config-single-read`) phải land TRƯỚC slice 7/8; nếu chưa, nó là blocker của slice đó. Đóng qua `ap-finish.sh --authorized-close` + merge trên bằng chứng, theo tiền lệ `deps-security-bump` #3. Ghi nhận riêng: cùng finding bị round 2/3/4 xếp advisory ba lần rồi round 5 nâng blocking không nêu lý do — reviewer non-determinism, mở backlog riêng. |
| 10/08/2026 | v2.21 | **Thêm DD-101 ✅ — ratify B3-budget amendment cho `chat-dm-safety-authority-core`.** Owner-authorized scope amendment 2026-08-05 override `plan §9:416` cho **riêng slice này**: module 3→5, ~1.145 changed LOC (3 module cốt lõi) vs trần 750. Lý do: ngoại lệ **có ghi chép** (`_scope_note` tự khai vượt trần; `negative_scope` "NARROWED, not blanket-excluded" liệt kê từng touch; mở rộng ở codex round-05); phần vượt là **hệ quả cơ học** của `ALTER FUNCTION … OWNER TO chat_definer` trong `0030`, không phải scope creep; và re-slice sẽ phải chia `chat-dm-safety-invariants.test.ts` (714 dòng) — thứ `§9:416` cấm cắt để ép budget. **Ranh giới:** trần 750/3-module giữ nguyên cho slice 4/36 và mọi slice khác; slice 3 giữ trần riêng ≤1.000; **không tạo tiền lệ tự động**; không miễn `--v3` khỏi gate nào. Mục đích vận hành: reviewer `--v3` nêu chuyện trần thì trỏ DD-101 và đi tiếp thay vì `AWAIT` tốn một vòng codex. Không authorize code. |
| 09/08/2026 | v2.20 | **Thêm DD-100 ✅ — Level 3.1 adoption cho Plexco.** Bước 0 re-pin tại `64e9ccb` / KIT 31 (ba claim cốt lõi của discussion doc còn đúng; snapshot v25 chỉ mục ở số hiệu). Bốn quyết định owner: **D1** Plexco-local trước canonical sau (chấp nhận fork + nợ backport + KIT_VERSION hậu tố consumer); **D2** Phase 0 song song P4/P5 nhưng serialize theo va chạm file thật — gap1/gap2/P5 cùng ghi `codex-review-pin.sh`, thêm hai ràng buộc thứ tự P4-standard→Phase 0 và gap3→P1; **D3** nhận `level3-operational-v3` + `design_contract` với cửa sổ chuyển tiếp v2/v3, forward-only, không retrofit lane đang đỗ; **D4** giết maturity-ledger + `proactive_routine` (owner-delegated; đo được zero consumer / zero writer / mục đích gốc đã bị bác / cứu nó xung đột root-lock). Plan + verdict `NOT_CODE_READY` blocker B1–B5: `../autopilot-templates/level3.1-adoption-plan.md`. **Không authorize code/register/worktree/merge**; không đổi phase, delivery order hay bất kỳ DD sản phẩm nào. |
| 07/08/2026 | v2.19 | **Propagation pass cho decision batch v2.18 (DD-97/98/99).** ROADMAP v3.4n: Phụ lục A +DD-96..99 + changelog mirror. BUILD-STATUS: +row Statement/export (DD-97) direction ✅ · build chưa schedule. `feature_billing_lifecycle.md`: pointer blockquote DD-97 entitlement split (không đổi body/cơ chế registry). `feature_payment_reconcile.md`: header liên quan +DD-97/DD-98. `feature_payments_fe.md` (Draft): note DD-97 surface riêng + DD-99 P4 + DD-98 NP-1/NP-4. Design-input proposal + 3 research files: addendum trạng thái đã chốt. DD-06 row: back-pointer DD-98 NP-5. Toàn bộ là pointer/mirror — không đổi contract body của spec Reviewed nào, không authorize code/build. |
| 07/08/2026 | v2.18 | **Owner-delegated decision batch — chốt DD-97/98/99** (owner uỷ quyền trong session 2026-08-07, tiêu chí "lợi ích lớn nhất cho pj"; provenance ghi rõ ở từng DD). **DD-97 ✅ direction + entitlement:** per-session statement view = free (mặt đọc của core loop P1 Host, chi phí ≈ 0, chặn paywall là chặn adoption) · kỳ/tháng + export PDF/XLSX = `host_pro` (chi phí job/storage thật, nhu cầu xuất hiện khi CLB đủ lớn, cùng họ `crm_dashboard` DD-40); mechanism vẫn chưa `PLAN_READY` — chờ DTO owner Reviewed. **DD-98 ✅ `DECISION_FINAL`** NP-1..5 (cả 5 là hệ quả decision đã ✅ từ trước — ratify đóng cửa drift, chi phí 0). **DD-99:** P1 ✅ (4 section = điều kiện FE Draft→Reviewed; matrix/FR-trace/effect-matrix/Forbidden-appendix là optional — giữ gate nhẹ; sửa gate/template = docs-only slice riêng chưa schedule) · OQ-DD99-1 ✅ option (a) rule hai lớp: dashboard-shell được phép 768px, player-facing mobile-first chỉ 375+desktop, F0 override được cả hai · P2→P4→P3 prioritized theo critical path S9–S12 PWA (P2 trước; P4 = free-tier core value, tách refund-on-cancel chờ refund policy; P3 sau vì cần identity contract nặng). Không mục nào authorize code/runtime; mirror ROADMAP/BUILD-STATUS cho DD-96..99 còn nợ (ghi nhận, chưa làm). |
| 07/08/2026 | v2.17 | **BotShopez docs-template sweep.** Thêm `../research/botshopez-docs-template-gap-2026-08-07.md` (khảo sát template 18 FE + 17 BE docs `Saas Bot tele` — bổ trợ, không trùng, `cross-project-standardization` vốn chỉ so code conventions). Verdict: template Plexco cover/vượt gần hết; **không DD mới, không sửa spec/gate nào**. Giữ 4 pattern nhỏ làm input cho DD-99 P1 khi owner ratify (State Coverage Matrix · AC trace BRD FR-x.y · effect matrix cho transition đa domain · Forbidden-appendix đánh số) + 1 authoring pattern cho channel docs (bot copy block nguyên văn — Zalo channel docs hiện chưa có, messenger có). REJECT table 8 mục kèm lý do (JSON schema copy vào FE doc, rollback DROP TABLE, tenant app-level-only, test quota không map file thật, caching FE cho person/money surface...) để chống port nhầm về sau. Không authorize code/runtime. |
| 07/08/2026 | v2.16 | **BE sweep — kết thúc toàn bộ đối chiếu Sporta (12/12 BE docs).** Thêm `../research/sporta-be-docs-gap-2026-08-07.md`: BE là chiều Plexco vượt gần như toàn diện (ledger vs status flags, outbox vs in-process events, invariant tests vs cron reconcile, fail-closed vs zero-fallback) — **không DD mới, không sửa BE spec Reviewed nào**. Giữ 4 cụm design input: §2.1 export mechanics → DD-97 (thêm pointer trong body DD-97); §2.2 organize mechanics (SPORT_RULES table-driven, preview≠commit, degrade tường minh, grace-period edit) → DD-61..64 build post-P4; §2.3 text-search scale path cho marketplace (⚠️ config `'vietnamese'` của Sporta không tồn tại trong PostgreSQL — dùng `simple` như DD-92); §2.4 startup catch-up + queue-depth alert → check-item cho worker slice DD-89/90. Template BE: không cần ratify gì (ngược với FE/DD-99 P1); chỉ ghi nhận discipline "quantified optimization triggers" đáng áp tự nguyện. Không authorize code/runtime. |
| 07/08/2026 | v2.15 | **DD-98 +NP-5 (geo/location) + design-input §5 (vòng 2 sweep Phase-1).** NP-5 ratify điều research `sporta-fe-docs-gap` đã REJECT: radius filter/distance sort/lat-lng public/map picker mâu thuẫn DD-06 `area`-only public — muốn geo discovery phải reopen DD-06, không phải FE port. Design-input proposal thêm §5: bank-setup verify STK + auto-fill tên chủ TK (consumer settings_fe tab Ngân hàng, không đổi lifecycle), gate "chưa có bank" khi tạo kèo có giá (product rule chưa pin — cần owner), marketplace giữ search state khi back (client-local), candidate global search đa entity (đụng DD-47/48 → DD riêng nếu owner muốn). Dedup với DD-99 P2/P3/P4 và research gap doc (recent-searches ADAPT, FilterSheet count/sort GAP). Không đổi spec Reviewed nào; không authorize code/runtime. |
| 07/08/2026 | v2.14 | **Thêm DD-99 (🟡 FE spec hardening + player-facing FE backlog).** Nguồn: `../research/sporta-fe-docs-gap-2026-08-07.md` (đối chiếu 7 file Sporta FE với 12 file `docs/channels/web/FE/*_fe.md`). P1: 12 file FE đã nhận 4 section Draft (Analytics/State Machine/AC/Testing — add-only, không error code mới, analytics cấm amount/PII, client-local states đánh dấu tường minh) + vá GAP nhỏ (auth `AUTH_CANCELLED` client-local · marketplace search behavior/2-CTA/loading tách · sessions submitting/success surface fenced theo §6 · home checklist content · payments happy empty); đề xuất ratify bộ 4 section thành điều kiện FE Draft→Reviewed. P2 player session-detail/join/leave/waitlist FE spec (hard-dep gỡ mâu thuẫn header/§6 sessions_fe) · P3 security/account-management owner contract · P4 mark-paid/`cash\|waiver`/refund-on-cancel surface · OQ-DD99-1 breakpoint 768px → F0. Dedup tường minh với DD-96/97/98 + 2 proposals cùng ngày. Không đổi spec Reviewed nào; không authorize code/runtime/render. |
| 07/08/2026 | v2.13 | **Thêm DD-97 (🟡 collection statement/export) + DD-98 (🟡 negative scope Sporta port).** Nguồn: đối chiếu 5 FE docs payment Sporta (`../research/sporta-payment-fe-port-analysis-2026-08-07.md`). DD-97: bảng tổng kết thu per-session/kỳ + export PDF/XLSX — composition-only trên `charges`+`payment_allocations` (không bảng/formula tiền mới; DTO owner Reviewed bắt buộc, cùng họ blocker B3 DD-96), export async behavior-contract-only trên DD-89 foundation (không enablement), download authenticated tenant-scoped (HR2 — không public link), entitlement ⬜. DD-98 negative scope NP-1..4: custom split per player · timeout-hold release cho linked member · OS push kèm tiền/QR (mirror NTF) · auto-archive nợ theo tuổi. Kèm design input `../proposals/sporta-payment-ux-port-design-input-2026-08-07.md` (protected-pay UX · reminder-config UI · CBF countdown — toàn bộ non-authoritative, chờ surface owner) và enrich `feature_player_view_fe.md` v0.6 (partial progress presentation + settle-while-viewing edge; v0.5 cùng ngày là của session song song). Không đổi spec Reviewed nào; không authorize code/runtime. |
| 07/08/2026 | v2.12 | **Thêm DD-96 — Home money chips.** Part A ✅ `DECISION_FINAL` contract shape: canonical `SelfPaymentSummary` cross-club thuộc `player_view` (gap thật — `SelfPaymentStatus` là per-club, Home bị cấm tự cộng bởi `feature_home.md:26`, và `feature_home_tech.md:166` đã pin sẵn phải mở rộng Player View owner); **unknown-dominates** owner-ratified: một CLB `unknown` ⇒ cả chip `unknown`, cấm partial sum vì nó hiện số thấp hơn nợ thật; `clubCount` = số CLB có outstanding > 0; không `payAction` ở tầng aggregate; không migration/bảng/route mới. Part B ✅ direction / 🟡 mechanism: chip "Chưa thu" cross-club đảo HOME-OQ-1(c) của DD-79, nhưng **không được vào player_view** — DD-48 boundary + DTO allowlist `other charges ❌ NEVER`; cần host-self owner riêng, còn 4 blocker (B1 design-probe cross-tenant · B2 `authorizeTenantAction` merged `ddb69a9` nhưng 0 production caller ⇒ G3 FAIL · B3 chưa Reviewed owner nào sở hữu per-club host receivable, `feature_dashboard_fe.md` ghi "OWNER CONTRACT PENDING" · B4 fan-out N-tenant chưa pin timeout/suspended/role-revoke). Mirror player_view pair đã propagate (Product v2.8 + BE v2.9); mirror Home pair/FE/README/DD-79 còn nợ. Không authorize worktree/code/runtime. |
| 28/07/2026 | v2.11 | **Readiness mirror only:** exact Chat authority pack đã land `90d292d`; primary plan v1.8/analysis đạt `PLAN_READY`, closure 12/12. Không đổi DD semantics, dependency graph hay runtime. Ghi rõ B4/per-slice strict `CODE_READY` vẫn bắt buộc và chưa có migration/API/UI. |
| 28/07/2026 | v2.10 | **Primary Chat owner-final closure.** Giữ DD-86 Option B; Assistant mặc định true `all_members`/false `admins_only`, mutable trên cả hai policy qua exact `chat.channel.manage`. DD-91 giữ requester-only `/pay`; thêm DD-92 interaction/edit/delete/search, DD-93 exact slash catalog × surface, DD-94 generic coalesced digest và DD-95 club-only moderation. Final semantic freeze pin DD-56 `admin|co_admin` cùng least-privilege preset + cross-feature `tenant-capability-authority-core`, DD-95 storage trước shared send và canonical one-owner slice IDs. DD-88 hạ đúng thành broader `DEFERRED_PROPOSAL`, không sở hữu/chặn digest. Không authorize migration/runtime/code; current readiness chỉ lấy từ primary plan §13; DD-32 Option D v2.09 giữ nguyên. |
| 28/07/2026 | v2.09 | **DD-32 reopen → Option D.** Browse session không link; final paid booking linked Account→pay later, unlinked→verified pay-now trong hold 15 phút; free/full/approval timing, qualified Account predicate, occupancy active+hold, waitlist requeue-tail, over/under/late payment và provider fail-closed được pin. Tạo Product/BE funnel v1.0; sync DD-78/BL-DSC-1 với additive public `confirmed_count` + active/live-hold `slots_open`, không public hold count/identity. No runtime/code authorization. |
| 28/07/2026 | v2.08 | **Owner ratify decision closure batch.** DD-45a chốt partial unique waitlist-position cho promotion slice với duplicate preflight/HALT; DD-57/58/59 chốt FE architecture, Pencil-only design pipeline và token authority; DD-81 chốt target Energetic Orange + Sora/Inter nhưng giữ active Indigo/Outfit và FE HOLD tới visual/WCAG/track approval; DD-82/83/84/85 xoá proposal ambiguity và pin live/no-backfill, opaque slug, public-profile safety, exact collision/disambiguation. DD-86 → `DECISION_FINAL`, CHT-OQ-2 và primary Chat message/slash/no-digest floor đóng; DD-88 chốt guardrails và tách/defer feature extensions. `OPEN_QUESTIONS_IN_SCOPE: 0` cho decision batch; không authorize migration/runtime/code, full Chat initiative vẫn `NOT_PLAN_READY`. |
| 27/07/2026 | v2.07 | **DD-91 implementation-boundary correction (decision không đổi).** Safety authority có thể land song song với DD-86/Chat promotion; root chat chỉ owns final schema + pure read RLS adapters. Post-root shared core owns send/history/mark-read, DM lifecycle core owns create/reuse/block/report. `remainingAmount` chỉ được gọi mới từ `effectiveFee`; bốn production callers giữ nguyên. Mirror close stale Assistant OQ, exact block/report replay + no-purge chat retention và Notification no-snapshot/no-delete v1. Không authorize runtime/code. |
| 27/07/2026 | v2.06 | **Live-truth reconcile trên `main@2dc9b8c`, không đổi decision semantics.** DD-45 ghi đúng `0014_players_waitlist` đã merge nhưng SessionService/promotion worker vẫn absent. DD-80 ghi D0a/D0b/D1/Google/d1b đã merge qua `0015`–`0018`, Safari macOS+iOS M3 measured PASS, nhưng Google login chưa có enablement/go-live proof và email provider order 4 vẫn OFF/chưa build. DD-87 core đã merge tại `d2a27e1` nhưng chưa có production caller. DD-89/90 ghi đúng `0022`/`0023` + dispatcher/preflight/schedule đã implemented; schedule OFF, placeholder delivery, chưa producer/real projector/replay nên chưa `ENABLE_READY`. Các dòng changelog cũ giữ nguyên như historical snapshot. |
| 27/07/2026 | v2.05 | **DD-91 → ✅ chốt In-app Chat primary player surface.** `/pay` chạy deterministic ở club, private bot thread và human-DM command overlay; DM tenant-null dùng requester-only eligible-club picker, peer nhận zero bytes. Transport sync authenticated `no-store`, không result row/ref/SSE/outbox/push/history. Assistant giữ Host Pro exact key `assistant_ai_kb`; debt mention không vào ledger/LLM. Extract một `remainingAmount` primitive, `effectiveFee` giữ null rồi delegate. Primary-surface exit gồm durable payment Inbox reminder/settled/correction + generic Web Push/authenticated detail; DD-88 chỉ gate offline chat digest. Đồng thời sửa body DD-22 stale (`assistant`/pricing mở) và sequencing DD-86 thành safety contract → `chat_definer` → safety-authority migration → root chat migration. Decision/docs chưa authorize code/runtime. |
| 25/07/2026 | v2.04 | **DD-90 → ✅ chốt (đã sửa hai P1 của proposal).** Q4 = `job_audit_events` append-only, 1 row/claimed outbox event (`job_id=event_id`, tenant non-null), không nullable batch audit. Q5 = lane-specific `job_definer` NOLOGIN **BYPASSRLS** với exact grants + privileged pre-provision/attribute/membership assert; không dùng `RUNTIME_ROLES`, chỉ re-own `0022` + `claim_outbox_batch` tường minh sau `CREATE OR REPLACE`. `NOBYPASSRLS` bị loại vì `outbox_events` FORCE RLS và claim không có tenant GUC. Q6 = preflight pgboss/grants trước `boss.start()`, không phải `boss.work()`. DD vẫn chỉ `DECISION_FINAL`; hai slice chờ strict `CODE_READY`. Cùng reconcile pass sửa current-body DD-70/71/72 từ “proposal/chờ chốt” sang đúng trạng thái owner-final đã ghi ở v1.90/v1.91; không đổi semantics/runtime và không nhập DD-88 proposal vào core contract. **DD-81 canonical path được owner amend thành root `design.pen`; FE vẫn HOLD tới khi file được persist/track + nghiệm thu.** |
| 25/07/2026 | v2.03 | **Thêm DD-90 (🟡 proposal, chưa owner-ratified) — job-infra implementation contract.** Đóng 3 chỗ DD-89 **bắt buộc nhưng chưa nói bằng gì**, phát hiện khi verify DD-89 trên `main@2937ed9`; **không sửa DD-89**. **Q4** audit envelope của DD-89 Q1/TDD:494/B5 **chưa có sink**: 0 hit `job_id` trong `packages/db`, 3 bảng audit hiện có đều domain-specific, không spec nào đặt tên bảng job-audit; `claim_outbox_batch` (`0010`) vốn đã là privileged cross-tenant call **đang chạy không audit** — nợ có sẵn. Đề xuất tạo `job_audit_events` platform-plane append-only trong slice core + 3 negative chặn phình. **Q5** "owner non-login" **không có nền trên đĩa**: 0 `CREATE ROLE … NOLOGIN`, 0 `ALTER FUNCTION … OWNER TO`, cả 52 definer function ở 9 migration do migration role sở hữu; precedent duy nhất là spec chưa implement (`feature_inapp_chat_tech.md:221-238`). Đề xuất `plexco_definer` **NOBYPASSRLS** (chặt hơn `chat_definer` vì bảng đích không có RLS) + `GRANT … TO migration_role` (bẫy PG16 `:235`: owner mới cần CREATE trên schema) + **mở rộng `RUNTIME_ROLES`** (`migrate.ts:48`) vì role là cluster-global — không làm là tái sinh race `42710`/`23505` của Verdict 14 dưới `fileParallelism: true`; giữ 52 function cũ nguyên owner (inconsistency có chủ đích, slice re-own riêng). Pin bẫy: **`CREATE OR REPLACE` KHÔNG đổi owner**. **Q6** thứ tự provision→worker **chưa ai enforce** (`ALTER DEFAULT PRIVILEGES` chỉ áp cho object do chính role tạo; `QUEUES=[]` nên chưa từng chạy thật; test DD-89 yêu cầu chưa tồn tại) — đề xuất preflight fail-closed ở worker startup, thuộc slice 2. Ba câu độc lập, chốt riêng được. Không đổi scope/delivery order; `db-job-claim-lease-core` giữ `planned`. |
| 25/07/2026 | v2.02 | **DD-89 → ✅ chốt.** Q1 = narrow SECURITY DEFINER function, zero direct DML trên `projector_deliveries`/`surface_refs`; core chỉ delivery functions, `surface_refs` defer tới consumer đầu tiên. Q2 = controlled pg-boss provisioning exception: vendor-owned dynamic DDL/grants ở `provision-queue.ts` dưới migration credential sau app migrations/trước worker; runtime giữ `migrate:false`, no worker DDL/ownership. DD vẫn chỉ `DECISION_FINAL`; slice chờ strict `CODE_READY`. Sửa README nhầm `surface_refs` là tenant-private. |
| 24/07/2026 | v2.01 | **DD-88 contract correction cho §7.** Tách baseline `read-all` toàn inbox khỏi scoped mark-all/bulk selected: endpoint/receipt hiện có chỉ full two-plane visible set; scoped/bulk là slice API + receipt migration mới, canonical filter/ref fingerprint, server boundary/re-auth, all-or-nothing, opaque `404`/replay-mismatch `409`. `chat_members.last_read_at` là target contract, chưa runtime. |
| 24/07/2026 | v2.00 | **Initial DD-88 §7 draft, superseded by v2.01.** Lần đầu thêm highlight/unread/mark-read nhưng đã suy diễn nhầm scoped/bulk từ read-all toàn inbox; không dùng làm authority cho code. |
| 24/07/2026 | v1.99 | **Thêm DD-88 (🟡 proposal, chưa owner-ratified) — notification group taxonomy + proposed notification extensions.** Mở rộng DD-70 (KHÔNG thay): group là view derive từ `type`; session types chỉ là candidate tenant extension; `message_request` chỉ là candidate global extension, opaque source-reference/read-time render; chat digest là delivery-only, không tự tạo inbox type/item. Preference canonical per-Person, per-type/kênh áp cả hai plane; announcement per-membership chỉ là audience exclusion cần pin precedence. Thanh toán + Bảo mật schema-enforced mandatory. Analysis: `../proposals/notification-grouping.md`. `NOT_PLAN_READY`; không migration/runtime. |
| 22/07/2026 | v1.98 | **DD-87 → ✅ CHỐT (owner “update hết”).** Thay proposal boolean `ambiguous` bằng exhaustive tagged union: enumerate mọi positive trailing run qua `parseMoney`, dedupe theo `(name,amount)`, order shortest→longest; 0=`none`, 1=`resolved`, ≥2=`ambiguous{candidates}`. Ambiguous không có top-level name/amount, nên caller buộc narrow; `Player 0 110k` pin equal-amount/different-name vẫn ambiguous. Loại grouped-grammar/longest/threshold/fuzzy. Live worktree cũ không prunable và không là dependency. Runtime chưa đổi; code vẫn chờ authority packet commit/push + strict CODE_READY re-pin. |
| 22/07/2026 | v1.97 | **Thêm DD-87 (🟡 proposal, chưa owner-ratified) — decision table `splitNameAmount`.** Gỡ blocker slice `core-matcher-grouped-amount-parsing` (park 3 lần). Verify on-disk sửa lại chẩn đoán của backlog: bảng S2 **có tồn tại** nhưng untracked/`.gitignore`-chặn trong worktree `prunable`, **và không bảng nào có hàng cho `splitNameAmount`** ⇒ blocker thật là bảng chưa từng được viết. Đo 16 ca: ngoài `Wang 110 500` còn **`Wang 1 500 000` → mất 1.000.000₫**, `Wang 110 050`, `Wang 110 500k`; ca `110 000` chạy đúng chỉ vì `parseMoney("000")===0` falsy. Chứng minh `Wang 110 500` và `Player 2 110k` cùng token shape ⇒ **không luật cú pháp thuần nào giải cả hai** (shortest hỏng nhóm đầu, longest **thổi tiền** 19×, grouped-grammar không tách được) ⇒ là quyết định chính sách, không phải patch. Đề xuất (c): shortest-run + cờ `ambiguous`, money path cấm auto-settle khi ambiguous. Không migration/runtime; không authorize code. |
| 22/07/2026 | v1.96 | **Thêm DD-86 (🟡 proposal, chưa owner-ratified).** Đề xuất Option B cho in-app multi-channel: N club channel/tenant, club-only metadata + DM-NULL shape, exact-one active default với tenant-lock lifecycle, atomic auto-provision, authz qua DD-56 capability registry, Assistant = channel flag AND tenant config/entitlement/provider/privacy gates, announcements giữ DD-71 storage riêng. Pin sequence root `dd38-dd86-chat-schema-core` trước consumer slices; Q5 deferred out-of-scope, còn 9 blocker in-scope. Live repo chưa có `chat_*`; verdict `NOT_PLAN_READY`; không migration/runtime. |
| 21/07/2026 | v1.95 | **DD-85 → ✅ CHỐT hướng (owner 2026-07-21) — đóng nốt nhóm B.** Rule "collision-aware display", disambiguator mặc định = **`pay_code`**. Owner thêm direction bộ field hồ sơ user/player: `display_name`+`id`+**`avatar`(ảnh nhỏ, field MỚI)**+**`gender`**+thông tin cần thiết khác. Reconcile hard-rule: `gender` giữ DD-39/54 (PII/consent/**không public**); `avatar` field mới lưu object-store private-to-origin (DD-78), **default hiển thị host-facing phase-1**, public để **opt-in** sau (default bảo thủ do câu hỏi visibility bị ngắt — owner có thể lật, lật public thì cần child-safety review); disambiguator chỉ host/authenticated, không PII/avatar ra public ngoài phạm vi DD-84/DD-48. Avatar-public = open item feed DD-84/DD-48/DD-78. Build chờ: avatar migration/storage + gender surfacing + chuẩn-hoá tên/ngưỡng trùng + host-add-member spec + readiness gate. Không migration/runtime. |
| 21/07/2026 | v1.94 | **DD-84 → ✅ CHỐT hướng (owner 2026-07-21).** Player profile **default-public** phase-1 (đảo DD-74): field-split — default-public an toàn (handle tự chọn/tombstone + môn + karma + kudos + tổng buổi); **activity history mặc định LÀM MỜ** (coarsened, không venue+time cụ thể, không co-participant), player tự bật chi tiết; **trẻ vị thành niên ép off** chi tiết. Handle không auto-derive tên thật. DD-74 nhận cross-ref 🔄. **Build gated (hard):** child-safety review + cập nhật HANDOFF HR2 wording + consent state + minor detection + readiness gate; đọc qua guarded public read model. Không migration/runtime. |
| 21/07/2026 | v1.93 | **DD-83 → ✅ CHỐT hướng (owner 2026-07-21).** Session URL = **opaque slug** (đóng open point raw-UUID vs slug theo default), thay wording `/s/<id>` của DD-73. Thống nhất 4 loại `/user/<handle>·/club/<slug>·/session/<slug>·/tournament/<slug>` dùng chung registry mở rộng DD-75: rename→tombstone, reserved words, guarded-view-only, không lộ `tenant_id`/PII. DD-73/75 nhận cross-ref 🔄. Build chờ định nghĩa handle uniqueness (global) + reserved-word list + collision policy + readiness gate; phụ thuộc DD-12. Không migration/runtime. |
| 21/07/2026 | v1.92 | **DD-82 → ✅ CHỐT hướng (owner 2026-07-21).** Tournament = **aggregate độc lập** (xác nhận direction 20/07): không gom session, không tái dùng `sessions`/`players`; canonical `tournaments` tenant-scoped + RLS + bảng đăng ký riêng + `public_tournaments` read model (field-whitelist, không tiền/PII, không serialize `tenant_id`) cho URL share DD-83. **Retire `session_type='tournament'`** ⇒ amend DD-41 (cross-ref 🔄) + **cần migration/backfill** (không "no breakage"). v1 gọn; bracket/standings/entry-fee (money model riêng) = slice sau. Build chờ analysis doc + spec pair (Product/BE) + readiness gate riêng; feature index thêm `feature_tournament`. Không migration/runtime hiện tại. |
| 21/07/2026 | v1.91 | **DD-71 + DD-72 → ✅ CHỐT (owner 2026-07-21) — đóng nốt nhóm A notification.** **DD-71:** announce cơ bản **FREE mọi tier** (thủ công, khớp DD-40); `host_pro` thêm scheduling/recurring/template/analytics/quota; free vẫn có rate-limit actor + fan-out budget + quiet-hours + opt-out; **preview→confirm bắt buộc** proof-bound consume-once (cơ sở "không undo", KHÔNG phải DD-25). **DD-72:** schema `device_push_subscriptions` phase-1 **chỉ web** (global protected/Person, endpoint+keys mã hoá, HMAC lookup, trust epoch server-only; native chờ DD-69 phase-2); **provider = Web Push VAPID trực tiếp**, không vendor SDK phase-1; **payload OS generic** (opaque ref + i18n_key), không tenant/tiền/PII/tên CLB, `buildPushPayload()` choke-point + CI invariant. Cả hai: migration/DDL + `manifest.json`/SW (S9) chờ build; cụm `feature_notifications_reminders` giờ đủ điều kiện đóng §B/C/D sau DD-70/71/72. Không migration/runtime. |
| 21/07/2026 | v1.90 | **DD-70 → ✅ CHỐT hướng (a) (owner 2026-07-21).** Notification = năng lực **toàn Plexco**, không giới hạn theo tenant: mọi user có **một inbox hợp nhất xuyên club** + **user config chọn loại nhận** (per-type opt-in/opt-out + theo kênh). **Interpretation giữ HR2/RLS (owner đính chính nếu sai):** "global" = trải nghiệm/inbox hợp nhất + plane global-protected cho event person-directed; **giữ HAI plane** — tenant durable `notification_intents` (RLS, thông báo trong-club) + global protected `person_notifications` (follow/identity/security cross-club) — merge ở service layer, **KHÔNG** gộp một bảng bỏ `tenant_id` (tránh rò HR2 + mất RLS). Thêm `notification_preferences` theo Person (loại + kênh), áp cả hai plane, fail-safe default. Bỏ hẳn tenant plane = quyết riêng, hiện không chọn. Schema/preferences chi tiết + attempt-ledger chờ build; DD-71/72 vẫn 🟡. Không migration/runtime. |
| 21/07/2026 | v1.89 | **Thêm DD-85 (🟡 đề xuất, session 2026-07-21 — không gate build).** Disambiguation tên hiển thị trùng ở tầng UI/con người. Live truth: không có display-name cấp session (roster resolve từ `memberships.display_name`, nullable/non-unique — chủ ý); identity nội bộ an toàn (key `membership_id`/`person_id`/`pay_code`, không theo tên); rủi ro human-facing chưa chặn ở (a) render roster hai "Minh" giống hệt, (b) host add-player (luồng + member-picker **chưa build**). Đề xuất: khi `display_name` chuẩn-hoá trùng trong cùng tenant, mọi surface con người đọc/chọn kèm disambiguator (`pay_code` DD-02 và/hoặc avatar/ngày-join); host-add cảnh báo khi trùng; chỉ host/authenticated, không public/PII (HR2); phone không dùng (DD-50). Không auto-suffix/auto-merge theo tên. Cross-ref identity-model · DD-02/26/50/52/56. Chưa migration/runtime; cần readiness gate + owner.|
| 20/07/2026 | v1.88 | **DD-80 Gate 3 revoke-all concurrency → ✅ CHỐT (owner-authorized fix 2026-07-20).** Chọn account-level `session_epoch bigint` + `web_sessions.minted_epoch bigint`; session chỉ resolve khi `minted_epoch = session_epoch` (không dùng `>=`, future/corrupt epoch fail-closed). `auth_create_web_session` khóa target account rồi stamp exact epoch. `auth_rotate_web_session` read-only resolve old candidate, khóa tập parent `{old_account,target_account}` theo UUID tăng dần, re-lock/revalidate old session rồi revoke old + mint target ở exact target epoch; giữ cross-account binding hiện hành. Logout-all derive account từ live current token, khóa parent, revalidate token dưới lock, atomic bump epoch, bulk-set `revoked_at` cho **mọi** row `revoked_at IS NULL` của account (kể cả epoch corrupt/future), trả exact count và ghi audit `session_epoch_before`/`session_epoch_after`/count cùng transaction; epoch là validity authority, per-row revoke là single-revoke/audit/rollback materialization. Resolve reuse JOIN `accounts` hiện hữu, không thêm subquery/cache. Migration D0a dùng một monotonic `0015` transaction (columns/checks/backfill-default 0 + index + function replacements + helper/wrapper/audit mirror); D0b web boundary phụ thuộc D0a và chứa issuance fence/route mapping. D1 tiếp tục hoãn tới D0a+D0b merge. Không runtime ở commit authority này. |
| 19/07/2026 | v1.87 | **DD-80 — AP-27 D0 packet closure + Gate 3 → concurrency design-probe (owner 2026-07-19).** AP-27 `docs-auth-d0-packet` = **design-complete, KHÔNG code-ready** (8 codex rounds, 3 breaker resolved bằng founder auth ghi trong packet vì `.autopilot/state/` gitignored). Packet (`docs/auth/auth-d0-implementation-packet.md`, 1133 dòng, docs-only, dry-run merge conflict-free) merge lên main làm **design record**; **KHÔNG** authorize D0 build. **3 gate chặn `auth-s4-d0-revoke-core` = CODE_READY:** G1 amend manifest scope (+6 file thiếu) + negative_scope (tự mâu thuẫn caller) theo §A3.1; G2 re-issue Verdict 3 PASS (đang stale); **G3 (mới, round-07) — rotation race trong `auth_revoke_all_web_sessions`**: concurrent login/rotate commit xong trong cửa sổ read của logout-all → session sống sót, không authority nào phủ. **Owner quyết: mở CONCURRENCY DESIGN-PROBE riêng (kiểu B0) cho revoke-all — KHÔNG vá inline** (bằng chứng: REGION_THRASH §A1/D0 qua **cả AP-26 lẫn AP-27**; AP-27 dù re-slice vẫn phình 16 file/8 round/3 breaker = mô hình concurrency under-specified ở tầng design, vá từng finding không hội tụ). **Hypothesis khởi điểm cho probe (chưa phải fix chốt):** biến logout-all từ read-then-delete-rows (bản chất race với insert đồng thời) thành **linearizable watermark** — account-level epoch/`sessions_valid_after`, logout-all = 1 atomic bump, session resolution check `session.epoch ≥ account.epoch`; probe verify với live schema/`issueSession`/`auth_revoke_all_web_sessions` + đánh giá luôn D0 có cần decompose thêm không. **D1 (AP-28) HOÃN** tới khi G3 chốt (D1 lift §C từ D0; G3 đổi contract D0 → D1 sẽ stale). Round-08 HALT-AUTHORITY_AMBIGUOUS-vs-completion: resolved = design-complete-not-code-ready, G3 nay là open probe được ghi chính thức (không còn ambiguity ẩn). Nối tiếp v1.86 (F1 issuance fence là em sinh đôi của G3). Không runtime, không đổi phase. |
| 20/07/2026 | v1.87 | **Thêm DD-82/83/84 (🟡 đề xuất, owner direction 2026-07-20 — feature share/URL unique) — chưa qua readiness gate, không gate build hiện tại.** DD-82 tournament = aggregate độc lập (không gom session, v1 gọn info+đăng ký+URL; retire `session_type='tournament'` ⇒ amend DD-41 + backfill). DD-83 URL scheme thống nhất `/user·/club·/session·/tournament` + slug/handle registry chung mở rộng DD-75 (tombstone-on-rename, guarded-view-only, không lộ tenant_id; session opaque-slug khuyến nghị thay `/s/<id>` DD-73 — raw-id vs slug vẫn open, default slug). DD-84 player profile default-public phase-1 (đảo DD-74): field-split, activity history mặc định làm mờ + player config chi tiết, trẻ vị thành niên ép off; cần cập nhật HR2 wording + child-safety review. Cross-ref 🔄 vào DD-41/73/74/75. Chưa migration/runtime. |
| 19/07/2026 | v1.86 | **DD-80 defect fix v4 (owner 2026-07-19, từ AP-26 HALT MAX_ROUNDS/Codex round-03) — 3 pins:** (1) **§A1 issuance fence = reject-and-reauth:** `issueSession()` khi rotate trả null (cookie đã bị logout-all revoke) **KHÔNG mint session mới** — trả `AUTH_INVALID` buộc re-login; giữ nguyên nghĩa đen D0-7 "logout-all thắng / không token nào còn resolve"; thêm function `session-cookies.ts` liên quan vào scope D0. (2) **§B2 AAD handoff = preallocated `account_emails.id`:** app sinh UUID trước INSERT và truyền vào finalizer `auth_login_google` — giữ nguyên AAD contract B0 §3.3 (id trong AAD chống cut-and-paste ciphertext), sửa mâu thuẫn thứ tự với §4; cells 2/3/5 không đổi. (3) **Pin index `web_sessions(account_id)` vào migration `0015`** (expand-only) — revoke-all không full-table scan dưới parent lock. **Re-slice direction (owner):** KHÔNG reset round budget (giữ luật sentinel v3 "not clean sau round 5 ⇒ re-slice, không grind"); tách monolith 995 dòng thành `docs-auth-d0-packet` (A1–A3) + `docs-auth-d1-packet` (B1–B3, §C lift verbatim) từ main mới sau khi 3 pins này transcribed vào B0/packet; branch packet hiện tại = read-only reference (theo sentinel HALT-MAX_ROUNDS resume plan). *Ghi chú bookkeeping: changelog có 2 dòng v1.83 khác nhau (DD-79 nav v3 + DD-80 defect v2) do 2 flow sửa song song cùng ngày — giữ nguyên cả hai, không renumber; version hiện hành = v1.86.* |
| 19/07/2026 | v1.85 | **DD-80 defect fix v3 (owner 2026-07-19, từ AP-26 HALT v3/Codex round-02).** (1) OAuth expiry-cleanup: "NULLed immediately" cho expired-unconsumed = tại sweep đầu tiên sau expiry; D1 dùng sweep-at-traffic trong narrow functions; job `auth-email-cleanup` (order-4) mở rộng sweep `auth_oauth_transactions` khi land — không scheduled sweep riêng, không block Google login theo infra job; cửa sổ order-3→4 chấp nhận với mitigation zero-grant + fail-closed + KMS. (2) Audit lane Google: per-lane finalizer — `auth_login_google` ghi `login_success` (cell 1–6) + `identity_conflict` (cell 7) cùng transaction; `login_failed` cho proof-fail pre-DB defer có chủ đích (rate-limit + generic reject đã phủ); §8.3 amend, không thêm writer grant mới. B0 §3.2#6/§4.1/§8.3 đồng bộ. Không đổi product decision; no runtime. |
| 19/07/2026 | v1.84 | **DD-79 nav clarify (owner):** Club tab = cả CLB tạo/sở hữu + CLB tham gia (một contract memberships person-self, phân nhóm theo role; context theo quyền) + CTA Tạo CLB → onboarding. feature_home v0.5a. |
| 19/07/2026 | v1.83 | **DD-79 amendment nav v3 (owner):** bottom nav **5 slot Home · Feed · [Khám phá FAB giữa] · Club · Setting**; tab **Club** = `/me/clubs` person-self → club context (composition-only); **Chat lên header 💬 cạnh 🔔** (inapp_chat DD-38, không chiếm tab). Feed vẫn config-OFF tới DD-76 → phase-1 render 4. Spec: feature_home v0.5. |
| 19/07/2026 | v1.83 | **DD-80 defect fix v2 (owner 2026-07-19, từ AP-26 HALT v2/Codex round-01).** (1) Live `auth_rotate_web_session` lock session→accounts ngược parent-first §5.2 ⇒ deadlock thật với revoke-by-account: migration D0 CREATE OR REPLACE rotate parent-first, giữ nguyên signature/behavior; rollback = DROP mới + restore định nghĩa 0012. (2) `auth_audit_events` append-only (shape §8.3) tạo tại D0; `logout_all` audit cùng transaction từ D0; order-2 email-token-core reuse/extend, không bảng audit song song. (3) Scope D0 thêm `packages/db/src/index.ts` (một dòng export `revokeAllWebSessions`). B0 §6/§8.3/§10 + tech v2.9a (D0-11) + manifest D0 + verdicts v0.5 đồng bộ. Không đổi product decision; no runtime. |
| 19/07/2026 | v1.82 | **DD-79 amendment final (owner):** gộp "Kèo của tôi" vào Home (sub-screen từ Tất cả →/chip Còn nợ) — nav còn **4 slot: Home · [Khám phá FAB] · Feed (OFF tới DD-76) · Setting**, phase-1 render 3 tab. Registry config-driven không đổi. Spec: feature_home v0.4. |
| 19/07/2026 | v1.81 | **DD-79 amendment label fix (owner):** tab 2 = **"Kèo của tôi"** (person-self, lịch + tiền) · tab 3 center = **"Khám phá"** (tìm & join marketplace) — đổi label để hết nhầm 2 vai trò; cấu trúc/gate không đổi. |
| 19/07/2026 | v1.80 | **DD-79 amendment (owner) — bottom nav PWA:** 5 slot Home · Session · [Discover center/FAB] · Feed · Setting; registry config-driven 1 chỗ (user-customize defer); **Feed slot config-OFF tới DD-76 clear** (không tab chết); phase-1 render 4 tab. Nav = shell contract, không API/bảng mới. Spec: feature_home v0.3. |
| 19/07/2026 | v1.79 | **DD-81 → ✅ CHỐT (owner 2026-07-19) — design tool = Pencil.** File `plexco-app-design.pen` tại root repo, git-tracked; variables khớp SoT `design-tokens.md` khi tạo (DD-59 giữ nguyên, SSOT-flip là quyết định riêng); canvas theo design-system-playbook; hue/font ⬜ chốt qua theme exploration trên màn Home (hero recipe §7). DD-58 visual-source unblock khi file tạo. Designer bắt đầu taste pass được ngay; không runtime. |
| 19/07/2026 | v1.78 | **DD-80 defect fix + slice-artifact corrections (owner 2026-07-19, từ AP-26 `HALT-AUTHORITY_AMBIGUOUS`).** (1) `auth_oauth_transactions` thay CHECK NOT-NULL-vĩnh-viễn (tự mâu thuẫn với NULL-on-consume đã pin cùng nguồn) bằng `terminal_at` + lifecycle CHECK đúng pattern `auth_email_deliveries`: ciphertext/key-version NOT NULL chỉ khi chưa terminal; consume/expiry-cleanup terminalize + NULL trong cùng transaction; metadata 30d. B0 §4.1 + web_auth tech v2.8a đồng bộ. (2) Acceptance D1-15 → absence-check: D1 không tạo route Facebook; `AUTH_PROVIDER_UNAVAILABLE` thuộc slice DD-33. (3) Bổ sung manifest order-2 `auth-s4-d1-email-token-core` (dark, đúng §10); D1-google `depends_on` [D0, email-token-core], oauth migration dời 0016→0017. Không đổi product decision/§10 order; no runtime. |
| 19/07/2026 | v1.77 | **DD-80 → ✅ CHỐT (owner 2026-07-19) — B0 auth credential lifecycle design-ready.** Owner duyệt cả 6 mục probe: §3 provider-neutral email owner (`account_emails`); §3.2 multi-attempt verify-first, không last-writer-wins; §4 Google collision table (verified email = strong proof, conflict → DD-53, không auto-merge/silent rebind); §5 token 256-bit hash-at-rest + TTL/retention + protected outbox→pg-boss delivery; §8 password 15–128 + Argon2id floor 19456/2/1 + dual-bucket rate limits; §10 slice order D0 revoke-core → D1 core/Google/email-bundle (một release unit, flag OFF) → Telegram removal. B0 gate đóng ở mức **design-ready**: chưa author D1 migration/DDL, chưa code-ready, email provider fail-closed OFF; bước kế = propagate Product/BE + author D0/D1 slice artifacts rồi re-run closure matrix. Nguồn: `../probes/b0-auth-credential-lifecycle-design-probe.md`. |
| 19/07/2026 | v1.76 | **DD-79 → ✅ CHỐT (owner 2026-07-19)** — Home personal dashboard PWA, chấp nhận defaults: composition-only (không bảng/API mới ngoài aggregate person-self thuộc `/api/me*` surface), landing S9, HOME-OQ-1 (c) defer host-receivable, OQ-3 defer streak. Spec pair → Reviewed contract: Product v0.2 + BE `feature_home_tech.md` v0.1 (composition read, no-migration; suggested qua public read model HR2). Implementation pending S9; không đổi code-readiness. |
| 19/07/2026 | v1.75 | **Thêm DD-79 (🟡 đề xuất, không gate build) — Home personal dashboard PWA fork từ Sporta.** Composition surface trên player_view/marketplace/notifications §A/onboarding_steps — không bảng/API mới ngoài aggregate DTO person-self; phase đề xuất S9. 3 OQ kèm default: HOME-OQ-1 host receivable cross-tenant (defer), OQ-2 landing (yes), OQ-3 streak (defer). Spec: `../features/FE/feature_home.md` v0.1 Draft (features index v2.36). |
| 19/07/2026 | v1.74 | **Notification final implementability closure; DD-70/71/72 vẫn 🟡, no runtime.** Announcement retry now receipts the exact nonempty planned physical-attempt set; tag retirement is locked/rechecked before fan-out. Push trust issuance is structurally bound to immutable actor/scope/evidence with an exactly-once completion guard; rebind prune may NULL only live pointers; evidence ingestion cannot lose unknown reconciliation. Logical sent cancels unstarted retry/recovery work while preserving already-started possible writes, and delivered/opened latency is DB-required/server-derived. Product/BE remain v3.4g Draft. |
| 19/07/2026 | v1.73 | **DD-50 auth/identity lock-order closure; no runtime.** `link_code` consume now read-only resolves its candidate, locks canonical issuer/account + current Person parent before the code row, then revalidates terminal/action/hash and conditionally accounts/consumes. This removes the code-first inversion against password-reset revoke/cancel and requires barrier regressions for reset-vs-consume/merge. Identity Product/BE advance to v1.10; B0 remains a design probe pending owner. |
| 19/07/2026 | v1.72 | **DD-45a live-test truth correction; no runtime change.** `0014` currently permits duplicate waitlist positions and the invariant test explicitly pins equal `(position,joined_at)` rows as representable with `id` tie-break. Future partial UNIQUE remains the recommended promotion-slice hardening, but now correctly requires a monotonic migration plus replacement of that permissive fixture/test; it is not an unpinned behavior. |
| 19/07/2026 | v1.71 | **Notification post-fence snapshot closure; DD-70/71/72 vẫn 🟡, no runtime.** Mark-all and announcement fan-out now perform read-only discovery outside the mutation transaction, then use bounded READ COMMITTED to acquire all Person fences before the first authoritative snapshot/revalidation and lock visibility/audience/tag/membership/preference/route owners through commit. This removes stale pre-fence snapshots that could miss a just-committed item or send to a just-left/opted-out/retired-tag recipient. Product/BE advance to v3.4g Draft. |
| 19/07/2026 | v1.70 | **DD-70/72 propagation + rebind-authority correction; no runtime.** Known global producers may not fall back to tenant outbox: link-code consumption emits nothing and merge commit appends from locked audit under the fence-first hierarchy, otherwise build halts. Cross-Person push rebind now requires exact verified prior-owner reauth/approval or audited manual recovery; canonical Person merge remains a distinct re-parent/reset path that invalidates pending rebind challenges. Product/BE advance to v3.4f Draft. |
| 19/07/2026 | v1.69 | **Notification route/attempt/proof closure; DD-70/71/72 vẫn 🟡, no runtime.** Delivery history/key now bind closed `route_class`; multi-target attempts have due planned rows, target-vs-intent-vs-defer pre-send decisions, possible-write precedence and sticky evidence-bound unknown. Broad core DML is revoked; start returns exact-target authorization before secret resolve/stale mutation. Announcement preview proof is exact-only, quota/retry receipts are structurally bound, retry expires at 24h, and tags are bounded soft-retired pending retention. Push device cap, proof issuers, rebind live-pointer transfer and lifecycle clocks are explicit. Product/BE advance to v3.4d Draft. |
| 19/07/2026 | v1.68 | **Join/invite restriction-idempotency + retry-liveness closure; no runtime.** DD-05/44/52 resolve current `active|waitlisted|pending` before restriction preflight; absent/left invite/open/request paths re-check DD-41/DD-42/shared DD-52, and token use increments only with a new successful state transition. Active fills resolve old promotion roots. DD-45 root is lazy-created only on first failure; budget is max 3 claimed attempts, not guaranteed completed sweeps. An expired final claim is finalized under `session→job`: resolve if no longer applicable, otherwise terminal+owner-review/DLQ, with no derivation/fourth attempt. Candidate events stay per-entry audit; owner-facing alert/digest dedupes per `promotion_retry_id`. |
| 19/07/2026 | v1.67 | **DD-45 retry lock-order + capacity-epoch closure; no runtime.** Pin one domain lock order `session→root job→candidate/finance`; CAS claim is short job-only and worker reacquires session first before validating token/lease. Partial unique allows one nonterminal root/session. New capacity opener supersedes old roots; any path that fills capacity and close/start/cancel resolve them. Stale claimed worker fails generation/token fence. This removes session↔job deadlock and prevents old roots from sweeping a later opening. Add direct-join-fill→new-opener and lock-order regressions. |
| 19/07/2026 | v1.66 | **DD-70/72 final owner-and-lifecycle closure; no runtime.** DD-70 phase-1 excludes analytics-only `follow_accepted`; private→public bulk auto-accept has no notification fan-out. Known global producers must use bounded read-only inventory → fences → canonical source/audit → same-transaction item; `link_code` consume emits nothing and merge commit owns `identity_merged`. Tenant `outbox_events(tenant_id NOT NULL)` is forbidden as a global fallback; any future deferred global source needs its own protected owner/grants/replay/retention decision. DD-72 cross-Person rebind is proof-bound delete-old/insert-new UUID transfer, not owner UPDATE; proof binds both owners, target/aliases, epoch, command and evidence. Lifecycle clocks are DB-owned, prune age is exact, and advisory-key mapping is deployment-stable/dual-locked on rotation. Product/BE advance to v3.4c Draft. |
| 19/07/2026 | v1.65 | **DD-45 retry ownership/order/manual-ban closure; no runtime.** One root retry job per `(tenant,session,origin_command)` owns max 3 CAS/lease full sweeps; candidate failure events are sibling audit/alert dedupe rows referencing that job, never separate budgets. Every sweep re-enters current total order, tries each candidate at most once and re-checks DD-41/DD-42/shared DD-52. Opener/sweep resolves the job when capacity fills or no retryable failure remains; only open-capacity+remaining-failure stays due. CAS returns a claim token/generation; domain tx verifies exact token + live lease before selector/mutation/final transition, so expired claimant cannot resume after reclaim. Thus deprioritize/ban cannot be bypassed, N events cannot multiply attempts N×N, and stale old roots/workers cannot mutate a later opening. Add reorder, ban, sibling-event/final-slot, lease-expiry and two-worker regressions; blockers unchanged. |
| 19/07/2026 | v1.64 | **DD-73..78 sequencing/scope correction; no runtime.** Gỡ vòng lặp “DD-74/75 sau evidence gate nhưng gate cần baseline DD-74/75”: DD-73 acquisition trước; DD-74/75 sau dependency + reprioritization để tạo activity baseline; chỉ DD-76/77 hard-gated bởi liquidity; DD-78 đi cùng consumer. Q1 phase-1 no-attribution nay loại target/function/flag consent chưa dùng khỏi schema phase-1, chỉ thêm additive khi bật. DD-12 grant wording phân biệt live `readonly` base grant với target cutover guarded-view-only. Kudos add/list bắt buộc guarded visibility/fence, own-remove cleanup vẫn được; reaction cleanup trước card deletion. **DD-70 dependency corrected:** it gates optional durable activity/kudos notifications, not DD-76 feed core or DD-77 kudos core. |
| 19/07/2026 | v1.63 | **Notification replay/identity-history closure (DD-70/71/72 vẫn 🟡; no runtime).** DD-70 route provenance now binds factor establishment to immutable triggering-context start, not merely event time; all inbox emit/merge paths use fence-first ordering and read-all command collisions halt. DD-72 distinguishes the external idempotency command from envelope/proof JTI replay fences; serializes absent-row races; DB-binds registration/trust live pointers to the same Person and immutable historical refs; exact consumed proof replay is historical-only. Person merge never re-points an audit pointer to another UUID, resets every re-parented subscription, and halts receipt-key collisions. Ordinary stale/revoked secret-row prune precedes longer-lived replay/audit ledgers under explicit retention gates. Product/BE remain v3.4b Draft pending owner/migration. |
| 19/07/2026 | v1.62 | **DD-45 retry-consumer + money-mirror integrity closure; không thêm runtime.** Failure event pin literal `origin_command_id` + `waitlist_entry_version`; retry unique theo `failure_event_id` dùng CAS one-owner state machine `due→claimed→resolved\|due(backoff)\|terminal`, atomic claim count max 3, expiring lease/crash recovery và consume-time re-check session/capacity/candidate entry/DD-41/DD-42/live financial state. Stale/closed/full/ineligible resolve no-op; conflict/exhaustion→owner-review/DLQ; retry không tạo origin event mới. Refunded rejoin chỉ append lifecycle khi outcome active; full→waitlisted defer. Current branch HEAD `aa8afae`; executable `0014` payload vẫn provenance `1a6ac38`, chưa merge `main@22c23aa`; queue-entry-version/retry store/worker/consumer vẫn chưa build. |
| 19/07/2026 | v1.61 | **Notification implementation-closure pass (DD-70/71/72 vẫn 🟡; no runtime).** Pin owner-derived global emit + structural source-event/read-state fences; durable announcement quota reservation and deterministic per-intent retry-route receipt; required push Idempotency-Key/JTI receipt, consume-once rebind proof, trust epoch/evidence fence, serialized HMAC key epoch; worker attempt claim/start/finalize grants with `send_started_at` linearization; telemetry canonical `[attempt_ref,event]`; Person-merge collisions and secret-prune-safe historical refs. Product/BE remain v3.4a Draft pending owner/migration. |
| 19/07/2026 | v1.60 | **DD-73..78 → ✅ CHỐT (owner 2026-07-19) — 6 quyết định + re-scope build.** Q1 **(a)**: phase-1 **không gắn tên CLB** lên card cá nhân; dual-consent giữ làm đích đến, bật sau bằng đường additive (ở phase-1 nó cho ra cùng hành vi nhưng tốn 2 setting/2 UI). Q2 **(a)**: activity tạo ra là `draft`, user chọn `followers|public` khi publish; **không** auto-publish kể cả opt-in. Q3 **(a)**: ship **kudos**, **defer comment** tới khi có DD-55 stack + OQ moderation global-plane mới. Q4 **(a)**: **amend DD-64** accept-in-principle cho self-aggregate; exact field chốt tại build cùng DD-61/62. Q5 **(a) + re-scope**: *safety fence + guarded view + narrow functions + `public_projection_version` + grant migration* **chuyển về DD-12/marketplace** (marketplace đang thiếu đường deny tức thì, cần dù không có share); DD-73 đúng nghĩa = route + OG card + funnel telemetry. Q6 **(a)**: **template-only, không upload phase-1**. Sequencing wording của entry này được corrected ở v1.64. Không migration, không đổi code-readiness. Brief nguồn: `../decisions/briefs/founder-decision-brief-2026-07-19-share-activity.md`. |
| 19/07/2026 | v1.59 | **Safety-fence + surface correctness cho DD-73/75/78 (vẫn 🟡) — 4 defect, không đổi quyết định sản phẩm.** (1) **`activity_card×session` không được raise theo `closed`/`private`**, chỉ theo `cancelled`/xoá: `closed` là kết thúc bình thường và chính là nguồn eligible của DD-74, nên bản v1.56 như viết sẽ **revoke card của mọi player ngay khi host đóng kèo**. (2) **DD-73 có blocker thứ hai chưa được liệt kê: DD-41 projection migration** — whitelist BL-DSC-1 (`title`/`session_type`/`level_*`/`gender_restriction`/`age_*`, bỏ `skill_level`) **chưa tồn tại trong `public_sessions`** (`0006:11-27`), nên guarded view không thể phục vụ đủ field và cám dỗ sửa sai là đúng thứ DD-73 cấm (đọc `sessions`); trước migration chỉ render tập con field thực có. (3) **`public_projection_version` được khai báo là ngoại lệ cột hợp lệ** trong guarded view — trước đó DD-78 bắt buộc dùng nó nhưng DD-73 lại định nghĩa view chỉ gồm cột `public_sessions`, tức gate của DD-78 không implement được. (4) **Bỏ `GRANT SELECT` `public_activity_cards_v` cho `readonly`** — crawler đi qua app + narrow function, không đọc DB; grant đó tạo **danh bạ activity cross-person duyệt được không cần slug**, phá anti-enumeration của chính cụm; view giữ vai trò cưỡng chế cấu trúc cho narrow function. |
| 19/07/2026 | v1.58 | **DD-05/06/45/49 integrity closure, không thêm runtime.** Approval existing-`left` không còn giả định financial proof được persist trong `join_requests`: request-create chỉ preflight live DD-49 disposition, approve lock rồi re-derive/revalidate; drift/unknown giữ pending và zero mutation. Venue gate thống nhất chỉ khi `players.status='active'`, không phải request `approved`. Refunded rejoin full không ghi lifecycle/nợ mới; append chỉ khi activation thành công. `waitlist.charge_derivation_failed` là một origin event; domain retry có durable state, tối đa 3 attempts/backoff, không recursive event, exhausted→owner-review/DLQ. Event registry/test mirrors và branch evidence cập nhật: schema commit `1a6ac38`, current feature HEAD `bb47c15`, main `22c23aa`; behavior vẫn chưa build. |
| 19/07/2026 | v1.57 | **DD-59 reconcile ✅ (owner, nhánh (c); method/usage-layer vẫn 🟡 defer).** Merge `channels/web/design-tokens.md` → `standards/design-tokens.md` v1.1 (SoT duy nhất): tokens riêng vào §10 dạng alias, Conflict Resolution Log ghi 9 xung đột (SoT thắng trừ `--sport-tennis` trùng `--warning` → đổi hsl(48,96%,53%)); channels/web thành pointer. Docs mới: `token-needs-matrix.md` v0.1 (🟡 — Token Needs từ BRD v3.9d, 6 lăng kính: gap chính = `--reconcile-unmatched`, usage-token layer debt/sub/join/session, sports 4/7 + level 1..5, touch-target, tabular-nums, locked/upgrade, sync/delivery states). `theme-direction-2026-07.md` v0.2: §6 → propagation path 7 bước (decision → SoT → needs-gaps → benchmark → file design → code → drift audit + WCAG) + định nghĩa xong. Không đổi giá trị brand hiện tại; theme hue/font vẫn ⬜ chờ chốt. |
| 19/07/2026 | v1.56 | **DD-73..78 revoke/origin/order integrity closure (vẫn 🟡).** Pin per-surface/target denial-only safety fence: privacy transition raise token cùng source transaction, global read deny ngay, projector CAS-clear exact token sau convergence; guarded view thay `readonly` base access. Public image dùng opaque ref + authorization-before-cache/private origin. DD-75 lifecycle dùng `publication_version`; correction chỉ wake reconcile current multi-source fingerprint; DB↔renderer staging/CAS. Renderer sandbox typed/escaped Unicode-limited input, fixed local assets, no egress/secrets, raster-only. Slug detach tombstone; card payload scrub. Thêm test fence/multi-source/order/render/injection/retention/cache. Đồng bộ analysis v0.7 + brief v0.4; không migration/runtime mới. |
| 19/07/2026 | v1.55 | **Plane-correctness fix cho DD-75/DD-76 (vẫn 🟡).** Bản v1.53 định nghĩa view public và feed lọc theo `publication_state='published'`, nhưng cột đó sống trên `player_activity_shares` (**tenant plane**) trong khi view/feed đều là **global-only** ⇒ như viết thì buộc phải join cross-plane, phá đúng invariant HR1 mà chính DD-76 dựng lên. Sửa: global `person_activity_cards` có **`card_state ∈ published/revoked` của riêng nó**; `draft` **không bao giờ** tạo global row (projector chỉ ghi khi publish); revoke giữ row làm tombstone để slug không sống lại. View = `WHERE card_state='published' AND audience='public'`; feed lọc `card_state`. Không đổi quyết định sản phẩm nào, chỉ sửa chỗ contract tự mâu thuẫn. |
| 19/07/2026 | v1.54 | **Notification contract integrity closure (DD-70/71/72 vẫn 🟡 đề xuất; DD-67 security consequence clarified):** delivery structurally binds intent↔identity Person, giữ đúng một active logical route xuyên platform và một live physical claim/target; hai FK deferrable cho Person merge; mọi send/fallback/retry revalidate canonical state ngay trước provider write. Inbox dùng per-Person fence + server sequence, synchronous visible-set read-all receipt và explicit reads thay timestamp cursor/global watermark; global rows bỏ arbitrary JSON/i18n params. Announcement idempotency scope đúng tenant+actor+command, canonical content/audience immutable, dispatch re-hash/revalidate full vector trước mọi intent, pin routes và giữ terminal-reason precedence; retry-failed có command fence và không resend khi còn pending/sent/unknown. Push registration đi qua signed crypto envelope/proof-bound rebind, derived-key rotation giữ stable Topic/report replay; tenant recovery bỏ impossible `security_alert`, raw telemetry grant-fenced, report cap = 24h và delivered chỉ sau display success. `0014` được ghi đúng là branch-only. Đồng bộ cặp notification v3.4a; không migration/runtime mới. |
| 19/07/2026 | v1.53 | **Code-aware hardening DD-73..78 (vẫn 🟡 đề xuất).** DD-73: Join revalidation + server OG + opaque telemetry; session `price_amount` chỉ từ public whitelist. DD-74: verified Person-self + ended/present eligibility; scheduled fields + canonical sanitized name; không caption/co-participant — **đây là REVERSAL tường minh của v1.50**, bản đó đề xuất co-participant theo "giao của tập đã publish" và tuyên bố "đóng hướng cho DD-48 #5"; nay bỏ hẳn: B publish card của B **không phải** consent để B bị tag trên card của A, nên **DD-48 open item (5)/USR-OQ-8 quay lại trạng thái MỞ** và chỉ đóng được bằng consent scoped per person×card + quyền remove + propagation khi revoke. DD-75: lifecycle≠audience; deterministic provenance + hash-only tombstoned slug registry; followers/draft không public object; profile/card privacy độc lập; correction không boost; revoke/erasure scrub theo USR-OQ-3; loại DD-49 money trigger. DD-76/77: evidence gate; kudos có block/rate/undo/abuse/erasure controls. DD-78: one template system + sport variants, protected preview/follower render, separate session/activity keys và invalidate old public versions. Đồng bộ analysis v0.5 + founder brief v0.2; không migration/runtime mới. |
| 19/07/2026 | v1.52 | **Consistency pass, không đổi quyết định nào.** Cụm DD-73..78 (vẫn 🟡 đề xuất) sửa 5 defect: (1) **DD-73 điều kiện render**: `/s/<id>` chỉ dựa vào **sự tồn tại row `public_sessions`**; `visibility`/`status` là **hệ quả** do projector đảm bảo chứ không phải predicate route được check — bản v1.50 viết như predicate, mà `public_sessions` không có hai cột đó nên vô tình buộc renderer đọc `sessions`, phá đúng ràng buộc lõi của chính DD-73. (2) **DD-73 ban list**: tách `gender` của người chơi (PII, cấm) khỏi `gender_restriction` (session policy, **được phép** theo BL-DSC-1/DD-41) — v1.50 cấm nhầm cả hai. (3) **DD-73 phase → P4.3** theo blocker DD-12, không thể là P4. (4) **DD-74 thêm ranh giới với DD-48 open item (1)**: card ≠ profile field — publish card **không** mở quyền hiển thị aggregate suy diễn (tổng số buổi/số CLB/streak) trên profile; item (1) vẫn phải đóng bằng quyết định riêng. (5) **DD-75 revoke chốt 404 đồng nhất**, bỏ phương án 410 vì 410 tiết lộ card từng tồn tại. **DD-45×DD-49 reconcile:** first-entry promotion mới tạo exactly-one charge; proven rejoin promotion carry-over canonical aggregate và không tạo charge thứ hai; chỉ unknown/unimplemented disposition mới `REJOIN_REQUIRES_REVIEW`. Đồng thời ghi đúng `0014_players_waitlist` **đã commit tại `1a6ac38` trên `feat/session-waitlist-expand`, chưa merge `main`@`22c23aa`**. Founder-batch recheck cùng version còn surface `trusted_at/trust_source` + reset-on-rebind vào DD-72 schema choice và làm DD-71 vector rule component-wise; DD-70..72 vẫn proposal, không migration/runtime. |
| 18/07/2026 | v1.51 | **DD-78 (🟡 đề xuất) — ảnh share mặc định do Plexco render.** Owner yêu cầu mỗi player share activity kèm ảnh mặc định; DD-48 đã excluded `avatar` và Plexco không có route GPS ⇒ **không có nguồn ảnh cá nhân hợp lệ nào**, template render là lựa chọn đúng chứ không phải fallback. Pin: **không upload phase-1** (EXIF-GPS phá DD-06 · moderation ảnh công khai · storage abuse); **tách bucket/credential/endpoint khỏi media store DD-55** (public-cache vs private-signed là hai semantics ngược nhau); render từ snapshot đã whitelist; template per-sport + design tokens với fallback generic; URL immutable theo `card_version` nên correction không cần purge, chỉ revoke cần; pre-render lúc publish. Thêm pin **quyền publish thuộc player**, tenant chỉ kiểm soát club attribution. Analysis đổi tên `dd-73-77-*` → **`dd-73-78-share-activity-analysis.md`**. Review correction cùng version: SI-1 provider-port tách OAuth cross-site transaction/Lax binding khỏi Telegram same-origin primitive; DD-71 proof dùng exact channel vector nhưng roster resolve tại dispatch; DD-72 phân biệt browser-selected push service với app-level vendor platform/SDK. Vẫn chưa chốt ⇒ không migration, không đổi code-readiness. |
| 18/07/2026 | v1.50 | **DD-73..77 (🟡 đề xuất, chờ owner) — cụm Share & Activity (tham khảo Strava).** DD-73: share link **không phải capability**, tách hẳn khỏi invite token DD-44; renderer OG bị ràng buộc chỉ đọc `public_sessions` để HR2 thành thuộc tính cấu trúc. DD-74: activity per player là **read model** trên `players ⋈ sessions` (+DD-42), **không** tạo fact table song song (§P6/HR3); hai tầng v1/v2 additive; v2 cần **amend DD-64**; club attribution = **rò roster ngược** ⇒ dual-consent, default OFF; co-participant theo **giao của tập đã publish** (đóng hướng cho DD-48 #5). DD-75: tách **ý định** (tenant, RLS) khỏi **snapshot** (global protected, projector-owned) + view whitelist cho `readonly`; revoke tombstone slug + CDN purge. DD-76: feed **fan-in**, đọc hoàn toàn trong global plane, `followers` re-evaluate mỗi read (không grandfather nội dung), block DD-55 hai chiều. DD-77: ship **kudos**, **defer comment** sau safety gate DD-55 + một OQ moderation mới cho surface global-plane (CHT-OQ-2 không phủ). **Cả năm chưa chốt → không migration, không đổi code-readiness, không sửa spec Reviewed.** Phân tích: `../decisions/analysis/dd-73-78-share-activity-analysis.md`. |
| 18/07/2026 | v1.49 | **Notification review-fix closure (DD-70/71/72 vẫn 🟡 đề xuất):** tenant inbox dùng `notification_intents` làm durable item, projector chỉ signal/cache; read-all watermark server-owned. Security alert cần trusted pre-existing out-of-band route; global delivery-attempt owner là build/enablement gate, không cản founder accept hướng DD-70. Announcement free cơ bản có layered quota được reserve atomically/idempotently/fail-closed + proof-bound preview/confirm; receipt nằm trên `announcements.preview_*`, queue/fan-out status tách khỏi delivery aggregate; audience/session refs đều dùng same-tenant composite FK, opt-out có storage/API owner và host body có plain-text/size fence. DD-72 chỉ freeze Web Push phase-1, không pre-design native; provider gọi đúng là direct Web Push + VAPID, browser push service vẫn trong data flow; `unknown` cấm alternate-route fallback, high-value tối đa 2 same-route retry. Topic/tag là domain-separated HMAC token đúng 32 ký tự base64url; secret resolver worker-only qua send-claim; telemetry có server-generated canonical `event_key` + scoped replay-safe report capability. Đồng bộ cặp notification v3.2 và feature index v2.26. Chỉ sửa contract Draft, không có migration/runtime mới. |
| 18/07/2026 | v1.48 | **DD-70/71/72 (🟡 đề xuất, chờ owner) — notification cluster.** DD-70: chọn phương án notify person-directed GLOBAL (a) `person_notifications` global-protected / (b) SSE-only không lưu bền — đóng *impl-gap* do DD-47 ghi ra (`notification_intents`/`outbox_events` đều `tenant_id NOT NULL`). DD-71: tier announcement (đề xuất free + rate-limit theo DD-40) + cơ sở preview/confirm (**DD-25 không phủ broadcast**) — thực thi audience contract DD-43/BL-NTF-4 vốn chưa có doc sở hữu. DD-72: schema `device_push_subscriptions` + provider — DD-69 đã đặt tên và pin ranh giới nhưng chưa chốt cột; kèm bất biến payload-không-tiền/PII và telemetry bắt buộc trong slice S9/S20 cho gate #4. **Cả ba chưa chốt → không có migration, không đổi code-readiness.** Hệ quả tài liệu: cặp notification gộp về một và **xuống 🟡 Draft** (status lens 15→14 Reviewed) vì §B/C/D chưa chốt — **§A contract nhắc/xác nhận/correction không đổi và không mở lại**. Spec: gộp vào cặp sẵn có `../features/FE/feature_notifications_reminders.md` v3.0 + `BE/..._tech.md` v3.0 — §B/C/D (features index v2.25; cặp riêng `feature_notification_center` đã xoá cùng ngày). |
| 18/07/2026 | v1.47 | **Founder batch (owner 2026-07-18)** — *(cập nhật cuối ngày: DD-69 thêm **go/no-go gate product-evidence** cho phase-2 native — retention/liquidity/monetization/độ tin cậy push PWA-iOS, ngưỡng `TBD` chờ baseline; độc lập và cộng dồn với technical gates; mirror 1 đoạn ở BRD §14)*:  DD-33 ✅ (Facebook Login/Messenger phase-1 + kick off App Review); DD-60 ✅ (API reference convention); DD-61..64 ✅ **accept in-principle** (Session Organize — build **post-P4**, phased; DD-63 `balanced` degrade random tới khi có level source per-sport); DD-69 ✅ **định hướng accepted** (app-first PWA→native; technical gates framework/platform/contract mở tới phase-2). **DD-57/58/59 owner defer** (reference-only, không gate build). **Propagation completed trên current-authority surfaces:** DD-33 identity/auth + external-gate contract; DD-60 áp forward-looking/on-touch, không claim mọi historical block đã retrofit; DD-61..64 status + post-P4/no-runtime boundary; DD-69 product/native mirrors. |
| 18/07/2026 | v1.46 | **DD-69 (🟡 proposal) — định vị app-native + review closure:** Plexco app-first; phase-1 target = PWA (S9/S20 planned, chưa live), phase-2 = native TBD; RN+Expo chỉ là recommendation sau spike. Pin client-safe contracts, Google PKCE + Apple/equivalent iOS gate, bearer/refresh boundary, native push tách khỏi DD-67 ChannelIdentity, privacy-safe payload và offline v1 read-only. Native NGOÀI phase-1 committed scope; không đảo DD-10/DD-37. Propagate BRD/PRD/ROADMAP + native strategy; nguồn owner 2026-07-18. |
| 17/07/2026 | v1.45 | **Code-aware feature-doc closure:** generalize endpoint-scoped channel identity/reachability cho Messenger+Zalo; pin App Secret cấp Meta App và Page-token protected store; chốt XOR issuer + lifecycle cho `link_code`; canonical chat model dùng `kind`/`chat_members`/`author_type='person'`, DM safety core enforce create/send/read/SSE và cấm direct user DML; KB content-DLP trước embed/retrieval, giữ Club Assistant Draft tới formal promotion và yêu cầu migration mới self-contained thay vì sửa `0000`/`0009`; DD-49 rejoin canonical; terminal-point correction bounded + active SSE re-auth ≤30s; SePay signature contract được propagate ở feature/TDD. Chỉ đổi authority/spec, không tuyên bố runtime/migration staged đã merge. |
| 17/07/2026 | v1.44 | **Session-organize v0.3 + API-envelope closure:** participant substitution dùng stint + partial unique trên row assigned; `session.organize`/`session.score` độc lập; mọi mutation có concurrency token cụ thể; match-config PATCH làm reachable scoring-lock error; idempotency hash canonical + replay re-auth. Reconcile DD-57/DD-60, API convention và FE architecture với live `{data,error,meta.requestId}` envelope. DD-61..64 vẫn 🟡 proposal. |
| 17/07/2026 | v1.43 | **Owner chốt DD-65..68 — Messenger hybrid shared surface:** central Plexco Page luôn có + optional Page per-club; cả host/player dùng được trên cả hai. Pin fail-closed tenant/action resolver, role-aware menu, shared domain services, Page-scoped identity/reachability, one-route delivery, durable create-session wizard, opaque paginated actions và E2E gate hai tenant/hai Page. Ghi rõ live runtime/schema chưa implement và migration mới là bắt buộc. |
| 17/07/2026 | v1.42 | **Code-aware hardening DD-61..64 (vẫn 🟡 proposal):** canonical phase → TBD, earliest after P4; v0.2 khóa two-side và lifecycle theo time; migration mới thay vì sửa `0009`; same-tenant/session FK + unique live fences; durable command idempotency; point/reversal ledger bất biến; pure preview + revalidated apply; exact DD-56 action/session-scoped scorer, relation read/SSE và proposed rate buckets. Sửa toàn bộ relative links tới BE spec. Không thay đổi trạng thái owner-approval. |
| 17/07/2026 | v1.41 | **Thêm DD-61..64 (🟡 proposal, không gate build) — Feature Session Organize.** Từ session hỏi feature 2026-07-17 (create match · assign player to court random/manual/... · update score). **DD-61** model đa môn generic (`session_courts`/`matches`/`match_participants`) hang off `sessions`/`players`, tenant-scoped, chỉ khi `status='open'`, không tạo bảng roster song song (§P6) — giải đúng phần `feature_session_management` để "ngoài phạm vi". **DD-62** live scoring per-point qua ledger append-only (`match_sets`+`score_events`, undo=reversal, SSE reuse DD-07). **DD-63** assign engine 4 mode ở core; **`balanced` 🔗 phụ thuộc nguồn level per person×sport CHƯA có** (DD-41/DD-08) → fallback random. **DD-64** organize tenant-private không public (HR2) + scorer = capability DD-56 + không tự đổi attendance DD-42. Spec Draft: `../features/FE/feature_session_organize.md` + `../features/BE/feature_session_organize_tech.md`. CHƯA vào `schema.ts`/migration. |
| 17/07/2026 | v1.40 | **DD-58 visual-source truthfulness:** gỡ claim `Plexco-DS-fable5.pen` là SoT vì asset không tồn tại trong repo và theme mới đã supersede nó; tách token SoT (`design-tokens.md`) khỏi visual SoT; pipeline fail-closed cho tới khi owner chốt `.pen` mới được track hoặc Figma file/node được link. Không đổi trạng thái proposal của DD-57..60. |
| 16/07/2026 | v1.39 | **Post-v1.38 authority reconcile:** DD-40 xoá lựa chọn synthetic bank transaction cho host-attested CK chưa ingest; pin hard boundary = dedicated allocation source migration + actor/opaque evidence, reject trước migration, exact DDL qua B1 design-probe. Reconcile body cũ DD-01→DD-50 và DD-45 rejoin→DD-49 để không còn hai contract hoạt động. Refresh Product/BE/HANDOFF/BUILD-STATUS/feature index/tracker/workbook authority sau full DD-49..56 propagation; DD-57..60 vẫn proposal, không gate build. |
| 16/07/2026 | v1.38 | **FE docs practices adopt từ Sporta (🟡 proposal, không gate build).** Thêm **DD-57** (FE architecture principles → `standards/frontend-architecture.md`, FE-INV-1..6), **DD-58** (design→code pipeline `.pen→handoff→token-mapping→code→verify` + 2 template + luật `// Source:` comment; CSS-var không Tailwind), **DD-59** (design-token benchmark method + usage-token layer + reconcile file token trùng), **DD-60** (API reference convention: auth legend + envelope + endpoint block format). Tất cả adapt sang stack Plexco (Next.js/React, CSS-var tokens, `apps/web`, HARD RULES) — KHÔNG copy nguyên Tailwind/Flutter. Doc-map HANDOFF §7 + README + `channels/web/README` cập nhật pointer. Nguồn: so sánh docs Plexco↔Sporta 2026-07-16. |
| 16/07/2026 | v1.37 | **Code-aware contract closure sau founder batch:** DD-49 giữ policy nhưng bỏ giả định row `delta/new charge`; pin append-only signed obligation adjustment + một canonical balance helper, storage/API chờ mutation-path design-probe vì live UNIQUE charge/player/session. DD-50 pin proof matrix Google OIDC (`iss/aud/nonce/exp/iat/email_verified`) + transactional `link_code` consume + credential lifecycle gate. DD-52 summary nhận amend actor. DD-55 nâng block/report/rate-limit thành hard enablement gate open-DM. DD-56 thay blanket role inheritance bằng exact capability registry + least-privilege defaults/delegation audit. Propagate full body Product/BE + tracker/HANDOFF/BUILD-STATUS. |
| 16/07/2026 | v1.36 | **Founder batch 2 (owner):** thêm **DD-54** (PII optional thu theo platform config trên CMS admin dashboard; field vận hành không config-off; KHÔNG thay legal review — SEC-OQ-2 giữ mở), **DD-55** (DM phase-1 open cho mọi user, phase-2 follow-gated + request box; media in-scope phase-1 full stack; host không đọc DM; resolve CHT-OQ-1/3 + DD-48 item 3; CHT-OQ-2 moderation còn mở), **DD-56** (co-admin = admin trừ role management; được manual ban — **amend DD-52** actor = TenantOwner + co-admin; resolve RTE-OQ-1). Note DD-33: App Review chatbot (pages_messaging) ≠ Facebook Login advanced access — C4 plan phải nộp đủ 2 nhóm permission. |
| 16/07/2026 | v1.35 | **Founder decision batch (owner, từ founder brief Items 2–9):** thêm **DD-49** (money correction: đổi giá host-choice delta/grandfather; host-cancel hoàn toàn bộ; player-leave hoàn theo policy CLB + refund request; **rejoin logic thường + carry-over paid charge** — thay left-rejoin fail-closed của DD-45), **DD-50** (phase-1 không thu SĐT; khoá mạnh HR4 = verified email + link_code; điều chỉnh DD-01; resolve ID-OQ-1), **DD-51** (Host Pro: trial 14d + remind 2d + khoá ngay; invoice grace 7d; refund window 7d từ paid; override PlatformAdmin 7d/ticket/audit — resolve BIL-OQ-2), **DD-52** (guest→full invite+request coexist; manual ban TenantOwner, không auto-evict, tách DD-42, `evaluateJoinRestriction()` core — resolve CCJ-OQ-2/ID-OQ-3), **DD-53** (identity recovery: PlatformAdmin freeze, 2-approval split, break-glass audit, strong proof, không rewrite ledger — resolve ID-OQ-2/ID-MERGE-1/RTE-OQ-2). **DD-39 addendum:** value set `male/female/other/undisclosed` (resolve USR-OQ-1). A7 (DD-18): giữ ⬜, owner ok khởi động due-diligence matrix; A8 (DD-34/35/36): giữ approve-in-principle. Propagation pending: HANDOFF HR4 + feature specs (session/payment/billing/CCJ/identity/user_settings/routing) — track ở `../probes/pre-code-open-items-2026-07-16.md` D7. |
| 15/07/2026 | v1.32 | **Canonical channel-vocabulary closure:** DD-01 dùng Zalo/Messenger/web cho phase-1 và đánh dấu Telegram legacy-only; không đổi merge contract hay quyết định sản phẩm. Đồng bộ authority refs downstream. |
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
| 10/07/2026 | v1.15 | **Phase-1 channel pivot (BRD v3.4).** Thêm **DD-37** (✅ bỏ Telegram; Facebook Messenger + Zalo + web là kênh MVP — thay DD-09), **DD-38** (🟡 chat cơ bản in-app phase-1, dựng hạ tầng `chat_*` sớm cho DD-19), **DD-39** (🟡 giá theo giới tính), **DD-40** (✅ mark-paid thủ công tiền mặt/CK mọi tier, auto-reconcile là host_pro — giải nuance DD-29). Cập nhật **DD-09**→🔄 thay bằng DD-37; **DD-13**→✅ (Google+email auth phase-1, thay TG Login); **DD-33**→🟡 phase-1 (Facebook Login); **DD-29** free-tier bots = Zalo+Messenger + nuance giải; **DD-31** ghi OQ-1 bị đảo (không còn TG Login). Nguồn: owner 2026-07-10. |
| 10/07/2026 | v1.16 | **Review fixes (owner).** **DD-38 (chat) + DD-39 (giá theo giới tính) → ✅ Chốt** vào phase-1, kèm ràng buộc thiết kế đóng design gap: chat = 2 loại channel (club tenant-RLS / DM person-self, tenant_id NULL), DM guard `dm_key` UNIQUE + đúng 2 member, dedupe `client_msg_id` độc lập author (assistant/system NULL); gender = **fail-closed khi decrypt lỗi** (chỉ fallback khi gender NULL thật). **DD-40 fix money-vocab:** mark-paid ghi **`payment_allocations`** (source `cash`/`manual`) + cập nhật `charges` — **KHÔNG** bảng `payment`, không source `bank_transfer`; nêu impl-gap "CK host-attested khi chưa có `bank_transaction`". |
| 11/07/2026 | v1.17 | Thêm **DD-41..46 (🟡/⬜)** từ đối chiếu `feature_session_management` với 6 màn hình *Create Meet/Create Game* của 2 app tham khảo: **DD-41** field mô tả + gating cho `sessions` (title/notes/session_type/level min-max+strict/gender-restriction≠DD-39/age/instructions); **DD-42** subsystem no-show/attendance/reliability (deprioritize/ban per-tenant); **DD-43** nhãn/hạng thành viên + audience targeting khi announce; **DD-44** invite-link token cho kèo private; **DD-45** model hoá waitlist (đóng gap SES-UC-9); **DD-46** ⬜ kèo không CLB (Skip Club — đụng invariant `tenant_id`, chờ founder). Nguồn: session hỏi feature 2026-07-11. |
| 11/07/2026 | v1.18 | Thêm **DD-47/48 (🟡)** cho `feature_user_settings` (follow + private/public): **DD-47** social follow graph `person_follows` (global, cạnh có hướng, `pending/accepted`, auto-accept public / approve private, merge re-parent+dedupe, **không** cấp quyền tiền/PII/roster); **DD-48** `persons.profile_visibility` (default `public`) + cross-user profile read whitelist non-PII + gating fail-closed (private ẩn **cả đồng đội cùng CLB** trừ host vận hành; **KHÔNG** nới RLS / **không** đụng đường tiền — HR1/HR2). Nguồn: session hỏi feature 2026-07-11. |
| 13/07/2026 | v1.19 | Reconcile decision log với live repo: **DD-10 → ✅ Next.js App Router, standalone/container, không Vercel** (`apps/web` đã dùng Next.js); **DD-12 → ✅ bảng `public_sessions` cập nhật qua projector** (schema/migrations đã có projection table; projector implementation vẫn pending). Đồng bộ BRD/TDD/ROADMAP/HANDOFF/deployment docs. |
| 15/07/2026 | v1.27 | **DD-32/45/47/48 review closure:** DD-32 defer money claim proof về identity evidence matrix (DD-26 không tự là proof) + close funnel OQ; DD-45 pin positive state-shape/total order/fill-available+unlimited/capacity-below-active; DD-47 global-protected narrow functions + state-idempotency + safe merge order; DD-48 existing-private/new-public migration + sourced fields + social/self/host-route split. Dọn wording proposal đã stale trong body DD-42–44; đồng bộ feature/BE specs, README, BUILD-STATUS, ROADMAP. |
| 15/07/2026 | v1.28 | **DD-45 money/propagation closure:** open join + approval full cùng vào waitlist; promotion assert no existing charge rồi tạo đúng một charge; malformed existing-charge candidate skip+audit; `left` self-rejoin fail-closed `REJOIN_REQUIRES_REVIEW` do UNIQUE player/charge + refund/void policy còn mở. Đồng bộ DD-05/44, cluster quick-ref, channel funnel, session + cross-club product/BE specs và tests. |
| 15/07/2026 | v1.29 | **Light propagation pass (chốt-DD → feature specs).** Fix 5 link bảng tóm tắt (DD-05/06/42/43/44 → file riêng) + DD-43 "tags-only" (bỏ `membership_tier` MVP). Neo decision-level pointer vào specs (không đổi Reviewed body/schema, defer build slice): `feature_session_management` +SES-OQ-4..7 (DD-41 fields+gating / DD-42 attendance / DD-43 audience / DD-44 invite token); `feature_notifications_reminders` +NTF-OQ-3/4 (DD-43 audience / DD-45 promote notify); `feature_multi_tenant` OD-8→✅DD-08, OD-4→🟡DD-04, +MT-OQ-2 DD-46 / MT-OQ-3 DD-43; `feature_web_auth_onboarding` +WAO-OQ-4 DD-46 auto-provision; `feature_user_settings` USR-OQ-4..9 neo về DD-48 (5 open item) / DD-47 (notify gap) = framework ✅, chốt lúc build. Verify đã ✅ sẵn: cross_club_join CCJ-OQ-1, marketplace MKT-OQ-1/2, funnel CBF-OQ-1/2/3, player_view DD-48 boundary. P7/spike (DD-04/14/15/18/34-36) giữ pointer proposal (chưa chốt). |
| 15/07/2026 | v1.30 | **DD-32/45 final money timing:** DD-32 paid booking tách active→charge khỏi full→waitlisted/no-charge. DD-45 pin DD-39 charge-derivation failure: derive trước mutation; KMS/decrypt/price error giữ candidate waitlisted/no-charge/no-venue; one audit + canonical outbox event cho retry/owner-alert, không rollback leave/capacity opener, tiếp tục candidate kế. Propagate session/cross-club/user-settings/notification specs + tests. |
| 15/07/2026 | v1.31 | **Docs reality-check closure:** chuẩn hoá giới hạn Messenger theo contract 24h + cơ chế ngoài cửa sổ phải đủ điều kiện theo Meta; sync authority cho BRD/PRD/TDD/ROADMAP, business-rules, feature index và BUILD-STATUS. Không đổi quyết định sản phẩm hay implementation contract DD-32/45. |
| 16/07/2026 | v1.33 | **DD-04 → ✅ Accepted (owner) — Option (c): co-locate compute + Postgres trên DigitalOcean** (App Platform + Managed PG HA-standby, VPC private, Singapore) **+ cost/fact closure.** Supersede đề xuất (a); đổi deployment target Fly→DO (không đảo DD-10). **Cost** chuẩn hoá theo 5–6 replica × 1 GiB: (c) = **`$121–133` core / `$202–254` money-safe** (đã cộng logs + encrypted offsite backup bắt buộc); premium core cùng tài nguyên vs Fly+DO chỉ `$20–25`. **Supabase** Team từ `$599` (có PrivateLink nhưng không uptime SLA; SLA chỉ ở Enterprise custom, auto-failover cần contract confirmation). **Pre-build gate §7.1:** verify SePay/ApiPay/Zalo/Messenger fixed-outbound-IP trước khi dựng DO App Spec (fail → fallback (a) Fly+DO). Mitigation bắt buộc: offsite backup + restore runbook. Record `../decisions/analysis/dd-04-hosting-final-decision.md`. Propagate BRD OD-4 / TDD / deployment-infra / security specs / env banner. |
| 16/07/2026 | v1.34 | **DD-04 Rev 2 — cost model đổi Day-1 baseline + trigger-based (record §8.2 PROPAGATION).** Thay số `$121–133 core / $202–254 money-safe` (v1.33) bằng **Day-1 baseline `$120–135`** (2 web + 2 discovery + 1 worker × 1 GiB + DO PG HA `$60.90` + Cloudflare Free + Sentry Developer + KMS `$1–3` + logs/R2 `$0–5` + egress `$0–8`; subtotal cố định `$118.90`) — **money-safe nhờ non-negotiables + read-isolation controls** (projection-role, bounded pool, reserved connection budget, CDN, circuit-breaker), KHÔNG cần read-replica/WAF-Pro/Sentry-Team Day-1. Read replica vật lý/WAF Pro/Sentry Team/worker-2/DB-resize = **trigger-based upgrade** khi telemetry chạm ngưỡng. Ephemeral staging `$8–18` → prod+staging `$128–153`. **Không đảo (c) hay DD-10; chỉ đổi cost model.** **Caveat money-system:** deferral chỉ an toàn khi read-isolation controls ship thật + trigger được giám sát. Propagate deployment-infra §9 (v1.7) + environments-setup + base-chat + dd-04-brief. Record `../decisions/analysis/dd-04-hosting-final-decision.md` §5/§8. |
| 13/07/2026 | v1.26c | **Per-DD detailed analysis files (toàn bộ DD còn lại).** Mỗi DD có file riêng theo template DD-02/41: DD-05/06/32/42/43/44/45/47/48 (session-model/marketplace/social) + **P7/external mới: DD-18 (`dd-18-llm-provider-analysis.md`), DD-34/35/36 (`dd-34-36-kb-platform-analysis.md`), DD-14/15 (`dd-14-15-zalo-spike-analysis.md`)**. Reconcile toàn bộ (analysis files ↔ decisions.md notes ↔ cluster quick-ref): DD-48 host-route-split + field-source (không "ngoại lệ host"/không avatar-sports), DD-32 identity-evidence (DD-26 không phải proof), DD-45 total-order+capacity-boundaries, DD-47 global-protected `0009`. Cluster doc = index. |
| 13/07/2026 | v1.26b | **DD cluster review-fix (2026-07-13).** DD-05: pending=no player/charge, **approve=money-write dưới RLS** (không "chỉ policy"). DD-32: A ⇒ **guest book paid được** (active outcome tạo charge; full waitlisted/no-charge theo DD-45); strong-proof chỉ cho **claim/merge membership có tiền** (≠ paid-booking); paid-booking-cần-web-auth = C (không chọn). DD-43: **tags-only cho notification audience**, join eligibility = DD-41 (bỏ tier khỏi MVP). DD-44: redemption contract (entropy, session/tenant-bound, revoke, used_count-on-redeem, lock lượt cuối). DD-45: waitlist lifecycle (no-capacity/no-charge/no-venue; promote tạo charge atomic; ordering+tie-break; skip-on-ineligible; capacity-decrease-no-promote). DD-47: `person_follows` = **global protected → grants `0009` SECURITY DEFINER**, không chỉ app choke-point. DD-48: approved-public-profile-fields (aggregate=open item); **migration backfill trước default public**. **Propagation:** cross_club_join CCJ-OQ-1, marketplace MKT-OQ-1/2, session_management SES-UC-9, channel_booking_funnel status, user_settings §7 → ✅. |
| 13/07/2026 | v1.26 | **Chốt loạt DD còn lại (owner).** **DD-05** per-session default open (approval→join_requests+re-check); **DD-06** area-only public, venue post-join; **DD-32** ✅ **Option A phễu mềm** (guest vẫn book; "linked"=OTP đủ hook, web-auth chỉ nhánh tiền; bật DD-33 trước DD-14); **DD-42** ✅ **per-tenant** reliability (attendance players / reliability memberships / policy deprioritize-ban; không public); **DD-43** per-tenant tags/tier targeting (public không lộ); **DD-44** `session_invite_tokens` (không hạ visibility); **DD-45** waitlist `players.status+waitlisted` auto-promote atomic + re-check; **DD-47/48** ✅ **framework, build P4+** (person_follows global fail-closed / profile_visibility default public, whitelist non-PII, 5 open item lúc build). **P7:** DD-34/35/36 approve-in-principle; DD-18 hướng hosted-first swappable (provider+DPA chặn go-live). **External:** DD-14/15 = SPIKE xác minh Zalo (không phải quyết định nội bộ). Nguồn: `../decisions/analysis/dd-remaining-cluster-analysis.md`. |
| 13/07/2026 | v1.25 | **DD-41 → ✅ Chốt (owner).** `sessions` +mô tả (title/notes/**`session_type` 1-field**; **`cost_shared` descriptive-only** không đổi charge) + **gating enforce ở shared `evaluateSessionEligibility`** (gọi từ `addMemberToSession`, universal — không chỉ CCJ) **decision table self-attested** (level_rank+strict [DD-08]/gender/**age**; **age tính tại `starts_at`/session tz**; **9 error codes exact** gồm `*_CONSENT_REQUIRED` cho gender/age; consent-denied ≠ missing; **chặn transition open/public khi source chưa có**; approval re-check trong tx). **Consent source per-attribute** (`gender_consent`/`dob_consent` — enc NULL không phân biệt missing/denied). **`skill_level` retire → `level_*_rank`** (expand→contract, backfill, drop). `gender_restriction`=policy≠player PII. `level_strict` vào public whitelist. Scope: level+gender+**age in-scope**. **Dependencies:** level per-sport source (chưa có → level advisory), `persons.gender_enc`/`dob_enc` = **BRD FR-11 contract có, migration chưa** (KHÔNG mới). `session_type` trộn 2 trục (tách sau cần backfill). Propagation rộng (CCJ/business-rules/TDD/schema/migration/DBML/projector/invariant-test/README); Session+CCJ **chưa implement** (schema-only). Nguồn: `../decisions/analysis/dd-41-session-fields-gating-analysis.md`. |
| 13/07/2026 | v1.24 | **DD-46 → ✅ Chốt (owner) — Option B "personal tenant".** Kèo không-CLB: `getOrCreatePersonalTenant(person_id)` auto-provision (`tenants.kind='personal'` + **`owner_person_id` + `UNIQUE WHERE kind='personal'`** = 1/person, DB-level; logical free tier) → **giữ nguyên `tenant_id NOT NULL` + RLS + money**. Schema fail-closed (`CHECK kind⇔owner`, partial unique INDEX). Provision: extend `tenant_provision`/`provisionTenant` → `tenant_get_or_create_personal`/`getOrCreatePersonalTenant` (lock `persons` row cùng merge, không advisory). Provision **tái dùng shared core** → owner membership **luôn được tạo**; **public alias = `owner membership.display_name`**. Marketplace **fail-closed**: alias trống → không project public; giữ `club_display_name` NOT NULL. Participant → guest membership+player+charge (tiền y hệt). Merge: collision → loser personal→`kind='club'`; **re-parent cả `memberships` LẪN `tenant_admins.platform_user_lookup_hash`** (person UUID text, no FK → không rewrite = mất owner web). **CẤM vĩnh viễn** nullable tenant_id (rủi ro = phải dựng authz/money plane thứ hai). **Mở khoá cụm session-model**. Nguồn: `../decisions/analysis/dd-46-skip-club-analysis.md`. |
| 13/07/2026 | v1.23 | **DD-02 rev6 + propagation.** Full-issued code = `registry.locked_at IS NOT NULL` + `pay_code` khớp (retired-chưa-lock không false-issued); prefix immutable sau first issuance + choke-point atomic; `discoverPayCodeCandidates` (enumerate mọi split, batch-resolve — foreign token không bị bỏ sót; **`skipCodes` xét SAU resolve, issued thắng skipCodes**); `PAYMENT`→none chỉ khi `PAY` không own. **Propagated (spec):** `identity-model`+`feature_identity_tech` (pay_code tombstone) · connector 4.3b+`_tech` M2 (ApiPay ✅ **primary**) + **`provider_connections.auth_mode='enterprise'` + CHECK shape đầy đủ per provider/auth_mode** + CO-OQ-6 đóng (`skip_if_no_code=0`) · `feature_payment_reconcile_tech` **§4 worker pipeline + `bank_transactions.provider_code_enc` (providerCode↔content cross-check)** + §8 fixtures. **Migration backfill guard:** query DB thật cho `pay_code IS NOT NULL` → HALT + map prefix thủ công + set `locked_at` (không suy từ slug). |
| 13/07/2026 | v1.22 | **DD-02 → ✅ Chốt (owner).** Contract pay_code (rev 6, `../decisions/analysis/dd-02-paycode-analysis.md`): suffix trần **4 ký tự** UPPERCASE (A-Z+2-9 trừ 0/O/1/I/L), unique per-tenant, immutable, CHECK format+≥1 chữ cái; **prefix = bảng global `pay_prefix_registry`** (prefix PK, state, `locked_at`, one-current-per-tenant; KHÔNG `tenants.pay_prefix`; immutable sau first issuance; choke-point atomic); **recognition** = `discoverPayCodeCandidates` (enumerate mọi split, batch-resolve) + resolver `own/foreign/none` với **full-issued ⟺ `locked_at IS NOT NULL` + `pay_code` khớp**; memo-level precedence (hard-token thắng name-fallback); **allocation `planIncomingAllocations()`** (auto exact/over/under-partial + unknown-fee-sau; manual unknown-fee-đầu/already-paid); **provider-agnostic** (ApiPay primary DD-30, SePay code=evidence); **merge follow tombstone**. **Phase P3→P4**. Propagation: wire core+tests, migration registry+CHECK, extend merge contract, connector ApiPay ✅+CO-OQ-6. |
| 13/07/2026 | v1.21 | **DD-08 → ✅ Chốt (owner).** Môn Day-1 seed: badminton/pickleball/tennis/padel/volleyball/basketball/football (extensible qua bảng `sports`, thêm hàng — không enum/migration cho môn mới). Level ordered 5 bậc: beginner < intermediate < upper_intermediate < advanced < professional (cần rank số cho gating DD-41; thay `sessions.skill_level` text — migration đi cùng DD-41). Một nguồn level cho DD-41/DD-43. |
| 13/07/2026 | v1.20 | **DD-04 reopened.** Gate định nghĩa lại = auto-failover HA + uptime SLA + posture private-network trên Fly; thêm **QĐ-1 posture (a/b/c)** + ứng viên **DigitalOcean** (nghiêng chọn), Neon Scale á quân, Supabase chỉ đạt gate ở Enterprise, self-host/Railway-HA để dành. Sửa dữ kiện: Neon HA không Scale-gated, Supabase Pro không đạt HA/SLA, private-network chưa giải quyết trên Fly. Nguồn: `../decisions/analysis/dd-04-hosting-decision-brief.md` (rev 2). Kèm governance: sync `deployment-infra.md §2` (Railway row) + §6 (network posture). |
