import type { FormEventHandler } from "react";
import type { LinkUiState } from "../../lib/me-link-client";
import styles from "./link-code-form.module.css";

/**
 * Presentational half of /me/link (no hooks, so renderToStaticMarkup can show every state).
 * Language arrives as a prop and strings are inline `pick(vi, en)` pairs (HARD RULE 5): the shared
 * client i18n helper is not on this base, and a Node-only `t()` cannot run in the browser.
 */
export type UiLang = "vi" | "en";

interface Props {
  lang: UiLang;
  state: LinkUiState;
  code: string;
  onCodeChange: (next: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}

/** [prefix word, message] per state; the prefix keeps the status readable without colour. */
function statusText(state: LinkUiState, pick: (vi: string, en: string) => string) {
  const ok = pick("Thành công", "Success");
  const problem = pick("Lỗi", "Problem");
  switch (state) {
    case "linked":
      return [
        ok,
        pick(
          "Đã liên kết Zalo với tài khoản Plexco của bạn.",
          "Your Zalo is now linked to your Plexco account.",
        ),
      ];
    case "already_linked":
      return [
        ok,
        pick(
          "Zalo này đã được liên kết với tài khoản của bạn.",
          "This Zalo is already linked to your account.",
        ),
      ];
    case "requires_review":
      return [
        problem,
        pick(
          "Tài khoản Zalo này đã có hoạt động trong một CLB, nên cần bộ phận hỗ trợ gộp thủ công. Hãy liên hệ chủ CLB hoặc hỗ trợ Plexco.",
          "This Zalo account already has activity in a club, so support must merge it. Contact your club owner or Plexco support.",
        ),
      ];
    case "invalid":
      return [
        problem,
        pick(
          "Mã không đúng hoặc đã hết hạn. Gửi /link cho bot để lấy mã mới.",
          "That code is not valid or has expired. Send /link to the bot for a new one.",
        ),
      ];
    case "rate_limited":
      return [
        problem,
        pick(
          "Bạn đã thử quá nhiều lần. Hãy đợi vài phút rồi thử lại.",
          "Too many attempts. Wait a few minutes and try again.",
        ),
      ];
    case "unavailable":
      return [
        problem,
        pick(
          "Liên kết Zalo tạm thời không khả dụng. Hãy thử lại sau.",
          "Zalo linking is temporarily unavailable. Try again later.",
        ),
      ];
    case "offline":
      return [
        problem,
        pick(
          "Không có kết nối mạng. Hãy thử lại khi có mạng.",
          "You are offline. Try again when you are connected.",
        ),
      ];
    case "signed_out":
      return [
        problem,
        pick(
          "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.",
          "Your session has expired. Please sign in again.",
        ),
      ];
    case "error":
      return [problem, pick("Có lỗi xảy ra. Hãy thử lại.", "Something went wrong. Try again.")];
    default:
      return null;
  }
}

export function LinkCodeView({ lang, state, code, onCodeChange, onSubmit }: Props) {
  const pick = (vi: string, en: string) => (lang === "en" ? en : vi);
  const status = statusText(state, pick);
  const busy = state === "submitting";
  const failed = status !== null && state !== "linked" && state !== "already_linked";
  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <label className={styles.label} htmlFor="link-code">
        {pick("Mã liên kết", "Link code")}
      </label>
      <input
        id="link-code"
        className={styles.input}
        name="code"
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={40}
        placeholder="XXXX-XXXX-XXXXX"
        value={code}
        onChange={(e) => onCodeChange(e.target.value.toUpperCase())}
        aria-describedby="link-code-hint link-code-status"
        aria-invalid={failed || undefined}
        disabled={busy}
        required
      />
      <p id="link-code-hint" className={styles.hint}>
        {pick(
          "Định dạng XXXX-XXXX-XXXXX, có hoặc không có dấu gạch.",
          "Format XXXX-XXXX-XXXXX, with or without dashes.",
        )}
      </p>
      <button className={styles.button} type="submit" disabled={busy || code.trim().length === 0}>
        {busy ? pick("Đang liên kết…", "Linking…") : pick("Liên kết", "Link")}
      </button>
      <div id="link-code-status" className={styles.status} aria-live="polite">
        {status ? (
          <p data-state={state}>
            <strong>{status[0]}:</strong> {status[1]}
            {state === "signed_out" ? (
              <>
                {" "}
                <a href="/">{pick("Đăng nhập", "Sign in")}</a>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </form>
  );
}
