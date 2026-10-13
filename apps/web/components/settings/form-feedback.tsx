"use client";

import { useEffect, useRef } from "react";
import { describeSettingsError } from "../../lib/settings-error-ui";
import { ApiErrorNotice } from "../sessions/api-error-notice";
import styles from "./settings-layout.module.css";

/**
 * The result region of a settings form. It takes focus every time `focusKey` changes (after a
 * save, a failure or a validation error) so screen-reader and keyboard users land on the outcome
 * instead of being left on a button that may have just become disabled.
 */
export function FormFeedback({
  message,
  error,
  focusKey,
  onReload,
  onRetry,
}: {
  message?: string | null;
  error?: unknown;
  focusKey: number;
  onReload?: () => void;
  onRetry?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusKey > 0) ref.current?.focus();
  }, [focusKey]);
  return (
    <div ref={ref} tabIndex={-1} className={styles.feedback}>
      {error ? (
        <ApiErrorNotice
          error={error}
          describe={describeSettingsError}
          onReload={onReload}
          onRetry={onRetry}
        />
      ) : message ? (
        <p role="status" className={styles.saved}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
