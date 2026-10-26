<!-- review-readiness: code-ready -->

# Step-0 readiness: L48 p4-session-commands-authz-recheck (session P4-S4a)

> Agent-facing. Step-0 readiness readers, all opus/high, one live at a time: RA (Q1 the gate order of the eight commands, Q6 the
> in-transaction rollback), RB (Q2 the lock-order table and the writers of `tenant_admins` and `tenant_capability_grants`), RP (the
> two-connection scratch probe of Q2), RC (Q3 the guest-note host path, Q5 the route's person, Q6 the route-side mapping), RD (Q4 the call
> sites and edit shapes, Q7 the fixtures and lock-test patterns). This file was written by the step-0 readiness-file writer (opus/high).
> Writers W1, W2, W3a, W3b opus/high; the mechanical call-site edits (O1) and the backlog rows (O2) by the orchestrator. Reviewers opus/max
> one after another (R1a, R1b) plus a security reviewer (SEC) opus/max, at most 3 rounds counting pre-push rounds. RISK: P1 (an
> authorization gate and a required-parameter signature change across a shared choke point; security round required). Base
> `d1154dbc5ad72ba084ff954f37876f2651970e7f` (main, the merge of PR #125; migration tail 0073); branch
> `feat/p4-session-commands-authz-recheck`; worktree `.autopilot/worktrees/p4-session-commands-authz-recheck`; HEAD = base at step 0
> (measured). Every `path:line` below was MEASURED at the base on the source text; the lock facts were also measured by a two-connection
> probe on the scratch database `l48_scratch_base` (migrated at the base, run under the lane lock, dropped at the end). The readers' notes
> live outside the repo, so this file restates every fact it relies on. No tracked file was edited at step 0; no DB suite ran.

Short forms: SS = `packages/db/src/session-service.ts`; R = `apps/web/lib/session-command-route.ts`; TCA =
`packages/db/src/tenant-capability-authority.ts`; TCAT = `packages/db/src/tenant-capability-authority.test.ts`; RMS =
`packages/db/src/roster-money-shared.ts`; sjs = `packages/db/src/session-join-service.ts`; SS-test = `packages/db/src/session-service.test.ts`;
M72 = `packages/db/migrations/0072_member_name_definers_qualify_builtins.sql`; a bare `NNNN:line` is the migration with that number under
`packages/db/migrations/` (0047 = `0047_tenant_capability_authority_core.sql`, 0049 = `0049_tenant_capability_authorize.sql`). Locks: SH = FOR
SHARE, UPD = FOR UPDATE, NKU = FOR NO KEY UPDATE, adv = transaction-scoped advisory lock.

## 1. Authority

- **DD-150** (`docs/standards/decisions.md`): the owner's written approval of 2026-10-26, verbatim `Phase 4 plan approved, Q1-Q10 default`.
  It approves `docs/sessions/web-mvp-phase4-plan.md`, whose section 3 row L48 is this lane (line numbers of both files not re-measured here).
- **The plan row L48**: this lane. The plan's alternative (close the row with evidence, no code) is FALSE by measurement: SS calls no plain
  `authorize(` (section 2.1). The plan's size "0-200 LOC, 2 module" counts no test churn: the plan-level gap D38 (section 9).
- **The backlog row** `session-commands-actor-recheck-under-lock` (`docs/autopilot-backlog.md:5742`; `status: planned`, P1,
  `merged_probe: packages/db/src/session-service.ts :: actorRecheckUnderLock`): the pre-existing contract. This lane implements it and
  changes no contract; the probe symbol is absent at the base and exists after W1.
- **The BE spec** section "Actor-recheck-under-lock" (`docs/features/BE/feature_tenant_routing_authz_tech.md`): the owner-accepted DD-56
  design the row implements. Step 0 did not re-read it and this file quotes none of its text. The property as the code states it, TCA:10-19
  (verbatim core): "`tx` must be an already-open `withTenant` transaction. The definer's FOR SHARE locks on the actor's tenant_admins row (and
  grant row) live until the CALLER's commit, which is the actor-recheck-under-lock property; this function never opens a transaction." The
  gap this lane closes, R:58-62: "A role deactivation that commits in between is not seen by the command: the in-command actor re-check under
  the command's own row locks (the `actor-recheck-under-lock` invariant) is NOT implemented here -- it is the backlog slice
  `session-commands-actor-recheck-under-lock`, which changes the commands' signatures. Until then the window is one request long."
- **RO-L48-1** (decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature): item 2 pre-approves the Tier B
  defaults D1-D7 (section 5); item 3 sets B3 as an estimate with a logged overrun up to 1,100 test lines and 40 files (section 9).
- **The owner's concurrency rule** (2026-10-26 22:45, C20): every earlier lane is merged; main does not move while this lane runs.
- Provenance: D1-D16 are "default applied, pending owner sign-off" (section 5); nothing here is an owner signature.

## 2. Measured at base

### 2.1 Q1: decision table {command} x {gate order}

Common to all eight: exactly one `withTenant(` per command (SS:272, :498, :890, :1241, :1954, :2254, :2809, :3030), none nested; the advisory
key `pg_advisory_xact_lock(hashtextextended('processed-command:' || tenantId::uuid::text || ':' || commandId, 0))`; the dedup read
`select command_type, result_ref from processed_commands where tenant_id=$t and command_id=$c`; a replay only when the type matches and the
envelope is valid (and, for publish/announce/update/close/cancel, the same session), otherwise `COMMAND_ID_CONFLICT`. SS imports only
`authorizeTenantAction` (SS:12), called at SS:511, :694, :899, :1441, :1962, :2264; `grep -n 'authorize(' packages/db/src/session-service.ts
| grep -v authorizeTenantAction` prints nothing at the base. The five tenant-denial classes all carry the code `TENANT_SUSPENDED`.

| command | person today | opener; first statement | advisory; dedup; replay returns | tenant gate | locks in order | tenant denial | first write | after commit |
|---|---|---|---|---|---|---|---|---|
| createSession SS:266 | none (params SS:87-91) | SS:272; advisory SS:278-280 | SS:278-280; SS:284-311; `{sessionId, visibility, status, version, replayed: true}` SS:298-304 | none (header SS:30-32, DD-105) | adv only | none (SessionCommandError SS:53) | INSERT sessions SS:327-328 | nothing (outbox SS:356, ledger SS:371-373 in the tx) |
| publishSession SS:493 | none (SS:453-457) | SS:498; `authorizeTenantAction(tx, tenantId, "publish_new_sessions")` SS:511 | SS:543-545; SS:556-583; envelope + replayed SS:575-581 | SS:511 upfront; SS:694 again under the session lock | tenants SH, subs SH SS:511 -> adv SS:544 -> sessions UPD SS:596-601 -> re-check SS:694 | SessionPublishAuthorizationError SS:433 | ledger SS:618-620 (no-op) or UPDATE sessions SS:719-720 | nothing (outbox SS:738, ledger SS:753-755) |
| announceSession SS:879 | `requestedByPersonId` SS:849; pre-tx UUID check SS:886-888; lowercased SS:889 | SS:890; `authorizeTenantAction(tx, tenantId, "announce_session")` SS:899 | SS:942-944; SS:950-973; `{sessionId, channel, replayed: true}` SS:967 | SS:899 | tenants SH, subs SH SS:899 -> delivery-guard read SS:909-915 -> adv SS:943 -> sessions UPD SS:984-988 | SessionAnnounceAuthorizationError SS:805 | INSERT outbox SS:1028 (payload `requested_by_person_id` SS:1034) | nothing (ledger SS:1038-1040) |
| updateSession SS:1235 | none (SS:1161-1165) | SS:1241; pure-JS checks SS:1245-1250, first DB statement adv SS:1260-1262 | SS:1260-1262; SS:1274-1302; `{sessionId, status, version, visibility, replayed: true}` | SS:1441 only when `current.status === "open"` (SS:1440) | adv SS:1261 -> sessions UPD SS:1368-1388 -> tenants SH, subs SH SS:1441 -> players UPD (promoteFromWaitlist SS:1721, sjs:565) | SessionUpdateAuthorizationError SS:1123 | ledger SS:1524-1526 (no-op) or UPDATE sessions SS:1631-1632 | nothing (outbox SS:1678, :1695; fence SS:1659-1664; ledger SS:1729-1731) |
| closeSession SS:1949 | none (SS:1888-1892) | SS:1954; `authorizeTenantAction(tx, tenantId, "close_session")` SS:1962 | SS:1975-1977; SS:1981-2006; `{sessionId, status, version, replayed: true}` | SS:1962 | tenants SH, subs SH SS:1962 -> adv SS:1976 -> sessions UPD SS:2010-2014 | SessionCloseAuthorizationError SS:1868 | ledger SS:2026-2028 (no-op) or UPDATE sessions SS:2066-2067 | nothing (fence SS:2078, outbox SS:2082, ledger SS:2096-2098) |
| cancelSession SS:2245 | none (SS:2149-2153) | SS:2254-2257; `authorizeTenantAction(tx, tenantId, "cancel_session")` SS:2264 | SS:2277-2279; SS:2283-2317; envelope + replayed, or a stored refusal rethrown in the tx SS:2301-2306 | SS:2264 | tenants SH, subs SH SS:2264 -> adv SS:2278 -> sessions UPD SS:2320-2324 | SessionCancelAuthorizationError SS:2129 | ledger SS:2342 (no-op); draft anomaly: outbox SS:2440 + ledger SS:2461; else UPDATE sessions SS:2477 | YES: the `{ anomalyRefusal: true }` sentinel throws `CANCEL_REQUIRES_REVIEW` SS:2531-2536; else returns SS:2537 |
| createGuestNote SS:2804 | `actorPersonId` required (SS:2591-2597) | SS:2809; input and actor checks, reserve SS:2826 | `reserveGuestNoteCommand` SS:2743 (adv SS:2748-2750, dedup SS:2752-2759), actor-bound replay | none (header SS:2799-2802) | adv -> sessions UPD SS:2853-2861 | none (SessionGuestNoteError SS:2565) | INSERT session_guest_notes SS:2961 | nothing (outbox SS:2975, ledger SS:2995) |
| deleteGuestNote SS:3025 | `actorPersonId` required (SS:2604-2609) | SS:3030; checks, reserve SS:3046 | the same helper; actor-bound replay SS:3047-3063 | none | unlocked note read SS:3067-3075 -> sessions UPD SS:3084-3088 | none (SessionGuestNoteError) | DELETE SS:3098 | nothing (outbox SS:3110, promoteFromWaitlist SS:3133, ledger SS:3136) |

Insertion point of `await actorRecheckUnderLock(tx, { tenantId, actorPersonId })` (D2): the line directly after the callback opener, SS:272
(create), :498 (publish), :890 (announce, with the lowercased value of SS:889), :1241 (update, ahead of the pure-JS checks), :1954 (close),
:2257 (cancel). Nothing inside any callback moves. publish's upfront gate SS:511 is inside the mutating transaction opened at SS:498
(SS:505-507: "takes locking reads on THIS tx ... they PERSIST to commit"); the only earlier transaction is the route's gate.

### 2.2 Q3: guest notes, `NO_HOST_PATH`

- Both guest-note routes (`apps/web/app/api/sessions/[id]/guest-notes/route.ts:46-90`, `.../guest-notes/[noteId]/route.ts:51-86`) call
  `handleSessionCommand(request, {bucket}, handler, { guestNoteSessionId: id })`; neither calls `mayManageSessions` nor branches host vs
  guest. A `session.manage` holder passes the gate R:264 and skips the association proof; anyone else needs `guestNoteTenantForPerson`
  (R:178-179). Either way the command decides on association only.
- createGuestNote: reserve SS:2826 (actor-bound replay, doc SS:2619-2626) -> sessions UPD SS:2853-2861 -> the active-player proof under the
  lock SS:2878-2892 (an `active` players row of the session joined to the actor's membership) -> `PLAYER_NOT_ACTIVE` SS:2891.
- deleteGuestNote: reserve SS:3046, actor-bound replay SS:3047-3063 -> unlocked note read SS:3067-3075 -> authorship check
  `NOT_NOTE_CREATOR` SS:3079-3081 -> sessions UPD SS:3084-3088 -> delete with RETURNING.
- Neither command branches on `session.manage`, a role or a host. `session.manage` never grants guest-note authority, so revoking it cannot
  change that authority. Verdict `Q3: NO_HOST_PATH`: no code in either command or either guest-note route (D9).

### 2.3 Q5: one read of the person; the void condition does not fire

- Person: R:237 `const session = await currentSession();` -> `apps/web/lib/session-cookies.ts:179-183` (cookie -> `resolveWebSession`) ->
  `packages/db/src/auth.ts:77-101` (definer `auth_resolve_web_session`, returns `personId`). Every `currentSession()` is a new DB read.
- Gate: R:264 `if (!(await mayManageSessions(tenantId, session.personId))) {` uses that same `session` object; `mayManageSessions`
  (R:120-126) runs one short `withTenant` with R:122 `authorize(tx, { tenantId, action: SESSION_ACTION, actorPersonId: personId })`.
- The non-manager branch R:264-276 admits a caller only when the route opts in (`associatedTenant` R:173-186: `guestNoteSessionId` or
  `selfService`); the six host routes pass no options, so only `session.manage` holders reach the six host commands.
- `SessionCommandContext` (R:223-229) is `{ tenantId; commandId; body; lang }`, no person; built once (R:346), consumed once by
  `handleSessionCommand` (R:837-855, R:843 and R:848). Its other consumers (ten session and join-request routes besides the eight command
  routes) only read it, so a new field is additive.
- Second read today: the announce handler re-reads `currentSession()` (`apps/web/app/api/sessions/[id]/announce/route.ts:28-29`) and passes
  that value (:35); the guest-note handlers do the same (create :56, delete :58). D7 removes the announce re-read: the gated person is the
  commanded person (one read).
- Void condition: the only non-test callers are the six host routes and the two guest-note routes, all web, all behind `currentSession()`,
  CSRF (R:237-241) and `authorize()` or the opted-in association; `apps/bot` has zero non-test hits; nothing outside `apps/` and `packages/`
  calls them. No bot, webhook, public link, service token or cron caller: not triggered.

### 2.4 Q6: mapping and rollback

- Status table R:508: `["FORBIDDEN", 403]` R:515, `["TENANT_SUSPENDED", 403]` R:556. Copy: the FORBIDDEN pair R:621-624 (English half "You
  are not permitted to do this."); the gate's own 403 (R:269-273) uses a different pair (English half "Not permitted for this club.").
- Mapper `mapSessionCommandError` (R:750-804): the `instanceof` chain R:751-763 (the five tenant classes R:759-763), R:764 returns null for a
  non-domain error, R:766 reads `.code`, R:789 `isApiErrorCode`, R:803 `err(code, ...)`. Catch-all: `handleSessionCommand` R:846-853
  rethrows an unmapped error, which surfaces as Next's generic 500 (doc R:745-749); an `authorize()` rethrow takes this path.
- Minimal edit (D6): `SessionActorNotAuthorizedError` in the `@plexco/db` import block (R:3-20) and one `instanceof` line in R:751-763; no
  table row and no copy, because `FORBIDDEN` is already a registered code.
- Rollback: no try/catch inside any of the eight callbacks (the only try/catch in SS is SS:155/:158 inside the validator `isValidTimezone`
  SS:154). `withTenant` (`packages/db/src/tenant.ts:62-72`): `assertTenantId` (:67) before the transaction, then `db.transaction` running
  `set_config('app.tenant_id', ..., true)` and `fn(tx)` (:68-71), no catch: a throw rolls back and rethrows the same error object, and the
  local GUC dies with it. SS already relies on this (SS:2251-2253, SS:2426).
- So the helper runs as statement 2 of the transaction, after `set_config`, which the definer needs (it binds the tenant to `app.tenant_id`,
  0049:60-69).
- cancelSession: the sentinel (SS:2467) is returned only on the draft-anomaly branch after its writes (SS:2440, SS:2461) and thrown after
  commit (SS:2531-2536). A recheck throw as the first statement aborts before SS:2264: no outcome object exists and the tail never runs.
- For all six: a throw as the first statement precedes every write of section 2.1 (no sessions change, no processed_commands row, no outbox
  row, no fence, no waitlist promotion) and the advisory lock is never taken.

### 2.5 Q4: call sites

Non-test: the six host routes are the only callers of the six db commands: `apps/web/app/api/sessions/route.ts:29` (create),
`[id]/publish/route.ts:33`, `[id]/announce/route.ts:32`, `[id]/route.ts:38` (update), `[id]/close/route.ts:34`, `[id]/cancel/route.ts:35`
(under `apps/web/app/api/sessions/`); definitions SS:266, :493, :879, :1235, :1949, :2245; exports `packages/db/src/index.ts:160-165`.
`apps/web/lib/sessions-api.ts:188` and `:195` are web CLIENT functions of the same names, not the db commands. No bot, worker or script caller.

Tests (`git grep -c -w`): 199 lines in 18 files; 28 DIRECT db call sites in 7 files:

| file | lines | direct sites | actor for the new parameter | fixture today |
|---|---|---|---|---|
| SS-test | 63 | 19: create 10, publish 3, announce 2, update 1, close 2, cancel 1 (helpers :125, :128, :732, :1555, :2334, :4217, :4701) | a new file-scope `ACTOR` | NO authorized person: ctx.tenantA (`test-harness.ts:745-750`, plain tenants insert, no persons, no admins); `seedTenant` x5 (:651, :1476, :2249, :4085, :4572) and `seedEligibleTenant` (used :1173, :1223); announce `HOST` (:1518) is a bare UUID |
| `packages/db/src/session-close-cancel-money-policy.test.ts` | 6 | 2: helpers close :107, cancel :113 | `w.actor` (World :44) | `world()` :49-50 |
| `packages/db/src/member-name-invisible-chars.test.ts` | 7 | 2: create :2454, update :2503 | `host` (:49) | admin insert :75 |
| `packages/db/src/outbox-projector-registry.test.ts` | 4 | 2: cancel :972, publish :1102 | an admin to add | NO authorized person: local `seedTenant` (use :934) |
| `packages/db/src/join-request-service.test.ts` | 4 | 1: update :655 | `host` | `world()` :97-100 |
| `apps/web/lib/realtime-listener-db.test.ts` | 2 | 1: update :92 | the person inserted at :63 | admin insert :63 |
| `apps/bot/src/projectors/zalo-dm.test.ts` | 3 | 1: announce :435 | `host.person` (already the requester :438) | `c.tenant`; admin status: check 5 below |

Route tests mocking `@plexco/db` (6): `apps/web/app/api/sessions/route.test.ts` (21 lines; mock :21; assertion :130, `mock.calls` reads
:138, :146, :240, :244), `[id]/publish/route.test.ts` (11; :24; :120), `[id]/announce/route.test.ts` (10; :23; :105, :144 reads the channel),
`[id]/route.test.ts` (14; :24; :136), `[id]/close/route.test.ts` (15; :23; :99), `[id]/cancel/route.test.ts` (13; :23; :99). Also
`apps/web/lib/session-command-route.test.ts` (5; mock :52; no argument assertion; `mockRejectedValue` :883, :909): test (e) goes here. Zero
direct db calls, not edited, expected green: `apps/web/lib/session-guest-note-route-db.test.ts` (route handlers aliased :11-15, real DB
through the routes, which pass the gated person), `apps/web/lib/sessions-api.test.ts` (client), `packages/db/src/rls-invariants.test.ts` (a
file-local SQL helper named createSession :1884), `packages/db/src/authorization.test.ts` (comment :330).

Edit shapes of the 28 sites (O1 applies the uniform ones; W3a the rest):

- S1 one line `{ tenantId, commandId, input }` (SS-test :733, :2334, :4217, :4701) -> `{ tenantId, actorPersonId: ACTOR, commandId, input }`.
- S2 one line with an explicit tenant (SS-test :125, :627): after `tenantId: <x>, ` insert `actorPersonId: ACTOR, `.
- S3 own line `tenantId: ctx.tenantA,` (SS-test :129, :177, :273, :484, :542, :630; member-name :2455, :2504): a new line after it, same
  indent, `actorPersonId: ACTOR,` (member-name: `host`).
- S4 own line `tenantId,` (SS-test :845, :5222; realtime :93; join-request :656; outbox :973; SS-test :1439 and :1459 probably the same,
  check 7): a new line `actorPersonId: <expr>,`.
- S5 `tenantId: w.tenantId,` (money-policy :108, :114): a new line `actorPersonId: w.actor,`. S6 `tenantId: t,` (outbox :1103): a new line
  with the outbox admin.
- Irregular (W3a): SS-test :511-512 (`const up = { tenantId: ctx.tenantA.toUpperCase(), commandId, input: input() };` gets the actor at
  :511). The three announce sites need NO call-text change (SS-test helper :1550-1555 defaulting to `HOST`, SS-test :1738-1741, zalo-dm
  :435-440): announce keeps `requestedByPersonId`; `HOST` is re-pointed to `ACTOR`.

### 2.6 Implementation-time checks (for the writers; not open questions)

Each was left unmeasured at step 0 by budget; each has one command and none changes the design:

1. `seedEligibleTenant`'s definition: `git grep -n -e 'function seedEligibleTenant' -- packages/db/src/session-service.test.ts`.
2. outbox's local `seedTenant` and the builder of `t` (:1076-1102): `git grep -n -w -e seedTenant -- packages/db/src/outbox-projector-registry.test.ts`.
3. join-request `host` in scope at :655: `sed -n '636,656p' packages/db/src/join-request-service.test.ts`.
4. realtime's person name at :63: `sed -n '55,66p' apps/web/lib/realtime-listener-db.test.ts`.
5. Whether `host.person` is an active web admin of `c.tenant`: `git grep -n -w -e host -- apps/bot/src/projectors/zalo-dm.test.ts`; if not,
   the fixture gains the admin insert (the file is then edited).
6. The six route assertions: `git grep -n -A6 -e 'toHaveBeenCalledWith(expect.anything(), {' -e 'expect(createSession).toHaveBeenCalledWith('
   -- 'apps/web/app/api/sessions/**'`; each gains `actorPersonId` equal to the mocked web session's person (the route tests also mock
   `authorize`, route.test.ts:1); announce's argument already carries the requester.
7. SS-test :1439 and :1459 are shape S4 (verify before the apply script counts them).
8. SS-test C2 (:510-512) sends an upper-case tenant UUID: confirm `authorize()` accepts it (TCAT:328-357 cover the UUID check and the GUC
   binding), else C2 turns into a 403.
9. `ACTOR` (and `HOST`) must be real persons rows: TCAT always inserts the person first (`person()` TCAT:47-53, `admin()` TCAT:54-62).
10. The clerk flake list's ACTIVE lines against the lane's test files, before the first suite run.
11. The roster and money locks of close/cancel after sessions UPD (not needed by the verdict: no admin or grant writer locks them):
    `sed -n '1949,2540p' packages/db/src/session-service.ts | grep -n -i -e 'for update' -e 'for share' -e '\.for(' -e 'advisory'`.

## 3. Q2: lock order

### 3.1 What the two gates lock

- `authorize()` (TCA:35; params TCA:26-30; decision TCA:23-24): TCA:36 `assertTenantId` throws; TCA:37-39 a non-string or non-UUID actor
  returns `{ allowed: false, reason: "not_a_member" }`; TCA:40-42 a non-string action returns `unknown_action`; TCA:45-48 one SELECT of
  `tenant_capability_authorize(...)`; RETHROWN: a query error, a malformed row (TCA:51-53), allowed without a recognised role (TCA:57-60).
  TCA is a leaf module (imports only `sql`, `Tx`, `assertTenantId`, TCA:1-3), so importing it into SS adds no cycle.
- The definer has one definition (0049:44; 0062:151 and 0063:108 are GRANT EXECUTE only): tenant binding 0049:60-69 and the registry read
  0049:72-74 (no lock); 0049:82-88 `SELECT ta.role ... FROM public.tenant_admins ta WHERE ... AND ta.active FOR SHARE`;
  `IF v_class = 'preset' THEN ... RETURN` 0049:109-111; the grant read FOR SHARE with `clock_timestamp()` (0049:113-120) runs only for an
  `owner_grantable` action.
- `session.manage` is preset: 0047:77 `('session.manage', true, false, 'preset'),`. The recheck takes EXACTLY ONE lock, the actor's
  `tenant_admins` row FOR SHARE; `tenant_admins` has no expiry column (0002:160-169); a revoke is `active = false`, a row delete or a
  lookup-hash change.
- `authorizeTenantAction` (`packages/db/src/authorization.ts:153`): tenants SH through `resolve_tenant_status_locked` (:166-167 -> 0027:29),
  then subscriptions SH through `resolve_subscription_locked` (:202-203 -> 0038:55-58); the order is pinned at :104-112.

### 3.2 Writers

- Search (non-test): `git grep -n -i -E -e '(insert into|update|delete from) +(public\.)?(tenant_admins|tenant_capability_grants)' -e
  '\.(insert|update|delete)\((schema\.)?(tenantAdmins|tenantCapabilityGrants)' -- packages apps ':!*.test.ts' ':!*.spec.ts'` -> 8 hits, all
  `INSERT INTO tenant_admins`; zero UPDATE or DELETE of `tenant_admins`; zero writes of `tenant_capability_grants`; no ON DELETE CASCADE
  into either (0002:162, 0047:101-105).
- W1 `tenant_provision` (M72:253, the newest of six definitions) inserts only rows of the tenant it creates (the owner's admin row
  M72:317-318); its conflict path reads without a lock and writes nothing (M72:284-309). The app role's DML grant on `tenant_admins`
  (0009:32, 0009:57) is used by no code path. Grants: 0047:126-127 revoke the app's DML; no definer writes them. Test and dev seeds only
  (`roster-money-fixtures.ts:47`, imported only by test files; `dev-seed-club-members.ts:68`); revoke shapes only in TCAT:409-410, TCAT:438.
- So no runtime transaction revokes an admin or a grant at the base: the revoke of threat items (1)-(2) is out-of-band SQL today (W4) or a
  future writer.
- Spanning writers with an exclusive tenants lock: W2 `tenant_profile_update` (M72:337, called by `club-config.ts:60`) and W3
  `tenant_public_alias_set` (M72:747); both take the admin row SH FIRST (club-config.ts:61 and M72:368; M72:796). subscriptions has no
  runtime exclusive writer (0038:64 revokes the app's DML). W5 = the roster and money writers through `requireActor`: RMS:81-82 "Actor gate,
  run FIRST inside the command transaction (actor recheck under lock)", RMS:95-98 `authorize()` per action, then RMS:99
  `authorizeTenantAction`. promoteFromWaitlist (sjs:535) locks players only (sjs:565).

### 3.3 Table (placement A: the actor first)

| row | lock 1 | lock 2 | lock 3 | lock 4 | lock 5 |
|---|---|---|---|---|---|
| createSession | admins SH (new) | adv SS:278-280 | dedup read (no lock) | INSERT sessions (new row) | - |
| publishSession | admins SH (new) | tenants SH, subs SH SS:511 | adv SS:544 | sessions UPD SS:596-601 | tenants/subs SH re-check SS:694 (held) |
| announceSession | admins SH (new) | tenants SH, subs SH SS:899 | adv SS:943 | sessions UPD SS:984-988 | INSERT outbox |
| updateSession | admins SH (new) | adv SS:1261 | sessions UPD SS:1368-1388 | tenants SH, subs SH SS:1441 (open only) | players UPD (SS:1721 -> sjs:565) |
| closeSession | admins SH (new) | tenants SH, subs SH SS:1962 | adv SS:1976 | sessions UPD SS:2010-2014 | roster/money rows (after sessions) |
| cancelSession | admins SH (new) | tenants SH, subs SH SS:2264 | adv SS:2278 | sessions UPD SS:2320-2324 | the same |
| W1 tenant_provision | INSERT tenants (new) | INSERT memberships | INSERT admins (new) | INSERT subscriptions (new) | INSERT onboarding_runs |
| W2 profile update | admins SH | adv club-config | tenants SH, subs SH | adv processed-command | tenants NKU (upgrade) |
| W3 alias set | admins SH | adv club-config | tenants UPD | UPDATE tenants | INSERT outbox |
| W4 revoke (out-of-band, TCAT:409-410) | admins NKU (`UPDATE tenant_admins SET active = false`) | - | - | - | - |
| W5 roster/money | admins SH (+ grant SH for money.correct) | tenants SH, subs SH | adv | sessions UPD | players/charges/allocations |

Pairs: vs W1 disjoint (rows of an uncommitted new tenant only). vs W2/W3 the same order (admins before tenants); the only conflict is the
tenants row (command SH vs writer NKU/UPD), which the writer takes after its admins SH, holding only SH locks and advisory keys the command
never takes: a wait, never a cycle. vs W4 trivially ordered: the command asks for the admin row holding nothing, W4 holds nothing else; even a
future revoke that locks the admin row first and then sessions or tenants/subscriptions cannot cycle with A. vs W5 the same order, different
advisory keys. updateSession becomes actor -> adv -> sessions -> tenants/subs (open only): the D-14 inversion (SS:1422-1431) is unchanged and
still non-deadlocking, because no writer takes tenants/subscriptions exclusively and then sessions. Placement B (tenants/subs SH before the
admin row) is rejected: it inverts the writers' order (RMS:81-82) and would cycle with a future revoke that holds the admin row exclusively
and then wants tenants/subscriptions.

`LOCK_ORDER: NO_CYCLE` (placement A): every admin and grant lock in the system is FOR SHARE except the out-of-band single-statement revoke;
the only runtime spanning writers (W2, W3) take the admin row SH before tenants; A takes the actor lock first, holding nothing.

### 3.4 Probe (two connections, scratch database `l48_scratch_base`)

- Create: migrations rc=0, tail `0073_member_name_length_cap_120.sql`; server 16.15, `deadlock_timeout=1s`, `lock_timeout=0`, the
  database's deadlock counter 0 before the run. Fixture (committed rows on the scratch database only): an actor and an owner person, a
  `tenant_provision` tenant (shape TCAT:470), the actor as an active co_admin (the TCAT:57-58 insert), one sessions row; counts `admins=2
  subscriptions=1 sessions=1`; under the tenant GUC `authorize(session.manage)` and `authorize(content.manage)` both return allowed, role
  co_admin. Per case: connection A, then B one second later, a read-only third connection snapshotting the waiters (`pg_stat_activity`,
  `pg_locks`, `pg_blocking_pids`); every case file sets `statement_timeout = '30s'` as a wedge guard (never reached).
- P1 (A = the recheck then a 4 s sleep; B = `SET lock_timeout = '2s'` and the revoke): B `ERROR: 55P03: canceling statement due to lock
  timeout` after 2.151 s, waiting on a transactionid with the tuple lock on `tenant_admins`; A committed (4.112 s).
- P2a (A = recheck, tenants SH, subs SH, adv, sessions UPD, 4 s sleep; B = the revoke, no lock_timeout): B's `UPDATE 1` 1 ms after A's
  commit, then ROLLBACK (3.106 s); no error.
- P2b (B = W2's sequence: recheck for content.manage, tenants SH, subs SH, `UPDATE tenants SET name = name`): B's SH locks with no wait (SH
  vs SH); its UPDATE waited until 2 ms after A's commit (3.069 s); no error. pg_locks shows no tuple row here because B is already a
  multixact member; the transactionid wait on A identifies the tenants row.
- P2c (B first, the revoke held 4 s, ROLLBACK): A's recheck waited until 2 ms after B's rollback, returned allowed, committed (7.128 s).
- P2d (B first, W2's UPDATE tenants held, ROLLBACK): A's recheck passed with no wait (SH vs SH); `resolve_tenant_status_locked` waited
  until 1 ms after B's rollback; A committed (7.096 s).
- After every case and at the end: one active actor row, no other backend in the database, deadlock counter 0; the only ERROR in the log is
  the P1 55P03; no 40P01. `PROBE: NO_CYCLE_CONFIRMED`. Not covered (by design of the probe): placement B, W3, the owner_grantable grant
  path, a COMMITTED revoke (test (b) covers the last). Drop: `### dropped l48_scratch_base`, the database count back from 9 to 8.

## 4. Lead corrections

1. Lead (1)/(2)/(8) "the FOR SHARE locks on the actor's tenant_admins row and grant row": for `session.manage` (preset, 0047:77) the recheck
   locks only the `tenant_admins` row (0049:82-88); the grant branch (0049:113-120) never runs and no `clock_timestamp()` is read (D12).
2. Lead (9)(b) "a grant that expires while the command waits": unreachable for `session.manage` (no grant row, no expiry column,
   0002:160-169). The analogue: a revoke COMMITTED while the command waits on the admin row lock; the definer re-reads `ta.active`
   (0049:87) after the wait and denies (D14).
3. Lead (9)(c) "modelled on the existing lock tests": TCAT:392-419 nests the revoke inside the caller's own `withTenant`; the commands own
   their transaction, so test (c) needs a barrier (precedent SS-test CONC2 :1213-1215, `LOCK TABLE outbox_events IN ACCESS EXCLUSIVE MODE`
   in a separate transaction).
4. Lead (8) "a revoke that holds the admin or grant row and then wants a session or subscription lock": no such runtime writer exists; the
   only runtime writer of `tenant_admins` is W1's INSERT for a new tenant (M72:317-318); grants have none (0047:126-127).
5. Lead (8) "list every writer": the order of the close header SS:1941-1942 ("tenant authorization reads (tenants/subscriptions FOR SHARE;
   the writers' capability grants FOR SHARE) -> per-command advisory lock -> sessions FOR UPDATE") puts capability after tenants, while the
   writers it describes take capability first (RMS:81-82, RMS:95-99). Harmless (all SH); W1 rewrites the comment (D13).
6. Lead (3) the update comment is SS:1422-1431, not :1423-1428, and it does not simply accept the inversion: "documented not changed ... the
   future Daily Lifecycle suspend job WOULD" deadlock, "and the fix belongs to that lane" (row audit-2026-09-06-d14-lock-order-publish-vs-update).
7. Lead (3) deleteGuestNote does not require an active player: it checks authorship (SS:3079-3081) on an unlocked note read before the
   session lock (SS:3084-3088); only createGuestNote proves an active player, under the lock (SS:2853-2861, SS:2878-2892).
8. Lead (2) `mayManageSessions` is R:120-126 (doc R:115-119), not :116-123; `SESSION_ACTION` (R:97) is used only at R:122;
   `mayManageSessions` has three more consumers (`apps/web/lib/realtime-auth.ts:81`, `:101`; `apps/web/lib/session-read-route.ts:62`).
9. Lead (4) `SessionCommandContext` is R:223-229; announce (:28) and the guest-note routes (create :56, delete :58) pass a person from a
   second `currentSession()` read, not from the gate's read.
10. Lead (5) "the literal gets ONE definition": six module-local `session.manage` literals already exist in packages/db
    (`join-request-service.ts:103` and `:435`, `payment-manual.ts:260`, `payment-reversal.ts:66`, `public-session-share-link.ts:24`,
    `roster-service.ts:79`) plus the SQL registry 0047:77. The new constant is the one source for SS and R only; the six stay (outside FILE
    OWNERSHIP) and become one backlog row (D5, D15).
11. Lead (5) "the EXISTING FORBIDDEN 403 and copy": R has two FORBIDDEN copies, the gate's (R:269-273) and the mapper's (R:621-624); the
    `instanceof` line yields the mapper's (D6). Threat item (7) holds for the code and the status, not for the text.
12. Threat item (4) groups "an unknown action" with the rethrow: in the primitive an unknown action is a domain denial (TCA:14, TCA:40-42),
    so it becomes the 403, never an allow; only a query error, a malformed row (TCA:51-53), allowed without a role (TCA:57-60) or a bad
    tenant id (TCA:36) rethrow (5xx). A malformed actor id is `not_a_member` (403, TCA:37-39), except announce, whose pre-transaction check
    (SS:886-888) throws a plain Error (5xx) (D11).
13. Lead (7) "about 19 test files": 18 files and 199 lines; 7 make direct db calls (28 sites); `rls-invariants.test.ts`,
    `session-guest-note-route-db.test.ts`, `authorization.test.ts` and `sessions-api.test.ts` make none (section 2.5).
14. Lead (7)'s premise of an owner person from `tenant_provision`: `setupRlsTestContext` uses no `tenant_provision` (`test-harness.ts:745-750`)
    and creates no persons or admins; SS-test and the outbox test have NO authorized person today (W3a adds one).

## 5. Pinned defaults

D1-D7: the conductor's pre-approved Tier B defaults (RO-L48-1 item 2), applied here; D8-D16: the orchestrator's Tier A/B choices. Each is
"default applied, pending owner sign-off".

- **D1** One helper and one error: `actorRecheckUnderLock(tx, { tenantId, actorPersonId })` defined once in SS (the row's probe symbol),
  calling `authorize(tx, { tenantId, action: SESSION_MANAGE_ACTION, actorPersonId })` (TCA:35) and throwing `SessionActorNotAuthorizedError`
  (`readonly code: "FORBIDDEN"`, no-arg constructor, name set; the shape of SS:433-440) when the decision is not allowed; whatever
  `authorize()` rethrows propagates unchanged (5xx). Rejected: a class per command (five more classes that drift); six inline `authorize()`
  calls (six copies, no single probe symbol).
- **D2** Placement A: the helper is the first statement of each host callback (section 2.1), before the advisory lock, the dedup read, the
  tenant gate and every row lock; nothing else moves. Evidence: section 3. Rejected: placement B (inverts the writers' order, RMS:81-82).
- **D3** `actorPersonId: string` REQUIRED on CreateSessionParams, PublishSessionParams, UpdateSessionParams, CloseSessionParams,
  CancelSessionParams; announceSession reuses `requestedByPersonId` (the lowercased value of SS:889; the payload key SS:1034 unchanged).
  Rejected: optional with a default (fail-open); a second announce field for the same person.
- **D4** The recheck precedes the advisory lock and the dedup read: a revoked actor replaying a committed commandId gets the 403, never the
  stored result; an authorized retry replays exactly as today. Rejected: after the dedup (hands a revoked actor the stored result).
- **D5** `export const SESSION_MANAGE_ACTION = "session.manage" as const;` in SS, exported through the named block of
  `packages/db/src/index.ts` (:159-214; the file has no `export *`), imported by R in place of R:97. Rejected: TCA as its home (a leaf,
  better for the follow-up row, but outside FILE OWNERSHIP without a ruling).
- **D6** R maps the class by one `instanceof` line (R:751-763) to `FORBIDDEN` 403 (R:515) with the R:621-624 copy; no new code or copy; the
  gate's copy (R:269-273) stays the gate's. Rejected: the gate's text for the in-command denial (a special case in the mapper).
- **D7** `SessionCommandContext` gains `personId` = the `session.personId` checked at R:264 (one read, R:237); the six host routes pass
  `actorPersonId: context.personId` (announce: `requestedByPersonId: context.personId`, dropping its re-read :28-29 and the
  `currentSession` import :4). `mayManageSessions` stays the cheap early deny; rate limits unchanged. Rejected: keeping the announce re-read
  (the gated person and the commanded person could differ).
- **D8** R's threat-model comment R:57-67 and R:69-74 is rewritten: the one-request window is closed for the six host commands; what
  remains undefended is listed; the guest-note commands keep their association proof. Rejected: leaving a comment that states a closed window.
- **D9** Q3 `NO_HOST_PATH` (section 2.2): no code in the guest-note commands or routes. Rejected: a recheck there (session.manage grants
  no guest-note authority).
- **D10** Precedence (logged, not a rule change): a revoked actor now gets FORBIDDEN before TENANT_SUSPENDED (publish, announce, close,
  cancel) and before validation or not-found errors (create, update, publish), matching the route's existing order (actor gate before the
  tenant gate); an authorized actor's outcomes are unchanged.
- **D11** A non-UUID actor is `not_a_member` (TCA:37-39), so a 403 for five commands; announce keeps its pre-transaction UUID check
  (SS:886-888, plain Error, 5xx; pinned by the existing A-11 test SS-test:1874). An unknown action is a domain denial (403). Rejected:
  moving announce's check into the transaction (a domain-rule change).
- **D12** Lock order after the change: section 3.3 (Tier A, from the code and the probe).
- **D13** The close header SS:1941-1942 is rewritten (comment only) to the real order: the actor and capability reads first (tenant_admins
  SH; a grant SH for owner-grantable actions), then tenants/subscriptions SH, then the advisory lock, then sessions UPD.
- **D14** Tests home: one new focused file `packages/db/src/session-commands-actor-recheck-under-lock.test.ts` for (a)-(d), (f), (g); test
  (e) in `apps/web/lib/session-command-route.test.ts`. (b) as corrected in section 4 item 2 (the only revoke shape, `UPDATE tenant_admins
  SET active = false`, TCAT:409-410). Loop or timing tests carry an explicit 30_000 budget (C11/C12); no RegExp built from data. Rejected:
  the new tests inside SS-test (the focused file keeps the new behaviour findable apart from the call-site churn).
- **D15** At most 3 out-of-scope backlog rows: (1) the six module-local `session.manage` literals -> one exported constant in a leaf module;
  (2) the app role's unused DML on `tenant_admins` (0009:32, 0009:57); (3) `club-config.ts:79` shares the `processed-command:` advisory
  namespace with the session commands (a commandId reused across both could serialize or deadlock).
- **D16** B3 is an estimate (section 9); GitNexus `impact` on each command and on the route helper before editing (HIGH or CRITICAL
  expected: recorded in the PR body, never skipped).

## 6. Implementation steps

1. **W1** (opus/high, packages/db): in SS add `SESSION_MANAGE_ACTION`, `SessionActorNotAuthorizedError` and `actorRecheckUnderLock` (import
   `authorize` from TCA); make `actorPersonId` required on the five params types (SS:87-91, :453-457, :1161-1165, :1888-1892, :2149-2153);
   insert the call after SS:272, :498, :890, :1241, :1954, :2257; rewrite the close header SS:1941-1942 (D13); export the class and the
   constant from the `packages/db/src/index.ts` block :159-214 (the helper is not exported). GitNexus `impact` (upstream) before each
   command. Commit in the worktree.
2. **O1** (orchestrator apply script): the uniform shapes S1-S6 of section 2.5, exact-match, each pattern's expected count asserted before
   any write (a mismatch aborts); checks 1-4 and 7 of section 2.6 first.
3. **W3a** (opus/high): the fixtures: `ACTOR` (a persons row plus an active web admin of ctx.tenantA in the top beforeAll of SS-test), the
   admin insert in each SS-test `seedTenant` copy and in `seedEligibleTenant`, `HOST` re-pointed to `ACTOR`, the irregular site :511, the
   outbox `seedTenant` and `t` admin, the zalo-dm fixture only if check 5 requires it. The packages/db suite is green after W3a.
4. **W2** (opus/high, apps/web): R: `personId` in `SessionCommandContext` (R:223-229) and in the R:346 object; the constant import in place
   of R:97; the class import (R:3-20) and its `instanceof` line (R:751-763); the comment R:57-67, R:69-74 (D8). The six host route files (the
   edit shapes of section 2.3 and D7). The six route tests' asserted arguments (check 6). Test (e). GitNexus `impact` on
   `resolveSessionCommandContext`, `handleSessionCommand` and `mapSessionCommandError` before editing. The workspace typecheck is green
   after W2 (the required parameter breaks every caller until then).
5. **W3b** (opus/high): the new focused file, tests (a)-(d), (f), (g).
6. **O2** (orchestrator): the backlog row closed by hand in the L37/L58 form (status merged, `merged:`, `note_merged:`, no PR number or
   SHA; the probe symbol exists after this lane) and at most 3 new rows (D15).
7. **R1a** (the db commands, the helper, the lock-order table and the probe), then **R1b** (the route, the mapping, the tests, the pins),
   then **SEC** (the threat model as the checklist, the planted-call proof, replay by a revoked actor, the 5xx-not-403 path): one after
   another, each alone, at most 3 rounds counting pre-push rounds, on committed content.
8. Final checks (section 8) at the final head; then ONE push, the PR (lead corrections, the defaults with their rejected alternatives, D38,
   the GitNexus risk levels), CI green.

## 7. Acceptance matrix

| id | test | expected |
|---|---|---|
| (a) | per host command (six), real DB: the actor's admin row revoked (committed) before the command opens | throws `SessionActorNotAuthorizedError` (code FORBIDDEN); writes NOTHING: no sessions change, no processed_commands row, no outbox row (cancel's audit event included), no audit row |
| (a) replay | a commandId the actor committed while authorized, replayed after the revoke | the same refusal, never the stored result (D4) |
| (b) | a revoke COMMITTED while the command waits on the admin row lock (the revoke holds the row first; the wait detected with `pg_blocking_pids`, not a fixed sleep) | after the wait the definer re-reads `ta.active` (0049:87) and denies: the same refusal, nothing written |
| (c) | the command holds the actor SH lock (parked after the recheck by a barrier, the CONC2 pattern SS-test:1213-1215); a revoke under `SET LOCAL lock_timeout` | the revoke fails with 55P03 (as probe P1 measured); after the barrier is released the command commits normally |
| (d) | an authorized actor through every existing suite with the new parameter | all green, every existing assertion unchanged (A-11 included) |
| (e) | route: a thrown `SessionActorNotAuthorizedError` | 403, code FORBIDDEN, the R:621-624 copy |
| (f) | announce by an authorized actor | the outbox payload `requested_by_person_id` equals the actor (SS:1034) |
| (g) | source guard (node:fs, string checks, no RegExp from data) | each of the six host commands' transaction callback starts with `await actorRecheckUnderLock(tx,`, before any other `tx.` statement; planted-call proof (as L41-G1): the check reports a mutated copy (the call removed; the call moved after a `tx.` statement) |
| greps | `grep -n 'authorize(' packages/db/src/session-service.ts \| grep -v authorizeTenantAction`; `git grep -n -w -e SESSION_ACTION -- apps/web` | the first prints only lines of the helper; the second prints nothing |

Timing and loop tests carry an explicit 30_000 budget; test (c) and (b) are deterministic (lock_timeout, a barrier, wait detection).

## 8. Verification

The lane block's TESTS line: the focused files first, then `pnpm --filter @plexco/db test`, `pnpm --filter @plexco/web test` and the bot test
`apps/bot/src/projectors/zalo-dm.test.ts`, each through the lane's locked-run wrapper (the DB and e2e lock: queue, announce each window);
typecheck, lint, format:check and `pnpm review:check:changed` before every commit, the FULL `pnpm review:check`; `pnpm build` once; `pnpm -w
test` once at the final head (one rerun for a flake on the ACTIVE clerk list); the CI-only patterns C11/C12; GitNexus `impact` before editing
each command and the route helper (HIGH or CRITICAL expected, recorded, never skipped); GitNexus `detect_changes` before every commit and at
the end.

## 9. Budget (B3)

- Ceilings (lane block, an estimate per RO-L48-1 item 3): 260 non-test lines, 800 test lines (mostly mechanical call-site updates), 1,060
  total (docs excluded), 38 files, 0 migrations. Beyond that a ruling request before the next writer; an overrun with a design reason is
  logged, not asked, up to 1,100 test lines and 40 files.
- Expected files (from the measured sites, not a measurement of the diff): 9 non-test (SS, index.ts, R, the six host routes), 15 or 16 test
  files (the six direct-call files of section 2.5 plus zalo-dm if check 5 requires, the six route tests, `session-command-route.test.ts`, the
  new focused file), 2 docs (the backlog and this file): 26 or 27, under 38.
- The B3 exception: two code modules (packages/db and apps/web; apps/bot only if check 5 requires a fixture line) plus docs. A split breaks
  coherence: the REQUIRED parameter is a compile-time breaking change, so the db signatures and every caller must land together.
  Compatibility proof: no migration, no HTTP contract change, the new 403 reuses the existing FORBIDDEN code and copy.
- The plan-level gap D38: the plan's "0-200 LOC, 2 module" counts no test churn; the PR body says so.

## 10. THREAT MODEL

The lane block's model, with D11's correction of item (4) and D12's correction of items (1)-(2) marked: defends against (1) an actor whose
admin row was revoked after the route gate committed but before or while the command mutates (spec edges #17, #18) [D12: for
`session.manage`, a preset action, the lane block's "role or grant was revoked or expired" reduces to the `tenant_admins` row: no grant row,
no expiry]; (2) a revoke racing the command (it blocks on the `tenant_admins` FOR SHARE lock, the only lock the recheck takes [D12], until
the command commits or aborts); (3) a replayed command by a revoked actor receiving the stored result (authorize first); (4) a fail-open
path: an infrastructure error or a malformed result never allows (rethrow becomes a 5xx, never a 403, never an allow) [D11: an unknown
action or a malformed actor id is a domain denial, so a 403, never an allow; announce's pre-transaction UUID check stays a 5xx]; (5) a
command added later without the recheck (required parameter plus the source guard); (6) an availability regression from a lock-order
inversion (the table and the probe); (7) an existence oracle: the in-command denial is the same 403 FORBIDDEN as the gate (code and status;
it reaches only an actor the gate admitted moments earlier). Not defended: a compromised session cookie, a malicious admin acting within
their own authority, anything below the transport. VOID if any command becomes reachable by a principal that is not a signed-in tenant
member (a bot transport, a webhook, a public link, a service token): then every sentence above needs a new model.

Where each is checked: (1) tests (a), (b); (2) test (c), probe P1 and P2a; (3) test (a) replay; (4) R1a and SEC read the helper (no catch;
anything but an allowed decision throws) and D11; (5) the TypeScript compiler and test (g); (6) section 3 and the probe; (7) test (e) and
D6. The void condition: section 2.3 (not triggered at the base); SEC re-runs the caller grep.

## 11. OPEN

- In scope: 0.
- Out of scope, named (current behaviour pinned; none affects this slice):
  - the six module-local `session.manage` literals (D15 row 1);
  - the app role's unused DML on `tenant_admins` (D15 row 2): a future TypeScript revoke must lock the admin row first and nothing
    exclusive on tenants/subscriptions before it, and placement A then stays cycle-free;
  - the `processed-command:` advisory namespace shared with `club-config.ts:79` (D15 row 3): a commandId reused across a club-config command
    and a session command could deadlock (40P01, one aborts); same-id reuse only;
  - the update inversion D-14 (SS:1422-1431, row audit-2026-09-06-d14-lock-order-publish-vs-update): owned by the Daily Lifecycle lane;
  - the guest-note commands: no suspension gate (SS:2799-2802, an owner follow-up) and their routes' second `currentSession()` read (create
    :56, delete :58): hygiene, not edited (Q3);
  - announce's malformed-requester 5xx (SS:886-888, D11), pinned by A-11.

## 12. Closure matrix (12 of 12 PASS)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the worktree HEAD at step 0, the merge of PR #125 (measured); every TARGET_FILES path exists at the base | PASS |
| 2 | Decisions in scope final | DD-150; the backlog row and the DD-56 spec as the contract; RO-L48-1 (conductor); D1-D16 pinned as defaults pending owner sign-off (section 5) | PASS |
| 3 | Scope IN/OUT and owner clear | the lane block's FILE OWNERSHIP and NEGATIVE SCOPE; Q3 keeps the guest-note files out; D5 keeps the six db literals out | PASS |
| 4 | Dependencies classified | L42 merged (PR #124); every earlier lane merged (C20; the base is the merge of PR #125); shares only `docs/autopilot-backlog.md` | PASS |
| 5 | Live schema and code match | sections 2-3 measured at the base; the probe on a scratch database migrated at the base (tail 0073) | PASS |
| 6 | Data, API, state, auth contract | no schema, migration or HTTP contract change; the only behaviour change: an actor without `session.manage` at command time gets the existing FORBIDDEN 403 (D6, D10); an authorized actor is unchanged | PASS |
| 7 | Fail-closed, idempotency, order | required parameter; the recheck before the advisory lock and the dedup (D4); rethrow stays a 5xx (D1, D11); `LOCK_ORDER: NO_CYCLE` and `PROBE: NO_CYCLE_CONFIRMED` | PASS |
| 8 | Open questions in scope = 0 | section 11 | PASS |
| 9 | Acceptance matrix with expected results | section 7 | PASS |
| 10 | Migration, security, rollback | no migration; security round planned (opus/max); rollback = revert the PR (no data, schema or contract change) | PASS |
| 11 | First slice hard dependencies merged | L42 merged; W1 depends on nothing unmerged | PASS |
| 12 | Implementation handoff ready | sections 2 and 5-8; W1 has every input (the insertion points, the class shape, the index block, the close header) | PASS |

## 13. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-27
AUTHORITY_SHA: d1154dbc5ad72ba084ff954f37876f2651970e7f
BASE_BRANCH: main
TARGET_FILES:
  - packages/db/src/session-service.ts (edited: the constant, the class, the helper; actorPersonId on five params types; six first statements; the close header :1941-1942)
  - packages/db/src/index.ts (edited: the named block :159-214, two exports)
  - apps/web/lib/session-command-route.ts (edited: imports :3-20, :97, :223-229, :346, the chain :751-763, the comment :57-67 and :69-74)
  - apps/web/app/api/sessions/route.ts (edited: the createSession call :29-38)
  - apps/web/app/api/sessions/[id]/publish/route.ts (edited: :33-37)
  - apps/web/app/api/sessions/[id]/announce/route.ts (edited: the import :4, the re-read :28-29 removed, the call :32-40)
  - apps/web/app/api/sessions/[id]/route.ts (edited: :38-42)
  - apps/web/app/api/sessions/[id]/close/route.ts (edited: :34-38)
  - apps/web/app/api/sessions/[id]/cancel/route.ts (edited: :35-39)
  - docs/autopilot-backlog.md (edited: the row at :5742 and at most 3 new rows)
  - packages/db/src/session-service.test.ts (edited: 17 call sites, the ACTOR fixture, seedTenant x5, seedEligibleTenant, HOST :1518)
  - packages/db/src/session-close-cancel-money-policy.test.ts (edited: the helpers :106-117)
  - packages/db/src/member-name-invisible-chars.test.ts (edited: :2455, :2504)
  - packages/db/src/outbox-projector-registry.test.ts (edited: :973, :1103, the local seedTenant)
  - packages/db/src/join-request-service.test.ts (edited: :656)
  - apps/web/lib/realtime-listener-db.test.ts (edited: :93)
  - apps/bot/src/projectors/zalo-dm.test.ts (edited only if check 5 finds host.person is not an active web admin: the fixture; else read only, expected green)
  - apps/web/app/api/sessions/route.test.ts (edited: the asserted arguments :130-146, :240-244)
  - apps/web/app/api/sessions/[id]/publish/route.test.ts (edited: :120)
  - apps/web/app/api/sessions/[id]/announce/route.test.ts (edited as needed: :105 and the session mock)
  - apps/web/app/api/sessions/[id]/route.test.ts (edited: :136)
  - apps/web/app/api/sessions/[id]/close/route.test.ts (edited: :99)
  - apps/web/app/api/sessions/[id]/cancel/route.test.ts (edited: :99)
  - apps/web/lib/session-command-route.test.ts (edited: test (e))
SLICE: p4-session-commands-authz-recheck
IN_SCOPE: SESSION_MANAGE_ACTION, SessionActorNotAuthorizedError and actorRecheckUnderLock in session-service.ts, called as the first statement of the six host commands with a required actorPersonId (announce reuses requestedByPersonId), before the advisory lock and the dedup; the two index.ts exports; the route context personId, the six host routes passing it, the instanceof mapping to the existing FORBIDDEN 403, the constant import, the rewritten threat-model comment; the call-site and fixture edits of the listed tests; the new focused test file packages/db/src/session-commands-actor-recheck-under-lock.test.ts (tests a-d, f, g); test (e); the backlog row closed by hand and at most 3 new rows; this readiness file
OUT_OF_SCOPE: SQL and migrations; tenant_capability_authorize, the capability registry, presets and grants; authorizeTenantAction and the tenant-status table; every command's domain rules; the ledger and dedup (commandId-only, DD-117 D5) and any actor column on processed_commands; a new error code or copy; the route's early gate and rate limits; the guest-note association proof and the two guest-note routes (Q3); the six db-local session.manage literals; bot or other transports; new dependencies; PR #50
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: p4-name-rules-db (L42) merged (PR #124) and every earlier lane merged: the base commit is the merge of PR #125
PRIOR_SLICES: L41 (merged, PR #119, migration 0072); L42 (merged, PR #124, migration 0073); every earlier Phase 4 lane (merged, owner concurrency rule C20)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration; security round planned (opus/max, the threat model as the checklist); rollback = revert the PR
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 - in session-service.ts add the constant, the class and the helper, make actorPersonId required on the five params types, call the helper first in the six host callbacks (announce with the lowercased requestedByPersonId), rewrite the close header, export the class and the constant from index.ts; GitNexus impact before each command; commit in the worktree
REMAINING_BLOCKERS: none
```
