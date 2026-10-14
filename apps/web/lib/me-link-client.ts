/**
 * Pure client logic for /me/link (lane M3b): state mapping + the single network call. No React, no
 * DOM, so it runs under vitest's node environment. The POST /api/me/link contract is in
 * app/api/me/link/route.ts; the server owns code normalization (case, dashes), so nothing here
 * re-implements it.
 */
export type LinkUiState =
  | "idle"
  | "submitting"
  | "linked"
  | "already_linked"
  | "requires_review"
  | "invalid"
  | "rate_limited"
  | "throttled"
  | "unavailable"
  | "offline"
  | "signed_out"
  | "error";

export interface LinkAttemptResult {
  state: LinkUiState;
  /** true = the outcome is uncertain (network / 5xx): a retry must reuse the SAME commandId. */
  keepCommandId: boolean;
}

interface Envelope {
  data?: { outcome?: unknown; csrfToken?: unknown } | null;
  error?: { code?: unknown } | null;
}

/**
 * Map one POST /api/me/link response onto a UI state. Anything unrecognised is the generic error.
 * The two 429s are different promises: RATE_LIMITED is the route's 60 per 60 s actor ceiling
 * (`throttled`: wait a minute); LINK_CODE_RATE_LIMITED is a 10-minute link bucket OR the code's own
 * attempt cap, after which that code is dead (`rate_limited`: wait 10 minutes, then a new code). A
 * 429 with any other code gets the longer, always-safe `rate_limited` advice.
 */
export function stateFromLinkResponse(status: number, body: Envelope | null): LinkAttemptResult {
  const code = body?.error?.code;
  const done = (state: LinkUiState, keepCommandId = false): LinkAttemptResult => ({
    state,
    keepCommandId,
  });
  if (status === 200) {
    const outcome = body?.data?.outcome;
    if (outcome === "linked" || outcome === "already_linked") return done(outcome);
    return done("error");
  }
  if (status === 401) return done("signed_out");
  if (status === 409 && code === "MERGE_REQUIRES_REVIEW") return done("requires_review");
  if (status === 429) return done(code === "RATE_LIMITED" ? "throttled" : "rate_limited");
  if (status === 400 && (code === "LINK_CODE_INVALID" || code === "INVALID_BODY")) {
    return done("invalid");
  }
  if (status >= 500) return done("unavailable", true);
  return done("error");
}

async function readEnvelope(res: Response): Promise<Envelope | null> {
  try {
    return (await res.json()) as Envelope;
  } catch {
    return null;
  }
}

/**
 * One attempt: fetch the session's CSRF secret (not embedded in the page HTML), then POST the code.
 * Network failure = `offline` (uncertain: keep the commandId).
 */
export async function submitLinkCode(
  input: { code: string; commandId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<LinkAttemptResult> {
  try {
    const sessionRes = await fetchImpl("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (sessionRes.status === 401) return { state: "signed_out", keepCommandId: false };
    if (!sessionRes.ok) return stateFromLinkResponse(sessionRes.status, null);
    const csrf = (await readEnvelope(sessionRes))?.data?.csrfToken;
    if (typeof csrf !== "string") return { state: "error", keepCommandId: false };
    const res = await fetchImpl("/api/me/link", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ code: input.code, commandId: input.commandId }),
    });
    return stateFromLinkResponse(res.status, await readEnvelope(res));
  } catch {
    return { state: "offline", keepCommandId: true };
  }
}
