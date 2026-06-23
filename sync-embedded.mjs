#!/usr/bin/env node
/**
 * sync-embedded.mjs — ghi nội dung progress.json vào khối `const EMBEDDED = {...};`
 * trong plexco-dashboard.html. Giải quyết tận gốc việc EMBEDDED lệch progress.json:
 * progress.json là 1 nguồn duy nhất, EMBEDDED chỉ là bản nhúng để mở offline.
 *
 *   node sync-embedded.mjs        # chạy sau mỗi lần sửa progress.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dir = dirname(fileURLToPath(import.meta.url));

const progressPath = join(__dir, "progress.json");
const htmlPath = join(__dir, "plexco-dashboard.html");

const progress = readFileSync(progressPath, "utf8");
JSON.parse(progress); // validate
const html = readFileSync(htmlPath, "utf8");

const re = /const EMBEDDED = \{[\s\S]*?\n\};/;
if (!re.test(html)) {
  console.error("✗ Không tìm thấy khối `const EMBEDDED = {...};` trong dashboard. Bỏ qua.");
  process.exit(1);
}
const block = "const EMBEDDED = " + progress.trim() + ";";
const out = html.replace(re, block);
writeFileSync(htmlPath, out);
console.log("✓ Đã đồng bộ EMBEDDED ← progress.json (" + JSON.parse(progress).modules.length + " module). Dashboard offline giờ khớp.");
