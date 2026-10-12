"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { LangProvider, normalizeLang, useT } from "../../lib/i18n-client";
import { SessionProvider, useSessionContext } from "../../lib/use-session";
import { Button } from "../ui/button";
import { ErrorState } from "../ui/error-state";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { ShellFrame } from "./shell-frame";
import styles from "./shell-frame.module.css";

/**
 * Club workspace gate. Membership is decided from GET /api/auth/session (the only place a role
 * lookup is allowed, DD-56 clause 2): a tenant id absent from the caller's list renders ONE
 * 403 state whether the club does not exist or belongs to someone else (no tenant oracle).
 * Until the session resolves the shell is `vi`; afterwards it follows that tenant's locale.
 */
export function AppShell({ tenantId, children }: { tenantId: string; children: ReactNode }) {
  return (
    <SessionProvider>
      <ShellGate tenantId={tenantId}>{children}</ShellGate>
    </SessionProvider>
  );
}

function ShellGate({ tenantId, children }: { tenantId: string; children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const { state, refresh } = useSessionContext();

  useEffect(() => {
    if (state.status === "signed-out") router.replace("/");
  }, [state.status, router]);

  if (state.status === "error") {
    return (
      <main id="main-content" className={styles.centered}>
        <ErrorState
          title={t("Không tải được câu lạc bộ", "Could not load the club")}
          body={t("Kiểm tra kết nối mạng rồi thử lại.", "Check your connection and try again.")}
          onRetry={() => void refresh()}
        />
      </main>
    );
  }
  if (state.status !== "ready") {
    return (
      <main id="main-content" className={styles.centered}>
        <Spinner />
        <Skeleton width="12rem" />
      </main>
    );
  }
  const tenant = state.session.tenants.find((item) => item.tenantId === tenantId);
  if (!tenant) {
    return (
      <main id="main-content" className={styles.centered}>
        <h1>{t("Không có quyền truy cập", "No access")}</h1>
        <p>{t("Bạn không có quyền xem câu lạc bộ này.", "You do not have access to this club.")}</p>
        <Button href="/" variant="secondary">
          {t("Về trang chủ", "Back to home")}
        </Button>
      </main>
    );
  }
  return (
    <LangProvider lang={normalizeLang(tenant.locale)}>
      <ShellFrame session={state.session} tenant={tenant}>
        {children}
      </ShellFrame>
    </LangProvider>
  );
}
