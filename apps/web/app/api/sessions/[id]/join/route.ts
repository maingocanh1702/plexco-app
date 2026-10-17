import type { JoinSessionResultDto } from "@plexco/core";
import { joinSession } from "@plexco/db";
import { ok } from "../../../../../lib/api-envelope";
import {
  handleSessionCommand,
  SESSION_JOIN_PERSON_LIMIT,
} from "../../../../../lib/session-command-route";
import { appDb, currentSession } from "../../../../../lib/session-cookies";

/**
 * POST /api/sessions/:id/join -- a PLAYER joins a session of their own club (L8, M9). Open with a
 * free seat -> active + exactly one charge; full -> waitlisted at the FIFO tail (no charge); an
 * approval-policy session -> a pending join request only. Body: `commandId`; no other key is read.
 *
 * Neither identity nor tenant is client-supplied (HARD RULES 1, 4): the tenant is `?tenant=` as the
 * entry gate resolved it (selfService, readiness P-3: a live member of that club, anyone else the
 * one FORBIDDEN 403) and the person is the session cookie's. No allowGuestMembership here: visitors
 * join through L10b's public_listing_id route. joinSession re-validates the canonical live state
 * under the session row lock, so a stale client view can never oversell.
 *
 * Quotas (P-13): the player routes' tenant bucket `session-self-service` 60/60 s and the per-person
 * `session-join` 10/3600 s (shared with join requests and L10b's join-by-slug route).
 *
 * DTO (P-18): the outcome and ids only, built key by key: no amount (own money is the L9/L12 read)
 * and no venue (the L12 player view).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleSessionCommand(
    request,
    { bucket: "session-self-service", limit: 60 },
    async (context) => {
      const session = await currentSession();
      if (!session) throw new Error("session vanished between the entry gate and the command");
      const { id } = await params;
      const result = await joinSession(appDb().db, {
        tenantId: context.tenantId,
        personId: session.personId,
        sessionId: id,
        commandId: context.commandId,
      });
      const join: JoinSessionResultDto = {
        outcome: result.outcome,
        playerId: result.playerId,
        waitlistPosition: result.waitlistPosition,
        requestId: result.requestId,
      };
      return ok({ join, replayed: result.replayed });
    },
    { selfService: true, personLimit: SESSION_JOIN_PERSON_LIMIT },
  );
}
