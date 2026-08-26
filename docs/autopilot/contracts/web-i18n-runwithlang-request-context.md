# Contract — `web-i18n-runwithlang-request-context--v2`

**Feature:** `web-i18n-runwithlang-request-context--v2` · **risk** P1 · **base** `8e668a18904d67c6bbb713a366d67562ef6dccec`
**Invariants:** `i18n-surface`, `web-app`, `core-api`, `schema` · **Authority:** DD-118
**Supersedes:** v1, HALT SCOPE_DESIGN (owner-ratified 2026-08-26), disposition retained

## The defect, and the second defect that hid it

`runWithLang` wraps an `AsyncLocalStorage` that `t()` reads through `getLang()`. **No production web
code ever established it**, so every English branch of every `t(vi, en)` call was unreachable through
a real request. That is the original gap.

v1 fixed that and still shipped a no-op, because it read `tenants.locale` directly and **the `app`
role holds zero privileges on `tenants`**. The permission error was swallowed by a catch-all, `null`
means "fall back to vi" (DD-118), and every tenant resolved to Vietnamese anyway.

**v1 was green on lint, typecheck, format and 1191 tests while not working at all.** Nothing in that
suite ran as the identity production uses. This is the lane's most useful output and it belongs at
the top of the document rather than in a footnote.

### The measurement, which was available the whole time

```
has_table_privilege('app','tenants','SELECT')   = false
has_table_privilege('app','sessions','SELECT')  = true     <- probe is sound
grantees on tenants                             = plexco (migration owner) only
GRANT statements naming tenants, all migrations = zero
```

`0027_resolve_tenant_status_locked.sql` states it in its opening sentence — *"the `app` role holds
zero privileges on `tenants`"* — and exists because `authorization.ts` hit this identical wall. v1
read 0027 for its `SECURITY DEFINER` pattern and did not read its premise.

Root cause, named: **a capability premise was asserted instead of measured.** "Readable under
withTenant/RLS, no migration needed" was written into the brief and inherited by v1's negative scope.
A capability claim — *X is readable*, *Y is importable*, *Z exists* — is a measurement, and asserting
it in a brief does not make it one.

## Criterion 1 — the RED, as the `app` role, recorded before the migration existed

v1's reader was ported **verbatim** into this worktree so the failure is v1's actual defect rather
than a reconstruction of it:

```
FAIL  tenantLocale — read as the app role > RED UNTIL 0035: an 'en' tenant read as `app` returns 'en', not null
      AssertionError: expected null to be 'en'

FAIL  tenantLocale — read as the app role > a 'vi' tenant read as `app` returns 'vi'
      AssertionError: expected null to be 'vi'

Tests  2 failed | 2 passed (4)
```

**The two that passed are the null-expecting ones.** Run as `app` the reader returned `null` for
everything, so the "benign null" assertion passed for entirely the wrong reason. That is why two
tenants with *different* stored values are used: a reader hardcoded to `'en'` would satisfy a single
positive assertion. v1's whole test file was built from assertions that pass under total failure —
its strongest was `value === null || typeof value === "string"`, which accepts every outcome there is.

After 0035, the same file is 4/4 green against the same cluster and the same role.

## The fix — remove the privilege class by construction

`0035_tenant_locale_reader.sql`, on the 0027 pattern: one read-only `SECURITY DEFINER` function,
`SET search_path = public, pg_temp`, `REVOKE ALL FROM PUBLIC`, `EXECUTE` to `app` alone. No `UPDATE`
branch, no grant on the table itself — granting `SELECT` on `tenants` would hand `app` the whole
tenant root including the status axis 0027 deliberately kept behind a function.

The migration belongs to **this** feature rather than a follow-up: without it the feature cannot work,
and a lane that ships a known-dead path is worse than a lane that does not ship.

## Never-throws, amended (owner, 2026-08-26)

The request-time guarantee stands: a throw inside the actor-authorization choke-point is an outage.
What is amended is that it must not mean *every failure becomes null* — the property that hid v1's
defect by collapsing "you lack privilege" onto "no such tenant".

| failure | v1 | now |
|---|---|---|
| no privilege | `null`, silent | **impossible** — EXECUTE granted, proven by the app-role suite |
| non-UUID id | `null`, silent | `null`, never reaches the database, tested |
| no such tenant | `null`, silent | `null` — the ordinary path |
| anything else | `null`, silent | `null` **and logged with the underlying error** |

**`null` is "undetermined", never "this tenant does not exist".** Round-1 finding 2: the first
draft of this table said a missing tenant was *the only* way `null` is produced, in a table whose
other rows produce `null` too. Three paths reach it, and a consumer that reads `null` as
authoritative absence would be wrong. The distinction the amendment buys is not that `null` became
rare — it is that the unexpected class is now **logged** rather than silent, and the privilege
class is gone entirely.

## DD-118's seam is honoured, not merely its source

DD-118 says verbatim: *"`resolveLang` giữ chữ ký, gọi `memberLocale = null`"*. v1 called `parseLang`
directly and then wrote in this document that `resolveLang` "is not called" — contradicting the
decision the lane existed to implement, and making the contradiction durable. Now:

```ts
const tenantDefault: Lang = parseLang((await tenantLocale(appDb().db, tenantId)) ?? "") ?? "vi";
const lang: Lang = resolveLang(null, tenantDefault);
```

Output is identical today. The seam is the point: when a member-locale column lands, it has somewhere
already correct to go.

## Ordering — locale resolves ABOVE the per-tenant 429

The per-tenant limiter fires *after* membership and role are proven, so the tenant is known and
DD-118 makes language resolvable. v1 resolved ten lines lower and answered an English tenant's quota
rejection in Vietnamese. Locale now resolves first and that response is wrapped.

**Two paired tests, deliberately.** One asserts the tenant-bucket 429 is English for an English
tenant; the other asserts the **actor-bucket** 429 stays Vietnamese for the same tenant. Asserting
only the first would let a fix that localises *everything* pass, erasing the pre-tenant boundary
instead of honouring it.

**The boundary membership is pinned by test and deliberately not restated in prose anywhere.** It
was written out twice and wrong both times — v1 omitted the per-tenant 429, its fix omitted
`INVALID_BODY` — each time while claiming to be complete. Round 2 then found the same stale list
surviving in two further copies. The lesson is not "enumerate more carefully": a list maintained by
hand in N places is wrong in the N-1 nobody remembered to edit. Source comments now state the
*rule* and point at `session-command-route.test.ts`, which asserts every member and that
`tenantLocale` is un-called at each.

## KNOWN, ACCEPTED, OUT OF SCOPE — 53 stderr lines in a green web suite

The new logging fires 53 times during `@plexco/web`'s suite:

```
[tenantLocale] unexpected failure; falling back to the default language: TypeError: db.execute is not a function
```

**This is the amendment working, not a defect in it.** Three route test files stub `appDb()` as
`{ pool: {}, db: {} }`, so the real reader runs against an empty object and falls back. Under v1's
swallowing catch this was equally broken and completely invisible.

It is **not fixed here** because the fix is in `app/api/sessions/**/route.test.ts` — test files that
are **not in this registration's scope** (the scope lists `route.ts`, not `route.test.ts`). Three such
edits were made during implementation and **reverted** on noticing; scope discipline outranks
tidiness, and the sanctioned channel for an out-of-scope finding is to emit it, not to quietly widen
the diff.

Follow-up, one line each: add `tenantLocale: vi.fn(async () => null)` to the `@plexco/db` mock in
`app/api/sessions/route.test.ts`, `[id]/route.test.ts` and `[id]/publish/route.test.ts`. Left
undone, 53 stderr lines in a green suite train readers to ignore stderr — which is precisely the
habit that let v1 through.

## Criterion 4 — REPORT ONLY

**34 `t()` sites across auth and onboarding** still resolve outside any request context and remain
Vietnamese-only. That number is the input to sizing a wider lane; this lane does not pre-empt it.

### `apps/bot` has no i18n surface — MEASURED 2026-08-26

Recorded as a measured negative because the next reader's prior points the other way, as the owner's
did. `apps/bot` has **zero `t()` call sites** and **never imports `@plexco/core/i18n`**. Not "out of
scope" — nothing to fix. Re-measure rather than trust this line if the tree has moved.
