import { isApiErrorCode, type ApiErrorCode } from "@plexco/core";
import { t } from "@plexco/core/i18n";
import { SessionGuestNoteError } from "@plexco/db";
import { err } from "./api-envelope";

/**
 * The guest-note half of the session-command error boundary, for the two routes
 * `POST /api/sessions/:id/guest-notes` and `DELETE /api/sessions/:id/guest-notes/:noteId`.
 *
 * WHY A SECOND FILE AND NOT session-command-route.ts. That module owns the ENTRY gate — auth,
 * CSRF, tenant membership, rate limits, body bounds, commandId safety — and both guest-note routes
 * go through it unchanged, exactly like publish/close/cancel. What it does not own is this code
 * table: it maps the five status-transition commands' error classes, and `SessionGuestNoteError`
 * is not one of them. Teaching it a sixth class would mean editing the P1 choke-point for a P2
 * feature; adding the table to each route would mean two copies of a status/message map that must
 * never disagree. One helper, used by both routes, is the third option.
 *
 * IT MUST RUN INSIDE runWithLang. `t()` reads the request language from AsyncLocalStorage, so
 * every message below is stored as the [vi, en] PAIR and resolved per request — a table built with
 * resolved strings would freeze to the boot language for the process lifetime. The routes call
 * this from INSIDE their `handleSessionCommand` handler, which is inside the wrap.
 */

/**
 * Status per code, keyed on ApiErrorCode rather than string so the shared registry is the
 * COMPILE-TIME gate on this table: a row whose code is not in API_ERROR_CODES fails `tsc` when it
 * is written, instead of shipping a literal no client contract knows. Same construction, and same
 * reason, as STATUS_BY_CODE in session-command-route.ts.
 *
 * Every status is transcribed verbatim from the §3 error catalog
 * (docs/features/BE/feature_session_management_tech.md:317-325); this file does not get to choose
 * one for a spec-pinned code.
 */
const STATUS_BY_CODE: ReadonlyMap<ApiErrorCode, number> = new Map([
  ["COMMAND_ID_CONFLICT", 409],
  ["GUEST_NOTE_LIMIT_REACHED", 400],
  ["GUEST_NOTE_NOT_FOUND", 404],
  ["INVITE_NOT_ALLOWED", 403],
  ["NOT_NOTE_CREATOR", 403],
  ["PLAYER_NOT_ACTIVE", 403],
  ["SESSION_FULL", 409],
  ["SESSION_NOT_FOUND", 404],
  ["SESSION_NOT_OPEN", 409],
]);

/** User-facing text per code as the [vi, en] pair — see the runWithLang note above. The domain
 *  error's own message is NEVER echoed: it carries internal detail (counts, ids, reasons). */
const MESSAGE_BY_CODE: ReadonlyMap<ApiErrorCode, readonly [string, string]> = new Map([
  [
    "COMMAND_ID_CONFLICT",
    [
      "commandId đã được dùng cho yêu cầu khác.",
      "commandId was already used for a different request.",
    ],
  ],
  [
    "GUEST_NOTE_LIMIT_REACHED",
    ["Đã hết lượt ghi chú (tối đa 3).", "You have used all 3 guest notes for this session."],
  ],
  ["GUEST_NOTE_NOT_FOUND", ["Ghi chú không tồn tại.", "That guest note does not exist."]],
  [
    "INVITE_NOT_ALLOWED",
    ["Buổi chơi không cho phép mời bạn.", "This session does not allow inviting guests."],
  ],
  ["NOT_NOTE_CREATOR", ["Bạn không tạo ghi chú này.", "You did not create this guest note."]],
  [
    "PLAYER_NOT_ACTIVE",
    ["Bạn chưa tham gia buổi chơi này.", "You are not an active player in this session."],
  ],
  ["SESSION_FULL", ["Buổi chơi đã đầy.", "This session is full."]],
  ["SESSION_NOT_FOUND", ["Không tìm thấy kèo.", "Session not found."]],
  [
    "SESSION_NOT_OPEN",
    [
      "Kèo không ở trạng thái cho phép thao tác này.",
      "The session is not in a state that allows this.",
    ],
  ],
]);

/**
 * Narrow validation variant the SERVICE throws but §3 does not pin. It collapses onto the
 * already-registered INVALID_BODY 400 rather than inventing public surface no Reviewed spec
 * describes — the same rule session-command-route.ts applies to INVALID_PRICE and its siblings.
 */
const VALIDATION_VARIANTS: ReadonlySet<string> = new Set(["INVALID_INPUT"]);

/**
 * Maps a guest-note domain error onto the pinned envelope, or returns null when the error is not
 * one — the caller then rethrows and it surfaces as a fault. An unmapped internal failure must
 * never be dressed up as a client error.
 */
export function mapGuestNoteError(error: unknown): Response | null {
  if (!(error instanceof SessionGuestNoteError)) return null;

  const code: string = error.code;
  if (VALIDATION_VARIANTS.has(code)) {
    return err("INVALID_BODY", t("Dữ liệu không hợp lệ.", "Invalid payload."), 400);
  }
  // Narrowed, not cast: this is the runtime backstop if SessionGuestNoteErrorCode and
  // API_ERROR_CODES ever diverge. It runs BEFORE the lookups, so an UNREGISTERED code fails here
  // while a registered-but-unmapped one falls through to the table-miss check below.
  if (!isApiErrorCode(code)) return null;
  const status = STATUS_BY_CODE.get(code);
  const message = MESSAGE_BY_CODE.get(code);
  // A domain code in neither table is a contract gap, not a client error: fail closed rather than
  // guess a status.
  if (status === undefined || message === undefined) return null;
  return err(code, t(message[0], message[1]), status);
}

/**
 * Runs a guest-note route body and converts its domain errors. Both routes call it INSIDE their
 * `handleSessionCommand` handler: the handler runs within runWithLang, so `t()` resolves to the
 * tenant's language, and anything this does not recognise propagates to handleSessionCommand's own
 * catch and then out as a fault.
 *
 * The wrapper exists so neither route hand-writes the try/catch — the placement (inside the
 * language wrap) is the part that silently breaks when it is copied.
 */
export async function withGuestNoteErrors(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    const mapped = mapGuestNoteError(error);
    if (mapped) return mapped;
    throw error;
  }
}
