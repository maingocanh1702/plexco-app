"use client";

import { useT } from "../../lib/i18n-client";
import { isKnownStatus } from "../../lib/session-actions";
import { Badge, type BadgeTone } from "../ui/badge";

const TONE: Record<string, BadgeTone> = {
  draft: "warning",
  open: "success",
  closed: "neutral",
  cancelled: "error",
};

/** draft / open / closed / cancelled. An unknown status renders as neutral with its raw text, never hidden. */
export function SessionStatusBadge({ status }: { status: string }) {
  const t = useT();
  const labels: Record<string, string> = {
    draft: t("Nháp", "Draft"),
    open: t("Đang mở", "Open"),
    closed: t("Đã đóng", "Closed"),
    cancelled: t("Đã huỷ", "Cancelled"),
  };
  return (
    <Badge tone={isKnownStatus(status) ? TONE[status] : "neutral"}>
      {labels[status] ?? status}
    </Badge>
  );
}
