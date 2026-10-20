"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useLang, useT } from "../../lib/i18n-client";
import { describePlayerError } from "../../lib/session-error-ui";
import { formatSessionRange, formatTimestamp } from "../../lib/session-time";
import { useOnlineStatus } from "../../lib/use-online-status";
import discover from "../discover/discover.module.css";
import { OfflineNotice, isOffline } from "../discover/discover-frame";
import { ListingSkeleton } from "../discover/listing-summary";
import { ApiErrorNotice } from "../sessions/api-error-notice";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { EmptyState } from "../ui/empty-state";
import styles from "./player.module.css";

/** The one state of every player page (P-19); each view is a pure function of it. */
export type PlayerState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: unknown }
  | { status: "offline" };

export interface ViewProps<T> {
  state: PlayerState<T>;
  onRetry: () => void;
}

/** A ready page: its data-state ("error" only for a fail-closed amount) and its body. */
export interface Shown {
  state: "ready" | "empty" | "error";
  body: ReactNode;
}

/** Loads on mount, refetches on Retry; a failure while offline is the offline state, nothing is cached (P-16). */
function usePlayerData<T>(load: () => Promise<T>): [PlayerState<T>, () => void] {
  const online = useOnlineStatus();
  const [state, setState] = useState<PlayerState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true; // a slower, older read never overwrites a newer one
    load().then(
      (data) => current && setState({ status: "ready", data }),
      (error: unknown) => current && setState({ status: "error", error }),
    );
    return () => {
      current = false;
    };
  }, [load, attempt]);
  const retry = () => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  };
  const shown: PlayerState<T> =
    state.status === "error" && isOffline(state.error, online) ? { status: "offline" } : state;
  return [shown, retry];
}

/** The client container of a player page: it loads, the view renders. */
export function PlayerScreen<T>({
  load,
  View,
}: {
  load: () => Promise<T>;
  View: ComponentType<ViewProps<T>>;
}) {
  const [state, retry] = usePlayerData(load);
  return <View state={state} onRetry={retry} />;
}

/** The shell of a player page: heading, then the one state that applies. */
export function PlayerPage<T>({
  heading,
  state,
  onRetry,
  show,
}: ViewProps<T> & { heading: string; show: (data: T) => Shown }) {
  const t = useT();
  const frame = (dataState: string, body: ReactNode) => (
    <main className={discover.page} data-state={dataState}>
      <h1 className={discover.heading}>{heading}</h1>
      {body}
    </main>
  );
  if (state.status === "loading") {
    const skeletons = [0, 1, 2].map((i) => <ListingSkeleton key={i} />);
    return frame(
      "loading",
      <div className={discover.list} aria-busy="true">
        {skeletons}
      </div>,
    );
  }
  if (state.status === "error") {
    const notice = (
      <ApiErrorNotice
        error={state.error}
        describe={describePlayerError}
        onRetry={onRetry}
        onReload={onRetry}
      />
    );
    return frame("error", notice);
  }
  if (state.status === "offline") {
    const message = t(
      "Bạn đang offline. Chưa tải được trang này.",
      "You are offline. This page could not be loaded.",
    );
    return frame("offline", <OfflineNotice message={message} onRetry={onRetry} />);
  }
  const shown = show(state.data);
  return frame(shown.state, shown.body);
}

/** One card of a list page. `key` is a React key and is never rendered; false and null lines are skipped. */
interface Row {
  key: string;
  title: string;
  badge: string | null;
  lines: (string | false | null)[];
  /** An optional control under the lines (a link); a row without one renders exactly the elements it did before. */
  action?: ReactNode;
}

/** Clubs, sessions and requests: the empty state, the card list and the capped-list note, once. */
export function ListView<D extends { truncated: boolean }, T>({
  heading,
  state,
  onRetry,
  items,
  empty,
  action,
  row,
}: ViewProps<D> & {
  heading: string;
  items: (data: D) => T[];
  empty: string;
  action?: ReactNode;
  row: (item: T) => Row;
}) {
  const t = useT();
  const card = (r: Row) => (
    <li key={r.key}>
      <Card className={discover.card}>
        <h2 className={discover.title}>{r.title}</h2>
        {r.badge ? <Badge>{r.badge}</Badge> : null}
        {r.lines.map((line, i) =>
          line ? (
            <p key={i} className={discover.meta}>
              {line}
            </p>
          ) : null,
        )}
        {r.action}
      </Card>
    </li>
  );
  const show = (data: D): Shown => {
    const list = items(data);
    if (list.length === 0) {
      return { state: "empty", body: <EmptyState title={empty} action={action} /> };
    }
    const note = t("Chưa hiển thị hết các mục.", "Not all items are shown.");
    return {
      state: "ready",
      body: (
        <>
          <ul className={discover.list}>{list.map((item) => card(row(item)))}</ul>
          {data.truncated ? <p className={styles.note}>{note}</p> : null}
        </>
      ),
    };
  };
  return <PlayerPage heading={heading} state={state} onRetry={onRetry} show={show} />;
}

/** The empty-state action of my clubs and my sessions. */
export function FindGame() {
  const t = useT();
  return (
    <Button href="/discover" variant="secondary">
      {t("Tìm kèo chơi", "Find a game")}
    </Button>
  );
}

/** A status code as its t(vi, en) label; a code outside the table shows no badge (nothing invented). */
export function statusLabel(
  table: ReadonlyMap<string, readonly [string, string]>,
  code: string | null,
  t: (vi: string, en: string) => string,
) {
  const pair = table.get(code ?? "");
  return pair ? t(...pair) : null;
}

const DASH = "—"; // a time that cannot be parsed shows as a dash: no "Invalid Date", no thrown RangeError
const viewerZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** P-4: a session range in its own zone, any other instant in the viewer's zone. No zone is hardcoded. */
export function useWhen() {
  const lang = useLang();
  const valid = (...iso: string[]) => iso.every((s) => !Number.isNaN(Date.parse(s)));
  return {
    at: (iso: string) => (valid(iso) ? formatTimestamp(iso, viewerZone(), lang) : DASH),
    range: (from: string, to: string, tz: string) =>
      valid(from, to) ? formatSessionRange(from, to, tz, lang) : DASH,
  };
}
