"use client";

import { useEffect, useRef } from "react";
import { describeSettingsError } from "../../lib/settings-error-ui";
import { ApiErrorNotice } from "../sessions/api-error-notice";
import styles from "./settings-layout.module.css";

/**
 * The result region of a settings form. It takes focus every time `focusKey` changes (after a
 * save, a failure or a validation error) so screen-reader and keyboard users land on the outcome
 * instead of being left on a button that may have just become disabled.
 *
 * The `role="status"` paragraph is ALWAYS mounted (visually hidden while there is nothing to say):
 * a live region announces reliably only when it already exists before its text changes, so a
 * message that appears together with a brand-new region could go unannounced. A failure renders
 * ApiErrorNotice (role="alert") instead. `tone="warning"` is for an outcome that is not a success
 * even though the request itself succeeded (a Zalo connect answered 200 with status "error").
 */
export function FormFeedback({
  message,
  tone = "success",
  error,
  focusKey,
  onReload,
  onRetry,
}: {
  message?: string | null;
  tone?: "success" | "warning";
  error?: unknown;
  focusKey: number;
  onReload?: () => void;
  onRetry?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusKey > 0) ref.current?.focus();
  }, [focusKey]);
  const note = error ? null : (message ?? null);
  return (
    <div ref={ref} tabIndex={-1} className={error || note ? styles.feedback : "sr-only"}>
      {error ? (
        <ApiErrorNotice
          error={error}
          describe={describeSettingsError}
          onReload={onReload}
          onRetry={onRetry}
        />
      ) : null}
      <p
        role="status"
        className={note ? (tone === "warning" ? styles.warning : styles.saved) : undefined}
      >
        {note}
      </p>
    </div>
  );
}
