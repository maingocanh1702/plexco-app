"use client";

import { useT } from "../../lib/i18n-client";
import type { SessionDetailDto } from "../../lib/sessions-api";
import styles from "./session-detail-view.module.css";

/** Server-computed occupancy is the only capacity formula (BL-DSC-1): no client-side sum. */
export function RosterCounts({ session }: { session: SessionDetailDto }) {
  const t = useT();
  const { counts } = session;
  const free = counts.slotsOpen;
  return (
    <dl className={styles.counts}>
      <div>
        <dt>{t("Đang tham gia", "Active")}</dt>
        <dd>{counts.active}</dd>
      </div>
      {session.slotsMax === null ? null : (
        <div>
          <dt>{t("Đã có chỗ", "Occupied")}</dt>
          <dd>{`${counts.occupied}/${session.slotsMax}`}</dd>
        </div>
      )}
      <div>
        <dt>{t("Chỗ trống", "Free slots")}</dt>
        <dd>{free === null ? t("Không giới hạn", "Unlimited") : free}</dd>
      </div>
      <div>
        <dt>{t("Danh sách chờ", "Waitlist")}</dt>
        <dd>{counts.waitlisted}</dd>
      </div>
      <div>
        <dt>{t("Khách", "Guests")}</dt>
        <dd>{counts.guestNotes}</dd>
      </div>
    </dl>
  );
}
