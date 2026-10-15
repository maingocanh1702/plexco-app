"use client";

import { useT } from "../../lib/i18n-client";
import styles from "./roster.module.css";

/**
 * Why an action is disabled. The ids are referenced by the disabled buttons' aria-describedby and
 * derive from the SAME `online` / `editable` / `payable` booleans that disable them, so every
 * referenced id exists: offline renders ONE status paragraph (`offlineId`) that explains both
 * gates; online renders the status hint of whichever gate is closed.
 */
export function RosterGateHints({
  online,
  editable,
  payable,
  offlineId,
  editHint,
  payHint,
}: {
  online: boolean;
  editable: boolean;
  payable: boolean;
  offlineId: string;
  editHint: string;
  payHint: string;
}) {
  const t = useT();
  if (!online) {
    return (
      <p id={offlineId} role="status" className={styles.hint}>
        {t(
          "Đang ngoại tuyến — chưa thể thêm, gỡ hay gạch nợ.",
          "You are offline — adding, removing and recording payments are unavailable.",
        )}
      </p>
    );
  }
  return (
    <>
      {editable ? null : (
        <p id={editHint} className={styles.hint}>
          {t(
            "Chỉ thêm hoặc gỡ người chơi khi buổi đang mở.",
            "Players can only be added or removed while the session is open.",
          )}
        </p>
      )}
      {payable ? null : (
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
