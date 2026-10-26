import { format } from "node:util";
import { readDiscoveryListingByShareSlug, type DiscoveryListingRow } from "@plexco/db";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DiscoveryListing } from "../../../lib/discover-api";
import { resetDiscoveryRouteSupportForTests } from "../../../lib/discovery-route-support";
import PublicSessionSharePage, { dynamic, metadata } from "./page";

const NOT_FOUND = vi.hoisted(() => new Error("notFound() sentinel"));
const captured = vi.hoisted(() => [] as object[]);
vi.mock("@plexco/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@plexco/db")>()),
  readDiscoveryListingByShareSlug: vi.fn(),
}));
vi.mock("../../../lib/discovery-route-support", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/discovery-route-support")>()),
  discoveryPool: () => Promise.resolve("readonly-pool"), // the REAL limiter and DTO still run
}));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND;
  },
}));
vi.mock("../../../components/discover/listing-summary", () => ({
  ListingSummary: ({ listing }: { listing: DiscoveryListing }) => {
    captured.push(listing);
    return listing.publicListingId;
  },
}));
const SLUG = "Ab3_dE-fGhIjKlMnOpQrSt"; // the DD-83 shape: 22 of [A-Za-z0-9_-]
const BAD = ["short", `${SLUG}x`, ...["/", String.fromCharCode(0)].map((c) => SLUG.slice(1) + c)];
// prettier-ignore
const ROW = {
  public_listing_id: "listing-4c1e", sport_key: "pickleball", area: "District 1", slots_open: 3,
  starts_at: new Date("2026-11-01T10:00Z"), ends_at: new Date("2026-11-01T12:00Z"), title: null,
  price_amount: 120000, club_display_name: "Sunrise Club", join_policy: "open", session_type: null,
  level_min_rank: null, level_max_rank: null, level_strict: null, gender_restriction: null,
  age_min: null, age_max: null, venue_name: "Sân Lê Lợi", venue_address: "12 Lê Lợi, Quận 1",
  tenant_id: "LEAK-tenant", session_id: "LEAK-session", // LEAKY on purpose: never passed on
} as DiscoveryListingRow;
// prettier-ignore
const LISTING_KEYS: Record<keyof DiscoveryListing, true> = {
  publicListingId: true, sportKey: true, startsAt: true, endsAt: true, title: true, area: true,
  clubDisplayName: true, priceAmount: true, slotsOpen: true, joinPolicy: true, venueName: true,
  venueAddress: true, // keyed by the TYPE: a key added to or dropped from it breaks compilation
};
const DD41 = "sessionType levelMinRank levelMaxRank levelStrict genderRestriction ageMin ageMax";
const ALLOWED = new Set([...Object.keys(LISTING_KEYS), ...DD41.split(" ")]); // DTO :228-241
const LOGS = ["log", "info", "warn", "error"] as const;
const read = vi.mocked(readDiscoveryListingByShareSlug);
const run = async (slug: string) =>
  renderToStaticMarkup(await PublicSessionSharePage({ params: Promise.resolve({ slug }) }));
beforeEach(() => {
  resetDiscoveryRouteSupportForTests();
  read.mockReset();
  captured.length = 0;
  for (const m of LOGS) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => {
  const out = LOGS.flatMap((m) => vi.mocked(console[m]).mock.calls).map((a) => format("%s", ...a));
  expect(out.filter((line) => [SLUG, ...BAD].some((s) => line.includes(s)))).toEqual([]); // (6)
  vi.restoreAllMocks();
});
it("(1) hands ListingSummary whitelist keys only and links on without a Referer", async () => {
  read.mockResolvedValue({ ...ROW, age_min: 16 });
  const html = await run(SLUG);
  expect(captured.flatMap(Object.keys).filter((key) => !ALLOWED.has(key))).toEqual([]);
  expect(captured).toMatchObject([{ publicListingId: "listing-4c1e", ageMin: 16 }]);
  expect(JSON.stringify(captured) + html).not.toContain("LEAK");
  expect(html).toContain('<a href="/discover/listing-4c1e" rel="noreferrer">Xem và tham gia</a>');
});
it("(2) shows the venue only as projected: none while hidden (ON), both when shown (OFF)", async () => {
  read.mockResolvedValueOnce({ ...ROW, venue_name: null, venue_address: null });
  read.mockResolvedValueOnce(ROW);
  await run(SLUG).then(() => run(SLUG));
  const [hidden, shown] = captured;
  expect(hidden).toMatchObject({ venueName: null, venueAddress: null });
  expect(shown).toMatchObject({ venueName: ROW.venue_name, venueAddress: ROW.venue_address });
});
it("(3) answers a null read, a malformed slug and the 61st call with the SAME notFound()", async () => {
  read.mockResolvedValue(null);
  await expect(run(SLUG)).rejects.toBe(NOT_FOUND);
  for (const slug of BAD) await expect(run(slug)).rejects.toBe(NOT_FOUND);
  expect(read).toHaveBeenCalledTimes(1); // a malformed slug never reaches the read
  resetDiscoveryRouteSupportForTests(); // a fresh window: 60 calls pass, the 61st is refused unread
  read.mockReset().mockResolvedValue(ROW);
  for (let i = 0; i < 60; i += 1) await run(SLUG);
  await expect(run(SLUG)).rejects.toBe(NOT_FOUND);
  expect(read).toHaveBeenCalledTimes(60);
});
it("(4) hands a well-formed slug to exactly one read on the readonly pool", async () => {
  read.mockResolvedValue(ROW);
  await run(SLUG);
  expect(read.mock.calls).toEqual([["readonly-pool", SLUG]]);
});
it("(5) is rendered per request, never indexed and sends no Referer", () => {
  expect(metadata).toEqual({ robots: { index: false, follow: false }, referrer: "no-referrer" });
  expect(dynamic).toBe("force-dynamic");
});
it("(7) passes an empty title on as absent (null), so the sport label heads the card", async () => {
  read.mockResolvedValue({ ...ROW, title: "" });
  await run(SLUG);
  expect(captured).toMatchObject([{ title: null }]);
});
