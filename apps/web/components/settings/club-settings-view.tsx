"use client";

import { getClubConfig } from "../../lib/club-settings-client";
import { useT } from "../../lib/i18n-client";
import { describeSettingsError, isForbidden } from "../../lib/settings-error-ui";
import { listSports } from "../../lib/sessions-api";
import { useSessionContext } from "../../lib/use-session";
import { useLoadable } from "../../lib/use-sessions-data";
import { ApiErrorNotice } from "../sessions/api-error-notice";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { EmptyState } from "../ui/empty-state";
import { Skeleton } from "../ui/skeleton";
import { ClubDefaultsForm } from "./club-defaults-form";
import { ClubProfileForm } from "./club-profile-form";
import { ZaloConnectCard } from "./zalo-connect-card";
import styles from "./settings-layout.module.css";

/**
 * /c/[tenantId]/settings. Everything goes through the existing /api/onboarding/* routes, which
 * enforce authorize(content.manage) (Zalo: connector.secret_manage). A 403 is ONE uniform
 * "not permitted" state, never a hint about why. Saving the club form refetches the session so the
 * shell's club name and language (tenants.locale, DD-118) update without a reload.
 */
export function ClubSettingsView({ tenantId }: { tenantId: string }) {
  const t = useT();
  const { session, refresh: refreshSession } = useSessionContext();
  const csrfToken = session?.csrfToken ?? "";
  const { state, reload, refresh } = useLoadable(
    async (signal) => {
      const [club, sports] = await Promise.all([
        getClubConfig(tenantId, signal),
        listSports(signal),
      ]);
      return { club, sports };
    },
    [tenantId],
  );

  const title = t("Cài đặt câu lạc bộ", "Club settings");
  if (state.status === "loading") {
    return (
      <div aria-busy="true" className={styles.page}>
        <h1 className="sr-only">{title}</h1>
        <Skeleton width="50%" height="var(--space-8)" />
        <Skeleton height="var(--space-12)" />
        <Skeleton height="var(--space-12)" />
      </div>
    );
  }
  if (state.status === "error") {
    if (isForbidden(state.error)) {
      return (
        <EmptyState
          title={t("Không có quyền", "Not permitted")}
          body={t(
            "Bạn không có quyền thay đổi cài đặt của câu lạc bộ này.",
            "You are not allowed to change this club's settings.",
          )}
          action={
            <Button href={`/c/${tenantId}`} variant="secondary">
              {t("Về trang chủ", "Back to home")}
            </Button>
          }
        />
      );
    }
    return (
      <div className={styles.page}>
        <h1>{title}</h1>
        <ApiErrorNotice
          error={state.error}
          describe={describeSettingsError}
          onRetry={reload}
          onReload={reload}
        />
      </div>
    );
  }

  const { club, sports } = state.data;
  const savedProfile = () => {
    refresh();
    void refreshSession(); // club name + language in the shell header / LangProvider
  };
  return (
    <div className={styles.page}>
      <h1>{title}</h1>
      <Card>
        <section className={styles.section} aria-labelledby="club-profile">
          <h2 id="club-profile">{t("Câu lạc bộ", "Club")}</h2>
          <ClubProfileForm
            tenantId={tenantId}
            csrfToken={csrfToken}
            club={club}
            onSaved={savedProfile}
          />
        </section>
      </Card>
      <Card>
        <section className={styles.section} aria-labelledby="club-defaults">
          <h2 id="club-defaults">{t("Mặc định buổi chơi", "Session defaults")}</h2>
          <ClubDefaultsForm
            tenantId={tenantId}
            csrfToken={csrfToken}
            club={club}
            sports={sports}
            onSaved={refresh}
          />
        </section>
      </Card>
      <Card>
        <section className={styles.section} aria-labelledby="club-zalo">
          <h2 id="club-zalo">{t("Bot Zalo", "Zalo bot")}</h2>
          <ZaloConnectCard tenantId={tenantId} csrfToken={csrfToken} />
        </section>
      </Card>
    </div>
  );
}
