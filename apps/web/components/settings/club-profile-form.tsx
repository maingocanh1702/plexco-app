"use client";

import { useRef, useState, type FormEvent } from "react";
import { patchClubConfig, type ClubConfigDto } from "../../lib/club-settings-client";
import {
  buildProfilePatch,
  clubNameProblem,
  profileValues,
  publicAliasProblem,
  timezoneOptions,
  unsureAfter,
  type ClubPatchField,
  type ProfileFormValues,
} from "../../lib/club-settings-model";
import { useT, type TFn } from "../../lib/i18n-client";
import { isDefiniteFailure } from "../../lib/session-error-ui";
import { CLUB_NAME_MAX } from "../../lib/session-form-model";
import { useCommandId } from "../../lib/use-command-id";
import { useOnlineStatus } from "../../lib/use-online-status";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { TextField } from "../ui/text-field";
import { FormFeedback } from "./form-feedback";
import styles from "./settings-layout.module.css";

/**
 * Club name / timezone / language (tenants.locale, DD-118: the ONLY language source). The name check
 * mirrors the route's own count (UTF-16 units, club-config-validation.ts), so a name the route would
 * refuse is pinned to the field instead of coming back as a generic INVALID_BODY.
 */
function ProfileForm({
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
  // Fields an uncertain failure may have saved, against the `club` it was read from: see `unsure`
  // in club-settings-model.ts. A new `club` (any reload) is the server's truth and ends it.
  const unsure = useRef<{ club: ClubConfigDto; fields: Set<ClubPatchField> } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const problem = clubNameProblem(values.name);
    if (problem) {
      setNameError(
        problem === "empty"
          ? t("Nhập tên câu lạc bộ.", "Enter the club name.")
          : problem === "too_long"
            ? t(
                "Tên tối đa 120 ký tự (một số biểu tượng cảm xúc được tính là 2 ký tự).",
                "The name is at most 120 characters (some emoji count as 2).",
              )
            : t(
                "Tên không được chứa ký tự điều khiển hoặc ký tự ẩn.",
                "The name cannot contain control or hidden characters.",
              ),
      );
      formRef.current?.querySelector("input")?.focus();
      return;
    }
    setNameError(null);
    const pending = unsure.current?.club === club ? unsure.current.fields : undefined;
    const patch = buildProfilePatch(club, values, pending);
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
      unsure.current = null;
      setMessage(t("Đã lưu thông tin câu lạc bộ.", "Club details saved."));
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
      <TextField
        label={t("Tên câu lạc bộ", "Club name")}
        value={values.name}
        error={nameError}
        maxLength={2 * CLUB_NAME_MAX}
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

/** The club profile: ProfileForm, then, as its own form and command, the moderated public name. */
export function ClubProfileForm(props: Parameters<typeof ProfileForm>[0]) {
  return (
    <>
      <ProfileForm {...props} />
      <PublicAliasForm {...props} />
    </>
  );
}

export type PublicAliasStep =
  | { kind: "problem"; message: string }
  | { kind: "unchanged"; message: string }
  | { kind: "send"; publicAlias: string };

/**
 * What submitting the public name does (pure, so the forms test pins it without a DOM): a problem
 * for the field, "unchanged" (the trimmed text equals the stored alias, whatever its status: the
 * server would no-op it, so nothing is sent), or the text to send ALONE. `unsure` = an uncertain
 * failure may have stored another text since `club` was read, so the stored alias proves nothing.
 */
export function publicAliasStep(
  club: ClubConfigDto,
  raw: string,
  unsure: boolean,
  t: TFn,
): PublicAliasStep {
  const problem = publicAliasProblem(raw);
  if (problem) {
    const message =
      problem === "empty"
        ? t("Nhập tên công khai.", "Enter a public name.")
        : problem === "too_long"
          ? t("Tên công khai tối đa 60 ký tự.", "The public name can have at most 60 characters.")
          : t(
              "Tên công khai có ký tự không được phép.",
              "The public name contains characters that are not allowed.",
            );
    return { kind: "problem", message };
  }
  const publicAlias = raw.trim();
  if (!unsure && publicAlias === club.publicAlias) {
    return {
      kind: "unchanged",
      message: t("Tên công khai không thay đổi.", "The public name has not changed."),
    };
  }
  return { kind: "send", publicAlias };
}

/** The status line; no alias, or a status this client does not know, never claims to be public. */
function aliasStatusNote(status: string | null | undefined, t: TFn): string {
  switch (status) {
    case "pending":
      return t(
        "Đang chờ duyệt — CLB chưa hiện công khai.",
        "Waiting for approval — the club is not shown publicly yet.",
      );
    case "approved":
      return t(
        "Đã duyệt — tên này được phép hiện công khai.",
        "Approved — this name may be shown publicly.",
      );
    case "rejected":
      return t(
        "Bị từ chối — đổi tên để gửi duyệt lại.",
        "Rejected — change the name to request approval again.",
      );
    default:
      return t(
        "Chưa có tên công khai — CLB chưa hiện công khai.",
        "No public name yet — the club is not shown publicly.",
      );
  }
}

/**
 * The club's public name (tenants.public_alias, 0060): its own field, submit and commandId, sent as
 * { publicAlias, commandId }. Every set waits for the platform owner's approval; until one is
 * approved nothing of the club is public, and tenants.name never is.
 */
function PublicAliasForm({
  tenantId,
  csrfToken,
  club,
  onSaved,
}: {
  tenantId: string;
  csrfToken: string;
  club: ClubConfigDto;
  onSaved: () => void;
}) {
  const t = useT();
  const online = useOnlineStatus();
  const command = useCommandId();
  const formRef = useRef<HTMLFormElement>(null);
  const [text, setText] = useState(() => club.publicAlias ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusKey, setFocusKey] = useState(0);
  // The `club` an uncertain failure was read from (see ProfileForm's `unsure`); a reload ends it.
  const unsureOf = useRef<ClubConfigDto | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const step = publicAliasStep(club, text, unsureOf.current === club, t);
    setFieldError(step.kind === "problem" ? step.message : null);
    if (step.kind === "problem") {
      formRef.current?.querySelector("input")?.focus();
      return;
    }
    if (step.kind === "unchanged") {
      setMessage(step.message);
      setFocusKey((n) => n + 1);
      return;
    }
    setBusy(true);
    try {
      const body = { publicAlias: step.publicAlias };
      // Bound to this exact text, as above: an identical retry replays, an edit is a new command.
      const commandId = command.get(JSON.stringify(body));
      await patchClubConfig({ tenantId, csrfToken }, { ...body, commandId });
      command.settle();
      unsureOf.current = null;
      setMessage(t("Đã gửi tên công khai để duyệt.", "Public name sent for approval."));
      onSaved();
    } catch (failure) {
      command.settle(failure);
      if (!isDefiniteFailure(failure)) unsureOf.current = club;
      setError(failure);
    } finally {
      setBusy(false);
      setFocusKey((n) => n + 1);
    }
  }

  return (
    <form ref={formRef} className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
      <TextField
        label={t("Tên công khai của CLB", "Club public name")}
        hint={t(
          "Hiện trên trang công khai sau khi được duyệt. Tối đa 60 ký tự.",
          "Shown on public pages after approval. Up to 60 characters.",
        )}
        value={text}
        error={fieldError}
        maxLength={200}
        onChange={(e) => {
          setText(e.target.value);
          setFieldError(null);
        }}
      />
      <p className={styles.caption}>{aliasStatusNote(club.publicAliasStatus, t)}</p>
      {club.publicAliasStatus === "approved" ? (
        <p className={styles.caption}>
          {t(
            "Đổi tên đã duyệt sẽ đưa CLB về chờ duyệt.",
            "Changing an approved name sends it back for approval.",
          )}
        </p>
      ) : null}
      <FormFeedback
        focusKey={focusKey}
        error={error}
        message={message}
        onRetry={() => formRef.current?.requestSubmit()}
        onReload={onSaved}
      />
      <div className={styles.actions}>
        <Button type="submit" disabled={busy || !online} aria-busy={busy ? true : undefined}>
          {busy ? t("Đang gửi…", "Submitting…") : t("Gửi duyệt", "Submit for approval")}
        </Button>
      </div>
    </form>
  );
}
