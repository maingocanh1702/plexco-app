"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useT } from "../../lib/i18n-client";
import { useSession } from "../../lib/use-session";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { ErrorState } from "../ui/error-state";
import { Spinner } from "../ui/spinner";
import { LandingView } from "./landing-view";
import styles from "./workspace-redirect.module.css";

/** Signed-in entry: 0 clubs -> create one, 1 club -> open it, many -> inline chooser. */
export function WorkspaceRedirect() {
  const t = useT();
  const router = useRouter();
  const { state, refresh } = useSession();

  const target =
    state.status === "ready"
      ? state.session.tenants.length === 0
        ? "/onboarding/new-club"
        : state.session.tenants.length === 1
          ? `/c/${state.session.tenants[0]!.tenantId}`
          : null
      : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (state.status === "signed-out") return <LandingView authError={null} />;
  if (state.status === "error") {
    return (
      <main id="main-content" className={styles.page}>
        <ErrorState
          title={t("Không tải được tài khoản", "Could not load your account")}
          body={t("Kiểm tra kết nối mạng rồi thử lại.", "Check your connection and try again.")}
          onRetry={() => void refresh()}
        />
      </main>
    );
  }
  if (state.status === "ready" && !target) {
    return (
      <main id="main-content" className={styles.page}>
        <h1>{t("Chọn câu lạc bộ", "Choose a club")}</h1>
        <ul className={styles.list}>
          {state.session.tenants.map((tenant, index) => (
            <li key={tenant.tenantId}>
              <Card>
                <Button href={`/c/${tenant.tenantId}`} variant="secondary" block>
                  {t(`Câu lạc bộ ${index + 1}`, `Club ${index + 1}`)}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
        <Button href="/onboarding/new-club" variant="ghost">
          {t("Tạo câu lạc bộ mới", "Create a new club")}
        </Button>
      </main>
    );
  }
  return (
    <main id="main-content" className={styles.page}>
      <Spinner />
    </main>
  );
}
