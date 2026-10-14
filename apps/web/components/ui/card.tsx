import type { HTMLAttributes } from "react";
import { cx } from "./cx";
import styles from "./card.module.css";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(styles.card, className)} {...rest} />;
}
