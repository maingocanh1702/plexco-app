"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { useT, useLang } from "../../lib/i18n-client";
import { storeLang } from "../../lib/lang-storage";
import type { SessionDto, SessionTenantDto } from "../../lib/session-dto";
import { SkipLink } from "../ui/skip-link";
import { OfflineBanner } from "./offline-banner";
import { ShellNav } from "./shell-nav";
import { SignOutButton } from "./sign-out-button";
import { TenantSwitcher } from "./tenant-switcher";
import styles from "./shell-frame.module.css";

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
    const previous = document.documentElement.lang;
    document.documentElement.lang = lang;
    storeLang(lang);
    return () => {
      document.documentElement.lang = previous;
    };
  }, [lang]);

  return (
    <div className={styles.frame}>
      <SkipLink />
      <header className={styles.header}>
        <div className={styles.brand}>
          <Link href={`/c/${tenant.tenantId}`}>Plexco</Link>
          <span className={styles.club}>{tenant.name ?? t("CLB của bạn", "Your club")}</span>
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
