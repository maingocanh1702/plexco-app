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

> **Phase-1 build (Fable 5) — FULL LAUNCH:** send-file orchestrator ở
> `docs/autopilot-templates/phase1-fable5-orchestrator.md` chạy backlog 20 slice tuần tự
> (S1 monorepo → S2 core-lift → S3 db-RLS → S4 auth → S5 session → S6 sync-engine → S7 reconcile →
> S8 identity-merge → S9-S12 web PWA + marketplace → S13 cross-club → S14 billing → S15 host-pro-auto →
> S16 reminders-auto → **S17 Zalo → S18 Messenger** (Telegram bỏ khỏi phạm vi — DD-37; Messenger cần Meta
> App Review) → S19 club-assistant → S20 polish). Posture `FULL_AUTO_MONEY: yes` → mọi slice tự merge sau 2× Codex clean; guard cứng: không
> merge khi còn finding tiền chưa sạch → HALT `FOUNDER_MERGE_GATE`. S19 có DD-gate (DD-16..28 phải ✅).
> Các task idea dưới đây là feature-level (tham chiếu chéo với backlog orchestrator).

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
risk: P1
change_class: auth-feature
depends_on: []
invariants: [auth, identity, schema, build-config]
scope: []
notes: DD-13/DD-37 + `docs/features/feature_web_auth_onboarding.md` + `docs/features/BE/auth-security-invariant-table.md`. Auth v3 Telegram-era is already merged; this is a provider-port, not a greenfield auth rewrite. **NOT launcher-ready:** run live impact/prescan, pin password credential schema + provider adapter boundary, then author manifest/slice doc/launcher before register. Preserve fail-closed SI-1..SI-8 and remove `TELEGRAM_BOT_TOKEN` only after route/test replacement lands.

## task: feature-identity
title: Account/member identity (link, merge, claim) — nền cho mọi feature khác
status: idea
risk: P1
change_class: identity-feature
depends_on: []
invariants: [identity, schema, auth]
scope: []
notes: docs/features/feature_identity.md. Đụng schema+auth → nền tảng, ưu tiên land sớm + standalone (de-risk dependents).

## task: feature-billing-lifecycle
title: Subscription / billing lifecycle
status: idea
risk: P1
change_class: billing-feature
depends_on: [feature-identity]
invariants: [billing, money-model, schema]
scope: []
notes: docs/features/feature_billing_lifecycle.md. Tiền → fail-closed + single-source paid/balance (xem autopilot-invariants).

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
status: ready
risk: P1
change_class: build-config
depends_on: [monorepo-scaffold, db-postgres-drizzle-rls]
invariants: [build-config, schema]
scope: [.github/workflows/deploy.yml, infra/app.prod.yaml, infra/app.staging.yaml, infra/fly.toml, docs/standards/environments-setup.md]
manifest: docs/autopilot-manifests/infra-do-app-vpc-deployment.json
merged_probe: infra/app.prod.yaml :: ^name:[[:space:]]+plexco-prod$
notes: Launcher-ready P1 slice; canonical prompt v0.6.0. Pre-flight MUST close DD-04 §7.1 with primary-source evidence for SePay/ApiPay/Zalo/Messenger. Any fixed-egress requirement → HALT DESIGN_UNFIT before authoring DO App Specs and re-slice bounded Fly fallback; never disable VPC silently. Green path creates prod+ephemeral-staging App Specs from one immutable image (web/discovery/worker), component-scoped DB roles/URLs, no migration credential in runtime, and a manual/approval-gated deploy workflow whose one-shot migration runs before pg-boss provisioning. Read isolation is Day-1; read-only node remains trigger-based. Full contract: `docs/autopilot-infra-do-app-vpc-deployment.md`.

## task: core-matcher-grouped-amount-parsing
title: splitNameAmount misparses grouped trailing amounts with a non-zero final group
status: planned
risk: P2
change_class: bugfix
depends_on: []
invariants: [money-model, shared-core]
scope: [packages/core/src/payments-logic.ts, packages/core/src/payments-logic.test.ts]
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
status: planned
risk: P2
change_class: schema-bugfix
depends_on: []
invariants: [schema]
scope: [packages/db/migrations/0000_roles_extensions.sql]
merged_probe: packages/db/migrations/0000_roles_extensions.sql :: EXCEPTION[[:space:]]+WHEN[[:space:]]+duplicate_object
notes: Codex auth-onboarding-v3 round-08 — migration 0000's role creation for
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
