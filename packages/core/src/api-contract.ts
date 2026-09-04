/**
 * Shared API contract — JSON envelope + error-code registry.
 *
 * Contract source (AUTHORITATIVE prose): docs/channels/web/README.md §7 and
 * docs/standards/frontend-architecture.md §6. This module only TYPES that
 * contract — it does not change shape or behavior.
 *
 * BROWSER-SAFE: types + const only, no Node builtins (core barrel invariant).
 * Server-side envelope construction stays in apps/web/lib/api-envelope.ts
 * (needs node:crypto for requestId).
 *
 * Registry rule: every `code` passed to `err()` MUST be listed here. Adding a
 * code = add it to API_ERROR_CODES (keep the list sorted) — typecheck enforces
 * the rest across web/bot/FE consumers.
 */

/**
 * All error codes currently emitted by API routes (sorted).
 *
 * The session-command codes come VERBATIM from the error catalog pinned in
 * docs/features/BE/feature_session_management_tech.md §3 — that spec, not this
 * file, decides which literals the API may emit. A domain code the spec does NOT
 * pin is never added here: the session commands also throw narrower validation
 * variants (INVALID_INPUT, INVALID_PRICE, INVALID_SLOTS, INVALID_TIMEZONE,
 * INVALID_VISIBILITY, INVALID_JOIN_POLICY, INVALID_TEXT_FIELD) which the route
 * collapses onto the already-registered INVALID_BODY 400 rather than inventing
 * public surface the Reviewed spec does not describe.
 *
 * CANCEL_REQUIRES_REVIEW arrived with the close and cancel ROUTES, which is the
 * rule this registry has always followed: a code is registered when something can
 * actually emit it, not when a command first throws it. closeSession and
 * cancelSession have raised it since 2026-08-26, but until those two routes shipped
 * nothing could put it on the wire — api-contract.test.ts recorded exactly that,
 * and this entry discharges it. Status 400 is transcribed verbatim from
 * docs/features/BE/feature_session_management_tech.md §3, not chosen here.
 *
 * It is the money path's public face: both commands fail CLOSED with this code when
 * a session carries ANY charge (including a `void` one) or, on cancel, a non-zero
 * active roster — DD-117 / edge #5. Registering it is what lets the route return the
 * real refusal instead of a generic 500.
 */
export const API_ERROR_CODES = [
  "AUTH_INVALID",
  "AUTH_REQUIRED",
  "AUTH_STALE",
  "AUTH_UNAVAILABLE",
  "CANCEL_REQUIRES_REVIEW",
  "CAPACITY_BELOW_ROSTER",
  "COMMAND_ID_CONFLICT",
  "CSRF_INVALID",
  "FORBIDDEN",
  "INVALID_BODY",
  "INVALID_TIME_RANGE",
  "LOGIN_RATE_LIMITED",
  "MISSING_DISCOVERY_FIELDS",
  "NOT_FOUND",
  "PRICE_CHANGE_REQUIRES_POLICY",
  "RATE_LIMITED",
  "SESSION_NOT_FOUND",
  "SESSION_NOT_OPEN",
  "SLUG_TAKEN",
  "SPORT_INACTIVE",
  "STALE_VERSION",
  "TENANT_SUSPENDED",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  statusCode: number;
}

export interface ApiMeta {
  requestId: string;
}

/** Envelope per docs/channels/web/README.md §7 — exactly one of data|error is non-null. */
export interface ApiEnvelope<T> {
  data: T | null;
  error: ApiError | null;
  meta: ApiMeta;
}

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && (API_ERROR_CODES as readonly string[]).includes(value);
}
