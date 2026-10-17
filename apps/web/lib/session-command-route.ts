import { isApiErrorCode, type ApiErrorCode, type ApiErrorDetails } from "@plexco/core";
import { runWithLang, t, type Lang } from "@plexco/core/i18n";
import {
  RosterMoneyError,
  SessionCancelAuthorizationError,
  SessionCancelError,
  SessionCloseAuthorizationError,
  SessionCloseError,
  SessionCommandError,
  SessionPublishAuthorizationError,
  SessionPublishError,
  SessionUpdateAuthorizationError,
  SessionUpdateError,
  authorize,
  guestNoteTenantForPerson,
  hasLiveMembership,
  withTenant,
} from "@plexco/db";
import { err } from "./api-envelope";
import { readBoundedBody } from "./read-bounded-body";
import { appDb, csrfOk, currentSession, rateLimited } from "./session-cookies";
import { resolveTenantLang } from "./tenant-lang";

/**
 * Shared entry gate + error mapper for host commands and explicitly opted-in guest-note routes.
 * Announce is NOT among them — its only observable effect is delivery and
 * nothing can deliver yet, so it returns with the slice that provides a real projector (DD-56
 * amendment, clause 1).
 *
 * ONE choke-point on purpose: DD-56 bans adapters from scattering `role === ...` across routes.
 * The actor gate is the capability primitive `authorize()` (tenant-capability-authority-core,
 * migration 0049) for action `session.manage`; this file holds no role list and decides on no role.
 *
 * The commands own their own `withTenant` transaction, so a route calls them directly and
 * must NOT wrap them again. The gate below runs in its OWN short transaction before the command.
 *
 * ── THREAT MODEL ────────────────────────────────────────────────────────────────────────────
 *
 * WHAT THIS GATE DEFENDS AGAINST. An AUTHENTICATED caller acting outside their authority, and a
 * client being told the wrong thing about a mutation. Concretely: a signed-in account driving a
 * host command without a current `session.manage` capability in that tenant (owner, admin and
 * co_admin hold it in the default preset; a person with no ACTIVE web tenant_admins row, or only
 * a row in another tenant, does not), or a guest-note command without proven association (both
 * answer with one indistinguishable 403, never a 404, so this is not a tenant-existence oracle);
 * a cross-tenant denial of service by spending a victim tenant's rate-limit bucket before proving
 * authority (closed by ordering the actor ceiling and `authorize()` ahead of the per-tenant
 * bucket); a forged cross-origin write (CSRF token); an oversized or chunked body held open to
 * exhaust the process; and -- the reason this file is P1 -- an idempotency key that reaches
 * `processed_commands` as a DIFFERENT key than it arrived as, which would hand one caller another
 * caller's stored result. That last one is why `isUnsafeCommandKey` and the FATAL TextDecoder
 * exist, and why both fail closed. `authorize()` is fail-closed: an unknown action, a tenant
 * context mismatch or any denial yields 403; an infrastructure error is NOT mapped to 403 or to
 * allow, it propagates as a 5xx.
 *
 * WHAT IT EXPLICITLY DOES NOT DEFEND AGAINST. The decision here is made in a SEPARATE, already
 * committed transaction BEFORE the command opens its own. A role deactivation that commits in
 * between is not seen by the command: the in-command actor re-check under the command's own row
 * locks (the `actor-recheck-under-lock` invariant) is NOT implemented here -- it is the
 * backlog slice `session-commands-actor-recheck-under-lock`, which changes the commands'
 * signatures. Until then the window is one request long. Every domain rule -- status transitions,
 * version races, roster and money guards --
 * belongs to the command, under its own row locks. It does not defend against a compromised
 * session cookie, nor against a malicious tenant admin acting WITHIN their own tenant (that is
 * what the commands' fail-closed money guards and the outbox audit trail are for), nor against
 * anything below the transport: TLS, cookie flags and origin policy are owned elsewhere.
 *
 * WHEN THIS MODEL MUST BE REWRITTEN. If a session command becomes reachable by any principal that
 * is not a signed-in tenant member -- a bot transport, a webhook, a public link, a service token --
 * every sentence above is void, because all of it assumes `currentSession()` identified a person
 * and `authorize()` bounded it. Also void if a command starts MOVING money rather than
 * refusing when money is present: the guards behind `CANCEL_REQUIRES_REVIEW` and
 * `CLOSE_BLOCKED_OPEN_DEBT` are refusals, not settlement, and a settlement path needs its own model.
 *
 * `CLOSE_BLOCKED_OPEN_DEBT` is the one response carrying roster data (`error.details`: the players
 * who still owe, ids + display names only — DD-131 OD-1). It is reachable only through the gate
 * above (an authorized `session.manage` holder, who can already read that roster) and after the
 * command's own billing, status and version checks; the mapper re-projects it to those two keys.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pre-authorization ceiling, keyed on the ACTOR rather than the tenant. It bounds how fast an
 * authenticated caller can drive authorize() reads without ever touching a tenant's own quota.
 * It is looser than the per-tenant WRITE limits (spec §3 pins 10–20/min) so a legitimate admin
 * meets those first. It is NOT looser than the shared 60/min read bucket: an admin issuing only
 * reads can reach either 60/min ceiling first, and that is acceptable (both answer 429).
 */
const ACTOR_LIMIT = { limit: 60, windowSeconds: 60 };

/** The ONE vi/en pair for SESSION_NOT_FOUND, shared by command and read routes. */
export const SESSION_NOT_FOUND_MESSAGE = ["Không tìm thấy kèo.", "Session not found."] as const;

/** The capability every session command and session read requires (default preset, DD-56). */
const SESSION_ACTION = "session.manage";

/**
 * Canonical (lowercase) `?tenant=<uuid>`, or null when absent/malformed. Canonicalized ONCE
 * because PostgreSQL renders uuid lowercase while the regex is case-insensitive: using the raw
 * value would split the rate-limit bucket and the routing context by letter case (codex
 * round-02 [P2]).
 */
export function readTenantParam(request: Request): string | null {
  const raw = new URL(request.url).searchParams.get("tenant") ?? "";
  return UUID_RE.test(raw) ? raw.toLowerCase() : null;
}

/** True when the ACTOR has exhausted the pre-authorization ceiling (never spends a tenant bucket). */
export function actorThrottled(accountId: string): Promise<boolean> {
  return rateLimited(`session-actor:${accountId}`, ACTOR_LIMIT.limit, ACTOR_LIMIT.windowSeconds);
}

/**
 * One short `withTenant` transaction answering "does this person hold session.manage in this
 * tenant right now". Denial -> false; an infrastructure error propagates (never allow, never a
 * fake 403).
 */
export async function mayManageSessions(tenantId: string, personId: string): Promise<boolean> {
  const decision = await withTenant(appDb().db, tenantId, (tx) =>
    authorize(tx, { tenantId, action: SESSION_ACTION, actorPersonId: personId }),
  );
  return decision.allowed;
}

/** A per-PERSON quota (L8 P-13), keyed `<bucket>:<personId>` with the person from the cookie. */
export interface PersonLimit {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

/** Self-join and join requests share ONE bucket; L10b's join-by-slug route spends the same one. */
export const SESSION_JOIN_PERSON_LIMIT: Readonly<PersonLimit> = {
  bucket: "session-join",
  limit: 10,
  windowSeconds: 3600,
};
export const JOIN_REQUEST_CANCEL_PERSON_LIMIT: Readonly<PersonLimit> = {
  bucket: "join-request-cancel",
  limit: 20,
  windowSeconds: 3600,
};

/** True when this PERSON has exhausted `limit` (exported so L10b shares the join bucket). */
export function personThrottled(limit: Readonly<PersonLimit>, personId: string): Promise<boolean> {
  return rateLimited(`${limit.bucket}:${personId}`, limit.limit, limit.windowSeconds);
}

/** Route opt-ins for the entry gate. A route passes at most one association option. */
export interface SessionCommandOptions {
  /** Guest-note adapters: association through the note's own session. */
  guestNoteSessionId?: string;
  /** Player routes (L8 P-3): without session.manage, a live (active or guest) member of ?tenant=. */
  selfService?: boolean;
  /** Per-person quota (P-13), checked after association and language, before the tenant bucket. */
  personLimit?: Readonly<PersonLimit>;
}

/**
 * The opted-in association proof for a caller WITHOUT session.manage: the guest note's tenant, or
 * ?tenant= itself when the caller is a live member there (one short withTenant read under RLS).
 * Null = not associated (the one FORBIDDEN 403). An infrastructure error propagates.
 */
async function associatedTenant(
  personId: string,
  tenantId: string,
  options: SessionCommandOptions,
): Promise<string | null> {
  if (options.guestNoteSessionId !== undefined) {
    return guestNoteTenantForPerson(appDb().pool, personId, tenantId, options.guestNoteSessionId);
  }
  if (options.selfService !== true) return null;
  const member = await withTenant(appDb().db, tenantId, (tx) =>
    hasLiveMembership(tx, tenantId, personId),
  );
  return member ? tenantId : null;
}

/**
 * Rejects a commandId that cannot survive the trip to `processed_commands` intact.
 *
 * Two distinct hazards, both of which pass a plain type/length check (codex round-02 [P1]):
 *  - NUL: PostgreSQL cannot store it in `text`, so it surfaces as a 500 rather than a 400.
 *  - Ill-formed UTF-16 (an unpaired surrogate): Node encodes EVERY lone surrogate to the same
 *    UTF-8 replacement bytes, so two clients sending genuinely different keys would collapse onto
 *    ONE ledger row — and the second would be handed the first one's stored result. For an
 *    idempotency key backing money-adjacent commands, a silent key collision is the worst
 *    possible failure, so this fails closed.
 *
 * Written with numeric code-unit comparisons rather than escape sequences so the intent survives
 * any tooling that would rewrite an escape into a literal control character.
 */
export function isUnsafeCommandKey(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return true;
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return true; // high surrogate with no pair
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true; // low surrogate with no lead
  }
  return false;
}

/**
 * Largest request body these commands can legitimately need: every field is a scalar, and the
 * longest is a 200-character commandId.
 */
const MAX_BODY_BYTES = 64 * 1024;

export interface SessionCommandContext {
  tenantId: string;
  commandId: string;
  body: Record<string, unknown>;
  /** Resolved from tenants.locale (DD-118). Carried so handleSessionCommand can wrap the handler. */
  lang: Lang;
}

/** Returns an already-enveloped error Response, or the resolved trusted context. */
export async function resolveSessionCommandContext(
  request: Request,
  rateLimit: { bucket: string; limit: number },
  options: SessionCommandOptions = {},
): Promise<Response | SessionCommandContext> {
  const session = await currentSession();
  if (!session) return err("AUTH_REQUIRED", t("Chưa đăng nhập.", "Not signed in."), 401);
  if (!csrfOk(request, session)) {
    return err("CSRF_INVALID", t("Yêu cầu không hợp lệ.", "Invalid request."), 403);
  }

  // Tenant selection mirrors the existing tenant-scoped route (onboarding/readiness):
  // `?tenant=<uuid>`, which keeps the request BODY exactly as the spec's DTO pins it.
  const parsedTenant = readTenantParam(request);
  if (parsedTenant === null) {
    return err("INVALID_BODY", t("Thiếu hoặc sai mã CLB.", "Missing or invalid club id."), 400);
  }
  let tenantId = parsedTenant;

  // ORDER MATTERS, and an earlier revision had it backwards. The per-tenant bucket must be
  // consumed ONLY by callers already proven to belong to that tenant: because the counter is
  // shared per tenant, letting a stranger spend it lets any authenticated user drive a victim
  // tenant's admins into 429s (cross-tenant denial of service) and distinguishes a real tenant
  // by 429-vs-403. codex round-01 [P1].
  //
  // The original concern that ordering answered — an unbounded membership-read probe — is now
  // handled by an ACTOR-scoped ceiling, which throttles the prober without spending anyone
  // else's quota.
  if (await actorThrottled(session.accountId)) {
    return err("RATE_LIMITED", t("Quá nhiều yêu cầu — đợi.", "Too many requests — wait."), 429);
  }

  if (!(await mayManageSessions(tenantId, session.personId))) {
    // Only adapters opt in. This proves association; commands own permissions and actor-bound replay.
    const associated = await associatedTenant(session.personId, tenantId, options);
    if (associated === null) {
      // Same 403 for missing, foreign or unrelated targets; no tenant-existence oracle.
      return err(
        "FORBIDDEN",
        t("Bạn không có quyền với CLB này.", "Not permitted for this club."),
        403,
      );
    }
    tenantId = associated;
  }

  // Language is resolvable HERE, and this line must stay ABOVE the per-tenant 429 below. The
  // tenant is known and has just been proven to be authorized for this actor, which is DD-118's condition
  // for resolving language — so every response from this point on, INCLUDING the rate-limit
  // rejection, is owed the tenant's language. v1 resolved after the 429 and answered an English
  // tenant's quota rejection in Vietnamese.
  //
  // THE RULE: every `return err(` ABOVE this line is emitted before the tenant is
  // known-and-authorized, so it stays Vietnamese — DD-118's ratified behaviour, not a gap.
  //
  // The membership of that set is deliberately NOT listed here. It was listed twice and was
  // wrong both times (v1 omitted the per-tenant 429; its fix omitted INVALID_BODY), each time
  // while asserting completeness. A list maintained in prose is wrong in every copy that was
  // not the one someone remembered to edit. `session-command-route.test.ts` pins the set and
  // asserts tenantLocale is un-called at each member; read it there, where it can fail.
  //
  // DD-118's seam — why memberLocale is null, why an unrecognised stored value is rejected, and
  // why every undetermined case resolves to vi — now lives in ONE place, `./tenant-lang`. A second
  // surface needed the same derivation, and copying these lines would have created two that could
  // drift apart silently. Read the contract and the threat model there.
  const lang: Lang = await resolveTenantLang(appDb().db, tenantId);

  // The opt-in per-person limit first (P-13; the COOKIE person, never a body id), so a person over
  // their own quota stops spending the tenant's shared bucket. Then the per-tenant limit (BE tech
  // spec §3 "Rate Limits" scopes these per tenant), now reached only by an authorized actor for
  // THAT tenant. Both answered in the tenant's language, unlike v1.
  const personLimited =
    options.personLimit !== undefined &&
    (await personThrottled(options.personLimit, session.personId));
  if (
    personLimited ||
    (await rateLimited(`${rateLimit.bucket}:${tenantId}`, rateLimit.limit, 60))
  ) {
    return runWithLang(lang, async () =>
      err("RATE_LIMITED", t("Quá nhiều yêu cầu — đợi.", "Too many requests — wait."), 429),
    );
  }

  return runWithLang(lang, async (): Promise<Response | SessionCommandContext> => {
    const bodyRead = await readBoundedBody(request, MAX_BODY_BYTES);
    if (!bodyRead.ok) {
      return bodyRead.reason === "too_large"
        ? err("INVALID_BODY", t("Dữ liệu quá lớn.", "Payload too large."), 413)
        : err("INVALID_BODY", t("Dữ liệu không hợp lệ.", "Invalid payload."), 400);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(bodyRead.text);
    } catch {
      return err("INVALID_BODY", t("Dữ liệu không hợp lệ.", "Invalid payload."), 400);
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return err("INVALID_BODY", t("Dữ liệu không hợp lệ.", "Invalid payload."), 400);
    }
    const body = raw as Record<string, unknown>;

    // commandId is the idempotency key the whole family dedups on (DD-117 D5: dedup is on
    // (tenant_id, command_id) ONLY). It is caller-supplied but becomes trusted context only after
    // the tenant above was proven to belong to this actor.
    const commandId = body.commandId;
    if (
      typeof commandId !== "string" ||
      commandId.trim().length === 0 ||
      commandId.length > 200 ||
      isUnsafeCommandKey(commandId)
    ) {
      return err("INVALID_BODY", t("Thiếu commandId.", "Missing commandId."), 400);
    }

    return { tenantId, commandId, body, lang };
  });
}

/**
 * The editable session fields, shaped from JSON. Shared because create and update accept the
 * SAME vocabulary and must not drift apart.
 *
 * Only keys PRESENT in the body appear here, and a provided `null` survives as a real value —
 * updateSession distinguishes "absent" (leave alone) from "null" (clear it), so collapsing the
 * two would silently turn an untouched field into a cleared one.
 *
 * This shapes TYPES only. Domain rules (ends_at > starts_at, sport active, discovery fields for
 * a public session) stay in the command, which owns them and reports its own codes.
 */
export interface SessionFieldPayload {
  startsAt?: Date;
  endsAt?: Date;
  timezone?: string;
  priceAmount?: number;
  slotsMax?: number | null;
  visibility?: "private" | "public";
  area?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
  joinPolicy?: "open" | "approval";
}

export const present = (body: Record<string, unknown>, key: string): boolean =>
  Object.hasOwn(body, key) && body[key] !== undefined;

/**
 * createSession's vocabulary. Since DD-128 OD-4a it INCLUDES venueAddress (private plain text,
 * validated by the command: string | null, max 200 characters), so create and update now share
 * one field list.
 *
 * History that still binds: this slice once dropped the field (codex round-01 [P2]) and then
 * rejected it pre-dispatch (round-02 [P1]) — both broke replay. DD-117 D5 makes payload
 * differences irrelevant to a replay: a create may commit with one payload, lose its response and
 * be retried with another, and that retry must return the stored success rather than a 400. That
 * still holds with venueAddress in the vocabulary because the shaper below never validates; the
 * command dedups on (tenant_id, command_id) BEFORE it validates anything.
 */
const CREATE_FIELD_KEYS = [
  "timezone",
  "priceAmount",
  "slotsMax",
  "visibility",
  "area",
  "venueName",
  "venueAddress",
  "joinPolicy",
] as const;

/**
 * Shapes the provided fields. It NEVER rejects — and that is the whole point.
 *
 * Dedup on (tenant_id, command_id) runs BEFORE patch validation inside every command
 * (DD-117 D5; pinned by session-service.test.ts's DED2: "a replayed commandId for an
 * already-committed update returns the stored result even when the RETRY payload is MALFORMED").
 * An earlier revision validated here and returned 400 before dispatch, so a client retrying a
 * committed command with a corrupted payload would be told it failed AFTER the mutation had
 * already happened — the exact failure DD-117 D5 exists to prevent. codex round-01 [P1].
 *
 * So the only transformation is a convenience the command cannot do for itself: an ISO string
 * becomes a Date. Anything unparseable is passed through UNTOUCHED for the command to judge,
 * which keeps ONE owner for the domain vocabulary and one owner for the error codes.
 */
/**
 * ISO-8601 with an EXPLICIT offset. The offset is the point: without one, `new Date()` resolves a
 * bare wall-clock time against the SERVER's zone, so the same request means different instants on
 * different machines.
 *
 * At most THREE fractional digits, because JavaScript Date is millisecond-precision and accepting
 * more silently truncates — a live probe turned ".123999999Z" into ".123Z". A higher-precision
 * string is simply not converted; it passes through for the command to judge, the same rule every
 * other unconvertible value follows.
 */
const ISO_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Converts ONLY an unambiguous, real instant; every other string is returned untouched for the
 * command to reject after dedup.
 *
 * `new Date(string)` is far too permissive to feed a session's start/end time, and the command
 * cannot catch it because it only checks that the resulting Date is valid — a value this function
 * coerced is already "valid" by then. Measured (codex round-03 [P2]):
 *   "2026-02-30T10:00:00Z"  -> 2026-03-02  (a non-existent date silently rolls over)
 *   "2026-09-01T19:00:00"   -> 19:00Z or 12:00Z depending on the server's TZ
 *   "09/01/2026"            -> locale-dependent
 * The calendar check is explicit rather than a round-trip comparison so it holds for any offset.
 */
function toUnambiguousInstant(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const match = ISO_WITH_OFFSET.exec(value);
  if (!match) return value;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return value;
  // Day 0 of the NEXT month is the last day of this one, so this handles leap years correctly.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return value;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed;
}

function shape(body: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const key of ["startsAt", "endsAt"] as const) {
    if (!present(body, key)) continue;
    out[key] = toUnambiguousInstant(body[key]);
  }
  for (const key of keys) {
    if (present(body, key)) out[key] = body[key];
  }
  return out;
}

/** Fields updateSession accepts (the same list as createSession since DD-128 OD-4a). */
export function shapeSessionFields(body: Record<string, unknown>): SessionFieldPayload {
  // Cast, not validation: every value is either a real Date or the caller's own value, and the
  // command re-derives the truth. Typing it as the payload keeps the routes readable without
  // pretending the route verified anything.
  return shape(body, CREATE_FIELD_KEYS) as SessionFieldPayload;
}

/** Fields createSession accepts, see CREATE_FIELD_KEYS. */
export function shapeCreateFields(body: Record<string, unknown>): SessionFieldPayload {
  return shape(body, CREATE_FIELD_KEYS) as SessionFieldPayload;
}

/**
 * The optimistic-concurrency guard, passed through unvalidated for the same replay reason —
 * DED2 replays specifically with `expectedVersion: null`. `undefined` means "not provided".
 */
export function readExpectedVersion(body: Record<string, unknown>): number | undefined {
  return present(body, "expectedVersion") ? (body.expectedVersion as number) : undefined;
}

/**
 * Status for every literal the BE tech spec §3 error catalog pins for these commands.
 *
 * Keyed on ApiErrorCode, not string, and that is the load-bearing part. It makes the shared
 * registry the COMPILE-TIME gate on this table: adding a row whose code is not in
 * API_ERROR_CODES fails `tsc`, at the moment it is written, rather than shipping a response
 * carrying a code no client contract knows. See mapSessionCommandError for why the runtime
 * narrowing alone was not enough.
 */
const STATUS_BY_CODE: ReadonlyMap<ApiErrorCode, number> = new Map([
  // Web MVP lane M2c (roster + manual mark-paid + reversal), raised as RosterMoneyError.
  ["ALLOCATION_EXCEEDS_FUNDS", 409],
  ["ALLOCATION_NOT_FOUND", 404],
  ["ALREADY_JOINED", 409],
  ["CHARGE_ALREADY_SETTLED", 409],
  ["CHARGE_NOT_PAYABLE", 409],
  ["FORBIDDEN", 403],
  ["MARK_PAID_TOTAL_MISMATCH", 409],
  ["PLAYER_NOT_FOUND", 404],
  ["REJOIN_REQUIRES_REVIEW", 409],
  ["REMOVE_REQUIRES_REVIEW", 409],
  ["REVERSAL_EXCEEDS_EFFECTIVE", 409],
  ["REVERSAL_NOT_SUPPORTED", 409],
  // Web MVP Phase 3 lane L8 (M9 player self-join), raised as RosterMoneyError (P-4, P-10, P-11).
  ["JOIN_REQUEST_NOT_FOUND", 404],
  ["LEAVE_REQUIRES_HOST", 409],
  ["REQUEST_DECIDED", 409],
  ["REQUEST_EXPIRED", 409],
  ["SESSION_NOT_JOINABLE", 400],
  // 400, not the 409 its "conflict" shape suggests. Transcribed verbatim from the §3 catalog
  // (feature_session_management_tech.md §3), which is authority here — this route does not get
  // to pick a status for a spec-pinned code. Since DD-131 OD-1 only cancel emits it: a refusal to
  // act while an active roster, recorded money or an anomaly is present (gate #3 / edge #5 / #28).
  ["CANCEL_REQUIRES_REVIEW", 400],
  ["CAPACITY_BELOW_OCCUPANCY", 409],
  ["CAPACITY_BELOW_ROSTER", 409],
  // 409, pinned in the §3 catalog with DD-131 OD-1: like REMOVE_REQUIRES_REVIEW, the caller resolves
  // it itself (collect the open balances, then close again), so it is a state conflict, not a 400.
  ["CLOSE_BLOCKED_OPEN_DEBT", 409],
  ["COMMAND_ID_CONFLICT", 409],
  ["INVALID_TIME_RANGE", 400],
  ["MISSING_DISCOVERY_FIELDS", 400],
  ["PRICE_CHANGE_REQUIRES_POLICY", 400],
  ["SESSION_NOT_FOUND", 404],
  ["SESSION_NOT_OPEN", 409],
  ["SPORT_INACTIVE", 400],
  ["STALE_VERSION", 409],
  ["TENANT_SUSPENDED", 403],
]);

/**
 * Narrower validation variants the SERVICE throws but the spec's public catalog does not pin.
 * They collapse onto the registered INVALID_BODY 400 rather than inventing API surface that no
 * Reviewed spec describes — all of them mean the same thing to a client: the payload was bad.
 */
const VALIDATION_VARIANTS: ReadonlySet<string> = new Set([
  "INVALID_INPUT",
  "INVALID_JOIN_POLICY",
  "INVALID_PRICE",
  "INVALID_SLOTS",
  "INVALID_TEXT_FIELD",
  "INVALID_TIMEZONE",
  "INVALID_VISIBILITY",
]);

/**
 * User-facing text per pinned code, stored as the [vi, en] PAIR rather than a resolved string.
 * The domain error's own message is NEVER echoed.
 *
 * The pair matters: `t()` reads the request language from AsyncLocalStorage, so calling it while
 * building this table would resolve every message once at module load — outside any request
 * context — and freeze them to the boot fallback for the process lifetime, making `runWithLang`
 * silently ineffective for exactly these responses. `t()` is therefore called per request, in
 * mapSessionCommandError. codex round-02 [P2].
 *
 * Measured 2026-08-26 by AST walk over apps/web production code: 0 eager, 47 lazy t() call
 * sites. This table is the REASON that constraint exists, not evidence that violations are
 * waiting to be found — there are none. The count is true of that tree, not forever.
 */
const MESSAGE_BY_CODE: ReadonlyMap<ApiErrorCode, readonly [string, string]> = new Map([
  [
    "ALLOCATION_EXCEEDS_FUNDS",
    ["Số tiền vượt quá khoản còn thiếu.", "The amount exceeds the remaining balance."],
  ],
  ["ALREADY_JOINED", ["Người chơi đã có trong buổi này.", "This player is already on the roster."]],
  [
    "CHARGE_ALREADY_SETTLED",
    ["Khoản thu này đã được thanh toán đủ.", "This charge is already fully paid."],
  ],
  [
    "CHARGE_NOT_PAYABLE",
    [
      "Chỉ ghi nhận thanh toán cho người chơi đang tham gia.",
      "Payments can only be recorded for an active player.",
    ],
  ],
  [
    "FORBIDDEN",
    ["Bạn không có quyền thực hiện thao tác này.", "You are not permitted to do this."],
  ],
  [
    "MARK_PAID_TOTAL_MISMATCH",
    [
      "Số tiền đã thay đổi — xem lại rồi xác nhận lại.",
      "The balance changed — review and confirm again.",
    ],
  ],
  ["ALLOCATION_NOT_FOUND", ["Không tìm thấy khoản thanh toán.", "Payment not found."]],
  ["PLAYER_NOT_FOUND", ["Không tìm thấy người chơi.", "Player not found."]],
  [
    "REJOIN_REQUIRES_REVIEW",
    [
      "Người chơi này cần được xem xét trước khi thêm lại.",
      "This player needs review before being added again.",
    ],
  ],
  [
    "REMOVE_REQUIRES_REVIEW",
    [
      "Người chơi đã có thanh toán — hãy hoàn tác trước khi xoá.",
      "This player has payments — reverse them before removing.",
    ],
  ],
  [
    "REVERSAL_EXCEEDS_EFFECTIVE",
    ["Khoản thanh toán này đã được hoàn tác hết.", "This payment is already fully reversed."],
  ],
  [
    "REVERSAL_NOT_SUPPORTED",
    [
      "Chỉ hoàn tác được khoản thu tiền mặt hoặc chuyển khoản do chủ CLB ghi nhận.",
      "Only cash or host-attested transfer payments can be reversed here.",
    ],
  ],
  // L8 (M9) copy, verbatim from readiness pin P-17. LEAVE_REQUIRES_HOST is PLAYER copy ("ask the
  // host"): self-leave does not reuse the host-facing REMOVE_REQUIRES_REVIEW pair (P-4).
  [
    "SESSION_NOT_JOINABLE",
    ["Buổi chơi không nhận đăng ký.", "This session is not open for joining."],
  ],
  ["REQUEST_DECIDED", ["Yêu cầu này đã được xử lý.", "This request has already been decided."]],
  ["REQUEST_EXPIRED", ["Yêu cầu này đã hết hạn.", "This request has expired."]],
  ["JOIN_REQUEST_NOT_FOUND", ["Không tìm thấy yêu cầu tham gia.", "Join request not found."]],
  [
    "LEAVE_REQUIRES_HOST",
    [
      "Bạn không thể tự rời buổi này, hãy nhờ chủ kèo.",
      "You cannot leave this session yourself; ask the host.",
    ],
  ],
  [
    // Says what happened and who must act, without leaking WHY. Since DD-131 OD-1 only cancel emits
    // it — for an active roster, recorded money, a live charge with no active player or a draft
    // anomaly — and one wording covers all four, so the body does not say which fired. §3 pins the
    // code and status, not this wording.
    "CANCEL_REQUIRES_REVIEW",
    [
      "Kèo này cần được xem xét trước khi huỷ.",
      "This session needs review before it can be cancelled.",
    ],
  ],
  [
    "CAPACITY_BELOW_OCCUPANCY",
    ["Sức chứa nhỏ hơn số chỗ đang được sử dụng.", "Capacity is below the occupied slots."],
  ],
  [
    "CAPACITY_BELOW_ROSTER",
    ["Sức chứa nhỏ hơn số người đã tham gia.", "Capacity is below the current roster."],
  ],
  [
    // The WHO is in error.details.openBalancePlayers; the message only says what to do. No amount.
    "CLOSE_BLOCKED_OPEN_DEBT",
    [
      "Còn người chơi chưa trả đủ tiền — thu đủ trước khi đóng kèo.",
      "Some players have not paid in full — collect their payments before closing the session.",
    ],
  ],
  [
    "COMMAND_ID_CONFLICT",
    [
      "commandId đã được dùng cho yêu cầu khác.",
      "commandId was already used for a different request.",
    ],
  ],
  [
    "INVALID_TIME_RANGE",
    ["Thời gian kết thúc phải sau thời gian bắt đầu.", "End time must be after start time."],
  ],
  [
    "MISSING_DISCOVERY_FIELDS",
    [
      "Thiếu thông tin bắt buộc để công khai kèo.",
      "Missing fields required to make the session public.",
    ],
  ],
  [
    "PRICE_CHANGE_REQUIRES_POLICY",
    [
      "Đổi giá khi đã có khoản thu cần chính sách xử lý.",
      "Changing the price with existing charges requires a policy.",
    ],
  ],
  ["SESSION_NOT_FOUND", [SESSION_NOT_FOUND_MESSAGE[0], SESSION_NOT_FOUND_MESSAGE[1]]],
  [
    "SESSION_NOT_OPEN",
    [
      "Kèo không ở trạng thái cho phép thao tác này.",
      "The session is not in a state that allows this.",
    ],
  ],
  ["SPORT_INACTIVE", ["Môn thể thao không khả dụng.", "That sport is not available."]],
  [
    "STALE_VERSION",
    ["Kèo vừa được cập nhật — tải lại rồi thử lại.", "The session changed — reload and retry."],
  ],
  ["TENANT_SUSPENDED", ["CLB đang bị tạm ngưng.", "This club is suspended."]],
]);

/**
 * Maps a typed command error onto the pinned envelope. Returns null when the error is NOT a
 * known domain error, so the caller rethrows and it surfaces as a generic 500 — an unmapped
 * internal fault must never be dressed up as a client error.
 */
export function mapSessionCommandError(error: unknown): Response | null {
  const isDomain =
    error instanceof SessionCommandError ||
    error instanceof RosterMoneyError ||
    error instanceof SessionPublishError ||
    error instanceof SessionUpdateError ||
    error instanceof SessionCloseError ||
    error instanceof SessionCancelError ||
    error instanceof SessionPublishAuthorizationError ||
    error instanceof SessionUpdateAuthorizationError ||
    error instanceof SessionCloseAuthorizationError ||
    error instanceof SessionCancelAuthorizationError;
  if (!isDomain) return null;

  const code = (error as { code: string }).code;
  if (VALIDATION_VARIANTS.has(code)) {
    return err("INVALID_BODY", t("Dữ liệu không hợp lệ.", "Invalid payload."), 400);
  }
  // Registry membership is CHECKED here rather than asserted by a cast. This function used to end
  // in `err(code as ApiErrorCode, ...)` — a cast the compiler cannot verify — so ApiErrorCode, the
  // type that is supposed to decide what may go on the wire, had no view of the value actually
  // emitted. Narrowing instead puts the check and the emit on ONE derivation and removes the cast.
  //
  // ORDER MATTERS: this narrowing runs BEFORE the table lookups, so an UNREGISTERED code fails
  // here while a REGISTERED-but-unmapped one falls through to the table-miss check below. A test
  // must pick its forged code against that order — one aimed at the wrong branch passes while
  // proving nothing (codex round-01 [P2]).
  //
  // Measured honestly: this line is runtime-REDUNDANT. Deleting it changes no observable
  // behaviour, because an unregistered code is necessarily absent from both tables and fails
  // closed one check later with the same null. It is kept for the compile-time reason below, not
  // because it catches anything the table miss would not.
  //
  // This narrowing is also what lets the two tables be keyed on ApiErrorCode rather than string,
  // which is the stronger, COMPILE-TIME half of the same guarantee: adding a row whose code is not
  // in API_ERROR_CODES fails `tsc`, enforced by `pnpm -r run typecheck` on every change. This line
  // is the runtime backstop if the two ever diverge.
  if (!isApiErrorCode(code)) return null;
  const status = STATUS_BY_CODE.get(code);
  const message = MESSAGE_BY_CODE.get(code);
  // A domain code that is in neither table is a contract gap, not a client error: fail closed
  // by rethrowing rather than guessing a status.
  if (status === undefined || message === undefined) return null;
  let details: ApiErrorDetails | undefined;
  if (code === "CLOSE_BLOCKED_OPEN_DEBT") {
    details = openBalanceDetails(error);
    // The list IS this code's contract: a refusal that cannot say who owes is a contract gap,
    // never a 409 with an empty or absent list.
    if (details === undefined) return null;
  }
  // t() resolved HERE, inside the request, so the caller's language applies.
  return err(code, t(message[0], message[1]), status, details);
}

/**
 * CLOSE_BLOCKED_OPEN_DEBT's payload, re-projected key by key (an allowlist): whatever the domain
 * error holds, only `playerId` and `displayName` reach the wire — never an amount (DD-131 OD-1).
 * Undefined when the error is not a close refusal or carries no list.
 */
function openBalanceDetails(error: unknown): ApiErrorDetails | undefined {
  if (!(error instanceof SessionCloseError)) return undefined;
  const players = error.openBalancePlayers;
  if (players === undefined || players.length === 0) return undefined;
  return {
    openBalancePlayers: players.map(({ playerId, displayName }) => ({ playerId, displayName })),
  };
}

/**
 * The request boundary for a session command: resolve, establish the language context, run the
 * handler, map domain errors.
 *
 * The try/catch lives HERE, inside the runWithLang callback, and that placement is the whole
 * point. mapSessionCommandError resolves its text through the ALS context; if the catch sat
 * outside the wrap — in each route, as it used to — the mapper would run after the context had
 * been torn down and every error response would silently revert to the boot fallback. Nothing
 * would look wrong until an error path was exercised, which is precisely the defect this lane
 * exists to fix, one layer up. Owning both the wrap and the catch in one function makes that
 * ordering structural rather than a convention each new route has to remember.
 *
 * Errors raised BEFORE the tenant is known-and-authorized are returned by
 * resolveSessionCommandContext outside this wrap and stay Vietnamese — DD-118's ratified
 * behaviour, since no tenant means no language. The set is pinned by test, not restated here:
 * duplicating it is how it came to be wrong twice.
 */
export async function handleSessionCommand(
  request: Request,
  rateLimit: { bucket: string; limit: number },
  handler: (context: SessionCommandContext) => Promise<Response>,
  options: SessionCommandOptions = {},
): Promise<Response> {
  const context = await resolveSessionCommandContext(request, rateLimit, options);
  if (context instanceof Response) return context;

  return runWithLang(context.lang, async () => {
    try {
      return await handler(context);
    } catch (error) {
      const mapped = mapSessionCommandError(error);
      if (mapped) return mapped;
      throw error;
    }
  });
}
