#!/usr/bin/env node
/**
 * gen-linear-csv.mjs — sinh linear-import.csv để seed backlog vào Linear
 * KHÔNG cần OAuth/connector. Dùng Linear → Settings/Team → Import → CSV.
 *
 *   node gen-linear-csv.mjs
 *
 * Quy ước hybrid: Title có prefix [M#] + label "plexco-mvp" → khoá đối chiếu với progress.json.
 * CSV không tạo được sub-issue, nên DoD nằm trong Description dạng checklist markdown
 * (Linear render thành checklist; có thể tách sub-issue sau khi import).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dir = dirname(fileURLToPath(import.meta.url));

const progress = JSON.parse(readFileSync(join(__dir, "progress.json"), "utf8"));

// DoD checklist cho M1–M6 (rút từ BACKLOG-P0-P3.md). M7–M19 dùng goal của phase.
const DOD = {
  M1: [
    "Monorepo pnpm: packages/core, apps/bot, apps/web + CI chạy pnpm test",
    "Postgres docker-compose dev (db:up / db:reset)",
    "Lift core: matching/payments-logic/dates/format/i18n/sports (không phụ thuộc DB)",
    "Port test cũ vào core, xanh lại làm reference",
    "CI job core fail PR nếu đỏ",
  ],
  M2: [
    "Drizzle 01_tenants_rls + role app NOSUPERUSER NOBYPASSRLS",
    "Mỗi bảng tenant-scoped: ENABLE+FORCE RLS, policy USING(tenant_id=current_setting) fail-closed",
    "withTenant(tenantId, fn): tx + SET LOCAL app.tenant_id",
    "[ISO] test cô lập A/B + quên SET LOCAL → 0 dòng (CI)",
    "public_sessions skeleton (no RLS) đúng field whitelist",
    "[PUB] test whitelist skeleton (CI)",
  ],
  M3: [
    "02_sessions_players_charges: tenant_id khắp nơi; sports; sessions.{sport_id,visibility,slots_max,area,venue,skill_level,join_policy}",
    "UNIQUE players/charges/pay_code",
    "tenantRepo(tenantId) choke-point — nơi DUY NHẤT chèn tenant_id",
    "Edge #30: chỉ chọn môn từ sports active",
    "03_settings (tenant_id,key) + RLS",
    "[ISO] mở rộng cho mọi bảng mới → đóng Milestone MS1",
  ],
  M4: [
    "Telegram long-poll → webhook /telegram/<secret>",
    "Middleware resolve tenant từ kênh: chat_id → telegram_links → tenant",
    "Deep-link /start link_<code> (admin bind) + /start club_<slug> (player context)",
    "Authz 2 lớp: isTenantAdmin theo from.id (Edge #16)",
    "Lệnh host: /newsession đa môn, /announce, /config, /cash + cron throttler",
    "Fail-closed TENANT_NOT_LINKED; test routing 2 tenant không lẫn",
  ],
  M5: [
    "06 bank_accounts/transactions/allocations + RLS",
    "/webhook/sepay/:token: token + timing-safe secret + verify account",
    "Durable ingest: INSERT idempotent UNIQUE(tenant,provider,external_id) + enqueue rồi mới ACK",
    "Matching: pay_code (nullable, chưa phụ thuộc) → tên+amount+ngày",
    "Allocation partial/multi-person/overpay/reversal; FIFO; ∈[0,amount]; paid khi phủ đủ",
    "Ledger invariants ở DB; không sửa/xoá allocation đã audit",
    "/unmatched gán tay + retry cron EVERY_HOUR",
    "[LED] + [WRK] test bất biến (CI)",
  ],
  M6: [
    "Script SQLite→Postgres: tenant Bestminton + owner + TelegramLink + BankAccount, sport=cầu lông",
    "Copy sessions/players/members/aliases gắn tenant_id; mỗi player-session → charge",
    "Payment lịch sử → bank_transaction+allocation; thiếu gốc → legacy:<id> source=manual",
    "Đối chiếu tổng charge/allocated/unallocated + roster trước cutover",
    "Cutover: đổi webhook → tắt bot cũ (đóng băng làm reference)",
    "Founder dogfood thật → đóng Milestone MS2",
  ],
};

function statusToLinear(s) {
  // Linear importer chấp nhận tên trạng thái workflow; map enum của ta → tên mặc định Linear
  return ({ not_started: "Backlog", in_progress: "In Progress", in_review: "In Review", done: "Done", blocked: "Backlog" })[s] || "Backlog";
}
function csvField(v) {
  v = String(v == null ? "" : v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

const phaseGoal = Object.fromEntries(progress.phases.map((p) => [p.id, p.goal]));
const rows = [["Title", "Description", "Status", "Labels", "Estimate"]];

for (const m of progress.modules) {
  const dod = DOD[m.id];
  let desc = `Module ${m.id} · ${m.track} · phase ${m.phase}\n\nGoal phase: ${phaseGoal[m.phase] || ""}`;
  if (dod) desc += `\n\n**DoD (đóng issue khi đủ):**\n` + dod.map((x) => `- [ ] ${x}`).join("\n");
  else desc += `\n\n_(DoD chi tiết sẽ bổ sung khi tới gần phase — xem ROADMAP/PRD/TDD.)_`;
  if (m.postMvp) desc += `\n\n> post-MVP (chặn bởi Meta App Review).`;
  rows.push([`[${m.id}] ${m.name}`, desc, statusToLinear(m.status), "plexco-mvp", m.points]);
}

const csv = rows.map((r) => r.map(csvField).join(",")).join("\n");
writeFileSync(join(__dir, "linear-import.csv"), csv);
console.log(`✓ Đã sinh linear-import.csv — ${progress.modules.length} issue, label plexco-mvp.`);
console.log(`  Import: Linear → (Team) → ⋯ → Import → CSV → map cột Title/Description/Status/Labels/Estimate.`);
