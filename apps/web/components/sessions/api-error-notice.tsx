"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useT } from "../../lib/i18n-client";
import { describeSessionError } from "../../lib/session-error-ui";
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
}: {
  error: unknown;
  /** Refetch the data this screen shows (STALE_VERSION, CSRF_INVALID). */
  onReload?: () => void;
  /** Repeat the failed attempt (network, rate limit, unknown). */
  onRetry?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const view = describeSessionError(error, t);

  useEffect(() => {
    if (view.action === "sign-in") router.replace("/");
  }, [view.action, router]);

  return (
    <div role="alert" className={styles.notice}>
      <p className={styles.message}>{view.message}</p>
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
