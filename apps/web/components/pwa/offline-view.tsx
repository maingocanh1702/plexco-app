"use client";

import { useEffect, useState } from "react";
import { LangProvider, normalizeLang, useT, type ClientLang } from "../../lib/i18n-client";
import { LANG_STORAGE_KEY } from "../shell/shell-frame";
import { Button } from "../ui/button";
import { SkipLink } from "../ui/skip-link";
import styles from "./offline-view.module.css";

function OfflineBody() {
  const t = useT();
  // Back online: reload straight away so the user lands on the real page, not this fallback.
  useEffect(() => {
    const reload = () => window.location.reload();
    window.addEventListener("online", reload);
    return () => window.removeEventListener("online", reload);
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
        <Button onClick={() => window.location.reload()}>{t("Thử lại", "Try again")}</Button>
      </main>
    </>
  );
}

/** Language comes from the last club the user opened (stored by the shell); `vi` otherwise. */
export function OfflineView() {
  const [lang, setLang] = useState<ClientLang>("vi");
  useEffect(() => {
    try {
      setLang(normalizeLang(window.localStorage.getItem(LANG_STORAGE_KEY)));
    } catch {
      // Storage unavailable: stay on the `vi` default.
    }
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
