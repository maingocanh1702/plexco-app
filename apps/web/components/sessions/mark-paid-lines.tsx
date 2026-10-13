"use client";

import { useId } from "react";
import { useLang, useT } from "../../lib/i18n-client";
import { problems, shownTotal, type AmountMap } from "../../lib/mark-paid-model";
import { formatVnd, parseVndInput } from "../../lib/money";
import type { MarkPaidLineDto } from "../../lib/sessions-api";
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
  /** After an uncertain failure the amounts are frozen so a retry replays the SAME command. */
  locked: boolean;
  onChange: (playerId: string, text: string) => void;
}) {
  const t = useT();
  const lang = useLang();
  const uid = useId();
  const bad = problems(lines, amounts);
  return (
    <>
      <ul className={styles.lines}>
        {lines.map((line) => {
          const name = names[line.playerId] ?? t("(chưa đặt tên)", "(unnamed)");
          const problem = bad[line.playerId];
          const inputId = `${uid}-${line.playerId}`;
          const errId = `${inputId}-err`;
          return (
            <li key={line.playerId} className={styles.line}>
              <div className={styles.lineHead}>
                <label htmlFor={inputId}>{t(`Số tiền cho ${name}`, `Amount for ${name}`)}</label>
                <span>
                  {t(
                    `Còn ${formatVnd(line.remaining, lang)}`,
                    `${formatVnd(line.remaining, lang)} left`,
                  )}
                </span>
              </div>
              <input
                id={inputId}
                className={fieldStyles.control}
                inputMode="numeric"
                autoComplete="off"
                readOnly={locked}
                value={raw[line.playerId] ?? ""}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? errId : undefined}
                onChange={(e) => onChange(line.playerId, e.target.value)}
              />
              {problem ? (
                <p id={errId} className={fieldStyles.error}>
                  {t(
                    `Nhập số nguyên từ 1 đến ${formatVnd(line.remaining, lang)}.`,
                    `Enter a whole amount from 1 to ${formatVnd(line.remaining, lang)}.`,
                  )}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className={styles.total} aria-live="polite">
        <span>{t("Tổng cộng", "Total")}</span>
        <span>{formatVnd(shownTotal(lines, amounts), lang)}</span>
      </p>
    </>
  );
}

/** Raw text -> amount, shared by the sheet: digits-only parse, NaN/empty = not a valid amount. */
export const parseAmount = (text: string): number | null => {
  const v = parseVndInput(text);
  return v === null || Number.isNaN(v) ? null : v;
};
