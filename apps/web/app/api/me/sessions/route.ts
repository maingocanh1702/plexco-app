import { listMySessions } from "@plexco/db";
import { ok } from "../../../../lib/api-envelope";
import { resolveMeGate } from "../../../../lib/me-route-gate";
import { appDb } from "../../../../lib/session-cookies";

const PRIVATE = { "cache-control": "private, no-store" };

/**
 * GET /api/me/sessions -- the signed-in player's own seats and pending requests (0059, M-3); the
 * venue follows the session's hide_exact_address option (DD-139, 0067; enforced in SQL). The
 * account comes ONLY from the verified session: no query parameter or body is read.
 */
export async function GET(request: Request): Promise<Response> {
  const gate = await resolveMeGate(request, {
    csrf: false,
    bucket: { name: "me-sessions-read", limit: 30, windowSeconds: 60 },
  });
  if (gate instanceof Response) return gate;
  try {
    return ok(await listMySessions(appDb().pool, gate.accountId), { headers: PRIVATE });
  } catch (e) {
    console.error("GET /api/me/sessions failed", (e as Error).name);
    return new Response(null, { status: 500, headers: PRIVATE });
  }
}
