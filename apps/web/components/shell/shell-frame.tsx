"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { useT, useLang } from "../../lib/i18n-client";
import type { SessionDto, SessionTenantDto } from "../../lib/session-dto";
import { SkipLink } from "../ui/skip-link";
import { OfflineBanner } from "./offline-banner";
import { ShellNav } from "./shell-nav";
import { SignOutButton } from "./sign-out-button";
import { TenantSwitcher } from "./tenant-switcher";
import styles from "./shell-frame.module.css";

/** Remembered for the offline fallback page, which has no session to read a language from. */
export const LANG_STORAGE_KEY = "plx-lang";

/** The authenticated club chrome: header, responsive nav, offline banner, main landmark. */
export function ShellFrame({
  session,
  tenant,
  children,
}: {
  session: SessionDto;
  tenant: SessionTenantDto;
  children: ReactNode;
}) {
  const t = useT();
  const lang = useLang();

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      // Storage can be unavailable (private mode); the offline page then falls back to `vi`.
    }
  }, [lang]);

  return (
    <div className={styles.frame}>
      <SkipLink />
      <header className={styles.header}>
        <div className={styles.brand}>
          <Link href={`/c/${tenant.tenantId}`}>Plexco</Link>
        </div>
        <div className={styles.actions}>
          <TenantSwitcher tenants={session.tenants} currentId={tenant.tenantId} />
          <SignOutButton csrfToken={session.csrfToken} />
        </div>
      </header>
      <OfflineBanner />
      <div className={styles.body}>
        <ShellNav tenantId={tenant.tenantId} />
        <main id="main-content" className={styles.main} aria-label={t("Nội dung", "Content")}>
          {children}
        </main>
      </div>
    </div>
  );
}
