// Guards for the Desktop shortcut — the one artifact of this program that is not a tracked file.
//
// Everything else in tools/entry is proved by tests that run over code in the repository. The
// shortcut is a .lnk on Kuya's Desktop, so for the whole of this program it was the single component
// nothing had an opinion about, and it shipped with two defects nobody could have caught: -NoExit
// (guard 13, in a program whose whole point is to stop handing him chores) and a version-pinned
// PowerShell package path that the next Store update would have quietly deleted.
//
// The first test is the defect exactly as found. It is the red proof, kept permanently.

import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { findDesktopShortcut, planShortcut, readShortcut, scriptFromArgs, VERSIONED_PACKAGE } from "./shortcut.mjs";

const CONTROL = "C:\\Users\\Kuya\\code\\compy-control";
const ALIAS = "C:\\Users\\Kuya\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe";
const GOOD = { target: ALIAS, args: `-NoProfile -File "${CONTROL}\\compy-entry.ps1"`, controlDir: CONTROL };
const codes = (p) => p.defects.map((d) => d.code);

describe("the shortcut as it actually shipped", () => {
  // Verbatim from the .lnk read off the Desktop on 2026-07-30, before the fix.
  const AS_SHIPPED = {
    target: "C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.4.0_x64__8wekyb3d8bbwe\\pwsh.exe",
    args: `-NoExit -NoProfile -File "${CONTROL}\\compy-entry.ps1"`,
    controlDir: CONTROL,
  };

  it("is REFUSED, and for both of the reasons it was actually wrong", () => {
    const plan = planShortcut(AS_SHIPPED);
    expect(plan.ok).toBe(false);
    expect(codes(plan)).toEqual(expect.arrayContaining(["args.noExit", "target.versioned"]));
  });

  it("says what the owner would have LOST, not what the property is called", () => {
    const plan = planShortcut(AS_SHIPPED);
    const noExit = plan.defects.find((d) => d.code === "args.noExit");
    expect(noExit.reason).toMatch(/window/i);
    const versioned = plan.defects.find((d) => d.code === "target.versioned");
    expect(versioned.reason).toMatch(/update/i);
    for (const d of plan.defects) expect(d.remediation.length).toBeGreaterThan(10);
  });

  it("passes once repaired the way it was repaired", () => {
    expect(planShortcut(GOOD)).toEqual({ ok: true, defects: [] });
  });
});

describe("planShortcut", () => {
  it("refuses -NoExit anywhere in the argument string, not just at the front", () => {
    const plan = planShortcut({ ...GOOD, args: `-NoProfile -File "${CONTROL}\\compy-entry.ps1" -NoExit` });
    expect(codes(plan)).toContain("args.noExit");
  });

  it("does not mistake -NoExitSomething, or a path that contains the word, for the switch", () => {
    expect(planShortcut({ ...GOOD, args: `-NoProfile -NoExitPolicy -File "${CONTROL}\\compy-entry.ps1"` }).defects.map((d) => d.code)).not.toContain("args.noExit");
    expect(planShortcut({ ...GOOD, args: `-NoProfile -File "C:\\noexit\\compy-entry.ps1"` }).defects.map((d) => d.code)).not.toContain("args.noExit");
  });

  it("refuses ANY versioned package folder, not the one version that happened to be installed", () => {
    for (const v of ["7.6.4.0", "7.7.0.0", "8.0.1.0"]) {
      const target = `C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_${v}_x64__8wekyb3d8bbwe\\pwsh.exe`;
      expect(VERSIONED_PACKAGE.test(target)).toBe(true);
      expect(codes(planShortcut({ ...GOOD, target }))).toContain("target.versioned");
    }
  });

  it("accepts the execution alias, which is the whole point of preferring it", () => {
    expect(VERSIONED_PACKAGE.test(ALIAS)).toBe(false);
    expect(planShortcut(GOOD).ok).toBe(true);
  });

  it("refuses Windows PowerShell 5.1, which mis-decodes this repo's UTF-8 scripts", () => {
    const plan = planShortcut({ ...GOOD, target: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" });
    expect(codes(plan)).toContain("target.notPwsh");
    expect(plan.defects.find((d) => d.code === "target.notPwsh").reason).toMatch(/5\.1/);
  });

  it("refuses a missing -NoProfile, because a profile can export the very window the tier settles", () => {
    const plan = planShortcut({ ...GOOD, args: `-File "${CONTROL}\\compy-entry.ps1"` });
    expect(codes(plan)).toContain("args.profile");
    expect(plan.defects.find((d) => d.code === "args.profile").reason).toMatch(/window/i);
  });

  it("refuses a shortcut that opens a prompt instead of running the launcher", () => {
    expect(codes(planShortcut({ ...GOOD, args: "-NoProfile" }))).toContain("args.noScript");
  });

  it("refuses a launcher from somewhere other than the control folder", () => {
    const plan = planShortcut({ ...GOOD, args: `-NoProfile -File "C:\\Users\\Kuya\\code\\sentinel\\compy-entry.ps1"` });
    expect(codes(plan)).toContain("args.wrongScript");
    expect(plan.defects.find((d) => d.code === "args.wrongScript").reason).toContain("sentinel");
  });

  it("compares the script path case- and separator-insensitively, the way Windows resolves it", () => {
    expect(planShortcut({ ...GOOD, args: `-noprofile -file "c:/users/kuya/code/compy-control/COMPY-ENTRY.PS1"` }).ok).toBe(true);
  });

  it("refuses an empty target rather than reporting the absence as a wrong program", () => {
    const plan = planShortcut({ ...GOOD, target: "" });
    expect(codes(plan)).toEqual(["target.missing"]);
  });
});

describe("scriptFromArgs", () => {
  it("reads -File quoted, -File bare, and the -f abbreviation", () => {
    expect(scriptFromArgs('-NoProfile -File "C:\\a b\\entry.ps1"')).toBe("C:\\a b\\entry.ps1");
    expect(scriptFromArgs("-NoProfile -File C:\\a\\entry.ps1")).toBe("C:\\a\\entry.ps1");
    expect(scriptFromArgs("-f C:\\a\\entry.ps1")).toBe("C:\\a\\entry.ps1");
  });

  it("returns null rather than a guess when there is no -File at all", () => {
    expect(scriptFromArgs("-NoProfile -NoLogo")).toBe(null);
    expect(scriptFromArgs(undefined)).toBe(null);
  });
});

describe("findDesktopShortcut", () => {
  const world = (files, dirs = ["C:\\u\\Desktop"]) => ({
    home: "C:\\u",
    exists: (d) => dirs.includes(d),
    list: (d) => files[d] ?? [],
  });

  it("finds the shortcut whichever dash the owner's name for it uses", () => {
    for (const name of ["Compy - Start work.lnk", "Compy \u2013 Start work.lnk", "compy start work.LNK"]) {
      expect(findDesktopShortcut(world({ "C:\\u\\Desktop": ["other.lnk", name] }))).toBe(`C:\\u\\Desktop\\${name}`);
    }
  });

  it("looks in the OneDrive Desktop too, since Windows moves it there without asking", () => {
    const found = findDesktopShortcut({
      home: "C:\\u",
      exists: (d) => d === "C:\\u\\OneDrive\\Desktop",
      list: () => ["Compy - Start work.lnk"],
    });
    expect(found).toBe("C:\\u\\OneDrive\\Desktop\\Compy - Start work.lnk");
  });

  it("returns null rather than picking an unrelated shortcut", () => {
    expect(findDesktopShortcut(world({ "C:\\u\\Desktop": ["Compy.lnk", "Start work.lnk", "Company Start work.lnk"] }))).toBe(null);
    expect(findDesktopShortcut(world({}, []))).toBe(null);
  });
});

describe("readShortcut", () => {
  it("returns the three fields the planner needs", () => {
    const run = () => JSON.stringify({ target: ALIAS, args: "-NoProfile", workdir: CONTROL });
    expect(readShortcut({ path: "x.lnk", run })).toEqual({ target: ALIAS, args: "-NoProfile", workdir: CONTROL });
  });

  it("returns null instead of throwing when the shell cannot read it", () => {
    expect(readShortcut({ path: "missing.lnk", run: () => { throw new Error("no such file"); } })).toBe(null);
    expect(readShortcut({ path: "x.lnk", run: () => "not json" })).toBe(null);
  });
});

// Not a fixture. This asserts the shortcut Kuya will actually double-click on THIS machine, which is
// the only version of this claim that means anything.
describe("the real Desktop shortcut", () => {
  const lnk = findDesktopShortcut();

  it.runIf(lnk && existsSync(CONTROL))("passes every guard above", () => {
    const facts = readShortcut({ path: lnk });
    expect(facts, `could not read ${lnk}`).not.toBe(null);
    const plan = planShortcut({ ...facts, controlDir: CONTROL });
    expect(plan.defects, JSON.stringify({ lnk, ...facts })).toEqual([]);
  });
});
