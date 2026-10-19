"use client";

import { useT } from "../../lib/i18n-client";
import { getMyCharges, type MyCharges, type SelfPaymentStatus } from "../../lib/me-player-api";
import { formatVnd } from "../../lib/money";
import discover from "../discover/discover.module.css";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { EmptyState } from "../ui/empty-state";
import { PlayerPage, PlayerScreen, statusLabel, useWhen, type ViewProps } from "./player-page";
import styles from "./player.module.css";

const ITEM = new Map<string, [string, string]>([
  ["open", ["Chưa thanh toán", "Unpaid"]],
  ["partial", ["Đã trả một phần", "Partly paid"]],
]);
const whole = (...amounts: number[]) => amounts.every((n) => Number.isSafeInteger(n));

/** P-7: the fail-closed amount state. No total, no partial sum, never 0; Retry only when it can help. */
function Unavailable({ retryable, onRetry }: { retryable: boolean; onRetry: () => void }) {
  const t = useT();
  return (
    <div role="alert" className={discover.offline}>
      {t(
        "Chưa hiển thị được số tiền. Thử lại sau.",
        "The amount can't be shown right now. Try again later.",
      )}
      {retryable ? (
        <Button variant="secondary" onClick={onRetry}>
          {t("Thử lại", "Try again")}
        </Button>
      ) : null}
    </div>
  );
}

/** One club's own charges; items render only here, under their club. Anything not whole fails closed. */
function ClubCharges({ status, onRetry }: { status: SelfPaymentStatus; onRetry: () => void }) {
  const t = useT();
  const when = useWhen();
  if (status.kind === "known_zero") {
    return (
      <p className={styles.note}>
        {t("Không có khoản nào cần thanh toán.", "Nothing to pay here.")}
      </p>
    );
  }
  const items = status.kind === "known_amount" ? status.items : [];
  const amounts = items.flatMap((i) => [i.amountDue, i.amountAllocated, i.remaining]);
  if (status.kind !== "known_amount" || !whole(status.totalOutstanding, ...amounts)) {
    return (
      <Unavailable retryable={status.kind === "unknown" && status.retryable} onRetry={onRetry} />
    );
  }
  return (
    <>
      <p className={styles.total}>{formatVnd(status.totalOutstanding)}</p>
      <ul className={discover.list}>
        {items.map((item) => {
          const badge = statusLabel(ITEM, item.status, t);
          const rows: [string, number][] = [
            [t("Phải trả", "Due"), item.amountDue],
            [t("Đã trả", "Paid so far"), item.amountAllocated],
            [t("Còn lại", "Remaining"), item.remaining],
          ];
          return (
            <li key={item.sessionRef}>
              <Card className={discover.card}>
                <p className={discover.meta}>{when.at(item.startsAt)}</p>
                {badge ? <Badge>{badge}</Badge> : null}
                <dl className={styles.amounts}>
                  {rows.map(([name, amount]) => (
                    <div key={name}>
                      <dt>{name}</dt>
                      <dd>{formatVnd(amount)}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** S-7 (ME-3): the signed-in player's own charges. No pay CTA, QR or bank data; ids are React keys only. */
export function MyChargesView({ state, onRetry }: ViewProps<MyCharges>) {
  const t = useT();
  const when = useWhen();
  const asOf = (iso: string) => `${t("Cập nhật lúc", "As of")} ${when.at(iso)}`;
  return (
    <PlayerPage
      heading={t("Khoản phải trả của tôi", "My charges")}
      state={state}
      onRetry={onRetry}
      show={({ summary, clubs }) => {
        if (summary.kind === "known_zero") {
          const title = t("Bạn không còn khoản nào cần thanh toán", "You have nothing to pay");
          return { state: "empty", body: <EmptyState title={title} body={asOf(summary.asOf)} /> };
        }
        if (summary.kind !== "known_amount" || !whole(summary.totalOutstanding)) {
          const retryable = summary.kind === "unknown" && summary.retryable;
          return { state: "error", body: <Unavailable retryable={retryable} onRetry={onRetry} /> };
        }
        return {
          state: "ready",
          body: (
            <>
              <Card className={discover.card}>
                <p className={styles.note}>{t("Tổng còn phải trả", "Total outstanding")}</p>
                <p className={styles.total}>{formatVnd(summary.totalOutstanding)}</p>
                <p className={styles.note}>{asOf(summary.asOf)}</p>
              </Card>
              {clubs.map((club) => (
                <section key={club.clubRef} className={styles.section}>
                  <h2 className={discover.title}>{club.clubLabel}</h2>
                  <ClubCharges status={club.status} onRetry={onRetry} />
                </section>
              ))}
            </>
          ),
        };
      }}
    />
  );
}

export const MyChargesScreen = () => <PlayerScreen load={getMyCharges} View={MyChargesView} />;
