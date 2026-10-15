import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Inter } from "next/font/google";
import type { ReactNode } from "react";
import { THEME_BG_DARK, THEME_BG_LIGHT } from "../lib/theme-colors";
import { RegisterSw } from "../components/pwa/register-sw";
import "./globals.css";

// Headings use Be Vietnam Pro (DD-123 OD-7): unlike Sora it ships a "vietnamese" subset whose
// unicode-range covers U+1EA0-1EF9, so stacked Vietnamese vowels render in the heading face, not
// a fallback. It only has static weights; 700 is what every heading rule uses, 600 the semibold token.
// Self-hosted at build time by next/font; display swap + system fallbacks (see --font-* tokens).
const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["600", "700"],
  variable: "--font-be-vietnam-pro",
  display: "swap",
});
const inter = Inter({
  subsets: ["latin", "vietnamese"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Plexco", template: "%s · Plexco" },
  description: "Plexco",
  applicationName: "Plexco",
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "Plexco", statusBarStyle: "default" },
};

// theme-color mirrors --primary-adjacent surfaces (--bg-page light / dark); the install chrome
// follows the user's scheme.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_BG_LIGHT },
    { media: "(prefers-color-scheme: dark)", color: THEME_BG_DARK },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" className={`${beVietnamPro.variable} ${inter.variable}`}>
      <body>
        {children}
        <RegisterSw />
      </body>
    </html>
  );
}
