import { reversePaymentAllocation } from "@plexco/db";
import { ok } from "../../../../../../../lib/api-envelope";
import { handleSessionCommand } from "../../../../../../../lib/session-command-route";
import { appDb, currentSession } from "../../../../../../../lib/session-cookies";

/**
 * POST /api/sessions/:id/payments/:allocationId/reverse -- undo a mistaken manual payment with a
 * negative reversal row (the ledger is append-only). Body: `commandId`, `reason` (1..200 chars).
 * Needs `money.correct` in the command (owner-grantable, DD-56), on top of the shared session.manage
 * gate. Path ids are forwarded unvalidated; the command fails them closed.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; allocationId: string }> },
): Promise<Response> {
  return handleSessionCommand(
    request,
    { bucket: "session-payment-reverse", limit: 30 },
    async (context) => {
      const session = await currentSession();
      if (!session) throw new Error("session vanished between the entry gate and the command");
      const { id, allocationId } = await params;
      const result = await reversePaymentAllocation(appDb().db, {
        tenantId: context.tenantId,
        actorPersonId: session.personId,
        commandId: context.commandId,
        sessionId: id,
        allocationId,
        reason: context.body.reason as string,
      });
      return ok({
        reversal: {
          id: result.reversalId,
          allocationId: result.allocationId,
          chargeId: result.chargeId,
          amount: result.amount,
          chargeStatus: result.status,
        },
        replayed: result.replayed,
      });
    },
  );
}
