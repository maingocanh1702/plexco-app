"use client";

import { useRef, useState, type FormEvent } from "react";
import { useLang, useT } from "../../lib/i18n-client";
import { submitLinkCode, type LinkUiState } from "../../lib/me-link-client";
import { LinkCodeView } from "./link-code-view";

/**
 * Stateful half of /me/link: the page heading, the intro and the code form. One crypto.randomUUID()
 * per attempt: kept across an UNCERTAIN failure (network / 5xx -> same commandId on retry), dropped
 * on any definite answer. Language comes from the /me chrome's LangProvider (MeFrame), the one
 * source for chrome and body alike, so the page can never mix two languages (DD-118: no
 * Accept-Language).
 */
export function LinkCodeForm() {
  const t = useT();
  const lang = useLang();
  const [code, setCode] = useState("");
  const [state, setState] = useState<LinkUiState>("idle");
  const commandId = useRef<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "submitting" || code.trim().length === 0) return;
    commandId.current ??= crypto.randomUUID();
    setState("submitting");
    const result = await submitLinkCode({ code: code.trim(), commandId: commandId.current });
    if (!result.keepCommandId) commandId.current = null;
    setState(result.state);
  }

  return (
    <>
      <h1>{t("Liên kết Zalo", "Link your Zalo")}</h1>
      <p>
        {t(
          "Gửi /link cho bot Zalo của CLB để nhận mã dùng một lần, rồi nhập mã vào đây.",
          "Send /link to your club's Zalo bot to get a one-time code, then enter it here.",
        )}
      </p>
      <LinkCodeView
        lang={lang}
        state={state}
        code={code}
        onCodeChange={(next) => {
          setCode(next);
          // An edited code is a different command: a kept id from an uncertain attempt must not survive.
          if (state !== "submitting") {
            commandId.current = null;
            setState("idle");
          }
        }}
        onSubmit={onSubmit}
      />
    </>
  );
}
