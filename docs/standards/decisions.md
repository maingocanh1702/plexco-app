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
| DD-01 | SĐT verified (share-contact) là khoá merge chính | 🔄 Điều chỉnh bởi DD-50 (phase-1 KHÔNG thu SĐT; khoá mạnh = verified email + link_code; phone = merge signal tương lai, schema giữ dormant) | P3.5 | BRD OD-1 · TDD Q6 |
| DD-02 | `pay_code` contract: suffix trần 4-ký-tự + prefix namespace + resolver own/foreign/none + allocation invariant | ✅ Chốt (2026-07-13) | P4 | BRD OD-2 · TDD Q3 · `../dd-02-paycode-analysis.md` |
| DD-03 | Pricing/tier subscription host (4 tier theo kênh) | 🔄 Thay bằng DD-29 | P5 | BRD OD-3 · TDD Q4 |
| DD-04 | Hosting PostgreSQL → ✅ **(c) co-locate DigitalOcean** (App Platform + Managed PG HA-standby, VPC private, Singapore); Fly = fallback (a); **pre-build gate = §7.1 egress-IP verify** | ✅ Accepted (2026-07-16) | P0 | BRD OD-4 · TDD Q2 · `deployment-infra.md §2` · `../dd-04-hosting-final-decision.md` · `../dd-04-hosting-decision-brief.md` |
| DD-05 | Join cross-club: open vs approval → ✅ **per-session, default open**; approval → `join_requests` + eligibility re-check in tx | ✅ Chốt (2026-07-13) | P4.3 | `../dd-05-join-policy-analysis.md` |
| DD-06 | Độ chi tiết vị trí public → ✅ **`area` only public; venue post-join** (invariant test) | ✅ Chốt (2026-07-13) | P4.3 | `../dd-06-location-granularity-analysis.md` |
| DD-07 | Web realtime: SSE + fan-out qua `LISTEN/NOTIFY` | ✅ Chốt | P4 | BRD OD-7 · TDD Q7 · `deployment-infra.md §2` |
| DD-08 | Danh sách môn khởi điểm + taxonomy trình độ | ✅ Chốt (2026-07-13) | P0 | BRD OD-8 |
| DD-09 | Messenger vào lộ trình lúc nào | 🔄 Thay bằng DD-37 (Messenger là kênh phase-1) | P4.8→P2.5 | BRD OD-9 |
| DD-10 | Web stack = Next.js App Router, standalone/container; không Vercel | ✅ Chốt | P4 | live `apps/web` · BRD OD-10 · TDD Q1 · `deployment-infra.md §2` |
| DD-11 | Zalo Premium + add-on managed (owner >3 CLB) | 🔗 Phụ thuộc ngoài | P4.7 | TDD Q5 |
| DD-12 | Public read model = bảng `public_sessions` cập nhật qua projector | ✅ Chốt | P4.3 | live schema/migrations · TDD Q10 |
| DD-13 | Web-auth provider **Google + email-password** là auth **phase-1** (thay TG Login đã bỏ) | ✅ Chốt | P1 | session 2026-07-02 · **owner 2026-07-10 (DD-37)** · `feature_web_auth_onboarding.md` · `00-start-here/identity-model.md §7` |
| DD-14 | Zalo Login (Social API) có bị chặn bởi cửa đăng ký OA không | ⬜ Mở — **SPIKE xác minh Zalo** (không phải quyết định nội bộ) | P4+ | cần xác minh Zalo |
| DD-15 | Zalo Bot `from.id` có ổn định xuyên nhiều bot khác nhau không | ⬜ Mở — **SPIKE xác minh Zalo** | P4+ | cần xác minh Zalo |
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
| DD-29 | **Phase-1 pricing pivot**: free web + bot (**Zalo + Messenger**); 1 gói trả phí **Host Pro 250k/tháng** (thay 4-tier theo kênh) | ✅ Chốt | P5 | owner 2026-07-05 · thay DD-03 · kênh cập nhật DD-37 |
| DD-30 | Provider onboarding: **APIpay enterprise auto-provision per-host** (tiền vẫn về TK host — giữ money-custody) | ✅ Chốt | P3/P4 | owner 2026-07-05 · `feature_connector_onboarding` |
| DD-31 | Auth security invariant + test matrix (auth-onboarding v3): 8 bất biến SI-1..SI-8. **v3 đã MERGE vào `main@1eb6f60`** (Telegram-era; migrations 0012/0013 + KMS pepper client + tests). Residual = **audit SI trên main + thay provider Telegram Login → Google/email** (DD-37/DD-13) | ✅ Merged (Telegram-era) · residual = Google/email swap | P4 | session 2026-07-06 · merge `5b1193b` · `BE/auth-security-invariant-table.md` |
| DD-32 | Phễu channel-first → ✅ **Option A (phễu MỀM)**: guest book free/paid; active mới tạo charge, full→waitlisted/no-charge tới promotion; transactional one-time `link_code` đủ linked-lite; web-auth không phải booking gate và không tự cấp quyền claim tiền; claim/merge defer identity evidence+confirm contract | ✅ Chốt (2026-07-13; re-check 2026-07-15) | P4.3 + Messenger **P2.5** | `../dd-32-booking-funnel-analysis.md` |
| DD-33 | Facebook Login / Messenger account-link như web-auth provider (`account_identities.platform='facebook'`) — **phase-1** (kênh Messenger + link account); phụ thuộc App Review | 🟡 Đề xuất (phase-1) | P2.5 | session 2026-07-06 · **owner 2026-07-10 (DD-37)** · `00-start-here/identity-model.md §7` |
| DD-34 | Plexco Global KB plane + union retrieval | 🟡 Approve-in-principle (P7; chi tiết+patch DD-21 khi build) | P7 | `proposals/plexco-global-kb-and-kb-autosync.md` |
| DD-35 | Auto-derive KB-club từ canonical | 🟡 Approve-in-principle (P7) | P7 | proposal §4 |
| DD-36 | Freshness: scheduled re-crawl + re-ingest KB-Plexco | 🟡 Approve-in-principle (P7) | P7 | proposal §5 |
| DD-37 | **Phase-1 channel pivot: BỎ Telegram; Facebook Messenger + Zalo + web là kênh MVP** (thay DD-09) | ✅ Chốt | P1–P2.5 | owner 2026-07-10 · thay DD-09 · BRD v3.4 |
| DD-38 | **Chat cơ bản trong app phase-1** (toàn CLB + 1-1, chỉ Plexco, không bridge) — dựng hạ tầng `chat_*` sớm; trợ lý (DD-19) tái dùng ở P7 | ✅ Chốt | P4 | owner 2026-07-10 · BRD v3.4 MODULE 10 |
| DD-39 | **Giá theo giới tính** (kèo giá nam/nữ); giới tính từ hồ sơ person, PII có consent, không lộ public | ✅ Chốt | P2/P4 | owner 2026-07-10 · BRD v3.4 MODULE 11 |
| DD-40 | **Mark-paid thủ công (tiền mặt/CK, tap/multi-select) mặc định MỌI tier** → ghi `payment_allocations` (source `cash`/`manual`), KHÔNG bảng `payment`; auto-reconcile + nhắc tự động là `host_pro` (giải nuance DD-29) | ✅ Chốt | P2/P3 | owner 2026-07-10 · giải DD-29 nuance |
| DD-41 | **Field mô tả + gating cho `sessions`** → ✅: title/notes/`session_type`(1 field)/byoe/cost_shared/instructions + gating level-rank/gender/**age** (enforce ở **shared `evaluateSessionEligibility`**←`addMemberToSession`, self-attested, 9 exact codes); gender/age dùng `gender_enc`/`dob_enc`+consent state; retire `skill_level`→rank | ✅ Chốt (2026-07-13) | P2/P4 | `../dd-41-session-fields-gating-analysis.md` |
| DD-42 | **No-show/attendance/reliability** → ✅ **per-tenant** (attendance trên `players`, reliability trên `memberships`, policy deprioritize/ban; RLS, không public) | ✅ Chốt (2026-07-13) | P4+ | `../dd-42-reliability-analysis.md` |
| DD-43 | **Nhãn/hạng thành viên + audience targeting** → ✅ per-tenant tags (host-defined; announce audience; public không lộ tag; level dùng DD-08; `membership_tier` bỏ khỏi MVP) | ✅ Chốt (2026-07-13) | P4+ | `../dd-43-membership-tags-analysis.md` |
| DD-44 | **Invite-link token** cho kèo private → ✅ `session_invite_tokens` (entropy ≥128-bit/hash/expires/max_uses; used_count-on-redeem; vẫn qua join_policy+gating; không hạ visibility) | ✅ Chốt (2026-07-13) | P4 | `../dd-44-invite-token-analysis.md` |
| DD-45 | **Model hoá waitlist** → ✅ full→waitlisted cho open/approval; state-shape/total order; atomic exactly-one-charge promotion; DD-39 derivation-fail giữ waitlisted + one audit/outbox event cho retry+alert, không rollback opener; ~~`left` rejoin fail-closed~~ **→ điểm left-rejoin được thay bởi DD-49** (rejoin logic thường + carry-over paid charge); preserve capacity-below-active reject | ✅ Chốt (2026-07-13; re-check 2026-07-15; left-rejoin sửa 2026-07-16 theo DD-49) | P2/P4 | `../dd-45-waitlist-analysis.md` |
| DD-46 | **Kèo không thuộc CLB (Skip Club)** → ✅ **Option B "personal tenant"** (auto-provision, free, `tenants.kind`; giữ tenant_id NOT NULL; CẤM nullable) | ✅ Chốt (2026-07-13) | P4 | `../dd-46-skip-club-analysis.md` |
| DD-47 | **Social follow graph** → ✅ framework: global-protected `person_follows`, no table grant, narrow `SECURITY DEFINER`, state-idempotent, actor session-bound, merge lock+dedupe | ✅ Chốt framework (2026-07-13) | P4+ | `../dd-47-follow-graph-analysis.md` |
| DD-48 | **Profile visibility** → ✅ framework: new user public/existing private; sourced social whitelist; self + host operational routes tách riêng; fail-closed, không nới RLS/tiền; **5 open item lúc build** | ✅ Chốt framework (2026-07-13) | P4+ | `../dd-48-profile-visibility-analysis.md` |
| DD-49 | **Money correction lifecycle** → host đổi giá chọn per-change (append signed obligation adjustment HOẶC grandfather; không auto chuyển tiền); host cancel đã thu → hoàn toàn bộ; player leave đã paid → hoàn theo policy CLB (toàn bộ/một phần/không), player được request refund; **rejoin = join logic thường** nếu còn slot, chưa refund → carry-over obligation/allocation (không double charge), đã refund → obligation lifecycle mới trong cùng canonical aggregate. **Không mặc định tạo row `charges` thứ hai**; storage/API chờ mutation-path design-probe. Thay điểm left-rejoin fail-closed của DD-45 | ✅ Chốt policy (2026-07-16; storage clarified v1.37) | P2/P3 | SES-OQ-1 · PAY-OQ-3 · `../founder-decision-brief-2026-07-15.md` Item 3 |
| DD-50 | **Phase-1 không thu SĐT** → verified email bắt buộc; Google chỉ là strong proof khi OIDC signature/issuer/audience/nonce/time claims hợp lệ **và `email_verified=true`**; khoá mạnh HR4 cho claim-có-nợ = verified account email (web) hoặc `link_code` deterministic dùng-một-lần (bot); KHÔNG claim bằng tên/alias; phone fields dormant; SMS OTP không dùng phase-1 | ✅ Chốt (2026-07-16; proof matrix clarified v1.37) | P3.5/P4 | Điều chỉnh DD-01 · HR4 · ID-OQ-1 |
| DD-51 | **Host Pro lifecycle** → trial 14 ngày (remind trước 2 ngày, hết → khoá ngay về free); invoice trễ → grace **7 ngày** rồi suspended; huỷ giữa kỳ → **hoàn toàn bộ nếu request trong 7 ngày kể từ khi thanh toán, sau 7 ngày không hoàn** (dùng nốt tới hết kỳ); manual override = PlatformAdmin only, max 7 ngày, bắt buộc reason+ticket_ref+expires_at+audit, auto-expire | ✅ Chốt (2026-07-16) | P5 | BIL-OQ-2 · DD-29 · `../founder-decision-brief-2026-07-15.md` Item 2 |
| DD-52 | **Guest→full + manual ban** → host invite/approve **và** player-request+host-approve coexist (auto-upgrade defer); manual safety ban = TenantOwner + co-admin có capability `member.ban`, bắt buộc reason+evidence, expires_at hoặc permanent, **không auto-evict** active/waitlisted (waitlisted giữ queue + skip theo DD-45); storage tách khỏi reliability-ban DD-42; mọi join path qua một `evaluateJoinRestriction()` core | ✅ Chốt (2026-07-16; actor amended DD-56/v1.37) | P4.3 | CCJ-OQ-2 · ID-OQ-3 · `../founder-decision-brief-2026-07-15.md` Item 4 |
| DD-53 | **Identity recovery + merge-split authority** → PlatformAdmin freeze ngay (1 người); split plan chỉ PlatformAdmin tạo; apply cần **2 approval độc lập**; break-glass 1 người chỉ khẩn cấp (ticket+expiry+immutable audit+hậu kiểm); recovery cần strong proof (verified email/recovery artifact — theo DD-50); split map rõ channel/membership/player/charge, **không rewrite bank_transactions/allocations**; SLA freeze ≤4h, plan ≤1 ngày làm việc | ✅ Chốt (2026-07-16) | Trước production S8 | ID-OQ-2 · ID-MERGE-1 · RTE-OQ-2 · `../founder-decision-brief-2026-07-15.md` Item 9 |
| DD-54 | **PII collection theo platform config** → giữ code logic hiện tại; PII *optional* (gender/DOB…) thu thập theo **config trên CMS admin dashboard** (PlatformAdmin bật khi cần); PII *bắt buộc vận hành* (email verified, display name, bank ingest) không config-off. Config KHÔNG thay legal review A3 | ✅ Chốt (2026-07-16) | P4 | USR-OQ-3 (partial) · SEC-OQ-2 giữ mở |
| DD-55 | **In-app DM policy + media** → phase-1: mọi user DM được nhau **chỉ khi block + report + per-sender rate-limit/abuse audit đã enforce**; phase-2: chỉ follower accepted DM direct, còn lại vào request box; media in-scope phase-1 full stack; host/support KHÔNG đọc DM | ✅ Chốt policy + hard safety gate (2026-07-16; clarified v1.37) | P4 chat slice | CHT-OQ-1 · CHT-OQ-3 · DD-38/47/48(3) |
| DD-56 | **Co-admin capability** → một action registry canonical, **không blanket inherit owner**. Default allow: session/content, routine member ops, money read, manual mark-paid có DD-25 confirm/audit, manual ban/unban. Default owner-only: role management, money correction/refund/waiver/void, bank-account/payment-connector secret, billing plan/cancel/refund. Owner có thể grant từng sensitive capability (trừ role management) với expiry + audit; global DD-51/53 vẫn PlatformAdmin-only | ✅ Chốt matrix (2026-07-16; least-privilege clarified v1.37) | P2 authz | RTE-OQ-1 · amend DD-52 |
| DD-57 | **FE architecture principles** (adopt từ Sporta) → doc `standards/frontend-architecture.md`: FE-INV-1..6 (4-state · tokens-only · UI-không-chạm-DB · i18n · no-PII-public · envelope). Counterpart FE của core-db principles | 🟡 Đề xuất | Docs/P1 FE | `frontend-architecture.md` · ported Sporta |
| DD-58 | **FE design→code pipeline** (adopt từ Sporta) → `.pen → handoff → token-mapping → code → verify` + 2 template + luật `// Source:` comment; CSS-var (không Tailwind) | 🟡 Đề xuất | Docs/P1 FE | `../channels/web/frontend-pipeline.md` · `../templates/feature-dev/fe-*-template.md` |
| DD-59 | **Design-token benchmark method + usage-token layer** (adopt từ Sporta) → doc method feed vào `design-tokens.md`; reconcile file token trùng (`channels/web/design-tokens.md` → trỏ SoT) | 🟡 Đề xuất | Docs/P1 FE | `design-tokens-benchmark.md` · ported Sporta |
| DD-60 | **API reference convention** (adopt từ Sporta) → auth-level legend (⬜✅🔑🔒) + endpoint block format + envelope chuẩn; thống nhất §API Contract của BE tech specs | 🟡 Đề xuất | Docs | `api-reference-convention.md` · ported Sporta |

---

## DD-01 — SĐT verified là khoá merge chính · 🔄 Điều chỉnh bởi DD-50

- **Bối cảnh lịch sử:** Quyết định ban đầu dùng SĐT verified để tránh gán nhầm tiền/merge sai khi một người xuất hiện ở nhiều kênh.
- **Quyết định hiện hành (DD-50):** Phase-1 **không thu SĐT**. Khoá mạnh cho claim membership có nợ/lịch sử tiền chỉ là **verified account email** hoặc transactional one-time **`link_code`**. Tên/alias, owner assertion và bằng chứng CK chỉ là review evidence, không được bypass khoá mạnh.
- **Hệ quả:** `persons.phone_*` giữ dormant cho tín hiệu tương lai nhưng không tham gia phase-1 proof; không tích hợp SMS OTP. Google/email-password và `link_code` phải qua proof/lifecycle contract đầy đủ ở DD-50 trước khi mở claim/merge.

## DD-02 — `pay_code` contract (suffix trần + prefix namespace) · ✅ Chốt (2026-07-13, owner)

> Contract đầy đủ + nguồn ở `../dd-02-paycode-analysis.md` (rev 6). Tóm tắt canonical dưới đây. **Phase = P4** (khớp BL-PAY-3; sửa drift "P3" cũ).

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

> ✅ **FINAL (2026-07-16, owner):** chọn **QĐ-1 (c) — co-locate compute + Postgres trên DigitalOcean** (App Platform + Managed PG HA-standby, **cùng VPC private**, Singapore). Supersede đề xuất (a) trong brief. Đổi deployment target **Fly → DO** (KHÔNG đảo DD-10 — App Platform chạy standalone container). Lý do: private DB by construction + managed HA/SLA/PITR + một provider (đơn giản cho solo dev) + fit `LISTEN/NOTIFY` session-pool (không scale-to-zero) + portability. Record đầy đủ: `../dd-04-hosting-final-decision.md`.
>
> ⚠️ **Pre-build gate (§7.1) — CHƯA verify:** DO App Platform **không bật đồng thời** VPC-private-DB **và** dedicated egress-IP. **Phải xác minh** SePay/ApiPay/Zalo/Messenger có yêu cầu fixed outbound source-IP không **TRƯỚC khi dựng DO App Spec**; nếu có → dùng fallback **(a) Fly + DO**, **KHÔNG** âm thầm tắt private-DB path. Mitigation bắt buộc: **offsite encrypted backup + restore-to-another-Postgres runbook** (chống concentration risk). Cost planning (record Rev 2 — Day-1 baseline + trigger-based): **`$120–135/mo` Day-1 baseline** (2 web + 2 discovery + 1 worker × 1 GiB + DO PG HA `$60.90` + Cloudflare Free + Sentry Developer + KMS `$1–3` + logs/R2 `$0–5` + egress `$0–8`) — **money-safe nhờ non-negotiables + read-isolation controls** (projection-role, bounded pool, reserved budget, CDN, circuit-breaker), KHÔNG cần read-replica/WAF-Pro/Sentry-Team Day-1. Add-on đó = **trigger-based upgrade** khi telemetry chạm ngưỡng. Ephemeral staging `$8–18` → prod+staging `$128–153`. **Caveat:** deferral chỉ an toàn khi read-isolation controls ship thật + trigger được giám sát. (thay số Tier `$202–254` cũ; chi tiết deployment-infra §9 + record §5)
>
> **2026-07-13 (reopen):** Phân tích trong `../dd-04-hosting-decision-brief.md` (nay rev 5: rev 2 factual analysis + rev 3 governance + rev 4 fact/cost closure + rev 5 read-isolation/portability closure) đã mở rộng provider/network gate. Chi tiết/nguồn ở brief; tóm tắt canonical dưới đây.

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
- **Chi tiết:** **`../dd-04-hosting-final-decision.md` (final ✅)** · `../dd-04-hosting-decision-brief.md` (rev 5, phân tích/nguồn) · `deployment-infra.md §2/§6/§9 (DD-04)`.

## DD-05 — Join cross-club: open vs approval · ✅ Chốt (2026-07-13) — `../dd-05-join-policy-analysis.md`
> **Chốt:** per-session, **mặc định `open`**. **`pending` join_request KHÔNG tạo membership/player/charge**. Final open/approve lock session + eligibility re-check (DD-41) dưới tenant RLS: còn slot → membership+active player+charge+venue; full → membership+waitlisted player, không charge/venue (DD-45). Approve là tenant state-write; capacity-available branch là money-write.

- **Bối cảnh:** Player join kèo từ marketplace xuyên CLB.
- **Quyết định (đề xuất):** Cấu hình **per-kèo**, mặc định **open**, host có thể bật **approval**.
- **Lý do:** Cân bằng tốc độ lấp slot (open) và quyền kiểm soát của host.
- **Hệ quả:** Thêm field cấu hình ở session; state machine join có nhánh chờ duyệt.

## DD-06 — Độ chi tiết vị trí public · ✅ Chốt (2026-07-13) — `../dd-06-location-granularity-analysis.md`
> **Chốt:** public projector emit **`area` (quận/khu vực) only**; `venue_name`/`venue_address`+SĐT/bản đồ **chỉ lộ sau join/approval**. Invariant test: venue KHÔNG vào `public_sessions`.

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
- **Hệ quả:**
  - Sync engine có projector ghi `public_sessions`; cần đảm bảo nhất quán cuối.
  - **Bảo mật:** role `readonly` (process `discovery`) **chỉ `GRANT SELECT` trên `public_sessions`/public view, zero grant bảng canonical tiền/PII** → cô lập cross-tenant ở **tầng quyền**, không phụ thuộc RLS. Xem `deployment-infra.md §4/§6`.

## DD-13 — Web-auth provider Google + email-password là auth phase-1 · ✅ Chốt

> **2026-07-10 (owner, cùng DD-37):** CHỐT. Vì **Telegram bị bỏ** (DD-37), TG Login không còn là đường auth. **Google Login (OAuth) + tài khoản web (email + password)** là auth **phase-1**. Điều này **đảo** quyết định OQ-1 trong DD-31 (2026-07-06: "giữ TG Login only, DD-13 vẫn 🟡") — nay OQ-1 hết hiệu lực.

- **Bối cảnh (lịch sử):** Direction web-auth ban đầu là **TG Login + web fallback**. Buổi strategy 2026-07-02 nêu nhu cầu acquisition: cần login "bật ngay được" (Google / email-password) để không kẹt go-to-market.
- **Quyết định (✅):** Auth phase-1 = provider `google` (OAuth) + `email` (email-password self-register). **Bỏ adapter TG Login.** `account_identities.platform ∈ { 'google', 'email', 'facebook'(DD-33), 'zalo'(DD-14) }`.
- **Ràng buộc thiết kế:**
  - Thêm provider = giá trị `account_identities.platform` + adapter OAuth; password → bảng credential riêng qua migration mới (P12 expand→contract). **KHÔNG** tạo root table `users` — `persons` vẫn là anchor (§P6).
  - **DD-50:** phase-1 không thu SĐT; phone schema dormant. Gắn Person bằng verified account email hoặc transactional one-time `link_code`; không gắn bằng tên/owner/CK.
  - **SI-2 keyed-hash (DD-31):** cột `account_identities.platform_user_hash` cho `google.sub`/email — dùng keyed HMAC (Google `sub` entropy cao hơn TG id nhưng vẫn keyed để nhất quán).
- **Hệ quả:** Cập nhật `feature_web_auth_onboarding(.md/_tech)` (WAO-UC-1, Auth Adapter: **bỏ Telegram, thêm Google/email**) + `00-start-here/identity-model.md §7`. Đây là spec-change có DD ✅ → được sửa spec Reviewed theo checklist DD-37.

## DD-14 — Zalo Login (Social API) có bị chặn bởi cửa đăng ký OA không · ⬜ Mở — SPIKE (2026-07-13) — `../dd-14-15-zalo-spike-analysis.md`
> **Không phải quyết định nội bộ** — cần **spike xác minh với Zalo** (developers.zalo.me). Không chặn (link_codes bao ca xấu nhất). Giao spike trước khi phụ thuộc auto-match / bật DD-32 nhánh Zalo.

- **Bối cảnh:** Zalo có nhiều bề mặt tách biệt (Bot Open API, Mini App, OA OpenAPI, Social/Login). Chiến lược auto-match "Zalo login ↔ Zalo bot" (giảm friction, thay cho SĐT) phụ thuộc việc bật được Zalo Login.
- **Cần xác minh:** Zalo Login yêu cầu đăng ký app trên developers.zalo.me — có buộc phải có OA verified không (thứ đang pending), hay độc lập.
- **Hệ quả:** Nếu độc lập → có thể bật Zalo Login trước OA, dùng làm cầu nối auto-match. Ảnh hưởng **DD-32 / provider-link path** (KHÔNG phải DD-13 — đã fence Google/email) và thiết kế link (`00-start-here/identity-model.md §5 link-code contract · §7 provider/channel phase matrix`).

## DD-15 — Zalo Bot `from.id` có ổn định xuyên nhiều bot khác nhau không · ⬜ Mở — SPIKE (2026-07-13) — `../dd-14-15-zalo-spike-analysis.md`
> **Spike xác minh Zalo** (gộp với DD-14). Không chặn (link_codes). Kết quả chỉ ảnh hưởng mức auto-match.

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

## DD-18 — Provider embedding/LLM + privacy/ToS · ⬜ Mở (hướng ✅, chặn GO-LIVE) — `../dd-18-llm-provider-analysis.md`
> **Hướng (2026-07-13):** MVP trợ lý dùng **API hosted-first** sau interface swappable `EmbeddingProvider`/`ChatProvider`. **Provider cụ thể + ToS/DPA/data-region review CHẶN GO-LIVE** (P6), KHÔNG chặn build. Giữ ⬜ vì open item pháp lý.

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

## DD-29 — Phase-1 pricing pivot: free web + bot (Zalo + Messenger, DD-37); 1 gói Host Pro 250k · ✅ Chốt

- **Bối cảnh:** DD-03 monetize theo **số kênh** (free_web / telegram 79k / plus 159k / all 199k). Chiến lược Phase-1 (owner, 05/07) đổi hướng **acquisition-first**: cho host kết nối CLB với **bot miễn phí** để phủ nhanh (bối cảnh 05/07 dự kiến 3 bot gồm Telegram; **DD-37 sau đó bỏ Telegram → Zalo + Messenger**), dời monetize sang **gói tính năng tự-động-hoá** thay vì tính theo kênh.
- **Quyết định (chốt):**
  - **Free (mặc định, mọi host) — 0đ:** web app + kết nối **bot kênh Zalo + Facebook Messenger** (Telegram đã bỏ — DD-37) + quản CLB/kèo/roster cơ bản + **mark-paid thủ công tiền mặt/CK** (DD-40) + chat cơ bản (DD-38). Vào thẳng `active` vô thời hạn (giữ **BL-BIL-1**: không trial/past_due/suspended vì non-payment).
  - **Host Pro — 250.000đ/tháng:** mở khoá **Trợ lý AI + KB** (Club Assistant, DD-16..28) + **đối soát CK tự động & báo thu phí** + **nhắc nợ tự động** (+ các tự-động-hoá nâng cao khác — chốt danh sách chi tiết khi promote billing spec).
  - **Bỏ** 3 tier theo kênh (`telegram`/`plus_channel`/`all_channels`). **DD-03 → 🔄 thay bằng DD-29.** DD-22 (định giá trợ lý) nay gộp vào Host Pro.
- **Lý do:** Kênh miễn phí giảm ma sát acquisition (đấu Reclub, phủ CLB nhanh); monetize theo **giá trị tự-động-hoá tiền** (đối soát/nhắc nợ/AI) — thứ host trả tiền thật để đỡ việc. 1 gói giá đơn giản, dễ bán.
- **Hệ quả — propagation checklist (các spec Reviewed cần cập nhật khi thực thi):**
  - `feature_billing_lifecycle(.md/_tech)`: `plans` CHECK → `('free','host_pro')`; price host_pro=250000; `entitlements` = **capability flags** (registry ở `BE/feature_billing_lifecycle_tech.md §4b`: free có `payment_reconcile_manual`/`reminders_manual`; host_pro thêm `payment_reconcile_auto`/`reminders_auto`/`assistant_ai_kb`/`crm_dashboard`). Bỏ edge/test `plus_channel` (#14/#22). ✅ **đã cập nhật spec 05/07; schema/migration implementation vẫn pending** — live schema còn 4-tier cũ (`packages/db/schema.ts` `plans` + `0007_billing.sql`), cần migration đổi CHECK → `('free','host_pro')` khi thực thi billing.
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
  1. **SI-1 — Pre-auth login-state CSRF binding:** cơ chế state token single-use/short-TTL/browser-bound (3 artifact mới: migration `auth_login_state`, route issue login-state, callback consume) — bổ sung cho (không thay thế) `sameOriginRequest()` hiện tại.
  2. **SI-3 — Explicit tenant-filter policy:** chốt làm **policy bằng văn bản** (mọi query tenant-scoped mới trên bề mặt auth/onboarding phải dùng CẢ `withTenant` LẪN predicate `tenant_id` tường minh) + **PORT code fix round-07** (`onboardingSnapshot`) từ v2 sang v3 (base `feat/phase1-fable5` không có).
  3. **KMS/secret source wiring (historical pre-merge gap):** **đã chốt 2026-07-06 (OQ-2): AWS KMS** cho staging/prod, dev local giữ fallback `ENCRYPTION_KEY`; runtime delivery qua encrypted-env boundary, không phụ thuộc Fly. Helper dùng chung đã land trong Auth v3; provider port Google/email phải reuse.
  4. **SI-2 — Keyed hash cho `account_identities.platform_user_hash`** (layer **web-auth**, KHÔNG phải `channel_identities.platform_user_lookup_hash` — hai cột khác tầng, xem bảng phân biệt trong invariant table §1): thay `sha256("telegram:"+id)` trần hiện tại (round-09 finding — brute-forceable vì TG user id entropy thấp, enumerable) bằng keyed HMAC; nguồn key đã chốt ở gap 3.
  Các SI còn lại (SI-4 logout fail-closed, SI-5 shared rate-limiter, SI-6 creation-race idempotency, SI-7 session rotation, SI-8 onboarding_steps recency dedupe) đã được **validate ở v2 reference (`feat/auth-onboarding-v2 @7407caa`)** — nhưng code/test đó **KHÔNG có trên base `feat/phase1-fable5`** (đã verify git). v3 phải **PORT/reimplement + giữ test trong manifest scope**, KHÔNG phải chỉ pin regression.
- **Lý do:** Gate class-aware autopilot coi auth/security/PII là **STRICT** (zero finding bất kể P-level). Một bảng bất biến tường minh, bám sát spec Reviewed + toàn bộ evidence trail v2 (9 round), giúp v3 build đúng ngay từ đầu thay vì lặp lại chu kỳ phát-hiện-rồi-vá-từng-round của v2.
- **Hệ quả:** `auth-onboarding-v3` (manifest mới) phải cover đủ 8 SI trong scope — **tất cả PORT/reimplement vì base không có auth code**. **Spec-pin (gỡ deadlock):** Phase A KHÔNG sửa spec; **Phase B ĐƯỢC pin 4 gap vào `_tech.md`** sau khi founder answers đã record (xong 2026-07-06) — đây là bổ sung phần **chưa đặc tả**, không phải sửa phần đã Reviewed. DD-31 giữ 🟡 tới khi v3 merge 2 round clean; việc pin gap **không** chờ DD-31 ✅.
- **Founder quyết định 2026-07-06:** OQ-1 → **giữ nguyên scope Phase-1** (TG Login + web-account fallback only; DD-13 vẫn 🟡, không mở rộng Google/email-password trong v3). OQ-2 → **AWS KMS** (staging/prod; `ENCRYPTION_KEY` fallback dev). OQ-3 → **giữ DD-31 🟡** tới khi `auth-onboarding-v3` merge với 2 round codex clean liên tiếp, mới chuyển ✅. Chi tiết đầy đủ: `BE/auth-security-invariant-table.md §5`.
- **⚠️ Cập nhật 2026-07-10 (DD-37):** **OQ-1 đã bị đảo.** Telegram bị bỏ khỏi phạm vi (DD-37) ⇒ **không còn TG Login**; auth phase-1 = **Google + email-password** (DD-13 nay ✅). SI-2 keyed-hash áp cho `google.sub`/email thay cho `telegram:id`. Auth-onboarding v3 scope phải cập nhật: bỏ Telegram adapter, thêm Google/email adapter; các SI-1..SI-8 còn nguyên hiệu lực nhưng "telegram user id entropy thấp" (round-09 finding) nay là moot — vẫn giữ keyed HMAC cho nhất quán.
- **⚠️ Cập nhật 2026-07-10 (trạng thái merge):** **v3 đã MERGE vào `main@1eb6f60`** (`5b1193b`) — Telegram-era, kèm migrations `0012/0013`, **KMS pepper client** (`37296ef`), `SECURITY DEFINER search_path` fix (`3ce516f`), tests. Nên DD-31 chuyển từ 🟡 "chờ v3 merge" → **✅ Merged (Telegram-era)**. Mô tả "chưa có code KMS / SI phải build mới" trong `BE/auth-security-invariant-table.md §2/§3` là **pre-merge, đã đánh dấu lỗi thời**. **Residual thực sự:** audit SI-1..SI-8 trên code đã merge + **thay provider Telegram Login → Google/email** (DD-37/DD-13, chưa implement) — theo dõi như hạng mục con của DD-13, không phải DD-31 mở lại.

## DD-32 — Channel-first booking funnel · ✅ Chốt (2026-07-13) Option A — `../dd-32-booking-funnel-analysis.md`
> **Chốt (owner): A — phễu MỀM.** Guest book free/paid qua common join service; còn slot/unlimited → active+charge, full → waitlisted/no-charge tới promotion (DD-45). Link chỉ mở giá trị + CTA. Web-auth cho paid booking là Option C và **không được áp dụng** nếu DD-32 chưa reopen.

- **Ba mức:** guest (channel identity) → book; linked-lite (transactional one-time `/link` code confirmed) → hook; web-auth (`accounts` + verified `account_identities`) → app/deep actions.
- **Ranh giới identity-money:** linked-state/confirmation riêng lẻ không tự cấp quyền claim membership cụ thể có tiền. Claim/merge defer nguyên DD-50 evidence matrix, conflict checks, explicit confirmation + audit. DD-26 chỉ chặn persist alias/name/claim-suggestion khi chưa confirm; không biến soft key thành proof.
- **Lý do:** Option A giữ acquisition-first DD-29 và không thu hẹp CCJ guest path. B/C là phương án đã loại; muốn bật bất kỳ linked gate nào phải reopen DD-32.
- **Provider order:** DD-33 Facebook trước, DD-14 Zalo sau; khi chưa có social login, transactional one-time `/link` code là fallback.
- **Hệ quả:** build slice thêm CTA/deep action vào Zalo/Messenger, pin ba mức trong identity/funnel docs và viết BE funnel spec. `feature_cross_club_join` regression guest-vẫn-book free/paid phải assert cả hai capacity outcome (active→charge; full→waitlisted/no-charge); không tạo đường booking song song hoặc linked-tier gate.

## DD-33 — Facebook Login / Messenger account-link như web-auth provider · 🟡 Đề xuất (phase-1)

> **2026-07-10 (owner, cùng DD-37):** Nâng lên **phase-1**. Vì Messenger nay là kênh MVP (DD-37) và feature-4 yêu cầu "link Plexco account ↔ Facebook", Facebook Login + Messenger account-link nằm **trong phase-1 (P2.5)**. Vẫn 🟡 vì phụ thuộc **App Review / FB Business Verification** — rủi ro lịch (§13 BRD Risks). Nếu App Review chậm → degrade sang transactional one-time `/link` code thủ công.

- **Bối cảnh:** DD-13 bao **Google / email-password** (auth phase-1). DD-14 bao **Zalo Login**. Facebook Login là provider riêng cho **kênh Messenger phase-1** + link account (feature-4).
- **Cần chốt:** (1) Bật **Facebook Login** như một `account_identities.platform='facebook'` provider (verify stable FB user id, hash/encrypt, thêm enum/check migration); (2) Facebook Login có phụ thuộc **FB Business Verification / App Review** đang pending không; (3) FB Login và Messenger PSID là hai subject khác nhau, chỉ gắn về cùng `person` qua verified account identity hoặc transactional one-time `link_code`, **không** auto-link chéo.
- **Hệ quả:** Là đường tạo linked-state Facebook cho DD-32; nếu App Review chặn → dùng transactional one-time `/link` code. Cập nhật identity/web-auth specs khi gate provider pass; không đụng core `Person`/`Membership`.

---

## DD-34 — Plexco Global KB plane + union retrieval (KB-club ∪ KB-Plexco) · 🟡 Approve-in-principle P7 (2026-07-13) — `../dd-34-36-kb-platform-analysis.md`
> **Duyệt hướng** với các guard đã nêu (grant-isolated + scanner PII). **Chi tiết + patch DD-21 khi build P7.** Không chặn MVP.

- **Bối cảnh:** Club Assistant đã chốt (DD-16..28) chỉ bao **KB per-CLB tenant-private**; trợ lý chỉ biết KB của đúng club. Owner (06/07) muốn trợ lý trả lời cả câu hỏi **về chính nền tảng Plexco** (tính năng, cách dùng, chính sách chung) — không có plane cho tri thức dùng chung không thuộc tenant nào.
- **Quyết định (đề xuất):** Thêm plane **GLOBAL read model** `platform_kb_*` (`platform_kb_sources/documents/chunks`) — **KHÔNG có `tenant_id`**, do process **platform-admin** ghi, role `app` chỉ **`GRANT SELECT`** (cô lập-bằng-grant như DD-12/`readonly`, KHÔNG vào RLS list `0009`). Mở rộng `searchKnowledgeBase(tenantCtx, query)` thành **union 2 nhánh**: `kb_chunks` WHERE tenant (RLS) ∪ `platform_kb_chunks` (global), hợp nhất RRF, gắn nhãn scope; **precedence club > platform** khi trùng chủ đề (`bot_configs.include_platform_kb`/`platform_kb_weight`).
- **Quan hệ với DD-21 (extension, KHÔNG "nguyên vẹn"):** DD-34 **mở rộng nguồn grounding** của DD-21: grounding vẫn **chỉ KB**, nhưng **allowed KB sources** mở từ `kb_chunks(tenant)` → `kb_chunks(tenant) ∪ platform_kb_chunks`. **Live-context (DD-28) vẫn tách riêng, không trộn.** Khi DD-34 ✅ **phải patch DD-21** + Club Assistant specs (`feature_club_assistant.md` bất biến "KB prompt = chỉ `kb_chunks`" · `BE/feature_club_assistant_tech.md` §5) để phản ánh nguồn union — đây là điều kiện promote, không được để DD-21 mâu thuẫn.
- **Lý do:** Tri thức nền tảng dùng chung mọi club → 1 nguồn, cập nhật đồng loạt (không nhồi-trùng-lặp N club); có tiền lệ bảng global trong feature (`embedding_cache`).
- **Cô lập & guard (bảng SELECT cho mọi tenant nên phải chặt):** thiếu `tenant_id` chỉ ngăn **routing/association** — **KHÔNG** tự ngăn nội dung tenant bị ingest **nhầm** vào `content`. Vì `platform_kb_*` đọc-chung mọi tenant, `platform_kb_*` **KHÔNG ĐƯỢC chứa** (không phải "không thể chứa") dữ liệu tenant/PII ⇒ cần guard nhiều lớp: (1) **source allowlist** — chỉ ingest tài liệu sản phẩm Plexco (platform-docs-only), không nhận nguồn tenant; (2) **admin review** trước khi `status='active'`; (3) **scanner + test bất biến** assert `content` không chứa tenant identifier/PII pattern (SĐT/email/`pay_code`/tên roster). Grant: role `app` chỉ SELECT; ghi bởi role platform-admin.
- **Hệ quả:** Test bất biến: platform table không `tenant_id`; role `app` không ghi được; **scanner PII/tenant-id trên `content` = xanh**; union không rò KB club A↔B; câu hỏi nền tảng nhận chunk platform. Chi tiết `proposals/plexco-global-kb-and-kb-autosync.md §3`. **Không** sửa spec Reviewed tới khi ✅ (khi ✅ mới patch DD-21 + Club Assistant specs).

## DD-35 — Auto-derive KB-club từ dữ liệu canonical · 🟡 Approve-in-principle P7 (2026-07-13) — `../dd-34-36-kb-platform-analysis.md`
> **Duyệt hướng** (field-whitelist, cấm ledger/PII). Chi tiết khi build P7.

- **Bối cảnh:** KB-club hiện tại là host **nạp thủ công** (`kind ∈ faq/doc_upload/pasted/url`). Owner muốn KB **tự cập nhật theo update của từng club** — không bắt host nạp lại khi đổi mô tả/luật/chính sách.
- **Quyết định (đề xuất):** Thêm `kb_sources.kind='derived'`. Khi field **mô tả** canonical của club đổi → **command→outbox→projector** (HR3) tự dựng lại KB document từ **field-whitelist** (tên/mô tả CLB, nội quy, chính sách giá dạng text, khung lịch, hướng dẫn tham gia). 1 aggregate canonical : 1 derived source (upsert theo `derive_key`), idempotent `content_hash`.
- **Lý do:** Giữ KB tươi mà không tăng việc cho host; canonical là nguồn sự thật, KB-derived là read model dẫn xuất (không multi-master).
- **Ranh giới (giữ HR2/DD-21/DD-28):** **CẤM** derive `charges`/`memberships`/`persons`/SĐT/`pay_code`/số dư vào KB. **KHÔNG** derive dữ liệu vận hành realtime (slot buổi cụ thể, ai join) — cái đó là **DD-28 live-context tool**, không phải KB. Precedence: host-manual > derived (host tắt được từng mảng derived).
- **Hệ quả:** Thêm projector + field-whitelist (enumerate ở BE tech). Test bất biến: derived doc ⊆ whitelist (không ledger/PII); đổi field non-whitelist → KB không đổi; derive qua outbox (không ghi KB thẳng). Chi tiết proposal §4. **Không** sửa spec Reviewed tới khi ✅.

## DD-36 — Freshness: scheduled re-crawl + re-ingest KB-Plexco · 🟡 Approve-in-principle P7 (2026-07-13) — `../dd-34-36-kb-platform-analysis.md`
> **Duyệt hướng** (pg-boss cron, change-detect). Chi tiết khi build P7.

- **Bối cảnh:** "Update KB theo update của **Plexco**" + nguồn URL cần tự làm mới; hiện ingest chỉ chạy khi host thao tác.
- **Quyết định (đề xuất):** (a) **KB-Plexco** re-ingest khi team Plexco đổi tài liệu sản phẩm (change-detect `platform_kb_sources.content_hash`); (b) nguồn `kind='url'` (tenant + platform) **scheduled re-crawl** bằng **pg-boss cron**: refetch → so `source_etag`/`content_hash` → chỉ re-ingest khi đổi. Thêm field freshness (`last_synced_at`, `next_sync_at`, `sync_interval`, `source_etag`).
- **Lý do:** Tự cập nhật theo nguồn thay đổi mà idempotent (INV-6) + bounded (P14); provider ngoài txn (P9); đổi model → P12.
- **Hệ quả:** Nguồn URL fail khi re-crawl → giữ KB active cũ + `status='error'` + cảnh báo (không phá KB). Metric staleness/DLQ (P15). Chốt nguồn KB-Plexco (docs/ vs CMS) ở tech spec. Chi tiết proposal §5. **Không** sửa spec Reviewed tới khi ✅.

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
  1. **Hai loại channel, RLS khả thi:** `chat_channels.channel_type ∈ {club, dm}`. **Club** channel có `tenant_id NOT NULL` → RLS **tenant-private** (như mọi bảng tenant). **DM** channel có `tenant_id NULL` → RLS **person-self**: chỉ đọc/ghi được nếu current person ∈ `chat_members(channel)`. **Không** để DM row phụ thuộc `tenant_id`. Policy tách theo `channel_type` (hoặc 2 policy: `tenant_id IS NOT NULL AND tenant match` HOẶC `EXISTS membership current person`). Không trộn một predicate `tenant_id` chung cho cả hai.
  2. **DM đúng 2 người (hard guard):** DM channel có cột `dm_key` = cặp `person_id` đã sort (`least:greatest`), **UNIQUE** trên (channel_type='dm', dm_key) → không tạo trùng DM. `chat_members` của DM channel bị chặn ở **đúng 2** (trigger/CHECK đếm member khi type='dm'). Tạo message DM phải re-check membership.
  3. **Dedupe độc lập với author:** message idempotency dùng **`client_msg_id` UNIQUE per `(channel_id, client_msg_id)`** — KHÔNG dựa vào `author_person_id` (assistant/system có `author_person_id NULL` theo DD-20 vẫn dedupe được). `author_type ∈ {member, assistant, system}`; `author_person_id` NULL khi assistant/system (CHECK shape như DD-20).
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

> Phân tích đầy đủ: `../dd-41-session-fields-gating-analysis.md`. Chi tiết SQL/enforce + player-attribute sources → **slice riêng** khi build (không nhồi vào DD).

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

## DD-42 — Subsystem no-show / attendance / reliability · ✅ Chốt (2026-07-13) per-tenant — `../dd-42-reliability-analysis.md`
> **Chốt (owner): per-tenant.** Attendance trên `players` (`present|no_show|excused|unknown`); reliability aggregate trên `memberships` **per-tenant** (RLS, không lộ xuyên CLB); policy per-tenant deprioritize (hạ waitlist DD-45)/ban. **KHÔNG public.**

- **Bối cảnh:** Ảnh 1 (Create Meet, app club-centric) có filter **"No show - Deprioritize"** và **"No show twice - Banned 1 month"** — hệ thống điểm danh/độ tin cậy của club. Plexco: `players.status` chỉ `active|left` (không attendance/no-show); `memberships` không có reliability/score. Bot reference (Bestminton) có khái niệm này nhưng **chưa** đưa vào canonical/spec.
- **Quyết định:** Subsystem **RIÊNG, per-tenant** (không nhét vào session CRUD):
  - **Attendance** trên `players`: `attendance ∈ {present|no_show|excused|unknown}`, host mark sau buổi.
  - **Reliability** tổng hợp trên `memberships`: đếm no-show gần đây / score.
  - **Policy per-tenant** (setting): vd deprioritize khi 1 no-show; ban N ngày khi 2 no-show liên tiếp. Deprioritize = hạ ưu tiên join/waitlist (DD-45); ban = chặn join tạm thời (state có hạn trên membership).
- **Lý do:** Giá trị vận hành thật (giảm no-show phá kèo) — điểm mạnh của bot cũ; nhưng ảnh hưởng roster/eligibility → phải là subsystem có test riêng, không phải field lẻ.
- **Hệ quả:** Bảng/cột mới (attendance + reliability + tenant policy) — migration mới; command `markAttendance`; đường join phải check ban; waitlist ordering (DD-45) đọc reliability. Attendance/reliability **đã chốt TENANT-scoped (RLS)**, **KHÔNG ra public** (như nợ/PII); propagation vào spec/schema thực hiện cùng build slice.

## DD-43 — Nhãn/hạng thành viên + audience targeting khi announce · ✅ Chốt (2026-07-13) — `../dd-43-membership-tags-analysis.md`
> **Chốt — 2 contract RIÊNG:** (1) **`membership_tags`** (many-to-many, per-tenant, host-defined) chỉ cho **notification audience** khi announce (MVP); (2) **join eligibility = DD-41 gating + join_policy** (KHÔNG dùng tag gate join MVP). Bỏ `membership_tier` khỏi MVP; "join sớm theo tag" = slice sau. **Public không lộ tag**; level dùng DD-08.

- **Bối cảnh:** Ảnh 1 có chip lọc thành viên: **Bronze / Runner Up / Champions / Membership / Supporter / level 1–8** — phân hạng/nhãn thành viên của club, dùng để **nhắm đối tượng** khi tạo/announce kèo. Plexco `memberships` chỉ có `status` (`active|guest|left|merged`) + `pay_code`; **không** có tier/segment/label.
- **Quyết định:** Thêm **`membership_tags` many-to-many, per-tenant, host-defined**. MVP chỉ dùng tag để chọn **notification audience khi announce**; join eligibility vẫn do DD-41 + `join_policy`. Không có `membership_tier` hay tag-gated early join trong MVP.
- **Lý do:** Cho host điều phối kèo theo nhóm (VIP/supporter/theo trình độ) như app đối thủ; tái dùng `memberships` hiện có, **không** tạo identity song song (§P6).
- **Hệ quả:** Schema tag tenant-scoped + RLS; tích hợp bước announce (`session_surface_refs`/announcement); **public projection KHÔNG lộ tag nội bộ**. Thuộc `feature_multi_tenant`/membership + `feature_session_management` (bước announce). Level tiếp tục dùng một nguồn DD-08; propagation thực hiện cùng build slice.

## DD-44 — Invite-link token cho kèo private · ✅ Chốt (2026-07-13) — `../dd-44-invite-token-analysis.md`
> **Chốt + redemption:** `session_invite_tokens` — **entropy ≥128-bit**, lưu **hash**, **bound `session_id`+`tenant_id`**, `expires_at`/`max_uses`/`used_count`/`revoked_at` (revoke/rotate). Mở link → join kèo **private**, vẫn qua `join_policy`+gating (DD-41). **`used_count` tăng khi REDEEM thành công** (không phải lúc mở link); **lock+idempotency lượt cuối** (`FOR UPDATE`). Token = MỜI, không hạ `visibility`; venue ẩn tới join (DD-06).

- **Bối cảnh:** Ảnh 4 (Create Game) có **"Invite Only"** = *"restricted to invited players and can be accessed by anyone via shared link"*. Plexco có `visibility` (private/public) + `join_policy` (open/approval) + `join_requests`, nhưng **KHÔNG** có token link chia sẻ cho kèo private (private hiện = ẩn khỏi marketplace, chưa có đường mời qua link).
- **Quyết định:** Thêm **invite-link token per-session** (`session_invite_tokens`): entropy ≥128-bit, chỉ lưu hash, bound tenant+session, có expiry/max-use/revoke/rotate. Ai có link mở được trang join kèo **private**, vẫn đi qua `join_policy` + DD-41; token là cách **MỜI**, không hạ `visibility`. `used_count` chỉ tăng khi redeem thành công, dưới row lock/idempotency cho lượt cuối.
- **Lý do:** Đáp ứng use case "mời nhóm riêng qua link" phổ biến; giữ private khỏi marketplace nhưng vẫn share được.
- **Hệ quả:** Bảng token tenant-scoped + RLS; route join-by-token; venue/PII vẫn ẩn tới khi join/approve (**DD-06**); rate-limit/anti-scrape. Test expiry/revoke/max-use/concurrent-last-use/idempotency/no-leak; propagation vào session/cross-club specs thực hiện cùng build slice.

## DD-45 — Model hoá waitlist (đóng gap SES-UC-9) · ✅ Chốt (2026-07-13) — `../dd-45-waitlist-analysis.md`
> **Chốt — lifecycle:** open join hoặc approval khi full → `waitlisted`, không chiếm capacity/charge/venue; state-shape CHECK buộc position dương chỉ có ở waitlisted. Promotion lock session, re-count active, re-check eligibility/ban + assert no existing charge, derive amount trước mutation, fill toàn bộ `slots_max-active_count` hoặc mọi eligible khi `slots_max→NULL`, tạo đúng một charge + clear position + notify atomically. DD-39 KMS/decrypt/price-derivation fail → candidate giữ waitlisted/no-charge/no-venue; ghi audit `WAITLIST_CHARGE_DERIVATION_FAILED` + đúng một `waitlist.charge_derivation_failed` outbox event cho session-retry worker và owner-alert projector; opener vẫn commit và xét candidate kế. **Rejoin `left` theo DD-49:** chạy join bình thường, carry-over obligation khi chưa refund hoặc append lifecycle khi đã refund; chỉ fallback `REJOIN_REQUIRES_REVIEW` khi correction core chưa land/không chứng minh được disposition. Total order = position/joined_at/id; ineligible/charge-conflict giữ queue; decrease dưới active roster vẫn reject.

- **Bối cảnh:** `feature_session_management` FE spec **SES-UC-9** hứa *"leave trước giờ chơi → slot freed, waitlist auto-promote"*, nhưng `players.status` chỉ có `active|left` (`players_status_chk`) — **chưa model** waitlist. Cả 2 app đối thủ ngầm có khái niệm đầy chỗ.
- **Quyết định:** Mở `players.status` thêm `waitlisted`, `waitlist_position`, CHECK `waitlisted ⇔ position non-null` + position dương, queue index và total order `position,joined_at,id`. Open join/approval khi full cùng tạo waitlisted row, không charge/venue. Queue entry/deprioritize gán `max(position)+1` dưới session lock; rank không cần contiguous/monotonic lịch sử. Leave/capacity+ re-count active rồi promote theo vòng lặp tới khi đầy; finite→unlimited promote mọi eligible. Promotion chỉ mutate sau khi assert chưa có charge và derive amount thành công; existing charge hoặc DD-39 derivation failure đều giữ candidate waitlisted, audit/owner-review, tiếp tục candidate kế. Derivation failure ghi một canonical outbox event keyed by session+player+trigger+reason; retry và alert là consumers, không tự re-derive; không rollback opener. Capacity decrease không promote/evict và `slots_max < active_count` → `CAPACITY_BELOW_ROSTER`.
- **Rejoin (DD-49 supersedes default fail-closed):** Existing `active|waitlisted` trả current outcome idempotently. Existing `left` chạy lại eligibility/capacity/ban; chưa refund thì carry-over obligation/allocation hiệu lực, đã refund thì append obligation lifecycle mới trong cùng canonical aggregate. Live UNIQUE charge/player/session cấm tạo charge đôi. Nếu correction core chưa land hoặc không chứng minh được disposition thì mới trả `REJOIN_REQUIRES_REVIEW`; không reopen/void/reset charge mù.
- **Lý do:** Đóng gap giữa spec đã Reviewed và data model thực tế; nhu cầu thật khi kèo full.
- **Hệ quả:** Migration status+position CHECK+index; capacity/projector chỉ đếm active; triggering command + canonical failure-event key cung cấp idempotency nên retry không double-promote/charge. Product/BE session + cross-club + DD-39 charge-derivation + notification specs đã pin full→waitlist, rejoin guard và derivation-failure behavior; schema/code migration vẫn pending build.

## DD-46 — Kèo không thuộc CLB (Skip Club / personal meet) · ✅ Chốt (2026-07-13, owner) — Option B "personal tenant"

> Phân tích đầy đủ: `../dd-46-skip-club-analysis.md`. **Chốt: Option B — personal tenant** (phase-1).

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

## DD-47 — Social follow graph (person↔person) · ✅ Chốt framework (2026-07-13), build P4+ — `../dd-47-follow-graph-analysis.md`
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
  - **Thông báo follow-request (impl-gap):** notify tới followee là **person-directed GLOBAL**; hạ tầng `notification_intents`/`outbox_events` hiện **tenant-scoped** (`tenant_id NOT NULL`) → **KHÔNG** cover trực tiếp. Chọn khi build: (a) đường notify global mới, hoặc (b) tái dùng SSE person-self / in-app inbox (DD-38). Ghi open item ở `_tech`.
- **Lý do:** Follow là quan hệ xã hội cross-tenant giữa người thật → thuộc **global plane**, gắn `persons` anchor, **KHÔNG** tạo bảng identity song song (§P6). Một model cạnh-có-hướng + `pending/accepted` phục vụ **cả** public (auto) lẫn private (approval).
- **Hệ quả:** Migration sau profile fields; no-table-grant + narrow functions + grants tests. Merge phải lock incident edges, canonicalize/drop-self/collapse duplicate (`accepted>pending`) trước update survivors để không vỡ UNIQUE. Follow path không rò tiền/PII/roster. Framework đã propagate vào user-settings/player-view docs; migration/code chờ P4+.

## DD-48 — Profile visibility (public/private) + cross-user profile gating · ✅ Chốt framework (2026-07-13), build P4+ — `../dd-48-profile-visibility-analysis.md`
> **Chốt (owner): duyệt framework, build P4+.** User mới default public; existing profile backfill private trước khi set default/NOT NULL. Social profile chỉ trả approved fields có canonical source; avatar/sports/aggregate excluded tới khi có model. Self dùng `/api/me`; host operational data dùng tenant path riêng. Private chỉ mở social fields cho accepted follower; không nới RLS/tiền. **5 open item chốt lúc build.**

- **Bối cảnh:** Plexco chưa có visibility flag hay cross-user social profile; `feature_player_view` hiện chỉ person-self.
- **Migration:** add nullable/no-default → existing=`private` → set new default=`public` → NOT NULL/CHECK trong một transaction. Không public hoá ngầm profile cũ.
- **Approved social fields:** `display_name`; `username` khi DD-39 migration tồn tại; `plexco_since` coarse từ `persons.created_at`. Avatar/sports/aggregate default exclude; không suy từ memberships/sessions.
- **Gating:** self đi `/api/me`; public hoặc private+accepted follower nhận sourced fields; mọi trường hợp khác (kể cả teammate/host non-follower) nhận fixed minimal card không có profile fields.
- **Operational split:** host vẫn đọc roster/suy giá/charge qua tenant-scoped APIs dưới RLS. Host role không widen social serializer; money/PII không bao giờ vào `GET /api/persons/:id/profile`. Private không gỡ user khỏi roster và không ẩn `host_display_name` trên public session.
- **Hệ quả:** User-settings product/BE + player-view boundary đã pin; schema/code chờ P4+. Tests cover existing-private/new-public migration, unsupported-field absence, social-vs-operational separation và no-leak.
- **Open:** (1) stats/aggregate cross-tenant; (2) follower counts/lists; ~~(3) DM~~ → **✅ chốt bởi DD-55** (phase-1 open DM, phase-2 follow-gated + request box); (4) block; (5) roster display trong shared session.

---

## DD-49 — Money correction lifecycle (đổi giá / leave-cancel-refund / rejoin) · ✅ Chốt (2026-07-16)

> **Chốt (owner 2026-07-16):** resolve SES-OQ-1 + PAY-OQ-3; thay điểm "left rejoin fail-closed" của DD-45.

- **Bối cảnh:** tiền đã ghi sổ (charge/allocation) rồi thay đổi phía sau: host đổi giá, player rời/host huỷ, player quay lại. Cần policy trước khi build correction flows (S5/S7).
- **Quyết định:**
  1. **Đổi giá:** host chọn per-change giữa (a) **áp chênh lệch cho obligation hiện có** — thu thêm/trả lại phần chênh; hoặc (b) **grandfather** — giá mới chỉ áp cho obligation tạo sau. **Không tự động** thu bù/hoàn tiền. Policy (a) ghi **signed obligation adjustment append-only**; không mutate `charges.amount_due`. `payment_allocations.source='reversal'` chỉ dùng khi đảo một allocation tiền đã nhận, **không** dùng như price-adjustment thay thế. Mọi consumer đọc một helper canonical `effectiveAmountDue/effectiveBalance`; tên bảng/API cuối cùng chờ design-probe.
  2. **Leave/cancel:** host huỷ kèo đã thu tiền → **hoàn toàn bộ**. Player tự rời: chưa paid → void charge, không vấn đề; đã paid → hoàn **toàn bộ / một phần / không** theo policy CLB, host quyết + ghi lý do; **player có quyền gửi refund request** cho host. Refund thật host thực hiện ngoài + log opaque reference (Plexco không giữ tiền — PRD:262); reversal chỉ sửa ledger.
  3. **Rejoin:** `left` → join lại = **logic join bình thường** (còn slot + qua eligibility/gating/ban). Nếu khi leave đã paid và host **chưa refund** → **carry-over** obligation/allocation hiệu lực, KHÔNG tạo charge đôi. Nếu host **đã refund** → append obligation lifecycle mới trong cùng canonical aggregate. Không mặc định INSERT row `charges` mới: live UNIQUE `(tenant_id,session_id,player_id)` chưa biểu diễn lifecycle thứ hai; nếu correction core chưa land hoặc không chứng minh được disposition thì fail-closed `REJOIN_REQUIRES_REVIEW`.
- **Lý do:** cho host quyền chọn thay vì ép một policy; giữ ledger immutable; rejoin thân thiện người dùng thật (lỡ tay leave, đổi ý) mà không mất dấu tiền.
- **Hệ quả:** DD-45 điểm `left` rejoin fail-closed mặc định **bị thay**, nhưng `REJOIN_REQUIRES_REVIEW` vẫn là fail-closed fallback khi correction core chưa có hoặc disposition không chứng minh được. Trước schema/API: design-probe đủ {price up/down} × {unpaid/partial/paid/refunded} × {leave/cancel/rejoin}; pin idempotency key, immutable entries, participation lifecycle và một helper balance canonical. Live UNIQUE charge/player/session là constraint phải giải, không được lách bằng duplicate row hoặc mutate charge cũ.

## DD-50 — Phase-1 không thu SĐT; khoá mạnh = verified email + link_code · ✅ Chốt (2026-07-16)

> **Chốt (owner 2026-07-16):** điều chỉnh DD-01 + HR4; resolve ID-OQ-1.

- **Bối cảnh:** DD-01/HR4 dựa trên SĐT verified (OTP) làm khoá merge/claim. Founder quyết phase-1 **không thu SĐT** — dùng email verified.
- **Quyết định:** (1) phase-1 không thu SĐT user; **email verified bắt buộc** cho account web. Email/password chỉ thành strong proof sau verify-token hash-at-rest, TTL, single-use. Google chỉ thành strong proof khi verify đầy đủ OIDC signature + exact issuer + audience/client ID + nonce + `exp/iat` và claim **`email_verified === true`**; không trust email/profile field từ client. (2) **Khoá mạnh HR4** cho claim membership có nợ = verified account email (web) **hoặc `link_code` deterministic dùng-một-lần** (bot Zalo/Messenger). Consume `link_code` phải transactionally lock row, re-check TTL/action/source identity, increment attempts atomically, set `consumed_at` once và tạo merge plan; schema tồn tại **không** đồng nghĩa runtime đã implement. (3) **Tuyệt đối không** cho claim bằng tên/alias — giữ fail-closed. (4) Phone fields (`persons.phone_enc/lookup_hash/verified_at`) **giữ dormant** — merge signal tương lai, không xoá schema. (5) Không tích hợp SMS OTP phase-1.
- **Lý do:** giảm friction + chi phí SMS + thu hẹp scope PII (A3); link_code deterministic vốn mạnh hơn fuzzy phone-match cho claim.
- **Hệ quả:** HANDOFF HR4 wording đổi "OTP/SĐT-verified" → "verified factor (verified account email hoặc link_code)"; `feature_identity`/`feature_web_auth_onboarding` cập nhật claim/merge path + proof-evidence matrix; cross-channel merge suggestion theo phone không còn ở phase-1. S4 chưa code-ready tới khi credential lifecycle + revoke-all-affected-sessions và OIDC/link-code tests được pin.

## DD-51 — Host Pro lifecycle: trial/grace/refund/override · ✅ Chốt (2026-07-16)

> **Chốt (owner 2026-07-16):** resolve BIL-OQ-2 (Item 2 founder brief).

- **Quyết định:** (1) **Trial 14 ngày**, remind khi còn **2 ngày**; hết trial không thanh toán → **khoá ngay** (về `free`), không grace. (2) Subscription đang trả mà **trễ invoice → grace 7 ngày** (past_due) rồi suspended. (3) **Huỷ giữa kỳ:** hoàn **toàn bộ** nếu request refund trong **7 ngày kể từ khi thanh toán**; sau 7 ngày → không hoàn, dùng nốt tới hết kỳ. (4) **Manual override:** chỉ `PlatformAdmin`, max **7 ngày lịch**, bắt buộc reason + `ticket_ref` + `expires_at` + audit before/after, auto-expire, không gia hạn ngầm; thiếu field → fail-closed.
- **Hệ quả:** `subscription` state machine pin trial/past_due/suspended timing; migration `billing_overrides` cần `ticket_ref` riêng (không giấu trong `reason`); refund-window logic cần mốc `paid_at` per invoice. PAY-OQ-2 giữ nguyên: tenant suspended → ingest ON, auto-settle/notify OFF.

## DD-52 — Guest→full membership + manual ban · ✅ Chốt (2026-07-16)

> **Chốt (owner 2026-07-16):** resolve CCJ-OQ-2 + ID-OQ-3 (Item 4 founder brief).

- **Quyết định:** (1) Guest→full: **host invite/approve** và **player-request + host-approve** cùng tồn tại; auto-upgrade (sau N lần/paid) defer slice sau. (2) **Manual safety/discipline ban:** `TenantOwner` **+ co-admin** (amend 2026-07-16 theo DD-56), bắt buộc reason + evidence/reference, `expires_at` hoặc permanent, unban cùng nhóm actor; audit ghi rõ actor. (3) Ban **không auto-evict**: active giữ nguyên (muốn gỡ → command remove riêng qua DD-49 có preview tiền); waitlisted **giữ queue + bị skip** đúng DD-45.
- **Hệ quả:** storage manual ban **tách** khỏi reliability-ban DD-42 (không chung bảng/semantics expiry-actor); mọi join/promotion path gọi một **`evaluateJoinRestriction()`** core duy nhất (cùng chỗ với `evaluateSessionEligibility` DD-41).

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
- **Hard enablement gate phase-1:** host/support **không đọc DM** (DM person-scoped, `tenant_id` NULL theo DD-38); trước khi bật open-DM phải có **block** (enforce ở send/read/request boundary, idempotent, blocked pair không tạo/deliver message), **report** (reason + opaque evidence + abuse audit, không cấp host quyền đọc DM), per-sender/per-target rate-limit và spam throttling. Thiếu một gate → DM disabled fail-closed; đây không còn là optional build-time recommendation.
- **Còn mở:** CHT-OQ-2 — moderation granularity trong club channel (host xoá/ẩn message, mute member) — chốt lúc build chat slice.

## DD-56 — Co-admin capability · ✅ Chốt (2026-07-16)

> **Chốt (owner 2026-07-16):** resolve RTE-OQ-1; amend DD-52 ban actor.

- **Quyết định:** authorize bằng một registry action→capability canonical; adapter/API/UI chỉ hỏi registry, không rải `role === ...`. Default co-admin preset: `session.manage`, `content.manage`, `member.manage_routine`, `member.ban`, `money.read`, `money.mark_paid` (DD-25 preview+confirm+audit). Default owner-only: `role.manage`, `money.correct`, `money.refund`, `money.waive_or_void`, `bank_account.manage`, `connector.secret_manage`, `billing.manage`. Owner có thể grant từng sensitive capability **trừ `role.manage`** cho co-admin bằng explicit grant có actor/reason/expiry/audit; thiếu/expired grant → deny. Co-admin không bao giờ remove/demote owner/admin. Global split/relink DD-53 và billing override DD-51 vẫn PlatformAdmin-only.
- **Hệ quả:** DD-52 manual ban actor = TenantOwner + actor có `member.ban`; BE spec phải pin exact action matrix + deny tests cho từng sensitive action. Một blanket “admin/owner except roles” không còn là implementation contract.

---

## DD-57 — FE architecture principles (adopt từ Sporta) · 🟡 Đề xuất

> **Nguồn:** ported từ Sporta `architecture/frontend_architecture_flutter.md`; adapt stack Plexco (Next.js App Router + React, CSS-var tokens, không Tailwind). Chi tiết: `frontend-architecture.md`.

- **Bối cảnh:** docs FE Plexco đang ở mức token-only, chưa có tài liệu **kiến trúc code FE** (counterpart của `core-db-architecture-principles.md` cho BE). Sporta có doc FE architecture chặt (clean layering + 4-state rule).
- **Quyết định (đề xuất):** thêm `standards/frontend-architecture.md` định nghĩa 6 bất biến FE-INV-1..6: (1) **4-state rule** loading/ready/empty/error; (2) **tokens-only** (`var(--token)`, không hardcode); (3) **UI không chạm DB/tenantRepo** — đi qua `app/api/*` → service → `tenantRepo` (HARD RULE 1); (4) **i18n** `t(vi,en)` (HARD RULE 5); (5) **không tiền/PII vào client bundle/public route** (HARD RULE 2); (6) **API envelope** `{ error,message,code }`. Kèm folder-structure khớp `apps/web`, data-flow, error model, SSE realtime (DD-07), PR checklist FE.
- **Lý do:** đóng gap FE thiếu chuẩn kiến trúc; neo mọi bất biến FE về HARD RULES đã có, không tạo luật mới.
- **Hệ quả:** doc là 🟡 proposal — chưa gate build. Khi ✅: bổ sung lint (no-literal-color, no-`@plexco/db`-in-client), thêm vào PR template, cập nhật `channels/web/README §5/§6`.

## DD-58 — FE design→code pipeline `.pen`→pixel-perfect (adopt từ Sporta) · 🟡 Đề xuất

> **Nguồn:** ported từ Sporta `front-end/README.md` + handoff docs. Chi tiết: `../channels/web/frontend-pipeline.md` + 2 template `../templates/feature-dev/fe-handoff-template.md`, `fe-token-mapping-template.md`.

- **Bối cảnh:** Plexco có design SoT (`Plexco-DS-fable5.pen`) nhưng chưa có quy trình chuẩn từ `.pen` ra code pixel-perfect + truy vết ngược. Sporta có pipeline 5 bước + handoff/mapping template + luật source-comment.
- **Quyết định (đề xuất):** pipeline 5 bước **`.pen → handoff → token-mapping → code → verify`**; đọc `.pen` qua Pencil MCP; **CSS-variable mapping (KHÔNG Tailwind)** cho khớp `apps/web`; luật vàng: `.pen` = SoT, không suy đoán, 3-file-đồng-bộ, **`// Source: <screen>-token-mapping §X · handoff §Y` comment trên mỗi component** (song song luật BE `/** Source: feature_x_tech.md §Y */`). Kèm icon-rule 5 thuộc tính.
- **Lý do:** biến design-to-code thành quy trình lặp lại + audit được; giảm drift `.pen`↔code.
- **Hệ quả:** 🟡 proposal. Khi ✅: thêm bước handoff/mapping vào `feature-dev/feature-checklist.md`, tạo `docs/channels/web/handoff/` khi build màn đầu.

## DD-59 — Design-token benchmark method + usage-token layer (adopt từ Sporta) · 🟡 Đề xuất

> **Nguồn:** ported từ Sporta `docs/design/sporta-design-tokens-recommendation.md`. Chi tiết: `design-tokens-benchmark.md`.

- **Bối cảnh:** `design-tokens.md` là foundation tốt nhưng (a) token được assert không có phương pháp benchmark, (b) thiếu lớp **usage/component token** → dễ hardcode ở component, (c) tồn tại file token trùng `channels/web/design-tokens.md` (drift risk).
- **Quyết định (đề xuất):** thêm method-doc `design-tokens-benchmark.md`: quy trình luận token từ 5–7 app đối thủ (bảng benchmark → key insight → audit ✅/⚠️/🔄 → đề xuất), **KHÔNG bịa số liệu** (điền khi chạy thật); thêm **usage-token layer** (component token map về foundation token); **reconcile:** `standards/design-tokens.md` là SoT, `channels/web/design-tokens.md` chỉ trỏ về SoT.
- **Lý do:** token có căn cứ + có lớp component để chống hardcode; xoá nguồn drift.
- **Hệ quả:** 🟡 proposal (method, không thay giá trị token hiện tại). Khi ✅ + chạy benchmark thật: propagate delta vào `design-tokens.md` + bump version; sửa `channels/web/design-tokens.md` thành pointer.

## DD-60 — API reference convention (adopt từ Sporta) · 🟡 Đề xuất

> **Nguồn:** ported từ Sporta `docs/architecture/sporta-api-reference.md`. Chi tiết: `api-reference-convention.md`.

- **Bối cảnh:** API contract Plexco nằm rải trong từng `BE/feature_*_tech.md §3` + `channels/web/README §7`, chưa có convention thống nhất để aggregate thành một reference.
- **Quyết định (đề xuất):** convention chung: **auth-level legend** ⬜ Public / ✅ User / 🔑 Host-Admin / 🔒 HMAC-token; **response envelope** `{ data, meta }` / `{ error,message,code }` khớp `apps/web/lib/api-envelope.ts` + CLAUDE §4; **format 1-endpoint cố định** (heading + icon + jsonc block Request/2xx/4xx + side-effects). DTO field-whitelist (HARD RULE 2), tenant qua `tenantRepo` (HARD RULE 1); error money/security cite `business-rules.md`.
- **Lý do:** đọc/gộp API đồng nhất; error-code kỷ luật; neo về envelope + HARD RULES đã có.
- **Hệ quả:** 🟡 proposal. Khi ✅: mọi `BE/feature_*_tech.md §API Contract` mới theo format này; có thể sinh aggregate reference cho `apps/web` routes.

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 16/07/2026 | v1.39 | **Post-v1.38 authority reconcile:** DD-40 xoá lựa chọn synthetic bank transaction cho host-attested CK chưa ingest; pin hard boundary = dedicated allocation source migration + actor/opaque evidence, reject trước migration, exact DDL qua B1 design-probe. Reconcile body cũ DD-01→DD-50 và DD-45 rejoin→DD-49 để không còn hai contract hoạt động. Refresh Product/BE/HANDOFF/BUILD-STATUS/feature index/tracker/workbook authority sau full DD-49..56 propagation; DD-57..60 vẫn proposal, không gate build. |
| 16/07/2026 | v1.38 | **FE docs practices adopt từ Sporta (🟡 proposal, không gate build).** Thêm **DD-57** (FE architecture principles → `standards/frontend-architecture.md`, FE-INV-1..6), **DD-58** (design→code pipeline `.pen→handoff→token-mapping→code→verify` + 2 template + luật `// Source:` comment; CSS-var không Tailwind), **DD-59** (design-token benchmark method + usage-token layer + reconcile file token trùng), **DD-60** (API reference convention: auth legend + envelope + endpoint block format). Tất cả adapt sang stack Plexco (Next.js/React, CSS-var tokens, `apps/web`, HARD RULES) — KHÔNG copy nguyên Tailwind/Flutter. Doc-map HANDOFF §7 + README + `channels/web/README` cập nhật pointer. Nguồn: so sánh docs Plexco↔Sporta 2026-07-16. |
| 16/07/2026 | v1.37 | **Code-aware contract closure sau founder batch:** DD-49 giữ policy nhưng bỏ giả định row `delta/new charge`; pin append-only signed obligation adjustment + một canonical balance helper, storage/API chờ mutation-path design-probe vì live UNIQUE charge/player/session. DD-50 pin proof matrix Google OIDC (`iss/aud/nonce/exp/iat/email_verified`) + transactional `link_code` consume + credential lifecycle gate. DD-52 summary nhận amend actor. DD-55 nâng block/report/rate-limit thành hard enablement gate open-DM. DD-56 thay blanket role inheritance bằng exact capability registry + least-privilege defaults/delegation audit. Propagate full body Product/BE + tracker/HANDOFF/BUILD-STATUS. |
| 16/07/2026 | v1.36 | **Founder batch 2 (owner):** thêm **DD-54** (PII optional thu theo platform config trên CMS admin dashboard; field vận hành không config-off; KHÔNG thay legal review — SEC-OQ-2 giữ mở), **DD-55** (DM phase-1 open cho mọi user, phase-2 follow-gated + request box; media in-scope phase-1 full stack; host không đọc DM; resolve CHT-OQ-1/3 + DD-48 item 3; CHT-OQ-2 moderation còn mở), **DD-56** (co-admin = admin trừ role management; được manual ban — **amend DD-52** actor = TenantOwner + co-admin; resolve RTE-OQ-1). Note DD-33: App Review chatbot (pages_messaging) ≠ Facebook Login advanced access — C4 plan phải nộp đủ 2 nhóm permission. |
| 16/07/2026 | v1.35 | **Founder decision batch (owner, từ founder brief Items 2–9):** thêm **DD-49** (money correction: đổi giá host-choice delta/grandfather; host-cancel hoàn toàn bộ; player-leave hoàn theo policy CLB + refund request; **rejoin logic thường + carry-over paid charge** — thay left-rejoin fail-closed của DD-45), **DD-50** (phase-1 không thu SĐT; khoá mạnh HR4 = verified email + link_code; điều chỉnh DD-01; resolve ID-OQ-1), **DD-51** (Host Pro: trial 14d + remind 2d + khoá ngay; invoice grace 7d; refund window 7d từ paid; override PlatformAdmin 7d/ticket/audit — resolve BIL-OQ-2), **DD-52** (guest→full invite+request coexist; manual ban TenantOwner, không auto-evict, tách DD-42, `evaluateJoinRestriction()` core — resolve CCJ-OQ-2/ID-OQ-3), **DD-53** (identity recovery: PlatformAdmin freeze, 2-approval split, break-glass audit, strong proof, không rewrite ledger — resolve ID-OQ-2/ID-MERGE-1/RTE-OQ-2). **DD-39 addendum:** value set `male/female/other/undisclosed` (resolve USR-OQ-1). A7 (DD-18): giữ ⬜, owner ok khởi động due-diligence matrix; A8 (DD-34/35/36): giữ approve-in-principle. Propagation pending: HANDOFF HR4 + feature specs (session/payment/billing/CCJ/identity/user_settings/routing) — track ở `../pre-code-open-items-2026-07-16.md` D7. |
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
| 16/07/2026 | v1.33 | **DD-04 → ✅ Accepted (owner) — Option (c): co-locate compute + Postgres trên DigitalOcean** (App Platform + Managed PG HA-standby, VPC private, Singapore) **+ cost/fact closure.** Supersede đề xuất (a); đổi deployment target Fly→DO (không đảo DD-10). **Cost** chuẩn hoá theo 5–6 replica × 1 GiB: (c) = **`$121–133` core / `$202–254` money-safe** (đã cộng logs + encrypted offsite backup bắt buộc); premium core cùng tài nguyên vs Fly+DO chỉ `$20–25`. **Supabase** Team từ `$599` (có PrivateLink nhưng không uptime SLA; SLA chỉ ở Enterprise custom, auto-failover cần contract confirmation). **Pre-build gate §7.1:** verify SePay/ApiPay/Zalo/Messenger fixed-outbound-IP trước khi dựng DO App Spec (fail → fallback (a) Fly+DO). Mitigation bắt buộc: offsite backup + restore runbook. Record `../dd-04-hosting-final-decision.md`. Propagate BRD OD-4 / TDD / deployment-infra / security specs / env banner. |
| 16/07/2026 | v1.34 | **DD-04 Rev 2 — cost model đổi Day-1 baseline + trigger-based (record §8.2 PROPAGATION).** Thay số `$121–133 core / $202–254 money-safe` (v1.33) bằng **Day-1 baseline `$120–135`** (2 web + 2 discovery + 1 worker × 1 GiB + DO PG HA `$60.90` + Cloudflare Free + Sentry Developer + KMS `$1–3` + logs/R2 `$0–5` + egress `$0–8`; subtotal cố định `$118.90`) — **money-safe nhờ non-negotiables + read-isolation controls** (projection-role, bounded pool, reserved connection budget, CDN, circuit-breaker), KHÔNG cần read-replica/WAF-Pro/Sentry-Team Day-1. Read replica vật lý/WAF Pro/Sentry Team/worker-2/DB-resize = **trigger-based upgrade** khi telemetry chạm ngưỡng. Ephemeral staging `$8–18` → prod+staging `$128–153`. **Không đảo (c) hay DD-10; chỉ đổi cost model.** **Caveat money-system:** deferral chỉ an toàn khi read-isolation controls ship thật + trigger được giám sát. Propagate deployment-infra §9 (v1.7) + environments-setup + base-chat + dd-04-brief. Record `../dd-04-hosting-final-decision.md` §5/§8. |
| 13/07/2026 | v1.26c | **Per-DD detailed analysis files (toàn bộ DD còn lại).** Mỗi DD có file riêng theo template DD-02/41: DD-05/06/32/42/43/44/45/47/48 (session-model/marketplace/social) + **P7/external mới: DD-18 (`dd-18-llm-provider-analysis.md`), DD-34/35/36 (`dd-34-36-kb-platform-analysis.md`), DD-14/15 (`dd-14-15-zalo-spike-analysis.md`)**. Reconcile toàn bộ (analysis files ↔ decisions.md notes ↔ cluster quick-ref): DD-48 host-route-split + field-source (không "ngoại lệ host"/không avatar-sports), DD-32 identity-evidence (DD-26 không phải proof), DD-45 total-order+capacity-boundaries, DD-47 global-protected `0009`. Cluster doc = index. |
| 13/07/2026 | v1.26b | **DD cluster review-fix (2026-07-13).** DD-05: pending=no player/charge, **approve=money-write dưới RLS** (không "chỉ policy"). DD-32: A ⇒ **guest book paid được** (active outcome tạo charge; full waitlisted/no-charge theo DD-45); strong-proof chỉ cho **claim/merge membership có tiền** (≠ paid-booking); paid-booking-cần-web-auth = C (không chọn). DD-43: **tags-only cho notification audience**, join eligibility = DD-41 (bỏ tier khỏi MVP). DD-44: redemption contract (entropy, session/tenant-bound, revoke, used_count-on-redeem, lock lượt cuối). DD-45: waitlist lifecycle (no-capacity/no-charge/no-venue; promote tạo charge atomic; ordering+tie-break; skip-on-ineligible; capacity-decrease-no-promote). DD-47: `person_follows` = **global protected → grants `0009` SECURITY DEFINER**, không chỉ app choke-point. DD-48: approved-public-profile-fields (aggregate=open item); **migration backfill trước default public**. **Propagation:** cross_club_join CCJ-OQ-1, marketplace MKT-OQ-1/2, session_management SES-UC-9, channel_booking_funnel status, user_settings §7 → ✅. |
| 13/07/2026 | v1.26 | **Chốt loạt DD còn lại (owner).** **DD-05** per-session default open (approval→join_requests+re-check); **DD-06** area-only public, venue post-join; **DD-32** ✅ **Option A phễu mềm** (guest vẫn book; "linked"=OTP đủ hook, web-auth chỉ nhánh tiền; bật DD-33 trước DD-14); **DD-42** ✅ **per-tenant** reliability (attendance players / reliability memberships / policy deprioritize-ban; không public); **DD-43** per-tenant tags/tier targeting (public không lộ); **DD-44** `session_invite_tokens` (không hạ visibility); **DD-45** waitlist `players.status+waitlisted` auto-promote atomic + re-check; **DD-47/48** ✅ **framework, build P4+** (person_follows global fail-closed / profile_visibility default public, whitelist non-PII, 5 open item lúc build). **P7:** DD-34/35/36 approve-in-principle; DD-18 hướng hosted-first swappable (provider+DPA chặn go-live). **External:** DD-14/15 = SPIKE xác minh Zalo (không phải quyết định nội bộ). Nguồn: `../dd-remaining-cluster-analysis.md`. |
| 13/07/2026 | v1.25 | **DD-41 → ✅ Chốt (owner).** `sessions` +mô tả (title/notes/**`session_type` 1-field**; **`cost_shared` descriptive-only** không đổi charge) + **gating enforce ở shared `evaluateSessionEligibility`** (gọi từ `addMemberToSession`, universal — không chỉ CCJ) **decision table self-attested** (level_rank+strict [DD-08]/gender/**age**; **age tính tại `starts_at`/session tz**; **9 error codes exact** gồm `*_CONSENT_REQUIRED` cho gender/age; consent-denied ≠ missing; **chặn transition open/public khi source chưa có**; approval re-check trong tx). **Consent source per-attribute** (`gender_consent`/`dob_consent` — enc NULL không phân biệt missing/denied). **`skill_level` retire → `level_*_rank`** (expand→contract, backfill, drop). `gender_restriction`=policy≠player PII. `level_strict` vào public whitelist. Scope: level+gender+**age in-scope**. **Dependencies:** level per-sport source (chưa có → level advisory), `persons.gender_enc`/`dob_enc` = **BRD FR-11 contract có, migration chưa** (KHÔNG mới). `session_type` trộn 2 trục (tách sau cần backfill). Propagation rộng (CCJ/business-rules/TDD/schema/migration/DBML/projector/invariant-test/README); Session+CCJ **chưa implement** (schema-only). Nguồn: `../dd-41-session-fields-gating-analysis.md`. |
| 13/07/2026 | v1.24 | **DD-46 → ✅ Chốt (owner) — Option B "personal tenant".** Kèo không-CLB: `getOrCreatePersonalTenant(person_id)` auto-provision (`tenants.kind='personal'` + **`owner_person_id` + `UNIQUE WHERE kind='personal'`** = 1/person, DB-level; logical free tier) → **giữ nguyên `tenant_id NOT NULL` + RLS + money**. Schema fail-closed (`CHECK kind⇔owner`, partial unique INDEX). Provision: extend `tenant_provision`/`provisionTenant` → `tenant_get_or_create_personal`/`getOrCreatePersonalTenant` (lock `persons` row cùng merge, không advisory). Provision **tái dùng shared core** → owner membership **luôn được tạo**; **public alias = `owner membership.display_name`**. Marketplace **fail-closed**: alias trống → không project public; giữ `club_display_name` NOT NULL. Participant → guest membership+player+charge (tiền y hệt). Merge: collision → loser personal→`kind='club'`; **re-parent cả `memberships` LẪN `tenant_admins.platform_user_lookup_hash`** (person UUID text, no FK → không rewrite = mất owner web). **CẤM vĩnh viễn** nullable tenant_id (rủi ro = phải dựng authz/money plane thứ hai). **Mở khoá cụm session-model**. Nguồn: `../dd-46-skip-club-analysis.md`. |
| 13/07/2026 | v1.23 | **DD-02 rev6 + propagation.** Full-issued code = `registry.locked_at IS NOT NULL` + `pay_code` khớp (retired-chưa-lock không false-issued); prefix immutable sau first issuance + choke-point atomic; `discoverPayCodeCandidates` (enumerate mọi split, batch-resolve — foreign token không bị bỏ sót; **`skipCodes` xét SAU resolve, issued thắng skipCodes**); `PAYMENT`→none chỉ khi `PAY` không own. **Propagated (spec):** `identity-model`+`feature_identity_tech` (pay_code tombstone) · connector 4.3b+`_tech` M2 (ApiPay ✅ **primary**) + **`provider_connections.auth_mode='enterprise'` + CHECK shape đầy đủ per provider/auth_mode** + CO-OQ-6 đóng (`skip_if_no_code=0`) · `feature_payment_reconcile_tech` **§4 worker pipeline + `bank_transactions.provider_code_enc` (providerCode↔content cross-check)** + §8 fixtures. **Migration backfill guard:** query DB thật cho `pay_code IS NOT NULL` → HALT + map prefix thủ công + set `locked_at` (không suy từ slug). |
| 13/07/2026 | v1.22 | **DD-02 → ✅ Chốt (owner).** Contract pay_code (rev 6, `../dd-02-paycode-analysis.md`): suffix trần **4 ký tự** UPPERCASE (A-Z+2-9 trừ 0/O/1/I/L), unique per-tenant, immutable, CHECK format+≥1 chữ cái; **prefix = bảng global `pay_prefix_registry`** (prefix PK, state, `locked_at`, one-current-per-tenant; KHÔNG `tenants.pay_prefix`; immutable sau first issuance; choke-point atomic); **recognition** = `discoverPayCodeCandidates` (enumerate mọi split, batch-resolve) + resolver `own/foreign/none` với **full-issued ⟺ `locked_at IS NOT NULL` + `pay_code` khớp**; memo-level precedence (hard-token thắng name-fallback); **allocation `planIncomingAllocations()`** (auto exact/over/under-partial + unknown-fee-sau; manual unknown-fee-đầu/already-paid); **provider-agnostic** (ApiPay primary DD-30, SePay code=evidence); **merge follow tombstone**. **Phase P3→P4**. Propagation: wire core+tests, migration registry+CHECK, extend merge contract, connector ApiPay ✅+CO-OQ-6. |
| 13/07/2026 | v1.21 | **DD-08 → ✅ Chốt (owner).** Môn Day-1 seed: badminton/pickleball/tennis/padel/volleyball/basketball/football (extensible qua bảng `sports`, thêm hàng — không enum/migration cho môn mới). Level ordered 5 bậc: beginner < intermediate < upper_intermediate < advanced < professional (cần rank số cho gating DD-41; thay `sessions.skill_level` text — migration đi cùng DD-41). Một nguồn level cho DD-41/DD-43. |
| 13/07/2026 | v1.20 | **DD-04 reopened.** Gate định nghĩa lại = auto-failover HA + uptime SLA + posture private-network trên Fly; thêm **QĐ-1 posture (a/b/c)** + ứng viên **DigitalOcean** (nghiêng chọn), Neon Scale á quân, Supabase chỉ đạt gate ở Enterprise, self-host/Railway-HA để dành. Sửa dữ kiện: Neon HA không Scale-gated, Supabase Pro không đạt HA/SLA, private-network chưa giải quyết trên Fly. Nguồn: `../dd-04-hosting-decision-brief.md` (rev 2). Kèm governance: sync `deployment-infra.md §2` (Railway row) + §6 (network posture). |
