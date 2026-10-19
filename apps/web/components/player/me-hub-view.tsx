"use client";

import { useT } from "../../lib/i18n-client";
import { useOnlineStatus } from "../../lib/use-online-status";
import discover from "../discover/discover.module.css";
import { Button } from "../ui/button";

/** S-4: links to the four player lists. It reads nothing; MeFrame already shows the offline banner (RC-3). */
export function MeHubView({ online }: { online: boolean }) {
  const t = useT();
  const links: [string, string][] = [
    ["/me/clubs", t("CLB của tôi", "My clubs")],
    ["/me/sessions", t("Buổi chơi của tôi", "My sessions")],
    ["/me/charges", t("Khoản phải trả", "My charges")],
    ["/me/requests", t("Yêu cầu tham gia", "My requests")],
  ];
  return (
    <main className={discover.page} data-state={online ? "ready" : "offline"}>
      <h1 className={discover.heading}>{t("Tài khoản của tôi", "My account")}</h1>
      <ul className={discover.list}>
        {links.map(([href, label]) => (
          <li key={href}>
            <Button href={href} variant="secondary" block>
              {label}
            </Button>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function MeHubScreen() {
  return <MeHubView online={useOnlineStatus()} />;
}
