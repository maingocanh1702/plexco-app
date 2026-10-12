"use client";

import Link from "next/link";
import { useLang, useT } from "../../lib/i18n-client";
import { formatVnd } from "../../lib/money";
import { formatSessionRange } from "../../lib/session-time";
import type { SessionListItemDto } from "../../lib/sessions-api";
import { SessionStatusBadge } from "./session-status-badge";
import styles from "./session-card.module.css";

/** One row of the host list: sport, time in the SESSION's zone, venue, price, slot cap, status. */
export function SessionListCard({
  session,
  tenantId,
}: {
  session: SessionListItemDto;
  tenantId: string;
}) {
  const t = useT();
  const lang = useLang();
  const slots =
    session.slotsMax === null
      ? t(
          `${session.activeCount} người · không giới hạn chỗ`,
          `${session.activeCount} players · unlimited slots`,
        )
      : t(
          `${session.activeCount}/${session.slotsMax} chỗ`,
          `${session.activeCount}/${session.slotsMax} slots`,
        );
  return (
    <Link href={`/c/${tenantId}/sessions/${session.id}`} className={styles.card}>
      <span className={styles.top}>
        <span className={styles.sport}>{session.sportName}</span>
        <SessionStatusBadge status={session.status} />
      </span>
      <span className={styles.when}>
        {formatSessionRange(session.startsAt, session.endsAt, session.timezone, lang)}
      </span>
      {session.venueName ? <span className={styles.meta}>{session.venueName}</span> : null}
      <span className={styles.meta}>
        <span className={styles.price}>{formatVnd(session.priceAmount, lang)}</span>
        {" · "}
        {slots}
      </span>
    </Link>
  );
}
