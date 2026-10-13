"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { ApiClientError } from "../../lib/api-client";
import { useT } from "../../lib/i18n-client";
import { buildCreateBody, emptyFormValues } from "../../lib/session-form-model";
import { isDefiniteFailure } from "../../lib/session-error-ui";
import { createSession } from "../../lib/sessions-api";
import { useSports } from "../../lib/use-sessions-data";
import { useTenantContext } from "../../lib/use-tenant-context";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { ApiErrorNotice } from "./api-error-notice";
import { SessionForm } from "./session-form";

/** /sessions/new. One commandId per attempt, kept across an uncertain failure (DD-117 idempotency). */
export function NewSessionView({ tenantId }: { tenantId: string }) {
  const t = useT();
  const router = useRouter();
  const ctx = useTenantContext(tenantId);
  const sports = useSports();
  const commandId = useRef<string | null>(null);
  const back = `/c/${tenantId}/sessions`;

  return (
    <div>
      <h1>{t("Tạo buổi chơi mới", "New session")}</h1>
      {sports.state.status === "error" ? (
        <>
          <ApiErrorNotice error={sports.state.error} onRetry={sports.reload} />
          <Button href={back} variant="secondary">
            {t("Về danh sách", "Back to list")}
          </Button>
        </>
      ) : (
        <>
          {sports.state.status === "loading" ? <Skeleton width="12rem" /> : null}
          <SessionForm
            mode="create"
            initial={emptyFormValues()}
            timezone={ctx.timezone}
            sports={sports.state.status === "ready" ? sports.state.data : []}
            sportsLoading={sports.state.status === "loading"}
            submitLabel={t("Tạo bản nháp", "Create draft")}
            cancelHref={back}
            onSubmit={async (values) => {
              commandId.current ??= crypto.randomUUID();
              try {
                const created = await createSession(ctx, {
                  ...buildCreateBody(values, ctx.timezone),
                  commandId: commandId.current,
                });
                router.push(`${back}/${created.id}`);
              } catch (error) {
                if (isDefiniteFailure(error)) commandId.current = null; // not applied: next attempt is a new command
                if (error instanceof ApiClientError && error.code === "COMMAND_ID_CONFLICT") {
                  // The key was already used: the earlier attempt may have been saved.
                  throw new ApiClientError(
                    error.code,
                    t(
                      "Lần gửi trước có thể đã được lưu — kiểm tra danh sách",
                      "The earlier attempt may have gone through — check the list",
                    ),
                    error.statusCode,
                    error.requestId,
                  );
                }
                throw error;
              }
            }}
          />
        </>
      )}
    </div>
  );
}
