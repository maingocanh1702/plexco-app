"use client";

import { useLang, useT } from "../../lib/i18n-client";
import { getMyProfile, listMyChannels } from "../../lib/me-settings-client";
import { describeSettingsError } from "../../lib/settings-error-ui";
import { useSessionContext } from "../../lib/use-session";
import { useLoadable } from "../../lib/use-sessions-data";
import { Card } from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import { ApiErrorNotice } from "../sessions/api-error-notice";
import { SettingsChannelsList } from "./settings-channels-list";
import { SettingsProfileForm } from "./settings-profile-form";
import styles from "../settings/settings-layout.module.css";

/**
 * /me/settings: minimal profile (display name), linked channels with unlink, and two read-only
 * sections. UI language is NOT a personal setting: DD-118 makes the club's `tenants.locale` the only
 * language source, so there is no member-level switch to build; the section says where it comes from.
 * Reminder preferences are deferred (OD-6) and the MVP sends no automatic reminders (OD-0), so that
 * section only says so.
 */
export function SettingsView() {
  const t = useT();
  const lang = useLang();
  const { session } = useSessionContext();
  const csrfToken = session?.csrfToken ?? "";
  const { state, reload, refresh } = useLoadable(async (signal) => {
    const [profile, channels] = await Promise.all([getMyProfile(signal), listMyChannels(signal)]);
    return { profile, channels };
  }, []);

  if (state.status === "loading") {
    return (
      <main aria-busy="true" className={styles.page}>
        <h1 className="sr-only">{t("Cài đặt tài khoản", "Account settings")}</h1>
        <Skeleton width="50%" height="var(--space-8)" />
        <Skeleton height="var(--space-12)" />
        <Skeleton height="var(--space-12)" />
      </main>
    );
  }
  if (state.status === "error") {
    return (
      <main className={styles.page}>
        <h1>{t("Cài đặt tài khoản", "Account settings")}</h1>
        <ApiErrorNotice
          error={state.error}
          describe={describeSettingsError}
          onRetry={reload}
          onReload={reload}
        />
      </main>
    );
  }

  const { profile, channels } = state.data;
  return (
    <main className={styles.page}>
      <h1>{t("Cài đặt tài khoản", "Account settings")}</h1>
      <Card>
        <section className={styles.section} aria-labelledby="me-profile">
          <h2 id="me-profile">{t("Hồ sơ", "Profile")}</h2>
          <SettingsProfileForm initial={profile} csrfToken={csrfToken} onSaved={refresh} />
        </section>
      </Card>
      <Card>
        <section className={styles.section} aria-labelledby="me-channels">
          <h2 id="me-channels">{t("Kênh đã liên kết", "Linked channels")}</h2>
          <SettingsChannelsList channels={channels} csrfToken={csrfToken} onChanged={refresh} />
        </section>
      </Card>
      <Card>
        <section className={styles.section} aria-labelledby="me-language">
          <h2 id="me-language">{t("Ngôn ngữ giao diện", "Interface language")}</h2>
          <p>{lang === "en" ? "English" : "Tiếng Việt"}</p>
          <p className={styles.caption}>
            {t(
              "Ngôn ngữ do câu lạc bộ quyết định (chủ CLB chọn trong Cài đặt CLB), không phải cài đặt cá nhân.",
              "The language is set by your club (the owner picks it in club settings); it is not a personal setting.",
            )}
          </p>
        </section>
      </Card>
      <Card>
        <section className={styles.section} aria-labelledby="me-reminders">
          <h2 id="me-reminders">{t("Nhắc nợ", "Payment reminders")}</h2>
          <p className={styles.caption}>
            {t(
              "Plexco chưa gửi nhắc nợ tự động, nên ở đây chưa có gì để cài đặt.",
              "Plexco does not send automatic payment reminders yet, so there is nothing to set here.",
            )}
          </p>
        </section>
      </Card>
    </main>
  );
}
