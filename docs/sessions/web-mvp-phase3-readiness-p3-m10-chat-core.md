<!-- review-readiness: code-ready -->

# Step-0 readiness: L14 p3-m10-chat-core (session P3-S11)

> Agent-facing. Readiness parts A (DB authority), B (spec authority) and C (activation paths, provisioning, tests), opus/max
> read-only, measured at the base; part D (opus/max, read-only) assembled them under the orchestrator reconciliation R1-R13
> and resolved part C's U4 by a sed of `0031:214-267`; part E (opus/max) applied the conductor rulings RO-L14-1..5 with their
> Amendment 1 and the orchestrator's follow-up pins (section 1a). Writer opus/max; code reviewer opus/max + opus/max security
> round, at most 3 rounds (DD-122 D4, Codex waived by owner 2026-10-12). Every `path:line` is the parts' measurement at base
> `f17f52ad824de3e548eab25a3c2949b6fa280cd6`. Short forms: tech = docs/features/BE/feature_inapp_chat_tech.md,
> fe = docs/features/FE/feature_inapp_chat.md, dec = docs/standards/decisions.md, `00NN` = packages/db/migrations/00NN_*.sql.
> TARGET_FILES are read-only context that exists at the base; new files are scope, never TARGET_FILES.
> Ruling status: R2 is confirmed by RO-L14-2; R3, R12 and R13 are overridden by RO-L14-3, RO-L14-4 and RO-L14-1; R1 and R5
> are amended by RO-L14-5 and Amendment 1. No ruling is pending; section 9 carries the B3 ruling line.

## 0. Threat model (binding, nothing wider)

| # | Actor | Must be impossible |
|---|---|---|
| a | Active club member without capabilities | read another tenant's or channel's messages; read any hidden or author-deleted body (own included); post in an `admins_only` channel; edit or delete another person's message; hide or restore; reach any DM; send as someone else; write revision, audit or receipt rows; move anyone's read cursor backward or move another person's cursor |
| b | Host / co-admin holding `chat.message.moderate` | read a hidden body; alter or delete an audit, revision or receipt row; re-apply a superseded moderation action by replaying an old command id; moderate a DM, assistant or system message; act in another tenant |
| c | Guest, former member (a left membership), other-tenant person | read or write anything in the club channel |
| d | Any DB session that can LISTEN (app, app_worker, readonly) | receive message text, channel id, tenant id or sender through `chat_realtime` |
| e | Any member of a suspended tenant, through chat-service | send, edit, delete, moderate, mark read or read history (V-23) |

TRUSTED, out of scope: the platform owner (migration role / superuser) and a fully compromised web process that sets its own
GUCs or calls a definer without chat-service (so the V-23 gate is TS-side by design). The definers are defence in depth
against wrong host-facing code, not against that process.

## 1. Base, dependencies, authority

- Base origin/main `f17f52ad824de3e548eab25a3c2949b6fa280cd6` (contains #68 L8, #76 L11 with migration 0062 = the latest, #77 L12).
  W = `.autopilot/worktrees/p3-m10-chat-core`, branch `feat/p3-m10-chat-core`, HEAD = base, clean. Next free migration `0063`.
- D4 signed: dec 1786 ("Phase 3 plan approved. D4 signed."). DD-136 scope dec 1775-1778 (club channels, send, keyset history,
  read cursor, live updates, reply, edit own, soft-delete own, host hide/restore; DM, media, reactions, search, group, pin,
  poll, embed, nickname, slash, digest, push, email excluded). DD-86 dec 1240-1248 (same-transaction provisioning, exactly one
  default, capabilities via DD-56, `chat_members.role` is not authority). DD-55: the four dm_safety flags stay false.
- L8 merged (#68): `0058_player_self_join.sql` present. `chat_definer` comes from `infra/postgres-init/02-chat-definer.sql`
  (NOLOGIN NOSUPERUSER BYPASSRLS NOINHERIT, `:51-52`; fails closed on drift `:80-87`); `pnpm db:bootstrap` first, CI runs it.

## 1a. Conductor rulings RO-L14-1..5 (2026-10-19)

Authority: the conductor's ruling note `conductor-ruling-b3.md` in the P3-S11 session notes (`Claude outputs/plexco-phase3/
status/P3-S11-notes/`, untracked), sections RO-L14-1..5 and Amendment 1, written after measuring the base. Each decision and
its reason line is restated here so this file stands alone; the PR body repeats this section. Decision order: fail-closed and
least privilege, concurrency, reversibility, no memory debt, scope.

- RO-L14-1 (section RO-L14-1, Q1) B3 exception GRANTED with caps and a bounded fallback: modules exactly three; non-test cap
  1500 LOC with a report to the conductor above 1400 and, above 1500, STOP with the L14b fallback (moderation: hide/restore,
  audit, receipts cut into a following migration lane under a new conductor brief), never a higher cap; test-class 2600 and
  total 4100 reported against the acceptance rows, not a stop; files 17 plus at most 3 test-only edits (RO-L14-4); area-split
  review rounds from round 1; one section per writer worker, commit after each. Reason: part D's estimate plus about 100 LOC
  for receipts and the read functions fits 1500, and a fresh reviewer reaches the stop notice after about 20 tool calls, so
  one reviewer cannot cover the migration in one pass. Applied: sections 9, 10, 11.
- RO-L14-2 (section RO-L14-2, Q2) read-path widening YES, fail closed: REVOKE app's table-level SELECT on chat_messages first
  (column grants are additive), then GRANT SELECT on an explicit allowlist of non-content columns, so a later column is
  unreadable by default; body and the moderation actor and reason columns stay out; no app grant at all on the revision store,
  the moderation audit and the receipts table; chat_definer read functions follow the L9 attribute and grant test pattern; the
  lane block's "app keeps SELECT only" is amended to "no write and no content column". Reason: the lane's own TEST "a message
  hidden by a moderator is a tombstone to everyone else" needs a DB-level read path, the spec says normal history, SSE and
  search cannot select the audit and revision data (tech ~595), and TS-only redaction is bypassed by any later direct SELECT.
  Grep proof at the base: F-14. Applied: V-13, V-22, 4.2, 4.4, DT-21, DT-31, DT-32.
- RO-L14-3 (section RO-L14-3, Q3) moderation command receipts are IN (part D's R3 rejected): `chat_command_receipts` with the
  spec DDL (tech 462-474) and no app grant; moderate takes the command id; the canonical fingerprint is pinned (V-26); the
  receipt is checked before any mutation; result_json holds ids, action and state only; the reason-note rule (tech 451-455)
  lands as the audit column with its CHECK. Reason: the spec's final contract requires them (tech 145, 1164, 1356, test row
  53), and state idempotency alone is wrong for a stale retry: hide X, then restore X, then a late replay of hide X would hide
  it again. Still OUT: channel lifecycle commands, mutes and every other receipts action (their values stay in the DDL as the
  spec has them). Applied: V-11, V-26, 4.2, 4.3, 4.4, DT-13..DT-16, DT-24, DT-28..DT-30, DT-38.
- RO-L14-4 (section RO-L14-4, Q4) named test-only additions APPROVED: `chat-schema-invariants.test.ts` (seed adapted to the
  provisioning trigger); `identity-link-web.test.ts`, `identity-link-web-nobypass.test.ts` and
  `apps/web/lib/session-guest-note-route-db.test.ts` only if the full suite shows the failure, each limited to setup or
  teardown that deletes a membership (delete the dependent chat_members row first); behavior assertions unchanged; each edit
  listed in the PR body. Reason: no non-test code deletes or UPDATEs a membership (both greps empty at the base, F-14), so only
  fixtures meet the NO ACTION FK; the chat_members FK stays NO ACTION (fail closed: a membership with chat history is never
  silently deleted); a production delete path would be a design question: STOP and report, never hidden in a test edit (none
  exists at the base). Applied: section 2, V-25, K-2.
- RO-L14-5 (section RO-L14-5, Q5) pins APPROVED with amendments: trigger `AFTER INSERT OR UPDATE OF status ON memberships FOR
  EACH ROW WHEN (NEW.status = 'active')`, guests get no row; NOTIFY `chat_realtime` with the opaque id, once per effective
  change; DM: moderation -> CHAT_MODERATION_FORBIDDEN, every other DM operation -> CHAT_SAFETY_BLOCKED; another author's
  client_msg_id -> CHAT_IDEMPOTENCY_MISMATCH, generic, the same author's replay -> CHAT_DUP_MESSAGE with the original, both
  tested; body cap 4000 by `char_length` in the function, no body CHECK, plus a test that a unique and a NOT NULL violation on
  the send path carry no body; per-channel lock then `clock_timestamp()`; the spec's table names; the PR body states the L15
  contract. Reason: every activation at the base is an INSERT and nothing UPDATEs memberships, but the UPDATE arm means a
  future guest-to-active or left-to-active path cannot forget (no memory debt); NOTIFY naming diverges from tech 944 because
  L5's listener holds one LISTEN client per web process and per-channel names would need dynamic LISTEN management and a
  GET-to-LISTEN race, while the payload stays the opaque id and the consumer re-authorizes every id per subscriber. Applied:
  V-1, V-3..V-6, V-16, V-18, V-19, 4.5, DT-3, DT-4, DT-36, DT-37.
- Amendment 1 (section Amendment 1): RO-L14-5's "ON CONFLICT DO NOTHING" is replaced by the spec's re-join upsert (V-15), with
  three tests (a re-join restores chat on the same row with the cursor kept, a trigger replay writes nothing, a left-only
  person stays locked out); pins approved, each a default applied pending owner sign-off: edit and delete 30 per minute per
  person and channel (tech 1335) and one moderation bucket (tech 1338), same CHAT_RATE_LIMITED; chat-service gates every
  command through authorizeTenantAction (use, do not change); assistant_enabled stays false on the provisioned channel.
  Reason: the spec's re-join-restores contract (dec 1240, tech 103-104, test #50 at tech 1512) needs it because a re-join is a
  new membership row; "DO NOTHING" was shorthand, the measurement wins. Applied: V-8, V-14, V-15, V-23, DT-22, DT-33..DT-35,
  DT-38, DT-39.
- Outside L14 (conductor records): the NOTIFY naming divergence and the read-grant narrowing go into L17's consolidated
  defaults entry (O-7); the ruling is the authority until the owner signs.

## 2. Scope (FILES IN SCOPE) and negative scope

- NEW `packages/db/migrations/0063_chat_message_commands.sql` (the only migration).
- NEW `packages/db/src/chat-service.ts`, NEW `packages/db/src/chat-service.test.ts`; `packages/db/src/index.ts` (exports);
  `packages/db/schema.ts` + `packages/db/db.dbml` (the three new tables mirrored).
- `packages/core/src/api-contract.ts` + `packages/core/src/api-contract.test.ts` (the 12 codes of 4.6).
- RO-L14-4 test-only additions: `packages/db/src/chat-schema-invariants.test.ts` (seed adapted to the provisioning trigger,
  V-25); only if the full suite shows the failure, and only in setup or teardown that deletes a membership:
  `packages/db/src/identity-link-web.test.ts`, `packages/db/src/identity-link-web-nobypass.test.ts`,
  `apps/web/lib/session-guest-note-route-db.test.ts`.
- Use, do not change (zero diff, proven by `git diff --name-only f17f52ad824de3e548eab25a3c2949b6fa280cd6...HEAD`):
  authorization.ts (authorizeTenantAction is called, V-23), capability.ts, roster-service.ts, session-join-service.ts,
  join-request-service.ts, auth.ts, 0037, 0051, 0058.
- NEGATIVE SCOPE: no HTTP route or UI (L15, L16); no DM (flags stay false, no `assert_dm_allowed` call); no media, reactions,
  search, mentions, mutes, group, pin, poll, nickname, slash commands, digest, push or email; no channel lifecycle command and
  no receipts action other than `message.hide` and `message.restore` (RO-L14-3); no chat content in any log, NOTIFY payload or
  public surface; no Zalo or Messenger bridge; Assistant off; no outbox event, no `web_realtime` row, no listener (A2 note 28);
  no TS activation-path change (the DB trigger covers every path, RO-L14-5); no edit to decisions.md.

## 3. Measured facts the contract rests on

- F-1 `0031:121-169`: `body text NOT NULL`, no length or non-empty CHECK (`:128`); `search_document` GENERATED from body
  (`:141-143`); `UNIQUE (channel_id, client_msg_id)` per channel, not per sender (`:144`); `UNIQUE (channel_id, created_at, id)`
  (`:146`); moderation trio pair CHECK, restore must NULL all three (`:151-157`); `created_at DEFAULT now()` (`:140`).
- F-2 FORCE RLS on all three chat tables (`0031:326, :333, :340`); club policies USING tenant match AND
  `chat_current_is_member` (`:327-346`), which reads only `app.person_id` and admits only `memberships.status = 'active'`
  (`:280-292`); app is SELECT-only on the three tables (`:353-354`).
- F-3 chat_definer at the base: SELECT (id, person_id, tenant_id, status) ON memberships (`0031:322`), SELECT ON chat_channels,
  chat_members (`:323`), nothing on chat_messages, EXECUTE `rate_limit_check` (`0030:354`), no EXECUTE on
  `tenant_capability_authorize` (catalog probe; `0049:133-134` grants app only); BYPASSRLS, so its own DML ignores policies.
- F-4 every chat_members INSERT runs `SELECT ... FROM chat_channels ... kind = 'dm' FOR UPDATE` with invoker rights
  (`0031:190`); the privilege is checked even when no row matches, so chat_definer needs UPDATE on one chat_channels column.
- F-5 (part D sed `0031:236-257`) `chat_assert_dm_two` is invoker-rights plpgsql doing a plain `SELECT kind FROM chat_channels`
  (no row lock); the constraint triggers `trg_chat_dm_two_members` / `_channel` are DEFERRABLE INITIALLY DEFERRED and fire at
  COMMIT as the committing role. A club or invisible row is a no-op; the committing role needs SELECT on chat_channels
  (app yes, superuser yes, app_worker no).
- F-6 `tenant_capability_authorize(p_tenant_id uuid, p_action text, p_actor_person_id uuid) RETURNS TABLE (allowed, role, reason)`,
  one row always, requires `app.tenant_id = p_tenant_id` (`0049:44-69`); `chat.channel.post_restricted` and
  `chat.message.moderate` are preset, owner / admin / co_admin only, non-delegable (`0047:77-87`).
- F-7 `rate_limit_check(p_bucket text, p_limit integer, p_window interval)` (0046) takes a per-bucket advisory lock and inserts
  its hit in the caller's transaction, so a later raise rolls the hit back.
- F-8 nothing in packages/db/src sets `app.person_id` (`tenant.ts:55, :68` set `app.tenant_id` only).
- F-9 memberships INSERT sites: `0037:148` (active), `roster-service.ts:120-123` (active), `dev-seed-club-members.ts:44-49`
  (active), `0058:78-81` (guest); no memberships UPDATE or DELETE in non-test code; no trigger on memberships at the base.
- F-10 FKs chat_members -> memberships (`0031:113`) and chat_messages -> memberships (`0031:148`) have no ON DELETE action;
  three test files delete memberships (RO-L14-4 list).
- F-11 `chat-schema-invariants.test.ts` seeds active memberships (`:207-213`) before its own default channels (`:218-222`,
  `:236-240`): under the trigger `:218` violates `chat_channels_default_uq`.
- F-12 `chat_realtime` is unused in code; the only migration NOTIFY is `0056:53` (outbox_wake).
- F-13 a CHECK or NOT NULL violation prints DETAIL "Failing row contains (...)" with every column, body included.
- F-14 (orchestrator greps at HEAD f17f52ad824de3e548eab25a3c2949b6fa280cd6, log `o-ruling-greps.log` in the session notes;
  RO-L14-2 and RO-L14-4): non-test DELETE of memberships (SQL + Drizzle) over packages, apps, infra and scripts: none;
  non-test UPDATE of memberships (SQL + Drizzle): none; non-test reads of chat_messages (SQL text or the Drizzle table object)
  over packages and apps: only `packages/db/README.md:515` (prose); `schema.ts` and `db.dbml` mention it as declarations only.
- F-15 `authorization.ts:49-100`: `ActionClass` is a closed union (publish_new_sessions, admin_mutation, integration_changes,
  announce_session, update_open_session, close_session, cancel_session, manage_roster, mark_paid), with no chat and no read
  class; only close_session and cancel_session tolerate a literal `suspended` (obligation termination); a denial is
  `{ allowed: false; code: "TENANT_SUSPENDED" }`; the signature is `authorizeTenantAction(tx, tenantId, actionClass)`
  (`:153-157`), so it runs inside the caller's transaction; `TENANT_SUSPENDED` is already an api-contract code
  (`api-contract.ts:159`).
- F-16 tech 435-474: the spec DDL of `chat_moderation_audit` (reason_code CHECK; the reason-note CHECK: `other` needs a note of
  1..500 bytes, any other reason forbids one; mute columns and a mute shape CHECK) and of `chat_command_receipts`
  (PK (tenant_id, actor_person_id, command_id); action CHECK over seven values; canonical_fingerprint text; result_json jsonb).
- F-17 (part E sed at the base) `0031:121-163` chat_messages has 18 columns: the 14-column app allowlist of V-13 plus the 4
  excluded columns is the full set; `chat_channels_default_uq` is `0031:98`; `chat_members_identity_immutable`
  (`0031:209-217`) guards channel_id and person_id only.
- F-18 `packages/db/src/me-player-reads.test.ts:189-217` (L9, migration 0059): A-12 asserts SECURITY DEFINER, volatility,
  pinned search_path and owner; A-13 asserts EXECUTE revoked from PUBLIC and held by exactly the owner and app. It is the
  attribute and grant test pattern for the read functions (RO-L14-2).

## 4. Contract (binding)

### 4.1 Pinned values (each: default applied, pending owner sign-off; repeated in the PR body; L17 consolidates)

| # | Value | Source |
|---|---|---|
| V-1 | Body cap 4000 code points (`char_length`); NULL, empty or whitespace-only (`p_body IS NULL OR p_body !~ '[^[:space:]]'`) -> INVALID_BODY 400; checked before any INSERT/UPDATE; no body CHECK added | R7, B P-1/P-2, RO-L14-5 |
| V-2 | `client_msg_id` 1..64 characters, else INVALID_BODY | B P-3 |
| V-3 | Same author + same client_msg_id -> the original (`duplicate = true`, outcome CHAT_DUP_MESSAGE, 200-safe), body not compared, no row, no rate token, no NOTIFY; another author or a non-person original -> CHAT_IDEMPOTENCY_MISMATCH 409, generic: no message id, body, author or timestamp in the result or the error | R4, RO-L14-5, tech 876-888, 1310 |
| V-4 | Channel kind is checked first: `kind <> 'club'` -> CHAT_SAFETY_BLOCKED (send, edit, delete, mark_read, list), moderation -> CHAT_MODERATION_FORBIDDEN, `chat_get_message` -> zero rows (V-22); no `assert_dm_allowed` call | R5 as approved by RO-L14-5, tech 1304, 1325 |
| V-5 | NOTIFY channel `chat_realtime`, payload = the message id as text, once per effective change, in the writer's own transaction. Divergence from tech 944 (`'chat_' \|\| channel` per channel), reason (RO-L14-5): L5's listener holds one LISTEN client per web process; per-channel names would need dynamic LISTEN management and a GET-to-LISTEN race; the payload stays the opaque id the spec requires; the consumer re-authorizes every id per subscriber | R6, A2 note 28, RO-L14-5 |
| V-6 | Lock: `SELECT ... FROM public.chat_channels WHERE id = p_channel FOR NO KEY UPDATE` is the first statement of every command function (send, edit, delete, moderate, mark_read); send stamps `created_at := clock_timestamp()` after it. Why: chat_definer needs UPDATE on one chat_channels column anyway (F-4), so no new privilege; no advisory-key namespace shared with the test-harness slot locks, the rate_limit_check bucket locks or cdlk 1667525739; compatible with the FOR KEY SHARE of FK checks and with provisioning (its `kind = 'dm'` FOR UPDATE matches no club row); read and lock in one statement. Ceiling: one writer per channel at a time | R8, approved by RO-L14-5 |
| V-7 | Actor = GUC `app.person_id`, tenant = GUC `app.tenant_id`, set only by the chat-service helper `withChatActor` (`set_config('app.person_id', $1, true)` inside withTenant); functions never call set_config; NULL or malformed -> CHAT_FORBIDDEN. Why: `chat_current_is_member` and the chat RLS policies read the same GUC, so one source cannot drift from what RLS enforces; a parameter would be a second source any caller could set | R9, F-8 |
| V-8 | Rates via `rate_limit_check` (bucket keys carry uuids only, never message or note text; no key or limit hit is logged): `chat_send_10s:<person>:<channel>` (20 per 10 s), `chat_send_1m:<person>:<channel>` (300 per 1 min), `chat_edit_1m:<person>:<channel>` (30 per 1 min per person and channel, tech 1335, shared by edit and delete), `chat_mod_1m:<person>:<tenant>` (30 per 1 min per actor and tenant, tech 1338, one bucket for hide and restore); all -> CHAT_RATE_LIMITED 429; called after every other check; send, edit and delete consume a token only for an effective change; moderation consumes one for every newly accepted command id (effective or same-state, both write a receipt, V-26) and never for an exact replay | R11, QA7, Amendment 1 |
| V-9 | Edit: author, `author_type = 'person'`, not author-deleted, not hidden, `statement_timestamp() < created_at + interval '15 minutes'`, `edit_count < 5`, else CHAT_EDIT_WINDOW_CLOSED; `edit_count <> p_expected_edit_count` -> CHAT_EDIT_CONFLICT; identical body -> `changed = false`, no revision, no count, no token, no NOTIFY | lane, tech 116, B P-9 |
| V-10 | Delete: author, person message, active member, else CHAT_FORBIDDEN; sets `author_deleted_at` once; repeat -> `changed = false`, no NOTIFY; allowed on a hidden message; no restore, no hard delete | lane, B P-10 |
| V-11 | Moderation: kind first (non-club -> CHAT_MODERATION_FORBIDDEN), then active member + `chat.message.moderate` (allowed IS NOT TRUE for any reason = deny) before any target lookup; `p_command_id` NULL or an action outside hide\|restore -> INVALID_BODY; reason in spam\|harassment\|unsafe\|off_topic\|other, `other` requires a note of 1..500 bytes (`octet_length`), any other reason forbids a note, else CHAT_REASON_INVALID 422, validated in the function before any write (the audit CHECK of 4.3 is only the backstop); reason required for hide and restore; then the receipt (V-26); then the target `FOR UPDATE`: DM, assistant, system or missing target -> CHAT_MODERATION_FORBIDDEN (generic); same-state request -> `changed = false`, no audit row, no NOTIFY, its receipt written; independent of `author_deleted_at`; restore NULLs the trio | R5, RO-L14-3, B P-11/P-12, tech 145, 451-455 |
| V-12 | Tombstone: nobody (author, moderator, other members) reads a hidden or author-deleted body through any L14 surface; `tombstone` = 'author_deleted' (precedence) \| 'moderation_hidden' \| NULL; restore re-exposes the never-cleared body | R2, RO-L14-2, B QB2 (tech 144, 595, 1142, 1284) |
| V-13 | app column narrowing on chat_messages: `REVOKE SELECT ON public.chat_messages FROM app` first (column grants are additive, so a table grant left in place would void the narrowing), then `GRANT SELECT (id, channel_id, tenant_id, author_type, author_person_id, membership_id, reply_to_message_id, edited_at, edit_count, author_deleted_at, moderation_state, moderation_updated_at, client_msg_id, created_at) ON public.chat_messages TO app`, an allowlist, so a later column is unreadable by default; out: `body`, `search_document` (generated from body, F-1, its lexemes are the body's words), `moderation_actor_person_id`, `moderation_reason_code`; no app grant at all on chat_message_revisions, chat_moderation_audit, chat_command_receipts; the lane block's "app keeps SELECT only" now reads "no write and no content column"; grep proof F-14 | R2, RO-L14-2, F-17 |
| V-14 | Default channel: title 'Kênh chung' (L16 renders `t("Kênh chung", "General")`), sort_order 0, is_default true, post_policy 'all_members', creation_origin 'system_bootstrap', created_by_* NULL, assistant_enabled false (Amendment 1: the Assistant stays off; DD-86's reading `true`, dec 1244, stays the owner's alternative) | A, B P-19, C, Amendment 1 |
| V-15 | Provisioning (the spec's re-join upsert): one row into every non-archived club channel of the tenant, the default ensured first (`INSERT ... ON CONFLICT DO NOTHING` against `chat_channels_default_uq`, `0031:98`, then a re-read; no advisory lock): `(channel_id, person_id, membership_id)`, role default 'member'; `ON CONFLICT (channel_id, person_id) DO UPDATE SET membership_id = EXCLUDED.membership_id WHERE chat_members.membership_id IS DISTINCT FROM EXCLUDED.membership_id`. A replay writes nothing; it only ever re-points to an ACTIVE membership of the same person and tenant (the trigger fires only for NEW.status = 'active', the conflict key carries the person, the channel belongs to NEW.tenant_id); the row's read cursor and mute state are kept (only membership_id is SET); `chat_members_identity_immutable` (`0031:209-216`) guards only channel_id and person_id, so the re-point is allowed. Why: a re-join is a NEW membership row and the `membership_id` join (`0031:286-290`) would otherwise keep the person locked out (dec 1240, tech 103-104, test #50 at tech 1512) | dec 1240, B P-20, Amendment 1 |
| V-16 | Trigger `trg_memberships_chat_provision`: `AFTER INSERT OR UPDATE OF status ON public.memberships FOR EACH ROW WHEN (NEW.status = 'active')`; reads ids only from NEW; no NOTIFY, no outbox. The trigger function takes no advisory definer lock (no `pg_advisory_*` call), so ruling D12's job-then-chat lock order is untouched; the UPDATE arm cannot recurse because the function writes only chat_channels and chat_members, never memberships. At the base every activation is an INSERT (0012, 0028, 0037, 0058) and nothing UPDATEs memberships (F-14); the UPDATE arm makes a future guest-to-active or left-to-active path provision without remembering to | R1 as amended by RO-L14-5, C PIN |
| V-17 | Backfill: `chat_backfill_default_channels()` over `memberships WHERE status = 'active'`, same per-member core, run once in 0063 as `SET ROLE chat_definer; SELECT public.chat_backfill_default_channels(); RESET ROLE;` after the ownership block (a NOBYPASSRLS migration role would read zero memberships rows under FORCE RLS) | R1, A QA3, C QC2 |
| V-18 | Names, the spec's where it pins them: `chat_moderation_audit` and `chat_command_receipts` (tech 435-474), `chat_message_revisions` (B P-14); functions as in 4.2 | B P-14, RO-L14-5 |
| V-19 | Errors: `RAISE EXCEPTION USING MESSAGE = '<code>'` (SQLSTATE P0001), no DETAIL, HINT, id or text; chat-service maps a closed allowlist (the 12 codes of 4.6 + INVALID_BODY + NOT_FOUND + TENANT_SUSPENDED from the V-23 gate); any other database error is rethrown as a new Error that carries only its SQLSTATE (500, fail closed): the driver's message, detail, hint, where and cause are never attached, logged or rethrown, because a NOT NULL or CHECK DETAIL prints the whole row (F-13); never logs a body or a note | B P-18, F-13, RO-L14-5 |
| V-20 | Slash-leading bodies are accepted (no slash grammar in the MVP, dec 1777) | B P-21 |
| V-21 | mark_read moves forward only (`cursor IS NULL OR (cursor) < (through.created_at, through.id)`); through-message not in the channel -> NOT_FOUND 404; a tombstoned through-message is allowed; no NOTIFY | B P-22 |
| V-22 | Read functions: `chat_list_messages` keyset by `(created_at, id)`, direction 'before' (default) \| 'after', limit clamped to 1..100 (default 50); `chat_get_message` by id for the NOTIFY consumer. Both SECURITY DEFINER, owner chat_definer, pinned search_path, STABLE; the tenant and membership gate is inside the function (`app.tenant_id` and `app.person_id` set, well-formed and matching an active membership of the channel's tenant; missing or malformed context fails closed); EXECUTE revoked from PUBLIC and granted to app only. List on a non-club channel -> CHAT_SAFETY_BLOCKED; list by a non-member or under a foreign tenant -> CHAT_FORBIDDEN; `chat_get_message` returns zero rows, never an error, for an id the caller may not read (missing, other tenant, non-member, DM), because it serves the database-wide NOTIFY stream. Rows carry `body` NULL plus the `tombstone` kind for a hidden or author-deleted message and never an actor, reason, revision or moderation detail (no moderation_state, moderation_updated_at, moderation_actor_person_id, moderation_reason_code, revision or audit column). Tested with the L9 pattern (F-18) | R2, RO-L14-2 |
| V-23 | Tenant suspension: chat-service gates every call inside the same `withChatActor` transaction and before the definer call through `authorizeTenantAction(tx, tenantId, 'admin_mutation')` (use, do not change; F-15): ActionClass `admin_mutation` for the five writes (send, edit, delete, moderate, mark_read) and for the two reads (list, get). Why one ordinary class: the union has no chat or read class, adding one would change authorization.ts (out of scope, O-8), and admin_mutation is not an obligation-termination class, so a suspended or anomalous tenant is denied, fail closed (a suspended club's chat is frozen, NOTIFY re-reads included). A denial `{ allowed: false, code: 'TENANT_SUSPENDED' }` maps to `ChatCommandError('TENANT_SUSPENDED')` (existing code, `api-contract.ts:159`) with no definer call, no write, no NOTIFY. The definers do not read tenants (0049 never does): the gate is the service's | A QA5, Amendment 1, F-15 |
| V-24 | Edit window time base `statement_timestamp()`; author delete stamps `statement_timestamp()` | tech 116 |
| V-25 | COMPAT: `chat-schema-invariants.test.ts` seed adapted to the provisioning trigger (the minimal seed edit so its own default-channel and chat_members INSERTs at `:207-240` do not collide with the trigger-provisioned rows, e.g. reuse the provisioned default channel and member rows), behavior assertions unchanged; part D's DISABLE TRIGGER form is superseded. The three conditional files are edited only if the full suite shows the failure and only in setup or teardown that deletes a membership: delete the dependent chat_members rows first as ctx.owner; every edit listed in the PR body | RO-L14-4, C COMPAT |
| V-26 | Moderation receipts: `moderate_chat_message` takes `p_command_id uuid` (actor-scoped, tech 145, 1164). Canonical fingerprint, exactly `encode(sha256(convert_to(jsonb_build_array(p_action, p_message::text, p_reason_code, p_reason_note)::text, 'UTF8')), 'hex')`: fields in that fixed order, the action ('hide' or 'restore'), the target message id (canonical lowercase uuid text), the reason code, the reason note when present (JSON null when absent); jsonb text output is deterministic and escapes every field, so the encoding is injective; built-ins only (no extension); the stored value is a hash, so the receipt row never holds note text (a note may quote the message). Order: after the V-11 kind, member, capability and input checks (a replay by an actor who has since lost the capability is denied, fail closed) and before any target lookup or mutation: a receipt for `(app.tenant_id, app.person_id, p_command_id)` with the same fingerprint returns its stored result with no mutation, no audit row, no second receipt, no NOTIFY and no rate token; a different fingerprint -> CHAT_IDEMPOTENCY_MISMATCH 409 before any mutation; none -> target lookup, mutation and audit row (effective change only), the receipt INSERT, all in the one transaction, then NOTIFY (effective only). A same-state command with a new id also writes its receipt (`changed = false`), so its late replay after an opposite action cannot re-apply. `result_json` = `{"message_id", "action", "moderation_state", "changed"}`: ids, action and state only, never message or note text; receipt `action` = 'message.hide' \| 'message.restore'. The per-channel lock (V-6) serializes same-channel races; the PK is the backstop | RO-L14-3, tech 145, 462-474, test row 53 |

### 4.2 Functions (all SECURITY DEFINER, owner chat_definer, `SET search_path = pg_catalog, public, pg_temp`, relations schema-qualified, `REVOKE ALL ... FROM PUBLIC`)

| Function | Signature | Runs as / called by | EXECUTE |
|---|---|---|---|
| send_chat_message | `(p_channel uuid, p_client_msg_id text, p_body text, p_reply_to_message_id uuid DEFAULT NULL) RETURNS TABLE (id uuid, created_at timestamptz, duplicate boolean)` | chat_definer / app via chat-service | app |
| edit_chat_message | `(p_channel uuid, p_message uuid, p_body text, p_expected_edit_count integer) RETURNS TABLE (id uuid, edit_count smallint, edited_at timestamptz, changed boolean)` | same | app |
| delete_chat_message | `(p_channel uuid, p_message uuid) RETURNS TABLE (id uuid, author_deleted_at timestamptz, changed boolean)` | same | app |
| moderate_chat_message | `(p_channel uuid, p_message uuid, p_command_id uuid, p_action text, p_reason_code text, p_reason_note text DEFAULT NULL) RETURNS TABLE (message_id uuid, moderation_state text, changed boolean)`; an exact replay returns the stored receipt values | same | app |
| mark_read | `(p_channel uuid, p_through_message uuid) RETURNS void` | same | app |
| chat_list_messages | `(p_channel uuid, p_cursor_created_at timestamptz DEFAULT NULL, p_cursor_id uuid DEFAULT NULL, p_direction text DEFAULT 'before', p_limit integer DEFAULT 50) RETURNS TABLE (id uuid, channel_id uuid, author_type text, author_person_id uuid, body text, reply_to_message_id uuid, edited_at timestamptz, edit_count smallint, tombstone text, created_at timestamptz)`, STABLE | same | app |
| chat_get_message | `(p_message uuid) RETURNS TABLE (<same columns>)`, STABLE | same | app |
| chat_provision_member | `(p_tenant uuid, p_person uuid, p_membership uuid) RETURNS void` | chat_definer / trigger fn and backfill | none |
| chat_memberships_provision_trg | `() RETURNS trigger` | chat_definer at fire time / any role inserting or activating memberships | none |
| chat_backfill_default_channels | `() RETURNS integer` | chat_definer / 0063 (SET ROLE) and ctx.owner in tests | none |

Pipelines (first failing check wins; chat-service runs the V-23 gate before every call):
- send: lock + kind -> actor, tenant, active member -> client_msg_id shape -> duplicate lookup -> post_policy (`admins_only`
  needs `chat.channel.post_restricted`; unknown policy -> CHAT_FORBIDDEN) -> body -> reply target -> 2 rate buckets -> INSERT
  (membership_id from the actor's active membership, `created_at := clock_timestamp()`) -> NOTIFY.
- edit: lock + kind -> member -> message `FOR UPDATE` in this channel (missing -> CHAT_FORBIDDEN) -> V-9 window rules ->
  expected count -> body -> identical (no-op) -> rate -> revision INSERT (`revision_no = edit_count + 1`, `previous_body` =
  old body) -> UPDATE body, edit_count, edited_at -> NOTIFY.
- delete: lock + kind -> member -> message `FOR UPDATE` (missing -> CHAT_FORBIDDEN) -> author + person -> already deleted
  (no-op) -> rate -> UPDATE author_deleted_at -> NOTIFY.
- moderate: lock + kind -> member + capability -> command id, action, reason, note (V-11) -> fingerprint -> receipt (replay:
  stored result; mismatch: CHAT_IDEMPOTENCY_MISMATCH) -> message `FOR UPDATE`, person-authored -> same state? -> rate ->
  UPDATE trio + audit INSERT (effective only) -> receipt INSERT -> NOTIFY (effective only).
- mark_read: lock + kind -> member -> through-message in channel -> guarded UPDATE of the caller's own row.
- list / get: kind -> actor, tenant, active member (list: CHAT_FORBIDDEN; get: zero rows) -> keyset page or the one row,
  projected with body NULL + tombstone (V-12, V-22).
- Ownership order in 0063: tables and grants (the chat_messages REVOKE, then the allowlist GRANT) -> CREATE FUNCTION
  (migration role) -> REVOKE ALL FROM PUBLIC -> GRANT EXECUTE to app (7 functions) -> CREATE TRIGGER while the trigger fn is
  still migration-owned -> one block `GRANT USAGE, CREATE ON SCHEMA public TO chat_definer`, `ALTER FUNCTION ... OWNER TO
  chat_definer` (all 10), `REVOKE CREATE` (pattern `0031:317-323`) -> backfill.

### 4.3 New tables (append-only, restricted)

- `chat_message_revisions (message_id uuid NOT NULL REFERENCES chat_messages(id), revision_no smallint NOT NULL,
  previous_body text NOT NULL, edited_by_person_id uuid NOT NULL REFERENCES persons(id), edited_at timestamptz NOT NULL
  DEFAULT statement_timestamp(), PRIMARY KEY (message_id, revision_no))`; revision_no 1..5 is guaranteed by the function
  under the message row lock; NO CHECK (any CHECK violation's DETAIL prints previous_body).
- `chat_moderation_audit (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, channel_id uuid NOT NULL,
  message_id uuid NOT NULL, actor_person_id uuid NOT NULL REFERENCES persons(id), action text NOT NULL, reason_code text NOT
  NULL, reason_note text, created_at timestamptz NOT NULL DEFAULT statement_timestamp())`, FKs `(channel_id, tenant_id) ->
  chat_channels(id, tenant_id)` and `(channel_id, message_id) -> chat_messages(channel_id, id)`, plus the spec's reason-note
  CHECK (tech 451-455): `CHECK ((reason_code = 'other' AND reason_note IS NOT NULL AND octet_length(reason_note) BETWEEN 1 AND
  500) OR (reason_code <> 'other' AND reason_note IS NULL))`, validated in the function first (V-11) so it never fires on the
  command path; action and reason_code validated in the function AND carrying the spec's closed-set CHECKs narrowed to the MVP,
  `CHECK (action IN ('hide','restore'))` and `CHECK (reason_code IN ('spam','harassment','unsafe','off_topic','other'))`
  (RO-S11-2, the conductor's recommendation of 2026-10-19 adopted: like the reason-note CHECK they never fire on the
  command path, they are fail-closed defence in depth, and the DETAIL-prints-the-row concern applies only to body-bearing
  tables; a later mute lane widens action by migration); the mute columns and the mute half of the spec's shape CHECK
  dropped (mutes are OUT, RO-L14-3).
- `chat_command_receipts`, the spec DDL verbatim (tech 462-474): `tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_person_id uuid NOT NULL REFERENCES persons(id), command_id uuid NOT NULL, action text NOT NULL CHECK (action IN
  ('channel.create','channel.rename','channel.set_default','channel.archive','message.hide','message.restore','member.mute')),
  canonical_fingerprint text NOT NULL, result_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY
  (tenant_id, actor_person_id, command_id)`; L14 writes only `message.hide` and `message.restore` (the other values stay as the
  spec has them, RO-L14-3); a CHECK DETAIL here prints only uuids, a hash and the ids/action/state json (V-26).
- All three: ENABLE + FORCE RLS; the two tables that carry tenant_id (chat_moderation_audit, chat_command_receipts) get one
  `tenant_isolation` policy in the `0060:50-55` shape and chat_message_revisions (no tenant_id) gets none (orchestrator
  ruling RO-S11-1, writer W1 STEP-1 S-2: rls-invariants.test.ts D-11 at :4791-4799 and :4808-4823 rejects a FORCE-RLS
  tenant_id table with no policy and admits no allowlist entry while FORCE stays; chat_definer is BYPASSRLS and no runtime
  role holds a grant, so the policy changes no reachability and adds tenant scoping if a grant ever appears); BEFORE UPDATE
  OR DELETE trigger raising `restrict_violation` (`0060:62-63` precedent); `REVOKE ALL ... FROM PUBLIC, app, app_worker,
  readonly`; chat_definer INSERT, SELECT only.

### 4.4 Grants before -> after

| Object | app | app_worker | chat_definer |
|---|---|---|---|
| chat_channels | SELECT -> SELECT | none -> none | SELECT -> SELECT + INSERT (tenant_id, kind, title, is_default, sort_order, creation_origin, post_policy, assistant_enabled) + UPDATE (archived_at), lock-only, never written |
| chat_members | SELECT -> SELECT | none -> none | SELECT -> SELECT + INSERT (channel_id, person_id, membership_id) + UPDATE (last_read_created_at, last_read_message_id, membership_id) |
| chat_messages | SELECT (table) -> table SELECT REVOKED first, then SELECT (id, channel_id, tenant_id, author_type, author_person_id, membership_id, reply_to_message_id, edited_at, edit_count, author_deleted_at, moderation_state, moderation_updated_at, client_msg_id, created_at), V-13 | none -> none | none -> SELECT + INSERT (channel_id, author_type, author_person_id, membership_id, body, reply_to_message_id, client_msg_id, created_at) + UPDATE (body, edited_at, edit_count, author_deleted_at, moderation_state, moderation_updated_at, moderation_actor_person_id, moderation_reason_code) |
| chat_message_revisions, chat_moderation_audit, chat_command_receipts (new) | none | none | INSERT, SELECT |
| memberships | unchanged | unchanged | SELECT (id, person_id, tenant_id, status), unchanged |
| tenant_capability_authorize(uuid, text, uuid) | EXECUTE, unchanged | none | none -> EXECUTE |
| rate_limit_check(text, integer, interval) | unchanged | unchanged | EXECUTE, unchanged |
| 5 command + 2 read functions (new) | EXECUTE (PUBLIC revoked) | none | owner |
| 3 internal functions (new) | none | none | owner |

Nobody gets UPDATE, DELETE or TRUNCATE on the three new tables. `dm_key` and both `created_by_*` columns are outside
chat_definer's INSERT list. readonly: no change anywhere (S-10). tenant_id on chat_members / chat_messages comes from the
BEFORE triggers (`0031:175-185`), so it is not in any INSERT list.

### 4.5 NOTIFY contract (L15 consumes it; the PR body states it verbatim)

- Channel `chat_realtime` (literal; distinct from `web_realtime` in apps/web/lib/realtime-listener.ts, which L14 does not
  touch); the divergence from tech 944 and its reason are V-5 (default applied, pending owner sign-off).
- Payload: the message id as text (36-character uuid) and nothing else: no channel id, tenant id, sender or text.
- Emitters: send (new row only), edit, delete, hide and restore (effective change only), via `PERFORM pg_notify('chat_realtime',
  v_id::text)` after the write in the same transaction: delivered only on commit, never on rollback. Never emitted by
  mark_read, provisioning, the backfill or the read functions; never for a duplicate replay, a no-op edit, an already-deleted
  delete, an already-hidden hide, an already-visible restore, an exact receipt replay or a receipt mismatch.
- Consumer rule: a payload is a hint. L15 re-reads it through `chat_get_message` as each subscriber (app role, that
  subscriber's `app.tenant_id` + `app.person_id`, behind the V-23 gate); a foreign or unreadable id yields zero rows.
- The PR body also states, as the contract L15 consumes: the read function signatures and tombstone kinds (4.2, V-22), the
  moderation command id and fingerprint rules (V-26) and every error code with its status (4.6).

### 4.6 api-contract codes (R10; verbatim from tech 1296-1326)

CHAT_FORBIDDEN 403 (1300), CHAT_DUP_MESSAGE 200-safe (1301), CHAT_MESSAGE_TOO_LARGE 413 (1302), CHAT_RATE_LIMITED 429 (1303),
CHAT_SAFETY_BLOCKED 403 (1304), CHAT_CAPABILITY_REQUIRED 403 (1308), CHAT_IDEMPOTENCY_MISMATCH 409 (1310; the cross-author
client_msg_id of V-3 and the receipt mismatch of V-26), CHAT_REPLY_INVALID 409 (1317), CHAT_EDIT_WINDOW_CLOSED 409 (1321),
CHAT_EDIT_CONFLICT 409 (1322), CHAT_REASON_INVALID 422 (1323), CHAT_MODERATION_FORBIDDEN 403 (1325). Reused: INVALID_BODY 400
(`api-contract.ts:123`), NOT_FOUND (`:139`), TENANT_SUSPENDED (`:159`, the V-23 gate, existing entry unchanged). No other code.

### 4.7 DM unreachable (argument)

1. Every command and read function reads the channel kind first and raises CHAT_SAFETY_BLOCKED (moderation:
   CHAT_MODERATION_FORBIDDEN; get: zero rows) when `kind <> 'club'`: unconditional, before membership, capability, receipt or
   flags. No function calls `assert_dm_allowed`, so flipping all four dm_safety flags opens nothing.
2. No dm channel can be created: chat_definer's INSERT list omits `dm_key`, the only channel INSERT hard-codes `'club'`, and the
   shape CHECK requires `dm_key` for `'dm'` (`0031:79-84`).
3. No dm member: the only member INSERT supplies `membership_id`; `chat_bind_tenant` sets tenant_id NULL for a dm channel and
   the pair CHECK (`0031:114-116`) rejects the row.
4. No dm message: leg 1 + leg 2 + app has no INSERT (`0031:353`).
5. Reads: the dm RLS policies deny while the flags are off (`0031:302-315, :330-331`); the read functions raise or return zero rows.

### 4.8 chat-service.ts

`withChatActor(tenantId, personId, fn)` = withTenant + `set_config('app.person_id', personId, true)` after a TS uuid check:
the only setter of `app.person_id`. Inside it `authorizeTenantAction(tx, tenantId, 'admin_mutation')` runs first and a
denial throws `ChatCommandError('TENANT_SUSPENDED')` before any definer call (V-23). Exports sendChatMessage,
editChatMessage, deleteChatMessage, moderateChatMessage (takes `commandId`), markChatRead, listChatMessages, getChatMessage:
one definer call each, typed results, `ChatCommandError(code)` from the V-19 allowlist, any other error rethrown sanitized
(V-19). A duplicate send returns `{ message, duplicate: true }` (outcome CHAT_DUP_MESSAGE); a moderation replay returns the
stored result.

## 5. DECISION TABLE and TEST MAP (one case per row, as the app role, real DB; file `packages/db/src/chat-service.test.ts` unless stated)

| id | condition -> outcome | test name |
|---|---|---|
| DT-1 | not an active member, no chat_members row, wrong tenant GUC, unknown channel, missing app.person_id -> CHAT_FORBIDDEN 403, 0 writes | DT-1 non-member send, read and mark-read are CHAT_FORBIDDEN |
| DT-2 | `admins_only` without `chat.channel.post_restricted` (or authorize false/unknown) -> CHAT_CAPABILITY_REQUIRED 403 | DT-2 admins_only channel requires post_restricted, fail closed |
| DT-3 | same client_msg_id, same author -> original returned, duplicate = true, 1 row, 0 extra NOTIFY, no token (also at the rate limit, and with a different body) | DT-3 duplicate client_msg_id returns the original |
| DT-4 | same client_msg_id, other author -> CHAT_IDEMPOTENCY_MISMATCH 409, generic (no id, body, author or timestamp in result or error), original intact | DT-4 another author's client_msg_id is IDEMPOTENCY_MISMATCH |
| DT-5 | body 4001 code points (send, edit) -> CHAT_MESSAGE_TOO_LARGE 413; 4000 (also emoji) ok | DT-5 body cap 4000 code points |
| DT-6 | body NULL, '', whitespace; client_msg_id NULL, '', 65 chars -> INVALID_BODY 400 | DT-6 empty body and bad client_msg_id are INVALID_BODY |
| DT-7 | reply target missing, other channel, hidden, author-deleted -> CHAT_REPLY_INVALID 409, 0 rows | DT-7 invalid reply target |
| DT-8 | edit by non-author, on assistant/system, at 15 min (backdated), 6th edit, on own deleted or hidden -> CHAT_EDIT_WINDOW_CLOSED 409 | DT-8 edit window closed cases |
| DT-9 | stale expectedEditCount -> CHAT_EDIT_CONFLICT 409, revisions unchanged | DT-9 stale expected edit count |
| DT-10 | accepted edit -> 1 revision with the old body, 1 NOTIFY; identical body -> changed = false, 0 revisions, 0 NOTIFY | DT-10 edit appends a revision once |
| DT-11 | author delete -> author_deleted_at set, 1 NOTIFY; repeat -> changed = false, 0 NOTIFY; app has no DELETE | DT-11 author soft-delete is idempotent |
| DT-12 | delete by non-author, of non-person message, by former member -> CHAT_FORBIDDEN 403 | DT-12 delete forbidden cases |
| DT-13 | hide/restore without `chat.message.moderate`, by non-member, on DM, on assistant/system -> CHAT_MODERATION_FORBIDDEN 403, same for a real and a random id, 0 audit rows, 0 receipts | DT-13 moderation forbidden is generic |
| DT-14 | bad reason, `other` without note or note outside 1..500 bytes, note with non-other -> CHAT_REASON_INVALID 422; NULL command id or action outside hide\|restore -> INVALID_BODY 400; 0 audit rows, 0 receipts | DT-14 reason and command validation |
| DT-15 | new command id: hide when hidden, restore when visible -> changed = false, 0 audit, 0 NOTIFY, 1 receipt with changed = false | DT-15 moderation no-op |
| DT-16 | effective hide/restore -> trio set/NULLed, 1 audit row, 1 receipt, 1 NOTIFY; delete + hide + restore keeps tombstone author_deleted | DT-16 moderation writes one audit row |
| DT-17 | send, edit, delete, mark read, list on `kind = 'dm'` (flags false and all four flipped true) -> CHAT_SAFETY_BLOCKED, get -> zero rows, 0 writes, 0 NOTIFY; `INSERT (dm_key)` as chat_definer -> permission denied | DT-17 DM unreachable |
| DT-18 | 21st send in 10 s, 301st in 1 min -> CHAT_RATE_LIMITED 429; replays never count | DT-18 send rate limits |
| DT-19 | 31st edit or delete in 1 min per person and channel -> CHAT_RATE_LIMITED 429; no-ops never count | DT-19 edit and delete rate limit |
| DT-20 | mark read forward ok, backward unchanged, other's cursor untouched, non-member CHAT_FORBIDDEN, foreign through-message NOT_FOUND, 0 NOTIFY | DT-20 read cursor moves forward only |
| DT-21 | list/get return body NULL + tombstone (author_deleted precedence over moderation_hidden) for a hidden and an author-deleted message, for the author, a moderator and other members; no moderation_state, actor, reason, revision or audit column in the result | DT-21 tombstone read through the read functions |
| DT-22 | activation provisions exactly 1 default channel (assistant_enabled false, system_bootstrap, V-14) + 1 row per active member, retry-safe, rolled back with the activation (section 6) | DT-22 activation provisioning per path |
| DT-23 | backfill twice: 1 channel per tenant with an active member, 1 row per active member, none for guest/left, system_bootstrap | DT-23 backfill idempotent |
| DT-24 | LISTEN as app: exactly one id-only payload per committed change, none for rollback or no-op (send 1, dup 0, edit 1, stale 0, delete 1, re-delete 0, hide 1, re-hide 0, restore 1, re-restore 0, receipt replay 0, receipt mismatch 0, failing send 0) | DT-24 NOTIFY contract |
| DT-25 | at most 3 concurrent sends: ORDER BY (created_at, id) is a total order with no gap or duplicate | DT-25 concurrent sends keep order |
| DT-26 | sentinel body and note never in console spies or payloads; static scan: every pg_notify is ('chat_realtime', <id>::text), no RAISE interpolates text, no log call in chat-service.ts carries a body or a note, no rate bucket key carries text | DT-26 no chat text in logs or NOTIFY |
| DT-27 | catalog: chat_definer exists, owns the 10 functions, prosecdef, search_path pinned, read functions STABLE; EXECUTE held by exactly chat_definer and app on the 7 public functions and by no one but the owner on the 3 internal ones (A-12/A-13 pattern, F-18); grants exactly 4.4, incl. the 14-column app allowlist and no app privilege on the three new tables; audit reason-note, action and reason_code CHECKs present (a direct INSERT of another action or reason_code fails with check_violation as chat_definer, RO-S11-2), no CHECK on chat_message_revisions; FORCE RLS on the three new tables with exactly one `tenant_isolation` policy on chat_moderation_audit and on chat_command_receipts and none on chat_message_revisions (RO-S11-1); receipts columns, CHECK and PK as tech 462-474; trigger `AFTER INSERT OR UPDATE OF status ... WHEN (NEW.status = 'active')` on memberships; codes in `packages/core/src/api-contract.test.ts` | DT-27 catalog and grants |
| DT-28 | same command id + same fingerprint (also after the actor's later commands) -> the stored result; 0 mutation, 0 second audit row, 0 second receipt, 0 NOTIFY, no rate token | DT-28 moderation receipt exact replay |
| DT-29 | same command id with a different action, message, reason code or note -> CHAT_IDEMPOTENCY_MISMATCH 409; trio, audit and receipts unchanged, 0 NOTIFY | DT-29 moderation receipt mismatch mutates nothing |
| DT-30 | hide X (c1), restore X (c2), replay c1 -> c1's stored result, X stays visible, 0 audit, 0 NOTIFY; same with a same-state command (c3 hide while hidden, then restore, then replay c3: X stays visible) | DT-30 stale moderation replay does not re-apply |
| DT-31 | as app: `SELECT body`, `SELECT search_document`, `SELECT moderation_actor_person_id`, `SELECT moderation_reason_code` FROM chat_messages -> insufficient_privilege (42501); the 14 allowlist columns readable under RLS; any SELECT on chat_message_revisions, chat_moderation_audit, chat_command_receipts -> 42501 | DT-31 app column allowlist and no content column |
| DT-32 | list/get as a non-member, as a cross-tenant caller (foreign app.tenant_id) and with app.person_id or app.tenant_id unset -> list CHAT_FORBIDDEN, get zero rows; nothing returned | DT-32 read functions return nothing to non-members and other tenants |
| DT-33 | a re-join (a new active membership row after a left one) restores chat on the SAME chat_members row (membership_id re-pointed, last_read_* preserved); the left membership grants nothing (no row points at it after the re-join, chat_current_is_member ignores it) | DT-33 re-join restores chat on the same row |
| DT-34 | an UPDATE OF status that leaves an active membership active, and a re-run of the provisioning core for the same membership, write nothing (chat_members xmin and row count, channel count unchanged) | DT-34 provisioning replay writes nothing |
| DT-35 | a person whose only membership is left: send, list, get, mark read -> CHAT_FORBIDDEN or zero rows; no provisioning on the left status | DT-35 left-only person stays locked out |
| DT-36 | a unique violation provoked on the send path (e.g. a temporary unique index over (channel_id, body) added and dropped on the private DB, so the driver DETAIL holds the sentinel) -> the error chat-service throws (message, detail, hint, where, cause) and every console spy carry no body | DT-36 unique violation on send leaks no body |
| DT-37 | a NOT NULL violation provoked on the send path (e.g. a temporary NOT NULL column whose default is dropped, so DETAIL "Failing row contains (...)" holds the sentinel) -> same assertion as DT-36 | DT-37 NOT NULL violation on send leaks no body |
| DT-38 | 31st newly accepted moderation command (hide or restore, effective or same-state) in 1 min per actor and tenant -> CHAT_RATE_LIMITED 429; exact replays never count | DT-38 moderation rate limit |
| DT-39 | tenant suspended (set by ctx.owner) -> every chat-service write and read -> TENANT_SUSPENDED, no definer call, 0 writes, 0 NOTIFY; an active tenant passes | DT-39 suspended tenant chat is frozen |

## 6. ACTIVATION PATH TABLE (every test COMMITS: the deferred `trg_chat_dm_two_*` triggers fire at commit as the outer role, F-5)

| Path | Entry -> INSERT | Role at INSERT | Status | Same-transaction proof | Covered by | Test |
|---|---|---|---|---|---|---|
| a club creation | route.ts:87-94 -> auth.ts:197-209 -> 0037:148-149 | tenant_provision definer, called by app | active | one autocommit statement (auth.ts:202), EXCEPTION re-raise 0037:166-168 | trigger | provisionTenant via ctx.appPool commits: owner has 1 channel + 1 row; same-owner re-submit adds none |
| b host-add by name | roster-service.ts:127-132 -> :181 -> :120-123 | app in withTenant (:132) | active | :121 -> seatPlayer :192 -> emit :202 -> recordCommand :219 | trigger | commit: 1 row; same commandId replay adds none; seatPlayer derivation failure (roster-service.ts:256-271) leaves 0 membership and 0 chat rows |
| b2 host-add by membershipId | roster-service.ts:94-107 (read only) | app | existing | n/a | n/a | covered by b |
| c self-join | session-join-service.ts:209-211 -> :305 -> 0058:78-81 | definer, called by app | guest | joinSession tx | none by design (0031:290) | commit: guest has no chat row |
| d promotion / seatPlayer | roster-service.ts:240-304 | app | no memberships write | n/a | n/a | existing suites green, zero edits |
| e approved join request | join-request-service.ts:302-307 -> :352 -> 0058:78-81 | definer, called by app | guest | approve tx | none by design | commit: approved visitor has no chat row |
| f1 dev seed | dev-seed-club-members.ts:42-49 | withTenant (S-7) | active | withTenant tx | trigger | none (dev script) |
| f3 existing data | 0063 backfill | chat_definer (SET ROLE) | active | migration tx | backfill | DT-23 |
| g status flip to active | no production writer at the base (F-14); ctx.owner `UPDATE memberships SET status = 'active'` from guest or left | superuser | active | explicit tx | trigger (UPDATE arm) | flip provisions 1 row per channel (re-pointed on a re-join, DT-33); a rolled-back flip leaves 0; active-to-active writes nothing (DT-34) |
| generic | ctx.owner BEGIN; INSERT active; ROLLBACK | superuser | active | explicit tx | trigger | row visible in-tx, zero after ROLLBACK; committed twin has 1 channel + 1 row; two concurrent first activations give 1 channel, 2 rows |
| f4 fixtures | 24 test files (part C list) | superuser | mostly active | per statement | trigger (side-effect rows) | V-25 |

## 7. Risks

- K-1 deferred triggers at commit (F-5): the committing role needs SELECT on chat_channels; a future app_worker activation path
  fails at commit (none at the base, O-4). Every activation test commits.
- K-2 FK with no delete action (F-10): a membership DELETE after provisioning fails; no non-test code deletes or UPDATEs
  memberships (F-14); the FK stays NO ACTION (RO-L14-4); a production delete path would be a STOP and report, never a test edit.
- K-3 CHECK / NOT NULL DETAIL leaks (F-13): every CHECK-backed rule pre-validated, no CHECK on a body table added, the audit
  note CHECK is validated first, chat-service rethrows driver errors sanitized (V-19, DT-36, DT-37).
- K-4 no `app.person_id` setter at the base (F-8): every function and the read policies fail closed until withChatActor sets it.
- K-5 the channel is database-wide: any LISTENing session sees message ids (activity timing only, threat model d).
- K-6 a trigger error aborts the activation (fail closed); the roster, join and auth suites are the net.
- K-7 the column narrowing breaks any app-role `SELECT *` or `SELECT body` on chat_messages (S-1); no non-test reader (F-14).
- K-8 the suspension gate is TS-side (V-23): a caller that skips chat-service is the trusted web process of section 0.
- K-9 receipts never expire: a client that reuses a command id for a different action gets CHAT_IDEMPOTENCY_MISMATCH by design.

## 8. Writer STEP-1 CHECKS (run in W before code; a result that contradicts a pin => stop and report to the orchestrator)

| # | UNVERIFIED item | Command |
|---|---|---|
| S-1 | app-role reads of chat_messages body / search_document / * in existing tests (K-7) | `grep -n -E "chat_messages\|search_document\|body" packages/db/src/chat-schema-invariants.test.ts packages/db/src/chat-dm-safety-invariants.test.ts` |
| S-2 | rls-invariants requirements the three new tables (two carry tenant_id, none has a policy) would trip (B U-6) | `grep -n -E "relforcerowsecurity\|relrowsecurity\|pg_policies\|tenant_id\|exempt" packages/db/src/rls-invariants.test.ts` |
| S-3 | default privileges auto-granting new tables (B U-3) | `grep -rn "DEFAULT PRIVILEGES" packages/db/migrations infra/postgres-init` |
| S-4 | memberships FORCE RLS and policy (C U1) | `grep -n memberships packages/db/migrations/0009_rls_policies_grants.sql` |
| S-5 | at most one live membership per (tenant, person) (V-15) | `grep -rn -E "UNIQUE INDEX.*memberships\|memberships_.*uq" packages/db/migrations` |
| S-6 | CREATE TRIGGER before ALTER OWNER under the non-superuser owner migrate (C U5) | `NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db exec vitest run src/migrate.test.ts 2>&1 \| tail -40` |
| S-7 | dev seed DB URL and role (C U6) | `sed -n '1,41p' packages/db/scripts/dev-seed-club-members.ts` |
| S-8 | exported fixture helpers (C U7) | `grep -n "^export" packages/db/src/roster-money-fixtures.ts` |
| S-9 | `SELECT 1` on the listener flushes committed notifications (C U8) | first DT-24 run; else a bounded poll (at most 2 s), never a fixed sleep |
| S-10 | readonly has no chat privilege | DT-27 catalog assertion `has_table_privilege('readonly', ...)` |
| S-11 | code spellings | `sed -n '1296,1326p' docs/features/BE/feature_inapp_chat_tech.md` |
| S-12 | `chat_channels_default_uq` predicate for the V-15 ON CONFLICT target | `sed -n '98,101p' packages/db/migrations/0031_chat_schema_core.sql` |
| S-13 | rate_limit_check signature | `grep -n "FUNCTION rate_limit_check" packages/db/migrations/0046_rate_limit_bounded_cleanup.sql` |
| S-14 | which membership-deleting test files fail with 0063 (RO-L14-4) | full `pnpm -w test` run; edit only the files it names |
| S-15 | the existing authorizeTenantAction call pattern (inside withTenant, before the write) for V-23 | `grep -rn "authorizeTenantAction(" packages/db/src` |
| S-16 | tenant and subscription status literals the DT-39 fixture sets | `sed -n '100,200p' packages/db/src/authorization.ts` |

## 9. B3 exception (RO-L14-1: GRANTED; replaces part D's R13)

- Modules, exactly three: packages/db/migrations (0063 only); packages/db/src + schema mirror (chat-service.ts, index.ts,
  schema.ts, db.dbml); packages/core (api-contract.ts + its test). RO-L14-4 test-only files ride along (section 2).
- Why a split breaks coherence: the trigger provisions the rows every command authorizes against; the column narrowing must land
  with the read functions (otherwise L15/L16 lose the body with no replacement, or members can read hidden bodies and who hid
  them as soon as moderation writes); the receipt is written in the same transaction as the moderation mutation and its audit
  row; NOTIFY must ship in the same writers because L15 has no migration (A2 note 28); a second migration breaks the
  one-migration rule; chat-service and the codes are the only typed caller. The only sanctioned split is the L14b fallback.
- Compatibility proof: additive (3 tables, 10 functions, 1 trigger); app loses table-level SELECT on chat_messages and keeps
  the 14 non-content columns, so it loses only body, search_document and the two moderation evidence columns, which no non-test
  code reads (F-14; S-1 for tests); L8/L11 TS untouched (zero-diff list, section 2); existing suites green with only the
  RO-L14-4 edits; rollback = code revert, the append-only 0063 objects stay unused.
- Estimate (non-test LOC / test LOC), updated for the receipts (RO-L14-3), the read-path hardening (RO-L14-2) and Amendment 1:
  0063 = 900 / 0 (part D 800 + about 60 for the receipts table, fingerprint and replay path + about 25 for the REVOKE,
  allowlist GRANT and read-function gates + about 15 for the trigger UPDATE arm, the moderation bucket and the audit note
  CHECK); chat-service.ts = 270 / 0 (+30: suspension gate, commandId, sanitized rethrow); index.ts = 4; schema.ts = 100 (+20
  receipts mirror); db.dbml = 50 (+10); api-contract.ts = 20; chat-service.test.ts = 0 / 1400 (+200 for DT-28..DT-39);
  api-contract.test.ts = 0 / 20; chat-schema-invariants.test.ts = 0 / 20; conditional RO-L14-4 files = 0 / 20. Totals:
  non-test 1344, test-class 1460, total 2804, files 9 plus at most 3 conditional test-only (this readiness file excluded).
- Caps (added + deleted lines of `git diff --numstat f17f52ad824de3e548eab25a3c2949b6fa280cd6..HEAD`, this file excluded):
  non-test <= 1500, reported to the conductor above 1400 before continuing, above 1500 STOP (fallback L14b: moderation, i.e.
  hide/restore, audit and receipts, cut into a following migration lane under a new conductor brief; never a higher cap);
  test-class 2600 and total 4100 reported against the section 5 rows, not a stop; files <= 17 plus at most 3 test-only edits;
  migrations = 1. The final counts and this ruling go in the PR body and the report.
- RO-L14-1: B3 GRANTED; modules exactly three; non-test cap 1500 with the 1400 report checkpoint and the L14b fallback above
  1500 (moderation cut out, never a higher cap); test-class 2600 and total 4100 reported, not a stop; files 17 plus at most 3
  test-only edits; area-split review rounds A (send, edit, delete, revisions, NOTIFY) / B (moderation, audit, receipts) /
  C (trigger, backfill, RLS, grants, read functions) / D (TS service, codes, tests) from round 1; one section per writer
  worker with a commit after each.

## 10. Implementation steps (RO-L14-1: one section per writer worker, commit after each; test-first inside each)

1. W1 tables and grants: its STEP-1 checks (S-2, S-3, S-4, S-10, S-12); DT-27 (tables, grants, CHECK presence) and DT-31 red;
   0063 tables (3), RLS, append-only triggers, 4.4 grants incl. the REVOKE then the allowlist GRANT; commit.
2. W2 trigger and backfill: S-5, S-6, S-7, S-8; DT-22, DT-23, DT-33..DT-35 and section 6 red; provisioning core (V-15),
   trigger (V-16), backfill (V-17); the V-25 seed edit; commit.
3. W3 command functions: S-9, S-11, S-13; send + mark_read (DT-1..DT-7, DT-17, DT-18, DT-20, DT-24, DT-25), edit + delete
   (DT-8..DT-12, DT-19), moderate with receipts (DT-13..DT-16, DT-28..DT-30, DT-38), the definers called as app with the GUCs
   set; commit (one commit per function group if the worker reaches the token rule).
4. W4 read functions: DT-21, DT-32, the read legs of DT-1 and DT-17 and the read part of DT-27 red; chat_list_messages,
   chat_get_message; commit.
5. W5 TS service: S-1, S-15, S-16; chat-service.ts (withChatActor, V-23 gate, V-19 allowlist and sanitized rethrow), index.ts,
   api-contract codes + test, schema.ts + db.dbml; DT-26, DT-36, DT-37, DT-39; commit.
6. W6 tests: the remaining rows, the measured B3 counts against section 9, full S1 VERIFY; S-14 conditional RO-L14-4 edits
   only; commit. A 0063 edited after it ran needs a fresh suite DB; never apply it to plexco or plexco_smoke.

## 11. Verification and review plan

- `pnpm db:bootstrap` (superuser DATABASE_URL_MIGRATION) first; then pnpm typecheck; pnpm lint; pnpm format:check;
  pnpm review:check:changed; pnpm build; `NODE_ENV=test pnpm --filter @plexco/web test`;
  `NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test` (one migration at a time, DB lock);
  `NODE_ENV=test DATABASE_URL_TEST=... pnpm -w test`; every output through `| tail -40`. No Playwright (no UI change).
- chat-service.test.ts uses `setupRlsTestContext("plexco_chat_service_check")` and nothing else from the lock family (part C
  QC3); a non-superuser proof is a catalog assertion, never a new lock site.
- Review (opus/max + opus/max security, at most 3 rounds; RO-L14-1 area split from round 1, one fresh reviewer worker per area:
  A send, edit, delete, revision store, NOTIFY; B moderation, audit, receipts; C provisioning trigger, backfill, RLS, grants,
  read functions; D chat-service TS, codes, tests; the last round covers the whole migration at the final head with each
  area's not-reached list; the security round uses the same areas). Questions: definer privilege and search_path; capability
  bypass (unknown, raise, NULL); cross-tenant read through any function or column; DM reachable through any function; audit,
  revision and receipt tamper; receipt fingerprint, replay and mismatch order; hidden body reachable through a column,
  search_document, a revision, a reply or a read-function column; the REVOKE-then-allowlist order; NOTIFY payload content;
  the suspension gate; error text on driver errors; lock order and rate-token consumption on replay and no-op.

## 12. OPEN (all OUT_OF_SCOPE for this lane; none blocks it)

- O-1, O-2, O-3 and O-5 of part D are resolved inside L14 (V-8 moderation bucket, V-26 receipts, V-16 UPDATE arm, V-23
  suspension gate).
- O-4 an app_worker activation path needs SELECT on chat_channels or must run as app (K-1).
- O-6 tech 944 / 1380 per-channel NOTIFY prose vs `chat_realtime`: a docs reconcile lane.
- O-7 L17 consolidates V-1..V-26 and the RO-L14 defaults (including the NOTIFY naming divergence and the read-grant narrowing,
  ruling "Outside L14") into ONE decisions.md entry; this lane only repeats them in its PR body.
- O-8 a dedicated chat ActionClass or a read-tolerant suspension posture needs an authorization.ts change (owner; V-23 uses
  admin_mutation for writes and reads).

## 13. Closure matrix (12/12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = W HEAD = session base f17f52ad824de3e548eab25a3c2949b6fa280cd6; TARGET_FILES exist at the base; new files are section 2 scope | PASS |
| 2 | Decisions in scope final | D4 signed (dec 1786); DD-136, DD-86, DD-55 bound; R1-R13 as amended by conductor rulings RO-L14-1..5 and Amendment 1 (section 1a); V-1..V-26 pinned pending owner sign-off | PASS |
| 3 | Scope IN/OUT and owner clear | section 2; one writer worker per section in the lane worktree | PASS |
| 4 | Dependencies classified | L8 #68 merged at the base; chat_definer bootstrap present; no owner wait | PASS |
| 5 | Live schema and code match | section 3 facts with path:line, F-14..F-18 added by part E; next free migration 0063 | PASS |
| 6 | Data, API, state, auth contract | sections 4.1-4.8 | PASS |
| 7 | Fail-closed, idempotency, order | V-3, V-6, V-7, V-9..V-11, V-19, V-22, V-23, V-26; capability unknown = deny; per-channel lock first; receipts checked before any mutation; replays and no-ops write no message, audit or NOTIFY | PASS |
| 8 | Open questions in scope = 0 | section 4.1 pins; section 12 items are out of scope | PASS |
| 9 | Acceptance matrix with expected results | section 5 DT-1..DT-39 cover every lane DECISION TABLE row, TESTS item and ruling test; section 6 per path | PASS |
| 10 | Migration, security, rollback | one additive migration; definers with a fixed search_path; grants table 4.4 (REVOKE then allowlist); DM argument 4.7; HARD RULES 1-5 held; threat model section 0; rollback = code revert | PASS |
| 11 | First slice hard dependencies merged | L8 #68 merged at f17f52ad824de3e548eab25a3c2949b6fa280cd6; step 1 depends on nothing unmerged | PASS |
| 12 | Implementation handoff ready | sections 4-11; B3 GRANTED section 9 (RO-L14-1); lane worktree clean at the base | PASS |

## 14. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-19
AUTHORITY_SHA: f17f52ad824de3e548eab25a3c2949b6fa280cd6
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/standards/review-code-readiness-gate.md
  - docs/features/FE/feature_inapp_chat.md
  - docs/features/BE/feature_inapp_chat_tech.md
  - infra/postgres-init/02-chat-definer.sql
  - packages/db/migrations/0009_rls_policies_grants.sql
  - packages/db/migrations/0030_chat_dm_safety_authority_core.sql
  - packages/db/migrations/0031_chat_schema_core.sql
  - packages/db/migrations/0032_chat_dm_safety_config_single_read.sql
  - packages/db/migrations/0037_tenant_provision_rls_self_scope.sql
  - packages/db/migrations/0046_rate_limit_bounded_cleanup.sql
  - packages/db/migrations/0047_tenant_capability_authority_core.sql
  - packages/db/migrations/0049_tenant_capability_authorize.sql
  - packages/db/migrations/0051_host_add_person_definer.sql
  - packages/db/migrations/0056_outbox_projector_registry_dlq_replay.sql
  - packages/db/migrations/0058_player_self_join.sql
  - packages/db/migrations/0060_tenant_public_alias.sql
  - packages/db/migrations/0062_gender_pricing.sql
  - packages/db/schema.ts
  - packages/db/db.dbml
  - packages/db/src/index.ts
  - packages/db/src/authorization.ts
  - packages/db/src/capability.ts
  - packages/db/src/tenant.ts
  - packages/db/src/auth.ts
  - packages/db/src/roster-service.ts
  - packages/db/src/session-join-service.ts
  - packages/db/src/join-request-service.ts
  - packages/db/src/test-harness.ts
  - packages/db/src/me-player-reads.test.ts
  - packages/db/src/chat-schema-invariants.test.ts
  - packages/db/src/chat-dm-safety-invariants.test.ts
  - packages/db/src/rls-invariants.test.ts
  - packages/db/src/identity-link-web.test.ts
  - packages/db/src/identity-link-web-nobypass.test.ts
  - packages/db/scripts/dev-seed-club-members.ts
  - packages/core/src/api-contract.ts
  - packages/core/src/api-contract.test.ts
  - apps/web/app/api/onboarding/start/route.ts
  - apps/web/lib/session-guest-note-route-db.test.ts
  - apps/web/lib/realtime-listener.ts
SLICE: p3-m10-chat-core
IN_SCOPE: DD-136 club chat command core in one migration: NEW packages/db/migrations/0063_chat_message_commands.sql (chat_message_revisions, chat_moderation_audit and chat_command_receipts append-only tables, the chat_definer send, edit, delete, receipt-checked moderate, mark_read and two tombstone-safe read definers, the memberships AFTER INSERT OR UPDATE OF status provisioning trigger with its re-join upsert core and idempotent system_bootstrap backfill, the chat_realtime id-only NOTIFY, the section 4.4 grants including the REVOKE then column allowlist for app on chat_messages); NEW packages/db/src/chat-service.ts (authorizeTenantAction gate) and its test; packages/db/src/index.ts; packages/db/schema.ts and packages/db/db.dbml; the 12 codes in packages/core/src/api-contract.ts and its test; the RO-L14-4 test-only edits; all under the RO-L14-1 B3 caps
OUT_OF_SCOPE: HTTP routes and UI (L15, L16); DM (flags stay false, no assert_dm_allowed call); media, reactions, search, mentions, mutes, group, pin, poll, nickname, slash commands, digest, push, email; channel lifecycle commands and every receipts action other than message.hide and message.restore; chat text in any log, NOTIFY payload or public surface; Zalo or Messenger bridge; the Assistant; outbox events, web_realtime rows, listeners; any change to roster-service.ts, session-join-service.ts, join-request-service.ts, auth.ts, authorization.ts, capability.ts, 0037, 0051 or 0058; edits to docs/standards/decisions.md or Reviewed specs; the section 12 OPEN items
G1_DECISION: PASS # D4 signed (decisions.md:1786); DD-136, DD-86, DD-55 bound; R1-R13 as amended by conductor rulings RO-L14-1..5 and Amendment 1 (section 1a); V-1..V-26 pinned as defaults pending owner sign-off
G2_SPEC: PASS # inapp chat tech doc and FE spec measured by part B; functions, tables, receipts, grants, NOTIFY, codes and the DM argument pinned (section 4)
G3_DEPENDENCY: PASS # L8 #68 merged at the base; chat_definer bootstrap present; no owner wait
G4_TEST: PASS # DT-1..DT-39 one case per row as the app role, section 6 per activation path with committing tests, steps test-first (sections 5, 6, 10)
G5_SCOPE: PASS # one migration 0063; 3 modules; B3 GRANTED by RO-L14-1 (non-test <= 1500 with a 1400 report checkpoint and the L14b fallback, files <= 17 plus 3 test-only, migrations = 1; estimate 1344 non-test); NEGATIVE SCOPE held
G6_EXTERNAL: PASS # local only: no provider, no secret, no bridge; the dispatch cycle is untouched
HARD_DEPENDENCIES: L8 p3-m9-join-core #68 merged at f17f52ad824de3e548eab25a3c2949b6fa280cd6 (probe 0058_player_self_join.sql); D4 signed (decisions.md:1786)
PRIOR_SLICES: L8 p3-m9-join-core (#68); L11 p3-m9-gender-pricing (#76, migration 0062); L12 (#77)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # one additive migration; SECURITY DEFINER with a fixed search_path; EXECUTE to app on 7 functions only, PUBLIC revoked; no app grant on the three new tables and nothing to anyone on their UPDATE or DELETE; app table SELECT on chat_messages revoked, 14-column allowlist granted; tombstone enforced by the allowlist plus the read definers; moderation receipts checked before any mutation; DM unreachable by an unconditional kind check; opus/max reviewer + opus/max security round, area-split
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: section 10 W1 (its STEP-1 checks, then tables and grants test-first) in .autopilot/worktrees/p3-m10-chat-core at f17f52ad824de3e548eab25a3c2949b6fa280cd6, then W2-W6 with one commit per worker
REMAINING_BLOCKERS: none
```
