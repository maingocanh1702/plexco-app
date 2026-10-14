"use client";

import { useEffect, useRef, useState } from "react";
import { useLang, useT } from "../../lib/i18n-client";
import {
  detachMyChannel,
  platformLabel,
  type LinkedChannelDto,
} from "../../lib/me-settings-client";
import { useOnlineStatus } from "../../lib/use-online-status";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { EmptyState } from "../ui/empty-state";
import { FormFeedback } from "../settings/form-feedback";
import { describeSettingsError } from "../../lib/settings-error-ui";
import { ApiErrorNotice } from "../sessions/api-error-notice";
import styles from "../settings/settings-layout.module.css";

/**
 * Linked channels with UNLINK. Unlink moves the channel off this account: the bot then treats that
 * channel account as a new stranger (no name, no clubs), while the account's clubs, charges and
 * history stay. The confirm dialog says so. Detach is naturally idempotent server-side, so there is
 * no commandId: a repeat answers CHANNEL_NOT_LINKED and the list simply reloads. An INACTIVE row is
 * listed but has no unlink action (the unlink rule moves active channels only; 0055 header).
 *
 * Focus: the native dialog returns focus to its opener when it closes, and after an unlink (or a
 * 409 whose reload dropped the row) that opener is a removed row, which would leave focus on
 * <body>. So the outcome region (FormFeedback, whose live region is always mounted and announces
 * the text) takes focus once the dialog has closed.
 */
export function SettingsChannelsList({
  channels,
  csrfToken,
  onChanged,
}: {
  channels: LinkedChannelDto[];
  csrfToken: string;
  /** Refetch the list while keeping it on screen. */
  onChanged: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const online = useOnlineStatus();
  const [target, setTarget] = useState<LinkedChannelDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const focusOutcome = useRef(false);

  // Runs after the commit that closed the dialog (ConfirmDialog's own close effect, a child effect,
  // has already returned focus to the opener), so this focus is the one that sticks.
  useEffect(() => {
    if (target === null && focusOutcome.current) {
      focusOutcome.current = false;
      setFocusKey((n) => n + 1);
    }
  }, [target]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "vi-VN");

  async function confirm() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await detachMyChannel(csrfToken, target.id);
      setDone(
        t(
          `Đã gỡ liên kết ${platformLabel(target.platform)}.`,
          `${platformLabel(target.platform)} unlinked.`,
        ),
      );
      focusOutcome.current = true;
      setTarget(null);
      onChanged();
    } catch (failure) {
      setError(failure);
      // The row may already be gone (409): reload the list behind the dialog.
      if (describeSettingsError(failure, t).action === "reload") onChanged();
    } finally {
      setBusy(false);
    }
  }

  const platform = platformLabel(target?.platform ?? "zalo");
  return (
    <>
      <FormFeedback focusKey={focusKey} message={done} />
      {channels.length === 0 ? (
        <EmptyState
          title={t("Chưa liên kết kênh nào", "No linked channels")}
          body={t(
            "Liên kết Zalo để các buổi chơi và khoản nợ của bạn hiện cùng một tài khoản.",
            "Link Zalo so your sessions and balances show under one account.",
          )}
          action={
            <Button href="/me/link" variant="secondary">
              {t("Liên kết Zalo", "Link Zalo")}
            </Button>
          }
        />
      ) : (
        <ul className={styles.list}>
          {channels.map((channel) => (
            <li key={channel.id} className={styles.item}>
              <div className={styles.itemMain}>
                <div className={styles.badges}>
                  <Badge tone="info">{platformLabel(channel.platform)}</Badge>
                  <Badge tone={channel.status === "active" ? "success" : "neutral"}>
                    {channel.status === "active"
                      ? t("Đang liên kết", "Linked")
                      : t("Tạm ngưng", "Inactive")}
                  </Badge>
                </div>
                {/* channel_identities.created_at: when Plexco first saw this channel account, not
                    when it was linked to this account (no link time is stored). */}
                <span className={styles.caption}>
                  {t("Ghi nhận từ ngày", "Known since")} {formatDate(channel.createdAt)}
                </span>
                {channel.status === "active" ? null : (
                  <span className={styles.caption}>
                    {t(
                      "Kênh đang tạm ngưng nên chưa thể gỡ liên kết.",
                      "This channel is inactive, so it cannot be unlinked for now.",
                    )}
                  </span>
                )}
              </div>
              {channel.status === "active" ? (
                <Button
                  variant="secondary"
                  disabled={!online}
                  onClick={() => {
                    setError(null);
                    setDone(null);
                    setTarget(channel);
                  }}
                >
                  {t("Gỡ liên kết", "Unlink")}
                  <span className="sr-only"> {platformLabel(channel.platform)}</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {channels.length > 0 ? (
        <div className={styles.actions}>
          <Button href="/me/link" variant="ghost">
            {t("Liên kết thêm Zalo", "Link another Zalo")}
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={target !== null}
        danger
        busy={busy}
        title={t("Gỡ liên kết kênh này?", "Unlink this channel?")}
        body={
          <p>
            {t(
              `Sau khi gỡ, bot sẽ coi tài khoản ${platform} này là một người lạ mới: không có tên và không thuộc câu lạc bộ nào. Câu lạc bộ, lịch sử chơi và các khoản nợ của bạn vẫn ở trong tài khoản này. Bạn có thể liên kết lại bằng mã bất cứ lúc nào.`,
              `After unlinking, the bot treats this ${platform} account as a new stranger, with no name and no club. Your clubs, play history and balances stay in this account. You can link it again with a code at any time.`,
            )}
          </p>
        }
        error={error ? <ApiErrorNotice error={error} describe={describeSettingsError} /> : null}
        confirmLabel={t("Gỡ liên kết", "Unlink")}
        onConfirm={() => void confirm()}
        onCancel={() => {
          // After a 409 the reload may already have removed this row, and with it the dialog's
          // opener: land on the outcome region instead of <body>.
          if (target && !channels.some((c) => c.id === target.id && c.status === "active")) {
            setDone(t("Danh sách kênh đã được tải lại.", "The channel list has been reloaded."));
            focusOutcome.current = true;
          }
          setTarget(null);
          setError(null);
        }}
      />
    </>
  );
}
