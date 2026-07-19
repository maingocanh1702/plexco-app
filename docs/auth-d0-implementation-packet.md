# 🔐 Auth D0 Implementation Packet — draft copy-paste-grade (docs-only)

> **⚠️ SUPERSEDED FOR EXECUTION (2026-07-20, DD-80 v1.88).** This packet is a historical v1.86/AP-27
> design record. Its Gate-3 open notes were resolved by
> `g3-revoke-all-concurrency-probe-seed.md` v1.0, which changes the DDL/function contract and splits
> D0 into DB epoch core (`auth-s4-d0-revoke-core`) plus dependent web boundary
> (`auth-s4-d0-session-web-boundary`). Do **not** lift the draft DDL/TS below into a worktree and do not
> treat `AUTH_D0_PACKET_COMPLETE` as current CODE_READY evidence. Current authority is decisions v1.88,
> B0 amendment v1.88 and Web Auth BE v2.10.

> **Mục đích:** packet chuẩn bị/traceability cho slice `auth-s4-d0-revoke-core` để session P0
> founder-attended implement D0 với **zero design decision còn lại**. Mọi DDL/code dưới đây là
> **DRAFT TEXT sống duy nhất trong file này** — chưa có file nào dưới `packages/`/`apps/` được
> tạo/sửa. Packet **không** phải build authorization: P0 auth code vẫn là founder-attended manual
> workflow (manifest `docs/autopilot-manifests/docs-auth-d0-packet.json` negative scope).
>
> **Split gốc:** monolith `auth-d0-d1-implementation-packet.md` (1019 dòng — đếm trực tiếp qua
> `git show cab0c2a:...`; `decisions.md` v1.86 dòng 993 tự ghi "995 dòng", số đếm trực tiếp chính
> xác hơn) HALT ở circuit breaker
> `MAX_ROUNDS` sau Codex FULL-base round-03 (2×P1 + 1×P2, fix-round-count chạm 5). Owner re-slice
> direction tại `standards/decisions.md` dòng 993 (v1.86): tách monolith thành packet D0 này
> (§A1–A3, slug `docs-auth-d0-packet`) + packet D1 riêng (§B1–B3 + §C lift verbatim, slug
> `docs-auth-d1-packet`) từ `main` mới, sau khi transcribe đúng các pin round-03 áp dụng cho từng
> nửa. Reference monolith đọc **READ-ONLY** qua `git show cab0c2a:docs/auth-d0-d1-implementation-packet.md`
> trên branch `feat/docs-auth-d0-d1-implementation-packet`; branch đó giữ nguyên làm read-only
> reference — **KHÔNG checkout/merge/rebase**.
>
> **Hai manifest khác nhau — đừng nhầm:** `docs/autopilot-manifests/docs-auth-d0-packet.json` là
> manifest của **packet doc này** (docs-only, P2, scope = đúng file này + chính nó).
> `docs/autopilot-manifests/auth-s4-d0-revoke-core.json` là manifest của **slice build D0 tương
> lai** (P0, founder-attended, chưa mở worktree) — packet này KHÔNG có quyền sửa manifest đó; mọi
> phát hiện liên quan tới scope của nó chỉ được **ghi lại** làm action item (xem §A3 "Caller
> impact").
>
> **Ngày:** 2026-07-19 · **Base đã đọc:** `main@ea8e48d` (HEAD worktree `docs-auth-d0-packet`, khớp
> `main`/`origin/main` tại thời điểm author — gồm đủ defect fix v1.78 · v1.83 · v1.85 · **v1.86**).
>
> **Authority (nguyên văn, không claim thêm):**
> - `standards/decisions.md` dòng 993 — **DD-80 defect fix v4 (v1.86)**, 3 pin, packet D0 này
>   transcribe đúng pin (1) và (3) (pin (2) — B2 AAD handoff — thuộc D1, xử lý ở
>   `docs-auth-d1-packet.md`): (1) issuance fence reject-and-reauth trong `issueSession()`; (3)
>   partial index `web_sessions(account_id)` vào migration `0015`.
> - `b0-auth-credential-lifecycle-design-probe.md` (✅ owner-approved 2026-07-19) — §6 Amendment
>   v1.83 (dòng 366-368) + Amendment v1.86 (dòng 370-372); §3.1 (dòng 62) / §5.2 (dòng 310) / §6.1
>   (dòng 374) / §6.2 (dòng 384) / §7 (dòng 398) / §8.3 (dòng 490) / §9 (dòng 516) / §10 (dòng 529,
>   order-1 dòng 533).
> - `features/BE/feature_web_auth_onboarding_tech.md` **v2.9b** (changelog dòng 517) — acceptance
>   D0-1..D0-13 (dòng 386-398; D0-11 = v1.83, D0-12/D0-13 = v1.86).
> - `slice-readiness-verdicts.md` **v0.6** (changelog dòng 198) — Verdict 3 (dòng 119-153): **D0 =
>   `CODE_READY`**, IN_SCOPE dòng 134 liệt kê đủ cả pin v1.83 + v1.86, ACCEPTANCE_MATRIX dòng 148 =
>   PASS D0-1..D0-13, SECURITY_AND_MIGRATION_GATE dòng 149 = PASS.
>
> **⚠️ Verdict 3 STALENESS NOTE (codex round-05 finding, 2026-07-19):** Verdict 3's own snapshot
> (dòng 150/152) reads `IMPLEMENTATION_ARTIFACTS: PASS` and `REMAINING_BLOCKERS: none` — accurate
> **at the time it was written**, but §A3.1 of THIS packet (authored after that verdict) surfaces 6
> missing manifest scope entries + a `negative_scope` self-contradiction + a required
> `packages/db/README.md` content edit that Verdict 3 never evaluated. Per
> `review-code-readiness-gate.md` v1.1 §A1 (dòng 62): "Nếu authority thay đổi sau verdict, chỉ
> invalidate các slice trong blast radius" — §A3.1's findings are squarely inside Verdict 3's own
> `IMPLEMENTATION_ARTIFACTS`/`REMAINING_BLOCKERS` claims, so **this packet does NOT treat Verdict 3
> as a currently-valid CODE_READY green light** — it is STALE pending the §A3.1 manifest amendment
> (3 steps), and is **`NOT_CODE_READY`** until that amendment is committed. **Codex round-06
> sharpened this: re-review is a HARD PRECONDITION, not a recommendation** — after the manifest
> amendment lands, `slice-readiness-verdicts.md` MUST be re-reviewed and re-issue a fresh PASS
> verdict for `auth-s4-d0-revoke-core` BEFORE Step 1 of the D0 P0 slice opens; without a current
> PASS verdict there is no valid readiness gate to build against at all — starting from a verdict
> this packet has itself shown to be stale is not an acceptable shortcut. (Out of this packet's
> own edit scope — negative scope forbids editing `slice-readiness-verdicts.md` directly; this is
> an action item for the founder/re-review session, same as the §A3.1 manifest amendment.)
> **Codex round-07 added a THIRD gate ahead of the other two: §A1.1 documents a rotation race
> (`auth_revoke_all_web_sessions` can leave a concurrently-rotated session unrevoked) that no
> existing authority addresses. This packet does NOT invent a fix — closing it needs an owner
> decision transcribed into B0/decisions.md first (same process as v1.78/v1.83/v1.85/v1.86), and
> THAT decision is itself a precondition for Gate 2's re-review to have anything stable to
> re-review against. See the closing summary's Gate 1/2/3 + Founder Authorization Record.**
>
> **Canonical đã đọc theo thứ tự HARD RULE** (contract `autopilot-docs-auth-d0-packet.md`
> §"Canonical read order"): `packages/db/schema.ts` (dòng 18-22 imports, 108-146 accounts/
> webSessions/accountIdentities/magicLinks) + `packages/db/migrations/0012_auth_functions.sql`
> (toàn bộ, line-by-line; rotate dòng 187-213) + `0001_global_directory.sql` (`web_sessions` dòng
> 97-106 — `UNIQUE(token_hash)` duy nhất, không index `account_id`) → B0 probe toàn văn (§3.1/§5.2/
> §6 gồm cả hai amendment/§6.1/§6.2/§7/§8.3/§9(a)/§10) → `feature_web_auth_onboarding_tech.md`
> v2.9b §3/§5 D0-1..13 → `apps/web/lib/session-cookies.ts` (live `issueSession` dòng 62-88,
> `clientIp`) + `apps/web/app/api/auth/logout/route.ts` + `apps/web/lib/api-envelope.ts` (`ok`/`err`
> dòng 4-17, style only) → reference monolith `cab0c2a` §A1/A2/A3/D + floors note →
> `standards/review-code-readiness-gate.md` v1.1.
>
> **Nguồn gốc nội dung §A1–A3:** nội dung lõi (audit table, helper, wrapper, rotate parent-first
> replace, schema mirror 3 bảng drift, route `/api/auth/logout-all`, index.ts export) đã qua **AP-26
> monolith's own** Codex FULL-base round-01 + round-02 **PASS** (reference monolith §D self-check:
> A1/A2/A3 đều PASS — số round này thuộc monolith `cab0c2a`, KHÁC với round-01/02 của chính packet
> D0 này, xem §A3.1) — **lift verbatim, không re-derive**. Packet này chỉ thêm đúng hai pin
> round-03/v1.86 mà reference monolith tự liệt kê là chưa transcribe (đóng
> `.autopilot/state/docs-auth-d0-d1-implementation-packet/HALT-MAX_ROUNDS.txt` mục (1) và (3); mục
> (2) — B2 AAD handoff, cell Google — thuộc D1, không ảnh hưởng D0):
> 1. **§A3.1 issuance fence** — `issueSession()` không fallback-mint khi có cookie mà rotate trả null
>    (B0 §6 amendment v1.86 mục (1), dòng 371; D0-12).
> 2. **§A1 revoke-all index** — partial index `web_sessions(account_id) WHERE revoked_at IS NULL`
>    (B0 §6 amendment v1.86 mục (2), dòng 372; D0-13).
>
> Mọi label version cũ (`v2.9a`, dòng cũ của `decisions.md`/B0 doc trước khi v1.86 chèn thêm nội
> dung) trong nội dung lift từ reference đã được **re-audit và sửa về giá trị hiện hành** theo yêu
> cầu task contract — không mang số dòng/version stale sang packet này.

---

## A1. Draft DDL `0015_auth_revoke_account.sql`

Ghi chú transcribe (không phải quyết định mới — mỗi dòng đều có nguồn; N1-N6 lift từ reference,
citation đã re-audit về dòng hiện hành; N7 mới cho v1.86):

- **N1 · Identifier `auth_revoke_account_sessions`:** B0 §6.1 (dòng 374-382) viết
  `_auth_revoke_account_sessions` (notation internal-helper có underscore). Nguồn specific hơn và
  mới hơn cùng pin identifier SQL **không** underscore: tech v2.9b D0-1 (dòng 386,
  `auth_revoke_account_sessions(A)`), Verdict 3 FIRST_IMPLEMENTATION_STEP (dòng 151), và Verdict 4
  REMAINING_BLOCKERS (`slice-readiness-verdicts.md` dòng 190 — D1 dep_check trên đúng identifier
  này: "dep_check 0015::auth_revoke_account_sessions pass"). Semantics giữ nguyên §6.1: **không
  GRANT cho `app`/`app_worker`**, chỉ gọi được từ SECURITY DEFINER auth/identity functions.
- **N2 · `auth_audit_events` tạo ở 0015 — pinned authority v1.83:** ownership do owner chốt tại
  DD-80 defect fix v2 (`decisions.md` dòng 997 mục (2)) và đồng bộ vào B0 §6 amendment (2) (dòng
  368), B0 §8.3 ("tạo tại D0/0015, các slice sau reuse/extend" — dòng 490), B0 §10 order-1 (dòng
  533), verdicts v0.6 Verdict 3 IN_SCOPE (dòng 134). Bảng audit append-only dùng đúng shape B0
  §3.1/§8.3 (transcribe nguyên cột); D0-8 (dòng 393) yêu cầu audit `logout_all` **cùng transaction**
  với revoke ngay tại D0. Hệ quả cross-slice: migration D1 email-token-core **reuse/extend** bảng
  này, không re-create, không bảng audit song song (B0 §10 order-2, dòng 534).
- **N3 · Nhãn `outcome_class`/`actor_class`/`request_ref`:** B0 §8.3 (dòng 490) pin **fields +
  redaction rule** (không raw email/IP/token/password/PHC; opaque refs), không pin closed enum giá
  trị. Draft dùng `'success'`/`'account_self'` và `request_ref` = UUID của current session (opaque,
  server-side, không phải token/hash). Đây là nhãn label-level, không phải behavior mới; D1
  email-core mang danh sách outcome đầy đủ §8.3.
- **N4 · Predicate "live session":** helper revoke theo đúng định nghĩa live đã có ở 0012
  (`revoked_at IS NULL AND expires_at > now()` — cùng predicate `auth_resolve_web_session` /
  `auth_rotate_web_session` dùng, dòng 178-179/200 của `0012_auth_functions.sql`).
- **N5 · Helper link-artifact KHÔNG thuộc D0:** `_auth_revoke_account_link_artifacts` (B0 §6.1,
  dòng 374-382) gắn với password reset (B0 §6.3, dòng 392) → D1 email bundle (§10 order-4, dòng
  536), sau khi identity companion schema có `source_account_id`/`revoked_at`/… (B0 §1 live gap;
  `feature_identity_tech.md` v1.10 §4-§5). D0 chỉ ship revoke-session primitive + wrapper.
- **N6 · Rotate parent-first replace — pinned authority v1.83:** live 0012 (dòng 187-213) lock
  `web_sessions` FOR UPDATE **trước**, rồi INSERT session row mới — FK `account_id` lấy KEY SHARE
  trên `accounts` = path lock sessions-trước-accounts, KHÔNG có parent lock. Helper A1 lock
  `accounts` FOR UPDATE trước (đúng §5.2/§6.1) ⇒ race logout-all × rotate tạo **deadlock chu trình
  thật**: T1 (revoke) giữ `accounts(A)` rồi chờ session row S; T2 (rotate) giữ S rồi chờ KEY SHARE
  trên `accounts(A)` (FOR UPDATE conflict với KEY SHARE). D0-7 (dòng 392) pin "Không deadlock",
  D0-10 (dòng 395) pin "không path nào lock sessions trước accounts", B0 §5.2 (dòng 310) pin
  "không dùng deadlock retry như correctness mechanism". Owner resolution (DD-80 defect fix v2,
  `decisions.md` dòng 997 mục (1) · B0 §6 amendment (1) dòng 367 · tech v2.9b D0-11 dòng 396 ·
  verdicts v0.6 SECURITY_AND_MIGRATION_GATE dòng 149 · manifest D0 negative-scope dòng 23): **0015
  CREATE OR REPLACE `auth_rotate_web_session` theo parent-first — CHỈ đổi lock order, giữ nguyên
  signature/behavior; mọi behavior change khác là scope breach; rollback = DROP function mới +
  restore định nghĩa rotate từ 0012.** Khác biệt DUY NHẤT so với 0012 dòng 187-213 là một dòng
  `PERFORM 1 FROM accounts … FOR UPDATE` trước mọi thao tác `web_sessions`.
- **N7 · Partial index `web_sessions(account_id)` — pinned authority v1.86 (mới, packet round-03):**
  live `0001_global_directory.sql` (dòng 97-106) chỉ có `UNIQUE(token_hash)` trên `web_sessions`,
  không index nào phục vụ `WHERE account_id = $1`. Helper `auth_revoke_account_sessions` (N1) và
  wrapper `auth_revoke_all_web_sessions`'s bước 4 đều `UPDATE web_sessions ... WHERE account_id =
  $1 AND revoked_at IS NULL` trong khi đang giữ FOR UPDATE lock trên `accounts` cha (§5.2) — không
  index, statement này full-table-scan `web_sessions` dưới parent lock, chặn mọi caller khác đang
  chờ cùng lock. Owner resolution (`decisions.md` dòng 993 mục (3) · B0 §6 amendment v1.86 mục (2)
  dòng 372 · tech v2.9b D0-13 dòng 398 · verdicts v0.6 SECURITY_AND_MIGRATION_GATE dòng 149):
  **0015 thêm partial index `web_sessions(account_id) WHERE revoked_at IS NULL`, expand-only;
  rollback = DROP INDEX.** Predicate khớp đúng predicate helper dùng (N4) nên mọi lookup
  `account_id = $1 AND revoked_at IS NULL` là index scan thuần, không cần lọc thêm `expires_at`
  trong index (giá trị đó vẫn được WHERE-clause của UPDATE lọc runtime, chỉ không nằm trong index
  definition — partial index chỉ cần thu hẹp đúng theo cột hay đổi bởi revoke, `revoked_at`).

```sql
-- ============================================================================
-- 0015_auth_revoke_account.sql  (DRAFT — copy from docs/auth-d0-implementation-packet.md §A1)
-- Slice: auth-s4-d0-revoke-core (manifest docs/autopilot-manifests/auth-s4-d0-revoke-core.json)
-- EXPAND-ONLY + exactly ONE CREATE OR REPLACE of an existing function:
--   one new table + one new partial index (v1.86) + two new functions + rotate
--   parent-first replace (v1.83 — lock-order-only, identical signature/behavior;
--   any other behavior change is a scope breach per the D0 manifest
--   negative-scope line 23).
-- Rollback = DROP FUNCTION auth_revoke_all_web_sessions(text);
--            DROP FUNCTION auth_revoke_account_sessions(uuid);
--            DROP INDEX idx_web_sessions_account_id;
--            DROP TABLE auth_audit_events;
--            restore auth_rotate_web_session to its 0012 definition
--              (verbatim from packages/db/migrations/0012_auth_functions.sql:187-213);
--            (plus the implicit REVOKE of the single new EXECUTE grant; no data migration either way)
-- Source: DD-80 (decisions v1.86 dòng 993 mục (3); v1.83 dòng 997 mục (1)/(2)) · B0 probe
--         §3.1 (audit shape, dòng 62) / §5.2 (lock order, dòng 310) / §6 amendment v1.83
--         (rotate parent-first + audit-at-D0, dòng 366-368) + amendment v1.86 (issuance fence +
--         revoke-all index, dòng 370-372) / §6.1 (internal helper, dòng 374) / §6.2 (public
--         wrapper, dòng 384) / §7 (logout-all row, dòng 398) / §8.3 (audit fields + redaction,
--         dòng 490) · web_auth tech v2.9b acceptance D0-1..D0-13 (dòng 386-398).
-- Access pattern inherited from 0012: role `app` has ZERO table grants here; the
-- SECURITY DEFINER wrapper below is the only doorway (fixed search_path, minimal
-- return, EXECUTE granted to `app` alone). The internal helper gets NO grant at all.
-- ============================================================================

-- Shared protected auth audit store — B0 §3.1 transcribed column-for-column.
-- Created HERE per pinned v1.83 ownership (decisions dòng 997 mục (2); B0 §6
-- amendment (2) dòng 368 + §8.3 dòng 490 + §10 order-1 dòng 533): D0-8 requires
-- the `logout_all` audit row to commit in the SAME transaction as the revoke.
-- This is the shared auth audit table, NOT an email/credential/token/delivery
-- table (outside D0's negative scope). The D1 email-token-core migration
-- REUSES/extends this table and must NOT re-create it (B0 §10 order-2, dòng 534, v1.83).
CREATE TABLE auth_audit_events (
  id               uuid PRIMARY KEY,
  event_type       text NOT NULL,
  account_id       uuid,
  account_email_id uuid,
  outcome_class    text NOT NULL,
  actor_class      text NOT NULL,
  request_ref      text NOT NULL,
  sessions_revoked integer CHECK (sessions_revoked IS NULL OR sessions_revoked >= 0),
  link_codes_revoked integer CHECK (link_codes_revoked IS NULL OR link_codes_revoked >= 0),
  merge_artifacts_cancelled integer
    CHECK (merge_artifacts_cancelled IS NULL OR merge_artifacts_cancelled >= 0),
  created_at       timestamptz NOT NULL
);

CREATE INDEX auth_audit_events_created_at_idx ON auth_audit_events(created_at);
-- No grants: touched only inside SECURITY DEFINER fns (0012 pattern).

-- v1.86: partial index for revoke-by-account (B0 §6 amendment v1.86 item (2),
-- dòng 372; DD-80 decisions dòng 993 mục (3); D0-13 — note N7 above). Without
-- it, the helper below's `UPDATE web_sessions ... WHERE account_id = $1 AND
-- revoked_at IS NULL` needs a full-table scan of `web_sessions` while holding
-- the `accounts` parent lock (live `0001_global_directory.sql:97-106` only has
-- `UNIQUE(token_hash)`). Expand-only; rollback = DROP INDEX idx_web_sessions_account_id.
--
-- codex round-08 [P1] + precedent 0014_players_waitlist.sql:63-69: migrate.ts
-- runs EACH FILE IN ONE TRANSACTION (packages/db/src/migrate.ts, "each file in
-- one transaction" contract), so CREATE INDEX CONCURRENTLY cannot be expressed
-- in this runner AT ALL for 0015 (Postgres forbids it inside a transaction
-- block) — this is an established, already-reviewed runner constraint, not new
-- to D0. UNLIKE 0014's `players` (empty, feature layer unbuilt), `web_sessions`
-- is a LIVE table — Auth Onboarding v3 (Telegram-era) is already merged and in
-- founder-only rollout (tech v2.9b §6 Rollout step 1), so it is NOT
-- necessarily empty, only necessarily SMALL at this rollout stage. Plain
-- CREATE INDEX takes a SHARE lock for the scan duration, blocking session
-- INSERT/UPDATE (login, rotate, revoke) until it completes — bounded by
-- CURRENT row count, not zero. Whoever applies 0015 (P0 session or ops) MUST
-- verify the live row count of `web_sessions` immediately before running this
-- migration in any shared environment: negligible count (founder-only rollout
-- expected) -> proceed; non-trivial count -> apply during an announced
-- maintenance window. A future slice against a populated `web_sessions` (post
-- general-availability) must split this index into its own
-- non-transactional/CONCURRENTLY migration outside this runner's one-file-one-
-- transaction model, matching 0014's own documented caveat.
CREATE INDEX idx_web_sessions_account_id ON web_sessions(account_id)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Internal revoke-by-account primitive (B0 §6.1; identifier per note N1).
-- NOT granted to app/app_worker: callable only from SECURITY DEFINER
-- auth/identity functions (here: the public wrapper below; later: the D1
-- reset path). Returns the revoked-row count for audit.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_revoke_account_sessions(p_account_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Parent-first lock: accounts BEFORE web_sessions (B0 §5.2 tier order; v2.9b
  -- D0-10). Callers already following §5.2 hold this lock; re-acquiring the
  -- same row lock inside the same transaction is a no-op, and doing it HERE
  -- makes "no path locks web_sessions before accounts" structural for every
  -- caller of this helper.
  PERFORM 1 FROM accounts WHERE id = p_account_id FOR UPDATE;

  -- "Live" = the 0012 predicate used by resolve/rotate (note N4).
  UPDATE web_sessions
  SET revoked_at = now()
  WHERE account_id = p_account_id
    AND revoked_at IS NULL
    AND expires_at > now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION auth_revoke_account_sessions(uuid) FROM PUBLIC;
-- INTENTIONALLY NO GRANT (B0 §6.1; v2.9b D0-2 expects `permission denied` for app).

-- ---------------------------------------------------------------------------
-- Public logout-all wrapper — B0 §6.2 exact signature. Derives the account
-- from the CURRENT live session server-side; never accepts an account id from
-- the caller. Returns the revoked count, or NULL when the token does not
-- resolve to a live session AT THE INITIAL READ (route answers 401
-- AUTH_INVALID — replay is NOT idempotent-success, B0 §7 logout-all row).
-- A session revoked AFTER that read by a concurrent rotate/revoke does NOT
-- turn the call into a 401: the account-wide revoke still runs (D0-7).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_revoke_all_web_sessions(p_current_token_hash text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_id uuid;
  v_account uuid;
  v_count integer;
BEGIN
  -- 1) Read-only resolve of the current LIVE session; no blocking lock held
  --    yet (B0 §5.2 step 1: inventory first, never late-discover owners).
  SELECT s.id, s.account_id INTO v_session_id, v_account
  FROM web_sessions s
  WHERE s.token_hash = p_current_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now();
  IF v_account IS NULL THEN
    RETURN NULL; -- missing/expired/already revoked -> generic auth failure upstream
  END IF;

  -- 2) Lock the accounts parent BEFORE any web_sessions write (B0 §5.2/§6.2; D0-10).
  PERFORM 1 FROM accounts WHERE id = v_account FOR UPDATE;

  -- 3) §5.2 drift check after the parent lock (codex round-02 fix): re-read the
  --    resolved row BY ID and assert it still binds to the SAME account
  --    (account_id is immutable — belt-and-braces context check). Do NOT
  --    require it to still be LIVE: it WAS live at this transaction's initial
  --    read, so the logout intent stands even when a concurrent parent-first
  --    rotate (0015) revoked it and minted a replacement between our read and
  --    our lock — step 4 revokes that replacement too, giving D0-7's required
  --    final state ("không token nào của account còn resolve"). NULL/401 is
  --    reserved for tokens already dead at the initial read in step 1 (true
  --    replay — D0-4; B0 §6.2 "missing/expired session trả generic auth
  --    failure"; B0 review-fix "logout-all trả 401 khi gọi lại").
  PERFORM 1 FROM web_sessions s
  WHERE s.id = v_session_id
    AND s.account_id = v_account;
  IF NOT FOUND THEN
    RETURN NULL; -- row gone/rebound: unreachable in live schema; fail closed
  END IF;

  -- 4) Account-wide revoke via the internal primitive — includes the CURRENT
  --    session (B0 §7: "Revoke mọi session của account kể cả session hiện tại")
  --    AND any replacement a concurrent rotate committed before our parent
  --    lock (this statement sees post-lock committed truth — D0-7 final state).
  v_count := auth_revoke_account_sessions(v_account);

  -- 5) `logout_all` audit in the SAME transaction (B0 §8.3; v2.9b D0-8).
  --    No raw/token/hash values; request_ref = opaque current-session UUID (note N3).
  INSERT INTO auth_audit_events(
    id, event_type, account_id, outcome_class, actor_class,
    request_ref, sessions_revoked, created_at
  ) VALUES (
    gen_random_uuid(), 'logout_all', v_account, 'success', 'account_self',
    v_session_id::text, v_count, transaction_timestamp()
  );

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION auth_revoke_all_web_sessions(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_revoke_all_web_sessions(text) TO app;

-- ---------------------------------------------------------------------------
-- v1.83: CREATE OR REPLACE auth_rotate_web_session — parent-first lock order.
-- THE ONLY delta vs the live 0012 definition (0012_auth_functions.sql:187-213)
-- is the single `PERFORM … FOR UPDATE` on accounts BEFORE any web_sessions
-- access: the INSERT below takes KEY SHARE on accounts(p_account_id), so
-- without it rotate is a sessions-before-accounts path — real deadlock with
-- revoke-by-account (D0-7/D0-10; B0 §6 amendment (1)). Signature, result and
-- behavior are unchanged (D0-11: every 0012-era rotate test passes intact).
-- CREATE OR REPLACE preserves the existing 0012 privileges (REVOKE PUBLIC /
-- GRANT EXECUTE TO app) — no grant statement is re-issued here.
-- Rollback: restore the 0012 definition verbatim (header note above).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_rotate_web_session(
  p_old_token_hash text, p_new_token_hash text, p_new_csrf text, p_ttl interval,
  p_account_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old web_sessions%ROWTYPE;
  v_new uuid;
BEGIN
  -- v1.83 lock-order fix — the ONLY change vs 0012: take the accounts parent
  -- FIRST (B0 §5.2 tier order), before the web_sessions row lock below.
  PERFORM 1 FROM accounts WHERE id = p_account_id FOR UPDATE;

  SELECT * INTO v_old FROM web_sessions
  WHERE token_hash = p_old_token_hash AND revoked_at IS NULL AND expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL; -- nothing to rotate (caller treats as plain login)
  END IF;
  UPDATE web_sessions SET revoked_at = now() WHERE id = v_old.id;
  INSERT INTO web_sessions(account_id, token_hash, csrf_secret, expires_at, rotated_from)
  VALUES (p_account_id, p_new_token_hash, p_new_csrf, now() + p_ttl, v_old.id)
  RETURNING id INTO v_new;
  RETURN v_new;
END;
$$;
```

**A1 status: PASS** (DDL nội dung tự thân — draft đúng, transcribe đúng nguồn) — internal helper
không grant `app`/`app_worker` ✓ (§6.1) · wrapper derive account từ `p_current_token_hash`, không
nhận `account_id` ✓ (§6.2) · grants/revokes theo access pattern 0012 ✓ · audit `logout_all` cùng
transaction ✓ (D0-8/§8.3; ownership pinned v1.83 — N2) · helper lock `accounts` → `web_sessions` ✓
(§5.2/§6) · rotate parent-first replace, lock-order-only, giữ nguyên signature/behavior ✓
(D0-11/B0 §6 amendment v1.83 (1) — N6) · wrapper giữ account-wide revoke khi session live tại
initial read — rotate thắng race vẫn không để sót replacement (D0-7 final state), NULL/401 chỉ cho
token dead-at-read (D0-4) ✓ · **v1.86: partial index `idx_web_sessions_account_id` expand-only,
đúng cột + predicate B0 §6 amendment (2)/D0-13, rollback = DROP INDEX bổ sung vào header (N7) ✓** ·
header ghi EXPAND-ONLY + đúng MỘT CREATE OR REPLACE + rollback DROP function×2/INDEX/TABLE/restore-0012
✓ · **NHƯNG xem §A1.1 ngay dưới — codex round-07 FULL tìm ra một race chưa được authority cover,
không phải content defect của packet nhưng chặn CODE_READY thật (Gate 3 mới).**

### A1.1 — OPEN QUESTION (owner decision required, KHÔNG tự invent trong packet này)

**Race:** rotate-races-ahead-of-logout-all — khác hướng với race D0-7 đã pin.

- **D0-7 cover:** rotate xảy ra SAU khi wrapper đã đọc xong step 1 (dòng 268-276) nhưng TRƯỚC khi
  wrapper lock `accounts` (step 2) — wrapper's step 3 (dòng ~283-295, "codex round-02 fix" từ
  reference monolith) re-resolve theo ID, KHÔNG đòi hỏi còn live, nên step 4 (account-wide revoke)
  vẫn quét trúng session mới do rotate tạo ra. **Race NÀY đã đóng đúng.**
- **Race round-07 tìm ra (KHÁC hướng, CHƯA đóng):** rotate hoàn tất **TRƯỚC KHI** wrapper's step 1
  (dòng 268-276) chạy — tức là route (dòng 601-610) đã đọc `raw` cookie value từ request của
  chính nó, nhưng một request KHÁC (concurrent, unrelated — vd: login-lại trên tab khác) đã
  rotate đúng session đó xong TRƯỚC KHI SQL transaction của logout-all bắt đầu. Wrapper's step 1
  không tìm thấy `p_current_token_hash` còn live (đã bị chính rotate đó revoke), trả NULL ngay —
  KHÔNG BAO GIỜ chạy tới step 2-4 — nên session MỚI (do rotate tạo) không bao giờ bị revoke bởi
  lần gọi logout-all này. Route (dòng 610) coi NULL này là "dead at initial read (replay) -> 401,
  zero mutation" — đúng theo comment nó tự ghi, nhưng SAI theo Ý ĐỊNH thật của người dùng: họ gọi
  logout-all lần ĐẦU TIÊN (không phải replay) với ý định giết MỌI session, nhưng một session vẫn
  sống sót vì trúng đúng cửa sổ race hẹp này.
- **Không nguồn nào cover hướng race này:** đã đọc lại toàn bộ B0 §5.2/§6/§7, tech v2.9b D0-1..13,
  `decisions.md` DD-80 (mọi version), không tìm thấy dòng nào pin hành vi đúng cho trường hợp
  "logout-all's own initial read thấy token đã dead do một rotate KHÔNG LIÊN QUAN vừa thắng." D0-4
  ("Logout-all replay... 401 AUTH_INVALID, zero mutation") pin đúng cho TRUE replay (chính request
  đó gọi lại với cookie đã bị CHÍNH NÓ revoke trước đó) — không phải trường hợp này (request đầu
  tiên, cookie chết vì lý do khác ngoài ý muốn).
- **Vì sao packet này KHÔNG tự sửa:** đóng race này đòi hỏi một quyết định thiết kế mới — vd: route
  nên re-resolve account từ đâu khi wrapper trả NULL (không có "server-attested" account handle
  nào khác ngoài chính token đã dead), hay chấp nhận cửa sổ race này là rủi ro thấp và ghi nhận rõ,
  hay đổi hẳn cơ chế xác định "current session" cho riêng logout-all. Đây là quyết định cùng tầm
  với DD-80/B0 §5.2 (lock hierarchy) — packet docs-only này **không có thẩm quyền tự phát minh**
  (negative scope: "NO new business/security rule may be invented — any contract ambiguity is
  HALT-AUTHORITY_AMBIGUOUS, not a local decision").
- **Founder decision (2026-07-19):** route qua owner decision, cùng quy trình mọi defect fix trước
  đó của slice này (v1.83/v1.85/v1.86 đều là owner-approved amendment vào B0/decisions.md trước
  khi transcribe vào packet). Packet này CHỈ document gap — KHÔNG claim đã đóng, KHÔNG tự chọn một
  trong các phương án trên.

**Kết luận A1.1:** DDL trong §A1 vẫn PASS ở nội dung tự thân (đúng những gì reference monolith đã
transcribe, chưa hề bị sửa bởi finding này) — nhưng D0-7's "không token nào của account còn
resolve" **không đúng 100% cho MỌI race**, chỉ đúng cho hướng đã pin. `auth-s4-d0-revoke-core.json`
Verdict 3 KHÔNG thể `CODE_READY` cho tới khi owner quyết định hướng đóng race này VÀ quyết định đó
được transcribe vào B0/tech v2.9b/decisions.md (như mọi defect fix trước — xem changelog v1.78 →
v1.86). Đây là **Gate 3**, bổ sung vào Gate 1 (manifest amendment) + Gate 2 (verdict re-review) đã
ghi ở header/closing summary.

---

## A2. Schema mirror B0 §9(a) — draft cho `packages/db/schema.ts`

Column-by-column theo `0012_auth_functions.sql` + `0001_global_directory.sql` **thật** (đọc
line-by-line, không nhớ): ba bảng drift hiện hữu (D0-9) + `auth_audit_events` mirror cùng slice
theo rule B0 §9(2) (dòng 521 — auth table/field mới được thêm cùng migration và cùng patch
`schema.ts`, không phải quote nguyên văn — hệ quả note N2) + **v1.86: `web_sessions` thêm index mirror cùng slice** (hệ quả
note N7). Zero behavior change cho 3 bảng drift + `auth_audit_events`: không grant mới, không DDL
đổi so với 0012, chỉ Drizzle mirror. `web_sessions` là ngoại lệ có chủ đích: DDL mới thật (index
mới trong 0015) nên mirror cũng thật, đúng rule B0 §9(2).

```ts
// --- packages/db/schema.ts (DRAFT: 4 new exports ADDED + 1 export REPLACED) --
// Mirrors of 0012_auth_functions.sql (B0 §9(a)): tables are touched ONLY inside
// SECURITY DEFINER functions; `app` has no table grants (SQL migrations stay
// authoritative for grants/functions/UNLOGGED — file-header rule).
// NOT a pure append: authLoginNonces/authLoginState/rateLimitHits/authAuditEvents
// are NEW exports (add them anywhere in the GLOBAL protected section); the final
// export below (webSessions) REPLACES the existing bare export at
// schema.ts:114-123 IN PLACE — appending it as a 5th new export alongside the
// others would leave two `export const webSessions` and fail to compile.

export const authLoginNonces = pgTable(
  "auth_login_nonces",
  {
    loginHash: text("login_hash").primaryKey(),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    seenAtIdx: index("idx_auth_login_nonces_seen_at").on(t.seenAt),
  }),
);

export const authLoginState = pgTable(
  "auth_login_state",
  {
    stateHash: text("state_hash").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    expiresAtIdx: index("idx_auth_login_state_expires_at").on(t.expiresAt),
  }),
);

// UNLOGGED is not expressible in Drizzle — 0012 SQL is authoritative for it
// (schema.ts header: SQL owns what Drizzle cannot express). No primary key by design.
export const rateLimitHits = pgTable(
  "rate_limit_hits",
  {
    bucket: text("bucket").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bucketAtIdx: index("idx_rate_limit_bucket_at").on(t.bucket, t.at),
    atIdx: index("idx_rate_limit_at").on(t.at),
  }),
);

// Mirror of 0015 (same-slice rule B0 §9(2) dòng 521; shape = B0 §3.1 dòng 62).
// Written only by SECURITY DEFINER auth functions; id/created_at supplied by
// the writer (no column defaults in the pinned shape).
export const authAuditEvents = pgTable("auth_audit_events", {
  id: uuid("id").primaryKey(),
  eventType: text("event_type").notNull(),
  accountId: uuid("account_id"),
  accountEmailId: uuid("account_email_id"),
  outcomeClass: text("outcome_class").notNull(),
  actorClass: text("actor_class").notNull(),
  requestRef: text("request_ref").notNull(),
  sessionsRevoked: integer("sessions_revoked"),
  linkCodesRevoked: integer("link_codes_revoked"),
  mergeArtifactsCancelled: integer("merge_artifacts_cancelled"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (t) => ({
  createdAtIdx: index("auth_audit_events_created_at_idx").on(t.createdAt),
  sessionsRevokedChk: check(
    "auth_audit_events_sessions_revoked_check",
    sql`${t.sessionsRevoked} IS NULL OR ${t.sessionsRevoked} >= 0`,
  ),
  linkCodesRevokedChk: check(
    "auth_audit_events_link_codes_revoked_check",
    sql`${t.linkCodesRevoked} IS NULL OR ${t.linkCodesRevoked} >= 0`,
  ),
  mergeArtifactsCancelledChk: check(
    "auth_audit_events_merge_artifacts_cancelled_check",
    sql`${t.mergeArtifactsCancelled} IS NULL OR ${t.mergeArtifactsCancelled} >= 0`,
  ),
}));

// v1.86: `web_sessions` gains a THIRD arg (index callback) — B0 §6 amendment
// v1.86 item (2), dòng 372; D0-13; note N7. This REPLACES the existing bare
// export at packages/db/schema.ts:114-123 — every column is byte-for-byte
// unchanged; only the new `(t) => ({...})` index callback is added (same
// pattern as the existing partial index on `magicLinks`, schema.ts:145). It is
// NOT a new table/new export, and it is NOT a new grant.
export const webSessions = pgTable("web_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  tokenHash: text("token_hash").notNull().unique(),
  csrfSecret: text("csrf_secret").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  rotatedFrom: uuid("rotated_from"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  accountIdActiveIdx: index("idx_web_sessions_account_id")
    .on(t.accountId)
    .where(sql`${t.revokedAt} IS NULL`),
}));
```

**A2 parity table** (đối chiếu 0012/0001 thật ↔ draft):

| 0012/0001 object                    | Dòng live | Draft mirror                 | Khớp                             |
| ------------------------------------ | --------- | ----------------------------- | --------------------------------- |
| `auth_login_nonces.login_hash` PK    | 18-21     | `loginHash` PK                | ✓ text PK                         |
| `auth_login_nonces.seen_at`          | 20        | `seenAt` notNull defaultNow   | ✓                                  |
| `idx_auth_login_nonces_seen_at`      | 28        | `seenAtIdx`                   | ✓                                  |
| `auth_login_state` 4 cột             | 105-110   | 4 field                       | ✓ (PK/notNull/nullable/default)   |
| `idx_auth_login_state_expires_at`    | 116       | `expiresAtIdx`                | ✓                                  |
| `rate_limit_hits` UNLOGGED, no PK    | 324-327   | no PK; UNLOGGED = SQL-only    | ✓ (ghi chú trong comment)         |
| `idx_rate_limit_bucket_at` + `_at`   | 328, 333  | 2 index                       | ✓                                  |
| `auth_audit_events` (0015 §A1 mới)   | —         | mirror B0 §3.1 (dòng 62)      | ✓ cột + 3 CHECK + index           |
| `web_sessions` 7/8 cột (`0001` dòng 97-106) | 97-106 | 8 field, byte-for-byte unchanged | ⚠ 7/8 khớp; `rotated_from` xem ghi chú dưới bảng |
| `idx_web_sessions_account_id` (0015 §A1 mới, v1.86) | — | `accountIdActiveIdx` partial `WHERE revokedAt IS NULL` | ✓ cùng predicate D0-13, note N7 |

**Ghi chú `rotated_from` (codex round-04 FULL finding, PRE-EXISTING drift — không phải do packet
này tạo ra):** live `0001_global_directory.sql:103` định nghĩa `rotated_from uuid REFERENCES
web_sessions(id)` — self-referential FK. `schema.ts` LIVE (trước packet này, dòng 120) đã có sẵn
`rotatedFrom: uuid("rotated_from")` **KHÔNG có** `.references(...)` — self-FK bị bỏ sót từ trước,
không liên quan tới D0. Draft ở trên copy nguyên trạng live (đúng nghĩa "byte-for-byte unchanged"),
nên **kế thừa** gap này thay vì tạo mới. **Quyết định (packet này):** KHÔNG tự thêm self-FK — đây
là schema-mirror drift ngoài phạm vi DD-80/B0/tech v2.9b (không nguồn nào pin `rotated_from` self-FK
là D0 deliverable), và thêm nó đòi hỏi pattern Drizzle circular-reference (`AnyPgColumn` cast) chưa
từng dùng ở đâu khác trong `schema.ts` — một design choice ngoài quyền của packet docs-only này.
P0 session KHÔNG được tự ý "tiện tay" fix gap này cùng D0 (scope creep); nếu muốn đóng, cần slice
riêng với authority riêng. Parity table trên sửa lại thành 7/8 khớp (không phải 8/8) để không claim
sai.

**A2 status: PASS** — parity table 10/10 dòng đầy đủ (1 dòng có ghi chú pre-existing gap, không phải
lỗi của packet này); v1.86 partial index thêm cùng slice/cùng migration đúng rule B0 §9(2) (dòng
521); zero grant mới, zero DDL đổi ngoài index mới trên bảng đã tồn tại.

---

## A3. Route + fence + test map D0

Reuse nguyên helpers live (không redesign choke-point): `currentSession()` / `csrfOk()` /
`clearSessionCookie()` / `hashToken()` / `SESSION_COOKIE` / `appDb()` từ
`apps/web/lib/session-cookies.ts` (dòng 1-183); envelope `ok()`/`err()` từ
`apps/web/lib/api-envelope.ts` (dòng 4-17); error codes theo v2.9b §3 (`AUTH_INVALID` 401,
`CSRF_INVALID` 403).

```ts
// --- packages/db/src/auth.ts (DRAFT addition) --------------------------------
/**
 * Account-wide logout (B0 §6.2): revoke EVERY live session of the current
 * session's account, including the current one. Returns the revoked count, or
 * null when the token no longer resolves to a live session (route -> 401;
 * replay is NOT idempotent-success).
 */
export async function revokeAllWebSessions(
  pool: pg.Pool,
  currentTokenHash: string,
): Promise<number | null> {
  const r = await pool.query<{ n: number | null }>(
    "SELECT auth_revoke_all_web_sessions($1) AS n",
    [currentTokenHash],
  );
  return r.rows[0]?.n ?? null;
}
```

```ts
// --- packages/db/src/index.ts (DRAFT addition — v1.83) -----------------------
// @plexco/db exports via the EXPLICIT list in src/index.ts (package.json
// exports only "." and "./schema"; the live logout route imports from root).
// v1.83 added this file to the D0 manifest scope (auth-s4-d0-revoke-core.json
// scope dòng 32; decisions dòng 997 mục (3)): the ONLY change is one line in
// the "./auth.js" export block, alphabetical position — the resulting block:
export {
  LoginReplayError,
  SlugTakenError,
  consumeLoginState,
  createWebSession,
  issueLoginState,
  loginTelegram,
  onboardingSnapshot,
  provisionTenant,
  rateLimitCheck,
  resolveWebSession,
  revokeAllWebSessions, // ← v1.83: the single new line (surfaces the D0 wrapper)
  revokeWebSession,
  rotateWebSession,
  tenantsForPerson,
  type LoginResult,
  type OnboardingSnapshot,
  type ResolvedSession,
} from "./auth.js";
```

```ts
// --- apps/web/app/api/auth/logout-all/route.ts (DRAFT skeleton) --------------
// Import compiles per the live root-import pattern once the index.ts line above
// lands (manifest D0 scope dòng 36, v1.83 — resolved HALT v2 mục 2).
import { revokeAllWebSessions } from "@plexco/db";
import { cookies } from "next/headers";
import { err, ok } from "../../../../lib/api-envelope";
import {
  appDb,
  clearSessionCookie,
  csrfOk,
  currentSession,
  hashToken,
  SESSION_COOKIE,
} from "../../../../lib/session-cookies";

/**
 * POST /api/auth/logout-all — current session + valid CSRF required (B0 §6.2;
 * v2.9b D0-3..D0-5). Wrapper derives the account server-side; this route never
 * reads or forwards an account id. Cookie is cleared only AFTER the
 * server-side revoke. Second call with a revoked cookie -> 401 AUTH_INVALID
 * (NOT idempotent-success — tests must assert 401, B0 §7).
 */
export async function POST(request: Request): Promise<Response> {
  const session = await currentSession();
  if (!session) return err("AUTH_INVALID", "Xác thực không hợp lệ", 401); // D0-4
  if (!csrfOk(request, session)) return err("CSRF_INVALID", "Yêu cầu không hợp lệ", 403); // D0-5

  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return err("AUTH_INVALID", "Xác thực không hợp lệ", 401);

  const count = await revokeAllWebSessions(appDb().pool, hashToken(raw));
  if (count === null) return err("AUTH_INVALID", "Xác thực không hợp lệ", 401); // dead at initial read (replay) -> 401, zero mutation

  await clearSessionCookie(); // clear only after server-side revoke (B0 §6.2)
  return ok({ loggedOut: true }); // minimal body, giống /api/auth/logout live
}
```

Ghi chú thứ tự: nhãn "CSRF → resolve → wrapper → 401-on-replay" của slice doc là summary; về cơ học
`csrfOk(request, session)` cần session đã resolve (secret nằm trong row session), nên route resolve
trước rồi check CSRF — đúng semantics D0-4/D0-5 (401 khi không còn session; 403 khi CSRF sai, zero
mutation).

### A3.1 — v1.86 issuance fence (`apps/web/lib/session-cookies.ts`)

```ts
// --- apps/web/lib/session-cookies.ts (DRAFT modification — v1.86) ------------
// Replaces the live `issueSession` at apps/web/lib/session-cookies.ts:62-88.
// ONLY the stale-cookie-rotate-null branch changes (B0 §6 amendment v1.86 item
// (1), dòng 371; DD-80 decisions dòng 993 mục (1); D0-12). Every other line —
// including the pre-existing `if (!rotated) { await createWebSession(...) }`
// no-cookie mint path — is BYTE-FOR-BYTE unchanged: once the new `if (!rotated)`
// throw fires for the has-cookie/rotate-null case below, execution never
// reaches the outer `if (!rotated)`, so that line needs no condition change
// itself — it can only still be true for the genuine no-cookie case.

/**
 * Thrown by issueSession() when a presented session cookie's token no longer
 * resolves live (rotate returned null — e.g. a concurrent logout-all won the
 * race). Callers MUST catch this and map it to the generic 401 AUTH_INVALID
 * response; see "Caller impact" below for the exact call sites that need it.
 */
export class SessionReauthRequiredError extends Error {
  constructor() {
    super("session cookie present but its token no longer resolves live; re-authenticate");
  }
}

export async function issueSession(accountId: string): Promise<{ csrfToken: string }> {
  const { createWebSession, rotateWebSession } = await import("@plexco/db");
  const { randomBytes: rb } = await import("node:crypto");
  const { token, tokenHash } = newSessionToken();
  const csrfToken = rb(24).toString("base64url");
  const existing = (await cookies()).get(SESSION_COOKIE)?.value;
  let rotated: string | null = null;
  if (existing) {
    rotated = await rotateWebSession(appDb().pool, {
      oldTokenHash: hashToken(existing),
      newTokenHash: tokenHash,
      newCsrfSecret: csrfToken,
      ttlSeconds: SESSION_TTL_SECONDS,
      accountId,
    });
    if (!rotated) {
      // v1.86 issuance fence: the cookie's token no longer resolves to a live
      // session — do NOT fall back to createWebSession. Minting here would
      // resurrect access through a stale cookie a concurrent logout-all
      // already won the race against, contradicting D0-7's "no token of the
      // account still resolves" final state. Clear the dead cookie and force
      // the caller through a real login; a retry with no cookie mints fresh
      // via the unchanged no-cookie path below.
      await clearSessionCookie();
      throw new SessionReauthRequiredError();
    }
  }
  if (!rotated) {
    await createWebSession(appDb().pool, {
      accountId,
      tokenHash,
      csrfSecret: csrfToken,
      ttlSeconds: SESSION_TTL_SECONDS,
    });
  }
  await setSessionCookie(token);
  return { csrfToken };
}
```

**Caller impact — D0 build BLOCKING pre-requisite** (không phải authority conflict; không phải
business/security decision mới — hành vi fence đã pin đủ ở B0 §6 amendment v1.86 mục (1), dòng
371): `issueSession()` hiện có đúng hai call site trên live base; cả hai NGOÀI `scope` array của
`auth-s4-d0-revoke-core.json` (dòng 27-39) — nếu không sửa, throw mới sẽ leak thành unhandled
exception (500) thay vì D0-12 yêu cầu "login route trả 401 `AUTH_INVALID`":

| Call site                                                  | Dòng gọi | Catch hiện tại                                                                       | Cần thêm                                                                                                             |
| ------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/api/auth/telegram/callback/route.ts`          | 87       | `catch (error) { if (error instanceof LoginReplayError) return err(...401); throw error; }` (dòng 89-94) | **(a)** add `SessionReauthRequiredError` vào import block từ `session-cookies` (dòng 5-11, cạnh `issueSession`); **(b)** mở rộng điều kiện `if` hiện có bằng OR: thêm `error instanceof SessionReauthRequiredError` làm vế thứ hai (cùng `AUTH_INVALID` generic) |
| `apps/web/app/api/onboarding/start/route.ts`                | 72       | `catch (error) { if (error instanceof SlugTakenError) return err(...409); throw error; }` (dòng 74-79)    | **(a)** add `SessionReauthRequiredError` vào import block từ `session-cookies` (dòng 4-10, cạnh `issueSession`); **(b)** thêm nhánh `if (error instanceof SessionReauthRequiredError) return err("AUTH_INVALID", ..., 401)` — session đã xác thực tại dòng 18, đây là race window chứ không phải happy path |

**Hard pre-condition (P0 session KHÔNG được bỏ qua) — BA bước, không chỉ thêm file:** trước Step 1
của `auth-s4-d0-revoke-core.json`, founder/P0 session PHẢI:

**(1) Thêm đúng 6 file sau vào `scope` array** (dòng 27-39) — thiếu bất kỳ file nào, D0-12 không thể
pass end-to-end (route vẫn leak 500, hoặc test không cover đúng layer "login route" mà acceptance
yêu cầu) hoặc migration inventory bị stale sau khi land:

- [ ] `apps/web/app/api/auth/telegram/callback/route.ts` (catch mới — bảng trên)
- [ ] `apps/web/app/api/auth/telegram/callback/route.test.ts` (**đã tồn tại**, 58 dòng — extend, draft test dưới)
- [ ] `apps/web/app/api/onboarding/start/route.ts` (catch mới — bảng trên)
- [ ] `apps/web/app/api/onboarding/start/route.test.ts` (**CHƯA tồn tại trên live base** — file mới, draft test dưới)
- [ ] `apps/web/lib/session-cookies.test.ts` (**đã tồn tại**, 155 dòng, hiện test `sameOriginRequest`/`clientIp`, chưa test `issueSession` — extend cho D0-12 unit-level throw+clear)
- [ ] `packages/db/README.md` (**codex round-04+round-06 FULL findings**; **đã tồn tại** — B0 §9(4)
      dòng 523 pin "Cập nhật `packages/db/README.md` migration inventory khi slice land"; live
      README hiện chỉ liệt kê tới `0011` — dòng 35 — và hướng dẫn vận hành "Apply `0000`→`0011`" —
      dòng 106; D0 thêm `0015` nên bảng inventory + hướng dẫn apply + câu "functions ... live only
      in `0009`/`0010`" — dòng 39-40, đã sai từ trước D0 vì `0012` cũng có function, D0 làm sai
      thêm — cần cập nhật cùng slice, không để tới cleanup sau Google/email adapter theo đúng B0 §9
      câu cuối "không được để tới cleanup sau provider swap")

**OPEN NOTE (codex round-08 [P2], KHÔNG fix trong packet này — founder quyết định để lại làm ghi
chú, không tự re-slice):** thêm 6 file trên vào scope của `auth-s4-d0-revoke-core.json` (vốn đã có
10 file) khiến slice vượt budget mặc định `review-code-readiness-gate.md` v1.1 §B3 (dòng 166,
"khoảng ≤300 LOC, ≤3 modules") — slice giờ trải rộng DB migration/schema/service/tests, session
issuer, 3 route + route test, và docs. Đây là tension thật giữa "đóng đúng gap D0-12 cần" (round-01
tới round-04 đã lập luận kỹ) và "giữ slice trong budget size." Packet này **không tự quyết** re-slice
(vd: tách phần "issuance-fence caller work" thành prerequisite slice riêng) hay xin bounded
exception — đây là quyết định scope-sizing cho founder/owner khi amend manifest ở Gate 1, ghi lại ở
đây để không mất thông tin.

**(2) AMEND `negative_scope` dòng 25** — text hiện tại ("Issuance fence (v1.86) CHI doi hanh vi
stale-cookie-rotate-null trong issueSession sang reject+clear-cookie; no-cookie mint path va moi
caller/behavior khac giu nguyen") cấm **mọi** thay đổi "caller/behavior khác", điều này **mâu
thuẫn trực tiếp** với bước (1): thêm catch mới ở 2 route LÀ một thay đổi caller behavior. Nếu giữ
nguyên dòng 25 như hiện tại, slice D0 tự mâu thuẫn — không thể vừa tuân negative scope vừa thoả
D0-12. Đề xuất amend dòng 25 thành (copy-paste được, thu hẹp đúng phạm vi, không mở rộng chung
chung):

```text
Issuance fence (v1.86) trong issueSession() CHI doi hanh vi stale-cookie-rotate-null sang
reject+clear-cookie; no-cookie mint path giu nguyen. Hai caller (telegram/callback,
onboarding/start) DUOC PHEP them dung MOT catch-arm moi map SessionReauthRequiredError -> 401
AUTH_INVALID (khong doi behavior nao khac cua 2 route nay).
```

**(3) Cập nhật nội dung `packages/db/README.md`** (không chỉ thêm vào scope array ở bước (1)) — theo
B0 §9(4) (dòng 523). **Codex round-05 sharpened this:** đừng chỉ tack `0015` vào cuối list hiện tại
— README hiện dừng ở `0011_seeds.sql` (dòng 35) dù `0012`/`0013`/`0014` đã tồn tại trên live base
(pre-existing gap, KHÔNG do D0 tạo ra) và chỉ thêm mỗi dòng `0015` sẽ để lại một list KHÔNG liền
mạch (nhảy từ `0011` sang `0015`), sai hơn cả list cũ. Sửa đúng: làm list liền mạch `0000`→`0015`.

**Phạm vi sửa CHÍNH XÁC (không phải toàn bộ dòng 23-35):** dòng `24`-`34` (`0000_roles_extensions.sql`
tới `0010_functions_triggers.sql`) **giữ nguyên, không đụng**. Chỉ hai việc: (i) dòng `35`
(`0011_seeds.sql`) đổi ký tự đầu từ `└──` thành `├──` (vì không còn là dòng cuối cây thư mục); (ii)
CHÈN 4 dòng mới ngay sau dòng `35`:

```text
    ├── 0012_auth_functions.sql        # web auth functions (login/session/rate-limit — SECURITY DEFINER)
    ├── 0013_onboarding_steps_recency.sql # onboarding_steps recency column (expand only)
    ├── 0014_players_waitlist.sql      # players waitlist (DD-45, expand only, code dark)
    └── 0015_auth_revoke_account.sql   # account-wide session revoke + auth_audit_events (D0, expand only)
```

Và sửa dòng 106 từ "Apply `0000`→`0011` in order" thành "Apply `0000`→`0015` in order" (liền mạch,
không nhảy số).

**Codex round-06 thêm một câu liền kề cần sửa cùng lúc (dòng 39-40):** README hiện viết "`schema.ts`
... cannot express RLS, grants, functions, or triggers — those live only in `0009`/`0010`." Câu
này đã SAI ngay cả trước D0 (`0012_auth_functions.sql` cũng định nghĩa SECURITY DEFINER functions
— pre-existing, không do D0 tạo), và `0015` (D0) làm nó sai thêm. Vì bước (3) này đang sửa đúng
đoạn văn bản mô tả migration inventory, tiện sửa luôn câu này trong cùng lần edit — đổi
"những live only in `0009`/`0010`" thành "những live only in `0009`/`0010`/`0012`/`0015`" (hoặc bỏ
hẳn chữ "only" nếu muốn tổng quát hơn, không liệt kê từng số).

Đây là một file-scope + negative-scope + content completeness finding cho **manifest khác**
(`auth-s4-d0-revoke-core.json`), không thuộc quyền sửa của packet này: negative scope của
`docs-auth-d0-packet.json` chỉ cho phép sửa chính file này + chính manifest của nó. Packet D0 này
PASS ở nội dung tự thân (DDL/TS/test-map đều đầy đủ, đúng nguồn); cả ba bước (1)+(2)+(3) là action
item đứng NGOÀI packet — founder xử lý trước khi mở worktree D0. Packet không polish thêm vòng nào
để "tự sửa" việc này vì nó không có quyền ghi vào manifest đó.

**Draft test — route-level 401** (đóng khoảng cách "D0-12 cần assertion tại đúng layer `login
route trả 401`, không chỉ layer `session-cookies.ts`"):

```ts
// --- apps/web/app/api/auth/telegram/callback/route.test.ts (DRAFT extension) -
// Extends the EXISTING file (route.test.ts, 58 dòng) — module-level setup at
// route.test.ts:17-18 (DATABASE_URL, TRUSTED_INGRESS_PROVIDER="digitalocean")
// and the `reqFrom` helper (route.test.ts:20-26) stay UNCHANGED and apply to
// this new case too; import depth 5x "../" matches the live route's own
// imports (route.ts:2/5-17). Two mock factories below (`@plexco/db`,
// `lib/login-state`) are the file's EXISTING, UNCHANGED factories, repeated
// here only so this block is self-contained — do NOT add a second
// `vi.mock("@plexco/db", ...)` call, replace the existing one in place. Only
// the `session-cookies` and `telegram-login` mocks are NEW.
//
// codex round-02 findings, both closed here:
// (a) reqFrom() posts body "{}" and, without the mocks/env var below, the
//     live route exits at the TELEGRAM_BOT_TOKEN check (503) or real
//     verifyTelegramLogin's HMAC check (401 AUTH_INVALID from an
//     empty/unsigned payload) — BEFORE ever reaching loginTelegram/
//     issueSession, so a naive "expect 401" assertion would falsely pass even
//     with the new catch arm absent. Fixed by mocking verifyTelegramLogin,
//     setting TELEGRAM_BOT_TOKEN, and asserting `issueSession` was actually
//     called.
// (b) self-audit while fixing (a) surfaced a SECOND false-negative: even past
//     verifyTelegramLogin, the route's unmocked `telegramUserLookupHash()`
//     (apps/web/lib/telegram-login.ts:88, real impl) calls `keyedHash()` ->
//     `resolveAuthSecretKey()` (apps/web/lib/auth-secrets.ts), which THROWS
//     `"ENCRYPTION_KEY is not set..."` when neither KMS_PROVIDER nor
//     ENCRYPTION_KEY is configured — an error the route's catch does not
//     recognize (rethrows), so the test would fail via an uncaught rejection
//     instead of exercising issueSession at all. This route test's job is the
//     CONTROL-FLOW branch, not hash generation (already covered by
//     `telegram-login.test.ts`), so `telegramUserLookupHash` is mocked too
//     rather than wiring a real ENCRYPTION_KEY into this file.
//
// FULL resulting import block (replaces route.test.ts:1-4):
import { loginTelegram, rateLimitCheck } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { consumeLoginStateCookie } from "../../../../../lib/login-state";
import {
  issueSession,
  SessionReauthRequiredError,
} from "../../../../../lib/session-cookies";
import {
  telegramUserLookupHash,
  verifyTelegramLogin,
} from "../../../../../lib/telegram-login";
import { POST } from "./route";

vi.mock("@plexco/db", () => ({
  createDb: vi.fn(() => ({ pool: {} })),
  rateLimitCheck: vi.fn(),
  loginTelegram: vi.fn(),
  LoginReplayError: class LoginReplayError extends Error {},
}));
vi.mock("../../../../../lib/login-state", () => ({
  consumeLoginStateCookie: vi.fn(),
}));
vi.mock("../../../../../lib/session-cookies", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../../lib/session-cookies")>()),
  issueSession: vi.fn(),
}));
vi.mock("../../../../../lib/telegram-login", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../../lib/telegram-login")>()),
  verifyTelegramLogin: vi.fn(),
  telegramUserLookupHash: vi.fn(),
}));

// codex round-03: `??=` only assigns on null/undefined, NOT on an existing
// empty string (e.g. TELEGRAM_BOT_TOKEN="" copied from .env.example) — that
// would leave the route rejecting at the token-configured check (503) before
// ever reaching verifyTelegramLogin/issueSession. Unconditional assignment,
// matching the existing TRUSTED_INGRESS_PROVIDER line above (route.test.ts:18).
process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";

describe("POST /api/auth/telegram/callback — D0-12 issuance fence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps a stale-cookie SessionReauthRequiredError from issueSession to 401 AUTH_INVALID", async () => {
    vi.mocked(rateLimitCheck).mockResolvedValue(true);
    vi.mocked(consumeLoginStateCookie).mockResolvedValue(true);
    // normalizeTelegramPayload() runs unmocked (pure type-normalizer, real
    // impl is fine) — a non-empty plausible-shaped body is enough for it to
    // return a non-null record; verifyTelegramLogin below is mocked, so the
    // field VALUES never face a real HMAC check.
    vi.mocked(verifyTelegramLogin).mockReturnValue({
      ok: true,
      telegramUserId: "42",
      displayName: "A",
    });
    vi.mocked(telegramUserLookupHash).mockResolvedValue("hashed-42");
    vi.mocked(loginTelegram).mockResolvedValue({ accountId: "a1", personId: "p1", created: false });
    vi.mocked(issueSession).mockRejectedValue(new SessionReauthRequiredError());

    const res = await POST(
      new Request("https://plexco.app/api/auth/telegram/callback", {
        method: "POST",
        headers: { host: "plexco.app", origin: "https://plexco.app", "do-connecting-ip": "1.2.3.4" },
        body: JSON.stringify({ id: "42", auth_date: "1700000000", hash: "a".repeat(64) }),
      }),
    );

    expect(issueSession).toHaveBeenCalledWith("a1"); // proves the route reached the new catch, not an earlier reject
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("AUTH_INVALID");
  });
});
```

```ts
// --- apps/web/app/api/onboarding/start/route.test.ts (DRAFT — NEW FILE) ------
// This file does not exist on the live base; onboarding/start currently has NO
// test coverage at all. D0-12's route-level clause needs at least this one
// case (happy-path/CSRF/body-validation cases are pre-existing behavior,
// out of D0 scope to author here). Import depth matches route.ts:4-10: 4x "../".
import { provisionTenant } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentSession,
  issueSession,
  SessionReauthRequiredError,
} from "../../../../lib/session-cookies";
import { POST } from "./route";

vi.mock("@plexco/db", () => ({
  provisionTenant: vi.fn(),
  SlugTakenError: class SlugTakenError extends Error {},
}));
vi.mock("../../../../lib/session-cookies", () => ({
  appDb: vi.fn(() => ({ pool: {} })),
  csrfOk: vi.fn(() => true),
  currentSession: vi.fn(),
  issueSession: vi.fn(),
  rateLimited: vi.fn(() => false),
  SessionReauthRequiredError: class SessionReauthRequiredError extends Error {},
}));

describe("POST /api/onboarding/start — D0-12 race window", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps a stale-cookie SessionReauthRequiredError from issueSession to 401 AUTH_INVALID, even after provisionTenant already committed", async () => {
    vi.mocked(currentSession).mockResolvedValue({
      sessionId: "s1",
      accountId: "a1",
      personId: "p1",
      csrfSecret: "secret",
      expiresAt: new Date(Date.now() + 60_000),
    });
    vi.mocked(provisionTenant).mockResolvedValue("t1");
    vi.mocked(issueSession).mockRejectedValue(new SessionReauthRequiredError());

    const res = await POST(
      new Request("https://plexco.app/api/onboarding/start", {
        method: "POST",
        body: JSON.stringify({ slug: "club1", name: "Club 1" }),
      }),
    );

    // codex round-02 finding: asserting only the status code lets a catch that
    // maps to any OTHER 401 code (or a different envelope) falsely pass, even
    // though D0-12 requires exactly `AUTH_INVALID`.
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("AUTH_INVALID");
  });
});
```

### A3.2 — Test map D0-1..D0-13

**Bảng map D0-1..D0-13 → test file/case** (expected result **nguyên văn** v2.9b §5 acceptance D0,
dòng 386-398):

| #     | Test file (manifest D0 scope)                                                     | Tên case (draft)                                                                                                                               | Expected (nguyên văn v2.9b)                                                                                                     |
| ----- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| D0-1  | `packages/db/src/auth.test.ts`                                                      | `revokes all 3 of A's live sessions, leaves B's session intact, returns count=3`                                                                     | "3 session của A có `revoked_at`, session B nguyên vẹn; return count=3"                                                         |
| D0-2  | `packages/db/src/rls-invariants.test.ts`                                            | `app role cannot EXECUTE the internal revoke-by-account helper (grant matrix: public wrapper only)`                                                 | "`permission denied`; grant matrix chỉ có public wrapper"                                                                       |
| D0-3  | `apps/web/app/api/auth/logout-all/route.test.ts`                                    | `valid session + CSRF revokes every session of the current account (incl. current); wrapper takes no account_id`                                    | "Mọi session của account hiện tại (kể cả current) revoked; response ok; wrapper KHÔNG nhận `account_id` param"                  |
| D0-4  | `apps/web/app/api/auth/logout-all/route.test.ts`                                    | `replay with the revoked cookie returns 401 AUTH_INVALID and mutates nothing`                                                                        | "401 `AUTH_INVALID`, zero mutation (B0 §6.2)"                                                                                   |
| D0-5  | `apps/web/app/api/auth/logout-all/route.test.ts`                                    | `missing/wrong x-csrf-token returns 403 CSRF_INVALID and revokes nothing`                                                                            | "403 `CSRF_INVALID`, không revoke gì"                                                                                           |
| D0-6  | `packages/db/src/auth.test.ts`                                                       | `rotated chain: after rotate then logout-all, neither the old nor the new token resolves`                                                           | "Cả token cũ (rotated_from chain) lẫn mới đều không resolve được"                                                               |
| D0-7  | `packages/db/src/auth.test.ts`                                                       | `concurrent logout-all × rotate: no deadlock; final state has no resolvable token; rotate-after-revoke -> null` — case này cover đúng hướng race đã pin (rotate xen giữa wrapper's step 1 và lock); hướng NGƯỢC LẠI (rotate hoàn tất TRƯỚC step 1 của cùng lần gọi logout-all) là **OPEN QUESTION §A1.1, codex round-07** — chưa có expected result nào được owner pin, KHÔNG test case nào ở đây cover được cho tới khi Gate 3 đóng | "Không deadlock; trạng thái cuối: không token nào của account còn resolve; rotate-sau-revoke trả AUTH_INVALID"                  |
| D0-8  | `packages/db/src/auth.test.ts`                                                       | `logout_all audit row commits in the same transaction as the revoke; contains no raw token/hash`                                                    | "`logout_all` audit ghi cùng transaction; không log token/raw"                                                                  |
| D0-9  | `packages/db/src/rls-invariants.test.ts` (+ tsc)                                    | `schema.ts mirrors auth_login_nonces/auth_login_state/rate_limit_hits column-for-column vs live catalog (B0 §9(a))` — PLUS two codex round-04 (FULL) additions to this same case: (a) update the existing hard-coded fresh-migration count assertion in this file's migrations describe block (rls-invariants.test.ts:38-41) from 15 / "0000..0014" to 16 / "0000..0015" — 0015 adds one migration file, the live assertion WILL fail once it lands if not updated; (b) extend catalog-parity coverage to auth_audit_events too, not just the 3 pre-existing drift tables — full shape, all 3 CHECK constraints, its created_at index, and that no grant exists to app/app_worker (B0 §9(2)/(3)) — D0-8's logout_all INSERT only exercises a subset of its columns, that alone is not catalog-parity proof | "Type-check + Drizzle mirror pass; zero runtime/DDL behavior change"                                                            |
| D0-10 | `packages/db/src/auth.test.ts`                                                       | `lock-order trace: revoke path acquires the accounts parent before any web_sessions write (no reversed path)`                                       | "Trace/regression: không path nào lock sessions trước accounts"                                                                 |
| D0-11 | `packages/db/src/auth.test.ts`                                                       | `rotate parent-first replace: 0012-era rotate suite passes unchanged; regression race logout-all × rotate -> no deadlock, no surviving token`        | "Toàn bộ test rotate 0012-era pass nguyên vẹn + regression: race logout-all×rotate không deadlock, không token nào sống sót"    |
| D0-12 | **3 file (cần thêm cả 3 vào manifest scope — §A3.1 hard pre-condition):** `apps/web/lib/session-cookies.test.ts` (lib clause) + `apps/web/app/api/auth/telegram/callback/route.test.ts` + `apps/web/app/api/onboarding/start/route.test.ts` (route clause, file sau CHƯA tồn tại) | lib: `issueSession() throws SessionReauthRequiredError and clears the cookie when the presented cookie's token no longer resolves live (rotate -> null); a no-cookie call still mints via createWebSession`. route×2: `catch maps SessionReauthRequiredError -> 401 AUTH_INVALID` (draft test — §A3.1) | "`issueSession()` thấy rotate trả null → KHÔNG fallback mint; clear session cookie + login route trả 401 `AUTH_INVALID`; retry không cookie mint session mới bình thường (B0 §6 amendment v1.86)" |
| D0-13 | `packages/db/src/rls-invariants.test.ts` (+ tsc)                                    | `catalog test: idx_web_sessions_account_id exists on web_sessions(account_id) WHERE revoked_at IS NULL; schema.ts mirror matches; DROP INDEX rolls back cleanly` | "Partial index `web_sessions(account_id) WHERE revoked_at IS NULL` tồn tại; `schema.ts` mirror khớp; rollback = DROP INDEX"     |

Layer note: D0-1/6/7/8/10/11 chạy trên Postgres thật (grant/RLS/locks — theo điều kiện PASS của
acceptance matrix v2.9b); D0-3/4/5 ở route layer với DB thật phía dưới; D0-9/D0-13 = tsc +
schema-vs-catalog parity (không case nào thiếu expected); **D0-12 span hai layer** — lib layer
(`session-cookies.test.ts`, DB thật phía dưới qua `rotateWebSession`, đóng nửa "KHÔNG fallback
mint + clear cookie") **và** route layer (hai route test, đóng nửa "login route trả 401" — nửa mà
lib-only test KHÔNG tự chứng minh được, vì catch-mapping nằm ở caller, không ở `issueSession()`
tự thân).

**A3 status: PASS** (nội dung packet tự thân) — route skeleton `/api/auth/logout-all` không đổi so
với reference monolith (đã PASS AP-26 Codex round-01/round-02 riêng của monolith đó, không phải
round của packet này) ✓ · v1.86 fence draft chỉ đổi đúng nhánh stale-cookie-rotate-null, phần còn
lại byte-for-byte không đổi ✓ (B0 §6 amendment v1.86 (1)/D0-12) · map test 13/13 đủ, mỗi case có
expected verbatim v2.9b §5 ✓ · D0-12 nay map đủ CẢ HAI layer (lib throw+clear **và** route 401) ✓ ·
D0-9 nay ghi rõ 2 assertion bổ sung bắt buộc (migration count 15→16; catalog-parity cho
`auth_audit_events`, không chỉ 3 bảng drift cũ — codex round-04 FULL) ✓ ·
**caller-impact finding (packet's own Codex round-01) nâng thành hard pre-condition BA bước — (1)
thêm 6 file vào scope (5 từ round-01/02 + `packages/db/README.md` từ round-04), (2) amend
negative-scope dòng 25 (mâu thuẫn phát hiện round-02), (3) cập nhật nội dung `packages/db/README.md`
theo B0 §9(4) (phát hiện round-04) — với text amendment + hướng dẫn cụ thể copy-paste được (§A3.1)**
· **draft test route-level 401 (round-02+round-03 fix, founder-authorized qua REGION_THRASH
exception): telegram case mock `verifyTelegramLogin` + `telegramUserLookupHash` + set
`TELEGRAM_BOT_TOKEN` (unconditional, không `??=`) + assert `issueSession` được gọi; onboarding case
assert `error.code === "AUTH_INVALID"`, không chỉ status 401 ✓.** Founder/P0 session PHẢI thực hiện
cả (1)+(2)+(3) trước Step 1 `auth-s4-d0-revoke-core.json`; đây không phải GAP nội dung của packet
này (packet không có quyền sửa manifest khác), nhưng packet không còn coi đây là "note" nhẹ — nó là
blocker có checklist + amendment text + draft test sẵn sàng copy-paste.

---

## D. Self-check

| §   | Nguồn đã đọc (file + section)                                                                                                                                                                                                                                                                                                                    | Kết quả                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `packages/db/migrations/0012_auth_functions.sql` (toàn bộ, line-by-line; rotate dòng 187-213) + `0001_global_directory.sql` (`web_sessions` dòng 97-106 — chỉ `UNIQUE(token_hash)`, không index `account_id`) · B0 §3.1 (dòng 62) / §5.2 (dòng 310) / §6 amendment v1.83 (dòng 366-368) + amendment v1.86 (dòng 370-372) / §6.1 (dòng 374) / §6.2 (dòng 384) / §7 (dòng 398) / §8.3 (dòng 490) · tech v2.9b D0-1..13 (dòng 386-398) · `decisions.md` v1.86 dòng 993 + v1.83 dòng 997 · manifest `auth-s4-d0-revoke-core.json` negative-scope dòng 23/25 · Verdict 3 v0.6 (dòng 134/148/149) | **PASS** (nội dung tự thân) — helper + wrapper + rotate parent-first replace + audit table lift verbatim từ reference (đã PASS AP-26 monolith's own Codex round-01/02); v1.86 partial index `idx_web_sessions_account_id` thêm đúng cột + predicate, rollback DROP INDEX bổ sung vào header (note N7); **§A1.1 (codex round-07): rotate-races-ahead-of-logout-all là OPEN QUESTION owner chưa quyết — Gate 3 mới, packet KHÔNG tự sửa, chỉ document** |
| A2  | `0012`/`0001` (4 bảng + `web_sessions`, gồm `rotated_from` dòng 103) · `schema.ts` dòng 18-22 (imports) / 108-146 (`accounts`/`webSessions`/`accountIdentities`/`magicLinks` — pattern partial index `.where(sql...)` tại dòng 145; `rotatedFrom` LIVE dòng 120 — không có `.references(...)`) · B0 §9(1)/(2) (dòng 516-525) · tech v2.9b D0-9/D0-13                                                                                                                                                                                                       | **PASS** (parity table 10/10 dòng — 7 dòng bảng drift cũ khớp đủ + `web_sessions` 7/8-cột (codex round-04 FULL finding: `rotated_from` self-FK là PRE-EXISTING gap trên live base, ngoài phạm vi D0, ghi rõ dưới bảng thay vì claim sai 8/8) + 1 dòng partial-index mới)                                                                                                          |
| A3  | `apps/web/lib/session-cookies.ts` (`issueSession` dòng 62-88; `currentSession`/`csrfOk`/`clearSessionCookie`/`hashToken`/`SESSION_COOKIE`/`appDb`) · `apps/web/lib/api-envelope.ts` (`ok`/`err` dòng 4-17) · `apps/web/app/api/auth/logout/route.ts` (style) · `apps/web/app/api/auth/telegram/callback/route.ts` (dòng 87 gọi `issueSession`, catch dòng 89-94) + `route.test.ts` (58 dòng, mock pattern dòng 1-15) · `apps/web/lib/telegram-login.ts` (`verifyTelegramLogin`/`normalizeTelegramPayload` — pure functions, dòng 27-77) · `apps/web/app/api/onboarding/start/route.ts` (dòng 72 gọi `issueSession`, catch dòng 74-79 — KHÔNG có test file) · `apps/web/lib/session-cookies.test.ts` (155 dòng hiện hữu, chưa test `issueSession`) · `packages/db/src/index.ts`/`auth.ts`/`auth.test.ts`/`rls-invariants.test.ts` · manifest D0 scope dòng 27-39 + negative-scope dòng 25 · tech v2.9b §3 error codes + D0 matrix dòng 386-398 | **PASS** — fence draft đổi đúng một nhánh; route `/api/auth/logout-all` không đổi từ reference; map test 13/13 đủ, D0-12 cover cả lib-layer và route-layer với draft test THỰC SỰ chạm `issueSession` (round-02/03 fix, founder-authorized qua REGION_THRASH exception — mock `verifyTelegramLogin`/`telegramUserLookupHash`/set `TELEGRAM_BOT_TOKEN` unconditional/assert called/remove unused import, đóng đủ 4 false-positive/lint finding qua round-02+round-03) và assert đúng `error.code`; D0-9 nay ghi rõ migration-count assertion update (15→16) + `auth_audit_events` catalog coverage (round-04 FULL); **caller-impact finding nâng thành hard pre-condition BA bước trong §A3.1: (1) checklist 6 file (round-01/02: 5 file + round-04: `packages/db/README.md`), (2) amend `negative_scope` dòng 25 (round-02), (3) cập nhật nội dung `packages/db/README.md` theo B0 §9(4) (round-04) — mỗi bước kèm text/hướng dẫn copy-paste được. Không phải GAP nội dung của packet này — packet không có quyền sửa manifest khác — nhưng mọi blocker được ghi rõ, không còn là note nhẹ.** |
| D   | (chính bảng này)                                                                                                                                                                                                                                                                                                                                    | —                                                                                                                                                                                                                               |

Floors giữ nguyên, không transcribe-lệch: Argon2id m=19456/t=2/p=1 · rate-limit buckets B0 §8.2 ·
cookie policy (session Strict; OAuth binding Lax path-scoped ≤600s) — packet D0 này không chạm
floor nào (D0 chỉ revoke-core + session-lifecycle, không có password/rate-limit surface mới), chỉ
nhắc lại DD-80 làm base, không đổi.

**Trước khi mở worktree D0 (tóm tắt §A1.1 + §A3.1 + staleness note ở header) — BA gate bắt buộc,
không phải một:** packet này PASS ở nội dung tự thân (§A1-A3 đều PASS, không GAP — tức DDL/TS/
test-map draft đúng, transcribe đúng nguồn) — nhưng `auth-s4-d0-revoke-core.json` +
`slice-readiness-verdicts.md` Verdict 3 CHƯA phản ánh những gì packet vừa phát hiện: (checklist 6
file, negative-scope amendment, README content update — §A3.1) VÀ (một race chưa được authority
cover — §A1.1). Verdict 3 hiện đọc là **STALE, `NOT_CODE_READY`**.

- **Gate 1:** manifest `auth-s4-d0-revoke-core.json` được amend theo cả 3 bước §A3.1.
- **Gate 2 (codex round-06):** `slice-readiness-verdicts.md` được re-review, re-issue PASS mới cho
  `auth-s4-d0-revoke-core` — một manifest đã amend KHÔNG tự động nghĩa là verdict lại đúng.
- **Gate 3 (codex round-07, MỚI):** owner quyết định hướng đóng race rotate-races-ahead-of-logout-all
  (§A1.1) — quyết định đó phải được transcribe vào B0/tech v2.9b/decisions.md (cùng pattern
  v1.78/v1.83/v1.85/v1.86) **trước khi** Verdict 3 có thể PASS lại ở Gate 2. Gate 3 do đó là
  precondition CỦA Gate 2, không phải độc lập — thứ tự đúng: Gate 3 → Gate 1 → Gate 2.

Đây là lý do packet vẫn emit marker hoàn thành bên dưới — nội dung DDL/TS/test-map đã đầy đủ, "zero
design decision còn lại" **cho phần packet có thẩm quyền viết** — nhưng founder PHẢI đóng ĐỦ CẢ BA
gate theo đúng thứ tự trước Step 1, không phải chỉ gate 1, và không phải bỏ qua vì đọc thấy marker
complete.

**Founder Authorization Record (đóng codex round-07 finding #2 — completion marker phải verifiable
từ tracked file, không chỉ từ out-of-band claim):**

| Round | Breaker | Ngày | Founder decision | Ghi ở |
|---|---|---|---|---|
| round-03 | REGION_THRASH | 2026-07-19 | Authorize 2 fix + 1 FULL review | conversation record; xem `.autopilot/state/docs-auth-d0-packet/regions.log` (gitignored — không track được qua git, ghi lại đây để tracked/reviewable) |
| round-06 | MAX_ROUNDS (count=6) | 2026-07-19 | Authorize 2 fix + 1 FULL review | như trên |
| round-07 | MAX_ROUNDS (count=7) finding #1 (race) | 2026-07-19 | Route qua owner decision (Gate 3 mới, §A1.1) — packet KHÔNG tự sửa | như trên |
| round-07 | finding #2 (marker visibility) | 2026-07-19 | Thêm chính bảng này vào packet (tracked) | — |
| round-08 | MAX_ROUNDS (count=8) — FULL final confirmation | 2026-07-19 | "Run round-08 as genuinely final; fix only small mechanical P1, document P2 as open notes, stop regardless after" | như trên |

Bốn exception trên đều là quyết định của founder tại thời điểm review, không phải packet tự ý vượt
breaker. `fix-round-count.txt` cuối cùng = 8 (÷5 cap) — con số này PHẢI đi kèm bảng authorization
trên để một reviewer đọc riêng file này (không có conversation transcript) vẫn xác minh được.

**OPEN NOTE — tension chưa giải quyết (codex round-08 [P2], KHÔNG tự quyết trong packet này):**
`autopilot-docs-auth-d0-packet.md`'s own "Deterministic outcome" table pin: marker chỉ hợp lệ khi
"All sections PASS, self-check has no GAP"; authority conflict → `HALT-AUTHORITY_AMBIGUOUS.txt`,
**không marker**. §A1.1 (Gate 3) là một unresolved authority gap thật — D0-7 không cover đủ mọi
hướng race, chưa owner quyết. Đọc chữ đúng nghĩa đen, điều này có thể lập luận packet PHẢI
`HALT-AUTHORITY_AMBIGUOUS` thay vì emit marker. Packet này KHÔNG tự chọn cách đọc — founder đã yêu
cầu (round-06/07/08) marker vẫn emit kèm framing "PASS ở nội dung tự thân, NOT_CODE_READY tổng thể
cho tới 3 gate đóng" thay vì HALT tuyệt đối; đây là cách đọc packet đang dùng, nhưng codex round-08
chỉ ra nó không khớp 100% với chữ nghĩa gốc của task contract. Ghi lại làm open note cho founder,
không tự sửa task contract (ngoài quyền packet) cũng không tự đổi quyết định marker đã có.

---

AUTH_D0_PACKET_COMPLETE
