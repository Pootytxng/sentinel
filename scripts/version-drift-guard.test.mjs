// @vitest-environment node
// bug→guard (version bump 0.9.0, 2026-07-16): the app version lives in THREE manifests
// (tauri.conf.json — the one NSIS/installer filenames derive from — plus Cargo.toml and
// package.json) and echoes into Cargo.lock. Nothing mechanically held them equal, and
// scripts/ship-reinstall.ps1 additionally hardcoded the installer filename — 0.1.0 sat there
// as a silent drift site waiting for the first real bump. Invariants:
//   Guard A: all three manifests + Cargo.lock state the SAME version.
//   Guard B: ship-reinstall.ps1 contains NO hardcoded Compy_<semver> installer literal —
//   it must derive the filename from tauri.conf.json (the single source of truth).
//   Guard C: EVERY scripts/**/*.ps1 holding a non-ASCII byte starts with a UTF-8 BOM — Windows
//   PowerShell 5.1 decodes a BOM-less file as ANSI, so an em-dash becomes the mojibake `a€"`
//   whose trailing byte is a SMART QUOTE, which 5.1 honours as a string delimiter — one em-dash
//   inside a string unterminates it and parse-errors the whole file. Caught live twice: at the
//   0.9.0 ship (ship-reinstall.ps1 re-saved without its BOM) and on 2026-08-18, when
//   scripts/lib/canonical-data-root.ps1 shipped BOM-less in #130 and killed ship-reinstall.ps1
//   through the dot-source — the guard covered only the entry script, never the libs it loads.
// Policy: docs/superpowers/specs/2026-07-16-version-policy-proposal.md (0.9.0 now, 1.0.0 at the bar).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
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

describe("Guard C — every non-ASCII scripts/*.ps1 keeps its UTF-8 BOM (5.1 reads ANSI without it)", () => {
  // Walk scripts/ rather than naming files: the 2026-08-18 failure was a NEW lib nobody thought
  // to add to a list. A guard you have to remember to extend is the guard that already failed.
  const ps1Files = [];
  (function walk(dir) {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith(".ps1")) ps1Files.push(rel);
    }
  })("scripts");

  // Read as BYTES: reading utf8 would silently repair the very thing under test.
  const bytes = (p) => readFileSync(join(root, p));
  const hasBom = (b) => b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
  const hasNonAscii = (b) => b.some((x) => x > 0x7f);

  it("finds the .ps1 files at all (a zero-file sweep would pass vacuously)", () => {
    expect(ps1Files.length).toBeGreaterThan(20);
    expect(ps1Files).toContain("scripts/ship-reinstall.ps1");
    expect(ps1Files).toContain("scripts/lib/canonical-data-root.ps1");
  });

  it("DISARM PROOF: the predicate rejects a BOM-less em-dash file", () => {
    const emDash = Buffer.from("# a — b", "utf8");
    expect(hasNonAscii(emDash)).toBe(true);
    expect(hasBom(emDash)).toBe(false);
  });

  it("no .ps1 carries non-ASCII without a BOM", () => {
    const offenders = ps1Files.filter((p) => {
      const b = bytes(p);
      return hasNonAscii(b) && !hasBom(b);
    });
    expect(
      offenders,
      `These PowerShell files contain non-ASCII (em-dash, arrow, smart quote) but have no UTF-8 ` +
        `BOM. Windows PowerShell 5.1 will decode them as ANSI and parse-error the file — and if ` +
        `any of them is dot-sourced by ship-reinstall.ps1 or release.ps1, that ships nothing. ` +
        `Fix: re-save each with a UTF-8 BOM (do NOT just delete the em-dash; the next one lands ` +
        `the same way).`,
    ).toEqual([]);
  });
});

describe("Guard E — the ship proof's frontend version cross-check has a live source", () => {
  // bug->guard (2026-08-18): navigation audit s4 moved build identifiers out of the rail. The DOM
  // read that scripts/lib/runtime-proof.ps1 depended on went with them, so `powershell
  // ship-reinstall.ps1 -VerifyRuntime` died on a missing property — the LAW-mandated ship path,
  // broken by a UI decision three files away. The seam replaces the DOM read; these pins make the
  // two ends fail together instead of one end going quiet.
  const app = read("src/App.tsx");
  const probe = read("scripts/e2e-updater-probe.mjs");
  const proof = read("scripts/lib/runtime-proof.ps1");

  it("App.tsx publishes the built version on the global, from the canonical constant", () => {
    expect(app).toMatch(/__COMPY_UI_VERSION__\s*\]?\s*=\s*APP_VERSION/);
    expect(app).toContain("const APP_VERSION = pkg.version;");
  });

  it("the probe reads that same global in its DEFAULT preset (not only `about`)", () => {
    const stampPreset = probe.slice(probe.indexOf("stamp: `"), probe.indexOf("  // Settings"));
    expect(stampPreset).toContain("__COMPY_UI_VERSION__");
    expect(stampPreset).toContain("uiVersion:");
  });

  it("the PowerShell proof still COMPARES it — a mount check alone would pass a stale bundle", () => {
    expect(proof).toContain("$payload.uiVersion");
    expect(proof).toContain("-cne $ExpectedVersion");
    expect(proof).not.toContain("railVersion");
  });
});

describe("Guard D — the VISIBLE app version tracks the canonical manifest, never a literal", () => {
  // bug→guard (2026-07-19): the version shown in the app rail (src/App.tsx APP_VERSION) was a
  // hardcoded "0.1.0" — invisible to Guards A–C, which only cover the manifests + installer. It
  // sat two minor versions behind the shipped 0.9.0 build. The fix wires the rail to the SAME
  // canonical source (package.json) via a JSON import, so a future bump can't leave the UI behind.
  const app = read("src/App.tsx");
  const appVersionLine = app.match(/^const APP_VERSION = .*$/m)?.[0];

  it("App.tsx imports the version object from package.json", () => {
    expect(app).toMatch(/import\s+pkg\s+from\s+["']\.\.\/package\.json["']/);
  });
  it("APP_VERSION is assigned from the imported manifest (pkg.version)", () => {
    expect(appVersionLine).toBeDefined();
    expect(appVersionLine).toContain("pkg.version");
  });
  it("APP_VERSION is EXACTLY `const APP_VERSION = pkg.version;` (the required production assignment)", () => {
    // corrective follow-up (2026-07-20): pin the exact assignment, not merely "contains pkg.version".
    // A form like `const APP_VERSION = pkg.version || "0.9.0";` would satisfy the looser check while
    // smuggling a hardcoded fallback literal back into the shipped UI — this forbids that whole class.
    expect(appVersionLine).toBe("const APP_VERSION = pkg.version;");
  });
  it("APP_VERSION carries no hardcoded semver literal", () => {
    expect(appVersionLine).not.toMatch(/["']\d+\.\d+\.\d+["']/);
  });
});

describe("Guard E — the production render site consumes APP_VERSION, never a literal", () => {
  // corrective follow-up (2026-07-20): Guard D pins the DECLARATION
  // (`const APP_VERSION = pkg.version;`), but a render site could still hand a hardcoded semver to a
  // component and bypass it entirely (e.g. `<Settings appVersion="0.1.0" />`) — the UI would show
  // stale text while Guard D stayed green. Pin the site to the constant and forbid a semver literal
  // at any version prop, so wiring a fresh site to a literal fails the guard.
  //
  // ONE site, not two, since 2026-08-18. APP_VERSION used to also reach `<ShellV2 version=…>`, which
  // printed it beside the wordmark on every screen; the navigation audit §4 moved build identifiers
  // into Settings → About and the prop was removed with the render rather than left dangling. The
  // guard did NOT shrink: the literal check below still covers every `version=`/`appVersion=` prop
  // in the file, and the new assertion below pins the removal itself, so re-wiring the shell to a
  // version is a deliberate act that has to come here first.
  const app = read("src/App.tsx");

  it("the Settings render site passes appVersion={APP_VERSION}", () => {
    expect(app).toContain("appVersion={APP_VERSION}");
  });
  it("the shell is handed NO version — build identifiers live in Settings -> About", () => {
    // Deliberately the bare prop, not `version={APP_VERSION}`: the point is that chrome on every
    // screen carries no build identifier at all, whatever its source. `appVersion=` is excluded by
    // the leading boundary so the Settings site above cannot satisfy or trip this.
    const HANDED_A_VERSION = /(?<![A-Za-z])version=/;
    // DISARM PROOF. A `not.toMatch` passes just as green when the pattern can never match anything,
    // and this one leans on a lookbehind that is easy to get backwards. Prove both directions on
    // fixed strings before trusting the verdict on the real file.
    expect(HANDED_A_VERSION.test("<ShellV2 version={APP_VERSION}>"), "would not catch the prop").toBe(true);
    expect(HANDED_A_VERSION.test('<ShellV2 version="0.9.25">'), "would not catch a literal").toBe(true);
    expect(HANDED_A_VERSION.test("<Settings appVersion={APP_VERSION} />"), "false-positives on Settings").toBe(false);

    expect(app, "ShellV2 is being handed a version again").not.toMatch(HANDED_A_VERSION);
  });
  it("no version prop is fed a hardcoded semver literal", () => {
    // matches appVersion="1.2.3" / appVersion={"1.2.3"} / version="1.2.3" / version={"1.2.3"};
    // the wired `={APP_VERSION}` form has no quoted digits, so it never trips this.
    expect(app).not.toMatch(/\b(?:appVersion|version)=\{?\s*["']\d+\.\d+\.\d+["']/);
  });
});

describe("Guard F — installer metadata is valid Unicode, not double-encoded mojibake", () => {
  const config = JSON.parse(read("src-tauri/tauri.conf.json"));

  it("renders the intended copyright string", () => {
    expect(config.bundle.copyright).toBe("© 2026 Pootytxng");
  });

  it("keeps mojibake markers out of the raw bundle metadata", () => {
    expect(read("src-tauri/tauri.conf.json")).not.toContain("Ã");
  });
});
