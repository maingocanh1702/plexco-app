import { getLang, t } from "@plexco/core/i18n";

/**
 * Zalo DM copy (readiness 3.10, Z-13; default applied, pending owner sign-off). Every string is
 * t(vi, en) (HARD RULE 5): call renderZaloDm inside runWithLang(tenant locale) (DD-118). No
 * venue, address, price, roster or name ever goes into a DM: the announce text is meant to be
 * forwarded and venue_name is private until join (DD-06).
 */
export type ZaloDmTemplate = "updated" | "cancelled" | "announce";

/** Event type -> template (Z-11). L8 adds player.promoted here together with its own route row. */
export const ZALO_DM_TEMPLATES: ReadonlyMap<string, ZaloDmTemplate> = new Map([
  ["session.updated", "updated"],
  ["session.cancelled", "cancelled"],
  ["session.announcement_requested", "announce"],
]);

/** session.updated fields that warrant a DM, grouped under one label each, in this order. */
const FIELD_GROUPS: readonly [readonly string[], () => string][] = [
  [["starts_at", "ends_at", "timezone"], () => t("giờ", "time")],
  [["venue_name", "venue_address"], () => t("địa điểm", "venue")],
  [["price_amount"], () => t("giá", "price")],
];
export const DM_RELEVANT_FIELDS: ReadonlySet<string> = new Set(FIELD_GROUPS.flatMap(([f]) => f));

export interface ZaloDmValues {
  startsAt: Date;
  timeZone: string;
  /** session.updated changed_fields (only the relevant ones are labelled). */
  fields: readonly string[];
  link: string;
}

/** starts_at in the session's own time zone, short date and time; never throws ("" if invalid). */
function formatStart(startsAt: Date, timeZone: string): string {
  const locale = getLang() === "en" ? "en-GB" : "vi-VN";
  const style = { dateStyle: "short", timeStyle: "short" } as const;
  try {
    return new Intl.DateTimeFormat(locale, { ...style, timeZone }).format(startsAt);
  } catch {
    try {
      return new Intl.DateTimeFormat(locale, { ...style, timeZone: "Asia/Ho_Chi_Minh" }).format(
        startsAt,
      );
    } catch {
      return Number.isNaN(startsAt.getTime()) ? "" : startsAt.toISOString();
    }
  }
}

const fill = (text: string, values: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);

export function renderZaloDm(template: ZaloDmTemplate, v: ZaloDmValues): string {
  const start = formatStart(v.startsAt, v.timeZone);
  if (template === "cancelled")
    return fill(
      t(
        "Buổi chơi lúc {start} đã bị huỷ. Xem: {link}",
        "The session at {start} was cancelled. See: {link}",
      ),
      { start, link: v.link },
    );
  if (template === "announce") {
    const text = fill(
      t("Mời tham gia buổi chơi lúc {start}: {link}", "Join the session at {start}: {link}"),
      { start, link: v.link },
    );
    return fill(t("Tin mời để chuyển tiếp:\n{text}", "Ready to forward:\n{text}"), { text });
  }
  const fields = FIELD_GROUPS.filter(([group]) => group.some((f) => v.fields.includes(f)))
    .map(([, label]) => label())
    .join(", ");
  return fill(
    t(
      "Buổi chơi lúc {start} đã thay đổi {fields}. Xem chi tiết: {link}",
      "Your session at {start} changed: {fields}. Details: {link}",
    ),
    { start, fields, link: v.link },
  );
}
