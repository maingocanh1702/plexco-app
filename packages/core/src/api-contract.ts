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
 * Since DD-131 OD-1 (pending in PR #51) only CANCEL emits it: an open session with a
 * non-zero active roster (owner gate #3), a charge carrying recorded money (net
 * allocated > 0), a live charge with no active player, or a draft anomaly. The `void`
 * charge of a removed, unpaid player no longer blocks.
 *
 * CLOSE_BLOCKED_OPEN_DEBT (409) replaces it on CLOSE (DD-131 OD-1, reversing DD-117 D3's
 * close half): some charge still has an open balance. It is the ONE code that carries
 * `error.details` — `openBalancePlayers`, ids + display names only, never amounts. Pinned
 * in feature_session_management_tech.md §3; the status is 409 because the caller can
 * resolve it (collect the payments, then close again).
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
 * the specs do NOT pin, proposed as DD-127 (ledger PR) for decisions.md: ALLOCATION_NOT_FOUND,
 * REMOVE_REQUIRES_REVIEW, CHARGE_NOT_PAYABLE, MARK_PAID_TOTAL_MISMATCH, REVERSAL_NOT_SUPPORTED.
 *
 * INVALID_WEBHOOK_SECRET, WEBHOOK_PAYLOAD_MALFORMED, WEBHOOK_RATE_LIMITED and ZALO_TOKEN_INVALID
 * arrived with the Zalo connect and webhook routes (M3a), transcribed from
 * feature_connector_onboarding_tech.md section 3 / feature_zalo_channel_tech.md, not chosen here.
 * CONNECT_SUPERSEDED (409: a newer connect replaced this attempt's webhook token) is the owner's own
 * code for that case (DD-126, signed as OD-2), pinned in feature_connector_onboarding_tech.md
 * section 3; COMMAND_ID_CONFLICT stays reserved for a commandId owned by another command.
 *
 * LINK_CODE_INVALID, LINK_CODE_RATE_LIMITED and MERGE_REQUIRES_REVIEW arrived with POST /api/me/link (M3b),
 * named by feature_identity_tech.md section 7; LINK_UNAVAILABLE (503, retryable) is not pinned by the spec
 * and is proposed as DD-127 (ledger PR). It covers two cases: the link-code lookup key is not configured,
 * or the link transaction hit a deadlock / serialization failure (40P01 / 40001) and was rolled back
 * whole (nothing written, the code still live). Any other failure, a lost connection included, is not
 * mapped to it: it propagates (the route answers 500) and its outcome is UNKNOWN: a failure before
 * COMMIT rolls the transaction back, but a connection that drops after the server applied COMMIT
 * leaves the committed decision (the link included) in place behind that 500.
 *
 * CHANNEL_NOT_LINKED (409) arrived with POST /api/me/channels/:id/detach (M4): one answer for "not yours",
 * "unknown", "already detached" and "inactive" (no existence oracle). Pinned in
 * feature_user_settings_tech.md section 4, signed by the owner as OD-6 (2026-10-14).
 *
 * JOIN_REQUEST_NOT_FOUND (404), LEAVE_REQUIRES_HOST (409), REQUEST_DECIDED (409), REQUEST_EXPIRED (409)
 * and SESSION_NOT_JOINABLE (400) arrived with player self-join (M9: POST /api/sessions/:id/join and
 * /leave, the join-request cancel/approve/reject routes); D3 (DD-135), readiness p3-m9-join-core 4.6.
 *
 * INVALID_CHANNEL (400) and SESSION_ALREADY_ENDED (409) returned with POST /api/sessions/:id/announce
 * (M6), as the DD-56 deferral (b) required; both are pinned in feature_session_management_tech.md
 * section 3. ANNOUNCE_DELIVERY_DISABLED (409) is that route's refusal when the DB shows no live dispatch
 * schedule or a disabled zalo_dm projector (DD-134 (f); proposed, pending owner sign-off), so the route
 * never answers announced:true while nothing can deliver.
 */
export const API_ERROR_CODES = [
  "ALLOCATION_EXCEEDS_FUNDS",
  "ALLOCATION_NOT_FOUND",
  "ALREADY_JOINED",
  "ANNOUNCE_DELIVERY_DISABLED",
  "AUTH_INVALID",
  "AUTH_REQUIRED",
  "AUTH_STALE",
  "AUTH_UNAVAILABLE",
  "CANCEL_REQUIRES_REVIEW",
  "CAPACITY_BELOW_OCCUPANCY",
  "CAPACITY_BELOW_ROSTER",
  "CHANNEL_NOT_LINKED",
  "CHARGE_ALREADY_SETTLED",
  "CHARGE_DERIVATION_UNAVAILABLE",
  "CHARGE_NOT_PAYABLE",
  "CLOSE_BLOCKED_OPEN_DEBT",
  "COMMAND_ID_CONFLICT",
  "CONNECT_SUPERSEDED",
  "CSRF_INVALID",
  "DISCOVERY_RATE_LIMITED",
  "FORBIDDEN",
  "GENDER_FORBIDDEN",
  "GUEST_NOTE_LIMIT_REACHED",
  "GUEST_NOTE_NOT_FOUND",
  "INVALID_BODY",
  "INVALID_CHANNEL",
  "INVALID_FILTER",
  "INVALID_GENDER",
  "INVALID_TIME_RANGE",
  "INVALID_WEBHOOK_SECRET",
  "INVITE_NOT_ALLOWED",
  "JOIN_REQUEST_NOT_FOUND",
  "LEAVE_REQUIRES_HOST",
  "LINK_CODE_INVALID",
  "LINK_CODE_RATE_LIMITED",
  "LINK_UNAVAILABLE",
  "LOGIN_RATE_LIMITED",
  "MARK_PAID_TOTAL_MISMATCH",
  "MERGE_REQUIRES_REVIEW",
  "MISSING_DISCOVERY_FIELDS",
  "NOT_FOUND",
  "NOT_NOTE_CREATOR",
  "PLAYER_NOT_ACTIVE",
  "PLAYER_NOT_FOUND",
  "PRICE_CHANGE_REQUIRES_POLICY",
  "RATE_LIMITED",
  "REJOIN_REQUIRES_REVIEW",
  "REMOVE_REQUIRES_REVIEW",
  "REQUEST_DECIDED",
  "REQUEST_EXPIRED",
  "REVERSAL_EXCEEDS_EFFECTIVE",
  "REVERSAL_NOT_SUPPORTED",
  "SESSION_ALREADY_ENDED",
  "SESSION_FULL",
  "SESSION_NOT_FOUND",
  "SESSION_NOT_JOINABLE",
  "SESSION_NOT_OPEN",
  "SLUG_TAKEN",
  "SPORT_INACTIVE",
  "STALE_VERSION",
  "TENANT_SUSPENDED",
  "WEBHOOK_PAYLOAD_MALFORMED",
  "WEBHOOK_RATE_LIMITED",
  "ZALO_TOKEN_INVALID",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/**
 * The DD-39 self-declared gender value set (decisions.md:542-556), in its order. The settings API
 * rejects anything else with INVALID_GENDER; packages/db/src/gender-crypto.ts mirrors it (packages/db
 * does not depend on @plexco/core).
 */
export const GENDER_VALUES = ["male", "female", "other", "undisclosed"] as const;

/** One entry of CLOSE_BLOCKED_OPEN_DEBT's list: a player whose charge still has an open balance.
 *  Id + display name ONLY (DD-131 OD-1): never an amount, a membership/person id or a contact. */
export interface OpenBalancePlayerDto {
  playerId: string;
  displayName: string | null;
}

/** One pending join request as the host reads it (GET /api/sessions/:id/join-requests, manage_roster).
 *  Request id + the requester's display name + created_at ONLY: never money or contact data. */
export interface PendingJoinRequestDto {
  requestId: string;
  displayName: string | null;
  createdAt: string;
}

/** Result of a self-join (POST /api/sessions/:id/join). Every outcome carries all four keys:
 *  'active' -> playerId; 'waitlisted' -> playerId + waitlistPosition; 'requested' (approval policy)
 *  -> requestId only; the others are null. No amount and no venue (P-18). */
export interface JoinSessionResultDto {
  outcome: "active" | "waitlisted" | "requested";
  playerId: string | null;
  waitlistPosition: number | null;
  requestId: string | null;
}

/**
 * Optional structured payload of an error. Present ONLY on a code that defines one — today exactly
 * CLOSE_BLOCKED_OPEN_DEBT (POST /api/sessions/:id/close). Every other error omits the key entirely,
 * so its body is byte-identical to the pre-`details` envelope.
 */
export interface ApiErrorDetails {
  openBalancePlayers: OpenBalancePlayerDto[];
}

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  statusCode: number;
  details?: ApiErrorDetails;
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
