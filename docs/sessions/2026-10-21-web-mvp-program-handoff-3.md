# Web MVP program: session handoff 3 (2026-10-21)

> **Supersedes sections 2 and 3 of `docs/sessions/2026-10-14-web-mvp-program-handoff-2.md`** (the PR state for #42-#57 and "What is on
> main now (origin/main 7fe5525)"). Handoff 2 describes the world at 2026-10-15: its migration tail (`0055_me_settings_definers.sql`)
> and its line "Wave B/C items M6, M9, M10 have no PR" are stale. Sections 1 and 4 to 7 of handoff 2 were not re-measured for this
> file; read them with the ledger beside them.
>
> **Measured:** 2026-10-21 at `origin/main` = `0a4e1b8e9b146c04884b3ee2ff234cc6646fcc72` (the merge of PR #91). Every number below was
> measured at that SHA unless its line names another source. Nothing here claims live delivery, a staging environment or production:
> staging (#50) is frozen and owner-only, and the only execution evidence is the local golden path in section 5.
>
> Written by lane L17 (closeout); its authority is `docs/sessions/web-mvp-phase3-readiness-p3-closeout.md`, cited below as the "L17
> readiness" (P-numbers are its default rows). Owner-facing status (Vietnamese) lives in `docs/sessions/web-mvp-program-status.md`
> (the ledger). This file is the agent-facing copy.

## 1. What is on main now (origin/main 0a4e1b8e)

- `origin/main` = `0a4e1b8e9b146c04884b3ee2ff234cc6646fcc72`, the merge of PR #91 (mergedAt 2026-10-20T20:49:25Z, section 2).
- Migration tail at 0a4e1b8e: `packages/db/migrations/0066_account_club_chat_context.sql`.
- Phase 3 lanes merged: M6 #63 #64 #66 #67 #69; M9 #65 #68 #70 #71 #72 #74 #76 #77 #84 #85; M10 #83 #86 #87 #88 #89 #90 #91; plus
  #59 (docs and decisions sync), #60 (OSV floors), #61 (session text control characters), #62 (CI flake hardening) and #73 (CI trigger
  and runner pin). #58 merged the Phase 3 plan. #75 was closed unmerged and is in no lane list; #78 to #82 are kit-sync PRs, not
  Phase 3 lanes. PR #50 (M5 staging, DigitalOcean) stays open, frozen and owner-only (L17 readiness section 7).
- Feature flags at 0a4e1b8e: capability registry `public_sessions` false, `web_realtime` false, `zalo_dm` false (read before and after
  the golden path, section 5); `OUTBOX_DISPATCH_SCHEDULE_ENABLED` false (`.env.example:99`, `infra/docker-compose.yml:132`);
  `GENDER_COLLECTION_ENABLED` false (`.env.example:173`, L17 readiness P14).
- The projectors for `zalo_dm` (#66), `web_realtime` (#67) and `public_sessions` (#72) are merged and disabled in every committed
  default (PR #66 body :18, PR #67 body :23).
- The ledger carries the same state in its M6, M9 and M10 rows and its dated block.

## 2. Phase 3 PR map (#58-#91 except #75 and #78-#82; every row MERGED)

PR state and merge commits as measured at 0a4e1b8e; `mergedAt` is UTC (Asia/Saigon = UTC+7). Titles are the PRs' own words and are not
evidence of live delivery. A lane's readiness file is `docs/sessions/web-mvp-phase3-readiness-p3-<x>.md`, where `p3-<x>` is the branch name
without its `feat/`, `fix/` or `docs/` prefix (26 files, for #59-#72, #74, #76, #77 and #83-#91; L17 readiness P4).

| PR | Merge commit | mergedAt (UTC) | Branch | Title |
| --- | --- | --- | --- | --- |
| #58 | c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a | 2026-10-16T04:36:05Z | docs/mvp-phase3-plan | docs(plans): Web MVP Phase 3 plan (M6, M9, M10) for owner approval |
| #59 | 529c7c2cedf05de724b96a7f1410807ce991f506 | 2026-10-16T10:23:03Z | docs/p3-docs-decisions-sync | docs: record owner-signed D1-D5 (DD-133..DD-137) and sync specs, ledger and stale pins |
| #60 | 45f8c68640baaeca810cff332f0e99b1ae47609f | 2026-10-16T10:59:26Z | fix/p3-osv-advisories | fix(deps): raise OSV-flagged floors for shell-quote, sharp, source-map-js and brace-expansion |
| #61 | b0bf565ed72d8c4be3f47d3fe7a4e0e382605928 | 2026-10-16T11:07:20Z | fix/p3-session-text-control-chars | fix(sessions): reject control, bidi and hidden characters in session text fields |
| #62 | cf109e61f7489e67dd62401e2562bd104ab4cd2d | 2026-10-16T10:29:38Z | fix/p3-ci-flake-hardening | fix(test): one leased role password and reader/breaker definer locks for the parallel DB suites |
| #63 | 442aa1bf61234a7b4330295dfd36211446988a8a | 2026-10-16T16:01:47Z | feat/p3-m6-visibility-toggle | feat(web): add the host visibility toggle with fence and discovery proof |
| #64 | 98a4a6c920acbe2647f6e1ef710a21e535be6c8d | 2026-10-16T15:31:15Z | feat/p3-m6-outbox-delivery-core | feat(outbox): durable projector registry, bounded retry with owner DLQ replay, NOTIFY wake and draft auto-expiry (M6) |
| #65 | 8c382917ff9d66bec45d26234520bb5a2c51e0cd | 2026-10-16T20:57:26Z | feat/p3-m9-occupancy-helper | refactor(db): one session occupancy helper for commands and host reads |
| #66 | 61221162c3f206ed02da62dfbd0086d770f75c49 | 2026-10-16T21:05:28Z | feat/p3-m6-zalo-outbound | feat(bot): deliver zalo_dm direct messages through the Zalo Bot API |
| #67 | c5497a7914d89df433a3c043e280a0d074e8d3c5 | 2026-10-16T21:38:44Z | feat/p3-m6-web-live-sync | feat(web): live sync for host session views via id-only web_realtime |
| #68 | dbdc061443ca18f9cdc1277916b720d92a1081ea | 2026-10-17T02:10:28Z | feat/p3-m9-join-core | feat: M9 join core: player self-join, join requests, FIFO waitlist promotion and the promotion DM (L8) |
| #69 | 67e15794375d4d5df9834702960703e4658d0679 | 2026-10-17T05:33:40Z | feat/p3-m6-announce-route | feat: M6 host announce route with a DB-truth delivery guard and the requester id (L4b) |
| #70 | 16601611af1b6b644446d682512ee6605f15c8fd | 2026-10-17T04:53:26Z | feat/p3-m9-me-reads | feat: M9 person-scoped me reads: my clubs, sessions, charges and requests (L9) |
| #71 | ff9e15333956e370d41281d7cb33bb6708b1a9e0 | 2026-10-17T08:39:31Z | feat/p3-m9-public-alias-moderation | feat: club public alias with owner-only moderation (L10a, migration 0060) |
| #72 | 4ece239852c2ca31513d61c81e418f4bfa556ebf | 2026-10-17T19:12:26Z | feat/p3-m9-public-projector | feat(db,bot): public sessions projector, occupancy function, share-slug registry and replaced public view [M9 L10] |
| #73 | f2c6aa871a4e694104bde6f59d139c23bd3026dd | 2026-10-17T19:06:15Z | ci/push-main-only | ci: run CI on pushes to main only; pin runners to ubuntu-24.04 |
| #74 | de732028f3163541928ae7eeac71beebf16e5a18 | 2026-10-18T03:52:30Z | feat/p3-m9-discovery-read | feat(discovery): anonymous public discovery read and the public join (L10b, M9) |
| #76 | 277b366af3a2b215c46aec242f6da945251fb483 | 2026-10-18T22:29:54Z | feat/p3-m9-gender-pricing | feat(pricing): per-gender session prices from an encrypted, consented gender (L11, M9) |
| #77 | f17f52ad824de3e548eab25a3c2949b6fa280cd6 | 2026-10-19T03:54:57Z | feat/p3-m9-player-web | feat(web): player discovery, me pages and host join-requests tab [M9 L12] |
| #83 | 819de9cc982bac48c84196612bae2f961f2bbade | 2026-10-19T11:47:33Z | feat/p3-m10-chat-core | feat(db): chat command core: send, edit, delete, mark read, moderation and masked reads [M10 L14] |
| #84 | f43c4328c6ffb51c8e5a26c48879aa1c73e75484 | 2026-10-19T13:57:46Z | feat/p3-m9-channel-identity-link-gate | feat(db): channel identity link gate: app-callable read wrapper over the DD-50 link core [M9 L13a] |
| #85 | 4b97ce156dfe041d8a076c204986042cd80b766e | 2026-10-20T00:35:20Z | feat/p3-m9-zalo-player-commands | feat(web): Zalo /join /leave /pay for linked accounts [M9 L13] |
| #86 | 03e17a5b7c99db9365ddc41dc213e648273bbffc | 2026-10-20T03:46:34Z | feat/p3-m10-chat-api-live | feat(web): chat HTTP routes and live stream for club channels [M10 L15] |
| #87 | a23fe96d3b9045a5f143b19bac9b31be97a2daff | 2026-10-20T06:28:48Z | feat/p3-m10-chat-author-labels | feat(chat): carry the author's club label on the message list [M10 L15a] |
| #88 | 2844c537f3211486d588c44cc489f629e9e34b19 | 2026-10-20T08:58:21Z | feat/p3-m10-chat-viewer-capabilities | feat(web): viewer chat capabilities on the channel list [M10 L15b] |
| #89 | 9afb29356eb9a7dce2794554fdf9491b3f5d6d0b | 2026-10-20T14:27:02Z | feat/p3-m10-chat-web | feat(web): club chat UI for the D4 cut (M10, L16) |
| #90 | b57cd9e0a487a44d2872b8e79b285bf636ffb8ba | 2026-10-20T19:55:01Z | feat/p3-m10-chat-member-entry | feat(web): member chat entry for active club members (L16c) |
| #91 | 0a4e1b8e9b146c04884b3ee2ff234cc6646fcc72 | 2026-10-20T20:49:25Z | feat/p3-m10-chat-moderation-ui | feat(web): chat moderation UI for club admins (M10, L16b) |

## 3. Open proposal and open owner questions

Open proposal, pending owner sign-off: **DD-138** in `docs/standards/decisions.md` (the highest number before it was DD-137; L17
readiness P2). It is ONE entry, status proposal, header dated 2026-10-21; nothing in it is signed. It holds:

- every default the Phase 3 lanes applied (550 rows after the review fixes, base 0a4e1b8e): a lead table of the decisions that need the
  owner's eyes (Vietnamese heading in the entry), then one table per lane. Each row reads "default applied, pending owner sign-off" and
  names its lane, PR and source. A default the owner already approved is listed apart as owner-approved (L17 readiness P4, P5);
- the decision exception M-11 (lane L16c, PR #90): `GET /api/me/clubs/[clubRef]/chat-context` returns `{tenantId, timezone}` to a member
  for their own ACTIVE membership only, against `feature_player_view_tech.md` :278 :287;
- spec follow-ups: no Reviewed spec was edited (end of section 6);
- two CI changes that PR #73 records as owner-requested (2026-10-18).

Open owner questions named by the lanes (questions, not defaults; cited as the lanes give them):

| Lane (PR) | Open question | Source |
| --- | --- | --- |
| L4b (#69) | A-D9: a refusal when the host has no linked Zalo (the applied behaviour is NO refusal) | PR #69 body :31 |
| L12 (#77) | O-2: no leave or cancel for a player | PR #77 body :74-78 :125 |
| L10b (#74) | O-6, O-9, O-10 | PR #74 body :66-68 |
| L11 (#76) | O-3: enabling gender collection is the owner's | PR #76 body :237 |
| L16b (#91) | O-2 and O-5 | PR #91 body, section "OPEN" |

PR body line numbers are lines of the body text as read at the base measurement; a later edit of a PR body shifts them.

## 4. Owner P0 steps (none marked done)

Authority: L17 readiness P14 (`docs/sessions/web-mvp-phase3-readiness-p3-closeout.md` :71). These are owner actions; no agent performs
them and none is marked done in this file.

1. Enable `OUTBOX_DISPATCH_SCHEDULE_ENABLED` for real use (false at `.env.example:99` and `infra/docker-compose.yml:132`, 0a4e1b8e).
2. Connect a real Zalo bot token.
3. Message real users.

Notes on the same line of that file:

- The announce route (PR #69) is merged and refuses with 409 `ANNOUNCE_DELIVERY_DISABLED` until the dispatch schedule is enabled (L17
  readiness Q9). D2 (f) (DD-134 (f)) is signed, so the route is not parked.
- `GENDER_COLLECTION_ENABLED` stays false (`.env.example:173`) until the owner enables it.

## 5. Golden-path evidence (local only; no staging, no production)

- Command: the golden-path command in section 10 of `docs/runbooks/local-mvp-smoke.md` (it runs four tests, runbook :173); config
  `apps/web/e2e/golden-path.config.ts` (L17 readiness P12).
- Result at 0a4e1b8e: 4 passed in 2.1 min: host 31.2 s, player 54.9 s, chat 25.2 s, member chat 16.0 s.
- Capability flags `public_sessions`, `web_realtime` and `zalo_dm` were false before and after.
- The not-proven reporter printed nothing: it prints only for a test carrying the NOT_PROVEN annotation
  (`support/golden-path-not-proven-reporter.ts:18-23`).
- It proves the local flow only. It does not prove live delivery to Zalo or to any real user, and it does not enable the dispatch
  schedule for real use.

## 6. Open list (backlog slugs in `docs/autopilot-backlog.md`; each item is open, none is done)

Backlog rows examined and NOT flipped (find a row with `grep -n '^## task: <slug>$' docs/autopilot-backlog.md`). Flip criteria (L17
readiness P8): F1 a merged lane PR's readiness file or body names the row's deliverable as delivered; F2 the PR is MERGED and its merge
commit is an ancestor of the final base; F3 for a code-symbol claim the identifier is present at the final base, cited with file:line.
Line numbers are `file:line` at 0a4e1b8e unless the item names another source. (`web-bot-vnd-display-convention` is already `merged`.)

1. `projector-real-replace-stub` (planned): #64 left only a refusal sentinel; #66 (`zalo_dm`), #67 (`web_realtime`) and #72
   (`public_sessions`) are real projectors, all disabled in every committed default. No merged PR or readiness names the row's deliverable
   (the first concrete consumer) as delivered, and the row keeps the dispatch flag off until it and item 2 are done. Missing: that
   statement, or an owner ruling that #66 is the first consumer.
2. `job-outbox-dispatch-sync-lag-slo` (idea): the target is the NFR itself (p95 <= 3 s). #64 says only "reachable"; its p95 was measured
   in a local test process and is not asserted in CI (readiness p3-m6-outbox-delivery-core A29 :418); `NFR-1c-live-sync-lag` is
   enablement-only (same file, G6_EXTERNAL :44). Missing: a live p95 with the schedule enabled (owner P0). That readiness's sync-lag
   table (local p95 and its measuring SHA) was not read.
3. `job-scheduler-cron-registration` (idea): #64 names it only in its OPEN pointers (readiness :475-477, body :263-264), though D-14 :285
   (dispatch schedule behind the flag) and D-16 :307 (draft-expiry cron) cover the schedule side; the dispatch registration was already
   the merged split `job-schedule-outbox-dispatch`. The row asks for a shared schedule-registration place plus an audited cross-tenant
   envelope (job_id, tenant_id, actor=system, reason) and weighs `list_due_tenant_jobs`: 0 hits for that name at 0a4e1b8e (packages, apps,
   scripts), in the PR bodies and in the phase-3 readiness files; no positive control was applied to the "audit envelope" and "cross-tenant"
   searches. Missing: a merged lane delivering the envelope and place, or a check whether `job_audit_events` already is that envelope.
4. `audit-2026-09-06-d6-outbox-no-attempt-bound` (planned): no PR delivers it; #64 says "(outbox-side bound still absent)" (readiness :477,
   body :264). At 0a4e1b8e `packages/db/schema.ts` has `attempts` on `tenant_link_codes` (:844), `projector_deliveries` (:1574) and
   `notification_deliveries` (:1923), none on `outbox_events` (:1518). Missing: a merged migration lane adding the outbox-side bound (row
   proposal: N attempts, then a named sink, no drop), after the owner decides bound or no bound.
5. `feature-cross-club-join` (idea): #68, #74 and #77 deliver parts; no PR body or readiness names the slug (0 hits), and the spec still
   reads `Implementation: Not started` (`feature_cross_club_join.md:7`, L17 readiness P11). A flip would claim the whole feature.
   Missing: a statement that the whole feature is delivered, plus the spec sync (L0 owns spec sync).
6. `feature-marketplace-discovery` (idea): #74 and #72 deliver parts; same finding (0 slug hits; `feature_marketplace_discovery.md:7` reads
   `Implementation: Not started`). Missing: the same.
7. `pnpm-workspace-postcss-override-inert` (idea): nothing delivered. The deliverable is deleting `"postcss@<8.5.10": 8.5.16` from the
   `overrides:` block of `pnpm-workspace.yaml` (still at `pnpm-workspace.yaml:14-15`); readiness p3-osv-advisories keeps that file
   byte-unchanged on purpose (:29, :106, :273-274; PR #60 body :62). Missing: a merged lane deleting that entry and saying what it did
   with the `overrides:` tail, plus F1.
8. `osv-full-scan-red-on-main-2026-10` (idea): #60 fixes the fixable advisories. Readiness p3-osv-advisories :272-275 says the full scan
   stays red after #60 (braces; `next` 15.5.25 at `pnpm-lock.yaml:1550` and `:3106`, two advisories needing 15.5.27 or later, as that
   file states). Missing: a merged lane for the two `next` advisories and a braces fix, then a green "OSV full dependency scan" check on
   main with its SHA. The row text names the wrong override location (same readiness, C1 :140-142).
9. `braces-ghsa-vfj7-no-fixed-version` (idea): #60 created this row as the deferral (readiness p3-osv-advisories D-6 :190-193; PR #60 body
   :31, :53). Still `braces@3.0.3` at `pnpm-lock.yaml:1182` and `:2788`. Missing: the row's own trigger (an OSV `fixed` event for braces,
   or a micromatch, fast-glob or @next/eslint-plugin-next release of the same major that drops braces), then a merged bump lane.
10. `offline-page-csp-nonce-missing` (idea): no PR body or readiness says `/offline` was fixed; `apps/web/app/offline/page.tsx:7` and `:15`
    still carry the inline `CAPTURE_REQUESTED_URL` script. Missing: a merged lane touching that file (dynamic render so Next applies the
    nonce, or a same-origin static script) with its own checks; it must land before `CSP_SCRIPT_NONCE_ENABLED` is turned on anywhere
    (an owner P0 precondition).
11. `docs-drift-sessions-fe-zalo-tech-readme-pins` (idea): #59 only re-counted the row (readiness p3-docs-decisions-sync :153; PR #59 body
    :15), which is not delivery; PR #59 body :46-47 itself lists the README version cells and `feature_zalo_channel_tech.md:154` as still
    open. At 0a4e1b8e: `docs/channels/web/FE/feature_sessions_fe.md:3` (also :19 :36 :43 :46 :50) still reads `/dashboard/sessions`;
    `docs/features/README.md:77` still pins identity FE v1.11 / BE v1.13; `feature_zalo_channel_tech.md:154` still reads "(pending in PR
    #51)"; `Sora` is unchanged (`git grep -c -w Sora`: ci.yml 1, web README 3, design-brief 3, designer-kickoff 3, theme-direction 8,
    design-system 10). The row's pins (2) and (4) and the U+20AB half of pin (5) were not re-measured and no PR claims them. Missing: a
    merged docs lane fixing pins (1)-(6) and saying so, then a grep per pin at the final base.
12. `session-venue-address-error-field-contract` (idea): #61 names it twice, both as a deferral (readiness p3-session-text-control-chars P10
    :81 and OUT_OF_SCOPE :232; PR #61 body :6: the wire stays `400 INVALID_BODY`). #61 widened the server-side hidden-character check to
    `area`, `venue_name` and `venue_address` but left the failing field in `error.details` (a wire-contract change) to this row. At
    0a4e1b8e `apps/web/lib/session-command-route.ts:565` keeps `INVALID_TEXT_FIELD` in `VALIDATION_VARIANTS` (:560) and `:763-765`
    collapses it to `INVALID_BODY` (400, bilingual message, no field name); `packages/core/src/api-contract.ts:25` still documents that
    collapse. The row's own readiness field says a wire-contract change needs its own decision. Missing: that decision, then a merged
    lane in those two files carrying the failing field.

Backlog rows added by L17 (status idea): `db-test-job-definer-bootstrap-tuple-concurrently-updated-flake`,
`db-test-definer-role-reads-outside-reader-lock-guard`, `db-test-privilege-assertions-vs-definer-membership-windows-flake`,
`db-test-link-code-ttl-upper-bound-host-clock-flake`, `api-contract-test-dto-key-pins-assert-fixtures-not-the-type`,
`db-test-nonsuperuser-owner-bootstrap-jobd-before-chat-slot-hold-and-wait`. A rename-window candidate was already fixed on main by
`fba3e02` (PR #83); the chat-catalog describe candidate is covered by `db-test-definer-role-reads-outside-reader-lock-guard`.

Leads NOT researched into rows (confirm each at the base before any row is written; each is open):

- migration-tail pin sites: derive the tail or keep a tripwire (a decision task);
- L14 (#83): a definer-side EXCEPTION wrapper for `check_violation` and `not_null_violation` DETAIL;
- V-26: the moderation command fingerprint has no channel;
- chat functions and `chat_current_is_member` never check `archived_at`; `mark_read` locks the channel row before its tenant check;
- `editChatMessage`: `editedAt` is typed string while migration 0063 can return NULL;
- L15 (#86): the 11-line listener connect code is duplicated; the session-actor naming row (PR #86 body);
- L13 (#85): O-1 `query_timeout` misses the pool wait, and O-2 the client timeout does not cancel the statement;
- L16b (#91): the restore walk's `RESTORE_GETS` 20-page ceiling (PR #91 body);
- L16 (#89): `authorLabel` isolation (verify it is done); L13a (#84): the review residual in the PR #84 body :242-245.

DD-138 completeness: the L14 (#83), L15 (#86), L16 (#89) and L12 (#77) tables come from the lanes' defaults sections. In the source
ranges below, every line with a default marker (81 lines) was checked against the entry, and the defaults found (the B3 exceptions of L14, L15 and L16; rulings RO-L14-6, RO-L14-7, RO-S11-1, RO-S11-2 and RO-L16-2) became rows; every other lane granted a B3 exception now has its row too; lines without a marker were not read line by line:

- L14 readiness p3-m10-chat-core :30-77 :102-167 :202-597, and PR #83 body :1-122 :156-212 :325-499;
- L15 readiness p3-m10-chat-api-live :1-49 :148-end, and PR #86 body :1-165 :232-491;
- L16 readiness p3-m10-chat-web :1-39 :46-47 :56-355 :406-559 :572-654, and PR #89 body :2-43 :114-252;
- L12: PR #77 body :9-23 :95-120 :150-162.

Reported, not edited by L17:

- Reviewed-spec lines left as DD-138 follow-ups: `feature_inapp_chat_tech.md` :944 :1140 :1158 :1169; `feature_player_view_tech.md` :278 :287.
- Two headers still read `Implementation: Not started`: `feature_cross_club_join.md:7`, `feature_marketplace_discovery.md:7` (items 5, 6).
- `docs/00-start-here/HANDOFF.md` (no new LIVE TRUTH block), any Reviewed spec, any kit-pack file, any code, test or migration.
- PR #50 (open, frozen, owner-only) and PR #75 (closed, in no lane list).
- The "OSV full dependency scan" check is red on main (owner timing); ignore it for CI-green judgements (item 8).

## 7. Where to read

- Ledger (owner-facing, Vietnamese): `docs/sessions/web-mvp-program-status.md`.
- Decisions: `docs/standards/decisions.md`, entry DD-138 (proposal); DD-133..DD-137 are the owner-signed D1-D5 that #59 recorded.
- Plan: `docs/sessions/web-mvp-phase3-plan.md` (merged by #58).
- Lane readiness files: `docs/sessions/web-mvp-phase3-readiness-p3-<x>.md` (section 2). Closeout authority: the L17 readiness (P1 this
  file, P8 flip criteria, P12 golden path, P14 owner steps, section 7 the OPEN list).
- Runbook: `docs/runbooks/local-mvp-smoke.md` (local golden path; the command is in section 10).
- Backlog: `docs/autopilot-backlog.md`. Earlier rules and state: handoff 2, sections 1 and 4 to 7 (not re-measured here).
