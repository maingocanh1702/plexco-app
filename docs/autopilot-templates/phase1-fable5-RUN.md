# ▶️ Phase-1 RUN — copy-paste ready (Fable 5 · FULL LAUNCH · worktree + integration-branch · no time limit)

> ⛔ **HISTORICAL — NEVER RUN (superseded 2026-07-18).** File này chứa mô hình full-launch/integration-branch, P0 auth/money codegen và cross-slice execution không còn hợp lệ. Owner handoff hiện hành là `phase1-fable5-7h-PR-RUN.md`: đúng AP-22 docs-only, một worktree/session, STOP_AT_READY; AP-21 deployment là P0/manual. Giữ phần dưới chỉ làm forensic history; không copy/paste hoặc phục hồi từng đoạn.

> Bản đã điền sẵn `<REPO_PATH>`. Chạy trong **worktree `.autopilot/worktrees/phase1-fable5`** (root ở lại
> `main`), build lên **integration branch `feat/phase1-fable5`** — KHÔNG đụng `main`. Không hỏi, không giới
> hạn thời gian; bế tắc → **BLOCK** (giữ branch forensics). DD-16..28 ✅ (trừ DD-18 = go-live gate). S19 tách.
>
> ⚠️ **v3.4 / DD-37 (10/07/2026):** Telegram bỏ khỏi phạm vi; kênh phase-1 = web + **Zalo + Facebook Messenger** (Messenger lên **P2.5**, cần Meta App Review). Auth phase-1 = **Google OAuth + email/password** (DD-13 ✅), link Facebook (DD-33 🟡) + Zalo (DD-14 ⬜). Backlog: transport slices = **S17 Zalo · S18 Messenger** (không còn Telegram); Messenger **không còn OUT OF SCOPE**.
>
> ⚠️ **QUAN TRỌNG — schema đã COMMITTED & là SOURCE-OF-TRUTH:** `packages/db/schema.ts` + `migrations/0000-0013`
> (gồm RLS/grants/functions/seeds/auth_functions/onboarding_steps) **đã committed trên `main@1eb6f60`** — **KHÔNG còn
> untracked**, nên **Bước 0 "commit baseline" đã lỗi thời** (xem banner ⛔ ở trên, đừng chạy phần commit schema đó).
> Prompt cho S3 **ADOPT** schema này (không tạo lại), S14 **reconcile** billing (0007/0011 đang 4-tier cũ) sang DD-29.

## ~~Bước 0 — Setup (commit baseline schema)~~ — ⛔ LỖI THỜI (2026-07-10)

> Migrations `0000–0013` + `packages/db/schema.ts` **đã committed trên `main@1eb6f60`** → phần "commit untracked
> schema" bên dưới **KHÔNG còn áp dụng, ĐỪNG chạy**. Chỉ giữ lại phần onboard autopilot + pin `$CODEX` + tạo test DB.
> Cần soạn lại orchestrator cho post-merge state trước khi dùng (banner ⛔ đầu file).

### ~~Bước 0 (nguyên bản — chỉ tham chiếu lịch sử)~~ — chạy 1 lần trong terminal, ở REPO ROOT

```bash
cd "/Users/maingocanh/Projects/Plexco app"

# a) Onboard autopilot + pin $CODEX  (thay path codex THẬT — placeholder sẽ báo "MISS ... not executable")
scripts/autopilot-onboard.sh --codex /ABS/PATH/TO/codex-review-build
source ~/.zshrc

# b) Frontend skills: BẠN ĐÃ CÀI từ GitHub rồi → BỎ QUA. (đừng chạy `npx skills add` lại — nó bung
#    picker interactive, thừa). Prompt đã ghi "already installed — LOAD them" ở TOOLCHAIN MAP.
#    (muốn kiểm: `npx skills list` nếu CLI hỗ trợ, hoặc xem thư mục skills đã add.)

# c) Postgres test DB (RLS chạy Postgres thật, KHÔNG mock)
export DATABASE_URL_TEST="postgresql://USER:PASS@localhost:5432/plexco_test"

# d) Stage CÓ CHỦ ĐÍCH — TUYỆT ĐỐI KHÔNG `git add -A`, KHÔNG `git stash -u`.
#    packages/ = schema SOURCE-OF-TRUTH → BẮT BUỘC commit.
git status                                   # review từng thứ dirty/untracked
printf '\n.DS_Store\n' >> .gitignore         # đừng commit junk macOS (làm TRƯỚC khi add packages/)
git add packages/ docs/ .gitignore CHANGELOG.md AGENTS.md CLAUDE.md scripts/
git add docs/strategy/base-chat-package-feasibility.md docs/strategy/gtm-doi-soat-decision.md 2>/dev/null || true
# Nếu còn file lạ (vd .claude/skills = cache plugin): xử lý TỪNG CÁI TRƯỚC bước verify —
#   git restore .claude/skills     HOẶC     git add .claude/skills && git commit -m "chore: skills"

# e) FAIL-FAST + verify main SẠCH và == origin/main:
set -euo pipefail
git diff --cached --quiet || git commit -m "chore: commit canonical packages/db schema + phase-1 planning (DD-29/30)"
git push origin main
git fetch origin
[ -z "$(git status --porcelain)" ] || { echo "HALT: working tree chưa sạch — xử lý file còn lại rồi chạy lại"; exit 1; }
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"   # local main PHẢI == origin/main (fail → dừng)
echo "OK: main sạch & synced · CODEX=$AUTOPILOT_CODEX_BIN"
```

## Bước 1 — Tạo worktree (fail-fast, re-verify sync) rồi MỞ Claude Code TRỰC TIẾP trong worktree

```bash
set -euo pipefail
cd "/Users/maingocanh/Projects/Plexco app"
git fetch origin
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"   # re-verify TRƯỚC khi tạo worktree
git worktree add .autopilot/worktrees/phase1-fable5 -b feat/phase1-fable5 main
git -C .autopilot/worktrees/phase1-fable5 log -1 --oneline      # verify base = main tip
# → MỞ Claude Code với cwd = .autopilot/worktrees/phase1-fable5  (KHÔNG mở ở repo root) · model: claude-fable-5
```

## Bước 2 — Trong Claude Code (cwd = worktree), paste NGUYÊN khối dưới

```text
Task: Build Plexco Phase-1 (FULL LAUNCH, DD-29) end-to-end — feature. NOT greenfield: the DB schema
(packages/db/schema.ts + migrations 0000-0013, incl RLS/grants/functions/seeds) ALREADY EXISTS and is
AUTHORITATIVE — ADOPT/EXTEND it, never redesign. No live tenant money yet.

You are working in /Users/maingocanh/Projects/Plexco app (Plexco: multi-tenant, multi-sport platform for
recreational sports; PostgreSQL + domain model = canonical store; web app = the primary SURFACE
(not the store); money = bank-transfer reconcile).
NO prior conversation context. This prompt is self-contained. Model: claude-fable-5.
Time/tokens for this session are UNLIMITED — do not rush, do not truncate, prefer
correctness over speed. But run the work as ORDERED SMALL SLICES, never one mega-commit.

=========================================================================
MODE: AUTOPILOT ORCHESTRATOR
=========================================================================
You process the PHASE-1 BACKLOG (below) as an ordered list of slices, back-to-back,
each slice run through the FULL per-slice discipline of
`docs/autopilot-templates/autopilot-prompt-GENERIC.md` (v0.6.0) and the ALWAYS-APPLY
rules in `~/.claude/CLAUDE.md` (autopilot-invariants). This orchestrator adds only the
cross-slice sequencing; it does NOT relax any invariant or circuit breaker.

HOW TO READ THIS PROMPT (you are claude-fable-5)
  Treat everything below as OUTCOMES + non-negotiable CONSTRAINTS, not a step-by-step script. You
  already know git / pnpm / Drizzle / Next.js / RLS — execute the mechanics yourself, don't narrate them.
  The gates that ARE spelled out (Codex 2×-clean, money guard, per-slice invariant DoD, decision-table-
  before-money) are PROJECT GOVERNANCE distilled from real money incidents — NOT hand-holding for a weak
  model; keep them exactly. Use your own judgment for everything else. Each slice's `DoD` lines are the
  output contract — make them true.

AUTONOMY — founder is OFFLINE (NO TIME LIMIT — run as long as needed). SELF-DECIDE EVERYTHING; NEVER pause to ask.
  - Open product/design choices (framework detail, DD-05 open-vs-approval default, naming, a library
    pick, an ambiguous spec): choose the option MOST consistent with the specs + DDs + 5 HARD RULES,
    log one line in `.autopilot/phase1/DECISIONS.md` (choice + why), and PROCEED. Never wait.
  - Unattended progress WITHOUT breaking invariants — DO NOT auto-merge to `main`. The always-apply
    invariant (`~/.claude/CLAUDE.md`) forbids P1 auto-merge and ledger is pilot/0, so `main` is NEVER
    touched unattended. Instead build the whole backlog onto ONE long-lived INTEGRATION branch
    `feat/phase1-fable5` (branched off `main`): each slice = a short branch off the integration tip →
    Codex 2× clean + verify green → fast-forward it into `feat/phase1-fable5`. The founder reviews &
    merges the integration branch → main on return. This is fully unattended and asks nothing.
  - When a slice hits a real breaker (MAX_ROUNDS / REGION_THRASH / DESIGN_UNFIT / won't go 2× clean):
    the breaker fires for THAT slice as the invariants define — **leave its branch untouched for
    forensics (do NOT reset/clean/delete it)**, mark it BLOCKED + a forensic note in PROGRESS.md, and
    continue with the next slice whose deps are already on the integration branch. One stuck slice never
    freezes the run. No time budget — run until every in-scope slice is INTEGRATED or BLOCKED.
  - The ONLY things you may NOT decide around (safety invariants — never proceed unsafe):
      (1) NEVER fold money/identity/RLS/auth code into the integration branch unless it is 2× Codex-clean
          + verify-green. Not clean → BLOCK it, don't integrate it.
      (2) NEVER fake / skip / substitute `$CODEX`. If `$CODEX` is dead: stop MERGING, keep building
          branches to READY-pending-review, retry `$CODEX` ~every 20 min; report parked branches at end.
      (3) NEVER `git push --force`, weaken RLS/tenant isolation, put money/PII in public or in an LLM
          prompt, or auto-guess an unknown amount (fail-closed).

Global Risk header (applies to every slice unless the slice overrides)
  Autopilot maturity:   pilot (fresh repo; no ledger history)
  Codex review:         REQUIRED every slice — 2 consecutive FULL-base clean rounds.
                        `$CODEX` = "${AUTOPILOT_CODEX_BIN}". NEVER substitute a Claude/Task
                        sub-agent or PATH `codex`. A round counts only if it wrote
                        `.autopilot/state/<slug>/codex/round-NN.txt` and ends with a real
                        model verdict (no auth-fatal).
  Integration target:   `feat/phase1-fable5` (NOT `main`). Advancing the integration branch is gated
                        exactly like a merge: 2 consecutive FULL Codex-clean (ZERO findings — a P2 the
                        reviewer says "fix before merging", or any P2 on a money/data path, is NOT clean)
                        + <VERIFY_CMD> green + clean tree. `main` is NEVER touched unattended → respects
                        the always-apply invariant (P1 never auto-merge; ledger pilot/0). Founder merges
                        integration → main on return. (Set `INTEGRATE_TO_MAIN: no` — this is fixed here.)
    HARD MONEY GUARD (never relaxed):
      - NEVER fold a slice into the integration branch while ANY money/data/security finding is
        unresolved. Verify by READING the real round-NN.txt verdict lines — NEVER your own summary.
      - A money/identity/RLS slice that can't reach 2× FULL clean in budget → BLOCK it (leave the branch
        for forensics; do NOT integrate it); continue with other slices. Never `--no-verify`, never
        type-ignore, never grind past MAX_ROUNDS.
  Schema is NOT greenfield:  the DB schema ALREADY EXISTS and is AUTHORITATIVE — `packages/db/schema.ts`
                        + `packages/db/migrations/0000-0013` (roles/extensions, global_directory,
                        tenants_core, payments_ledger, channels_connectors, sync_engine, discovery,
                        billing, notifications_onboarding, RLS policies/grants, functions/triggers,
                        seeds). No live tenant money yet. Slices ADOPT/EXTEND this schema (never redesign
                        or duplicate existing tables; add columns/tables via a NEW migration only,
                        expand→contract — never edit an applied migration). They are P1 (money/RLS
                        careful), not P0-no-codegen. If you ever edit against LIVE money data → STOP.

Orchestrator state (create in Step 0, update after every slice)
  .autopilot/phase1/PROGRESS.md — one line/slice: `<slug>: pending|in_progress|INTEGRATED|BLOCKED`
  (INTEGRATED = folded into feat/phase1-fable5). Also `.autopilot/phase1/DECISIONS.md` (every autonomous
  choice) + a list of BLOCKED branches (kept for forensics).
  On (re)start: read PROGRESS; skip INTEGRATED; retry a BLOCKED slice only if its blocker is now gone;
  resume at the first ELIGIBLE slice (eligible ⟺ every `depends_on` is INTEGRATED on feat/phase1-fable5).
  If nothing is eligible (all remaining blocked on un-integrated deps) → those cascade-BLOCK → record & end.

Setup once (Step 0): You are ALREADY running INSIDE the worktree `.autopilot/worktrees/phase1-fable5` on
  branch `feat/phase1-fable5` (the owner created it and opened Claude Code here — per AGENTS, sessions run
  in a worktree; repo root stays on `main`). VERIFY: `pwd` ends with `/.autopilot/worktrees/phase1-fable5`
  AND `git branch --show-current` == `feat/phase1-fable5`; if NOT → HALT and tell the owner to open Claude
  Code inside that worktree (do NOT create it from here, do NOT work in repo root). `main` is NEVER touched.
  Resolve Codex ONCE: `CODEX="${AUTOPILOT_CODEX_BIN:?HALT CODEX_UNAVAILABLE}"; [ -x "$CODEX" ] ||
  { echo HALT CODEX_UNAVAILABLE; exit 1; }`; smoke `"$CODEX" review -c model="gpt-5.6-terra" -c model_reasoning_effort="xhigh" --base main` — auth-fatal or 0 bytes →
  HALT CODEX_UNAVAILABLE (never substitute a sub-agent / PATH codex). Create PROGRESS.md + DECISIONS.md
  under .autopilot/phase1/.

Per-slice loop (OUTCOMES + gate ORDER — do the mechanics yourself, don't narrate them)
  All work is INSIDE the worktree .autopilot/worktrees/phase1-fable5 (root stays on main). Each slice = a
  branch off the current `feat/phase1-fable5` tip, reviewed, then merged back into it. Gate ORDER is the
  point. Non-negotiable, in order:
   • AUTHOR the manifest FILE first (scope-gate HALTs if it's missing):
     `cp docs/autopilot-manifests/_TEMPLATE.json docs/autopilot-manifests/<slug>.json`, then fill scope ·
     invariants (from the catalog) · depends_on · dep_checks · base_ref=feat/phase1-fable5 · risk ·
     change_class. THEN `scripts/autopilot-scope-gate register --manifest docs/autopilot-manifests/<slug>.json`.
     Create FILE counters `.autopilot/state/<slug>/{regions.log,fix-round-count.txt}` (counters are files,
     not memory — incident: a run silently hit 12 rounds).
   • `git checkout -b feat/<slug>` off the integration tip (inside the worktree).
   • BEFORE any money / matcher / parser / router / auth / RLS code: paste a FULL decision table (every
     input class → one deterministic outcome, no silent fall-through) + design-probe the hardest real
     cases against any primitive you reuse. Required.
   • Test-first where verifiable: a production-shaped test that fails on the integration tip first.
   • Implement the minimum that makes the slice's DoD true. Commit logically; stage PER-FILE or PER-DIR
     with intent — NEVER `git add -A` / `git add .` (invariant). A file outside declared scope = you
     drifted → stop and re-scope.
   • Review: run EXACTLY `"$CODEX" review -c model="gpt-5.6-terra" -c model_reasoning_effort="xhigh" --base feat/phase1-fable5 2>&1 | tee
     .autopilot/state/<slug>/codex/round-NN.txt` (use "$CODEX", not a bare word; persist every round).
     Fix EVERY finding (money/data P2 included; a P2 the reviewer says "fix before merging" is NOT clean).
     Re-review until 2 consecutive FULL rounds with ZERO findings. >5 fix rounds, or the same region ×3,
     = the DESIGN is wrong → converge or SPLIT; if it still won't go clean → BLOCK (see failure handling).
   • Integrate ONLY when: verify green + 2× Codex-clean (read the real round files, not your summary) +
     tree clean → `git checkout feat/phase1-fable5 && git merge --no-ff feat/<slug>`;
     `scripts/autopilot-scope-gate cleanup --manifest docs/autopilot-manifests/<slug>.json`; delete
     feat/<slug>; PROGRESS.md → INTEGRATED. NEVER push to / touch `main`.
   • Then take the next slice whose deps are INTEGRATED. When all in-scope slices are INTEGRATED (or the
     rest are BLOCKED with no eligible work) → emit the FINAL report and stop.

Anti-patterns (NEVER): `git push --force`; `git add -A`/`.`; touch out-of-scope files; add
type-ignore/lint-ignore without founder approval; substitute `$CODEX` review; count an
unpersisted round; reach READY with a dirty tree; bundle a money state-mutation across many
flows into one slice (split UP FRONT — decision table per interaction).

Failure handling (autonomous — no founder pause, but breakers keep their meaning)
  GENERIC breakers 1-25 fire per-slice as the invariants define: HALT that slice and PRESERVE its branch
  for forensics (do NOT reset/clean/delete). The orchestrator does not stop the whole run — it marks the
  slice BLOCKED and continues with the next slice whose deps are INTEGRATED.
  • Slice can't reach clean/verify, design unfit, or findings keep spreading across files → BLOCK it:
    keep feat/<slug> as-is (do NOT merge/reset/delete — forensics), `git checkout feat/phase1-fable5`,
    write a forensic note in PROGRESS.md, take the next eligible slice. The integration branch is
    unaffected (the BLOCKED work stays on feat/<slug>, never merged).
  • A reused primitive fails the hardest cases → re-slice/redesign; still unfit → BLOCK.
  • `"$CODEX"` dead → stop integrating (can't verify), keep building slice branches to READY-pending-review,
    retry `"$CODEX"` ~every 20 min. Never fake/substitute review.
  Only a repo-wide unrecoverable (integration branch won't build at all, disk full) ends the run — write
  the forensic report and exit with a CLEAN working tree (commit or stash; never dirty).

=========================================================================
TOOLCHAIN MAP (Plexco)
=========================================================================
  Package manager:  pnpm workspaces (packages/core, packages/db, apps/web, apps/bot).
  Backend:          TypeScript, Express + SSE, Drizzle ORM, PostgreSQL (RLS ENABLE+FORCE),
                    pg-boss (queues/cron on Postgres). Zalo + Messenger HTTP adapters (Telegram bỏ — DD-37).
  Frontend:         apps/web = PWA (installable, offline shell). Stack: **Next.js App Router** is the
                    baseline per docs/channels/web/README.md (Express SSR is only a fallback; DD-10 still open)
                    — READ docs/channels/web/README.md + design-brief.md before S9; do not invent a new stack.
  i18n:             every user-facing string via t(vi,en) (HR5). No hardcoded single language.
  <VERIFY_CMD>:     pnpm -w install && pnpm -w typecheck && pnpm -w lint && pnpm -w test
                    (test uses DATABASE_URL_TEST; CI-equivalent env). S1 establishes this.
  Frontend skills (already installed — LOAD them in UI slices S9-S12 + S20):
    - taste-skill:   `design-taste-frontend` (base) + `minimalist-ui` (Linear/Notion direction,
                     fits host dashboard/roster/reconcile). Dials: DESIGN_VARIANCE low-mid,
                     MOTION_INTENSITY mid, VISUAL_DENSITY mid (dashboards). Add
                     `full-output-enforcement` if you catch yourself truncating/placeholdering UI.
    - emilkowalski:  `emil-design-eng` (motion/easing: ease-out for enter, spring for interactive;
                     semi-transparent shadows not solid borders). Run `review-animations` in S20.
  Design tokens:    docs/standards/design-tokens.md + docs/channels/web/design-tokens.md — every
                    color/spacing/typography via CSS var(--token); NEVER hardcode hex/rgba.

=========================================================================
REQUIRED READING (before S1, and re-read the slice-specific ones per slice)
=========================================================================
  Governance:  docs/00-start-here/HANDOFF.md §3 (5 HARD RULES) + §8 (traps);
               docs/standards/decisions.md (esp. DD-01,05,06,07,12,13,16-30, 33, 37, 40);
               docs/standards/business-rules.md (BL-PAY-1..9, BL-TEN, BL-ID, BL-BIL, BL-NTF, BL-SEC);
               docs/standards/core-db-architecture-principles.md (INV-1..10, P1..P16).
  Canonical schema (AUTHORITATIVE — PRESENT already; read FIRST for every schema/data-model slice):
               packages/db/schema.ts + packages/db/migrations/0000-0013 (+ packages/db/README.md,
               ERD.md). NEVER invent a table/column that already exists there; the SQL migrations
               (esp. 0009 RLS/grants, 0010 functions/triggers) are the source of truth for RLS. Feature
               specs = the product/behaviour contract, not the schema source.
  Frontend:    docs/channels/web/README.md, design-brief.md, ux-sync-design.md, design-tokens.md.

=========================================================================
PHASE-1 BACKLOG (ordered; slugs are scope-gate slugs)
=========================================================================
Sequential unless noted (each depends on prior foundation). Ceiling per slice ~≤3 modules /
~300 LOC of NON-test code; tests/scaffold may exceed. If a slice's Codex review keeps spawning
NEW distinct findings across many files → the slice is too big → MAX_ROUNDS HALT and SPLIT it
(money state across many flows must be split UP FRONT — invariants Captured-lessons).

S1  monorepo-scaffold                              [P2 · build-config]  AUTO-INTEGRATE
    Docs: HANDOFF §2; docs/product/ROADMAP.md P0-P1.
    Do:  pnpm workspaces (packages/core, packages/db, apps/web, apps/bot); tsconfig strict;
         eslint/prettier; vitest; pg-boss wiring; CI running <VERIFY_CMD>; .env.example.
    DoD: `pnpm -w install` clean; `pnpm -w typecheck` green; CI green.
    Depends_on: []. Invariants: [build-config].

S2  core-lift                                      [P1 · money-model, shared-core]  money-guard
    Docs: bestminton-to-plexco-analysis §4/§7; single-club-bot-port-map; bots-p1-portmap (pure-lift).
    Do:  lift PURE logic to packages/core: matching (generalize sport keyword), payments-logic,
         dates, format, i18n (per-tenant ctx), vietqr, sports; LIFT their tests. Strip DB/transport
         imports — core PROPOSES candidates/plans, never writes.
    DoD: lifted suites green isolated; matching proposes only; decision table for classifyAmount/
         coverage BEFORE code.
    Depends_on: [monorepo-scaffold]. Invariants: [money-model, shared-core].

S3  db-postgres-drizzle-rls                        [P1 · schema, auth]  money-guard  ← keystone (ADOPT existing)
    Docs: packages/db/schema.ts + migrations/0000-0013 (AUTHORITATIVE) + packages/db/README.md;
          HANDOFF §2/§3 (HR1); BL-TEN; core-db-principles INV-1; feature_multi_tenant(_tech).
    Do:  ADOPT the existing authoritative schema — do NOT redesign or duplicate it. Wire Drizzle
         (packages/db/drizzle.config.ts), apply migrations 0000-0013 to Postgres, verify the Drizzle
         client matches schema.ts. Implement the `tenantRepo(tenantId)`/`withTenant`
         (`SET LOCAL app.tenant_id`) choke-point IN CODE. RLS/grants/functions already live in 0009/0010
         — verify them, don't re-create. Anything genuinely missing for a slice → a NEW migration
         (expand→contract), never edit an applied migration.
    DoD (INVARIANT TESTS — keystone): (a) tenant A≠B isolation; (b) missing app.tenant_id → 0 rows
         (fail-closed); (c) public_sessions exposes ONLY whitelisted fields (no roster/debt/phone/email);
         (d) controller reaches tenant tables ONLY via tenantRepo. Migrations apply clean on a fresh DB.
    Depends_on: [monorepo-scaffold]. Invariants: [schema, auth].

S4  auth-onboarding                                [P1 · auth, identity]
    Docs: feature_web_auth_onboarding(_tech); DD-13 ✅ (Google OAuth + email/password — TG Login bỏ, DD-37);
          DD-33 (Facebook link 🟡) · DD-14 (Zalo login ⬜); feature_identity(_tech); feature_connector_onboarding §4.3b (DD-30, provisioning).
    Do:  web auth + session; tenant creation → plan `free` active immediately (BL-BIL-1); onboarding
         shell (connect APIpay via enterprise auto-provision — DD-30; money still lands in host bank).
         `persons` anchor (§P6); no root `users`.
    DoD: login/logout/session; new tenant `free`/active; confirm-before-persist money-adjacent name
         (DD-26); auth isolation test.
    Depends_on: [db-postgres-drizzle-rls]. Invariants: [auth, identity].

S5  session-management                             [P1 · schema]
    Docs: feature_session_management(_tech); BL-SES.
    Do:  host create/edit/close kèo (multi-sport, visibility/slots/join_policy/TZ), roster, waitlist,
         capacity; writes via tenantRepo + command layer; starts_at/ends_at + timezone (not date-only);
         manual roster ops with audit.
    DoD: CRUD tenant-scoped; deterministic waitlist promotion; RLS tests still green.
    Depends_on: [auth-onboarding]. Invariants: [schema].

S6  sync-engine                                    [P1 · schema, core-api]
    Docs: feature_sync_engine(_tech); DD-07 (SSE + LISTEN/NOTIFY); DD-12; bots-weekly-review O2/DD-24
          (pending_interaction primitive — if a multi-step host/money command needs a waiting slot).
    Do:  command bus → services → tenantRepo (+ Outbox event in SAME tx) → Projectors fan-out; SSE
         realtime via Postgres LISTEN/NOTIFY (direct conn DATABASE_URL_LISTEN). Idempotent projector
         (event_id, projector); public_sessions projector writes whitelist only.
    DoD: outbox exactly-once; projector idempotent + re-projectable; SSE delivers; public projection
         whitelist test.
    Depends_on: [session-management]. Invariants: [schema, core-api].

S7  payment-reconcile                              [P1 · money-model, schema]  money-guard  ← highest care
    Docs: feature_payment_reconcile(_tech); BL-PAY-1..9; HANDOFF flow §2; DD-30; bots-p1-portmap (M1).
    Do:  immutable ledger `bank_transactions` (UNIQUE(tenant,provider,external_id)) +
         `payment_allocations` + `charges` (RLS). Durable webhook `/webhook/apipay/:token` (HMAC on
         RAW body, timing-safe; persist raw BEFORE ack 200). reconcile worker → matching(core)
         PROPOSES; host MANUAL match/allocate + `/unmatched`. Allocation ∈ [0,amount]; charge paid
         only when fully covered; signed reversal only (BL-PAY-8). FULL decision table for amount
         classify + coverage BEFORE code (DESIGN_PROBE_REQUIRED). NO auto-settle/notify here (S15/S16).
    DoD: durable-before-ack; idempotent webhook; over-allocation blocked; unknown amount → fail-closed
         manual review (never auto-guess = STATE_CONSERVATION); reversal path; ledger tenant isolation.
    Depends_on: [session-management, sync-engine]. Invariants: [money-model, schema].

S8  identity-merge                                 [P1 · identity, auth]  money-guard
    Docs: feature_identity(_tech); DD-01 (phone verified = merge key); DD-26 (confirm-before-persist);
          bots-p1-portmap (I1/I2 — collision-ask, parseCompanionNames).
    Do:  Person/ChannelIdentity/Membership merge; `/link` OTP (high-entropy, short TTL, single-use);
         claim policy (name-only NEVER claims a membership with money — ID-UC-7); verified-signal
         auto-merge only; reconcile duplicate memberships on merge; audit every merge/claim.
    DoD: claim-with-money blocked without OTP/verified (HR4); merge preserves ledger history; collision
         → interactive confirm not auto-assign; cross-channel parity test.
    Depends_on: [auth-onboarding]. Invariants: [identity, auth].

S9  web-pwa-shell                                  [P2 · web-app, design-tokens]  AUTO-INTEGRATE
    Docs: docs/channels/web/README, design-brief, design-tokens. LOAD frontend skills.
    Do:  apps/web PWA: manifest (installable), service worker (offline app shell; NEVER cache money/PII
         — network-first for authed data), router, layout, CSS-var tokens, i18n provider (t(vi,en)),
         auth-guarded routes, SSE client hook (S6).
    DoD: Lighthouse PWA installable; offline shell; tokens only (no hex); no money/PII in SW cache.
    Depends_on: [auth-onboarding, sync-engine]. Invariants: [web-app, design-tokens].

S10 web-host-dashboard                             [P2 · web-app]  AUTO-INTEGRATE
    Docs: docs/channels/web/*. LOAD taste-skill + emil-design-eng.
    Do:  host dashboard: sessions list (soonest-first), detail + roster + waitlist, MANUAL reconcile
         (unmatched CK → pick charge/allocate), debt overview, live updates via SSE. All mutations via
         backend command API. Full loading/empty/error states (full-output-enforcement).
    DoD: core-api only; a11y basics; emil motion (ease-out enter); responsive; no placeholder UI.
    Depends_on: [session-management, payment-reconcile, web-pwa-shell]. Invariants: [web-app].

S11 web-player-view                                [P2 · web-app]  AUTO-INTEGRATE
    Docs: feature_player_view(_tech). LOAD taste-skill + emil-design-eng.
    Do:  person-self: my clubs / my kèo / my debt (person-authorized, own data only); join a session
         if join_policy allows.
    DoD: person-self authz test (no cross-person debt/PII); responsive; motion polish.
    Depends_on: [web-host-dashboard, identity-merge]. Invariants: [web-app].

S12 marketplace-discovery                          [P2 · marketplace, web-app]  AUTO-INTEGRATE
    Docs: feature_marketplace_discovery(_tech); DD-06 (area vs venue); DD-12 (public projection).
    Do:  publish kèo → public_sessions projection (whitelist, area-level until join — DD-06); discovery
         search/filter UI (sport/area/time/slots) reading the readonly public model (role `readonly`,
         SELECT on public only — ZERO grant on tenant money/PII).
    DoD: public read shows NO money/PII/roster; readonly role cannot read tenant tables; search works.
    Depends_on: [session-management, web-pwa-shell]. Invariants: [marketplace, web-app].

S13 cross-club-join                                [P1 · cross-club, identity]  money-guard
    Docs: feature_cross_club_join(_tech); DD-05 (open vs approval, per-kèo default open).
    Do:  player joins a kèo from marketplace across tenant; join request + optional approval (DD-05);
         creates membership/roster entry idempotently; reveals venue only when player outcome is active (DD-06).
    DoD: cross-tenant join respects join_policy; approval branch; no premature venue/PII leak; idempotent.
    Depends_on: [identity-merge, marketplace-discovery]. Invariants: [cross-club, identity].

S14 billing-lifecycle                              [P1 · billing, money-model]  money-guard
    Docs: feature_billing_lifecycle(_tech) (plans free/host_pro; Capability registry §4b); DD-29; BL-BIL;
          packages/db/migrations/0007_billing.sql + 0011_seeds.sql (EXISTING — seed the OLD 4-tier).
    Do:  ⚠️ Applied 0007/0011 seed the OLD 4-tier (`free_web/telegram/plus_channel/all_channels`).
         RECONCILE to DD-29 via a NEW migration (expand→contract; do NOT edit 0007/0011): `plans` →
         (`free`,`host_pro`), `entitlements` = capability flags (BE §4b), price host_pro=250000, drop the
         `selected_extra_channel`/plus_channel concept. Then `subscriptions`, `subscription_invoices`
         (SEPARATE ledger from player money); free → active immediately (no invoice); host_pro →
         trial→active→past_due→suspended; collect via CK match `invoiceCode` to PLATFORM account.
         `hasCapability(tenant,key)` gate reads config, not code.
    DoD: plans reconciled to free/host_pro (old 4-tier gone); free never past_due; host_pro lifecycle;
         capability gate config-driven (test #14); billing ledger isolated from player ledger; gate test.
    Depends_on: [auth-onboarding, sync-engine]. Invariants: [billing, money-model].

S15 host-pro-auto-reconcile                        [P1 · money-model, billing]  money-guard
    Docs: feature_payment_reconcile; DD-29 (capability `payment_reconcile_auto`); bots-weekly-review M1.
    Do:  when tenant capability `payment_reconcile_auto` ON: reconcile worker AUTO-settles a CK ONLY
         on a HIGH-confidence DETERMINISTIC match (pay_code / exact) from matching(core); else leaves
         it manual (`/unmatched`). AUTO-notify player-paid via Outbox → projectors (S6). Gated by
         `hasCapability` (S14). Fail-closed: ambiguous/low-confidence NEVER auto-settles.
    DoD: only capability=on tenants auto-settle; only deterministic matches auto-settle; ambiguous →
         manual (no auto-guess = STATE_CONSERVATION); notify fan-out idempotent; entitlement gate test.
    Depends_on: [payment-reconcile, billing-lifecycle]. Invariants: [money-model, billing].

S16 reminders-auto                                 [P1 · money-model, schema]  money-guard
    Docs: feature_notifications_reminders(_tech); DD-29 (capability `reminders_auto`); BL-NTF.
    Do:  when capability `reminders_auto` ON: scheduled debt reminders + pre/post-session reminders via
         pg-boss → Outbox → projectors (fan-out to enabled surfaces + web SSE). notifyPlayersPaid on
         every settle. Loop over tenants; SKIP free tenants (capability off).
    DoD: only capability=on tenants get auto-reminders; idempotent (no duplicate reminder per period);
         reads ChannelReachability per tenant; entitlement gate test.
    Depends_on: [payment-reconcile, sync-engine, billing-lifecycle]. Invariants: [money-model, schema].

S17 zalo-adapter                                   [P1 · transport-zalo]  money-guard  ← phase-1 P2 (DD-37)
    Docs: feature_zalo_channel(_tech); docs/channels/zalo/README; DD-14/DD-15 (Zalo unknowns — link-code
          covers worst case); connector_onboarding §4.1; HANDOFF §8 (no logic copy across transports).
    Do:  Zalo HTTP adapter in apps/bot (per-club BYO token), tenant middleware (webhookToken → tenant_id);
         number-reply state (GROUP Beta → DM number-reply, no inline buttons); host commands + player
         join + confirm + reminder delivery, ALL via the SAME command/services/core (thin adapter, NO
         business logic in the transport). Webhook-drift detect (getWebhookInfo). Projector delivers Zalo DMs.
    DoD: tenant routing correct (webhookToken); adapter has NO money/matching logic (calls core);
         join/confirm work; tenant isolation preserved; drift alert.
    Depends_on: [session-management, payment-reconcile, sync-engine, identity-merge].
    Invariants: [transport-zalo].

S18 messenger-adapter                              [P1 · transport-messenger]  money-guard  ← phase-1 P2.5, Meta App Review
    Docs: feature_player_messenger(_tech); docs/channels/messenger/messenger-channel-design.md;
          DD-37 + DD-65..68 (hybrid Page/routing/identity/delivery); feature_session_management(_tech);
          feature_cross_club_join(_tech); connector_onboarding.
    Do:  Messenger adapter (1 Meta App; central Plexco Page always + optional per-club Page); global-protected
         Page registry (`central|tenant`); page_id resolves endpoint/default context ONLY, then protected
         opaque action/ref/server picker resolves target tenant. Bind identity + reachability to Page+PSID;
         never auto-merge across Pages. Give host/player role-aware menus on either Page; `/newsession` uses
         one durable pre-dispatch wizard + shared idempotent SessionService; discovery/join uses paginated
         opaque actions + shared Join core. Revalidate tenant/person/AuthZ at every consume and mutation;
         fail closed on wrong/stale/replayed action. Delivery selects ONE reachable route (tenant Page →
         central Page → web/Zalo), deduped; 24h-window reminders stay best-effort. App Review required before GA.
    DoD: no duplicated Session/Join/business logic vs other transports; matrix covers central+tenant Page,
         2 tenants including a club without a Page, host/player/multi-role/multi-club/cross-club, stale/replay,
         races, provider-fail-after-commit, 24h boundary and one-route/no-duplicate delivery; tenant isolation;
         App-Review-gated GA noted.
    Depends_on: [zalo-adapter]. Invariants: [transport-messenger].

S19a assistant-kb-schema-ingest                    [P1 · schema, core-api]  ← DD gate
    Docs: club-ai-bot-knowledge-base §4-§5; decisions DD-16/17/20/23/28; feature_club_assistant_tech.
    GATE: DD-16/17/19/20/21/23/28 = ✅ (chốt 2026-07-05) → OK to build. DD-18 (LLM provider + privacy/
          ToS/DPA) stays ⬜: build against SWAPPABLE EmbeddingProvider/ChatProvider interfaces; do NOT
          hardcode a vendor; do NOT enable the assistant in production until DD-18 ✅ (GO-LIVE gate, not
          a build gate). Re-check decisions.md at run time; any build-gate DD back to 🟡 → BLOCK.
    Do:  `bot_configs` (config, NOT a Person — DD-20), `kb_sources/documents/chunks` (pgvector,
         tenant-private RLS), `embedding_cache`, `bot_queries`; ingest worker (dedupe content_hash;
         provider behind interface — DD-18). SCHEMA + INGEST ONLY (no answering yet).
    DoD: tenant A never retrieves tenant B chunks; missing app.tenant_id → 0 rows; ingest idempotent;
         every kb_/bot_ table in the RLS list.
    Depends_on: [db-postgres-drizzle-rls, sync-engine, billing-lifecycle]. Invariants: [schema, core-api].

S19b assistant-answer-ask-panel                    [P1 · core-api, web-app]  (DD-19 Phase A only)
    Docs: club-ai-bot-knowledge-base §5.2/§6; DD-19 (Phase A ask-panel FIRST), DD-21, DD-23, A1/A2.
    Do:  answer worker: intent-route (A2) → hybrid retrieve (BM25 + pgvector HNSW + RRF, DD-23) → KB-ONLY
         grounding (DD-21 — NEVER ledger/PII in prompt) → grounding/truthfulness counters (A1). Surface =
         IN-APP web "Hỏi trợ lý" ask-panel ONLY (DD-19 Phase A). Entitlement `assistant_ai_kb` (host_pro).
         Native in-app chat (Phase B) is OUT OF SCOPE this run.
    DoD: prompt context = ONLY kb_chunks (assert no ledger/PII); no-answer below min_similarity (no
         hallucination); entitlement gate; grounding/truthfulness counter emitted.
    Depends_on: [assistant-kb-schema-ingest, web-pwa-shell]. Invariants: [core-api, web-app].

S20 pwa-polish                                     [P2 · web-app]  AUTO-INTEGRATE
    Do:  run emil `review-animations` across the app, fix flagged easings/durations; a11y pass (focus,
         token contrast, keyboard, touch targets); install-prompt UX; empty/loading/error coverage;
         perf (code-split, lazy routes); final i18n sweep (zero hardcoded strings).
    DoD: review-animations clean; a11y checklist pass; no hardcoded strings/colors; Lighthouse PWA+a11y
         ≥ target.
    Depends_on: [web-player-view, web-host-dashboard, marketplace-discovery, assistant-answer-ask-panel].
    Invariants: [web-app].

--- OUT OF SCOPE (do NOT start) ---
  • Telegram channel: REMOVED from scope (DD-37 supersedes DD-09) — NO Telegram adapter in Phase-1.
    Phase-1 chat channels = Zalo (S17) + Facebook Messenger (S18). feature_player_telegram +
    channels/telegram/ are ARCHIVED (historical reference only).
  • Club Assistant **Phase B** — native in-app chat (`chat_channels/messages/members` + bot-participant,
    DD-19 Phase B): a large messaging subsystem; its own later track, NOT Phase-1 (Phase A ask-panel = S19b).

=========================================================================
Begin: run "Setup once" (VERIFY you are inside the worktree on feat/phase1-fable5, resolve $CODEX, create
PROGRESS.md + DECISIONS.md with all slugs = pending), then start slice S1. Proceed slice by slice per the
loop above. Integrate into feat/phase1-fable5 ONLY — never touch main.
=========================================================================

FINAL report (emit when every in-scope slice is INTEGRATED or BLOCKED — no time limit; run as long as needed)
  AUTOPILOT PHASE-1 — <COMPLETE | PARTIAL> (FULL LAUNCH, DD-29) — integration branch feat/phase1-fable5
  Slices INTEGRATED into feat/phase1-fable5 (slug → commit):
  BLOCKED slices (slug → why → forensic note + branch kept): <list or "none">
  Autonomous decisions taken: .autopilot/phase1/DECISIONS.md (<n> entries — founder to skim)
  Invariant tests (paste pass lines): tenant isolation / public whitelist / fail-closed /
                   durable-before-ack / person-self authz / entitlement-gate (free vs host_pro)
  Money proof: over-allocation blocked · unknown-amount fail-closed · reversal-only · idempotent webhook
  <VERIFY_CMD> final on feat/phase1-fable5: green   ·   PWA: installable + offline shell (evidence)
  Not attempted: Telegram (REMOVED — DD-37); Club Assistant Phase B native chat (DD-19 pha B). Messenger = S18 (App-Review-gated GA).
  Founder next: review feat/phase1-fable5 → merge to main; skim DECISIONS.md; handle BLOCKED branches.
```

## Khi bạn online lại
- **Review integration rồi merge vào main:** `cd .autopilot/worktrees/phase1-fable5 && <VERIFY_CMD>` → xem
  diff → ở root `git checkout main && git merge --no-ff feat/phase1-fable5` → push. `main` không bị đụng khi offline.
- **Dọn worktree sau khi đã merge+push (origin-verify):** `bash scripts/ap-finish.sh phase1-fable5`.
- Đọc `.autopilot/phase1/DECISIONS.md` + `PROGRESS.md` (`INTEGRATED`/`BLOCKED`). Slice `BLOCKED` giữ nguyên
  branch `feat/<slug>` + forensic note → xem lại, sửa design, paste `continue`.
- Nó KHÔNG fold code tiền chưa 2× Codex-clean vào integration và KHÔNG fake review → PARTIAL vẫn an toàn.
- DD-18 ⬜: đừng bật trợ lý AI ở production tới khi chốt provider + review pháp lý.
