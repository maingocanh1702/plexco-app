import { fmtMoney } from "@plexco/core";
import { runWithLang, type Lang } from "@plexco/core/i18n";
import { describe, expect, it } from "vitest";
import {
  DM_RELEVANT_FIELDS,
  renderZaloDm,
  ZALO_DM_TEMPLATES,
  type ZaloDmTemplate,
  type ZaloDmValues,
} from "./zalo-dm-templates.js";

/**
 * DD-140 (owner decision B2) amends Z-13's "no price in any DM" for the promotion DM only. Pure
 * renders (no DB, no network) prove that every template the module routes (ZALO_DM_TEMPLATES)
 * except 'promoted' still carries no price even when handed an amountDue, and that 'promoted'
 * does: the positive control shows that every negative check below is able to fail.
 */
const AMOUNT_DUE = 95_000;

/** Every value the templates accept, filled; amountDue is set for every template. */
const VALUES: ZaloDmValues = {
  startsAt: new Date("2026-10-24T12:30:00Z"),
  timeZone: "Asia/Ho_Chi_Minh",
  fields: [...DM_RELEVANT_FIELDS],
  link: "https://app.test/c/tenant-a/sessions/session-b",
  amountDue: AMOUNT_DUE,
};

/** The language is selected as zalo-dm.ts does: runWithLang(club locale, () => renderZaloDm(...)). */
const render = (lang: Lang, template: ZaloDmTemplate) =>
  runWithLang(lang, () => renderZaloDm(template, VALUES));

// A digit then đ or ₫, optionally through the no-break space that Intl currency output puts there
// (built at runtime so the source holds no invisible character). Not any whitespace: the vi copy
// "{start} đã ..." puts an ordinary space between the start time's last digit and "đã".
const NO_BREAK_SPACES = String.fromCodePoint(0xa0, 0x202f);
const DIGIT_THEN_DONG = new RegExp(`[0-9][${NO_BREAK_SPACES}]?[đ₫]`, "u");

const PRICE_MARKERS: readonly [string, (text: string) => boolean][] = [
  ["fmtMoney(amountDue)", (text) => text.includes(fmtMoney(AMOUNT_DUE))],
  ["Phí", (text) => text.includes("Phí")],
  ["Fee", (text) => text.includes("Fee")],
  ["digit then đ/₫", (text) => DIGIT_THEN_DONG.test(text)],
  // AMOUNT_DUE as a raw number (ungrouped, or grouped by "." or ","): a price shown without
  // fmtMoney or without its currency sign still fails the negative checks.
  ["95000", (text) => text.includes("95000")],
  ["95.000", (text) => text.includes("95.000")],
  ["95,000", (text) => text.includes("95,000")],
];

/** The names of every price marker found in the text; [] means the text carries no price. */
const priceMarkers = (text: string) =>
  PRICE_MARKERS.filter(([, found]) => found(text)).map(([name]) => name);

/** Every template the module routes (its own map), so a template added later is covered too. */
const TEMPLATES = [...new Set(ZALO_DM_TEMPLATES.values())];
const NO_PRICE_TEMPLATES = TEMPLATES.filter((template) => template !== "promoted");

const NO_PRICE_CASES = NO_PRICE_TEMPLATES.flatMap((template) =>
  (["vi", "en"] as const).map((lang): [ZaloDmTemplate, Lang] => [template, lang]),
);

describe("Zalo DM templates: only 'promoted' carries a price (DD-140 amends Z-13)", () => {
  it("derives the no-price list: the module's templates minus 'promoted', never empty", () => {
    expect(TEMPLATES).toContain("promoted");
    expect(NO_PRICE_TEMPLATES.length).toBeGreaterThan(0);
  });

  it.each(NO_PRICE_CASES)(
    "DD-140/Z-13: the '%s' DM in %s carries no price even with amountDue set",
    (template, lang) => {
      expect(priceMarkers(render(lang, template))).toEqual([]);
    },
  );

  it("DD-140 positive control: 'promoted' carries fmtMoney(amountDue) after 'Phí: ' (vi) and 'Fee: ' (en)", () => {
    const vi = render("vi", "promoted");
    const en = render("en", "promoted");
    expect(vi).toContain(`Phí: ${fmtMoney(AMOUNT_DUE)}.`);
    expect(en).toContain(`Fee: ${fmtMoney(AMOUNT_DUE)}.`);
    expect(priceMarkers(vi)).toEqual(["fmtMoney(amountDue)", "Phí", "digit then đ/₫", "95.000"]);
    expect(priceMarkers(en)).toEqual(["fmtMoney(amountDue)", "Fee", "digit then đ/₫", "95.000"]);
    // fmtMoney prints "95.000đ", so only "95.000" fires above; probe that the other two can fire.
    expect(priceMarkers("95000 95,000")).toEqual(["95000", "95,000"]);
  });
});
