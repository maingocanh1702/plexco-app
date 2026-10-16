"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiClientError } from "../../lib/api-client";
import { useT } from "../../lib/i18n-client";
import { formatVndInput, parseVndInput } from "../../lib/money";
import {
  VENUE_ADDRESS_MAX,
  validateForm,
  type FormErrors,
  type SessionFormValues,
} from "../../lib/session-form-model";
import { describeSessionError, errorField } from "../../lib/session-error-ui";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { TextField } from "../ui/text-field";
import { ApiErrorNotice } from "./api-error-notice";
import styles from "./session-form.module.css";

interface SessionFormProps {
  mode: "create" | "edit";
  initial: SessionFormValues;
  /** Zone the datetime-local fields are interpreted in (club zone on create, the session's on edit). */
  timezone: string;
  sports: { id: string; name: string }[];
  sportsLoading?: boolean;
  /** Edit of an open session: explains which fields can still change. */
  openNotice?: boolean;
  submitLabel: string;
  cancelHref: string;
  /** Resolves on success (caller navigates); throws an ApiClientError to be shown. */
  onSubmit: (values: SessionFormValues) => Promise<void>;
  /** Refetch the loaded session (STALE_VERSION recovery); edit only. */
  onReload?: () => void;
}

const SERVER_FIELD_TO_FORM = {
  sportId: "sportId",
  startsAt: "startsAt",
  endsAt: "endsAt",
  area: "area",
  slotsMax: "slotsMax",
  priceAmount: "price",
} as const;

/**
 * Create/edit form. Four groups (Time / Place / Price & slots / Settings), client validation for
 * what the host can see, and server errors pinned to a field when the code is about one field
 * (always also shown in the summary, which receives focus so screen readers announce it).
 */
export function SessionForm(props: SessionFormProps) {
  const { mode, initial, timezone, sports, sportsLoading, submitLabel, cancelHref } = props;
  const t = useT();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const unlimitedId = useId();
  const [focusSummary, setFocusSummary] = useState(0);

  useEffect(() => {
    if (focusSummary > 0) summaryRef.current?.focus();
  }, [focusSummary]);

  // Mount only: the visibility toggle's refusal links here with #area or #slots; focus that field
  // (the slots input exists only while "unlimited" is off, else its checkbox takes the focus).
  useEffect(() => {
    const h = window.location.hash;
    const names = h === "#area" ? ["area"] : h === "#slots" ? ["slotsMax", "slotsUnlimited"] : [];
    const field = names.map((name) => formRef.current?.elements.namedItem(name)).find(Boolean);
    if (field instanceof HTMLElement) field.focus();
  }, []);

  const set = <K extends keyof SessionFormValues>(key: K, value: SessionFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setServerError(null);
    const found = validateForm(values, timezone, t, initial);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setFocusSummary((n) => n + 1);
      return;
    }
    setBusy(true);
    try {
      await props.onSubmit(values);
    } catch (error) {
      const view = describeSessionError(error, t);
      const field = errorField(view.code);
      if (field) setErrors({ [SERVER_FIELD_TO_FORM[field]]: view.message });
      setServerError(
        error instanceof ApiClientError ? error : new ApiClientError("CLIENT_UNKNOWN", "", 0),
      );
      setFocusSummary((n) => n + 1);
      setBusy(false);
    }
  }

  const errorList = Object.values(errors);
  const sportOptions = [
    ...(mode === "create" ? [{ value: "", label: t("— Chọn môn —", "— Choose a sport —") }] : []),
    ...sports.map((s) => ({ value: s.id, label: s.name })),
  ];

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      className={styles.form}
      aria-busy={busy ? true : undefined}
    >
      <div ref={summaryRef} tabIndex={-1} className={styles.summary}>
        {serverError ? (
          <ApiErrorNotice
            error={serverError}
            onReload={props.onReload}
            onRetry={() => formRef.current?.requestSubmit()}
          />
        ) : null}
        {errorList.length > 0 && !serverError ? (
          <div role="alert" className={styles.errors}>
            <p>{t("Kiểm tra lại các mục sau:", "Please check these items:")}</p>
            <ul>
              {errorList.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {props.openNotice ? (
        <p className={styles.notice}>
          {t(
            "Buổi đang mở: bạn đổi được giờ, địa điểm, sức chứa (không thấp hơn số người đã tham gia) và cài đặt. Đổi giá chỉ được khi chưa có khoản thu nào.",
            "This session is open: you can change time, place, capacity (not below the current roster) and settings. The price can only change while there are no charges.",
          )}
        </p>
      ) : null}

      <fieldset className={styles.group}>
        <legend>{t("Thời gian", "Time")}</legend>
        <Select
          label={t("Môn thể thao", "Sport")}
          options={sportOptions}
          value={values.sportId}
          disabled={mode === "edit" || sportsLoading}
          error={errors.sportId}
          onChange={(e) => set("sportId", e.target.value)}
        />
        <TextField
          label={t("Bắt đầu", "Starts")}
          type="datetime-local"
          value={values.startsAt}
          error={errors.startsAt}
          required
          onChange={(e) => set("startsAt", e.target.value)}
        />
        <TextField
          label={t("Kết thúc", "Ends")}
          type="datetime-local"
          value={values.endsAt}
          error={errors.endsAt}
          required
          hint={t(`Múi giờ: ${timezone}`, `Time zone: ${timezone}`)}
          onChange={(e) => set("endsAt", e.target.value)}
        />
      </fieldset>

      <fieldset className={styles.group}>
        <legend>{t("Địa điểm", "Place")}</legend>
        <TextField
          label={t("Tên sân / địa điểm", "Venue name")}
          value={values.venueName}
          error={errors.venueName}
          maxLength={200}
          onChange={(e) => set("venueName", e.target.value)}
        />
        <TextField
          label={t("Địa chỉ", "Address")}
          value={values.venueAddress}
          error={errors.venueAddress}
          maxLength={VENUE_ADDRESS_MAX}
          hint={t(`Tối đa ${VENUE_ADDRESS_MAX} ký tự`, `Up to ${VENUE_ADDRESS_MAX} characters`)}
          onChange={(e) => set("venueAddress", e.target.value)}
        />
        <TextField
          label={t("Khu vực", "Area")}
          name="area"
          value={values.area}
          error={errors.area}
          maxLength={120}
          hint={t("Cần khi công khai buổi chơi.", "Required to make a session public.")}
          onChange={(e) => set("area", e.target.value)}
        />
      </fieldset>

      <fieldset className={styles.group}>
        <legend>{t("Giá & Chỗ", "Price & slots")}</legend>
        <TextField
          label={t("Giá mỗi người (VND)", "Price per player (VND)")}
          inputMode="numeric"
          className={styles.numeric}
          value={values.price}
          error={errors.price}
          onChange={(e) => {
            const parsed = parseVndInput(e.target.value);
            set(
              "price",
              parsed === null ? "" : Number.isNaN(parsed) ? e.target.value : formatVndInput(parsed),
            );
          }}
        />
        <div className={styles.check}>
          <input
            id={unlimitedId}
            name="slotsUnlimited"
            type="checkbox"
            checked={values.slotsUnlimited}
            onChange={(e) => set("slotsUnlimited", e.target.checked)}
          />
          <label htmlFor={unlimitedId}>{t("Không giới hạn số chỗ", "Unlimited slots")}</label>
        </div>
        {values.slotsUnlimited ? null : (
          <TextField
            label={t("Số chỗ tối đa", "Maximum slots")}
            name="slotsMax"
            inputMode="numeric"
            className={styles.numeric}
            value={values.slotsMax}
            error={errors.slotsMax}
            onChange={(e) => set("slotsMax", e.target.value.replace(/[^\d]/g, ""))}
          />
        )}
        {values.slotsUnlimited && errors.slotsMax ? (
          <p className={styles.fieldError}>{errors.slotsMax}</p>
        ) : null}
      </fieldset>

      <fieldset className={styles.group}>
        <legend>{t("Cài đặt", "Settings")}</legend>
        <Select
          label={t("Hiển thị", "Visibility")}
          options={[
            {
              value: "private",
              label: t("Riêng tư (chỉ người được mời)", "Private (invited only)"),
            },
            { value: "public", label: t("Công khai", "Public") },
          ]}
          value={values.visibility}
          onChange={(e) => set("visibility", e.target.value as SessionFormValues["visibility"])}
        />
        <Select
          label={t("Cách tham gia", "Join policy")}
          options={[
            { value: "open", label: t("Tự do tham gia", "Open to join") },
            { value: "approval", label: t("Cần duyệt", "Needs approval") },
          ]}
          value={values.joinPolicy}
          onChange={(e) => set("joinPolicy", e.target.value as SessionFormValues["joinPolicy"])}
        />
      </fieldset>

      <div className={styles.actions}>
        <Button variant="secondary" href={cancelHref}>
          {t("Huỷ", "Cancel")}
        </Button>
        <Button type="submit" disabled={busy} aria-busy={busy ? true : undefined}>
          {busy ? t("Đang lưu…", "Saving…") : submitLabel}
        </Button>
      </div>
    </form>
  );
}
