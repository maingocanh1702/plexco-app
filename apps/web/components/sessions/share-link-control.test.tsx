import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiClientError, apiFetch } from "../../lib/api-client";
import type { SessionDetailDto } from "../../lib/sessions-api";
import { ShareLinkControl } from "./share-link-control";
const h = vi.hoisted(() => ({ slots: [] as unknown[], i: 0 })); // no DOM here: a useState store
vi.mock("react", async (o) => ({
  ...(await o<object>()),
  useState(init: unknown, i = h.i++) {
    if (!(i in h.slots)) h.slots[i] = typeof init === "function" ? init() : init;
    return [h.slots[i], (next: unknown) => void (h.slots[i] = next)]; // the control sets values
  },
}));
vi.mock("../../lib/i18n-client", async (o) => ({ ...(await o<object>()), useT: () => String })); // t(vi, en) -> vi
vi.mock("../../lib/api-client", async (o) => ({ ...(await o<object>()), apiFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {} }) }));
const SLUG = "Zq3_xY7-kP2mN8vB4cR6tW"; // 22 characters, the length of a minted slug
const LINK = `https://plexco.test/session/${SLUG}`;
const WARN = "Tạo liên kết mới sẽ làm liên kết cũ của kèo này ngừng hoạt động ngay.";
const REPLAY = "Liên kết đã được tạo nhưng không hiển thị được. Hãy tạo liên kết mới.";
const NOT_LISTED = "Kèo này chưa hiển thị công khai nên chưa tạo được liên kết chia sẻ.";
const REQ = { method: "POST", json: { commandId: expect.stringMatching(/./) }, csrfToken: "csrf" };
const ctx = { tenantId: "t1", csrfToken: "csrf" };
const [writeText, setItem] = [vi.fn().mockResolvedValue(undefined), vi.fn()];
const logs = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m));
vi.stubGlobal("window", { location: { origin: "https://plexco.test" } });
vi.stubGlobal("navigator", { clipboard: { writeText } });
for (const name of ["localStorage", "sessionStorage"]) vi.stubGlobal(name, { setItem });
type El = { type: unknown; props: { children?: unknown; onClick?: () => void } };
const els = (n: El): El[] =>
  Array.isArray(n) ? n.flatMap(els) : n?.props ? [n, ...els(n.props.children as El)] : [];
function view(visibility: "public" | "private" = "public") {
  h.i = 0;
  return ShareLinkControl({ session: { id: "s1", visibility } as SessionDetailDto, ctx });
}
const html = (visibility?: "public" | "private") => renderToStaticMarkup(view(visibility));
async function press(label: string) {
  els(view()).find((e) => e.props.children === label)!.props.onClick!();
  await new Promise((done) => setTimeout(done, 0));
}
async function mint(answer: unknown, rejected = false) {
  vi.mocked(apiFetch)[rejected ? "mockRejectedValueOnce" : "mockResolvedValueOnce"](answer);
  for (const label of ["Tạo liên kết chia sẻ", "Xác nhận"]) await press(label);
}
async function linkFlow() {
  await mint({ shareLink: { path: `/session/${SLUG}` } });
  expect(vi.mocked(apiFetch).mock.calls).toEqual([["/api/sessions/s1/share-link?tenant=t1", REQ]]);
  expect(html()).toMatch(new RegExp(`<input readOnly=""[^>]* value="${LINK}"`));
  expect(html()).toContain("Liên kết chỉ hiện một lần; hãy sao chép ngay.");
  await press("Sao chép");
  expect([writeText.mock.calls, html().includes("Đã sao chép")]).toEqual([[[LINK]], true]);
}
async function replayFlow() {
  await mint({ shareLink: null, replayed: true });
  expect([html().includes(REPLAY), html().includes("<input")]).toEqual([true, false]);
}
beforeEach(() => void (h.slots = []));
beforeEach(() => void vi.clearAllMocks());
it("1 public: button, then warning; nothing sent before Confirm or on Cancel", async () => {
  await press("Tạo liên kết chia sẻ");
  expect(html()).toContain(WARN);
  await press("Huỷ");
  expect([html().includes(WARN), vi.mocked(apiFetch).mock.calls.length]).toEqual([false, 0]);
});
it("2 Confirm: one POST (commandId, csrf), the link once and read-only, Copy", linkFlow);
it("3 a replay: the replay line, no field", replayFlow);
it("4 a 409 shows the server's message", async () => {
  await mint(new ApiClientError("SESSION_NOT_OPEN", NOT_LISTED, 409), true);
  expect(html()).toContain(NOT_LISTED);
});
it("5 a private session: only the no-link line", () => {
  expect(html("private").replace(/<.*?>/g, "")).toBe("Kèo riêng tư không có liên kết chia sẻ.");
  expect(els(view("private"))).toHaveLength(1); // that <p> alone: no button
});
it("6 cases 2-3 again: no storage write or console line carries the slug", async () => {
  await linkFlow();
  h.slots = [];
  await replayFlow();
  expect(JSON.stringify([setItem, ...logs].map((spy) => spy.mock.calls))).not.toContain(SLUG);
});
