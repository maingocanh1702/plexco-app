"use client";

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
 * - CANCEL_REQUIRES_REVIEW: one hint that does not say WHICH of "active players" or "recorded
 *   payments" applies (the server's body does not either).
 * `onShowRoster` leads to the existing Roster tab, where payments are recorded; no new route.
 */
export function SessionActionErrorExtra({
  error,
  onShowRoster,
}: {
  error: unknown;
  onShowRoster: () => void;
}) {
  const t = useT();
  const players = openBalancePlayersOf(error);
  if (players.length > 0) {
    return (
      <div className={styles.extra}>
        <p className={styles.lead}>
          {t("Người chơi còn thiếu tiền:", "Players with an open balance:")}
        </p>
        <ul className={styles.list}>
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
  if (error instanceof ApiClientError && error.code === "CANCEL_REQUIRES_REVIEW") {
    return (
      <div className={styles.extra}>
        <p className={styles.lead}>
          {t(
            "Gỡ từng người chơi khỏi danh sách và hoàn tác các khoản thanh toán đã ghi, rồi huỷ lại.",
            "Remove the players one by one and reverse any recorded payments first, then cancel again.",
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
