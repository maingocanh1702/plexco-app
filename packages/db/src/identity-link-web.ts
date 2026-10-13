import type pg from "pg";
import { consumeLinkCode, type LinkCodeKeys } from "./identity.js";

/**
 * Web-side account <-> Zalo link (lane M3b). Two steps: consumeLinkCode (0043) verifies + consumes
 * a channel-issued code for the signed-in account, then link_code_reparent_empty_person (0054) moves
 * the Zalo identity onto the account's Person IF the Zalo-side Person is empty. A Person that holds
 * anything real needs the (P0, unbuilt) merge planner: that is `requires_review`, never a merge.
 *
 * The result is deliberately coarse. Person ids, attempt counters and the list of blocking tables
 * never leave this module: `invalid` covers "no such code", "wrong code" and every terminal state
 * (an existence oracle otherwise), and `unsupported` is an account-issued code.
 */
export type LinkZaloOutcome =
  "linked" | "already_linked" | "requires_review" | "invalid" | "rate_limited" | "unsupported";

type ReparentOutcome = "consumed" | "same_person" | "requires_review" | "invalid" | "unsupported";

export async function linkZaloToAccount(
  pool: pg.Pool,
  rawCode: string,
  accountId: string,
  keys: LinkCodeKeys,
  opts: { cooldownSeconds?: number } = {},
): Promise<{ outcome: LinkZaloOutcome }> {
  const consumed = await consumeLinkCode(pool, rawCode, { accountId }, keys, opts);
  switch (consumed.outcome) {
    case "invalid":
      return { outcome: "invalid" };
    case "wrong_code":
      // Only an exhausted cap is rate_limited: the 5 s cooldown is written on EVERY wrong attempt,
      // so keying on lockedUntil would turn each typo into a 429 and tell a guesser the row exists.
      return {
        outcome:
          consumed.failedAttempts !== null &&
          consumed.maxAttempts !== null &&
          consumed.failedAttempts >= consumed.maxAttempts
            ? "rate_limited"
            : "invalid",
      };
    case "same_person":
      return { outcome: "already_linked" };
    case "consumed":
      break;
  }
  if (consumed.linkCodeId === null) return { outcome: "invalid" }; // unreachable: consumed always carries the id
  const { rows } = await pool.query(`SELECT outcome FROM link_code_reparent_empty_person($1, $2)`, [
    consumed.linkCodeId,
    accountId,
  ]);
  const outcome = (rows[0] as { outcome: ReparentOutcome } | undefined)?.outcome;
  switch (outcome) {
    case "consumed":
      return { outcome: "linked" };
    case "same_person":
      return { outcome: "already_linked" };
    case "requires_review":
    case "unsupported":
    case "invalid":
      return { outcome };
    default:
      return { outcome: "invalid" }; // missing row / unknown value: fail closed
  }
}
