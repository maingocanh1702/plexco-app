import type { ApiErrorCode } from "@plexco/core";
import { parseLang, resolveLang, runWithLang, t, type Lang } from "@plexco/core/i18n";
import {
  SessionCommandError,
  SessionPublishAuthorizationError,
  SessionPublishError,
  SessionUpdateAuthorizationError,
  SessionUpdateError,
  tenantLocale,
  tenantsForPerson,
} from "@plexco/db";
import { err } from "./api-envelope";
import { appDb, csrfOk, currentSession, rateLimited } from "./session-cookies";

/**
 * Shared entry gate + error mapper for the THREE session-command routes this slice ships:
 * create, publish and update. Announce is NOT among them — its only observable effect is
 * delivery and nothing can deliver yet, so it returns with the slice that provides a real
 * projector (DD-56 amendment, clause 1).
 *
 * ONE choke-point on purpose: DD-56 bans adapters from scattering `role === ...` across routes,
 * and when the capability registry (`tenant-capability-authority-core`) lands there must be
 * exactly one call site to replace — not three copies drifting apart.
 *
 * The commands own their own `withTenant` transaction, so a route calls them directly and
 * must NOT wrap them again.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Actor authorization for a session command. The BE tech spec §3 marks these endpoints
 * `TenantAdmin`, and DD-56 pins the role model: `tenant_admins.role='admin'` is a legacy label
 * that maps onto "đúng cùng least-privilege preset" as `co_admin`, and that DEFAULT preset
 * contains `session.manage`.
 *
 * `co_admin` is therefore allowed. An earlier revision of this slice excluded it, reasoning that
 * its capability needed the unbuilt DD-56 grant storage; codex round-01 [P2] corrected that, and
 * re-reading the decision confirms it — the explicit grant/expiry/revocation machinery governs
 * the SENSITIVE owner-only list (`role.manage`, `money.refund`, `billing.manage`, …), not the
 * default preset. Excluding co_admin was a deviation from an accepted contract, not extra safety.
 *
 * Owner-only capabilities are NOT granted here: this gate answers only "may this actor run a
 * session command", which is a default-preset question for all three roles.
 */
const ALLOWED_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "co_admin"]);

/**
 * Pre-authorization ceiling, keyed on the ACTOR rather than the tenant. It bounds how fast an
 * authenticated caller can drive membership reads without ever touching a tenant's own quota.
 * Deliberately looser than the per-tenant write limits (spec §3 pins 10–20/min) so a legitimate
 * admin always meets the tenant limit first and this never becomes the binding constraint.
 */
const ACTOR_LIMIT = { limit: 60, windowSeconds: 60 };

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

/**
 * Reads the body with a hard byte ceiling, returning null when the ceiling is crossed.
 *
 * `request.json()` buffers whatever arrives, so a single authenticated tenant admin could hold the
 * process to ransom with one very large or chunked body — the request-COUNT limiter above does not
 * bound request SIZE (codex round-02/2 [P2]). Next.js App Router route handlers have no built-in
 * body limit, unlike the old Pages API `bodyParser.sizeLimit`.
 *
 * The stream is CANCELLED as soon as the ceiling is crossed rather than drained, so an oversized
 * chunked body is abandoned mid-flight instead of being read to completion and then rejected. The
 * declared Content-Length is checked first as a cheap reject, but it is only a hint — a chunked
 * request may omit or understate it, so the running total is what actually enforces the bound.
 */
type BoundedBody =
  { ok: true; text: string } | { ok: false; reason: "too_large" | "malformed_encoding" };

async function readBoundedBody(request: Request): Promise<BoundedBody> {
  const declared = Number(request.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, reason: "too_large" };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: true, text: "" }; // no stream = no body

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return { ok: false, reason: "too_large" };
    }
    chunks.push(value);
  }

  try {
    // FATAL decoding is load-bearing, not defensive tidiness. A non-fatal TextDecoder maps EVERY
    // invalid byte to U+FFFD, so raw 0x80 and 0x81 both become "\uFFFD" — two distinct client
    // commandIds collapsing onto one processed_commands row, where the second caller replays the
    // first caller's session. That is the same key-collision class the lone-surrogate guard above
    // closes, one layer lower, and it was introduced by replacing request.json() with a manual
    // decode in the body-size fix. codex round-02/2 -> round-03/1 [P1].
    return {
      ok: true,
      text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    };
  } catch {
    return { ok: false, reason: "malformed_encoding" };
  }
}

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
): Promise<Response | SessionCommandContext> {
  const session = await currentSession();
  if (!session) return err("AUTH_REQUIRED", t("Chưa đăng nhập.", "Not signed in."), 401);
  if (!csrfOk(request, session)) {
    return err("CSRF_INVALID", t("Yêu cầu không hợp lệ.", "Invalid request."), 403);
  }

  // Tenant selection mirrors the existing tenant-scoped route (onboarding/readiness):
  // `?tenant=<uuid>`, which keeps the request BODY exactly as the spec's DTO pins it.
  const rawTenantId = new URL(request.url).searchParams.get("tenant") ?? "";
  if (!UUID_RE.test(rawTenantId)) {
    return err("INVALID_BODY", t("Thiếu hoặc sai mã CLB.", "Missing or invalid club id."), 400);
  }
  // Canonicalize ONCE, here, before the value is used for anything. The regex is
  // case-insensitive but PostgreSQL renders uuid as lowercase, so comparing a raw uppercase id
  // against tenantsForPerson() output denied a legitimate member with a 403 — and would also
  // have split the rate-limit bucket and the tenant routing context by letter case.
  // codex round-02 [P2].
  const tenantId = rawTenantId.toLowerCase();

  // ORDER MATTERS, and an earlier revision had it backwards. The per-tenant bucket must be
  // consumed ONLY by callers already proven to belong to that tenant: because the counter is
  // shared per tenant, letting a stranger spend it lets any authenticated user drive a victim
  // tenant's admins into 429s (cross-tenant denial of service) and distinguishes a real tenant
  // by 429-vs-403. codex round-01 [P1].
  //
  // The original concern that ordering answered — an unbounded membership-read probe — is now
  // handled by an ACTOR-scoped ceiling, which throttles the prober without spending anyone
  // else's quota.
  if (
    await rateLimited(
      `session-actor:${session.accountId}`,
      ACTOR_LIMIT.limit,
      ACTOR_LIMIT.windowSeconds,
    )
  ) {
    return err("RATE_LIMITED", t("Quá nhiều yêu cầu — đợi.", "Too many requests — wait."), 429);
  }

  const mine = await tenantsForPerson(appDb().pool, session.personId);
  const membership = mine.find((m) => m.tenantId === tenantId);
  if (!membership || !ALLOWED_ROLES.has(membership.role)) {
    // Same 403 whether the tenant does not exist, the caller is not a member, or the caller is a
    // member without the role: a distinct 404 would turn this into a tenant-existence oracle.
    return err(
      "FORBIDDEN",
      t("Bạn không có quyền với CLB này.", "Not permitted for this club."),
      403,
    );
  }

  // Language is resolvable HERE, and this line must stay ABOVE the per-tenant 429 below. The
  // tenant is known and has just been proven to belong to this actor, which is DD-118's condition
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
  // DD-118 pins the SEAM, not just the source: resolveLang(memberLocale, tenantDefault) is called
  // with memberLocale = null because no member-locale column exists yet. parseLang alone would
  // produce identical output today and leave nowhere correct for that column to land when it
  // arrives. tenantLocale returns null for SEVERAL reasons (see its contract — null means
  // "undetermined", never "no such tenant"); parseLang rejects an unrecognised stored value;
  // DD-118 says every undetermined case resolves to vi.
  const tenantDefault: Lang = parseLang((await tenantLocale(appDb().db, tenantId)) ?? "") ?? "vi";
  const lang: Lang = resolveLang(null, tenantDefault);

  // Per-tenant limit (BE tech spec §3 "Rate Limits" scopes these per tenant), now reached only by
  // an authorized member of THAT tenant. Answered in the tenant's language, unlike v1.
  if (await rateLimited(`${rateLimit.bucket}:${tenantId}`, rateLimit.limit, 60)) {
    return runWithLang(lang, async () =>
      err("RATE_LIMITED", t("Quá nhiều yêu cầu — đợi.", "Too many requests — wait."), 429),
    );
  }

  return runWithLang(lang, async (): Promise<Response | SessionCommandContext> => {
    const bodyRead = await readBoundedBody(request);
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
 * createSession's vocabulary. It has NO venueAddress, and that omission is the fix for a defect
 * this slice got wrong twice (codex round-01 [P2], then round-02 [P1]).
 *
 * Round 1 flagged that the shared parser recognised venueAddress while create dropped it —
 * accepting data and silently losing it. The first fix REJECTED the field, which round 2 showed
 * still breaks replay: a create can commit WITHOUT venueAddress, lose its response, and be
 * retried with the field present; DD-117 D5 makes payload differences irrelevant to replay, so
 * that retry must return the stored success rather than a 400. The earlier reasoning ("a create
 * carrying venueAddress can never have committed") only considered the RETRY payload and missed
 * that the ORIGINAL could differ.
 *
 * Both are closed by making create's shape honest: the field is simply not part of this
 * command's vocabulary, so it is ignored exactly like any other unrecognised key rather than
 * being parsed-then-dropped or rejected pre-dedup. Wiring it end to end would mean editing
 * session-service.ts, which belongs to the in-flight close-cancel lane.
 */
const CREATE_FIELD_KEYS = [
  "timezone",
  "priceAmount",
  "slotsMax",
  "visibility",
  "area",
  "venueName",
  "joinPolicy",
] as const;

/** updateSession additionally accepts venueAddress. */
const UPDATE_FIELD_KEYS = [...CREATE_FIELD_KEYS, "venueAddress"] as const;

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

/** Fields updateSession accepts. */
export function shapeSessionFields(body: Record<string, unknown>): SessionFieldPayload {
  // Cast, not validation: every value is either a real Date or the caller's own value, and the
  // command re-derives the truth. Typing it as the payload keeps the routes readable without
  // pretending the route verified anything.
  return shape(body, UPDATE_FIELD_KEYS) as SessionFieldPayload;
}

/** Fields createSession accepts — venueAddress is not one of them, see CREATE_FIELD_KEYS. */
export function shapeCreateFields(
  body: Record<string, unknown>,
): Omit<SessionFieldPayload, "venueAddress"> {
  return shape(body, CREATE_FIELD_KEYS) as Omit<SessionFieldPayload, "venueAddress">;
}

/**
 * The optimistic-concurrency guard, passed through unvalidated for the same replay reason —
 * DED2 replays specifically with `expectedVersion: null`. `undefined` means "not provided".
 */
export function readExpectedVersion(body: Record<string, unknown>): number | undefined {
  return present(body, "expectedVersion") ? (body.expectedVersion as number) : undefined;
}

/** Status for every literal the BE tech spec §3 error catalog pins for these four commands. */
const STATUS_BY_CODE: ReadonlyMap<string, number> = new Map([
  ["CAPACITY_BELOW_ROSTER", 409],
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
const MESSAGE_BY_CODE: ReadonlyMap<string, readonly [string, string]> = new Map([
  [
    "CAPACITY_BELOW_ROSTER",
    ["Sức chứa nhỏ hơn số người đã tham gia.", "Capacity is below the current roster."],
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
  ["SESSION_NOT_FOUND", ["Không tìm thấy kèo.", "Session not found."]],
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
    error instanceof SessionPublishError ||
    error instanceof SessionUpdateError ||
    error instanceof SessionPublishAuthorizationError ||
    error instanceof SessionUpdateAuthorizationError;
  if (!isDomain) return null;

  const code = (error as { code: string }).code;
  if (VALIDATION_VARIANTS.has(code)) {
    return err("INVALID_BODY", t("Dữ liệu không hợp lệ.", "Invalid payload."), 400);
  }
  const status = STATUS_BY_CODE.get(code);
  const message = MESSAGE_BY_CODE.get(code);
  // A domain code that is in neither table is a contract gap, not a client error: fail closed
  // by rethrowing rather than guessing a status.
  if (status === undefined || message === undefined) return null;
  // t() resolved HERE, inside the request, so the caller's language applies.
  return err(code as ApiErrorCode, t(message[0], message[1]), status);
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
): Promise<Response> {
  const context = await resolveSessionCommandContext(request, rateLimit);
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
