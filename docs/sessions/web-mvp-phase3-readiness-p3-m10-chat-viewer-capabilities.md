<!-- review-readiness: code-ready -->

# Step-0 readiness: L15b p3-m10-chat-viewer-capabilities (session P3-S12b)

> Agent-facing. Readiness reviewer, writers, code reviewer and security reviewer: opus/max; at most 3 rounds (pre-push rounds
> count), area-split from round 1 only if the diff is large; DD-122 D4: Codex waived, independent Claude reviewers.
> Every `path:line` is MEASURED at base `a23fe96d3b9045a5f143b19bac9b31be97a2daff` by three readiness reviewers (S0a: Q1, Q3,
> Q4; S0b: Q2, Q5, Q6; S0c: the open reads, B3 and this file; token-rule hand-offs); use THIS file's numbers, not the lane
> block's (conductor note 3). Authority: owner answer "moderation ok" (2026-10-20, status/CONDUCTOR-LOG.md), D4 signed (club
> channels only). Source notes under status/P3-S12b-notes/ are untracked; every fact a writer needs is restated here.

## 1. Base, dependencies, authority

- Base: `origin/main` `a23fe96d3b9045a5f143b19bac9b31be97a2daff`. Worktree `.autopilot/worktrees/p3-m10-chat-viewer-capabilities`,
  branch `feat/p3-m10-chat-viewer-capabilities`: HEAD = base, `status --porcelain` empty, no `index.lock` in its git dir (S0c).
- On the base: L12 (#77), L14 (#83, 0063), L13a (#84), L13 (#85), L15 (#86), L15a (#87, `0065_chat_message_author_label.sql`,
  the migration tail). L16 (P3-S13) is not merged and is not a dependency.
- Capability core on the base: `0047_tenant_capability_authority_core.sql` (preset actions `chat.message.moderate` and
  `chat.channel.post_restricted`, :85-86) and `0049_tenant_capability_authorize.sql`
  (`tenant_capability_authorize(p_tenant_id uuid, p_action text, p_actor_person_id uuid)`, SECURITY DEFINER, search_path pinned
  :51-52, EXECUTE to `app` :133-134), wrapped by `authorize(tx, {tenantId, action, actorPersonId})`
  (`packages/db/src/tenant-capability-authority.ts:35`, exported from `@plexco/db`).
- DD-56 (`docs/standards/decisions.md:748`, body read :748-800): authorization goes through ONE canonical action-to-capability
  registry; adapters, API and UI only ask the registry and never scatter role comparisons; live `admin` and `co_admin` map to
  the same least-privilege preset, which contains `chat.channel.post_restricted` and `chat.message.moderate`. Its clause "every
  Chat capability consumer HOLDs until the core lands" is discharged: the core is on the base. L15b asks the registry
  (authorize()) and returns only its `allowed` boolean: the path DD-56 prescribes, not a second definition.
- DD-56-read-routes (`decisions.md:2046`, default applied 2026-10-12, pending owner sign-off): read routes wait for the
  capability core and use `authorize()`, with no interim role gate ("no amendment #4"). L15b complies: it never touches the
  interim session gate (`resolveSessionCommandContext`, `tenantsForPerson`, whose import ESLint restricts to three files under
  DD-56 amendment #1), and GET /channels stays gated by chat membership, not by the capability.
- DD-60 (`decisions.md:869`, :871): fixes the envelope only (`{data, error, meta}`); no rule governs keys inside `data`.
- Owner decisions needed: none. Every choice below is Tier B and is listed in section 10.

## 2. Q1 where to compute (S0a)

- DECISION: inside runChat's withChatActor transaction, in the route's `fn`, AFTER `listChatChannels` returns; no separate
  withTenant transaction; inline in the route, no helper.
- withChatActor = withTenant (one `db.transaction` plus `set_config('app.tenant_id', tenantId, true)`,
  `packages/db/src/tenant.ts:61-71`), then `set_config('app.person_id')` (`packages/db/src/chat-service.ts:83`), then the
  suspension gate `authorizeTenantAction(admin_mutation)`, a denial being TENANT_SUSPENDED (`chat-service.ts:75-91`). Nothing
  sets a role: the transaction runs as the DATABASE_URL role `app` (`apps/web/lib/session-cookies.ts:54-60`, DB_EXPECTED_ROLE).
- authorize() works in that transaction: the definer binds `p_tenant_id` to `app.tenant_id` and returns a `tenant_context`
  denial otherwise (0049:60-69); inside withChatActor that GUC is `g.tenantId`. `ChatTx` is `Tx & brand`
  (`chat-service.ts:68`), which `authorize(tx: Tx, ...)` accepts. Owner, admin and co_admin resolve the two preset actions to
  allowed (0049:100-111). Measured on plexco_test (container psql, read-only): EXECUTE for `app` = t, prosecdef = t.
- Not a separate withTenant (the standalone precedent `apps/web/lib/session-command-route.ts:115-125`, authorize at :121-123):
  a chat transaction with the same role and GUC is already open; no extra pool checkout; flags and channels share one
  snapshot; a throw passes withChatActor's sanitize (`chat-service.ts:45-64`, :88-90), which reduces it to
  `CHAT_DB_ERROR:<SQLSTATE or UNKNOWN>`, whereas a bare withTenant has no catch and would rethrow raw text.
- Lock footprint: FOR SHARE only on the viewer's own active web `tenant_admins` row (0049:82-88). Preset actions return
  before the grants lookup (0049:109-111; the grants FOR SHARE at :113-120 is for owner_grantable actions only). A plain member
  locks nothing. Held until withChatActor commits (`tenant.ts:67-70`): computed last, it spans the two definer calls plus
  `ok()`. 0049 has no NOWAIT or lock_timeout, and `grep -n -E 'statement_timeout|lock_timeout' packages/db/src/client.ts` = 0
  hits (S0c): a GET behind an uncommitted demotion waits for it, then re-reads (READ COMMITTED) and returns false, never a
  stale allow. Same posture as every existing authorize() caller; not introduced here.
- Pre-gate order, each exits before any flag exists: chatActorThrottled (`apps/web/lib/chat-route.ts:203`); hasLiveMembership
  in its own short transaction (:205-208); the chat-read bucket (:211-214); the suspension gate (`chat-service.ts:84-85`);
  listChatChannels' non-empty proof (`packages/db/src/chat-channel-reads.ts:34`: zero rows throw ChatCommandError
  CHAT_FORBIDDEN, sanitize passes it (`chat-service.ts:51`), `mapChatError` gives `chatForbidden()`, `chat-route.ts:153` and
  :49-58). So the flags exist only on the 200 path of a live member with at least one readable channel.
- Inline, not a helper: one consumer; `chat-route.ts` is shared by every chat mutation route and a capabilities helper there
  would read as an authorization. Not inside `listChatChannels`: `apps/web/lib/realtime-auth.ts:161` and
  `apps/web/app/api/chat/subscribe/route.ts:42` reuse it for the SSE path (negative scope). Two SEQUENTIAL awaits (one pg
  connection; no Promise.all on a transaction that may abort). Only `allowed` leaves the callback.

## 3. Q2 response shape and names (S0b)

- PINNED (section 10 D1): the 200 `data` is `{ channels: ChatChannelDto[]; viewer: { canModerate: boolean; canPostRestricted:
boolean } }`, with `viewer` a sibling of `channels` (capabilities are tenant-level; authorize() takes no channel). New types
  in `packages/core/src/api-contract.ts`, next to ChatChannelDto: `ChatViewerDto { canModerate: boolean; canPostRestricted:
boolean }` and `ChatChannelListDto { channels: ChatChannelDto[]; viewer: ChatViewerDto }`. ChatChannelDto (:211-221) stays
  unchanged (`apps/web/app/api/chat/channels/route.ts:7`: "the reader's columns are the DTO (T25)").
- Precedent: `grep -n -E 'viewer|capabilit|(^|[^A-Za-z])can[A-Z]' packages/core/src/api-contract.ts` = 0 hits, so no name
  competes; the nearest viewer-relative boolean computed in a route is `mine: boolean` (:231, interface :227).
- Envelope (DD-60) unchanged; every denial envelope untouched.
- BE spec (Reviewed, `docs/features/BE/feature_inapp_chat_tech.md:5`): :1140 lists `GET /api/chat/channels` with no example
  block; :1169 is the "canonical DTO whitelist" rule that build slices may not add actor, tenant or author authority fields.
  Reading (section 10 D7): no actor, tenant or author identifier and no client-asserted authority; two booleans carry no id
  and authorize nothing (the server re-authorizes every action), so the rule holds. The spec is not edited here (section 14).
- Consumers at the base read only `data.channels` or the DB reader. No non-test client consumer and no e2e mock: repo-wide
  `git grep -n -E 'T25|api/chat/channels'` hits only chat-routes-db.test.ts, chat-stream-db.test.ts:585-586,
  request-policy.test.ts:88 and tenant-lang.test.ts:288. The SSE path reuses `listChatChannels` (the DB reader), not the HTTP
  body. Additive-safe.
- Existing pins: T25 (`apps/web/lib/chat-routes-db.test.ts:1263-1267`) asserts
  `toEqual({data: {channels: [...]}, error: null, meta: expect.anything()})`: it becomes a test edit that adds
  `viewer: {canModerate: false, canPostRestricted: false}` (actor `a` is a plain member). :1269, :1338 and :1344 read
  `data.channels` only. The wire pin `packages/core/src/api-contract.test.ts` (about :337, `expectTypeOf` on
  `keyof ChatChannelDto`) gets the same kind of pin for the two new types.
- `apps/web/lib/chat-stream-db.test.ts`: its sweep table includes "channels 200" (:585) and asserts no-store on every
  response (:615) and no seeded person uuid and no `authorPersonId` in any body (G2, :629-634). It stays green with `viewer`
  and is a free regression for "no person id"; no edit.
- Coordination (non-blocking, section 16): L16 must not strictly validate or deep-compare the /channels `data` object.

## 4. Q3 error policy (S0a)

- authorize() contract (`tenant-capability-authority.ts:10-17`, :35-62): domain denials return `{allowed: false, reason}`
  (:37-42, :54-56); a query failure propagates (no catch); a malformed row throws (:51-53); allowed without a recognised role
  throws (:57-60); assertTenantId (:36) cannot fire after readTenantParam (`chat-route.ts:184-187`).
- A throw inside `fn`: withChatActor sanitizes and rethrows (`chat-service.ts:88-90`); runChat maps ChatCommandError only
  (`chat-route.ts:151-156`) and rethrows the rest (:252-255). It lands on L15's error-map row "`CHAT_DB_ERROR:<SQLSTATE>`, any
  plain Error: 500, rethrown and fail closed; no text logged (a SQLSTATE at most); Next's default empty 500" (L15 PR #86 body,
  "Error map"; L15 readiness file docs/sessions/web-mvp-phase3-readiness-p3-m10-chat-api-live.md). The route adds no log
  (`chat-route.ts:3-4`, "Nothing here logs"). The decision's role and reason are fields of a RETURNED object, never thrown,
  so they cannot reach a log.
- No collapse to allow and no quiet false from an infrastructure error: no catch on the path produces a value; the body of
  0049 (:44-132) has no RAISE, so the primitive cannot emit a P0001 that maps to a ChatCommandError.
- Quiet-false risks are domain denials, closed by construction and by tests: `tenant_context` (pass `g.tenantId` only) and
  `unknown_action` (write the two action keys as string literals; use the exported action type if authorize()'s signature
  has one). Rows R1a-R1c (owner, admin, co_admin give true) fail on either mistake.
- TENANT_SUSPENDED is thrown by the gate before `fn` runs (`chat-service.ts:84-85`): the flags are never computed and that
  body is unchanged.

## 5. Q4 cost (S0a)

- Exactly 2 authorize() calls per GET /channels, tenant-level and independent of the channel count: no N+1;
  `listChatChannels` stays one query.
- Budgets unchanged: one `chat-actor:<accountId>` unit (120 per 60 s, `chat-route.ts:32-34`, :203) and one
  `chat-read:<personId>` unit (60 per 60 s, :23-24, :211-214; route.ts:9 passes `read: true`) are spent before `fn`; the
  authorize calls spend none and add no bucket; a 429 never carries flags. D-5's 2 s refetch coalescing is L16 client
  behavior (not measured); the server-side bound is the chat-read bucket, 60 per minute per person.
- Per call: one GUC read, one `tenant_capability_actions` lookup by action_key, one `tenant_admins` lookup FOR SHARE
  (0049:60-93). For an admin viewer the second call re-locks a row its own transaction holds; a plain member locks nothing.
  Comparable to the existing per-beat stream cost (L15 PR #86 body: a FOR SHARE on one memberships row plus
  authorizeTenantAction's locked tenant-status resolver).

## 6. Q5 fixtures, reader lock, test seam (S0b, S0c)

- `packages/db/src/tenant-capability-authority.test.ts`: `person()` :48; `admin(tenantId, role, active = true)` :55 (INSERT
  at :58); `grant()` :65; identical allow set for owner, admin and co_admin :98; the four Chat keys for co_admin :237; a
  cross-tenant actor denied :282-284; an inactive admin and a person with no admin row denied :290-292; FOR SHARE held until
  commit :393-410 (`UPDATE tenant_admins SET active = false` at :410). These helpers are module-local (no export): reuse means
  copying their shape.
- Route-test fixture: `moderator(t)` (`chat-routes-db.test.ts:939-947`) inserts `VALUES ($1, 'web', $2, 'owner', true)` with
  `$2` = the person id (T19 inline at :292-297). Pinned: parameterize it as `moderator(t, role = "owner", active = true)`;
  existing callers stay unchanged. If it is describe-scoped, hoist it to module scope (a move, not a second helper).
- Reader lock: the new tests call only the route (authorize() reaches tenant_capability_authorize) and name no definer role,
  so they hold no definer reader lock. A test that names job_definer, chat_definer or identity_definer holds the matching lock
  from `packages/db/src/test-harness.ts` (`withDefinerReadLock` :546-547).
- Infrastructure-error seam (section 10 D8): no deterministic real fault exists for a healthy DB, so chat-routes-db.test.ts
  gets ONE delegating module mock, real by default:
  `vi.mock("@plexco/db", async (importOriginal) => { const m = await importOriginal<typeof import("@plexco/db")>(); return { ...m, authorize: vi.fn(m.authorize) }; })`.
  Only the R7 test calls `vi.mocked(authorize).mockRejectedValueOnce(...)` with a pg-shaped error (an Error carrying a
  SQLSTATE `code`, such as 57014). The file already mocks `next/headers` (:35) and spies on console (T18, :1162). Check the
  apps/web vitest config for `mockReset` or `restoreMocks` before relying on `vi.fn(m.authorize)`; R7 ends with a positive
  control (a follow-up GET returns 200 with the real flags), so a reset-to-noop mock cannot pass silently. Rejected
  alternative: a real `pg_cancel_backend` on a GET blocked behind a FOR UPDATE on the admin row (timing-dependent, needs a
  signal-capable connection, and the known-flake list is already long).

## 7. Q6 B3 estimate (S0b provisional, completed by S0c)

Counting rule (status/P3-S12b-notes/scripts/b3-measure.sh, orchestrator-measured): gross added lines, comments included;
`*.md` under `docs` count outside the non-test, test and total numbers but inside the file count.

| File                                                                      | Kind       | Base lines | Est. gross added |
| ------------------------------------------------------------------------- | ---------- | ---------- | ---------------- |
| apps/web/app/api/chat/channels/route.ts                                   | non-test   | 15         | 18-30            |
| packages/core/src/api-contract.ts                                         | non-test   | 291        | 10-14            |
| apps/web/lib/chat-routes-db.test.ts                                       | test       | 1430       | 150-240          |
| packages/core/src/api-contract.test.ts                                    | test       | n/a        | 4-10             |
| docs/sessions/web-mvp-phase3-readiness-p3-m10-chat-viewer-capabilities.md | doc, files | new        | this file        |

Totals against the pre-approved caps: non-test 28-44 (cap 150); test 154-250 (cap 450); total 182-294 (cap 600); files 5
(cap 8); migrations 0 (cap 0). Within every cap: no B3 exception and no ruling request. The S0b row for a chat-route.ts
helper drops (Q1: inline). Pin sites: none (no migration, so no migration-tail pin; no new route, so request-policy.test.ts:88
and tenant-lang.test.ts:288 stay as they are).

## 8. Contract (pinned)

- Route: `GET /api/chat/channels?tenant=<uuid>`; path, gate, rate limits and every denial unchanged.
- 200 body: `{ data: { channels: ChatChannelDto[], viewer: { canModerate: boolean, canPostRestricted: boolean } }, error:
null, meta: { requestId } }`.
- `canModerate` = the `allowed` of `authorize(tx, { tenantId: g.tenantId, action: "chat.message.moderate", actorPersonId:
g.personId })`; `canPostRestricted` = the same for `"chat.channel.post_restricted"`.
- Actor = the session person (`g.personId`); tenant = the one the gate proved (`g.tenantId`); no person, role or channel
  parameter exists.
- What the field is NOT: not a role (booleans only); not an authorization (the L14 definers re-authorize every send, edit and
  moderate server-side, 0063); not cached (computed per request inside the request's own transaction; the response is
  no-store, chat-stream-db.test.ts:615).
- Writer rules: read only `allowed`; no try/catch around authorize(); the changed files' code and comments contain no role
  property read (a dot-role access, a bracket "role" access or a destructure naming role):
  `apps/web/lib/role-read-guard.test.ts:34-43` scans comments too (only quoted strings are blanked, :38-41).

## 9. Threat model (also as a code comment in the route)

Defends against:

1. A non-member or another club's admin learning anything: the flags exist only on the 200 path after the live-membership
   pre-gate, and every denial stays the one unchanged CHAT_FORBIDDEN body, byte-equal (T2 `one()`, :1272-1287).
2. An oracle on other people: no person parameter exists; the actor is the session person.
3. Role disclosure: booleans only; the decision's role and reason never leave the callback.
4. Trusting a stale hint: the flags are a snapshot and the server re-authorizes every action, so a demoted admin gets the
   server's denial, and the next GET shows false (no cache).
5. Cross-tenant bleed: the capability is evaluated for the `?tenant=` the gate proved, which the definer binds to
   `app.tenant_id` (0049:60-69).
6. A lock side effect: authorize()'s FOR SHARE locks live until the caller's commit, so the flags are computed last in the
   already-open short transaction (section 2).

Does NOT defend against: a compromised app tier, which already holds the session.

## 10. Pinned defaults (each: default applied, pending owner sign-off)

- D1 response key and shape: `viewer: {canModerate: boolean, canPostRestricted: boolean}`, a sibling of `channels`; types
  `ChatViewerDto` and `ChatChannelListDto` (section 3). Default applied, pending owner sign-off.
- D2 error policy: an authorize() infrastructure error is rethrown to the existing 500 fail-closed row, never allow and never
  a quiet false (section 4). Default applied, pending owner sign-off.
- D3 freshness: both flags are computed on every GET /channels, with no cache. Default applied, pending owner sign-off.
- D4 compute place: inside runChat's withChatActor transaction, after listChatChannels (section 2). Default applied, pending
  owner sign-off.
- D5 code home: inline in the channels route, two sequential awaits, no helper (section 2). Default applied, pending owner
  sign-off.
- D6 "an inactive or removed admin": inactive = a tenant_admins row with active = false (its own test); removed = no row,
  which is the plain-member path (`packages/db/schema.ts:819-826` has id, tenant_id, platform, platform_user_lookup_hash,
  role, active, created_at and no removed or revoked column). Default applied, pending owner sign-off.
- D7 BE spec whitelist reading of feature_inapp_chat_tech.md:1169 (section 3); the spec edit goes to L17. Default applied,
  pending owner sign-off.
- D8 infrastructure-error test seam: one delegating mock of authorize, real by default (section 6). Default applied, pending
  owner sign-off.

## 11. Decision table and per-row test map (acceptance matrix)

A deny is false, never an error. Every row is a real-DB route test in `apps/web/lib/chat-routes-db.test.ts`, in a new
describe beside "GET /api/chat/channels (list)" (:1239), unless stated. Fixtures: `actor(...)`, `moderator(...)` (section 6),
the tenants `c` and `other` of the existing list tests.

| Row | Case                                                                                                     | Expected                                                                                                                                                                                          | Test and fixture                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| R1a | active owner row in the tenant                                                                           | 200, viewer true and true (the primitive's answer, not re-derived)                                                                                                                                | `actor(c.t)` plus `moderator(c.t, "owner")`                                                          |
| R1b | active admin row                                                                                         | 200, true and true                                                                                                                                                                                | `moderator(c.t, "admin")`                                                                            |
| R1c | active co_admin row                                                                                      | 200, true and true                                                                                                                                                                                | `moderator(c.t, "co_admin")`                                                                         |
| R2  | plain member, no tenant_admins row                                                                       | 200, false and false                                                                                                                                                                              | T25 edit (:1263-1267, actor `a`)                                                                     |
| R3  | inactive admin (row with active = false)                                                                 | 200, false and false                                                                                                                                                                              | its own test, `moderator(c.t, "admin", false)`                                                       |
| R3r | removed admin (row deleted)                                                                              | 200, false and false                                                                                                                                                                              | third GET of R6 after the DELETE (the R2 path)                                                       |
| R4  | admin of another tenant only, member here                                                                | 200, false and false                                                                                                                                                                              | `actor(c.t)` plus `moderator(other.t, "owner")` for the same person                                  |
| R5a | non-member, wrong tenant, guest, zero readable channels                                                  | the one CHAT_FORBIDDEN body, no viewer key, byte-equal                                                                                                                                            | T2 (:1272-1287) unchanged: `one(r)` equal across /channels and the history GET                       |
| R5b | owner row in the tenant without a membership; another club's owner asking about this tenant              | CHAT_FORBIDDEN, byte-equal to the T2 `one()` value                                                                                                                                                | new: `moderator(c.t, "owner")` for a non-member; `moderator(other.t, "owner")` for a member of other |
| R5c | live member with an owner row in a suspended tenant                                                      | TENANT_SUSPENDED, no viewer key, byte-equal to the history GET                                                                                                                                    | T23 (:1289-1294) extended with a `one()` compare                                                     |
| R6  | demoted admin, no cache                                                                                  | GET 1 true and true; `UPDATE tenant_admins SET active = false`; GET 2 false and false; DELETE the row; GET 3 false and false                                                                      | new (shape of the authority test :410)                                                               |
| R7  | authorize() infrastructure error                                                                         | the GET rejects with the sanitized `CHAT_DB_ERROR:<SQLSTATE or UNKNOWN>` (the 500 row; assert the exact string sanitize produces), no console output, no body; a follow-up GET is 200 with real flags | new: D8 mock plus `mockRejectedValueOnce`, T18 pattern (:1144-1171)                                  |
| R8  | never a role, reason, person id or grant                                                                 | `Object.keys(data)` is channels and viewer; `data.viewer` strictly equals the two booleans; the text has no role, reason or grant key, no quoted role literal, and no uuid outside the channel ids | new, owner viewer (the role-bearing case)                                                            |
| R9  | wire type pin                                                                                            | keyof ChatChannelListDto is channels and viewer; keyof ChatViewerDto is canModerate and canPostRestricted, both boolean; keyof ChatChannelDto unchanged                                           | `packages/core/src/api-contract.test.ts` (about :337)                                                |
| R10 | unchanged L15 behavior                                                                                   | T1 and T22 (:1240-1249, 401 and 400), :1428 (429), every L15 route test, and chat-stream-db.test.ts (G2 :629-634, no-store :615) stay green                                                      | existing                                                                                             |

Not tested here: any UI (L16b).

## 12. Test and harness rules

- Every DB run goes through the single DB/e2e lock (status/.db-e2e.lock, the session's locked-run.sh); NODE_ENV=test; known
  flakes per status/conductor-scripts/clerk-flake-list.txt (rerun once; a second red is real).
- No definer reader lock for the new tests (section 6). No migration runs.
- Acceptance commands: the S1 VERIFY set; `NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/web test` under the lock
  wrapper; `pnpm --filter @plexco/core test`; `pnpm build` once at the final head (sandbox off).

## 13. Scope

IN (FILES IN SCOPE, measured at the base):

- EDIT `apps/web/app/api/chat/channels/route.ts` (15 lines; the 200 path only): import `authorize` and the new type, two
  sequential awaits after `listChatChannels`, the typed body, the threat-model comment.
- EDIT `packages/core/src/api-contract.ts`: `ChatViewerDto` and `ChatChannelListDto` next to ChatChannelDto (:211-221), which
  stays unchanged.
- EDIT `apps/web/lib/chat-routes-db.test.ts`: the T25 edit, the T23 byte-equal compare, the `moderator()` parameters, the D8
  mock and the new describe (R1-R8).
- EDIT `packages/core/src/api-contract.test.ts`: the R9 keyof pins.
- NEW `docs/sessions/web-mvp-phase3-readiness-p3-m10-chat-viewer-capabilities.md` (this file).
- No helper in `apps/web/lib/chat-route.ts` (Q1); `apps/web/lib/chat-stream-db.test.ts` unchanged.

OUT (NEGATIVE SCOPE, the lane block plus measured items): no migration, table, column, index, trigger, policy, role, function
or grant; no new route; no role, grant, reason, person or membership identifier in the response; no per-channel flag; no
change to any L14 definer or to the checks they perform; no caching of the result; no change to rate limits, the SSE stream,
the listener or any other route; no capability other than the two named actions; no UI. Measured additions: no import of
`tenantsForPerson` or `resolveSessionCommandContext`; `packages/db/src/chat-channel-reads.ts`, the subscribe route and
`realtime-auth.ts` unchanged; no edit to a Reviewed spec or to `docs/standards/decisions.md`.

### Measured corrections (conductor note 3)

1. `chat-route.ts`: chatGate is :175-238 (doc comment :171-174) and runChat :241-258 (comment :240); the lane's "about
   :175-236 and :241" was approximate (S0a).
2. withChatActor is `packages/db/src/chat-service.ts:75-91`; the precedent mayManageSessions is
   `apps/web/lib/session-command-route.ts:115-125` (authorize at :121-123) (S0a).
3. EXECUTE on tenant_capability_authorize: `app` = t and also `chat_definer` = t on plexco_test, although 0049:134 grants
   `app` only; not investigated; no L15b impact (section 16 item 1) (S0a).
4. ChatChannelDto is the interface at `api-contract.ts:211-221`; the lane's :214 lies inside it (S0b).
5. decisions.md has no "role-read" term (count 0); DD-56's no-role-read property is enforced by
   `apps/web/lib/role-read-guard.test.ts:6-16` and :57-60 (S0b).
6. The DD-56-read-routes row is `decisions.md:2046`; part A's pointer :135 is the DD-122 DEFAULTS row (orchestrator, S0c).
7. `tenant_admins` (`packages/db/schema.ts:819-826`) has no person-id column and no removed or revoked column: rows are keyed
   by (platform, platform_user_lookup_hash), and web fixtures write platform 'web' with the person id as the lookup hash
   (`chat-routes-db.test.ts:942-944`, :294-296). "Inactive or removed" is pinned as D6 (orchestrator, S0b).
8. The authority-test fixtures are module-local: reuse means copying their shape, not importing them (S0b).
9. The wire-contract test is `packages/core/src/api-contract.test.ts` (about :337); S0b had not located it (orchestrator).
10. L16's planned files (apps/web/components/chat, lib/use-chat, lib/chat-api) do not exist yet; the L16 worktree holds only
    its readiness commit (S0b, orchestrator).
11. `chat-stream-db.test.ts` already sweeps the /channels 200 body for seeded person uuids and `authorPersonId` (:585,
    :629-634): a free regression, no edit (S0c).

## 14. Spec follow-up for L17

`docs/features/BE/feature_inapp_chat_tech.md` (Reviewed): the canonical DTO whitelist (:1169) and the route entry (:1140) get
`viewer` through the L17 closeout (the conductor lists it). No Reviewed spec is edited in this lane; the PR body says so.

## 15. Review plan

opus/max code reviewer plus an opus/max security round (an authorization result reaches the client), at most 3 rounds
(pre-push rounds count). Questions: any path where a non-member, a plain member or another tenant's admin gets a true; any
leak of the role, reason or an id; a cache or a stale-trust assumption; byte-equality of the unchanged denials; an
infrastructure error collapsing to allow or to a quiet false; the claims the comments make.

## 16. OPEN (non-blocking; owner named per item)

1. OUT_OF_SCOPE (owner: conductor, for L17 or a hardening lane): `chat_definer` holds EXECUTE on tenant_capability_authorize
   on plexco_test although 0049:134 grants only `app`; source not investigated; no L15b impact (the web transaction runs as
   `app`).
2. Coordination (owner: conductor, for L16): L16 must not strictly validate or deep-compare the /channels `data` object, so
   the additive `viewer` key cannot break its parser or e2e mocks. Not a blocker.
3. Spec follow-up (owner: L17): section 14.
4. Sign-off (owner: owner, through L17's one consolidated entry): defaults D1-D8.

## 17. Searched (logged queries)

- S0a on decisions.md: `grep -n -i -c capability` = 65; `grep -n -i -c authorize` = 170; `grep -n -i -c role-read` = 0;
  `grep -n -E '^#{1,4} .*DD-56'` = :748.
- S0b: `grep -n -c 'DD-60' decisions.md` = 5; `api-contract.ts` viewer, capability and can-prefix names = 0;
  `git grep -n -i -E 'ChatChannelDto|whitelist' -- docs/features/BE`, chat hit feature_inapp_chat_tech.md:1169;
  api-reference-convention.md additive or unknown-key rule = 1 unrelated hit (:79).
- S0c: `sed -n '748,800p;2046p' decisions.md` (the DD-56 body and the DD-56-read-routes row); `client.ts` timeouts = 0;
  `chat-stream-db.test.ts:575-634`; `tenant-capability-authority.test.ts` cross-tenant cases :194-197, :282-284, :330-331.

## 18. Closure matrix (12 of 12) and verdict

| #   | Gate                                    | Evidence                                                                                                         | Result |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Authority snapshot pinned by SHA        | `AUTHORITY_SHA` = worktree HEAD = session base; every TARGET_FILES path exists at the base                       | PASS   |
| 2   | Decisions in scope final                | "moderation ok" and D4 signed; DD-56 and DD-56-read-routes read (section 1); D1-D8 pinned as defaults            | PASS   |
| 3   | Scope IN/OUT and owner clear            | section 13; lane NEGATIVE SCOPE; L16 owns the chat UI, L16b the moderation UI, L17 the spec                      | PASS   |
| 4   | Dependencies classified                 | L15 (#86), L14 (#83), L15a (#87) and the capability core (0047, 0049) on the base; L16 not a dependency          | PASS   |
| 5   | Live schema and code match              | sections 2-6, measured at the base and in the plexco_test catalog                                                | PASS   |
| 6   | Data, API, state, auth contract         | section 8                                                                                                        | PASS   |
| 7   | Fail-closed, idempotency, order         | a deny is false; infrastructure errors rethrown to the 500 row; flags only after every pre-gate; read-only path  | PASS   |
| 8   | Open questions in scope = 0             | section 10 pins; section 16 is non-blocking                                                                      | PASS   |
| 9   | Acceptance matrix with expected results | section 11                                                                                                       | PASS   |
| 10  | Migration, security, rollback           | no migration, function or grant; security round; rollback = revert the additive commit                           | PASS   |
| 11  | First slice hard dependencies merged    | L15 and the capability core on the base; owner "moderation ok"                                                   | PASS   |
| 12  | Implementation handoff ready            | sections 2-15; worktree at the base with only this file added                                                    | PASS   |

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-20
AUTHORITY_SHA: a23fe96d3b9045a5f143b19bac9b31be97a2daff
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/review-code-readiness-gate.md
  - docs/standards/decisions.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m10-chat-api-live.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m10-chat-author-labels.md
  - docs/features/BE/feature_inapp_chat_tech.md
  - packages/db/schema.ts
  - packages/db/migrations/0047_tenant_capability_authority_core.sql
  - packages/db/migrations/0049_tenant_capability_authorize.sql
  - packages/db/migrations/0063_chat_message_commands.sql
  - packages/db/src/tenant-capability-authority.ts
  - packages/db/src/tenant-capability-authority.test.ts
  - packages/db/src/tenant.ts
  - packages/db/src/chat-service.ts
  - packages/db/src/chat-channel-reads.ts
  - packages/db/src/test-harness.ts
  - packages/core/src/api-contract.ts
  - packages/core/src/api-contract.test.ts
  - apps/web/app/api/chat/channels/route.ts
  - apps/web/lib/chat-route.ts
  - apps/web/lib/chat-routes-db.test.ts
  - apps/web/lib/chat-stream-db.test.ts
  - apps/web/lib/session-command-route.ts
  - apps/web/lib/role-read-guard.test.ts
SLICE: p3-m10-chat-viewer-capabilities
IN_SCOPE: section 13 IN - two authorize() booleans as data.viewer on the 200 path of GET /api/chat/channels, the additive response types, route DB and wire tests
OUT_OF_SCOPE: section 13 OUT - migrations, tables, columns, policies, roles, functions, grants; new routes; role, reason, person or grant in the response; per-channel flags; L14 definers; caching; rate limits, SSE stream, listener, other routes; other capabilities; UI
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: L15 merged (#86) and the capability core (0047, 0049, authorize()) on a23fe96d3b9045a5f143b19bac9b31be97a2daff; owner "moderation ok" (2026-10-20); D4 signed
PRIOR_SLICES: L14 (P3-S11, #83), L15 (P3-S12, #86), L15a (P3-S12a, #87)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration, no function, no grant; booleans only; opus/max reviewer + security round
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: re-check HEAD, then ChatViewerDto and ChatChannelListDto in packages/core/src/api-contract.ts and the 200 path of apps/web/app/api/chat/channels/route.ts, then the tests R1-R10
REMAINING_BLOCKERS: none
```
