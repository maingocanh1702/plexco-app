# Slice Readiness Verdicts — Plexco

> **Đây KHÔNG phải nguồn rule mới.** Rules ở `standards/review-code-readiness-gate.md` (owner-accepted 2026-07-19). File này chỉ **áp dụng** gate đó để ra verdict nhị phân cho các slice gần nhất, dùng đúng template §7 và closure matrix §8.
> **Snapshot pin (bất biến):** `AUTHORITY_SHA = 22c23aab080183913d2852805a085bba1057a91a` (`main`) · verify 2026-07-19. Nhánh làm việc hiện tại `feat/session-waitlist-expand@aa8afae` **không** phải base; mọi verdict pin theo `main`.
> **Live truth đã verify (`main@22c23aa`):** feature layer trống — không có projector source ghi `public_sessions`; không có auth Google/`account_emails` source; `0014_players_waitlist` **không** trên `main`; `0006_discovery.sql` vẫn có `skill_level` và **thiếu** toàn bộ field DD-41 (`session_type`/`level_*_rank`/`gender_restriction`/`age_*`).

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
CONTRACT_MATRIX: PASS
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
| Auth S4 slice đầu | ~~`NOT_PLAN_READY`~~ → **D0 `CODE_READY` · D1 `PLAN_READY`** (DD-80 ✅, Verdict 3/4) |
| `dd41-public-session-projection-fields` | `NOT_CODE_READY` → chờ DD-38/39 merge + artifacts |
| Toàn cluster DD-73..78 như một slice | `NOT_CODE_READY` (gate §9) |
| DD-76/77 | chỉ xét PLAN/CODE sau product-evidence baseline + owner threshold |

## Chuỗi slice ưu tiên (đồng bộ gate §9 + reality auth-first)

1. **`auth-s4-account-session-core`** — ~~chặn ở B0 approval~~ → **B0 ✅ DD-80 (v1.77)**; D0 `CODE_READY` (Verdict 3), D1 `PLAN_READY` chờ D0 merge (Verdict 4).
2. `dd41-public-session-projection-fields` — điểm vào chuỗi share; chặn ở DD-38/39 merge.
3. `dd12-guarded-public-read` — projector + fence + guarded view + grants + projection version.
4. `dd73-session-share-route` — `/s/<id>` + OG/image + join revalidation + telemetry.
5. `dd74-75-activity-intent-projector` — sau allocation owner + dependency.
6. `dd76-77-feed-kudos` — chỉ sau product-evidence baseline + owner threshold.

---

---

## Verdict 3 — `auth-s4-d0-revoke-core` (re-review sau DD-80, 2026-07-19)

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
IN_SCOPE: internal revoke-by-account helper + public wrapper derive-from-current-session + POST /api/auth/logout-all + CSRF + tests + schema mirror B0 §9(a)
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
CONTRACT_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS (D0-1..D0-10, expected result cụ thể, grant/RLS trên Postgres thật)
SECURITY_AND_MIGRATION_GATE: PASS (0015 expand-only: helper KHÔNG grant app/app_worker, wrapper không nhận account_id; rollback = DROP function + revoke grant, không data migration)
IMPLEMENTATION_ARTIFACTS: PASS (manifest + acceptance matrix + first step)
FIRST_IMPLEMENTATION_STEP: mở worktree `feat/auth-s4-d0-revoke-core` từ main → viết `packages/db/migrations/0015_auth_revoke_account.sql` (internal `auth_revoke_account_sessions` + public wrapper theo B0 §6.1/§6.2) + mirror schema §9(a) → route `/api/auth/logout-all` → chạy D0-1..D0-10
REMAINING_BLOCKERS: none
```

**RUN precondition (không phải review blocker):** trước khi mở worktree, merge docs authority (`c1a3957` + `352e6ec`, docs-only nội dung) lên `main` để worktree đọc đúng DD-80/manifest/acceptance từ base — theo flow docs-only của `phase1-fable5-7h-PR-RUN.md`.

## Verdict 4 — `auth-s4-d1-google-adapter` (2026-07-19)

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
IN_SCOPE: auth_oauth_transactions + Lax binding cookie; state/nonce/PKCE + OIDC proof matrix; collision table §4 (8 cell); session issue
OUT_OF_SCOPE: email bundle (flag OFF); Facebook (DD-33 external gate); email-change/rebind từ Google claim; auto-merge conflict (→DD-53); Telegram removal
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: FAIL (prior slice D0 chưa merge main — dep_check `auth_revoke_account_sessions` trong 0015 chưa tồn tại)
G4_TEST: PASS (acceptance D1-1..D1-15)
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:google-oauth-client-config,A3-legal-PII
HARD_DEPENDENCIES: auth-s4-d0-revoke-core = NOT MERGED
PRIOR_SLICES: auth-s4-d0-revoke-core
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

## Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
| 19/07/2026 | v0.3 | **B0 → DD-80 ✅ (v1.77):** thêm Verdict 3 (`auth-s4-d0-revoke-core` = **CODE_READY**, authority `352e6ec`) + Verdict 4 (`auth-s4-d1-google-adapter` = PLAN_READY chờ D0 merge). Artifacts: 2 manifest + acceptance D0×10/D1×15 trong web_auth tech v2.8. RUN precondition: merge docs authority lên main trước khi mở worktree. |
| 19/07/2026 | v0.2 | **Reframe theo canonical gate.** Bỏ framework G1–G6 tự chế (trùng `review-code-readiness-gate.md`); đổi tên `ready-to-code-gate.md` → `slice-readiness-verdicts.md`; thay bằng verdict §7 pinned SHA `main@22c23aa` cho auth-s4 (NOT_PLAN_READY, chờ B0) và dd41 (NOT_CODE_READY, chờ DD-38/39 merge). |
| 19/07/2026 | v0.1 | (retired) 6-condition gate tự chế — superseded bởi canonical gate. |
