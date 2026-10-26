import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { DiscoveryListing } from "../../lib/discover-api";
import { LangProvider } from "../../lib/i18n-client";
import { formatSessionRange } from "../../lib/session-time";
import { ListingSummary } from "./listing-summary";

// null: the real hook runs, so a server render takes getServerSnapshot. "client": a render after
// hydration takes getSnapshot (the browser's zone). "missing": a browser that reports no zone.
const fake = vi.hoisted(() => ({ snapshot: null as null | "client" | "missing" }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useSyncExternalStore: (
      subscribe: () => () => void,
      getSnapshot: () => unknown,
      getServerSnapshot: () => unknown,
    ) =>
      fake.snapshot === null
        ? react.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
        : fake.snapshot === "client"
          ? getSnapshot()
          : undefined,
  };
});
afterEach(() => {
  fake.snapshot = null;
});

const LISTING: DiscoveryListing = {
  publicListingId: "listing-4c1e",
  sportKey: "pickleball",
  startsAt: "2026-11-02T11:30:00.000Z",
  endsAt: "2026-11-02T13:00:00.000Z",
  title: "Pickleball cuối tuần",
  area: "Cầu Giấy",
  clubDisplayName: "Dev Club",
  priceAmount: 80000,
  slotsOpen: 2,
  joinPolicy: "approval",
  venueName: null,
  venueAddress: null,
};
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const range = (zone: string) => formatSessionRange(LISTING.startsAt, LISTING.endsAt, zone, "vi");
// The old server render printed the process's own zone; UTC and Saigon stand for other servers.
const shownRanges = (html: string) =>
  [browserZone, "UTC", "Asia/Ho_Chi_Minh"].map(range).filter((r) => html.includes(r));
const render = () =>
  renderToString(
    <LangProvider lang="vi">
      <ListingSummary listing={LISTING} as="h1" />
    </LangProvider>,
  );

it("server render omits the time line", () => {
  const html = render();
  expect(html).toContain("Pickleball cuối tuần");
  expect(html).toContain("Cầu Giấy");
  expect(shownRanges(html)).toEqual([]);
  // Two <p> only, the area and the club: no time line, filled or empty.
  expect(html.split("</p>")).toHaveLength(3);
});

it("a client render shows the time in the viewer's zone", () => {
  fake.snapshot = "client";
  expect(render()).toContain(range(browserZone));
});

it("a missing zone renders no time line", () => {
  fake.snapshot = "missing";
  expect(render().split("</p>")).toHaveLength(3);
});
