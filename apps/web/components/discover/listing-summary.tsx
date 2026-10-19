"use client";

import type { DiscoveryListing } from "../../lib/discover-api";
import { useLang, useT, type TFn } from "../../lib/i18n-client";
import { formatVnd } from "../../lib/money";
import { formatSessionRange } from "../../lib/session-time";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";
import styles from "./discover.module.css";

/** Seeded sport keys (0011_seeds.sql) and their labels; any other key gets the neutral label. */
const SPORTS = new Map<string, [string, string]>([
  ["badminton", ["Cầu lông", "Badminton"]],
  ["pickleball", ["Pickleball", "Pickleball"]],
  ["tennis", ["Tennis", "Tennis"]],
  ["football", ["Bóng đá", "Football"]],
  ["volleyball", ["Bóng chuyền", "Volleyball"]],
  ["basketball", ["Bóng rổ", "Basketball"]],
]);

export function sportLabel(key: string, t: TFn): string {
  const pair = SPORTS.get(key);
  return pair ? t(pair[0], pair[1]) : t("Buổi chơi", "Session");
}

/**
 * The D-1 and D-2 fields of one listing and nothing else: no venue, no gender, no ids (P-4 to
 * P-10). A missing price or slot count renders no line, never a made-up 0.
 */
export function ListingSummary({
  listing,
  as: Heading = "h2",
}: {
  listing: DiscoveryListing;
  as?: "h1" | "h2";
}) {
  const t = useT();
  const lang = useLang();
  const sport = sportLabel(listing.sportKey, t);
  // The discovery DTO has no time zone (O-4): times show in the viewer's zone, none is hardcoded.
  const timesValid = [listing.startsAt, listing.endsAt].every(
    (iso) => !Number.isNaN(Date.parse(iso)),
  );
  const when = timesValid
    ? formatSessionRange(
        listing.startsAt,
        listing.endsAt,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        lang,
      )
    : null;
  const hint =
    listing.joinPolicy === "open"
      ? t("Vào ngay", "Instant join")
      : listing.joinPolicy === "approval"
        ? t("Chủ buổi duyệt", "Host approval")
        : null;
  return (
    <div className={styles.summary}>
      <Heading className={styles.title}>{listing.title ?? sport}</Heading>
      {when ? <p className={styles.meta}>{when}</p> : null}
      {listing.area ? <p className={styles.meta}>{listing.area}</p> : null}
      {listing.clubDisplayName ? <p className={styles.meta}>{listing.clubDisplayName}</p> : null}
      <div className={styles.facts}>
        {listing.title ? <Badge>{sport}</Badge> : null}
        {listing.priceAmount === null ? null : <Badge>{formatVnd(listing.priceAmount)}</Badge>}
        {listing.slotsOpen === null ? null : (
          <Badge>{t(`Còn ${listing.slotsOpen} chỗ`, `${listing.slotsOpen} spots open`)}</Badge>
        )}
        {hint ? <Badge>{hint}</Badge> : null}
      </div>
    </div>
  );
}

/** One placeholder card; the list shows three, the detail one. */
export function ListingSkeleton() {
  return (
    <div className={styles.skeletonCard}>
      <Skeleton width="40%" height="var(--space-5)" />
      <Skeleton width="70%" />
      <Skeleton width="55%" />
    </div>
  );
}
