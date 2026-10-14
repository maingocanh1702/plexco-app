"use client";

import { useEffect } from "react";
import { authErrorMessage } from "../../lib/auth-error-message";
import { useT } from "../../lib/i18n-client";
import { clearSessionSnapshots } from "../../lib/session-snapshot";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { InlineError } from "../ui/inline-error";
import { SkipLink } from "../ui/skip-link";
import styles from "./landing-view.module.css";

/**
 * Signed-out landing. The Google button is a plain top-level navigation (<a>), never fetch:
 * the OAuth redirect and the SameSite cookies depend on it (see api/auth/google/state).
 */
export function LandingView({ authError }: { authError: string | null }) {
  const t = useT();
  const error = authErrorMessage(authError, t);
  // Signed-out surface: an expired cookie lands here via a server redirect (no API call to notice
  // it), so wipe the offline session-list snapshots here too.
  useEffect(() => clearSessionSnapshots(), []);
  return (
    <>
      <SkipLink />
      <main id="main-content" className={styles.page}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            P
          </span>
          Plexco
        </div>
        <section className={styles.hero} aria-labelledby="landing-title">
          <h1 id="landing-title" className={styles.title}>
            {t("Quản lý câu lạc bộ thể thao dễ dàng", "Run your sports club with ease")}
          </h1>
          <p className={styles.lead}>
            {t(
              "Tạo buổi chơi, theo dõi người tham gia và thu tiền ở một nơi.",
              "Create sessions, track players and collect payments in one place.",
            )}
          </p>
        </section>
        <Card className={styles.card}>
          <h2>{t("Đăng nhập", "Sign in")}</h2>
          {error ? <InlineError>{error}</InlineError> : null}
          <Button href="/api/auth/google/state" block>
            {t("Tiếp tục với Google", "Continue with Google")}
          </Button>
          <p className={styles.fine}>
            {t(
              "Chúng tôi chỉ dùng tài khoản Google để xác minh bạn là ai.",
              "We only use your Google account to verify who you are.",
            )}
          </p>
        </Card>
      </main>
    </>
  );
}
