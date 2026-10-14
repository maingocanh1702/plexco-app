"use client";

import { useRef, useState, type FormEvent } from "react";
import { patchClubConfig, type ClubConfigDto } from "../../lib/club-settings-client";
import {
  buildProfilePatch,
  profileValues,
  timezoneOptions,
  type ProfileFormValues,
} from "../../lib/club-settings-model";
import { useT } from "../../lib/i18n-client";
import { displayNameProblem } from "../../lib/me-settings-client";
import { useCommandId } from "../../lib/use-command-id";
import { useOnlineStatus } from "../../lib/use-online-status";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { TextField } from "../ui/text-field";
import { FormFeedback } from "./form-feedback";
import styles from "./settings-layout.module.css";

/** Club name / timezone / language (tenants.locale, DD-118: the ONLY language source). */
export function ClubProfileForm({
  tenantId,
  csrfToken,
  club,
  onSaved,
}: {
  tenantId: string;
  csrfToken: string;
  club: ClubConfigDto;
  /** Called after a successful save so the shell (name, language) and the form reload. */
  onSaved: () => void;
}) {
  const t = useT();
  const online = useOnlineStatus();
  const command = useCommandId();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<ProfileFormValues>(() => profileValues(club));
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusKey, setFocusKey] = useState(0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const problem = displayNameProblem(values.name);
    if (problem) {
      setNameError(
        problem === "empty"
          ? t("Nhập tên câu lạc bộ.", "Enter the club name.")
          : problem === "too_long"
            ? t("Tên tối đa 120 ký tự.", "The name is at most 120 characters.")
            : t(
                "Tên không được chứa ký tự điều khiển hoặc ký tự ẩn.",
                "The name cannot contain control or hidden characters.",
              ),
      );
      formRef.current?.querySelector("input")?.focus();
      return;
    }
    setNameError(null);
    const patch = buildProfilePatch(club, values);
    if (patch === null) {
      setMessage(t("Chưa có thay đổi nào để lưu.", "Nothing has changed."));
      setFocusKey((n) => n + 1);
      return;
    }
    setBusy(true);
    try {
      // The key is bound to this exact patch: an edit after an uncertain failure is a new command
      // (the route would replay the old key as a no-change 200), an identical retry replays.
      const commandId = command.get(JSON.stringify(patch));
      await patchClubConfig({ tenantId, csrfToken }, { ...patch, commandId });
      command.settle();
      setMessage(t("Đã lưu thông tin câu lạc bộ.", "Club details saved."));
      onSaved();
    } catch (failure) {
      command.settle(failure);
      setError(failure);
    } finally {
      setBusy(false);
      setFocusKey((n) => n + 1);
    }
  }

  return (
    <form ref={formRef} className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
      <TextField
        label={t("Tên câu lạc bộ", "Club name")}
        value={values.name}
        error={nameError}
        maxLength={200}
        onChange={(e) => {
          setValues({ ...values, name: e.target.value });
          setNameError(null);
        }}
      />
      <Select
        label={t("Múi giờ", "Time zone")}
        value={values.timezone}
        options={timezoneOptions(club.timezone).map((zone) => ({ value: zone, label: zone }))}
        onChange={(e) => setValues({ ...values, timezone: e.target.value })}
      />
      <Select
        label={t("Ngôn ngữ của câu lạc bộ", "Club language")}
        value={values.locale}
        options={[
          { value: "vi", label: "Tiếng Việt" },
          { value: "en", label: "English" },
        ]}
        onChange={(e) => setValues({ ...values, locale: e.target.value === "en" ? "en" : "vi" })}
      />
      <p className={styles.caption}>
        {t(
          "Áp dụng cho giao diện và tin nhắn của cả câu lạc bộ — không có ngôn ngữ riêng cho từng thành viên.",
          "Applies to the whole club's interface and messages — there is no per-member language.",
        )}
      </p>
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
      {online ? null : (
        <p className={styles.caption}>
          {t("Bạn đang offline — kết nối lại để lưu.", "You are offline — reconnect to save.")}
        </p>
      )}
    </form>
  );
}
