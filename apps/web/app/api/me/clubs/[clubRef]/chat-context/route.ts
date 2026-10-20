import { t } from "@plexco/core/i18n";
import { readMyClubChatContext } from "@plexco/db";
import { err, ok } from "../../../../../../lib/api-envelope";
import { resolveMeGate } from "../../../../../../lib/me-route-gate";
import { SLUG_RE } from "../../../../../../lib/new-club-form";
import { appDb } from "../../../../../../lib/session-cookies";

const PRIVATE = { "cache-control": "private, no-store" };

/**
 * The ONE deny of this route (a malformed slug, or no row: unknown club, guest, left, no membership,
 * no person). Same status, body and headers on every path, so a caller cannot tell an unknown club
 * from a membership it does not hold. err() sets `no-store` only; this route is `private, no-store`.
 */
function deny(): Response {
  const res = err("NOT_FOUND", t("Không tìm thấy.", "Not found."), 404);
  res.headers.set("cache-control", PRIVATE["cache-control"]);
  return res;
}

/**
 * GET /api/me/clubs/:clubRef/chat-context -- the tenant id and time zone of a club the signed-in
 * player is an ACTIVE member of (0066 definer), so the member chat pages can call the chat API.
 * A convenience, never a grant: the chat API's live-membership gate stays the authorization. The
 * account comes ONLY from the verified session; no person, tenant, membership or account id is read
 * from the query, the body or a header. The slug shape is checked before the definer is called.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ clubRef: string }> },
): Promise<Response> {
  const gate = await resolveMeGate(request, {
    csrf: false,
    bucket: { name: "me-chat-context-read", limit: 20, windowSeconds: 60 },
  });
  if (gate instanceof Response) return gate;
  try {
    const { clubRef } = await params;
    if (!SLUG_RE.test(clubRef)) return deny();
    const context = await readMyClubChatContext(appDb().pool, gate.accountId, clubRef);
    if (!context) return deny();
    return ok({ tenantId: context.tenantId, timezone: context.timezone }, { headers: PRIVATE });
  } catch (e) {
    console.error("GET /api/me/clubs/[clubRef]/chat-context failed", (e as Error).name);
    return new Response(null, { status: 500, headers: PRIVATE });
  }
}
