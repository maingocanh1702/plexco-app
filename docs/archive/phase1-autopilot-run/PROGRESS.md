# PHASE-1 AUTOPILOT PROGRESS — integration branch feat/phase1-fable5

> One line per slice: `<slug>: pending|in_progress|INTEGRATED|BLOCKED`
> INTEGRATED = folded into feat/phase1-fable5 after 2x FULL codex-clean + verify green.
> Updated by the orchestrator after every slice transition.

S1  monorepo-scaffold: INTEGRATED (merge 62860b9; 11 codex rounds, clean 10+11 @ 92e198d;
    descoped follow-up: infra-fly-provisioning-secret-boundary in backlog; DB-prep ordering → S3)
S2  core-lift: BLOCKED (REGION_THRASH @ round-03 — matching.ts flagged 3 consecutive rounds;
    branch feat/core-lift kept @ 5e5d723 for forensics; HALT sentinel in state dir) →
    re-sliced as core-lift-v2 with the full date-grammar decision table authored first
S2b core-lift-v2: BLOCKED (MAX_ROUNDS @ round-07 — quota 5/5 spent, new P2 surfaced:
    barrel exports node-only i18n → browser bundles break; branch kept @ 355fe9c;
    HALT sentinel + full ledger in state dir) → continues as core-lift-v3 (split remedy:
    same reviewed logic + browser-safe/server subpath export layout designed up front)
S2c core-lift-v3: INTEGRATED (merge 3717659; resume 2026-07-05 fixed round-04's inferYear
    30-day boundary — commit 7709174, 2 regression tests added. Round-05 confirmation surfaced
    a 15th finding — splitNameAmount grouped-trailing-amount misparse — founder-approved to
    merge as-is per the class-aware gate: proposal-only matcher, NL-parsing P2, not
    auth/money-authoritative; filed as core-matcher-grouped-amount-parsing in
    docs/autopilot-backlog.md. Barrel conflict with core-foundations (index.ts/.test.ts,
    sports.test.ts) resolved as supersets; VERIFY_CMD green post-merge, 111 core tests.)
S2d core-foundations: INTEGRATED (merge 916fd94; 2x clean rounds 01-02 first try —
    confirms the thrash was confined to the NL-parsing tail parked on feat/core-lift-v3)
S3  db-postgres-drizzle-rls: INTEGRATED (keystone; 14 invariant tests on real PG as runtime roles; 2x clean rounds 03-04; fixed 0006/0009 + NULLIF GUC pitfall + dual-parent occurrence policy)
S4  auth-onboarding: INTEGRATED (re-sliced 3x. v1 BLOCKED round-07 session-rotation gap →
    v2 PARKED @ round-09 non-convergence (4 distinct findings across rounds 06-09, never the
    same file twice) → founder called for a personal security-design pass rather than
    continued one-at-a-time patching → BE/auth-security-invariant-table.md (SI-1..SI-8) +
    DD-31 authored from the Reviewed specs + the v2 evidence trail (approved plan + RUN
    launcher synced 2026-07-06) → re-sliced FRESH as auth-onboarding-v3 from this branch's
    tip (base had ZERO auth code — v2 never merged, all of SI-1..SI-8 built/ported fresh).
    17 codex rounds, 2 consecutive clean (16-17). 19 findings / 9 fix-rounds: 9 class-A
    (auth/security/secret/authorization, incl. 2 P1s — missing AWS_REGION on the KMS
    client/round-13; SECURITY DEFINER functions missing pg_temp in search_path enabling
    session/account hijack via temp-table shadowing/round-15, empirically demonstrated
    then closed) all fixed to zero; 8 class-B (DB-correctness/infra/test) all fixed except
    migration-0000's role-creation race (masked by existing fileParallelism:false test
    config, dismissed with evidence, backlogged as db-migration-0000-idempotent-role-create).
    Merge 5b1193b. VERIFY_CMD green post-merge: 214 tests (111 core + 44 db + 3 bot + 56
    web), typecheck/lint/build clean. S5/S8/S9/S14's auth-onboarding dependency is now
    resolved — see their lines below. Full round trail + regions.log in
    .autopilot/state/auth-onboarding-v3/ (this worktree) and the DD-31/invariant-table docs.
S4b auth-onboarding-v2: SUPERSEDED by auth-onboarding-v3 (see S4 above). Branch/worktree
    kept @ 7407caa as read-only reference forensics (single-git-writer discipline; never
    merges directly) — its design + rounds 06-08 fixes carried forward into v3's own
    from-scratch re-implementation, ported/re-verified rather than copied wholesale.
S5  session-management: UNBLOCKED (auth-onboarding dependency resolved via v3, merge
    5b1193b) — ready to start; awaiting founder go-ahead per this session's own STOP (do
    NOT auto-start S5).
S6  sync-engine: CASCADE-BLOCKED (via S5 — S5 itself not yet started)
S7  payment-reconcile: CASCADE-BLOCKED (via S5/S6 + parked core matcher)
S8  identity-merge: UNBLOCKED (auth-onboarding dependency resolved via v3, merge 5b1193b)
    — ready to start; awaiting founder go-ahead.
S9  web-pwa-shell: UNBLOCKED (auth-onboarding dependency resolved via v3, merge 5b1193b)
    — ready to start; awaiting founder go-ahead.
S10 web-host-dashboard: CASCADE-BLOCKED
S11 web-player-view: CASCADE-BLOCKED
S12 marketplace-discovery: CASCADE-BLOCKED (via S5)
S13 cross-club-join: CASCADE-BLOCKED
S14 billing-lifecycle: UNBLOCKED (auth-onboarding dependency resolved via v3, merge
    5b1193b) — ready to start; awaiting founder go-ahead.
S15 host-pro-auto-reconcile: CASCADE-BLOCKED
S16 reminders-auto: CASCADE-BLOCKED
S17 telegram-adapter: CASCADE-BLOCKED
S18 zalo-adapter: CASCADE-BLOCKED
S19a assistant-kb-schema-ingest: CASCADE-BLOCKED (via S6/S14)
S19b assistant-answer-ask-panel: CASCADE-BLOCKED
S20 pwa-polish: CASCADE-BLOCKED

## Blocked branches (forensics)
- feat/auth-onboarding @ aa04829 — v1, superseded by -v2 (privilege-transition design delta);
  read-only reference, never merges directly.
- feat/auth-onboarding-v2 @ 7407caa (was 3b5da76 + 5 resume fix commits) — was PARKED at
  MAX_ROUNDS 5/5; resume 2026-07-05 fixed rounds 06-08, STOPPED at round-09 (founder call:
  take a security-design pass personally). Superseded by auth-onboarding-v3 (merged, see
  S4 above) — kept as read-only reference forensics, never merges directly.
- feat/core-lift @ 5e5d723 — v1, superseded by -v2 (REGION_THRASH re-slice); read-only
  reference, never merges directly.
- feat/core-lift-v2 @ 355fe9c — v2, superseded by -v3 (split remedy: browser-safe/server
  subpath layout); read-only reference, never merges directly.
- feat/core-lift-v3 — MERGED into feat/phase1-fable5 @ 3717659 (2026-07-05 resume); no
  longer a forensics-only branch, removed from this list. See S2c line above.
- feat/auth-onboarding-v3 @ 3ce516f — MERGED into feat/phase1-fable5 @ 5b1193b
  (2026-07-06/07 security-design-pass session); no longer forensics-only. See S4 above.

## Log
- 2026-07-05: Step 0 done. Worktree verified (feat/phase1-fable5 @ a0b5c36). Codex smoke OK
  (real verdict on empty diff, no auth-fatal, 8030 bytes). Required reading done:
  HANDOFF, decisions.md (DD-01..30), business-rules.md, core-db-principles, schema.ts,
  0009 RLS, db README, invariant catalog, GENERIC v0.5.1.
- 2026-07-06/07: Auth security-design-pass session (Phase A design + Phase B re-slice).
  Phase A: authored BE/auth-security-invariant-table.md (SI-1..SI-8) + DD-31 proposal from
  the Reviewed specs + v2 evidence trail; founder resolved OQ-1 (DD-13 stays TG-Login-only),
  OQ-2 (AWS KMS), OQ-3 (DD-31 stays proposal until v3 merges clean). Phase B: pinned the 4
  gaps into feature_web_auth_onboarding_tech.md v2.1, authored the auth-onboarding-v3
  manifest, built SI-1..SI-8 fresh in a new worktree, ran 17 codex rounds to 2 consecutive
  clean, merged (5b1193b). See S4 above + DECISIONS.md for the full trail including a
  self-corrected MAX_ROUNDS process lapse mid-session.
