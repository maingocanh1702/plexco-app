"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "../../lib/i18n-client";
import { getMySessions, type MySession } from "../../lib/me-player-api";
import { sportLabel } from "../discover/listing-summary";
import { startChatContextLoad } from "./member-chat-gate";
import { PlayerLeaveSessionButton } from "./player-leave-session-button";
import {
  FindGame,
  ListView,
  PlayerScreen,
  statusLabel,
  useWhen,
  type ViewProps,
} from "./player-page";
import discover from "../discover/discover.module.css";

const SEAT = new Map<string, [string, string]>([
  ["active", ["Đã có chỗ", "Confirmed"]],
  ["waitlisted", ["Danh sách chờ", "Waitlisted"]],
  ["pending", ["Chờ duyệt", "Pending approval"]],
]);

type Data = Awaited<ReturnType<typeof getMySessions>>;
type ListProps = ViewProps<Data> & {
  tenants: ReadonlyMap<string, string>;
  left: boolean;
  onLeft: () => void;
};

/** Only a confirmed or waitlisted seat can be left; a pending request has no seat yet. */
const leavable = (s: MySession) => s.myStatus === "active" || s.myStatus === "waitlisted";

/** S-6 (ME-2): the signed-in account's seats. `sessionId` is a React key, never shown or linked. */
export function MySessionsList({ tenants, left, onLeft, ...props }: ListProps) {
  const t = useT();
  const when = useWhen();
  const list = (
    <ListView
      {...props}
      heading={t("Buổi chơi của tôi", "My sessions")}
      items={(d) => d.sessions}
      empty={t("Bạn chưa có buổi chơi nào", "You have no sessions yet")}
      action={<FindGame />}
      row={(s) => {
        const seat = statusLabel(SEAT, s.myStatus, t);
        const place =
          s.myStatus === "waitlisted" && s.waitlistPosition !== null
            ? ` #${s.waitlistPosition}`
            : "";
        const tenantId = leavable(s) ? tenants.get(s.clubRef) : undefined;
        // DD-139: the venue is drawn as the server sent it, in full; null draws nothing. The /me
        // definer decides who sees it (the host's "hide exact address" option), not this view.
        return {
          key: s.sessionId,
          title: sportLabel(s.sportKey, t),
          badge: seat && seat + place,
          lines: [
            s.clubLabel,
            when.range(s.startsAt, s.endsAt, s.timezone),
            s.area,
            s.venueName,
            s.venueAddress,
          ],
          action: tenantId ? (
            <PlayerLeaveSessionButton
              sessionId={s.sessionId}
              tenantId={tenantId}
              onLeft={onLeft}
              onReload={props.onRetry}
            />
          ) : null,
        };
      }}
    />
  );
  return (
    <>
      {left && (
        // Drawn above the list's own <main> frame, which the reload empties; it takes the page's box.
        <p role="status" className={discover.page}>
          {t("Bạn đã rời buổi này.", "You left this session.")}
        </p>
      )}
      {list}
    </>
  );
}

/** Reads each seat club's tenant once per page load; the view stays mounted across a reload. */
export function MySessionsView(props: ViewProps<Data>) {
  const { state } = props;
  const [tenants, setTenants] = useState(() => new Map<string, string>());
  const [left, setLeft] = useState(false);
  const reads = useRef(new Map<string, () => void>());

  // One read per club per page load, never retried: denied, failed or rate-limited = no control.
  useEffect(() => {
    if (state.status !== "ready") return;
    for (const { clubRef } of state.data.sessions.filter(leavable)) {
      if (reads.current.has(clubRef)) continue;
      const stop = startChatContextLoad(clubRef, (gate) => {
        if (gate.status === "ready") setTenants((m) => new Map(m).set(clubRef, gate.tenantId));
      });
      reads.current.set(clubRef, stop);
    }
  }, [state]);
  // Unmount stops every read and forgets it, so a strict-mode remount reads again.
  useEffect(() => {
    const started = reads.current;
    return () => {
      started.forEach((stop) => stop());
      started.clear();
    };
  }, []);

  const onLeft = () => {
    setLeft(true);
    props.onRetry();
  };
  return <MySessionsList {...props} tenants={tenants} left={left} onLeft={onLeft} />;
}

export const MySessionsScreen = () => <PlayerScreen load={getMySessions} View={MySessionsView} />;
