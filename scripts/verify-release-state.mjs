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
import { execFileSync } from "node:child_process";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

export function validateOwnerDecisionVersions(section, latestVersion, candidateVersion) {
  const failures = [];
  if (!section) return ["STALE-DECISION: Required owner decisions section is missing"];
  if (!candidateVersion) return ["STALE-DECISION: STATE:candidate_version anchor is missing"];

  const versionParts = (value) => value.split(".").map(Number);
  const compare = (left, right) => {
    const a = versionParts(left), b = versionParts(right);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const delta = (a[i] || 0) - (b[i] || 0);
      if (delta) return delta;
    }
    return 0;
  };
  if (latestVersion && compare(candidateVersion, latestVersion) < 0) {
    failures.push(
      `STALE-DECISION: candidate v${candidateVersion} is older than configured version ${latestVersion}`,
    );
  }

  const firstDecision = section.match(/^\s*1\.\s+\*\*([^\n]+)\*\*/m);
  const escapedCandidate = candidateVersion.replace(/\./g, "\\.");
  if (!firstDecision || !new RegExp(`\\bv?${escapedCandidate}\\b`).test(firstDecision[1])) {
    failures.push(
      `STALE-DECISION: first live owner decision must name candidate v${candidateVersion}`,
    );
  }
  return failures;
}

const IS_MAIN =
  !!process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (IS_MAIN) {
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

// --- CURRENT-STATE drift gates (Phase 4, 2026-07-23) -------------------------------------------
// Truth-repair layer: the citation checks above verify LOCATION; these verify that the current-state
// SUMMARY hasn't drifted from the live config, from itself, or from reality. Each reads a
// machine-readable `<!-- STATE:key=value -->` anchor, so the gate is deterministic, not regex-over-prose.
const docText = docLines.join("\n");
const liveRegion = docText.split(/^##\s+Gate matrix/m)[0]; // banners/bottom-lines live above the matrix
const anchor = (key) => {
  const m = docText.match(new RegExp(`<!--\\s*STATE:${key}=([^\\s]+)\\s*-->`));
  return m ? m[1] : null;
};
const stateFail = [];
let conf = null;
try { conf = JSON.parse(readFileSync(join(ROOT, "src-tauri", "tauri.conf.json"), "utf8")); }
catch (e) { stateFail.push(`tauri.conf.json unreadable/unparseable: ${e.message}`); }
const latestVersion = anchor("latest_release_version");

// (1) configured app version must equal the declared latest-release version.
if (!latestVersion) stateFail.push("STATE:latest_release_version anchor missing from CURRENT STATE");
else if (conf && conf.version !== latestVersion)
  stateFail.push(`VERSION-DRIFT: tauri.conf version ${conf.version} != CURRENT STATE latest_release_version ${latestVersion}`);

// (2) no dated release banner may be stacked in the live section (banners belong in the archive).
if (/^>\s*\*\*(?:Updated\s+20\d\d|2\d[a-z]?\s*[—-]\s|v0\.\d)/m.test(liveRegion))
  stateFail.push("BANNER-STACK: a dated release banner is stacked in the live section — move it to archive/RELEASE_STATE_HISTORY.md");

// (3) a configured public updater endpoint must not coexist with a 'no public artifact' claim.
const hasPublicEndpoint = !!(conf && conf.plugins && conf.plugins.updater && conf.plugins.updater.endpoints && conf.plugins.updater.endpoints.length);
if (hasPublicEndpoint) {
  if (/\bno public (?:artifact|download)\b/i.test(liveRegion) || /public[^.\n|]*\bnone\b/i.test(liveRegion))
    stateFail.push("PUBLIC-CONTRADICTION: a public updater endpoint is configured while CURRENT STATE claims no public artifact");
  const pub = anchor("public_artifact");
  if (!pub || /^(none|no)$/i.test(pub))
    stateFail.push("PUBLIC-CONTRADICTION: STATE:public_artifact must acknowledge the public releases repo (endpoint is configured)");
}

// (4) The live publish decision must name the candidate anchor. Historical checkpoint versions may
// be explained in the same paragraph; treating those facts as stale decisions made a truthful
// v0.9.11 decision fail merely because it preserved v0.9.9/v0.9.10 provenance.
const decMatch = docText.match(/##\s+Required owner decisions[\s\S]*?(?=^##\s|\Z)/m);
stateFail.push(
  ...validateOwnerDecisionVersions(decMatch ? decMatch[0] : "", latestVersion, anchor("candidate_version")),
);

// (5) exactly one 'Bottom line' section.
const bottomLines = (docText.match(/^\*\*Bottom line/gim) || []).length;
if (bottomLines > 1) stateFail.push(`MULTI-BOTTOM-LINE: ${bottomLines} "Bottom line" sections — collapse to one current bottom line`);

// (6) source_main_commit must name a real commit on the mainline, and must not be badly stale.
// Why this exists: on 2026-07-27 the anchor read `cff77ab` while origin/main had moved 16 commits
// on to `20306bc` — and every check above passed, because they verify citation LOCATION and this
// value was verified by nothing at all. 16 commits accrued inside ONE day, so the tolerance has to
// be tight to mean anything. Unresolvable/off-mainline are hard failures (unambiguous defects);
// staleness fails at MAX_ANCHOR_LAG. Skipped — never failed — when git history isn't available,
// so a shallow CI clone or an exported tree can't produce a phantom gate failure.
const gitOut = (args) => {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};
const gitOk = (args) => {
  try {
    execFileSync("git", args, { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const MAX_ANCHOR_LAG = 10; // commits the marker may trail the mainline before it stops being current
const sourceCommit = anchor("source_main_commit");
if (!sourceCommit) {
  stateFail.push("STATE:source_main_commit anchor missing from CURRENT STATE");
} else if (gitOut(["rev-parse", "--git-dir"]) === null) {
  console.log("STATE-SKIP       source_main_commit: no git history here — anchor left unverified");
} else if (gitOut(["rev-parse", "--is-shallow-repository"]) === "true") {
  console.log("STATE-SKIP       source_main_commit: shallow clone — anchor left unverified");
} else {
  const resolved = gitOut(["rev-parse", "--verify", "--quiet", `${sourceCommit}^{commit}`]);
  // Compare against the mainline, not HEAD: a lane branched off an older main is not a doc defect.
  const mainRef = ["origin/main", "main", "HEAD"].find((r) => gitOut(["rev-parse", "--verify", "--quiet", `${r}^{commit}`]));
  if (!resolved) {
    stateFail.push(`SOURCE-COMMIT-UNKNOWN: STATE:source_main_commit ${sourceCommit} resolves to no commit in this repo`);
  } else if (!mainRef) {
    console.log("STATE-SKIP       source_main_commit: no main/HEAD ref to compare against — anchor left unverified");
  } else if (!gitOk(["merge-base", "--is-ancestor", resolved, mainRef])) {
    stateFail.push(`SOURCE-COMMIT-ORPHAN: STATE:source_main_commit ${sourceCommit} is not an ancestor of ${mainRef} — it names a commit that never landed on the mainline`);
  } else {
    const lag = Number(gitOut(["rev-list", "--count", `${resolved}..${mainRef}`]));
    if (Number.isFinite(lag) && lag > MAX_ANCHOR_LAG)
      stateFail.push(`SOURCE-COMMIT-STALE: STATE:source_main_commit ${sourceCommit} trails ${mainRef} by ${lag} commits (max ${MAX_ANCHOR_LAG}) — re-stamp it to \`${gitOut(["rev-parse", "--short", mainRef])}\``);
  }
}

for (const f of stateFail) console.log(`STATE-DRIFT      ${f}`);

console.log(`\n${results.length} citations: ${results.filter((r) => r.verdict.startsWith("OK")).length} ok · ${near.length} near-drift · ${bad.length} broken · ${missingSections.length} missing section(s) · ${stateFail.length} state-drift`);
if (bad.length || missingSections.length || citations.length === 0 || stateFail.length || (STRICT && near.length)) {
  console.log("FIX-FORWARD: re-anchor each citation in the SAME commit as whatever moved it (precedent c056fee); restore any cut required section from the pre-diet copy; reconcile every STATE-DRIFT before the gate can pass.");
  process.exit(1);
}
}
