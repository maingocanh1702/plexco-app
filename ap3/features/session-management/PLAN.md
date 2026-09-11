---
feature: session-management
intake: ap3/features/session-management/INTAKE.md (status: READY_WITH_SUPERVISED_SLICES, measured_at: 2026-09-11T09:42:12Z)
base_sha: 41ae56e74d48ba3639dc46e4fbb2f7fac5d46461
planned_at: 2026-09-11
---

## Emission status (this PR)

`ap3/queue/session-management-m01-timezone-validation-canonical-iana.md` and
`ap3/queue/session-management-m02-read-routes-admin-scoped.md` are queued by this PR — both are
unblocked today and lint clean. Milestone 3 (both the schema-migration slice and its
guest-note-commands sibling) and milestone 4 (auto-expiry job) are **not** emitted yet:
`session-management-m03-guest-note-commands` is mechanically blocked by `plan-emit` until the
schema migration (3a) is merged and its `plan.json` entry is marked `landed: true` +
`landed_sha`. Re-running `python3 ap3/aplib.py plan-emit` with the full slice list (including 3a's
confirmed `landed_sha`) once the owner has merged the migration will queue 3b in one shot;
milestone 4 has no such gate and can be emitted whenever the owner is ready to plan it in detail
(it only has a supervised entry today — see Deferred item, milestone 4 below).

## What already exists (not re-planned)

`packages/db/src/session-service.ts` ships 6 commands — `createSession`, `publishSession`,
`announceSession`, `updateSession`, `closeSession`, `cancelSession` — plus their 5 routes under
`apps/web/app/api/sessions/**`. `packages/db/src/session-service.test.ts` (3715 lines, 127 tests)
covers rows #1-61 and #84-90 of the BE spec's test plan almost completely (verified by a dedicated
test-mapping pass); the only confirmed gap inside already-shipped commands is BE test row #84
(capacity-decrease-with-charges positive case, edge 4b/DD-112) — pre-existing, predates this
intake round, not part of it, not planned here.

Everything below is either a genuine gap this intake round surfaced, or an explicit deferral with
a reason. Milestones are ordered M1→M4 in `plan.json`'s slice list; that list order is also the
literal dispatch order the `after:` chain will enforce.

## Milestone 1 — timezone validation tightened to canonical IANA (`feature-session-p2`, P2, dispatchable)

Slug: `session-management-m01-timezone-validation-canonical-iana`

Closes SES-OQ-10 (`docs/features/FE/feature_session_management.md:902`) / BE test row #92
(`docs/features/BE/feature_session_management_tech.md:923`). `isValidTimezone()`
(`packages/db/src/session-service.ts:96-103`) already exists and is already wired into both
`createSession` (:169-171) and `updateSession` (:1206-1209) with the `INVALID_TIMEZONE` error
code — but it validates via `Intl.DateTimeFormat(...)` try/catch, which resolves legacy zone
aliases (e.g. `US/Eastern`, `Asia/Calcutta`). The owner's ratified answer requires membership in
`Intl.supportedValuesOf('timeZone')` specifically (canonical names only, stricter). This is the
**first slice ever dispatched under `feature-session-p2`** (`ap3/routines.json`, `clean_runs: 0`)
— deliberately the smallest, best-understood change in this plan, to prove the class out before
trusting it with anything bigger.

Scope: `packages/db/src/session-service.ts`, `packages/db/src/session-service.test.ts`.

## Milestone 2 — admin-scoped session read routes (`feature-session-p2`, P2, dispatchable)

Slug: `session-management-m02-read-routes-admin-scoped`

Closes the BE spec header's own "chưa có: route đọc (`GET /api/sessions`, `/[id]`)" gap
(`docs/features/BE/feature_session_management_tech.md:6`). Confirmed on live main: no file under
`apps/web/app/api/sessions/**` exports `GET` anywhere. This slice adds `GET /api/sessions` (list)
and `GET /api/sessions/:id` (detail) for **TenantAdmin-capable callers only**, reusing the existing
auth/tenant-resolution choke-point in `apps/web/lib/session-command-route.ts` (the file's own
comment states the DD-56 design intent: one choke-point, not scattered `role === ...` checks).

**Negative scope, explicit:** this slice does NOT add the Player-facing branch of
`GET /api/sessions/:id` (Host sees full roster/payment; Player sees a redacted,
venue-visibility-gated view per FE spec E#6 and BE edge #8/#19's public-serializer-whitelist
precedent). That is new, security-sensitive response-shaping logic with **zero existing precedent**
in this codebase (verified: every route today gates on exactly one TenantAdmin-capable role; there
is no Player-facing session route to branch from). It is intentionally left as a future
human-supervised increment — see "Deferred" below, item D5.

Scope: `apps/web/app/api/sessions/route.ts`, `apps/web/app/api/sessions/[id]/route.ts`,
`apps/web/app/api/sessions/route.test.ts`, `apps/web/app/api/sessions/[id]/route.test.ts`,
`apps/web/lib/session-command-route.ts`.

## Milestone 3 — guest notes (schema + commands)

Two slices, in order. The second is **blocked** until the first is confirmed merged.

### 3a. Schema migration (supervised — schema migration, always human/Level-3 run)

Slug: `session-management-m03-guest-note-schema-migration`

Exact scope per `ap3/features/session-management/INTAKE.md` R3.2/R6.1, owner answer 4
(2026-09-11): `sessions.allow_player_invite boolean NOT NULL DEFAULT true`,
`players.invited_by_person_id uuid REFERENCES persons(id)` + `idx_players_invited_by`, and the
full `session_guest_notes` table (`id`/`tenant_id`/`session_id`/`created_by_person_id`/
`guest_name`/`note`/`created_at`, 2 CHECK constraints, trigger `trg_session_guest_note_limit`) +
`idx_session_guest_notes_session`. DDL is fully specified at
`docs/features/BE/feature_session_management_tech.md:144-177`. Confirmed absent from
`packages/db/schema.ts` and every migration through the current tail (`0043`) on live main.

**Must land and be marked `landed: true` + `landed_sha` in `plan.json` before 3b can be emitted** —
`plan-emit` enforces this mechanically (an unlanded supervised slice blocks every dispatchable
slice after it in the list).

### 3b. Guest note commands (`feature-session-p2`, P2, dispatchable — blocked on 3a landing)

Slug: `session-management-m03-guest-note-commands`

Builds `CreateGuestNote`, `DeleteGuestNote` and the guest-notes list read
(`docs/features/BE/feature_session_management_tech.md:702-716`, algorithm) once 3a's schema is
live. Covers BE unit rows #78, #79, #81 (all confirmed MISSING — zero guest-note code exists
anywhere today) with real regression tests.

**Explicit negative scope — do not build in 3b:** `InviteFriend`, `ApproveInvite`, `RejectInvite`,
or anything on the "friend already follows" path (SES-UC-16, BE edges #36-38/#41-42). See
"Deferred" item D1 below — that whole command family is blocked on cross-feature tables this
plan round cannot unblock. Also do not build any part of waitlist auto-promotion — see D2; the
"trigger waitlist auto-promote" step in `DeleteGuestNote`'s own spec (§4, step 4) must be
implemented as a single clearly-commented no-op (no player can be `waitlisted` today, since no
join/leave/waitlist-entry code exists at all — the branch is unreachable in practice, not absent
by oversight).

Scope: `packages/db/src/session-service.ts`, `packages/db/src/session-service.test.ts`,
`apps/web/app/api/sessions/[id]/guest-notes/route.ts`,
`apps/web/app/api/sessions/[id]/guest-notes/[noteId]/route.ts`, and their `.test.ts` siblings.

## Milestone 4 — draft auto-expiry job (supervised — migration + new job infra)

Slug: `session-management-m04-draft-auto-expiry-job`

Closes SES-UC-14 (system auto-expiry of unpublished drafts past `starts_at`). Needs: (a) a new
partial index `idx_sessions_draft_starts_at` (BE spec §2, line 186/198) for the job's claim query;
(b) new privileged job infrastructure — **this repo has no working scheduled/cross-tenant job to
copy from today.** The only registered pg-boss queue (`outbox_dispatch`,
`apps/bot/src/queues.ts:19,39`) is itself disabled behind `OUTBOX_DISPATCH_SCHEDULE_ENABLED` with a
stub deliverer (`apps/bot/src/worker.ts:85,91`); the BE spec's own cited precedent — billing's
"Daily Lifecycle Job" — is also unimplemented (spec/test-description only, zero code). This would
be the first real instance of this pattern in the codebase, which is exactly the kind of
first-of-its-kind infra decision that belongs to a human/Level-3 session, not headless P2 dispatch.

A backlog row already tracks this gap: `docs/autopilot-backlog.md:1569` (task
`job-consumers-per-feature`, `status: idea`, explicitly lists "session draft auto-expiry"). The
owner should reconcile this milestone with that row rather than scoping the work twice.

No `plan.json` `landed`/`landed_sha` gating needed — nothing in this plan is sequenced after M4.

---

## Deferred — not planned this round, with reasons

**D1. InviteFriend / ApproveInvite / RejectInvite (SES-UC-16/18) — blocked on cross-feature
tables outside this feature's own migration, discovered during this planning pass, not previously
flagged by the intake's R6.1 gap-closure:**

- `person_follows` (DD-47, follow-guard for the invite path) does not exist in `schema.ts` or any
  migration. `decisions.md:642,68` marks DD-47 "✅ Chốt **framework**" but explicitly scheduled
  **P4+** — a later phase than this feature's own P2/P4 header claims for SES-UC-16.
- `person_blocks` (DD-55, block-boundary override) does not exist either — only an unrelated
  `chat_blocks` table (schema.ts:826) does. `decisions.md:76` scopes DD-55 to "P4 chat slice"
  specifically, not general availability.
- `players.status` does not have a `pending` value live today (needed for `join_policy='approval'`
  invites): `packages/db/migrations/0014_players_waitlist.sql:78-81` pins the live
  `players_status_chk` to exactly `('active','left','waitlisted')`. One doc comment
  (`feature_session_management_tech.md:174`) implies `pending` was already added to the enum —
  that comment is inaccurate against the live constraint.

None of these three gaps are in `session-management-m03-guest-note-schema-migration`'s scope
(R6.1 only covers `allow_player_invite` / `invited_by_person_id` / `session_guest_notes`).
**Recommendation:** this needs its own owner/intake pass — either move SES-UC-16/18 to whatever
phase DD-47/DD-55 actually land in, or explicitly fast-track `person_follows`/`person_blocks`/
`pending` as their own prerequisite slice before re-attempting to plan invite-friend.

**D2. Waitlist promotion/retry engine (DD-45, the SES-UC-9 promotion half) — confirmed still fully
blocked, not just documented as blocked.** Verified zero real implementation anywhere for
`deriveChargeAmount` (DD-39), `evaluateSessionEligibility` (DD-41), `evaluateJoinRestriction`
(DD-52), `channel_booking_intents` (DD-32), or `promotion_retry_jobs` — every DD governing this
is itself ✅ ratified, so this is a pure build-gap, not a pending decision, but it is a build-gap
spanning 5 decisions and 4+ owning features. Far too large for this plan round; BE spec's own
rollout step 4 already calls this "blocked." Not sliced here.

**D3. Recurrence generation (SES-UC-2) + this-and-future edit (DD-121, BE test row #91) —
foundational gap, no existing code to extend.** `session_recurrence_rules` / `session_occurrences`
tables exist (migrated long ago) but have **zero** producing/consuming code — no
`GenerateOccurrences`, no rule-creation path, nothing. DD-121's "this-and-future edit" cannot be
built before the base recurrence-generation mechanism exists, and that base mechanism (rule
creation + DST-aware occurrence generation + idempotency) is itself multiple concerns bundled —
not a small P2 slice. Needs its own dedicated planning round.

**D4. Auto-close job (SES-UC-10 automated, BE edges #50-52 / FE edges #42-44) — cannot be scoped
at all yet, not even as a supervised slice.** The grace-period duration after `ends_at` is an open
parameter the owner has not decided (BE spec's own text: "Thời lượng grace period sau `ends_at`
chưa chốt"). **This needs an owner decision before it can be planned** — recommend routing it
through a small `/ap3-intake` amendment or a direct `decisions.md` entry, not guessing a number
here.

**D5. `GET /api/sessions/:id` Player-scoped view — deferred from M2, see M2's negative scope
above.** New role-scoped serialization/redaction logic with a real PII/venue-leak risk profile
(BE edge #8/#19); needs a human-supervised slice once M2 lands.

**D6. Messenger host-parity / wizard-lifecycle test coverage (BE test rows #35-37, integration
row #7) — unresolved, flagged for the owner, not verified either way.** The test-mapping pass did
not find matching tests in `session-service.test.ts` or a shallow keyword search of
`apps/bot/src/{schedule,dispatcher,preflight}.test.ts`, but did not read those three files in full
either. Before treating this as a real gap, someone should do a closer pass on `apps/bot/src`.

**D7 (minor, informational).** BE test row #84 (capacity-decrease-with-existing-charges positive
case, edge 4b/DD-112) has no regression test in `session-service.test.ts` despite the spec's own
changelog claiming it was added (v2.25, 2026-08-27). This predates the current intake round and
is not one of its 9 answers — not planned here, but worth a small standalone test-backfill slice
later (likely zero production-code change, since the behavior it pins already has no known bug —
`updateSession`'s only capacity test today, `U3`, covers the *negative* 4a case, not 4b's positive
one).

---

## Unresolved questions for the owner

1. D1 above: should SES-UC-16 (invite friend via follow) / SES-UC-18 (approve/reject) move to
   whatever phase DD-47/DD-55 actually land in, or should `person_follows`/`person_blocks`/
   `pending`-status be fast-tracked as a prerequisite slice? This also calls into question whether
   the feature's own header ("Canonical phase: P2/P4") should annotate SES-UC-16/17/18 the same
   way it already annotates SES-UC-8's marketplace-discovery dependency (deferred-with-named-
   prerequisites) — right now it doesn't, and a future reader could reasonably plan InviteFriend
   without hitting this until mid-implementation.
2. D4: what is the auto-close grace period? Needs a number (or an explicit "no grace, `ends_at`
   itself is the cutoff") before that milestone can be scoped at all.
3. D6: is Messenger host-parity/wizard-lifecycle test coverage (#35-37, integration #7) actually
   missing, or does it live somewhere the shallow search missed? Worth a dedicated look before the
   next planning round touches Messenger-side session behavior.
