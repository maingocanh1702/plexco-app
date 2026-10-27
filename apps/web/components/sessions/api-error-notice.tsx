"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { useT } from "../../lib/i18n-client";
import { describeSessionError, type ErrorView } from "../../lib/session-error-ui";
import type { TFn } from "../../lib/i18n-client";
import { Button } from "../ui/button";
import styles from "./api-error-notice.module.css";

/**
 * The one place an API failure becomes UI (see lib/session-error-ui.ts for the mapping). Always
 * renders something: a message, the right recovery action, and the requestId when the error was
 * not recognised (fail closed). AUTH_REQUIRED redirects to the landing page.
 */
export function ApiErrorNotice({
  error,
  onReload,
  onRetry,
  describe = describeSessionError,
  autoFocus = false,
  children,
}: {
  error: unknown;
  /** Refetch the data this screen shows (STALE_VERSION, CSRF_INVALID). */
  onReload?: () => void;
  /** Repeat the failed attempt (network, rate limit, unknown). */
  onRetry?: () => void;
  /** Error -> view mapping; settings screens pass their own (it falls back to the session one). */
  describe?: (error: unknown, t: TFn) => ErrorView;
  /** Focus the alert on mount and on each new error. Opt-in: every other mount keeps today's behaviour. */
  autoFocus?: boolean;
  /** Extra detail rendered INSIDE the alert region, so a screen reader announces it with the message. */
  children?: ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const view = describe(error, t);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (view.action === "sign-in") router.replace("/");
  }, [view.action, router]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus, error]);

  return (
    <div ref={ref} role="alert" tabIndex={autoFocus ? -1 : undefined} className={styles.notice}>
      <p className={styles.message}>{view.message}</p>
      {children}
      {!view.known && view.requestId ? (
        <p className={styles.ref}>
          {t("Mã tham chiếu", "Reference")}: <code>{view.requestId}</code>
        </p>
      ) : null}
      {view.action === "reload" && onReload ? (
        <Button variant="secondary" onClick={onReload}>
          {t("Tải lại dữ liệu", "Reload data")}
        </Button>
      ) : null}
      {view.action === "retry" && onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          {t("Thử lại", "Try again")}
        </Button>
      ) : null}
      {view.action === "sign-in" ? (
        <Button href="/" variant="secondary">
          {t("Đăng nhập lại", "Sign in again")}
        </Button>
      ) : null}
    </div>
  );
}
