"use client";

import { useEffect } from "react";
import { useT } from "../../lib/i18n-client";
import styles from "./toast.module.css";

/** Transient status message; auto-dismisses, always dismissible by keyboard. */
export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const t = useT();
  useEffect(() => {
    const id = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(id);
  }, [message, onDismiss]);
  return (
    <div role="status" className={styles.toast}>
      <span>{message}</span>
      <button type="button" className={styles.dismiss} onClick={onDismiss}>
        {t("Đóng", "Dismiss")}
      </button>
    </div>
  );
}
