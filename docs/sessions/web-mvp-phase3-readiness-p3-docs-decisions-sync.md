<!-- review-readiness: code-ready -->

# Step-0 readiness: L0 p3-docs-decisions-sync (session P3-S1)

> Agent-facing. Readiness reviewer: sonnet/high (same model and effort as the lane's code reviewer). Writer: sonnet/high. Docs only.
> Lane block: `docs/autopilot-templates/web-mvp-phase3-2026-10-16-RUN.md` L0. Plan: `docs/sessions/web-mvp-phase3-plan.md`.
> Every line number below is MEASURED at base `c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a` (merge of PR #58). The lane block's numbers
> were measured at `3546f6b`; between the two, only `docs/standards/decisions.md` (+117 lines) and `docs/autopilot-backlog.md` (+1 line)
> changed among L0's files, so every spec, TDD and business-rules line in the lane block is still exact. Use THIS file's numbers.

## 1. Authority

- Owner signature, written 2026-10-16, verbatim: "Phase 3 plan approved. D1 signed (a)-(e). D2 signed (a)-(f) with one override to (c): also send exactly ONE
  Zalo DM to a player promoted from the waitlist (that player only, only if their Zalo is linked), saying they now hold a seat and the fee owed; the lane that
  introduces the promotion event wires it; no other new DM types, no reminders. D3 signed. D4 signed. D5 signed, plus: fix the OSV advisories on main (1 Critical
  shell-quote, 5 High) as a separate PR alongside L1, with full test runs; any bump that needs a breaking change goes to the backlog instead."
- Numbering measured in `docs/standards/decisions.md`: D1=DD-133, D2=DD-134, D3=DD-135, D4=DD-136, D5=DD-137. Section headings at `:1833` `:1809` `:1788`
  `:1768` `:1747`; index rows at `:124` `:123` `:122` `:121` `:120`; all five read `🟡 Đề xuất (chờ owner ký, 2026-10-16)`. Numbers agree, so no renumbering.
- All five decisions are signed: nothing is skipped as unsigned. L0 records the signature; it does not create, renumber or reword any decision.
- Merge probes at base: PR #58 merge `c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a` (2026-10-16T04:36:05Z), PR #51 merge `3546f6b49bc32e82dbe12e5da636c62206c63b2e`
  (2026-10-15T19:32:18Z), PR #57 merge `844a0a92d3e9cfbcc67d0197ea53f725998ba6ec` (2026-10-15T19:24:43Z). `git merge-base --is-ancestor c762c90 origin/main` = true.

## 2. Live truth measured at the base (what the docs must match)

| Fact | Evidence at base |
|---|---|
| `players` has NO `person_id`; person is reached via `membership_id` -> `memberships.person_id`; status is `active\|left\|waitlisted` (no `pending`) | `packages/db/schema.ts:692-706` and `:712` (`players_status_chk`) |
| `sessions` price column is `price_amount`; sport is `sport_id` -> `sports.key`; there is no `sessions.price` or `sessions.sport_key` | `schema.ts:610-624`; `sports` at `:32-38` |
| `tenants` has `name`, no `display_name` | `schema.ts:513-518` |
| `memberships` has no `role`; it has `status` active\|guest\|left\|merged; uniqueness is a PARTIAL index on (tenant_id, person_id) where status in active,guest | `schema.ts:528-540` |
| `charges` has `amount_due` and `amount_allocated`, no `amount`, no `currency`; status open\|partial\|paid\|void | `schema.ts:1126-1143` |
| `join_requests.status` is pending\|approved\|rejected\|expired\|cancelled (approval pending lives here, not on `players`) | `schema.ts:1594-1608` |
| `chat_channels.kind` CHECK is `('club','dm')`, no `group`; `chat_members` has `last_read_created_at` + `last_read_message_id` (pair CHECK), no `last_read_at` | `0031_chat_schema_core.sql:59` and `:108-118`; `schema.ts:920-940` and `:1043-1075` |
| `public_sessions` has no `confirmed_count`, no `public_listing_id`; guarded view `public_session_share_v` still exposes `host_display_name`; the whitelist test lists `host_display_name` | `0033_public_projection_fences.sql:132-145`; `packages/db/src/rls-invariants.test.ts:171-200` |
| No `getSessionOccupancy`, `session_occupancy` or `public_listing_id` anywhere in `packages/` or `apps/`; live `sessionOccupancy` = active players + guest notes | `git grep` empty; `packages/db/src/session-service.ts:2664-2672` |
| No `/api/discover` route exists yet (apps/web/app/api has auth, me, onboarding, sessions, sports, webhooks); L10b creates `apps/web/app/api/discover/route.ts` | directory listing at base; RUN doc L10b |
| `BOOKING_*` codes (`BOOKING_STALE` ...) and `HOLD_EXPIRED`, `HANDOFF_*` appear in no code; `SESSION_FULL` exists only for guest notes | `git grep` over `packages/` and `apps/` |
| Migration tail `0055`, 56 files; `formatVnd` exists | `ls packages/db/migrations`; `apps/web/lib/money.ts:27` |
| `pnpm review:check` PASS (47 documents, 51 active verdict blocks) and `pnpm kit:check` PASS at the base | run in the lane worktree |

## 3. Kit-owned files (the writer must NOT touch)

`pack_pairs()` in the canonical kit's `autopilot-update.sh` owns: `scripts/autopilot-scope-gate`, `scripts/autopilot-review-readiness.mjs`,
`scripts/autopilot-readiness-evidence-keys.mjs`, `scripts/autopilot-ephemeral-review-worktree.mjs`, `scripts/autopilot-backlog-reconcile`, `scripts/codex-review-pin.sh`,
`docs/autopilot-parallel-scope-gate.md`, `docs/autopilot-manifests/_TEMPLATE.json`, `docs/autopilot-manifests/_READINESS_EVIDENCE_TEMPLATE.json`, `scripts/ap-finish.sh`,
`scripts/ap-evidence.sh`, `scripts/ap-housekeep.sh`, `.github/workflows/autopilot-backlog-audit.yml`, `docs/autopilot-templates/autopilot-prompt-GENERIC.md`,
`docs/autopilot-templates/level3-workflow.md`. The repo authority is `docs/standards/kit-pack-membership.json` (`pnpm kit:check`). NONE of L0's target files is in the pack,
including `docs/autopilot/contracts/autopilot-session-publish-public-projector.md` and `docs/autopilot-manifests/session-publish-public-projector.json` (authored
per-repo artifacts), so nothing in the lane block is skipped for kit ownership. Do not edit any file listed above.

## 4. B3 exception (explicit)

Default budget is about 300 LOC, 3 modules, 1 migration. This lane is docs only: 0 migrations, 0 code. It exceeds the module and file budget on purpose.

- Modules touched (named): (1) `docs/standards/` (decisions.md signatures, business-rules.md); (2) `docs/product/TDD.md`; (3) `docs/features/{FE,BE}/` (3 Product+BE
  pairs plus player_view_tech, cross_club_join, inapp_chat); (4) `docs/channels/web/FE/` (booking funnel FE plus 12 header pins); (5) `docs/autopilot-backlog.md`,
  `docs/autopilot/contracts/` and `docs/autopilot-manifests/` (one contract, one manifest, two backlog rows); (6) `docs/sessions/` and `plans/` (ledger and pointers).
  About 31 files.
- Why one lane: the owner signed D1-D5 as ONE message, and the specs contradict each other on one formula (`getSessionOccupancy()`) and one whitelist (BL-DSC-1). A split would
  leave a window where decisions.md says "slots_open only" while TDD, business-rules and six spec files still say `confirmed_count` and host name, which is the exact
  four-formulas drift the research doc measured. The ledger refresh depends on the same base SHA. One coherent sync, one reviewer pass.
- Compatibility proof: `git diff --name-only c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a..HEAD` must list only `docs/` and `plans/`; prettier ignores `docs/` and `*.md`; no file is in the
  kit pack (section 3), so `pnpm kit:check` is unaffected; no table, column, migration, route or code symbol is created or changed; every edit narrows or aligns text to the
  signed decisions or to measured schema.

## 5. Defaults pinned (value, "default applied, pending owner sign-off"; repeat in the PR body)

| # | Default | Value |
|---|---|---|
| P1 | Wording of the signature in decisions.md | Heading and index status become `✅ Quyết định owner 2026-10-16 (ghi từ tin nhắn "Phase 3 plan approved" của owner; L0 chỉ ghi lại chữ ký)`. NOT "hiệu lực khi PR merge": DD-137 states it does not wait on L0's merge. |
| P2 | Canonical occupancy sentence | "occupied = `getSessionOccupancy()` = active players + guest notes + live holds (+ pending invites after the migration that adds them); `slots_open` = `slots_max IS NULL ? NULL : max(0, slots_max - occupied)`; `confirmed_count` = active players, tenant-private, never public." Source: `docs/research/occupancy-authority-2026-10-16.md` section 5. Live holds are 0 until a hold table exists (DD-132). Vietnamese prose may paraphrase; the tokens must match. |
| P3 | Public whitelist text | `sport_key, starts_at, ends_at, area, price_amount, slots_open, club_display_name, join_policy, title, session_type, level_min_rank, level_max_rank, level_strict, gender_restriction, age_min, age_max, public_listing_id`. `confirmed_count` and `host_display_name` are REMOVED. `club_display_name` = approved alias (L10a), read live. Source: DD-133 (c)(e) and RUN L10b. |
| P4 | Public card elements with no whitelist source | "N/M Going", host name and host avatar have no whitelist column: delete them from public cards and ACs; show `slots_open` only. Tenant-private surfaces (`feature_session_management.md:294` Going count) stay. |
| P5 | Stale `*_fe.md` source pins | Per header: run `git diff 0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4..c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a -- <source spec>` and read the intervening changelog rows. If none changes a field, state, route or error code the FE spec uses, re-pin to the current version and baseline `c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a`. Otherwise keep the old pin and append ` · STALE PIN: source is now v<cur>, FE spec not re-reviewed` and list it under OPEN. Draft FE specs get a trailing `_Re-pin 2026-10-16 (cấu trúc, không bump version)_` line, never a version bump. |
| P6 | Two booking error-code sets | Do not merge or invent a mapping. Label `:303-307` (BOOKING_* set, newer, DD-32 Option D) as the intent-level catalog and `:326-340` as the older table, state that neither is implemented (zero hits in `packages/` and `apps/`), and mark the combined catalog `UNPINNED error catalog — omit active UI` for FE until the booking implementation lane pins one set. |
| P7 | Discovery routes | List route = `GET /api/discover` (matches `:109`, and RUN L10b `apps/web/app/api/discover/route.ts`). Detail route = `UNPINNED (pinned by L10b, keyed by public_listing_id)`; delete `/api/public/sessions` from the `:26-27` entry table. |
| P8 | Chat `group` kind | Annotate, do not delete: `group` has no schema (0031 CHECK is club, dm) and is outside the MVP build per DD-136. A header note plus a parenthetical at `:642` (and `:599`, `:734`). The group use cases and wireframes stay as the deferred product contract. |
| P9 | Version bump scheme and dates | Next minor for each Reviewed spec; header date becomes 2026-10-16; ONE changelog row per file, inserted as the FIRST data row (every file lists newest first; insert directly above the row that carries the current version). Never rewrite a dated row. |
| P10 | Out-of-scope residue | Not edited; listed under OPEN in the report (section 8). |

## 6. EDIT INVENTORY (writer follows; every path:line at base)

Language: decisions.md, TDD, business-rules, status ledger, specs = keep each file's own language (Vietnamese); identifiers and the owner quote stay verbatim.

### A. decisions.md (signatures plus two pointers; nothing else)

| # | Line | Current gist | Required change | Driver |
|---|---|---|---|---|
| A1 | 120-124 | five index rows, status cell `🟡 Đề xuất (chờ owner ký, 2026-10-16)` | status cell -> P1 wording; leave every other cell | D1-D5 |
| A2 | 1747, 1768, 1788, 1809, 1833 | five headings end `· 🟡 Đề xuất (chờ owner ký, 2026-10-16)` | replace that tail with the P1 wording | D1-D5 |
| A3 | 1749, 1770, 1790, 1811, 1835 | banner "Chưa ký ⇒ chưa có hiệu lực" | replace that sentence with "Đã ký 2026-10-16 (owner); L0 ghi lại chữ ký." keep the rest of the banner | D1-D5 |
| A4 | end of each DD section (before its `---`) | proposal text and "Điều kiện resume" bullets (`:1761` `:1781` `:1802` `:1826` `:1852`) | APPEND one bullet per DD: `- **Ký (owner, 2026-10-16).**` + the verbatim fragment: DD-133 "D1 signed (a)-(e)."; DD-134 "D2 signed (a)-(f) with one override to (c): ..." (full override sentence, verbatim); DD-135 "D3 signed."; DD-136 "D4 signed."; DD-137 "D5 signed, plus: ..." (full addition, verbatim); each prefixed "Phase 3 plan approved." Do not edit proposal text or the resume bullets | D1-D5 |
| A5 | DD-134 section | (c) says nothing else reaches Zalo | in the A4 bullet add one sentence: the override adds exactly one promotion DM and amends (c)'s "không gì khác tới Zalo" for that DM only; no other DM types, no reminders; the lane that introduces the promotion event (L8) wires it | D2 (c) override |
| A6 | DD-137 section | `:1760` "chưa ký ⇒ owner tự merge" and OSV "bỏ qua từ 2026-09-30" | in the A4 bullet add: the owner addition supersedes "OSV ignored, owner timing" for the 1 Critical (shell-quote) + 5 High advisories; breaking bumps go to the backlog | D5 addition |
| A7 | 469 | DD-32 Browse: "confirmed count và slots available luôn xem được" | append ` ⚠️ Amended by DD-133 (owner 2026-10-16): browse shows slots_open only; confirmed_count is tenant-private.` | D1 (a) |
| A8 | 472 | DD-32 capacity: "một helper đếm active players + unexpired payment holds" | append ` ⚠️ Amended by DD-133 (a): the one helper is getSessionOccupancy() (active + guest notes + live holds; holds are 0 until a hold table exists).` | D1 (a) |
| A9 | 647 | DD-46 bullet `host_display_name ← memberships.display_name`, `club_display_name NOT NULL = alias` | append ` ⚠️ Amended by DD-133 (owner 2026-10-16): the approved alias (L10a) is the public club_display_name; host_display_name is no longer projected; no host or person name is ever public.` | D1 (c)(d) |
| A10 | 3663 | newest changelog row is v2.57 | insert ONE new first data row above it: `16/10/2026 / v2.58`: owner signed D1-D5 (quote the D2 (c) override and D5 addition by reference to A4), DD-133..DD-137 flipped to ✅, pointers at DD-32 and DD-46, no new DD number, no spec text rewritten | D1-D5 |

### B. D1 occupancy and whitelist sync (use P2, P3, P4)

| # | File | Line | Current gist | Required change |
|---|---|---|---|---|
| B1 | `docs/product/TDD.md` | 111 | FR-17 "public `confirmed_count` + `slots_open` from active+live-hold occupancy" | "public `slots_open` only, from `getSessionOccupancy()`; no hold identities/PII" |
| B2 | TDD | 306 | ERD line `int confirmed_count "active players only"` | delete the line |
| B3 | TDD | 308 | ERD `varchar host_display_name` | delete the line; add `public_listing_id` (opaque) to the entity |
| B4 | TDD | 673 | Publish whitelist incl. `confirmed_count`, `host_display_name`; "slots_open=max(0,slots_max-active-live payment holds)" | P3 whitelist; occupancy per P2 |
| B5 | TDD | 675 | `GET /discover?...` | `GET /api/discover?...` (P7) |
| B6 | TDD | 676 | "All capacity decisions use active + live holds" | "use `getSessionOccupancy()` under the session lock" |
| B7 | TDD | header 3 and 907-910 | version 3.2 | bump to 3.3; one changelog row first; keep the old header sentence as `(lịch sử)` per the file's pattern |
| B8 | `docs/standards/business-rules.md` | 50 | BL-DSC-1 lists `confirmed_count (active players)`, "slots_open (trừ active + live payment holds)", "host/club display name" | P3: drop `confirmed_count`, slots_open per P2, "club display name (approved alias)", add `public_listing_id` |
| B9 | business-rules | 61 | BL-CBF-1 "active confirmed count và available slots" | "available slots (`slots_open`)" only |
| B10 | business-rules | 63, 75 | BL-CBF-3 / BL-SES-2 "active players + unexpired payment holds" | point to `getSessionOccupancy()`; keep the 0024 CHECK text of `:75` |
| B11 | business-rules | header 5 and 277 | header says v1.32, changelog top is v1.33 | header and new first row to v1.34 (2026-10-16) |
| B12 | `features/BE/feature_channel_booking_funnel_tech.md` | 54, 164-179, 269-270, 484 | one-helper row; `confirmed_count/held_count/occupied_count/slots_available` block; DTO `confirmedCount` + `slotsAvailable`; "Projection reports confirmedCount" | P2 canonical text (keep `held_count` as the future term); DTO drops `confirmedCount`, `slotsAvailable` -> `slotsOpen`; `:484` -> `slotsOpen` only |
| B13 | `features/FE/feature_channel_booking_funnel.md` | 17, 86, 92, 162, 164, 280 | "số người đã xác nhận", "12 người đã xác nhận", `confirmed_count` is active, "Going count", `slots_max - active - live_holds`, AC "confirmed count" | remove confirmed/Going; show `slots_open`; `:92` rewritten to the P2 sentence; `:164` -> `getSessionOccupancy()` |
| B14 | `channels/web/FE/feature_booking_funnel_fe.md` | 334, 335 | "Confirmed count" row; "Trừ active + live holds" | delete `:334`; `:335` -> `slots_open` from `getSessionOccupancy()` |
| B15 | `features/BE/feature_marketplace_discovery_tech.md` | 30, 51, 54, 71, 99, 143, 188, 191-193, 209, 259 | `getSessionOccupancy` "Active + live holds"; DDL `confirmed_count`; DDL `host_display_name`; migration (b) `confirmed_count`; edge 16 "three aggregates"; DTO `publicId`+`confirmedCount`; alias `tenants.display_name`; projector formula; cache row `confirmed_count`; test 28 | `:30` P2; delete `:51` and `:209`; `:54` mark legacy, never written (DD-133 (c)); delete `:71` (b); `:99` "recomputes `slots_open`"; `:143` drop `confirmedCount`, rename key to `publicListingId`; `:188` "club tenant -> approved public alias (L10a)"; `:191-193` P2 formula, no `confirmed_count`; `:259` "one occupancy read yields `slots_open`" |
| B16 | `features/FE/feature_marketplace_discovery.md` | 35, 73, 138-153, 175, 178-182, 205, 240-243, 460, 502-505, 544, 547 | `confirmed_count` canonical; "Club/host display name"; wireframes with host, "N/M Going"; `public_sessions.price`; Going count / Host name rows; DTO table; AC | P4 deletions; `:35`, `:503`, `:544` P2; `:502` and `:505` rows deleted; `:175` and `:240` `public_sessions.price` -> `price_amount` (measured drift, same file) |
| B17 | `features/BE/feature_session_management_tech.md` | 10, 12, 249-251, 270, 815, 832, 884-886, 1095 | formulas "active+live holds" / "active + pending + guest notes + live holds"; `:1095` public `confirmed_count` | each formula -> `getSessionOccupancy()` pointer; KEEP `:820` pending-occupancy rule and `:12`/`:251` live-state facts; `:1095` -> `slots_open` only, `confirmed_count` private |
| B18 | `features/FE/feature_session_management.md` | 49, 113, 882 | formula enumerations | pointer to `getSessionOccupancy()`; `:294` stays (tenant-private) |
| B19 | `features/FE/feature_inapp_chat.md` | 550, 751 | embed whitelist lists `confirmed_count`, `host_display_name`, "Going count" | P3 whitelist for the BL-DSC-1 mirror; delete the Going row |

### C. Measured drift (schema-true text from section 2)

| # | File | Line | Current | Required |
|---|---|---|---|---|
| C1 | `features/BE/feature_player_view_tech.md` | 99-120 | `s.sport_key`, `s.price`, `t.display_name`, `WHERE p.person_id`; payment query `c.amount`, `c.currency`, `p.person_id` | `JOIN memberships m ON m.id = p.membership_id ... WHERE m.person_id = $1`; `JOIN sports sp ON sp.id = s.sport_id` with `sp.key AS sport_key`; `s.price_amount`; `t.name AS club_name`; `c.amount_due, c.amount_allocated, c.status`; delete `c.currency` (no column) |
| C2 | `features/BE/feature_channel_booking_funnel_tech.md` | 231, 237, 240 | `ps.price`; `p.person_id` | `ps.price_amount`; `FROM players p JOIN memberships m ON m.id = p.membership_id ... AND m.person_id = $2` |
| C3 | `features/FE/feature_cross_club_join.md` | 159 | `memberships ... UNIQUE(person_id, tenant_id), role=guest` | "`status='guest'`; partial unique index on (tenant_id, person_id) where status in active,guest" |
| C4 | cross_club_join | 141 | `players.status = 'pending'` | `join_requests.status = 'pending'` |
| C5 | cross_club_join | 135 | `sessions.venue` | `sessions.venue_name` / `venue_address` (same table block) |
| C6 | `features/FE/feature_inapp_chat.md` | 78, 215, 601, 659 | `chat_members.last_read_at` | `last_read_created_at` + `last_read_message_id` (0031) |
| C7 | inapp_chat | 599, 642, 643, 734 and a header note near `:13` | `kind ∈ {club, dm, group}`, group create/pin/poll as MVP | P8 annotation plus "MVP build scope narrowed by DD-136 (club channel only)"; no use case deleted |
| C8 | `features/BE/feature_channel_booking_funnel_tech.md` | 303-307, 326-340 | two error catalogs | P6 |
| C9 | `features/BE/feature_marketplace_discovery_tech.md` | 26-27 vs 109-110 | `/api/public/sessions` vs `/api/discover` | P7 |
| C10 | `docs/channels/web/FE/*_fe.md` | line 4 of 13 files | stale pins (section 7 table) | P5 |
| C11 | version bump + ONE changelog row for each edited Reviewed spec | FE booking funnel 1.3->1.4 (row anchor `:306`); BE booking funnel 1.2->1.3 (`:555`); MKT FE 2.7->2.8 (`:584`); MKT BE 2.7->2.8 (`:295`); SES FE 2.27->2.28 (`:915`); SES BE 2.36->2.37 (`:1110`); player_view_tech 2.10->2.11 (`:405`); cross_club_join 2.12->2.13 (`:226`); inapp_chat 0.20->0.21 (`:780`) | insert directly above the anchor row; update the header Version line and date |

### D. Stale contract and manifest (neither is in the kit pack)

| # | File | Required |
|---|---|---|
| D1 | `docs/autopilot/contracts/autopilot-session-publish-public-projector.md` (322 lines, directive `enforce` at `:1`, verdict `NOT_CODE_READY` at `:242`) | change line 1 to `<!-- review-readiness: historical -->` (genuinely superseded, so the exemption is legitimate) and add one banner blockquote under the title: superseded by DD-133 (signed 2026-10-16) and lane L10 of `docs/autopilot-templates/web-mvp-phase3-2026-10-16-RUN.md`; kept as history; do not use as authority |
| D2 | `docs/autopilot-manifests/session-publish-public-projector.json` | add a top-level `_superseded` string key (same note); keep valid JSON (`node -e` parse); it must NOT gain `manifest_schema_version` |
| D3 | `docs/autopilot-backlog.md:3476` (the 2026-10-16 UPDATE line of row `session-publish-public-projector`, `:3455`) | append ONE dated line `UPDATE 2026-10-16` (owner signed DD-133 (a)-(e)); status stays `blocked`; L10 flips it on merge. Research doc section 5 item 8 asks for exactly this pointer |

### E. Ledger refresh

| # | File | Line | Required |
|---|---|---|---|
| E1 | `docs/autopilot-backlog.md` | 5924-5941 (`web-bot-vnd-display-convention`) | `status: in-flight` -> `merged`; add `merged: 2026-10-15 · PR #57, merge 844a0a92d3e9cfbcc67d0197ea53f725998ba6ec` (follow the `note_merged` precedent at `:5796`); fix `_readiness` and the "chưa merge" notes; `merged_probe` stays `null` (`scope: []`; a hyphenated token would fail `is_symbol_probe`); evidence `apps/web/lib/money.ts` `formatVnd` (`:27`) |
| E2 | backlog | 6034-6055 (`docs-drift-sessions-fe-zalo-tech-readme-pins`) | re-count at base and rewrite `_readiness` and notes: (3) README `:77` pins identity FE v1.11 / BE v1.13 but the files are v1.12 / v1.19 (FE now measured); (5) Sora: theme-direction 8, design-system 10, web README 3, design-brief 3, designer-kickoff 3, `.github/workflows/ci.yml` 1 (unchanged), plus unlisted designer-docs-guide 2, channels/web/design-tokens 2; U+20AB in 21 files outside archive (payment_reconcile 30, player_view 21, session_management 12, billing_lifecycle 6, marketplace_discovery 5, home 5 ...); NEW (6): `features/BE/feature_zalo_channel_tech.md:154` still says "pending in PR #51" (merged); measured base now `c762c90` not `7fe5525`. Do not add scope paths already covered |
| E3 | `docs/sessions/web-mvp-program-status.md` | 9-11, 42-44, 60-72, 93-101 | header "Cập nhật" gains a 2026-10-16 entry (base `c762c90`; tail `0055`, 56 files); row `:43` #57 -> merged `844a0a9` (2026-10-15 19:24Z); row `:44` #51 -> merged `3546f6b` (19:32Z); "Proposal đang mở" two items closed by DD-134 (d) and DD-137 (signed 2026-10-16); item 1 and 3 of "Việc kế tiếp" updated; item 5 OSV: owner chose to fix (D5 addition); add a short "Quyết định owner 2026-10-16" block listing D1-D5 incl. the override and addition; M6/M9/M10 rows point to `web-mvp-phase3-plan.md`; no handoff-3 |
| E4 | `docs/sessions/2026-10-14-web-mvp-program-handoff-2.md` | after 23 | ONE pointer blockquote: #57, #51, #58 merged (SHAs of section 1); sections 2 and 7 step 1 are historical; current ledger is `web-mvp-program-status.md`, current plan is `web-mvp-phase3-plan.md`. Do not edit the body |
| E5 | `plans/261012-1400-web-mvp-program/plan.md` | after 7 | ONE status pointer blockquote to the ledger and the Phase 3 plan; leave the milestone table (the pointer marks it stale) |

## 7. Stale source pins (P5 input; measured pin vs current Version header)

auth_fe (web_auth_onboarding v2.11 vs 2.13) · booking_funnel_fe (channel_booking_funnel v1.1 vs 1.3) · chat_fe (inapp_chat v0.15 vs 0.20) · dashboard_fe (session_management v2.17 vs 2.27,
payment_reconcile v1.10 vs 1.13, notifications_reminders v3.11 vs 3.13) · home_fe (home v0.10 vs 0.15) · marketplace_fe (marketplace_discovery v2.4 vs 2.7) · members_fe (identity v1.11 vs 1.12,
payment_reconcile v1.10 vs 1.13) · notifications_fe (v3.11 vs 3.13) · onboarding_fe (web_auth_onboarding v2.11 vs 2.13, connector_onboarding v1.0 vs 1.1) · payments_fe (payment_reconcile v1.10
vs 1.13) · player_view_fe (player_view v2.7 vs 2.11) · sessions_fe (session_management v2.17 vs 2.27, payment_reconcile v1.10 vs 1.13) · settings_fe (user_settings v0.9a vs 0.10, tenant_routing_authz v2.7
vs 2.9, payment_reconcile v1.10 vs 1.13, connector_onboarding v1.0 vs 1.1). Current: club_assistant_fe, club_fe, session_organize_fe, tournament_fe (no edit). All 17 files are FE design status Draft.

## 8. Out of scope: report under OPEN, do not edit

- D1 residue outside L0's files: `docs/product/BRD.md:232`, `docs/product/PRD.md:118`, `docs/channels/web/FE/feature_marketplace_fe.md:278`, `docs/features/FE/feature_share_activities.md:50,265`,
  `docs/features/BE/feature_inapp_chat_tech.md:1100`, `docs/features/BE/feature_home_tech.md`, `docs/features/README.md`.
- Schema drift outside L0's files: `feature_home_tech.md:48-61` (`s.price`, `s.max_players`, `p.person_id`, `c.amount`, status `unpaid`), `feature_tenant_routing_authz_tech.md:223,230`, `feature_club_tech.md:77,86`,
  `feature_cross_club_join_tech.md:261`, `FE/feature_club.md:157`, `FE/feature_player_view.md:150`, `BE/feature_inapp_chat_tech.md:101,170,203,583,1550` (`kind IN ('club','dm','group')`).
- `docs/features/README.md` version cells are already stale (backlog row at `docs/autopilot-backlog.md:1649`); L0 does not touch it.
- `docs/sessions/web-mvp-phase3-plan.md` and `docs/research/occupancy-authority-2026-10-16.md` still describe D1-D5 as unsigned; `docs/autopilot-templates/web-mvp-phase3-2026-10-16-RUN.md` is conductor-owned and
  needs the D2 (c) promotion DM wired into L8/L4 and the D5 OSV PR added as a lane beside L1 (its S1 rule still says OSV is ignored). Not L0's files.
- Backlog row `osv-full-scan-red-on-main-2026-10` (`:6198`) is not named in the lane block; leave it, report the D5 addition.
- Booking funnel FE error codes (`HOLD_ALREADY_EXISTS`, `HANDOFF_NOT_FOUND`, `ALREADY_LINKED`, `SESSION_NOT_FOUND`) match neither BE set: covered by P6, not fixed.

## 9. Verification the writer must run (cite measured output, `| tail -40`)

| # | Command | Expected |
|---|---|---|
| V1 | `git diff --name-only c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a..HEAD` | only `docs/` and `plans/` paths; no kit-pack file (section 3) |
| V2 | `pnpm format:check` | exit 0 |
| V3 | `pnpm review:check:changed` then `pnpm review:check` | PASS (the contract in D1 is `historical`; this file is `code-ready`) |
| V4 | `pnpm kit:check` | PASS |
| V5 | `scripts/autopilot-backlog-reconcile --check` | no new `⚠`/`✗` line versus base (base ends with 1 declared `close_by` and 1 weak-probe NOTE) |
| V6 | `git grep -n "confirmed_count" -- docs/product/TDD.md docs/standards/business-rules.md docs/features/FE/feature_marketplace_discovery.md docs/features/BE/feature_marketplace_discovery_tech.md docs/features/FE/feature_channel_booking_funnel.md` | only tenant-private mentions or changelog history |
| V7 | `git grep -n "host_display_name" -- <the same files plus feature_inapp_chat.md>` | only "legacy, never written" or changelog history |
| V8 | `grep -c "🟡 Đề xuất (chờ owner ký, 2026-10-16)" docs/standards/decisions.md` | 0 on DD-133..DD-137 lines (the v2.57 row keeps its history wording) |
| V9 | `git grep -nE "players\.person_id\|p\.person_id\|t\.display_name\|s\.price\b" -- docs/features/BE/feature_player_view_tech.md docs/features/BE/feature_channel_booking_funnel_tech.md` | empty |
| V10 | `git grep -n "last_read_at" -- docs/features/FE/feature_inapp_chat.md` | empty |
| V11 | every `path:line` written into any doc is re-checked with `git grep -n` at the base | all resolve |
| V12 | the CLAUDE.md language check (extract the text-fenced blocks of this file, grep for Vietnamese diacritics) | empty (payload stays English) |

Review plan: one sonnet/high reviewer, max 3 rounds. Questions: each edit matches the signed decision text; no dated row rewritten; no new DD number; every cited path exists; only `docs/` and `plans/`;
kit files untouched; `_superseded` JSON still parses.

## 10. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` below equals `git rev-parse origin/main`; every target path exists in the worktree | PASS |
| 2 | Decisions in scope are final | owner message of section 1 signs DD-133..DD-137 (D2 override and D5 addition quoted verbatim) | PASS |
| 3 | Scope IN/OUT and owner clear | inventory sections 6 and 8; docs-only; kit files excluded in section 3 | PASS |
| 4 | Dependencies classified | only #58 (merged, probe in section 1); no code or migration dependency | PASS |
| 5 | Live schema and code match the claims | section 2, each row measured against `schema.ts` / migrations / `git grep` | PASS |
| 6 | Data, API, state and auth contract complete | formula P2, whitelist P3, routes P7, error catalog P6 are pinned; none invented | PASS |
| 7 | Fail-closed, idempotency, order | not applicable beyond HARD RULE 2 direction: every edit narrows the public whitelist; no runtime behavior | PASS |
| 8 | Open questions in scope = 0 | defaults P1-P10 pinned as "default applied, pending owner sign-off"; residue is out of scope (section 8) | PASS |
| 9 | Acceptance matrix has expected results | section 9, V1-V12 | PASS |
| 10 | Migration, security and rollback pinned | no migration, no secret, no PII, no local path in repo files; rollback = revert the single docs PR | PASS |
| 11 | First slice has hard dependency merged | the base is `main` containing #58; L0 is a root dependency of Phase 3 | PASS |
| 12 | Implementation handoff ready | inventory with line anchors, version table, verification table, B3 exception | PASS |

## 11. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-16
AUTHORITY_SHA: c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/standards/business-rules.md
  - docs/product/TDD.md
  - docs/autopilot-backlog.md
  - docs/sessions/web-mvp-program-status.md
  - docs/sessions/2026-10-14-web-mvp-program-handoff-2.md
  - plans/261012-1400-web-mvp-program/plan.md
  - docs/features/FE/feature_channel_booking_funnel.md
  - docs/features/BE/feature_channel_booking_funnel_tech.md
  - docs/features/FE/feature_marketplace_discovery.md
  - docs/features/BE/feature_marketplace_discovery_tech.md
  - docs/features/FE/feature_session_management.md
  - docs/features/BE/feature_session_management_tech.md
  - docs/features/BE/feature_player_view_tech.md
  - docs/features/FE/feature_cross_club_join.md
  - docs/features/FE/feature_inapp_chat.md
  - docs/channels/web/FE/feature_booking_funnel_fe.md
  - docs/channels/web/FE/feature_auth_fe.md
  - docs/channels/web/FE/feature_chat_fe.md
  - docs/channels/web/FE/feature_dashboard_fe.md
  - docs/channels/web/FE/feature_home_fe.md
  - docs/channels/web/FE/feature_marketplace_fe.md
  - docs/channels/web/FE/feature_members_fe.md
  - docs/channels/web/FE/feature_notifications_fe.md
  - docs/channels/web/FE/feature_onboarding_fe.md
  - docs/channels/web/FE/feature_payments_fe.md
  - docs/channels/web/FE/feature_player_view_fe.md
  - docs/channels/web/FE/feature_sessions_fe.md
  - docs/channels/web/FE/feature_settings_fe.md
  - docs/autopilot/contracts/autopilot-session-publish-public-projector.md
  - docs/autopilot-manifests/session-publish-public-projector.json
SLICE: p3-docs-decisions-sync
IN_SCOPE: record DD-133..DD-137 as owner-signed 2026-10-16 (D2 (c) override and D5 addition quoted verbatim); two amendment pointers at DD-32 and DD-46; D1 occupancy and whitelist sync in TDD, business-rules and the booking-funnel, marketplace-discovery and session-management spec pairs; measured schema and route drift in player_view_tech, booking_funnel_tech, cross_club_join, inapp_chat and marketplace_discovery_tech; stale source pins in 13 FE design headers; the stale publish-projector contract and manifest marked superseded; program ledger refresh to 3546f6b and c762c90
OUT_OF_SCOPE: any code, test or migration; new or renumbered decision numbers; rewriting dated history rows; kit-pack files; BRD, PRD, features README, share_activities, home_tech, the Phase 3 plan and RUN docs; the booking error-code catalog pin; handoff-3 (L17); the OSV fix itself
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: all merged with probes (PR 58 merge c762c900e4ca55bc8ed2a84c0a86f7d0d7d7cf0a is an ancestor of origin/main)
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # docs only, no migration or secret; edits only narrow the public whitelist (HARD RULE 2)
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: section 6 group A on docs/standards/decisions.md (flip DD-133..DD-137, append the owner signature bullets, add the DD-32 and DD-46 pointers, add the v2.58 row), commit it, then groups B to E per the EDIT INVENTORY
REMAINING_BLOCKERS: none
```
