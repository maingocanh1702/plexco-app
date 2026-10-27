"use client";

import { GENDER_VALUES } from "@plexco/core";
import { useRef, useState, type FormEvent } from "react";
import { useT } from "../../lib/i18n-client";
import {
  displayNameProblem,
  genderChanges,
  patchMyProfile,
  type DisplayNameProblem,
  type ProfileDto,
  type ProfileView,
} from "../../lib/me-settings-client";
import { DISPLAY_NAME_MAX } from "../../lib/session-form-model";
import { useCommandId } from "../../lib/use-command-id";
import { useOnlineStatus } from "../../lib/use-online-status";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { TextField } from "../ui/text-field";
import { FormFeedback } from "../settings/form-feedback";
import styles from "../settings/settings-layout.module.css";

type Gender = (typeof GENDER_VALUES)[number];
type ProfileFields = Omit<Parameters<typeof patchMyProfile>[1], "commandId">;

/**
 * Display name plus, while the DD-54 flag is on, the caller's own gender and pricing consent
 * (DD-39). One Save sends only the changed fields; with the flag off a stored gender or consent can
 * only be removed. One commandId per attempt; the result region takes focus after every outcome.
 */
export function SettingsProfileForm({
  initial,
  csrfToken,
  onSaved,
}: {
  initial: ProfileView;
  csrfToken: string;
  onSaved: (profile: ProfileDto) => void;
}) {
  const t = useT();
  const online = useOnlineStatus();
  const command = useCommandId();
  const formRef = useRef<HTMLFormElement>(null);
  const retry = useRef<() => void>(() => formRef.current?.requestSubmit());
  const stored = useRef<ProfileDto>(initial); // the diff baseline, current before the refresh lands
  const [value, setValue] = useState(initial.displayName ?? "");
  const [gender, setGender] = useState<Gender | "">(initial.gender ?? "");
  const [consent, setConsent] = useState(initial.genderConsent);
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

  const genderLabel: Record<Gender, string> = {
    male: t("Nam", "Male"),
    female: t("Nữ", "Female"),
    other: t("Khác", "Other"),
    undisclosed: t("Không tiết lộ", "Prefer not to say"),
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    retry.current = () => formRef.current?.requestSubmit();
    setSaved(false);
    setError(null);
    const fields: ProfileFields = initial.genderCollection
      ? genderChanges(stored.current, gender === "" ? null : gender, consent)
      : {};
    const displayName = value.trim();
    // The name goes out when it changed, or when nothing else did (the plain Save of before).
    if (displayName === (stored.current.displayName ?? "") && Object.keys(fields).length > 0) {
      setProblem(null);
      void save(fields);
      return;
    }
    const found = displayNameProblem(value);
    setProblem(found);
    if (found) {
      formRef.current?.querySelector("input")?.focus();
      return;
    }
    void save({ displayName, ...fields });
  }

  function remove() {
    retry.current = remove;
    setSaved(false);
    setError(null);
    void save({ gender: null, genderConsent: false });
  }

  async function save(fields: ProfileFields) {
    setBusy(true);
    try {
      // Bound to the sent JSON like the club forms (use-command-id.ts), although PATCH
      // /api/me/profile stores nothing under the key today (it is idempotent by value).
      const profile = await patchMyProfile(csrfToken, {
        ...fields,
        commandId: command.get(JSON.stringify(fields)),
      });
      command.settle();
      stored.current = profile;
      setValue(profile.displayName ?? "");
      setGender(profile.gender ?? "");
      setConsent(profile.genderConsent);
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
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      <TextField
        label={t("Tên hiển thị", "Display name")}
        hint={t("Tên bạn muốn câu lạc bộ nhìn thấy.", "The name you want clubs to see.")}
        value={value}
        error={problem ? problemText[problem] : null}
        autoComplete="name"
        maxLength={2 * DISPLAY_NAME_MAX}
        onChange={(e) => {
          setValue(e.target.value);
          setProblem(null);
          setSaved(false);
        }}
      />
      {initial.genderCollection ? (
        <>
          <Select
            label={t("Giới tính", "Gender")}
            value={gender}
            aria-describedby="me-gender-notice"
            options={[
              { value: "", label: t("Chưa đặt", "Not set") },
              ...GENDER_VALUES.map((v) => ({ value: v, label: genderLabel[v] })),
            ]}
            onChange={(e) => {
              setGender(e.target.value as Gender | "");
              if (e.target.value === "") setConsent(false);
              setSaved(false);
            }}
          />
          {/* Purpose notice at the point of collection, wired to the Select by aria-describedby.
              Copy pinned byte for byte in the L22 readiness file (docs/sessions): never reword. */}
          <p id="me-gender-notice" className={styles.caption}>
            {t(
              "Giới tính của bạn được dùng để tính giá khi CLB đặt giá theo giới tính cho một kèo.",
              "Your gender is used to work out the price when a club sets a price by gender for a session.",
            )}{" "}
            {t(
              "Việc đặt giới tính là tuỳ chọn; nếu để chưa đặt, bạn trả giá mặc định của kèo.",
              "Setting your gender is optional; if you leave it unset, you pay the default price of the session.",
            )}{" "}
            {t(
              "CLB chỉ được dùng giới tính của bạn để tính giá nếu bạn đánh dấu ô bên dưới.",
              "Clubs can use your gender for pricing only if you tick the box below.",
            )}
          </p>
          <label>
            <input
              type="checkbox"
              checked={consent}
              disabled={gender === ""}
              onChange={(e) => {
                setConsent(e.target.checked);
                setSaved(false);
              }}
            />{" "}
            {t(
              "Cho phép CLB sử dụng giới tính để tính giá",
              "Allow clubs to use my gender for pricing",
            )}
          </label>
          {consent ? null : (
            <p className={styles.caption}>{t("Không chia sẻ giới tính", "Gender not shared")}</p>
          )}
        </>
      ) : null}
      <FormFeedback
        focusKey={focusKey}
        error={error}
        message={saved ? t("Đã lưu hồ sơ.", "Profile saved.") : null}
        onRetry={() => retry.current()}
        onReload={() => window.location.reload()}
      />
      <div className={styles.actions}>
        <Button type="submit" disabled={busy || !online} aria-busy={busy ? true : undefined}>
          {busy ? t("Đang lưu…", "Saving…") : t("Lưu", "Save")}
        </Button>
        {!initial.genderCollection && (initial.gender !== null || initial.genderConsent) ? (
          <Button type="button" variant="secondary" disabled={busy || !online} onClick={remove}>
            {t("Xoá giới tính đã lưu", "Remove my saved gender")}
          </Button>
        ) : null}
      </div>
      {online ? null : (
        <p className={styles.caption}>
          {t("Bạn đang offline — kết nối lại để lưu.", "You are offline — reconnect to save.")}
        </p>
      )}
    </form>
  );
}
