import type { ReactNode } from "react";
import styles from "./inline-error.module.css";

/** Form/page level error; role=alert so it is announced when it appears. */
export function InlineError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className={styles.error}>
      {children}
    </p>
  );
}
