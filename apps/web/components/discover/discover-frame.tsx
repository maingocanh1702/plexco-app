"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ApiClientError, CLIENT_NETWORK_ERROR } from "../../lib/api-client";
import { LangProvider, normalizeLang, useT, type ClientLang } from "../../lib/i18n-client";
import { readStoredLang } from "../../lib/lang-storage";
import { Button } from "../ui/button";
import styles from "./discover.module.css";

/**
 * Language source of the /discover pages (P-18): `vi` first (DD-118 pre-tenant), then the club
 * language remembered on this device after mount, as MeFrame does. No session gate: these pages
 * render for an anonymous visitor, so MeFrame's MeGate is never mounted here (RC-6).
 */
export function DiscoverFrame({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<ClientLang>("vi");
  useEffect(() => setLang(normalizeLang(readStoredLang())), []);
  return <LangProvider lang={lang}>{children}</LangProvider>;
}

/** P-16: offline = the browser says so, or the request never reached the server. */
export const isOffline = (error: unknown, online: boolean): boolean =>
  !online || (error instanceof ApiClientError && error.code === CLIENT_NETWORK_ERROR);

/** The in-page offline state: a status notice and Retry. No player data is cached (P-16). */
export function OfflineNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useT();
  return (
    <div role="status" className={styles.offline}>
      {message}
      <Button variant="secondary" onClick={onRetry}>
        {t("Thử lại", "Try again")}
      </Button>
    </div>
  );
}
