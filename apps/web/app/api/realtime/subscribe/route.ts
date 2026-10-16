import { runWithLang, t } from "@plexco/core/i18n";
import { err } from "../../../../lib/api-envelope";
import { recheckSubscriber, resolveRealtimePrincipal } from "../../../../lib/realtime-auth";
import { openRealtimeStream, realtimeListener } from "../../../../lib/realtime-listener";
import { resolveSessionReadContext } from "../../../../lib/session-read-route";

/**
 * GET /api/realtime/subscribe?tenant=<uuid> (lane L5, readiness R-6, R-7): the host workspace's
 * same-origin, cookie-authenticated live-sync stream. Admission is the host READ gate unchanged,
 * so its 401/400/403/429 bodies are GET /api/sessions' own (no existence oracle). Every frame is
 * re-authorized per event and the heartbeat re-checks access (realtime-listener.ts). Ids only
 * ({type, sessionId, version}); clients refetch through the authorized GET. Never public or
 * anonymous.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ADMISSION = { bucket: "realtime-subscribe", limit: 30 };

export async function GET(request: Request): Promise<Response> {
  const context = await resolveSessionReadContext(request, ADMISSION);
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
