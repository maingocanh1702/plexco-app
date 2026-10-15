// Writes apps/web/public/sw.js from apps/web/sw/sw.template.js with a per-build cache version.
// Run by `pnpm --filter @plexco/web build` (see apps/web/package.json) before `next build`.
// Version: NEXT_PUBLIC_BUILD_ID, else the git short SHA, else a timestamp - any of them changes
// on every deploy, which is what makes browsers re-install the worker and drop old caches.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const template = fileURLToPath(new URL("../apps/web/sw/sw.template.js", import.meta.url));
const output = fileURLToPath(new URL("../apps/web/public/sw.js", import.meta.url));

function gitShortSha() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const raw = process.env.NEXT_PUBLIC_BUILD_ID || gitShortSha() || String(Date.now());
// The id lands inside a JS string literal and a cache name: keep it to a safe charset.
const version = raw.replace(/[^A-Za-z0-9._-]/g, "-");
const source = readFileSync(template, "utf8");
if (!source.includes("__SW_VERSION__")) throw new Error("sw template lost its __SW_VERSION__ marker");
writeFileSync(output, source.replace("__SW_VERSION__", version));
console.log(`stamped public/sw.js (version ${version})`);
