"use client";

import { useId } from "react";
import { useT } from "../../lib/i18n-client";
import { problems, shownTotal, type AmountMap } from "../../lib/mark-paid-model";
import { formatVnd, parseVndInput } from "../../lib/money";
import { displayNameOf } from "../../lib/roster-rules";
import type { MarkPaidLineDto } from "../../lib/roster-payments-api";
import fieldStyles from "../ui/field.module.css";
import styles from "./roster.module.css";

/** Step 2: the server's preview lines, each amount editable within 1..remaining, plus the running total. */
export function MarkPaidLines({
  lines,
  names,
  raw,
  amounts,
  locked,
  onChange,
}: {
  lines: readonly MarkPaidLineDto[];
  names: Record<string, string>;
  raw: Record<string, string>;
  amounts: AmountMap;
  /** Read-only while a confirm is in flight and after an uncertain failure (the retry replays). */
  locked: boolean;
  onChange: (playerId: string, text: string) => void;
}) {
  const t = useT();
  const uid = useId();
  const bad = problems(lines, amounts);
  const total = shownTotal(lines, amounts);
  return (
    <>
      <ul className={styles.lines}>
        {lines.map((line, index) => {
          const name = displayNameOf(names[line.playerId], t);
          const problem = bad[line.playerId];
          const inputId = `${uid}-${line.playerId}`;
          const errId = `${inputId}-err`;
          return (
            <li key={line.playerId} className={styles.line}>
              <div className={styles.lineHead}>
                <label htmlFor={inputId}>{t(`Số tiền cho ${name}`, `Amount for ${name}`)}</label>
                <span>
                  {t(`Còn ${formatVnd(line.remaining)}`, `${formatVnd(line.remaining)} left`)}
                </span>
              </div>
              <input
                id={inputId}
                className={fieldStyles.control}
                inputMode="numeric"
                autoComplete="off"
                readOnly={locked}
                // the review step just replaced the form: move focus to the first amount (announces it)
                autoFocus={index === 0}
                value={raw[line.playerId] ?? ""}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? errId : undefined}
                onChange={(e) => onChange(line.playerId, e.target.value)}
              />
              {problem ? (
                <p id={errId} className={fieldStyles.error}>
                  {t(
                    `Nhập số nguyên từ 1 đến ${formatVnd(line.remaining)}.`,
                    `Enter a whole amount from 1 to ${formatVnd(line.remaining)}.`,
                  )}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className={styles.total} aria-live="polite">
        <span>{t("Tổng cộng", "Total")}</span>
        <span>{total === null ? "—" : formatVnd(total)}</span>
      </p>
    </>
  );
}

/** Raw text -> amount, shared by the sheet: digits-only parse, NaN/empty = not a valid amount. */
export const parseAmount = (text: string): number | null => {
  const v = parseVndInput(text);
  return v === null || Number.isNaN(v) ? null : v;
};
