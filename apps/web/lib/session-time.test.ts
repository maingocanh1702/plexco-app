import { describe, expect, it } from "vitest";
import {
  formatSessionRange,
  isoToLocalInput,
  isValidTimeZone,
  localInputToIso,
  resolveTimeZone,
} from "./session-time";

describe("localInputToIso", () => {
  it("attaches the tenant zone's explicit offset (Vietnam, no DST)", () => {
    expect(localInputToIso("2026-10-20T18:30", "Asia/Ho_Chi_Minh")).toBe(
      "2026-10-20T18:30:00+07:00",
    );
  });

  it("is independent of the browser zone: same wall time, different zones, different instants", () => {
    const ho = Date.parse(localInputToIso("2026-10-20T18:30", "Asia/Ho_Chi_Minh")!);
    const ny = Date.parse(localInputToIso("2026-10-20T18:30", "America/New_York")!);
    expect(ny - ho).toBe(11 * 3600_000); // 07:00 vs -04:00 in October
  });

  it("uses the offset in force on that date (DST)", () => {
    expect(localInputToIso("2026-01-15T09:00", "America/New_York")).toBe(
      "2026-01-15T09:00:00-05:00",
    );
    expect(localInputToIso("2026-07-15T09:00", "America/New_York")).toBe(
      "2026-07-15T09:00:00-04:00",
    );
  });

  it("rejects a wall time skipped by a DST gap and non-existent dates", () => {
    expect(localInputToIso("2026-03-08T02:30", "America/New_York")).toBeNull();
    expect(localInputToIso("2026-02-30T10:00", "Asia/Ho_Chi_Minh")).toBeNull();
    expect(localInputToIso("2026-10-20T25:00", "Asia/Ho_Chi_Minh")).toBeNull();
  });

  it("rejects malformed text and unknown zones", () => {
    expect(localInputToIso("", "Asia/Ho_Chi_Minh")).toBeNull();
    expect(localInputToIso("2026-10-20 18:30", "Asia/Ho_Chi_Minh")).toBeNull();
    expect(localInputToIso("2026-10-20T18:30", "Not/AZone")).toBeNull();
  });

  it("produces a string the server's offset regex accepts", () => {
    const iso = localInputToIso("2026-10-20T18:30", "Asia/Kolkata")!;
    expect(iso).toBe("2026-10-20T18:30:00+05:30");
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/);
  });
});

describe("isoToLocalInput", () => {
  it("round-trips with localInputToIso", () => {
    const iso = localInputToIso("2026-10-20T18:30", "Asia/Ho_Chi_Minh")!;
    expect(isoToLocalInput(iso, "Asia/Ho_Chi_Minh")).toBe("2026-10-20T18:30");
    expect(isoToLocalInput("2026-10-20T11:30:00.000Z", "Asia/Ho_Chi_Minh")).toBe(
      "2026-10-20T18:30",
    );
  });

  it("returns '' for an unparseable instant", () => {
    expect(isoToLocalInput("nope", "Asia/Ho_Chi_Minh")).toBe("");
  });
});

describe("zones + formatting", () => {
  it("validates and falls back", () => {
    expect(isValidTimeZone("Asia/Ho_Chi_Minh")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
    expect(resolveTimeZone(undefined)).toBe("Asia/Ho_Chi_Minh");
    expect(resolveTimeZone("Mars/Base")).toBe("Asia/Ho_Chi_Minh");
    expect(resolveTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it("renders the range in the session zone, not the runner's", () => {
    const out = formatSessionRange(
      "2026-10-20T11:30:00.000Z",
      "2026-10-20T13:00:00.000Z",
      "Asia/Ho_Chi_Minh",
      "vi",
    );
    expect(out).toContain("20/10/2026");
    expect(out).toContain("18:30–20:00");
  });
});

describe("an unusable zone from a DTO falls back instead of throwing", () => {
  const bad = "Mars/Olympus_Mons";
  it("formats and prefills in the fallback zone", () => {
    const iso = "2026-10-20T11:30:00Z"; // 18:30 in Asia/Ho_Chi_Minh
    expect(() => formatSessionRange(iso, "2026-10-20T13:00:00Z", bad, "en")).not.toThrow();
    expect(formatSessionRange(iso, "2026-10-20T13:00:00Z", bad, "en")).toBe(
      formatSessionRange(iso, "2026-10-20T13:00:00Z", "Asia/Ho_Chi_Minh", "en"),
    );
    expect(isoToLocalInput(iso, bad)).toBe("2026-10-20T18:30");
  });
});
