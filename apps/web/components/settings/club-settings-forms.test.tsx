import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ClubConfigDto } from "../../lib/club-settings-client";
import { LangProvider, makeT } from "../../lib/i18n-client";
import { ClubDefaultsForm } from "./club-defaults-form";
import { ClubProfileForm } from "./club-profile-form";
import { FormFeedback } from "./form-feedback";
import { ZaloConnectCard } from "./zalo-connect-card";
import {
  connectOutcome,
  reloadedNote,
  revokedNote,
  statusLabel,
  statusTone,
} from "./zalo-connect-status";

const club: ClubConfigDto = {
  slug: "clb",
  name: "CLB Alpha",
  timezone: "Asia/Ho_Chi_Minh",
  locale: "vi",
  defaultSportKey: "badminton",
  defaultPriceAmount: 50000,
  defaultVisibility: "public",
};
const wrap = (node: React.ReactNode, lang: "vi" | "en" = "en") =>
  renderToStaticMarkup(<LangProvider lang={lang}>{node}</LangProvider>);

describe("ClubProfileForm", () => {
  it("prefills name/timezone/language and says the language is club-wide (DD-118)", () => {
    const html = wrap(<ClubProfileForm tenantId="t" csrfToken="x" club={club} onSaved={vi.fn()} />);
    expect(html).toContain('value="CLB Alpha"');
    expect(html).toContain("Club language");
    expect(html).toContain("no per-member language");
    expect(html).toContain("Asia/Ho_Chi_Minh");
  });
});

describe("ClubDefaultsForm", () => {
  it("lists the sports, formats the saved price and offers the two visibilities", () => {
    const html = wrap(
      <ClubDefaultsForm
        tenantId="t"
        csrfToken="x"
        club={club}
        sports={[{ id: "1", key: "badminton", name: "Badminton" }]}
        onSaved={vi.fn()}
      />,
    );
    expect(html).toContain("Badminton");
    expect(html).toContain('value="50,000"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain("Private");
    expect(html).toContain("Public");
  });

  it("labels the price in đ (U+0111, OD-4(b)), never the U+20AB dong sign", () => {
    const html = wrap(
      <ClubDefaultsForm tenantId="t" csrfToken="x" club={club} sports={[]} onSaved={vi.fn()} />,
      "vi",
    );
    expect(html).toContain(`Giá mặc định (${String.fromCodePoint(0x111)})`);
    expect(html).not.toContain(String.fromCodePoint(0x20ab));
  });
});

describe("ZaloConnectCard", () => {
  it("first paint is a skeleton: no token field, no state claimed before the route answered", () => {
    const html = wrap(<ZaloConnectCard tenantId="t" csrfToken="x" />);
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Connected");
  });
});

describe("Zalo connect status copy", () => {
  const en = makeT("en");
  it("every known status has its own label and tone; an unknown one fails closed, never blank", () => {
    for (const status of ["not_connected", "connecting", "registered", "active", "drift"]) {
      expect(statusLabel(status, en)).not.toBe("Unknown status");
    }
    expect(statusLabel("error", en)).toBe("Connection error");
    expect(statusTone("error")).toBe("error");
    expect(statusLabel("paused_by_zalo", en)).toBe("Unknown status");
    expect(statusTone("paused_by_zalo")).toBe("neutral");
  });

  it("a 200 is worded from the status it returned (status error is NOT 'registered')", () => {
    expect(connectOutcome("registered", en)).toEqual({
      message: expect.stringMatching(/webhook registered/),
      tone: "success",
    });
    expect(connectOutcome("active", en).tone).toBe("success");
    const failed = connectOutcome("error", en);
    expect(failed.tone).toBe("warning");
    expect(failed.message).toMatch(/did not accept the webhook registration/);
    expect(failed.message).not.toMatch(/webhook registered/);
    expect(connectOutcome("something_new", en).tone).toBe("warning");
  });

  it("a revoked bot's note says it is terminal (the card offers no reconnect for it, see e2e)", () => {
    expect(statusLabel("revoked", en)).toBe("Revoked");
    expect(revokedNote(en)).toMatch(/cannot be reconnected/);
    expect(revokedNote(en)).toMatch(/not even with a different bot token/);
    expect(revokedNote(makeT("vi"))).toContain("Không thể kết nối lại từ trang này");
    expect(reloadedNote(makeT("vi"))).toBe("Đã tải lại trạng thái kết nối Zalo.");
  });
});

describe("FormFeedback", () => {
  it("keeps an empty, visually hidden live region mounted so the next outcome is announced", () => {
    const html = wrap(<FormFeedback focusKey={0} />);
    expect(html).toContain('class="sr-only"');
    expect(html).toContain('role="status"');
  });

  it("shows the message in that same live region (the alert path is pinned by e2e/settings.spec.ts)", () => {
    const saved = wrap(<FormFeedback focusKey={0} message="Saved." />);
    expect(saved).toMatch(/role="status"[^>]*>Saved\.</);
    expect(saved).not.toContain('class="sr-only"');
    expect(wrap(<FormFeedback focusKey={0} message="Careful." tone="warning" />)).toMatch(
      /role="status"[^>]*>Careful\.</,
    );
  });
});
