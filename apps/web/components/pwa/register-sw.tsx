"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js in production only (a dev server's HMR assets must never be cached).
 * Failure is non-fatal: the app is fully usable online without the worker, so the error is
 * logged and swallowed rather than surfaced to the user.
 */
export function RegisterSw() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error: unknown) => {
      console.error("service worker registration failed", error);
    });
  }, []);
  return null;
}
