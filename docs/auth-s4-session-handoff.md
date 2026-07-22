# SESSION HANDOFF — Plexco Auth S4 (D0→D1 provider swap)

> **Đọc file này để tiếp quản mảng Auth S4 mà không cần context phiên trước.** Self-contained.
> **KHÔNG phải authority** — authority là `docs/standards/decisions.md` (DD-80) + `packages/db` live +
> `docs/slice-readiness-verdicts.md`. File này là **ảnh chụp trạng thái thực thi** để senior dev khác
> resume độc lập.
>
> **Snapshot pin:** `main@172dfff` · D0a branch `feat/auth-s4-d0-revoke-core@413b33e` · ghi 2026-07-20.
> **Ngôn ngữ:** giải thích = tiếng Việt; block để paste terminal / prompt cho Claude Code = tiếng Anh.
>
> **✅ CẬP NHẬT 2026-07-20 — D0a ĐÃ MERGE:** review loop dừng ở round-12 (owner quyết); slice squash-merge vào `main` bằng **owner override** gate 2-clean (manual review + acceptance 22/22 + real-PG 97/97). §4 dưới giữ làm hồ sơ lịch sử vòng review. **Hot area giờ chuyển sang D0b `auth-s4-d0-session-web-boundary`.**

---

## 0. TL;DR — đang ở đâu, làm gì tiếp

Plexco vừa qua Phase 0→1 (foundation + auth v3 Telegram-era đã land). Việc đang chạy: **thay auth
Telegram-era → Google/email**, khởi động bằng slice DB core **D0a** (`auth-s4-d0-revoke-core`) —
**miếng code feature-layer đầu tiên** sau foundation.

- **D0a ĐÃ MERGE** (2026-07-20, owner override) — migration `0015` live trên `main`. Review loop chạy 12 round
  (10 finding fix); gate 2-clean không đạt nên đóng bằng manual review + acceptance 22/22 + real-PG 97/97.
  Việc nóng giờ là **D0b**.
- Sau D0a merge → mở D0b (web boundary) → D1 email-token → D1 google-adapter. Dependency chain cứng.
- Song song, có 2–3 autoprompt docs-only P2 launcher-ready có thể chạy ngay mà không đụng D0a.

**Việc gần nhất cần người quyết:** (1) đóng vòng review D0a (đang có nguy cơ MAX_ROUNDS — xem §4);
(2) push `main@172dfff` lên remote (sandbox bị chặn network — xem §8); (3) chạy real-Postgres để lấy
bằng chứng test G4 (sandbox không chạy được Docker — test đang skip).

---

## 1. Project là gì (1 đoạn)

**Plexco** = platform 2 phía đa môn thể thao phong trào. Host quản kèo + đối soát chuyển khoản; player
marketplace cross-CLB. **PostgreSQL + domain model = canonical store** (RLS fail-closed); web + Zalo +
Messenger đều là surface, sync qua outbox→projectors. Stack: TypeScript, Next.js App Router, Drizzle,
Postgres. Monorepo pnpm: `packages/core` (logic thuần) · `packages/db` (schema + RLS choke-point) ·
`apps/web` · `apps/bot`. Chi tiết kiến trúc: `docs/00-start-here/HANDOFF.md`.

**Tiến độ code ~20%:** foundation (migrations `0000–0013` + RLS + core logic) ✅ trên `main`; auth v3
Telegram-era ✅ merged nhưng bị DD-37 supersede → đang thay bằng Google/email; feature layer (session/
reconcile/sync/marketplace/billing/bot) ⬜ chưa build.

---

## 2. Trạng thái repo (pin SHA — verify-on-disk trước khi tin)

| Thứ | Giá trị | Ghi chú |
|---|---|---|
| `main` HEAD | `172dfff` | docs-only trên `aa89b27`; code baseline = migrations `0000–0013` (chưa có `0014`/`0015`) |
| Authority auth | **DD-80 v1.88** (`decisions.md`), bundle immutable tại `origin/main@033ccc8` | G3 revoke-all concurrency contract + D0a/D0b decomposition |
| D0a worktree | `feat/auth-s4-d0-revoke-core@f5b0d6d` | branch có commit `b691c8b`(base) + 5 fix round-01..06 |
| `main` vs `origin/main` | local **1 ahead** (`172dfff` chưa push) | fast-forward sạch |
| Verdict D0a | **CODE_READY** (Verdict 5a, `slice-readiness-verdicts.md`) | nhưng runtime chưa đóng vòng review |
| Verdict D0b | NOT_CODE_READY | chặn cứng ở "D0a chưa merge" |

```bash
# verify-on-disk (chạy từ project root trên máy owner)
git log --oneline -1 main
git worktree list
git log --oneline -3 feat/auth-s4-d0-revoke-core
cat .autopilot/worktrees/auth-s4-d0-revoke-core/.autopilot/state/auth-s4-d0-revoke-core/regions.log
```

---

## 3. Slice D0a — nội dung & hợp đồng phải nắm

**Mục tiêu:** account-session **epoch** làm authority duy nhất cho revoke-all linearizable (logout-all).
Một migration atomic `0015_auth_revoke_account.sql` sở hữu: epoch của account/session · create/resolve/
rotate parent-lock + revalidation · revoke helper/wrapper · audit materialization · exports/tests/mirror.

**Files (scope manifest `docs/autopilot-manifests/auth-s4-d0-revoke-core.json`):**
`packages/db/migrations/0015_auth_revoke_account.sql` · `packages/db/schema.ts` (mirror) ·
`packages/db/src/auth.ts` · `packages/db/src/index.ts` · `packages/db/src/auth.test.ts` ·
`packages/db/src/rls-invariants.test.ts` · `packages/db/README.md`.

**Hợp đồng G3 (bất biến — đừng phá khi sửa):**
- **Epoch equality = validity authority DUY NHẤT** (G3-I1), KHÔNG phải `revoked_at`/`expires_at`.
  `auth_revoke_account_sessions` bump `accounts.session_epoch += 1` rồi bulk-materialize `revoked_at`
  cho audit/count/forward-rollback.
- **Public wrapper `auth_revoke_all_web_sessions(token_hash)`** derive account **server-side** từ current
  session; **không bao giờ** nhận `account_id` từ caller. Chỉ wrapper này được `GRANT EXECUTE ... TO app`;
  helper by-account KHÔNG grant.
- **Parent-first lock order** (account `FOR UPDATE`) trước khi re-read candidate → chống deadlock với rotate.
- **Fail-closed:** token invalid/replayed/stale-epoch ⇒ `RETURN NULL`, zero mutation.

**Lịch sử fix quan trọng (đọc để không tái phạm):**
- **round-06 [P1] — ĐÃ FIX (`f5b0d6d`).** Bản cũ re-read candidate bằng `revoked_at IS NULL`: nếu rotate
  đồng thời flip `revoked_at` (không bump epoch) trước re-read → predicate NULL → abort → bỏ sót revoke
  (vi phạm G3 §5 "rotate wins X lock"). **Fix:** re-read bằng `minted_epoch` (cột bất biến) so với
  `session_epoch` đọc dưới account lock. `minted_epoch = old_epoch` ⇒ generation hiện hành ⇒ vẫn revoke
  cả account; `minted_epoch < old_epoch` ⇒ replay thật ⇒ NULL. Xem `0015...sql:~296-320`.
- **round-08 [P2] — CÒN MỞ.** Re-read (minted_epoch path) **bỏ mất check `expires_at`**: token expire
  *trong lúc* chờ lock vẫn bump/revoke. Nhẹ, nhưng là finding đang giữ vòng review chưa clean.

---

## 4. ⚠️ Vòng review D0a đang churn — ĐIỂM QUYẾT ĐỊNH

Autopilot chạy tới khi **2 round FULL-base Codex clean liên tiếp**. Diễn tiến ledger (`regions.log`):

```
round-04: CLEAN (1/2)
round-05: P2 (barrier test) → reset
round-06: P1 (rotate/logout-all) → fix f5b0d6d
round-07: CLEAN (1/2)
round-08: P2 (expires_at re-read) → reset      ← đang ở đây; fix-round-count=6
```

**Rủi ro:** đã 8 round, `fix-round-count=6`. Slice split-trước (AP-26 monolith) từng **MAX_ROUNDS halt ở
cap 5**. Đây là pattern REGION_THRASH mà repo cảnh báo. **Senior dev cần quyết:**
1. Để autopilot fix nốt round-08 P2 (`expires_at` trong re-read) rồi cầu 2 clean — hoặc
2. **Dừng loop, review tay** finding còn lại (đều P2 nhỏ), tự đóng và manual merge (P0 **không** auto-merge
   dù sao — luôn cần người merge). Verdict 5a đã CODE_READY nên đủ căn cứ manual-close nếu P2 residual chấp nhận được.

**Tuyệt đối:** đừng sửa file trong worktree `auth-s4-d0-revoke-core` **khi autopilot còn chạy** (sẽ clobber).
Kiểm tra loop còn sống không: xem timestamp round mới nhất trong state dir.

---

## 5. ⛔ HARD RULES cho mảng auth (vi phạm = rò rỉ session/tiền/PII)

1. **Epoch fail-closed** là validity authority duy nhất; không nới sang `revoked_at`/`expires_at` làm authority.
2. **P0 = manual workflow only.** Auth/token/migration scope bị canonical v0.6.0 cấm autopilot codegen tự
   merge. **Không auto-merge P0 bất kể count.** Luôn manual merge sau review.
3. **2 clean FULL-base liên tiếp** trước khi coi review đóng; scope-gate READY; STOP_AT_READY.
4. **Wrapper không nhận `account_id`**; chỉ grant đúng MỘT wrapper cho `app`; không grant helper by-account.
5. **Migration expand-only + đúng MỘT `CREATE OR REPLACE`** cho rotate (lock-order-only); rollback =
   DROP function/table/index mới + revoke grant + restore định nghĩa rotate `0012`, **không** data migration.
6. **RLS/tenant HARD RULES chung** vẫn áp dụng (xem `docs/00-start-here/HANDOFF.md §3`): mọi query
   tenant-scoped qua `tenantRepo`; tiền/PII không ra public; không multi-master; i18n `t(vi,en)`.

---

## 6. Chuỗi việc tiếp theo (dependency-gated)

Thứ tự bắt buộc (auth-first, đồng bộ Verdict 5a/5b + DD-80 §10):

1. ~~Đóng D0a → manual merge~~ **✅ DONE (2026-07-20)** — merged via owner override (real-PG 97/97).
2. **D0b** `auth-s4-d0-session-web-boundary` — unblock **chỉ sau** D0a merged probe trên `origin/main`
   (`0015::auth_revoke_all_web_sessions` + `route.ts::revokeAllWebSessions`). Owns: issueSession stale-cookie
   reject-and-reauth + 2 live caller mappings + `/api/auth/logout-all` route + CSRF + tests. **Zero DB change.**
   Manifest + backlog block đã có.
3. **D1 email-token** `auth-s4-d1-email-token-core` (P0, HOLD) — sau D0a+D0b merge. CODE DARK: storage +
   validators + parent-first helpers, provider fail-closed OFF. Migration `0016`. Manifest + backlog block đã có.
4. **D1 google-adapter** `auth-s4-d1-google-adapter` (P0, HOLD) — sau D0a+D0b+email-token merge. oauth
   transactions + Lax binding + OIDC proof + §4 collision matrix. Migration `0017`. Enablement gate:
   google-oauth-client-config (KMS/env), A3-legal-PII (go-live). Manifest + backlog block đã có.
5. `docs-auth-d1-packet` (AP-28, HOLD) — packet copy-paste-grade cho D1, unblock sau D0a+D0b merge.

**Bằng chứng còn thiếu (không phải review blocker nhưng chặn "đã build" thật):** sandbox không chạy được
real-Postgres (Docker EPERM) nên test D0-* đang **skip**. Cần chạy trên máy có Postgres để đóng G4:
```bash
docker compose -f infra/docker-compose.yml up -d postgres
DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm test
```

---

## 7. Hàng đợi autoprompt (đã cập nhật phiên này)

**Đang chạy:** `auth-s4-d0-revoke-core` (D0a) — 1 slice in-flight.

**Launcher-ready docs-only P2 — chạy song song NGAY cạnh D0a được** (disjoint scope + invariant):

| Slice | invariant | Parallel với D0a? |
|---|---|---|
| `infra-inbound-webhook-auth-evidence` (AP-23, ready) | api-contract | ✅ |
| `infra-provider-limits-evidence` (AP-24, ready) | build-config | ✅ |
| `infra-egress-compatibility-evidence` (AP-22, **ready** — vừa promote) | build-config | ⚠️ đụng build-config với AP-24 → chạy SAU AP-24 |
| `docs-session-management-acceptance-checklist` (AP-25, ready) | schema | ⛔ đụng token `schema` với D0a → đợi D0a xong |

→ Có thể launch ngay **AP-23 + AP-24 song song**. AP-22 sau AP-24. AP-25 sau D0a.

**Đã bổ sung phiên này (commit `172dfff`):**
- Backlog: thêm block `auth-s4-d1-email-token-core` + `auth-s4-d1-google-adapter` (khớp manifest đã có,
  trước đó manifest mồ côi không có task block).
- `infra-egress-compatibility-evidence`: `planned` → `ready`.
- Tạo manifest `core-matcher-grouped-amount-parsing.json` (P2 bugfix, `money-model`/`shared-core`,
  proposal-only) + wire vào backlog. **Launcher-ready** nhưng đụng `money-model` → để owner quyết có launch.

**Cách launch một autoprompt** (theo `docs/autopilot-templates/phase1-fable5-7h-PR-RUN.md`): mở worktree
riêng base `main`, `scripts/autopilot-scope-gate register --manifest docs/autopilot-manifests/<slug>.json`
(HALT nếu đụng scope/invariant/dep), rồi chạy session Claude Code với launcher tương ứng, STOP_AT_READY,
manual merge. P0 (auth/identity/billing/migration) = **manual only, không launcher**.

---

## 8. Việc thủ công đang chờ owner

1. **Push `main@172dfff`** — sandbox bị chặn (`403 from proxy after CONNECT`). Từ máy owner:
   ```bash
   cd "…/Plexco app" && git push origin main   # 1 ahead, fast-forward sạch
   ```
2. **Đóng vòng review D0a** (§4) rồi manual merge.
3. **Real-Postgres test** (§6) để có bằng chứng G4.
4. Working-tree còn vài file chưa commit **không thuộc phiên này** (`autopilot-ONBOARDING.md`,
   `autopilot-templates/autopilot-invariants.md`, `scripts/autopilot-onboard*.sh`) — owner tự quyết.

---

## 9. Đọc thêm (doc map)

| Cần gì | File |
|---|---|
| Kiến trúc tổng + 5 HARD RULES | `docs/00-start-here/HANDOFF.md` |
| Trạng thái build tổng | `docs/standards/BUILD-STATUS.md` |
| Decision log (DD-80 auth) | `docs/standards/decisions.md` |
| Hợp đồng G3 revoke-all | `docs/g3-revoke-all-concurrency-probe-seed.md` |
| B0 auth credential lifecycle | `docs/b0-auth-credential-lifecycle-design-probe.md` |
| Verdict slice (5a/5b) | `docs/slice-readiness-verdicts.md` |
| Spec auth Product/BE | `docs/features/feature_web_auth_onboarding.md` + `BE/feature_web_auth_onboarding_tech.md` (v2.10) |
| SI-1..SI-8 invariant table | `docs/features/BE/auth-security-invariant-table.md` |
| Backlog + manifests | `docs/autopilot-backlog.md` · `docs/autopilot-manifests/` |
| Gate review readiness | `docs/standards/review-code-readiness-gate.md` + `docs/templates/review-doc-plan-session-template.md` |

---

## Changelog

| Ngày | Thay đổi |
|---|---|
| 2026-07-20 | Tạo handoff. Snapshot: `main@172dfff`, D0a `f5b0d6d` review round-08 (P2 open, streak đứt), fix-round-count=6. Ghi chuỗi D0→D1, autoprompt queue, MAX_ROUNDS risk, việc thủ công (push/PG test). |
