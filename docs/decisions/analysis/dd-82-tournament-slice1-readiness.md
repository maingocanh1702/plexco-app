<!-- review-readiness: enforce -->
# Readiness Gate — Tournament Slice 1 (DD-82)

> **Policy:** `standards/review-code-readiness-gate.md` v1.3 · **Template:** `templates/review-doc-plan-session-template.md` v1.2
> **Session:** readiness review cho "slice đầu tiên" của tournament (canonical `tournaments` + đăng ký + projector `public_tournaments`).
> **Reviewed:** 2026-07-21

---

## 0. Session input

```text
REQUEST: final-readiness
TARGET_FILES:
  - docs/standards/decisions.md (DD-82, DD-41, DD-06, DD-12, DD-83)
  - docs/decisions/analysis/dd-82-tournament-analysis.md
  - docs/features/FE/feature_tournament.md
  - docs/features/BE/feature_tournament_tech.md
  - packages/db/schema.ts
  - packages/db/migrations/0009_rls_policies_grants.sql
  - packages/db/migrations/0014_players_waitlist.sql
EXPECTED_OUTCOME: code ready?
BASE_BRANCH: main
SCOPE_REPO: /Users/…/Plexco app
USER_AUTHORIZED_EDITS: yes (đã encode OQ-1/OQ-5 resolutions vào specs)
```

---

## 1. Live-truth evidence (đã verify trên `main`)

| Kiểm tra | Kết quả |
|---|---|
| Default branch HEAD | `main @ ad10194129a2c46512301a584ca9cec572c11244` |
| Migrations committed | `0000–0014` (gồm `0014_players_waitlist.sql`) → **next-available = `0015`** |
| `session_type` / `tournament` trong `packages/db` | **0 match** (grep) — session_type chưa migrate; retire = coordinate DD-41, không backfill |
| `tournaments`/`tournament_registrations`/`public_tournaments` | **chưa tồn tại** — là bảng contract-to-build (slice này) |
| Bảng nền slice đọc/ghi (`tenants`, `sports`, `persons`, `memberships`) | tồn tại trên main (`schema.ts:152/31/39/165`) |
| `public_sessions` (khuôn clone) | tồn tại (`schema.ts:603`), migration `0006_discovery.sql` |
| RLS/grants pattern | `0009_rls_policies_grants.sql` (ENABLE/FORCE + `tenant_isolation` + grants; role `app` NOBYPASSRLS `0000`) |
| Marketplace/public projector runtime | **chưa build** (feature layer chưa build — BUILD-STATUS); `public_sessions` là bảng có sẵn nhưng projector chưa land |
| DD-12 guarded view + denial fence + projection version | **chưa build** trên main (re-scoped từ DD-73, gated DD-12) |
| DD-83 slug registry (`/tournament/<slug>`) | **chưa build** — DD-83 mới "chốt hướng" 2026-07-21 |

**Decisions in-scope đã đóng:** DD-82 (aggregate độc lập, chốt hướng) · TRN-OQ-1 (host config `registration_policy`) · TRN-OQ-5 (nhánh a, không backfill). Bracket/entry-fee/waitlist/roster-disambiguator = out-of-scope (negative).

---

## 2. Phát hiện chính — "slice đầu" như mô tả là MEGA-SLICE + chạm dependency chưa build

Yêu cầu "canonical `tournaments` + đăng ký + projector `public_tournaments`" **gộp nhiều aggregate + reach vào dependency chưa có trên main**:

1. **Vượt budget slice** (`≤300 LOC · ≤3 modules · ≤1 migration`): gộp bảng `tournaments` + `tournament_registrations` + service đăng ký 3-mode (gồm approval workflow) + projector + read model = nhiều module, >1 concern.
2. **Projector → public chạm 2 dependency CHƯA build trên main:**
   - **DD-12** guarded public read (denial fence + projection version + grants) — chưa runtime.
   - **DD-83** slug registry cho `/tournament/<slug>` — mới chốt hướng, chưa build.
   ⇒ Phần public **không** thể code trong slice-1 mà không kéo theo hai prior-slice chưa tồn tại.
3. **Registration approval** (`policy='approval'` → `pending` + host duyệt) là một sub-flow riêng (giống `join_requests`), không nên gộp vào miếng nền.

### Đề xuất tách slice (mechanism-named, bottom-up)

| Slice | IN SCOPE | Dependency | Trạng thái |
|---|---|---|---|
| **1a `tournaments-canonical`** | Bảng `tournaments` + RLS/FORCE + grants + host CRUD (create/edit/publish-status/cancel/complete) tenant-private. **Không** registration, **không** public | Root (chỉ đọc `tenants`/`sports`, đã có) | **Node thấp nhất — first code candidate** |
| 1b `tournament-registration-direct` | `tournament_registrations` + đăng ký `members_only`/`anyone` (thẳng `registered`) + withdraw + slot-count | 1a | sau 1a |
| 1c `tournament-registration-approval` | `policy='approval'`: `pending` + host approve/reject | 1a, 1b | sau 1b |
| 1d `public-tournaments-projector` | `public_tournaments` read model + projector (whitelist, no money/PII, no tenant_id) + invariant tests | 1a; **DD-12 pattern** | chờ DD-12 |
| 1e `tournament-public-route` | `/tournament/<slug>` guarded view + OG | 1d; **DD-83 slug registry** | chờ DD-83 |

**Node thấp nhất chưa build = 1a `tournaments-canonical`.** Đây là slice đầu đúng nghĩa (root dependency, không kéo DD-12/DD-83).

---

## 3. G1–G6 cho slice **1a `tournaments-canonical`**

| Gate | Đánh giá | Kết |
|---|---|---|
| **G1 Decision** | DD-82 chốt hướng; TRN-OQ-1/OQ-5 đã owner-resolve; registration/public/bracket/money = out-of-scope negative | **PASS** |
| **G2 Spec** | `feature_tournament(.md/_tech)` mới ở **Draft**, chưa `Reviewed`. Contract cho phần canonical đủ (DDL/RLS/status enum/error codes), nhưng status doc chưa đạt gate A4 | **PARTIAL** |
| **G3 Dependency** | 1a chỉ đọc `tenants`/`sports` (có trên main); ghi `tournaments` (bảng của chính slice). Không dependency chưa-merge | **PASS** |
| **G4 Test** | Spec có bảng test nhưng chưa pin expected result đầy đủ + chưa đặc tả **pre-code invariant tests** (RLS cross-tenant isolation cho `tournaments`; CHECK enums) như artifact land-trước | **PARTIAL** |
| **G5 Scope** | Với 1a (chỉ canonical + CRUD): mechanism-named, có negative scope, ≤1 migration, trong budget | **PASS** (cho 1a; mega-slice gốc = FAIL) |
| **G6 External** | v1 không money/PII/provider; canonical tenant-private (chưa public byte). Không external gate | **PASS** |

---

## 4. Closure matrix 12/12 (slice 1a)

| # | Gate | Evidence | PASS/FAIL |
|---|---|---|---|
| 1 | Authority snapshot pin theo SHA | `main@ad10194` + target files §0 | PASS |
| 2 | Decision trong scope đã chốt | DD-82 + TRN-OQ-1/5 | PASS |
| 3 | Scope IN/OUT + owner rõ | §2 (1a IN; registration/public OUT) | PASS |
| 4 | Dependency phân loại đủ | 1a root; 1d/1e chờ DD-12/DD-83 (DEFERRED/PRIOR) | PASS |
| 5 | Live schema/code khớp doc | §1 (BE spec khớp `public_sessions`/RLS/`0009`; 0014→next 0015) | PASS |
| 6 | Data/API/state/auth contract đủ | tournaments DDL + status machine + RLS (đủ cho 1a) | PASS |
| 7 | Fail-closed/idempotency/order đủ | RLS fail-closed; publish idempotent; CRUD | PARTIAL — pin transition owner + idempotency key CRUD |
| 8 | Open question trong scope = 0 | TRN-OQ-1/5 đóng; 2/3/4/6 out-of-scope | PASS |
| 9 | Acceptance matrix có expected result | §5 test spec chưa đủ expected/pre-code | **FAIL** |
| 10 | Migration/security/rollback pin | migration `0015` next; DROP rollback; RLS/grants | PASS |
| 11 | First slice có hard dependency merged | 1a là root; không hard dep chưa-merge | PASS |
| 12 | Implementation handoff sẵn sàng | autopilot slice doc/manifest/launcher **chưa author** | **FAIL** |

**10/12 PASS · 2 FAIL (#9, #12) · #7 PARTIAL** ⇒ chưa đạt 12/12.

---

## 5. Verdict block

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-07-21
AUTHORITY_SHA: ad10194129a2c46512301a584ca9cec572c11244
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/decisions/analysis/dd-82-tournament-analysis.md
  - docs/features/FE/feature_tournament.md
  - docs/features/BE/feature_tournament_tech.md
  - packages/db/schema.ts
  - packages/db/migrations/0009_rls_policies_grants.sql
  - packages/db/migrations/0014_players_waitlist.sql
SLICE: tournaments-canonical (slice 1a; miếng nền đúng nghĩa sau khi tách mega-slice)
IN_SCOPE: bảng tournaments (tenant-private) + ENABLE/FORCE RLS + grants + host CRUD (create/edit/publish-status/cancel/complete)
OUT_OF_SCOPE: registration (1b/1c), public_tournaments projector (1d, chờ DD-12), /tournament/<slug> route (1e, chờ DD-83), bracket/standings/entry-fee/waitlist
G1_DECISION: PASS
G2_SPEC: PARTIAL
G3_DEPENDENCY: PASS
G4_TEST: PARTIAL
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none (1a là root; DD-12/DD-83 chỉ chặn 1d/1e, không chặn 1a)
PRIOR_SLICES: none for 1a; (1d chờ DD-12 guarded-view slice, 1e chờ DD-83 slug-registry slice)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PARTIAL
CLOSURE_MATRIX: FAIL (10/12 PASS; #7 PARTIAL; #9 and #12 FAIL)
ACCEPTANCE_MATRIX: FAIL
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: FAIL
FIRST_IMPLEMENTATION_STEP: slice 1a `tournaments-canonical` — sau khi đóng 3 blocker dưới
REMAINING_BLOCKERS:
  - blocker: Spec pair đang Draft, chưa Reviewed (G2/A4)
    owner: feature_tournament(.md/_tech) — review gate + owner
    resolution: promote sang Reviewed (contract canonical đã đủ sau khi encode OQ-1/OQ-5); ghi acceptance checklist chuyển thẳng thành issue
  - blocker: Acceptance matrix chưa pin expected result + pre-code invariant tests (G4/closure #9)
    owner: BE spec §5 Testing
    resolution: đặc tả trước code — RLS cross-tenant isolation cho tournaments; CHECK enums (status/registration_policy); publish state-transition; idempotency key CRUD; mỗi row có expected state/output + test layer
  - blocker: Implementation artifacts chưa author (B4/closure #12)
    owner: autopilot kit
    resolution: tạo docs/autopilot-tournaments-canonical.md + manifest + launcher + backlog entry, commit main trước khi mở worktree
NEXT_REVIEW_TRIGGER: specs promote Reviewed + acceptance matrix expected-results committed + autopilot artifacts committed on main
```

---

## 6. Kết luận (plain)

**Chưa code được — nhưng vướng ít và rõ.** Miếng nền đúng nghĩa là **slice 1a: bảng `tournaments` tenant-private + RLS + host CRUD** — nó là root dependency, không kéo theo gì chưa build. "Canonical + đăng ký + projector" như mô tả ban đầu là **mega-slice**, và phần projector/public còn **chạm DD-12 (guarded view) và DD-83 (slug registry) — cả hai chưa có trên main**, nên phải tách ra slice sau.

Ba việc để 1a thành `CODE_READY`:
1. **Promote spec pair Draft → Reviewed** (contract canonical đã đủ sau khi encode OQ-1/OQ-5 hôm nay).
2. **Pin acceptance matrix + invariant tests trước code** (RLS isolation, CHECK enums, publish transition).
3. **Author autopilot artifacts** (slice doc + manifest + launcher + backlog) và commit lên main.

Sau đó slice 1a mở worktree code được ngay; 1b/1c (đăng ký) nối tiếp; 1d/1e (public) chờ DD-12 + DD-83.

---

## 7. Nguồn

`main@ad10194` (`git rev-parse HEAD`) · `packages/db/migrations/0000–0014` (`ls`) · grep `session_type|tournament` = 0 · `schema.ts` (tenants:152, sports:31, persons:39, memberships:165, sessions:214, players:276, public_sessions:603) · `0009_rls_policies_grants.sql` · `decisions.md` DD-82/41/12/83/06 · `dd-82-tournament-analysis.md` · `feature_tournament(.md/_tech)` v0.1 · `standards/review-code-readiness-gate.md` v1.1 · `templates/review-doc-plan-session-template.md` v1.0.
