import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { spawnSync } from "node:child_process";
import { windows, WINDOWS_ONLY } from "./lib/windows-only.mjs";
import { join } from "path";

// DATA-ROOT GUARD (#130, 2026-08-18).
//
// WHY THIS EXISTS — a real defect, not a hypothetical:
//
//   `compy_data_dir()` was `env::var("APPDATA")` joined with `"Compy"`, falling back to `C:\Temp`.
//   Compy was then launched at least once as a child of the MSIX-packaged Claude desktop app. A
//   child of a packaged host inherits the package's filesystem overlay: `APPDATA` still reads
//   `C:\Users\<u>\AppData\Roaming` — the STRING is correct, and every check that trusted the string
//   passed — but the RESOLUTION landed in `…\AppData\Local\Packages\<family>\LocalCache\Roaming\`.
//
//   The Trust Ledger split in two. 61 receipts of real, machine-affecting Windows changes went to
//   the overlay; a normally-launched Compy sees 3. Twelve of those changes are live on the owner's
//   machine right now with no receipt the app can find — a direct breach of LOCKED rule 3
//   (rollback-first: never apply a change you can't roll back).
//
//   The `C:\Temp` fallback was the same failure in miniature: on an unset APPDATA the app would
//   have silently started a THIRD ledger rather than admitting it did not know where it lived.
//
// So the rule is mechanical. The data root is resolved in exactly ONE place —
// `src-tauri/src/data_root.rs` — which measures where the root actually LANDS (final-path
// resolution + NTFS identity) instead of trusting the environment string, and hands out
// `MutationRoot`, the capability type every Windows-mutation and receipt-write path requires. A
// path composed from `APPDATA`/`LOCALAPPDATA`/`USERPROFILE` anywhere else fails this test by
// construction, in the Rust backend AND in the PowerShell release/ship preflights (which had the
// identical fail-open bug: join blind, skip when absent, report PASS about a folder never looked at).
//
// The corpus is INVERTED on purpose — walk everything, exempt explicitly with a greppable
// line-level `data-root-allow` marker and a reason. A new module is in scope the moment it exists,
// with no list to remember to update. Same lesson as `src/mutation-boundary-guard.test.ts`.
//
// Paths are repo-root-relative; vitest runs from the repo root (scripts/run-vitest.mjs).

const BACKEND = join("src-tauri", "src");
const SCRIPTS = "scripts";

const RESOLVER_RS = join(BACKEND, "data_root.rs");
const RESOLVER_PS = join(SCRIPTS, "lib", "canonical-data-root.ps1");
const ALLOW = "data-root-allow";

// The environment variables whose *string* value is not evidence of where a path lands.
const ROOT_VARS = ["APPDATA", "LOCALAPPDATA", "USERPROFILE"];

function collect(dir, ext) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const rel = join(dir, name);
    if (statSync(rel).isDirectory()) out.push(...collect(rel, ext));
    else if (name.endsWith(ext)) out.push(rel);
  }
  return out;
}

/**
 * Every line, flagged. Comments are KEPT — the allow marker lives in one, and dropping them first
 * was the bug that made the marker unfindable — but a whole-line comment can never be an offence,
 * because this file's own prose discusses the very variables it forbids.
 */
function scan(file, commentPrefixes) {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((text, i) => ({
      n: i + 1,
      text,
      isComment: commentPrefixes.some((p) => text.trimStart().startsWith(p)),
    }));
}

/**
 * A line is exempt if it carries the marker, or if the contiguous comment block directly above it
 * does. The block form is what makes a real reason affordable: one sentence explaining why the line
 * is not a data path, rather than a bare token appended to code.
 */
function exempt(all, idx) {
  if ((all[idx]?.text ?? "").includes(ALLOW)) return true;
  for (let i = idx - 1; i >= 0 && all[i].isComment; i--) {
    if (all[i].text.includes(ALLOW)) return true;
  }
  return false;
}

describe("data-root guard: the persistence root is resolved in one place", () => {
  it("no Rust file outside the resolver composes a data path from the environment", () => {
    const offenders = [];
    for (const file of collect(BACKEND, ".rs")) {
      if (file === RESOLVER_RS) continue;
      const lines = scan(file, ["//", "///", "//!", "*"]);
      lines.forEach((line, i) => {
        if (line.isComment) return;
        const hit = ROOT_VARS.find((v) => line.text.includes(`"${v}"`));
        if (hit && !exempt(lines, i)) offenders.push(`${file}:${line.n} — ${hit}: ${line.text.trim()}`);
      });
    }
    expect(
      offenders,
      `These read a root environment variable outside ${RESOLVER_RS}. The APPDATA string was CORRECT during the #130 incident and the resolution was still redirected — so the string proves nothing. Resolve through data_root.rs, or mark the line \`${ALLOW}\` with the reason it is not a data path:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("no PowerShell script composes a data path from $env:APPDATA outside the shared preflight", () => {
    const offenders = [];
    for (const file of collect(SCRIPTS, ".ps1")) {
      if (file === RESOLVER_PS) continue;
      const lines = scan(file, ["#"]);
      lines.forEach((line, i) => {
        if (!line.isComment && /\$env:APPDATA/i.test(line.text) && !exempt(lines, i)) {
          offenders.push(`${file}:${line.n} — ${line.text.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `These join a Compy path from $env:APPDATA directly. Both release preflights did exactly this and FAILED OPEN from a redirected shell. Use Get-CanonicalCompyDataRoot (${RESOLVER_PS}), which refuses instead of guessing:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the resolver hands out a capability type, not a path", () => {
    const rs = readFileSync(RESOLVER_RS, "utf8");
    // Code only - the module's own prose explains the `C:\Temp` defect it replaced.
    const code = scan(RESOLVER_RS, ["//", "///", "//!", "*"]).filter((l) => !l.isComment).map((l) => l.text).join("\n");
    expect(rs, "MutationRoot must exist as a type").toMatch(/struct MutationRoot/);
    // Constructible from a decision ONLY — a `MutationRoot(path)` built from anywhere else would
    // make the type decorative. `for_test` is the single, cfg(test)-only exception.
    const constructors = [...rs.matchAll(/MutationRoot\(/g)].length;
    expect(constructors, "MutationRoot's tuple constructor is used more than the two sanctioned sites").toBeLessThanOrEqual(3);
    expect(rs).toMatch(/fn from_decision\(/);
    expect(code, "the unavailable case must never fall back to a real, writable directory").not.toMatch(/C:\\Temp/);
  });

  it("every ledger write and rollback requires possession of the capability", () => {
    const history = readFileSync(join(BACKEND, "history.rs"), "utf8");
    expect(history, "the one place a gateway acquires the capability").toMatch(/fn begin_mutation\(\)/);
    expect(history, "save_history must demand a proven root").toMatch(/fn save_history\(\s*root: &MutationRoot/);
    const actions = readFileSync(join(BACKEND, "actions.rs"), "utf8");
    expect(actions, "rollback dispatch must demand a proven root").toMatch(
      /fn dispatch_rollback\(\s*_?root: &crate::data_root::MutationRoot/,
    );
  });

  // bug->guard, 2026-08-19. This library is DOT-SOURCED, so its file scope IS the caller's scope.
  // `Set-StrictMode -Version Latest` at file scope therefore made release.ps1 and ship-reinstall.ps1
  // strict for their whole run, and under Latest a read of a property that does not exist is a
  // terminating error instead of $null. The release pipeline probes optional context values that
  // way in a dozen places, so the v0.9.26 release-prove died at stage runtime_proved on
  // `$Context.RuntimeInspector` -- a hook only the sandbox harness supplies, which is why every
  // test passed. The rule: a dot-sourced library sets strict mode inside its own functions, never
  // at file scope, because it does not get to change how its caller's unrelated code behaves.
  it.runIf(windows)(`dot-sourcing the preflight does not make the CALLER strict ${WINDOWS_ONLY}`, () => {
    const text = readFileSync(join(SCRIPTS, "lib", "canonical-data-root.ps1"), "utf8");
    const fileScopeStrict = /^Set-StrictMode/m.test(text);
    expect(fileScopeStrict, "Set-StrictMode is back at file scope, where it leaks into the caller").toBe(false);
    expect(text, "the library must still be strict INSIDE its functions").toMatch(/^  Set-StrictMode -Version Latest$/m);

    // Behavioural, because the static half above can be satisfied by a library that is simply not
    // strict anywhere. This is the exact shape that failed: dot-source, then read an absent
    // property the way the release adapter does.
    const probe = spawnSync(
      "powershell.exe",
      [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
        ". '" + join(SCRIPTS, "lib", "canonical-data-root.ps1") + "'; " +
          "$o = [pscustomobject]@{ A = 1 }; " +
          "try { if ($o.Missing) { 'TRUTHY' } else { 'FALSY' } } catch { 'THREW' }",
      ],
      { encoding: "utf8", shell: false, windowsHide: true },
    );
    expect((probe.stdout || "").trim(), `powershell said: ${probe.stdout} ${probe.stderr}`).toBe("FALSY");
  }, 120_000);

  it("both release preflights prove the root before reading it", () => {
    for (const script of [join(SCRIPTS, "release.ps1"), join(SCRIPTS, "ship-reinstall.ps1")]) {
      const text = readFileSync(script, "utf8");
      expect(text, `${script} must dot-source the shared preflight`).toContain("canonical-data-root.ps1");
      expect(text, `${script} must call it`).toMatch(/Get-CanonicalCompyDataRoot/);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// DATA INVENTORY GUARD (D4-1, 2026-11-20).
//
// WHY: a "Clear my data" feature, the privacy policy and the first-launch notice all need ONE
// complete, true list of what Compy stores. `docs/PRIVACY.md` had already drifted: it left out
// hardware-fingerprint.json, experiments.json, benchmark.json, scoreboard.json, intelligence.json,
// drift.json, care/incident-observer.json, the never-pruned exports/ folder and the WebView storage.
// The list is `src-tauri/src/data_inventory.rs`; this block keeps it complete, in BOTH directions:
//
//   1. every Compy file or folder name that production Rust composes onto the data root, or spells
//      as a Compy file name, is covered by an inventory row (a new store with no row fails here and
//      the message says what to add);
//   2. every row is still spelled by at least one module it names (no stale rows);
//   3. every `compy_*` / `compy.*` browser-storage key spelled in `src/` is in WEBVIEW_KEYS, and
//      every key listed there is still used.
//
// It reads the Rust as TEXT (like the rest of this file), with comments and test-only items
// (`#[cfg(test)]`, `#[test]`) removed, so a name used only in a test is not data. Known limit: a
// literal joined onto a path held in a variable and carrying no file extension is not seen unless
// it is a `*_FILE` / `*_DIR` constant; every other route, including bare helper arguments that look
// like file names, is.
// ---------------------------------------------------------------------------------------------

const INVENTORY_RS = join(BACKEND, "data_inventory.rs");
const SRC_TS = "src";
const lastPart = (p) => p.split(/[\\/]/).pop();
const linesOf = (text) =>
  text ? text.split(/\r?\n/).map((t, i) => ({ n: i + 1, text: t, isComment: ["//", "///", "//!", "*"].some((p) => t.trimStart().startsWith(p)) })) : [];

function nextTok(s, i) {
  const c = s[i];
  if (c === "/" && s[i + 1] === "/") { let j = s.indexOf("\n", i); if (j < 0) j = s.length; return { k: "lc", e: j }; }
  if (c === "/" && s[i + 1] === "*") {
    let d = 1, j = i + 2;
    while (j < s.length && d > 0) { if (s[j] === "/" && s[j + 1] === "*") { d++; j += 2; } else if (s[j] === "*" && s[j + 1] === "/") { d--; j += 2; } else j++; }
    return { k: "bc", e: j };
  }
  if (c === "r" || c === "b") {
    const m = /^b?r(#*)"/.exec(s.slice(i, i + 12));
    if (m && (i === 0 || !/[A-Za-z0-9_]/.test(s[i - 1]))) {
      const close = '"' + m[1];
      let j = s.indexOf(close, i + m[0].length);
      j = j < 0 ? s.length : j + close.length;
      return { k: "str", e: j, v: s.slice(i + m[0].length, j - close.length) };
    }
  }
  if (c === '"' || (c === "b" && s[i + 1] === '"')) {
    const open = i + (c === "b" ? 2 : 1);
    let j = open;
    while (j < s.length && s[j] !== '"') j += s[j] === "\\" ? 2 : 1;
    return { k: "str", e: j + 1, v: s.slice(open, j) };
  }
  if (c === "'") {
    const m = /^'(?:\\(?:u\{[0-9a-fA-F_]+\}|x[0-9a-fA-F]{2}|.)|[^\\'])'/.exec(s.slice(i, i + 14));
    return m ? { k: "ch", e: i + m[0].length } : { k: "p", e: i + 1 };
  }
  if (/\s/.test(c)) return { k: "ws", e: i + 1 };
  return { k: "p", e: i + 1 };
}

/** End of an item: the first top-level `;`, or the close of the first balanced `{}` block. */
function itemEnd(s, i) {
  let depth = 0;
  while (i < s.length) {
    const t = nextTok(s, i);
    if (t.k === "p") {
      const c = s[i];
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) return t.e; if (depth < 0) return i; }
      else if (c === ";" && depth === 0) return t.e;
    }
    i = t.e;
  }
  return s.length;
}

const TEST_ATTR = /^#\[(?:cfg\((?:all\()?test\b[^\]]*\)|test)\]/;

/** Production Rust only: comments and test-only items blanked, newlines kept so line numbers hold. */
function productionRust(src) {
  const out = src.split("");
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " "; };
  const testMods = [];
  let i = 0;
  while (i < src.length) {
    const t = nextTok(src, i);
    if (t.k === "lc" || t.k === "bc") { blank(i, t.e); i = t.e; continue; }
    if (t.k === "p" && src[i] === "#") {
      const m = TEST_ATTR.exec(src.slice(i, i + 80));
      if (m) {
        const end = itemEnd(src, i + m[0].length);
        const mm = /^\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([a-z]+\))?\s+)?mod\s+(\w+)\s*;/.exec(src.slice(i + m[0].length, end + 1));
        if (mm) testMods.push(mm[1]);
        blank(i, end);
        i = end;
        continue;
      }
    }
    i = t.e;
  }
  return { code: out.join(""), testMods };
}

/** Every production `.rs` under the backend: [{ file, rel, name, code, raw }]. Test-only files are dropped. */
function productionFiles(root) {
  const files = collect(root, ".rs");
  const parsed = files.map((f) => ({ f, raw: readFileSync(f, "utf8") }));
  const skip = new Set();
  for (const p of parsed) {
    p.code = productionRust(p.raw);
    const stem = lastPart(p.f).replace(/\.rs$/, "");
    const dir = p.f.slice(0, p.f.length - lastPart(p.f).length - 1);
    const base = ["lib", "main", "mod"].includes(stem) ? dir : join(dir, stem);
    for (const m of p.code.testMods) { skip.add(join(base, m + ".rs")); skip.add(join(base, m, "mod.rs")); }
  }
  return parsed
    .filter((p) => !skip.has(p.f))
    .map((p) => ({ file: p.f, name: lastPart(p.f), code: p.code.code, raw: p.raw }));
}

function stringLiterals(code) {
  const res = [];
  let line = 1, i = 0;
  while (i < code.length) {
    const t = nextTok(code, i);
    if (t.k === "str") res.push({ v: t.v, line });
    for (let k = i; k < t.e; k++) if (code[k] === "\n") line++;
    i = t.e;
  }
  return res;
}

const unescapeRs = (s) => s.replace(/\\\\/g, "\\").replace(/\\"/g, '"');
/** `{x}` (a format argument) and `<x>` (an inventory placeholder) both become `*`. */
const normName = (s) => s.replace(/\{[^{}]*\}/g, "*").replace(/<[^<>]*>/g, "*").replace(/\*+/g, "*");

/** Parse `InventoryRow { .. }` / `WebviewKey { .. }` struct literals out of data_inventory.rs. */
function parseStructs(rs, typeName) {
  const code = productionRust(rs).code;
  const out = [];
  const re = new RegExp("(^|[^A-Za-z0-9_])" + typeName + "\\s*\\{", "g");
  let m;
  while ((m = re.exec(code))) {
    if (/struct\s+$/.test(code.slice(0, m.index + m[1].length))) continue;
    const open = m.index + m[0].length - 1;
    const end = itemEnd(code, open);
    out.push(parseFields(code.slice(open + 1, end - 1)));
  }
  return out;
}

function parseFields(body) {
  const fields = {};
  let i = 0, start = 0, depth = 0;
  const flush = (to) => {
    const piece = body.slice(start, to).trim();
    if (!piece) return;
    const c = piece.indexOf(":");
    fields[piece.slice(0, c).trim()] = parseValue(piece.slice(c + 1).trim());
  };
  while (i < body.length) {
    const t = nextTok(body, i);
    if (t.k === "p") {
      const ch = body[i];
      if (ch === "[" || ch === "(" || ch === "{") depth++;
      else if (ch === "]" || ch === ")" || ch === "}") depth--;
      else if (ch === "," && depth === 0) { flush(i); start = i + 1; }
    }
    i = t.e;
  }
  flush(body.length);
  return fields;
}

function parseValue(v) {
  if (v.startsWith('"')) return unescapeRs(v.slice(1, -1));
  if (v.startsWith("&[")) {
    const inner = v.slice(2, -1).trim();
    if (!inner) return [];
    const items = [];
    let i = 0, start = 0;
    while (i < inner.length) {
      const t = nextTok(inner, i);
      if (t.k === "p" && inner[i] === ",") { items.push(inner.slice(start, i).trim()); start = i + 1; }
      i = t.e;
    }
    items.push(inner.slice(start).trim());
    return items.filter(Boolean).map(parseValue);
  }
  return v;
}

function readInventory(rs) {
  return { rows: parseStructs(rs, "InventoryRow"), keys: parseStructs(rs, "WebviewKey") };
}

/**
 * Does `row` spell the code literal `lit`? Both are normalised first (`{x}` and `<x>` become `*`), then it
 * is the whole path, one path segment, an extra spelling, or the tail of a `with_extension` argument.
 * A row with no real path (an `Unresolved` placeholder) never covers anything.
 */
function rowCovers(row, lit) {
  if (/Unresolved$/.test(row.base ?? "")) return false;
  const L = normName(lit);
  const segs = normName(row.path).split("/");
  if ([normName(row.path), ...segs, ...(row.names_in_code ?? []).map(normName)].includes(L)) return true;
  return /^[A-Za-z]/.test(L) && segs[segs.length - 1].endsWith("." + L);
}

const COMPY_FILE_LITERAL = /^[\w.*\\-]+\.(json|jsonl|key|receipts|result|ticket|alive|bak|restored|restore|corrupt|tmp|txt|log|lock|md)(\.[\w*-]+)*$/i;
// Modules that only READ other programs' files, whose file names are not Compy data.
const NOT_DATA_MODULES = { "game_mods.rs": "READ-ONLY detector of graphics mods in a game folder" };
const WRITE_CALL = /\b(fs::write|File::create|OpenOptions|remove_file|remove_dir|create_dir|fs::rename|fs::copy|write_atomic)\b/;
const ACCESSOR_BASE = /\b(?:compy_data_dir|session_data_dir|mutation_root|effective_root)\s*\(|\broot\.path\(\)/;

function chunksOf(code) {
  const nl = [];
  for (let k = code.indexOf("\n"); k >= 0; k = code.indexOf("\n", k + 1)) nl.push(k);
  const lineAt = (idx) => { let lo = 0, hi = nl.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (nl[mid] < idx) lo = mid + 1; else hi = mid; } return lo + 1; };
  const out = [];
  const push = (a, b) => {
    const text = code.slice(a, b);
    const lead = text.length - text.trimStart().length;
    out.push({ text, line: lineAt(a + lead) });
  };
  let i = 0, start = 0;
  while (i < code.length) {
    const t = nextTok(code, i);
    if (t.k === "p" && (code[i] === ";" || code[i] === "{" || code[i] === "}")) { push(start, i); start = i + 1; }
    i = t.e;
  }
  push(start, code.length);
  return out;
}

function derivedAccessors(files) {
  const names = new Set();
  for (let round = 0; round < 4; round++) {
    const before = names.size;
    const known = names.size ? new RegExp("\\b(?:" + [...names].join("|") + ")\\s*\\(") : null;
    for (const f of files) {
      const re = /fn\s+(\w+)\s*\([^)]*\)\s*->\s*(?:std::path::)?PathBuf\s*\{/g;
      let m;
      while ((m = re.exec(f.code))) {
        const open = m.index + m[0].length - 1;
        const body = f.code.slice(open, itemEnd(f.code, open));
        if (ACCESSOR_BASE.test(body) || (known && known.test(body))) names.add(m[1]);
      }
    }
    if (names.size === before) break;
  }
  return names;
}

function constMap(files) {
  const map = new Map();
  for (const f of files) {
    for (const m of f.code.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*:\s*&(?:'static\s+)?str\s*=\s*("(?:[^"\\]|\\.)*")/g)) {
      map.set(m[1], { v: m[2].slice(1, -1), file: f.name, line: f.code.slice(0, m.index).split("\n").length });
    }
  }
  return map;
}

/**
 * The whole check, as a pure function so the break checks below can run it on planted input.
 * Returns human-readable problems; [] means the inventory is complete and current.
 */
function checkInventory(files, inv, ctx = {}) {
  const problems = [];
  const rows = inv.rows;
  const covered = (lit) => rows.some((r) => rowCovers(r, lit));
  const add = (file, line, name, how) =>
    problems.push(
      `${file}:${line} - ${how} \`${name}\` has no row in ${INVENTORY_RS}. Add an \`InventoryRow\` for it (id, base, path, writers: ["${lastPart(file)}"], category, personal, contains, created, sandbox), or, if it is not Compy data, mark the line \`${ALLOW}\` with the reason.`,
    );

  // 1a. Anything spelled like a Compy file name.
  for (const f of files) {
    const rawLines = linesOf(f.raw);
    if (NOT_DATA_MODULES[f.name]) {
      if (WRITE_CALL.test(f.code)) problems.push(`${f.file} is exempt from the inventory because it is ${NOT_DATA_MODULES[f.name]}, but it now calls a write function. Give its files rows and remove it from NOT_DATA_MODULES.`);
      continue;
    }
    for (const l of stringLiterals(f.code)) {
      if (!COMPY_FILE_LITERAL.test(normName(l.v)) || covered(l.v)) continue;
      if (rawLines.length && exempt(rawLines, l.line - 1)) continue;
      add(f.file, l.line, l.v, "the file name");
    }
  }

  // 1b. Names joined onto anything derived from the data root (catches folders and extensionless names).
  const accessors = new Set(["compy_data_dir", "session_data_dir", "mutation_root", "effective_root", ...derivedAccessors(files)]);
  const callsAccessor = new RegExp("\\b(?:" + [...accessors].join("|") + ")\\s*\\(|\\broot\\.path\\(\\)");
  const consts = constMap(files);
  for (const f of files) {
    if (NOT_DATA_MODULES[f.name]) continue;
    const rawLines = linesOf(f.raw);
    for (const ch of chunksOf(f.code)) {
      if (!callsAccessor.test(ch.text)) continue;
      for (const m of ch.text.matchAll(/\.(?:join|with_file_name)\(\s*(?:format!\(\s*)?("(?:[^"\\]|\\.)*"|[A-Z][A-Z0-9_]*\b)/g)) {
        const lit = m[1].startsWith('"') ? m[1].slice(1, -1) : consts.get(m[1])?.v;
        if (lit === undefined || lit === "" || covered(lit)) continue;
        const line = ch.line + ch.text.slice(0, m.index).split("\n").length - 1;
        if (rawLines.length && exempt(rawLines, line - 1)) continue;
        add(f.file, line, lit, "the name joined onto the data root,");
      }
    }
  }

  // 1c. File/folder-name constants anywhere in production code.
  for (const [name, c] of consts) {
    if (!/(?:_FILE|_DIR|_FILE_NAME|_DIR_NAME)$/.test(name) || NOT_DATA_MODULES[c.file]) continue;
    if (!covered(c.v)) add(c.file, c.line, c.v, `the constant ${name} names a file or folder that`);
  }

  // 2. Every row still has a writer.
  const byName = new Map();
  for (const f of files) byName.set(f.name, [...(byName.get(f.name) ?? []), f]);
  for (const r of rows) {
    if (!r.writers?.length) { problems.push(`row \`${r.id}\` names no writer module.`); continue; }
    const mods = r.writers.flatMap((w) => byName.get(w) ?? []);
    if (!mods.length) { problems.push(`row \`${r.id}\` names writer(s) ${JSON.stringify(r.writers)} that are not production modules under ${BACKEND}. Fix the row or delete it.`); continue; }
    const lits = mods.flatMap((m) => stringLiterals(m.code).map((l) => l.v));
    const alive = lits.some((l) => rowCovers(r, l)) || (r.proof && mods.some((m) => m.code.includes(r.proof)));
    if (!alive) problems.push(`row \`${r.id}\` (${r.path}) is not spelled by any of its writers ${JSON.stringify(r.writers)} any more. If Compy no longer stores it, delete the row; if a different module writes it now, change \`writers\`.`);
  }
  const seen = new Set();
  for (const r of rows) { if (seen.has(r.id)) problems.push(`duplicate row id \`${r.id}\`.`); seen.add(r.id); }

  // 3. Browser storage keys.
  if (ctx.webSources) {
    const listed = inv.keys.map((k) => k.key);
    const used = new Map();
    for (const w of ctx.webSources) {
      w.text.split(/\r?\n/).forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
        for (const m of line.matchAll(/["'`](compy[_.][A-Za-z0-9_.]*(?:\$\{[^}]*\}[A-Za-z0-9_.]*)*)["'`]/g)) {
          const k = normName(m[1].replace(/\$\{[^}]*\}/g, "*"));
          if (!used.has(k)) used.set(k, `${w.file}:${i + 1}`);
        }
        for (const m of line.matchAll(/\b(?:(?:localStorage|sessionStorage)\.(?:get|set|remove)Item|lsGet|lsSet|lsRemove)\(\s*["'`]([^"'`]+)["'`]/g)) {
          if (!/^compy[_.]/.test(m[1])) problems.push(`${w.file}:${i + 1} - browser storage key \`${m[1]}\` is outside the compy_ namespace and has no entry in WEBVIEW_KEYS in ${INVENTORY_RS}.`);
        }
      });
    }
    const listedNorm = new Set(listed.map(normName));
    for (const [k, where] of used) {
      if (!listedNorm.has(k)) problems.push(`${where} - browser storage key \`${k}\` has no entry in WEBVIEW_KEYS in ${INVENTORY_RS}. Add a \`WebviewKey\` (key, kind, category, personal, holds).`);
    }
    for (const k of listed) {
      if (!used.has(normName(k))) problems.push(`WEBVIEW_KEYS lists \`${k}\` but no file under ${SRC_TS}/ spells it any more. Delete the entry.`);
    }
  }
  return problems;
}

function webSources() {
  const out = [];
  for (const ext of [".ts", ".tsx"]) {
    for (const file of collect(SRC_TS, ext)) {
      if (/\.test\.|\.d\.ts$/.test(file) || /[\\/]test[\\/]/.test(file)) continue;
      out.push({ file, text: readFileSync(file, "utf8") });
    }
  }
  return out;
}

describe("data inventory guard: everything Compy stores is listed, and every listed item is still stored", () => {
  const rs = readFileSync(INVENTORY_RS, "utf8");
  const inv = readInventory(rs);
  // The table is the thing being checked, not a writer: its own spellings must not vouch for themselves.
  const files = productionFiles(BACKEND).filter((f) => f.name !== "data_inventory.rs");
  const web = webSources();

  it("the table parses, and the lists are not empty", () => {
    expect(inv.rows.length, "InventoryRow literals were not found; keep one `InventoryRow { .. }` per entry").toBeGreaterThan(40);
    expect(inv.keys.length, "WebviewKey literals were not found").toBeGreaterThan(40);
    expect(files.length, "no production Rust was read").toBeGreaterThan(40);
    for (const r of inv.rows) {
      for (const f of ["id", "base", "path", "writers", "category", "personal", "contains", "created", "sandbox"]) {
        expect(r[f], `row ${r.id ?? JSON.stringify(r).slice(0, 60)} is missing \`${f}\``).toBeDefined();
      }
    }
  });

  it("every file or folder name Compy writes has an inventory row, and every row still has a writer", () => {
    const problems = checkInventory(files, inv, { webSources: web });
    expect(problems, `data_inventory.rs is out of step with the code:\n${problems.join("\n")}`).toEqual([]);
  });

  it("the page keeps data only in local and session storage", () => {
    const offenders = [];
    for (const w of web) {
      w.text.split(/\r?\n/).forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
        if (/\bindexedDB\b|document\.cookie|\bcaches\.(open|match)\b|\bopenDatabase\b/.test(line)) offenders.push(`${w.file}:${i + 1} - ${t}`);
      });
    }
    expect(offenders, `These store data somewhere other than local/session storage. Add a row for it in ${INVENTORY_RS} and teach this guard:\n${offenders.join("\n")}`).toEqual([]);
  });

  // Break checks, kept as tests: the guard must fail on planted input, with a message that says what to add.
  describe("break checks", () => {
    const plant = (name, code) => ({ file: join(BACKEND, name), name, code, raw: "" });

    it("a planted writer with no row fails and says what to add", () => {
      const fake = plant("brand_new_store.rs", 'fn p() -> std::path::PathBuf {\n  crate::compy_data_dir().join("brand-new-store.json")\n}\n');
      const problems = checkInventory([...files, fake], inv);
      expect(problems.some((p) => p.includes("brand-new-store.json") && p.includes("Add an `InventoryRow`") && p.includes("data_inventory.rs"))).toBe(true);
    });

    it("a planted folder with no extension, joined onto the data root, fails", () => {
      const fake = plant("brand_new_folder.rs", 'fn f() {\n  let d = crate::compy_data_dir().join("brand-new-folder");\n}\n');
      expect(checkInventory([...files, fake], inv).some((p) => p.includes("brand-new-folder"))).toBe(true);
    });

    it("a planted file name passed to a derived accessor's join fails", () => {
      const fake = plant("brand_new_cache.rs", 'fn d() -> PathBuf {\n  crate::compy_data_dir().join("cache-dir")\n}\nfn e() {\n  let p = d().join("inner-name");\n}\n');
      expect(checkInventory([...files, fake], inv).some((p) => p.includes("inner-name"))).toBe(true);
    });

    it("a planted file-name constant with no row fails", () => {
      const fake = plant("brand_new_const.rs", 'const NEW_STORE_FILE: &str = "newstore";\n');
      expect(checkInventory([...files, fake], inv).some((p) => p.includes("NEW_STORE_FILE") && p.includes("newstore"))).toBe(true);
    });

    it("a name that appears only in a test is not data", () => {
      const src = '#[cfg(test)]\nmod tests {\n  fn t() { let _ = "only-in-a-test.json"; }\n}\n#[test]\nfn solo() { let _ = "solo-test.json"; }\n';
      const prod = productionRust(src).code;
      expect(stringLiterals(prod).length).toBe(0);
    });

    it("a planted row with no writer fails and says to delete or move it", () => {
      const fake = { ...inv, rows: [...inv.rows, { id: "ghost", base: "Base::DataRoot", path: "ghost-file.json", writers: ["sessions.rs"], names_in_code: [], proof: "" }] };
      const problems = checkInventory(files, fake);
      expect(problems.some((p) => p.includes("`ghost`") && p.includes("delete the row"))).toBe(true);
    });

    it("a planted row naming a module that does not exist fails", () => {
      const fake = { ...inv, rows: [...inv.rows, { id: "orphan", base: "Base::DataRoot", path: "orphan.json", writers: ["no_such_module.rs"] }] };
      expect(checkInventory(files, fake).some((p) => p.includes("no_such_module.rs"))).toBe(true);
    });

    it("a planted browser-storage key with no entry fails, and a stale entry fails", () => {
      const withKey = checkInventory(files, inv, { webSources: [...web, { file: "src/Fake.tsx", text: 'localStorage.setItem("compy_brand_new_flag", "1");\n' }] });
      expect(withKey.some((p) => p.includes("compy_brand_new_flag") && p.includes("WEBVIEW_KEYS"))).toBe(true);
      const stale = checkInventory(files, { ...inv, keys: [...inv.keys, { key: "compy_ghost_key" }] }, { webSources: web });
      expect(stale.some((p) => p.includes("compy_ghost_key") && p.includes("Delete the entry"))).toBe(true);
      const foreign = checkInventory(files, inv, { webSources: [...web, { file: "src/Fake.tsx", text: 'localStorage.getItem("someotherkey");\n' }] });
      expect(foreign.some((p) => p.includes("someotherkey") && p.includes("outside the compy_ namespace"))).toBe(true);
    });

    it("the allow marker exempts a planted name that is not data", () => {
      const raw = '// data-root-allow: a name inside a game folder, not Compy data\nlet _ = "game-owned.json";\n';
      const lines = raw.split("\n").map((text, i) => ({ n: i + 1, text, isComment: text.trimStart().startsWith("//") }));
      expect(exempt(lines, 1)).toBe(true);
    });
  });
});
