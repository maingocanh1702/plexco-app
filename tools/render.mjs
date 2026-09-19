// Renderers for `node tools/progress.mjs --render`.
//
// Two outputs, both DERIVED from docs/project/modules.json (plus what progress.mjs measured):
//   1. the Module Progress markdown table that lives between <!-- modules:begin --> and
//      <!-- modules:end --> in docs/product/ROADMAP.md -- rendered, never hand-edited again;
//   2. docs/project/board.html -- the one-screen board (two headline bars, phase -> module,
//      decision inbox, lanes). Self-contained, no external assets, so it can be committed and
//      published as-is.
//
// Nothing here scores anything. Scores come from progress.mjs; this file only lays them out.

const TRACK_EMOJI = {
  core: "\u{1F3E2}",
  payment: "\u{1F4B0}",
  identity: "\u{1F194}",
  "web-sync": "\u{1F310}",
  marketplace: "\u{1F50E}",
  "player-channels": "\u{1F3AF}",
  security: "\u{1F512}",
};
const TRACK_NAME = {
  core: "Multi-tenant Core",
  payment: "Payment Reconciliation",
  identity: "Identity & Merge",
  "web-sync": "Web + Sync",
  marketplace: "Marketplace Discovery",
  "player-channels": "Player-side channels",
  security: "Security & Ops",
};
const AXIS_EMOJI = {
  done: "✅",
  merged_not_enabled: "\u{1F7E2}",
  merged_dark: "\u{1F7E2}",
  partial: "\u{1F7E1}",
  not_started: "⬜",
  blocked_external: "⛔",
  "n/a": "—",
};
const HEALTH_VI = {
  on_track: "đúng hướng",
  at_risk: "rủi ro",
  blocked: "bị chặn",
  paused: "tạm hoãn",
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------- markdown table

export function renderMarkdownTable(modules) {
  const cell = (m, axis) => {
    const e = AXIS_EMOJI[m.axes[axis]] ?? "?";
    const note = m.axis_notes?.[axis];
    return note ? `${e} ${note}` : e;
  };
  const lines = [
    "| # | Module | Track | Phase | Spec | Migration | BE | FE | Tests | Rev? | Status |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const m of modules) {
    const track = (m.track ?? []).map((t) => TRACK_EMOJI[t] ?? t).join("");
    const phase = m.phase_label ?? m.phases_all?.join("/") ?? m.phase;
    lines.push(
      `| ${m.id} | ${m.name} | ${track} | ${phase} | ${m.spec_note ?? ""} | ${cell(m, "migration")} | ${cell(m, "be")} | ${cell(m, "fe")} | ${cell(m, "tests")} | ${m.rev ?? ""} | ${m.status_note ?? ""} |`,
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- board.html

export function renderBoardHtml(d) {
  // d: { generatedAt, ref, sha, pin, roadmapVersion, carryFiles, headline, counts, countsAtPin,
  //      phases: [{phase, modules:[...]}], tracks: [{track, pct, modules}], inbox: [...],
  //      ap3: {...}, worktrees: n, recent: {commits, merges}, roadmapHeadline }
  const bar = (pct, cls) =>
    `<span class="track"><i class="${cls}" style="width:${Math.max(pct, pct === 0 ? 2 : 0)}%"></i></span>`;
  const fill = (pct) => (pct === 100 ? "f-done" : pct === 0 ? "f-zero" : "f-part");

  const phaseCards = d.phases
    .map((g) => {
      const done = g.modules.filter((m) => m.pct === 100).length;
      const zero = g.modules.filter((m) => m.pct === 0).length;
      const chip =
        done === g.modules.length
          ? `<span class="chip all-done">${done}/${g.modules.length} xong</span>`
          : zero === g.modules.length
            ? `<span class="chip none">chưa bắt đầu</span>`
            : `<span class="chip">${done} xong · ${g.modules.length - done - zero} dở · ${zero} chưa</span>`;
      const rows = g.modules
        .map((m) => {
          const h = m.health
            ? `<span class="h h-${esc(m.health)}">${esc(HEALTH_VI[m.health] ?? m.health)}</span>`
            : "";
          const bb = m.blocked_by?.length
            ? `<span class="bb">chờ ${esc(m.blocked_by.join(", "))}</span>`
            : "";
          const lb = m.launch_block
            ? `<span class="lb">launch ${esc(m.launch_block.join("+"))}</span>`
            : "";
          const also = m.multiPhase
            ? `<span class="also">cũng ${esc(m.phasesAll.slice(1).join(", "))}</span>`
            : "";
          return `<div class="mod${m.pct === 0 ? " z" : ""}${m.health === "paused" ? " paused" : ""}">
  <span class="p">${m.pct}%</span>
  <div class="t"><b>${esc(m.name)}</b><span class="meta">#${esc(m.id)} ${h}${lb}${bb}${also}</span>${m.next ? `<span class="next">→ ${esc(m.next)}</span>` : ""}${bar(m.pct, fill(m.pct))}</div>
</div>`;
        })
        .join("\n");
      return `<div class="ph"><h3><span class="code">${esc(g.phase)}</span>${chip}</h3>\n${rows}\n</div>`;
    })
    .join("\n");

  const trackRow = d.tracks
    .map(
      (t) =>
        `<span class="trk"><span class="e">${TRACK_EMOJI[t.track] ?? esc(t.track)}</span>${bar(t.pct, fill(t.pct))}<span class="v">${t.pct}%</span> ${esc(TRACK_NAME[t.track] ?? t.track)}</span>`,
    )
    .join("\n");

  const inboxRows = (d.inbox ?? [])
    .map((it) => {
      const age = it.opened
        ? Math.round((Date.parse(d.generatedAt) - Date.parse(it.opened)) / 86400000)
        : null;
      const over = age !== null && it.default && age > 21;
      return `<tr class="${over ? "over" : ""}"><td class="mono">${esc(it.id)}</td><td>${esc(it.question)}</td><td>${esc(it.blocks)}</td><td>${esc(it.default ?? "—")}</td><td class="n">${age === null ? "?" : age + "d"}</td></tr>`;
    })
    .join("\n");

  const hb = d.headline;
  const countsRows = [
    ["Migration", d.countsAtPin?.migrations, d.counts.migrations],
    ["Test file", d.countsAtPin?.testFiles, d.counts.testFiles],
    ["API route nghiệp vụ", d.countsAtPin?.businessRoutes, d.counts.businessRoutes],
    ["Màn FE nối API thật", d.countsAtPin?.feScreens, d.counts.feScreens],
  ]
    .map(([k, a, b]) => {
      const delta = a == null ? "" : b - a === 0 ? "0" : (b - a > 0 ? "+" : "") + (b - a);
      return `<tr><td>${k}</td><td class="n">${a ?? "?"}</td><td class="n">${b}</td><td class="n ${b - a > 0 ? "up" : "flat"}">${delta}</td></tr>`;
    })
    .join("\n");

  const lanes = d.lanes ?? {};

  return `<title>Plexco Delivery Board</title>
<meta name="generator" content="node tools/progress.mjs --render">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>
:root{--paper:#f5f7f3;--surface:#fff;--surface-2:#eef1ea;--ink:#151a16;--muted:#5c655d;--faint:#8a9289;--line:#dde2d8;--line-strong:#c6cec0;--pine:#2f6f5e;--pine-soft:#dcebe4;--amber:#9a6410;--amber-soft:#f6e9d2;--stop:#973232;--stop-soft:#f7e0de;--idle:#a6ada2;--sans:"IBM Plex Sans",ui-sans-serif,system-ui,sans-serif;--mono:"IBM Plex Mono",ui-monospace,Menlo,monospace;--r:6px}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--paper:#11150f;--surface:#191e18;--surface-2:#212721;--ink:#e8ece5;--muted:#9aa396;--faint:#707a6e;--line:#2c332b;--line-strong:#3d453b;--pine:#6fc0a5;--pine-soft:#1d2f29;--amber:#d9a441;--amber-soft:#322717;--stop:#e08a80;--stop-soft:#331e1c;--idle:#4e564c}}
:root[data-theme="dark"]{--paper:#11150f;--surface:#191e18;--surface-2:#212721;--ink:#e8ece5;--muted:#9aa396;--faint:#707a6e;--line:#2c332b;--line-strong:#3d453b;--pine:#6fc0a5;--pine-soft:#1d2f29;--amber:#d9a441;--amber-soft:#322717;--stop:#e08a80;--stop-soft:#331e1c;--idle:#4e564c}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.5}
.wrap{max-width:1080px;margin:0 auto;padding-inline:20px;padding-block:32px 56px;display:flex;flex-direction:column;gap:26px}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--faint);margin:0}
h1{font-size:clamp(26px,5vw,36px);line-height:1.12;letter-spacing:-.02em;margin:6px 0 0;text-wrap:balance}h2{font-size:15px;margin:0}
.stamp{font-family:var(--mono);font-size:12.5px;color:var(--muted);margin:10px 0 0}.stamp b{color:var(--ink);font-weight:600}
.verdict{margin-top:18px;display:flex;gap:12px;align-items:flex-start;border:1px solid var(--line-strong);border-radius:var(--r);padding:12px 14px;background:var(--amber-soft);border-left:3px solid var(--amber)}
.verdict.ok{background:var(--pine-soft);border-left-color:var(--pine)}.verdict .tag{font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.06em;color:var(--amber);white-space:nowrap;padding-top:2px}.verdict.ok .tag{color:var(--pine)}.verdict p{margin:0;font-size:14px}
.heads{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:var(--r);overflow:hidden}
.head{background:var(--surface);padding:16px 18px 16px;display:flex;flex-direction:column;gap:8px}.head .label{font-size:12px;color:var(--muted)}.head .num{font-family:var(--mono);font-size:34px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.head .big{height:9px;background:var(--surface-2);border-radius:3px;overflow:hidden}.head .big i{display:block;height:100%}.head .why{font-size:12px;color:var(--muted);line-height:1.4}.head.quiet{background:var(--surface-2)}.head.quiet .num{color:var(--muted);font-size:24px}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:18px 18px 20px}.panel>header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--line)}.panel>header .note{font-family:var(--mono);font-size:11px;color:var(--faint);text-align:right}
.phases{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:var(--r);overflow:hidden}
.ph{background:var(--surface);padding:14px 15px 16px;display:flex;flex-direction:column;gap:10px}.ph>h3{margin:0;display:flex;align-items:baseline;justify-content:space-between;gap:8px}.ph .code{font-family:var(--mono);font-size:13px;font-weight:600}
.chip{font-family:var(--mono);font-size:10px;letter-spacing:.04em;padding:2px 6px;border-radius:3px;background:var(--surface-2);color:var(--muted);white-space:nowrap}.chip.all-done{background:var(--pine-soft);color:var(--pine)}.chip.none{color:var(--faint)}
.mod{display:grid;grid-template-columns:34px minmax(0,1fr);gap:8px}.mod .p{font-family:var(--mono);font-size:11.5px;text-align:right;font-variant-numeric:tabular-nums;color:var(--muted)}.mod.z .p{color:var(--faint)}.mod.paused{opacity:.62}
.mod .t{min-width:0}.mod .t b{font-weight:500;font-size:12.5px;display:block;line-height:1.3}.mod .meta{display:flex;flex-wrap:wrap;gap:5px;align-items:center;font-family:var(--mono);font-size:10.5px;color:var(--faint);margin-top:2px}
.mod .next{display:block;font-size:11.5px;color:var(--muted);margin-top:3px}.mod .track{display:block;height:5px;margin-top:5px;background:var(--surface-2);border-radius:2px;overflow:hidden}.mod .track i{display:block;height:100%}
.h{padding:1px 5px;border-radius:3px;font-weight:500}.h-on_track{background:var(--pine-soft);color:var(--pine)}.h-at_risk{background:var(--amber-soft);color:var(--amber)}.h-blocked{background:var(--stop-soft);color:var(--stop)}.h-paused{background:var(--surface-2);color:var(--faint)}
.bb{color:var(--stop)}.lb{color:var(--pine)}.also{color:var(--faint)}
.f-done{background:var(--pine)}.f-part{background:var(--amber)}.f-zero{background:var(--idle)}
.tracks{display:flex;flex-wrap:wrap;gap:12px 24px;margin-top:16px}.trk{display:flex;align-items:center;gap:8px;font-size:12.5px}.trk .e{font-size:15px;line-height:1}.trk .track{display:block;width:56px;height:5px;background:var(--surface-2);border-radius:2px;overflow:hidden}.trk .track i{display:block;height:100%}.trk .v{font-family:var(--mono);font-size:11.5px;font-variant-numeric:tabular-nums;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:7px 10px 7px 0;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);font-weight:500}td.n,th.n{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;padding-right:0}td.n.up{color:var(--pine)}td.n.flat{color:var(--faint)}.mono{font-family:var(--mono);font-size:12px}tr.over td{background:var(--stop-soft)}
.scroll{overflow-x:auto}.cols{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:24px;align-items:start}@media(max-width:760px){.cols{grid-template-columns:minmax(0,1fr)}}
.lanes{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}.lane{border:1px solid var(--line);border-radius:var(--r);padding:10px 12px;font-size:12.5px}.lane b{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin-bottom:4px}.lane .warn{color:var(--stop);font-weight:500}
footer{border-top:1px solid var(--line);padding-top:16px;font-size:12.5px;color:var(--muted)}footer code{font-family:var(--mono);background:var(--surface-2);padding:1px 5px;border-radius:3px}
</style>
<div class="wrap">
<header>
  <p class="eyebrow">sinh bởi node tools/progress.mjs --render · không chép tay</p>
  <h1>Plexco — bảng theo dõi giao hàng</h1>
  <p class="stamp">${esc(d.generatedAt.slice(0, 10))} · <b>${esc(d.ref)}@${esc(d.sha)}</b> · ROADMAP <b>${esc(d.roadmapVersion ?? "?")}</b> pin <b>${esc(d.pin ?? "?")}</b> · modules.json pin <b>${esc(d.modulesPin ?? "?")}</b></p>
  <div class="verdict ${d.carryFiles === 0 ? "ok" : ""}"><span class="tag">${d.carryFiles === 0 ? "PIN CÒN HIỆU LỰC" : "PIN MỤC"}</span><p>${
    d.carryFiles === 0
      ? `<code>git diff --name-only ${esc(d.pin)}..${esc(d.ref)} -- packages apps scripts</code> trả rỗng ⇒ số cấu trúc còn đúng. Trục Tests có authority riêng (canonical runner).`
      : `<code>git diff --name-only ${esc(d.pin)}..${esc(d.ref)} -- packages apps scripts</code> trả <b>${d.carryFiles} file</b> ⇒ không trích số của ROADMAP vào verdict; chạy lại gate rồi re-pin.`
  }</p></div>
</header>

<section class="heads">
  <div class="head"><span class="label">BE readiness cho phase-1 — trục Migration · BE · Tests, ${hb.beModules} module phase-1</span><span class="num">${hb.be}%</span><span class="big"><i class="${fill(hb.be)}" style="width:${hb.be}%"></i></span><span class="why">Thanh này nhích mỗi khi một lane BE land. Đây là thứ đang thật sự tiến.</span></div>
  <div class="head"><span class="label">Launch readiness — ${hb.launchModules} module của 5 khối DD-113, trục yếu nhất (luật 5)</span><span class="num">${hb.launch}%</span><span class="big"><i class="${fill(hb.launch)}" style="width:${Math.max(hb.launch, 1)}%"></i></span><span class="why">Chỉ nhích khi FE nhích. Đứng yên = cái giá của O1, nói thẳng.</span></div>
  <div class="head quiet"><span class="label">Thanh slice roadmap (ROADMAP giữ tay, thang riêng)</span><span class="num">${esc(d.roadmapHeadline ?? "?")}</span><span class="why">Trích nguyên văn, không tính lại.</span></div>
</section>

<section class="panel">
  <header><h2>Phase → module: cái nào đã xong ở đâu</h2><span class="note">docs/project/modules.json<br>thanh = máy · health = owner</span></header>
  <div class="phases">
${phaseCards}
  </div>
  <div class="tracks">
${trackRow}
  </div>
</section>

<div class="cols">
<section class="panel">
  <header><h2>Inbox quyết định của owner</h2><span class="note">docs/project/decisions-inbox.json<br>đỏ = có mặc định và quá 21 ngày</span></header>
  <div class="scroll"><table><thead><tr><th>ID</th><th>Câu hỏi</th><th>Chặn gì</th><th>Mặc định</th><th class="n">Tuổi</th></tr></thead><tbody>
${inboxRows || `<tr><td colspan="5" style="color:var(--faint)">chưa có docs/project/decisions-inbox.json</td></tr>`}
  </tbody></table></div>
</section>
<div style="display:flex;flex-direction:column;gap:24px;min-width:0">
<section class="panel">
  <header><h2>Làn</h2><span class="note">ai đang làm gì</span></header>
  <div class="lanes">
    <div class="lane"><b>level3 · supervised</b>${lanes.level3 ?? "—"}</div>
    <div class="lane"><b>ap3 · headless</b>${lanes.ap3 ?? "—"}</div>
    <div class="lane"><b>owner · việc tay</b>${lanes.owner ?? "—"}</div>
    <div class="lane"><b>external</b>${lanes.external ?? "—"}</div>
  </div>
</section>
<section class="panel">
  <header><h2>Số đo: tại pin vs tại ref</h2></header>
  <div class="scroll"><table><thead><tr><th>Hạng mục</th><th class="n">pin</th><th class="n">ref</th><th class="n">Δ</th></tr></thead><tbody>
${countsRows}
  </tbody></table></div>
  <p style="font-size:12px;color:var(--faint);margin:10px 0 0">7 ngày: ${d.recent.commits} commit · ${d.recent.merges} PR merge</p>
</section>
</div>
</div>

<footer>Board này là file sinh ra: <code>node tools/progress.mjs --render</code> đọc <code>docs/project/modules.json</code> + git + ap3 state. Sửa dữ liệu ở JSON, không sửa HTML. Trục (thanh) là máy chấm theo LUẬT THANH; health/next/blocked_by là phán đoán của owner, đặt mỗi tuần.</footer>
</div>
`;
}
