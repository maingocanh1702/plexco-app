"use client";

import { useT } from "../../lib/i18n-client";
import styles from "./spinner.module.css";

export function Spinner({ label }: { label?: string }) {
  const t = useT();
  return (
    <span role="status" className={styles.spinner}>
      <span className="sr-only">{label ?? t("Đang tải…", "Loading…")}</span>
    </span>
  );
}
