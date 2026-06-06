import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — no @types/node. CSS is read from disk because vitest
// stubs CSS module imports, so import.meta.glob('?raw') comes back empty.)

// Kernel law (owner, 2026-06-06): the win card's earned shimmer is the ONLY celebratory sweep in the
// app. This guard makes it grep-provable — the only @keyframes whose name reads as a shimmer/sheen
// sweep must be `cmp-winshimmer`. (Loading skeletons are opacity-pulses; the radar is a rotation; the
// legacy hero-sheen was removed.) If this fails, a new sweep crept in — convert it to a pulse.
describe("kernel law: one celebratory sweep", () => {
  it("the only shimmer/sheen @keyframes in src/ is cmp-winshimmer", () => {
    const files = (readdirSync("src", { recursive: true }) as string[]).filter((f) =>
      f.endsWith(".css"),
    );
    const names = new Set<string>();
    for (const rel of files) {
      const css = readFileSync(join("src", rel), "utf8");
      for (const m of css.matchAll(
        /@keyframes\s+([A-Za-z0-9_-]*(?:shimmer|sheen)[A-Za-z0-9_-]*)/gi,
      )) {
        names.add(m[1]);
      }
    }
    expect([...names].sort()).toEqual(["cmp-winshimmer"]);
  });
});
