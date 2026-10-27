"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ApiClientError, apiFetch } from "../../lib/api-client";
import { useT } from "../../lib/i18n-client";
import {
  DEFAULT_TIMEZONE,
  SHORT_TIMEZONES,
  buildTimezoneOptions,
  onboardingErrorMessage,
  slugify,
  validateNewClub,
  type NewClubErrors,
} from "../../lib/new-club-form";
import { CLUB_NAME_MAX } from "../../lib/session-form-model";
import { useSession } from "../../lib/use-session";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { ErrorState } from "../ui/error-state";
import { InlineError } from "../ui/inline-error";
import { Select } from "../ui/select";
import { SkipLink } from "../ui/skip-link";
import { Spinner } from "../ui/spinner";
import { TextField } from "../ui/text-field";
import styles from "./new-club-form.module.css";

/** Create-club form (WAO-UC-2). Pre-tenant surface, so it renders in `vi` (DD-118 bucket b). */
export function NewClubForm() {
  const t = useT();
  const router = useRouter();
  const { state, session, refresh } = useSession();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [locale, setLocale] = useState<"vi" | "en">("vi");
  const [timezones, setTimezones] = useState(SHORT_TIMEZONES);
  const [errors, setErrors] = useState<NewClubErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // The full IANA list is browser-dependent, so it is read after mount (no hydration mismatch).
  useEffect(() => {
    const fn = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    if (fn) setTimezones(buildTimezoneOptions(fn("timeZone")));
  }, []);
  useEffect(() => {
    if (state.status === "signed-out") router.replace("/");
  }, [state.status, router]);

  // After a failed submit, move focus to the first invalid field so keyboard and screen-reader
  // users land on the problem (the error text is wired via aria-describedby).
  useEffect(() => {
    if (Object.keys(errors).length > 0) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [errors]);

  const timezoneOptions = useMemo(
    () => timezones.map((value) => ({ value, label: value.replace(/_/g, " ") })),
    [timezones],
  );

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting || !session) return;
    const values = { name, slug, timezone, locale };
    const found = validateNewClub(values, t);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;
    setSubmitting(true);
    try {
      const created = await apiFetch<{ tenantId: string }>("/api/onboarding/start", {
        method: "POST",
        csrfToken: session.csrfToken,
        json: { name: name.trim(), slug: slug.trim().toLowerCase(), timezone, locale },
      });
      router.push(`/c/${created.tenantId}`);
    } catch (error) {
      const code = error instanceof ApiClientError ? error.code : "CLIENT_UNKNOWN";
      const message = onboardingErrorMessage(code, t);
      if (message === null) router.replace("/");
      else if (code === "SLUG_TAKEN") setErrors({ slug: message });
      else setFormError(message);
      setSubmitting(false);
    }
  }

  if (state.status === "error") {
    return (
      <>
        <SkipLink />
        <main id="main-content" className={styles.page}>
          <ErrorState
            title={t("Không tải được trang", "Could not load this page")}
            body={t("Kiểm tra kết nối mạng rồi thử lại.", "Check your connection and try again.")}
            onRetry={() => void refresh()}
          />
        </main>
      </>
    );
  }
  if (state.status !== "ready") {
    return (
      <>
        <SkipLink />
        <main id="main-content" className={styles.page}>
          <Spinner />
        </main>
      </>
    );
  }

  return (
    <>
      <SkipLink />
      <main id="main-content" className={styles.page}>
        <div className={styles.head}>
          <h1>{t("Tạo câu lạc bộ", "Create your club")}</h1>
          <p className={styles.lead}>
            {t(
              "Chỉ mất một phút. Bạn có thể đổi các thông tin này sau.",
              "It takes a minute. You can change these details later.",
            )}
          </p>
        </div>
        <Card className={styles.card}>
          <form ref={formRef} className={styles.form} onSubmit={onSubmit} noValidate>
            {formError ? <InlineError>{formError}</InlineError> : null}
            <TextField
              label={t("Tên câu lạc bộ", "Club name")}
              name="name"
              value={name}
              maxLength={2 * CLUB_NAME_MAX}
              autoComplete="organization"
              required
              error={errors.name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugEdited) setSlug(slugify(e.target.value));
              }}
            />
            <TextField
              label={t("Đường dẫn câu lạc bộ", "Club address")}
              hint={t(
                "Dùng để nhận diện câu lạc bộ, ví dụ: cau-long-dong-da",
                "Used to identify your club, for example: dong-da-badminton",
              )}
              name="slug"
              value={slug}
              maxLength={63}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              error={errors.slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugEdited(true);
              }}
            />
            <Select
              label={t("Múi giờ", "Time zone")}
              name="timezone"
              value={timezone}
              options={timezoneOptions}
              onChange={(e) => setTimezone(e.target.value)}
            />
            <Select
              label={t("Ngôn ngữ của câu lạc bộ", "Club language")}
              name="locale"
              value={locale}
              options={[
                { value: "vi", label: t("Tiếng Việt", "Vietnamese") },
                { value: "en", label: t("Tiếng Anh", "English") },
              ]}
              onChange={(e) => setLocale(e.target.value === "en" ? "en" : "vi")}
            />
            <Button type="submit" block disabled={submitting}>
              {submitting ? t("Đang tạo…", "Creating…") : t("Tạo câu lạc bộ", "Create club")}
            </Button>
          </form>
        </Card>
      </main>
    </>
  );
}
