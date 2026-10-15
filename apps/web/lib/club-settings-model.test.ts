import { describe, expect, it } from "vitest";
import type { ClubConfigDto } from "./club-settings-client";
import {
  buildDefaultsPatch,
  buildProfilePatch,
  clubNameProblem,
  defaultsValues,
  profileValues,
  timezoneOptions,
  unsureAfter,
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
const ch = (cp: number) => String.fromCodePoint(cp);

describe("clubNameProblem (same count as club-config-validation.ts: UTF-16 units)", () => {
  it.each([
    ["CLB Cầu lông", null],
    ["x".repeat(120), null],
    ["x".repeat(121), "too_long"],
    // An astral emoji is 2 UTF-16 units: 60 fit, 61 are 122 units and the route refuses them.
    [ch(0x1f3f8).repeat(60), null],
    [ch(0x1f3f8).repeat(61), "too_long"],
    ["", "empty"],
    ["   ", "empty"],
    ["a" + ch(0x09) + "b", "invalid_chars"],
    ["a" + ch(0x200b) + "b", "invalid_chars"],
    ["a" + ch(0x202e) + "b", "invalid_chars"],
    // The club route refuses only Cc/Cf: the client mirrors it and refuses nothing more.
    ["a" + ch(0x2028) + "b", null],
  ])("%j -> %s", (input, expected) => {
    expect(clubNameProblem(input)).toBe(expected);
  });
});

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
  it("after an uncertain failure, a field changed back to the loaded value is SENT, never 'nothing changed'", () => {
    // {name: "CLB Mới"} failed uncertainly: the server may hold it, so reverting must reach it.
    const unsure = unsureAfter(undefined, { name: "CLB Mới" });
    expect(buildProfilePatch(club, profileValues(club), unsure)).toEqual({ name: "CLB Cầu lông" });
    // ...and alongside a real edit, the unsure field still travels.
    expect(buildProfilePatch(club, { ...profileValues(club), locale: "en" }, unsure)).toEqual({
      name: "CLB Cầu lông",
      locale: "en",
    });
  });
});

describe("unsureAfter", () => {
  it("accumulates the fields of every uncertain attempt", () => {
    const first = unsureAfter(undefined, { name: "A" });
    expect([...unsureAfter(first, { timezone: "UTC", locale: "en" })].sort()).toEqual([
      "locale",
      "name",
      "timezone",
    ]);
    expect([...first]).toEqual(["name"]); // the earlier set is not mutated
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
  it("after an uncertain failure the unsure defaults are sent back as the form holds them", () => {
    const unsure = unsureAfter(undefined, {
      defaultPriceAmount: 60000,
      defaultVisibility: "public",
    });
    expect(buildDefaultsPatch(club, base, unsure)).toEqual({
      patch: { defaultPriceAmount: 50000, defaultVisibility: "private" },
      problem: null,
    });
  });
  it("an unsure sport or price counts as saved: blanking it is a problem, not 'nothing changed'", () => {
    const empty: ClubConfigDto = { ...club, defaultSportKey: null, defaultPriceAmount: null };
    const values = defaultsValues(empty, fmt);
    expect(
      buildDefaultsPatch(empty, values, unsureAfter(undefined, { defaultSportKey: "badminton" })),
    ).toEqual({ patch: null, problem: "sport_required" });
    expect(
      buildDefaultsPatch(empty, values, unsureAfter(undefined, { defaultPriceAmount: 1000 })),
    ).toEqual({ patch: null, problem: "price_required" });
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
