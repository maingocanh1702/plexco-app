# Web MVP program — session handoff (2026-10-14 00:30 Asia/Saigon)

> **TL;DR (owner):** Đợt A (M0–M5) đã có 12 PR mở trên GitHub, tất cả CI xanh. 7 PR READY sau 3 vòng review Claude độc lập
> (#42 #43 #45 #46 #48 #49 + #51 docs). 2 PR có fix sau vòng 3 không được review lại theo trần 3 vòng (#44, #47).
> 3 PR chưa xong review (#50 vòng 3 có 2 should-fix chưa sửa; #52 vòng 1 bị cắt giữa chừng; #53 vòng 1 có 1 blocking chưa sửa).
> Đợt B/C (M6–M13) chưa bắt đầu. Không có gì được merge, deploy hay bật production. Phiên dừng theo lệnh owner.
>
> Agent-facing content below is in English (repo rule: prompts/handoffs an agent executes are English).

## 1. Operating rules in force (do not re-litigate)
- Owner prompt 2026-10-12 + DD-122 (PR #42): FE PENDING lifted; agent owns UI design; defaults applied "pending owner sign-off".
- **Review rule (overrides CLAUDE.md Level-3 Codex gate):** no Codex, no `scope-gate register/ready`, no `ap-finish`; ordinary
  branches, one PR per coherent change; every PR gets an independent Claude reviewer subagent (not the writer), security-focused
  reviewer for auth/money/webhook/deploy; **max 3 review rounds per PR**; still blocking after round 3 ⇒ leave open, mark blocked.
  PR bodies carry "Codex waived by owner 2026-10-12; reviewed by independent Claude subagent" + round tables.
- MUST HOLD: RLS fail-closed · money/PII never public · Postgres single source of truth (web/bots send commands) · identity/debt
  claim needs verified email or one-time link code · every string `t(vi,en)`. Never merge to main / deploy / enable prod creds.
- Environment: Docker daemon DOWN on the owner's Mac → DB suite only in CI (`verify`); sandbox denies local port binding →
  Playwright only in CI (`e2e-web`) or with the sandbox disabled; `git fetch/push`, `gh`, `git worktree add` need the sandbox off;
  Bash tool shell is zsh (wrap polls in `bash -c`); `ps` blocked; GitNexus MCP unavailable to subagents.
- Rate limits: a 5-hour usage window; 4 hits today (resets 04:20, 09:20, 14:20, 19:20, next 00:20). Killed agents resume via
  SendMessage in the SAME session only — a new session must re-launch from this file.

## 2. PR stack — state at handoff (all heads pushed; CI = latest run)

Superseded by `docs/sessions/2026-10-14-web-mvp-program-handoff-2.md` (2026-10-15).

Merge order (migrations are contiguous, `migrate.ts` refuses gaps): **#42 → #43 → #46 → #45 → #47 → #49 → #52 → #53**, and
**#44 → #48** (#48 also carries #43), **#44 → #50**, **#51 last** (docs; carries #42+#43 merged).

| PR | Lane | Head | Base | Migr. | Independent review | CI | Status / owner action |
|---|---|---|---|---|---|---|---|
| #42 | M0 docs DD-122 | 15cde0f | main | — | 3 rounds, READY | green | merge = sign DD-122 |
| #43 | M2a-1 `authorize()` + GET session routes | 7535e26 | main | 0049 | 3 rounds, READY (7535e26 applied round-3 nits, primary-read only) | green | merge first |
| #46 | M2c roster + manual mark-paid + reversal (BE) | 42ff94a | #43 | 0050, 0051 | 3 rounds, READY (r3: 0/0/7 nits) | green | ⚠️ DD-117: close/cancel refuse any session with roster/charge — owner decision (DD-125) |
| #45 | M1b club config + tenant profile definers | 80d7378 | #46 | 0052 | 3 rounds, READY (r3: 0/0/5 nits); 80d7378 = upstream merge only | green | — |
| #47 | M3a Zalo bot ingress | 940d77f | #45 | 0053 | r3: 0 blocking, 1 should-fix FIXED AFTER CAP (940d77f) — **not re-reviewed** | green | owner reads 940d77f (one FOR UPDATE + CAS arm + tests) or waives cap for a targeted re-review; AWAIT-verify Zalo facts (DD-126) |
| #49 | M3b web ⇄ Zalo link, empty-person re-parent | 5e56e1a | #47 | 0054 | 3 rounds, READY (r3: 0/0/4 nits) | green | before prod apply of 0054: merge #51 so DD-127 exists, or rename the header cite (sha-locked after apply); run `SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user` on the prod migration conn (DD-127) |
| #44 | M1a PWA shell + tokens + Google sign-in UI + create club | fb386e0 | main (after #42) | — | r3: 1 BLOCKING (open redirect via `//` pathname) FIXED AFTER CAP (fb386e0) — **not re-reviewed** | green (e2e incl. offline recovery) | owner reads fb386e0 (`safeReturnTo` + SW guard + tests) or waives cap |
| #48 | M2b host session workspace UI | 1f2bfa3 | #44 (+#43) | — | 3 rounds, READY (r3: 0/0/3 nits) | green | — |
| #50 | M5 staging readiness (DO specs, deploy workflows, log ctx, runbooks) | f3ceab7 | #44 | — | r3 (FINAL) = 0 blocking, **2 should-fix NOT yet fixed** + 3 nits (see §4) | green | prepared-only; needs one fix commit (runbook text) → then "fix after cap" like #44/#47 |
| #51 | Ledger + DD-123..DD-130 proposals + 11 backlog rows (+ this handoff) | 2b4a385 (+handoff commit) | #42 (+#43 merged) | — | docs-only, primary-checked | green | merge LAST; status table inside is a 19:25 snapshot — §2 of THIS file is current |
| #52 | M4 settings (`/me/settings`, club settings, 0055) — first whole-stack branch (#49 + #48) | aac3ff9 | #49 | 0055 | **round 1 interrupted by rate limit** (no report) | green | re-launch round 1 (brief in §5) |
| #53 | M2c-fe roster add/remove + mark-paid + ledger/reversal UI | f10d3a0 (= ddd8412 + merge of #52 tip) | #52 | — | r1 = **1 BLOCKING + 4 should-fix + nits, NOT yet fixed** (see §4) | PR-run green; push-run on ddd8412 failed only on the pre-merge fixture (fixed by the merge) | fix round 1 → round 2 → round 3 |

Worktrees (repo root stays on `main` @ 0db92b9): `.autopilot/worktrees/{mvp-m0-decisions, mvp-m2a-authorize, mvp-m2c-roster-markpaid,
mvp-m1b-club-config, mvp-m3a-zalo-ingress, mvp-m3b-link-consume, mvp-m1a-shell, mvp-m2b-host-ui, mvp-m5-staging, mvp-m4-settings,
mvp-m2c-fe, mvp-ledger}` — one per branch above, all clean, all pushed. Never rebase a pushed lane branch; cascade by `git merge --no-ff`.
Plans: `plans/261012-1400-web-mvp-program/` (repo root, committed in #42). PR-body source files: session scratchpad only (lost with the
session) — the GitHub PR bodies are the durable copy.

## 3. What is built (evidence = PR bodies + CI)
- Host: PWA shell (manifest, build-stamped SW, offline page + recovery, light/dark tokens DD-81 target C, axe-tested), Google sign-in,
  create club, club settings (name/timezone/locale, session defaults, Zalo bot connect), session list/create/detail/edit/publish/close/
  cancel, roster add/remove, manual mark-paid preview→confirm (cash | attested transfer, partial), ledger + reversal (`money.correct`),
  `/me/settings` (display name, linked channels, detach), `/me/link` (enter the bot's link code).
- Backend: `authorize()` capability gate (0049) replacing the interim role gate; `GET /api/sessions[/id]`; roster/mark-paid/reversal
  services + routes; tenant profile definers (0052); Zalo ingress (0053: durable verified webhook, encrypted bot secret, DM-only identity,
  `/start /me /link`); empty-person re-parent definer (0054); me-settings definers (0055). 56 migrations (tail 0055), contiguous.
- Infra (prepared, never run on DO): App Platform specs staging/prod, deploy-staging/production workflows (digest promotion bound to
  staging evidence), render guard, log request/tenant ids, runbooks (staging deploy, PITR drill, tenant #1, go/no-go).
- NOT built (Wave B/C, M6–M13): real projector/DLQ/scheduler, host_pro billing + bank-transfer auto + reminders, privacy/settings full,
  player-side find/join (web/Zalo/Messenger), player debts view, in-app chat, Messenger, email/password, hardening, pen-test.

## 4. Open review findings (exact text lives in the PR bodies; summarized here)

Superseded by `docs/sessions/2026-10-14-web-mvp-program-handoff-2.md` (2026-10-15).

**#53 round 1 (writer: fix as ONE commit, then round 2):**
- BLOCKING: remove dialog sends `note` the server never reads (`players/[playerId]/route.ts` forwards no note; `RemovePlayerParams` has
  none) → delete the field + body type + e2e assertion (a server slice may add it later).
- SF-1 offline state: disabled buttons point `aria-describedby` at hint `<p id>`s that render only on STATUS gate failure → give the
  offline `<p role=status>` an id / derive hint ids from the same `editable|payable` booleans.
- SF-2 add-player form: no `cmd.busy` guard in `submit`; name field editable after an uncertain failure (reset mints a new commandId while
  the first add may have committed → duplicate member by design, DD-85) → `if (cmd.busy) return;` + `readOnly={locked}`.
- SF-3 ledger `createdAt` rendered in browser zone while the page uses the session zone (`session-time.ts` invariant) → pass
  `timeZone: resolveTimeZone(session.timezone)`.
- SF-4 e2e mock answers `ALREADY_JOINED` for a duplicate displayName (server cannot) and never returns `replayed:true` → remove the
  name-dedup branch, inject via `failNext`, add a commandId→result map + a `replayed` assertion.
- Nits: `sessions-api.ts` 302 lines → split `roster-payments-api.ts`; one `NOTE_MAX`; `sourceLabel` fallback `t("Khác","Other")`;
  one `displayNameOf`; sheet cancel wording/reset-on-open flash; refetch on cancel after uncertain failure; total shows "—" while a line
  is invalid; announce step changes (focus first amount / result list); build body without the `"x"` placeholder; e2e new-id-after-4xx.
- Reviewer verified: status gates == server (reversal uses shared `lockSession` open|closed — the writer's "UI stricter" premise was false);
  commandId matrix; DD-25 binding; CSRF; i18n; HR2; contract fidelity matrix (all other fields exist).
**#50 round 3 (final; fix = "after cap" commit, then mark like #44/#47):**
- SF-1 three runbooks say "expect ONE `LOCK TABLE` warning"; `pnpm db:bootstrap` runs `01-job-definer.sql` AND `02-chat-definer.sql` →
  expect TWO `DEGRADED` warnings; the 2026-08-05 evidence was a doadmin-SHAPED role on local PG16, not a DO cluster; cluster must be PG ≥ 16.
- SF-2 §8 probe `curl … GET /api/sessions` hits a POST-only route (405, no `x-request-id`) → `curl -sS -o /dev/null -D - -X POST
  -H 'do-request-id: forged-00000000' https://<app>/api/sessions` and require 401 + header present + value ≠ forged.
- Nits: fail closed on a committed SECRET that carries a value; capture doctl stderr on the 5x failure; `provenance: false` + `sbom: false`
  on build-push so the digest is the image-manifest digest (DOCR/App Platform attestation-index first-run hazard).
- Owner notes: set the `production` environment "Deployment branches" to `main`; prefer fresh dispatch over re-run; never provision DO PG < 16.
**#52 round 1:** not started (interrupted). Brief = §5.

## 5. Exact next steps for a new session (in order)
1. `git fetch` + `gh pr list` + `git worktree list`; confirm heads match §2. Read this file and `docs/sessions/web-mvp-program-status.md`.
2. #53: launch a writer in `.autopilot/worktrees/mvp-m2c-fe` with §4's #53 list (ONE commit, no push by the writer; primary pushes),
   then a fresh independent reviewer round 2, then round 3.
3. #50: writer in `mvp-m5-staging` applies the two should-fixes + three nits as ONE commit; push; PR body gets the round-3 table +
   "fix applied after the final round, not re-reviewed (3-round cap)"; final report lists it with #44/#47.
4. #52: launch round 1 (combined code/FE + security) on the M4-authored commits `8028da1 075e4ee 2871a19 91b2f5b 0d7a9c5 dc03486` +
   merge `6e6eb09` resolutions, at HEAD aac3ff9; nine questions: detach lock order vs 0054; `zalo_identity_resolve` after detach (same
   scope hash, no duplicate Person); detach revokes channel-issued codes only; `\u`/`\U` regex in `person_profile_update` == TS validator
   (Vietnamese letters pass); `GET /api/me/channels` under a tombstoned Person fails closed; `auth/session` merge keeps both DTOs and never
   reads `m.role`; merged `link-code-form.module.css` has no undefined tokens; non-admin cannot reach club PATCH/Zalo connect from the UI,
   uniform 403, bot token never echoed/persisted; `MeFrame` focus order/skip link/24 px targets. Then rounds 2–3; cascade any #52 fix into #53.
5. After #52/#53 settle: cascade merges (#53 ← #52 tip), update #51's ledger status table from §2 (one docs commit), push, then write
   the final program report (template in §6) — owner-facing Vietnamese, with evidence links.
6. Only then consider Wave B (M6, M7) — each needs a fresh lane prompt; M7 needs provider accounts (SePay/ApiPay) = owner.

## 6. Final-report skeleton (fill from §2–§4)
What works with evidence (PR + CI link per capability) · Blocked on whom (owner: merges in order, DD-122 signature, DO resources/secrets
(runbook `docs/runbooks/staging-deploy.md` §2–§3), Google OAuth staging creds, Zalo OA facts (DD-126 AWAIT-verify list in #47), DD-117
close/cancel decision, DD-127 definer ownership measurement, DD-123 heading font, `AWS_REGION`, A3 legal, email vendor, Meta review;
environment: Docker/port binding) · Defaults applied (DD-122 D3 nine + DD-123..130 in #51; M4/M2c-fe proposals pending a DD-131/132
row: detach rule, reminder deferral, `CHANNEL_NOT_LINKED`, `me-profile`/`me-detach` buckets, source labels, partial-payment UX, no member
picker) · PRs fixed after the review cap: #44 (B1 open redirect), #47 (SF-1 token-unbound activation), #50 (pending) · Owner launch steps:
merge order → staging per runbook → PITR drill → go/no-go template → production dispatch (typed confirm).

## 7. Lessons captured this run (also in the primary's memory)
- Stacked PRs: a lane on the BE stack has no M1a UI → M3b shipped unstyled `/me/link`; the first whole-stack branch (M4) absorbed the
  conflicts. Decide the integration base BEFORE assigning UI work to a BE-stacked lane.
- Fixture rows must land in the owner-context database (`ns.superuser` is the BASE db client) — cost two CI runs on #49.
- A route-level broad SQLSTATE catch can swallow a definer's own fail-closed RAISE; narrow at the source by `routine` + message prefix.
- The 3-round cap converts round-3 findings into "owner reads the fix commit" — budget rounds so round 3 is a confirmation, not a first look.
- DO `doadmin` BYPASSRLS was already measured in `infra/postgres-init/01-job-definer.sql` (2026-08-05) — grep the repo before calling a risk unmeasured.
