# Autopilot slice — Auth D0 implementation packet (docs-only, split 1/2)

> **HISTORICAL / DO NOT RUN:** AP-27 already merged. Its generated packet is superseded for execution by DD-80 v1.88 and `g3-revoke-all-concurrency-probe-seed.md`, which split current D0 into the P0 manual-only D0a DB core and D0b web boundary. `/ap-27-docs-auth-d0-packet` is disabled; preserve the remaining text only as audit history.

> **Slug:** `docs-auth-d0-packet` · **Launcher:** `/ap-27-docs-auth-d0-packet`
> **Risk:** P2 docs-only · `manual_only` · STOP_AT_READY · 1 FULL-base Codex clean round
> **Canonical framework:** `autopilot-prompt-GENERIC` v0.6.0 or newer
> **Authority:** DD-80 (`standards/decisions.md` v1.86 — defect fix v4) · `b0-auth-credential-lifecycle-design-probe.md` (owner-approved; defect fixes v1.78 + v1.83 + v1.85 + v1.86) · `features/BE/feature_web_auth_onboarding_tech.md` v2.9b (acceptance D0-1..13) · `slice-readiness-verdicts.md` v0.6 (Verdict 3 D0 = CODE_READY)
> **Manifest:** `docs/autopilot-manifests/docs-auth-d0-packet.json`
> **Reference (READ-ONLY):** the AP-26 monolith `docs/auth-d0-d1-implementation-packet.md` at commit `cab0c2a` on branch `feat/docs-auth-d0-d1-implementation-packet` — it reached MAX_ROUNDS after Codex round-03 and was split. Read it ONLY via `git show cab0c2a:docs/auth-d0-d1-implementation-packet.md`; NEVER checkout/merge/rebase that branch.

## Task

```text
Author ONE new file docs/auth/auth-d0-implementation-packet.md: the D0 (auth-s4-d0-revoke-core) half of the
former AP-26 packet, so the founder's ATTENDED P0 session can implement D0 with zero design decisions
left.

Start from the reference monolith sections §A1/§A2/§A3 + the §D self-check rows for A1-A3 + the floors
note — lift verbatim where content already passed review — then apply EXACTLY the v1.86 pins and the
round-03 deltas:

1. §A1 (draft DDL 0015): add the partial index `web_sessions(account_id) WHERE revoked_at IS NULL`
   (expand-only; rollback = DROP INDEX) per B0 §6 amendment v1.86 item (2). Keep helper + wrapper +
   auth_audit_events + rotate parent-first replace unchanged from the reference.
2. §A2 (schema mirror): mirror the new partial index in the schema.ts draft alongside the §9(a) tables.
3. §A3 (route + fence + tests): add a fenced TypeScript DRAFT for the v1.86 issuance fence in
   apps/web/lib/session-cookies.ts — when a session cookie is present and auth_rotate_web_session
   returns null, do NOT fall back to createWebSession: clear the session cookie and surface a typed
   error that login routes map to generic AUTH_INVALID 401; the no-cookie mint path is unchanged
   (B0 §6 amendment v1.86 item (1)). Extend the test map to D0-1..D0-13 (D0-12 fence, D0-13 index
   catalog test) with expected results verbatim from tech v2.9b.
4. Re-audit EVERY citation against the current base: decisions v1.86 row line, B0 amendment line
   numbers, tech v2.9b matrix rows, verdicts v0.6 lines. Do not carry stale line numbers from the
   reference.

End with exactly one marker line AUTH_D0_PACKET_COMPLETE only when the §D self-check has no GAP.

Everything is DRAFT TEXT inside that one markdown file. Do not create or modify anything under
packages/ or apps/. Do not edit Reviewed specs, decisions.md, or the verdicts file. This packet is
traceability/preparation, not build authorization: P0 auth code remains founder-attended manual
workflow.
```

## Canonical read order (HARD RULE — read before writing anything)

1. `packages/db/schema.ts` + `packages/db/migrations/*.sql` (especially `0012_auth_functions.sql` and `0001` `web_sessions`) — live truth.
2. `docs/probes/b0-auth-credential-lifecycle-design-probe.md` — §3.1/§5.2/§6 (including amendments v1.83 AND v1.86)/§6.1/§6.2/§7/§8.3/§9(a)/§10.
3. `docs/features/BE/feature_web_auth_onboarding_tech.md` v2.9b — §3 endpoints, acceptance matrix D0-1..13.
4. `apps/web/lib/session-cookies.ts` (live `issueSession`/`clientIp`) + `apps/web/app/api/auth/logout/route.ts` + `apps/web/lib/api-envelope.ts` (style only — never edited).
5. Reference monolith via `git show cab0c2a:docs/auth-d0-d1-implementation-packet.md` (§A sections + §D rows + floors note).
6. `docs/standards/review-code-readiness-gate.md` v1.1 (no self-invented rules).

Any conflict between these sources → stop that section, write the exact two sides (file/line each) to `HALT-AUTHORITY_AMBIGUOUS.txt`. Never pick a side locally.

## Required packet structure (all sections mandatory)

| §   | Content                                                                                                                                                                        | PASS condition                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Draft DDL `0015_auth_revoke_account.sql` — internal helper (no app grant) + public wrapper (derives account from token) + `auth_audit_events` + rotate parent-first replace + **v1.86 partial index** | Every function/grant/index matches B0 §6/§6.1/§6.2/§8.3 + amendments verbatim; header states EXPAND-ONLY + full rollback           |
| A2  | Schema mirror B0 §9(a) + web_sessions index mirror — fenced TypeScript for `schema.ts`                                                                                          | Column-by-column vs live `0012`/`0001` (read the files, not memory)                                                                 |
| A3  | Route outline `/api/auth/logout-all` + **v1.86 issuance-fence TS draft** (`session-cookies.ts`) + test map D0-1..D0-13                                                          | 13/13 cases, each with the expected result verbatim from the v2.9b acceptance matrix; fence draft changes ONLY the stale-cookie-rotate-null branch |
| D   | Self-check table — per section: sources read (file+section), PASS/GAP                                                                                                           | No GAP before the completion marker                                                                                                 |

When every section passes, append exactly one marker line:

```text
AUTH_D0_PACKET_COMPLETE
```

## Rules

- Drafts are copy-paste-grade but live ONLY in the packet doc. Creating/modifying any file outside the manifest scope is a scope breach → HALT.
- Do not re-derive content the reference already got clean through review — lift, then patch the v1.86 deltas. Do not import the reference's §B/§C content.
- No floor changes (Argon2id, rate limits, cookie policy) — transcribe DD-80 only.
- Step 1 creates FRESH `.autopilot/state/docs-auth-d0-packet/regions.log` + `fix-round-count.txt` (this is a NEW slice; the AP-26 round budget does not carry over).

## Deterministic outcome

| State                                   | Required result                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| All sections PASS, self-check has no GAP | Marker `AUTH_D0_PACKET_COMPLETE` + READY flow                                |
| Any authority conflict                  | `HALT-AUTHORITY_AMBIGUOUS.txt` (exact both sides), no marker                 |
| Out of time                             | `HALT-TIMEBOX.txt`, safe commit, keep worktree                               |

Verification (docs-only):

```bash
"../../../node_modules/.bin/prettier" --check docs/auth/auth-d0-implementation-packet.md   # worktree has no node_modules; use the main-clone binary
git diff --check
git diff --stat main...HEAD   # must contain exactly the 2 manifest-scope files
```
