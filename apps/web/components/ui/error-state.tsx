"use client";

import { useT } from "../../lib/i18n-client";
import { Button } from "./button";
import styles from "./state-block.module.css";

/** Full-block error with an optional retry (FE-INV-1 error state). */
export function ErrorState({
  title,
  body,
  onRetry,
}: {
  title: string;
  body?: string;
  onRetry?: () => void;
}) {
  const t = useT();
  return (
    <div role="alert" className={styles.block}>
      <h2 className={styles.title}>{title}</h2>
      {body ? <p className={styles.body}>{body}</p> : null}
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          {t("Thử lại", "Try again")}
        </Button>
      ) : null}
    </div>
  );
}
