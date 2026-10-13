import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentSession } from "../../lib/session-cookies";
import MeLayout from "./layout";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("../../lib/session-cookies", () => ({ currentSession: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("/me auth boundary", () => {
  it("signed-out: redirects to / with a return-to before rendering children", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    await expect(MeLayout({ children: null })).rejects.toThrow(
      "REDIRECT:/?returnTo=%2Fme%2Fsettings",
    );
  });

  it("signed-in: renders the children", async () => {
    vi.mocked(currentSession).mockResolvedValue({
      sessionId: "s",
      accountId: "a",
      personId: "p",
      csrfSecret: "x",
      expiresAt: new Date(),
    });
    await expect(MeLayout({ children: "child" })).resolves.toBeTruthy();
  });
});
