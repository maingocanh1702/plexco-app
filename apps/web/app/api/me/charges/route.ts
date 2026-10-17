import { readMyCharges } from "@plexco/db";
import { ok } from "../../../../lib/api-envelope";
import { resolveMeGate } from "../../../../lib/me-route-gate";
import { appDb } from "../../../../lib/session-cookies";

const PRIVATE = { "cache-control": "private, no-store" };

/**
 * GET /api/me/charges -- the signed-in player's OWN open charges per club and the cross-club summary
 * (0059, M-2, M-9, M-10). A read failure is a 200 `unknown READ_FAILED` from readMyCharges, never a
 * 0 (M-13); only an unexpected fault is a 500. The account comes ONLY from the verified session.
 */
export async function GET(request: Request): Promise<Response> {
  const gate = await resolveMeGate(request, {
    csrf: false,
    bucket: { name: "me-charges-read", limit: 20, windowSeconds: 60 },
  });
  if (gate instanceof Response) return gate;
  try {
    return ok(await readMyCharges(appDb().pool, gate.accountId), { headers: PRIVATE });
  } catch (e) {
    console.error("GET /api/me/charges failed", (e as Error).name);
    return new Response(null, { status: 500, headers: PRIVATE });
  }
}
