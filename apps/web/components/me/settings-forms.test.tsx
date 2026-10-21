import { GENDER_VALUES } from "@plexco/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LangProvider } from "../../lib/i18n-client";
import type { LinkedChannelDto, ProfileView } from "../../lib/me-settings-client";
import { SessionProvider } from "../../lib/use-session";
import { SettingsChannelsList } from "./settings-channels-list";
import { SettingsProfileForm } from "./settings-profile-form";
import { SettingsView } from "./settings-view";

// SettingsView loads through useLoadable; a static render runs no effect, so it gets a ready state.
const loaded = vi.hoisted(() => ({ profile: null as unknown }));
vi.mock("../../lib/use-sessions-data", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useLoadable: () => ({
    state: { status: "ready", data: { profile: loaded.profile, channels: [] } },
    reload: () => undefined,
    refresh: () => undefined,
  }),
}));

const PROFILE: ProfileView = {
  displayName: "Lan",
  gender: null,
  genderConsent: false,
  genderCollection: true,
};

// The channel list reloads through the session context (a CSRF_INVALID needs its fresh csrfToken);
// a static render runs no effect, so the provider never fetches here.
const wrap = (node: React.ReactNode, lang: "vi" | "en" = "en") =>
  renderToStaticMarkup(
    <LangProvider lang={lang}>
      <SessionProvider>{node}</SessionProvider>
    </LangProvider>,
  );

const CHANNELS: LinkedChannelDto[] = [
  { id: "c1", platform: "zalo", status: "active", createdAt: "2026-10-01T00:00:00Z" },
  { id: "c2", platform: "messenger", status: "inactive", createdAt: "2026-09-01T00:00:00Z" },
];

// Pinned L22 copy: the purpose notice N1-N3 at the gender field, and the privacy note heading H plus
// P1-P6. Pasted byte for byte from the "Copy (pinned)" table of
// docs/sessions/web-mvp-phase3-readiness-p3-flags-default-on.md. Never reword a string here: a changed
// sentence needs a new proof in that file first (each sentence is provable from code or a decision).
type Copy = Record<"vi" | "en", string>;
const LANGS = ["vi", "en"] as const;
const NOTICE_ID = "me-gender-notice";
const NOTICE: Copy[] = [
  {
    vi: "Giới tính của bạn được dùng để tính giá khi CLB đặt giá theo giới tính cho một kèo.",
    en: "Your gender is used to work out the price when a club sets a price by gender for a session.",
  },
  {
    vi: "Việc đặt giới tính là tuỳ chọn; nếu để chưa đặt, bạn trả giá mặc định của kèo.",
    en: "Setting your gender is optional; if you leave it unset, you pay the default price of the session.",
  },
  {
    vi: "CLB chỉ được dùng giới tính của bạn để tính giá nếu bạn đánh dấu ô bên dưới.",
    en: "Clubs can use your gender for pricing only if you tick the box below.",
  },
];
const PRIVACY_HEADING: Copy = { vi: "Dữ liệu giới tính của bạn", en: "Your gender data" };
const PRIVACY_NOTE: Copy[] = [
  {
    vi: "Giới tính của bạn được lưu ở dạng mã hoá trên hồ sơ Plexco của bạn.",
    en: "Your gender is stored encrypted on your Plexco profile.",
  },
  {
    vi: "Giới tính của bạn không được hiển thị cho CLB hay người chơi khác, và không xuất hiện trên bất kỳ trang công khai nào.",
    en: "Your gender is not shown to clubs or other players, and it does not appear on any public page.",
  },
  {
    vi: "CLB chỉ nhận mức giá được tính từ giới tính của bạn, không nhận chính giới tính đó.",
    en: "Clubs receive only the price worked out from your gender, not your gender itself.",
  },
  {
    vi: "Bạn có thể đổi giới tính đã đặt bất cứ lúc nào bằng cách chọn lựa chọn khác rồi lưu.",
    en: "You can change your gender at any time by choosing another option and saving.",
  },
  {
    vi: "Để xoá giới tính khỏi hồ sơ, đặt lại thành Chưa đặt rồi lưu; quyền dùng giới tính để tính giá cũng bị tắt theo.",
    en: "To remove your gender from your profile, set the field back to Not set and save; the pricing permission is switched off with it.",
  },
  {
    vi: "Để CLB ngừng dùng giới tính mà không xoá nó, bỏ đánh dấu ô cho phép rồi lưu.",
    en: "To stop clubs using your gender without removing it, untick the box and save.",
  },
];

describe("SettingsProfileForm", () => {
  const NO_GENDER = { gender: null, genderConsent: false, genderCollection: false } as const;
  it("renders a labelled, described display-name field and a submit button", () => {
    const html = wrap(
      <SettingsProfileForm
        initial={{ displayName: "Lan", ...NO_GENDER }}
        csrfToken="x"
        onSaved={vi.fn()}
      />,
    );
    expect(html).toContain("Display name");
    expect(html).toContain('value="Lan"');
    expect(html).toContain("aria-describedby");
    expect(html).toContain('type="submit"');
  });

  it("renders in Vietnamese (HR5: t(vi,en))", () => {
    const html = wrap(
      <SettingsProfileForm
        initial={{ displayName: null, ...NO_GENDER }}
        csrfToken="x"
        onSaved={vi.fn()}
      />,
      "vi",
    );
    expect(html).toContain("Tên hiển thị");
    expect(html).toContain("Lưu");
  });
});

describe("SettingsProfileForm gender and pricing consent (DD-39, T-24)", () => {
  const form = (initial: Partial<ProfileView>, lang: "vi" | "en" = "en") =>
    wrap(
      <SettingsProfileForm initial={{ ...PROFILE, ...initial }} csrfToken="x" onSaved={vi.fn()} />,
      lang,
    );

  it("flag OFF: no selector, consent box or remove button while nothing is stored", () => {
    const html = form({ genderCollection: false });
    expect(html).not.toContain("<select");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("Remove my saved gender");
  });

  it("flag OFF with stored data: only the remove button", () => {
    for (const stored of [{ gender: "female" }, { genderConsent: true }] as const) {
      const html = form({ genderCollection: false, ...stored });
      expect(html).toContain("Remove my saved gender");
      expect(html).not.toContain("<select");
      expect(html).not.toContain('type="checkbox"');
    }
    expect(form({ genderCollection: false, gender: "male" }, "vi")).toContain(
      "Xoá giới tính đã lưu",
    );
  });

  it("flag ON: GENDER_VALUES plus Not set with t(vi, en) labels, and the consent box", () => {
    const en = form({});
    const vi = form({}, "vi");
    for (const v of GENDER_VALUES) expect(en).toContain(`<option value="${v}"`);
    expect(en.match(/<option/g)).toHaveLength(GENDER_VALUES.length + 1);
    for (const o of ["Not set", "Male", "Female", "Other", "Prefer not to say"])
      expect(en).toContain(`>${o}</option>`);
    for (const o of ["Chưa đặt", "Nam", "Nữ", "Khác", "Không tiết lộ"])
      expect(vi).toContain(`>${o}</option>`);
    expect(en).toContain(">Gender</label>");
    expect(vi).toContain(">Giới tính</label>");
    expect(en).toContain("Allow clubs to use my gender for pricing");
    expect(vi).toContain("Cho phép CLB sử dụng giới tính để tính giá");
    expect(en).toContain("Gender not shared");
    expect(vi).toContain("Không chia sẻ giới tính");
    // No consent without a gender: the box is disabled while gender is Not set.
    expect(en).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/);
    expect(en).not.toContain("Remove my saved gender");
  });

  it("flag ON: shows the stored choice and consent; the not-shared caption only while consent is off", () => {
    const html = form({ gender: "female", genderConsent: true });
    expect(html).toContain('<option value="female" selected="">');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
    expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*disabled/);
    expect(html).not.toContain("Gender not shared");
  });

  it("flag ON: the purpose notice N1-N3 sits between the selector and the consent box and describes the select, in vi and en", () => {
    for (const lang of LANGS) {
      const html = form({}, lang);
      const notice = html.match(new RegExp(`<p id="${NOTICE_ID}"[^>]*>(.*?)</p>`));
      expect(notice?.[1]).toBe(NOTICE.map((s) => s[lang]).join(" "));
      // A plain paragraph: not a live region, and no control or label inside it.
      expect(notice?.[0]).not.toMatch(/role=|<(input|select|label|button)[ >]/);
      expect(html).toMatch(new RegExp(`<select [^>]*aria-describedby="${NOTICE_ID}"`));
      const selectEnd = html.indexOf("</select>");
      const noticeAt = html.indexOf(`id="${NOTICE_ID}"`);
      expect(selectEnd).toBeGreaterThan(-1);
      expect(noticeAt).toBeGreaterThan(selectEnd);
      expect(html.indexOf('type="checkbox"')).toBeGreaterThan(noticeAt);
    }
  });

  it("flag OFF: no purpose notice in either language, with or without stored data", () => {
    for (const lang of LANGS)
      for (const stored of [{}, { gender: "female" }, { genderConsent: true }] as const) {
        const html = form({ genderCollection: false, ...stored }, lang);
        expect(html).not.toContain(NOTICE_ID);
        for (const s of NOTICE) expect(html).not.toContain(s[lang]);
      }
  });
});

describe("SettingsView gender prompt (T-2, U-20)", () => {
  const PROMPT =
    "You have not set your gender. In sessions priced by gender you pay the default price until you set it.";
  const page = (profile: Partial<ProfileView>, lang: "vi" | "en" = "en") => {
    loaded.profile = { ...PROFILE, ...profile };
    return wrap(<SettingsView />, lang);
  };

  it("a status paragraph above the Profile card, only with the flag ON and gender null", () => {
    const html = page({});
    expect(html).toMatch(/<p[^>]*role="status"[^>]*>You have not set your gender\./);
    expect(html).toContain(PROMPT);
    expect(html.indexOf(PROMPT)).toBeLessThan(html.indexOf('id="me-profile"'));
    expect(page({}, "vi")).toContain(
      "Bạn chưa đặt giới tính. Ở kèo có giá theo giới tính, bạn sẽ trả giá mặc định cho tới khi đặt.",
    );
    expect(page({ gender: "male" })).not.toContain(PROMPT);
    expect(page({ genderCollection: false })).not.toContain(PROMPT);
  });

  it("flag ON: the privacy note renders its heading and exactly P1-P6 in order, in vi and en", () => {
    for (const lang of LANGS)
      for (const stored of [{}, { gender: "female", genderConsent: true }] as const) {
        const html = page(stored, lang);
        const start = html.indexOf('data-testid="settings-privacy-note"');
        expect(start).toBeGreaterThan(-1);
        const note = html.slice(start, html.indexOf("</section>", start));
        expect(note.match(/<h2[^>]*>(.*?)<\/h2>/)?.[1]).toBe(PRIVACY_HEADING[lang]);
        expect(Array.from(note.matchAll(/<p[^>]*>(.*?)<\/p>/g), (m) => m[1])).toEqual(
          PRIVACY_NOTE.map((s) => s[lang]),
        );
      }
  });

  it("flag OFF: no privacy note in either language, with or without stored data", () => {
    for (const lang of LANGS)
      for (const stored of [{}, { gender: "female", genderConsent: true }] as const) {
        const html = page({ genderCollection: false, ...stored }, lang);
        expect(html).not.toContain("settings-privacy-note");
        expect(html).not.toContain('id="me-privacy"');
        for (const s of [PRIVACY_HEADING, ...PRIVACY_NOTE]) expect(html).not.toContain(s[lang]);
      }
  });

  it("copy constraints: the not-shared caption goes with consent, and the English page holds no Vietnamese gender copy", () => {
    // Each negative check has a positive control (the same string present in the other state), so a
    // mistyped literal fails instead of passing vacuously.
    const caption: Copy = { vi: "Không chia sẻ giới tính", en: "Gender not shared" };
    for (const lang of LANGS) {
      expect(page({ gender: "female" }, lang)).toContain(caption[lang]);
      expect(page({ gender: "female", genderConsent: true }, lang)).not.toContain(caption[lang]);
    }
    // Mirrors settings.spec.ts getByText(/giới tính/i) count 0 on the English page.
    expect(page({}, "vi")).toMatch(/giới tính/i);
    expect(page({}, "en")).not.toMatch(/giới tính/i);
  });
});

describe("SettingsChannelsList", () => {
  it("empty state points at /me/link", () => {
    const html = wrap(<SettingsChannelsList channels={[]} csrfToken="x" onChanged={vi.fn()} />);
    expect(html).toContain("No linked channels");
    expect(html).toContain('href="/me/link"');
  });

  it("lists platform + status text (not colour only); only ACTIVE rows can be unlinked", () => {
    const html = wrap(
      <SettingsChannelsList channels={CHANNELS} csrfToken="x" onChanged={vi.fn()} />,
    );
    expect(html).toContain("Zalo");
    expect(html).toContain("Messenger");
    expect(html).toContain("Linked");
    expect(html).toContain("Inactive");
    // the inactive row says why it has no unlink action (detach moves active channels only)
    expect(html).toContain("cannot be unlinked for now");
    expect(html.match(/Unlink/g)?.length).toBeGreaterThanOrEqual(1);
    // one Unlink trigger button (the active row) + the dialog's confirm label
    expect(html.match(/<button[^>]*>Unlink<span/g)?.length).toBe(1);
  });

  it("the date is labelled as when the channel was first seen, not as a link time", () => {
    const html = wrap(
      <SettingsChannelsList channels={CHANNELS} csrfToken="x" onChanged={vi.fn()} />,
      "vi",
    );
    expect(html).toContain("Ghi nhận từ ngày");
    expect(html).not.toContain("Liên kết ngày");
  });

  it("the confirm copy says the bot will treat the channel account as a new stranger", () => {
    const viHtml = wrap(
      <SettingsChannelsList channels={CHANNELS} csrfToken="x" onChanged={vi.fn()} />,
      "vi",
    );
    expect(viHtml).toContain("bot sẽ coi tài khoản Zalo này là một người lạ mới");
    const enHtml = wrap(
      <SettingsChannelsList channels={CHANNELS} csrfToken="x" onChanged={vi.fn()} />,
    );
    expect(enHtml).toContain("the bot treats this Zalo account as a new stranger");
  });

  it("the outcome live region is mounted before any unlink (so the result is announced)", () => {
    const html = wrap(
      <SettingsChannelsList channels={CHANNELS} csrfToken="x" onChanged={vi.fn()} />,
    );
    expect(html).toContain('role="status"');
  });

  it("never renders an id, token or raw platform identifier", () => {
    const html = wrap(
      <SettingsChannelsList channels={CHANNELS} csrfToken="secret-csrf" onChanged={vi.fn()} />,
    );
    expect(html).not.toContain("secret-csrf");
    expect(html).not.toContain('"c1"');
  });
});
