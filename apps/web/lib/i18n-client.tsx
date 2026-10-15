"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Client-side `t(vi, en)` (HR5). Same two-literal shape as the server helper in
 * `@plexco/core/i18n`; that module imports `node:async_hooks` and cannot be bundled for the
 * browser, so Client Components use ONLY this one. Language is a prop-driven context: pre-tenant
 * pages render `vi` (DD-118 bucket b), `/c/[tenantId]` renders the tenant's `locale`.
 */
export type ClientLang = "vi" | "en";

export type TFn = (vi: string, en: string) => string;

const LangContext = createContext<ClientLang>("vi");

/** Unknown values fail closed to `vi`, mirroring the server's resolution. */
export function normalizeLang(raw: string | null | undefined): ClientLang {
  return raw === "en" ? "en" : "vi";
}

export function makeT(lang: ClientLang): TFn {
  return (vi, en) => (lang === "en" ? en : vi);
}

export function LangProvider({ lang, children }: { lang: ClientLang; children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): ClientLang {
  return useContext(LangContext);
}

export function useT(): TFn {
  const lang = useLang();
  return useMemo(() => makeT(lang), [lang]);
}
