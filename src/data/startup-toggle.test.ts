import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { LEDGER_CHANGED_EVENT } from "../types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { setStartupEntryEnabled } from "./startup-toggle";

// #599: toggling a startup entry writes the Trust Ledger, but App.toggleStartup only flipped its own
// row — so Health and History kept the pre-click count until something else happened to re-read.
describe("a startup toggle tells the ledger readers and re-reads, like apply and rollback", () => {
  const steps: string[] = [];
  const onLedger = () => steps.push("event");

  beforeEach(() => {
    steps.length = 0;
    invokeMock.mockReset();
    window.addEventListener(LEDGER_CHANGED_EVENT, onLedger);
  });
  afterEach(() => window.removeEventListener(LEDGER_CHANGED_EVENT, onLedger));

  it("toggles, then announces the ledger change, then refreshes — in that order", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      steps.push(`invoke:${cmd}`);
    });
    await setStartupEntryEnabled("Discord", false, async () => {
      steps.push("refresh");
    });
    expect(invokeMock).toHaveBeenCalledWith("set_startup_entry_enabled", {
      name: "Discord",
      enabled: false,
    });
    expect(steps).toEqual(["invoke:set_startup_entry_enabled", "event", "refresh"]);
  });

  it("waits for the refresh to settle before it returns, so the caller's busy state covers it", async () => {
    invokeMock.mockResolvedValue(undefined);
    let settled = false;
    await setStartupEntryEnabled("Steam", true, () =>
      new Promise<void>((r) =>
        setTimeout(() => {
          settled = true;
          r();
        }, 0),
      ),
    );
    expect(settled).toBe(true);
  });

  it("a toggle that failed announces nothing and re-reads nothing, and the caller sees the error", async () => {
    invokeMock.mockRejectedValue(new Error("access denied"));
    const refresh = vi.fn();
    await expect(setStartupEntryEnabled("Discord", false, refresh)).rejects.toThrow("access denied");
    expect(steps).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });
});

// The fix only holds while nothing goes around the helper: a second direct invoke is the silent
// toggle again. Comments are stripped, since prose may name the command (Fix.tsx does).
describe("the startup toggle has one owner", () => {
  // Relative to the repo root, as the other static guards read the tree (no node types here).
  const SRC = "src";
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
    return out;
  };
  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  const rel = (p: string) => p.slice(SRC.length + 1).replace(/[\\/]+/g, "/");
  const code = (p: string) => strip(readFileSync(join(SRC, p), "utf8"));

  // ledger-write.ts names it only in its command list (#619), never as a call.
  it("only startup-toggle.ts names the command in code, besides the ledger-write command list", () => {
    const owners = walk(SRC)
      .filter((p) => strip(readFileSync(p, "utf8")).includes("set_startup_entry_enabled"))
      .map(rel)
      .sort();
    expect(owners).toEqual(["data/ledger-write.ts", "data/startup-toggle.ts"]);
  });

  it("App's toggle and Check's disable both route through it, handing it their refresh", () => {
    expect(code("App.tsx")).toMatch(
      /const toggleStartup = async[\s\S]*?setStartupEntryEnabled\([\s\S]*?\brefresh\(\)/,
    );
    expect(code("surfaces/Check.tsx")).toMatch(
      /const disableStartup = async[\s\S]*?setStartupEntryEnabled\([\s\S]*?onChanged\(\)/,
    );
  });
});
