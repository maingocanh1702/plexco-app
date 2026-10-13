"use client";

import { useId } from "react";
import { useT } from "../../lib/i18n-client";
import type { GuestNoteDto } from "../../lib/sessions-api";
import styles from "./session-detail-view.module.css";

/** Guest notes (read-only here; guests are not roster members). */
export function RosterGuestNotes({ notes }: { notes: GuestNoteDto[] }) {
  const t = useT();
  const id = useId();
  if (notes.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className={styles.sectionTitle}>
        {t("Ghi chú khách", "Guest notes")}
      </h2>
      <ul className={styles.playerList}>
        {notes.map((g) => (
          <li key={g.id} className={styles.player}>
            <span className={styles.playerName}>{g.guestName}</span>
            {g.note ? <span className={styles.note}>{g.note}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
