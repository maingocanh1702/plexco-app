"use client";

import { useEffect, useRef } from "react";
import { useLang, useT } from "../../lib/i18n-client";
import { formatVnd } from "../../lib/money";
import { displayNameOf } from "../../lib/roster-rules";
import type { MarkPaidLineDto } from "../../lib/roster-payments-api";
import { Badge } from "../ui/badge";
import styles from "./roster.module.css";

/** Step 3: what the server recorded per player; focus moves here on arrival so the change is announced. */
export function MarkPaidResult({
  lines,
  names,
}: {
  lines: readonly MarkPaidLineDto[];
  names: Record<string, string>;
}) {
  const t = useT();
  const lang = useLang();
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => list.current?.focus(), []);
  return (
    <ul
      ref={list}
      tabIndex={-1}
      className={styles.lines}
      aria-label={t("Kết quả ghi nhận thanh toán", "Recorded payments")}
    >
      {lines.map((l) => (
        <li key={l.playerId} className={styles.lineHead}>
          <span>{displayNameOf(names[l.playerId], t)}</span>
          <span>{formatVnd(l.amount, lang)}</span>
          <Badge tone={l.status === "paid" ? "success" : "warning"}>
            {l.status === "paid" ? t("Đã thanh toán", "Paid") : t("Trả một phần", "Partly paid")}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
