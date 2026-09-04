import { parseLang, resolveLang, type Lang } from "@plexco/core/i18n";
import { type Db, tenantLocale } from "@plexco/db";

/**
 * THE single derivation of a request's language (DD-118).
 *
 * DD-118 pins `tenants.locale` as the ONLY language source for an authenticated surface, read
 * through `tenant_locale()` (migration 0035) and fail-closed to `vi`. This module exists so that
 * rule has exactly one implementation.
 *
 * READ THIS BEFORE REACHING FOR DD-118's SECOND-SOURCE PROHIBITION. A new file that reads a locale
 * looks, in a cold diff, exactly like the thing DD-118 forbids. It is the opposite. The counts,
 * measured at the pinned base rather than asserted:
 *
 *   at base bff52b7:     1 production caller of the derivation (session-command-route.ts). Verify:
 *                        git grep -c 'tenantLocale(' bff52b7 -- 'apps/web/**' | grep -v test
 *   without extraction:  2 — wiring the readiness surface meant pasting the same two lines again
 *   with extraction:     1 derivation, called by both consumers
 *   language sources, in every one of those three states: 1 — `tenants.locale`
 *
 * So the second copy is a COUNTERFACTUAL this change avoids, not a mess it cleaned up. (An earlier
 * revision of this comment claimed two copies already existed. That was wrong at the base and is
 * corrected here; the reviewer caught it.) DD-118 bans a second *source*, and the source count is
 * one throughout. Two copies of a derived value drift — one could gain a member-locale argument
 * and the other not, and nothing would fail. One function, every consumer.
 *
 * WHY A FUNCTION AND NOT TWO LINES AT EACH CALL SITE. The check ("did this request resolve its
 * language through the DD-118 seam?") and the action ("render this string with `t()`") are only
 * meaningfully coupled when both read one derivation. Two independent copies collude: each is
 * self-consistent, so each looks correct in review while together they answer the same tenant in
 * two languages.
 *
 * THREAT MODEL
 *
 *   Protects against: answering an authenticated caller in a language their tenant did not
 *   configure — including the subtler direction, answering in a language a caller has NOT yet
 *   earned. Language is observable output, so WHERE it is resolved is a disclosure boundary, not
 *   formatting. A response emitted before the caller is proven AUTHORIZED FOR THE ROUTED TENANT
 *   must NOT be rendered in that tenant's language: doing so turns any error reply into an oracle
 *   that leaks (i) whether an arbitrary tenant id exists and (ii) what locale a stranger's club is
 *   set to, to an unauthenticated or merely-authenticated-but-unauthorized caller. Callers
 *   therefore invoke this function only AFTER that authorization succeeds, and every response
 *   above that point stays Vietnamese — which DD-118 ratifies as correct behaviour, not a gap.
 *
 *   "Authorized for the routed tenant" is deliberately NOT "owns the tenant" (codex round-02 [P3]:
 *   an earlier revision said "owns" and contradicted a live caller). The predicate is per-surface
 *   and belongs to the caller, not here: `onboarding/readiness` requires the OWNER role because its
 *   API contract is TenantOwner-only, while `session-command-route` admits the wider DD-56 set
 *   (`owner`, `admin`, `co_admin`) because those endpoints are TenantAdmin. What this contract
 *   requires is only that SOME sufficient tenant-authorization check has already passed — not which
 *   one. Restating a specific role here would duplicate a rule this module does not own and would
 *   drift from it, which is exactly what DD-56 bans.
 *
 *   Does NOT protect against: a caller choosing their own language (there is no per-user override
 *   in phase-1 and `Accept-Language` is deliberately not read — DD-118); a tenant whose stored
 *   locale is itself wrong; a consumer that resolves correctly and then renders outside the
 *   returned context. It also does not make `t()` calls safe by existing — a string emitted
 *   outside `runWithLang` still renders Vietnamese, and only a test can catch that.
 *
 *   Rewrite this model when: a member-level locale column lands (DD-118 names this follow-up and
 *   explicitly does NOT pre-authorize it — `memberLocale` stops being `null` and the "who is
 *   proven" question gains a second subject), or a surface needs language BEFORE ownership is
 *   proven, which would make the disclosure boundary above load-bearing in a way it is not today.
 *
 * FAIL-CLOSED. Every undetermined case resolves to `vi`. `tenantLocale` returns null for several
 * distinct reasons — no such tenant, a non-UUID id, or an unexpected failure it logs — and its own
 * contract says null means "undetermined", never "no such tenant". `parseLang` then rejects any
 * stored value outside the vi/en vocabulary. Both funnel to the same default, which is what
 * DD-118 requires.
 *
 * `resolveLang(null, …)` is called rather than using `parseLang`'s output directly. Today the two
 * are identical; keeping the seam means the member-locale column has one correct place to land.
 */
export async function resolveTenantLang(db: Db, tenantId: string): Promise<Lang> {
  const tenantDefault: Lang = parseLang((await tenantLocale(db, tenantId)) ?? "") ?? "vi";
  return resolveLang(null, tenantDefault);
}
