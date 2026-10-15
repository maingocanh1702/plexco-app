"use client";

import { useLang, useT } from "../../lib/i18n-client";
import { formatVnd } from "../../lib/money";
import { ledgerRows } from "../../lib/roster-rules";
import { formatTimestamp } from "../../lib/session-time";
import type { RosterChargeDto } from "../../lib/sessions-api";
import { Button } from "../ui/button";
import styles from "./roster.module.css";

/** Expandable per-player ledger: every allocation (append-only), with "Hoàn tác" on reversible manual rows. */
export function RosterLedgerDetails({
  charge,
  name,
  canReverse,
  timeZone,
  reverseHint,
  onReverse,
}: {
  charge: RosterChargeDto;
  name: string;
  canReverse: boolean;
  /** Session zone (session-time.ts invariant): never the browser's own. */
  timeZone: string;
  /** id of the paragraph explaining why Reverse is disabled (the payment gate's hint) */
  reverseHint?: string;
  onReverse: (allocationId: string, amount: number) => void;
}) {
  const t = useT();
  const lang = useLang();
  const rows = ledgerRows(charge, t);
  return (
    <details className={styles.ledger}>
      <summary>
        {t(
          `Chi tiết thanh toán (đã thu ${formatVnd(charge.effectiveAllocated)})`,
          `Payment details (${formatVnd(charge.effectiveAllocated)} collected)`,
        )}
      </summary>
      <ul
        className={styles.ledgerList}
        aria-label={t(`Sổ thanh toán của ${name}`, `Ledger for ${name}`)}
      >
        {rows.map((row) => (
          <li key={row.id} className={styles.ledgerRow}>
            <span>{formatTimestamp(row.createdAt, timeZone, lang)}</span>
            <strong className={row.amount < 0 ? styles.negative : undefined}>
              {formatVnd(row.amount)}
            </strong>
            <span>{row.label}</span>
            {row.note ? <span>{row.note}</span> : null}
            {row.reversible ? (
              <Button
                variant="ghost"
                disabled={!canReverse}
                aria-describedby={canReverse ? undefined : reverseHint}
                aria-label={t(
                  `Hoàn tác khoản ${formatVnd(row.amount)} của ${name}`,
                  `Reverse ${formatVnd(row.amount)} payment of ${name}`,
                )}
                onClick={() => onReverse(row.id, row.amount)}
              >
                {t("Hoàn tác", "Reverse")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
