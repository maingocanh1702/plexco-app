<!-- review-readiness: code-ready -->

# Step-0 readiness: L11 p3-m9-gender-pricing (session P3-S9)

> Agent-facing. Readiness parts A (DB, crypto, derivation, charge paths, public whitelist) and B (settings API, session
> prices, codes, UI, DD-54 gating, logging), opus/max read-only, measured at the base and stopped at the token rule; part C1
> (fresh, opus/max, read-only) closed their open measurements; parts C2 / C3 (no re-measurement) wrote this file from that
> decided content under the orchestrator rulings RD-1..RD-15 and R-C1-a..R-C1-e (section 4.0). Writer opus/max; code
> reviewer opus/max + opus/max security round, at most 3 rounds (DD-122 D4, Codex waived by owner 2026-10-12). Every
> `path:line` is MEASURED at base `de732028f3163541928ae7eeac71beebf16e5a18` (lane block measured at `c762c90`); `~:N` was
> counted by hand inside a printed range. TARGET_FILES are read-only context that exists at the base; new files are scope,
> never TARGET_FILES.

## 0. Threat model (binding, nothing wider)

| # | Actor | Must be impossible |
|---|---|---|
| a | Club host or co-admin (holds `session.manage` in the tenant) | read a member's raw gender through any route, DTO, error text, log line, realtime frame or the derivation definer; derive for a person who neither has nor is being given (same tx) a membership in that tenant; set anyone's gender |
| b | Signed-in player | read another person's gender; pick a gender at charge time (it comes only from the stored profile with consent ON); move another person's ciphertext onto their own person; turn a decrypt failure into a fallback price |
| c | Anonymous public client, any code running as `readonly` (public_sessions, public_session_share_v, discovery routes) | see gender, consent, key version, price_male or price_female |
| d | `app_worker` and the zalo_dm / public_sessions / web_realtime projectors | receive gender, ciphertext, key version or a per-gender price |

TRUSTED, out of scope: the platform owner (DATABASE_URL_MIGRATION) and a fully compromised web process that holds the key and
sets its own GUCs. The definers are defence in depth against wrong or buggy host-facing code paths, not against that process.

HALT conditions this contract makes impossible: a fallback price after a decrypt or key-version failure; plaintext gender
anywhere but the owner's self-read (logs, errors, DTOs, events, frames, public surfaces); any host path that reads raw gender
(a host sees only the resulting price); a derivation outside the three contexts; a second migration; gender or a per-gender
price on public_sessions (22 columns), public_session_share_v (17) or any public / discovery / anonymous DTO.

## 1. Base, dependencies, authority

- Base: origin/main `de732028f3163541928ae7eeac71beebf16e5a18`; W HEAD = base, `status --porcelain` empty. Migration dir tail
  0059-0061 and plexco_test `schema_migrations` = 62 rows: next free = `0062`.
- Merged at the base: L8 #68 (self-join, approve, waitlist promotion) and P3-S8 #74 (L10b discovery read).
- DD-39 + addendum 2026-07-16, signed, `decisions.md:547-559`: pin `:549`; addendum `:550` (values male / female / other /
  undisclosed; other, undisclosed and NULL pay the base price, no block, no guessing; fail-closed ONLY on a KMS or decrypt
  error; encrypted PII with consent, never public; it narrows `:555` "or a higher price per club config" to price_amount);
  `:553` a single price OR price_male / price_female, the amount derived from person.gender; `:556` decrypt / KMS error =
  FAIL-CLOSED, no charge at a fallback price; `:558` a host sees gender only at the level derivation needs, the public
  whitelist excludes it; `:559` the four tests.
- DD-54 `:732-737` (`:736`): optional PII is collected only while a platform config is ON (default OFF); the config gates the
  collection UI / flow only; enc, consent and fail-closed are unchanged; a field that is off is NULL => the fallback branch.
- DD-45 `:620-636`, signed 2026-07-13: `:621` promotion locks the session and derives BEFORE any mutation; a failing candidate
  stays waitlisted with no charge, no venue and one `waitlist.charge_derivation_failed` event; a root retry job owns the
  budget; `:623` every attempt restarts from the canonical selector; tech edge #11 (`feature_user_settings_tech.md:146`)
  "opener commit; continue next; no fallback price_amount".
- DD-49 `:687-698`: `:693` a price change is applied per change as a signed adjustment or grandfathered, `charges.amount_due`
  is never mutated; `:695` rejoin carry-over or `REJOIN_REQUIRES_REVIEW`.
- DD-135 row `:122` (owner 2026-10-16): join by account; open => active + charge now, or waitlisted; approval => a pending
  `join_requests` row; FIFO promotes automatically; Zalo /join /leave /pay for linked accounts only (no bot charge path exists
  at the base, section 3).
- Owner D2 (c), the promotion DM (conductor note 6, RD-15): the promoted player gets one zalo_dm `player.promoted` DM whose fee
  is `payload.amount_due`, read back from the charge row (`session-join-service.ts:447-456`, `zalo-dm.ts:112-116`).
- Why no AWAIT: DD-39 and its addendum are signed and the lane names no owner decision; the two signed-text conflicts
  (continue-next, the retry root) and every UNPINNED value are settled by RD-1..RD-15 and R-C1-a..R-C1-e as defaults applied,
  pending owner sign-off (section 5), so OPEN_QUESTIONS_IN_SCOPE is 0; the only dependency (L8) is merged.

## 2. Lane-block citations re-measured at the base

| Lane block (c762c90) | Measured at de73202 |
|---|---|
| DD-39 `decisions.md:542-556` | `decisions.md:547-559` (pin `:549`, addendum `:550`) |
| host-add charge `roster-service.ts:246-262` | `seatPlayer` `roster-service.ts:231`, body `:239-269`, `upsertCharge(..., session.price)` `:269`, `upsertCharge` `:275` |
| "caller holds manage_roster" (derivation, host-add) | SUPERSEDED by the measured key `session.manage` (`0047_tenant_capability_authority_core.sql:77`; `roster-service.ts:76` ACTIONS, `:131` requireActor; `join-request-service.ts:103` HOST_ACTIONS); `manage_roster` is no capability key, it is the TS suspension class of `authorizeTenantAction` (`authorization.ts:153`) (R-C1-a) |
| promotion "target is the FIFO head" | NARROWED (RD-1, RD-3): a waitlisted player of that session under the definer's re-entrant session FOR UPDATE; FIFO order stays in the one TS selector `session-join-service.ts:~416-428` |
| a definer keyed by the account id (0055 pattern) | `0055` `:77-148`: `person_profile_read` `:77` (GRANT app `:90`), `person_profile_update` `:92` (GRANT app `:148`), header `:3-7` |
| the shared connector crypto module L4 created | `packages/db/src/connector-crypto.ts` (105 lines; `encryptConnectorSecret` `:70`, `openConnectorSecret` `:84`), subpath `@plexco/db/connector-crypto` (`packages/db/package.json:15`) |
| `session-join-service.ts` (L8) | `lockSession` `:124` (price `:129`), `joinSession` `:206`, `seatPlayer` call `:303`, `leaveSession` `:326` -> promotion `:385` |
| the waitlist promotion path (L8) | `promoteFromWaitlist` `session-join-service.ts:403`; P-8 skip `~:430-433`; UPDATE `~:434-437`; `upsertCharge` `:438`; `player.promoted` `:447-456` |
| `session-service.ts` price guard PRICE_CHANGE_REQUIRES_POLICY | `session-service.ts:1521-1533` (before the UPDATE `:1541-1548`); INVALID_PRICE create `:206-208`, update `:1282-1284` |
| `packages/db/src/me-settings.ts` | 113 lines: `readMyProfile` `:50-57`, `updateMyProfile` `:60-72`, header `:4-12` |
| `apps/web/app/api/me/profile/route.ts` | 62 lines: GET `:21-26`, PATCH `:28-62`, strict keys `:45` |
| BE doc "PUT /api/me/settings" | `feature_user_settings_tech.md:153-154` (and `PATCH /api/sessions/:id/pricing` `:156`); no such route at the base; superseded by RD-7 / RD-10 |
| `settings-profile-form.tsx` + `settings-view.tsx` | 114 lines (patch `:63`) / 97 lines (`/me/settings` `:16`) |
| `session-form.tsx` + `session-form-model.ts` | 281 lines (price field `:206-219`) / 248 lines (price `:18`, `:40`, `:55`, `:202`, `:235-236`) |
| `packages/core/src/api-contract.ts` | 212 lines; registry rule `:12-15`, `:29-31`; `API_ERROR_CODES` `:92-154` |
| codes "verbatim from feature_user_settings_tech.md" | `CHARGE_DERIVATION_UNAVAILABLE` `:113`; `INVALID_GENDER` `:163`; `GENDER_FORBIDDEN` `:164`; derivation table `:100-126`; edges `:131-148`; tests `:248-264` |
| pinned SQL (gender_enc, price_male / price_female) | `feature_user_settings_tech.md:66-80` (price_male `:76`); `dob_enc` / `username` there stay out (lane NEGATIVE SCOPE) |

## 3. Measured facts the contract rests on

Charge paths (A2, C1-7):
- Every charge or promotion entry is an apps/web route run as role `app` (`appDb()`): host-add `addMemberToSession` `roster-service.ts:125`
  (`sessions/[id]/players/route.ts:41`, POST `:19`), self-join `joinSession` (`sessions/[id]/join/route.ts:38`,
  `public-listings/[publicListingId]/join/route.ts:85`), approve `approveJoinRequest` `join-request-service.ts:302` (`join-requests/[id]/approve/route.ts:29`). No apps/bot caller.
- `seatPlayer` (`roster-service.ts:231`, session `{slotsMax, price}` `:235`) is called at `roster-service.ts:184`, `join-request-service.ts:353` and
  `session-join-service.ts:303`; it writes the player `~:251-265` BEFORE `upsertCharge` `:269`, only when not full (`~:239-240`).
- Exactly two `upsertCharge` sites: `roster-service.ts:269`, `session-join-service.ts:438`. `upsertCharge` `:275` inserts `amountDue: price` (`~:288-301`) or
  revives a void charge (`REJOIN_REQUIRES_REVIEW` when effective money is not 0, `~:309`; else `amount_due := price`, `~:310-311`).
- `promoteFromWaitlist` `session-join-service.ts:403`: `lockSession` `~:408`; selector `ORDER BY waitlist_position, joined_at, id FOR UPDATE` with a skip list
  `~:416-428`; P-8 skip `~:430-433`; UPDATE to active `~:434-437` BEFORE `upsertCharge` `:438`; `amount_due` read back `:447-449`.
- `promoteFromWaitlist` callers: `session-service.ts:1628` (updateSession, slots_max), `:3040` (inside `deleteGuestNote` `:2932`), `roster-service.ts:413`
  (`removePlayerFromSession` `:339`), `session-join-service.ts:385` (`leaveSession` `:326`); all reached from apps/web routes only (R-C1-d).
- Price readers feeding charges: `roster-service.ts:161` (`price: sessions.priceAmount`), `session-join-service.ts:124-129` (lockSession).
  Occupancy is TS-only (`session-occupancy.ts:69`, `:38`, `:48`): no DB function.

Authorization and DB (A3, A4, C1-1, C1-2):
- `tenant_capability_actions` holds 17 keys incl. `session.manage`; no `manage_roster` key. `requireActor` (`roster-money-shared.ts:82-99`): capability
  `authorize` `:93` (FORBIDDEN `:94`), then `authorizeTenantAction` `:96` (TENANT_SUSPENDED `:97`). Approve `join-request-service.ts:204`; self-join `session-join-service.ts:109` (suspension only).
- `tenant_capability_authorize(p_tenant_id uuid, p_action text, p_actor_person_id uuid) RETURNS TABLE(allowed boolean, role text, reason text)`
  (`0049:44-53`): denies unless `p_tenant_id = current_setting('app.tenant_id')` (`:60-69`); REVOKE PUBLIC `:133`, EXECUTE to app only `:134`.
- GUCs: code sets only `app.tenant_id` (`tenant.ts:55`, `:68`); `app.person_id` is set nowhere in non-test code.
- `persons`: rls false, owner plexco, table ACL empty (`0055:3-4`), column ACLs only for identity_definer and job_definer; no non-test direct access.
  `sessions`: rls forced, `tenant_isolation`, `app=arwd`; readonly no SELECT; job_definer has column-level SELECT on 13 named columns (`0061:62`).
- 0055 pattern: SECURITY DEFINER, `SET search_path = pg_catalog, public, pg_temp`, `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO app`
  (`:89-90`, `:147-148`), keyed by account id, "no function takes a person id" (`:6-7`), lock order accounts then persons; owners plexco.
- schema.ts `persons` `:40-49`, `sessions` `:620-643` (price_amount `:631`, `sessions_price_chk` `:649`); db.dbml `persons` `:38-47`, `sessions` `:193-212`.
- `isInt4` is module-private in `session-service.ts:109-110` (INT4_MAX `:101`); `roster-money-shared.ts:53` exports `INT4_MAX`; `roster-service.ts:18` documents the P-19 import cycle.

Crypto (A5, C1-5):
- `connector-crypto.ts`: re-exports `:22-28`; `CONNECTOR_ZALO_KEY_INFO` `:50`; private IV / TAG `~:51-52`, AAD `:63-64`, key `:67`; encrypt `:70` (iv 12, tag 16,
  `iv||tag||ct`); open `:84` (length guard `~:85-86`, GCM `final()` throws).
- `secret-key-root.ts`: `resolveAuthSecretKey` `:24` (KMS or `ENCRYPTION_KEY` base64 `:49`, at least 32 bytes, cached); `authKeyVersion` `:111` (`KMS_KEY_ID` or
  "local"); `deriveAesKey` `:120-121` = HKDF-SHA256, empty salt, 32 bytes, the only `hkdfSync`. Zero files contain `person-gender`; all existing labels differ.

Outbox, realtime, public (A6, A8, C1-3, C1-4, C1-6):
- `emitSessionEvent` (`roster-money-shared.ts:154-168`, insert `:161`) writes `outbox_events` (`app=ar`, free-text type, no idempotency column).
- A type with no route is acked with [] and no delivery (`projector-registry.ts:34-36`, `:45`, `:59`); DLQ is per projector (`0056:11-15`).
- web_realtime is the wildcard route on aggregate session (`schema.ts:1551-1552`, `:1565-1566`); frames carry `{type, sessionId, version}` only
  (`realtime-event-read.ts:6-9`, `:26-34`; `realtime-listener.ts:120`; `api/realtime/subscribe/route.ts:10-12`) to current `session.manage` holders (`realtime-auth.ts:7-9`, `:50`).
- public_sessions has 15 explicit route types; zalo_dm 4 (`zalo_dm_chk` `schema.ts:1567-1569`); no `waitlist.*` row or literal. `session.updated` =
  `{session_id, changed_fields}` with names only (`session-service.ts:1385`, `:1400`, `:1591-1592`); `zalo-dm.ts:96` parses changed_fields.
- public_sessions 22 columns, `public_session_share_v` 17 (`public-sessions-projector.test.ts:219-222`, `rls-invariants.test.ts:171+`); readonly SELECT on the
  view only (`0033:239`, `0061:487`); the projector reads sessions by explicit column list (`0061:206-210`). Every base "gender" token is DD-41
  `gender_restriction` (`decisions.md:590`; e.g. `public-discovery-read.ts:28`, `schema.ts:1633`).

Settings, prices, UI, logs (B1-B8, C1-7):
- Profile route: CSRF + `PATCH_LIMIT` `:16`/`:29`, JSON `:32-34`, 2 KiB `:15`/`:35`, `validCommandId` `:46-48`, `DisplayNameError` -> 400 INVALID_BODY `:53-58`,
  rethrow `:60`, `t()` per request `:18-19`; client `me-settings-client.ts:8` ProfileDto (displayName), `patchMyProfile` `:24-26`; `settings-error-ui.ts:11`, default `:64-65`.
- No platform config exists; flag precedent `.env.example:99`, `:169-172`, reader documented at `request-policy.ts:20`. Buckets `tenant-lang.test.ts:105-108`,
  `:113`; `me/profile` "b" `:170`; `sessions/[id]` "a" `:129`; players "a" `:140`.
- `[id]` route `:25` is PUT; `SessionFieldPayload` `session-command-route.ts:361` (priceAmount `:365`), key list `:391`, `shapeSessionFields` `:470`,
  `shapeCreateFields` `:478`; `STATUS_BY_CODE` `:499-543`; `VALIDATION_VARIANTS` `:550-558`; message pairs `:560-568`; `RosterMoneyErrorCode` `roster-money-shared.ts:14-37`.
- `getSessionDetail` `session-read.ts:264` (priceAmount `:100`, `:183`) behind `mayManageSessions` (`session-read-route.ts:62`); DTOs `sessions-api.ts:22`, `:86`,
  `:117-121`; edit form `edit-session-view.tsx:78`; `public-discovery-read.ts:19`, `:65`, `:76` carry price_amount only; `JoinSessionResultDto` (`api-contract.ts:173-181`) has no amount.
- Host-add errors render via `describeSessionError` (`session-error-ui.ts:114`), which shows a server message only for `DOMAIN_CODES` (`~:56`, branch `:178-191`); 503 is not definite (`:194-199`).
- `log.ts` `REDACT_KEY` `:21-22` lacks gender, `sanitizeFields` `:58-89`; me/* routes log the error name only (`me/charges/route.ts:22`). GitNexus is stale at
  dd5375f (367 commits, 545 files behind): grep-callers fallback (RD-13).

## 4. Contract (binding)
Decided contract at the base `de732028f3163541928ae7eeac71beebf16e5a18`: drafts A and B as amended by the rulings below and by C1. `[UNPINNED]` = default applied, pending owner sign-off (section 5 lists them; the PR body repeats them).

### 4.0 Orchestrator rulings (P3-S9, 11:30, binding)
- RD-1 Promotion failure: continue-next, no renumbering (signed DD-45 `decisions.md:621/:623`, tech edge #11 `feature_user_settings_tech.md:146`): the failing candidate stays waitlisted (same position, no charge, no venue, no DM), the next eligible FIFO candidate is promoted with its own derived charge and its one DM, the seat-freeing write commits.
- RD-2 DD-45 retry root (`promotion_retry_id` job) NOT built [UNPINNED]: NEGATIVE SCOPE + OPEN follow-up; the audit record is one outbox event `waitlist.charge_derivation_failed` per opener attempt, payload `{session_id, player_id, membership_id, reason}` only; condition (a) holds (C1-3), condition (b) is amended by R-C1-b.
- RD-3 Derivation definer: signature and per-context checks accepted, amended: no session-status check; authorize BEFORE reading any gender column and raise the identical `GENDER_FORBIDDEN` (42501) whether `gender_enc` is NULL or not; promotion = a waitlisted player of that session + the definer's own re-entrant FOR UPDATE (narrows "FIFO head"); no SQL seat check; host_add also serves approve, with the TS capability key.
- RD-4 `deriveChargeAmount` returns `{ ok: true, amount }` or `{ ok: false, code: "CHARGE_DERIVATION_UNAVAILABLE" }` only (no genderMissing flag); two call sites, both before the first write (seatPlayer; promoteFromWaitlist after the P-8 skip); upsertCharge stays the only `amount_due` writer, no caller passes `session.price` raw; single price => `price_amount` without the definer; an amount outside [0, 2147483647] => the same failure, zero writes [UNPINNED].
- RD-5 Crypto scope addition: `connector-crypto.ts` exports ONE envelope pair `sealAesGcm` / `openAesGcm`, connector output byte-identical, connector tests unchanged; gender key = HKDF label `plexco:person-gender-enc:v1` on the auth root, AAD `plexco:person-gender-aad:v1:<person_id>`, key version `authKeyVersion()` checked before open; every failure => `CHARGE_DERIVATION_UNAVAILABLE` (charge path) or generic 500 (self-read).
- RD-6 Columns and self definers: persons `gender_enc bytea NULL`, `gender_key_version text NULL`, `gender_pricing_consent boolean NOT NULL DEFAULT false`, named pair CHECK; sessions `price_male` / `price_female` integer NULL, named CHECK >= 0; no dob_enc, no username; `person_gender_read(p_account_id)` / `person_gender_update(p_account_id, p_expected_person_id, ...)`, zero writes on a person mismatch; persons keeps zero runtime-role grants.
- RD-7 Settings API: extend GET / PATCH `/api/me/profile` (no `/api/me/settings`); strict keys; gender in male | female | other | undisclosed | null; `""` or any other value => `INVALID_GENDER` 400 without echoing the input; genderConsent boolean; null = erase; a self-read decrypt failure => generic 500, never shown as "not set".
- RD-8 DD-54 flag `GENDER_COLLECTION_ENABLED`: only "true" enables, committed OFF (`.env.example` false); OFF: GET reports it, the control is hidden, a PATCH with a non-null gender or `genderConsent: true` => 400 `INVALID_BODY` (no new code), erase / withdraw always accepted; the charge path never reads the flag; the prompt shows only when ON and gender is NULL, only on /me/settings.
- RD-9 Consent: OFF keeps the ciphertext; null erases; a first declaration defaults to consent OFF (explicit opt-in); a gender or consent change never touches existing charges.
- RD-10 Session prices ride the existing create and [id] update routes (no PATCH /pricing); the mode is derived (no mode column); INVALID_PRICE collapses to INVALID_BODY 400; the `session-service.ts:1521` guard also covers price_male, price_female and a mode change (PRICE_CHANGE_REQUIRES_POLICY, zero writes); per-gender prices appear only in the host / manage read of the host's own session; session-form.tsx at ~325 lines accepted; one host hint t(vi, en).
- RD-11 Codes: `CHARGE_DERIVATION_UNAVAILABLE` 503 with a gender-free t(vi, en) message; `INVALID_GENDER` 400; `GENDER_FORBIDDEN` 403 registered and mapped once in the shared session-route error map, emitted only when the typed domain refusal surfaces (defect path), fixed message carrying no person data.
- RD-12 Scope additions inside the B3 exception, each limited to its measured need: session-command-route.ts, me-settings-client.ts (+ test), roster-money-shared.ts, sessions-api.ts, the session-detail read (`packages/db/src/session-read.ts`, C1-7), the public-listings join route (error mapping only), .env.example (one line), connector-crypto.ts, session-error-ui.ts (need measured by C1-7), the touched tests; any further file needs a new ruling.
- RD-13 GitNexus is stale (indexed at dd5375f): the grep-callers fallback is stated in the PR body; no index refresh in the root checkout.
- RD-14 Every [UNPINNED] value and the B3-B6 en strings read "default applied, pending owner sign-off", repeated in the PR body; L17 consolidates; decisions.md is never edited.
- RD-15 Promotion DM fee = the derived amount read back from the charge row (one source); no gender in any DM, event or frame; a failing candidate gets no promotion and no DM.
- R-C1-a host_add (also approve) authorizes with `tenant_capability_authorize(<session tenant>, 'session.manage', <actor person>)` and requires `allowed`; manage_roster stays the TS suspension action class (authorizeTenantAction, before any charge write on all three paths); the L11 definers use the 0055 owner; at most one conditional GRANT EXECUTE on that function to that owner.
- R-C1-b Alternative (i): `waitlist.charge_derivation_failed` goes through the one emitter `emitSessionEvent` (`roster-money-shared.ts:161`) on aggregate session; no payload field reaches any client; session.manage holders of the tenant get only the refetch frame `{type, sessionId, version}`; one test pins that frame for this type.
- R-C1-c price_male / price_female enter NO changed_fields list and NO outbox payload; zalo-dm.ts stays out of scope; the missing per-gender change notice is [UNPINNED] and an OPEN item, OUT_OF_SCOPE.
- R-C1-d `session-service.ts:3040` = promoteFromWaitlist inside deleteGuestNote (:2932); every non-test caller outside packages/db is an apps/web route, no apps/bot caller, so the derivation definer EXECUTE goes to app only; other unmeasured file names are measured read-only by the step's writer.
- R-C1-e `apps/web/lib/log.ts` REDACT_KEY (:21-22) gains the token gender (one regex alternative; it also matches genderConsent and gender_enc keys) + one case in its existing test file; gender is still never passed to any logger.

C2 readings: (1) no persons length CHECK, the RD-5 TS guard owns short blobs; (2) promotion passes actorPersonId null; (3) person_gender_update zero rows => ROLLBACK + 404 NOT_FOUND [UNPINNED]; (4) a decrypted value outside the four => the same failure, crypto stays in packages/db (no new package.json subpath); (5) the GENDER_FORBIDDEN pair [UNPINNED] lives only in the shared session-route map, not in DOMAIN_CODES, and the public-join catch maps CHARGE_DERIVATION_UNAVAILABLE only; (6) the RD-10 host hint also covers consent [UNPINNED]; (7) no SERVER_FIELD_TO_FORM or errorField change; (8) this heading says 11:30 as the task line names it (rulings file stamped 11:35); (9) section 0 actor a = session.manage holder, section 2 marks manage_roster SUPERSEDED and "FIFO head" NARROWED.

### 4.1 Migration 0062_gender_pricing.sql, schema.ts, db.dbml
- `packages/db/migrations/0062_gender_pricing.sql` is the lane's ONLY migration (next free measured at the base: tail 0059-0061, plexco_test `schema_migrations` = 62 rows); append-only; it also creates the definers of 4.2.
- `persons` (rls=false, owner plexco, table ACL empty, 0055 header `:3-4`): `ADD COLUMN gender_enc bytea`, `ADD COLUMN gender_key_version text`, `ADD COLUMN gender_pricing_consent boolean NOT NULL DEFAULT false`, `ADD CONSTRAINT persons_gender_enc_version_chk CHECK ((gender_enc IS NULL) = (gender_key_version IS NULL))` [UNPINNED names]; no length CHECK (C2 reading 1).
- `sessions` (rls + force, policy tenant_isolation, app=arwd table-level): `ADD COLUMN price_male integer`, `ADD COLUMN price_female integer`, `ADD CONSTRAINT sessions_price_male_chk CHECK (price_male IS NULL OR price_male >= 0)`, `ADD CONSTRAINT sessions_price_female_chk CHECK (price_female IS NULL OR price_female >= 0)` (CHECK form pinned by tech doc `:76`; constraint names [UNPINNED]); integer = int4 bounds the top.
- Meaning: both per-gender prices NULL = single price; at least one set = gender mode; a NULL side falls back to `price_amount`; no mode column, no second price table.
- Grants: NONE on any new column and no REVOKE (column grants are per named column: the identity_definer / job_definer persons grants and job_definer's sessions column SELECT `0061:62` do not extend); no `outbox_projector_routes` row; no dob_enc, no username.
- `packages/db/schema.ts`: persons (`:40-49`) gains `genderEnc`, `genderKeyVersion`, `genderPricingConsent` (notNull, default false) + `persons_gender_enc_version_chk`; sessions (`:620-643`) gains `priceMale`, `priceFemale` + both named checks, declared LAST (physical order, the 0044 pattern comment ~`:640-643`; `sessions_price_chk` `:649` untouched).
- `db.dbml`: persons (`:38-47`) and sessions (`:193-212`) gain the same columns and notes.
- Tests: catalog `has_column_privilege(r, 'persons', c, 'SELECT') = false` for c in {gender_enc, gender_key_version, gender_pricing_consent} x r in {app, app_worker, readonly, job_definer, identity_definer, chat_definer}; `has_column_privilege(r, 'sessions', c, 'SELECT') = false` for c in {price_male, price_female} x r in {readonly, app_worker, job_definer} (C1-4); pg_constraint holds the three named CHECKs (AP-37/38); a negative price fails its CHECK (tech edge #6).

### 4.2 Definers (self read / write, derivation)
- Common shape (0055 `:77-148`): SECURITY DEFINER, `SET search_path = pg_catalog, public, pg_temp`, `public.`-qualified relations, `REVOKE ALL ... FROM PUBLIC`, `GRANT EXECUTE ... TO app` only (R-C1-d); owner = the owner of the 0055 person definers (catalog at the base: plexco; the step-1 writer re-measures it); no definer-role bootstrap. Function names and context literals [UNPINNED].
- `person_gender_read(p_account_id uuid) RETURNS TABLE (person_id uuid, gender_enc bytea, gender_key_version text, gender_pricing_consent boolean)`: the account's own ACTIVE person via `accounts.person_id`; person_id feeds the AAD server-side and never enters a DTO.
- `person_gender_update(p_account_id uuid, p_expected_person_id uuid, p_gender_enc bytea, p_gender_key_version text, p_consent boolean) RETURNS TABLE (person_id uuid)`: accounts FOR UPDATE, then UPDATE only the three persons columns WHERE `id = accounts.person_id AND id = p_expected_person_id AND status = 'active'`; zero rows on a relink race => the TS caller rolls back, 404 `NOT_FOUND` (C2 reading 3); NULL enc + NULL version = erase; the pair CHECK backs the arguments; no argument names a target person, so no host can set anyone's gender.
- `charge_gender_for_derivation(p_context text, p_session_id uuid, p_membership_id uuid, p_actor_person_id uuid) RETURNS TABLE (person_id uuid, gender_enc bytea, gender_key_version text)`, VOLATILE, never writes; contexts `self_join`, `host_add`, `promotion`. Authorization completes BEFORE any gender column is read:
  1. `app.tenant_id` is set and equals `sessions.tenant_id` of p_session_id (as 0049 `:60-69`);
  2. membership p_membership_id is in that tenant with status IN ('active', 'guest') (a 0058 guest membership minted earlier in the same tx is visible);
  3. self_join: `memberships.person_id = p_actor_person_id`; host_add (host-add AND approve): `(public.tenant_capability_authorize(<session tenant>, 'session.manage', p_actor_person_id)).allowed` (R-C1-a; manage_roster is not a capability key, C1-1); promotion: the definer's own re-entrant `SELECT 1 FROM public.sessions WHERE id = p_session_id FOR UPDATE`, then a players row (p_session_id, p_membership_id) with `status = 'waitlisted'`, p_actor_person_id ignored (TS passes null);
  4. no session-status check (TS owns it under the session lock), no FIFO-head check (the one TS selector owns order, RD-1), no seat check (one occupancy formula, `session-occupancy.ts:69`).
- Any failed step or unknown context: `RAISE EXCEPTION 'GENDER_FORBIDDEN' USING ERRCODE = '42501'`, identical whether gender_enc is NULL or not, no ciphertext returned. After authorization: `(person_id, NULL, NULL)` when `gender_pricing_consent = false` or `gender_enc IS NULL`, else `(person_id, gender_enc, gender_key_version)`.
- `tenant_capability_authorize` (0049 `:44-53`, EXECUTE to app only `:133-134`): only if the definer owner cannot already execute it, the migration adds exactly one `GRANT EXECUTE ON FUNCTION public.tenant_capability_authorize(uuid, text, uuid) TO <that owner>`; nothing to app_worker, readonly or PUBLIC.
- TS maps SQLSTATE 42501 with message GENDER_FORBIDDEN to `RosterMoneyError("GENDER_FORBIDDEN")` (4.10); it aborts the whole tx (defect path, zero writes).
- Tests: each context allowed and refused; the refusal is identical for NULL and set gender_enc; consent OFF returns NULLs; a host of another tenant is refused; a non-waitlisted membership is refused for promotion; catalog: EXECUTE held by app only.

### 4.3 Crypto (gender-crypto.ts, the connector-crypto.ts envelope export)
- `packages/db/src/connector-crypto.ts` (RD-5) exports `sealAesGcm(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer` and `openAesGcm(key: Buffer, enc: Buffer, aad: Buffer): Buffer`: layout `iv(12) || tag(16) || ct`, a random 12-byte iv per seal, `authTagLength: 16` on cipher AND decipher, the length guard `enc.length < 12 + 16 + 1` throws (today ~`:85-86`), `final()` throws on a tag mismatch.
- `encryptConnectorSecret` (`:70`) / `openConnectorSecret` (`:84`) call the pair with byte-identical output; `CONNECTOR_ZALO_KEY_INFO` (`:50`), the connector AAD (`:63-64`) and its key-version check are unchanged; the existing web + bot connector tests pass UNCHANGED; grep-callers blast radius in the PR body.
- NEW `packages/db/src/gender-crypto.ts`: `encryptPersonGender(personId, gender): Promise<{ enc: Buffer; keyVersion: string }>` and `openPersonGender(personId, enc, keyVersion): Promise<{ ok: true; gender: Gender } | { ok: false }>` [UNPINNED names].
  - key = `deriveAesKey(await resolveAuthSecretKey(), "plexco:person-gender-enc:v1")` (`secret-key-root.ts:24`, `:120-121`), NOT `resolveConnectorSecretRoot` (DD-122 O4 connector key); no new secret (local ENCRYPTION_KEY).
  - AAD = `"plexco:person-gender-aad:v1:" + personId` (a blob copied to another person fails GCM auth); plaintext = the UTF-8 bytes of the value.
  - keyVersion = `authKeyVersion()` (`secret-key-root.ts:111`), stored in `persons.gender_key_version` and checked BEFORE open.
  - `{ ok: false }` on: keyVersion NULL with a blob, keyVersion !== authKeyVersion(), blob < 29 bytes, GCM failure, or a decrypted value outside male | female | other | undisclosed.
  - No message carries plaintext, ciphertext or key version; an internal Error uses the fixed literal "gender ciphertext could not be opened" [UNPINNED].
  - Callers: charge path => `CHARGE_DERIVATION_UNAVAILABLE` (4.4); self-read => generic 500 (4.7); never a fallback price.
- Labels are unused at the base (0 files contain `person-gender`, C1-5); HKDF info separation keeps the key distinct from the PKCE, email and connector keys under the same root.
- Import from the module L4's PR records, at the base `packages/db/src/connector-crypto.ts` (`@plexco/db/connector-crypto`, package.json `:15`); no new subpath.
- Tests: round trip per value; a person-copied blob fails; a wrong key version fails before open; short blob; flipped tag byte; connector tests unchanged.

### 4.4 deriveChargeAmount and its two call sites
- NEW `packages/db/src/charge-derivation.ts`: `deriveChargeAmount(tx, { context, sessionId, membershipId, actorPersonId, prices: { priceAmount, priceMale, priceFemale } }): Promise<{ ok: true; amount: number } | { ok: false; code: "CHARGE_DERIVATION_UNAVAILABLE" }>`; never writes, never enqueues, never logs (RD-4).

| Input | Result |
|---|---|
| priceMale NULL and priceFemale NULL | `priceAmount`; the definer is NOT called |
| definer row `(person_id, NULL, NULL)`: consent OFF or gender never set | `priceAmount` (a valid state; the prompt comes from the owner's self-read, 4.7) |
| male + priceMale set / female + priceFemale set | `priceMale` / `priceFemale` |
| male with priceMale NULL, female with priceFemale NULL, other, undisclosed | `priceAmount` |
| `openPersonGender` returns `{ ok: false }` (4.3) | `{ ok: false, code }`, NO fallback price |
| amount not an integer, < 0 or > `INT4_MAX` | `{ ok: false, code }`, zero writes [UNPINNED] |
| definer raises 42501 GENDER_FORBIDDEN | throws `RosterMoneyError("GENDER_FORBIDDEN")`, the tx aborts (defect path, 4.2) |

- `INT4_MAX` is imported from `roster-money-shared.ts:53`; inline check `Number.isInteger(a) && a >= 0 && a <= INT4_MAX`; no import of session-service (call-time cycle P-19, `roster-service.ts:18`).
- Call site 1, `seatPlayer` (`roster-service.ts:231`): after `full` (~`:239-240`), before the player insert / revive (~`:251`), only when `!full`; `{ ok: false }` => `throw new RosterMoneyError("CHARGE_DERIVATION_UNAVAILABLE")`, the whole tx rolls back. Its three callers pass the context: host-add `:184` = `host_add` + the host's person; approve `join-request-service.ts:353` = `host_add` + the approver's person; join `session-join-service.ts:303` = `self_join` + the joining person. Its `session` parameter (`:235`) gains priceMale / priceFemale.
- Call site 2, `promoteFromWaitlist` (`session-join-service.ts:403`): after the P-8 `rejoinUnprovable` skip (~`:430-433`), before `UPDATE players SET status = 'active'` (~`:434`); context `promotion`, actorPersonId null; failure handling in 4.5.
- `upsertCharge` (`roster-service.ts:275`) receives the derived amount at both sites (`:269`, `session-join-service.ts:438`) and stays the ONLY writer of `charges.amount_due` (insert ~`:288-301` and the void revive ~`:310-311`); no caller passes `session.price` raw.
- Price readers extended with priceMale / priceFemale: `roster-service.ts:161` (addMember session select) and `session-join-service.ts:124-129` (lockSession).
- After commit `charges.amount_due` is the authority (DD-91, tech `:125`): no reader decrypts or re-runs the formula; the `player.promoted` `amount_due` (read back `:446-449`) is the DM fee (RD-15).
- Tests: one case per table row, the single-price path asserts zero definer calls, the int4 row uses an out-of-range price input; a gender change after a charge leaves that `amount_due` unchanged and the next new charge uses the new gender (tech edge #7).

### 4.5 Failure per path (host-add, self-join and approve, promotion)
- host-add (`addMemberToSession` `roster-service.ts:125`): the throw comes before any player write inside the withTenant tx => rollback: no player, no charge, no recordCommand (`:208` rolls back); 503 with the 4.10 pair, shown to the host by ApiErrorNotice (DOMAIN_CODES, 4.10).
- self-join (`joinSession` `session-join-service.ts:206`, both web routes) and approve (`approveJoinRequest` `join-request-service.ts:302`): the same throw rolls back the whole tx, including a 0058 guest membership minted at `:302` / `:352`; no player, charge or venue; an approve leaves the join request pending; 503 + the 4.10 pair.
- promotion (openers: leaveSession `:385`, removePlayerFromSession `roster-service.ts:413`, updateSession `session-service.ts:1628`, deleteGuestNote `session-service.ts:3040`), on `{ ok: false }`:
  1. the candidate is unchanged: waitlisted, same position, no charge, no venue, no DM;
  2. `emitSessionEvent(tx, tenantId, sessionId, "waitlist.charge_derivation_failed", { session_id, player_id, membership_id, reason: "CHARGE_DERIVATION_UNAVAILABLE" })` (R-C1-b; payload keys exactly these four; type name from DD-45);
  3. `skipped.push(next.id)` and `continue` with the next FIFO candidate, which gets its own derived charge and its one DM (RD-1);
  4. the opener's seat-freeing write commits; no renumbering, so the candidate heads the selector again on the next opener.
- One event per opener attempt (outbox_events has no idempotency column; the DD-45 "exactly one" dedupe belongs to the deferred retry root) [UNPINNED].
- Event reach: web_realtime (wildcard route) sends session.manage holders of the tenant only `{type, sessionId, version}` (`realtime-event-read.ts:6-9`, `realtime-auth.ts`); public_sessions has an explicit 15-type list without it; `zalo_dm_chk` (`schema.ts:1567-1569`) admits 4 types only. No route row is added.
- GENDER_FORBIDDEN on any path aborts the whole tx, the seat-freeing write included (defect path only).
- NEGATIVE SCOPE: the DD-45 retry root (`promotion_retry_id`, CAS / lease, 3 attempts, DLQ, owner digest); the next opener re-running the selector from the head is the only retry.
- Decrypt-failure matrix: {corrupt blob, wrong key version, blob copied from another person} x {host-add, self-join, approve, promotion} => zero new charge rows and no newly active player; host-add / join / approve answer 503 and roll back a new guest membership; promotion writes the event, keeps the candidate waitlisted and promotes the next candidate.

### 4.6 Public whitelist
- Exact sets stay unchanged and must stay green: `public_sessions` 22 columns, `public_session_share_v` 17 in order (PSP-1a `public-sessions-projector.test.ts:219-222`, `rls-invariants.test.ts:171+`).
- The 4.1 catalog test pins the physical fence: job_definer has no SELECT on price_male, price_female or the three persons columns, so `public_sessions_project_session` (explicit lists `0061:206-210`, `:260-307`) cannot read them; readonly reads only the view (`0033:239`, `0061:487`).
- Discovery DTO test (extend the existing route tests): the JSON of `/api/discover`, `/api/discover/[id]` and the share route has none of the keys `gender_enc`, `gender_key_version`, `gender_pricing_consent`, `price_male`, `price_female`, `genderEnc`, `genderKeyVersion`, `genderPricingConsent`, `priceMale`, `priceFemale`, `gender`, `genderConsent`; `public-discovery-read.ts` (`:19/:65/:76`) keeps price_amount only; `JoinSessionResultDto` (`api-contract.ts:173-181`, no amount, P-18) is unchanged.
- Outbox payload test: the `player.added`, `player.promoted`, `session.updated` and `waitlist.charge_derivation_failed` payloads carry no gender key and no per-gender price (R-C1-c); one test pins the realtime frame `{type, sessionId, version}` for the new type.
- Tests ban EXACT names, never the token "gender": `gender_restriction` (DD-41 join condition, `decisions.md:590`; 0061, `public-discovery-read.ts:28/:67`, `discovery-route-support.ts:234`, `schema.ts:1633`) stays.

### 4.7 Settings API, DD-54 collection flag, consent
- Extend `apps/web/app/api/me/profile/route.ts` (GET `:21-26`, PATCH `:28-62`); no new route, so SURFACE_BUCKETS keeps `"b"` (`tenant-lang.test.ts:170`).
- PATCH strict keys within {displayName, gender, genderConsent, commandId}; commandId required (`:46-48`); at least one of the other three present; an unknown key or a missing field => 400 `INVALID_BODY`; displayName becomes optional.
- gender: `"male" | "female" | "other" | "undisclosed" | null`; anything else (`""`, "Nam", "MALE", a number) => 400 `INVALID_GENDER` with t("Giá trị giới tính không hợp lệ.", "Invalid gender value.") (vi verbatim from tech doc `:163`; en [UNPINNED]); the body never echoes the input. genderConsent: boolean, else 400 `INVALID_BODY`.
- `gender: null` erases the triple (enc and version NULL, consent false); `{ gender: null, genderConsent: true }` => 400 `INVALID_BODY` [UNPINNED]. An absent field keeps its stored value; the column default false makes a first declaration consent OFF (RD-9).
- Flag: `GENDER_COLLECTION_ENABLED` [UNPINNED name], read at call time by a helper copying the `request-policy.ts:20` CSP_SCRIPT_NONCE_ENABLED reader (only "true"); `.env.example` gains `GENDER_COLLECTION_ENABLED=false`; ON only in the local test env, e2e and the golden path. OFF: a non-null gender or `genderConsent: true` => 400 `INVALID_BODY`; `gender: null` and `genderConsent: false` are always accepted; the charge path never reads it.
- `packages/db/src/me-settings.ts`: `updateMyProfile` writes the present fields in ONE transaction (pool client BEGIN / COMMIT): `person_profile_update` for displayName, then `person_gender_read`, `encryptPersonGender(person_id, gender)` when a value is sent, `person_gender_update(account, person_id, ...)`; zero rows => ROLLBACK + 404 `NOT_FOUND`.
- Response (GET and PATCH): `{ profile: { displayName: string | null, gender: "male" | "female" | "other" | "undisclosed" | null, genderConsent: boolean }, genderCollection: boolean }`; the only plaintext exit. `readMyProfile` opens via `openPersonGender`; `{ ok: false }` => a typed Error with a fixed message => generic 500, never `gender: null`.
- Consent OFF keeps the ciphertext and the derivation reads NULL (no decrypt attempted, so a non-consenting person never meets CHARGE_DERIVATION_UNAVAILABLE); PATCH writes persons only and re-derives no charge.
- Tests (`route.test.ts`, `me-settings.test.ts`, `me-settings-client.test.ts`): the OFF and ON rows; INVALID_GENDER bodies omit the input; strict keys; a mixed body is atomic; relink race => 404; self-read decrypt failure => 500; consent OFF => price_amount.

### 4.8 Session prices and the price guard
- `packages/db/src/session-service.ts`: `CreateSessionInputPayload` (`:67-80`), the update payload (`:1095-1109`), `SessionUpdateSet` (`:1144-1155`) and the current-row select (`:1305-1318`) gain `priceMale?: number | null` and `priceFemale?: number | null`; the insert (`:294`) stores NULL when a side is absent.
- Validation at create (`:206-207`) and update (`:1283`): `undefined` = absent (NULL on create, leave alone on update); `null` = clear (that side falls back to price_amount); else `isInt4(v, 0)` (`:109-110`) or `INVALID_PRICE` "price_male must be an integer in [0, 2147483647] or null" (same for price_female), which collapses to 400 `INVALID_BODY` (VALIDATION_VARIANTS `session-command-route.ts:550-558`); no new public code.
- Guard: `:1521` becomes `changes.priceAmount !== undefined || changes.priceMale !== undefined || changes.priceFemale !== undefined`; same probe (any charges row of the session, void included), same `PRICE_CHANGE_REQUIRES_POLICY`, still before the UPDATE (`:1541-1548`), zero writes; a single <-> gender mode switch is a per-gender change, so it is covered.
- changed_fields (`:1385-1401`) gets NO price_male / price_female entry (R-C1-c): `session.updated` `{ session_id, changed_fields }` (`:1591-1592`) keeps its existing names; the per-gender change notice is [UNPINNED], OPEN, OUT_OF_SCOPE.
- Routes: `session-command-route.ts` `SessionFieldPayload` (`:361`, priceAmount `:365`) and the key list (`:391`) gain `priceMale` / `priceFemale`; `shapeSessionFields` (`:470`) and `shapeCreateFields` (`:478`) share that list, so POST `/api/sessions` and PUT `/api/sessions/[id]` (`route.ts:25`) carry them and a provided null is forwarded as clear (`route.ts:17-19`); no `PATCH /api/sessions/:id/pricing` [UNPINNED].
- Reads: `packages/db/src/session-read.ts` `getSessionDetail` (`:264`, priceAmount `:100/:183`) returns priceMale / priceFemale to the host / manage read only (`session-read-route.ts:62` mayManageSessions = session.manage, one 403); `apps/web/lib/sessions-api.ts` `SessionDetailDto` (`:86`) and `SessionFieldsBody` (`:117-121`) gain `priceMale: number | null` / `priceFemale: number | null` (optional in the body); createSession / updateSession (`:179/:186`) send them.
- Never in public_sessions, the view, a public / discovery / anonymous DTO, the public join result, the promotion DM, any outbox payload or a log (RD-10, 4.6).
- Tests: create with both / one / no per-gender price; update clears one side; -1, 1.5, 2147483648 and "100" => 400 INVALID_BODY; a priceMale-only change, and a mode switch, with a void charge present => PRICE_CHANGE_REQUIRES_POLICY and an unchanged row version; `session-read.test.ts` host read carries both.

### 4.9 Web UI (settings, session form)
- `apps/web/lib/me-settings-client.ts`: `ProfileDto` (`:8`) gains `gender` and `genderConsent`; the GET result carries `genderCollection`; `patchMyProfile` (`:24-26`) takes optional displayName / gender / genderConsent plus commandId.
- `apps/web/components/me/settings-profile-form.tsx` (114 -> ~190 lines): the gender Select and the consent checkbox, rendered only when `genderCollection`; one Save sends only the changed fields, commandId bound to the sent JSON (`:63-67` pattern).
- One value list: `GENDER_VALUES = ["male", "female", "other", "undisclosed"]` exported from `packages/core/src/api-contract.ts` [UNPINNED name] feeds the route validator and the Select; packages/db uses it if its package.json already depends on @plexco/core, else gender-crypto.ts keeps one local literal union (the writer measures).
- Labels (vi from DD-39 and the FE spec; en [UNPINNED]):

| Item | t(vi, en) |
|---|---|
| male / female | t("Nam", "Male") / t("Nữ", "Female") |
| other / undisclosed | t("Khác", "Other") / t("Không tiết lộ", "Prefer not to say") |
| unset option (sends null) | t("Chưa đặt", "Not set") |
| field label | t("Giới tính", "Gender") |
| consent | t("Cho phép CLB sử dụng giới tính để tính giá", "Allow clubs to use my gender for pricing") |
| consent OFF caption | t("Không chia sẻ giới tính", "Gender not shared") |
| remove (flag OFF, data stored) | t("Xoá giới tính đã lưu", "Remove my saved gender"), sends `{ gender: null, genderConsent: false }` |
| prompt | t("Bạn chưa đặt giới tính. Ở kèo có giá theo giới tính, bạn sẽ trả giá mặc định cho tới khi đặt.", "You have not set your gender. In sessions priced by gender you pay the default price until you set it.") |

- Prompt: `apps/web/components/me/settings-view.tsx` shows it as a `role="status"` paragraph above the Profile card (`:60-65`) only when `genderCollection && profile.gender === null`; only on /me/settings, not on the join result or me-charges [UNPINNED]. Flag OFF with stored data: only the remove button.
- `apps/web/lib/session-form-model.ts`: `SessionFormValues` (`:18`) gains `priceMode: "single" | "gender"`, `priceMale: string`, `priceFemale: string` (defaults "single", "", ""); `valuesFromSession` (`:55`) picks "gender" when either per-gender price is non-null and fills both with `formatVndInput` (null => "").
- `validateForm` (`:166-168`): the base price stays required (it is the fallback); in gender mode "" = null for that side and NaN reuses "Giá không hợp lệ."; both sides empty => t("Nhập ít nhất một giá theo giới tính, hoặc chọn Một giá.", "Enter at least one price by gender, or choose One price.").
- `buildCreateBody` (`:202`): each side = gender mode ? parsed-or-null : null. `buildUpdateBody` (`:235-236`): a side is sent only when it differs from the original; switching to single sends null for each side that was set (keeps the `:216-219` "untouched never trips the guard" rule).
- `apps/web/components/sessions/session-form.tsx` (281 -> ~325 lines, RD-10): Select t("Cách tính giá", "Pricing") with t("Một giá cho mọi người", "One price for everyone") / t("Giá theo giới tính", "Price by gender") (pattern `:248-259`); in gender mode the base label is t("Giá mặc định (VND)", "Default price (VND)") with the hint (C2 reading 6) t("Áp dụng cho người chưa đặt giới tính, không cho phép dùng giới tính để tính giá, hoặc chọn Khác / Không tiết lộ.", "Applies to players with no gender set, who have not allowed gender pricing, or who chose Other / Prefer not to say.").
- Gender mode adds t("Giá nam (VND)", "Price for men (VND)") and t("Giá nữ (VND)", "Price for women (VND)") TextFields; all three share the `:212-218` onChange through one local helper (parseVndInput / formatVndInput; any display uses formatVnd of `apps/web/lib/money.ts`, OD-4b); the open-session notice (`:140-143`) gains t("(kể cả giá theo giới tính)", "(including prices by gender)"); no SERVER_FIELD_TO_FORM (`:37-44`) or errorField change.
- Tests: model (gender-mode load, per-side diff, switch-to-single nulls, both-empty error, int4 overflow => NaN error); component (the toggle shows the two inputs); settings-forms (hidden when OFF, selector + consent when ON, prompt only for null, remove button when OFF with stored data); e2e `settings.spec.ts` one ON-mode set / clear run with the flag on in the Playwright webServer env.

### 4.10 Codes, statuses, error mapping, logging
- `packages/core/src/api-contract.ts` `API_ERROR_CODES` (`:92-154`, sorted; registry rule `:12-15`, `:29-31`) gains `CHARGE_DERIVATION_UNAVAILABLE`, `GENDER_FORBIDDEN`, `INVALID_GENDER` in sorted position; the header comment cites tech doc `:113`, `:163`, `:164`.
- `packages/db/src/roster-money-shared.ts` `RosterMoneyErrorCode` (`:14-37`) gains `CHARGE_DERIVATION_UNAVAILABLE` and `GENDER_FORBIDDEN`.
- `apps/web/lib/session-command-route.ts` STATUS_BY_CODE (`:499-543`) gains `["CHARGE_DERIVATION_UNAVAILABLE", 503]` and `["GENDER_FORBIDDEN", 403]` (503 = retryable infrastructure failure, LINK_UNAVAILABLE precedent `api-contract.ts:69-76` [UNPINNED]); the message table (`:560-568`, per request, the domain message never echoed `:562`) gains ["Chưa tính được giá. Chưa có gì được ghi lại, vui lòng thử lại sau.", "The price could not be worked out. Nothing was saved; please try again later."] and ["Không được phép thực hiện thao tác này.", "This action is not allowed."] [UNPINNED].
- `apps/web/lib/session-error-ui.ts` DOMAIN_CODES (~`:56`) gains CHARGE_DERIVATION_UNAVAILABLE only, so host and player see its message; GENDER_FORBIDDEN keeps the generic rendering; a 503 is not "definite" (`:194-199`), so a retry reuses the commandId, correct after zero writes.
- The public join route's own catch (`apps/web/app/api/public-listings/[publicListingId]/join/route.ts:96`) maps CHARGE_DERIVATION_UNAVAILABLE to 503 with the same pair inside its runWithLang (`:83`); nothing else changes there.
- Profile route: `INVALID_GENDER` is an inline `err(..., 400)` like DisplayNameError (`:53-58`); `settings-error-ui.ts` is unchanged (a closed-set control cannot produce it; default `base` `:64-65`).
- Logging: gender plaintext, ciphertext in any encoding, key version and consent never reach `log.*` / `console.*` arguments, Error messages, error envelopes, outbox payloads or any DTO but the self-read; gender-path Errors use fixed literals; routes log at most the error name (`apps/web/app/api/me/charges/route.ts:22` pattern).
- R-C1-e: `apps/web/lib/log.ts` REDACT_KEY (`:21-22`) gains the alternative `gender`, with one case in `apps/web/lib/log.test.ts`.
- Tests: console spies (error, warn, log, info) on the profile route (valid gender, invalid value, forced decrypt failure) and on derivation (male, female, corrupt blob, wrong version): no captured call carries the value; `JSON.stringify(failure)` holds none of the four values and not the blob; exact assertions, not a word grep ("other" is a common word); `api-contract.test.ts` keeps the registry sorted.

## 5. UNPINNED defaults: every value is a default applied, pending owner sign-off, repeated in the PR body

One row per `[UNPINNED]` mark of section 4 (a value marked twice is one row citing both marks), plus the lane-block route mark, RD-14's en strings and R-C1-c. Each row: value, default, where it lives.

- U-1 the DD-45 retry root (`promotion_retry_id` job) is not built; the audit record is one outbox event `waitlist.charge_derivation_failed` with payload `{session_id, player_id, membership_id, reason}` only (RD-2, 4.5; session-join-service.ts; O-1); default applied, pending owner sign-off.
- U-2 a derived amount that is not an integer, < 0 or > 2147483647 => `{ ok: false, code: "CHARGE_DERIVATION_UNAVAILABLE" }`, zero writes (RD-4, 4.4; charge-derivation.ts); default applied, pending owner sign-off.
- U-3 one failure event per opener attempt, no dedupe (4.5; session-join-service.ts); default applied, pending owner sign-off.
- U-4 R-C1-c: price_male / price_female enter no changed_fields list and no outbox payload, so no per-gender price-change notice is sent; zalo-dm.ts unchanged (R-C1-c, 4.8; session-service.ts; O-2); default applied, pending owner sign-off.
- U-5 `person_gender_update` returning zero rows => ROLLBACK + 404 `NOT_FOUND` (C2 reading 3, 4.2, 4.7; me-settings.ts); default applied, pending owner sign-off.
- U-6 GENDER_FORBIDDEN answers 403 with the 4.10 pair (en "This action is not allowed."), mapped only in the shared session-route map, not in DOMAIN_CODES; the public join catch maps CHARGE_DERIVATION_UNAVAILABLE only (C2 reading 5, 4.10; session-command-route.ts); default applied, pending owner sign-off.
- U-7 the session-form host hint also covers consent, en "Applies to players with no gender set, who have not allowed gender pricing, or who chose Other / Prefer not to say." (C2 reading 6, 4.9; session-form.tsx); default applied, pending owner sign-off.
- U-8 persons names `gender_key_version`, `gender_pricing_consent` (NOT NULL DEFAULT false) and `persons_gender_enc_version_chk`; `gender_enc` is lane-pinned (4.1; 0062, schema.ts, db.dbml); default applied, pending owner sign-off.
- U-9 sessions constraint names `sessions_price_male_chk` and `sessions_price_female_chk`; the CHECK form is pinned by tech doc `:76` (4.1; 0062, schema.ts, db.dbml); default applied, pending owner sign-off.
- U-10 definer names `person_gender_read`, `person_gender_update`, `charge_gender_for_derivation` and the context literals `self_join`, `host_add`, `promotion` (4.2; 0062); default applied, pending owner sign-off.
- U-11 TS names `encryptPersonGender` and `openPersonGender` (4.3; gender-crypto.ts); default applied, pending owner sign-off.
- U-12 the internal Error literal "gender ciphertext could not be opened" (4.3; gender-crypto.ts); default applied, pending owner sign-off.
- U-13 INVALID_GENDER 400 with en "Invalid gender value." (vi verbatim from tech doc `:163`) (4.7; apps/web/app/api/me/profile/route.ts); default applied, pending owner sign-off.
- U-14 `{ gender: null, genderConsent: true }` => 400 `INVALID_BODY` (4.7; profile route.ts); default applied, pending owner sign-off.
- U-15 the DD-54 flag `GENDER_COLLECTION_ENABLED`: only "true" enables, `.env.example` carries `GENDER_COLLECTION_ENABLED=false`, OFF behaviour per RD-8 (4.7; profile route.ts, .env.example; O-3); default applied, pending owner sign-off.
- U-16 the settings API extends GET / PATCH `/api/me/profile`; no `PUT /api/me/settings` (lane-block mark, RD-7, 4.7; profile route.ts); default applied, pending owner sign-off.
- U-17 per-gender prices ride POST `/api/sessions` and PUT `/api/sessions/[id]`; no `PATCH /api/sessions/:id/pricing` (RD-10, 4.8; session-command-route.ts); default applied, pending owner sign-off.
- U-18 the value-list name `GENDER_VALUES` in packages/core/src/api-contract.ts (4.9); default applied, pending owner sign-off.
- U-19 the en labels of the 4.9 settings table: "Male", "Female", "Other", "Prefer not to say", "Not set", "Gender", "Allow clubs to use my gender for pricing", "Gender not shared", "Remove my saved gender" and the prompt (4.9; settings-profile-form.tsx, settings-view.tsx); default applied, pending owner sign-off.
- U-20 the prompt shows only on /me/settings (`role="status"` above the Profile card), only when the flag is ON and gender is null; never on the join result or me-charges (4.9; settings-view.tsx); default applied, pending owner sign-off.
- U-21 CHARGE_DERIVATION_UNAVAILABLE answers 503 (LINK_UNAVAILABLE precedent) (4.10; session-command-route.ts, the public join route); default applied, pending owner sign-off.
- U-22 the CHARGE_DERIVATION_UNAVAILABLE pair, en "The price could not be worked out. Nothing was saved; please try again later.", vi as in 4.10 (4.10; the same two files); default applied, pending owner sign-off.
- U-23 RD-14, every other en half of the 4.9 session-form pairs: "Pricing", "One price for everyone", "Price by gender", "Default price (VND)", "Price for men (VND)", "Price for women (VND)", "Enter at least one price by gender, or choose One price.", "(including prices by gender)" (4.9; session-form.tsx, session-form-model.ts); default applied, pending owner sign-off.

## 6. Tests and acceptance matrix

- Roles: DB tests run on the existing harness (`packages/db/src/test-harness.ts`) as the real roles: `app` through withTenant (`app.tenant_id` set) for the services and the three definers, `readonly` for the view, `job_definer` for the projector; the owner only seeds rows and runs catalog probes; no runtime path is exercised as the owner. Web tests `vi.mock` @plexco/db (role: none).
- Files: GP = NEW packages/db/src/gender-pricing-definers.test.ts; GC = NEW packages/db/src/gender-crypto.test.ts; CD = NEW packages/db/src/charge-derivation.test.ts; RS / JR / SJ / SS / SR / MS = packages/db/src/{roster-service, join-request-service, session-join-service, session-service, session-read, me-settings}.test.ts; PR = apps/web/app/api/me/profile/route.test.ts; MC / SCR / SEU / SFM / LOG = apps/web/lib/{me-settings-client, session-command-route, session-error-ui, session-form-model, log}.test.ts; SET = apps/web/components/me/settings-forms.test.tsx; SF = apps/web/components/sessions/session-form.test.tsx; E2E = apps/web/e2e/settings.spec.ts; all exist at the base except the three NEW.
- Shorthand: DT-1..DT-11 = the lane DECISION TABLE rows in order; "decrypt failure" = {corrupt ciphertext, wrong key version, blob copied from another person}; "no charge" = zero new charges rows, no newly active player, no venue.

| T | Covers | File | Role(s) | Asserts |
|---|---|---|---|---|
| T-1 | DT-1 single price | CD | app | both per-gender prices NULL => price_amount; a tx query spy sees no definer call |
| T-2 | DT-2 NULL gender + prompt | CD, SET | app; none | never-set gender => price_amount; the prompt renders only with genderCollection true and gender null, never with the flag OFF |
| T-3 | DT-3 host-add | RS, SEU | app; none | each decrypt failure => 503 CHARGE_DERIVATION_UNAVAILABLE, no charge, no recordCommand; the host sees the 4.10 message (DOMAIN_CODES), a 503 is not definite |
| T-4 | DT-3 self-join | SJ | app | each decrypt failure => CHARGE_DERIVATION_UNAVAILABLE, no charge, the 0058 guest membership minted in the tx rolled back |
| T-5 | DT-3 approve | JR | app | each decrypt failure => CHARGE_DERIVATION_UNAVAILABLE, no charge, the join request still pending, a new guest membership rolled back |
| T-6 | DT-3 promotion (RD-1) | SJ, RS, SS | app | each decrypt failure via leaveSession, one corrupt-blob case per other opener (removePlayerFromSession, updateSession slots_max, deleteGuestNote): candidate waitlisted at the same position, no charge, no DM; exactly one waitlist.charge_derivation_failed with exactly the four payload keys; the next FIFO candidate active with its own derived charge and one player.promoted; the seat-freeing write committed |
| T-7 | DT-4 per-gender | CD; RS, SJ, JR | app | male + price_male => price_male; female + price_female => price_female; missing side, other, undisclosed => price_amount; one charges.amount_due case per path (host-add, join, approve, promotion) |
| T-8 | DT-5 consent OFF | GP, CD | app | the definer returns (person_id, NULL, NULL) while the ciphertext stays stored; charge = price_amount; openPersonGender not called |
| T-9 | DT-6 INVALID_GENDER | PR | none | "", "Nam", "MALE", 1 and {} => 400 INVALID_GENDER with the 4.7 pair; the body never contains the input |
| T-10 | DT-7 owner-only plaintext | PR, MS, CD | app; none | only the self-read returns gender; console spies (error, warn, log, info) on the route and on derivation (male, female, corrupt blob, wrong version) capture no value; JSON.stringify(failure) holds no value and no blob |
| T-11 | DT-8 GENDER_FORBIDDEN, no oracle | GP, SCR | app; none | app gets 42501 on every persons gender column; a refused derivation raises the identical SQLSTATE and message for NULL and set gender_enc; SCR maps it to 403 with the fixed pair |
| T-12 | DT-9 context refusal | GP | app | unknown context, tenant GUC mismatch, foreign or non-active membership, self_join by another actor, host_add without session.manage or from another tenant, promotion of a non-waitlisted player => GENDER_FORBIDDEN, no row returned, zero writes (players, charges, outbox_events counts unchanged) |
| T-13 | DT-10 price guard | SS | app | with any charges row (void included): a price_male-only change, a price_female-only change and a mode switch => PRICE_CHANGE_REQUIRES_POLICY, row version unchanged; without charges each succeeds |
| T-14 | DT-11 int4 / negative | CD, SS, GP | app | out-of-range or non-integer inputs => CHARGE_DERIVATION_UNAVAILABLE, zero writes; create / update with -1, 1.5, 2147483648, "100" => 400 INVALID_BODY; a negative price fails its CHECK |
| T-15 | person-bound blob | GC | none | a blob sealed for person A fails to open as person B (GCM auth) => { ok: false } |
| T-16 | crypto envelope | GC | none | round trip per value; a wrong key version fails before open; NULL version with a blob, a blob < 29 bytes, a flipped tag byte and a decrypted value outside the four => { ok: false } |
| T-17 | connector byte-identical | packages/db/src/connector-crypto.test.ts, apps/web/lib/connector-secrets.test.ts, the apps/bot connector tests (the step-2 writer greps them) | as today | unchanged files (empty diff) and green |
| T-18 | settings API rows | PR, MS, MC | app; none | the flag OFF and ON rows of 4.7; strict keys; commandId required; a mixed body atomic; relink race => 404; self-read decrypt failure => 500, never gender null |
| T-19 | whitelist + fences | GP; packages/db/src/public-sessions-projector.test.ts, packages/db/src/rls-invariants.test.ts | owner (catalog); readonly; job_definer | the 4.1 has_column_privilege matrix all false; three named CHECKs; definer EXECUTE held by app only; the 22 / 17 sets unchanged and green |
| T-20 | discovery DTO + public join result | the three apps/web/app/api/discover route tests, packages/db/src/public-discovery-read.test.ts, the public join route test | readonly; none | none of the twelve exact 4.6 keys in any JSON; JoinSessionResultDto unchanged |
| T-21 | payloads + promotion DM | SJ; apps/bot/src/projectors/zalo-dm.test.ts unchanged | app; as today | player.added, player.promoted, session.updated and the new event carry no gender key and no per-gender price; the DM fee = payload.amount_due read back from the charge row (a male promoted at price_male); L8 DM-1..DM-9 green unchanged |
| T-22 | realtime frame (R-C1-b) | packages/db/src/realtime-event-read.test.ts | as today | the new type reaches session.manage holders only as {type, sessionId, version} |
| T-23 | log redaction (R-C1-e) | LOG | none | keys gender, genderConsent and gender_enc are redacted |
| T-24 | UI strings + labels | SET, SF, SFM, E2E | none; e2e | options = GENDER_VALUES with the 4.9 t(vi, en) labels, both halves asserted; hidden when OFF; remove button when OFF with stored data; the toggle shows two inputs; the 4.9 model rows; one ON-mode set / clear e2e run |
| T-25 | gender change after a charge | CD, SJ | app | the old amount_due unchanged; the next new charge uses the new gender (tech edge #7, RD-9) |
| T-26 | session prices, read, routes | SS, SR, SCR | app; none | create with both / one / no per-gender price; update clears a side; the host read carries both; STATUS_BY_CODE 503 / 403 rows; api-contract.test.ts keeps the registry sorted |
| AC-1 | S1 VERIFY set | all | as above | typecheck, lint, format:check, review:check:changed, build, web test, `-w test`, Playwright e2e: pass (known flakes rerun once) |
| AC-2 | `NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test` | packages/db | real roles | pass |
| AC-3 | `pnpm --filter @plexco/web test` | apps/web | none | pass |
| AC-4 | one migration at a time | 0062 | owner | exactly one new migration file, applied once (schema_migrations 62 -> 63); no other DB suite, migration or e2e run at the same time |

- Decision table: DT-1 => T-1; DT-2 => T-2; DT-3 => T-3..T-6; DT-4 => T-7; DT-5 => T-8; DT-6 => T-9; DT-7 => T-10, T-20, T-21; DT-8 => T-11; DT-9 => T-12; DT-10 => T-13; DT-11 => T-14.
- Lane TESTS: decrypt-failure no-charge => T-3..T-6; NULL fallback + prompt => T-2; consent OFF => T-8; one case per row => T-1..T-14; whitelist => T-19..T-21; person-bound => T-15; t(vi, en) + DD-39 labels => T-24.

## 7. Implementation steps (dependency order, test-first)

Every step is one fresh writer (opus/max, about 40 tool calls, starting at about 98k context) in W on feat/p3-m9-gender-pricing; it commits once and never pushes. Before editing a symbol it runs the grep-callers fallback for the stale GitNexus index (RD-13) and records the blast radius for the PR body. A file name the contract did not measure is measured read-only by that step's writer (R-C1-d); a file outside section 8 needs a new ruling (RD-12). Every DB run holds the S1 ENVIRONMENT lock.

1. Migration and definers. Files: NEW packages/db/migrations/0062_gender_pricing.sql (the 4.1 columns and CHECKs, the three 4.2 definers, the conditional GRANT), packages/db/schema.ts, packages/db/db.dbml. Re-measure first, read-only: the owner of the 0055 definers and whether it already executes `tenant_capability_authorize`. Tests first: GP (T-8 definer part, T-11, T-12, T-14 CHECK, T-19 catalog) as the real roles. Done when: the `pnpm db:bootstrap` precondition holds, 0062 is applied once (63 rows), GP is green, rls-invariants and public-sessions-projector are green unchanged, typecheck passes.
2. Crypto and codes. Files: packages/db/src/connector-crypto.ts (`sealAesGcm` / `openAesGcm`, connector output byte-identical), NEW packages/db/src/gender-crypto.ts, packages/core/src/api-contract.ts (the three codes in sorted position, `GENDER_VALUES`). Tests first: GC (T-15, T-16), api-contract.test.ts; list the apps/bot connector tests by grep `encryptConnectorSecret|openConnectorSecret` (T-17). Done when: GC, api-contract and every T-17 suite are green and the T-17 files have an empty diff.
3. deriveChargeAmount. Files: NEW packages/db/src/charge-derivation.ts, packages/db/src/roster-money-shared.ts (two RosterMoneyErrorCode values). Tests first: CD (T-1, T-2 DB part, T-7 unit rows, T-8, T-10 derivation spies, T-14 unit rows). Done when: CD is green and the module imports no session-service (P-19).
4. Call site 1, seatPlayer. Files: packages/db/src/roster-service.ts (seatPlayer, the `:161` reader, the host-add context), packages/db/src/join-request-service.ts (approve = host_add + the approver), packages/db/src/session-join-service.ts (lockSession prices, join = self_join). Tests first: RS (T-3 DB part), SJ (T-4), JR (T-5), the T-7 path cases, T-25. Done when: RS, SJ, JR and CD are green, every existing case included.
5. Call site 2, promotion. Files: packages/db/src/session-join-service.ts (promoteFromWaitlist after the P-8 skip, the 4.5 continue-next, the event through emitSessionEvent). Tests first: T-6 (SJ leaveSession matrix; RS removePlayerFromSession; SS updateSession slots_max and deleteGuestNote) and the T-21 fee read-back in SJ. Done when: SJ, RS and SS are green and apps/bot/src/projectors/zalo-dm.test.ts (L8 DM-1..DM-9) is green unchanged.
6. Session prices and the guard. Files: packages/db/src/session-service.ts (4.8 payloads, validation, guard, insert), packages/db/src/session-read.ts (host read). Tests first: SS (T-13, T-14 create / update), SR (T-26 host read). Done when: SS and SR are green and changed_fields is unchanged (R-C1-c).
7. Settings API. Files: packages/db/src/me-settings.ts, apps/web/app/api/me/profile/route.ts, apps/web/lib/me-settings-client.ts, .env.example (one line). Tests first: MS, PR, MC (T-9, T-10 route spies, T-18). Done when: MS, PR and MC are green and tenant-lang keeps `"b"` for me/profile.
8. Session routes and error UI. Files: apps/web/lib/session-command-route.ts (field keys, STATUS_BY_CODE, the two pairs), apps/web/lib/sessions-api.ts, apps/web/lib/session-error-ui.ts (DOMAIN_CODES), `apps/web/app/api/public-listings/[publicListingId]/join/route.ts` (its catch only). Tests first: SCR (T-11 mapping, T-26 rows), SEU (T-3 UI part), the public join route test (the 503 pair). Done when: those suites are green.
9. UI. Files: apps/web/components/me/settings-profile-form.tsx, apps/web/components/me/settings-view.tsx, apps/web/lib/session-form-model.ts, apps/web/components/sessions/session-form.tsx. Tests first: SET, SFM, SF, then E2E (T-2 UI part, T-24) with the flag ON only in the Playwright webServer env. Done when: the web tests and the settings e2e are green and every string is t(vi, en).
10. Evidence and full verification. Files: apps/web/lib/log.ts (R-C1-e). Tests first: LOG (T-23), then the evidence tests T-19..T-22 (the discover route tests, public-discovery-read, the public join route test, realtime-event-read). Then the S1 VERIFY set and AC-1..AC-4 through `tail -40`, the grep-callers blast radius (RD-13), `git diff --numstat` against the section 8 caps, and the PR body with the section 5 rows and "Codex waived by owner 2026-10-12; reviewed by independent Claude subagent". Done when: every check passes and every cap holds.

## 8. B3 exception

- Modules: packages/db, packages/core, apps/web (3, the default) plus one root `.env.example` line; migrations: exactly one, `0062_gender_pricing.sql`. Production files (26): in packages/db the NEW 0062, schema.ts, db.dbml, connector-crypto.ts, NEW gender-crypto.ts, NEW charge-derivation.ts, roster-money-shared.ts, roster-service.ts, join-request-service.ts, session-join-service.ts, session-service.ts, session-read.ts, me-settings.ts; in packages/core api-contract.ts; in apps/web the profile route, the public join route, me-settings-client.ts, session-command-route.ts, sessions-api.ts, session-error-ui.ts, session-form-model.ts, log.ts, settings-profile-form.tsx, settings-view.tsx, session-form.tsx; .env.example. Test files (25, 3 NEW): the section 6 files; every apps/bot file stays unchanged.
- Why a split breaks coherence: the derivation helper, its definer and the three call paths must land together, or a path charges the base price in a gendered session (a money defect); the settings API without the definers has nothing to write, and the UI without the API is dead code.
- Compatibility proof: additive nullable columns (consent NOT NULL DEFAULT false); both per-gender prices NULL = today's single price, so every existing session charges price_amount through the single-price branch with no definer call (T-1); existing callers unchanged except as ruled (seatPlayer and promoteFromWaitlist derive, the price guard widens, the profile route accepts two optional keys); the connector envelope is byte-identical (T-17); no runtime-role grant on a new column, no route row, no view change.
- Estimate per step (production LOC / test LOC / files): 1 = 220 / 280 / 4; 2 = 140 / 170 / 5; 3 = 95 / 190 / 3; 4 = 60 / 280 / 6; 5 = 45 / 230 / 4; 6 = 65 / 140 / 4; 7 = 140 / 290 / 7; 8 = 30 / 90 / 7; 9 = 190 / 250 / 8; 10 = 2 / 85 / 7. Totals: production 987, test 2005, total 2992, distinct files 51.
- BINDING caps (estimate + about 15 percent; added + deleted lines of `git diff --numstat de732028f3163541928ae7eeac71beebf16e5a18..HEAD`, this readiness file excluded; test = `*.test.ts`, `*.test.tsx`, `*.spec.ts`): production LOC <= 1135, total LOC <= 3440, files touched <= 59, migrations = 1. A breach stops the step and is reported, never trimmed silently.

## 9. OPEN (all OUT_OF_SCOPE for this lane; none blocks it)

- O-1 the DD-45 retry root (`promotion_retry_id` job, CAS / lease, 3 attempts, DLQ, owner digest, the "exactly one event" dedupe; RD-2, U-1, U-3): a later waitlist lane; until then the next opener re-running the selector from the head is the only retry.
- O-2 the per-gender price-change notice (R-C1-c, U-4): price_male / price_female stay out of changed_fields and every payload, zalo-dm.ts unchanged; a notification lane owns it.
- O-3 no DD-54 platform config store exists at the base: the env flag `GENDER_COLLECTION_ENABLED` (U-15) stands in, committed false; the store, and turning collection on for real use, belong to the owner and a config lane.
- O-4 the DD-49 adjustment flow for a price change on a session with charges (`decisions.md:693`): PRICE_CHANGE_REQUIRES_POLICY stays the guard here; the signed adjustment / grandfather path is a later money lane.
- O-5 no apps/bot charge path exists at the base (DD-135 Zalo /join for linked accounts): the lane that adds one derives through deriveChargeAmount (`self_join`) and needs its own grant ruling, since the derivation definer EXECUTE goes to app only (R-C1-d).
- O-6 dob_enc and username of tech doc `:66-80` (lane NEGATIVE SCOPE): a later settings lane.
- O-7 stale prose: tech doc `PUT /api/me/settings` `:153-154` and `PATCH /api/sessions/:id/pricing` `:156` (RD-7, RD-10) and the lane block's `manage_roster` wording (R-C1-a); a docs reconcile lane, since this lane edits neither decisions.md nor a Reviewed spec.
- O-8 the GitNexus index is stale at dd5375f (RD-13): re-index is an orchestrator step; until then the grep-callers fallback binds.
- O-9 L17 consolidates U-1..U-23 into ONE decisions.md entry; this lane only repeats them in its PR body (RD-14).
- Closed: manage_roster SUPERSEDED by `session.manage` (R-C1-a); "FIFO head" NARROWED (RD-1, RD-3); the realtime reach of the new event (R-C1-b); log redaction (R-C1-e).

## 10. Closure matrix (12/12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = lane worktree HEAD = session base de732028f3163541928ae7eeac71beebf16e5a18; every TARGET_FILES path measured to exist at the base (`git ls-files --error-unmatch` in the lane worktree); new files are section 8 scope, never TARGET_FILES | PASS |
| 2 | Decisions in scope final | DD-39 + addendum 2026-07-16 signed (`decisions.md:547-559`); DD-54, DD-45, DD-49 and DD-135 bound (section 1); rulings RD-1..RD-15 and R-C1-a..R-C1-e applied; U-1..U-23 pinned as defaults pending owner sign-off (section 5) | PASS |
| 3 | Scope IN/OUT and owner clear | lane FILES IN SCOPE plus the RD-12 additions under the section 8 caps; lane NEGATIVE SCOPE in OUT_OF_SCOPE; one writer per step in the lane worktree | PASS |
| 4 | Dependencies classified | L8 #68 merged at the base (self-join, approve, promotion); P3-S8 #74 merged; L4's connector crypto module present (`connector-crypto.ts`); no owner wait (section 1) | PASS |
| 5 | Live schema and code match | every lane-block citation re-measured at the base (section 2); measured facts with path:line (section 3); next free migration 0062 | PASS |
| 6 | Data, API, state, auth contract | columns and definers (4.1-4.2), crypto (4.3), derivation and call sites (4.4), failure per path (4.5), whitelist (4.6), settings API and flag (4.7), prices and guard (4.8), UI (4.9), codes and logging (4.10) | PASS |
| 7 | Fail-closed, idempotency, order | decrypt or key-version failure -> CHARGE_DERIVATION_UNAVAILABLE, no fallback price, zero writes on host-add, join and approve; promotion keeps the candidate and continues next (RD-1); authorization before any gender read, one refusal for NULL and set (RD-3); derivation before the first write; upsertCharge the only amount_due writer; a 503 retry reuses the commandId after zero writes | PASS |
| 8 | Open questions in scope = 0 | section 5 pins (value + "default applied, pending owner sign-off"); section 9 OPEN items are out of scope | PASS |
| 9 | Acceptance matrix with expected results | section 6: T-1..T-26 cover DT-1..DT-11 and every lane TESTS item; AC-1..AC-4, one per lane ACCEPTANCE COMMAND; steps test-first (section 7) | PASS |
| 10 | Migration, security, rollback | one additive migration 0062; no runtime-role grant on a new column, no route row, no view change; definers SECURITY DEFINER with a fixed search_path, EXECUTE to app only; gender encrypted under a distinct HKDF label with person-bound AAD, plaintext only on the owner's self-read; HARD RULES 1-5 held; threat model stated and bounded (section 0); rollback = code revert, the append-only 0062 columns stay NULL and unused | PASS |
| 11 | First slice hard dependencies merged | L8 merged at de732028f3163541928ae7eeac71beebf16e5a18 (#68); step 1 depends on nothing unmerged | PASS |
| 12 | Implementation handoff ready | sections 4-9; B3 binding caps (section 8); lane worktree clean at the base | PASS |

## 11. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-18
AUTHORITY_SHA: de732028f3163541928ae7eeac71beebf16e5a18
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/standards/review-code-readiness-gate.md
  - docs/features/FE/feature_user_settings.md
  - docs/features/BE/feature_user_settings_tech.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m9-join-core.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m9-discovery-read.md
  - packages/db/migrations/0047_tenant_capability_authority_core.sql
  - packages/db/migrations/0049_tenant_capability_authorize.sql
  - packages/db/migrations/0055_me_settings_definers.sql
  - packages/db/migrations/0058_player_self_join.sql
  - packages/db/migrations/0061_public_sessions_projector_writer.sql
  - packages/db/schema.ts
  - packages/db/db.dbml
  - packages/db/package.json
  - packages/db/src/connector-crypto.ts
  - packages/db/src/secret-key-root.ts
  - packages/db/src/roster-money-shared.ts
  - packages/db/src/roster-service.ts
  - packages/db/src/join-request-service.ts
  - packages/db/src/session-join-service.ts
  - packages/db/src/session-service.ts
  - packages/db/src/session-read.ts
  - packages/db/src/session-occupancy.ts
  - packages/db/src/me-settings.ts
  - packages/db/src/authorization.ts
  - packages/db/src/tenant.ts
  - packages/db/src/realtime-event-read.ts
  - packages/db/src/test-harness.ts
  - packages/db/src/public-sessions-projector.test.ts
  - packages/db/src/rls-invariants.test.ts
  - packages/db/src/session-join-service.test.ts
  - packages/core/src/api-contract.ts
  - packages/core/src/api-contract.test.ts
  - apps/web/app/api/me/profile/route.ts
  - apps/web/app/api/me/profile/route.test.ts
  - apps/web/app/api/public-listings/[publicListingId]/join/route.ts
  - apps/web/lib/me-settings-client.ts
  - apps/web/lib/session-command-route.ts
  - apps/web/lib/session-error-ui.ts
  - apps/web/lib/sessions-api.ts
  - apps/web/lib/session-form-model.ts
  - apps/web/lib/log.ts
  - apps/web/lib/request-policy.ts
  - apps/web/lib/money.ts
  - apps/web/components/me/settings-profile-form.tsx
  - apps/web/components/me/settings-view.tsx
  - apps/web/components/sessions/session-form.tsx
  - apps/bot/src/projectors/zalo-dm.ts
  - .env.example
SLICE: p3-m9-gender-pricing
IN_SCOPE: DD-39 gender pricing in one additive migration: NEW packages/db/migrations/0062_gender_pricing.sql (the 4.1 columns and the three definers of 4.2) with packages/db/schema.ts and packages/db/db.dbml; NEW packages/db/src/gender-crypto.ts over the packages/db/src/connector-crypto.ts envelope; NEW packages/db/src/charge-derivation.ts (deriveChargeAmount) called at seatPlayer and promoteFromWaitlist; the two prices and the PRICE_CHANGE_REQUIRES_POLICY guard in packages/db/src/session-service.ts; packages/db/src/session-read.ts; packages/db/src/me-settings.ts with GET / PATCH /api/me/profile and the GENDER_COLLECTION_ENABLED flag; the new codes and GENDER_VALUES in packages/core/src/api-contract.ts; the error map in apps/web/lib/session-command-route.ts, apps/web/lib/sessions-api.ts, apps/web/lib/session-error-ui.ts and the public join route catch; the settings and session-form UI with t(vi, en) pairs; the apps/web/lib/log.ts redaction token; the section 6 tests; all under the section 8 B3 caps
OUT_OF_SCOPE: a second migration (else HALT); host-set gender; raw gender anywhere but the owner's self-read (no host, DTO, log, error or public surface); dob_enc and username; any projector, view, route-row or runtime-role grant change; a second price table or a price-mode column; the DD-45 retry root (O-1); the per-gender price-change notice (O-2); apps/bot/src/projectors/zalo-dm.ts and every apps/bot file; turning GENDER_COLLECTION_ENABLED on (owner, DD-54) or enabling the dispatch cycle (owner P0) for real use; edits to docs/standards/decisions.md or Reviewed specs; the section 9 OPEN items
G1_DECISION: PASS # DD-39 + addendum 2026-07-16 signed (decisions.md:547-559); DD-54, DD-45, DD-49 and DD-135 bound; RD-1..RD-15 and R-C1-a..R-C1-e applied; U-1..U-23 pinned as defaults pending owner sign-off
G2_SPEC: PASS # user settings FE spec and BE tech doc measured at the base (sections 2-3); columns, definers, crypto, derivation, failure paths, whitelist, settings API, prices and guard, UI and codes pinned (section 4)
G3_DEPENDENCY: PASS # L8 #68 merged at the base (self-join, approve, promotion); P3-S8 #74 merged; L4's connector crypto module present (connector-crypto.ts); no owner wait
G4_TEST: PASS # T-1..T-26 cover DT-1..DT-11 and every lane TESTS item; AC-1..AC-4, one per lane ACCEPTANCE COMMAND; steps test-first (sections 6-7)
G5_SCOPE: PASS # one migration (0062); lane FILES IN SCOPE plus the RD-12 additions; B3 exception with binding caps in section 8 (production LOC <= 1135, total LOC <= 3440, files touched <= 59, migrations = 1, 3 modules, no apps/bot change); NEGATIVE SCOPE held
G6_EXTERNAL: PASS # local only: no external provider, no new secret (local ENCRYPTION_KEY), GENDER_COLLECTION_ENABLED committed false; real-use enablement is the owner's
HARD_DEPENDENCIES: L8 p3-m9-join-core #68 merged at de732028f3163541928ae7eeac71beebf16e5a18 (probe 0058_player_self_join.sql + promoteFromWaitlist); DD-39 + addendum 2026-07-16 signed
PRIOR_SLICES: L8 p3-m9-join-core (#68); L10b p3-m9-discovery-read (#74); L4 connector crypto (packages/db/src/connector-crypto.ts)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # one additive migration 0062; definers SECURITY DEFINER with a fixed search_path, EXECUTE to app only; authorization before any gender read, one GENDER_FORBIDDEN for NULL and set; distinct HKDF label + person-bound AAD + key-version check; fail-closed CHARGE_DERIVATION_UNAVAILABLE, no fallback price; plaintext only on the owner's self-read; 22 / 17 unchanged; opus/max reviewer + opus/max security round
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: section 7 step 1, in .autopilot/worktrees/p3-m9-gender-pricing at de732028f3163541928ae7eeac71beebf16e5a18 (steps in dependency order, test-first)
REMAINING_BLOCKERS: none
```
