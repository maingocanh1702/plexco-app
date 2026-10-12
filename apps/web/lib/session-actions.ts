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
 * updateSession refuses an OPEN session whose start has passed (SESSION_NOT_OPEN, privileged
 * correction); a draft has no such guard. The UI mirrors it so the host is not offered a dead end.
 */
export function editBlockedReason(
  session: { status: string; startsAt: string },
  now: number,
): "started" | null {
  return session.status === "open" && Date.parse(session.startsAt) <= now ? "started" : null;
}
