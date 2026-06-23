#!/usr/bin/env node
/**
 * linear-sync.mjs — ENGINE đồng bộ Linear → progress.json (Linear làm leader cho status).
 *
 * Khác compare-linear.mjs (chỉ đọc & báo drift): script này GHI status từ Linear vào:
 *   • progress.json   — subtasks[].status (theo identifier) + module.status roll-up từ subtasks
 *   • linear-snapshot.json — cho dashboard so sánh
 *   rồi chạy sync-embedded.mjs để dashboard offline khớp.
 *
 * Dùng cho auto-update REALTIME: GitHub Action gọi script này khi push / Linear webhook /
 * cron. Bạn không phải nhắc — branch/PR của bạn flip Linear, Linear flip progress.json.
 *
 *   LINEAR_API_KEY=lin_api_xxx node linear-sync.mjs          # ghi thay đổi
 *   LINEAR_API_KEY=lin_api_xxx node linear-sync.mjs --check  # chỉ in, không ghi (CI dry-run)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const API = "https://api.linear.app/graphql";
const LABEL = "plexco-mvp";
const CHECK = process.argv.includes("--check");
const KEY = process.env.LINEAR_API_KEY;
if (!KEY) { console.error("✗ Thiếu LINEAR_API_KEY"); process.exit(1); }

function mapState(state) {
  if (!state) return "not_started";
  if ((state.name || "").toLowerCase().includes("review")) return "in_review";
  return ({ completed: "done", started: "in_progress", canceled: "blocked", backlog: "not_started", unstarted: "not_started" })[state.type] || "not_started";
}

async function gql(query) {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", Authorization: KEY }, body: JSON.stringify({ query }) });
  if (!res.ok) throw new Error(`Linear ${res.status}: ${await res.text()}`);
  const j = await res.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

/** Lấy mọi issue có label plexco-mvp (parents + sub-issues) → { identifier: {status, url, title} } */
async function fetchProject() {
  const byId = {};
  let after = "", hasNext = true;
  while (hasNext) {
    const d = await gql(`query {
      issues(filter: { labels: { name: { eq: "${LABEL}" } } }, first: 100${after ? `, after: "${after}"` : ""}) {
        pageInfo { hasNextPage endCursor }
        nodes { identifier title url state { name type } }
      }
    }`);
    for (const n of d.issues.nodes) byId[n.identifier] = { status: mapState(n.state), url: n.url, title: n.title };
    hasNext = d.issues.pageInfo.hasNextPage; after = d.issues.pageInfo.endCursor;
  }
  return byId;
}

async function main() {
  const pjPath = join(__dir, "progress.json");
  const pj = JSON.parse(readFileSync(pjPath, "utf8"));
  const linear = await fetchProject();

  // Roll-up: module status SUY TỪ subtasks khi có subtasks (vì branch/PR flip sub-issue,
  // không phải issue cha). Không có subtasks → lấy thẳng status issue cha [M#].
  function rollUp(subs) {
    if (!subs.length) return null;
    if (subs.some(s => s.status === "blocked")) return "blocked";
    if (subs.every(s => s.status === "done")) return "done";
    if (subs.some(s => s.status === "in_progress")) return "in_progress";
    if (subs.some(s => s.status === "in_review")) return "in_review";
    if (subs.some(s => s.status === "done")) return "in_progress";
    return "not_started";
  }

  let changes = [];
  let warnings = [];
  const snapModules = {};

  for (const m of pj.modules) {
    const parent = m.linearId ? linear[m.linearId] : null;
    // 1) cập nhật từng subtask từ Linear
    for (const s of (m.subtasks || [])) {
      const sub = s.identifier ? linear[s.identifier] : null;
      if (sub && sub.status !== s.status) { changes.push(`  ${s.identifier}: ${s.status} → ${sub.status}`); s.status = sub.status; }
      else if (s.identifier && !sub) { warnings.push(`${m.id}/${s.identifier}: không thấy trên Linear với label ${LABEL}`); }
    }
    // 2) module status: roll-up từ subtasks (nếu có), else status issue cha
    const subs = m.subtasks || [];
    const rolled = rollUp(subs);
    const newStatus = rolled != null ? rolled : (parent ? parent.status : m.status);
    if (newStatus !== m.status) { changes.push(`${m.id}: ${m.status} → ${newStatus}${rolled != null ? " (roll-up)" : ""}`); m.status = newStatus; }
    if (parent) snapModules[m.id] = { status: m.status, identifier: m.linearId, url: parent.url, title: parent.title };
  }

  // phase.status auto-derive từ module (giữ nhất quán với dashboard)
  const W = { not_started: 0, in_progress: .5, in_review: .85, done: 1, blocked: .25 };
  for (const p of pj.phases) {
    const mods = pj.modules.filter(x => x.phase === p.id);
    const tot = mods.reduce((a, x) => a + x.points, 0);
    const got = mods.reduce((a, x) => a + x.points * W[x.status], 0);
    const pc = tot ? got / tot : 0;
    p.status = pc >= 1 ? "done" : pc > 0 ? "in_progress" : "not_started";
  }

  if (warnings.length) console.warn("Cảnh báo:\n" + warnings.map(w => `  ${w}`).join("\n"));
  if (!changes.length) { console.log("✓ Không có thay đổi từ Linear. progress.json đã khớp."); return; }
  console.log("Thay đổi từ Linear:\n" + changes.join("\n"));
  if (CHECK) { console.log("\n(--check: không ghi file)"); process.exit(2); }

  pj.updatedAt = new Date().toISOString().slice(0, 10);
  writeFileSync(pjPath, JSON.stringify(pj, null, 2) + "\n");
  writeFileSync(join(__dir, "linear-snapshot.json"), JSON.stringify({ generatedAt: new Date().toISOString(), label: "plexco-mvp", source: "linear-sync", modules: snapModules }, null, 2));
  if (existsSync(join(__dir, "sync-embedded.mjs"))) {
    try { execSync("node sync-embedded.mjs", { cwd: __dir, stdio: "inherit" }); } catch (e) { console.error("sync-embedded lỗi (bỏ qua):", e.message); }
  }
  console.log(`✓ Đã ghi progress.json + linear-snapshot.json (${changes.length} thay đổi).`);
}

main().catch((e) => { console.error("Lỗi:", e.message); process.exit(1); });
