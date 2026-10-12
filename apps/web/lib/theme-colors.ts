/**
 * The only colour literals outside globals.css. <meta name="theme-color"> and the web manifest
 * cannot resolve CSS custom properties, so these mirror `--primary` / `--bg-page` (light and
 * dark). theme-colors.test.ts fails if they drift from app/globals.css.
 */
export const THEME_PRIMARY = "#ff5a1f";
export const THEME_BG_LIGHT = "#faf8f6";
export const THEME_BG_DARK = "#0f1115";
