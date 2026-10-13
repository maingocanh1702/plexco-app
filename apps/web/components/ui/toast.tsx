"use client";

import { useEffect, useRef } from "react";
import { useT } from "../../lib/i18n-client";
import styles from "./toast.module.css";

/** Transient status message; auto-dismisses, always dismissible by keyboard. */
export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const t = useT();
  // Latest callback via ref: an inline onDismiss changes identity every parent render and would
  // otherwise restart the timer each time.
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  });
  useEffect(() => {
    const id = window.setTimeout(() => dismiss.current(), 6000);
    return () => window.clearTimeout(id);
  }, [message]);
  return (
    <div role="status" className={styles.toast}>
      <span>{message}</span>
      <button type="button" className={styles.dismiss} onClick={onDismiss}>
        {t("Đóng", "Dismiss")}
      </button>
    </div>
  );
}
