/**
 * Sealed AppError + canonical mapper — FE error model per
 * docs/standards/frontend-architecture.md §6 (DD-57, v0.7).
 *
 * BROWSER-SAFE (core barrel invariant): pure data + pure function, no Node
 * builtins, no i18n here — UI maps `code` → `t(vi, en)` itself (FE-INV-4);
 * this module never produces user-facing strings, it only passes the server
 * message through for logging/fallback.
 *
 * One mapper, one place: every screen goes through `toAppError` instead of
 * mapping status→kind ad hoc (frontend-architecture §6 "Mapper chuẩn").
 */

import { isApiErrorCode, type ApiErrorCode } from "./api-contract.js";

export type AppErrorKind =
  "network" | "unauthorized" | "forbidden" | "notFound" | "validation" | "server" | "unknown";

export interface AppError {
  kind: AppErrorKind;
  /** Present only when the server sent a code registered in API_ERROR_CODES. */
  code?: ApiErrorCode;
  /** Server message passthrough — logging/fallback only, not the i18n display string. */
  message?: string;
  statusCode?: number;
  requestId?: string;
}

/**
 * Loose input on purpose: this runs at the trust boundary, so nothing about
 * the payload may be assumed. Pass `undefined`/`null` when fetch itself threw
 * (no HTTP response) — that is the `network` case.
 */
export interface ToAppErrorInput {
  error?: {
    code?: unknown;
    message?: unknown;
    statusCode?: unknown;
  } | null;
  meta?: { requestId?: unknown } | null;
}

/**
 * statusCode → kind. 4xx not listed (incl. 429 rate-limit — the sealed set of
 * §6 has no dedicated kind for it yet) fall to `unknown`, never to a softer
 * bucket: fail-closed per FE-INV-1's error-row rule.
 */
function kindFromStatus(statusCode: number): AppErrorKind {
  if (statusCode === 400) return "validation";
  if (statusCode === 401) return "unauthorized";
  if (statusCode === 403) return "forbidden";
  if (statusCode === 404) return "notFound";
  if (statusCode >= 500 && statusCode <= 599) return "server";
  return "unknown";
}

export function toAppError(input: ToAppErrorInput | null | undefined): AppError {
  if (input == null) return { kind: "network" };

  const raw = input.error;
  if (raw == null || typeof raw !== "object") {
    // Called on something that is not an error envelope — refuse to guess.
    return { kind: "unknown" };
  }

  const statusCode = typeof raw.statusCode === "number" ? raw.statusCode : undefined;
  const requestId = typeof input.meta?.requestId === "string" ? input.meta.requestId : undefined;

  return {
    kind: statusCode === undefined ? "unknown" : kindFromStatus(statusCode),
    ...(isApiErrorCode(raw.code) ? { code: raw.code } : {}),
    ...(typeof raw.message === "string" ? { message: raw.message } : {}),
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
  };
}
