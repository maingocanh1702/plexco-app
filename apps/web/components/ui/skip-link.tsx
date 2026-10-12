"use client";

import { useT } from "../../lib/i18n-client";

/** First focusable element on every page; targets <main id="main-content">. */
export function SkipLink() {
  const t = useT();
  return (
    <a className="skip-link" href="#main-content">
      {t("Bỏ qua tới nội dung chính", "Skip to main content")}
    </a>
  );
}
