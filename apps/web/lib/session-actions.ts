/** Pure: which host commands a session offers, from its status (feature_session_management). */

export type SessionStatus = "draft" | "open" | "closed" | "cancelled";
export type SessionAction = "edit" | "publish" | "close" | "cancel";

const KNOWN: readonly string[] = ["draft", "open", "closed", "cancelled"];

export function isKnownStatus(status: string): status is SessionStatus {
  return KNOWN.includes(status);
}

/**
 * draft = edit + publish + cancel (discard draft); open = edit + close + cancel; closed/cancelled
 * and ANY unknown status = none (fail closed: an unrecognised status never grows buttons).
 */
export function allowedActions(status: string): SessionAction[] {
  if (status === "draft") return ["edit", "publish", "cancel"];
  if (status === "open") return ["edit", "close", "cancel"];
  return [];
}

/**
 * The backend refuses three past-start commands with SESSION_NOT_OPEN: updating an OPEN session,
 * publishing a DRAFT, and cancelling an OPEN session (close has no past-guard). The UI mirrors
 * them so the host is not offered a dead end; the server stays the authority.
 */
export function blockedReason(
  action: SessionAction,
  session: { status: string; startsAt: string },
  now: number,
): "started" | null {
  const started = Date.parse(session.startsAt) <= now;
  if (!started) return null;
  if ((action === "edit" || action === "cancel") && session.status === "open") return "started";
  if (action === "publish" && session.status === "draft") return "started";
  return null;
}
