// Guard: the other writer the probe could not see.
//
// A claim exists so two writers never share a worktree, and `WATCHED` listed builders, installers
// and Code.exe — but not claude.exe. The one process that actually writes to a claimed folder was
// invisible to the contention row, which is the row that exists to notice it.
//
// The line stays where it was: presence is not contention. A Claude session in ANOTHER root is
// somebody else's business, and an editor or a live IDE bridge is not a writer at all.

import { describe, expect, it } from "vitest";
import { WATCHED, classifyProcesses } from "./processes.mjs";

const FOLDER = "C:\\Users\\Kuya\\code\\sentinel-marathon";
const OTHER = "C:\\Users\\Kuya\\code\\sentinel-feedback";
const of = (name) => (rows) => classifyProcesses(rows, { folder: FOLDER }).find((g) => g.name === name);

describe("a Claude session in the folder we are about to claim", () => {
  it("is watched at all", () => {
    expect(WATCHED).toContain("claude.exe");
  });

  it("contends when it is rooted in this folder", () => {
    const g = of("claude.exe")([{ name: "claude.exe", commandLine: `claude --ide ${FOLDER}` }]);
    expect(g.contends).toBe(true);
    expect(g.note).toMatch(/already working in this folder/i);
  });

  it("does not contend from another root — that is somebody else's claim, not ours to refuse", () => {
    expect(of("claude.exe")([{ name: "claude.exe", commandLine: `claude --ide ${OTHER}` }]).contends).toBe(false);
  });

  it("is still listed when it does not contend, because disclosure is the default", () => {
    expect(of("claude.exe")([{ name: "claude.exe", commandLine: `claude --ide ${OTHER}` }]).count).toBe(1);
  });
});

describe("what is still not a writer", () => {
  it("an editor open on this folder", () => {
    expect(of("Code.exe")([{ name: "Code.exe", commandLine: `Code.exe ${FOLDER}` }]).contends).toBe(false);
  });

  it("the installed app running, which has nothing to do with this folder", () => {
    expect(of("compy.exe")([{ name: "compy.exe", commandLine: "compy.exe" }]).contends).toBe(false);
  });
});

describe("what still is", () => {
  it("a build against this folder", () => {
    expect(of("cargo.exe")([{ name: "cargo.exe", commandLine: `cargo build --manifest-path ${FOLDER}\\src-tauri` }]).contends).toBe(true);
  });

  it("an installer, wherever it is running", () => {
    expect(of("msiexec.exe")([{ name: "msiexec.exe", commandLine: "msiexec /i compy.msi" }]).contends).toBe(true);
  });
});
