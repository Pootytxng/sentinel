// Guard: no tracked text file may carry double-encoded (mojibake) text.
//
// Why this exists — docs/RELEASE_STATE.md, docs/archive/RELEASE_STATE_HISTORY.md,
// .claude/skills/INDEX.md and src-tauri/Cargo.toml all shipped corrupted. RELEASE_STATE.md is the
// authoritative gate matrix and had 42 corrupt lines; scripts/verify-release-state.mjs read it
// happily because it only parses STATE anchors. Commit 333b725 ("demojibake") fixed 2 of 44 lines
// and closed the item, so a human-eyeball fix already failed once on this exact class.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { findMojibake, recoverMojibake, repairText, repairToFixpoint, trackedTextFiles } from "./encoding-guard.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

// An em-dash (E2 80 94) re-read as CP1252 becomes exactly these three characters. Built from
// code points, not pasted, so this test file carries no double-encoded bytes of its own.
const CORRUPT_EM_DASH = String.fromCharCode(0xe2, 0x20ac, 0x201d);

describe("mojibake detection", () => {
  it("recovers the em-dash corruption that hit RELEASE_STATE.md", () => {
    const corrupt = `RELEASE_STATE.md ${CORRUPT_EM_DASH} Compy gate matrix`;
    expect(recoverMojibake(corrupt).text).toBe("RELEASE_STATE.md — Compy gate matrix");
  });

  it("peels layered corruption, as found in src-tauri/Cargo.toml", () => {
    const clean = "default OFF — close still exits";
    const cp1252 = new TextDecoder("windows-1252");
    let corrupt = clean;
    for (let pass = 0; pass < 4; pass += 1) corrupt = cp1252.decode(Buffer.from(corrupt, "utf8"));

    expect(corrupt).not.toBe(clean);
    expect(recoverMojibake(corrupt).text).not.toBe(clean); // one pass is not enough
    expect(repairToFixpoint(corrupt).text).toBe(clean);
  });

  it("reports the line number of each corrupt span", () => {
    const hits = findMojibake(`clean line\nsecond ${CORRUPT_EM_DASH} here\n`);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
    expect(hits[0].recovered).toBe("—");
  });

  // False positives would make the guard unrunnable — the app ships zh-CN copy and emoji.
  it("leaves legitimate non-ASCII text untouched", () => {
    const legit = [
      "em-dash — en-dash – ellipsis…",
      "curly ‘quotes’ and “doubles”",
      "zh-CN: 实际测量的性能提升",
      "emoji: ✅ ❌ 🔴 arrows → ≥ ±",
      "accents: café naïve Zürich señor",
      "section §1 and degree 45°C",
    ].join("\n");
    expect(recoverMojibake(legit).text).toBe(legit);
    expect(findMojibake(legit)).toHaveLength(0);
  });

  it("honours the per-line opt-out for text that is corrupt on purpose", () => {
    const cp1252 = new TextDecoder("windows-1252");
    const corrupt = cp1252.decode(Buffer.from("looks like —", "utf8"));
    expect(findMojibake(corrupt)).toHaveLength(1);
    expect(findMojibake(`${corrupt} encoding-guard:allow`)).toHaveLength(0);
    const exempt = `${corrupt} encoding-guard:allow`;
    expect(repairText(exempt).text).toBe(exempt);
  });

  it("never rewrites a span it cannot prove", () => {
    // Lead byte present, but the follower is not a continuation byte — must pass through.
    const unprovable = "Ã alone and Â alone";
    expect(recoverMojibake(unprovable).text).toBe(unprovable);
  });
});

// The corruption was not hand-typed: scripts/release.ps1 read-modify-writes tauri.conf.json,
// package.json, Cargo.lock, Cargo.toml and RELEASE_STATE.md during a version bump. Under Windows
// PowerShell 5.1 `Get-Content -Raw` decodes a BOM-less file as CP1252, so pairing it with
// Write-NoBom (UTF-8) double-encodes the whole file. Repairing the bytes without pinning this
// would just re-corrupt them on the next release cut.
describe("release tooling reads UTF-8 explicitly", () => {
  const script = readFileSync(join(repoRoot, "scripts/release.ps1"), "utf8");

  it("never feeds Get-Content into Write-NoBom", () => {
    const offenders = script
      .split("\n")
      .map((line, index) => ({ line: index + 1, text: line }))
      .filter(({ text }) => !text.trim().startsWith("#"))
      .filter(({ text }) => text.includes("Write-NoBom") && text.includes("Get-Content"));
    expect(offenders.map((o) => `${o.line}: ${o.text.trim()}`)).toEqual([]);
  });

  it("routes every rewritten file through Read-Utf8", () => {
    expect(script).toMatch(/function Read-Utf8/);
    for (const target of ["$confPath", "$pkgPath", "$lockPath", "$cargoPath", "$statePath"]) {
      expect(script, `${target} must be read with Read-Utf8`).toContain(`Read-Utf8 ${target}`);
    }
  });
});

describe("tracked text files", () => {
  const files = trackedTextFiles(repoRoot);

  it("finds a meaningful set of files to scan", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("docs/RELEASE_STATE.md");
    expect(files).toContain("src-tauri/Cargo.toml");
  });

  it("carries no double-encoded text", () => {
    const dirty = [];
    for (const file of files) {
      let text;
      try {
        text = strictUtf8.decode(readFileSync(join(repoRoot, file)));
      } catch {
        continue; // not UTF-8 — a different defect, not this guard's claim
      }
      const hits = findMojibake(text);
      if (hits.length) dirty.push(`${file}: ${hits.length} span(s), first at line ${hits[0].line} (${JSON.stringify(hits[0].consumed)} -> ${JSON.stringify(hits[0].recovered)})`);
    }
    expect(dirty, `repair with: node scripts/encoding-guard.mjs --fix\n${dirty.join("\n")}`).toEqual([]);
  });
});
