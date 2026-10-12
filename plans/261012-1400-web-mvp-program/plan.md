# Plexco Web MVP program — plan (2026-10-12)

> Owner prompt 2026-10-12 (pasted) + `docs/autopilot-templates/web-mvp-2026-10-12-RUN.md` (M0–M13).
> Review rule for this program (owner override): **no Codex, no scope-gate lifecycle**; ordinary
> branches + one PR per coherent change + independent Claude reviewer subagent (≤3 rounds), second
> security reviewer for auth/permissions/secrets/money/webhooks/deployment.
> Design doc: `design.md` (architecture + conventions every slice follows).

## Baseline (measured 2026-10-12 at `main@0db92b9`)

49 migrations (tail `0048`) · 15 API routes (0 session READ routes) · 0 FE screens · 8 session
commands · typecheck/lint/format/review:check exit 0. Docker daemon DOWN on this machine ⇒ DB suite
runs in CI only; local verification = typecheck · lint · format · build · non-DB vitest.

## Waves and milestones

| M | Outcome | Status | Phase file |
|---|---|---|---|
| M0 | Record owner decisions (DD-122), commit RUN + BACKEND-HANDOFF, program ledger | ⬜ | phase-00 |
| M1 | PWA shell + tokens + Google sign-in UI + create club | ⬜ | phase-01 |
| M2a | `authorize()` (DD-56 M2/M3) replacing the temporary gate + session READ routes | ⬜ | phase-02 |
| M2b | Host workspace UI: session list/detail/create/edit/publish/close/cancel | ⬜ | phase-02 |
| M2c | Roster host-add + manual mark-paid (money, security review) | ⬜ | phase-02 |
| M3 | Zalo webhook + club⇄bot link + account⇄Zalo link (link_code first caller) | ⬜ | phase-03 |
| M4 | Settings minimum (profile, linked channels, club locale) | ⬜ | phase-04 |
| M5 | Staging infra (DO App Platform), logs, E2E, runbook, go/no-go | ⬜ | phase-05 |
| M6–M8 | Wave B: projector/sync, public toggle, host_pro money, privacy | ⬜ | later |
| M9–M13 | Wave C: player side, chat, Messenger, email login, hardening | ⬜ | later |

## Dependency order

M0 → M1 → {M2a → M2b → M2c} ∥ {M3} → M4 → M5 (wave gate, owner decides prod deploy).
M2a and M3 both touch `packages/db` migrations ⇒ **serialize migrations** (M2a first, M3 takes the
next free number after M2a lands or rebases).

## Slice protocol (every code PR)

1. Worktree `.autopilot/worktrees/mvp-<slug>` from `origin/main` (`git fetch` needs sandbox off).
2. Writer subagent: test-first, `pnpm -w typecheck && pnpm -w lint && pnpm -w format:check &&
   pnpm --filter @plexco/web build`; DB tests via CI.
3. Primary pushes branch, opens PR (gh, sandbox off), runs reviewer subagent(s) on the diff.
4. Fix blocking → re-review (fresh subagent) ≤3 rounds; still blocking ⇒ PR left open, marked blocked.
5. PR body: "Codex waived by owner 2026-10-12; reviewed by independent Claude subagent" + findings table
   + defaults applied.

## Owner-only (prepare, never execute)

Merge · production deploy · production credentials/flags (`GOOGLE_OAUTH_*`, `OUTBOX_DISPATCH_SCHEDULE_ENABLED`,
provider keys) · external submissions (Meta, lawyer, pen-test) · `ap3/routines.json`.
