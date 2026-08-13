<!-- review-readiness: enforce -->

# chat-shared-message-command-core — task contract

> **Slice:** `chat-shared-message-command-core` (slug = mechanism: primary-plan catalog slice **7** —
> the sole `send_chat_message` / history-list / `mark_read` command boundary for club+DM channels,
> atomic reply + structured-mention insert, idempotent, read-only mute/DM-safety consumption, leading-
> slash pre-insert fence).
> **Risk:** P1 · **Change class:** schema (new SECURITY DEFINER RPCs + grants) · **Autonomy:** supervised.
> **Opened from:** `docs/autopilot-templates/next-lanes-2026-08-13-RUN.md` lane C7, after DD-102's hard
> condition closed (`0032_chat_dm_safety_config_single_read` merged `main@80a3464`, decisions.md v2.25).
> **Authored:** 2026-08-13 against `origin/main` @ `32b7d47b13572a7ce77617aaf45150fa17aaf3e6` (= HEAD,
> verified clean — 2 pre-existing untracked `.pen` files unrelated to this packet).
> **Manifest:** `docs/autopilot-manifests/chat-shared-message-command-core.json`.
> **Verdict:** `NOT_CODE_READY` — five named blockers (§7). B1–B4 are unmet catalog hard dependencies
> (slices 4/5/6/9 — three of which have **no backlog task at all yet**, not merely an unmerged one).
> B5 is a spec-integrity defect independently discovered while authoring this packet: un-ratified
> product scope (session-embed, group chat, pins, polls, nicknames) sits inside the "✅ Reviewed
> contract" BE/FE chat specs, directly on the exact `chat_messages` table and `send_chat_message`
> endpoint this slice owns. This is an `enforce` evidence artifact, **not** a coding handoff. Do not
> register or open a worktree from it.

## 0. Task contract (level3-workflow §3)

```text
TASK_ID: plexco:chat-shared-message-command-core
OUTCOME (target): send_chat_message and mark_read exist as the SOLE write / read-cursor RPCs for chat
  messages across club + DM channels: dedup by (channel_id, client_msg_id) under an idempotency lock,
  resolve club active-membership + active-mute OR DM block/safety gate, validate a same-channel visible
  reply target, consume structured mention targets through the slice-9 opaque-ref consume-time resolver,
  apply the admins_only chat.channel.post_restricted capability gate, insert message + mention rows
  atomically, emit pg NOTIFY chat_<channel> (message id only, no PII), and enforce a leading-slash
  pre-insert fence so any registered-slash input is rejected before it ever becomes a stored message.
  mark_read advances the canonical (created_at,id) read cursor under the same gates for the 'read'
  action. Direct DML on chat_channels/chat_members/chat_messages stays revoked from role `app`; this
  slice's two RPCs plus slice 8's create_dm remain the only mutation path (test #20 precedent).
REPOSITORY_AND_BASE: plexco-app @ origin/main = 32b7d47b13572a7ce77617aaf45150fa17aaf3e6 (verified
  2026-08-13, HEAD == origin/main, tracked tree clean). No base pinned for building — NOT_CODE_READY.
  The eventual build worktree re-verifies and re-pins from live main at register time, AND must
  re-derive the migration tail number (currently 0032 — will have moved once slices 4/5/6/9 each land
  their own migration ahead of this one, per the serialized DB-lane precedent already observed twice
  on this exact chain, see dd38-dd86-chat-schema-core manifest `_migration_number_note`).
CONTEXT_SOURCES: docs/proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md v1.8 (PLAN_READY
  @ 90d292d) §9 slice-7 row ("Hard-dep 2/3/4/5/6/9"), §9.1 A3 adapter boundary, §8.3 dependency DAG,
  §13 canonical verdict PRIOR_SLICES chain; docs/features/BE/feature_inapp_chat_tech.md v0.27 (§1 entry
  points + DD-91/92/93/95 floors + DD-55 design-probe-gates note + current-channel safe member-target
  contract, §2 schema chat_channels/chat_members/chat_messages DDL, §3 route contract / error codes /
  rate limits / idempotency table, §4 Send pipeline + mark_read + leading-slash classifier pseudocode +
  Caching/Security Checklist, §5 tests #1–6/9/12/17–19/42–44/61/64–66/71–73/85–87); docs/features/FE/
  feature_inapp_chat.md v0.20 (CHT-UC rows, edge-case table); docs/standards/decisions.md DD-38/DD-55/
  DD-56/DD-86/DD-91/DD-92/DD-93/DD-95 (send-relevant ratified scope), DD-102 (closed — evidence below),
  DD-103 (accepted person-merge gap — §2 note); packages/db/schema.ts chatChannels (847-896) /
  chatMessages (898-968) / chatMembers (970-1003); packages/db/migrations/0030_chat_dm_safety_
  authority_core.sql (assert_dm_allowed, chat_pair_blocked), 0031_chat_schema_core.sql
  (chat_current_is_member, dm_current_read_allowed, chat_bind_tenant + DM 2-member guard triggers),
  0032_chat_dm_safety_config_single_read.sql (dm_safety_flags_enabled, CREATE OR REPLACE
  dm_safety_enabled/assert_dm_allowed); docs/autopilot-backlog.md tasks `tenant-capability-authority-
  core` (status idea, scope:[], manifest:null), `dd38-dd86-chat-schema-core` (merged), `chat-dm-safety-
  config-single-read` (merged), `chat-identity-merge-reparent-enablement` (planned/blocked on DD-103 —
  format precedent this packet follows); docs/features/README.md P4 chat index row (independent
  third-source corroboration of the `4→5→9→6→7→8` chain, though its FE/BE version cells are themselves
  stale — v0.15/v0.23 vs live v0.20/v0.27 — a pre-existing, separately tracked drift, see backlog task
  `docs-feature-index-version-freshness-check`, not touched by this packet).
APPLICABLE_SKILLS: none resident.
SCOPE (intended, not authorized — cannot be finalized until B1-B4 close, see §2):
  packages/db/migrations/00NN_chat_shared_message_command_core.sql (new — send_chat_message + mark_read
  SECURITY DEFINER functions owned by chat_definer, ALTER FUNCTION ... OWNER TO chat_definer + GRANT
  EXECUTE TO app, confirm at build time whether 0031 already revoked INSERT on chat_messages from app
  or whether this slice must do it); packages/db/schema.ts (mirror ONLY if a new column/table proves
  necessary — none identified today; the mention/mute/capability data this slice reads all lives in
  tables owned by slices 4/6/9, not this one); a packages/db/src/ RPC-wrapper module (exact name TBD —
  no packages/db/src/chat*.ts non-test file exists yet on main; auth.ts/tenant.ts/authorization.ts are
  the packages/db/src precedent for this class of thin wrapper, same precedent session-service-create-
  command-core used for B2); its real-PG test file; this contract + manifest + backlog block.
NEGATIVE_SCOPE:
  - No mute storage/writer/receipt, no hide/restore (chat.message.moderate / chat.member.mute) — sole
    ownership of slice 6 chat-club-moderation-core, which this slice only CONSUMES (read-only active-
    mute check at send time; mute never gates read per DD-95).
  - No DD-56 capability registry, grant storage, or append-only grant audit, no fail-closed authorize()
    primitive — sole ownership of slice 4 tenant-capability-authority-core, which this slice only
    CONSUMES (the admins_only chat.channel.post_restricted check).
  - No channel create/rename/set-default/archive, no atomic membership auto-provisioning — sole
    ownership of slice 5 chat-club-channel-lifecycle-core.
  - No member-target list/resolution endpoint, no opaque targetRef issuance — sole ownership of slice 9
    chat-authorized-member-target-read-core; this slice only CONSUMES its consume-time resolver to
    validate + persist structured mention targets.
  - No create_dm / reuse / block / report / DM lifecycle — sole ownership of slice 8; this slice only
    calls assert_dm_allowed(actor, peer, 'send'|'read') against an ALREADY-EXISTING DM channel.
  - No SSE/realtime projector or topic-delivery mechanics beyond emitting the id-only pg NOTIFY payload
    — slice 10's ownership.
  - No media/attachment upload, scan, or signed-read — slices 11/12; the "validate attachment ready"
    send-pipeline step is a documented no-op until those slices exist.
  - No reaction (slice 13), no own-edit/delete/revision (slice 14), no search (slice 15).
  - No slash-command execution/registry ownership, no `/pay` or other domain adapter — slice 22 and its
    A13 adapter own the full classifier/registry; this slice's OWN obligation is strictly the defensive
    "leading-slash pre-insert fence" (reject any message body beginning with `/` before insert),
    self-contained and NOT dependent on slice 22 existing.
  - **No `embedType`/`embedRefId`/session-embed columns, request params, or server-side snapshot logic**
    (BE spec v0.27 content, 2026-08-12). Unratified: zero `decisions.md` entry, zero primary-plan slice
    ownership (catalog 1-47/A1-A21/F0-F15 is silent on it), zero live schema support (`chat_messages`
    on `origin/main` carries no `embed_*` column). Excluded from this slice until B5 (§7) closes.
  - **No `kind='group'` channel type, no `chat_pinned_messages`/`chat_polls`/`chat_poll_options`/
    `chat_poll_votes`/`chat_member_nicknames` table, no pin/poll/nickname/group-admin/follow-guard
    mechanic** (BE spec v0.26 content + FE spec CHT-UC-21..31, both 2026-08-11/12). Same un-ratified
    status as the embed item above; `chat_channels.kind` CHECK on `origin/main` is `IN ('club','dm')`
    only. This slice is club+DM only per the primary-plan catalog. Excluded until B5 closes.
  - No HTTP route, no API adapter — `A3 chat-history-send-read-api` is a separate, later slice.
  - No edit to `docs/features/BE/feature_inapp_chat_tech.md` or `docs/features/FE/feature_inapp_chat.md`
    — B5's resolution is a docs-reconcile slice, explicitly not this one.
  - No migration or schema work belonging to slices 4/5/6/9 — this packet does not speculatively
    pre-build their storage.
RISK: P1 — mirrors both merged sibling slices in this same serialized DB lane (chat-dm-safety-
  authority-core, dd38-dd86-chat-schema-core, both P1). This slice creates the ONLY mutation RPCs for
  `chat_messages`/read-cursor state: a new SECURITY DEFINER trust boundary that bypasses the RLS
  choke-point by design and is the first consumer of two upstream gates (DM safety, DD-56 capability).
  No money mutation; conversation content itself is already the sensitive class DD-55/91-95 protect
  (host/support explicitly denied DM read, test #31).
AUTONOMY_MODE: supervised
MODEL_POLICY: planner=primary-agent; worker=assigned-agent (future); reviewer=scripts/codex-review-
  pin.sh — 2 clean code rounds + 1 clean security round (mirrors slice 2/3 tier: a new SECURITY DEFINER
  RPC that consumes a safety gate and a capability gate is a trust-boundary touch by definition, not an
  escalation to request case-by-case).
SANDBOX_AND_PERMISSIONS: network none; secrets none; external side effects none (SSE/media/slash-
  execution stay structurally out of scope).
HUMAN_DECISIONS_REQUIRED:
  1. B5 (§7) — ratify-or-strip the embed/group/poll/pin/nickname content now sitting inside the
     "Reviewed" BE v0.27 / FE v0.20 chat specs. Binary: (a) owner ratifies via a new decisions.md entry
     and the primary plan gains explicit new slice(s) to own it, or (b) the content is stripped or
     relocated out of "Reviewed" status (DD-104 precedent: WIP content in a Reviewed spec is a
     decisions.md-first problem, not a spec-prose problem) until it passes the same G1-G6 gate as
     everything else in this initiative.
  2. No decision is owed for B1-B4 — those are pure sequencing. Slices 4/5/6/9 each need their own full
     authoring + strict CODE_READY + build cycle; the primary plan already fixed this exact order
     (§8.3, §13 PRIOR_SLICES) and nothing in this session's verification changed it.
SLICE_GRAPH: hard-depends on catalog slices 2 (chat-dm-safety-authority-core, MERGED `0030`/`d5b31f9`),
  3 (dd38-dd86-chat-schema-core, MERGED `0031`/`3b3bb09`), 4 (tenant-capability-authority-core, UNMET —
  backlog status `idea`), 5 (chat-club-channel-lifecycle-core, UNMET — no backlog task exists), 6
  (chat-club-moderation-core, UNMET — no backlog task exists), 9 (chat-authorized-member-target-read-
  core, UNMET — no backlog task exists). Blocks: slice 8 (chat-dm-lifecycle-command-core delegates
  send/read to this slice per catalog), slice 10 (chat-realtime-unread-core), slice 22's registry
  consumers reaching a real send path, `A3 chat-history-send-read-api`.
WORKTREE_PLAN: none until CODE_READY.
VERIFICATION (when built): `pnpm test` with `DATABASE_URL_TEST` (real PG); focused: new RPC test file +
  `chat-schema-invariants.test.ts` / `chat-dm-safety-invariants.test.ts` / `rls-invariants.test.ts`
  unchanged-green; `migrate.test.ts` literal-count bump (same mechanical class dd38-dd86-chat-schema-
  core's own manifest already documented — re-grep counts, do not assume the prior slice's numbers);
  build/lint/typecheck; no e2e yet (no HTTP route exists — `A3` is a later slice).
CODE_REVIEW: required — 2 clean rounds via `scripts/codex-review-pin.sh`.
SECURITY_REVIEW: required — first consumer of `assert_dm_allowed`/`dm_safety_flags_enabled` (slice 2)
  and of the not-yet-existing DD-56 `authorize()` primitive (slice 4); creates the first general-
  purpose chat-content mutation RPC.
BUDGETS: cannot be pinned honestly yet. Default ceiling is `≤300 changed LOC`/`≤3 modules`/`1
  migration` (this slice is NOT in the primary plan's explicit §9 budget-exception list, which covers
  only slices 2/3/4/27/36/37) — but the two nearest sibling migrations in this exact chain measured
  **363 LOC** (`0030`) and **354 LOC** (`0031`) for comparable RPC+grant+invariant-test scope. The build
  session should measure against this precedent and request an owner-approved §B3 exception the same
  way slices 2/3/4/27/36/37 did, rather than assume the default ceiling fits.
STOP_CONDITIONS: any of slices 4/5/6/9 lands with a materially different contract than assumed in §2
  (re-verify live at worktree-open, do not carry this packet's assumptions forward unchecked) · embed/
  group/poll/pin/nickname content appears in this slice's diff without B5 closing first · budget
  exceeded without an owner-ratified exception · reviewer unavailable → `HALT TOOL_UNAVAILABLE`.
DELIVERABLES (when unblocked): migration + RPC wrapper + tests green on real PG, 2 clean code rounds +
  1 clean security round, backlog flip, `merged_probe` = migration file :: `send_chat_message`.
```

## 1. Why this slice, why now

`next-lanes-2026-08-13-RUN.md` lane C7 opened this authoring pass because DD-102's hard condition —
`0032_chat_dm_safety_config_single_read` must land **before** slice 7 or 8's first caller — closed at
`main@80a3464` (2026-08-12; decisions.md v2.25 records the obligation complete). That closure is real
and worth having: it removed the one named blocker that specifically targeted this slice. But DD-102
protected against exactly one defect (a torn read inside `assert_dm_allowed`); it was never the *only*
gate on this slice. The primary plan's own dependency column for catalog row 7 — fixed at authoring
time, 2026-07-27/28, unchanged since — reads **"Hard-dep 2/3/4/5/6/9"**, and three independent sources
(plan §13 `PRIOR_SLICES`, the `tenant-capability-authority-core`/`dd38-dd86-chat-schema-core` backlog
notes, and the separately-maintained `docs/features/README.md` chat index row) all agree on the same
chain: `1 → 2 → 3 → 4 → 5 → 9 → 6 → 7 → 8`. This packet's job is to make that fully legible against
**current** live-repo evidence — not to assume DD-102's closure was sufficient on its own, and not to
silently re-derive a shorter dependency list from memory.

Chat now has a real DB root (`0030`/`0031`/`0032`, 3 of 9 upstream slices merged) but still has, per
HANDOFF, "0 service/API/UI chat". This slice is the first that would write message content — which is
exactly why its dependency floor is high: it is the one slice every later interaction (reaction, edit,
search, moderation, DM lifecycle, realtime, notification) sits on top of (test #64, "Slice ownership
catalog").

## 2. Mechanism (what gets built, annotated against what exists today)

Reproduced from the BE spec §4 "Send pipeline" (the pinned target contract for `send_chat_message`),
annotated per step with what is **[AVAILABLE]** on `origin/main` today vs **[BLOCKED]** pending an
unmet hard dependency. This is a faithful restatement, not a new design — the mechanism itself is
already precisely specified; what is missing is the substrate several steps must call into.

```text
API → send_chat_message(channel, client_msg_id, body, reply_ref?, mentions[]) SECURITY DEFINER
    → deterministic idempotency lock + existing-owned-message check          [AVAILABLE — UNIQUE(channel_id,
                                                                                client_msg_id), chat_messages_
                                                                                channel_client_msg_uq, schema.ts:920]
    → resolve actor/channel
        → club: active membership + active mute check                       [PARTIAL — active membership via
                                                                                chat_current_is_member (0031)
                                                                                is AVAILABLE; active-mute check
                                                                                is BLOCKED, no mute storage
                                                                                exists anywhere on main — slice 6]
            → admins_only: exact chat.channel.post_restricted;
              unknown/unavailable deny                                      [BLOCKED — no DD-56 authorize()
                                                                                primitive or grant storage exists
                                                                                — slice 4. chat_channels.post_
                                                                                policy column DOES exist
                                                                                (schema.ts:858) but is only ever
                                                                                populated by slice 5's create/
                                                                                update path, which also doesn't
                                                                                exist yet]
        → DM: block + sender + target/pair safety core                      [AVAILABLE — assert_dm_allowed(actor,
                                                                                peer,'send') 0030/0032, chat_pair_
                                                                                blocked 0030]
    → resolve visible same-channel reply                                    [AVAILABLE — reply_to_message_id FK
                                                                                + moderationState/authorDeletedAt
                                                                                columns already exist, schema.ts:
                                                                                906-967]
    → consume each opaque mention target through slice 9;
      re-authorize current actor+target+channel and persist
      only immutable resolved target ref + sanitized safe-label
      snapshot                                                              [BLOCKED — chat-authorized-member-
                                                                                target-read-core (slice 9) owns
                                                                                the opaque-ref issuance AND the
                                                                                consume-time resolver; neither
                                                                                exists]
    → validate every attachment is actor-owned + channel-bound +
      ready                                                                 [NO-OP by this slice's own negative
                                                                                scope — media is slices 11/12,
                                                                                out of scope regardless of B1-B4]
    → INSERT message + mention rows atomically (ON CONFLICT
      client_msg_id → return existing)                                     [AVAILABLE — chat_messages/chat_
                                                                                members tables exist; a
                                                                                chat_message_mentions table does
                                                                                NOT exist yet (dd38-dd86-chat-
                                                                                schema-core manifest negative_
                                                                                scope explicitly excluded it,
                                                                                deferring it to "DD-92 interaction
                                                                                slices 13/14/15" — but the send
                                                                                pipeline's own mention-persist
                                                                                step needs SOME mention storage;
                                                                                this is a genuine open design
                                                                                question for THIS slice to close
                                                                                at build time, not yet answered
                                                                                by any landed contract)]
    → pg NOTIFY 'chat_<channel>' (payload = message id, không PII)          [AVAILABLE — standard LISTEN/NOTIFY,
                                                                                no new substrate needed]
    → SSE dispatcher đọc canonical message, re-authorize current
      channel access, rồi mới đẩy                                          [OUT OF SCOPE — slice 10 owns the
                                                                                dispatcher; this slice only emits
                                                                                the NOTIFY]

Requester-only command pipeline đứng trước pipeline trên:
POST message → whole-input leading-slash classifier                        [SELF-CONTAINED — this slice's OWN
  ├─ normal text → send_chat_message                                        obligation is only the defensive
  └─ leading slash control input → private typed error, zero mutation       fence ("does body start with /?");
                                                                              the full registry/classifier
                                                                              (slice 22) is explicitly NOT a
                                                                              hard dependency of slice 7 per the
                                                                              catalog's own "Hard-dep 2/3/4/5/6/9"
                                                                              row (22 is absent from that list)]

mark_read(channel, throughMessage) SECURITY DEFINER
  → advance canonical (created_at,id) cursor monotonically for
    current person only                                                    [AVAILABLE — lastReadCreatedAt/
                                                                                lastReadMessageId columns exist,
                                                                                schema.ts:976-977, FK'd to
                                                                                chat_messages]
  → DM blocked/safety-off and club membership `left` deny before
    UPDATE                                                                  [AVAILABLE for DM (assert_dm_allowed
                                                                                (actor,peer,'read')); AVAILABLE
                                                                                for club membership-left check
                                                                                (chat_current_is_member); mute
                                                                                does NOT gate read per DD-95
                                                                                ("mute blocks write, never read")
                                                                                so slice 6's absence does not
                                                                                block mark_read]
```

**Net effect:** of the pipeline's distinct gate/consume steps, three are structurally unbuildable today
— active-mute check (slice 6), `admins_only` capability check (slice 4, plus `post_policy` only ever
gets a real value once slice 5 exists), and mention-target consumption (slice 9). `mark_read` alone is
almost fully buildable against current substrate (mute does not gate reads), but this slice's catalog
definition bundles send + history/list + mark-read + reply + mention into one mechanism (§9 row 7), so
partial delivery is not on the table without re-slicing — which is explicitly not this authoring
session's call to make.

## 3. What is already proven (measured 2026-08-13, HEAD `32b7d47`)

**Available substrate:**
- `chatChannels` (schema.ts:847-896), `chatMessages` (898-968), `chatMembers` (970-1003) all live,
  including `post_policy`/`is_default`/`moderation_state`/`reply_to_message_id`/`last_read_*` columns.
- `assert_dm_allowed(actor,peer,action)` (0030, `CREATE OR REPLACE` in 0032) — single-read, fail-closed
  per action `'create'|'send'|'read'`; this slice is one of its two named callers by design (0030:238,
  "Called by create_dm/send_chat_message (slice 8/7 owners) ... and by mark_read (slice 7) for action =
  'read'").
- `chat_pair_blocked`, `dm_safety_flags_enabled` (0030/0032) — pure predicates `assert_dm_allowed` uses
  internally; not called directly by this slice.
- `chat_current_is_member(channel)`, `dm_current_read_allowed(channel)`, `chat_bind_tenant`, DM
  2-member guard triggers (0031) — read helpers and integrity triggers this slice's RPCs run alongside.
- `chat_definer NOLOGIN NOSUPERUSER BYPASSRLS ...` role (bootstrap script, `286f48b`/`b55d628`) — the
  owner this slice's new functions would be `ALTER ... OWNER TO`.
- 813 tests green at the `0032` gate (37 test files); harness requires `DATABASE_URL_TEST`.

**Explicitly NOT proven / not existing (verified by direct grep against `origin/main`, not assumed):**
- `send_chat_message`, `mark_read` — zero matches anywhere in `packages/db/`; both migrations 0030 and
  0031 carry their own comments naming them as future slice-7/8 deliverables, not implemented here.
- Any capability/grant table (`git grep -c "pgTable(\"chat_capability\|capability_grant"` → 0).
- Any mute/moderation storage (`chat_members` has no `muted_until`/mute column; no `chat_member_mutes`/
  `chat_moderation_*` table exists).
- Any member-target opaque-ref table or resolver function.
- Any `packages/db/src/chat*.ts` **non-test** file (`ls packages/db/src/ | grep chat` returns only
  `chat-dm-safety-invariants.test.ts` and `chat-schema-invariants.test.ts`).
- Any `chat_message_mentions` table (explicitly negative-scoped OUT of slice 3's delivered migration,
  per that slice's own manifest — deferred to "DD-92 interaction slices 13/14/15", none of which is
  this slice; this slice's OWN send pipeline nonetheless needs to persist mention rows per §2 above —
  an open design point this packet surfaces but does not resolve).

## 4-6. Acceptance direction (cannot be finalized — see B1-B4; source rows only)

The BE spec's own testing plan (§5) already names the rows this slice would re-derive assertions from
once its blockers close: **#1-6** (cross-tenant/DM-3rd-person/non-member/dup/rate/size), **#9**
(assistant shape passthrough), **#12** (`left` membership), **#17** (mute/`admins_only` reject — BLOCKED,
needs slice 6/4's real contract to assert against), **#18** (leading-slash DB defense), **#19**
(reply/mention/reaction atomicity — mention half BLOCKED on slice 9), **#42** (membership lifecycle
during send/SSE), **#43-44** (concurrent-send idempotency, transactional NOTIFY), **#61** (safety
dependency migration order), **#64** (slice-ownership fence), **#65-66** (same-channel reply lifecycle,
structured mention immutability — the latter BLOCKED on slice 9), **#71** (own-edit boundary — N/A to
this slice, listed for completeness of what this slice must NOT do), **#72** (post-policy enforcement —
BLOCKED on slice 4/5), **#85-86** (safe-target disclosure/consume-time re-auth — owned by slice 9,
consumed here).

Per gate G4/§11.2, this packet does **not** enumerate final expected-assertion rows for the
mute/capability/mention-target dimensions: doing so today would mean inventing behavior against
contracts (slices 4/6/9) that do not yet exist, which is fabricating evidence-shaped content rather than
verifying it. The rows that touch ONLY already-available substrate (dedup/idempotency, DM safety gate,
reply-target visibility, leading-slash fence, cross-tenant/DM isolation, membership-`left`) could be
enumerated today with real expected results — but a slice-local acceptance matrix that is honest about
only 60-70% of its own mechanism is not a completed G4 gate; it would need a second pass once B1-B4
close regardless. This packet defers full enumeration to that re-authoring pass rather than produce a
matrix that reads as more complete than it is.

## 7. Closure matrix + canonical verdict

### 7.1 Closure matrix — FAR from 12/12 (honest count against §8 of the gate policy)

| # | Gate | Evidence | PASS/FAIL |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `git rev-parse HEAD` = `32b7d47…` (= `origin/main`); exact TARGET_FILES, no glob | PASS |
| 2 | In-scope decisions closed | DD-38/55/56/86/91-95 ratify the club+DM send/history/mark-read scope — but B5 (§0) is an OPEN product-scope question sitting inside the same spec on the exact endpoint | FAIL |
| 3 | Scope IN/OUT + owner clear | §0 SCOPE/NEGATIVE_SCOPE mechanism-named; but scope cannot be authorized (B1-B4) and needs THIS session's own B5 carve-out since the spec doesn't provide one | PARTIAL |
| 4 | Dependency classified | 2/6 hard deps MERGED with verified proof (§ manifest `dep_checks`); 4/6 (slices 4/5/6/9) UNMET, 3 of those with zero backlog authorship | FAIL |
| 5 | Live schema/code matches doc | Verified at `32b7d47`: schema.ts:847-1003, migrations 0030/0031/0032 — AND found the doc does NOT match schema (embed/group/poll content in BE v0.27/v0.26 has no schema support) | FAIL |
| 6 | Data/API/state/auth contract complete | §2 mechanism fully specified BY THE SPEC, but 3 of its steps call into non-existent substrate | FAIL |
| 7 | Fail-closed/idempotency/order pinned | Dedup-first, RPC-only mutation, fail-closed DM gate all pinned; mute/capability/mention legs cannot be pinned without slices 4/6/9's real shape | PARTIAL |
| 8 | In-scope open questions = 0 | B5 is exactly one in-scope open question (§0 HUMAN_DECISIONS_REQUIRED); `chat_message_mentions` storage ownership (§2/§3) is a second, smaller open point | FAIL |
| 9 | Acceptance matrix has expected results | §4-6 explicitly declines to fabricate rows for blocked dimensions | FAIL |
| 10 | Migration/security/rollback pinned | Rollback table (BE §2 Migration & Rollback) covers this slice's tier generically; exact migration content cannot be pinned while 3 steps are undesigned | PARTIAL |
| 11 | First-slice hard deps merged | This is NOT the first slice of its sub-chain; 4 of 6 hard deps are unmerged, 3 unauthored | FAIL |
| 12 | Implementation handoff ready | This contract + manifest + backlog block ARE authored (deliverable of this session) but do not authorize a worktree | PARTIAL |

**1/12 clean PASS, 4 PARTIAL, 7 FAIL.** Nowhere near the 12/12 `CODE_READY` requires.

### 7.2 Verdict — canonical block

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-08-13
AUTHORITY_SHA: 32b7d47b13572a7ce77617aaf45150fa17aaf3e6
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot/contracts/autopilot-chat-shared-message-command-core.md
  - docs/autopilot-manifests/chat-shared-message-command-core.json
  - docs/autopilot-backlog.md
SLICE: chat-shared-message-command-core
IN_SCOPE: sole send_chat_message/history-list/mark_read command boundary for club+DM chat_messages;
  atomic reply+structured-mention insert; idempotency; read-only active-mute/DM-safety consumption;
  leading-slash pre-insert fence.
OUT_OF_SCOPE: mute storage/writers (slice 6); DD-56 capability registry/grants (slice 4); channel
  lifecycle (slice 5); member-target resolution (slice 9); DM create/reuse/block/report (slice 8);
  realtime dispatch beyond NOTIFY (slice 10); media (11/12); reaction (13); edit/delete (14); search
  (15); slash registry/execution (22, A13); any HTTP route (A3); embed/group/poll/pin/nickname content
  (unratified — B5).
G1_DECISION: FAIL
G2_SPEC: PARTIAL
G3_DEPENDENCY: FAIL
G4_TEST: FAIL
G5_SCOPE: PARTIAL
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: 2 chat-dm-safety-authority-core MERGED (`0030`, landed `d5b31f942969ad3629bcd673f2
  fd4de91678147a`, symbol `dm_safety_enabled`, absent at base `75f06c5dbfb78bd36db57418784b13730f68c182`)
  · 3 dd38-dd86-chat-schema-core MERGED (`0031`, landed `3b3bb091205564e181f5c077a7e3390388a31e31`,
  symbol `chatChannels`, absent at base `6f63c7dc631d470a9c6da760fbbe24822dc8e0e1`) · 4 tenant-
  capability-authority-core UNMET (backlog status `idea`, `scope: []`, `manifest: null` — not authored)
  · 5 chat-club-channel-lifecycle-core UNMET (no backlog task exists) · 6 chat-club-moderation-core
  UNMET (no backlog task exists) · 9 chat-authorized-member-target-read-core UNMET (no backlog task
  exists).
PRIOR_SLICES: chat-definer-role-provisioning (merged) -> chat-dm-safety-authority-core (merged) ->
  dd38-dd86-chat-schema-core (merged) -> tenant-capability-authority-core (UNMET) ->
  chat-club-channel-lifecycle-core (UNMET) -> chat-authorized-member-target-read-core (UNMET) ->
  chat-club-moderation-core (UNMET) -> chat-shared-message-command-core (THIS SLICE).
OPEN_QUESTIONS_IN_SCOPE: 2 (B5 embed/group/poll/pin spec-integrity; chat_message_mentions storage
  ownership, §2/§3)
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PARTIAL
CLOSURE_MATRIX: FAIL — 2/12 clean (§7.1)
ACCEPTANCE_MATRIX: FAIL
SECURITY_AND_MIGRATION_GATE: PARTIAL
IMPLEMENTATION_ARTIFACTS: FAIL
FIRST_IMPLEMENTATION_STEP: blocked — do not register or open a worktree. The real next steps, in order:
  (1) author + build slice 4 (tenant-capability-authority-core) through its own strict CODE_READY;
  (2) author + build slice 5 (chat-club-channel-lifecycle-core); (3) author + build slice 9
  (chat-authorized-member-target-read-core); (4) author + build slice 6 (chat-club-moderation-core,
  lands dark); (5) in parallel with (1)-(4), resolve B5 via an owner decisions.md entry or a
  docs-reconcile slice stripping/relocating the un-ratified BE v0.26/v0.27 + FE content; (6) only then
  re-author this packet's §0 SCOPE / §2 Mechanism / §4-6 Acceptance Matrix against the now-real
  contracts and re-run the closure matrix. This mirrors the session-service-create-command-core
  precedent (NOT_CODE_READY authored 2026-08-13 -> blockers closed same day -> CODE_READY), except
  here the blockers are four multi-day build cycles, not four read-and-pin items.
REMAINING_BLOCKERS:
  - blocker: B1 (G3) — slice 4 `tenant-capability-authority-core` (DD-56 capability registry, grant
    storage, fail-closed `authorize()`) does not exist. Backlog status `idea`, `scope: []`,
    `manifest: null`. This slice's `admins_only` post-restriction check has no primitive to call.
    owner: a future authoring session for `tenant-capability-authority-core`
    resolution: slice 4 reaches strict CODE_READY and merges; then this slice's manifest gains a real
    `dep_checks` entry for it.
  - blocker: B2 (G3) — slice 5 `chat-club-channel-lifecycle-core` (channel create/rename/default/
    archive + atomic membership provisioning) does not exist; no backlog task authored. Without it,
    `chat_channels.post_policy` and `chat_members` rows for club channels have no legitimate creation
    path to test against, and the catalog itself lists 5 as a hard dependency of 7.
    owner: a future authoring session for `chat-club-channel-lifecycle-core`
    resolution: slice 5 reaches strict CODE_READY and merges.
  - blocker: B3 (G3) — slice 6 `chat-club-moderation-core` (DD-95 mute storage/writers/receipts/audit,
    lands dark before send) does not exist; no backlog task authored. This slice's "read-only active-
    mute check" step has no storage to read.
    owner: a future authoring session for `chat-club-moderation-core`
    resolution: slice 6 reaches strict CODE_READY and merges (dark — no route needed for this slice to
    consume it).
  - blocker: B4 (G3) — slice 9 `chat-authorized-member-target-read-core` (opaque current-channel member
    DTO + consume-time resolver) does not exist; no backlog task authored. This slice's structured-
    mention consumption step has nothing to call.
    owner: a future authoring session for `chat-authorized-member-target-read-core`
    resolution: slice 9 reaches strict CODE_READY and merges.
  - blocker: B5 (G1/G2) — `docs/features/BE/feature_inapp_chat_tech.md` v0.26/v0.27 and
    `docs/features/FE/feature_inapp_chat.md` (CHT-UC-21..31) inject session-embed + group-chat +
    pin/poll/nickname product scope directly onto `chat_messages` and the `POST /api/chat/channels/:id/
    messages` route — the exact table and endpoint this slice owns — with zero `decisions.md`
    ratification (verified: no DD mentions `kind='group'`, `chat_groups`, poll, pin, or nickname),
    zero primary-plan slice ownership (catalog 1-47/A1-A21/F0-F15 is silent on it), and zero live
    schema support (`chat_messages` has no `embed_*` column; no group/pin/poll/nickname table exists).
    This is the same class of defect DD-104 named and required stripped twice ("decision chưa chốt viết
    thẳng vào spec đã Reviewed").
    owner: owner (one decisions.md ruling) or a docs-reconcile slice
    resolution: either (a) owner ratifies via decisions.md + the primary plan gains explicit slice(s)
    for it, or (b) the content is stripped/relocated out of "Reviewed" status until it passes G1-G6.
    Recorded as its own backlog idea task (`docs-chat-spec-embed-group-scope-reconcile`) alongside this
    packet, per the Level-3 rule that an out-of-scope finding needs a sanctioned place to land rather
    than living only in this transcript.
NEXT_REVIEW_TRIGGER: slices 4, 5, 9 and 6 (in that order) each reach strict CODE_READY and merge to
  `origin/main`, AND B5 is resolved (a decisions.md entry either ratifying or an owner-directed strip of
  the un-ratified spec content) — then re-author §0 SCOPE / §2 Mechanism / §4-6 Acceptance Matrix against
  the now-real contracts and re-run the closure matrix from zero, not by patching this version in place.
```
