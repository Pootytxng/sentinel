import { describe, expect, it } from "vitest";
import {
  compare,
  declaredCount,
  declaredModules,
  extractMapSection,
  productionSource,
} from "./verify-module-map.mjs";

// These test the DETECTOR against synthetic input, not today's map. A guard that only asserts
// "the current map passes" goes green the moment someone edits the map to match a broken tree.

const disk = (entries) => new Map(Object.entries(entries));

describe("module-map drift detector", () => {
  it("catches the 2026-08-02 defect: a module on disk that the map never names", () => {
    const declared = declaredModules("- `lib.rs` (~1585) — wiring.\n");
    const { failures } = compare(declared, disk({
      "lib.rs": { lines: 1585, mutates: [] },
      "intelligence.rs": { lines: 3614, mutates: [] },
    }), 2);
    expect(failures).toEqual([
      "MISSING: intelligence.rs (3614 lines) is on disk but absent from the map",
    ]);
  });

  it("catches a stale file count even when every named module resolves", () => {
    const declared = declaredModules("- `lib.rs` — wiring.\n");
    const { failures } = compare(declared, disk({ "lib.rs": { lines: 10, mutates: [] } }), 35);
    expect(failures).toEqual(["COUNT: map declares 35 .rs files, tree has 1"]);
  });

  it("catches a ghost: a module named in the map that no longer exists", () => {
    const declared = declaredModules("- `lib.rs` — wiring.\n- `deleted.rs` — gone.\n");
    const { failures } = compare(declared, disk({ "lib.rs": { lines: 10, mutates: [] } }), 1);
    expect(failures).toContain("GHOST: deleted.rs is named in the map but not on disk");
  });

  it("catches an unstarred module that writes Windows state", () => {
    const declared = declaredModules("- `lib.rs` — wiring.\n");
    const { failures } = compare(declared, disk({
      "lib.rs": { lines: 10, mutates: ["set_raw_value"] },
    }), 1);
    expect(failures).toEqual([
      "UNSTARRED-MUTATOR: lib.rs touches Windows state (set_raw_value) but carries no star in the map",
    ]);
  });

  it("accepts a starred mutator", () => {
    const declared = declaredModules("- ★ `actions.rs` — the boundary.\n");
    const { failures } = compare(declared, disk({
      "actions.rs": { lines: 10, mutates: ["run_elevated_powershell"] },
    }), 1);
    expect(failures).toEqual([]);
  });

  it("inherits the star per line, so multi-module bullets are attributed correctly", () => {
    const declared = declaredModules("- ★ `a.rs` (~10), `b.rs` (~20) — two on one line.\n");
    expect(declared.get("a.rs")).toEqual({ starred: true, loc: 10 });
    expect(declared.get("b.rs")).toEqual({ starred: true, loc: 20 });
  });

  it("warns, not fails, on line-count drift beyond tolerance", () => {
    const declared = declaredModules("- `fps.rs` (~625) — IPC.\n");
    const { failures, warnings } = compare(declared, disk({
      "fps.rs": { lines: 1092, mutates: [] },
    }), 1);
    expect(failures).toEqual([]);
    expect(warnings).toEqual(["STALE-LOC: fps.rs map says ~625, tree has 1092"]);
  });
});

describe("production-source filter (why the detector stopped crying wolf)", () => {
  it("ignores a marker that only appears in a comment", () => {
    // main.rs's sole hit on the first run was this: a comment naming the elevation helper.
    const src = "// the ticket minted by actions::run_elevated_powershell or nothing runs\nfn main() {}\n";
    expect(productionSource(src)).not.toContain("run_elevated_powershell");
  });

  it("ignores a marker inside a #[cfg(test)] module", () => {
    const src = [
      "fn real() {}",
      "#[cfg(test)]",
      "mod tests {",
      "  fn t() { let _ = key.set_value(\"x\"); }",
      "}",
      "fn after() {}",
    ].join("\n");
    const production = productionSource(src);
    expect(production).not.toContain("set_value");
    expect(production).toContain("fn after()");
  });

  it("keeps a marker in real code", () => {
    expect(productionSource("fn go() { key.create_subkey(\"Run\"); }")).toContain("create_subkey");
  });
});

describe("gutted-contract guard", () => {
  it("returns null when the map heading is gone, so the check cannot pass vacuously", () => {
    expect(extractMapSection("# CLAUDE.md\n\nno map here\n")).toBeNull();
  });

  it("stops the section at the next h2 rather than swallowing the LOCKED rules", () => {
    const section = extractMapSection("### Rust module map\n- `a.rs` — x.\n\n## LOCKED safety rules\n- `zzz.rs` — not a module bullet.\n");
    expect(section).toContain("a.rs");
    expect(section).not.toContain("zzz.rs");
  });

  it("reads the declared file count out of the header line", () => {
    expect(declaredCount("\n\nComplete as of 2026-08-02 (44 `.rs` files; rough).\n")).toBe(44);
  });
});
