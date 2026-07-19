# Slice Readiness Verdicts — Plexco

> **Đây KHÔNG phải nguồn rule mới.** Rules ở `standards/review-code-readiness-gate.md` (owner-accepted 2026-07-19). File này chỉ **áp dụng** gate đó để ra verdict nhị phân cho các slice gần nhất, dùng đúng template §7 và closure matrix §8.
> **Snapshot pin (bất biến):** `AUTHORITY_SHA = 22c23aab080183913d2852805a085bba1057a91a` (`main`) · verify 2026-07-19. Nhánh làm việc hiện tại `feat/session-waitlist-expand@aa8afae` **không** phải base; mọi verdict pin theo `main`.
> **Live truth đã verify (`main@22c23aa`):** feature layer trống — không có projector source ghi `public_sessions`; không có auth Google/`account_emails` source; `0014_players_waitlist` **không** trên `main`; `0006_discovery.sql` vẫn có `skill_level` và **thiếu** toàn bộ field DD-41 (`session_type`/`level_*_rank`/`gender_restriction`/`age_*`).
> **Current auth refresh (2026-07-20):** `main@9c6e5875cf66b153a7ec58b57c424a23e495c999`; Verdict 5a/5b are current for DD-80 v1.88 working-copy authority. Verdicts 1/3/4 remain historical snapshots only.

---

## Verdict 1 — Auth provider swap, slice đầu (D0 revoke-core + Google adapter)

```text
REVIEW_VERDICT: NOT_PLAN_READY
REVIEWED_AT: 2026-07-19
AUTHORITY_SHA: 22c23aab080183913d2852805a085bba1057a91a
BASE_BRANCH: main
TARGET_FILES:
  - docs/b0-auth-credential-lifecycle-design-probe.md
  - docs/features/feature_web_auth_onboarding.md
  - docs/features/BE/feature_web_auth_onboarding_tech.md
  - docs/features/BE/auth-security-invariant-table.md
SLICE: auth-s4-account-session-core (D0 revoke-core → D1 google-adapter)
IN_SCOPE: shared account/session core; revoke-core; Google OIDC adapter
OUT_OF_SCOPE: email credential bundle (chờ C7); gỡ Telegram-era routes (expand→contract sau)
G1_DECISION: FAIL
G2_SPEC: PARTIAL
G3_DEPENDENCY: PASS
G4_TEST: PARTIAL
G5_SCOPE: FAIL
G6_EXTERNAL: ENABLEMENT_ONLY:C7-email-provider,A3-legal-PII
HARD_DEPENDENCIES: foundation S1–S3 = MERGED (main@22c23aa)
PRIOR_SLICES: none (đây là dependency gốc của feature layer)
OPEN_QUESTIONS_IN_SCOPE: 1
ENABLEMENT_ONLY_GATES: C7 email-provider (chặn email bundle, không chặn Google/revoke); A3 legal-PII (go-live)
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PARTIAL
ACCEPTANCE_MATRIX: FAIL
SECURITY_AND_MIGRATION_GATE: PARTIAL
IMPLEMENTATION_ARTIFACTS: FAIL
FIRST_IMPLEMENTATION_STEP: (blocked)
REMAINING_BLOCKERS:
  - blocker: B0 auth design-probe chưa owner-duyệt và chưa ghi thành DD → authority auth chưa đóng băng (§A1) + open decision ảnh hưởng schema/auth/identity còn mở (§A5)
    owner: owner (duyệt) → mình (ghi DD + author D1 manifests)
    resolution: owner tick "duyệt cả 6" (§3/§3.2/§4/§5/§8/§10) → ghi DD auth-credential-lifecycle vào decisions.md
NEXT_REVIEW_TRIGGER: DD auth-credential-lifecycle committed + D0/D1 autopilot artifacts pushed lên main
```

**Đọc verdict:** đây là candidate **gần code nhất**, nhưng vẫn `NOT_PLAN_READY`. B0 là authority blocker đầu tiên; sau khi owner duyệt vẫn phải author/review D0/D1 slice specs, acceptance matrix và artifacts rồi chạy lại closure 12/12. Chỉ slice pass mới `CODE_READY`; email bundle vẫn `ENABLEMENT_ONLY` chờ C7.

---

## Verdict 2 — `dd41-public-session-projection-fields` (slice #1 của chuỗi share, gate §9)

```text
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-07-19
AUTHORITY_SHA: 22c23aab080183913d2852805a085bba1057a91a
BASE_BRANCH: main
TARGET_FILES:
  - packages/db/migrations/0006_discovery.sql
  - packages/db/schema.ts
  - docs/standards/business-rules.md (BL-DSC-1)
  - docs/features/feature_marketplace_discovery.md
SLICE: dd41-public-session-projection-fields
IN_SCOPE: expand public_sessions whitelist theo BL-DSC-1 (retire skill_level; add session_type/level_*_rank/gender_restriction/age_*); invariant tests; code dark
OUT_OF_SCOPE: projector ghi (DD-12); fence/guarded-view (DD-12); share route (DD-73)
G1_DECISION: PASS
G2_SPEC: FAIL
G3_DEPENDENCY: FAIL
G4_TEST: FAIL
G5_SCOPE: FAIL
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: DD-38/39 person.gender + chat migration = PRIOR_SLICE (chưa merge main)
PRIOR_SLICES: DD-38/39 migration slice (ordering: sau chat/gender, theo DD-41)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS (behavior contract complete; repository closure currently 10/12)
ACCEPTANCE_MATRIX: FAIL
SECURITY_AND_MIGRATION_GATE: PARTIAL
IMPLEMENTATION_ARTIFACTS: FAIL
FIRST_IMPLEMENTATION_STEP: (blocked)
REMAINING_BLOCKERS:
  - blocker: hard dependency DD-38/39 (person.gender + chat) migration chưa trên main → không thể pin expand/contract order + FK
    owner: DD-38/39 migration slice
    resolution: DD-38/39 migration merged vào main (merged probe)
  - blocker: acceptance matrix + autopilot artifacts chưa author (không có manifest/launcher/test table với expected result)
    owner: mình
    resolution: author dd41 slice spec (Product+BE section trong marketplace_discovery) + manifest + acceptance table
NEXT_REVIEW_TRIGGER: DD-38/39 migration merge probe + dd41 autopilot artifacts committed
```

**Đọc verdict:** DD-41 là `DECISION_FINAL` và contract đủ mạnh, nhưng slice `NOT_CODE_READY` vì hard dependency (gender/chat migration) chưa trên `main` và chưa có acceptance matrix/artifacts. Đây là điểm vào của **chuỗi share** — nhưng nằm sau auth trong delivery order.

---

## Trạng thái 5-state cho cụm (không được gộp — gate §2/§9)

| Phạm vi | Trạng thái đúng |
|---|---|
| 6 product decision DD-73..78 | `DECISION_FINAL` ✅ (đạt 2026-07-19) |
| Auth S4 slice đầu | DD-80 G3 decision closed; **D0a `NOT_CODE_READY` pending immutable authority · D0b `NOT_CODE_READY` pending D0a merge** (Verdict 5a/5b) |
| `dd41-public-session-projection-fields` | `NOT_CODE_READY` → chờ DD-38/39 merge + artifacts |
| Toàn cluster DD-73..78 như một slice | `NOT_CODE_READY` (gate §9) |
| DD-76/77 | chỉ xét PLAN/CODE sau product-evidence baseline + owner threshold |

## Chuỗi slice ưu tiên (đồng bộ gate §9 + reality auth-first)

1. **`auth-s4-d0-revoke-core` (D0a)** — DD-80 v1.88 contract closed; commit/push authority first, then manual P0 worktree. **`auth-s4-d0-session-web-boundary` (D0b)** follows only after D0a merged probe.
2. `dd41-public-session-projection-fields` — điểm vào chuỗi share; chặn ở DD-38/39 merge.
3. `dd12-guarded-public-read` — projector + fence + guarded view + grants + projection version.
4. `dd73-session-share-route` — `/s/<id>` + OG/image + join revalidation + telemetry.
5. `dd74-75-activity-intent-projector` — sau allocation owner + dependency.
6. `dd76-77-feed-kudos` — chỉ sau product-evidence baseline + owner threshold.

---

---

## Verdict 3 — `auth-s4-d0-revoke-core` (re-review sau DD-80, 2026-07-19)

> **Superseded 2026-07-20 by Verdict 5a/5b below.** DD-80 v1.88 changes the concurrency contract and
> decomposes the slice; this historical CODE_READY block must not authorize a worktree.
>
> Authority mới: **DD-80 ✅ (decisions v1.77, commit `c1a3957`)** + slice artifacts (`352e6ec`) trên `feat/session-waitlist-expand`. Code-truth base vẫn `main@ca6c97e` (delta so với `22c23aa` là docs-only). Verdict 1/2 giữ nguyên làm lịch sử tại snapshot cũ.

```text
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-19
AUTHORITY_SHA: 352e6ec (feat/session-waitlist-expand; DD-80 tại c1a3957; code-truth main@ca6c97e)
BASE_BRANCH: main
TARGET_FILES:
  - docs/b0-auth-credential-lifecycle-design-probe.md (✅ owner-approved)
  - docs/standards/decisions.md (DD-80 · v1.77)
  - docs/features/BE/feature_web_auth_onboarding_tech.md (v2.8 §3 + acceptance D0)
  - docs/autopilot-manifests/auth-s4-d0-revoke-core.json
SLICE: auth-s4-d0-revoke-core
IN_SCOPE: internal revoke-by-account helper + public wrapper derive-from-current-session + POST /api/auth/logout-all + CSRF + tests + schema mirror B0 §9(a) + CREATE OR REPLACE rotate parent-first + auth_audit_events append-only + export root index.ts (v1.83) + issuance fence session-cookies.ts (reject-and-reauth, không fallback-mint khi rotate null) + partial index web_sessions(account_id) WHERE revoked_at IS NULL trong 0015 (v1.86)
OUT_OF_SCOPE: email lifecycle (D1 bundle, flag OFF); Google/Facebook adapter (D1); Telegram removal; mọi grant mới cho `app` ngoài exact wrapper
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: db-postgres-drizzle-rls + auth-onboarding-v3 = MERGED (main@ca6c97e; dep_checks: auth_revoke_web_session/auth_resolve_web_session/rate_limit_check trong 0012 — verified)
PRIOR_SLICES: none (root của feature layer)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (0012 chỉ có single-token revoke; schema.ts chưa mirror auth_login_nonces/auth_login_state/rate_limit_hits — đúng drift §9(a) mà slice này đóng)
CONTRACT_MATRIX: PASS (behavior contract complete; repository closure currently 9/12)
ACCEPTANCE_MATRIX: PASS (D0-1..D0-13 — D0-11 v1.83, D0-12/D0-13 v1.86 — expected result cụ thể, grant/RLS trên Postgres thật)
SECURITY_AND_MIGRATION_GATE: PASS (migration D0 expand-only + đúng MỘT CREATE OR REPLACE rotate lock-order-only v1.83: helper KHÔNG grant app/app_worker, wrapper không nhận account_id; rollback = DROP function/table/index mới + revoke grant + restore định nghĩa rotate 0012, không data migration; v1.86: partial index expand-only + issuance fence là app-layer change trong scope D0, zero grant mới)
IMPLEMENTATION_ARTIFACTS: PASS (manifest + acceptance matrix + first step)
FIRST_IMPLEMENTATION_STEP: mở worktree `feat/auth-s4-d0-revoke-core` từ main → viết `packages/db/migrations/0015_auth_revoke_account.sql` (internal `auth_revoke_account_sessions` + public wrapper theo B0 §6.1/§6.2 + partial index v1.86) + mirror schema §9(a) → route `/api/auth/logout-all` + issuance fence `session-cookies.ts` (v1.86) → chạy D0-1..D0-13
REMAINING_BLOCKERS: none
```

**RUN precondition (không phải review blocker):** trước khi mở worktree, merge docs authority (`c1a3957` + `352e6ec`, docs-only nội dung) lên `main` để worktree đọc đúng DD-80/manifest/acceptance từ base — theo flow docs-only của `phase1-fable5-7h-PR-RUN.md`.

## Verdict 4 — `auth-s4-d1-google-adapter` (2026-07-19)

> **Superseded for dependency order by DD-80 v1.88.** A fresh D1 verdict must require both D0a
> `auth-s4-d0-revoke-core` and D0b `auth-s4-d0-session-web-boundary` merged; the historical block below
> remains snapshot evidence only.

```text
REVIEW_VERDICT: PLAN_READY
REVIEWED_AT: 2026-07-19
AUTHORITY_SHA: 352e6ec (feat/session-waitlist-expand)
BASE_BRANCH: main
TARGET_FILES:
  - docs/b0-auth-credential-lifecycle-design-probe.md §2/§4/§4.1/§8.2
  - docs/features/BE/feature_web_auth_onboarding_tech.md (v2.8 §3/§4 + acceptance D1)
  - docs/autopilot-manifests/auth-s4-d1-google-adapter.json
SLICE: auth-s4-d1-google-adapter
IN_SCOPE: auth_oauth_transactions + Lax binding cookie; state/nonce/PKCE + OIDC proof matrix; collision table §4 (8 cell); session issue; auth_login_google nhận preallocated account_emails.id cho cell-1 AAD (v1.86, B0 §3.3/§4)
OUT_OF_SCOPE: email bundle (flag OFF); Facebook (DD-33 external gate); email-change/rebind từ Google claim; auto-merge conflict (→DD-53); Telegram removal
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: FAIL (prior slice D0 chưa merge main — dep_check `auth_revoke_account_sessions` trong 0015 chưa tồn tại)
G4_TEST: PASS (acceptance D1-1..D1-15)
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:google-oauth-client-config,A3-legal-PII
HARD_DEPENDENCIES: auth-s4-d0-revoke-core + auth-s4-d1-email-token-core = NOT MERGED (order DD-80 §10; oauth migration = 0017)
PRIOR_SLICES: auth-s4-d0-revoke-core → auth-s4-d1-email-token-core
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: google-oauth-client-config (config, không đổi dark contract); A3-legal-PII (go-live)
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS (0016 expand-only; PKCE bytea + KMS key version; không reuse Strict/same-origin cho callback)
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: (blocked bởi G3)
REMAINING_BLOCKERS:
  - blocker: D0 chưa merge main
    owner: auth-s4-d0-revoke-core
    resolution: D0 merged (dep_check 0015::auth_revoke_account_sessions pass)
NEXT_REVIEW_TRIGGER: D0 merge probe pass → re-run closure D1 (kỳ vọng CODE_READY không cần review mới nếu contract không đổi)
```

## Verdict 5a — `auth-s4-d0-revoke-core` / D0a epoch DB core (2026-07-20)

```text
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-07-20
AUTHORITY_SHA: 9c6e5875cf66b153a7ec58b57c424a23e495c999 (live base; v1.88 authority is an uncommitted working-copy delta)
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md (DD-80 v1.88 working-copy amendment)
  - docs/g3-revoke-all-concurrency-probe-seed.md (v1.0 final contract)
  - docs/b0-auth-credential-lifecycle-design-probe.md (§6 v1.88)
  - docs/features/BE/feature_web_auth_onboarding_tech.md (v2.10 D0a)
  - docs/autopilot-manifests/auth-s4-d0-revoke-core.json
  - docs/autopilot-backlog.md
SLICE: auth-s4-d0-revoke-core
IN_SCOPE: one atomic 0015; account/session epochs; create/resolve/rotate parent locks and revalidation; revoke helper/wrapper; audit materialization; DB exports/docs/tests
OUT_OF_SCOPE: all apps/web changes; D0b cookie/routes; D1 provider/email; Telegram removal; cache; direct protected-table grants
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: db-postgres-drizzle-rls + auth-onboarding-v3 merged on main; D0a is the root dependency
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (0001/0012/0014 live; 0015/epoch/revoke-all absent as expected)
CONTRACT_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS (D0-1/2/6-11/13 + D0-14..22; deterministic Postgres barriers and exact outcomes)
SECURITY_AND_MIGRATION_GATE: PASS (P0 manual-only; one transactional 0015; equality fail-closed; zero direct grants; forward rollback preserves audit and cannot resurrect materialized revokes)
IMPLEMENTATION_ARTIFACTS: FAIL (authority/manifest/backlog changes are local-only and not committed/pushed to main)
FIRST_IMPLEMENTATION_STEP: blocked until the authority baseline is committed/pushed; then create a dedicated manual P0 worktree and register the D0a manifest
REMAINING_BLOCKERS:
  - blocker: Reviewed v1.88 authority and scoped artifacts are not yet immutable on default branch.
    owner: founder/repo maintainer
    resolution: commit and push the exact v1.88 doc/manifest/backlog set, then re-pin AUTHORITY_SHA and verify manifest from origin/main.
NEXT_REVIEW_TRIGGER: origin/main commit containing DD-80 v1.88 + G3 v1.0 + B0 v1.88 + BE v2.10 + D0a manifest/backlog
```

## Verdict 5b — `auth-s4-d0-session-web-boundary` / D0b (2026-07-20)

```text
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-07-20
AUTHORITY_SHA: 9c6e5875cf66b153a7ec58b57c424a23e495c999 (live base; v1.88 authority is an uncommitted working-copy delta)
BASE_BRANCH: main
TARGET_FILES:
  - docs/g3-revoke-all-concurrency-probe-seed.md (v1.0 §4.5-§4.6/§7-§8)
  - docs/features/BE/feature_web_auth_onboarding_tech.md (v2.10 D0b)
  - docs/autopilot-manifests/auth-s4-d0-session-web-boundary.json
  - docs/autopilot-backlog.md
SLICE: auth-s4-d0-session-web-boundary
IN_SCOPE: issueSession stale-cookie reject-and-reauth; two live caller mappings/tests; logout-all route/CSRF/cookie clear/tests
OUT_OF_SCOPE: DB schema/migrations/functions/grants; providers; general error framework; tenant APIs; UI
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: FAIL
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: auth-s4-d0-revoke-core D0a NOT MERGED (dep probes 0015::auth_revoke_all_web_sessions and auth.ts::revokeAllWebSessions absent)
PRIOR_SLICES: auth-s4-d0-revoke-core
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (current issueSession still fallback-mints; two live callers identified; logout-all route absent)
CONTRACT_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS (D0-3..5/12 + G3-B1..B5)
SECURITY_AND_MIGRATION_GATE: PASS (P0 manual-only; no migration in D0b; account derived server-side; generic errors and redaction pinned)
IMPLEMENTATION_ARTIFACTS: FAIL (manifest/backlog local-only; D0a dependency absent)
FIRST_IMPLEMENTATION_STEP: blocked
REMAINING_BLOCKERS:
  - blocker: D0a DB epoch core is not merged on origin/main.
    owner: auth-s4-d0-revoke-core
    resolution: D0a merged probes pass on origin/main and D0b authority artifacts are committed/pushed.
NEXT_REVIEW_TRIGGER: origin/main contains D0a merged probes; then re-run D0b closure against current callers
```

## Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
| 20/07/2026 | v0.7 | DD-80 v1.88 closes Gate 3 with exact epoch equality, cross-account parent ordering/revalidation and atomic row materialization/count/audit; historical Verdict 3 superseded. Added fail-closed Verdict 5a/5b for D0a DB core and D0b web boundary; both await immutable authority, and D0b also awaits D0a merge. |
| 19/07/2026 | v0.6 | **v1.86 (AP-26 HALT MAX_ROUNDS/Codex round-03):** Verdict 3 amend — D0 thêm issuance fence `session-cookies.ts` (reject-and-reauth, không fallback-mint khi rotate null) + partial index `web_sessions(account_id) WHERE revoked_at IS NULL` trong 0015 (case D0-12/D0-13, tech v2.9b); giữ CODE_READY. Verdict 4 note — `auth_login_google` nhận preallocated `account_emails.id` cho cell 1 (AAD §3.3 giữ nguyên); giữ PLAN_READY. |
| 19/07/2026 | v0.5 | **v1.83 (AP-26 HALT v2):** Verdict 3 amend — migration D0 thêm rotate parent-first replace (đóng deadlock), auth_audit_events tạo tại D0 (order-2 reuse), scope thêm packages/db/src/index.ts. Verdict giữ CODE_READY với wording rollback mới; số migration theo tail thực tế (tech v2.9). |
| 19/07/2026 | v0.4 | **v1.78 corrections:** Verdict 4 thêm hard dependency order-2 `auth-s4-d1-email-token-core` (manifest mới, dark) + oauth migration dời 0017; D1-15 absence-check; PKCE lifecycle CHECK theo v1.78. Verdict 3 (D0) không đổi. |
| 19/07/2026 | v0.3 | **B0 → DD-80 ✅ (v1.77):** thêm Verdict 3 (`auth-s4-d0-revoke-core` = **CODE_READY**, authority `352e6ec`) + Verdict 4 (`auth-s4-d1-google-adapter` = PLAN_READY chờ D0 merge). Artifacts: 2 manifest + acceptance D0×10/D1×15 trong web_auth tech v2.8. RUN precondition: merge docs authority lên main trước khi mở worktree. |
| 19/07/2026 | v0.2 | **Reframe theo canonical gate.** Bỏ framework G1–G6 tự chế (trùng `review-code-readiness-gate.md`); đổi tên `ready-to-code-gate.md` → `slice-readiness-verdicts.md`; thay bằng verdict §7 pinned SHA `main@22c23aa` cho auth-s4 (NOT_PLAN_READY, chờ B0) và dd41 (NOT_CODE_READY, chờ DD-38/39 merge). |
| 19/07/2026 | v0.1 | (retired) 6-condition gate tự chế — superseded bởi canonical gate. |
