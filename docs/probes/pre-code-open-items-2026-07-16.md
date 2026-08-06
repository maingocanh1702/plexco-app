# 📋 Pre-code Open Items — DD/vấn đề cần xử lý nốt (2026-07-16)

> **Mục đích:** checklist một trang các DD/OQ/design gate còn mở trước khi code feature layer (S4→S8).
> **Authority refresh (2026-07-28):** `standards/decisions.md` working tree. DD-45a waitlist unique fence, DD-88 notification guardrails và CHT-OQ-2 moderation policy đã owner-final; đây vẫn là tracking mirror, không phải migration/code authorization. Founder briefs là historical input; implementation truth là live schema/migrations/tests.
> File này chỉ **tracking**, KHÔNG tự biến đề xuất thành quyết định. Khi chốt: ghi authority canonical trước → propagate spec → author slice → tick ✅ ở đây.
>
> **Phạm vi:** FE track riêng, chờ design files (`docs/channels/web/screens/`). File này tập trung BE, security, data, infra và external gates.

---

## 0. TL;DR

- **S4 chưa code-ready hoàn toàn:** Product + BE contract và B0 design-probe đã pin Google OIDC proof matrix, cross-site callback, email verify/forgot/reset/revoke-all lifecycle, storage/token consume và account-wide revoke semantics. B0 còn **owner approval + ghi DD**; xong mới author bộ slice D1, không gom thành một mega-slice "provider swap".
- **A1/A2 không chặn toàn bộ S5/S7:** chỉ chặn correction/refund/undo-leave và gender-pricing paths. Base slice chỉ được chạy sớm khi manifest ghi rõ negative scope, endpoint/CTA liên quan bị disable và test chứng minh fail-closed (xem §E).
- **Khởi động ngay vì lead-time:** A3 legal/compliance, A7 LLM due-diligence và các external gates ở §C. Chọn provider/build P7 có thể để sau; legal/data-region/DPA không nên để sau.
- **Không pin schema trước design-probe** cho money correction, auth credential lifecycle và sync delivery. Pin policy + decision table trước; storage/API cuối cùng phải đi ra từ probe các mutation/delivery paths thật.

## Nguyên tắc thực thi chung

1. Tiền, identity, PII: không chứng minh được an toàn thì block; không default 0/allow.
2. State bị mutate qua nhiều path: decision table trước, sau đó tách **canonical core → edge slices**; không code monolith.
3. Derived money/visibility/authz rule: một helper/registry canonical; adapter/API/UI chỉ consume, không tự tính lại.
4. Chạm matcher/router/choke-point: reuse-scan + design-probe ca khó nhất trước khi author slice.
5. Mỗi slice phải mechanism-named, có negative scope, worktree + manifest + scope gate, Codex gate và `STOP_AT_READY` theo project invariants.

---

## Triage — item nào vào §A (founder), item nào vào §B (engineering)

> **Thêm 2026-07-19; closure 2026-07-28.** Lý do: một item DDL thuần từng nằm chung hàng đợi với quyết định monetization (DD-45a), khiến **một build slice đang chạy phải chờ một cái gật hiển nhiên**. Founder queue chỉ nên chứa thứ mà **chỉ founder mới trả lời được**. DD-45a nay đã owner-final theo đúng lane engineering ở B4a.

**Mặc định:** item chỉ vào **§A** khi câu trả lời phụ thuộc **ý chí kinh doanh/sản phẩm của owner**, không phải chỉ phụ thuộc kỹ thuật.

**Vào §A (founder)** nếu quyết định ít nhất một trong:

- **Tiền / packaging** — tier, giá, free vs `host_pro`, refund, thu phí.
- **Scope / phase** — đưa gì vào/ra phase-1, thứ tự pha, cam kết build.
- **Pháp lý / PII** — thu dữ liệu gì, giữ bao lâu, chia sẻ với ai.
- **Trade-off sản phẩm có mặt trái thật** — hai phương án đều hợp lệ, khác nhau ở trải nghiệm/độ tin cậy mà kỹ thuật **không** phân định được.
- **Cam kết bên thứ ba** — chọn vendor/provider, ký DPA, nộp review.

**Vào §B (engineering pin)** nếu item là:

- **DDL/constraint hardening không đổi hành vi sản phẩm** — ví dụ thêm `UNIQUE`/`CHECK` để biến một trạng thái *vốn đã bất khả thi* thành **bất khả biểu diễn**.
- Index, lock order, khuôn function, tên cột, thứ tự migration.
- Chọn giữa nhiều cách triển khai cho **cùng một contract đã chốt**.

**Escalate ngược §B → §A** khi và chỉ khi lựa chọn kỹ thuật đó **đổi hành vi người dùng thấy được**, chạm tiền/identity/PII/legal ngoài invariant đã pin, hoặc **khoá một quyết định sản phẩm sau này**. Lúc đó HALT và nâng lên §A — đúng như note sẵn có ở đầu §B.

---

## A. Founder / policy decisions

| # | Decision boundary cần chốt | DD/OQ | Chặn thật sự | Trạng thái / đề xuất |
|---|---|---|---|---|
| A1 | **Money-correction policy** | SES-OQ-1 · PAY-OQ-3 → **DD-49** | Correction core + refund edge; S5/S7 base chạy được theo §E | ✅ **CHỐT policy (2026-07-16, DD-49/v1.37; timing clarified 2026-07-19):** đổi giá = host chọn per-change (append signed obligation adjustment HOẶC grandfather; không auto chuyển tiền); allocation reversal chỉ đảo tiền đã nhận; host-cancel đã thu → hoàn toàn bộ; player-leave paid → policy CLB + refund request. Rejoin chưa refund carry-over; refunded + outcome active → append lifecycle idempotent atomic với activation; refunded + full → waitlisted và defer lifecycle/nợ mới tới promotion. **Không mặc định row `charges` thứ hai**; design-probe live UNIQUE charge/player/session trước storage/API. |
| A2 | **Public gender value set + pricing behavior** | USR-OQ-1 · DD-39 addendum | Gender-pricing charge path | ✅ **CHỐT (2026-07-16):** `male`/`female`/`other`/`undisclosed`; other/undisclosed/NULL → giá base; fail-closed chỉ khi KMS/decrypt lỗi. → mở B2. |
| A3 | **PII data-class matrix** (scope đã thu hẹp: **không thu SĐT — DD-50**; PII optional thu theo **platform config — DD-54**; còn email, tên, bank memo bắt buộc vận hành) | USR-OQ-3 · SEC-OQ-2 · DD-54 | Go-live thu PII | 🟠 **Collection policy ✅ (DD-54); legal review còn mở — start counsel VN ngay.** Config không thay nghĩa vụ pháp lý cho data đang thu; bank memo từng xếp *nhạy cảm* dưới NĐ 13/2023 cũ — counsel confirm phân loại theo Luật 91/2025 + NĐ 356/2025. |
| A4 | **Identity recovery + merge/split authority** | ID-OQ-2 · ID-MERGE-1 · RTE-OQ-2 → **DD-53** | Production enablement của S8 | ✅ **CHỐT (2026-07-16, DD-53):** PlatformAdmin freeze (1 người); split apply = 2 approval độc lập; break-glass ticket+expiry+audit; strong proof = verified email/recovery artifact; không rewrite ledger; SLA freeze ≤4h. Build + shadow/dry-run được ngay; bật production cần runbook + drill evidence. |
| A5 | **Host Pro commercial policy** | BIL-OQ-2 · DD-29 → **DD-51** | P5 bật thu Host Pro | ✅ **CHỐT (2026-07-16, DD-51):** trial 14d, remind trước 2d, hết trial khoá ngay; trễ invoice grace 7d; huỷ giữa kỳ hoàn toàn bộ nếu request trong 7d kể từ khi thanh toán, sau đó không hoàn; override PlatformAdmin max 7d + ticket_ref/reason/expiry/audit. |
| A6 | **Guest→full membership + ban policy** | CCJ-OQ-2 · ID-OQ-3 → **DD-52/56** | P4.3 cross-club join | ✅ **CHỐT (2026-07-16, v1.37):** invite + player-request coexist (host duyệt); manual ban = TenantOwner + actor có `member.ban` (default co-admin), reason+evidence, không auto-evict; storage tách DD-42; mọi join path qua `evaluateJoinRestriction()`. |
| A7 | **LLM procurement/data policy** và provider selection tách nhau | DD-18 ⬜ (giữ mở) | Due-diligence trước khi gửi production data; implementation P7 | 🟡 **Owner ok (2026-07-16) khởi động due-diligence matrix** (DPA, data region, retention, subprocessors, delete/export, SLA, cost). Provider selection giữ ⬜ tới P7; interfaces swappable. |
| A8 | **Global KB plane** | DD-34/35/36 🟡 | Global KB slice P7 | ✅ **Owner confirm (2026-07-16):** giữ approve-in-principle, deferred đến P7, không build speculative. |

## B. Design/security pins trước slice tương ứng

> Không phải mọi item ở đây đều là "Eng tự chốt". B6–B8 có privacy/product/security authority; nếu đụng tiền/identity/PII/legal ngoài invariant đã pin thì HALT và nâng lên founder item.

| # | Pin / recommended solution | Authority | Chốt trước | Trạng thái |
|---|---|---|---|---|
| B0 | **Auth proof + credential lifecycle contract:** Google verify signature + exact issuer/audience + state/nonce/PKCE + `exp/iat` + `email_verified=true`; email credential register → verify → login → forgot/reset → revoke all affected sessions. Verify/reset token hash-at-rest, TTL, purpose-bound, single-use; enumeration-safe response, rate limit, password policy, audit. `link_code` consume lock+TTL/action/source+attempts+single-use trong một transaction. Cấm enable partial lifecycle chỉ có register/login. | Security + Eng | S4 auth implementation | 🟡 Contract đã pin vào Product v2.10 + BE v2.7 theo DD-50/v1.37. **Design-probe đã có (2026-07-18): `b0-auth-credential-lifecycle-design-probe.md`** — map đủ Google proof + email lifecycle + reuse `link_code`; pin account-wide revoke, multi-attempt verify-first registration, complete existing-subject collision cells, protected outbox → pg-boss delivery + DLQ, login finalizer đóng race với reset, trusted-IP reuse live DO/Fly resolver, schema-mirror resolution (a), **OAuth cross-site transaction + Lax browser binding**, **state-issue limiter trước row/cookie**, canonical PKCE ciphertext `bytea`, **email-link non-mutating GET → same-origin POST** và exact IP→target/invalid-artifact rate-limit ordering trước consume. **Chưa đóng:** chờ owner duyệt §3/§3.2/§4/§5/§8/§10 rồi ghi DD vào `standards/decisions.md`; chưa author D1 migration/DDL; email provider vẫn OFF (gate **C7**). |
| B1 | **Chọn enum migration, không synthetic bank transaction.** Thêm source riêng cho CK do host attest khi chưa ingest (tên cuối pin trong design, ví dụ `attested_bank_transfer`); `bank_transaction_id=NULL`, `created_by` bắt buộc, evidence chỉ lưu opaque reference + audit, không lưu raw receipt mặc định. Giữ `manual` chỉ cho allocation của bank transaction đã ingest. | Money design + Eng; escalate nếu evidence policy chứa PII/legal | S7 manual-transfer path | ⬜ Pin decision table + migration/CHECK/tests; không dùng `cash`, không tạo bank txn giả. |
| B2 | **Gender price contract:** một canonical price resolver cho mọi charge path; charge/obligation snapshot amount + `price_basis`/rule version, không re-derive theo profile hiện tại. Candidate storage = nullable `sessions.price_male` + `price_female` cạnh base `price_amount`, nhưng final DDL chỉ pin sau decision-table + mutation-path probe. | Money design + Eng; A2 đã đóng | Gender-pricing slice | ⬜ Ready for design-probe: value × override × decrypt/error × price fields; không còn chờ founder A2. |
| B3 | **Sync delivery correctness**, không chỉ retention: lease owner/expiry, stale-claim reclaim, aggregate head-of-line ordering, per-projector retry/backoff, DLQ + replay authority, idempotency và operator evidence. Chỉ purge khi event terminal cho tất cả required projectors, hết legal/incident hold và qua horizon đã pin. | Reliability + Security/Eng | S6 sync-engine rollout | ⬜ Current `claimed_at` là permanent flag nên crash-reclaim contract chưa enforce được. Design-probe `outbox_events` + `projector_deliveries` trước schema. |
| B4 | **Migration ledger theo từng slice**, không một mega migration: auth credential/login-state; `chat_*`; settings/gender; billing `plan_key CHECK ('free','host_pro')`, bỏ `selected_extra_channel`, cho `free.period_end=NULL`; waitlist/DD-41..45; `tenants.kind` personal tenant (DD-46); `skill_levels` rank canonicalization thay `sessions.skill_level` text tự do (DD-08×41, một nguồn level cho gating + tags). | Eng; mỗi migration inherits domain authority | Cùng build slice tương ứng | ⬜ `messenger_pages` đã có từ migration `0004`, không liệt kê là gap. Billing gap phải cover đủ CHECK + dropped column + nullable semantics. |
| B4a | **DD-45a waitlist-position final fence** | Eng · DD-45a owner-final 2026-07-28 | Future waitlist promotion slice | ✅ Policy pin: migration monotonic mới thêm partial `UNIQUE (session_id, waitlist_position) WHERE status='waitlisted'`; duplicate preflight phải HALT/manual, không auto-renumber; gaps hợp lệ. Session-lock allocator + unique final fence. `0014` và runtime hiện tại chưa đổi; khi migration land thay permissive fixture bằng duplicate-rejection, giữ three-key selector chỉ như compatibility/defense. |
| B5 | **Recurrence commands tách rõ:** edit one occurrence; split series from effective date cho "this and future". Mỗi command idempotent, audit before/after và không silently rewrite history. | Product behavior + Eng | Recurrence slice sau S5 base | ⬜ Tách slice riêng; không chặn session base. |
| B6 | **Reminder visibility core:** exact amount chỉ được render trên strongly verified person-private surface; ambiguous/unverified/shared surface chỉ generic copy + secure authenticated link. Một shared renderer/decision core, adapters mỏng. | Product + Privacy/Security + Eng | S16 reminder slice | ⬜ Pin surface × identity assurance × amount visibility decision table; không default generic cho mọi private surface, cũng không leak amount. |
| B7a | **DM policy + abuse safety gate** | Founder/Product + Privacy/Legal | Trước in-app DM enablement | ✅ **CHỐT (DD-55/v1.37; CHT-OQ-2 owner-final 2026-07-28):** phase-1 open-DM chỉ enable khi block + report + per-sender/per-target rate-limit + abuse audit enforce fail-closed; phase-2 follower accepted direct, còn lại request box. Club moderation chỉ qua capability registry, soft-hide/tombstone + immutable audit; per-channel mute; không hard-delete. Host/support/tenant admin không đọc hoặc moderate human DM. Retention/legal vẫn là cleanup/enablement gate riêng. |
| B7b | **Media scope** | Founder/Product + Security/Eng | Chat slice | ✅ **CHỐT (2026-07-16, DD-55): media in-scope phase-1** — build đủ object storage, signed access, malware scan, quota/type/size, moderation, deletion lifecycle. Không ship half-built. |
| B8 | **Co-admin capability matrix** | Founder + Security; Eng implement registry | Authz slice | ✅ **CHỐT exact matrix (DD-56/v1.37):** default allow routine session/content/member, `member.ban`, money read, manual mark-paid có DD-25; default owner-only role management, correction/refund/waiver/void, bank account, connector secret, billing. Sensitive delegation (trừ role) cần explicit grant+expiry+audit; global DD-51/53 vẫn PlatformAdmin-only. |
| B9 | **Person-directed notification core cho follow/visibility (DD-47/48):** `notification_intents`/`outbox` hiện tenant-scoped, không cover được global follow-request notify — cần một person-directed core, không clone tenant outbox semantics. USR-OQ-4..9 default fail-closed tới khi slice pin: không cross-tenant stats, private counts/lists hidden, không mở DM/profile visibility mới, không ship block/roster-name expansion. | Product + Privacy + Eng | Settings/follow slice (P4+) | ✅ **DD-70 direction final; runtime vẫn chưa có. DD-88 guardrails final 2026-07-28:** một per-Person/per-type/channel preference authority cho cả hai plane; money/security schema-nonoptout; chat read tách notification read; không durable item mỗi chat message và không offline digest v1. Session/activity, `message_request`, digest và scoped/bulk vẫn deferred theo exact trigger; không nâng item này thành `CODE_READY`. |
| B10 | **Suspended-tenant reconcile (PAY-OQ-2):** ingest bank transaction **luôn bật**; auto-settle/auto-notify cho tenant `suspended` **OFF fail-closed**. Bật lại về sau cần decision mới + telemetry/evidence, không phải default build. | DD-51 + Eng | S7 rollout | ✅ Policy đã chốt; §E + billing BE contract phải enforce/test. |

## C. External spikes / verification gates — chạy song song ngay

| # | Gate + evidence cần có | DD/OQ | Chặn | Trạng thái / fallback |
|---|---|---|---|---|
| C1 | **Provider fixed-egress requirement matrix** cho SePay/ApiPay/Zalo/Meta. DO App Platform VPC và dedicated egress IP đã được document là không bật đồng thời; gate không phải verify lại limitation này mà là provider nào thật sự bắt buộc allowlist IP. | DD-04 pre-build gate | Production infra | ⬜ Không provider nào cần fixed IP → giữ DO VPC. Có provider bắt buộc → pin fallback hosting hoặc designed egress proxy, kèm security/ops proof trước build. |
| C2a | **Zalo webhook sandbox:** `setWebhook`/`getWebhookInfo`, auth, retry/idempotency, failure payload; lưu request/response redacted + timestamp + owner sign-off. | CO-OQ-1 (P0 connector blocker) | Zalo auto-register S17 | ⬜ Manual-URL fallback được build nhưng không được giả như auto-register đã verified. |
| C2b | **SePay/payment-provider spike:** tách CO-OQ-2/3/5/7 thành evidence theo từng API/webhook/auth/signature/retry/rate-limit requirement; ghi owner, due date và fallback cho từng OQ. | CO-OQ-2/3/5/7 | S7 auto-ingest/reconcile production path | ⬜ Không bundle evidence với Zalo CO-OQ-1. |
| C3a | **Zalo Login/OA capability spike:** supported flow, scopes, review/approval, token lifecycle, account-link UX; lưu redacted evidence riêng. | DD-14 ⬜ | Zalo login/link GA | ⬜ Chưa verified. |
| C3b | **Zalo identity stability spike:** `from.id` có stable/cross-bot hay chỉ scoped theo app/OA; test cùng user trên tối thiểu hai bot/OA và ghi deterministic-link fallback. | DD-15 ⬜ | Cross-channel identity link GA | ⬜ Evidence độc lập với C3a; ambiguous identity phải fail-closed. |
| C4 | **Meta external enablement evidence:** named owner, submission date, exact permissions/artifacts/status/retry và fallback; ghi riêng evidence cho Messenger capability và Facebook Login/account-link, không coi một approval tự bao nhóm còn lại. | DD-33 ✅ (decision owner 18/07) · DD-37 · PMS-OQ-2 | Messenger + Facebook Login/account-link GA | ⬜ **Submission chưa nộp — kick off ngay**; capability non-test phải OFF tới khi exact evidence pass, fallback transactional one-time `link_code`. |
| C5 | **Production-readiness evidence pack:** provision reproducible; backup restore + failover drill; measured RPO/RTO; KMS key access/rotation/recovery; alert/on-call/runbook; signed result và date. | DD-04 · SEC-OQ-1 (derived) | Production | ⬜ Config/spec không được tính là evidence; phải có drill output. |
| C6 | **Zalo Premium + add-on managed** (owner >3 CLB): xác nhận pricing/điều kiện Premium OA + khả thi mô hình managed add-on với Zalo. | DD-11 🔗 | Packaging/billing Zalo P4.7 — không chặn S4–S8 | ⬜ Phụ thuộc ngoài; gom evidence cùng lane C3a/C3b khi làm việc với Zalo. |
| C7 | **Email delivery provider evidence:** (a) **upstream idempotency guarantee** chứng minh được — exact header/param, hành vi khi timeout/crash mơ hồ (điều kiện cứng của B0 probe §5.4); (b) DPA + data region + retention + subprocessors; (c) deliverability: SPF/DKIM/DMARC, domain warm-up, bounce/complaint handling; (d) named owner + due date + fallback. | `b0-auth-credential-lifecycle-design-probe.md` §5.4 · DD-13 (email auth) | **Email auth feature flag** (D1 email-credential-lifecycle bundle) | ⬜ **Chưa khởi động — kick off song song vì lead-time.** Không chứng minh được upstream dedupe ⇒ email provider giữ **OFF**; cấm gọi external send rồi giả định exactly-once. Local receipt ledger không phải proof. Fallback: Google-only auth vẫn ship độc lập (probe §10 order 3). |

## D. Work items trước khi start code

| # | Việc | Trạng thái |
|---|---|---|
| D1 | Sau B0, author **bộ slice S4 mechanism-named, serialize trên auth/identity invariants**: (1) shared account/session core + design-probe SI-1..SI-8; (2) Google OAuth adapter; (3) cohesive email credential lifecycle register/verify/login/reset/revoke; (4) expand→contract remove Telegram-era routes/runtime sau khi consumer đã chuyển. Mỗi manifest ghi rõ negative scope; không enable email auth nửa vòng đời. | ⬜ Ưu tiên #1 sau B0; không author một mega-slice. |
| D2 | Revalidate full Postgres suite: start local Postgres bằng `docker compose -f infra/docker-compose.yml up -d postgres`, sau đó `DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm test`. Harness dùng DB này làm superuser base rồi tự tạo DB riêng per-suite; không trỏ dev/prod. | ✅ DONE 2026-07-16: **20 files / 223 tests pass** (core 111 · DB/RLS/auth 44 · web 65 · bot 3); test container đã stop sau verify. |
| D3 | Chạy formatter cho đúng 4 file: `apps/web/app/api/auth/telegram/state/route.test.ts`, `apps/web/lib/login-state.ts`, `apps/web/lib/session-cookies.test.ts`, `packages/db/src/auth.test.ts`; re-run format/lint/build. | ✅ DONE 2026-07-16; GitNexus impact LOW, Prettier full-repo pass; lint/build evidence cập nhật sau verify. |
| D4 | Reconcile doc wording `MT-OQ-1` "trước P0" đã moot vì P0 merged; worker security contract giữ ở BE §4, exact per-queue function name chốt trong slice triển khai. | ✅ DONE 2026-07-16; Product spec v1.5. |
| D5 | **Channel Booking Funnel authority pack (DD-32 Option D):** Product + BE companion v1.0 đã pin browse-free → final link-or-pay, qualified Account link, durable 15-minute pay-now hold, shared occupancy và atomic verified-payment finalizer. | 🟡 **Contract authored 2026-07-28; vẫn `NOT_CODE_READY`.** Còn 3 binary gates: hard runtime cores phải merge; mechanism-sized packets cho identity link → decision core → intent/hold → occupancy → finalizer phải đạt strict readiness; exact docs pack phải commit rồi re-pin SHA. Không mở adapter/runtime chỉ vì companion đã tồn tại. |
| D6 | Product/eng defaults delegated (không cần founder, chốt nhanh khi vào slice): WAO-OQ-2 min onboarding steps · MKT-OQ-3 ranking ban đầu · PMS-OQ-1 persistent menu/quick replies. ~~ID-OQ-1 phone-verify~~ → đã resolve bởi DD-50 (không thu SĐT phase-1). | ⬜ Ghi default vào spec OQ khi chốt. |
| D7 | **Full propagation DD-49..56 + v1.37 safety clarification**: session/cross-club rejoin + append-only correction contract; payment refund/adjustment semantics; billing lifecycle; identity verified-email/link-code body; web auth OIDC + credential lifecycle; chat media + block/report safety; routing exact capability matrix; dependent README/HANDOFF/BUILD-STATUS/founder brief. | ✅ **DONE 2026-07-16 under authority v1.47; still valid under current decisions v1.67:** later decisions do not reopen this closure. DD-49 timing clarification now explicitly defers refunded/full lifecycle until activation; schema/code remain pending build slices. |
| D8 | **Provider-pinned client-IP resolver + CI truthfulness:** DO trusts only `do-connecting-ip`; Fly fallback trusts only `fly-client-ip`; production requires explicit provider; missing/invalid header collapses fail-closed. CI runs format/typecheck/lint/build/full DB suite; separate Security workflow runs Semgrep CE + OSV PR/full dependency scans. | ✅ DONE + REMOTE EVIDENCE 2026-07-17: local web 65 + canonical 223 tests pass; pushed HEAD `299338d` has [CI green](https://github.com/maingocanh1702/plexco-app/actions/runs/29518494545) (install/typecheck/format/lint/build/full test) and [Security green](https://github.com/maingocanh1702/plexco-app/actions/runs/29518495006) (Semgrep CE + OSV full dependency scan). Provider/staging drills remain separate production gates in §C. |
| D9 | **`phase1-fable5` worktree ownership:** branch hiện có 0 unique commit và đã nằm trong `origin/main`, nhưng ignored `.autopilot/state/**` vẫn là forensic evidence được auth/security docs tham chiếu. Giữ worktree **read-only**, không dùng làm base cho slice mới. Chỉ `ap-finish` sau khi đã archive/migrate các evidence path còn được docs cite; không bare-remove. | ✅ Ownership đã pin; đây là retained forensic worktree, không phải in-flight implementation. |

## E. Safe-start boundary cho S5/S7

A1/A2 policy đã đóng. Chỉ được start base slice **trước khi correction/gender cores, B1 và DDL tương ứng land** nếu tất cả điều kiện sau được pin trong manifest và test:

| Slice | Positive scope được phép | Negative scope bắt buộc / fail-closed evidence |
|---|---|---|
| S5 session base | Session/roster/base `price_amount` paths không phụ thuộc gender/correction | **NO** gender price fields/resolution trước B2 core; **NO** repricing/refund/undo-leave trước DD-49 correction core. Rejoin endpoint phải disabled nếu chưa chứng minh được carry-over/refunded disposition; không silently fall back `REJOIN_REQUIRES_REVIEW` như contract mặc định. |
| S7 reconcile base | Ingested bank transaction + existing canonical auto/manual/cash flows đã có contract | **NO** host-attested un-ingested transfer trước B1; **NO** correction/refund trước DD-49 core. Unknown source/value reject+audit, không map `cash`/`manual`. Tenant `suspended`: ingest ON, auto-settle/auto-notify OFF theo DD-51/B10. |

Nếu không enforce được một negative scope ở boundary thật, **không start slice**; chờ decision/core tương ứng.

---

## Thứ tự xử lý đề xuất

1. Chạy song song lead-time: **A3 legal**, **A7 LLM due-diligence** và **C1–C4 external evidence**.
2. Owner duyệt **B0 auth proof+lifecycle** và ghi DD; song song chạy decision tables/design-probes cho **DD-49 money-correction paths**, **B2 gender pricing** và **B3 sync delivery correctness**; storage/API chỉ chốt sau probe.
3. Chốt B1, rồi author mechanism-named manifests/slices: canonical core trước, edge/adapters sau; money/identity invariants serialize.
4. Thực hiện D1; song song khôi phục current verification evidence D2/D3. Không enable S4 cho đến khi email credential lifecycle hoàn chỉnh.
5. S5/S7 base chỉ chạy sớm nếu §E pass; nếu không thì chờ correction/gender core + B1.
6. DD-53 runbook/drill trước production identity merge; DD-51/52/56 đã pin policy cho P5/P4.3; A8 giữ deferred đến P7.

## Closure checklist cho mỗi item

1. Ghi decision/policy vào `standards/decisions.md` hoặc OQ canonical trong spec **trước**; proposal trong file này không phải approval.
2. Với money/identity/PII/choke-point: pin decision table + design-probe + fail-closed behavior; không chốt schema từ prose guess.
3. Propagate actor/state/audit/error rule sang feature spec, BE tech spec, migration plan và tests; dùng một canonical core/helper/registry.
4. Author slice theo mechanism, negative scope rõ, core + edge tách trước; register worktree/manifest/scope gate và `STOP_AT_READY`.
5. External/production item chỉ close khi có dated evidence + owner + fallback; config/prose không tính là drill/proof.
6. Tick ✅ ở bảng trên và cập nhật `BUILD-STATUS.md`/dependent summaries nếu build gate hoặc phase status thay đổi.

## Changelog

| Ngày | Thay đổi |
|---|---|
| 2026-07-28 | Reconcile D5 theo DD-32 Option D: BE companion đã author, design questions trong scope đã đóng, nhưng hard dependencies/exact implementation packets/immutable authority vẫn chặn `CODE_READY`; không runtime hay migration authorization. |
| 2026-07-28 | Mirror decision closure: add B4a for DD-45a future partial unique fence with duplicate-preflight HALT/manual/no-auto-renumber; close CHT-OQ-2 moderation boundary in B7a while keeping retention/legal enablement-only; refresh B9 to DD-70 final + DD-88 guardrails-only, including no per-message item/no offline digest v1 and deferred extensions. No runtime or migration authorization. |
| 2026-07-17 | **Readiness/automation closure:** committed AP-21 launcher; Linear reconcile repaired 3 module titles + 46 existing subtask labels/titles without duplicates and post-verify passed; FE docs stop claiming missing `Plexco-DS-fable5.pen` as SoT; GitHub actions upgraded to verified immutable Node 24-runtime pins (checkout v7.0.0 · setup-node v7.0.0 · pnpm-setup v6.0.9). |
| 2026-07-16 | **Review-fix closure verified + 3 findings đóng:** (1) pnpm keys `minimumReleaseAge`/`trustPolicy`/`blockExoticSubdeps` verified hợp lệ & enforced với pnpm 10.30.2 (docs pnpm); (2) SHA pins verified chính chủ qua `git ls-remote` (checkout v4.3.1 · pnpm-setup v4.3.0 · setup-node v4.4.0 · osv v2.3.8 exact) — comment workflows đổi sang exact tag; (3) report lưu vào `docs/archive/review-fix-closure-2026-07-16.md` (§13 addendum verify). |
| 2026-07-16 | **Code-aware closure v1.37:** sửa DD-49 storage assumption theo live UNIQUE charge/player/session; pin DD-50 OIDC/link-code proof; DD-55 hard abuse-safety gate; DD-56 exact capability matrix; full-propagate Product+BE body/tests; dọn dependencies A1/A2/A5 đã đóng; thống nhất test URL. |
| 2026-07-16 | **Founder batch 2** → decisions.md v1.36: DD-54 (PII config trên CMS admin — A3 còn legal), DD-55 (DM phase-1 open / phase-2 follow-gated + request box; media in-scope full stack — B7a/B7b ✅), DD-56 (co-admin = admin trừ role mgmt, được ban — B8 ✅, amend DD-52). Note DD-33: chatbot review ≠ Login review. |
| 2026-07-16 | **Founder chốt batch A1–A8** → decisions.md v1.35 (DD-49..53 + DD-39 addendum); HANDOFF HR4 đổi theo DD-50 (không thu SĐT, khoá mạnh = verified email + link_code); A3 còn mở (scope thu hẹp) + A7 due-diligence khởi động; tick A-table; thêm D7 propagation pass; ID-OQ-1 gỡ khỏi D6. |
| 2026-07-16 | Sweep bổ sung 5 gap: B9 person-directed notify core cho follow/visibility (DD-47/48 + USR-OQ-4..9); B10 suspended-tenant reconcile (PAY-OQ-2); B4 thêm DD-46 `tenants.kind` + `skill_levels` rank (DD-08×41); C6 DD-11 Zalo Premium/add-on; D5 booking-funnel BE companion + D6 delegated product defaults. |
| 2026-07-16 | Reconcile code-aware review: sửa S4 readiness; thu hẹp A1/A2 blockers; thêm auth credential lifecycle; pin B1/B2; nâng B3 thành delivery-correctness gate; sửa billing/messenger migration drift; tách policy authority B6–B8; reframe/split external gates; thêm safe-start negative scope và core→edge slicing. |
| 2026-07-16 | Khởi tạo từ review toàn bộ docs (decisions v1.34, founder brief rev 5, 20 BE specs, BUILD-STATUS 2026-07-16). |
