"use client";

import { useT } from "../../lib/i18n-client";
import { getMyRequests } from "../../lib/me-player-api";
import { ListView, PlayerScreen, statusLabel, useWhen, type ViewProps } from "./player-page";

const STATUS = new Map<string, [string, string]>([
  ["pending", ["Đang chờ duyệt", "Pending"]],
  ["approved", ["Đã duyệt", "Approved"]],
  ["rejected", ["Đã từ chối", "Rejected"]],
]);

/** S-8 (ME-4): the signed-in account's join requests. No Cancel control (O-2); ids are React keys only. */
export function MyRequestsView(props: ViewProps<Awaited<ReturnType<typeof getMyRequests>>>) {
  const t = useT();
  const when = useWhen();
  const stamp = (name: string, iso: string | null) => iso && `${name}: ${when.at(iso)}`;
  return (
    <ListView
      {...props}
      heading={t("Yêu cầu tham gia của tôi", "My join requests")}
      items={(d) => d.requests}
      empty={t("Bạn chưa gửi yêu cầu nào", "You have no join requests")}
      row={(r) => ({
        key: r.requestId,
        title: r.clubLabel,
        badge: statusLabel(STATUS, r.status, t),
        lines: [
          when.at(r.startsAt),
          r.area,
          stamp(t("Đã gửi", "Requested"), r.createdAt),
          stamp(t("Đã xử lý", "Decided"), r.decidedAt),
          r.status === "pending" && stamp(t("Hết hạn", "Expires"), r.expiresAt),
        ],
      })}
    />
  );
}

export const MyRequestsScreen = () => <PlayerScreen load={getMyRequests} View={MyRequestsView} />;
