import { sql } from "drizzle-orm";
import type { Tx } from "./client.js";
import { openPersonGender } from "./gender-crypto.js";
import { pgErrorChainText, pgErrorHasCode } from "./pg-error.js";
import { INT4_MAX, RosterMoneyError } from "./roster-money-shared.js";

/**
 * deriveChargeAmount (DD-39; readiness p3-m9-gender-pricing 4.4, RD-4): the ONE helper that turns the
 * session prices and the person's self-declared gender into a charge amount. It never writes, never
 * enqueues and never logs; upsertCharge stays the only writer of charges.amount_due, and after commit
 * that row is the authority (no reader re-derives).
 *
 * Decision table (4.4): both per-gender prices NULL => price_amount, the definer is not called;
 * consent OFF or gender never set (the definer returns NULLs) => price_amount; male / female with its
 * price set => that price; the missing side, other, undisclosed => price_amount; a set gender that
 * cannot be opened => CHARGE_DERIVATION_UNAVAILABLE, never a fallback price; an amount that is not an
 * integer in [0, INT4_MAX] => the same failure [UNPINNED U-2]; the definer's GENDER_FORBIDDEN (42501)
 * => RosterMoneyError("GENDER_FORBIDDEN"), which aborts the caller's transaction (defect path).
 * The gender never leaves this function: only the amount does. No session-service import (P-19).
 */
export type DerivationContext = "self_join" | "host_add" | "promotion";
export type ChargePrices = {
  priceAmount: number;
  priceMale: number | null;
  priceFemale: number | null;
};
export type ChargeDerivation =
  { ok: true; amount: number } | { ok: false; code: "CHARGE_DERIVATION_UNAVAILABLE" };

const unavailable = (): ChargeDerivation => ({ ok: false, code: "CHARGE_DERIVATION_UNAVAILABLE" });
const bounded = (amount: number): ChargeDerivation =>
  Number.isInteger(amount) && amount >= 0 && amount <= INT4_MAX
    ? { ok: true, amount }
    : unavailable();

type DerivationRow = { person_id: string; gender_enc: unknown; gender_key_version: string | null };

export async function deriveChargeAmount(
  tx: Tx,
  input: {
    context: DerivationContext;
    sessionId: string;
    membershipId: string;
    /** The joining person (self_join) or the host / approver (host_add); null for promotion. */
    actorPersonId: string | null;
    prices: ChargePrices;
  },
): Promise<ChargeDerivation> {
  const { priceAmount, priceMale, priceFemale } = input.prices;
  if (priceMale === null && priceFemale === null) return bounded(priceAmount);
  let row: DerivationRow | undefined;
  try {
    const { rows } = await tx.execute(
      sql`SELECT person_id, gender_enc, gender_key_version FROM charge_gender_for_derivation(${input.context}, ${input.sessionId}::uuid, ${input.membershipId}::uuid, ${input.actorPersonId}::uuid)`,
    );
    row = rows[0] as DerivationRow | undefined;
  } catch (e) {
    if (pgErrorHasCode(e, "42501") && pgErrorChainText(e).includes("GENDER_FORBIDDEN")) {
      throw new RosterMoneyError("GENDER_FORBIDDEN", "not permitted");
    }
    throw e;
  }
  // Zero rows after authorization is an anomaly: fail closed, like an unreadable gender.
  if (!row) return unavailable();
  if (row.gender_enc === null) return bounded(priceAmount);
  if (!Buffer.isBuffer(row.gender_enc)) return unavailable();
  const opened = await openPersonGender(row.person_id, row.gender_enc, row.gender_key_version);
  if (!opened.ok) return unavailable();
  const side =
    opened.gender === "male" ? priceMale : opened.gender === "female" ? priceFemale : null;
  return bounded(side ?? priceAmount);
}
