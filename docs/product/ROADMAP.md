# 🗺️ ROADMAP — Plexco

**Phiên bản:** v3.4n
**Ngày tạo:** 16/06/2026 · **Cập nhật:** 07/08/2026
**Căn cứ:** `BRD.md` v3.9n · `PRD.md` v2.8m · `TDD.md` v3.1h · `../standards/decisions.md` **v2.11 current mirror** (DD-86/DD-91–95 owner-final; DD-88 broader `DEFERRED_PROPOSAL`) · `../features/feature_channel_booking_funnel.md` + BE companion · `../standards/BUILD-STATUS.md`

> ROADMAP là nguồn sự thật cho **delivery order + dev progress**. Product scope thuộc BRD; behavior thuộc PRD; implementation contract thuộc TDD.

> **📌 Repo truth snapshot — `main@2cd52ced65597546fc2bfce82ffae0cdf8e49a53` (06/08/2026, = `origin/main`).** Mọi số đếm hiện hành trong file này lấy từ cây repo/runner tại commit trên hoặc exact code-identical test snapshot được pin rõ, không phải từ prose. Cách tái tạo: xem §Cách đọc tiến độ → "Lệnh tái tạo số đếm". Nếu số không tái tạo được ⇒ coi như **stale**, không dùng để ra verdict.
>
> ⚠️ **Hai lớp bằng chứng hiện hành — lớp static đã đo lại, lớp runner CHƯA.** Static/source inventory tại `2cd52ce`: **30 migrations (`0000`–`0029`), 33 test files, 655 static test declarations** (core 132 · db 346 · web 137 · bot 40)**, 10 API routes** (8 auth + 2 onboarding, không đổi)**, 24 Product + 24 BE feature specs = 24 cặp, tất cả đã committed** (khoảng trống 24/23 của snapshot 28/07 đã đóng: DD-32 BE companion nay có trên `main`)**.** **Canonical runner chưa chạy lại kể từ `3d75c90`** (561 workspace + 13 validator, 29/07) ⇒ trục **Tests mang nhãn `STALE`**: static tăng 528→655 vì `0026`–`0029` + `authorizeTenantAction` kéo db 219→**346**, nhưng theo luật 4 chỉ output runner mới được khai làm số test. Không suy runner từ static.
>
> **Working-tree overlay 06/08 (chưa commit, KHÔNG tính vào bất kỳ trục nào):** `design.pen` (root), **12 FE spec** `docs/channels/web/FE/feature_*_fe.md`, 2 session doc `docs/sessions/2026-07-31-*`, `docs/autopilot-templates/level3.1-design-discussion.md`, `docs/templates/feature-dev/fe-spec-template.md`. Theo luật 3, FE spec + `.pen` **không** kéo trục FE/UI lên; FE vẫn **HOLD** và cột FE/UI vẫn 0 màn.

> **v3.4 channel pivot (DD-37):** bỏ Telegram; kênh phase-1 = **web + Zalo + Facebook Messenger**. Messenger nâng từ post-MVP (P4.8) lên **phase-1 (P2.5, phụ thuộc App Review)**. Thêm **Google login** (P0–P1), **chat in-app** + **cài đặt hồ sơ/giá theo giới tính** (P4, DD-38/DD-39 ✅ scope-committed phase-1; schema chờ migration), **mark-paid thủ công tiền mặt/CK** (P2).

> **Decision reconcile 15/07/2026:** DD-32 và DD-45 đã chốt; DD-47/48 chốt framework. Đây là delivery contract cho các slice tương lai, **không phải bằng chứng code/migration đã land**.
>
> **Cập nhật 17/07/2026 (decisions v1.45):** DD-65..68 chốt Messenger hybrid; DD-67 generalized provider-endpoint identity/reachability cho Messenger + Zalo. Feature-doc closure đã pin SePay HMAC, DM safety/block source, Assistant DLP và Session Organize v0.4 correction/SSE; runtime/migration chưa build. DD-57..64 vẫn proposal ngoài timeline. B0/B1/B2/B3/external/legal gates không đổi.
>
> **Cập nhật 18/07/2026 (founder batch, decisions v1.47):** DD-69 **định hướng app-first accepted** — phase-1 target = PWA (S9/S20 chưa live); phase-2 native ngoài committed timeline (build TBD). RN+Expo chỉ là recommendation sau spike; trước khi schedule native phải qua client-contract, API/auth/push/offline/store gates (DD-69 analysis). **DD-61..64 Session Organize accept-in-principle** (build post-P4). DD-33 Facebook Login phase-1 ✅; DD-60 API-reference convention ✅.

> **Cập nhật 22/07/2026 (v3.4 — reconcile số liệu + khung đo lường):** file này trước đây khai `migrations 0000–0013` và "Google/email chưa code". **Sai so với repo.** Truth tại `main@142e9fa`: migrations **`0000–0018`**; toàn bộ lane Google (D0a · D0b · D1 email-token · D1 google-adapter · d1b) **đã merge**, đang **chặn ENABLE** (chờ đo Safari macOS/iOS cho completion-hop M3; `GOOGLE_OAUTH_*` giữ rỗng). Đây là **reconcile bằng chứng**, không phải quyết định mới: **không phase nào được thêm/bớt, không DD nào đổi trạng thái, delivery order không đổi.**
>
> **Cập nhật 22/07/2026 (v3.4a — runner evidence reconcile):** canonical `DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm test` **PASS** tại snapshot này: **29 test files / 419 tests** (core 111 · db 159 · web 146 · bot 3). Static grep hiện cho **410** và chỉ là cross-check nguồn; không được dùng làm số test hay điều kiện `✅ Tests`.
> **Cập nhật 24/07/2026 (migration-tail reconcile):** migration tail bump `0018`→**`0020`** — `0019`/`0020` (`b0c29a6`/`f6ccd79`, 23/07/2026) thêm tenant-integrity composite FKs (DD-68), tầng riêng ngoài nền `0000–0014` và auth lane `0015`–`0018`. Chỉ reconcile migration tail; các số đếm khác ở §Dev Progress (test/route/spec) giữ nguyên snapshot 22/07 ở trên, CHƯA re-verify. Không đổi phase, DD, hay delivery order.
>
> **Cập nhật 25/07/2026 (v3.4d — current-state reconcile tại `2937ed9`):** (1) migration tail `0020`→**`0021`** — `0021` (`15e10b7`, 24/07) đóng nốt bộ ba tenant-integrity composite FK DD-68 ở nhánh **non-money**; (2) **core đã đổi**: `d2a27e1` (23/07) chốt `splitNameAmount` fail-closed ambiguity union (DD-87) — đây là **runtime change**, không phải doc; (3) **8 docs/spec slice** publish · billing · draft-lifecycle đã merge ⇒ hợp đồng S5 Session dày lên nhưng **0 dòng runtime**; (4) số đếm không cần DB đã re-verify; **canonical runner chưa chạy lại** nên trục `Tests` giữ số 22/07 kèm nhãn STALE; (5) 7 slice backlog stale status đã flip sang `merged` sau khi verify `merged_probe` trên `origin/main`. **Không phase nào thêm/bớt, không DD nào đổi trạng thái, delivery order không đổi, thanh ~33% không đổi.**
>
> **Cập nhật 25/07/2026 (v3.4e — evidence + authority reconcile):** canonical runner đã re-aggregate tại `2937ed9`: **460 workspace tests PASS** + 13 readiness-validator tests. DD-70/71/72 owner-final được propagate vào Notification pair/index/status; contract trở lại Reviewed nhưng runtime/migration vẫn zero. Next coding initiative là BE-only `db-job-claim-lease-core`; DD-81 canonical path = root `design.pen`, còn FE giữ HOLD tới khi file được persist/track + owner nghiệm thu làm authority. Không phase/delivery order/% runtime nào đổi.

> **Cập nhật 26/07/2026 (v3.4f — job-infra `0022` merged):** slice 1/4 `db-job-claim-lease-core` squash-merged tại **`34429fc`** (Verdict 19, authority `948636f`). Migration tail `0021`→**`0022`**; outbox/projector có lease 5 phút reclaim được + `job_audit_events` append-only + `job_definer` sở hữu đúng 5 function allowlist, `app_worker` chỉ EXECUTE. Canonical runner re-aggregate tại `34429fc`: **482 workspace tests** (db 179→**201**, +22 từ JCL-1..JCL-14) + 13 validator tests. **Code dark** — không queue/preflight/cron/producer/projector nào bật, nên **% runtime và delivery order không đổi**. Kế tiếp: slice 2 `job-runtime-dispatcher`, cần manifest + verdict riêng, không kế thừa authorization của slice 1.

> **Cập nhật 27/07/2026 (v3.4g — job-infra `0023` ack marker merged):** slice 2a `db-outbox-ack-marker` squash-merged
> tại **`76e1f7b`** (Verdict 23, authority `28d0c3a`). Migration tail `0022`→**`0023`** (24 file). Slice này đóng
> starvation loop mà `0022:166-181` **tự ghi chống lại chính nó** dưới nhãn `HARD BLOCKING REQUIREMENT`: lease 5 phút
> chỉ là crash-recovery, event xử lý xong không có đường ack nên vẫn hết lease, không phân biệt được với claim crash,
> bị reclaim mãi mãi — và vì reclaim chạy trước claim mới với `ORDER BY created_at`, tập event đã xong bỏ đói mọi event
> mới. Không sai kết quả (`prepare` idempotent), nhưng là bug throughput tăng dần. **Hai quyết định owner lấy tại design
> probe, trước khi có code:** (1) fan-out completeness là **cấu trúc chứ không phải comment** — `ack_outbox_event` nhận
> `p_required_projectors text[]` và raise nếu thiếu bất kỳ delivery row nào, vì chính hình dạng "ghi yêu cầu vào comment"
> đã hỏng một lần trong tuần này khi comment của `0022` bị bỏ sót lúc author manifest 2b; (2) chặn stale-ack bằng
> **danh tính** (`claim_token`) chứ không bằng thời gian, và đổi chữ ký `claim_outbox_batch` **ngay bây giờ** khi nó còn
> zero call site TypeScript. Canonical runner tại `76e1f7b`: **493 workspace tests** (db 201→**212**, +11 từ
> OAM-1..OAM-13) + 13 validator tests. **Vẫn code dark** — không producer/queue/cron/projector nào bật, nên **% runtime
> và delivery order không đổi**. Kế tiếp: slice 2b `job-runtime-dispatcher` (TypeScript-only, đã gỡ blocker; manifest
> amend + Verdict 22 re-pin cùng ngày).

> **Cập nhật 27/07/2026 (v3.4h — evidence snapshot, superseded về Chat bởi v3.4k):** `main@2dc9b8c` có đủ **25 migrations (`0000`–`0024`)**. Sau `0022`/`0023`, TypeScript dispatcher, queue registry/provision/preflight và worker lifecycle đã merge (`fca314e`); recovery scheduler 1 phút đã merge (`a03d2d6`) nhưng `OUTBOX_DISPATCH_SCHEDULE_ENABLED` mặc định **OFF** và chưa có domain producer/real projector, nên Sync/Session vẫn không runnable. `0024` chỉ cấm public session thiếu `slots_max`. Evidence hiện hành = **32 files / 537 workspace PASS + 13 validator**, static **528 + 9 generated**. Safari macOS/iOS M3 measurement đã đóng, nhưng Google login vẫn chưa enable. DD-91 chốt in-app Chat là **primary daily player surface mục tiêu** + requester-only `/pay`; migration/code/runtime Chat chưa tồn tại. Auto-reconcile giữ manual global và chỉ mở khi `payment_reconcile_auto` + exact market/provider/bank/currency/consent pass; SePay/ApiPay là Vietnam launch path chưa enable.
>
> **Cập nhật 28/07/2026 (v3.4l — Chat authority immutable/re-pin):** exact 27-file authority pack đã land tại `90d292d`; primary plan v1.8 và DD-86 analysis đã re-pin, closure 12/12, verdict `PLAN_READY`. Đây chỉ là quyền tách/author slice: B4 artifacts/worktree chưa có và mỗi mechanism/API/FE slice vẫn phải đạt strict `CODE_READY`. Owner-final DD-86/DD-91–95, DD-88 broader `DEFERRED_PROPOSAL`, mechanisms `1–47`, API `A1–A21`, FE `F0–F15`, G6 enablement gates và serialized DB lane `1→2→3→4` không đổi. Migration/code/runtime Chat vẫn chưa tồn tại; DD-32 Option D và delivery order không đổi.

> **Cập nhật 06/08/2026 (v3.4m — tuần 30/07→06/08, reconcile tại `2cd52ce`):** **88 commit** sau `3d75c90` (`git rev-list --count 3d75c90..2cd52ce` — `--first-parent` và `--no-merges` cũng đều 88; con số `58` ở bản nháp trước sai, không tái tạo được). **Migration tail `0025`→`0029`** (26→**30 file**), bốn file, ba lớp khác nhau và **không lớp nào mở hành vi nghiệp vụ**:
> `0026` (`89e074b`) đổi tên 6 CHECK sống-mà-không-khai sang tên `schema.ts` vừa khai — RENAME-only, zero predicate, đóng nốt phần `0025` cố ý loại ra;
> `0027` (`432ba11`) thêm `resolve_tenant_status_locked` SECURITY DEFINER read-only theo đúng khuôn `0012`, vì `FOR SHARE` đòi quyền UPDATE mà cấp UPDATE thẳng trên `tenants` sẽ mở lại đúng write-path mà AP-40 vừa đóng;
> `0028`/`0029` (`f901626`) là cặp **expand→contract DD-29 capability registry**: `plans.plan_key` 4-tier → **2-tier `free|host_pro`**, `plans.entitlements` sang shape lồng `{"capabilities": {...}}`, reseed, repoint write-path của `tenant_provision()` + mọi subscription `free_web`; row còn ở tier cũ ⇒ abort cả transaction thay vì repoint im lặng.
> **Đây là migration đầu tiên trong tháng chạm một hàm đang có caller runtime** (`tenant_provision()` gọi tại `packages/db/src/auth.ts:212`, đường onboarding) — nhưng **chưa TS nào đọc `entitlements`/`capabilities`**, nên vẫn chưa có behavior gating.
> **Code merge ngoài migration:** `authorizeTenantAction` — resolver trạng thái tenant fail-closed 2 bước (`ddb69a9`, `packages/db/src/authorization.ts`), **zero production caller**, mới chỉ re-export ở `packages/db/src/index.ts`; role `chat_definer` được provision bằng bootstrap script chứ không bằng migration (`286f48b`, `infra/postgres-init/02-chat-definer.sql`); bootstrap definer được serialize cluster-wide bằng khoá 2 tầng, **fail-open có chủ đích** dưới managed Postgres (`b55d628`). **Deps/security:** `next` 15.5.21 (`61a2575`), ESLint 9→**10.7.0** trước EOL (`a93a4f6`), và sàn `esbuild` khai-mà-không-áp-dụng nay áp thật, đóng GHSA-67mh-4wv8-2f99 (`62304b5`).
> **Chat lane:** `chat-definer-role-provisioning` đã merged; `chat-dm-safety-authority-core` **authored `CODE_READY` 05/08** (`521a904`, amend `ed54e31` đưa rate limit ra config) nhưng **chưa register/worktree/implement**; `dd38-dd86-chat-schema-core` authored `NOT_CODE_READY` (closure 10/12, chờ slice 1–2). Chat vẫn **0 migration · 0 API · 0 UI**.
> **Không đổi:** phase, DD status, delivery order, và thanh **~33%** — không slice nào mở producer/projector/service/route/FE nghiệp vụ. Trục Tests mang nhãn `STALE` cho tới lần chạy canonical runner kế tiếp. Autopilot kit v11→**v31**; verdict ledger tới **Verdict 31**.

> **Đánh số phase:** toàn bộ tài liệu dùng duy nhất **canonical P-number**. Các tên Foundation/Tenant Engine/... chỉ là delivery-group label, không tạo một hệ số thứ hai.

## Canonical Delivery Groups

> Cột **Duration** = ước lượng thời lượng thực thi. **Chưa owner điền** → `TBD` ở mọi dòng: file này **không** phát sinh cam kết ngày từ suy đoán.
> Cột **Traction signal** = bằng chứng *thực tế* để ưu tiên hoặc re-evaluate phase, tách khỏi dependency kỹ thuật. Dependency nói "làm được chưa"; signal nói "**nên** ưu tiên lúc nào". Signal không phải hard dependency hay `CODE_READY` gate; chỉ owner record trong `decisions.md` mới được defer/reorder một slice đã sẵn sàng kỹ thuật.

| Delivery group | Canonical | Nội dung | Duration | Traction signal (ưu tiên/re-evaluate khi…) |
|---|---|---|---|---|
| **Foundation** | **P0–P1** | Repo + core + Postgres/RLS + schema đa môn + 3 tầng hiển thị + test cô lập + **Google login / tài khoản web** | `TBD` | — (root, không gate) |
| **Tenant Engine** | **P2–P3** | Zalo tenant + **Messenger hybrid shared surface (P2.5)** + mark-paid + durable webhook/ledger + dogfood | `TBD` | Google login **ENABLED** thật (không chỉ merged) + 1 host đăng nhập được |
| **Identity** | **P3.5** | Person/ChannelIdentity/Reachability/Membership + **link Facebook/Zalo** + merge an toàn | `TBD` | Tenant #1 chạy ≥ **4 buổi thật** trên Zalo/Messenger, có ≥ 1 ca 1-người-2-kênh quan sát được |
| **Web + Sync + Marketplace** | **P4–P4.3** | Web surface + canonical backend + sync engine + onboarding + **chat in-app + cài đặt hồ sơ/giá theo giới tính** + discovery/join | `TBD` | ≥ **2 tenant** vận hành thật (1 có Page riêng, 1 dùng central) + ledger khớp sổ tay 2 kỳ liên tiếp |
| **Player-side channels** | **P4.5–P4.7** | Join Zalo/Messenger + nhắc/xác nhận + player view | `TBD` | ≥ **20 kèo public/tuần** trên marketplace (đủ cầu để player-side có việc để làm) |
| **Billing** | **P5** | Subscription host + vòng đời tenant | `TBD` | ≥ **3 host ngoài** dùng ≥ 4 tuần liên tục **và** ≥ 1 host hỏi/chấp nhận trả phí |
| **Harden & Scale** | **P6** | Pen-test, load test, observability, ToS/Privacy | `TBD` | Có doanh thu thật hoặc ≥ **10 tenant** — bất kỳ điều kiện nào đến trước |
| **Session Organize** *(accept-in-principle)* | **Post-P4 · TBD** | ✅ DD-61–64 (owner 18/07) — sân + trận 2 phía + assign 4-mode + live score; tenant-private, không public; build sau Session CRUD+Sync. DD-63 `balanced` degrade tới khi có level source | `TBD` | Ngoài committed timeline — không gate, không lên hàng đợi |
| **App Native** *(direction ✅ · build TBD)* | **Phase-2 · TBD** | ✅ DD-69 direction accepted (owner 18/07); RN+Expo recommendation sau spike; reuse chỉ client-safe TS contracts/format + canonical API, không import server i18n/money core. Native build chưa lên lịch/chưa chốt nền tảng | `TBD` | PWA (S9/S20) live + retention đo được trên PWA trước khi bàn native |

> **Traction signal không tự chặn code.** Nếu owner dùng signal để defer/reorder một slice đã sẵn sàng kỹ thuật, phải ghi quyết định đó vào `decisions.md`; không im lặng đổi dependency order.

---

## Positioning

> **Plexco — platform quản lý & khám phá hoạt động thể thao đa môn, cho cả host lẫn player. Phase-1 dùng Zalo/Facebook Messenger để acquisition/external touchpoint/fallback và đặt in-app Chat làm primary daily player surface mục tiêu.**

Ba giá trị cốt lõi: **Quản lý kèo & tiền (host)** + **Khám phá & join kèo (player, đa môn, cross-club)** + **Đồng bộ liền mạch đa kênh ⇄ Plexco**. Plexco không xoá nhóm chat sẵn có và vẫn giữ acquisition 0-install, nhưng DD-91 chủ đích chuyển hành vi hằng ngày của player về in-app Chat. Direction này chưa phải runtime.

> **DD-79/DD-81 ✅ direction (19/07; current mirror 28/07):** S9 PWA shell target gồm **Home hub landing** (composition-only trên player_view/marketplace/§A — spec Reviewed v0.7 + BE v0.3) + **bottom-nav registry** config-driven (5 slot; Feed gated DD-76; 💬 chat header) — không đổi thứ tự slice/dependency. Design tool là **Pencil**, canonical root path = `design.pen`, nhưng file chưa được persist/track + owner nghiệm thu làm authority. FE HOLD và theme exploration/handoff chỉ bắt đầu sau gate này.
>
> **Định hướng app-native (DD-69 ✅ accepted):** Plexco là app-first — **phase-1 target = web app PWA** (installable/offline; S9/S20 planned, chưa live), **phase-2 = app native**. Zalo/Messenger vẫn là acquisition 0-install; in-app Chat là daily target; native cho retention. Owner đã accept **định hướng**; native **build** chưa vào timeline committed — chờ các gate client-contract, `/api/v1`, bearer/iOS login, dedicated device push, privacy-safe payload, offline read-only và store review.
>
> **DD-91 (owner 27/07):** in-app Chat = primary daily player surface target; exact `/pay` là deterministic requester-only overlay trong club/private bot/human DM, không LLM và không persisted result. Payment lifecycle cần durable Inbox + generic push. DD đã `DECISION_FINAL`; readiness của root/downstream chỉ đọc từ primary plan §13 và slice packet tương ứng, không suy từ roadmap.

---

## Context & Chiến lược

### GTM: platform có sẵn user để acquire (0-install) → Plexco làm daily hub

| Nhóm chat (giữ nguyên) | Plexco (bổ sung) |
|---|---|
| Chat, hẹn giờ, bàn kèo; acquisition/fallback | Tạo/quản kèo (đa môn), roster, track ai trả/chưa; in-app Chat là daily target |
| Kênh thông báo tự nhiên | Đối soát CK tự động, nhắc/xác nhận tự động |
| Group Zalo / Facebook Messenger sẵn có | Bot DM (Zalo) / Page bot (Messenger) |
| (không có) | **Web app**: dashboard host, **marketplace tìm kèo**, player view, **in-app Chat primary target** — sync 2 chiều với mọi kênh |

→ Host không phải ép player cài app để acquire/join; player vào từ Zalo/Messenger, khám phá trên web, rồi Plexco hướng tương tác hằng ngày về in-app Chat khi DD-91 plan/runtime đủ gate.

### Vòng tăng trưởng 2 phía (network effect)

```text
Host publish kèo  ──▶  Marketplace nhiều kèo/đa môn  ──▶  Player tìm & join
      ▲                                                          │
      └──────── player mới kéo theo nhu cầu  ◀───────────────────┘
1 host mới = ~20–40 player tự vào hệ thống; player discovery = kênh acquisition phía cầu.
```

### Bootstrap (Day-1)

| Metric | Giá trị |
|---|---|
| Tenant #1 | CLB của founder (migrate data từ bot single-club đang chạy; go-forward vận hành trên Zalo/Messenger/web) |
| Môn khởi điểm | Cầu lông (beachhead) → mở pickleball/tennis khi có cầu |
| Buổi/tuần · Day-1 players | ~2 buổi · ~50 unique |

### Target Personas

| Persona | Mô tả | Pain point |
|---|---|---|
| **P1 Host** (Nam, 30t) | Tổ chức cầu lông hàng tuần, 15–30 người | Soi sao kê CK thủ công, đòi nợ lắt nhắt, dữ liệu phân mảnh |
| **P3 Player member** (Huy, 25t) | Chơi 2–3 buổi/tuần, nhiều CLB | Không rõ nợ buổi nào, CK rồi mà chưa được xác nhận |
| **P4 Player discovery** (Lan, 28t) | Muốn chơi thêm môn/CLB mới | Không biết quanh mình có kèo nào mở, môn mình thích, còn slot |

### Team

| Role | Focus |
|---|---|
| **Solo Dev** | Full-stack (TypeScript: Next.js + HTTP channel adapters + Drizzle/Postgres + SSE) |
| **AI Assistant** | Co-pilot: code, design docs, review |
| **Founder** | PM + QA + dogfood (tenant #1) + acquire host & seed marketplace |

### Khác biệt nền tảng (vs app-based)
Plexco xây **repo riêng**; lift logic thuần (matching, payments-logic, dates, format, sports) từ bot single-club sang `packages/core`; viết lại tầng data trên **Postgres + RLS**, thêm **public read model** + **sync engine**. Bot cũ (Telegram, lịch sử) **đóng băng, vẫn chạy** làm reference + migrate data thành tenant #1 khi cutover; go-forward CLB vận hành trên Zalo/Messenger/web.

---

## 7 Feature Tracks

| # | Track | Mô tả ngắn | Phase |
|---|---|---|---|
| 🏢 | **Multi-tenant Core + 3-tier** | repo choke-point + Postgres RLS + public read model + routing tenant theo kênh + **đa môn** + **Google login** | P0–P1 |
| 💰 | **Payment Reconciliation** | **mark-paid thủ công toàn cầu** + durable webhook → transaction → allocation → charge/debt → /unmatched; auto cần `payment_reconcile_auto` + market/provider/bank/currency/consent | P2/P3 |
| 🆔 | **Identity & Merge** | Person/ChannelIdentity/Membership, claim an toàn, **link Facebook/Zalo**, merge xuyên kênh | P3.5 |
| 🌐 | **Web app + Sync engine** | web surface + canonical backend + command/outbox/projection + realtime + **in-app Chat primary player target** (DD-38/DD-91) + cài đặt hồ sơ/giá theo giới tính | P4 |
| 🔎 | **Marketplace Discovery** | publish kèo → public projection → tìm kèo → join cross-club | P4.3 |
| 🎯 | **Player-side channels** | join Zalo/Messenger, nhắc, xác nhận | P4.5–P4.7 |
| 🔒 | **Security & Ops** | KMS, audit, token-drift, **bất biến public**, load/pen-test, sync-lag | xuyên suốt → P6 |

---

## Canonical Delivery Timeline

```text
 P0–P1          P2–P3                 P3.5        P4–P4.3                P4.5–P4.7       P5       P6
 ─────────      ───────────────        ─────       ─────────────          ──────────      ─────    ─────
 Foundation  →  Tenant Engine       →  Identity →  Web+Sync+Marketplace → Player channels → Billing → Harden
 RLS+sports     Zalo tenant + ledger   merge       canonical backend      Zalo/Messenger   sub      pen/load
 3-tier+Google  + Messenger(P2.5,AR)   + FB/Zalo   + chat + settings       + player view              +public
                + mark-paid thủ công   link        + discover/join

 Dogfood #1 ─────▶ seed marketplace ─────▶ external clubs ─────▶ thu phí ─────▶ scale
```

---

## 📐 Cách đọc tiến độ (measurement contract)

> Mục này tồn tại vì **một thanh % duy nhất luôn nói dối**. Nó gộp "đã spec" với "đã chạy được", và luôn lệch về phía lạc quan. Từ v3.4, mỗi delivery group được đo theo **6 trục độc lập** và trục yếu nhất là trục quyết định.

**Định nghĩa Done cho từng trục — không có nghĩa nào khác được dùng:**

| Trục | ✅ chỉ khi | Bằng chứng phải trỏ tới |
|---|---|---|
| **Spec** | Có cặp Product + BE, trạng thái Reviewed (không phải Draft) | file trong `docs/features/` + `docs/features/BE/` |
| **Migration** | File `.sql` đã merge lên `main` **và** áp được lên PG sạch | số hiệu migration trong `packages/db/migrations/` |
| **BE** | Có service/route/function thật, không phải chỉ bảng | đường dẫn file + tên route |
| **FE/UI** | Màn hình chạy trên app thật, nối API thật | route Next.js. **Màn hình trong `.pen` KHÔNG tính là FE** — chỉ tính vào trục Design |
| **Tests** | Test chạy xanh trong CI | tên file test + số case |
| **Invariant** | Test bất biến xanh — **tenant isolation/RLS · public field-whitelist · no-money-leak · concurrency/race-safety** | `packages/db/src/*-invariants.test.ts` **+ danh sách invariant-class đặt tên khác** (bảng ngay dưới). Không suy ra từ tên file: file chỉ tính khi có tên trong danh sách |

**Danh sách invariant-class (re-verify tại `2cd52ce` — vẫn đúng 3 file; `rls-invariants.test.ts` và `migrate.test.ts` có nhận case mới trong tuần 30/07→06/08 nhưng không sinh file invariant-class mới)** — trục Invariant chỉ đếm các file dưới đây; thêm file mới phải thêm dòng ở đây, không dựa vào quy ước đặt tên:

| File | Invariant bảo vệ | Khớp pattern `*-invariants` |
|---|---|---|
| `packages/db/src/rls-invariants.test.ts` | Tenant isolation fail-closed · public field-whitelist | ✅ |
| `packages/db/src/waitlist-invariants.test.ts` | Waitlist ordering/capacity | ✅ |
| `packages/db/src/migrate.test.ts` | **Race-safety của role bootstrap `0000`** (concurrency) | ❌ tên không theo pattern — vẫn tính vì đúng invariant-class |

> Tồn đọng đã biết: `migrate.test.ts` đúng class nhưng lệch quy ước đặt tên. Có thể đóng bằng rename (`migrate-invariants.test.ts`) trong một code slice riêng; **chưa làm ở đây** vì ROADMAP là doc-only. Tới lúc đó danh sách trên là nguồn sự thật.

**5 luật chống lạm phát con số** — vi phạm bất kỳ luật nào ⇒ số liệu bị coi là vô hiệu:

1. **Docs ≠ runtime.** Spec Reviewed không cộng vào bất kỳ trục code nào. (Luật này đã có; nay áp cho cả bảng số.)
2. **Merged ≠ enabled.** Code merge nhưng feature flag/env còn tắt ⇒ trạng thái là `🟢 merged · ⛔ chưa bật`, **không** phải ✅. Ví dụ sống: lane Google.
3. **`.pen` screens ≠ FE.** Design xong không kéo FE lên %.
4. **Đếm được thì phải tái tạo được.** Mọi số trong file này đi kèm lệnh tái tạo bên dưới. Với test case: **canonical runner (`pnpm test`) là authority duy nhất**; *static grep* là cross-check chạy được không cần DB, dùng để **phát hiện drift**, không dùng để khai số.
   **Công thức đối chiếu:** `static + Σ(test sinh trong loop) = runner`. Test sinh trong loop = table-driven test viết bằng `for…of`/`forEach` bọc ngoài `it()` — grep chỉ đếm 1 lần dù runner sinh N.
   **Generator hiện hành tại `784bc8d` — vẫn đúng 1 chỗ:** `apps/web/lib/google-oidc.test.ts` (`for (const row of rows)`, `rows.length = 10` ⇒ `+9`). Đối chiếu: `528 + 9 = 537` ✅.
   **Lưu ý 06/08:** phép đối chiếu này chỉ hợp lệ khi static và runner cùng đo trên một commit. Tại `2cd52ce` static = **655** nhưng runner lần cuối chạy ở `3d75c90` (561) ⇒ **không được cộng `655 + 9` rồi khai là số test.** Kiểm kê generator phải chạy lại cùng lúc với runner; `packages/db` là nơi tăng toàn bộ +127 nên đó là chỗ phải soi generator mới trước tiên.
   Nếu công thức không khớp ⇒ hoặc có generator mới chưa kiểm kê (thêm vào danh sách trên), hoặc doc đã drift. **Không được chọn số lớn hơn để cho khớp.**
5. **Trục yếu nhất là trạng thái thật.** Một group có Spec ✅ / BE ✅ / FE ⬜ thì là **⬜ chưa dùng được**, không phải "gần xong".

<details>
<summary><b>Lệnh tái tạo số đếm</b> (chạy ở repo root)</summary>

```bash
# migrations
ls packages/db/migrations/*.sql | wc -l
# test files (loại trừ dependency và worktree)
find packages apps -type f \( -name "*.test.ts" -o -name "*.test.tsx" \) \
  -not -path "*/node_modules/*" -not -path "*/.autopilot/worktrees/*" | wc -l
# test cases — canonical runner (AUTHORITY cho số test và trục Tests)
DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm test
# static cross-check (không cần DB) — dùng để phát hiện drift, KHÔNG dùng để khai số
grep -rhoE "^[[:space:]]*(it|test)\(" packages apps \
  --include="*.test.ts" --include="*.test.tsx" | wc -l
# kiểm kê generator (loop bọc ngoài it()) — nguồn duy nhất gây lệch static vs runner
grep -rnE "^[[:space:]]*(for[[:space:]]*\(|.*\.forEach\()" packages apps \
  --include="*.test.ts" -A3 | grep -B1 -E "^\S+-[0-9]+-[[:space:]]*(it|test)\("
# API routes đang có
find apps/web/app/api -name "route.ts" | wc -l
# feature specs: không đếm coverage index hoặc supporting invariant table
find docs/features -maxdepth 1 -type f -name "feature_*.md" | wc -l
find docs/features/BE -maxdepth 1 -type f -name "feature_*_tech.md" | wc -l
```

</details>

## 📊 Dev Progress Overview

**Số đếm kiểm chứng được — `main@2cd52ced65597546fc2bfce82ffae0cdf8e49a53` (06/08/2026):**

| Hạng mục | Số thực | Ghi chú |
|---|---|---|
| Migrations trên `main` | **30** (`0000`–`0029`) | ✅ re-verify tại `2cd52ce`. `0015` D0a · `0016` D1 email-token · `0017` OAuth tx · `0018` handoff · `0019`–`0021` tenant-integrity composite FK DD-68 · `0022` job lease/reclaim · `0023` outbox ack marker · `0024` `sessions_public_capacity_chk` · `0025` rename 40 CHECK · **`0026` rename 6 CHECK sống-không-khai** · **`0027` `resolve_tenant_status_locked` SECURITY DEFINER read-only** · **`0028`/`0029` DD-29 capability registry expand→contract** |
| Test file | **33** | +1 so với snapshot 28/07 |
| Test case — **canonical runner** | ⚠️ **`STALE` — 561 workspace PASS đo tại `3d75c90` (29/07)** · **574 gồm validator** | core 132 · db **243** · web 146 · bot 40 + 13 readiness-validator. **Chưa chạy lại** sau `0026`–`0029`/`authorizeTenantAction`. Chuỗi historical: 460 (`2937ed9`) → 482 (`34429fc`) → 493 (`76e1f7b`) → 519 (`fca314e`) → 526 (`c100937`) → 537 (`a03d2d6`) → **561** (`3d75c90`). Theo luật 4, đây vẫn là số duy nhất được khai cho trục Tests cho tới lần chạy runner kế tiếp |
| Test case — **static cross-check** | **655** *(đo tại `2cd52ce`)* | core 132 · db **346** · web 137 · bot 40. Static 528 → 655 (+127, toàn bộ ở `packages/db`) là **tín hiệu drift**, **không** phải số test: nó nói runner sẽ vượt 561 khi chạy lại, không nói vượt bao nhiêu. Công thức `static + Σ(generated) = runner` chỉ được đối chiếu tại thời điểm cả hai cùng đo |
| Bằng chứng test per-slice (real-PG) | db **167** → **173** → **179** → **201** → **212** → **219** → **243** | `0019` → `0020` → `0021` → `0022` → `0023` → `0024` → `0025`. Là authority của **chính slice đó**, không phải aggregate toàn repo; per-slice của `0026`–`0029` nằm trong verdict tương ứng |
| Invariant test | **3 file** | `rls-invariants` · `waitlist-invariants` · `migrate` (race-safety `0000`) — xem danh sách invariant-class ở §Cách đọc tiến độ |
| API route đang có | **10** | ✅ re-verify tại `2cd52ce` — **không đổi**. 8 auth + 2 onboarding. **0 route nghiệp vụ** (session/payment/sync) |
| Feature spec | **24 Product + 24 BE = 24 cặp** | ✅ re-verify committed `main@2cd52ce`; khoảng trống 24/23 đã đóng. Coverage cao — *không* phải readiness |
| Màn FE nối API thật | **0** | FE vẫn **HOLD**. 12 FE spec `docs/channels/web/FE/feature_*_fe.md` + `design.pen` tồn tại trong working tree nhưng **chưa commit** và theo luật 3 **không tính vào trục FE/UI** |

> **Lịch sử (22/07) — static/canonical divergence, nguyên nhân đã xác định.** *(Giữ nguyên làm tiền lệ đối chiếu; con số dưới đây thuộc `f93873b`, không phải `2937ed9`.)* Static grep cho **410** (core 111 · db 159 · web 137 · bot 3); canonical runner PASS cho **419** (web 146). Chênh **9** đến từ **đúng một table-driven generator**: `apps/web/lib/google-oidc.test.ts:133` — `for (const row of rows) { it(…) }` với `rows.length = 10`, grep đếm 1 lần trong khi vitest sinh 10. Loop viết bằng `for…of` thuần nên **không** bị `it.each` bắt được (repo có 0 hit `.each`); hai loop còn lại ở `oauth-transaction.test.ts:71,96` nằm *trong* thân `it()` nên mỗi cái vẫn là 1 test.
> Đối chiếu khớp: `410 + 9 = 419`. **Authority duy nhất cho số test và trục Tests vẫn là output canonical runner**; static giữ vai trò phát hiện drift qua công thức ở luật 4.

**Ma trận theo delivery group** — ✅ done · 🟢 merged-chưa-bật · 🟡 một phần · ⬜ chưa bắt đầu · — không áp dụng:

| Delivery group | Spec | Migration | BE | FE/UI | Tests | Invariant | Trạng thái thật (trục yếu nhất) |
|---|---|---|---|---|---|---|---|
| **P0–P1 Foundation** | ✅ | ✅ `0000`–`0014` | ✅ core+db | ⬜ | ✅ runner: core 132 + db 243 *(`STALE` từ 29/07)* | ✅ RLS + waitlist + migrate-race | 🟡 **nền xong, chưa có surface** |
| **P0–P1 · 3b Auth (Google lane)** | ✅ | ✅ `0015`–`0018` | ✅ 8 route | 🟡 callback/landing | ✅ runner web 146 | ✅ auth/RLS trong db suite | 🟢 **merged · measurement closed · ⛔ chưa bật** (owner go-live/env decision) |
| **Tenant-integrity FK (DD-68, ngoài P-number)** | ✅ (DD-68 chốt) | ✅ `0019`–`0021` | — *(code dark, không service/route)* | — | ✅ real-PG per-slice: db 167 → 173 → 179 | ✅ cross-tenant reject theo từng FK dưới app role | ✅ **merged** — integrity đóng, **không mở hành vi nào** |
| **Shared job runtime (cross-cutting)** | ✅ DD-89/DD-90 | ✅ `0022`–`0023` | 🟡 claim/ack + dispatcher + queue/preflight + scheduler | — | ✅ db 201→212 + bot 3→40 | ✅ narrow EXECUTE-only/audit/fan-out completeness | 🟡 **infra merged, schedule OFF, no producer/projector** |
| **Naming-identity CHECK (ngoài P-number)** | — *(không phải feature)* | ✅ `0025`–`0026` | — | — | ✅ real-PG db 219→243 (`0025`) | — | ✅ **merged** — RENAME-only, zero predicate change, không mở hành vi nào |
| **Tenant authz + capability registry (DD-29, ngoài P-number)** | ✅ DD-29 · billing BE §2/§4b Reviewed | ✅ `0027` definer read · `0028`/`0029` expand→contract | 🟡 `authorizeTenantAction` merged nhưng **0 production caller**; `tenant_provision()` write-path đã repoint | — | ✅ per-slice trong Verdict 28/31 + DD-29 slice | 🟡 fail-closed 2-bước + refuse-to-proceed guard ở `0029` | 🟢 **merged · code dark** — chưa TS nào đọc `entitlements`/`capabilities`, chưa gate hành vi nào |
| **P2–P3 Tenant Engine** | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not Started |
| **P2.5 Messenger** | ✅ Reviewed contract | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not Started · 🔗 chặn App Review |
| **P3.5 Identity** | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not Started |
| **P4–P4.3 Web+Sync+Market** | 🟡 mixed: Reviewed + Draft — *publish/draft-lifecycle của Session nay là contract đóng (23–24/07)* | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not Started |
| **P4.5–P4.7 Player channels** | 🟡 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not Started |
| **P5 Billing** | ✅ Reviewed | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Not Started |
| **P6 Harden** | ✅ Reviewed | — | ⬜ | — | ⬜ | ⬜ | ⬜ Not Started |

```text
TỔNG (code, theo slice roadmap)  ██████░░░░░░░░░░░░░░  ~33%
   ├─ nền móng (core + db/RLS)   ███████████████████░  ~90%  ✅ có test, có invariant
   ├─ auth (lane Google)         ████████████████░░░░  ~80%  🟢 code+measurement xong · ⛔ chưa bật
   └─ feature nghiệp vụ          █░░░░░░░░░░░░░░░░░░░   ~5%  ⬜ session/reconcile/sync/marketplace chưa wiring
```

> **Đọc con số ~33% cho đúng:** nó đo *slice roadmap đã merge*, không đo "sản phẩm dùng được". Theo luật 5, sản phẩm hiện ở mức **⬜ chưa host nào dùng được** — vì FE/UI = 0 màn và route nghiệp vụ = 0. Đây là chỗ trước đây file khai 75% cho Foundation và gây hiểu nhầm.
>
> **Vì sao ~33% chưa tăng:** `0019`–`0021` và `0024` là integrity-only; core fix nằm trong module đã tính; docs không phải runtime. `0022`/`0023` + dispatcher/scheduler là shared job capability nhưng schedule OFF và chưa có product producer/projector/service/route/FE, nên không đóng một delivery group dùng được. Chỉ cập nhật % khi một slice roadmap có hành vi product thực sự land.
>
> **Tuần 30/07→06/08 cũng không tăng, và lý do đáng ghi vì nó dễ bị đọc nhầm:** `0025`/`0026` là rename thuần; `0027` là quyền đọc-khoá cho một hàm chưa ai gọi; `0028`/`0029` đổi hình dạng plan/entitlement và repoint `tenant_provision()` — **có chạm đường onboarding thật**, nhưng chưa TS nào đọc `capabilities` nên chưa entitlement nào được thực thi. `authorizeTenantAction` là **root dependency** đã merge chứ chưa phải feature: nó tồn tại để các slice sau gọi. Bốn migration trong một tuần vẫn ra **0 hành vi product mới**.

> **FE boundary hiện hành:** cột FE/UI trống toàn bộ, nhưng không mở UI tạm trong chuỗi BE kế tiếp. FE giữ **HOLD** tới khi canonical `design.pen` được persist/track + owner nghiệm thu làm authority; sau đó mới map screen/component/token/state lên BE contract đã ổn định.

### Module Progress

> Cột **Rev?** = module này có nằm trên đường tới đồng doanh thu đầu tiên không (xem §Critical Path to Revenue). 🔴 = chặn revenue · 🟡 = tăng giá trị gói trả phí · ⬜ = không chặn revenue.

| # | Module | Track | Phase | Spec | Migration | BE | FE | Tests | Rev? | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Monorepo + lift `core` (+ `sports`) | 🏢 | P0 | ✅ | — | ✅ | — | ✅ runner 132 | 🔴 | ✅ (S1/S2 merged) · +fix DD-87 `splitNameAmount` |
| 2 | Postgres + Drizzle + RLS + **public read model skeleton** | 🏢 | P0 | ✅ | ✅ `0000`–`0013` *(+`0019`–`0024` integrity/job tail)* | ✅ | — | ✅ real-PG 219 tại `0024` | 🔴 | ✅ (S3 merged); `0024` invariant-only |
| 3 | Tenant schema (đa môn, session.visibility/slot/join_policy) + repo choke-point | 🏢 | P0–P1 | ✅ | ✅ | ✅ | — | ✅ | 🔴 | ✅ (S3 merged) |
| 3b | **Google login / tài khoản web (email)** (DD-13/DD-80) | 🏢 | P0–P1 | ✅ | ✅ `0015`–`0018` | ✅ 8 route | 🟡 | ✅ runner web 146 | 🔴 | 🟢 **merged · Safari measurement closed · ⛔ chưa bật** |
| 3c | Email/password bundle (order-4, flag OFF) + gỡ Telegram | 🏢 | P0–P1 | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | 🟡 | ⬜ kế tiếp trong lane DD-80 |
| 4 | **Chat-channel tenant middleware** (Zalo P2 → Messenger P2.5) | 🏢 | P2/P2.5 | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | 🔴 | ⬜ |
| 4b | **Mark-paid thủ công (tiền mặt/CK, tap/multi-select)** (DD-40) | 💰 | P2 | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | 🔴 | ⬜ |
| 5 | Durable webhook + ledger/allocation + /unmatched (auto gated) | 💰 | P3 | ✅ + regional research | ⬜ | ⬜ | ⬜ | ⬜ | 🟡 | ⬜ manual global; auto cần entitlement + market/provider/bank/currency/consent |
| 17 | **Messenger central+optional Page; host/player shared core; 24h/App Review** | 🏢🎯 | **P2.5** | ✅ Reviewed contract | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ · 🔗 App Review |
| 6 | Migrate data bot cũ → tenant #1 | 🏢 | P3 | ✅ covered | ⬜ | ⬜ | — | ⬜ | ⬜ | ⬜ |
| 7 | Identity directory + merge (**link Facebook/Zalo**) | 🆔 | P3.5 | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 8 | **Web app surface + canonical backend** | 🌐 | P4 | ✅ Reviewed | ⬜ | ⬜ | ⬜ | ⬜ | 🔴 | ⬜ |
| 9 | **Sync engine** (command/outbox/projection + realtime) | 🌐 | P4 | ✅ Reviewed | 🟡 shared `0022`/`0023` | 🟡 dispatcher/queue/scheduler | ⬜ | ✅ infra tests only | ⬜ | 🟡 **infra-only** — schedule OFF; no producer/real projector |
| 10 | Onboarding self-serve; Messenger central default + optional Page riêng | 🌐 | P4 | 🟡 Draft | ⬜ | ⬜ | ⬜ | ⬜ | 🟡 | ⬜ |
| 10b | **In-app Chat primary player target** (DD-38/DD-86/DD-91–95) | 🌐 | P4 | Reviewed; primary plan v1.8 = `PLAN_READY` at `90d292d`; owns mechanism slices 1–47 + API A1–A21 + FE F0–F15; first handoff §9.2, each slice still strict `CODE_READY` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ no runtime/migration/API/UI |
| 10c | **Cài đặt hồ sơ + giá theo giới tính** (DD-39 ✅) | 🌐 | P4 | 🟡 draft | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 11 | **Publish kèo → public_sessions projection** | 🔎 | P4.3 | ✅ Reviewed — contract publish/draft lifecycle đóng | ✅ `0024` capacity invariant only | ⬜ producer/projector/service/route | ⬜ | ✅ PVC invariant only | ⬜ | ⬜ **chưa runnable** — shared job infra đã merge nhưng schedule OFF/placeholder |
| 12 | **Discovery / tìm kèo** | 🔎 | P4.3 | ✅ Reviewed | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 13 | **Join cross-club** | 🔎 | P4.3 | ✅ Reviewed | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 13a | **Channel booking decision → intent/hold → occupancy → verified-payment finalizer (DD-32)** | 🔎🎯 | P2.5/P4.3/P4.7 | ✅ Reviewed contract; readiness owned by its implementation plan | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ no runtime |
| 14 | Player join Messenger (quick-reply; base enablement P2.5) | 🎯 | P4.5 | 🟡 draft | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 15 | Player join Zalo (number-reply) | 🎯 | P4.7 | ✅ Reviewed | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 16 | Reminder + notifyPlayersPaid (+ sync) — web + Zalo chính, Messenger 24h | 🎯 | P4.5–P4.7 | 🟡 Draft | ⬜ | ⬜ | ⬜ | ⬜ | 🟡 | ⬜ |
| 18 | Billing + lifecycle | 💰 | P5 | ✅ Reviewed | 🟢 `0027`–`0029` (DD-29 registry + tenant status read) | 🟡 `authorizeTenantAction` merged, **0 caller** | ⬜ | ✅ per-slice | 🔴 | 🟢 **nền authz/entitlement merged · code dark** — chưa TS đọc `capabilities`, chưa gate/charge gì |
| 19 | Hardening (pen/load/obs + **public pen-test**) | 🔒 | P6 | ✅ Reviewed | — | ⬜ | — | ⬜ | ⬜ | ⬜ |

> Module 17 (Messenger) **phase-1** nhưng chặn bởi **App Review Meta** — nộp sớm; degrade sang web + Zalo nếu App Review chậm (BRD OD-9/DD-37 · `../channels/messenger/messenger-channel-design.md`).
>
> **Module 3b (auth) — reconcile 22/07:** toàn bộ lane Google **đã merge** trên `main@f93873b08d73f7a11c2576196b09633b9197ad60` (D0a `0015` → D0b → D1 email-token `0016` → D1 google-adapter `0017` → d1b session-rotation `0018`); canonical suite PASS (db 159 · web 146 — xem §Dev Progress). **Nhưng chưa bật:** completion-hop M3 cần bằng chứng đo trên **Safari macOS + iOS thật** (Playwright chỉ có WebKit đóng băng); `GOOGLE_OAUTH_CLIENT_ID/SECRET` giữ rỗng tới khi đo xong — thủ tục ở `../probes/probe-strict-cookie-completion-hop.md` §7. Đây là ví dụ chuẩn của luật **merged ≠ enabled**: trạng thái là 🟢, **không** phải ✅.
>
> **Cập nhật hiện hành 27/07:** Safari macOS + iOS Safari đã đo pass ngày 26/07; measurement obligation đã đóng. Google login vẫn **chưa enable** vì setting `GOOGLE_OAUTH_*`/CTA là owner go-live decision riêng và các gate production khác không tự được miễn. Ghi chú 22/07 phía trên chỉ còn là historical timeline.
>
> **Chat authoring ≠ enablement:** slice 19 `player-self-sessions-waitlist-read-core` có thể được author read-only trực tiếp trên baseline `players/memberships/sessions` đã merge, **không** phụ thuộc full SessionService. Nhưng bật `/sessions|/waitlist` beta vẫn cần các packet strict current-authority `svc-session-crud`, `svc-session-join-leave`, `svc-waitlist-promotion-core` và production-shaped data E2E. Tương tự, payment Inbox/push chỉ được enable sau slices 43–45, một real payment/reconciliation source producer, exactly-once/correction E2E và authenticated-detail parity.

---

## P0–P1: FOUNDATION — Repo, Core, RLS, đa môn, 3 tầng, Google login

> **Mục tiêu:** nền multi-tenant an toàn + chiều đa môn + khung 3 tầng hiển thị + **auth web (Google + email)**, trước khi có feature.
> **Duration:** `TBD` · **Traction signal:** — (root)
> **Status:** 🟡 Partially complete — nền + toàn bộ lane Google đã merge (`0000`–`0018`), Safari/iOS measurement đã đóng; **Google vẫn chưa bật** (owner go-live/env decision riêng) và email bundle order-4 chưa code. Tail toàn cục hiện là `0024`; `0019`–`0024` là integrity/shared-job layers ngoài auth lane.

| ID | Item | Mô tả | Prio | Status |
|---|---|---|---|---|
| 1.1 | Monorepo pnpm | `packages/core` + `apps/bot` + `apps/web` | P0 | ✅ |
| 1.2 | Lift `core` | matching, payments-logic, dates, format, i18n, **sports** + test xanh | P0 | ✅ 132 case |
| 2.1 | Postgres + Drizzle | thay `node:sqlite` | P0 | ✅ |
| 3.1 | Schema tenant đa môn | mọi bảng `tenant_id`; `sports`; `sessions.{sport_id,visibility,slots_max,area,venue,skill_level,join_policy}` | P0 | ✅ |
| 2.2 | **RLS** | ENABLE+FORCE, role `app NOBYPASSRLS`, fail-closed | P0 | ✅ `0009` |
| 2.3 | **Public read model skeleton** | bảng `public_sessions` + field whitelist (chưa cần projector đầy đủ) | P0 | ✅ `0006` |
| 3.2 | Repo choke-point | `tenantRepo(tenantId)` + `withTenant` (`SET LOCAL`) | P0 | ✅ |
| 3b.1 | **Google OAuth adapter** | PKCE tx `0017` + `/api/auth/google/{state,callback,complete}` + finalizer per-lane | P1 | 🟢 merged |
| 3b.2 | **Session rotation completion hop (M3)** | `0018` handoff arm/consume; issuance fence reject-and-reauth | P1 | 🟢 merged |
| 3b.3 | **Bật Google login** | Safari measurement ✅; owner quyết định go-live rồi mới set `GOOGLE_OAUTH_*`/CTA và verify production gates | P1 | ⛔ **chưa enable** |
| 3c.1 | **Email/password bundle** | order-4, một release unit, flag OFF (gate C7) | P1 | ⬜ |
| 3c.2 | Gỡ provider Telegram-era | sau khi 3c.1 land | P1 | ⬜ |
| 2.4 | **Test bất biến** | cô lập tenant A/B + **public chỉ field whitelist** + migration race-safety | P0 | ✅ 3 file |

**DoD:** `drizzle push` lên Postgres sạch, RLS bật, **đăng nhập Google thật trên Safari/iOS tạo được tenant** (không chỉ merge code), test cô lập + test bất biến public xanh trong CI.

---

## P2–P3: TENANT ENGINE — Owner-side đa tenant + mark-paid + đối soát CK

> **Mục tiêu:** Zalo bot-per-club + Messenger hybrid phục vụ host/player; club không Page vẫn vận hành qua central; mark-paid/CK đúng tenant. Dogfood tenant #1.
> **Duration:** `TBD` · **Traction signal:** Google login **ENABLED** thật + 1 host đăng nhập được
> **Status:** ⬜ Not Started

### R1 — Zalo biết tenant

| ID | Item | Prio | Rev? | Status |
|---|---|---|---|---|
| 4.1 | Webhook `/webhook/zalo/:token` (bot-per-club) | P0 | 🔴 | ⬜ |
| 4.2 | Tenant middleware (`webhook_token→tenant`, `ctx.repo`) | P0 | 🔴 | ⬜ |
| 4.3 | Authz 2 lớp: resolve actor/context rồi `authorize(exact_action, actor, target)` qua DD-56 registry; role label không tự grant | P0 | 🔴 | ⬜ |
| 4.4 | Lệnh host đa-tenant (`/newsession` đa môn, `/announce`, `/config`, `/cash`) | P0 | 🔴 | ⬜ |
| 4b.1 | **Mark-paid thủ công** (tiền mặt/CK, tap/multi-select — DD-40) | P0 | 🔴 | ⬜ |
| 4.5 | Cron đa-tenant + throttler | P1 | ⬜ | ⬜ |

### R1.5 — Kênh Facebook Messenger (P2.5, App Review)

| ID | Item | Prio | Rev? | Status |
|---|---|---|---|---|
| 17.1 | Một Meta App + central Page + optional tenant Page | P0 | ⬜ | ⬜ · 🔗 App Review |
| 17.2 | Migration global-protected registry/Page identity/reachability/action state | P0 | ⬜ | ⬜ |
| 17.3 | Endpoint/default resolver | P0 | ⬜ | ⬜ |
| 17.4 | Role-aware host `/newsession` wizard + player discover/join qua shared Session/Join/AuthZ core | P0 | ⬜ | ⬜ |
| 17.5 | Opaque paginated actions · one-route delivery | P0 | ⬜ | ⬜ |
| 17.6 | App Review / 24h fail-closed | P0 | ⬜ | ⬜ · 🔗 ngoài tầm kiểm soát |

### R2 — Webhook CK biết tenant + payment ledger (`host_pro`)

| ID | Item | Prio | Rev? | Status |
|---|---|---|---|---|
| 5.1 | `/webhook/sepay/:token` (route token + verify TK + timing-safe) | P0 | 🟡 | ⬜ |
| 5.2 | Transaction lưu `bank_transactions` + enqueue trước ACK | P0 | 🟡 | ⬜ |
| 5.3 | Matching đa-tenant | P0 | 🟡 | ⬜ |
| 5.4 | `charges` + `payment_allocations` (partial/multi-person/overpay/reversal) · FIFO + BL-2 | P0 | 🟡 | ⬜ |
| 5.5 | `/unmatched` + retry cron | P1 | 🟡 | ⬜ |

**Auto-reconcile là tier `host_pro`; free dùng mark-paid thủ công (4b.1).** → 5.x là *giá trị gói trả phí* (🟡), không chặn đường tới revenue; 4b.1 mới chặn.

### R3 — Migrate tenant #1

| ID | Item | Prio | Rev? | Status |
|---|---|---|---|---|
| 6.1 | Script SQLite→Postgres (tenant "Bestminton" + BankAccount + copy data, `sport=cầu lông`) | P0 | ⬜ | ⬜ |
| 6.2 | Cutover: đối chiếu số dòng → link Zalo/Messenger → go-forward | P0 | ⬜ | ⬜ |

*(Bot Telegram cũ đóng băng làm reference lịch sử.)*

**🎯 Milestone:** 2 tenant (một có Page riêng, một không) dùng central; host tạo và player join đúng tenant trên central/tenant Page; no cross-tenant/double-send; Zalo/payment dogfood vẫn đúng.

### KPI P2–P3
% CK auto-match (name-based, `host_pro`) ≥ 70% · sự cố cross-tenant = 0.

---

## P3.5: IDENTITY — Gộp đúng 1 người xuyên kênh

> **Mục tiêu:** Person toàn cục + **link Facebook/Zalo vào Person đăng nhập Google** + merge an toàn (nền cho player-side & player view & discovery join).
> **Duration:** `TBD` · **Traction signal:** tenant #1 chạy ≥ 4 buổi thật trên Zalo/Messenger + có ≥ 1 ca 1-người-2-kênh quan sát được
> **Status:** ⬜ Not Started

Person/ChannelIdentity/Reachability (C1) · Membership (refactor members, UNIQUE per tenant) · **link Facebook + Zalo** vào cùng Person · claim-có-tiền cần verified account email hoặc transactional one-time `link_code` (**DD-50: không thu SĐT phase-1, phone dormant**) · conflict-safe merge plan, không rewrite ledger (DD-53).

**🎯 Milestone:** 1 người qua Facebook + Zalo cùng CLB = 1 nợ; merge có audit, không vỡ UNIQUE.

---

## P4–P4.3: WEB + SYNC + MARKETPLACE — Canonical backend & 2 phía

> **Mục tiêu:** PostgreSQL/domain model làm canonical store; web và chat là surfaces đồng bộ; host onboard self-serve; **chat in-app + cài đặt hồ sơ/giá theo giới tính**; player **khám phá & join kèo cross-club**.
> **Prerequisite:** P2–P3.5 stable.
> **Duration:** `TBD` · **Traction signal:** ≥ 2 tenant vận hành thật (1 có Page riêng, 1 dùng central) + ledger khớp sổ tay 2 kỳ liên tiếp
> **Status:** ⬜ Not Started

### R4 — Web app + Sync engine
| Feature | Mô tả | Prio |
|---|---|---|
| Web surface + canonical backend | host dashboard/player view; mọi ghi qua domain services vào PostgreSQL | P0 |
| Command bus + outbox | mọi action (mọi surface) → command → ghi + outbox event (cùng tx) | P0 |
| Projectors | Zalo · Messenger one-route tenant→central · realtime web · public_sessions | P0 |
| Idempotent + re-project | `commandId`/`event.id`; dựng lại surface khi lệch | P0 |
| **Chat in-app** (DD-38 ✅) | chat toàn CLB (RLS) + 1-1 (person-self); chỉ Plexco, **không bridge** kênh ngoài; SSE (schema `chat_*` chờ migration) | P1 |
| **Cài đặt hồ sơ + giá theo giới tính** (DD-39 ✅) | gender/dob/name/username/language; giá nam/nữ, suy charge theo `person.gender`; PII không lộ public (cột `person.gender` chờ migration) | P1 |

### R5 — Onboarding self-serve
Web signup → tenant/config/bank/Zalo. Messenger central sẵn; Page riêng optional FB Login/chọn Page, lỗi/revoke không block central fallback.

### R6 — Marketplace discovery (2 phía)
| Feature | Mô tả | Prio |
|---|---|---|
| Publish kèo | `visibility=public` → projector đẩy field-whitelist vào `public_sessions` | P0 |
| Discovery API/UI | lọc môn/khu vực/ngày/giờ/trình độ/giá/slot; cross-tenant, no-RLS, no tiền/PII/giới tính | P0 |
| Join cross-club | open → common join only after source authorization; approval → pending first; channel final confirm uses DD-32 link-or-pay gate + active/live-hold occupancy | P0 |
| Channel booking core | one decision core → tenant intent/15-minute hold → shared occupancy → verified-payment finalizer → thin Messenger/Zalo adapters | P0 |
| Bất biến public | test CI: field whitelist; private không lộ; join không trả tiền/PII/giới tính | P0 |

**🎯 Milestone (DoD):** host tạo kèo trên web → hiện ở Zalo/Messenger **và** marketplace ≤ vài giây; player lạ tìm kèo theo môn/khu vực và **join được**; chat in-app hoạt động; không lộ tiền/PII/giới tính ra public.

### KPI P4–P4.3
% player join qua discovery (CLB chưa từng tham gia) ≥ ngưỡng · số kèo publish/tuần tăng · sync-lag p95 ≤ 3 giây, p99 ≤ 10 giây · lộ tiền/PII/giới tính ra public = 0.

---

## P4.5–P4.7: PLAYER-SIDE CHANNELS — Join & nhắc/xác nhận đa kênh

> **Mục tiêu:** player join mượt từ chính kênh chat (Messenger → Zalo) + được nhắc/xác nhận tự động.
> **Duration:** `TBD` · **Traction signal:** ≥ 20 kèo public/tuần trên marketplace
> **Status:** ⬜ Not Started

Messenger base P2.5 + player action UX P4.5 · player view P4.6 · Zalo P4.7. Messenger reachability theo Page endpoint; reminder/notify one-route tenant Page→central, web+Zalo primary fallback.

**🎯 Milestone:** player join Zalo/Messenger, CK → tự xác nhận, chưa trả → tự nhắc; mọi thứ sync lên web.

### KPI P4.5–P4.7
% player tự join ≥ 60% · nhắc → thanh toán ≥ 40% · merge sai ~0.

---

## P5: BILLING

> **Mục tiêu:** thu phí thuê bao host bền vững.
> **Duration:** `TBD` · **Traction signal:** ≥ 3 host ngoài dùng ≥ 4 tuần liên tục **và** ≥ 1 host hỏi/chấp nhận trả phí
> **Status:** ⬜ Not Started

`subscription_invoices` (tách khỏi ledger player) · thu qua CK match `invoiceCode` → gia hạn · vòng đời **plan trả phí** trial→active→past_due→suspended · **`free` (0đ) vào thẳng `active` vô thời hạn — không trial/invoice, không past_due/suspended vì non-payment** (DD-29, BL-BIL-1) · suspended: chặn lệnh quản trị, **vẫn lưu CK player; kèo public hiện có chỉ sống tới khi đóng/hết giờ** · fair-use LLM/STT.

**🎯 Milestone:** (plan trả phí) hết trial bị chặn lệnh nhưng CK player vẫn lưu & kèo public vẫn hiện; CK đúng mã tự kích hoạt lại. `free` chạy bình thường không bị chặn vì non-payment.

### KPI P5
Trial → trả phí ≥ ngưỡng · MRR tăng, churn thấp.

---

## P6: HARDENING & SCALE

> **Duration:** `TBD` · **Traction signal:** có doanh thu thật **hoặc** ≥ 10 tenant — điều kiện nào đến trước
> **Status:** ⬜ Not Started

Pen-test cô lập **+ pen-test public layer** (thử rò tiền/PII/giới tính qua discovery) · load test >1k tenant + burst webhook + discovery + sync-lag (≤ vài giây p95) · observability (log `tenant_id`, metrics sync-lag, error tracking) · token-drift detection · secret KMS + scrub log · ToS/Privacy (tài chính + vị trí + hồ sơ cá nhân) · backup/restore drill.

### KPI P6
Đường rò rỉ cross-tenant = 0 · đường lộ tiền/PII/giới tính ra public = 0 · load p95 đạt mục tiêu.

---

## Dependency Map

```mermaid
graph TD
    A[P0 Foundation: Repo+Core+RLS+sports+3-tier+Google login] --> B[P2 Zalo tenant]
    A --> C[P3 Webhook CK reconcile]
    B --> B2[P2.5 Messenger + App Review]
    B --> C
    C --> D[Migrate tenant #1]
    B --> E[P3.5 Identity directory + link FB/Zalo + merge]
    E --> F[P4 Web surface + canonical backend + Sync engine + chat + settings]
    F --> G[P4 Onboarding self-serve]
    F --> H[P4.3 Publish + Discovery + Join cross-club]
    C --> Q[DD-32 Decision → Intent/Hold → Occupancy → Payment Finalizer]
    E --> Q
    H --> Q
    E --> I[P4.5-4.7 Player-side Zalo/Messenger + view]
    F --> I
    Q --> I
    H --> J[P5 Billing]
    I --> J
    J --> K[P6 Hardening + Scale]

    style A fill:#6366f1,color:#fff
    style C fill:#f59e0b,color:#fff
    style E fill:#10b981,color:#fff
    style F fill:#0ea5e9,color:#fff
    style H fill:#7c3aed,color:#fff
    style I fill:#10b981,color:#fff
    style J fill:#8b5cf6,color:#fff
    style K fill:#ef4444,color:#fff
```

**Legend:** 🟣 Foundation | 🟠 Tenant Engine | 🟢 Identity/Player | 🔵 Web+Sync | 🟪 Marketplace/Billing | 🔴 Harden

---

## Monetization Alignment

Host trả thuê bao theo **DD-29** (Phase-1 pivot, thay DD-03 4-tier): **`free` 0đ** (web + **kết nối Zalo + Messenger** + quản kèo/roster + **giá theo giới tính** + **mark-paid thủ công toàn cầu** + nhắc thủ công + in-app Chat target) và **`host_pro` 250k** (thêm entitlement `payment_reconcile_auto` + **nhắc nợ tự động** + **Trợ lý AI + KB** + CRM dashboard). Entitlement không tự mở auto-reconcile: exact market/provider/bank/currency/consent phải pass; nếu không, manual vẫn hoạt động. Tính năng free/pro theo **capability flags config-driven** (registry ở `../features/BE/feature_billing_lifecycle_tech.md §4b`).

| | Trial | Active | Suspended |
|---|---|---|---|
| Tạo/quản kèo, mark-paid thủ công, nhắc, xác nhận, player view, chat in-app | ✅ | ✅ | ❌ lệnh quản trị |
| Nhận & lưu CK player | ✅ | ✅ | ✅ (vẫn lưu) |
| **Kèo public trên marketplace** | ✅ | ✅ | 🟡 read-only: hiện có sống tới khi đóng/hết giờ; KHÔNG tạo mới/gia hạn |
| Nối APIpay/SePay · Zalo bot (BYO) · Messenger central + optional Page riêng (App Review) | ✅ | ✅ | ✅ / — |
| Đối soát CK tự động + nhắc tự động (`host_pro`) | ✅ | ✅ | ❌ |
| LLM/STT (platform trả, trần fair-use) | ✅ | ✅ | — |

> **`free` (0đ):** luôn ở cột **Active** vô thời hạn — không có cột Trial/Suspended-vì-non-payment (chỉ rơi vào Suspended nếu vi phạm ToS/abuse). Cột Trial/Suspended ở trên chỉ áp dụng cho plan trả phí.

> Dòng tương lai (ngoài MVP): player-side premium (lọc/nhắc kèo nâng cao), promote kèo trên marketplace, managed Zalo/Messenger bot, add-on ngoài tier host hiện tại.

---

## Risk Analysis

| # | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| 1 | **Rò rỉ cross-tenant** (tiền/chat) | 🔴 Critical | Thấp | Repo choke-point + RLS fail-closed + test bất biến CI |
| 2 | **Lộ tiền/PII/giới tính ra public marketplace** | 🔴 Critical | Medium | Public projection field-whitelist; tiền/PII không vào read model; test bất biến public; rate-limit |
| 3 | **Sync lệch trạng thái kênh ↔ web** | 🔴 Critical | Medium | Canonical store + event re-projection; idempotent command/event; metrics sync-lag |
| 4 | Gán nhầm nợ / chiếm định danh | 🔴 Critical | Medium | Claim-có-tiền cần khoá mạnh; merge chỉ verified (AUDIT C2/C5) |
| 5 | Webhook race / double-count | 🟠 High | Medium | Idempotent UNIQUE + lưu raw trước ack |
| 6 | **Marketplace cold-start** (ít kèo/player) | 🟠 High | Medium | Beachhead community host hiện có; seed tenant #1; khuyến khích publish; 1 môn trước |
| 7 | Lạm dụng marketplace/chat (spam join/scrape/spam chat) | 🟡 Medium | Medium | Rate-limit + approval mode + area-level geo + abuse controls |
| 8 | Token Zalo/Page lộ | 🟠 High | Thấp | KMS + scrub log + getWebhookInfo-drift + rotation (AUDIT §B2) |
| 9 | **Messenger App Review trượt/chậm → kẹt kênh phase-1** | 🟠 High | Medium | Nộp App Review sớm; degrade sang web + Zalo; Messenger không phải kênh nhắc-nợ chính |
| 10 | Zalo GROUP Beta / Messenger policy đổi (24h/outside-window eligibility) | 🟡 Medium | Medium | Bám DM Zalo + web; Messenger join+xác nhận trong 24h; hỏi cap/giá trước scale |
| 11 | Solo dev ship chậm | 🟡 Medium | Medium | 7 phase nhỏ, mỗi phase ship được; AI co-pilot |
| 12 | Host không trả phí | 🟡 Medium | Medium | Soft-launch free validate (sau P4.3); giá thấp; trích quỹ nhóm |

---

## Critical Path

```text
Foundation(RLS+sports+3-tier+Google) → Zalo-tenant → CK-reconcile → migrate #1 → Identity
   → Web+Sync(+chat+settings) → Onboarding+Marketplace(discover/join) → Player-side → Billing → Harden
   ⬜            ⬜             ⬜            ⬜           ⬜
   → ⬜          ⬜                          ⬜            ⬜         ⬜
```

**Bottleneck hiện tại (`main@784bc8d`):** shared DB/job plumbing đã tiến tới claim/ack + dispatcher + queue/preflight + scheduler, nhưng product vẫn có **0 business route, 0 connected FE screen, 0 domain producer và 0 real projector**. Schedule mặc định OFF; `0024` chỉ là invariant. Safari measurement không còn là blocker; Google vẫn OFF tới owner go-live/env decision. Chat initiative mới chỉ `PLAN_READY`; chưa slice nào được strict `CODE_READY`. Chuỗi kế tiếp:

1. ⛔ **Enablement-only:** owner quyết định bật Google, set `GOOGLE_OAUTH_*`/CTA và verify production gates; measurement M3 đã đóng, không cần đo lại.
2. ⬜ Email/password bundle order-4 (flag OFF) → gỡ Telegram provider.
3. ⬜ Mở feature layer bằng bounded Session BE producer/service/route/projector slice; dùng shared job infra đã có nhưng không bật scheduler trước khi có real producer/projector + runbook. Đây là enablement lane riêng: không chặn authoring read-only Chat slice 19 trên baseline, nhưng `/sessions|/waitlist` beta phải đợi đủ `svc-session-crud` + `svc-session-join-leave` + `svc-waitlist-promotion-core` và production-shaped data E2E.
4. ⬜ Mark-paid thủ công → auto-reconcile có regional capability gates → sync surfaces.

---

## 💰 Critical Path to Revenue

> Tách khỏi critical path kỹ thuật ở trên. Câu hỏi khác nhau: critical path hỏi *"thứ tự nào không vỡ dependency"*; mục này hỏi **"chuỗi ngắn nhất tới đồng đầu tiên"** — và cái gì đang nằm trên chuỗi đó mà không cần thiết.

```text
[✅] Foundation + RLS
        │
[🟢⛔] Google code + Safari measurement DONE ──▶ ⛔ owner enable/env decision ──▶ [⬜] login bật được
        │
[⬜] Session CRUD (host tạo kèo)
        │
[⬜] 4b.1 Mark-paid thủ công  ◀── free tier đã đủ vận hành từ đây
        │
[⬜] Dogfood tenant #1 trên kênh thật ──▶ traction signal P5
        │
[⬜] 18 Billing + lifecycle (`subscription_invoices`, CK match `invoiceCode`)
        │
        ▼
    💰 ĐỒNG DOANH THU ĐẦU TIÊN
```

**Không nằm trên chuỗi (có thể trượt mà không mất doanh thu):**

| Hạng mục | Vì sao không chặn revenue |
|---|---|
| **17 Messenger / App Review** | Zalo + web đã đủ vận hành; Messenger là kênh mở rộng. Degrade path đã pin ở DD-37 |
| **11–13 Marketplace discovery** | Là động cơ tăng trưởng phía cầu, không phải điều kiện để host trả tiền |
| **10b In-app Chat primary target · 10c gender pricing** | Tăng độ dính; DD-91 đã chốt direction nhưng plan chưa ready, không phải lý do mua |
| **7 Identity merge** | Cần cho đúng-nợ-xuyên-kênh; 1 kênh thì chưa bức thiết |
| **DD-73..78 share/activity/feed** | Đã tự gate bằng evidence, đúng chỗ |

**Nằm trên chuỗi nhưng có thể làm mỏng hơn:**

- **5.x auto-reconcile** là *giá trị* của `host_pro`, nhưng host vẫn trả tiền được khi có mark-paid + nhắc thủ công. Ship 4b.1 trước; chỉ mở 5.x khi entitlement `payment_reconcile_auto` + exact market/provider/bank/currency/consent pass. SePay/ApiPay hiện là Vietnam launch path chưa enable.
- **9 Sync engine** cần cho đa-surface. Nếu phase-1 chấp nhận **web-first, kênh chat read-mostly**, sync có thể mỏng đi đáng kể ở vòng đầu.

> ⚠️ **Quan sát thẳng:** đường tới doanh thu hiện đi qua **P5**, tức gần cuối roadmap. Đây là rủi ro cấu trúc, không phải rủi ro thực thi — validate willingness-to-pay bị đẩy về sau cùng. Cân nhắc một **soft-launch thu phí sớm** (thủ công, không cần module 18: chuyển khoản + bật cờ tay) ngay khi có 3 host ngoài, để đo giá trước khi build lifecycle tự động.

---

## 📣 GTM theo phase

| Phase | Kênh acquisition | Đối tượng | Chỉ dấu thành công |
|---|---|---|---|
| **P0–P1** | Không acquire — dogfood nội bộ | CLB của founder | Host (founder) đăng nhập + tạo kèo được |
| **P2–P3** | Tenant #1 migrate; giới thiệu 1-1 trong nhóm Zalo sẵn có | 1–2 CLB cầu lông quen | 2 tenant vận hành thật, 0 sự cố cross-tenant |
| **P3.5–P4** | Word-of-mouth từ host #1 sang host cùng sân/cùng giờ | Host cầu lông cùng khu vực | ≥ 5 host onboard self-serve không cần hỗ trợ tay |
| **P4.3** | Seed marketplace bằng chính kèo của tenant hiện có; group Facebook/Zalo cầu lông theo khu vực | Player discovery (persona P4 "Lan") | ≥ 20 kèo public/tuần; player lạ join được |
| **P4.5–P4.7** | Player kéo player trong chính kèo (nhắc/xác nhận tạo thói quen) | Player member | ≥ 60% player tự join |
| **P5** | Chuyển host free đang active nhất sang `host_pro`; giá thấp, trích quỹ nhóm | Host đã dùng ≥ 4 tuần | ≥ 1 host trả phí thật |
| **P6** | Mở rộng môn (pickleball/tennis) khi cầu lông đã bão hoà 1 khu vực | Host đa môn | Không rò rỉ khi scale |

> **Beachhead giữ nguyên:** cầu lông, 1 khu vực, host có sẵn cộng đồng. Mở môn/mở vùng chỉ sau khi vòng lặp host→player→host chạy được ở khu vực đầu tiên (risk #6 marketplace cold-start).

---

## Next Actions (Priority Order)

1. ✅ ~~BRD / PRD / TDD core review~~ — đã sync v3.4 channel pivot (bỏ Telegram; Zalo + Messenger + Google login); **DD-38/39 ✅ committed**
2. 🔴 Đóng các gate còn lại: ~~lifecycle grace/trial timing~~ ✅ **DD-51**; **DD-04 đã chốt**, còn egress-IP/provider verification + infra build/restore/failover/load drill; **legal A3** (PII retention — luật sư VN, chặn go-live); Zalo external spikes **DD-14/15**; **DD-33 đã chốt nhưng exact Meta evidence cho messaging và Facebook Login/account-link vẫn pending** (không coi một approval tự bao nhóm kia); Club Assistant go-live **DD-18** và chi tiết P7 **DD-34/35/36**. Schema/code/infra vẫn land theo build slice. Checklist: `../probes/pre-code-open-items-2026-07-16.md`.
3. 🟡 Review/sign-off feature specs của phase sắp build; chuyển acceptance criteria thành issue checklist — **Session Management đã xong** (`docs/issues/session-management-acceptance-checklist.md` COMPLETE, re-traced tới hợp đồng publish ngày 24/07). Các feature còn lại chưa có checklist.
4. ✅ ~~Setup monorepo (pnpm: core/bot/web) + Postgres docker~~ — đã merge (S1)
5. ✅ ~~Lift `core` + `sports` + test xanh~~ — đã merge (S2)
6. 🟡 Schema tenant đa môn + ledger + RLS/worker contract + public_sessions skeleton + repo choke-point + **test bất biến** — foundation đã merge; tail hiện là `0024`. Auth Google `0015`–`0018` + Safari measurement đã xong nhưng chưa enable; email/password order-4 vẫn pending.
   - **Việc kỹ thuật hiện hành (28/07):** (a) evidence = 32 files / 537 workspace +13 validator, static 528+9; (b) `0022`/`0023` claim/ack + dispatcher + queue/preflight + scheduler đã merge, nhưng schedule OFF/no producer/projector; (c) `0024` capacity invariant đã merge; (d) feature consumer kế tiếp phải là bounded product slice, không được claim job infra là Sync/Session runtime; (e) wire consumer ambiguity DD-87 vẫn separate. DD-81 đã chốt target Energetic Orange/Sora/Inter nhưng **FE HOLD** tới khi canonical `design.pen` được tracked + owner-approved và visual/WCAG gate PASS.
7. 🔴 Zalo tenant middleware + mark-paid thủ công + lệnh host + Messenger (P2.5, App Review) + webhook reconcile + migrate tenant #1
8. 🟡 Identity → Web/Sync/Onboarding (+ chat + settings) → Marketplace/Join → Player channels → Billing → Harden
   - **DD-32 implementation order:** account-backed link resolver → shared decision core → intent/hold migration + occupancy helper → verified-payment finalizer/expiry/manual-review → thin Messenger/Zalo ports. Không bắt đầu từ adapter và không claim BE companion là code authorization.
   - **Mới (DD-73..78 ✅ chốt 19/07 tại decisions v1.60, sequencing corrected v1.64):** trong khối *Marketplace/Join* bổ sung **(8a) immediate-deny path cho public read model** — `public_projection_fences` + guarded view + narrow raise/CAS-clear + `public_projection_version` + grant migration đưa consumer khỏi base table. **Đây là nợ của DD-12, không phải chi phí của share**: hiện kèo chuyển private/cancel phải chờ projector async mới hết lộ. Sau (8a) mới tới **(8b) DD-73** = route `/s/<id>` + OG card + funnel telemetry; (8b) còn chặn thêm bởi **DD-41 projection migration** (whitelist BL-DSC-1 chưa có trong `public_sessions`).
   - **Sequencing không vòng lặp:** DD-74/75 chưa vào hàng đợi ngay; sau dependency kỹ thuật + reprioritization bằng telemetry DD-73, chúng tạo activity baseline. **Chỉ DD-76/77** (feed/kudos) bị hard-gate bởi baseline/liquidity + ngưỡng owner. DD-78 không có queue riêng: ảnh session đi cùng (8b), ảnh activity đi cùng DD-75.
   - **DD-86/DD-91–95 boundary:** N club channels + DM. DD-86 owns exact `chat.channel.manage` + `chat.channel.post_restricted`; DD-95 alone owns `chat.message.moderate` + `chat.member.mute`. Assistant defaults ON `all_members`/OFF `admins_only`, mutable cả hai dưới tenant config/`assistant_ai_kb`/provider/privacy; Announcements là `admins_only` default OFF, không permanently prohibited. DD-92 = reply/immutable structured mentions/reaction `👍|❤️|😂|😮|😢|🙏`, own edit `<15m` max 5, author soft-delete và pre-beta search. DD-93 registry ASCII case-insensitive: mọi club/Club Bot/human-DM overlay có `/help|/pay|/me|/myclubs|/discover|/name`, club + Club Bot thêm `/sessions|/waitlist`. DD-94 = unread-derived generic opaque offline signal/digest, không durable content snapshot/item; DM/mention/reply ON, club pref default `mentions`. DD-95 = club hide/restore + mute `1h|24h|7d`, exact reasons `spam|harassment|unsafe|off_topic|other`; không hard-delete/permanent ban/DM moderation-read. Assistant/Chat/Notifications pairs đã Reviewed; current readiness chỉ lấy từ primary plan §13. DD-88 là broader `DEFERRED_PROPOSAL`.

---

## North Star Metric

> **Số kèo "hoàn tất vòng" mỗi tuần** = kèo được tạo → có player join (gồm **join qua discovery**) → đối soát/xác nhận. Đo cả 2 phía: host vận hành thật + player (kể cả mới) join thật, đa môn, đa kênh (Zalo/Messenger/web).

**Metric hiện tại = 0** — chưa có surface nào chạy. Metric phụ để theo dõi tới khi North Star khởi động được:

| Giai đoạn | Metric tạm | Ngưỡng |
|---|---|---|
| P0–P1 | Đăng nhập Google thành công trên thiết bị thật | ≥ 1 (Safari + iOS) |
| P2–P3 | Kèo tạo trên Zalo đúng tenant / tuần | ≥ 2 |
| P4 | Kèo tạo trên web hiện đúng ở kênh ≤ vài giây | p95 ≤ 3s |

---

## Phụ lục A — Bảng tra DD (chỉ các DD được ROADMAP tham chiếu)

> Đây là **bản tra nhanh**, không phải authority. Nguồn sự thật hiện hành là `../standards/decisions.md` **v2.11 current mirror**; status đọc theo từng DD và decision không đồng nghĩa runtime. Khi hai bên lệch ⇒ decisions.md thắng, và bảng này phải được sửa.

| ID | Một dòng | Trạng thái |
|---|---|---|
| DD-03 | Pricing 4-tier theo kênh | 🔄 thay bằng DD-29 |
| DD-04 | Hosting PostgreSQL → DigitalOcean co-locate | ✅ (còn gate egress-IP) |
| DD-06 | Độ chi tiết vị trí public = area-only | ✅ |
| DD-10 | Web stack = Next.js | ✅ |
| DD-12 | Public read model `public_sessions` + projector | ✅ |
| DD-13 | Auth phase-1 = Google + email/password | ✅ |
| DD-14 | Zalo Login có bị chặn bởi cửa đăng ký OA? | ⬜ **mở — SPIKE** |
| DD-18 | Provider embedding/LLM + privacy/ToS | ⬜ mở — **chặn go-live Assistant** |
| DD-29 | Pricing pivot: `free` 0đ + `host_pro` 250k | ✅ |
| DD-30 | APIpay enterprise auto-provision per-host | ✅ |
| DD-32 | Browse freely; link-or-pay at final confirm (Option D) | ✅ decision/docs; no runtime |
| DD-33 | Facebook Login / Messenger account-link | ✅ (Meta evidence còn pending) |
| DD-34 | Plexco Global KB plane | 🟡 approve-in-principle P7 |
| DD-37 | Channel pivot: bỏ Telegram; Messenger + Zalo + web | ✅ |
| DD-38 | Chat in-app phase-1 (club-wide + 1-1, chỉ Plexco) | ✅ |
| DD-39 | Giá theo giới tính | ✅ |
| DD-40 | Mark-paid thủ công mặc định mọi tier | ✅ |
| DD-41 | Field mô tả + gating cho `sessions` | ✅ |
| DD-45 | Model hoá waitlist | ✅ |
| DD-47 | Social follow graph | ✅ framework, build P4+ |
| DD-49 | Money correction lifecycle | ✅ |
| DD-50 | Không thu SĐT phase-1; khoá mạnh = verified email + `link_code` | ✅ |
| DD-51 | Host Pro lifecycle trial/grace/refund | ✅ |
| DD-53 | Identity recovery + merge-split authority | ✅ |
| DD-57 | FE architecture principles (adopt từ Sporta) | 🟡 đề xuất |
| DD-60 | API reference convention | ✅ |
| DD-61..64 | Session Organize (court/match/assign/live score) | ✅ accept-in-principle · build post-P4 |
| DD-65..68 | Messenger hybrid: topology · shared surface · page-scoped identity · durable interaction | ✅ |
| DD-69 | App-native: phase-1 PWA → phase-2 native | ✅ định hướng · build TBD |
| DD-73 | Share link + preview card | ✅ · tách 2 slice |
| DD-74/75 | Activity read model + publish lifecycle | ✅ · tạo baseline |
| DD-76/77 | Feed + kudos | ✅ contract · **build gated bởi evidence** |
| DD-78 | Ảnh share do Plexco render (template-only) | ✅ |
| DD-79 | Home personal dashboard (S9, composition-only) | ✅ |
| DD-80 | Auth credential lifecycle (B0) + slice order D0a→D1→email→gỡ Telegram | ✅ · **D0a..d1b đã merge** |
| DD-81 | Pencil + target Energetic Orange/Sora/Inter; active tokens chưa đổi | ✅ direction · FE HOLD |
| DD-86 | In-app N club channels; exact lifecycle/post keys `chat.channel.manage` + `chat.channel.post_restricted`; Assistant default ON `all_members`/OFF `admins_only`, mutable both under gates; Announcements admins-only default OFF. DD-95 owns moderation/mute keys | ✅ `DECISION_FINAL`; no runtime |
| DD-88 | Broader notification grouping/message-request initiative | ⏸️ `DEFERRED_PROPOSAL`; does not own/block DD-94 exact Chat digest |
| DD-91 | In-app Chat primary surface + requester-only `/pay` | ✅ `DECISION_FINAL`; no runtime |
| DD-92 | Reply/immutable mentions; emoji reactions; own edit/soft-delete; pre-beta search | ✅ `DECISION_FINAL`; no runtime |
| DD-93 | ASCII case-insensitive, zero-arg, surface-aware slash registry | ✅ `DECISION_FINAL`; no runtime |
| DD-94 | Chat-unread-derived generic opaque offline signal/digest + preferences/live authz | ✅ `DECISION_FINAL`; timing/config enablement-only; no runtime |
| DD-95 | Club-only hide/restore + exact timed mute/reason/audit contract | ✅ `DECISION_FINAL`; no runtime |
| DD-96 | Home money chips: cross-club `SelfPaymentSummary` (Part A) + host receivable "Chưa thu" (Part B) | ✅ A contract-shape final · B direction ✅ / mechanism 🟡 (4 blocker B1–B4) |
| DD-97 | Collection statement + export sao kê — per-session view **free** · kỳ/tháng + export PDF/XLSX **`host_pro`** | ✅ direction + entitlement (owner-delegated 07/08) · mechanism chờ DTO owner Reviewed |
| DD-98 | Negative scope Sporta-port NP-1..5 (custom split · hold linked member · push kèm tiền · auto-archive nợ · geo/radius vs DD-06) | ✅ `DECISION_FINAL` (owner-delegated 07/08) |
| DD-99 | FE spec hardening: 4 section (Analytics/State Machine/AC/Testing) = điều kiện FE Draft→Reviewed · backlog P2→P4→P3 · breakpoint rule 2 lớp (OQ-1) | ✅ P1 + OQ-1 chốt · priorities pinned (owner-delegated 07/08); không authorize build |

---

## Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 07/08/2026 | **v3.4n** | **Mirror decision batch 07/08 (decisions v2.18):** Phụ lục A thêm DD-96..99. DD-97 statement/export: direction + entitlement chốt (per-session view free · kỳ/export `host_pro`), mechanism chờ DTO owner. DD-98 negative scope NP-1..5 final. DD-99: 4 section FE = điều kiện Draft→Reviewed; backlog FE prioritized P2 (player session-detail/join/waitlist — critical path S9–S12) → P4 (mark-paid `cash\|waiver`; refund-on-cancel tách chờ refund policy) → P3 (account-management); breakpoint rule 2 lớp. Delivery order/code readiness không đổi; không authorize build mới. |
| 28/07/2026 | **v3.4l** | **Chat readiness re-pin + current HEAD:** exact 27-file authority pack land tại `90d292d`; plan v1.8/analysis đạt `PLAN_READY` closure 12/12. Re-pin live summary tới `main@784bc8d`; code/test inventory không đổi vì hai commit mới chỉ docs. Giữ B4/per-slice `CODE_READY`, no runtime/migration/API/UI, DD-32 WIP overlay và ~33% delivery boundary. |
| 28/07/2026 | **v3.4k** | **Owner-final Chat authority + DD-32 reconcile:** mirror DD-86/DD-91–95 and demote DD-88 to broader `DEFERRED_PROPOSAL`; Assistant/Chat/Notifications pairs Reviewed. Current readiness remains owned only by primary plan §13. Preserve committed `main@2dc9b8c` 24/23 snapshot while recording uncommitted 24/24 docs overlay and DD-32 Option D target. Runtime/delivery percentage unchanged. |
| 28/07/2026 | **v3.4j** | **SUPERSEDED by v3.4k:** former Chat correction used universal default-OFF, three commands and no-digest floor; no longer current authority. |
| 28/07/2026 | **v3.4i** | **SUPERSEDED by v3.4k for Chat:** former v2.08 Chat propagation retained as history; unrelated FE sequencing notes remain historical. |
| 27/07/2026 | **v3.4h** | **Current-truth + DD-91/regional reconcile tại `main@2dc9b8c`.** Pin 25 migrations (`0024` public-capacity invariant), 32 test files / 537 workspace PASS +13 validator, static 528+9. Ghi nhận `0022`/`0023` + dispatcher/queue/preflight/scheduler đã merge nhưng default OFF/no producer/projector. Safari M3 measurement closed nhưng Google chưa enable. In-app Chat primary target + requester-only `/pay` là DD-91 decision final, plan vẫn `NOT_PLAN_READY`; manual mark-paid global, auto-reconcile có entitlement + regional capability gates. |
| 27/07/2026 | **v3.4g** | **Job runtime + schedule evidence:** dispatcher/queue provisioning/preflight/worker lifecycle merged; scheduler recovery 1 phút merged sau đó nhưng default OFF. Canonical product suite tiến tới 537 workspace; không producer/projector nghiệp vụ, không tăng product runtime. |
| 26/07/2026 | **v3.4f** | **Job DB core:** `0022` lease/reclaim/audit + narrow worker authority merged, tiếp theo `0023` claim-token/ack completion. Shared infrastructure only; no product runtime. |
| 25/07/2026 | **v3.4e** | **Canonical evidence + notification/status/design-authority reconcile.** Runner re-aggregate PASS **29 files / 460 workspace tests** (core 132 · DB 179 · web 146 · bot 3) + 13 validator tests; gỡ nhãn STALE khỏi current test rows. DD-70/71/72 owner-final được propagate, Notification pair Reviewed/no-runtime. DD-81 canonical path = root `design.pen`, vẫn HOLD trước persist/track + owner nghiệm thu. Pin next coding initiative BE-only `db-job-claim-lease-core`; không đổi phase/delivery order/% runtime. |
| 25/07/2026 | **v3.4d** | **Current-state reconcile tại `main@2937ed9` — không đổi scope/phase/DD/delivery order/%.** (1) Repo-truth snapshot re-pin `f93873b`→**`2937ed9`** (= `origin/main`). (2) **Migration tail `0020`→`0021`**, §Dev Progress migrations row re-verify **19→22** (`0000`–`0021`): `0021` (`15e10b7`, 24/07) đóng nốt bộ ba tenant-integrity composite FK DD-68 ở nhánh **non-money**; thêm hàng ma trận riêng **"Tenant-integrity FK (ngoài P-number)"** để không double-classify vào Foundation/Auth. (3) **Ghi nhận core đã đổi:** `d2a27e1` (23/07) — `splitNameAmount` exhaustive fail-closed ambiguity union (DD-87), runtime change chứ không phải doc; module 1 và bảng Payment Reconciliation cập nhật theo. (4) **Tách trục Tests thành hai dòng, đánh dấu STALE đúng chỗ:** canonical runner **419 vẫn là snapshot 22/07 và KHÔNG mô tả `2937ed9`** (core + db đều đã đổi); thêm dòng **static cross-check 451** (core 132 · db 179 · web 137 · bot 3) với phân tích drift +41 = core +21 + db +20 — khớp nguyên nhân đã biết; thêm dòng **bằng chứng per-slice real-PG db 167→173→179**. Theo luật 4, **không** suy runner = 451+9. (5) Ghi nhận **8 docs/spec slice** publish · billing · draft-lifecycle đã merge ⇒ contract S5/module 11 dày lên, nhưng cột code giữ ⬜ và thanh **~33% không đổi** (integrity expand-only + spec ≠ slice roadmap mới). (6) Next Actions #3 hạ 🔴→🟡 (checklist Session Management COMPLETE) và #6 thêm 4 việc kỹ thuật mới nổi: re-aggregate runner · verdict thiếu cho `0021` · author job-infra chung up front · wire consumer ambiguity DD-87. |
| 24/07/2026 | **v3.4c** | **Migration-tail reconcile (docs-migration-tail-0018-to-0020-sweep): `0018`→`0020`.** `0019`/`0020` (`b0c29a6`/`f6ccd79`, 23/07/2026) thêm tenant-integrity composite FKs (DD-68), tầng riêng ngoài nền `0000–0014` và auth lane `0015`–`0018` (anti-double-classify giữ nguyên). §Dev Progress migrations row giữ nguyên pin **19** (`0000`–`0018`, snapshot `main@f93873b` 22/07) + thêm ghi chú trỏ tail hiện hành `0020`; Status P0–P1 + Bottleneck note thêm tail delta. Các số đếm khác (test/route/spec) giữ nguyên snapshot 22/07, CHƯA re-verify. Không đổi scope, DD, hay delivery order. |
| 22/07/2026 | **v3.4b** | **Đóng nốt 3 tồn đọng đo lường — không đổi scope, không đổi số test.** (1) **Static grep phục hồi thành cross-check dùng được:** luật 4 pin công thức `static + Σ(test sinh trong loop) = runner`, kèm **kiểm kê generator** (đúng 1 chỗ tại `f93873b`: `apps/web/lib/google-oidc.test.ts:133`, `rows.length = 10` ⇒ `+9`; đối chiếu `410 + 9 = 419` ✅) và lệnh kiểm kê generator trong block tái tạo ⇒ phát hiện drift được **không cần Postgres**. Ghi chú divergence chuyển từ "không suy diễn nguyên nhân" sang **nguyên nhân đã xác định**; runner vẫn là authority duy nhất. (2) **Trục Invariant nới theo class, không theo tên file:** thêm concurrency/race-safety vào định nghĩa + **danh sách invariant-class tường minh** (3 file: `rls-invariants` · `waitlist-invariants` · `migrate` — race-safety role bootstrap `0000`); bảng số đếm `2 file` → **3 file**; ghi tồn đọng rename `migrate.test.ts` là **code slice riêng, chưa làm ở đây**. (3) Footer dùng **full 40-char SHA** cho khớp header. |
| 22/07/2026 | **v3.4a** | Re-pin repo truth tại `main@f93873b`; canonical `pnpm test` PASS: **29 files / 419 tests** (111 core · 159 db · 146 web · 3 bot). Static grep = 410 chỉ còn source cross-check; tất cả bảng Tests dùng canonical runner. Không đổi scope, DD, delivery order hay trạng thái enablement. |
| 22/07/2026 | **v3.4** | **Khung đo lường + reconcile bằng chứng — KHÔNG đổi scope.** (1) Thêm §**Cách đọc tiến độ**: 6 trục Spec/Migration/BE/FE/Tests/Invariant + định nghĩa Done từng trục + **5 luật chống lạm phát** (docs≠runtime · merged≠enabled · `.pen`≠FE · đếm phải tái tạo được · trục yếu nhất là trạng thái thật) + lệnh tái tạo số đếm. (2) Thay thanh % đơn bằng **ma trận theo delivery group** + bảng **số đếm kiểm chứng được** tại `main@142e9fa` (19 migration · 28 test file · **403 test case (static)** · 10 route · 24+23 feature spec · **0 màn FE**). (3) Thêm cột **Duration (`TBD`, owner điền)** + **Traction signal** cho mọi delivery group và phase header; signal không phải technical/code-readiness gate. (4) Thêm §**Critical Path to Revenue** + bảng "không chặn revenue" + cảnh báo revenue nằm ở P5. (5) Thêm §**GTM theo phase**. (6) Module Progress tách cột Spec/Migration/BE/FE/Tests + cột **Rev?**; các R-section P0–P3 chuyển sang **item có ID + Prio + Status**. (7) Thêm **Phụ lục A — bảng tra DD**. (8) Thêm **module 3c** = email/password bundle order-4 + gỡ Telegram — **decomposition của DD-80 §10 slice order đã chốt**, không phải scope mới. (9) **Reconcile số liệu sai:** migrations `0000–0013`→**`0000–0018`**; "Google/email chưa code"→**lane Google đã merge, ⛔ chưa bật** (chờ đo Safari/iOS); authority `decisions v1.74`→**v1.98**, BRD v3.9f→v3.9g, PRD v2.8e→v2.8f, TDD v3.1→v3.1a; `~20%`→`~33%`. **Không phase nào thêm/bớt; không DD nào đổi trạng thái; delivery order + dependency map giữ nguyên.** (10) **Test-count verify pass:** luật 4 tách **static cross-check** (không cần DB) vs **canonical runner** (authority), khôi phục lệnh grep bên cạnh `pnpm test`; số dùng trong file = static **403** (web **137**) vì đó là số duy nhất tái tạo được tại `142e9fa`. Ghi **OPEN drift** với `BUILD-STATUS.md` (khai web 146, chênh 9 = đúng số test của route `/complete` d1b) kèm binary resolution + owner + next-review-trigger; đã loại trừ giả thuyết `test.each` (0 hit toàn repo) và `it.skip/only/concurrent`. |
| 19/07/2026 | v3.3f | **Mirror DD-79 ✅ Home hub vào S9** (landing + nav registry, composition-only, spec Reviewed) + **DD-81 ✅ Pencil** (`plexco-app-design.pen`, theme exploration trên màn Home). Không đổi slice order/dependency/runtime. |
| 19/07/2026 | v3.3e | Authority pointer refresh v1.67→v1.74 (+BRD v3.9f/PRD v2.8e): v1.68–v1.74 BE-contract closure no-runtime; không đổi delivery order/canonical phase. Đồng bộ footer. |
| 19/07/2026 | v3.3d | **Correct DD-73..78 sequencing theo decisions v1.64; current authority v1.65:** DD-74/75 tạo baseline nên không thể nằm sau gate dùng chính baseline đó; chỉ DD-76/77 hard-gated. DD-78 đi cùng consumer. Đồng bộ authority/footer version; không đổi canonical phase hay runtime readiness. |
| 19/07/2026 | v3.3c | **DD-73..78 ✅ chốt (decisions v1.60):** Next Actions §8 thêm **(8a)** immediate-deny path cho public read model — `public_projection_fences` + guarded view + narrow functions + `public_projection_version` + grant migration, **thuộc DD-12** (nợ sẵn có của read model, không phải chi phí share) — rồi **(8b)** DD-73 route/OG/telemetry, còn chặn bởi DD-41 projection migration. Sequencing wording của entry này được corrected ở v3.3d. Không đổi canonical phase. |
| 18/07/2026 | v3.3b | **Founder batch (decisions v1.47):** DD-69 định hướng accepted (App Native delivery group "proposal"→"direction ✅ · build TBD"; positioning/note cập nhật); **thêm Session Organize delivery group (post-P4, DD-61..64 accept-in-principle)**; DD-33/60 ✅. Delivery order/code readiness không đổi; native + Session Organize build chưa committed. |
| 18/07/2026 | v3.3a | **DD-69 proposal + review closure:** Positioning + Delivery Groups thêm phase-2 native; phase-1 PWA là target chưa live; RN+Expo chỉ recommendation sau spike. Pin pre-schedule gates: client-safe contracts, `/api/v1`, bearer + iOS login compliance, dedicated device push + privacy-safe payload, offline read-only và store review. Delivery order/code readiness không đổi; native chưa committed. |
| 17/07/2026 | v3.3 | Authority → BRD v3.9b/PRD v2.8/TDD v3.1/decisions v1.45; mirror feature-doc closure nhưng không đổi delivery order, code readiness hoặc proposal status DD-61..64. |
| 17/07/2026 | v3.2 | **DD-65..68:** R1.5 hybrid central+optional tenant Page, host/player shared core, migration/actions/reachability, one-route delivery và milestone 2 tenant có/không Page; runtime pending. |
| 17/07/2026 | v3.1 | Authority → BRD v3.9 / PRD v2.7 / TDD v2.9 / decisions v1.44. Session Organize v0.3/DD-61..64 vẫn proposal, không chèn canonical timeline và không đổi implementation readiness. |
| 17/07/2026 | v3.0 | Authority → TDD v2.7 / decisions v1.42. Doc coverage → **22 Product/System + 21 BE = 21 cặp + 1 product-only**. Session Organize v0.2/DD-61..64 vẫn proposal: không chèn canonical timeline/module, delivery đề xuất sau Session CRUD + Sync, earliest after P4, phase TBD. |
| 15/07/2026 | v2.7 | **Decision reconcile + review fixes:** căn cứ trỏ decisions.md v1.32; thêm cụm session-model DD-06/08/41–46; sửa delivery phase Messenger base **M17/P2.5** + player P4.5, Zalo P4.7; M4 là shared chat-channel middleware Zalo→Messenger; Next Actions chỉ giữ DD thật sự open/gated. Schema/migration land cùng build slice. |
| 16/07/2026 | v2.8 | Đóng DD-04 ở roadmap: DO co-location đã chốt; Next Actions chỉ còn egress-IP verification, infra build và drill. Cập nhật authority lên decisions v1.34. |
| 16/07/2026 | v2.9 | **Founder batch DD-49..56 (decisions v1.36):** căn cứ → BRD v3.7 / PRD v2.5 / TDD v2.6; Next Actions gỡ "lifecycle grace/trial timing" (✅ DD-51), thêm legal A3 + note DD-33 hai nhóm permission; không còn founder decision chặn S4→S8. |
| 13/07/2026 | v2.5 | Reconcile live repo: DD-10 Next.js + DD-12 `public_sessions` projector đã chốt; P0–P1 = partially complete; feature coverage = 21 Product/20 BE (20 cặp + funnel product-only); auth provider swap chưa launcher-ready. |
| 10/07/2026 | v2.4 (review fixes) | **Build-status → reality:** Dev Progress + Module Progress + Next Actions + bottleneck — foundation (S1–S3, migrations `0000–0013`) + Auth v3 (Telegram-era) đã land trên `main@1eb6f60`; DD-37 supersede provider → Google/email chưa implement (bỏ "code chưa bắt đầu"/0%). **DD-38/39 ✅ scope-committed phase-1** (feature tracks/module/R4 — schema chờ migration). |
| 10/07/2026 | v2.4 | **v3.4 channel pivot: drop Telegram, Messenger + Zalo phase-1 + Google login/chat/gender-pricing/manual mark-paid — DD-37/13/33/38/39/40.** Delivery groups + timeline + module progress + phase sections + dependency map + critical path đổi Telegram→Zalo; Messenger nâng P4.8→**P2.5 (phase-1, App Review)**; thêm Google login (P0–P1), chat in-app + cài đặt hồ sơ/giá theo giới tính (P4, DD-38/DD-39 🟡), mark-paid thủ công (P2, DD-40); nhắc web+Zalo chính / Messenger best-effort 24h; Monetization Alignment + Risk cập nhật. |
| 20/06/2026 | v2.2 | P5 + Monetization Alignment: làm rõ `free_web` (0đ) vào thẳng active vô thời hạn, không trial/past_due/suspended vì non-payment (DD-03, BL-BIL-1). |
| 05/07/2026 | v2.3 | **DD-29 pricing pivot** (thay DD-03): `free` (web + 3 bot + đối soát thủ công) / `host_pro` 250k (auto reconcile/nhắc + AI + CRM), capability flags config-driven; **DD-30** APIpay enterprise auto-provision (money-custody không đổi). |
| 18/06/2026 | v2.1 | Dùng duy nhất canonical phase; thêm durable webhook + payment ledger/allocation; canonical store = PostgreSQL/domain model; Messenger tách post-MVP. |
| 18/06/2026 | v2.0 | **Reposition** → platform thể thao đa môn 2 phía. Re-sequence 7 phase (thêm **Phase 3 Web+Sync+Marketplace** = P4+P4.3, tách Identity thành Phase 2, Player-side thành Phase 4). Thêm track 🌐 Web+Sync & 🔎 Marketplace; module 8–13 mới; KPI/risk/North Star theo marketplace + sync + public layer. |
| 18/06/2026 | v1.1 | Đổi tên → **Plexco**; bảng Phase Mapping; link Messenger doc. |
| 16/06/2026 | v1.0 | Bản đầu — 6 phases, 6 feature tracks, dependency map, risk từ AUDIT. |

---

*ROADMAP v3.4l — canonical phase duy nhất; Chat authority is immutable at `90d292d` and the initiative is `PLAN_READY`, not `CODE_READY` or implemented. Live truth is pinned at `main@784bc8dd297163a5ec5415f33beabbbf34bbc8d7`; DD-32 companion overlay remains working-tree-only, shared job infra remains OFF/placeholder, and product implementation is pending.*
