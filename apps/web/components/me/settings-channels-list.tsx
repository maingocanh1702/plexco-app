"use client";

import { useState } from "react";
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
 * Linked channels with UNLINK. Unlink moves the channel off this account (the channel user becomes
 * a stranger again); the account's clubs, charges and history stay. The confirm dialog says so.
 * Detach is naturally idempotent server-side, so there is no commandId: a repeat answers
 * CHANNEL_NOT_LINKED and the list simply reloads.
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
      setTarget(null);
      setFocusKey((n) => n + 1);
      onChanged();
    } catch (failure) {
      setError(failure);
      // The row may already be gone (409): reload the list behind the dialog.
      if (describeSettingsError(failure, t).action === "reload") onChanged();
    } finally {
      setBusy(false);
    }
  }

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
                      : t("Đã ngắt", "Disconnected")}
                  </Badge>
                </div>
                <span className={styles.caption}>
                  {t("Liên kết ngày", "Linked on")} {formatDate(channel.createdAt)}
                </span>
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
              "Kênh này sẽ không còn gắn với tài khoản của bạn. Câu lạc bộ, lịch sử chơi và các khoản nợ của bạn vẫn ở trong tài khoản này. Bạn có thể liên kết lại bằng mã bất cứ lúc nào.",
              "This channel will no longer be tied to your account. Your clubs, play history and balances stay in this account. You can link it again with a code at any time.",
            )}
          </p>
        }
        error={error ? <ApiErrorNotice error={error} describe={describeSettingsError} /> : null}
        confirmLabel={t("Gỡ liên kết", "Unlink")}
        onConfirm={() => void confirm()}
        onCancel={() => {
          setTarget(null);
          setError(null);
        }}
      />
    </>
  );
}
