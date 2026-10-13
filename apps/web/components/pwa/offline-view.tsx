"use client";

import { useEffect, useRef, useState } from "react";
import { LangProvider, normalizeLang, useT, type ClientLang } from "../../lib/i18n-client";
import { readStoredLang } from "../../lib/lang-storage";
import { Button } from "../ui/button";
import { SkipLink } from "../ui/skip-link";
import styles from "./offline-view.module.css";

/** Path to return to; /offline itself (a direct visit) recovers to the home page. */
export function recoveryTarget(location: Pick<Location, "pathname" | "search" | "hash">): string {
  if (location.pathname === "/offline") return "/";
  return location.pathname + location.search + location.hash;
}

/** Same-origin path only: exactly one leading "/" ("//" and "/\\" are protocol-relative). */
export function safeReturnTo(candidate: unknown): string {
  return typeof candidate === "string" && /^\/(?![/\\])/.test(candidate) ? candidate : "/";
}

function OfflineBody() {
  const t = useT();
  // The service worker answers a failed navigation to /c/<id> with this page, and Next then
  // rewrites the address bar (measured: before React renders this component). The inline script in
  // app/offline/page.tsx records the REQUESTED URL while the document is still parsing; the
  // location read below is only the fallback if that script did not run (e.g. a nonce CSP).
  const target = useRef<string | null>(null);
  if (target.current === null) {
    target.current =
      typeof window === "undefined"
        ? "/"
        : safeReturnTo(
            (window as { __plxReturnTo?: unknown }).__plxReturnTo ??
              recoveryTarget(window.location),
          );
  }
  const retry = () => window.location.replace(target.current ?? "/");
  // Back online: return to the requested page straight away.
  useEffect(() => {
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);
  return (
    <>
      <SkipLink />
      <main id="main-content" className={styles.page}>
        <div className={styles.mark} aria-hidden="true">
          P
        </div>
        <h1>{t("Bạn đang offline", "You are offline")}</h1>
        <p className={styles.body}>
          {t(
            "Plexco cần mạng để tải dữ liệu mới. Kiểm tra kết nối rồi thử lại.",
            "Plexco needs a connection to load fresh data. Check your connection and try again.",
          )}
        </p>
        <Button onClick={retry}>{t("Thử lại", "Try again")}</Button>
      </main>
    </>
  );
}

/** Language comes from the last club the user opened (stored by the shell); `vi` otherwise. */
export function OfflineView() {
  const [lang, setLang] = useState<ClientLang>("vi");
  useEffect(() => {
    setLang(normalizeLang(readStoredLang()));
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return (
    <LangProvider lang={lang}>
      <OfflineBody />
    </LangProvider>
  );
}
