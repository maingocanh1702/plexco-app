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

> **DD-37 (v3.4):** kênh phase-1 = **Zalo + Facebook Messenger** (bỏ Telegram). `transport-telegram` giữ lại (archived) để không vỡ validator/manifest cũ; slice kênh mới dùng `transport-zalo` + `transport-messenger`.

<!-- catalog:start -->
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
reliability — attendance / no-show / reliability score + deprioritize policy per-tenant (DD-42)
member-safety — manual safety ban: reason/evidence/expiry/actor/capability `member.ban` (DD-52)
retry-liveness — CAS/lease worker ownership, claimed-attempt budget, DLQ / owner-review sink (DD-45)
<!-- catalog:end -->
