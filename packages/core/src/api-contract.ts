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

/** All error codes currently emitted by API routes (sorted). */
export const API_ERROR_CODES = [
  "AUTH_INVALID",
  "AUTH_REQUIRED",
  "AUTH_STALE",
  "AUTH_UNAVAILABLE",
  "CSRF_INVALID",
  "FORBIDDEN",
  "INVALID_BODY",
  "LOGIN_RATE_LIMITED",
  "NOT_FOUND",
  "RATE_LIMITED",
  "SLUG_TAKEN",
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
