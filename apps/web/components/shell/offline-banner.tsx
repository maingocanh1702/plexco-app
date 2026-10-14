"use client";

import { useT } from "../../lib/i18n-client";
import { useOnlineStatus } from "../../lib/use-online-status";
import styles from "./offline-banner.module.css";

/** Always-mounted polite live region so a connectivity change is announced when it happens. */
export function OfflineBanner() {
  const t = useT();
  const online = useOnlineStatus();
  return (
    <div role="status" aria-live="polite">
      {online ? null : (
        <p className={styles.banner}>
          {t(
            "Bạn đang offline. Một số thao tác sẽ dùng được lại khi có mạng.",
            "You are offline. Some actions will work again once you are back online.",
          )}
        </p>
      )}
    </div>
  );
}
