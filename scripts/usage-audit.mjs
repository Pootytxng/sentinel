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
//   - peak main-lane context > 200k in any session (owner rule: hand off at 80-120k)
//   - subagent runs on opus/fable (routing law: cheapest capable model, sonnet default)
//   - docs/BACKLOG.md > 120 KB (boot tax — archive steering-log cycles per its retention rule)
//   - "File has not been read yet" Edit errors (read-before-edit discipline)

import { createReadStream, readdirSync, statSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const ROOT = join(homedir(), ".claude", "projects");
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
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
  const s = { date: "", file: t.file.slice(0, 8), sizeMB: +(t.size / 1048576).toFixed(1), out: 0, cacheRead: 0, cacheWrite: 0, peakCtx: 0, msgs: 0, wallMin: 0, models: {}, firstPrompt: "" };
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
const hot = rows.filter((r) => r.peakCtx > 200_000);
if (hot.length) flags.push(`🔴 ${hot.length}/${rows.length} sessions ran past 200k context (owner rule: hand off at 80-120k). Worst: ${hot.slice(0, 3).map((r) => `${r.date} ${K(r.peakCtx)}`).join(", ")}. Cache-read cost per turn scales with carried context.`);
if (agents.offRouted) flags.push(`🟡 ${agents.offRouted}/${agents.total} subagent runs on opus/fable (routing law: cheapest capable model). Check spawn sites pass no model override.`);
try {
  const bl = statSync(join(REPO, "docs", "BACKLOG.md")).size;
  if (bl > 120 * 1024) flags.push(`🟡 docs/BACKLOG.md is ${(bl / 1024).toFixed(0)} KB (> 120 KB boot-tax line) — archive old steering-log cycles to docs/BACKLOG_ARCHIVE.md per its retention rule.`);
} catch { /* ok */ }
if (g.notReadErrs > rows.length) flags.push(`🟡 ${g.notReadErrs} "file not read yet" Edit errors (> 1/session avg) — Read before Edit, even for files known from prior sessions.`);
if (!flags.length) flags.push("🟢 No health flags — context discipline, subagent routing, boot tax, and edit discipline all within bounds.");

const lines = [];
lines.push(`# Usage audit — ${new Date().toISOString().slice(0, 10)} (${rows.length} newest sessions)`);
lines.push("");
lines.push(`Main-lane totals: **${M(g.out)} output** · **${(g.cacheRead / 1e9).toFixed(2)}B cache-read** · ${M(g.cacheWrite)} cache-write · ${g.msgs} assistant msgs`);
lines.push(`Avg carried context: **${K(g.cacheRead / Math.max(1, g.msgs))}/turn** (cache-read per assistant msg)`);
lines.push("");
lines.push("## Health flags");
for (const f of flags) lines.push(`- ${f}`);
lines.push("");
lines.push("## Sessions (newest first)");
lines.push("| date | MB | peakCtx | out | wall | model | first prompt |");
lines.push("|---|---|---|---|---|---|---|");
for (const r of rows.slice(0, 30)) lines.push(`| ${r.date} | ${r.sizeMB} | ${K(r.peakCtx)} | ${K(r.out)} | ${r.wallMin}m | ${(top(r.models, 1)[0]?.[0] || "-").replace("claude-", "")} | ${r.firstPrompt.replace(/\|/g, "/")} |`);
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
