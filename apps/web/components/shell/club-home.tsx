"use client";

import { useT } from "../../lib/i18n-client";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import styles from "./club-home.module.css";

/** Club home: greeting + quick actions. M2 adds the live session/roster summary. */
export function ClubHome({ tenantId }: { tenantId: string }) {
  const t = useT();
  const base = `/c/${tenantId}`;
  return (
    <div className={styles.home}>
      <div>
        <h1>{t("Chào mừng bạn!", "Welcome!")}</h1>
        <p className={styles.lead}>
          {t(
            "Câu lạc bộ của bạn đã sẵn sàng. Bắt đầu từ đây.",
            "Your club is ready. Start from here.",
          )}
        </p>
      </div>
      <div className={styles.actions}>
        <Card>
          <h2>{t("Buổi chơi", "Sessions")}</h2>
          <p className={styles.lead}>
            {t("Xem và tạo các buổi chơi của câu lạc bộ.", "View and create your club's sessions.")}
          </p>
          <div className={styles.row}>
            <Button href={`${base}/sessions`}>{t("Mở buổi chơi", "Open sessions")}</Button>
            <Button href={`${base}/sessions/new`} variant="secondary">
              {t("+ Tạo buổi mới", "+ New session")}
            </Button>
          </div>
        </Card>
        <Card>
          <h2>{t("Cài đặt", "Settings")}</h2>
          <p className={styles.lead}>
            {t("Thiết lập thông tin câu lạc bộ.", "Set up your club's details.")}
          </p>
          <Button href={`${base}/settings`} variant="secondary">
            {t("Mở cài đặt", "Open settings")}
          </Button>
        </Card>
      </div>
    </div>
  );
}
