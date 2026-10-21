"use client";

import { useT } from "../../lib/i18n-client";
import { getMySessions } from "../../lib/me-player-api";
import { sportLabel } from "../discover/listing-summary";
import {
  FindGame,
  ListView,
  PlayerScreen,
  statusLabel,
  useWhen,
  type ViewProps,
} from "./player-page";

const SEAT = new Map<string, [string, string]>([
  ["active", ["Đã có chỗ", "Confirmed"]],
  ["waitlisted", ["Danh sách chờ", "Waitlisted"]],
  ["pending", ["Chờ duyệt", "Pending approval"]],
]);

/** S-6 (ME-2): the signed-in account's seats. `sessionId` is a React key, never shown or linked. */
export function MySessionsView(props: ViewProps<Awaited<ReturnType<typeof getMySessions>>>) {
  const t = useT();
  const when = useWhen();
  return (
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
        };
      }}
    />
  );
}

export const MySessionsScreen = () => <PlayerScreen load={getMySessions} View={MySessionsView} />;
