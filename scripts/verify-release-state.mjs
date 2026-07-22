#!/usr/bin/env node
// verify-release-state.mjs — mechanized layer-1 of the gate-drift audit (.claude/skills/gate-drift-audit).
//
// RELEASE_STATE.md exists because an external audit named state/doc drift the project's #1 risk; its
// contract is "every row carries a file:line so it can be re-verified in seconds". This script does that
// re-verification: it parses every backticked `path:line` citation, resolves the file, and checks that the
// bound symbol (e.g. `gaming_mode_gate()` — `lib.rs:500`) still lives at/near the cited line. It catches
// the c056fee class of drift (code moved, citation stale) mechanically instead of by hand.
//
// It checks LOCATION, not TRUTH — a gate that flipped value with an unchanged line number still needs the
// layer-2 source re-read (see the skill). Run from anywhere: node scripts/verify-release-state.mjs [--strict]
//   exit 0 = all citations anchored (NEAR drift ≤40 lines warns unless --strict)
//   exit 1 = any MISSING-FILE / LINE-OOB / DRIFT / GONE (or NEAR under --strict),
//            OR zero citations found, OR a required section is missing entirely.
// The last two guard the f21c170 class (2026-07-22: a doc diet accidentally cut the live Gate matrix +
// Release blockers; the verifier passed vacuously on the gutted file). An empty contract is a failure.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = join(ROOT, "docs", "RELEASE_STATE.md");
const STRICT = process.argv.includes("--strict");
const NEAR_WINDOW = 40; // lines of tolerated drift before it's a failure
const EXACT_WINDOW = 3; // lines still considered "anchored"

const docLines = readFileSync(DOC, "utf8").split(/\r?\n/);

// --- file resolution ---------------------------------------------------------------------------
const SEARCH_DIRS = ["src", "src-tauri/src", "src-tauri", "docs", "scripts"];
const SKIP = new Set(["node_modules", "target", "dist", "dist-web", "dist-site", ".git", "worktrees", "archive"]);
const basenameIndex = new Map(); // basename -> [relpaths]
function walk(rel, depth) {
  if (depth > 6) return;
  let entries;
  try { entries = readdirSync(join(ROOT, rel)); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e)) continue;
    const r = rel ? `${rel}/${e}` : e;
    let st;
    try { st = statSync(join(ROOT, r)); } catch { continue; }
    if (st.isDirectory()) walk(r, depth + 1);
    else {
      if (!basenameIndex.has(e)) basenameIndex.set(e, []);
      basenameIndex.get(e).push(r);
    }
  }
}
for (const d of SEARCH_DIRS) walk(d, 0);

function resolveFile(p) {
  const norm = p.replace(/\\/g, "/");
  const candidates = [norm, `src-tauri/src/${norm}`, `src/${norm}`, `docs/${norm}`, `scripts/${norm}`, `src-tauri/${norm}`];
  for (const c of candidates) if (existsSync(join(ROOT, c))) return c;
  const hits = basenameIndex.get(basename(norm)) || [];
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    // prefer the conventional home for the extension
    const pref = norm.endsWith(".rs") ? hits.find((h) => h.startsWith("src-tauri/src/")) : hits.find((h) => h.startsWith("src/"));
    return pref || hits[0];
  }
  return null;
}

// --- citation extraction -----------------------------------------------------------------------
// shapes: `sym()` — `file:line`   ·   `sym` `file:line`   ·   `file:line`→`mod::sym`   ·   bare `file:line`
// comma-chained citations (`a.rs:1`, `b.rs:2`) inherit the previous citation's symbol.
const TOKEN = /`([\w./\\-]+\.(?:rs|tsx?|mjs|cjs|json|toml|md|css|ps1)):(\d+)`/g;
const citations = [];
docLines.forEach((line, li) => {
  let m;
  let prevSym = null;
  let prevEnd = -1;
  while ((m = TOKEN.exec(line)) !== null) {
    const [tok, file, ln] = m;
    let sym = null;
    const before = line.slice(Math.max(0, m.index - 60), m.index);
    const gap = line.slice(prevEnd, m.index);
    const bound = before.match(/`([A-Za-z_][\w:]*)(\(\))?`\s*(?:—|–|-|:)?\s*$/); // adjacent-left symbol
    const arrow = line.slice(m.index + tok.length, m.index + tok.length + 40).match(/^\s*`?→`?\s*`([A-Za-z_][\w:]*)`/);
    if (bound) sym = bound[1];
    else if (arrow) sym = arrow[1];
    else if (prevSym !== null && prevEnd >= 0 && /^,\s*$/.test(gap)) sym = prevSym; // comma chain
    if (sym) sym = sym.split("::").pop().replace(/\(\)$/, "");
    citations.push({ docLine: li + 1, file, line: Number(ln), sym });
    prevSym = sym;
    prevEnd = m.index + tok.length;
  }
});

// --- verification ------------------------------------------------------------------------------
const fileCache = new Map();
function lines(rel) {
  if (!fileCache.has(rel)) fileCache.set(rel, readFileSync(join(ROOT, rel), "utf8").split(/\r?\n/));
  return fileCache.get(rel);
}
const results = [];
for (const c of citations) {
  const rel = resolveFile(c.file);
  if (!rel) { results.push({ ...c, verdict: "MISSING-FILE", detail: "file not found in repo" }); continue; }
  const src = lines(rel);
  if (c.line > src.length) { results.push({ ...c, rel, verdict: "LINE-OOB", detail: `file has ${src.length} lines` }); continue; }
  if (!c.sym) { results.push({ ...c, rel, verdict: "OK-FILE", detail: "no symbol bound; file+line in bounds" }); continue; }
  const hits = [];
  src.forEach((l, i) => { if (l.includes(c.sym)) hits.push(i + 1); });
  if (hits.length === 0) { results.push({ ...c, rel, verdict: "GONE", detail: `symbol '${c.sym}' absent from ${rel}` }); continue; }
  const nearest = hits.reduce((a, b) => (Math.abs(b - c.line) < Math.abs(a - c.line) ? b : a));
  const dist = Math.abs(nearest - c.line);
  if (dist <= EXACT_WINDOW) results.push({ ...c, rel, verdict: "OK", detail: `anchored (actual ${nearest})` });
  else if (dist <= NEAR_WINDOW) results.push({ ...c, rel, verdict: "NEAR", detail: `drifted ${dist} lines → re-anchor to ${rel}:${nearest}` });
  else results.push({ ...c, rel, verdict: "DRIFT", detail: `nearest '${c.sym}' at ${rel}:${nearest} (${dist} lines away)` });
}

// --- report ------------------------------------------------------------------------------------
const order = { "MISSING-FILE": 0, "LINE-OOB": 1, GONE: 2, DRIFT: 3, NEAR: 4, "OK-FILE": 5, OK: 6 };
results.sort((a, b) => order[a.verdict] - order[b.verdict] || a.docLine - b.docLine);
for (const r of results) {
  const cite = `${r.file}:${r.line}${r.sym ? ` (${r.sym})` : ""}`;
  console.log(`${r.verdict.padEnd(12)} RELEASE_STATE.md:${String(r.docLine).padEnd(4)} ${cite.padEnd(52)} ${r.detail}`);
}
const bad = results.filter((r) => ["MISSING-FILE", "LINE-OOB", "GONE", "DRIFT"].includes(r.verdict));
const near = results.filter((r) => r.verdict === "NEAR");

// --- structural coverage (the f21c170 guard) ---------------------------------------------------
const REQUIRED_SECTIONS = ["CURRENT STATE", "Gate matrix", "Release blockers"];
const missingSections = REQUIRED_SECTIONS.filter(
  (s) => !docLines.some((l) => /^#{1,3}\s/.test(l) && l.includes(s))
);
for (const s of missingSections) console.log(`MISSING-SECTION  '${s}' — required section absent from RELEASE_STATE.md`);
if (citations.length === 0) console.log("ZERO-COVERAGE    no `file:line` citations found — the matrix contract is empty");

console.log(`\n${results.length} citations: ${results.filter((r) => r.verdict.startsWith("OK")).length} ok · ${near.length} near-drift · ${bad.length} broken · ${missingSections.length} missing section(s)`);
if (bad.length || missingSections.length || citations.length === 0 || (STRICT && near.length)) {
  console.log("FIX-FORWARD: re-anchor each citation in the SAME commit as whatever moved it (precedent c056fee); restore any cut required section from the pre-diet copy.");
  process.exit(1);
}
