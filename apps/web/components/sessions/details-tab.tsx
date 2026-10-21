"use client";

import { useLang, useT } from "../../lib/i18n-client";
import { formatVnd } from "../../lib/money";
import { formatTimestamp } from "../../lib/session-time";
import type { SessionDetailDto } from "../../lib/sessions-api";
import styles from "./session-detail-view.module.css";

/** Static facts of the session (everything the edit form can change, plus audit timestamps). */
export function DetailsTab({ session }: { session: SessionDetailDto }) {
  const t = useT();
  const lang = useLang();
  const dash = "—";
  const rows: [string, string][] = [
    [t("Môn", "Sport"), session.sportName],
    [t("Địa điểm", "Venue"), session.venueName ?? dash],
    [t("Địa chỉ", "Address"), session.venueAddress ?? dash],
    [
      t("Ẩn địa chỉ chính xác đến khi xác nhận", "Hide exact address until confirmed"),
      session.hideExactAddress ? t("Bật", "On") : t("Tắt", "Off"),
    ],
    [t("Khu vực", "Area"), session.area ?? dash],
    [t("Giá mỗi người", "Price per player"), formatVnd(session.priceAmount)],
    [
      t("Số chỗ", "Slots"),
      session.slotsMax === null ? t("Không giới hạn", "Unlimited") : String(session.slotsMax),
    ],
    [
      t("Hiển thị", "Visibility"),
      session.visibility === "public" ? t("Công khai", "Public") : t("Riêng tư", "Private"),
    ],
    [
      t("Cách tham gia", "Join policy"),
      session.joinPolicy === "approval"
        ? t("Cần duyệt", "Needs approval")
        : t("Tự do tham gia", "Open to join"),
    ],
    [t("Múi giờ", "Time zone"), session.timezone],
    [t("Tạo lúc", "Created"), formatTimestamp(session.createdAt, session.timezone, lang)],
    [t("Cập nhật lúc", "Updated"), formatTimestamp(session.updatedAt, session.timezone, lang)],
  ];
  return (
    <dl className={styles.facts}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
