# Autopilot backlog — task registry for parallel planning · Plexco

Feature/task cần làm, ghi machine-scannable để bot quét ra **task nào chạy song song được**. Khác
`.autopilot/INFLIGHT.md` (runtime, task đang chạy ngay lúc này).

## Cách bot quét
Đọc block `## task:` có `status: planned|ready` (bỏ `idea` chưa scope, bỏ `in-flight|merged`, **bỏ `blocked`**).
Hai task song song được ⟺ **cả ba**: `scope` (file) rời nhau · `invariants` (domain, từ
`docs/autopilot-invariant-catalog.md`) rời nhau · không cái nào `depends_on` cái kia mà cái kia chưa merge.
Đây đúng luật `scripts/autopilot-scope-gate`. ⚠️ `scope`/`invariants` của task `idea` là **ước lượng** —
refine (grep code thật) trước khi promote thành manifest.

## Lifecycle
`idea` → `planned` (scope rõ + chọn invariants) → tạo manifest → `ready` → `register` → `in-flight` → merge → `merged`.

**`blocked`** (thêm 2026-07-22) — artifact đã đủ (scope, manifest, thậm chí output đã merge), nhưng slice
**không thể đạt READY bằng bất kỳ session nào** vì thiếu bằng chứng **chỉ con người lấy được ngoài repo**:
câu trả lời support/hợp đồng của provider, phép đo trên thiết bị thật, due-diligence thương mại. Bot **không
quét** `blocked`. Đây không phải "chưa làm" — chạy lại chỉ tái xác nhận cùng một HALT và đốt session.
Ghi rõ trong `notes`: **ai** đóng được, **bằng gì**, và điều kiện chuyển lại `ready`.
Lý do có trạng thái này: AP-22 từng mang `ready` dù đã HALT fail-closed đúng và output đã merge, nên nó bị
launch lại và lặp y nguyên kết luận cũ.

> **Phase-1 7h run (Fable 5) — SAFE SINGLE-SLICE:** owner handoff hiện hành là
> `docs/autopilot-templates/phase1-fable5-7h-PR-RUN.md`. Mỗi session chỉ chạy **một** task `ready`, non-P0,
> trong worktree riêng rồi `scope-gate ready` + STOP_AT_READY; không stacked PR, integration branch, degraded
> Codex mode hay full-launch. Hiện chỉ `infra-egress-compatibility-evidence` đủ artifact và trạng thái để launch;
> `infra-do-app-vpc-deployment` là P0/manual vì chạm migration + secret-bearing deployment wiring.
> `phase1-fable5-RUN.md` và `phase1-fable5-orchestrator.md` là lịch sử, cấm chạy. Product S4+ phải được
> re-slice theo mechanism, risk-classify và merge prerequisites vào `main` giữa các session.

## Block format
```
## task: <slug>
title: <một dòng>
status: idea | planned | ready | in-flight | merged | blocked
risk: P0 | P1 | P2
change_class: <class>
depends_on: [<slug>, ...]
invariants: [<catalog-token>, ...]
scope: [<file>, ...]
manifest: docs/autopilot-manifests/<slug>.json
notes: <link spec>
```

---

## task: auth-provider-google-email-swap
title: Replace Telegram-era web auth with Google OAuth + email/password while preserving SI-1..SI-8
status: idea
risk: P0
change_class: manual-auth-feature
depends_on: []
invariants: [auth, identity, schema, build-config]
scope: []
notes: DD-13/DD-37 + `docs/features/feature_web_auth_onboarding.md` + `docs/features/BE/auth-security-invariant-table.md`. Auth v3 Telegram-era is already merged; this is a provider-port, not a greenfield auth rewrite. Canonical v0.6.0 classifies auth/token scope as P0, so this is **manual workflow only and NOT launcher-ready**. Split Google OIDC proof/provider-login/route wiring from the atomic email credential lifecycle; run live impact/prescan and pin decision tables first. Preserve fail-closed SI-1..SI-8 and remove `TELEGRAM_BOT_TOKEN` only after replacement routes/tests land.

## task: feature-identity
title: Account/member identity (link, merge, claim) — nền cho mọi feature khác
status: idea
risk: P0
change_class: manual-identity-feature
depends_on: []
invariants: [identity, schema, auth]
scope: []
notes: docs/features/feature_identity.md. Đụng auth/token + migration + debt-bearing claim/ledger preservation nên P0 manual-only; split core directory, link-code lifecycle và merge/claim mutation thành các reviewable manual slices, không launch qua unattended autopilot.

## task: feature-billing-lifecycle
title: Subscription / billing lifecycle
status: idea
risk: P0
change_class: manual-billing-feature
depends_on: [feature-identity]
invariants: [billing, money-model, schema]
scope: []
notes: docs/features/feature_billing_lifecycle.md. Billing/transactions/migration scope is P0 manual-only; fail-closed + single-source paid/balance remain mandatory.

## task: feature-cross-club-join
title: Cross-club join
status: idea
risk: P1
change_class: cross-club-feature
depends_on: [feature-identity]
invariants: [cross-club, schema, identity]
scope: []
notes: docs/features/feature_cross_club_join.md. Đụng identity+schema → tuần tự sau feature-identity.

## task: feature-marketplace-discovery
title: Marketplace discovery / listing
status: idea
risk: P2
change_class: marketplace-feature
depends_on: []
invariants: [marketplace, core-api]
scope: []
notes: docs/features/feature_marketplace_discovery.md. Nếu KHÔNG đụng schema/identity → ứng viên chạy SONG SONG với identity.

## task: web-app-shell
title: Web app shell / screens (frontend)
status: idea
risk: P2
change_class: web-feature
depends_on: []
invariants: [web-app, design-tokens]
scope: []
notes: docs/channels/web/. Frontend riêng → thường DISJOINT với backend feature (song song tốt) trừ khi đụng core-api/i18n.

## task: infra-do-app-vpc-deployment
title: DigitalOcean App Platform + Managed PostgreSQL VPC deployment contract
status: idea
risk: P0
change_class: manual-infra-security-deployment
depends_on: [monorepo-scaffold, db-postgres-drizzle-rls]
invariants: [build-config, schema]
scope: [.github/workflows/deploy.yml, infra/app.prod.yaml, infra/app.staging.yaml, infra/fly.toml, docs/standards/environments-setup.md]
manifest: docs/autopilot-manifests/infra-do-app-vpc-deployment.json
merged_probe: infra/app.prod.yaml :: ^name:[[:space:]]+plexco-prod$
notes: P0 manual workflow only; canonical v0.6.0 classifies its migration orchestration and secret-bearing DB/deploy wiring as ineligible for autopilot codegen. AP-21 is a disabled historical launcher, not an execution entry point. First merge `infra-egress-compatibility-evidence`; then manually re-slice/prove the provider-specific design without weakening VPC, DB-role, secret or migration boundaries. Full design contract: `docs/autopilot-infra-do-app-vpc-deployment.md`.

## task: infra-egress-compatibility-evidence
title: Close DD-04 fixed-egress compatibility evidence for SePay, ApiPay, Zalo and Meta
status: blocked
risk: P2
change_class: docs-provider-evidence
depends_on: []
invariants: [build-config]
scope: [docs/standards/environments-setup.md]
manifest: docs/autopilot-manifests/infra-egress-compatibility-evidence.json
merged_probe: docs/standards/environments-setup.md :: DD04_EGRESS_EVIDENCE_CLOSED
notes: **⛔ BLOCKED ON OWNER-ONLY EVIDENCE — ĐỪNG RE-LAUNCH (2026-07-22).** Công việc của slice này **đã xong và đã merge**: `docs/standards/environments-setup.md` §1.1 có bảng evidence 5 cột với **Gate status `HALT-EVIDENCE_INCOMPLETE`**, và marker `DD04_EGRESS_EVIDENCE_CLOSED` **cố ý vắng mặt** — đó là fail-closed **đúng**, không phải việc dở dang. Re-run ngày 2026-07-22 tái xác minh cả 4 nguồn chính thức: **không dòng nào lật**. 3/4 dòng (SePay · ApiPay · Zalo Bot) là `UNRESOLVED` **vì tài liệu im lặng về source-IP policy của caller outbound**, mà luật evidence cấm đóng `NO` từ im lặng và invariant no-fabrication cấm bịa hành vi provider; Meta đã là `NO` (server-IP allowlist chỉ opt-in cho app-secret, không áp cho page-token). **Không session nào đóng được** — chỉ đóng bằng: câu trả lời support SePay quy chiếu được về `my.sepay.vn` API callers · câu trả lời onboarding/hợp đồng ApiPay phủ **cả** bề mặt DD-30 enterprise lẫn BYO-key · câu trả lời support Zalo Bot về `bot-api.zaloplatforms.com`. **Chuyển lại `ready` khi và chỉ khi** owner có ít nhất một nguồn quy chiếu được (email/ticket/điều khoản) cho các dòng còn mở. Cùng lớp với gate C7 (email provider) và phép đo Safari/iOS. Forensics AP-22 round-01..03: `0a7ec15`. Chi tiết slice gốc: Record current attributable evidence for each outbound API, distinguish outbound source-IP requirements from inbound webhook verification, and fail closed on any missing/ambiguous row. Scope explicitly excludes App Specs, workflows, code, config, migrations, secret handling and provider mutation. One P2 FULL-base Codex clean round, manual merge, STOP_AT_READY. Contract: `docs/autopilot-infra-egress-compatibility-evidence.md`.

## task: infra-inbound-webhook-auth-evidence
title: Inbound webhook verification contract evidence for SePay, ApiPay, Zalo and Meta
status: merged
risk: P2
change_class: docs-provider-evidence
depends_on: []
invariants: [api-contract]
scope: [docs/standards/webhook-verification-matrix.md]
manifest: docs/autopilot-manifests/infra-inbound-webhook-auth-evidence.json
merged_probe: docs/standards/webhook-verification-matrix.md :: WEBHOOK_AUTH_EVIDENCE_CLOSED
notes: **✅ MERGED 2026-07-23.** Kết quả `WEBHOOK_AUTH_CONTRACT_PARTIAL` — cả 4 dòng quy chiếu được về docs chính thức hiện hành, **không dòng nào `UNRESOLVED`**, nên marker đóng là hợp lệ (khác AP-22: có `UNRESOLVED` ⇒ đúng khi từ chối đóng). Chỉ SePay `SPECIFIED` (headers + `{timestamp}.{raw_body}` + ±300s + constant-time); ApiPay/Zalo Bot/Meta `PARTIAL` vì docs **im lặng** về replay window và timing-safe. Hai thứ cần nhớ về sau: (1) representation ApiPay ký mâu thuẫn với spec raw-body của mình → tách thành `apipay-signed-body-reconciliation` (blocked, P0, đường tiền); (2) Meta ký bản **escaped-unicode** của payload, verify trên decoded bytes sẽ fail âm thầm. Doc tự ghi trong header vì sao nó cố ý nằm ngoài `check-review-readiness.mjs` — provider evidence, không phải review/plan; đừng tranh luận lại. Chi tiết slice gốc: Launcher-ready docs-only AP-23 slice (opposite direction from AP-22 egress). Document the INBOUND webhook verification contract per provider — signature header, algorithm, raw-body vs parsed, replay/timestamp window — from current official docs; never handle secret VALUES. Fail closed on any ambiguous row. One P2 FULL-base Codex clean round, manual merge, STOP_AT_READY. Contract: `docs/autopilot-infra-inbound-webhook-auth-evidence.md`.

## task: apipay-signed-body-reconciliation
title: Confirm ApiPay's signed representation with ApiPay and reconcile the raw-body specs to it
status: blocked
risk: P0
change_class: docs-spec-reconciliation
depends_on: []
invariants: [api-contract, money-model]
scope: []
notes: **⛔ BLOCKED ON OWNER-ONLY EVIDENCE — KHÔNG launch (2026-07-23).** Phát hiện bởi AP-23 khi đọc docs chính thức, `webhook-verification-matrix.md` §3.2. **Hai hợp đồng loại trừ nhau:** docs ApiPay ký `JSON.stringify(req.body)` (parsed body re-serialize, **không** pin canonical form — key order/whitespace/unicode escaping đều thả nổi), trong khi spec nội bộ của Plexco bắt HMAC trên **raw bytes** và có unit test khẳng định re-serialize phải fail — `feature_connector_onboarding_tech.md:269` (§4.5 verifier + tests 3–5) và `feature_payment_reconcile_tech.md:322-326`. Chỉ một trong hai đúng; bên sai sẽ **reject 100% callback hợp lệ của ApiPay** — nằm thẳng trên đường tiền (payment reconcile), nên P0. **Không session nào đóng được:** docs đã được đọc hết và mâu thuẫn vẫn còn, nên đọc thêm docs không lật được gì; chỉ đóng bằng **capture sandbox thật của ApiPay** (giữ raw bytes + header `ApiPay-Signature`, tự tính lại HMAC theo cả hai cách để xem cách nào khớp) **hoặc** trả lời quy chiếu được từ ApiPay support/onboarding nói rõ representation được ký. **Chuyển lại `ready`/planned khi và chỉ khi** có một trong hai — khi đó slice là sửa spec nội bộ theo sự thật đo được, không phải nghiên cứu lại. **Chặn:** mọi code adapter inbound-webhook của ApiPay. Cùng lớp blocked với C7 (email provider) và phép đo Safari/iOS. Không sửa hai spec kia bằng suy luận — AP-23 cố ý chỉ flag, không tự resolve.

## task: infra-provider-limits-evidence
title: Messaging limits and tier evidence for Zalo Bot, Meta Messenger, SePay and ApiPay
status: merged
risk: P2
change_class: docs-provider-evidence
depends_on: []
invariants: [build-config]
scope: [docs/standards/provider-limits-evidence.md]
manifest: docs/autopilot-manifests/infra-provider-limits-evidence.json
merged_probe: docs/standards/provider-limits-evidence.md :: HALT-EVIDENCE_INCOMPLETE
notes: **MERGED 2026-07-22 as a fail-closed PARTIAL at `main@a57b8ee` — the DD-04 provider-limits evidence gate is NOT closed.** The doc deliberately ends at `HALT-EVIDENCE_INCOMPLETE` (merged_probe updated to that marker, NOT `PROVIDER_LIMITS_EVIDENCE_CLOSED`, which would be a false closure). Codex hit REGION_THRASH (4 rounds, findings 4→3→1→3, precision-only, verdict stable "appropriately fail-closed overall"); round-04 edits were human-reviewed (no fabricated values; contested rows moved to `UNRESOLVED`), so no round-05. **Residual rows keep the gate open — most need an owner DECISION or a non-web action, NOT more review:** U3 Zalo surface (see `dd-zalo-surface-reconcile-brief.md` — likely a stale-header doc-fix, not a real fork), U4 ApiPay enterprise DD-30 contract, U5 Messenger HUMAN_AGENT/OTN eligibility (P2.5 policy spike + DD-33 App Review), U6/U6b SePay STARTUP cap + VPBank referral gating, U7 Send API rate limit, U1/U1b/U2 Messenger marketing/utility/tags in VN (Meta does not publish VN availability). **Value delivered:** superseded the stale SePay per-tx framing in gtm-doi-soat-decision.md with the current FREE/STARTUP/SHOP/eShop structure. Original scope — launcher-ready docs-only AP-24 slice. Record current attributable messaging limits/tier gates (Zalo free-tier caps, Messenger 24h window + App Review, SePay/ApiPay tiers), re-verifying any figure currently in gtm-doi-soat-decision.md. Evidence only — no pricing/GTM/capacity decision, no invention. Fail closed on ambiguity. Shares `build-config` with the egress slice → run them sequentially, not in parallel. One P2 FULL-base Codex clean round, manual merge, STOP_AT_READY. Contract: `docs/autopilot-infra-provider-limits-evidence.md`.

## task: docs-session-management-acceptance-checklist
title: Issue-ready acceptance checklist derived from Session Management specs
status: ready
risk: P2
change_class: docs-traceability
depends_on: []
invariants: [schema]
scope: [docs/issues/session-management-acceptance-checklist.md]
manifest: docs/autopilot-manifests/docs-session-management-acceptance-checklist.json
merged_probe: docs/issues/session-management-acceptance-checklist.md :: SESSION_MGMT_CHECKLIST_CLOSED
notes: Launcher-ready docs-only AP-25 slice. Convert acceptance criteria + DoD from feature_session_management(_tech) into a traceable issue checklist (LOCAL specs only, every item src-traced, no invention); serves ROADMAP Next Actions #3. Docs traceability only, NOT session build authorization. `schema` token = domain only; scope is one checklist markdown file. Fail closed if a referenced spec section is missing. One P2 FULL-base Codex clean round, manual merge, STOP_AT_READY. Contract: `docs/autopilot-docs-session-management-acceptance-checklist.md`.

## task: docs-auth-d0-d1-implementation-packet
title: Copy-paste-grade implementation packet for auth slices D0 revoke-core + D1 google-adapter
status: superseded
risk: P2
change_class: docs-traceability
depends_on: []
invariants: [auth, schema]
scope: [docs/auth-d0-d1-implementation-packet.md]
manifest: docs/autopilot-manifests/docs-auth-d0-d1-implementation-packet.json
merged_probe: docs/auth-d0-d1-implementation-packet.md :: AUTH_D0_D1_PACKET_COMPLETE
notes: SUPERSEDED 2026-07-19 (owner, DD-80 defect fix v4 / decisions v1.86) — Codex round-03 returned 2xP1+1xP2 at fix-round cap 5 → MAX_ROUNDS halt; monolith split into `docs-auth-d0-packet` (AP-27) + `docs-auth-d1-packet` (AP-28) below. Branch `feat/docs-auth-d0-d1-implementation-packet` @ cab0c2a is kept as READ-ONLY reference (lift source via git show) until both split packets merge, then ap-finish it. Original scope: transcribe DD-80/B0 into draft DDL 0015/0016, schema-mirror plan, route/adapter outlines and test skeletons mapped 1-1 to acceptance D0/D1, plus DD-38/39 readiness listing.

## task: docs-auth-d0-packet
title: D0 revoke-core implementation packet (split 1/2 from AP-26 monolith)
status: merged
risk: P2
change_class: docs-traceability
depends_on: []
invariants: [auth, schema]
scope: [docs/auth-d0-implementation-packet.md]
manifest: docs/autopilot-manifests/docs-auth-d0-packet.json
merged_probe: docs/auth-d0-implementation-packet.md :: AUTH_D0_PACKET_COMPLETE
notes: MERGED historical AP-27 packet; its marker is present on main. The generated packet is superseded for execution by DD-80 v1.88 + the final G3 contract, which split current D0 into P0 manual-only `auth-s4-d0-revoke-core` and `auth-s4-d0-session-web-boundary`. The old launcher is disabled and this task must not be re-run.

## task: docs-auth-d1-packet
title: D1 google-adapter implementation packet + DD-39 readiness (split 2/2 from AP-26; DD-38 chat split to dd38-dd86-chat-schema-core)
status: ready
risk: P2
change_class: docs-traceability
depends_on: [auth-s4-d0-revoke-core, auth-s4-d0-session-web-boundary]
invariants: [auth, schema]
scope: [docs/auth-d1-implementation-packet.md, docs/autopilot-manifests/docs-auth-d1-packet.json, docs/autopilot-backlog.md, .claude/commands/ap-28-docs-auth-d1-packet.md, docs/autopilot-docs-auth-d1-packet.md]
manifest: docs/autopilot-manifests/docs-auth-d1-packet.json
merged_probe: docs/auth-d1-implementation-packet.md :: Auth D1 Implementation Packet
notes: **UNBLOCKED 2026-07-22 — HOLD đã gỡ.** Điều kiện cũ (D0a + D0b merged probes trên origin/main) **đã thoả**: `0015::auth_revoke_account_sessions` và `apps/web/app/api/auth/logout-all/route.ts` đều live; thực tế cả `auth-s4-d1-google-adapter` (`0017`) và `d1b` (`0018`) cũng đã merge, nên packet này giờ mô tả code **đã tồn tại** chứ không phải code dự kiến — author phải verify-on-disk từng citation thay vì chép lại kế hoạch cũ. Cảnh báo lịch sử vẫn giữ: AP-28 remains a P2 docs-only preparation slice, but its preflight and manifest now pin DD-80 v1.88, tech header-v2.10/changelog-v2.11 (D1 implemented), verdicts v2.0 (D1/d1b merged) and the D0 dependencies at base main@399c5eb. The D1-specific v1.86 AAD/audit obligations remain unchanged; re-audit citations against the then-current committed base before authoring the packet. **Split 2026-07-23 (owner Option 2):** DD-38 chat readiness split OUT to root slice dd38-dd86-chat-schema-core; §C is DD-39 gender/pricing only; packet ships WITHOUT AUTH_D1_PACKET_COMPLETE (§C source GAP under gate §11.2), so the merged_probe matches the packet H1 rather than a completion marker. Scope now 5 files (packet + manifest + backlog + launcher + task doc reconciled to the split).

## task: auth-s4-d0-revoke-core
title: Account-session epoch DB core for linearizable revoke-all
status: merged
risk: P0
change_class: manual-auth-schema
depends_on: [db-postgres-drizzle-rls, auth-onboarding-v3]
invariants: [auth, schema]
scope: [docs/autopilot-manifests/auth-s4-d0-revoke-core.json, packages/db/schema.ts, packages/db/migrations/0015_auth_revoke_account.sql, packages/db/src/auth.ts, packages/db/src/index.ts, packages/db/src/auth.test.ts, packages/db/src/rls-invariants.test.ts, packages/db/README.md]
manifest: docs/autopilot-manifests/auth-s4-d0-revoke-core.json
merged_probe: packages/db/migrations/0015_auth_revoke_account.sql :: CREATE OR REPLACE FUNCTION auth_revoke_all_web_sessions
notes: D0a root slice under DD-80 v1.88 and `g3-revoke-all-concurrency-probe-seed.md` v1.0. P0 manual workflow only; canonical GENERIC v0.6.0 forbids autopilot codegen, so there is no launcher. One atomic 0015 owns account/session epochs, create/resolve/rotate replacements, revoke helper/wrapper, audit materialization and real-Postgres barrier/catalog/grant proofs. MERGED 2026-07-20 via **owner override** — 2-clean gate NOT reached after 12 Codex rounds (10 findings fixed incl. round-06 epoch-vs-revoked_at P1; round-11 self-caught/reverted); closed on manual review + acceptance 22/22 + real-PG 97/97 (see `.autopilot/state/auth-s4-d0-revoke-core/HALT-MAX_ROUNDS.txt` + merge commit).

## task: auth-s4-d0-session-web-boundary
title: Session reauth fence and logout-all web boundary
status: merged
risk: P0
change_class: manual-auth-boundary
depends_on: [auth-s4-d0-revoke-core]
invariants: [auth, api-contract]
scope: [docs/autopilot-manifests/auth-s4-d0-session-web-boundary.json, apps/web/lib/session-cookies.ts, apps/web/lib/session-cookies.test.ts, apps/web/app/api/auth/logout-all/route.ts, apps/web/app/api/auth/logout-all/route.test.ts, apps/web/app/api/auth/telegram/callback/route.ts, apps/web/app/api/auth/telegram/callback/route.test.ts, apps/web/app/api/onboarding/start/route.ts, apps/web/app/api/onboarding/start/route.test.ts]
manifest: docs/autopilot-manifests/auth-s4-d0-session-web-boundary.json
merged_probe: apps/web/app/api/auth/logout-all/route.ts :: revokeAllWebSessions
notes: D0b under DD-80 v1.88. **MERGED 2026-07-22 at `main@93c5404`** — P0 gate **ĐẠT** (2 consecutive FULL-base Codex clean rounds, only 2 fix rounds; NO owner override, unlike D0a). 8 files all `apps/web`, zero DB delta; web tests 65→78; real-PG green. Evidence: Verdict 6 in `slice-readiness-verdicts.md`. P0 manual workflow only, no autopilot launcher. Owns stale-cookie rotate-null reject-and-reauth, all live caller mappings, CSRF/logout-all route and tests; zero DB/schema changes. Two consecutive FULL-base Codex clean rounds, scope-gate READY, STOP_AT_READY, manual merge.

## task: auth-s4-d1-email-token-core
title: Account email + token credential core (storage/validators/parent-first helpers, dark)
status: merged
risk: P0
change_class: identity-feature
depends_on: [auth-s4-d0-revoke-core, auth-s4-d0-session-web-boundary]
invariants: [auth, schema]
scope: [docs/autopilot-manifests/auth-s4-d1-email-token-core.json, packages/db/schema.ts, packages/db/migrations/0016_account_email_token_core.sql, packages/db/src/auth.ts, packages/db/src/auth.test.ts, packages/db/src/rls-invariants.test.ts, docs/features/BE/feature_web_auth_onboarding_tech.md]
manifest: docs/autopilot-manifests/auth-s4-d1-email-token-core.json
merged_probe: packages/db/migrations/0016_account_email_token_core.sql :: account_emails
notes: **CODE_READY 2026-07-22 (Verdict 7, pinned `main@fc7d0a4`).** Deps merged: D0a `8f493f7` + D0b `93c5404` (probes `0015::auth_revoke_account_sessions` + `logout-all/route.ts::revokeAllWebSessions` present). The two artifacts that were missing on 2026-07-22 are now authored: **acceptance matrix D1E-1..D1E-22** in `feature_web_auth_onboarding_tech.md` §5 (includes the manifest's named READY preconditions — D1E-17 reset-vs-consume, D1E-18 merge barrier) and **Verdict 7** in `slice-readiness-verdicts.md`. D1 order-2, P0 manual (no launcher), CODE DARK: one atomic `0016_account_email_token_core.sql` = 5 tables + constraints/partial indexes + `_auth_assert_password_phc` + constraint trigger + `_auth_consume_email_token` + cleanup, plus `schema.ts` mirror. Boundaries pinned: public verify/reset/login functions and all routes are **order-4**; DD-70(a) inbox fence is **out of scope** (order-2 has no global-emitting path); `auth_audit_events` is **reused** from D0/`0015`, not recreated. P0 manual workflow only. CODE DARK: storage + validators + parent-first helpers + cleanup ONLY — no email UI/routes/provider-send; provider fail-closed OFF. Two consecutive FULL-base Codex clean rounds, scope-gate READY, STOP_AT_READY, manual merge. Manifest already authored.

## task: auth-s4-d1-google-adapter
title: Google OIDC provider adapter + oauth transaction/Lax binding
status: merged
risk: P0
change_class: identity-feature
depends_on: [auth-s4-d0-revoke-core, auth-s4-d0-session-web-boundary, auth-s4-d1-email-token-core]
invariants: [auth, schema, build-config]
scope: [docs/autopilot-manifests/auth-s4-d1-google-adapter.json, packages/db/schema.ts, packages/db/migrations/0017_oauth_transactions.sql, packages/db/src/auth.ts, packages/db/src/auth.test.ts, apps/web/lib/google-oidc.ts, apps/web/lib/google-oidc.test.ts, apps/web/lib/oauth-transaction.ts, apps/web/lib/oauth-transaction.test.ts, apps/web/app/api/auth/google/state/route.ts, apps/web/app/api/auth/google/state/route.test.ts, apps/web/app/api/auth/google/callback/route.ts, apps/web/app/api/auth/google/callback/route.test.ts, apps/web/package.json, pnpm-lock.yaml, .env.example, docs/features/BE/feature_web_auth_onboarding_tech.md]
manifest: docs/autopilot-manifests/auth-s4-d1-google-adapter.json
merged_probe: packages/db/migrations/0017_oauth_transactions.sql :: auth_oauth_transactions
notes: **CODE_READY 2026-07-22 (Verdict 9, pinned `main@8f6a051`).** All three deps merged and probed live: D0a `8f493f7` · D0b `93c5404` · email-token-core `64fb4d3`. Acceptance matrix D1-1..D1-15 already existed and was **re-verified against the live schema** at this SHA (not assumed) — every collision cell D1-6..D1-10 is now constructible because `account_emails`/`auth_pending_email_registrations`/`email_password_credentials` landed with `0016`, and `deriveEmailArtifacts(raw, accountEmailId, keys)` already provides the v1.86 cell-1 AAD handoff. D1 order-3, P0 manual (no launcher), migration `0017_oauth_transactions.sql` (tail is `0016`, so monotonic). Enablement: google-oauth-client-config (config only), A3-legal-PII (go-live). P0 manual workflow only. Owns auth_oauth_transactions + Lax binding cookie, state/nonce/PKCE, OIDC proof + §4 collision matrix, session issue; preallocated account_emails.id AAD for cell-1. Enablement gates: google-oauth-client-config (KMS/env, no hard-code), A3-legal-PII (go-live). Two consecutive FULL-base Codex clean rounds, manual merge. Manifest already authored.

## task: auth-s4-d1b-oauth-session-rotation
title: Same-site completion hop so Google login can rotate the pre-existing Strict session
status: merged
risk: P0
change_class: manual-auth-boundary
depends_on: [auth-s4-d1-google-adapter]
invariants: [auth, api-contract]
scope: [docs/autopilot-manifests/auth-s4-d1b-oauth-session-rotation.json, apps/web/lib/session-cookies.ts, apps/web/lib/session-cookies.test.ts, apps/web/app/api/auth/google/callback/route.ts, apps/web/app/api/auth/google/callback/route.test.ts, docs/features/BE/feature_web_auth_onboarding_tech.md]
manifest: docs/autopilot-manifests/auth-s4-d1b-oauth-session-rotation.json
merged_probe: apps/web/lib/session-cookies.ts :: completion hop
notes: **BLOCKER ON ENABLING GOOGLE LOGIN** — must land before `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` are set in ANY environment, not merely "the next slice". Until then Google login stays fail-closed (503) so the residual risk is not live. **Residual risk it closes:** a `SameSite=Strict` session cookie is not sent on the cross-site OAuth callback, so D1 mints fresh (per matrix D1-2/D1-13) and a **pre-login session survives Google login un-invalidated**; an attacker holding that older token keeps it. The capture-at-`/state` + revoke-at-callback workaround was tried and **rejected in D1**: non-atomic, races logout-all (new P1 at round-06), and still misses when `/state` itself is entered cross-site. **Shape:** add a SAME-SITE completion hop after the callback lands — a first-party navigation does carry the Strict cookie, so the existing atomic rotate primitive at the D0/session layer can do the rotation in one transaction. Solve it where the primitive lives instead of fighting a browser invariant inside the OAuth adapter. **CODE_READY (Verdict 12, `main@fa94e3b`) — blocker đóng bằng ĐO, không phải lập luận.** Probe `docs/probe-strict-cookie-completion-hop.md` chạy harness hai site trên Chromium 149 · Firefox 151 · WebKit 26.5: **302 trần từ callback (M1) KHÔNG mang cookie `Strict` trên cả ba engine** — đúng cơ chế mà implementer sẽ mặc định chọn, và nếu chọn nó thì slice **ship một fix vô dụng thầm lặng** trong khi test mock vẫn xanh. **Cơ chế đã pin: M3** — callback trả landing first-party non-mutating → auto-submit POST same-origin → completion endpoint chạy `issueSession()` (đi nhánh rotate sẵn có). Chọn M3 vì tái dùng pattern hai-hop B0 §8 và POST mang `Origin` cho `sameOriginRequest()` guard bước mutating. Acceptance **D1B-1..D1B-11** (D1B-11 = anti-regression assert callback trả document, KHÔNG 302). **Không cần primitive mới** — `auth_rotate_web_session` (0015) đã atomic + qua barrier test D0a. ⚠️ **Safari macOS + iOS CHƯA đo** (Playwright dùng WebKit frozen, không phải Safari bản ship) → **ENABLEMENT_ONLY**: không chặn code, nhưng điều kiện bật Google login là **d1b merged VÀ Safari/iOS đã đo** (steps ở probe §7). P0 manual, no launcher.

## task: enable-google-login-safari-measurement
title: Measure the M3 completion hop on shipping Safari (macOS) and iOS Safari before enabling Google login
status: blocked
risk: P0
change_class: owner-evidence-gate
depends_on: [auth-s4-d1b-oauth-session-rotation]
invariants: [auth]
scope: []
notes: **⛔ BLOCKED ON OWNER-ONLY MEASUREMENT — không session nào chạy được (2026-07-23).** Code đã xong: d1b merged, cơ chế M3 pin bằng đo thật (Chromium 149 · Firefox 151 · WebKit 26.5), acceptance D1B-1..D1B-11 xanh. **Còn thiếu đúng một thứ:** Playwright dùng **WebKit frozen**, KHÔNG phải Safari bản ship — và ITP/"Prevent cross-site tracking" của Safari thật là thứ có thể làm hop M3 rụng cookie `Strict` trong khi ba engine kia pass. Chưa đo thì không biết, mà đoán ở đây nghĩa là bật Google login rồi hy vọng. **Điều kiện bật Google login = d1b merged VÀ Safari/iOS đã đo.** Cho tới lúc đó `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` phải **rỗng ở MỌI environment** — login giữ fail-closed 503 nên rủi ro tồn dư không live. **Chỉ owner đóng được** vì cần máy Mac có Safari thật + iPhone/iOS Simulator; agent không có. **Cách làm (đã viết sẵn, ~20 phút):** `docs/probe-strict-cookie-completion-hop.md` §7 — dựng harness `.probe` (chỉ cần Node, không cần Playwright), chạy M1..M5 mỗi cơ chế một cửa sổ Private, ghi `strict=` vào §3.1, đối chiếu `/results`. Giữ "Prevent cross-site tracking" ở **mặc định ON** — đó chính là thứ cần đo. **Chuyển lại `ready` khi và chỉ khi** hai cột Safari macOS + iOS Safari trong §3.1 đã điền; nếu M3 fail trên Safari thì đây thành slice thiết kế lại cơ chế, không phải slice bật cờ.

## task: email-provider-c7-evidence
title: Close external gate C7 — email delivery provider evidence before the email auth flag can turn on
status: blocked
risk: P0
change_class: owner-evidence-gate
depends_on: []
invariants: [auth]
scope: []
notes: **⛔ BLOCKED ON OWNER-ONLY DUE DILIGENCE — không session nào đóng được (2026-07-23).** Gate C7 định nghĩa ở `docs/pre-code-open-items-2026-07-16.md` §C, trạng thái ⬜ **chưa khởi động**. Bốn phần: **(a) upstream idempotency chứng minh được** — exact header/param, và hành vi khi timeout/crash mơ hồ; đây là **điều kiện cứng** của B0 probe §5.4, không phải nice-to-have. **(b)** DPA + data region + retention + subprocessors. **(c)** deliverability: SPF/DKIM/DMARC, domain warm-up, bounce/complaint handling. **(d)** named owner + due date + fallback. **Vì sao chỉ owner đóng được:** (a)/(b) là cam kết hợp đồng của nhà cung cấp — phải hỏi vendor và đọc DPA, không suy ra từ docs công khai; (c)/(d) cần quyền trên domain thật. **Luật fail-closed:** không chứng minh được upstream dedupe ⇒ email provider giữ **OFF**; cấm gọi external send rồi giả định exactly-once, và **local receipt ledger KHÔNG phải proof** (nó chứng minh mình đã gửi, không chứng minh provider không gửi hai lần). **Chặn:** bundle order-4 email credential lifecycle (route/UI/pg-boss enqueue/provider send). **Không chặn:** Google-only auth ship độc lập (probe §10 order 3) — nên gate này không nằm trên đường tới hạn của auth. **Chuyển lại `ready` khi và chỉ khi** có (a) bằng văn bản quy chiếu được từ vendor, cộng (b)(c)(d).

## task: core-matcher-grouped-amount-parsing
title: splitNameAmount misparses grouped trailing amounts with a non-zero final group
status: merged
risk: P2
change_class: bugfix
depends_on: []
invariants: [money-model, shared-core]
scope: [docs/autopilot-manifests/core-matcher-grouped-amount-parsing.json, packages/core/src/payments-logic.ts, packages/core/src/payments-logic.test.ts]
manifest: docs/autopilot-manifests/core-matcher-grouped-amount-parsing.json
merged_probe: packages/core/src/payments-logic.test.ts :: Wang 110 500
notes: **✅ MERGED 2026-07-23 `d2a27e1`** (Verdict 16 → IMPLEMENTED). 2 vòng Codex FULL-base clean, **0 fix
  round**; core suite 132 pass trên cây đã merge; diff đúng 2 file (+282/−42). Nhánh `ambiguous` **chưa có
  consumer** — theo dõi ở `core-matcher-ambiguous-consumer-wiring`. Gốc: **CODE_READY (Verdict 16, `main@827d24d`) — DD-87 owner-ratified; authority packet committed/pushed
  2026-07-22.** Mechanism: exhaustive tagged union over every positive `parseMoney` trailing interpretation;
  dedupe by `(name,amount)`; ambiguous returns ordered candidates and no top-level name/amount.
  Equal-amount/different-name (`Player 0 110k`) is ambiguous. Grouped-number/longest/threshold/fuzzy
  heuristics are forbidden. Exact 18-row matrix: `docs/dd-87-splitnameamount-decision-table-analysis.md`;
  task contract (now `code-ready`): `docs/autopilot-core-split-name-amount-ambiguity-contract.md`; launcher:
  `.claude/commands/ap-29-core-split-name-amount-ambiguity-contract.md`. Launchable: open a dedicated
  worktree from `origin/main`, register the manifest, run the AP-29 design probe. Still shares invariant
  `money-model`/`shared-core` with any other in-flight slice on that token. The ignored core-lift tables
  are not a dependency.

## task: core-matcher-ambiguous-consumer-wiring
title: Wire the splitNameAmount ambiguous branch to a caller — picker payload and host resolution
status: idea
risk: P1
change_class: feature-slice
depends_on: [core-matcher-grouped-amount-parsing]
invariants: [money-model, shared-core]
scope: []
notes: **Nghĩa vụ mở ra bởi `d2a27e1`, cố ý để lại (DD-87 §5.4).** `splitNameAmount` giờ trả tagged union và
  nhánh `ambiguous` **không có top-level name/amount** — compile-time fence, caller buộc phải narrow `kind`.
  Hiện **chưa có runtime consumer nào**, nên fence land trước caller đầu tiên: đó là thứ tự đúng, nhưng nó
  nghĩa là **hôm nay chưa ai xử lý ambiguity** — chỉ là chưa ai xử lý sai. Slice này quyết định điều gì xảy ra
  khi matcher không chắc: payload deterministic cho host chọn, hay hàng đợi chờ, hay bỏ qua. **Ràng buộc cứng
  kế thừa:** matcher là **proposal-only**, không bao giờ settle tiền trực tiếp; cấm auto-chọn candidate index 0
  (chọn bừa có trật tự vẫn là chọn bừa, và là đúng lỗi mà `d2a27e1` vừa sửa); cấm thêm heuristic
  threshold/known-name/fuzzy để "giảm ambiguity" — `parseMoney` vẫn là grammar tiền duy nhất. Phải author
  decision table cho từng nhánh trước khi code (bài học D0a: thiết kế còn di chuyển lúc implement thì Codex
  thrash). Chưa có manifest; scope trải qua core + transport + UI nên **cần re-slice theo mechanism trước**,
  không launch như một slice.

## task: docs-core-classifier-decision-table-lift
title: Preserve ignored core classifier decision tables as historical criteria
status: deferred
risk: P2
change_class: docs-only
depends_on: []
invariants: [money-model, shared-core]
scope: [docs/standards/core-payment-classifier-decision-tables.md]
manifest: none — author only when promoted from deferred
merged_probe: docs/standards/core-payment-classifier-decision-tables.md :: core-lift-v3 provenance
notes: The 89/92/99-line tables remain ignored under the registered `phase1-fable5` worktree. Live dry-run says
  the worktree is not prunable. Lift only the final non-duplicated classifier criteria with source-SHA provenance;
  do not make this a dependency of DD-87, do not copy runtime claims, and do not launch speculatively.

## task: db-migration-0000-idempotent-role-create
title: Race-safe role bootstrap in the migration runner — unblocks parallel DB suites
status: merged
risk: P0
change_class: manual-schema-design
depends_on: []
invariants: [schema, build-config]
scope: [docs/autopilot-manifests/db-migration-0000-idempotent-role-create.json, packages/db/src/migrate.ts, packages/db/src/migrate.test.ts, packages/db/src/test-harness.ts, packages/db/vitest.config.ts, packages/db/README.md]
manifest: docs/autopilot-manifests/db-migration-0000-idempotent-role-create.json
merged_probe: packages/db/src/migrate.ts :: duplicate_object
notes: **RE-SCOPED 2026-07-22 → CODE_READY (Verdict 14, `main@e61d96c`).** Khung cũ "làm 0000 atomic" bất khả thi (0000 applied + immutable); khung mới **không đụng 0000**. **Phát hiện chính:** `migrate.ts` đã có `pg_advisory_lock` và comment nói nó ngăn concurrent deploys interleave DDL — nhưng advisory lock của Postgres là **database-scoped**, nên hai `migrate()` trên hai DB khác nhau cùng cluster **không chặn nhau** và lock đó bảo vệ **số không** cho role cluster-global; sửa comment sai lệch đó nằm trong scope. **Cơ chế pin:** role-ensure `EXCEPTION WHEN duplicate_object THEN NULL` chạy ở runner trước vòng lặp migration, ngoài transaction, **gated trên "0000 chưa applied"** để DB đã migrate giữ nguyên profile quyền; sau đó block `IF NOT EXISTS` của 0000 tự bỏ qua ⇒ 0000 byte-identical, checksum không đổi. **Giá trị:** `vitest.config.ts` tự ghi `fileParallelism:false` "is what actually prevents (2)", còn lý do (1) đã thoả sẵn vì mọi suite truyền `dbName` riêng ⇒ đóng (2) là **đủ** để bật `fileParallelism:true`, mở khoá nhiều worktree chạy DB suite song song. Acceptance **BR-1..BR-7** trong manifest (BR-1/BR-6 phải chạy lặp lại, vì đây là race). Bằng chứng gốc — Codex auth-onboarding-v3 round-08: migration 0000's role creation for
  app/app_worker/readonly is `IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE
  rolname = '<role>') THEN CREATE ROLE <role> ...; END IF;`, a check-then-act
  that is NOT atomic against a CONCURRENT migrate() run: two migrations
  against DIFFERENT throwaway databases on the SAME cluster (roles are
  cluster-global, not per-database) can both observe "role missing" and both
  attempt CREATE ROLE, one failing with duplicate_object.
  Real bug in migration 0000 itself — NOT a false positive. Logged
  out-of-scope for auth-onboarding-v3 (pre-existing shared migration infra,
  not introduced by that slice) because it is currently MASKED, not fixed:
  packages/db/vitest.config.ts sets `fileParallelism: false` +
  `sequence.concurrent: false`, serializing DB test FILE execution
  end-to-end — this is what actually prevents the race today (verified: 8
  consecutive full `pnpm --filter @plexco/db run test` runs, zero
  duplicate-role errors). auth-onboarding-v3 added the SECOND DB test file
  (auth.test.ts) that first exercises this cluster-global-role path
  concurrently with rls-invariants.test.ts; before that slice only one DB
  test file existed, so the race had no second caller to collide with.
  Fix shape: wrap each CREATE ROLE in an EXCEPTION handler catching
  `duplicate_object` (Postgres has no `CREATE ROLE IF NOT EXISTS` syntax),
  so the block is idempotent even under a genuine race, not just under the
  current serialized-by-config test harness. Do not remove
  `fileParallelism: false` until this lands — see the comment already added
  to vitest.config.ts.

## task: db-session-tenant-integrity-fks
title: Composite tenant FKs so a child row cannot reference another tenant's session/membership
status: ready
risk: P0
change_class: manual-schema-design
depends_on: []
invariants: [schema]
scope: [docs/autopilot-manifests/db-session-tenant-integrity-fks.json, packages/db/migrations/0019_tenant_integrity_fks.sql, packages/db/schema.ts, packages/db/src/rls-invariants.test.ts, packages/db/README.md]
manifest: docs/autopilot-manifests/db-session-tenant-integrity-fks.json
merged_probe: packages/db/migrations/0019_tenant_integrity_fks.sql :: session_surface_refs
notes: |
  **CODE_READY (Verdict 17, `main@29635be`).** First P0 slice of the feature layer — SessionService L0a
  prerequisite (docs/session-service-reslice-analysis.md). Root slice: no unmerged dependency, no external
  gate. Closes a real tenant-integrity hole the BE spec flags as a DD-68 prerequisite and records as absent
  from 0014: single-column FKs prove a parent exists but not that it shares the child's tenant, so a
  service bug can write players(tenant_id=A, session_id=<B's>), a row invisible to both tenants while
  charges references both. Migration 0019 expand-only: add UNIQUE(tenant_id,id) candidate keys on
  sessions/memberships, add 7 composite FKs NOT VALID -> violation probe -> VALIDATE, keep every existing
  single-column FK (additive). FK inventory scanned from schema.ts, not guessed; 3 exclusions each with a
  reason (session_occurrences has no tenant_id + is covered by the dual-parent invariant test;
  public_sessions must not FK into tenant tables per HR2; magic_links.session_id references web_sessions).
  charges.membership_id is the one nullable child -> MATCH SIMPLE unenforced-on-NULL is intended. Acceptance
  TI-1..TI-9; migration count assertion 19->20 in BOTH places. **P0 manual, no launcher.**
  ⚠️ REGISTER WAIT (not a contract gap): `schema` token is held by in-flight AP-25
  (docs-session-management-acceptance-checklist); scope-gate register will HALT SCOPE_COLLISION until AP-25
  merges. Open the worktree only after AP-25 is on origin/main. Migration number 0019 assumes no other
  schema slice lands first — renumber to the next-available monotonic tail at author time if one does.

## task: dd38-dd86-chat-schema-core
title: Root chat-schema migration slice (DD-38 in-app chat) — final chat model + authz/safety + RLS/RPCs
status: idea
risk: P0
change_class: schema-migration
depends_on: []
invariants: [schema]
scope: []
manifest: null
merged_probe: packages/db/schema.ts :: chat_channels
notes: |
  Recording existence only — NOT authorized to author. Blocked behind THREE gates, all must close first:
    - DD-55 design-probe (DM request/media/report FSM + storage constraints) — NOT run.
    - DD-86 (in-app multi-channel per CLB) — 🟡 proposal, 9 open questions in-scope, NOT_PLAN_READY
      (decisions.md:103 / :1075; sequence pinned decisions.md:1085 = "tạo một root migration slice
      dd38-dd86-chat-schema-core chứa final chat model → authz/channel-command consumer → Assistant").
    - CHT-OQ-2 (club channel moderation granularity: host delete/hide/mute) — OPEN (decisions.md:672).
  Surface (all pending, no executable DDL yet): chat_channels/chat_members/chat_messages base tables +
  triggers; RLS + chat_definer role (pre-migration superuser provisioning) + SECURITY DEFINER RPCs
  (DM create_dm/send_chat_message/mark_read defined in feature_inapp_chat_tech.md; club create_club_channel
  + add/remove-club-member undefined); DM-safety schema chat_blocks/chat_reports/rate-audit (no CREATE TABLE
  anywhere); phase-1 media chat_attachments (attachment/scan/quota/deletion states, schema-pending
  feature_inapp_chat.md:107); memberships composite-FK target.
  Split out of AP-28 auth-d1-packet by owner decision 2026-07-23 (DD-38 chat and auth-D1 are unrelated
  domains). depends_on stays [] because DD-55/DD-86/CHT-OQ-2 are decision gates, not merged slugs — do not
  spin a worktree until all three close. This block AUTHORIZES nothing; it only keeps DD-86's prose name as
  an executable anchor so the chat work does not fall off the radar after leaving the packet.

## task: docs-session-management-spec-reconcile
title: Reconcile 2 pinned Session Management spec defects (projection direction + stale 0014 merge-state) to PRD
status: merged
risk: P2
change_class: docs-reconcile
depends_on: []
invariants: []
scope: [docs/autopilot-manifests/docs-session-management-spec-reconcile.json, docs/features/feature_session_management.md, docs/features/BE/feature_session_management_tech.md, docs/features/README.md, docs/autopilot-backlog.md]
manifest: docs/autopilot-manifests/docs-session-management-spec-reconcile.json
merged_probe: docs/features/BE/feature_session_management_tech.md :: merged on main .1a6ac38.
notes: Reconcile lower-authority TDD -> PRD. Defect 1 = tech edge row 10 projection direction inverted -> "Public -> private removes projection" (matches feature spec edge 8 + SES-UC-5/SES-UC-10, PRD FLOW 2/13). Defect 2 = current-state "0014 branch-only/unmerged" claims corrected to merged-on-main (1a6ac38, migrations 0000-0018) across both headers, migration note+range, rollback row (forward-migration + zero-waitlisted gate), DDL waitlist_position comment, SES-OQ-3 row, rollout step-2; dated changelog history preserved; provenance @22c23aa reframed historical (not deleted). Founder F1/F2/F3 applied: invariants [] + manifest _note (rejected ["schema"] as false-coupling); version bump feature v2.12b / tech v2.13a + 1 new dated changelog row each + README index cell synced; F3 repo-wide reconcile deferred (see block below). STOP_AT_READY, manual merge under founder root-commit lock. Enables AP-25 re-trace once merged. Flip status ready/merged per the merge decision.

## task: docs-0014-merge-status-repo-wide-reconcile
title: Reconcile stale "0014 branch-only/unmerged" claims across remaining BE tech specs to merged-on-main
status: merged
note_merged: reconciled 2026-07-23 — merged_probe matched on main (dc7a0cd) during the docs-tail-0018 slice (which declares this as depends_on); hand-flipped because autopilot-backlog-reconcile greps the WORKING TREE and is unsafe in a feature worktree. Was: ready.
risk: P2
change_class: docs-reconcile
depends_on: [docs-session-management-spec-reconcile]
invariants: []
scope: [docs/autopilot-manifests/docs-0014-merge-status-repo-wide-reconcile.json, docs/features/BE/feature_cross_club_join_tech.md, docs/features/BE/feature_sync_engine_tech.md, docs/features/BE/feature_billing_lifecycle_tech.md, docs/features/BE/feature_connector_onboarding_tech.md, docs/features/feature_connector_onboarding.md, docs/features/BE/feature_session_organize_tech.md, docs/features/BE/feature_zalo_channel_tech.md, docs/features/README.md, docs/autopilot-backlog.md]
manifest: docs/autopilot-manifests/docs-0014-merge-status-repo-wide-reconcile.json
merged_probe: docs/features/BE/feature_zalo_channel_tech.md :: Reconcile 0014 merge-state
notes: Opened by codex review of docs-session-management-spec-reconcile. 0014 (1a6ac38) is merged on main (migrations 0000-0018) but multiple BE tech specs still assert branch-only/unmerged as CURRENT state: feature_user_settings_tech.md:61/65/67 · feature_cross_club_join_tech.md:9 · feature_sync_engine_tech.md:9 (repo-wide grep "0014.*branch-only|dừng ở .0013|chưa merge" before scoping — likely more; README.md:133 is a DATED changelog row = leave as history). Same pattern as the session slice: correct current-state mirrors to merged-on-main; PRESERVE dated changelog/rollout-completion history + reframe (never delete) provenance anchors like origin/main@22c23aa; resolve NO open design questions. COORDINATION: feature_user_settings_tech.md is already dirty in the working tree (another in-flight slice, likely db-session-tenant-integrity-fks) -> this follow-up MUST serialize against whatever owns that file; do not open concurrently on it. Scope EXACTLY the mirror lines per file; fill scope[] after the repo-wide grep. Founder confirm before scoping. Deliberately EXCLUDED from the session slice (F3 defer). EXECUTED 2026-07-23 (branch feat/docs-0014-merge-status-repo-wide-reconcile): folded the 6 BE specs + feature_zalo_channel_tech.md (7th spec, current-state 0014 branch-only -> merged 1a6ac38/tail 0018) + README coverage-index cells + this block; codex round-01 surfaced zalo/README/backlog and founder authorized the fold (Option 1). Tail-only staleness (specs that already treat 0014 as merged but assert a stale tail=0014 / 0015-unmerged) deferred to the block below per founder opt-in.

## task: docs-tail-0018-number-reconcile
title: Reconcile stale migration-tail claims (tail=0014 / 0015-unmerged) to tail=0018 across remaining specs
status: ready
risk: P2
change_class: docs-reconcile
depends_on: [docs-0014-merge-status-repo-wide-reconcile]
invariants: []
scope: [docs/autopilot-manifests/docs-tail-0018-number-reconcile.json, docs/features/BE/feature_identity_tech.md, docs/features/BE/feature_player_view_tech.md, docs/features/BE/feature_security_operations_tech.md, docs/features/BE/feature_tournament_tech.md, docs/standards/BUILD-STATUS.md, docs/features/README.md, docs/autopilot-backlog.md]
manifest: docs/autopilot-manifests/docs-tail-0018-number-reconcile.json
merged_probe: docs/features/BE/feature_identity_tech.md :: Reconcile migration-tail 0018
notes: Opened by codex round-01 of docs-0014-merge-status-repo-wide-reconcile + its repo-wide grep. DISTINCT class from the 0014-merge-state slice: these specs ALREADY treat 0014_players_waitlist as merged but assert a stale CURRENT migration tail. Candidates (backtick-tolerant repo-wide grep at execution time is AUTHORITATIVE; codex round-04 showed the bare grep missed backticked forms: grep -rnE "tail hiện là .?0014_players_waitlist|baseline.*0000.?0014|0015.*chưa merge" docs -- the list below is ILLUSTRATIVE, NOT exhaustive): feature_identity_tech.md:163 ("tail hiện là 0014_players_waitlist.sql"; founder named "identity tail"), feature_tournament_tech.md:134 ("baseline committed tren main = 0000-0014 ... 0015 auth D0a chua merge"), feature_web_auth_onboarding_tech.md:158 (also references 0016/0017), feature_player_view_tech.md:51, feature_security_operations_tech.md:51 -- all identify 0014_players_waitlist.sql as the current tail; expect more per the grep above. Correct current-state tail 0014->0018 (0000-0018 on main incl 0015_auth_revoke_account..0018_oauth_completion_handoff); PRESERVE dated rows; reframe never delete provenance; resolve NO design questions; keep numbering guidance (next monotonic after merged tail). EXCLUDE (history/pinned, not current-state): decisions.md log entries, dd-45/dd-73-78 + dd-remaining-cluster analysis snapshots (@22c23aa point-in-time), slice-readiness-verdicts.md pinned AUTHORITY_SHA verdict, autopilot-templates/*, feature_user_settings_tech.md (separate consent edit). Founder-opt-in: flip status idea->ready to authorize. EXECUTED 2026-07-23 (branch feat/docs-tail-0018-number-reconcile, STOP_AT_READY, NOT merged; reconciled across codex review rounds (durable counters in .autopilot/state regions.log + fix-round-count.txt)): reconciled current-state migration facts across 4 BE specs + BUILD-STATUS — feature_identity_tech (tail:163 + live-schema-range:155) · feature_player_view_tech (:51 + :50) · feature_security_operations_tech (:51 + :50) · feature_tournament_tech:134 (baseline -> 0000-0018; 0015-0018 auth merged-but-NOT-enabled) · BUILD-STATUS:27+:42+Cap-nhat (foundation range kept `0000`-`0014`, global tail `0018`/auth-S4 noted SEPARATELY — anti-double-classify). Plus 4 version bumps + changelog rows (identity v1.12 · player_view v2.4 · security_ops v2.4 · tournament v0.2) + README index cells + manifest scope + this block. DEFERRED: feature_web_auth_onboarding_tech reverted to main UNTOUCHED (its section frames the merged auth lane as pending, a pre-existing self-contradiction vs its own changelog; a tail-only fix contradicts it) -> task block below. Two follow-ups captured as task blocks below: (a) web_auth all-mirrors reconcile; (b) residual live-inventory 0013 + dd-82 sweep. NOTE (anti-double-classify, codex round-03/04): feature_multi_tenant.md:7 / _tech.md:6 + HANDOFF:119 + BUILD-STATUS:145 S3 "migrations 0000-0013" are CORRECT foundation-layer attribution, NOT stale current-state; the sweep excludes them. Pinned/dated/@SHA snapshots + decisions.md log + autopilot-templates + feature_user_settings_tech excluded verbatim.

## task: docs-web-auth-migration-section-merge-state-reconcile
title: Reconcile feature_web_auth_onboarding_tech ALL current-state mirrors (Status/Impl header + intro + migration section) — merged auth lane 0016/0017/0018 still framed as pending
status: idea
risk: P2
change_class: docs-reconcile
depends_on: []
invariants: []
scope: []
manifest: null
merged_probe: null
notes: Discovered by codex rounds 01/03/04 of docs-tail-0018-number-reconcile (2026-07-23). feature_web_auth_onboarding_tech.md is INTERNALLY self-contradictory: its own changelog v2.11 records the Google adapter (0017) + session-rotation (0018) + email STORAGE CORE (0016) as merged, yet the Status/Impl header, intro, and Migration & Rollback section still frame the whole Google/email lane as unbuilt, assert live main=0000-0014, and list the merged objects as 'chua ton tai' / 'Migration moi pending'. tail-0018 slice DEFERRED this (reverted web_auth to main untouched) to avoid half-fixing a Reviewed security-critical auth spec into a contradiction. SCOPE = ALL current-state mirrors in the file; backtick-tolerant repo-wide grep at execution is AUTHORITATIVE (re-derive exact lines then). Key caveats: (1) merged = Google adapter (0017) + rotation (0018), STILL not enabled (GOOGLE_OAUTH_* empty pending Safari/iOS proof), AND email STORAGE CORE only (0016 = tables, zero grants/routes/UI/provider-send) — the email ORDER-4 bundle (routes/UI/send) is UNBUILT (flag OFF); mark ONLY what is actually merged, keep order-4 pending. (2) Anti-double-classify: state global tail 0018 where auth objects belong; do NOT relabel non-auth foundation ranges. PRESERVE dated changelog verbatim; do NOT change DDL/contract; resolve NO design questions; bump version + changelog row. Founder-opt-in: flip idea->ready to authorize.

## task: docs-migration-range-0013-and-dd82-current-state-sweep
title: Reconcile remaining stale current-state live-migration-INVENTORY claims (marketplace_discovery live=0013; dd-82-analysis baseline 0014) to 0000-0018 — EXCLUDE foundation-attribution
status: idea
risk: P2
change_class: docs-reconcile
depends_on: []
invariants: []
scope: []
manifest: null
merged_probe: null
notes: Discovered by codex round-01/03 of docs-tail-0018-number-reconcile (2026-07-23), out of that slice's tail=0014 pattern. Backtick-tolerant repo-wide grep at execution is AUTHORITATIVE; lines below ILLUSTRATIVE, NOT exhaustive. Reconcile ONLY genuinely-stale CURRENT-STATE live-migration-INVENTORY claims (a doc asserting the live/grepped migration set stops at 0013) -> 0000-0018, e.g. feature_marketplace_discovery_tech.md:58 "Grep live packages/db/migrations/ (0000-0013 da merge tren main)". Also dd-82-tournament-analysis.md:144 "baseline hien 0000-0014" -> 0000-0018 (or classify as pinned analysis). CRITICAL anti-double-classification (codex round-03, same rule this slice applied to BUILD-STATUS:27): feature_multi_tenant.md:7 + feature_multi_tenant_tech.md:6 "Implemented (foundation) - migrations 0000-0013", HANDOFF:119 "Foundation merged ... 0000-0013", BUILD-STATUS:145 S3 "14 migration (0000-0013)" are FOUNDATION-LAYER ATTRIBUTION (what the multi-tenant/S3 foundation delivered); migrations 0015-0018 are auth S4, NOT foundation -> do NOT bump these to 0000-0018 (that misclassifies auth as multi-tenant foundation). Leave them 0000-0013 OR add a SEPARATE global-tail note. Do NOT touch dated/@SHA-pinned snapshots. PRESERVE dated rows; reframe never delete provenance; resolve NO design questions. Founder-opt-in: flip idea->ready to authorize.

## task: docs-user-settings-0014-merge-state-reconcile
title: Reconcile stale "0014 branch-only / 0000-0013" claims in feature_user_settings_tech.md to merged (post consent-edit)
status: idea
risk: P2
change_class: docs-reconcile
depends_on: [docs-0014-merge-status-repo-wide-reconcile]
invariants: []
scope: []
manifest: null
merged_probe: null
notes: Split out of docs-0014 (which flips to merged via its own probe) so this correction is not orphaned. feature_user_settings_tech.md:61/65/67 still assert 0014 branch-only / "0000-0013 đã merge" as CURRENT state, but the file is dirty in the working tree (a separate uncommitted consent-state edit, likely db-session-tenant-integrity-fks, owns it). SERIALIZE against whatever owns that file: either (a) that consent-edit slice folds these 3 current-state corrections (0014 -> merged 1a6ac38; tail 0018; keep numbering guidance "next monotonic after synced tail"; preserve dated rows; reframe never delete provenance), or (b) run this after the file is free. Do NOT open concurrently on the file. Founder-opt-in: flip idea->ready once the file is free.

## task: docs-session-publish-contract
title: Define the draft→open publish command contract (validation, idempotency, transition guard)
status: idea
risk: P2
change_class: docs-spec
depends_on: []
invariants: []
scope: []
manifest: null
notes: Opened by AP-25 round-06 create-status reconcile (0dec63b). Create now lands status=draft; Host publish→open (SES-UC-1 v2.12c + state machine §4). The PUBLISH TRANSITION mechanics are undefined: command name/shape, idempotency key, which validations run at publish (discovery fields incl. public finite slots_max E#7? re-check eligibility?), draft→open guard. BLOCKED on founder product input — product-contract decision, not a docs reconcile. NEGATIVE SCOPE: must NOT regress the landed draft-first create (create stays draft; publish is the open transition). Founder confirm contract before scoping.

## task: docs-marketplace-public-capacity-guard
title: Pin public+NULL-slots_max invalid-state projection handling + regression test in marketplace spec
status: idea
risk: P2
change_class: docs-spec
depends_on: []
invariants: []
scope: [docs/features/BE/feature_marketplace_discovery_tech.md]
manifest: null
merged_probe: docs/features/BE/feature_marketplace_discovery_tech.md :: slots_max
notes: Opened by AP-25 round-06 public-capacity reconcile (0dec63b). feature_session_management_tech §2 Capacity×visibility pins public→slots_max NOT NULL (E#7) + fail-closes public+NULL at entry/promotion choke-points, but the PUBLIC PROJECTION of a public+NULL row (legacy/fixture/writer-bypass; DB has no CHECK yet) is deferred to the discovery owner: projector must NOT surface such an invalid row. Add (1) a qualifier: public+NULL skipped/rejected from public projection with audit; (2) a regression test row. Coordinates with the DB CHECK hardening candidate NOT(visibility='public' AND slots_max IS NULL) if that migration is scoped.
