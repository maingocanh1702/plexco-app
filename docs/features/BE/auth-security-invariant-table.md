# Feature: Web Auth & Onboarding — Security Invariant & Test Matrix (auth-onboarding v3)

> **Canonical phase:** P4
> **Version:** 1.3 · 2026-07-19
> **Status (cập nhật 2026-07-19):** **IMPLEMENTED (Telegram-era) — v3 đã MERGE vào `main@1eb6f60`** (`5b1193b Merge feat/auth-onboarding-v3`; kèm migrations `0012/0013`, session-cookies, KMS pepper client, `auth.test.ts`). Bảng này nay là **AUDIT checklist trên code đã merge** (verify SI-1..SI-8 còn giữ) + **spec carry-over cho việc thay provider Telegram Login → Google/email** (DD-37/DD-13, **chưa implement**). ~~"Proposal / build-new / DD-31 chờ v3 merge"~~ đã lỗi thời. DD-31 → xem `../../standards/decisions.md` (đổi từ "chờ merge" → "merged; residual = Google/email swap").
> **Scope:** Executable invariant catalog for the auth-onboarding v3 security-design pass. Product/BE specs remain Reviewed and now mirror the 2026-07-18 cross-site transport correction; this table is the audit checklist, not a separate runtime claim.
> **Source note:** The approved plan `docs/proposals/auth-security-design-pass-plan-2026-07-06.md` is now SYNCED into this branch (it was drafted in the main working tree; since copied + committed here) and this table has been reconciled against it — SI-1..SI-8 + the 4 gaps + the layer split match the plan. The catalog is cross-derived from that plan, the Reviewed product/BE specs, the live schema, and the `auth-onboarding-v2` evidence trail (`.autopilot/state/auth-onboarding-v2/codex/round-01..09.txt`, `HALT-MAX_ROUNDS.txt`, `AWAIT-FOUNDER-round09-nonconvergence.txt`, `regions.log`, `prescan.md`).
>
> **⚠️ Cập nhật 2026-07-10 (DD-37 + DD-13 ✅):** **Telegram bị bỏ khỏi phạm vi** (DD-37) ⇒ không còn TG Login; auth phase-1 = **Google OAuth + email/password** (DD-13 ✅). **OQ-1 (§5) đã bị đảo.** SI-2 keyed-hash nay áp cho `google.sub` / normalized email thay `telegram:id`. Finding round-09 "Telegram user id entropy thấp / enumerable" là **moot**, nhưng keyed HMAC vẫn **giữ** cho nhất quán (Google `sub` entropy cao hơn nhưng vẫn keyed). SI-1/SI-3..SI-8 giữ nguyên hiệu lực (thay "TG payload/id_token" bằng "OAuth id_token / login payload"). **DD-31 nay ✅ Merged** (v3 land trên `main@1eb6f60`); residual = audit SI trên main + Google/email swap. `file:line` refs cũ (telegram-login.ts) là bằng chứng lịch sử v2 — v3 build lại theo Google/email adapter.
>
> **⚠️ Transport correction 2026-07-18:** SI-1 giữ nguyên mục tiêu nhưng **không** reuse nguyên transport Telegram. Live `auth_login_state` + Strict cookie + `sameOriginRequest()` chỉ fit same-origin POST. Google/Facebook callback là cross-site GET, phải dùng protected OAuth transaction + path-scoped Lax browser binding và không gọi same-origin header gate. Email verify/reset dùng non-mutating landing GET → explicit same-origin POST. Chi tiết canonical: `../feature_web_auth_onboarding_tech.md` §4 + `../../probes/b0-auth-credential-lifecycle-design-probe.md` §4.1/§8.4.
>
> **⚠️ Live-invariant correction 2026-07-19:** SI-1 distinguishes existing Telegram/same-origin state from the new OAuth transaction instead of retaining pre-merge “NEW/Origin always” wording. SI-2..SI-7 now point to the merged Telegram-era implementation/tests and separately name the Google/email carry-over; SI-8 names `onboarding_steps.seq DESC` as the authoritative ordering because `created_at` ties are valid and covered by live tests.

---

## 0. Current status (post-merge, 2026-07-19) — ĐỌC TRƯỚC

> **Đây là trạng thái hiện hành. §2 là ma trận audit live + carry-over; §1 và §3–§5 giữ thêm bối cảnh/quyết định pre-merge, nhưng mọi chỉ dẫn hiện hành trong đó phải đọc theo baseline đã merge.**

- **Đã land trên `main@1eb6f60`** (verified git): merge `5b1193b feat/auth-onboarding-v3`; migrations **`0012_auth_functions.sql` + `0013_onboarding_steps_recency.sql`**; **KMS pepper client** (`37296ef`); `SECURITY DEFINER search_path` fix (`3ce516f`); session-cookies; bộ test auth. **Telegram-era** (routes/hash dùng `telegram`).
- **Các nhãn pre-merge đã được đóng:** SI-1 "NEW table/route", SI-2 "helper chưa wire / no code reads KMS", SI-3–SI-8 "GAP / PORT / reimplement từ v2 @7407caa", §3 "zero hits/no code" chỉ mô tả snapshot lịch sử `feat/phase1-fable5`. Ma trận §2 bên dưới đã được reconcile về code/test live; phần Google/email được ghi riêng là carry-over chưa implement.
- **Việc hiện tại (carry-over):** (1) **AUDIT** SI-1..SI-8 trên code đã merge (verify từng bất biến còn giữ + test hiện có trên `main` xanh); (2) **thay provider** Telegram Login → **Google/email** (DD-37/DD-13) rồi re-verify SI-1/SI-2 cho `google.sub`/email. Theo dõi như hạng mục con của DD-13, KHÔNG mở lại DD-31.

---

## 1. Layer distinction (v2 blurred this — do not repeat)

| Layer | Table.column | Status today | Mandate | Ref |
|---|---|---|---|---|
| **Web-auth** (Google OAuth / email / Facebook → `accounts`; live baseline còn TG Login, target TG bị bỏ theo DD-37) | `account_identities.platform_user_hash` | **Live Telegram-era:** keyed HMAC qua `telegramUserLookupHash()` + shared KMS/dev secret resolver, có regression test. **Provider port chưa implement:** áp cùng domain/provider-separated HMAC cho `google.sub`, normalized email và Facebook app-scoped subject (DD-33; capability gated tới khi có external evidence) | Live baseline + mandatory provider carry-over — SI-2 | `schema.ts:129`, migration `0001_global_directory.sql:112`; `apps/web/lib/telegram-login.ts::telegramUserLookupHash`; `apps/web/lib/auth-secrets.ts` |
| **Channel** (bot adapters → `persons`) | `channel_identities.platform_user_lookup_hash` | Keyed-KMS **mandated** by spec; not touched by this pass | Already governed, different feature/owner | `schema.ts:60`, migration `0001_global_directory.sql:44`; mandate at `BE/feature_identity_tech.md:118` ("keyed lookup hashes... Keys come from KMS") |

SI-2 below is about the **web-auth** column only. It must not be confused with, merged into, or used to justify deferring the channel layer's own (separately governed) keyed-hash work.

> **DD-33 ✅ (owner 18/07):** Facebook app-scoped subject là **một web-auth subject nữa** dưới SI-2 — keyed HMAC domain/provider-separated như `google.sub`/email. Nó **không** phải Messenger Page-scoped PSID (channel layer, `channel_identities`) và **không** được auto-link chéo; chỉ quy về cùng `person` qua verified account identity hoặc transactional one-time `link_code`. Capability non-test OFF tới khi external evidence (C4) pass.

---

## 2. Invariant + test matrix (SI-1..SI-8) — LIVE AUDIT + PROVIDER CARRY-OVER

> Đọc **§0** cho baseline. Mỗi row dưới đây tách rõ phần **live Telegram-era** đã có code/test và phần **provider carry-over** chưa implement; không dùng nhãn pre-merge “GAP / PORT / reimplement” như trạng thái hiện hành.

> **Live baseline:** Auth Onboarding v3 đã merge vào `main@1eb6f60`; routes/session/KMS helper/tests và migrations `0012/0013` đều tồn tại. Bản đã land còn là Telegram-era. DD-37/DD-13 yêu cầu provider replacement Google OAuth + email/password, nên row nào có provider-specific behavior đều ghi thêm test/build obligation cho port này.
>
> _Ghi chú lịch sử (trước merge):_ ~~v3 base has ZERO auth code; SI-1..SI-8 phải build mới / PORT từ `feat/auth-onboarding-v2 @7407caa`.~~ Giữ làm lịch sử — không dùng làm hướng dẫn hiện hành.

### SI-1 — Pre-auth login-state CSRF binding · **verify-on-main + re-target Google/email** (pre-merge: GAP)

| | |
|---|---|
| **Invariant** | Before login begins, server issues single-use, short-TTL state bound to the initiating browser. Same-origin email login uses `auth_login_state` + Strict cookie + Origin check; cross-site OAuth uses `auth_oauth_transactions` + provider-specific Lax binding and **no** `sameOriginRequest()`. Callback/submit consumes exact matching state — reject missing/mismatch/expired/replay; session cookie remains Strict. |
| **Threat blocked** | Login CSRF / account-binding confusion: an attacker delivers their own valid provider callback/login payload through the victim's browser and binds the victim session to the attacker's account. Provider signature/token validity alone does not prove browser intent. |
| **Test (concrete)** | (a) legitimate Google cross-site GET with matching Lax binding/state+PKCE+nonce succeeds despite non-same-origin headers; (b) missing/wrong binding, state replay/expiry, provider mix-up or PKCE downgrade rejects with no session; (c) same-origin email login still requires Strict state+Origin; (d) email link GET/link scanner is non-mutating and wrong-browser verify cannot consume. |
| **Canonical/schema ref** | Live same-origin transport: `auth_login_state` + issue/consume functions in `0012_auth_functions.sql`, `packages/db/src/auth.ts`, `apps/web/lib/login-state.ts`, and Telegram state/callback routes. Provider-port correction: `feature_web_auth_onboarding_tech.md` §4 + B0 probe §4.1/§8.4. `sameOriginRequest()` remains mandatory for same-origin form/link POSTs but is deliberately **not** an OAuth-callback gate. |
| **Exact column + layer** | **EXISTING:** `auth_login_state(state_hash,expires_at,consumed_at)` + Strict browser state for Telegram today/email form target. **NEW in provider slice:** protected `auth_oauth_transactions` + provider-specific Lax binding for Google/Facebook. Email verify/reset use non-mutating GET → same-origin POST; session cookie stays Strict. |

### SI-2 — Keyed lookup hash for web-auth `account_identities.platform_user_hash` · **LIVE Telegram-era + re-target Google/email**

| | |
|---|---|
| **Invariant** | The value written to and looked up against `account_identities.platform_user_hash` must be a domain/provider-separated keyed HMAC (server-side secret/pepper) over the stable provider subject. Live Telegram uses `telegram:<id>`; the provider port must use `google.sub` for Google and normalized email for email identity, never a bare unkeyed hash. |
| **Threat blocked** | Offline brute-force / confirmation of which subjects have Plexco accounts if `account_identities` (or a backup/replica) is ever exposed. **DD-37 note:** the original round-09 finding was Telegram-specific (sequential, enumerable, low-entropy integer IDs → `sha256("telegram:" + id)` reversible over a tiny search space). With Telegram dropped that specific finding is **moot**; Google `sub` is higher-entropy, but a bare hash of a known subject is still a lookup/confirmation oracle under exposure, so the keyed HMAC is **retained** for consistency and defense-in-depth. |
| **Test (live + carry-over)** | Live `apps/web/lib/telegram-login.test.ts` proves deterministic keyed output, inequality to bare SHA-256, write/read parity and key rotation sensitivity. Google/email adapter tests must repeat the same four properties with exact provider-domain separation and production secret resolver. |
| **Canonical/schema ref** | Live helper: `apps/web/lib/telegram-login.ts::telegramUserLookupHash()` → shared `keyedHash()`/`resolveAuthSecretKey()` in `apps/web/lib/auth-secrets.ts`; KMS behavior has its own tests. Google/email adapters do not exist yet and must reuse this key boundary rather than create a provider-specific secret path. |
| **Exact column + layer** | `account_identities.platform_user_hash` (`schema.ts:129`; migration `0001_global_directory.sql:112`) — **web-auth layer**. Explicitly **not** `channel_identities.platform_user_lookup_hash` (`schema.ts:60`; migration `0001_global_directory.sql:44`) — see §1. |

### SI-3 — Explicit tenant-filter policy for tenant-scoped auth/onboarding reads · **LIVE on main — retain policy**

| | |
|---|---|
| **Invariant** | Every tenant-scoped read added under the auth/onboarding surface combines (a) `withTenant(db, tenantId, …)` (sets the `app.tenant_id` RLS GUC) **and** (b) an explicit `WHERE tenant_id = $tenantId` predicate inside the query itself. Neither alone is the policy — RLS is the fail-closed backstop; the explicit predicate is what protects a privileged/misrouted connection (e.g. `app_worker`/superuser reused incorrectly) that bypasses RLS outright. |
| **Threat blocked** | A privileged or misrouted connection silently falling back to the globally-latest row across all tenants instead of erroring — e.g. tenant A's host seeing tenant B's onboarding/readiness data. |
| **Test (live)** | `packages/db/src/auth.test.ts` — suite `onboardingSnapshot (tenant scoping — DD-31 SI-3)`, case “returns the caller's OWN run even under a superuser connection that bypasses RLS”: proves explicit predicate returns tenant A rather than tenant B's later row. |
| **Canonical/schema ref** | `packages/db/src/auth.ts::onboardingSnapshot()` is live and combines `withTenant(db, tenantId, …)` with `WHERE onboarding_runs.tenant_id = tenantId`. Keep this as policy + review checklist for every new tenant-scoped auth/onboarding query. |
| **Exact column + layer** | `onboarding_runs.tenant_id` / `onboarding_steps.run_id` (TENANT + RLS plane; migration `0008_notifications_onboarding.sql:56-71` + `0009_rls_policies_grants.sql`). |

### SI-4 — Logout fail-closed · **LIVE on main — retain behavior**

| | |
|---|---|
| **Invariant** | `POST /api/auth/logout` clears the session cookie only after successfully resolving and revoking a real server-side session. A request with no ambient cookie, or whose cookie matches no live session, leaves client cookie state untouched. |
| **Threat blocked** | Logout CSRF — a cross-site form POST forcing the victim's browser to drop a real session cookie via `Set-Cookie`, even though no session was ever touched server-side. |
| **Test (live)** | `apps/web/app/api/auth/logout/route.test.ts` covers “logout CSRF: a cross-site POST with no ambient cookie revokes and clears nothing” and “a stale/forged cookie matching no live session is left in place, not cleared”. |
| **Canonical/schema ref** | Round-06 (`HALT-MAX_ROUNDS.txt`, `regions.log:6`). |
| **Exact column + layer** | `web_sessions.revoked_at` (GLOBAL protected plane, `schema.ts:121`; migration `0001_global_directory.sql:104`) via `auth_revoke_web_session()` (migration `0012_auth_functions.sql:149-160`). |

### SI-5 — Shared, advisory-lock-serialized rate limiter · **LIVE on main — extend buckets in provider port**

| | |
|---|---|
| **Invariant** | Login attempts are capped 10/min/IP through one shared Postgres-backed counter (`rate_limit_hits` + `rate_limit_check()`), with same-bucket admission serialized by `pg_advisory_xact_lock` so a concurrent burst cannot all pass before any peer commits; replicas/restarts cannot multiply or reset buckets. |
| **Threat blocked** | Brute-force / DoS amplification against the login endpoint via horizontal scaling — N web replicas each holding an in-memory counter would multiply the effective limit by N. |
| **Test (live + carry-over)** | `packages/db/src/auth.test.ts` suite `rate_limit_check (shared store)` covers limit refusal, exact concurrent admission, app-role denial and retention. Google/email port must reuse this primitive and add the approved trusted-IP + normalized-email-HMAC bucket matrix from the B0 probe. |
| **Canonical/schema ref** | `docs/standards/business-rules.md:126` (BL-SEC-5 registry — `POST /auth/*` → 10/min → IP → 429 `RATE_LIMITED`); round-04/05 (`regions.log:2-5`). |
| **Exact column + layer** | `rate_limit_hits` (GLOBAL/infra plane, UNLOGGED; migration `0012_auth_functions.sql:258-263`) via `rate_limit_check()` (same file, `L266-295`). |

### SI-6 — Creation-race idempotency · **LIVE Telegram-era + re-test Google/email collision matrix**

| | |
|---|---|
| **Invariant** | Concurrent identical requests never create duplicate rows: (a) two concurrent FIRST logins for the same verified provider subject converge on ONE account/person; (b) two concurrent `tenant_provision` calls for the same slug by the SAME owner both resolve to the SAME tenant, while a DIFFERENT actor re-submitting an existing slug gets `SLUG_TAKEN` rather than silently joining or taking it over. |
| **Threat blocked** | Duplicate persons/accounts/tenants from double-submits or multi-tab races (data integrity), and slug-squatting/tenant-takeover by a non-owner. |
| **Test (live + carry-over)** | `packages/db/src/auth.test.ts` covers concurrent first Telegram logins converging to one identity/account, idempotent same-owner tenant re-submit, same-owner concurrency and `SLUG_TAKEN` for another actor/member. Google/email port must add the B0 collision table, including stable-subject login with unowned/pending email and fail-closed verified-email ownership conflict. |
| **Canonical/schema ref** | Live identity/tenant functions are in `0012_auth_functions.sql` + `packages/db/src/auth.ts`; target collision authority is `../../probes/b0-auth-credential-lifecycle-design-probe.md` §4 and `../feature_web_auth_onboarding_tech.md`. |
| **Exact column + layer** | `account_identities` `UNIQUE(platform, platform_user_hash)` (web-auth/GLOBAL, `schema.ts:132`) via `auth_login_telegram()` (migration `0012_auth_functions.sql:28-82`); `tenants.slug` `UNIQUE` (TENANT root, `schema.ts:155`) via `tenant_provision()` (same file, `L169-233`). |

### SI-7 — Session rotation on every privilege transition · **LIVE on main — provider port must reuse choke-point**

| | |
|---|---|
| **Invariant** | Login (fresh, and over-a-live-cookie) and tenant provisioning (owner grant) rotate the session token through the single `issueSession()` choke-point, binding the NEW session to the JUST-authenticated/JUST-privileged account. No route hand-rolls session issuance. |
| **Threat blocked** | Session fixation (attacker pre-seeds a token, victim logs in, attacker's pre-known token becomes privileged) and account-confusion (logging in as account B over account A's live cookie must never leave a cookie that still authenticates as A). |
| **Test (live + carry-over)** | `packages/db/src/auth.test.ts` case “rotation revokes the old token and links the new session (fixation defense)” includes cross-account rebinding and dead-token fail-closed behavior. Each Google/email login and privilege transition must route through the same `issueSession()`/rotation boundary and repeat these tests. |
| **Canonical/schema ref** | `../feature_web_auth_onboarding.md` Bất biến L19 + edge case #12 L69; BE tech spec `L21` + `L144` (rotation triggers) + Testing Plan #5 `L167` (session-fixation test); `prescan.md:58-67` (privilege-transition rotation table). |
| **Exact column + layer** | `web_sessions.rotated_from` (GLOBAL protected plane, `schema.ts:120`; migration `0001_global_directory.sql:103`) via `auth_rotate_web_session()` (migration `0012_auth_functions.sql:121-147`) and `issueSession()` (`apps/web/lib/session-cookies.ts:61-87`). |

### SI-8 — `onboarding_steps` recency dedupe · **LIVE on main via migration 0013 — verify and retain**

| | |
|---|---|
| **Invariant** | Retries legitimately leave multiple rows per `(run_id, step)` (unique on `run_id, step, idempotency_key`). Any read of step status selects the MOST RECENT row per step by authoritative monotonic sequence (`DISTINCT ON (step) … ORDER BY step, seq DESC`), never by `created_at` alone or an arbitrary row; timestamps can tie. |
| **Threat blocked** | A stale `error`/`not_configured` row from an earlier failed attempt shadowing a later `verified` row (or vice versa) in the readiness checklist — host sees the wrong onboarding status. |
| **Test (live)** | `packages/db/src/auth.test.ts:430-487`: latest retry wins and an exact `created_at` tie is deterministically broken by higher `seq`; app-role default sequence grant is covered immediately after. |
| **Canonical/schema ref** | `0013_onboarding_steps_recency.sql` explains why `created_at` is audit-only and adds/grants `seq`; `packages/db/src/auth.ts::onboardingSnapshot()` orders by `s.seq DESC`. |
| **Exact column + layer** | `onboarding_steps.seq bigserial` is the TENANT+RLS recency owner; `created_at` remains human-readable audit only. Read path: `packages/db/src/auth.ts` latest-steps CTE. |

---

## 3. Gaps to pin (DD-31) — 📜 PHỤ LỤC LỊCH SỬ (pre-merge; xem §0)

> ⚠️ **Cập nhật 2026-07-10 — mô tả "chưa có code" dưới đây đã LỖI THỜI (post-merge).** `auth-onboarding-v3` **đã merge vào `main@1eb6f60`**: v3 auth code + migrations `0012/0013` + **KMS pepper client** (git `37296ef fix(auth): require AWS_REGION for the KMS pepper client`) + `SECURITY DEFINER search_path` fix (`3ce516f`) + tests đều đã có trên `main`. Do đó các câu "no code reads KMS / no helper in packages/ (zero hits)" và "round-07 fix chỉ trên v2 chưa merge" là **trạng thái trước merge** — giữ làm lịch sử. **Việc còn lại thực sự OPEN = thay provider Telegram Login → Google/email** (DD-37/DD-13); dùng bảng này để **audit SI-1..SI-8 trên code đã merge** rồi **carry sang adapter Google/email**. 4 mục đánh số bên dưới giữ để tra cứu, đọc theo lăng kính "verify-on-main + re-target Google/email", KHÔNG phải "build greenfield".

Founder DECISIONS on all four gaps are RESOLVED (OQ-1/2/3, §5, 2026-07-06). Nội dung gốc (pre-merge) — mỗi mục nay là **verify-on-main + carry sang Google/email**:

1. **Pre-auth login-CSRF browser-bound state** → SI-1. Telegram-era `auth_login_state` remains the same-origin continuity primitive (Telegram live; email form target); Google/Facebook port adds `auth_oauth_transactions` + Lax callback binding, while email verify/reset uses non-mutating GET → same-origin POST. Do not route OAuth callbacks through `sameOriginRequest()`.
2. **Explicit tenant-filter policy** → SI-3. `onboardingSnapshot()` now implements `withTenant` + explicit `tenant_id` predicate on main and has an RLS-bypass regression test. Retain it as a written policy/review checklist for every future query on this surface.
3. **KMS/secret source wiring** → blocks SI-2 (and, if SI-1 signs its state token rather than just storing it row-side, SI-1 too). No dedicated SI row — cross-cutting. **Historical pre-merge evidence:** env conventions existed but no package consumed them at that snapshot. **Resolved 2026-07-06 (OQ-2, §5): AWS KMS** for staging/prod; runtime gets references/secrets through the provider-neutral encrypted-env boundary in `environments-setup.md`, and local dev keeps `ENCRYPTION_KEY`. The merged v3 helper is the shared source for auth-surface key material; the Google/email port must reuse it rather than create a provider-specific key path.
4. **Keying for web-auth `account_identities.platform_user_hash`** → SI-2. Keyed HMAC + shared KMS/dev secret source are live for the Telegram-era baseline; Google/email/Facebook adapters must reuse the same boundary with provider-domain separation.

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
