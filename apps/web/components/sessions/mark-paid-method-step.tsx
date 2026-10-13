"use client";

import { useT } from "../../lib/i18n-client";
import { NOTE_MAX } from "../../lib/mark-paid-model";
import type { PaymentMethod } from "../../lib/sessions-api";
import { TextField } from "../ui/text-field";
import styles from "./roster.module.css";

/** Step 1: how it was paid (cash | host-attested transfer) and an optional note. */
export function MarkPaidMethodStep({
  method,
  note,
  onMethod,
  onNote,
}: {
  method: PaymentMethod;
  note: string;
  onMethod: (m: PaymentMethod) => void;
  onNote: (n: string) => void;
}) {
  const t = useT();
  return (
    <>
      <fieldset className={styles.radios}>
        <legend>{t("Hình thức thanh toán", "Payment method")}</legend>
        {(["cash", "attested_transfer"] as const).map((m) => (
          <label key={m} className={styles.radio}>
            <input
              type="radio"
              name="mark-paid-method"
              value={m}
              checked={method === m}
              onChange={() => onMethod(m)}
            />
            {m === "cash"
              ? t("Tiền mặt", "Cash")
              : t("Chuyển khoản (host xác nhận)", "Bank transfer (host-confirmed)")}
          </label>
        ))}
      </fieldset>
      <TextField
        label={t("Ghi chú (không bắt buộc)", "Note (optional)")}
        value={note}
        maxLength={NOTE_MAX}
        onChange={(e) => onNote(e.target.value)}
      />
    </>
  );
}
