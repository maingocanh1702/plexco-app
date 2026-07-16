# RUN — Auth security-design pass (auth-onboarding v3)

> ⛔ **SUPERSEDED — DO NOT RUN AS-IS (2026-07-10).** Auth-onboarding **v3 đã MERGE vào `main@1eb6f60`** (`5b1193b`); migrations `0012/0013` + auth code (Telegram-era) đã committed. Tip `3717659` + "tạo `feat/auth-onboarding-v3` từ base cũ / build from zero" **KHÔNG còn đúng**. Ngoài ra **DD-37** bỏ Telegram → auth phase-1 = **Google OAuth + email/password** (DD-13 ✅), nên pass này phải **soạn lại** thành: (1) audit bất biến SI-1..SI-8 trên code đã merge; (2) **swap provider** Telegram Login → Google/email. Xem `docs/standards/BUILD-STATUS.md` + `BE/auth-security-invariant-table.md`. Giữ file làm tham chiếu quy trình, **không chạy nguyên trạng**.

> **Model:** Sonnet 5 (1M). **cwd:** `.autopilot/worktrees/phase1-fable5` (branch `feat/phase1-fable5` @ `3717659`).
> **Posture:** NORMAL INTERACTIVE. Autopilot làm **PHASE A (design) → STOP chờ founder chốt → PHASE B (re-slice)**.
> Plan nguồn: `docs/proposals/auth-security-design-pass-plan-2026-07-06.md` (approved 2026-07-06).
> Paste khối `text` dưới vào Claude Code trong worktree.
>
> ⚠️ **v3.4 / DD-37 + DD-13 (10/07/2026):** OQ-1 ĐÃ CHỐT — phase-1 web-auth = **Google OAuth + email/password** (Telegram Login **bỏ**, DD-37); link Facebook (DD-33 🟡) + Zalo (DD-14 ⬜). **SI-2 keyed-hash áp cho `google.sub` / email** (không còn `telegram:id`). Coi các nhắc "TG Login" bên dưới = **Google/email**.

```text
AUTH SECURITY-DESIGN PASS — auth-onboarding v3 — NORMAL INTERACTIVE FLOW

cwd = worktree .autopilot/worktrees/phase1-fable5, integration branch feat/phase1-fable5 (tip 3717659).
Governance unchanged: $CODEX cross-model review, scope-gate, per-file staging, NEVER git add -A,
decision-table-before-money, 5 HARD RULES. Class-aware gate — but auth is STRICT: zero finding on
auth/security/PII/money surface REGARDLESS of P-level (backlog carve-out is ONLY for non-security
NL-parsing/format).

REQUIRED READING FIRST (do not skip):
- docs/proposals/auth-security-design-pass-plan-2026-07-06.md  (the approved plan; SI-1..SI-8 + 4 real gaps)
- Reviewed specs: docs/features/feature_web_auth_onboarding.md + BE/feature_web_auth_onboarding_tech.md
  (rotation L19/L69/L21/L144, web_sessions.rotated_from L46, session-fixation test L167, TG HMAC L83)
- docs/features/feature_identity.md + BE/feature_identity_tech.md (keyed-KMS lookup hash L118/L139 — CHANNEL layer)
- Evidence trail: .autopilot/state/auth-onboarding-v2/codex/round-01..09.txt + HALT-MAX_ROUNDS.txt
  + AWAIT-FOUNDER-round09-nonconvergence.txt + regions.log + prescan.md
- v2 code for reference: branch feat/auth-onboarding-v2 @ 7407caa (fixes round 06-08 carry over)
- Live schema: packages/db/schema.ts + packages/db/migrations/*.sql

CRITICAL LAYER DISTINCTION (v2 blurred this — do not repeat):
  web-auth identity  = account_identities.platform_user_hash        (schema.ts L129 / migration 0001 L112; PLAIN text today)
  channel identity   = channel_identities.platform_user_lookup_hash (schema.ts L60; keyed-KMS mandated)
  round-09 is on the WEB-AUTH column → keying it is a NEW decision (gap), not drift from the channel mandate.
  (DD-37: phase-1 web-auth provider = Google `sub` / email — the keyed hash covers those, NOT telegram:id.)

======================= PHASE A — DESIGN (do, then STOP) =======================

A1. Read everything above. Confirm the 4 real gaps from the plan: (1) pre-auth login-CSRF browser-bound
    state; (2) explicit tenant-filter policy; (3) KMS/secret source wiring; (4) keying for web-auth
    account_identities.platform_user_hash.

A2. Author docs/features/BE/auth-security-invariant-table.md — an EXECUTABLE invariant + test matrix.
    One row per SI-1..SI-8 (per the plan §4). Columns: invariant | threat blocked | test (concrete
    assertion) | canonical/schema ref | EXACT column + layer. Derive invariants FROM the Reviewed specs
    (do not invent); mark each of the 4 gaps as gap-to-pin (DD-31). SI-1 must name the 3 new artifacts
    (auth_login_state migration, login-state issue route, callback consume). SI-2 must use
    account_identities.platform_user_hash (web-auth), NOT the channel column.

A3. Draft a DD-31 entry (proposal 🟡) for docs/standards/decisions.md: "Auth security invariant + test
    matrix" — the executable invariants + the 4 gaps. Do NOT mark ✅ yet.

A4. Surface these OPEN QUESTIONS for the founder — DO NOT self-decide:
    OQ-1: RESOLVED (DD-13 ✅, DD-37) — Phase-1 auth = **Google OAuth + email/password** (Telegram Login REMOVED per DD-37); link Facebook (DD-33 🟡) + Zalo (DD-14 ⬜). Implement Google/email; no longer open.
    OQ-2: KMS/secret source — which store provides the keyed-hash key + login-state secret (env / secret manager)?
    OQ-3: Record DD-31 now, or keep it proposal until v3 merges?

A5. STOP. Report: the invariant table, the DD-31 draft, and OQ-1/2/3. WAIT for founder chốt.
    Do NOT touch feature_web_auth_onboarding_tech.md and do NOT create the v3 branch yet.

======================= PHASE B — RE-SLICE (only after founder chốt) =======================

B1. Apply founder answers. Pin ONLY the 4 real gaps into BE/feature_web_auth_onboarding_tech.md — do NOT
    rewrite the parts already mandating rotation / channel keyed-hash / HMAC. Finalize DD-31 per OQ-3.

B2. Author the slice manifest for auth-onboarding-v3 (cp _TEMPLATE.json). Scope MUST include: the 3 SI-1
    artifacts + web-auth keyed hash for Google `sub` / email (SI-2, web-auth column — DD-37: replaces telegram:id) + tenant-filter (SI-3) + logout (SI-4)
    + rate-limit (SI-5) + creation-race/idempotency (SI-6) + session rotation (SI-7) + onboarding_steps
    dedupe 0013 (SI-8).

B3. git checkout -b feat/auth-onboarding-v3 from feat/phase1-fable5 tip (3717659). Implement TEST-FIRST
    to every invariant (incl. superuser-harness for SI-3). Use feat/auth-onboarding-v2 @ 7407caa as
    reference — this is coherent re-implementation to the table, not throwaway.

B4. "$CODEX" review -c model="gpt-5.6-sol" -c model_reasoning_effort="xhigh" --base feat/phase1-fable5 | tee .autopilot/state/auth-onboarding-v3/codex/round-NN.txt
    STRICT auth gate: zero auth/security/PII finding regardless of P-level; require 2 CONSECUTIVE CLEAN
    rounds. If a genuine NEW P1 surfaces (not a style nit) → STOP and report (do not grind past it).

B5. On 2 clean + VERIFY_CMD green + next build green → git merge --no-ff feat/auth-onboarding-v3 into
    feat/phase1-fable5. Update .autopilot/phase1/PROGRESS.md + DECISIONS.md (S4 → INTEGRATED; forensics
    list). STOP — do NOT start S5; wait for founder go-ahead.
```
