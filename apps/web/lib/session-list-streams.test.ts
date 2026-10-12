import { describe, expect, it } from "vitest";
import { hasMorePages, tabStatuses, visibleSessions, type Stream } from "./session-list-streams";
import type { SessionListItemDto } from "./sessions-api";

const mk = (id: string, startsAt: string, status = "open"): SessionListItemDto =>
  ({ id, startsAt, status }) as SessionListItemDto;
const stream = (
  status: string | undefined,
  items: SessionListItemDto[],
  hasMore = false,
): Stream => ({
  status,
  items,
  cursor: hasMore ? "next" : null,
  hasMore,
});
const NOW = Date.parse("2026-10-20T00:00:00Z");

describe("tabStatuses", () => {
  it("maps tabs to API status streams", () => {
    expect(tabStatuses("all")).toEqual([undefined]);
    expect(tabStatuses("upcoming")).toEqual(["open"]);
    expect(tabStatuses("draft")).toEqual(["draft"]);
    expect(tabStatuses("closed")).toEqual(["closed", "cancelled"]);
  });
});

describe("visibleSessions", () => {
  it("merges closed + cancelled newest first", () => {
    const out = visibleSessions(
      [
        stream("closed", [mk("c2", "2026-10-10T10:00:00Z"), mk("c1", "2026-10-01T10:00:00Z")]),
        stream("cancelled", [mk("x1", "2026-10-05T10:00:00Z")]),
      ],
      "closed",
      NOW,
    );
    expect(out.map((s) => s.id)).toEqual(["c2", "x1", "c1"]);
  });

  it("upcoming keeps only open sessions that have not started (client-side)", () => {
    const out = visibleSessions(
      [stream("open", [mk("f", "2026-10-25T10:00:00Z"), mk("p", "2026-10-01T10:00:00Z")])],
      "upcoming",
      NOW,
    );
    expect(out.map((s) => s.id)).toEqual(["f"]);
  });

  it("hides rows older than the newest unfinished stream boundary so later pages never insert above", () => {
    const out = visibleSessions(
      [
        stream("closed", [mk("a", "2026-10-10T00:00:00Z"), mk("b", "2026-10-08T00:00:00Z")], true),
        stream(
          "cancelled",
          [mk("c", "2026-10-09T00:00:00Z"), mk("d", "2026-10-02T00:00:00Z")],
          true,
        ),
      ],
      "closed",
      NOW,
    );
    // boundaries: b (10-08) and d (10-02); the newest is 10-08 -> d is hidden until more loads.
    expect(out.map((s) => s.id)).toEqual(["a", "c", "b"]);
  });

  it("shows everything once no stream has more pages", () => {
    const out = visibleSessions(
      [
        stream("closed", [mk("a", "2026-10-10T00:00:00Z")]),
        stream("cancelled", [mk("d", "2026-10-02T00:00:00Z")]),
      ],
      "closed",
      NOW,
    );
    expect(out).toHaveLength(2);
  });

  it("orders equal start times by id descending", () => {
    const out = visibleSessions(
      [stream(undefined, [mk("a1", "2026-10-10T00:00:00Z"), mk("a2", "2026-10-10T00:00:00Z")])],
      "all",
      NOW,
    );
    expect(out.map((s) => s.id)).toEqual(["a2", "a1"]);
  });
});

describe("hasMorePages", () => {
  it("is true when any stream has more", () => {
    expect(hasMorePages([stream("a", [], false), stream("b", [], true)])).toBe(true);
    expect(hasMorePages([stream("a", [], false)])).toBe(false);
  });
});
