import { sql } from "drizzle-orm";
import type { Db, Tx } from "./client.js";

/**
 * The CLOSED reason enum migration 0033's raise_public_session_fence accepts
 * (visibility_private | cancelled | closed). The SECURITY DEFINER function fails closed on any
 * other value, so this union keeps callers honest at compile time too — never invent a reason.
 */
export type PublicSessionFenceReason = "visibility_private" | "cancelled" | "closed";

/**
 * Raise the DD-12 immediate-deny fence for a session in the SAME source transaction as the
 * privacy-reducing mutation that triggers it. The guarded view public_session_share_v anti-joins
 * public_projection_fences, so the public read path denies IMMEDIATELY — it does NOT wait for the
 * async projector (decisions.md DD-12 "Immediate-deny path"). raise_public_session_fence is
 * SECURITY DEFINER and verifies the session belongs to the caller's tenant (fail-closed on a
 * missing/mismatched app.tenant_id GUC), so this MUST be called inside withTenant (tenant GUC set).
 *
 * Shared core so every privacy-reducing session command stays thin: updateSession raises
 * 'visibility_private' on ANY public->private edit (no status gate — see updateSession); a later
 * cancel/close slice reuses this with 'cancelled'/'closed'. The projector-worker later CAS-clears the
 * fence after convergence (a separate lane); this helper only RAISES.
 */
export async function raisePublicSessionFence(
  tx: Tx,
  sessionId: string,
  reason: PublicSessionFenceReason,
): Promise<void> {
  await tx.execute(sql`select raise_public_session_fence(${sessionId}::uuid, ${reason})`);
}

/**
 * CAS-clear the session's DD-12 fence after the projector converged (0033
 * clear_public_session_fence): the fence is deleted ONLY while its token is still the one the
 * caller observed through current_public_session_fence_token before projecting, so a newer raise
 * (a new token) always wins and a stale clear is a no-op. Both functions are EXECUTE app_worker
 * only: call it on an app_worker connection (a transaction or a plain handle). Returns true when
 * the fence was cleared, false when it was already gone or re-raised.
 */
export async function clearPublicSessionFence(
  db: Pick<Db, "execute"> | Tx,
  sessionId: string,
  observedToken: string,
): Promise<boolean> {
  const result = await db.execute(
    sql`select clear_public_session_fence(${sessionId}::uuid, ${observedToken}::uuid) as cleared`,
  );
  return (result.rows[0] as { cleared: boolean } | undefined)?.cleared === true;
}
