# Contract — `web-tsconfig-test-typecheck-blindspot`

**Feature:** `web-tsconfig-test-typecheck-blindspot` · **risk** P1 · **base** `e9436639451dcd84cc21d45b71c032e47344175d`
**Invariants:** `build-config`, `web-app`

## The defect

`apps/web/tsconfig.json` had `include: ["next-env.d.ts", "app", ".next/types/**/*.ts"]`.

`app` **is** included, so `app/**/route.test.ts` were always compiled — an earlier `TS2345` there was
caught normally. The blindspot is narrower and specific: **`lib` was absent from `include`**, and
`lib/*.test.ts` is imported by nothing, so TypeScript never loaded those seven files into the program.

Consequence: `pnpm -r run typecheck` reported **green on files it never looked at**. Every gate that ran
while this was true is weaker than its own result claims.

## Acceptance criterion 1 — make the errors visible BEFORE fixing

Baseline, before any change: `pnpm --filter @plexco/web run typecheck` → green (this is the blindspot,
not health).

After adding `"lib"` to `include`, plain `pnpm -r run typecheck` — **11 errors, verbatim**:

```
apps/web typecheck: lib/session-cookies.test.ts(71,17):  error TS2540: Cannot assign to 'NODE_ENV' because it is a read-only property.
apps/web typecheck: lib/session-cookies.test.ts(75,17):  error TS2540: Cannot assign to 'NODE_ENV' because it is a read-only property.
apps/web typecheck: lib/session-cookies.test.ts(82,17):  error TS2540: Cannot assign to 'NODE_ENV' because it is a read-only property.
apps/web typecheck: lib/session-cookies.test.ts(89,17):  error TS2540: Cannot assign to 'NODE_ENV' because it is a read-only property.
apps/web typecheck: lib/session-cookies.test.ts(96,17):  error TS2540: Cannot assign to 'NODE_ENV' because it is a read-only property.
apps/web typecheck: lib/session-cookies.test.ts(108,17): error TS2540: Cannot assign to 'NODE_ENV' because it is a read-only property.
apps/web typecheck: lib/session-cookies.test.ts(155,17): error TS2540: Cannot assign to 'NODE_ENV' because it is a read-only property.
apps/web typecheck: lib/session-cookies.test.ts(162,17): error TS2540: Cannot assign to 'NODE_ENV' because it is a read-only property.
apps/web typecheck: lib/session-cookies.test.ts(169,17): error TS2540: Cannot assign to 'NODE_ENV' because it is a read-only property.
apps/web typecheck: lib/session-cookies.test.ts(176,17): error TS2540: Cannot assign to 'NODE_ENV' because it is a read-only property.
apps/web typecheck: lib/session-cookies.test.ts(313,22): error TS18048: 'csp' is possibly 'undefined'.
```

All 11 are in one file. The other six `lib/*.test.ts` compile clean.

### The two TS2339s named in the original brief are GONE

They were fixed in `session-api-routes--lint-guard` (merged `770ff4b`) — the `envelope()` error shape
gained `message`. That is the "already fixed by something else" branch the brief said to stop and report
on. Reported; the criterion then continued because the widened include was **not** green.

## Security-review void condition — FIRED, and DISCHARGED

The manifest carries `security_review.required: false` with an explicit void condition: *add a security
round if widening the include surfaces an error in a file that touches auth or secrets, naming
`lib/auth-secrets.test.ts` and `lib/session-cookies.test.ts`.* All 11 errors are in
`session-cookies.test.ts`, so **the condition fired**.

It is discharged, and the reasoning matters more than the conclusion:

The condition fired on **file identity**. File identity was a *proxy* for the thing that actually matters —
a security defect in a security-adjacent file. That proxy exists because normally you cannot know whether a
defect is security-relevant without looking properly. Here the file was inspected and the direct measurement
the proxy stands in for is available:

- **The 10 `TS2540`s** are assignments to `process.env.NODE_ENV` in test setup/teardown
  (`process.env.NODE_ENV = "production"` and the `afterEach` restore). They are test-harness typing, not
  behaviour, and not a property of the code under test.
- **The single `TS18048`** is at `lib/session-cookies.test.ts:313`, and is **proven non-vacuous**:

  ```ts
  const csp = headers["content-security-policy"];
  expect(csp).toContain("default-src 'none'");                     // runs FIRST
  const cspNonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];   // TS18048 reported here
  expect(cspNonce).toBeTruthy();
  ```

  If the CSP header were ever absent, `expect(csp).toContain(...)` executes before the flagged line and
  throws on `undefined` — the test fails loudly there. Even past that, the optional-chained extraction
  yields `undefined` and `expect(cspNonce).toBeTruthy()` fails. There is no path on which a missing CSP
  header produces a passing test. The `?.` is a typing convenience, not a swallowed assertion.

Discharging a proxy **when you hold the direct measurement it substitutes for** is correct. Discharging it
because honouring it is inconvenient is not. Recorded so a later reader can re-derive the discharge rather
than trust it.

Auditability constraints accepted with the discharge (owner, 2026-08-26):

1. **HARD NEGATIVE SCOPE — no production code changes.** Not one line outside `tsconfig.json` and test
   files. If any fix requires touching non-test code: **HALT and report** — that changes the security
   calculus and the round returns on its own merits.
2. **No cast, no `as any`, no `@ts-expect-error`, no type widening to silence `TS2540`.** Use the idiomatic
   env-stubbing path. If a clean fix is unavailable, that is a **FINDING to report**, not a fix to apply.
3. All 11 enumerated verbatim above, plus the non-vacuity proof for line 313 in the lane's own words.

## Scope note — measured, not guessed

All seven `lib/*.test.ts` were declared at registration because scope is a **ceiling** and the
implicated set could not be known until the project-mode run. Six will be untouched. `session-cookies.test.ts`
being in scope is what makes the discharge available rather than forcing a re-registration.

## A measurement that was locally true and globally wrong

Before registering, each `lib/*.test.ts` was probed with a standalone `tsc` invocation using approximated
flags. It reported **0 errors for `session-cookies.test.ts`** — the file that in fact holds all 11.

A standalone invocation is **not the project program**. Next's types are what make `process.env.NODE_ENV`
read-only, and they are only in scope inside the real program. Acting on that probe would have under-scoped
this lane. **Scope measurement runs in project mode or it does not count.**

This is the same failure shape as the `decisions.md` anchor defect in the preceding lane, where a *unique*
anchor said nothing about the lines that followed it. Both are **locally-true measurements**: correct about
the thing examined, wrong about the context it lives in.

## Criterion 2 — how the 11 were fixed (no suppressions)

**The 10 `TS2540`s.** Replaced `process.env.NODE_ENV = "..."` with `vi.stubEnv("NODE_ENV", "...")`,
and the hand-rolled `const ORIGINAL_... ` / `afterEach` restore with `vi.unstubAllEnvs()`. `vi` was
already imported. This is vitest's own path for exactly this problem, so it is a fix rather than a
silencing: no cast, no `as any`, no `@ts-expect-error`, no widening.

It also removes a latent defect rather than only a type error. The manual form has to get
"originally absent" right by hand; `vi.unstubAllEnvs()` restores an absent variable by deleting it.
The identical hand-written pattern is what silently re-zoned a sibling suite in the preceding lane by
storing the STRING `"undefined"`. The same shape was present here in the `TRUSTED_INGRESS_PROVIDER`
teardown, which spelled the branch out by hand; it is now vitest's responsibility.

**The single `TS18048`.** Added a narrowing guard, not a suppression:

```ts
if (typeof csp !== "string") throw new Error("content-security-policy header is missing");
```

A missing CSP header is now a NAMED failure at the point of the check, instead of an incidental throw
inside the first `toContain`. That strengthens the test and narrows the type for the `.match()` below
without a cast or a non-null assertion.

Verified: `grep -cE "as any|@ts-expect-error|@ts-ignore|as unknown as"` on the file returns **0**.

## Criterion 3 — verification

- `pnpm -r run typecheck`: all four packages **Done** (`packages/core`, `packages/db`, `apps/bot`,
  `apps/web`) with `lib` now compiled.
- apps/web tests: **320 passed**, unchanged — behaviour is not affected by the fixes.
- Full canonical suite: **exit 0** — core 153, db 669, web 320, bot 40, kit review-readiness 53.
- `pnpm run lint`, `pnpm run format:check`: clean.
- Constraint 1 held: `git status` shows exactly `apps/web/tsconfig.json`,
  `apps/web/lib/session-cookies.test.ts` and this contract doc. **No production code changed.**

## Criterion 4 — do other packages share the shape? REPORT ONLY, nothing fixed

Measured, not inferred — where each package's test files live versus what its `include` lists:

| package | `include` | test files live under | gap |
|---|---|---|---|
| `packages/core` | `["src"]` | `src` | no |
| `packages/db` | `["schema.ts","drizzle.config.ts","src"]` | `src` | no |
| `apps/bot` | `["src"]` | `src` | no |
| `apps/web` | `["next-env.d.ts","app",".next/types/**/*.ts"]` (before) | `app` (12), **`lib` (7)** | **YES** |

`apps/web` was the only one, and the reason generalises: it is the only package whose sources span
**two** top-level directories while `include` enumerated just one. The others keep everything under a
single `src`, so an omission of this kind cannot arise there today.

**Follow-up worth considering, not done here:** a package that later grows a second source directory
re-opens this silently. A structural check — every `*.test.ts` is inside some `include` entry — would
catch it repo-wide. That belongs in the kit lane, not this one.
