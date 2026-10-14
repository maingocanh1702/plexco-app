import type pg from "pg";
import { consumeLinkCode, type LinkCodeKeys } from "./identity.js";

/**
 * Web-side account <-> Zalo link (lane M3b). Two steps in ONE transaction on ONE pooled client:
 * consumeLinkCode (0043) verifies + consumes a channel-issued code for the signed-in account, then
 * link_code_reparent_empty_person (0054) moves the Zalo identity onto the account's Person IF the
 * Zalo-side Person is empty. A Person that holds anything real needs the (P0, unbuilt) merge
 * planner: that is `requires_review`, never a merge.
 *
 * Atomicity (PR #49 security review round 1, SF1): the consume commits only together with the
 * decision it enables. A re-parent that raises, or a connection lost before COMMIT, rolls the
 * consume back, so the code stays live and nothing moved; two separate transactions instead burned
 * the code AND left it consumed-but-unacted, re-parentable by any app caller for the definer's
 * 10-minute window. A wrong-code attempt IS committed (the attempt cap must count it), and so are
 * the consume's own `same_person` claim and the definer's `requires_review` (code spent + support
 * audit row). The definer's other refusals (`invalid`, `unsupported`) roll back: nothing written.
 *
 * Lock order is 0043's (accounts -> persons in UUID order -> channel_identities -> link_codes): the
 * definer re-locks exactly the rows consume already holds, so the shared transaction adds no edge.
 * A residual deadlock / serialization failure (40P01 / 40001) rolls back whole and is `unavailable`
 * (retryable LINK_UNAVAILABLE at the route).
 *
 * The result is deliberately coarse. Person ids, attempt counters and the list of blocking tables
 * never leave this module: `invalid` covers "no such code", "wrong code" and every terminal state
 * (an existence oracle otherwise), and `unsupported` is an account-issued code.
 */
export type LinkZaloOutcome =
  | "linked"
  | "already_linked"
  | "requires_review"
  | "invalid"
  | "rate_limited"
  | "unsupported"
  | "unavailable";

type ReparentOutcome = "consumed" | "same_person" | "requires_review" | "invalid" | "unsupported";

/** What the transaction decided, and whether its writes must persist. */
interface Decision {
  outcome: Exclude<LinkZaloOutcome, "unavailable">;
  commit: boolean;
}

/**
 * link_code_consume RAISEs insufficient_privilege (42501) when the TARGET account has no active
 * Person; the code is untouched. ONLY that raise is mapped: a plpgsql RAISE reports routine
 * `exec_stmt_raise`, while ACL / row-security refusals (aclcheck_error, check_enable_rls) carry other
 * routines, and those must propagate.
 */
function isConsumeTargetRefusal(error: unknown): boolean {
  const e = error as { code?: string; routine?: string; message?: string };
  return (
    e.code === "42501" &&
    e.routine === "exec_stmt_raise" &&
    /^link_code_consume: target/.test(e.message ?? "")
  );
}

/** deadlock_detected / serialization_failure: Postgres aborted the whole transaction; a retry may pass. */
function isRetryableTransactionFailure(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === "40P01" || code === "40001";
}

async function consumeThenReparent(
  client: pg.PoolClient,
  rawCode: string,
  accountId: string,
  keys: LinkCodeKeys,
  opts: { cooldownSeconds?: number },
): Promise<Decision> {
  // consumeLinkCode issues nothing but `.query` calls, so the checked-out client stands in for the
  // pool: its salt read and its consume both run inside THIS transaction.
  const consumed = await consumeLinkCode(
    client as unknown as pg.Pool,
    rawCode,
    { accountId },
    keys,
    opts,
  );
  switch (consumed.outcome) {
    case "invalid":
      return { outcome: "invalid", commit: false }; // nothing was written
    case "wrong_code":
      // Committed: the failed attempt must count toward the cap. Only an exhausted cap is
      // rate_limited: the 5 s cooldown is written on EVERY wrong attempt, so keying on lockedUntil
      // would turn each typo into a 429 and tell a guesser the row exists.
      return {
        outcome:
          consumed.failedAttempts !== null &&
          consumed.maxAttempts !== null &&
          consumed.failedAttempts >= consumed.maxAttempts
            ? "rate_limited"
            : "invalid",
        commit: true,
      };
    case "same_person":
      return { outcome: "already_linked", commit: true };
    case "consumed":
      break;
  }
  if (consumed.linkCodeId === null) return { outcome: "invalid", commit: false }; // unreachable: consumed always carries the id
  const { rows } = await client.query(
    `SELECT outcome FROM link_code_reparent_empty_person($1, $2)`,
    [consumed.linkCodeId, accountId],
  );
  const outcome = (rows[0] as { outcome: ReparentOutcome } | undefined)?.outcome;
  switch (outcome) {
    case "consumed":
      return { outcome: "linked", commit: true };
    case "same_person":
      return { outcome: "already_linked", commit: true };
    case "requires_review":
      return { outcome: "requires_review", commit: true }; // code spent + the support audit row
    case "unsupported":
    case "invalid":
      return { outcome, commit: false }; // refused: the consume rolls back, the code stays live
    default:
      return { outcome: "invalid", commit: false }; // missing row / unknown value: fail closed
  }
}

export async function linkZaloToAccount(
  pool: pg.Pool,
  rawCode: string,
  accountId: string,
  keys: LinkCodeKeys,
  opts: { cooldownSeconds?: number } = {},
): Promise<{ outcome: LinkZaloOutcome }> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");
    const decision = await consumeThenReparent(client, rawCode, accountId, keys, opts);
    await client.query(decision.commit ? "COMMIT" : "ROLLBACK");
    return { outcome: decision.outcome };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      broken = rollbackError as Error; // a dead connection must not go back to the pool
    }
    if (isConsumeTargetRefusal(error)) return { outcome: "invalid" };
    if (isRetryableTransactionFailure(error)) return { outcome: "unavailable" };
    throw error; // any other failure (ACL, RLS, connectivity) is a real fault, never "invalid code"
  } finally {
    client.release(broken);
  }
}
