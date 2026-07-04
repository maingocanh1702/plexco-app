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
> S16 reminders-auto → S17 TG → S18 Zalo → S19 club-assistant → S20 polish; chừa Messenger — Meta App
> Review). Posture `FULL_AUTO_MONEY: yes` → mọi slice tự merge sau 2× Codex clean; guard cứng: không
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
notes: docs/web-app/. Frontend riêng → thường DISJOINT với backend feature (song song tốt) trừ khi đụng core-api/i18n.
