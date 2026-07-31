// Guard: live processes are disclosed, and only a genuinely CONTENDING one refuses.
//
// Both directions matter. Refusing because the installed Compy happens to be running would make the
// entrypoint cry wolf, and a launcher that cries wolf gets bypassed — which is how the invariant
// dies. Letting a build run in the folder we are about to write to is the opposite failure.
//
// Collision rule 6: never stop another tool's build, helper, editor or session to clear a claim.

import { describe, expect, it } from "vitest";
import { classifyProcesses } from "./processes.mjs";

const FOLDER = "C:\\Users\\Kuya\\code\\sentinel-workflow";
const OTHER = "C:\\Users\\Kuya\\code\\sentinel-rel";

describe("classification", () => {
  it("discloses the installed app without refusing — it is not this train's process", () => {
    const r = classifyProcesses([{ name: "compy.exe", commandLine: "C:\\Users\\Kuya\\AppData\\Local\\Compy\\compy.exe" }], { folder: FOLDER });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: "compy.exe", count: 1, contends: false });
  });

  it("refuses a build running in the target folder", () => {
    const r = classifyProcesses([{ name: "cargo.exe", commandLine: `cargo build --manifest-path ${FOLDER}\\src-tauri\\Cargo.toml` }], { folder: FOLDER });
    expect(r[0].contends).toBe(true);
    expect(r[0].note).toMatch(/this folder/i);
  });

  it("does NOT refuse a build running in someone else's folder", () => {
    const r = classifyProcesses([{ name: "cargo.exe", commandLine: `cargo build --manifest-path ${OTHER}\\src-tauri\\Cargo.toml` }], { folder: FOLDER });
    expect(r[0].contends).toBe(false);
  });

  it("matches folders case-insensitively", () => {
    const r = classifyProcesses([{ name: "node.exe", commandLine: `node ${FOLDER.toLowerCase()}\\scripts\\run-vitest.mjs` }], { folder: FOLDER });
    expect(r[0].contends).toBe(true);
  });

  it("groups identical names into one row with a count", () => {
    const r = classifyProcesses(
      [
        { name: "node.exe", commandLine: "node a" },
        { name: "node.exe", commandLine: "node b" },
        { name: "compy.exe", commandLine: "compy" },
      ],
      { folder: FOLDER },
    );
    expect(r.find((p) => p.name === "node.exe").count).toBe(2);
    expect(r).toHaveLength(2);
  });

  it("refuses an installer, wherever it is running — an install is machine-wide", () => {
    const r = classifyProcesses([{ name: "compy_0.9.11_x64-setup.exe", commandLine: "C:\\Users\\Kuya\\Desktop\\compy_0.9.11_x64-setup.exe /S" }], { folder: FOLDER });
    expect(r[0].contends).toBe(true);
  });

  it("never suggests stopping anything (collision rule 6)", () => {
    const r = classifyProcesses([{ name: "cargo.exe", commandLine: `cargo build ${FOLDER}` }], { folder: FOLDER });
    expect(JSON.stringify(r)).not.toMatch(/taskkill|Stop-Process|kill/i);
  });

  it("returns an empty list rather than throwing when nothing is running", () => {
    expect(classifyProcesses([], { folder: FOLDER })).toEqual([]);
    expect(classifyProcesses(null, { folder: FOLDER })).toEqual([]);
  });
});
