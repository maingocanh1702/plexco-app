# Feature: Web Auth & Onboarding — Security Invariant & Test Matrix (auth-onboarding v3)

> **Canonical phase:** P4
> **Version:** 1.0 · 2026-07-06
> **Status (cập nhật 2026-07-10):** **IMPLEMENTED (Telegram-era) — v3 đã MERGE vào `main@1eb6f60`** (`5b1193b Merge feat/auth-onboarding-v3`; kèm migrations `0012/0013`, session-cookies, KMS pepper client, `auth.test.ts`). Bảng này nay là **AUDIT checklist trên code đã merge** (verify SI-1..SI-8 còn giữ) + **spec carry-over cho việc thay provider Telegram Login → Google/email** (DD-37/DD-13, **chưa implement**). ~~"Proposal / build-new / DD-31 chờ v3 merge"~~ đã lỗi thời. DD-31 → xem `../../standards/decisions.md` (đổi từ "chờ merge" → "merged; residual = Google/email swap").
> **Scope:** Executable invariant catalog for the auth-onboarding v3 security-design pass. Does not modify `../feature_web_auth_onboarding.md` or `feature_web_auth_onboarding_tech.md` (both stay Reviewed, untouched).
> **Source note:** The approved plan `docs/proposals/auth-security-design-pass-plan-2026-07-06.md` is now SYNCED into this branch (it was drafted in the main working tree; since copied + committed here) and this table has been reconciled against it — SI-1..SI-8 + the 4 gaps + the layer split match the plan. The catalog is cross-derived from that plan, the Reviewed product/BE specs, the live schema, and the `auth-onboarding-v2` evidence trail (`.autopilot/state/auth-onboarding-v2/codex/round-01..09.txt`, `HALT-MAX_ROUNDS.txt`, `AWAIT-FOUNDER-round09-nonconvergence.txt`, `regions.log`, `prescan.md`).
>
> **⚠️ Cập nhật 2026-07-10 (DD-37 + DD-13 ✅):** **Telegram bị bỏ khỏi phạm vi** (DD-37) ⇒ không còn TG Login; auth phase-1 = **Google OAuth + email/password** (DD-13 ✅). **OQ-1 (§5) đã bị đảo.** SI-2 keyed-hash nay áp cho `google.sub` / normalized email thay `telegram:id`. Finding round-09 "Telegram user id entropy thấp / enumerable" là **moot**, nhưng keyed HMAC vẫn **giữ** cho nhất quán (Google `sub` entropy cao hơn nhưng vẫn keyed). SI-1/SI-3..SI-8 giữ nguyên hiệu lực (thay "TG payload/id_token" bằng "OAuth id_token / login payload"). **DD-31 nay ✅ Merged** (v3 land trên `main@1eb6f60`); residual = audit SI trên main + Google/email swap. `file:line` refs cũ (telegram-login.ts) là bằng chứng lịch sử v2 — v3 build lại theo Google/email adapter.

---

## 0. Current status (post-merge, 2026-07-10) — ĐỌC TRƯỚC

> **Đây là trạng thái hiện hành. §1–§5 bên dưới là KẾ HOẠCH PRE-MERGE, nay giữ làm PHỤ LỤC LỊCH SỬ.**

- **Đã land trên `main@1eb6f60`** (verified git): merge `5b1193b feat/auth-onboarding-v3`; migrations **`0012_auth_functions.sql` + `0013_onboarding_steps_recency.sql`**; **KMS pepper client** (`37296ef`); `SECURITY DEFINER search_path` fix (`3ce516f`); session-cookies; bộ test auth. **Telegram-era** (routes/hash dùng `telegram`).
- **Do đó các câu dưới đây LỖI THỜI:** SI-1 "NEW table/route", SI-2 "helper chưa wire / no code reads KMS", SI-3–SI-8 "GAP / PORT / reimplement từ v2 @7407caa", §3 "zero hits/no code". Chúng mô tả lúc base `feat/phase1-fable5` **chưa có auth code** — không còn đúng sau merge.
- **Việc hiện tại (carry-over):** (1) **AUDIT** SI-1..SI-8 trên code đã merge (verify từng bất biến còn giữ + test hiện có trên `main` xanh); (2) **thay provider** Telegram Login → **Google/email** (DD-37/DD-13) rồi re-verify SI-1/SI-2 cho `google.sub`/email. Theo dõi như hạng mục con của DD-13, KHÔNG mở lại DD-31.

---

## 1. Layer distinction (v2 blurred this — do not repeat)

| Layer | Table.column | Status today | Mandate | Ref |
|---|---|---|---|---|
| **Web-auth** (Google OAuth / email / Facebook → `accounts`; ex-TG Login, dropped DD-37) | `account_identities.platform_user_hash` | v2 ref was **unkeyed** `sha256("telegram:" + id)`; phase-1 subjects are now `google.sub` / normalized email (DD-13) **và Facebook app-scoped subject (DD-33 ✅ owner 18/07; capability gated tới khi có external evidence)**. Bare hash still reversible under exposure → keyed HMAC required, domain/provider-separated per subject | Gap-to-pin — SI-2 | `schema.ts:129`, migration `0001_global_directory.sql:112`; v2 ref hash at `apps/web/lib/telegram-login.ts:78-81` (historical — v3 uses Google/email/Facebook adapters) |
| **Channel** (bot adapters → `persons`) | `channel_identities.platform_user_lookup_hash` | Keyed-KMS **mandated** by spec; not touched by this pass | Already governed, different feature/owner | `schema.ts:60`, migration `0001_global_directory.sql:44`; mandate at `BE/feature_identity_tech.md:118` ("keyed lookup hashes... Keys come from KMS") |

SI-2 below is about the **web-auth** column only. It must not be confused with, merged into, or used to justify deferring the channel layer's own (separately governed) keyed-hash work.

> **DD-33 ✅ (owner 18/07):** Facebook app-scoped subject là **một web-auth subject nữa** dưới SI-2 — keyed HMAC domain/provider-separated như `google.sub`/email. Nó **không** phải Messenger Page-scoped PSID (channel layer, `channel_identities`) và **không** được auto-link chéo; chỉ quy về cùng `person` qua verified account identity hoặc transactional one-time `link_code`. Capability non-test OFF tới khi external evidence (C4) pass.

---

## 2. Invariant + test matrix (SI-1..SI-8) — 📜 PHỤ LỤC LỊCH SỬ (kế hoạch pre-merge)

> Đọc **§0** cho trạng thái hiện hành. Các tag "NEW / GAP / PORT / reimplement / zero hits" dưới đây là **pre-merge** (base chưa có auth code). Sau merge `main@1eb6f60`, dùng ma trận này làm **checklist AUDIT trên code đã land** + **carry sang Google/email**.

> ⚠️ **CẬP NHẬT 2026-07-10 — trạng thái pre-merge dưới đây ĐÃ LỖI THỜI.** Auth Onboarding **v3 đã MERGE vào `main@1eb6f60`** (`5b1193b Merge feat/auth-onboarding-v3`): `apps/web/app/api/auth/*`, session-cookies, `auth.test.ts`, và **migrations `0012/0013` nay đã committed trên `main`** (không còn "chỉ trên branch chưa merge"). Bản đã land là **Telegram-era** (routes/hash dùng `telegram`). **DD-37 supersede provider** → cần **thay Telegram Login bằng Google OAuth + email/password** (DD-13 ✅) — phần replacement này **chưa implement**. Vì vậy bảng SI-1..SI-8 nay là **checklist AUDIT/PORT trên code đã merge** (xác minh bất biến còn giữ sau khi land + khi swap provider), **KHÔNG** phải "build from zero". Các `file:line` bên dưới giờ trỏ code **đã tồn tại trên main** (không còn chỉ là "v2 reference").
>
> _Ghi chú lịch sử (trước merge):_ ~~v3 base has ZERO auth code; SI-1..SI-8 phải build mới / PORT từ `feat/auth-onboarding-v2 @7407caa`.~~ Giữ làm lịch sử — không dùng làm hướng dẫn hiện hành.

### SI-1 — Pre-auth login-state CSRF binding · **verify-on-main + re-target Google/email** (pre-merge: GAP)

| | |
|---|---|
| **Invariant** | Before provider login begins (Google OAuth redirect or email auth), the server issues/binds the required single-use, short-TTL anti-CSRF state to the browser session. The callback/submit path must consume the exact matching state — reject if missing, mismatched, expired, or already consumed — independent of Origin/Referer transport. |
| **Threat blocked** | Login CSRF / account-binding confusion: an attacker delivers their own valid provider callback/login payload through the victim's browser and binds the victim session to the attacker's account. Provider signature/token validity alone does not prove browser intent. |
| **Test (concrete)** | (a) valid provider callback/login payload + missing browser-bound state → 401 `AUTH_INVALID`, no session minted; (b) state consumed once → second consume rejects; (c) expired state rejects; (d) captured state cannot replay from another client. |
| **Canonical/schema ref** | Gap-to-pin, DD-31. Today's only mitigation is `sameOriginRequest()` (`apps/web/lib/session-cookies.ts:96-123`, carried over from `auth-onboarding-v2` round-08 — see `regions.log:14-15`). SI-1 supplements this (defense-in-depth), it does not replace the Origin check. |
| **Exact column + layer** | NEW `auth_login_state` table (GLOBAL protected plane, same pattern as `auth_login_nonces` in migration `0012_auth_functions.sql:15-18`) + NEW issue route (e.g. `GET/POST /api/auth/telegram/state`) + consume logic inside `POST /api/auth/telegram` — **web-auth layer**. |

### SI-2 — Keyed lookup hash for web-auth `account_identities.platform_user_hash` · **verify-on-main + re-target Google/email** (pre-merge: GAP)

| | |
|---|---|
| **Invariant** | The value written to and looked up against `account_identities.platform_user_hash` must be a keyed HMAC (server-side secret/pepper) over the provider subject (`google.sub` for provider `google`, normalized email for provider `email`), never a bare unkeyed hash. |
| **Threat blocked** | Offline brute-force / confirmation of which subjects have Plexco accounts if `account_identities` (or a backup/replica) is ever exposed. **DD-37 note:** the original round-09 finding was Telegram-specific (sequential, enumerable, low-entropy integer IDs → `sha256("telegram:" + id)` reversible over a tiny search space). With Telegram dropped that specific finding is **moot**; Google `sub` is higher-entropy, but a bare hash of a known subject is still a lookup/confirmation oracle under exposure, so the keyed HMAC is **retained** for consistency and defense-in-depth. |
| **Test (concrete)** | For a fixed `google.sub` (or email), the emitted hash differs from the bare `sha256(sub)` (proves keying is active); changing the configured key changes the output for the same input (proves the key is load-bearing, not a dead parameter); the write path (login/register) and read path (lookup) produce identical hashes for the same subject + key (write/read parity — a mismatch silently breaks login for every existing user). |
| **Canonical/schema ref** | Round-09 finding — `.autopilot/state/auth-onboarding-v2/codex/round-09.txt`, `AWAIT-FOUNDER-round09-nonconvergence.txt` (historical, Telegram-era). v3 subject is `google.sub`/email (DD-13). Key source resolved 2026-07-06 (OQ-2 → AWS KMS, §5) — still needs the actual helper wired in Phase B. |
| **Exact column + layer** | `account_identities.platform_user_hash` (`schema.ts:129`; migration `0001_global_directory.sql:112`) — **web-auth layer**. Explicitly **not** `channel_identities.platform_user_lookup_hash` (`schema.ts:60`; migration `0001_global_directory.sql:44`) — see §1. |

### SI-3 — Explicit tenant-filter policy for tenant-scoped auth/onboarding reads · **GAP (new written policy) + PORT round-07 code fix from v2**

| | |
|---|---|
| **Invariant** | Every tenant-scoped read added under the auth/onboarding surface combines (a) `withTenant(db, tenantId, …)` (sets the `app.tenant_id` RLS GUC) **and** (b) an explicit `WHERE tenant_id = $tenantId` predicate inside the query itself. Neither alone is the policy — RLS is the fail-closed backstop; the explicit predicate is what protects a privileged/misrouted connection (e.g. `app_worker`/superuser reused incorrectly) that bypasses RLS outright. |
| **Threat blocked** | A privileged or misrouted connection silently falling back to the globally-latest row across all tenants instead of erroring — e.g. tenant A's host seeing tenant B's onboarding/readiness data. |
| **Test (v2 reference @7407caa — port & must pass in v3)** | `packages/db/src/auth.test.ts:350-367` — "returns the caller's OWN run even under a superuser connection that bypasses RLS": asserts `onboardingSnapshot` under an RLS-bypassing superuser connection still returns tenant A's row, not tenant B's later-inserted row, because of the explicit predicate. |
| **Canonical/schema ref** | Round-07 finding (`regions.log:8-10`). The belt-and-suspenders fix exists at `packages/db/src/auth.ts:145-149` **only on `feat/auth-onboarding-v2` @7407caa** — that file does not exist on the v3 base (`feat/phase1-fable5`, verified via git). v3 must (a) port `onboardingSnapshot` with this exact pattern, and (b) pin it as a written policy + review checklist item so every NEW tenant-scoped query added later on this surface follows it too, not just this one function. |
| **Exact column + layer** | `onboarding_runs.tenant_id` / `onboarding_steps.run_id` (TENANT + RLS plane; migration `0008_notifications_onboarding.sql:56-71` + `0009_rls_policies_grants.sql`). |

### SI-4 — Logout fail-closed · **PORT from v2 (round-06 fix) — reimplement in v3**

| | |
|---|---|
| **Invariant** | `POST /api/auth/logout` clears the session cookie only after successfully resolving and revoking a real server-side session. A request with no ambient cookie, or whose cookie matches no live session, leaves client cookie state untouched. |
| **Threat blocked** | Logout CSRF — a cross-site form POST forcing the victim's browser to drop a real session cookie via `Set-Cookie`, even though no session was ever touched server-side. |
| **Test (v2 reference @7407caa — port & must pass in v3)** | `apps/web/app/api/auth/logout/route.test.ts:44-52` ("logout CSRF: a cross-site POST with no ambient cookie revokes and clears nothing") and `:54-61` ("a stale/forged cookie matching no live session is left in place, not cleared"). |
| **Canonical/schema ref** | Round-06 (`HALT-MAX_ROUNDS.txt`, `regions.log:6`). |
| **Exact column + layer** | `web_sessions.revoked_at` (GLOBAL protected plane, `schema.ts:121`; migration `0001_global_directory.sql:104`) via `auth_revoke_web_session()` (migration `0012_auth_functions.sql:149-160`). |

### SI-5 — Shared, advisory-lock-serialized rate limiter · **PORT from v2 (round-04/05 fix) — reimplement in v3**

| | |
|---|---|
| **Invariant** | Login attempts are capped 10/min/IP through one shared Postgres-backed counter (`rate_limit_hits` + `rate_limit_check()`), with same-bucket admission serialized by `pg_advisory_xact_lock` so a concurrent burst cannot all pass before any peer commits; replicas/restarts cannot multiply or reset buckets. |
| **Threat blocked** | Brute-force / DoS amplification against the login endpoint via horizontal scaling — N web replicas each holding an in-memory counter would multiply the effective limit by N. |
| **Test (v2 reference @7407caa — port & must pass in v3)** | `packages/db/src/auth.test.ts:192-200` ("allows up to the limit within the window, then refuses") and `:202-207` ("concurrent burst admits EXACTLY the limit (per-bucket serialization)"). |
| **Canonical/schema ref** | `docs/standards/business-rules.md:126` (BL-SEC-5 registry — `POST /auth/*` → 10/min → IP → 429 `RATE_LIMITED`); round-04/05 (`regions.log:2-5`). |
| **Exact column + layer** | `rate_limit_hits` (GLOBAL/infra plane, UNLOGGED; migration `0012_auth_functions.sql:258-263`) via `rate_limit_check()` (same file, `L266-295`). |

### SI-6 — Creation-race idempotency · **PORT from v2 (0012 design) — reimplement in v3**

| | |
|---|---|
| **Invariant** | Concurrent identical requests never create duplicate rows: (a) two concurrent FIRST logins for the same verified provider subject converge on ONE account/person; (b) two concurrent `tenant_provision` calls for the same slug by the SAME owner both resolve to the SAME tenant, while a DIFFERENT actor re-submitting an existing slug gets `SLUG_TAKEN` rather than silently joining or taking it over. |
| **Threat blocked** | Duplicate persons/accounts/tenants from double-submits or multi-tab races (data integrity), and slug-squatting/tenant-takeover by a non-owner. |
| **Test (v2 reference @7407caa — port & must pass in v3)** | `packages/db/src/auth.test.ts:80-98` (concurrent first logins converge), `:276-298` (idempotent re-submit vs. `SLUG_TAKEN` for another person), `:300-319` (concurrent same-owner submissions, no false 409), `:321-340` (a mere member re-submitting the slug gets `SLUG_TAKEN`). |
| **Canonical/schema ref** | `../feature_web_auth_onboarding.md` Bất biến L20 + edge case #3 L60; BE tech spec edge cases #4/#5 (`L86-87`). |
| **Exact column + layer** | `account_identities` `UNIQUE(platform, platform_user_hash)` (web-auth/GLOBAL, `schema.ts:132`) via `auth_login_telegram()` (migration `0012_auth_functions.sql:28-82`); `tenants.slug` `UNIQUE` (TENANT root, `schema.ts:155`) via `tenant_provision()` (same file, `L169-233`). |

### SI-7 — Session rotation on every privilege transition · **PORT from v2 (design delta) — reimplement in v3**

| | |
|---|---|
| **Invariant** | Login (fresh, and over-a-live-cookie) and tenant provisioning (owner grant) rotate the session token through the single `issueSession()` choke-point, binding the NEW session to the JUST-authenticated/JUST-privileged account. No route hand-rolls session issuance. |
| **Threat blocked** | Session fixation (attacker pre-seeds a token, victim logs in, attacker's pre-known token becomes privileged) and account-confusion (logging in as account B over account A's live cookie must never leave a cookie that still authenticates as A). |
| **Test (v2 reference @7407caa — port & must pass in v3)** | `packages/db/src/auth.test.ts:130-177` ("rotation revokes the old token and links the new session (fixation defense)"), including the cross-account sub-case at `:153-165`. |
| **Canonical/schema ref** | `../feature_web_auth_onboarding.md` Bất biến L19 + edge case #12 L69; BE tech spec `L21` + `L144` (rotation triggers) + Testing Plan #5 `L167` (session-fixation test); `prescan.md:58-67` (privilege-transition rotation table). |
| **Exact column + layer** | `web_sessions.rotated_from` (GLOBAL protected plane, `schema.ts:120`; migration `0001_global_directory.sql:103`) via `auth_rotate_web_session()` (migration `0012_auth_functions.sql:121-147`) and `issueSession()` (`apps/web/lib/session-cookies.ts:61-87`). |

### SI-8 — `onboarding_steps` recency dedupe · **PORT from v2 (round-08 fix + migration 0013) — reimplement in v3**

| | |
|---|---|
| **Invariant** | Retries legitimately leave multiple rows per `(run_id, step)` (unique on `run_id, step, idempotency_key`). Any read of step status selects the MOST RECENT row per step (`DISTINCT ON (step) … ORDER BY step, created_at DESC`), never an arbitrary/unordered row. |
| **Threat blocked** | A stale `error`/`not_configured` row from an earlier failed attempt shadowing a later `verified` row (or vice versa) in the readiness checklist — host sees the wrong onboarding status. |
| **Test (v2 reference @7407caa — port & must pass in v3)** | `packages/db/src/auth.test.ts:369-391` ("keeps only the MOST RECENT row per step when a retry leaves duplicates"). |
| **Canonical/schema ref** | Round-08 finding (`regions.log:12`: "onboarding_steps dedup [P2]"). |
| **Exact column + layer** | `onboarding_steps.created_at` (TENANT + RLS plane, migration `0013_onboarding_steps_recency.sql:9`, added on top of `0008_notifications_onboarding.sql:64-76`) consumed by `onboardingSnapshot()` (`packages/db/src/auth.ts:150-185`). |

---

## 3. Gaps to pin (DD-31) — 📜 PHỤ LỤC LỊCH SỬ (pre-merge; xem §0)

> ⚠️ **Cập nhật 2026-07-10 — mô tả "chưa có code" dưới đây đã LỖI THỜI (post-merge).** `auth-onboarding-v3` **đã merge vào `main@1eb6f60`**: v3 auth code + migrations `0012/0013` + **KMS pepper client** (git `37296ef fix(auth): require AWS_REGION for the KMS pepper client`) + `SECURITY DEFINER search_path` fix (`3ce516f`) + tests đều đã có trên `main`. Do đó các câu "no code reads KMS / no helper in packages/ (zero hits)" và "round-07 fix chỉ trên v2 chưa merge" là **trạng thái trước merge** — giữ làm lịch sử. **Việc còn lại thực sự OPEN = thay provider Telegram Login → Google/email** (DD-37/DD-13); dùng bảng này để **audit SI-1..SI-8 trên code đã merge** rồi **carry sang adapter Google/email**. 4 mục đánh số bên dưới giữ để tra cứu, đọc theo lăng kính "verify-on-main + re-target Google/email", KHÔNG phải "build greenfield".

Founder DECISIONS on all four gaps are RESOLVED (OQ-1/2/3, §5, 2026-07-06). Nội dung gốc (pre-merge) — mỗi mục nay là **verify-on-main + carry sang Google/email**:

1. **Pre-auth login-CSRF browser-bound state** → SI-1. New mechanism (3 artifacts): `auth_login_state` migration, a login-state issue route, callback consume logic.
2. **Explicit tenant-filter policy** → SI-3. Pin as written policy + review checklist item; the round-07 code fix exists only on `feat/auth-onboarding-v2` (unmerged) — v3 must port `onboardingSnapshot` with this pattern AND formalize it as a policy for future queries on this surface, not just formalize an already-shipped fix.
3. **KMS/secret source wiring** → blocks SI-2 (and, if SI-1 signs its state token rather than just storing it row-side, SI-1 too). No dedicated SI row — cross-cutting. **Historical pre-merge evidence:** env conventions existed but no package consumed them at that snapshot. **Resolved 2026-07-06 (OQ-2, §5): AWS KMS** for staging/prod; runtime gets references/secrets through the provider-neutral encrypted-env boundary in `environments-setup.md`, and local dev keeps `ENCRYPTION_KEY`. The merged v3 helper is the shared source for auth-surface key material; the Google/email port must reuse it rather than create a provider-specific key path.
4. **Keying for web-auth `account_identities.platform_user_hash`** → SI-2. The algorithm/mechanism decision (keyed HMAC) is not itself contested; it is blocked on gap 3 for where the key comes from.

---

## 4. Open items surfaced while authoring this table

- ~~Approved plan missing~~ **RESOLVED**: `docs/proposals/auth-security-design-pass-plan-2026-07-06.md` is now synced into this branch and this table has been reconciled against it (SI-1..SI-8 + 4 gaps + layer split match).
- See `docs/standards/decisions.md` DD-31 for the merged Telegram-era baseline and DD-13/DD-37 for the current Google/email provider port.

---

## 5. Founder decisions (2026-07-06; OQ-1/OQ-3 superseded 2026-07-10)

| | Question | Answer |
|---|---|---|
| **OQ-1 (historical)** | DD-13 scope — Phase-1 auth = TG Login + web-account fallback only, or add Google/email-password now? | ~~TG Login only; DD-13 deferred.~~ **Superseded by DD-13/DD-37 on 2026-07-10:** phase-1 auth = Google OAuth + email/password; Telegram Login removed from target scope. |
| **OQ-2** | KMS/secret source — which store provides the keyed-hash pepper (SI-2) + login-state secret (SI-1)? | **AWS KMS** for staging/prod (`KMS_PROVIDER=aws-kms`); runtime delivery uses the provider-neutral encrypted-env boundary, local dev keeps `ENCRYPTION_KEY`. Wiring merged in Auth v3; the Google/email port must reuse it. |
| **OQ-3 (historical)** | Record DD-31 now, or keep it proposal until v3 merges? | ~~Keep as proposal until v3 merges.~~ **Resolved:** v3 merged on `main@1eb6f60`; DD-31 is ✅ merged (Telegram-era), residual provider port lives under DD-13/DD-37. |
