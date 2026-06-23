#!/usr/bin/env node
/**
 * compare-linear.mjs — đối chiếu progress.json ⇄ Linear (hybrid dual source of truth)
 *
 * Ownership theo field:
 *   • Linear         — sở hữu status (subtask + module roll-up).
 *   • progress.json  — sở hữu cấu trúc roadmap/gate/invariant/subtask title/khoá.
 * Script này CHỈ ĐỌC cả hai và báo CHỖ LỆCH (drift).
 *
 * Khoá đối chiếu: mỗi Linear issue có title prefix "[M#] ..." + label "plexco-mvp".
 *
 * Cách chạy:
 *   export LINEAR_API_KEY=lin_api_xxx      # Settings → Security & access → Personal API keys
 *   node compare-linear.mjs                # in bảng drift
 *   node compare-linear.mjs --write        # + ghi linear-snapshot.json cho dashboard
 *
 * Không có LINEAR_API_KEY → script vẫn chạy ở chế độ demo (đọc linear-snapshot.json nếu có)
 * để bạn xem định dạng output.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const LABEL = "plexco-mvp";
const API = "https://api.linear.app/graphql";
const WRITE = process.argv.includes("--write");

/* ---- enum chung (khớp dashboard) ---- */
const ORDER = ["not_started", "in_progress", "in_review", "done", "blocked"];

/* Map Linear state → enum của ta.
 * Linear state.type ∈ {backlog, unstarted, started, completed, canceled}.
 * state.name chứa "review" → in_review (tách khỏi started). */
function mapLinearState(state) {
  if (!state) return "not_started";
  const name = (state.name || "").toLowerCase();
  if (name.includes("review")) return "in_review";
  switch (state.type) {
    case "completed": return "done";
    case "started":   return "in_progress";
    case "canceled":  return "blocked";
    case "backlog":
    case "unstarted":
    default:          return "not_started";
  }
}

async function linearQuery(query, apiKey) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Linear API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error("Linear GraphQL: " + JSON.stringify(json.errors));
  return json.data;
}

/** Lấy tất cả issue có label plexco-mvp → { MNA-63: {status, identifier, url, title} } */
async function fetchLinear(apiKey) {
  const out = {};
  let after = "", hasNext = true;
  while (hasNext) {
    const q = `query {
      issues(filter: { labels: { name: { eq: "${LABEL}" } } }, first: 100${after ? `, after: "${after}"` : ""}) {
        pageInfo { hasNextPage endCursor }
        nodes { identifier title url state { name type } }
      }
    }`;
    const data = await linearQuery(q, apiKey);
    for (const n of data.issues.nodes) {
      out[n.identifier] = { status: mapLinearState(n.state), identifier: n.identifier, url: n.url, title: n.title };
    }
    hasNext = data.issues.pageInfo.hasNextPage;
    after = data.issues.pageInfo.endCursor;
  }
  return out;
}

function rollUpStatuses(statuses) {
  if (!statuses.length) return null;
  if (statuses.some(s => s === "blocked")) return "blocked";
  if (statuses.every(s => s === "done")) return "done";
  if (statuses.some(s => s === "in_progress")) return "in_progress";
  if (statuses.some(s => s === "in_review")) return "in_review";
  if (statuses.some(s => s === "done")) return "in_progress";
  return "not_started";
}

function deriveModuleStatus(module, byIdentifier) {
  const parent = module.linearId ? byIdentifier[module.linearId] : null;
  const subStatuses = [];
  let missingSubtasks = 0;
  for (const s of (module.subtasks || [])) {
    if (!s.identifier) continue;
    const sub = byIdentifier[s.identifier];
    if (sub) subStatuses.push(sub.status);
    else missingSubtasks++;
  }
  const rolled = missingSubtasks === 0 ? rollUpStatuses(subStatuses) : null;
  const status = rolled != null ? rolled : parent?.status;
  if (!status) return null;
  return {
    status,
    identifier: parent?.identifier || module.linearId,
    url: parent?.url,
    title: parent?.title || `[${module.id}] ${module.name}`,
    source: rolled != null ? "subtask-rollup" : "parent",
    missingSubtasks
  };
}

function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); }
const C = { red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", dim: "\x1b[2m", reset: "\x1b[0m", bold: "\x1b[1m" };

async function main() {
  const progress = JSON.parse(readFileSync(join(__dir, "progress.json"), "utf8"));
  const modules = progress.modules;

  const apiKey = process.env.LINEAR_API_KEY;
  let linear = {};
  let linearByIdentifier = null;
  let source = "Linear API";
  if (apiKey) {
    linearByIdentifier = await fetchLinear(apiKey);
  } else if (existsSync(join(__dir, "linear-snapshot.json"))) {
    const snap = JSON.parse(readFileSync(join(__dir, "linear-snapshot.json"), "utf8"));
    linear = snap.modules || {};
    source = "linear-snapshot.json (demo, không có LINEAR_API_KEY)";
  } else {
    console.error(`${C.yellow}⚠ Chưa có LINEAR_API_KEY và chưa có linear-snapshot.json.${C.reset}`);
    console.error(`  export LINEAR_API_KEY=lin_api_xxx  rồi chạy lại.`);
    process.exit(1);
  }

  console.log(`\n${C.bold}Plexco — drift report  (nguồn Linear: ${source})${C.reset}`);
  console.log(`${C.dim}progress.json cập nhật ${progress.updatedAt}${C.reset}\n`);
  console.log(C.dim + pad("Mod", 5) + pad("progress.json", 16) + pad("Linear", 16) + "Drift" + C.reset);
  console.log(C.dim + "─".repeat(56) + C.reset);

  let drift = 0, missing = 0, matched = 0;
  const snapshotOut = {};
  for (const m of modules) {
    const lin = linearByIdentifier ? deriveModuleStatus(m, linearByIdentifier) : linear[m.id];
    const pj = m.status;
    let linStatus = lin ? lin.status : null;
    if (lin) snapshotOut[m.id] = lin;

    let flag, color;
    if (!lin) { flag = "— (chưa có trên Linear)"; color = C.yellow; missing++; }
    else if (lin.missingSubtasks) { flag = `⚠ thiếu ${lin.missingSubtasks} subtask trên Linear/label`; color = C.yellow; missing++; }
    else if (lin.status === pj) { flag = "ok"; color = C.green; matched++; }
    else { flag = `≠ LỆCH`; color = C.red; drift++; }

    console.log(color + pad(m.id, 5) + pad(pj, 16) + pad(linStatus || "—", 16) + flag + C.reset);
  }

  console.log(C.dim + "─".repeat(56) + C.reset);
  console.log(`${C.green}khớp: ${matched}${C.reset}  ${C.red}lệch: ${drift}${C.reset}  ${C.yellow}thiếu trên Linear: ${missing}${C.reset}\n`);

  if (WRITE && apiKey) {
    const out = { generatedAt: new Date().toISOString(), label: LABEL, modules: snapshotOut };
    writeFileSync(join(__dir, "linear-snapshot.json"), JSON.stringify(out, null, 2));
    console.log(`${C.green}✓ Đã ghi linear-snapshot.json${C.reset} — mở dashboard → "Load Linear snapshot" để xem cột so sánh.\n`);
  } else if (WRITE) {
    console.log(`${C.yellow}--write bị bỏ qua vì không có LINEAR_API_KEY (đang đọc từ snapshot demo).${C.reset}\n`);
  }

  process.exit(drift > 0 ? 2 : 0); // exit 2 nếu có drift → tiện gắn CI/cron
}

main().catch((e) => { console.error(`${C.red}Lỗi:${C.reset}`, e.message); process.exit(1); });
