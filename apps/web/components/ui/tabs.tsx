"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import styles from "./tabs.module.css";

export interface TabItem {
  id: string;
  label: string;
  panel: ReactNode;
}

/** WAI-ARIA tabs: roving tabindex, Arrow/Home/End keys, a labelled tabpanel per tab. */
export function Tabs({
  items,
  active,
  onChange,
  label,
}: {
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = items.findIndex((item) => item.id === active);
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    const target = items[next]!;
    onChange(target.id);
    refs.current[target.id]?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label={label} className={styles.list} onKeyDown={onKeyDown}>
        {items.map((item) => (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[item.id] = el;
            }}
            role="tab"
            type="button"
            id={`${base}-tab-${item.id}`}
            aria-selected={item.id === active}
            aria-controls={`${base}-panel-${item.id}`}
            tabIndex={item.id === active ? 0 : -1}
            className={styles.tab}
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${base}-panel-${item.id}`}
          aria-labelledby={`${base}-tab-${item.id}`}
          hidden={item.id !== active}
          className={styles.panel}
        >
          {item.id === active ? item.panel : null}
        </div>
      ))}
    </div>
  );
}
