<!-- review-readiness: code-ready -->

# Step-0 readiness: p3-m6-zalo-outbound (Phase 3 lane L4)

> Agent-facing (English). Session P3-S3 step 0, written by the readiness reviewer (Opus 5.5 / max), not the writer.
> Authority: lane block L4 of the Phase 3 RUN doc (as relayed in the P3-S3 brief); DD-134 (D2) signed by the owner
> 2026-10-16 incl. the (c) override (`docs/standards/decisions.md:123`, `:1812-1833`); L3's pinned contract D-1..D-24
> (`docs/sessions/web-mvp-phase3-readiness-p3-m6-outbox-delivery-core.md`, they stand unchanged); the DD-122 D4 review policy.
> Base: `origin/main` `442aa1bf61234a7b4330295dfd36211446988a8a` (#64 L3 merged as `98a4a6c`, then #63).
> Every item Z-1..Z-23 in section 3 is "default applied, pending owner sign-off": the PR body repeats them and L17
> consolidates them into one decisions entry. This file does not edit `docs/standards/decisions.md`.

## 1. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-16
AUTHORITY_SHA: 442aa1bf61234a7b4330295dfd36211446988a8a
BASE_BRANCH: main
TARGET_FILES:
  - apps/web/lib/connector-secrets.ts
  - apps/web/lib/auth-secrets.ts
  - apps/web/lib/oauth-transaction.ts
  - apps/web/lib/zalo/client.ts
  - apps/web/lib/read-bounded-body.ts
  - apps/bot/src/projectors/zalo-dm.ts
  - apps/bot/package.json
  - packages/db/package.json
  - packages/db/src/zalo-ingress.ts
  - packages/db/schema.ts
  - packages/db/db.dbml
  - packages/db/src/migrate.test.ts
  - packages/db/src/rls-invariants.test.ts
  - pnpm-lock.yaml
SLICE: p3-m6-zalo-outbound
IN_SCOPE: the zalo_dm projector delivering exactly the DD-134 (c) matrix through the Zalo Bot API (session.updated with a time, venue or price field and session.cancelled to linked ACTIVE roster players; session.announcement_requested to the requesting host), retry/terminal classification, per-recipient dispositions, the connector envelope and the Zalo client moved into packages/db subpath exports with web re-export shims, one migration NEW 0057_zalo_delivery_targets_definer.sql (one narrow table, two job_definer definers, three zalo_dm route rows, column-narrow job_definer grants), a recorded-contract Zalo stub for tests; files = TARGET_FILES + the NEW list in 3.9
OUT_OF_SCOPE: any live delivery or live claim; enabling the schedule or any projector in a committed default; a real Zalo token anywhere; group send (OD-2); Messenger; reminders; player commands (L13); the announce route, UI and packages/db/src/session-service.ts (L4b); the player.promoted route, emitter, template and fee-owed source (L8); editing 0056 or any migration except NEW 0057; packages/db/src/index.ts, apps/bot/src/projectors/index.ts, dispatcher.ts, worker.ts, preflight.ts, both test-harness.ts and apps/bot/src/test-db.ts; infra/docker-compose.yml, .env.example and the runbook; any base-table privilege for app, app_worker or readonly; any public_sessions write
G1_DECISION: PASS # DD-134 (a)-(f) + (c) override signed 2026-10-16 (decisions.md:1812-1833); L3 D-1..D-24 stand; DD-122 D4
G2_SPEC: PASS # feature_sync_engine_tech.md :39, :219, :226, edge 21 (:286); feature_session_management_tech.md Events :644-646; lane block decision table; section 3 contract
G3_DEPENDENCY: PASS # L3 merged as #64 (98a4a6c, ancestor of the base): 0056, projector-registry.ts, the zalo-dm.ts placeholder exist at 442aa1b (section 2)
G4_TEST: PASS # acceptance A1-A32 pinned before code (section 5)
G5_SCOPE: PASS # exact files, 4 modules, 1 migration, explicit B3 exception with caps (section 4), scope additions Z-21
G6_EXTERNAL: ENABLEMENT_ONLY:real-zalo-bot-token-owner-P0,worker-connector-env-owner-P0,schedule-flag-owner-P0,zalo-dm-projector-enable-owner-P0,live-zalo-status-code-verify # no provider call outside tests, dark by default
HARD_DEPENDENCIES: L3 p3-m6-outbox-delivery-core merged as #64 (merge 98a4a6c920acbe2647f6e1ef710a21e535be6c8d, ancestor of the base); DD-134 signed
PRIOR_SLICES: L3 p3-m6-outbox-delivery-core (#64)
OPEN_QUESTIONS_IN_SCOPE: 0 # every gap pinned as Z-1..Z-23
ENABLEMENT_ONLY_GATES: connect a real bot token (owner P0); give the worker process the Z-4 variables (owner P0); OUTBOX_DISPATCH_SCHEDULE_ENABLED=true for real use and then outbox_projector_set_enabled('zalo_dm', true) in the runbook order (owner P0); live verification of the Zalo HTTP status and error_code values behind Z-6 (client.ts:10 AWAIT-verify)
LIVE_REPO_VERIFICATION: PASS # section 2, corrections C1-C6
CONTRACT_MATRIX: PASS # section 3
CLOSURE_MATRIX: PASS # 12/12, section 7
ACCEPTANCE_MATRIX: PASS # section 5
SECURITY_AND_MIGRATION_GATE: PASS # one append-only migration in the 0056 SET ROLE bracket; no runtime-role base grant; audit before any ciphertext leaves the DB; SSRF base pin; opus/max security round
IMPLEMENTATION_ARTIFACTS: PASS # DD-122 D4: no scope-gate lifecycle; lane block + this file + the worktree at the exact base
FIRST_IMPLEMENTATION_STEP: in .autopilot/worktrees/p3-m6-zalo-outbound (base 442aa1b plus this readiness commit), pin a ciphertext produced by the CURRENT apps/web/lib/connector-secrets.ts (fixed test ENCRYPTION_KEY, known binding) as a constant in NEW packages/db/src/connector-crypto.test.ts, failing first, then create packages/db/src/connector-crypto.ts and the @plexco/db/connector-crypto subpath export (Z-1, Z-2) and make that test and the unchanged web crypto tests pass
REMAINING_BLOCKERS: none
```

## 2. Measured at base (442aa1b)

### 2.1 Snapshot

- Worktree `.autopilot/worktrees/p3-m6-zalo-outbound`, branch `feat/p3-m6-zalo-outbound`, HEAD = base, `git status --porcelain`
  empty, no `index.lock`. Last migration `0056_outbox_projector_registry_dlq_replay.sql`: next free number **0057**.
- `git log --merges` at HEAD: `98a4a6c` #64 (L3), `dcc701c`, `442aa1b` #63. No DB suite or e2e ran at step 0.

### 2.2 Q1: is there a waitlist-promotion outbox event at the base? (conductor note 6)

Commands (run in W) and results:

1. `grep -rn "player\.promoted" packages apps --include='*.ts' --include='*.sql' --include='*.mjs' --exclude-dir=node_modules --exclude-dir=.next`
   -> 4 hits, none an emitter: `packages/db/schema.ts:1559` (route CHECK mirror),
   `packages/db/migrations/0056_outbox_projector_registry_dlq_replay.sql:102` (zalo_dm route CHECK allow-list),
   `packages/db/src/outbox-projector-registry.test.ts:138`, `:175` (registry tests).
2. `grep -rnE "type: ['\"\`][a-z_]+\.[a-z_]+" packages/db/src --include='*.ts' | grep -v '\.test\.ts:' | grep -v fixtures`
   -> `session-service.ts:314` session.created, `:696` session.published, `:959` session.announcement_requested,
   `:1559` session.updated, `:1575` session.visibility_changed, `:1958` session.closed, `:2329`
   session.expiry_anomaly_detected, `:2384` session.cancelled, `:2884` guest_note.created, `:3022` guest_note.deleted.
3. `grep -rn "emitSessionEvent(" packages/db/src --include='*.ts' | grep -v '\.test\.ts:'` (generic emitter
   `roster-money-shared.ts:148`, aggregate_type 'session') -> `payment-reversal.ts:166` payment.reversed,
   `payment-manual.ts:358` payment.settled, `roster-service.ts:212` player.waitlisted | player.added, `roster-service.ts:366` player.removed.
4. `grep -nE "INSERT INTO outbox_events" packages/db/migrations/*.sql` -> only `0056:383` session.expiry_anomaly_detected
   and `0056:402` session.cancelled (stale-draft expiry). 0056 seeds one route row only (`0056:107-108`, web_realtime wildcard).
5. `grep -rn "promot" packages/db/src --include='*.ts' | grep -v '\.test\.ts:'` -> comments only:
   `roster-service.ts:31` "NOT built here (deliberately): waitlist auto-promotion", `session-service.ts:2925-2929`.

Result: **no promotion event exists at the base**, nothing emits `player.promoted`, and no route maps it. Expected case
applies: L4 does NOT wire the promotion DM and does not invent the event (DD-134 override: "the lane that introduces the
promotion event wires it", decisions.md:1833; L3 D-17). L4 makes L8's addition small (Z-11): the BE Events table already
names the payload (`feature_session_management_tech.md:646`: `session_id`, `player_id`, `charge_id`) and 0056's CHECK
requires aggregate_type 'session' for every zalo_dm route (`0056:99-102`), which `emitSessionEvent` already satisfies.

### 2.3 Re-measured cites (the lane block measured at c762c90)

| Lane cite | At 442aa1b |
|---|---|
| `connector-secrets.ts` decryptConnectorSecret :89 | `:89-105`: key_version check `:95-98` (log `connector_key_version_mismatch`) -> `appendSecretDecryptAudit(tx)` `:99-103` -> `open` `:104`. HKDF info `:36` `plexco:connector-zalo-enc:v1`; AAD `:49-50` `plexco:connector-zalo-aad:v1:<tenant>\|<bot>\|<purpose>`; layout iv 12 + tag 16 + ct `:37-38`, `:69-81`; connectorKeyVersion `:28-34`; text codec `:108-109` |
| `auth-secrets.ts` resolveConnectorSecretRoot | `:101-114`; it falls back to resolveAuthSecretKey `:24-50` (ENCRYPTION_KEY base64 `:52-63`, >= 32 bytes `:42-47`, aws-kms `:65-91` via dynamic `@aws-sdk/client-kms` `:79`); caches + `__resetAuthSecretCacheForTest` `:16`, `:93`, `:123-126`; keyedHash `:117-120` stays web |
| `oauth-transaction.ts` deriveAesKey | `:153-155` `hkdfSync("sha256", secret, Buffer.alloc(0), info, 32)`; authKeyVersion `:135-137` (`KMS_KEY_ID` or "local"); the file imports `next/headers` `:2`, so the worker can never import it |
| `zalo/client.ts` sendMessage :91, base :32 | `:91-93`; base `:32` (env `ZALO_BOT_API_BASE`, default `:17`); token in the URL PATH `:42` `/bot<TOKEN>/<method>`; TOKEN_RE `:20`; 5 s timeout `:18`, `:46`; 64 KiB cap `:19`; `redirect: "error"` `:47`; envelope verdict `:71-73`; only import `../read-bounded-body` `:15` (pure, 39 lines, no imports) |
| `zalo-ingress.ts` appendSecretDecryptAudit :66 | `:66-75` -> `routing_audit_append('zalo.secret_decrypt', NULL, tenant, {botId, purpose})`; readZaloBotTokenEnc `:201-213` |
| `projectors/zalo-dm.ts` placeholder | `:9-12` dlq `projector_not_implemented`; `projectors/index.ts:21-25` maps it (index.ts not edited, `:10-11`) |

### 2.4 Grants, roles and objects at base

- app_worker: **no business-table grant anywhere** (`0009:17`; `grep -nE "GRANT (SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*app_worker"` over
  all migrations -> no hit). It holds EXECUTE on outbox/job definers only (0010, 0022:527-530, 0023, 0033, 0041, 0056:141, :154, :208, :315, :331, :423).
- `zalo_bots` (`0004:48-60`, + `webhook_secret_enc`, `key_version` `0053:73-74`): `tenant_id` UNIQUE (one bot per club),
  `bot_token_enc` text, status CHECK `connecting|registered|active|drift|error|revoked`.
- `channel_identities` (`0001:38-49`, global, no tenant_id): `platform_user_id_enc` bytea (encrypted Zalo user id, purpose
  `channel_user`, `process-event.ts:102-108`), status `active|inactive`; `zalo_bot_id` added `0053:121`.
- `players` (`0002:134-143`): `membership_id`, status `active|left|waitlisted` (`0014:80-81`, unchanged `0044:31`), `joined_at`.
  `memberships` (`0002:23-37`): `person_id`, status `active|guest|left|merged`. `tenants.locale` `0002:17` (default 'vi');
  reader `tenant_locale(uuid)` `0035:47-57`, EXECUTE app only. `sessions` has no title column (`schema.ts:610-632`);
  `venue_name` is "private until join/approve (DD-06)" (`0002:83`).
- `routing_audit_append` (`0053:408-438`): allow-list 'zalo.secret_decrypt', requires `app.tenant_id` = p_tenant_id
  (`:420-425`), EXECUTE **app only** (`:438`) -> **appendSecretDecryptAudit is not callable by app_worker** (C2).
  `routing_audit` columns `0002:200-207`.
- job_definer already holds (0056 Step 1, `:29-35`): SELECT (id, tenant_id, status, starts_at, version) ON sessions,
  SELECT (session_id) ON players, SELECT (session_id) ON charges. 0056 posture `:17-21`; bracket `:67-68`; route rule `:10-15`.
- Projector contract (`dispatcher.ts`): `DeliverFn = (job) => Promise<DeliveryOutcome>` `:46` (no DB handle in the job,
  `:25-34`); outcomes `delivered {providerRef?}` | `retry {errorCode}` | `dlq {errorCode}` `:41-44`; 8 attempts, 15 s x 2^a
  `:12-22`; the dispatcher is the only retry scheduler (D-7); a throw becomes dlq `deliver_threw` `:255-269`; error codes
  normalised to `^[a-z][a-z0-9_]{0,63}$` `:372`, `:408-416`; envelope read `claimedEvent` `:240-244` (zero rows ->
  leaseLostSkips); enabled set read once per cycle `:176`. Lease 5 min (`0022:234`). `provider_ref` free text (`0005:46`).
- Worker pool: `worker.ts:127` `new pg.Pool(DATABASE_URL_DIRECT)`, passed only to runDispatchCycle `:160`. apps/bot has
  **no non-test import of @plexco/db** and lists it under devDependencies (`apps/bot/package.json:18-19`); `@plexco/core` is a
  dependency (`:13`). TS `NodeNext` (`tsconfig.base.json:5-6`): subpath exports resolve.
- Web tests that replace the WHOLE `@plexco/db` module with a `vi.mock` factory: 9 files, incl.
  `apps/web/lib/connector-secrets.test.ts:4` (`{ appendSecretDecryptAudit: audit }` only) and
  `apps/web/app/api/auth/google/state/route.test.ts:8`; the webhook route test intercepts the audit (`route.test.ts:31`). (C1)
- Worker env: compose `worker` (`infra/docker-compose.yml:111-133`) passes only PROCESS_ROLE, NODE_ENV,
  DATABASE_URL_DIRECT and OUTBOX_DISPATCH_SCHEDULE_ENABLED "false" (no env_file, audit X-4). `.env.example`: APP_BASE_URL `:115`,
  KMS_PROVIDER `:134`, KMS_KEY_ID `:135`, ENCRYPTION_KEY `:136`, KMS_ENCRYPTED_CONNECTOR_PEPPER `:149`, ZALO_BOT_API_BASE `:151`.
- Event payloads: session.updated `{session_id, changed_fields}` (snake_case column names, `session-service.ts:1547-1560`);
  session.cancelled `{session_id, roster_count: 0, has_paid: false, cancel_reason}` and only after the "no active roster, no
  money" guard (`:2374-2391`); session.announcement_requested `{session_id, channel}` (`:954-961`, BE spec `:644`).
- Runbook (`docs/runbooks/outbox-dispatch-enable-rollback.md:44-64`): events acked while zalo_dm is disabled never reach it;
  deliveries prepared before a disable wait as pending/failed and may be stale on re-enable.
- Web session page `apps/web/app/c/[tenantId]/sessions/[id]/page.tsx` (the only session route at base).

### 2.5 Corrections to the lane block

- **C1** The shared code ships as `@plexco/db` SUBPATH exports, not through `packages/db/src/index.ts`: a root re-export
  would leave `resolveAuthSecretKey`, `deriveAesKey` and the envelope undefined in the 9 web test files that replace
  `@plexco/db` wholesale. index.ts is therefore not edited (Z-1).
- **C2** `appendSecretDecryptAudit` cannot run as app_worker (2.4); the worker's audit row is written by the 0057 targets
  definer before it returns any ciphertext (Z-18).
- **C3** One migration holds one table and TWO definers (targets read + per-recipient record), not one definer (Z-16..Z-19).
- **C4** Beyond zalo_bots, channel_identities and players, the definers need memberships, persons, sessions (ends_at,
  timezone), routing_audit INSERT, tenant_locale EXECUTE and REFERENCES grants, all to job_definer only (Z-16).
- **C5** session.cancelled reaches the projector with no active roster at base (2.4) and from the draft expiry (0056:402);
  the projector still computes recipients from canonical state, so the row is a recorded no-op in practice.
- **C6** Scope additions the lane block omits (Z-21): read-bounded-body shim, both package.json files, pnpm-lock.yaml,
  schema.ts + db.dbml mirror, migration-count bumps.

## 3. Pinned contract (each Z-n: default applied, pending owner sign-off)

### 3.1 Shared code and crypto (Q3, Q4)

- **Z-1** Location: NEW `packages/db/src/connector-crypto.ts`, `packages/db/src/zalo-bot-api.ts`,
  `packages/db/src/read-bounded-body.ts`, published as `@plexco/db/connector-crypto`, `@plexco/db/zalo-bot-api`,
  `@plexco/db/read-bounded-body` in `packages/db/package.json` "exports" (same shape as `./schema`). Why packages/db:
  the only shared package both apps import that may hold runtime I/O; packages/core is pure domain code. Later lanes
  import from these paths. Split `connector-crypto.ts` into a sibling `secret-key-root.ts` behind the same subpath if it
  passes 200 lines.
- **Z-2** Moved unchanged: `deriveAesKey` (same hkdfSync call), `authKeyVersion`, `connectorKeyVersion`,
  `resolveAuthSecretKey`, `resolveConnectorSecretRoot` (aws-kms branch, both caches, `__resetAuthSecretCacheForTest`),
  `CONNECTOR_ZALO_KEY_INFO` = `plexco:connector-zalo-enc:v1`, AAD `plexco:connector-zalo-aad:v1:<tenant>|<bot>|<purpose>`,
  layout iv(12)|tag(16)|ct with authTagLength 16 both ways, `encryptConnectorSecret`, `blobToText`/`textToBlob`, plus
  `openConnectorSecret(enc, binding)` and `isCurrentConnectorKeyVersion(kv)`. The web keeps keyedHash, the PKCE and email
  labels, and `decryptConnectorSecret(tx, enc, binding, kv)` with today's exact order: version check + log ->
  `appendSecretDecryptAudit(tx)` from root `@plexco/db` -> open. `auth-secrets.ts`, `oauth-transaction.ts`,
  `connector-secrets.ts` re-export the moved symbols, so no other web import changes (2.4 importer list: google state and
  callback routes, dev-login persona, zalo webhook, onboarding connect, webhook-secret-cache, process-event and their tests).
  The moved header says decrypt happens only in a process that calls Zalo (web, worker) and always after its audit row.
- **Z-3** Dependencies: `packages/db/package.json` gains `"@aws-sdk/client-kms": "^3.700.0"` (the range of
  `apps/web/package.json:14`) for the moved aws-kms branch; `apps/bot/package.json` moves `"@plexco/db": "workspace:*"` to
  dependencies; `pnpm-lock.yaml` importer lines only (no new package version).
- **Z-4** Worker key material, no new secret: the projector reads the web's variable names: ENCRYPTION_KEY (local),
  KMS_PROVIDER, KMS_KEY_ID (part of key_version), in aws-kms KMS_ENCRYPTED_AUTH_PEPPER / KMS_ENCRYPTED_CONNECTOR_PEPPER /
  AWS_REGION, plus ZALO_BOT_API_BASE and APP_BASE_URL. Compose stays unedited; giving the worker these values is an owner
  P0 step in the PR body. Missing or short key material -> dlq `bot_unavailable`; missing or non-http(s) APP_BASE_URL ->
  dlq `config_missing`; both before any decrypt or send. Tests set a fixed test key in-process.
- **Z-5** SSRF: the base must parse as an origin-only URL: `https:`, or `http:` only for hostname localhost, 127.0.0.1 or
  [::1]; no userinfo, path "/" only, no query or hash; otherwise `ZaloApiError("invalid_base")` before any fetch (web and
  worker). `redirect: "error"`, the 5 s timeout and the 64 KiB cap stay. Tests use `http://127.0.0.1:<port>`.
- **Z-6** Classification (the recorded contract, client.ts:7-10, pins only ok/rejected/bad_response; these numbers are
  defaults): `ZaloApiError` gains `httpStatus` and `providerErrorCode` (number or null; never description or URL; web kinds
  unchanged) and `sendMessage` takes an optional `{ timeoutMs }` (default 5000). Non-2xx by HTTP status, body not read:
  401 -> bot-level dlq `zalo_unauthorized`; 429 -> retry `zalo_rate_limited`; >= 500 -> retry `zalo_server_error`; other
  4xx -> recipient terminal `zalo_rejected`. 2xx `ok:false`: same mapping on a numeric envelope error_code, absent or
  non-numeric -> `zalo_rejected`. 2xx without a boolean ok, bad JSON or oversize -> recipient terminal `zalo_bad_response`
  (never resent: it may have been delivered). timeout -> retry `zalo_timeout`; network -> retry `zalo_network`;
  invalid_token -> dlq `bot_unavailable`; invalid_base -> dlq `config_missing`.

### 3.2 Projector (Q2, Q6, Q8)

- **Z-7** Codes. dlq: `no_requester`, `bot_unavailable`, `zalo_unauthorized`, `requester_unlinked`, `malformed_payload`,
  `config_missing`, `unexpected_event_type`. retry: `zalo_timeout`, `zalo_network`, `zalo_server_error`,
  `zalo_rate_limited`, `projector_disabled`, `send_budget_exhausted`, `record_failed`, `targets_read_failed`, `claim_lost`.
  delivered providerRef: `sent`, `noop_irrelevant_fields`, `noop_no_recipients`, `noop_stale`, `noop_all_recorded`.
  Recipient terminal: `zalo_rejected`, `zalo_bad_response`, `recipient_undecryptable`. deliver() never throws.
- **Z-8** Partial send: a disposition (sent | terminal) is recorded right after each send; every attempt and every owner
  DLQ replay recomputes the recipients and skips recorded ones; a transient failure stops the attempt at that recipient;
  4xx is terminal for that recipient only and the others continue; a crash or a record failure between a successful send
  and its record can resend exactly that one DM on the next attempt (accepted, documented).
- **Z-9** Recipients (session.updated, session.cancelled): players.status 'active' AND joined_at <= the event's created_at,
  membership in the event tenant with status active|guest, person status 'active', channel identity platform 'zalo',
  status 'active', zalo_bot_id = that tenant's zalo_bots.id; one DM per player (two identities on the bot: newest
  created_at, then lowest id); waitlisted, left, unlinked and other tenants excluded; the tenant always comes from
  outbox_events.tenant_id, never from a parameter (edge 21, exact endpoint).
- **Z-10** session.announcement_requested: recipient = payload `requested_by_person_id` (uuid, supplied by L4b) with an
  active zalo identity on the club bot and an active|guest membership in the event tenant; absent or not a uuid -> dlq
  `no_requester` with no DB call; unlinked -> dlq `requester_unlinked`.
- **Z-11** Promotion readiness (expected case): the targets definer already maps event type `player.promoted` to the
  payload_player mode (payload `player_id`, that player only, active and linked) and the projector keeps a table
  eventType -> {recipient mode, template}; L4 inserts no route for it, so the branch is dead until L8's own migration
  inserts the one route row and L8 adds one template entry. The fee-owed source (payload amount or L8's own read) and the
  VND formatter in the worker are L8's.
- **Z-12** Staleness (stale backlog after a long disable, DLQ replays): delivered `noop_stale`, no audit, no send, when
  the session's ends_at <= clock_timestamp() or its status no longer fits the event (updated, announcement_requested,
  promoted -> 'open'; cancelled -> 'cancelled'). Texts use the CURRENT starts_at and timezone, never payload values.
  session.updated whose changed_fields hold none of starts_at, ends_at, timezone, venue_name, venue_address, price_amount ->
  `noop_irrelevant_fields` with no DB call; changed_fields not a string array -> dlq `malformed_payload`.
- **Z-13** Copy (HARD RULE 5, DD-118): rendered inside `runWithLang(lang)` from `@plexco/core/i18n` with lang = 'en' only
  when tenant_locale(tenant) is 'en', else 'vi' (as `process-event.ts:120`). Strings are listed in 3.10. No venue,
  address, price, roster or name in any DM (the announce text is meant to be forwarded; venue_name is private until join).
  `{start}` = starts_at in the session timezone (an existing @plexco/core helper if one does this, else
  Intl.DateTimeFormat vi-VN / en-GB, short date and time); `{link}` = APP_BASE_URL + `/c/<tenant_id>/sessions/<session_id>`.
- **Z-14** Bounds: per-call 5 s timeout covering the body (client `:18`, `:46`, `:62`, L3 OPEN 9); sends sequential;
  per-attempt budget 120 s (< the 5 min lease) -> retry `send_budget_exhausted`; `projector_is_enabled('zalo_dm')`
  re-checked before every send, false -> stop, retry `projector_disabled` (L3 OPEN 10); the attempt bound stays the
  dispatcher's 8 (D-7).
- **Z-15** DB handle: `zalo-dm.ts` exports `createZaloDmDeliver(deps)` (tests inject pool, clock, send and timeout) and
  `deliverZaloDm` built with a lazily created `pg.Pool` on DATABASE_URL_DIRECT (max 2, allowExitOnIdle), the app_worker
  credential preflight already checks. dispatcher.ts, worker.ts and index.ts are not edited.

### 3.3 Migration 0057 (Q5, L3 OPEN 2)

- **Z-16** `packages/db/migrations/0057_zalo_delivery_targets_definer.sql`, the only migration. Step 1 (migration role),
  job_definer only, column-narrow: SELECT (id, tenant_id, status, bot_token_enc, key_version) ON zalo_bots; SELECT (id,
  person_id, platform, platform_user_id_enc, status, zalo_bot_id, created_at) ON channel_identities; SELECT (id, tenant_id,
  session_id, membership_id, status, joined_at) ON players; SELECT (id, tenant_id, person_id, status) ON memberships;
  SELECT (id, status) ON persons; SELECT (ends_at, timezone) ON sessions; INSERT (action, actor_id, tenant_id, detail) ON
  routing_audit; EXECUTE ON tenant_locale(uuid); REFERENCES (id) ON outbox_events and channel_identities. Step 2 in the
  0056 bracket (`GRANT CREATE ON SCHEMA public TO job_definer; SET ROLE job_definer; ... RESET ROLE`, then revoke CREATE):
  the Z-17 table, the Z-18 and Z-19 definers, and three route rows `('zalo_dm','session','session.updated')`,
  `('zalo_dm','session','session.cancelled')`, `('zalo_dm','session','session.announcement_requested')` (D-17). zalo_dm stays
  disabled; 0056 is not edited; no grant to app, app_worker or readonly on any table.
- **Z-17** Table `zalo_dm_recipient_deliveries`: event_id uuid NOT NULL REFERENCES outbox_events(id) ON DELETE CASCADE;
  channel_identity_id uuid NOT NULL REFERENCES channel_identities(id) ON DELETE CASCADE; outcome text NOT NULL CHECK IN
  ('sent','terminal'); error_code text CHECK `^[a-z][a-z0-9_]{0,63}$`; CHECK ((outcome = 'sent') = (error_code IS NULL));
  created_at timestamptz NOT NULL DEFAULT now(); PRIMARY KEY (event_id, channel_identity_id); no tenant_id (derived through
  the event), no RLS, zero grants (the 0056 D-2 posture); named constraints mirrored in schema.ts and db.dbml.
- **Z-18** `zalo_dm_delivery_targets(p_event_id uuid, p_claim_token uuid, p_key_version text)` RETURNS TABLE (disposition
  text, bot_id uuid, bot_token_enc text, key_version text, locale text, starts_at timestamptz, timezone text,
  channel_identity_id uuid, recipient_user_id_enc bytea); plpgsql VOLATILE SECURITY DEFINER, `SET search_path = public,
  pg_temp`, owner job_definer, REVOKE ALL FROM PUBLIC, EXECUTE app_worker only. Zero rows unless the live-claim predicate of
  outbox_claimed_event (`0056:194-205`) holds for projector 'zalo_dm' (-> retry `claim_lost`). Otherwise either ONE status
  row (disposition bot_unavailable | stale | no_recipients | requester_unlinked | all_recorded; secret columns NULL; no
  audit) or, for 'ok', it first INSERTs the routing_audit rows ('zalo.secret_decrypt', NULL, tenant, {botId, purpose:
  'bot_token'}) and ({botId, purpose: 'channel_user'}), the detail shape of appendSecretDecryptAudit, and then returns one
  row per unrecorded recipient. Bot usable iff status IN ('registered','active') AND key_version = p_key_version. An audit
  failure raises, so no ciphertext is returned and nothing is decrypted. Returns no name, phone, email or display name.
- **Z-19** `zalo_dm_record_recipient(p_event_id uuid, p_claim_token uuid, p_channel_identity_id uuid, p_outcome text,
  p_error_code text)` RETURNS boolean, same posture: INSERT ... ON CONFLICT DO NOTHING; true when the row exists after the
  call; false and no write when projector_deliveries (event, 'zalo_dm') is not 'claimed' with that token or the identity is
  not a zalo identity on the event tenant's bot (lease expiry is deliberately not checked: a late record of a real send
  prevents a duplicate); 22023 on a bad outcome or error_code.

### 3.4 Tests, scope, the dispatcher comment (Q7, Q10)

- **Z-20** Harness (#62) as is: db tests use `setupRlsTestContext(<unique name>)` (`test-harness.ts:679`); bot DB tests copy
  `setupDispatcherContext` (`dispatcher.test.ts:46-106`: `withJobDefinerLock` from `./test-db.js` around
  `bootstrapJobDefiner` + migrate, `setAppWorkerPasswordRaceSafe` lease after setup, release after the pools, plain DROP of
  its own DB). No password literal, no ALTER ROLE, no per-suite role password, no edit of either test-harness.ts or
  test-db.ts. Negative-privilege assertions hold the jobd reader lock (`withDefinerReadLock`, `:547`). No L4 test takes the
  chat-definer slot; a site that ever needs both takes the job definer lock (shared) first, then the chat-definer slot, never
  reordered (P3-S1 D12). The audit-failure case uses a BEFORE INSERT trigger on routing_audit created in the test's own
  database (no role change). The stub is a `node:http` server on 127.0.0.1:0 answering POST `/bot<token>/sendMessage` with
  scripted envelopes per chat_id (ok, ok:false + error_code, HTTP 401/403/429/500, slow, malformed, oversize, connection reset).
- **Z-21** Scope additions, nothing else outside the lane list: `apps/web/lib/read-bounded-body.ts` (shim);
  `packages/db/package.json` (3 exports, Z-3 dependency); `apps/bot/package.json` (Z-3); `pnpm-lock.yaml` (importers);
  `packages/db/schema.ts` and `packages/db/db.dbml` (Z-17 mirror); `packages/db/src/migrate.test.ts:53` (58 + comment) and
  `:770` (tail + 0057); `packages/db/src/rls-invariants.test.ts:70`, `:73`, `:1753`, `:1758` (58), `:2037` (tail + 0057),
  the job_definer function lists at `:2054-2063` and `:2515-2523` (+ the two Z-18/Z-19 names), `:4607-4610` (UCC-8 title,
  58, tail 0057). `packages/db/src/zalo-ingress.ts` changes at most its header comment.
- **Z-22** Q10: L4 does not edit dispatcher.ts, so the `:74` leaseLostSkips comment (L3 OPEN 13) stays as is.
- **Z-23** B3: section 4.

### 3.9 NEW files (scope prose; not TARGET_FILES)

`packages/db/src/connector-crypto.ts` + `.test.ts`, `packages/db/src/zalo-bot-api.ts` + `.test.ts`,
`packages/db/src/read-bounded-body.ts`, `packages/db/migrations/0057_zalo_delivery_targets_definer.sql`,
`packages/db/src/zalo-dm-delivery.test.ts`, `apps/bot/src/projectors/zalo-dm-templates.ts`,
`apps/bot/src/projectors/zalo-dm.test.ts`, `apps/bot/src/test-zalo-stub.ts` (test-only).

### 3.10 DM copy (Z-13, user-facing pairs, default applied, pending owner sign-off)

- session.updated: `t("Buổi chơi lúc {start} đã thay đổi {fields}. Xem chi tiết: {link}", "Your session at {start} changed: {fields}. Details: {link}")`;
  field labels `t("giờ", "time")` (starts_at, ends_at, timezone), `t("địa điểm", "venue")` (venue_name, venue_address),
  `t("giá", "price")` (price_amount), joined with ", ".
- session.cancelled: `t("Buổi chơi lúc {start} đã bị huỷ. Xem: {link}", "The session at {start} was cancelled. See: {link}")`.
- session.announcement_requested: `t("Tin mời để chuyển tiếp:\n{text}", "Ready to forward:\n{text}")` with
  text = `t("Mời tham gia buổi chơi lúc {start}: {link}", "Join the session at {start}: {link}")`.

## 4. B3 exception (budget: about 300 LOC, 3 modules, 1 migration)

- Modules (4): M1 shared connector code in packages/db (connector-crypto, zalo-bot-api, read-bounded-body, package.json);
  M2 migration 0057 with its schema.ts / db.dbml mirror and the count bumps; M3 the apps/bot zalo_dm projector (zalo-dm.ts,
  templates, stub, tests, package.json); M4 the apps/web re-export shims.
- Why a split breaks coherence: M1 alone has no consumer and cannot prove "identical crypto in two processes" (A28 needs
  the worker decrypting); M3 cannot read targets or record dispositions without M2 (app_worker has no grants); M2 alone adds
  routes and definers nobody calls; M4 is the other half of M1's move (a split leaves two diverging envelope copies). The
  same secret-handling surface gets one security round as a whole.
- Compatibility (rolling deploy): (1) 0057 first: old web and old worker never touch the new objects; the three routes are
  inert while zalo_dm is disabled (outbox_required_projectors filters `p.enabled`, `0056:134`), so acks stay '{}'.
  (2) New web on old or new schema: the shims re-export byte-identical crypto (same label, AAD, key_version), stored
  ciphertexts open unchanged (A28); the only tightening is Z-5 (the default base is https). (3) New worker before 0057:
  zalo_dm is seeded disabled and never claimed; if enabled anyway, the targets call fails -> retry -> DLQ
  `attempts_exhausted`, replayable after migrating; nothing is sent. (4) Old worker with zalo_dm enabled after 0057: the
  placeholder dead-letters `projector_not_implemented` (D-8), replayable. (5) Rollback: disable zalo_dm (runbook section 3),
  then revert code; schema only by a new forward migration, never by editing 0057.
- Hard caps, measured with `git diff --numstat 442aa1b..HEAD` minus this file: exactly one migration file; total added +
  deleted <= 3000; non-test added <= 1250 (migration <= 280, schema.ts + db.dbml <= 60, package.json files +
  pnpm-lock.yaml <= 15); test added (`*.test.ts` + the stub) <= 1450. Over any cap -> stop and report; never trim tests to fit.

## 5. Acceptance matrix (lane TESTS and every decision-table row; stub-backed unless marked)

| # | Case | Expected |
|---|---|---|
| A1 | session.updated with starts_at/ends_at/timezone/venue_name/venue_address/price_amount | one DM per Z-9 recipient; dispositions sent; delivered `sent` |
| A2 | session.updated with other fields only | no definer call, no audit, no stub call; delivered `noop_irrelevant_fields` |
| A3 | session.cancelled (roster seeded by SQL) | same recipients as A1, one DM each |
| A4 | empty recipient set | no audit, no stub call; delivered `noop_no_recipients`; never retry or dlq |
| A5 | announcement with requested_by_person_id | one DM to the requester only; join text + link; no venue or price |
| A6 | announcement without it (base payload) | dlq `no_requester`; no DB call, no stub call |
| A7 | requester unlinked | dlq `requester_unlinked`; no send |
| A8 | player.promoted | no L4 route row; with a test-only route the definer returns only the payload player (Z-11) |
| A9 | other event types (session.published, payment.settled) with zalo_dm enabled | no zalo_dm delivery prepared |
| A10 | bot missing / status connecting, drift, error, revoked / key_version mismatch / tampered ciphertext | dlq `bot_unavailable`; no send; no audit except the tampered case (audit before decrypt) |
| A11 | audit insert fails (test-DB trigger) | definer raises; no ciphertext, no decrypt (spy), no send; retry `targets_read_failed` |
| A12 | HTTP 500 / 429 / slow (timeout) / reset | retry `zalo_server_error` / `zalo_rate_limited` / `zalo_timeout` / `zalo_network` |
| A13 | 403 for B, ok for A and C | B terminal `zalo_rejected`; A, C sent; delivered |
| A14 | 401 | dlq `zalo_unauthorized`; later recipients unsent; replay sends only those |
| A15 | partial send then retry | second attempt sends only unrecorded recipients (stub log) |
| A16 | record fails after a send | retry `record_failed`; next attempt resends exactly that one DM |
| A17 | envelopes: ok:true; ok:false 403; ok:false no code; 2xx no boolean ok; bad JSON; > 64 KiB | sent; rejected; rejected; bad_response x3 (never resent) |
| A18 | secrets | bot token and chat ids absent from captured logs, errors, routing_audit detail ({botId, purpose} only), error_code and provider_ref columns |
| A19 | DD-118 | locale 'en' -> English; 'vi' or other -> Vietnamese; all copy via runWithLang + t(vi, en) |
| A20 | scoping fixture (db, two tenants) | excludes waitlisted, left, inactive identity, identity on the other tenant's bot, merged or deleted person, left or merged membership, joined after the event, other tenant |
| A21 | disable zalo_dm between two sends | stop; retry `projector_disabled`; second recipient unsent |
| A22 | wrong token / expired lease / disabled / unrouted (db) | targets returns zero rows; no audit |
| A23 | posture (db) | both definers owned by job_definer, SECURITY DEFINER, search_path public, pg_temp, EXECUTE app_worker only; no runtime-role privilege on the table; job_definer NOLOGIN |
| A24 | record definer (db) | idempotent; false on a wrong token or foreign identity; 22023 on bad outcome or code |
| A25 | stale: ended session or status mismatch | delivered `noop_stale`; no audit, no send |
| A26 | base URL: http non-loopback, ftp, userinfo, path, query | `invalid_base` before fetch; projector dlq `config_missing`; https and http://127.0.0.1 accepted |
| A27 | 120 s budget (injected clock) | retry `send_budget_exhausted`; remainder unsent |
| A28 | crypto parity | pre-move pinned ciphertext opens with the moved code; web encrypt -> worker open and back; unchanged web tests pass (connector-secrets, auth-secrets, oauth-transaction, client, zalo webhook and onboarding routes) |
| A29 | migration (db) | 0057 applies after 0056 (incl. JCL-1 / BR-6 non-superuser path); counts 58; exactly 3 zalo_dm routes; zalo_dm disabled; 0056 CHECK unchanged |
| A30 | no live claim | committed defaults keep OUTBOX_DISPATCH_SCHEDULE_ENABLED false; no projector enabled; no real token |
| A31 | injected definer error, decrypt throw, stub crash | a DeliveryOutcome every time, never `deliver_threw` |
| A32 | changed_fields not a string array | dlq `malformed_payload` |

Acceptance commands: the S1 VERIFY set; `NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/bot test`;
`pnpm --filter @plexco/web test`; `pnpm --filter @plexco/db test`; every DB run under the DB/e2e lock.

## 6. Implementation order (test-first)

1. Crypto (Z-1..Z-3): pin the pre-move ciphertext (FIRST_IMPLEMENTATION_STEP), create `connector-crypto.ts` + exports + the
   aws dependency (`pnpm install` for the lockfile), turn the three web modules into re-exporting shims; web tests green.
2. Client (Z-5, Z-6): failing `zalo-bot-api.test.ts` (A17, A26, classification), move client + read-bounded-body, shims;
   web `client.test.ts` unchanged and green.
3. Migration (Z-16..Z-19): failing `zalo-dm-delivery.test.ts` (A8, A10 SQL side, A11, A20, A22-A24, A29), write 0057, the
   schema.ts / db.dbml mirror and the Z-21 count bumps; one db suite run under the lock.
4. Projector (Z-7..Z-15): stub + failing `zalo-dm.test.ts` (A1-A7, A9, A12-A19, A21, A25, A27, A31, A32), then
   `zalo-dm.ts` and `zalo-dm-templates.ts`, `apps/bot/package.json`; bot suite under the lock.
5. S1 VERIFY set, GitNexus impact before each edited symbol and detect_changes before each commit, then review rounds.

## 7. Closure matrix (gate section 8)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `442aa1bf61234a7b4330295dfd36211446988a8a`, exact TARGET_FILES, worktree HEAD equal | PASS |
| 2 | Decisions in scope closed | DD-134 (a)-(f) + (c) override signed; L3 D-1..D-24; DD-122 D4 | PASS |
| 3 | Scope IN/OUT and owner clear | verdict IN_SCOPE / OUT_OF_SCOPE, 3.9, Z-21, section 4 | PASS |
| 4 | Dependencies classified | L3 merged (#64 98a4a6c); every object called exists at base (2.3, 2.4) | PASS |
| 5 | Live code matches the doc | every lane cite re-measured (2.3); corrections C1-C6 | PASS |
| 6 | Data/API/state/auth contract | Z-1..Z-19 | PASS |
| 7 | Fail-closed, idempotency, order | Z-4..Z-8, Z-12, Z-14, Z-18, Z-19; compatibility proof | PASS |
| 8 | Open questions in scope = 0 | Z-1..Z-23 pinned | PASS |
| 9 | Acceptance matrix has expected results | section 5, A1-A32 | PASS |
| 10 | Migration, security, rollback pinned | Z-16..Z-19; audit before ciphertext; SSRF Z-5; rollback in section 4 | PASS |
| 11 | First slice hard dependencies merged | #64 98a4a6c ancestor of the base | PASS |
| 12 | Implementation handoff ready | worktree at base, FIRST_IMPLEMENTATION_STEP, section 6 | PASS |

## 8. OPEN (not blocking this lane)

- OUT_OF_SCOPE: the runbook and `infra/docker-compose.yml` name none of the Z-4 worker variables; before zalo_dm is
  enabled the owner supplies them (P0), and a later docs or infra lane may write them down.
- OUT_OF_SCOPE (L4b): `session.announcement_requested` must carry `requested_by_person_id` (BE spec `:644` lists
  `session_id`, `channel`); until then every announcement dead-letters `no_requester`.
- OUT_OF_SCOPE (L8): the promotion DM's fee-owed source and a VND formatter the worker can import
  (`apps/web/lib/money.ts` is web-only).
- OUT_OF_SCOPE: `dispatcher.ts:74` leaseLostSkips comment (L3 OPEN 13), for the next lane that edits dispatcher.ts.
- Owner P0 (PR body): connect a real bot token; give the worker the Z-4 variables; enable the schedule in the runbook order;
  enable zalo_dm; verify the Zalo status and error_code values behind Z-6 live.
