"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { useT } from "../../lib/i18n-client";
import { blockedReason } from "../../lib/session-actions";
import { isDefiniteFailure } from "../../lib/session-error-ui";
import { resolveTimeZone } from "../../lib/session-time";
import { buildUpdateBody, valuesFromSession } from "../../lib/session-form-model";
import { updateSession } from "../../lib/sessions-api";
import { useSessionDetail } from "../../lib/use-sessions-data";
import { useTenantContext } from "../../lib/use-tenant-context";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { Skeleton } from "../ui/skeleton";
import { ApiErrorNotice } from "./api-error-notice";
import { SessionForm } from "./session-form";

/** /sessions/[id]/edit: prefilled form; PUT sends only changed fields + expectedVersion. */
export function EditSessionView({ tenantId, sessionId }: { tenantId: string; sessionId: string }) {
  const t = useT();
  const router = useRouter();
  const ctx = useTenantContext(tenantId);
  const { state, reload } = useSessionDetail(tenantId, sessionId);
  const commandId = useRef<string | null>(null);
  const detail = `/c/${tenantId}/sessions/${sessionId}`;

  if (state.status === "loading") {
    return (
      <div aria-busy="true">
        <h1 className="sr-only">{t("Sửa buổi chơi", "Edit session")}</h1>
        <Skeleton width="60%" height="var(--space-8)" />
        <Skeleton height="var(--space-12)" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div>
        <h1>{t("Sửa buổi chơi", "Edit session")}</h1>
        <ApiErrorNotice error={state.error} onRetry={reload} onReload={reload} />
      </div>
    );
  }

  const session = state.data;
  const blocked =
    session.status !== "draft" && session.status !== "open"
      ? "terminal"
      : blockedReason("edit", session, Date.now());
  if (blocked) {
    return (
      <EmptyState
        title={t("Không thể sửa buổi này", "This session cannot be edited")}
        body={
          blocked === "started"
            ? t(
                "Buổi đang mở đã bắt đầu nên không sửa được nữa.",
                "An open session that has already started can no longer be edited.",
              )
            : t(
                "Buổi đã đóng hoặc đã huỷ chỉ để xem.",
                "Closed or cancelled sessions are view-only.",
              )
        }
        action={<Button href={detail}>{t("Về chi tiết", "Back to details")}</Button>}
      />
    );
  }

  return (
    <div>
      <h1>{t("Sửa buổi chơi", "Edit session")}</h1>
      <SessionForm
        // A reload after STALE_VERSION re-keys the form so it re-prefills from the fresh version.
        key={`${session.id}:${session.version}`}
        mode="edit"
        initial={valuesFromSession(session)}
        timezone={resolveTimeZone(session.timezone)}
        sports={[{ id: session.sportId, name: session.sportName }]}
        openNotice={session.status === "open"}
        submitLabel={t("Lưu thay đổi", "Save changes")}
        cancelHref={detail}
        onReload={reload}
        onSubmit={async (values) => {
          const body = buildUpdateBody(values, session);
          if (body === null) {
            router.push(detail); // nothing changed: no command, no version bump
            return;
          }
          commandId.current ??= crypto.randomUUID();
          try {
            await updateSession(ctx, session.id, {
              ...body,
              commandId: commandId.current,
              expectedVersion: session.version,
            });
            router.push(detail);
          } catch (error) {
            if (isDefiniteFailure(error)) commandId.current = null;
            throw error;
          }
        }}
      />
    </div>
  );
}
