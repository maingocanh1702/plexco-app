/**
 * Lifted from the production single-club bot's matching suite (real roster +
 * real bank-transfer contents; the VN name-matching edge cases are the most
 * valuable asset of the port). Converted to vitest; sport vocabulary is passed
 * explicitly (badminton) to preserve production behavior exactly.
 * Excluded here: OCR/avatar helpers and DB-backed alias-conflict tests — those
 * modules were not lifted into core.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeName,
  matchContentToPlayers,
  matchAllInContent,
  pickAutoMatch,
  contentMentionsDate,
  extractAliasFromContent,
  sanitizeRealName,
  stripNameNoise,
  parsePlusOneSuffix,
  hostFromPlusOneLabel,
  matchWithConfidence,
  hasTransferKeyword,
  hasSportKeyword,
  isUniqueInSession,
  dayDiffFromSession,
  extractPayCode,
  countPayCodes,
  type MatchVocab,
  type PayCodeConfig,
} from "./matching.js";
import { sportPhrasesFor, sportStopwordTokens } from "./sports.js";

const VOCAB: MatchVocab = { sportTokens: sportStopwordTokens("badminton") };
const PHRASES = sportPhrasesFor("badminton");

// Roster mirroring the real production session screenshot
const players = [
  "Ngoc-Anh Mai",
  "kelly",
  "Chi",
  "Minh",
  "Tran Duc",
  "Aske",
  "pp",
  "Thad",
  "Maggie",
  "Jo Gene",
  "Jason Poon",
  "Binh",
  "Minh Tran",
  "Giang",
  "Kelvin Yeong",
  "Cang",
].map((name, i) => ({ id: i + 1, name, norm: normalizeName(name) }));

const autoMatch = (content: string) =>
  pickAutoMatch(matchContentToPlayers(content, players, VOCAB));
const multi = (content: string) =>
  matchAllInContent(content, players, VOCAB)
    .map((m) => m.name)
    .sort();

describe("normalizeName", () => {
  it("strips diacritics, đ→d, lowercases, alphanum-only", () => {
    expect(normalizeName("Ngọc-Ánh Mai")).toBe("ngoc anh mai");
    expect(normalizeName("Trần Đức")).toBe("tran duc");
    expect(normalizeName("NGOC ANH JUN 13 BADMINTON")).toBe("ngoc anh jun 13 badminton");
  });
});

describe("typical bank transfer contents", () => {
  it("auto-matches clear single-payer contents", () => {
    expect(autoMatch("Ngoc-Anh Jun 13 badminton")?.name).toBe("Ngoc-Anh Mai");
    expect(autoMatch("NGOC ANH MAI 13/6 BADMINTON")?.name).toBe("Ngoc-Anh Mai");
    expect(autoMatch("kelly jun 13 badminton")?.name).toBe("kelly");
    expect(autoMatch("TRAN DUC 13-06 cau long")?.name).toBe("Tran Duc");
    expect(autoMatch("Kelvin Yeong Jun13 badminton")?.name).toBe("Kelvin Yeong");
    expect(autoMatch("JASON POON CHUYEN TIEN")?.name).toBe("Jason Poon");
  });

  it("refuses ambiguous 'Minh' (Minh vs Minh Tran) — manual", () => {
    expect(autoMatch("MINH JUN 13 BADMINTON")).toBeNull();
    expect(autoMatch("MINH TRAN JUN 13 BADMINTON")?.name).toBe("Minh Tran");
  });

  it("accepts unique first-name-only transfers", () => {
    expect(autoMatch("NgocAnh jun 13")?.name).toBe("Ngoc-Anh Mai");
    expect(autoMatch("MAGGIE 13/6")?.name).toBe("Maggie");
  });

  it("no match for unrelated content", () => {
    expect(autoMatch("THANH TOAN TIEN NHA THANG 6")).toBeNull();
  });
});

describe("matchAllInContent (one transfer, several payers)", () => {
  it("greedily matches disjoint names", () => {
    expect(multi("kelly Chi Jun 13 badminton")).toEqual(["Chi", "kelly"]);
    expect(multi("THAD MAGGIE 13/6 BADMINTON")).toEqual(["Maggie", "Thad"]);
    expect(multi("Ngoc-Anh kelly Chi jun13")).toEqual(["Chi", "Ngoc-Anh Mai", "kelly"]);
  });

  it("matches a two-person roster paying together", () => {
    const jessePlayers = ["Jesse", "celia"].map((name, i) => ({
      id: i + 1,
      name,
      norm: normalizeName(name),
    }));
    expect(
      matchAllInContent("Jesse celia", jessePlayers, VOCAB)
        .map((m) => m.name)
        .sort(),
    ).toEqual(["Jesse", "celia"]);
  });

  it("refuses overlapping-name rosters (Kelly vs Kelly Chi)", () => {
    const overlappingPlayers = ["Kelly", "Kelly Chi"].map((name, i) => ({
      id: i + 1,
      name,
      norm: normalizeName(name),
    }));
    expect(matchAllInContent("Kelly Chi jun 13", overlappingPlayers, VOCAB)).toEqual([]);
  });

  it("consumes matched tokens (Minh Tran does not double-match Minh)", () => {
    expect(multi("MINH TRAN JUN 13")).toEqual(["Minh Tran"]);
    expect(multi("MINH TRAN MINH JUN 13")).toEqual(["Minh", "Minh Tran"]);
    expect(multi("MINH JUN 13")).toEqual([]);
    expect(multi("kelly jun 13 badminton")).toEqual(["kelly"]);
  });
});

describe("contentMentionsDate", () => {
  it("recognizes named/slashed dates", () => {
    expect(contentMentionsDate("Ngoc-Anh Jun 13 badminton", "2026-06-13")).toBe(true);
    expect(contentMentionsDate("kelly 13/6 badminton", "2026-06-13")).toBe(true);
    expect(contentMentionsDate("kelly 13-06 badminton", "2026-06-13")).toBe(true);
    expect(contentMentionsDate("kelly jun 14 badminton", "2026-06-13")).toBe(false);
  });

  it("ISO dates in memos resolve exactly — no phantom mid-year matches", () => {
    expect(contentMentionsDate("chuyen tien 2026-06-13", "2026-06-13")).toBe(true);
    expect(contentMentionsDate("chuyen tien 2026-06-13", "2026-06-26")).toBe(false); // phantom {6,26}
    expect(contentMentionsDate("kelly 13/6/2026 badminton", "2026-06-13")).toBe(true);
    expect(contentMentionsDate("kelly 2026/6/13", "2026-06-13")).toBe(true);
  });

  it("explicit WRONG year never matches (stale-year memo earns no boost)", () => {
    expect(contentMentionsDate("kelly 13/6/2025 badminton", "2026-06-13")).toBe(false);
    expect(contentMentionsDate("chuyen tien 2025-06-13", "2026-06-13")).toBe(false);
    // yearless forms keep month/day semantics (production behavior)
    expect(contentMentionsDate("kelly 13/6 badminton", "2026-06-13")).toBe(true);
    expect(contentMentionsDate("kelly jun 13", "2026-06-13")).toBe(true);
  });

  it("named-month forms honor an explicit year on either side", () => {
    expect(contentMentionsDate("kelly Jun 13 2025 badminton", "2026-06-13")).toBe(false);
    expect(contentMentionsDate("kelly 2025 Jun 13", "2026-06-13")).toBe(false);
    expect(contentMentionsDate("kelly 13 Jun 2025", "2026-06-13")).toBe(false);
    expect(contentMentionsDate("kelly Jun 13 2026 badminton", "2026-06-13")).toBe(true);
    expect(contentMentionsDate("kelly 2026 Jun 13", "2026-06-13")).toBe(true);
    expect(contentMentionsDate("kelly 13 Jun 2026", "2026-06-13")).toBe(true);
    // a 4-digit reference fragment is NOT a year — the date stays yearless
    expect(contentMentionsDate("kelly jun 13 4821", "2026-06-13")).toBe(true);
  });

  it("accepts compact ddmm/mmdd ONLY for this session's date", () => {
    expect(contentMentionsDate("kelly transfer badminton 1306", "2026-06-13")).toBe(true);
    expect(contentMentionsDate("kelly transfer badminton 0613", "2026-06-13")).toBe(true);
    expect(contentMentionsDate("kelly transfer badminton 9999", "2026-06-13")).toBe(false);
    expect(contentMentionsDate("kelly chuyen tien FT26164000303242", "2026-06-13")).toBe(false);
    expect(contentMentionsDate("kelly transfer 1307", "2026-06-13")).toBe(false);
  });
});

describe("alias matching (learned bank names)", () => {
  const playersWithAlias = [
    { id: 1, name: "kelly", norm: "kelly", aliases: ["nguyen thien trang"] },
    { id: 2, name: "Chi", norm: "chi", aliases: [] as string[] },
  ];

  it("matches via learned alias and via username", () => {
    expect(
      pickAutoMatch(
        matchContentToPlayers("NGUYEN THIEN TRANG JUN 13 BADMINTON", playersWithAlias, VOCAB),
      )?.name,
    ).toBe("kelly");
    expect(
      pickAutoMatch(matchContentToPlayers("kelly jun 13 badminton", playersWithAlias, VOCAB))?.name,
    ).toBe("kelly");
  });

  it("one transfer for both: alias + username", () => {
    expect(
      matchAllInContent("NGUYEN THIEN TRANG CHI JUN 13", playersWithAlias, VOCAB)
        .map((m) => m.name)
        .sort(),
    ).toEqual(["Chi", "kelly"]);
  });
});

describe("extractAliasFromContent (bank-name learning)", () => {
  const x = (content: string, known: string[]) => extractAliasFromContent(content, known, VOCAB);

  it("learns from template and default-desc contents", () => {
    expect(x("NGUYEN THIEN TRANG JUN 13 BADMINTON", ["kelly"])).toBe("nguyen thien trang");
    expect(x("MBVCB.12345.NGUYEN THIEN TRANG chuyen tien.CT tu 0123", ["kelly"])).toBe(
      "nguyen thien trang",
    );
    expect(x("TRAN NGUYEN DUC MINH chuyen tien FT26164000303242", ["Minh Tran"])).toBe(
      "tran nguyen duc minh",
    );
  });

  it("returns null when nothing meaningful remains", () => {
    expect(x("CK 13/6 badminton 110k", ["kelly"])).toBeNull();
  });

  it("keeps transfer keywords out of learned names", () => {
    expect(x("TRANSFERS ANTOINE TRAN", ["Minh"])).toBe("antoine tran");
    expect(x("ANTOINE TRAN TRANSFERS", ["Minh"])).toBe("antoine tran");
  });

  it("keeps the full realname containing the username token; stops at FT refs", () => {
    expect(x("DANG THU HIEN FT26166016673576", ["Hiền"])).toBe("dang thu hien");
    expect(x("DANG THU HIEN chuyen tien FT123", ["Hiền"])).toBe("dang thu hien");
  });

  it("full month names are memo noise, same as short forms", () => {
    expect(x("NGUYEN THIEN TRANG JUNE 13 BADMINTON", ["kelly"])).toBe("nguyen thien trang");
    expect(x("DANG THU HIEN OCTOBER 5 CK", ["Hiền"])).toBe("dang thu hien");
    expect(sanitizeRealName("DANG THU HIEN JUNE", ["Hiền"], VOCAB)).toBeNull();
  });

  it("never re-learns the player's own username", () => {
    expect(x("Ngoc-Anh jun 13 badminton", ["Ngoc-Anh Mai"])).toBeNull();
  });

  it("pronoun tokens (anh/chi/em) continue a run that has unknown tokens", () => {
    expect(x("NGUYEN THI KIM CHI JUN 13 BADMINTON", ["chi"])).toBe("nguyen thi kim chi");
    expect(x("TRAN NGOC ANH JUN 13 CK", ["kelly"])).toBe("tran ngoc anh");
    expect(x("NGUYEN THI ANH chuyen tien FT123", ["chi"])).toBe("nguyen thi anh");
    expect(x("NGUYEN NGOC ANH JUN 13 BADMINTON", ["kelly"])).toBe("nguyen ngoc anh");
  });

  it("multi-player 'KELLY CHI' never extends kelly's alias", () => {
    expect(x("KELLY CHI JUN 13 CK", ["kelly"])).toBeNull();
  });
});

describe("alias-match with pronoun-tail alias", () => {
  it("resolves cleanly and wins over a partial sibling", () => {
    const chiWithFullAlias = [{ id: 1, name: "Chi", norm: "chi", aliases: ["nguyen thi kim chi"] }];
    const m = pickAutoMatch(
      matchContentToPlayers("NGUYEN THI KIM CHI JUN 20 BADMINTON", chiWithFullAlias, VOCAB),
    );
    expect(m?.name).toBe("Chi");
    expect(m?.matchedNorm).toBe("nguyen thi kim chi");

    const twoCandidates = [
      { id: 1, name: "Chi", norm: "chi", aliases: ["nguyen thi kim chi"] },
      { id: 2, name: "Minh Chi", norm: "minh chi", aliases: [] as string[] },
    ];
    const m2 = pickAutoMatch(
      matchContentToPlayers("NGUYEN THI KIM CHI JUN 20 BADMINTON", twoCandidates, VOCAB),
    );
    expect(m2?.name).toBe("Chi");
  });
});

describe("sanitizeRealName", () => {
  const s = (raw: string, known: string[]) => sanitizeRealName(raw, known, VOCAB);

  it("validates candidate names before learning", () => {
    expect(s("DANG THU HIEN", ["Hiền"])).toBe("dang thu hien");
    expect(s("DANG THU HIEN TRANSFER", ["Hiền"])).toBeNull(); // stopword
    expect(s("DANG THU HIEN FT26166", ["Hiền"])).toBeNull(); // ref/digit
    expect(s("The payer name is DANG THU HIEN", ["Hiền"])).toBeNull(); // >6 tokens
    expect(s("NGUYEN NGOC ANH", ["kelly"])).toBe("nguyen ngoc anh"); // "anh" là tên thật
    expect(s("Hiền", ["Hiền"])).toBeNull(); // nothing new
  });
});

describe("stripNameNoise", () => {
  it("drops months/refs/sport words, keeps pronoun name syllables", () => {
    expect(stripNameNoise("nguyen ngoc anh jun 13 badminton ft123", VOCAB)).toBe("nguyen ngoc anh");
  });
});

describe("VN family-name-first ranking", () => {
  it("never auto-matches but ranks the fuller name first", () => {
    expect(autoMatch("TRAN LE DUC MINH jun 13 badminton")).toBeNull();
    const ranked = matchContentToPlayers("TRAN LE DUC MINH jun 13 badminton", players, VOCAB);
    expect(ranked[0]!.name).toBe("Minh Tran");
    expect(ranked[1]!.name).toBe("Minh");
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it("contiguous full-name hit still auto-matches despite the shared token", () => {
    expect(autoMatch("MINH TRAN JUN 13 BADMINTON")?.name).toBe("Minh Tran");
  });
});

describe("parsePlusOneSuffix / hostFromPlusOneLabel", () => {
  it("splits glued '<guest> <host>'s +1' labels", () => {
    expect(parsePlusOneSuffix("Hao Chung's +1")).toEqual({ name: "Hao", host: "Chung" });
    expect(parsePlusOneSuffix("Chi kelly's +1")).toEqual({ name: "Chi", host: "kelly" });
    expect(parsePlusOneSuffix("Hao Chung’s +1")).toEqual({ name: "Hao", host: "Chung" }); // curly '
    expect(parsePlusOneSuffix("Maggie +1")).toEqual({ name: "Maggie", host: null });
    expect(parsePlusOneSuffix("Minh Tran")).toEqual({ name: "Minh Tran", host: null });
    expect(parsePlusOneSuffix("Ngoc-Anh Mai")).toEqual({ name: "Ngoc-Anh Mai", host: null });
    expect(parsePlusOneSuffix("Hao Ngoc-Anh Mai's +1", ["Ngoc-Anh Mai"])).toEqual({
      name: "Hao",
      host: "Ngoc-Anh Mai",
    });
  });

  it("parses hosts from clean labels", () => {
    expect(hostFromPlusOneLabel("Chung's +1")).toBe("Chung");
    expect(hostFromPlusOneLabel("Ngoc-Anh Mai's +1")).toBe("Ngoc-Anh Mai");
    expect(hostFromPlusOneLabel("Friend")).toBeNull();
  });
});

describe("one legal name never becomes multiple payers (fail-closed)", () => {
  const kimChiRoster = ["Kim", "Chi", "kelly", "Thad"].map((name, i) => ({
    id: i + 1,
    name,
    norm: normalizeName(name),
  }));

  it("legal-name fragments (roster Kim + Chi) match nobody", () => {
    expect(matchAllInContent("NGUYEN THI KIM CHI JUN 13 BADMINTON", kimChiRoster, VOCAB)).toEqual(
      [],
    );
    // rule 3 must not resurrect the pair either
    expect(
      matchWithConfidence({
        content: "NGUYEN THI KIM CHI chuyen khoan badminton jun 13",
        sessionDate: "2026-06-13",
        players: kimChiRoster,
        sportPhrases: PHRASES,
        vocab: VOCAB,
      }),
    ).toEqual([]);
  });

  it("a genuine payer list (all tokens roster-known) still matches", () => {
    expect(
      matchAllInContent("kim chi jun 13 badminton", kimChiRoster, VOCAB)
        .map((m) => m.name)
        .sort(),
    ).toEqual(["Chi", "Kim"]);
    expect(
      matchAllInContent("kelly thad jun 13", kimChiRoster, VOCAB)
        .map((m) => m.name)
        .sort(),
    ).toEqual(["Thad", "kelly"]);
  });

  it("alias-known tokens count as known (kelly-via-alias + Chi stays a pair)", () => {
    const playersWithAlias = [
      { id: 1, name: "kelly", norm: "kelly", aliases: ["nguyen thien trang"] },
      { id: 2, name: "Chi", norm: "chi", aliases: [] as string[] },
    ];
    expect(
      matchAllInContent("NGUYEN THIEN TRANG CHI JUN 13", playersWithAlias, VOCAB)
        .map((m) => m.name)
        .sort(),
    ).toEqual(["Chi", "kelly"]);
  });
});

describe("sport tokens never match as names (fail-closed)", () => {
  it("memo that is ONLY sport words matches nobody, even a player named Long", () => {
    const roster = ["Long", "Cau Long", "kelly"].map((name, i) => ({
      id: i + 1,
      name,
      norm: normalizeName(name),
    }));
    const cands = matchContentToPlayers("CAU LONG JUN 13", roster, VOCAB);
    expect(cands).toEqual([]);
    expect(pickAutoMatch(cands)).toBeNull();
  });

  it("a name with a real token alongside a sport token still matches", () => {
    const roster = [{ id: 1, name: "Long Nguyen", norm: normalizeName("Long Nguyen") }];
    expect(
      pickAutoMatch(matchContentToPlayers("NGUYEN LONG cau long jun 13", roster, VOCAB))?.name,
    ).toBe("Long Nguyen");
  });

  it("pronoun-syllable names (Chi/Anh) stay matchable — they are real names", () => {
    expect(autoMatch("chi jun 13 badminton")?.name).toBe("Chi");
  });
});

describe("keyword detectors", () => {
  it("hasTransferKeyword", () => {
    expect(hasTransferKeyword("kelly chuyen khoan badminton jun 13")).toBe(true);
    expect(hasTransferKeyword("JASON POON CHUYEN TIEN")).toBe(true);
    expect(hasTransferKeyword("CK 13/6 badminton 110k")).toBe(true); // ck đứng riêng
    expect(hasTransferKeyword("good luck kelly")).toBe(false); // "luck" không phải "ck"
    expect(hasTransferKeyword("kelly jun 13 badminton")).toBe(false);
  });

  it("hasSportKeyword (generalized hasBadmintonKeyword)", () => {
    expect(hasSportKeyword("kelly jun 13 badminton", PHRASES)).toBe(true);
    expect(hasSportKeyword("kelly cau long 13/6", PHRASES)).toBe(true);
    expect(hasSportKeyword("kelly chuyen tien", PHRASES)).toBe(false);
  });
});

describe("dayDiffFromSession", () => {
  it("computes tx − session in days", () => {
    expect(dayDiffFromSession("2026-06-13 10:00:00", "2026-06-13")).toBe(0);
    expect(dayDiffFromSession("2026-06-12 23:59:00", "2026-06-13")).toBe(-1);
    expect(dayDiffFromSession("2026-06-14 00:01:00", "2026-06-13")).toBe(1);
    expect(dayDiffFromSession("2026-06-10", "2026-06-13")).toBe(-3);
    expect(dayDiffFromSession("bogus", "2026-06-13")).toBeNull();
  });
});

describe("isUniqueInSession", () => {
  it("unique realname vs subset/superset overlap", () => {
    expect(isUniqueInSession(2, "kelly chuyen khoan badminton jun 13", players, VOCAB)).toBe(true);
    expect(isUniqueInSession(4, "MINH chuyen khoan jun 13", players, VOCAB)).toBe(false); // "Minh" ⊂ "Minh Tran"
    expect(isUniqueInSession(13, "MINH chuyen khoan jun 13", players, VOCAB)).toBe(false);
  });

  it("shared-token strong candidates are NEVER unique (wrong-member guard)", () => {
    // Legal name "TRAN LE DUC MINH" makes Minh Tran / Minh / Tran Duc all
    // plausible. "Tran Duc" merely SHARES "tran" (no subset relation) — it
    // must still be ambiguous, or rule1 would propose 100% for the wrong member.
    const memo = "TRAN LE DUC MINH chuyen khoan badminton jun 13";
    expect(isUniqueInSession(5, memo, players, VOCAB)).toBe(false); // Tran Duc
    expect(isUniqueInSession(13, memo, players, VOCAB)).toBe(false); // Minh Tran
    expect(isUniqueInSession(4, memo, players, VOCAB)).toBe(false); // Minh
  });
});

describe("matchWithConfidence (rules on top of similarity)", () => {
  const conf = (content: string, txDate?: string) =>
    matchWithConfidence({
      content,
      sessionDate: "2026-06-13",
      players,
      txDate,
      sportPhrases: PHRASES,
      vocab: VOCAB,
    });
  const pctOf = (content: string, name: string, txDate?: string) =>
    conf(content, txDate).find((m) => m.name === name);

  it("no transfer keyword → similarity labels only", () => {
    expect(pctOf("chi jun 13 badminton", "Chi")?.pct).toBe(90);
    expect(pctOf("chi jun 13 badminton", "Chi")?.reason).toBe("similarity");
    expect(pctOf("kelly jun 13 badminton", "kelly")?.pct).toBe(100);
  });

  it("Rule 1: transfer + sport + date, unique → 100%", () => {
    const m = pctOf("kelly chuyen khoan badminton jun 13", "kelly");
    expect(m?.pct).toBe(100);
    expect(m?.reason).toBe("rule1");
    expect(pctOf("kelly transfer badminton 1306", "kelly")?.reason).toBe("rule1");
  });

  it("Rule 2: tx-date proximity when no sport/date in content", () => {
    expect(pctOf("THAD CHUYEN TIEN", "Thad", "2026-06-13 09:00:00")?.pct).toBe(100);
    expect(pctOf("THAD CHUYEN TIEN", "Thad", "2026-06-13 09:00:00")?.reason).toBe("rule2-sameday");
    expect(pctOf("THAD CHUYEN TIEN", "Thad", "2026-06-12 09:00:00")?.pct).toBe(99);
    expect(pctOf("THAD CHUYEN TIEN", "Thad", "2026-06-12 09:00:00")?.reason).toBe("rule2-window");
    expect(pctOf("THAD CHUYEN TIEN", "Thad", "2026-06-14 23:00:00")?.reason).toBe("rule2-window");
    expect(pctOf("THAD CHUYEN TIEN", "Thad", "2026-06-09 09:00:00")?.reason).toBe("similarity");
    expect(pctOf("THAD CHUYEN TIEN", "Thad", "2026-06-09 09:00:00")?.pct).toBe(90);
  });

  it("Rule 3: player + buddy, both unique, sport + date → 99% each", () => {
    const ms = conf("chi thad chuyen khoan badminton jun 13");
    expect(ms.find((m) => m.name === "Chi")?.pct).toBe(99);
    expect(ms.find((m) => m.name === "Chi")?.reason).toBe("rule3");
    expect(ms.find((m) => m.name === "Thad")?.pct).toBe(99);
    expect(ms.find((m) => m.name === "Thad")?.reason).toBe("rule3");
  });

  it("legal-name memo with shared-surname roster proposes NOTHING (fail-closed)", () => {
    expect(conf("TRAN LE DUC MINH chuyen khoan badminton jun 13")).toEqual([]);
    expect(conf("TRAN LE DUC MINH chuyen tien", "2026-06-13 09:00:00")).toEqual([]);
  });

  it("PRESERVE: ambiguity guards still refuse; auto-match set unchanged", () => {
    expect(conf("MINH chuyen khoan badminton jun 13")).toEqual([]);
    expect(conf("MINH JUN 13 BADMINTON")).toEqual([]);
    expect(
      conf("kelly chi jun 13 badminton")
        .map((m) => m.name)
        .sort(),
    ).toEqual(["Chi", "kelly"]);
  });
});

describe("pay-code extraction (config-driven, DD-02)", () => {
  const CFG: PayCodeConfig = { prefix: "BMT", skipCodes: new Set(["BMTRANS", "BMTRAN"]) };

  it("extracts valid codes anywhere in the memo", () => {
    expect(extractPayCode("BMT7Q2A jun13", CFG)).toBe("BMT7Q2A");
    expect(extractPayCode("abc bmt7q2a badminton", CFG)).toBe("BMT7Q2A");
    expect(extractPayCode("BMT2AXY badminton", CFG)).toBe("BMT2AXY");
    expect(extractPayCode("BMT7q2a jun13", CFG)).toBe("BMT7Q2A");
    expect(extractPayCode("bmt7Q2A jun13", CFG)).toBe("BMT7Q2A");
    expect(extractPayCode("NGOCANHBADMINTONBMT7Q2A", CFG)).toBe("BMT7Q2A"); // squashed memo
  });

  it("rejects invalid/absent codes", () => {
    expect(extractPayCode("NGOC ANH JUN 13 BADMINTON", CFG)).toBeNull();
    expect(extractPayCode("BMTAB badminton", CFG)).toBeNull(); // 2-char suffix
    expect(extractPayCode("BMT7Q2 jun13", CFG)).toBeNull(); // 3-char suffix
    expect(extractPayCode("7Q2ABCD badminton", CFG)).toBeNull(); // no prefix
    expect(extractPayCode("BMT0ABC badminton", CFG)).toBeNull(); // 0
    expect(extractPayCode("BMTOABC badminton", CFG)).toBeNull(); // O
    expect(extractPayCode("BMT1ABC badminton", CFG)).toBeNull(); // 1
    expect(extractPayCode("BMTIABC badminton", CFG)).toBeNull(); // I
  });

  it("skips noise words but finds real codes after them", () => {
    expect(extractPayCode("BMTRANS ok", CFG)).toBeNull();
    expect(extractPayCode("BMTRANS BMT7Q2A badminton", CFG)).toBe("BMT7Q2A");
  });

  it("all-digit suffixes are never valid (mirrors generator guard)", () => {
    expect(extractPayCode("BMT2345 badminton", CFG)).toBeNull();
  });

  it("counts distinct valid codes", () => {
    expect(countPayCodes("BMT7Q2A BMT7Q2A", CFG)).toBe(1);
    expect(countPayCodes("BMT7Q2A BMT2AXY", CFG)).toBe(2);
    expect(countPayCodes("BMTRANS BMT2345", CFG)).toBe(0);
  });

  it("works with a different tenant prefix", () => {
    const cfg: PayCodeConfig = { prefix: "PLX" };
    expect(extractPayCode("PLX7Q2A jun13 pickleball", cfg)).toBe("PLX7Q2A");
    expect(extractPayCode("BMT7Q2A jun13", cfg)).toBeNull();
  });
});
