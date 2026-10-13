import type { TFn } from "./i18n-client";
import type { PaymentMethod } from "./roster-payments-api";
import type { RosterChargeDto, RosterPlayerDto } from "./sessions-api";

/**
 * Pure UI gates for the host roster. They mirror the server allowlists exactly (the server stays the
 * authority): add/remove = `open` only; mark-paid and reversal = `open` or `closed`. Any other or
 * unknown status enables nothing (fail closed).
 */
export const canEditRoster = (status: string): boolean => status === "open";
export const canTakePayments = (status: string): boolean =>
  status === "open" || status === "closed";

/** Selectable for payment: an active player whose charge still has something to pay. */
export function isPayable(player: RosterPlayerDto): boolean {
  const charge = player.charge;
  return (
    player.status === "active" &&
    charge !== null &&
    charge.remaining > 0 &&
    (charge.status === "open" || charge.status === "partial")
  );
}

const REVERSIBLE_SOURCES: readonly string[] = ["cash", "attested_transfer"];

export interface LedgerRow {
  id: string;
  amount: number;
  /** Human label of how the row came about. */
  label: string;
  /** The host's note (reason_code) when present. */
  note: string | null;
  createdAt: string;
  /** A host-recorded positive row that still has effective money left (the reversal endpoint's rule). */
  reversible: boolean;
}

/** The ONE place a player's name is rendered: a roster row may have no display name. */
export const displayNameOf = (name: string | null | undefined, t: TFn): string =>
  name ?? t("(chưa đặt tên)", "(unnamed)");

/** OD-6: the two manual money sources, labelled the same in the method picker and in the ledger. */
export function methodLabel(method: PaymentMethod, t: TFn): string {
  return method === "cash"
    ? t("Tiền mặt", "Cash")
    : t("Chuyển khoản (chủ xác nhận)", "Bank transfer (host-confirmed)");
}

export function sourceLabel(source: string, amount: number, t: TFn): string {
  if (source === "reversal" || amount < 0) return t("Hoàn tác", "Reversal");
  if (source === "cash" || source === "attested_transfer") return methodLabel(source, t);
  if (source === "auto" || source === "manual") return t("Đối soát ngân hàng", "Bank match");
  if (source === "waiver") return t("Miễn thu", "Waiver");
  return t("Khác", "Other");
}

/** Ledger rows in server order, with `reversible` derived from the same ledger (never a second formula). */
export function ledgerRows(charge: RosterChargeDto, t: TFn): LedgerRow[] {
  const undone = new Map<string, number>();
  for (const a of charge.allocations) {
    if (a.reversesAllocationId) {
      undone.set(a.reversesAllocationId, (undone.get(a.reversesAllocationId) ?? 0) + a.amount);
    }
  }
  return charge.allocations.map((a) => ({
    id: a.id,
    amount: a.amount,
    label: sourceLabel(a.source, a.amount, t),
    note: a.reasonCode,
    createdAt: a.createdAt,
    reversible:
      a.amount > 0 &&
      REVERSIBLE_SOURCES.includes(a.source) &&
      a.amount + (undone.get(a.id) ?? 0) > 0,
  }));
}
