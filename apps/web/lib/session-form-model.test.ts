import { stripInvisibleChars as serverStripInvisibleChars, validateDisplayName } from "@plexco/db";
import { describe, expect, it } from "vitest";
import {
  VENUE_ADDRESS_MAX,
  buildCreateBody,
  buildUpdateBody,
  emptyFormValues,
  hasHiddenChar,
  stripInvisibleChars,
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
  hideExactAddress: false,
  area: "Q7",
  skillLevel: null,
  priceAmount: 50000,
  priceMale: null,
  priceFemale: null,
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
  counts: { active: 0, waitlisted: 0, guestNotes: 0, occupied: 0, slotsOpen: 12 },
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
      priceMale: null,
      priceFemale: null,
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

describe("hideExactAddress (DD-139 D-8, A-11)", () => {
  it("is off by default", () => {
    expect(emptyFormValues().hideExactAddress).toBe(false);
  });

  it("a create body carries it only when on", () => {
    expect("hideExactAddress" in buildCreateBody(base(), TZ)).toBe(false);
    expect(buildCreateBody(base({ hideExactAddress: true }), TZ).hideExactAddress).toBe(true);
  });

  it("the loaded session round-trips to null in both states", () => {
    expect(valuesFromSession(session).hideExactAddress).toBe(false);
    expect(buildUpdateBody(valuesFromSession(session), session)).toBeNull();
    const hidden = { ...session, hideExactAddress: true };
    expect(valuesFromSession(hidden).hideExactAddress).toBe(true);
    expect(buildUpdateBody(valuesFromSession(hidden), hidden)).toBeNull();
  });

  it("turning it on sends exactly the flipped value, and turning it off likewise", () => {
    const on = { ...valuesFromSession(session), hideExactAddress: true };
    expect(buildUpdateBody(on, session)).toEqual({ hideExactAddress: true });
    const hidden = { ...session, hideExactAddress: true };
    const off = { ...valuesFromSession(hidden), hideExactAddress: false };
    expect(buildUpdateBody(off, hidden)).toEqual({ hideExactAddress: false });
  });

  it("a response without the field (older API) loads off and saves nothing extra", () => {
    const older: Partial<SessionDetailDto> = { ...session };
    delete older.hideExactAddress;
    const legacy = older as SessionDetailDto;
    const loaded = valuesFromSession(legacy);
    expect(loaded.hideExactAddress).toBe(false);
    expect(buildUpdateBody(loaded, legacy)).toBeNull();
    expect(buildUpdateBody({ ...loaded, hideExactAddress: true }, legacy)).toEqual({
      hideExactAddress: true,
    });
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
describe("price by gender (DD-39, readiness 4.9)", () => {
  const vi = (v: string) => v;
  const gendered: SessionDetailDto = { ...session, priceMale: 60000, priceFemale: null };

  it("defaults to one price and loads gender mode when either side is stored (null => empty)", () => {
    const single = { priceMode: "single", priceMale: "", priceFemale: "" };
    expect(emptyFormValues()).toMatchObject(single);
    expect(valuesFromSession(session)).toMatchObject(single);
    expect(valuesFromSession(gendered)).toMatchObject({
      priceMode: "gender",
      priceMale: "60.000",
      priceFemale: "",
    });
  });

  it("gender mode keeps the base price required and needs at least one side (vi/en)", () => {
    const e = validateForm(base({ priceMode: "gender", price: "" }), TZ, en);
    expect(e.price).toBe("Enter a price (0 if free).");
    expect(e.priceMale).toBe("Enter at least one price by gender, or choose One price.");
    expect(validateForm(base({ priceMode: "gender" }), TZ, vi).priceMale).toBe(
      "Nhập ít nhất một giá theo giới tính, hoặc chọn Một giá.",
    );
    expect(validateForm(base({ priceMode: "gender", priceFemale: "40.000" }), TZ, en)).toEqual({});
  });

  it("an int4 overflow on a side reuses the invalid-price message; single mode ignores the sides", () => {
    const e = validateForm(
      base({ priceMode: "gender", priceMale: "2.147.483.648", priceFemale: "1".repeat(20) }),
      TZ,
      en,
    );
    expect(e).toEqual({
      priceMale: "The price is not valid.",
      priceFemale: "The price is not valid.",
    });
    expect(validateForm(base({ priceMale: "2.147.483.648" }), TZ, en)).toEqual({});
  });

  it("create: a side is its parsed value or null in gender mode, null in single mode", () => {
    const g = base({ price: "50.000", priceMode: "gender", priceMale: "60.000" });
    expect(buildCreateBody(g, TZ)).toMatchObject({
      priceAmount: 50000,
      priceMale: 60000,
      priceFemale: null,
    });
    const s = buildCreateBody(base({ priceMale: "60.000", priceFemale: "1" }), TZ);
    expect(s).toMatchObject({ priceMale: null, priceFemale: null });
  });

  it("update: a side is sent only when it changed; switching to one price clears only set sides", () => {
    expect(buildUpdateBody(valuesFromSession(gendered), gendered)).toBeNull();
    const loaded = valuesFromSession(gendered);
    expect(buildUpdateBody({ ...loaded, priceFemale: "40.000" }, gendered)).toEqual({
      priceFemale: 40000,
    });
    expect(buildUpdateBody({ ...loaded, priceMale: "", priceFemale: "1" }, gendered)).toEqual({
      priceMale: null,
      priceFemale: 1,
    });
    expect(buildUpdateBody({ ...loaded, priceMode: "single" }, gendered)).toEqual({
      priceMale: null,
    });
    const toGender = {
      ...valuesFromSession(session),
      priceMode: "gender" as const,
      priceMale: "1",
    };
    expect(buildUpdateBody(toGender, session)).toEqual({ priceMale: 1 });
  });

  it("a response without priceMale / priceFemale (older API) is one price and saves nothing extra", () => {
    const older: Partial<SessionDetailDto> = { ...session };
    delete older.priceMale;
    delete older.priceFemale;
    const legacy = older as SessionDetailDto;
    const loaded = valuesFromSession(legacy);
    expect(loaded).toMatchObject({ priceMode: "single", priceMale: "", priceFemale: "" });
    expect(validateForm(loaded, TZ, en, loaded)).toEqual({});
    expect(buildUpdateBody(loaded, legacy)).toBeNull();
    expect(buildUpdateBody({ ...loaded, venueName: "Sân B" }, legacy)).toEqual({
      venueName: "Sân B",
    });
  });
});

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

  it("W1: each of the 8 characters in an inner position flags exactly that field (en copy), except U+200B in a public name", () => {
    for (const field of FIELDS) {
      for (const cp of C8) {
        const e = validateForm(base({ [field]: "Sân" + ch(cp) + "A" }), TZ, en);
        // L23 strip-first (readiness D3): U+200B is a STRIP code point, so area and venueName are
        // stripped before the check and no longer flag it; venueAddress keeps the old rule.
        if (cp === 0x200b && field !== "venueAddress") {
          expect(e).toEqual({});
          continue;
        }
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
    // Edited to another REFUSE value (bidi override): flagged on the field.
    const edited = { ...initial, venueName: "Sân" + ch(0x202e) + "B" };
    expect(Object.keys(validateForm(edited, TZ, en, initial))).toEqual(["venueName"]);
    // L23 strip-first (readiness D3): an edit whose only hidden code point is a STRIP one (U+200B)
    // is the stripped value: no error, and it is what the form sends.
    const stripped = { ...initial, venueName: "Sân" + ch(0x200b) + "B" };
    expect(validateForm(stripped, TZ, en, initial)).toEqual({});
    expect(buildUpdateBody(stripped, orig)).toEqual({ venueName: "SânB" });
  });

  it("W5b: a legacy value with edge spaces plus a hidden character is exempted AND not sent (same comparison)", () => {
    const legacyName = " Sân" + ch(0x202e) + "A ";
    // L23: U+200B is stripped now, so the legacy area proves the exemption with a REFUSE code point.
    const legacyArea = "Quận" + ch(0x202e) + "1" + ch(0x00a0);
    const orig: SessionDetailDto = { ...session, venueName: legacyName, area: legacyArea };
    const initial = valuesFromSession(orig);
    const form = { ...initial, venueAddress: "1 Nguyễn Văn Linh" };
    expect(validateForm(form, TZ, en, initial)).toEqual({});
    expect(buildUpdateBody(form, orig)).toEqual({ venueAddress: "1 Nguyễn Văn Linh" });
    expect(buildUpdateBody(initial, orig)).toBeNull();
    // Edited to another REFUSE value: flagged on the field, and it would be sent.
    const edited = { ...initial, venueName: " Sân" + ch(0x202e) + "B " };
    expect(Object.keys(validateForm(edited, TZ, en, initial))).toEqual(["venueName"]);
    // L23 strip-first (readiness D3): an edit whose only hidden code point is a STRIP one (U+200B)
    // is no error, and it is sent stripped and trimmed.
    const stripped = { ...initial, venueName: " Sân" + ch(0x200b) + "B " };
    expect(validateForm(stripped, TZ, en, initial)).toEqual({});
    expect(buildUpdateBody(stripped, orig)).toEqual({ venueName: "SânB" });
  });

  it("lists the errors in form order: venue name, address, area", () => {
    const bad = "Sân" + ch(0x202e) + "A";
    const e = validateForm(base({ area: bad, venueName: bad, venueAddress: bad }), TZ, en);
    expect(Object.keys(e)).toEqual(["venueName", "venueAddress", "area"]);
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

// L23 strip-first (DD-138 sign-off A.1; readiness D3, D4, D10, D11): the web mirror of text-safety.ts
// stripInvisibleChars on the two public names of the session form, area and venue name. venueAddress
// is not a public name and keeps its rule (W1 above). Characters are built from numbers: no invisible
// character sits in this source.
describe("L23: the session form strips invisible code points from area and venue name", () => {
  const ch = (...cps: number[]) => String.fromCodePoint(...cps);
  const units = (...codeUnits: number[]) => String.fromCharCode(...codeUnits);
  const codePointsOf = (s: string | null | undefined) =>
    Array.from(s ?? "", (c) => c.codePointAt(0));
  const NAMES = ["area", "venueName"] as const;
  const HIDDEN_EN = {
    area: "The area cannot contain control or hidden characters.",
    venueName: "The venue name cannot contain control or hidden characters.",
  };
  const AREA_NEEDED_EN = "A public session needs an area.";
  const publicForm = (over: Partial<SessionFormValues> = {}) =>
    base({ visibility: "public", slotsMax: "8", slotsUnlimited: false, area: "Quận 1", ...over });
  // Edit mode: a stored session with plain area and venue name, and the form loaded from it.
  const stored: SessionDetailDto = { ...session, venueName: "Sân A", area: "Q7" };
  const loaded = valuesFromSession(stored);

  it("SF-R1: a value with no STRIP or REFUSE code point is sent as typed (trimmed), no error", () => {
    const vietnamese = "S" + ch(0xe2) + "n C" + ch(0x1ea7) + "u L" + ch(0xf4) + "ng";
    for (const field of NAMES) {
      for (const text of ["Quận 1", vietnamese, ch(0x1f3f8)]) {
        expect(validateForm(base({ [field]: text }), TZ, en), field).toEqual({});
        expect(buildCreateBody(base({ [field]: " " + text + " " }), TZ)[field], field).toBe(text);
      }
    }
    expect(buildUpdateBody({ ...loaded, area: "Q8" }, stored)).toEqual({ area: "Q8" });
    expect(buildUpdateBody({ ...loaded, venueName: "Sân B" }, stored)).toEqual({
      venueName: "Sân B",
    });
  });

  it("SF-R2: STRIP code points inside visible text are removed from what the form validates and sends", () => {
    for (const field of NAMES) {
      for (const cp of [0x200b, 0x00ad, 0x3164, 0xfe00, 0xe0001, 0x2065]) {
        const form = base({ [field]: "Quan" + ch(cp) + " 1" });
        expect(validateForm(form, TZ, en), field).toEqual({});
        expect(buildCreateBody(form, TZ)[field], field).toBe("Quan 1");
      }
    }
    // Edit mode sends the stripped value; a stripped value equal to the stored one is no change.
    expect(buildUpdateBody({ ...loaded, area: "Q" + ch(0x200b) + "8" }, stored)).toEqual({
      area: "Q8",
    });
    expect(buildUpdateBody({ ...loaded, venueName: ch(0xfe00) + "Sân B" }, stored)).toEqual({
      venueName: "Sân B",
    });
    const noChange = { ...loaded, area: "Q7" + ch(0x200b), venueName: "Sân A" + ch(0xe0001) };
    expect(buildUpdateBody(noChange, stored)).toBeNull();
  });

  it("SF-R3: a value of STRIP code points only (or with whitespace) behaves exactly as an empty one", () => {
    const blanks = [
      ch(0x200b, 0xfe0f, 0x3164, 0xe0001),
      " " + ch(0x200d, 0xffa0) + " ",
      units(0xdb40, 0x200b, 0xdd00), // the halves meet as U+E0100 once the ZWSP is gone
    ];
    for (const field of NAMES) {
      const empty = base({ [field]: "" });
      for (const blank of blanks) {
        const form = base({ [field]: blank });
        expect(validateForm(form, TZ, en), field).toEqual(validateForm(empty, TZ, en));
        expect(buildCreateBody(form, TZ), field).toEqual(buildCreateBody(empty, TZ));
        expect(buildCreateBody(form, TZ)[field], field).toBeUndefined();
      }
    }
    // A public session still needs an area: the same message as for an empty one.
    expect(validateForm(publicForm({ area: "" }), TZ, en).area).toBe(AREA_NEEDED_EN);
    for (const blank of blanks) {
      expect(validateForm(publicForm({ area: blank }), TZ, en).area).toBe(AREA_NEEDED_EN);
    }
    // Edit mode: it clears a stored value exactly as an empty field does.
    expect(buildUpdateBody({ ...loaded, area: "" }, stored)).toEqual({ area: null });
    expect(buildUpdateBody({ ...loaded, area: ch(0x200b) }, stored)).toEqual({ area: null });
    expect(buildUpdateBody({ ...loaded, venueName: ch(0x200b) }, stored)).toEqual({
      venueName: null,
    });
  });

  it("SF-R4: the owner's rule as written splits composed emoji, with the exact code points (no exception)", () => {
    for (const field of NAMES) {
      const heart = base({ [field]: ch(0x2764, 0xfe0f) });
      expect(validateForm(heart, TZ, en), field).toEqual({});
      expect(codePointsOf(buildCreateBody(heart, TZ)[field]), field).toEqual([0x2764]);
      const family = base({ [field]: ch(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467) });
      expect(validateForm(family, TZ, en), field).toEqual({});
      expect(codePointsOf(buildCreateBody(family, TZ)[field]), field).toEqual([
        0x1f468, 0x1f469, 0x1f467,
      ]);
    }
  });

  it("SF-R5: a control, bidi, line-separator or U+2800 code point among visible text is refused as today", () => {
    for (const field of NAMES) {
      for (const cp of [0x202e, 0x0007, 0x2028, 0x2800]) {
        const e = validateForm(base({ [field]: "Sân" + ch(cp) + "A" }), TZ, en);
        expect(Object.keys(e), field).toEqual([field]);
        expect(e[field], field).toBe(HIDDEN_EN[field]);
      }
      // A STRIP code point beside a REFUSE one: the strip leaves the REFUSE one, which still refuses.
      const mixed = base({ [field]: "S" + ch(0x200b) + "an" + ch(0x202e) });
      expect(validateForm(mixed, TZ, en)[field], field).toBe(HIDDEN_EN[field]);
    }
  });

  it("SF-legacy: an untouched stored value that still holds STRIP code points is no error and not sent", () => {
    // Compared stripped on both sides, like the REFUSE legacy rows of W5 and W5b.
    const legacy: SessionDetailDto = {
      ...session,
      venueName: "Sân" + ch(0x200b) + "A",
      area: "Q" + ch(0xfe0f) + "7",
    };
    const initial = valuesFromSession(legacy);
    expect(validateForm(initial, TZ, en, initial)).toEqual({});
    expect(buildUpdateBody(initial, legacy)).toBeNull();
    expect(buildUpdateBody({ ...initial, venueName: "Sân B" }, legacy)).toEqual({
      venueName: "Sân B",
    });
  });

  it("SF-PIN: the mirror equals the server strip (from @plexco/db) over every scalar and the lone-surrogate cases", () => {
    const mismatches: number[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const input = "a" + ch(cp) + "b";
      if (stripInvisibleChars(input) !== serverStripInvisibleChars(input)) mismatches.push(cp);
    }
    expect(mismatches).toEqual([]);
    // The lone-surrogate cases of packages/db/src/text-safety.test.ts: one call is final.
    const lone = units(0xd800) + "a" + units(0xdc00);
    const cases: [string, string][] = [
      [units(0xdb40, 0x200b, 0xdd00), ""],
      ["a" + units(0xdb40, 0xdb40, 0x200b, 0xdd00, 0xdd00) + "b", "ab"],
      [units(0xd83d, 0x200b, 0xde00), ch(0x1f600)],
      [lone, lone],
      [units(0xd800, 0x200b), units(0xd800)],
    ];
    for (const [input, expected] of cases) {
      expect(serverStripInvisibleChars(input)).toBe(expected);
      expect(stripInvisibleChars(input)).toBe(expected);
    }
  }, 30_000);
});
