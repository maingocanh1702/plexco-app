import type { MetadataRoute } from "next";
import { THEME_BG_LIGHT, THEME_PRIMARY } from "../lib/theme-colors";

/**
 * Web app manifest (served at /manifest.webmanifest). The manifest cannot read CSS custom
 * properties, so the colours come from lib/theme-colors.ts, which mirrors `--primary` and `--bg-page`
 * (app/tokens-only.test.ts pins them to app/globals.css).
 * Pre-tenant surface: the name is language-neutral and the install prompt uses the `vi` default.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Plexco",
    short_name: "Plexco",
    description: "Plexco",
    lang: "vi",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: THEME_PRIMARY,
    background_color: THEME_BG_LIGHT,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
