# Autopilot — invariant catalog (canonical domain tokens) · Plexco

Token domain chuẩn cho `invariants:` trong manifest (`docs/autopilot-manifests/<feature>.json`) +
registry `.autopilot/INFLIGHT.md`. `scripts/autopilot-scope-gate register` validate token với danh sách
này; token lạ → **HALT INVARIANT_UNKNOWN** (chống synonym drift). Chi tiết cơ chế: `docs/autopilot-parallel-scope-gate.md`.

## Quy tắc
- Chọn token TỪ danh sách này. Domain mới → thêm 1 dòng vào block `catalog` trước, rồi mới dùng.
- 1 token = 1 khái niệm domain (không phải 1 file). Hai feature share token = chạy **tuần tự**.
- Token machine-read nằm giữa `<!-- catalog:start -->` … `<!-- catalog:end -->`; mỗi dòng `token — mô tả`
  (script lấy phần trước ` — `). Token = `[a-z][a-z0-9_-]*`.

## Canonical tokens (Plexco — refine khi codebase lớn lên)

Block dưới có 2 nhóm:

1. **8 token vận hành Level 3 (global, KHÔNG được xoá).** Kit v11 trở đi bắt buộc — thiếu bất kỳ token
   nào thì `autopilot-init.sh` / `autopilot-update.sh` **HALT `INVARIANT_CATALOG_GLOBALS_MISSING`**.
   Chúng khoá các vùng *cơ chế* (contract, kit, review, merge…) chứ không phải domain nghiệp vụ.
2. **Token domain của Plexco** — phần bên dưới, tự do refine.

> **DD-37 (v3.4):** kênh phase-1 = **Zalo + Facebook Messenger** (bỏ Telegram). `transport-telegram` giữ lại (archived) để không vỡ validator/manifest cũ; slice kênh mới dùng `transport-zalo` + `transport-messenger`.

<!-- catalog:start -->
# --- Level 3 operational globals (required by kit v11+; do not remove) ---
workflow-authority — task-contract and Level-3 operating-policy changes
kit-integrity — shared scripts, templates, versions and consumer rollout
risk-policy — action/surface risk derivation and autonomy lane
terminal-lifecycle — READY/AWAIT/HALT, recovery and cleanup
review-integrity — independent review, breaker and readiness evidence
delegation-safety — worktree, writer ownership and child-agent boundaries
audit-integrity — task evidence, provenance and learning history
merge-authority — landing and optional separately-authorized automation
# --- Plexco project domains ---
schema — Supabase/Postgres tables, migrations, RLS policies
auth — authentication / authorization / session / Supabase auth
billing — subscription/billing lifecycle (feature_billing_lifecycle)
money-model — payment amounts / settlement / fees / balances
identity — member/account identity link/merge (feature_identity)
cross-club — cross-club join logic (feature_cross_club_join)
marketplace — marketplace discovery / listing (feature_marketplace_discovery)
core-api — shared backend API contract consumed by web + bots
transport-telegram — Telegram bot adapter — ARCHIVED (DD-37: bỏ khỏi phase-1; giữ token để không vỡ manifest cũ)
transport-zalo — Zalo bot adapter, phase-1 P2 (docs/channels/zalo, src zalo)
transport-messenger — Messenger bot adapter, phase-1 P2.5 (docs/channels/messenger, src messenger)
web-app — web frontend (docs/web-app, src web)
shared-core — transport/UI-agnostic compute shared by ≥2 channels
i18n-surface — user-facing strings / translations
design-tokens — web-app design tokens (shared styling source)
api-contract — public/request-response shapes, versioning
test-chain — test runner registration / CI test list
build-config — package manifest / lockfile / tsconfig / bundler
infra — App Platform specs, deploy workflows, Dockerfile/entrypoint, DB provisioning scripts
reliability — attendance / no-show / reliability score + deprioritize policy per-tenant (DD-42)
member-safety — manual safety ban: reason/evidence/expiry/actor/capability `member.ban` (DD-52)
retry-liveness — CAS/lease worker ownership, claimed-attempt budget, DLQ / owner-review sink (DD-45)
publish-suspend-gate — session `PublishSession` billing-suspension authorization gate (`authorizeTenantAction('publish_new_sessions')` × billing Status Authority, feature_session_management §4 × feature_billing_lifecycle §3)
session-lock-ordering — session command transaction/row-lock ordering discipline (`FOR UPDATE` + re-check-under-lock, feature_session_management §4)
session-command — SessionService command family sharing `packages/db/src/session-service.ts` (create/publish/update/close/cancel/announce); one writer at a time across the file, distinct from `session-lock-ordering` (in-transaction discipline) and `publish-suspend-gate` (one specific gate)
billing-authz — billing/authorization suspension contract: the `ActionClass` enum + recognised-set in `packages/db/src/authorization.ts` × Suspended Action Matrix rows in feature_billing_lifecycle §3 (DD-110 owns the current four session literals)
actor-recheck-under-lock — tenant-capability-authority's authorize() actor/grant row FOR SHARE lock inside the caller's own command transaction (DD-56 amendment #1 clause 4, feature_tenant_routing_authz_tech §4); acquires before session-lock-ordering's FOR UPDATE in the same transaction once the seven session routes switch to authorize()
<!-- catalog:end -->
