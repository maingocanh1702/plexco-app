import { runWithLang, t } from "@plexco/core/i18n";
import { listChatChannels, withChatActor } from "@plexco/db";
import { err } from "../../../../lib/api-envelope";
import {
  CHAT_SUBSCRIBE_LIMIT,
  chatGate,
  chatRateLimited,
  mapChatError,
} from "../../../../lib/chat-route";
import {
  encodeChatFrame,
  recheckChatSubscriber,
  resolveRealtimePrincipal,
} from "../../../../lib/realtime-auth";
import { chatRealtimeListener, openRealtimeStream } from "../../../../lib/realtime-listener";
import { appDb, rateLimited } from "../../../../lib/session-cookies";

/**
 * GET /api/chat/subscribe?tenant=<uuid> (lane L15, readiness 4.6): a club member's chat stream
 * behind chatGate, the per-account bucket and D-23. Every event is re-read under the subscriber's
 * tenant and chat membership (realtime-auth.ts); frames carry ids only. Never public; no logging.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const gate = await chatGate(request);
  if (gate instanceof Response) return gate;
  const { tenantId, personId, lang } = gate;
  // A missing principal or a different person is chatGate's own 401 pair (fail closed).
  const principal = await resolveRealtimePrincipal();
  if (!principal || principal.personId !== personId) {
    return err("AUTH_REQUIRED", t("Chưa đăng nhập.", "Not signed in."), 401);
  }
  return runWithLang(lang, async () => {
    const { bucket, limit, windowSeconds } = CHAT_SUBSCRIBE_LIMIT;
    if (await rateLimited(`${bucket}:${principal.accountId}`, limit, windowSeconds)) {
      return chatRateLimited();
    }
    try {
      // D-23: no readable club channel is the one CHAT_FORBIDDEN body (runChat's mapping).
      await withChatActor(appDb().db, { tenantId, personId }, listChatChannels);
    } catch (e) {
      const mapped = mapChatError(e);
      if (mapped === null) throw e;
      return mapped;
    }
    const stream = openRealtimeStream(
      chatRealtimeListener(),
      { ...principal, tenantId },
      { recheck: recheckChatSubscriber, encode: encodeChatFrame, signal: request.signal },
    );
    if (!stream) return chatRateLimited(); // D-4: the account's sixth chat stream
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        "x-accel-buffering": "no",
      },
    });
  });
}
