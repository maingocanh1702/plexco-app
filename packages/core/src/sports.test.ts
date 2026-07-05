import { describe, expect, it } from "vitest";
import { SPORT_CONTENT_PHRASES, sportPhrasesFor, sportStopwordTokens } from "./sports.js";
import { hasSportKeyword } from "./matching.js";

describe("sport phrase sets", () => {
  it("covers every sport key seeded by 0011_seeds.sql", () => {
    const seeded = ["badminton", "pickleball", "tennis", "football", "volleyball", "basketball"];
    for (const key of seeded) {
      expect(SPORT_CONTENT_PHRASES[key], key).toBeDefined();
      expect(SPORT_CONTENT_PHRASES[key]!.length).toBeGreaterThan(0);
    }
  });

  it("falls back to the key itself for unknown sports", () => {
    expect(sportPhrasesFor("chess")).toEqual(["chess"]);
  });
});

describe("sportStopwordTokens", () => {
  it("splits phrases into tokens + squashed forms (badminton set matches the bot's)", () => {
    const tokens = sportStopwordTokens("badminton").sort();
    expect(tokens).toEqual(["badminton", "cau", "caulong", "long"]);
  });

  it("multi-word phrases produce word + squashed tokens", () => {
    const tokens = new Set(sportStopwordTokens("football"));
    for (const t of ["bong", "da", "bongda", "banh", "dabanh", "football", "soccer"]) {
      expect(tokens.has(t), t).toBe(true);
    }
  });
});

describe("hasSportKeyword with per-sport phrases", () => {
  it("detects each sport in normalized memo text", () => {
    expect(hasSportKeyword("kelly jun 13 badminton", sportPhrasesFor("badminton"))).toBe(true);
    expect(hasSportKeyword("kelly CẦU LÔNG 13/6", sportPhrasesFor("badminton"))).toBe(true);
    expect(hasSportKeyword("minh pickleball t7", sportPhrasesFor("pickleball"))).toBe(true);
    expect(hasSportKeyword("doi bong da san 5", sportPhrasesFor("football"))).toBe(true);
    expect(hasSportKeyword("kelly jun 13 badminton", sportPhrasesFor("tennis"))).toBe(false);
  });

  it("phrases match at token boundaries only (no prefix false-positives)", () => {
    expect(hasSportKeyword("chuyen tien bong dan jun 13", sportPhrasesFor("football"))).toBe(false);
    expect(hasSportKeyword("chuyen tien bong da jun 13", sportPhrasesFor("football"))).toBe(true);
    expect(hasSportKeyword("kelly badmintons jun 13", sportPhrasesFor("badminton"))).toBe(false);
  });
});
