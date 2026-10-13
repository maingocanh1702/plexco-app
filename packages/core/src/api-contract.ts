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
 *
 * The six guest-note codes (GUEST_NOTE_LIMIT_REACHED, GUEST_NOTE_NOT_FOUND, INVITE_NOT_ALLOWED,
 * NOT_NOTE_CREATOR, PLAYER_NOT_ACTIVE, SESSION_FULL) arrived the same way, with the
 * CreateGuestNote/DeleteGuestNote routes. They are transcribed from the §3 catalog, not chosen
 * here, and each says something FORBIDDEN/NOT_FOUND cannot: "the host disabled invites" is not
 * "you are not a member", and "this note is not yours" (403) is not "there is no such note" (404).
 * createGuestNote also raises a narrow INVALID_INPUT, which the route collapses onto INVALID_BODY
 * exactly like the other commands' validation variants.
 *
 * Web MVP lane M2c (host roster + manual mark-paid + reversal) registers: ALREADY_JOINED,
 * PLAYER_NOT_FOUND, REJOIN_REQUIRES_REVIEW (spec §3 catalog); ALLOCATION_EXCEEDS_FUNDS,
 * CHARGE_ALREADY_SETTLED, REVERSAL_EXCEEDS_EFFECTIVE (payment_reconcile BE/FE specs); and five codes
 * the specs do NOT pin, proposed in the lane report for decisions.md: ALLOCATION_NOT_FOUND,
 * REMOVE_REQUIRES_REVIEW, CHARGE_NOT_PAYABLE, MARK_PAID_TOTAL_MISMATCH, REVERSAL_NOT_SUPPORTED.
 */
export const API_ERROR_CODES = [
  "ALLOCATION_EXCEEDS_FUNDS",
  "ALLOCATION_NOT_FOUND",
  "ALREADY_JOINED",
  "AUTH_INVALID",
  "AUTH_REQUIRED",
  "AUTH_STALE",
  "AUTH_UNAVAILABLE",
  "CANCEL_REQUIRES_REVIEW",
  "CAPACITY_BELOW_OCCUPANCY",
  "CAPACITY_BELOW_ROSTER",
  "CHARGE_ALREADY_SETTLED",
  "CHARGE_NOT_PAYABLE",
  "COMMAND_ID_CONFLICT",
  "CSRF_INVALID",
  "FORBIDDEN",
  "GUEST_NOTE_LIMIT_REACHED",
  "GUEST_NOTE_NOT_FOUND",
  "INVALID_BODY",
  "INVALID_TIME_RANGE",
  "INVITE_NOT_ALLOWED",
  "LOGIN_RATE_LIMITED",
  "MARK_PAID_TOTAL_MISMATCH",
  "MISSING_DISCOVERY_FIELDS",
  "NOT_FOUND",
  "NOT_NOTE_CREATOR",
  "PLAYER_NOT_ACTIVE",
  "PLAYER_NOT_FOUND",
  "PRICE_CHANGE_REQUIRES_POLICY",
  "RATE_LIMITED",
  "REJOIN_REQUIRES_REVIEW",
  "REMOVE_REQUIRES_REVIEW",
  "REVERSAL_EXCEEDS_EFFECTIVE",
  "REVERSAL_NOT_SUPPORTED",
  "SESSION_FULL",
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
