<!-- review-readiness: code-ready -->

# Step-0 readiness: L19 p3-owner-decisions-2026-10-21 (session P3-S15)

> Agent-facing. Readiness reviewer: opus/high (same model and effort as the lane's code reviewer). Writers: sonnet/high, one file or one section per writer. Docs only; no security round (that judgement is void if the diff holds any path outside `docs/`).
> Lane block: L19 p3-owner-decisions-2026-10-21 of the P3-S15 RUN brief (conductor-authored under the owner's terminal confirmation quoted in section 1). Shape: the docs-only precedent `docs/sessions/web-mvp-phase3-readiness-p3-closeout.md` (L17).
> Every number below is MEASURED at base `3a97c7b650200a327d9ad705a8813619a1c528c9` (merge of PR #92) in the lane worktree: branch `docs/p3-owner-decisions-2026-10-21`, HEAD = base, `git status --porcelain` empty, no `index.lock`, nothing committed before this file.
> Section 2 answers the lane's step-0 questions Q1-Q5. A grep that returned nothing was checked against a known-present control case. Line numbers are base lines: edit by anchor text (or bottom-up), since every insertion shifts the lines below it.

## 1. Authority

- Owner confirmation, typed in the conductor terminal on 2026-10-21 (verbatim): "Owner confirms "Claude outputs/plexco-phase3/OWNER-DECISIONS-2026-10-21.md" in full (sections A, B, C). #92 is merged: record the DD-138 sign-off as written in A, record B1-B4 as new DD entries, then run a new session for B1, B2, B3 and the R1-5 lane (one lane each, migrations serialized), and add the C rows to the backlog."
- The owner's decision text of 2026-10-21 (sections A, B and C) lives outside the repository. Every record this lane writes quotes the owner's words itself (verbatim, English as written) and never cites only that path: a tracked document citing an untracked file is a dangling reference.
- Owner decisions needed: none. The decisions are the owner's; L19 records them. A wording that would change their meaning, or a place where the owner text is ambiguous for a record, goes to the conductor as a ruling request BEFORE a writer writes it.
- Base: after `git fetch origin` (2026-10-21), `git rev-parse origin/main` = `git rev-parse HEAD` = `3a97c7b650200a327d9ad705a8813619a1c528c9`, subject "Merge pull request #92 from maingocanh1702/docs/p3-closeout". #92 (`0a4e1b8e9b146c04884b3ee2ff234cc6646fcc72..3a97c7b`) changed only `docs/` and `plans/` paths (0 other paths). The dependency "#92 merged" holds: its merge commit is the base.

## 2. Live truth measured at the base (Q1-Q5)

| Q | Fact | Evidence at base |
|---|---|---|
| Base | Both flags committed false; backlog reconcile clean | `.env.example:99` `OUTBOX_DISPATCH_SCHEDULE_ENABLED=false`, `.env.example:173` `GENDER_COLLECTION_ENABLED=false`. `scripts/autopilot-backlog-reconcile --check` (runs its own `git fetch origin --quiet`, probes `origin/main`), run once at the base: exit 0, 63 lines; STALE 0, `⚠` 0, `✗` 3 (1 WEAK-PROBE, 2 close_by REFUSED), `no merged_probe` 36, `⊘ manual-close` 1, AGED 0, MALFORMED 0, HALT 0; 2 NOTE lines (1 declared close_by, 1 weak probe). The writer's before-run prints the names of the three `✗` rows |
| Q1 | Next free numbers: DD-139 = B1, DD-140 = B2, DD-141 = B3, DD-142 = B4 | `docs/standards/decisions.md` (4696 lines) has 131 `## DD-` headings (DD-106 twice, :4341 and :4409); highest `## DD-138` :1748. `git grep -n 'DD-139\|DD-1[4-9][0-9]' HEAD -- .` = 0 hits repo-wide (control: DD-138 is mentioned 5 times in decisions.md) |
| Q1 | Entry order | DD-01..DD-99 ascending from :163; DD-104..DD-100 at :1559-:1735; then newest first: DD-138 :1748, DD-137 :2516, DD-136 :2538 ... DD-105 :4479. Separator blank / `---` / blank at :1745-:1747 and :2535-:2537 (DD-138 -> DD-137 at :2514-:2515 lacks the `---`; inside DD-138's tail, out of scope) |
| Q1 | Summary table `## Bảng tổng hợp` :12 | header :19 (columns ID, Quyết định, Trạng thái, Phase, Nguồn), separator :20; DD-01..DD-98 ascending :21-:119; newest-first block from DD-138 :120 (DD-133 :125 ... DD-99 :159). DD-138 row :120 status `🟡 Đề xuất (chờ owner ký, 2026-10-21)` |
| Q1 | Version table `## Changelog` :4526 | header :4528 (columns Ngày, Version, Thay đổi), separator :4529, dates DD/MM/YYYY; newest row :4530 `21/10/2026` `v2.60` (DD-138). Next = v2.61. No version marker in the file header (:1-11) |
| Q2 | The seven DD-138 rows, all in the lead table "Quyết định cần mắt chủ" (:1772; header :1776; Status = 5th column; every row `default applied, pending owner sign-off`) | :1780 `p3-osv-advisories D-8` · :1782 `#61 R1-5` · :1784 `p3-m6-outbox-delivery-core D-14` · :1790 `p3-m6-zalo-outbound Z-13` · :1796 `p3-m9-me-reads M-7` · :1816 `p3-m9-gender-pricing U-15` · :1822 `p3-m9-zalo-player-commands P-11`. Z-13 is a LEAD-table row: the L4 per-lane table (:1994, rows :1998-:2014) has no Z-13 |
| Q2 | Colliding bare ids (always the full key) | M-7 also :1804 `p3-m9-public-alias-moderation M-7`; D-8 also :1918, :1978, :2359; P-11 also :2106, :2153, :2177, :2224; D-14 also :2365; P-7 also :2104, :2173, :2220, :2263; M-11 also :2131 `p3-m9-public-alias-moderation M-11` (the signed exception is the :1835 subsection, `#90 DF-7` at :1841). Z-13, U-15 and R1-5 are unique |
| Q2 | The P-7 row B4 names | :1809 `p3-m9-public-projector P-7` (suspended or cancelled tenants never projected, never served): unchanged |
| Q2 | Subsections to make current | :1835 `### Ngoại lệ quyết định M-11 (L16c · #90) — chờ owner ký riêng` (:1843 requires the owner's signature to name M-11; A.3 names it); :1874 `### Thay đổi CI theo yêu cầu owner (P3-CI · #73) — xin owner xác nhận` (a :1878, b :1879, the request :1881) |
| Q2 | DD-06, DD-51, DD-133, DD-134 anchors | DD-06 heading :231, blockquote :232 directly under it, body :234-:237, summary row :26. DD-51 heading :712, :713 blank, blockquote :714, rule :716 ("trễ invoice → grace 7 ngày (past_due) rồi suspended"), Hệ quả :717, summary row :72. DD-133 summary row :125. DD-134 summary row :124 lists (a)-(f) only, no override (no edit); the override is quoted at :1763 and :2602. Status style: DD-01 row :21 `🔄 Điều chỉnh bởi DD-50 (...)`; pointer styles :3134 (blockquote) and :470/:473 (inline) |
| Q2 | Other decision-log places restating the changed rules (NOT edited; section 7) | DD-06: rows :94, :99, :119; :470, :471, :614, :619, :622, :625, :1024, :1047, :1119, :1494, :1502, :3150; inside DD-138 :1898 `p3-docs-decisions-sync P3`, :2112 `p3-m9-join-core P-18`, :2219 `p3-m9-player-web P-6`; rows :65 and :106 matched "venue" (unverified). DD-51: :77, :196, :753, :3846, :3928, :3949, :4488. DD-133 D1: :470, :473, :648, :1761-:1762, :1802, :1805, :1898, :2073, :2126-:2133, :2625. DD-134 override: :1763, :2598, :2602. Changelog rows are dated history, never rewritten |
| Q3 | Reviewed specs stating the rules B1, B2, B3 (and B4) change | section 6 (c) lists, every line read at HEAD; Reviewed status read from each candidate file's header (lines 1-40 at HEAD, 41 files) under rule P1 (section 5). B4 query: `git grep -n -e 'DD-51' -e 'grace' -e 'suspended' HEAD -- docs/features docs/channels docs/product` = 199 hits in 31 files, classified B4-a (rule), B4-b (billing label), B4-c (not contradicted) |
| Q4 | Backlog shape and probes | `docs/autopilot-backlog.md` 6519 lines; shape = the six rows #92 added; new blocks append after :6519. Probe rule in `scripts/autopilot-backlog-reconcile`: :136-160 (format, DISCRIMINATOR), :221-268 (`is_symbol_probe`: every token `^[A-Za-z_][A-Za-z0-9_]*$`; close_by guards MALFORMED and ABUSE), :330-360 (`scope_can_carry_symbol`: scope entries `docs/*`, `*.json`, `*.yaml`, `*.yml`, `*.lock`, `*.md` and basenames `eslint.config.*`, `.*rc`, `.*rc.*`, `*.lock` cannot carry a symbol; any other entry, or an empty scope, makes close_by REFUSED). `--check` never parses `idea` rows (header :24); a `blocked` row names who, with what, and the condition back to `ready` (header :16-22). The header defines no `task_kind` field. Probe absence (`git grep -c`, whole tree): `PublicSessionSharePage` 0, `PlayerLeaveSessionButton` 0, `downgradeLateHostProTenantToFree` 0; control `GET` in `apps/web/app/api/discover/share/[slug]/route.ts` = 2. Slug collisions with existing `## task:` blocks: 0 for all seven |
| Q5 | Gate, template, validator | `docs/standards/review-code-readiness-gate.md` §2.1 :37-53 (G1-G6), §7 :233-278 (verdict template), §8 :280-299 (12-row closure matrix); `docs/templates/review-doc-plan-session-template.md` §5 :148-206; `scripts/check-review-readiness.mjs`: policy `1.3` (:9), directive within the first 30 lines (:12, :602), a code-ready file holds only active CODE_READY blocks (:607-638), 27 required fields (:17-45), CODE_READY gate values (:461-476), `OPEN_QUESTIONS_IN_SCOPE` 0 (:413-420, :502), exact existing TARGET_FILES (:242-285); `--changed` diffs against HEAD and includes untracked `.md` files (:677-684) |

## 3. Kit-owned files (the writer must NOT touch)

`docs/standards/kit-pack-membership.json` (checked by `pnpm kit:check`): 0 hits for the three target basenames (`decisions.md`, `autopilot-backlog.md`, `web-mvp-program-status.md`); control token `autopilot-scope-gate` = 4 hits (re-measured at this review). `scripts/autopilot-backlog-reconcile`, `scripts/check-review-readiness.mjs` and the gate file are read only.

## 4. B3 budget

Default about 300 LOC, 3 modules, 1 migration. L19: 0 migrations, 0 code. Modules: (1) `docs/standards/` (`decisions.md`); (2) `docs/autopilot-backlog.md`; (3) `docs/sessions/` (the ledger and this file) = 3, within budget. LOC: docs only, no cap per the lane block; the writer reports measured line counts per file (`git diff --numstat <base>..HEAD`). No B3 exception is needed. Compatibility: docs only; prettier ignores `docs/` and `*.md`; no kit file (section 3); rollback = revert the single docs PR.

## 5. Readings and defaults pinned (each: default applied, pending owner sign-off; repeat in the PR body)

Readings R1-R15 are orchestrator readings of the lane block: not owner decisions, not conductor rulings. No repository text may word them as an owner approval or a conductor ruling.

| # | Reading or default | Value |
|---|---|---|
| R1 | Z-13 | lead-table row :1790; signed by A.1 (not one of the six exceptions); its "no price in any DM" is amended by DD-140 for the two messages only, as B2 says |
| R2 | U-15 and D-14 | each status cell quotes the owner's words "(flags default false): superseded by decision B3", points to DD-141 and says the owner's quote governs what the supersession covers; DD-141 quotes B3 whole (incl. the probe guard and the real Zalo deliverer and bot token as the owner's P0 step); never mark the whole rows superseded, never say which other parts survive |
| R3 | DD-06 and DD-51 | `## DD-06` and `## DD-51` heading lines unchanged; only the summary rows get the 🔄 status and each entry gets ONE blockquote line under its heading |
| R4 | DD-139 reach | names as reversed or amended only DD-06, `p3-m9-me-reads M-7` and DD-133 D1 for the venue columns; the other decision-log restatements (section 7) are not edited, not named as reversed, and go to the PR body OPEN list as OUT_OF_SCOPE |
| R5 | DD-138 summary row :120 | only its status cell changes |
| R6 | DD-138 rows outside the seven | :2219 `p3-m9-player-web P-6` and :2112 `p3-m9-join-core P-18` not edited; PR body OPEN |
| R7 | B1 surfaces | DD-139 spec follow-ups cover only the surfaces the owner named (public cards, discover detail, player web, /me reads); the B1-b lines (section 7) go to the PR body OPEN list as a question for the owner before L20; no ⬜ Mở is added to DD-139 for it |
| R8 | B3 non-spec docs | DD-141 lists Reviewed specs only; the runbook and other non-spec docs (section 7) go to the PR body OPEN list for L22 |
| R9 | Backlog fields | no `task_kind` field; follow the header and the six #92 rows exactly |
| R10 | A1 overlap | a NEW P0-gating row that cross-references `osv-full-scan-red-on-main-2026-10` (:6231, both GHSA ids at :6246); that row is not edited |
| R11 | Statuses | C5 `idea` (the #92 rows' status for a row with no external blocker); C3 `blocked` (the owner's real bot token) |
| R12 | B4 risk | P1 (billing logic), never P0 (no live production action in the row) |
| R13 | DD-140 follow-up | only `docs/features/BE/feature_zalo_channel_tech.md:222` (the `/join` active outcome); :224 and :225 (idempotent re-render, rejoin after `left`) go to the PR body OPEN list as a question for L21; the owner's quote governs |
| R14 | DD-142 follow-ups | B4-a (rule lines) and B4-b (`suspended` labelled as a billing state) as two labelled compact lists |
| R15 | List form | compact, grouped by file ("path: :l1, :l2"), Reviewed files only |
| P1 | Reviewed status of a follow-up file | a file under `docs/features`, `docs/channels` or `docs/product` counts as a Reviewed spec unless its own header (lines 1-40) marks it Draft or Archived; for an FE design spec the "FE design status" line governs. Measured: BRD.md, PRD.md, TDD.md, ROADMAP.md and `docs/channels/web/ux-sync-design.md` carry no status line (counted: canonical docs inside the lane block's Reviewed-spec trees); `feature_marketplace_fe.md` and `feature_booking_funnel_fe.md` (FE design Draft), `feature_settings_fe.md`, `feature_club.md`, `feature_club_fe.md` and `CRM_DASHBOARD_BRD.md` ("Draft để review") are not Reviewed, so not follow-ups (section 7) |
| P2 | Backlog rows (table below) | slugs, statuses, risks, probes and scopes as listed; `notes: \|` two English paragraphs ending `source: ... · recorded at ...`, where the source cites the decisions.md record (the DD-138 sign-off subsection, DD-142), never the untracked owner file path; no R1-5 row (lane L23) |

| Row | Slug | Status | Risk | Probe and scope |
|---|---|---|---|---|
| C1 | `web-public-session-share-page` | idea | P2 | `merged_probe: apps/web/app/session/[slug]/page.tsx :: PublicSessionSharePage` (L12 P-2) |
| C2 | `web-player-leave-and-cancel` | idea | P2 | `merged_probe: apps/web/app/me/sessions/page.tsx :: PlayerLeaveSessionButton` (L12 P-3) |
| C3 | `zalo-outbound-error-mapping-real-bot-verification` | blocked | P2 | `close_by: hand · owner-evidence-gate: closed by recorded real-bot responses, not by a commit`; scope `[docs/sessions/zalo-outbound-error-mapping-real-bot-evidence.md]`; notes: who = the owner, with the real Zalo bot token; with what = one recorded real-bot response per mapped class; back to `ready` when the token is available (L4 Z-6); related, different task: `zalo-connect-bot-revoked-error-mapping` :6159 |
| C4 | `docs-sync-phase3-owner-decision-spec-follow-ups` | idea | P2 | `close_by: hand · docs-reconcile: Reviewed spec docs only, no symbol`; scope = the follow-up spec files of DD-138 and DD-139..DD-142 (all under `docs/`) |
| C5 | `host-pro-late-invoice-retention-period-decision` | idea | P2 | `close_by: hand · owner decision: closes when the owner records the retention period and read-only vs hidden as a DD entry`; scope `[docs/standards/decisions.md]` |
| A1 | `deps-next-advisories-before-staging-deploy` | idea | P1 | `close_by: hand · dependency-security: a version bump adds no symbol`; scope `[apps/web/package.json, pnpm-lock.yaml]` (`next` declared at `apps/web/package.json:18` `^15.1.4`); P0-gating: fix GHSA-4jqv-mc3x-m676 and GHSA-mcj8-r9mp-w47p before any staging deploy (#50) |
| B4 | `billing-late-host-pro-invoice-downgrade-to-free` | idea | P1 | `merged_probe: packages/core/src/billing-late-invoice-downgrade.ts :: downgradeLateHostProTenantToFree`; `depends_on: [feature-billing-lifecycle]` (:845); built with the billing epic |

C3, C4, C5 and A1 carry no valid merged_probe; they use close_by and go to the PR body's open list with these reasons.

## 6. EDIT INVENTORY (writer follows; every path:line at base)

### A. `docs/standards/decisions.md` (owner-facing Vietnamese prose; the owner's words quoted verbatim in English)

- (a) DD-138: the :1748 heading status becomes the signed status (lane-block proposal `✅ Owner ký 2026-10-21 (trừ 6 hàng, xem "Kết quả ký của owner")`). NEW `### Kết quả ký của owner (2026-10-21)` at :1757, after the header block :1750-:1756 and before `### Đã được owner duyệt (không chờ ký)`: section A verbatim, the confirmation verbatim (section 1), then a Vietnamese reading: signed = every lead row except the six, every per-lane table in full, M-11 (the :1835 exception, L16c · #90), #73 a and b; the six exceptions and Z-13 by full key; ONE sentence that every row it does not name is signed. Status cell of exactly seven rows: :1780 `p3-osv-advisories D-8` signed as TEMPORARY only, fix before any staging deploy (#50), P0-gating backlog row A1; :1782 `#61 R1-5` rejected, follow-up lane L23; :1784 `p3-m6-outbox-delivery-core D-14` superseded by DD-141 (R2); :1790 `p3-m6-zalo-outbound Z-13` signed, "no price in any DM" amended by DD-140 for the two messages only (R1); :1796 `p3-m9-me-reads M-7` rejected, replaced by DD-139; :1816 `p3-m9-gender-pricing U-15` superseded by DD-141 (R2); :1822 `p3-m9-zalo-player-commands P-11` signed, amended by DD-140. The :1835 and :1874 headings become current (M-11 signed by the owner 2026-10-21; #73 a and b confirmed 2026-10-21). No other cell changes.
- (b) Summary table: :120 DD-138 status cell only (R5); NEW rows DD-142, DD-141, DD-140, DD-139 at :120 (between DD-98 :119 and DD-138), same five columns; DD-06 row :26 status `🔄 Điều chỉnh bởi DD-139 (...)` and DD-51 row :72 status `🔄 Điều chỉnh bởi DD-142 (...)` in the DD-01 :21 style; the DD-133 row :125 notes that its D1 is amended for the venue columns by DD-139.
- (c) Four NEW entries directly above `## DD-138` (:1748), order DD-142, DD-141, DD-140, DD-139, blank / `---` / blank between entries and before :1748; shape of DD-133..DD-137 (Bối cảnh → Quyết định → Lý do → Hệ quả); status `✅ Quyết định owner 2026-10-21`; source = section B<n> of the owner's text of 2026-10-21, confirmed by the owner in the conductor terminal; each quotes its B paragraph verbatim and states exactly the surfaces and conditions the owner names (lane block (c)). DD-142 records the retention question (1 to 3 months, read-only vs hidden) as ⬜ Mở inside the entry, keeps `suspended` for non-billing (admin / abuse) use and leaves `p3-m9-public-projector P-7` (:1809) unchanged. No entry claims implementation, enablement or live use.
- (d) ONE blockquote line under `## DD-06` (insert at :232, above the existing `> **Chốt:**` line) and ONE under `## DD-51` (insert at :713, before the blank line and the :714 blockquote), each pointing to its amending entry; no other body change.
- (e) NEW changelog row `21/10/2026` `v2.61` at :4530, above v2.60, describing this lane's changes; no other version row changes.

Spec follow-ups per entry (Reviewed per P1; never edited here; row C4 syncs them). FE = `docs/features/FE/`, BE = `docs/features/BE/`, BRD/PRD/TDD/ROADMAP = `docs/product/`.

| Entry | Reverses or amends | Lane | Spec follow-ups |
|---|---|---|---|
| DD-139 (B1) | DD-06; `p3-m9-me-reads M-7`; DD-133 D1 for the venue columns | L20 | 32 lines: BRD.md:464; PRD.md:241, :245, :257, :373; TDD.md:284, :673, :675, :685, :841; FE feature_marketplace_discovery.md:34, :568; FE feature_session_management.md:51, :89, :567, :602, :820; FE feature_cross_club_join.md:33, :48, :50, :56, :70, :139, :200; BE feature_cross_club_join_tech.md:119, :123, :137, :216, :274, :275; BE feature_session_management_tech.md:491; `docs/channels/web/ux-sync-design.md`:234. Venue clause only (DD-45 join-contract rows, 11 lines): BE feature_session_management_tech.md:10, :893, :957, :964; BE feature_cross_club_join_tech.md:86, :87, :212, :214, :258, :267; PRD.md:255 |
| DD-140 (B2) | `p3-m9-zalo-player-commands P-11`; `p3-m6-zalo-outbound Z-13` for the two messages only; consistent with the DD-134 override (:2602); DD-132 and DD-135 unchanged | L21 | 1 line: BE feature_zalo_channel_tech.md:222 (R13). No spec line carries "no price in any DM": that rule lives only at :1790 and :1822 |
| DD-141 (B3) | `p3-m9-gender-pricing U-15`; `p3-m6-outbox-delivery-core D-14` | L22 | 3 lines: TDD.md:49, :552, :667. `GENDER_COLLECTION_ENABLED`: 0 spec lines |
| DD-142 (B4) | DD-51 | none (backlog rows C5 and B4) | B4-a, rule lines (16): BRD.md:271; PRD.md:231; TDD.md:108, :639, :836; ROADMAP.md:639; FE feature_billing_lifecycle.md:282, :284, :292, :296; BE feature_billing_lifecycle_tech.md:19, :32, :347, :450, :455, :531. B4-b, `suspended` labelled as a billing state (12): BE feature_billing_lifecycle_tech.md:556, :562, :563; FE feature_home.md:75; BE feature_home_tech.md:98; FE feature_session_management.md:102, :865; BE feature_session_management_tech.md:259, :323, :670, :672, :1005 |

### B. `docs/autopilot-backlog.md`

Append the seven `## task:` blocks of section 5 (P2) after :6519. Run the reconcile before and after (V4).

### C. `docs/sessions/web-mvp-program-status.md` (113 lines; Vietnamese)

ONE new dated line at :14, after the L17 line :13 (`> **2026-10-21** (phiên P3-S14, lane L17): ...`) and before the blank line and `## Trạng thái mốc` (:15): the owner signed DD-138 on 2026-10-21 except six rows; DD-139..DD-142 are recorded; the next session P3-S15 runs L20 (B1), L21 (B2), L22 (B3) and L23 (R1-5), migrations serialized. No other line changes.

### D. This file

The branch's first commit (checked with `pnpm review:check:changed` before the commit).

## 7. Out of scope: report under OPEN, do not edit

- Decision-log restatements of the changed rules (section 2, Q2 "Other places"; R4, R6). The DD-51 restatements (:77, :196, :753, :3846, :3928, :3949, :4488) get the same treatment as R4.
- B1-b lines on surfaces B1 does not name (R7; a question for the owner before L20): FE feature_channel_booking_funnel.md:39, :105, :106, :246, :280; BE feature_channel_booking_funnel_tech.md:446; BE feature_zalo_channel_tech.md:219, :222-:223; BE feature_player_messenger_tech.md:215-:216; FE feature_share_activities.md:162 (Draft); BE feature_share_activities_tech.md:252 (Draft); FE feature_inapp_chat.md:533, :551; FE feature_tournament.md:35, :74 (Draft); BE feature_tournament_tech.md:126 (Draft); `docs/channels/web/FE/feature_tournament_fe.md`:288 (Draft).
- Zalo `/join` re-renders BE feature_zalo_channel_tech.md:224, :225 (R13; a question for L21).
- Non-spec docs that state the old flag defaults (R8; for L22): `docs/runbooks/outbox-dispatch-enable-rollback.md`:10; `docs/00-start-here/DEV-ONBOARDING.md`:77; `docs/00-start-here/repo-operating-flow.md`:632; `docs/00-start-here/HANDOFF.md`:31, :431 (negative scope); `docs/standards/BUILD-STATUS.md`:29, :50.
- Not Reviewed under P1 (not follow-ups; named for the C4 sync): B1 lines in `docs/channels/web/FE/feature_marketplace_fe.md`:7, :44, :206, :207, :246, :264, :281, :389, :407 and `docs/channels/web/FE/feature_booking_funnel_fe.md`:54, :55, :287, :288, :303, :333; B4-b lines in FE feature_club.md:80, `docs/channels/web/FE/feature_club_fe.md`:375, `docs/channels/web/FE/feature_settings_fe.md`:321 (and :172), `docs/product/CRM_DASHBOARD_BRD.md`:434 (and :225, :287, :436, :820).
- PR #50 (frozen, owner-only); the R1-5 backlog row (lane L23; added later only if L23 does not land); the missing `---` at :2514-:2515 inside DD-138; any Reviewed spec, `docs/00-start-here/HANDOFF.md`, code, test, migration, workflow, env or config file.

## 8. Verification the writer must run (cite measured output, `| tail -40`)

| V | Check | Expected |
|---|---|---|
| V1 | `git diff --name-only 3a97c7b650200a327d9ad705a8813619a1c528c9..HEAD` | exactly the four docs files (the three targets and this file); any path outside `docs/` = HALT |
| V2 | `pnpm format:check` | pass |
| V3 | `pnpm review:check:changed` before each commit; `pnpm review:check` after | pass |
| V4 | `scripts/autopilot-backlog-reconcile --check` before and after the backlog edit | exit 0; `⚠` 0 (no new warning); `✗` 3 unchanged; after: one new `⊘ manual-close` line (C3) and declared close_by NOTE 1 -> 2 |
| V5 | `git grep -c` for each merged_probe identifier | 0 each: `PublicSessionSharePage`, `PlayerLeaveSessionButton`, `downgradeLateHostProTenantToFree` |
| V6 | re-check every section 6 anchor against the file before editing; `git fetch` and compare `origin/main` with the base | anchors match; if `origin/main` moved, read what moved in the target files and re-measure every count and number |
| V7 | `grep -n 'OUTBOX_DISPATCH_SCHEDULE_ENABLED=\|GENDER_COLLECTION_ENABLED=' .env.example` | still `false` at :99 and :173 (this lane flips nothing) |
| V8 | language check of the repository's CLAUDE.md on every text fence of the changed files | 0 diacritics |
| V9 | count of lines starting with the verdict key in the three target files | 0 each |
| V10 | `grep -c 'Co-Authored-By\|Generated with\|Claude-Session'` on the commit messages and the PR body | 0 (do not grep the bare word "Claude": the PR body carries "reviewed by independent Claude subagent") |
| V11 | every quote compared byte for byte with the owner's text; no claim that a B decision is implemented, enabled or live; no owner P0 step marked done | review round items (1)-(5) of the lane block |
| V12 | `grep -c '^## DD-' docs/standards/decisions.md` | 131 -> 135; of the existing `## DD-` headings only DD-138's status text changes |

## 9. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` below = `git rev-parse origin/main` after `git fetch origin` = HEAD; every TARGET_FILES path exists | PASS |
| 2 | Decisions in scope are final | the owner's text of 2026-10-21, confirmed in full by the owner (section 1); L19 records it and makes no new decision | PASS |
| 3 | Scope IN/OUT and owner clear | sections 6 and 7; docs only; kit files excluded (section 3) | PASS |
| 4 | Dependencies classified | #92 merged and is the base; L20-L23 depend on this lane, not the reverse; #50 is owner-only and not a dependency | PASS |
| 5 | Live schema and code match the claims | flags false at `.env.example:99` and `:173`; probe identifiers absent; anchors re-checked at this review (section 2) | PASS |
| 6 | Data, API, state and auth contract complete | not applicable beyond HARD RULES: no behavior change; records only | PASS |
| 7 | Fail-closed, idempotency, order | not applicable (no runtime behavior); entry order, separators and insertion points pinned (section 6) | PASS |
| 8 | Open questions in scope = 0 | R1-R15 and P1-P2 pinned as "default applied, pending owner sign-off"; residue in section 7; DD-142's retention question is the owner's own open item, recorded as ⬜ Mở, not a lane question | PASS |
| 9 | Acceptance matrix has expected results | section 8, V1-V12 | PASS |
| 10 | Migration, security and rollback pinned | no migration, no secret, no PII; both flags stay false; rollback = revert the single docs PR | PASS |
| 11 | First slice has hard dependency merged | the base is `main` at the #92 merge | PASS |
| 12 | Implementation handoff ready | inventory with line anchors, readings and defaults, backlog rows, verification table | PASS |

## 10. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-21
AUTHORITY_SHA: 3a97c7b650200a327d9ad705a8813619a1c528c9
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/autopilot-backlog.md
  - docs/sessions/web-mvp-program-status.md
SLICE: p3-owner-decisions-2026-10-21
IN_SCOPE: docs-only records of the owner decisions of 2026-10-21: the DD-138 sign-off (section A and the owner confirmation quoted verbatim, the seven named rows marked in place under their full keys, the M-11 and CI subsections made current); new entries DD-139 (B1), DD-140 (B2), DD-141 (B3), DD-142 (B4) above DD-138 with their summary rows, the DD-06, DD-51 and DD-133 pointers and the v2.61 changelog row; backlog rows C1-C5, A1 and B4; one dated ledger line
OUT_OF_SCOPE: any code, test, migration, workflow, env or config file; edits of Reviewed specs or docs/00-start-here/HANDOFF.md; any DD-138 cell beyond the seven rows; any decision number beyond DD-139..DD-142; rewriting dated history; any claim that a B decision is implemented, enabled or live; changing either flag default; marking an owner P0 step done; PR 50; the R1-5 backlog row (lane L23)
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: all merged with probes (PR 92 merge 3a97c7b650200a327d9ad705a8813619a1c528c9 is origin/main and the base)
PRIOR_SLICES: L17 p3-closeout (PR 92) merged
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # docs only, no migration or secret; both flags stay false in every committed file
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: section 6 group A (a) on docs/standards/decisions.md: the DD-138 heading status, the new sign-off subsection and the seven status cells; then groups (b)-(e), the backlog rows (group B) and the ledger line (group C)
REMAINING_BLOCKERS: none
```
