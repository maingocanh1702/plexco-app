<!-- review-readiness: code-ready -->

# Step-0 readiness: L10 p3-m9-public-projector (session P3-S7)

> Agent-facing. Readiness reviewers opus/max: #1 measured sections 0-5 and stopped at the token rule; #2 (fresh) closed the remaining
> measurements, applied the orchestrator rulings R-1..R-3 and wrote sections 4.8 and 6-12. Writer opus/max; code reviewer opus/max +
> opus/max security round, at most 3 rounds (DD-122 D4).
> Every `path:line` is MEASURED at base `ff9e15333956e370d41281d7cb33bb6708b1a9e0` (lane block measured at `c762c90`). TARGET_FILES are
> read-only context that exists at the base; new files are scope, never TARGET_FILES.

## 0. Threat model (binding, nothing wider)

- Adversaries: (1) any anonymous public reader (reaches the view and the two lookup definers through `readonly` once L10b adds a
  route); (2) any code running as `app` / `app_worker` / `readonly`, a compromised web or worker process included (`app` can INSERT
  `outbox_events`, so a forged or replayed event must at most cause a recompute from canonical rows, never a write of attacker data);
  (3) a club admin (`content.manage` / `session.manage`: alias text, publish, visibility, roster).
- Trusted: the platform owner holding `DATABASE_URL_MIGRATION`.
- HALT conditions the contract makes impossible: any re-grant of base SELECT on `public_sessions` (table or column) to `app` or
  `readonly`; any public field beyond the approved whitelist; `host_display_name` or any person name in the view; `confirmed_count`
  anywhere; a club served without an approved alias.

## 1. Base, dependencies, authority (Q1) - DONE

- W HEAD = `ff9e15333956e370d41281d7cb33bb6708b1a9e0` = local `origin/main` ref; branch `feat/p3-m9-public-projector`; porcelain
  empty; no `index.lock` in `.git/worktrees/p3-m9-public-projector`. Migration tail `0060_tenant_public_alias.sql`, 61 `.sql` files
  (0000..0060) => next free **0061**.
- Every DEPENDS ON lane is merged at the base (orchestrator log `N/t1-step0-remaining.log` item 9): L3 = #64 outbox-delivery-core
  (98a4a6c, 0056; header :3 "lane L3"), L6 = #63 visibility-toggle (442aa1b; RUN-snapshot.md:387), L7 = #65 occupancy-helper
  (8c38291), L8 = #68 join-core (dbdc061, 0058; player.promoted route 0058:104-107 per 0057:240-241), L10a = #71 (ff9e153, 0060).
  Also merged: #62 harness hardening, #66 zalo-outbound (0057), #67 web-live-sync, #69 announce route, #70 me-reads (0059).
- D1 = DD-133 SIGNED (a)-(e): `decisions.md:1837` (✅ owner 2026-10-16), `:1859` "Phase 3 plan approved. D1 signed (a)-(e)."
- DD-133 binds: (a) one helper `getSessionOccupancy`, `slots_open` = NULL if `slots_max` NULL else max(0, slots_max - occupied),
  public DTO only `slots_open`, `confirmed_count` tenant-private (:1844-1845); (b) `session_occupancy(p_session_id uuid)` SECURITY
  INVOKER, REVOKE PUBLIC (:1845-1846); (c) DD-41 columns; (e) `public_listing_id` random, opaque, 128-bit, rotated whenever the
  session leaves public; hash-only slug (DD-83/DD-75) only for host-shared links; view exposes neither `session_id` nor
  `public_projection_version`; lookup server-side (:1846-1847); (b)(c)(e) in ONE L10 migration that REPLACES
  `public_session_share_v` (0033:132-145): exact approved whitelist, NO `host_display_name` (table column may stay, never written),
  + DD-41 columns + `public_listing_id`, live filter on the tenant's currently approved alias (:1847-1849); whitelist test
  `rls-invariants.test.ts:171` amended (:1849); a club without an approved alias is never projected (:1851); host/person names never
  projected (:1852-1853); function is SQL because `app_worker` has no base grant (:1854).
- BL-DSC-1 (`business-rules.md:50`, v1.34 synced to DD-133): sport_key, starts_at, ends_at, area, price_amount, `slots_open`, club
  display name (approved alias, read live), join_policy, `public_listing_id`; policy fields title, session_type, level_min_rank,
  level_max_rank, level_strict, gender_restriction, age_min, age_max; `confirmed_count` never public; no host/person name; RETIRE
  public `skill_level`; routing tenant id never serialized; no roster, debt/payment, contact, venue detail, STK, notes, instructions,
  byoe, cost_shared; hold count/identity never serialized.
- DD-12 (:283-293): projector writes `public_sessions` (no materialized view); immediate-deny = fences + guarded-view anti-join +
  narrow typed functions; the privacy-reducing mutation raises the fence in the SAME source transaction; the projector CAS-clears the
  exact token after convergence; projector writer keeps narrow rights; never a state where base or view are both readable. DD-12
  carries NO sync-lag number. The budget DONE WHEN cites is NFR-1c: `docs/product/BRD.md:160` (sync lag p95 <= 3 s, p99 <= 10 s) =
  `docs/product/TDD.md:125` (sync-lag p95 <= 3s, p99 <= 10s; re-projection closes drift); FE spec :74 "Projector lag > SLO", :514
  metric `marketplace_projection_lag`. Dispatch stays OFF in this lane, so DONE WHEN is pinned as P-15 (no timing claim).
- DD-41 (:577-591): title (public, moderated), `session_type` ONE field social|class|coaching|tournament|singles, level_min_rank /
  level_max_rank (DD-08 ranks) + level_strict, gender_restriction, age_min / age_max; skill_level cutover: stop projecting, DROP
  `skill_level` from schema/projection + update the exact-column test (:587); public whitelist additions (:589).
- DD-75 (:1053-1068): slug lifecycle (:1065) CSPRNG >= 128-bit, mint only for active published+public, store a domain-separated
  hash/HMAC never the raw slug, at most one active slug, invalid/tombstoned/non-public/fenced = the same fixed 404, revoke or leaving
  public tombstones, re-publicize mints a new slug and the old hash 404s forever, lookup narrow/global-only; (:1064) exact-token clear
  projector-worker-only, projector locks and re-reads current sources, token never returned/logged; (:1066) base/fence carry no
  blanket grant for app/readonly, narrow SECURITY DEFINER only.
- DD-83 (:1178-1187): session URL = opaque slug `/session/<slug>`; shared registry invariants: tombstone, reserved words (human-readable
  kinds only), every public URL reads only the guarded view, never canonical, never `tenant_id`/PII. Handle uniqueness/reserved words
  stay unbuilt (not this lane: session kind only).
- DD-114 D3: summarised by DD-133 :1841-1842 (four preconditions: opaque-slug route, DD-41 columns, one occupancy helper, moderated
  alias; "a slice touching projection values AWAITs until the epic is authorized" => authorized by DD-133). 0036:20-25: only a slice
  that CREATES a writer path needs D3's authorization => this lane, authorized. D3 heading measured at `decisions.md:2563`
  (orchestrator log item 9; reviewer #1's `\bD3\b` ERE returned nothing under git grep).

## 2. Lane-block and pre-measure citations re-measured at the base (Q2) - DONE

- PRE-MEASURE CORRECTION (binding): pgcrypto IS installed: `0000_roles_extensions.sql:17` `CREATE EXTENSION IF NOT EXISTS pgcrypto;`,
  used at `0043_identity_link_code_issue_consume.sql:411` (`gen_random_bytes(16)`) and :412 (`digest`); 0043:409 notes pgcrypto lives
  in `public` (on a definer's pinned search_path). Built-in `sha256()` used at 0034:353, 0060:230, 0060:261. So 128-bit CSPRNG values
  are available (not limited to `gen_random_uuid()`'s 122 bits). Catalog: `pg_extension` lists pgcrypto 1.3 in plexco_test
  (orchestrator probe, F-14).
- 0006:11-27 `public_sessions` ✓: id :12 PK (= sessions.id), session_id :13, tenant_id :14, sport_key :15, starts_at :16, ends_at :17,
  area :18 NOT NULL, skill_level :19, price_amount :20, slots_open :21 NOT NULL, club_display_name :22 NOT NULL, host_display_name :23,
  join_policy :24, projected_at :25 DEFAULT now(), expires_at :26 NOT NULL; indexes :31-34.
- 0033 ✓: `public_projection_version bigint NOT NULL DEFAULT 0` :87-88; CHECK id = session_id :98-99; fence table :102-112 (PK surface,
  target_kind, target_id; zero grants :113-115); view :132-153 (cols :134-144, `expires_at > now()` :146, fence anti-join :147-153,
  security_barrier :132); raise :157 (EXECUTE app :191; tenant check via app.tenant_id :173-180; token replaced on every raise :181-187);
  token :194 (EXECUTE app_worker :204); clear :208 CAS DELETE ... AND fence_token = p_observed_token, RETURNS boolean (EXECUTE app_worker
  :222); grants :237 REVOKE SELECT readonly, :238 REVOKE SELECT app, :239 GRANT SELECT view TO readonly; NB :232-236 (writer must read the
  base through a SECURITY DEFINER, never an app base SELECT). 0033 functions are owned by the migration role (:77-79); file runs in ONE
  transaction (:82-83).
- 0036:36 `REVOKE INSERT, UPDATE, DELETE ON public_sessions FROM app` ✓ (:30-33 measured inert, no writer).
- 0056 ✓: D-17 rules :10-15; posture :17-21; job_definer grants :29-35 (sessions id, tenant_id, status, starts_at, version; UPDATE
  status, version, updated_at; players session_id; charges session_id; outbox_events INSERT cols; EXECUTE raise :35); registry
  `outbox_projectors` :72-78 (zero grants :70-71); routes :83-103 (wildcard chk :97-98 web_realtime only; zalo_dm chk :99-102; no chk on
  public_sessions routes beyond event_type NOT NULL); seeds :105-108 (`public_sessions` seeded DISABLED :106; only route = web_realtime
  session wildcard :107-108); `outbox_required_projectors` :113 (EXECUTE app_worker :141); `projector_is_enabled` :144 (app, app_worker
  :154); `outbox_projector_set_enabled` :157 owner path only, no grant (:156).
- 0057 ✓: grants :22-32 (players id, tenant_id, session_id, membership_id, status, joined_at :25; sessions ends_at, timezone :28;
  REFERENCES :31-32); bracket `GRANT CREATE ON SCHEMA public TO job_definer; SET ROLE job_definer;` :38-39 ... `RESET ROLE;` :247 `REVOKE
  CREATE ON SCHEMA public FROM job_definer;` :248; route INSERT :242-245.
- 0058:104-107 route bracket (SET ROLE job_definer / INSERT / RESET ROLE) ✓.
- 0060 ✓: columns + CHECKs :28-34; header :18-25 (app / app_worker / readonly hold ZERO privileges on tenants; set/read EXECUTE app;
  decide/pending no grant; payload exactly {"status"}; aggregate 'tenant' has no route "until L10 adds one" :24); set event :154-158
  (`tenant.public_alias_set`, aggregate 'tenant', aggregate_id = tenant id); decide event :243-247 (`'tenant.public_alias_' ||
  p_decision`).
- Bot: `projectors/public-sessions.ts` = 13-line placeholder (dlq projector_not_implemented :10-13) ✓; `projectors/index.ts:2` import,
  :22 entry ✓ (:10-11 "L10 replaces only their own module file and never edit this one"); `projector-registry.test.ts:59-75` asserts the
  placeholder (:60 title, :64 names, :67-73 loop, :74-75 no I/O) ✓; `zalo-dm.ts` 246 lines: `createZaloDmDeliver` :83, claim-bound
  definer call :136, error mapping :126-158, lazy app_worker pool on `DATABASE_URL_DIRECT` :223-239 ✓; `preflight.ts` assertIdentity
  :98-118 (both session_user and current_user must be app_worker :112) ✓.
- dispatcher.ts: `ClaimedDeliveryJob` :25-34 (eventId, tenantId, projector, claimToken, attempts, event); `DeliveryOutcome` :41-44
  (delivered | retry | dlq + errorCode); `DeliverFn` :46; per-row deliver :254-269 (a throw => dlq `deliver_threw`); per-row completion
  :285-317 (22023 => dlq `malformed_outcome`); `MAX_DELIVERY_ATTEMPTS = 8` :16; `ERROR_CODE_RE` :372. A dlq/retry is recorded for that
  row only (reviewer #1 :254-317). Break scope measured at the base: phase 2 loops per projector in name order (:111-114, :174-176);
  `continue` :223 skips a disabled or unmapped projector; the `break`s at :228 (batch limit), :235 (no row) and :243 (lease lost) end
  only THAT projector's inner loop for this cycle => a poison event never blocks its siblings or other projectors.
- `ProjectorEvent` (`apps/bot/src/projector-registry.ts:13-21`): eventType, aggregateType, aggregateId, sequence, tenantId, payload,
  createdAt.
- packages/db: `session-occupancy.ts` (72 lines) ✓ activeCountSql :38, occupiedCountSql :44, scalar :49, sessionActiveRosterCount :59,
  getSessionOccupancy :65, slotsOpen :70; OC-1 :32-35; "NOT exported from index.ts" :10. `session-read.ts`: activeCountSql(sessions.id,
  tenantId) :222, occupiedCountSql(sessions.id, tenantId) :225 (only production caller) ✓, explicit outer `eq(sessions.tenantId,
  tenantId)` :232, clampSessionLimit :83-85, `SESSION_LIST_MAX_LIMIT = 50` :40 ✓. `public-session-fence.ts` (30 lines)
  raisePublicSessionFence :24 only ✓. `index.ts` exports only public-alias of these (:275) ✓; `package.json` exports :7-17 ✓.
- schema.ts: sports :32 (key :34 unique); tenants :513 (status :517 default 'trialing'; publicAlias :523, publicAliasStatus :524);
  sessions :620-664 (sport_id :623, area :629 nullable, skill_level :630, price_amount :631 NOT NULL, slots_max :632, visibility :633,
  join_policy :634, status :635, version :636; `sessions_public_capacity_chk` :653-656 = NOT (public AND slots_max NULL) from 0024;
  candidate key (tenant_id, id) :663); NO title / session_type / level_* / gender_restriction / age_* column on sessions ✓; players :704
  (status active|left|waitlisted :709); session_guest_notes :767 (same-tenant composite FK :783-785 = 0044:100); publicSessions
  :1609-1641 (check :1640) ✓; publicProjectionFences :1648. db.dbml `Table public_sessions` :492-510 ✓.
- CLOSED at the base (reviewer #1's open list; measured by the orchestrator, log `N/t1-step0-remaining.log` items 1-11, and confirmed
  by reviewer #2 with `N/scripts/l10-verify-r2.sh`): migrate.ts posture = F-9; join_request routing = F-10; the audit table = F-11; the
  bracket and route form = F-12; the fence anti-join columns = F-13; catalog (0 rows, no dependent view, owners, ACLs) = F-14; every
  count pin and rls-invariants.test.ts site = section 8. Reviewer #1's open list, kept for the record: count pins (`grep -n -E 'MIGRATION_COUNT|0060|\b6[01]\b'` in migrate.test.ts, rls-invariants.test.ts,
  outbox-projector-registry.test.ts; brief: migrate.test.ts:53, rls :70 :73 :1753 :1758 :2036 :4611 :4614, registry :114 :117);
  rls-invariants.test.ts :165-225, :260-275, :351-451; migrate.ts posture (`grep -n -E 'SET ROLE|BEGIN|COMMIT|superuser|rolsuper'`);
  join-request-service.ts:330-360 (does approval insert a players row?); catalog probes (row count, view dependents, owners).

## 3. Measured facts the contract rests on

- F-1 Event types (aggregate 'session', aggregate_id = session id; `emitSessionEvent` `roster-money-shared.ts:154-168`, session-service
  aggregateType "session"): session.created SS:317, session.published :699, session.announcement_requested :989, session.updated :1591,
  session.visibility_changed :1607, session.closed :1994, session.expiry_anomaly_detected :2352, session.cancelled :2407,
  guest_note.created :2887, guest_note.deleted :3022; player.added and **player.waitlisted** (`roster-service.ts:192`,
  `session-join-service.ts:281`; player.waitlisted is MISSING from the brief's list), player.removed (`roster-service.ts:407`,
  `session-join-service.ts:355`), player.promoted (`session-join-service.ts:427`); join_request.created (`join-request-service.ts:149`),
  join_request.approved (:357), `join_request.${status}` (:392). Tenant aggregate: tenant.public_alias_set (0060:156),
  tenant.public_alias_approved / _rejected (0060:245), aggregate_id = tenant id.
- F-2 No production reader or writer of public_sessions / the view: outside migrations and rls-invariants the only hits are schema.ts
  :1620-1621, db.dbml :503-504, README.md:72, client.ts:10 (comment) and TESTS.
- F-3 Test sites that break when the view drops session_id, adds the alias filter, or the table drops club_display_name:
  `outbox-projector-registry.test.ts:823` (owner INSERT incl. club_display_name) and :831 (`SELECT ... FROM public_session_share_v WHERE
  session_id = $1`); `session-service.test.ts:2190/:2200`, `:3567/:3576`, `:4036/:4045` (same pattern, readonlyPool). => test-only
  scope additions (fixture: owner sets tenants.public_alias + 'approved'; query by public_listing_id read from the base as owner).
- F-4 Advisory-key convention: `pg_advisory_xact_lock(hashtextextended('<ns>:' || <uuid>::text, 0))` (club-config.ts:69,
  session-service.ts:238).
- F-5 Same-tenant composite FKs: 0019:127/:131/:139/:157 (players among them, research doc :44 cites 0019:129-131) and 0044:100 guest
  notes => every counted row of a session shares its tenant; indexes idx_players_session, idx_session_guest_notes_session (research :44).
- F-6 sessions_public_capacity_chk (0024; schema.ts:653-656) makes "public with NULL slots_max" unrepresentable.
- F-7 Occupancy research (`docs/research/occupancy-authority-2026-10-16.md`): :44 keyed by session id only is tenant-exact under app RLS
  and inside a BYPASSRLS definer; :83 stage-2 function in the projector migration; :84 view replacement; :91 part (b).
- F-8 Discovery BE tech: periodic sweep `DELETE WHERE expires_at < now()` :195, :220; detail route UNPINNED, L10b, keyed by
  public_listing_id :27, :109; v2.8 changelog :293 (host_display_name legacy, never written). FE: MKT-UC-1 :46 (projection only when
  status 'open', never draft); edge 8 :74 (expiry guard vs projector lag); level fields :493; metric :514.
- F-9 `migrate.ts` runs each migration file in its own transaction (BEGIN :351, COMMIT :357), so 0061's DELETE, DROP VIEW, ALTER,
  CREATE and SET ROLE bracket commit or roll back together; the migration owner (`DATABASE_URL_MIGRATION`) is NOCREATEROLE (:256) and
  is not assumed superuser or BYPASSRLS outside local => every 0061 object that reads tenants or the fence table is created AS
  job_definer (P-12), independent of the migration role's attributes.
- F-10 `join-request-service.ts:357` emits `join_request.approved` through emitSessionEvent (aggregate 'session'); approval seats the
  requester as a players row, active or waitlisted (:332-354), and emits no player.* event => it changes occupancy and is ROUTED.
  join_request.created (:149) and the rejected / cancelled events (:392) leave only pending requests, which never occupy (L7 EQ
  fixture) => not routed (P-14).
- F-11 `0022:133-142` job_audit_events: job_id uuid FK to outbox_events, tenant_id FK, actor DEFAULT 'system', reason, fn_name,
  operation_id uuid NOT NULL; no UNIQUE (job_id) (:128); UPDATE and DELETE are trigger-rejected (append-only); owned by job_definer
  (orchestrator item 7) => a job_definer-owned definer INSERTs without a new grant (R-1).
- F-12 `0056:63-68` bracket (`GRANT CREATE ON SCHEMA public TO job_definer; SET ROLE job_definer;` ... `RESET ROLE; REVOKE CREATE ON
  SCHEMA public FROM job_definer;`) and the route INSERT form `0057:242-245` (also 0058:104-107): every job_definer-owned object and
  every route row of 0061 is created inside it.
- F-13 `0033:147-153` the fence anti-join also reads `deny_scope IN ('public', 'all')` => the view owner needs SELECT on (surface,
  target_kind, target_id, deny_scope) of public_projection_fences, a new grant (4.8) that reviewer #1 missed; `0033:173-180` the
  app.tenant_id GUC fail-closed check (copied by the slug rotate / revoke definers); `0060:31` the alias / status pair CHECK.
- F-14 Catalog in plexco_test (orchestrator items 7 and 11): clear_public_session_fence and current_public_session_fence_token owned by
  plexco, EXECUTE app_worker only; raise_public_session_fence owned by plexco, EXECUTE app and job_definer;
  outbox_projector_set_enabled owned by job_definer, EXECUTE job_definer only (tests enable the row as the owner or under SET ROLE
  job_definer, never in committed state); projector_is_enabled EXECUTE app and app_worker; the only non-plexco grant on
  public_sessions, public_projection_fences and public_session_share_v is readonly SELECT on the view; public_sessions has 0 rows; no
  view depends on public_session_share_v; outbox_projectors, outbox_projector_routes and job_audit_events are owned by job_definer
  (projector_deliveries by plexco); pgcrypto 1.3 is installed.

## 4. Contract

### 4.1 Schema: ONE migration `packages/db/migrations/0061_public_sessions_projector_writer.sql` (Q3) - DONE

- Order: Step 1 (migration role) `DELETE FROM public_sessions` (derived rows; F-2: no writer on main; F-14: 0 rows) and DROP VIEW
  public_session_share_v (no dependent view: F-14; in migrations only 0033 and a 0036 comment); ALTER public_sessions: DROP COLUMN
  host_display_name, club_display_name (served live from tenants), skill_level (BL-DSC-1 retire + DD-41 :587); ADD the 8 DD-41 columns
  (4.4); ADD `public_listing_id uuid NOT NULL DEFAULT (encode(public.gen_random_bytes(16), 'hex')::uuid)` + UNIQUE index; the
  column-narrow grants to job_definer (4.8). Step 2 bracket (F-12; 0057:38-39 / :247-248): GRANT CREATE ON SCHEMA public TO
  job_definer; SET ROLE job_definer; create session_occupancy, the writer definers, the registry table + definers, the lookups, the
  view and the 15 route rows (4.7); RESET ROLE; REVOKE CREATE. The whole file is one transaction (F-9).
- Definer owner = job_definer (0056:17-21; NOLOGIN BYPASSRLS, never granted to a runtime role). No new role (no db:bootstrap work).
- job_definer gains (new, column-narrow; exact SQL in 4.8): sessions SELECT (sport_id, area, price_amount, slots_max, visibility,
  join_policy) on top of 0056:29 / 0057:28; sports SELECT (id, key); session_guest_notes SELECT (session_id); tenants SELECT (id,
  status, public_alias, public_alias_status); public_projection_fences SELECT (surface, target_kind, target_id, deny_scope) for the
  view's anti-join and the P-16 check (F-13); public_sessions SELECT, INSERT and UPDATE on the 4.8 column lists, and DELETE. players
  (session_id, status) already held (0057:25); EXECUTE on raise not needed. count(*) under a WHERE on granted columns needs no other
  column privilege (only referenced columns are checked; A-14 runs it as job_definer). job_audit_events (F-11) and the new slug table
  are owned by job_definer => no grant on either.
- Runtime roles: app_worker gains EXECUTE on the writer definers, candidates and sweep only; readonly gains SELECT on the new view and
  EXECUTE on the two lookups only; app gains EXECUTE on session_occupancy and the slug rotate / revoke definers only. NO table-level or
  column-level SELECT on public_sessions for app or readonly (catalog test: has_table_privilege + has_any_column_privilege false);
  app DML stays revoked (0036:36).

### 4.2 Writer definers (Q4) - DONE

- `public_sessions_project_session(p_session_id uuid, p_event_id uuid) RETURNS text` (disposition; R-1) SECURITY DEFINER, SET
  search_path = public, pg_temp, VOLATILE plpgsql, REVOKE ALL FROM PUBLIC, EXECUTE app_worker. First statement
  `pg_advisory_xact_lock(hashtextextended('public-sessions:' || p_session_id::text, 0))` (F-4 convention; the slug rotate / revoke
  definers of 4.5 take the same lock, P-17), then recompute from canonical rows only (sessions, sports, tenants, session_occupancy,
  public_projection_fences), never from a payload; p_event_id is used only as the audit row's job_id; READ COMMITTED => each later
  statement sees rows committed before it.
- Eligible iff status = 'open' AND visibility = 'public' AND starts_at > now() AND btrim(coalesce(area, '')) <> '' AND slots_max IS NOT
  NULL AND tenant public_alias_status = 'approved' AND tenant status NOT IN ('suspended', 'cancelled'). Eligible => upsert ON CONFLICT
  (id) DO UPDATE ... WHERE (projected cols) IS DISTINCT FROM (EXCLUDED cols); slots_open = greatest(0, slots_max -
  session_occupancy(id)); expires_at = starts_at; projected_at = now(); public_projection_version = 1 on insert, +1 only when a projected
  column changed (idempotent re-delivery = no bump); public_listing_id never updated. Not eligible => DELETE the row (if any) and
  tombstone the session's active share slug; disposition 'deleted' | 'absent' | 'upserted' | 'unchanged' | 'rotated' |
  'ineligible_unlimited'.
- Fence rotation (P-16): an eligible recompute that finds a session_share fence row (deny_scope 'public' or 'all') for the session
  DELETEs the existing row (if any) and INSERTs a fresh one (new public_listing_id, active slug tombstoned), disposition 'rotated'; so
  a public to private to public flip that the projector only sees afterwards still rotates the id, even under lag.
- Slug tombstones (P-17): every INSERT of a new row (first entry, re-entry, rotation) and every sweep delete tombstone the session's
  active slug in the same transaction, so a slug never outlives the listing it was minted for.
- NULL slots_max (R-1): unrepresentable for public sessions (F-6), so this branch is defensive. Only when every other eligibility
  condition holds and slots_max IS NULL: no public row (delete if present), disposition 'ineligible_unlimited', and, when p_event_id IS
  NOT NULL, ONE append-only job_audit_events row (F-11): job_id = p_event_id, tenant_id = the session's tenant, actor 'system', reason
  'public_projection_ineligible_unlimited', fn_name 'public_sessions_project_session', operation_id = gen_random_uuid(). A NULL event
  id (the R-2 backfill) writes no audit row. The projector may log once (event id only); the row is the audit.
- `public_sessions_tenant_candidates(p_tenant_id uuid) RETURNS SETOF uuid` (EXECUTE app_worker): ids of the tenant's rows in
  public_sessions UNION its sessions with status 'open', visibility 'public', starts_at > now(); the projector calls the per-session
  definer for each (bounded locks per transaction; a crash retries idempotently). It doubles as the R-2 backfill (4.7).
- `public_sessions_sweep_expired(p_limit integer) RETURNS integer` (EXECUTE app_worker): delete up to p_limit rows with expires_at <=
  now() (+ tombstone their slugs, P-17); called by the projector after each delivery (BE tech :195).

### 4.3 session_occupancy(uuid) (Q5) - DONE

- `CREATE FUNCTION session_occupancy(p_session_id uuid) RETURNS integer LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public,
  pg_temp` body = (count active players where session_id = p) + (count guest notes where session_id = p), cast int; REVOKE ALL FROM
  PUBLIC; GRANT EXECUTE TO app (job_definer, its owner, executes it inside the writer).
- `occupiedCountSql(sessionId, tenantId?)` emits `session_occupancy(${sessionId})`; OC-1 kept by the list's explicit outer filter
  (session-read.ts:232) plus F-5 (rows keyed by session id are tenant-exact); `tenantId` parameter kept for signature compatibility
  (activeCountSql unchanged). getSessionOccupancy therefore calls the function too, so the parity oracle is fixture-derived literal
  counts (active / waitlisted / left / guest notes, plus a second tenant), checked through getSessionOccupancy (app, RLS) and through
  the projected slots_open (job_definer, BYPASSRLS).
- SET search_path blocks SQL-function inlining => one call per listed row: at most SESSION_LIST_MAX_LIMIT = 50 calls per list page
  (session-read.ts:40), two index-backed counts each (idx_players_session, idx_session_guest_notes_session); accepted at MVP size
  (P-19; no timing claim).

### 4.4 DD-41 columns and skill_level (Q6) - DONE

- ADD nullable: title text, session_type text, level_min_rank integer, level_max_rank integer, level_strict boolean,
  gender_restriction text, age_min integer, age_max integer (types per DD-41 :583-584; no CHECKs until sessions gains a source).
  sessions has no source at the base (schema.ts:620-664) => the writer writes NULL.
- skill_level: NOT in the approved whitelist (BL-DSC-1 "Retire public skill_level"; DD-41 :587; 0033:123-124) => dropped from the table
  and never projected.

### 4.5 Share-link registry and the two lookup definers (Q7) - choices made

- Table `public_session_share_slugs` (created AS job_definer, zero runtime grants like the fence table): slug_hash bytea PRIMARY KEY
  (32 bytes), session_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), revoked_at timestamptz (tombstone);
  UNIQUE (session_id) WHERE revoked_at IS NULL (one active slug). No FK (definers derive the session server-side; no REFERENCES grant).
- Raw slug = base64url of `gen_random_bytes(16)` without padding (22 chars, 128-bit CSPRNG, DD-75 :1065); stored only as
  `sha256(convert_to('plexco/session-share-slug/v1:' || slug, 'UTF8'))` (domain-separated; no HMAC because no secret provisioning).
- `public_session_share_slug_rotate(p_session_id uuid) RETURNS text` and `public_session_share_slug_revoke(p_session_id uuid) RETURNS
  boolean`: EXECUTE app only; tenant = app.tenant_id GUC, fail-closed exactly like 0033:173-180; rotate requires the session to be
  visible in the view now (else 55000), tombstones the active slug, mints a new one and returns the raw slug ONCE (never stored, never
  logged); revoke tombstones. session.manage authorization is L10b's service (no route here).
- Lookups (EXECUTE readonly only): `public_share_slug_resolve(p_slug text)` and `public_listing_resolve(p_public_listing_id uuid)`
  RETURNS TABLE (tenant_id uuid, session_id uuid) taken from public_sessions, returning a row only when not revoked AND the row is
  visible through the view (`EXISTS (SELECT 1 FROM public_session_share_v v WHERE v.public_listing_id = ...)`, one visibility
  authority). Slug lookup additionally returns public_listing_id (pin: L10b cannot reach the view row otherwise). (g) A NULL or
  malformed slug (anything not matching `^[A-Za-z0-9_-]{22}$`) resolves nothing.
- public_listing_id: uuid holding 128 CSPRNG bits (`encode(gen_random_bytes(16), 'hex')::uuid`), UNIQUE; the row is deleted whenever
  the session leaves public, so re-entry inserts a new value and the old one resolves nothing; the writer also tombstones the slug on
  every delete.

### 4.6 View replacement (Q8) - DONE

- DROP VIEW + CREATE VIEW in the one migration transaction (CREATE OR REPLACE cannot drop or reorder columns), created AS job_definer
  (it reads public_sessions, tenants alias columns and the fence table; holds on a non-superuser migration role that is a member of
  job_definer, as 0056-0058 already require). Closed by F-9 (migrate.ts runs the whole file in one transaction) and F-13 (job_definer
  gains SELECT on the four fence columns, 4.8). The rls-invariants view assertions that change are listed in section 8.
- `CREATE VIEW public_session_share_v WITH (security_barrier = true) AS SELECT ps.public_listing_id, ps.sport_key, ps.starts_at,
  ps.ends_at, ps.area, ps.price_amount, ps.slots_open, t.public_alias AS club_display_name, ps.join_policy, ps.title, ps.session_type,
  ps.level_min_rank, ps.level_max_rank, ps.level_strict, ps.gender_restriction, ps.age_min, ps.age_max FROM public_sessions ps JOIN
  tenants t ON t.id = ps.tenant_id WHERE ps.expires_at > now() AND t.public_alias_status = 'approved' AND t.status NOT IN ('suspended',
  'cancelled') AND NOT EXISTS (<0033:147-153 fence anti-join on ps.session_id>)`. Never: session_id, public_projection_version,
  tenant_id, slug, host_display_name, confirmed_count. REVOKE ALL FROM PUBLIC; GRANT SELECT TO readonly only.

### 4.7 Projector (Q9) - DONE

- `apps/bot/src/projectors/public-sessions.ts`: lazy app_worker pool on DATABASE_URL_DIRECT (zalo-dm.ts:223-239 pattern), raw SQL
  only (index.ts / package.json out of scope); the TS CAS-clear wrapper `clearPublicSessionFence` in public-session-fence.ts serves
  db-side code and tests.
- Per session event: token := current_public_session_fence_token(sid); disposition := public_sessions_project_session(sid, the
  delivered outbox event id); if token IS NOT NULL then clear_public_session_fence(sid, token) (delete AND upsert paths; a newer
  raise wins); then public_sessions_sweep_expired(100). Tenant event: for each id in public_sessions_tenant_candidates(tid) the same
  sequence.
- Outcomes (P-13): success => delivered; SQLSTATE 40001 / 40P01 / connection errors => retry; any other DB error => retry (bounded by
  MAX_DELIVERY_ATTEMPTS, then dlq attempts_exhausted); unknown aggregate_type => dlq `unsupported_event`; missing config => dlq
  `config_missing`; (f) an aggregate id that is not a UUID => dlq `malformed_event` before any SQL. Never throws (dispatcher
  :257-268). The dispatcher's breaks (:228, :235, :243) end only this projector's batch for the cycle and a retry or dlq is recorded
  for that delivery row only, so a poison event never blocks its siblings or other projectors.
- (e) Routes (P-14), 15 rows inserted inside SET ROLE job_definer. 12 for ('public_sessions', 'session'): session.published,
  session.updated, session.visibility_changed, session.closed, session.cancelled, player.added, player.waitlisted, player.removed,
  player.promoted, guest_note.created, guest_note.deleted, join_request.approved (approval moves the request into a players row,
  active or waitlisted, and emits only that event). 3 for ('public_sessions', 'tenant'): tenant.public_alias_set,
  tenant.public_alias_approved, tenant.public_alias_rejected. Not routed: session.created, session.announcement_requested,
  session.expiry_anomaly_detected, join_request.created, join_request.rejected, join_request.cancelled (pending requests never
  occupy). The registry row stays DISABLED; tests enable it only in their own DB via outbox_projector_set_enabled as owner.
- (h) R-2 enablement runbook (owner P0 step, no new code): enable the projector first, then for each tenant t with an approved alias
  run `SELECT public_sessions_project_session(c, NULL) FROM public_sessions_tenant_candidates(t) AS c` (a NULL event id writes no
  audit row).
- projector-registry.test.ts:59-75 becomes a test-only scope addition (no more placeholder).

### 4.8 Privilege statements in 0061 (binding) - DONE

```sql
-- Step 1, as the migration role, after the 4.1 DELETE, DROP VIEW and ALTER TABLE statements
GRANT SELECT (sport_id, area, price_amount, slots_max, visibility, join_policy) ON sessions TO job_definer;
GRANT SELECT (id, key) ON sports TO job_definer;
GRANT SELECT (session_id) ON session_guest_notes TO job_definer;
GRANT SELECT (id, status, public_alias, public_alias_status) ON tenants TO job_definer;
GRANT SELECT (surface, target_kind, target_id, deny_scope) ON public_projection_fences TO job_definer;
GRANT SELECT (id, session_id, tenant_id, sport_key, starts_at, ends_at, area, price_amount, slots_open, join_policy,
  projected_at, expires_at, public_projection_version, title, session_type, level_min_rank, level_max_rank,
  level_strict, gender_restriction, age_min, age_max, public_listing_id) ON public_sessions TO job_definer;
-- INSERT: every column except public_listing_id, which comes from its DEFAULT
GRANT INSERT (id, session_id, tenant_id, sport_key, starts_at, ends_at, area, price_amount, slots_open, join_policy,
  projected_at, expires_at, public_projection_version, title, session_type, level_min_rank, level_max_rank,
  level_strict, gender_restriction, age_min, age_max) ON public_sessions TO job_definer;
-- UPDATE: never id, session_id, tenant_id or public_listing_id
GRANT UPDATE (sport_key, starts_at, ends_at, area, price_amount, slots_open, join_policy, projected_at, expires_at,
  public_projection_version, title, session_type, level_min_rank, level_max_rank, level_strict, gender_restriction,
  age_min, age_max) ON public_sessions TO job_definer;
GRANT DELETE ON public_sessions TO job_definer;
-- Step 2 bracket (0056:61-69 precedent)
GRANT CREATE ON SCHEMA public TO job_definer;
SET ROLE job_definer;
-- CREATE the 4.2-4.6 objects here (all owned by job_definer, P-12), then:
REVOKE ALL ON FUNCTION session_occupancy(uuid), public_sessions_project_session(uuid, uuid),
  public_sessions_tenant_candidates(uuid), public_sessions_sweep_expired(integer),
  public_session_share_slug_rotate(uuid), public_session_share_slug_revoke(uuid),
  public_share_slug_resolve(text), public_listing_resolve(uuid) FROM PUBLIC;
REVOKE ALL ON public_session_share_slugs, public_session_share_v FROM PUBLIC;
GRANT EXECUTE ON FUNCTION session_occupancy(uuid), public_session_share_slug_rotate(uuid),
  public_session_share_slug_revoke(uuid) TO app;
GRANT EXECUTE ON FUNCTION public_sessions_project_session(uuid, uuid), public_sessions_tenant_candidates(uuid),
  public_sessions_sweep_expired(integer) TO app_worker;
GRANT EXECUTE ON FUNCTION public_share_slug_resolve(text), public_listing_resolve(uuid) TO readonly;
GRANT SELECT ON public_session_share_v TO readonly;
-- INSERT the 15 outbox_projector_routes rows of 4.7 (e), shaped like 0057:242 and 0058:105
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM job_definer;
-- Resulting state: no privilege on public_sessions or public_projection_fences for app, app_worker or readonly;
-- 0033:237-238 (base SELECT revokes) and 0036:36 (app DML revoked) stay in force.
```

## 5. Pinned defaults (Q12)

Each pin is a default this step-0 review applied; the writer repeats every pin in the PR body; L17 consolidates them into one
decisions.md entry (this lane never edits decisions.md). OPEN_QUESTIONS_IN_SCOPE is 0 because every open choice is pinned here.

- P-1 (default applied, pending owner sign-off): the 8 DD-41 columns (4.4 types) are nullable and written NULL; sessions has no
  source for them at the base.
- P-2 (default applied, pending owner sign-off): public_listing_id = uuid holding 128 CSPRNG bits, UNIQUE, never updated; a new
  value on every re-entry because the row is deleted whenever the session leaves public.
- P-3 (default applied, pending owner sign-off): slug registry per 4.5: hash-only domain-separated sha256; raw slug = 22-char
  base64url of 128 CSPRNG bits, returned once by rotate; tombstone on revoke, rotate and row delete; one active slug per session;
  no FK; the slug lookup also returns public_listing_id; a NULL or malformed slug resolves nothing.
- P-4 (default applied, pending owner sign-off): expires_at = starts_at; "future" means starts_at > now().
- P-5 (default applied, pending owner sign-off): public_projection_version = 1 on insert and is bumped by 1 only when a projected
  column changes (re-delivery = no bump); never served.
- P-6 (default applied, pending owner sign-off) = R-1: NULL slots_max => no row (delete if present), disposition
  'ineligible_unlimited' and one append-only job_audit_events row when an event id is given (4.2); this replaces the drafted
  console.warn; the branch is defensive (unrepresentable for public sessions under 0024).
- P-7 (default applied, pending owner sign-off): tenants with status suspended or cancelled are never projected (writer) and never
  served (view).
- P-8 (default applied, pending owner sign-off): skill_level, club_display_name and host_display_name are dropped after the
  `DELETE FROM public_sessions` of derived rows (0 rows at the base, F-14); club_display_name is served live from the approved alias.
- P-9 (default applied, pending owner sign-off): fence clear timing: observe the token before the recompute, CAS-clear after it on
  delete and upsert; a newer raise wins.
- P-10 (default applied, pending owner sign-off): sweep trigger: the projector calls public_sessions_sweep_expired(100) after each
  delivery; the view's expiry filter already hides expired rows.
- P-11 (default applied, pending owner sign-off): per-session lock `pg_advisory_xact_lock(hashtextextended('public-sessions:' ||
  p_session_id::text, 0))`, shared by the writer and the slug definers; tenant events fan out per session.
- P-12 (default applied, pending owner sign-off): job_definer owns every 0061 object (definers, session_occupancy, slug table,
  view); no new role, no db:bootstrap work.
- P-13 (default applied, pending owner sign-off): projector outcome mapping of 4.7 (retry bounded by MAX_DELIVERY_ATTEMPTS; dlq
  unsupported_event, config_missing, malformed_event; never throws).
- P-14 (default applied, pending owner sign-off): the 15 routes and the not-routed list of 4.7 (e).
- P-15 (default applied, pending owner sign-off): DONE WHEN = one dispatch cycle in a test projects the row; disappearance is
  immediate through the fence and the live alias filter, with no projector run; no timing claim (NFR-1c, BRD.md:160 and
  TDD.md:125, is measured after the owner enables dispatch).
- P-16 (default applied, pending owner sign-off): fence rotation of 4.2: an eligible recompute that finds a session_share fence
  replaces the row (new public_listing_id, active slug tombstoned), disposition 'rotated'.
- P-17 (default applied, pending owner sign-off): slug tombstones on every new-row insert and every sweep delete, in the same
  transaction, under the P-11 lock.
- P-18 (default applied, pending owner sign-off): the bot reaches the definers by raw SQL on the lazy app_worker pool; index.ts and
  package.json untouched; clearPublicSessionFence (public-session-fence.ts) serves db code and tests.
- P-19 (default applied, pending owner sign-off): occupiedCountSql emits session_occupancy(x); at most 50 per-row calls per list
  page (SESSION_LIST_MAX_LIMIT, session-read.ts:40) accepted at MVP size.

Orchestrator rulings applied:

- R-1 (default applied, pending owner sign-off): the NULL slots_max audit is a durable job_audit_events row, not a log line (P-6).
- R-2 (default applied, pending owner sign-off): the per-tenant candidates definer doubles as the backfill; the enablement runbook
  is 4.7 (h); no new backfill code (O-3).
- R-3 (default applied, pending owner sign-off): B3 caps derived from the per-file estimate of section 9, with headroom sized by
  L10a's measured overrun (31% non-test, 64% test).

## 6. Implementation steps (dependency order, test-first)

- Step 1: GitNexus impact (upstream) on occupiedCountSql, getSessionOccupancy, raisePublicSessionFence and the public-sessions
  placeholder deliver function; report the blast radius in the PR body (a grep of callers if GitNexus is unavailable).
- Step 2 (red first): the count pins of section 8; new packages/db/src/public-sessions-projector.test.ts (PSP-1..PSP-11) and
  apps/bot/src/projectors/public-sessions.test.ts (PSB-1..PSB-6); the rls-invariants.test.ts amendments; projector-registry.test.ts
  lines 59-75. Run them red against the base schema.
- Step 3: packages/db/migrations/0061_public_sessions_projector_writer.sql per 4.1-4.8 (Step 1 statements, then the job_definer
  bracket); run the db suite alone (one migration at a time, one DB lock).
- Step 4: packages/db/src/session-occupancy.ts (occupiedCountSql emits session_occupancy) and packages/db/src/public-session-fence.ts
  (the clearPublicSessionFence CAS wrapper); packages/db/schema.ts and packages/db/db.dbml mirror 0061.
- Step 5: apps/bot/src/projectors/public-sessions.ts replaces the placeholder (4.7); the registry row stays disabled.
- Step 6: the S1 VERIFY set, `NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test` and `pnpm --filter @plexco/bot
  test`; B3 numstat against the section 9 caps; detect_changes before each commit.

## 7. Acceptance matrix (Q10, Q11)

| ID | Covers | Test | Expected |
|---|---|---|---|
| A-1 | TESTS whitelist of the table, the view and the projector's writes | rls-invariants.test.ts :171 amended; PSP-1 | table = exactly the 22 columns of 4.8; view = exactly the 17 columns of 4.6; the projected row has no gender, price_male, roster, PII, slots_max, confirmed_count, host or person name; the view has no tenant_id and no host_display_name |
| A-2 | DT1 eligible session | PSP-1; PSB-1 | one whitelist row upserted with slots_open = greatest(0, slots_max - session_occupancy(id)) at delivery; readable through the view after one dispatch cycle (P-15) |
| A-3 | DT2 draft even if public, private, closed, cancelled, past, blank area, NULL slots_max | PSP-2 | no row; an existing row is deleted; sibling sessions unaffected |
| A-4 | DT2 NULL slots_max audit (R-1) | PSP-3: drop sessions_public_capacity_chk inside a transaction, SET LOCAL ROLE app_worker, call the writer, ROLLBACK | disposition 'ineligible_unlimited', no row, exactly one job_audit_events row with reason public_projection_ineligible_unlimited; a NULL event id writes none |
| A-5 | DT3 and TESTS alias rejected hides at once | PSP-4 | after a reject or an edit back to pending the view returns none of the club's rows, with no projector run |
| A-6 | DT3 tenant re-projection | PSB-3 | a tenant alias event deletes or re-projects every candidate session of that tenant |
| A-7 | TESTS fence immediate-deny then CAS-clear | PSP-5 | a raised fence hides the row at once; CAS-clear with the observed token clears it; a newer raise between observe and clear survives |
| A-8 | DT4 public to private, cancel, close | PSB-4 | the row is deleted, then the fence is CAS-cleared only if the token is still the observed one |
| A-9 | DT5 and TESTS permuted event order | PSB-5 | every permutation of occupancy and roster events converges to the same row and slots_open |
| A-10 | TESTS idempotent projector; forged payload | PSP-6; PSB-6 | a re-delivery returns 'unchanged' with no version bump; a forged payload causes at most a recompute from canonical rows |
| A-11 | TESTS a poison event does not block siblings | PSB-2 | a retry or dlq outcome on one delivery leaves its sibling deliveries delivered |
| A-12 | TESTS readonly cannot SELECT the base, app cannot write it | rls-invariants.test.ts :212-221 and :351-451 | readonly SELECT on public_sessions denied; app INSERT, UPDATE and DELETE denied; has_table_privilege and has_any_column_privilege false for app and readonly |
| A-13 | TESTS slots_open parity | PSP-7 | getSessionOccupancy and the projected slots_open match literal fixture counts (active, waitlisted, left, guest notes, a second tenant) |
| A-14 | Catalog of every new function | PSP-8 | prosecdef true for the definers and false for session_occupancy; proconfig search_path = public, pg_temp; ACL exactly per 4.8 with no PUBLIC entry; count(*) runs as job_definer |
| A-15 | DT6 and TESTS slug hash-only, revoke, rotate | PSP-9 | only the sha256 is stored; the raw slug is returned once; a revoked, rotated-away or malformed slug resolves nothing |
| A-16 | DT6 and TESTS public_listing_id unique, 128-bit, rotated on leaving public | PSP-10 | unique index; a new value after leaving and re-entering public; the old value resolves nothing |
| A-17 | TESTS the view never exposes session_id or public_projection_version | rls-invariants.test.ts :171; PSP-8 | neither column, nor slug or tenant_id, is in the view's column list |
| A-18 | DT7 expires_at before now() is swept | PSP-11 | the sweep deletes expired rows and tombstones their slugs; the view hides them before the sweep |
| A-19 | Routes and the registry row | PSP-11 | exactly the 15 routes of 4.7 (e); the public_sessions registry row is disabled in committed state |
| A-20 | Count pins and existing readers | section 8 files | every listed pin updated; existing view and table readers green |

Decision-table rows: DT1 A-2; DT2 A-3, A-4; DT3 A-5, A-6; DT4 A-7, A-8; DT5 A-9; DT6 A-15, A-16; DT7 A-18. Lane TESTS items:
whitelist A-1; alias hides at once A-5; permuted order A-9; idempotent A-10; poison A-11; base deny A-12; fence A-7; parity A-13;
slug A-15; listing id A-16; view columns A-17.

## 8. Test-only scope additions and harness rules (Q10)

- Count pins forced by 0061: packages/db/src/migrate.test.ts :53 (MIGRATION_COUNT 61 becomes 62) and :769 (the tail
  0060_tenant_public_alias.sql becomes 0061_public_sessions_projector_writer.sql); packages/db/src/rls-invariants.test.ts :70, :73,
  :1753, :1758, :2036, :4611, :4613, :4614; packages/db/src/outbox-projector-registry.test.ts :114 (title), :115, :117, :120.
- rls-invariants.test.ts (in scope): the whitelist list :174-205 (entries session_id :180, skill_level :186, club_display_name :189,
  host_display_name :190, public_projection_version :198) becomes the exact 22-column table list plus a separate 17-column view
  list; the view count read :221; the owner INSERT of a projection row :266-268 loses club_display_name; the view read `WHERE
  session_id = $1` :296 becomes a public_listing_id read; the owner base read :301; the catalog lines :450-452 (readonly SELECT on
  the view true, app and app_worker false) stay.
- Other test-only additions: outbox-projector-registry.test.ts :823 and :831; session-service.test.ts :2190 and :2200, :3567 and
  :3576, :4036 and :4045 (rows or reads that use the old column set); apps/bot/src/projector-registry.test.ts :59-75 (the
  placeholder assertion becomes the real projector).
- New test files: packages/db/src/public-sessions-projector.test.ts (PSP-1..PSP-11) and
  apps/bot/src/projectors/public-sessions.test.ts (PSB-1..PSB-6).
- Harness (#62, packages/db/src/test-harness.ts as it is): one leased role password; setupRlsTestContext :679 leases after setup;
  setupNonSuperuserOwnerContext :825; withJobDefinerLock :537 (JOB_DEFINER_LOCK_KEY "jobd" :534) around every SET ROLE
  job_definer step; withChatDefinerLock :454 and acquireChatDefinerLock :472 (CHAT_DEFINER_LOCK_KEY "chad" :446) only where a
  site needs them; a site taking both keeps the P3-S1 D12 order (jobd shared first, then the chad slot, never the reverse);
  settled teardown; each suite drops its own DB; assertions about a runtime role run as that real role.
- Test inputs with hidden or bidi characters are written as escapes in the test source, never raw (Semgrep CE blocks raw ones).
- Tests enable the public_sessions registry row only in their own DB through outbox_projector_set_enabled (as owner or under SET
  ROLE job_definer); committed state stays disabled.

## 9. B3 budget (Q13): exception required, caps binding

- Default: about 300 LOC, 3 modules, 1 migration. The exception is LOC only: modules stay 3 and the migration stays one.
- Modules: M1 packages/db/migrations (0061, the only migration); M2 packages/db (schema.ts, db.dbml, src/session-occupancy.ts,
  src/public-session-fence.ts); M3 apps/bot/src/projectors (public-sessions.ts).
- Why a split breaks coherence: the five parts of 0061 depend on each other inside one transaction: the view reads the new columns
  and the live alias, the writer writes those columns through the new grants, the lookups read the view, the slug definers share
  the writer's lock, and the column drops need the old view dropped first; the projector is the writer's only caller and its tests
  prove the event path. Any part shipped alone leaves a definer without a caller or a view without a writer.
- Compatibility proof (rolling deploy): old bot binaries keep the placeholder and the registry row is disabled; no web code reads
  the view before L10b; the DROP and CREATE of the view are atomic inside the one migration transaction (F-9); the dropped columns
  are unread (F-2) and public_sessions is empty (F-14).
- Per-file estimate: non-test 790 = 0061 ~520, projector ~175, schema.ts ~35, db.dbml ~25, public-session-fence.ts ~25,
  session-occupancy.ts ~10; test 1300 = PSP file ~700, PSB file ~380, rls-invariants ~120, session-service.test ~40,
  outbox-projector-registry.test ~30, projector-registry.test ~26, migrate.test ~4.
- Hard caps (git diff --numstat against the base, the readiness file excluded; R-3 headroom): non-test 1050, test 2150, total 3200,
  files 15 (13 expected), exactly one migration (0061). A cap overrun stops the lane and is reported, never absorbed silently.

## 10. OPEN (out of scope for L10)

- O-1 OUT_OF_SCOPE (L17): docs/sessions/web-mvp-phase3-plan.md and the occupancy research still read unsigned (L0 residue).
- O-2 OUT_OF_SCOPE (L10b): 0033:20-23 / schema.ts:1625-1626 said public_projection_version is the DD-78 cache key in the view;
  DD-133 (e) removes it from the view => L10b needs another cache key.
- O-3 OUT_OF_SCOPE (owner P0): events acked before the route exists never apply (0056:13-15), so enabling the projector after
  aliases are approved needs the R-2 runbook of 4.7 (h).

## 11. Closure matrix (12/12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = W HEAD = session base ff9e153; every TARGET_FILES path measured to exist at the base | PASS |
| 2 | Decisions in scope final | DD-133 (D1) signed (a)-(e); DD-114 D3, DD-12, DD-41, DD-75 and DD-83 bound (sections 1-3); P-1..P-19 pinned as defaults pending sign-off; orchestrator rulings R-1..R-3 applied | PASS |
| 3 | Scope IN/OUT and owner clear | lane FILES IN SCOPE plus section 8 test-only additions; lane NEGATIVE SCOPE in OUT_OF_SCOPE; index.ts and package.json not edited (P-18) | PASS |
| 4 | Dependencies classified | L3 #64, L6 #63, L7 #65, L8 #68 and L10a #71 merged at the base (0060 present); D1 signed; L10b and L12 downstream | PASS |
| 5 | Live schema and code match | sections 2-3 measured at the base; F-1..F-14 | PASS |
| 6 | Data, API, state, auth contract | sections 4.1-4.8 | PASS |
| 7 | Fail-closed, idempotency, order | recompute from canonical rows only, never from a payload; per-session advisory lock (P-11); observe-then-CAS fence clear (P-9); idempotent upsert with no version bump (P-5); live alias and tenant status filter in the view; poison isolation per delivery row (4.7) | PASS |
| 8 | Open questions in scope = 0 | section 5 pins; section 10 is out of scope | PASS |
| 9 | Acceptance matrix with expected results | section 7: 20 rows; every lane TESTS item and all 7 decision-table rows mapped | PASS |
| 10 | Migration, security, rollback | one migration 0061 (B3 exception, section 9); explicit REVOKE and GRANT (4.8); no base SELECT on public_sessions for app or readonly and app DML stays revoked; job_definer-owned definers with pinned search_path; hash-only slugs; rollback = code revert (0061 objects are inert for old binaries: the registry row is disabled and no web code reads the view) | PASS |
| 11 | First slice hard dependencies merged | L3, L6, L7, L8 and L10a merged at ff9e153 (#64, #63, #65, #68, #71) | PASS |
| 12 | Implementation handoff ready | sections 4-9; B3 exception with hard caps (section 9); W clean at the base with deps installed | PASS |

## 12. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-17
AUTHORITY_SHA: ff9e15333956e370d41281d7cb33bb6708b1a9e0
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/standards/review-code-readiness-gate.md
  - docs/standards/business-rules.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m9-public-alias-moderation.md
  - docs/sessions/web-mvp-phase3-plan.md
  - docs/research/occupancy-authority-2026-10-16.md
  - docs/features/FE/feature_marketplace_discovery.md
  - docs/features/BE/feature_marketplace_discovery_tech.md
  - docs/product/BRD.md
  - docs/product/TDD.md
  - packages/db/migrations/0000_roles_extensions.sql
  - packages/db/migrations/0002_tenants_core.sql
  - packages/db/migrations/0006_discovery.sql
  - packages/db/migrations/0009_rls_policies_grants.sql
  - packages/db/migrations/0024_public_visibility_capacity_check.sql
  - packages/db/migrations/0033_public_projection_fences.sql
  - packages/db/migrations/0036_revoke_app_dml_public_sessions.sql
  - packages/db/migrations/0043_identity_link_code_issue_consume.sql
  - packages/db/migrations/0044_session_guest_notes.sql
  - packages/db/migrations/0056_outbox_projector_registry_dlq_replay.sql
  - packages/db/migrations/0058_player_self_join.sql
  - packages/db/migrations/0060_tenant_public_alias.sql
  - packages/db/schema.ts
  - packages/db/db.dbml
  - packages/db/package.json
  - packages/db/src/index.ts
  - packages/db/src/session-occupancy.ts
  - packages/db/src/public-session-fence.ts
  - packages/db/src/session-read.ts
  - packages/db/src/session-service.ts
  - packages/db/src/public-alias.ts
  - packages/db/src/test-harness.ts
  - packages/db/src/migrate.test.ts
  - packages/db/src/rls-invariants.test.ts
  - packages/db/src/outbox-projector-registry.test.ts
  - apps/bot/src/dispatcher.ts
  - apps/bot/src/preflight.ts
  - apps/bot/src/projectors/index.ts
  - apps/bot/src/projectors/public-sessions.ts
  - apps/bot/src/projectors/zalo-dm.ts
  - apps/bot/src/projector-registry.test.ts
  - scripts/public-alias-moderate.mjs
SLICE: p3-m9-public-projector
IN_SCOPE: the public_sessions projector consumer and its one migration 0061 (writer, candidates and sweep definers owned by job_definer with EXECUTE app_worker; session_occupancy(uuid) SECURITY INVOKER with EXECUTE app; the 8 nullable DD-41 columns; drop of skill_level, club_display_name and host_display_name after deleting the derived rows; the hash-only share-slug registry with rotate and revoke definers for app and two lookup definers for readonly; public_listing_id; the replaced public_session_share_v with the live approved-alias and tenant status filter, owned by job_definer, SELECT readonly only; 15 route rows with the registry row disabled), occupiedCountSql emitting session_occupancy, the clearPublicSessionFence CAS wrapper, schema.ts and db.dbml mirrors, the bot projector, the rls-invariants amendments, count-pin updates and the section 8 test files
OUT_OF_SCOPE: HTTP route and UI (L10b, L12); confirmed_count; person gender, money beyond price_amount, roster, venue address, tenant id, channel id, hold count, host or person name in any public object; any cache; packages/db/src/index.ts and packages/db/package.json edits; enabling the projector or the dispatch cycle (owner P0, R-2 runbook); any base SELECT re-grant on public_sessions; decisions.md and Reviewed specs; any new role or db:bootstrap change
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: L3 #64, L6 #63, L7 #65, L8 #68 and L10a #71 merged at ff9e15333956e370d41281d7cb33bb6708b1a9e0 (probe 0060_tenant_public_alias.sql); DD-133 (D1) signed (a)-(e)
PRIOR_SLICES: L10a p3-m9-public-alias-moderation (#71); L8 (#68); L7 (#65); L3 (#64); L6 (#63)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # one migration 0061 with a B3 LOC exception; explicit REVOKE/GRANT on every new function, the slug table and the view (4.8); no base SELECT on public_sessions for app or readonly; app DML stays revoked (0036:36); job_definer-owned definers with pinned search_path; hash-only slugs; opus/max reviewer + opus/max security round
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: section 6 steps 1-2 - GitNexus impact on occupiedCountSql, getSessionOccupancy, raisePublicSessionFence and the projector placeholder, then the count pins, the rls-invariants whitelist amendments and the PSP and PSB tests red before writing packages/db/migrations/0061_public_sessions_projector_writer.sql
REMAINING_BLOCKERS: none
```
