"use client";

import { useLang, useT } from "../../lib/i18n-client";
import { formatVnd } from "../../lib/money";
import type { SessionDetailDto } from "../../lib/sessions-api";
import { Badge, type BadgeTone } from "../ui/badge";
import { EmptyState } from "../ui/empty-state";
import styles from "./session-detail-view.module.css";

/** Read-only roster (adding players / mark-paid is lane M2c-fe): players, charges, guest notes, counts. */
export function RosterTab({ session }: { session: SessionDetailDto }) {
  const t = useT();
  const lang = useLang();
  const { counts } = session;
  // Server-computed occupancy is the only capacity formula (BL-DSC-1): no client-side sum.
  const free = session.slotsMax === null ? null : Math.max(0, session.slotsMax - counts.occupied);

  const playerBadge = (p: SessionDetailDto["players"][number]): [BadgeTone, string] => {
    if (p.status === "active") return ["success", t("Đang tham gia", "Active")];
    if (p.status === "waitlisted") {
      return [
        "warning",
        p.waitlistPosition
          ? t(`Chờ #${p.waitlistPosition}`, `Waitlist #${p.waitlistPosition}`)
          : t("Danh sách chờ", "Waitlisted"),
      ];
    }
    if (p.status === "left") return ["neutral", t("Đã rời", "Left")];
    return ["neutral", p.status];
  };
  const chargeBadge = (status: string): [BadgeTone, string] => {
    if (status === "paid") return ["success", t("Đã thanh toán", "Paid")];
    if (status === "partial") return ["warning", t("Trả một phần", "Partly paid")];
    if (status === "open") return ["error", t("Chưa thanh toán", "Unpaid")];
    if (status === "void") return ["neutral", t("Đã huỷ khoản thu", "Void")];
    return ["neutral", status];
  };

  return (
    <div className={styles.roster}>
      <dl className={styles.counts}>
        <div>
          <dt>{t("Đang tham gia", "Active")}</dt>
          <dd>
            {session.slotsMax === null ? counts.active : `${counts.active}/${session.slotsMax}`}
          </dd>
        </div>
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

      <section aria-labelledby="roster-players">
        <h2 id="roster-players" className={styles.sectionTitle}>
          {t("Người chơi", "Players")}
        </h2>
        {session.players.length === 0 ? (
          <EmptyState
            title={t("Chưa có người chơi", "No players yet")}
            body={t("Người chơi đã tham gia sẽ hiện ở đây.", "Players who join will show up here.")}
          />
        ) : (
          <ul className={styles.playerList}>
            {session.players.map((p) => {
              const [tone, label] = playerBadge(p);
              return (
                <li key={p.id} className={styles.player}>
                  <span className={styles.playerName}>
                    {p.displayName ?? t("(chưa đặt tên)", "(unnamed)")}
                  </span>
                  <Badge tone={tone}>{label}</Badge>
                  {p.charge ? (
                    <span className={styles.charge}>
                      <span className={styles.money}>
                        {formatVnd(p.charge.amountAllocated, lang)} /{" "}
                        {formatVnd(p.charge.amountDue, lang)}
                      </span>
                      <Badge tone={chargeBadge(p.charge.status)[0]}>
                        {chargeBadge(p.charge.status)[1]}
                      </Badge>
                    </span>
                  ) : (
                    <span
                      className={styles.charge}
                      aria-label={t("Chưa có khoản thu", "No charge")}
                    >
                      —
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {session.guestNotes.length > 0 ? (
        <section aria-labelledby="roster-guests">
          <h2 id="roster-guests" className={styles.sectionTitle}>
            {t("Ghi chú khách", "Guest notes")}
          </h2>
          <ul className={styles.playerList}>
            {session.guestNotes.map((g) => (
              <li key={g.id} className={styles.player}>
                <span className={styles.playerName}>{g.guestName}</span>
                {g.note ? <span className={styles.note}>{g.note}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
