"use client";

import "./globals.css";
import { makeT } from "../lib/i18n-client";
import { ErrorState } from "../components/ui/error-state";

/** Last-resort boundary (replaces the root layout, so it brings its own <html>/<body>). */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  // No provider exists above the root layout: vi default, same two-literal shape (HR5).
  const t = makeT("vi");
  return (
    <html lang="vi">
      <body>
        <main id="main-content">
          <ErrorState
            title={t("Đã có lỗi xảy ra", "Something went wrong")}
            body={t("Vui lòng thử lại sau ít phút.", "Please try again in a moment.")}
            onRetry={reset}
          />
        </main>
      </body>
    </html>
  );
}
