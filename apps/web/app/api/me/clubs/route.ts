import { listMyClubs } from "@plexco/db";
import { ok } from "../../../../lib/api-envelope";
import { resolveMeGate } from "../../../../lib/me-route-gate";
import { appDb } from "../../../../lib/session-cookies";

const PRIVATE = { "cache-control": "private, no-store" };

/**
 * GET /api/me/clubs -- the signed-in player's own clubs (0059 definers, M-1). The account comes ONLY
 * from the verified session: no query parameter or body is read, so a person, tenant or membership
 * id sent by the client is ignored by construction.
 */
export async function GET(request: Request): Promise<Response> {
  const gate = await resolveMeGate(request, {
    csrf: false,
    bucket: { name: "me-clubs-read", limit: 20, windowSeconds: 60 },
  });
  if (gate instanceof Response) return gate;
  try {
    return ok(await listMyClubs(appDb().pool, gate.accountId), { headers: PRIVATE });
  } catch (e) {
    console.error("GET /api/me/clubs failed", (e as Error).name);
    return new Response(null, { status: 500, headers: PRIVATE });
  }
}
