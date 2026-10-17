<!-- review-readiness: code-ready -->

# Step-0 readiness: L10a p3-m9-public-alias-moderation (session P3-S6)

> Agent-facing. Readiness reviewers opus/max: #1 measured sections 0-10 and stopped at the token rule; #2 (fresh) closed F-3, applied the
> orchestrator rulings R-1..R-3 and wrote sections 7, 11 and 12. Writer opus/max; code reviewer opus/max + opus/max security round, at
> most 3 rounds (DD-122 D4).
> Every `path:line` is MEASURED at base `67e15794375d4d5df9834702960703e4658d0679` (lane block measured at `c762c90`). TARGET_FILES are
> read-only context that exists at the base; new files are scope, never TARGET_FILES.
> Review questions -> where closed: unreviewed text becomes public -> 4.1 (zero grants on tenants; no public reader), 4.2 rule 6, 4.3 CAS,
> 4.5 (no alias text in payload); moderation-definer privilege -> 4.3 + 4.8 (R-1: REVOKE ALL FROM PUBLIC, app, app_worker, readonly; zero
> GRANT); spoofing -> 4.2 rule 3 + M-4; audit tamper -> 4.4 (R-2).

## 0. Threat model (binding, nothing wider)

- Adversaries: (1) a club admin holding `content.manage` (controls alias text, timing, retries); (2) any code running as `app`,
  `app_worker` or `readonly`, a compromised web or worker process included (calls every function granted to its role with any
  arguments, including a forged `p_actor_person_id`); (3) any anonymous public reader.
- Trusted: the platform owner holding `DATABASE_URL_MIGRATION` (the migration role; owner of every 0060 object).
- Goal: no text reaches `approved` except by an owner decision bound to that exact text; nothing of a tenant is public unless its alias
  is `approved` (read side is L10's; L10a guarantees the state machine and that no existing public object reads the new columns);
  audit rows append-only, written only with the decision.
- By design adversary (2) can set a `pending` alias for any tenant by forging an actor (same trust boundary as `tenant_profile_update`,
  0052:63-126). Fail-closed: `pending` is never public and no role-(2) path approves.
- Out of model: malicious owner, superuser misuse, homoglyph detection (owner judges at approval, M-4).

## 1. Base, dependencies, authority (Q1)

- W HEAD = `67e15794375d4d5df9834702960703e4658d0679`, branch `feat/p3-m9-public-alias-moderation`, porcelain empty, no `index.lock`
  in `.git/worktrees/p3-m9-public-alias-moderation/`. Migration tail `0059_me_player_reads_definers.sql` (60 files) => next free **0060**.
- DD-133 signed: heading `decisions.md:1837` (index row `:124`). Part (d) `:1849-1851`: club public alias, short text, HIDDEN_CHAR-safe;
  status pending|approved|rejected; set by the club (`content.manage`); edit of an approved alias => pending; only the platform owner
  approves/rejects via an owner-only script with an audit row, no UI; L10a emits an outbox event for L10 to re-project/delete; a club
  with no approved alias is never projected. Part (c) `:1846-1849` (L10's): the L10 view filters live on the approved alias.
- DD-114 D3 heading `:2563`; precondition 4 `:2596-2598`: alias-moderated substrate for `club_display_name`, fail-closed (empty => not
  projected). Base: tenants has no alias column (0002:10-17, 0039:129-130, schema.ts:513-526).
- DD-46 heading `:637`; the fail-closed alias line is now `:647` (cited as `:627` in DD-114 D3 `:2596` and `:642` in DD-133 `:1853`, stale):
  amended by DD-133 — the approved alias (L10a) is the public `club_display_name`; no host or person name is ever public.
- Hard dependency P3-S5 merged (probe: 0059 present). D1 residue in web-mvp-phase3-plan.md / occupancy-authority doc = O-1, not a blocker.

## 2. Lane-block and pre-measure citations re-measured at the base (Q2)

| Citation | Measured at base | Status |
|---|---|---|
| last migration 0059 / next 0060 | tail `0059_me_player_reads_definers.sql`, 60 files | holds |
| 0049 authorize :44, REVOKE :133, GRANT app :134 | `:44` params `(p_tenant_id uuid, p_action text, p_actor_person_id uuid)` `:45-47`; `RETURNS TABLE (allowed boolean, role text, reason text)` `:49`; DEFINER `:51`; search_path `:52`; `:133`; `:134` | holds |
| 0047 audit :153, trigger ~:178-188 | table `:153-166`; ENABLE/FORCE RLS `:169-170`; policy `:171-173`; REVOKE/GRANT SELECT app `:174-176`; trigger fn `:178-186`; trigger `:187-189` | ends :189 |
| text-safety.ts (45) HIDDEN_CHAR :24, hasHiddenChar :38, hasVisibleChar :43 | same; VISIBLE_CHAR `:35` | holds |
| me-settings.ts :2; session-service.ts uses it | `:2` import both; session-service.ts `:22` imports hasHiddenChar | holds |
| 0055 c_ws, c_visible | `person_profile_update` `:92-146`: c_ws `:104`, c_space `:105`, c_reject `:108-117`, c_visible `:120-124`, trim `:130`, 1..120 + RAISE 22023 `:131-135` | holds |
| tenants 0002:11 | comment "not RLS-scoped" `:9`, CREATE `:10`, cols `:11-17` | CREATE is :10 |
| tenants_name_len_chk 0039:129 | `:129-130` | holds |
| schema.ts:513, db.dbml:131 | `:513`; checks `:521-526` (`tenants_status_chk :522`, `tenants_name_len_chk :525`); dbml `:131-139` | holds |
| club-config.ts updateClubConfig :55, authorize :61, lock :69 | `:55`; withTenant `:60`; authorize `:61` -> FORBIDDEN `:62`; lock `club-config:<tenant>` `:69-71` (reason `:63-68`); authorizeTenantAction admin_mutation `:75-76`; processed-command lock `:79-81`; prior/replay `:82-99`; validatePatch `:102`; insert `:145-147` | holds |
| club-config-route.ts resolveClubGate :27 | `:27`; session `:36-37` -> CSRF `:38-40` -> tenant `:41-44` -> throttle `:45-47` -> authorize `:48-61` (one 403 body) -> lang `:64` -> bucket `:65-72` | holds |
| route.ts GET :27, PATCH :35 | FIELDS `:16-23`; invalid() `:25`; GET `:27-33` (getClubConfig `:31`); PATCH `:35`; commandId `:58-66`; allowed keys `:68-69`; updateClubConfig `:74-79`; switch `:81-109` | holds |
| client ClubConfigDto :8, ClubPatchBody :18 | same; getClubConfig `:39`; patchClubConfig `:49` | holds |
| model 157; form 158 | clubNameProblem `:34-39`; ClubProfileForm `:29` props `:29-40`, patchClubConfig `:90` | holds |
| "no form or client test file" | WRONG: `components/settings/club-settings-forms.test.tsx` exists, `describe("ClubProfileForm") :36`, render `:38` | corrected |
| tenant-lang.test.ts :118 :125 :248 :249 | same | holds; no new web file => no change |
| outbox_events 0005:21 | `:21-33`, UNIQUE (aggregate_id, sequence) `:32`; processed_commands `:9-18` | holds |
| 0056 :93, :100 | `:92-93`, `:99-100`; seeds `:105-108` (all disabled; only route `('web_realtime','session',NULL)`); outbox_required_projectors `:113`, '{}' rule `:110-112` | holds |
| outbox-dlq-replay.mjs | 124 lines; env `:96-99`; SET ROLE `:104`; RESET `:108`; exit 1/0/2/1 at `:99/:110/:115/:118` | holds |
| count pins | migrate.test.ts `:53`, **`:769`**; rls-invariants `:70 :73 :1753 :1758 :2036 :4611 :4613 :4614`; outbox-projector-registry `:114 :115 :117 :120` | 3 more than pre-measure |
| DD lines | DD-133 `:1837` (d) `:1849-1851`; DD-114 D3 `:2563` p4 `:2596-2598`; DD-46 `:637`, alias line `:647` | DD-46 moved |

## 3. Measured facts the contract rests on

- F-1 tenants privileges: app holds ZERO privileges on tenants (0052:3-6; 0035:13, :20). Re-measured: no GRANT/REVOKE naming tenants in
  any migration (reviewer #2 grep at the base: zero `ON [TABLE] [public.]tenants` lines in packages/db/migrations and infra); no
  `ALL TABLES IN SCHEMA` or `ALTER DEFAULT PRIVILEGES` grant (only a comment 0034:370); no migration grants TRUNCATE (zero `TRUNCATE`
  matches); tenants has no RLS and no policy (0002:9). Existing assertion: rls-invariants.test.ts:5024-5027
  (`has_table_privilege('app','tenants','SELECT'|'UPDATE')` = false).
- F-2 app / app_worker / readonly are NOSUPERUSER NOBYPASSRLS (0000:23-29).
- F-3 tenants writers: INSERT with explicit column list `(name, slug, status, locale, timezone)` at 0012:256, 0028:239, 0037:112; the only
  UPDATE is 0052:115 (name/timezone/locale). CLOSED (orchestrator measurement at the base): the dynamic SQL (`populate_record` /
  `EXECUTE format`) in 0009, 0019, 0020, 0021, 0053 and 0054 is DDL, a privilege GRANT inside the 0009 table loop (0009:57; the loop list
  0009:30-40 does not contain tenants) or a read (0054:349 SELECT count); none writes tenants rows. So no existing function writes a new
  column.
- F-4 no dynamic reader: no migration has `RETURNS SETOF tenants`, `RETURNS tenants`, `tenants%ROWTYPE`, `to_jsonb(t)`, `row_to_json(t`,
  `SELECT * FROM tenants`, `SELECT t.* FROM`; no TS `from(tenants)` in packages/db/src, apps/web/lib, apps/web/app.
- F-5 public objects: `public_session_share_v` (0033:132, security_barrier) reads public_sessions only (0033 never names tenants);
  `club_display_name` is `ps.club_display_name` (:141); GRANT SELECT TO readonly (:239); other 0033 grants are fence functions (:191, :204, :222).
- F-6 authorize returns a row, never raises: deny reasons tenant_context `:67`, unknown_action `:76`, not_a_member `:91`, not_permitted
  `:97 :105 :130`, grant_required `:124`. Caller precedent 0052:92-98 RAISEs insufficient_privilege on `allowed IS NOT TRUE`.
- F-7 GUC precedent: 0052:80-90 (malformed => NULL; mismatch => RAISE insufficient_privilege); 0059:66/:75 set_config(..., true) + restore prev.
- F-8 text rule: TS text-safety.ts:24/:35; SQL twin 0055:104-124 is function-local (a new definer carries a byte-identical copy); trim =
  ECMAScript WhiteSpace+LineTerminator = String.prototype.trim; char_length counts code points; RAISE 22023.
- F-9 client mirrors (FE-INV-3): session-form-model.ts:80 `hasHiddenChar` (pinned over every code point by its test);
  me-settings-client.ts:74-82 `displayNameProblem` (code points; visible rule `/[^\s\p{DI}]/u` :82 => "empty").
- F-10 outbox: columns 0005:21-33; sequence = `coalesce(max(sequence),0)+1` per aggregate in-statement (session-service.ts:2686-2687);
  outbox_events is FORCE RLS (rls-invariants.test.ts:76-96 list); no existing 'tenant' aggregate producer; wake trigger 0056:40-47 fires
  on every INSERT (empty payload); no route for 'tenant' => required set '{}' => acks.
- F-11 dedupe precedent club-config.ts:79-99 (key `processed-command:<tenant>:<commandId>`; other type => COMMAND_ID_CONFLICT; replay
  returns current state) + insert :145-147 (app inserts processed_commands).
- F-12 club-config.ts:63-71: `club-config:<tenant>` lock exists because authorizeTenantAction FOR SHARE-locks the tenants row and the
  definer then UPDATEs it (40P01). Any new tenants-row writer after authorizeTenantAction must take the SAME key first.
- F-13 ClubConfigErrorCode club-config-validation.ts:11-12 = FORBIDDEN | TENANT_SUSPENDED | INVALID_INPUT | COMMAND_ID_CONFLICT |
  NO_ONBOARDING_RUN; class `:14-20` (code, message); route.ts:81-109 maps them (FORBIDDEN one body :84-89).
- F-14 harness: setupRlsTestContext :679 (owner = superuser, :79, :645); setupNonSuperuserOwnerContext :825 (NOSUPERUSER NOBYPASSRLS
  owner :852-854, ownerPool :860) used by me-player-reads-nobypass.test.ts:29-42 (withJobDefinerLock :537 around
  bootstrapJobDefinerForOwner then bootstrapChatDefinerForOwner); withDefinerReadLock :547; withJobDefinerBreakerLock :542; ROLE_PW :92-95; lease :206.
- F-15 CHECK drift: rls-invariants.test.ts:3194-3208 `declaredCheckKeys()` = every drizzle table exported by schema.ts vs the live
  catalog => every 0060 CHECK (audit table included) must be declared in schema.ts under the same name.
- F-16 catalog precedent rls-invariants.test.ts:5008-5027 (prosecdef, proconfig `search_path=pg_catalog, public, pg_temp`, acl no `=X`).
- F-17 route.test.ts:6-16 mocks @plexco/db with importOriginal (updateClubConfig, getClubConfig).
- F-18 specs naming club_display_name/alias (spec sync = L0, O-3): BE marketplace_discovery, inapp_chat, channel_booking_funnel,
  tournament; FE marketplace_discovery, inapp_chat, session_management, multi_tenant.
- F-19 role membership: zero `GRANT app|app_worker|readonly TO` and zero `IN ROLE` in packages/db/migrations and infra (reviewer #2 grep
  at the base), so app_worker and readonly inherit nothing from app; the R-1 negative EXECUTE assertions on set and read hold by
  construction.

## 4. Contract

### 4.1 Schema: ONE migration `packages/db/migrations/0060_tenant_public_alias.sql` (Q3)

```sql
ALTER TABLE tenants
  ADD COLUMN public_alias text,
  ADD COLUMN public_alias_status text,
  ADD CONSTRAINT tenants_public_alias_pair_chk CHECK ((public_alias IS NULL) = (public_alias_status IS NULL)),
  ADD CONSTRAINT tenants_public_alias_len_chk CHECK (public_alias IS NULL OR char_length(public_alias) BETWEEN 1 AND 60),
  ADD CONSTRAINT tenants_public_alias_status_chk
    CHECK (public_alias_status IS NULL OR public_alias_status IN ('pending', 'approved', 'rejected'));
```

- Mirror: schema.ts tenants (`publicAlias: text("public_alias")`, `publicAliasStatus: text("public_alias_status")`, the three checks by
  these names in the `:521-526` object) + db.dbml `:131-139`. Character rule is NOT a CHECK (definer-only writer; one SQL copy).
- Closing mechanism: 0060 grants NOTHING on tenants; table- and column-level privileges stay zero for the three roles (F-1), so a direct
  `UPDATE tenants SET public_alias_status='approved'` or INSERT fails 42501. No column REVOKE (it cannot override a table grant, and there
  is none). Only writers of the two columns = the 0060 definers (F-3). Tests A-6 (R-1 catalog assertions), A-7 (real-role calls).
  Existing rows NULL/NULL satisfy all CHECKs; nullable ADD COLUMN without default = no rewrite. No existing public object reads the
  columns (F-4, F-5); A-15 pins it (L10 updates it consciously).

### 4.2 Set definer (Q4)

`tenant_public_alias_set(p_tenant_id uuid, p_actor_person_id uuid, p_alias text) RETURNS TABLE (public_alias text, public_alias_status
text, changed boolean)`, plpgsql VOLATILE SECURITY DEFINER `SET search_path = pg_catalog, public, pg_temp`, relations `public.`-qualified;
privileges per 4.8 (R-1): REVOKE ALL FROM PUBLIC, app_worker, readonly; GRANT EXECUTE TO app only. Rules in order:
1. GUC binding as 0052:80-90 => RAISE insufficient_privilege.
2. Authorization FIRST: `public.tenant_capability_authorize(p_tenant_id, 'content.manage', p_actor_person_id)`; `allowed IS NOT TRUE` =>
   RAISE insufficient_privilege, one message for every reason.
3. Text: NULL => 22023; trim with 0055 c_space regexp; `char_length` 1..60, `!~ c_reject`, `~ c_visible` else RAISE invalid_parameter_value.
   c_ws/c_space/c_reject/c_visible byte-identical to 0055:104-124 (A-12).
4. `pg_advisory_xact_lock(hashtextextended('club-config:' || p_tenant_id::text, 0))` (same key as club-config.ts:69-71; re-entrant), then
   tenants row `FOR UPDATE`; missing => zero rows.
5. Identical trimmed text (IS NOT DISTINCT FROM stored) => return stored alias/status, changed=false, zero writes, zero events (M-5).
6. Else UPDATE alias = v, status = 'pending' (clears approved or rejected).
7. INSERT outbox_events ('tenant', aggregate_id = p_tenant_id, sequence = coalesce(max,0)+1 for that aggregate, type
   'tenant.public_alias_set', payload `{"status":"pending"}`), same transaction (FORCE RLS satisfied: GUC = tenant).
8. Return (v, 'pending', true). Result carries no host or person name.

Read definer `tenant_public_alias_read(p_tenant_id uuid) RETURNS TABLE (public_alias text, public_alias_status text)`: GUC binding only,
no capability check (tenant_profile_read posture 0052:12-14, :24-27); privileges per 4.8 (EXECUTE app only).

TS `setPublicAlias` (public-alias.ts, mirrors updateClubConfig order without editing club-config.ts): validate in TS BEFORE any DB call ->
withTenant -> authorize (FORBIDDEN) -> lock `club-config:<tenant>` -> authorizeTenantAction admin_mutation (TENANT_SUSPENDED) -> lock
`processed-command:<tenant>:<commandId>` + prior (other type => COMMAND_ID_CONFLICT; same => replay returns current state, zero writes) ->
definer -> insert processed_commands (commandType `SetPublicAlias`, resultRef null; also when changed=false). SQLSTATE 42501 => FORBIDDEN,
22023 => INVALID_INPUT, else rethrow. Throws `ClubConfigError` (reuse). PATCH reach: route.ts imports setPublicAlias from @plexco/db; body
with `publicAlias` must have no FIELDS key (else invalid() 400, before any DB call) => one command per PATCH, no partial writes.

### 4.3 Moderation definers (Q5)

`tenant_public_alias_decide(p_tenant_id uuid, p_decision text, p_expected_alias_sha256 text, p_decided_by text) RETURNS TABLE (tenant_id
uuid, public_alias_status text)`, SECURITY DEFINER, pinned search_path:
1. Any NULL, decision not in ('approved','rejected'), sha256 `!~ '^[0-9a-f]{64}$'`, decided_by `!~ '^[a-z0-9][a-z0-9._-]{0,31}$'` => 22023.
2. Same advisory key as 4.2 rule 4, tenants row FOR UPDATE; missing => RAISE no_data_found (P0002).
3. CAS (TOCTOU): alias NULL, or `encode(sha256(convert_to(alias,'UTF8')),'hex') <> p_expected_alias_sha256`, or status = p_decision =>
   RAISE object_not_in_prerequisite_state (55000), zero writes. Approve from pending|rejected; reject from pending|approved (M-9).
4. Save prev GUC, `set_config('app.tenant_id', p_tenant_id::text, true)` (FORCE RLS on outbox_events + audit applies to a non-superuser owner).
5. UPDATE status; 6. INSERT audit row; 7. INSERT event (`tenant.public_alias_approved|rejected`, `{"status":p_decision}`); 8. restore GUC.

`tenant_public_alias_pending() RETURNS TABLE (tenant_id uuid, public_alias text, alias_sha256 text)` STABLE DEFINER: status = 'pending',
ORDER BY id; no name, slug, person or host.

Both: privileges per 4.8 (R-1): REVOKE ALL FROM PUBLIC, app, app_worker, readonly; NO GRANT. Owner = the migration role (same as
0052/0055/0058/0059); no new role, no db:bootstrap change. CLI reaches them with DATABASE_URL_MIGRATION only, NO `SET ROLE` (unlike
outbox-dlq-replay.mjs, whose definers are job_definer's). Tests: ctx.owner (superuser migration owner) = owner path; ns.ownerPool
(NOBYPASSRLS owner) proves rules 4-7 under FORCE RLS (A-17).

### 4.4 Audit mechanism (Q6)

Table `tenant_public_alias_audit`: `id uuid PK default gen_random_uuid()`, `tenant_id uuid NOT NULL REFERENCES tenants(id)`, `decision`
(CHECK `tenant_public_alias_audit_decision_chk` IN approved|rejected), `alias` (CHECK `tenant_public_alias_audit_alias_len_chk` 1..60),
`decided_by` (CHECK `tenant_public_alias_audit_decided_by_chk` pattern of 4.3 rule 1), `decided_at timestamptz NOT NULL DEFAULT
clock_timestamp()`; index (tenant_id, decided_at). ENABLE + FORCE RLS, `tenant_isolation` policy as 0047:171-173. `REVOKE ALL ON TABLE
tenant_public_alias_audit FROM PUBLIC, app, app_worker, readonly` (4.8; zero grants, not even SELECT: no runtime reader; owner reads as
migration role). Append-only trigger `trg_tenant_public_alias_audit_immutable` BEFORE UPDATE OR DELETE ->
`forbid_tenant_public_alias_audit_mutation()` RAISE restrict_violation (0047:178-189 pattern, plus pinned search_path). Club sets write NO
audit row (M-10). Declared in schema.ts + db.dbml (F-15).

Tamper closure (R-2, orchestrator ruling): no runtime role holds TRUNCATE on any table (zero grants; no GRANT TRUNCATE exists anywhere in
packages/db/migrations, F-1), and the audit table carries zero grants for app, app_worker and readonly (4.8). A TRUNCATE fires no row
trigger, but only the table owner could issue it. So the BEFORE UPDATE OR DELETE trigger plus zero grants close tamper for every adversary
of section 0, and the owner is trusted. The FK to tenants has no ON DELETE CASCADE, so a tenant delete cannot erase its audit rows.

### 4.5 Outbox event (Q7)

aggregate_type `'tenant'`, aggregate_id = tenant id, sequence `coalesce(max(sequence),0)+1` for that aggregate in-statement, serialized by
the advisory key + row lock, fenced by UNIQUE (aggregate_id, sequence) 0005:32. Types `tenant.public_alias_set`,
`tenant.public_alias_approved`, `tenant.public_alias_rejected`; payload exactly `{"status": <new status>}` (no alias text, no actor);
schema_version default 1. No route row (L10 adds it) => '{}' => acks (0056:104-112). Registry/route tests unchanged except count pins.

### 4.6 TS module, index exports, owner CLI (Q8)

- `packages/db/src/public-alias.ts`: `PUBLIC_ALIAS_MAX = 60`; `type PublicAliasStatus`; `interface PublicAliasState { publicAlias: string |
  null; publicAliasStatus: PublicAliasStatus | null }`; `validatePublicAlias(raw: unknown): string` (string check, `trim()`, code points
  `[...v].length` 1..60, `!hasHiddenChar`, `hasVisibleChar` from ./text-safety.js — no second mechanism; throws ClubConfigError
  INVALID_INPUT); `getPublicAlias(db, { tenantId })` (withTenant + read definer); `setPublicAlias(db, { tenantId, actorPersonId,
  commandId, publicAlias })` => `PublicAliasState & { changed, replayed }`.
- `index.ts` (264 lines): one new export block after the last one (`:252-264`).
- Route mapping (existing switch): INVALID_INPUT => INVALID_BODY 400, zero writes; FORBIDDEN => 403 one body for every reason (route.ts:84-89);
  TENANT_SUSPENDED 403; COMMAND_ID_CONFLICT 409.
- `scripts/public-alias-moderate.mjs`: `list | approve --tenant <uuid> --sha256 <64 lowercase hex> | reject --tenant <uuid> --sha256 <hex>`;
  unknown command/flag or extra arg refused. Env DATABASE_URL_MIGRATION only, never printed. list => one JSON line per row `{tenantId,
  publicAlias, aliasSha256}`; approve/reject => `tenant_public_alias_decide(..., 'owner-cli')`, prints `{tenantId, status}`. Exit 0 ok;
  2 refused (bad args, SQLSTATE 22023 / P0002 / 55000, prints `refused: <msg>`); 1 other error or env unset (`error: <code> <msg>`).

### 4.7 Web side (Q9)

- GET route.ts:27-33 => `club = { ...getClubConfig, ...getPublicAlias }`; config PATCH response gains the same two fields; DTO adds
  `publicAlias: string | null`, `publicAliasStatus: "pending" | "approved" | "rejected" | null`.
- PATCH alias path: keys subset of {commandId, publicAlias}, publicAlias a string (null/other => 400; clearing unsupported, M-7) =>
  setPublicAlias => `ok({ club: {...} })`. club-config-route.ts gate order unchanged (no edit).
- client: ClubConfigDto + both fields (`type PublicAliasStatusDto`); ClubPatchBody + `publicAlias?: string` (sent alone).
- model: `publicAliasProblem(raw)` => "empty" | "too_long" | "invalid_chars" | null: trim, code points 1..60, `hasHiddenChar` imported
  from ./session-form-model (pinned mirror), invisible-only (`/[^\s\p{DI}]/u` fails) => "empty".
- form: separate public-name block in club-profile-form.tsx (own field, own submit, own useCommandId, sends `{ publicAlias, commandId }`);
  unchanged text => message, no request. Copy pinned in M-18. States test: club-settings-forms.test.tsx (`describe("ClubProfileForm") :36`).

### 4.8 Privilege statements in 0060 (R-1, orchestrator ruling, binding)

```sql
REVOKE ALL ON FUNCTION public.tenant_public_alias_set(uuid, uuid, text) FROM PUBLIC, app_worker, readonly;
REVOKE ALL ON FUNCTION public.tenant_public_alias_read(uuid) FROM PUBLIC, app_worker, readonly;
REVOKE ALL ON FUNCTION public.tenant_public_alias_decide(uuid, text, text, text) FROM PUBLIC, app, app_worker, readonly;
REVOKE ALL ON FUNCTION public.tenant_public_alias_pending() FROM PUBLIC, app, app_worker, readonly;
GRANT EXECUTE ON FUNCTION public.tenant_public_alias_set(uuid, uuid, text) TO app;
GRANT EXECUTE ON FUNCTION public.tenant_public_alias_read(uuid) TO app;
REVOKE ALL ON TABLE public.tenant_public_alias_audit FROM PUBLIC, app, app_worker, readonly;
```

- No other GRANT in 0060: nothing on tenants (4.1 closing mechanism), nothing on the audit table, nothing on the trigger function.
- Acceptance: catalog assertions A-6 sit next to the real-role call tests A-7 and A-8 (section 7).

## 5. Pinned defaults (Q12): each is "default applied, pending owner sign-off"; repeat each in the PR body

- M-1 cap 60 code points after trim (TS `[...v].length`, SQL `char_length`), min 1.
- M-2 normalization = trim only (ECMAScript whitespace both ends); no NFC, no case folding.
- M-3 character rule = text-safety.ts = 0055 constants byte-identical.
- M-4 no uniqueness, no automated impersonation/homoglyph check; the owner judges at approval (the only path to approved).
- M-5 identical trimmed text = no-op whatever the status (approved stays approved, rejected stays rejected); decision row 1 applies to a
  DIFFERENT text. commandId dedupe via processed_commands (`SetPublicAlias`); replay returns current state.
- M-6 a different text from any status => pending.
- M-7 clearing an alias not supported (null => 400).
- M-8 publicAlias only alone in a PATCH (with commandId); mixed => 400, zero writes.
- M-9 approve from pending|rejected; reject from pending|approved (revocation); same-status decision refused 55000; CAS on sha256 hex of UTF-8.
- M-10 audit = table of 4.4; owner decisions only; club sets write no audit row.
- M-11 decided_by fixed `owner-cli`.
- M-12 event types/payload of 4.5.
- M-13 CLI fields and exit codes of 4.6.
- M-14 definers owned by the migration role; no new role.
- M-15 read definer GUC-bound, app only.
- M-16 suspended tenant => TENANT_SUSPENDED 403 (admin_mutation axis, as club config).
- M-17 reuse ClubConfigError codes; 42501 => FORBIDDEN, 22023 => INVALID_INPUT.
- M-18 copy (exact `t(vi, en)`): label `t("Tên công khai của CLB", "Club public name")`; hint `t("Hiện trên trang công khai sau khi được
  duyệt. Tối đa 60 ký tự.", "Shown on public pages after approval. Up to 60 characters.")`; none `t("Chưa có tên công khai — CLB chưa
  hiện công khai.", "No public name yet — the club is not shown publicly.")`; pending `t("Đang chờ duyệt — CLB chưa hiện công khai.",
  "Waiting for approval — the club is not shown publicly yet.")`; approved `t("Đã duyệt — tên này được phép hiện công khai.", "Approved —
  this name may be shown publicly.")`; rejected `t("Bị từ chối — đổi tên để gửi duyệt lại.", "Rejected — change the name to request
  approval again.")`; approved-edit warning `t("Đổi tên đã duyệt sẽ đưa CLB về chờ duyệt.", "Changing an approved name sends it back for
  approval.")`; submit `t("Gửi duyệt", "Submit for approval")`; busy `t("Đang gửi…", "Submitting…")`; success `t("Đã gửi tên công khai
  để duyệt.", "Public name sent for approval.")`; unchanged `t("Tên công khai không thay đổi.", "The public name has not changed.")`;
  empty `t("Nhập tên công khai.", "Enter a public name.")`; too_long `t("Tên công khai tối đa 60 ký tự.", "The public name can have at
  most 60 characters.")`; invalid_chars `t("Tên công khai có ký tự không được phép.", "The public name contains characters that are not allowed.")`.
- M-19 serialization: `club-config:<tenant>` advisory key in TS (before authorizeTenantAction) AND in both write definers + row FOR UPDATE.
- M-20 tenants CHECKs = pair, length, status enum only.

Orchestrator rulings (binding, not owner defaults): R-1 = 4.8 + A-6; R-2 = 4.4 tamper closure; R-3 = every pin M-1..M-20 and every
contract choice in section 4 kept as drafted by reviewer #1.

## 6. Implementation steps (dependency order, test-first)

1. GitNexus impact (upstream) on route.ts GET/PATCH, client getClubConfig/patchClubConfig/ClubConfigDto/ClubPatchBody, ClubProfileForm,
   index.ts; report blast radius (fallback: caller grep in the PR body).
2. Red tests: count pins (section 8), public-alias.test.ts (incl. the R-1 catalog assertions A-6 and the CLI test A-13),
   public-alias-nobypass.test.ts (one DB suite at a time).
3. 0060 per 4.1-4.5 and 4.8. 4. schema.ts + db.dbml (drift test F-15 green). 5. public-alias.ts + index.ts. 6. CLI + A-13.
7. Web: client, model + test, route + test, form + test. 8. S1 VERIFY + db + web suites; privilege-test output (A-6, A-8) into the
   session report.

## 7. Acceptance matrix (Q10, Q11)

Layers: `db` = packages/db/src/public-alias.test.ts as the real roles on the #62 harness; `nobypass` =
packages/db/src/public-alias-nobypass.test.ts; `cli` = public-alias.test.ts spawning `node scripts/public-alias-moderate.mjs`; `route` =
apps/web/app/api/onboarding/club/route.test.ts; `model` = apps/web/lib/club-settings-model.test.ts; `form` =
apps/web/components/settings/club-settings-forms.test.tsx.

| ID | B2 group | Input | Precondition | Expected state / output | Layer |
|---|---|---|---|---|---|
| A-1 | Happy path | set `"  CLB Cầu Lông Q7  "` as an actor holding `content.manage` (TS and PATCH) | active tenant, alias NULL/NULL, GUC = tenant | trimmed text stored, status `pending`, `changed` true, exactly one `tenant.public_alias_set` event; route 200 with both DTO fields | db, route |
| A-2 | Happy path, Regression | set A, owner approves, set B | none | status `pending` with text B; events set, approved, set with sequences 1, 2, 3 for the tenant aggregate | db |
| A-3 | Boundary | different text; then the same text | status `rejected` | different text => `pending`, one event; same text => stays `rejected`, `changed` false, zero writes, zero events (M-5) | db |
| A-4 | Boundary, Security/privacy | empty, spaces only, 61 code points, U+1F600 x61 (x60 accepted); U+202E, U+200B, U+0007, U+2028, U+2800, U+3164, U+00AD, U+FE0F alone or embedded | any status | TS `INVALID_INPUT` before any DB call; direct SQL call 22023; zero writes; route `INVALID_BODY` 400 | db, route |
| A-5 | Authorization | actor without `content.manage`; non-member; member of another tenant; GUC tenant differs from `p_tenant_id` | alias set | TS `FORBIDDEN`, SQL 42501, zero writes; route 403 bodies byte-identical for every reason | db, route |
| A-6 | Migration, Authorization | R-1 catalog queries for app, app_worker, readonly | 0060 applied | `has_function_privilege` EXECUTE false for all three on decide and pending, false for app_worker and readonly on set and read, true for app on set and read; `has_table_privilege` on the audit table false for SELECT, INSERT, UPDATE, DELETE, TRUNCATE; tenants INSERT and UPDATE false at table level and (`has_column_privilege`) on both new columns | db |
| A-7 | Authorization, Security/privacy | each role runs `UPDATE tenants SET public_alias_status = 'approved'` and an INSERT naming the alias columns | pending alias | 42501; row unchanged | db |
| A-8 | Authorization | app, app_worker, readonly each call decide (approve and reject) and pending; then the owner calls both | pending alias | each role: 42501, status, audit count and event count unchanged; owner: decide succeeds, pending lists the row | db |
| A-9 | Happy path, Observability | owner approves; owner rejects the approved alias; owner rejects a pending one; repeat of the same decision | pending alias | status updated; exactly one audit row and one event per decision; same-status decision 55000, zero writes | db |
| A-10 | Failure | decide while a test-local BEFORE INSERT trigger on outbox_events raises for the decide event type | pending alias | status, audit row and event all rolled back (counts unchanged) | db |
| A-11 | Security/privacy | owner UPDATE and DELETE of an audit row; each role UPDATE, DELETE, SELECT | one audit row | owner: 23001 restrict_violation; roles: 42501; `relrowsecurity` and `relforcerowsecurity` true | db |
| A-12 | Regression, Security/privacy | one shared sample set: the A-4 cases plus accepted Vietnamese, emoji, combining mark, emoji + U+FE0F | none | TS `validatePublicAlias` verdict equals the SQL definer verdict per sample (SQL in BEGIN/ROLLBACK as app with GUC); prosrc constant lines (c_ws, c_space, c_reject, c_visible) of set byte-equal to `person_profile_update` (me-settings parity) | db |
| A-13 | Security/privacy, Observability | CLI `list`, `approve`, `reject`, wrong digest, bad args, env unset | seeded tenant name and person display name known to the test; one pending alias | list lines have keys exactly tenantId, publicAlias, aliasSha256; no tenant name or display name in stdout or stderr; approve and reject exit 0; wrong digest exit 2; bad args exit 2; env unset exit 1; URL and password never printed | cli |
| A-14 | Concurrency | list (digest of A), club sets B, owner approves with the digest of A | pending A | 55000, zero writes; B stays `pending` | db |
| A-15 | Migration, Security/privacy | `information_schema.view_column_usage` for both new tenants columns | 0060 applied | empty: no existing view reads them (L10 changes this consciously) | db |
| A-16 | Migration, Security/privacy | pg_proc rows of the four definers | 0060 applied | prosecdef true; proconfig `search_path=pg_catalog, public, pg_temp`; ACL set and read app only, decide and pending owner only; no `=X` entry | db |
| A-17 | Migration, Observability | NOBYPASSRLS owner: app sets, owner approves | nobypass context (D12 lock order) | one audit row and one event under FORCE RLS; GUC restored to its prior value | nobypass |
| A-18 | Concurrency | two parallel sets; a parallel set and decide | pending alias | serialized: sequences 1, 2; no 40P01 | db |
| A-19 | Concurrency, Boundary | replay of the same commandId after approval; same text with a new commandId; a commandId reused from UpdateClubConfig | approved alias | replay => `replayed`, approved kept, zero writes; same text => `changed` false; cross-type reuse => COMMAND_ID_CONFLICT 409 | db, route |
| A-20 | Authorization | set on a suspended tenant | tenant suspended | TENANT_SUSPENDED 403, zero writes | db, route |
| A-21 | Security/privacy, Migration | tenants with no alias, pending, rejected | seeded tenants after 0060 | none is approved; seeded tenants NULL/NULL after 0060; with A-15 nothing public reads them | db |
| A-22 | Security/privacy | club edit of an approved alias; owner reject of an approved alias | approved alias | status leaves `approved` in the same statement as the text change or the rejection (L10's live filter hides it at once) | db |
| A-23 | Regression, Failure | PATCH alias alone; alias plus `name`; publicAlias null or a number; a body with `publicAliasStatus`; GET; config PATCH; an unmapped error from setPublicAlias | mocked @plexco/db (F-17) | alias alone 200; mixed 400 with neither command called; null or number 400; `publicAliasStatus` key 400 with zero calls; GET and config PATCH carry both fields; the unmapped error propagates (no 2xx) | route |
| A-24 | Boundary | `publicAliasProblem` cases of M-1..M-3 | none | "empty", "too_long", "invalid_chars" or null as pinned | model |
| A-25 | Regression | ClubProfileForm with status none, pending, approved, rejected; editing an approved alias; unchanged text | none | renders the M-18 vi copy for each state and the approved-edit warning; unchanged text shows the message and sends no request | form |
| A-26 | Security/privacy | every set, read, decide and pending result; every event payload | none | result key sets exact (no name, slug, person or host field); payload keys exactly ["status"] | db |

Lane decision table -> rows: (1) valid set by a `content.manage` caller -> A-1, A-2, A-19; (2) caller without `content.manage` -> A-5;
(3) invalid alias -> A-4, A-12; (4) owner approve or reject through the CLI -> A-9, A-10, A-13, A-17; (5) approve or reject by app,
app_worker, readonly or a club role -> A-6, A-8, A-23 (no status key on the web path); (6) owner reject or club edit of an approved alias ->
A-22, A-2; (7) no approved alias -> A-21, A-15.

Lane TESTS -> rows: real roles, app cannot call the moderation definer, the owner path can -> A-1, A-5, A-7, A-8; HIDDEN_CHAR parity with
me-settings -> A-12; approval cleared on edit -> A-2, A-22; audit row and outbox event once per decision in the same transaction, audit not
updatable -> A-9, A-10, A-11, A-17; settings UI states with t(vi, en) copy -> A-25; no host or person name in any return value -> A-26, A-13.

B2 groups -> rows: Happy path A-1, A-2, A-9; Boundary A-3, A-4, A-19, A-24; Authorization A-5, A-6, A-7, A-8, A-20; Failure A-10, A-23;
Concurrency A-14, A-18, A-19; Migration A-6, A-15, A-16, A-21 plus the existing CHECK-drift test (F-15); Security/privacy A-7, A-11, A-12,
A-13, A-26; Regression A-12, A-23, A-25 plus the existing club-config and route suites unchanged; Observability A-1 and A-9 (one event per
set; one audit row and one event per decision). Deny and integrity faults write nothing by the lane decision table and surface as SQLSTATE,
error code or CLI exit 2 (A-5, A-8, A-13, A-14); no deny audit row (M-10).

## 8. Test-only scope additions and harness rules (Q10)

- Count pins: migrate.test.ts:53 (60->61 + comment), :769 (tail -> `0060_tenant_public_alias.sql`); rls-invariants.test.ts :70 :73 :1753
  :1758 :4613 (60->61), :2036 :4614 (tail), :4611 (title); outbox-projector-registry.test.ts :115 :120 (60->61), :117 (tail), :114 (title).
- New: packages/db/src/public-alias.test.ts (incl. the CLI test A-13); packages/db/src/public-alias-nobypass.test.ts (scope addition: the
  main harness owner is a superuser and bypasses FORCE RLS, so decide's GUC handling is otherwise unproven). Web: route.test.ts (add
  setPublicAlias/getPublicAlias to the vi.mock at :6-16), club-settings-model.test.ts, club-settings-forms.test.tsx (A-25 states test).
- Harness (#62 as is): one leased password (:206); setupRlsTestContext lease after setup; reader/breaker locks (:547/:542) as existing
  suites use them; settled teardown; own DBs `plexco_public_alias` / `plexco_public_alias_nobypass`; nobypass beforeAll copies
  me-player-reads-nobypass.test.ts:29-42 (D12 lock order). CLI test spawns node with env = DATABASE_URL_MIGRATION (owner URL) + PATH.

## 9. B3 budget (Q13): exception required, caps binding

- Estimate: non-test ~660 (SQL 230, schema 25, dbml 15, module 120, index 10, CLI 115, route 35, client 10, model 25, form 75); tests ~720.
- Modules: packages/db, apps/web, scripts (3). Split breaks coherence: one invariant (approved only via an owner decision bound to the
  exact text) spans the definers, the only owner path (CLI) and the only club path (web); DONE WHEN needs both paths.
- Compatibility: 0060 adds 2 nullable columns (no default, no rewrite; NULL/NULL rows pass), 4 functions, 1 table + trigger fn + trigger;
  alters/drops/grants nothing existing; old binaries never call them; DTO only gains fields; PATCH gains an optional key; 'tenant' event acks '{}'.
- Hard caps (`git diff --numstat 67e15794375d4d5df9834702960703e4658d0679..HEAD`, excluding this readiness file): non-test <= 750,
  test <= 850, total <= 1600, files <= 19 (10 non-test + 8 test + 1 slack); exactly one migration.

## 10. OPEN (out of scope for L10a)

- O-1 (L17): plan doc + occupancy doc still read D1 unsigned. O-2 (L17): stale DD-46 line cites (:627, :642 -> :647).
- O-3 (L0): spec sync of the 8 files in F-18. O-4 (L10): live approved filter, 'tenant' routes, update A-15, keep tenants grants
  column-scoped excluding the alias columns. O-5 (later): homoglyphs, uniqueness, clearing, moderation UI. O-6 (refactor): setPublicAlias
  repeats updateClubConfig's envelope. O-7: pre-measure missed club-settings-forms.test.tsx.

## 11. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = W HEAD = session base; every TARGET_FILES path listed or measured at the base | PASS |
| 2 | Decisions in scope final | DD-133 (D1) signed incl. part (d) `:1849-1851`; DD-114 D3 precondition 4 `:2596-2598`; DD-46 `:647`; M-1..M-20 pinned as defaults pending sign-off; orchestrator rulings R-1..R-3 applied | PASS |
| 3 | Scope IN/OUT and owner clear | lane FILES IN SCOPE + section 8 test-only additions; lane NEGATIVE SCOPE in OUT_OF_SCOPE; club-config.ts and club-config-route.ts not edited (4.2, 4.7) | PASS |
| 4 | Dependencies classified | P3-S5 merged at the base (0059 present; #70, #69); D1 signed; L10 and L10b downstream (O-4) | PASS |
| 5 | Live schema and code match | sections 2-3, measured at the base; F-3 closed; F-1 and F-19 re-checked by grep at the base | PASS |
| 6 | Data, API, state, auth contract | sections 4.1-4.8 | PASS |
| 7 | Fail-closed, idempotency, order | authorization before writes; TS validation before any DB call; one lock order (M-19); CAS on the reviewed text (4.3); no-op and replay rules (M-5, M-9); one command per PATCH (M-8); pending and rejected never public (A-21) | PASS |
| 8 | Open questions in scope = 0 | section 5 pins; section 10 is out of scope | PASS |
| 9 | Acceptance matrix with expected results | section 7: 26 rows; every decision-table row, every lane TESTS item and all nine B2 groups mapped | PASS |
| 10 | Migration, security, rollback | one additive migration 0060; zero grants on tenants kept; R-1 explicit REVOKE/GRANT (4.8); owner-only moderation with sha256 CAS; append-only audit with zero runtime grants (R-2); pinned search_path; nobypass proof A-17; rollback = code revert (0060 objects are inert for old binaries) | PASS |
| 11 | First slice hard dependencies merged | P3-S5 (#70 with 0059, #69) | PASS |
| 12 | Implementation handoff ready | sections 4-9; B3 exception with hard caps (section 9); W clean at the base with deps installed | PASS |

## 12. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-17
AUTHORITY_SHA: 67e15794375d4d5df9834702960703e4658d0679
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/standards/review-code-readiness-gate.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m9-me-reads.md
  - packages/db/migrations/0000_roles_extensions.sql
  - packages/db/migrations/0002_tenants_core.sql
  - packages/db/migrations/0005_sync_engine.sql
  - packages/db/migrations/0009_rls_policies_grants.sql
  - packages/db/migrations/0012_auth_functions.sql
  - packages/db/migrations/0019_tenant_integrity_fks.sql
  - packages/db/migrations/0020_ledger_tenant_integrity_fks.sql
  - packages/db/migrations/0021_non_money_tenant_integrity_fks.sql
  - packages/db/migrations/0028_dd29_capability_registry_expand.sql
  - packages/db/migrations/0033_public_projection_fences.sql
  - packages/db/migrations/0034_identity_account_link_resolver.sql
  - packages/db/migrations/0035_tenant_locale_reader.sql
  - packages/db/migrations/0037_tenant_provision_rls_self_scope.sql
  - packages/db/migrations/0039_audit_hardening_definers_ledger_link_codes.sql
  - packages/db/migrations/0047_tenant_capability_authority_core.sql
  - packages/db/migrations/0049_tenant_capability_authorize.sql
  - packages/db/migrations/0052_tenant_profile_definers.sql
  - packages/db/migrations/0053_zalo_ingress.sql
  - packages/db/migrations/0054_link_code_reparent_empty_person.sql
  - packages/db/migrations/0055_me_settings_definers.sql
  - packages/db/migrations/0056_outbox_projector_registry_dlq_replay.sql
  - packages/db/migrations/0059_me_player_reads_definers.sql
  - packages/db/schema.ts
  - packages/db/db.dbml
  - packages/db/src/text-safety.ts
  - packages/db/src/me-settings.ts
  - packages/db/src/club-config.ts
  - packages/db/src/club-config-validation.ts
  - packages/db/src/session-service.ts
  - packages/db/src/index.ts
  - packages/db/src/test-harness.ts
  - packages/db/src/migrate.test.ts
  - packages/db/src/rls-invariants.test.ts
  - packages/db/src/outbox-projector-registry.test.ts
  - packages/db/src/me-player-reads-nobypass.test.ts
  - scripts/outbox-dlq-replay.mjs
  - apps/web/lib/club-config-route.ts
  - apps/web/app/api/onboarding/club/route.ts
  - apps/web/app/api/onboarding/club/route.test.ts
  - apps/web/lib/club-settings-model.ts
  - apps/web/lib/club-settings-model.test.ts
  - apps/web/lib/club-settings-client.ts
  - apps/web/lib/me-settings-client.ts
  - apps/web/lib/session-form-model.ts
  - apps/web/lib/tenant-lang.test.ts
  - apps/web/components/settings/club-profile-form.tsx
  - apps/web/components/settings/club-settings-forms.test.tsx
SLICE: p3-m9-public-alias-moderation
IN_SCOPE: a moderated club public alias in one migration 0060 (tenants.public_alias and public_alias_status with three named CHECKs; set and read definers with EXECUTE for app only; owner-only decide and pending definers with sha256 compare-and-set; an append-only owner-decision audit table with zero runtime grants; one tenant outbox event per set, approve and reject in the same transaction), schema.ts and db.dbml mirrors, packages/db/src/public-alias.ts with index exports, the owner CLI scripts/public-alias-moderate.mjs, the club-side alias field through the onboarding/club GET and PATCH route, club-settings client, model and profile form with t(vi, en) copy, count-pin updates and the section 8 test files
OUT_OF_SCOPE: projector, view change, public read route and tenant outbox routes (L10, L10b); moderation UI; tenants.name as a public name; any host or person display name in a return value, event or CLI output; auto-approve; clearing an alias; uniqueness or homoglyph detection; public_sessions; club-config.ts and club-config-route.ts edits; any GRANT on tenants; decisions.md and Reviewed specs; any new role or db:bootstrap change
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: P3-S5 merged 67e15794375d4d5df9834702960703e4658d0679 (probe 0059_me_player_reads_definers.sql); DD-133 (D1) signed incl. part (d)
PRIOR_SLICES: L9 p3-m9-me-reads (#70); L4b announce route (#69)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # one additive migration; zero grants on tenants kept; explicit REVOKE/GRANT on the four definers and the audit table (R-1); owner-only moderation with sha256 CAS; append-only audit with zero runtime grants (R-2); pinned search_path; nobypass proof A-17; opus/max reviewer + opus/max security round
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: section 6 steps 1-2 - GitNexus impact on the route, client, form and index exports, then the count pins, the R-1 catalog assertions and the decision-table tests red before writing packages/db/migrations/0060_tenant_public_alias.sql
REMAINING_BLOCKERS: none
```
