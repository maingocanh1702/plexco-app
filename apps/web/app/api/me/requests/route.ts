import { listMyJoinRequests } from "@plexco/db";
import { ok } from "../../../../lib/api-envelope";
import { resolveMeGate } from "../../../../lib/me-route-gate";
import { appDb } from "../../../../lib/session-cookies";

const PRIVATE = { "cache-control": "private, no-store" };

/**
 * GET /api/me/requests -- the signed-in player's own join requests (0059, M-4), newest first. The
 * account comes ONLY from the verified session: no query parameter or body is read.
 */
export async function GET(request: Request): Promise<Response> {
  const gate = await resolveMeGate(request, {
    csrf: false,
    bucket: { name: "me-requests-read", limit: 30, windowSeconds: 60 },
  });
  if (gate instanceof Response) return gate;
  try {
    return ok(await listMyJoinRequests(appDb().pool, gate.accountId), { headers: PRIVATE });
  } catch (e) {
    console.error("GET /api/me/requests failed", (e as Error).name);
    return new Response(null, { status: 500, headers: PRIVATE });
  }
}
