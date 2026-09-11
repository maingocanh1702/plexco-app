---
slug: session-management-m01-timezone-validation-canonical-iana
class: feature-session-p2
risk: P2
scope:
  - packages/db/src/session-service.ts
  - packages/db/src/session-service.test.ts
verify: pnpm --filter @plexco/db run typecheck
verify_host: pnpm --filter @plexco/db exec vitest run src/session-service.test.ts
budget_usd: 6
max_review_rounds: 3
feature: session-management
milestone: true
milestone_id: M1
---
## Problem
SessionCommandError code INVALID_TIMEZONE already exists and is enforced on both CreateSession and UpdateSession via a shared isValidTimezone() helper in packages/db/src/session-service.ts:96-103 (used at :169-171 for create, :1206-1209 for update). It currently validates by constructing `Intl.DateTimeFormat('en-US', { timeZone: tz })` inside a try/catch, which ICU also resolves through legacy zone aliases (e.g. 'US/Eastern', 'Asia/Calcutta') -- accepting strings that are not canonical IANA zone identifiers. The owner's ratified decision for SES-OQ-10 (docs/features/FE/feature_session_management.md:902, decisions applied 2026-09-11) requires rejecting any timezone not literally present in `Intl.supportedValuesOf('timeZone')`, error code INVALID_TIMEZONE (400). BE spec test row #92 (docs/features/BE/feature_session_management_tech.md:923) targets exactly this and does not yet exist in packages/db/src/session-service.test.ts.
## Acceptance
isValidTimezone() in session-service.ts is rewritten to check membership in a `Set` built once (module scope, not per-call) from `Intl.supportedValuesOf('timeZone')`, instead of the DateTimeFormat try/catch. Both createSession and updateSession keep rejecting with SessionCommandError code INVALID_TIMEZONE for any non-canonical string. packages/db/src/session-service.test.ts gets: (1) a createSession case asserting a legacy alias (e.g. 'US/Eastern') is now rejected -- proving the tightening actually changed behavior, not re-testing an already-passing garbage-string case; (2) an updateSession case asserting the same INVALID_TIMEZONE rejection on a fresh commandId (the existing 'Not/AZone' string near the DED2 test is a dedup-precedence decoy, not a standalone timezone assertion -- add a real one). Every existing timezone-related test still passes -- a well-formed IANA zone like 'Asia/Ho_Chi_Minh' must still be accepted.
## Context
This is the smallest, best-understood gap surfaced by the session-management ap3-intake round (ap3/features/session-management/INTAKE.md). It is also the FIRST slice ever dispatched under the feature-session-p2 class (ap3/routines.json, clean_runs: 0) -- keep the diff exactly scoped to isValidTimezone() and its two call sites. Do not touch any other validation rule in this file, do not add a migration, do not touch any route file. Negative scope: do not implement recurrence editing (SES-OQ-2/DD-121, BE test row #91) -- that command family (GenerateOccurrences / recurrence-rule editing) has zero implementation anywhere in the codebase and is out of scope for this slice and this entire plan round (see ap3/features/session-management/PLAN.md, Deferred item D3).
