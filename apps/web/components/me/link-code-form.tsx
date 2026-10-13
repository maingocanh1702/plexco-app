"use client";

import { useRef, useState, type FormEvent } from "react";
import { submitLinkCode, type LinkUiState } from "../../lib/me-link-client";
import { LinkCodeView, type UiLang } from "./link-code-view";

/**
 * Stateful half of /me/link. One crypto.randomUUID() per attempt: kept across an UNCERTAIN failure
 * (network / 5xx -> same commandId on retry), dropped on any definite answer.
 */
export function LinkCodeForm({ lang }: { lang: UiLang }) {
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
    <LinkCodeView
      lang={lang}
      state={state}
      code={code}
      onCodeChange={(next) => {
        setCode(next);
        if (state !== "submitting") setState("idle");
      }}
      onSubmit={onSubmit}
    />
  );
}
