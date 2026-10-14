import { describe, expect, it } from "vitest";
import type { ClubConfigDto } from "./club-settings-client";
import {
  buildDefaultsPatch,
  buildProfilePatch,
  defaultsValues,
  profileValues,
  timezoneOptions,
} from "./club-settings-model";

const club: ClubConfigDto = {
  slug: "clb",
  name: "CLB Cầu lông",
  timezone: "Asia/Ho_Chi_Minh",
  locale: "vi",
  defaultSportKey: "badminton",
  defaultPriceAmount: 50000,
  defaultVisibility: "private",
};
const fmt = (n: number) => String(n);

describe("buildProfilePatch", () => {
  it("unchanged form sends nothing (a PATCH needs >= 1 field)", () => {
    expect(buildProfilePatch(club, profileValues(club))).toBeNull();
  });
  it("sends only the changed fields, trimmed", () => {
    expect(
      buildProfilePatch(club, { name: "  CLB Mới ", timezone: "Asia/Ho_Chi_Minh", locale: "en" }),
    ).toEqual({ name: "CLB Mới", locale: "en" });
  });
  it("a whitespace-only edit of the name is not a change", () => {
    expect(buildProfilePatch(club, { ...profileValues(club), name: " CLB Cầu lông " })).toBeNull();
  });
});

describe("buildDefaultsPatch", () => {
  const base = defaultsValues(club, fmt);
  it("unchanged -> no patch", () => {
    expect(buildDefaultsPatch(club, base)).toEqual({ patch: null, problem: null });
  });
  it("changed price + visibility only", () => {
    expect(buildDefaultsPatch(club, { ...base, price: "60.000", visibility: "public" })).toEqual({
      patch: { defaultPriceAmount: 60000, defaultVisibility: "public" },
      problem: null,
    });
  });
  it("0 is a valid price (free)", () => {
    expect(buildDefaultsPatch(club, { ...base, price: "0" }).patch).toEqual({
      defaultPriceAmount: 0,
    });
  });
  it("an over-int4 price is invalid, never clamped", () => {
    expect(buildDefaultsPatch(club, { ...base, price: "99999999999" })).toEqual({
      patch: null,
      problem: "price_invalid",
    });
  });
  it("a saved price cannot be blanked", () => {
    expect(buildDefaultsPatch(club, { ...base, price: "" }).problem).toBe("price_required");
  });
  it("a saved sport cannot be cleared: 'Not set' is a problem, never a silent 'nothing changed'", () => {
    expect(buildDefaultsPatch(club, { ...base, sportKey: "" })).toEqual({
      patch: null,
      problem: "sport_required",
    });
    // ...even when another field changed in the same submit.
    expect(buildDefaultsPatch(club, { ...base, sportKey: "", visibility: "public" }).problem).toBe(
      "sport_required",
    );
  });
  it("a changed sport is sent; a never-set sport may stay unset", () => {
    expect(buildDefaultsPatch(club, { ...base, sportKey: "pickleball" }).patch).toEqual({
      defaultSportKey: "pickleball",
    });
    const noSport: ClubConfigDto = { ...club, defaultSportKey: null };
    expect(buildDefaultsPatch(noSport, defaultsValues(noSport, fmt))).toEqual({
      patch: null,
      problem: null,
    });
  });
  it("a never-set club with an untouched form sends nothing", () => {
    const empty: ClubConfigDto = {
      ...club,
      defaultSportKey: null,
      defaultPriceAmount: null,
      defaultVisibility: null,
    };
    expect(buildDefaultsPatch(empty, defaultsValues(empty, fmt))).toEqual({
      patch: null,
      problem: null,
    });
  });
});

describe("timezoneOptions", () => {
  it("keeps an uncommon saved zone selectable", () => {
    expect(timezoneOptions("Pacific/Auckland")[0]).toBe("Pacific/Auckland");
    expect(timezoneOptions("Asia/Tokyo")).not.toContain("Pacific/Auckland");
  });
});
