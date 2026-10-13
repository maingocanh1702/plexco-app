import type { CSSProperties } from "react";
import styles from "./skeleton.module.css";

/** Decorative placeholder; pair with a labelled live region (e.g. Spinner) for screen readers. */
export function Skeleton({ width, height }: { width?: string; height?: string }) {
  const style: CSSProperties = { width: width ?? "100%", height: height ?? "var(--space-4)" };
  return <span aria-hidden="true" className={styles.skeleton} style={style} />;
}
