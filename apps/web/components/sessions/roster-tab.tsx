"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useT } from "../../lib/i18n-client";
import { canEditRoster, canTakePayments, isPayable } from "../../lib/roster-rules";
import type { SessionApiContext, SessionDetailDto } from "../../lib/sessions-api";
import { useOnlineStatus } from "../../lib/use-online-status";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { Toast } from "../ui/toast";
import { MarkPaidSheet } from "./mark-paid-sheet";
import { RosterAddPlayerForm } from "./roster-add-player-form";
import { RosterCounts } from "./roster-counts";
import { RosterPlayerRow } from "./roster-player-row";
import { RosterRemoveDialog } from "./roster-remove-dialog";
import { RosterReverseDialog } from "./roster-reverse-dialog";
import styles from "./session-detail-view.module.css";
import rosterStyles from "./roster.module.css";

/**
 * Host roster: counts, add by name, remove, select-and-pay (mark-paid sheet), per-player ledger
 * with reversal. Gates mirror the server allowlists (lib/roster-rules.ts); offline disables writes.
 */
export function RosterTab({
  session,
  ctx,
  onChanged,
}: {
  session: SessionDetailDto;
  ctx: SessionApiContext;
  /** Refetch the detail (silently: the roster stays on screen). */
  onChanged: () => void;
}) {
  const t = useT();
  const uid = useId();
  const online = useOnlineStatus();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [reversing, setReversing] = useState<{
    allocationId: string;
    amount: number;
    name: string;
  } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // After a command the opener may be gone: focus moves to the heading once the dialog has closed.
  const [focusHeading, setFocusHeading] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusHeading > 0) heading.current?.focus();
  }, [focusHeading]);

  const editable = online && canEditRoster(session.status);
  const payable = online && canTakePayments(session.status);
  // Selection survives refetches but never keeps a player who is no longer payable.
  const selectedPlayers = session.players.filter((p) => picked.has(p.id) && isPayable(p));
  const finished = (message?: string) => {
    if (message) setDone(message);
    setFocusHeading((n) => n + 1);
    onChanged();
  };
  const name = (p: SessionDetailDto["players"][number]) =>
    p.displayName ?? t("(chưa đặt tên)", "(unnamed)");

  const editHint = `${uid}-edit`;
  const payHint = `${uid}-pay`;
  return (
    <div className={styles.roster}>
      <RosterCounts session={session} />

      <section aria-labelledby={`${uid}-players`}>
        <h2 id={`${uid}-players`} ref={heading} tabIndex={-1} className={styles.sectionTitle}>
          {t("Người chơi", "Players")}
        </h2>
        {!online ? (
          <p role="status" className={rosterStyles.hint}>
            {t(
              "Đang ngoại tuyến — chưa thể thêm, gỡ hay gạch nợ.",
              "You are offline — adding, removing and recording payments are unavailable.",
            )}
          </p>
        ) : null}
        <div className={rosterStyles.toolbar}>
          <RosterAddPlayerForm
            ctx={ctx}
            sessionId={session.id}
            disabled={!editable}
            describedBy={editHint}
            onAdded={finished}
            onReload={onChanged}
          />
          <Button
            disabled={!payable || selectedPlayers.length === 0}
            aria-describedby={payable ? undefined : payHint}
            onClick={() => setSheetOpen(true)}
          >
            {t(`Gạch nợ (${selectedPlayers.length})`, `Record payment (${selectedPlayers.length})`)}
          </Button>
        </div>
        {!canEditRoster(session.status) ? (
          <p id={editHint} className={rosterStyles.hint}>
            {t(
              "Chỉ thêm hoặc gỡ người chơi khi buổi đang mở.",
              "Players can only be added or removed while the session is open.",
            )}
          </p>
        ) : null}
        {!canTakePayments(session.status) ? (
          <p id={payHint} className={rosterStyles.hint}>
            {t(
              "Chỉ ghi nhận thanh toán khi buổi đang mở hoặc đã đóng.",
              "Payments can only be recorded while the session is open or closed.",
            )}
          </p>
        ) : null}
        {session.players.length === 0 ? (
          <EmptyState
            title={t("Chưa có người chơi", "No players yet")}
            body={t("Người chơi đã tham gia sẽ hiện ở đây.", "Players who join will show up here.")}
          />
        ) : (
          <ul className={styles.playerList}>
            {session.players.map((p) => (
              <RosterPlayerRow
                key={p.id}
                player={p}
                selectable={payable && isPayable(p)}
                selected={picked.has(p.id)}
                canRemove={editable}
                canReverse={payable}
                removeHint={editHint}
                onSelect={(on) =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (on) next.add(p.id);
                    else next.delete(p.id);
                    return next;
                  })
                }
                onRemove={() => setRemoving({ id: p.id, name: name(p) })}
                onReverse={(allocationId, amount) =>
                  setReversing({ allocationId, amount, name: name(p) })
                }
              />
            ))}
          </ul>
        )}
      </section>

      {session.guestNotes.length > 0 ? (
        <section aria-labelledby={`${uid}-guests`}>
          <h2 id={`${uid}-guests`} className={styles.sectionTitle}>
            {t("Ghi chú khách", "Guest notes")}
          </h2>
          <ul className={styles.playerList}>
            {session.guestNotes.map((g) => (
              <li key={g.id} className={styles.player}>
                <span className={styles.playerName}>{g.guestName}</span>
                {g.note ? <span className={styles.note}>{g.note}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <RosterRemoveDialog
        target={removing}
        ctx={ctx}
        sessionId={session.id}
        onClose={() => setRemoving(null)}
        onRemoved={(m) => {
          setRemoving(null);
          finished(m);
        }}
        onReload={() => {
          setRemoving(null);
          onChanged();
        }}
      />
      <RosterReverseDialog
        target={reversing}
        ctx={ctx}
        sessionId={session.id}
        onClose={() => setReversing(null)}
        onReversed={(m) => {
          setReversing(null);
          finished(m);
        }}
        onReload={() => {
          setReversing(null);
          onChanged();
        }}
      />
      <MarkPaidSheet
        open={sheetOpen}
        ctx={ctx}
        sessionId={session.id}
        players={selectedPlayers.map((p) => ({ id: p.id, name: name(p) }))}
        onReload={onChanged}
        onClose={(paid) => {
          setSheetOpen(false);
          if (paid) {
            setPicked(new Set());
            finished();
          }
        }}
      />
      {done ? <Toast message={done} onDismiss={() => setDone(null)} /> : null}
    </div>
  );
}
