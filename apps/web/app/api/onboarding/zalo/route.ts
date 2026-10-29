import { runWithLang } from "@plexco/core/i18n";
import { getZaloOnboardingState, ZALO_CONNECTOR_ACTION } from "@plexco/db";
import { ok } from "../../../../lib/api-envelope";
import { resolveClubGate } from "../../../../lib/club-config-route";
import { setLogTenant, withRequestLogContext } from "../../../../lib/log-context";
import { appDb } from "../../../../lib/session-cookies";
import { zaloStateView } from "../../../../lib/zalo/webhook-url";

/** GET /api/onboarding/zalo?tenant=<uuid> -- connection state; returns the webhook URL (embeds the non-secret `webhook_token` lookup), never the bot token or webhook secret. */
const GET_LIMIT = { bucket: "zalo-connect-read", limit: 60 };

export function GET(request: Request): Promise<Response> {
  return withRequestLogContext(request, () => handleGet(request));
}

async function handleGet(request: Request): Promise<Response> {
  const gate = await resolveClubGate(request, {
    csrf: false,
    action: ZALO_CONNECTOR_ACTION,
    tenantBucket: GET_LIMIT,
  });
  if (gate instanceof Response) return gate;
  setLogTenant(gate.tenantId);
  return runWithLang(gate.lang, async () => {
    const s = await getZaloOnboardingState(appDb().db, { tenantId: gate.tenantId });
    return ok(zaloStateView(process.env.APP_BASE_URL?.trim(), s));
  });
}
