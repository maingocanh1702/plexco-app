"use client";

import { useT } from "../../lib/i18n-client";
import { getMyClubs } from "../../lib/me-player-api";
import { FindGame, ListView, PlayerScreen, statusLabel, type ViewProps } from "./player-page";

const MEMBER = new Map<string, [string, string]>([
  ["active", ["Thành viên", "Member"]],
  ["guest", ["Khách", "Guest"]],
]);

/** S-5 (ME-1): the signed-in account's clubs. `clubRef` is the slug: a React key, never shown. */
export function MyClubsView(props: ViewProps<Awaited<ReturnType<typeof getMyClubs>>>) {
  const t = useT();
  return (
    <ListView
      {...props}
      heading={t("CLB của tôi", "My clubs")}
      items={(d) => d.clubs}
      empty={t("Bạn chưa tham gia CLB nào", "You are not in any club yet")}
      action={<FindGame />}
      row={(c) => ({
        key: c.clubRef,
        title: c.clubLabel,
        badge: statusLabel(MEMBER, c.membershipStatus, t),
        lines: [],
      })}
    />
  );
}

export const MyClubsScreen = () => <PlayerScreen load={getMyClubs} View={MyClubsView} />;
