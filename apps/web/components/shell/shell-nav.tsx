"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "../../lib/i18n-client";
import { CalendarIcon, HomeIcon, SettingsIcon } from "./nav-icons";
import styles from "./shell-nav.module.css";

/** Bottom nav (<768), icon rail (768-1023), sidebar (>=1024): one list, three presentations. */
export function ShellNav({ tenantId }: { tenantId: string }) {
  const t = useT();
  const pathname = usePathname();
  const base = `/c/${tenantId}`;
  const items = [
    { href: base, label: t("Trang chủ", "Home"), icon: <HomeIcon />, exact: true },
    { href: `${base}/sessions`, label: t("Buổi chơi", "Sessions"), icon: <CalendarIcon /> },
    { href: `${base}/settings`, label: t("Cài đặt", "Settings"), icon: <SettingsIcon /> },
  ];
  return (
    <nav className={styles.nav} aria-label={t("Điều hướng chính", "Main navigation")}>
      <ul className={styles.list}>
        {items.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={styles.link}
                aria-current={active ? "page" : undefined}
              >
                {item.icon}
                <span className={styles.label}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
