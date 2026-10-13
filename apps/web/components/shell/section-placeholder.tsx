"use client";

import { useT } from "../../lib/i18n-client";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";

/** Empty state for sections other milestones fill in (Sessions: M2, Settings: M4). */
export function SectionPlaceholder({
  tenantId,
  section,
}: {
  tenantId: string;
  section: "sessions" | "settings";
}) {
  const t = useT();
  const sessions = section === "sessions";
  return (
    <>
      <h1 className="sr-only">
        {sessions ? t("Buổi chơi", "Sessions") : t("Cài đặt", "Settings")}
      </h1>
      <EmptyState
        title={
          sessions
            ? t("Chưa có buổi chơi nào", "No sessions yet")
            : t("Cài đặt sẽ sớm có mặt", "Settings are coming soon")
        }
        body={
          sessions
            ? t("Các buổi chơi bạn tạo sẽ hiện ở đây.", "Sessions you create will show up here.")
            : t(
                "Bạn sẽ quản lý thông tin câu lạc bộ tại đây.",
                "You will manage your club's details here.",
              )
        }
        action={
          <Button href={`/c/${tenantId}`} variant="secondary">
            {t("Về trang chủ", "Back to home")}
          </Button>
        }
      />
    </>
  );
}
