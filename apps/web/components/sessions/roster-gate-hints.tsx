"use client";

import { useT } from "../../lib/i18n-client";
import { canEditRoster, canTakePayments } from "../../lib/roster-rules";
import styles from "./roster.module.css";

/** Why an action is disabled; the ids are referenced by the disabled buttons' aria-describedby. */
export function RosterGateHints({
  status,
  editHint,
  payHint,
}: {
  status: string;
  editHint: string;
  payHint: string;
}) {
  const t = useT();
  return (
    <>
      {canEditRoster(status) ? null : (
        <p id={editHint} className={styles.hint}>
          {t(
            "Chỉ thêm hoặc gỡ người chơi khi buổi đang mở.",
            "Players can only be added or removed while the session is open.",
          )}
        </p>
      )}
      {canTakePayments(status) ? null : (
        <p id={payHint} className={styles.hint}>
          {t(
            "Chỉ ghi nhận thanh toán khi buổi đang mở hoặc đã đóng.",
            "Payments can only be recorded while the session is open or closed.",
          )}
        </p>
      )}
    </>
  );
}
