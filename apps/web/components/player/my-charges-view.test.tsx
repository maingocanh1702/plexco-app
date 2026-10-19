import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LangProvider } from "../../lib/i18n-client";
import type { MyChargeItem, MyCharges, MyClubCharges } from "../../lib/me-player-api";
import { formatVnd } from "../../lib/money";
import { MyChargesView } from "./my-charges-view";

// ApiErrorNotice calls useRouter(), and no app router is mounted in a static render.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {} }) }));

const ASOF = "2026-11-02T09:00:00.000Z";
const item = (
  n: number,
  due: number,
  allocated: number,
  status: MyChargeItem["status"],
  extra: Record<string, unknown> = {},
): MyChargeItem => ({
  sessionRef: `ref-${n}`,
  startsAt: "2026-11-02T11:30:00.000Z",
  amountDue: due,
  amountAllocated: allocated,
  remaining: due - allocated,
  status,
  ...extra,
});
const ALPHA: MyClubCharges = {
  clubRef: "club-a",
  clubLabel: "Alpha Club",
  status: {
    kind: "known_amount",
    currency: "VND",
    totalOutstanding: 60000,
    asOf: ASOF,
    chargeCount: 1,
    items: [item(1, 100000, 40000, "partial")],
  },
};
const BETA: MyClubCharges = {
  clubRef: "club-b",
  clubLabel: "Beta Club",
  status: {
    kind: "known_amount",
    currency: "VND",
    totalOutstanding: 25000,
    asOf: ASOF,
    chargeCount: 1,
    items: [item(2, 25000, 0, "open")],
  },
};
const KNOWN: MyCharges = {
  summary: {
    kind: "known_amount",
    currency: "VND",
    totalOutstanding: 85000,
    asOf: ASOF,
    clubCount: 2,
  },
  clubs: [ALPHA, BETA],
};
const unknownSummary = (retryable: boolean): MyCharges => ({
  ...KNOWN,
  summary: { kind: "unknown", reasonCode: "READ_FAILED", retryable },
});

const render = (data: MyCharges, lang: "vi" | "en" = "en") =>
  renderToStaticMarkup(
    <LangProvider lang={lang}>
      <MyChargesView state={{ status: "ready", data }} onRetry={() => {}} />
    </LangProvider>,
  );
/** Visible text only: tags stripped, the entities React escapes decoded. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const stateOf = (html: string) => /data-state="([a-z]+)"/.exec(html)?.[1];
const UNAVAILABLE = "The amount can't be shown right now. Try again later.";

describe("MyChargesView", () => {
  it("amounts come from formatVnd", () => {
    const html = render(KNOWN);
    const visible = text(html);
    expect(stateOf(html)).toBe("ready");
    for (const amount of [85000, 60000, 100000, 40000, 25000]) {
      expect(visible).toContain(formatVnd(amount));
    }
    expect(text(render(KNOWN, "vi"))).toContain(formatVnd(85000)); // the same in both languages
    expect(visible).not.toMatch(/\d,\d{3}/); // no second formatter
  });

  it("own charges only", () => {
    const visible = text(render(KNOWN));
    // One amounts block per DTO item, each under its own club; the summary card lists none.
    expect(visible.match(/Remaining/g)).toHaveLength(2);
    expect(visible).toContain("Alpha Club");
    expect(visible).toContain("Beta Club");
    expect(visible).toContain("Partly paid");
    expect(visible).toContain("Unpaid");
  });

  it("no pay-now, QR or bank detail", () => {
    const html = render(KNOWN);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<img");
    expect(text(html)).not.toMatch(/pay now|thanh toán ngay|\bQR\b|\bbank\b|ngân hàng/i);
  });

  it("known_zero is the nothing-to-pay state", () => {
    const html = render({
      clubs: [],
      summary: { kind: "known_zero", currency: "VND", asOf: ASOF },
    });
    expect(stateOf(html)).toBe("empty");
    expect(text(html)).toContain("You have nothing to pay");
    expect(text(html)).not.toContain(formatVnd(0));
  });

  it("an unknown summary fails closed: no total, no partial sum, Retry only when retryable", () => {
    const retryable = render(unknownSummary(true));
    expect(stateOf(retryable)).toBe("error");
    expect(text(retryable)).toContain(UNAVAILABLE);
    expect(text(retryable)).not.toMatch(/\dđ/); // no amount at all, never a 0
    expect(text(retryable)).not.toContain("Alpha Club");
    expect(retryable).toContain("<button");
    expect(render(unknownSummary(false))).not.toContain("<button");
  });

  it("an unknown club fails closed while the other clubs keep their amounts", () => {
    const gamma: MyClubCharges = {
      clubRef: "club-c",
      clubLabel: "Gamma Club",
      status: { kind: "unknown", reasonCode: "LEDGER_INCONSISTENT", retryable: false },
    };
    const html = render({ ...KNOWN, clubs: [ALPHA, gamma] });
    const visible = text(html);
    expect(stateOf(html)).toBe("ready");
    expect(visible).toContain(formatVnd(100000));
    expect(visible).toContain("Gamma Club");
    expect(visible.match(/The amount can't be shown right now/g)).toHaveLength(1);
    expect(html).not.toContain("<button");
  });

  // The currency is validated once, at the client parser (parseAmountState); the view owns no unit.
  it("a fractional amount fails closed", () => {
    const fractional = {
      ...KNOWN,
      summary: { ...KNOWN.summary, totalOutstanding: 85000.5 },
    } as MyCharges;
    const html = render(fractional);
    expect(stateOf(html)).toBe("error");
    expect(text(html)).toContain("can't be shown");
    expect(text(html)).not.toContain("85.000");
  });

  it("ignores non-whitelisted keys", () => {
    const dirty = {
      summary: { ...KNOWN.summary, gender: "female", bankAccount: "9704-0000" },
      clubs: [
        {
          ...ALPHA,
          qr: "data:image/png;base64,AAAA",
          status: {
            ...ALPHA.status,
            genderPrice: 99000,
            items: [item(1, 100000, 40000, "partial", { payNowUrl: "https://pay.example/now" })],
          },
        },
      ],
    } as unknown as MyCharges;
    const html = render(dirty);
    for (const leak of ["female", "9704-0000", "data:image", "99.000", "pay.example"]) {
      expect(html).not.toContain(leak);
    }
  });

  it("renders vi and en", () => {
    const inVi = text(render(KNOWN, "vi"));
    const inEn = text(render(KNOWN, "en"));
    for (const word of ["Khoản phải trả của tôi", "Tổng còn phải trả", "Còn lại"]) {
      expect(inVi).toContain(word);
    }
    for (const word of ["My charges", "Total outstanding", "Remaining"]) {
      expect(inEn).toContain(word);
    }
  });
});
