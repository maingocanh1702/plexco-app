import type { SessionListItemDto } from "./sessions-api";

/**
 * Pure list model. The API filters by ONE status and has no `upcoming` parameter, so a tab is a
 * set of "streams" (one paged request per status) merged on the client:
 *   all      -> [no status filter]
 *   upcoming -> [open], then keep startsAt >= now   (client-side; there is no server param)
 *   draft    -> [draft]
 *   closed   -> [closed, cancelled]                 (two streams merged, newest first)
 */
export type ListTab = "all" | "upcoming" | "draft" | "closed";
export const LIST_TABS: readonly ListTab[] = ["all", "upcoming", "draft", "closed"];

export function tabStatuses(tab: ListTab): (string | undefined)[] {
  switch (tab) {
    case "all":
      return [undefined];
    case "upcoming":
      return ["open"];
    case "draft":
      return ["draft"];
    case "closed":
      return ["closed", "cancelled"];
  }
}

export interface Stream {
  status: string | undefined;
  items: SessionListItemDto[];
  cursor: string | null;
  hasMore: boolean;
}

/** Newest first, id as tiebreak: the same order the API pages in. */
const newerFirst = (a: SessionListItemDto, b: SessionListItemDto): number => {
  const d = Date.parse(b.startsAt) - Date.parse(a.startsAt);
  return d !== 0 ? d : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
};

/**
 * Merged, ordered view. When a stream still has older pages, anything older than its last loaded
 * item may be missing from the merge, so only items at least as new as the NEWEST such boundary are
 * shown; "load more" then reveals the rest. This keeps the list a correct prefix of the true order
 * (no row ever appears later ABOVE an already-visible one).
 */
export function visibleSessions(
  streams: readonly Stream[],
  tab: ListTab,
  now: number,
): SessionListItemDto[] {
  const merged = streams.flatMap((s) => s.items).sort(newerFirst);
  const boundaries = streams
    .filter((s) => s.hasMore && s.items.length > 0)
    .map((s) => s.items[s.items.length - 1]!);
  let shown = merged;
  if (boundaries.length > 0) {
    const watermark = boundaries.sort(newerFirst)[0]!;
    shown = merged.filter((x) => newerFirst(x, watermark) <= 0);
  }
  return tab === "upcoming" ? shown.filter((x) => Date.parse(x.startsAt) >= now) : shown;
}

export const hasMorePages = (streams: readonly Stream[]): boolean => streams.some((s) => s.hasMore);
