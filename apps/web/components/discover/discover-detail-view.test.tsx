import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../lib/api-client";
import type { DiscoveryListing } from "../../lib/discover-api";
import { LangProvider, makeT } from "../../lib/i18n-client";
import { formatVnd } from "../../lib/money";
import { describePlayerError } from "../../lib/session-error-ui";
import { DiscoverDetailView, type DiscoverDetailState } from "./discover-detail-view";

// ApiErrorNotice calls useRouter(), and no app router is mounted in a static render.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {} }) }));

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
const failure = (code: string, status: number) =>
  new ApiClientError(code, "server text", status, "req-1");

const render = (state: DiscoverDetailState, lang: "vi" | "en" = "en") =>
  renderToStaticMarkup(
    <LangProvider lang={lang}>
      <DiscoverDetailView state={state} onRetry={() => {}}>
        <p>join slot</p>
      </DiscoverDetailView>
    </LangProvider>,
  );
/** Visible text only: tags stripped, the entities React escapes decoded. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const stateOf = (html: string) => /data-state="([a-z]+)"/.exec(html)?.[1];

describe("DiscoverDetailView", () => {
  it("loading: a busy skeleton, no listing and no join slot", () => {
    const html = render({ status: "loading" });
    expect(stateOf(html)).toBe("loading");
    expect(html).toContain('aria-busy="true"');
    expect(text(html)).not.toContain("join slot");
  });

  it("ready: the whitelisted listing fields and the join slot, with no id", () => {
    const html = render({ status: "ready", listing: LISTING });
    expect(stateOf(html)).toBe("ready");
    // A-2, A-6 (DD-139): the server sent no venue (option ON or none typed), so no line and no
    // placeholder: no empty paragraph and no "null" or "undefined" text.
    expect(html).not.toMatch(/<p[^>]*><\/p>/);
    expect(text(html)).not.toMatch(/null|undefined/);
    expect(html).toMatch(/<h1[^>]*>Pickleball cuối tuần<\/h1>/);
    const visible = text(html);
    for (const shown of [
      formatVnd(80000),
      "2 spots open",
      "Host approval",
      "Cầu Giấy",
      "Dev Club",
      "join slot",
    ]) {
      expect(visible).toContain(shown);
    }
    expect(html).not.toContain("listing-4c1e"); // the id only ever reaches the API path, never the page
    expect(html).toContain('href="/discover"'); // the way back to the list
  });

  it("ready: an untitled listing is headed by its sport label", () => {
    const html = render({ status: "ready", listing: { ...LISTING, title: null } });
    expect(html).toMatch(/<h1[^>]*>Pickleball<\/h1>/);
  });

  it("ready: the venue name and the full address show when the server sends them (A-1, D-5)", () => {
    const venueName = "Sân Cầu Lông A1";
    const venueAddress = "12 Phố Huế, phường Hai Bà Trưng, Hà Nội";
    const html = render({ status: "ready", listing: { ...LISTING, venueName, venueAddress } });
    const visible = text(html);
    expect(visible).toContain(venueName);
    expect(visible).toContain(venueAddress); // full text, no truncation (D-5)
  });

  it("ready: a listing without a venue is the venue listing minus the venue text, no placeholder (A-2, A-6)", () => {
    // Null = nothing typed, or the host hid it (option ON): the page is then the venue page minus
    // the venue text and nothing takes its place, not even a translated label. Each field stands alone.
    const venueName = "Sân Cầu Lông A1";
    const venueAddress = "12 Phố Huế, phường Hai Bà Trưng, Hà Nội";
    const flat = (extra: Partial<DiscoveryListing>) =>
      text(render({ status: "ready", listing: { ...LISTING, ...extra } }));
    const squash = (s: string) => s.replace(/ +/g, " ").trim();
    // Not vacuous: the venue render really carries both strings, the bare one neither.
    const full = flat({ venueName, venueAddress });
    expect(full).toContain(venueName);
    expect(full).toContain(venueAddress);
    const bare = squash(flat({ venueName: null, venueAddress: null }));
    expect(bare).toContain("Cầu Giấy");
    expect(bare).not.toContain(venueName);
    expect(bare).not.toContain(venueAddress);
    expect(squash(full.replace(venueName, "").replace(venueAddress, ""))).toBe(bare);
    expect(squash(flat({ venueName, venueAddress: null }).replace(venueName, ""))).toBe(bare);
    expect(squash(flat({ venueName: null, venueAddress }).replace(venueAddress, ""))).toBe(bare);
  });

  it("ignores non-whitelisted keys: gender, per-gender price, bank and QR never render", () => {
    const injected = {
      ...LISTING,
      genderRestriction: "male",
      priceByGender: { male: 70001, female: 50002 },
      bankAccount: "0123456789",
      qrUrl: "https://qr.example/pay",
    } as unknown as DiscoveryListing;
    const html = render({ status: "ready", listing: injected });
    for (const leaked of ["70001", "50002", "0123456789", "qr.example", "male"]) {
      expect(html).not.toContain(leaked);
    }
  });

  it("not found: the E-1 text, a link back to /discover, no listing field and no join slot", () => {
    const missing = failure("NOT_FOUND", 404);
    const html = render({ status: "error", error: missing });
    expect(stateOf(html)).toBe("empty");
    expect(text(html)).toContain(describePlayerError(missing, makeT("en")).message);
    expect(html).toContain('href="/discover"');
    expect(text(html)).not.toContain("join slot");
  });

  it("error: DISCOVERY_RATE_LIMITED offers Try again, an unknown code shows its reference", () => {
    const limited = failure("DISCOVERY_RATE_LIMITED", 429);
    const html = render({ status: "error", error: limited });
    expect(stateOf(html)).toBe("error");
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain(describePlayerError(limited, makeT("en")).message);
    expect(text(html)).toContain("Try again");

    const unknown = text(render({ status: "error", error: failure("SOMETHING_NEW", 418) }));
    expect(unknown).toContain("Reference");
    expect(unknown).toContain("req-1");
  });

  it("offline: a status notice with Try again and no listing", () => {
    const html = render({ status: "offline" });
    expect(stateOf(html)).toBe("offline");
    expect(html).toContain('role="status"');
    expect(text(html)).toContain("Try again");
    expect(text(html)).not.toContain("join slot");
  });

  it("every state has exactly one h1: the listing title when ready, else the page heading (Q8)", () => {
    const states: DiscoverDetailState[] = [
      { status: "loading" },
      { status: "error", error: failure("NOT_FOUND", 404) },
      { status: "error", error: failure("DISCOVERY_RATE_LIMITED", 429) },
      { status: "offline" },
      { status: "ready", listing: LISTING },
    ];
    for (const state of states) expect(render(state).match(/<h1[ >]/g)).toHaveLength(1);
    expect(text(render({ status: "loading" }))).toContain("Game details");
    expect(text(render({ status: "loading" }, "vi"))).toContain("Chi tiết kèo");
  });

  it("one open slot reads in the singular", () => {
    const html = render({ status: "ready", listing: { ...LISTING, slotsOpen: 1 } });
    expect(text(html)).toContain("1 spot open");
    expect(text(html)).not.toContain("1 spots open");
  });

  it("renders vi and en: distinct text in every state", () => {
    const states: DiscoverDetailState[] = [
      { status: "loading" },
      { status: "ready", listing: LISTING },
      { status: "error", error: failure("NOT_FOUND", 404) },
      { status: "error", error: failure("DISCOVERY_RATE_LIMITED", 429) },
      { status: "offline" },
    ];
    for (const state of states) {
      const viHtml = render(state, "vi");
      const enHtml = render(state, "en");
      expect(viHtml).not.toBe(enHtml);
      expect(text(viHtml)).toContain("Tất cả kèo");
      expect(text(enHtml)).toContain("All games");
    }
  });
});
