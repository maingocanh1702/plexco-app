import { validateDisplayName } from "@plexco/db";
import { describe, expect, it } from "vitest";
import {
  VENUE_ADDRESS_MAX,
  buildCreateBody,
  buildUpdateBody,
  emptyFormValues,
  hasHiddenChar,
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

describe("validateForm venueAddress cap (DD-128 OD-4a, 200 UTF-16 code units)", () => {
  const addr = (n: number) => "\u0111".repeat(n); // d-stroke: 1 code unit each
  it("pins the cap at 200, the same number the input maxLength and hint use", () => {
    expect(VENUE_ADDRESS_MAX).toBe(200);
  });
  it("accepts 200 and rejects 201 on create, pinned to the Address field only", () => {
    expect(validateForm(base({ venueAddress: addr(200) }), TZ, en)).toEqual({});
    const e = validateForm(base({ venueAddress: addr(201) }), TZ, en);
    expect(Object.keys(e)).toEqual(["venueAddress"]);
    expect(e.venueAddress).toContain("200");
  });
  it("counts the trimmed value (what the body sends), so padding never trips the cap", () => {
    expect(validateForm(base({ venueAddress: `  ${addr(200)}  ` }), TZ, en)).toEqual({});
  });
  it("edit: an untouched legacy 250-char address does not block saving other fields", () => {
    const legacy = base({ venueAddress: addr(250) });
    expect(validateForm({ ...legacy, venueName: "Sân B" }, TZ, en, legacy)).toEqual({});
  });
  it("edit: once the legacy address is changed and still over 200, the Address field is flagged", () => {
    const legacy = base({ venueAddress: addr(250) });
    const e = validateForm({ ...legacy, venueAddress: addr(230) }, TZ, en, legacy);
    expect(Object.keys(e)).toEqual(["venueAddress"]);
    expect(validateForm({ ...legacy, venueAddress: addr(200) }, TZ, en, legacy)).toEqual({});
  });
  it("message is a vi/en pair", () => {
    const vi = validateForm(base({ venueAddress: addr(201) }), TZ, (v) => v);
    expect(vi.venueAddress).toBe("Địa chỉ tối đa 200 ký tự.");
  });
});

describe("buildCreateBody", () => {
  it("sends explicit-offset ISO, tenant zone, null slots for unlimited, and the trimmed venueAddress", () => {
    const body = buildCreateBody(
      base({ venueName: " Sân A ", venueAddress: " 1 Nguyễn Văn Linh ", price: "50.000" }),
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
      venueAddress: "1 Nguyễn Văn Linh",
    });
  });

  it("omits a blank venueAddress", () => {
    const body = buildCreateBody(base({ venueAddress: "   " }), TZ);
    expect("venueAddress" in body).toBe(false);
  });
});

describe("buildUpdateBody", () => {
  it("an unusable stored zone round-trips in the fallback zone instead of throwing", () => {
    const odd = { ...session, timezone: "Mars/Olympus_Mons" };
    expect(buildUpdateBody(valuesFromSession(odd), odd)).toBeNull();
  });
  it("returns null when nothing changed (round-trip of the loaded session)", () => {
    expect(buildUpdateBody(valuesFromSession(session), session)).toBeNull();
  });
  it("sends only changed fields; null clears", () => {
    const v = {
      ...valuesFromSession(session),
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
  it("a legacy over-cap address with surrounding spaces is exempted AND not sent (same comparison)", () => {
    const stored = `  ${"x".repeat(250)}  `;
    const legacy = { ...session, venueAddress: stored };
    const form = { ...valuesFromSession(legacy), venueName: "Sân B" };
    expect(validateForm(form, TZ, en, valuesFromSession(legacy))).toEqual({});
    expect(buildUpdateBody(form, legacy)).toEqual({ venueName: "Sân B" });
    expect(buildUpdateBody(valuesFromSession(legacy), legacy)).toBeNull();
  });
  it("an address edited from a legacy over-cap value is still sent and still capped", () => {
    const legacy = { ...session, venueAddress: "x".repeat(250) };
    const edited = { ...valuesFromSession(legacy), venueAddress: "y".repeat(230) };
    expect(Object.keys(validateForm(edited, TZ, en, valuesFromSession(legacy)))).toEqual([
      "venueAddress",
    ]);
    expect(buildUpdateBody(edited, legacy)).toEqual({ venueAddress: "y".repeat(230) });
    const cleared = { ...valuesFromSession(legacy), venueAddress: "  " };
    expect(buildUpdateBody(cleared, legacy)).toEqual({ venueAddress: null });
  });
  it("does not report untouched times as changed when the stored value carries seconds", () => {
    const withSeconds = { ...session, startsAt: "2026-10-20T11:30:42.123Z" };
    expect(buildUpdateBody(valuesFromSession(withSeconds), withSeconds)).toBeNull();
  });
  it("detects a slots change to unlimited and a time change", () => {
    const v = {
      ...valuesFromSession(session),
      slotsUnlimited: true,
      endsAt: "2026-10-20T21:00",
    };
    expect(buildUpdateBody(v, session)).toEqual({
      slotsMax: null,
      endsAt: "2026-10-20T21:00:00+07:00",
    });
  });
});

// Hidden-character rule (web mirror of packages/db/src/text-safety.ts). Characters are built with
// fromCodePoint so no control or bidi character sits in this source.
describe("validateForm hidden characters in venueName, venueAddress and area", () => {
  const ch = (cp: number) => String.fromCodePoint(cp);
  const C8 = [0x0000, 0x202e, 0x200b, 0x2028, 0x2029, 0x000a, 0x0009, 0x001b];
  const FIELDS = ["area", "venueName", "venueAddress"] as const;
  const vi = (v: string) => v;
  const EN_COPY = {
    area: "The area cannot contain control or hidden characters.",
    venueName: "The venue name cannot contain control or hidden characters.",
    venueAddress: "The address cannot contain control or hidden characters.",
  };
  const VI_COPY = {
    area: "Khu vực không được chứa ký tự điều khiển hoặc ký tự ẩn.",
    venueName: "Tên sân không được chứa ký tự điều khiển hoặc ký tự ẩn.",
    venueAddress: "Địa chỉ không được chứa ký tự điều khiển hoặc ký tự ẩn.",
  };

  it("W1: each of the 8 characters in an inner position flags exactly that field (en copy)", () => {
    for (const field of FIELDS) {
      for (const cp of C8) {
        const e = validateForm(base({ [field]: "Sân" + ch(cp) + "A" }), TZ, en);
        expect(Object.keys(e)).toEqual([field]);
        expect(e[field]).toBe(EN_COPY[field]);
      }
    }
  });

  it("W2: the vi copy is distinct per field", () => {
    for (const field of FIELDS) {
      const e = validateForm(base({ [field]: "Sân" + ch(0x202e) + "A" }), TZ, vi);
      expect(e[field]).toBe(VI_COPY[field]);
    }
    expect(new Set(Object.values(VI_COPY)).size).toBe(3);
  });

  it("W3: Vietnamese NFC, NFD, an emoji with VS16 and the empty value are accepted", () => {
    const texts = [
      "Sân Quận Tân Bình",
      "Sân Quận Tân Bình".normalize("NFD"),
      "Sân " + ch(0x2764) + ch(0xfe0f),
      "",
    ];
    for (const field of FIELDS) {
      for (const text of texts) expect(validateForm(base({ [field]: text }), TZ, en)).toEqual({});
    }
  });

  it("W4: an edge newline or tab is trimmed and never sent, so it is no error", () => {
    expect(validateForm(base({ venueName: "Sân A" + ch(0x000a) }), TZ, en)).toEqual({});
    expect(validateForm(base({ area: ch(0x0009) + "Quận 1" }), TZ, en)).toEqual({});
    const body = buildCreateBody(base({ venueName: "Sân A" + ch(0x000a) }), TZ);
    expect(body.venueName).toBe("Sân A");
  });

  it("W5: edit mode skips an untouched legacy value but flags an edited one", () => {
    const legacy = "Sân" + ch(0x202e) + "A";
    const orig: SessionDetailDto = { ...session, venueName: legacy, area: "Q7" };
    const initial = valuesFromSession(orig);
    expect(validateForm({ ...initial, area: "Q8" }, TZ, en, initial)).toEqual({});
    expect(buildUpdateBody({ ...initial, area: "Q8" }, orig)).toEqual({ area: "Q8" });
    const edited = { ...initial, venueName: "Sân" + ch(0x200b) + "B" };
    expect(Object.keys(validateForm(edited, TZ, en, initial))).toEqual(["venueName"]);
  });

  it("W6: an over-cap address with a hidden character shows only the cap message", () => {
    const address = "đ".repeat(VENUE_ADDRESS_MAX) + ch(0x200b);
    expect(address.length).toBe(VENUE_ADDRESS_MAX + 1);
    const e = validateForm(base({ venueAddress: address }), TZ, en);
    expect(e.venueAddress).toBe(`The address is at most ${VENUE_ADDRESS_MAX} characters.`);
  });

  it("a public session with a hidden-character area shows the hidden message, not the area-needed one", () => {
    const e = validateForm(
      base({
        visibility: "public",
        slotsMax: "8",
        slotsUnlimited: false,
        area: "Quận" + ch(0x202e) + "1",
      }),
      TZ,
      en,
    );
    expect(e.area).toBe(EN_COPY.area);
  });

  it("W7: the client mirror equals validateDisplayName's hidden-character rule over every scalar", () => {
    const mismatches: number[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const c = ch(cp);
      let serverHidden = false;
      try {
        validateDisplayName("a" + c + "b");
      } catch {
        serverHidden = true;
      }
      if (hasHiddenChar(c) !== serverHidden) mismatches.push(cp);
    }
    expect(mismatches).toEqual([]);
  });
});
