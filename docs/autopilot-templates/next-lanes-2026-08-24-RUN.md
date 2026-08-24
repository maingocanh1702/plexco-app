# RUN — Next lanes 2026-08-24 (BE + infra, model: fable)

> **Loại doc:** RUN/prompt doc — prose dẫn tiếng Việt, payload English (đúng khuôn
> `ap23-inbound-webhook-RUN.md`). Derived từ `docs/sessions/2026-08-24-repo-audit.md`, KHÔNG phải authority.
> **Mục tiêu hôm nay:** đẩy progress BE/infra nhiều nhất có thể mà **không đụng FE PENDING**
> (vẽ UI trong Pencil vẫn làm song song bình thường — chỉ cấm track `.pen` và mở page/component).
> **Thứ tự khuyến nghị:** P0 → (P1 ‖ P2 song song nếu scope-gate không báo collision) → P3 (một mình,
> vì mang migration) → P4 bất kỳ lúc nào máy rảnh → P5 nếu còn thời gian. P0b đưa owner ký càng sớm càng tốt.
> Chat slice 7 đã authored nhưng **ngoài phase-1 (DD-114 D7)** — hôm nay không ưu tiên.

---

## P0 — Commit/push khối quyết định + vệ sinh (10–15 phút, làm TRƯỚC TIÊN)

Vì sao trước: 697 dòng DD-113/114/115 + mirror đang ngoài git 2 ngày (audit V1); mọi lane sau cần base sạch.

```text
Session goal: repo hygiene — persist the 22-24/08 decision batch. Docs/chore session, no worktree; do NOT touch packages/ or apps/.

1. Read the top LIVE TRUTH block of docs/00-start-here/HANDOFF.md and docs/sessions/2026-08-24-repo-audit.md (items V1, V13).
2. git status. Commit the 8 modified docs files in two commits:
   a) "docs: DD-113/DD-114 mirror chain — GTM re-sequencing + phase-1 scope (owner 22/08)" — HANDOFF, ROADMAP, decisions.md (v2.35/v2.36 hunks), BRD, PRD, gtm-strategy, native-app-strategy.
   b) "docs: DD-115 membership proposal + Draft spec pair (24/08)" — decisions.md v2.37 hunk, docs/features/README.md, plus the two untracked files docs/features/FE/feature_membership.md and docs/features/BE/feature_membership_tech.md.
   If splitting decisions.md hunks cleanly is impractical, one combined docs commit is acceptable — say so in the commit body.
3. Run pnpm review:check:changed BEFORE each commit; a red validator is a hard stop.
4. Do NOT git add design.pen or fe.pen (FE PENDING, owner order 13/08). Also add docs/sessions/2026-08-24-repo-audit.md in commit (b) or a third docs commit — it is a derived audit snapshot, mark it as such in the message.
5. Delete _to_delete/ at repo root (audit-session leftovers: a temp tarball + 2 orphan git-index.lock files). Report git stash list but do not pop/drop anything.
6. Push main (this also pushes the unpushed 205769a). Verify main == origin/main afterward.
7. scripts/autopilot-backlog-reconcile --check; if drift, apply --fix through the root-lock commit path.
Stop when pushed + validators green. Report exact commit SHAs.
```

---

## P0b — Draft DD gỡ/giữ FE PENDING cho owner ký (15 phút, không code)

Vì sao: audit V2 — lệnh chặn 100% launch scope đang sống ngoài `decisions.md`. Agent draft, **owner quyết**.

```text
Session goal: author a DECISION DRAFT (proposal, 🟡) in docs/standards/decisions.md for the FE PENDING order — the order currently blocking the entire DD-113 launch scope while living outside the decision log (the exact defect class DD-111 D4 prohibits).

1. Read: HANDOFF top block, decisions.md DD-111 D4 + DD-113 D5, docs/autopilot-templates/next-lanes-2026-08-13-RUN.md (the only primary source of the PENDING order), ROADMAP FE boundary block.
2. Write ONE new DD entry (next free number) with TWO mutually exclusive owner options, each with binary resolution:
   Option A — LIFT: FE PENDING ends; authorize FE work strictly bounded to the DD-113 launch scope (5 blocks); .pen tracking decision handled per DD-81; first FE lane must still pass the normal Level 3 + readiness gates.
   Option B — KEEP: PENDING stays, with an explicit written condition for lifting (named trigger, owner-verifiable), so the block is durable and auditable instead of conversational.
3. Status 🟡 proposal — do NOT mark ✅, do NOT touch the summary table beyond adding the row marked 🟡, do NOT edit ROADMAP/HANDOFF mirrors yet (mirroring happens after the owner picks).
4. Owner-facing doc => Vietnamese. pnpm review:check:changed must pass. Commit as "docs: DD-1xx proposal — record the FE PENDING order in the decision log". Stop there; the owner decides in review.
```

---

## P1 — Session command family: Update / Close / Cancel (BE lane chính hôm nay)

Vì sao: packet `session-commands-update-close-cancel` đã authored, blocker Tier C đã đóng bằng DD-110;
là đường thẳng nhất để tăng BE nghiệp vụ. **Negative scope cứng:** nhánh đổi capacity khi đã có charges
(DD-112 ⬜ chưa chốt).

```text
Task contract (Level 3, STOP_AT_READY, AUTO_MERGE off, model fable):
OUTCOME: land-ready slice(s) adding UpdateSession / CloseSession / CancelSession commands to packages/db/src/session-service.ts, per the authored packet docs/autopilot/contracts/autopilot-session-commands-update-close-cancel.md, DD-110 (four action-class literals + suspended-matrix rows) and the DD-111 precedent (post-lock time guards need their own query on the DB clock).
CONTEXT FIRST (read before writing anything): HANDOFF top LIVE TRUTH block; decisions.md DD-104/DD-105/DD-110/DD-111/DD-112; docs/features/FE/feature_session_management.md + BE/feature_session_management_tech.md; the three existing commands in session-service.ts as the house pattern (row lock, DB clock, ordered outbox events, authorizeTenantAction re-check under lock, typed error codes, t(vi,en)).
SCOPE: the command functions; ActionClass literals update_open_session / close_session / cancel_session entering the enum IN THE SAME COMMIT as the command that calls them (DD-110 D3 — no dark literals); tests including the MANDATORY negative test from DD-110 D4 (updateSession on a draft must NOT call authorizeTenantAction) and the suspended matrix (close/cancel allowed under suspension, update denied); outbox events exactly as the spec pins them.
NEGATIVE SCOPE (hard): any capacity change on a session that already has charges — DD-112 is OPEN Tier C: implement whatever conservative branch the packet pins (typed rejection or omit capacity edits); if the packet is silent there, AWAIT with exactly one proposal. No DeleteSession (DD-104 parked). No routes, no FE, no migration unless the packet explicitly demands one, no schedule enablement.
PROCESS: hand-write the runtime manifest from docs/autopilot-manifests/_TEMPLATE.json, register via scripts/autopilot-scope-gate register --manifest .autopilot/state/<feature>/manifest.json, then VERIFY .autopilot/state/<feature>/registered-manifest.sha256 exists before any write. 1 slice = 1 branch = 1 worktree off verified main. Verify with DATABASE_URL_TEST pnpm test + typecheck + lint + exact diff vs pinned base. Independent review via scripts/codex-review-pin.sh + one security round (money-adjacent authz). If the reviewer is unreachable: HALT TOOL_UNAVAILABLE, do not self-lower the gate. End READY | AWAIT | HALT with the standard report.
```

---

## P2 — Reader đầu tiên của DD-29 entitlement registry (hard dependency phase-1)

Vì sao: code dark từ 07/08; DD-114 D2 owner-final. Có thể chạy **song song P1** nếu scope-gate không báo
collision trên `authorization.ts`/barrel — nếu báo thì chạy sau P1.

```text
Task contract (Level 3, STOP_AT_READY, AUTO_MERGE off, model fable):
OUTCOME: the FIRST production reader of the DD-29 capability registry — a fail-closed capability resolver in packages/db plus its first real enforcement point, ending the code-dark state measured since 07/08. This is a DD-114 hard dependency (money features gate on host_pro).
CONTEXT FIRST: decisions.md DD-29/DD-40/DD-110 (note the billing-authz invariant token) ; migrations 0027/0028/0029 (definer read fn, plans free|host_pro, entitlements jsonb {"capabilities": {...}}, tenant_provision repoint); billing BE spec §2/§4b; packages/db/src/authorization.ts. Do NOT invent shapes — read the actual jsonb contract from the migrations.
DESIGN CONSTRAINTS: resolver runs inside the caller's tx (same discipline as authorizeTenantAction); fail closed on EVERY degenerate input — missing subscription row, missing plan, missing capabilities key, malformed jsonb, unknown capability name => denied; no caching across tx.
FIRST ENFORCEMENT POINT: only wire it where a Reviewed contract pins it. DD-114 D2 names payment_reconcile_auto as the first enforced capability, but the reconcile pipeline does not exist yet — so if no Reviewed spec pins an enforcement point that exists in code TODAY, deliver the resolver + full fail-closed test matrix as the slice, and go AWAIT with exactly one proposal for the wiring slice. Do not guess a gate into existing commands without authority.
SCOPE: resolver + tests (fail-closed matrix incl. tenant with no subscription, capability absent, false, malformed) + barrel export + (conditionally) the pinned enforcement point.
NEGATIVE SCOPE: no new tables/migrations, no changes to tenant_provision(), no pricing/UI/routes, no subscription lifecycle logic, no enablement.
PROCESS: check docs/autopilot/contracts/ + docs/autopilot-manifests/ for an existing packet (plans-dd29-capability-registry landed earlier — read its landing record); author a slice packet if none covers this; scope-gate register with runtime manifest + sha256 check; worktree off main; DATABASE_URL_TEST pnpm test; codex-review-pin.sh + security round (money/authz). End READY | AWAIT | HALT.
```

---

## P3 — `public_projection_fences` — immediate-deny path (8a, nợ DD-12)

Vì sao: chặn toggle public/private của phase-1 (DD-114 D3); lỗ private/cancel đang lộ thật. **Mang
migration ⇒ chạy MỘT MÌNH**, không song song với lane migration khác.

```text
Task contract (Level 3, STOP_AT_READY, AUTO_MERGE off, model fable):
OUTCOME: land-ready slice for the public read-model immediate-deny path (ROADMAP §Next Actions 8a — a DD-12 debt, prerequisite of DD-114 D3): public_projection_fences + guarded view + narrow raise / CAS-clear + public_projection_version + grant migration moving consumers off the base table. Today a session flipped to private (or cancelled) stays visible in public_sessions until the async projector runs; this closes the hole at read time, fail-closed.
CONTEXT FIRST: decisions.md DD-12 + DD-73..78 (Q5 re-scoped the fence into DD-12) + DD-114 D3; BE/feature_marketplace_discovery_tech.md; packages/db/schema.ts + migrations 0006 (discovery) + 0009 (RLS/grants pattern) + 0024 (capacity CHECK); rls-invariants.test.ts public-whitelist invariants (HARD RULE 2).
SCOPE: one expand-safe migration at the next free number (>= 0033, re-verify tail first — do not trust prose); minimal db helpers for raise/CAS-clear; invariant tests proving (a) immediately after a private/cancel transition and BEFORE any projector run, no public consumer can read the row; (b) after grant migration, no consumer role can read the base table at all; (c) the public field whitelist is unchanged — no money/PII (HR2).
NEGATIVE SCOPE: no /s/<id> share route (DD-73, separately blocked by DD-41), no projector implementation or rewrite, no owner-facing toggle route/UI, no DD-41 whitelist additions, no schedule enablement.
SEQUENCING: this slice owns a migration — run it alone; do not parallel with any other migration-bearing slice.
PROCESS: packet + runtime manifest + scope-gate register (verify registered-manifest.sha256); worktree off main; real-PG verification via DATABASE_URL_TEST pnpm test; codex-review-pin.sh + one security round (public data boundary / grants). End READY | AWAIT | HALT.
```

---

## P4 — Phiên reconcile đo lường (chạy lúc nào cũng được, cần Postgres local)

Vì sao: gom V5/V6/V7/V9 của audit vào một phiên; re-pin trục Tests sau 9 ngày.

```text
Docs/measurement reconcile session — no product code, no worktree needed beyond the docs rules.
1. Run the canonical runner on THIS machine: docker compose -f infra/docker-compose.yml up -d postgres, then DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm test. Record workspace + validator counts separately (never mix the two scales — see ROADMAP measurement contract rule 4). This re-pins the Tests axis (current authority: 854 workspace + 30 validator @ 93f1e93, 15/08).
2. decisions.md: backfill the missing summary-table rows for DD-110, DD-111, DD-112 (bodies exist; the in-file caveat documents the gap). One row per DD, status mirroring the body exactly; remove or update the caveat once the table matches.
3. BUILD-STATUS.md: add a new LIVE TRUTH block for current HEAD (AnnounceSession d925c99, the --price-only authorized-close 21/08, DD-113/114 owner-final, DD-115 proposal, new runner number from step 1). Newest-block-on-top convention per HANDOFF v1.35.
4. docs/templates/feature-spec-template.md: fix the UC floor "Minimum 8" -> ">= 10" to match the review gate in docs/features/README.md v2.33, and update the mismatch warning in CLAUDE.md (and its AGENTS.md mirror) to "resolved on <date>".
5. After P0's push, read the ACTUAL latest GitHub Actions runs on main (CI, Security, linear-sync) and record real statuses — never claim full-matrix green without reading runs; also confirm linear-sync still updates progress.json.
Owner-facing docs => Vietnamese. pnpm review:check:changed must pass before every commit. Stop at committed + validators green; report the new runner number and any drift found.
```

---

## P5 — Auth order-4: email/password bundle (nếu còn thời gian trong ngày)

Vì sao: bước kế đã pin sẵn của lane auth (DD-80 §10), flag OFF; là điều kiện để gỡ 2 route Telegram-era
(nợ DD-37 đang trôi — audit V8). Scope `apps/web` nên không đụng P1–P3.

```text
Task contract (Level 3, STOP_AT_READY, AUTO_MERGE off, model fable):
OUTCOME: the order-4 email/password bundle from DD-80 §10 slice order (flag OFF, gate C7) — the pinned prerequisite for the follow-up slice that removes the Telegram-era auth routes (DD-37 debt).
CONTEXT FIRST: docs/auth/auth-s4-session-handoff.md (the hot handoff for this lane — treat it as the resume point and reconcile it against live code first; if it has drifted, fix the handoff doc before coding and AWAIT if any owner decision is missing); decisions.md DD-13/DD-80; migrations 0015-0018; the google lane routes + tests in apps/web as the house pattern (rate limit, envelope, login-state cookie, i18n).
SCOPE: exactly what the auth handoff pins for order-4, feature-flag OFF by default, tests at google-lane rigor (including rate-limit and token-misuse negatives).
NEGATIVE SCOPE: do NOT remove the Telegram routes in this slice (that is the next slice, after this one merges); no enablement/go-live decisions; no FE screens (FE PENDING); no new auth providers.
PROCESS: packet + runtime manifest + scope-gate register (sha256 check); worktree off main; DATABASE_URL_TEST pnpm test + typecheck + lint; codex-review-pin.sh + MANDATORY security round (auth/credentials). End READY | AWAIT | HALT.
```

---

## Ghi chú vận hành cho cả ngày

- **Base:** mọi lane register sau khi P0 push xong, từ `main` mới. Kit version đọc từ header
  `scripts/autopilot-scope-gate`, không tin số chép tay.
- **Song song:** P1 ‖ P2 được nếu scope-gate không kêu; P3 một mình (migration); P5 scope `apps/web`
  rời hẳn. Đừng mở quá 2 lane writing cùng lúc — review round của codex là nút cổ chai thật.
- **FE PENDING:** vẽ Pencil thoải mái, nhưng không `git add *.pen`, không mở page/component, kể cả
  "tiện tay". P0b là đường đúng để đổi trạng thái này.
- **Đừng đụng hôm nay:** chat slice 7/8 (ngoài phase-1 — DD-114 D7), DeleteSession (DD-104 parked),
  nhánh capacity-with-charges (DD-112 ⬜), mọi enablement (schedule/Google go-live — owner decision).
