"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { clearStoredLang, readStoredLang } from "../../lib/lang-storage";
import { LangProvider, normalizeLang, useT, type ClientLang } from "../../lib/i18n-client";
import { SessionProvider, useSessionContext } from "../../lib/use-session";
import { OfflineBanner } from "../shell/offline-banner";
import { SignOutButton } from "../shell/sign-out-button";
import { ErrorState } from "../ui/error-state";
import { Skeleton } from "../ui/skeleton";
import { SkipLink } from "../ui/skip-link";
import { Spinner } from "../ui/spinner";
import styles from "./me-frame.module.css";

/**
 * Chrome for the account-scoped /me/* pages (profile, linked channels, Zalo link). The server layout
 * already proved "someone is signed in"; this client gate resolves the session for the CSRF secret
 * and the club list. No tenant is routed here, so the language is the DD-118 pre-tenant default
 * (`vi`) until the last club language remembered on this device (plx-lang) is read after mount.
 *
 * `div#main-content` is the skip-link target and NOT a <main>: each /me page owns its own <main>
 * landmark (M3b's /me/link does), and nesting two would be invalid.
 */
export function MeFrame({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<ClientLang>("vi");
  useEffect(() => setLang(normalizeLang(readStoredLang())), []);
  return (
    <LangProvider lang={lang}>
      <SessionProvider>
        <MeGate>{children}</MeGate>
      </SessionProvider>
    </LangProvider>
  );
}

function MeGate({ children }: { children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const { state, refresh } = useSessionContext();

  useEffect(() => {
    if (state.status === "signed-out") {
      clearStoredLang();
      router.replace(`/?returnTo=${encodeURIComponent(pathname)}`);
    }
  }, [state.status, router, pathname]);

  if (state.status === "error") {
    return (
      <>
        <SkipLink />
        <main id="main-content" className={styles.centered}>
          <ErrorState
            title={t("Không tải được tài khoản", "Could not load your account")}
            body={t("Kiểm tra kết nối mạng rồi thử lại.", "Check your connection and try again.")}
            onRetry={() => void refresh()}
          />
          <SignOutButton csrfToken="" />
        </main>
      </>
    );
  }
  if (state.status !== "ready") {
    return (
      <>
        <SkipLink />
        <main id="main-content" className={styles.centered}>
          <Spinner />
          <Skeleton width="12rem" />
        </main>
      </>
    );
  }

  const { session } = state;
  const firstClub = session.tenants[0];
  const nav = [
    { href: "/me/settings", label: t("Cài đặt", "Settings") },
    { href: "/me/link", label: t("Liên kết Zalo", "Link Zalo") },
    {
      href: firstClub ? `/c/${firstClub.tenantId}` : "/",
      label: t("Về câu lạc bộ", "Back to clubs"),
    },
  ];
  return (
    <div className={styles.frame}>
      <SkipLink />
      <header className={styles.header}>
        <Link href="/me/settings" className={styles.brand}>
          Plexco
        </Link>
        <nav aria-label={t("Tài khoản", "Account")}>
          <ul className={styles.nav}>
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={styles.link}
                  aria-current={pathname === item.href ? "page" : undefined}
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <SignOutButton csrfToken={session.csrfToken} />
            </li>
          </ul>
        </nav>
      </header>
      <OfflineBanner />
      <div id="main-content" tabIndex={-1} className={styles.content}>
        {children}
      </div>
    </div>
  );
}
