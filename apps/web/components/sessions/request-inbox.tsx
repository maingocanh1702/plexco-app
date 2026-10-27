"use client";

import type { PendingJoinRequestDto } from "@plexco/core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiFetch, CLIENT_NETWORK_ERROR } from "../../lib/api-client";
import { badResponse, rec, required, rows, str } from "../../lib/discover-api";
import { useT, type TFn } from "../../lib/i18n-client";
import { displayNameOf } from "../../lib/roster-rules";
import { describePlayerError } from "../../lib/session-error-ui";
import { tenantQuery, type SessionApiContext, type SessionDetailDto } from "../../lib/sessions-api";
import { useCommandId } from "../../lib/use-command-id";
import { useOnlineStatus } from "../../lib/use-online-status";
import { useLoadable, type Loadable } from "../../lib/use-sessions-data";
import { useWhen } from "../player/player-page";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { Skeleton } from "../ui/skeleton";
import { ApiErrorNotice } from "./api-error-notice";
import styles from "./request-inbox.module.css";

type Action = "approve" | "reject";

/** What R8 / R9 answer for the decided request; only the keys the result line reads (H-1). */
export interface DecisionResult {
  status: string;
  outcome?: string | null;
  waitlistPosition?: number | null;
}

export type RowPhase =
  | { kind: "idle" }
  | { kind: "pending"; action: Action }
  | { kind: "done" }
  | { kind: "failed"; action: Action; error: unknown };

const TIMEOUT_MS = 15_000;

/** The loadable's abort signal joined to the time limit (F-2); AbortSignal.any needs Safari 17.4, .timeout 16. */
function withTimeout(signal: AbortSignal, ms: number): AbortSignal {
  const merged = new AbortController();
  for (const source of [signal, AbortSignal.timeout(ms)]) {
    if (source.aborted) merged.abort();
    else source.addEventListener("abort", () => merged.abort(), { once: true });
  }
  return merged.signal;
}

/** The R7 body rebuilt to the keys the inbox shows (H-1); any other shape is CLIENT_BAD_RESPONSE, never a crash (F-3). */
export function parsePending(body: unknown): { requests: PendingJoinRequestDto[] } {
  const requests = rows(rec(body)?.requests, (value) => {
    const item = rec(value);
    const keys = required(item, ["requestId", "createdAt"]);
    if (!item || !keys) throw badResponse();
    return { ...keys, displayName: str(item.displayName) };
  });
  return { requests };
}

/** The R7 read: bounded by the time limit and parsed, not cast (F-2, F-3). */
export const fetchPending = (path: string, signal: AbortSignal, ms = TIMEOUT_MS) =>
  apiFetch<unknown>(path, { signal: withTimeout(signal, ms) }).then(parsePending);

/** The line comes from the decision response only; an unknown outcome claims nothing. */
function resultLine(result: DecisionResult, t: TFn): string {
  if (result.status === "rejected") return t("Đã từ chối yêu cầu.", "Request rejected.");
  if (result.outcome === "active") {
    return t("Đã duyệt: có chỗ trong buổi.", "Approved: seat confirmed.");
  }
  if (result.outcome === "waitlisted") {
    const position =
      typeof result.waitlistPosition === "number" ? ` #${result.waitlistPosition}` : "";
    return `${t("Đã duyệt: vào danh sách chờ", "Approved: on the waitlist")}${position}`;
  }
  return t("Đã xử lý yêu cầu.", "Request handled.");
}

/** One pending request: name and time only (H-1) with Approve / Reject; the phase is a prop. */
export function RequestRowView({
  request,
  phase,
  online,
  onDecide,
  onReload,
}: {
  request: PendingJoinRequestDto;
  phase: RowPhase;
  online: boolean;
  onDecide: (action: Action) => void;
  onReload: () => void;
}) {
  const t = useT();
  const when = useWhen();
  const locked = !online || phase.kind === "pending" || phase.kind === "done";
  const busy = (action: Action) =>
    (phase.kind === "pending" && phase.action === action) || undefined;
  return (
    <li className={styles.row}>
      <div className={styles.who}>
        <strong>{displayNameOf(request.displayName, t)}</strong>
        <time dateTime={request.createdAt} className={styles.when}>
          {t("Yêu cầu lúc", "Requested")} {when.at(request.createdAt)}
        </time>
      </div>
      <div className={styles.actions}>
        <Button onClick={() => onDecide("approve")} disabled={locked} aria-busy={busy("approve")}>
          {busy("approve") ? t("Đang duyệt…", "Approving…") : t("Duyệt", "Approve")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => onDecide("reject")}
          disabled={locked}
          aria-busy={busy("reject")}
        >
          {busy("reject") ? t("Đang từ chối…", "Rejecting…") : t("Từ chối", "Reject")}
        </Button>
      </div>
      {phase.kind === "failed" ? (
        <ApiErrorNotice
          error={phase.error}
          describe={describePlayerError}
          onRetry={() => onDecide(phase.action)}
          onReload={onReload}
        />
      ) : null}
    </li>
  );
}

/** The list states; the rows come from `renderRow`, so a view test needs no network. */
export function RequestInboxView({
  state,
  online,
  result,
  onReload,
  renderRow,
}: {
  state: Loadable<{ requests: PendingJoinRequestDto[] }>;
  online: boolean;
  result: DecisionResult | null;
  onReload: () => void;
  renderRow: (request: PendingJoinRequestDto) => ReactNode;
}) {
  const t = useT();
  // F-5: the decided row leaves the list and takes keyboard focus with it, so the outcome line takes it.
  const resultRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    resultRef.current?.focus();
  }, [result]);
  const offline =
    !online || (state.status === "error" && state.error.code === CLIENT_NETWORK_ERROR);
  const empty = state.status === "ready" && state.data.requests.length === 0;
  const kind = offline ? "offline" : empty ? "empty" : state.status;
  return (
    <section className={styles.inbox} data-state={kind} aria-busy={kind === "loading" || undefined}>
      {result ? (
        <p ref={resultRef} tabIndex={-1} role="status" className={styles.result}>
          {resultLine(result, t)}
        </p>
      ) : null}
      {offline ? (
        <div role="status" className={styles.notice}>
          <p>
            {t(
              "Bạn đang offline. Kết nối lại để xem và duyệt yêu cầu.",
              "You are offline. Reconnect to review join requests.",
            )}
          </p>
          <Button variant="secondary" onClick={onReload}>
            {t("Thử lại", "Try again")}
          </Button>
        </div>
      ) : null}
      {kind === "loading" ? (
        <div className={styles.list}>
          <Skeleton height="var(--space-12)" />
          <Skeleton height="var(--space-12)" />
        </div>
      ) : null}
      {state.status === "error" && !offline ? (
        <ApiErrorNotice
          error={state.error}
          describe={describePlayerError}
          onRetry={onReload}
          onReload={onReload}
        />
      ) : null}
      {empty ? (
        <EmptyState
          title={t("Chưa có yêu cầu nào đang chờ", "No pending requests")}
          body={t("Yêu cầu tham gia mới sẽ hiện ở đây.", "New join requests will show up here.")}
        />
      ) : null}
      {state.status === "ready" && !empty ? (
        <ul className={styles.list}>{state.data.requests.map(renderRow)}</ul>
      ) : null}
    </section>
  );
}

/** Owns one row's command id (P-11: one keeper per row) and sends R8 / R9 for it. */
function RequestRow({
  request,
  ctx,
  online,
  onDecided,
  onReload,
}: {
  request: PendingJoinRequestDto;
  ctx: SessionApiContext;
  online: boolean;
  onDecided: (result: DecisionResult) => void;
  onReload: () => void;
}) {
  const keeper = useCommandId();
  const inFlight = useRef(false);
  const [phase, setPhase] = useState<RowPhase>({ kind: "idle" });

  async function decide(action: Action) {
    if (inFlight.current || !online) return;
    inFlight.current = true;
    setPhase({ kind: "pending", action });
    try {
      const path = `/api/join-requests/${encodeURIComponent(request.requestId)}/${action}`;
      const data = await apiFetch<{ request: DecisionResult }>(
        `${path}?${tenantQuery(ctx.tenantId)}`,
        {
          method: "POST",
          json: { commandId: keeper.get(action) },
          csrfToken: ctx.csrfToken,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      keeper.settle();
      setPhase({ kind: "done" });
      onDecided(data.request);
    } catch (error) {
      keeper.settle(error);
      setPhase({ kind: "failed", action, error });
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <RequestRowView
      request={request}
      phase={phase}
      online={online}
      onDecide={(action) => void decide(action)}
      onReload={() => {
        keeper.reset(); // a reload abandons the attempt: the next one is a new command (E-14)
        setPhase({ kind: "idle" });
        onReload();
      }}
    />
  );
}

/** S-10, the host's third session tab (RC-0b): pending join requests (R7) to approve or reject. */
export function RequestInbox({
  session,
  ctx,
  onChanged,
}: {
  session: SessionDetailDto;
  ctx: SessionApiContext;
  /** Refetch the host detail so the roster shows the new seat (P-12). */
  onChanged: () => void;
}) {
  const online = useOnlineStatus();
  const [result, setResult] = useState<DecisionResult | null>(null);
  const { state, reload, refresh } = useLoadable(
    (signal) =>
      fetchPending(
        `/api/sessions/${encodeURIComponent(session.id)}/join-requests?${tenantQuery(ctx.tenantId)}`,
        signal,
      ),
    [session.id, ctx.tenantId],
  );
  // The roster refetches with the list: a decision that errored may still have committed (F-1).
  const refreshAll = () => {
    refresh();
    onChanged();
  };
  return (
    <RequestInboxView
      state={state}
      online={online}
      result={result}
      onReload={reload}
      renderRow={(request) => (
        <RequestRow
          key={request.requestId}
          request={request}
          ctx={ctx}
          online={online}
          onDecided={(decided) => {
            setResult(decided);
            refreshAll(); // the decided row leaves the pending list (F-6)
          }}
          onReload={refreshAll}
        />
      )}
    />
  );
}
