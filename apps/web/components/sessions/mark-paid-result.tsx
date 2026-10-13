"use client";

import { useLang, useT } from "../../lib/i18n-client";
import { formatVnd } from "../../lib/money";
import type { MarkPaidLineDto } from "../../lib/sessions-api";
import { Badge } from "../ui/badge";
import styles from "./roster.module.css";

/** Step 3: what the server recorded per player (announced politely). */
export function MarkPaidResult({
  lines,
  names,
}: {
  lines: readonly MarkPaidLineDto[];
  names: Record<string, string>;
}) {
  const t = useT();
  const lang = useLang();
  return (
    <ul className={styles.lines} aria-live="polite">
      {lines.map((l) => (
        <li key={l.playerId} className={styles.lineHead}>
          <span>{names[l.playerId]}</span>
          <span>{formatVnd(l.amount, lang)}</span>
          <Badge tone={l.status === "paid" ? "success" : "warning"}>
            {l.status === "paid" ? t("Đã thanh toán", "Paid") : t("Trả một phần", "Partly paid")}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
