import { ok } from "../../../../../lib/api-envelope";
import { issueLoginStateCookie } from "../../../../../lib/login-state";

/**
 * GET /api/auth/telegram/state — issues the pre-auth login-state cookie
 * (DD-31 SI-1). Call before rendering the TG Login Widget.
 */
export async function GET(): Promise<Response> {
  await issueLoginStateCookie();
  return ok({ issued: true });
}
