import { headers } from "next/headers";
import { LinkCodeForm } from "../../../components/me/link-code-form";

// Session-dependent: never prerender or cache.
export const dynamic = "force-dynamic";

/** /me/link -- enter the code the Zalo bot gave you (`/link`). Language: browser preference, vi default. */
export default async function LinkZaloPage() {
  const accept = (await headers()).get("accept-language")?.toLowerCase() ?? "";
  const lang = accept.startsWith("en") ? "en" : "vi";
  const en = lang === "en";
  return (
    <main>
      <h1>{en ? "Link your Zalo" : "Liên kết Zalo"}</h1>
      <p>
        {en
          ? "Send /link to your club's Zalo bot to get a one-time code, then enter it here."
          : "Gửi /link cho bot Zalo của CLB để nhận mã dùng một lần, rồi nhập mã vào đây."}
      </p>
      <LinkCodeForm lang={lang} />
    </main>
  );
}
