import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./button.module.css";

type Common = {
  variant?: "primary" | "secondary" | "ghost";
  block?: boolean;
  children: ReactNode;
};

type ButtonProps = Common & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type LinkProps = Common & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

/**
 * One component, two elements: a real <button> for actions, a real <a> for navigation (the
 * Google sign-in MUST be a top-level navigation, not a fetch).
 */
export function Button(props: ButtonProps | LinkProps) {
  const { variant = "primary", block, children, ...rest } = props;
  const className = cx(styles.button, styles[variant], block && styles.block);
  if (props.href !== undefined) {
    const { href, target, rel, ...anchor } = rest as AnchorHTMLAttributes<HTMLAnchorElement> & {
      href: string;
    };
    // Client-side navigation only for in-app pages. /api/* (the Google start redirect) and
    // external URLs must be real top-level navigations, so they stay a plain <a>.
    const internal =
      href.startsWith("/") && !href.startsWith("//") && !/^\/api(?:[/?#]|$)/.test(href);
    if (internal && target !== "_blank") {
      return (
        <Link href={href} className={className} rel={rel} {...anchor}>
          {children}
        </Link>
      );
    }
    return (
      <a
        href={href}
        className={className}
        target={target}
        rel={target === "_blank" ? "noopener noreferrer" : rel}
        {...anchor}
      >
        {children}
      </a>
    );
  }
  const { type = "button", ...button } = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button type={type} className={className} {...button}>
      {children}
    </button>
  );
}
