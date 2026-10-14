import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./badge.module.css";

export type BadgeTone = "neutral" | "success" | "warning" | "error" | "info";

/** Status pill. Always carries a text label: colour is reinforcement, never the only signal. */
export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={cx(styles.badge, styles[tone])}>{children}</span>;
}
