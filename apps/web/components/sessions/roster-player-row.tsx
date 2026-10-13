"use client";

import { useId } from "react";
import { useLang, useT } from "../../lib/i18n-client";
import { formatVnd } from "../../lib/money";
import { displayNameOf } from "../../lib/roster-rules";
import type { RosterPlayerDto } from "../../lib/sessions-api";
import { Badge, type BadgeTone } from "../ui/badge";
import { Button } from "../ui/button";
import { RosterLedgerDetails } from "./roster-ledger-details";
import styles from "./session-detail-view.module.css";
import rosterStyles from "./roster.module.css";

/** One roster row: select-for-payment, name + status, ledger summary, remove, expandable ledger. */
export function RosterPlayerRow({
  player,
  selectable,
  selected,
  canRemove,
  canReverse,
  timeZone,
  removeHint,
  reverseHint,
  onSelect,
  onRemove,
  onReverse,
}: {
  player: RosterPlayerDto;
  selectable: boolean;
  selected: boolean;
  canRemove: boolean;
  canReverse: boolean;
  /** The session's IANA zone: ledger instants are shown in it, like the rest of the page. */
  timeZone: string;
  /** id of the paragraph explaining why remove is disabled */
  removeHint?: string;
  /** id of the paragraph explaining why reverse is disabled */
  reverseHint?: string;
  onSelect: (checked: boolean) => void;
  onRemove: () => void;
  onReverse: (allocationId: string, amount: number) => void;
}) {
  const t = useT();
  const lang = useLang();
  const checkId = useId();
  const name = displayNameOf(player.displayName, t);
  const { charge } = player;

  const status = ((): [BadgeTone, string] => {
    if (player.status === "active") return ["success", t("Đang tham gia", "Active")];
    if (player.status === "waitlisted") {
      return [
        "warning",
        player.waitlistPosition
          ? t(`Chờ #${player.waitlistPosition}`, `Waitlist #${player.waitlistPosition}`)
          : t("Danh sách chờ", "Waitlisted"),
      ];
    }
    if (player.status === "left") return ["neutral", t("Đã rời", "Left")];
    return ["neutral", player.status];
  })();
  const chargeBadge = (s: string): [BadgeTone, string] => {
    if (s === "paid") return ["success", t("Đã thanh toán", "Paid")];
    if (s === "partial") return ["warning", t("Trả một phần", "Partly paid")];
    if (s === "open") return ["error", t("Chưa thanh toán", "Unpaid")];
    if (s === "void") return ["neutral", t("Không thu", "Not charged")];
    return ["neutral", s];
  };

  return (
    <li className={styles.player}>
      <div className={rosterStyles.rowMain}>
        {selectable ? (
          <input
            id={checkId}
            type="checkbox"
            className={rosterStyles.check}
            checked={selected}
            onChange={(e) => onSelect(e.target.checked)}
            aria-label={t(`Chọn ${name} để gạch nợ`, `Select ${name} for payment`)}
          />
        ) : null}
        <span className={styles.playerName}>{name}</span>
        <Badge tone={status[0]}>{status[1]}</Badge>
        {charge ? (
          <span className={styles.charge}>
            <span className={styles.money}>
              {charge.status === "void"
                ? formatVnd(charge.amountDue, lang)
                : t(
                    `Còn ${formatVnd(charge.remaining, lang)} / ${formatVnd(charge.amountDue, lang)}`,
                    `${formatVnd(charge.remaining, lang)} left of ${formatVnd(charge.amountDue, lang)}`,
                  )}
            </span>
            <Badge tone={chargeBadge(charge.status)[0]}>{chargeBadge(charge.status)[1]}</Badge>
          </span>
        ) : (
          <span className={styles.charge} aria-label={t("Chưa có khoản thu", "No charge")}>
            —
          </span>
        )}
        {player.status === "active" || player.status === "waitlisted" ? (
          <span className={rosterStyles.rowActions}>
            <Button
              variant="secondary"
              disabled={!canRemove}
              aria-describedby={canRemove ? undefined : removeHint}
              aria-label={t(`Gỡ ${name}`, `Remove ${name}`)}
              onClick={onRemove}
            >
              {t("Gỡ", "Remove")}
            </Button>
          </span>
        ) : null}
      </div>
      {charge && charge.allocations.length > 0 ? (
        <RosterLedgerDetails
          charge={charge}
          name={name}
          canReverse={canReverse}
          timeZone={timeZone}
          reverseHint={reverseHint}
          onReverse={onReverse}
        />
      ) : null}
    </li>
  );
}
