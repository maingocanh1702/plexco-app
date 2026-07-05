import { describe, expect, it } from "vitest";
import { parseFlexibleDate, fmtDate, fmtDateShort, parseTimeAtStart, parseMoney } from "./dates.js";

// NOW = Fri 2026-06-12 (mirrors the lifted production suite)
const NOW = new Date("2026-06-12T12:00:00");

describe("parseFlexibleDate", () => {
  it("parses explicit forms", () => {
    expect(parseFlexibleDate("2026-06-13 D2 Saturday", NOW)).toEqual({
      iso: "2026-06-13",
      rest: "D2 Saturday",
    });
    expect(parseFlexibleDate("2026 Jun 13 D2 Saturday", NOW)).toEqual({
      iso: "2026-06-13",
      rest: "D2 Saturday",
    });
    expect(parseFlexibleDate("Jun 13", NOW)).toEqual({ iso: "2026-06-13", rest: "" });
    expect(parseFlexibleDate("13/6 D2", NOW)).toEqual({ iso: "2026-06-13", rest: "D2" });
  });

  it("infers next year for dates far in the past", () => {
    expect(parseFlexibleDate("Jan 5", NOW)?.iso).toBe("2027-01-05");
  });

  it("returns null when no date", () => {
    expect(parseFlexibleDate("D2 Saturday Session", NOW)).toBeNull();
  });

  it("rejects impossible calendar dates (never emits a fake ISO)", () => {
    expect(parseFlexibleDate("31/2 D2", NOW)).toBeNull();
    expect(parseFlexibleDate("2026-13-40", NOW)).toBeNull();
    expect(parseFlexibleDate("2026-02-29", NOW)).toBeNull(); // 2026 not leap
    expect(parseFlexibleDate("Feb 29", NOW)).toBeNull(); // inferred year not leap
    expect(parseFlexibleDate("29/2/2028 D2", NOW)).toEqual({ iso: "2028-02-29", rest: "D2" }); // leap ok
    expect(parseFlexibleDate("2026 Jun 31 D2", NOW)).toBeNull(); // Jun has 30 days
  });

  it("parses relative keywords (vi + en)", () => {
    expect(parseFlexibleDate("today", NOW)).toEqual({ iso: "2026-06-12", rest: "" });
    expect(parseFlexibleDate("hôm nay D2", NOW)).toEqual({ iso: "2026-06-12", rest: "D2" });
    expect(parseFlexibleDate("tmr 10:00 D2", NOW)).toEqual({ iso: "2026-06-13", rest: "10:00 D2" });
    expect(parseFlexibleDate("tomorrow", NOW)).toEqual({ iso: "2026-06-13", rest: "" });
    expect(parseFlexibleDate("ngày mai", NOW)).toEqual({ iso: "2026-06-13", rest: "" });
  });

  it("parses weekday keywords (next occurrence, today counts)", () => {
    expect(parseFlexibleDate("sat D2", NOW)?.iso).toBe("2026-06-13"); // mai là thứ 7
    expect(parseFlexibleDate("t7", NOW)?.iso).toBe("2026-06-13");
    expect(parseFlexibleDate("cn", NOW)?.iso).toBe("2026-06-14");
    expect(parseFlexibleDate("fri", NOW)?.iso).toBe("2026-06-12"); // hôm nay là thứ 6
  });
});

describe("formatting", () => {
  it("fmtDate / fmtDateShort", () => {
    expect(fmtDate("2026-06-13")).toBe("2026 Jun 13");
    expect(fmtDateShort("2026-06-13")).toBe("Jun 13");
  });
});

describe("parseTimeAtStart", () => {
  it("parses supported time forms", () => {
    expect(parseTimeAtStart("9:00 D2")).toEqual({ time: "09:00", rest: "D2" });
    expect(parseTimeAtStart("9:00-11:00")).toEqual({ time: "09:00", rest: "-11:00" });
    expect(parseTimeAtStart("9:00 - 11:00")).toEqual({ time: "09:00", rest: "- 11:00" });
    expect(parseTimeAtStart("7pm-9pm")).toEqual({ time: "19:00", rest: "-9pm" });
    expect(parseTimeAtStart("19h30")).toEqual({ time: "19:30", rest: "" });
    expect(parseTimeAtStart("D2 Saturday")).toBeNull();
  });

  it("rejects invalid 12-hour clock values (am/pm hours are 1..12)", () => {
    expect(parseTimeAtStart("13pm D2")).toBeNull();
    expect(parseTimeAtStart("23:00pm D2")).toBeNull();
    expect(parseTimeAtStart("0am D2")).toBeNull();
    expect(parseTimeAtStart("12am D2")).toEqual({ time: "00:00", rest: "D2" });
    expect(parseTimeAtStart("12pm D2")).toEqual({ time: "12:00", rest: "D2" });
  });
});

describe("parseMoney", () => {
  it("parses VN money shorthand into integer minor units", () => {
    expect(parseMoney("110k")).toBe(110000);
    expect(parseMoney("110000")).toBe(110000);
    expect(parseMoney("110.000")).toBe(110000);
    expect(parseMoney("110k vnd")).toBe(110000);
    expect(parseMoney("abc")).toBeNull();
  });
});
