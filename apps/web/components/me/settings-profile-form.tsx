"use client";

import { useRef, useState, type FormEvent } from "react";
import { useT } from "../../lib/i18n-client";
import {
  displayNameProblem,
  patchMyProfile,
  type DisplayNameProblem,
  type ProfileDto,
} from "../../lib/me-settings-client";
import { useCommandId } from "../../lib/use-command-id";
import { useOnlineStatus } from "../../lib/use-online-status";
import { Button } from "../ui/button";
import { TextField } from "../ui/text-field";
import { FormFeedback } from "../settings/form-feedback";
import styles from "../settings/settings-layout.module.css";

/** Display-name form. One commandId per attempt; the result region takes focus after every outcome. */
export function SettingsProfileForm({
  initial,
  csrfToken,
  onSaved,
}: {
  initial: ProfileDto;
  csrfToken: string;
  onSaved: (profile: ProfileDto) => void;
}) {
  const t = useT();
  const online = useOnlineStatus();
  const command = useCommandId();
  const formRef = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState(initial.displayName ?? "");
  const [problem, setProblem] = useState<DisplayNameProblem | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focusKey, setFocusKey] = useState(0);

  const problemText: Record<DisplayNameProblem, string> = {
    empty: t("Nhập tên hiển thị.", "Enter a display name."),
    too_long: t("Tên tối đa 120 ký tự.", "The name is at most 120 characters."),
    invalid_chars: t(
      "Tên không được chứa ký tự điều khiển hoặc ký tự ẩn.",
      "The name cannot contain control or hidden characters.",
    ),
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    setError(null);
    const found = displayNameProblem(value);
    setProblem(found);
    if (found) {
      formRef.current?.querySelector("input")?.focus();
      return;
    }
    setBusy(true);
    try {
      const profile = await patchMyProfile(csrfToken, {
        displayName: value.trim(),
        commandId: command.get(),
      });
      command.settle();
      setValue(profile.displayName ?? "");
      setSaved(true);
      onSaved(profile);
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
        label={t("Tên hiển thị", "Display name")}
        hint={t("Tên bạn muốn câu lạc bộ nhìn thấy.", "The name you want clubs to see.")}
        value={value}
        error={problem ? problemText[problem] : null}
        autoComplete="name"
        maxLength={200}
        onChange={(e) => {
          setValue(e.target.value);
          setProblem(null);
          setSaved(false);
        }}
      />
      <FormFeedback
        focusKey={focusKey}
        error={error}
        message={saved ? t("Đã lưu hồ sơ.", "Profile saved.") : null}
        onRetry={() => formRef.current?.requestSubmit()}
        onReload={() => window.location.reload()}
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
