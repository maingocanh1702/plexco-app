<!-- review-readiness: code-ready -->

# Step-0 readiness: L73 p5-discovery-isolation-controls (session P5-S2b)

> Agent-facing. Step 0 measured by four step-0 readers (opus: Q1 the limiter design, Q2 the definer contract, Q3 the controls and thresholds, Q4 the callers) and by the orchestrator; this file was written by the step-0 readiness-file writer (opus). Writers, one at a time (opus): W1 the migration writer, then one web writer (section 12). One reviewer role and one security round (opus, Claude subagents: the Web MVP program's named exception, `CLAUDE.md`, DD-122 D4). RISK: P1 (one migration, a SECURITY DEFINER function and its grants, a public anonymous surface, the protection of the money pools; security round required). Base `4230c752ec0ddb2a14e2a07714a901c6022e862c` (main, the merge of PR #137; it contains PR #136's merge `779619deca20b07f20173cea98e66df442fecd8d`, measured with `git merge-base --is-ancestor`); branch `feat/p5-discovery-isolation-controls`; worktree `.autopilot/worktrees/p5-discovery-isolation-controls`; HEAD = base at step 0 (measured). Every `path:line` below was measured at the base. The step-0 notes live outside the repo, so this file restates every fact it relies on. No tracked file was edited at step 0; no DB suite ran.

Short forms: `drs` = `apps/web/lib/discovery-route-support.ts`; a bare four-digit number is the migration of that number under `packages/db/migrations/` (`0000_roles_extensions.sql`, `0012_auth_functions.sql`, `0046_rate_limit_bounded_cleanup.sql`, `0060_tenant_public_alias.sql`, `0061_public_sessions_projector_writer.sql`, `0068_public_name_invisible_chars.sql`, `0070_member_name_control_chars.sql`, `0072_member_name_definers_qualify_builtins.sql`, `0074_projector_delivery_lease_clock.sql`); `0075` = the new `packages/db/migrations/0075_discovery_rate_limit_definer.sql`; DD-04 = `docs/decisions/analysis/dd-04-hosting-final-decision.md`; PL = `docs/sessions/web-mvp-phase5-golive-plan.md`; P3R = `docs/sessions/web-mvp-phase3-readiness-p3-m9-discovery-read.md`; N = `DISCOVERY_RATE_MAX_KEYS`; "the function" = `discovery_rate_limit_hit(p_key text)`; "the table" = `discovery_rate_limit_counters`; a bare `name.test.ts:line` is under `packages/db/src/`.

## 1. Authority

- **DD-154** (`docs/standards/decisions.md:120`): the owner's approval of the Phase 5 plan, verbatim "Phase 5 plan approved. Q1, Q2, Q4-Q10 default. Q3 override: production starts without HA ...". It approves PL, whose section 3 row L73 (PL:85) is this lane, with Q10 (PL:132) at its default (i): the DB limiter is a migration of this lane at the next free number, run alone, merged before the first staging deploy (PL:202, step 8.6: the first staging deploy only after O-6 is closed per Q10). The owner answered Q10 with the default, so the migration is owner-approved.
- **O-6** as decided in Phase 3: P3R:396 "O-6 the limiter ceiling (P-6): upgrade to a readonly-executable limiter definer (an owner migration) or ingress limits"; P-6 at P3R:300 (the in-process window 60 per 60 s, at most 10 000 keys, full => 429).
- **The controls**: DD-04:289 "Discovery pool caps, timeouts, rate limits, cache policy, and circuit breaker protect money pools." (section 7.6 item 6 of that record, accepted at the plan's G3; PL:85), with section 5.3 at DD-04:139-143 (section 9 below).
- **RO-L73-1 and RO-L73-2**, the conductor's rulings: every choice below is "default applied, pending owner sign-off" (section 4) or "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature" (section 5); nothing here is an owner signature.
- **Scope** (the lane block's FILE OWNERSHIP, widened by R6 and R8): 0075 (new); its DB test file under `packages/db/src/` (new, section 11); the 14 migration-tail pin lines (2.3); `packages/db/src/client.ts` (the three optional timeout options of RO-L73-2 R6 only; default unchanged); `packages/db/schema.ts` (the table mirror, per the repo convention); drs; `apps/web/app/api/discover/**` (the routes and their tests); `apps/web/app/session/[slug]/page.tsx` (the awaited limiter call only); `apps/web/app/session/[slug]/page.test.tsx` (R8); this readiness file; at most 3 backlog rows at the END of `docs/autopilot-backlog.md`. Nothing else: no header or CSP change (L72), no App Spec (L66), no edge rule, no other route.
- **Negative scope** (the lane block's NEGATIVE SCOPE, as-is): no write grant on any table to readonly; no BYPASSRLS anywhere; no change of the readonly role probe except to cover the new function; no cache layer; no edge or ingress rule; no header or CSP work; no change of other routes or of the money paths; no weakening of an existing discovery test (they change only to await the new limiter or to drop the in-process map, plus the two mechanical kinds of R9); never two migrations; never a secret value.

## 2. Measured at base (file:line)

### 2.1 The limiter and its callers

- drs:18-19 every discovery response is `cache-control: no-store`, and "nothing here logs a slug, a listing id, an IP or a person id".
- drs:27-28 `ROLE_PROBE` (`... WHERE r.rolname = current_user AND NOT r.rolsuper AND NOT r.rolbypassrls`); :52-54 the readonly row check (:53 logs role names only, :54 throws).
- drs:37 `discoveryPool()`; :42-43 read `DISCOVERY_DATABASE_URL` and throw when it is unset; :44 `discoveryHandle ??= createDb(url, { max: 5 });`.
- drs:59-61 the constants 60, 60_000 and 10_000; :62-64 the sweep comment and the in-process `Map`.
- drs:66-83 the limiter doc comment; :70-82 its exposure precondition (:76 "exposure precondition", :79 the ingress /48 alternative).
- drs:84 `discoveryRateLimited(request: Request): Response | null` (synchronous); :99 a full map answers 429 with 60; :106 `retry-after`; :118 `rateLimitKey`; :139 `rateLimitedResponse`.
- drs:274-276 the empty 500 with no-store; :279-281 the comment (the limiter and the shape check run before any DB call; :281 "the key is never logged"); :283-298 `serveDiscoveryListing` (:290 limiter, :291 return, :292 shape, :293 read); :301-305 the test reset clears the windows, the handle and the ready flag.
- `apps/web/app/api/discover/route.ts`: :19 `GET`, :21 `assertDiscoveryCursorKey`, :22 limiter, :23 return, :24 parse, :25 invalid filter, :26 read (`listDiscoveryListings(await discoveryPool(), filter)`), :31-32 catch to the 500.
- `serveDiscoveryListing` callers: `apps/web/app/api/discover/[publicListingId]/route.ts:11` and `apps/web/app/api/discover/share/[slug]/route.ts:16`; their tests pin the 429 at `[publicListingId]/route.test.ts:148` and `share/[slug]/route.test.ts:149-154` ("share and detail probes share one per-IP budget").
- `apps/web/app/session/[slug]/page.tsx`: :10 import; :15 `force-dynamic`; :22-24 comment (:23 "a page cannot answer 429", :24 the error boundary, the slug is never logged); :33 `headers()`; :36 `discoveryRateLimited(request) || !/^[A-Za-z0-9_-]{22}$/.test(slug)`; :38 `readDiscoveryListingByShareSlug(await discoveryPool(), slug)`; :39 `if (!row) notFound();`. `page.test.tsx` beside it: :81 case (3), the 61st call gives the same `notFound()`; :99 the `force-dynamic` pin.
- `apps/web/app/api/discover/route.test.ts`: :64 `POOL` (probe row only); :87 env stub; :176-177 `createDb` not called (A-6); :180-187 the 61-call test (:187 `toHaveBeenCalledTimes(61)`); :190-191 the map-fill loop; :198 the poison test (titled A-7); :236 `[1, 2]`; :264 fake timers; :272-273 the second fill loop; :287 `createDb` not called.
- The join route `apps/web/app/api/public-listings/[publicListingId]/join/route.ts:80` calls `resolveDiscoveryListing(await discoveryPool(), publicListingId)`: it shares the discovery pool.
- The golden path does not run /discover (`apps/web/e2e/golden-path.spec.ts:262`, "/discover is NOT run here").

### 2.2 createDb and its impact

- `packages/db/src/client.ts:26` `createDb(connectionString: string, options?: { max?: number })`; :30 `new pg.Pool({ connectionString, max: options?.max ?? 10 })`, so no acquire, statement or query timeout is set; :9 a comment that names readonly as the discovery-process role (stale, 2.4).
- Call sites: 3 production call sites in 3 files (`apps/web/lib/session-cookies.ts:59` `createDb(url)`; drs:44 `{ max: 5 }`; `apps/web/lib/dev-login/seed.ts:93` `{ max: 2 }`), plus 2 in the test-infrastructure module `packages/db/src/test-harness.ts` (:762 `{ max: 4 }`, :765 `{ max: 2 }`), plus 34 test files that use it (`git grep -l createDb -- '*.test.ts' '*.test.tsx' | wc -l`). The detail and share routes call none. With the three new options optional and passed only by the discovery pool, none of these changes.
- GitNexus upstream impact on `createDb`, `discoveryRateLimited` and `serveDiscoveryListing`: LOW for all three; the index under-counts, so the call sites above are grep-measured.

### 2.3 Definer conventions and pin sites

- 0012: :324-327 `CREATE UNLOGGED TABLE rate_limit_hits`; :334 "-- No grants: touched only via the function below."; :337 `CREATE OR REPLACE FUNCTION rate_limit_check(`; :365 `REVOKE ALL ... FROM PUBLIC`; :366 `GRANT EXECUTE ... TO app`. So 0012:337-366 is the precedent of a definer owned by the migration role.
- 0046:20-21 and :30-31 the bounded cleanup shape (`LIMIT 100` / `FOR UPDATE SKIP LOCKED`).
- 0072: :15-17 `pg_catalog.` before each built-in call; :22-25 search_path kept, operators, casts and keywords unqualified; :39-40 the owner check; :42 the ROLLBACK line; :150-153 `LANGUAGE plpgsql` / `VOLATILE` / `SECURITY DEFINER` / `SET search_path = pg_catalog, public, pg_temp`; :324 `pg_catalog.now()`.
- 0074: :30-31 the runner wraps each file in one transaction (no BEGIN or COMMIT in the file); :33 the ROLLBACK comment form; :35-36 the `job_definer` bracket (0075 does not use it).
- 0061:486 `GRANT EXECUTE ON FUNCTION public_share_slug_resolve(text), public_listing_resolve(uuid) TO readonly;`, :487 SELECT on the share view to readonly (that definer is owned by `job_definer`, which has BYPASSRLS, so 0075 follows 0012 instead: R5). 0000:29 `CREATE ROLE readonly LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;`, :36 schema USAGE. 0068:65 and 0070:89 `REVOKE ALL ON FUNCTION ... FROM PUBLIC, app, app_worker, readonly;`. 0060:273 `REVOKE ALL ON TABLE public.tenant_public_alias_audit FROM PUBLIC, app, app_worker, readonly;`.
- Definer test pins: `zalo-dm-delivery.test.ts:183-190` and `:643-651` (owner, `prosecdef`, `proconfig`, ACL; the second with args and result); `member-name-invisible-chars.test.ts:733` (`provolatile`) and `:1117`; the superuser suite bypasses FORCE RLS, so a NOBYPASSRLS-owner replay lives apart (`public-alias-nobypass.test.ts:7-8`; `setupNonSuperuserOwnerContext`, `test-harness.ts:878`).
- `packages/db/schema.ts:207` the comment "UNLOGGED in 0012 (throughput over durability)", :209 `export const rateLimitHits = pgTable("rate_limit_hits", {`: UNLOGGED tables are mirrored there.
- The migrations directory ends at `0074_projector_delivery_lease_clock.sql`, so this lane takes 0075. The 14 migration-tail pin lines read 75 and 0074 and move to 76 and 0075: `migrate.test.ts:53, :755`; `outbox-projector-registry.test.ts:119, :120, :122, :125`; `rls-invariants.test.ts:70, :73, :1841, :1846, :2122, :4824, :4826, :4827`. Not pins: `rls-invariants.test.ts:2519-2601` (JCL-15 and 15b read 0074's body).

### 2.4 Lead corrections (a step-0 or brief fact the base contradicts)

1. Q2 put the readonly row check at drs:50-53; at the base it is drs:52-54. The lane block's lead puts `discoveryPool` at drs:38; at the base it is drs:37.
2. Q4 labelled route.test.ts:180-187 "A-7"; at the base the test titled A-7 is the poison test at :198, so this file names :180-187 by its content (the 61-call test).
3. Q2 cited "0000:28-29"; `CREATE ROLE readonly` is at 0000:29.
4. 0037:14-22 records the measured NOBYPASSRLS-owner failure but never names FORCE; for "the superuser suite bypasses FORCE" this file cites `public-alias-nobypass.test.ts:7-8`.
5. The orchestrator's brief counted `test-harness.ts:762` and `:765` as production call sites; they are test-harness call sites in a non-test module (2.2).
6. `packages/db/src/client.ts:9` names readonly as the "discovery process" role, but the web process serves discovery too (drs:70-82: "the discovery process or the web process, each holding its own copy of this map"). Under R6's ownership (the three options only) it stays unedited; backlog row (a) carries the correction.
7. Q3 cited DD-04:139 for "a separate bounded pool with a hard connection cap and statement timeout"; at the base that sentence is DD-04:140 (:139 is the projection-only DB role).

## 3. Threat model (the lane block, verbatim)

> THREAT MODEL: the adversary is an anonymous internet client, or many, calling /api/discover\*, the listing routes and /session/&lt;slug&gt; without signing in, to (a) lock legitimate visitors out of the limiter (the /64-fill attack of the precondition comment: 65 536 /64 keys from one /48), (b) exhaust the discovery pool or the database to starve the web and worker pools (money paths), (c) enumerate listings or share slugs faster than the limit. Out of scope: network-level DDoS (the owner's edge), authenticated users, the money routes themselves.

Where each item is checked: (a) the decision table 6.1 and the bound 6.2, tests A-3 and A-6, security note S3; (b) the pool cap (drs:44), the timeouts (8.3) and the breaker (8.1), tests A-11 and A-14 to A-17, S4; (c) 60 hits per key per window counted across processes (R2), tests A-1, A-2 and A-13, S3.

## 4. Decisions (each default applied, pending owner sign-off)

R1, R2 and R3 are user-visible, so they are applied as "default applied, pending owner sign-off": the plan's step 8.9 (PL:205) is the owner's one pre-pilot written confirmation of every pending default, and the PR body lists these three under that label.

- **RO-L73-2 R1**, the IPv6 /48 handling, option (2): a cap of 256 distinct /64 keys per /48 per window, enforced only once the window holds N/2 keys. Normal traffic is identical to the base; one /48 holds at most N/2 keys, so it cannot fill the table; under pressure, a /48's 257th and later NEW /64 get 429 until the window ends (at most 60 s). Facts (official sources, accessed 2026-10-28): a /64 per mobile device (RFC 6459 section 5.2; RFC 7278 section 2); /56 residential and /48 business end sites (RIPE-690 section 4.2.4); the assignment size is the ISP's local decision (APNIC policy section 5.2.3.2). No official source says how many devices share one carrier /48, so that effect is unmeasured (K1).
- **RO-L73-2 R2**, one global count, option (a): 60 hits per key per window counted across processes (the P-6 policy exactly, P3R:300) and N = 20 000 keys per window, a named constant: the base 10 000 per process (drs:61) times R = 2, because the web process and the discovery process each served the discovery paths with their own map (drs:70-82). Note: the owner's Q3 override (DD-154) puts ONE web process and no discovery component in production for the pilot (R = 1), where N = 20 000 makes a fill harder than at base, not easier. Backlog row (a): N follows the number of processes that serve the discovery paths when the topology changes.
- **RO-L73-2 R3**, the flood cost, option (A): every refused request now costs one DB round trip on the 5-connection pool (at base a refusal cost only memory); accepted, because DD-04:142 lets discovery degrade to `429` or `503` "before web/worker pools suffer" and the pool cap (drs:44) bounds the DB load; network floods are the owner's edge. Backlog row (b): the bounded per-window negative cache (option B).

## 5. Conductor rulings (decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature)

RO-L73-2 items 4-10, Tier B, reversible:

- **R4**: GOAL 1 reads as stated below; the PR body states it in the same words.
- **R5**: the migration role owns the function, per the 0012:337-366 precedent; its conditions are section 7.
- **R6**: option (ii), section 8.3; the ownership line of `client.ts` widens to the three options.
- **R7**: option (a), section 8.2.
- **R8**: `apps/web/app/session/[slug]/page.test.tsx` joins the file ownership (the limiter fake, the env stub, the "share page when limited" test).
- **R9**: two mechanical test changes are allowed: the DB fakes of the four discovery test files answer the limiter SQL, and route.test.ts:236 counts 3 DB calls instead of 2 (`[1, 2]` becomes `[1, 3]`); no assertion is removed or loosened, and A-6 (route.test.ts:176-177, `createDb` not called) holds unchanged because the list route checks its filter before the limiter (section 10).
- **Tier-B list** (RO-L73-2 item 10, accepted as recorded): (1) the join route (2.1) shares the discovery pool outside the breaker: backlog row (c), no change; (2) the discovery BE tech doc does not pin the in-process limiter, so it needs no edit; (3) `rate_limit_check` is not reused: it has no total bound and takes a caller-chosen bucket and limit, so readonly EXECUTE on it could write auth and chat buckets; a dedicated table instead; (4) the table is mirrored in `packages/db/schema.ts` per the repo convention (2.3); (5) the readonly probe (drs:27-28) is unchanged; a dropped `statement_timeout` is covered by `query_timeout` (R6), and a rejected startup parameter makes connections fail, which opens the breaker and answers 503, fail closed and visible at the staging smoke; (6) the breaker: one per process behind one choke point; 5 failures in a fixed 10 s window open it for 30 s, then 1 half-open probe; the limiter's own refusal is not a failure.
- **G3 note** (the orchestrator's choice, recorded here instead of a fourth backlog row, as RO-L73-2 item 10 allows): at G3 item 6 (DD-04:289 on staging), verify on the staging discovery URL that the statement timeout is applied (for example, `SHOW statement_timeout` through the discovery pool answers `2s`).
- **Derived** (Tier A, from the rulings and the ownership; no new choice): (i) the definer tests and the createDb pins share one new DB test file, `packages/db/src/discovery-rate-limit-definer.test.ts`, named for the mechanism as 0075 is (no client test exists at the base: `git ls-files packages/db/src | grep -i client` lists `client.ts` only); (ii) the page's read (page.tsx:38) stays outside the breaker's choke point, because the page changes at :36 only (R8); the limiter call before it answers 503 while the breaker is open, so the page never reaches its read then; (iii) the writer order of section 12.
- **RO-L73-4 items 1-3** (run 4; decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature; Tier B, reversible): (1) a `discoveryPool()` rejection counts only as row 10 says (8.1), so a pool, probe or configuration failure keeps the base 500; (2) the JS result bound is the named `DISCOVERY_RATE_WINDOW_SECONDS` (60), mirroring 0075:66; (3) every breaker 503 carries `retry-after` (whole seconds until the half-open probe, at least 1) and no-store, row 12 included.

### GOAL 1 (RO-L73-2 R4, verbatim)

"fewer than DISCOVERY_RATE_MAX_KEYS distinct sources per window cannot lock out other visitors; a fill by N or more sources refuses only NEW visitors until the window ends (fail closed, retry-after at most 60 s), and anything beyond that is the owner's edge."

The rest of the lane block's GOAL (1) holds: the in-process limiter is replaced at every call site by the readonly-executable DB limiter (a SECURITY DEFINER function readonly may only EXECUTE, over a table nobody else can read or write), fail closed on any limiter error, and the precondition comment (drs:66-83) is rewritten to the new current state. GOAL (2) is sections 8 and 9; GOAL (3) is section 9.

## 6. Limiter design (RO-L73-2 R1 option (2), R2 option (a))

### 6.1 Decision table

Every 429 is the existing `DISCOVERY_RATE_LIMITED` with retry-after = the seconds to the window end (1..60) and no-store. N = 20 000; the gate N/2 = 10 000.

| Key (`rateLimitKey`, drs:118) | allowed | 429 per key | 429 per /48 | 429 table full | limiter failure |
|---|---|---|---|---|---|
| IPv4 (also IPv4-mapped) | its row exists and hits <= 60 after +1, or a new key while `#keys` < N | hits > 60 in the window | never: no IPv4 aggregate (a CGNAT address already shares one key) | a new key while `#keys` >= N | 503 no-store (8.2) |
| IPv6 /64 | as IPv4; a NEW /64 also needs its /48 under the cap while the gate holds | hits > 60 in the window | the /48 row | a new key while `#keys` >= N | as IPv4 |
| IPv6 /48 aggregate (`p48:` + the /64 key's first three hextets) | a /64 admitted earlier in the window is served on its own row, never re-checked | never: the aggregate counts /64 keys, not hits | a NEW /64 while its /48 holds >= 256 keys and `#keys` >= 10 000 | checked before the aggregate | as IPv4 |
| a fixed non-IP fallback key of `rateLimitKey` (no client-IP header from the provider; local outside production) | one shared key, as IPv4 | every request with that key shares the 60 | never: not IPv6 | a new key while `#keys` >= N | as IPv4 |
| production without a client-IP provider | never: `clientIp` throws before the limiter | not reached | not reached | not reached | the base 500 (R7 (a), unchanged) |
| any other text (the function's input check) | never | not reached | not reached | not reached | RAISE without the key, so 503 |

The JS reads the result only when it is an integer in 0..60 (0 = allowed, else the retry-after); anything else, NULL included (`Number(null)` is 0, which would allow), is a limiter failure: 503.

### 6.2 Counter table, window math, cleanup and size bound

```sql
CREATE UNLOGGED TABLE discovery_rate_limit_counters (  -- UNLOGGED as 0012:324-327
  window_id bigint  NOT NULL,  -- floor(epoch seconds / 60): one clock-aligned window
  bucket    text    NOT NULL,  -- 'k:' || key, 'p48:' || first three hextets, or '#keys'
  hits      integer NOT NULL,
  PRIMARY KEY (window_id, bucket));  -- RLS on without FORCE, no policy, no grant (section 7)
```

- Window: `v_window := pg_catalog.floor(extract(epoch FROM pg_catalog.now()) / 60)::bigint`; retry-after `pg_catalog.ceil((v_window + 1) * 60 - extract(epoch FROM pg_catalog.now()))::integer`, 1..60. drs calls the function with `pool.query` (autocommit), so `now()` is the call time.
- Steps of one call (one transaction):
  0. NULL, length and character-set check of p_key against the forms `discoveryRateLimitKey` (drs, the one exported builder of the key the web passes) emits (dotted IPv4, the /64 form, the fixed fallbacks), else RAISE (section 7 item 9). No write before this step.
  1. `UPDATE ... SET hits = hits + 1 WHERE window_id = v_window AND bucket = 'k:' || p_key RETURNING hits`; found: allowed iff hits <= 60. Most traffic stops here, on one row.
  2. Unlocked read of the `#keys` row; >= N: refuse (the full fast path, no lock).
  3. IPv6 and `#keys` >= N/2: unlocked read of its `p48:` row; >= 256: refuse.
  4. Cleanup, admission calls only: delete at most 100 rows of older windows (`LIMIT 100` / `FOR UPDATE SKIP LOCKED`, the 0046:20-21 shape).
  5. IPv6: insert its `p48:` row with 1 (`ON CONFLICT DO NOTHING`), else `UPDATE ... SET hits = hits + 1 WHERE ... AND NOT (#keys >= N/2 AND hits >= 256)`; not found: refuse (exact under the row lock). Counted at any load, enforced only above the gate.
  6. Hard bound: `INSERT (v_window, '#keys', 1) ON CONFLICT (window_id, bucket) DO UPDATE SET hits = c.hits + 1 WHERE c.hits < N RETURNING hits`; not found: refuse (full).
  7. `INSERT (v_window, 'k:' || p_key, 1) ON CONFLICT DO UPDATE SET hits = c.hits + 1 RETURNING hits`; allowed iff hits <= 60.
- Size bound, fail closed: `#keys` is the exact count of key rows admitted in the window, raised under its row lock in the transaction that inserts the key, so no COUNT is needed. A full window refuses NEW keys (429, retry-after to the window end) and keeps serving the keys it holds. Rows per window <= N key rows + (N + C) `p48:` rows + 1, where C = calls in flight (<= 5 per process, drs:44); each admission creates <= 3 rows and deletes up to 100 old ones, so older windows never exceed one window's rows: about 2 x (2N + C + 1), about 80 000 rows at N = 20 000.
- One /48 holder (65 536 /64s, one request each): at most N/2 = 10 000 keys are admitted, the rest are refused at step 3 or 5 without a key row or a `#keys` increment; filling the rest of the table needs about 40 more /48s (10 000 / 256) or 10 000 more distinct IPv4 sources, which is GOAL 1's "N or more sources".
- Concurrency: on every admission the lock order is the `p48:` row, then `#keys`, then the key row; the existing-key path locks only its own row, so there is no cycle. Both counts are exact per distinct admitted key: a call refused at step 6 takes back its own step-5 `p48:` increment, and a call whose step-7 upsert finds the key row already there (a concurrent first call of the same key committed it first, unseen by step 1 under READ COMMITTED) takes back its own `#keys` and `p48:` increments, each time on rows the call already holds (no new lock). Two race-only effects remain, both bounded by the calls in flight: a second concurrent first call of an already-admitted key may be refused at a full table or at a /48 at its cap (conservative; its next call is served by step 1), and the /48 gate reads `v_keys`, the step-2 unlocked snapshot of `#keys`, so the gate can start up to the calls in flight late (a design note, not a defect; no test). Lock waits count toward the statement timeout (8.3), so they end in 503.
- UNLOGGED as 0012's `rate_limit_hits`: a crash empties the table, which resets at most the current window (K6).

### 6.3 Thresholds (named constants; the DB ones are DECLARE constants inside the function, never parameters)

| Constant | Value | Reason | Threat |
|---|---|---|---|
| DISCOVERY_RATE_LIMIT | 60 hits per key per window | the P-6 policy (P3R:300; drs:59), unchanged | c, b |
| DISCOVERY_RATE_WINDOW_SECONDS | 60, clock-aligned | drs:60; alignment gives one `#keys` row per window | c |
| DISCOVERY_RATE_MAX_KEYS (N) | 20 000 per window | R2 (a): 10 000 per process (drs:61) x R = 2, in one global table | a, b |
| DISCOVERY_RATE_PER_48_MAX_KEYS | 256 /64 keys per /48 per window | the /64s of one /56 (2^(64-56)), the RIPE-690 residential end site, so one residential site never meets it | a, c |
| DISCOVERY_RATE_PER_48_GATE | 10 000 (N/2) | R1 (2): one /48 never holds more than half the table, and below the gate nobody meets the aggregate | a |
| DISCOVERY_RATE_CLEANUP_BATCH | 100 rows per admission | the 0046:20 and :30 precedent; any value >= 3 keeps the bound | b |
| DISCOVERY_STATEMENT_TIMEOUT_MS | 2 000 | R6: the server cancels a discovery statement past it (57014), so none holds a primary connection longer | b |
| DISCOVERY_ACQUIRE_TIMEOUT_MS | 2 000 | R6, equal to the statement timeout: a longer wait means a saturated pool, which becomes a countable failure | b |
| DISCOVERY_QUERY_TIMEOUT_MS | 2 500 | R6: the statement timeout plus 0.5 s, so it fires only when the server cancel never arrives | b |
| DISCOVERY_BREAKER_FAILURES | 5 | equal to the pool cap (drs:44), so one failover blip does not open it | b |
| DISCOVERY_BREAKER_WINDOW_MS | 10 000 | 5 x the statement timeout: a stalled pool gives 5 timeouts inside one window | b |
| DISCOVERY_BREAKER_OPEN_MS | 30 000 | relief for the primary, long enough to stop the reconnect churn; also the retry-after while OPEN | b |
| DISCOVERY_BREAKER_HALF_OPEN_PROBES | 1 | at most one connection per process per open period | b |

## 7. Definer contract (RO-L73-2 R5; precedent in brackets)

1. One file, 0075, with the header form of 0072 and 0074 (WHAT, WHY, THREAT MODEL, POSTURE, ROLLBACK) and no BEGIN or COMMIT: the runner wraps each file in one transaction [0074:30-31].
2. Created by the migration role, which owns the table and the function: no SET ROLE, and not the `job_definer` bracket of 0074:35-36 [0012:324-366].
3. `CREATE UNLOGGED TABLE discovery_rate_limit_counters` as in 6.2 [0012:324-327].
4. `ALTER TABLE discovery_rate_limit_counters ENABLE ROW LEVEL SECURITY;` without FORCE and with no policy: FORCE would deny the owner under a NOBYPASSRLS migration owner in production while the superuser suite still passed [`public-alias-nobypass.test.ts:7-8`].
5. `REVOKE ALL ON TABLE discovery_rate_limit_counters FROM PUBLIC, app, app_worker, readonly;` and no table GRANT [0060:273; 0012:334].
6. `CREATE FUNCTION discovery_rate_limit_hit(p_key text) RETURNS integer` (a new name, so a plain CREATE); 0 = allowed, else the retry-after in seconds.
7. `LANGUAGE plpgsql` / `VOLATILE` / `SECURITY DEFINER` / `SET search_path = pg_catalog, public, pg_temp` [0072:150-153]; no STRICT, no PARALLEL clause (the default, unsafe, because it writes), no LEAKPROOF.
8. Every built-in function call is `pg_catalog.`-qualified (`now`, `floor`, `ceil`, `left`, ...); operators, casts and keyword forms stay unqualified [0072:15-17, :22-25, :324].
9. p_key's NULL, length and character set are checked before any write; a failure RAISEs with `ERRCODE = 'invalid_parameter_value'` and never echoes the key. Never STRICT: a NULL result read in JS as `Number(null)` is 0, which would mean allowed.
10. The thresholds are DECLARE constants, never parameters; no dynamic SQL (no `EXECUTE` of a string, no `format()`).
11. `REVOKE ALL ON FUNCTION discovery_rate_limit_hit(text) FROM PUBLIC, app, app_worker, readonly;` [0068:65, 0070:89], then `GRANT EXECUTE ON FUNCTION discovery_rate_limit_hit(text) TO readonly;` as the only grant [0061:486].
12. No CREATE or ALTER ROLE, no BYPASSRLS granted or relied on (the owner's exemption comes from ENABLE without FORCE), no change to readonly (0000:29), no ALTER DEFAULT PRIVILEGES.
13. The ROLLBACK line: "a forward migration that drops the function and the table" (the repo has no down files) [0074:33, 0072:42].
14. The `packages/db/schema.ts` mirror of the table, with the UNLOGGED comment [schema.ts:207-209].
15. DB test pins (A-8): the function's owner equals the table's owner, `prosecdef` true, `proconfig` `{search_path=pg_catalog, public, pg_temp}`, `provolatile` `v` (R5's four, checked by the security round), plus `proisstrict` false, the argument `p_key text`, the result `integer`, EXECUTE true for readonly and false for PUBLIC, app and app_worker (no `=X` entry in `proacl`); the table's `relpersistence` `u`, `relrowsecurity` true, `relforcerowsecurity` false, 0 policies, and no table privilege for app, app_worker or readonly (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, and MAINTAIN where the server has it) [`zalo-dm-delivery.test.ts:183-190, :643-651`; `member-name-invisible-chars.test.ts:733, :1117`].
16. A replay under a NOSUPERUSER NOBYPASSRLS owner proves the limiter works under the production owner posture (A-10) [`public-alias-nobypass.test.ts:7-8`; `setupNonSuperuserOwnerContext`, `test-harness.ts:878`].

## 8. Breaker, statuses and the createDb options

### 8.1 Breaker decision table

One breaker per process, module state in drs, behind one choke point `discoveryQuery(run)`; the limiter call and the reads of the API routes (route.ts:26 and the read inside `serveDiscoveryListing`, drs:293) go through it. Failure = any rejection of a call admitted through it (any SQLSTATE including 57014, a connection error, the acquire or the client timeout, an invalid limiter result); success = any resolved value, the limiter's refusal included (answered 429). One rule for the whole class: inputs are checked before any DB call, so a client cannot choose a DB error. Each outcome carries its admission generation, and a stale one is ignored (a late success cannot close OPEN). `discoveryPool()` rejections are not counted (the poison test route.test.ts:198 keeps its 500), except in row 10.

| # | State | Event | Next | Answer | DB |
|---|---|---|---|---|---|
| 1 | CLOSED | call | CLOSED | runs | yes |
| 2 | CLOSED | success | CLOSED, count kept | the base 200, 404 or 429 | - |
| 3 | CLOSED | failure, window expired | CLOSED, count 1, a window from now | limiter 503; API read 500; page `notFound()` or the error boundary; all no-store | - |
| 4 | CLOSED | failure, count + 1 < 5 | CLOSED, count + 1 | as 3 | - |
| 5 | CLOSED | failure, count + 1 = 5 in the window | OPEN until now + 30 s, generation + 1 | as 3 | - |
| 6 | OPEN | call before openUntil | OPEN | 503 no-store, retry-after = ceil(remaining s) | no |
| 7 | OPEN | call at or after openUntil | HALF_OPEN, generation + 1; this call is the probe | runs | one |
| 8 | HALF_OPEN | call while the probe is in flight | HALF_OPEN | 503 no-store, retry-after 1 | no |
| 9 | HALF_OPEN | probe success | CLOSED, count 0, generation + 1 | base | - |
| 10 | HALF_OPEN | probe failure, or its `discoveryPool()` rejects | OPEN, a fresh 30 s, generation + 1 | as 3, or 500 | - |
| 11 | any | stale outcome | unchanged | its own base answer | - |
| 12 | any | unknown state (a `never` switch) | OPEN until now + 30 s, generation + 1 (as OPEN) | 503 no-store, retry-after 30 | no |

Every rejected limiter or read query counts toward the breaker (rows 3-5 and 10), whatever its SQLSTATE, so the premise that a client cannot choose a DB error rests on the validators that run before any DB call: `FILTER_INSTANT` and the control-character check `CONTROL_OR_BIDI` (drs), the cursor's `PUBLIC_LISTING_ID` (discovery-cursor.ts) and the share route's `SHARE_SLUG`. A new client-chosen input that reaches SQL must keep a validator before the DB (security review P3; a design note, not a defect).

No row allows a request without the limiter's DB answer. The 503 has an empty body (as drs:274-276) and `cache-control: no-store`; no new error code and no new i18n string.

### 8.2 Statuses (RO-L73-2 R7 (a))

| Condition | Answer |
|---|---|
| a pool, probe or configuration failure (`discoveryPool()` rejects: the URL unset, a probe mismatch, a poisoned handle) | the base 500, empty, no-store; the base tests that pin it stay unchanged (R7 counts four, among them route.test.ts:198) |
| a `clientIp` misconfiguration in production | the base 500, raised before the limiter |
| any rejection of the limiter query: an error (the function's RAISE included), the statement timeout (57014), the client query timeout, the acquire timeout, or an invalid result (6.1) | 503, empty, no-store |
| the breaker OPEN, or HALF_OPEN with the probe in flight | 503, empty, no-store, retry-after (8.1 rows 6 and 8) |
| the limiter's own refusal (the function returns 1..60) | 429 `DISCOVERY_RATE_LIMITED`, retry-after = that value (at most 60), no-store |
| the share page `/session/<slug>` | a 429 or 503 from the limiter gives the one `notFound()` (page.tsx:36-39); a limiter throw reaches the 500 error boundary; `force-dynamic` stays (:15) |

### 8.3 createDb options (RO-L73-2 R6 option (ii))

`createDb` (client.ts:26) gains three optional options, passed to `pg.Pool` only when given, under pg's own names; only the discovery pool (drs:44) passes them:

| Option | Value at drs:44 | Bound |
|---|---|---|
| `statement_timeout` | 2 000 ms | server side: a statement past it is cancelled (57014) |
| `connectionTimeoutMillis` | 2 000 | acquire: a full pool rejects after 2 s instead of waiting without bound (client.ts:30 sets none) |
| `query_timeout` | 2 500 | client side: holds even if a transaction-pooled URL drops the server-side setting |

Default unchanged: every other caller (2.2) passes none of them, and its pool config stays `{ connectionString, max: options?.max ?? 10 }` byte for byte (client.ts:30); a test pins the unchanged default (A-11). Impact: 2.2 (GitNexus LOW; the call sites grep-measured).

## 9. The five controls of DD-04:289 (GOAL 3)

| Control | DD-04 | At base | This lane |
|---|---|---|---|
| Pool caps | :140 "a separate bounded pool with a hard connection cap"; :143 "reserved connection budgets for `web`, `worker`, and session-mode listeners" | MET per process: drs:44 `{ max: 5 }`; no test pins it | pinned by a web test (A-16); the per-role budgets of :143 follow the topology: backlog row (a) |
| Timeouts | :140 "and statement timeout" | NOT MET: client.ts:30 passes only `connectionString` and `max` | ADDED: the three R6 options (8.3); A-11, A-16, A-17 |
| Rate limits | :141 "edge and application rate limits" | in-process only (drs:59-64, :84; the precondition :70-82); no edge rule in the repo | ADDED: the DB limiter (0075, section 6); A-1 to A-10, A-13; the edge rules are the owner's (negative scope) |
| Cache policy | :141 "CDN caching for public projections ... cache-safe invalidation" | MET as no-store: drs:18-19, :274-276; page.tsx:15 `force-dynamic` | unchanged: the new 429 and 503 carry no-store (A-14, A-15); a CDN is not this lane's (negative scope: no cache layer) |
| Circuit breaker | :142 "a circuit breaker that degrades discovery to stale data, `429`, or `503` before web/worker pools suffer" | ABSENT: `git grep -n -i -E 'circuit.?breaker' -- apps packages` gives 0 lines | ADDED: 8.1; A-14 |

## 10. Per-call-site changes (Q4, R8, R9)

| Site | Change |
|---|---|
| route.ts:21-26 (list) | `assertDiscoveryCursorKey()` stays first (:21; route.test.ts:287); the parse and the 400 (:24-25) move ABOVE the limiter, so a bad filter costs no DB call (A-6 holds); then `const limited = await discoveryRateLimited(request); if (limited) return limited;`; the read (:26) goes through the choke point |
| drs:290 (`serveDiscoveryListing`; the detail route :11 and the share route :16 call it) | `const limited = await discoveryRateLimited(request);`; the order stays limiter, shape (:292), read (:293), as the detail test pins limiter-before-shape (`[publicListingId]/route.test.ts:148`) |
| page.tsx:36 | `(await discoveryRateLimited(request)) \|\| !/^[A-Za-z0-9_-]{22}$/.test(slug)` only (R8) |
| drs:44 | the three R6 options (8.3) |
| drs:59-64 | the constants and the map go; the DB thresholds live in the function (6.3), the timeout and breaker constants in drs |
| drs:66-83 | the precondition comment is rewritten to the new current state (GOAL 1) |
| drs:84 | `discoveryRateLimited(request: Request): Promise<Response \| null>`; the key comes from the one exported builder `discoveryRateLimitKey` (the bare `rateLimitKey(clientIp(request))`, no prefix; pinned against 0075 by `discovery-rate-limit-key-db.test.ts`), never from the request's slug or listing id, and is never logged |
| drs:279-281 | the comment becomes: the limiter (keyed by client IP, never the request key) is the one DB call before the shape check |
| drs:301-305 | the test reset clears the breaker instead of the map; same name and signature |
| the four discovery test files | R9: their DB fakes answer the limiter SQL with a keyed fake (0 while a key is at or under 60, else a retry-after), reset per test; page.test.tsx gains the `createDb` mock, the env stub and the fake (R8); route.test.ts:236 `[1, 2]` becomes `[1, 3]`; the map-fill test (:190-191) and the fake-timer test (:264, its fill :272-273) go with the map, as the negative scope allows: their 429 with retry-after stays on a fake refusal, and full = fail closed and the window reset move to the DB tests (A-4, A-6) |

## 11. Acceptance matrix (A-1..A-23; expected results)

DB tests live in the new `packages/db/src/discovery-rate-limit-definer.test.ts` and, for the A-10 NOBYPASSRLS owner replay, the new `packages/db/src/discovery-rate-limit-definer-nobypass.test.ts`, which runs isolated (listed in `isolatedTestFiles`, `packages/db/vitest.config.ts`) because `setupNonSuperuserOwnerContext` hands a shared role membership to a non-superuser owner; both run only through the DB/e2e lock by the orchestrator (sandbox off); the writer of each row is in brackets. The key-form contract test, the new `apps/web/app/api/discover/discovery-rate-limit-key-db.test.ts`, is DB-backed and runs with the db-backed web tests through the same lock: it pins every form `discoveryRateLimitKey` builds as admitted by 0075's step 0, and the old `discover:` prefix as its 22023.

| # | Test | Expected |
|---|---|---|
| A-1 | allowed (W1) | 60 calls of one key in one window return 0 |
| A-2 | limited (W1) | the 61st returns an integer in 1..60, the seconds to the window end |
| A-3 | /48 aggregate (W1) | with `#keys` >= 10 000, a /48 holding 256 /64 keys gets a refusal for its 257th NEW /64 while its admitted /64s and a /64 of another /48 are allowed; with `#keys` under 10 000 the 257th is admitted |
| A-4 | window reset (W1) | a key refused in an earlier window starts at 1 in the current one |
| A-5 | cleanup (W1) | an admission deletes at most 100 rows of older windows and never a row of the current window |
| A-6 | size bound full = fail closed (W1) | with `#keys` = N a NEW key is refused and adds no row, while a key admitted earlier in the window is still counted and served |
| A-7 | readonly cannot read or write the table (W1) | as readonly, SELECT, INSERT, UPDATE and DELETE on the table fail with 42501; EXECUTE of the function succeeds |
| A-8 | attribute and owner pins (W1) | every value of section 7 item 15 |
| A-9 | input check (W1) | NULL, an over-long key and a key with a character outside the set RAISE 22023, write no row, and the message does not contain the key |
| A-10 | NOBYPASSRLS owner replay (W1) | under `setupNonSuperuserOwnerContext` (`test-harness.ts:878`) A-1 and A-2 hold |
| A-11 | createDb (web writer) | a pool built with a short `statement_timeout` cancels a longer `pg_sleep` with 57014 and `SHOW statement_timeout` answers the set value; `createDb(url)` and `createDb(url, { max })` build their pool from exactly `{ connectionString, max }` (the unchanged default) |
| A-12 | tail pins (W1) | the 14 lines of 2.3 read 76 and 0075; nothing else in the three files changes |
| A-13 | every caller awaits the limiter (web writer) | list, detail and share: a fake refusal gives 429 `DISCOVERY_RATE_LIMITED` with retry-after at most 60 and no-store, and the read is not called; the detail and share 429 tests (2.1) and the 61-call test (route.test.ts:180-187) hold unchanged on the keyed fake |
| A-14 | breaker (web writer) | one test per row of 8.1: OPEN and HALF_OPEN-in-flight answer 503, empty, no-store, with retry-after and without a DB call; 5 failures in 10 s open it; a refusal never counts; the probe closes or reopens it |
| A-15 | statuses (web writer) | a limiter error, a 57014, a client timeout and an invalid result (NULL, 61, -1) give 503 no-store; a `discoveryPool()` failure keeps the 500 (route.test.ts:198 unchanged) |
| A-16 | the discovery pool's options (web writer) | drs:44 calls `createDb` with `max: 5` and the three R6 values |
| A-17 | no hang (web writer) | a limiter query that times out (a fake rejecting as the client timeout) answers 503 within the test's own time bound |
| A-18 | the share page when limited (web writer) | page.test.tsx case (3) (:81, the 61st render gives the same `notFound()`) holds; a limiter 503 gives `notFound()`; a limiter throw rejects to the error boundary; the `force-dynamic` pin (:99) holds |
| A-19 | A-6 and R9 (web writer) | route.test.ts:176-177 (`createDb` not called) unchanged; route.test.ts:236 reads `[1, 3]` |
| A-20 | mutation checks (each writer: commit first, mutate, rerun, restore with `git checkout --`) | the full check of step 6 removed: A-6 fails; the input check removed: A-9 fails; a limiter error read as allowed: A-15 fails; the OPEN row allowing the call: A-14 fails; restored: all green |
| A-21 | per commit (each writer) | `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm review:check:changed` green; GitNexus impact before editing a symbol, `detect_changes` before each commit |
| A-22 | final head (orchestrator) | `pnpm -w test` once through the lock; `pnpm review:check`; final-checks.sh (B3, attribution 0, closing keywords 0, porcelain, file list = ownership, migration count 1) |
| A-23 | backlog (this commit) | `scripts/autopilot-backlog-reconcile --check`: refused at most 2 (the base: refused 2, malformed 0), malformed 0 |

## 12. Verification and review

The lane block's TESTS and REVIEW PLAN as-is: one opus reviewer role, at most 3 rounds counting pre-push rounds, plus ONE opus security round on section 14; the last round follows the L44 policy (a P3 or lower = a docs- or comment-only fix labelled "fix applied after the final round, not re-reviewed (3-round cap)"; a P1, a P2 or any code change = a ruling request and RESULT: AWAIT). DB, migration and suite runs are the orchestrator's, through the lock with the sandbox off. Writers one at a time: W1 (0075, the schema.ts mirror, the DB tests A-1 to A-10, the pins A-12), then the web writer (client.ts with A-11 in W1's test file, drs, the routes, the page and the web tests A-13 to A-19); each runs A-20 and A-21 on its own commits. The golden path is not required: it does not run /discover (2.1) and no shared file of the session routes changes. CI green on ONE push.

## 13. Budget (B3)

The lane block: about 350 changed lines (production about 180, tests about 170) in at most 3 modules plus the migration and its pin sites; ONE migration. Not priced by that estimate: R5's contract and its pins (A-7 to A-10), R6's two added options and the default pin (A-11), and the 12-row breaker (A-14). The writers log the measured overrun with these design reasons in the PR body; an overrun is not a stop.

## 14. Security notes for the security round

- S1. The definer and its grants (section 7 items 2-12): the owner is DDL-capable, so each of R5's four conditions is checked: the search_path pinned with qualified builtins, no dynamic SQL, p_key bounded before any write, and the attributes pinned by A-8.
- S2. RLS on the table: ENABLE without FORCE, no policy, every privilege revoked from every role, no table GRANT; readonly reaches it only through the function (A-7).
- S3. The keying against the threat model: the decision table 6.1 and the bound 6.2; one /48 cannot fill the table, and fewer than N sources cannot lock out other visitors (GOAL 1).
- S4. Fail closed on every limiter and breaker error: no row of 6.1, 8.1 or 8.2 allows a request without the function's answer; a NULL or out-of-range result is a failure; an unknown breaker state answers as OPEN.
- S5. No log of an IP, slug or listing id: the function's RAISE does not echo the key; drs logs role names only (:53) and keeps its rule of :18-19; the breaker logs no key.
- S6. Reversibility as the repo practices it: a forward migration that drops the function and the table (section 7 item 13); the table holds no durable data (UNLOGGED); the web change reverts with the PR.
- S7. The discovery pool stays readonly: the probe (drs:27-28) is unchanged; readonly gains EXECUTE on one function and no table privilege.

## 15. Known risks

- K1. R1 (2): under pressure (`#keys` >= 10 000) a carrier or office /48 with more than 256 active /64s in one window refuses its 257th and later NEW /64 for at most 60 s; how many devices share one carrier /48 is unmeasured. Pending owner sign-off (8.9).
- K2. GOAL 1: a fill by N or more distinct sources refuses NEW visitors until the window ends; beyond that is the owner's edge.
- K3. R3 (A): every refusal costs one DB round trip on the 5-connection pool, bounded by the pool cap, the timeouts and the breaker; backlog row (b).
- K4. A pooler that rejects the `statement_timeout` startup parameter makes connections fail: the breaker opens and discovery answers 503 (fail closed, visible at the staging smoke); one that drops it leaves `query_timeout` as the bound. The G3 note (section 5) checks it on staging.
- K5. The function writes, so the discovery URL must reach the primary; a standby or a read-only default makes every limiter call fail: 503, fail closed.
- K6. UNLOGGED: a crash empties the table, which resets at most the current window (as 0012's `rate_limit_hits`).
- K7. The breaker is per process: R processes send at most R half-open probes per open period.
- K8. The join route (2.1) shares the pool, so its query gains the three timeouts without a code change, and the breaker neither counts nor refuses it; backlog row (c).
- K9. The limiter's bind parameter is the client IP or its /64, so the server-side bind-parameter logging (`log_min_duration_statement`, `log_parameter_max_length`) is checked on the production database at enablement (security review P3, unconfirmed, no code change).

## 16. Open

`OPEN_QUESTIONS_IN_SCOPE: 0`. R1-R3 are applied defaults pending the owner's confirmation at step 8.9 (PL:205), with current behavior pinned (section 4); R4-R9 and the Tier-B list are ruled (section 5). Out of scope with current behavior pinned: the edge rules and a CDN (the owner's; negative scope), N and the connection budgets per topology (backlog row (a)), the negative cache (row (b)), the join route (row (c)).

## 17. Hard dependencies and backlog rows

- PR #136 merged: `git merge-base --is-ancestor 779619deca20b07f20173cea98e66df442fecd8d 4230c752ec0ddb2a14e2a07714a901c6022e862c` is true; 779619d is "Merge pull request #136 from maingocanh1702/docs/p5-dd-and-run-doc" (DD-154). No other hard dependency; the migration slot 0075 is free (2.3). The backlog reconcile at the base: refused 2, malformed 0 (measured by the orchestrator).
- This commit appends 3 rows at the END of `docs/autopilot-backlog.md`, in the form of the rows above them (`git diff 779619deca20b07f20173cea98e66df442fecd8d 4230c752ec0ddb2a14e2a07714a901c6022e862c -- docs/autopilot-backlog.md`):
  - row (a) `p5-discovery-rate-max-keys-follows-process-topology`: N follows the number of processes that serve the discovery paths when the topology changes (App Spec, L66), with the per-role connection budgets, and the `client.ts:9` comment is corrected then;
  - row (b) `p5-discovery-limiter-bounded-negative-cache`: the bounded per-window negative cache of R3 (B);
  - row (c) `p5-join-route-discovery-pool-outside-breaker`: the join route shares the discovery pool outside the breaker.

## 18. Closure matrix (12 of 12 PASS)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the worktree HEAD at step 0 = the base (measured); every TARGET_FILES path exists at the base or is this file | PASS |
| 2 | Decisions in scope final | DD-154 (the owner's approval, Q10 = (i)); RO-L73-2: R1-R3 applied as defaults pending owner sign-off (section 4), R4-R9 and the Tier-B list ruled (section 5) | PASS |
| 3 | Scope IN/OUT and owner clear | the lane block's FILE OWNERSHIP as widened by R6 and R8, and its NEGATIVE SCOPE (section 1); the writer split (section 12) | PASS |
| 4 | Dependencies classified | PR #136 merged (section 17); no other lane; the migration slot 0075 free (2.3) | PASS |
| 5 | Live schema and code match | section 2 measured at the base; corrections in 2.4 | PASS |
| 6 | Data, API, state, auth contract | the function and the table (sections 6, 7), the statuses (8.2), the createDb options (8.3), the per-site changes (section 10) | PASS |
| 7 | Fail-closed, idempotency, order | the decision tables 6.1, 8.1 and 8.2; the hard bound without COUNT and the lock order (6.2) | PASS |
| 8 | Open questions in scope = 0 | section 16 | PASS |
| 9 | Acceptance matrix with expected results | section 11 (A-1..A-23) | PASS |
| 10 | Migration, security, rollback | exactly one migration 0075 (Q10 = (i)); the security round on section 14; rollback = a forward migration that drops the function and the table | PASS |
| 11 | First slice hard dependencies merged | W1 depends on nothing unmerged (section 17) | PASS |
| 12 | Implementation handoff ready | sections 6-11; W1 has every input for 0075, its DB tests and the pins (sections 2.3, 6, 7, 11) | PASS |

## 19. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-29
AUTHORITY_SHA: 4230c752ec0ddb2a14e2a07714a901c6022e862c
BASE_BRANCH: main
TARGET_FILES:
  - packages/db/src/client.ts (edited: the three optional timeout options of RO-L73-2 R6 only; default unchanged)
  - packages/db/schema.ts (edited: the counter table mirror only, beside :207-209)
  - packages/db/src/migrate.test.ts (edited: tail pins :53, :755 only)
  - packages/db/src/outbox-projector-registry.test.ts (edited: tail pins :119, :120, :122, :125 only)
  - packages/db/src/rls-invariants.test.ts (edited: tail pins :70, :73, :1841, :1846, :2122, :4824, :4826, :4827 only)
  - apps/web/lib/discovery-route-support.ts (edited: the async DB limiter, the breaker, the pool options, the comments :66-83 and :279-281, the reset :301-305)
  - apps/web/app/api/discover/route.ts (edited: the filter before the awaited limiter, the read through the choke point)
  - apps/web/app/api/discover/route.test.ts (edited: R9 and A-13 to A-19)
  - apps/web/app/api/discover/[publicListingId]/route.test.ts (edited: the limiter fake only)
  - apps/web/app/api/discover/share/[slug]/route.test.ts (edited: the limiter fake only)
  - apps/web/app/session/[slug]/page.tsx (edited: the awaited limiter call at :36 only)
  - apps/web/app/session/[slug]/page.test.tsx (edited: R8, the limiter fake, the env stub and A-18)
  - docs/autopilot-backlog.md (edited: 3 new rows at the END only)
  - apps/web/app/api/discover/[publicListingId]/route.ts (read only: :11)
  - apps/web/app/api/discover/share/[slug]/route.ts (read only: :16)
  - apps/web/app/api/public-listings/[publicListingId]/join/route.ts (read only: :80, backlog row c)
  - apps/web/lib/session-cookies.ts (read only: :59)
  - apps/web/lib/dev-login/seed.ts (read only: :93)
  - apps/web/e2e/golden-path.spec.ts (read only: :262, /discover is not run)
  - packages/db/src/test-harness.ts (read only: :762, :765, :878)
  - packages/db/src/zalo-dm-delivery.test.ts (read only: :183-190, :643-651)
  - packages/db/src/member-name-invisible-chars.test.ts (read only: :733, :1117)
  - packages/db/src/public-alias-nobypass.test.ts (read only: :7-8)
  - packages/db/migrations/0000_roles_extensions.sql (read only: :29, :36)
  - packages/db/migrations/0012_auth_functions.sql (read only: :324-366)
  - packages/db/migrations/0046_rate_limit_bounded_cleanup.sql (read only: :20-21, :30-31)
  - packages/db/migrations/0060_tenant_public_alias.sql (read only: :273)
  - packages/db/migrations/0061_public_sessions_projector_writer.sql (read only: :486-487)
  - packages/db/migrations/0068_public_name_invisible_chars.sql (read only: :65)
  - packages/db/migrations/0070_member_name_control_chars.sql (read only: :89)
  - packages/db/migrations/0072_member_name_definers_qualify_builtins.sql (read only: :15-17, :22-25, :39-42, :150-153, :324)
  - packages/db/migrations/0074_projector_delivery_lease_clock.sql (read only: :30-36)
  - docs/decisions/analysis/dd-04-hosting-final-decision.md (read only: :139-143, :289)
  - docs/sessions/web-mvp-phase5-golive-plan.md (read only: :85, :132, :202, :205)
  - docs/sessions/web-mvp-phase3-readiness-p3-m9-discovery-read.md (read only: :300, :396)
  - docs/standards/decisions.md (read only: DD-154 :120)
  - docs/sessions/web-mvp-phase5-readiness-p5-discovery-isolation-controls.md (this file, the branch's first commit)
SLICE: p5-discovery-isolation-controls
IN_SCOPE: packages/db/migrations/0075_discovery_rate_limit_definer.sql (new): the UNLOGGED counter table and discovery_rate_limit_hit(p_key text) per sections 6 and 7, EXECUTE to readonly only; packages/db/src/discovery-rate-limit-definer.test.ts (new): A-1 to A-11; the schema.ts mirror; the 14 migration-tail pin lines; the three optional createDb options used only by the discovery pool; the awaited DB limiter at every call site, the per-process breaker and the statuses of section 8 in apps/web; this readiness file and 3 backlog rows
OUT_OF_SCOPE: any table privilege for readonly; BYPASSRLS anywhere; a change of the readonly probe; a cache layer or a CDN; an edge or ingress rule; header or CSP work (L72); the App Spec (L66); any other route, the join route included (backlog row c); the money paths; a second migration; edits of migrations 0000-0074; the discovery BE tech doc; the client.ts:9 comment (backlog row a); the negative cache (backlog row b); any secret value
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: PR #136 merged (779619deca20b07f20173cea98e66df442fecd8d is an ancestor of the base, measured; DD-154)
PRIOR_SLICES: the Phase 3 discovery read (P-6, O-6: the in-process limiter); PR #136 (merged: DD-154); PR #137 (merged: the base)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # one migration 0075; one security round (opus) on section 14; rollback = a forward migration that drops the function and the table
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 (the migration writer) - write 0075 per sections 6 and 7, its DB tests A-1 to A-10 in packages/db/src/discovery-rate-limit-definer.test.ts, the schema.ts mirror and the 14 tail pins (A-12), and commit in the worktree; the orchestrator then runs the DB tests under the lock
REMAINING_BLOCKERS: none
```
