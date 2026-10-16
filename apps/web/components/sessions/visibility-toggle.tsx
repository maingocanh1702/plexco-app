"use client";

import { useId, useRef, useState } from "react";
import { ApiClientError } from "../../lib/api-client";
import { useT } from "../../lib/i18n-client";
import { allowedActions, blockedReason } from "../../lib/session-actions";
import { isDefiniteFailure } from "../../lib/session-error-ui";
import type { SessionApiContext, SessionDetailDto } from "../../lib/sessions-api";
import { updateSession } from "../../lib/sessions-api";
import { useOnlineStatus } from "../../lib/use-online-status";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { InlineError } from "../ui/inline-error";
import { ApiErrorNotice } from "./api-error-notice";
import detailStyles from "./session-detail-view.module.css";
import styles from "./visibility-toggle.module.css";

export type DiscoveryGap = "area" | "slots";

/** The server's discovery predicate, in its order (a non-blank area after trim(), a finite
 *  slots_max): the UI may refuse sooner than the server, never accept what the server refuses. */
export function discoveryGaps(s: Pick<SessionDetailDto, "area" | "slotsMax">): DiscoveryGap[] {
  const gaps: DiscoveryGap[] = [];
  if (!(typeof s.area === "string" && s.area.trim().length > 0)) gaps.push("area");
  if (s.slotsMax == null) gaps.push("slots");
  return gaps;
}

/** Host public/private control on the existing PUT /api/sessions/[id]: shows the SERVED visibility
 *  (never optimistic), confirms both ways, one commandId per attempt (kept after an uncertain
 *  failure). A public flip with gaps sends nothing; unknown status or visibility shows nothing. */
export function VisibilityToggle(props: {
  session: SessionDetailDto;
  ctx: SessionApiContext;
  editHref: string;
  onDone: (message: string) => void; // toast text once the server accepted; the caller refetches
  onReload: () => void; // refetch (STALE_VERSION recovery)
}) {
  const { session, ctx, editHref, onDone, onReload } = props;
  const t = useT();
  const uid = useId();
  const online = useOnlineStatus();
  const [pending, setPending] = useState<"private" | "public" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refused, setRefused] = useState(false);
  const commandId = useRef<string | null>(null);
  const current = session.visibility;
  if (!allowedActions(session.status).includes("edit")) return null;
  if (current !== "private" && current !== "public") return null;

  const target = current === "public" ? "private" : "public";
  const copy = (to: "private" | "public") =>
    to === "public"
      ? {
          action: t("Chuyển sang Công khai", "Make public"),
          title: t("Công khai buổi này?", "Make this session public?"),
          body: t("Buổi sẽ chuyển sang Công khai.", "The session becomes Public."),
          done: t("Đã chuyển sang Công khai.", "The session is now public."),
        }
      : {
          action: t("Chuyển về Riêng tư", "Make private"),
          title: t("Chuyển buổi này về Riêng tư?", "Make this session private?"),
          body: t(
            "Buổi sẽ chuyển sang Riêng tư và không còn hiển thị công khai.",
            "The session becomes Private and is no longer shown publicly.",
          ),
          done: t("Đã chuyển về Riêng tư.", "The session is now private."),
        };
  const gaps = discoveryGaps(session);
  const gapText: Record<DiscoveryGap, string> = {
    area: t("Kèo công khai cần có khu vực.", "A public session needs an area."),
    slots: t(
      "Kèo công khai cần số chỗ giới hạn.",
      "A public session needs a finite number of slots.",
    ),
  };
  const showRefusal = refused && current === "private" && gaps.length > 0;
  const fixLink = (
    <Button variant="secondary" href={gaps.length > 0 ? `${editHref}#${gaps[0]}` : editHref}>
      {t("Bổ sung thông tin", "Add the missing details")}
    </Button>
  );
  // Each reason the button is disabled has its own hint, wired by aria-describedby.
  const hints = [
    blockedReason("edit", session, Date.now()) === "started" && {
      id: `${uid}-started`,
      text: t(
        "Buổi đã bắt đầu nên không đổi được chế độ hiển thị nữa.",
        "The session has started, so its visibility can no longer be changed.",
      ),
    },
    !online && {
      id: `${uid}-offline`,
      text: t(
        "Bạn đang offline — chưa thể đổi chế độ hiển thị.",
        "You are offline — visibility cannot be changed right now.",
      ),
    },
  ].filter((hint) => hint !== false);

  // A closed dialog never holds an error or a commandId: close() and a success reset both.
  function start() {
    const refuse = target === "public" && gaps.length > 0; // a refused flip sends nothing
    setRefused(refuse);
    if (!refuse) setPending(target);
  }
  function close() {
    setPending(null);
    setError(null);
    commandId.current = null;
  }
  async function confirm() {
    if (!pending || busy) return;
    commandId.current ??= crypto.randomUUID();
    setBusy(true);
    setError(null);
    try {
      const body = { commandId: commandId.current, expectedVersion: session.version };
      await updateSession(ctx, session.id, { ...body, visibility: pending });
      onDone(copy(pending).done);
      close();
    } catch (failure) {
      if (isDefiniteFailure(failure)) commandId.current = null;
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const dialog = pending ? copy(pending) : null;
  const missingFields =
    error instanceof ApiClientError && error.code === "MISSING_DISCOVERY_FIELDS";
  const state = current === "public" ? t("Công khai", "Public") : t("Riêng tư", "Private");
  return (
    <div className={styles.toggle}>
      <p>{`${t("Hiển thị", "Visibility")}: ${state}`}</p>
      <Button
        variant="secondary"
        disabled={hints.length > 0}
        aria-describedby={hints.map((hint) => hint.id).join(" ") || undefined}
        onClick={start}
      >
        {copy(target).action}
      </Button>
      {hints.map((hint) => (
        <p key={hint.id} id={hint.id} className={detailStyles.viewOnly}>
          {hint.text}
        </p>
      ))}
      {showRefusal ? (
        <InlineError>
          {t("Chưa thể công khai buổi này:", "This session cannot be made public yet:")}{" "}
          {gaps.map((gap) => gapText[gap]).join(" ")}
        </InlineError>
      ) : null}
      {showRefusal ? fixLink : null}
      <ConfirmDialog
        open={dialog !== null}
        title={dialog?.title ?? ""}
        body={dialog?.body ?? null}
        confirmLabel={dialog?.action ?? ""}
        busy={busy}
        error={
          error ? (
            <ApiErrorNotice
              error={error}
              onRetry={() => void confirm()}
              onReload={() => {
                close();
                onReload();
              }}
            >
              {missingFields ? fixLink : null}
            </ApiErrorNotice>
          ) : null
        }
        onConfirm={() => void confirm()}
        onCancel={close}
      />
    </div>
  );
}
