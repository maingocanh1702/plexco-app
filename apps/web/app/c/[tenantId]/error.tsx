"use client";

import { useT } from "../../../lib/i18n-client";
import { ErrorState } from "../../../components/ui/error-state";

/**
 * Club-route error boundary. It renders INSIDE the layout's ShellFrame, so the LangProvider
 * context (tenant locale), SkipLink and `main#main-content` already surround it; adding them
 * here would duplicate the landmark and the skip target id.
 */
export default function ClubRouteError({ reset }: { error: Error; reset: () => void }) {
  const t = useT();
  return (
    <ErrorState
      as="h1"
      title={t("Đã có lỗi xảy ra", "Something went wrong")}
      body={t("Vui lòng thử lại sau ít phút.", "Please try again in a moment.")}
      onRetry={reset}
    />
  );
}
