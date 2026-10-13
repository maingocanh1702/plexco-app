import { describe, expect, it } from "vitest";
import {
  buildCreateBody,
  buildUpdateBody,
  emptyFormValues,
  validateForm,
  valuesFromSession,
  type SessionFormValues,
} from "./session-form-model";
import type { SessionDetailDto } from "./sessions-api";

const TZ = "Asia/Ho_Chi_Minh";
const en = (_vi: string, e: string) => e;
const base = (over: Partial<SessionFormValues> = {}): SessionFormValues => ({
  ...emptyFormValues(),
  sportId: "sport-1",
  startsAt: "2026-10-20T18:30",
  endsAt: "2026-10-20T20:00",
  ...over,
});

const session: SessionDetailDto = {
  id: "s1",
  sportId: "sport-1",
  sportKey: "badminton",
  sportName: "Cầu lông",
  startsAt: "2026-10-20T11:30:00.000Z",
  endsAt: "2026-10-20T13:00:00.000Z",
  timezone: TZ,
  venueName: "Sân A",
  venueAddress: null,
  area: "Q7",
  skillLevel: null,
  priceAmount: 50000,
  slotsMax: 12,
  visibility: "private",
  joinPolicy: "open",
  status: "draft",
  version: 4,
  allowPlayerInvite: false,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  players: [],
  guestNotes: [],
  counts: { active: 0, waitlisted: 0, guestNotes: 0, occupied: 0 },
};

describe("validateForm", () => {
  it("accepts a minimal private session", () => {
    expect(validateForm(base(), TZ, en)).toEqual({});
  });
  it("requires sport and times; end must be after start", () => {
    const e = validateForm(base({ sportId: "", startsAt: "", endsAt: "" }), TZ, en);
    expect(Object.keys(e).sort()).toEqual(["endsAt", "sportId", "startsAt"]);
    expect(validateForm(base({ endsAt: "2026-10-20T18:30" }), TZ, en).endsAt).toContain("after");
    expect(validateForm(base({ endsAt: "2026-10-20T17:00" }), TZ, en).endsAt).toContain("after");
  });
  it("validates price and finite slots", () => {
    expect(validateForm(base({ price: "" }), TZ, en).price).toBeDefined();
    expect(validateForm(base({ price: "9999999999" }), TZ, en).price).toBeDefined();
    expect(
      validateForm(base({ slotsUnlimited: false, slotsMax: "0" }), TZ, en).slotsMax,
    ).toBeDefined();
    expect(
      validateForm(base({ slotsUnlimited: false, slotsMax: "1.5" }), TZ, en).slotsMax,
    ).toBeDefined();
    expect(validateForm(base({ slotsUnlimited: false, slotsMax: "10" }), TZ, en)).toEqual({});
  });
  it("public needs an area and finite slots (MISSING_DISCOVERY_FIELDS)", () => {
    const e = validateForm(base({ visibility: "public" }), TZ, en);
    expect(e.area).toBeDefined();
    expect(e.slotsMax).toBeDefined();
    expect(
      validateForm(
        base({ visibility: "public", area: "Q7", slotsUnlimited: false, slotsMax: "8" }),
        TZ,
        en,
      ),
    ).toEqual({});
  });
});

describe("buildCreateBody", () => {
  it("sends explicit-offset ISO, tenant zone, null slots for unlimited, and no venueAddress", () => {
    const body = buildCreateBody(
      base({ venueName: " Sân A ", venueAddress: "ignored", price: "50.000" }),
      TZ,
    );
    expect(body).toEqual({
      sportId: "sport-1",
      startsAt: "2026-10-20T18:30:00+07:00",
      endsAt: "2026-10-20T20:00:00+07:00",
      timezone: TZ,
      priceAmount: 50000,
      slotsMax: null,
      visibility: "private",
      joinPolicy: "open",
      venueName: "Sân A",
    });
    expect("venueAddress" in body).toBe(false);
  });
});

describe("buildUpdateBody", () => {
  it("an unusable stored zone round-trips in the fallback zone instead of throwing", () => {
    const odd = { ...session, timezone: "Mars/Olympus_Mons" };
    expect(buildUpdateBody(valuesFromSession(odd, "vi"), odd)).toBeNull();
  });
  it("returns null when nothing changed (round-trip of the loaded session)", () => {
    expect(buildUpdateBody(valuesFromSession(session, "vi"), session)).toBeNull();
  });
  it("sends only changed fields; null clears", () => {
    const v = {
      ...valuesFromSession(session, "vi"),
      price: "60.000",
      area: "",
      venueAddress: "1 Nguyễn Văn Linh",
    };
    expect(buildUpdateBody(v, session)).toEqual({
      priceAmount: 60000,
      area: null,
      venueAddress: "1 Nguyễn Văn Linh",
    });
  });
  it("does not report untouched times as changed when the stored value carries seconds", () => {
    const withSeconds = { ...session, startsAt: "2026-10-20T11:30:42.123Z" };
    expect(buildUpdateBody(valuesFromSession(withSeconds, "vi"), withSeconds)).toBeNull();
  });
  it("detects a slots change to unlimited and a time change", () => {
    const v = {
      ...valuesFromSession(session, "vi"),
      slotsUnlimited: true,
      endsAt: "2026-10-20T21:00",
    };
    expect(buildUpdateBody(v, session)).toEqual({
      slotsMax: null,
      endsAt: "2026-10-20T21:00:00+07:00",
    });
  });
});
