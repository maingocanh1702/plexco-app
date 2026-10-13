"use client";

import { useT } from "../lib/i18n-client";
import { ErrorState } from "../components/ui/error-state";

/** Route-level error boundary: translated message + retry instead of the default English page. */
export default function RouteError({ reset }: { error: Error; reset: () => void }) {
  const t = useT();
  return (
    <main id="main-content">
      <ErrorState
        title={t("Đã có lỗi xảy ra", "Something went wrong")}
        body={t("Vui lòng thử lại sau ít phút.", "Please try again in a moment.")}
        onRetry={reset}
      />
    </main>
  );
}
