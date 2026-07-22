# Autopilot backlog — task registry for parallel planning · Plexco

Feature/task cần làm, ghi machine-scannable để bot quét ra **task nào chạy song song được**. Khác
`.autopilot/INFLIGHT.md` (runtime, task đang chạy ngay lúc này).

## Cách bot quét
Đọc block `## task:` có `status: planned|ready` (bỏ `idea` chưa scope, bỏ `in-flight|merged`).
Hai task song song được ⟺ **cả ba**: `scope` (file) rời nhau · `invariants` (domain, từ
`docs/autopilot-invariant-catalog.md`) rời nhau · không cái nào `depends_on` cái kia mà cái kia chưa merge.
Đây đúng luật `scripts/autopilot-scope-gate`. ⚠️ `scope`/`invariants` của task `idea` là **ước lượng** —
refine (grep code thật) trước khi promote thành manifest.

## Lifecycle
`idea` → `planned` (scope rõ + chọn invariants) → tạo manifest → `ready` → `register` → `in-flight` → merge → `merged`.

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
status: idea | planned | ready | in-flight | merged
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
status: ready
risk: P2
change_class: docs-provider-evidence
depends_on: []
invariants: [build-config]
scope: [docs/standards/environments-setup.md]
manifest: docs/autopilot-manifests/infra-egress-compatibility-evidence.json
merged_probe: docs/standards/environments-setup.md :: DD04_EGRESS_EVIDENCE_CLOSED
notes: Launcher-ready docs-only AP-22 slice. Record current attributable evidence for each outbound API, distinguish outbound source-IP requirements from inbound webhook verification, and fail closed on any missing/ambiguous row. Scope explicitly excludes App Specs, workflows, code, config, migrations, secret handling and provider mutation. One P2 FULL-base Codex clean round, manual merge, STOP_AT_READY. Contract: `docs/autopilot-infra-egress-compatibility-evidence.md`.

## task: infra-inbound-webhook-auth-evidence
title: Inbound webhook verification contract evidence for SePay, ApiPay, Zalo and Meta
status: ready
risk: P2
change_class: docs-provider-evidence
depends_on: []
invariants: [api-contract]
scope: [docs/standards/webhook-verification-matrix.md]
manifest: docs/autopilot-manifests/infra-inbound-webhook-auth-evidence.json
merged_probe: docs/standards/webhook-verification-matrix.md :: WEBHOOK_AUTH_EVIDENCE_CLOSED
notes: Launcher-ready docs-only AP-23 slice (opposite direction from AP-22 egress). Document the INBOUND webhook verification contract per provider — signature header, algorithm, raw-body vs parsed, replay/timestamp window — from current official docs; never handle secret VALUES. Fail closed on any ambiguous row. One P2 FULL-base Codex clean round, manual merge, STOP_AT_READY. Contract: `docs/autopilot-infra-inbound-webhook-auth-evidence.md`.

## task: infra-provider-limits-evidence
title: Messaging limits and tier evidence for Zalo Bot, Meta Messenger, SePay and ApiPay
status: ready
risk: P2
change_class: docs-provider-evidence
depends_on: []
invariants: [build-config]
scope: [docs/standards/provider-limits-evidence.md]
manifest: docs/autopilot-manifests/infra-provider-limits-evidence.json
merged_probe: docs/standards/provider-limits-evidence.md :: PROVIDER_LIMITS_EVIDENCE_CLOSED
notes: Launcher-ready docs-only AP-24 slice. Record current attributable messaging limits/tier gates (Zalo free-tier caps, Messenger 24h window + App Review, SePay/ApiPay tiers), re-verifying any figure currently in gtm-doi-soat-decision.md. Evidence only — no pricing/GTM/capacity decision, no invention. Fail closed on ambiguity. Shares `build-config` with the egress slice → run them sequentially, not in parallel. One P2 FULL-base Codex clean round, manual merge, STOP_AT_READY. Contract: `docs/autopilot-infra-provider-limits-evidence.md`.

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
title: D1 google-adapter implementation packet + DD-38/39 readiness (split 2/2 from AP-26 monolith)
status: planned
risk: P2
change_class: docs-traceability
depends_on: [auth-s4-d0-revoke-core, auth-s4-d0-session-web-boundary]
invariants: [auth, schema]
scope: [docs/auth-d1-implementation-packet.md]
manifest: docs/autopilot-manifests/docs-auth-d1-packet.json
merged_probe: docs/auth-d1-implementation-packet.md :: AUTH_D1_PACKET_COMPLETE
notes: HOLD — not launcher-ready until both D0a and D0b merged probes exist on origin/main. AP-28 remains a P2 docs-only preparation slice, but its preflight and manifest now pin DD-80 v1.88, tech v2.10, verdicts v0.7 and the two live D0 dependencies. The D1-specific v1.86 AAD/audit obligations remain unchanged; re-audit citations against the then-current committed base before authoring the packet.

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
status: ready
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
status: planned
risk: P0
change_class: manual-auth-boundary
depends_on: [auth-s4-d1-google-adapter]
invariants: [auth, api-contract]
scope: [docs/autopilot-manifests/auth-s4-d1b-oauth-session-rotation.json, apps/web/lib/session-cookies.ts, apps/web/lib/session-cookies.test.ts, apps/web/app/api/auth/google/callback/route.ts, apps/web/app/api/auth/google/callback/route.test.ts, docs/features/BE/feature_web_auth_onboarding_tech.md]
manifest: docs/autopilot-manifests/auth-s4-d1b-oauth-session-rotation.json
merged_probe: apps/web/lib/session-cookies.ts :: completion hop
notes: **BLOCKER ON ENABLING GOOGLE LOGIN** — must land before `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` are set in ANY environment, not merely "the next slice". Until then Google login stays fail-closed (503) so the residual risk is not live. **Residual risk it closes:** a `SameSite=Strict` session cookie is not sent on the cross-site OAuth callback, so D1 mints fresh (per matrix D1-2/D1-13) and a **pre-login session survives Google login un-invalidated**; an attacker holding that older token keeps it. The capture-at-`/state` + revoke-at-callback workaround was tried and **rejected in D1**: non-atomic, races logout-all (new P1 at round-06), and still misses when `/state` itself is entered cross-site. **Shape:** add a SAME-SITE completion hop after the callback lands — a first-party navigation does carry the Strict cookie, so the existing atomic rotate primitive at the D0/session layer can do the rotation in one transaction. Solve it where the primitive lives instead of fighting a browser invariant inside the OAuth adapter. **NOT CODE_READY:** acceptance rows still to be authored + a policy-1.3 verdict required (see `acceptance_obligation` in the manifest). P0 manual, no launcher.

## task: core-matcher-grouped-amount-parsing
title: splitNameAmount misparses grouped trailing amounts with a non-zero final group
status: planned
risk: P2
change_class: bugfix
depends_on: []
invariants: [money-model, shared-core]
scope: [docs/autopilot-manifests/core-matcher-grouped-amount-parsing.json, packages/core/src/payments-logic.ts, packages/core/src/payments-logic.test.ts]
manifest: docs/autopilot-manifests/core-matcher-grouped-amount-parsing.json
merged_probe: packages/core/src/payments-logic.test.ts :: Wang 110 500
notes: Codex core-lift-v3 round-05 — manual `/transfer`/`/cash` args using spaces
  as thousands separators misparse when the final group is non-zero, e.g.
  "Wang 110 500" -> {name:"Wang 110", amount:500} instead of amount 110500.
  Founder-approved 2026-07-05 to merge core-lift-v3 without fixing this round
  (per the class-aware review gate: NL-parsing P2, not auth/money-authoritative
  — matcher output is proposal-only, S7/S15 settle money via manual-allocate or
  exact pay_code, never this function directly). Fix shape: the shortest-run
  scan in splitNameAmount needs to also try LONGER trailing runs when a
  shorter one parses, not just accept the first (shortest) match — same
  family as round-01's "shortest-run amount split" fix, so extend that
  decision table rather than patching in isolation. This is the 15th
  cumulative NL-parsing finding across core-lift v1/v2/v3 — before starting,
  re-read DECISIONS.md S2/S2b/S2c entries; a 16th quick patch risks the same
  REGION_THRASH pattern that parked this branch three times already.

## task: db-migration-0000-idempotent-role-create
title: migration 0000 CREATE ROLE is non-atomic — real race, currently masked by serial test config
status: idea
risk: P0
change_class: manual-schema-design
depends_on: []
invariants: [schema]
scope: []
notes: DESIGN_UNFIT as previously scoped: `0000` is already applied and immutable, while canonical v0.6.0 also classifies migration scope as P0 manual-only. Re-scope manually around migration-runner/bootstrap serialization or another forward-safe mechanism; never edit `0000_roles_extensions.sql` in place. Original evidence from Codex auth-onboarding-v3 round-08: migration 0000's role creation for
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
