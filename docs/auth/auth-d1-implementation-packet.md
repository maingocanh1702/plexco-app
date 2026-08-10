# 🔐 Auth D1 Implementation Packet — `auth-s4-d1-google-adapter` (docs-only, traceability)

> **Status:** traceability / preparation record. It emits **no** `REVIEW_VERDICT` (no PLAN_READY /
> CODE_READY assertion) and authorizes no code — P0 auth code stays a founder-attended manual workflow.
> It is intentionally **not** a `review:check`-tracked verdict document (`pnpm review:check` passes and
> correctly treats it as a non-verdict doc — no `review/readiness/plan` filename, no `REVIEW_VERDICT`
> block); the DD-38/39 code-readiness verdict, when authored, will be a separate validator-tracked
> `*-readiness.md`. §C below is an evidence inventory (evidence present/absent), not a readiness assessment.
> **Base:** `main@399c5eb310e59352eaae0abdc594ab60f9146081` — the commit this packet's branch is based on
> (this worktree's HEAD = that base + this one packet commit; `main` == `origin/main` at authoring). Read
> on 2026-07-23; every citation below was resolved on disk against that base.
> **Framework:** `autopilot-prompt-GENERIC` v0.6.0.
> **Authority:** DD-80 (`standards/decisions.md` v1.88 — G3 concurrency closure) ·
> `b0-auth-credential-lifecycle-design-probe.md` amendment v1.88 + v1.86 AAD-handoff ·
> `features/BE/feature_web_auth_onboarding_tech.md` header v2.10 / changelog v2.11 (acceptance D1-1..15) ·
> `slice-readiness-verdicts.md` v2.0 (D0a/D0b merged — Verdict 6; d1b Verdicts 11–13).

> **⚠️ AS-BUILT REFRAMING (read first).** This packet was originally scoped as a *pre-implementation*
> draft "so the founder's attended P0 session can implement D1 with zero design decisions left." Since it
> was authored, **D1 (`0017_oauth_transactions.sql`) and the d1b completion hop
> (`0018_oauth_completion_handoff.sql`) have MERGED to `main`** (tech changelog v2.11,
> `feature_web_auth_onboarding_tech.md:625`). The packet therefore now **describes code that exists**. Per
> the run directive, every file path, symbol, route, DDL element, and test below is verified against the
> live tree at the base above — the earlier design plan is **not** transcribed where it diverges from
> as-built. Any claim not resolvable on disk is dropped or marked UNRESOLVED, never carried over. B1/B2/B3
> are the **as-built** D1 surface with design-authority provenance; §C lists the **DD-39 gender/pricing**
> surface (pinned in specs, not yet built) with no readiness verdict — the **DD-38 chat** half is split out
> to root slice `dd38-dd86-chat-schema-core` (pointer + backlog anchor).

> **HOLD condition — SATISFIED.** Both D0 merged probes exist on this base:
> `packages/db/migrations/0015_auth_revoke_account.sql:286` defines `auth_revoke_all_web_sessions`, and
> `apps/web/app/api/auth/logout-all/route.ts:2,57` imports/calls `revokeAllWebSessions`.

---

## B. D1 — `auth-s4-d1-google-adapter`

> **Dependency note (as-built).** DD-80 §10 slice order is **D0 revoke-core → D1 email-token-core (dark)
> → D1 Google adapter → D1 email bundle → Telegram removal** (`b0-…-probe.md:553` order-3 row;
> `decisions.md:96`). As-built on `main` at this base, the chain up to and including D1-google is
> **merged**:
>
> | Order | Slice | Migration | Status on `main@399c5eb` |
> | ----- | ----- | --------- | ------------------------ |
> | 1 | D0a session-account revoke core | `0015_auth_revoke_account.sql` | merged (`slice-readiness-verdicts.md:8`, owner override) |
> | 1 | D0b session-web boundary | (no DB change) `logout-all` route + issuance fence | merged, gate MET (`slice-readiness-verdicts.md:9`, Verdict 6) |
> | 2 | D1 email-token-core (dark) | `0016_account_email_token_core.sql` | merged (code dark; `decisions.md:1147` v1.78) |
> | 3 | **D1 Google-OIDC adapter (this packet)** | `0017_oauth_transactions.sql` | **merged** (tech v2.11, `…tech.md:625`) |
> | 3+ | d1b OAuth session-rotation completion hop | `0018_oauth_completion_handoff.sql` | **merged** (Verdict 12; enablement blocker for D1-google — see §B2.5) |
>
> The §4 collision cells D1-6/D1-7/D1-9 read/write `account_emails` + `auth_pending_email_registrations`
> + `auth_email_tokens` — tables owned by order-2 `email-token-core` (migration `0016`); that dependency
> is merged, so the cross-slice read is live. **Migration numbering:** the live tail on `main` is `0018`
> (`git ls-tree main packages/db/migrations/` = `0000…0018`); `0017` is monotonic after `0016`. The
> earlier draft's "tail = 0014" note is stale — verified against disk, not carried over.

### B1. As-built DDL — `packages/db/migrations/0017_oauth_transactions.sql`

Provenance: `b0-…-probe.md` §4.1 (`:243-267`) + `feature_web_auth_onboarding_tech.md` §2. The two sources
are DDL-identical and already carry defect-fix **v1.78** (`terminal_at` + two lifecycle CHECKs following
the `auth_email_deliveries` pattern, replacing the self-contradictory permanent-NOT-NULL CHECK). As-built
matches that contract. Full text (478 lines) lives in the migration; the load-bearing objects are
reproduced verbatim below with `0017:<line>` anchors.

**B1.1 — table + lifecycle CHECKs (`0017:68-94`).** `state_hash` PK; `provider` CHECK admits
`google|facebook` (Facebook row-shape future-proofed, no Facebook code — DD-33); the **raw** browser
binding lives only in the path-scoped Lax cookie, while its SHA-256 `browser_binding_hash` is the value
stored in the row (`0017:56-60,71`; `oauth-transaction.ts:46-49` hashes both state and binding at rest, so
a stolen authorization response without the cookie cannot be replayed). Google carries `nonce_hash` +
`pkce_verifier_enc bytea` (canonical `*_enc`, S256 only) + `kms_key_version text`.

```sql
CREATE TABLE auth_oauth_transactions (
  state_hash           text PRIMARY KEY,
  provider             text NOT NULL CHECK (provider IN ('google','facebook')),
  browser_binding_hash text NOT NULL,
  nonce_hash           text,
  pkce_verifier_enc    bytea,           -- canonical *_enc bytea; Google S256 only
  kms_key_version      text,            -- opaque KMS key/version metadata (text, not an envelope)
  expires_at           timestamptz NOT NULL,
  consumed_at          timestamptz,
  terminal_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_oauth_transactions_consumed_terminal_chk
    CHECK (consumed_at IS NULL OR terminal_at IS NOT NULL),
  CONSTRAINT auth_oauth_transactions_google_lifecycle_chk CHECK (
    provider <> 'google'
    OR (terminal_at IS NULL
        AND nonce_hash IS NOT NULL AND pkce_verifier_enc IS NOT NULL AND kms_key_version IS NOT NULL)
    OR (terminal_at IS NOT NULL
        AND pkce_verifier_enc IS NULL AND kms_key_version IS NULL)
  )
);
```

Matches B0 §4.1 DDL (`b0-…-probe.md:243-262`) verbatim including both CHECKs (`consumed ⇒ terminal`; the
three mutually-exhaustive Google branches). Drizzle mirror: `packages/db/schema.ts:417-465`
(`authOauthTransactions`) reproduces the columns, provider CHECK, both lifecycle CHECKs, and both partial
indexes (and, from `0018`, the four handoff columns + two handoff CHECKs + unique handoff index).

**B1.2 — partial sweep indexes (`0017:100-103`).** Two partial indexes match the two sweep predicates
exactly so neither the terminalize UPDATE nor the retention DELETE full-scans (codex round-02 [P2]):

```sql
CREATE INDEX auth_oauth_transactions_expiry_idx
  ON auth_oauth_transactions(expires_at) WHERE terminal_at IS NULL;
CREATE INDEX auth_oauth_transactions_terminal_idx
  ON auth_oauth_transactions(terminal_at) WHERE terminal_at IS NOT NULL;
```

**B1.3 — sweep-at-traffic owner `_auth_oauth_transaction_sweep()` (`0017:120-148`).** This is the single
cleanup owner mandated by B0 §4.1 v1.85 ("sweep-at-traffic trong chính narrow issue/claim functions",
`b0-…-probe.md:266`) and §3.2 item #6 (`b0-…-probe.md:198`). It is called from **both** `issue` and
`claim` so an expired flow is terminalized at its first post-expiry traffic regardless of endpoint (codex
round-03 [P2]). Both statements are bounded (`LIMIT 1000` + `FOR UPDATE SKIP LOCKED`) and index-driven;
terminalize expired-non-terminal rows (stamp `terminal_at`, NULL the PKCE ciphertext + key-version), then
retention-DELETE terminal rows older than 30 days. Internal, not granted (`REVOKE ALL … FROM PUBLIC`,
`0017:148`).

> **v1.85 cleanup semantics (transcribed).** "NULLed immediately" for expired-unconsumed = **at the first
> sweep after expiry** (`b0-…-probe.md:266`). The wall-clock backstop is the order-4 `auth-email-cleanup`
> pg-boss job which *extends* its sweep to `auth_oauth_transactions` when it lands (§3.2#6,
> `b0-…-probe.md:198`); there is **no** separate scheduled oauth sweep. The order-3→order-4 window is
> owner-accepted with mitigations (zero runtime grant + claim fail-closed + KMS encryption); the
> consumed path NULLs in the same transaction regardless.

**B1.4 — `auth_oauth_transaction_issue(text,text,text,text,bytea,text,interval)` (`0017:158-183`).**
Runs `_auth_oauth_transaction_sweep()` (`0017:172`) then a single INSERT; the trusted-IP `oauth-state`
bucket runs at the app boundary *before* this (§8.2, `b0-…-probe.md:497`). Granted to `app` (`0017:183`).

**B1.5 — `auth_oauth_transaction_claim(text,text,text)` single-use CAS (`0017:198-263`).** Returns
`(nonce_hash, pkce_verifier_enc, kms_key_version)` for the token exchange. Single-use is a DB
compare-and-set: the row is locked `FOR UPDATE` with `consumed_at IS NULL AND expires_at >
clock_timestamp()` (`0017:233-241`), then a conditional `UPDATE … SET consumed_at =
transaction_timestamp() … WHERE state_hash = p_state_hash AND consumed_at IS NULL` (`0017:246-251`);
missing / provider-or-binding mismatch / already-consumed (replay) all `RETURN` zero rows with **no row
mutation** (D1-3, D1-4). The **already-expired** case (the transaction begins after `expires_at`) also
returns zero rows but is **not** side-effect-free: the function runs the shared sweep (`0017:218`) and a
targeted `UPDATE … WHERE expires_at < now()` (`0017:225-229`) that terminalizes the row and NULLs the PKCE
ciphertext + key-version. **As-built boundary nuance:** both cleanup statements test the transaction-frozen
`now()`, while the capture SELECT tests `clock_timestamp()` (`0017:240`). So a flow that is still live at
transaction start but crosses `expires_at` *during* the lock wait is **rejected** by the SELECT yet
**skipped** by the `now()`-based cleanup — its PKCE ciphertext is **not cleared on this callback**. The row
stays expired-non-terminal, so the *next* OAuth `issue`/`claim` on any flow drives `_auth_oauth_transaction_
sweep` and terminalizes it — but that sweep is **traffic-driven**, and the order-4 `auth-email-cleanup` job
that would otherwise sweep it on a schedule has **not landed on this base**, so with no subsequent OAuth
traffic the ciphertext can persist **indefinitely** (a real, if narrow, retention gap — not bounded). Two
concurrent claims serialize on the row lock; the loser re-reads a consumed row and gets zero rows
(`0017:194-196` comment).
Granted to `app` (`0017:263`).

> **`clock_timestamp()` vs `now()`.** Post-lock expiry re-checks use `clock_timestamp()` because `now()`
> is frozen at transaction start and does not advance across a lock wait (`0017:45-46`, 0015/0016
> precedent).

### B2. Google adapter outline (as-built app boundary)

The privileged logic lives only in the `0017` SECURITY DEFINER functions; the app-side ports are thin
`pool.query` wrappers deliberately placed in `apps/web/lib/oauth-transaction.ts` rather than
`packages/db/src/index.ts` because D1 order-3 scope excludes `packages/db/src/index.ts`
(`oauth-transaction.ts:12-18`). (The d1b handoff wrappers `armOauthCompletionHandoff` /
`consumeOauthCompletionHandoff` *are* exported from `@plexco/db` — `packages/db/src/index.ts:22,24` — as
that is d1b scope, not D1 order-3.)

**B2.1 — OIDC proof matrix (`apps/web/lib/google-oidc.ts`).** `verifyGoogleIdToken` (`google-oidc.ts:55-127`)
accepts an identity only when EVERY cell passes; provenance B0 §2 (`b0-…-probe.md:53`) + tech §4 proof
matrix (`…tech.md:303`):

| Cell | Proof | As-built |
| ---- | ----- | -------- |
| signature / JWKS rotation | provider signature against rotating JWKS | `jwtVerify` + `createRemoteJWKSet` (`google-oidc.ts:42-44,66-72`) |
| `iss` | exact configured issuer | `issuer: [...GOOGLE_ISSUERS]` (`google-oidc.ts:19,67`) |
| `aud` | exact configured client-id | `audience: input.clientId` (`google-oidc.ts:68`) |
| `azp` | required when multi-aud; must equal client-id when present | `google-oidc.ts:94-100` (codex round-02 [P2]) |
| `exp`/`iat` freshness | present + fresh; future-`iat` rejected | `requiredClaims:["exp","iat"]` + `maxTokenAge` (`google-oidc.ts:70-71`) + explicit future-side gate (`:85-87`) |
| `sub` | stable non-empty subject | `google-oidc.ts:112-114` |
| `nonce` | `sha256(nonce)` equals stored `nonce_hash` | `google-oidc.ts:104-109` (raw nonce never persisted) |
| `email_verified` | strict boolean `=== true` + present email | `google-oidc.ts:118-124` (DD-50 — a string `"true"` is not proof) |

Every failure collapses to a generic reason. At runtime `AUTH_STALE` marks a **stale** token — an expired
`exp` **or** an `iat` older than `maxTokenAge` (10 m) while `exp` is still valid; jose surfaces both as
`ERR_JWT_EXPIRED`, which maps to `AUTH_STALE` (`google-oidc.ts:78`; `google-oidc.test.ts:168` asserts the
too-old-`iat`/valid-`exp` case → `AUTH_STALE`). A **future**-dated token — future `nbf`, or the explicit
future-`iat` gate (`:85-87`) — maps to `AUTH_INVALID`, as does every other failing cell
(`google-oidc.ts:36-38,78`). The callback never signals which cell failed. The
redirect builder `buildGoogleAuthorizeUrl` (`google-oidc.ts:136-154`) sends `scope=openid email`,
`code_challenge_method=S256`, `prompt=select_account`; `exchangeGoogleCode` (`google-oidc.ts:162-194`) is
a bounded (10 s, `:25,186`) server-to-server exchange that returns `null` (→ generic reject) on any
non-200/missing-token and never logs the code/verifier/token.

**B2.2 — §4 collision table, 8 cells.** Verbatim from B0 §4 (`b0-…-probe.md:226-233`); as-built in
`auth_login_google` (`0017:292-478`). Cells 1-7 run in the DB function; cell 8 (any proof-matrix failure)
rejects **before the finalizer** (`auth_login_google` is never called) so it makes zero account/session/
audit mutation — but by then `claimOauthTransaction` has already consumed/terminalized the oauth row (a DB
write), so it is **pre-finalizer, not pre-DB** (see the cell-8 row); no audit row is written.

| Cell | Google subject | Verified email owner | Outcome (B0 §4) | As-built site |
| ---- | -------------- | -------------------- | --------------- | ------------- |
| 1 | none | none | Create Person + Account + verified `account_emails` + Google identity atomically (`b0:226`) | `0017:401-414` (uses preallocated id — B2.3) |
| 2 | none | account A | Attach Google identity to A; DD-50 strong proof, no 2nd account (`b0:227`) | `0017:415-426` (`ON CONFLICT DO NOTHING`) |
| 3 | none | pending A | Promote email for A; supersede ALL pending attempts + verify tokens, NULL password/key candidates, copy none; attach identity (anti pre-registration hijack) (`b0:228`) | `0017:427-456` |
| 4 | account A | email also A | Idempotent login; no silent name/email overwrite (`b0:229`) | `0017:391-398` (login_success) |
| 5 | account A | none | Login A by stable subject; no auto create/promote of `account_emails` (`b0:230`) | `0017:391-398` |
| 6 | account A | pending B | Login A by stable subject; do not attach/mutate/supersede B's attempts/tokens (`b0:231`) | `0017:391-398` |
| 7 | account A | email @ B | `AUTH_IDENTITY_CONFLICT`; no auto-merge, no session (→ DD-53) (`b0:232`) | `0017:384-390` (`identity_conflict`) |
| 8 | any | `email_verified` false/missing or other proof-cell fail | Generic reject; zero account/session mutation (`b0:233`) | `callback/route.ts:159` (`if (!proof.ok) return fail(...)`) — no `auth_login_google` call → zero account/session/audit. **As-built precision:** the oauth txn was already single-use claimed upstream at `:121` (a DB write), so the reject is **pre-finalizer** (before `auth_login_google`), not pre-DB; B0's "zero account/session mutation" still holds |

Lock hierarchy is the canonical B0 §5.2 (`b0-…-probe.md:341-346`), parent-first, without the DD-70 fence
(order-3 emits no global item): read-only resolve both owners (`0017:322-332`) → two domain-separated
advisory locks, email then subject, fixed order (`0017:351-352`; the subject lock closes the codex
round-01 [P1] same-subject/different-email race) → lock involved `accounts` in ascending UUID order, then
`account_emails` (`0017:358-364`) → re-resolve under the locks (`0017:368-376`) → apply the cell.

**B2.3 — v1.86 signature with preallocated `account_emails.id`.** Signature (`0017:292-300`):

```sql
auth_login_google(
  p_subject_hash text, p_email_lookup_hash text, p_email_enc bytea, p_kms_key_version text,
  p_account_email_id uuid, p_display_name text, p_request_ref text
) RETURNS TABLE (account_id uuid, person_id uuid, outcome text)
```

Per B0 §3.3 AAD contract (`b0-…-probe.md:205`) and the §4 intro AAD-handoff paragraph
(`b0-…-probe.md:222`): for the cell-1 create, the app **preallocates** `account_emails.id` (a UUID)
*before* encrypting, binds the `email_enc` AAD to that id, and passes the exact id in as
`p_account_email_id`; the cell-1 INSERT uses that id verbatim (`0017:408-409`
`INSERT INTO account_emails(id, …) VALUES (p_account_email_id, …)`), so no path ever encrypts with an id
chosen inside the DB. Cells 2/3/5/6 use existing rows and existing ciphertext — no rebind, and
`p_account_email_id` is not consulted for them (`b0-…-probe.md:222`; `0017:280-283` comment). App side:
`callback/route.ts:166` `const accountEmailId = randomUUID()` → passed to `deriveEmailArtifacts(…,
accountEmailId, …)` (`:169`) → `loginGoogle({… accountEmailId …})` (`:189`).

**B2.4 — per-lane audit comment (v1.85).** In the same transaction as the cell mutation/reject,
`auth_login_google` writes one `auth_audit_events` row (`0017:463-469`): `event_type = v_outcome`
(`login_success` for cells 1-6, `identity_conflict` for cell 7), `outcome_class` `success|conflict`,
`actor_class = 'google'`, `request_ref = p_request_ref`; `session_epoch`/`link_codes_revoked`/
`merge_artifacts_cancelled` stay NULL (no session revoke / link-code work on this lane). This is B0 §8.3
v1.85 (`b0-…-probe.md:508`): cell 8 rejects pre-finalizer so it writes **no** `login_failed`. B0's stated
rationale for that deferral is "trusted-IP bucket + generic reject + HTTP log". **As-built caveat:** on a
proof-matrix failure the callback returns without calling any logger, and the rate-limit record does not
capture the proof outcome — so the "HTTP log" is B0's *design rationale*, not a verified as-built telemetry
owner (an observability gap, recorded not overstated). `login_failed` remains an email-lane-only outcome.

**B2.5 — route skeletons.** The §3 endpoints table (`…tech.md:200-201`) registers exactly two D1
order-3 routes; `/complete` is a d1b artifact (see the enablement note below).

- **`GET /api/auth/google/state`** (`apps/web/app/api/auth/google/state/route.ts:31-100`). Order:
  `oauth-state:<ip>` bucket 10/min, shared Google+Facebook, fail-closed to 429 on limiter/storage outage
  and creating neither row nor cookie (D1-1; `state/route.ts:37-49`, codex round-06 [P2]) → full-config
  gate (client id + secret + base url) → 503 `AUTH_UNAVAILABLE` (`:55-64`, codex round-03 [P2]) →
  generate state + browser binding + nonce + S256 PKCE (`:66-68`) → encrypt the verifier at rest (`:70-77`)
  → `issueOauthTransaction` (`:79-87`) → set the provider-scoped `SameSite=Lax` binding cookie at the
  exact callback path (`:89`) → 302 to Google (`:91-99`).
- **`GET /api/auth/google/callback`** (`apps/web/app/api/auth/google/callback/route.ts:49-217`). It is
  **not** same-origin, so it deliberately does not call `sameOriginRequest()` and does not require
  Origin/Referer (D1-13; `:30-33`). Order: independent `oauth-callback:<ip>` bucket 10/min (D1-11;
  `:71-79`) → config gate (`:84-92`) → query-state == cookie-state, both present (D1-4; `:109-111`; the
  cookie is preserved on mismatch, codex round-03 [P2]) → single-use `claimOauthTransaction` (D1-3;
  `:121-128`) → decrypt PKCE verifier (`:130-141`) → `exchangeGoogleCode` (`:144-151`) → full proof matrix,
  cell 8 pre-finalizer reject with no audit (D1-5; `:154-159`) → derive keyed subject + email artifacts with a
  **preallocated** `accountEmailId` (`:163-181`) → `loginGoogle` §4 finalizer (`:184-192`).
  `identity_conflict` → `AUTH_IDENTITY_CONFLICT`, no session, no handoff (D1-8; `:194-196`). Every response
  is `Referrer-Policy: no-referrer` and loads nothing third-party; code/state/nonce/verifier/handoff are
  never logged.

> **B2.6 — enablement gate / d1b completion hop (owner-accepted Option A, 2026-07-22).** As-built, the
> cross-site callback does **not** mint the session: `SameSite=Strict plx_session` is not sent on the
> cross-site OAuth callback, so it cannot read/rotate a pre-existing session there (tech §4 enablement
> gate, `…tech.md:299`). On `login_success` the callback **arms** a single-use, short-TTL server-side
> handoff on the same oauth row (`callback/route.ts:205-214`, `armOauthCompletionHandoff` → `0018` arm
> `auth_oauth_handoff_arm`) and returns a first-party M3 landing that auto-submits a same-origin POST to
> **`POST /api/auth/google/complete`** (`apps/web/app/api/auth/google/complete/route.ts:30-88`), where the
> Strict cookie IS present and the existing `issueSession()` takes its existing rotate branch
> (`auth_rotate_web_session`, `0015` — reused, no new primitive). `/complete` order: config gate 503
> (D1B-10) → `sameOriginRequest()` (D1B-7) → read handoff from the POST body → single-use durable-fence
> `consumeOauthCompletionHandoff` (`0018` consume `auth_oauth_handoff_consume`; replay/expiry → null →
> D1B-5/D1B-6) → `issueSession(account)` rotate-or-create with the issuance fence mapping a lost
> logout-all race to a generic reject (D1B-8). This slice (`auth-s4-d1b-oauth-session-rotation`,
> `0018_oauth_completion_handoff.sql`) is a **BLOCKER on enabling Google login**: it MUST land before
> `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` are set in any environment (`…tech.md:299`). Its
> **code** is merged on this base (0018; Verdict 13, `slice-readiness-verdicts.md:600`), but the merge alone
> does **not** close the enablement gate: Verdict 12 (`slice-readiness-verdicts.md:557-591`) keeps
> `safari-macos-and-ios-strict-hop-evidence` as `ENABLEMENT_ONLY` — shipped Safari + iOS Safari were not
> measured (Playwright's frozen WebKit ≠ shipped Safari), and if shipped Safari withholds the Strict cookie
> on the M3 hop those users silently keep the residual risk. NEXT_REVIEW_TRIGGER (`:591`): **d1b merged AND
> Safari/iOS cells measured → only then may the credentials be set in any environment.**

**B2.7 — negative scope (binding, from `0017:25-38` + manifest).** No Facebook adapter (row-shape only,
DD-33 owns its slice); no email register/verify/login/forgot/reset functions (order-4 bundle); no
email-change/rebind from Google claims (an existing Google subject is the stable owner); no auto-merge on
conflict (cell 7 fails closed to `identity_conflict`); no Telegram route/function removal; the table is
function-only (zero direct grant to `app`).

### B3. Test map — D1-1..D1-15 (as-built coverage)

Acceptance rows verbatim source: `feature_web_auth_onboarding_tech.md:459-473`. Every row maps to a real
on-disk test; DB-layer coverage is vitest against real PostgreSQL as the `app` role
(`packages/db/src/auth.test.ts`, migrations `0017`+`0018`) — there is no pgTAP harness.

| Row | Case (tech `B:line`) | Covering test(s) — `file:line` | Result |
| --- | -------------------- | ------------------------------ | ------ |
| D1-1 | State issue, bucket-before-mutation; 10 ok + 11th 429 no row/cookie (`B:459`) | `state/route.test.ts:48,77,88` (+503 config `:111,124`; >32-byte secret `:139`; store-outage→429 `:159`) | PASS |
| D1-2 | Callback happy path cell new/new; entities + session mint (`B:460`) | DB: `auth.test.ts:3265` (Person+Account+verified `account_emails`+identity). **Mint relocated to `/complete`** (see note) — `callback/route.test.ts:119` (arm) + `complete/route.test.ts:54` (issueSession rotate) | **PARTIAL** — entities/mint covered, but the AAD chain is NOT connected end-to-end (id-stored + AAD-binding proven separately — see the v1.86 note); track an end-to-end regression |
| D1-3 | State single-use; replay → generic reject, zero mutation (`B:461`) | DB `auth.test.ts:3724`; HTTP `callback/route.test.ts:223` | PASS |
| D1-4 | Binding cookie missing/wrong → reject, txn not claimed (`B:462`) | HTTP `callback/route.test.ts:199,211`; DB `auth.test.ts:3769` | PASS |
| D1-5 | Proof-matrix negatives per cell; generic reject, zero mutation (`B:463`) | Unit `google-oidc.test.ts:82-188` (iss/aud/azp/nonce/email_verified/exp/iat/sig; STALE vs INVALID); HTTP `callback/route.test.ts:235` (cell 8 pre-finalizer, no audit) | PASS |
| D1-6 | Collision email @ A → attach identity, no 2nd account (`B:464`) | DB `auth.test.ts:3330` | PASS |
| D1-7 | Collision pending @ A → promote, supersede all attempts+tokens, NULL candidates, no copy, attach (`B:465`) | DB `auth.test.ts:3359` | PASS |
| D1-8 | sub@A + email@B → `AUTH_IDENTITY_CONFLICT`, no merge, no session (`B:466`) | DB `auth.test.ts:3424`; HTTP `callback/route.test.ts:247` (no handoff armed) | PASS |
| D1-9 | sub@A + pending email@B → login A by subject, no mutate B (`B:467`) | DB `auth.test.ts:3467` | PASS |
| D1-10 | sub@A + new email → login A, no create/promote `account_emails` (`B:468`) | DB `auth.test.ts:3504` | PASS |
| D1-11 | Callback bucket independent of state bucket (`B:469`) | HTTP `callback/route.test.ts:258` (exhaust `oauth-state` → `oauth-callback` still 200) | **PARTIAL** — only the state→callback direction is asserted; the reverse ("and vice versa": exhaust callback → state still usable) is not tested |
| D1-12 | PKCE ciphertext: canonical `bytea` + separate key-version text (`B:470`) | DB `auth.test.ts:3787` (shape + CHECK + partial indexes) and `:3831` (`app` EXECUTE on the 3 functions, zero table grant) | PASS |
| D1-13 | No same-origin gate; cross-site GET works (`B:471`) | HTTP `callback/route.test.ts:164` (hostile Origin passes, no `sameOriginRequest()`). The Strict-cookie **attribute** is asserted by `issueSession`'s own tests (`session-cookies.test.ts:232` `sameSite:"strict"`; D1B-4 unchanged-attrs `:249-256`); `/complete` only invokes `issueSession` (`complete/route.test.ts:54`, mocked) | PASS (note) |
| D1-14 | Telegram regression — routes untouched (`B:472`) | HTTP `callback/route.test.ts:312` (`existsSync` both routes); Telegram DB suite intact (`auth.test.ts` `auth_login_telegram`) | PASS |
| D1-15 | Facebook negative scope — routes absent (`B:473`) | HTTP `callback/route.test.ts:321` (`existsSync=false`); `apps/web/app/api/auth/facebook` absent on disk | PASS |

**v1.85 per-lane audit assertion (D1-2/D1-8).** `auth.test.ts:3316-3327` asserts exactly one
`auth_audit_events` row for the login_success lane (`event_type:"login_success"`,
`outcome_class:"success"`, `actor_class:"google"`, matching `account_id`, epoch/counts NULL);
`auth.test.ts:3456-3464` asserts the single `identity_conflict` row (`outcome_class:"conflict"`,
`actor_class:"google"`).

**v1.86 preallocated-id assertion (D1-2).** `auth.test.ts:3268` mints `const preId = randomUUID()`,
passes it as `accountEmailId` (`:3277`), and `:3301` asserts the created `account_emails.id` equals
`preId`; the AAD-binds-that-id contract is separately proven by the `deriveEmailArtifacts` unit tests
(`auth.test.ts:3129` canonicalizes the UUID into the AAD; `:3094/:3110` a wrong-id AAD fails the GCM tag).
**Coverage is PARTIAL, not end-to-end:** the id-stored assertion (`:3301`) and the AAD-binding assertion
(`:3129`) are proven **separately** — no single test asserts the *same* UUID flows through encryption AND
`loginGoogle` AND is then decryptable from the stored ciphertext, so a regression using different UUIDs for
the two would leave both green. The chain (preallocated id → stored `account_emails.id` → same id in the
`email_enc` AAD) is inferred from the two halves, not asserted connected.

> **As-built note on D1-2 / D1-13 (session mint relocation).** The tech matrix rows D1-2/D1-13 (`B:460`,
> `B:471`) state the *callback* mints the session with a Strict cookie. Under the owner-accepted d1b Option
> A redesign (`…tech.md:299`, changelog v2.11 `…tech.md:625`), the cross-site callback **arms a handoff and
> does not mint**; the same-site `POST /complete` runs `issueSession` (rotate branch). The rotate
> **invocation** is asserted at `complete/route.test.ts:54` (D1B-2/D1B-3, with `issueSession` mocked), while
> the Strict-cookie **attribute** itself is owned and asserted by `issueSession`/`session-cookies.test.ts`
> (`:232` `sameSite:"strict"`; D1B-4 unchanged-attrs `:249-256`) — not the callback test. The matrix
> rows were not re-worded; this is a doc/test-title lag against as-built, not a coverage gap (recorded, not
> invented).

---

## C. DD-39 gender/pricing readiness surface (DD-38 chat is split out — see the pointer after C1)

> Sources: `features/BE/feature_user_settings_tech.md` · `features/FE/feature_user_settings.md` ·
> `standards/decisions.md` DD-39 (+ addendum USR-OQ-1, consent-state PIN) · `slice-readiness-verdicts.md`
> Verdict 2. Every row is src-traced; no column is invented. This lists the **DD-39 gender/pricing** surface
> a future user-settings migration must create — it does **not** exist on `main` at this base (unlike the D1
> auth surface in §B, which is merged). **DD-38 chat is out of this packet's scope** (pointer below); no
> readiness state/verdict is asserted here.

### C1. DD-39 expand-only schema surface (gender/pricing) a user-settings migration must create

| # | Object | Surface (from spec, unchanged) | Src-trace |
| - | ------ | ------------------------------ | --------- |
| 1 | `persons` | `ADD COLUMN gender_enc bytea` (PII, value set `male\|female\|other\|undisclosed`) · `dob_enc bytea` · **`gender_consent`/`dob_consent` per-attribute state `not_set\|granted\|denied`** (a nullable ciphertext cannot distinguish missing data from denied consent — DD-41 needs this to pick its error semantics) · `username text` + `persons_username_uq` UNIQUE ON `lower(username) WHERE username IS NOT NULL` · `language text NOT NULL DEFAULT 'vi' CHECK (language IN ('vi','en'))` | `feature_user_settings_tech.md:46-50`; DD-39 consequence `decisions.md:496`; **consent-state PIN `decisions.md:523`** (storage owned by the user_settings slice); addendum USR-OQ-1 `decisions.md:487` |
| 2 | `sessions` | `ADD COLUMN price_male integer CHECK (price_male IS NULL OR price_male >= 0)` · `price_female integer CHECK (…>= 0)`; both NULL → base `price_amount`; phase-1 uses columns, no parallel price table | `feature_user_settings_tech.md:55-56` (+ note `:61`); DD-39 `decisions.md:490` |

**Migration number:** DD-39 writes "migration mới sau `0013`" (`decisions.md:496`) — stale at this base: the
live tail on `main` is `0018` (`0000…0018`, verified `git ls-tree main`). The DD-39 user-settings migration
lands at the **next free monotonic number after all merged prerequisites** (0019+ at this base), fixed at
author-time per `feature_user_settings_tech.md:61` ("số monotonic kế tiếp còn trống sau khi sync mọi
prerequisite đã merge"); the packet holds no number.

**Out-of-scope flag (not DD-38/39):** `persons.profile_visibility` (`feature_user_settings_tech.md:237-242`)
and `CREATE TABLE person_follows` (`:245`) are DD-47/48 objects that the tech spec bundles into the same
physical migration transaction (`:67`); they are **not** attributed to DD-38/39 here.

**DD-38 chat — split out of this packet (pointer, not an inventory).** Chat readiness (channels / members /
messages + triggers + RLS/RPCs + the DM-safety schema + `chat_definer` provisioning + the `memberships`
composite-FK target) is **NOT** in this auth packet and is **not** enumerated here. It belongs to the root
migration slice **`dd38-dd86-chat-schema-core`** pinned by DD-86 (`decisions.md:1085`), which is **blocked**
behind `{DD-55 design-probe (not run); DD-86 ratify — 🟡 proposal, NOT_PLAN_READY, decisions.md:103; CHT-OQ-2
(open) — decisions.md:672}`. It is tracked as a `## task:` block in `docs/autopilot-backlog.md`
(`status: idea`, not authorized). Rationale for the split: DD-38 chat and auth-D1 are unrelated domains — §C
bundling them was a legacy of the AP-26 monolith's chunking, not a real dependency.

### C2. Dependency — consumer `dd41`

- **Verdict 2** (`slice-readiness-verdicts.md:57-98`, SLICE `dd41-public-session-projection-fields`,
  `REVIEW_VERDICT: NOT_CODE_READY` `:61`, `AUTHORITY_SHA: 22c23aa…` `:63`): its
  `HARD_DEPENDENCIES: DD-38/39 person.gender + chat migration = PRIOR_SLICE (chưa merge main)` (`:79`)
  spans two now-separated slices — the **person.gender (DD-39)** half is the C1 surface above; the **chat
  (DD-38)** half is split to `dd38-dd86-chat-schema-core` (pointer above). Resolution: "DD-38/39 migration
  merged into main (merged probe)" (`:93`); next-review trigger = that merge probe + dd41 autopilot
  artifacts (`:97`). dd41 is the entry of the share chain (dd41 → dd12 → dd73 → dd74-75 → dd76-77). The
  DD-39 gender/pricing surface carries no DD-55/DD-86 gate.

### C3. DD-39 criteria → evidence inventory (present/absent — no readiness state)

Per the gate's evidence-inventory form (`review-code-readiness-gate.md` §11.2 `:384`): each item records the
evidence that **exists** (file:line) and what is **absent** — nothing is scored or aggregated, and no
readiness state is asserted.

- **Decisions** — PRESENT: DD-39 (`decisions.md:484-496`), addendum USR-OQ-1 (`:487`), consent-state PIN
  (`:523`).
- **Schema surface** — PRESENT: the DD-39 columns are pinned in `feature_user_settings_tech.md:46-56` (C1).
- **Live schema** — OBSERVED: `persons`/`sessions` on `main` do not carry the C1 columns (the specs' "sau
  `0013`" wording is stale — 0014–0018 have landed).
- **Consumer dependency** — PRESENT: dd41 / Verdict 2 hard-dep on the person.gender half (C2).
- **Slice artifacts** — ABSENT: no mechanism-named user-settings slice doc / manifest / acceptance matrix
  (those are authored when that slice is spun up).

---

## D. Self-check

| § | Sources read (file + section) | Result |
| - | ----------------------------- | ------ |
| B1 | `0017_oauth_transactions.sql` (full; table `:68-94`, indexes `:100-103`, sweep `:120-148`, issue `:158-183`, claim `:198-263`) · B0 §4.1 (`:243-267`) + §3.2#6 (`:198`) · `schema.ts:417-465` (mirror) · tech §2 · tech v2.11 changelog (`:625`) | **PASS** — as-built table + two lifecycle CHECKs (v1.78) + partial indexes + sweep-at-traffic owner (called from issue AND claim) + single-use claim DB-CAS all present and verbatim; v1.85 cleanup semantics (first-sweep-after-expiry + order-4 job backstop) transcribed |
| B2 | `google-oidc.ts` (proof matrix `:55-127`) · `auth_login_google` (`0017:292-478`) · B0 §2 (`:53`)/§4 8 cells (`:226-235`)/§3.3 AAD (`:205`)/§5.2 (`:341-346`)/§8.2 (`:497`)/§8.3 (`:508`)/§10 (`:553`) · `oauth-transaction.ts` · routes `state`/`callback`/`complete` · tech §3 (`:200-201`)/§4 gate (`:299`) | **PASS** — 8/8 cell outcomes verbatim from B0 §4 + as-built site each (cell 8 as-built delta noted: the reject is pre-finalizer — the oauth txn is already claimed upstream — a precision beyond B0's "zero account/session mutation"); v1.86 preallocated-id signature (`p_account_email_id`, `0017:297,408-409`; app `randomUUID` `callback:166`); per-lane audit comment (v1.85, `0017:463-469`, cell 8 no row); route skeletons for the two D1 endpoints + the d1b `/complete` enablement hop; negative scope explicit |
| B3 | tech acceptance D1-1..15 (`:459-473`) · `auth.test.ts` (collision `:3265-3559`, issue/claim `:3609-3862`, handoff `:3881-4108`) · `google-oidc.test.ts:82-188` · `state`/`callback`/`complete` route tests · manifest `auth-s4-d1-google-adapter.json` | **PASS — mapping complete + accurate; 2 coverage caveats recorded** — 15/15 mapped to real on-disk tests (13 full + 2 PARTIAL); v1.85 audit assertions (`auth.test.ts:3316,3456`) resolved. **PARTIAL rows:** (1) D1-2 v1.86 preallocated-id — id-stored (`:3301`) + AAD-binding (`:3129`) proven separately, not a connected end-to-end assertion; (2) D1-11 rate-bucket independence — only the state→callback direction is asserted, not the reverse. Both recorded, not overstated. D1-2/D1-13 session-mint relocation to `/complete` recorded as a doc/as-built delta (d1b Option A), not a gap |
| C | `feature_user_settings_tech.md` §2 (`:46-56,61`) · `feature_user_settings.md` · decisions DD-39 (`:484-496,523,487`) · Verdict 2 (`:57-98`) · gate §11 (`:346-382`) · DD-86 pin (`decisions.md:1085`) | **PASS (DD-39) + DD-38 split-out** — the DD-39 gender/pricing surface (C1) is src-traced + enumerable (zero invented columns; base `main@399c5eb`); C3 is a criteria→evidence inventory (present/absent, no state — the gate §11.2 test `:384` confirms this asserts no readiness state, so no verdict/directive; owner-decided, see the resolution note above). **DD-38 chat is split out** to root slice `dd38-dd86-chat-schema-core` (backlog `## task:` anchor), so §C no longer covers the full "DD-38/39 readiness" it originally scoped → the original combined-DD-38/39 completion criterion no longer applies; the packet carries **no completion marker** (this doc asserts no readiness state per §11.2; the merge disposition is a process signal recorded outside it) |
| D | (this table) | — |

Floors are unchanged and not mis-transcribed: Argon2id m=19456/t=2/p=1 · rate-limit buckets §8.2
(`oauth-state`/`oauth-callback` 10/min) · cookie policy (session `Strict`; OAuth binding `Lax`
path-scoped ≤600 s) — the packet only restates DD-80, it changes nothing.

**As-built delta ledger (world moved forward since the original draft — no unresolved carry-over):**
D1 order-3 (`0017`) and d1b (`0018`) are merged (§B header, `…tech.md:625`); the three AP-26/round-03
open items are resolved on disk — (1) issuance fence lands in D0b (`logout-all` + `issueSession` reject,
`complete/route.ts:81-86`), (2) the B2 cell-1 AAD handoff is the as-built preallocated `p_account_email_id`
(B2.3), (3) the revoke-all `web_sessions(account_id)` index lands in `0015` (D0 scope, outside this
packet). §A (D0) is intentionally not imported.

---

> **§C scope — resolved (owner decisions, 2 steps).** §C originally bundled "DD-38/39 readiness." Two owner
> decisions settled it:
>
> 1. **No verdict (gate §11).** §11 governs a readiness **state assertion** — a doc that reads like an
>    assessment gets read as authorization. A MET/PARTIAL/NOT-MET gate matrix asserts such a state, so §11
>    applied to the earlier §C3 draft (a green `review:check` is only the validator's filename detection
>    heuristic, not a refutation). But the remedy is **not** to add a verdict: DD-38/39 is unauthored, so a
>    canonical verdict would need placeholder `TARGET_FILES` + an `AUTHORITY_SHA` that pins nothing —
>    fabricated evidence with a machine-checked veneer. §C therefore asserts **no** readiness verdict. This
>    is now codified: the gate's **§11.2** test (`review-code-readiness-gate.md:384`, added 2026-07-23) makes
>    "asserts a readiness state" the §11 trigger and "evidence inventory (present/absent)" exempt — and cites
>    this packet's §C3 as the precedent.
> 2. **Split (Option 2).** DD-38 chat and auth-D1 are unrelated domains; §C bundling them was an AP-26
>    monolith legacy, not a real dependency. The **DD-38 chat** surface is removed from this packet entirely
>    (one pointer after C1) and re-homed to root slice `dd38-dd86-chat-schema-core` (DD-86,
>    `decisions.md:1085`), anchored as a `## task:` block in `docs/autopilot-backlog.md`. §C keeps only the
>    **DD-39 gender/pricing** surface, which is pinned + enumerable.
>
> **No `AUTH_D1_PACKET_COMPLETE` marker.** The original marker presumed §C would cover the full DD-38/39
> surface; the DD-38 chat half was split out (to `dd38-dd86-chat-schema-core`), so that completion criterion
> no longer applies and the marker is intentionally absent. This doc asserts **no readiness state** (gate
> §11.2 `:384`): whether the docs slice is merged is a process decision recorded outside it, not written
> here.
