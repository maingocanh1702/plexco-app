"use client";

import { useT } from "../../lib/i18n-client";
import { Card } from "../ui/card";
import styles from "../settings/settings-layout.module.css";

/**
 * /me/settings privacy note for gender data (DD-39, owner decision B3). Read-only and presentational:
 * no fetch and no flag read; SettingsView renders it only while gender collection is on. Every
 * sentence is pinned byte for byte, each with its proof, in
 * docs/sessions/web-mvp-phase3-readiness-p3-flags-default-on.md ("Copy (pinned)": H and P1-P6).
 * Never reword one here; a new sentence needs a new proof there first.
 */
export function SettingsPrivacyNote() {
  const t = useT();
  return (
    <Card data-testid="settings-privacy-note">
      <section className={styles.section} aria-labelledby="me-privacy">
        <h2 id="me-privacy">{t("Dữ liệu giới tính của bạn", "Your gender data")}</h2>
        <p className={styles.caption}>
          {t(
            "Giới tính của bạn được lưu ở dạng mã hoá trên hồ sơ Plexco của bạn.",
            "Your gender is stored encrypted on your Plexco profile.",
          )}
        </p>
        <p className={styles.caption}>
          {t(
            "Giới tính của bạn không được hiển thị cho CLB hay người chơi khác, và không xuất hiện trên bất kỳ trang công khai nào.",
            "Your gender is not shown to clubs or other players, and it does not appear on any public page.",
          )}
        </p>
        <p className={styles.caption}>
          {t(
            "CLB chỉ nhận mức giá được tính từ giới tính của bạn, không nhận chính giới tính đó; nhưng nếu CLB đặt giá riêng cho nam hoặc nữ, mức giá đó có thể cho CLB biết giới tính của bạn.",
            "Clubs receive only the price worked out from your gender, not your gender itself; but if a club sets a separate price for men or women, that price can tell the club your gender.",
          )}
        </p>
        <p className={styles.caption}>
          {t(
            "Bạn có thể đổi giới tính đã đặt bất cứ lúc nào bằng cách chọn lựa chọn khác rồi lưu.",
            "You can change your gender at any time by choosing another option and saving.",
          )}
        </p>
        <p className={styles.caption}>
          {t(
            "Để xoá giới tính khỏi hồ sơ, đặt lại thành Chưa đặt rồi lưu; quyền dùng giới tính để tính giá cũng bị tắt theo.",
            "To remove your gender from your profile, set the field back to Not set and save; the pricing permission is switched off with it.",
          )}
        </p>
        <p className={styles.caption}>
          {t(
            "Để CLB ngừng dùng giới tính mà không xoá nó, bỏ đánh dấu ô cho phép rồi lưu.",
            "To stop clubs using your gender without removing it, untick the box and save.",
          )}
        </p>
      </section>
    </Card>
  );
}
