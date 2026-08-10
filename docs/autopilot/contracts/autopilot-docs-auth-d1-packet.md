# Autopilot slice — Auth D1 implementation packet + DD-39 readiness (docs-only; DD-38 chat split out)

> **HOLD — NOT LAUNCHER-READY:** run only after both current D0 merged probes exist on `origin/main`: `packages/db/migrations/0015_auth_revoke_account.sql` contains `auth_revoke_all_web_sessions`, and `apps/web/app/api/auth/logout-all/route.ts` contains `revokeAllWebSessions`.

> **Slug:** `docs-auth-d1-packet` · **Launcher:** `/ap-28-docs-auth-d1-packet`
> **Risk:** P2 docs-only · `manual_only` · STOP_AT_READY · 1 FULL-base Codex clean round
> **Canonical framework:** `autopilot-prompt-GENERIC` v0.6.0 or newer
> **Authority (base `main@399c5eb`):** DD-80 (`standards/decisions.md` v1.88 — G3 concurrency closure) · `b0-auth-credential-lifecycle-design-probe.md` amendment v1.88 + v1.86 AAD-handoff · `features/BE/feature_web_auth_onboarding_tech.md` header v2.10 / changelog v2.11 (D1 order-3 IMPLEMENTED; acceptance D1-1..15) · `slice-readiness-verdicts.md` v2.0 (D0a/D0b merged = Verdict 6; D1/d1b = Verdicts 10-13; Verdict 2 = dd41 dep) · `review-code-readiness-gate.md` §11.2
> **Manifest:** `docs/autopilot-manifests/docs-auth-d1-packet.json`
> **Hard dependency:** run ONLY after `auth-s4-d0-revoke-core` and `auth-s4-d0-session-web-boundary` are both merged to `origin/main` and their exact merged probes pass. The historical `AUTH_D0_PACKET_COMPLETE` marker is not runtime dependency evidence.
> **Reference (READ-ONLY):** the AP-26 monolith `docs/auth-d0-d1-implementation-packet.md` at commit `cab0c2a` on branch `feat/docs-auth-d0-d1-implementation-packet`. Read it ONLY via `git show cab0c2a:docs/auth-d0-d1-implementation-packet.md`; NEVER checkout/merge/rebase that branch.

## Task

```text
Author ONE new file docs/auth/auth-d1-implementation-packet.md: the D1 (auth-s4-d1-google-adapter) half of
the former AP-26 packet plus a DD-39 gender/pricing readiness section — DD-38 chat is SPLIT OUT to root
slice dd38-dd86-chat-schema-core (owner decision 2026-07-23) — so the founder's ATTENDED P0 session can
implement D1 with zero design decisions left.

Start from the reference monolith sections §B (dependency note, B1, B2, B3) + §C (C1/C2/C3) + the §D
self-check rows for B1-B3/C — lift verbatim where content already passed review (including the v1.85
resolutions: oauth sweep-at-traffic cleanup owner in B1; per-lane audit finalizer + audit comment and
the B3 audit assertions) — then preserve the D1-specific v1.86 pin and apply the current v1.88 authority/base refresh:

1. §B2 function signature: auth_login_google gains a preallocated-id parameter for collision cell 1 —
   the app generates account_emails.id (UUID) BEFORE encrypting, the email_enc AAD contains that id
   per B0 §3.3 (v1.86 note), and the function INSERTs the new account_emails row with exactly that id.
   Cells 2/3/5/6 use existing rows and existing ciphertext — no rebind, no id accepted for them
   (B0 §4 v1.86 AAD-handoff paragraph). Update the signature comment block accordingly.
2. §B3 test map: extend D1-2 (cell-1 create) with the preallocated-id assertion — the created
   account_emails row id equals the id inside the AAD of the stored ciphertext (delivery-boundary
   decrypt check per §3.3 stays the enforcement point). Keep all v1.85 audit assertions.
3. §C3: re-pin the evidence base line to THIS slice's base SHA and confirm the v1.86 D1 pin plus
   the v1.88 G3 closure touched no §C source (both are auth-only authority changes).
4. Re-audit EVERY citation against the current base: decisions v1.88 row line, B0 amendment/section
   line numbers, tech v2.11 rows, verdicts v2.0 lines. Do not carry stale line numbers from the
   reference.

Do NOT place the AUTH_D1_PACKET_COMPLETE marker: §C's DD-38 chat half is split out (a §C source GAP under
the deterministic table's "§C missing sources" row), so the "no GAP" completion condition is not met. §C =
DD-39 gender/pricing only and asserts NO readiness state (gate §11.2); the packet ships without the marker.

Everything is DRAFT TEXT inside that one markdown file. Do not create or modify anything under
packages/ or apps/. Do not edit Reviewed specs, decisions.md, or the verdicts file. This packet is
traceability/preparation, not build authorization: P0 auth code remains founder-attended manual
workflow.
```

## Canonical read order (HARD RULE — read before writing anything)

1. `packages/db/schema.ts` + `packages/db/migrations/*.sql` (especially `0012_auth_functions.sql`) — live truth.
2. `docs/probes/b0-auth-credential-lifecycle-design-probe.md` — §2/§3.2#6/§3.3 (v1.86 note)/§4 (v1.86 AAD-handoff)/§4.1/§5.2/§8.2/§8.3 (v1.85 per-lane finalizer)/§10.
3. `docs/features/BE/feature_web_auth_onboarding_tech.md` header v2.10 / changelog v2.11 — §3 endpoints, §4, acceptance matrix D1-1..15.
4. `docs/features/BE/feature_identity_tech.md` v1.10 §4–§5 (lock hierarchy) · `apps/web/lib/session-cookies.ts` (issueSession/clientIp — style only).
5. For §C (DD-39 gender/pricing only): `docs/features/BE/feature_user_settings_tech.md` · `docs/features/FE/feature_user_settings.md` · decisions DD-39/DD-55 blocks · current `slice-readiness-verdicts.md` Verdict 2 · `review-code-readiness-gate.md` §11.2 (the evidence-inventory test). DD-38 chat sources (`feature_inapp_chat*.md`) are removed — chat is split to root slice `dd38-dd86-chat-schema-core`.
6. Reference monolith via `git show cab0c2a:docs/auth-d0-d1-implementation-packet.md` (§B + §C sections + §D rows).

Any conflict between these sources → stop that section, write the exact two sides (file/line each) to `HALT-AUTHORITY_AMBIGUOUS.txt`. Never pick a side locally.

## Required packet structure (all sections mandatory)

| §   | Content                                                                                                                                                  | PASS condition                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Draft DDL `0017_oauth_transactions.sql` — table + lifecycle CHECKs v1.78 + issue/claim functions with sweep-at-traffic + v1.85 cleanup-owner note        | Match B0 §4.1 + tech v2.10 §2 verbatim; single-use claim stays a DB CAS; v1.85 cleanup semantics transcribed                                 |
| B2  | Google adapter outline — proof matrix, 8-cell collision table, **v1.86 signature with preallocated `account_emails.id`**, per-lane audit comment (v1.85), route skeletons | 8/8 cells with expected outcomes verbatim; negative scope explicit; AAD handoff matches B0 §3.3/§4 v1.86                                     |
| B3  | Test skeleton D1 — map D1-1..D1-15 incl. v1.85 audit assertions + **v1.86 D1-2 preallocated-id assertion**                                               | 15/15 mapped with expected results verbatim from v2.10                                                                                       |
| C   | DD-39 readiness — C1 surface (gender/pricing, src-traced), C2 dependency, C3 criteria→evidence inventory (present/absent, no state); DD-38 chat split to dd38-dd86-chat-schema-core (one pointer, not enumerated)                            | Only listed from existing specs; every row src-traced; base note re-pinned to this slice's base SHA; no new tables invented                  |
| D   | Self-check table — per section: sources read (file+section), PASS/GAP                                                                                     | No GAP before the completion marker                                                                                                          |

The `AUTH_D1_PACKET_COMPLETE` marker is appended ONLY when the §D self-check has no GAP. **For this packet
it is NOT appended:** §C's DD-38 chat half is split out (a §C source GAP — the "§C missing sources" row in
the deterministic table below), so the "no GAP" condition is not met. The packet ships without the marker
and asserts no readiness state (gate §11.2 evidence-inventory test).

## Rules

- Drafts are copy-paste-grade but live ONLY in the packet doc. Creating/modifying any file outside the manifest scope is a scope breach → HALT.
- Do not re-derive content the reference already got clean through review — lift, then patch the v1.86 delta. Do not import the reference's §A content.
- No floor changes (rate limits, cookie policy, PKCE S256-only) — transcribe DD-80 only.
- Missing evidence for §C (spec insufficient to list schema surface) → record GAP in §C + `AWAIT-FOUNDER-dd3839-scope.txt`, do NOT infer.
- Step 1 creates FRESH `.autopilot/state/docs-auth-d1-packet/regions.log` + `fix-round-count.txt` (this is a NEW slice; the AP-26 round budget does not carry over).

## Deterministic outcome

| State                                    | Required result                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| All sections PASS, self-check has no GAP | Marker `AUTH_D1_PACKET_COMPLETE` + READY flow                                |
| Any authority conflict                   | `HALT-AUTHORITY_AMBIGUOUS.txt` (exact both sides), no marker                 |
| §C missing sources                       | READY if B sections PASS; §C records the GAP + no marker; missing surface is AWAIT-flagged OR split to its own root slice + backlog anchor (THIS packet: DD-38 chat → `dd38-dd86-chat-schema-core`) |
| Out of time                              | `HALT-TIMEBOX.txt`, safe commit, keep worktree                               |

Verification (docs-only):

```bash
"../../../node_modules/.bin/prettier" --check docs/auth/auth-d1-implementation-packet.md   # worktree has no node_modules; use the main-clone binary
git diff --check
git diff --stat main...HEAD   # must contain exactly the 5 manifest-scope files (post-split: manifest + packet + backlog + launcher + slice-doc)
```
