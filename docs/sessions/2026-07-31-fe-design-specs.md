<!-- review-readiness: historical -->

# Session inventory — FE design specs, 2026-07-31

> **Classification:** Historical session log only. Not a readiness assessment, design gate, implementation plan, or authorization to edit/build `design.pen`.
> **Repository snapshot used for this reconciliation:** `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4`

## Outcome inventory

The session created a designer-readable projection layer for Plexco:

- 12 FE design specs under [`../channels/web/FE/`](../channels/web/FE/)
- 1 reusable FE spec template at [`../templates/feature-dev/fe-spec-template.md`](../templates/feature-dev/fe-spec-template.md)
- 1 historical comparison at [`../channels/web/docs_comparison.md`](../channels/web/docs_comparison.md)
- this session inventory
- 3 dependent contract mirrors reconciled in place:
  [`feature_home.md`](../features/feature_home.md),
  [`feature_home_tech.md`](../features/BE/feature_home_tech.md) and
  [`feature_player_view.md`](../features/feature_player_view.md)
- 1 separate non-authorizing workflow discussion:
  [`level3.1-design-discussion.md`](../autopilot-templates/level3.1-design-discussion.md)

The repo currently contains 24 Product feature docs and 24 BE companion docs. The FE files do not replace those contracts; each FE spec pins its sources, runtime state and negative scope.

## FE spec inventory

### Foundation

| File | Surface |
|---|---|
| [`feature_auth_fe.md`](../channels/web/FE/feature_auth_fe.md) | Landing/auth provider composition and email lifecycle target |
| [`feature_onboarding_fe.md`](../channels/web/FE/feature_onboarding_fe.md) | Club, bank and connector onboarding |
| [`feature_dashboard_fe.md`](../channels/web/FE/feature_dashboard_fe.md) | Host dashboard shell; aggregate zones remain contract-gated |
| [`feature_sessions_fe.md`](../channels/web/FE/feature_sessions_fe.md) | Session CRUD, roster and payment-status projection |
| [`feature_payments_fe.md`](../channels/web/FE/feature_payments_fe.md) | Ledger/reconciliation target surfaces |

### Host management

| File | Surface |
|---|---|
| [`feature_members_fe.md`](../channels/web/FE/feature_members_fe.md) | Membership list, identity merge and Left status/history boundary; host transition omitted |
| [`feature_settings_fe.md`](../channels/web/FE/feature_settings_fe.md) | Tenant settings plus separate person-self settings |

### Player, discovery and communication

| File | Surface |
|---|---|
| [`feature_marketplace_fe.md`](../channels/web/FE/feature_marketplace_fe.md) | Public discovery/join projection |
| [`feature_player_view_fe.md`](../channels/web/FE/feature_player_view_fe.md) | Person-self clubs, sessions, charges and join requests |
| [`feature_home_fe.md`](../channels/web/FE/feature_home_fe.md) | Authenticated PWA composition |
| [`feature_chat_fe.md`](../channels/web/FE/feature_chat_fe.md) | In-app club chat/DM target |
| [`feature_notifications_fe.md`](../channels/web/FE/feature_notifications_fe.md) | Closed-set Inbox/notification target |

## Required interpretation

- `FE design status: Draft` is not `PLAN_READY`.
- A Reviewed Product/BE source does not make its FE projection runtime.
- ASCII wireframes may include visual fixtures; explicit contract-gap/placeholder labels control implementation.
- `design.pen` is outside this session inventory and requires its own tracked artifact review and owner authorization.
- Current readiness must be recomputed from live repository truth using [`../standards/review-code-readiness-gate.md`](../standards/review-code-readiness-gate.md); no score or status from this session carries forward.

## File count

This inventory covers 12 FE specs, one FE template, one comparison file, this session file, three dependent contract mirrors and one workflow discussion: 19 repository documents. External/global skill artifacts mentioned during the original session are outside this repository count and are not certified here.

_Historical session inventory · 2026-07-31 · no active verdict_
