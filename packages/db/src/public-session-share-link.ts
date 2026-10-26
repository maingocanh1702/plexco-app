import { and, eq, sql } from "drizzle-orm";
import { sessions } from "../schema.js";
import type { Db } from "./client.js";
import { pgErrorHasCode } from "./pg-error.js";
import {
  fail,
  isUuid,
  recordCommand,
  replayOrNull,
  requireActor,
  requireCommandId,
} from "./roster-money-shared.js";
import { withTenant } from "./tenant.js";

/**
 * Host command (L39 D4a with the orchestrator's corrections): mint a fresh public share link
 * through the 0061 definer `public_session_share_slug_rotate`, which revokes the active link and
 * returns the new raw slug once (only its hash is stored). The raw slug lives only in the returned
 * value: it is never logged, put in an error message or written to the ledger.
 */

/** processed_commands.command_type, in the style of "MarkPaid" and "ReversePaymentAllocation". */
const TYPE = "RotatePublicSessionShareLink";
const MANAGE = ["session.manage"] as const;
/** One answer for a non-UUID, missing or foreign session; never the definer's P0001 text. */
const NOT_FOUND = "session not found in tenant context";

export type RotatePublicSessionShareLinkResult =
  { kind: "rotated"; slug: string } | { kind: "replayed" } | { kind: "not_listed" };

/** The ledger row is exactly `{ sessionId, actorPersonId }` (replayOrNull's contract). */
const isStored = (v: unknown): v is { sessionId: string; actorPersonId: string } =>
  typeof v === "object" &&
  v !== null &&
  isUuid((v as Record<string, unknown>).sessionId) &&
  isUuid((v as Record<string, unknown>).actorPersonId);

export async function rotatePublicSessionShareLink(
  db: Db,
  params: { tenantId: string; actorPersonId: string; sessionId: string; commandId: string },
): Promise<RotatePublicSessionShareLinkResult> {
  const { tenantId, actorPersonId } = params;
  if (!isUuid(params.sessionId)) return fail("SESSION_NOT_FOUND", NOT_FOUND);
  const sessionId = params.sessionId.toLowerCase();
  const commandId = requireCommandId(params.commandId);
  try {
    return await withTenant<RotatePublicSessionShareLinkResult>(db, tenantId, async (tx) => {
      // requireActor inside this transaction: session.manage, then the tenant status with the class
      // publishSession uses (session-service.ts), so a suspended tenant is TENANT_SUSPENDED, not a
      // not_listed 409; then the tenant-scoped pre-read, dedup, the mint and the ledger row.
      const actor = await requireActor(tx, tenantId, actorPersonId, MANAGE, "publish_new_sessions");
      const [session] = await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.tenantId, tenantId)));
      if (session === undefined) return fail("SESSION_NOT_FOUND", NOT_FOUND);
      const stored = await replayOrNull(tx, tenantId, commandId, TYPE, sessionId, actor, isStored);
      // A replay mints nothing and never repeats a link: the slug is shown once.
      if (stored !== null) return { kind: "replayed" };
      const result = await tx.execute(
        sql`SELECT public_session_share_slug_rotate(${sessionId}::uuid) AS slug`,
      );
      const slug = (result.rows[0] as { slug?: unknown } | undefined)?.slug;
      if (typeof slug !== "string") throw new Error("share link rotate returned no link");
      await recordCommand(tx, tenantId, commandId, TYPE, { sessionId, actorPersonId: actor });
      return { kind: "rotated", slug };
    });
  } catch (error) {
    // 55000: the public view does not list the session (private, ended, fenced, or a tenant the
    // view hides). Caught outside withTenant, so the transaction and its ledger row have rolled back
    // and a retry with the same commandId stays possible.
    if (pgErrorHasCode(error, "55000")) return { kind: "not_listed" };
    throw error;
  }
}
