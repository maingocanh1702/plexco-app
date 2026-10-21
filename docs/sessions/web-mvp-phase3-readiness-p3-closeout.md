<!-- review-readiness: code-ready -->

# Step-0 readiness: L17 p3-closeout (session P3-S14)

> Agent-facing. Readiness reviewer: sonnet/high (same model and effort as the lane's code reviewer). Writer: sonnet/high. Docs only.
> Lane block: L17 p3-closeout of the Phase 3 RUN brief (conductor-owned). Plan: `docs/sessions/web-mvp-phase3-plan.md`. Shape: the docs-only precedent `docs/sessions/web-mvp-phase3-readiness-p3-docs-decisions-sync.md` (L0).
> Every number below is MEASURED at base `0a4e1b8e9b146c04884b3ee2ff234cc6646fcc72` (merge of PR #91) in the lane worktree: branch `docs/p3-closeout`, HEAD = base, tree clean, nothing committed before this file.
> Section 2 answers the lane's step-0 questions Q1-Q12, each with its measuring command. A grep that returned nothing was checked against a known-present control case.

## 1. Authority

- Lane L17 (docs only, P2): close Phase 3 with the ledger, handoff-3, backlog flips, runbook, the owner P0 list, ONE consolidated decision entry and the recorded extended golden-path run. Owner decisions needed: none. Every default L17 applies is pinned in section 5 as value + "default applied, pending owner sign-off".
- Owner rulings in force (read, not re-decided): D2 (a)-(f) signed 2026-10-16 (`docs/standards/decisions.md` DD-134: `(f)` at `:1824`, the "not signed" clause at `:1826`, the owner signature at `:1833`; line numbers from `sed -n '1812,1836p'`). So the lane block's clause "parked until the owner reports the schedule enabled if D2 (f) is unsigned" does NOT apply: (f) is signed.
- Owner-approved items (listed as owner-approved, never as pending): R1 of B-A1 (2026-10-19); "Labels ok" (L15a, 2026-10-20); "moderation ok" (L15b and L16b, 2026-10-20); "Member chat ok" plus a terminal confirmation (L16c, 2026-10-20). The writer quotes each owner sentence with its date from the readiness file or PR body that records it (grep `B-A1` for R1); an item with no recorded source text goes under OPEN in handoff-3 and is not written into the decision entry as owner-approved.
- Base: `git rev-parse origin/main` = `git rev-parse HEAD` = `0a4e1b8e9b146c04884b3ee2ff234cc6646fcc72` after `git fetch origin` (measured 2026-10-21); `git merge-base --is-ancestor <base> origin/main` rc 0.
- Merge probes (`gh pr view <n> --json number,state,mergeCommit,mergedAt`, re-run at this review): #58 MERGED `c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a` (2026-10-16T04:36:05Z); #77 MERGED `f17f52ad824de3e548eab25a3c2949b6fa280cd6` (2026-10-19T03:54:57Z); #91 MERGED `0a4e1b8e9b146c04884b3ee2ff234cc6646fcc72` (2026-10-20T20:49:25Z, = base).

## 2. Live truth measured at the base (Q1-Q12)

| Q | Fact | Evidence at base |
|---|---|---|
| Q1 | Every Phase 3 lane PR is merged; the only open PR is #50; #75 is closed and in no lane list | `gh pr list --state open` = #50 `feat/mvp-m5-staging` only; `gh pr view 50` OPEN, no merge commit; `gh pr view 75` CLOSED, `mergeCommit` null; `gh pr list --state all --limit 6` = #91..#86 all MERGED, nothing above #91. The orchestrator's map of 33 merged PRs (#58..#91 minus #75; kit-sync #78-#82 included) was read in full: all 33 merge SHAs are ancestors of `origin/main` (33 of 33, `git merge-base --is-ancestor`) |
| Q1 | PR to lane map (titles from `gh pr list`; the writer takes merge SHAs from `gh pr view <n> --json mergeCommit`) | #58 plan; #59 L0 docs sync; #60 OSV floors; #61 session text control chars; #62 CI flake hardening; #63 M6 visibility toggle; #64 M6 outbox delivery core; #65 M9 occupancy helper; #66 M6 Zalo outbound; #67 M6 web live sync; #68 M9 join core; #69 M6 announce route (L4b); #70 M9 me reads; #71 M9 public alias moderation (L10a); #72 M9 public projector; #73 CI push-main-only; #74 M9 discovery read (L10b); #76 M9 gender pricing (L11); #77 M9 player web (L12); #78-#82 kit sync and ap3 roll-ins (no decision number); #83 M10 chat core; #84 channel identity link gate; #85 M9 Zalo player commands (L13); #86 M10 chat API and live stream (L15); #87 author labels (L15a); #88 viewer capabilities (L15b); #89 club chat UI (L16); #90 member chat entry (L16c); #91 chat moderation UI (L16b) |
| Q2 | Migration tail is `0066_account_club_chat_context.sql`; L17 adds no migration | `ls packages/db/migrations`: 67 files, tail `0060_tenant_public_alias` .. `0066_account_club_chat_context.sql`, nothing above 0066; 0066 came from commit `08f69c3a153114484bd13c6188c1aa410d39de23`; `git diff --name-only <base>..HEAD` = 0 files before this file |
| Q3 | Grants, RLS, tests: not applicable | docs only: no SQL, schema, route, code symbol or test file, so nothing to GRANT and no table to RLS-guard. Acceptance commands exist in `package.json`: `review:check` `:20`, `review:check:changed` `:21`, `format:check` `:24` (`prettier --check .`), `kit:check` `:28`. `.prettierignore` `:9` `docs/` and `:13` `*.md`: prettier skips every L17 file, so `format:check` is vacuous for them but must exit 0 |
| Q4 | The six Reviewed-spec lines the decision entry cites as spec follow-ups exist, unmoved | `docs/features/BE/feature_inapp_chat_tech.md` (1661 lines; v0.28 2026-08-25; status Reviewed contract, pending migration; Implementation Not started): `:944` per-channel NOTIFY name, `:1140` route-contract row `GET /api/chat/channels`, `:1158` `GET /api/chat/subscribe` SSE topic per channel, `:1169` canonical DTO whitelist rule. `docs/features/BE/feature_player_view_tech.md` (423 lines; v2.11 2026-10-16; status Reviewed): `:278` `/api/me/charges` enumerates own authorized clubs, wrapper holds no raw tenant id; `:287` error row, a wrong-actor/expired/replayed ref gives a generic invalid/reload picker with no fallback to a raw tenant id |
| Q5 | Newest decision is DD-137, no DD-138, next free is DD-138 | numeric max of `^#{1,4} DD-[0-9]+` headings = 137 (135 136 137); `git grep -n 'DD-138' -- .` empty. `git log -8 -- docs/standards/decisions.md`: `29373c9` (2026-10-19, kit sync 43 = PR #80, v2.59 DD-107 amendment, no new DD number), `ff34b48` (PR #78), then the 2026-10-16 L0 commits: no kit-sync PR #78-#82 added a number |
| Q5 | Where DD-138 goes | sections run newest-first: `## DD-137` `:1747`, DD-136 `:1769`, DD-135 `:1790`, DD-134 `:1812`, DD-133 `:1837`, DD-132 `:1863`, DD-131 `:1900`. Index table `## Bang tong hop` starts `:12`; recent rows are newest-first, DD-137 row `:120`, DD-136 `:121` .. DD-130 `:127`; columns `ID`, bold title plus summary, status, phase, source. `## Quy uoc` `:6`, `## Changelog` `:3757`, first data row `| 19/10/2026 | v2.59 |` `:3761` (then v2.58 `:3762`). Heading shape of DD-133..DD-137: `## DD-137 - <title> (D5) - <status wording>`, a blank line, a banner blockquote, then `- **Boi canh.**` and `- **De xuat.**` bullets. Pending wording: `🟡 Đề xuất (chờ owner ký, <date>)` |
| Q6 | Backlog rules | header `docs/autopilot-backlog.md:1-60`: `## Cach bot quet` (the bot scans `## task:` blocks with `status: planned` or `ready` only; `idea`, `in-flight`, `merged`, `blocked` are skipped) and `## Lifecycle` (`idea` to `planned` to manifest to `ready` to `register` to `in-flight` to merge to `merged`; `blocked` added 2026-07-22; `superseded` defined in the 2026-08-11 note: the row never entered its own lane and the deliverable landed through another lane). `task_kind` is NOT in the backlog header: it is defined at `docs/autopilot-templates/autopilot-invariants.md:159-161` (implementation = `merged_probe`, rollout = `rollout_probe`, evidence = `evidence_probe`, operation = `operation_probe`, decision = `decision_probe`; never let a merged code symbol authorize a live operation, rollout or evidence row) and appears on 4 backlog rows only (`:6333 :6358 :6376 :6400`, all `implementation`). `merged_probe` rule: `autopilot-invariants.md:168` (a slice-unique code symbol, verified ABSENT at author time) and `scripts/autopilot-backlog-reconcile:226` `is_symbol_probe` (every alternation token must match `[A-Za-z_][A-Za-z0-9_]*`; the auto-flip path is `:447`). Counts: 98 rows `status: merged`, 13 `status: superseded`, 11 `superseded_by:` |
| Q6 | How a row is flipped by hand | precedent `web-bot-vnd-display-convention` (heading `:5939`): `status: merged` `:5941`, then `merged: 2026-10-15 · PR #57, merge <40-hex> · <symbol> at <file:line>; merged_probe stays null (<reason>)` `:5942`, then `note_merged:` naming the hand-close date and the SHA `:5943`. A partial delivery is not flipped: a dated `UPDATE <date>` line records it (precedent `UPDATE` lines of `session-publish-public-projector`, `:3455` block) |
| Q6 | The 13 example rows | section 6 group D lists each with line, status and probe line (all 13 exist) |
| Q7 | No new LIVE TRUTH block in `docs/00-start-here/HANDOFF.md` | `:1-11`: `:3` read-first banner, `:5` the update line listing block dates, `:7` newest block `LIVE TRUTH 2026-10-12 (v1.44)`, measured at `main@0db92b9`, `:10` points readers to the ledger `../sessions/web-mvp-program-status.md` (only the primary agent writes it). `:139-141` is a reading-order rule (newest block on top), not a trigger rule; grep for any rule that requires a block at a closeout returned no such text. `git log -8 -- docs/00-start-here/HANDOFF.md`: blocks came with authority-chain re-pin commits and the DD-122 owner decision (`65f69fa`, `0f6a058`); no Phase 3 lane PR touched the file, L0 included. Choice: the repo convention does not require a block; handoff-3 and the ledger carry the Phase 3 state; HANDOFF.md is neither edited nor in TARGET_FILES |
| Q8 | Validator scan roots and markers | `scripts/check-review-readiness.mjs` (895 lines): `--changed` (`:872`) scans `git diff --name-only --diff-filter=ACMR HEAD -- docs` plus untracked files under `docs` (function `changedMarkdown`), `.md` only, so it diffs against HEAD and is vacuous after the commit; `--all` walks `docs/` recursively (`validateRepository`, `walkMarkdown` `:646`). `plans/` is NOT scanned. A file is a candidate when its basename matches `(^|[-_.])(review|readiness|plan)([-_.]|$)` (`:15`) or it holds a line starting with the verdict keyword anywhere, fenced lines included (`:591-592`); a candidate needs the directive in its first 30 lines (`:602`, else DIRECTIVE_MISSING); a code-ready file may hold only active CODE_READY verdict blocks (`:612-638`); AUTHORITY_SHA must be a full 40-char commit that is an ancestor of main (`:197-229`); TARGET_FILES must be exact existing paths (`:242-285`) |
| Q8 | Marker per changed file | this readiness file (name has `readiness`): `<!-- review-readiness: code-ready -->` on line 1. `plans/261012-1400-web-mvp-program/plan.md`: basename matches the name regex but `plans/` is outside the scan roots: no marker. `decisions.md`, the ledger, `autopilot-backlog.md`, both runbooks, `HANDOFF.md`, handoff-2: names do not match and a count of lines starting with the verdict keyword is 0 on each of the eight L17 candidate files: no marker (the ledger and handoff-2 carry no directive today). NEW `2026-10-21-web-mvp-program-handoff-3.md`: its name has none of review, readiness, plan: no marker, provided NO line of it starts with the verdict keyword (a quoted verdict block would make it a candidate) |
| Q9 | Owner P0 facts | `.env.example:99 OUTBOX_DISPATCH_SCHEDULE_ENABLED=false` (the ENABLEMENT BLOCKER comment starts `:83`); `.env.example:173 GENDER_COLLECTION_ENABLED=false`; `infra/docker-compose.yml:132 OUTBOX_DISPATCH_SCHEDULE_ENABLED: "false"`; readers `apps/bot/src/worker.ts:45` (`enabled: false` when the value is not the string true), `apps/web/app/api/me/profile/route.ts:32`. Both flags are false in every committed file. `docs/runbooks/outbox-dispatch-enable-rollback.md` exists (98 lines) |
| Q9 | Announce route with the dispatch flag off (PR #69, L4b) | `apps/web/app/api/sessions/[id]/announce/route.ts:10-12`: the command checks DB truth (a fresh worker heartbeat with the dispatch schedule live, and `zalo_dm` enabled) inside its own transaction and otherwise refuses with `ANNOUNCE_DELIVERY_DISABLED` (409) writing nothing; no process env is read for that decision. Test `route.test.ts:117` `R-T3 ANNOUNCE_DELIVERY_DISABLED -> 409, data null, no announced key`; `:154` `R-T6 OUTBOX_DISPATCH_SCHEDULE_ENABLED=true in the web env changes nothing: a refusal is still 409`. So with the flag off no live schedule exists and the route delivers nothing (inference from `route.ts:10-11` plus `worker.ts:45`; the 409 refusal itself is asserted by the test) |
| Q10 | Golden path | `apps/web/e2e/golden-path.config.ts` and `golden-path.spec.ts` exist; 4 `test(` titles: `:44` host (club, session, publish, collect with partial and reversal, close), `:270` player (published session, my sessions, my charges), `:378` chat (two members chat live, unread badge advances and clears), `:471` member chat (member and admin chat live). `golden-path.spec.ts:39 const BASE = process.env.GOLDEN_PATH_BASE_URL;` and `:41 test.skip(!BASE, ...)`. Config header `:11-24`: never runs in CI; `:15-16` command `GOLDEN_PATH_BASE_URL=http://localhost:3000 pnpm --filter @plexco/web exec playwright test --config e2e/golden-path.config.ts`; `:19` the URL is required (port included); optional `GOLDEN_PATH_SCREENSHOT_DIR` and `GOLDEN_PATH_ALLOW_SEEDED_CLUB=1` (a seeded-club pass does NOT prove club creation); reporter `:35` `["./support/golden-path-not-proven-reporter.ts"]` prints the NOT_PROVEN warning last, below the "1 passed" summary |
| Q11 | B3 | the L0 precedent recorded an explicit B3 exception (modules named, why one lane, compatibility proof); L17 follows it, section 4 |
| Q12 | Language per file (lowercase Vietnamese letters, `LC_ALL=en_US.UTF-8`, `grep -c -E`) | ledger 80 of 111 lines; handoff-2 1 of 171; smoke runbook 102 of 204; outbox runbook 49 of 98; plan.md 0 of 51 (all five orchestrator numbers re-measured EXACT); also decisions.md 2853 of 3926, HANDOFF.md 397 of 549, backlog 2370 of 6419 |
| Base | Baseline checks at the base | `pnpm review:check` PASS (73 classified documents, 76 active verdict blocks, mode=all); `pnpm kit:check` audit PASS (27 files under `scripts/` classified); `scripts/autopilot-backlog-reconcile --check` exit 0, 67 lines: 0 warning lines, 4 `✗` lines (WEAK-PROBE `local-dev-sanctioned-paths-are-harder-than-the-forbidden-one`; `close_by REFUSED` for `gates-that-fire-correctly-and-cannot-say-why`, `email-password-bundle-order-4` and `session-publish-public-projector`), 3 `✓`, 37 `?`, ending with 2 NOTE lines (1 declared close_by, 1 weak probe). The script prints a harmless sandbox denial for github.com:443 |

## 3. Kit-owned files (the writer must NOT touch)

The kit pack (`pack_pairs()` of the canonical kit; repo authority `docs/standards/kit-pack-membership.json`, checked by `pnpm kit:check`) owns the scope gate, the readiness validator and its helpers, `scripts/autopilot-backlog-reconcile`, `scripts/codex-review-pin.sh`, `scripts/ap-finish.sh`, `scripts/ap-evidence.sh`, `scripts/ap-housekeep.sh`, the GENERIC prompt, `level3-workflow.md` and the manifest templates. Measured: a grep of the membership file for the L17 target basenames (backlog, decisions, smoke runbook, outbox runbook, ledger, plan.md, HANDOFF) returns 0 hits, while the control token `autopilot-scope-gate` returns 4. None of L17's files is in the pack, so `pnpm kit:check` is unaffected. `docs/autopilot-templates/autopilot-invariants.md` (the `task_kind` rule) and the reconcile script are read only.

## 4. B3 exception (explicit)

Default budget is about 300 LOC, 3 modules, 1 migration. L17 is docs only: 0 migrations, 0 code. It exceeds the module budget on purpose.

- Modules touched (named): (1) `docs/standards/` (`decisions.md`: DD-138 section, index row, changelog row); (2) `docs/sessions/` (the ledger, the NEW handoff-3, this readiness file); (3) `docs/autopilot-backlog.md` (row flips and dated updates); (4) `docs/runbooks/` (`local-mvp-smoke.md` edit, `outbox-dispatch-enable-rollback.md` cross-check, edit only if a fact is wrong); (5) `plans/261012-1400-web-mvp-program/plan.md` (status pointer). That is 5 modules and about 6 files (5 edited, 1 new, plus this file).
- Why one lane: a closeout states one program state at one measured SHA. The ledger rows, handoff-3, DD-138, the backlog flips and the runbook all cite the same merged PR set and the same base, and the golden-path evidence is recorded at that SHA. A split would leave cross-references (DD-138 to handoff-3, ledger to backlog) pointing at facts that moved between two PRs.
- Compatibility proof: `git diff --name-only 0a4e1b8e9b146c04884b3ee2ff234cc6646fcc72..HEAD` must list only `docs/` and `plans/` paths; prettier ignores `docs/` and `*.md` (Q3); no file is in the kit pack (section 3); no table, column, migration, route or code symbol is created or changed; rollback is a revert of the single docs PR.

## 5. Defaults pinned (each: default applied, pending owner sign-off; repeat in the PR body)

| # | Default | Value |
|---|---|---|
| P1 | Handoff file | NEW `docs/sessions/2026-10-21-web-mvp-program-handoff-3.md`, English, same pattern as `2026-10-14-web-mvp-program-handoff-2.md`. Named under scope, never in TARGET_FILES. Date = the writing date at the base measurement; the file name, the DD-138 header and the changelog row carry the same date |
| P2 | The one new decision number | DD-138 (max 137, no DD-138 anywhere). Three placements: the section directly above `## DD-137` (`:1747`); an index row directly above the DD-137 row (`:120`); a changelog row `v2.60` directly above the v2.59 row (`:3761`, date format `21/10/2026`). Bump any version marker in the decisions.md header exactly as L0 did for v2.58 (read L0 group A, `docs/sessions/web-mvp-phase3-readiness-p3-docs-decisions-sync.md:85-99`). Status `🟡 Đề xuất (chờ owner ký, 2026-10-21)`. Vietnamese prose in the DD-133..DD-137 style: heading, banner blockquote, bullets. No other decision entry is edited or renumbered |
| P3 | Entry table shape | one table, one row per default: `ID`, `Value`, `Lane and PR`, `Status` (the literal "default applied, pending owner sign-off"), `One-line reason`, `Source`. ID = the lane slug plus the default's own label copied verbatim from its source (for example the label used in that readiness file), or the PR number plus label for a default that lives only in a PR body |
| P4 | Sources of the defaults | the 26 files `docs/sessions/web-mvp-phase3-readiness-p3-<x>.md` (lines containing "pending owner sign-off": ci-flake-hardening 2, docs-decisions-sync 2, m10-chat-api-live 27, m10-chat-author-labels 1, m10-chat-core 5, m10-chat-member-entry 2, m10-chat-moderation-ui 3, m10-chat-viewer-capabilities 7, m10-chat-web 3, m6-announce-route 9, m6-outbox-delivery-core 2, m6-visibility-toggle 1, m6-web-live-sync 2, m6-zalo-outbound 3, m9-channel-identity-link-gate 7, m9-discovery-read 24, m9-gender-pricing 30, m9-join-core 1, m9-me-reads 1, m9-occupancy-helper 10, m9-player-web 22, m9-public-alias-moderation 1, m9-public-projector 22, m9-zalo-player-commands 33, osv-advisories 2, session-text-control-chars 1) plus the PR bodies of #88, #89, #90 and #91 (L15b, L16, L16c, L16b), read with `gh pr view <n> --json body`. A default an owner later approved is listed as owner-approved (P5), not pending |
| P5 | Owner-approved items | listed in a separate short list of the entry: R1 of B-A1 (2026-10-19); "Labels ok" (L15a); "moderation ok" (L15b, L16b); "Member chat ok" plus a terminal confirmation (L16c), each with the owner's words and date from its source (section 1 rule) |
| P6 | Spec follow-ups | the entry cites six Reviewed-spec lines as follow-ups (Q4). L17 does NOT edit either spec (Reviewed; L0 and the owner own spec sync): for each line the entry says in one line what the shipped code does instead, taken from the owning lane's readiness file and PR body, or omits the line if no divergence is found |
| P7 | HANDOFF.md | no new LIVE TRUTH block, no edit (Q7) |
| P8 | Backlog flip criteria | a row is flipped only when all hold: (F1) a merged lane PR's readiness file or PR body names the row's deliverable as delivered; (F2) `gh pr view <n>` = MERGED and the merge commit is an ancestor of the final base; (F3) for a code symbol claim the identifier is present at the final base (`git grep -n -w <ident> <base>`), cited with file:line. Partial or unproven: no flip; one dated `UPDATE 2026-10-21` line names the merged PR and what remains, or the row goes to the handoff-3 open list |
| P9 | Probe rules | a row uses exactly the probe of its `task_kind`; none of the 13 rows carries `task_kind`, so each is `implementation` (`merged_probe`). A `merged_probe` written during a flip is a bare identifier, slice-unique, present at the final base and ABSENT at the pre-merge parent (`git grep -n -w <ident> <merge-sha>^1`). Where no such identifier exists the row keeps `merged_probe: null` with the reason in the `merged:` line (the `:5942` precedent). A hand flip changes only `status`, `merged` and `note_merged` (or `superseded_by`) lines |
| P10 | `session-publish-public-projector` (`:3455`, blocked) | value `status: superseded` with `superseded_by` naming PR #72 (public projector, merged 2026-10-17) and the lanes that delivered the projector, because the header defines `superseded` for a row that never entered its own lane while its deliverable landed through another lane; L0's group D already treated this row's contract and manifest as stale. If the writer finds PR #72 does not deliver the row's projector, the row stays `blocked` with a dated `UPDATE` line |
| P11 | The two feature-level rows (`:855`, `:865`: `scope: []`, no probe) | flipped only under P8 with the delivering PRs named and any uncovered part stated; the two specs still read `Implementation: Not started` (`feature_cross_club_join.md:7`, `feature_marketplace_discovery.md:7`): L17 reports that under OPEN and does not edit the Reviewed specs. Default when F1 cannot be shown: stay `idea`, listed in handoff-3 |
| P12 | Golden-path evidence | run `apps/web/e2e/golden-path.config.ts` with `GOLDEN_PATH_BASE_URL` on the final main under the shared local lock (one DB suite or e2e run at a time; never `docker compose down -v`); paste the measured result and the not-proven reporter output with the named SHA. If Docker or the port is unavailable write `NOT RUN: <reason>`, never a pass. The run never enables dispatch for real use |
| P13 | Language | decisions entry and ledger rows Vietnamese; handoff-3 English; plan.md pointer English; runbooks keep their current mixed language; backlog rows follow the row's own language; this file English with no Vietnamese diacritics inside text fences |
| P14 | Owner P0 steps (handoff-3 list, none marked done) | enable `OUTBOX_DISPATCH_SCHEDULE_ENABLED` (false in `.env.example:99`, `docker-compose.yml:132`); connect a real Zalo bot token; message real users. The announce route (PR #69) ships, and refuses with 409 `ANNOUNCE_DELIVERY_DISABLED` until the schedule is live (Q9); D2 (f) is signed, so it is not parked. `GENDER_COLLECTION_ENABLED` stays false (`.env.example:173`) until the owner enables it |

## 6. EDIT INVENTORY (writer follows; every path:line at base)

### A. `docs/standards/decisions.md` (DD-138 only)
- Section above `:1747`, index row above `:120`, changelog row v2.60 above `:3761`, optional version marker per P2. The entry body: banner blockquote, `Boi canh` bullet (Phase 3 closed, which lanes applied defaults), `De xuat` bullet, the P3 table, the P5 owner-approved list, the P6 follow-ups. Touch no other entry; rewrite no dated row.

### B. `docs/sessions/web-mvp-program-status.md` (ledger)
- Rows `M6` `:29`, `M9` `:32`, `M10` `:33` currently read "no PR yet": set each to the measured state with the merged PR numbers from the Q1 map (M6: #63 #64 #66 #67 #69; M9: #65 #68 #70 #71 #72 #74 #76 #77 #84 #85; M10: #83 #86 #87 #88 #89 #90 #91) and the measuring SHA; add a dated paragraph to the update block (`:7-12`) with the base `0a4e1b8e9b146c04884b3ee2ff234cc6646fcc72`, tail migration `0066`, 67 files. Every number carries its SHA. Never mark an owner P0 step done.

### C. `plans/261012-1400-web-mvp-program/plan.md`
- The `Status pointer (2026-10-16)` blockquote (`:9`): extend to name the ledger and handoff-3 as current; English.

### D. `docs/autopilot-backlog.md` (rows named by the lane block; line and status at base; flip per P8-P11)

| # | Slug | Line | Status | Probe line | Named in the readiness file of (candidate PR) |
|---|---|---|---|---|---|
| 1 | app-worker-test-password-clash-flake | `:5960` | idea | `merged_probe: null` | ci-flake-hardening (#62) |
| 2 | dev-app-worker-password-not-restored | `:2068` | idea | none | ci-flake-hardening (#62) |
| 3 | db-test-unhandled-57p01-and-load-timeouts | `:5980` | idea | `null` | ci-flake-hardening (#62) |
| 4 | e2e-web-pwa-offline-online-flake | `:5999` | idea | `null` | ci-flake-hardening (#62) |
| 5 | session-text-fields-control-char-validation | `:6275` | idea | `null` | session-text-control-chars (#61) |
| 6 | list-sessions-occupied-count-single-source | `:6127` | idea | `null` | m9-occupancy-helper (#65) |
| 7 | projector-real-replace-stub | `:5176` | planned | text "none, not built; probe = first projector name (the lane sets it)" | m6-outbox-delivery-core (#64) |
| 8 | db-projector-dlq-no-replay-path | `:2812` | idea | none | m6-outbox-delivery-core (#64) |
| 9 | job-outbox-dispatch-sync-lag-slo | `:2822` | idea | none | m6-outbox-delivery-core (#64) |
| 10 | job-scheduler-cron-registration | `:1552` | idea | none | m6-outbox-delivery-core (#64) |
| 11 | session-publish-public-projector | `:3455` | blocked | `null`, `close_by: hand` | docs-decisions-sync (7 mentions); delivered by #72 (P10) |
| 12 | feature-cross-club-join | `:855` | idea | none (`scope: []`) | spec cited by m9-join-core (#68); P11 |
| 13 | feature-marketplace-discovery | `:865` | idea | none (`scope: []`) | spec cited by m9-discovery-read (#74) and m9-public-projector (#72); P11 |

- "Named in" is the candidate, not the proof: the writer reads that mention and flips only if it says the lane closes the row (F1). Rows 7-10 share one mention each in the #64 file; row 9 (sync-lag SLO) may be measured by a later lane, so check before flipping.
- Row 7 is the only `planned` row of the 13: after a flip the `?` line of `scripts/autopilot-backlog-reconcile --check` for it disappears; after the row 11 flip its `✗ close_by REFUSED` line disappears. The check count can only go down (V5).

### E. `docs/runbooks/local-mvp-smoke.md` (102 of 204 lines Vietnamese: keep the language)
- Headings: `## 9. Click path golden path` `:123`, `## 10. Chay tu dong (Playwright, chi local)` `:150`, `## Xu ly su co` `:177`, `## Don dep` `:192`. Add the player journey and chat journey steps (the four spec titles, Q10), the readonly and discovery wiring the player and chat paths need, and the extended command (Q10 `:15-16`, env `GOLDEN_PATH_BASE_URL`, `GOLDEN_PATH_SCREENSHOT_DIR`, `GOLDEN_PATH_ALLOW_SEEDED_CLUB`) with the NOT_PROVEN reading rule. State only what was run; cite no step that was not run.

### F. `docs/runbooks/outbox-dispatch-enable-rollback.md` (cross-check; edit only if a fact is wrong)
- Headings: safety rules `:8`, preconditions `:22`, enable order `:33`, rollback `:58`, DLQ check and replay `:69`, sync lag `:87`. Cross-check against Q9 (flag values and lines) and DD-134 (f); the runbook is L3's file, keep its language.

### G. NEW `docs/sessions/2026-10-21-web-mvp-program-handoff-3.md` (English)
- Contents (DONE WHEN): the state at the base (PR map, tail migration `0066`, open PR #50 owner-only); open proposals (the defaults applied, pending sign-off, pointing at DD-138); the owner P0 steps (P14, none marked done); the announce route statement (Q9); the golden-path evidence (P12); rows left unflipped; the OPEN list of section 7. No line starts with the verdict keyword (Q8). Claim no live delivery, production or staging.

## 7. Out of scope: report under OPEN, do not edit

- Spec lines `feature_inapp_chat_tech.md` `:944 :1140 :1158 :1169` and `feature_player_view_tech.md` `:278 :287`, and the two `Implementation: Not started` headers (P6, P11): reported, not edited.
- `docs/00-start-here/HANDOFF.md`, any Reviewed spec, any kit-pack file, any code, test or migration.
- PR #50 (open, owner-only, frozen) and PR #75 (closed, in no lane list).
- Enabling the dispatch schedule for real use, a real Zalo token, messaging real users: owner P0, listed in handoff-3, never done by an agent.
- The "OSV full dependency scan" check (red on main, owner timing): ignored for CI-green judgements.

## 8. Verification the writer must run (cite measured output, `| tail -40`)

| # | Command | Expected |
|---|---|---|
| V1 | `git diff --name-only 0a4e1b8e9b146c04884b3ee2ff234cc6646fcc72..HEAD` | only `docs/` and `plans/` paths; no kit-pack file (section 3) |
| V2 | `pnpm format:check` | exit 0 (vacuous for docs, Q3) |
| V3 | `pnpm review:check:changed` BEFORE each commit, then `pnpm review:check` | PASS; base is 73 documents and 76 blocks, this file adds one of each |
| V4 | `pnpm kit:check` | audit PASS |
| V5 | `scripts/autopilot-backlog-reconcile --check` | exit 0 and no new warning or `✗` line versus the base counts (0 warnings, 4 `✗`); only decreases allowed |
| V6 | per flipped row: `gh pr view <n> --json state,mergeCommit` and `git merge-base --is-ancestor <merge> <final base>` | MERGED and rc 0; sandbox off for gh |
| V7 | per `merged_probe` written: `git grep -n -w <ident> <base>` and the same at `<merge>^1` | present at the base, absent at the parent |
| V8 | every `path:line` and SHA written into any doc | re-checked with `git grep -n`, `sed -n` or `git cat-file -e <sha>^{commit}` at the final base |
| V9 | the CLAUDE.md language check on text-fenced blocks of every new or changed prompt-bearing file | empty |
| V10 | a count of lines starting with the verdict keyword in each L17 file except this one | 0 (Q8) |
| V11 | golden path (P12) | measured result at a named SHA, or `NOT RUN: <reason>` |
| V12 | if `origin/main` moved after the base: `git merge --no-ff origin/main`, resolve mechanically, re-run V1-V5 | same results; a semantic conflict is reported, not guessed |

Review plan: one sonnet/high reviewer, max 3 rounds. Questions: every flipped row has a merged PR that names its deliverable (F1-F3); every number carries its measuring SHA; the owner steps are listed and none is claimed done; the owner-approved items are not listed as pending; DD-138 is the only new decision number and the three placements are right; only `docs/` and `plans/` changed.

## 9. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` below equals `git rev-parse origin/main` after `git fetch origin`; every TARGET_FILES path exists in the worktree | PASS |
| 2 | Decisions in scope are final | D2 (a)-(f) signed (`decisions.md:1833`); the only new decision, DD-138, is a record of applied defaults marked pending, not a new product decision | PASS |
| 3 | Scope IN/OUT and owner clear | sections 6 and 7; docs only; kit files excluded (section 3) | PASS |
| 4 | Dependencies classified | every Phase 3 lane PR merged with probes (Q1); #50 is owner-only and not a dependency | PASS |
| 5 | Live schema and code match the claims | Q2 (tail 0066), Q4, Q5, Q9 and Q10 measured against files and `git grep` | PASS |
| 6 | Data, API, state and auth contract complete | not applicable beyond HARD RULES: no behavior changes; money and PII facts are not touched | PASS |
| 7 | Fail-closed, idempotency, order | not applicable (no runtime behavior); flips are fail-closed by F1-F3 (no flip without a named merged PR) | PASS |
| 8 | Open questions in scope = 0 | defaults P1-P14 pinned as "default applied, pending owner sign-off"; residue in section 7 | PASS |
| 9 | Acceptance matrix has expected results | section 8, V1-V12 | PASS |
| 10 | Migration, security and rollback pinned | no migration, no secret, no PII, no local path in repo files; rollback = revert the single docs PR | PASS |
| 11 | First slice has hard dependency merged | the base is `main` containing #91; every lane is merged | PASS |
| 12 | Implementation handoff ready | inventory with line anchors, defaults table, verification table, B3 exception | PASS |

## 10. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-21
AUTHORITY_SHA: 0a4e1b8e9b146c04884b3ee2ff234cc6646fcc72
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/sessions/web-mvp-program-status.md
  - plans/261012-1400-web-mvp-program/plan.md
  - docs/autopilot-backlog.md
  - docs/runbooks/local-mvp-smoke.md
  - docs/runbooks/outbox-dispatch-enable-rollback.md
SLICE: p3-closeout
IN_SCOPE: close Phase 3 as docs only: ONE consolidated decision entry (DD-138, pending owner sign-off) listing every default applied by the lanes; ledger rows M6, M9 and M10 with PR numbers and the measuring SHA; the NEW docs/sessions/2026-10-21-web-mvp-program-handoff-3.md; the plan.md status pointer; backlog flips for rows whose merged PR names the deliverable (criteria F1-F3); the smoke runbook player and chat journey, readonly and discovery wiring and the extended golden-path command; the outbox runbook cross-check; the recorded golden-path run (measured at a named SHA or NOT RUN with the reason)
OUT_OF_SCOPE: any code, test or migration; any decision number except DD-138; edits to Reviewed specs; docs/00-start-here/HANDOFF.md; kit-pack files; marking any owner P0 step done; any claim of live delivery, production or staging; PR 50; flipping a backlog row without a merged PR that names the deliverable
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: all merged with probes (every Phase 3 lane PR 58-74, 76, 77 and 83-91 is MERGED; PR 91 merge 0a4e1b8e9b146c04884b3ee2ff234cc6646fcc72 is an ancestor of origin/main and is the base; open PR 50 is owner-only and not a dependency)
PRIOR_SLICES: every Phase 3 lane (L0 to L16c) merged, see Q1
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # docs only, no migration or secret; the dispatch flag stays false in every committed file
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: section 6 group A on docs/standards/decisions.md (collect the applied defaults from the 26 readiness files and the PR bodies of 88 to 91, add the DD-138 section above DD-137 with its index row and the v2.60 changelog row), commit it, then groups B to G
REMAINING_BLOCKERS: none
```
