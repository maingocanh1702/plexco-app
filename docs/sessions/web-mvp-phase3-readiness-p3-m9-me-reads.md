<!-- review-readiness: code-ready -->

# Step-0 readiness: L9 p3-m9-me-reads (session P3-S5)

> Agent-facing. Readiness reviewer: opus/max (same model and effort as the lane's code reviewer). Writer opus/max; code reviewer opus/max
> plus an opus/max security round (cross-tenant read path, money visibility, SECURITY DEFINER), at most 3 rounds (DD-122 D4: Codex waived,
> independent Claude reviewer). Every `path:line` below is MEASURED at base `dbdc061443ca18f9cdc1277916b720d92a1081ea` (the lane block was
> measured at `c762c90`; L2, L7, L8 shifted lines). Use THIS file's numbers. TARGET_FILES (section 12) are read-only context that exists at
> the base; the edit set is section 4 + section 8 (new files are scope, never TARGET_FILES).
> Review questions (lane REVIEW PLAN) and where each is closed: **another person's data** -> 4.1 rules 2 and 7 (every row keyed by the person
> resolved from the account; every tenant-table reference carries `tenant_id = v_tenant`), 4.2 allowlists, A-1, A-2, A-9, A-14;
> **definer privilege and search_path** -> 4.1 (migration-role owner, per-tenant GUC, pinned search_path, `public.`-qualified relations,
> REVOKE PUBLIC, app-only EXECUTE), A-12, A-13; **caching** -> 4.5 (`private, no-store` on 200, `no-store` on every error), A-10;
> **enumeration** -> no route reads any id from the URL, query or body, the definers take the account id only, A-11, A-13.
> Orchestrator rulings (P3-S5, binding; also recorded in section 10): **D3** = D-L9-1 accepted as drafted (M-14: the 0059 definers are owned
> by the migration role, same as 0051/0052/0055/0058; no new role, no identity_definer reuse). **D1** = the tenant-lang anchor is the line
> `"app/api/me/channels/[id]/detach/route.ts": "b",` wherever it sits at the base (measured :170, not :169). Orchestrator ruling D3 is not
> owner decision D3 (DD-135, signed).
> Provenance: drafted by readiness reviewer #1 (stopped at the token rule, nothing committed); readiness reviewer #2 (fresh, opus/max)
> re-ran the spot-checks at the base (0009:23-52, 0037:64-81, `identity-link-web.test.ts:930-935` and `:1005-1009`,
> `identity-link-web-nobypass.test.ts:1-35`, `tenant-lang.test.ts:168-172`, the gender grep): all consistent with this file; precision fixes
> in section 8 (nobypass harness order) and O-7 (gender measured).

## 1. Base, dependencies, authority (Q1)

- W HEAD = origin/main = `dbdc061443ca18f9cdc1277916b720d92a1081ea` (merge of PR #68 `feat/p3-m9-join-core`); branch `feat/p3-m9-me-reads`;
  `git status --porcelain` empty at step 0.
- L8 merged: `packages/db/migrations/0058_player_self_join.sql` is the last migration => next free number **0059**.
- D3 signed: DD-135 `docs/standards/decisions.md:1790` (heading, decided), signature `:1808` ("Phase 3 plan approved. D3 signed.").
- What DD-135 binds here: `/pay` shows only the caller's own amounts and no bank data (`:1800-1801`); L9 is the own-money lane (`:1803`);
  hold, QR, pay-now and provider webhooks are out of MVP (`:1801`) => no `payAction` in any L9 DTO. L8 pin P-18 stands (the join response
  carries no amount and no venue): the player's own-money display is L9's `/api/me/charges`; never another person's amount (HARD RULE 2).
- Specs: `docs/features/FE/feature_player_view.md` v2.11 Status Reviewed (`:5-6`); `docs/features/BE/feature_player_view_tech.md` v2.11
  Status Reviewed (`:4-5`).

## 2. Lane-block and pre-measure citations re-measured at the base (Q2)

| Claim | Measured at the base |
|---|---|
| last migration 0058, next 0059 | yes (`ls packages/db/migrations`, tail 0051..0058) |
| 0055 `person_profile_read(p_account_id)` :77-90 | yes: LANGUAGE sql :79, STABLE :80, SECURITY DEFINER :81, `SET search_path = pg_catalog, public, pg_temp` :82, `public.accounts a JOIN public.persons p ON p.id = a.person_id AND p.status = 'active'` :85-86, REVOKE ALL FROM PUBLIC :89, GRANT EXECUTE TO app :90; no `OWNER TO` in 0055 (owner = migration role); "No schema.ts change" :74 |
| 0055 `person_profile_update` :92, `account_linked_channels` :150, `channel_identity_detach` :167 | yes; ordering precedent `ORDER BY c.created_at DESC, c.id DESC` :162 |
| `me-settings.ts` 113 lines, readMyProfile :50, listMyChannels :79 | yes; `pool.query<Row>(sql, [accountId])` with `$1::uuid` :51-54, :86; snake -> camel mapping :89-94 |
| `me-route-gate.ts` 40 lines, resolveMeGate :13 | yes: AUTH_REQUIRED 401 :18, CSRF only if `options.csrf` :19-21, RATE_LIMITED 429 :22-23, `actorThrottled(accountId)` :24, optional bucket `${name}:${accountId}` :25-28, returns `{ accountId }` only :29; imports `actorThrottled` from `./session-command-route` :3 (L4b's file, never edited by L9) |
| existing me routes | `apps/web/app/api/me/{profile,channels,channels/[id]/detach,link}/route.ts`; GET precedent `channels/route.ts:11-23` (gate `{ csrf: false }`, no bucket, `ok(...)`, no try/catch); test precedent `channels/route.test.ts:6-18` (mocks `@plexco/db` and `lib/session-cookies`) |
| `tenant_ids_for_person` 0037:64 | yes; reads `tenant_admins` only (:74-79) => admin tenants only, not usable |
| 0009 tenant-isolation RLS on memberships, players, charges, join_requests | yes: table list :30-45 (memberships :30, sessions :31, players :32, charges + payment_allocations :34, join_requests :40), ENABLE :49, **FORCE :50** (binds the table owner too), policy :52-54 keyed on `NULLIF(current_setting('app.tenant_id', true), '')::uuid`, app grant :57 |
| `index.ts` me-settings block ends :250 | yes (block :238-250) |
| `tenant-lang.test.ts` SURFACE_BUCKETS :113-263, walker :265-304, anchor :169 | SURFACE_BUCKETS :113; walker checks :297 (unclassified), :302 (stale); the anchor line `"app/api/me/channels/[id]/detach/route.ts": "b",` is at **:170** (not :169); `"lib/me-route-gate.ts": "b",` :171 |
| error codes | `packages/core/src/api-contract.ts`: AUTH_REQUIRED :91, FORBIDDEN :104, NOT_FOUND :120, RATE_LIMITED :125; no generic 5xx code (only AUTH_UNAVAILABLE :93, LINK_UNAVAILABLE :115) |

## 3. Measured facts the contract rests on

- `accounts` 0001:91-95: `person_id` nullable (:93) => an account may have no person. `persons` 0001:21-31: status active|merged|deleted
  (:27-28); phone columns :24-26 never selected.
- `tenants` 0002:11-20: name :13, slug UNIQUE NOT NULL :14, status :15-16. No RLS and no app privilege (`rls-invariants.test.ts:5014`); read by
  a migration-role definer in 0052:56.
- `memberships` 0002:23-33: display_name :27, pay_code :28 (never selected), status active|guest|left|merged :29-30; one active|guest row per
  (tenant, person) `memberships_active_person_unique` :35-37. No `role` column (FE spec's "role" is not a membership field).
- `sessions` 0002:76-100: starts_at :80, ends_at :81, timezone :82, venue_name :83 and venue_address :84 ("private until join/approve", DD-06),
  **area :85 (text, "public whitelist", district)**, price_amount :87, status draft|open|closed|cancelled :93-94.
- `players` 0002:134-144 + 0014: status active|left|waitlisted (0014:80-81); `waitlist_position` (0014:101), NOT NULL iff waitlisted (0014:107-108).
- `charges` 0003:43-56: amount_due integer NOT NULL >= 0 :49, amount_allocated integer NOT NULL default 0 :50, status open|partial|paid|void
  :51-52, UNIQUE (tenant_id, session_id, player_id) :54, CHECK amount_allocated <= amount_due :55.
- `payment_allocations` 0003:79-95: signed amount (reversal negative) :84, created_by = actor id :87 (never selected).
- `join_requests` 0006:37-49: person_id :41 (direct; no membership needed), status pending|approved|rejected|expired|cancelled :42-43, expires_at
  :44, decided_by :45 (a host person id, never selected), decided_at :46, command_id :47 (never selected); one pending per (session, person) :51-52.
- `sports` 0001:12-18 (key, name), `GRANT SELECT ON sports TO app, readonly` 0009:105.
- Roles: `app` NOBYPASSRLS (0000:8, :23).
- Definer owners: 0051/0052/0055/0058 have no `OWNER TO` => the migration role (0058:22-23 says so). FORCE RLS binds that owner: with no tenant
  GUC a NOSUPERUSER NOBYPASSRLS owner reads 0 rows from a tenant table (`identity-link-web-nobypass.test.ts:1-35` header; 0024:82-88). That is
  why 0058 `create_guest_membership` binds the caller's `app.tenant_id` GUC (0058:46). The one BYPASSRLS owner of a cross-tenant scan is
  `identity_definer` (0054:50-58, SET ROLE bracket :230-232, :396-399), and its single-purpose posture is pinned by tests:
  `identity-link-web.test.ts:932` ("owns nothing else and keeps no schema CREATE") and `:1007` (column grants exactly what its body uses).
- GUC set-and-restore idiom inside a definer: 0037 `tenant_ids_for_person` :71-80 (`v_prev := current_setting(...)`, `set_config(..., true)`,
  restore `coalesce(v_prev, '')`).
- ONE money formula: `chargeRemaining(amountDue, effectiveAllocated, status)` `packages/db/src/payment-manual.ts:63-69` (doc :54-62: THE
  remaining formula of the roster `session-read.ts:371` and of close's guard); `chargeStatusFor` :48-52; effectiveAllocated = the ledger SUM
  `effectiveByCharge` `roster-money-shared.ts:171-188` (`coalesce(sum(amount), 0)::int` grouped by charge_id, :181). The spec's
  `remainingAmount` / `effectiveFee` (BE :219-290; `packages/core/src/payments-logic.ts:276`) is NOT used by L9: it equals chargeRemaining on
  every consistent open|partial row, and an inconsistent row is `unknown` before any formula runs (4.3).
- Waitlist position: L8's join result and the roster expose the raw `players.waitlist_position` (`session-join-service.ts:245`, `:293`;
  `session-read.ts:286`).
- Envelope: `ok()` / `err()` set `cache-control: no-store` unless the caller passes one (`apps/web/lib/api-envelope.ts:6-17`, ok :20);
  `err()` takes no init (:36-40), so gate errors carry `no-store`.
- Harness (#62, used as is): `setupRlsTestContext(dbName)` `test-harness.ts:679` (superuser owner; `ctx.owner` seeds, `ctx.appPool` = role app;
  members :645-659); `setupNonSuperuserOwnerContext` (NOSUPERUSER NOBYPASSRLS migration owner) used by `identity-link-web-nobypass.test.ts:1-35`
  inside `withJobDefinerLock` (:537) -> `ns.bootstrapJobDefinerForOwner()` -> `ns.bootstrapChatDefinerForOwner()` (doc :786-800; it also
  bootstraps identity_definer). Test precedent for a me definer suite: `me-settings.test.ts:11-27`.
- `pnpm db:bootstrap` `package.json:25` runs `infra/postgres-init/01-job-definer.sql`, `02-chat-definer.sql`, `03-identity-definer.sql` as
  `DATABASE_URL_MIGRATION`.
- Spec anchors: FE invariants `feature_player_view.md:36-46` (person only from the verified session; allowlisted DTO; unknown is not 0;
  unknown dominates the cross-club summary; host receivable excluded); FE `/me` dashboard :102-162, join requests :236-246, data mapping
  :327-338; BE edge cases :73-95 (#1, #2, #7, #15, #16), query patterns :97-125 (`starts_at > now()`, LIMIT 20), endpoints :129-139, error codes
  :198-203, rate limits :207-214, self-payment service :219-290 (SelfPaymentStatus, SelfPaymentSummary, wrapper without raw tenant id), DTO
  allowlist :291-299, caching :309-316 (no cache on person-self data).

## 4. Contract

### 4.1 Definer design: ONE migration `packages/db/migrations/0059_me_player_reads_definers.sql` (Q4)

Additive only: four functions; no table, column, index, CHECK, policy or grant on an existing object, so `schema.ts` and `db.dbml` stay
unchanged (0055:74, 0058:5-6 precedent: functions are not mirrored). Each function takes `p_account_id uuid` ONLY (no person, tenant or
membership parameter):

- `account_my_clubs(p_account_id uuid) RETURNS TABLE (club_ref text, club_label text, membership_status text)`
- `account_my_sessions(p_account_id uuid) RETURNS TABLE (session_id uuid, club_ref text, club_label text, sport_key text, starts_at timestamptz,
  ends_at timestamptz, timezone text, area text, my_status text, waitlist_position integer, venue_name text, venue_address text)`
- `account_my_open_charges(p_account_id uuid) RETURNS TABLE (club_ref text, club_label text, session_id uuid, starts_at timestamptz,
  amount_due integer, amount_allocated integer, effective_allocated integer, charge_status text)`
- `account_my_join_requests(p_account_id uuid) RETURNS TABLE (request_id uuid, session_id uuid, club_ref text, club_label text,
  starts_at timestamptz, area text, status text, created_at timestamptz, decided_at timestamptz, expires_at timestamptz)`

Pinned shape (the other three differ only in the per-tenant query):

```sql
CREATE FUNCTION account_my_clubs(p_account_id uuid)
RETURNS TABLE (club_ref text, club_label text, membership_status text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_person uuid;
  v_tenant uuid;
  v_prev   text := current_setting('app.tenant_id', true);
BEGIN
  -- the person is resolved exactly as 0055 person_profile_read (:84-87): merged, deleted or no person => no rows
  SELECT p.id INTO v_person
    FROM public.accounts a
    JOIN public.persons p ON p.id = a.person_id AND p.status = 'active'
   WHERE a.id = p_account_id;
  IF v_person IS NULL THEN RETURN; END IF;
  FOR v_tenant IN SELECT t.id FROM public.tenants t ORDER BY t.id LOOP
    PERFORM set_config('app.tenant_id', v_tenant::text, true);
    RETURN QUERY
      SELECT t.slug, t.name, m.status
        FROM public.memberships m
        JOIN public.tenants t ON t.id = v_tenant
       WHERE m.tenant_id = v_tenant AND m.person_id = v_person
         AND m.status IN ('active', 'guest');
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END;
$$;
REVOKE ALL ON FUNCTION account_my_clubs(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION account_my_clubs(uuid) TO app;
```

Rules for all four:

1. **Owner = the migration role** (no `OWNER TO`, no SET ROLE bracket): the 0051/0052/0055/0058 shape. Not `identity_definer` (its pinned
   single-purpose posture, section 3) and no new role (needs `db:bootstrap` and harness work). See DECISION D-L9-1 in section 10.
2. **How it reads tenant rows, and why that is safe.** The definer does NOT bypass tenant RLS: FORCE RLS (0009:50) binds the owner, so under
   a NOSUPERUSER NOBYPASSRLS owner each tenant's rows are visible only while the function itself has set `app.tenant_id` to that tenant (the
   0009 policy :52-54). Under a superuser owner (local dev, `setupRlsTestContext`) RLS is bypassed, so the explicit predicate carries the
   isolation: EVERY tenant-table reference (memberships, players, sessions, charges, payment_allocations, join_requests) carries
   `tenant_id = v_tenant`. Every row is also keyed by `v_person`, resolved inside from the account: a caller reads only its own person's rows
   whatever the owner. This is the DB-side equivalent of withTenant (HARD RULE 1); routes never run SQL.
3. Loop over `public.tenants ORDER BY id` (no RLS, owner-readable): a person's tenant set cannot be listed without crossing RLS, and
   `tenant_ids_for_person` (0037:64) covers admin tenants only. Cost: one indexed probe per tenant per call (known limit, section 10).
4. GUC set per tenant with `set_config(..., true)` (transaction-local, undone on abort) and restored to the caller's previous value at the
   end (0037:71-80 idiom).
5. `LANGUAGE plpgsql VOLATILE` (`set_config` is volatile, so `LANGUAGE sql STABLE` is not possible); `SET search_path = pg_catalog, public,
   pg_temp` (pg_temp last, 0048 lesson); every relation `public.`-qualified; `#variable_conflict use_column`; no RAISE, no dynamic SQL.
6. `REVOKE ALL ... FROM PUBLIC`; `GRANT EXECUTE ... TO app` only (not app_worker, not readonly).
7. Never reads `tenant_admins` (no admin shortcut); never selects persons' name or phone, memberships.display_name or pay_code,
   payment_allocations.created_by, join_requests.decided_by or command_id, or any `*_enc` column.
8. Each per-tenant list query is capped at cap+1 rows (bounds work); the TS caller orders and caps across tenants (4.4, M-5, M-6).

Per-function predicates (pinned):

- `account_my_sessions`: (a) `public.players pl JOIN public.memberships m ON m.id = pl.membership_id AND m.tenant_id = v_tenant AND
  m.person_id = v_person AND m.status IN ('active','guest') JOIN public.sessions s ON s.id = pl.session_id AND s.tenant_id = v_tenant JOIN
  public.sports sp ON sp.id = s.sport_id JOIN public.tenants t ON t.id = v_tenant WHERE pl.tenant_id = v_tenant AND pl.status IN
  ('active','waitlisted') AND s.status = 'open' AND s.ends_at > now()`; `my_status = pl.status`; `waitlist_position = CASE WHEN pl.status =
  'waitlisted' THEN pl.waitlist_position END`; `venue_name` / `venue_address = CASE WHEN pl.status = 'active' THEN s.venue_* END` (the venue
  never leaves the database for a caller who is not active). UNION ALL (b) own pending requests: `public.join_requests jr JOIN public.sessions
  s ON s.id = jr.session_id AND s.tenant_id = v_tenant ... WHERE jr.tenant_id = v_tenant AND jr.person_id = v_person AND jr.status = 'pending'
  AND s.status = 'open' AND s.ends_at > now() AND NOT EXISTS (own active|waitlisted players row in that session)`; `my_status = 'pending'`,
  position NULL, venue NULL.
- `account_my_open_charges`: `public.charges c JOIN public.players pl ON pl.id = c.player_id AND pl.tenant_id = v_tenant JOIN
  public.memberships m ON m.id = pl.membership_id AND m.tenant_id = v_tenant AND m.person_id = v_person JOIN public.sessions s ON s.id =
  c.session_id AND s.tenant_id = v_tenant JOIN public.tenants t ON t.id = v_tenant WHERE c.tenant_id = v_tenant AND c.status IN
  ('open','partial')` (any membership status, M-2); `effective_allocated = (SELECT coalesce(sum(pa.amount), 0)::int FROM
  public.payment_allocations pa WHERE pa.tenant_id = v_tenant AND pa.charge_id = c.id)` = the effectiveByCharge sum, no other aggregate.
- `account_my_join_requests`: `public.join_requests jr JOIN public.sessions s ON s.id = jr.session_id AND s.tenant_id = v_tenant JOIN
  public.tenants t ON t.id = v_tenant WHERE jr.tenant_id = v_tenant AND jr.person_id = v_person AND jr.status IN
  ('pending','approved','rejected') AND s.ends_at > now()`.

Bootstrap: 0059 needs no definer role. A fresh DB still needs `pnpm db:bootstrap` (`package.json:25`) as superuser before migrate reaches
0022/0030/0054 (S1 ENVIRONMENT rule: before 0054); both harness contexts bootstrap for themselves.

### 4.2 The four DTOs and their allowlists (Q3)

Route JSON, camelCase, exact key sets (the allowlist test A-9 asserts `Object.keys` equality, so a new key needs a test change). No DTO
carries phone, email, pay_code, gender, a raw tenant id, a person id, a membership id, or another person's name, row or amount.

1. `GET /api/me/clubs` -> `{ clubs: MyClub[], truncated: boolean }`; `MyClub = { clubRef (tenants.slug), clubLabel (tenants.name),
   membershipStatus: "active" | "guest" }`. Source: memberships of the caller's person with status active or guest (M-1).
2. `GET /api/me/sessions` -> `{ sessions: MySession[], truncated: boolean }`; `MySession = { sessionId, clubRef, clubLabel, sportKey,
   startsAt, endsAt, timezone, area: string | null, myStatus: "active" | "waitlisted" | "pending", waitlistPosition: number | null
   (waitlisted only), venueName: string | null, venueAddress: string | null (both null unless myStatus is "active") }`. Sources: own players
   rows (active, waitlisted) on own active|guest memberships plus own pending join_requests; session status open and `ends_at > now()` (M-3).
   Excluded: price_amount (own money lives in charges; DD-39 prices per person), occupancy, roster, any other player.
3. `GET /api/me/charges` -> `{ clubs: MyClubCharges[], summary: SelfPaymentSummary }`; `MyClubCharges = { clubRef, clubLabel, status:
   SelfPaymentStatus }`. `SelfPaymentStatus` (BE :219-290, `payAction` omitted) = `{ kind: "known_zero", currency: "VND", asOf }` |
   `{ kind: "known_amount", currency: "VND", totalOutstanding, chargeCount, items: { sessionRef (session id), startsAt, amountDue,
   amountAllocated, remaining, status: "open" | "partial" }[], asOf }` | `{ kind: "unknown", reasonCode, retryable }`. `SelfPaymentSummary` =
   `{ kind: "known_zero", currency, asOf }` | `{ kind: "known_amount", currency, totalOutstanding, clubCount (clubs with totalOutstanding > 0),
   asOf }` | `{ kind: "unknown", reasonCode, retryable }`. Sources: open|partial charges on players rows of ANY membership of the caller's
   person (M-2); club set = own active|guest clubs (known_zero when no open charge) plus any club where such a charge exists. Excluded: paid,
   void, history, allocation rows, method or actor, host receivable, any other person's charge.
4. `GET /api/me/requests` -> `{ requests: MyJoinRequest[], truncated: boolean }`; `MyJoinRequest = { requestId, sessionId, clubRef, clubLabel,
   startsAt, area, status: "pending" | "approved" | "rejected", createdAt, decidedAt: string | null, expiresAt }`. Source:
   `join_requests.person_id` = the caller's person (M-4). Excluded: decided_by, command_id, venue.

### 4.3 Own money and `unknown` (Q3)

- Per charge row: `effective = effective_allocated`. The charge is UNKNOWN when `effective <> amount_allocated` (the stored derived value
  drifted from the ledger: allocation not intact, BE edge #15), or `effective < 0`, or `effective > amount_due`, or
  `chargeStatusFor(amount_due, effective) <> charge_status`. Otherwise `amountDue = amount_due`, `amountAllocated = effective`,
  `remaining = chargeRemaining(amount_due, effective, charge_status)`: imported from `payment-manual.ts`, never re-inlined.
- Club: `unknown` (reasonCode `LEDGER_INCONSISTENT`, retryable false) if any of its charges is unknown; `known_zero` if it has no open|partial
  charge; else `known_amount` (`totalOutstanding` = sum of remaining, `chargeCount`, items ordered by startsAt, sessionRef).
- Summary: `unknown` if ANY club is unknown (`LEDGER_INCONSISTENT`), or the charge read hit the cap (`TOO_MANY_OPEN_CHARGES`, retryable
  false), or the read failed (`READ_FAILED`, retryable true; clubs then `[]`). Never a partial sum. `known_zero` iff every club is known_zero
  (also for an account with no person or no membership). Else `known_amount` with the cross-club sum and clubCount.
- Underivable never becomes 0: the only coalesce to 0 is the ledger SUM over zero allocation rows (provably nothing allocated).

### 4.4 TS module `packages/db/src/me-player-reads.ts` (+ test) and `index.ts` (Q5)

- me-settings.ts precedent: `pool: pg.Pool`, `pool.query<Row>(sql, [accountId])`, snake_case rows mapped to camelCase.
- Exports: `listMyClubs(pool, accountId)`, `listMySessions(pool, accountId)`, `readMyCharges(pool, accountId)`,
  `listMyJoinRequests(pool, accountId)`; types `MyClub`, `MySession`, `MyJoinRequest`, `MyClubCharges`, `MyCharges`, `SelfPaymentStatus`,
  `SelfPaymentSummary`.
- List calls: `SELECT ... FROM account_my_<x>($1::uuid) ORDER BY <M-6> LIMIT <cap + 1>`; `truncated = rows.length > cap`; return cap rows.
- `readMyCharges`: one client; `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`; `account_my_clubs` and `account_my_open_charges` (LIMIT 201)
  in that one snapshot; COMMIT. Any thrown error: ROLLBACK, release, return `{ clubs: [], summary: unknown READ_FAILED retryable true }`.
  `asOf` = one ISO timestamp per response, taken after the read.
- `index.ts`: one export block after :250, comment `// Phase 3 L9: the signed-in player's own cross-club reads (0059 definers).`

### 4.5 Routes `apps/web/app/api/me/{clubs,sessions,charges,requests}/route.ts`, GET only (Q5)

```ts
export async function GET(request: Request): Promise<Response> {
  const gate = await resolveMeGate(request, { csrf: false, bucket: ME_CLUBS_READ });
  if (gate instanceof Response) return gate;
  try {
    const result = await listMyClubs(appDb().pool, gate.accountId);
    return ok(toClubsDto(result), { headers: { "cache-control": "private, no-store" } });
  } catch (e) {
    console.error("GET /api/me/clubs failed", (e as Error).name);
    return new Response(null, { status: 500, headers: { "cache-control": "private, no-store" } });
  }
}
```

- The account id comes ONLY from `resolveMeGate` (verified session cookie, `me-route-gate.ts:17`, `:29`). No handler reads
  `request.url` search params or a body, so `person_id` / `tenant_id` / `membership_id` in the query are ignored by construction.
- Errors: AUTH_REQUIRED 401 and RATE_LIMITED 429 from the gate (envelope, `no-store`); a caught failure on clubs, sessions or requests ->
  500, empty body, `private, no-store` (M-13); charges never 500s on a read failure (200 with `unknown READ_FAILED`). FORBIDDEN and NOT_FOUND
  are not reachable (no id input). No `api-contract.ts` change.
- Rate limit: per-route bucket through resolveMeGate (M-12) on top of the existing actor ceiling.
- DD-118: bucket "b" (account-scoped, no tenant routed). The only user-facing strings are the gate's `t(vi, en)` (`me-route-gate.ts:18`,
  `:23`); routes add none. `tenant-lang.test.ts`: after :170 add one comment line and the four route paths as "b" (ruling D1), nothing else.

## 5. Pinned defaults (Q8): each is "default applied, pending owner sign-off"; repeat each in the PR body

- M-1 Clubs and sessions list memberships with status active or guest only; left and merged are not listed (lane UNPINNED row).
- M-2 Charges are read through EVERY membership of the caller's person, any membership status, so an open debt is never hidden by a
  membership state and the summary never understates (DD-96 Part A; BE :219-290).
- M-3 Sessions listed: session status `open` and `ends_at > now()` (an in-progress session still shows its venue to an active player);
  draft, closed, cancelled and ended sessions are not listed; players status active or waitlisted; own pending requests on such sessions; a
  players row wins over a pending request on the same session.
- M-4 Requests listed: status pending, approved or rejected on sessions with `ends_at > now()`; expired and cancelled are not listed.
- M-5 Row caps: clubs 100, sessions 50, requests 50 (fetched cap + 1, `truncated` flag); open charges 200 (201 rows => whole charges
  response `unknown TOO_MANY_OPEN_CHARGES`).
- M-6 Ordering: clubs (club_label, club_ref); sessions (starts_at, session_id); requests (created_at DESC, request_id DESC); charge clubs
  (club_label, club_ref); charge items (starts_at, session_id); the definers' tenant loop is ORDER BY tenants.id.
- M-7 Area = `sessions.area` (0002:85). Venue (name and address) only when myStatus is active, enforced in SQL.
- M-8 Waitlist position = raw `players.waitlist_position`, the value L8's join result and the roster expose (not a recomputed rank).
- M-9 Summary shape = spec SelfPaymentStatus / SelfPaymentSummary without payAction; currency "VND"; one `asOf` per response.
- M-10 Unknown rules and reason codes exactly as 4.3 (LEDGER_INCONSISTENT, TOO_MANY_OPEN_CHARGES, READ_FAILED; retryable only READ_FAILED).
- M-11 Club ref = `tenants.slug`; no raw tenant id in any DTO (BE :219-290 wrapper rule; edge #7).
- M-12 Rate-limit buckets (BE :207-214 numbers): `me-clubs-read` 20 per 60 s, `me-sessions-read` 30 per 60 s, `me-charges-read` 20 per 60 s,
  `me-requests-read` 30 per 60 s.
- M-13 A caught read failure on clubs, sessions or requests -> 500, empty body, `private, no-store`, one log line with the route and the
  error name only (no account, person or amount); charges -> 200 `unknown READ_FAILED`.
- M-14 Definer owner = the migration role with the per-tenant GUC loop (4.1 rules 1-4), plpgsql VOLATILE; function names as 4.1.
- M-15 Success responses carry `cache-control: private, no-store`; error responses carry the envelope's `no-store` (`api-envelope.ts:11-17`;
  the envelope is out of scope).
- M-16 No tenant-status filter (all clubs get all features; billing out of MVP); sportKey from `sports.key` is included.

## 6. Implementation steps (dependency order, test-first)

1. GitNexus `impact` (upstream) before editing any existing symbol (only additive exports in `index.ts` and test constants are touched);
   `detect_changes` before every commit; fallback = a grep of callers stated in the PR body.
2. Red: bump the count pins (section 8) to 60 / `0059_me_player_reads_definers.sql`; write `packages/db/src/me-player-reads.test.ts`
   (A-1..A-9, A-12, A-13) and `packages/db/src/me-player-reads-nobypass.test.ts` (A-14). DoD: they fail for the missing migration.
3. Write 0059 (4.1). DoD: catalog tests A-12, A-13 green; one migration run at a time under the DB lock.
4. Write `me-player-reads.ts` and the `index.ts` block. DoD: A-1..A-9, A-14 green as role app.
5. Route tests (A-10, A-11, A-15, A-16) red, then the four routes; `tenant-lang.test.ts` entries. DoD: web tests green.
6. S1 VERIFY set (`| tail -40`): typecheck, lint, format:check, review:check:changed, build, `NODE_ENV=test pnpm --filter @plexco/web test`,
   `NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test`, then `pnpm -w test`. No UI change, so no Playwright run.
7. Review: opus/max reviewer + opus/max security round, at most 3 rounds; PR body carries the Codex-waived line and every M-* default.

## 7. Acceptance matrix (Q6, Q7)

| ID | Input / precondition | Expected | Layer |
|---|---|---|---|
| A-1 | persons A and B, both active players with open charges in session S1 of club T1; B also has a pending request on S2 | A's four reads hold only A's rows: no B player, charge, request, name or amount; A's T1 total = A's remaining only | db, role app |
| A-2 | A has memberships in T1 and T2, none in T3; T3 holds other persons' sessions and charges | only T1 and T2 appear in every read | db, role app |
| A-3 | A active in S1, waitlisted in S2 (position set), pending request on S3, left in S4 | S1 has venue; S2 area + waitlistPosition, venue null; S3 area, no position, no venue; S4 absent | db |
| A-4 | A charges: open, partial, paid, void; B charge in the same session | open and partial returned with amountDue, amountAllocated, remaining = chargeRemaining; paid, void and B's absent | db |
| A-5 | T2 charge whose ledger SUM differs from stored amount_allocated | T2 `unknown LEDGER_INCONSISTENT`; T1 known_amount; summary `unknown`, no partial total | db |
| A-6 | all clubs known_zero; then a read failure (stubbed pool error); then 201 open charges | summary known_zero; `unknown READ_FAILED retryable true`; `unknown TOO_MANY_OPEN_CHARGES` | db |
| A-7 | account with person_id NULL; account whose person is merged; person with no membership | 200, empty lists, charges summary known_zero | db + route |
| A-8 | A's memberships: left in T4, merged in T5 (each with an open charge) | T4/T5 not in clubs or sessions; their open charges ARE in charges (M-2) | db |
| A-9 | every DTO | exact key sets; seeded phone, pay_code, gender (if a column exists), B's name never in any JSON | db + route |
| A-10 | each route: 200, 401, 429, 500 | `cache-control` contains `no-store` on all; 200 is `private, no-store` | route |
| A-11 | GET with `?person_id=B&tenant_id=T3&membership_id=M` and a body | module called once with (pool, session accountId) only; same result as without | route |
| A-12 | catalog: the four 0059 functions | prosecdef true; proconfig search_path `pg_catalog, public, pg_temp`; provolatile 'v'; one uuid argument; owner = owner of person_profile_read | db |
| A-13 | ACL | no PUBLIC EXECUTE; `has_function_privilege('app', fn, 'EXECUTE')` true; app_worker and readonly false | db |
| A-14 | NOSUPERUSER NOBYPASSRLS owner context, A in T1 and T2, B in T1 | A's reads return A's T1 + T2 rows (the GUC loop works without bypass); B's never; owner without GUC reads 0 memberships (sanity) | db nobypass |
| A-15 | no session cookie | 401 AUTH_REQUIRED, module not called | route |
| A-16 | rateLimited mocked true | 429 RATE_LIMITED, module not called | route |
| A-17 | migrate twice | 60 applied then 60 skipped; tail is 0059 | db (count pins) |
| A-18 | regression: existing me routes, L8 join flows, tenant-lang walker | unchanged and green; walker classifies the four routes as "b" | web + db |

Decision-table rows: DT-1 no person or memberships -> A-7; DT-2 own open|partial with amounts, another person's charge never -> A-1, A-4;
DT-3 void and paid excluded -> A-4; DT-4 underivable -> unknown and unknown dominates -> A-5, A-6; DT-5 ids in query or body ignored -> A-11,
A-12 (one-argument signature); DT-6 left or merged membership not listed (UNPINNED, default active and guest) -> A-8; DT-7 venue only for
active, area + position for waitlisted or pending -> A-3; DT-8 unauthenticated -> A-15. Lane TESTS: cross-person -> A-1, A-14; cross-tenant
-> A-2; unknown dominates -> A-5; allowlist -> A-9; no-store -> A-10; account only from the session -> A-11; SQL review -> A-12, A-13 plus
the reviewer. Concurrency: reads only, no lock; the charges read is one REPEATABLE READ READ ONLY snapshot (A-6 covers its failure path).
Observability: no new event or metric; M-13 log line.

## 8. Test-only scope additions and harness rules (Q6)

- Count pins forced by 0059 (edit only these lines): `migrate.test.ts:53` (MIGRATION_COUNT 59 -> 60, comment) and `:769` (tail);
  `rls-invariants.test.ts:70`, `:1753` (59 -> 60), `:2036` (tail), `:4611-4614` (UCC-8 title, count, tail);
  `outbox-projector-registry.test.ts:115`, `:117`, `:120`.
- New test files: `packages/db/src/me-player-reads.test.ts`, `packages/db/src/me-player-reads-nobypass.test.ts`, and
  `apps/web/app/api/me/{clubs,sessions,charges,requests}/route.test.ts` (mock pattern `channels/route.test.ts:6-18`).
- Harness as is: `setupRlsTestContext` (one leased role password, reader lock inside), seeds via `ctx.owner`, runtime via `ctx.appPool`,
  `afterAll(ctx.teardown)` (settled teardown; the suite drops its own DB). The nobypass suite copies `identity-link-web-nobypass.test.ts:1-35`
  order exactly: `setupNonSuperuserOwnerContext(<own db name>)` (:27), then inside ONE `withJobDefinerLock(process.env.DATABASE_URL_TEST!, ...)`
  (:28-32): `bootstrapJobDefinerForOwner()` -> `bootstrapChatDefinerForOwner()` -> `runMigration()`; then `connectAsApp()` (:33) (P3-S1 D12:
  job definer shared first, then the chat-definer slot; never reordered). L9 tests never NAME identity_definer or chat_definer outside those
  calls.
- One DB suite, migration or e2e run at a time (S1 ENVIRONMENT lock). Re-run the role password step after a full run.

## 9. B3 budget (Q9)

- Default: about 300 LOC, 3 modules, 1 migration. Modules touched: `packages/db`, `apps/web` (2, within). Migrations: exactly one, 0059.
- Exception (LOC only), estimate: 0059 about 220, me-player-reads.ts about 200, index.ts about 20, four routes about 120 => about 560
  non-test; tests about 1000.
- Hard caps (`git diff --numstat dbdc061443ca18f9cdc1277916b720d92a1081ea..HEAD`, this readiness file excluded): non-test lines changed <= 650;
  test lines <= 1200; total <= 1850; files <= 17 (18 with this file); exactly one new file under `packages/db/migrations/`.
- Why a split breaks coherence: the four routes are the only callers of the four definers; definers without routes are app-executable dead
  code whose session-only account path is untested; routes without definers cannot exist; splitting by DTO needs two migrations (one per lane
  rule) and splits the isolation property, which is a property of the whole definer set (A-1, A-2, A-14).
- Compatibility proof (rolling deploy): 0059 only adds app-only functions; no existing table, policy, grant or function changes; old binaries
  never call them; the four routes are new paths; rollback = revert the PR (local-only, no shared DB holds 0059).

## 10. OPEN (out of scope for L9)

- D-L9-1 definer ownership: RESOLVED by orchestrator ruling D3 (P3-S5, binding): accepted as drafted = M-14 (migration-role owner + per-tenant
  GUC loop, same owner as 0051/0052/0055/0058; no new role, no identity_definer reuse). M-14 stays in the L17 owner sign-off list. A BYPASSRLS
  owner (reuse identity_definer, which changes the posture pinned by `identity-link-web.test.ts:932`, `:1007`, or a new role, which needs
  `db:bootstrap` and harness work) would need an owner ruling and a new step 0.
- Orchestrator ruling D1 (P3-S5, binding; shared file `apps/web/lib/tenant-lang.test.ts`): L9 adds ONLY its four route files as bucket "b"
  plus one comment line, directly after the line `"app/api/me/channels/[id]/detach/route.ts": "b",` wherever it sits at the base (:170);
  L4b adds its entries in disjoint hunks of the same file.
- O-1 Known limit: one indexed probe per tenant per call; fine for the local-only MVP; at scale the D-L9-1 alternative.
- O-2 BE edge #8 (left membership history) stays deferred (lane NEGATIVE SCOPE: no left history); M-2 still counts its open debt.
- O-3 For L12: sessions carry no occupancy (L7's formula is tenant-scoped TS), no price, and DTOs carry clubRef (slug), not the tenant id
  L8's command routes take from `?tenant=`; L12 resolves that or asks.
- O-4 `api-contract.ts` has no generic 5xx code (L4b owns the file), hence M-13.
- O-5 The spec rate-limit table names `/api/player/*` paths (BE :207-214); M-12 applies its numbers to `/api/me/*`.
- O-6 Pre-measure corrections: tenant-lang anchor :170 (not :169); 0009 table list spans :30-45.
- O-7 Gender measured by readiness reviewer #2: no migration at the base defines a gender column (`grep -n -i gender
  packages/db/migrations/*.sql` -> only the comment 0033:121, `gender_restriction ... NOT yet in the table`); A-9's exact key sets still
  cover any future column.

## 11. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = W HEAD = session base; every TARGET_FILES path exists at the base | PASS |
| 2 | Decisions in scope final | DD-135 signed `:1808`; M-1..M-16 pinned as defaults pending sign-off | PASS |
| 3 | Scope IN/OUT and owner clear | sections 4, 8; lane NEGATIVE SCOPE; L9 sole editor of index.ts, schema.ts and migrations in P3-S5 | PASS |
| 4 | Dependencies classified | L8 #68 merged at the base (0058 present); D3 signed | PASS |
| 5 | Live schema and code match | sections 2-3, measured at the base | PASS |
| 6 | Data, API, state, auth contract | sections 4.1-4.5 | PASS |
| 7 | Fail-closed, idempotency, order | 4.3 unknown rules; reads only; one snapshot for charges; deterministic ordering M-6 | PASS |
| 8 | Open questions in scope = 0 | section 5 pins; section 10 is out of scope | PASS |
| 9 | Acceptance matrix with expected results | section 7 | PASS |
| 10 | Migration, security, rollback | one additive migration; app-only EXECUTE; pinned search_path; nobypass proof A-14; rollback = revert | PASS |
| 11 | First slice hard dependencies merged | L8 #68 | PASS |
| 12 | Implementation handoff ready | sections 4-9; W clean at the base with deps installed | PASS |

## 12. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-17
AUTHORITY_SHA: dbdc061443ca18f9cdc1277916b720d92a1081ea
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/standards/review-code-readiness-gate.md
  - docs/features/FE/feature_player_view.md
  - docs/features/BE/feature_player_view_tech.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m9-join-core.md
  - package.json
  - packages/db/migrations/0000_roles_extensions.sql
  - packages/db/migrations/0001_global_directory.sql
  - packages/db/migrations/0002_tenants_core.sql
  - packages/db/migrations/0003_payments_ledger.sql
  - packages/db/migrations/0006_discovery.sql
  - packages/db/migrations/0009_rls_policies_grants.sql
  - packages/db/migrations/0014_players_waitlist.sql
  - packages/db/migrations/0024_public_visibility_capacity_check.sql
  - packages/db/migrations/0037_tenant_provision_rls_self_scope.sql
  - packages/db/migrations/0052_tenant_profile_definers.sql
  - packages/db/migrations/0054_link_code_reparent_empty_person.sql
  - packages/db/migrations/0055_me_settings_definers.sql
  - packages/db/migrations/0058_player_self_join.sql
  - packages/db/src/index.ts
  - packages/db/src/me-settings.ts
  - packages/db/src/me-settings.test.ts
  - packages/db/src/payment-manual.ts
  - packages/db/src/roster-money-shared.ts
  - packages/db/src/session-read.ts
  - packages/db/src/session-join-service.ts
  - packages/db/src/test-harness.ts
  - packages/db/src/migrate.test.ts
  - packages/db/src/rls-invariants.test.ts
  - packages/db/src/outbox-projector-registry.test.ts
  - packages/db/src/identity-link-web.test.ts
  - packages/db/src/identity-link-web-nobypass.test.ts
  - packages/core/src/api-contract.ts
  - packages/core/src/payments-logic.ts
  - apps/web/lib/me-route-gate.ts
  - apps/web/lib/api-envelope.ts
  - apps/web/lib/session-cookies.ts
  - apps/web/lib/tenant-lang.test.ts
  - apps/web/app/api/me/channels/route.ts
  - apps/web/app/api/me/channels/route.test.ts
  - apps/web/app/api/me/profile/route.ts
SLICE: p3-m9-me-reads
IN_SCOPE: person-scoped cross-club reads for the signed-in player through four account-keyed SECURITY DEFINER functions in one migration 0059 (my clubs, my sessions, my open charges with the one canonical remaining formula and unknown-dominates summary, my join requests), one db module with index exports, four GET routes under /api/me with private no-store, count-pin test updates and four tenant-lang bucket b entries
OUT_OF_SCOPE: any other person's roster, debt, charge or name; buddy pay; host receivable; paid, void or left history; magic link; chat /pay; pages (L12); tenant-admin shortcut; api-contract.ts, session-service.ts, session-command-route.ts (L4b); api-envelope.ts; decisions.md and Reviewed specs; schema.ts and db.dbml (no change needed); any new role or db:bootstrap change
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: L8 #68 merged dbdc061443ca18f9cdc1277916b720d92a1081ea (probe 0058_player_self_join.sql); DD-135 signed
PRIOR_SLICES: L8 p3-m9-join-core (#68)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # one additive migration; migration-role definers with a per-tenant GUC loop, explicit tenant predicates, pinned search_path, app-only EXECUTE; nobypass proof A-14; opus/max reviewer + opus/max security round
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: section 6 steps 1-2 - GitNexus impact, then the count pins and the 0059 catalog and isolation tests red before writing packages/db/migrations/0059_me_player_reads_definers.sql
REMAINING_BLOCKERS: none
```
