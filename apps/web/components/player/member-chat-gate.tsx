"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ApiClientError, apiFetch } from "../../lib/api-client";
import { useT } from "../../lib/i18n-client";
import { TenantZoneContext } from "../../lib/use-tenant-context";
import { ChannelList } from "../chat/channel-list";
import channels from "../chat/channel-list.module.css";
import { ChannelView } from "../chat/channel-view";
import discover from "../discover/discover.module.css";
import { Button } from "../ui/button";

/**
 * A member's way into a club's chat: ONE read of the chat-context route per mount, then the L16
 * components. The route is a convenience, never a grant: the chat API's live-membership gate stays
 * the only authorization. The tenant id and zone live only in component state (no storage, URL, log
 * or cache), and the server's message is never shown: the client renders its own copy.
 */
export type GateState =
  | { status: "loading" }
  | { status: "ready"; tenantId: string; timezone: string }
  | { status: "denied" }
  | { status: "error"; signIn: boolean };

const TIMEOUT_MS = 15_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOADING: GateState = { status: "loading" };
const DENIED: GateState = { status: "denied" };
const ERROR: GateState = { status: "error", signIn: false };
const SIGN_IN: GateState = { status: "error", signIn: true };

// The route answers exactly {tenantId, timezone}; any other 200 body is a failed load (fail closed).
function contextOf(data: unknown): GateState {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return ERROR;
  const { tenantId, timezone, ...extra } = data as Record<string, unknown>;
  if (typeof tenantId !== "string" || !UUID_RE.test(tenantId)) return ERROR;
  if (typeof timezone !== "string" || timezone === "" || Object.keys(extra).length > 0)
    return ERROR;
  return { status: "ready", tenantId, timezone };
}

// 404 is the route's one deny and any other 4xx denies too, except the session (401) and the rate
// limit (429), which are not a verdict on the membership. Everything else is a failed load.
function failureOf(e: unknown): GateState {
  const status = e instanceof ApiClientError ? e.statusCode : 0;
  if (status === 401) return SIGN_IN;
  return status >= 400 && status < 500 && status !== 429 ? DENIED : ERROR;
}

/**
 * One GET of the context route with a 15 s timeout; `onState` gets the one result. The returned
 * stop (unmount, Retry or another club) aborts the read and silences it.
 */
export function startChatContextLoad(clubRef: string, onState: (state: GateState) => void) {
  let live = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  apiFetch<unknown>(`/api/me/clubs/${encodeURIComponent(clubRef)}/chat-context`, {
    signal: controller.signal,
  })
    .then(contextOf, failureOf)
    .then((state) => live && onState(state))
    .finally(() => clearTimeout(timer));
  return () => {
    live = false;
    clearTimeout(timer);
    controller.abort();
  };
}

interface GateProps {
  clubRef: string;
  channelId?: string;
}

/** Every state, rendered inside the one <main> (MeFrame gives none). A pure function of the state. */
export function MemberChatGateView({
  state,
  clubRef,
  channelId,
  onRetry,
}: GateProps & { state: GateState; onRetry: () => void }) {
  const t = useT();
  let body: ReactNode;
  if (state.status === "ready") {
    const { tenantId, timezone } = state;
    const basePath = `/me/clubs/${encodeURIComponent(clubRef)}/chat`;
    body = (
      <TenantZoneContext.Provider value={timezone}>
        {channelId ? (
          <ChannelView tenantId={tenantId} channelId={channelId} basePath={basePath} />
        ) : (
          <ChannelList tenantId={tenantId} basePath={basePath} />
        )}
      </TenantZoneContext.Provider>
    );
  } else {
    body = (
      <div>
        <h1 className={channels.heading}>{t("Trò chuyện", "Chat")}</h1>
        {state.status === "loading" ? <p role="status">{t("Đang tải…", "Loading…")}</p> : null}
        {state.status === "denied" ? (
          <div className={channels.notice}>
            {t("Bạn không mở được trò chuyện của CLB này.", "You cannot open this club's chat.")}
          </div>
        ) : null}
        {state.status === "error" ? (
          <div className={channels.notice} role="alert">
            {t("Không tải được trò chuyện.", "Could not load the chat.")}
            <Button variant="secondary" onClick={onRetry}>
              {t("Thử lại", "Retry")}
            </Button>
            {state.signIn ? (
              <Button href="/" variant="secondary">
                {t("Đăng nhập lại", "Sign in again")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <main className={discover.page} data-state={state.status}>
      {body}
    </main>
  );
}

export function MemberChatGate({ clubRef, channelId }: GateProps) {
  // The result carries its club, so a result never outlives the club it was read for.
  const [loaded, setLoaded] = useState<{ clubRef: string; state: GateState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(
    () => startChatContextLoad(clubRef, (state) => setLoaded({ clubRef, state })),
    [clubRef, attempt],
  );
  const state = loaded?.clubRef === clubRef ? loaded.state : LOADING;
  const onRetry = () => {
    setLoaded(null);
    setAttempt((n) => n + 1);
  };
  return (
    <MemberChatGateView state={state} clubRef={clubRef} channelId={channelId} onRetry={onRetry} />
  );
}
