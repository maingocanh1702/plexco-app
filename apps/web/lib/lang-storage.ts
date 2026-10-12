/**
 * Last club language, remembered so the precached /offline page (which has no session) can render
 * in it. A shared-device leak otherwise: it is cleared on sign-out and when the session is seen
 * to be gone. Kept out of the shell modules so /offline does not import the whole shell graph.
 */
export const LANG_STORAGE_KEY = "plx-lang";

export function readStoredLang(): string | null {
  try {
    return window.localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeLang(lang: string): void {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // Storage unavailable (private mode): /offline falls back to `vi`.
  }
}

export function clearStoredLang(): void {
  try {
    window.localStorage.removeItem(LANG_STORAGE_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
