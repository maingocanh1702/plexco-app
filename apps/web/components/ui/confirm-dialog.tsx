"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { useT } from "../../lib/i18n-client";
import { Button } from "./button";
import styles from "./confirm-dialog.module.css";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  /** Rendered inside the dialog (role=alert) when the command failed. */
  error?: ReactNode;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal confirm built on the native <dialog>: showModal() supplies the focus trap, inert
 * background, Escape handling and focus return to the opener. Presented as a bottom sheet at
 * <=768px and a centred modal above (CSS). While a command is in flight Escape/backdrop are
 * ignored so a half-sent mutation cannot be "cancelled" from the UI.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  error,
  busy,
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault(); // parent owns `open`; never let the browser close it behind React
        if (!busy) onCancel();
      }}
      onKeyDown={(event) => {
        // Native modals let Tab escape to the browser chrome; keep it cycling inside the sheet.
        if (event.key !== "Tab") return;
        const focusable = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
          ),
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onClick={(event) => {
        if (event.target === ref.current && !busy) onCancel();
      }}
    >
      <div className={styles.panel}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <div className={styles.body}>{body}</div>
        {error ?? null}
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {t("Quay lại", "Go back")}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy ? true : undefined}
          >
            {busy ? t("Đang xử lý…", "Working…") : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
