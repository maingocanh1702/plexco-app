import { listMyChannels } from "@plexco/db";
import { ok } from "../../../../lib/api-envelope";
import { resolveMeGate } from "../../../../lib/me-route-gate";
import { appDb } from "../../../../lib/session-cookies";

/**
 * GET /api/me/channels -- the signed-in user's linked channels (active and inactive, newest first).
 * Projection is deliberately thin: id, platform, status, createdAt. No platform user id, username,
 * lookup hash, bot id or person id ever leaves (HR2).
 */
export async function GET(request: Request): Promise<Response> {
  const gate = await resolveMeGate(request, { csrf: false });
  if (gate instanceof Response) return gate;
  const rows = await listMyChannels(appDb().pool, gate.accountId);
  return ok({
    channels: rows.map((c) => ({
      id: c.channelIdentityId,
      platform: c.platform,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
    })),
  });
}
