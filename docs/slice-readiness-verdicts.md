<!-- review-readiness: enforce -->
# Slice Readiness Verdicts — Plexco

> **Đây KHÔNG phải nguồn rule mới.** Rules ở `standards/review-code-readiness-gate.md` (owner-accepted 2026-07-19). File này chỉ **áp dụng** gate đó để ra verdict nhị phân cho các slice gần nhất, dùng đúng template §7 và closure matrix §8.
> **Snapshot pin (bất biến):** `AUTHORITY_SHA = 22c23aab080183913d2852805a085bba1057a91a` (`main`) · verify 2026-07-19. Nhánh làm việc hiện tại `feat/session-waitlist-expand@aa8afae` **không** phải base; mọi verdict pin theo `main`.
> **Live truth đã verify (`main@22c23aa`):** feature layer trống — không có projector source ghi `public_sessions`; không có auth Google/`account_emails` source; `0014_players_waitlist` **không** trên `main`; `0006_discovery.sql` vẫn có `skill_level` và **thiếu** toàn bộ field DD-41 (`session_type`/`level_*_rank`/`gender_restriction`/`age_*`).
> **Current auth refresh (2026-07-20):** `origin/main@033ccc8fd9c3f247abf8aa0cb5a0f48b96d006e2` — DD-80 v1.88 authority bundle immutable on main. **Verdict 5a (D0a) = CODE_READY** (re-pinned 033ccc8); Verdict 5b (D0b) `NOT_CODE_READY` pending D0a merge. Verdicts 1/3/4 remain historical snapshots only.
> **D0a IMPLEMENTED & MERGED (2026-07-20):** slice `auth-s4-d0-revoke-core` squash-merged to `main` (migration `0015` live). The P0 "2 consecutive FULL-base Codex clean" gate was **NOT reached** after 12 rounds (10 real findings fixed incl. round-06 epoch-vs-`revoked_at` P1; round-11 self-caught + `git revert`ed) → merge is a **documented owner override** resting on manual review + acceptance coverage 22/22 + real-Postgres 97/97, **not** an automated clean-round pass. See `.autopilot/state/auth-s4-d0-revoke-core/HALT-MAX_ROUNDS.txt` + the squash commit. **Verdict 5b (D0b) unblocks** once the D0a squash lands on origin/main.
> **D0b IMPLEMENTED & MERGED (2026-07-22):** slice `auth-s4-d0-session-web-boundary` squash-merged to `main@93c5404` (issuance fence + logout-all route; zero DB change). Unlike D0a, the P0 **"2 consecutive FULL-base Codex clean rounds" gate was MET** (round-03/04, only 2 fix rounds) — **no owner override**. Real-Postgres suite green (db 97/97 unchanged · core 111 · bot 3 · web 78). Recorded as **Verdict 6**. Next in chain: `auth-s4-d1-email-token-core`.
> **Machine classification (2026-07-22):** `<!-- review-verdict: historical -->` controls immutable blocks; unmarked blocks are current for their own pinned slice/snapshot. **Verdict 15** (historical) recorded DD-87 as owner-decided but `NOT_CODE_READY` solely because its authority packet was uncommitted WIP outside `main@6a28072`; that packet is now committed and pushed (`main@142e9fa`+), so **Verdict 16** re-pins it `CODE_READY` at `main@827d24d`. Neither supersedes unrelated active candidates.

---

## Verdict 1 — Auth provider swap, slice đầu (D0 revoke-core + Google adapter)

<!-- review-verdict: historical -->
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
REVIEW_POLICY_VERSION: 1.3
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
CLOSURE_MATRIX: FAIL (10/12)
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
| Auth S4 slice đầu | DD-80 G3 decision closed; **D0a MERGED @ `main@8f493f7` (owner override) · D0b MERGED @ `main@93c5404` (gate ĐẠT)** — Verdict 5a/5b lịch sử, **Verdict 6** ghi kết quả D0b. Kế tiếp: `auth-s4-d1-email-token-core` |
| `dd41-public-session-projection-fields` | `NOT_CODE_READY` → chờ DD-38/39 merge + artifacts |
| Toàn cluster DD-73..78 như một slice | `NOT_CODE_READY` (gate §9) |
| DD-76/77 | chỉ xét PLAN/CODE sau product-evidence baseline + owner threshold |

## Chuỗi slice ưu tiên (đồng bộ gate §9 + reality auth-first)

1. ~~`auth-s4-d0-revoke-core` (D0a)~~ ✅ merged `8f493f7` · ~~`auth-s4-d0-session-web-boundary` (D0b)~~ ✅ merged `93c5404` (gate ĐẠT). **Kế tiếp: `auth-s4-d1-email-token-core`** (order-2, code dark) → `auth-s4-d1-google-adapter`.
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

<!-- review-verdict: historical -->
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

<!-- review-verdict: historical -->
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

<!-- review-verdict: historical -->
```text
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-20 (re-pinned after authority push)
AUTHORITY_SHA: 033ccc8fd9c3f247abf8aa0cb5a0f48b96d006e2 (v1.88 authority bundle immutable on origin/main)
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md (DD-80 v1.88, committed 033ccc8)
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
IMPLEMENTATION_ARTIFACTS: PASS (v1.88 authority + D0a manifest/backlog committed & pushed at origin/main@033ccc8)
FIRST_IMPLEMENTATION_STEP: create a dedicated manual P0 worktree from origin/main@033ccc8, register the D0a manifest (scope-gate), then author one atomic 0015_auth_revoke_account.sql migration + Drizzle mirror + tests
REMAINING_BLOCKERS: none — sole blocker (authority immutability) resolved at origin/main@033ccc8; all G1–G6, closure/contract/acceptance/security gates already PASS
NEXT_REVIEW_TRIGGER: D0a implementation slice (0015 migration + tests) merged to main → re-run for build/test evidence; D0b (Verdict 5b) unblocks only after D0a merge
```

## Verdict 5b — `auth-s4-d0-session-web-boundary` / D0b (2026-07-20)

<!-- review-verdict: historical -->
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

## Verdict 6 — `auth-s4-d0-session-web-boundary` / D0b implemented & merged (2026-07-22)

<!-- review-verdict: historical -->
```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: 93c5404c0f59db4ce744568b642b55f52bfa19cf
BASE_BRANCH: main
TARGET_FILES:
  - apps/web/lib/session-cookies.ts
  - apps/web/app/api/auth/logout-all/route.ts
  - apps/web/app/api/auth/telegram/callback/route.ts
  - apps/web/app/api/onboarding/start/route.ts
SLICE: auth-s4-d0-session-web-boundary
IN_SCOPE: issueSession stale-cookie reject-and-reauth fence (SessionReauthRequiredError); typed 401 AUTH_INVALID mapping at the two live callers; POST /api/auth/logout-all with CSRF-before-mutation, server-side account derivation and cookie clear; tests
OUT_OF_SCOPE: DB schema/migrations/functions/grants (D0a owns them); providers; general error framework; tenant APIs; UI; Telegram removal
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: auth-s4-d0-revoke-core D0a MERGED (main@8f493f7c18627e6730ba9f1f4090ecfe4e389b0f; probes 0015::auth_revoke_all_web_sessions and auth.ts::revokeAllWebSessions present)
PRIOR_SLICES: auth-s4-d0-revoke-core
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (8 files changed, all apps/web; zero packages/db delta)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (D0-3/4/5/12 + G3-B1..B5; +13 web tests 65->78, each tagged 1:1; logout-all exercised against a real throwaway Postgres)
SECURITY_AND_MIGRATION_GATE: PASS (no migration; CSRF validated before any mutation; account derived server-side, never from body; no raw token/hash/CSRF/PII in logs or responses; revoked-null branch returns 401 without clearing a possibly freshly rotated cookie)
IMPLEMENTATION_ARTIFACTS: PASS (manifest + acceptance mapping + STOP_AT_READY sentinel)
FIRST_IMPLEMENTATION_STEP: n/a — implemented and squash-merged at main@93c5404
REMAINING_BLOCKERS: none
```

**Đọc verdict:** khác D0a, **gate P0 "2 FULL-base Codex clean rounds liên tiếp" ĐÃ ĐẠT** (round-03/04, chỉ 2 fix round) → merge **không phải owner override**. Hai finding đã fix đều là P2 thật: round-01 (clear cookie ở nhánh `revoked===null` có thể xoá cookie vừa rotate → spurious logout; sửa thành 401-không-clear) và round-02 (test env `??=` với `TELEGRAM_BOT_TOKEN` rỗng làm route trả 503 sớm). Residual đã chấp nhận: nhánh `revoked===null` là race thuần cần 2 connection — semantics đã được test deterministic ở **tầng DB trong D0a** (barrier D0-7/17/18 + regression round-06), web layer chỉ map kết quả.

---

## Verdict 7 — `auth-s4-d1-email-token-core` / D1 order-2 (2026-07-22)

> **Superseded by Verdict 8 (same day):** this block's authorization was consumed — the slice is
> implemented. Kept as the record of what authorized the worktree.

<!-- review-verdict: historical -->
```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: fc7d0a41b50269a734a9cd74626469e2e9be385b
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/b0-auth-credential-lifecycle-design-probe.md
  - docs/features/BE/feature_web_auth_onboarding_tech.md
  - docs/autopilot-manifests/auth-s4-d1-email-token-core.json
  - packages/db/schema.ts
  - packages/db/src/auth.ts
SLICE: auth-s4-d1-email-token-core
IN_SCOPE: account_emails + email_password_credentials + auth_pending_email_registrations + auth_email_tokens + auth_email_deliveries storage with exact constraints/partial indexes; email normalization/artifact derivation; _auth_assert_password_phc validator + constraint trigger; internal parent-first helper _auth_consume_email_token with the §5.2 lock hierarchy; cleanup/retention; schema.ts mirror + catalog tests; reuse of auth_audit_events created at D0
OUT_OF_SCOPE: public auth_verify_email/auth_reset_password/auth_finalize_email_login (order-4); all email routes/UI; pg-boss enqueue wiring and provider send (order-4, C7 gated); auth_oauth_transactions and Google adapter (order-3); DD-70(a) inbox fence (no global-emitting path exists at order-2); Telegram removal
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:C7-email-provider,A3-legal-PII
HARD_DEPENDENCIES: auth-s4-d0-revoke-core MERGED (main@8f493f7) + auth-s4-d0-session-web-boundary MERGED (main@93c5404); dep probes 0015::auth_revoke_account_sessions and logout-all/route.ts::revokeAllWebSessions present on origin/main
PRIOR_SLICES: auth-s4-d0-revoke-core -> auth-s4-d0-session-web-boundary
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: C7 email-provider idempotency/DPA proof (blocks order-4 delivery + flag ON, not this dark core); A3 legal-PII (go-live)
LIVE_REPO_VERIFICATION: PASS (migration tail on main is 0015 so 0016 is monotonic; auth_audit_events exists from 0015 and is reused not recreated; link_codes/merge_audit exist from 0001 so the merge-barrier case is testable; none of the five email tables exist yet)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (D1E-1..D1E-22 authored 2026-07-22 in feature_web_auth_onboarding_tech.md §5, each with an exact expected result; includes the two cases the manifest names as READY preconditions — D1E-17 reset-vs-consume and D1E-18 merge barrier — both on real PostgreSQL with deterministic barriers)
SECURITY_AND_MIGRATION_GATE: PASS (single transactional expand-only 0016; zero direct app grant on PHC columns or internal helpers; PHC shape owned by one validator + constraint trigger on both write paths; parent-first lock hierarchy with no child-first path; fail-closed consume with no row-existence disclosure; no raw email/token/PHC/ciphertext in logs or returns; rollback = DROP the new tables/indexes/functions/trigger, auth_audit_events untouched because D0 owns it)
IMPLEMENTATION_ARTIFACTS: PASS (manifest with binding negative_scope + acceptance matrix D1E-1..D1E-22 + first implementation step)
FIRST_IMPLEMENTATION_STEP: open a manual P0 worktree from origin/main, register the D1 email-token manifest via scope-gate, then author one atomic 0016_account_email_token_core.sql (five tables + constraints + partial indexes + _auth_assert_password_phc + constraint trigger + _auth_consume_email_token + cleanup) with the matching schema.ts mirror, then run D1E-1..D1E-22
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: D1 email-token-core merged on origin/main -> re-run closure for auth-s4-d1-google-adapter (order-3), whose Verdict 4 currently fails G3 on this dependency
```

**Đọc verdict:** slice này trước đó **không có acceptance matrix và không có verdict** — đó là lý do nó bị chặn ở lượt review 2026-07-22. Cả hai artifact nay đã author từ authority owner-approved (DD-80 v1.88 + B0 §3/§5/§8.1/§9 + §10 order-2), nên G2/G4/IMPLEMENTATION_ARTIFACTS chuyển PASS. Hai ranh giới quan trọng được pin để tránh scope creep: (1) public verify/reset/login function và mọi route thuộc **order-4**, không phải slice này; (2) **DD-70(a) inbox fence không áp dụng** vì order-2 không có path phát global notification — fence chỉ xuất hiện ở producer `security_alert`/`identity_merged` của order-4.

---

## Verdict 8 — `auth-s4-d1-email-token-core` implemented, awaiting manual merge (2026-07-22)

<!-- review-verdict: historical -->
```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: 1dacd6e
BASE_BRANCH: main
TARGET_FILES:
  - docs/features/BE/feature_web_auth_onboarding_tech.md
  - docs/autopilot-manifests/auth-s4-d1-email-token-core.json
  - packages/db/schema.ts
  - packages/db/src/auth.ts
SLICE: auth-s4-d1-email-token-core
IN_SCOPE: one atomic 0016 with five function-only tables + constraints/partial indexes; _auth_assert_password_phc + trigger on both write paths; _auth_consume_email_token parent-first; five deadlock-free cleanup functions; schema.ts mirror; auth.ts helpers; index.ts export; README inventory
OUT_OF_SCOPE: public verify/reset/login functions, routes, provider send, pg-boss enqueue, oauth/Google, DD-70(a) fence, Telegram removal
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:C7-email-provider,A3-legal-PII
HARD_DEPENDENCIES: D0a MERGED (main@8f493f7) + D0b MERGED (main@93c5404)
PRIOR_SLICES: auth-s4-d0-revoke-core -> auth-s4-d0-session-web-boundary
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: C7 email-provider (blocks order-4 delivery, not this dark core); A3 legal-PII (go-live)
LIVE_REPO_VERIFICATION: PASS (7 files, +2555/-7; auth_audit_events reused from 0015 not recreated; zero app grant on the new tables/helpers)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (D1E-1..D1E-17 + D1E-18a + D1E-19..D1E-22 all covered by executable tests; 128 real-PostgreSQL tests green. D1E-18 was SPLIT during this review: the order-2 half D1E-18a is proven; D1E-18b is DEFERRED-BY-CONSTRUCTION, not a coverage gap, because live link_codes is person/channel-scoped and the account-issued link_code + merge-plan mutation is order-4)
SECURITY_AND_MIGRATION_GATE: PASS (single atomic expand-only 0016; PHC parsed in full with policy floor==ceiling and integer-overflow guard; no numeric or internal value leaked in error text per D1E-22; cleanup split into per-transaction bounded ascending passes to stay deadlock-free; zero app grant)
IMPLEMENTATION_ARTIFACTS: PASS (manifest amended for the two scope additions; acceptance matrix updated for the D1E-18 split)
FIRST_IMPLEMENTATION_STEP: n/a — implemented on feat/auth-s4-d1-email-token-core@9abecd9, STOP_AT_READY, awaiting owner squash-merge
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: order-4 identity companion landing account-issued link_code + merge plan MUST run the full both-sides D1E-18b barrier against _auth_consume_email_token before that slice can be CODE_READY
```

**Đọc verdict — cách gate được đóng, ghi minh bạch để không bị đọc nhầm là 2×clean:** Codex chạy **9 vòng** và hội tụ rõ (5→4→4→5→2→2→1→**sạch round-08**→1 ở round-09, đã fix). Core sạch liên tục từ round-06. Vì reviewer rơi vào chế độ **phi tất định** trên một migration lớn — mỗi vòng lòi đúng một P2 *khác nhau*, ngày càng hiếm — nên "2 vòng sạch liên tiếp" có thể không hội tụ **dù code đã đúng**. Owner chọn đóng bằng **1 vòng sạch + chứng thực độc lập có định hướng** (2nd-agent đối kháng trên toàn diff + grants, verdict CLEAN), cộng 128 test PostgreSQL thật, typecheck ×4 và toàn bộ finding 9 vòng đã fix kèm regression test. **Đây là override thứ hai trên ba slice** (D0a override, D0b đạt gate, D1 override) — tỷ lệ đó là bằng chứng luật 2×clean **miscalibrate với diff migration lớn**, không phải chất lượng kém; xem đề xuất hiệu chỉnh ở changelog.

**Hai scope-addition đã hợp thức hoá trong manifest** (không phải scope creep): `packages/db/src/index.ts` (export barrel, đúng precedent D0a v1.83) và `packages/db/README.md` (B0 §9 mục 4 bắt buộc cập nhật inventory nhưng manifest gốc bỏ sót).

---

## Verdict 9 — `auth-s4-d1-google-adapter` / D1 order-3 (2026-07-22)

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: 8f6a0515e95e69ee4f911281d6c5e5d218eb4d9b
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/b0-auth-credential-lifecycle-design-probe.md
  - docs/features/BE/feature_web_auth_onboarding_tech.md
  - docs/autopilot-manifests/auth-s4-d1-google-adapter.json
  - packages/db/src/auth.ts
  - apps/web/lib/session-cookies.ts
SLICE: auth-s4-d1-google-adapter
IN_SCOPE: auth_oauth_transactions (migration 0017) + path-scoped Lax binding cookie; state/nonce/PKCE issue and claim; OIDC proof matrix; the §4 identity/email collision table; session issue via the per-lane Google finalizer; auth_login_google taking the app-preallocated account_emails.id for the cell-1 AAD (v1.86)
OUT_OF_SCOPE: email register/verify/login/forgot/reset endpoints (order-4 bundle, flag OFF); Facebook adapter (DD-33 external gate; routes keep AUTH_PROVIDER_UNAVAILABLE); email-change/rebind from Google claims; auto-merge on identity conflict (-> DD-53); reuse of sameOriginRequest()/Strict callback cookie from the Telegram flow; Telegram route removal
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:google-oauth-client-config,A3-legal-PII
HARD_DEPENDENCIES: all three merged on origin/main and probed live at 8f6a051 — auth-s4-d0-revoke-core (0015::auth_revoke_account_sessions), auth-s4-d0-session-web-boundary (logout-all/route.ts::revokeAllWebSessions), auth-s4-d1-email-token-core (0016::account_emails)
PRIOR_SLICES: auth-s4-d0-revoke-core -> auth-s4-d0-session-web-boundary -> auth-s4-d1-email-token-core
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: google-oauth-client-config (client id/secret via KMS/env — config only, does not change the dark contract); A3-legal-PII (go-live)
LIVE_REPO_VERIFICATION: PASS (migration tail is 0016 so 0017 is monotonic; auth_oauth_transactions absent as expected — its only mention in 0016 is a negative-scope comment; account_emails / auth_pending_email_registrations / email_password_credentials all live from 0016, so every collision cell in D1-6..D1-10 is now constructible; deriveEmailArtifacts already takes the preallocated accountEmailId, so the v1.86 cell-1 AAD handoff needs no new contract)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (D1-1..D1-15, authored earlier and RE-VERIFIED at this SHA against the now-live schema rather than assumed — the D1E-18 miss on the previous slice came from trusting a matrix row whose precondition did not exist)
SECURITY_AND_MIGRATION_GATE: PASS (0017 expand-only; PKCE stored as bytea with a separate key-version column; Lax path-scoped binding cookie is distinct from the Strict session cookie and must not reuse sameOriginRequest(); independent oauth-state and oauth-callback rate buckets; identity conflict fails closed to AUTH_IDENTITY_CONFLICT with no session minted)
IMPLEMENTATION_ARTIFACTS: PASS (manifest + acceptance matrix + first step)
FIRST_IMPLEMENTATION_STEP: open a manual P0 worktree from origin/main@8f6a051, register the google-adapter manifest via scope-gate, then author 0017_oauth_transactions.sql + the Drizzle mirror, then the OIDC verify/state/callback layer, then run D1-1..D1-15
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: google-adapter merged -> order-4 email-credential-lifecycle bundle, which additionally inherits the D1E-18b both-sides merge-barrier obligation and the C7 provider gate
```

**Đọc verdict:** Verdict 4 (19/07) cho slice này là `PLAN_READY` và **fail G3** vì D0 chưa merge; nó cũng bị DD-80 v1.88 supersede về dependency order. Nay cả ba dependency đã merge và **probe live tại `8f6a051`**, nên G3 chuyển PASS. Khác với slice trước, acceptance matrix **không phải author mới** — D1-1..D1-15 đã có sẵn; công việc review ở đây là **kiểm lại từng precondition có tồn tại thật trên schema live hay không**, đúng bài học từ lỗi D1E-18 (một hàng matrix giả định `account-issued link_code` vốn chưa tồn tại). Kết quả: mọi cell collision D1-6..D1-10 nay dựng được, và AAD handoff v1.86 đã có sẵn API (`deriveEmailArtifacts(raw, accountEmailId, keys)`).

---

## Verdict 10 — `auth-s4-d1-google-adapter` implemented, awaiting manual merge (2026-07-22)

<!-- review-verdict: historical -->
```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: 23a37abc32c4277a0b2370db7f3ddf7d80f488bc
BASE_BRANCH: main
TARGET_FILES:
  - docs/features/BE/feature_web_auth_onboarding_tech.md
  - docs/autopilot-manifests/auth-s4-d1-google-adapter.json
  - packages/db/schema.ts
  - apps/web/lib/session-cookies.ts
SLICE: auth-s4-d1-google-adapter
IN_SCOPE: migration 0017 auth_oauth_transactions (PKCE ciphertext bytea + own key version, google lifecycle CHECK, issue/claim single-use); google-oidc proof matrix (sig/iss/aud/azp/exp/iat/nonce/email_verified + maxTokenAge + timeout); oauth-transaction lib (PKCE S256, AES-256-GCM verifier AEAD, HKDF key, Lax path-scoped cookie); /api/auth/google/{state,callback}; auth_login_google per-lane finalizer with the §4 collision table
OUT_OF_SCOPE: session rotation of a pre-existing Strict cookie (see accepted residual risk); email bundle order-4; Facebook; Telegram removal; email-change/rebind from Google claims; auto-merge on identity conflict
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:google-oauth-client-config,A3-legal-PII,auth-s4-d1b-oauth-session-rotation
HARD_DEPENDENCIES: D0a 8f493f7 + D0b 93c5404 + D1 email-token-core 64fb4d3, all merged and probed live
PRIOR_SLICES: auth-s4-d0-revoke-core -> auth-s4-d0-session-web-boundary -> auth-s4-d1-email-token-core
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: google-oauth-client-config (config only); A3-legal-PII (go-live); auth-s4-d1b-oauth-session-rotation (HARD blocker on setting GOOGLE_OAUTH_CLIENT_ID/SECRET in ANY environment)
LIVE_REPO_VERIFICATION: PASS (17 files, +2841/-9; migration tail was 0016 so 0017 is monotonic; /api/auth/google/state returns 503 with config absent and .env.example ships the keys EMPTY, so Google login is not enabled anywhere and the residual risk below is not live; manifest scope reconciled at READY with a _scope_note for rls-invariants.test.ts, coupled by the migration-count assertion)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (D1-1..D1-15; full real-PG suite db 144 · core 111 · bot 3 · web 131, 0 skipped; semgrep 0 findings; OSV clean after adding jose@5)
SECURITY_AND_MIGRATION_GATE: PASS (0017 expand-only; PKCE verifier held as AES-256-GCM ciphertext with a separate key version; Lax path-scoped binding cookie kept distinct from the Strict session cookie and sameOriginRequest() deliberately NOT reused; independent oauth-state / oauth-callback buckets, limiter fail-closed; identity conflict fails closed to AUTH_IDENTITY_CONFLICT with no session minted; cell-8 proof failure rejects before touching the DB and writes no audit row)
IMPLEMENTATION_ARTIFACTS: PASS (manifest reconciled + acceptance matrix + residual risk pinned in three durable places)
FIRST_IMPLEMENTATION_STEP: n/a — implemented on feat/auth-s4-d1-google-adapter@75bfa58, STOP_AT_READY, awaiting owner squash-merge
REMAINING_BLOCKERS: none for merge
NEXT_REVIEW_TRIGGER: auth-s4-d1b-oauth-session-rotation must be authored, verdicted and merged BEFORE Google login is enabled in any environment; separately, order-4 email bundle inherits the D1E-18b merge-barrier obligation and the C7 provider gate
```

**ACCEPTED RESIDUAL RISK — đọc kỹ, đây không phải "matrix xanh nên không còn gap":** cookie session `SameSite=Strict` **không được gửi** trên callback OAuth cross-site, nên callback không đọc/rotate/revoke được session cũ. D1 vì thế **mint-fresh** (đúng matrix D1-2 + D1-13), và hệ quả là **một session có trước khi login Google vẫn sống sót, không bị vô hiệu hoá** — kẻ tấn công nắm token cũ đó vẫn giữ được nó.

**Vì sao chấp nhận thay vì sửa trong slice này:** phần rotation từng được thử và là **invented scope** ngoài matrix; nó **non-atomic**, **đua với logout-all** (đẻ ra P1 mới ở round-06) và vẫn hụt khi `/state` bị vào cross-site. Findings nở 1→3→4 qua các vòng là tín hiệu **sai tầng**, không phải code ẩu: primitive rotate atomic nằm ở tầng D0/session, nên lời giải đúng là **same-site completion hop** ở đó — chống lại một bất biến của trình duyệt ngay trong OAuth adapter thì không thể atomic.

**Rủi ro này KHÔNG live** vì Google login fail-closed 503 khi thiếu config và `.env.example` để trống key. Điều kiện đóng được pin **cưỡng chế được, không phải "slice kế tiếp"**: `auth-s4-d1b-oauth-session-rotation` **phải land TRƯỚC khi set `GOOGLE_OAUTH_CLIENT_ID/SECRET` ở bất kỳ môi trường nào** — ghi bền ở ba nơi (manifest `enablement_gates`, `.env.example` ngay trên hai biến đó, tech doc §4 Session Security).

---

## Verdict 11 — `auth-s4-d1b-oauth-session-rotation` (2026-07-22)

> **Superseded by Verdict 12 (same day):** the sole blocker — an unpinned hop mechanism — was closed by
> measurement, not argument. Kept as the record of why the slice was held.

<!-- review-verdict: historical -->
```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: 79430d32751853923b02caddf44f5d4504e6b872
BASE_BRANCH: main
TARGET_FILES:
  - docs/features/BE/feature_web_auth_onboarding_tech.md
  - docs/autopilot-manifests/auth-s4-d1b-oauth-session-rotation.json
  - apps/web/lib/session-cookies.ts
  - apps/web/app/api/auth/google/callback/route.ts
SLICE: auth-s4-d1b-oauth-session-rotation
IN_SCOPE: same-site completion hop so issueSession() runs where the Strict cookie is present and takes its EXISTING rotate branch; single-use short-TTL handoff bound to the oauth transaction; callback stops minting directly
OUT_OF_SCOPE: any new rotate primitive (D0a's auth_rotate_web_session is reused as-is); re-litigating the D1 mint-fresh contract; the rejected capture-at-/state + revoke-at-callback workaround; weakening SameSite=Strict; email bundle order-4; Facebook; Telegram removal
G1_DECISION: PASS
G2_SPEC: PARTIAL
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: auth-s4-d1-google-adapter MERGED (main@c6edbfa; 0017::auth_oauth_transactions and google/callback/route.ts::issueSession both live)
PRIOR_SLICES: auth-s4-d0-revoke-core -> auth-s4-d0-session-web-boundary -> auth-s4-d1-email-token-core -> auth-s4-d1-google-adapter
OPEN_QUESTIONS_IN_SCOPE: 1
ENABLEMENT_ONLY_GATES: none — this slice IS itself the blocker on enabling Google login
LIVE_REPO_VERIFICATION: PASS (issueSession already branches rotate-vs-create on cookie presence and already throws SessionReauthRequiredError when rotate returns null, so NO new primitive is needed; the cross-site callback simply never sees the cookie. auth_rotate_web_session in 0015 takes old/new token hash + csrf + ttl + account and does the parent-locked epoch-revalidated swap in one transaction)
CONTRACT_MATRIX: PARTIAL
CLOSURE_MATRIX: FAIL (11/12 — mechanism unpinned)
ACCEPTANCE_MATRIX: PASS (D1B-1..D1B-10 authored 2026-07-22, but D1B-2 cannot be satisfied until the blocker below is resolved)
SECURITY_AND_MIGRATION_GATE: PASS (no migration; no new grant; reuses the proven D0a primitive and the D0b reject-and-reauth fence)
IMPLEMENTATION_ARTIFACTS: PASS (manifest + acceptance matrix)
FIRST_IMPLEMENTATION_STEP: (blocked)
REMAINING_BLOCKERS:
  - blocker: the completion-hop MECHANISM is not pinned. A plain 302 from the cross-site callback to a same-origin route is NOT sufficient evidence — whether a SameSite=Strict cookie is sent on a redirect chain that STARTED cross-site is browser-divergent. Pick the wrong mechanism and the slice silently fixes nothing (cookie still absent, still mint-fresh) while every mocked unit test stays green.
    owner: owner (design decision) -> mình (write it up as a DD/probe note)
    resolution: a design probe that pins ONE mechanism and shows, on the target browser matrix, that plx_session is actually present at the completion endpoint after a real Google round-trip. Candidate to evaluate first: the callback returns a first-party document that performs a document-initiated same-site navigation, rather than relying on a server redirect chain.
NEXT_REVIEW_TRIGGER: hop mechanism pinned with real-browser evidence -> re-run closure; expected CODE_READY without further contract changes since D1B-1..D1B-10 already cover the behavior
```

**Đọc verdict — vì sao KHÔNG rubber-stamp CODE_READY:** slice này về mặt code là nhỏ và không cần primitive mới — `issueSession()` **đã** có nhánh rotate đúng, `auth_rotate_web_session` **đã** atomic và đã qua barrier test ở D0a. Nhưng toàn bộ giá trị của slice nằm ở **một giả định chưa ai chứng minh**: rằng cơ chế hop được chọn thực sự khiến trình duyệt gửi cookie `SameSite=Strict`. Đây là hành vi **phân kỳ giữa các trình duyệt** với chuỗi redirect khởi phát cross-site. Nếu sai, slice **âm thầm vô dụng** — vẫn không thấy cookie, vẫn mint-fresh, residual risk vẫn nguyên — mà **mọi unit test mock vẫn xanh** và ta sẽ tưởng đã đóng gate rồi bật Google login. Đó là kịch bản tệ nhất có thể, nên `OPEN_QUESTIONS_IN_SCOPE: 1` và verdict là `NOT_CODE_READY`. Blocker rẻ: một probe pin đúng một cơ chế + bằng chứng trên trình duyệt thật.

---

## Verdict 12 — `auth-s4-d1b-oauth-session-rotation`, hop mechanism pinned (2026-07-22)

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: fa94e3b072afe123ab64a2377e6be353ba1a5d34
BASE_BRANCH: main
TARGET_FILES:
  - docs/probe-strict-cookie-completion-hop.md
  - docs/features/BE/feature_web_auth_onboarding_tech.md
  - docs/autopilot-manifests/auth-s4-d1b-oauth-session-rotation.json
  - apps/web/lib/session-cookies.ts
SLICE: auth-s4-d1b-oauth-session-rotation
IN_SCOPE: M3 completion hop — callback returns a first-party non-mutating landing that auto-submits a same-origin POST to a completion endpoint (noscript Continue fallback); single-use short-TTL handoff bound to the oauth transaction; completion endpoint runs the EXISTING issueSession() so it takes its existing rotate branch
OUT_OF_SCOPE: any new rotate primitive; re-litigating D1 mint-fresh; the rejected capture-at-/state workaround; weakening SameSite=Strict; harmonising this auto-submit with the §8.4 email two-hop, which deliberately requires a user gesture
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:safari-macos-and-ios-strict-hop-evidence
HARD_DEPENDENCIES: auth-s4-d1-google-adapter MERGED (main@c6edbfa)
PRIOR_SLICES: auth-s4-d0-revoke-core -> auth-s4-d0-session-web-boundary -> auth-s4-d1-email-token-core -> auth-s4-d1-google-adapter
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: safari-macos-and-ios-strict-hop-evidence — Safari and iOS Safari were NOT measured (Playwright ships a frozen WebKit build, not shipped Safari). This does not change what the code should be, so it does not block CODE_READY, but it DOES remain part of the gate on enabling Google login: if shipped Safari were to withhold the Strict cookie on M3, Safari users would silently keep the residual risk. Manual steps are in probe §7.
LIVE_REPO_VERIFICATION: PASS (issueSession already branches rotate-vs-create and already throws SessionReauthRequiredError on rotate-null; auth_rotate_web_session in 0015 is the atomic parent-locked epoch-revalidated swap; no new primitive required)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (D1B-1..D1B-11; D1B-2 satisfied by measured 3-engine evidence, D1B-11 added as the structural anti-regression net)
SECURITY_AND_MIGRATION_GATE: PASS (POST hop carries Origin so the existing sameOriginRequest() guards the mutating step independently of cookie semantics; reuses the D0b reject-and-reauth fence; no new grant. CORRECTED 2026-07-22 — an earlier revision of this block claimed "no migration", which was premature: with M3 the callback can no longer call issueSession(), so the account it resolved must reach the completion endpoint, and auth_oauth_transactions has no column for it. Either shape is acceptable and both are expand-only — see handoff_persistence in the manifest — but single-use MUST be enforced by a durable server-side fence, never by a cookie signature alone)
IMPLEMENTATION_ARTIFACTS: PASS (probe doc + manifest + acceptance matrix)
FIRST_IMPLEMENTATION_STEP: open a manual P0 worktree from origin/main, register the d1b manifest, then replace the callback's direct issueSession() call with handoff + first-party landing (M3), add the completion route running issueSession(), then run D1B-1..D1B-11
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: d1b merged AND Safari/iOS cells measured -> only then may GOOGLE_OAUTH_CLIENT_ID/SECRET be set in any environment
```

**Đọc verdict — blocker được đóng bằng ĐO, không bằng lập luận.** Verdict 11 giữ slice lại vì cơ chế hop chưa pin. Probe (`../probe-strict-cookie-completion-hop.md`) chạy harness hai site thật trên Chromium 149 · Firefox 151 · WebKit 26.5 và cho kết quả **quan trọng**: **M1 — 302 trần — KHÔNG mang cookie `Strict` trên cả ba engine.** Đó chính xác là cơ chế mà một implementer sẽ mặc định chọn; nếu không probe, d1b đã ship một fix **vô dụng thầm lặng** (vẫn mint-fresh, residual risk nguyên vẹn) trong khi mọi unit test mock cookie vẫn xanh. Control của probe (`None`/`Lax` tới được mọi hop, `Strict` vắng **đúng** tại callback cross-site) chứng minh harness trung thực chứ không phải artefact.

**Safari/iOS được phân loại là ENABLEMENT_ONLY, không phải open question.** Lý do: nó không đổi *code nên viết thế nào* — M3 là lựa chọn đúng bất kể Safari trả lời gì, vì 4/5 cơ chế thắng trên 3 engine và M1 thua ở mọi nơi. Nhưng nó **vẫn thuộc gate bật Google login**: nếu Safari bản ship giữ lại cookie ở M3 thì người dùng Safari âm thầm vẫn dính residual risk. Vì vậy điều kiện bật là **d1b merged VÀ Safari/iOS đã đo**, không phải chỉ merged.

---

## Verdict 13 — `auth-s4-d1b-oauth-session-rotation` implemented, awaiting manual merge (2026-07-22)

<!-- review-verdict: historical -->
```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: 7999357bb4c5564e1928b74f625e1fb9672ee379
BASE_BRANCH: main
TARGET_FILES:
  - docs/features/BE/feature_web_auth_onboarding_tech.md
  - docs/autopilot-manifests/auth-s4-d1b-oauth-session-rotation.json
  - docs/probe-strict-cookie-completion-hop.md
  - packages/db/schema.ts
SLICE: auth-s4-d1b-oauth-session-rotation
IN_SCOPE: M3 completion hop (callback returns a first-party non-mutating landing that auto-submits a same-origin POST; noscript Continue fallback); migration 0018 expand-only adding resolved_account_id + handoff_hash + handoff_expires_at + handoff_consumed_at to auth_oauth_transactions plus auth_oauth_handoff_arm/_consume; completion route running the EXISTING issueSession()
OUT_OF_SCOPE: new rotate primitive; re-litigating D1 mint-fresh; capture-at-/state; weakening SameSite=Strict; harmonising with the §8.4 gesture flow
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:safari-macos-and-ios-strict-hop-evidence
HARD_DEPENDENCIES: auth-s4-d1-google-adapter MERGED (main@c6edbfa)
PRIOR_SLICES: auth-s4-d0-revoke-core -> auth-s4-d0-session-web-boundary -> auth-s4-d1-email-token-core -> auth-s4-d1-google-adapter
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: safari-macos-and-ios-strict-hop-evidence — still unmeasured; enabling Google login requires this slice merged AND those cells measured (probe §7)
LIVE_REPO_VERIFICATION: PASS (14 files, +984/-68, all within the amended manifest scope plus the two reconciled additions index.ts and rls-invariants.test.ts, both with a _scope_note per the D0a/D1 precedent. Handoff shape (a) chosen: consume is a single atomic UPDATE ... WHERE handoff_consumed_at IS NULL AND handoff_expires_at > clock_timestamp() RETURNING resolved_account_id, so concurrent losers get NULL; the partial UNIQUE index keeps the hash after consume so it can never be reused; clock_timestamp() not frozen now(), carrying the D0a round-09 lesson forward. sameOriginRequest() is genuinely called before the mutating step, so the stated reason for choosing M3 over M2 is realised in code, not just in prose. consume commits before issueSession, so an interrupted hop fails toward "old session survives intact" — the safe direction for D1B-9)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (D1B-1..D1B-11; real-PG suite db 152 · core 111 · bot 3 · web 146, 0 skipped)
SECURITY_AND_MIGRATION_GATE: PASS (0018 expand-only; handoff token rides the POST body and only its sha256 is stored — no handoff cookie at all; single-use enforced by a durable server-side fence, not a signature; internal functions REVOKEd from PUBLIC with EXECUTE granted only to app; redirect leaks no referrer)
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: n/a — implemented on feat/auth-s4-d1b-oauth-session-rotation@04df464, STOP_AT_READY
REMAINING_BLOCKERS: none for merge
NEXT_REVIEW_TRIGGER: Safari/iOS cells measured -> only then may GOOGLE_OAUTH_CLIENT_ID/SECRET be set
```

**Đọc verdict — và một phát hiện về quy trình đáng ghi hơn cả slice này.** Đây là slice đầu tiên đạt **2 vòng Codex sạch liên tiếp ngay lần đầu, `fix-round-count = 0`, regions rỗng**. So sánh trực tiếp: D0a **12 vòng**, D1 email-token **9 vòng**, D1 google-adapter **6 vòng**. Mà d1b **không hề đơn giản hơn** — 14 file, một migration, hàm SECURITY DEFINER, barrier test hai connection với logout-all.

Điểm khác biệt không phải kích thước diff mà là **thiết kế đã đứng yên trước khi code**: cơ chế hop được **đo** chứ không giả định (probe bác bỏ M1 — chính là thứ implementer sẽ chọn theo bản năng), acceptance D1B-1..11 viết xong trước, và quyết định còn lại duy nhất (handoff persistence) được khoanh sẵn thành hai hình dạng chấp nhận được kèm ràng buộc bắt buộc.

**Điều này sửa lại khuyến nghị của chính mình ở changelog v1.2.** Lúc đó mình cho rằng luật "2 vòng sạch" bị miscalibrate với diff lớn và đề xuất nới. Bằng chứng d1b nói ngược lại: luật không sai — **thrash là triệu chứng của việc authorize code khi thiết kế còn đang chuyển động**. D0a thrash vì DD-80 tự sửa v1.83→v1.86→v1.88 **giữa lúc đang code**; D1 email-token vì một hàng acceptance mã hoá một tiền đề không tồn tại. Cách chữa không phải nới gate, mà chính là kỷ luật probe/verdict vừa dùng ở đây. **Đề xuất nới luật ở v1.2 nên rút lại.**

---

## Verdict 14 — `db-migration-0000-idempotent-role-create`, re-scoped (2026-07-22)

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: e61d96c42a9ee5b0b12424bd052813b10712a7ee
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-manifests/db-migration-0000-idempotent-role-create.json
  - packages/db/src/migrate.ts
  - packages/db/src/test-harness.ts
  - packages/db/vitest.config.ts
  - packages/db/migrations/0000_roles_extensions.sql
SLICE: db-migration-0000-idempotent-role-create
IN_SCOPE: runner-level exception-handled role-ensure in migrate.ts gated on 0000-not-yet-applied; correct the misleading advisory-lock comment; flip fileParallelism to true; a migrate/bootstrap test covering the concurrency and error-discrimination cases
OUT_OF_SCOPE: editing migration 0000 (applied + immutable); any new migration file; changing which roles exist, their attributes or any grant; removing the existing advisory lock; swallowing any SQLSTATE other than the two role-already-exists codes named in the amendment below
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none — this is infrastructure, independent of the auth chain
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (0000 lines 20-32 are the check-then-act DO block over three roles with no exception handler; migrate.ts:40 takes pg_advisory_lock and its header at :18 claims it prevents concurrent deploys interleaving DDL; vitest.config.ts pins fileParallelism:false and itself records that this is what actually prevents reason (2); test-harness.ts requires every suite to pass a distinct dbName, so reason (1) is already satisfied and (2) is the sole remaining blocker to parallel execution)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (BR-1..BR-7 in the manifest; BR-1 concurrency and BR-6 parallelism must be run repeatedly, not once, since the defect is a race)
SECURITY_AND_MIGRATION_GATE: PASS (no migration added or edited; 0000 stays byte-identical with an unchanged checksum and the immutability guard intact; no role, attribute or grant changes; the advisory lock stays for same-database deploys. AMENDED 2026-07-22, owner-ratified: the ensure step swallows duplicate_object 42710 OR unique_violation 23505, not 42710 alone. Measured, not assumed — CREATE ROLE's internal existence check is NOT atomic with the insert into pg_authid, so two backends that both pass the pre-check collide on pg_authid_rolname_index and the loser raises 23505; empirically that is the dominant loser code by roughly 50:1. Swallowing only 42710 would leave the very race this slice exists to close. Blast radius stays tight because the DO block contains exactly one CREATE ROLE for one named role, so 23505 there can only mean that rolname already exists; insufficient_privilege 42501 and every other SQLSTATE still propagate and abort)
IMPLEMENTATION_ARTIFACTS: PASS (manifest with problem statement, pinned mechanism, rejected alternative and acceptance)
FIRST_IMPLEMENTATION_STEP: open a manual P0 worktree, add the gated exception-handled role-ensure to migrate.ts before the migration loop and outside the migration transaction, correct the advisory-lock comment, then write the concurrency + error-discrimination tests BEFORE flipping fileParallelism
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: merged -> multiple autopilot worktrees may run their DB suites concurrently; revisit the sequential-only guidance in the parallelism notes
```

**Đọc verdict — vì sao task này từng là `DESIGN_UNFIT` và giờ thì không.** Khung cũ là *"làm cho việc tạo role trong 0000 trở nên atomic"*, và như thế thì **không giải được**: 0000 đã applied và immutable (runner hard-error nếu file applied bị sửa). Re-scope bỏ hẳn việc đụng 0000.

**Phát hiện chính, và nó là một cái bẫy thật:** `migrate.ts` **đã** có `pg_advisory_lock`, với comment ở dòng 18 nói lock đó ngăn "concurrent deploys interleave DDL". Nhưng **advisory lock của Postgres là database-scoped**. Hai `migrate()` chạy trên hai database khác nhau cùng một cluster đều lấy được **cùng key** trong database của mình và **không chặn nhau** — nên lock hiện tại bảo vệ **số không** cho object cluster-global như role. Ai đọc file này sẽ tưởng đã được serialize. Sửa comment đó là một phần bắt buộc của slice, không phải việc phụ.

**Cơ chế đã pin:** role-ensure có `EXCEPTION WHEN duplicate_object THEN NULL` (Postgres không có `CREATE ROLE IF NOT EXISTS`), chạy ở runner **trước** vòng lặp migration và **ngoài** transaction, **gated** trên "0000 chưa applied" để database đã migrate giữ nguyên profile quyền như hôm nay. Sau bước đó, chính block `IF NOT EXISTS` của 0000 thấy role tồn tại và bỏ qua — **0000 byte-identical, checksum không đổi**.

**Giá trị thật:** `vitest.config.ts` tự ghi rằng `fileParallelism:false` *"is what actually prevents (2)"*, và lý do (1) đã được thoả sẵn vì mọi suite truyền `dbName` riêng. Nên đóng (2) là **đủ** để bật parallel — thứ cuối cùng đang chặn nhiều autopilot worktree chạy DB suite đồng thời.

**AMENDED 2026-07-22 (owner-ratified A1–A3) — ba sai lệch so với bản viết ban đầu, đều có bằng chứng:**

- **A2 — sai sót trong chính verdict này.** Bản đầu viết "chỉ nuốt `duplicate_object`", chép theo gợi ý trong backlog **mà không đo**. Thực tế: check tồn tại nội bộ của `CREATE ROLE` **không atomic** với insert vào `pg_authid`, nên hai backend cùng qua pre-check sẽ đụng `pg_authid_rolname_index` và bên thua raise **`unique_violation` 23505**, áp đảo `42710` khoảng **50:1**. Nuốt mỗi 42710 ⇒ **race vẫn abort** — tức slice không sửa được đúng thứ nó sinh ra để sửa. Nay nuốt **42710 hoặc 23505**; `42501` và mọi mã khác vẫn propagate. Blast radius chặt vì DO block chứa đúng một `CREATE ROLE` cho một role có tên.
- **A1 — bug thật, Codex round-01 bắt đúng.** Tạo role vô điều kiện làm abort trên cluster đã có sẵn role + DDL owner `NOCREATEROLE`, vì Postgres kiểm quyền `CREATEROLE` **trước** khi phát hiện trùng — vi phạm đúng negative-scope #6 của chính verdict này. Đã thêm existence pre-check; pre-check lo phần quyền, exception handler lo cửa sổ race mà pre-check vốn không đóng được.
- **A3 — chỉ test.** Bật parallel làm lộ race thứ hai: `ALTER ROLE … PASSWORD` đồng thời trên role dùng chung trong `test-harness.ts` ("tuple concurrently updated"). Đã làm retry-tolerant; `test-harness.ts` thêm vào TARGET_FILES và scope.

Việc implementer **dừng lại xin phê duyệt** thay vì tự nới contract P0 là đúng gate — ghi nhận.

**✅ IMPLEMENTED & MERGED 2026-07-22 tại `main@8d8f3bc`.** Gate P0 **theo claim lúc merge**: 2 vòng Codex sạch liên tiếp (round-03/04) trên `6f8f628`, không override — ⚠️ **claim này không có bằng chứng sống sót; đọc block re-verify bên dưới trước khi trích dẫn.** Verify trên remote: `duplicate_object` ×2 + `unique_violation` ×2 trong `migrate.ts`, `fileParallelism: true`, `migrate.test.ts` có mặt. Suite: core 111 · db **159** · bot 3 · web 146. **`NEXT_REVIEW_TRIGGER` đã thoả: nhiều autopilot worktree giờ chạy DB suite song song được.**

> ⚠️ **Đính chính cho người audit sau — `eba1c27` mang subject của slice này nhưng KHÔNG chứa nó.** Lần merge đó abort vì working tree bẩn, và lệnh `git commit` chạy ngay sau lại bắt được hai file docs không liên quan (`auth-s4-session-handoff.md`, `ROADMAP.md`). **Nội dung của `eba1c27` là docs hợp lệ và được giữ nguyên; chỉ subject là sai.** Commit thật của slice này là **`8d8f3bc`**. Nguyên nhân gốc là command block nhiều bước không nối `&&` nên một bước git fail mà bước sau vẫn chạy — đã đổi khuôn: gate bằng `git diff --quiet` (không dùng `git status --porcelain`, vì nó tính cả file untracked nên luôn báo bẩn) và nối `&&` toàn chuỗi.

> **✅ Re-verify độc lập 2026-07-22 sau khi land — tách rõ hai loại bằng chứng, không gộp làm một.** Claim
> "2 vòng Codex sạch liên tiếp (round-03/04)" ở trên **không có bằng chứng sống sót**:
> `.autopilot/state/db-migration-0000-idempotent-role-create/` đã mất cùng worktree khi `ap-finish` dọn
> xong, nên `round-NN.txt`/`regions.log` không còn để đọc lại — lặp lại claim đó ở một commit message sau
> không tái tạo bằng chứng, chỉ tái khẳng định. Không dùng làm căn cứ cho tới khi có ai đó thực sự re-run
> Codex trên diff này. Ngược lại, gate **chức năng** (BR-1/4/6) đã **chạy lại thật** trên Postgres thật
> (`plexco_test`, `fileParallelism: true`), độc lập với mọi claim cũ, không suy ra từ đếm số hay grep
> string: **5/5 lần chạy toàn bộ suite `packages/db` xanh, 159/159 test, 0 fail, 0 flake**; riêng
> `BR-4 > insufficient_privilege from CREATE ROLE propagates and does not create the role` xác nhận bằng
> `vitest --reporter=verbose` — 42501 vẫn propagate và abort đúng thiết kế, không bị nuốt nhầm cùng
> 42710/23505. Kết luận: gate chức năng BR-1/2/3/4/6 = **ĐẠT, có bằng chứng sống**; claim Codex-review-rounds
> = **không kiểm chứng lại được với evidence hiện có**, ghi nhận là vậy thay vì xoá hoặc khẳng định lại như
> fact đã đóng.
>
> **✅ BR-7 đóng bằng đo (lượt bổ sung 2026-07-22, `main@28404cb`):** toàn bộ suite `packages/db` chạy với
> `--no-file-parallelism` — 4 file / **159/159** test, 0 fail ⇒ đường tuần tự **không** regress sau khi lật
> `fileParallelism: true`. Cùng lượt, đọc lại `migrate.test.ts` xác nhận **BR-1..BR-4 tồn tại dưới dạng 7
> test có tên**: BR-1 hai ca concurrency · BR-2 immutability · BR-3 hai ca gating · BR-4
> `insufficient_privilege from CREATE ROLE propagates and does not create the role` **cộng một guard ngoài
> acceptance gốc** (`refuses an unsafe role identifier before issuing any DDL`). **BR-5** là hạng mục sửa
> comment, đóng bằng đọc code chứ không phải test. ⇒ **Ma trận chức năng BR-1..BR-7 nay đã đo đủ.**
>
> ⚠️ **Message của `8d8f3bc` nói quá, và không amend được.** Nó khẳng định
> `"P0 gate MET: two consecutive FULL-base Codex clean rounds on 6f8f628. BR-1..BR-7 green."` — lúc viết
> thì **cả hai vế đều chưa có căn cứ**: ledger Codex đã mất cùng worktree, còn BR-7 thì chưa chạy.
> `8d8f3bc` đã push và có descendant nên đính chính phải nằm ở đây. Vế BR nay đã đúng; vế Codex-rounds thì
> vẫn không. Người audit đọc block này, đừng trích message đó.
>
> **Vật chứng đã neo:** sau khi `ap-finish` xoá branch, `6f8f628` không còn ref nào giữ (dangling, có thể bị
> `git gc` dọn). Đã neo bằng tag **`forensic/eba1c27-incident`**. Tree của nó giống hệt `8d8f3bc` trên
> `packages/db` (`git diff 6f8f628 8d8f3bc -- packages/db` rỗng), nên nếu sau này ai muốn thực sự re-run
> Codex để đóng claim còn treo thì chạy trên diff này là hợp lệ.

> **Lỗ hổng cấu trúc lộ ra từ vụ `eba1c27`:** `scripts/autopilot-scope-gate` canh giữ feature worktree
> (register/ready/cleanup theo manifest), **không canh giữ docs commit chạy thẳng ở root working copy**.
> Nhiều session Cowork share một git identity (`Cowork <cowork@local>`) và một `.git/index` khi tất cả
> đứng ở root repo thay vì mỗi session một worktree riêng — đủ để một session `git commit` vô tình bắt
> đúng content mà session khác đang stage, dưới message của chính nó. `scripts/ap-merge.sh` (thêm ở
> `8a58cc6`) đóng root cause **cơ chế** (chuỗi lệnh nhiều bước không nối `&&`; gate sai dùng
> `git status --porcelain`, vốn luôn báo bẩn vì tính cả untracked file). Root cause **tổ chức** — docs
> commit trực tiếp ở root working copy không có ranh giới cách ly nào giữa các session — vẫn còn mở.

---

## Verdict 15 — `core-matcher-grouped-amount-parsing`, DD-87 contract closed on disk (2026-07-22)

> **Superseded by Verdict 16 (same day):** the sole blocker — the authority packet outside the pinned SHA —
> closed by commit/push. Kept as the record of the exact blocker and its resolution condition.

<!-- review-verdict: historical -->
```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: 6a28072c433d24aa489b3456b301b5a7e99a2716
BASE_BRANCH: main
TARGET_FILES:
  - docs/dd-87-splitnameamount-decision-table-analysis.md
  - docs/standards/decisions.md
  - docs/autopilot-manifests/core-matcher-grouped-amount-parsing.json
  - docs/autopilot-core-split-name-amount-ambiguity-contract.md
  - .claude/commands/ap-29-core-split-name-amount-ambiguity-contract.md
  - docs/autopilot-backlog.md
  - docs/slice-readiness-verdicts.md
  - docs/auth-s4-session-handoff.md
SLICE: core-matcher-grouped-amount-parsing
IN_SCOPE: splitNameAmount exhaustive tagged-union contract, all positive parseMoney trailing candidates, exact unit assertions
OUT_OF_SCOPE: transports, DB/schema/migrations, ledger mutation, classifyAmount/FIFO, consumer picker implementation, ignored historical table lift
G1_DECISION: FAIL
G2_SPEC: PASS
G3_DEPENDENCY: FAIL
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: corrected DD-87 authority packet must be committed/pushed on main
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (main=origin/main@6a28072; splitNameAmount only has the test caller; GitNexus upstream risk LOW, 0 runtime process; parseMoney/source/tests exist; no schema dependency; phase1-fable5 is registered and worktree prune dry-run reports nothing)
CONTRACT_MATRIX: PASS (none|resolved|ambiguous tagged union; ambiguous has ordered candidate tuple and no top-level amount; ambiguity dedupes interpretations by name+amount)
CLOSURE_MATRIX: FAIL (9/12 — authority snapshot, merged first-step authority, and committed/pushed handoff are not closed)
ACCEPTANCE_MATRIX: PASS (DD-87 exact 18 rows + SNA-1..SNA-8; includes equal-amount/different-name Player 0 110k)
SECURITY_AND_MIGRATION_GATE: PASS (pure function; no IO/log/DB/migration; no second grammar or heuristic; rollback is code commit revert)
IMPLEMENTATION_ARTIFACTS: FAIL (manifest + task contract + AP-29 launcher + backlog authored on disk, not committed/pushed default branch)
FIRST_IMPLEMENTATION_STEP: blocked until origin/main re-pin; then create dedicated worktree, register manifest, record DD-87 design probe and add failing SNA tests
REMAINING_BLOCKERS:
  - blocker: corrected DD-87 decision and implementation packet are outside the pinned authority SHA
    owner: owner git workflow
    resolution: commit and push every TARGET_FILE on main; re-open live files at the new origin/main SHA; promote task contract from enforce to code-ready and issue strict CODE_READY with 12/12 closure
NEXT_REVIEW_TRIGGER: origin/main commit containing every Verdict-15 TARGET_FILE
```

**Đọc verdict:** product/technical choice đã đóng và không còn open question. `NOT_CODE_READY` ở đây không
che contract gap; nó là gate authority bất biến: file untracked/modified không thể authorize worktree. Sau
commit/push, re-review chỉ cần re-pin exact SHA, verify validator thấy hai artifact, đổi directive task contract
thành `code-ready`, và nâng closure 9/12 → 12/12 nếu live diff vẫn đúng packet.

---

## Verdict 16 — `core-matcher-grouped-amount-parsing`, authority packet committed/pushed; CODE_READY (2026-07-22)

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: 827d24d17e7004c15f277fb8a53f0cb7d90f6547
BASE_BRANCH: main
TARGET_FILES:
  - docs/dd-87-splitnameamount-decision-table-analysis.md
  - docs/standards/decisions.md
  - docs/autopilot-manifests/core-matcher-grouped-amount-parsing.json
  - docs/autopilot-core-split-name-amount-ambiguity-contract.md
  - .claude/commands/ap-29-core-split-name-amount-ambiguity-contract.md
  - docs/autopilot-backlog.md
  - docs/slice-readiness-verdicts.md
  - docs/auth-s4-session-handoff.md
SLICE: core-matcher-grouped-amount-parsing
IN_SCOPE: splitNameAmount exhaustive tagged-union contract, all positive parseMoney trailing candidates, exact unit assertions
OUT_OF_SCOPE: transports, DB/schema/migrations, ledger mutation, classifyAmount/FIFO, consumer picker implementation, ignored historical table lift
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none -- this slice is its own root dependency; parseMoney (packages/core/src/dates.ts:212) and splitNameAmount (packages/core/src/payments-logic.ts:38, pre-implementation signature) already on main
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (main=origin/main@827d24d; all eight TARGET_FILES re-opened at this SHA; the four DD-87-specific files -- analysis, manifest, task contract, AP-29 launcher -- verified byte-unchanged since they landed at 142e9fa; decisions.md unchanged since 142e9fa; auth-s4-session-handoff.md unchanged since eba1c27; backlog.md's core-matcher entry unchanged since original authoring; splitNameAmount still has only the test caller with its pre-implementation signature; no schema dependency)
CONTRACT_MATRIX: PASS (none|resolved|ambiguous tagged union; ambiguous has ordered candidate tuple and no top-level name/amount; ambiguity dedupes interpretations by (name,amount); re-checked all eight target files for drift after the concurrent-write incident below -- none found)
CLOSURE_MATRIX: PASS (12/12 -- authority is committed and pushed on main; this slice's only hard dependency, its own authority packet, is merged; implementation handoff artifacts are committed and pushed on the default branch)
ACCEPTANCE_MATRIX: PASS (DD-87 exact 18 rows + SNA-1..SNA-8; includes equal-amount/different-name Player 0 110k)
SECURITY_AND_MIGRATION_GATE: PASS (pure function; no IO/log/DB/migration; no second grammar or heuristic; rollback is code commit revert)
IMPLEMENTATION_ARTIFACTS: PASS (manifest + task contract + AP-29 launcher + backlog entry + this verdict all committed and pushed on origin/main@827d24d)
FIRST_IMPLEMENTATION_STEP: open a dedicated worktree from origin/main@827d24d, register the manifest via scope-gate, record the DD-87 design probe (Wang 110 500 / Player 2 110k / Player 0 110k) per the AP-29 launcher, then add the failing SNA/DD-87 tests before implementing
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: n/a -- CODE_READY; next event is the coding slice itself
```

**Đọc verdict:** blocker của Verdict 15 (authority packet ngoài pinned SHA) đóng đúng dự kiến, nhưng không
đơn giản như "commit rồi xong" -- giữa lúc verify, một session Cowork khác cùng đứng ở root working copy đã
commit nhầm đúng nội dung của phiên này dưới message của một slice khác (`eba1c27` mang subject
`fix(db): make migration-runner role creation race-safe...` nhưng tree là hai file docs của phiên này,
`ROADMAP.md` + `auth-s4-session-handoff.md`). Đã verify byte-for-byte trước khi tin: nội dung landing khớp
100% với bản đã review ở Verdict 15, không có drift; sự cố chỉ nằm ở commit MESSAGE, không ở nội dung. Cả
tám TARGET_FILE được re-open tại `827d24d` và so lại: bốn file DD-87-specific (analysis, manifest, task
contract, launcher) không bị bất kỳ commit nào đụng tới kể từ lúc land; `decisions.md`/`backlog.md`/
`auth-s4-session-handoff.md` cũng không đổi so với lúc land. G1/G3 và ba dòng closure matrix (1/11/12)
chuyển PASS đúng theo blocker đã đóng, không phải suy diễn. Task contract directive đổi `enforce` →
`code-ready`; backlog status đổi `planned` → `ready`.

> ⚠️ **Concurrent-write hazard cho người audit sau (không phải lỗi riêng của phiên này):** nhiều session
> Cowork chia sẻ một git identity (`Cowork <cowork@local>`) và một `.git/index` khi tất cả đứng ở root
> working copy thay vì mỗi session một worktree riêng. `scripts/autopilot-scope-gate` canh giữ vòng đời
> feature worktree (register/ready/cleanup theo manifest); nó **không** canh giữ docs commit chạy thẳng ở
> root working copy -- đủ để một session `git commit` bắt nhầm content session khác đang stage, dưới
> message của chính nó. Đây chính xác là cơ chế sinh ra `eba1c27` ở trên. Chi tiết đầy đủ + fix cơ chế
> (`scripts/ap-merge.sh`): Verdict 14, phần "Đính chính"/"Lỗ hổng cấu trúc lộ ra từ vụ `eba1c27`".

---

## Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
| 22/07/2026 | v2.0 | **Verdict 14 AMENDED (owner-ratified A1–A3), patch tại chỗ — slice/authority không đổi, chỉ sửa một dòng gate sai sự thật.** **A2:** bản đầu viết "chỉ nuốt `duplicate_object`" — chép từ backlog **không đo**; thực tế check tồn tại của `CREATE ROLE` không atomic với insert `pg_authid`, bên thua race raise **23505** áp đảo 42710 ~50:1, nên nuốt mỗi 42710 sẽ để nguyên chính cái race cần đóng. Nay **42710 hoặc 23505**; 42501 và mọi mã khác vẫn abort. **A1:** tạo role vô điều kiện abort khi DDL owner `NOCREATEROLE` (Postgres kiểm quyền trước khi thấy trùng) — vi phạm negative-scope #6; thêm existence pre-check. **A3:** test-only, `ALTER ROLE … PASSWORD` đồng thời → retry-tolerant; `test-harness.ts` vào TARGET_FILES + scope. Implementer dừng xin phê duyệt thay vì tự nới contract P0 — đúng gate. |
| 22/07/2026 | v1.9 | **Verdict 15 — DD-87 contract closed on disk, `NOT_CODE_READY` pending immutable authority.** Owner chốt exhaustive tagged union: ambiguity theo `(name,amount)`, equal-amount/different-name vẫn ambiguous, no top-level amount, no second grammar. Exact 18-row + SNA-1..8, manifest/task/AP-29/backlog authored. Closure 9/12 vì packet chưa commit/push; next trigger là origin/main commit chứa toàn bộ target rồi strict re-pin. |
| 22/07/2026 | v1.8 | **Verdict 14 — `db-migration-0000-idempotent-role-create` re-scoped từ `DESIGN_UNFIT` → `CODE_READY`.** Khung cũ ("làm 0000 atomic") bất khả thi vì 0000 applied + immutable; khung mới không đụng 0000. Phát hiện: `pg_advisory_lock` trong `migrate.ts` là **database-scoped**, nên comment "ngăn concurrent deploys interleave DDL" **không đúng cho object cluster-global** — sửa comment nằm trong scope. Cơ chế pin: role-ensure exception-handled ở runner, gated trên "0000 chưa applied". Acceptance BR-1..BR-7. Mở khoá `fileParallelism:true` (lý do (1) đã thoả sẵn nhờ `dbName` riêng). |
| 22/07/2026 | v1.7 | **Verdict 13 — d1b implemented (`04df464`), chờ merge tay.** 14 file, +984/−68; suite db 152 · web 146. Chọn handoff shape (a): migration `0018` expand-only + `auth_oauth_handoff_arm/_consume`; single-use bằng atomic UPDATE + partial UNIQUE giữ hash sau consume; `clock_timestamp()` (mang bài học D0a round-09). **Gate ĐẠT với 0 fix-round — slice đầu tiên sạch ngay lần đầu.** Ghi phát hiện quy trình: thrash tương quan với **thiết kế còn chuyển động lúc code**, không phải kích thước diff ⇒ **rút lại đề xuất nới luật 2×clean ở v1.2**. Safari/iOS vẫn ENABLEMENT_ONLY. |
| 22/07/2026 | v1.6 | **Verdict 12 — d1b `CODE_READY`, blocker đóng bằng đo đạc.** Probe 3 engine: **M1 (302 trần) thất bại trên cả ba**; mọi cơ chế commit first-party document trước đều thắng. Chốt **M3** (landing → auto-POST same-origin, noscript fallback) vì tái dùng pattern hai-hop B0 §8 và POST mang `Origin` cho `sameOriginRequest()` guard bước mutating. Thêm **D1B-11** anti-regression (assert callback trả document, **không** 302) — lưới bắt đúng failure-mode đã đo. Safari/iOS chuyển thành **ENABLEMENT_ONLY**: không chặn CODE_READY nhưng **chặn bật Google login**. |
| 22/07/2026 | v1.5 | **Acceptance `D1B-1..D1B-10` + Verdict 11 cho `auth-s4-d1b-oauth-session-rotation` = `NOT_CODE_READY`.** Live-repo verify cho thấy slice **không cần primitive mới** (`issueSession` đã có nhánh rotate; `auth_rotate_web_session` đã atomic từ D0a) — chỉ cần chạy nó ở ngữ cảnh same-site. **Blocker duy nhất:** cơ chế hop chưa pin; cookie `SameSite=Strict` có được gửi trên chuỗi redirect khởi phát cross-site hay không là browser-divergent, và chọn sai thì slice âm thầm vô dụng trong khi test mock vẫn xanh. D1B-2 vì thế bắt buộc bằng chứng **trình duyệt thật**. |
| 22/07/2026 | v1.4 | **Verdict 10 — `auth-s4-d1-google-adapter` implemented (`75bfa58`), chờ merge tay.** 17 file, +2841/−9; suite real-PG db 144 · core 111 · bot 3 · web 131; semgrep 0; OSV sạch sau khi thêm `jose@5`. Codex 6 vòng: 1–3 hội tụ, 4–6 lộ một vấn đề **ngoài matrix** (rotate session Strict qua callback cross-site) → phần rotation invented-scope đã **revert** về mint-fresh đúng D1-2/D1-13. **Accepted residual risk** + **enablement blocker `auth-s4-d1b-oauth-session-rotation`** ghi vào verdict và pin bền 3 nơi. Tạo artifact d1b (manifest + backlog block, `NOT CODE_READY` — còn thiếu acceptance + verdict). |
| 22/07/2026 | v1.3 | **Verdict 9 — `auth-s4-d1-google-adapter` = CODE_READY** tại `main@8f6a051`. Ba dependency đã merge + probe live; acceptance D1-1..15 có sẵn nên đây là **verdict-only gap**, nhưng vẫn re-verify từng precondition trên schema live (bài học D1E-18) thay vì tin matrix cũ. Verdict 4 (PLAN_READY, G3 FAIL) chính thức bị thay thế. |
| 22/07/2026 | v1.2 | **D1 email-token-core implemented → Verdict 8.** 7 file, +2555/−7, 128 test real-PG xanh. Gate đóng bằng **1 vòng sạch + independent directed review** (Codex phi tất định sau 9 vòng), không phải 2×clean — override thứ 2/3 slice. **D1E-18 tách 18a/18b**: 18a proven, 18b deferred-by-construction vì `link_codes` live là person/channel-scoped, account-issued link_code + merge plan thuộc order-4 (đã pin NEXT_REVIEW_TRIGGER). Manifest hợp thức hoá 2 scope-addition (`index.ts`, `README.md`). **Đề xuất hiệu chỉnh gate:** `review-code-readiness-gate.md` nên cho phép *"2 vòng sạch liên tiếp HOẶC 1 vòng sạch + independent directed review"* khi diff vượt ngưỡng file/LOC, để không phải override từng ca. |
| 22/07/2026 | v1.1 | **D1 email-token-core: NOT_CODE_READY → CODE_READY.** Author acceptance matrix **D1E-1..D1E-22** (tech doc §5, gồm reset-vs-consume + merge barrier mà manifest nêu là điều kiện READY) và **Verdict 7** pin `main@fc7d0a4`. Pin hai ranh giới: public verify/reset/login = order-4; DD-70(a) fence ngoài scope order-2. Chưa có code/migration — đây là authorization để mở worktree. |
| 22/07/2026 | v1.0 | **D0b implemented & merged — gate ĐẠT, không override.** `auth-s4-d0-session-web-boundary` squash-merged tại `main@93c5404` (issuance fence + logout-all route, zero DB change); 2 clean round liên tiếp (round-03/04), 2 fix round; real-PG green (db 97/97 · web 78). Thêm **Verdict 6** (historical evidence). Chuỗi auth: D0a ✅ → D0b ✅ → kế tiếp `auth-s4-d1-email-token-core`. |
| 22/07/2026 | v0.9 | Thêm machine classification theo readiness gate v1.2: giữ nguyên nội dung verdict lịch sử nhưng exclude chúng khỏi current authorization; Verdict 2 là active block duy nhất, D0b phải re-review sau dependency-state change. |
| 20/07/2026 | v0.8 | **D0a implemented & merged via owner override.** `auth-s4-d0-revoke-core` squash-merged (migration `0015`); 2-clean P0 gate not reached after 12 Codex rounds → closed on manual review + acceptance 22/22 + real-PG 97/97. Verdict 5a stands as CODE_READY authority; this row records the merge + override rationale. D0b unblocks on origin/main. |
| 20/07/2026 | v0.7 | DD-80 v1.88 closes Gate 3 with exact epoch equality, cross-account parent ordering/revalidation and atomic row materialization/count/audit; historical Verdict 3 superseded. Added fail-closed Verdict 5a/5b for D0a DB core and D0b web boundary; both await immutable authority, and D0b also awaits D0a merge. |
| 19/07/2026 | v0.6 | **v1.86 (AP-26 HALT MAX_ROUNDS/Codex round-03):** Verdict 3 amend — D0 thêm issuance fence `session-cookies.ts` (reject-and-reauth, không fallback-mint khi rotate null) + partial index `web_sessions(account_id) WHERE revoked_at IS NULL` trong 0015 (case D0-12/D0-13, tech v2.9b); giữ CODE_READY. Verdict 4 note — `auth_login_google` nhận preallocated `account_emails.id` cho cell 1 (AAD §3.3 giữ nguyên); giữ PLAN_READY. |
| 19/07/2026 | v0.5 | **v1.83 (AP-26 HALT v2):** Verdict 3 amend — migration D0 thêm rotate parent-first replace (đóng deadlock), auth_audit_events tạo tại D0 (order-2 reuse), scope thêm packages/db/src/index.ts. Verdict giữ CODE_READY với wording rollback mới; số migration theo tail thực tế (tech v2.9). |
| 19/07/2026 | v0.4 | **v1.78 corrections:** Verdict 4 thêm hard dependency order-2 `auth-s4-d1-email-token-core` (manifest mới, dark) + oauth migration dời 0017; D1-15 absence-check; PKCE lifecycle CHECK theo v1.78. Verdict 3 (D0) không đổi. |
| 19/07/2026 | v0.3 | **B0 → DD-80 ✅ (v1.77):** thêm Verdict 3 (`auth-s4-d0-revoke-core` = **CODE_READY**, authority `352e6ec`) + Verdict 4 (`auth-s4-d1-google-adapter` = PLAN_READY chờ D0 merge). Artifacts: 2 manifest + acceptance D0×10/D1×15 trong web_auth tech v2.8. RUN precondition: merge docs authority lên main trước khi mở worktree. |
| 19/07/2026 | v0.2 | **Reframe theo canonical gate.** Bỏ framework G1–G6 tự chế (trùng `review-code-readiness-gate.md`); đổi tên `ready-to-code-gate.md` → `slice-readiness-verdicts.md`; thay bằng verdict §7 pinned SHA `main@22c23aa` cho auth-s4 (NOT_PLAN_READY, chờ B0) và dd41 (NOT_CODE_READY, chờ DD-38/39 merge). |
| 19/07/2026 | v0.1 | (retired) 6-condition gate tự chế — superseded bởi canonical gate. |
