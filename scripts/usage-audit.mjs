#!/usr/bin/env node
// Claude Code usage audit for the Compy lanes (born 2026-07-13, owner-requested).
// Streams every session transcript under ~/.claude/projects (newest N), plus all subagent
// transcripts, and prints an aggregate usage report: token spend (deduped by message.id —
// the harness writes one JSONL line per content block, repeating `usage`), tool mix,
// context-size discipline, subagent model routing, boot-tax hotspots, and error classes.
//
// Zero tokens: pure node, no LLM. Run it directly or via the weekly scheduled task.
//
//   node scripts/usage-audit.mjs                 -> stdout report, 80 newest sessions
//   node scripts/usage-audit.mjs --sessions 120  -> widen the window
//   node scripts/usage-audit.mjs --report        -> also write docs/usage-audit/REPORT-<date>.md
//
// Health flags it raises (the audit's standing findings, 2026-07-13):
//   - any session's peak main-lane context past CLAUDE_CODE_AUTO_COMPACT_WINDOW (flagPeakContext();
//     compaction itself fires below it, at nativeCompactCeiling()) — owner rule: hand off at 80-120k
//   - subagent runs on opus/fable (routing law: cheapest capable model, sonnet default)
//   - docs/BACKLOG.md > 120 KB (boot tax — archive steering-log cycles per its retention rule)
//   - "File has not been read yet" Edit errors (read-before-edit discipline)
//   - any worktree's src-tauri/target over ~20 GB (build-output bloat, report-only, 2026-08-20)

import { createReadStream, readdirSync, statSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import {
  describeWindow,
  flagPeakContext,
  loadProjectSettings,
  resolveCompactionWindow,
  usableHeadroom,
} from "./lib/compaction-window.mjs";
import { diskBloatFlags } from "./lib/disk-bloat.mjs";

const ROOT = join(homedir(), ".claude", "projects");
// USAGE_AUDIT_REPO exists so the audit can be exercised against the real repo from a scratch
// checkout without editing the live tree. Production path is unchanged when it is unset.
const REPO = process.env.USAGE_AUDIT_REPO || join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const N = (() => { const i = argv.indexOf("--sessions"); return i >= 0 ? parseInt(argv[i + 1], 10) : 80; })();
const WRITE_REPORT = argv.includes("--report");

const dirs = readdirSync(ROOT).map((d) => join(ROOT, d)).filter((d) => { try { return statSync(d).isDirectory(); } catch { return false; } });
const sessions = dirs.flatMap((dir) => {
  let files = [];
  try { files = readdirSync(dir); } catch { return []; }
  return files.filter((f) => f.endsWith(".jsonl")).map((f) => {
    const p = join(dir, f); const st = statSync(p);
    return { path: p, file: f, dir: basename(dir), size: st.size, mtime: st.mtimeMs };
  });
}).sort((a, b) => b.mtime - a.mtime).slice(0, N);

const top = (o, n = 20) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
const M = (x) => (x / 1e6).toFixed(1) + "M";
const K = (x) => (x / 1e3).toFixed(0) + "k";

async function scanSession(t) {
  const seen = new Set();
  // firstCtx: the FIRST recorded turn's total — all fixed payload, no conversation. It is the floor
  // half of `headroom = ceiling − floor`, and until 2026-08-07 nothing measured it, which is how the
  // floor grew 55k → 77k across three weeks with the audit reporting nothing.
  const s = { date: "", file: t.file.slice(0, 8), sizeMB: +(t.size / 1048576).toFixed(1), out: 0, cacheRead: 0, cacheWrite: 0, peakCtx: 0, firstCtx: 0, msgs: 0, wallMin: 0, models: {}, firstPrompt: "" };
  const agg = { tools: {}, bash: {}, skills: {}, readPaths: {}, errBuckets: {}, notReadErrs: 0 };
  let firstTs = null, lastTs = null;
  const rl = createInterface({ input: createReadStream(t.path, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.timestamp) { if (!firstTs) firstTs = j.timestamp; lastTs = j.timestamp; }
    const m = j.message;
    if (!m || j.isSidechain) continue;
    if (j.type === "assistant") {
      const id = m.id || j.uuid;
      if (m.usage && !seen.has(id)) {
        seen.add(id); s.msgs++;
        s.out += m.usage.output_tokens || 0;
        s.cacheRead += m.usage.cache_read_input_tokens || 0;
        s.cacheWrite += m.usage.cache_creation_input_tokens || 0;
        const ctx = (m.usage.cache_read_input_tokens || 0) + (m.usage.cache_creation_input_tokens || 0) + (m.usage.input_tokens || 0);
        if (ctx > s.peakCtx) s.peakCtx = ctx;
        if (!s.firstCtx && ctx > 0) s.firstCtx = ctx;
        s.models[m.model || "?"] = (s.models[m.model || "?"] || 0) + 1;
      }
      for (const c of Array.isArray(m.content) ? m.content : []) {
        if (c.type !== "tool_use") continue;
        agg.tools[c.name] = (agg.tools[c.name] || 0) + 1;
        if (c.name === "Bash" || c.name === "PowerShell") {
          const head = String(c.input?.command || "").trim().split(/\s+/).slice(0, 2).join(" ").slice(0, 40);
          agg.bash[head] = (agg.bash[head] || 0) + 1;
        }
        if (c.name === "Skill") agg.skills[c.input?.skill || "?"] = (agg.skills[c.input?.skill || "?"] || 0) + 1;
        if (c.name === "Read" && c.input?.file_path) {
          const p = String(c.input.file_path).replace(/\\/g, "/");
          agg.readPaths[p] = (agg.readPaths[p] || 0) + 1;
        }
      }
    } else if (j.type === "user" && Array.isArray(m.content)) {
      for (const c of m.content) {
        if (c.type === "tool_result" && c.is_error) {
          let txt = typeof c.content === "string" ? c.content : Array.isArray(c.content) ? c.content.map((x) => x.text || "").join(" ") : "";
          txt = txt.replace(/\s+/g, " ").trim();
          if (/has not been read yet/i.test(txt)) agg.notReadErrs++;
          const key = txt.replace(/[A-Za-z]:[\\/][^\s'"]+/g, "<path>").replace(/\d+/g, "N").slice(0, 80);
          if (key) agg.errBuckets[key] = (agg.errBuckets[key] || 0) + 1;
        } else if (c.type === "text" && c.text && !c.text.startsWith("<") && !s.firstPrompt) {
          s.firstPrompt = c.text.slice(0, 70).replace(/\s+/g, " ");
        }
      }
      if (typeof m.content === "string" && !m.content.startsWith("<") && !s.firstPrompt) s.firstPrompt = m.content.slice(0, 70).replace(/\s+/g, " ");
    }
  }
  if (firstTs && lastTs) { s.date = firstTs.slice(0, 10); s.wallMin = Math.round((new Date(lastTs) - new Date(firstTs)) / 60000); }
  return { s, agg };
}

async function scanAgents() {
  const out = { byModel: {}, byType: {}, offRouted: 0, total: 0 };
  for (const proj of dirs) {
    let entries = [];
    try { entries = readdirSync(proj); } catch { continue; }
    for (const e of entries) {
      const sub = join(proj, e, "subagents");
      let files = [];
      try { files = readdirSync(sub); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue;
        out.total++;
        let meta = {};
        try { meta = JSON.parse(readFileSync(join(sub, f.replace(".jsonl", ".meta.json")), "utf8")); } catch { /* ok */ }
        const seen = new Set(); const models = {};
        let outTok = 0;
        const rl = createInterface({ input: createReadStream(join(sub, f), "utf8"), crlfDelay: Infinity });
        for await (const line of rl) {
          if (!line.trim()) continue;
          let j; try { j = JSON.parse(line); } catch { continue; }
          const m = j.message;
          if (j.type === "assistant" && m?.usage) {
            const id = m.id || j.uuid;
            if (seen.has(id)) continue; seen.add(id);
            outTok += m.usage.output_tokens || 0;
            models[m.model || "?"] = (models[m.model || "?"] || 0) + 1;
          }
        }
        const mdl = top(models, 1)[0]?.[0] || "?";
        const type = meta.subagentType || meta.agentType || meta.label || "?";
        out.byModel[mdl] = out.byModel[mdl] || { n: 0, out: 0 };
        out.byModel[mdl].n++; out.byModel[mdl].out += outTok;
        out.byType[type] = out.byType[type] || { n: 0, out: 0 };
        out.byType[type].n++; out.byType[type].out += outTok;
        if (/opus|fable/.test(mdl)) out.offRouted++;
      }
    }
  }
  return out;
}

// ---- run ----
const g = { out: 0, cacheRead: 0, cacheWrite: 0, msgs: 0, tools: {}, bash: {}, skills: {}, readPaths: {}, errBuckets: {}, notReadErrs: 0, models: {} };
const rows = [];
for (const t of sessions) {
  const { s, agg } = await scanSession(t);
  rows.push(s);
  g.out += s.out; g.cacheRead += s.cacheRead; g.cacheWrite += s.cacheWrite; g.msgs += s.msgs;
  g.notReadErrs += agg.notReadErrs;
  for (const [k, v] of Object.entries(agg.tools)) g.tools[k] = (g.tools[k] || 0) + v;
  for (const [k, v] of Object.entries(agg.bash)) g.bash[k] = (g.bash[k] || 0) + v;
  for (const [k, v] of Object.entries(agg.skills)) g.skills[k] = (g.skills[k] || 0) + v;
  for (const [k, v] of Object.entries(agg.readPaths)) g.readPaths[k] = (g.readPaths[k] || 0) + v;
  for (const [k, v] of Object.entries(agg.errBuckets)) g.errBuckets[k] = (g.errBuckets[k] || 0) + v;
  for (const [k, v] of Object.entries(s.models)) g.models[k] = (g.models[k] || 0) + v;
}
const agents = await scanAgents();

const flags = [];

// The window-relative peak flag. `flagPeakContext` was written as the bug→guard for issue #16 —
// the hard-coded `peakCtx > 200_000` that fired on healthy sessions — but it was never actually
// wired in here, so the literal it replaced stayed live and the guard test guarded a function
// nothing called. Wired 2026-08-07.
const windowInfo = resolveCompactionWindow({ env: process.env, settings: loadProjectSettings(REPO) });
// CLAUDE_CODE_AUTO_COMPACT_WINDOW did not exist before this date; sessions older than it ran on the
// model default and peaked as high as 514k. Counting them re-raises a fixed problem every Monday.
const WINDOW_CONFIGURED_SINCE = "2026-08-07";
const peak = flagPeakContext(rows, windowInfo, { configuredSince: WINDOW_CONFIGURED_SINCE });
if (peak.flag) flags.push(peak.flag);
else if (peak.note) flags.push(peak.note);

// The floor flag, and the one that would have caught the August thrash three weeks early: a session
// opens with its fixed payload, so a rising first turn silently eats the room to work in.
const floors = rows.map((r) => r.firstCtx).filter((n) => n > 0).sort((a, b) => a - b);
const floorP75 = floors.length >= 3 ? floors[Math.floor(floors.length * 0.75)] : 0;
const room = floorP75 ? usableHeadroom(windowInfo, floorP75) : null;
if (room && !room.ok) {
  flags.push(
    `🔴 ${room.reason} Sessions are configured to thrash: ${floors.length} measured floors, p75 ${K(floorP75)}, ` +
      `worst ${K(floors[floors.length - 1])}. Raise CLAUDE_CODE_AUTO_COMPACT_WINDOW or cut the per-turn payload.`,
  );
}
if (agents.offRouted) flags.push(`🟡 ${agents.offRouted}/${agents.total} subagent runs on opus/fable (routing law: cheapest capable model). Check spawn sites pass no model override.`);

// ---------------------------------------------------------------------------------------------
// COST MODEL (added 2026-08-18). Until now this report counted tokens and flagged nothing about
// what they COST — so every control the repo owns pointed at output, which the first weighted
// measurement showed is only ~16% of the bill. Weights are the published price ratios normalised
// to one base-input token (platform.claude.com/docs/en/build-with-claude/prompt-caching):
//   cache read 0.1x · cache write 2.0x at the 1h TTL Claude Code auto-requests on a subscription ·
//   output 5x for Opus-class. They are ratios, not dollars: the shares are what matter.
const COST_W = { read: 0.1, write: 2.0, out: 5.0, input: 1.0 };
const spend = {
  "carried context (cache-read)": g.cacheRead * COST_W.read,
  "prefix build (cache-write)": g.cacheWrite * COST_W.write,
  "new work (output + thinking)": g.out * COST_W.out,
};
const spendTotal = Object.values(spend).reduce((a, b) => a + b, 0) || 1;
const ctxShare = 100 * (spend["carried context (cache-read)"] + spend["prefix build (cache-write)"]) / spendTotal;
const carriedPerTurn = g.cacheRead / Math.max(1, g.msgs);

// The control that was missing entirely: carried context per turn, against the real ceiling.
// A session that habitually runs near the ceiling pays that whole context back on every turn.
const ceiling = room ? room.ceiling : 0;
if (ceiling && carriedPerTurn > 0.55 * ceiling) {
  flags.push(
    `🔴 avg carried context ${K(carriedPerTurn)}/turn is ${(100 * carriedPerTurn / ceiling).toFixed(0)}% of the ` +
      `${K(ceiling)} compaction ceiling. Carried context is ${ctxShare.toFixed(0)}% of measured spend — ` +
      `every turn re-reads it. Lever order: /clear between unrelated tasks · cut the per-turn floor · ` +
      `lower CLAUDE_CODE_AUTO_COMPACT_WINDOW so the ceiling itself is lower.`,
  );
} else if (ceiling) {
  flags.push(`🟢 avg carried context ${K(carriedPerTurn)}/turn = ${(100 * carriedPerTurn / ceiling).toFixed(0)}% of the ${K(ceiling)} ceiling.`);
}

// Doc boot tax, in BYTES. These are TARGETS, not the gate. The gate is $byteBudgets in
// scripts/doc-budget.ps1, and for three docs it currently holds a RATCHET (their 2026-08-18 size)
// rather than the target, because bringing them down is a content call. Deliberately two different
// numbers with two different jobs: the gate blocks growth, this line keeps nagging toward the goal.
// Naming them both "budget" is how docs drift, so this one says target and points at the gate.
//
// The line budgets in scripts/doc-budget.ps1 are structurally blind to bytes:
// docs/BACKLOG.md passed 1286/1400 lines while weighing 142 KB, because a line budget cannot see a
// 113-byte average line. Tokens are charged by bytes, so the boot-tax budget is in bytes.
// 48 KB is not invented: it is MAX_UNBOUNDED_BYTES in .claude/hooks/big-read-guard.mjs — the point
// past which this repo already refuses to read a file whole. BACKLOG is read by section by law, so
// it keeps the wider 120 KB line this audit has always used.
const DOC_BYTE_BUDGETS = [
  ["docs/BACKLOG.md", 120 * 1024, "archive old steering-log cycles to docs/BACKLOG_ARCHIVE.md per its retention rule"],
  ["docs/RELEASE_STATE.md", 48 * 1024, "past big-read-guard's own unbounded-read budget — it can no longer be read whole"],
  // 20 KB ≈ Anthropic's published "keep CLAUDE.md under ~200 lines" at this repo's ~110 bytes/line
  // (code.claude.com/docs/en/costs). It is auto-loaded on every boot of every session, so it is the
  // most expensive byte in the repo.
  ["CLAUDE.md", 20 * 1024, "auto-loaded on every session boot; move detail into a skill"],
  ["docs/OWNER_ACTION_CHECKLIST.md", 48 * 1024, "archive completed items"],
];
for (const [rel, budget, advice] of DOC_BYTE_BUDGETS) {
  try {
    const sz = statSync(join(REPO, rel)).size;
    if (sz > budget) flags.push(`🟡 ${rel} is ${(sz / 1024).toFixed(1)} KB (> ${(budget / 1024).toFixed(0)} KB byte TARGET; the gate's current ratchet is in scripts/doc-budget.ps1) — ${advice}.`);
  } catch { /* absent is not a failure */ }
}

// BUILD-OUTPUT BLOAT (added 2026-08-20, owner-requested). The block above nags in kilobytes; this
// one is the same report noticing that Rust build output on the same disk is measured in gigabytes.
// Report-only by construction — see scripts/lib/disk-bloat.mjs, whose guard test pins that it never
// deletes and that it reads worktree roots from .git rather than spawning git.exe (a spawn from the
// Monday scheduled task would flash a console window, the defect console-window-guard.test.mjs
// exists to prevent).
flags.push(...diskBloatFlags(REPO));
// FLOOR TREND (added 2026-08-18, bug→guard). The defect: the fixed per-turn floor stepped from a
// 53k median to 83k in a single day (2026-08-04, a settings rewrite + a plugin update) and no
// instrument said a word for eleven days — the absolute-breach flag only fires once headroom is
// already gone, which at the corrected 217k ceiling is months away. The floor is re-read on EVERY
// turn: at a 66k floor against 110k avg carried context it is ~60% of all cache-read, which is
// ~27% of measured spend. A step change in it is the most expensive silent event in the system.
try {
  const outDir = join(REPO, "docs", "usage-audit");
  const today = new Date().toISOString().slice(0, 10);
  const prior = readdirSync(outDir)
    .filter((f) => /^REPORT-\d{4}-\d{2}-\d{2}\.md$/.test(f) && !f.includes(today))
    .sort()
    .pop();
  if (prior && floorP75) {
    const m = readFileSync(join(outDir, prior), "utf8").match(/fixed floor p75 \*\*(\d+)k\*\*/);
    const was = m ? Number(m[1]) * 1000 : 0;
    if (was) {
      const delta = floorP75 - was;
      if (delta >= 8_000) {
        flags.push(
          `🔴 per-turn floor rose ${K(delta)} since ${prior.slice(7, 17)} (${K(was)} → ${K(floorP75)}). ` +
            `The floor is re-read on every turn, so this is a permanent tax on every session until it is ` +
            `cut. Check what changed: settings/env, an added plugin or MCP server, a grown auto-loaded ` +
            `CLAUDE.md, new skills or agents. Compare against docs/usage-audit/${prior}.`,
        );
      } else if (delta <= -8_000) {
        flags.push(`🟢 per-turn floor FELL ${K(-delta)} since ${prior.slice(7, 17)} (${K(was)} → ${K(floorP75)}) — whatever was done, it worked.`);
      }
    }
  }
} catch { /* no prior report is not a failure */ }

if (g.notReadErrs > rows.length) flags.push(`🟡 ${g.notReadErrs} "file not read yet" Edit errors (> 1/session avg) — Read before Edit, even for files known from prior sessions.`);
if (!flags.length) flags.push("🟢 No health flags — context discipline, subagent routing, boot tax, and edit discipline all within bounds.");

const lines = [];
lines.push(`# Usage audit — ${new Date().toISOString().slice(0, 10)} (${rows.length} newest sessions)`);
lines.push("");
lines.push(`Main-lane totals: **${M(g.out)} output** · **${(g.cacheRead / 1e9).toFixed(2)}B cache-read** · ${M(g.cacheWrite)} cache-write · ${g.msgs} assistant msgs`);
lines.push(`Avg carried context: **${K(g.cacheRead / Math.max(1, g.msgs))}/turn** (cache-read per assistant msg)`);
lines.push(
  `Compaction window: ${describeWindow(windowInfo)}` +
    (room ? ` · fixed floor p75 **${K(room.floor)}** → working headroom **${K(room.headroom)}**${room.ok ? "" : " 🔴"}` : ""),
);
// The floor metric is the FIRST recorded turn, which also contains the opening prompt. A session
// opened with a pasted skill body or handoff reports a higher "floor" than one opened with "hi".
// The spread is how much of the number is payload and how much is the opening — print it rather
// than let a contaminated p75 drive a window decision again (it did, on 2026-08-07).
if (floors.length >= 4) {
  const q = (f) => floors[Math.min(floors.length - 1, Math.floor(floors.length * f))];
  lines.push(
    `First-turn spread: p25 **${K(q(0.25))}** · median ${K(q(0.5))} · p75 ${K(q(0.75))} · max ${K(floors[floors.length - 1])} ` +
      `(p25 is the cleanest estimate of the true fixed floor; higher quantiles include the opening prompt).`,
  );
}
lines.push("");
lines.push("## Where the money goes (cost-weighted, not raw counts)");
for (const [k, v] of Object.entries(spend).sort((a, b) => b[1] - a[1])) {
  lines.push(`- **${(100 * v / spendTotal).toFixed(1)}%** ${k}`);
}
lines.push(`- carried context (read + write) = **${ctxShare.toFixed(0)}%** of spend. Optimise context, not verbosity.`);
lines.push("");
lines.push("## Health flags");
for (const f of flags) lines.push(`- ${f}`);
lines.push("");
lines.push("## Sessions (newest first)");
lines.push("| date | MB | floor | peakCtx | out | wall | model | first prompt |");
lines.push("|---|---|---|---|---|---|---|---|");
for (const r of rows.slice(0, 30)) lines.push(`| ${r.date} | ${r.sizeMB} | ${K(r.firstCtx)} | ${K(r.peakCtx)} | ${K(r.out)} | ${r.wallMin}m | ${(top(r.models, 1)[0]?.[0] || "-").replace("claude-", "")} | ${r.firstPrompt.replace(/\|/g, "/")} |`);
lines.push("");
lines.push("## Tool mix");
lines.push(top(g.tools, 15).map(([k, v]) => `${k}:${v}`).join(" · "));
lines.push("");
lines.push("## Top Bash/PS heads");
lines.push(top(g.bash, 15).map(([k, v]) => `\`${k}\`:${v}`).join(" · "));
lines.push("");
lines.push("## Skills invoked");
lines.push(top(g.skills, 15).map(([k, v]) => `${k}:${v}`).join(" · ") || "(none)");
lines.push("");
lines.push("## Subagents");
lines.push(`total ${agents.total} · by model: ` + top(agents.byModel, 6).map(([k, v]) => `${k.replace("claude-", "")} n=${v.n} out=${K(v.out)}`).join(" · "));
lines.push(`by type: ` + top(agents.byType, 8).map(([k, v]) => `${k}:${v.n}`).join(" · "));
lines.push("");
lines.push("## Top Read paths (boot tax)");
for (const [k, v] of top(g.readPaths, 12)) lines.push(`- ${v}× ${k.replace(/^.*?code\/sentinel\//, "")}`);
lines.push("");
lines.push("## Error classes (top 12)");
for (const [k, v] of top(g.errBuckets, 12)) lines.push(`- ${v}× ${k}`);

const report = lines.join("\n") + "\n";
console.log(report);

if (WRITE_REPORT) {
  const outDir = join(REPO, "docs", "usage-audit");
  mkdirSync(outDir, { recursive: true });
  const dated = join(outDir, `REPORT-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(dated, report);
  writeFileSync(join(outDir, "LATEST.md"), report);
  console.log(`\n[written] ${dated} (+ LATEST.md)`);
}
