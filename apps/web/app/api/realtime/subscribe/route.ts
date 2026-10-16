import { runWithLang, t } from "@plexco/core/i18n";
import { err } from "../../../../lib/api-envelope";
import { recheckSubscriber, resolveRealtimePrincipal } from "../../../../lib/realtime-auth";
import { openRealtimeStream, realtimeListener } from "../../../../lib/realtime-listener";
import { resolveSessionReadContext } from "../../../../lib/session-read-route";

/**
 * GET /api/realtime/subscribe?tenant=<uuid> (lane L5, readiness R-6, R-7): the host workspace's
 * live-sync stream (text/event-stream, same origin, cookie-authenticated).
 *
 * Admission is the host READ gate unchanged (session cookie -> tenant param -> actor ceiling ->
 * session.manage -> tenant language -> per-tenant bucket), so its 401/400/403/429 bodies are the
 * ones GET /api/sessions returns, with no existence oracle. Every pushed frame is re-authorized
 * per event, and the heartbeat re-checks the session and capability (realtime-listener.ts). The
 * stream carries ids only ({type, sessionId, version}); the client refetches through the
 * authorized GET. Never a public or anonymous surface.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const context = await resolveSessionReadContext(request, {
    bucket: "realtime-subscribe",
    limit: 30,
  });
  if (context instanceof Response) return context;
  // The principal plus the token hash the heartbeat re-resolves; null is the gate's own 401.
  const principal = await resolveRealtimePrincipal();
  if (!principal) return err("AUTH_REQUIRED", t("Chưa đăng nhập.", "Not signed in."), 401);

  return runWithLang(context.lang, async () => {
    const stream = openRealtimeStream(
      realtimeListener(),
      { ...principal, tenantId: context.tenantId },
      { recheck: recheckSubscriber, signal: request.signal },
    );
    if (!stream) {
      return err("RATE_LIMITED", t("Quá nhiều yêu cầu — đợi.", "Too many requests — wait."), 429);
    }
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
