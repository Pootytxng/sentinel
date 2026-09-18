// Pins .claude/hooks/subagent-throttle.mjs to the token-economy law (#479): delegating verbose work
// to a subagent is the recommended default, so a single delegation — or a steady sequence of them —
// must never draw a nudge. Only a burst (fan-out) does, once per burst.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BURST, WINDOW_MS, decide } from "../.claude/hooks/subagent-throttle.mjs";

const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".claude", "hooks", "subagent-throttle.mjs");

const run = (times) => {
  let state = {};
  return times.map((t) => {
    const out = decide(state, t);
    state = out.state;
    return out.warning;
  });
};

describe("subagent-throttle flags fan-out, never delegation", () => {
  it("a single spawn is silent", () => {
    expect(run([0])).toEqual([null]);
  });

  it("a steady sequence of delegations is silent, however long the session", () => {
    const steady = Array.from({ length: 30 }, (_, i) => i * (WINDOW_MS / (BURST - 1)));
    expect(run(steady).filter(Boolean)).toEqual([]);
  });

  it(`${BURST} spawns inside the window warn exactly once`, () => {
    const warnings = run(Array.from({ length: BURST + 3 }, (_, i) => i * 1000));
    expect(warnings.filter(Boolean)).toHaveLength(1);
    expect(warnings[BURST - 1]).toMatch(/FAN-OUT/);
  });

  it("a second burst after the window drains warns again", () => {
    const first = Array.from({ length: BURST }, (_, i) => i * 1000);
    const second = first.map((t) => t + 10 * WINDOW_MS);
    expect(run([...first, ...second]).filter(Boolean)).toHaveLength(2);
  });

  it("the message affirms the delegation law and cites a source that exists", () => {
    const [, , , w] = run([0, 1, 2, 3]);
    expect(w).toMatch(/Delegating verbose work to a subagent is the law/);
    expect(w).toMatch(/token-economy skill/);
    expect(w).not.toMatch(/inline|USAGE_ECONOMICS/);
  });

  it("garbage state is a clean start, not a crash", () => {
    expect(decide({ spawns: "x", lastWarn: "y" }, 5).warning).toBeNull();
    expect(decide(null, 5).state.spawns).toEqual([5]);
  });

  it("as a real hook process: one spawn exits 0 with no output; bad stdin exits 0", () => {
    const sid = `test-${process.pid}-${Date.now()}`;
    const one = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: sid }), encoding: "utf8" });
    expect(one.status).toBe(0);
    expect(one.stdout).toBe("");
    const bad = spawnSync(process.execPath, [HOOK], { input: "{not json", encoding: "utf8" });
    expect(bad.status).toBe(0);
  });

  it("stays registered on PreToolUse(Agent), so the narrowing is not a silent removal", () => {
    const settings = readFileSync(join(dirname(HOOK), "..", "settings.json"), "utf8");
    expect(settings).toContain("subagent-throttle.mjs");
  });
});
