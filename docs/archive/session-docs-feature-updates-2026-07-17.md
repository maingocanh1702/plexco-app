<!-- review-readiness: historical -->

# Docs & Feature Docs Update Ledger — Sessions 2026-07-17

> **Generated:** 2026-07-17  
> **Primary workspace:** `/Users/maingocanh/Projects/Plexco app`  
> **Source tasks:** `019f6ec3-6154-7661-b1e3-f8113451f7c1`, `019f6efb-0a40-7170-bb27-81fb68a4e2cf`, and the current continuation  
> **Baseline:** local `HEAD = main = local origin/main = 21e42ea` before these uncommitted docs changes; no fetch was performed while producing this ledger.
>
> **Postscript 2026-07-18:** đây là historical ledger. Current authority đã lên decisions v1.47: DD-33/DD-60 accepted; DD-57..59 deferred; DD-61..64 accepted-in-principle (Session Organize v0.5, no runtime); DD-69 accepted direction. Khi body bên dưới nói “proposal/pending owner”, dòng đó chỉ mô tả snapshot 17/07 và đã superseded.
>
> **Postscript 2026-07-28:** ledger tiếp tục chỉ là historical evidence. Live authority/status nay ở
> `decisions.md`, `HANDOFF.md`, `BUILD-STATUS.md` và `ROADMAP.md` tại `main@784bc8d`; không dùng baseline,
> WIP state hoặc task chronology bên dưới để suy ra runtime/readiness hiện hành.

## 1. Scope and status semantics

This file records every documentation artifact updated in the requested task history and distinguishes where each change actually lives.

| Status | Meaning |
|---|---|
| **Audit-only** | The task reviewed files and produced findings but did not edit them. |
| **Candidate / HALT** | At the recorded snapshot, the change existed only in a feature worktree and was never current `main` truth. The identity-link worktree below no longer exists; its verified recovery patch is archived separately and remains non-authoritative. |
| **Current local docs** | At the recorded snapshot, the change existed in the Plexco root working tree on `main`, but was not staged, committed or pushed. |
| **Merged external repo** | At the recorded snapshot, the documentation change had been committed and pushed in another repository. |

Important identity note: **“session này” is not a third task UUID**. The active task is still `019f6efb-0a40-7170-bb27-81fb68a4e2cf`; the current continuation only creates this ledger after the feature-doc closure turn. It is listed separately below to preserve the requested chronology without double-counting the same task.

“Docs updated” does **not** mean the corresponding runtime, schema or migration has been implemented. Each section states the implementation boundary explicitly.

## 2. Task `019f6ec3-6154-7661-b1e3-f8113451f7c1` — account-link and channel security

### 2.1 Audit-only turn

The first turn was read-only. It found that `main@21e42ea` had specifications and partial schema scaffolding but no Messenger/Zalo webhook-to-link-to-session runtime. The main design gaps were:

1. Zalo identities could collide if `from.id` is endpoint-scoped rather than global.
2. Zalo route/connector secrets and Messenger App Secret had incorrect ownership/storage boundaries.
3. `link_code` lacked complete issuer proof, terminal lifecycle and concurrency enforcement in live schema/runtime.
4. Ingress/join still needed raw-body signature verification, strict payload validation, server-derived tenant/person context and one shared idempotent join core.

No file was edited in that audit turn.

### 2.2 Candidate P0 worktree updates — not merged

The follow-up attempted a manual P0 security slice in:

`/Users/maingocanh/Projects/Plexco app/.autopilot/worktrees/identity-link-security-core`

> ⚠️ **Cập nhật 2026-07-19 — tại thời điểm đó candidate là bản duy nhất và không được git bảo vệ.**
>
> - **Không còn là git worktree.** `.git/worktrees/identity-link-security-core` đã biến mất → `git -C <dir> status` trả `fatal: not a git repository`. `git worktree list` báo *prunable* chính vì lý do này.
> - **Không recover được từ branch.** Branch `feat/identity-link-security-core` vẫn ở `21e42ea` và **chỉ có `0000–0013`**; toàn bộ 27 file candidate chưa từng được commit.
> - **Git không nhìn thấy thư mục.** `.gitignore:56` có `.autopilot/*`, nên nội dung không nằm trong bất kỳ commit/stash/reflog nào.
> - ⇒ Tại snapshot 19/07, delta 27 file candidate chưa nằm trong branch/stash/reflog và worktree là bản làm việc duy nhất.
>
> ⚠️ **Supersession 2026-07-27:** thư mục candidate không còn trên đĩa và chưa từng merge, nhưng recovery
> artifact đã được track trên `main`: [`docs/archive/identity-link-security-core-candidate-2026-07-19.patch`](identity-link-security-core-candidate-2026-07-19.patch).
> `docs/archive/README.md` xác nhận patch apply lên `21e42ea` tái tạo byte-for-byte đúng 27 file candidate.
> Patch chỉ là bằng chứng phục hồi, **không phải authority/readiness/runtime**; muốn revive phải đi từ
> default branch hiện tại, đánh số migration monotonic mới và review lại toàn bộ slice. Các path trong
> hai bảng dưới đây chỉ là historical path, không phải link còn mở được.

Tại snapshot 2026-07-19, candidate từng dựa trên commit `21e42ea`, không có feature commit và có staged
changes. Slice dừng ở `HALT MAX_ROUNDS`; đến 2026-07-27 worktree gốc đã mất khỏi disk nhưng delta còn
được bảo toàn trong patch archive nêu trên. Mọi item trong subsection này vẫn chỉ là
**historical candidate record**, không phải current source.

#### Feature-doc candidates

| Feature | Product candidate | BE candidate | Candidate update |
|---|---|---|---|
| Feature index | Historical path: `.autopilot/worktrees/identity-link-security-core/docs/features/README.md`; `v2.13` content update, no bump | — | Marked the proposed identity/channel security baseline and migration dependency. |
| Channel Booking Funnel | Historical path: `.autopilot/worktrees/identity-link-security-core/docs/features/FE/feature_channel_booking_funnel.md`; `0.4 → 0.5` | No BE companion | Mirrored provider-scoped channel keys and protected connector-secret ownership. |
| Connector Onboarding | Historical path: `.autopilot/worktrees/identity-link-security-core/docs/features/FE/feature_connector_onboarding.md`; `0.5 → 0.6` | Historical path: `.autopilot/worktrees/identity-link-security-core/docs/features/BE/feature_connector_onboarding_tech.md`; `0.2 → 0.3` | Replaced raw Zalo routing token/inline secrets with HMAC lookup, secret-free metadata and narrow KMS-backed accessors. |
| Identity | Historical path: `.autopilot/worktrees/identity-link-security-core/docs/features/FE/feature_identity.md`; `1.4 → 1.5` | Historical path: `.autopilot/worktrees/identity-link-security-core/docs/features/BE/feature_identity_tech.md`; `1.3 → 1.4` | Added provider-endpoint-scoped identity, row-locked issuer/person proof, terminal link-code lifecycle and protected secret boundary. |
| Notifications | Product unchanged | Historical path: `.autopilot/worktrees/identity-link-security-core/docs/features/BE/feature_notifications_reminders_tech.md`; `2.2 → 2.3` | Required exact provider-scope plus user hash for owner-alert recipient lookup; removed ambiguous two-part lookup. |
| Player Messenger | Historical path: `.autopilot/worktrees/identity-link-security-core/docs/features/FE/feature_player_messenger.md`; `0.3 → 0.4` | Historical path: `.autopilot/worktrees/identity-link-security-core/docs/features/BE/feature_player_messenger_tech.md`; `0.2 → 0.3` | Split Page-scope and user HMAC, moved Page token/App Secret to their intended boundaries, and pinned one-way account linking. |
| Tenant Routing/AuthZ | Historical path: `.autopilot/worktrees/identity-link-security-core/docs/features/FE/feature_tenant_routing_authz.md`; `2.3 → 2.4` | Historical path: `.autopilot/worktrees/identity-link-security-core/docs/features/BE/feature_tenant_routing_authz_tech.md`; `2.2 → 2.3` | Added token-HMAC routing, endpoint scope and protected secret accessor rules. |
| Web Auth/Onboarding | Historical path: `.autopilot/worktrees/identity-link-security-core/docs/features/FE/feature_web_auth_onboarding.md`; `2.5 → 2.6` | BE unchanged | Made onboarding write HMAC metadata and protected credentials through a narrow service. |
| Zalo Channel | Product unchanged | Historical path: `.autopilot/worktrees/identity-link-security-core/docs/features/BE/feature_zalo_channel_tech.md`; `2.1 → 2.2` | Added secret-free routing metadata, provider-scoped identity, KMS rotation and verify-before-dispatch rules. |

#### Other documentation candidates

| File | Candidate update |
|---|---|
| Historical path: `.autopilot/worktrees/identity-link-security-core/docs/00-start-here/identity-model.md` | Added the “v3.5 security boundary”: endpoint-scoped identity, link-code issuer/lifecycle and connector-secret ownership. |
| Historical path: `.autopilot/worktrees/identity-link-security-core/docs/channels/messenger/messenger-channel-design.md` | `v2.1 → v2.2`; mirrored Page-scoped identity, raw-body webhook verification and App-vs-Page secret ownership. |
| Historical path: `.autopilot/worktrees/identity-link-security-core/docs/channels/zalo/README.md` | `v0.4 → v0.5`; mirrored HMAC route lookup, encrypted current/pending credentials and fail-closed rotation. |
| Historical path: `.autopilot/worktrees/identity-link-security-core/docs/product/PRD.md` | `v2.5 → v2.6`; propagated the proposed secure link and channel behavior into user flows. |
| Historical path: `.autopilot/worktrees/identity-link-security-core/docs/product/TDD.md` | `v2.6 → v2.7`; propagated three-part identity keys, link-code invariants and secret-table architecture. |
| Historical path: `.autopilot/worktrees/identity-link-security-core/docs/standards/BUILD-STATUS.md` | Recorded candidate migration `0014`, 55 migrated tables, 15 migrations and the 53-table mirror while keeping channel/link runtime pending. Migration authority has since advanced through `0024`; if the candidate is revived from the verified archive patch, it must use the next monotonic migration number then available rather than reuse `0014`. |
| Historical path: `.autopilot/worktrees/identity-link-security-core/packages/db/ERD.md` | Mirrored 55 SQL tables, 78 physical FKs, 53 diagrammed tables and link-code lock ordering. |
| Historical path: `.autopilot/worktrees/identity-link-security-core/packages/db/README.md` | Documented candidate global-protected identity/link/secret tables and grants. |
| Historical path: `.autopilot/worktrees/identity-link-security-core/packages/db/db.dbml` | Mirrored the proposed physical schema for diagramming. |

#### Why the candidate did not become authority

- Worktree scope: **27 staged files**: 19 files under `docs/`, 3 DB documentation/model mirrors, `.env.example`, and 4 migration/schema/test files.
- Latest stated gates: format, lint, typecheck and **50/50 DB security tests** passed.
- A prior full-suite pass was not on the final snapshot and was correctly not counted as final proof.
- Round 6 found that `messenger_page_secrets` still accepted empty ciphertext/KMS-version values.
- Fixing that would have required fix round 6, exceeding the hard `>5` breaker, so the slice wrote `HALT-MAX_ROUNDS.txt` and stopped without commit/merge.

The later root-doc closure in task `019f6efb…` re-expressed many of these intended contracts, but **did not merge or implement this worktree's migration/schema/runtime**.

## 3. Task `019f6efb-0a40-7170-bb27-81fb68a4e2cf` — full feature-doc review and closure

### 3.1 Initial review turn — audit-only

The first pass reviewed all **22 Product/System specs + 21 BE specs** against decisions, schema/migrations, runtime, tests and provider contracts. It made no edits and reported these material groups:

- **P1:** endpoint-scoped Identity/Notifications/TDD drift; Messenger App Secret ownership; unproven Zalo namespace; stale DD-49 rejoin behavior; `create_dm()` safety bypass; missing Assistant DLP; Session Organize winning-point correction and active-SSE revocation gaps.
- **P2:** stale SePay auth contract; already-resolved block-user question; Tenant Routing legacy/target mixing; link-code mirror disagreement.

The verification baseline was green (`lint`, `typecheck`, `format`, production build and 223 tests), but that only proved the implemented foundation/auth baseline—not the unimplemented feature contracts.

### 3.2 Fix turns — local Plexco docs at the 2026-07-17 snapshot

The follow-up closure updated **75 Markdown files before this ledger was added**:

- **73 tracked modified:** `+2,426 / -1,257`.
- **2 new untracked Session Organize specs:** 879 lines total.
- **No code, schema, migration, config or test file changed.**
- Changes are on the root `main` working tree but are **not staged, committed or pushed**.

#### Feature index and complete changed feature inventory

[The feature index](../features/README.md) moved **`v2.13 → v2.22`** and now records 22 Product/System specs, 21 BE specs, 21 pairs plus one intentional product-only draft. The following table lists every changed feature doc.

| Feature | Product version/path | BE version/path | Consolidated closure |
|---|---|---|---|
| Channel Booking Funnel | [Product](../features/FE/feature_channel_booking_funnel.md) `0.4 → 0.6` | No BE companion | Delegates complete XOR issuer, terminal lifecycle and atomic consume to Identity; remains intentional product-only Draft. |
| Club Assistant | [Product](../features/FE/feature_club_assistant.md) `0.5 → 0.9` | [BE](../features/BE/feature_club_assistant_tech.md) `0.5 → 0.9` | DLP before embedding/retrieval, generation-safe re-ingest, quarantine, canonical Chat reuse, provider-attempt/cache truth and self-contained future migration; remains Draft until formal promotion and DD-18 go-live gate. |
| Connector Onboarding | [Product](../features/FE/feature_connector_onboarding.md) `0.5 → 0.8` | [BE](../features/BE/feature_connector_onboarding_tech.md) `0.2 → 0.5` | Exact SePay timestamp/raw-body HMAC and explicit fallback; ApiPay enterprise-first provisioning with owner-selected BYO fallback, durable idempotency and secret-free responses. |
| Cross-club Join | [Product](../features/FE/feature_cross_club_join.md) `2.5 → 2.6` | [BE](../features/BE/feature_cross_club_join_tech.md) `2.4 → 2.5` | Separates source Page from target tenant and uses opaque, bounded, replay-safe cross-club actions. |
| Identity | [Product](../features/FE/feature_identity.md) `1.4 → 1.7` | [BE](../features/BE/feature_identity_tech.md) `1.3 → 1.7` | Three-part endpoint identity, exact Page/bot-OA relation, reachability by `channel_identity_id`, XOR link issuer and terminal-first consume; preserves tenant-private Zalo RLS. Runtime/migration remain pending. |
| In-app Chat | [Product](../features/FE/feature_inapp_chat.md) `0.5 → 0.7` | [BE](../features/BE/feature_inapp_chat_tech.md) `0.11 → 0.14` | Canonical `chat_members`, guarded create/send/read/mark/SSE, shared block source, no direct user DML and executable parent candidate keys with cross-tenant regression contracts. |
| Marketplace Discovery | [Product](../features/FE/feature_marketplace_discovery.md) `2.0 → 2.2` | [BE](../features/BE/feature_marketplace_discovery_tech.md) `2.0 → 2.1` | Replaces invalid time-dependent index guidance, pins intentional no-FK public reference, fail-closed owner alias and deterministic ranking boundary. |
| Multi-tenant | [Product](../features/FE/feature_multi_tenant.md) `1.5 → 1.7` | [BE](../features/BE/feature_multi_tenant_tech.md) `1.2 → 1.4` | Generalizes endpoint-scoped identity/reachability to Messenger and Zalo while keeping target-tenant authorization separate. |
| Notifications & Reminders | [Product](../features/FE/feature_notifications_reminders.md) `2.3 → 2.5` | [BE](../features/BE/feature_notifications_reminders_tech.md) `2.2 → 2.5` | Exact endpoint/one-route delivery, restored delivery tenant, same-tenant intent FK and endpoint derivation from immutable identity. Runtime migration remains pending. |
| Payment Reconcile | [Product](../features/FE/feature_payment_reconcile.md) `1.6 → 1.7` | [BE](../features/BE/feature_payment_reconcile_tech.md) `1.6 → 1.8` | Exact provider-verifier delegation plus executable same-tenant/same-session ledger FKs and reversal-to-original-charge integrity. |
| Player Messenger | [Product](../features/FE/feature_player_messenger.md) `0.3 → 0.5` | [BE](../features/BE/feature_player_messenger_tech.md) `0.2 → 0.4` | Hybrid central plus optional tenant Page, shared host/player surface, opaque actions, Page-scoped identity, App-Secret/Page-token split and canonical DD-49 rejoin outcomes. |
| Security & Operations | [Product](../features/FE/feature_security_operations.md) `2.1 → 2.2` | [BE](../features/BE/feature_security_operations_tech.md) `2.1 → 2.2` | Separates per-Page token rotation from the single deployment-level Meta App Secret rollover and blast radius. |
| Session Management | [Product](../features/FE/feature_session_management.md) `2.8 → 2.9a` | [BE](../features/BE/feature_session_management_tech.md) `2.5 → 2.7` | Messenger create parity and durable wizard; restores live `skill_level`/non-negative price DDL contract; adds a bounded pointer to Organize without expanding Reviewed scope. |
| Session Organize | [New Product](../features/FE/feature_session_organize.md) `v0.4` — 219 lines | [New BE](../features/BE/feature_session_organize_tech.md) `v0.4` — 660 lines | Proposal for two-side court/match orchestration, participant stints, append-only point/reversal ledger, bounded terminal-point correction, four assignment modes, session-scoped grants and SSE re-auth ≤30s. **DD-61..64 remain proposal; no runtime exists.** |
| Sync Engine | [Product](../features/FE/feature_sync_engine.md) `2.1 → 2.3` | [BE](../features/BE/feature_sync_engine_tech.md) `2.1 → 2.3` | Canonical command/outbox/surface keys, ordered aggregate sequence and endpoint-bound one-route/no-broadcast behavior for Messenger and Zalo. |
| Tenant Routing/AuthZ | [Product](../features/FE/feature_tenant_routing_authz.md) `2.3 → 2.6` | [BE](../features/BE/feature_tenant_routing_authz_tech.md) `2.2 → 2.5` | Separates endpoint/default context from target-tenant authority, labels Telegram DDL as legacy and normalizes tenant-vs-identity link-code contracts. |
| User Settings | [Product](../features/FE/feature_user_settings.md) `0.6 → 0.8` | [BE](../features/BE/feature_user_settings_tech.md) `0.5 → 0.7` | Uses canonical `price_male`/`price_female` beside base price, removes competing storage path and reuses canonical `chat_blocks`. |
| Web Auth/Onboarding | [Product](../features/FE/feature_web_auth_onboarding.md) `2.5 → 2.8` | [BE](../features/BE/feature_web_auth_onboarding_tech.md) `2.3 → 2.5` | One readiness predicate, central Messenger as platform default, optional tenant Page/Zalo, and ApiPay enterprise as default bank-provisioning path. |
| Zalo Channel | [Product](../features/FE/feature_zalo_channel.md) `2.1 → 2.2` | [BE](../features/BE/feature_zalo_channel_tech.md) `2.1 → 2.2` | Exact bot/OA-scoped identity/reachability, separate target-tenant authorization and canonical carry-over/refunded/review rejoin matrix. |

#### Reviewed feature docs that did not need a file update

| Feature/support doc | Current versions/status |
|---|---|
| Billing Lifecycle | Product `v2.7`; BE `v2.6` — reviewed, unchanged. |
| Player Telegram | Product/BE `v2.1` — archived by DD-37, unchanged. |
| Player View | Product/BE `v2.2` — reviewed, unchanged. |
| Auth/security invariant table | `v1.0` — support matrix reviewed, unchanged. |

#### Authority, core and status docs — all 18 changed files

| File | Version/update |
|---|---|
| [HANDOFF](../00-start-here/HANDOFF.md) | Updated canonical versions, DD-61..68 status and explicit docs-vs-runtime boundary. |
| [Identity model](../00-start-here/identity-model.md) | Mirrored endpoint-scoped identities/reachability, link issuer/lifecycle and secret ownership. |
| [BRD](../product/BRD.md) | `v3.7 → v3.9b`; propagated feature-doc closure without claiming implementation. |
| [PRD](../product/PRD.md) | `v2.5 → v2.8`; synchronized channel, identity, Assistant, chat, provider and Organize flows. |
| [TDD](../product/TDD.md) | `v2.6 → v3.1`; synchronized executable target contracts and pending-migration boundary. |
| [ROADMAP](../product/ROADMAP.md) | `v2.9 → v3.3`; reflected Messenger hybrid work and proposal-only Organize dependencies. |
| [CRM Dashboard BRD](../product/CRM_DASHBOARD_BRD.md) | `v1.4 → v1.10`; synchronized feature-index and authority references. |
| [Decisions](../standards/decisions.md) | `v1.40 → v1.45`; added DD-61..64 as proposals, DD-65..68 as accepted decisions, and closed contract drift for Identity, Chat, Assistant, rejoin, SePay and Organize. |
| [Business rules](../standards/business-rules.md) | `v1.8 → v1.14`; mirrored current rules while keeping Organize rules inactive until owner acceptance. |
| [BUILD-STATUS](../standards/BUILD-STATUS.md) | Updated to feature index `v2.22`, 22 Product/System + 21 BE specs and unchanged implementation baseline. |
| [API reference convention](../standards/api-reference-convention.md) | `v0.1 → v0.2`; aligned envelope/error/auth formatting with live conventions. |
| [Core DB architecture principles](../standards/core-db-architecture-principles.md) | `v1.2 → v1.3`; added provider-endpoint identity/reachability invariant. |
| [Feature dependency graph](../standards/feature-dependency-graph.md) | `v1.3 → v1.7`; synchronized current roadmap and marked Organize dependency-only/proposal. |
| [Frontend architecture](../standards/frontend-architecture.md) | `v0.1 → v0.3`; reconciled live API envelope and retained proposal status. |
| [DD-04 hosting brief](../decisions/analysis/dd-04-hosting-decision-brief.md) | Refreshed canonical decision authority pointer to `v1.45`. |
| [DD-48 profile visibility analysis](../decisions/analysis/dd-48-profile-visibility-analysis.md) | Reduced stale “5 open items” to the 3 items not already closed by DD-55. |
| [Founder decision brief](../decisions/briefs/founder-decision-brief-2026-07-15.md) | Marked as historical input and pointed to current `v1.45` authority. |
| [Pre-code open items](../probes/pre-code-open-items-2026-07-16.md) | Refreshed authority, proposal/build gates and Session Organize status. |

#### Channel and UX mirrors — all 5 changed files

| File | Version/update |
|---|---|
| [Messenger README](../channels/messenger/README.md) | `v0.4 → v0.6`; hybrid central/tenant Page, shared roles and current identity/secret boundaries. |
| [Messenger channel design](../channels/messenger/messenger-channel-design.md) | `v2.1 → v2.4`; complete hybrid routing, wizard, opaque actions, endpoint reachability and one-route contract. |
| [Web design brief](../channels/web/design-brief.md) | `v1.1 → v1.6`; synchronized authority and feature-index `v2.22`. |
| [Web UX sync design](../channels/web/ux-sync-design.md) | `v0.2 → v0.3`; aligned canonical command/surface mapping and channel roles. |
| [Zalo README](../channels/zalo/README.md) | `v0.4 → v0.5`; exact bot/OA identity/reachability, HMAC routing and secret boundary. |

#### Automation and autopilot mirrors — all 4 changed files

- [Automation playbook](../automation/playbook.md)
- [Product backlog](../automation/product-backlog.md)
- [Phase1 Fable5 run template](../autopilot-templates/phase1-fable5-RUN.md)
- [Phase1 Fable5 orchestrator template](../autopilot-templates/phase1-fable5-orchestrator.md)

These files now point at current authority and mirror the Messenger hybrid/shared-surface slices, protected target resolution, durable wizard, endpoint-scoped identity and one-route delivery contract. They do not mark the runtime as implemented.

#### Proposal, research and strategy mirrors — all 10 changed files

| File | Update |
|---|---|
| [Club AI bot knowledge base](../proposals/club-ai-bot-knowledge-base.md) | Reworked into a reconciled historical proposal `v0.7`; removed parallel Chat/membership DDL and implementation-authority claims. |
| [Global KB and autosync](../proposals/plexco-global-kb-and-kb-autosync.md) | Pointed to Club Assistant `v0.9`, canonical Chat and self-contained future migration rules. |
| [QR/paycode early rollout](../proposals/qr-paycode-early-rollout.md) | Added current channel identity/reachability and authority warning to historical examples. |
| [Single-club bot port map](../proposals/single-club-bot-port-map.md) | Added current DD-50/DD-40/DD-67 authority boundary. |
| [Player-side SaaS audit](../research/player-side-saas-AUDIT.md) | Marked old channel examples historical and mirrored endpoint identity plus current SePay auth. |
| [Player-side SaaS reconciliation](../research/player-side-saas-reconciliation.md) | Added explicit endpoint-identity and SePay-HMAC supersession notes. |
| [Base chat package feasibility](../strategy/base-chat-package-feasibility.md) | Marked Page-per-club-only analysis historical after DD-65..68 hybrid decision. |
| [GTM reconciliation decision](../strategy/gtm-doi-soat-decision.md) | Refreshed current authority/version references. |
| [Native app strategy](../strategy/native-app-strategy.md) | `v1.2 → v1.4`; synchronized current authority while retaining P7 strategy boundary. |
| [SaaS implementation plan](../strategy/saas-implementation-plan.md) | Marked body as historical analysis where it conflicts with `v1.45` and current feature contracts. |

### 3.3 Verification recorded for the root docs closure

- Inventory: **139 Markdown files**, 44 local links/anchors checked.
- Coverage/shape: **22 Product/System + 21 BE specs**; fences, required sections, duplicate use-case IDs and **45 version references** passed.
- Repository gates: `git diff --check`, `pnpm format:check`, `pnpm lint` and `pnpm typecheck` passed.
- GitNexus change detection: **LOW risk**, **0 affected execution flows**.
- The PostgreSQL/full application suite was not rerun after the final docs-only edits; no code/runtime delivery is claimed.
- Intentional remaining gates: ApiPay enterprise provider proof, DD-18 Assistant go-live, DD-61..64 owner acceptance and Organize prerequisites, plus existing B0/B1/B2/B3, external/legal and FE visual-source gates.

## 4. Current continuation — ledger plus post-review closure

This continuation is part of task `019f6efb-0a40-7170-bb27-81fb68a4e2cf`. It first created:

- **New file:** `docs/archive/session-docs-feature-updates-2026-07-17.md` (this ledger).

After that initial snapshot, five tracked docs received follow-up contract edits:

- `docs/features/BE/feature_cross_club_join_tech.md`
- `docs/features/BE/feature_multi_tenant_tech.md`
- `docs/features/BE/feature_sync_engine_tech.md`
- `docs/features/BE/feature_zalo_channel_tech.md`
- `docs/strategy/gtm-doi-soat-decision.md`

The subsequent review-fix closure reconciled the four detected drifts across these ten tracked docs:

| Area | Updated docs | Closure |
|---|---|---|
| Zalo secret lifecycle | `features/FE/feature_zalo_channel.md` `2.2 → 2.3`; `features/BE/feature_zalo_channel_tech.md` `2.2 → 2.3`; `channels/zalo/README.md` `0.5 → 0.6` | Replaces legacy plaintext target with KMS ciphertext, backfill-or-disable/drop/no-dual-read; accepts `connecting` only with ciphertext, uses CAS for early events/finalization and atomically promotes/discards both rotation credentials. |
| Connector authority | `features/FE/feature_connector_onboarding.md` `0.8 → 0.9`; `features/BE/feature_connector_onboarding_tech.md` `0.5 → 0.6` | Distinguishes live `0004` from the forward security migration; corrects the sample to `webhookSecretEnc`; pins one state+ciphertext decision table, no `active→registered` downgrade, one-time analytics and focused unit/E2E regressions. |
| Live schema truth | `features/BE/feature_multi_tenant_tech.md` `1.4 → 1.5`; `features/BE/feature_sync_engine_tech.md` `2.3 → 2.4` | Mirrors the live `sessions` table exactly and records command/outbox uniqueness as existing migration `0005` truth rather than a new rollout migration. |
| Canonical mirrors/status | `product/TDD.md` v3.1; `standards/BUILD-STATUS.md`; `features/README.md` v2.22 | Propagates the Zalo security/live-vs-target and CAS lifecycle boundary, preserves implementation-pending status and refreshes every affected version reference within the still-uncommitted v2.22 closure batch. |

At the closure snapshot, the Plexco root working tree contained **73 tracked modified docs (`+2,565 / -1,338`) + 3 untracked docs** (the two Session Organize specs plus this ledger). It contained no code/schema/migration/config/test changes from task `019f6efb…`; the SQL/pseudocode/tests in these specs were target implementation contracts, not an implemented migration/runtime.

Post-review verification for this closure passed: `git diff --check`, full-repo Prettier, lint and typecheck; 140 Markdown files/141 local links had zero missing targets, unbalanced fences or affected feature-version mismatches; the stale connector-contract sweep found zero legacy `secret` writes, broad `status <> active` flips, connecting-state blanket rejects or single-secret rotation promotion wording.

## 5. Cross-repo documentation update logged inside task `019f6efb…`

The user also supplied a successful `ap-land` log for `/Users/maingocanh/Projects/bestminton-club-chatbot`. It is separate from the Plexco inventory but is included here so the requested session ledger is complete.

| Repository/file | Status | Update |
|---|---|---|
| `bestminton-club-chatbot/docs/autopilot-backlog.md` | **Merged external repo** — commit `da08073` pushed to `origin/main` | `clawbot-ai-facade-split` changed `ready → merged` and gained an auto-reconciled `note_merged`. |

Context only: the associated code refactor landed at `84f5f88`; worktree, feature branch and scope reservation were removed. Railway deployment was triggered if the repo auto-deploys from `main`, but actual deployment health was not verified in these Plexco tasks.

## 6. Consolidated truth at the 2026-07-18 closure snapshot

Current truth is the 27/07 supersession at the top of this ledger plus `HANDOFF.md`, `BUILD-STATUS.md` and
`ROADMAP.md`; the numbered list below is retained only as the closure snapshot.

1. **Current authority (postscript 18/07):** decisions `v1.47/DD-69`, BRD `v3.9d`, PRD `v2.8b`, TDD `v3.1`, ROADMAP `v3.3b`, business rules `v1.16`, feature index `v2.23`.
2. **Plexco implementation truth did not advance in these docs turns.** The root change is documentation-only; migrations/services/adapters/projectors described by the specs remain pending unless they already existed before this review.
3. **Session Organize is accepted-in-principle, not implemented.** Its `v0.5` Product/BE files do not prove runtime; build remains post-P4 after Session CRUD/Sync and DD-56 registry/grant prerequisites.
4. **The original `identity-link-security-core` slice HALTed and never merged; its worktree is now gone.** A byte-for-byte verified recovery patch is tracked under `docs/archive/`, but remains non-authoritative; its migration/schema/test candidates must not be cited as current `main` behavior.
5. **At this closure snapshot, no Plexco file in this ledger had been staged, committed or pushed by the docs-closure task.**
6. **The Clawbot backlog reconciliation is different:** it was committed and pushed at `da08073`.
