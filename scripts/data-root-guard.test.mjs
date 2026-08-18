import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
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

  it("both release preflights prove the root before reading it", () => {
    for (const script of [join(SCRIPTS, "release.ps1"), join(SCRIPTS, "ship-reinstall.ps1")]) {
      const text = readFileSync(script, "utf8");
      expect(text, `${script} must dot-source the shared preflight`).toContain("canonical-data-root.ps1");
      expect(text, `${script} must call it`).toMatch(/Get-CanonicalCompyDataRoot/);
    }
  });
});
