"use client";

import { useLang, useT } from "../../lib/i18n-client";
import { formatVnd } from "../../lib/money";
import { ledgerRows } from "../../lib/roster-rules";
import type { RosterChargeDto } from "../../lib/sessions-api";
import { Button } from "../ui/button";
import styles from "./roster.module.css";

/** Expandable per-player ledger: every allocation (append-only), with "Hoàn tác" on reversible manual rows. */
export function RosterLedgerDetails({
  charge,
  name,
  canReverse,
  onReverse,
}: {
  charge: RosterChargeDto;
  name: string;
  canReverse: boolean;
  onReverse: (allocationId: string, amount: number) => void;
}) {
  const t = useT();
  const lang = useLang();
  const rows = ledgerRows(charge, t);
  const date = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  });
  return (
    <details className={styles.ledger}>
      <summary>
        {t(
          `Chi tiết thanh toán (đã thu ${formatVnd(charge.effectiveAllocated, lang)})`,
          `Payment details (${formatVnd(charge.effectiveAllocated, lang)} collected)`,
        )}
      </summary>
      <ul
        className={styles.ledgerList}
        aria-label={t(`Sổ thanh toán của ${name}`, `Ledger for ${name}`)}
      >
        {rows.map((row) => (
          <li key={row.id} className={styles.ledgerRow}>
            <span>{date.format(new Date(row.createdAt))}</span>
            <strong className={row.amount < 0 ? styles.negative : undefined}>
              {formatVnd(row.amount, lang)}
            </strong>
            <span>{row.label}</span>
            {row.note ? <span>{row.note}</span> : null}
            {row.reversible ? (
              <Button
                variant="ghost"
                disabled={!canReverse}
                aria-label={t(
                  `Hoàn tác khoản ${formatVnd(row.amount, lang)} của ${name}`,
                  `Reverse ${formatVnd(row.amount, lang)} payment of ${name}`,
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
