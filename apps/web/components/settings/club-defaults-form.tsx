"use client";

import { useRef, useState, type FormEvent } from "react";
import { patchClubConfig, type ClubConfigDto } from "../../lib/club-settings-client";
import {
  buildDefaultsPatch,
  defaultsValues,
  unsureAfter,
  type ClubPatchField,
  type DefaultsFormValues,
} from "../../lib/club-settings-model";
import { useLang, useT } from "../../lib/i18n-client";
import { formatVndInput } from "../../lib/money";
import { isDefiniteFailure } from "../../lib/session-error-ui";
import type { SportDto } from "../../lib/sessions-api";
import { useCommandId } from "../../lib/use-command-id";
import { useOnlineStatus } from "../../lib/use-online-status";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { TextField } from "../ui/text-field";
import { FormFeedback } from "./form-feedback";
import styles from "./settings-layout.module.css";

/** Defaults a new session starts from: sport, price (VND) and visibility (`club.default_*`). */
export function ClubDefaultsForm({
  tenantId,
  csrfToken,
  club,
  sports,
  onSaved,
}: {
  tenantId: string;
  csrfToken: string;
  club: ClubConfigDto;
  sports: SportDto[];
  onSaved: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const online = useOnlineStatus();
  const command = useCommandId();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<DefaultsFormValues>(() =>
    defaultsValues(club, (n) => formatVndInput(n, lang)),
  );
  const [sportError, setSportError] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusKey, setFocusKey] = useState(0);
  // Fields an uncertain failure may have saved, against the `club` it was read from: see `unsure`
  // in club-settings-model.ts. A new `club` (any reload) is the server's truth and ends it.
  const unsure = useRef<{ club: ClubConfigDto; fields: Set<ClubPatchField> } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const pending = unsure.current?.club === club ? unsure.current.fields : undefined;
    const { patch, problem } = buildDefaultsPatch(club, values, pending);
    setSportError(null);
    setPriceError(null);
    if (problem === "sport_required") {
      setSportError(
        t(
          "Môn mặc định đã lưu không thể bỏ trống. Hãy chọn một môn.",
          "A saved default sport cannot be cleared. Choose a sport.",
        ),
      );
      formRef.current?.querySelector("select")?.focus();
      return;
    }
    if (problem) {
      setPriceError(
        problem === "price_invalid"
          ? t("Giá không hợp lệ.", "That price is not valid.")
          : t("Nhập giá (0 nếu miễn phí).", "Enter a price (0 if free)."),
      );
      formRef.current?.querySelector<HTMLInputElement>('input[inputmode="numeric"]')?.focus();
      return;
    }
    if (patch === null) {
      setMessage(t("Chưa có thay đổi nào để lưu.", "Nothing has changed."));
      setFocusKey((n) => n + 1);
      return;
    }
    setBusy(true);
    try {
      // Bound to this exact patch (see use-command-id.ts): an edit gets a new key, a retry replays.
      const commandId = command.get(JSON.stringify(patch));
      await patchClubConfig({ tenantId, csrfToken }, { ...patch, commandId });
      command.settle();
      unsure.current = null;
      setMessage(t("Đã lưu mặc định buổi chơi.", "Session defaults saved."));
      onSaved();
    } catch (failure) {
      command.settle(failure);
      if (!isDefiniteFailure(failure))
        unsure.current = { club, fields: unsureAfter(pending, patch) };
      setError(failure);
    } finally {
      setBusy(false);
      setFocusKey((n) => n + 1);
    }
  }

  return (
    <form ref={formRef} className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
      <Select
        label={t("Môn thể thao mặc định", "Default sport")}
        value={values.sportKey}
        options={[
          { value: "", label: t("Chưa chọn", "Not set") },
          ...sports.map((sport) => ({ value: sport.key, label: sport.name })),
        ]}
        error={sportError}
        onChange={(e) => {
          setValues({ ...values, sportKey: e.target.value });
          setSportError(null);
        }}
      />
      <TextField
        label={t("Giá mặc định (đ)", "Default price (đ)")}
        hint={t("Tiền Việt, không có phần lẻ.", "Vietnamese dong, no decimals.")}
        inputMode="numeric"
        value={values.price}
        error={priceError}
        onChange={(e) => {
          setValues({ ...values, price: e.target.value });
          setPriceError(null);
        }}
      />
      <Select
        label={t("Hiển thị mặc định", "Default visibility")}
        value={values.visibility}
        options={[
          { value: "private", label: t("Riêng tư", "Private") },
          { value: "public", label: t("Công khai", "Public") },
        ]}
        onChange={(e) =>
          setValues({ ...values, visibility: e.target.value === "public" ? "public" : "private" })
        }
      />
      <FormFeedback
        focusKey={focusKey}
        error={error}
        message={message}
        onRetry={() => formRef.current?.requestSubmit()}
        onReload={onSaved}
      />
      <div className={styles.actions}>
        <Button type="submit" disabled={busy || !online} aria-busy={busy ? true : undefined}>
          {busy ? t("Đang lưu…", "Saving…") : t("Lưu", "Save")}
        </Button>
      </div>
    </form>
  );
}
