import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ClubConfigDto } from "../../lib/club-settings-client";
import { LangProvider } from "../../lib/i18n-client";
import { ClubDefaultsForm } from "./club-defaults-form";
import { ClubProfileForm } from "./club-profile-form";
import { ZaloConnectCard } from "./zalo-connect-card";

const club: ClubConfigDto = {
  slug: "clb",
  name: "CLB Alpha",
  timezone: "Asia/Ho_Chi_Minh",
  locale: "vi",
  defaultSportKey: "badminton",
  defaultPriceAmount: 50000,
  defaultVisibility: "public",
};
const wrap = (node: React.ReactNode, lang: "vi" | "en" = "en") =>
  renderToStaticMarkup(<LangProvider lang={lang}>{node}</LangProvider>);

describe("ClubProfileForm", () => {
  it("prefills name/timezone/language and says the language is club-wide (DD-118)", () => {
    const html = wrap(<ClubProfileForm tenantId="t" csrfToken="x" club={club} onSaved={vi.fn()} />);
    expect(html).toContain('value="CLB Alpha"');
    expect(html).toContain("Club language");
    expect(html).toContain("no per-member language");
    expect(html).toContain("Asia/Ho_Chi_Minh");
  });
});

describe("ClubDefaultsForm", () => {
  it("lists the sports, formats the saved price and offers the two visibilities", () => {
    const html = wrap(
      <ClubDefaultsForm
        tenantId="t"
        csrfToken="x"
        club={club}
        sports={[{ id: "1", key: "badminton", name: "Badminton" }]}
        onSaved={vi.fn()}
      />,
    );
    expect(html).toContain("Badminton");
    expect(html).toContain('value="50,000"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain("Private");
    expect(html).toContain("Public");
  });
});

describe("ZaloConnectCard", () => {
  it("first paint is a skeleton: no token field, no state claimed before the route answered", () => {
    const html = wrap(<ZaloConnectCard tenantId="t" csrfToken="x" />);
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Connected");
  });
});
