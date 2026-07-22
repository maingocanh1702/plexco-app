<!-- review-readiness: enforce -->
# Slice Readiness Verdicts — Plexco

> **Đây KHÔNG phải nguồn rule mới.** Rules ở `standards/review-code-readiness-gate.md` (owner-accepted 2026-07-19). File này chỉ **áp dụng** gate đó để ra verdict nhị phân cho các slice gần nhất, dùng đúng template §7 và closure matrix §8.
> **Snapshot pin (bất biến):** `AUTHORITY_SHA = 22c23aab080183913d2852805a085bba1057a91a` (`main`) · verify 2026-07-19. Nhánh làm việc hiện tại `feat/session-waitlist-expand@aa8afae` **không** phải base; mọi verdict pin theo `main`.
> **Live truth đã verify (`main@22c23aa`):** feature layer trống — không có projector source ghi `public_sessions`; không có auth Google/`account_emails` source; `0014_players_waitlist` **không** trên `main`; `0006_discovery.sql` vẫn có `skill_level` và **thiếu** toàn bộ field DD-41 (`session_type`/`level_*_rank`/`gender_restriction`/`age_*`).
> **Current auth refresh (2026-07-20):** `origin/main@033ccc8fd9c3f247abf8aa0cb5a0f48b96d006e2` — DD-80 v1.88 authority bundle immutable on main. **Verdict 5a (D0a) = CODE_READY** (re-pinned 033ccc8); Verdict 5b (D0b) `NOT_CODE_READY` pending D0a merge. Verdicts 1/3/4 remain historical snapshots only.
> **D0a IMPLEMENTED & MERGED (2026-07-20):** slice `auth-s4-d0-revoke-core` squash-merged to `main` (migration `0015` live). The P0 "2 consecutive FULL-base Codex clean" gate was **NOT reached** after 12 rounds (10 real findings fixed incl. round-06 epoch-vs-`revoked_at` P1; round-11 self-caught + `git revert`ed) → merge is a **documented owner override** resting on manual review + acceptance coverage 22/22 + real-Postgres 97/97, **not** an automated clean-round pass. See `.autopilot/state/auth-s4-d0-revoke-core/HALT-MAX_ROUNDS.txt` + the squash commit. **Verdict 5b (D0b) unblocks** once the D0a squash lands on origin/main.
> **D0b IMPLEMENTED & MERGED (2026-07-22):** slice `auth-s4-d0-session-web-boundary` squash-merged to `main@93c5404` (issuance fence + logout-all route; zero DB change). Unlike D0a, the P0 **"2 consecutive FULL-base Codex clean rounds" gate was MET** (round-03/04, only 2 fix rounds) — **no owner override**. Real-Postgres suite green (db 97/97 unchanged · core 111 · bot 3 · web 78). Recorded as **Verdict 6**. Next in chain: `auth-s4-d1-email-token-core`.
> **Machine classification (2026-07-22, final for the D0/D1 core run):** Verdicts 1/3/4/5a/5b/6/7/8 are immutable historical evidence. **Verdict 2** (`dd41-public-session-projection-fields`, NOT_CODE_READY) is the only active block in this tracker. Verdict 7's authorization was consumed by the implementation recorded in Verdict 8; no fresh D1 verdict is pending. The next auth authorization required is the order-4 identity companion, which inherits the D1E-18b barrier obligation.

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

## Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
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
