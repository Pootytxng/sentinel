// @vitest-environment node
// bug→guard (version bump 0.9.0, 2026-07-16): the app version lives in THREE manifests
// (tauri.conf.json — the one NSIS/installer filenames derive from — plus Cargo.toml and
// package.json) and echoes into Cargo.lock. Nothing mechanically held them equal, and
// scripts/ship-reinstall.ps1 additionally hardcoded the installer filename — 0.1.0 sat there
// as a silent drift site waiting for the first real bump. Invariants:
//   Guard A: all three manifests + Cargo.lock state the SAME version.
//   Guard B: ship-reinstall.ps1 contains NO hardcoded Compy_<semver> installer literal —
//   it must derive the filename from tauri.conf.json (the single source of truth).
//   Guard C: ship-reinstall.ps1 starts with a UTF-8 BOM — Windows PowerShell 5.1 decodes a
//   BOM-less file as ANSI, turning its em-dashes into mojibake that parse-errors the whole
//   script (caught live at the 0.9.0 ship after an edit re-saved the file without the BOM).
// Policy: docs/superpowers/specs/2026-07-16-version-policy-proposal.md (0.9.0 now, 1.0.0 at the bar).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const tauriVersion = JSON.parse(read("src-tauri/tauri.conf.json")).version;
const packageVersion = JSON.parse(read("package.json")).version;
const cargoToml = read("src-tauri/Cargo.toml");
const cargoTomlVersion = cargoToml.match(
  /\[package\][^[]*?^version = "([^"]+)"/ms
)?.[1];
const cargoLock = read("src-tauri/Cargo.lock");
const cargoLockVersion = cargoLock.match(
  /name = "compy"\nversion = "([^"]+)"/
)?.[1];

describe("Guard A — one app version across all three manifests + Cargo.lock", () => {
  it("tauri.conf.json states a semver", () => {
    expect(tauriVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("package.json matches tauri.conf.json", () => {
    expect(packageVersion).toBe(tauriVersion);
  });
  it("Cargo.toml [package] matches tauri.conf.json", () => {
    expect(cargoTomlVersion).toBe(tauriVersion);
  });
  it("Cargo.lock compy entry matches (run `cargo check` after a bump)", () => {
    expect(cargoLockVersion).toBe(tauriVersion);
  });
});

describe("Guard B — ship-reinstall.ps1 derives the installer name, never hardcodes it", () => {
  const ps1 = read("scripts/ship-reinstall.ps1");
  it("contains no hardcoded Compy_<semver> installer literal", () => {
    expect(ps1).not.toMatch(/Compy_\d+\.\d+\.\d+/);
  });
  it("reads the version from tauri.conf.json", () => {
    expect(ps1).toContain("tauri.conf.json");
    expect(ps1).toContain("Compy_${ver}_x64-setup.exe");
  });
});

describe("Guard C — ship-reinstall.ps1 keeps its UTF-8 BOM (PowerShell 5.1 reads ANSI without it)", () => {
  it("first character is U+FEFF", () => {
    // readFileSync("utf8") preserves a leading BOM as ﻿ — exactly what we pin.
    expect(read("scripts/ship-reinstall.ps1").charCodeAt(0)).toBe(0xfeff);
  });
});
