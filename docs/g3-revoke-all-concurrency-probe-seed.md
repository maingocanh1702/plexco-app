# G3 — Revoke-all Concurrency Design-Probe (FINAL CONTRACT)

> **Status:** ✅ **Owner-authorized direction 2026-07-20 — design decision closed; no runtime yet.**
> The historical `-seed` filename is retained so DD-80/AP-27 links do not break. This file now replaces
> seed v0.1 as the complete Gate-3 technical authority. Transcribe/mirror contract changes into
> `standards/decisions.md`, B0 and the Web Auth BE spec before opening a code worktree.
>
> **Live-code snapshot verified:** `main@9c6e5875cf66b153a7ec58b57c424a23e495c999` —
> `packages/db/migrations/0001_global_directory.sql`,
> `packages/db/migrations/0012_auth_functions.sql`, `packages/db/schema.ts`,
> `packages/db/src/auth.ts`, `packages/db/src/auth.test.ts`,
> `apps/web/lib/session-cookies.ts` and its two live callers.
> **Runtime boundary:** live `issueSession()` still fallback-mints when rotate returns `NULL`; migration
> `0015`, epoch columns, revoke-all functions and the v1.86 reject-and-reauth fence do **not** exist on
> this snapshot. They are contracts for D0a/D0b, not implementation evidence.

---

## 1. Decision summary

Revoke-all uses one account-level monotonic generation as the validity authority:

- `accounts.session_epoch bigint NOT NULL DEFAULT 0 CHECK (session_epoch >= 0)`;
- `web_sessions.minted_epoch bigint NOT NULL DEFAULT 0 CHECK (minted_epoch >= 0)`;
- a session resolves only when `s.minted_epoch = a.session_epoch`;
- `revoked_at IS NULL` and `expires_at > now()` remain mandatory;
- create, rotate and logout-all serialize through the relevant `accounts` parent row(s);
- logout-all bumps the account epoch and materializes row-level `revoked_at` in the same transaction;
- D0 is decomposed into DB epoch core (D0a) and web boundary/fence (D0b).

The equality is intentional. `minted_epoch > session_epoch` is impossible under the writer contract and
must fail closed as corruption or an unauthorized writer. `>=` is forbidden.

---

## 2. Live race and why row locks are insufficient

Live `web_sessions` has only per-row `revoked_at`; create is an unguarded insert, resolve checks one row,
and rotate locks only the old session row before inserting a replacement. A proposed implementation that
only runs:

```sql
UPDATE web_sessions
SET revoked_at = now()
WHERE account_id = $1 AND revoked_at IS NULL;
```

cannot see a concurrent uncommitted insert that was absent from its statement snapshot. That new row can
commit after the update scan and remain live. Locking all currently existing session rows does not lock a
row that does not exist, so this is a phantom rather than a lost update.

The serialization point must therefore be a row that exists before either operation: the account parent.

---

## 3. Canonical invariants

| ID | Invariant | Fail-closed result |
|---|---|---|
| G3-I1 | Valid session generation is exact equality: `minted_epoch = session_epoch`. | Any lower, higher or NULL epoch does not resolve. |
| G3-I2 | Every session insert reads and stamps the target account epoch while holding that account lock. | Missing account/epoch or lock failure aborts; no session row/cookie. |
| G3-I3 | Every path that inserts/rebinds a session or performs account-wide revoke locks all relevant account parents before a session row. Single-session revoke remains row-local. | Candidate drift after parent locks returns `NULL`/`AUTH_INVALID`; no partial mutation. |
| G3-I4 | Cross-account rotate A→B locks the unique set `{A,B}` in ascending UUID order. | No caller-selected lock order and no session-first fallback. |
| G3-I5 | Logout-all revalidates the current token under the locked account epoch before bumping. | Stale/replayed token performs zero bump, revoke or audit. |
| G3-I6 | Epoch bump, row-level revoke, exact count and audit commit atomically. | Any failure rolls the entire transaction back. |
| G3-I7 | `revoked_at` remains authoritative for single-session revoke and audit visibility. | Epoch never revives a revoked/expired row. |
| G3-I8 | Global protected auth tables keep zero direct DML grants to `app`, `app_worker` and `readonly`. | Writes occur only through narrow SECURITY DEFINER functions. |
| G3-I9 | Session resolution adds no cache and returns the existing DTO shape. | DB/lookup failure is auth failure; no stale allow. |
| G3-I10 | `bigint` overflow or constraint failure aborts logout-all. | No wraparound, saturation or partial revoke. |

---

## 4. Exact operation contracts

### 4.1 Create

`auth_create_web_session(account_id, token_hash, csrf_secret, ttl)` keeps its signature.

1. Lock `accounts(id=account_id)` and read `session_epoch`.
2. If the account is missing, abort without inserting.
3. Insert the session with `minted_epoch = locked session_epoch`.
4. Return the new session id as today.

The account lock is held until the caller transaction commits. The DB default of `0` exists for monotonic
migration compatibility; the function must always provide the locked epoch explicitly.

### 4.2 Resolve

`auth_resolve_web_session(token_hash)` keeps its signature and return columns. The live query already joins
`accounts` to obtain `person_id`; reuse that join and add exact equality:

```sql
WHERE s.token_hash = p_token_hash
  AND s.revoked_at IS NULL
  AND s.expires_at > now()
  AND s.minted_epoch = a.session_epoch
```

Do not add a second subquery and do not cache this authorization decision.

### 4.3 Rotate, including cross-account A→B

`auth_rotate_web_session(old_hash, new_hash, new_csrf, ttl, target_account_id)` keeps its signature and
cross-account binding behavior.

1. Read-only resolve the old live session candidate to obtain `(session_id, old_account_id)`.
2. If absent, return `NULL`.
3. Lock the unique parent set `{old_account_id, target_account_id}` using
   `ORDER BY id FOR UPDATE`; a same-account rotate locks one row once.
4. Re-read the old session `FOR UPDATE` and revalidate hash, id, old account, unrevoked, unexpired and
   `old.minted_epoch = old_account.session_epoch`.
5. Drift/death returns `NULL` with zero insert.
6. Revoke the old row and insert the replacement for `target_account_id`, stamped with the locked target
   account epoch, in the same transaction.

This preserves the existing account-confusion regression: authenticating as B over A's cookie binds the
new session to B. It also makes both logout-all(A) and logout-all(B) participate in a deterministic order.

### 4.4 Internal account revoke

The internal helper remains owner-only and is not granted to runtime roles:

```text
auth_revoke_account_sessions(p_account_id uuid) -> integer
```

Caller must hold the account parent lock. The helper:

1. atomically increments `accounts.session_epoch` and returns `new_epoch`;
2. updates every row for that account where `revoked_at IS NULL`, including a corrupt/future epoch row;
3. sets one transaction-stable `revoked_at` timestamp;
4. returns the exact number of rows newly marked revoked.

Epoch is validity authority; row updates preserve D0 count/audit semantics and make a forward rollback safe.

### 4.5 Public logout-all wrapper

```text
auth_revoke_all_web_sessions(p_current_token_hash text) -> integer
```

1. Read-only resolve the candidate current session and derive its account server-side.
2. Lock that account parent.
3. Re-read/revalidate the exact current session under lock, including epoch equality.
4. Invalid/replayed/currently expired token returns no row/typed invalid result and performs zero mutation.
5. Call the internal helper, write one redacted `logout_all` audit row with locked old epoch, exact new
   epoch and revoke count, and commit.

The wrapper never accepts `account_id` from the caller. Route-level CSRF validation happens before the DB
mutation. Replaying the cleared/revoked cookie returns generic `AUTH_INVALID` 401, not idempotent success.

### 4.6 `issueSession` fence

This is approved future D0b behavior, not current runtime:

- request has a cookie and rotate returns `NULL` → clear cookie, throw typed
  `SessionReauthRequiredError`, and map it to generic `AUTH_INVALID` 401 in every live caller;
- request has no cookie → normal create path remains allowed;
- never turn a stale-cookie rotate failure into a fallback mint.

---

## 5. Linearization decision table

| Competing operations | Lock/commit order | Exact final result |
|---|---|---|
| create(X) × logout-all(X) | create locks X first, commits epoch E; logout bumps E+1 after | Created row is marked revoked and cannot resolve after logout commits. |
| create(X) × logout-all(X) | logout locks X first, commits E+1; create locks after | New authentication stamps E+1 and survives; it linearizes after logout-all. |
| rotate(X→X) × logout-all(X) | rotate wins X lock | Replacement is minted at E, then logout bumps E+1 and revokes it. |
| rotate(X→X) × logout-all(X) | logout wins X lock | Old token fails revalidation; rotate returns `NULL`; D0b rejects and requires reauth. |
| rotate(A→B) × logout-all(A) | rotate locks `{A,B}` first | B session commits; later logout-all(A) revokes A sessions, not the independently authenticated B session. |
| rotate(A→B) × logout-all(A) | logout-all(A) locks first | Rotate old A token fails locked revalidation and returns `NULL`; no B session. |
| rotate(A→B) × logout-all(B) | rotate locks `{A,B}` first | B session commits, then logout-all(B) bumps B epoch and revokes it. |
| rotate(A→B) × logout-all(B) | logout-all(B) locks first | Rotate later stamps B's new epoch and survives as an authentication linearized after logout-all(B). |
| logout-all(X) × logout-all(X) | both initially read the token; first locks/commits | Second revalidation fails against bumped epoch/revoked row; zero second bump/audit. |
| resolve × uncommitted logout-all | resolve sees last committed epoch | It may resolve before logout commit; after commit the same token cannot resolve. |
| any DDL/function/audit failure | transaction aborts | Epoch, row revokes, audit and count all roll back together. |

“Started first” is not the winner rule for overlapping operations. The account-parent lock is the
linearization point; after logout-all returns, no operation that linearized before it remains resolvable.

---

## 6. Migration, compatibility and rollback

### 6.1 D0a migration

Use the next live monotonic migration, currently `0015_auth_revoke_account.sql`; do not rewrite 0001/0012.
One PostgreSQL transaction must contain:

1. add `accounts.session_epoch` with default/check;
2. add `web_sessions.minted_epoch` with default/check; existing account/session rows both backfill to `0`;
3. create the partial index on `web_sessions(account_id) WHERE revoked_at IS NULL`;
4. create `auth_audit_events` with the append-only/zero-runtime-DML-grant contract already pinned by
   DD-80, including nullable non-negative `session_epoch_before`/`session_epoch_after` with both-null-or-
   `after = before + 1` CHECK for session-epoch mutations;
5. replace create/resolve/rotate with the contracts above;
6. create internal revoke helper and public wrapper;
7. update Drizzle schema mirror and catalog/grant invariant tests.

Existing app wrappers remain compatible because create/resolve/rotate SQL signatures and resolve DTO do not
change. The new logout-all wrapper is additive. Atomic DDL prevents an externally visible mixed state where
the columns exist but old functions can mint an unstamped valid session.

### 6.2 Rollback/disable

- Before production data: restore the exact 0012 function definitions, remove new wrapper/helper/index,
  then drop epoch columns only after proving no dependent object remains.
- After production use: prefer a forward compatibility migration. Restore 0012-equivalent behavior while
  retaining columns/audit data; do not drop append-only audit history. Row-level materialization guarantees
  every session invalidated by an epoch bump also has `revoked_at`, so disabling epoch comparison does not
  resurrect a pre-logout session.
- Any rollback that cannot prove that materialization invariant must fail closed by disabling session issue
  and forcing reauthentication; it must not silently ignore epoch.

No cache invalidation or provider/legal enablement gate applies.

---

## 7. Bounded implementation slices

### D0a — `auth-s4-d0-revoke-core` (account-session epoch DB core; P0, manual-only)

**Owner/module:** `packages/db` auth/session DB core.

**In scope:** one migration 0015, Drizzle mirror, create/resolve/rotate replacements, internal revoke/public
wrapper, audit table, DB exports, Postgres barrier/catalog/grant tests and DB README.

**Out of scope:** web routes/cookies, email/Google/Facebook, Telegram removal, link-code revocation,
provider calls, cache, UI and deployment enablement.

**Cohesion/budget exception:** this remains one DB module and one monotonic migration, but may exceed the
default 300-LOC ceiling because all session writers plus the resolver must switch to epoch semantics in the
same transactional deployment. Splitting create/resolve/rotate across migrations would expose a mixed
writer state and violate G3-I2/G3-I3; web behavior is already removed into D0b.

**Definition of Done:** D0a acceptance rows pass on real PostgreSQL; existing 0012 auth suite and
cross-account rotation regression remain green; no direct protected-table grants; two consecutive FULL-base
Codex clean rounds; STOP_AT_READY.

### D0b — `auth-s4-d0-session-web-boundary` (P0, manual-only)

**Dependency:** D0a merged and probed by `auth_revoke_all_web_sessions` in migration 0015.

**Owner/module:** `apps/web` auth session boundary.

**In scope:** `issueSession` reject-and-reauth, typed error, both current callers and tests, logout-all route,
CSRF, cookie clear and route tests.

**Out of scope:** DB lifecycle/schema/function changes, new login providers, general error framework,
tenant APIs and UI.

**Definition of Done:** D0b acceptance rows pass, no-cookie mint unchanged, every live `issueSession` caller
maps the typed error to 401, two consecutive FULL-base Codex clean rounds; STOP_AT_READY.

D1 remains blocked until both D0a and D0b merge. Splitting at the DB/web boundary avoids another 16-file
monolith while preserving one atomic DB migration.

---

## 8. Acceptance matrix

| ID | Slice/layer | Input and precondition | Expected result |
|---|---|---|---|
| G3-A1 | D0a/Postgres | Existing account/session rows at migration time | Both epochs backfill `0`; existing live sessions still resolve; schema/catalog/checks match. |
| G3-A2 | D0a/Postgres | Create for current epoch E | Row stamps E exactly; higher/lower/NULL manual fixture cannot resolve. |
| G3-A3 | D0a/Postgres | Account missing or epoch read fails | Create/rotate inserts zero rows and transaction fails closed. |
| G3-A4 | D0a/Postgres | create(X) and logout-all(X), barrier in both lock orders | Outcomes match §5; no token linearized before logout survives. |
| G3-A5 | D0a/Postgres | rotate(X→X) and logout-all(X), both lock orders | No deadlock; winner table in §5 holds; stale rotate returns `NULL`. |
| G3-A6 | D0a/Postgres | rotate(A→B) with logout-all(A), both lock orders | Exact outcomes in §5; no account confusion or lock inversion. |
| G3-A7 | D0a/Postgres | rotate(A→B) with logout-all(B), both lock orders | Exact outcomes in §5; B epoch controls replacement validity. |
| G3-A8 | D0a/Postgres | Two logout-all calls read same current token before either locks | Exactly one bump/audit succeeds; second revalidation causes zero mutation. |
| G3-A9 | D0a/Postgres | A has 3 active sessions, B has 1 | A epoch increments once, exactly 3 A rows gain same `revoked_at`, return/audit count=3; B unchanged. |
| G3-A10 | D0a/Postgres | Failure injected after bump but before audit/commit | Epoch, row revokes and audit all roll back; old sessions remain as before. |
| G3-A11 | D0a/security | `app`, `app_worker`, `readonly` attempt direct DML/internal helper | Permission denied; only exact public wrapper is executable by `app`. |
| G3-A12 | D0a/regression | Existing create→resolve→revoke, rotate fixation and cross-account tests | Existing response shapes/semantics pass; single revoke remains effective. |
| G3-A13 | D0a/rollback | Forward rollback after logout-all with normal plus corrupt/future-epoch rows | Dropping epoch comparison does not resurrect any active row because logout-all materialized `revoked_at` without an epoch filter. |
| G3-A14 | D0a/observability | Successful/denied/integrity-fault paths | Successful audit has account id, exact old/new epoch and count; denied/integrity metric is redacted and includes only safely resolved fields/reason class; no raw token/hash/CSRF/PII. |
| G3-B1 | D0b/lib | Cookie exists; rotate returns `NULL` | Clear cookie, throw typed reauth error, never call create or set a new cookie. |
| G3-B2 | D0b/lib | No cookie | Create path and cookie attributes remain unchanged. |
| G3-B3 | D0b/routes | Telegram callback/onboarding privilege transition receives typed error | Generic 401 `AUTH_INVALID`; no internal reason/token leakage. |
| G3-B4 | D0b/route | Valid current session + CSRF calls logout-all | DB wrapper called without caller account id; response clears cookie and reports success. |
| G3-B5 | D0b/auth | Missing/wrong CSRF or replayed session | 403 `CSRF_INVALID` before mutation, or 401 `AUTH_INVALID` for replay; zero mutation. |

Concurrency tests must use two checked-out PostgreSQL connections and deterministic barriers/held parent
locks. Timing sleeps are not acceptance evidence.

---

## 9. Security, privacy and observability

- SECURITY DEFINER functions keep hardened search path and schema-qualified protected tables.
- Public wrapper derives account from the current token; request/body account id is ignored/rejected.
- Successful `logout_all` audit records account id, old/new epoch and exact row count; audit/logs exclude
  raw session token, token hash, CSRF secret, cookie value, email and provider proof.
- Metrics distinguish success, auth denial, CSRF denial, epoch-integrity failure and transaction rollback.
- Unknown epoch state, missing parent, constraint error, DB error and cache/storage error all deny auth.
- No new external provider, legal or enablement-only gate is introduced by D0a/D0b.

---

## 10. Execution order and verification

1. Commit this authority baseline and its propagated mirrors to `main`; do not open a P0 code worktree from
   an untracked/local-only plan.
2. Validate the D0a manifest/backlog plus this manual execution plan; canonical GENERIC v0.6.0 classifies
   auth/migration as P0, so **do not create or run an autopilot codegen launcher**. Create a dedicated manual
   worktree from exact `main` SHA and register scope gate.
3. Implement D0a manually, run real-Postgres targeted tests, typecheck and full suite, then two consecutive
   FULL-base Codex clean rounds; STOP_AT_READY and merge manually.
4. Verify D0a merged probe on `origin/main`, then open the already-authored D0b manifest in a fresh manual
   worktree and repeat P0 gates; no autopilot codegen launcher.
5. Re-review D1 authority only after D0a+D0b are merged.

Canonical verification commands:

```bash
DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

### 10.1 Current 12/12 repository-closure matrix

| # | Gate | D0a | D0b | Evidence / binary close condition |
|---|---|---|---|---|
| 1 | Authority snapshot pinned by committed SHA | FAIL | FAIL | v1.88 authority is still a working-copy delta over `9c6e587`; commit/push exact files, then re-pin. |
| 2 | In-scope decision closed | PASS | PASS | DD-80 v1.88 + this v1.0 contract. |
| 3 | IN/OUT scope and owner explicit | PASS | PASS | §7 + both manifests. |
| 4 | Dependencies classified | PASS | PASS | Manifest/backlog graph names merged roots and D0a→D0b. |
| 5 | Live schema/code reconciled | PASS | PASS | §2/live snapshot; absent 0015/route and current fallback mint are stated, not treated as implementation. |
| 6 | Data/API/state/auth contract complete | PASS | PASS | §§3–6. |
| 7 | Fail-closed/idempotency/order complete | PASS | PASS | §5 decision table + G3-I1..I10. |
| 8 | Open questions in scope = 0 | PASS | PASS | §11 closed-question register. |
| 9 | Acceptance expected results complete | PASS | PASS | §8 G3-A1..A14 / G3-B1..B5. |
| 10 | Migration/security/rollback pinned | PASS | PASS | §§6 and 9; D0b explicitly has no DB migration. |
| 11 | First-slice hard dependencies merged | PASS | FAIL | D0a roots exist on main; D0b closes only when both D0a merged probes pass on `origin/main`. |
| 12 | Implementation handoff immutable/ready | FAIL | FAIL | Plans/manifests/backlog are local-only; commit/push exact authority baseline first. |

Current closure is therefore **D0a 10/12** and **D0b 9/12**: the design/plan contract is closed, but neither
slice is `CODE_READY` from this working tree.

---

## 11. Closed-question register

| Former OQ | Resolution |
|---|---|
| Epoch vs timestamp | `bigint` epoch; no wall-clock tie. |
| Resolve comparator | Exact `=`; any future/corrupt epoch fails closed. |
| Keep `revoked_at` | Yes, for single revoke, count/audit visibility and rollback safety. |
| Lock mode/order | Account parents first; cross-account set sorted by UUID; revalidate after locks. |
| Bulk update | Mandatory in the same transaction; epoch remains validity authority. |
| Resolve cost | Reuse existing `JOIN accounts`; no extra subquery/cache. |
| Migration | One atomic monotonic 0015 for D0a; existing rows backfill 0. |
| D0 decomposition | D0a DB epoch core, then D0b web boundary. |

`OPEN_QUESTIONS_IN_SCOPE: 0`.

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-07-20 | v1.0 | Owner-authorized final contract: equality fail-closed, cross-account canonical parent locks/revalidation, mandatory row materialization/count/audit, transactional migration/rollback, D0a/D0b split and full acceptance matrix. |
| 2026-07-19 | seed v0.1 | Initial account-epoch anchor and phantom analysis; superseded by v1.0. |
