// Renders the Plexco "P" monogram into the PWA icon set under apps/web/public/icons/.
// Run: node scripts/generate-pwa-icons.mjs   (sharp is a root devDependency)
// The output is committed; re-run only when the mark changes. Colours are the DD-81 target C
// values from docs/standards/design-tokens.md (this file is not a component stylesheet).
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const outDir = fileURLToPath(new URL("../apps/web/public/icons/", import.meta.url));
const BRAND = "#FF5A1F";
const INK = "#22100A";

// 512-unit canvas. `radius` 0 = full bleed (maskable / apple-touch: the OS applies its own mask).
// The glyph stays inside the central 80% safe zone required by the maskable spec.
function svg(radius) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="${radius}" fill="${INK}"/>
  <path transform="translate(-24 0)" d="M204 388V124h82a70 70 0 0 1 0 140h-82" fill="none" stroke="${BRAND}" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
}

const targets = [
  { file: "icon-192.png", size: 192, radius: 112 },
  { file: "icon-512.png", size: 512, radius: 112 },
  { file: "icon-512-maskable.png", size: 512, radius: 0 },
  { file: "apple-touch-icon.png", size: 180, radius: 0 },
];

await mkdir(outDir, { recursive: true });
await writeFile(`${outDir}icon.svg`, svg(112));
for (const { file, size, radius } of targets) {
  await sharp(Buffer.from(svg(radius)), { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(`${outDir}${file}`);
  console.log(`wrote ${file} (${size}x${size})`);
}
