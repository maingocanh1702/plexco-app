"use client";

import { useState } from "react";
import { apiFetch } from "../../lib/api-client";
import { useT } from "../../lib/i18n-client";
import { Button } from "../ui/button";
import { Toast } from "../ui/toast";

/** POST /api/auth/logout with CSRF, then a full navigation to `/` so no client state survives. */
export function SignOutButton({ csrfToken }: { csrfToken: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setBusy(true);
    setFailed(false);
    try {
      await apiFetch("/api/auth/logout", { method: "POST", csrfToken });
      window.location.assign("/");
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="ghost" onClick={() => void signOut()} disabled={busy}>
        {t("Đăng xuất", "Sign out")}
      </Button>
      {failed ? (
        <Toast
          message={t("Không đăng xuất được. Thử lại nhé.", "Could not sign out. Please try again.")}
          onDismiss={() => setFailed(false)}
        />
      ) : null}
    </>
  );
}
