import { describe, expect, it } from "vitest";
import { SPORT_CONTENT_PHRASES, sportPhrasesFor, sportStopwordTokens } from "./sports.js";

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
