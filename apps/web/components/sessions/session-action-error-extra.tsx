"use client";

import { useId } from "react";
import { useT } from "../../lib/i18n-client";
import { displayNameOf } from "../../lib/roster-rules";
import { openBalancePlayersOf } from "../../lib/session-error-ui";
import { ApiClientError } from "../../lib/api-client";
import { Button } from "../ui/button";
import styles from "./session-action-error-extra.module.css";

/**
 * What a close / cancel refusal adds to the generic notice (rendered inside its role=alert):
 * - CLOSE_BLOCKED_OPEN_DEBT: the players with an open balance, by display name (DD-131 OD-1). Ids are
 *   only React keys; no amount is shown or invented. A missing / empty / malformed list renders
 *   nothing extra, so the server's generic message stands alone (fail closed).
 * - CANCEL_REQUIRES_REVIEW on an OPEN session: one hint that does not say WHICH of "active players"
 *   or "recorded payments" applies (the server's body does not either), in the order the host must
 *   act: reverse recorded payments first (REMOVE_REQUIRES_REVIEW refuses a paid player), then remove
 *   players. A DRAFT refusal (the draft-source anomaly, tech doc edge #28) adds nothing: the roster
 *   cannot be edited on a draft, so the server's message stands alone rather than point at a dead end.
 * `onShowRoster` leads to the existing Roster tab, where payments are recorded; no new route.
 */
export function SessionActionErrorExtra({
  error,
  sessionStatus,
  onShowRoster,
}: {
  error: unknown;
  /** The session's status: the roster hint only makes sense while it is `open`. */
  sessionStatus: string;
  onShowRoster: () => void;
}) {
  const t = useT();
  const leadId = useId();
  const players = openBalancePlayersOf(error);
  if (players.length > 0) {
    return (
      <div className={styles.extra}>
        <p id={leadId} className={styles.lead}>
          {t("Người chơi còn thiếu tiền:", "Players with an open balance:")}
        </p>
        {/* tabIndex: the capped list scrolls, so keyboard users must be able to focus and scroll it */}
        <ul className={styles.list} tabIndex={0} aria-labelledby={leadId}>
          {players.map((p) => (
            <li key={p.playerId}>{displayNameOf(p.displayName, t)}</li>
          ))}
        </ul>
        <Button variant="secondary" onClick={onShowRoster}>
          {t("Mở danh sách người chơi", "Open the roster")}
        </Button>
      </div>
    );
  }
  if (
    error instanceof ApiClientError &&
    error.code === "CANCEL_REQUIRES_REVIEW" &&
    sessionStatus === "open"
  ) {
    return (
      <div className={styles.extra}>
        <p className={styles.lead}>
          {t(
            "Hoàn tác các khoản thanh toán đã ghi trước, rồi gỡ từng người chơi khỏi danh sách và huỷ lại.",
            "Reverse any recorded payments first, then remove the players one by one and cancel again.",
          )}
        </p>
        <Button variant="secondary" onClick={onShowRoster}>
          {t("Mở danh sách người chơi", "Open the roster")}
        </Button>
      </div>
    );
  }
  return null;
}
