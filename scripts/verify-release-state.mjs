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
//
// The whole check is verifyRepo(), a pure function of a repo path, because the CLI is NOT the only caller:
// scripts/verify-release-state-guard.test.mjs runs it against this tree on every `npm test`. Until
// 2026-08-04 every check below lived inside `if (IS_MAIN)`, so the only thing that could ever run one was
// verify-release.ps1 — the full release gate, which nobody runs between releases. The sibling script
// verify-module-map.mjs had exactly that shape and sat red on `main` for two days before anyone looked.
// Citations rot on every commit that shifts a line, so this one rots faster. A gate nobody runs is a gate
// that rots.
//
// Two checks stay CLI-only on purpose; `machine: true` is what arms them:
//   (6) source_main_commit — its lag grows with every commit on the mainline, so wiring it into `npm test`
//       would turn a normal train red mid-flight and get the whole file muted rather than fixed.
//   (7) owner_installed_stamp — it scans the exe installed on the owner's machine, which exists on no
//       other rig and in no CI runner. A check whose answer depends on the host cannot pin a repo.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

export const NEAR_WINDOW = 40; // lines of tolerated drift before it's a failure
export const EXACT_WINDOW = 3; // lines still considered "anchored"
export const REQUIRED_SECTIONS = ["CURRENT STATE", "Gate matrix", "Release blockers"];
const MAX_ANCHOR_LAG = 10; // commits the marker may trail the mainline before it stops being current
const DOC_REL = "docs/RELEASE_STATE.md";

// #123: JavaScript RegExp has no \Z anchor - the old lookahead's `\Z` parsed as a literal letter,
// so any capital Z inside the section (an ISO timestamp suffix, say) truncated it BEFORE the
// numbered list and a truthful decision read as STALE. `(?![\s\S])` is JS's real end-of-input;
// the m-flagged `^##` alternative still stops the section at the next heading.
export function ownerDecisionsSection(docText) {
  const m = docText.match(/##\s+Required owner decisions[\s\S]*?(?=^##\s|(?![\s\S]))/m);
  return m ? m[0] : "";
}

// STAGE PREFLIGHT (2026-08-19). The doc half of "fail in seconds, not after a 13-minute verify +
// build". The v0.9.26 stage burned two full cycles on this exact state: release.ps1 bumps
// STATE:latest_release_version as part of the cut, but nothing moves STATE:candidate_version or the
// owner-decision heading, so the release-state gate at the END of verify-release.ps1 failed with
// STALE-DECISION after the whole suite had already run. The rule is not restated here in PowerShell
// - the stage calls this with the version it is ABOUT to cut, so there is one implementation.
export function validateStageCandidate(docText, nextVersion) {
  const anchor = (key) => {
    const m = docText.match(new RegExp(`<!--\\s*STATE:${key}=([^\\s]+)\\s*-->`));
    return m ? m[1] : null;
  };
  const failures = [];
  const candidate = anchor("candidate_version");
  if (candidate !== nextVersion) {
    failures.push(
      `STAGE-PREFLIGHT: STATE:candidate_version is ${candidate || "missing"}, but this run will cut v${nextVersion}. ` +
        `Set <!-- STATE:candidate_version=${nextVersion} --> in docs/RELEASE_STATE.md, then retry.`,
    );
  }
  for (const f of validateOwnerDecisionVersions(ownerDecisionsSection(docText), nextVersion, nextVersion)) {
    if (!failures.includes(f)) failures.push(f);
  }
  return failures;
}

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

// Delimited lowercase-hex runs in a binary read as latin1 — the shape `build.rs` bakes in
// (`git rev-parse --short HEAD` → `cargo:rustc-env=COMPY_GIT_HASH`), which lands in the executable's
// rodata as a standalone ASCII token. "Delimited" is the whole trick: a longer hex run is a different
// string that merely begins with hex, and must NOT yield a candidate out of its middle.
//
// The LENGTH IS A RANGE, not 7, because `--short` is not a fixed width: git widens the abbreviation as
// the object count grows, and this repo crossed into 8 on 2026-08-06 (`ff0ce65f`). Pinned at exactly 7,
// this scan found 24 tokens, resolved none of them, and printed STATE-SKIP — so the one check whose
// entire purpose is catching a stale desk anchor stopped checking, permanently, while still printing a
// line. That is precisely the failure this check's own header calls "worse than an absent anchor",
// happening again one level down in the scanner instead of in the anchor. The upper bound keeps the
// delimited-run property meaningful: a 40-char OID or a 64-char SHA-256 is a different string, not a
// stamp, and must still yield nothing.
const STAMP_MIN_HEX = 7;
const STAMP_MAX_HEX = 12;
export function embeddedStampTokens(text) {
  const run = new RegExp(
    `(?<![0-9a-f])[0-9a-f]{${STAMP_MIN_HEX},${STAMP_MAX_HEX}}(?![0-9a-f])`,
    "g",
  );
  return [...new Set(text.match(run) ?? [])];
}

// --- file resolution -----------------------------------------------------------------------------
const SEARCH_DIRS = ["src", "src-tauri/src", "src-tauri", "docs", "scripts"];
const SKIP = new Set(["node_modules", "target", "dist", "dist-web", "dist-site", ".git", "worktrees", "archive"]);

function buildBasenameIndex(root) {
  const basenameIndex = new Map(); // basename -> [relpaths]
  const walk = (rel, depth) => {
    if (depth > 6) return;
    let entries;
    try { entries = readdirSync(join(root, rel)); } catch { return; }
    for (const e of entries) {
      if (SKIP.has(e)) continue;
      const r = rel ? `${rel}/${e}` : e;
      let st;
      try { st = statSync(join(root, r)); } catch { continue; }
      if (st.isDirectory()) walk(r, depth + 1);
      else {
        if (!basenameIndex.has(e)) basenameIndex.set(e, []);
        basenameIndex.get(e).push(r);
      }
    }
  };
  for (const d of SEARCH_DIRS) walk(d, 0);
  return basenameIndex;
}

function makeResolveFile(root, basenameIndex) {
  return (p) => {
    const norm = p.replace(/\\/g, "/");
    const candidates = [norm, `src-tauri/src/${norm}`, `src/${norm}`, `docs/${norm}`, `scripts/${norm}`, `src-tauri/${norm}`];
    for (const c of candidates) if (existsSync(join(root, c))) return c;
    const hits = basenameIndex.get(basename(norm)) || [];
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      // prefer the conventional home for the extension
      const pref = norm.endsWith(".rs") ? hits.find((h) => h.startsWith("src-tauri/src/")) : hits.find((h) => h.startsWith("src/"));
      return pref || hits[0];
    }
    return null;
  };
}

// --- citation extraction -------------------------------------------------------------------------
// shapes: `sym()` — `file:line`   ·   `sym` `file:line`   ·   `file:line`→`mod::sym`   ·   bare `file:line`
// comma-chained citations (`a.rs:1`, `b.rs:2`) inherit the previous citation's symbol.
const TOKEN = /`([\w./\\-]+\.(?:rs|tsx?|mjs|cjs|json|toml|md|css|ps1)):(\d+)`/g;

export function extractCitations(docLines) {
  const citations = [];
  docLines.forEach((line, li) => {
    let m;
    let prevSym = null;
    let prevEnd = -1;
    TOKEN.lastIndex = 0;
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
  return citations;
}

// --- verification --------------------------------------------------------------------------------
const VERDICT_ORDER = { "MISSING-FILE": 0, "LINE-OOB": 1, GONE: 2, DRIFT: 3, NEAR: 4, "OK-FILE": 5, OK: 6 };

function verifyCitations(root, citations, resolveFile) {
  const fileCache = new Map();
  const lines = (rel) => {
    if (!fileCache.has(rel)) fileCache.set(rel, readFileSync(join(root, rel), "utf8").split(/\r?\n/));
    return fileCache.get(rel);
  };
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
  results.sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || a.docLine - b.docLine);
  return results;
}

// --- CURRENT-STATE drift gates (Phase 4, 2026-07-23) ----------------------------------------------
// Truth-repair layer: the citation checks above verify LOCATION; these verify that the current-state
// SUMMARY hasn't drifted from the live config, from itself, or from reality. Each reads a
// machine-readable `<!-- STATE:key=value -->` anchor, so the gate is deterministic, not regex-over-prose.
function checkCurrentState(root, docLines, { machine }) {
  const stateFail = [];
  const notes = [];
  const docText = docLines.join("\n");
  const liveRegion = docText.split(/^##\s+Gate matrix/m)[0]; // banners/bottom-lines live above the matrix
  const anchor = (key) => {
    const m = docText.match(new RegExp(`<!--\\s*STATE:${key}=([^\\s]+)\\s*-->`));
    return m ? m[1] : null;
  };
  let conf = null;
  try { conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8")); }
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
  stateFail.push(
    ...validateOwnerDecisionVersions(ownerDecisionsSection(docText), latestVersion, anchor("candidate_version")),
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
      return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return null;
    }
  };
  const gitOk = (args) => {
    try {
      execFileSync("git", args, { cwd: root, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  const sourceCommit = anchor("source_main_commit");
  if (!sourceCommit) {
    stateFail.push("STATE:source_main_commit anchor missing from CURRENT STATE");
  } else if (!machine) {
    notes.push("STATE-SKIP       source_main_commit: repo-only run — mainline lag is a CLI/release-gate check");
  } else if (gitOut(["rev-parse", "--git-dir"]) === null) {
    notes.push("STATE-SKIP       source_main_commit: no git history here — anchor left unverified");
  } else if (gitOut(["rev-parse", "--is-shallow-repository"]) === "true") {
    notes.push("STATE-SKIP       source_main_commit: shallow clone — anchor left unverified");
  } else {
    const resolved = gitOut(["rev-parse", "--verify", "--quiet", `${sourceCommit}^{commit}`]);
    // Compare against the mainline, not HEAD: a lane branched off an older main is not a doc defect.
    const mainRef = ["origin/main", "main", "HEAD"].find((r) => gitOut(["rev-parse", "--verify", "--quiet", `${r}^{commit}`]));
    if (!resolved) {
      stateFail.push(`SOURCE-COMMIT-UNKNOWN: STATE:source_main_commit ${sourceCommit} resolves to no commit in this repo`);
    } else if (!mainRef) {
      notes.push("STATE-SKIP       source_main_commit: no main/HEAD ref to compare against — anchor left unverified");
    } else if (!gitOk(["merge-base", "--is-ancestor", resolved, mainRef])) {
      stateFail.push(`SOURCE-COMMIT-ORPHAN: STATE:source_main_commit ${sourceCommit} is not an ancestor of ${mainRef} — it names a commit that never landed on the mainline`);
    } else {
      const lag = Number(gitOut(["rev-list", "--count", `${resolved}..${mainRef}`]));
      if (Number.isFinite(lag) && lag > MAX_ANCHOR_LAG)
        stateFail.push(`SOURCE-COMMIT-STALE: STATE:source_main_commit ${sourceCommit} trails ${mainRef} by ${lag} commits (max ${MAX_ANCHOR_LAG}) — re-stamp it to \`${gitOut(["rev-parse", "--short", mainRef])}\``);
    }
  }

  // (7) owner_installed_stamp must equal the build stamp embedded in the binary actually installed on
  // this machine. Why this exists: the 2026-07-31 Q7 native-baseline recording found the anchor reading
  // `7ba5fb6` while the live window's own stamp read `294db4f` — and nothing failed, because every other
  // anchor here is verified against live source while this one described a binary on a desk rather than
  // a file in the tree. It was enforced by nothing while LOOKING enforced, which is worse than an absent
  // anchor. It then drifted the same way again: the 2026-08-03 local ship at `c7c60d3` re-stamped the
  // desk and left the anchor on the published `a1be896`. The stamp is READABLE offline, so this reads it
  // rather than guessing: scan the installed exe for delimited 7-hex tokens and keep the ones git
  // resolves to a commit, which lets a mismatch name the real value instead of merely rejecting the
  // claimed one. Skipped — never failed — whenever the answer is genuinely unknowable here: no installed
  // exe (CI, another machine), no/shallow git history, or a scan that is empty or ambiguous.
  const INSTALLED_EXE = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "Compy", "compy.exe")
    : null;
  // One `cat-file --batch-check` instead of N spawns. Output lines map 1:1 to input lines, and a resolved
  // object prints its full OID rather than the token it came from — so match by INDEX, never by text.
  const gitCommitsAmong = (tokens) => {
    if (!tokens.length) return [];
    try {
      const lines = execFileSync("git", ["cat-file", "--batch-check"], {
        cwd: root,
        encoding: "utf8",
        input: `${tokens.join("\n")}\n`,
        stdio: ["pipe", "pipe", "ignore"],
      }).split("\n");
      return tokens.filter((_, i) => / commit \d+$/.test(lines[i] ?? ""));
    } catch {
      return [];
    }
  };
  const installedStamp = anchor("owner_installed_stamp");
  if (!installedStamp) {
    stateFail.push("STATE:owner_installed_stamp anchor missing from CURRENT STATE");
  } else if (!machine) {
    notes.push("STATE-SKIP       owner_installed_stamp: repo-only run — the installed binary is a CLI/release-gate check");
  } else if (!INSTALLED_EXE || !existsSync(INSTALLED_EXE)) {
    notes.push("STATE-SKIP       owner_installed_stamp: no installed compy.exe on this machine — anchor left unverified");
  } else if (gitOut(["rev-parse", "--git-dir"]) === null || gitOut(["rev-parse", "--is-shallow-repository"]) === "true") {
    notes.push("STATE-SKIP       owner_installed_stamp: no full git history to resolve an embedded stamp — anchor left unverified");
  } else {
    let tokens = null;
    try { tokens = embeddedStampTokens(readFileSync(INSTALLED_EXE).toString("latin1")); } catch { /* unreadable → skip */ }
    const stamps = tokens === null ? [] : gitCommitsAmong(tokens);
    if (tokens === null) {
      notes.push("STATE-SKIP       owner_installed_stamp: installed compy.exe is not readable here — anchor left unverified");
    } else if (stamps.length !== 1) {
      notes.push(`STATE-SKIP       owner_installed_stamp: ${stamps.length} of ${tokens.length} embedded tokens resolve to a commit (need exactly 1) — anchor left unverified`);
    } else if (stamps[0] !== installedStamp) {
      stateFail.push(`INSTALLED-STAMP-DRIFT: STATE:owner_installed_stamp ${installedStamp} != the stamp embedded in the installed compy.exe (${stamps[0]}) — the build on the owner's desk is not the one CURRENT STATE names; re-stamp it to \`${stamps[0]}\` (and reconcile the owner-installed row with it)`);
    }
  }

  return { stateFail, notes };
}

// The entire check, as a pure function of a repo root, so the CLI and the vitest guard cannot drift
// apart. `machine: true` additionally arms the two host-dependent checks (see the header). A missing
// doc returns named failures rather than throwing: an absent contract is a failure, never a silent pass,
// and a test can assert the reason instead of a stack trace.
export function verifyRepo(root, { machine = false } = {}) {
  const doc = join(root, ...DOC_REL.split("/"));
  if (!existsSync(doc)) {
    return {
      results: [], bad: [], near: [], citations: [], notes: [],
      missingSections: [...REQUIRED_SECTIONS],
      stateFail: [`DOC-MISSING: ${DOC_REL} is absent — the state contract cannot be verified, and an absent contract is a failure, not a pass`],
    };
  }
  const docLines = readFileSync(doc, "utf8").split(/\r?\n/);
  const citations = extractCitations(docLines);
  const results = verifyCitations(root, citations, makeResolveFile(root, buildBasenameIndex(root)));

  // --- structural coverage (the f21c170 guard) ---
  const missingSections = REQUIRED_SECTIONS.filter(
    (s) => !docLines.some((l) => /^#{1,3}\s/.test(l) && l.includes(s))
  );
  const { stateFail, notes } = checkCurrentState(root, docLines, { machine });

  return {
    results,
    citations,
    missingSections,
    stateFail,
    notes,
    bad: results.filter((r) => ["MISSING-FILE", "LINE-OOB", "GONE", "DRIFT"].includes(r.verdict)),
    near: results.filter((r) => r.verdict === "NEAR"),
  };
}

const IS_MAIN =
  !!process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (IS_MAIN) {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const STRICT = process.argv.includes("--strict");

  // `--stage-candidate <version>` is the seconds-long preflight release.ps1 calls before it spends a
  // verify + build on a candidate the doc does not name. Doc-only: it reads nothing else.
  const stageIdx = process.argv.indexOf("--stage-candidate");
  if (stageIdx !== -1) {
    const nextVersion = process.argv[stageIdx + 1];
    if (!nextVersion || !/^\d+\.\d+\.\d+$/.test(String(nextVersion))) {
      console.log("STAGE-PREFLIGHT: --stage-candidate needs the version this run will cut, e.g. --stage-candidate 0.9.27");
      process.exit(1);
    }
    const failures = validateStageCandidate(readFileSync(join(ROOT, DOC_REL), "utf8"), nextVersion);
    for (const f of failures) console.log(f);
    if (failures.length) {
      console.log(`FIX-FORWARD: reconcile docs/RELEASE_STATE.md for candidate v${nextVersion} (anchor + owner decision 1), then re-run the release.`);
      process.exit(1);
    }
    console.log(`STAGE-PREFLIGHT OK: docs/RELEASE_STATE.md names candidate v${nextVersion}.`);
    process.exit(0);
  }

  const { results, citations, missingSections, stateFail, notes, bad, near } = verifyRepo(ROOT, { machine: true });

  for (const r of results) {
    const cite = `${r.file}:${r.line}${r.sym ? ` (${r.sym})` : ""}`;
    console.log(`${r.verdict.padEnd(12)} RELEASE_STATE.md:${String(r.docLine).padEnd(4)} ${cite.padEnd(52)} ${r.detail}`);
  }
  for (const s of missingSections) console.log(`MISSING-SECTION  '${s}' — required section absent from RELEASE_STATE.md`);
  if (citations.length === 0) console.log("ZERO-COVERAGE    no `file:line` citations found — the matrix contract is empty");
  for (const n of notes) console.log(n);
  for (const f of stateFail) console.log(`STATE-DRIFT      ${f}`);

  console.log(`\n${results.length} citations: ${results.filter((r) => r.verdict.startsWith("OK")).length} ok · ${near.length} near-drift · ${bad.length} broken · ${missingSections.length} missing section(s) · ${stateFail.length} state-drift`);
  if (bad.length || missingSections.length || citations.length === 0 || stateFail.length || (STRICT && near.length)) {
    console.log("FIX-FORWARD: re-anchor each citation in the SAME commit as whatever moved it (precedent c056fee); restore any cut required section from the pre-diet copy; reconcile every STATE-DRIFT before the gate can pass.");
    process.exit(1);
  }
}
