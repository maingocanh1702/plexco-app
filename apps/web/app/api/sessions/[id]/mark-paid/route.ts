import { markPaid, type MarkPaidItemInput } from "@plexco/db";
import { ok } from "../../../../../lib/api-envelope";
import { handleSessionCommand, present } from "../../../../../lib/session-command-route";
import { appDb, currentSession } from "../../../../../lib/session-cookies";

/**
 * POST /api/sessions/:id/mark-paid -- manual payment for ONE OR MANY players (a single player is a
 * batch of one). Two phases on one endpoint (DD-25 preview -> confirm):
 *   - `preview: true`  -> server-computed per-player remaining + batch total; writes NOTHING and
 *     consumes no command key (the shared gate still wants a `commandId` field; send any value);
 *   - confirm          -> `commandId` + `expectedTotal` (the preview's total). A stale total is
 *     refused (MARK_PAID_TOTAL_MISMATCH) with nothing written.
 * Body: `method` cash | attested_transfer, `items: [{playerId, amount?}]` (amount omitted = pay the
 * whole remaining balance), optional `note` (<= 200 chars).
 *
 * Rate limit: 30/min per tenant (feature_payment_reconcile_tech.md batch endpoint). Everything is
 * forwarded unvalidated -- dedup precedes validation (DD-117 D5); the actor comes from the cookie.
 * Money appears only here, in the authenticated host response (HR2).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleSessionCommand(
    request,
    { bucket: "session-mark-paid", limit: 30 },
    async (context) => {
      const session = await currentSession();
      if (!session) throw new Error("session vanished between the entry gate and the command");
      const { id } = await params;
      const body = context.body;
      const result = await markPaid(appDb().db, {
        tenantId: context.tenantId,
        actorPersonId: session.personId,
        commandId: context.commandId,
        sessionId: id,
        method: body.method as "cash" | "attested_transfer",
        items: body.items as MarkPaidItemInput[],
        ...(present(body, "note") ? { note: body.note as string } : {}),
        // Only a literal `true` previews: anything else is a confirm and needs expectedTotal.
        preview: body.preview === true,
        ...(present(body, "expectedTotal") ? { expectedTotal: body.expectedTotal as number } : {}),
      });
      return ok({
        preview: result.preview,
        replayed: result.replayed,
        method: result.method,
        total: result.total,
        lines: result.lines,
      });
    },
  );
}
